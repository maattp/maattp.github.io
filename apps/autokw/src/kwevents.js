// Auto KW: random events -- GTA's "random events", made Waterloo Region.
//
// Every few minutes a DIRECTOR picks one small scripted happening and starts
// it 150-400 m from you, on the road you are probably taking (the way the camera
// looks) and never in view: a goose family crosses the road, a purse is
// snatched, a car breaks down, the police chase a suspect past you, kids play
// street hockey, a raccoon raids the bins, a wedding convoy honks down the
// street, fireworks go up over Victoria Park. Each is a self-contained class
// below (begin / tick), built from what the game already has -- traffic.spawnAt,
// peds.js humanoids, fx particles, the audio bank, hud toasts -- and each
// tears down completely (cars removed from traffic, people and meshes
// disposed, nothing held: events never call game.hold).
//
//   - WHEN: the first after 75-120 s, then every 150-270 s; never while
//     wanted, dead, paused or in an activity; never the same twice running;
//     some only at the right hour (hockey by day, the raccoon and fireworks
//     by night). Pause menu: "Random events" turns the director off.
//   - A HINT toast when you come within an event's hint range (`hintR`).
//   - Scripted cars are mode 'path' (traffic neither drives nor despawns them:
//     bikes.js does the same) or, standing, 'free' (AI traffic queues behind
//     them). Scripted people are standalone humanoids.
//   - Harness: `__dbg.events.start('geese', { range: [60, 120] })` forces one
//     near you; `__dbg.events.cur` is the live event; tools/kw/eventsprobe.mjs.
//
// Phone cost: nothing exists between events. During one: <= 5 cars (the
// chase, the convoy), <= 6 humanoids (hockey), a handful of merged meshes.

import * as THREE from './three.js';
import * as G from './geo.js';
import { makeHumanoid, animateWalk, hailPose } from './peds.js';
import { gooseGeometry } from './kwplaces.js';
import { LAMP_L, LAMP_R, LAMP_LON, LAMP_RON, randomCarColor } from './vehicles.js';
import { clamp, hash2, angleWrap } from './util.js';

const KEY = 'autokw-events';
const HAZARD = LAMP_LON | LAMP_RON | LAMP_L | LAMP_R;
const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (l) => l[Math.floor(Math.random() * l.length)];
const d2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

// ---------------------------------------------------------------------------
// Geometry kit: merged coloured boxes, one material
// ---------------------------------------------------------------------------
let _mat = null;
function mat() {
  return _mat || (_mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
}
/** boxes: [cx, cy, cz, sx, sy, sz, [r, g, b] (sRGB 0-1), rotY?, rotZ?] -> one BufferGeometry. */
function boxesGeo(list) {
  const pos = [], nor = [], col = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  for (const [cx, cy, cz, sx, sy, sz, c, ry = 0, rz = 0] of list) {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    e.set(0, ry, rz, 'YXZ'); q.setFromEuler(e);
    m.compose(p.set(cx, cy, cz), q, s.set(sx, sy, sz));
    nm.getNormalMatrix(m);
    const P = g.attributes.position, N = g.attributes.normal, lc = lin(c);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      col.push(lc[0], lc[1], lc[2]);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

// ---------------------------------------------------------------------------
// Roads: edges, polylines, a car that follows one
// ---------------------------------------------------------------------------
const okEdge = (e) => e && !e.elev && !e.tunnel && !e.noTraffic && e.cls !== 'hwy' && e.cls !== 'ramp';

/** The straightest way on from a point on edge `ei` at distance s0 from its A end, heading `sign` (+1 to B). */
function straightPts(city, ei, s0, sign, maxLen) {
  const e = city.edges[ei], a = city.nodes[e.a], b = city.nodes[e.b];
  const pts = [[a.x + e.dx * s0, a.z + e.dz * s0]];
  let cur = ei, node = sign > 0 ? e.b : e.a, dx = e.dx * sign, dz = e.dz * sign;
  let total = sign > 0 ? e.len - s0 : s0;
  pts.push([node === e.b ? b.x : a.x, node === e.b ? b.z : a.z]);
  while (total < maxLen && pts.length < 16) {
    const n = city.nodes[node];
    let best = null, bd = -0.2;
    for (const ej of n.e) {
      if (ej === cur) continue;
      const f = city.edges[ej];
      if (!okEdge(f)) continue;
      const fwd = f.a === node;
      const fx = fwd ? f.dx : -f.dx, fz = fwd ? f.dz : -f.dz, dot = fx * dx + fz * dz;
      if (dot > bd) { bd = dot; best = { ej, to: fwd ? f.b : f.a, fx, fz, len: f.len }; }
    }
    if (!best) break;
    cur = best.ej; node = best.to; dx = best.fx; dz = best.fz; total += best.len;
    pts.push([city.nodes[node].x, city.nodes[node].z]);
  }
  return pts;
}

/** The polyline moved `off` m to the right of travel, corners mitred. */
function offsetPts(P, off) {
  const n = P.length, out = [];
  const tan = (i) => { const x = P[i + 1][0] - P[i][0], z = P[i + 1][1] - P[i][1], l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
  for (let i = 0; i < n; i++) {
    const t0 = i > 0 ? tan(i - 1) : null, t1 = i < n - 1 ? tan(i) : null;
    let tx, tz, k = 1;
    if (t0 && t1) {
      tx = t0[0] + t1[0]; tz = t0[1] + t1[1];
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const c = t0[0] * t1[0] + t0[1] * t1[1];
      k = 1 / Math.max(0.5, Math.sqrt((1 + c) / 2));
    } else { [tx, tz] = t0 || t1; }
    out.push([P[i][0] - tz * off * k, P[i][1] + tx * off * k]);
  }
  return out;
}

class Path {
  constructor(pts) {
    this.p = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.len = this.cum[this.cum.length - 1];
  }
  /** Position and heading (sin, cos convention) at distance s. */
  at(s, out) {
    const c = this.cum, p = this.p;
    s = clamp(s, 0, this.len);
    let i = 1;
    while (i < c.length - 1 && c[i] < s) i++;
    const seg = c[i] - c[i - 1] || 1, t = (s - c[i - 1]) / seg;
    const dx = p[i][0] - p[i - 1][0], dz = p[i][1] - p[i - 1][1];
    out.x = p[i - 1][0] + dx * t; out.z = p[i - 1][1] + dz * t; out.h = Math.atan2(dx, dz);
    return out;
  }
  /** 0..1: how straight the road is for the next 18 m from s (corners slow a car). */
  ease(s) {
    const a = this.at(s, _a), ha = a.h, b = this.at(s + 18, _b);
    return clamp(1 - Math.abs(angleWrap(b.h - ha)) / 1.1, 0.3, 1);
  }
}
const _a = {}, _b = {};

// ---------------------------------------------------------------------------
// The director
// ---------------------------------------------------------------------------
export class RandomEvents {
  /** o: { scene, city, traffic, peds, game, fx, audio, hud, tod?, camera? } */
  constructor(o) {
    this.o = o;
    this.enabled = true;
    try { this.enabled = localStorage.getItem(KEY) !== '0'; } catch (e) { /* private mode */ }
    this.cur = null;
    this.last = null;
    this.timer = rnd(75, 120);
    this.retry = 0;
    this.log = [];                 // what ran, for the harness
    this.stats = { started: 0, ended: 0 };
    this._v = new THREE.Vector3();
  }

  setEnabled(v) {
    this.enabled = !!v;
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* private mode */ }
    if (!v && this.cur) this.stop();
  }

  hour() { const t = this.o.tod; return t && typeof t.hour === 'number' ? t.hour : 14; }

  /** The way the player is probably going: the vehicle's heading, else the camera's. */
  facing(player, camera) {
    if (player.vehicle && !player.onFoot) { const f = player.vehicle.forward; return [f.x, f.z]; }
    if (camera) { camera.getWorldDirection(this._v); const l = Math.hypot(this._v.x, this._v.z) || 1; return [this._v.x / l, this._v.z / l]; }
    return [0, 1];
  }

  /** A good street segment 150-400 m (opts.range) out, ahead of the player where it can be. */
  edgeSpot(player, camera, opts = {}) {
    const city = this.o.city, p = player.position, [fx, fz] = this.facing(player, camera);
    const [dmin, dmax] = opts.range || [150, 400];
    const cls = opts.classes || ['st', 'res', 'art'];
    const pool = city.edgesNear(p.x, p.z, dmax + 20);
    const minLen = opts.minLen || 40;
    // not where the camera can see it start: a spot inside the view frustum pops in (there is
    // almost no fog). First ahead and out of view (a cross street off the frame's edge), then
    // anywhere out of view, then anything.
    let fr = null;
    if (camera && opts.inView !== true) {
      camera.updateMatrixWorld();
      this._m4 = this._m4 || new THREE.Matrix4(); this._fr = this._fr || new THREE.Frustum();
      this._m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      fr = this._fr.setFromProjectionMatrix(this._m4);
    }
    for (let k = 0; k < 400 && pool.length; k++) {
      const ei = pool[Math.floor(Math.random() * pool.length)], e = city.edges[ei];
      if (!okEdge(e) || e.len < minLen || !cls.includes(e.cls)) continue;
      const a = city.nodes[e.a];
      const s = e.len * rnd(0.4, 0.6), x = a.x + e.dx * s, z = a.z + e.dz * s;
      const dd = Math.hypot(x - p.x, z - p.z);
      if (dd < dmin || dd > dmax || G.isWater(x, z)) continue;
      if (opts.ahead !== false && k < 200 && ((x - p.x) * fx + (z - p.z) * fz) / dd < 0.3) continue;
      if (fr && k < 300) { this._v.set(x, a.y + 1.5, z); if (fr.containsPoint(this._v)) continue; }
      if (opts.near && !opts.near(e)) continue;
      return { ei, e, s, x, z, y: a.y, d: dd };
    }
    return null;
  }

  /** Any open ground 250-450 m ahead (fireworks that have no park to be over). */
  groundSpot(player, camera) {
    const p = player.position, [fx, fz] = this.facing(player, camera);
    for (let k = 0; k < 40; k++) {
      const a = Math.atan2(fx, fz) + rnd(-0.7, 0.7), r = rnd(250, 450);
      const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
      if (!G.isWater(x, z)) return { x, z, y: G.terrainHeight(x, z), d: r };
    }
    return null;
  }

  canStart(player) {
    const g = this.o.game;
    if (!this.enabled || g.dead || g.paused || g.holds.size || g.wanted > 0) return false;
    // jobs and exams that do not hold the world (the G2 road test, a race, a fare, a delivery, a bus route, a police mission)
    if (this.o.busy && this.o.busy()) return false;
    if (player.vehicle && player.vehicle.spec && player.vehicle.spec.air) return false;
    return true;
  }

  pickName() {
    const h = this.hour(), day = h >= 7 && h < 20, night = h >= 20.5 || h < 5;
    const w = {
      geese: day ? 1.2 : 0.4, snatcher: 1, breakdown: 1, chase: night ? 1.3 : 1, hockey: h >= 10 && h < 19.5 ? 1.4 : 0,
      raccoon: night ? 2 : 0.2, wedding: h >= 10 && h < 19 ? 1.1 : 0, fireworks: h >= 21 || h < 1.5 ? 2.2 : 0,
    };
    let tot = 0;
    for (const k in w) if (k === this.last) w[k] = 0; else tot += w[k];
    let r = Math.random() * tot;
    for (const k in w) { if (!w[k]) continue; if ((r -= w[k]) <= 0) return k; }
    return 'geese';
  }

  /** Force one (harness, or the director's pick). opts.range moves the spot nearer. */
  start(name, opts = {}) {
    const player = this.o.player, camera = this.o.camera;
    if (!player) return false;
    if (this.cur) this.stop();
    const C = EVENTS[name];
    if (!C) return false;
    let ev = null, ok = false;
    // (a spot that does not suit this event -- a street too short for a chase -- is tried again elsewhere)
    for (let k = 0; k < 8 && !ok; k++) {
      ev = new C(this, opts);
      try { ok = ev.begin(player, camera); } catch (err) { console.error('event ' + name + ' failed to start:', err); ok = false; }
      if (!ok) ev.end();
    }
    if (!ok) return false;
    this.cur = ev; this.last = name; this.stats.started++;
    this.log.push(name);
    return true;
  }

  stop() {
    const ev = this.cur;
    if (!ev) return;
    this.cur = null;
    try { ev.end(); } catch (err) { console.error('event teardown failed:', err); }
    this.stats.ended++;
    this.timer = rnd(150, 270);
  }

  /** After traffic.update (the lamps it resets are set again here). */
  update(dt, player, camera) {
    if (dt > 0.1) dt = 0.1;
    if (this.cur) {
      // a job or exam began (or you were wasted) mid-event: clear it away
      if (this.o.game.dead || (this.o.busy && this.o.busy())) { this.stop(); return; }
      let fin = false;
      try { fin = this.cur.update(dt, player, camera); } catch (err) { console.error('event update failed:', err); fin = true; }
      if (fin) this.stop();
      return;
    }
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer > 0 || !this.canStart(player)) return;
    this.retry -= dt;
    if (this.retry > 0) return;
    if (!this.start(this.pickName())) { this.retry = 6; this.timer = 0; }
  }

  pay(n, text) {
    this.o.game.money += n;
    this.o.hud.showToast(`${text} +$${n}`, 4800);
  }
}

// ---------------------------------------------------------------------------
// One event: the base class owns its cars, people and meshes
// ---------------------------------------------------------------------------
class Ev {
  constructor(D, opts) {
    this.D = D; this.O = D.o; this.opts = opts;
    this.cars = []; this.people = []; this.objs = [];
    this.age = 0; this.done = false; this.doneT = 0; this.hinted = false; this.involved = false;
    this.hintR = 130; this.hint = ''; this.maxAge = 170; this.cx = 0; this.cz = 0;
  }
  range() { return this.opts.range || [150, 400]; }

  car(x, z, h, type, color, mode) {
    const v = this.O.traffic.spawnAt(x, z, h, type, color != null ? color : randomCarColor(Math.random() * 1e4), mode);
    this.cars.push(v);
    return v;
  }
  person(x, z, h, o = {}) {
    const hum = makeHumanoid({ seed: o.seed != null ? o.seed : Math.floor(Math.random() * 1e6), scale: o.scale });
    const p = { h: hum, x, z, y: 0, heading: h, speed: 0, wave: false, bag: null, dead: false };
    this.O.scene.add(hum.group);
    this.people.push(p);
    this.placePerson(p);
    return p;
  }
  placePerson(p) {
    const city = this.O.city;
    p.y = city.groundAt(p.x, p.z, p.y + 0.6, city.roadLift(p.x, p.z));
    p.h.group.position.set(p.x, p.y, p.z);
    p.h.group.rotation.y = p.heading;
  }
  /** Walk/idle a person this frame (speed 0 = stand). */
  pose(p, dt, speed, t) {
    p.speed = speed;
    animateWalk(p.h, clamp(speed * 0.2, 0, 0.85), dt, speed);
    if (p.wave) hailPose(p.h, t);
  }
  obj(o) { this.O.scene.add(o); this.objs.push(o); return o; }

  /** A wheel-turning, path-following car. c = { v, path, s, speed, want } */
  mover(v, path, s, speed) {
    v.mode = 'path';
    return { v, path, s, speed: 0, want: speed, pt: {}, h: null };
  }
  moveCar(c, dt, brake = false) {
    const v = c.v, acc = brake ? 14 : 5;
    const tgt = brake ? 0 : c.want * c.path.ease(c.s);
    c.speed += clamp(tgt - c.speed, -acc * dt * 1.6, acc * dt);
    c.s = Math.min(c.path.len, c.s + c.speed * dt);
    const q = c.path.at(c.s, c.pt);
    c.h = c.h == null ? q.h : c.h + angleWrap(q.h - c.h) * Math.min(1, dt * 7);
    v.vLong = c.speed;
    v.place(q.x, q.z, c.h);
    v.wheelSpin += (c.speed / (v.assets.wheelR || 0.34)) * dt;
  }
  hazards(v, on) { v.setLamps(on ? HAZARD : 0); }
  say(text, ms) { this.O.hud.showToast(text, ms || 3600); }
  speedOf(player) { return player.vehicle && !player.onFoot ? Math.abs(player.vehicle.vLong) : player.speed || 0; }

  begin() { return false; }
  tick() {}

  /** The base frame: hint, the event's own tick, and when it is over. */
  update(dt, player, camera) {
    this.age += dt;
    const p = player.position, dd = Math.sqrt(d2(p.x, p.z, this.cx, this.cz));
    this.dist = dd;
    if (!this.hinted && dd < this.hintR) { this.hinted = true; if (this.hint) this.say(this.hint, 4600); }
    this.tick(dt, player, camera, dd);
    // a scripted car the traffic system took away (too far): forget it
    this.cars = this.cars.filter((v) => this.O.traffic.cars.includes(v));
    if (this.done) { this.doneT += dt; if (this.doneT > 90 || (this.doneT > 3 && dd > 130)) return true; }
    // (dd > 800: you respawned or were carried off -- nothing of it is near you any more)
    return this.age > this.maxAge || (this.hinted && dd > 480) || dd > 800;
  }

  end() {
    const T = this.O.traffic, S = this.O.scene;
    for (const v of this.cars) if (T.cars.includes(v)) T.remove(v);
    this.cars.length = 0;
    for (const p of this.people) { S.remove(p.h.group); p.h.dispose(); if (p.bag) { p.bag.geometry.dispose(); p.bag.material.dispose(); } }
    this.people.length = 0;
    for (const o of this.objs) {
      S.remove(o);
      o.traverse((m) => { if (m.geometry && !m.userData.shared) m.geometry.dispose(); });
    }
    this.objs.length = 0;
  }
}

// ---------------------------------------------------------------------------
// 1. A goose family crosses the road, and the traffic waits
// ---------------------------------------------------------------------------
class Geese extends Ev {
  begin(player, camera) {
    const sp = this.D.edgeSpot(player, camera, { range: this.range(), minLen: 22 });
    if (!sp) return false;
    const e = sp.e, O = this.O;
    this.sp = sp; this.cx = sp.x; this.cz = sp.z; this.hintR = 150;
    this.hint = 'Geese ahead. Someone is leaning on their horn.';
    const fx = e.dx, fz = e.dz, rx = -fz, rz = fx;
    this.f = [fx, fz]; this.r = [rx, rz];
    this.half = e.hw + 2.4;
    // two cars stopped for them, one each way, in their own lanes
    const off = Math.min(e.hw * 0.5, 2.1), gap = 10;
    const mk = (sign, type) => {
      const x = sp.x - fx * sign * gap + (-fz * sign) * off, z = sp.z - fz * sign * gap + (fx * sign) * off;
      const v = this.car(x, z, Math.atan2(fx * sign, fz * sign), type, null, 'free');
      return v;
    };
    this.carA = mk(1, pick(['sedan', 'suv', 'hatch']));
    this.carB = mk(-1, pick(['wagon', 'pickup', 'compact']));
    // the family: gander, goose, four goslings
    this.geese = [];
    const spec = [[1.35, 0], [1.2, 1.4], [0.6, 3.0], [0.55, 3.8], [0.58, 4.6], [0.5, 5.4]];
    spec.forEach(([sc, delay], i) => this.geese.push({ sc, delay: delay + 1.5, u: -this.half, lat: (i % 2 ? 1 : -1) * 0.25 * (i > 1 ? 1 : 0), alive: true, ph: Math.random() * 6, y: 0 }));
    this.mesh = new THREE.InstancedMesh(gooseGeometry('stand'), mat0(), this.geese.length);
    this.mesh.name = 'kwev:geese';
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    this.obj(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.patient = false; this.honkT = 2; this.cryT = 3; this.goneT = 0; this.leaving = false; this.hit = 0;
    this.layout(0);
    for (const v of [this.carA, this.carB]) v.mode = 'free';
    return true;
  }
  layout(dt) {
    const sp = this.sp, [rx, rz] = this.r, h = Math.atan2(rx, rz), city = this.O.city;
    let n = 0;
    for (const g of this.geese) {
      if (!g.alive) continue;
      const x = sp.x + rx * g.u + this.f[0] * g.lat, z = sp.z + rz * g.u + this.f[1] * g.lat;
      g.x = x; g.z = z;
      g.y = city.groundAt(x, z, g.y || sp.y + 0.5, city.roadLift(x, z));
      const moving = g.u > -this.half && g.u < this.half;
      const bob = moving ? Math.abs(Math.sin(g.ph * 9)) * 0.03 : 0, roll = moving ? Math.sin(g.ph * 9) * 0.12 : 0;
      this._e.set(0, h, roll); this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(x, g.y + bob, z), this._q, this._s.setScalar(g.sc));
      this.mesh.setMatrixAt(n++, this._m);
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
  tick(dt, player) {
    const sp = this.sp, p = player.position;
    // the geese go over one after the other
    let crossing = false, left = 0;
    for (const g of this.geese) {
      if (!g.alive) continue;
      g.ph += dt;
      if (this.age >= g.delay && g.u < this.half) { g.u = Math.min(this.half, g.u + 1.15 * dt); crossing = true; }
      if (g.u < this.half) left++;
      // run over: scattered, feathers
      if (g.u > -this.half + 0.5 && g.u < this.half && this.speedOf(player) > 4) {
        const dx = p.x - g.x, dz = p.z - g.z;
        if (dx * dx + dz * dz < 2.4 * 2.4) {
          g.alive = false; this.hit++;
          this.O.fx.emit(g.x, g.y + 0.5, g.z, 14, { r: 0.95, g: 0.95, b: 0.92, size: 0.35, life: 1.4, spread: 5, vy: 3, grav: -1.5, drag: 0.9 });
          if (this.hit === 1) this.say('Oh, Canada. The geese will remember that.', 3400);
        }
      }
    }
    this.layout(dt);
    const dd = this.dist;
    // the honking and the honking back
    this.honkT -= dt; this.cryT -= dt;
    if (!this.leaving && this.honkT <= 0 && dd < 380) {
      this.honkT = rnd(2.5, 4.5);
      this.O.audio.play('horn_far', { x: this.carA.x, y: this.carA.y + 1, z: this.carA.z, gain: 0.9, ref: 14, maxD: 420 });
    }
    if (this.cryT <= 0 && dd < 320) {
      this.cryT = rnd(2, 3.5);
      const g = this.geese[Math.floor(Math.random() * this.geese.length)];
      if (g.alive) this.O.audio.play('goose', { x: g.x, y: g.y + 0.5, z: g.z, gain: 0.7, ref: 8, maxD: 200 });
    }
    // slow down, wait for them, get thanked
    if (crossing && dd < 45 && this.speedOf(player) < 3.5) { this.patient = true; this.involved = true; }
    if (!this.leaving && !left) {
      this.leaving = true;
      for (const g of this.geese) if (g.alive) g.ph = 0;
      if (this.patient && !this.paid) { this.paid = true; this.D.pay(60, 'You waited for the goslings. A crossing guard\'s thanks:'); }
      // the two cars drive on, straight along their road
      const e = this.sp.e;
      this.movers = [this.carA, this.carB].map((v, i) => {
        const sign = i ? -1 : 1;
        const pts = straightPts(this.O.city, this.sp.ei, this.sp.s, sign, 520);
        const off = Math.min(e.hw * 0.5, 2.1);
        return this.mover(v, new Path(offsetPts(pts, off)), 10, 11);
      });
      // (they start 10 m before the crossing, in their lane: path distance 10 would be past it)
      this.movers.forEach((m, i) => { m.s = 0; m.path = new Path(offsetPts(straightPts(this.O.city, this.sp.ei, this.sp.s - (i ? -1 : 1) * 10, i ? -1 : 1, 520), Math.min(e.hw * 0.5, 2.1))); });
    }
    if (this.leaving) {
      for (const m of this.movers) {
        if (!this.cars.includes(m.v)) continue;
        this.moveCar(m, dt);
      }
      this.goneT += dt;
      if (this.goneT > 14) this.done = true;
    }
    if (this.done) this.hazards(this.carA, false);
  }
}
let _gm = null;
function mat0() {
  return _gm || (_gm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
}

// ---------------------------------------------------------------------------
// 2. A purse snatcher runs past; catch him
// ---------------------------------------------------------------------------
class Snatcher extends Ev {
  begin(player, camera) {
    const sp = this.D.edgeSpot(player, camera, { range: this.range(), minLen: 20, classes: ['st', 'art', 'res'] });
    if (!sp) return false;
    const e = sp.e, p = player.position, city = this.O.city;
    this.cx = sp.x; this.cz = sp.z; this.hintR = 130;
    this.hint = 'THIEF! Someone shouts. A man is running off with a purse.';
    // he runs toward you along the pavement
    const sign = ((p.x - sp.x) * e.dx + (p.z - sp.z) * e.dz) >= 0 ? 1 : -1;
    const W = e.hw + 1.7;
    const pts = straightPts(city, sp.ei, sp.s, sign, 700);
    this.path = new Path(offsetPts(pts, W));
    if (this.path.len < 90) return false;
    const q0 = this.path.at(0, {}), rx = -e.dz * sign, rz = e.dx * sign;
    // the victim stands where he started, her arm up, shouting
    this.victim = this.person(q0.x + e.dx * sign * 0.4, q0.z + e.dz * sign * 0.4, Math.atan2(e.dx * sign, e.dz * sign), { seed: 71 });
    this.victim.wave = true;
    this.thief = this.person(q0.x + e.dx * sign * 1.6, q0.z + e.dz * sign * 1.6, q0.h, { seed: 5 });
    const bag = new THREE.Mesh(boxesGeo([[0, 0, 0, 0.3, 0.22, 0.1, [0.78, 0.12, 0.45]], [0, 0.14, 0, 0.18, 0.04, 0.06, [0.25, 0.1, 0.1]]]), mat());
    bag.position.set(0.28, 0.95, 0.12);
    this.thief.h.group.add(bag);
    this.thief.bag = bag;
    this.s = 1.2; this.state = 'run'; this.speedRun = rnd(5.4, 6.0); this.cry = 0; this.rx = rx; this.rz = rz;
    this.maxAge = 80;
    return true;
  }
  tick(dt, player) {
    const t = this.thief, v = this.victim, p = player.position;
    this.pose(v, dt, 0, this.age);
    if (this.state === 'run') {
      this.s += this.speedRun * dt;
      const q = this.path.at(this.s, _a);
      t.heading += angleWrap(q.h - t.heading) * Math.min(1, dt * 8);
      t.x = q.x; t.z = q.z;
      this.placePerson(t);
      this.pose(t, dt, this.speedRun, this.age);
      const dx = p.x - t.x, dz = p.z - t.z, dd = Math.hypot(dx, dz);
      if (dd < 60) this.involved = true;
      const car = player.vehicle && !player.onFoot;
      if ((!car && dd < 1.7) || (car && dd < 3.2 && this.speedOf(player) > 3)) {
        this.state = 'down';
        t.h.group.rotation.x = -Math.PI / 2; t.h.group.position.y += 0.25;
        t.speed = 0;
        this.O.audio.play('pedhit', { x: t.x, y: t.y + 1, z: t.z, gain: 0.8, ref: 6 });
        this.O.fx.emit(t.x, t.y + 0.4, t.z, 10, { r: 0.6, g: 0.55, b: 0.5, size: 0.8, grow: 1.2, alpha: 0.5, life: 1.0, spread: 2, vy: 0.6, grav: 0 });
        this.D.pay(Math.round(rnd(120, 200)), car ? 'You flattened the purse snatcher with your bumper. She tips you' : 'Tackled! The purse goes back to its owner, who tips you');
        this.done = true;
      } else if (this.s >= this.path.len - 1 || (dd > 190 && this.age > 12)) {
        if (this.involved) this.say('He got away with it.', 2800);
        this.state = 'gone';
        t.h.group.visible = false;
        this.done = true;
      }
    } else if (this.state === 'down') {
      this.pose(t, dt, 0, this.age);
      t.h.group.rotation.x = -Math.PI / 2;
    }
  }
}

// ---------------------------------------------------------------------------
// 3. A car broken down on the shoulder; stop and help
// ---------------------------------------------------------------------------
class Breakdown extends Ev {
  begin(player, camera) {
    const sp = this.D.edgeSpot(player, camera, { range: this.range(), minLen: 24, classes: ['st', 'art', 'res'] });
    if (!sp) return false;
    const e = sp.e, p = player.position;
    this.cx = sp.x; this.cz = sp.z; this.hintR = 140;
    this.hint = 'A car on the shoulder with its hazards on. Pull up beside it to help.';
    const sign = ((p.x - sp.x) * e.dx + (p.z - sp.z) * e.dz) >= 0 ? -1 : 1;   // facing away: its driver is at the front, you arrive at his back? no: nose toward you
    this.sign = sign;
    const v = this.car(0, 0, 0, pick(['sedan', 'hatch', 'wagon', 'suv']), null, 'free');
    this.off = e.hw - v.halfWid - 0.35;
    const fx = e.dx * sign, fz = e.dz * sign, rx = -fz, rz = fx;
    const x = sp.x + rx * this.off, z = sp.z + rz * this.off;
    v.place(x, z, Math.atan2(fx, fz));
    this.v = v;
    // the driver stands at the front corner, on the road side, waving
    const hx = x + fx * (v.halfLen + 1.0) - rx * (v.halfWid + 0.4), hz = z + fz * (v.halfLen + 1.0) - rz * (v.halfWid + 0.4);
    this.driver = this.person(hx, hz, Math.atan2(-fx, -fz) + 0.5, { seed: 33 });
    this.driver.wave = true;
    this.prog = 0; this.state = 'wait'; this.maxAge = 150; this.sp = sp;
    return true;
  }
  tick(dt, player) {
    const v = this.v, p = player.position, car = player.vehicle && !player.onFoot;
    if (this.state === 'wait') {
      this.hazards(v, true);
      this.pose(this.driver, dt, 0, this.age);
      const dd = Math.hypot(p.x - v.x, p.z - v.z);
      const near = car ? dd < 11 && Math.abs(player.vehicle.vLong) < 1.6 : dd < 4.5;
      if (dd < 60) this.involved = true;
      if (near) {
        if (this.prog === 0) this.say(car ? 'Hooking up the jumper cables...' : 'Hooking up the jumper cables, hold on...', 3000);
        this.prog += dt;
      } else this.prog = Math.max(0, this.prog - dt * 0.5);
      if (this.prog > 3.6) {
        this.state = 'go';
        this.D.pay(Math.round(rnd(60, 120)), '"Thanks, eh! Get yourself a double-double."');
        this.O.audio.play('door_close', { x: v.x, y: v.y + 1, z: v.z, gain: 0.7, ref: 8 });
        this.driver.h.group.visible = false;
        const e = this.sp.e, pts = straightPts(this.O.city, this.sp.ei, this.sp.s, this.sign, 600);
        this.mv = this.mover(v, new Path(offsetPts(pts, this.off)), 0, 12);
        this.mv.speed = 0;
        this.goT = 0;
      }
    } else if (this.state === 'go') {
      this.goT += dt;
      this.hazards(v, this.goT < 2);
      if (this.goT > 1.5) this.moveCar(this.mv, dt);
      else { v.mode = 'path'; v.vLong = 0; }
      if (this.goT > 12) this.done = true;
    }
    if (this.age > 140 && this.state === 'wait') this.done = true;
  }
}

// ---------------------------------------------------------------------------
// 4. The police chase a suspect past you; help stop him
// ---------------------------------------------------------------------------
class Chase extends Ev {
  begin(player, camera) {
    const sp = this.D.edgeSpot(player, camera, { range: this.range(), minLen: 20, classes: ['st', 'art'] });
    if (!sp) return false;
    const e = sp.e, p = player.position, city = this.O.city;
    const sign = ((p.x - sp.x) * e.dx + (p.z - sp.z) * e.dz) >= 0 ? 1 : -1;
    // start 60 m before the spot so the pass-by is on the way to you
    const s0 = clamp(sp.s - sign * 40, 4, e.len - 4);
    const pts = straightPts(city, sp.ei, s0, sign, 1000);
    this.path = new Path(offsetPts(pts, e.hw * 0.3));
    if (this.path.len < 450) return false;
    this.cx = sp.x; this.cz = sp.z; this.hintR = 260;
    this.hint = 'Sirens! The police are chasing someone. Ram the suspect to stop him.';
    const sv = this.car(0, 0, 0, pick(['sports', 'muscle', 'sedan']), 0xd8d8d0, 'free');
    this.sus = this.mover(sv, this.path, 90, 24);
    this.cops = [];
    [58, 30].forEach((back, i) => {
      const cv = this.car(0, 0, 0, 'police', null, 'free');
      this.O.traffic.lightBar(cv);
      cv.sirenOn = true;
      this.cops.push(this.mover(cv, this.path, 90 - back, 25));
    });
    this.hits = 0; this.hitCd = 0; this.state = 'chase'; this.maxAge = 110; this.stopT = 0;
    this.allMovers = [this.sus, ...this.cops];
    for (const m of this.allMovers) { m.speed = 14; this.moveCar(m, 0.001); }
    return true;
  }
  tick(dt, player) {
    const p = player.position, T = this.O.traffic;
    this.hitCd -= dt;
    const stopping = this.state === 'stopped';
    for (const m of this.allMovers) {
      if (!this.cars.includes(m.v)) continue;
      const isSus = m === this.sus;
      const brake = stopping && (isSus || this.sus.s - m.s < 16);
      this.moveCar(m, dt, brake);
      if (!isSus) T.policeLights(m.v, dt, true);
      else if (stopping) this.hazards(m.v, true);
    }
    const sv = this.sus.v, dd = Math.hypot(p.x - sv.x, p.z - sv.z);
    this.cx = sv.x; this.cz = sv.z;
    if (this.state === 'chase') {
      if (dd < 70) this.involved = true;
      const car = player.vehicle && !player.onFoot;
      if (car && dd < sv.halfLen + player.vehicle.halfLen + 1.6 && this.hitCd <= 0 && this.speedOf(player) > 6) {
        this.hits++; this.hitCd = 0.9;
        this.O.fx.sparks(sv.x, sv.y + 0.8, sv.z, 14);
        this.O.audio.play('crash_hard', { x: sv.x, y: sv.y + 1, z: sv.z, gain: 0.6, ref: 12 });
        this.sus.speed *= 0.55;
        if (this.hits >= 2) {
          this.state = 'stopped';
          this.D.pay(400, 'Suspect stopped! The cruisers box him in. Bounty');
        } else this.say('Good hit! One more.', 1800);
      }
      // a cruiser on the road for you is a pursuit too: staying on his bumper counts
      if (this.sus.s >= this.path.len - 4) { this.state = 'stopped'; }
    } else {
      this.stopT += dt;
      if (this.stopT > 6) this.done = true;
    }
    if (this.state === 'chase' && dd > 330 && this.age > 14) this.done = true;
  }
}

// ---------------------------------------------------------------------------
// 5. Street hockey -- "CAR!"
// ---------------------------------------------------------------------------
class Hockey extends Ev {
  begin(player, camera) {
    const sp = this.D.edgeSpot(player, camera, { range: this.range(), minLen: 28, classes: ['res'] });
    if (!sp) return false;
    const e = sp.e;
    this.sp = sp; this.cx = sp.x; this.cz = sp.z; this.hintR = 120;
    this.hint = 'Kids playing street hockey ahead. They will make way if you slow down.';
    const fx = e.dx, fz = e.dz, rx = -fz, rz = fx;
    this.f = [fx, fz]; this.r = [rx, rz];
    this.edgeU = e.hw + 0.9; this.kerbU = e.hw + 1.7;
    this.netGeo = boxesGeo([
      [-0.9, 0.55, 0, 0.07, 1.1, 0.07, [0.85, 0.1, 0.1]], [0.9, 0.55, 0, 0.07, 1.1, 0.07, [0.85, 0.1, 0.1]], [0, 1.1, 0, 1.87, 0.07, 0.07, [0.85, 0.1, 0.1]],
      [0, 0.55, 0.42, 1.8, 1.0, 0.04, [0.82, 0.82, 0.82]], [-0.9, 0.55, 0.21, 0.04, 1.0, 0.42, [0.82, 0.82, 0.82]], [0.9, 0.55, 0.21, 0.04, 1.0, 0.42, [0.82, 0.82, 0.82]],
    ]);
    this.nets = [-1, 1].map((sg) => {
      const m = new THREE.Mesh(this.netGeo, mat());
      m.name = 'kwev:net'; m.userData.shared = true; m.castShadow = false;
      this.obj(m);
      m.userData.along = sg * 10.5; m.userData.u = 0;
      return m;
    });
    this.stickGeo = boxesGeo([[0, 0, 0, 0.03, 0.03, 1.1, [0.7, 0.55, 0.3]], [0, -0.01, 0.55, 0.05, 0.03, 0.22, [0.1, 0.1, 0.1]]]);
    this.ballM = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 }));
    this.ballM.userData.own = true;
    this.obj(this.ballM);
    this.kids = [];
    const jerseys = [3, 8, 14, 22];
    for (let i = 0; i < 4; i++) {
      const k = this.person(sp.x + rx * rnd(-2, 2) + fx * (i - 1.5) * 3, sp.z + rz * rnd(-2, 2) + fz * (i - 1.5) * 3, rnd(0, 6), { seed: jerseys[i] * 7 + 1, scale: 0.8 });
      const st = new THREE.Mesh(this.stickGeo, mat()); st.userData.shared = true;
      st.position.set(0.32, 0.5, 0.35); st.rotation.x = 0.7;
      k.h.group.add(st);
      k.stick = st; k.tx = k.x; k.tz = k.z; k.tt = rnd(0.5, 2);
      this.kids.push(k);
    }
    this.carrier = 0; this.passT = 1.2; this.ball = { x: sp.x, y: 0.1, z: sp.z, fx: sp.x, fz: sp.z, tx: sp.x, tz: sp.z, t: 1 };
    this.clear = false; this.clearT = 0; this.thanked = false; this.maxAge = 120; this.warned = false;
    return true;
  }
  tick(dt, player) {
    const sp = this.sp, [fx, fz] = this.f, [rx, rz] = this.r, p = player.position, car = player.vehicle && !player.onFoot;
    const near = this.dist < (car ? 62 : 32);
    if (near && (car || this.dist < 22)) {
      this.involved = true;
      this.clearT = 6;
      if (!this.clear) { this.clear = true; if (!this.warned) { this.warned = true; this.say('"CAR!"  The kids drag the nets aside.', 2800); } }
    } else if (this.clear) {
      this.clearT -= dt;
      if (this.clearT <= 0) this.clear = false;
    }
    // the nets slide to the kerb and back
    for (const n of this.nets) {
      const goal = this.clear ? this.edgeU * (n.userData.along < 0 ? -1 : 1) : 0;
      n.userData.u += clamp(goal - n.userData.u, -3.5 * dt, 3.5 * dt);
      const al = this.clear ? n.userData.along : n.userData.along;
      const x = sp.x + fx * al + rx * n.userData.u, z = sp.z + fz * al + rz * n.userData.u;
      n.position.set(x, this.O.city.groundAt(x, z, sp.y + 0.5, this.O.city.roadLift(x, z)), z);
      n.rotation.y = Math.atan2(fx, fz) + (n.userData.along < 0 ? 0 : Math.PI) + Math.PI;
    }
    // the kids: a scrum round the ball, or at the kerb
    this.passT -= dt;
    let carrier = this.kids[this.carrier];
    for (let i = 0; i < this.kids.length; i++) {
      const k = this.kids[i];
      k.tt -= dt;
      if (this.clear) {
        const sd = i % 2 ? 1 : -1;
        k.tx = sp.x + fx * ((i - 1.5) * 3.2) + rx * sd * this.kerbU; k.tz = sp.z + fz * ((i - 1.5) * 3.2) + rz * sd * this.kerbU;
      } else if (k.tt <= 0) {
        k.tt = rnd(1.5, 3.2);
        const a = rnd(-7, 7), l = rnd(-2.4, 2.4);
        k.tx = sp.x + fx * a + rx * l; k.tz = sp.z + fz * a + rz * l;
      }
      const dx = k.tx - k.x, dz = k.tz - k.z, dd = Math.hypot(dx, dz);
      const sp2 = dd > 0.5 ? (this.clear ? 4.2 : 2.7) : 0;
      if (sp2) { k.heading += angleWrap(Math.atan2(dx, dz) - k.heading) * Math.min(1, dt * 8); k.x += Math.sin(k.heading) * sp2 * dt; k.z += Math.cos(k.heading) * sp2 * dt; }
      else if (this.clear) k.heading += angleWrap(Math.atan2(sp.x - k.x, sp.z - k.z) - k.heading) * Math.min(1, dt * 4);
      this.placePerson(k);
      this.pose(k, dt, sp2, this.age);
    }
    // the ball is passed between them
    const b = this.ball;
    if (this.passT <= 0) {
      this.passT = rnd(1.2, 2.2);
      const nx = (this.carrier + 1 + Math.floor(Math.random() * 3)) % this.kids.length, to = this.kids[nx];
      b.fx = b.x; b.fz = b.z; b.tx = to.x; b.tz = to.z; b.t = 0; this.carrier = nx;
    }
    carrier = this.kids[this.carrier];
    if (b.t < 1) { b.t = Math.min(1, b.t + dt / 0.5); b.x = b.fx + (carrier.x - b.fx) * b.t; b.z = b.fz + (carrier.z - b.fz) * b.t; }
    else { b.x = carrier.x + Math.sin(carrier.heading) * 0.7; b.z = carrier.z + Math.cos(carrier.heading) * 0.7; }
    this.ballM.position.set(b.x, this.O.city.groundAt(b.x, b.z, sp.y + 0.5, this.O.city.roadLift(b.x, b.z)) + 0.05, b.z);
    // a polite pass earns thanks
    if (this.clear && !this.thanked && this.dist < 16 && this.speedOf(player) < 8 && car) {
      this.thanked = true;
      this.D.pay(15, 'The kids wave: "Thanks, mister!" They chip in');
    }
    if (this.age > 100) this.done = true;
  }
}

// ---------------------------------------------------------------------------
// 6. A raccoon raids the bins
// ---------------------------------------------------------------------------
class Raccoon extends Ev {
  begin(player, camera) {
    const sp = this.D.edgeSpot(player, camera, { range: this.range(), minLen: 22, classes: ['res', 'st'] });
    if (!sp) return false;
    const e = sp.e, rx = -e.dz, rz = e.dx;
    this.sp = sp; this.cx = sp.x; this.cz = sp.z; this.hintR = 95;
    this.hint = 'Bin night. Something is rummaging through the garbage.';
    const sd = Math.random() < 0.5 ? 1 : -1, W = e.hw + 1.5;
    this.fx = e.dx; this.fz = e.dz; this.sd = sd;
    const at = (a, l) => [sp.x + e.dx * a + rx * sd * l, sp.z + e.dz * a + rz * sd * l];
    const bins = [];
    const GREEN = [0.1, 0.35, 0.16], BLUE = [0.1, 0.25, 0.6], BLACK = [0.12, 0.12, 0.13], LID = [0.07, 0.2, 0.1];
    const bin = (cx, cz, c, h, rot) => {
      bins.push([cx, h / 2, cz, 0.62, h, 0.7, c, rot], [cx, h + 0.04, cz, 0.68, 0.08, 0.76, [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], rot]);
    };
    // local frame: x across (toward the road is -x for sd), z along the road
    bin(0, -1.3, GREEN, 0.95, 0.2); bin(0, 1.5, BLUE, 0.5, -0.1);
    // the tipped one, lid off, litter out
    bins.push([-0.1, 0.3, 0.1, 0.62, 0.7, 0.62, BLACK, 0, 1.45], [-0.1, 0.06, -0.9, 0.7, 0.08, 0.75, [0.05, 0.05, 0.06], 0.4]);
    const litter = [[0.9, 0.9, 0.9], [0.8, 0.7, 0.5], [0.2, 0.5, 0.2], [0.9, 0.85, 0.7], [0.5, 0.5, 0.55]];
    litter.forEach((c, i) => bins.push([-0.2 + rnd(-0.5, 0.9), 0.05, 0.9 + i * 0.28 + rnd(-0.1, 0.1), rnd(0.15, 0.3), 0.08, rnd(0.12, 0.25), c, rnd(0, 3)]));
    const g = new THREE.Mesh(boxesGeo(bins), mat());
    g.name = 'kwev:bins';
    const [bx, bz] = at(0, W + 0.5);
    g.position.set(bx, this.O.city.groundAt(bx, bz, sp.y + 0.3, this.O.city.roadLift(bx, bz)), bz);
    g.rotation.y = Math.atan2(e.dx, e.dz);
    this.obj(g);
    // the raccoon: a grey body, a black mask, a ringed tail
    const G1 = [0.45, 0.45, 0.47], G2 = [0.3, 0.3, 0.32], K = [0.05, 0.05, 0.06], W1 = [0.85, 0.85, 0.85];
    const rc = [[0, 0.17, 0, 0.2, 0.2, 0.46, G1], [0, 0.2, 0.28, 0.16, 0.15, 0.16, G1], [0, 0.2, 0.37, 0.17, 0.05, 0.05, K], [0, 0.2, 0.41, 0.06, 0.06, 0.06, K],
      [-0.07, 0.31, 0.27, 0.05, 0.06, 0.04, G2], [0.07, 0.31, 0.27, 0.05, 0.06, 0.04, G2], [-0.08, 0.05, 0.16, 0.06, 0.1, 0.07, K], [0.08, 0.05, 0.16, 0.06, 0.1, 0.07, K],
      [-0.08, 0.05, -0.16, 0.06, 0.1, 0.08, K], [0.08, 0.05, -0.16, 0.06, 0.1, 0.08, K]];
    for (let i = 0; i < 5; i++) rc.push([0, 0.2 + i * 0.015, -0.3 - i * 0.1, 0.11, 0.11, 0.11, i % 2 ? K : G2]);
    rc.push([0, 0.17, 0.3, 0.1, 0.02, 0.02, W1]);
    this.rac = new THREE.Mesh(boxesGeo(rc), mat());
    this.rac.name = 'kwev:raccoon';
    this.rac.castShadow = false;
    const [px, pz] = at(0.2, W - 0.1);
    this.rx0 = px; this.rz0 = pz; this.rx = px; this.rz = pz; this.rh = Math.atan2(rx * sd, rz * sd) + Math.PI + 0.4;   // faces the bins
    this.obj(this.rac);
    this.state = 'eat'; this.t = 0; this.run = 0; this.stare = 0; this.maxAge = 90; this.away = [e.dx * rnd(0.7, 1) * (Math.random() < 0.5 ? 1 : -1), 0];
    this.away[1] = e.dz * Math.sign(this.away[0] || 1) * 0.9;
    this.place(0, 1);
    return true;
  }
  place(hop, sc) {
    const c = this.O.city, y = c.groundAt(this.rx, this.rz, this.sp.y + 0.3, c.roadLift(this.rx, this.rz));
    this.rac.position.set(this.rx, y + hop, this.rz);
    this.rac.rotation.y = this.rh;
    this.rac.scale.setScalar(sc);
  }
  tick(dt, player) {
    this.t += dt;
    const p = player.position, car = player.vehicle && !player.onFoot, sp = this.speedOf(player);
    const dd = Math.hypot(p.x - this.rx, p.z - this.rz);
    if (this.state === 'eat') {
      // head down in the bin, now and then up to look
      this.rac.rotation.x = Math.sin(this.t * 4.2) * 0.08 - (Math.sin(this.t * 0.9) > 0.8 ? -0.15 : 0.05);
      if (dd < 60) this.involved = true;
      const spook = car ? dd < 26 && sp > 5 : dd < 6.5;
      if (!car && dd < 14 && dd >= 6.5 && sp < 2) this.stare = Math.min(1.2, this.stare + dt);
      if (spook || (this.stare > 1.1 && dd < 9)) {
        this.state = 'run'; this.run = 0;
        const l = Math.hypot(this.away[0], this.away[1]) || 1;
        this.away = [this.away[0] / l, this.away[1] / l];
        this.rh = Math.atan2(this.away[0], this.away[1]);
        this.rac.rotation.x = 0;
        if (this.involved) this.say(car ? 'A raccoon bolts from the garbage. Trash panda!' : 'Caught red-handed. The raccoon bolts.', 2800);
      }
      this.place(0, 1);
    } else if (this.state === 'run') {
      this.run += dt;
      const v = 4.6;
      this.rx += this.away[0] * v * dt; this.rz += this.away[1] * v * dt;
      const hop = Math.abs(Math.sin(this.run * 13)) * 0.12;
      this.rac.rotation.x = 0;
      // dives under a hedge: shrinks away
      const sc = this.run > 3.2 ? Math.max(0.001, 1 - (this.run - 3.2) * 4) : 1;
      this.place(hop, sc);
      if (this.run > 3.6) { this.rac.visible = false; this.done = true; }
    }
    if (this.age > 75) this.done = true;
  }
}

// ---------------------------------------------------------------------------
// 7. A wedding convoy honks down the road; tag on and they share the cake
// ---------------------------------------------------------------------------
class Wedding extends Ev {
  begin(player, camera) {
    const sp = this.D.edgeSpot(player, camera, { range: this.range(), minLen: 20, classes: ['art', 'st'] });
    if (!sp) return false;
    const e = sp.e, p = player.position, city = this.O.city;
    const sign = ((p.x - sp.x) * e.dx + (p.z - sp.z) * e.dz) >= 0 ? 1 : -1;
    const s0 = clamp(sp.s - sign * 40, 4, e.len - 4);
    this.path = new Path(offsetPts(straightPts(city, sp.ei, s0, sign, 1000), Math.min(e.hw * 0.5, 2.0)));
    if (this.path.len < 450) return false;
    this.cx = sp.x; this.cz = sp.z; this.hintR = 240;
    this.hint = 'Honk honk! A wedding party, hazards flashing, comes down the road.';
    const types = ['sedan', 'wagon', 'suv', 'hatch', 'sedan'], cols = [0xf4f4f0, 0x1c1c1f, 0xe6e6e6, 0x9db7d6, 0xf4f4f0];
    this.cv = types.map((t, i) => {
      const v = this.car(0, 0, 0, t, cols[i], 'free');
      const m = this.mover(v, this.path, 60 - i * 12, 10);
      m.speed = 8; this.moveCar(m, 0.001);
      return m;
    });
    this.honkT = 2; this.queue = []; this.joinT = 0; this.paid = false; this.maxAge = 120;
    return true;
  }
  tick(dt, player) {
    const A = this.O.audio, p = player.position;
    this.honkT -= dt;
    if (this.honkT <= 0) {
      this.honkT = rnd(3, 4.5);
      this.cv.forEach((m, i) => this.queue.push([0.2 * i, m.v]), this);
      this.queue.push([1.6, this.cv[0].v], [1.8, this.cv[1].v], [2.0, this.cv[2].v]);
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q[0] -= dt;
      if (q[0] <= 0) {
        this.queue.splice(i, 1);
        if (this.cars.includes(q[1]) && this.dist < 380) A.play('horn_far', { x: q[1].x, y: q[1].y + 1, z: q[1].z, gain: 0.9, ref: 14, maxD: 450 });
      }
    }
    for (const m of this.cv) {
      if (!this.cars.includes(m.v)) continue;
      this.moveCar(m, dt);
      this.hazards(m.v, true);
    }
    const lead = this.cv[0].v;
    this.cx = lead.x; this.cz = lead.z;
    // tag on behind them, near their pace, and you are part of the party
    const car = player.vehicle && !player.onFoot;
    let nearest = 1e9;
    for (const m of this.cv) nearest = Math.min(nearest, Math.hypot(p.x - m.v.x, p.z - m.v.z));
    if (nearest < 90) this.involved = true;
    if (car && nearest < 16 && this.speedOf(player) < 15 && this.speedOf(player) > 3) this.joinT += dt; else this.joinT = Math.max(0, this.joinT - dt * 0.5);
    if (!this.paid && this.joinT > 7) { this.paid = true; this.D.pay(75, 'You are in the wedding convoy! The best man hands you a slice of cake and'); }
    if (this.cv[0].s >= this.path.len - 3 || (this.dist > 340 && this.age > 20)) this.done = true;
    if (this.done) for (const m of this.cv) this.hazards(m.v, false);
  }
}

// ---------------------------------------------------------------------------
// 8. Fireworks over Victoria Park
// ---------------------------------------------------------------------------
const PALETTE = [[1, 0.2, 0.15], [1, 0.8, 0.2], [0.25, 0.6, 1], [0.35, 1, 0.45], [1, 0.4, 0.9], [1, 1, 1]];
class Fireworks extends Ev {
  begin(player, camera) {
    const [vx, vz] = G.toWorld(43.4470, -80.4990);
    const p = player.position;
    let site = { x: vx, z: vz };
    if (Math.hypot(p.x - vx, p.z - vz) > 2600 || this.opts.anywhere) {
      const gs = this.D.groundSpot(player, camera);
      if (!gs) return false;
      site = gs;
    }
    this.site = site; this.cx = site.x; this.cz = site.z; this.hintR = 900;
    this.hint = site.x === vx ? 'Fireworks over Victoria Park!' : 'Fireworks somewhere ahead!';
    this.groundY = G.terrainHeight(site.x, site.z);
    this.shots = []; this.nextT = 0.5; this.count = 0; this.maxAge = 60; this.total = this.opts.shots || 34;
    return true;
  }
  tick(dt, player) {
    const fx = this.O.fx, A = this.O.audio, S = this.site, p = player.position;
    this.nextT -= dt;
    if (this.count < this.total && this.nextT <= 0) {
      this.nextT = rnd(0.55, 1.5);
      this.count++;
      const x = S.x + rnd(-70, 70), z = S.z + rnd(-70, 70), alt = this.groundY + rnd(85, 150);
      this.shots.push({ x, z, alt, t: 0, col: pick(PALETTE), burst: false });
      fx.streak(x, this.groundY + 4, z, x, alt, z);
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      if (!s.burst && s.t > 0.4) {
        s.burst = true;
        const n = 46, c = s.col, ring = Math.random() < 0.4;
        for (let k = 0; k < n; k++) {
          // a sphere (or a ring) of sparks
          const th = Math.random() * Math.PI * 2, ph = ring ? Math.PI / 2 + rnd(-0.12, 0.12) : Math.acos(rnd(-1, 1)), sp = ring ? 26 : rnd(16, 30);
          fx.emit(s.x, s.alt, s.z, 1, { r: c[0], g: c[1], b: c[2], size: 7, life: 2.1, spread: 0.2, jitter: 0.6,
            vx: Math.sin(ph) * Math.cos(th) * sp, vy: Math.cos(ph) * sp, vz: Math.sin(ph) * Math.sin(th) * sp, grav: -5, drag: 0.95 });
        }
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        A.play('explosion', { x: s.x, y: s.alt, z: s.z, gain: 0.5, ref: 120, maxD: 3500, at: Math.min(4, d / 343), rate: 1.3, send: 0.5 });
      }
      if (s.t > 2.6) this.shots.splice(i, 1);
    }
    if (p) this.involved = true;
    if (this.count >= this.total && !this.shots.length) this.done = true;
  }
}

const EVENTS = { geese: Geese, snatcher: Snatcher, breakdown: Breakdown, chase: Chase, hockey: Hockey, raccoon: Raccoon, wedding: Wedding, fireworks: Fireworks };
export const EVENT_NAMES = Object.keys(EVENTS);
