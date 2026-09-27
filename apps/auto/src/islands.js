// THE ISLANDS ACROSS THE SOUND: Bainbridge's east shore, Blake Island and
// Vashon's north end are a floatplane or a boat away and nobody goes there,
// so they keep a few things of their own (and pay for finding them, once
// each; localStorage 'auto-islands'):
//
//   Vashon    the bike in the tree -- the island's famous one: a bicycle left
//             against a fir in the 1950s that the tree grew round. And in the
//             woods above it, a Sasquatch: he wanders, and when you come near
//             he turns and lopes off. Get within 15 m and you saw him.
//   Blake     the cedar longhouse by the marina with a salmon bake on cedar
//             stakes round the fire -- stand by it and dinner puts you back to
//             full health -- and the island's deer, who bolt when you come.
//             On the west beach, an X of driftwood: ENTER on it and dig.
//   Bainbridge  the labyrinth at Halls Hill: walk into its centre and the
//             gong sounds. (Pickleball's court is pickleball.js.)
//
// Everything is placed from real coordinates onto the nearest dry, open
// ground and drawn only within a few hundred metres.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { clamp, angleWrap } from './util.js';

const SITES = {
  bikeTree: [-9932, 12157],        // on the north end, among the firs
  sasquatch: [-9450, 12300],
  longhouse: [-11560, 7620],       // Blake Island, on the level ground above the marina
  deer: [-11700, 7950],
  treasure: [-12338, 7821],        // Blake Island's west beach
  labyrinth: [-12774, 2562],       // Halls Hill, Bainbridge
};
const FUR = [0.2, 0.13, 0.08], FUR_D = [0.13, 0.08, 0.05];

export class Islands {
  /** opts: { scene, city, world, game, hud, audio, player (getter), fx } */
  constructor(o) {
    this.o = o;
    try { this.found = new Set(JSON.parse(localStorage.getItem('auto-islands') || '[]')); } catch (e) { this.found = new Set(); }
    this.parts = [];
    this.place = {};
    const FOOT = { longhouse: 17, labyrinth: 9, bikeTree: 3 };
    for (const [k, [x, z]] of Object.entries(SITES)) this.place[k] = this._land(x, z, k === 'treasure' ? 'beach' : 'open', FOOT[k] || 0);
    this._bikeTree();
    this._sasquatch();
    this._longhouse();
    this._deer();
    this._treasure();
    this._labyrinth();
  }

  /** The nearest dry, open, fairly level ground to (x, z). */
  _land(x0, z0, kind, foot = 0) {
    const city = this.o.city;
    const inBld = (x, z) => city.buildingsNear(x, z, 20).some((b) => {
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
      return Math.abs(dx * c - dz * s) < b.w / 2 + 3 && Math.abs(dx * s + dz * c) < b.d / 2 + 3;
    });
    for (let r = 0; r < 400; r += 8) {
      const n = Math.max(1, Math.round(r / 5));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
        if (G.isWater(x, z) || city.onRoad(x, z, 3) || inBld(x, z)) continue;
        const y = G.terrainHeight(x, z);
        if (y < 0.4) continue;
        if (kind === 'beach') {
          // a beach: within 25 m of the water
          let wet = false;
          for (let j = 0; j < 8 && !wet; j++) if (G.isWater(x + Math.cos(j) * 25, z + Math.sin(j) * 25)) wet = true;
          if (!wet) continue;
        }
        const sl = Math.abs(G.terrainHeight(x + 4, z) - G.terrainHeight(x - 4, z)) + Math.abs(G.terrainHeight(x, z + 4) - G.terrainHeight(x, z - 4));
        if (sl > 2.2) continue;
        // a footprint: level within 1.6 m across it, dry and clear all round
        if (foot) {
          let lo = y, hi = y, ok = true;
          for (let j = 0; j < 12 && ok; j++) {
            const px = x + Math.cos(j / 12 * Math.PI * 2) * foot, pz = z + Math.sin(j / 12 * Math.PI * 2) * foot;
            if (G.isWater(px, pz) || city.onRoad(px, pz, 1) || inBld(px, pz)) ok = false;
            const py = G.terrainHeight(px, pz); lo = Math.min(lo, py); hi = Math.max(hi, py);
          }
          if (!ok || hi - lo > 1.6) continue;
        }
        return { x, z, y };
      }
    }
    return { x: x0, z: z0, y: G.terrainHeight(x0, z0) };
  }

  _add(mesh, x, z, r = 450) {
    mesh.frustumCulled = true;
    this.o.scene.add(mesh);
    this.parts.push({ mesh, x, z, r });
    return mesh;
  }

  _mesh(b, name, mat) {
    const m = new THREE.Mesh(b.build(), mat || this.o.world.mats.flat);
    m.name = name; m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  _reward(key, text, pay, ms = 4800) {
    if (this.found.has(key)) return false;
    this.found.add(key);
    try { localStorage.setItem('auto-islands', JSON.stringify([...this.found])); } catch (e) { /* private mode */ }
    if (this.o.game && pay) this.o.game.money += pay;
    if (this.o.hud) this.o.hud.showToast(`${text}${pay ? ` +$${pay.toLocaleString()}` : ''}`, ms);
    if (this.o.audio && this.o.audio.ready) this.o.audio.play('cash', { gain: 0.8 });
    return true;
  }

  // --- Vashon: the bike in the tree ------------------------------------------------

  _bikeTree() {
    const { x, z, y } = this.place.bikeTree, b = new Builder(false);
    const BARK = [0.28, 0.2, 0.14], RUST = [0.38, 0.18, 0.08];
    // a big old fir: the trunk flared at the base, the crown in tiers
    b.tube([x, y - 0.5, z], [x, y + 3, z], 0.85, 14, BARK, false);
    b.tube([x, y + 3, z], [x, y + 16, z], 0.62, 12, BARK, false);
    b.tube([x, y + 16, z], [x, y + 24, z], 0.35, 10, BARK, true);
    for (let k = 0; k < 6; k++) b.cone(x, y + 8 + k * 2.8, z, 5.2 - k * 0.7, 4.2, 10, [0.1 + k * 0.01, 0.26 + k * 0.012, 0.13]);
    // the bicycle, half swallowed: the front wheel and fork, the handlebar,
    // the top tube running into the bark at 1.5 m
    const bx = x + 0.95, by = y + 1.45, bz = z;
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2;
      b.tube([bx + 0.35, by + Math.cos(a0) * 0.34, bz + Math.sin(a0) * 0.34], [bx + 0.35, by + Math.cos(a1) * 0.34, bz + Math.sin(a1) * 0.34], 0.022, 5, [0.1, 0.09, 0.08], false);
    }
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI; b.tube([bx + 0.35, by + Math.cos(a) * 0.32, bz + Math.sin(a) * 0.32], [bx + 0.35, by - Math.cos(a) * 0.32, bz - Math.sin(a) * 0.32], 0.004, 3, RUST, false); }
    b.tube([bx + 0.35, by, bz], [bx + 0.2, by + 0.62, bz + 0.1], 0.02, 6, RUST, true);     // fork
    b.tube([bx + 0.2, by + 0.62, bz + 0.1], [x + 0.3, by + 0.58, bz + 0.05], 0.022, 6, RUST, true);   // top tube, into the tree
    b.tube([bx + 0.2, by + 0.62, bz + 0.1], [x + 0.35, by + 0.2, bz], 0.022, 6, RUST, true);          // down tube
    b.tube([bx + 0.16, by + 0.78, bz - 0.3], [bx + 0.16, by + 0.78, bz + 0.5], 0.016, 6, RUST, true);  // handlebar
    // a little sign on a post
    b.box(x + 2.6, y, z + 1.4, 0.08, 1.0, 0.08, 0, [0.35, 0.25, 0.15]);
    b.box(x + 2.6, y + 0.95, z + 1.4, 0.6, 0.35, 0.04, -0.6, [0.82, 0.76, 0.6]);
    this._add(this._mesh(b, 'islands:bikeTree'), x, z);
    this.bikeTree = { x, z, y };
  }

  // --- Vashon: Sasquatch ------------------------------------------------------------

  _sasquatch() {
    const { x, z, y } = this.place.sasquatch;
    const g = new THREE.Group(); g.name = 'islands:sasquatch';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const part = (build, px, py, pz) => { const b = new Builder(false); build(b); const m = new THREE.Mesh(b.build(), mat); m.castShadow = true; const pv = new THREE.Group(); pv.position.set(px, py, pz); pv.add(m); g.add(pv); return pv; };
    // 2.4 m tall, shaggy: a barrel of a body, a sloped head with a ridge,
    // long arms, short heavy legs. Pivots at the hips and shoulders.
    const body = part((b) => {
      b.spheroid(0, 1.62, 0, 0.46, 12, 8, FUR, 1.35, 0.05);
      b.spheroid(0, 1.15, -0.02, 0.4, 10, 6, FUR, 1.1, 0.05);
      b.spheroid(0, 2.2, 0.1, 0.22, 10, 7, FUR_D, 1.1, 0.03);
      b.box(0, 2.24, 0.26, 0.26, 0.05, 0.05, 0, [0.08, 0.05, 0.03]);           // brow
      b.spheroid(0, 2.16, 0.27, 0.1, 8, 5, [0.3, 0.22, 0.16], 0.8);             // face
      for (const s of [-1, 1]) b.spheroid(s * 0.05, 2.21, 0.33, 0.018, 6, 4, [0.9, 0.8, 0.4], 1);   // eyes
    }, 0, 0, 0);
    const limb = (len, r) => (b) => { b.tube([0, 0, 0], [0, -len * 0.5, 0.02], r, 8, FUR, false); b.tube([0, -len * 0.5, 0.02], [0, -len, 0.06], r * 0.85, 8, FUR, false); b.spheroid(0, -len, 0.08, r * 1.2, 8, 5, FUR_D, 0.7); };
    const legL = part(limb(0.95, 0.15), 0.2, 1.0, 0), legR = part(limb(0.95, 0.15), -0.2, 1.0, 0);
    const armL = part(limb(1.1, 0.1), 0.45, 1.95, 0.05), armR = part(limb(1.1, 0.1), -0.45, 1.95, 0.05);
    g.position.set(x, y, z);
    this._add(g, x, z, 420);
    this.sq = { g, legL, legR, armL, armR, body, home: { x, z }, x, z, h: 0, state: 'wander', t: 0, tgt: null, phase: 0 };
  }

  _updateSasquatch(dt, p) {
    const s = this.sq;
    if (!s.g.visible) return;
    const dx = s.x - p.x, dz = s.z - p.z, d = Math.hypot(dx, dz);
    let speed = 0;
    if (d < 15 && this._reward('sasquatch', 'SASQUATCH! You saw him, in the woods on Vashon. Nobody will believe you', 1500, 6000)) s.state = 'flee';
    if (d < 55) s.state = 'flee';
    if (s.state === 'flee') {
      // away from you, back into the trees, at a lope; gone for a while once far
      s.h = Math.atan2(dx, dz); speed = 5.5;
      if (d > 140) { s.state = 'wander'; s.tgt = null; }
    } else {
      s.t -= dt;
      if (!s.tgt || s.t <= 0 || Math.hypot(s.tgt[0] - s.x, s.tgt[1] - s.z) < 2) {
        s.t = 6 + Math.random() * 8;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 120;
        s.tgt = [s.home.x + Math.cos(a) * r, s.home.z + Math.sin(a) * r];
      }
      const want = Math.atan2(s.tgt[0] - s.x, s.tgt[1] - s.z);
      s.h += angleWrap(want - s.h) * Math.min(1, dt * 2);
      speed = s.t > 3 ? 1.1 : 0;
    }
    const nx = s.x + Math.sin(s.h) * speed * dt, nz = s.z + Math.cos(s.h) * speed * dt;
    if (!G.isWater(nx, nz) && G.terrainHeight(nx, nz) > 0.5 && Math.hypot(nx - s.home.x, nz - s.home.z) < 400) { s.x = nx; s.z = nz; }
    else s.h += Math.PI * 0.5;
    s.phase += dt * (speed > 3 ? 7 : 3.2) * (speed > 0 ? 1 : 0);
    const sw = Math.sin(s.phase) * (speed > 3 ? 0.9 : 0.45);
    s.legL.rotation.x = sw; s.legR.rotation.x = -sw;
    s.armL.rotation.x = -sw * 0.9; s.armR.rotation.x = sw * 0.9;
    s.body.rotation.x = speed > 3 ? 0.35 : 0.12;
    s.g.position.set(s.x, G.terrainHeight(s.x, s.z) + Math.abs(Math.sin(s.phase)) * 0.06, s.z);
    s.g.rotation.y = s.h;
  }

  // --- Blake Island: the longhouse and the salmon bake -----------------------------

  _longhouse() {
    const { x, z, y } = this.place.longhouse, b = new Builder(false);
    const CEDAR = [0.42, 0.26, 0.15], CEDAR_D = [0.3, 0.18, 0.1], ROOF = [0.24, 0.2, 0.16];
    const h = Math.atan2(-11398 - (-11800), 7443 - 7932);   // facing out over the water to the north-east
    const L = 30, Wd = 14, Wall = 3.2, Ridge = 6.2;
    const cr = Math.cos(-h), sr = Math.sin(-h);
    const P = (u, yy, v) => [x + u * cr - v * sr, y + yy, z + u * sr + v * cr];
    // plank walls (vertical boards: alternate shades), the gabled roof
    for (let k = 0; k < 40; k++) {
      const u0 = -Wd / 2 + (k / 40) * Wd, u1 = u0 + Wd / 40, col = k % 2 ? CEDAR : CEDAR_D;
      b.quad(P(u0, -3, L / 2), P(u1, -3, L / 2), P(u1, Wall + (Ridge - Wall) * (1 - Math.abs((u0 + u1) / Wd)), L / 2), P(u0, Wall + (Ridge - Wall) * (1 - Math.abs((u0 + u1) / Wd)), L / 2), [sr * 0, 0, 1].map((q, i) => i === 0 ? -sr : i === 2 ? cr : 0), [0, 0, 1, 0, 1, 1, 0, 1], col);
      b.quad(P(u0, -3, -L / 2), P(u1, -3, -L / 2), P(u1, Wall + (Ridge - Wall) * (1 - Math.abs((u0 + u1) / Wd)), -L / 2), P(u0, Wall + (Ridge - Wall) * (1 - Math.abs((u0 + u1) / Wd)), -L / 2), [sr, 0, -cr], [0, 0, 1, 0, 1, 1, 0, 1], col);
    }
    for (const s of [-1, 1]) {
      b.quad(P(s * Wd / 2, -3, -L / 2), P(s * Wd / 2, -3, L / 2), P(s * Wd / 2, Wall, L / 2), P(s * Wd / 2, Wall, -L / 2), [s * cr, 0, s * sr], [0, 0, 1, 0, 1, 1, 0, 1], CEDAR);
      b.quad(P(s * (Wd / 2 + 0.6), Wall - 0.2, -L / 2 - 0.6), P(s * (Wd / 2 + 0.6), Wall - 0.2, L / 2 + 0.6), P(0, Ridge + 0.1, L / 2 + 0.6), P(0, Ridge + 0.1, -L / 2 - 0.6), [s * cr * 0.6, 1, s * sr * 0.6], [0, 0, 1, 0, 1, 1, 0, 1], ROOF);
    }
    // the door in the front gable, and two carved posts either side of it
    b.box(...P(0, 0, L / 2 + 0.02), 1.6, 2.4, 0.06, -h, [0.12, 0.08, 0.05]);
    for (const s of [-1, 1]) {
      b.box(...P(s * 2.4, -0.2, L / 2 + 0.4), 0.7, 5.8, 0.7, -h, CEDAR_D);
      for (let k = 0; k < 4; k++) b.box(...P(s * 2.4, 0.6 + k * 1.3, L / 2 + 0.76), 0.6, 0.5, 0.04, -h, k % 2 ? [0.1, 0.1, 0.1] : [0.62, 0.14, 0.1]);
    }
    // the fire pit in front, and the salmon split and staked round it on cedar
    const fz = L / 2 + 9;
    const [fx, , fzz] = P(0, 0, fz);
    b.cone(fx, y - 0.1, fzz, 1.4, 0.2, 12, [0.3, 0.3, 0.3]);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2, sx = fx + Math.cos(a) * 1.9, sz = fzz + Math.sin(a) * 1.9;
      b.tube([sx, y, sz], [sx - Math.cos(a) * 0.35, y + 1.5, sz - Math.sin(a) * 0.35], 0.03, 5, [0.5, 0.36, 0.22], true);
      b.box(sx - Math.cos(a) * 0.25, y + 0.75, sz - Math.sin(a) * 0.25, 0.32, 0.55, 0.03, -a - Math.PI / 2, [0.92, 0.45, 0.3]);
    }
    for (const r of [0, 1.2, 2.4]) b.box(fx + Math.cos(r) * 0.3, y, fzz + Math.sin(r) * 0.3, 0.8, 0.14, 0.14, r, [0.2, 0.12, 0.08]);
    // picnic tables
    for (const s of [-1, 1]) {
      const [tx, , tz] = P(s * 6, 0, fz + 1);
      b.box(tx, y + 0.7, tz, 1.8, 0.06, 0.8, -h, [0.5, 0.36, 0.22]);
      for (const o of [-0.65, 0.65]) b.box(tx + Math.cos(-h) * 0 - Math.sin(-h) * o * 0, y, tz, 1.8, 0.45, 0.3, -h, [0.45, 0.32, 0.2]);
    }
    this._add(this._mesh(b, 'islands:longhouse'), x, z, 600);
    // the fire's glow, flickering
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 8), new THREE.MeshBasicMaterial({ color: 0xff8a2a, toneMapped: false, transparent: true, opacity: 0.85 }));
    fire.position.set(fx, y + 0.55, fzz); fire.name = 'islands:fire';
    this._add(fire, fx, fzz, 300);
    this.fire = { mesh: fire, x: fx, z: fzz };
    // solid: the longhouse's walls
    const city = this.o.city;
    if (city.setLandmarkSolids) city.setLandmarkSolids([...(city.landmarkSolids || []), { x, z, hw: Wd / 2, hd: L / 2, rot: -h, y0: y - 1, y1: y + Ridge }]);
    this.longhouse = { x, z, y };
  }

  // --- Blake Island's deer ------------------------------------------------------------

  _deer() {
    const { x, z } = this.place.deer;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const TAN = [0.46, 0.32, 0.2], BELLY = [0.8, 0.72, 0.6];
    this.herd = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group(); g.name = 'islands:deer';
      const b = new Builder(false);
      const s = i === 0 ? 1.15 : 0.9 + (i % 3) * 0.06;
      b.spheroid(0, 0.95 * s, 0, 0.3 * s, 10, 6, TAN, 0.8);
      b.spheroid(0, 0.95 * s, -0.25 * s, 0.26 * s, 10, 6, TAN, 0.8);
      b.spheroid(0, 0.88 * s, 0.3 * s, 0.24 * s, 10, 6, TAN, 0.8);
      b.tube([0, 1.05 * s, 0.42 * s], [0, 1.45 * s, 0.6 * s], 0.08 * s, 6, TAN, false);
      b.spheroid(0, 1.5 * s, 0.7 * s, 0.1 * s, 8, 5, TAN, 1.3);
      for (const sx of [-1, 1]) b.cone(sx * 0.07 * s, 1.58 * s, 0.64 * s, 0.035 * s, 0.14 * s, 5, TAN);
      b.spheroid(0, 1.02 * s, -0.5 * s, 0.07 * s, 6, 4, BELLY, 1);      // the white tail
      if (i === 0) for (const sx of [-1, 1]) { b.tube([sx * 0.06, 1.58, 0.66], [sx * 0.2, 1.85, 0.6], 0.012, 4, [0.6, 0.52, 0.4], true); b.tube([sx * 0.2, 1.85, 0.6], [sx * 0.24, 1.95, 0.72], 0.01, 4, [0.6, 0.52, 0.4], true); }
      const body = new THREE.Mesh(b.build(), mat); body.castShadow = true; g.add(body);
      const legs = [];
      for (const [lx, lz] of [[0.14, 0.32], [-0.14, 0.32], [0.14, -0.3], [-0.14, -0.3]]) {
        const lb = new Builder(false);
        lb.tube([0, 0, 0], [0, -0.75 * s, 0], 0.035 * s, 5, TAN, true);
        const pv = new THREE.Group(); pv.position.set(lx * s, 0.8 * s, lz * s);
        const lm = new THREE.Mesh(lb.build(), mat); pv.add(lm); g.add(pv); legs.push(pv);
      }
      const a = (i / 6) * Math.PI * 2, px = x + Math.cos(a) * (8 + i * 3), pz = z + Math.sin(a) * (8 + i * 3);
      g.position.set(px, G.terrainHeight(px, pz), pz);
      this._add(g, px, pz, 350);
      this.herd.push({ g, legs, x: px, z: pz, h: Math.random() * 6, home: { x, z }, state: 'graze', t: Math.random() * 5, phase: 0, run: 0 });
    }
  }

  _updateDeer(dt, p) {
    for (const d of this.herd) {
      if (!d.g.visible) continue;
      const dx = d.x - p.x, dz = d.z - p.z, dist = Math.hypot(dx, dz);
      let speed = 0;
      if (dist < 30) { d.state = 'flee'; d.run = 4; }
      if (d.state === 'flee') {
        d.h += angleWrap(Math.atan2(dx, dz) - d.h) * Math.min(1, dt * 4);
        speed = 7; d.run -= dt;
        if (d.run <= 0 && dist > 45) d.state = 'graze';
      } else {
        d.t -= dt;
        if (d.t <= 0) { d.t = 3 + Math.random() * 6; d.walk = Math.random() < 0.4; d.h += (Math.random() - 0.5) * 2; }
        if (Math.hypot(d.x - d.home.x, d.z - d.home.z) > 90) d.h = Math.atan2(d.home.x - d.x, d.home.z - d.z);
        speed = d.walk ? 0.9 : 0;
      }
      const nx = d.x + Math.sin(d.h) * speed * dt, nz = d.z + Math.cos(d.h) * speed * dt;
      if (!G.isWater(nx, nz) && G.terrainHeight(nx, nz) > 0.4) { d.x = nx; d.z = nz; } else d.h += Math.PI * 0.6;
      d.phase += dt * speed * 2.2;
      const sw = Math.sin(d.phase) * (speed > 3 ? 0.8 : 0.35);
      d.legs[0].rotation.x = sw; d.legs[3].rotation.x = sw; d.legs[1].rotation.x = -sw; d.legs[2].rotation.x = -sw;
      const bound = speed > 3 ? Math.abs(Math.sin(d.phase)) * 0.25 : 0;
      d.g.position.set(d.x, G.terrainHeight(d.x, d.z) + bound, d.z);
      d.g.rotation.y = d.h;
      // grazing: head down
      d.g.children[0].rotation.x = speed === 0 ? 0.25 : 0;
    }
  }

  // --- Blake Island's buried treasure -------------------------------------------------

  _treasure() {
    const { x, z, y } = this.place.treasure, b = new Builder(false);
    const WOOD = [0.55, 0.47, 0.38];
    // two driftwood logs crossed in an X
    for (const a of [0.7, -0.7]) b.tube([x - Math.cos(a) * 2, y + 0.12, z - Math.sin(a) * 2], [x + Math.cos(a) * 2, y + 0.12, z + Math.sin(a) * 2], 0.14, 7, WOOD, true);
    this._add(this._mesh(b, 'islands:x'), x, z, 300);
    // the chest, buried until dug
    const c = new Builder(false);
    c.box(0, 0, 0, 0.9, 0.5, 0.55, 0, [0.36, 0.2, 0.1]);
    c.box(0, 0.5, 0, 0.92, 0.12, 0.57, 0, [0.4, 0.23, 0.12]);
    for (const u of [-0.3, 0.3]) c.box(u, 0, 0, 0.06, 0.64, 0.58, 0, [0.72, 0.58, 0.2]);
    c.box(0, 0.3, 0.28, 0.1, 0.12, 0.03, 0, [0.85, 0.72, 0.25]);
    const chest = this._mesh(c, 'islands:chest');
    chest.position.set(x, y - 0.8, z);
    chest.visible = false;
    this.o.scene.add(chest);
    this.chest = { mesh: chest, x, z, y, dug: this.found.has('treasure'), rise: 0 };
    if (this.chest.dug) { chest.position.y = y; }
  }

  /** ENTER on foot: digging at the X. */
  tryInteract(pl) {
    const c = this.chest;
    if (!c || Math.hypot(pl.x - c.x, pl.z - c.z) > 2.6) return false;
    if (c.dug) { this.o.hud && this.o.hud.showToast('Only sand now. Someone got here first — you'); return true; }
    c.dug = true; c.rise = 0.001; c.mesh.visible = true;
    if (this.o.audio && this.o.audio.ready) this.o.audio.play('step_gravel', { gain: 1 });
    this._reward('treasure', 'You dig, and a sea chest comes up out of Blake Island\'s beach — gold and silver coin!', 5000, 6000);
    return true;
  }

  // --- Bainbridge: the labyrinth at Halls Hill ------------------------------------------

  _labyrinth() {
    const { x, z, y } = this.place.labyrinth, b = new Builder(false);
    const STONE = [0.62, 0.6, 0.56], PATH = [0.5, 0.46, 0.4];
    // the gravel floor, draped on the ground in rings
    const T = (px, pz) => G.terrainHeight(px, pz) + 0.05;
    for (let r = 0; r < 8; r++) for (let k = 0; k < 32; k++) {
      const a0 = (k / 32) * Math.PI * 2, a1 = ((k + 1) / 32) * Math.PI * 2, r0 = r * 1.05, r1 = (r + 1) * 1.05;
      const q = (rr, a) => { const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr; return [px, T(px, pz), pz]; };
      b.quad(q(r0, a0), q(r0, a1), q(r1, a1), q(r1, a0), [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], PATH);
    }
    // seven rings of set stones, each with its gap, turning the walk
    for (let r = 1; r <= 7; r++) {
      const R = r * 1.05, gap = (r * 1.7) % (Math.PI * 2);
      const n = Math.round(R * 6);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        if (Math.abs(angleWrap(a - gap)) < 0.32) continue;
        const sx = x + Math.cos(a) * R, sz = z + Math.sin(a) * R;
        b.box(sx, T(sx, sz) - 0.03, sz, 0.28, 0.14, 0.2, -a, STONE);
      }
    }
    // the gong at the centre, on a cedar frame
    for (const s of [-1, 1]) b.box(x + s * 0.7, y, z, 0.12, 2.1, 0.12, 0, [0.35, 0.22, 0.12]);
    b.box(x, y + 2.05, z, 1.6, 0.12, 0.14, 0, [0.35, 0.22, 0.12]);
    b.tube([x, y + 1.3, z - 0.02], [x, y + 1.3, z + 0.02], 0.45, 20, [0.74, 0.52, 0.22], true);
    this._add(this._mesh(b, 'islands:labyrinth'), x, z, 350);
    this.lab = { x, z, y };
  }

  update(dt) {
    const pl = this.o.player;
    if (!pl) return;
    const p = pl.position;
    // only near the islands does any of it exist
    for (const q of this.parts) q.mesh.visible = Math.hypot(q.x - p.x, q.z - p.z) < q.r;
    if (p.x > -8000) return;
    this._updateSasquatch(dt, p);
    this._updateDeer(dt, p);
    const onFoot = pl.onFoot;
    // the bike in the tree
    const bt = this.bikeTree;
    if (onFoot && Math.hypot(p.x - bt.x, p.z - bt.z) < 6) this._reward('bikeTree', 'The bike in the tree — left against a fir in the fifties, and the tree grew round it', 250);
    // the salmon bake: dinner, and your health back
    const f = this.fire;
    if (f.mesh.visible) {
      f.mesh.scale.set(1 + Math.sin(performance.now() / 90) * 0.08, 1 + Math.sin(performance.now() / 70) * 0.15, 1);
      if (onFoot && Math.hypot(p.x - f.x, p.z - f.z) < 4) {
        if (pl.health < 100) { pl.health = 100; this.o.hud && this.o.hud.showToast('Salmon baked on cedar at the longhouse — you feel much better', 3200); }
        this._reward('salmon', 'The salmon bake on Blake Island', 100);
      }
    }
    // the labyrinth's centre: the gong
    const L = this.lab;
    if (onFoot && Math.hypot(p.x - L.x, p.z - L.z) < 1.2) {
      if (!this._gongT || performance.now() - this._gongT > 6000) {
        this._gongT = performance.now();
        if (this.o.audio && this.o.audio.ready) this.o.audio.play('tram_bell', { gain: 1, rate: 0.35 });
        this._reward('labyrinth', 'You walked the labyrinth at Halls Hill to its centre', 150);
      }
    }
    // the chest rising out of the sand
    const c = this.chest;
    if (c && c.rise > 0 && c.rise < 1) { c.rise = Math.min(1, c.rise + dt * 0.8); c.mesh.position.y = c.y - 0.8 + 0.85 * c.rise; }
  }
}
