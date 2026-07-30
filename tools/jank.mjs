// City jank hunter: geometric defects, counted across the whole map.
//
//   node tools/jank.mjs [--json] [--only=name,name]
//
// The defects this looks for -- pavement that does not meet, props standing in
// water, terrain poking through the asphalt,
// things you sink into -- are all things a screenshot can only find one at a
// time, by luck, in whichever direction the camera happened to be pointing.
// They are also all *measurable*, which means they can be counted over the
// whole 16 km map and driven to zero, and a regression shows up as a number
// rather than as someone noticing months later.
//
// A check is only worth its output if it measures what is DRAWN. Two of the
// original nine compared an analytic surface -- the chord between an edge's end
// nodes, or where a pavement strip would be offset to -- against the terrain,
// and both reported large problems that do not exist: road-poke read 9.2 % and
// walk-on-road 2.95 %, and raycasting the actual meshes puts them at 0.28 % and
// 0 %. Measuring intent instead of geometry does not just give a wrong number,
// it sends someone to fix a bug that is not there.
//
// Every check reports a count, a rate against however many samples it took, and
// the worst offenders with coordinates -- so a bad one can be walked to with
// `AUTO_PROBE` or photographed with tools/survey.mjs instead of being argued
// about.
//
// The lesson this codebase keeps relearning (road z-fighting, the wheel-well
// slab, the shadow-map band, the sunset harness) is that a render tells you
// something looks wrong and almost never tells you why. Measure it.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9235;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const JSON_OUT = process.argv.includes('--json');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--window-size=900,640', '--no-first-run',
    '--user-data-dir=/tmp/auto-jank-profile', 'about:blank',
  ], { stdio: 'ignore' });
}

const CHECKS = `(() => {
  const d = window.__dbg, G = d.G, city = d.city, world = d.world;
  const THREE = d.THREE;
  const only = ${JSON.stringify(ONLY)};
  const want = (n) => !only || only.split(',').includes(n);
  const out = [];
  const R = (seed) => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };

  // Sample points spread over the land area of the map, deterministically.
  const landPoints = (n, seed) => {
    const r = R(seed), pts = [];
    let guard = 0;
    while (pts.length < n && guard++ < n * 60) {
      const x = (r() - 0.5) * 2 * (G.MAP_HALF - 200);
      const z = (r() - 0.5) * 2 * (G.MAP_HALF - 200);
      if (G.isWater(x, z)) continue;
      pts.push([x, z]);
    }
    return pts;
  };

  // Chunk geometry is time-sliced across frames, so ONE world.update builds a
  // few milliseconds of it and returns. Raycasting straight after leaves you
  // measuring a half-built chunk -- which is how the beauty harness spent
  // several passes photographing bare terrain, and it is why sink read 11.7 %:
  // most of those samples found no road mesh at all because it had not been
  // generated yet.
  // A settle rebuilds up to a 9x9 grid of chunks, so it is far too expensive to
  // do per sample. The raycast checks therefore work SITE BY SITE: settle once,
  // then take every sample that falls inside the built area before moving on.
  // Sampling in node-index order instead walks the whole 16 km map at random
  // and settles thousands of times, which does not finish.
  //
  // The budget is a per-call millisecond slice; a large one builds a whole
  // chunk per call, so a site settles in a handful of calls rather than
  // hundreds.
  const settle = (x, z) => {
    const pending = () => [...world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
    // Measured: a cold site converges in ~243 calls, a neighbouring one in
    // ~126. The budget arg is NOT milliseconds -- world.update only reads it
    // as a less-than-2 flag and then picks its own 2/4/9 ms slice, so the
    // only way to finish is to keep calling until nothing is pending.
    for (let i = 0; i < 20000 && (i === 0 || pending() > 0); i++) world.update(x, z, 9);
    d.scene.updateMatrixWorld(true);
  };

  // NEAR_R = 2 at CHUNK = 400, so full-detail geometry exists within 800 m of
  // the site centre. Stay well inside that.
  const SITE_R = 600;
  const nearSite = (x, z, sx, sz) => Math.abs(x - sx) < SITE_R && Math.abs(z - sz) < SITE_R;

  // Deterministic spread of road-bearing sites across the map.
  const roadSites = (n, seed) => {
    const r = R(seed), out = [];
    const nodes = city.nodes;
    for (let i = 0; i < n * 40 && out.length < n; i++) {
      const nd = nodes[Math.floor(r() * nodes.length)];
      if (!nd || nd.elev) continue;
      if (out.some(([x, z]) => Math.abs(x - nd.x) < SITE_R && Math.abs(z - nd.z) < SITE_R)) continue;
      out.push([nd.x, nd.z]);
    }
    return out;
  };

  const add = (name, n, of, worst, note) =>
    out.push({ name, n, of, rate: of ? +(100 * n / of).toFixed(2) : 0, worst: worst.slice(0, 6), note });

  // --- props and trees standing in water ---------------------------------
  //
  // The park scatter filters on the green mask and on roads. The green mask and
  // the water mask are different rasters and the shoreline does not agree
  // between them to the metre, so a tree can be planted in Puget Sound.
  if (want('tree-in-water')) {
    const CHUNK = 400;
    let cand = 0, wet = 0, planted = 0;
    const wetCand = [], sites = [], seen = new Set();
    const worst = [];
    const h2 = (a, b) => { const t = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return t - Math.floor(t); };
    for (let cx = -18; cx <= 18; cx++) {
      for (let cz = -18; cz <= 18; cz++) {
        const x0 = cx * CHUNK, z0 = cz * CHUNK;
        for (let i = 0; i < 230; i += 5) {
          const x = x0 + h2(cx * 71 + i, cz * 131 + 7) * CHUNK;
          const z = z0 + h2(cx * 37 + i, cz * 53 + 13) * CHUNK;
          if (!G.inPark(x, z)) continue;
          if (city.onRoad(x, z, 2.5)) continue;
          if (world.inBuilding && world.inBuilding(x, z, 0.8)) continue;
          cand++;
          if (G.isWater(x, z) || G.terrainHeight(x, z) < 0.35) wetCand.push([x, z]);
        }
      }
    }
    // Those are CANDIDATES -- points the scatter considers. Counting them
    // measures the raster disagreement, which is a fixed property of the map:
    // this check reported an unchanged 16 before and after the scatter learned
    // to reject them, because it never looked at a tree that got built.
    //
    // world.buildChunk registers each trunk into city.obstacles, so the
    // obstacle list IS the drawn record. Settle over each wet candidate and
    // count the trunks that actually stand in water.
    for (const [wx, wz] of wetCand) {
      if (sites.some(([x, z]) => Math.abs(x - wx) < SITE_R && Math.abs(z - wz) < SITE_R)) continue;
      sites.push([wx, wz]);
    }
    for (const [sx, sz] of sites) {
      settle(sx, sz);
      // addObstacle pushes x, z, r onto ONE flat array per chunk -- these are
      // not objects, and iterating them as if they were silently matched
      // nothing and reported a clean 0 of 0.
      for (const list of city.obstacles.values()) {
        for (let i = 0; i < list.length; i += 3) {
          const ox = list[i], oz = list[i + 1];
          if (!nearSite(ox, oz, sx, sz)) continue;
          // Trunks and lamp posts share this list. Street furniture offsets
          // from its own road, and a road over water here is a PIER -- Alaskan
          // Way and Colman Dock are supposed to be out there -- so a pole above
          // the tide line is correct and only a tree is a bug.
          if (city.onRoad(ox, oz, 4.0)) continue;
          const key = Math.round(ox) + ',' + Math.round(oz);
          if (seen.has(key)) continue;
          seen.add(key);
          planted++;
          if (G.isWater(ox, oz) || G.terrainHeight(ox, oz) < 0.35) {
            wet++;
            if (worst.length < 6) worst.push({ x: Math.round(ox), z: Math.round(oz), y: +G.terrainHeight(ox, oz).toFixed(2) });
          }
        }
      }
    }
    add('tree-in-water', wet, planted, worst,
      'trunks actually standing in water (from ' + cand + ' candidates, ' + wetCand.length + ' of them wet)');
  }

  // --- ground that stands above the water covering it --------------------
  //
  // The minimap comes from the water mask and the world from the DEM, so the
  // two disagreeing renders as an island that is not on the map.
  if (want('island')) {
    const r = R(7), worst = [];
    let n = 0, of = 0;
    for (let i = 0; i < 40000; i++) {
      const x = (r() - 0.5) * 2 * (G.MAP_HALF - 100);
      const z = (r() - 0.5) * 2 * (G.MAP_HALF - 100);
      if (!G.isWater(x, z)) continue;
      of++;
      const level = world.waterLevelAt(x, z);
      if (level === null) continue;
      const h = G.terrainHeight(x, z);
      if (h > level + 0.05) {
        n++;
        if (worst.length < 6) worst.push({ x: Math.round(x), z: Math.round(z), above: +(h - level).toFixed(2) });
      }
    }
    worst.sort((a, b) => b.above - a.above);
    add('island', n, of, worst, 'wet cells standing above their own water surface');
  }

  // --- water with no surface drawn over it -------------------------------
  //
  // The sea plane is at y=0 and each labelled lake gets its own plane. A body
  // that got neither renders as a dry hole in the middle of a lake.
  if (want('missing-water')) {
    const r = R(11), worst = [];
    let n = 0, of = 0;
    for (let i = 0; i < 40000; i++) {
      const x = (r() - 0.5) * 2 * (G.MAP_HALF - 100);
      const z = (r() - 0.5) * 2 * (G.MAP_HALF - 100);
      if (!G.isWater(x, z)) continue;
      of++;
      const h = G.terrainHeight(x, z);
      // Sea level covers anything at or below 0. Anything higher needs a lake
      // plane over it, or there is nothing between the player and the bed.
      if (h <= 0.05) continue;
      let covered = false;
      for (const l of (world.lakes || [])) {
        const p = l.position, g = l.geometry.parameters;
        if (Math.abs(x - p.x) <= g.width / 2 && Math.abs(z - p.z) <= g.height / 2 && p.y > h) { covered = true; break; }
      }
      if (!covered) {
        n++;
        if (worst.length < 6) worst.push({ x: Math.round(x), z: Math.round(z), h: +h.toFixed(2) });
      }
    }
    add('missing-water', n, of, worst, 'water cells with no plane above them');
  }

  // --- terrain poking through the road surface ---------------------------
  //
  // Raycast the DRAWN meshes. Comparing the terrain against the chord between
  // an edge's two end nodes measured a surface nobody renders -- meshRoad
  // subdivides by grade and by bow and samples the heightfield at every corner,
  // so the tarmac follows the ground far more closely than a chord does. That
  // check reported 9.2 % and was wrong; the only honest question is which mesh
  // the ray hits first.
  if (want('road-poke')) {
    d.scene.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const worst = [];
    let n = 0, of = 0;
    for (const [sx, sz] of roadSites(20, 31)) {
      settle(sx, sz);
      let took = 0;
      for (const e of city.edges) {
      if (took >= 140) break;
      if (e.elev || e.len < 12) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      if (!nearSite(a.x, a.z, sx, sz) || !nearSite(b.x, b.z, sx, sz)) continue;
      took++;
      for (let sI = 1; sI < 4; sI++) {
        const t = sI / 4;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const top = G.terrainHeight(x, z) + 8;
        rc.set(new THREE.Vector3(x, top, z), down);
        rc.far = 20;
        // Road surface only. world.group also carries flat/glow/glass/facade
        // meshes and tree canopies -- the scatter keeps a 0.8 m pad off the
        // TRUNK, not the canopy, so a canopy overhanging a narrow residential
        // street sits inside this ray's span. A hit on one makes the overlap
        // deeply negative, so the sample silently passes -- hiding a real
        // poke-through at exactly the points most likely to have clutter
        // overhead. Samples are on centrelines, so mats.walk is not expected.
        const hits = rc.intersectObject(world.group, true)
          .filter((h) => h.object.isMesh && h.object.material === world.mats.road);
        const terr = rc.intersectObject(world.terrainGroup, true);
        if (!hits.length || !terr.length) continue;
        of++;
        // Positive: the ground is drawn ABOVE the road surface at this point.
        const over = terr[0].point.y - hits[0].point.y;
        if (over > 0.02) {
          n++;
          if (worst.length < 40) worst.push({ x: Math.round(x), z: Math.round(z), over: +over.toFixed(2), cls: e.cls });
        }
      }
      }
    }
    worst.sort((p, q) => q.over - p.over);
    add('road-poke', n, of, worst, 'terrain drawn above the road surface it carries');
  }

  // --- things you sink into ----------------------------------------------
  //
  // roadLift() reports the paved lift at a point and groundAt() puts you on it.
  // If the query and the drawn surface disagree you stand inside the pavement
  // or float above it. Raycast the actual mesh and compare.
  if (want('sink')) {
    d.scene.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const worst = [];
    let n = 0, of = 0;
    // Sample on the paved surface specifically -- that is where the two
    // sources of truth exist and can disagree.
    const nodes = city.nodes;
    for (const [sx, sz] of roadSites(20, 53)) {
      settle(sx, sz);
      let took = 0;
      for (const nd of nodes) {
        if (took >= 60) break;
        if (nd.elev || !nearSite(nd.x, nd.z, sx, sz)) continue;
        took++;
      for (const [ox, oz] of [[0, 0], [4, 0], [0, 4], [-4, 0], [0, -4], [5, 5]]) {
        const x = nd.x + ox, z = nd.z + oz;
        if (!city.onRoad(x, z, 1.5, false) && city.roadLift(x, z) <= 0) continue;
        const lift = city.roadLift(x, z);
        const stand = city.groundAt(x, z, null, lift);
        rc.set(new THREE.Vector3(x, stand + 12, z), down);
        rc.far = 24;
        // Ground surfaces only. A ray that lands on a bollard, a bin or a kerb
        // face is not evidence that the pavement is at the wrong height, and
        // counting those inflated this check by about a twentieth.
        const hits = rc.intersectObject(world.group, true).filter((h) => h.object.isMesh
          && (h.object.material === world.mats.road || h.object.material === world.mats.walk));
        if (!hits.length) continue;
        of++;
        const surf = hits[0].point.y;
        const gap = surf - stand;   // positive: the mesh is above where you stand
        if (Math.abs(gap) > 0.10) {
          n++;
          if (worst.length < 40) worst.push({ x: Math.round(x), z: Math.round(z), gap: +gap.toFixed(2) });
        }
      }
      }
    }
    worst.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    add('sink', n, of, worst, 'drawn pavement disagreeing with the height you stand at');
  }

  // --- roofs that miss their building ------------------------------------
  //
  // REMOVED, because the defect it reported does not exist.
  //
  // It counted houses whose min-area rectangle is more elongated than 4.5:1 and
  // called them roofs a gable cannot sit on. That threshold was invented here
  // and never checked against meshGable, which sizes its eaves from the actual
  // w and d (a fixed 0.45 m overhang on all four sides) and runs the ridge along
  // the longer side -- so a terrace gets a long ridge and a low pitch, which is
  // what a terrace has. Nothing about elongation breaks it.
  //
  // Measured, on the three footprints this check named: with the gable built,
  // contiguous roof surface past the narrow wall was 0.4 m, 6.0 m and 5.8 m --
  // and with the gable SUPPRESSED it was 0 m, 6.0 m and 5.8 m. The metres are
  // neighbouring terrace roofs, which touch and so cannot be told apart by
  // contiguity; the gable's own contribution is the 0.45 m eave it is supposed
  // to have. The check was reporting the map's shape, not a defect.
  //
  // A drawn-geometry version would have to attribute roof surface to one
  // building, which in a terrace it cannot do. Better absent than green.

  // --- buildings standing in water ---------------------------------------
  if (want('building-in-water')) {
    const worst = [];
    let n = 0;
    const of = city.buildings.length;
    for (let bi = 0; bi < of; bi += 1) {
      const bd = city.buildings[bi];
      if (!G.isWater(bd.x, bd.z)) continue;
      // Piers and houseboats are real. A building whose base is well under the
      // water surface is not.
      const level = world.waterLevelAt(bd.x, bd.z);
      if (level === null) continue;
      if (bd.y > level - 1.2) continue;
      n++;
      if (worst.length < 6) worst.push({ x: Math.round(bd.x), z: Math.round(bd.z), under: +(level - bd.y).toFixed(1) });
    }
    worst.sort((a, b) => b.under - a.under);
    add('building-in-water', n, of, worst, 'buildings with their base well below the water covering them');
  }

  // --- elevated decks ----------------------------------------------------
  //
  // A deck that sits below the terrain it spans is a bridge through a hill; one
  // that meets its neighbour at a different height is a step in the road.
  if (want('bridge')) {
    // Raycast the DRAWN deck, not the node-to-node chord.
    //
    // meshViaduct lofts a deck between mitred edge points and the chord is not
    // that surface -- the same flaw that made road-poke read 9.2 % and
    // walk-on-road 2.95 % when both are actually clean. Settle a site over each
    // elevated span, then ask what is really there.
    d.scene.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const worst = [];
    let n = 0, of = 0;
    // Deck sites: one per cluster of elevated spans.
    const sites = [];
    for (const e of city.edges) {
      if (!e.elev) continue;
      // Cluster on the span's MIDPOINT. Keying on endpoint a alone can seat a
      // site off the end of a long span.
      const a = city.nodes[e.a], bN = city.nodes[e.b];
      const mx = (a.x + bN.x) / 2, mz = (a.z + bN.z) / 2;
      if (sites.some(([x, z]) => Math.abs(x - mx) < SITE_R && Math.abs(z - mz) < SITE_R)) continue;
      sites.push([mx, mz]);
      if (sites.length >= 22) break;
    }
    for (const [sx, sz] of sites) {
      settle(sx, sz);
      for (const e of city.edges) {
        if (!e.elev) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        if (!nearSite(a.x, a.z, sx, sz) || !nearSite(b.x, b.z, sx, sz)) continue;
        for (let sI = 1; sI < 4; sI++) {
          const t = sI / 4;
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const ground = G.terrainHeight(x, z);
          // Look down from well above the chord and take the highest road
          // surface -- that is the deck as drawn.
          const top = Math.max(ground, a.y + (b.y - a.y) * t) + 30;
          rc.set(new THREE.Vector3(x, top, z), down);
          rc.far = 80;
          const hits = rc.intersectObject(world.group, true)
            .filter((h) => h.object.isMesh && h.object.material === world.mats.road);
          if (!hits.length) continue;
          const deck = hits[0].point.y;
          of++;
          if (ground > deck + 0.5) {
            n++;
            if (worst.length < 40) worst.push({ x: Math.round(x), z: Math.round(z), buried: +(ground - deck).toFixed(2) });
          }
        }
      }
    }
    worst.sort((a, b) => b.buried - a.buried);
    // Say what the sampling misses, rather than letting a rate imply the whole
    // map was looked at. 22 sites cover 62.1 % of elevated edges; measured, no
    // span over 100 m is dropped, so the long floating crossings are all in.
    // The same cap applies to sink / road-poke / walk-on-road.
    add('bridge', n, of, worst,
      'elevated deck buried under the terrain it spans (22 sites, ~62 % of elevated edges)');
  }

  // --- pavement crossing a carriageway -----------------------------------
  //
  // Raycast for the pavement MATERIAL at points that are on a carriageway. The
  // previous version computed where a strip would be offset to and asked
  // whether that spot was tarmac -- which measures intent, not geometry: a
  // piece the builder already rejected still counted, and the figure never
  // moved when the builder's own test was improved. Only what is drawn counts.
  if (want('walk-on-road')) {
    d.scene.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const worst = [];
    let n = 0, of = 0;
    // Site-by-site, like every other raycast check. This one settled inside the
    // innermost loop -- once per sample, scattered across the whole map --
    // which is the exact cost the settle helper's own comment warns against.
    for (const [sx, sz] of roadSites(20, 71)) {
      settle(sx, sz);
      let took = 0;
      for (const e of city.edges) {
        if (took >= 140) break;
        if (e.elev || e.len < 20) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        if (!nearSite(a.x, a.z, sx, sz) || !nearSite(b.x, b.z, sx, sz)) continue;
        took++;
        for (let sI = 1; sI < 4; sI++) {
          const t = sI / 4;
          // Sample the carriageway itself: pavement drawn here is pavement in
          // the road, whichever strip put it there.
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          if (!city.onRoad(x, z, 0, false)) continue;
          rc.set(new THREE.Vector3(x, G.terrainHeight(x, z) + 8, z), down);
          rc.far = 20;
          const hits = rc.intersectObject(world.group, true).filter((h) => h.object.isMesh
            && (h.object.material === world.mats.road || h.object.material === world.mats.walk));
          if (!hits.length) continue;
          of++;
          if (hits[0].object.material === world.mats.walk) {
            n++;
            if (worst.length < 8) worst.push({ x: Math.round(x), z: Math.round(z), cls: e.cls });
          }
        }
      }
    }
    add('walk-on-road', n, of, worst, 'pavement drawn as the top surface of a carriageway');
  }

  return JSON.stringify(out);
})()`;

async function main() {
  const chrome = launch();
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try {
        page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
          .find((t) => t.type === 'page');
      } catch { /* not up */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise((res) => {
      ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res);
    });
    const evaluate = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await evaluate('!!window.__dbg')) break;
    }
    const res = JSON.parse(await evaluate(CHECKS));

    if (JSON_OUT) { console.log(JSON.stringify(res, null, 2)); return; }

    let bad = 0;
    console.log('check                 count   sampled     rate  worst');
    for (const c of res) {
      if (c.n > 0) bad++;
      const w = c.worst.map((o) => {
        const k = Object.keys(o).filter((k2) => k2 !== 'x' && k2 !== 'z')[0];
        return `(${o.x},${o.z}${k ? ' ' + o[k] : ''})`;
      }).join(' ');
      console.log(
        `${c.name.padEnd(20)}${String(c.n).padStart(6)}${String(c.of).padStart(10)}`
        + `${(c.rate + '%').padStart(9)}  ${w}`
      );
    }
    console.log('');
    for (const c of res) if (c.n > 0) console.log(`  ${c.name}: ${c.note}`);
    console.log(`\n${bad} of ${res.length} checks found something.`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('jank failed:', e.message); process.exitCode = 1; });
