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
const RIDE = args.find((a) => /^((sb|nb)(-wrong)?|sbx(-rev)?)$/.test(a)) || 'sb';
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
    // SURFACE rides: out of the southbound exit and on south along the SR-99
    // surface past the northbound entry cutting, and the same road back.
    sbx: (q) => !q.north && !q.entry, 'sbx-rev': (q) => !q.north && !q.entry,
  }[cfg.ride];
  const P0 = ports.find(want);
  const wrong = /wrong/.test(cfg.ride);
  const surface = /^sbx/.test(cfg.ride);
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
  if (!surface) {
    for (let ni = goal; ni !== P0.ni;) { tunNodes.push(ni); const k = prevE.get(ni); const e = c.edges[k]; ni = e.a === ni ? e.b : e.a; }
    tunNodes.push(P0.ni); tunNodes.reverse();
  }
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
  let nodes, nApp, nTun;
  if (surface) {
    // [portal, ...surface south]; reversed for the northbound ride. Only the
    // stretch clear of the exit's own cutting (100 m) is judged for drops.
    nodes = [P0.ni, ...walkSurf(P0.ni, 560)];
    if (cfg.ride === 'sbx-rev') nodes.reverse();
    nApp = 0; nTun = 0;
  } else {
    const approach = walkSurf(P0.ni, 320).reverse();
    const exitN = walkSurf(goal, 220);
    nodes = [...approach, ...tunNodes, ...exitN];
    nApp = approach.length; nTun = tunNodes.length;
  }
  const route = [];
  let s = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = c.nodes[nodes[i]];
    if (i) s += Math.hypot(n.x - route[i - 1].x, n.z - route[i - 1].z);
    route.push({ ni: nodes[i], x: n.x, z: n.z, y: n.y, s,
      tun: !surface && (!!n.tunnel || tunNodes.includes(nodes[i])) });
  }
  const total = route[route.length - 1].s;
  // For a surface ride, sEntry/sExit bound the judged stretch instead.
  const sEntry = surface ? (cfg.ride === 'sbx' ? 100 : 0) : route[nApp].s;
  const sExit = surface ? (cfg.ride === 'sbx' ? total : total - 100) : route[nApp + nTun - 1].s;

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
    // WRONG WAY, A DRIVER DODGES. Against the flow the centreline meets every
    // oncoming car head-on (cars collide as 4 m circles, lanes sit 3.1 m off
    // centre), and an AI car that has braked to a stop in front of a car
    // pushing it never yields: a stall that says nothing about the geometry.
    // So on a wrong-way ride the autopilot moves to the far side of the
    // nearest oncoming car on its deck within 45 m, 4.8 m off the line, and
    // back to the centre once the road ahead is clear. It still drives the
    // whole deck, walls included.
    if (wrong && pr) {
      let near = null;
      for (const o of d.traffic.cars) {
        if (o === v || o.mode !== 'traffic' || Math.abs(o.y - v.y) > 3) continue;
        const po = R.project(o.x, o.z);
        if (!po || po.d > 12) continue;
        const ahead = po.s - pr.s;
        if (ahead < -2 || ahead > 45) continue;
        if (!near || ahead < near.ahead) near = { ahead, lat: po.lat };
      }
      const want = near ? (near.lat > 0 ? -4.8 : 4.8) : 0;
      R.dodge = (R.dodge || 0) + Math.max(-0.08, Math.min(0.08, want - (R.dodge || 0)));
      if (R.dodge) {
        const q2 = R.pointAt(pr.s + look + 1);
        const ux = q2.x - tgt.x, uz = q2.z - tgt.z, ul = Math.hypot(ux, uz) || 1;
        // lat is measured to the LEFT of travel ((x,z) . (-uz, ux)), as project() does
        tgt.x += (-uz / ul) * R.dodge; tgt.z += (ux / ul) * R.dodge;
      }
    }
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
    // A WRONG-WAY RIDE MEETS EVERY ONCOMING CAR. The autopilot holds the
    // centreline and cannot dodge, and cars collide as circles (0.42 x length,
    // 4 m between two sedans' centres) on a two-lane deck whose lanes sit
    // 3.1 m either side of it -- so every car it meets is a shunt, and the
    // ride ends in 'car-destroyed' on traffic luck alone (it did on the base
    // build too). These rides judge the GEOMETRY, so the car is kept alive and
    // the shunts are counted instead.
    if (wrong && v.health < 100) { R.damaged = (R.damaged || 0) + 1; v.health = 100; }
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
      // and the nearest AI car: a car-to-car shunt shows as a speed loss with
      // nothing static in reach
      let car = null;
      for (const o of d.traffic.cars) {
        if (o === v) continue;
        const dd = Math.hypot(o.x - v.x, o.z - v.z);
        if (dd < 12 && (!car || dd < car.d)) car = { d: +dd.toFixed(1), dy: +(o.y - v.y).toFixed(1), mode: o.mode, spd: +o.vLong.toFixed(1) };
      }
      // and what the ground under the wheels says just ahead: a step there
      // is the other thing that stops a car with nothing in reach
      const f = v.forward, gy0 = c.groundAt(v.x, v.z, v.y + 0.6, c.roadLift(v.x, v.z));
      const ga = c.groundAt(v.x + f.x * 3, v.z + f.z * 3, v.y + 2.5, c.roadLift(v.x + f.x * 3, v.z + f.z * 3));
      R.event('hit', { car, stepAhead: +(ga - gy0).toFixed(2), lidHere: c.lidAt ? c.lidAt(v.x, v.z) !== null : null,
        from: +R.lastSpd.toFixed(1), barrier: bh ? +bh.pen.toFixed(2) : null,
        obstacle: oh ? +oh.pen.toFixed(2) : null, building: bld, segs: segs.slice(0, 4), cover: +cover.toFixed(1),
        lat: +pr.lat.toFixed(1), dy: +(v.y - pr.y).toFixed(2) });
    }
    R.lastSpd = spd;
    // fastest AI car near the player: a collision injecting energy shows here
    for (const o of d.traffic.cars) {
      if (o === v || Math.abs(o.x - v.x) > 30 || Math.abs(o.z - v.z) > 30) continue;
      if (Math.abs(o.vLong) > (R.maxAi || 0)) R.maxAi = Math.abs(o.vLong);
    }
    // below the deck it should be on, or above it -- only meaningful where the
    // route is a buried bore (the cutting's floor is the carved ground). Held
    // for 0.75 s, so a car briefly airborne off a grade break is not an eject.
    const off = inBore ? v.y - pr.y : 0;
    // TWIN-DECK CAPTURE: anywhere on the bore (portal to portal), riding more
    // than 1.5 m off this route's own deck for 3 m of travel or more is the
    // car standing on some other deck -- the twin's, before the decks were
    // stacked. Not a failure (the car still gets through), but counted.
    {
      const onBore = pr.tun && pr.s > sEntry && pr.s < sExit;
      const offC = onBore ? v.y - pr.y : 0;
      if (Math.abs(offC) > 1.5) {
        if (!R.cap) R.cap = { s0: pr.s, worst: 0 };
        if (Math.abs(offC) > Math.abs(R.cap.worst)) R.cap.worst = offC;
        R.cap.len = pr.s - R.cap.s0;
      } else if (R.cap) {
        if (R.cap.len >= 3) {
          R.captures = (R.captures || 0) + 1;
          R.event('capture', { at: Math.round(R.cap.s0 - sEntry), len: Math.round(R.cap.len), worst: +R.cap.worst.toFixed(2) });
        }
        R.cap = null;
      }
    }
    R.offT = Math.abs(off) > 3 ? (R.offT || 0) + dt : 0;
    if (R.offT > 0.75 && off > 0) fail = R.event('eject', { deck: +pr.y.toFixed(1), cover: +cover.toFixed(1) });
    else if (R.offT > 0.75) fail = R.event('fall', { deck: +pr.y.toFixed(1), cover: +cover.toFixed(1) });
    else if (Math.abs(pr.lat) > 16) fail = R.event('off-route', { lat: +pr.lat.toFixed(1) });
    // A DROP on a surface ride: 2 m+ below the road's own grade (raw ground +
    // lift) is a hole in the street, wherever it comes from.
    else if (surface && pr.s >= sEntry && pr.s <= sExit && v.y < raw + 0.3 - 2.0) {
      fail = R.event('drop', { below: +(raw + 0.3 - v.y).toFixed(1), terr: +G.terrainHeight(v.x, v.z).toFixed(1) });
    }
    R.hist.push([R.t, pr.s]);
    while (R.hist.length > 1 && R.hist[1][0] <= R.t - 5) R.hist.shift();
    if (!fail && R.hist[0][0] <= R.t - 4.9 && pr.s - R.hist[0][1] < 4) {
      // who is in the way: every AI car within 25 m, with its deck and speed
      const near = d.traffic.cars.filter((o) => o !== v && Math.hypot(o.x - v.x, o.z - v.z) < 80)
        .map((o) => [+(o.x - v.x).toFixed(1), +(o.z - v.z).toFixed(1), +(o.y - v.y).toFixed(1), +o.vLong.toFixed(1), o.mode, o.edge, o.dirSign, +(o.stuckT || 0).toFixed(1), +o.y.toFixed(2),
          (() => { const h = c.obstacleHit(o.x, o.z, o.radius * 0.7, o.y); return h ? [+h.pen.toFixed(2), +h.nx.toFixed(2), +h.nz.toFixed(2), h.kind || null] : null; })(),
          +c.groundAt(o.x, o.z, o.y + 0.6, c.roadLift(o.x, o.z)).toFixed(2),
          o.mode === 'traffic' ? (() => { const r = d.traffic.driveTraffic(o, 0, v.x, v.z, p); return [+r.throttle.toFixed(2), +r.brake.toFixed(2), +r.steer.toFixed(2)]; })() : null,
          +o.heading.toFixed(2), +(o.vLat || 0).toFixed(2)]);
      fail = R.event('stall', { near, lat: +pr.lat.toFixed(1), deck: +pr.y.toFixed(1),
        ground: +c.groundAt(v.x, v.z, v.y + 0.6, 0).toFixed(2), raw: +raw.toFixed(1),
        terr: +G.terrainHeight(v.x, v.z).toFixed(1) });
    }
    if (fail) {
      // --nofail: log it and keep driving from wherever the car ended up, so a
      // shot further on can show where the failure left it (a car in a pit).
      if (cfg.nofail) { R.hist.length = 0; R.offT = 0; return; }
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
    if (pr.s > Math.min(total - 25, surface ? sExit : 1e9)) { R.done = 'end'; }
  };
  // WHAT THE CAMERA SEES OF THE CEILING. The scene pass (no post) rendered
  // into a small target at the chase camera, and the top half of it
  // classified: near-white (every channel > 200 of 255) and sky-blue pixels.
  // A light slot or a hole to the sky shows up as a large bright fraction.
  R.scanCeil = () => {
    const THREE = d.THREE, W = 176, H = 104;
    if (!R._rt) R._rt = new THREE.WebGLRenderTarget(W, H);
    p.applyCamera(d.camera);
    const cam = d.camera, oldAspect = cam.aspect;
    cam.aspect = W / H; cam.updateProjectionMatrix();
    // The sedan is blue and its roof reaches the top half of the frame: hide
    // it, or it counts as sky.
    const vg = p.vehicle && p.vehicle.group;
    if (vg) vg.visible = false;
    d.renderer.setRenderTarget(R._rt);
    d.renderer.render(d.scene, cam);
    if (vg) vg.visible = true;
    const px = new Uint8Array(W * H * 4);
    d.renderer.readRenderTargetPixels(R._rt, 0, 0, W, H, px);
    d.renderer.setRenderTarget(null);
    cam.aspect = oldAspect; cam.updateProjectionMatrix();
    let bright = 0, sky = 0, n = 0;
    for (let y = H / 2; y < H; y++) for (let x = 0; x < W; x++) {   // GL rows: top half
      const i = (y * W + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
      n++;
      if (r > 200 && g > 200 && b > 200) bright++;
      else if (b > r + 25 && b > 140) sky++;
    }
    return { bright: bright / n, sky: sky / n };
  };
  R.scans = [];
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
    exit: goal >= 0 && !surface ? [Math.round(c.nodes[goal].x), Math.round(c.nodes[goal].z)] : null,
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
  const cfg = { ride: RIDE, hop: HOP, notraffic: NOTRAFFIC, speed: SPEED, nofail: args.includes('--nofail'),
    from: argVal('--from') !== undefined ? +argVal('--from') : null };
  if (!REAL) await ev('window.__dbg.game.paused = true');
  console.log('setup', await ev(`(${pageInit.toString()})(${JSON.stringify(cfg)})`));
  await ev('window.__ride.settle(3000)');

  // --stations name:rel,...  shot stations in metres from the entry portal
  // (overrides the default set). --shotdone NAME  also shoot where the ride
  // ends, which for a master build is where the car got stuck.
  const ST = argVal('--stations');
  const stations = !SHOTS ? '[]' : ST
    ? await ev(`JSON.stringify(${JSON.stringify(ST.split(',').map((q) => q.split(':')))}.map(([n, r]) => [n, window.__ride.sEntry + +r]))`)
    : await ev(`JSON.stringify((() => { const R = window.__ride;
    return [['approach', R.sEntry - 110], ['cutting', R.sEntry - 35], ['mouth', R.sEntry + 25],
      ['inside', R.sEntry + 200], ['midbore', (R.sEntry + R.sExit) / 2], ['exit', R.sExit + 40]]; })())`);
  const todo = JSON.parse(stations).sort((p, q) => p[1] - q[1]);
  const shoot = async (name) => {
    await ev('window.__ride.settle(3000)');
    if (!REAL) await ev('window.__ride.stepN(1)');
    // The scene, not the controls: hide the HUD the way beauty.mjs does.
    await ev(`(() => { for (const id of ['hud', 'pad', 'stickZone', 'lookZone', 'objective', 'toast', 'rotate', 'topBtns'])
      { const e = document.getElementById(id); if (e) e.style.display = 'none'; } return 1; })()`);
    await sleep(2500);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/${RIDE}-${name}.png`, Buffer.from(s.result.data, 'base64'));
    console.log('shot', name, await ev('window.__ride.status()'));
  };
  const SCAN = args.includes('--scan');
  let nextScan = null;
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
      // --scan: every 50 m inside the bore, classify the camera's upper view
      if (SCAN) {
        if (nextScan === null) nextScan = st.sEntry + 60;
        if (st.s >= nextScan && st.s <= st.sExit - 60) {
          await ev('window.__ride.settle(1500)');
          const q = JSON.parse(await ev(`JSON.stringify(window.__ride.scanCeil())`));
          await ev(`window.__ride.scans.push([${st.s}, ${q.bright}, ${q.sky}])`);
          nextScan = st.s + 50;
        }
      }
      if (b % 10 === 0) {
        await ev('window.__ride.settle(400)');
        console.log('status', JSON.stringify(st), Math.round((Date.now() - t0) / 1000) + 's');
      }
      if (st.done || st.t > 900) break;
    }
  }
  await flush();
  const DONE_SHOT = argVal('--shotdone');
  if (SHOTS && DONE_SHOT) await shoot(DONE_SHOT);
  if (SCAN) {
    const sc = JSON.parse(await ev('JSON.stringify(window.__ride.scans)'));
    const worst = sc.reduce((m, q) => (q[1] > m[1] ? q : m), [0, 0, 0]);
    const mean = sc.reduce((a2, q) => a2 + q[1], 0) / (sc.length || 1);
    console.log('SCAN', JSON.stringify({ stations: sc.length, meanBright: +mean.toFixed(4),
      worstBright: +worst[1].toFixed(4), worstAt: worst[0],
      skyStations: sc.filter((q) => q[2] > 0.005).length,
      skyAt: sc.filter((q) => q[2] > 0.005).map((q) => [q[0], +q[2].toFixed(3)]),
      over2pct: sc.filter((q) => q[1] > 0.02).length }));
  }
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
      entered: R.maxS > R.sEntry + 100, captures: R.captures || 0, damaged: R.damaged || 0, through: R.maxS > R.sExit + 20, hops: R.hops, kinds, maxAiSpeed: +(R.maxAi || 0).toFixed(1),
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
