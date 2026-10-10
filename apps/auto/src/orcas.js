// ORCAS OFF WEST POINT: a pod of Southern Resident killer whales working the
// Sound past Discovery Park's lighthouse (an Easter egg; pays once for the
// first sighting, localStorage 'auto-orcas').
//
// Five of them, sized as the residents are (NOAA / Center for Whale Research):
// a bull at 7.6 m with the 1.8 m dorsal fin that marks a mature male, two cows
// and a juvenile with the cows' shorter, curved fin, and a calf that keeps to
// its mother's flank. The pod travels a loop of open water off the point at
// ~2.6 m/s (they cruise at 5-10 km/h), each whale diving for 20-50 s and
// then surfacing for a short series of breaths 6-8 s apart: the back rolls
// over, the fin comes up, the blow goes up as a column of mist -- and the last
// breath of a series ends in a fluke-up dive. Now and then one breaches,
// clears the water nose-first, rolls onto its side and lands in a crash of
// spray.
//
// Drawn as three instanced meshes (the head and body, the tail stock with its
// flukes, the dorsal fin) for the whole pod -- three draws while the pod is
// within 3 km of the camera, none beyond. The tail is a second piece pivoted
// a third of the way back so the flukes beat and lift on a dive.

import * as THREE from './three.js';
import * as G from './geo.js';
import { clamp, angleWrap } from './util.js';

// The route: a loop of the Sound off West Point (lat, lon), checked against
// the water mask at boot and pushed offshore wherever it would touch land.
const ROUTE = [
  [47.6745, -122.4440], [47.6650, -122.4520], [47.6550, -122.4500],
  [47.6450, -122.4380], [47.6400, -122.4260], [47.6500, -122.4300],
  [47.6600, -122.4430], [47.6700, -122.4380],
];
const WEST_POINT = [47.661973, -122.435741];
const POD = [
  // length (m), fin height (m), fin curve, formation (along, across) m
  { L: 7.6, fin: 1.8, curve: 0.05, at: [0, 0] },        // the bull
  { L: 6.4, fin: 0.9, curve: 0.35, at: [-14, 9] },      // a cow
  { L: 6.0, fin: 0.85, curve: 0.35, at: [-11, -10] },   // another
  { L: 5.0, fin: 0.7, curve: 0.3, at: [-26, 3] },       // a juvenile
  { L: 3.2, fin: 0.42, curve: 0.3, at: [-14, 13] },     // the calf, at the first cow's flank
];
const SPEED = 2.6, SPLIT = 0.38;   // pod cruise (m/s); where the tail piece pivots (fraction from the tail)
const BLACK = [0.025, 0.026, 0.03], WHITE = [0.86, 0.87, 0.88], SADDLE = [0.42, 0.43, 0.46];
const SHOW_R = 3000;

// --- the body ------------------------------------------------------------------
// A unit-length lathe along +z (tail at z = 0, nose at z = 1), radius by
// profile, the peduncle flattened side to side; colour painted from where a
// vertex is on the animal (the white chin and belly, the flank patch reaching
// up behind, the eye patch, the grey saddle behind the fin).
function radius(t) {
  // tail stock to a blunt rounded head; widest at ~0.6. Past 0.8 the head is
  // an ellipse's end (an orca has no beak: the melon rounds straight down)
  const prof = (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.75) * 0.112;
  if (t <= 0.8) return Math.max(prof(t), 0.012);
  const e = (t - 0.8) / 0.2;
  return Math.max(prof(0.8) * Math.pow(Math.max(0, 1 - e * e), 0.42), 0.006);
}
function paint(t, th) {
  const c = Math.cos(th), s = Math.abs(Math.sin(th));
  // eye patch: an oval above and behind the eye
  const ex = (t - 0.855) / 0.05, ey = (Math.acos(clamp(c, -1, 1)) - 1.3) / 0.3;
  if (ex * ex + ey * ey < 1) return WHITE;
  // chin and belly
  if (t > 0.5 && t < 0.985 && c < -0.42 + (t > 0.9 ? 0.15 : 0)) return WHITE;
  // the flank patch sweeping up behind the dorsal fin
  if (t > 0.22 && t < 0.47 && c < -0.1 + 0.55 * Math.sin(Math.PI * (t - 0.22) / 0.25) * s - 0.35) return WHITE;
  // saddle
  if (t > 0.38 && t < 0.52 && c > 0.72) return SADDLE;
  return BLACK;
}
function lathe(t0, t1, nT, nA, z0) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= nT; i++) {
    const t = t0 + (t1 - t0) * (i / nT), r = radius(t);
    const flat = t < 0.3 ? 0.55 + 1.5 * t : 1;      // the peduncle is narrow side to side
    for (let j = 0; j <= nA; j++) {
      const th = (j / nA) * Math.PI * 2;
      pos.push(Math.sin(th) * r * flat, Math.cos(th) * r * 0.95, t - z0);
      col.push(...paint(t, th));
    }
  }
  for (let i = 0; i < nT; i++) for (let j = 0; j < nA; j++) {
    const a = i * (nA + 1) + j, b = a + nA + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { pos, col, idx };
}
/** A flat paddle (pectoral flipper, fluke half): an outline extruded thin. */
function paddle(out, pts, thick, color, place) {
  const base = out.pos.length / 3, n = pts.length;
  for (const sy of [1, -1]) for (const [u, v] of pts) {
    const p = place(u, v, sy * thick);
    out.pos.push(p[0], p[1], p[2]); out.col.push(...color);
  }
  for (let i = 1; i < n - 1; i++) { out.idx.push(base, base + i, base + i + 1); out.idx.push(base + n, base + n + i + 1, base + n + i); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; out.idx.push(base + i, base + n + i, base + j, base + j, base + n + i, base + n + j); }
}
function geo(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 3));
  g.setIndex(o.idx);
  g.computeVertexNormals();
  return g;
}
function frontGeo() {
  const o = lathe(SPLIT, 1, 30, 18, SPLIT);
  // pectoral flippers: broad paddles low behind the head, swept back and down
  const pts = [[0, 0], [0.015, -0.035], [0.045, -0.065], [0.075, -0.07], [0.09, -0.05], [0.07, -0.015], [0.04, 0.005]];
  for (const sx of [1, -1]) paddle(o, pts, 0.004, BLACK, (u, v, w) => {
    // swept back and hanging down at ~40 deg under the chest
    const z = 0.8 - SPLIT - u * 0.85, r = radius(0.8);
    return [sx * (r * 0.62 + (-v) * 0.5), -r * 0.6 + v * 0.75 + w, z];
  });
  return geo(o);
}
function tailGeo() {
  const o = lathe(0.02, SPLIT + 0.025, 16, 18, SPLIT);   // a little past the pivot: no seam when the tail beats
  // flukes: a broad crescent, the notch at the middle, white below
  const pts = [[0, 0.02], [0.06, 0.05], [0.12, 0.06], [0.15, 0.04], [0.13, -0.01], [0.06, -0.035], [0, -0.03]];
  for (const sx of [1, -1]) paddle(o, pts, 0.006, BLACK, (u, v, w) => [sx * u, w, 0.02 - SPLIT + v]);
  return geo(o);
}
/** A dorsal fin of unit height, base 0.55 long: `curve` sweeps the tip back (the cows' falcate fin). */
function finGeo(curve) {
  const o = { pos: [], col: [], idx: [] };
  const pts = [];
  for (let i = 0; i <= 8; i++) { const u = i / 8; pts.push([-0.3 + 0.3 * u - curve * u * u * 0.9, u]); }   // leading edge, up
  for (let i = 8; i >= 0; i--) { const u = i / 8; pts.push([-0.3 + 0.55 - (0.45 + curve) * u + curve * u * u * 0.2, u * 0.98]); }   // trailing edge, down
  paddle(o, pts, 0.02, BLACK, (u, v, w) => [w * (1 - v * 0.8), v, u]);
  return geo(o);
}

export class Orcas {
  /** o: { scene, fx, game, hud (getter), audio (getter), player (getter), camera } */
  constructor(o) {
    this.o = o;
    try { this.seen = localStorage.getItem('auto-orcas') === '1'; } catch (e) { this.seen = false; }
    // the route, in world metres, each point checked to be well offshore
    this.route = ROUTE.map(([la, lo]) => {
      let [x, z] = G.toWorld(la, lo);
      for (let k = 0; k < 20 && !this._open(x, z); k++) x -= 60;   // west, out into the Sound
      return [x, z];
    });
    this.lens = [];
    let L = 0;
    for (let i = 0; i < this.route.length; i++) {
      const a = this.route[i], b = this.route[(i + 1) % this.route.length];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.lens.push(d); L += d;
    }
    this.loop = L;
    // every 50 m of the loop, not just its corners, must be open water
    this.dry = 0;
    for (let d = 0; d < L; d += 50) { const q = this._at(d); if (!this._open(q.x, q.z)) this.dry++; }
    if (this.dry) console.warn(`orcas: ${this.dry} samples of the loop are not open water`);
    this.wp = G.toWorld(...WEST_POINT);

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, envMapIntensity: 0.45, side: THREE.DoubleSide });
    const n = POD.length;
    this.front = new THREE.InstancedMesh(frontGeo(), mat, n);
    this.tail = new THREE.InstancedMesh(tailGeo(), mat, n);
    // two fins: the bull's straight one and the cows' falcate one, as one mesh
    // each would be two more draws -- one curved fin, its sweep set per whale
    // by shearing the instance matrix
    this.fin = new THREE.InstancedMesh(finGeo(0.25), mat, n);
    for (const m of [this.front, this.tail, this.fin]) {
      m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.name = 'orcas'; m.visible = false;
      o.scene.add(m);
    }
    this.whales = POD.map((p, i) => ({
      ...p, i, x: 0, z: 0, y: -6, h: 0, pitch: 0, roll: 0, tailP: 0, phase: Math.random() * 6,
      mode: 'under', t: 8 + i * 7 + Math.random() * 12, breaths: 0, arc: 0, vy: 0, blew: false,
    }));
    this.s = Math.random() * this.loop;   // where the pod is on its loop
    this.breachT = 70 + Math.random() * 60;
    this.stats = { blows: 0, breaches: 0, dives: 0 };
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._v = new THREE.Vector3(); this._sc = new THREE.Vector3(); this._f = new THREE.Matrix4();
    this._sh = new THREE.Matrix4();
  }

  /** Open water: wet here and all round at 80 m (no beaches, no piers). */
  _open(x, z) {
    for (let a = 0; a < 8; a++) {
      const r = 80, xx = x + Math.cos(a * Math.PI / 4) * r, zz = z + Math.sin(a * Math.PI / 4) * r;
      if (!G.isWater(xx, zz)) return false;
    }
    return G.isWater(x, z);
  }

  /** The point s metres round the loop, and its heading. */
  _at(s) {
    s = ((s % this.loop) + this.loop) % this.loop;
    for (let i = 0; i < this.route.length; i++) {
      if (s <= this.lens[i]) {
        const a = this.route[i], b = this.route[(i + 1) % this.route.length], f = s / this.lens[i];
        return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, h: Math.atan2(b[0] - a[0], b[1] - a[1]) };
      }
      s -= this.lens[i];
    }
    return { x: this.route[0][0], z: this.route[0][1], h: 0 };
  }

  _sighted(w, kind) {
    const cam = this.o.camera, p = this.o.player;
    if (!cam || this.seen) return;
    const dx = w.x - cam.position.x, dz = w.z - cam.position.z, d = Math.hypot(dx, dz);
    if (d > 700) return;
    cam.getWorldDirection(this._v);
    const fwd = Math.hypot(this._v.x, this._v.z) || 1;
    if ((dx * this._v.x + dz * this._v.z) / (d * fwd) < 0.75) return;   // ~40 deg off where you look
    this.seen = true;
    try { localStorage.setItem('auto-orcas', '1'); } catch (e) { /* private mode */ }
    const pay = 1000, game = this.o.game, hud = this.o.hud, audio = this.o.audio;
    if (game) game.money += pay;
    if (hud) hud.showToast(`Orcas off West Point! ${kind === 'breach' ? 'A breach -- ' : ''}Southern Residents, hunting Chinook in the Sound +$${pay.toLocaleString()}`, 6500);
    if (audio && audio.ready) audio.play('cash', { gain: 0.8 });
  }

  update(dt) {
    const cam = this.o.camera;
    if (!cam || !(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this.s += SPEED * dt;
    const c = this._at(this.s);
    const near = Math.hypot(c.x - cam.position.x, c.z - cam.position.z) < SHOW_R;
    for (const m of [this.front, this.tail, this.fin]) m.visible = near;
    // Out of range nobody moves but the pod's place on the loop. Coming back,
    // every whale is put on its station again (they are under water then, out
    // of sight): swimming the straight line to it from where it was left
    // would cut across West Point or Magnolia.
    if (!near) { this._away = true; return; }
    if (this._away) { this._away = false; for (const w of this.whales) { w.placed = false; if (w.mode === 'breach') w.mode = 'under'; } }
    this.breachT -= dt;
    const audio = this.o.audio, fx = this.o.fx;
    for (const w of this.whales) {
      // station in the pod: behind and beside the leader, wandering a little
      const p = this._at(this.s + w.at[0] + Math.sin(this.s * 0.013 + w.i) * 4);
      const sx = Math.cos(p.h), sz = -Math.sin(p.h);   // the pod's right
      const off = w.at[1] + Math.sin(this.s * 0.021 + w.i * 2) * 3;
      const tx = p.x + sx * off, tz = p.z + sz * off;
      w.h += angleWrap(Math.atan2(tx - w.x, tz - w.z) - w.h) * (w.mode === 'breach' ? 0 : Math.min(1, dt * 0.8));
      if (!w.placed || Math.hypot(tx - w.x, tz - w.z) > 150) { w.x = tx; w.z = tz; w.h = p.h; w.placed = true; }
      const lag = Math.hypot(tx - w.x, tz - w.z);
      const v = w.mode === 'breach' ? 3 : SPEED * clamp(0.6 + lag / 20, 0.6, 1.8);
      w.x += Math.sin(w.h) * v * dt; w.z += Math.cos(w.h) * v * dt;
      w.phase += dt * (w.mode === 'breach' ? 0 : 1.6 * (v / SPEED));
      w.tailP = Math.sin(w.phase) * 0.22;
      const r = radius(0.6) * w.L * 0.95;   // the back's height over the centre line

      if (this.breachT <= 0 && w.mode === 'under' && w.t > 4 && w.i !== 4) {
        // A BREACH: up from depth fast, out nose-first, onto its side, and down
        w.mode = 'breach'; w.vy = 10.5 + w.L * 0.25; w.y = -0.4 * w.L; w.arc = 0; w.roll = 0;
        this.breachT = 120 + Math.random() * 120;
      }
      if (w.mode === 'under') {
        w.t -= dt;
        w.y += (-5.5 - w.y) * Math.min(1, dt);
        w.pitch *= 1 - Math.min(1, dt * 2);
        if (w.t <= 0) { w.mode = 'surf'; w.breaths = 3 + Math.floor(Math.random() * 2); w.arc = 0; w.blew = false; }
      } else if (w.mode === 'surf') {
        // one breath: the back rolls through the surface in ~3.4 s
        w.arc += dt / 3.4;
        const u = Math.min(1, w.arc), last = w.breaths === 1;
        const top = r * 0.95;   // how much back shows at the top of the roll
        w.y = -r + top - (1 - Math.sin(Math.PI * u)) * (1.6 + r);
        w.pitch = -Math.cos(Math.PI * u) * 0.22 - (last && u > 0.55 ? (u - 0.55) * 1.6 : 0);
        if (last && u > 0.6) w.tailP = -0.25 - (u - 0.6) * 1.9;   // flukes up into the dive
        if (!w.blew && u > 0.32) {
          w.blew = true; this.stats.blows++;
          const nx = w.x + Math.sin(w.h) * w.L * 0.45, nz = w.z + Math.cos(w.h) * w.L * 0.45;
          if (fx) fx.emit(nx, 0.6, nz, 26, { r: 0.92, g: 0.94, b: 0.96, size: 1.1 + w.L * 0.08, life: 1.6, spread: 1.1, vy: 5.5 + w.L * 0.25, grav: -1.6, drag: 0.94, jitter: 0.4 });
          if (audio && audio.ready) audio.play('orca_blow', { x: nx, y: 1, z: nz, ref: 30, maxD: 900, gain: 0.9 * (w.L / 7.6) });
          this._sighted(w, 'blow');
        }
        if (u >= 1) {
          w.breaths--; w.arc = 0; w.blew = false;
          if (w.breaths <= 0) { w.mode = 'under'; w.t = 20 + Math.random() * 30; this.stats.dives++; }
        }
      } else if (w.mode === 'breach') {
        w.arc += dt;
        w.vy -= 9.8 * dt;
        w.y += w.vy * dt;
        w.pitch = clamp(w.vy / 10, -1.2, 1.15);
        w.roll = Math.min(0.75, w.arc * 0.6);
        if (w.arc > 0.3 && !w.blew && w.y > 0) { w.blew = true; this.stats.breaches++; this._sighted(w, 'breach'); }
        if (w.vy < 0 && w.y < -0.3 * w.L) {
          if (fx) {
            fx.emit(w.x, 0.4, w.z, 70, { r: 0.94, g: 0.96, b: 0.98, size: 1.6, life: 1.8, spread: 7, vy: 6, grav: -7, drag: 0.93, jitter: 2.2 });
            fx.emit(w.x, 0.2, w.z, 30, { r: 0.88, g: 0.92, b: 0.95, size: 2.6, life: 2.4, spread: 3, vy: 2, grav: -1, drag: 0.95, jitter: 3 });
          }
          if (audio && audio.ready) audio.play('splash', { x: w.x, y: 0, z: w.z, ref: 40, maxD: 1100, gain: 1.4, rate: 0.6 });
          w.mode = 'under'; w.t = 25 + Math.random() * 20; w.roll = 0; w.blew = false;
        }
      }
      this._place(w);
    }
    for (const m of [this.front, this.tail, this.fin]) m.instanceMatrix.needsUpdate = true;
  }

  /** The three instance matrices for whale w. */
  _place(w) {
    const L = w.L, m = this._m, e = this._e, q = this._q, sc = this._sc;
    // under the surface by more than a metre or two the water hides it; keep it
    // drawn only where it could show (a whale at -5 m is not drawn at all)
    const hide = w.y < -2.2 - L * 0.18 && w.mode === 'under';
    // the body: pivot at SPLIT, nose along +z
    e.set(-w.pitch, w.h, w.roll); q.setFromEuler(e);
    const px = w.x - Math.sin(w.h) * L * 0.12, pz = w.z - Math.cos(w.h) * L * 0.12;
    sc.set(hide ? 0 : L, hide ? 0 : L, hide ? 0 : L);
    m.compose(this._v.set(px, w.y, pz), q, sc);
    this.front.setMatrixAt(w.i, m);
    // the tail stock: the same, then its own beat about the pivot
    this._f.makeRotationX(-w.tailP);
    this._f.premultiply(m);
    this.tail.setMatrixAt(w.i, this._f);
    // the fin: on the back at 0.55, unit height scaled to the whale's fin,
    // its sweep (the cows' curve) a shear of height into length
    const finZ = 0.55 - SPLIT, top = radius(0.55) * 0.95;
    this._sh.set(
      1, 0, 0, 0,
      0, 1, 0, top,
      0, -0.25 + w.curve * 0.6, 1, finZ,
      0, 0, 0, 1);
    this._sh.scale(this._sc.set(w.fin / L * 0.9, w.fin / L, w.fin / L * 1.2));
    this._f.multiplyMatrices(m, this._sh);
    this.fin.setMatrixAt(w.i, this._f);
  }

  /** Test hook: one whale breaches now (the nearest under water). */
  breachNow() { this.breachT = 0; }
}
