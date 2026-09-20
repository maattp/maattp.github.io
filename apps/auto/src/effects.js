// Sparks, smoke, tracers and pickup markers.

import * as THREE from './three.js';

const MAX = 420;

export class Effects {
  constructor(scene, tx) {
    this.scene = scene;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.PointsMaterial({
      size: 1.2, map: tx.particle, vertexColors: true, transparent: true,
      depthWrite: false, sizeAttenuation: true, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
    this.p = [];
    for (let i = 0; i < MAX; i++) this.p.push({ life: 0, x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, s: 1, drag: 0.9 });
    this.head = 0;

    // tracer lines
    const lgeo = new THREE.BufferGeometry();
    this.lpos = new Float32Array(64 * 6);
    lgeo.setAttribute('position', new THREE.BufferAttribute(this.lpos, 3));
    this.lines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.85 }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.tracers = [];

    // The boat's wake: one foam ribbon laid on the water behind the transom,
    // spreading and fading as it ages. Four vertices across each sample --
    // bright at the two arms, faint between them -- so it reads as the V of
    // a wake and not a white carpet. One mesh, one draw, drawn only while any
    // of it is alive.
    const WN = this.wakeN = 48, WV = 4;
    const wg = new THREE.BufferGeometry();
    this.wpos = new Float32Array(WN * WV * 3);
    this.wcol = new Float32Array(WN * WV * 4);
    wg.setAttribute('position', new THREE.BufferAttribute(this.wpos, 3).setUsage(THREE.DynamicDrawUsage));
    wg.setAttribute('color', new THREE.BufferAttribute(this.wcol, 4).setUsage(THREE.DynamicDrawUsage));
    const wi = [];
    for (let i = 0; i < WN - 1; i++) {
      for (let j = 0; j < WV - 1; j++) {
        const a = i * WV + j, b = a + 1, c = a + WV, d = c + 1;
        wi.push(a, c, b, b, c, d);
      }
    }
    wg.setIndex(wi);
    this.wakeMesh = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.wakeMesh.frustumCulled = false;
    this.wakeMesh.visible = false;
    this.wakeMesh.renderOrder = 6;
    scene.add(this.wakeMesh);
    // ring of samples, newest at wHead
    this.wk = [];
    for (let i = 0; i < WN; i++) this.wk.push({ x: 0, y: 0, z: 0, px: 0, pz: 0, age: 99, s: 0 });
    this.wHead = 0;
    this.wLast = null;
  }

  /**
   * Feed the wake: `v` is the boat being driven, or null to let what is there
   * fade. A sample is dropped every ~0.7 m of travel at the transom.
   */
  wake(dt, v) {
    const W = this.wk, N = this.wakeN, LIFE = 3.2;
    let alive = 0;
    for (const s of W) { s.age += dt; if (s.age < LIFE) alive++; }
    if (v) {
      const f = v.forward, sp = Math.abs(v.vLong);
      const tx = v.x - f.x * v.halfLen * 1.02, tz = v.z - f.z * v.halfLen * 1.02;
      const L = this.wLast;
      if (sp > 0.8 && (!L || Math.hypot(tx - L.x, tz - L.z) > 0.7)) {
        this.wHead = (this.wHead + 1) % N;
        const s = W[this.wHead];
        s.x = tx; s.z = tz; s.y = (v._surf === v._surf ? v._surf : v.y) + 0.035;
        s.px = f.z; s.pz = -f.x; s.age = 0; s.s = Math.min(1, sp / 9);
        this.wLast = s;
        alive++;
      }
    }
    this.wakeMesh.visible = alive > 0;
    if (!alive) return;
    const pos = this.wpos, col = this.wcol, WV = 4;
    // across the ribbon: offset as a fraction of the half-width, and alpha
    const U = [-1, -0.4, 0.4, 1], A = [1, 0.28, 0.28, 1];
    for (let k = 0; k < N; k++) {
      // k = 0 is the newest sample
      const s = W[(this.wHead - k + N) % N];
      const i = k * WV;
      if (s.age >= LIFE && k > 0) {
        // A dead sample collapses onto the one before it, or the quad joining
        // them would smear a fading streak to wherever it was laid.
        for (let e = 0; e < WV * 3; e++) pos[i * 3 + e] = pos[(i - WV) * 3 + e];
        for (let e = 0; e < WV * 4; e++) col[i * 4 + e] = 0;
        continue;
      }
      const t = Math.min(1, s.age / LIFE);
      const hw = 0.5 + s.age * 1.7;
      // bright at the transom, thinning to nothing
      const a = s.age >= LIFE ? 0 : s.s * (1 - t) * (1 - t) * 0.7 * Math.min(1, s.age * 8 + 0.35);
      for (let e = 0; e < WV; e++) {
        const o = (i + e) * 3, c = (i + e) * 4;
        pos[o] = s.x + s.px * hw * U[e]; pos[o + 1] = s.y; pos[o + 2] = s.z + s.pz * hw * U[e];
        col[c] = 0.93; col[c + 1] = 0.96; col[c + 2] = 0.98;
        // the centre fills back in just behind the transom (prop wash)
        col[c + 3] = a * (A[e] + (1 - A[e]) * Math.max(0, 1 - s.age * 1.4));
      }
    }
    this.wakeMesh.geometry.attributes.position.needsUpdate = true;
    this.wakeMesh.geometry.attributes.color.needsUpdate = true;
  }

  emit(x, y, z, n, opts = {}) {
    for (let i = 0; i < n; i++) {
      const p = this.p[this.head];
      this.head = (this.head + 1) % MAX;
      const spread = opts.spread || 2;
      p.x = x + (Math.random() - 0.5) * (opts.jitter || 0.3);
      p.y = y + (Math.random() - 0.5) * (opts.jitter || 0.3);
      p.z = z + (Math.random() - 0.5) * (opts.jitter || 0.3);
      p.vx = (Math.random() - 0.5) * spread + (opts.vx || 0);
      p.vy = (opts.vy != null ? opts.vy : 1.5) + Math.random() * spread * 0.5;
      p.vz = (Math.random() - 0.5) * spread + (opts.vz || 0);
      p.life = (opts.life || 0.8) * (0.6 + Math.random() * 0.7);
      p.maxLife = p.life;
      p.r = opts.r != null ? opts.r : 1;
      p.g = opts.g != null ? opts.g : 0.7;
      p.b = opts.b != null ? opts.b : 0.3;
      p.s = opts.size || 0.7;
      p.grav = opts.grav != null ? opts.grav : -4;
      p.drag = opts.drag != null ? opts.drag : 0.92;
    }
  }

  smoke(x, y, z, n = 4) {
    this.emit(x, y, z, n, { r: 0.55, g: 0.55, b: 0.58, size: 1.9, life: 1.5, spread: 0.7, vy: 1.6, grav: 0.4, drag: 0.9 });
  }

  sparks(x, y, z, n = 10) {
    this.emit(x, y, z, n, { r: 1, g: 0.75, b: 0.25, size: 0.35, life: 0.5, spread: 5, vy: 2.4, grav: -12, drag: 0.85 });
  }

  explosion(x, y, z) {
    this.emit(x, y, z, 40, { r: 1, g: 0.55, b: 0.15, size: 2.6, life: 1.1, spread: 8, vy: 5, grav: -3, jitter: 1.5 });
    this.emit(x, y, z, 30, { r: 0.3, g: 0.3, b: 0.32, size: 3.6, life: 2.4, spread: 4, vy: 4, grav: 0.6, jitter: 2 });
  }

  blood(x, y, z) {
    this.emit(x, y, z, 8, { r: 0.6, g: 0.08, b: 0.08, size: 0.3, life: 0.5, spread: 2.2, vy: 1.6, grav: -9 });
  }

  tracer(x0, y0, z0, x1, y1, z1) {
    this.tracers.push({ p: [x0, y0, z0, x1, y1, z1], life: 0.09 });
    if (this.tracers.length > 32) this.tracers.shift();
  }

  update(dt) {
    const pos = this.pos, col = this.col, size = this.size;
    for (let i = 0; i < MAX; i++) {
      const p = this.p[i];
      if (p.life <= 0) {
        pos[i * 3 + 1] = -9999;
        size[i] = 0;
        continue;
      }
      p.life -= dt;
      p.vy += p.grav * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = Math.max(0, p.life / p.maxLife);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r * t; col[i * 3 + 1] = p.g * t; col[i * 3 + 2] = p.b * t;
      size[i] = p.s * (0.5 + t);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;

    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) { this.tracers.splice(i, 1); continue; }
      if (n < 32) {
        this.lpos.set(t.p, n * 6);
        n++;
      }
    }
    for (let i = n; i < 32; i++) this.lpos.set([0, -9999, 0, 0, -9999, 0], i * 6);
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.visible = n > 0;
  }
}
