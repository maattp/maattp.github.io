// Headless verification for apps/auto. Boots the game in Chrome over CDP,
// waits for __dbg, runs assertions against the real Seattle it just loaded, and
// writes screenshots.
//
//   python3 -m http.server 8000 &
//   node tools/verify.mjs [--shots]
//
// Two things this must always do, both learned the hard way:
//   * bypass the service worker, or you test a stale build and chase phantoms
//   * set __noAutoQuality before boot, or SwiftShader's ~5 fps drops the tier
//     immediately and every screenshot lies

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9222;
const URL_BASE = process.env.AUTO_URL || 'http://localhost:8000/apps/auto/';
const SHOTS = process.argv.includes('--shots');
const OUT = 'tools/data/shots';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu-sandbox',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    // Headless has no user gestures at all, so without this every
    // media play() is rejected and the live radio can never be tested.
    // The gesture path itself is covered on device by audio.primeLive().
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720',
    '--no-first-run',
    '--user-data-dir=/tmp/auto-verify-profile',
    'about:blank',
  ], { stdio: 'ignore', detached: false });
}

async function cdpTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('Chrome did not expose a CDP target');
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.logs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        this.logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description
          || m.params.exceptionDetails.text));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }
}

async function main() {
  const chrome = launch();
  let session;
  try {
    const target = await cdpTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });
    session = new Session(ws);
    await session.send('Runtime.enable');
    await session.send('Page.enable');
    await session.send('Network.enable');
    // THE rule for this app: never test through the service worker.
    await session.send('Network.setBypassServiceWorker', { bypass: true });
    // Bypassing the service worker is not enough: Chrome's own disk cache will
    // still hand back the previous build's modules, which reads exactly like a
    // change that didn't land.
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__noAutoQuality = true;',
    });

    console.log(`loading ${URL_BASE}`);
    await session.send('Page.navigate', { url: URL_BASE });

    let ready = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      const st = await session.eval(
        '({ dbg: !!window.__dbg, msg: (document.getElementById("loadMsg")||{}).textContent })');
      if (st.dbg) { ready = true; break; }
      if (i % 10 === 0) console.log(`  ... ${st.msg || 'booting'}`);
    }
    const errors = session.logs.filter((l) => /EXCEPTION|Failed to start/i.test(l));
    if (!ready) {
      console.log(session.logs.slice(-25).join('\n'));
      throw new Error('game never reached __dbg');
    }
    console.log('booted.\n');

    const report = await session.eval(`(() => {
      const d = window.__dbg, G = d.G, city = d.city;
      const toWorld = (lat, lon) => G.toWorld(lat, lon);
      // Truth table: real Seattle coordinates, checked against where the game
      // actually put each landmark mesh.
      const TRUTH = {
        'Space Needle': [47.6205, -122.3493],
        'Climate Pledge Arena': [47.6221, -122.3540],
        'Pike Place Market': [47.6097, -122.3422],
        'Lumen Field': [47.5952, -122.3316],
        'T-Mobile Park': [47.5914, -122.3325],
        'Gas Works Park': [47.6456, -122.3344],
        'Kerry Park': [47.6295, -122.3599],
        'Husky Stadium': [47.6503, -122.3016],
        'Fremont Troll': [47.6510, -122.3474],
        'Seattle Great Wheel': [47.6062, -122.3425],
      };
      const lm = [];
      for (const l of G.LANDMARKS) {
        const t = TRUTH[l.name];
        if (!t) continue;
        const [tx, tz] = toWorld(t[0], t[1]);
        lm.push({ name: l.name, err: Math.hypot(l.x - tx, l.z - tz) });
      }
      let deg1 = 0, elev = 0;
      for (const n of city.nodes) { if (n.e.length === 1) deg1++; if (n.elev) elev++; }
      const cls = {};
      for (const e of city.edges) cls[e.cls] = (cls[e.cls] || 0) + 1;
      let roadInWater = 0;
      for (const e of city.edges) {
        if (e.elev) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        if (G.isWater((a.x + b.x) / 2, (a.z + b.z) / 2)) roadInWater++;
      }
      return {
        nodes: city.nodes.length, edges: city.edges.length,
        buildings: city.buildings.length, deg1, elev, cls, roadInWater,
        landmarks: lm,
        spawn: { x: G.SPAWN.x, z: G.SPAWN.z, h: G.SPAWN_HEADING },
        playerY: d.player.position.y,
        ground: city.groundAt(G.SPAWN.x, G.SPAWN.z, null),
        terrain: G.terrainHeight(G.SPAWN.x, G.SPAWN.z),
        place: G.placeNameAt(G.SPAWN.x, G.SPAWN.z),
        calls: d.sceneStats.calls, tris: d.sceneStats.tris,
        pendingChunks: [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length,
      };
    })()`);

    console.log('--- city ------------------------------------------------');
    console.log(`  nodes ${report.nodes}  edges ${report.edges}  buildings ${report.buildings}`);
    console.log(`  edge classes: ${JSON.stringify(report.cls)}`);
    console.log(`  elevated nodes ${report.elev}   dead ends ${report.deg1}`);
    console.log(`  ground-level edges over water: ${report.roadInWater}`);
    console.log(`  spawn (${report.spawn.x.toFixed(0)}, ${report.spawn.z.toFixed(0)}) `
      + `in ${report.place}; terrain ${report.terrain.toFixed(1)} m, `
      + `ground ${report.ground.toFixed(1)} m, player Y ${report.playerY.toFixed(1)} m`);
    // Chunk geometry is time-sliced across frames, so this is taken mid-stream
    // and is NOT the steady-state cost. The outstanding count is printed with it
    // so the figure can never be read as a draw-call win that is really just an
    // unfinished city.
    console.log(`  scene pass: ${report.calls} draws, ${report.tris} triangles`
      + (report.pendingChunks ? `  (mid-stream: ${report.pendingChunks} chunks outstanding)` : ''));

    console.log('\n--- landmark accuracy vs real lat/lon --------------------');
    let worst = 0;
    for (const l of report.landmarks) {
      worst = Math.max(worst, l.err);
      console.log(`  ${l.name.padEnd(24)} ${l.err.toFixed(0).padStart(5)} m`);
    }
    const mean = report.landmarks.reduce((s, l) => s + l.err, 0) / report.landmarks.length;
    console.log(`  mean ${mean.toFixed(0)} m, worst ${worst.toFixed(0)} m`);

    // Can the player actually drive? Put them in a car and hold the throttle.
    const drive = await session.eval(`(async () => {
      const d = window.__dbg;
      const p = d.player.position;
      const v = d.traffic.nearestEnterable ? d.traffic.nearestEnterable(p.x, p.z, 600) : null;
      if (!v) return { ok: false, why: 'no enterable vehicle within 600 m' };
      d.player.enterVehicle(v);
      const x0 = d.player.position.x, z0 = d.player.position.z;
      d.controls.btn.gas = true;
      await new Promise(r => setTimeout(r, 6000));
      d.controls.btn.gas = false;
      const p2 = d.player.position;
      return { ok: true, moved: Math.hypot(p2.x - x0, p2.z - z0),
               y: p2.y, inCar: !d.player.onFoot };
    })()`, true);
    console.log('\n--- drive test ------------------------------------------');
    console.log('  ' + JSON.stringify(drive));

    // --- water and tunnels ------------------------------------------------
    //
    // Both of these were shipped broken once and neither had an assertion.
    // waterLevelAt answers over a lake's axis-aligned BOUNDING BOX, so a height
    // test alone drowns you on the dry park ringing Green Lake -- the same trap
    // that once deleted 105 of its trees. And a tunnel drawn as surface road
    // put 46 buildings in a freeway.
    const water = await session.eval(`(() => {
      const d = window.__dbg, w = d.world, G = d.G, city = d.city;
      const out = { dryInsideLakeBox: 0, checked: 0, wetDetected: 0, tunnelLift: 0, tunnelSampled: 0 };
      for (const l of (w.lakeSpecs || [])) {
        for (let i = 0; i <= 12; i++) {
          for (let j = 0; j <= 12; j++) {
            const x = l.x0 + (l.x1 - l.x0) * (i / 12);
            const z = l.z0 + (l.z1 - l.z0) * (j / 12);
            const wl = w.waterLevelAt(x, z);
            if (wl === null) continue;
            out.checked++;
            const wet = G.isWater(x, z);
            const lowEnough = G.terrainHeight(x, z) < wl - 0.6;
            if (wet && lowEnough) out.wetDetected++;
            // Dry ground that a height-only test would call submerged.
            if (!wet && lowEnough) out.dryInsideLakeBox++;
          }
        }
      }
      // A tunnel must not lift anything BY ITSELF. It may still be under a real
      // street -- that is what a bore is -- and the street above legitimately
      // paves the ground, so the honest test is: where nothing but the tunnel
      // covers this point, the lift has to be zero.
      const covered = (x, z) => {
        for (const e of city.edges) {
          if (e.tunnel || e.elev) continue;
          const a = city.nodes[e.a], b = city.nodes[e.b];
          const dx = b.x - a.x, dz = b.z - a.z;
          const L2 = dx * dx + dz * dz || 1;
          let t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = a.x + dx * t - x, pz = a.z + dz * t - z;
          if (Math.hypot(px, pz) <= e.hw + 3.4) return true;
        }
        // A junction ring reaches past the strips, and its DIAGONAL corner is
        // sqrt(2) x (hw + sw) from the node -- further than any straight-line
        // test along an edge gets. Four samples sat in exactly that gap.
        for (const n of city.nodes) {
          if (n.elev) continue;
          let hw = 0, any = false;
          for (const ei of n.e) {
            const e = city.edges[ei];
            if (e.tunnel) continue;
            any = true;
            if (e.hw > hw) hw = e.hw;
          }
          if (!any || hw <= 0) continue;
          if (Math.hypot(n.x - x, n.z - z) <= (hw + 3.2) * 1.45) return true;
        }
        return false;
      };
      for (const e of city.edges) {
        if (!e.tunnel || e.elev) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        for (let k = 1; k < 4; k++) {
          const t = k / 4;
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          if (covered(x, z)) continue;   // a real street above the bore
          out.tunnelSampled++;
          if (city.roadLift(x, z) > 0.01) out.tunnelLift++;
        }
      }
      return out;
    })()`, true);
    console.log('\n--- water and tunnels -----------------------------------');
    console.log(`  lake-box points: ${water.checked}, genuinely wet ${water.wetDetected},`
      + ` dry-but-below-level ${water.dryInsideLakeBox}`);
    console.log(`  ${water.dryInsideLakeBox > 0
      ? 'those are why the mask must be tested as well as the height'
      : 'no dry points below level in any lake box'}`);
    console.log(`  tunnel-only samples (no street above) ${water.tunnelSampled},`
      + ` with a paved lift ${water.tunnelLift}`);
    if (water.tunnelLift > 0) {
      console.error(`FAIL: ${water.tunnelLift} tunnel-only samples report a paved lift with no road drawn`);
      process.exitCode = 1;
    }

    if (SHOTS) {
      mkdirSync(OUT, { recursive: true });
      const views = [
        ['spawn', null],
        ['needle', [-857, -1130]],
        ['downtown', [200, 400, 60]],
        // I-5 and Aurora-through-Woodland-Park are the two spots the road
        // complaints came from: a box across the freeway, and trees on the
        // carriageway where a road crosses greenspace.
        ['i5', [1270, 2641, 40]],
        ['i5-north', [1294, -2400, 40]],
        ['woodland-park', [-676, -4842, 40]],
        ['aurora-bridge', [-880, -4550, 60]],
      ];
      for (const [name, at] of views) {
        if (at) {
          await session.eval(`(() => { const d = window.__dbg;
            d.player.respawn(${at[0]}, ${at[1]}); })()`);
          await sleep(2500);
        }
        await sleep(1500);
        const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
        console.log(`  shot ${OUT}/${name}.png`);
      }

      // Aerial. The frame loop still draws while paused but stops driving the
      // camera from the player, so it can just be posed.
      for (const [name, x, z, h] of [
        // Posed at the Space Needle. A respawn faces wherever the camera
        // happened to be, which is how a landmark can look missing when it is
        // simply behind you.
        ['needle-posed', -857, -1019, 55],
        ['aerial-downtown', 300, 700, 700],
        ['aerial-lakeunion', 200, -2600, 1100],
      ]) {
        await session.eval(`(() => {
          const d = window.__dbg;
          d.game.paused = true;
          d.world.update(${x}, ${z}, 40);
          d.camera.position.set(${x}, ${h}, ${z + (h > 200 ? h * 0.9 : 260)});
          d.camera.lookAt(${x}, ${h > 200 ? 0 : 120}, ${z});
          d.camera.updateMatrixWorld(true);
        })()`);
        await sleep(6000);
        const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
        console.log(`  shot ${OUT}/${name}.png`);
      }
      await session.eval('window.__dbg.game.paused = false');
    }

    // --- radio: live when online, synth when not --------------------------
    // The offline half is the one that matters. This is an offline-first PWA and
    // the radio must not go silent (or throw) on a plane.
    console.log('\n--- radio -----------------------------------------------');
    const radioOn = await session.eval(`(async () => {
      const d = window.__dbg;
      d.audio.init(); d.audio.resume(); d.audio.primeLive();
      const p = d.player.position;
      const v = d.traffic.nearestEnterable(p.x, p.z, 600);
      if (v) d.player.enterVehicle(v);
      await new Promise(r => setTimeout(r, 7000));
      return { live: d.audio.liveOn, t: d.audio._live ? d.audio._live.currentTime : 0,
               track: d.audio._nowPlaying };
    })()`, true);
    console.log(`  online:  live=${radioOn.live} streamed=${radioOn.t.toFixed(1)}s `
      + `track=${radioOn.track ? JSON.stringify(radioOn.track) : 'none yet'}`);

    await session.send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    const radioOff = await session.eval(`(async () => {
      const d = window.__dbg;
      d.player.exitVehicle();
      await new Promise(r => setTimeout(r, 1200));
      d.audio._liveFailed = false;               // as if this drive were the first
      const p = d.player.position;
      const v = d.traffic.nearestEnterable(p.x, p.z, 600);
      if (v) d.player.enterVehicle(v);
      await new Promise(r => setTimeout(r, 7000));
      return { live: d.audio.liveOn, synthGain: d.audio.musicBus.gain.value,
               failed: d.audio._liveFailed };
    })()`, true);
    await session.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    const synthCovers = !radioOff.live && radioOff.synthGain > 0.01;
    console.log(`  offline: live=${radioOff.live} synthGain=${radioOff.synthGain.toFixed(2)} `
      + `-> ${synthCovers ? 'synth radio covers' : 'SILENT -- BUG'}`);
    if (!synthCovers) process.exitCode = 1;

    // AUTO_PROBE lets a one-off diagnostic ride the same proven boot path
    // rather than maintaining a second, subtly different CDP harness.
    if (process.env.AUTO_PROBE) {
      console.log('\n--- probe ------------------------------------------------');
      console.log(JSON.stringify(await session.eval(process.env.AUTO_PROBE, true), null, 2));
    }

    const bad = session.logs.filter((l) => /EXCEPTION/i.test(l));
    if (bad.length) {
      console.log('\n--- console exceptions ----------------------------------');
      console.log(bad.slice(0, 10).join('\n'));
    }
    console.log(`\n${bad.length ? 'FAIL' : 'OK'}: ${bad.length} exceptions`);
    process.exitCode = bad.length ? 1 : 0;
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('verify failed:', e.message); process.exitCode = 1; });
