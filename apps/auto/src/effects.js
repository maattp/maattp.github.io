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
