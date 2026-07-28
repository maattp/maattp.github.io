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
    let cols = Array.isArray(col[0]) ? col : [col, col, col, col];
    let nrm = Array.isArray(n[0]) ? n : [n, n, n, n];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    // average the corner normals: with per-corner normals from loft(), a single
    // unrepresentative corner could flip the whole quad at a high-curvature spot
    const ax = (nrm[0][0] + nrm[1][0] + nrm[2][0] + nrm[3][0]) / 4;
    const ay = (nrm[0][1] + nrm[1][1] + nrm[2][1] + nrm[3][1]) / 4;
    const az = (nrm[0][2] + nrm[1][2] + nrm[2][2] + nrm[3][2]) / 4;
    if (cx * ax + cy * ay + cz * az < 0) {
      const t = b; b = d; d = t;
      uvs = [uvs[0], uvs[1], uvs[6], uvs[7], uvs[4], uvs[5], uvs[2], uvs[3]];
      cols = [cols[0], cols[3], cols[2], cols[1]];
      nrm = [nrm[0], nrm[3], nrm[2], nrm[1]];
    }
    const i0 = this.vert(a[0], a[1], a[2], nrm[0][0], nrm[0][1], nrm[0][2], uvs[0], uvs[1], cols[0][0], cols[0][1], cols[0][2]);
    const i1 = this.vert(b[0], b[1], b[2], nrm[1][0], nrm[1][1], nrm[1][2], uvs[2], uvs[3], cols[1][0], cols[1][1], cols[1][2]);
    const i2 = this.vert(c[0], c[1], c[2], nrm[2][0], nrm[2][1], nrm[2][2], uvs[4], uvs[5], cols[2][0], cols[2][1], cols[2][2]);
    const i3 = this.vert(d[0], d[1], d[2], nrm[3][0], nrm[3][1], nrm[3][2], uvs[6], uvs[7], cols[3][0], cols[3][1], cols[3][2]);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /**
   * Loft a smooth shell through a list of cross-sections. `rings` is
   * [{ z, pts: [[x,y], ...] }] with the same point count in every ring; normals
   * are computed from the surface itself so the result shades smoothly instead
   * of faceting, which is the whole difference between a car and a box.
   */
  loft(rings, col, opts = {}) {
    const { capStart = false, capEnd = false, colTop = null, topFrom = 1e9 } = opts;
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
    this.idx.push(i0, i1, i2);
  }

  /**
   * Axis box rotated about Y. (cx,cz) is the centre, `by` the base height.
   * uScale/vScale give metres per texture tile; pass 0 for a 0..1 mapping.
   */
  box(cx, by, cz, w, h, d, rot, col, opts = {}) {
    const { uScale = 0, vScale = 0, top = true, vOff = 0, sides = true, ao = 0 } = opts;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const hw = w / 2, hd = d / 2;
    const P = (lx, ly, lz) => [cx + lx * cr - lz * sr, by + ly, cz + lx * sr + lz * cr];
    const N = (lx, lz) => [lx * cr - lz * sr, 0, lx * sr + lz * cr];
    const ru = uScale > 0 ? w / uScale : 1;
    const rd = uScale > 0 ? d / uScale : 1;
    const rv = vScale > 0 ? h / vScale : 1;
    const v0 = vOff;
    // Cheap baked ambient occlusion: darken the bottom edge of the side faces so
    // the mass reads as sitting on the ground rather than floating over it.
    const lo = ao > 0 ? [col[0] * (1 - ao), col[1] * (1 - ao), col[2] * (1 - ao)] : col;
    const sideCols = ao > 0 ? [lo, lo, col, col] : col;
    if (sides) {
      // +local z
      this.quad(P(-hw, 0, hd), P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd), N(0, 1),
        [0, v0, ru, v0, ru, v0 + rv, 0, v0 + rv], sideCols);
      // -local z
      this.quad(P(hw, 0, -hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd), N(0, -1),
        [0, v0, ru, v0, ru, v0 + rv, 0, v0 + rv], sideCols);
      // +local x
      this.quad(P(hw, 0, hd), P(hw, 0, -hd), P(hw, h, -hd), P(hw, h, hd), N(1, 0),
        [0, v0, rd, v0, rd, v0 + rv, 0, v0 + rv], sideCols);
      // -local x
      this.quad(P(-hw, 0, -hd), P(-hw, 0, hd), P(-hw, h, hd), P(-hw, h, -hd), N(-1, 0),
        [0, v0, rd, v0, rd, v0 + rv, 0, v0 + rv], sideCols);
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
