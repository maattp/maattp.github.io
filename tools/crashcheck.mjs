// How crashes respond: spin, slide, deflect. A fixed-dt, paused-game driver.
//
// The game is paused and the harness steps player.update + traffic.update
// itself at dt = 1/60 on a flat street near the city centre (or Vehicle.update
// + collideWithBuildings for the wall case), so a before/after on two builds is
// like for like. Cases (see "A crash spins and slides" in guide/vehicles.md):
//
//   tbone      your sedan at 20 m/s square into the door of a sedan at rest.
//              victimMoved (m) and victimYaw (rad) over 2.5 s; meSpeedAfterHit
//              is your speed 0.25 s after the contact (the bar: the hit itself
//              does not stop you dead), meSpeed at the end (coasting, no input).
//   rearOffset 20 m/s into a stopped sedan's bumper, 1.2 m off its line:
//              meYaw / victimYaw must both be nonzero (a PIT, near enough).
//   headOn     both at 20 m/s, square: neither should turn.
//   pit        a cruiser at 22 m/s into the rear quarter of a car doing 16,
//              1.5 m off its line (reported, no bar).
//   busTbone / sedanIntoBus   mass: a bus shoves a sedan, a sedan does not
//              shove a bus.
//   wall       a sedan at 20 m/s meeting a long wall at 30 deg (a stand-in
//              building on the real collideWithBuildings path, as your car
//              takes it -- an AI driver's routine contact keeps the old
//              rule): speed after
//              and the body's angle to the wall's face (30 before the hit).
//   recover    after the T-bone: when your car's hit spin has gone (spinGoneS),
//              and that the stick still turns it (steerYaw over 1.5 s).
//   aiRecover  an AI car (mode 'traffic', routed on its lane) shunted 1.2 m off
//              its line from behind at 25 m/s, then left for 20 s: is it
//              moving, on the road and along it.
//   nan        every vehicle's numbers finite at the end.
//
// Each line prints a JSON object; the last line, CRASH {...}, has `pass` per
// acceptance bar and `ok` overall. Exit code 1 on a miss.
//
// Env:    CRASH_NORAILS=1  the deck parapets not solid, for the deck cases' control
// Flags:  --shots DIR   the T-bone from straight above, before / contact /
//                       +0.5 s / +1.5 s (slow: the paused loop draws each)
// Usage:  python3 -m http.server 8000; node tools/crashcheck.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome } from './chrome.mjs';

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9251;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---- page side --------------------------------------------------------------
function pageInit() {
  const d = window.__dbg, c = d.city, p = d.player, T = d.traffic;
  // a long, flat, straight street near the middle (the same pick on any build)
  let site = null;
  for (const e of c.edges) {
    if ((e.cls === 'art' || e.cls === 'st') && e.len > 40 && !e.tunnel && !e.elev) {
      const a = c.nodes[e.a], b = c.nodes[e.b];
      if (Math.abs(a.y - b.y) < 1.0 && Math.hypot(a.x, a.z) < 8000) { site = { e, a, b }; break; }
    }
  }
  const { e, a, b } = site;
  const S = window.__cc = {
    ux: e.dx, uz: e.dz, mx: (a.x + b.x) / 2, mz: (a.z + b.z) / 2, ei: c.edges.indexOf(e), name: e.name,
  };
  S.H0 = Math.atan2(S.ux, S.uz); S.px = -S.uz; S.pz = S.ux;
  S.clear = () => { for (const v of [...T.cars]) if (v.mode !== 'apron') T.remove(v); };
  S.clear();
  p.respawn(S.mx, S.mz); d.world.update(S.mx, S.mz, 2);
  S.IN0 = { x: 0, y: 0, gasAmt: 0, brakeAmt: 0 };
  S.step = (input = S.IN0) => {
    p.update(1 / 60, input, { x: 0, y: 0 }, d.controls, T, d.peds);
    const me = p.vehicle || p;
    T.update(1 / 60, me.x, me.z, { x: 0, z: 1 }, p);
  };
  S.mk = (type, mode = 'free') => T.spawnAt(S.mx, S.mz, 0, type, 0xaa2222, mode);
  S.speed = (v) => Math.hypot(v.vLong, v.vLat || 0);
  // a pose: me (the player's) and o (the other) at offsets along/across the street
  S.pose = (v, along, across, hdg, spd) => {
    v.x = S.mx + S.ux * along + S.px * across; v.z = S.mz + S.uz * along + S.pz * across;
    v.heading = hdg; v.vLong = spd; v.vLat = 0;
    v.y = c.groundAt(v.x, v.z, null); v.sync && v.sync();
  };
  return JSON.stringify({ site: [Math.round(S.mx), Math.round(S.mz)], name: S.name });
}

// One two-car case. `setup(me, o)` poses them; returns the numbers.
function pageCase(name, meType, oType, setup, frames, extra) {
  const d = window.__dbg, p = d.player, S = window.__cc;
  S.clear();
  const me = S.mk(meType), o = S.mk(oType);
  p.enterVehicle(me);
  eval('(' + setup + ')')(me, o);
  const o0 = { x: o.x, z: o.z, h: o.heading }, m0 = { h: me.heading };
  let hit = -1, maxYawO = 0, maxYawM = 0, ph = o.heading, pm = me.heading, meAfter = null;
  for (let f = 0; f < frames; f++) {
    const v0 = me.vLong;
    S.step();
    if (hit < 0 && Math.abs(me.vLong - v0) > 1) hit = f;
    if (hit >= 0 && f === hit + 15) meAfter = S.speed(me);
    maxYawO = Math.max(maxYawO, Math.abs(o.heading - ph) * 60); ph = o.heading;
    maxYawM = Math.max(maxYawM, Math.abs(me.heading - pm) * 60); pm = me.heading;
  }
  const out = {
    case: name, hitFrame: hit,
    meSpeedAfterHit: meAfter == null ? null : +meAfter.toFixed(1), meSpeed: +S.speed(me).toFixed(1),
    meYaw: +(me.heading - m0.h).toFixed(2), maxYawRateMe: +maxYawM.toFixed(2),
    victimMoved: +Math.hypot(o.x - o0.x, o.z - o0.z).toFixed(1), victimYaw: +(o.heading - o0.h).toFixed(2),
    maxYawRateVictim: +maxYawO.toFixed(2),
  };
  if (extra) Object.assign(out, eval('(' + extra + ')')(me, o));
  p.exitVehicle(true);
  return JSON.stringify(out);
}

// The wall: a REAL building face with clear paved ground in front of it --
// no street object, barrier, landmark, other building, deck or water over the
// approach and the slide along it -- driven into at 30 deg and 20 m/s through
// player.update (your car's path), and the first thing touched must be that
// wall. (A stand-in building on a stub city hid every street object and
// parked car from the test.)
function pageWall() {
  const d = window.__dbg, c = d.city, G = d.G, p = d.player, S = window.__cc;
  S.clear();
  const A = 30 * Math.PI / 180, R = 1.6 + 0.6;   // the sedan's obstacle circle, and some
  const blocked = (b0, x, z, y, g0) => {
    if (c.obstacleHit(x, z, R, y, false) || (c.barrierHit && c.barrierHit(x, z, R, y)) || (c.landmarkHit && c.landmarkHit(x, z, R, y, false))) return true;
    if (G.isWater(x, z)) return true;
    const g = c.groundAt(x, z, null);
    if (Math.abs(g - g0) > 0.4 || Math.abs(g - G.terrainHeight(x, z)) > 0.6) return true;   // a slope, or a deck
    if (c.roadLift(x, z) < 0.02 && !G.inLot(x, z)) return true;   // paved only: grass drags
    for (const b of c.buildingsNear(x, z, 14)) {
      if (b === b0) continue;
      const cc = Math.cos(-b.rot), ss = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx * cc - dz * ss) < b.w / 2 + 3 && Math.abs(dx * ss + dz * cc) < b.d / 2 + 3) return true;
    }
    return false;
  };
  let site = null;
  const seen = new Set();
  for (const [sx, sz] of [[S.mx, S.mz], [0, 0], [1300, 1350], [-1195, -2616], [1681, -291], [-219, -4598]]) {
    for (const b of c.buildingsNear(sx, sz, 500)) {
      if (site || seen.has(b)) continue;
      seen.add(b);
      const cc = Math.cos(-b.rot), ss = Math.sin(-b.rot);
      const W = (lx, lz) => [b.x + lx * cc + lz * ss, b.z - lx * ss + lz * cc];
      // faces: [half-length, centre (local), tangent (local), outward normal (local)]
      for (const [Lh, cx0, cz0, tx0, tz0, nx0, nz0] of [[b.w / 2, 0, b.d / 2, 1, 0, 0, 1], [b.w / 2, 0, -b.d / 2, 1, 0, 0, -1],
        [b.d / 2, b.w / 2, 0, 0, 1, 1, 0], [b.d / 2, -b.w / 2, 0, 0, 1, -1, 0]]) {
        if (site || Lh < 18) continue;
        const [fx, fz] = W(cx0, cz0), [tx1, tz1] = W(cx0 + tx0, cz0 + tz0), [nx1, nz1] = W(cx0 + nx0, cz0 + nz0);
        const tx = tx1 - fx, tz = tz1 - fz, nx = nx1 - fx, nz = nz1 - fz;
        const g0 = c.groundAt(fx + nx * 4, fz + nz * 4, null);
        if (g0 + 2 > b.y + b.h) continue;
        let ok = true;
        // the run-in, from 12 m back along the face and 4 m out, to the face;
        // then the slide along it 2.5 m out
        for (let k = 0; ok && k <= 16; k++) {
          const u = -12 + k * 0.5 * Math.cos(A), w = 4 - k * 0.5 * Math.sin(A);
          if (w < 1.5) break;
          if (blocked(b, fx + tx * u + nx * w, fz + tz * u + nz * w, g0, g0)) ok = false;
        }
        for (let u = -6; ok && u <= 14; u += 1) if (blocked(b, fx + tx * u + nx * 2.5, fz + tz * u + nz * 2.5, g0, g0)) ok = false;
        if (ok) site = { b, fx, fz, tx, tz, nx, nz };
      }
    }
  }
  if (!site) return JSON.stringify({ case: 'wall', site: null });
  const { b, fx, fz, tx, tz, nx, nz } = site;
  const v = S.mk('sedan');
  p.enterVehicle(v);
  const dx = tx * Math.cos(A) - nx * Math.sin(A), dz = tz * Math.cos(A) - nz * Math.sin(A);
  v.x = fx - tx * 12 + nx * 4; v.z = fz - tz * 12 + nz * 4; v.heading = Math.atan2(dx, dz);
  v.vLong = 20; v.vLat = 0; v.y = c.groundAt(v.x, v.z, null);
  // the body's angle to the face, + into it
  const ang = () => { const f = v.forward; return Math.atan2(-(f.x * nx + f.z * nz), f.x * tx + f.z * tz) * 180 / Math.PI; };
  const inWall = () => {
    const cc = Math.cos(-b.rot), ss = Math.sin(-b.rot), ddx = v.x - b.x, ddz = v.z - b.z;
    return Math.abs(ddx * cc - ddz * ss) < b.w / 2 + v.radius * 0.8 + 0.4 && Math.abs(ddx * ss + ddz * cc) < b.d / 2 + v.radius * 0.8 + 0.4;
  };
  const ang0 = ang();
  let hit = -1, first = null, sp0 = 0;
  for (let f = 0; f < 150; f++) {
    const s0 = S.speed(v);
    S.step();
    if (hit < 0 && (Math.abs(S.speed(v) - s0) > 1 || Math.abs(v.spin || 0) > 0.3)) {
      hit = f; sp0 = s0;
      // what it touched: the wall, and nothing else
      first = { wall: inWall(), obstacle: !!c.obstacleHit(v.x, v.z, v.radius * 0.7 + 0.3, v.y, false),
        otherCar: d.traffic.cars.some((o) => o !== v && Math.hypot(o.x - v.x, o.z - v.z) < 6) };
    }
    if (hit >= 0 && f >= hit + 30) break;
  }
  const f = v.forward;
  const wx = f.x * v.vLong + f.z * v.vLat, wz = f.z * v.vLong - f.x * v.vLat;
  const out = { case: 'wall', site: [Math.round(fx), Math.round(fz)], hitFrame: hit, speedBefore: +sp0.toFixed(1), first,
    angBefore: +ang0.toFixed(1), speedAfter: +S.speed(v).toFixed(1), bodyAngAfter: +ang().toFixed(1),
    velAngAfter: +(Math.atan2(-(wx * nx + wz * nz), wx * tx + wz * tz) * 180 / Math.PI).toFixed(1) };
  p.exitVehicle(true);
  S.clear();
  return JSON.stringify(out);
}

// A spin that starts HIGH ends: a cruiser at 25 m/s puts its nose into your
// rear quarter while you do 12, and is taken away the moment it has hit, so
// nothing touches you again. When is your hit spin gone (|spin| < 0.05), and
// does the stick turn the car after.
function pageRecover() {
  const d = window.__dbg, p = d.player, S = window.__cc;
  S.clear();
  const me = S.mk('sedan'), o = S.mk('police');
  p.enterVehicle(me);
  S.pose(me, 0, 0, S.H0, 12); S.pose(o, -13, -1.4, S.H0, 25);
  let hit = -1, peak = 0, gone = null, touched = 0, touchWhat = null;
  for (let f = 0; f < 240; f++) {
    S.step();
    const sp = Math.abs(me.spin || 0);
    if (hit < 0 && sp > 0.3) { hit = f; S.pose(o, 400, 0, S.H0, 0); }
    if (hit < 0) continue;
    peak = Math.max(peak, sp);
    if (f > hit + 1 && gone == null) {   // (until the spin is gone: what it hits after is not the spin's)
      const q = d.traffic.cars.find((q) => q !== me && Math.hypot(q.x - me.x, q.z - me.z) < me.halfLen + q.halfLen);
      if (p.scrapeT > 0.1 || q) { touched++; if (!touchWhat) touchWhat = q ? q.mode + ' ' + q.spec.hand : 'scrape f' + (f - hit); }
    }
    if (gone == null && sp < 0.05) gone = (f - hit) / 60;
    if (gone != null && f > hit + gone * 60 + 10) break;
  }
  // now the stick: hard over with some gas for 1.5 s
  const h0 = me.heading;
  for (let f = 0; f < 90; f++) S.step({ x: 1, y: 0, gasAmt: 0.6, brakeAmt: 0 });
  const out = { case: 'recover', hitFrame: hit, spinPeak: +peak.toFixed(2), spinGoneS: gone == null ? null : +gone.toFixed(2),
    touchedAfter: touched, touchWhat, steerYaw: +Math.abs(me.heading - h0).toFixed(2) };
  p.exitVehicle(true);
  S.clear();
  return JSON.stringify(out);
}

// The Magnolia Bridge's deck: its parapet is solid where it is drawn. (a)
// your sedan at 20 m/s, 25 deg into the rail; (b) a PIT -- a cruiser at 22 m/s
// into the inner rear quarter of a car doing 16 in the lane by the rail.
// Measured: how far past the rail's traffic face either got, and whether it
// is still on the deck (over the ground under the bridge) at the end.
function pageDeck() {
  const d = window.__dbg, c = d.city, G = d.G, p = d.player, S = window.__cc;
  S.clear();
  let ei = -1;
  for (let i = 0; i < c.edges.length; i++) {
    const e = c.edges[i];
    if (e.elev && e.prof && e.name === 'Magnolia Bridge' && (ei < 0 || e.len > c.edges[ei].len)) ei = i;
  }
  const e = c.edges[ei], a = c.nodes[e.a], b = c.nodes[e.b];
  const mid = e.pk >> 1;
  const K = d.world.railKinds ? d.world.railKinds(e, ei) : null;
  const sg = !K || K[mid * 2] === 2 ? 1 : -1;
  const ux = e.dx, uz = e.dz, ox = -e.dz * sg, oz = e.dx * sg, hw = e.hw;
  const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
  p.respawn(cx, cz); d.world.update(cx, cz, 2);
  const put = (v, along, out, hdg, spd) => {
    v.x = cx + ux * along + ox * out; v.z = cz + uz * along + oz * out; v.heading = hdg; v.vLong = spd; v.vLat = 0;
    v.y = c.groundAt(v.x, v.z, null);
  };
  const past = (v) => (v.x - cx) * ox + (v.z - cz) * oz - hw;   // + = past the rail's traffic face
  const onDeck = (v) => v.y > G.terrainHeight(v.x, v.z) + 3 && Math.abs((v.x - cx) * ox + (v.z - cz) * oz) < hw + 0.6;
  const H = Math.atan2(ux, uz);
  const out = { case: 'deck', edge: ei, side: sg, hw, deckOverGround: +(c.groundAt(cx, cz, null) - G.terrainHeight(cx, cz)).toFixed(1) };
  // (a) into the parapet
  {
    const me = S.mk('sedan');
    p.enterVehicle(me);
    const A = 25 * Math.PI / 180;
    put(me, -14, hw - 4.5, Math.atan2(ux * Math.cos(A) + ox * Math.sin(A), uz * Math.cos(A) + oz * Math.sin(A)), 20);
    let maxPast = -9, hit = -1, after = null;
    for (let f = 0; f < 150; f++) {
      const s0 = S.speed(me);
      S.step();
      maxPast = Math.max(maxPast, past(me));
      if (hit < 0 && Math.abs(S.speed(me) - s0) > 1) hit = f;
      if (hit >= 0 && f === hit + 30) after = S.speed(me);
    }
    out.rail = { hitFrame: hit, maxPast: +maxPast.toFixed(2), speedAfter: after == null ? null : +after.toFixed(1), onDeck: onDeck(me), y: +(me.y - G.terrainHeight(me.x, me.z)).toFixed(1) };
    p.exitVehicle(true);
    S.clear();
  }
  // (b) a PIT by the rail
  {
    const me = S.mk('police'), o = S.mk('sedan');
    p.enterVehicle(me);
    put(o, 0, hw - 1.7, H, 16);
    put(me, -14, hw - 1.7 - 1.5, H, 22);
    const h0 = o.heading;
    let maxPast = -9, peak = 0, yawMax = 0;
    for (let f = 0; f < 240; f++) {
      S.step(); maxPast = Math.max(maxPast, past(o));
      peak = Math.max(peak, Math.abs(o.yawRate || 0)); yawMax = Math.max(yawMax, Math.abs(o.heading - h0));
    }
    out.pit = { victimYawMax: +yawMax.toFixed(2), victimYawRateMax: +peak.toFixed(2), maxPast: +maxPast.toFixed(2), onDeck: onDeck(o), y: +(o.y - G.terrainHeight(o.x, o.z)).toFixed(1) };
    p.exitVehicle(true);
    S.clear();
  }
  return JSON.stringify(out);
}

// An AI car shunted off its line: does it drive on, on the road, along it.
function pageAI() {
  const d = window.__dbg, c = d.city, p = d.player, T = d.traffic, S = window.__cc;
  S.clear();
  const ai = S.mk('sedan', 'traffic');
  S.pose(ai, 0, 0, S.H0, 10);
  T.snapRoute(ai);
  // the lane it was given, so the shunt is relative to it
  for (let f = 0; f < 30; f++) T.update(1 / 60, S.mx, S.mz, { x: 0, z: 1 }, p);
  const me = S.mk('sedan');
  p.enterVehicle(me);
  const f0 = ai.forward, rx = f0.z, rz = -f0.x;
  me.x = ai.x - f0.x * 12 + rx * 1.2; me.z = ai.z - f0.z * 12 + rz * 1.2; me.heading = ai.heading;
  me.vLong = 25; me.vLat = 0; me.y = c.groundAt(me.x, me.z, null);
  const a0 = ai.heading;
  let maxSpin = 0, yawMax = 0;
  for (let f = 0; f < 60; f++) {
    S.step();
    maxSpin = Math.max(maxSpin, Math.abs(ai.spin || 0));
    yawMax = Math.max(yawMax, Math.abs(ai.heading - a0));
  }
  // the player leaves the scene; the AI is on its own for 20 s
  p.exitVehicle(true);
  T.remove(me);
  const px = ai.x + 40, pz = ai.z + 40;
  let moved = 0, lx = ai.x, lz = ai.z;
  for (let f = 0; f < 1200; f++) {
    T.update(1 / 60, px, pz, { x: 0, z: 1 }, p);
    if (!T.cars.includes(ai)) break;
    moved += Math.hypot(ai.x - lx, ai.z - lz); lx = ai.x; lz = ai.z;
  }
  // along a road at the end: the nearest edge's direction against its heading
  let best = Infinity, align = 0;
  const f = ai.forward;
  for (const ei of c.edgesNear(ai.x, ai.z, 40)) {
    const e = c.edges[ei], a = c.nodes[e.a];
    const t = Math.max(0, Math.min(e.len, (ai.x - a.x) * e.dx + (ai.z - a.z) * e.dz));
    const dd = Math.hypot(ai.x - a.x - e.dx * t, ai.z - a.z - e.dz * t) - e.hw;
    if (dd < best) { best = dd; align = Math.abs(e.dx * f.x + e.dz * f.z); }
  }
  const out = { case: 'aiRecover', removed: !T.cars.includes(ai), maxSpin: +maxSpin.toFixed(2), yawMax: +yawMax.toFixed(2),
    drove20s: +moved.toFixed(0), speedEnd: +S.speed(ai).toFixed(1), offRoadM: +Math.max(0, best).toFixed(1),
    alongRoad: +align.toFixed(2), stuckT: +ai.stuckT.toFixed(1), mode: ai.mode };
  S.clear();
  return JSON.stringify(out);
}

function pageNaN() {
  const T = window.__dbg.traffic, p = window.__dbg.player;
  let bad = 0;
  for (const v of T.cars) for (const k of ['x', 'z', 'y', 'heading', 'vLong', 'vLat', 'spin', 'yawRate', 'slide']) {
    if (v[k] !== undefined && !Number.isFinite(v[k])) bad++;
  }
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) bad++;
  return JSON.stringify({ case: 'nan', bad });
}

// ---- node side --------------------------------------------------------------
const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-crash-${PORT}`, width: 1100, height: 650 });
let code = 0;
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
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 1500));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    try { if (await ev('window.__dbg.sceneStats.calls > 0 && window.__dbg.traffic.cars.length > 0 && window.__dbg.city.edges.length > 1000')) break; } catch {}
  }
  await ev(`window.__dbg.applyQuality('low', true)`);
  await ev('window.__dbg.game.paused = true');
  const fn = (f, ...a) => `(${f.toString()})(${a.map((x) => JSON.stringify(x)).join(',')})`;
  const R = {};
  const run = async (expr) => { const o = JSON.parse(await ev(expr)); R[o.case || 'site'] = o; console.log(JSON.stringify(o)); return o; };
  // CRASH_NORAILS=1: the deck parapets not solid (what the deck cases measure against)
  if (process.env.CRASH_NORAILS) await ev('window.__dbg.city.deckRails = null');
  await run(fn(pageInit));
  const C = (name, mt, ot, setup, frames = 150, extra) => run(fn(pageCase, name, mt, ot, setup, frames, extra));
  // heading h faces (sin h, cos h); the player drives along the street (H0)
  await C('tbone', 'sedan', 'sedan', `(me, o) => { const S = window.__cc; S.pose(me, -15, 0, S.H0, 20); S.pose(o, 0, 0, S.H0 + Math.PI / 2, 0); }`);
  await C('rearOffset', 'sedan', 'sedan', `(me, o) => { const S = window.__cc; S.pose(me, -15, 1.2, S.H0, 20); S.pose(o, 0, 0, S.H0, 0); }`);
  await C('headOn', 'sedan', 'sedan', `(me, o) => { const S = window.__cc; S.pose(me, -18, 0, S.H0, 20); S.pose(o, 18, 0, S.H0 + Math.PI, 20); }`);
  await C('busTbone', 'bus', 'sedan', `(me, o) => { const S = window.__cc; S.pose(me, -18, 0, S.H0, 15); S.pose(o, 0, 0, S.H0 + Math.PI / 2, 0); }`);
  await C('sedanIntoBus', 'sedan', 'bus', `(me, o) => { const S = window.__cc; S.pose(me, -18, 0, S.H0, 15); S.pose(o, 0, 0, S.H0 + Math.PI / 2, 0); }`);
  // a PIT: a cruiser at 22 m/s putting its nose into the rear quarter of a car doing 16
  await C('pit', 'police', 'sedan', `(me, o) => { const S = window.__cc; S.pose(me, -14, 1.5, S.H0, 22); S.pose(o, 0, 0, S.H0, 16); }`);
  await run(fn(pageWall));
  await run(fn(pageRecover));
  await run(fn(pageDeck));
  await run(fn(pageAI));
  await run(fn(pageNaN));

  if (SHOTS) {
    // The T-bone from straight above, the paused loop drawing each pose.
    await ev(`(() => { const d = window.__dbg, S = window.__cc, p = d.player;
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      S.clear();
      d.traffic.spawnTimer = 1e9;   // (no new traffic wandering into the frame)
      const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
      d.world.update(S.mx, S.mz, 60);
      for (let i = 0; i < 3000 && pending() > 0; i++) d.world.update(S.mx, S.mz, 60);
      const me = S.mk('sedan'), o = S.mk('sedan', 'free');
      p.enterVehicle(me);
      S.pose(me, -15, 0, S.H0, 20); S.pose(o, 0, 0, S.H0 + Math.PI / 2, 0);
      S.shot = { me, o, f: 0 };
      S.cam = () => { const y = d.city.groundAt(S.mx, S.mz, null);
        d.camera.position.set(S.mx + S.ux * 2 + 0.01, y + 24, S.mz + S.uz * 2);
        d.camera.up.set(S.ux, 0, S.uz);
        d.camera.lookAt(S.mx + S.ux * 2, y, S.mz + S.uz * 2); d.camera.updateMatrixWorld(true); };
      S.cam(); return 1; })()`);
    const stepTo = async (n) => ev(`(() => { const S = window.__cc; while (S.shot.f < ${n}) { S.step(); S.shot.f++; } S.cam(); return S.shot.f; })()`);
    for (const [tag, n] of [['0-before', 0], ['1-contact', 46], ['2-plus0.5s', 76], ['3-plus1.5s', 136]]) {
      await stepTo(n);
      await sleep(6000);
      const s = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${SHOTS}/tbone-${tag}.png`, Buffer.from(s.result.data, 'base64'));
    }
  }

  const pass = {
    tboneVictimMoved: R.tbone.victimMoved >= 3,
    tboneVictimYaw: Math.abs(R.tbone.victimYaw) >= 0.3,
    tboneMeSpeed: R.tbone.meSpeedAfterHit > 3,
    rearOffsetYawBoth: Math.abs(R.rearOffset.meYaw) >= 0.02 && Math.abs(R.rearOffset.victimYaw) >= 0.02,
    wallDeflects: !!R.wall.first && R.wall.first.wall && !R.wall.first.obstacle && !R.wall.first.otherCar
      && R.wall.speedAfter > 8 && R.wall.bodyAngAfter < R.wall.angBefore - 3,
    busShoves: R.busTbone.victimMoved > R.sedanIntoBus.victimMoved,
    spinEnds: R.recover.spinPeak >= 1 && R.recover.spinGoneS != null && R.recover.spinGoneS <= 2.5
      && R.recover.touchedAfter === 0 && R.recover.steerYaw > 0.3,
    deckRailHolds: R.deck.rail.onDeck && R.deck.rail.maxPast < 0.6 && R.deck.rail.speedAfter > 8,
    deckPitStays: R.deck.pit.onDeck && R.deck.pit.maxPast < 0.6 && R.deck.pit.victimYawMax > 0.2,
    aiRecovers: !R.aiRecover.removed && R.aiRecover.speedEnd > 2 && R.aiRecover.offRoadM < 1 && R.aiRecover.alongRoad > 0.85,
    noNaN: R.nan.bad === 0,
  };
  const ok = Object.values(pass).every(Boolean);
  console.log('CRASH ' + JSON.stringify({ ok, pass }));
  if (!ok) code = 1;
} catch (e) { console.log('ERROR', e.message); code = 2; } finally { chrome.kill(); }
process.exit(code);
