// Tyre marks on the road: a burnout's ring, a handbrake turn's arc, the
// black lines a drift lays down (vehicles.js markR / markF, laid by main.js).
//
// One mesh, one draw, drawn only while any mark is alive. Each mark is a
// strip of quads in a ring buffer (the oldest is overwritten first), laid
// 2.5 cm over the surface the wheel stands on with a polygon offset, and
// faded by the SHADER from the time it was laid -- nothing is rewritten
// after a quad is placed, so a road full of marks costs no CPU, and only
// the quads written this frame are uploaded (addUpdateRange).

import * as THREE from './three.js';

const LIFE = 50;             // s a mark takes to fade away

export class SkidMarks {
  constructor(scene, phone) {
    const N = this.N = phone ? 700 : 1400;          // quads
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 4 * 3);
    this.mark = new Float32Array(N * 4 * 2);        // (time laid, strength)
    for (let i = 0; i < N * 4; i++) this.mark[i * 2] = -1e6;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aMark', new THREE.BufferAttribute(this.mark, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = new (N * 4 > 65535 ? Uint32Array : Uint16Array)(N * 6);
    for (let q = 0; q < N; q++) {
      const a = q * 4;
      idx.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], q * 6);
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.MeshBasicMaterial({
      color: 0x161514, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.uNow = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNow = this.uNow;
      sh.vertexShader = 'attribute vec2 aMark;\nuniform float uNow;\nvarying float vMarkA;\n'
        + sh.vertexShader.replace('#include <begin_vertex>',
          `#include <begin_vertex>\n  vMarkA = aMark.y * clamp(1.0 - (uNow - aMark.x) / ${LIFE.toFixed(1)}, 0.0, 1.0);`);
      if (!sh.fragmentShader.includes('#include <alphatest_fragment>')) console.warn('skidmarks: three changed meshbasic_frag, marks not faded');
      sh.fragmentShader = 'varying float vMarkA;\n'
        + sh.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a *= vMarkA;\n#include <alphatest_fragment>');
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.geo = g;
    this.head = 0;
    this.t = 0;
    this.lastAt = -1e6;
    this.streams = new Map();      // a wheel's key -> the edge its strip ended on
  }

  /**
   * Lay the stream `key` (a wheel) on to (x, y, z) with strength k (0-1) and
   * width w. k = 0 ends the stream, so the next mark starts a new strip.
   */
  add(key, x, y, z, k, w) {
    if (!(k > 0.03)) { if (this.streams.get(key)) this.streams.set(key, null); return; }
    const L = this.streams.get(key);
    if (!L) { this.streams.set(key, { x, y, z, k, l: null }); return; }
    const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
    if (d < 0.3) return;
    if (d > 4 || Math.abs(y - L.y) > 0.6) { this.streams.set(key, { x, y, z, k, l: null }); return; }
    const nx = (-dz / d) * w * 0.5, nz = (dx / d) * w * 0.5;
    // the strip's start is the edge the last quad ended on, so a curve has no
    // gaps or doubled-up joins
    const l0 = L.l || [L.x - nx, L.z - nz, L.x + nx, L.z + nz];
    const l1 = [x - nx, z - nz, x + nx, z + nz];
    const q = this.head;
    this.head = (q + 1) % this.N;
    const P = this.pos, M = this.mark, o = q * 12, m = q * 8;
    const y0 = L.y + 0.025, y1 = y + 0.025;
    P[o] = l0[0]; P[o + 1] = y0; P[o + 2] = l0[1];
    P[o + 3] = l0[2]; P[o + 4] = y0; P[o + 5] = l0[3];
    P[o + 6] = l1[0]; P[o + 7] = y1; P[o + 8] = l1[1];
    P[o + 9] = l1[2]; P[o + 10] = y1; P[o + 11] = l1[3];
    M[m] = this.t; M[m + 1] = L.k * 0.5; M[m + 2] = this.t; M[m + 3] = L.k * 0.5;
    M[m + 4] = this.t; M[m + 5] = k * 0.5; M[m + 6] = this.t; M[m + 7] = k * 0.5;
    const pa = this.geo.attributes.position, ma = this.geo.attributes.aMark;
    pa.addUpdateRange(o, 12); pa.needsUpdate = true;
    ma.addUpdateRange(m, 8); ma.needsUpdate = true;
    this.streams.set(key, { x, y, z, k, l: l1 });
    this.lastAt = this.t;
  }

  update(dt) {
    this.t += dt;
    this.uNow.value = this.t;
    this.mesh.visible = this.t - this.lastAt < LIFE;
  }
}
