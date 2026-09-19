// Flight-camera trace: take off from Boeing Field, fly a scripted route over
// the hills and past the towers, and log what the chase camera does per frame.
//
//   node tools/flycam.mjs [tag] [--jitter] [--shots=DIR] [--frames=N]
//
// The sim is stepped at a FIXED dt with the game paused, driving updateDrive /
// updateCamera / world.update in a loop -- SwiftShader's ~5 fps real-time
// traces exaggerate every per-frame delta by an order of magnitude (see
// "Shimmer and jolt" in apps/auto/CLAUDE.md). `--jitter` replays the same
// route under an uneven frame clock (a 50-60 ms hitch every few frames, what a
// chunk build on a phone looks like), because a camera whose lag depends on dt
// is steady at 60 fps and shakes under exactly that clock.
//
// Reported per frame:
//   drel   how far the camera moved RELATIVE TO THE PLANE (m) -- a rigid rig
//          moves ~0, a clamp firing moves metres
//   dpx    how far the plane moved ON SCREEN (px at 1280 wide) -- the "the
//          camera jumps around" a player actually sees
//   dang   look-direction change (deg)
//   flags  ceiling clamp / floor clamp / boom pulled in by a building
//   pop-in chunks in the frustum with no geometry yet, and buildings that
//          materialise in view (a chunk gaining geometry that nothing drew)
//   roads  ROAD pop-in: a chunk gaining geometry in view whose streets the far
//          road layer was not already drawing (world.farRoadsCover, when the
//          build has one), in metres of carriageway and per class
//
// After the route (frame FRAMES) the plane is moved to 450 m over I-5 north of
// the ship canal, nose south, and flown for HIGH_FRAMES more for the `i5high`
// shot. Those frames are left out of every statistic: the move is a teleport.
//
// Every evaluation has a wall-clock limit (FLYCAM_EVAL_S, default 240 s) and a
// batch that exceeds it is reported with the frame it reached and what the
// streamer was doing -- a harness that waits forever cannot tell a stall in
// the game from one in itself.
//
// Targets any checkout via AUTO_HTTP_PORT, so a master tree can be traced with
// this same harness for an honest before/after.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const TAG = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'now';
const JITTER = process.argv.includes('--jitter');
const SHOTS = (process.argv.find((a) => a.startsWith('--shots=')) || '').slice(8);
const FRAMES = +((process.argv.find((a) => a.startsWith('--frames=')) || '').slice(9) || 13500);
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9341;
const OUT = process.env.FLYCAM_OUT || 'tools/data/flycam';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Frames to photograph, named. Same frame index on every build, so a pair is
// the same moment of the same flight.
const SHOT_AT = { beacon: 3500, firsthill: 5850, capitol: 7150, queenanne: 9000, bay: 10500, horizon: 12500 };
const HIGH_FRAMES = 900;
const EVAL_S = +(process.env.FLYCAM_EVAL_S || 240);

const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new',
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720',
  '--no-first-run', '--enable-precise-memory-info', `--user-data-dir=/tmp/auto-flycam-${PORT}`, 'about:blank'], { stdio: 'ignore' });

try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('CONSOLE ' + m.params.args.map((k) => k.value ?? k.description ?? '').join(' ').slice(0, 300));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e, limitS = EVAL_S) => {
    let timer;
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }),
      new Promise((res) => { timer = setTimeout(() => res({ timedOut: true }), limitS * 1000); }),
    ]);
    clearTimeout(timer);
    if (r.timedOut) throw new Error(`evaluate exceeded ${limitS} s -- ${e.slice(0, 120)}`);
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 400; i++) { await sleep(500); if (await ev('!!window.__dbg')) break; }
  await sleep(1500);

  await ev(`(() => {
    const d = window.__dbg, G = d.G, p = d.player, W = d.world, c = d.city, T = d.THREE;
    d.applyQuality('high', true);
    for (const k of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu','minimap'])
      { const e = document.getElementById(k); if (e) e.style.display = 'none'; }
    d.game.paused = true;
    const ap = G.LANDMARKS.find((l) => l.kind === 'airport');
    const AL = [Math.sin(0.52), Math.cos(0.52)], AC = [Math.cos(0.52), -Math.sin(0.52)];
    // Runway centreline, south end, nose up the runway toward downtown.
    const rx = ap.x + 1200 * AL[0], rz = ap.z + 1200 * AL[1];
    const v = d.traffic.cars.find((k) => k.spec.plane && !k.spec.floats);
    v.x = rx; v.z = rz; v.heading = 0.52 + Math.PI; v.vLong = 0; v.airborne = false;
    v.y = c.groundAt(rx, rz, null);
    p.enterVehicle(v);
    p.camYaw = v.heading + Math.PI;
    p.camPitch = 0.1;
    p.camFloor = null;
    p.camPos.set(v.x - Math.sin(v.heading) * 15, v.y + 4.6, v.z - Math.cos(v.heading) * 15);
    p.camLook.set(v.x, v.y + 2, v.z);
    // Route: over Beacon Hill low, through downtown below the tower tops, a
    // banked turn over Capitol Hill, Queen Anne, a dive over Elliott Bay and a
    // long climb out toward the horizon. y is ABSOLUTE, so the terrain moves
    // under a level plane the way it does in play.
    const R = [
      { x: 2100, z: 3750, y: 150 },   // Beacon Hill, ~50 m over the crest
      { x: 971, z: 226, y: 150 },     // First Hill
      { x: 305, z: -278, y: 110 },    // downtown, among the towers
      { x: 1468, z: -1389, y: 190 },  // Capitol Hill
      { x: -1718, z: -3129, y: 210 }, // Queen Anne
      { x: -1500, z: -600, y: 70 },   // dive over Elliott Bay
      { x: 1500, z: 3000, y: 380 },   // climb out, city ahead
      { x: 2600, z: 7000, y: 380 },
    ];
    let wi = 0;
    const orig = p.clearCamDist.bind(p);
    const S = window.__fly = { v, R, frame: 0, rows: [], pops: [], popBld: 0, hadGroup: new Set(), lastLod: W.flyLod, lodFlips: 0,
      roadPops: [], roadPopM: { hwy: 0, ramp: 0, art: 0, st: 0, res: 0 }, roadM: new Map(), counting: true };
    S.resetRoute = () => { wi = 0; };
    // Metres of drawn carriageway a chunk owns, by class (tunnels draw nothing
    // from the air). Owned the way buildChunkStep owns an edge: by its midpoint.
    const roadMetres = (cc) => {
      const k = cc.cx * 100000 + cc.cz;
      let r = S.roadM.get(k);
      if (r) return r;
      r = { hwy: 0, ramp: 0, art: 0, st: 0, res: 0 };
      for (const ei of cc.edges) {
        const e = c.edges[ei];
        if (e.tunnel) continue;
        const a = c.nodes[e.a], b = c.nodes[e.b];
        if (Math.floor((a.x + b.x) / 2 / 400) !== cc.cx || Math.floor((a.z + b.z) / 2 / 400) !== cc.cz) continue;
        r[e.cls] = (r[e.cls] || 0) + e.len;
      }
      S.roadM.set(k, r);
      return r;
    };
    p.clearCamDist = (t, want, h) => { const r = orig(t, want, h); S.pulled = want - r; return r; };
    const fr = new T.Frustum(), m4 = new T.Matrix4(), box = new T.Box3(), ndc = new T.Vector3();
    let prevRel = null, prevDir = null, prevNdc = null;
    S.step = (dt) => {
      const pitchTarget = () => {
        const w = R[wi];
        // Never below 45 m over the ground under the plane or 400 m ahead:
        // the dive toward the bay otherwise flies into Queen Anne's north slope.
        const ahead = G.terrainHeight(v.x + v.forward.x * 400, v.z + v.forward.z * 400);
        const floorY = Math.max(G.terrainHeight(v.x, v.z), ahead) + 45;
        return Math.max(-1, Math.min(1, (Math.max(w.y, floorY) - v.y) / 35));
      };
      let steer = 0, pitch = 0;
      if (!v.airborne) { pitch = v.vLong > 28 ? 1 : 0; }
      else {
        const w = R[wi];
        const want = Math.atan2(w.x - v.x, w.z - v.z);
        let e = want - v.heading; e = Math.atan2(Math.sin(e), Math.cos(e));
        steer = Math.max(-1, Math.min(1, e * 2.2));
        pitch = pitchTarget();
        if (Math.hypot(w.x - v.x, w.z - v.z) < 220 && wi < R.length - 1) wi++;
      }
      const input = { x: -steer, y: pitch, gas: true, gasAmt: 1, brake: false, brakeAmt: 0, hand: false };
      S.pulled = 0;
      p.updateDrive(dt, input, d.traffic, d.peds);
      p.updateCamera(dt, input);
      const t = { x: v.x, y: v.y, z: v.z };
      // Same feed as main.js frame().
      W.playerAlt = Math.max(0, v.y - G.terrainHeight(v.x, v.z));
      W.playerFwdX = Math.abs(v.vLong) > 8 ? v.forward.x : 0;
      W.playerFwdZ = Math.abs(v.vLong) > 8 ? v.forward.z : 0;
      W.playerFlying = !!v.airborne;
      if (d.scene.fog && W.__baseFog === undefined) W.__baseFog = d.scene.fog.density;
      W.update(v.x, v.z, 2);
      if (W.flyLod !== S.lastLod) { S.lodFlips++; S.lastLod = W.flyLod; }
      p.applyCamera(d.camera);
      d.camera.updateMatrixWorld(true);
      const deckAt = c.groundAt(t.x, t.z, t.y, 0);
      const ceilFired = ('camClamp' in p) ? p.camClamp === 'ceil' : Math.abs(p.camPos.y - (deckAt + 5.4 - 0.6)) < 1e-6;
      const floorFired = Math.abs(p.camPos.y - p.camFloor) < 1e-6;
      const rel = [p.camPos.x - t.x, p.camPos.y - t.y, p.camPos.z - t.z];
      const dir = new T.Vector3().subVectors(p.camLook, p.camPos).normalize();
      ndc.set(t.x, t.y + 1.2, t.z).project(d.camera);
      const px = [ndc.x * 640, ndc.y * 360];
      const row = { f: S.frame, x: Math.round(t.x), z: Math.round(t.z), y: +t.y.toFixed(1), alt: +W.playerAlt.toFixed(0), sp: +v.vLong.toFixed(1),
        drel: prevRel ? Math.hypot(rel[0] - prevRel[0], rel[1] - prevRel[1], rel[2] - prevRel[2]) : 0,
        dpx: prevNdc ? Math.hypot(px[0] - prevNdc[0], px[1] - prevNdc[1]) : 0,
        dang: prevDir ? Math.acos(Math.min(1, dir.dot(prevDir))) * 180 / Math.PI : 0,
        boom: +Math.hypot(rel[0], rel[2]).toFixed(1), relY: +rel[1].toFixed(2),
        ceil: ceilFired ? 1 : 0, floor: floorFired ? 1 : 0, pulled: +(S.pulled || 0).toFixed(1), air: v.airborne ? 1 : 0 };
      prevRel = rel; prevDir = dir; prevNdc = px;
      // pop-in, in the frustum only
      fr.setFromProjectionMatrix(m4.multiplyMatrices(d.camera.projectionMatrix, d.camera.matrixWorldInverse));
      let missing = 0, stale = 0, inView = 0;
      for (const ch of W.chunks.values()) {
        const cc = c.chunks.get(c.chunkKey(ch.cx, ch.cz));
        if (!cc || (!cc.buildings.length && !cc.edges.length)) continue;
        const x0 = ch.cx * 400, z0 = ch.cz * 400;
        box.min.set(x0, -20, z0); box.max.set(x0 + 400, 320, z0 + 400);
        if (!fr.intersectsBox(box)) continue;
        inView++;
        const covered = W.farMassCovers ? W.farMassCovers(ch) : false;
        // Missing counts ROADS as well, so the far massing layer cannot hide it.
        if (!ch.group) missing++;
        else if (ch.lod < ch.wantLod) stale++;
        if (ch.group && !S.hadGroup.has(ch.key)) {
          S.hadGroup.add(ch.key);
          if (S.frame > 0 && S.counting) {
            // Roads: what the chunk now draws, less what the far road layer
            // was already drawing there (by class, at this distance).
            const own = roadMetres({ cx: ch.cx, cz: ch.cz, edges: cc.edges });
            const cov = W.farRoadsCover ? W.farRoadsCover(ch, p.camPos.x, p.camPos.z) : null;
            let popped = 0;
            for (const k in own) {
              const m = Math.max(0, own[k] - (cov ? cov[k] || 0 : 0));
              S.roadPopM[k] = (S.roadPopM[k] || 0) + m;
              popped += m;
            }
            if (popped > 20) {
              const dist = Math.hypot(x0 + 200 - p.camPos.x, z0 + 200 - p.camPos.z);
              S.roadPops.push({ f: S.frame, dist: Math.round(dist), m: Math.round(popped),
                fade: W.frU ? +W.frU.frFade.value.toFixed(2) : null });
            }
          }
          if (!covered && S.frame > 0 && S.counting) {
            let nb = 0;
            for (const bi of cc.buildings) { const b = c.buildings[bi]; if (b.h < 16 && b.w * b.d < 1400) nb++; }
            const dist = Math.hypot(x0 + 200 - p.camPos.x, z0 + 200 - p.camPos.z);
            S.pops.push({ f: S.frame, dist: Math.round(dist), nb });
            S.popBld += nb;
          }
        }
      }
      for (const k of S.hadGroup) if (!W.chunks.has(k)) S.hadGroup.delete(k);
      row.missing = missing; row.stale = stale; row.inView = inView;
      if (S.counting) S.rows.push(row);
      S.frame++;
      return wi;
    };
    return true;
  })()`);

  // Memory with the game booted and nothing flown yet, after a full GC.
  await send('HeapProfiler.enable');
  await send('HeapProfiler.collectGarbage');
  const heapBoot = await ev('performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null');

  // Deterministic uneven clock: a hitch every 7th frame, a long one every 23rd.
  const dtAt = (f) => !JITTER ? 1 / 60 : (f % 23 === 11 ? 0.06 : f % 7 === 3 ? 0.05 : 1 / 60);
  const shotFrames = Object.entries(SHOT_AT).sort((a, b) => a[1] - b[1]);
  let f = 0;
  const shotStats = {};
  const t0 = Date.now();
  const stage = [...shotFrames, ['end', FRAMES], ['i5high', FRAMES + HIGH_FRAMES]];
  for (const [name, at] of stage) {
    const until = name === 'i5high' ? at : Math.min(at, FRAMES);
    if (name === 'i5high') {
      // 450 m over I-5 north of the ship canal, nose south down the freeway.
      await ev(`(() => {
        const d = window.__dbg, S = window.__fly, v = S.v, G = d.G, p = d.player;
        S.counting = false;
        v.x = 1150; v.z = -9000; v.y = G.terrainHeight(v.x, v.z) + 450;
        v.heading = Math.atan2(1077 - v.x, -2647 - v.z);
        v.airborne = true;
        S.R.length = 0; S.R.push({ x: 1077, z: -2647, y: v.y }, { x: 693, z: -676, y: v.y });
        S.resetRoute();
        p.camPos.set(v.x - Math.sin(v.heading) * 17, v.y + 4.6, v.z - Math.cos(v.heading) * 17);
        return true;
      })()`);
    }
    while (f < until) {
      const n = Math.min(300, until - f);
      const dts = JSON.stringify(Array.from({ length: n }, (_, i) => dtAt(f + i)));
      const tb = Date.now();
      try {
        await ev(`(() => { const S = window.__fly; for (const dt of ${dts}) S.step(dt); return S.frame; })()`);
      } catch (err) {
        // Where did it stop? A second evaluation cannot run while the first
        // is still executing, so a timeout here that the probe also hits is a
        // page that never yields -- a real stall, not the harness.
        let where = 'page unresponsive';
        try { where = await ev(`JSON.stringify({ frame: window.__fly.frame, x: Math.round(window.__fly.v.x), z: Math.round(window.__fly.v.z), todo: [...window.__dbg.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length })`, 20); } catch {}
        throw new Error(`${err.message}\n  batch from frame ${f}: ${where}`);
      }
      f += n;
      if (process.env.FLYCAM_PROGRESS) console.log(`frame ${f} (${((Date.now() - tb) / 1000).toFixed(1)} s)`);
    }
    if (name === 'end' || !SHOTS || f !== at) continue;
    // Light and fog the frame the way main.js would, then let two frames draw.
    await ev(`(() => {
      const d = window.__dbg, p = d.player, v = window.__fly.v, G = d.G, W = d.world;
      if (d.scene.fog) d.scene.fog.density = W.__baseFog * (1 + Math.min(2.2, W.playerAlt / 220));
      const fwd = new d.THREE.Vector3(0, 0, -1).applyQuaternion(d.camera.quaternion);
      const sx = v.x + fwd.x * 90, sz = v.z + fwd.z * 90;
      d.sun.position.set(sx - 215, v.y + 200, sz - 150);
      d.sun.target.position.set(sx, v.y, sz);
      d.sun.target.updateMatrixWorld();
      p.applyCamera(d.camera);
      return true;
    })()`);
    await sleep(2500);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
    const stats = await ev('JSON.stringify(window.__dbg.sceneStats)');
    shotStats[name] = JSON.parse(stats);
    console.log(`shot ${name} at frame ${f}`, stats);
  }

  await send('HeapProfiler.collectGarbage');
  const res = JSON.parse(await ev(`JSON.stringify({ rows: window.__fly.rows, pops: window.__fly.pops, popBld: window.__fly.popBld, lodFlips: window.__fly.lodFlips,
    roadPops: window.__fly.roadPops, roadPopM: window.__fly.roadPopM,
    far: (() => { const W = window.__dbg.world; return { massBytes: W.farMassBytes || 0, massMs: +(W.farMassMs || 0).toFixed(0), massFrames: W.farMassFrames || 0,
      roadBytes: W.farRoadBytes || 0, roadCount: W.farRoadCount || 0, roadMs: +(W.farRoadMs || 0).toFixed(0), roadFrames: W.farRoadFrames || 0, roadMaxStep: +(W.farRoadMaxStep || 0).toFixed(1) }; })(),
    heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null })`));
  const air = res.rows.filter((r) => r.air && r.f > 30);
  const q = (arr, k, fr) => { const s = arr.map((r) => r[k]).sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * fr))].toFixed(3) : 0; };
  const sum = {
    tag: TAG, jitter: JITTER, frames: res.rows.length, airborne: air.length, secs: ((Date.now() - t0) / 1000).toFixed(0),
    drel: { p50: q(air, 'drel', 0.5), p99: q(air, 'drel', 0.99), p999: q(air, 'drel', 0.999), max: q(air, 'drel', 1) },
    dpx: { p50: q(air, 'dpx', 0.5), p99: q(air, 'dpx', 0.99), p999: q(air, 'dpx', 0.999), max: q(air, 'dpx', 1) },
    dang: { p50: q(air, 'dang', 0.5), p99: q(air, 'dang', 0.99), max: q(air, 'dang', 1) },
    boom: { min: q(air, 'boom', 0), max: q(air, 'boom', 1) }, relY: { min: q(air, 'relY', 0), max: q(air, 'relY', 1) },
    framesCeil: air.filter((r) => r.ceil).length, framesFloor: air.filter((r) => r.floor).length,
    framesPulled: air.filter((r) => r.pulled > 0.5).length,
    jumpsOver1m: air.filter((r) => r.drel > 1).length, jumpsOver20px: air.filter((r) => r.dpx > 20).length,
    missingInView: { mean: +(air.reduce((a, r) => a + r.missing, 0) / Math.max(1, air.length)).toFixed(2), max: q(air, 'missing', 1), framesAny: air.filter((r) => r.missing > 0).length },
    popEvents: res.pops.length, popBuildings: res.popBld,
    popNear: res.pops.filter((k) => k.dist < 1200 && k.nb > 0).length,
    roadPopEvents: res.roadPops.length,
    roadPopKm: +(Object.values(res.roadPopM).reduce((a, b) => a + b, 0) / 1000).toFixed(1),
    roadPopKmByClass: Object.fromEntries(Object.entries(res.roadPopM).map(([k, m]) => [k, +(m / 1000).toFixed(1)])),
    roadPopNear: res.roadPops.filter((k) => k.dist < 1200).length,
    lodFlips: res.lodFlips, far: res.far, heapBootMB: heapBoot, heapFlyMB: res.heap,
    exceptions: logs.length, shotStats,
  };
  console.log(JSON.stringify(sum, null, 1));
  if (logs.length) console.log(logs.slice(0, 5).join('\n'));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${TAG}${JITTER ? '-jitter' : ''}.json`, JSON.stringify({ summary: sum, rows: res.rows, pops: res.pops, roadPops: res.roadPops }));
} finally { chrome.kill('SIGKILL'); }
