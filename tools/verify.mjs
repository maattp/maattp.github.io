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
      // service: seven minutes at fixed dt
      const T = m.trains, arr = { blue: 0, red: 0 }, trips = [], was = {};
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
      console.log(`  driven: ${typeof mono.drive === 'string' ? mono.drive : `at ${mono.drive.at}, ${mono.drive.left.toFixed(2)} m from the mark, "${mono.drive.said}", off onto the platform ${mono.drive.platform !== null && Math.abs(mono.drive.platform) < 0.05}`}`);
      const bad = [];
      if (mono.columns < 45) bad.push('too few columns');
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
    // Only ever SET a failure here: `bad.length ? 1 : 0` wiped out every
    // FAIL above whenever the console was clean, so verify exited 0 on them.
    if (bad.length) process.exitCode = 1;
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('verify failed:', e.message); process.exitCode = 1; });
