// SEAFAIR: unlimited hydroplane racing on Lake Washington, off Stan Sayres
// Pits at Genesee Park, where Seattle has raced them every August since 1951.
//
// THE COURSE is an oval in the open water between the pits and Mercer
// Island, run counter-clockwise: south down the west straight past the pits
// (the start/finish line is halfway down it), round the south turn, north up
// the back straight, round the north turn. Each turn has its buoys on the
// inside; going inside them is a buoy violation, a lap's penalty. The log
// boom lies along the back straight -- a line of logs with spectator boats
// tied to it -- and the grandstands and the pit dock are on the west shore.
//
// A RACE: the clock starts at 30 s with the boats on the back straight.
// Cross the line before zero and it is a lap's penalty (a jump start);
// the trick, as in life, is to hit it flat out a moment after. Heats are
// three laps, the final four. Positions, lap and gap on the HUD; the
// commentator calls it. THE SEAFAIR CUP is two heats and a final, points by
// finishing place; the final's winner takes the Cup.
//
// THE BOATS are `hydro` vehicles (vehicles.js buildHydro / updateHydro): lift
// for the turns or they hook and spin; watch the nose at speed or they blow
// over. Five rivals, driven here (mode 'race', which traffic leaves alone):
// a racing line with a lane each, a pace by curvature and skill, lifting
// when their nose is high, and room for each other. Every boat throws a
// rooster tail -- one particle system, one draw, for all of them -- and
// running in another boat's wake kicks the nose.
//
// And in the final, the jets: a six-ship delta flyover down the course.

import * as THREE from './three.js';
import * as G from './geo.js';
import { HYDRO } from './vehicles.js';

// the oval: north and south turn centres, radius, and the lake's level
const NTC = G.toWorld(47.5818, -122.2700), STC = G.toWorld(47.5695, -122.2652);
const R = 150;
const PITS = G.toWorld(47.5706, -122.2742);
const BOATS = [
  { name: 'MISS SEATTLE', num: 'U-1', col: 0xd8242c, player: true },
  { name: 'EMERALD FLYER', num: 'U-5', col: 0x1f9a5a, skill: 0.95 },
  { name: 'RAIN KING', num: 'U-9', col: 0x2f5fd0, skill: 1.0 },
  { name: 'SOUND SPIRIT', num: 'U-3', col: 0xf2b820, skill: 0.9 },
  { name: 'THUNDERBIRD', num: 'U-7', col: 0x7a2ab8, skill: 0.97 },
  { name: 'RAINIER BLUE', num: 'U-12', col: 0x20b8c8, skill: 0.86 },
];
const EVENTS = [
  { id: 'heat1', name: 'HEAT 1', laps: 3 },
  { id: 'heat2', name: 'HEAT 2', laps: 3 },
  { id: 'final', name: 'SEAFAIR CUP FINAL', laps: 4 },
];
const POINTS = [400, 300, 225, 169, 127, 95];
const PURSE = [600, 400, 250, 150, 100, 50];
const MPH = 2.23694;

// --- the course's geometry -------------------------------------------------------------

export class Course {
  constructor() {
    this.A = { x: NTC[0], z: NTC[1] };
    this.B = { x: STC[0], z: STC[1] };
    const dx = this.B.x - this.A.x, dz = this.B.z - this.A.z, L0 = Math.hypot(dx, dz);
    this.u = { x: dx / L0, z: dz / L0 };                // north -> south along the course
    this.nW = { x: -this.u.z, z: this.u.x };             // toward the west shore
    if (this.nW.x > 0) { this.nW.x *= -1; this.nW.z *= -1; }
    this.L0 = L0; this.R = R;
    this.L = 2 * L0 + 2 * Math.PI * R;
    this.sLine = L0 * 0.5;                               // start/finish: halfway down the west straight
  }

  /** Centreline point, direction and outward normal at arc length s (inside lane, radius R). */
  at(s, off = 0) {
    const { A, B, u, nW, L0 } = this, L = this.L;
    s = ((s % L) + L) % L;
    const P = (c, cx, cz) => ({ x: c.x + cx, z: c.z + cz });
    if (s < L0) {                                         // the west straight, southbound
      const p = P(A, nW.x * (R + off) + u.x * s, nW.z * (R + off) + u.z * s);
      return { ...p, dx: u.x, dz: u.z, ox: nW.x, oz: nW.z };
    }
    s -= L0;
    if (s < Math.PI * R) {                                // the south turn, round B
      const t = s / R;
      const ox = nW.x * Math.cos(t) + u.x * Math.sin(t), oz = nW.z * Math.cos(t) + u.z * Math.sin(t);
      return { x: B.x + ox * (R + off), z: B.z + oz * (R + off), dx: -nW.x * Math.sin(t) + u.x * Math.cos(t), dz: -nW.z * Math.sin(t) + u.z * Math.cos(t), ox, oz };
    }
    s -= Math.PI * R;
    if (s < L0) {                                         // the back straight, northbound
      const p = P(B, -nW.x * (R + off) - u.x * s, -nW.z * (R + off) - u.z * s);
      return { ...p, dx: -u.x, dz: -u.z, ox: -nW.x, oz: -nW.z };
    }
    s -= L0;
    const t = s / R;                                      // the north turn, round A
    const ox = -nW.x * Math.cos(t) - u.x * Math.sin(t), oz = -nW.z * Math.cos(t) - u.z * Math.sin(t);
    return { x: A.x + ox * (R + off), z: A.z + oz * (R + off), dx: nW.x * Math.sin(t) - u.x * Math.cos(t), dz: nW.z * Math.sin(t) - u.z * Math.cos(t), ox, oz };
  }

  /** Nearest centreline arc length to (x, z), and the offset outward from it. */
  project(x, z) {
    const { A, B, u, nW, L0 } = this;
    const cands = [];
    // straights
    for (const [c, sgn, s0, n] of [[A, 1, 0, nW], [B, -1, L0 + Math.PI * R, { x: -nW.x, z: -nW.z }]]) {
      const px = x - c.x, pz = z - c.z;
      let t = (px * u.x + pz * u.z) * sgn;
      t = Math.max(0, Math.min(L0, t));
      const off = px * n.x + pz * n.z - R;
      const along = (px * u.x + pz * u.z) * sgn;
      const d = Math.abs(along - t) + Math.abs(Math.min(0, off + R)) * 0;
      cands.push({ s: s0 + t, off, d: Math.hypot(along - t, 0) + (off < -R ? 1e6 : 0) });
    }
    // turns
    for (const [c, s0, sign] of [[B, L0, 1], [A, 2 * L0 + Math.PI * R, -1]]) {
      const px = x - c.x, pz = z - c.z, r = Math.hypot(px, pz) || 1;
      // angle from the turn's start direction
      const sx = sign > 0 ? nW.x : -nW.x, sz = sign > 0 ? nW.z : -nW.z;
      const tx = sign > 0 ? u.x : -u.x, tz = sign > 0 ? u.z : -u.z;
      const a = Math.atan2(px * tx + pz * tz, px * sx + pz * sz);
      if (a >= 0 && a <= Math.PI) cands.push({ s: s0 + a * R, off: r - R, d: 0 });
    }
    cands.sort((a, b) => a.d - b.d || Math.abs(a.off) - Math.abs(b.off));
    return cands[0];
  }

  /** In a turn, and inside its buoys? */
  insideBuoys(x, z) {
    for (const c of [this.A, this.B]) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < R - 22) {
        // only the turn's own half: past the centre line along the course axis
        const along = (x - c.x) * this.u.x + (z - c.z) * this.u.z;
        if ((c === this.B && along > -5) || (c === this.A && along < 5)) return true;
      }
    }
    return false;
  }
}

// --- rooster tails --------------------------------------------------------------------------

class Spray {
  constructor(scene) {
    const N = 1600;
    this.N = N;
    this.p = new Float32Array(N * 3); this.v = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N); this.size = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(this.p, 3); this.pos.setUsage(THREE.DynamicDrawUsage);
    this.al = new THREE.BufferAttribute(new Float32Array(N), 1); this.al.setUsage(THREE.DynamicDrawUsage);
    this.sz = new THREE.BufferAttribute(this.size, 1); this.sz.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos); geo.setAttribute('alpha', this.al); geo.setAttribute('size', this.sz);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float alpha; attribute float size; varying float vA; uniform float scale;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = alpha * smoothstep(6.0, 34.0, -mv.z); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main() { vec2 q = gl_PointCoord - 0.5; float r = dot(q, q) * 4.0; if (r > 1.0) discard; gl_FragColor = vec4(0.94, 0.97, 1.0, vA * (1.0 - r) * 0.55); }`,
    });
    this.pts = new THREE.Points(geo, mat);
    this.pts.frustumCulled = false;
    this.pts.name = 'hydroSpray';
    scene.add(this.pts);
    this.i = 0;
  }
  emit(x, y, z, vx, vy, vz, life, size) {
    const i = this.i; this.i = (this.i + 1) % this.N;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size;
  }
  update(dt, camH) {
    const a = this.al.array;
    let live = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) { a[i] = 0; continue; }
      live++;
      this.life[i] -= dt;
      this.v[i * 3 + 1] -= 9.8 * dt;
      const k = Math.exp(-0.6 * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 2] *= k;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.size[i] += dt * 2.2;
      const f = this.life[i] / this.max[i];
      a[i] = Math.min(1, f * 1.6) * (this.life[i] > 0 ? 1 : 0);
    }
    this.pos.needsUpdate = true; this.al.needsUpdate = true; this.sz.needsUpdate = true;
    this.pts.material.uniforms.scale.value = camH;
    this.pts.visible = live > 0;
  }
}

// --- the event -------------------------------------------------------------------------------

export class Seafair {
  /** opts: { scene, city, world, traffic, getters: player, game, hud, audio, camera } */
  constructor(opts) {
    this.o = opts;
    this.course = new Course();
    this.level = opts.world.waterLevelAt(this.course.A.x, this.course.A.z) || 5.09;
    this.spray = new Spray(opts.scene);
    this.state = 'idle';            // idle | menu | staging | racing | done
    this.boats = [];
    this.series = this._loadSeries();
    this._scenery();
    this._buildDom();
    this.jets = null;
    this.capT = 0;
  }

  _loadSeries() {
    try { const s = JSON.parse(localStorage.getItem('auto-seafair') || 'null'); if (s && s.points) return s; } catch (e) { /* private */ }
    return { event: 0, points: BOATS.map(() => 0), cups: 0, best: 0 };
  }
  _saveSeries() { try { localStorage.setItem('auto-seafair', JSON.stringify(this.series)); } catch (e) { /* private */ } }

  // --- scenery ------------------------------------------------------------------------------

  _scenery() {
    const { scene, city } = this.o, C = this.course, Y = this.level;
    const pos = [], col = [], idx = [];
    const box = (x, y, z, w, h, d, rot, c) => {
      const b = pos.length / 3, cs = Math.cos(rot), sn = Math.sin(rot);
      const P = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
      for (const [px, py, pz] of P) { const lx = px * w / 2, lz = pz * d / 2; pos.push(x + lx * cs + lz * sn, y + (py + 1) * h / 2, z - lx * sn + lz * cs); const sh = py > 0 ? 1 : 0.72; col.push(c[0] * sh, c[1] * sh, c[2] * sh); }
      for (const f of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) idx.push(b + f[0], b + f[1], b + f[2], b + f[0], b + f[2], b + f[3]);
    };
    const cyl = (x, y, z, r, h, c, n = 8) => {
      const b = pos.length / 3;
      for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2; for (const yy of [0, h]) { pos.push(x + Math.cos(a) * r, y + yy, z + Math.sin(a) * r); const sh = yy ? 1 : 0.7; col.push(c[0] * sh, c[1] * sh, c[2] * sh); } }
      for (let k = 0; k < n; k++) { const a = b + k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const cap = pos.length / 3; pos.push(x, y + h, z); col.push(...c);
      for (let k = 0; k < n; k++) idx.push(cap, b + (k + 1) * 2 + 1, b + k * 2 + 1);
    };
    // turn buoys, alternating orange and yellow, just inside each turn
    for (const c of [C.A, C.B]) {
      const sign = c === C.B ? 1 : -1;
      for (let k = 0; k <= 12; k++) {
        const t = k / 12 * Math.PI;
        const ox = (sign > 0 ? C.nW.x : -C.nW.x) * Math.cos(t) + (sign > 0 ? C.u.x : -C.u.x) * Math.sin(t);
        const oz = (sign > 0 ? C.nW.z : -C.nW.z) * Math.cos(t) + (sign > 0 ? C.u.z : -C.u.z) * Math.sin(t);
        cyl(c.x + ox * (R - 22), Y - 0.4, c.z + oz * (R - 22), 1.3, 2.8, k % 2 ? [0.98, 0.78, 0.1] : [0.98, 0.42, 0.08]);
      }
    }
    // the start/finish: a pylon each side of the course, red and white
    const sf = C.at(C.sLine, -30), sf2 = C.at(C.sLine, 90);
    for (const p of [sf, sf2]) for (let k = 0; k < 5; k++) cyl(p.x, Y - 0.5 + k * 2.2, p.z, 1.6 - k * 0.1, 2.2, k % 2 ? [0.95, 0.95, 0.94] : [0.85, 0.12, 0.1]);
    this.sfPylons = [sf, sf2];
    // the log boom along the back straight, 170 m out from the inside lane, and its boats
    let sd = 17;
    const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const hulls = [[0.95, 0.95, 0.94], [0.2, 0.3, 0.55], [0.85, 0.2, 0.15], [0.95, 0.95, 0.94], [0.15, 0.4, 0.3], [0.9, 0.8, 0.3]];
    const boomOff = 170;
    for (let s = C.L0 + Math.PI * R + 40; s < 2 * C.L0 + Math.PI * R - 40; s += 9) {
      const p = C.at(s, boomOff), h = Math.atan2(p.dx, p.dz);
      box(p.x, Y - 0.35, p.z, 0.8, 0.6, 9.4, -h, [0.36, 0.26, 0.18]);                  // a log
      if (rnd() < 0.8) {
        for (const side of [1, -1]) {
          if (rnd() < 0.3) continue;
          const bl = 7 + rnd() * 8, bw = 2.4 + rnd() * 1.4, dist = side * (bw / 2 + 1.2);
          const bx = p.x + p.ox * dist, bz = p.z + p.oz * dist;
          const c = hulls[Math.floor(rnd() * hulls.length)];
          box(bx, Y - 0.4, bz, bw, 1.3, bl, -h + (rnd() - 0.5) * 0.2, c);
          box(bx, Y + 0.9, bz + 0, bw * 0.7, 1.2 + rnd() * 1.2, bl * 0.4, -h, [0.95, 0.95, 0.93]);
          if (rnd() < 0.6) box(bx, Y + 0.9, bz, bw * 0.92, 0.08, bl * 0.9, -h, [0.95, 0.95, 0.93]);
          if (rnd() < 0.5) box(bx, Y + 2.3, bz, bw * 0.6, 0.12, bl * 0.35, -h, [0.1 + rnd() * 0.8, 0.2 + rnd() * 0.6, 0.3 + rnd() * 0.6]);
        }
      }
    }
    // the pits: a floating dock off the west shore at Stan Sayres, team tents on the lawn, a crane.
    // The shore is found by walking west from the start line to dry ground.
    const sfp = C.at(C.sLine);
    let shoreP = null;
    for (let t = 0; t < 1500; t += 4) {
      const x = sfp.x + C.nW.x * t, z = sfp.z + C.nW.z * t;
      if (!G.isWater(x, z) && G.terrainHeight(x, z) > Y + 0.3) { shoreP = [x, z]; break; }
    }
    if (!shoreP) shoreP = PITS;
    const [px, pz] = shoreP;
    this.pitDir = { x: -C.nW.x, z: -C.nW.z };         // from the shore out to the course
    // the dock starts where the water is deep enough, a little way out
    let shore = 0;
    for (let t = 0; t < 200; t += 2) { const x = px + this.pitDir.x * t, z = pz + this.pitDir.z * t; if ((this.o.world.waterLevelAt(x, z) || Y) - G.terrainHeight(x, z) > 1.2) { shore = t; break; } }
    const dh = Math.atan2(this.pitDir.x, this.pitDir.z);
    this.dock = { x: px + this.pitDir.x * (shore + 18), z: pz + this.pitDir.z * (shore + 18), h: dh };
    const dk = this.dock;
    box(dk.x, Y - 0.2, dk.z, 60, 0.6, 12, -dh + Math.PI / 2, [0.55, 0.5, 0.44]);
    box(px + this.pitDir.x * (shore + 4), Y - 0.2, pz + this.pitDir.z * (shore + 4), 5, 0.6, 24, -dh, [0.55, 0.5, 0.44]);
    const across = { x: Math.cos(dh), z: -Math.sin(dh) };
    // the crane on the dock
    const cr = { x: dk.x + across.x * 22, z: dk.z + across.z * 22 };
    box(cr.x, Y + 0.4, cr.z, 1.2, 14, 1.2, -dh, [0.95, 0.72, 0.1]);
    box(cr.x - this.pitDir.x * 5, Y + 14, cr.z - this.pitDir.z * 5, 1, 1, 14, -dh, [0.95, 0.72, 0.1]);
    // tents and grandstands on the lawn behind the shore
    // inland from the shore, and off the road that runs along it (Lake Washington Blvd)
    const lawn = (t, a, pad = 6) => {
      for (let k = 0; k < 12; k++) {
        const tt = t - k * 5, x = px + this.pitDir.x * tt + across.x * a, z = pz + this.pitDir.z * tt + across.z * a;
        if (!city.onRoad(x, z, pad) && !G.isWater(x, z)) return [x, city.groundAt(x, z, null), z];
      }
      const x = px + this.pitDir.x * t + across.x * a, z = pz + this.pitDir.z * t + across.z * a;
      return [x, city.groundAt(x, z, null), z];
    };
    const tentCols = [[0.85, 0.15, 0.12], [0.12, 0.55, 0.3], [0.15, 0.3, 0.75], [0.9, 0.7, 0.1], [0.5, 0.2, 0.7], [0.1, 0.65, 0.7]];
    for (let k = 0; k < 6; k++) {
      const [x, y, z] = lawn(-10, -40 + k * 16);
      box(x, y, z, 10, 3, 10, -dh, [0.95, 0.95, 0.93]);
      box(x, y + 3, z, 11, 1.4, 11, -dh, tentCols[k]);
    }
    for (const a of [-95, -70, 70, 95]) {
      const [x, y, z] = lawn(-6, a, 12);
      for (let r = 0; r < 7; r++) {
        box(x - this.pitDir.x * r * 1.4, y + r * 0.7, z - this.pitDir.z * r * 1.4, 22, 0.7, 1.4, -dh, [0.7, 0.72, 0.75]);
        for (let q = -10; q < 10; q += 1.1) if (rnd() < 0.75) {
          const cx = x - this.pitDir.x * r * 1.4 + across.x * q, cz = z - this.pitDir.z * r * 1.4 + across.z * q;
          box(cx, y + r * 0.7 + 0.7, cz, 0.5, 0.7, 0.4, -dh, [0.2 + rnd() * 0.8, 0.2 + rnd() * 0.7, 0.2 + rnd() * 0.7]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    m.name = 'seafair';
    m.receiveShadow = true;
    scene.add(m);
    this.sceneryMesh = m;
    // the banner over the start/finish, between the pylons
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#0a2a6a'; g.fillRect(0, 0, 1024, 128);
    g.fillStyle = '#ffd23a'; g.font = '900 80px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('SEAFAIR · START / FINISH', 512, 94);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const len = Math.hypot(sf2.x - sf.x, sf2.z - sf.z);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(len, len / 8), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    ban.position.set((sf.x + sf2.x) / 2, Y + 14, (sf.z + sf2.z) / 2);
    ban.rotation.y = Math.atan2(sf2.x - sf.x, sf2.z - sf.z) - Math.PI / 2;
    scene.add(ban);
    this.banner = ban;
    this.spot = { x: px - this.pitDir.x * 3, z: pz - this.pitDir.z * 3 };
    this.door = { ...this.spot, y: city.groundAt(this.spot.x, this.spot.z, null) };
    // the practice boat, moored off the dock
    this.moor = { x: dk.x + this.pitDir.x * 12, z: dk.z + this.pitDir.z * 12, h: dh };
  }

  spawnPractice() {
    const { traffic } = this.o;
    const v = traffic.spawnAt(this.moor.x, this.moor.z, this.moor.h, 'hydro', BOATS[0].col, 'apron');
    v.vLong = 0;
    this.practice = v;
  }

  near(pl) { return Math.hypot(pl.x - this.door.x, pl.z - this.door.z) < 6 && Math.abs(pl.y - this.door.y) < 3; }

  // --- the overlay: HUD, captions, menus -------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'seafairUi';
    d.innerHTML = `<div class="sBox"><span class="sPos"></span><span class="sLap"></span><span class="sTime"></span><span class="sSpd"></span></div>
      <div class="sClock"></div><div class="sWarn">NOSE HIGH</div><div class="sCap"></div><div class="sPanel"></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #seafairUi { position: absolute; inset: 0; z-index: 14; pointer-events: none; display: none; font: 900 14px -apple-system, Helvetica, sans-serif; color: #fff; }
      #seafairUi.show { display: block; }
      #seafairUi .sBox { position: absolute; top: calc(8px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%); display: flex; gap: 14px; align-items: baseline;
        background: rgba(10, 30, 70, .72); padding: 6px 14px; border-radius: 10px; border-bottom: 3px solid #ffd23a; text-shadow: 0 1px 0 #0008; white-space: nowrap; }
      #seafairUi .sPos { font-size: 22px; color: #ffd23a; } #seafairUi .sSpd { color: #9ae4ff; }
      #seafairUi .sClock { position: absolute; top: 22%; left: 50%; transform: translateX(-50%); font: 900 64px -apple-system, Helvetica, sans-serif; text-shadow: 0 3px 0 #0009; display: none; text-align: center; }
      #seafairUi .sClock small { display: block; font-size: 15px; letter-spacing: .08em; }
      #seafairUi .sWarn { position: absolute; top: 34%; left: 50%; transform: translateX(-50%); padding: 6px 16px; border-radius: 8px; background: #c8201a; font-size: 18px; letter-spacing: .1em; display: none; }
      #seafairUi .sCap { position: absolute; left: 50%; bottom: calc(100px + var(--safe-b, 0px)); transform: translateX(-50%); max-width: min(640px, 72vw); background: rgba(10, 30, 70, .74);
        padding: 8px 14px; border-radius: 10px; border-left: 4px solid #ffd23a; font: 700 14px/1.4 -apple-system, Helvetica, sans-serif; opacity: 0; transition: opacity .3s; }
      #seafairUi .sCap.show { opacity: 1; }
      #seafairUi .sPanel { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(6, 18, 42, .86);
        pointer-events: auto; text-align: center; padding: 0 20px; }
      #seafairUi .sPanel.on { display: flex; }
      #seafairUi .sPanel .big { font: 900 32px -apple-system, Helvetica, sans-serif; color: #ffd23a; letter-spacing: .04em; }
      #seafairUi .sPanel .sm { font: 700 14px/1.55 -apple-system, Helvetica, sans-serif; max-width: 620px; opacity: .95; }
      #seafairUi .sPanel table { border-collapse: collapse; font: 700 13px -apple-system, Helvetica, sans-serif; }
      #seafairUi .sPanel td { padding: 3px 10px; text-align: left; } #seafairUi .sPanel tr.me td { color: #ffd23a; }
      #seafairUi .sPanel button { padding: 10px 24px; border-radius: 999px; border: none; color: #fff; font: 900 15px -apple-system, sans-serif; background: #2f5fd0; margin: 2px; }
      #seafairUi .sPanel button.back { background: rgba(255,255,255,.18); }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { box: q('.sBox'), pos: q('.sPos'), lap: q('.sLap'), time: q('.sTime'), spd: q('.sSpd'), clock: q('.sClock'), warn: q('.sWarn'), cap: q('.sCap'), panel: q('.sPanel') };
  }

  say(text, t = 4) {
    this.ui.cap.innerHTML = `<b style="color:#ffd23a">SEAFAIR:</b> ${text}`;
    this.ui.cap.classList.add('show');
    this.capT = Math.max(t, text.length / 18);
    this.el.classList.add('show');
  }

  _panel(html, buttons) {
    const p = this.ui.panel;
    p.innerHTML = html + `<div>${buttons.map((b, i) => `<button data-i="${i}" class="${b.back ? 'back' : ''}">${b.label}</button>`).join('')}</div>`;
    p.classList.add('on');
    this.el.classList.add('show');
    p.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { p.classList.remove('on'); buttons[+b.dataset.i].go(); }));
  }

  /** ENTER at the pits: the race office. */
  start() {
    const S = this.series, ev = EVENTS[S.event % EVENTS.length];
    const table = BOATS.map((b, i) => ({ b, p: S.points[i] })).sort((a, c) => c.p - a.p);
    this.state = 'menu';
    this.o.game.paused = true;
    this._panel(`<div class="big">SEAFAIR</div><div class="sm">Unlimited hydroplanes on Lake Washington. You drive ${BOATS[0].num} ${BOATS[0].name}.<br>
      Hit the start line flat out AFTER the clock reaches zero. Lift for the turns or she'll hook. Watch the nose at speed -- push the stick forward or lift, or she'll blow over.
      Stay outside the turn buoys.</div>
      <table>${table.map((t) => `<tr class="${t.b.player ? 'me' : ''}"><td>${t.b.num}</td><td>${t.b.name}</td><td>${t.p} pts</td></tr>`).join('')}</table>
      <div class="sm">Next: <b>${ev.name}</b> (${ev.laps} laps)${S.cups ? ` · Cups won: ${S.cups}` : ''}${S.best ? ` · Best lap ${S.best.toFixed(2)} s` : ''}</div>`,
      [{ label: `RACE ${ev.name}`, go: () => this._startRace(ev) }, { label: 'FREE PRACTICE', go: () => this._practice() }, { label: 'LEAVE', back: true, go: () => this._closeMenu() }]);
  }

  _closeMenu() { this.state = 'idle'; this.o.game.paused = false; if (!this.boats.length) this.el.classList.remove('show'); }

  _practice() {
    this.state = 'idle';
    this.o.game.paused = false;
    const { player } = this.o;
    if (!this.practice || this.practice.dead) this.spawnPractice();
    player.enterVehicle(this.practice);
    this.say('The course is open for practice. The pits are on the west shore when you\'re ready to race.');
  }

  // --- a race -------------------------------------------------------------------------------------

  _startRace(ev) {
    const { traffic, player, game } = this.o, C = this.course;
    game.paused = false;
    if (player.vehicle) player.exitVehicle(true);
    this._clearBoats();
    this.ev = ev;
    this.state = 'staging';
    this.clock = 30;
    this.t = 0;
    // the boats 1.35 km from the line (up the back straight), spread across the lanes
    const s0 = ((C.sLine - 1350) % C.L + C.L) % C.L;
    BOATS.forEach((b, i) => {
      const lane = 12 + i * 11;
      const p = C.at(s0 - i * 18, lane);
      const v = traffic.spawnAt(p.x, p.z, Math.atan2(p.dx, p.dz), 'hydro', b.col, b.player ? 'free' : 'race');
      v.vLong = 12;
      v.group.visible = true;
      const boat = { b, v, i, lane, laps: 0, lapReq: ev.laps, s: C.project(p.x, p.z).s, prevS: 0, passedMid: false, lapT: 0, best: 0, times: [], done: 0, pen: 0, out: false, skill: b.skill || 1, crossedEarly: false, started: false };
      boat.prevS = boat.s;
      this.boats.push(boat);
      if (b.player) { player.enterVehicle(v); this.me = boat; }
    });
    this.el.classList.add('show');
    this.ui.clock.style.display = 'block';
    this.say(`${ev.name}! The one-minute gun has gone -- thirty seconds on the clock. Watch for the jump start!`);
    if (ev.id === 'final') this._launchJets(12);
  }

  _clearBoats() {
    const { traffic } = this.o;
    for (const bt of this.boats) if (traffic.cars.includes(bt.v) && bt.v !== this.o.player.vehicle) traffic.remove(bt.v);
    this.boats = [];
    this.me = null;
  }

  update(dt) {
    const { player, camera } = this.o;
    if (this.capT > 0) { this.capT -= dt; if (this.capT <= 0) this.ui.cap.classList.remove('show'); }
    // rooster tails: any hydro within 2 km of the camera
    const hydros = [];
    for (const bt of this.boats) hydros.push(bt.v);
    if (this.practice && !hydros.includes(this.practice)) hydros.push(this.practice);
    if (player.vehicle && player.vehicle.spec.hydro && !hydros.includes(player.vehicle)) hydros.push(player.vehicle);
    for (const v of hydros) this._tail(v, dt);
    this.spray.update(dt, (this.o.renderer ? this.o.renderer.domElement.height : 800) * 0.5 / Math.tan((camera.fov * Math.PI / 180) / 2));
    this._hydroHud(dt);
    if (this.jets) this._jetsStep(dt);
    if (this.state !== 'staging' && this.state !== 'racing') return;
    this._raceStep(dt);
  }

  _tail(v, dt) {
    const sp = Math.abs(v.vLong);
    if (sp < 8 || (v.hyd && v.hyd.blown > 0)) return;
    const cam = this.o.camera.position;
    if (Math.hypot(v.x - cam.x, v.z - cam.z) > 2000) return;
    const f = v.forward, sx = v.x - f.x * 4.2, sz = v.z - f.z * 4.2, y = (v._surf === v._surf ? v._surf : v.y);
    // the rooster tail: up and back from the prop, height with speed
    const n = Math.min(6, Math.floor(sp / 10) + 1);
    for (let k = 0; k < n; k++) {
      const up = 6 + sp * 0.34 * (0.7 + Math.random() * 0.5), back = sp * 0.35 * (0.6 + Math.random() * 0.6);
      this.spray.emit(sx + (Math.random() - 0.5), y + 0.3, sz + (Math.random() - 0.5), -f.x * back + (Math.random() - 0.5) * 2, up, -f.z * back + (Math.random() - 0.5) * 2, 1.4 + Math.random() * 0.8, 1.2 + sp * 0.03);
    }
    // spray off the sponsons
    if (sp > 25 && Math.random() < 0.6) for (const sd of [-1, 1]) this.spray.emit(v.x + f.x * 2 + f.z * sd * 2.4, y + 0.2, v.z + f.z * 2 - f.x * sd * 2.4, f.z * sd * 6, 3, -f.x * sd * 6, 0.6, 0.8);
  }

  _hydroHud() {
    const v = this.o.player.vehicle, u = this.ui;
    const on = !!(v && v.spec.hydro);
    if (on && !this.el.classList.contains('show')) this.el.classList.add('show');
    if (!on && !this.boats.length && !u.panel.classList.contains('on') && this.capT <= 0) this.el.classList.remove('show');
    u.warn.style.display = on && v.hyd && v.hyd.warn && Math.floor(performance.now() / 180) % 2 ? 'block' : 'none';
    if (on && !this.me) {
      u.box.style.display = 'flex';
      u.pos.textContent = BOATS[0].num; u.lap.textContent = 'PRACTICE'; u.time.textContent = '';
      u.spd.textContent = `${Math.round(Math.abs(v.vLong) * MPH)} MPH`;
    } else if (!this.me) u.box.style.display = 'none';
    if (on && v.hyd) {
      if (v.blewOver) { v.blewOver = false; this.say('BLOWOVER! She\'s gone over backwards!', 3); this._sfx('blowover'); if (!this.me) setTimeout(() => this._right(v), 3500); }
      if (v.hooked) { v.hooked = false; this.say('She hooks in the turn and spins!', 2.5); this._sfx('hook'); }
    }
  }

  _right(v) { if (v.hyd) { v.hyd.blown = 0; v.hyd.flip = 0; v.hyd.nose = 0; v.hyd.noseV = 0; v.vLong = 0; } }

  _raceStep(dt) {
    const C = this.course, { player } = this.o;
    this.t += dt;
    if (this.state === 'staging') {
      this.clock -= dt;
      if (this.clock <= 0) { this.state = 'racing'; this.raceT = 0; this.say('The clock hits zero -- and they\'re racing!'); this._sfx('gun'); }
    } else this.raceT += dt;
    // AI boats
    for (const bt of this.boats) if (!bt.b.player && !bt.done) this._drive(bt, dt);
    // boat-boat contact
    for (let i = 0; i < this.boats.length; i++) for (let j = i + 1; j < this.boats.length; j++) {
      const a = this.boats[i].v, b = this.boats[j].v;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d < 6 && d > 0.01) {
        const nx = dx / d, nz = dz / d, pen = (6 - d) / 2;
        a.x -= nx * pen; a.z -= nz * pen; b.x += nx * pen; b.z += nz * pen;
        // speed lost on the impact only: closing speed along the contact
        const close = (a.forward.x * a.vLong - b.forward.x * b.vLong) * nx + (a.forward.z * a.vLong - b.forward.z * b.vLong) * nz;
        if (close > 1) {
          a.vLong *= 0.85; b.vLong *= 0.85;
          if (a === player.vehicle || b === player.vehicle) { this._sfx('bump'); if (close > 6) this.say('Contact! They bang sponsons!', 2); }
        }
      }
      // wakes: running close behind another boat kicks the nose
      for (const [p, q] of [[a, b], [b, a]]) {
        const rx = p.x - q.x, rz = p.z - q.z, behind = -(rx * q.forward.x + rz * q.forward.z);
        const side = Math.abs(rx * q.forward.z - rz * q.forward.x);
        if (behind > 8 && behind < 70 && side < 7 && p.hyd && Math.abs(q.vLong) > 30) p.hyd.wakeKick += (Math.random() - 0.3) * 6;
      }
    }
    // progress, laps, violations
    for (const bt of this.boats) {
      if (bt.done) continue;
      const v = bt.v;
      const pr = C.project(v.x, v.z);
      bt.prevS = bt.s; bt.s = pr.s; bt.off = pr.off;
      bt.lapT += dt;
      const L = C.L, ds = ((bt.s - bt.prevS + L * 1.5) % L) - L * 0.5;
      const lineNow = ds > 0 && bt.prevS < C.sLine && bt.s >= C.sLine && bt.s - bt.prevS < 60;
      if (Math.abs(((bt.s - C.sLine + L * 1.5) % L) - L * 0.5) > L * 0.3) bt.passedMid = true;
      if (lineNow) {
        if (this.state === 'staging') {
          // a jump start: the start does not count, so it is a lap lost before it begins
          if (!bt.crossedEarly) { bt.crossedEarly = true; if (bt.b.player) { this.say('Jump start! Over the line before the gun -- your race starts next time round.'); this._sfx('penalty'); } else this.say(`${bt.b.num} ${bt.b.name} jumps the gun! That costs a lap.`, 3); }
        } else if (!bt.started) { bt.started = true; bt.lapT = 0; bt.passedMid = false; }
        else if (bt.passedMid) {
          bt.laps++; bt.passedMid = false;
          bt.times.push(bt.lapT);
          if (!bt.best || bt.lapT < bt.best) bt.best = bt.lapT;
          if (bt.b.player) {
            this._sfx('lap');
            if (!this.series.best || bt.lapT < this.series.best) { this.series.best = bt.lapT; this._saveSeries(); }
          }
          bt.lapT = 0;
          if (bt.laps >= bt.lapReq + bt.pen) { bt.done = this.raceT; bt.place = this.boats.filter((o) => o.done).length; this._finish(bt); }
        }
      }
      // cutting inside the turn buoys
      if (this.state === 'racing' && C.insideBuoys(v.x, v.z)) {
        if (!bt.inBuoy) { bt.inBuoy = true; bt.pen++; if (bt.b.player) { this.say('Buoy violation! You went inside the turn buoys -- one-lap penalty.'); this._sfx('penalty'); } else this.say(`${bt.b.num} cuts a buoy -- one-lap penalty.`, 3); }
      } else bt.inBuoy = false;
      if (bt.b.player && v.hyd && v.hyd.blown > 0 && !bt.out) { bt.out = true; this.say('BLOWOVER! MISS SEATTLE is out of the race. The rescue crew is on the way.'); this._sfx('blowover'); setTimeout(() => this._end(true), 4000); }
    }
    // positions
    const order = this._order();
    order.forEach((bt, i) => { bt.pos = i + 1; });
    const me = this.me;
    if (me) {
      if (this.state === 'racing' && this._lastLeader !== order[0] && this.raceT > 3) { this._lastLeader = order[0]; this.say(`${order[0].b.num} ${order[0].b.name} takes the lead!`, 2.5); }
      const u = this.ui;
      u.box.style.display = 'flex';
      u.pos.textContent = `P${me.pos}/${this.boats.length}`;
      u.lap.textContent = this.state === 'staging' ? 'ON THE CLOCK' : `LAP ${Math.min(me.laps + 1, me.lapReq + me.pen)}/${me.lapReq + me.pen}`;
      u.time.textContent = this.state === 'racing' ? `${me.lapT.toFixed(1)} s${me.best ? ` · BEST ${me.best.toFixed(2)}` : ''}` : '';
      u.spd.textContent = `${Math.round(Math.abs(me.v.vLong) * MPH)} MPH`;
      if (this.state === 'staging') {
        const toLine = ((C.sLine - me.s) % C.L + C.L) % C.L;
        u.clock.innerHTML = `${Math.ceil(this.clock)}<small>${Math.round(toLine)} M TO THE LINE</small>`;
      } else u.clock.style.display = 'none';
      if (!player.vehicle || player.vehicle !== me.v) { this._offT = (this._offT || 0) + dt; if (this._offT > 8 && !me.done) this._end(true); } else this._offT = 0;
    }
    if (this.boats.every((b) => b.done || b.out) || (me && me.done && this.raceT - me.done > 25)) this._end(false);
  }

  /** How far round the race a boat is: laps (less penalties) and the distance past the line; before its start, minus the distance to it. */
  _prog(bt) {
    const C = this.course, past = ((bt.s - C.sLine) % C.L + C.L) % C.L;
    return bt.started ? (bt.laps - bt.pen) * C.L + past : past - C.L;
  }

  /** Finishing order: finishers by time, then the rest by progress, then the boats that are out. */
  _order() {
    const rank = (b) => (b.out ? 2 : b.done ? 0 : 1);
    return this.boats.slice().sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.done - b.done : this._prog(b) - this._prog(a)));
  }

  _drive(bt, dt) {
    const C = this.course, v = bt.v, sp = Math.abs(v.vLong);
    // aim along the racing line: a lane, eased wider in the turns, and room for others
    let lane = bt.lane * 0.6 + 6;
    for (const o of this.boats) {
      if (o === bt || o.out) continue;
      const ds = ((o.s - bt.s + C.L * 1.5) % C.L) - C.L * 0.5;
      // a boat just ahead in my lane: go round it outside; one alongside: give it room
      if (ds > 0 && ds < 60 && Math.abs((o.off || 0) - lane) < 9) lane = (o.off || 0) + 13;
      else if (Math.abs(ds) < 14 && Math.abs((o.off || 0) - (bt.off || 0)) < 9) lane = (bt.off || 0) + ((bt.off || 0) >= (o.off || 0) ? 7 : -7);
    }
    lane = Math.max(4, Math.min(90, lane));
    const look = 40 + sp * 0.9;
    const tgt = C.at(bt.s + look, lane);
    const want = Math.atan2(tgt.x - v.x, tgt.z - v.z);
    let da = want - v.heading; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    // positive steer raises heading (a left turn)
    const steer = Math.max(-1, Math.min(1, da * 3.2));
    // pace: the straights flat out, the turns at what the sponsons will hold
    const inTurn = this._turnAhead(bt.s + sp * 1.5);
    let vt = (inTurn ? 50 : 70) * (0.9 + 0.1 * bt.skill);
    let throttle = sp < vt ? 1 : 0.25;
    // the start: hit the line at speed just after zero
    if (this.state === 'staging') {
      // pace to arrive a moment after zero: the better the driver, the closer to it
      const toLine = ((C.sLine - bt.s) % C.L + C.L) % C.L;
      const margin = 0.4 + (1.05 - bt.skill) * 6;
      const vWant = Math.min(69, toLine / Math.max(0.3, this.clock + margin));
      throttle = sp < vWant ? 1 : sp > vWant + 4 ? 0 : 0.5;
    }
    // the nose: lift when it's high
    if (v.hyd && v.hyd.nose > HYDRO.warn - 0.03) throttle = Math.min(throttle, 0.4);
    const pitch = v.hyd && v.hyd.nose > HYDRO.warn - 0.05 ? -1 : -0.3;
    v.update(dt, { throttle, brake: 0, steer, pitch });
    if (v.hyd && v.hyd.blown > 0 && !bt.out) { bt.out = true; this.say(`${bt.b.num} ${bt.b.name} blows over! She's out.`, 3); }
  }

  _turnAhead(s) {
    const C = this.course, L = C.L;
    s = ((s % L) + L) % L;
    return (s > C.L0 && s < C.L0 + Math.PI * R) || s > 2 * C.L0 + Math.PI * R;
  }

  _finish(bt) {
    if (bt.b.player) { this._sfx('flag'); this.say(`Checkered flag! MISS SEATTLE finishes P${bt.place}.`, 4); }
    else if (bt.place === 1) this.say(`${bt.b.num} ${bt.b.name} takes the checkered flag!`, 3);
  }

  _end(dnf) {
    if (this.state !== 'staging' && this.state !== 'racing') return;
    this.state = 'done';
    this.ui.clock.style.display = 'none';
    const ev = this.ev, S = this.series;
    const res = this._order();
    res.forEach((bt, i) => { bt.place = i + 1; if (!bt.out) S.points[bt.i] += POINTS[i] || 0; });
    const me = this.me, place = me ? me.place : 6;
    const outMe = me && (me.out || dnf);
    const pay = outMe ? 0 : PURSE[place - 1] || 0;
    let cup = false;
    if (ev.id === 'final') {
      const champ = BOATS.map((b, i) => ({ i, p: S.points[i] })).sort((a, b) => b.p - a.p)[0];
      cup = champ.i === 0;
      if (cup) S.cups++;
      S.event = 0;
      this._cupRes = { champ: BOATS[champ.i] };
    } else S.event++;
    if (ev.id === 'final') S.points = BOATS.map(() => 0);
    this._saveSeries();
    if (pay + (cup ? 2000 : 0) > 0 && this.o.onReward) this.o.onReward(pay + (cup ? 2000 : 0));
    const rows = res.map((bt) => `<tr class="${bt.b.player ? 'me' : ''}"><td>${bt.out ? 'OUT' : 'P' + bt.place}</td><td>${bt.b.num}</td><td>${bt.b.name}</td><td>${bt.best ? bt.best.toFixed(2) + ' s' : '--'}</td><td>${bt.pen ? '+' + bt.pen + ' pen' : ''}</td></tr>`).join('');
    const head = outMe ? 'DID NOT FINISH' : cup ? 'SEAFAIR CUP CHAMPION!' : place === 1 ? `${ev.name}: YOU WIN!` : `${ev.name}: P${place}`;
    this._panel(`<div class="big">${head}</div><table>${rows}</table><div class="sm">${pay ? `Purse $${pay}` : ''}${cup ? ' + $2,000 and the Seafair Cup!' : ev.id === 'final' && this._cupRes ? ` · The Cup goes to ${this._cupRes.champ.num} ${this._cupRes.champ.name}` : ''}</div>`,
      [{ label: 'BACK TO THE PITS', go: () => this._toPits() }]);
    this.o.game.paused = true;
  }

  _toPits() {
    const { player, game } = this.o;
    game.paused = false;
    if (player.vehicle) player.exitVehicle(true);
    this._clearBoats();
    this.state = 'idle';
    player.x = this.door.x; player.z = this.door.z; player.y = this.door.y + 0.5;
    this.el.classList.remove('show');
  }

  // --- the jets --------------------------------------------------------------------------------

  _launchJets(delay) {
    const C = this.course;
    this.jets = { t: -delay, planes: [], y: this.level + 160, from: C.at(C.L0 * 0.5 + C.L0 * 1.2, -40), dir: null };
    const a = C.B, b = C.A;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    this.jets.dir = { x: dx / l, z: dz / l };
    this.jets.start = { x: a.x - this.jets.dir.x * 2200, z: a.z - this.jets.dir.z * 2200 };
  }

  _jetsStep(dt) {
    const J = this.jets, { traffic } = this.o;
    J.t += dt;
    if (J.t < 0) return;
    if (!J.planes.length) {
      // the delta: lead, two wings, the slot, two outer wings
      const slots = [[0, 0], [-1, -1], [1, -1], [0, -2], [-2, -2], [2, -2]];
      for (const [sx, sb] of slots) {
        const v = traffic.spawnAt(J.start.x, J.start.z, Math.atan2(J.dir.x, J.dir.z), 'fighter', 0x0a2a6a, 'race');
        v.group.visible = true;
        J.planes.push({ v, sx, sb });
      }
      this.say('And here come the jets -- a six-ship delta down the course!', 4);
      this._sfx('jets');
    }
    const along = J.t * 190;
    const px = -J.dir.z, pz = J.dir.x;
    for (const P of J.planes) {
      const d = along + P.sb * 18;
      P.v.x = J.start.x + J.dir.x * d + px * P.sx * 14; P.v.z = J.start.z + J.dir.z * d + pz * P.sx * 14;
      P.v.y = J.y - Math.abs(P.sx) * 2; P.v.heading = Math.atan2(J.dir.x, J.dir.z); P.v.pitch = 0; P.v.roll = 0;
      P.v.sync();
    }
    if (along > 5000) { for (const P of J.planes) traffic.remove(P.v); this.jets = null; }
  }

  // --- sound ------------------------------------------------------------------------------------

  _sfx(name) {
    const au = this.o.audio;
    if (!au || !au.ctx || !au.live) return;
    const c = au.ctx, out = au.master || c.destination, t0 = c.currentTime + 0.01;
    const tone = (type, f, d, v, f2, at = 0) => { const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0 + at); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + at + d); g.gain.setValueAtTime(v, t0 + at); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d); o.connect(g).connect(out); o.start(t0 + at); o.stop(t0 + at + d + 0.02); };
    const noise = (d, v, f, at = 0, rise = 0) => {
      const n = c.sampleRate * d, b = c.createBuffer(1, n, c.sampleRate), ch = b.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
      const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      s.buffer = b; fl.type = 'lowpass'; fl.frequency.value = f;
      g.gain.setValueAtTime(rise ? 0.0001 : v, t0 + at); if (rise) g.gain.exponentialRampToValueAtTime(v, t0 + at + rise); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d);
      s.connect(fl).connect(g).connect(out); s.start(t0 + at);
    };
    switch (name) {
      case 'gun': noise(0.6, 0.9, 1400); break;
      case 'lap': tone('sine', 1320, 0.15, 0.2); tone('sine', 1760, 0.2, 0.2, 0, 0.12); break;
      case 'flag': [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, 0.2, 0.25, 0, i * 0.1)); break;
      case 'penalty': tone('square', 220, 0.4, 0.2, 140); break;
      case 'blowover': noise(1.4, 0.9, 900); tone('sawtooth', 160, 1, 0.3, 50); break;
      case 'hook': noise(0.8, 0.6, 3000); break;
      case 'bump': noise(0.15, 0.5, 500); break;
      case 'jets': noise(6, 0.5, 700, 0, 2.5); noise(4, 0.25, 3000, 1.5, 1.5); break;
      default: break;
    }
  }
}

export { BOATS, EVENTS };
