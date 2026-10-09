// The downtown landmarks that used to be placeholders, rebuilt from the OSM
// plans (WO-10): the Convention Center's Arch, the Central Library, the
// Aquarium and its Ocean Pavilion, Colman Dock's terminal, Kerry Park.
//
// They live apart from landmarks.js because they share a kit the others do not
// need -- plan polygons extruded with the ground-following skirt a hillside
// building wants, lofted rings for the Library's leaning platforms -- and
// because landmarks.js is already 3,400 lines. landmarks.js hands over its
// palette (`P`, `mat`), its sign atlas and its solids through `h`, so every
// piece still falls into the same merged cluster meshes as the rest.
//
// | landmark | what | value | source |
// |---|---|---|---|
// | Convention Center Arch | plan | the OSM "Seattle Convention Center Arch" way, 66 points, 244 x 128 m in its own frame | OSM |
// | | it straddles I-5 | the freeway runs in a tunnel / lid under it (OSM layer -1/-2), so the building stands on the ground | OSM roads |
// | | height | 6 levels (OSM building:levels); podium to +4 m of the freeway lid, glazed block to +18 m (est.) | OSM |
// | Central Library | height | 185 ft = 56 m, 11 floors | Wikipedia "Seattle Central Library" |
// | | plan | the OSM way, 72 x 75 m in the block's frame | OSM |
// | | form | five platforms of different plan, offset and cantilevered, wrapped in a diamond steel grid with glass between | OMA / LMN; Wikipedia |
// | | grid | est. 5.5 m wide x 8.4 m tall diamonds (two floors of 4.2 m) | photographs |
// | Seattle Aquarium | plan | the OSM way on Pier 59, ~50 x 60 m | OSM |
// | Ocean Pavilion | plan | the OSM way, 52 x 66 m, tilted | OSM |
// | | | opened 2025, 2 storeys over the water, curved glass | seattleaquarium.org |
// | Colman Dock | terminal | the OSM way, 17 x 90 m, 18 deg east of south | OSM |
// | | | three storeys, glass, a canopy toward the slips, the overhead walkway to the ferries | WSDOT "Colman Dock project" |
// | Kerry Park | plan | the OSM park polygon, 92 x 36 m; the viewing terrace is its north 23 m | OSM |
// | | wall | parapet 1.0 m: the skyline stays in view from eye height | est. |
// | Changing Form | | Doris Totten Chase, 1971 (landmarks.js) | |

import * as THREE from './three.js';
import * as G from './geo.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// --- accumulators ----------------------------------------------------------

/** One material's triangles, built from quads/tris of [x, y, z] points with a
 *  normal hint (the winding is fixed to match it) and per-point UVs. Vertices
 *  are never shared, so computeVertexNormals gives flat faces. */
class Acc {
  constructor(m) { this.m = m; this.p = []; this.u = []; this.i = []; }
  _v(a, uv) { this.p.push(a[0], a[1], a[2]); this.u.push(uv[0], uv[1]); return this.p.length / 3 - 1; }
  tri(a, b, c, nx, ny, nz, ua = [0, 0], ub = [1, 0], uc = [0, 1]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-10) return;
    const flip = cx * nx + cy * ny + cz * nz < 0;
    const i = this._v(a, ua), j = this._v(b, ub), k = this._v(c, uc);
    if (flip) this.i.push(i, k, j); else this.i.push(i, j, k);
  }
  quad(a, b, c, d, nx, ny, nz, ua, ub, uc, ud) {
    this.tri(a, b, c, nx, ny, nz, ua, ub, uc);
    this.tri(a, c, d, nx, ny, nz, ua, uc, ud);
  }
  mesh() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return new THREE.Mesh(g, this.m);
  }
}

const area2 = (poly) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; s += x0 * z1 - x1 * z0; }
  return s;
};
const fnOf = (v) => (typeof v === 'function' ? v : () => v);

/** A plan polygon pulled in by `d` metres (a centroid-direction shrink is
 *  wrong for a stepped plan; this offsets each vertex along its mitred
 *  bisector, and is only ever used with small d on mostly-convex steps). */
function insetPoly(poly, d) {
  const n = poly.length, S = area2(poly) > 0 ? 1 : -1, out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    let e0x = b[0] - a[0], e0z = b[1] - a[1], e1x = c[0] - b[0], e1z = c[1] - b[1];
    const l0 = Math.hypot(e0x, e0z) || 1, l1 = Math.hypot(e1x, e1z) || 1;
    e0x /= l0; e0z /= l0; e1x /= l1; e1z /= l1;
    // inward normals (S > 0: inside is to the left of the travel direction in x-z)
    const n0x = -e0z * S, n0z = e0x * S, n1x = -e1z * S, n1z = e1x * S;
    let bx = n0x + n1x, bz = n0z + n1z;
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-6) { out.push([b[0] + n0x * d, b[1] + n0z * d]); continue; }
    bx /= bl; bz /= bl;
    const k = d / Math.max(0.35, bx * n0x + bz * n0z);
    out.push([b[0] + bx * k, b[1] + bz * k]);
  }
  return out;
}

function pointIn(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** The part of a polygon where f(x, z) >= 0 (Sutherland-Hodgman, one plane). */
function clipPoly(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a[0], a[1]), fb = f(b[0], b[1]);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

/**
 * Walls round a plan polygon, bottom to top. `base` / `top` are heights or
 * functions of (x, z) (the skirt follows the ground); `rows` splits the wall at
 * every `rows.h` metres of absolute height so each band's UVs stay inside one
 * texture tile: `rows.v0` / `rows.v1` are the band's v range for this wall.
 * Without `rows`, v runs continuously (y / th) for a texture that tiles.
 */
function walls(acc, poly, base, top, tw, th, opt = {}) {
  const n = poly.length, S = area2(poly) > 0 ? 1 : -1;
  const fb = fnOf(base), ft = fnOf(top), segMax = opt.seg || 7;
  let s0 = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.05) continue;
    const nx = dz / L * S, nz = -dx / L * S;
    const steps = Math.max(1, Math.ceil(L / segMax));
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps, t1 = (k + 1) / steps;
      const x0 = a[0] + dx * t0, z0 = a[1] + dz * t0, x1 = a[0] + dx * t1, z1 = a[1] + dz * t1;
      const yb0 = fb(x0, z0), yb1 = fb(x1, z1), yt0 = ft(x0, z0), yt1 = ft(x1, z1);
      const u0 = (s0 + L * t0) / tw, u1 = (s0 + L * t1) / tw;
      if (opt.band) {
        // storey bands: [band.h * k, band.h * (k + 1)], v inside [band.v0, band.v1] of the tile
        const { h, vOf } = opt.band;
        const kLo = Math.floor(Math.min(yb0, yb1) / h), kHi = Math.floor((Math.max(yt0, yt1) - 1e-6) / h);
        for (let q = kLo; q <= kHi; q++) {
          const lo = q * h, hi = lo + h;
          const l0 = Math.max(yb0, lo), l1 = Math.max(yb1, lo), h0 = Math.min(yt0, hi), h1 = Math.min(yt1, hi);
          if (h0 <= l0 + 1e-4 && h1 <= l1 + 1e-4) continue;
          const [va, vb] = vOf(q);
          const v = (y) => va + (vb - va) * ((y - lo) / h);
          acc.quad([x0, l0, z0], [x1, l1, z1], [x1, Math.max(h1, l1), z1], [x0, Math.max(h0, l0), z0], nx, 0, nz,
            [u0, v(l0)], [u1, v(l1)], [u1, v(Math.max(h1, l1))], [u0, v(Math.max(h0, l0))]);
        }
      } else {
        if (yt0 <= yb0 + 1e-4 && yt1 <= yb1 + 1e-4) continue;
        acc.quad([x0, yb0, z0], [x1, yb1, z1], [x1, Math.max(yt1, yb1), z1], [x0, Math.max(yt0, yb0), z0], nx, 0, nz,
          [u0, yb0 / th], [u1, yb1 / th], [u1, Math.max(yt1, yb1) / th], [u0, Math.max(yt0, yb0) / th]);
      }
    }
    s0 += L;
  }
}

/** A flat (or `yAt`-lifted) cap over a plan polygon; `up` faces it up or down.
 *  UVs run in metres / `uvm`. */
function cap(acc, poly, yAt, up = true, uvm = 8) {
  const f = fnOf(yAt);
  const pts = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const tri = THREE.ShapeUtils.triangulateShape(pts, []);
  const ny = up ? 1 : -1;
  for (const [i, j, k] of tri) {
    const a = poly[i], b = poly[j], c = poly[k];
    acc.tri([a[0], f(a[0], a[1]), a[1]], [b[0], f(b[0], b[1]), b[1]], [c[0], f(c[0], c[1]), c[1]], 0, ny, 0,
      [a[0] / uvm, a[1] / uvm], [b[0] / uvm, b[1] / uvm], [c[0] / uvm, c[1] / uvm]);
  }
}

/** Walls between two rings of [x, y, z] (same count): the lean of a platform's
 *  sides. Faces outward from the ring's own centroid; UV u runs along the ring
 *  in metres / tw, v is height / th. */
function skin(acc, ringA, ringB, tw, th) {
  const n = ringA.length;
  let cx = 0, cz = 0;
  for (const p of ringA) { cx += p[0]; cz += p[2]; }
  cx /= n; cz /= n;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = ringA[i], b = ringA[j], c = ringB[j], d = ringB[i];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const mx = (a[0] + b[0]) / 2 - cx, mz = (a[2] + b[2]) / 2 - cz;
    // outward: away from the centroid, but along the edge's own horizontal normal
    let nx = (b[2] - a[2]), nz = -(b[0] - a[0]);
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    acc.quad(a, b, c, d, nx, 0.0001, nz,
      [s / tw, a[1] / th], [(s + L) / tw, b[1] / th], [(s + L) / tw, c[1] / th], [s / tw, d[1] / th]);
    s += L;
  }
}

/** A plan polygon scaled about its centroid, shifted and lifted into a ring. */
function ring(poly, sc, ox, oz, y, cx, cz, yFn = null) {
  return poly.map(([x, z]) => {
    const px = cx + (x - cx) * sc + ox, pz = cz + (z - cz) * sc + oz;
    return [px, yFn ? yFn(px, pz) : y, pz];
  });
}

/** A half-cylinder skin along a horizontal axis: `(ax, az)` unit along, spanning
 *  +-R across, rising `ry` (an elliptical profile when ry != R). */
function vault(acc, cx, cz, y0, ax, az, len, R, ry, nSeg, tw = 6, th = 6, caps = true) {
  const px = -az, pz = ax;
  const row = (a) => {
    const c = Math.cos(a) * R, s = Math.sin(a) * ry;
    return [[cx - ax * len / 2 + px * c, y0 + s, cz - az * len / 2 + pz * c], [cx + ax * len / 2 + px * c, y0 + s, cz + az * len / 2 + pz * c]];
  };
  let prev = row(0);
  let arc = 0;
  for (let k = 1; k <= nSeg; k++) {
    const a = (k / nSeg) * Math.PI, cur = row(a);
    const mid = a - Math.PI / nSeg / 2;
    const nx = px * Math.cos(mid) * ry, nz = pz * Math.cos(mid) * ry, ny = Math.sin(mid) * R;
    const seg = Math.hypot(cur[0][0] - prev[0][0], cur[0][1] - prev[0][1], cur[0][2] - prev[0][2]);
    acc.quad(prev[0], prev[1], cur[1], cur[0], nx, ny, nz,
      [0, arc / th], [len / tw, arc / th], [len / tw, (arc + seg) / th], [0, (arc + seg) / th]);
    arc += seg;
    prev = cur;
  }
  if (caps) {
    // the two ends: a fan from the base centre out to each arc point
    for (const e of [0, 1]) {
      const ox = cx + (e ? 1 : -1) * ax * len / 2, oz = cz + (e ? 1 : -1) * az * len / 2;
      let p0 = [ox + px * R, y0, oz + pz * R];
      for (let k = 1; k <= nSeg; k++) {
        const a = (k / nSeg) * Math.PI, p1 = [ox + px * Math.cos(a) * R, y0 + Math.sin(a) * ry, oz + pz * Math.cos(a) * R];
        acc.tri([ox, y0, oz], p0, p1, (e ? 1 : -1) * ax, 0, (e ? 1 : -1) * az);
        p0 = p1;
      }
    }
  }
}

export function makeDowntown(h) {
  const { P, M, mat, sign, solidBox, canvasTex, panelMat, box, cyl, strut, beam, solid } = h;
  /** A wall along each edge of a polygon, `t` thick, from y0 to y1 (local). */
  // `y0` may be a function of the edge's midpoint (a hillside building's wall stands from the ground there,
  // so a road in a tunnel beneath it is past the 2.5 m a solid reaches below its base); `surfaceOnly`: only a
  // road ON the surface drops it (buildLandmarks asks onRoad without tunnels)
  const outline = (g, poly, t, y1, y0 = -2) => {
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      // in pieces of ~12 m: a street crossing one end of a 130 m wall drops that piece, not the whole wall
      const n = Math.max(1, Math.round(len / 12)), rot = Math.atan2(bz - az, bx - ax);
      for (let k = 0; k < n; k++) {
        const mx = ax + (bx - ax) * (k + 0.5) / n, mz = az + (bz - az) * (k + 0.5) / n;
        solid(g, { x: mx, z: mz, hw: len / n / 2 + t / 2, hd: t / 2, rot, y0: typeof y0 === 'function' ? y0(mx, mz) : y0, y1, surfaceOnly: true });
      }
    }
  };

  // --- textures ---------------------------------------------------------------

  // The Library's skin: a diamond grid of steel over blue-green glass, a pale
  // lime floor band every 4.2 m (the interior shows through). One tile is two
  // floors tall (8.4 m) and one diamond wide (5.5 m).
  let _libTex = null;
  const libraryGlass = () => {
    if (_libTex) return _libTex;
    const tex = canvasTex(176, 270, (g, W, H) => {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#a7c3cb'); gr.addColorStop(0.5, '#8fb0b9'); gr.addColorStop(1, '#a3bec6');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      // the glass between: a fine wire mesh and a faint sheen
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
      // floors: slab edge at 0 and mid-tile, the lime of the interior above it
      for (const fy of [0, H / 2]) {
        g.fillStyle = 'rgba(214,220,140,0.5)'; g.fillRect(0, fy - 5, W, 11);
        g.fillStyle = 'rgba(40,58,64,0.55)'; g.fillRect(0, fy + 6, W, 5);
      }
      const dia = (lw, col) => {
        g.lineWidth = lw; g.strokeStyle = col; g.lineCap = 'butt'; g.lineJoin = 'miter';
        g.beginPath();
        g.moveTo(0, H / 2); g.lineTo(W / 2, 0); g.lineTo(W, H / 2); g.lineTo(W / 2, H); g.lineTo(0, H / 2);
        g.stroke();
      };
      dia(9, '#35484f');
      dia(5, '#dfe5e5');
      g.fillStyle = '#eef1f1';
      for (const [x, y] of [[0, H / 2], [W, H / 2], [W / 2, 0], [W / 2, H]]) { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); }
    });
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.22, metalness: 0.4, envMapIntensity: 0.85 });
    m.userData.tile = [5.5, 8.4];
    return (_libTex = m);
  };

  // The Convention Center's wall, two storeys to a tile (4.5 m each): the
  // lower is the podium -- pale precast with a long ribbon window -- and the
  // upper the glass block's curtain wall, a mullion every 1.5 m.
  const WSCC_STOREY = 4.5;
  let _wscc = null;
  const wsccWall = () => {
    if (_wscc) return _wscc;
    const tex = canvasTex(256, 256, (g, W, H) => {
      // canvas y runs down and texture v up: the canvas's BOTTOM half is v 0..0.5
      // (the curtain-wall storey), its TOP half v 0.5..1 (the precast one)
      const half = H / 2;
      g.fillStyle = '#35616b'; g.fillRect(0, half, W, half);
      const gr = g.createLinearGradient(0, half, 0, H);
      gr.addColorStop(0, '#5d8e97'); gr.addColorStop(1, '#3b6872');
      g.fillStyle = gr; g.fillRect(0, half + 14, W, half - 28);
      g.fillStyle = '#c3cbcd';
      for (let k = 0; k <= 4; k++) g.fillRect(k * (W / 4) - 2, half, 4, half);
      g.fillRect(0, half, W, 14); g.fillRect(0, H - 14, W, 14);
      g.fillStyle = '#243f47'; g.fillRect(0, H - 14, W, 4);
      // precast storey
      g.fillStyle = '#c8c3b6'; g.fillRect(0, 0, W, half);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.03})`;
        g.fillRect(Math.random() * W, Math.random() * half, 2 + Math.random() * 12, 1 + Math.random() * 2);
      }
      g.fillStyle = '#26454d'; g.fillRect(14, 30, W - 28, 62);
      const g2 = g.createLinearGradient(0, 30, 0, 92);
      g2.addColorStop(0, '#4e7e88'); g2.addColorStop(1, '#2d525b');
      g.fillStyle = g2; g.fillRect(18, 34, W - 36, 54);
      g.fillStyle = '#c8c3b6'; for (let k = 1; k < 4; k++) g.fillRect(k * W / 4 - 2, 34, 4, 54);
      g.fillStyle = '#a49f92'; g.fillRect(0, 0, W, 10); g.fillRect(0, half - 6, W, 6);
      g.fillStyle = '#e1ddd0'; g.fillRect(0, 96, W, 5);
    });
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.55, metalness: 0.1, envMapIntensity: 0.7 });
    return (_wscc = m);
  };
  // ground-following helpers --------------------------------------------------

  /** Window panes along each edge of a plan polygon: boxes `w` x `h` every `pitch` m, `off` out
   *  of the wall, from height y0. `skip(x, z)` drops the ones that would clash with something. */
  const fenestrate = (g, poly, o) => {
    const S = area2(poly) > 0 ? 1 : -1;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < (o.minLen || 6)) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L, nx = dz * S, nz = -dx * S, ry = Math.atan2(-dz, dx);
      const n = Math.floor((L - 1) / o.pitch), st = (L - n * o.pitch) / 2 + o.pitch / 2;
      for (let q = 0; q < n; q++) {
        const px = ax + dx * (st + q * o.pitch) + nx * o.off, pz = az + dz * (st + q * o.pitch) + nz * o.off;
        if (o.skip && o.skip(px, pz)) continue;
        g.add(box(o.w, o.h, 0.14, o.mat, px, o.y0, pz, ry));
      }
    }
  };

  /** Origin of a landmark group: where buildLandmarks will put it. */
  const origin = (l, rot, baseY) => {
    const x = l.p ? l.p[0] : l.x, z = l.p ? l.p[1] : l.z;
    return { x, z, t: rot, y: baseY !== undefined ? baseY : G.terrainHeight(x, z) };
  };
  /** Terrain height at group-local (lx, lz), in group-local y. */
  const groundFn = (o, drop = 0.5) => {
    const c = Math.cos(o.t), s = Math.sin(o.t);
    return (lx, lz) => G.terrainHeight(o.x + lx * c + lz * s, o.z - lx * s + lz * c) - o.y - drop;
  };

  // ---------------------------------------------------------------------------
  // THE CONVENTION CENTER'S ARCH. The OSM way, 244 x 128 m, in its own frame:
  // u along the Pike Street front, v across it (rotation 0.558: local +x is
  // (cos t, -sin t) in the world). I-5 runs under it in a lid (OSM layer -1/-2),
  // so the building stands on the ground and the hill decides how much of the
  // podium shows: ~20 m on the Pike side, a few metres on the freeway side.
  const CONV_PLAN = [[-122.3, -77.5], [-122.3, -66.1], [-122.4, -30.0], [-85.4, -29.7], [-86.8, 24.3], [-71.4, 24.4], [-71.4, 44.2], [-52.2, 44.3], [-52.2, 41.6], [-49.1, 41.6], [-49.1, 28.8], [-42.9, 28.8], [-42.9, 25.9], [-21.6, 26.0], [-21.7, 28.9], [-16.0, 28.9], [-16.0, 35.3], [-12.7, 35.2], [-12.7, 37.9], [-6.7, 37.9], [-6.7, 44.5], [-0.6, 44.6], [-0.6, 50.5], [21.3, 50.7], [21.4, 47.5], [27.6, 47.6], [27.6, 44.4], [30.6, 44.4], [30.6, 41.5], [33.7, 41.5], [33.7, 38.6], [36.7, 38.6], [36.8, 35.3], [43.0, 35.4], [43.0, 32.6], [45.9, 32.5], [45.9, 20.0], [52.1, 20.0], [52.1, 12.2], [58.3, 12.3], [58.3, 1.2], [67.6, 1.2], [67.6, -6.2], [75.1, -6.2], [75.2, -9.1], [91.6, -9.0], [98.4, -19.8], [121.8, -47.2], [122.2, -76.7], [10.2, -77.1], [-119.7, -77.5]];

  function convention(l) {
    const g = new THREE.Group();
    const rot = 0.558;
    const o = origin(l, rot);
    const gnd = groundFn(o, 0.6);
    g.userData.rot = rot;
    const wall = wsccWall();
    const STO = WSCC_STOREY;
    // canvas top half (v 0.5..1) is the precast storey, bottom half (v 0..0.5) the curtain wall
    const podiumV = () => [0.5, 1], glassV = () => [0, 0.5];
    const PODIUM = 4.0, EAVE = 18.5;
    const A = new Acc(wall);
    // podium: precast storeys from the hill up to +4 m, banded on absolute height
    walls(A, CONV_PLAN, gnd, PODIUM, 6, STO, { band: { h: STO, vOf: podiumV } });
    // the glazed block: pulled in 3 m, curtain wall storeys
    const upper = insetPoly(CONV_PLAN, 3);
    walls(A, upper, PODIUM, EAVE, 6, STO, { band: { h: STO, vOf: glassV } });
    g.add(A.mesh());
    // ledge and roofs
    const slab = new Acc(P(0x8a877e, 0.92, 0, 0.5));
    cap(slab, CONV_PLAN, PODIUM, true, 10);
    const roof = new Acc(P(0x6c6a64, 0.95, 0, 0.45));
    cap(roof, upper, EAVE + 0.5, true, 10);
    const trim = new Acc(P(0xcbc7bb, 0.8, 0, 0.6));
    walls(trim, CONV_PLAN, PODIUM - 0.25, PODIUM + 0.5, 6, 1);   // the parapet's edge
    walls(trim, upper, EAVE, EAVE + 0.5, 6, 1);
    // pale pavers along the roof's service lanes
    for (const [zz, x0, x1] of [[-62, -100, 110], [-3, -80, 90], [30, -70, -10]]) {
      trim.quad([x0, EAVE + 0.53, zz - 0.8], [x1, EAVE + 0.53, zz - 0.8], [x1, EAVE + 0.53, zz + 0.8], [x0, EAVE + 0.53, zz + 0.8], 0, 1, 0);
    }
    g.add(slab.mesh(), roof.mesh(), trim.mesh());
    // the arched roofs: three skylit barrel vaults across the block, steel ribs
    const rib = P(0xc9ced0, 0.4, 0.6, 0.75);
    const vglass = P(0x86b7c4, 0.12, 0.55, 1.0);
    const ax = 0, az = 1;                          // vaults run along v
    const V = new Acc(vglass);
    for (const [cx, cz, len] of [[-70, -2, 38], [-12, -14, 56], [46, -34, 62], [94, -38, 40]]) {
      vault(V, cx, cz, EAVE + 0.5, ax, az, len, 11, 7.5, 8);
      g.add(box(22.4, 1.0, len, rib, cx, EAVE + 0.5, cz));
      for (let k = 0; k <= Math.floor(len / 8); k++) {
        const zz = cz - len / 2 + k * (len / Math.floor(len / 8));
        let prev = null;
        for (let a = 0; a <= 8; a++) {
          const t = (a / 8) * Math.PI;
          const p = V3(cx + Math.cos(t) * 11.1, EAVE + 0.5 + Math.sin(t) * 7.6, zz);
          if (prev) g.add(strut(prev, p, 0.28, rib, 5));
          prev = p;
        }
      }
    }
    g.add(V.mesh());
    // the portal on the Pike Street front: a glazed arch bay projecting from the wall
    {
      const cx = -26, z0 = -77.5;
      const gl = new Acc(vglass);
      vault(gl, cx, z0 - 5, PODIUM + 0.2, 0, 1, 10, 9, 8.5, 10);
      g.add(gl.mesh());
      g.add(box(18.6, 0.6, 10.4, rib, cx, PODIUM, z0 - 5));
      let prev = null;
      for (let a = 0; a <= 10; a++) {
        const t = (a / 10) * Math.PI;
        const p = V3(cx + Math.cos(t) * 9.1, PODIUM + 0.2 + Math.sin(t) * 8.6, z0 - 10);
        if (prev) g.add(strut(prev, p, 0.3, rib, 5));
        prev = p;
      }
    }
    // mechanical penthouses
    const pent = P(0x8c8f8f, 0.7, 0.3, 0.55);
    for (const [x, z, w, d] of [[-40, -40, 14, 10], [20, 0, 18, 12], [60, -20, 12, 14], [-100, -55, 10, 8], [0, 20, 10, 8]])
      g.add(box(w, 3.4, d, pent, x, EAVE + 0.5, z));
    // the name, on the Pike Street parapet
    const s = sign('WASHINGTON STATE CONVENTION CENTER', 46, 2.6, null, '#f4f4f0', { stroke: '#243f47', px: 18 });
    s.position.set(40, PODIUM + 12.5, -77.9);
    s.rotation.y = Math.PI;
    g.add(s);
    // collision: the podium's outline. A wall segment that lies on a road
    // (I-5's lid, Convention Place's passages) is dropped by buildLandmarks.
    outline(g, insetPoly(CONV_PLAN, 2.2), 2.0, 20, (x, z) => gnd(x, z) - 0.8);
    return g;
  }

  // ---------------------------------------------------------------------------
  // THE CENTRAL LIBRARY (OMA / LMN, 2004; 1000 4th Ave): 11 floors, 56 m, five
  // platforms of different size and offset stacked so that each overhangs the
  // one below, the whole wrapped in a steel diamond grid with glass between.
  // The plan is the OSM way in the block's own frame (rotation -1.017: local x
  // along the avenues, +z downhill toward 4th). Which platform leans which way
  // is est., from photographs of the 5th Avenue and Spring Street fronts.
  const LIB_PLAN = [[-29.4, 34.5], [-1.2, 34.5], [6.7, 34.6], [21.6, 30.8], [38.1, 21.5], [38.0, -29.4], [38.0, -40.1], [25.1, -40.0], [-15.2, -39.6], [-24.4, -39.5], [-33.7, -31.4], [-33.7, 30.4]];
  const aff = (poly, cx, cz, a, b, c, d, ox, oz, y, yFn = null) => poly.map(([x, z]) => {
    const dx = x - cx, dz = z - cz;
    const px = cx + a * dx + b * dz + ox, pz = cz + c * dx + d * dz + oz;
    return [px, yFn ? yFn(px, pz) : y, pz];
  });
  function library() {
    const g = new THREE.Group();
    const lg = libraryGlass();
    const A = new Acc(lg);
    const deck = new Acc(P(0x99a4a8, 0.6, 0.3, 0.9));
    const under = new Acc(P(0x7c898e, 0.65, 0.25, 1.1));
    const edge = new Acc(P(0xcfd6d6, 0.35, 0.65, 0.8));
    const cx = 2.2, cz = -2.7;
    // [y0, y1, bottom: scale, shear, ox, oz, top: scale, shear, ox, oz]
    const VOL = [
      [-14, 9.5, 0.97, 0, 0, 0, 0.97, 0, 0, 0],
      [9.5, 20, 0.86, 0.04, -7, 5.5, 0.9, 0.04, -8, 6],
      [20, 29.5, 0.7, -0.05, 6, -4, 0.76, -0.05, 6.5, -4.5],
      [29.5, 42, 0.97, 0.06, -4, 5, 0.84, 0.06, -7, 7.5],
      [42, 50.5, 0.58, -0.04, 7, -9, 0.5, -0.04, 7.5, -9.5],
    ];
    VOL.forEach(([y0, y1, s0, sh0, ox0, oz0, s1, sh1, ox1, oz1], i) => {
      const a = aff(LIB_PLAN, cx, cz, s0, sh0, 0, s0, ox0, oz0, y0);
      const last = i === VOL.length - 1;
      // the reading room's roof is a tilted plane, high toward the 4th Avenue side
      const roofY = (x, z) => (last ? y1 + 2.5 + (z + 12) * 0.28 : y1);
      const top = aff(LIB_PLAN, cx, cz, s1, sh1, 0, s1, ox1, oz1, 0, roofY);
      skin(A, a, top, 5.5, 8.4);
      cap(deck, top.map((p) => [p[0], p[2]]), roofY, true, 8);
      cap(under, a.map((p) => [p[0], p[2]]), y0, false, 8);
      // the slab's edge at each floor line of the top: a pale steel band
      const hi = top.map((p) => [p[0], p[1] + 0.02, p[2]]);
      const lo = top.map((p) => [p[0], p[1] - 1.0, p[2]]);
      skin(edge, lo, hi, 4, 1);
    });
    g.add(A.mesh(), deck.mesh(), under.mesh(), edge.mesh());
    outline(g, LIB_PLAN.map(([x, z]) => [cx + (x - cx) * 0.96, cz + (z - cz) * 0.96]), 2.4, 52, -24);
    return g;
  }

  // ---------------------------------------------------------------------------
  // THE SEATTLE AQUARIUM, Pier 59, and the OCEAN PAVILION beside it. Both are
  // OSM plans, in world axes round the landmark's point; local y 0 is the
  // pier deck (2.4 m, the same deck the old model's platform walked on).
  // Pier 59 is a low shed under a shallow teal gabled roof, cream walls over a
  // blue plinth, a glass vestibule on the Alaskan Way side, the name in blue.
  // The Pavilion (opened 2025) is two storeys over a glass base, clad in timber
  // fins, under a deep-eaved roof that rises toward the water.
  const AQ_MAIN = [[-10.7, 24.1], [-0.1, 24.0], [0, 28], [6.4, 28.1], [6.5, 24], [25.2, 23.9], [25.2, 24.7], [28.2, 24.7], [28.2, 28], [37, 28.1], [37, 24.7], [39.9, 24.6], [39.7, -5.3], [9.8, -31.5], [-0.7, -31.5], [-0.8, -23.8], [-6, -20.8], [-11.7, -14.6], [-12.4, -9.4], [-10.7, 7]];
  const AQ_PAV = [[19.2, -48.2], [22.3, -39.8], [25.9, -34.9], [39.5, -22.2], [56.6, -7.1], [69.2, -14.4], [65.1, -21.3], [71.7, -25.0], [45.3, -67.4], [41.6, -71.0], [35.5, -73.0], [30.7, -73.7], [29.0, -71.1], [21.5, -60.0], [19.4, -52.7]];
  function aquarium(l) {
    const g = new THREE.Group();
    g.userData.baseY = 2.4;
    const o = origin(l, 0, 2.4);
    const gnd = groundFn(o, 0.5);
    const wx = (lx, lz) => [o.x + lx, o.z + lz];
    // the deck, and the piles it stands on where the water is
    const deckPoly = insetPoly(AQ_MAIN, -2.5);
    const dk = new Acc(P(0x8a6b4a, 0.85, 0, 0.5));
    cap(dk, deckPoly, 0, true, 4);
    walls(dk, deckPoly, -1.3, 0, 4, 1.3);
    g.add(dk.mesh());
    const pile = P(0x5b4a3a, 0.9, 0, 0.45);
    for (let x = -12; x <= 42; x += 6) for (let z = -33; z <= 30; z += 6) {
      if (!pointIn(deckPoly, x, z)) continue;
      const [qx, qz] = wx(x, z);
      if (G.terrainHeight(qx, qz) > o.y - 1) continue;
      g.add(cyl(0.38, 0.38, 9, pile, x, -9.3, z, 6));
    }
    g.userData.decks = [{ x: 14.5, z: -3, hw: 28.5, hd: 32.5, top: 0 }];
    // Pier 59's shed
    const XR = 14.5, EAVE = 8.2, RISE = 4.6, HALF = 26.5;
    const roofY = (x) => EAVE + RISE * Math.max(0, 1 - Math.abs(x - XR) / HALF);
    const W = new Acc(P(0xe6e2d6, 0.8, 0, 0.55));
    walls(W, AQ_MAIN, -0.1, (x, z) => roofY(x), 6, 6, { seg: 1.7 });
    g.add(W.mesh());
    const plinth = new Acc(P(0x2f6f8c, 0.7, 0.1, 0.6));
    walls(plinth, insetPoly(AQ_MAIN, -0.06), -0.1, 1.5, 6, 1.5);
    g.add(plinth.mesh());
    const R = new Acc(P(0x4a8a94, 0.45, 0.5, 0.8));
    const roofPoly = insetPoly(AQ_MAIN, -0.9);
    for (const half of [1, -1]) {
      const part = clipPoly(roofPoly, (x) => (x - XR) * half);
      if (part.length < 3) continue;
      // eaves reach the polygon's edge: a plane through the ridge and the eave line
      cap(R, part, (x) => EAVE + RISE * (1 - Math.abs(x - XR) / HALF) - 0.25, true, 6);
    }
    g.add(R.mesh());
    // tall windows along the walls, the glass of the exhibit halls
    fenestrate(g, AQ_MAIN, { y0: 1.9, h: 4.2, w: 3.6, pitch: 5.2, off: 0.05, mat: P(0x2f5662, 0.1, 0.65, 1.0), minLen: 8,
      skip: (x, z) => z > 23 && x > 3 && x < 30 });
    // ridge cap, a row of skylights and vents
    const ridge = P(0xc9d0d2, 0.4, 0.6, 0.8);
    g.add(box(0.8, 0.5, 52, ridge, XR, EAVE + RISE - 0.1, -3.5));
    for (let k = 0; k < 4; k++) g.add(box(5.2, 1.2, 4.2, P(0x7fb0c0, 0.12, 0.5, 1.0), XR - 8.5 + (k % 2) * 17, EAVE + RISE * 0.62 - 0.1 - 0.0, -22 + k * 11));
    // the vestibule: the entrance is on the SOUTH face, where the approach pier meets the shed -- glass
    // between the two stubs of wall, a flat canopy over it, the name on the canopy's edge
    {
      const gl = P(0x5d8f9c, 0.1, 0.6, 1.0);
      g.add(box(15, 6.6, 0.6, gl, 16, 0, 25.1));
      g.add(box(18, 0.7, 7.4, P(0x2f6f8c, 0.5, 0.3, 0.7), 16, 6.4, 28.4));
      for (let k = -3; k <= 3; k++) g.add(box(0.35, 6.6, 0.35, ridge, 16 + k * 2.5, 0, 25.4));
      for (const sx of [-8.4, 8.4]) g.add(box(0.4, 6.6, 0.4, ridge, 16 + sx, 0, 31.9));
    }
    const s1 = sign('SEATTLE AQUARIUM', 22, 3.0, '#0f3d55', '#ffffff');
    s1.position.set(16, 8.7, 32.2);
    g.add(s1);
    const s2 = sign('SEATTLE AQUARIUM', 16, 2.2, '#0f3d55', '#ffffff');
    s2.position.set(40.4, 7.6, 8.5); s2.rotation.y = Math.PI / 2;
    g.add(s2);
    // the approach pier, 22 m wide and 150 long (the OSM way the importer drew as a roofed box): decked, on piles, walkable
    {
      const AP = [[-44.7, 27.9], [-18.9, 50.2], [102.3, 50.8], [97.2, 46.0], [78.9, 28.5], [37, 28.1], [28.2, 28.0], [6.4, 28.1], [0, 28]];
      const ad = new Acc(P(0x8a6b4a, 0.85, 0, 0.5));
      cap(ad, AP, 0, true, 4);
      walls(ad, AP, -1.0, 0, 4, 1);
      g.add(ad.mesh());
      for (let x = -40; x <= 100; x += 7) for (let z = 30; z <= 50; z += 7) {
        if (!pointIn(AP, x, z)) continue;
        const [qx, qz] = wx(x, z);
        if (G.terrainHeight(qx, qz) > o.y - 1) continue;
        g.add(cyl(0.36, 0.36, 8, pile, x, -8.3, z, 6));
      }
      // low rails on the long edges
      const rl = P(0x3a4348, 0.5, 0.5, 0.6);
      g.add(box(110, 0.07, 0.07, rl, 45, 1.05, 50.2));
      g.add(box(78, 0.07, 0.07, rl, 60, 1.05, 28.6));
      // walkable: strips along the pier; a gangway at its east end meets the shore if one is in reach
      for (let x0 = -20; x0 < 96; x0 += 22) g.userData.decks.push({ x: x0 + 11, z: 39.4, hw: 11, hd: 10.4, top: 0 });
      g.userData.decks[g.userData.decks.length - 1].land = { x: 97, z: 39.4, dx: 1, dz: 0, w: 5 };
    }
    // the Ocean Pavilion
    {
      const pg = (lx, lz) => gnd(lx, lz);
      const base = (x, z) => Math.max(pg(x, z), -0.5);
      const glassB = P(0x5d8f9c, 0.1, 0.6, 1.0);
      const timber = P(0xb88a58, 0.7, 0, 0.55);
      const B = new Acc(glassB);
      walls(B, AQ_PAV, base, 4.2, 6, 4.2);
      const T = new Acc(timber);
      walls(T, insetPoly(AQ_PAV, -0.05), 4.2, 10.6, 6, 6.4);
      g.add(B.mesh(), T.mesh());
      // timber fins on the upper wall, every 3 m, and a band between the storeys
      const fin = P(0x8a6538, 0.75, 0, 0.5);
      const band = P(0x39454a, 0.5, 0.4, 0.7);
      for (let i = 0; i < AQ_PAV.length; i++) {
        const [ax, az] = AQ_PAV[i], [bx, bz] = AQ_PAV[(i + 1) % AQ_PAV.length];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 4) continue;
        const dx = (bx - ax) / L, dz = (bz - az) / L, ry = Math.atan2(-dz, dx);
        for (let q = 1.5; q < L - 0.8; q += 3) g.add(box(0.35, 6.2, 0.55, fin, ax + dx * q, 4.3, az + dz * q, ry));
        g.add(box(L, 0.45, 0.8, band, (ax + bx) / 2, 3.95, (az + bz) / 2, ry));
      }
      // the roof: one plane, low at the land side and rising toward the water
      const rp = insetPoly(AQ_PAV, -1.8);
      const pr = new Acc(P(0x8d9895, 0.55, 0.35, 0.8));
      const grn = new Acc(P(0x86a366, 0.95, 0, 0.5));
      const py = (x, z) => 10.6 - (x - 45) * 0.03 - (z + 40) * 0.06;
      // the water end carries a planted roof: one half of the plan by a line across its long axis
      const side = (x, z) => (x - 50) * -0.5 + (z + 45) * -0.86;
      const rg = clipPoly(rp, (x, z) => side(x, z) - 4), rs = clipPoly(rp, (x, z) => 4 - side(x, z));
      if (rg.length > 2) cap(grn, rg, py, true, 6);
      if (rs.length > 2) cap(pr, rs, py, true, 6);
      walls(pr, rp, (x, z) => py(x, z) - 0.7, py, 6, 1);
      cap(pr, rp, (x, z) => py(x, z) - 0.7, false, 6);
      g.add(pr.mesh(), grn.mesh());
      // skylights over the atrium
      for (const [sx, sz] of [[36, -58], [42, -48], [50, -36]]) g.add(box(7, 1.1, 5, P(0x7fb0c0, 0.12, 0.5, 1.0), sx, py(sx, sz), sz, -0.5));
      outline(g, AQ_PAV, 1.5, 12, -3);
    }
    outline(g, AQ_MAIN, 1.5, 11, -3);
    return g;
  }

  // ---------------------------------------------------------------------------
  // COLMAN DOCK'S TERMINAL (Pier 52, WSF; the building opened 2019-2023): the
  // OSM "Entry Building" is a 16 x 90 m slab lying 18 deg east of south along
  // Alaskan Way (rotation 0.553 here). Three storeys: a glazed concourse under
  // two floors of curtain wall with sun-shading fins, a green fascia, a glass
  // canopy toward the slips, and the enclosed overhead walkway that carries
  // foot passengers out over the dock's vehicle lanes to the boats.
  function ferryTerminal(l) {
    const g = new THREE.Group();
    const ROT = 0.553, c = Math.cos(ROT), s = Math.sin(ROT);
    g.userData.rot = ROT;
    const CX = -2.0, CZ = -12.75, HW = 8.0, HL = 45.0;     // the slab, in the group's frame
    const glassD = P(0x23454e, 0.1, 0.65, 1.0);            // concourse
    const glassL = P(0x4f7f8c, 0.1, 0.6, 1.0);            // upper floors
    const steel = P(0xb9c0c2, 0.4, 0.6, 0.75);
    const green = mat.wsfGreen;
    const slab = P(0xa9a79f, 0.9, 0, 0.5);
    g.add(box(HW * 2 + 3, 1.6, HL * 2 + 3, slab, CX, -1.4, CZ));
    // concourse glass and the columns in front of it
    g.add(box(HW * 2 - 0.4, 5.0, HL * 2 - 0.4, glassD, CX, 0, CZ));
    for (const sd of [-1, 1]) for (let k = 0; k <= 15; k++) {
      g.add(box(0.5, 5.2, 0.5, steel, CX + sd * (HW + 0.1), 0, CZ - HL + 0.5 + k * (HL * 2 - 1) / 15));
    }
    // two floors of curtain wall, banded by fins
    g.add(box(HW * 2 - 0.6, 8.8, HL * 2 - 0.6, glassL, CX, 5.0, CZ));
    for (const y of [5.0, 9.4, 13.6]) g.add(box(HW * 2 + 0.8, 0.3, HL * 2 + 0.8, steel, CX, y, CZ));
    for (const sd of [-1, 1]) for (let k = 0; k <= 30; k++) {
      g.add(box(0.28, 8.8, 0.35, steel, CX + sd * (HW - 0.28), 5.0, CZ - HL + 0.5 + k * (HL * 2 - 1) / 30));
    }
    // fascia and parapet
    g.add(box(HW * 2 + 0.8, 1.5, HL * 2 + 0.8, green, CX, 13.8, CZ));
    g.add(box(HW * 2 - 1, 0.6, HL * 2 - 1, P(0x3d4144, 0.8, 0, 0.45), CX, 15.3, CZ));
    // roof lantern and plant
    g.add(box(5.5, 2.6, 36, glassL, CX, 15.3, CZ - 4));
    g.add(box(6, 2.2, 8, P(0x8c8f8f, 0.7, 0.3, 0.55), CX + 1, 15.3, CZ + 33));
    // the canopy toward the slips (west): one glass plane on steel ribs
    {
      const x0 = CX - HW - 0.3, x1 = CX - HW - 7.2;
      const cn = new Acc(P(0x9ec6d0, 0.12, 0.4, 1.0));
      const zA = CZ - HL + 6, zB = CZ + HL - 6;
      const tl = [x0, 11.4, zA], tr = [x0, 11.4, zB], bl = [x1, 8.7, zA], br = [x1, 8.7, zB];
      cn.quad(tl, tr, br, bl, -0.37, 0.93, 0);
      g.add(cn.mesh());
      for (let k = 0; k <= 12; k++) {
        const z = zA + (zB - zA) * k / 12;
        g.add(strut(V3(x0, 11.4, z), V3(x1, 8.7, z), 0.1, steel, 5));
        if (k % 3 === 0) g.add(box(0.25, 8.7, 0.25, steel, x1, 0, z));
      }
      g.add(box(0.3, 0.3, zB - zA, steel, x1, 8.55, (zA + zB) / 2));
    }
    // the entry: a taller glazed bay on the Alaskan Way side, mid-building
    g.add(box(4.5, 16.2, 14, glassL, CX + HW + 2.1, 0, CZ + 4));
    g.add(box(4.9, 0.8, 14.6, green, CX + HW + 2.1, 16.2, CZ + 4));
    // names: green on white, facing out from each face
    const sE = sign('WASHINGTON STATE FERRIES', 30, 3.2, '#1c6b52', '#ffffff');
    sE.position.set(CX + HW + 0.5, 14.5, CZ - 20); sE.rotation.y = Math.PI / 2;
    g.add(sE);
    const sW = sign('COLMAN DOCK', 18, 3.0, '#1c6b52', '#ffffff');
    sW.position.set(CX - HW - 0.5, 14.5, CZ - 16); sW.rotation.y = -Math.PI / 2;
    g.add(sW);
    // THE OVERHEAD WALKWAY, in world axes: west from the terminal's upper floor
    // to the pier, 4.6 m wide, glazed, on three trestles. (local = world turned by -ROT)
    {
      const toL = (wx, wz) => [wx * c - wz * s, wx * s + wz * c];
      const ry = -ROT;                                  // a box's length along world +x
      const wy = 5.6, wh = 3.2;
      const [sx, sz] = toL(-14.5, -5.6);                // the terminal's west face at the walkway's level
      const LEN = 58;
      const [mx, mz] = toL(-14.5 - LEN / 2 + 1, -5.6);
      g.add(box(LEN, 0.5, 4.8, steel, mx, wy - 0.5, mz, ry));
      g.add(box(LEN, wh, 4.2, glassL, mx, wy, mz, ry));
      g.add(box(LEN + 0.6, 0.4, 5.2, P(0x5b6063, 0.7, 0.3, 0.5), mx, wy + wh, mz, ry));
      for (const dx of [-8, -30, -52]) {
        const [px, pz] = toL(dx, -5.6);
        g.add(box(1.0, wy - 0.4 + 1.6, 1.0, steel, px, -1.4, pz, ry));
      }
      // mullions along both sides
      for (let k = 0; k <= 14; k++) for (const sd of [-1, 1]) {
        const [px, pz] = toL(-14.5 - k * (LEN - 2) / 14, -5.6 + sd * 2.15);
        g.add(box(0.25, wh, 0.25, steel, px, wy, pz, ry));
      }
    }
    for (let k = 0; k < 6; k++) solidBox(g, CX, CZ - HL + HL * 2 / 6 * (k + 0.5), HW + 0.4, HL / 6 + 0.3, 0, 14, -4);
    return g;
  }

  // ---------------------------------------------------------------------------
  // KERRY PARK (Queen Anne's south face, 211 W Highland Dr): the view the city
  // is known for. The terrace is a paved shelf 54 x 22 m on the OSM park's
  // north side, laid to the slope of Highland Drive's verge and falling 4 %
  // south, behind a concrete parapet 1.05 m high -- low on purpose: from a
  // standing eye (1.7 m) the whole skyline and the Needle stand above it. The
  // hill falls away below the parapet, so the retaining wall drops 2-4 m to the
  // grass. Changing Form (its own landmark, landmarks.js) stands on it.
  function kerryPark(l) {
    const g = new THREE.Group();
    g.userData.worldAligned = true;
    const o = origin(l, 0);
    const X0 = -27, X1 = 27, Z0 = -14.2, Z1 = 8.0;
    // the terrace's surface passes 0.1 m over the sculpture's own ground and falls 4 % to the south
    const Ys = G.terrainHeight(o.x - 0.68, o.z - 7.7) + 0.1 - o.y;
    const tY = (z) => Ys - 0.04 * (z + 7.7);
    const gnd = groundFn(o, 0.5);
    const RECT = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]];
    // paving, with joints every 3 m
    const top = new Acc(P(0xc4c1b8, 0.88, 0, 0.55));
    cap(top, RECT, (x, z) => tY(z), true, 4);
    g.add(top.mesh());
    const joint = new Acc(P(0x8c8a82, 0.95, 0, 0.45));
    for (let x = X0 + 3; x < X1; x += 3) {
      joint.quad([x - 0.04, tY(Z0) + 0.012, Z0], [x + 0.04, tY(Z0) + 0.012, Z0], [x + 0.04, tY(Z1) + 0.012, Z1], [x - 0.04, tY(Z1) + 0.012, Z1], 0, 1, 0);
    }
    for (let z = Z0 + 3; z < Z1; z += 3) {
      joint.quad([X0, tY(z) + 0.012, z - 0.04], [X1, tY(z) + 0.012, z - 0.04], [X1, tY(z) + 0.012, z + 0.04], [X0, tY(z) + 0.012, z + 0.04], 0, 1, 0);
    }
    g.add(joint.mesh());
    // the retaining wall: board-formed concrete from the grass up to the terrace
    const face = new Acc(P(0x9b978d, 0.92, 0, 0.5));
    walls(face, RECT, gnd, (x, z) => tY(z), 4, 2, { seg: 4 });
    g.add(face.mesh());
    // the parapet: along the south edge and 9 m back along each end
    const capM = P(0xd0cdc4, 0.8, 0, 0.6), wallM = P(0xaaa69b, 0.9, 0, 0.5);
    const PH = 1.05;
    g.add(box(X1 - X0 + 0.6, PH, 0.42, wallM, 0, tY(Z1) - 0.1, Z1 - 0.2));
    g.add(box(X1 - X0 + 0.9, 0.12, 0.62, capM, 0, tY(Z1) + PH - 0.1, Z1 - 0.2));
    for (const sx of [-1, 1]) for (let z = Z1 - 9; z < Z1 - 0.3; z += 3) {
      const yy = tY(z + 1.5);
      g.add(box(0.42, PH, 3.02, wallM, sx * (X1 - 0.2), yy - 0.1, z + 1.5));
      g.add(box(0.62, 0.12, 3.02, capM, sx * (X1 - 0.2), yy + PH - 0.1, z + 1.5));
    }
    // pilasters every 6 m up the retaining wall, a plinth course and a cornice under the cap
    {
      const pil = P(0x8a867c, 0.92, 0, 0.5);
      for (let x = X0 + 2; x <= X1 - 1; x += 6) {
        const b = gnd(x, Z1 + 0.15);
        g.add(box(0.7, tY(Z1) - b - 0.1, 0.5, pil, x, b, Z1 + 0.05));
      }
      const b0 = gnd(0, Z1 + 0.1);
      g.add(box(X1 - X0 + 0.5, 0.45, 0.62, P(0x77736a, 0.95, 0, 0.45), 0, tY(Z1) - 0.55, Z1 + 0.05));
      // a clipped hedge and shrubs at the wall's foot
      const hedge = P(0x4d7f3d, 0.95, 0, 0.5);
      for (let x = X0 + 1; x <= X1 - 1; x += 2.2) {
        const gy = gnd(x, Z1 + 1.6);
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), hedge);
        m.scale.set(1.2, 0.8, 0.9); m.position.set(x, gy + 0.5 + 0.35, Z1 + 1.6);
        g.add(m);
      }
    }
    // benches along the parapet, facing south; lamps; the sculpture's low plinth
    const slat = P(0x7a5a3a, 0.8, 0, 0.5), iron = P(0x34383b, 0.5, 0.5, 0.6);
    for (const bx of [-20, -9, 9, 20]) {
      const yy = tY(Z1 - 2.6);
      g.add(box(2.0, 0.07, 0.5, slat, bx, yy + 0.43, Z1 - 2.6));
      g.add(box(2.0, 0.4, 0.06, slat, bx, yy + 0.5, Z1 - 2.84));
      for (const sx of [-0.85, 0.85]) g.add(box(0.07, 0.43, 0.5, iron, bx + sx, yy, Z1 - 2.6));
    }
    for (const lx of [-24, -8, 8, 24]) {
      const yy = tY(Z0 + 3);
      g.add(cyl(0.07, 0.09, 4.4, iron, lx, yy, Z0 + 3, 6));
      g.add(box(0.5, 0.18, 0.5, P(0xe9e3c8, 0.5, 0, 0.8), lx, yy + 4.4, Z0 + 3));
    }
    g.add(cyl(2.6, 2.7, 0.14, P(0x8f8c83, 0.9, 0, 0.5), -0.68, tY(-7.7) - 0.1, -7.7, 14));
    // collision: the parapet and the two end walls, from just under the terrace to its top
    solidBox(g, 0, Z1 - 0.2, (X1 - X0) / 2 + 0.3, 0.45, 0, tY(Z1) + PH + 0.3, tY(Z1) - 1.5);
    for (const sx of [-1, 1]) solidBox(g, sx * (X1 - 0.2), (Z0 + Z1) / 2, 0.45, (Z1 - Z0) / 2, 0, tY(Z1) + PH + 0.3, tY(Z1) - 1.5);
    // the shelf is ground: a platform laid to the same plane (north edge high, south low)
    g.userData.decks = [{ x: 0, z: (Z0 + Z1) / 2, hw: (X1 - X0) / 2 - 0.6, hd: (Z1 - Z0) / 2 - 0.5, top: tY(Z0 + 0.5), top1: tY(Z1 - 0.5) }];
    return g;
  }

  // ---------------------------------------------------------------------------
  // THE HIRAM M. CHITTENDEN LOCKS (Ballard Locks, USACE 1917). The channel runs
  // east-west and the works are stacked across it, north to south: the small
  // lock (46 x 9 m = 150 x 30 ft), a centre wall, the large lock (251 x 24.4 m
  // = 825 x 80 ft, split by an intermediate gate), a south wall carrying the
  // control tower, then the spillway dam (235 ft = 72 m, six gates) running on
  // south to the fish ladder. The OSM buildings fix the stack: the Control
  // Tower stands at z -6020 on the large lock's south wall, Operating House 2
  // on the centre wall at the intermediate gate, the Administration Building
  // by the small lock, the dam at the "Locks and Dam" node (-4468, -5989), the
  // fish ladder at -5928. The 10 m water mask carries the chambers (the
  // intermediate gate sits where the canal's fresh water, 5.3 m, meets the
  // Sound's, at x ~ -4410), so what is drawn is the walls, gates and dam.
  // Wall tops are at 6.7 m (est.), a step down from the 7.2 m bank.
  function locks() {
    const g = new THREE.Group();
    g.userData.worldAligned = true;
    const TOP = -0.5, BOT = -13;
    const conc = P(0xb9b6ae, 0.9, 0, 0.5), concD = P(0x8d8a82, 0.92, 0, 0.45);
    const steel = P(0x3e4f5a, 0.55, 0.5, 0.7), steelL = P(0xa9b1b5, 0.45, 0.6, 0.75);
    const rail = P(0x2f3438, 0.5, 0.5, 0.6);
    const decks = [];
    const wallRect = (x0, x1, z0, z1, deck = true) => {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
      g.add(box(w, TOP - BOT - 0.4, d, concD, cx, BOT, cz));
      g.add(box(w, 0.4, d, conc, cx, TOP - 0.4, cz));
      // the solid stops at the wall's top less 0.3 m: a walker standing on the deck is above it, and
      // one stepping up from the bank (0.5 m) is not blocked, but a boat or swimmer at the water is
      solidBox(g, cx, cz, w / 2, d / 2, 0, TOP - 0.3, BOT);
      if (deck) decks.push({ x: cx, z: cz, hw: w / 2, hd: d / 2, top: TOP });
    };
    // a guard rail along a water edge: two bars and a post every 10 m, and a solid walkers cannot cross
    const railRun = (x0, x1, z) => {
      const L = x1 - x0, cx = (x0 + x1) / 2;
      g.add(box(L, 0.07, 0.07, rail, cx, TOP + 1.05, z));
      g.add(box(L, 0.05, 0.05, rail, cx, TOP + 0.5, z));
      for (let x = x0; x <= x1 + 0.1; x += 10) g.add(box(0.08, 1.1, 0.08, rail, x, TOP, z));
      solidBox(g, cx, z, L / 2, 0.15, 0, TOP + 1.1, TOP - 0.2);
    };
    const XW = -123, XE = 123;
    // the large lock's three walls, the small lock's two
    wallRect(XW, XE, 49.5, 60);                 // the centre wall
    wallRect(XW, XE, 84.4, 96);                 // the south wall
    wallRect(-73, -27, 28, 40.4);                // the small lock's north wall (the bank meets it)
    // the small lock shares the centre wall; it needs its own south side: the centre wall IS it
    // bollards and lamp posts along both edges of each wall
    const bol = P(0x2c2f31, 0.6, 0.4, 0.5);
    for (let x = XW + 8; x < XE; x += 16) {
      for (const z of [60.5, 83.9]) g.add(cyl(0.28, 0.35, 0.55, bol, x, TOP, z, 6));
      if (x % 32 === (XW + 8) % 32) for (const z of [57, 90]) {
        g.add(cyl(0.09, 0.1, 5.2, rail, x, TOP, z, 6));
        g.add(box(0.8, 0.18, 0.3, P(0xe9e3c8, 0.5, 0, 0.8), x, TOP + 5.2, z));
      }
    }
    railRun(XW, XE, 50.0); railRun(XW, XE, 59.5);         // the centre wall's two edges
    railRun(XW, XE, 84.9); railRun(XW, XE, 95.5);          // the south wall's: the lock and the dam's side
    railRun(-73, -27, 39.9);                                // the small lock's north wall, on the water
    // gates: a pair of leaves meeting in a V that points east (toward the high water)
    const gate = (xg, z0, z1, hh, leafLen) => {
      const zm = (z0 + z1) / 2, apex = 3.4;
      for (const [zw, sd] of [[z0, 1], [z1, -1]]) {
        const ax = xg, az = zw, bx = xg + apex, bz = zm;
        const L = Math.hypot(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2;
        const ry = Math.atan2(-(bz - az), bx - ax);
        g.add(box(L, hh, 1.5, steel, cx, TOP - hh + 0.9, cz, ry));
        g.add(box(L, 0.35, 1.9, steelL, cx, TOP + 0.9, cz, ry));            // the catwalk on top
        g.add(box(L, 0.1, 0.1, rail, cx, TOP + 1.9, cz + (sd > 0 ? -0.1 : 0.1), ry));
      }
    };
    for (const xg of [XW + 2, 7, XE - 6]) gate(xg, 60, 84.4, 13, 14);
    gate(-73 + 1, 40.4, 49.5, 9, 6);
    gate(-27 - 3, 40.4, 49.5, 9, 6);
    // the guide wall that runs out from the north wall's west end, and the small lock's approach
    wallRect(XW - 40, XW, 49.5, 56, false);
    // THE SPILLWAY DAM: seven piers and six Tainter gates down x = -50.6 (local), from the south wall to the fish ladder
    {
      const DX = -50.6, Z0 = 96, Z1 = 167, N = 6, bay = (Z1 - Z0) / N;
      g.add(box(13, 1.0, Z1 - Z0 + 3, conc, DX, TOP - 1.0, (Z0 + Z1) / 2 + 1.5));     // the roadway deck
      g.add(box(13, 12.5, Z1 - Z0 + 3, concD, DX, BOT, (Z0 + Z1) / 2 + 1.5));
      decks.push({ x: DX, z: (Z0 + Z1) / 2 + 1.5, hw: 6.5, hd: (Z1 - Z0 + 3) / 2, top: TOP });
      solidBox(g, DX, (Z0 + Z1) / 2 + 1.5, 6.5, (Z1 - Z0 + 3) / 2, 0, TOP - 0.3, BOT);
      for (let k = 0; k <= N; k++) {
        const z = Z0 + k * bay;
        g.add(box(13, 5.5, 2.6, conc, DX, TOP, z));                                  // pier up to the hoist deck
        g.add(box(4, 3.2, 2.6, concD, DX + 3, TOP + 5.5, z));                         // a hoist house per pier
      }
      for (let k = 0; k < N; k++) {
        const z = Z0 + (k + 0.5) * bay;
        // a Tainter gate: a curved steel face lowered between the piers, arms behind it
        let prev = null;
        for (let a = 0; a <= 6; a++) {
          const t = -0.55 + (a / 6) * 1.1, p = V3(DX - 6.5 + Math.cos(t) * 5.5 - 5.5 * 0.85, TOP - 0.5 + Math.sin(t) * 5.5, z);
          if (prev) g.add(beam(prev, p, bay - 3.0, 0.28, steel));
          prev = p;
        }
        for (const sd of [-1, 1]) g.add(beam(V3(DX - 1, TOP + 0.5, z + sd * (bay / 2 - 1.5)), V3(DX - 8.5, TOP - 2.2, z + sd * (bay / 2 - 1.5)), 0.35, 0.35, steelL));
      }
      // the fish ladder: stepped pools running east from the dam's south end
      for (let k = 0; k < 14; k++) {
        g.add(box(3.4, 0.6, 7, conc, DX + 6.5 + 1.7 + k * 3.4, TOP - 0.5 + k * 0.05 - 0.4, Z1 + 5));
        g.add(box(0.4, 1.2, 7.4, concD, DX + 6.5 + k * 3.4, TOP - 0.4, Z1 + 5));
      }
    }
    // the buildings the OSM plan puts on the works (buildLandmarks clears them: they would stand in the water)
    {
      const brick = M(0x9b5b45), roofC = P(0x5b4a40, 0.8, 0, 0.5), win = P(0x2f4650, 0.15, 0.5, 0.9);
      const cream = P(0xd8d0bd, 0.85, 0, 0.55);
      // the Administration Building: two storeys of brick under a hip roof
      g.add(box(24, 7.5, 21, brick, -11.6, TOP - 0.5 - 7 + 7.2, 35.5));
      for (let k = 0; k < 6; k++) for (const [fz, fx] of [[46.05, 0], [24.95, 0]]) g.add(box(2.0, 1.6, 0.12, win, -21 + k * 3.6, 3.2, fz));
      const hip = new THREE.Mesh(new THREE.ConeGeometry(17.2, 4.2, 4), roofC);
      hip.rotation.y = Math.PI / 4; hip.scale.set(1.0, 1, 0.9);
      hip.position.set(-11.6, 6.7 + 2.1, 35.5);
      g.add(hip);
      // the Control Tower: four storeys and a glazed cab, on the south wall
      g.add(box(9, 15, 9, cream, -24, TOP, 90.5));
      g.add(box(10.2, 3.4, 10.2, win, -24, TOP + 15, 90.5));
      g.add(box(11.2, 0.6, 11.2, roofC, -24, TOP + 18.4, 90.5));
      for (let k = 0; k < 3; k++) for (const sd of [-1, 1]) g.add(box(0.12, 1.5, 6, win, -24 + sd * 4.55, TOP + 2.5 + k * 4, 90.5));
      // Operating House 2, on the centre wall at the intermediate gate
      g.add(box(7, 4.6, 6, cream, 3.9, TOP, 56));
      g.add(box(7.8, 0.5, 6.8, roofC, 3.9, TOP + 4.6, 56));
    }
    g.userData.decks = decks;
    return g;
  }

  return { convention, library, aquarium, ferryTerminal, kerryPark, locks };
}

function V3(x, y, z) { return new THREE.Vector3(x, y, z); }
