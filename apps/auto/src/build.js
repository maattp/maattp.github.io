// Tiny geometry builder: everything in the city is merged into a handful of
// BufferGeometries through this.

import * as THREE from './three.js';

/**
 * Flattens a group of static meshes into one mesh per material. Landmarks are
 * built from dozens of primitives each; without this they would cost hundreds
 * of draw calls a frame.
 */
export function mergeByMaterial(root) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  const strays = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g || !g.attributes.position) return;
    if (g.attributes.position.count > 60000) { strays.push(o); return; }
    let l = byMat.get(o.material);
    if (!l) byMat.set(o.material, (l = []));
    l.push(o);
  });
  const out = new THREE.Group();
  for (const [material, meshes] of byMat) {
    const pos = [], nor = [], uv = [], idx = [];
    let base = 0;
    for (const m of meshes) {
      const g = m.geometry;
      const p = g.attributes.position;
      const n = g.attributes.normal;
      const t = g.attributes.uv;
      const mw = m.matrixWorld;
      const nm = new THREE.Matrix3().getNormalMatrix(mw);
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(mw);
        pos.push(v.x, v.y, v.z);
        if (n) {
          v.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(nm).normalize();
          nor.push(v.x, v.y, v.z);
        } else nor.push(0, 1, 0);
        uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
      }
      if (g.index) {
        const ix = g.index;
        for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
      } else {
        for (let i = 0; i < p.count; i++) idx.push(base + i);
      }
      base += p.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    out.add(new THREE.Mesh(geo, material));
  }
  for (const s of strays) out.add(s);
  return out;
}

export class Builder {
  constructor(useUV = true) {
    this.useUV = useUV;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  get empty() {
    return this.idx.length === 0;
  }

  vert(x, y, z, nx, ny, nz, u, v, r, g, b) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    if (this.useUV) this.uv.push(u, v);
    this.col.push(r, g, b);
    return this.pos.length / 3 - 1;
  }

  /**
   * Quad from four coplanar corners. Winding is corrected automatically against
   * the supplied normal, so callers never have to think about which way round a
   * face goes -- getting that wrong silently backface-culls the whole surface.
   */
  quad(a, b, c, d, n, uvs, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
      const t = b; b = d; d = t;
      uvs = [uvs[0], uvs[1], uvs[6], uvs[7], uvs[4], uvs[5], uvs[2], uvs[3]];
    }
    const i0 = this.vert(a[0], a[1], a[2], n[0], n[1], n[2], uvs[0], uvs[1], col[0], col[1], col[2]);
    const i1 = this.vert(b[0], b[1], b[2], n[0], n[1], n[2], uvs[2], uvs[3], col[0], col[1], col[2]);
    const i2 = this.vert(c[0], c[1], c[2], n[0], n[1], n[2], uvs[4], uvs[5], col[0], col[1], col[2]);
    const i3 = this.vert(d[0], d[1], d[2], n[0], n[1], n[2], uvs[6], uvs[7], col[0], col[1], col[2]);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  tri(a, b, c, n, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * n[0] + ny * n[1] + nz * n[2] < 0) { const t = b; b = c; c = t; }
    const i0 = this.vert(a[0], a[1], a[2], n[0], n[1], n[2], 0, 0, col[0], col[1], col[2]);
    const i1 = this.vert(b[0], b[1], b[2], n[0], n[1], n[2], 1, 0, col[0], col[1], col[2]);
    const i2 = this.vert(c[0], c[1], c[2], n[0], n[1], n[2], 0.5, 1, col[0], col[1], col[2]);
    this.idx.push(i0, i1, i2);
  }

  /**
   * Axis box rotated about Y. (cx,cz) is the centre, `by` the base height.
   * uScale/vScale give metres per texture tile; pass 0 for a 0..1 mapping.
   */
  box(cx, by, cz, w, h, d, rot, col, opts = {}) {
    const { uScale = 0, vScale = 0, top = true, vOff = 0, sides = true } = opts;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const hw = w / 2, hd = d / 2;
    const P = (lx, ly, lz) => [cx + lx * cr - lz * sr, by + ly, cz + lx * sr + lz * cr];
    const N = (lx, lz) => [lx * cr - lz * sr, 0, lx * sr + lz * cr];
    const ru = uScale > 0 ? w / uScale : 1;
    const rd = uScale > 0 ? d / uScale : 1;
    const rv = vScale > 0 ? h / vScale : 1;
    const v0 = vOff;
    if (sides) {
      // +local z
      this.quad(P(-hw, 0, hd), P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd), N(0, 1),
        [0, v0, ru, v0, ru, v0 + rv, 0, v0 + rv], col);
      // -local z
      this.quad(P(hw, 0, -hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd), N(0, -1),
        [0, v0, ru, v0, ru, v0 + rv, 0, v0 + rv], col);
      // +local x
      this.quad(P(hw, 0, hd), P(hw, 0, -hd), P(hw, h, -hd), P(hw, h, hd), N(1, 0),
        [0, v0, rd, v0, rd, v0 + rv, 0, v0 + rv], col);
      // -local x
      this.quad(P(-hw, 0, -hd), P(-hw, 0, hd), P(-hw, h, hd), P(-hw, h, -hd), N(-1, 0),
        [0, v0, rd, v0, rd, v0 + rv, 0, v0 + rv], col);
    }
    if (top) {
      this.quad(P(-hw, h, hd), P(hw, h, hd), P(hw, h, -hd), P(-hw, h, -hd), [0, 1, 0],
        [0, 0, ru, 0, ru, rd, 0, rd], col);
    }
  }

  /** Flat horizontal quad from four (x,z) pairs at given heights. */
  flat(pts, ys, col, uvs) {
    this.quad(
      [pts[0], ys[0], pts[1]],
      [pts[2], ys[1], pts[3]],
      [pts[4], ys[2], pts[5]],
      [pts[6], ys[3], pts[7]],
      [0, 1, 0], uvs, col
    );
  }

  /** Regular n-gon prism (poles, trunks, columns). */
  prism(cx, by, cz, r, h, sides, col, rot = 0) {
    const n = sides;
    for (let i = 0; i < n; i++) {
      const a0 = rot + (i / n) * Math.PI * 2;
      const a1 = rot + ((i + 1) / n) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      const mx = Math.cos((a0 + a1) / 2), mz = Math.sin((a0 + a1) / 2);
      this.quad([x0, by, z0], [x1, by, z1], [x1, by + h, z1], [x0, by + h, z0], [mx, 0, mz],
        [0, 0, 1, 0, 1, 1, 0, 1], col);
    }
  }

  cone(cx, by, cz, r, h, sides, col) {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      const mx = Math.cos((a0 + a1) / 2), mz = Math.sin((a0 + a1) / 2);
      this.tri([x0, by, z0], [x1, by, z1], [cx, by + h, cz], [mx, 0.45, mz], col);
    }
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.useUV) geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}
