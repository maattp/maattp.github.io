import * as THREE from 'three';
import { $ } from './utils.js';

// Particles (pooled additive points), laser tracer bolts, and floating damage numbers.
export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.engine.scene;

    // particle pool
    this.N = 2000;
    this.pos = new Float32Array(this.N * 3);
    this.col = new Float32Array(this.N * 3);
    this.parts = new Array(this.N);
    for (let i = 0; i < this.N; i++) { this.parts[i] = { x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 0, g: 0, b: 0, grav: 1 }; this.pos[i * 3 + 1] = -999; }
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.32, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false; scene.add(this.points);
    this.geo = geo;

    // tracer pool
    this.BN = 64; this.bolts = [];
    const bgeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true); bgeo.translate(0, 0.5, 0);
    for (let i = 0; i < this.BN; i++) {
      const m = new THREE.Mesh(bgeo, new THREE.MeshBasicMaterial({ color: 0x46f9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.visible = false; m.frustumCulled = false; scene.add(m);
      this.bolts.push({ mesh: m, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, traveled: 0, speed: 1, len: 2, onArrive: null });
    }
    this.bcursor = 0;
    this._up = new THREE.Vector3(0, 1, 0); this._q = new THREE.Quaternion(); this._d = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._proj = new THREE.Vector3();
  }

  _spawn(x, y, z, vx, vy, vz, life, r, g, b, grav = 1) {
    const p = this.parts[this.cursor]; this.cursor = (this.cursor + 1) % this.N;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.max = life; p.r = r; p.g = g; p.b = b; p.grav = grav;
  }
  burst(x, y, z, n, col, spd, life, grav = 1) {
    const r = (col >> 16 & 255) / 255, g = (col >> 8 & 255) / 255, b = (col & 255) / 255;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2, s = spd * (0.4 + Math.random() * 0.6);
      this._spawn(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + spd * 0.3, Math.sin(a) * Math.cos(e) * s, life * (0.6 + Math.random() * 0.6), r, g, b, grav);
    }
  }
  spark(x, y, z, dx, dy, dz, n, col) {
    const r = (col >> 16 & 255) / 255, g = (col >> 8 & 255) / 255, b = (col & 255) / 255;
    for (let i = 0; i < n; i++) {
      const s = 3 + Math.random() * 6;
      this._spawn(x, y, z, dx * s + (Math.random() - .5) * 4, dy * s + Math.random() * 3, dz * s + (Math.random() - .5) * 4, 0.15 + Math.random() * 0.25, r, g, b, 1.2);
    }
  }
  blood(x, y, z, dirx, dirz, n, col) {
    const r = (col >> 16 & 255) / 255, g = (col >> 8 & 255) / 255, b = (col & 255) / 255;
    for (let i = 0; i < n; i++) {
      const s = 2 + Math.random() * 5;
      this._spawn(x, y, z, dirx * s + (Math.random() - .5) * 3, Math.random() * 3 + 1, dirz * s + (Math.random() - .5) * 3, 0.3 + Math.random() * 0.4, r, g, b, 1.4);
    }
  }

  tracer(from, to, color, onArrive) {
    const b = this.bolts[this.bcursor]; this.bcursor = (this.bcursor + 1) % this.BN;
    this._d.subVectors(to, from); const dist = this._d.length(); this._d.normalize();
    b.from.copy(from); b.dir.copy(this._d); b.dist = dist; b.traveled = 0; b.speed = 260; b.len = Math.min(2.6, dist); b.onArrive = onArrive;
    b.mesh.material.color.setHex(color); b.mesh.material.opacity = 0.95; b.mesh.scale.set(1, b.len, 1);
    this._q.setFromUnitVectors(this._up, this._d); b.mesh.quaternion.copy(this._q);
    b.mesh.position.copy(from); b.mesh.visible = true;
  }

  damageNumber(worldPos, dmg, head) {
    this._proj.copy(worldPos).project(this.game.engine.camera);
    if (this._proj.z > 1) return;
    const x = (this._proj.x * 0.5 + 0.5) * innerWidth, y = (-this._proj.y * 0.5 + 0.5) * innerHeight;
    const el = document.createElement('div'); el.className = 'dn' + (head ? ' head' : ''); el.textContent = dmg;
    if (!head) el.style.color = dmg >= 80 ? '#ff7a3c' : '#fff';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    const c = $('dmgNums'); c.appendChild(el);
    if (c.children.length > 40) c.removeChild(c.firstChild);
    el.addEventListener('animationend', () => el.remove());
  }
  clearNumbers() { $('dmgNums').innerHTML = ''; }

  update(dt) {
    // particles
    for (let i = 0; i < this.N; i++) {
      const p = this.parts[i]; if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.y = -999; this.pos[i * 3 + 1] = -999; this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      p.vy -= 9.8 * p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.04) { p.y = 0.04; p.vy *= -0.34; p.vx *= 0.7; p.vz *= 0.7; }
      const k = p.life / p.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r * k; this.col[i * 3 + 1] = p.g * k; this.col[i * 3 + 2] = p.b * k;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    // tracers
    for (const b of this.bolts) {
      if (!b.mesh.visible) continue;
      b.traveled += b.speed * dt;
      if (b.traveled >= b.dist) { b.mesh.visible = false; if (b.onArrive) { b.onArrive(); b.onArrive = null; } }
      else {
        const tail = Math.max(0, b.traveled - b.len);
        this._p.copy(b.from).addScaledVector(b.dir, tail);
        b.mesh.position.copy(this._p); b.mesh.scale.y = Math.min(b.len, b.traveled);
      }
    }
  }
  reset() { for (const b of this.bolts) b.mesh.visible = false; for (let i = 0; i < this.N; i++) { this.parts[i].life = 0; this.pos[i * 3 + 1] = -999; } this.clearNumbers(); }
}
