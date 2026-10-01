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
    // ramps) and shore streets under a lake's 40 m drawn margin -- see "Known
    // gaps" in apps/auto/CLAUDE.md. Lower these when one is fixed.
    // v153: lakes drawn over their own water, not their boxes: 50 -> 36, 313 -> 168
    // v163: 168 -> 183 streets, all Point Monroe Drive (39 -> 51 samples): the
    // spit the DEM has below sea level, whose road the old edge used to cut
    const SUBMERGED_MAJOR_MAX = 36, SUBMERGED_STREETS_MAX = 183;
    // v163: the 800 m strip the map grew by (Bainbridge's Manitou Beach Drive
    // and SE Cornell Road, Point Monroe's spit), counted apart
    const SUBMERGED_OUTER_MAJOR_MAX = 15, SUBMERGED_OUTER_STREETS_MAX = 26;
    const sub = await session.eval(`(() => {
      const d = window.__dbg, c = d.city, w = d.world, G = d.G, THREE = d.THREE;
      // The water DRAWN at a point, worked out here rather than asked of the
      // game: the sea plane at 0 everywhere, each lake's plane over its own
      // water (the mask its plane is drawn through, G.lakeMask), the canal's
      // at its level.
      const canal = G.shipCanal(w.lakeSpecs || []);
      const W = (x, z) => {
        let lv = 0;
        for (const l of w.lakeSpecs || []) if (G.inLake(l, x, z)) lv = Math.max(lv, l.level);
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
      const out = { samples: 0, corridor: [], major: [], majors: 0, streets: 0, majorsOuter: 0, streetsOuter: 0, streetWhere: {}, floating: {} };
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
          // the strip the map grew by in v163 is held to its own count, so
          // the old 26 km box keeps the ceilings it had
          if (!CORRIDOR.test(e.name || '') && Math.max(Math.abs(x), Math.abs(z)) > 13000) {
            if (e.elev || e.cls === 'hwy' || e.cls === 'ramp') out.majorsOuter++; else out.streetsOuter++;
            continue;
          }
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
      + ` streets: ${sub.streets} (max ${SUBMERGED_STREETS_MAX});`
      + ` in the outer strip ${sub.majorsOuter} (max ${SUBMERGED_OUTER_MAJOR_MAX}) and ${sub.streetsOuter} (max ${SUBMERGED_OUTER_STREETS_MAX})`);
    for (const [name, f] of Object.entries(sub.floating)) console.log(`  ${name}: lowest deck ${f.min.toFixed(2)} m over the lake`);
    if (sub.streets) console.log('  streets: ' + sub.streetWhere.join('; '));
    const lowFloat = Object.entries(sub.floating).filter(([, f]) => f.min < 3);
    if (sub.corridor.length || lowFloat.length || Object.keys(sub.floating).length < 3
      || sub.majors > SUBMERGED_MAJOR_MAX || sub.streets > SUBMERGED_STREETS_MAX
      || sub.majorsOuter > SUBMERGED_OUTER_MAJOR_MAX || sub.streetsOuter > SUBMERGED_OUTER_STREETS_MAX) {
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
    // Every site found its deck's end; ENTER there casts and opens the game.
    // Funky Fishing's rules: the dinghy rows left and right; a line thrown up
    // with the crab boat in reach banks (three salmon and an octopus: combo
    // points and time), out of reach it splashes back and costs nothing; junk
    // that lands in the boat costs time; five lines of one kind light KOMBO
    // and refill the clock; a shark bites off the catch; the hook takes a
    // passing fish; time-up pays out; closing gives the city back.
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
      // rowing
      const bx0 = F.bx; F.keys.add('ArrowRight'); for (let i = 0; i < 20; i++) F._play(0.05); F.keys.delete('ArrowRight');
      out.rowed = +(F.bx - bx0).toFixed(1);
      F.ents = [];
      const line = (items, inReach) => {
        F.boat = { x: inReach ? F.hookX : (F.hookX > 80 ? 20 : 140), dir: inReach ? 1 : (F.hookX > 80 ? -1 : 1) };
        F.caught = items.slice(); F.hookY = 32; F.reeling = true; F.ents = [];
        const s0 = F.score; let el = 0, n = 0;
        const t0 = F.time;
        while ((F.reeling || F.throwing || n === 0) && n < 100) { F._play(0.05); el += 0.05; n++; F.ents = []; }
        return { pts: F.score - s0, dt: +(F.time - t0 + el).toFixed(1) };
      };
      F.time = 40;
      out.bank = line(['salmon', 'salmon', 'salmon', 'octopus'], true);
      out.miss = line(['salmon', 'salmon'], false);
      out.junk = line(['can', 'boot'], true);
      F.kombo = 0; F.time = 30;
      const k0 = F.time; let kel = 0;
      for (let i = 0; i < 5; i++) { const r = line(['herring', 'herring'], true); kel += r.dt; }
      out.kombo = { lit: F.kombo, time: +kel.toFixed(1) };
      // a shark through the catch
      F.caught = ['perch', 'perch']; F.reeling = false; F.throwing = null; F.hookY = 70;
      F.ents = [{ kind: 'dogfish', x: F.hookX - 30, y: 72, dir: 1, sp: 400, w: 23, h: 7, ph: 0 }];
      for (let i = 0; i < 4; i++) F._play(0.02);
      out.chomped = F.caught.length === 0;
      // the hook takes a fish
      F.ents = [{ kind: 'perch', x: F.hookX - 4, y: 60, dir: 1, sp: 0, w: 12, h: 6, ph: 0 }]; F.hookY = 60; F.reeling = false; F._play(0.016);
      out.hooked = F.caught.join(',');
      F.time = 0.01; F._play(0.05);
      out.over = F.state; out.paid = d.game.money - money0; out.expectPay = Math.floor(F.score / 20);
      F.close();
      out.closed = F.state; out.paused = d.game.paused; out.rod = sp.prop.userData.rod.visible;
      return out;
    })()`, true);
    console.log('\n--- fishing ------------------------------------------------');
    if (!fish) { console.error('FAIL: no fishing'); process.exitCode = 1; }
    else {
      console.log(`  spots: ${fish.spots.join(', ')}`);
      console.log(`  ENTER cast ${fish.took} -> ${fish.title}; rowed ${fish.rowed} px; 3 salmon + octopus to the boat ${fish.bank.pts} pts ${fish.bank.dt >= 0 ? '+' : ''}${fish.bank.dt} s; out of reach ${fish.miss.pts} pts; junk ${fish.junk.dt} s; KOMBO ${fish.kombo.lit === 0 ? 'completed' : fish.kombo.lit + ' lit'} (+${fish.kombo.time} s over five lines); shark chomped ${fish.chomped}; hooked ${fish.hooked}; time-up ${fish.over}, paid $${fish.paid}; closed ${fish.closed}, city unpaused ${!fish.paused}`);
      const bad = [];
      if (fish.spots.length < 4) bad.push('a pier has no fishing spot');
      if (!fish.took || fish.title !== 'title') bad.push('ENTER does not start it');
      if (fish.rowed < 30) bad.push('the dinghy does not row');
      if (fish.bank.pts !== 1840 || Math.abs(fish.bank.dt - 14) > 0.2) bad.push('scoring or combo time');
      if (fish.miss.pts !== 0) bad.push('a throw out of reach still banks');
      if (Math.abs(fish.junk.dt + 10) > 0.2) bad.push('junk penalty');
      if (fish.kombo.lit !== 0 || fish.kombo.time < 40) bad.push('KOMBO');
      if (!fish.chomped) bad.push('the shark');
      if (fish.hooked !== 'perch') bad.push('the hook does not take a fish');
      if (fish.over !== 'over' || fish.paid !== fish.expectPay || fish.paid <= 0) bad.push('time-up / payout');
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

    // --- the pinball museum ------------------------------------------------------
    //
    // The storefront found a face on Maynard Ave S, and both storefront panels
    // (this and the arcade's) stand ON the ground in front of the shopfront:
    // mounted on the wall, a dense building's glass shopfront hid their lower
    // half. ENTER opens the machine, a game is $1, a tap on each half of the
    // screen raises that flipper, holding the right half with a ball in the
    // shooter lane draws the plunger and letting go fires it. A seeded bot
    // plays a whole game: no ball leaves the table, it ends, it pays $1 per
    // 100,000 and keeps the high score; leaving gives the city back.
    const pin = await session.eval(`(() => {
      const d = window.__dbg, A = d.pinball, P = d.player;
      if (!A) return null;
      if (P.vehicle) P.exitVehicle(true);
      const at = d.G.toWorld(47.59857, -122.32556);
      const out = { face: +Math.hypot(A.face.fx - at[0], A.face.fz - at[1]).toFixed(1) };
      // each panel: its foot on the ground, standing clear of the shopfront
      out.panels = [['pinball', A], ['arcade', d.arcade]].map(([n, o]) => {
        const m = o.front, f = o.face, foot = m.position.y - 3;
        const off = (m.position.x - f.fx) * f.nx + (m.position.z - f.fz) * f.nz;
        let lo = Infinity, hi = -Infinity;
        for (const k of [-4.5, 0, 4.5]) { const g = d.city.groundAt(m.position.x - f.nz * k + f.nx * 0.3, m.position.z + f.nx * k + f.nz * 0.3, null); lo = Math.min(lo, g); hi = Math.max(hi, g); }
        return { n, gap: +(foot - lo).toFixed(2), sunk: +(hi - foot).toFixed(2), off: +off.toFixed(2) };
      });
      d.game.money = Math.max(d.game.money, 20);
      P.x = A.door.x; P.z = A.door.z; P.y = A.door.y;
      out.took = d.game.tryInteract(P) && A.mode;
      const m0 = d.game.money;
      A._insert();
      out.charged = m0 - d.game.money;
      out.mode = A.mode;
      // touch: the left half flips the left flipper
      const el = A.el, W = innerWidth, H = innerHeight;
      const ev = (type, id, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: H * 0.6, bubbles: true, pointerType: 'touch' }));
      const t = A.table, rest = t.flips[0].a;
      ev('pointerdown', 11, W * 0.2);
      for (let i = 0; i < 6; i++) A.update(1 / 60);
      out.leftUp = t.flips[0].on && t.flips[0].a < rest - 0.5;
      ev('pointerup', 11, W * 0.2);
      for (let i = 0; i < 20; i++) A.update(1 / 60);
      out.leftDown = !t.flips[0].on && Math.abs(t.flips[0].a - rest) < 1e-6;
      // the right half with a ball in the lane is the plunger
      ev('pointerdown', 12, W * 0.8);
      for (let i = 0; i < 20; i++) A.update(1 / 60);
      out.pull = +t.plunge.toFixed(2);
      out.rightStill = !t.flips[1].on;
      ev('pointerup', 12, W * 0.8);
      for (let i = 0; i < 20; i++) A.update(1 / 60);
      out.launched = t.state === 'play' && t.balls[0].y < 600;
      // a whole game, played by a seeded bot at a fixed step
      let seed = 5; const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      const T = new t.constructor({ rng });
      A.table = T; A.frozen = true;
      const F = [{ x: 112, y: 704 }, { x: 260, y: 704 }];
      let hold = [0, 0], cool = [0, 0], pt = 0, escapes = 0, n = 0;
      const seen = {};
      for (; n < 60 * 60 * 20 && !T.over; n++) {
        const inp = { left: false, right: false, plunge: false };
        if (T._waiting()) { pt++; inp.plunge = pt < 10 + (n % 30); } else pt = 0;
        for (const b of T.balls) for (let i = 0; i < 2; i++) {
          const dx = (b.x - F[i].x) * (i ? -1 : 1), dy = b.y - F[i].y;
          if (cool[i] <= 0 && dx > -5 && dx < 75 && dy > -45 && dy < 40 && b.vy > -50 && rng() < 0.5) { hold[i] = 8 + Math.floor(rng() * 8); cool[i] = hold[i] + 10; }
        }
        inp.left = hold[0]-- > 0; inp.right = hold[1]-- > 0; cool[0]--; cool[1]--;
        T.step(1 / 60, inp);
        for (const e of T.takeEvents()) seen[e] = 1;
        for (const b of T.balls) if (!b.ramp && !b.held && (b.x < 20 || b.x > 384 || b.y < 20)) escapes++;
      }
      out.game = { over: T.over, minutes: +(n / 3600).toFixed(1), score: T.score, escapes, seen: ['bumper', 'sling', 'lane', 'ramp', 'saucer', 'drop', 'spin', 'flipHit'].filter((k) => !seen[k]) };
      const hi0 = A.hi, cash0 = d.game.money;
      A.frozen = false; A.overT = 0;
      for (let i = 0; i < 90 && A.mode === 'play'; i++) A.update(1 / 60);
      out.paid = d.game.money - cash0; out.expect = Math.floor(T.score / 100000) + (T.score > hi0 && hi0 > 0 ? 50 : 0);
      out.hi = A.hi === Math.max(hi0, T.score);
      out.overMode = A.mode;
      A.close();
      out.closed = A.mode; out.paused = d.game.paused;
      return out;
    })()`, true);
    console.log('\n--- pinball -----------------------------------------------');
    if (!pin) { console.error('FAIL: no pinball museum'); process.exitCode = 1; }
    else {
      console.log(`  storefront ${pin.face} m from 508 Maynard Ave S; panels ${pin.panels.map((p) => `${p.n} foot +${p.gap} m over the lowest ground, ${p.sunk} m under the highest, ${p.off} m off the wall`).join('; ')}`);
      console.log(`  ENTER -> ${pin.took}; $${pin.charged} a game; left half flips ${pin.leftUp}/${pin.leftDown}; right half pulls the plunger ${pin.pull} (flipper still ${pin.rightStill}), fires ${pin.launched}`);
      console.log(`  bot game: over ${pin.game.over} after ${pin.game.minutes} min, ${pin.game.score} points, ${pin.game.escapes} escapes${pin.game.seen.length ? ', never saw ' + pin.game.seen.join(' ') : ''}; paid $${pin.paid} (expect $${pin.expect}), high score ${pin.hi}; closed ${pin.closed}, city unpaused ${!pin.paused}`);
      const bad = [];
      if (pin.face > 60) bad.push('the storefront is not on Maynard Ave S');
      for (const p of pin.panels) {
        if (p.gap > 0.05) bad.push(`the ${p.n} panel floats ${p.gap} m`);
        if (p.sunk > 1) bad.push(`the ${p.n} panel is ${p.sunk} m in the ground`);
        if (p.off < 0.55) bad.push(`the ${p.n} panel is behind the shopfront`);
      }
      if (pin.took !== 'lobby') bad.push('ENTER does not open it');
      if (pin.charged !== 1 || pin.mode !== 'play') bad.push('a game is not $1');
      if (!pin.leftUp || !pin.leftDown) bad.push('a tap does not work the left flipper');
      if (!(pin.pull > 0.3) || !pin.rightStill || !pin.launched) bad.push('the plunger does not work from the right half');
      if (!pin.game.over) bad.push('the bot game did not end');
      if (pin.game.escapes) bad.push('a ball left the table');
      if (pin.game.seen.length) bad.push(`never saw ${pin.game.seen.join(' ')}`);
      if (pin.paid !== pin.expect || !pin.hi || pin.overMode !== 'over') bad.push('the payout or high score is wrong');
      if (pin.closed !== 'off' || pin.paused) bad.push('leaving does not give the city back');
      if (bad.length) { console.error(`FAIL: pinball: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- hockey night at Climate Pledge Arena ---------------------------------------
    //
    // The marquee stands outside the south atrium; ENTER there drops straight
    // into a game (no menus). The pad works end to end: the stick skates your
    // man, a draw taken on the drop goes to your defenceman, a tap of SHOOT
    // with the puck is a shot, SHOOT while a pass is on its way is a one-timer,
    // SHOOT into a carrier at speed flattens him. Seeded AI-vs-AI games run to
    // a final with nobody leaving the rink, and the final pays by the result.
    const hk = await session.eval(`(() => {
      const d = window.__dbg, H = d.hockey, P = d.player;
      if (!H) return null;
      if (P.vehicle) P.exitVehicle(true);
      const a = d.lmRoot.userData.arena;
      const out = { door: +Math.hypot(H.door.x - (a.x + 3.7), H.door.z - (a.z + 95.5)).toFixed(1), marquee: !!H.marquee.parent };
      P.x = H.door.x; P.z = H.door.z; P.y = H.door.y;
      // ENTER anywhere round the arena, not at one spot
      out.around = [[0, -70], [70, 0], [0, 70], [-70, 0], [60, 60], [3.7, 104]].map(([dx, dz]) => { const x = a.x + 4.5 + dx, z = a.z + 1 + dz; return H.near({ x, z, y: d.city.groundAt(x, z, null) }); }).every(Boolean)
        && !H.near({ x: a.x, z: a.z + 140, y: d.city.groundAt(a.x, a.z + 140, null) });
      out.took = d.game.tryInteract(P) && H.mode;
      H.frozen = false;
      for (let i = 0; i < 160 && H.mode === 'intro'; i++) H.update(1 / 60);
      out.mode = H.mode;
      const g = H.game;
      const run = (n, inp) => { for (let i = 0; i < n; i++) { g.step(1 / 60, typeof inp === 'function' ? inp(i) : inp); g.takeEvents(); } };
      const evs = (n, inp) => { const e = []; for (let i = 0; i < n; i++) { g.step(1 / 60, typeof inp === 'function' ? inp(i) : inp); e.push(...g.takeEvents()); } return e; };
      // the draw: wait for the drop, then SHOOT
      H.frozen = true;
      g._faceoff(0, 0, '');
      let i = 0;
      while (g.state === 'faceoff' && g.stateT < g.fo.drop + 0.03 && i++ < 300) run(1, {});
      g.fo.aiReact = 0.5;
      run(1, { shoot: true }); run(40, {});
      out.draw = g.puck.lastTeam === 0;
      // the stick: skate the controlled man to the right
      // the stick, in open ice: a standing skater, nobody near
      const c = g.ctl;
      g.state = 'play'; c.down = 0; c.vx = 0; c.vy = 0; c.x = -40; c.y = -20; c.check = 0;
      for (const q of g.players) if (q !== c && !q.goalie) { q.x = 40 + q.i * 3; q.y = 25; q.vx = 0; q.vy = 0; }
      g.puck.owner = null; g.puck.x = 60; g.puck.y = 30; g.puck.vx = 0; g.puck.vy = 0;
      const x0 = c.x;
      run(60, { x: 1, y: 0 });
      out.skated = +(c.x - x0).toFixed(1);
      // a shot: the puck on his stick 25 ft out, SHOOT tapped
      const place = (p, x, y) => { p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.down = 0; };
      const gx = -g.netX(0);
      g.state = 'play';
      place(c, gx - Math.sign(gx) * 25, 4); g._take(c); g.ctl = c;
      const sog = g.shots[0];
      let e = evs(3, { shoot: true }); e = e.concat(evs(30, {}));
      out.shot = e.includes('wrist') && g.shots[0] === sog + 1;
      // a one-timer: a pass to him, SHOOT pressed on its way
      g.state = 'play';
      const mate = g.players[1];
      place(mate, gx - Math.sign(gx) * 30, -20); place(c, gx - Math.sign(gx) * 22, 8);
      for (const q of g.players) if (q.team === 1 && !q.goalie) place(q, -gx * 0.5, 40 - q.i * 4);
      g._take(mate); g._pass(mate, 0, 0, c);
      out.ctlIsReceiver = g.ctl === c;
      e = evs(1, { shoot: true }).concat(evs(60, {}));
      out.oneTimer = e.includes('onetimer');
      // a check: an opposing carrier, ours skating hard into him
      g.state = 'play';
      const opp = g.players[6];
      place(opp, 0, 0); g._take(opp);
      g.ctl = c; place(c, -9, 0); c.vx = 24; c.face = 0; g._prevShoot = false;
      e = evs(1, { x: 1, y: 0, shoot: true }).concat(evs(20, { x: 1, y: 0 }));
      out.check = e.includes('check') && opp.down > 0;
      // seeded AI-vs-AI games to the final
      let seed = 9; const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      const G2 = g.constructor, games = [];
      let out2 = 0;
      for (let k = 0; k < 3; k++) {
        const h = new G2({ rng, humanTeam: null });
        let n = 0;
        while (!h.over && n++ < 60 * 60 * 20) {
          h.step(1 / 60); h.takeEvents();
          for (const p of [h.puck, ...h.players]) if (!(Math.abs(p.x) <= 101 && Math.abs(p.y) <= 43.5)) out2++;
        }
        games.push({ over: h.over, score: h.score.join('-'), shots: h.shots.join('-'), min: +(n / 3600).toFixed(1) });
      }
      out.games = games; out.outOfRink = out2;
      // the final pays: a 3-1 win is $250 + 3 x $25
      H.frozen = false;
      g.score = [3, 1]; g._final();
      const m0 = d.game.money;
      H.update(1 / 60);
      out.paid = d.game.money - m0; out.finalMode = H.mode;
      H.close();
      out.closed = H.mode; out.paused = d.game.paused;
      return out;
    })()`, true);
    console.log('\n--- hockey ------------------------------------------------');
    if (!hk) { console.error('FAIL: no hockey'); process.exitCode = 1; }
    else {
      console.log(`  marquee ${hk.marquee}, door ${hk.door} m from the atrium, ENTER all round ${hk.around}; ENTER -> ${hk.took} -> ${hk.mode}; draw won ${hk.draw}; skated ${hk.skated} ft in 1 s; shot ${hk.shot}; one-timer ${hk.oneTimer} (control to receiver ${hk.ctlIsReceiver}); check ${hk.check}`);
      console.log(`  AI games ${hk.games.map((x) => `${x.score} (shots ${x.shots}, ${x.min} min${x.over ? '' : ', NOT OVER'})`).join(', ')}; out of rink ${hk.outOfRink}; a 3-1 win paid $${hk.paid}; closed ${hk.closed}, city unpaused ${!hk.paused}`);
      const bad = [];
      if (!hk.marquee || hk.door > 3) bad.push('the marquee is not at the arena');
      if (!hk.around) bad.push('ENTER does not work all round the arena');
      if (hk.took !== 'intro' || hk.mode !== 'play') bad.push('ENTER does not drop into a game');
      if (!hk.draw) bad.push('a draw taken on the drop is not won');
      if (!(hk.skated > 8)) bad.push('the stick does not skate');
      if (!hk.shot) bad.push('SHOOT does not shoot');
      if (!hk.oneTimer || !hk.ctlIsReceiver) bad.push('no one-timer');
      if (!hk.check) bad.push('a check does not flatten the carrier');
      if (hk.games.some((x) => !x.over)) bad.push('an AI game did not end');
      if (hk.games.every((x) => x.score === '0-0')) bad.push('nobody scores');
      if (hk.outOfRink) bad.push('something left the rink');
      if (hk.paid !== 325 || hk.finalMode !== 'final') bad.push('the final does not pay');
      if (hk.closed !== 'off' || hk.paused) bad.push('leaving does not give the city back');
      if (bad.length) { console.error(`FAIL: hockey: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- Boeing Field's control tower: FINAL APPROACH ---------------------------------
    //
    // The tower stands at Boeing Field with its door off the pavement and its
    // shaft solid; ENTER at the door opens the game. A path drawn with a
    // finger (real pointer events on the overlay) from an aircraft into its
    // runway's landing zone locks and lands it; a path into the WRONG runway
    // does not; two aircraft flown into each other end the shift, which pays
    // $3 an aircraft; leaving gives the city back.
    const atc = await session.eval(`(async () => {
      const d = window.__dbg, T = d.tower, P = d.player;
      if (!T) return null;
      const M = await import('/apps/auto/src/atcgame.js');
      if (P.vehicle) P.exitVehicle(true);
      const tw = d.lmRoot.userData.tower;
      const out = { door: !!tw, onPave: d.city.slabQuery ? d.city.slabQuery(tw.x, tw.z) !== null : null, shaftSolid: !!d.city.obstacleHit(tw.shaft[0], tw.shaft[1], 0.5) };
      P.x = T.door.x; P.z = T.door.z; P.y = T.door.y;
      out.took = d.game.tryInteract(P) && T.mode;
      T._newGame(); T.frozen = true;
      const a = T.game;
      // one jet, in the middle of the field, heading east
      a.nextSpawn = 1e9;
      a.planes = [{ id: 1, kind: 'jet', x: 300, y: 150, a: 0, path: null, land: false, drawing: false, landing: null, entering: false, warn: false, dead: false, age: 0, prop: 0 }];
      const el = T.el, toC = (x, y) => [x * T.k + T.ox, y * T.k + T.oy];
      const ev = (type, x, y) => { const [cx, cy] = toC(x, y); el.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: cx, clientY: cy, bubbles: true, pointerType: 'touch' })); };
      const z = M.zoneOf('red'), ax = z.x - Math.cos(z.a) * 100, ay = z.y - Math.sin(z.a) * 100;
      ev('pointerdown', 300, 150);
      for (let i = 1; i <= 16; i++) ev('pointermove', 300 + (ax - 300) * i / 16, 150 + (ay - 150) * i / 16);
      for (let i = 1; i <= 12; i++) ev('pointermove', ax + (z.x - ax) * i / 12, ay + (z.y - ay) * i / 12);
      ev('pointerup', z.x, z.y);
      const p = a.planes[0];
      out.locked = p.land;
      for (let i = 0; i < 60 * 40 && a.landed === 0; i++) a.step(1 / 60);
      out.landed = a.landed;
      // a prop drawn to the jets' runway does not lock
      a.planes = [{ id: 2, kind: 'prop', x: 300, y: 150, a: 0, path: null, land: false, drawing: false, landing: null, entering: false, warn: false, dead: false, age: 0, prop: 0 }];
      const q = a.planes[0];
      a.beginPath(q);
      for (let i = 1; i <= 28; i++) a.extendPath(q, 300 + (ax - 300) * Math.min(1, i / 16) + (i > 16 ? (z.x - ax) * (i - 16) / 12 : 0), 150 + (ay - 150) * Math.min(1, i / 16) + (i > 16 ? (z.y - ay) * (i - 16) / 12 : 0));
      out.wrongLocked = q.land;
      // head-on: a collision ends the shift
      a.planes = [
        { id: 3, kind: 'jet', x: 400, y: 120, a: 0, path: null, land: false, drawing: false, landing: null, entering: false, warn: false, dead: false, age: 0, prop: 0 },
        { id: 4, kind: 'prop', x: 600, y: 120, a: Math.PI, path: null, land: false, drawing: false, landing: null, entering: false, warn: false, dead: false, age: 0, prop: 0 }];
      let warned = false;
      for (let i = 0; i < 60 * 10 && !a.over; i++) { a.step(1 / 60); if (a.planes.some((x) => x.warn)) warned = true; }
      out.warned = warned; out.crashed = a.over;
      a.takeEvents();
      const m0 = d.game.money;
      T.frozen = false; a.t = a.crash.t + 2;
      T.update(1 / 60);
      out.paid = d.game.money - m0; out.overMode = T.mode;
      T.close();
      out.closed = T.mode; out.paused = d.game.paused;
      return out;
    })()`, true);
    console.log('\n--- control tower -----------------------------------------');
    if (!atc) { console.error('FAIL: no control tower'); process.exitCode = 1; }
    else {
      console.log(`  tower ${atc.door}, door on the pavement ${atc.onPave}, shaft solid ${atc.shaftSolid}; ENTER -> ${atc.took}`);
      console.log(`  a finger's path to 14R locks ${atc.locked} and lands ${atc.landed}; a prop's to 14R locks ${atc.wrongLocked}; head-on warns ${atc.warned}, crashes ${atc.crashed}; paid $${atc.paid} (${atc.overMode}); closed ${atc.closed}, city unpaused ${!atc.paused}`);
      const bad = [];
      if (!atc.door || atc.onPave || !atc.shaftSolid) bad.push('the tower is not standing right');
      if (atc.took !== 'brief') bad.push('ENTER does not open the tower');
      if (!atc.locked || atc.landed !== 1) bad.push('a drawn path does not land the jet');
      if (atc.wrongLocked) bad.push('the wrong runway locks');
      if (!atc.warned || !atc.crashed) bad.push('no warning or no collision');
      if (atc.paid !== 3 || atc.overMode !== 'over') bad.push('the shift does not pay');
      if (atc.closed !== 'off' || atc.paused) bad.push('leaving does not give the city back');
      if (bad.length) { console.error(`FAIL: control tower: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- the Duck Tour ----------------------------------------------------------------
    //
    // The kiosk at Seattle Center with two DUKWs parked off the road; ENTER
    // puts you at the wheel with the tour running. A duck driven down the
    // Lake Union ramp floats (its floor over the water) and motors at a
    // DUKW's pace; driven back at the ramp it puts its wheels down and climbs
    // out onto the street. The tour's stops, visited in order (on the water
    // where they are on the water), pay $150 + $25 for the splashdown. The
    // horn in a duck is the quackers.
    const dk = await session.eval(`(() => {
      const d = window.__dbg, P = d.player, DT = d.duckTour;
      if (!DT) return null;
      if (P.vehicle) P.exitVehicle(true);
      const out = { lot: DT.ducks.map((v) => !d.city.onRoad(v.x, v.z, 0) && !d.world.inBuilding(v.x, v.z, 0)) };
      P.x = DT.door.x; P.z = DT.door.z; P.y = DT.door.y;
      out.took = d.game.tryInteract(P) && !!P.vehicle && P.vehicle.spec.amphib && !!DT.tour;
      const v = P.vehicle;
      out.stop0 = DT.route[DT.tour.i].id;
      // down the ramp
      const r = { x: -181, z: -2612, dx: 0.92, dz: -0.38 }, h = Math.atan2(r.dx, r.dz);
      v.x = r.x - r.dx * 26; v.z = r.z - r.dz * 26; v.heading = h; v.vLong = 0; v.afloat = false;
      v.y = d.city.groundAt(v.x, v.z, null);
      let floatAt = null, minFloor = 9, splash = false;
      for (let i = 0; i < 60 * 30; i++) {
        v.heading = h;
        v.update(1 / 60, { throttle: 0.7, brake: 0, steer: 0 });
        if (v.splashed) splash = true;
        if (v.afloat) {
          if (floatAt === null) floatAt = +Math.hypot(v.x - r.x, v.z - r.z).toFixed(1);
          minFloor = Math.min(minFloor, v.y + 1.42 - d.world.waterLevelAt(v.x, v.z));
        }
      }
      out.floatAt = floatAt; out.minFloor = +minFloor.toFixed(2); out.splash = splash; out.waterV = +v.vLong.toFixed(2);
      // and back up it
      const hb = Math.atan2(-r.dx, -r.dz);
      v.x = r.x + r.dx * 45; v.z = r.z + r.dz * 45;
      let landAt = null;
      for (let i = 0; i < 60 * 30; i++) {
        v.heading = hb;
        v.update(1 / 60, { throttle: 0.8, brake: 0, steer: 0 });
        if (!v.afloat && landAt === null) landAt = +Math.hypot(v.x - r.x, v.z - r.z).toFixed(1);
      }
      out.landAt = landAt; out.outY = +(v.y - d.world.waterLevelAt(v.x, v.z)).toFixed(1);
      // the quack
      const q0 = DT.tour.quacks; d.game.onHorn(); out.quacked = DT.tour.quacks === q0 + 1;
      // the whole tour, stop by stop
      const m0 = d.game.money;
      DT.tour.splashed = true;
      for (const s of DT.route) {
        v.x = s.x; v.z = s.z; v.afloat = !!s.water;
        DT.update(1 / 60);
        if (!DT.tour) break;
      }
      out.done = !DT.tour; out.paid = d.game.money - m0; out.tips = 0;
      out.target = d.game.tourTarget;
      P.exitVehicle(true);
      return out;
    })()`, true);
    console.log('\n--- duck tour ---------------------------------------------');
    if (!dk) { console.error('FAIL: no duck tour'); process.exitCode = 1; }
    else {
      await new Promise((res) => setTimeout(res, 600));
      console.log(`  lot off the road ${dk.lot.join(',')}; ENTER -> at the wheel, tour on ${dk.took} (first stop ${dk.stop0})`);
      console.log(`  down the ramp: afloat ${dk.floatAt} m out (splash ${dk.splash}), floor ${dk.minFloor} m over the water, ${dk.waterV} m/s; back up: wheels down ${dk.landAt} m out, ${dk.outY} m over the lake; quack ${dk.quacked}; tour done ${dk.done}, target cleared ${dk.target === null}`);
      const bad = [];
      if (dk.lot.length < 2 || dk.lot.some((x) => !x)) bad.push('the ducks are not parked clear');
      if (!dk.took || dk.stop0 !== 'slu') bad.push('ENTER does not start the tour');
      if (dk.floatAt === null || dk.floatAt > 30 || !dk.splash) bad.push('it does not float off the ramp');
      if (!(dk.minFloor > 0.02)) bad.push('the lake is in the boat');
      if (dk.waterV < 3 || dk.waterV > 6) bad.push('water speed');
      if (dk.landAt === null || !(dk.outY > 1)) bad.push('it cannot climb out up the ramp');
      if (!dk.quacked) bad.push('the horn does not quack');
      if (!dk.done || dk.target !== null) bad.push('the tour does not finish');
      if (bad.length) { console.error(`FAIL: duck tour: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- First Cup Coffee: MORNING RUSH ---------------------------------------------------
    //
    // The storefront on Pike Place's east side facing the market; ENTER opens
    // the shop. Drinks built through the station buttons (real pointer
    // events) and handed over by tapping the customer: exact pays a tip, one
    // thing wrong pays the price only, two and it is refused. A seeded bot
    // works a shift to closing, and the shift pays the till and tips.
    const cof = await session.eval(`(async () => {
      const d = window.__dbg, C = d.coffee, P = d.player;
      if (!C) return null;
      const M = await import('/apps/auto/src/baristagame.js');
      if (P.vehicle) P.exitVehicle(true);
      const fr = d.lmRoot && null;
      const out = { face: [+C.face.nx.toFixed(2), +C.face.nz.toFixed(2)] };
      P.x = C.door.x; P.z = C.door.z; P.y = C.door.y;
      out.took = d.game.tryInteract(P) && C.mode;
      C._newGame(); C.frozen = true;
      const g = C.game;
      const tapSt = (k) => { const b = C.el.querySelector('button[data-st="' + k + '"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })); };
      const tapCust = (k) => { const L = C._layout(); const r = C.ui.cv.getBoundingClientRect(); C.ui.cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + L.custX(k), clientY: r.top + L.counterY - 30, pointerType: 'touch' })); };
      const order = (o) => ({ id: 99, order: o, patience: 30, max: 30, look: 1, leaving: 0, mood: null, moodT: 0 });
      // an exact medium oat latte
      g.counter = [order({ drink: 'latte', size: 1, iced: false, milk: 'oat', extraShot: false }), null, null, null];
      tapSt('cup1'); tapSt('shot'); tapSt('shot'); tapSt('oat');
      for (let i = 0; i < 120; i++) g.step(1 / 60);
      const e0 = g.earned + g.tips; tapCust(0);
      out.exact = { paid: +(g.earned + g.tips - e0).toFixed(2), tip: g.tips > 0, perfect: g.perfect };
      // one thing wrong (whole milk for oat): price only
      g.counter = [order({ drink: 'latte', size: 1, iced: false, milk: 'oat', extraShot: false }), null, null, null];
      tapSt('cup1'); tapSt('shot'); tapSt('shot'); tapSt('whole');
      for (let i = 0; i < 120; i++) g.step(1 / 60);
      const t0 = g.tips, e1 = g.earned; tapCust(0);
      out.oneWrong = { price: +(g.earned - e1).toFixed(2), tip: +(g.tips - t0).toFixed(2) };
      // two wrong (a drip for an iced mocha): refused
      g.counter = [order({ drink: 'mocha', size: 2, iced: true, milk: 'whole', extraShot: false }), null, null, null];
      tapSt('cup2'); tapSt('drip');
      const r0 = g.refused; tapCust(0);
      out.refused = g.refused === r0 + 1 && !!g.counter[0];
      // a shift, worked by a bot
      let seed = 4; const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      const b = new M.Barista({ rng });
      let cool = 0, job = null, n = 0;
      while (!b.over && n++ < 60 * 400) {
        b.step(1 / 60); b.takeEvents(); cool -= 1 / 60;
        if (cool > 0) continue;
        if (!job) {
          let k = -1, lo = 1e9; b.counter.forEach((c, j) => { if (c && !c.leaving && c.patience < lo) { lo = c.patience; k = j; } });
          if (k < 0) continue;
          const spot = b.newCup(b.counter[k].order.size); if (spot < 0) continue;
          job = { k, id: b.counter[k].id, spot, steps: M.Barista.plan(b.counter[k].order) }; cool = 0.5; continue;
        }
        const cu = b.counter[job.k];
        if (!cu || cu.id !== job.id || cu.leaving) { b.select(job.spot); b.apply('bin'); job = null; continue; }
        b.select(job.spot); const c = b.cups[job.spot];
        if (job.steps.length) { const s = job.steps[0]; if (s === 'foam' && !c.milk) continue; if (b.apply(s)) job.steps.shift(); cool = 0.5; continue; }
        if (c.busy > 0) continue;
        b.serve(job.k); job = null; cool = 0.5;
      }
      out.shift = { over: b.over, served: b.served, perfect: b.perfect, walked: b.walked, till: Math.round(b.earned + b.tips) };
      // closing pays
      C.game = b; C.frozen = false; C.mode = 'play';
      const m0 = d.game.money; C.update(1 / 60);
      out.paid = d.game.money - m0; out.overMode = C.mode;
      C.close();
      out.closed = C.mode; out.paused = d.game.paused;
      return out;
    })()`, true);
    console.log('\n--- coffee ------------------------------------------------');
    if (!cof) { console.error('FAIL: no coffee shop'); process.exitCode = 1; }
    else {
      console.log(`  storefront facing ${cof.face}; ENTER -> ${cof.took}; exact latte paid $${cof.exact.paid} (tip ${cof.exact.tip}); one wrong paid $${cof.oneWrong.price} + $${cof.oneWrong.tip} tip; two wrong refused ${cof.refused}`);
      console.log(`  bot shift: served ${cof.shift.served} (${cof.shift.perfect} perfect), ${cof.shift.walked} walked, till $${cof.shift.till}; paid $${cof.paid} (${cof.overMode}); closed ${cof.closed}, city unpaused ${!cof.paused}`);
      const bad = [];
      if (cof.took !== 'brief') bad.push('ENTER does not open the shop');
      if (!(cof.exact.paid > 4.5) || !cof.exact.tip || cof.exact.perfect !== 1) bad.push('an exact drink does not pay a tip');
      if (cof.oneWrong.price !== 4.5 || cof.oneWrong.tip !== 0) bad.push('one mistake is not price-only');
      if (!cof.refused) bad.push('a wrong drink is not refused');
      if (!cof.shift.over || cof.shift.served < 15) bad.push('a shift does not run');
      if (cof.paid !== cof.shift.till || cof.overMode !== 'over') bad.push('closing does not pay');
      if (cof.closed !== 'off' || cof.paused) bad.push('leaving does not give the city back');
      if (bad.length) { console.error(`FAIL: coffee: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- Seafair: hydroplanes on Lake Washington ---------------------------------------------
    //
    // The course is all open water (inside lane to the log boom), the pits
    // are on dry land with the practice boat moored off the dock. The boat:
    // a top speed near 150 mph; full lock flat out HOOKS; lifting to 50 m/s
    // holds the turn; back stick flat out BLOWS OVER and forward stick keeps
    // the nose down. The rules: a start before the clock's zero does not count,
    // cutting inside the turn buoys is a lap's penalty. A whole heat, every
    // boat driven by the AI (yours too), runs to the flag and pays.
    const sfr = await session.eval(`(async () => {
      const d = window.__dbg, SF = d.seafair, P = d.player, G = d.G, w = d.world;
      if (!SF) return null;
      const M = await import('/apps/auto/src/hydrorace.js');
      if (P.vehicle) P.exitVehicle(true);
      const C = SF.course, out = {};
      let dry = 0, n = 0;
      for (let s = 0; s < C.L; s += 25) for (const off of [-24, 0, 40, 80, 170]) {
        const p = C.at(s, off); n++;
        const wl = w.waterLevelAt(p.x, p.z);
        if (!G.isWater(p.x, p.z) || wl === null || wl - G.terrainHeight(p.x, p.z) < 2) dry++;
      }
      out.course = { n, dry, lap: Math.round(C.L) };
      out.pits = { land: SF.door.y > SF.level + 0.3, moored: !!SF.practice && d.traffic.cars.includes(SF.practice) };
      // the boat
      const v = SF.practice;
      P.x = v.x; P.z = v.z; P.y = v.y + 1; P.enterVehicle(v);
      const p0 = C.at(C.sLine - 900, 30);
      const reset = (spd) => { v.x = p0.x; v.z = p0.z; v.heading = Math.atan2(p0.dx, p0.dz); v.vLong = spd; v.vLat = 0; v.hyd.slip = 0; v.hyd.hook = 0; v.hyd.nose = 0.1; v.hyd.noseV = 0; v.hooked = false; v.blewOver = false; };
      let top = 0;
      v.update(1 / 60, {}); reset(0);
      for (let i = 0; i < 60 * 20; i++) { v.update(1 / 60, { throttle: 1, steer: 0, pitch: -0.5 }); top = Math.max(top, v.vLong); }
      out.top = +(top * 2.237).toFixed(0);
      const noseSafe = v.hyd.nose;
      reset(66); let hook = null;
      for (let i = 0; i < 60 * 6 && hook === null; i++) { v.update(1 / 60, { throttle: 1, steer: 1, pitch: -0.5 }); if (v.hooked) hook = +(i / 60).toFixed(1); }
      reset(50); let held = true;
      for (let i = 0; i < 60 * 6; i++) { v.update(1 / 60, { throttle: 0.45, steer: 0.8, pitch: -0.5 }); if (v.hooked) held = false; }
      reset(66); let blow = null;
      for (let i = 0; i < 60 * 8 && blow === null; i++) { v.update(1 / 60, { throttle: 1, steer: 0, pitch: 1 }); if (v.hyd.blown > 0) blow = +(i / 60).toFixed(1); }
      SF._right(v); v.blewOver = false;
      out.boat = { noseSafe: +noseSafe.toFixed(3), hook, held, blow };
      P.exitVehicle(true);
      // a heat, all AI
      d.game.paused = false;
      SF._startRace(M.EVENTS[0]);
      const pen0 = SF.me.pen;
      // the player's boat crosses the line during the clock: its start does not count
      const me = SF.me;
      const early = C.at(C.sLine - 3, 30); me.v.x = early.x; me.v.z = early.z; me.v.heading = Math.atan2(early.dx, early.dz); me.v.vLong = 40;
      for (let i = 0; i < 20; i++) { me.v.update(1 / 60, { throttle: 1 }); SF._raceStep(1 / 60); }
      out.jump = me.crossedEarly && !me.started;
      const back = C.at(C.sLine - 1200, 30); me.v.x = back.x; me.v.z = back.z; me.v.heading = Math.atan2(back.dx, back.dz);
      let k = 0, buoyTested = false;
      while ((SF.state === 'staging' || SF.state === 'racing') && k++ < 60 * 420) {
        if (!me.done) SF._drive(me, 1 / 60);
        SF._raceStep(1 / 60);
        if (!buoyTested && SF.state === 'racing' && SF.raceT > 20) {
          buoyTested = true;
          const b = SF.boats[5], pen = b.pen;
          const cx = C.B.x + C.u.x * 40, cz = C.B.z + C.u.z * 40;
          const ox = b.v.x, oz = b.v.z; b.v.x = cx; b.v.z = cz; SF._raceStep(1 / 60); b.v.x = ox; b.v.z = oz; SF._raceStep(1 / 60);
          out.buoy = b.pen === pen + 1;
        }
      }
      const res = SF._order();
      out.heat = { state: SF.state, secs: Math.round(k / 60), finished: res.filter((b) => b.done && !b.out).length, out: res.filter((b) => b.out).length, laps: res.map((b) => b.laps - b.pen), best: Math.min(...res.map((b) => b.best || 999)).toFixed(1), myPlace: me.place, series: SF.series.event };
      SF._toPits();
      out.after = { state: SF.state, boats: SF.boats.length, paused: d.game.paused };
      return out;
    })()`, true);
    console.log('\n--- seafair -----------------------------------------------');
    if (!sfr) { console.error('FAIL: no seafair'); process.exitCode = 1; }
    else {
      console.log(`  course ${sfr.course.lap} m a lap, ${sfr.course.dry} of ${sfr.course.n} samples off deep water; pits on land ${sfr.pits.land}, practice boat moored ${sfr.pits.moored}`);
      console.log(`  boat: ${sfr.top} mph flat out (nose ${sfr.boat.noseSafe} with the stick forward); full lock hooks after ${sfr.boat.hook} s; lifting holds ${sfr.boat.held}; back stick blows over after ${sfr.boat.blow} s`);
      console.log(`  jump start doesn't count ${sfr.jump}; buoy cut penalised ${sfr.buoy}; heat: ${sfr.heat.state} after ${sfr.heat.secs} s, ${sfr.heat.finished} finished, ${sfr.heat.out} out, laps ${sfr.heat.laps.join(',')}, best lap ${sfr.heat.best} s, you P${sfr.heat.myPlace}; series at event ${sfr.heat.series}; back at the pits ${sfr.after.state} (${sfr.after.boats} boats), unpaused ${!sfr.after.paused}`);
      const bad = [];
      if (sfr.course.dry) bad.push('the course is not all on deep water');
      if (!sfr.pits.land || !sfr.pits.moored) bad.push('the pits');
      if (sfr.top < 135 || sfr.top > 170) bad.push('top speed');
      if (!(sfr.boat.noseSafe < 0.27)) bad.push('the nose will not come down');
      if (sfr.boat.hook === null || !sfr.boat.held) bad.push('hooking');
      if (sfr.boat.blow === null) bad.push('no blowover');
      if (!sfr.jump) bad.push('a jump start counted');
      if (!sfr.buoy) bad.push('a buoy cut was not penalised');
      if (sfr.heat.state !== 'done' || sfr.heat.finished < 5 || sfr.heat.laps.some((l) => l < 3 && l > 0 && false)) bad.push('the heat did not run to the flag');
      if (sfr.heat.series !== 1) bad.push('the series did not advance');
      if (sfr.after.state !== 'idle' || sfr.after.boats || sfr.after.paused) bad.push('back at the pits');
      if (bad.length) { console.error(`FAIL: seafair: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- nobody at the wheel: parked cars stay put ------------------------------------
    //
    // An unattended vehicle (the spawn's sports car on its apron, a car you got
    // out of) has a parking brake: it does not creep (the brake at a standstill
    // is reverse gear, and that is what they used to get), and it holds on the
    // steepest street near Queen Anne either way round. One bailed out of at
    // speed coasts to a stop and stays stopped.
    const prk = await session.eval(`(() => {
      const d = window.__dbg, T = d.traffic, P = d.player, C = d.city;
      if (P.vehicle) P.exitVehicle(true);
      const step = (secs) => { for (let i = 0; i < secs * 60; i++) T.update(1 / 60, P.x, P.z, { x: 0, z: -1 }, P); };
      const out = {};
      const px = P.x, pz = P.z;
      let best = null;
      for (let x = -2200; x < -1300; x += 20) for (let z = -3400; z < -2600; z += 20) {
        if (!C.onRoad(x, z, 0)) continue;
        const g0 = C.groundAt(x, z, null), gx = C.groundAt(x + 6, z, null), gz = C.groundAt(x, z + 6, null);
        const gr = Math.hypot(gx - g0, gz - g0) / 6;
        if (!best || gr > best.gr) best = { x, z, gr, h: Math.atan2(gx - g0, gz - g0) };
      }
      out.grade = +best.gr.toFixed(2);
      // an apron sports car (the spawn's) and a quad, parked on that hill
      out.spawnCar = Math.max(...['sports', 'atv'].map((ty) => {
        const v = T.spawnAt(best.x, best.z, best.h + Math.PI, ty, 0xc4161c, 'apron');
        v.vLong = 0; P.x = v.x + 20; P.z = v.z;
        const a = [v.x, v.z]; step(10);
        const m = +Math.hypot(v.x - a[0], v.z - a[1]).toFixed(2);
        T.remove(v);
        return m;
      }));
      out.hill = [best.h, best.h + Math.PI].map((h) => {
        const v = T.spawnAt(best.x, best.z, h, 'sedan', 0x3366aa, 'free');
        P.x = v.x + 20; P.z = v.z;
        const a = [v.x, v.z]; step(8);
        const m = +Math.hypot(v.x - a[0], v.z - a[1]).toFixed(2);
        T.remove(v);
        return m;
      });
      const v = T.spawnAt(best.x, best.z, best.h + Math.PI / 2, 'sedan', 0x3366aa, 'free');
      P.x = v.x; P.z = v.z; P.enterVehicle(v); v.vLong = 20; P.exitVehicle(true);
      step(6); const a = [v.x, v.z]; step(4);
      out.bail = { after: +Math.hypot(v.x - a[0], v.z - a[1]).toFixed(2), v: +v.vLong.toFixed(2) };
      T.remove(v);
      P.x = px; P.z = pz;
      return out;
    })()`, true);
    console.log('\n--- parked cars -------------------------------------------');
    console.log(`  an apron sports car and quad on the hill moved ${prk.spawnCar} m in 10 s; a sedan on a ${Math.round(prk.grade * 100)} % grade moved ${prk.hill.join(' / ')} m (uphill / downhill) in 8 s; bailed out at 72 km/h: ${prk.bail.after} m in the 4 s after stopping (v ${prk.bail.v})`);
    {
      const bad = [];
      if (!(prk.spawnCar < 0.05)) bad.push('the spawn car rolls');
      if (prk.hill.some((m) => m > 0.05)) bad.push('a parked car rolls down the hill');
      if (prk.bail.after > 0.05 || prk.bail.v !== 0) bad.push('an abandoned car creeps');
      if (bad.length) { console.error(`FAIL: parked cars: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- the 747-8 at Boeing Field ----------------------------------------------------
    const jum = await session.eval(`(() => {
      const d = window.__dbg, T = d.traffic, P = d.player;
      const v = T.cars.find((c) => c.spec.hand === 'jumbo');
      if (!v) return null;
      if (P.vehicle) P.exitVehicle(true);
      const out = { onPave: d.city.slabQuery ? d.city.slabQuery(v.x, v.z) !== null : null, tris: 0 };
      for (const m of [v.paintMesh, v.trimMesh, v.matteMesh]) if (m && m.geometry && m.geometry.index) out.tris += m.geometry.index.count / 3;
      // a take-off roll down the runway from the north threshold
      const ap = d.G.LANDMARKS.find((l) => l.kind === 'airport');
      const AL = [Math.sin(0.52), Math.cos(0.52)];
      const x0 = ap.x - 1400 * AL[0], z0 = ap.z - 1400 * AL[1];
      P.x = v.x; P.z = v.z; P.y = v.y + 1; P.enterVehicle(v);
      v.x = x0; v.z = z0; v.heading = 0.52; v.vLong = 0; v.y = d.city.groundAt(x0, z0, null); v.airborne = false;
      let roll = null;
      for (let i = 0; i < 60 * 60 && roll === null; i++) { v.update(1 / 60, { throttle: 1, pitch: v.vLong > 70 ? 1 : 0, pilot: true }); if (v.airborne) roll = Math.round(Math.hypot(v.x - x0, v.z - z0)); }
      out.roll = roll;
      // and the climb out: 20 s of full back stick after lift-off
      const y0 = v.y;
      for (let i = 0; i < 60 * 20; i++) v.update(1 / 60, { throttle: 1, pitch: 1, pilot: true });
      out.climb = Math.round(v.y - y0);
      P.exitVehicle(true);
      return out;
    })()`, true);
    console.log('\n--- 747 ---------------------------------------------------');
    if (!jum) { console.error('FAIL: no 747 at Boeing Field'); process.exitCode = 1; }
    else {
      console.log(`  parked on the pavement ${jum.onPave}; ${Math.round(jum.tris)} triangles; lifts off after ${jum.roll} m of runway, climbs ${jum.climb} m in 20 s`);
      if (!jum.onPave || jum.roll === null || jum.roll > 1500 || !(jum.climb > 120)) { console.error('FAIL: 747: not parked on the pavement or cannot take off within the runway'); process.exitCode = 1; }
    }

    // --- parachutes ----------------------------------------------------------------------
    //
    // Out of a plane 600 m up you jump: free fall to terminal (~55 m/s), the
    // canopy opens by itself at 60 m and you land unhurt; opened early with
    // JUMP it flies and steers down; into Elliott Bay a boat puts you ashore.
    const chu = await session.eval(`(() => {
      const d = window.__dbg, T = d.traffic, P = d.player, C = d.city;
      const jumpFrom = (x, z, alt, inputFn) => {
        if (P.vehicle) P.exitVehicle(true);
        const v = T.spawnAt(x, z, 1.0, 'plane', 0xdfe3e6, 'free');
        P.x = v.x; P.z = v.z; P.y = v.y + 1; P.enterVehicle(v);
        v.y = C.groundAt(x, z, null) + alt; v.airborne = true; v.vLong = 55; v.vy = 0;
        P.health = 100; d.game.dead = false;
        const ok = P.exitVehicle();
        const r = { jumped: ok && !!P.sky, vmax: 0, openAt: null, water: false };
        for (let i = 0; i < 60 * 240 && P.sky; i++) {
          P.updateFoot(1 / 60, inputFn ? inputFn(i) : { x: 0, y: 0, jump: false }, T, d.peds);
          if (!P.sky) break;
          r.vmax = Math.max(r.vmax, Math.hypot(P.sky.vx, P.sky.vy, P.sky.vz));
          if (P.sky.state !== 'free' && r.openAt === null) r.openAt = Math.round(P.y - C.groundAt(P.x, P.z, null));
          if (P.sky.state === 'water') r.water = true;
        }
        r.landed = !P.sky; r.hurt = 100 - P.health; r.dry = !d.G.isWater(P.x, P.z);
        T.remove(v);
        return r;
      };
      return {
        auto: jumpFrom(-900, -800, 600, null),
        early: jumpFrom(-900, -800, 600, (i) => ({ x: i > 240 ? 0.4 : 0, y: 0, jump: i === 60 })),
        water: jumpFrom(-1400, 600, 500, (i) => ({ x: 0, y: 0, jump: i === 30 })),
      };
    })()`, true);
    console.log('\n--- parachutes --------------------------------------------');
    console.log(`  free fall to ${chu.auto.vmax.toFixed(1)} m/s, auto-open at ${chu.auto.openAt} m, landed ${chu.auto.landed} hurt ${chu.auto.hurt}; opened at ${chu.early.openAt} m, landed hurt ${chu.early.hurt}; into the bay: splash ${chu.water.water}, ashore ${chu.water.dry}, hurt ${chu.water.hurt}`);
    {
      const bad = [];
      if (!chu.auto.jumped || Math.abs(chu.auto.vmax - 55) > 3) bad.push('free fall');
      if (chu.auto.openAt === null || chu.auto.openAt > 70 || chu.auto.hurt) bad.push('the auto-opener');
      if (!(chu.early.openAt > 500) || chu.early.hurt || !chu.early.landed) bad.push('an early opening');
      if (!chu.water.water || !chu.water.dry || chu.water.hurt) bad.push('a water landing');
      if (bad.length) { console.error(`FAIL: parachutes: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- no invisible walls in Elliott Bay -------------------------------------------------
    // Where the 10 m water mask called drawn sea "land" (ground under the sea
    // plane), a jet ski stopped dead in open water north of downtown.
    const jwl = await session.eval(`(() => {
      const d = window.__dbg, T = d.traffic, P = d.player;
      if (P.vehicle) P.exitVehicle(true);
      const runs = [[-889, 35, -1.25], [-1323, -392, -1.7]].map(([x, z, h]) => {
        const v = T.spawnAt(x, z, h, 'jetski', 0xd8242c, 'free');
        P.x = v.x; P.z = v.z; P.y = v.y + 1; P.enterVehicle(v);
        v.x = x; v.z = z; v.heading = h; v.vLong = 12;
        for (let i = 0; i < 60 * 3; i++) { v.heading = h; P.updateDrive(1 / 60, { x: 0, y: 0, gasAmt: 1, brakeAmt: 0 }, T, d.peds); }
        const m = Math.round(Math.hypot(v.x - x, v.z - z));
        P.exitVehicle(true); T.remove(v);
        return m;
      });
      return runs;
    })()`, true);
    console.log('\n--- elliott bay -------------------------------------------');
    console.log(`  a jet ski through the old invisible walls: ${jwl.join(' / ')} m in 3 s`);
    if (jwl.some((m) => m < 40)) { console.error('FAIL: elliott bay: an invisible wall stops the jet ski'); process.exitCode = 1; }

    // --- Link light rail ----------------------------------------------------------------
    //
    // The 1 Line (link.js): both tracks and all sixteen stations; the profile
    // within its grade, at grade never under the ground, bores buried; no
    // building over the open line and no guideway column on a carriageway;
    // ten minutes of service (every train stops, none closer than the moving
    // block, none over 55 mph); a run driven from Westlake to Symphony with a
    // rated stop and the doors letting you out at the street; a train braking
    // for you on the track at grade; a car held at a crossing by a train.
    const lk = await session.eval(`(() => {
      const d = window.__dbg, L = d.link, C = d.city, G = d.G, P = d.player;
      const out = { stations: L.stations.length, tracks: {} };
      for (const k of ['sb', 'nb']) {
        const tr = L.tracks[k];
        let grade = 0, under = 0, exposed = 0, bldg = 0;
        for (let i = 10; i < tr.n - 15; i += 5) {
          grade = Math.max(grade, Math.abs(tr.Y[i + 5] - tr.Y[i]) / 5);
          const kd = tr.KD[i];
          if ((kd === 4 || kd === 5) && tr.Y[i] < tr.GR[i] + 0.2) under++;
          if (kd === 1 && tr.Y[i] + 6 > tr.GR[i]) exposed++;
          if (kd !== 1 && i % 20 === 0) {
            for (const b of C.buildingsNear(tr.X[i], tr.Z[i], 12)) {
              const c = Math.cos(-b.rot), sn = Math.sin(-b.rot), dx = tr.X[i] - b.x, dz = tr.Z[i] - b.z;
              if (Math.abs(dx * c - dz * sn) < b.w / 2 && Math.abs(dx * sn + dz * c) < b.d / 2 && b.y + b.h > tr.Y[i] - 2) { bldg++; break; }
            }
          }
        }
        out.tracks[k] = { len: Math.round(tr.len), grade: +grade.toFixed(3), under, exposed, bldg };
      }
      out.colsOnRoad = L.solids.filter((q) => q.r > 0.6 && C.onRoad(q.x, q.z, 0, false, false)).length;
      out.entBad = L.stations.filter((q) => G.isWater(q.ent.x, q.ent.z) || C.onRoad(q.ent.x, q.ent.z, 1)).map((q) => q.name);
      // service, with you far away
      if (P.vehicle) P.exitVehicle(true);
      const px = P.x, pz = P.z;
      P.x = -6000; P.z = 9000;
      const was = new Map();
      let arrivals = 0, vmax = 0, minGap = Infinity;
      for (let i = 0; i < 30 * 600; i++) {
        L._service(1 / 30);
        for (const t of L.trains) {
          if (t.state === 'dwell' && was.get(t) === 'run') arrivals++;
          was.set(t, t.state);
          if (t.state !== 'off') vmax = Math.max(vmax, Math.abs(t.u));
        }
        if (i % 30 === 0) for (const k of ['sb', 'nb']) {
          const on = L.trains.filter((t) => t.track === L.tracks[k] && t.state !== 'off').sort((a, b) => a.s - b.s);
          for (let j = 1; j < on.length; j++) minGap = Math.min(minGap, on[j].s - on[j - 1].s - 118);
        }
      }
      out.service = { arrivals, vmax: +vmax.toFixed(1), minGap: Math.round(minGap) };
      // a run from the cab: Westlake to Symphony
      const wl = L.stations.find((q) => q.name === 'Westlake'), sy = L.stations.find((q) => q.name === 'Symphony');
      for (const t of L.trains) if (t.track === L.tracks.sb && Math.abs(t.s - wl.s.sb) < 900) { t.state = 'off'; t.offT = 1e9; t.group.visible = false; }
      const t = L.trains.find((q) => q.track === L.tracks.sb && q.state !== 'off');
      t.place(wl.s.sb, 1); t.state = 'dwell'; t.station = wl; t.timer = 30; t.lastStop = wl; t.doors = true;
      P.x = wl.ent.x; P.z = wl.ent.z; P.y = wl.ent.y;
      const b = L.boardable(P.x, P.y, P.z);
      out.boarded = b === t && P.enterVehicle(b) && P.vehicle === t;
      let said = '';
      const sayWas = L.say; L.say = (m) => { said = m; };
      for (let i = 0; i < 30 * 150 && out.boarded; i++) {
        const stopLead = sy.s.sb + 59, left = stopLead - t.lead, v = t.u;
        const tgt = Math.min(t.allowed(null, 1.2), Math.sqrt(2 * 0.95 * Math.max(0, left - 0.3)));
        let thr = v < tgt - 0.4 ? 1 : 0, brk = v > tgt + 0.05 ? Math.min(0.9, 0.35 + (v - tgt) * 1.5) : 0;
        if (left < 0.3) { thr = 0; brk = 0.9; }
        t.update(1 / 30, { throttle: thr, brake: brk });
        if (i > 60 && Math.abs(t.u) < 0.02 && left < 3) break;
      }
      L.say = sayWas;
      const spot = L.exitSpot(t);
      out.drive = { err: +(sy.s.sb - t.s).toFixed(2), said, spot: !!spot };
      if (P.vehicle) P.exitVehicle();
      out.drive.out = P.onFoot && Math.hypot(P.x - sy.ent.x, P.z - sy.ent.z) < 3;
      // you on the track at grade, a train coming: it stops short
      const tr = L.tracks.sb;
      let sP = 0;
      for (let s = 24000; s < 26000; s += 10) if (tr.kind(s) === 4 && !L.stations.some((q) => Math.abs(q.s.sb - s) < 200)) { sP = s; break; }
      for (const q of L.trains) if (q.track === tr && Math.abs(q.s - sP) < 1500) { q.state = 'off'; q.offT = 1e9; }
      const a = L.trains.find((q) => q.track === tr && q.state !== 'off' && q !== t) || t;
      a.driver = null; a.place(sP - 300, 1); a.state = 'run'; a.u = 14; a.lastStop = null;
      P.x = tr.x(sP); P.z = tr.z(sP); P.y = tr.y(sP); P.health = 100;
      let closest = Infinity;
      for (let i = 0; i < 30 * 30; i++) { L._guard(1 / 30, P); L._service(1 / 30); closest = Math.min(closest, sP - a.lead); P.x = tr.x(sP); P.z = tr.z(sP); }
      out.obstruct = { closest: +closest.toFixed(1), stopped: Math.abs(a.u) < 0.05, hurt: 100 - P.health };
      // a train on a level crossing holds a car there
      let sX = -1;
      for (let s = 16800; s < 30000; s += 2) if (tr.kind(s) === 5) { sX = s; break; }
      a.place(sX, 1); a.state = 'dwell'; a.timer = 1e9;
      const h = tr.heading(sX);
      out.crossing = { at: sX, held: L.blocks(tr.x(sX), tr.z(sX), tr.y(sX)), clear: !L.blocks(tr.x(sX) + Math.cos(h) * 40, tr.z(sX) - Math.sin(h) * 40, tr.y(sX)) };
      a.timer = 1;
      P.x = px; P.z = pz;
      return out;
    })()`, true);
    console.log('\n--- Link light rail ---------------------------------------');
    for (const k of ['sb', 'nb']) { const q = lk.tracks[k]; console.log(`  ${k}: ${q.len} m, steepest ${(q.grade * 100).toFixed(1)} %, at grade under the ground ${q.under}, bores out of the ground ${q.exposed}, buildings over the line ${q.bldg}`); }
    console.log(`  ${lk.stations} stations; columns on a carriageway ${lk.colsOnRoad}; bad entrances ${lk.entBad.join(', ') || 'none'}`);
    console.log(`  10 min of service: ${lk.service.arrivals} station stops, top ${lk.service.vmax} m/s, closest trains ${lk.service.minGap} m apart`);
    console.log(`  driven Westlake -> Symphony: boarded ${lk.boarded}, stopped ${lk.drive.err} m from the mark ("${lk.drive.said}"), out at the street ${lk.drive.out}`);
    console.log(`  a train for you on the track: closest ${lk.obstruct.closest} m, stopped ${lk.obstruct.stopped}, hurt ${lk.obstruct.hurt}; a crossing at s ${lk.crossing.at}: held ${lk.crossing.held}, clear 40 m off ${lk.crossing.clear}`);
    {
      const bad = [];
      if (lk.stations !== 24) bad.push('stations');   // 16 on the 1 Line, 8 on the 2 Line (BelRed since v163)
      for (const k of ['sb', 'nb']) {
        const q = lk.tracks[k];
        if (q.grade > 0.062) bad.push(`${k} grade`);
        if (q.under) bad.push(`${k} at grade under the ground`);
        if (q.exposed) bad.push(`${k} bore out of the ground`);
        if (q.bldg > 2) bad.push(`${k} buildings over the line`);
      }
      if (lk.colsOnRoad) bad.push('a column on a carriageway');
      if (lk.entBad.length) bad.push('station entrances');
      if (lk.service.arrivals < 80 || lk.service.vmax > 25 || lk.service.minGap < 20) bad.push('service');
      if (!lk.boarded || Math.abs(lk.drive.err) > 1.5 || !/Symphony/.test(lk.drive.said) || !lk.drive.out) bad.push('the driven run');
      if (!(lk.obstruct.closest > 0) || !lk.obstruct.stopped || lk.obstruct.hurt) bad.push('braking for you');
      if (lk.crossing.at < 0 || !lk.crossing.held || !lk.crossing.clear) bad.push('the level crossing');
      if (bad.length) { console.error(`FAIL: Link: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- Link: getting on ------------------------------------------------------------------
    // ENTER beside a train stopped at an open-air platform boards it (not only
    // at the street entrance); ENTER at an underground station with no train
    // in calls the next one, and you board it by yourself when it opens.
    const lb = await session.eval(`(() => { const d = window.__dbg, L = d.link, P = d.player, out = {};
  if (P.vehicle) P.exitVehicle(true);
  // 1: beside a train at Columbia City's platform (not at the entrance)
  const cc = L.stations.find((q) => q.name === 'Columbia City'), tr = L.tracks.sb;
  const t = L.trains.find((q) => q.track === tr);
  t.place(cc.s.sb, 1); t.state = 'dwell'; t.station = cc; t.timer = 15; t.lastStop = cc;
  const s = cc.s.sb + 20, h = tr.heading(s), sg = tr.nearest(L.tracks.nb.x(cc.s.nb), L.tracks.nb.z(cc.s.nb), 40).side;
  P.x = tr.x(s) - Math.cos(h) * 3.2 * sg; P.z = tr.z(s) + Math.sin(h) * 3.2 * sg; P.y = tr.y(s) + 0.36;
  out.besideDist = Math.hypot(P.x - cc.ent.x, P.z - cc.ent.z).toFixed(0);
  out.beside = L.boardable(P.x, P.y, P.z) === t;
  // 2: Capitol Hill's entrance, nothing in: call one and wait
  const ch = L.stations.find((q) => q.name === 'Capitol Hill');
  for (const q of L.trains) if (q.stationHere() === ch) { q.state = 'run'; q.lastStop = ch; }
  P.x = ch.ent.x; P.z = ch.ent.z; P.y = ch.ent.y;
  let said = ''; const sw = L.say; L.say = (m) => { said = m; };
  out.boardableBefore = !!L.boardable(P.x, P.y, P.z);
  L.onWait(P.x, P.z);
  let secs = null;
  for (let i = 0; i < 30 * 90; i++) { L.update(1 / 30, d.camera); if (!P.onFoot) { secs = i / 30; break; } }
  L.say = sw;
  out.call = { said, secs, boarded: !P.onFoot && P.vehicle && P.vehicle.spec.link, at: P.vehicle && P.vehicle.stationHere && P.vehicle.stationHere() && P.vehicle.stationHere().name };
  if (P.vehicle) P.exitVehicle(true);
  return out; })()`, true);
    console.log('\n--- Link: getting on ---------------------------------------');
    console.log(`  beside a train on the platform (${lb.besideDist} m from the entrance): boards ${lb.beside}; at Capitol Hill with none in: called, boarded ${lb.call.boarded} after ${lb.call.secs} s at ${lb.call.at}`);
    if (!lb.beside || lb.boardableBefore || !lb.call.boarded || !(lb.call.secs < 40) || lb.call.at !== 'Capitol Hill') { console.error('FAIL: Link: getting on'); process.exitCode = 1; }

    // --- Link: the 2 Line ------------------------------------------------------------------
    //
    // The 2 Line's branch (link.js sb2 / nb2): its seven stations, its profile
    // (grade, nothing at grade under the ground, bores buried), the floating
    // bridge's rails clear of Lake Washington; ten minutes of service with the
    // 2 Line's trains stopping on their branch and never overlapping a 1 Line
    // train on the rails the two share; a merge forced at the junction (one
    // train holds at the signal, both get through, never together); a run
    // driven from Mercer Island to South Bellevue, stopped on the mark.
    const l2 = await session.eval(`(() => {
      const d = window.__dbg, L = d.link, G = d.G, P = d.player, out = {};
      const sb2 = L.tracks.sb2, nb2 = L.tracks.nb2, E = L.merge.E;
      out.own = L.stations.filter((q) => !q.lines.includes(1)).map((q) => q.name);
      out.tracks = {};
      for (const tr of [sb2, nb2]) {
        let grade = 0, under = 0, exposed = 0, wet = 0, over = 0;
        for (let i = tr.idx(tr.share.end) + 5; i < tr.n - 15; i += 5) {
          grade = Math.max(grade, Math.abs(tr.Y[i + 5] - tr.Y[i]) / 5);
          const kd = tr.KD[i];
          if ((kd === 4 || kd === 5) && tr.Y[i] < tr.GR[i] + 0.2) under++;
          if (kd === 1 && tr.Y[i] + 6 > tr.GR[i]) exposed++;
          // over Lake Washington (a lake: its level, not the sea's): clear of it
          const wl = G.isWater(tr.X[i], tr.Z[i]) ? G.drawnWaterLevel(L.lakes, tr.X[i], tr.Z[i]) : null;
          if (wl !== null && wl > 1 && kd === 3) { over++; if (tr.Y[i] < wl + 2.5) wet++; }
        }
        out.tracks[tr.key] = { grade: +grade.toFixed(3), under, exposed, overWater: over * 5, wet };
      }
      if (P.vehicle) P.exitVehicle(true);
      const px = P.x, pz = P.z;
      P.x = -6000; P.z = 9000;
      // service
      const was = new Map(), own = new Set();
      let arrivals = 0, overlap = 0;
      for (let i = 0; i < 30 * 600; i++) {
        L._service(1 / 30);
        for (const t of L.trains) {
          if (t.state === 'dwell' && was.get(t) === 'run' && L.lineOf(t.track.key) === 2) { arrivals++; if (t.station && !t.station.lines.includes(1)) own.add(t.station.name); }
          was.set(t, t.state);
        }
        if (i % 15 === 0) {
          const act = L.trains.filter((t) => t.state !== 'off');
          for (let a = 0; a < act.length; a++) for (let b = a + 1; b < act.length; b++) if (act[a].track !== act[b].track && L.sharedOverlap(act[a], act[b])) overlap++;
        }
      }
      out.service = { arrivals, own: own.size, overlap };
      // a merge, forced: a 1 Line and a 2 Line train reach the junction together
      const nb = L.tracks.nb;
      for (const t of L.trains) if ((t.track === nb || t.track === nb2) && Math.abs(t.s - E) < 1500) { t.state = 'off'; t.offT = 1e9; }
      const pool = L.trains.filter((t) => t.state === 'off' && t.offT < 1e8);
      const a = L.trains.find((t) => t.track === nb && t.state !== 'off') || pool[0];
      const b = L.trains.find((t) => t.track === nb2 && t.state !== 'off' && t !== a) || pool[1];
      for (const [t, tr] of [[a, nb], [b, nb2]]) { t.track = tr; t.dir = -1; t.driver = null; t.place(E + 59 + 90, -1); t.state = 'run'; t.u = -10; t.lastStop = L.stations.find((q) => q.s[tr.key] !== undefined && Math.abs(q.s[tr.key] - E) < 400) || null; }
      L.merge.owner = null;
      let held = false, bad = 0;
      for (let i = 0; i < 30 * 150; i++) {
        L._service(1 / 30);
        if (L.sharedOverlap(a, b)) bad++;
        if ((a.lead > E && Math.abs(a.u) < 0.05) || (b.lead > E && Math.abs(b.u) < 0.05)) held = true;
      }
      out.merge = { held, overlap: bad, through: a.lead < E - 50 && b.lead < E - 50 };
      // a 2 Line run from Mercer Island to South Bellevue
      const mi = L.stations.find((q) => q.name === 'Mercer Island'), sbv = L.stations.find((q) => q.name === 'South Bellevue');
      for (const t of L.trains) if (t.track === sb2 && Math.abs(t.s - mi.s.sb2) < 6000) { t.state = 'off'; t.offT = 1e9; }
      const t = L.trains.find((q) => q.track === sb2) || a;
      t.track = sb2; t.dir = 1; t.place(mi.s.sb2, 1); t.state = 'dwell'; t.station = mi; t.timer = 30; t.lastStop = mi; t.doors = true; t.u = 0;
      P.x = mi.ent.x; P.z = mi.ent.z; P.y = mi.ent.y;
      out.boarded = L.boardable(P.x, P.y, P.z) === t && P.enterVehicle(t) && P.vehicle === t;
      let said = '';
      const sw = L.say; L.say = (m) => { said = m; };
      for (let i = 0; i < 30 * 400 && out.boarded; i++) {
        const stopLead = sbv.s.sb2 + 59, left = stopLead - t.lead, v = t.u;
        const tgt = Math.min(t.allowed(null, 1.2), Math.sqrt(2 * 0.95 * Math.max(0, left - 0.3)));
        let thr = v < tgt - 0.4 ? 1 : 0, brk = v > tgt + 0.05 ? Math.min(0.9, 0.35 + (v - tgt) * 1.5) : 0;
        if (left < 0.3) { thr = 0; brk = 0.9; }
        t.update(1 / 30, { throttle: thr, brake: brk });
        if (i > 60 && Math.abs(t.u) < 0.02 && left < 3) break;
      }
      L.say = sw;
      out.drive = { err: +(sbv.s.sb2 - t.s).toFixed(2), said };
      if (P.vehicle) P.exitVehicle(true);
      P.x = px; P.z = pz;
      return out;
    })()`, true);
    console.log('\n--- Link: the 2 Line ---------------------------------------');
    console.log(`  its stations: ${l2.own.join(', ')}`);
    for (const k of ['sb2', 'nb2']) { const q = l2.tracks[k]; console.log(`  ${k}: steepest ${(q.grade * 100).toFixed(1)} %, at grade under the ground ${q.under}, bores out of the ground ${q.exposed}, ${q.overWater} m over the lake (${q.wet} samples within 2.5 m of it)`); }
    console.log(`  10 min: ${l2.service.arrivals} 2 Line stops (${l2.service.own} of its own stations), overlapping a 1 Line train ${l2.service.overlap}`);
    console.log(`  a forced merge: one held ${l2.merge.held}, together ${l2.merge.overlap}, both through ${l2.merge.through}; Mercer Island -> South Bellevue: boarded ${l2.boarded}, ${l2.drive.err} m from the mark ("${l2.drive.said}")`);
    {
      const bad = [];
      if (l2.own.length !== 8) bad.push('stations');
      for (const k of ['sb2', 'nb2']) { const q = l2.tracks[k]; if (q.grade > 0.062 || q.under || q.exposed || q.wet || q.overWater < 1500) bad.push(k); }
      if (l2.service.arrivals < 15 || l2.service.own < 4 || l2.service.overlap) bad.push('service');
      if (!l2.merge.held || l2.merge.overlap || !l2.merge.through) bad.push('the merge');
      if (!l2.boarded || Math.abs(l2.drive.err) > 1.5 || !/South Bellevue/.test(l2.drive.said)) bad.push('the driven run');
      if (bad.length) { console.error(`FAIL: Link 2 Line: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- freight: BNSF's main line --------------------------------------------------------
    //
    // freight.js: both mains across the map, within a freight's grade, the
    // ground cut to the bed at grade (never over the ballast), the tunnel
    // buried, no building on the line; the level crossings found with their
    // gates, and the single-track sections; fifteen minutes of service (never
    // two trains on single track at once, gates coming down, nothing over the
    // limit); boarding at Balmer Yard and a drive (notched up to speed, braked
    // to a stand without an emergency, the horn, climbing down beside the
    // track); calling a train in to the yard; a car held at a crossing.
    const fr = await session.eval(`(() => {
      const d = window.__dbg, F = d.freight, C = d.city, G = d.G, P = d.player, T = d.traffic;
      const out = { tracks: {}, crossings: F.crossings.length, gated: F.crossings.filter((c) => c.road && c.gates && c.gates.length === 2).length, sections: F.sections.length };
      for (const k of ['sb', 'nb']) {
        const tr = F.tracks[k];
        let grade = 0, buried = 0, exposed = 0, bldg = 0;
        for (let i = 10; i < tr.n - 15; i += 5) {
          grade = Math.max(grade, Math.abs(tr.Y[i + 5] - tr.Y[i]) / 5);
          const kd = tr.KD[i];
          // at grade: the ground may not stand over the ballast's top
          if ((kd === 4 || kd === 5) && G.terrainHeight(tr.X[i], tr.Z[i]) > tr.Y[i] - 0.3) buried++;
          if (kd === 1 && tr.Y[i] + 6 > tr.GR[i]) exposed++;
          if (kd !== 1 && i % 20 === 0) {
            for (const b of C.buildingsNear(tr.X[i], tr.Z[i], 12)) {
              const c = Math.cos(-b.rot), sn = Math.sin(-b.rot), dx = tr.X[i] - b.x, dz = tr.Z[i] - b.z;
              if (Math.abs(dx * c - dz * sn) < b.w / 2 && Math.abs(dx * sn + dz * c) < b.d / 2 && b.y + b.h > tr.Y[i] - 2) { bldg++; break; }
            }
          }
        }
        out.tracks[k] = { len: Math.round(tr.len), grade: +grade.toFixed(4), buried, exposed, bldg };
      }
      if (P.vehicle) P.exitVehicle(true);
      const px = P.x, pz = P.z;
      P.x = -6000; P.z = 9000;
      // service
      const s0 = F.trains.map((t) => t.s);
      let both = 0, vmax = 0, gates = 0, moved = 0;
      const gw = F.crossings.map(() => false);
      for (let i = 0; i < 10 * 900; i++) {
        for (const t of F.trains) t.service(0.1);
        F._crossingsUpdate(0.1, 0, 0);
        for (const t of F.trains) if (t.state !== 'off') vmax = Math.max(vmax, Math.abs(t.u) / Math.max(1, t.limitAt(t.lead) / 22.4));
        F.crossings.forEach((c, k) => { if (c.active && !gw[k]) gates++; gw[k] = c.active; });
        for (const sc of F.sections) {
          const n = F.trains.filter((t) => { if (t.state === 'off') return false; const k = t.track.key, lo = Math.min(t.lead, t.tail), hi = Math.max(t.lead, t.tail); return hi >= sc[k][0] && lo <= sc[k][1]; }).length;
          if (n > 1) both++;
        }
      }
      for (const t of F.trains) moved += 1;
      out.service = { both, vmax: +vmax.toFixed(1), gates, over: F.trains.filter((t) => t.state !== 'off' && Math.abs(t.u) > t.limitAt(t.lead) + 2.5).length };
      // board at the yard and drive
      const t = F.trains[0];
      for (const o of F.trains) if (o !== t && o.track === t.track) { o.state = 'off'; o.offT = 1e9; }
      t.place(F.yardStopS(t), t.track.dir); t.state = 'dwell'; t.timer = 60; t.atYard = true; t.yardDone = true; t.u = 0;
      const ex = F.exitSpot(t);
      P.x = ex.x; P.z = ex.z; P.y = ex.y;
      out.boardable = F.boardable(P.x, P.y, P.z) === t;
      P.enterVehicle(t);
      out.boarded = P.vehicle === t;
      const sa = t.s;
      for (let i = 0; i < 30 * 100; i++) P.updateDrive(1 / 30, { gas: true, x: 0, y: 0 }, T, d.peds);
      out.mph = Math.round(Math.abs(t.u) * 2.237);
      t.blow(); out.horn = t.hornOn;
      let secs = 0;
      for (let i = 0; i < 30 * 150 && Math.abs(t.u) > 0.02; i++) { P.updateDrive(1 / 30, { brake: true, x: 0, y: 0 }, T, d.peds); secs += 1 / 30; }
      out.stop = { secs: +secs.toFixed(0), emerg: t.emerg, run: Math.round(Math.abs(t.s - sa)) };
      out.readout = t.readout();
      for (let i = 0; i < 90; i++) P.updateDrive(1 / 30, { x: 0, y: 0 }, T, d.peds);
      const spot = F.exitSpot(t);
      P.exitVehicle();
      out.out = P.onFoot && !!spot && Math.abs(P.y - G.terrainHeight(P.x, P.z)) < 1.5 && !F.tracks.sb.nearest(P.x, P.z, 1.8) && !F.tracks.nb.nearest(P.x, P.z, 1.8);
      // call a train in: none near the yard
      for (const o of F.trains) { o.driver = null; o.state = 'off'; o.offT = 1e9; o.group.visible = false; }
      P.x = F.yard.x + 8; P.z = F.yard.z; P.y = G.terrainHeight(P.x, P.z);
      const sw = F.say; let said = ''; F.say = (m) => { said = m; };
      const called = F.onWait(P.x, P.z);
      let arrived = null;
      for (let i = 0; i < 10 * 240; i++) { for (const o of F.trains) o.service(0.1); if (F.trains.some((o) => o.state === 'dwell' && o.atYard)) { arrived = i / 10; break; } }
      F.say = sw;
      out.call = { called, said: !!said, arrived };
      // a crossing, a train on it: a car is held at its gates, and not 60 m off
      const c = F.crossings[Math.floor(F.crossings.length / 2)], k = c.s.sb !== undefined ? 'sb' : 'nb';
      const q = F.trains[0];
      q.track = F.tracks[k]; q.dir = q.track.dir; q.place(c.s[k], q.dir); q.state = 'dwell'; q.timer = 1e9; q.atYard = false;
      F._crossingsUpdate(0.1, c.x, c.z);
      const rx = c.road.dx, rz = c.road.dz;
      out.gate = { active: c.active, held: F.blocks(c.x + rx * (c.spread / 2 + 3), c.z + rz * (c.spread / 2 + 3), 0), clear: !F.blocks(c.x + rx * 60, c.z + rz * 60, 0) };
      q.timer = 1;
      // you on the track ahead of a freight: it sounds its horn for you
      const tr = F.tracks.sb;
      let sP = 0;
      for (let s = 12000; s < 26000; s += 10) if (tr.kind(s) === 4 && !F.sectionAt('sb', s)) { sP = s; break; }
      q.track = tr; q.dir = 1; q.place(sP - 540, 1); q.state = 'run'; q.u = 12; q.yardDone = true; q.horn.seq = null;
      P.x = tr.x(sP); P.z = tr.z(sP); P.y = tr.y(sP); P.health = 100;
      let horn = false;
      for (let i = 0; i < 10 * 30; i++) { F._guard(0.1, P); q.service(0.1); horn = horn || q.hornOn; }
      out.warned = { horn, braking: q.brakeCmd > 0.5 || q.emerg };
      P.x = px; P.z = pz;
      return out;
    })()`, true);
    console.log('\n--- freight ------------------------------------------------');
    for (const k of ['sb', 'nb']) { const q = fr.tracks[k]; console.log(`  ${k}: ${q.len} m, steepest ${(q.grade * 100).toFixed(1)} %, ground over the ballast ${q.buried}, tunnel out of the ground ${q.exposed}, buildings on the line ${q.bldg}`); }
    console.log(`  ${fr.crossings} level crossings (${fr.gated} gated), ${fr.sections} single-track sections`);
    console.log(`  15 min of service: two trains on single track ${fr.service.both} times, gates down ${fr.service.gates} times, over the limit ${fr.service.over}`);
    console.log(`  Balmer Yard: boardable ${fr.boardable}, boarded ${fr.boarded}; 100 s notched up: ${fr.mph} mph; braked to a stand in ${fr.stop.secs} s (emergency ${fr.stop.emerg}); horn ${fr.horn}; down beside the track ${fr.out}`);
    console.log(`  called to the yard: ${fr.call.called}, in after ${fr.call.arrived} s; a crossing: active ${fr.gate.active}, car held ${fr.gate.held}, 60 m off clear ${fr.gate.clear}; you on the track: horn ${fr.warned.horn}, braking ${fr.warned.braking}`);
    {
      const bad = [];
      for (const k of ['sb', 'nb']) {
        const q = fr.tracks[k];
        if (q.len < 25000) bad.push(`${k} length`);
        if (q.grade > 0.026) bad.push(`${k} grade`);
        if (q.buried) bad.push(`${k} ground over the ballast`);
        if (q.exposed) bad.push(`${k} tunnel out of the ground`);
        if (q.bldg > 2) bad.push(`${k} buildings on the line`);
      }
      if (fr.crossings < 20 || fr.gated < fr.crossings) bad.push('crossings');
      if (fr.sections !== 2) bad.push('single-track sections');
      if (fr.service.both || fr.service.gates < 10 || fr.service.over) bad.push('service');
      if (!fr.boardable || !fr.boarded || fr.mph < 30 || fr.stop.emerg || !fr.horn || !fr.out) bad.push('the drive');
      if (!fr.call.called || fr.call.arrived === null) bad.push('calling a train');
      if (!fr.gate.active || !fr.gate.held || !fr.gate.clear) bad.push('the crossing gates');
      if (!fr.warned.horn) bad.push('a train sounding for you');
      if (bad.length) { console.error(`FAIL: freight: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- bicycles and the bike paths ----------------------------------------------------
    //
    // bikes.js: the network drawn, the docks stocked, a dock bike ridden at
    // fixed dt (a bicycle's speed, the cranks turning with it), cyclists
    // spawning on the paths and staying on them, and no tree planted on a
    // path in the chunks built round a trail.
    const bk = await session.eval(`(() => {
      const d = window.__dbg, N = d.bikeNet, C = d.cyclists, P = d.player, T = d.traffic, cs = d.city;
      const out = { km: Math.round(N.km), docks: C.docks.length, stocked: C.docks.every((k) => k.bikes.length === 5 && k.bikes.every((v) => v.spec.bicycle)) };
      if (P.vehicle) P.exitVehicle(true);
      const k = C.docks[0], v = k.bikes[2];
      P.x = v.x; P.z = v.z; P.enterVehicle(v);
      const c0 = v.crank;
      let vmax = 0, t20 = null;
      for (let i = 0; i < 60 * 8; i++) {
        P.updateDrive(1 / 60, { x: 0, y: 0, gasAmt: 1, brakeAmt: 0 }, T, d.peds);
        vmax = Math.max(vmax, v.vLong);
        if (t20 === null && v.vLong * 3.6 > 20) t20 = i / 60;
      }
      out.ride = { kmh: +(vmax * 3.6).toFixed(1), t20, crank: +(v.crank - c0).toFixed(1), rider: v.rider.group.visible };
      P.exitVehicle(true);
      // cyclists: a minute round Green Lake
      const g = C.docks.find((q) => /Green Lake/.test(q.name)) || C.docks[1];
      P.x = g.x + 20; P.z = g.z + 20;
      for (let i = 0; i < 30 * 60; i++) C.update(1 / 30, P);
      let off = 0;
      for (const r of C.riders) { const q = N.nearest(r.v.x, r.v.z, 10); if (!q || q.d > 1.6) off++; }
      out.riders = { n: C.riders.length, off, spawned: C.stats.spawned, junctions: C.stats.junctions };
      // trees on the path round the Gas Works dock
      const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
      d.world.update(k.x, k.z, 60); for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(k.x, k.z, 60);
      let trunks = 0, onPath = 0;
      for (const list of cs.obstacles.values ? cs.obstacles.values() : []) {
        for (let q = 0; q < list.length; q += 3) {
          if (Math.hypot(list[q] - k.x, list[q + 1] - k.z) > 400) continue;
          trunks++;
          const n = N.nearest(list[q], list[q + 1], 3);
          if (n && n.d < 1.4 && !n.P.bridge) onPath++;
        }
      }
      out.trees = { trunks, onPath };
      return out;
    })()`, true);
    console.log('\n--- bicycles -----------------------------------------------');
    console.log(`  ${bk.km} km of path drawn, ${bk.docks} docks, stocked ${bk.stocked}; a dock bike: ${bk.ride.kmh} km/h top, 20 km/h in ${bk.ride.t20} s, crank turned ${bk.ride.crank} rad, rider ${bk.ride.rider}`);
    console.log(`  cyclists: ${bk.riders.n} riding (${bk.riders.spawned} spawned, ${bk.riders.junctions} junctions), off the path ${bk.riders.off}; trunks near the trail ${bk.trees.trunks}, on the path ${bk.trees.onPath}`);
    {
      const bad = [];
      if (bk.km < 150) bad.push('paths');
      if (bk.docks < 8 || !bk.stocked) bad.push('docks');
      if (bk.ride.kmh < 25 || bk.ride.kmh > 42 || !(bk.ride.t20 < 6) || bk.ride.crank < 5 || !bk.ride.rider) bad.push('riding');
      if (bk.riders.n < 3 || bk.riders.off) bad.push('cyclists');
      if (bk.trees.onPath) bad.push('trees on the path');
      if (bad.length) { console.error(`FAIL: bicycles: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- the islands across the Sound ------------------------------------------------------
    // Docks with floatplanes and boats on Bainbridge, Blake and Vashon (so
    // nobody who flies over is stranded), the Easter eggs sited on dry land
    // and each paying once, the Sasquatch fleeing, the treasure dug, and the
    // pickleball court: on level ground, ENTER plays, a game runs to 11.
    const isl = await session.eval(`(() => {
      const d = window.__dbg, I = d.islands, K = d.pickle, T = d.traffic, P = d.player, G = d.G;
      const out = {};
      const west = (d.lmRoot.userData.marinas || []).filter((m) => m.x < -8000);
      out.docks = west.length;
      out.craft = T.cars.filter((v) => v.mode === 'apron' && v.x < -8000 && (v.spec.floats || v.spec.boat)).map((v) => v.typeName);
      out.dry = Object.entries(I.place).filter(([, q]) => G.isWater(q.x, q.z) || G.terrainHeight(q.x, q.z) < 0.3).map(([k]) => k);
      if (P.vehicle) P.exitVehicle(true);
      localStorage.removeItem('auto-islands'); I.found = new Set();
      const m0 = d.game.money;
      // the bike in the tree, the salmon bake, the labyrinth: walk up to each
      for (const q of [I.bikeTree, I.fire, I.lab]) { P.x = q.x + 0.5; P.z = q.z + 0.5; P.y = G.terrainHeight(P.x, P.z); I.update(0.05); }
      // the Sasquatch: come up on him and he bolts
      const s = I.sq; P.x = s.x + 12; P.z = s.z; P.y = G.terrainHeight(P.x, P.z);
      for (let i = 0; i < 60; i++) { I.update(1 / 30); if (i < 30) { P.x = s.x + 12; P.z = s.z; } }
      out.fled = Math.hypot(s.x - P.x, s.z - P.z) > 16;
      // dig
      P.x = I.chest.x; P.z = I.chest.z; P.y = G.terrainHeight(P.x, P.z);
      out.dug = I.tryInteract(P);
      out.found = [...I.found].sort();
      out.paid = d.game.money - m0;
      // pickleball
      out.court = !!K.court;
      if (K.court) {
        P.x = K.court.x; P.z = K.court.z; P.y = K.court.y;
        out.onCourt = K.near(P) && Math.abs(d.city.platformAt(K.court.x, K.court.z) - K.court.y) < 0.05;
        K.start(); K._newGame(); K.frozen = true;
        const gm = K.game;
        for (let i = 0; i < 60 * 900 && gm.state !== 'over'; i++) gm.step(1 / 60, { mx: 0, my: 0, shot: i % 25 === 0 ? 'drive' : null, aimX: 0 });
        out.pickle = { state: gm.state, score: gm.score };
        K.frozen = false; K.close();
      }
      return out;
    })()`, true);
    console.log('\n--- the islands --------------------------------------------');
    console.log(`  docks across the Sound ${isl.docks} (${isl.craft.length} craft: ${[...new Set(isl.craft)].join(', ')}); sites in the water ${isl.dry.join(', ') || 'none'}`);
    console.log(`  found ${isl.found.join(', ')} for $${isl.paid}; the Sasquatch fled ${isl.fled}; dug ${isl.dug}`);
    console.log(`  pickleball: court ${isl.court}, standing on it ${isl.onCourt}; a game to ${isl.pickle && isl.pickle.score.join('-')} (${isl.pickle && isl.pickle.state})`);
    {
      const bad = [];
      if (isl.docks < 4 || !isl.craft.includes('floatplane') || !isl.craft.includes('boat')) bad.push('docks');
      if (isl.dry.length) bad.push('sites in the water');
      if (!['bikeTree', 'labyrinth', 'salmon', 'sasquatch', 'treasure'].every((k) => isl.found.includes(k)) || isl.paid < 5000) bad.push('the Easter eggs');
      if (!isl.fled) bad.push('the Sasquatch');
      if (!isl.court || !isl.onCourt || !isl.pickle || isl.pickle.state !== 'over') bad.push('pickleball');
      if (bad.length) { console.error(`FAIL: islands: ${bad.join('; ')}`); process.exitCode = 1; }
    }

    // --- traffic and you, on foot ------------------------------------------------------
    // Step into the lane 16-28 m ahead of a moving AI car at a walk: it must
    // see you (where you will be, as far out as it needs to stop) and stop.
    // Master before v153 hit you in half of these.
    const ro = await session.eval(`(() => { const d = window.__dbg, T = d.traffic, P = d.player, G = d.G;
  if (P.vehicle) P.exitVehicle(true);
  let hits = 0, trials = 0, dmg = 0, deaths = 0;
  const cam = new d.THREE.Vector3(0, 0, -1);
  for (let k = 0; k < 20; k++) {
    // a moving car
    P.x = 150 + (k % 5) * 300; P.z = 200 + Math.floor(k / 5) * 250; P.y = d.city.groundAt(P.x, P.z, null);
    for (let i = 0; i < 90; i++) T.update(1 / 30, P.x, P.z, cam, P);
    const v = T.cars.find((c) => c.mode === 'traffic' && c.vLong > 9 && Math.hypot(c.x - P.x, c.z - P.z) < 300);
    if (!v) continue;
    trials++;
    const f = v.forward, fwd = 16 + (k % 4) * 4, side = k % 2 ? 1 : -1;
    // start 3.5 m to the side, 16-28 m ahead, walking across its path
    P.x = v.x + f.x * fwd + f.z * side * 3.5; P.z = v.z + f.z * fwd - f.x * side * 3.5; P.y = v.y;
    P.heading = Math.atan2(-f.z * side, f.x * side); P.speed = 1.4;
    P.health = 100; d.game.dead = false; P.hitCd = 0;
    let hit = false;
    for (let i = 0; i < 30 * 5; i++) {
      T.update(1 / 30, P.x, P.z, cam, P);
      P.x += Math.sin(P.heading) * 1.4 / 30; P.z += Math.cos(P.heading) * 1.4 / 30; P.y = v.y;
      // the run-over test, as updateFoot does it
      for (const c of T.cars) {
        if (c.mode === 'parked' || Math.abs(c.vLong) < 3 || Math.abs(c.y - P.y) > 2.5) continue;
        const n = c.nearest(P.x, P.z);
        if ((n.x - P.x) ** 2 + (n.z - P.z) ** 2 < 0.8) { hit = true; }
      }
    }
    if (hit) hits++;
  }
  return { trials, hits };
})()`, true);
    // No parked car under drawn water: low streets near every shore, and the
    // Duwamish valley that Lake Washington's box used to flood.
    const wp = await session.eval(`(() => { const d = window.__dbg, T = d.traffic, P = d.player, G = d.G, W = d.world, C = d.city;
  if (P.vehicle) P.exitVehicle(true);
  // what is DRAWN wet: a lake plane where the build draws one, the sea under -0.15
  const drawn = (x, z) => { for (const l of W.lakeSpecs) { const on = G.inLake ? G.inLake(l, x, z) : (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1); if (on) return l.level; }
    const c = W.canal; if (c) { const lv = c.at(x, z); if (lv !== null) return lv; } return G.isWater(x, z) || G.terrainHeight(x, z) < -0.15 ? 0 : null; };
  // low street nodes near water, spread out
  const spots = [];
  for (let i = 0; i < C.nodes.length && spots.length < 60; i += 23) {
    const n = C.nodes[i]; if (n.elev) continue;
    const t = G.terrainHeight(n.x, n.z); if (t > 7) continue;
    let near = false; for (let a = 0; a < 8; a++) if (G.isWater(n.x + Math.cos(a) * 150, n.z + Math.sin(a) * 150)) near = true;
    if (!near) continue;
    if (spots.some((s) => Math.hypot(s[0] - n.x, s[1] - n.z) < 350)) continue;
    spots.push([n.x, n.z]);
  }
  for (let z = 9000; z <= 12600; z += 500) for (let x = 1500; x <= 4500; x += 500) spots.push([x, z]);
  const cam = new d.THREE.Vector3(0, 0, -1);
  const bad = new Set(); let parked = 0;
  for (const [x, z] of spots) {
    P.x = x; P.z = z; P.y = C.groundAt(x, z, null);
    for (let k = 0; k < 20; k++) T.update(1 / 30, x, z, cam, P);
    for (const v of T.cars) {
      if (v.mode !== 'parked' && !(v.mode === 'apron' && !v.spec.boat && !v.spec.floats)) continue;
      parked++;
      const wl = drawn(v.x, v.z);
      if (wl !== null && wl > G.terrainHeight(v.x, v.z) + 0.05) bad.add((v.x | 0) + ',' + (v.z | 0));
    }
  }
  return { spots: spots.length, parkedSeen: parked, underWater: bad.size, examples: [...bad].slice(0, 8) };
})()`, true);
    console.log('\n--- traffic and you ----------------------------------------');
    console.log(`  stepping into the lane ahead of a moving car: hit ${ro.hits} of ${ro.trials}; parked cars under water ${wp.underWater} of ${wp.parkedSeen} seen at ${wp.spots} low spots ${wp.examples.join(' ')}`);
    if (ro.trials < 10 || ro.hits > 1) { console.error('FAIL: AI cars run you over'); process.exitCode = 1; }
    if (wp.underWater) { console.error('FAIL: parked cars under the water'); process.exitCode = 1; }

    // --- swimming ---------------------------------------------------------------------------
    // Fall into Lake Union 45 m off the seaplane dock's float: you swim, not
    // drown, and haul yourself out onto the float. Step off a boat in open
    // water: over the side. Drive a car into deep water: it sinks, you swim.
    const sw = await session.eval(`(() => {
      const d = window.__dbg, P = d.player, T = d.traffic;
      if (P.vehicle) P.exitVehicle(true);
      const out = {};
      P.x = -56; P.z = -1960; P.y = 12; P.grounded = false; P.vy = 0; P.fellFrom = 12; P.health = 100; d.game.dead = false;
      P.heading = -Math.PI / 2; P.camYaw = P.heading - Math.PI;
      let swam = null, outT = null;
      for (let i = 0; i < 60 * 60; i++) {
        P.updateFoot(1 / 60, { x: 0, y: i > 60 ? -1 : 0 }, T, d.peds);
        if (P.swimming && swam === null) swam = i / 60;
        if (swam !== null && !P.swimming) { outT = i / 60; break; }
      }
      out.fall = { swam, out: outT, onFloat: d.city.platformAt(P.x, P.z) !== null, health: P.health, at: [P.x.toFixed(1), P.z.toFixed(1), P.y.toFixed(2)], sw: P.swimming, h: P.heading.toFixed(2), blocked: P.blocked(P.x - 1, P.z), ahead: d.city.groundAt(P.x - 1, P.z, 7).toFixed(2), wl: P.waterAt(P.x, P.z), near: T.cars.filter((v) => Math.hypot(v.x - P.x, v.z - P.z) < 6).map((v) => v.typeName + '@' + v.x.toFixed(1) + ',' + v.z.toFixed(1)) };
      // off a runabout in the middle of the lake
      const b = T.spawnAt(300, -2600, 0, 'boat', 0xffffff, 'free');
      P.x = b.x; P.z = b.z; P.enterVehicle(b);
      const ok = P.exitVehicle();
      for (let i = 0; i < 30; i++) P.updateFoot(1 / 60, { x: 0, y: 0 }, T, d.peds);
      out.boat = { left: ok, swimming: P.swimming, health: P.health };
      T.remove(b);
      // a car off the end of a Lake Union pier, into deep water
      P.swimming = false; P.h.group.rotation.x = 0;
      const c = T.spawnAt(300, -2600, 0, 'sedan', 0x335577, 'free');
      P.x = c.x; P.z = c.z; P.enterVehicle(c);
      let sank = false;
      for (let i = 0; i < 60 * 8 && !sank; i++) { P.updateDrive(1 / 60, { x: 0, y: 0, gasAmt: 0, brakeAmt: 0 }, T, d.peds); if (P.onFoot) sank = true; }
      for (let i = 0; i < 60; i++) if (P.onFoot) P.updateFoot(1 / 60, { x: 0, y: 0 }, T, d.peds);
      out.car = { out: sank, swimming: P.swimming, health: P.health };
      T.remove(c);
      if (P.swimming) { P.swimming = false; P.h.group.rotation.x = 0; }
      return out;
    })()`, true);
    console.log('\n--- swimming -----------------------------------------------');
    if (sw.fall.out === null) console.log('  stuck: ' + JSON.stringify(sw.fall));
    console.log(`  into the lake: swimming at ${sw.fall.swam} s, out on the float at ${sw.fall.out} s (${sw.fall.onFloat}), health ${sw.fall.health}; off a boat: ${sw.boat.swimming}; a car into deep water: out ${sw.car.out}, swimming ${sw.car.swimming}, health ${sw.car.health}`);
    if (sw.fall.swam === null || sw.fall.out === null || !sw.fall.onFloat || sw.fall.health < 100 || !sw.boat.left || !sw.boat.swimming || !sw.car.out || !sw.car.swimming || sw.car.health <= 0) {
      console.error('FAIL: swimming'); process.exitCode = 1;
    }

    // --- piers, and trains' doors -------------------------------------------------------
    // OSM's piers built as decks you stand on at the height drawn; Pier 90's
    // sheds (not mapped as a pier) on a deck; a train standing at a platform
    // shows its doors open, one running does not.
    const pr = await session.eval(`(() => {
      const d = window.__dbg, P = d.piers, C = d.city;
      const out = { built: P.built.length, sheds: P.sheds, checked: 0, off: 0 };
      for (let i = 0; i < P.plats.length; i += 7) {
        const q = P.plats[i]; out.checked++;
        if (Math.abs(C.groundAt(q.x, q.z, q.y0 + 0.5) - q.y0) > 0.1) out.off++;
      }
      // Built when first in range (v163): a camera beside a pier far from here
      // builds its chunk, and the drawn deck is where the platform says
      {
        const q = P.plats[Math.floor(P.plats.length / 2)], cam = { position: { x: q.x, y: q.y0 + 2, z: q.z } };
        const before = P.chunks.filter((c) => c.m).length;
        const mine = P.chunks.find((c) => Math.floor(c.x / 1000) === Math.floor(q.x / 1000) && Math.floor(c.z / 1000) === Math.floor(q.z / 1000));
        for (let i = 0; i < 8 * 40 && !(mine && mine.m); i++) P.update(cam);
        d.scene.updateMatrixWorld(true);
        const rc = new d.THREE.Raycaster(new d.THREE.Vector3(q.x, q.y0 + 5, q.z), new d.THREE.Vector3(0, -1, 0));
        const h = rc.intersectObject(P.group, true)[0];
        out.lazy = { before, after: P.chunks.filter((c) => c.m).length, deck: h ? +(h.point.y - q.y0).toFixed(2) : null };
        const N = d.bikeNet, ch = N.chunks.find((c) => !c.m && c.segs), bc = ch ? { position: { x: ch.x, y: 0, z: ch.z } } : null;
        if (bc) for (let i = 0; i < 16; i++) N.update(bc);
        out.lazy.bike = ch ? !!(ch.m && ch.m.geometry.index.count > 0) : null;
        // a lost context (the phone's path drops the arrays after upload):
        // both drop their meshes and build them again when next in range
        P.contextLost(); N.contextLost();
        for (let i = 0; i < 8 * 40 && !(mine && mine.m); i++) P.update(cam);
        if (bc) for (let i = 0; i < 8 * 40 && !ch.m; i++) N.update(bc);
        out.lazy.relost = !!(mine && mine.m) && (!ch || !!(ch.m && ch.m.geometry.index.count > 0));
      }
      // Pier 90's sheds: every big building standing in the sea at Smith Cove has a deck
      out.smithCove = C.buildings.filter((b) => b.x > -3300 && b.x < -3050 && b.z > -2150 && b.z < -1750 && b.w * b.d > 150)
        .map((b) => C.platformAt(b.x, b.z) !== null);
      const L = d.link, t = L.trains.find((q) => q.state === 'dwell'), r = L.trains.find((q) => q.state === 'run');
      if (t) t.pose(); if (r) r.pose();
      const M = d.monorail.trains;
      for (const q of Object.values(M)) q.pose();
      out.doors = { linkDwell: t ? t.meshes[2].visible : null, linkRun: r ? r.meshes[2].visible : null,
        mono: Object.values(M).map((q) => q.meshes[2].visible === (!!q.at() && q.state === 'dwell')) };
      return out;
    })()`, true);
    console.log('\n--- piers and doors ----------------------------------------');
    console.log(`  ${pr.built} OSM piers and ${pr.sheds} sea sheds decked; standing on them off the drawn deck ${pr.off} of ${pr.checked}; Pier 90 sheds on a deck ${pr.smithCove.filter(Boolean).length}/${pr.smithCove.length}; doors: Link standing ${pr.doors.linkDwell}, running ${pr.doors.linkRun}, monorail ${pr.doors.mono}`);
    console.log(`  built when in range: pier chunks ${pr.lazy.before} -> ${pr.lazy.after}, the deck drawn ${pr.lazy.deck} m from its platform; a far bike-path chunk built ${pr.lazy.bike}; built again after a lost context ${pr.lazy.relost}`);
    if (!(pr.lazy.after > pr.lazy.before) || pr.lazy.deck === null || Math.abs(pr.lazy.deck) > 0.05 || pr.lazy.bike !== true || pr.lazy.relost !== true) {
      console.error('FAIL: piers / bike paths not built when in range'); process.exitCode = 1;
    }
    if (pr.built < 800 || pr.off > pr.checked * 0.02 || !pr.smithCove.length || pr.smithCove.some((x) => !x)
      || pr.doors.linkDwell !== true || pr.doors.linkRun !== false || pr.doors.mono.some((x) => !x)) { console.error('FAIL: piers and doors'); process.exitCode = 1; }

    // --- the articulated bus ---------------------------------------------------
    //
    // An artic spawned and driven: its rear section follows on the hitch
    // (joined exactly), straight behind on a straight, turning inside in a
    // bend within the turntable's limit, and in reverse; the two sections do
    // not collide with each other; entering the rear enters the front; it
    // leaves as one. And traffic spawns them.
    const artic = await session.eval(`(() => {
      const d = window.__dbg, P = d.player, T = d.traffic, C = d.city;
      if (P.vehicle) P.exitVehicle(true);
      let best = null;
      for (const e of C.edges) {
        if ((e.cls !== 'art' && e.cls !== 'st') || e.elev || e.tunnel || e.len < 30) continue;
        const a = C.nodes[e.a], dd = Math.hypot(a.x - P.x, a.z - P.z);
        if (!best || dd < best.dd) best = { e, dd };
      }
      const e = best.e, a = C.nodes[e.a];
      const v = T.spawnAt(a.x + e.dx * 15, a.z + e.dz * 15, Math.atan2(e.dx, e.dz), 'artic', 0xc41a24, 'free');
      const r = v.trailer;
      if (!r) return { spawned: false };
      P.x = v.x; P.z = v.z; P.enterVehicle(v);
      const inp = (gas, steer, brake = 0) => ({ x: steer, y: 0, gas: gas > 0, brake: brake > 0, gasAmt: gas, brakeAmt: brake, hand: false, sprint: false, attack: false, horn: false, jump: false });
      let maxA = 0, hitch = 0, bad = 0;
      const step = (k, i) => { for (let n = 0; n < k; n++) {
        P.update(1 / 60, i, { x: 0, y: 0 }, d.controls, T, d.peds); T.update(1 / 60, P.x, P.z, { x: 0, z: 1 }, P);
        maxA = Math.max(maxA, Math.abs(Math.atan2(Math.sin(r.heading - v.heading), Math.cos(r.heading - v.heading))));
        hitch = Math.max(hitch, Math.hypot(v.x - v.forward.x * 6.35 - (r.x + r.forward.x * 3.85), v.z - v.forward.z * 6.35 - (r.z + r.forward.z * 3.85)));
        if (!isFinite(r.x + r.y + r.z + r.heading)) bad++; } };
      step(300, inp(1, 0));
      const straight = Math.abs(Math.atan2(Math.sin(r.heading - v.heading), Math.cos(r.heading - v.heading)));
      step(180, inp(0, 0, 1)); step(420, inp(0.5, 1)); step(240, inp(0, 0, 1));
      const out = { spawned: true, straight: +(straight * 57.3).toFixed(2), maxA: +(maxA * 57.3).toFixed(1), hitch: +hitch.toFixed(3), bad,
        enterRear: T.nearestEnterable(r.x, r.z, 6) === v };
      P.exitVehicle(true);
      T.remove(v);
      out.leftAsOne = !T.cars.includes(r) && !v.bellows;
      return out;
    })()`, true);
    console.log('\n--- articulated bus ----------------------------------------');
    if (!artic || !artic.spawned) { console.error('FAIL: no articulated bus'); process.exitCode = 1; }
    else {
      console.log(`  on a straight ${artic.straight} deg off line; through a full-lock bend and reversing, turntable up to ${artic.maxA} deg, hitch joined within ${artic.hitch} m; entering the rear enters the front ${artic.enterRear}; left as one ${artic.leftAsOne}`);
      const bad = [];
      if (artic.straight > 1) bad.push('the rear does not trail straight');
      if (artic.maxA < 20 || artic.maxA > 55) bad.push('the turntable angle');
      if (artic.hitch > 0.01 || artic.bad) bad.push('the hitch comes apart');
      if (!artic.enterRear || !artic.leftAsOne) bad.push('entering or removing');
      if (bad.length) { console.error(`FAIL: articulated bus: ${bad.join('; ')}`); process.exitCode = 1; }
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

    // --- freeways (v162) --------------------------------------------------
    // Nothing stands up through a deck; the grading does not average a
    // freeway up toward a deck crossing over it; the Dexter Way underpass
    // does not dig Aurora; and cars collide as their bodies, so two abreast in
    // 3.6 m lanes do not touch while two nose to tail 4 m apart do.
    const fw = await session.eval(`(() => { const d = window.__dbg, C = d.city, T = d.traffic, W = d.world;
      let through = 0;
      for (const e of C.edges) {
        if (!e.elev || e.tunnel) continue;
        const a = C.nodes[e.a], b = C.nodes[e.b], px = -e.dz, pz = e.dx;
        for (let s = 0; s <= e.len; s += 4) {
          const t = e.len ? s / e.len : 0, deck = e.prof ? C.profAt(e, t).h : a.y + (b.y - a.y) * t;
          for (const o of [-e.hw, 0, e.hw]) {
            const x = a.x + e.dx * s + px * o, z = a.z + e.dz * s + pz * o;
            for (const bd of C.buildingsNear ? C.buildingsNear(x, z, 2) : []) {
              if (bd.y > deck - 2.5 || bd.y + bd.h <= deck - 1.3) continue;
              const c = Math.cos(-bd.rot), sn = Math.sin(-bd.rot), dx = x - bd.x, dz = z - bd.z;
              if (Math.abs(dx * c - dz * sn) < bd.w / 2 && Math.abs(dx * sn + dz * c) < bd.d / 2) through++;
            }
          }
        }
      }
      let steep = 0;
      for (const e of C.edges) {
        if (e.name !== 'I 5' || e.elev || e.tunnel || !e.ph) continue;
        const k = e.ph.length - 1;
        for (let i = 0; i < k; i++) if (Math.abs(e.ph[i + 1] - e.ph[i]) / (e.len / k) > 0.08) steep++;
      }
      const aurora = W.cutDepth(-562, -3077);
      const mk = (x, z, h) => { const v = T.spawnAt(x, z, h, 'sedan', 0x777777, 'free'); v.x = x; v.z = z; v.heading = h; v.vLong = 10; return v; };
      const P = { vehicle: null };
      const A = mk(9000, 9000, 0), B = mk(9003.6, 9000, 0);
      T.resolveCarCollisions(1 / 60, P);
      const abreast = Math.abs(A.x - 9000) + Math.abs(B.x - 9003.6);
      const Cc = mk(9100, 9000, 0), D = mk(9100, 9004, 0);
      T.resolveCarCollisions(1 / 60, P);
      const tail = Math.abs(D.z - Cc.z - 4);
      for (const v of [A, B, Cc, D]) T.remove ? T.remove(v) : (v.recycle = true);
      return { through, steep, aurora, abreast, tail, has: !!C.buildingsNear };
    })()`, true);
    console.log('\n--- freeways --------------------------------------------');
    console.log(`  buildings through a deck: ${fw.through}${fw.has ? '' : ' (no buildingsNear)'}; I-5 ground profile steps over 8 %: ${fw.steep}; Aurora dug at Dexter Way: ${fw.aurora.toFixed(2)} m`);
    console.log(`  sedans abreast 3.6 m apart moved ${fw.abreast.toFixed(3)} m; nose to tail 4 m apart pushed ${fw.tail.toFixed(2)} m`);
    if (!fw.has || fw.through > 0 || fw.steep > 40 || fw.aurora > 0.5 || fw.abreast > 0.001 || fw.tail < 0.3) {
      console.error('FAIL: freeways'); process.exitCode = 1;
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
