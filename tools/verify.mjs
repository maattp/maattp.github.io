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

import { launchChrome, assertRenderer } from './chrome.mjs';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// NOTHING SHIPS WITH A CONFLICT MARKER IN IT.
//
// v64 went live with `<<<<<<< HEAD` printed on the launch screen. A merge was
// "resolved" by regexing the version literal instead of resolving it, which
// left the markers in index.html with the same value on both sides -- so the
// next version bump rewrote both and the markers survived another release.
//
// Nothing in the pipeline could have caught it: git does not reject markers,
// `node --check` does not parse HTML, and an HTML parser renders a stray
// `<<<<<<< HEAD` as ordinary text, which is exactly how it reached a player's
// screen. This is a file scan, run before the browser is even started, because
// no amount of looking at a render was going to find it either.
function scanForConflictMarkers(dir) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name === '.git' || name === 'vendor') continue;
      const full = d + '/' + name;
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(html|js|mjs|json|css)$/.test(name)) continue;
      const text = readFileSync(full, 'utf8');
      const line = text.split('\n').findIndex((l) =>
        /^<{7} |^={7}$|^>{7} /.test(l));
      if (line >= 0) hits.push(`${full}:${line + 1}`);
    }
  };
  walk(dir);
  return hits;
}
const markers = scanForConflictMarkers('apps/auto');
if (markers.length) {
  console.log('\nFAIL: merge conflict markers left in shipped files:');
  for (const m of markers) console.log('  ' + m);
  process.exit(1);
}

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9222;
const URL_BASE = process.env.AUTO_URL || `http://localhost:${HTTP_PORT}/apps/auto/`;
const SHOTS = process.argv.includes('--shots');
const OUT = 'tools/data/shots';

// Launch flags live in tools/chrome.mjs (AUTO_GPU=1 for the Mac's GPU).
function launch() {
  return launchChrome({
    port: PORT, profile: `/tmp/auto-verify-profile-${PORT}`, width: 1280, height: 720,
    // Headless has no user gestures at all, so without this every
    // media play() is rejected and the live radio can never be tested.
    // The gesture path itself is covered on device by audio.primeLive().
    extra: ['--autoplay-policy=no-user-gesture-required'],
  });
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
    // __dbg appears before the game loop has drawn a frame, and traffic only
    // spawns from its own update. With load-time freeway grading the boot got
    // slower and the drive test began landing in that window -- "no enterable
    // vehicle within 600 m" with an empty city, which reads like a traffic bug
    // and is the harness's timing. Same wait perfguard does.
    for (let i = 0; i < 120; i++) {
      if (await session.eval('window.__dbg.sceneStats.calls > 0 && window.__dbg.traffic.cars.length > 0')) break;
      await sleep(500);
    }
    await assertRenderer((e) => session.eval(e));
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
          // pavement (up to 3.2 m) plus the 1 m verge it comes down across
          if (Math.hypot(px, pz) <= e.hw + 4.4) return true;
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
          if (Math.hypot(n.x - x, n.z - z) <= (hw + 4.2) * 1.45) return true;
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

    // --- no road under the water drawn over it -----------------------------
    //
    // The 520 was "underwater near UW": its cutting at the Montlake lid's east
    // portal dips to ~4 m, under Lake Washington's plane at 5.09, and the
    // depth mask that keeps water out of cuttings stood at SEA level; and a
    // spurious 9.9 m "lake" (Union Bay's marsh, eroded off Lake Washington by
    // build_raster) drew a second plane over both carriageways where they
    // leave the floating bridge. Every non-tunnel road is walked at 10 m
    // against the water drawn at that point (the sea, a lake's whole box,
    // the canal). A sample
    // under it counts only if nothing hides the water there: not the cuttings'
    // mask, not ground over it (a lid), and nothing opaque between the road and
    // the surface.
    //
    // The 520 and I-90 corridors must be dry end to end, and each floating
    // bridge must be found and clear the lake by 3 m. Everything else is held
    // to the count it had when this was written, so nothing new goes under:
    // low decks whose ends sit on a dug shore (ferry docks, Harbor Island's
    // ramps) and low ground inside Lake Washington's 25 km box (Tukwila,
    // Bellevue's shore) -- see "Known gaps" in apps/auto/CLAUDE.md. Lower
    // these when one is fixed.
    const SUBMERGED_MAJOR_MAX = 50, SUBMERGED_STREETS_MAX = 313;
    const sub = await session.eval(`(() => {
      const d = window.__dbg, c = d.city, w = d.world, G = d.G, THREE = d.THREE;
      // The water DRAWN at a point, worked out here rather than asked of the
      // game: the sea plane at 0 everywhere, each lake's plane over its whole
      // box, the canal's at its level.
      const canal = G.shipCanal(w.lakeSpecs || []);
      const W = (x, z) => {
        let lv = 0;
        for (const l of w.lakeSpecs || []) if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) lv = Math.max(lv, l.level);
        const cl = canal && canal.at(x, z);
        return cl != null ? Math.max(lv, cl) : lv;
      };
      const rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
      const water = new Set([w.water, ...(w.lakes || []), w.canalMesh].filter(Boolean));
      const covers = [];
      d.scene.traverse((o) => { if (o.isMesh && o.visible && !water.has(o) && o !== w.tunnelWaterMaskMesh) covers.push(o); });
      const hidden = (x, y, z, lv) => {
        if (G.terrainHeight(x, z) > Math.max(lv, y + 2)) return true;          // under ground
        if (w.tunnelWaterMaskMesh) {
          rc.set(new THREE.Vector3(x, lv + 2, z), down); rc.far = 2.2;
          if (rc.intersectObject(w.tunnelWaterMaskMesh).length) return true;   // a cutting's mask
        }
        rc.set(new THREE.Vector3(x, y + 0.6, z), up); rc.far = Math.max(0.1, lv - y - 0.6);
        return rc.intersectObjects(covers, false).length > 0;                 // a lid or deck over it
      };
      const out = { samples: 0, corridor: [], major: [], majors: 0, streets: 0, streetWhere: {}, floating: {} };
      const FLOAT = /Evergreen Point Floating|Lacey V. Murrow|Homer M. Hadley/;
      const CORRIDOR = /Evergreen Point Floating|Lacey V. Murrow|Homer M. Hadley|^WA 520$|^I 90$/;
      c.edges.forEach((e, ei) => {
        if (e.tunnel) return;
        const a = c.nodes[e.a], b = c.nodes[e.b];
        const n = Math.max(1, Math.ceil(e.len / 10));
        for (let k = 0; k <= n; k++) {
          const t = k / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const lv = W(x, z);
          if (lv <= 0 && G.terrainHeight(x, z) > 3) continue;
          out.samples++;
          const seed = (e.ph ? e.ph[Math.round(t * (e.ph.length - 1))]
            : e.elev ? a.y + (b.y - a.y) * t : G.terrainHeight(x, z)) + 0.6;
          const y = c.groundAt(x, z, seed);
          if (FLOAT.test(e.name || '') && G.isWater(x, z)) {
            const f = out.floating[e.name] || (out.floating[e.name] = { min: Infinity });
            f.min = Math.min(f.min, y - lv);
          }
          if (y >= lv - 0.05 || hidden(x, y, z, lv)) continue;
          const at = ' @' + x.toFixed(0) + ',' + z.toFixed(0) + ' ' + (lv - y).toFixed(2) + ' m under';
          if (CORRIDOR.test(e.name || '')) {
            out.corridor.push(e.name + at);
          } else if (e.elev || e.cls === 'hwy' || e.cls === 'ramp') {
            out.majors++;
            if (out.major.length < 12) out.major.push((e.elev ? 'deck ' : '') + e.cls + ' ' + (e.name || '') + at);
          } else {
            out.streets++;
            const key = (e.name || e.cls) + ' @' + Math.round(x / 500) * 500 + ',' + Math.round(z / 500) * 500;
            out.streetWhere[key] = (out.streetWhere[key] || 0) + 1;
          }
        }
      });
      out.streetWhere = Object.entries(out.streetWhere).sort((p, q) => q[1] - p[1]).slice(0, 8).map(([k, v]) => k + ' x' + v);
      return out;
    })()`, true);
    console.log('\n--- roads under the water -------------------------------');
    console.log(`  ${sub.samples} samples near water; 520/I-90 under it: ${sub.corridor.length},`
      + ` other decks/freeways/ramps: ${sub.majors} (max ${SUBMERGED_MAJOR_MAX}),`
      + ` streets: ${sub.streets} (max ${SUBMERGED_STREETS_MAX})`);
    for (const [name, f] of Object.entries(sub.floating)) console.log(`  ${name}: lowest deck ${f.min.toFixed(2)} m over the lake`);
    if (sub.streets) console.log('  streets: ' + sub.streetWhere.join('; '));
    const lowFloat = Object.entries(sub.floating).filter(([, f]) => f.min < 3);
    if (sub.corridor.length || lowFloat.length || Object.keys(sub.floating).length < 3
      || sub.majors > SUBMERGED_MAJOR_MAX || sub.streets > SUBMERGED_STREETS_MAX) {
      for (const m of [...sub.corridor.slice(0, 12), ...sub.major]) console.error('  ' + m);
      console.error(`FAIL: roads under the water drawn over them (${sub.corridor.length} on the 520/I-90,`
        + ` ${lowFloat.length} floating bridges under 3 m, ${Object.keys(sub.floating).length}/3 floating bridges found,`
        + ` ${sub.majors} other deck/freeway samples, ${sub.streets} street samples)`);
      process.exitCode = 1;
    }

    // --- the monorail -----------------------------------------------------
    //
    // The Seattle Center Monorail (monorail.js): the line as built, a
    // stretch of service at fixed dt, and one run driven from the cab.
    const mono = await session.eval(`(() => {
      const d = window.__dbg, m = d.monorail, c = d.city, G = d.G, tf = d.traffic, THREE = d.THREE;
      if (!m || !m.trains) return null;
      const out = {};
      const W = m.tracks.west, E = m.tracks.east;
      out.len = [W.len, E.len];
      out.columns = m.columns.length;
      // beams clear the street (outside the stations and MoPOP)
      let clear = Infinity;
      for (const tr of [W, E]) for (let s = tr.wlZone[1]; s < tr.scZone[0]; s += 4) {
        if (tr.mopop && s > tr.mopop[0] - 5 && s < tr.mopop[1] + 5) continue;
        clear = Math.min(clear, tr.y(s) - 1.52 - c.groundAt(tr.x(s), tr.z(s), null));
      }
      out.beamClear = clear;
      // no solid of the line within a car's half-width and a margin of a
      // lane's centre, by traffic's own lane layout
      let gap = Infinity;
      for (const q of m.solids) for (const ei of c.edgesNear(q.x, q.z, 30)) {
        const e = c.edges[ei];
        if (e.tunnel || e.elev) continue;
        const a = c.nodes[e.a], b = c.nodes[e.b];
        for (const sign of [1, -1]) {
          if (!tf.allowed(ei, sign)) continue;
          for (const lu of [0.01, 0.5, 0.99]) {
            const off = tf.laneLat(ei, sign, { laneU: lu });
            for (let t = 0; t <= 1; t += 0.05) {
              const lx = a.x + (b.x - a.x) * t - e.dz * sign * off, lz = a.z + (b.z - a.z) * t + e.dx * sign * off;
              let dd;
              if (q.r !== undefined) dd = Math.hypot(lx - q.x, lz - q.z) - q.r;
              else { const cs = Math.cos(q.rot), sn = Math.sin(q.rot), dx = lx - q.x, dz = lz - q.z;
                dd = Math.hypot(Math.max(0, Math.abs(dx * cs + dz * sn) - q.hw), Math.max(0, Math.abs(-dx * sn + dz * cs) - q.hd)); }
              gap = Math.min(gap, dd);
            }
          }
        }
      }
      out.laneGap = gap;
      // nothing built across the train's path: no city box, and MoPOP's
      // skins clear of the passage (a ray out each side at mid-height)
      let boxes = 0;
      for (const tr of [W, E]) for (let s = 0; s < tr.len; s += 3) {
        const x = tr.x(s), z = tr.z(s), y = tr.y(s);
        for (const b of c.buildingsNear(x, z, 30)) {
          if (b.y + b.h < y - 1.5) continue;
          const cs = Math.cos(-b.rot), sn = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
          if (Math.abs(dx * cs - dz * sn) < b.w / 2 && Math.abs(dx * sn + dz * cs) < b.d / 2) boxes++;
        }
      }
      out.boxesOnLine = boxes;
      const lms = [];
      d.scene.traverse((o) => { if (o.isMesh && /landmarks:/.test(o.name || '')) lms.push(o); });
      d.scene.updateMatrixWorld(true);
      const rc = new THREE.Raycaster();
      let hits = 0;
      for (const tr of [W, E]) if (tr.mopop) for (let s = tr.mopop[0]; s <= tr.mopop[1]; s += 3) {
        const h = tr.heading(s), l = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
        for (const sd of [1, -1]) {
          rc.set(new THREE.Vector3(tr.x(s), tr.y(s) + 1.6, tr.z(s)), l.clone().multiplyScalar(sd));
          rc.far = 1.62;
          if (rc.intersectObjects(lms, false).length) hits++;
        }
      }
      out.mopopHits = hits;
      // Seattle Center: walk the ramp up to the platform
      const r = m.scRamp;
      let y = c.groundAt(r.x, r.z + 2, null), step = 0;
      for (let z = r.z + 2; z > r.z - 60; z -= 0.5) { const ny = c.groundAt(r.x, z, y + 0.6); step = Math.max(step, Math.abs(ny - y)); y = ny; if (Math.abs(y - m.scFloor) < 0.05) break; }
      out.rampStep = step; out.rampTop = y - m.scFloor;
      // Seattle Center on foot: every platform ground from end to end (a
      // short one left a hole at the concourse), the track slots solid, and
      // nothing to walk into under the ramp
      let holes = 0, slotsOpen = 0;
      const tr = m.tracks.west, h = tr.heading(tr.len - 24), fx = Math.sin(h), fz = Math.cos(h);
      for (const p of m.platforms) {
        if (Math.abs(p.y0 - m.scFloor) > 0.01 || p.y0 !== p.y1 || p.hd > 30) continue;
        const vx = -p.s, vz = p.c;              // along
        for (let v = -p.hd + 0.3; v <= p.hd - 0.3; v += 1) {
          const py = c.platformAt(p.x + vx * v, p.z + vz * v);
          if (py === null || Math.abs(py - m.scFloor) > 0.01) holes++;
        }
      }
      for (const tt of [m.tracks.west, m.tracks.east]) for (let s = tt.scZone[0] + 6; s < tt.len - 1; s += 3) {
        const hh = tt.heading(s), lx = Math.cos(hh), lz = -Math.sin(hh);
        for (const off of [-1.2, 1.2]) if (!c.obstacleHit(tt.x(s) + lx * off, tt.z(s) + lz * off, 0.32, m.scFloor)) slotsOpen++;
      }
      let underOpen = 0;
      for (let z = r.z - 4; z > r.z - 40; z -= 4) if (!c.obstacleHit(r.x, z, 0.32, G.terrainHeight(r.x, z))) underOpen++;
      out.scWalk = { holes, slotsOpen, underOpen };
      // the Armory stands (a padded clear zone once deleted it), and no
      // stunt jump's run-up or ramp crosses the line's stations or ramp
      out.armory = c.buildingsNear(-970, -1128, 20).some((b) => b.w * b.d > 5000);
      let jumpHits = [];
      for (const j of (d.stunts && d.stunts.list) || []) {
        for (let t = 0; t <= 1.08; t += 0.02) {
          const x = j.sx + (j.x - j.sx) * t, z = j.sz + (j.z - j.sz) * t;
          if (c.landmarkHit(x, z, 3, G.terrainHeight(x, z) + 1) && m.solids.some((q) => Math.hypot(q.x - x, q.z - z) < 60)) { jumpHits.push(j.id); break; }
        }
      }
      out.jumpHits = jumpHits;
      // A train waits for you: on foot near Seattle Center (the spawn is
      // ~310 m from it), the one at its platform holds; sent away, the other
      // comes at once instead of dwelling out its time.
      const T = m.trains, P = d.player;
      // you, on foot, however the drive above left you
      if (!P.onFoot) P.exitVehicle(true);
      const px = P.x, pz = P.z;
      P.x = m.scStation.x + 60; P.z = m.scStation.z + 60;
      for (let i = 0; i < 30 * 90; i++) m.update(1 / 30);
      out.held = T.blue.at() === 'sc' && T.blue.state === 'dwell';
      // No train there or coming: Blue mid-line heading away to Westlake,
      // Red dwelling at Westlake with 25 s to go. Red must leave at once.
      T.blue.place(T.blue.track.len / 2, -1); T.blue.state = 'run';
      T.red.place(T.red.markWL + 18.6, 1); T.red.state = 'dwell'; T.red.timer = 25;
      let waited = 0;
      while (T.red.state === 'dwell' && waited < 30 * 20) { m.update(1 / 30); waited++; }
      out.summoned = waited / 30;
      // settle both back into ordinary service before timing it
      P.x = 6000; P.z = 6000;
      for (let i = 0; i < 30 * 240; i++) m.update(1 / 30);
      // service: seven minutes at fixed dt, with you well away
      P.x = 6000; P.z = 6000;
      const arr = { blue: 0, red: 0 }, trips = [], was = {};
      let both = 0, vmax = 0, dep = {};
      for (let i = 0; i < 30 * 420; i++) {
        m.update(1 / 30);
        for (const q of Object.values(T)) {
          vmax = Math.max(vmax, Math.abs(q.u));
          const st = q.state;
          if (st === 'run' && was[q.key] === 'dwell') dep[q.key] = i;
          if (st === 'dwell' && was[q.key] === 'run') { arr[q.key]++; if (dep[q.key] !== undefined) trips.push((i - dep[q.key]) / 30); }
          was[q.key] = st;
        }
        if (T.blue.inGauntlet() && T.red.inGauntlet()) both++;
      }
      out.arrivals = arr; out.trips = trips; out.gauntletShared = both; out.vmax = vmax;
      // one run from the cab: Red, from Westlake to Seattle Center
      const red = T.red;
      for (let i = 0; i < 30 * 200 && !(red.at() === 'wl' && red.state === 'dwell'); i++) m.update(1 / 30);
      if (red.at() !== 'wl') { out.drive = 'red never reached Westlake'; return out; }
      m.onBoard(red);
      let said = '';
      const sayWas = m.say; m.say = (t) => { said = t; };
      for (let i = 0; i < 30 * 240; i++) {
        const left = red.markSC - red.sA, v = red.u, lim = red.limitAt(red.sA + 40);
        const need = v * v / 2.5 + 1.2;
        const thr = left > need && v < lim ? 1 : 0, brk = left <= need || v > lim * 1.08 ? 1 : 0;
        red.update(1 / 30, { throttle: thr, brake: brk * (left < need ? 0.85 : 0.5) });
        m.update(1 / 30);
        if (Math.abs(red.u) < 0.02 && left < 8 && i > 60) break;
      }
      m.say = sayWas;
      const spot = m.exitSpot(red);
      out.drive = { at: red.at(), left: red.markSC - red.sA, said, spot: !!spot, platform: spot ? c.platformAt(spot.x, spot.z) - m.scFloor : null };
      m.onLeave(red);
      P.x = px; P.z = pz;
      return out;
    })()`, true);
    console.log('\n--- monorail ----------------------------------------------');
    if (!mono) {
      console.error('FAIL: no monorail');
      process.exitCode = 1;
    } else {
      console.log(`  beams ${mono.len.map((l) => l.toFixed(0)).join(' / ')} m, ${mono.columns} columns, beam over the street >= ${mono.beamClear.toFixed(2)} m,`
        + ` nearest lane ${mono.laneGap.toFixed(2)} m from a column`);
      console.log(`  city boxes on the line ${mono.boxesOnLine}, MoPOP skin inside the passage ${mono.mopopHits}, ramp worst step ${mono.rampStep.toFixed(2)} m`);
      console.log(`  service 7 min: arrivals ${JSON.stringify(mono.arrivals)}, trips ${mono.trips.map((t) => t.toFixed(0)).join(', ')} s,`
        + ` gauntlet shared ${mono.gauntletShared} frames, top ${(mono.vmax * 3.6).toFixed(0)} km/h`);
      console.log(`  Seattle Center on foot: platform holes ${mono.scWalk.holes}, open track-slot samples ${mono.scWalk.slotsOpen}, open under the ramp ${mono.scWalk.underOpen}; Armory standing ${mono.armory}; jumps across the monorail ${mono.jumpHits.join(',') || 'none'}`);
      console.log(`  waiting at Seattle Center: a train held there ${mono.held}, the other summoned in ${mono.summoned.toFixed(1)} s`);
      console.log(`  driven: ${typeof mono.drive === 'string' ? mono.drive : `at ${mono.drive.at}, ${mono.drive.left.toFixed(2)} m from the mark, "${mono.drive.said}", off onto the platform ${mono.drive.platform !== null && Math.abs(mono.drive.platform) < 0.05}`}`);
      const bad = [];
      if (mono.columns < 45) bad.push('too few columns');
      if (!mono.held) bad.push('no train held at Seattle Center while you wait');
      if (mono.scWalk.holes || mono.scWalk.slotsOpen || mono.scWalk.underOpen) bad.push('Seattle Center is not walkable as built');
      if (!mono.armory) bad.push('the Armory is gone');
      if (mono.jumpHits.length) bad.push('a stunt jump runs into the monorail');
      if (!(mono.summoned < 3)) bad.push('the other train not sent for you');
      if (mono.beamClear < 5.5) bad.push('a beam low over the street');
      if (mono.laneGap < 1.3) bad.push('a column in a lane');
      if (mono.boxesOnLine) bad.push('buildings on the line');
      if (mono.mopopHits) bad.push('MoPOP across the passage');
      if (mono.rampStep > 0.5 || Math.abs(mono.rampTop) > 0.05) bad.push('the Seattle Center ramp');
      if (mono.gauntletShared) bad.push('both trains in the gauntlet');
      if (mono.arrivals.blue < 3 || mono.arrivals.red < 3) bad.push('service stalled');
      if (mono.trips.some((t) => t < 80 || t > 140)) bad.push('a service trip out of 80-140 s');
      if (mono.vmax > 20.6) bad.push('service over 45 mph');
      if (typeof mono.drive === 'string' || mono.drive.at !== 'sc' || !mono.drive.spot || Math.abs(mono.drive.platform) > 0.05) bad.push('the driven run');
      if (bad.length) {
        console.error(`FAIL: monorail: ${bad.join('; ')}`);
        process.exitCode = 1;
      }
    }

    // --- beaches, landmarks, park furniture -------------------------------
    //
    // The beaches are sand to the water and carry their props; every landmark
    // added with EXTRA_LANDMARKS stands on dry ground (West Point's and Alki
    // Point's lighthouses were under the Sound until geo.js padded them); the
    // Gas Works towers and Discovery Park's South Bluff are there; and the
    // park furniture is drawn into the chunks round the start.
    const places = await session.eval(`(() => {
      const d = window.__dbg, G = d.G, w = d.world, lm = d.lmRoot;
      const SAND = G.LOT_KINDS.indexOf('sand');
      const out = { beaches: {}, wet: [], missing: [] };
      for (const b of lm.userData.beaches) {
        const k = b.name || '(unnamed)';
        const o = out.beaches[k] || (out.beaches[k] = { props: 0, kit: b.kit });
        o.props += b.props;
      }
      // sand samples (5 m grid) within r of a point on dry land
      const sandNear = (x0, z0, r) => {
        let n = 0;
        for (let z = z0 - r; z <= z0 + r; z += 5) for (let x = x0 - r; x <= x0 + r; x += 5)
          if (G.lotAt(x, z) === SAND && !G.isWater(x, z)) n++;
        return n;
      };
      out.sand = {
        alki: sandNear(-5140, 3343, 80), golden: sandNear(-5010, -8960, 60),
        discoverySouth: sandNear(-6820, -5330, 60), bluff: sandNear(-6560, -5200, 60),
      };
      for (const e of G.EXTRA_LANDMARKS) {
        const l = G.LANDMARKS.find((q) => q.kind === e.kind);
        if (!l) { out.missing.push(e.kind); continue; }
        const y = G.terrainHeight(l.x, l.z), wl = w.waterLevelAt(l.x, l.z);
        if (wl !== null && y < wl + 0.5) out.wet.push(e.kind + ' ' + (y - wl).toFixed(2));
      }
      out.built = ['westPoint', 'alkiPoint', 'gasworks', 'troll', 'daybreak', 'waterTower'].filter((k) => !lm.getObjectByName(k) && !G.LANDMARKS.some((q) => q.kind === k));
      let n = 0;
      for (const l of G.PARK_PROPS.values()) n += l.length;
      out.parkProps = n;
      return out;
    })()`, true);
    console.log('\n--- beaches, landmarks, park furniture -------------------');
    {
      const named = ['Alki Beach', 'Matthews Beach', 'South Beach', 'Madison Park Beach', 'West Green Lake Beach'];
      const b = places.beaches;
      console.log(`  ${Object.keys(b).length} beaches with props; ` + named.map((k) => `${k} ${b[k] ? b[k].props : 0}`).join(', '));
      console.log(`  sand: ${JSON.stringify(places.sand)}; landmarks under water: ${places.wet.join(', ') || 'none'}; park furniture ${places.parkProps}`);
      const bad = [];
      for (const k of named) if (!b[k] || b[k].props < 8) bad.push(`${k} bare`);
      for (const [k, v] of Object.entries(places.sand)) if (v < 20) bad.push(`no sand at ${k}`);
      if (places.wet.length) bad.push('landmarks under water: ' + places.wet.join(', '));
      if (places.missing.length || places.built.length) bad.push('landmarks missing: ' + [...places.missing, ...places.built].join(', '));
      if (places.parkProps < 5000) bad.push('park furniture not loaded');
      if (bad.length) {
        console.error(`FAIL: places: ${bad.join('; ')}`);
        process.exitCode = 1;
      }
    }

    // --- the hot air balloon ----------------------------------------------
    //
    // At Jefferson Park, flown at a fixed dt through player.update: it rises
    // on the burner, drifts with the wind, holds a height on short burns,
    // lands on the vent without damage, and its envelope stays out of a tower
    // it is driven into.
    const bal = await session.eval(`(() => {
      const d = window.__dbg, P = d.player;
      const b = d.traffic.cars.find((v) => v.spec.balloon);
      if (!b) return null;
      if (P.vehicle) P.exitVehicle(true);
      P.x = b.x + 2; P.z = b.z + 1; P.y = b.y;
      P.enterVehicle(b);
      const x0 = b.x, z0 = b.z, y0 = b.y;
      const step = (n, inp) => { for (let i = 0; i < n; i++) {
        P.update(1 / 60, Object.assign({ x: 0, y: 0, gas: false, brake: false, hand: false }, inp), { x: 0, y: 0 }, d.controls, d.traffic, d.peds);
        d.world.update(b.x, b.z, 2); } };
      const out = {};
      step(300, { gas: true, gasAmt: 1 }); step(900, {});
      out.climbed = +(b.y - y0).toFixed(1);
      // hold: a 1 s burn every 10.5 s (the duty that balances the envelope's
      // cooling at its floating temperature). Let the climb settle for 40 s,
      // then it should stay put for the next minute.
      for (let k = 0; k < 4; k++) { step(60, { gas: true, gasAmt: 1 }); step(570, {}); }
      const yh = b.y;
      for (let k = 0; k < 6; k++) { step(60, { gas: true, gasAmt: 1 }); step(570, {}); }
      out.holdDrift = +(b.y - yh).toFixed(1);
      out.drifted = Math.round(Math.hypot(b.x - x0, b.z - z0));
      step(2400, { brake: true, brakeAmt: 1 });
      step(1200, {});
      out.landed = !b.airborne;
      out.health = b.health;
      // the envelope and a tower: the tallest box within 600 m of downtown
      let tw = null;
      for (const q of d.city.buildingsNear(0, 0, 600)) if (!tw || q.h > tw.h) tw = q;
      const top = (tw.base != null ? tw.base : tw.y);
      // start clear of the footprint whatever its rotation
      b.x = tw.x + Math.hypot(tw.w, tw.d) / 2 + 15; b.z = tw.z; b.y = top + 20; b.vy = 0; b.airborne = true; b.heat = 62;
      let worst = Infinity;
      for (let i = 0; i < 400; i++) {
        const dx = tw.x - b.x, dz = tw.z - b.z, l = Math.hypot(dx, dz) || 1;
        b.x += dx / l * 0.3; b.z += dz / l * 0.3;       // shoved at 18 m/s
        step(1, {});
        const c = Math.cos(-tw.rot), s = Math.sin(-tw.rot), ex = b.x - tw.x, ez = b.z - tw.z;
        const lx = ex * c - ez * s, lz = ex * s + ez * c;
        const qx = Math.max(-tw.w / 2, Math.min(tw.w / 2, lx)), qz = Math.max(-tw.d / 2, Math.min(tw.d / 2, lz));
        worst = Math.min(worst, Math.hypot(lx - qx, lz - qz));
      }
      out.towerClear = +worst.toFixed(2);
      out.tower = Math.round(tw.h);
      P.exitVehicle(true);
      return out;
    })()`, true);
    console.log('\n--- hot air balloon ---------------------------------------');
    if (!bal) { console.error('FAIL: no balloon'); process.exitCode = 1; }
    else {
      console.log(`  climbed ${bal.climbed} m in 20 s, held to ${bal.holdDrift} m over a minute of short burns, drifted ${bal.drifted} m on the wind`);
      console.log(`  vented down: landed ${bal.landed}, health ${bal.health}; driven into a ${bal.tower} m tower, the envelope kept ${bal.towerClear} m off it`);
      const bad = [];
      if (!(bal.climbed > 30)) bad.push('the burner does not lift it');
      if (Math.abs(bal.holdDrift) > 40) bad.push('short burns do not hold a height');
      if (!(bal.drifted > 60)) bad.push('the wind does not move it');
      if (!bal.landed || bal.health < 100) bad.push('venting does not land it softly');
      if (bal.towerClear < 6) bad.push('the envelope goes into a tower');
      if (bad.length) { console.error(`FAIL: balloon: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- fishing off the piers --------------------------------------------
    //
    // Every site found its deck's end; ENTER there casts and opens the game;
    // a reel banks points, a combo buys time, junk costs it, a passing fish
    // is hooked; time-up pays out; closing it gives the city back.
    const fish = await session.eval(`(async () => {
      const d = window.__dbg, F = d.fishing, P = d.player;
      if (!F) return null;
      if (P.vehicle) P.exitVehicle(true);
      const out = { spots: d.fishSpots.map((q) => q.name) };
      const sp = d.fishSpots[0];
      P.x = sp.rx; P.z = sp.rz; P.y = sp.y;
      const money0 = d.game.money;
      out.took = d.game.tryInteract(P);
      for (let i = 0; i < 300 && F.state === 'cast'; i++) await new Promise((r) => setTimeout(r, 200));
      out.title = F.state;
      F._press('A');
      F.caught = ['salmon', 'salmon', 'salmon', 'octopus']; F.time = 40; F.hookY = 32; F.reeling = true; F._play(0.05);
      out.score = F.score; out.time = +F.time.toFixed(1);
      F.caught = ['can', 'boot']; F.reeling = true; F.hookY = 32; const t0 = F.time; F._play(0.05);
      out.junk = +(F.time - t0).toFixed(1);
      F.ents = [{ kind: 'perch', x: 88, y: 60, dir: 1, sp: 0, w: 12, h: 6, ph: 0 }]; F.hookY = 60; F.reeling = false; F._play(0.016);
      out.hooked = F.caught.join(',');
      F.time = 0.01; F._play(0.05);
      out.over = F.state; out.paid = d.game.money - money0;
      F.close();
      out.closed = F.state; out.paused = d.game.paused; out.rod = sp.prop.userData.rod.visible;
      return out;
    })()`, true);
    console.log('\n--- fishing ------------------------------------------------');
    if (!fish) { console.error('FAIL: no fishing'); process.exitCode = 1; }
    else {
      console.log(`  spots: ${fish.spots.join(', ')}`);
      console.log(`  ENTER cast ${fish.took} -> ${fish.title}; 3 salmon + octopus banked ${fish.score} pts, time 40 -> ${fish.time} s; junk ${fish.junk} s; hooked ${fish.hooked}; time-up ${fish.over}, paid $${fish.paid}; closed ${fish.closed}, city unpaused ${!fish.paused}`);
      const bad = [];
      if (fish.spots.length < 4) bad.push('a pier has no fishing spot');
      if (!fish.took || fish.title !== 'title') bad.push('ENTER does not start it');
      if (fish.score !== 1840 || fish.time !== 54) bad.push('scoring or combo time');
      if (fish.junk !== -10) bad.push('junk penalty');
      if (fish.hooked !== 'perch') bad.push('the hook does not take a fish');
      if (fish.over !== 'over' || fish.paid !== 92) bad.push('time-up / payout');
      if (fish.closed !== 'off' || fish.paused || !fish.rod) bad.push('closing does not give the city back');
      if (bad.length) { console.error(`FAIL: fishing: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- basketball: free throws in the parks -----------------------------
    //
    // Every court found level open ground and is a platform you stand on;
    // ENTER on its free throw line starts the game; a centred shot drops,
    // a marker stopped at its end misses; ten shots end it and pay; closing
    // it gives the city back.
    const hoop = await session.eval(`(() => {
      const d = window.__dbg, H = d.hoops, P = d.player;
      if (!H) return null;
      if (P.vehicle) P.exitVehicle(true);
      const out = { courts: H.courts.map((c) => c.name) };
      out.stand = Math.max(...H.courts.map((c) => Math.abs(d.city.groundAt(c.ft.x, c.ft.z, c.y + 0.5) - c.y)));
      const c = H.courts[0];
      P.x = c.ft.x; P.z = c.ft.z; P.y = c.y;
      const money0 = d.game.money;
      out.took = d.game.tryInteract(P);
      out.state = H.state; out.paused = d.game.paused;
      const shoot = (ea, ep) => {
        H.update(1 / 60); H.aimLock = ea; H.powLock = ep; H._shoot();
        let n = 0; while (!H.result && n < 600) { H.update(1 / 60); n++; }
        const r = H.result.made;
        while (H.state === 'flight' && n < 900) { H.update(1 / 60); n++; }
        return r;
      };
      out.made = [shoot(0, 0), shoot(0.1, -0.1), shoot(-0.1, 0.1)];
      out.missed = [shoot(1, 0), shoot(0, -1), shoot(0, 1)];
      for (let i = 0; i < 4; i++) shoot(0, 0);
      out.end = H.state; out.score = H.made; out.paid = d.game.money - money0;
      H.close();
      out.closed = H.state; out.after = d.game.paused;
      return out;
    })()`, true);
    console.log('\n--- basketball ---------------------------------------------');
    if (!hoop) { console.error('FAIL: no basketball'); process.exitCode = 1; }
    else {
      console.log(`  courts: ${hoop.courts.join(', ')}; standing on the line within ${hoop.stand.toFixed(2)} m`);
      console.log(`  ENTER ${hoop.took} -> ${hoop.state}; green-zone shots ${hoop.made}; wild ones ${hoop.missed}; after ten ${hoop.end}, ${hoop.score} made, paid $${hoop.paid}; closed ${hoop.closed}, city unpaused ${!hoop.after}`);
      const bad = [];
      if (hoop.courts.length < 4) bad.push('a park has no court');
      if (hoop.stand > 0.05) bad.push('the court is not what you stand on');
      if (!hoop.took || hoop.state !== 'aim' || !hoop.paused) bad.push('ENTER does not start it');
      if (hoop.made.some((m) => !m)) bad.push('a good shot missed');
      if (hoop.missed.some((m) => m)) bad.push('a wild shot went in');
      if (hoop.end !== 'done' || hoop.score !== 7 || hoop.paid <= 0) bad.push('the round does not end or pay');
      if (hoop.closed !== 'off' || hoop.after) bad.push('closing does not give the city back');
      if (bad.length) { console.error(`FAIL: basketball: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- up the Space Needle ----------------------------------------------
    //
    // ENTER at the core rides the elevator to the deck, which you stand on;
    // walking out into the barriers and in at the indoor glass keeps you on
    // the ring; a viewer zooms and names what it sees; the elevator brings
    // you back down to the plaza.
    const ndl = await session.eval(`(() => {
      const d = window.__dbg, N = d.needleTop, P = d.player;
      if (!N) return null;
      if (P.vehicle) P.exitVehicle(true);
      const out = { dropped: (d.lmRoot.userData.solidsDropped || []).filter((s) => s.startsWith('spaceNeedle')) };
      const r = () => Math.hypot(P.x - N.X, P.z - N.Z);
      const b = N.pt(N.views[0].a - Math.PI / 6, 5.6);
      P.x = b.x; P.z = b.z; P.y = d.city.groundAt(b.x, b.z, N.Y + 1);
      out.up = N.tryInteract(P) && N.mode;
      let n = 0; while (N.busy && n < 3000) { N.update(1 / 60, { x: 0, y: 0 }, { x: 0, y: 0 }); n++; }
      out.rideS = +(n / 60).toFixed(1);
      out.onDeck = +(P.y - N.deckY).toFixed(2);
      out.stand = +Math.abs(d.city.groundAt(P.x, P.z, P.y + 0.5) - N.deckY).toFixed(2);
      const inp = (x, y) => ({ x, y, gas: false, brake: false, gasAmt: 0, brakeAmt: 0, sprint: false, jump: false, attack: false });
      const walk = (x, y, k) => { for (let i = 0; i < k; i++) P.update(1 / 60, inp(x, y), { x: 0, y: 0 }, d.controls, d.traffic, d.peds); };
      let rMin = 99, rMax = 0, yLo = 1e9;
      const note = () => { rMin = Math.min(rMin, r()); rMax = Math.max(rMax, r()); yLo = Math.min(yLo, P.y); };
      P.camYaw = P.heading + Math.PI; for (let i = 0; i < 200; i++) { walk(0, -1, 1); note(); }
      P.camYaw = P.heading; for (let i = 0; i < 260; i++) { walk(0, -1, 1); note(); }
      for (let i = 0; i < 900; i++) { walk(1, -0.2, 1); note(); }
      out.ring = [+rMin.toFixed(2), +rMax.toFixed(2)];
      out.fell = +(N.deckY - yLo).toFixed(2);
      const v = N.views[2];
      P.x = v.x; P.z = v.z; P.y = N.deckY;
      out.view = N.tryInteract(P) && N.mode;
      N.zoomIn = true; for (let i = 0; i < 60; i++) N.update(1 / 60, { x: 0, y: 0 }, { x: 0, y: 0 }); N.zoomIn = false;
      out.fov = +d.camera.fov.toFixed(1);
      out.label = N.ui.sub.textContent;
      N.endView();
      out.fovBack = d.camera.fov;
      P.x = N.door.x; P.z = N.door.z; P.y = N.deckY;
      out.down = N.tryInteract(P) && N.mode;
      n = 0; while (N.busy && n < 3000) { N.update(1 / 60, { x: 0, y: 0 }, { x: 0, y: 0 }); n++; }
      out.ground = +(P.y - N.Y).toFixed(2);
      out.visible = P.h.group.visible;
      return out;
    })()`, true);
    console.log('\n--- Space Needle ------------------------------------------');
    if (!ndl) { console.error('FAIL: no Space Needle deck'); process.exitCode = 1; }
    else {
      console.log(`  ENTER at the core: ${ndl.up}, ${ndl.rideS} s to the deck; standing ${ndl.onDeck} m off it (ground query ${ndl.stand} m)`);
      console.log(`  walked into the barriers, the glass and round: r ${ndl.ring[0]}-${ndl.ring[1]} m, dropped ${ndl.fell} m; viewer ${ndl.view}, zoomed to ${ndl.fov} deg ("${ndl.label}"), fov back ${ndl.fovBack}; down: ${ndl.down}, ${ndl.ground} m over the plaza, visible ${ndl.visible}`);
      const bad = [];
      if (ndl.dropped.length) bad.push(`solids dropped: ${ndl.dropped.join(', ')}`);
      if (ndl.up !== 'ride' || Math.abs(ndl.onDeck) > 0.05 || ndl.stand > 0.05) bad.push('the ride up does not land on the deck');
      if (ndl.ring[0] < 13.6 || ndl.ring[1] > 16.3 || ndl.fell > 0.05) bad.push('the deck does not hold you');
      if (ndl.view !== 'view' || ndl.fov >= 9 || !/°/.test(ndl.label) || ndl.fovBack < 30) bad.push('the viewer');
      if (ndl.down !== 'ride' || Math.abs(ndl.ground) > 1.5 || !ndl.visible) bad.push('the ride down');
      if (bad.length) { console.error(`FAIL: Space Needle: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- the flying fish at Pike Place -----------------------------------
    //
    // The arcade's frontage is at street level and walkable (it stood in a
    // portal cutting's pit behind a lid barrier, and its pavement was never
    // drawn); ENTER at the stall starts it; a catcher who stands under each
    // fish and closes on it catches every one; hands off, three on the floor
    // ends it; it pays; closing gives the city back.
    const toss = await session.eval(`(() => {
      const d = window.__dbg, F = d.fishToss, P = d.player, T = d.THREE;
      if (!F) return null;
      if (P.vehicle) P.exitVehicle(true);
      const U = [-0.748, -0.664], W = [-0.664, 0.748], A = [-198, 297];
      const SO = (s, o) => [A[0] + U[0] * s + W[0] * o, A[1] + U[1] * s + W[1] * o];
      const out = {};
      // walk from the carriageway to the arcade's face at three places along it
      const inp = (x, y) => ({ x, y, gas: false, brake: false, gasAmt: 0, brakeAmt: 0, sprint: false, jump: false, attack: false });
      const rc = new T.Raycaster();
      out.walks = [];
      for (const s0 of [2, 30, 60]) {
        const [x, z] = SO(s0, 1.5);
        const pend = () => [...d.world.chunks.values()].filter((k) => k.lod !== k.wantLod).length;
        for (let i = 0; i < 2000 && pend() > 0; i++) d.world.update(x, z, 60);
        F.updateWorld(0, x, z); d.scene.updateMatrixWorld(true);
        P.x = x; P.z = z; P.y = d.city.groundAt(x, z, 60);
        P.heading = Math.atan2(W[0], W[1]); P.camYaw = P.heading + Math.PI;
        let drop = 0, worst = 0, o = 0;
        for (let i = 0; i < 140; i++) {
          const y0 = P.y;
          P.update(1 / 60, inp(0, -1), { x: 0, y: 0 }, d.controls, d.traffic, d.peds);
          drop = Math.max(drop, y0 - P.y);
          rc.set(new T.Vector3(P.x, P.y + 1.5, P.z), new T.Vector3(0, -1, 0));
          const h = rc.intersectObjects(d.scene.children, true).find((q) => q.object.visible && !P.h.group.children.includes(q.object));
          const dx = P.x - A[0], dz = P.z - A[1]; o = dx * W[0] + dz * W[1];
          if (h && o > 4.6) worst = Math.max(worst, Math.abs(P.y - h.point.y));
        }
        out.walks.push({ s: s0, o: +o.toFixed(2), fell: +drop.toFixed(2), floor: +worst.toFixed(2) });
      }
      P.x = F.spot.x; P.z = F.spot.z; P.y = d.city.groundAt(P.x, P.z, F.y + 1);
      const money0 = d.game.money;
      out.took = d.game.tryInteract(P) && F.state;
      const ctl = d.controls, read0 = ctl.read.bind(ctl); let steer = 0;
      ctl.read = () => ({ ...read0(), x: steer });
      let n = 0;
      while (F.state === 'play' && n < 60 * 70) {
        const fl = F.fish.filter((f) => f.state === 'fly').sort((a, b) => (a.T - a.age) - (b.T - b.age))[0];
        if (fl) { steer = Math.max(-1, Math.min(1, (fl.aimS - F.catchS) * 3)); if (fl.T - fl.age < 0.06 && fl.T - fl.age > 0.03 && F.t - F.grabT > 0.4) F.grab(); } else steer = 0;
        F.update(1 / 60); n++;
      }
      out.caught = F.caught; out.drops = F.drops; out.perfects = F.perfects;
      out.paid = d.game.money - money0;
      F._round(); steer = 0; n = 0;
      while (F.state === 'play' && n < 60 * 70) { F.update(1 / 60); n++; }
      out.idle = { drops: F.drops, state: F.state, t: +F.t.toFixed(1) };
      ctl.read = read0;
      F.close();
      out.closed = F.state; out.paused = d.game.paused;
      return out;
    })()`, true);
    console.log('\n--- flying fish ------------------------------------------');
    if (!toss) { console.error('FAIL: no fish stall'); process.exitCode = 1; }
    else {
      console.log(`  frontage walks (s: reached o, fell, floor vs drawn): ${toss.walks.map((w) => `${w.s}: ${w.o} m, ${w.fell} m, ${w.floor} m`).join('; ')}`);
      console.log(`  ENTER -> ${toss.took}; standing under each fish, a whole round: ${toss.caught} caught (${toss.perfects} perfect), ${toss.drops} dropped; hands off: ${toss.idle.drops} on the floor, ${toss.idle.state} at ${toss.idle.t} s; paid $${toss.paid}; closed ${toss.closed}, city unpaused ${!toss.paused}`);
      const bad = [];
      if (toss.walks.some((w) => w.fell > 0.3 || w.o < 3.9 || w.floor > 0.1)) bad.push('the frontage');
      if (toss.took !== 'play') bad.push('ENTER does not start it');
      if (toss.caught < 25 || toss.drops > 0) bad.push('a catcher under every fish drops some');
      if (toss.idle.drops !== 3 || toss.idle.state !== 'over') bad.push('three on the floor does not end it');
      if (toss.paid <= 0) bad.push('no pay');
      if (toss.closed !== 'off' || toss.paused) bad.push('closing does not give the city back');
      if (bad.length) { console.error(`FAIL: flying fish: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- kayaks on Lake Union ---------------------------------------------
    //
    // Four rentals moored at the seaplane dock's float; one paddled at fixed
    // dt: cruises at a kayak's speed, the blade goes in the water mid-stroke,
    // a paddled turn and a pivot at rest both turn, back-paddling goes astern.
    const kay = await session.eval(`(() => {
      const d = window.__dbg, P = d.player, T = d.THREE;
      const ks = d.traffic.cars.filter((v) => v.spec.kayak);
      if (!ks.length) return null;
      if (P.vehicle) P.exitVehicle(true);
      const v = ks[0], out = { n: ks.length };
      P.x = v.x; P.z = v.z; P.y = v.y + 1; P.enterVehicle(v);
      out.paddle = !!v.paddle && v.rider.group.visible;
      const run = (secs, inp) => { for (let i = 0; i < secs * 60; i++) v.update(1 / 60, inp); };
      const x0 = v.x, z0 = v.z;
      let depth = 9;
      for (let i = 0; i < 20 * 60; i++) {
        v.update(1 / 60, { throttle: 1, brake: 0, steer: 0 });
        if (v.kayak.ph > 0.2 && v.kayak.ph < 0.35) {
          const bp = new T.Vector3(v.kayak.side * 1.07, -0.07, 0).applyMatrix4(v.paddle.matrixWorld);
          depth = Math.min(depth, bp.y - d.world.waterLevelAt(bp.x, bp.z));
        }
      }
      out.cruise = +v.vLong.toFixed(2); out.dist = +Math.hypot(v.x - x0, v.z - z0).toFixed(1); out.depth = +depth.toFixed(2);
      let h = v.heading; run(6, { throttle: 1, brake: 0, steer: 1 });
      out.turn = +(((v.heading - h) * 180 / Math.PI) / 6).toFixed(1);
      run(10, { throttle: 0, brake: 0, steer: 0 });
      h = v.heading; run(5, { throttle: 0, brake: 0, steer: -1 });
      out.pivot = +(((v.heading - h) * 180 / Math.PI) / 5).toFixed(1);
      run(6, { throttle: 0, brake: 1, steer: 0 });
      out.back = +v.vLong.toFixed(2);
      P.exitVehicle(true);
      return out;
    })()`, true);
    console.log('\n--- kayaks ------------------------------------------------');
    if (!kay) { console.error('FAIL: no kayaks'); process.exitCode = 1; }
    else {
      console.log(`  ${kay.n} moored; paddled 20 s: ${kay.cruise} m/s, ${kay.dist} m, blade ${-kay.depth} m under mid-stroke; turn ${kay.turn} deg/s, pivot at rest ${kay.pivot} deg/s, back-paddling ${kay.back} m/s`);
      const bad = [];
      if (kay.n < 4 || !kay.paddle) bad.push('the rentals or the paddler');
      if (kay.cruise < 1.8 || kay.cruise > 3.2) bad.push('cruise speed');
      if (kay.depth > -0.05) bad.push('the blade does not reach the water');
      if (kay.turn < 25 || Math.abs(kay.pivot) < 25) bad.push('turning');
      if (kay.back > -1) bad.push('back-paddling');
      if (bad.length) { console.error(`FAIL: kayaks: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- the Great Wheel ---------------------------------------------------
    //
    // It turns; ENTER on the platform brings a gondola round and boards it;
    // one turn takes you ~165 ft up and back to the platform, where you step
    // off; "Down" gets you off in a fraction of that.
    const wheel = await session.eval(`(() => {
      const d = window.__dbg, W = d.wheelRide, P = d.player;
      if (!W) return null;
      if (P.vehicle) P.exitVehicle(true);
      const th0 = W.theta; for (let i = 0; i < 120; i++) W.update(1 / 60, null, null, W.hub.x, W.hub.z);
      const out = { turns: W.theta > th0 };
      P.x = W.hub.x + 3; P.z = W.hub.z; P.y = d.city.groundAt(P.x, P.z, W.deckY + 1.5);
      out.took = W.tryInteract(P) && W.mode;
      let n = 0, top = 0, boarded = null;
      while (W.busy && n < 60 * 200) {
        W.update(1 / 60, { x: 0, y: 0 }, { x: 0, y: 0 }, P.x, P.z); n++;
        if (W.mode === 'ride') { top = Math.max(top, P.y); if (boarded === null) boarded = +(P.y - W.deckY).toFixed(2); }
      }
      out.s = +(n / 60).toFixed(1); out.topFt = Math.round((top - W.deckY + 2.4) / 0.3048); out.boarded = boarded;
      out.off = { visible: P.h.group.visible, y: +(P.y - W.deckY).toFixed(2), dx: +(P.x - W.hub.x).toFixed(1) };
      W.tryInteract(P); n = 0;
      while (W.busy && n < 60 * 200) { W.update(1 / 60, { x: 0, y: 0 }, { x: 0, y: 0 }, P.x, P.z); if (W.mode === 'ride' && W.rideT > 4) W.down(); n++; }
      out.downS = +(n / 60).toFixed(1);
      return out;
    })()`, true);
    console.log('\n--- Great Wheel -------------------------------------------');
    if (!wheel) { console.error('FAIL: no Great Wheel ride'); process.exitCode = 1; }
    else {
      console.log(`  turning ${wheel.turns}; ENTER -> ${wheel.took}; a ride ${wheel.s} s, boarded ${wheel.boarded} m off the deck, ${wheel.topFt} ft at the top; off at the platform ${JSON.stringify(wheel.off)}; "Down" ${wheel.downS} s`);
      const bad = [];
      if (!wheel.turns) bad.push('the wheel does not turn');
      if (wheel.took !== 'align' || wheel.s < 80 || wheel.s > 130) bad.push('the ride');
      if (wheel.topFt < 150 || wheel.topFt > 185) bad.push('the height');
      if (!wheel.off.visible || Math.abs(wheel.off.y) > 1.5) bad.push('stepping off');
      if (wheel.downS > 45) bad.push('"Down"');
      if (bad.length) { console.error(`FAIL: Great Wheel: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- golf at Interbay ---------------------------------------------------
    //
    // A player who aims at the pin, picks the power for the distance and
    // stops the needle in the sweet spot, in still air, plays
    // the three holes: tee shots find the greens, the round ends in par or
    // near it with a card and pay; a shot into a road comes back with a
    // stroke added; closing gives the city back.
    const golfR = await session.eval(`(() => {
      const d = window.__dbg, Gf = d.golf, P = d.player;
      if (!Gf) return null;
      if (P.vehicle) P.exitVehicle(true);
      const t = Gf.holes[0].tee; P.x = t.x; P.z = t.z; P.y = d.G.terrainHeight(t.x, t.z);
      const money0 = d.game.money;
      const out = { took: d.game.tryInteract(P) && Gf.state, tees: [] };
      let guard = 0;
      while (Gf.state !== 'card' && guard < 60) {
        if (Gf.state === 'aim') {
          const h = Gf.h, dist = Math.hypot(h.pin.x - Gf.bx, h.pin.z - Gf.bz);
          Gf.wind = { x: 0, z: 0, s: 0 };        // still air: the breeze is random
          Gf.aim = Math.atan2(h.pin.x - Gf.bx, h.pin.z - Gf.bz);
          const c = [140, 118, 100, 75, 0][Gf.clubI], tee = Gf.lie === 'tee';
          const pw = Gf.clubI === 4 ? (Math.sqrt(2 * 0.62 * (dist + 0.3)) - 0.5) / 6.2 : Math.min(1, (dist * 0.9) / c);
          Gf.state = 'power'; Gf.power = pw; Gf.acc = 0.1; Gf._swing();
          let n = 0; while (Gf.state !== 'aim' && Gf.state !== 'card' && Gf.h === h && n < 60 * 40) { Gf.update(1 / 60); n++; }
          if (tee) out.tees.push(Gf.h === h && Gf.state === 'aim' ? +Math.hypot(h.pin.x - Gf.bx, h.pin.z - Gf.bz).toFixed(1) : 0);
        } else Gf.update(1 / 60);
        guard++;
      }
      out.scores = Gf.scores; out.card = Gf.state === 'card'; out.paid = d.game.money - money0;
      // out of bounds: a ball rolling onto 15th Ave W
      Gf._round(); const h = Gf.h;
      Gf._placeBall(t.x + 3, t.z);
      Gf.prev = { x: Gf.bx, z: Gf.bz };
      let rx = t.x, rz = t.z; for (let k = 0; k < 400 && !d.city.onRoad(rx, rz, 0); k++) rx += 2;
      Gf.bx = rx - 1.5; Gf.bz = rz; Gf.vel = new d.THREE.Vector3(6, 0, 0); Gf.check = 0; Gf.clubI = 3; Gf.state = 'roll';
      const s0 = Gf.strokes; let n = 0; while (Gf.state === 'roll' && n < 600) { Gf.update(1 / 60); n++; }
      out.oob = { strokes: Gf.strokes - s0, back: +Math.hypot(Gf.bx - Gf.prev.x, Gf.bz - Gf.prev.z).toFixed(2) };
      Gf.close();
      out.closed = Gf.state; out.paused = d.game.paused;
      void h;
      return out;
    })()`, true);
    console.log('\n--- golf ---------------------------------------------------');
    if (!golfR) { console.error('FAIL: no golf'); process.exitCode = 1; }
    else {
      console.log(`  ENTER -> ${golfR.took}; tee shots finish ${golfR.tees.join(', ')} m from the pin; card ${golfR.scores.join('-')} (${golfR.scores.reduce((a, b) => a + b, 0)}, par 9), paid $${golfR.paid}; into the road: +${golfR.oob.strokes} stroke, back ${golfR.oob.back} m from where it was hit; closed ${golfR.closed}, city unpaused ${!golfR.paused}`);
      const bad = [];
      if (golfR.took !== 'aim') bad.push('ENTER does not start it');
      if (!golfR.card || golfR.scores.length !== 3) bad.push('the round does not finish');
      if (golfR.tees.some((dd) => dd > 20)) bad.push('a good tee shot misses the green by 20 m');
      if (golfR.scores.reduce((a, b) => a + b, 0) > 12) bad.push('a good round scores over 12');
      if (golfR.oob.strokes !== 1 || golfR.oob.back > 0.5) bad.push('out of bounds');
      if (golfR.closed !== 'off' || golfR.paused) bad.push('closing does not give the city back');
      if (bad.length) { console.error(`FAIL: golf: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- the Belltown arcade ------------------------------------------------
    //
    // The storefront found a building face on 2nd Ave; ENTER at its door opens
    // the room; a credit costs $1; each of the six cabinets plays 20 s of
    // mashed input without an exception; a finished game records its high
    // score; leaving gives the city back.
    const arc = await session.eval(`(() => {
      const d = window.__dbg, A = d.arcade, P = d.player;
      if (!A) return null;
      if (P.vehicle) P.exitVehicle(true);
      const out = { face: +Math.hypot(A.face.fx - d.G.toWorld(47.6143, -122.345)[0], A.face.fz - d.G.toWorld(47.6143, -122.345)[1]).toFixed(1) };
      d.game.money = Math.max(d.game.money, 20);
      P.x = A.door.x; P.z = A.door.z; P.y = A.door.y;
      out.took = d.game.tryInteract(P) && A.mode;
      const m0 = d.game.money;
      out.games = [];
      for (const c of A.cards) {
        A._insert(c.gm);
        let err = null;
        try {
          for (let n = 0; n < 60 * 20 && A.mode === 'play'; n++) {
            A._keys = { left: n % 97 < 40, right: n % 97 > 60, up: n % 53 < 20, down: n % 71 > 60, a: n % 12 < 6, b: n % 200 < 30 };
            A.update(1 / 60);
          }
        } catch (e) { err = String(e); }
        out.games.push({ id: c.gm.id, score: A.game ? A.game.score : -1, err });
        A._toRoom();
      }
      out.charged = m0 - d.game.money;
      // a finished game records its score
      A._insert(A.cards[2].gm); A.game.score = 4321; A.game.over = true; A.game.result = 'GAME OVER'; A.update(1 / 60);
      out.hi = A.hi.serpent;
      A.close();
      out.closed = A.mode; out.paused = d.game.paused;
      return out;
    })()`, true);
    console.log('\n--- arcade -------------------------------------------------');
    if (!arc) { console.error('FAIL: no arcade'); process.exitCode = 1; }
    else {
      console.log(`  storefront ${arc.face} m from 2nd Ave at Bell; ENTER -> ${arc.took}; charged $${arc.charged} for ${arc.games.length} credits`);
      console.log(`  ${arc.games.map((g) => `${g.id} ${g.score}${g.err ? ' ERROR ' + g.err : ''}`).join(', ')}; high score kept ${arc.hi}; closed ${arc.closed}, city unpaused ${!arc.paused}`);
      const bad = [];
      if (arc.face > 60) bad.push('the storefront is not on 2nd Ave');
      if (arc.took !== 'room') bad.push('ENTER does not open it');
      if (arc.charged !== arc.games.length) bad.push('a credit is not $1');
      if (arc.games.some((g) => g.err)) bad.push('a cabinet threw');
      if (arc.hi !== 4321) bad.push('the high score is not kept');
      if (arc.closed !== 'off' || arc.paused) bad.push('leaving does not give the city back');
      if (bad.length) { console.error(`FAIL: arcade: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- no lake in the boat's cockpit ------------------------------------
    //
    // The runabout's cockpit floor is 12 cm over its waterline and the lake is
    // one flat plane, so the bow rising through the hump put the floor 12 cm
    // under it and the lake drew between the seats. A boat at fixed dt: full
    // throttle through the hump, a hard turn each way, throttle cut; the
    // floor's corners must stay over the local water throughout.
    const boat = await session.eval(`(() => {
      const d = window.__dbg, THREE = d.THREE;
      const v = d.traffic.cars.find((c) => c.spec && c.spec.hand === 'boat');
      if (!v || !v.spec.cockpit) return null;
      const [fy, z0, z1, hw] = v.spec.cockpit;
      const saved = { x: v.x, z: v.z, y: v.y, heading: v.heading, mode: v._mode, pitch: v.pitch, roll: v.roll };
      v._mode = 'player';
      const p = new THREE.Vector3();
      let worst = Infinity;
      for (let i = 0; i < 1100; i++) {
        const t = i * 0.02;
        v.update(0.02, { throttle: t < 18 ? 1 : 0, brake: 0, steer: t > 8 && t < 12 ? 1 : t > 13 && t < 17 ? -1 : 0 });
        v.group.updateMatrixWorld(true);
        const wl = d.world.waterLevelAt(v.x, v.z);
        for (const [x, z] of [[-hw, z0], [hw, z0], [-hw, z1], [hw, z1]]) {
          p.set(x, fy, z); v.tilt.localToWorld(p);
          worst = Math.min(worst, p.y - wl);
        }
      }
      Object.assign(v, { x: saved.x, z: saved.z, y: saved.y, heading: saved.heading, pitch: saved.pitch, roll: saved.roll, vLong: 0, vLat: 0 });
      v._mode = saved.mode;
      v.sync();
      return worst;
    })()`, true);
    console.log('\n--- boat ------------------------------------------------');
    if (boat === null) {
      console.error('FAIL: no moored runabout to drive');
      process.exitCode = 1;
    } else {
      console.log(`  cockpit floor, lowest over the water through hump and turns: ${(boat * 100).toFixed(1)} cm`);
      if (boat < 0) {
        console.error('FAIL: the lake draws inside the boat');
        process.exitCode = 1;
      }
    }

    // --- decks: DECK_REACH must not strand anyone ---------------------------
    //
    // groundAt's reach shrank from 2.6 m to 0.9 m above the caller's reference
    // height, which fixed cars being picked up by overpasses they drive under.
    // But every caller with a curY shares it -- pedestrians and the vehicle's
    // own wheel and lookahead samplers -- so the two things that would break
    // are riding a viaduct and getting onto one. Both are asserted rather than
    // reasoned about.
    const decks = await session.eval(`(() => {
      const d = window.__dbg, city = d.city, G = d.G;
      let rode = 0, fell = 0, cases = 0, failed = 0;
      for (const e of city.edges) {
        if (!e.elev || e.len < 30) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        let cur = a.y + 0.6;
        const n = Math.max(6, Math.floor(e.len / 3));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          // The DRAWN deck. A graded span is not a straight line between its
          // node heights -- it bends over what it crosses and eases into its
          // neighbours -- so a car riding it exactly was reported as falling
          // off a chord nobody draws (85 of 131 "falls", all on the profile).
          const deck = e.ph ? city.profAt(e, t).h - 0.09 : a.y + (b.y - a.y) * t;
          const y = city.groundAt(x, z, cur, city.roadLift(x, z));
          rode++;
          if (y < deck - 1.0) fell++;
          cur = y + 0.6;
        }
      }
      for (const e of city.edges) {
        if (!e.elev) continue;
        for (const [nid, oid] of [[e.a, e.b], [e.b, e.a]]) {
          const nd = city.nodes[nid];
          let g = null;
          for (const ei of nd.e) {
            const c = city.edges[ei];
            if (c === e || c.elev || c.tunnel || c.len < 12) continue;
            g = c; break;
          }
          if (!g) continue;
          cases++;
          const far = city.nodes[g.a === nid ? g.b : g.a], o = city.nodes[oid];
          const pts = [];
          for (let k = 10; k >= 0; k--) {
            const t = k / 10 * Math.min(1, 20 / g.len);
            pts.push([far.x + (nd.x - far.x) * (1 - t), far.z + (nd.z - far.z) * (1 - t)]);
          }
          for (let k = 1; k <= 10; k++) {
            const t = k / 10 * Math.min(1, 20 / e.len);
            pts.push([nd.x + (o.x - nd.x) * t, nd.z + (o.z - nd.z) * t]);
          }
          // Start where a car on that road stands. A GRADED approach starts on
          // its own profile where the walk starts, 20 m in from the far node:
          // seeded at the terrain, one on a fill had already climbed past
          // groundAt's reach before a single step. A draped one starts on the
          // ROAD, not on terrainHeight: where a portal cutting digs under an
          // approach, the road rides a lid (world.buildLids) at its own grade
          // and terrainHeight is the trench floor below it. Asked from the raw
          // grade, groundAt answers whichever is the road.
          const t0 = 1 - Math.min(1, 20 / g.len);
          const tg = g.a === nid ? 1 - t0 : t0;
          let cur = (g.ph
            ? city.profAt(g, tg).h - 0.09
            : city.groundAt(far.x, far.z, G.terrainRaw(far.x, far.z) + 0.6, city.roadLift(far.x, far.z))) + 0.6, y = cur;
          for (const [x, z] of pts) { y = city.groundAt(x, z, cur, city.roadLift(x, z)); cur = y + 0.6; }
          // Judged against the DRAWN deck 20 m in, as the riding check is: a
          // graded span bows below the chord between its node heights, and a
          // car riding it exactly was reported as failing to climb to a line
          // nobody draws. Draped decks read exactly as before.
          const tIn = Math.min(1, 20 / e.len), tE = e.a === nid ? tIn : 1 - tIn;
          const want = e.ph ? city.profAt(e, tE).h - 0.09 : nd.y + (o.y - nd.y) * tIn;
          if (y < want - 1.0) failed++;
        }
      }
      return { rode, fell, cases, failed };
    })()`, true);
    console.log('\n--- decks -----------------------------------------------');
    console.log(`  riding viaducts: ${decks.fell} of ${decks.rode} samples fell through`);
    console.log(`  driving onto one: ${decks.failed} of ${decks.cases} approaches failed to climb`);
    if (decks.fell > 0 || decks.failed > 0) {
      console.error(`FAIL: DECK_REACH strands drivers (${decks.fell} fell, ${decks.failed} could not climb)`);
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
      // Getting in tunes a random station: five cars, how many stations?
      const seen = new Set();
      for (let k = 0; k < 5; k++) {
        if (v) d.player.enterVehicle(v);
        seen.add(d.audio.stationName());
        if (k < 4) { d.player.exitVehicle(); await new Promise(r => setTimeout(r, 300)); }
      }
      // Then every live station through the game's own path (tuned in a car;
      // audio.update starts the stream): does it play within 14 s?
      const m = await import('./src/audio.js');
      const out = [];
      for (let i = 0; i < m.STATION_NAMES.length; i++) {
        if (!m.STATION_NAMES[i].live) continue;
        if (!d.audio.playable(i)) { out.push([m.STATION_NAMES[i].name, 'not playable in this browser']); continue; }
        d.audio.setStation(i);
        const t0 = Date.now();
        while (!d.audio.liveOn && Date.now() - t0 < 14000) await new Promise(r => setTimeout(r, 250));
        const ok = d.audio.liveOn;
        if (ok) await new Promise(r => setTimeout(r, 1500));
        out.push([m.STATION_NAMES[i].name, ok ? 'live in ' + ((Date.now() - t0 - 1500) / 1000).toFixed(1) + ' s' : 'no sound (synth covers)',
          i === 0 ? d.audio._nowPlaying : undefined]);
      }
      return { stations: out, random: [...seen] };
    })()`, true);
    console.log(`  getting in picks: ${radioOn.random.join(', ')}`);
    for (const [n, r, track] of radioOn.stations) console.log(`  ${n.padEnd(26)} ${r}${track ? '  (' + track + ')' : ''}`);
    // live streams are other people's servers: reported, not failed. The
    // random pick is ours.
    if (radioOn.random.length < 2) { console.error('FAIL: every car got the same station'); process.exitCode = 1; }

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
    // Only ever SET a failure here: `bad.length ? 1 : 0` wiped out every
    // FAIL above whenever the console was clean, so verify exited 0 on them.
    if (bad.length) process.exitCode = 1;
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('verify failed:', e.message); process.exitCode = 1; });
