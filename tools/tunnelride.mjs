// Ride the SR-99 bores THE WAY A PLAYER DOES.
//
// tools/tunneldrive.mjs starts a traffic car already at the mouth and steers
// by writing `v.heading` directly, so it can say nothing about getting IN:
// whether the street a player is actually on leads into the cutting, whether
// the headwall, a building's collision box or a lip at the mouth stops the
// car, whether the car falls through a gap between the ramp and the deck.
// This one takes the player's own car ~300 m up the SURFACE approach and
// drives with the same input the stick produces (`input.x`, `input.gasAmt`),
// through `player.update`, so every collision and ground guard a player meets
// is the one it meets -- then logs y against the deck, raw cover, speed and
// progress for every frame, end to end.
//
// Rides:  sb        enter the southbound bore at the north portal (Aurora)
//         nb        enter the northbound bore at the south portal (SODO)
//         sb-wrong  southbound down the NORTHBOUND bore (its exit, wrong way)
//         nb-wrong  northbound up the SOUTHBOUND bore
//
// Modes:  default   FIXED-DT STEPPING. The game is paused and the harness
//                   calls player/traffic/world update itself at dt = 1/60 in
//                   batches inside one evaluate, so SwiftShader draws one frame
//                   per batch instead of per step: a 3.6 km ride takes minutes,
//                   not the hour a rendered ride takes at ~5 fps.
//         --real    the page's own frame loop at whatever dt it manages, with
//                   the autopilot hooked in front of player.update. Slow; use
//                   it to confirm a stepped result once.
//
// Flags:  --hop       on a failure, log it, carry the car 40 m on and keep
//                     riding, so one run lists EVERY failure on the route
//         --notraffic no traffic (isolates geometry from AI cars)
//         --shots DIR chase-camera shots at fixed stations (approach, mouth,
//                     inside, mid-bore, exit)
//         --speed N   cruise target in m/s (default 24, ~86 km/h)
//
// Usage:  python3 -m http.server 8000; node tools/tunnelride.mjs sb [--hop]
// Prints one JSON line per event and a summary line starting "RIDE".
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const RIDE = args.find((a) => /^(sb|nb)(-wrong)?$/.test(a)) || 'sb';
function argVal(k) { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; }
const REAL = args.includes('--real');
const HOP = args.includes('--hop');
const NOTRAFFIC = args.includes('--notraffic');
const SHOTS = argVal('--shots');
const SPEED = +(argVal('--speed') || 24);
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9244;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---- page side: everything below is serialised into the page ---------------
function pageInit(cfg) {
  const d = window.__dbg, c = d.city, G = d.G, p = d.player;
  const distToSegP = (x, z, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    return Math.hypot(x - ax - dx * t, z - az - dz * t);
  };
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  // Direction a oneway edge lets you travel from node ni: +1 out, -1 in, 0 two-way.
  const flow = (e, ni) => (e.oneway ? (e.a === ni ? 1 : -1) : e.onewayRev ? (e.a === ni ? -1 : 1) : 0);
  const ports = [];
  for (let ni = 0; ni < c.nodes.length; ni++) {
    const n = c.nodes[ni];
    const tun = n.e.filter((k) => c.edges[k].tunnel && !c.edges[k].elev && c.edges[k].cls === 'hwy'
      && /99/.test(c.edges[k].name || ''));
    const surf = n.e.filter((k) => !c.edges[k].tunnel && c.edges[k].cls === 'hwy');
    if (!tun.length || !surf.length) continue;
    ports.push({ ni, x: n.x, z: n.z, tk: tun[0], sk: surf[0],
      entry: flow(c.edges[tun[0]], ni) === 1, north: n.z < 0 });
  }
  const want = {
    sb: (q) => q.north && q.entry, nb: (q) => !q.north && q.entry,
    'sb-wrong': (q) => q.north && !q.entry, 'nb-wrong': (q) => !q.north && !q.entry,
  }[cfg.ride];
  const P0 = ports.find(want);
  const wrong = /wrong/.test(cfg.ride);
  // Tunnel leg: Dijkstra over tunnel edges from the entry portal to the far
  // hwy portal of the same bore, respecting oneway unless riding wrong way.
  const dist = new Map([[P0.ni, 0]]), prevE = new Map();
  const heap = [[0, P0.ni]];
  const farPorts = new Set(ports.filter((q) => q.north !== P0.north).map((q) => q.ni));
  let goal = -1;
  while (heap.length) {
    heap.sort((a, b) => a[0] - b[0]);
    const [dd, ni] = heap.shift();
    if (dd > dist.get(ni)) continue;
    if (farPorts.has(ni)) { goal = ni; break; }
    for (const k of c.nodes[ni].e) {
      const e = c.edges[k];
      if (!e.tunnel || e.elev) continue;
      const f = flow(e, ni);
      if (!wrong && f === -1) continue;
      if (wrong && f === 1) continue;
      const o = e.a === ni ? e.b : e.a;
      const nd = dd + e.len * (e.cls === 'hwy' ? 1 : 3);
      if (nd < (dist.has(o) ? dist.get(o) : 1e18)) { dist.set(o, nd); prevE.set(o, k); heap.push([nd, o]); }
    }
  }
  const tunNodes = [];
  for (let ni = goal; ni !== P0.ni;) { tunNodes.push(ni); const k = prevE.get(ni); const e = c.edges[k]; ni = e.a === ni ? e.b : e.a; }
  tunNodes.push(P0.ni); tunNodes.reverse();
  // Surface legs: walk hwy/widest surface edges away from a portal node.
  const walkSurf = (start, len) => {
    const out = []; let cur = start, prevK = -1, dd = 0;
    while (dd < len) {
      let best = null;
      for (const k of c.nodes[cur].e) {
        const e = c.edges[k];
        if (e.tunnel || k === prevK) continue;
        if (best === null || (e.cls === 'hwy') > (c.edges[best].cls === 'hwy')
          || ((e.cls === 'hwy') === (c.edges[best].cls === 'hwy') && e.hw > c.edges[best].hw)) best = k;
      }
      if (best === null) break;
      const e = c.edges[best]; cur = e.a === cur ? e.b : e.a; prevK = best; dd += e.len;
      out.push(cur);
    }
    return out;
  };
  const approach = walkSurf(P0.ni, 320).reverse();
  const exitN = walkSurf(goal, 220);
  const nodes = [...approach, ...tunNodes, ...exitN];
  const route = [];
  let s = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = c.nodes[nodes[i]];
    if (i) s += Math.hypot(n.x - route[i - 1].x, n.z - route[i - 1].z);
    route.push({ ni: nodes[i], x: n.x, z: n.z, y: n.y, s, tun: !!n.tunnel || tunNodes.includes(nodes[i]) });
  }
  const sEntry = route[approach.length].s, sExit = route[approach.length + tunNodes.length - 1].s;
  const total = route[route.length - 1].s;

  const R = window.__ride = {
    cfg, route, sEntry, sExit, total, events: [], tele: [], seg: 0, sNow: 0, lat: 0,
    t: 0, hist: [], hops: 0, done: null, maxS: 0, minCover: 1e9, maxCover: -1e9,
    shotsTaken: {},
  };
  // Diagnostic taps on the two solid-object queries: what did the car touch
  // this frame, before the push-out moved it clear?
  {
    const ob = c.obstacleHit, bb = c.barrierHit;
    c.barrierHit = function (...a) { const r = bb.apply(this, a); if (r && a[3] === p.vehicle?.y) R.lastBarrier = { t: R.t, pen: r.pen }; return r; };
    c.obstacleHit = function (...a) { const r = ob.apply(this, a); if (r && a[3] === p.vehicle?.y) R.lastOb = { t: R.t, pen: r.pen }; return r; };
  }
  // Where on the route is (x,z)? Search a window around the last segment, so a
  // twin bore running alongside never steals the projection.
  R.project = (x, z) => {
    let best = null;
    for (let i = Math.max(0, R.seg - 3); i < Math.min(route.length - 1, R.seg + 6); i++) {
      const a = route[i], b = route[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      const t = Math.max(0, Math.min(L, (x - a.x) * ux + (z - a.z) * uz));
      const px = a.x + ux * t, pz = a.z + uz * t;
      const dd = Math.hypot(x - px, z - pz);
      if (!best || dd < best.d) best = { d: dd, i, s: a.s + t, y: a.y + (b.y - a.y) * (t / L),
        lat: (x - a.x) * -uz + (z - a.z) * ux, tun: a.tun && b.tun };
    }
    return best;
  };
  R.pointAt = (sq) => {
    sq = Math.max(0, Math.min(total, sq));
    let i = 0;
    while (i < route.length - 2 && route[i + 1].s < sq) i++;
    const a = route[i], b = route[i + 1];
    const f = (sq - a.s) / ((b.s - a.s) || 1);
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y + (b.y - a.y) * f,
      h: Math.atan2(b.x - a.x, b.z - a.z) };
  };
  R.placeCar = (sq, speed) => {
    const v = p.vehicle, q = R.pointAt(sq);
    v.x = q.x; v.z = q.z; v.heading = q.h;
    const tunHere = R.project(q.x, q.z);
    v.y = (tunHere && tunHere.tun && sq > R.sEntry + 60 && sq < R.sExit - 60)
      ? q.y + 0.3 : c.groundAt(q.x, q.z, null);
    v.vy = 0; v.vLong = speed; v.vLat = 0;
    p.camFloor = null;
  };
  // Start: a sedan on the approach, player in it.
  const q0 = R.pointAt(0);
  const car = d.traffic.spawnAt(q0.x, q0.z, q0.h, 'sedan', 0x3366aa, 'free');
  p.enterVehicle(car);
  R.placeCar(0, 0);
  if (cfg.from) {
    // --from S: start S metres along the route, relative to the entry portal
    const sq = sEntry + cfg.from;
    R.seg = Math.max(0, route.findIndex((q) => q.s > sq) - 1);
    R.placeCar(sq, 18);
  }
  p.camYaw = q0.h + Math.PI;
  if (cfg.notraffic) {
    for (const v of [...d.traffic.cars]) if (v !== car) d.traffic.remove(v);
  }

  // The autopilot writes what a stick would: input.x in [-1, 1] and a throttle.
  R.drive = (input) => {
    const v = p.vehicle; if (!v) return;
    const pr = R.project(v.x, v.z);
    if (pr) { R.seg = pr.i; }
    const sp = Math.abs(v.vLong);
    const look = Math.max(10, Math.min(30, 8 + sp * 0.7));
    const tgt = R.pointAt((pr ? pr.s : 0) + look);
    const want = Math.atan2(tgt.x - v.x, tgt.z - v.z);
    const dh = wrap(want - v.heading);
    // +steer raises heading (left), and steer = -input.x
    input.x = Math.max(-1, Math.min(1, -dh * 3));
    // slow for bends ahead
    const far = R.pointAt((pr ? pr.s : 0) + 60);
    const bend = Math.abs(wrap(Math.atan2(far.x - v.x, far.z - v.z) - v.heading));
    const vt = cfg.speed * (bend > 0.5 ? 0.55 : bend > 0.25 ? 0.8 : 1);
    input.gas = sp < vt; input.gasAmt = sp < vt ? 1 : 0;
    input.brake = sp > vt + 4; input.brakeAmt = sp > vt + 4 ? 1 : 0;
    input.y = 0; input.hand = false; input.attack = false;
  };
  R.event = (kind, extra) => {
    const v = p.vehicle;
    const ev = { kind, t: +R.t.toFixed(1), s: Math.round(R.sNow), of: Math.round(total),
      rel: R.sNow < sEntry ? 'approach ' + Math.round(R.sNow - sEntry)
        : R.sNow > sExit ? 'exit +' + Math.round(R.sNow - sExit) : 'bore +' + Math.round(R.sNow - sEntry),
      x: v ? +v.x.toFixed(1) : null, y: v ? +v.y.toFixed(2) : null, z: v ? +v.z.toFixed(1) : null,
      spd: v ? +v.vLong.toFixed(1) : null, ...extra };
    R.events.push(ev);
    return ev;
  };
  // After each simulated frame.
  R.observe = (dt) => {
    R.t += dt;
    const v = p.vehicle;
    if (!v) { R.event('lost-car'); R.done = 'lost-car'; return; }
    if (v.dead) { R.event('car-destroyed'); R.done = 'dead'; return; }
    const pr = R.project(v.x, v.z);
    R.sNow = pr.s; R.lat = pr.lat;
    if (pr.s > R.maxS) R.maxS = pr.s;
    const raw = G.terrainRaw(v.x, v.z);
    const cover = raw - v.y;
    const inBore = pr.tun && pr.s > sEntry + 80 && pr.s < sExit - 80;
    R.tele.push([+R.t.toFixed(2), Math.round(pr.s), +v.x.toFixed(1), +v.z.toFixed(1), +v.y.toFixed(2),
      +pr.y.toFixed(2), +raw.toFixed(1), +v.vLong.toFixed(1), +pr.lat.toFixed(1)]);
    if (R.tele.length > 200000) R.tele.shift();
    let fail = null;
    // WHAT STOPPED IT. A sudden loss of speed is a collision somewhere; ask
    // every solid thing the car answers to which one it was, at that frame.
    const spd = v.vLong;
    if (R.lastSpd !== undefined && R.lastSpd - spd > 4 && R.lastSpd > 6) {
      const rad = v.radius * 0.7;
      // The collision has already pushed the car clear by the time this runs,
      // so ask what it touched THIS frame (recorded by the wrappers below),
      // and which barrier segments are within reach, band included.
      const bh = R.lastBarrier && R.lastBarrier.t === R.t ? R.lastBarrier : null;
      const oh = R.lastOb && R.lastOb.t === R.t ? R.lastOb : null;
      const segs = [];
      const S = c.barrierSegs || [];
      for (let i = 0; i < S.length; i += 6) {
        const r = distToSegP(v.x, v.z, S[i], S[i + 1], S[i + 2], S[i + 3]);
        if (r > rad + 2.5 || v.y < S[i + 4] || v.y > S[i + 5]) continue;
        segs.push([+S[i].toFixed(1), +S[i + 1].toFixed(1), +S[i + 2].toFixed(1), +S[i + 3].toFixed(1),
          +S[i + 4].toFixed(1), +S[i + 5].toFixed(1), +r.toFixed(2)]);
      }
      let bld = null;
      for (const b of c.buildingsNear(v.x, v.z, 14)) {
        const cc = Math.cos(-b.rot), ss = Math.sin(-b.rot);
        const dx = v.x - b.x, dz = v.z - b.z;
        const lx = dx * cc - dz * ss, lz = dx * ss + dz * cc;
        if (Math.abs(lx) < b.w / 2 + v.radius * 0.8 + 1 && Math.abs(lz) < b.d / 2 + v.radius * 0.8 + 1) {
          bld = { bx: +b.x.toFixed(1), bz: +b.z.toFixed(1), by: +b.y.toFixed(1), bh: +b.h.toFixed(1) };
        }
      }
      R.event('hit', { from: +R.lastSpd.toFixed(1), barrier: bh ? +bh.pen.toFixed(2) : null,
        obstacle: oh ? +oh.pen.toFixed(2) : null, building: bld, segs: segs.slice(0, 4), cover: +cover.toFixed(1),
        lat: +pr.lat.toFixed(1), dy: +(v.y - pr.y).toFixed(2) });
    }
    R.lastSpd = spd;
    // below the deck it should be on, or above it -- only meaningful where the
    // route is a buried bore (the cutting's floor is the carved ground). Held
    // for 0.75 s, so a car briefly airborne off a grade break is not an eject.
    const off = inBore ? v.y - pr.y : 0;
    R.offT = Math.abs(off) > 3 ? (R.offT || 0) + dt : 0;
    if (R.offT > 0.75 && off > 0) fail = R.event('eject', { deck: +pr.y.toFixed(1), cover: +cover.toFixed(1) });
    else if (R.offT > 0.75) fail = R.event('fall', { deck: +pr.y.toFixed(1), cover: +cover.toFixed(1) });
    else if (Math.abs(pr.lat) > 16) fail = R.event('off-route', { lat: +pr.lat.toFixed(1) });
    R.hist.push([R.t, pr.s]);
    while (R.hist.length > 1 && R.hist[1][0] <= R.t - 5) R.hist.shift();
    if (!fail && R.hist[0][0] <= R.t - 4.9 && pr.s - R.hist[0][1] < 4) {
      fail = R.event('stall', { lat: +pr.lat.toFixed(1), deck: +pr.y.toFixed(1),
        ground: +c.groundAt(v.x, v.z, v.y + 0.6, 0).toFixed(2), raw: +raw.toFixed(1),
        terr: +G.terrainHeight(v.x, v.z).toFixed(1) });
    }
    if (fail) {
      if (!cfg.hop || R.hops >= 25) { R.done = fail.kind; return; }
      R.hops++;
      R.offT = 0; R.lastSpd = undefined;
      R.hist.length = 0;
      const sq = Math.max(R.maxS, pr.s) + 40;
      R.seg = Math.max(0, route.findIndex((q) => q.s > sq) - 1);
      R.placeCar(sq, 12);
      R.hist.length = 0;
      return;
    }
    if (pr.s > total - 25) { R.done = 'end'; }
  };
  R.pending = () => { let n = 0; for (const ch of d.world.chunks.values()) if (ch.lod !== ch.wantLod) n++; return n; };
  R.settle = (maxCalls) => {
    const v = p.vehicle || p;
    d.world.update(v.x, v.z, 60);
    for (let i = 0; i < maxCalls && R.pending() > 0; i++) d.world.update(v.x, v.z, 60);
  };
  R.stepN = (n) => {
    const dt = 1 / 60;
    for (let i = 0; i < n && !R.done; i++) {
      const input = d.controls.read();
      R.drive(input);
      p.update(dt, input, { x: 0, y: 0 }, d.controls, d.traffic, d.peds);
      const pos = p.position;
      const camDir = { x: pos.x - p.camPos.x, z: pos.z - p.camPos.z };
      const cl = Math.hypot(camDir.x, camDir.z) || 1; camDir.x /= cl; camDir.z /= cl;
      if (!cfg.notraffic) d.traffic.update(dt, pos.x, pos.z, camDir, p);
      d.world.update(pos.x, pos.z, 2);
      R.observe(dt);
    }
    // what the frame loop would have done for the picture
    p.applyCamera(d.camera);
    const pos = p.position;
    d.sun.position.set(pos.x - 215, pos.y + 200, pos.z - 150);
    d.sun.target.position.set(pos.x, pos.y, pos.z);
    d.sun.target.updateMatrixWorld();
    return R.status();
  };
  R.status = () => {
    const v = p.vehicle;
    return JSON.stringify({ t: +R.t.toFixed(1), s: Math.round(R.sNow), maxS: Math.round(R.maxS),
      of: Math.round(total), sEntry: Math.round(sEntry), sExit: Math.round(sExit),
      y: v ? +v.y.toFixed(1) : null, spd: v ? +v.vLong.toFixed(1) : null, lat: +R.lat.toFixed(1),
      done: R.done, events: R.events.length, hops: R.hops });
  };
  // --real: hook the autopilot and the observer into the page's own loop
  R.hookReal = () => {
    const orig = p.update.bind(p);
    p.update = (dt, input, look, controls, traffic, peds) => {
      if (!R.done) R.drive(input);
      orig(dt, input, look, controls, traffic, peds);
      if (!R.done) R.observe(dt);
    };
  };
  if (cfg.notraffic) d.traffic.update = () => {};
  return JSON.stringify({ ride: cfg.ride, entry: [Math.round(P0.x), Math.round(P0.z)],
    exit: [Math.round(c.nodes[goal].x), Math.round(c.nodes[goal].z)],
    sEntry: Math.round(sEntry), sExit: Math.round(sExit), total: Math.round(total),
    nodes: route.length, tunNodes: tunNodes.length });
}

// ---- node side --------------------------------------------------------------
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new',
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1100,650',
  '--no-first-run', `--user-data-dir=/tmp/auto-tride-${PORT}`, 'about:blank'], { stdio: 'ignore' });
let exitCode = 0;
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails || r.result?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails || r.result.exceptionDetails).slice(0, 1500));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  await ev(`window.__dbg.applyQuality('low', true)`);
  const cfg = { ride: RIDE, hop: HOP, notraffic: NOTRAFFIC, speed: SPEED,
    from: argVal('--from') !== undefined ? +argVal('--from') : null };
  if (!REAL) await ev('window.__dbg.game.paused = true');
  console.log('setup', await ev(`(${pageInit.toString()})(${JSON.stringify(cfg)})`));
  await ev('window.__ride.settle(3000)');

  const stations = SHOTS ? await ev(`JSON.stringify((() => { const R = window.__ride;
    return [['approach', R.sEntry - 110], ['cutting', R.sEntry - 35], ['mouth', R.sEntry + 25],
      ['inside', R.sEntry + 200], ['midbore', (R.sEntry + R.sExit) / 2], ['exit', R.sExit + 40]]; })())`) : '[]';
  const todo = JSON.parse(stations);
  const shoot = async (name) => {
    await ev('window.__ride.settle(3000)');
    if (!REAL) await ev('window.__ride.stepN(1)');
    await sleep(2500);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/${RIDE}-${name}.png`, Buffer.from(s.result.data, 'base64'));
    console.log('shot', name, await ev('window.__ride.status()'));
  };
  let seen = 0;
  const flush = async () => {
    const evs = JSON.parse(await ev(`JSON.stringify(window.__ride.events.slice(${seen}))`));
    for (const e of evs) console.log('EVENT', JSON.stringify(e));
    seen += evs.length;
  };
  const t0 = Date.now();
  let st;
  if (REAL) {
    await ev(`(() => { window.__dbg.controls.btn.gas = true; window.__ride.hookReal(); return 1; })()`);
    for (;;) {
      await sleep(3000);
      st = JSON.parse(await ev('window.__ride.status()'));
      await flush();
      while (todo.length && st.s >= todo[0][1]) await shoot(todo.shift()[0]);
      console.log('status', JSON.stringify(st), Math.round((Date.now() - t0) / 1000) + 's');
      if (st.done || Date.now() - t0 > 3 * 3600e3) break;
    }
  } else {
    for (let b = 0; ; b++) {
      // small batches just short of a shot station, so every build frames it
      // at the same place rather than wherever a 2 s batch happened to end
      const near = todo.length && todo[0][1] - (st ? st.s : 0) < 70;
      st = JSON.parse(await ev(`window.__ride.stepN(${near ? 8 : 120})`));
      await flush();
      while (todo.length && st.s >= todo[0][1]) await shoot(todo.shift()[0]);
      if (b % 10 === 0) {
        await ev('window.__ride.settle(400)');
        console.log('status', JSON.stringify(st), Math.round((Date.now() - t0) / 1000) + 's');
      }
      if (st.done || st.t > 900) break;
    }
  }
  await flush();
  const sum = JSON.parse(await ev(`(() => { const R = window.__ride, T = R.tele;
    let worstUp = 0, worstDown = 0, deepest = 0;
    for (let i = 1; i < T.length; i++) {
      const dy = T[i][4] - T[i - 1][4];
      if (dy > worstUp) worstUp = dy;
      if (dy < worstDown) worstDown = dy;
      if (T[i][6] - T[i][4] > deepest) deepest = T[i][6] - T[i][4];
    }
    const kinds = {};
    for (const e of R.events) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    const first = R.events[0] || null;
    return JSON.stringify({ ride: R.cfg.ride, done: R.done, t: +R.t.toFixed(1),
      advanced: Math.round(R.maxS), of: Math.round(R.total), sEntry: Math.round(R.sEntry), sExit: Math.round(R.sExit),
      entered: R.maxS > R.sEntry + 100, through: R.maxS > R.sExit + 20, hops: R.hops, kinds,
      first, deepestUnder: +deepest.toFixed(1), worstFrameRise: +worstUp.toFixed(2), worstFrameDrop: +worstDown.toFixed(2) });
  })()`));
  console.log('RIDE', JSON.stringify(sum));
  if (!sum.through || sum.hops) exitCode = 1;
  if (process.env.RIDE_TELE) writeFileSync(process.env.RIDE_TELE, await ev('JSON.stringify(window.__ride.tele)'));
} catch (err) {
  console.log('ERROR', err.message);
  exitCode = 2;
} finally { chrome.kill(); }
process.exit(exitCode);
