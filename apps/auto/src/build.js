// Tiny geometry builder: everything in the city is merged into a handful of
// BufferGeometries through this.

import * as THREE from './three.js';
import { hash2 } from './util.js';

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

/**
 * Stop three recomputing a static subtree's matrices every frame. With
 * matrixAutoUpdate on (the default) every Object3D composes its matrix and
 * re-multiplies its world matrix each frame whether it moved or not: the city,
 * terrain and landmarks were ~20 % of the renderer's CPU. The subtree's world
 * matrices are computed once, here; call again after moving anything in it.
 */
export function freezeStatic(root) {
  root.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  root.updateMatrixWorld(true);
  root.matrixWorldAutoUpdate = false;
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
    // `col` is one rgb triple, or four of them (per corner) for baked AO.
    // `n` is one normal, or four of them (per corner) for smooth shading.
    // No per-call arrays: this is the hottest function in a chunk build.
    const pc = Array.isArray(col[0]), pn = Array.isArray(n[0]);
    const c0 = pc ? col[0] : col, c1 = pc ? col[1] : col, c2 = pc ? col[2] : col, c3 = pc ? col[3] : col;
    const n0 = pn ? n[0] : n, n1 = pn ? n[1] : n, n2 = pn ? n[2] : n, n3 = pn ? n[3] : n;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    // average the corner normals: with per-corner normals from loft(), a single
    // unrepresentative corner could flip the whole quad at a high-curvature spot
    const ax = (n0[0] + n1[0] + n2[0] + n3[0]) / 4;
    const ay = (n0[1] + n1[1] + n2[1] + n3[1]) / 4;
    const az = (n0[2] + n1[2] + n2[2] + n3[2]) / 4;
    const i0 = this.vert(a[0], a[1], a[2], n0[0], n0[1], n0[2], uvs[0], uvs[1], c0[0], c0[1], c0[2]);
    let i1, i3;
    if (cx * ax + cy * ay + cz * az < 0) {
      // wound the other way: a, d, c, b, each corner keeping its own attributes
      i1 = this.vert(d[0], d[1], d[2], n3[0], n3[1], n3[2], uvs[6], uvs[7], c3[0], c3[1], c3[2]);
      i3 = -1;
    } else {
      i1 = this.vert(b[0], b[1], b[2], n1[0], n1[1], n1[2], uvs[2], uvs[3], c1[0], c1[1], c1[2]);
    }
    const i2 = this.vert(c[0], c[1], c[2], n2[0], n2[1], n2[2], uvs[4], uvs[5], c2[0], c2[1], c2[2]);
    if (i3 === -1) i3 = this.vert(b[0], b[1], b[2], n1[0], n1[1], n1[2], uvs[2], uvs[3], c1[0], c1[1], c1[2]);
    else i3 = this.vert(d[0], d[1], d[2], n3[0], n3[1], n3[2], uvs[6], uvs[7], c3[0], c3[1], c3[2]);
    this.face6(i0, i1, i2, i3);
  }

  face6(i0, i1, i2, i3) { this.idx.push(i0, i1, i2, i0, i2, i3); }
  face3(i0, i1, i2) { this.idx.push(i0, i1, i2); }

  /**
   * Loft a smooth shell through a list of cross-sections. `rings` is
   * [{ z, pts: [[x,y], ...] }] with the same point count in every ring; normals
   * are computed from the surface itself so the result shades smoothly instead
   * of faceting, which is the whole difference between a car and a box.
   */
  loft(rings, col, opts = {}) {
    // `skip(i, k)` leaves out the quad between rings i..i+1 on segment k..k+1
    // -- an opening the caller fills (or glazes) itself.
    const { capStart = false, capEnd = false, colTop = null, topFrom = 1e9, skip = null } = opts;
    const R = rings.length, K = rings[0].pts.length;
    const P = [];
    for (let i = 0; i < R; i++) {
      P.push(rings[i].pts.map((p) => [p[0], p[1], rings[i].z]));
    }
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (v) => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    // centroid per ring, used to force normals outward
    const cen = P.map((ring) => {
      let x = 0, y = 0;
      for (const p of ring) { x += p[0]; y += p[1]; }
      return [x / K, y / K];
    });
    const N = [];
    for (let i = 0; i < R; i++) {
      N.push([]);
      for (let k = 0; k < K; k++) {
        const ip = P[Math.max(0, i - 1)][k], inx = P[Math.min(R - 1, i + 1)][k];
        const kp = P[i][(k - 1 + K) % K], kn = P[i][(k + 1) % K];
        let n = norm(cross(sub(kn, kp), sub(inx, ip)));
        const ox = P[i][k][0] - cen[i][0], oy = P[i][k][1] - cen[i][1];
        if (n[0] * ox + n[1] * oy < 0) n = [-n[0], -n[1], -n[2]];
        N[i].push(n);
      }
    }
    for (let i = 0; i < R - 1; i++) {
      for (let k = 0; k < K; k++) {
        if (skip && skip(i, k)) continue;
        const k2 = (k + 1) % K;
        const c0 = colTop && P[i][k][1] > topFrom ? colTop : col;
        this.quad(P[i][k], P[i][k2], P[i + 1][k2], P[i + 1][k],
          [N[i][k], N[i][k2], N[i + 1][k2], N[i + 1][k]],
          [0, 0, 1, 0, 1, 1, 0, 1], c0);
      }
    }
    const cap = (i, dir) => {
      const c = [cen[i][0], cen[i][1], rings[i].z];
      for (let k = 0; k < K; k++) {
        const k2 = (k + 1) % K;
        this.tri(c, P[i][k], P[i][k2], [0, 0, dir], col);
      }
    };
    if (capStart) cap(0, -1);
    if (capEnd) cap(R - 1, 1);
  }

  /**
   * Quad mesh through a grid of points -- the workhorse for an authored panel
   * (a windscreen, a bonnet, a wheel-arch liner). `rows[i][j]` is [x,y,z], and
   * every row must have the same length.
   *
   * Normals come from the grid itself, so two patches that share an edge shade
   * continuously instead of showing a crease where the panels meet. `loft` can
   * only sweep a CLOSED section along an axis; a car panel is an open sheet
   * with its own outline, which is the difference between modelling a car and
   * scaling a tube.
   *
   * `flip` reverses the outward direction when the grid is wound the other way.
   * Pass a direction vector instead of a boolean to say which way OUT is and
   * let it work the winding out -- mirroring a panel to the other side of a car
   * silently reverses it, and a panel whose normals point inward is
   * backface-culled to nothing, which looks like the panel was never built.
   */
  patch(rows, col, flip = false) {
    const R = rows.length, C = rows[0].length;
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (v) => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const N = [];
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < R; i++) {
      N.push([]);
      for (let j = 0; j < C; j++) {
        const dr = sub(rows[Math.min(R - 1, i + 1)][j], rows[Math.max(0, i - 1)][j]);
        const dc = sub(rows[i][Math.min(C - 1, j + 1)], rows[i][Math.max(0, j - 1)]);
        const n = norm([dr[1] * dc[2] - dr[2] * dc[1], dr[2] * dc[0] - dr[0] * dc[2], dr[0] * dc[1] - dr[1] * dc[0]]);
        N[i].push(n);
        mx += n[0]; my += n[1]; mz += n[2];
      }
    }
    const s = Array.isArray(flip)
      ? (mx * flip[0] + my * flip[1] + mz * flip[2] < 0 ? -1 : 1)
      : (flip ? -1 : 1);
    if (s < 0) for (const r of N) for (const n of r) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < C - 1; j++) {
        this.quad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j],
          [N[i][j], N[i][j + 1], N[i + 1][j + 1], N[i + 1][j]],
          [j / (C - 1), i / (R - 1), (j + 1) / (C - 1), i / (R - 1),
            (j + 1) / (C - 1), (i + 1) / (R - 1), j / (C - 1), (i + 1) / (R - 1)], col);
      }
    }
  }

  /**
   * Round tube between two arbitrary points -- mirror stalks, wing stanchions,
   * roll hoops. `prism` and `box` can only yaw, so anything that runs diagonally
   * in Y has to be built here or it comes out as a level bar hanging in the air,
   * which is exactly what the viaduct barriers did.
   */
  tube(a, b, r, sides, col, capEnds = false) {
    const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
    const len = Math.hypot(ax, ay, az) || 1;
    const d = [ax / len, ay / len, az / len];
    // any vector not parallel to the axis gives a usable frame
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const norm = (v) => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const u = norm([up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]]);
    const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const ring = (p, rr) => {
      const out = [];
      for (let i = 0; i < sides; i++) {
        const t = (i / sides) * Math.PI * 2;
        const c = Math.cos(t) * rr, s = Math.sin(t) * rr;
        out.push([p[0] + u[0] * c + v[0] * s, p[1] + u[1] * c + v[1] * s, p[2] + u[2] * c + v[2] * s]);
      }
      return out;
    };
    const A = ring(a, r), B = ring(b, r);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const na = norm([A[i][0] - a[0], A[i][1] - a[1], A[i][2] - a[2]]);
      const nb = norm([A[j][0] - a[0], A[j][1] - a[1], A[j][2] - a[2]]);
      this.quad(A[i], A[j], B[j], B[i], [na, nb, nb, na], [0, 0, 1, 0, 1, 1, 0, 1], col);
    }
    if (capEnds) {
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        this.tri(a, A[j], A[i], [-d[0], -d[1], -d[2]], col);
        this.tri(b, B[i], B[j], d, col);
      }
    }
  }

  tri(a, b, c, n, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * n[0] + ny * n[1] + nz * n[2] < 0) { const t = b; b = c; c = t; }
    const i0 = this.vert(a[0], a[1], a[2], n[0], n[1], n[2], 0, 0, col[0], col[1], col[2]);
    const i1 = this.vert(b[0], b[1], b[2], n[0], n[1], n[2], 1, 0, col[0], col[1], col[2]);
    const i2 = this.vert(c[0], c[1], c[2], n[0], n[1], n[2], 0.5, 1, col[0], col[1], col[2]);
    this.face3(i0, i1, i2);
  }

  /**
   * Axis box rotated about Y. (cx,cz) is the centre, `by` the base height.
   * uScale/vScale give metres per texture tile; pass 0 for a 0..1 mapping.
   *
   * `opts.cell` is `[u0, du]`, a horizontal sub-rect of the facade atlas. It is
   * how five wall materials became one: see `stripAtlas` in textures.js for why
   * only U needs confining, and `faceU` below for what it costs.
   */
  box(cx, by, cz, w, h, d, rot, col, opts = {}) {
    const { uScale = 0, vScale = 0, top = true, vOff = 0, sides = true, ao = 0, cell = null,
      uFit = false } = opts;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const hw = w / 2, hd = d / 2;
    const P = (lx, ly, lz) => [cx + lx * cr - lz * sr, by + ly, cz + lx * sr + lz * cr];
    const N = (lx, lz) => [lx * cr - lz * sr, 0, lx * sr + lz * cr];
    // `uFit`: each face takes a WHOLE number of repeats, the nearest to
    // uScale metres each (at least one). For a tile that is one composed
    // elevation -- a house front with its door -- rather than a pattern that
    // may be cut anywhere.
    const ru = uScale > 0 ? (uFit ? Math.max(1, Math.round(w / uScale)) : w / uScale) : 1;
    const rd = uScale > 0 ? (uFit ? Math.max(1, Math.round(d / uScale)) : d / uScale) : 1;
    const rv = vScale > 0 ? h / vScale : 1;
    const v0 = vOff;
    // Cheap baked ambient occlusion: darken the bottom edge of the side faces so
    // the mass reads as sitting on the ground rather than floating over it.
    const lo = ao > 0 ? [col[0] * (1 - ao), col[1] * (1 - ao), col[2] * (1 - ao)] : col;
    const sideCols = ao > 0 ? [lo, lo, col, col] : col;
    /**
     * One rectangular face, `un` texture repeats wide and running v0..v1 up.
     *
     * With no atlas cell this is the single quad it always was. With one, the
     * face is cut into one quad per horizontal repeat, because GL repeat wraps
     * the whole texture and not a sub-rect -- so the UVs have to be inside the
     * cell before the sampler ever sees them. V is left alone: the atlas is one
     * tile tall, so vertical repeats still wrap for free and a 100 m tower
     * costs nothing extra. Corner order is bottom-left, bottom-right,
     * top-right, top-left, so the baked-AO colours stay on the bottom edge
     * through the cut.
     */
    const faceU = (a, b, c, e, n, un, vA, vB, cols) => {
      if (!cell) {
        this.quad(a, b, c, e, n, [0, vA, un, vA, un, vB, 0, vB], cols);
        return;
      }
      const [cu0, cdu] = cell;
      const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
      const steps = Math.max(1, Math.ceil(un - 1e-4));
      for (let i = 0; i < steps; i++) {
        const t0 = i / un, t1 = Math.min(1, (i + 1) / un);
        const u1 = cu0 + Math.min(1, un - i) * cdu;
        this.quad(mix(a, b, t0), mix(a, b, t1), mix(e, c, t1), mix(e, c, t0), n,
          [cu0, vA, u1, vA, u1, vB, cu0, vB], cols);
      }
    };
    if (sides) {
      // +local z
      faceU(P(-hw, 0, hd), P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd), N(0, 1),
        ru, v0, v0 + rv, sideCols);
      // -local z
      faceU(P(hw, 0, -hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd), N(0, -1),
        ru, v0, v0 + rv, sideCols);
      // +local x
      faceU(P(hw, 0, hd), P(hw, 0, -hd), P(hw, h, -hd), P(hw, h, hd), N(1, 0),
        rd, v0, v0 + rv, sideCols);
      // -local x
      faceU(P(-hw, 0, -hd), P(-hw, 0, hd), P(-hw, h, hd), P(-hw, h, -hd), N(-1, 0),
        rd, v0, v0 + rv, sideCols);
    }
    if (top) {
      faceU(P(-hw, h, hd), P(hw, h, hd), P(hw, h, -hd), P(-hw, h, -hd), [0, 1, 0],
        ru, 0, rd, col);
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

  /**
   * Low-poly spheroid, for anything that has to read as ROUND rather than as a
   * drum. `prism` is open at both ends, so a squashed one seen from eye level
   * shows a single band of vertical wall and nothing else -- which is why a
   * broadleaf canopy built from squashed prisms rendered as a flat green slab
   * on a stick. A closed, tapered lathe costs about the same triangles and has
   * an actual silhouette.
   *
   * `squash` scales Y against the horizontal radius: below 1 is a flattened
   * canopy, above 1 an upright one.
   */
  spheroid(cx, cy, cz, r, sides, stacks, col, squash = 1, jitter = 0) {
    const ry = r * squash;
    const ptAt = (si, i) => {
      // Latitude from the south pole to the north; radius follows the sine so
      // the profile closes at both ends instead of ending in a flat disc.
      const t = si / stacks;
      const lat = (t - 0.5) * Math.PI;
      // A little per-vertex wobble breaks the lathe's obvious symmetry without
      // needing more segments.
      const wob = jitter ? 1 + (hash2(si * 31 + i * 7, 3) - 0.5) * jitter : 1;
      const rr = Math.cos(lat) * r * wob;
      const ang = (i / sides) * Math.PI * 2;
      return [cx + Math.cos(ang) * rr, cy + Math.sin(lat) * ry * wob, cz + Math.sin(ang) * rr];
    };
    for (let si = 0; si < stacks; si++) {
      for (let i = 0; i < sides; i++) {
        const a = ptAt(si, i), b = ptAt(si, i + 1);
        const c = ptAt(si + 1, i + 1), d = ptAt(si + 1, i);
        // Normals point out from the centre, which is what makes a faceted
        // lathe still shade like a ball.
        const nrm = (p) => {
          const vx = p[0] - cx, vy = p[1] - cy, vz = p[2] - cz;
          const l = Math.hypot(vx, vy, vz) || 1;
          return [vx / l, vy / l, vz / l];
        };
        const n = nrm([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2]);
        if (si === 0) this.tri(b, a, d, n, col);
        else if (si === stacks - 1) this.tri(a, b, c, n, col);
        else this.quad(a, b, c, d, n, [0, 0, 1, 0, 1, 1, 0, 1], col);
      }
    }
  }

  /**
   * Loft swept along Y instead of Z, for anything that stands up: torsos,
   * limbs, necks. `rings` is [{ y, pts: [[x,z], ...] }].
   */
  loftY(rings, col, opts = {}) {
    const { capStart = false, capEnd = false } = opts;
    const R = rings.length, K = rings[0].pts.length;
    const P = rings.map((r) => r.pts.map((p) => [p[0], r.y, p[1]]));
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (v) => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const cen = P.map((r) => {
      let x = 0, z = 0;
      for (const p of r) { x += p[0]; z += p[2]; }
      return [x / K, z / K];
    });
    const N = [];
    for (let i = 0; i < R; i++) {
      N.push([]);
      for (let k = 0; k < K; k++) {
        const ip = P[Math.max(0, i - 1)][k], inx = P[Math.min(R - 1, i + 1)][k];
        const kp = P[i][(k - 1 + K) % K], kn = P[i][(k + 1) % K];
        let n = norm(cross(sub(kn, kp), sub(inx, ip)));
        const ox = P[i][k][0] - cen[i][0], oz = P[i][k][2] - cen[i][1];
        if (n[0] * ox + n[2] * oz < 0) n = [-n[0], -n[1], -n[2]];
        N[i].push(n);
      }
    }
    const colOf = (i) => (Array.isArray(col) && Array.isArray(col[0]) ? col[Math.min(col.length - 1, i)] : col);
    for (let i = 0; i < R - 1; i++) {
      for (let k = 0; k < K; k++) {
        const k2 = (k + 1) % K;
        this.quad(P[i][k], P[i][k2], P[i + 1][k2], P[i + 1][k],
          [N[i][k], N[i][k2], N[i + 1][k2], N[i + 1][k]],
          [0, 0, 1, 0, 1, 1, 0, 1], colOf(i));
      }
    }
    const cap = (i, dir) => {
      const c = [cen[i][0], rings[i].y, cen[i][1]];
      for (let k = 0; k < K; k++) {
        this.tri(c, P[i][k], P[i][(k + 1) % K], [0, dir, 0], colOf(i));
      }
    };
    if (capStart) cap(0, -1);
    if (capEnd) cap(R - 1, 1);
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

/**
 * Builder over growable typed arrays, for the streamed city chunks.
 *
 * A chunk is tens of thousands of vertices, and pushing them one number at a
 * time onto plain arrays -- then converting those to Float32Arrays in build()
 * -- was over a quarter of a chunk build's CPU. Same geometry to the bit (the
 * plain path lands in float32 as well). Only for code that goes through the
 * methods: vehicles and characters read and splice `pos`/`idx` directly, so
 * they keep the plain Builder.
 */
export class ChunkBuilder extends Builder {
  constructor(useUV = true) {
    super(useUV);
    this.cap = 1024;
    this.nv = 0;
    this.ni = 0;
    this.P = new Float32Array(this.cap * 3);
    this.N = new Float32Array(this.cap * 3);
    this.U = useUV ? new Float32Array(this.cap * 2) : null;
    this.C = new Float32Array(this.cap * 3);
    this.I = new Uint32Array(this.cap * 2);
    // bbox kept as vertices are written, so build() needs no pass over them
    this.x0 = this.y0 = this.z0 = Infinity;
    this.x1 = this.y1 = this.z1 = -Infinity;
    this.F = null; this.Fn = null; this._flag = null;
  }

  get empty() {
    return this.ni === 0;
  }

  _grow() {
    const cap = this.cap * 2;
    const g = (a, k) => { const b = new Float32Array(cap * k); b.set(a); return b; };
    this.P = g(this.P, 3); this.N = g(this.N, 3); this.C = g(this.C, 3);
    if (this.U) this.U = g(this.U, 2);
    if (this.F) for (const k in this.F) this.F[k] = g(this.F[k], 1);
    this.cap = cap;
  }

  _growI() {
    const b = new Uint32Array(this.I.length * 2); b.set(this.I); this.I = b;
  }

  vert(x, y, z, nx, ny, nz, u, v, r, g, b) {
    const i = this.nv;
    if (i === this.cap) this._grow();
    const k = i * 3;
    const P = this.P, N = this.N, C = this.C;
    P[k] = x; P[k + 1] = y; P[k + 2] = z;
    if (x < this.x0) this.x0 = x; if (x > this.x1) this.x1 = x;
    if (y < this.y0) this.y0 = y; if (y > this.y1) this.y1 = y;
    if (z < this.z0) this.z0 = z; if (z > this.z1) this.z1 = z;
    N[k] = nx; N[k + 1] = ny; N[k + 2] = nz;
    C[k] = r; C[k + 1] = g; C[k + 2] = b;
    if (this.U) { this.U[i * 2] = u; this.U[i * 2 + 1] = v; }
    if (this._flag) { this.F[this._flag][i] = 1; this.Fn[this._flag]++; }
    this.nv = i + 1;
    return i;
  }

  face6(i0, i1, i2, i3) {
    if (this.ni + 6 > this.I.length) this._growI();
    const I = this.I, k = this.ni;
    I[k] = i0; I[k + 1] = i1; I[k + 2] = i2; I[k + 3] = i0; I[k + 4] = i2; I[k + 5] = i3;
    this.ni = k + 6;
  }

  face3(i0, i1, i2) {
    if (this.ni + 3 > this.I.length) this._growI();
    const I = this.I, k = this.ni;
    I[k] = i0; I[k + 1] = i1; I[k + 2] = i2;
    this.ni = k + 3;
  }

  /**
   * Append another ChunkBuilder's triangles, vertex colours multiplied by
   * `tint` (linear rgb), dropping its UVs: for drawing a textured surface in
   * an untextured material at a range where the texture is one colour anyway.
   */
  /**
   * Append another ChunkBuilder's triangles as-is (UVs included), with the
   * per-vertex attribute `name` = 1 on them (0 on this builder's own), so one
   * material can tell the two apart: a near chunk's pavement rides in its road
   * mesh (world.js `roadWalk`), a chunk's unlit glow in its flat mesh
   * (`flatGlow`). One draw each instead of two.
   */
  appendFlagged(src, name) {
    const base = this.nv;
    if (!this.F) this.F = {};
    if (!this.F[name]) this.F[name] = new Float32Array(this.cap);
    for (let i = 0; i < src.nv; i++) {
      const k = i * 3, u = src.U ? src.U[i * 2] : 0, v = src.U ? src.U[i * 2 + 1] : 0;
      const n = this.vert(src.P[k], src.P[k + 1], src.P[k + 2], src.N[k], src.N[k + 1], src.N[k + 2], u, v,
        src.C[k], src.C[k + 1], src.C[k + 2]);
      this.F[name][n] = 1;
      this.Fn = this.Fn || {}; this.Fn[name] = (this.Fn[name] || 0) + 1;
    }
    for (let i = 0; i < src.ni; i += 3) this.face3(src.I[i] + base, src.I[i + 1] + base, src.I[i + 2] + base);
  }

  /**
   * A writer that draws into THIS builder with the per-vertex attribute `name`
   * set to 1 -- the same result as building separately and appendFlagged, with
   * no copy (the copy was a 1 ms unsliced step on a big near chunk, 12+ ms on
   * a phone). Only the methods chunk meshing calls on pavement and glow.
   */
  flagged(name) {
    const b = this;
    if (!this.F) this.F = {};
    if (!this.F[name]) this.F[name] = new Float32Array(this.cap);
    if (!this.Fn) this.Fn = {};
    this.Fn[name] = this.Fn[name] || 0;
    const on = () => { b._flag = name; }, off = () => { b._flag = null; };
    return {
      quad(a1, a2, a3, a4, n, uvs, col) { on(); b.quad(a1, a2, a3, a4, n, uvs, col); off(); },
      tri(a1, a2, a3, n, col) { on(); b.tri(a1, a2, a3, n, col); off(); },
      box(cx, by, cz, w, h, d, rot, col, opts) { on(); b.box(cx, by, cz, w, h, d, rot, col, opts); off(); },
      flat(pts, ys, col, uvs) { on(); b.flat(pts, ys, col, uvs); off(); },
      get empty() { return !b.Fn[name]; },
    };
  }

  appendTinted(src, tint) {
    const base = this.nv;
    for (let i = 0; i < src.nv; i++) {
      const k = i * 3;
      this.vert(src.P[k], src.P[k + 1], src.P[k + 2], src.N[k], src.N[k + 1], src.N[k + 2], 0, 0,
        src.C[k] * tint[0], src.C[k + 1] * tint[1], src.C[k + 2] * tint[2]);
    }
    for (let i = 0; i < src.ni; i += 3) this.face3(src.I[i] + base, src.I[i + 1] + base, src.I[i + 2] + base);
  }

  /**
   * `views`: hand the geometry views of this builder's own buffers instead of
   * exact-size copies. For a caller that drops the arrays once they are on the
   * GPU (world.js on a phone): the copies were most of a big mesh's unsliced
   * finish, and the spare capacity a view keeps only lives until the upload.
   */
  build(views = false) {
    const n = this.nv, geo = new THREE.BufferGeometry();
    const cut = (a, k) => (views ? a.subarray(0, n * k) : a.slice(0, n * k));
    geo.setAttribute('position', new THREE.BufferAttribute(cut(this.P, 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(cut(this.N, 3), 3));
    if (this.U) geo.setAttribute('uv', new THREE.BufferAttribute(cut(this.U, 2), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(cut(this.C, 3), 3));
    if (this.F) for (const k in this.F) if (this.Fn && this.Fn[k]) geo.setAttribute(k, new THREE.BufferAttribute(cut(this.F[k], 1), 1));
    // setIndex(array) picks 16-bit indices under 65536 vertices; so does this.
    // (the typed-array constructor converts natively; Uint16Array.from walks
    // an iterator, and was a 3 ms unsliced step on a big chunk)
    const idx = n > 65535 ? (views ? this.I.subarray(0, this.ni) : this.I.slice(0, this.ni)) : new Uint16Array(this.I.subarray(0, this.ni));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // The sphere round the bbox, not three's two passes over every vertex:
    // those were most of a big builder's unsliced ~1 ms (8 ms on a phone). A
    // chunk's contents fill its box, so culling loses next to nothing.
    const cx = (this.x0 + this.x1) / 2, cy = (this.y0 + this.y1) / 2, cz = (this.z0 + this.z1) / 2;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz),
      Math.hypot(this.x1 - cx, this.y1 - cy, this.z1 - cz));
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(this.x0, this.y0, this.z0), new THREE.Vector3(this.x1, this.y1, this.z1));
    return geo;
  }
}
