// A GREEN SEATTLE: the city's trees -- where they stand and how they are drawn.
//
// Seattle is ~28 % tree canopy, and it read from the air and the street as a
// treeless grey-brown grid: ~47 trees a chunk, every one full merged geometry
// (~300 vertices), so a forest could not be afforded and Discovery Park was a
// golf course. Now a tree is a RECORD (position, height, crown, species,
// colour) and it is drawn at three levels of detail, each enclosing the one
// below it, so nothing has to be swapped and nothing pops out:
//
//   far    every tree of every streamed chunk (near AND mid ring), merged into
//          the chunk's flat mesh as a crown of 6-15 triangles: 0 draw calls,
//          culled with its chunk. What a tree is from 250 m to 1.8 km.
//   mid    trees within R1 (300 m; 220 on a phone) and in view: one
//          InstancedMesh per species, ~35-60 triangles a crown.
//   near   trees within R2 (95 m; 70) and in view: the detailed crowns --
//          lobed broadleaf, layered fir -- one InstancedMesh per species.
//
// The mid and near sets are chosen on the CPU from the records (by 50 m cell
// against the camera's frustum, then by distance) whenever the camera has
// moved STEP metres or turned TURN degrees, so the GPU draws only trees in
// front of the camera and the CPU pays nothing on a frame that does neither.
// Four draw calls in all, whatever the tree count.
//
// Where they stand (`plantTrees`, called per chunk by the streamer):
//
//   forest   surface.png's woodland (tools/build_wood.py), a jittered 9 m grid,
//            tall Douglas fir and bigleaf maple in stands
//   park     the rest of the green mask, groves and open lawn by a noise field
//   street   both kerbs of residential, minor and arterial streets every
//            11-13 m: past the pavement on a residential street, in a grate on
//            the pavement where buildings meet it
//   yard     round every house, ~1.3 a house, a third of them conifers
//
// Each one deterministic by hash and kept off roads, pavements, lots, water,
// pits, jumps, playgrounds and buildings, like the old park scatter.
import * as THREE from './three.js';
import * as G from './geo.js';
import { CHUNK, WALK_LIFT, VERGE, cityStats } from './citygen.js';
import { hash2, clamp, lerp } from './util.js';

const ON_PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export const CONIFER = 0, BROAD = 1, COLUMNAR = 2, SHRUB = 3;
const T_STREET = 0, T_PARK = 1, T_FOREST = 2;
// One record: x, ground y, z, height, crown radius, kind, seed (0..1), tone,
// and the trunk's index in its chunk's obstacle list (-1: none).
export const REC = 9;

// The reference shapes the instanced geometry is built at, in metres; an
// instance is scaled (cr / CR, th / TH, cr / CR). A broadleaf crown is an
// ellipsoid centred at B_CY of the height with half-height B_RY of it; a
// conifer's skirts run from C_BASE of the height to the top.
const B_TH = 12, B_CR = 4.5, B_CY = 0.55, B_RY = 0.41;
const C_TH = 20, C_CR = 4, C_BASE = 0.12;

// Toward the sun: main.js SUN_OFFSET (-215, 200, -150), normalised.
const SUN = (() => { const l = Math.hypot(215, 200, 150); return [-215 / l, 200 / l, -150 / l]; })();
const BARK = [0.25, 0.21, 0.17];

const frac = (v) => v - Math.floor(v);
const sub = (seed, k) => hash2(Math.floor(seed * 16777216), k * 7919 + 13);

/**
 * Sunlit foliage is a different COLOUR from shaded foliage, not just darker:
 * the outer leaves the sun reaches go yellow-green. The key light alone cannot
 * say that, so the far crowns bake it per vertex and the instanced ones take
 * it in the vertex shader from the turned normal (LEAF_LIGHT below) -- the
 * same formula, so a tree does not change hue as its level of detail does.
 */
function leafLight(nx, ny, nz, out) {
  const s = clamp(0.5 + 0.5 * (nx * SUN[0] + ny * SUN[1] + nz * SUN[2]), 0, 1);
  const t = s * s;
  out[0] = 0.9 + 0.26 * t; out[1] = 0.93 + 0.18 * t; out[2] = 1.0 - 0.05 * t;
  return out;
}
const LEAF_LIGHT = `
  float leafS = clamp( 0.5 + 0.5 * dot( leafN, vec3( ${SUN[0].toFixed(5)}, ${SUN[1].toFixed(5)}, ${SUN[2].toFixed(5)} ) ), 0.0, 1.0 );
  leafS *= leafS;
  vec3 leafLit = vec3( 0.9 + 0.26 * leafS, 0.93 + 0.18 * leafS, 1.0 - 0.05 * leafS );`;

/**
 * A tree's foliage albedo (linear). Value does most of the work, as with the
 * buildings; hue drifts between individuals and a few street trees are the
 * purple-leaf plums and copper beeches Seattle plants. A conifer is not a
 * green tree, it is a DARK one -- deep fir green, cooler than any broadleaf --
 * and a forest's crowns shade each other, so they sit darker again.
 */
export function treeAlbedo(kind, seed, tone, out) {
  const a = sub(seed, 1), b = sub(seed, 2);
  const v = 0.8 + a * 0.42;
  let r, g, bl;
  if (kind === CONIFER) {
    if (b < 0.3) { r = 0.1; g = 0.232; bl = 0.088; }      // cedar: a touch yellower
    else { r = 0.082; g = 0.205; bl = 0.098; }             // Douglas fir, hemlock
  } else if (tone === T_STREET && b < 0.03) { r = 0.16; g = 0.095; bl = 0.095; }
  else if (b < 0.12 && tone !== T_FOREST) { r = 0.155; g = 0.26; bl = 0.09; }   // birch, locust: yellow-green
  else if (b > 0.9) { r = 0.11; g = 0.235; bl = 0.13; }   // blue-green
  else { const w = (a - 0.5) * 0.05; r = 0.135 + w; g = 0.255 + b * 0.04; bl = 0.105 - w * 0.5; }
  const f = (tone === T_FOREST ? 0.86 : 1) * (kind === SHRUB ? 0.88 : 1);
  out[0] = r * v * f; out[1] = g * v * f; out[2] = bl * v * f;
  return out;
}

// --- the far crowns: merged into the chunk's flat mesh --------------------

const _l = [0, 0, 0], _al = [0, 0, 0];
// A face whose winding is fixed against the corners' intended normal, as
// Builder.tri does: wound wrong, a crown is back-face culled.
function face(fb, i0, i1, i2) {
  const P = fb.P, N = fb.N;
  const a = i0 * 3, b = i1 * 3, c = i2 * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
  const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const mx = N[a] + N[b] + N[c], my = N[a + 1] + N[b + 1] + N[c + 1], mz = N[a + 2] + N[b + 2] + N[c + 2];
  if (nx * mx + ny * my + nz * mz < 0) fb.face3(i0, i2, i1); else fb.face3(i0, i1, i2);
}
function leafVert(fb, x, y, z, nx, ny, nz, ao) {
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  leafLight(nx, ny, nz, _l);
  return fb.vert(x, y, z, nx, ny, nz, 0, 0, _al[0] * ao * _l[0], _al[1] * ao * _l[1], _al[2] * ao * _l[2]);
}

/**
 * One tree's far crown, in world space, into `fb` (a ChunkBuilder). Built
 * INSIDE the instanced crowns (0.82 of the crown radius), so where those draw
 * they hide it. Broadleaf: a six-sided bipyramid round the crown's middle and
 * a three-sided trunk (15 triangles). Conifer: a six-sided cone (9).
 */
export function writeFarTree(fb, x, gy, z, th, cr, kind, seed, tone) {
  treeAlbedo(kind, seed, tone, _al);
  const a0 = seed * 6.2832;
  const bark = (s) => [BARK[0] * s, BARK[1] * s, BARK[2] * s];
  let trunkTop, trunkR;
  if (kind === CONIFER) {
    const y0 = gy + C_BASE * th, R = 0.8 * cr, top = gy + th;
    const slope = R / (top - y0);
    const apex = leafVert(fb, x, top, z, 0, 1, 0, 1.08);
    const ring = [];
    for (let k = 0; k < 6; k++) {
      const a = a0 + (k * Math.PI) / 3, c = Math.cos(a), s = Math.sin(a);
      ring.push(leafVert(fb, x + c * R, y0, z + s * R, c, slope * 1.4, s, 0.6));
    }
    for (let k = 0; k < 6; k++) face(fb, ring[k], apex, ring[(k + 1) % 6]);
    trunkTop = y0 + (top - y0) * 0.3; trunkR = Math.max(0.16, 0.09 * cr);
  } else {
    const cy = gy + B_CY * th, ry = B_RY * th, R = 0.78 * cr;
    const top = leafVert(fb, x, cy + 0.92 * ry, z, 0, 1, 0, 1.06);
    const bot = leafVert(fb, x, cy - 0.8 * ry, z, 0, -1, 0, 0.5);
    const ring = [];
    for (let k = 0; k < 6; k++) {
      const a = a0 + (k * Math.PI) / 3, c = Math.cos(a), s = Math.sin(a);
      ring.push(leafVert(fb, x + c * R, cy + 0.1 * ry, z + s * R, c, 0.3, s, 0.86));
    }
    for (let k = 0; k < 6; k++) {
      face(fb, ring[k], top, ring[(k + 1) % 6]);
      face(fb, ring[(k + 1) % 6], bot, ring[k]);
    }
    trunkTop = cy; trunkR = Math.max(0.13, 0.062 * cr * (kind === COLUMNAR ? 1.4 : 1));
    if (kind === SHRUB) return 12;
  }
  // a three-sided spike from below the ground into the crown
  const bc = bark(0.8), ap = fb.vert(x, trunkTop, z, 0, 1, 0, 0, 0, bc[0], bc[1], bc[2]);
  const base = [];
  for (let k = 0; k < 3; k++) {
    const a = a0 + (k * 2 * Math.PI) / 3, c = Math.cos(a), s = Math.sin(a);
    base.push(fb.vert(x + c * trunkR, gy - 0.3, z + s * trunkR, c, 0, s, 0, 0, bc[0], bc[1], bc[2]));
  }
  for (let k = 0; k < 3; k++) face(fb, base[k], ap, base[(k + 1) % 3]);
  return kind === CONIFER ? 9 : 15;
}

// --- the instanced crowns: geometry built once ---------------------------

/** An indexed builder: shared vertices, smooth normals, colour and a leaf flag. */
class IB {
  constructor() { this.p = []; this.n = []; this.c = []; this.f = []; this.i = []; }
  v(x, y, z, nx, ny, nz, col, leaf) {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.p.push(x, y, z); this.n.push(nx / l, ny / l, nz / l); this.c.push(col[0], col[1], col[2]); this.f.push(leaf);
    return this.p.length / 3 - 1;
  }
  t(a, b, c) {
    const P = this.p, N = this.n;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = N[a * 3] + N[b * 3] + N[c * 3], my = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], mz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (nx * mx + ny * my + nz * mz < 0) this.i.push(a, c, b); else this.i.push(a, b, c);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('leaf', new THREE.Float32BufferAttribute(this.f, 1));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
  get tris() { return this.i.length / 3; }
}

/**
 * A foliage lathe: an ellipsoid of `sides` x `stacks` with shared, smooth
 * normals bent toward the whole crown's centre `fc` (by `bend`), so a lobe
 * keeps a little of its own roundness but the tree shades as one mass (see
 * Builder.foliage); value darkened toward the lobe's underside (`shade`) and
 * mottled per corner, which interpolates into clumps of leaves.
 */
function lobe(ib, cx, cy, cz, rx, ry, sides, stacks, seed, shade, fc, bend, jit = 0.1, lumps = 0, flat = 0) {
  const ring = [];
  const nrm = (px, py, pz, lx, ly, lz) => {
    let gx = px - fc[0], gy = py - fc[1], gz = pz - fc[2];
    const gl = Math.hypot(gx, gy, gz) || 1;
    gx /= gl; gy /= gl; gz /= gl;
    const ll = Math.hypot(lx, ly, lz) || 1;
    return [lx / ll + (gx - lx / ll) * bend, ly / ll + (gy - ly / ll) * bend + 0.12, lz / ll + (gz - lz / ll) * bend];
  };
  const col = (t, k) => {
    const m = (1 - shade * Math.pow(1 - t, 1.5)) * (0.86 + 0.28 * hash2(seed * 131 + k * 17, 7));
    return [m, m, m];
  };
  const ryB = ry * (1 - flat * 0.45);
  const bot = (() => { const n = nrm(cx, cy - ryB, cz, 0, -1, 0); return ib.v(cx, cy - ryB, cz, n[0], n[1], n[2], col(0, 0), 1); })();
  const top = (() => { const n = nrm(cx, cy + ry, cz, 0, 1, 0); return ib.v(cx, cy + ry, cz, n[0], n[1], n[2], col(1, 1), 1); })();
  for (let s = 1; s < stacks; s++) {
    const lat = -Math.PI / 2 + (Math.PI * s) / stacks, cl = Math.cos(lat), sl = Math.sin(lat);
    const r = [];
    for (let k = 0; k < sides; k++) {
      const a = ((k + (s % 2) * 0.5) * 2 * Math.PI) / sides + seed;
      // per-corner jitter, and a few broad bumps round the crown
      const w = 1 + (hash2(seed * 977 + s * 31 + k, 3) - 0.5) * 2 * jit
        + lumps * Math.sin(3 * a + seed * 5) * Math.cos(lat * 1.5) + lumps * 0.6 * Math.sin(2 * a - seed * 3 + lat * 2);
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = cx + ca * cl * rx * w, py = cy + sl * (sl < 0 ? ryB : ry) * w, pz = cz + sa * cl * rx * w;
      const n = nrm(px, py, pz, (ca * cl) / rx, sl / ry, (sa * cl) / rx);
      r.push(ib.v(px, py, pz, n[0], n[1], n[2], col(s / stacks, s * 13 + k), 1));
    }
    ring.push(r);
  }
  const S = sides;
  for (let k = 0; k < S; k++) ib.t(bot, ring[0][(k + 1) % S], ring[0][k]);
  for (let s = 0; s < ring.length - 1; s++) {
    const A = ring[s], B = ring[s + 1];
    // the rings are staggered half a step, so each band is a strip of triangles
    for (let k = 0; k < S; k++) {
      ib.t(A[k], A[(k + 1) % S], B[k]);
      ib.t(A[(k + 1) % S], B[(k + 1) % S], B[k]);
    }
  }
  const L = ring[ring.length - 1];
  for (let k = 0; k < S; k++) ib.t(L[k], L[(k + 1) % S], top);
}

/** A tapered, open-ended limb from p0 (radius r0) to p1 (r1): bark, not leaf. */
function limb(ib, p0, p1, r0, r1, sides, shade = 1) {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const al = Math.hypot(ax, ay, az);
  const dx = ax / al, dy = ay / al, dz = az / al;
  // any perpendicular pair
  let ux = -dz, uy = 0, uz = dx;
  if (Math.hypot(ux, uz) < 1e-3) { ux = 1; uy = 0; uz = 0; }
  let ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  const lo = [], hi = [];
  for (let k = 0; k < sides; k++) {
    const a = (k * 2 * Math.PI) / sides, c = Math.cos(a), s = Math.sin(a);
    const nx = ux * c + vx * s, ny = uy * c + vy * s, nz = uz * c + vz * s;
    const c0 = [BARK[0] * 0.8 * shade, BARK[1] * 0.8 * shade, BARK[2] * 0.8 * shade];
    const c1 = [BARK[0] * shade, BARK[1] * shade, BARK[2] * shade];
    lo.push(ib.v(p0[0] + nx * r0, p0[1] + ny * r0, p0[2] + nz * r0, nx, ny, nz, c0, 0));
    hi.push(ib.v(p1[0] + nx * r1, p1[1] + ny * r1, p1[2] + nz * r1, nx, ny, nz, c1, 0));
  }
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    ib.t(lo[k], lo[k1], hi[k]);
    ib.t(lo[k1], hi[k1], hi[k]);
  }
}

/**
 * A conifer skirt: a ring of `sides` branch tips alternating long and short
 * (and the long ones drooping), an apex above, and an underside to a point
 * just above the ring -- the dark under-branches you see from below.
 */
function skirt(ib, y, r, h, sides, seed, aoTip, aoRim, under) {
  const tips = [];
  const apex = ib.v(0, y + h, 0, 0, 1, 0, [aoTip, aoTip, aoTip], 1);
  for (let k = 0; k < sides; k++) {
    const a = (k * 2 * Math.PI) / sides + seed;
    const long = k % 2 === 0;
    const rr = r * (long ? 1 : 0.74) * (0.92 + 0.16 * hash2(seed * 991 + k, 5));
    const yy = y - (long ? 0.06 * h : 0);
    const c = Math.cos(a), s = Math.sin(a);
    const m = aoRim * (0.86 + 0.28 * hash2(seed * 313 + k, 9));
    tips.push(ib.v(c * rr, yy, s * rr, c, (r / h) * 1.2, s, [m, m, m], 1));
  }
  for (let k = 0; k < sides; k++) ib.t(tips[k], apex, tips[(k + 1) % sides]);
  if (under) {
    const u = ib.v(0, y + h * 0.18, 0, 0, -1, 0, [aoRim * 0.55, aoRim * 0.55, aoRim * 0.55], 1);
    for (let k = 0; k < sides; k++) ib.t(tips[(k + 1) % sides], u, tips[k]);
  }
}

/**
 * The instanced shapes, in reference metres (B_TH x B_CR, C_TH x C_CR).
 * The mid broadleaf contains the far bipyramid (min radius 0.95 of the crown
 * against the bipyramid's 0.82); the near one's core is 0.86 with lobes past
 * 1.0, so each level holds the one below it.
 */
function buildShapes() {
  const CY = B_CY * B_TH, RY = B_RY * B_TH, R = B_CR;
  const out = {};
  // mid broadleaf: the near crown's idea at a third of the cost -- a core and
  // five clumps over it (a single smooth shell read as a cotton ball from
  // the air), and a five-sided trunk: ~134 tris
  {
    const ib = new IB();
    const fc = [0, CY + RY * 0.1, 0];
    lobe(ib, 0, CY, 0, R * 0.82, RY * 0.84, 6, 3, 0.37, 0.32, fc, 0.35, 0.06, 0.05, 0.4);
    for (let k = 0; k < 5; k++) {
      const t = (k + 0.5) / 5, yN = 1 - t * 1.45, rN = Math.sqrt(Math.max(0, 1 - yN * yN));
      const a = k * 2.39996 + 1.1, c = Math.cos(a), s = Math.sin(a);
      const lr = R * (0.44 + 0.06 * hash2(k, 91));
      lobe(ib, c * rN * R * 0.6, CY + yN * RY * 0.62, s * rN * R * 0.6, lr, lr * (RY / R) * 1.08, 5, 3, 3.3 + k, 0.3, fc, 0.6, 0.1);
    }
    limb(ib, [0, -0.3, 0], [0, CY, 0], 0.06 * R, 0.036 * R, 5);
    out.midBroad = ib;
  }
  // mid conifer: three skirts and a trunk -- 34 tris
  {
    const ib = new IB();
    const H = C_TH, Rc = C_CR;
    skirt(ib, C_BASE * H, Rc * 1.0, 0.44 * H, 8, 0.2, 1.0, 0.62, false);
    skirt(ib, 0.4 * H, Rc * 0.74, 0.4 * H, 8, 1.1, 1.05, 0.7, false);
    skirt(ib, 0.65 * H, Rc * 0.47, 0.35 * H, 8, 2.3, 1.1, 0.78, false);
    limb(ib, [0, -0.3, 0], [0, 0.32 * H, 0], 0.09 * Rc, 0.06 * Rc, 5);
    out.midCon = ib;
  }
  // near broadleaf: a core and twelve clumps spread over its upper surface
  // (a Fibonacci spiral, so no two trees' clumps line up once turned), a
  // trunk and three boughs into the crown -- ~370 tris. The clumps' normals
  // lean hard toward the crown's own, so the tree shades as one mass and
  // each clump shows only as its darker underside.
  {
    const ib = new IB();
    const fc = [0, CY + RY * 0.1, 0];
    lobe(ib, 0, CY, 0, R * 0.8, RY * 0.8, 8, 4, 0.11, 0.3, fc, 0.4, 0.06, 0.05, 0.4);
    const NL = 12;
    for (let k = 0; k < NL; k++) {
      const t = (k + 0.5) / NL, yN = 1 - t * 1.55, rN = Math.sqrt(Math.max(0, 1 - yN * yN));
      const a = k * 2.39996 + 0.4, c = Math.cos(a), s = Math.sin(a);
      const lr = R * (0.36 + 0.09 * hash2(k, 77));
      lobe(ib, c * rN * R * 0.7, CY + yN * RY * 0.68, s * rN * R * 0.7, lr, lr * (RY / R) * 1.08, 6, 3, 1.3 + k, 0.3, fc, 0.62, 0.12);
    }
    limb(ib, [0, -0.3, 0], [0, CY - RY * 0.1, 0], 0.062 * R, 0.04 * R, 6);
    for (let k = 0; k < 3; k++) {
      const a = 0.5 + (k * 2 * Math.PI) / 3, c = Math.cos(a), s = Math.sin(a);
      const y0 = CY - RY * (0.72 - 0.12 * k);
      limb(ib, [0, y0, 0], [c * R * 0.5, y0 + RY * 0.55, s * R * 0.5], 0.03 * R, 0.014 * R, 4, 0.9);
    }
    out.nearBroad = ib;
  }
  // near conifer: seven drooping skirts with undersides, and a trunk -- ~150 tris
  {
    const ib = new IB();
    const H = C_TH, Rc = C_CR;
    const T = 7;
    for (let i = 0; i < T; i++) {
      const t = i / (T - 1);
      const y = (C_BASE + 0.78 * t * 0.92) * H;
      const r = Rc * (1 - t * 0.82);
      const h = (0.24 - t * 0.06) * H * (i === T - 1 ? 1.25 : 1);
      skirt(ib, y, r, h, 10, i * 1.7 + 0.4, 0.95 + 0.15 * t, 0.58 + 0.2 * t, true);
    }
    limb(ib, [0, -0.3, 0], [0, 0.45 * H, 0], 0.1 * Rc, 0.06 * Rc, 6);
    out.nearCon = ib;
  }
  return out;
}

// --- the instanced material -------------------------------------------------

function treeMaterial(timeU) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04, envMapIntensity: 0.45 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.treeTime = timeU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float leaf;\nuniform float treeTime;')
      // A gentle sway, in WORLD space after the instance's turn so every tree
      // leans the same way: the top of a crown moves ~0.3 m, the trunk's foot
      // not at all, each tree on its own phase. Two sines per vertex and one
      // uniform a frame; the shadow pass does not sway (nobody can tell).
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          {
            float ph = dot( instanceMatrix[ 3 ].xz, vec2( 0.071, 0.113 ) );
            float k = clamp( position.y / 18.0, 0.0, 1.0 );
            float sw = sin( treeTime * 1.1 + ph ) * 0.7 + sin( treeTime * 2.3 + ph * 1.7 ) * 0.3;
            mvPosition.xz += vec2( 0.3, 0.17 ) * sw * k * k;
          }
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`)
      // The instance colour is the FOLIAGE albedo: the trunk's vertex colour
      // is its bark and must not take it. Then the sun-side tint (leafLight).
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 leafN = normalize( mat3( instanceMatrix ) * objectNormal );
          #else
            vec3 leafN = normalize( objectNormal );
          #endif
          ${LEAF_LIGHT}
          #ifdef USE_INSTANCING_COLOR
            vColor = color * mix( vec3( 1.0 ), instanceColor * leafLit, leaf );
          #endif
        }`);
  };
  m.customProgramCacheKey = () => 'trees';
  return m;
}

// --- the system -------------------------------------------------------------

const CELL = 50, CELLS = CHUNK / CELL;   // 8 x 8 cells a chunk

export class TreeSystem {
  constructor(scene, shadows) {
    this.R1 = ON_PHONE ? 220 : 300;
    this.R2 = ON_PHONE ? 70 : 95;
    this.STEP = 10;                       // metres moved before a refresh
    this.TURN = Math.cos((9 * Math.PI) / 180);
    const shapes = buildShapes();
    this.tris = { midBroad: shapes.midBroad.tris, midCon: shapes.midCon.tris, nearBroad: shapes.nearBroad.tris, nearCon: shapes.nearCon.tris };
    this.timeU = { value: 0 };
    this.mat = treeMaterial(this.timeU);
    this.group = new THREE.Group();
    this.group.name = 'trees';
    const capMid = ON_PHONE ? 3500 : 7000, capNear = ON_PHONE ? 900 : 1800;
    const make = (ib, cap, name, cast) => {
      const m = new THREE.InstancedMesh(ib.geometry(), this.mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;   // chosen against the frustum on the CPU
      m.castShadow = cast; m.receiveShadow = shadows;
      m.name = name;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      return m;
    };
    // Shadows: the near crowns cast everywhere (the trees you walk under); the
    // mid crowns cast on a desktop. On a phone the flat mesh casts nothing and
    // the city's shadows come from a cache (shadowcache.js) that these, being
    // re-chosen as you move, cannot join -- they are movers, drawn each frame.
    this.mid = [make(shapes.midCon, capMid, 'trees:mid:conifer', shadows && !ON_PHONE), make(shapes.midBroad, capMid, 'trees:mid:broadleaf', shadows && !ON_PHONE)];
    this.near = [make(shapes.nearCon, capNear, 'trees:near:conifer', shadows), make(shapes.nearBroad, capNear, 'trees:near:broadleaf', shadows)];
    scene.add(this.group);
    this.chunks = new Map();
    this.city = null;
    this.dirty = true;
    this.warm = false;
    this.last = { x: 1e9, y: 0, z: 0, fx: 0, fy: 0, fz: 0, fov: 0, aspect: 0 };
    this.refreshes = 0; this.refreshMs = 0;
    this._fr = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._s = new THREE.Sphere();
  }

  /**
   * A chunk's records (from plantTrees), filed by 50 m cell so a refresh
   * visits only the cells near the camera. `ck` is its obstacle-list key, to
   * see the trunks a tank has felled.
   */
  setChunk(key, cx, cz, recs, ck) {
    if (!recs || !recs.length) { this.chunks.delete(key); this.dirty = true; return; }
    const n = recs.length / REC, x0 = cx * CHUNK, z0 = cz * CHUNK;
    const cellOf = new Uint8Array(n), cnt = new Int32Array(CELLS * CELLS + 1);
    for (let i = 0; i < n; i++) {
      const ci = clamp(Math.floor((recs[i * REC] - x0) / CELL), 0, CELLS - 1);
      const cj = clamp(Math.floor((recs[i * REC + 2] - z0) / CELL), 0, CELLS - 1);
      cellOf[i] = cj * CELLS + ci;
      cnt[cellOf[i] + 1]++;
    }
    for (let c = 0; c < CELLS * CELLS; c++) cnt[c + 1] += cnt[c];
    const off = cnt.slice(), at = cnt.slice(0, CELLS * CELLS);
    const ord = new Float32Array(recs.length), alb = new Float32Array(n * 3);
    const yLo = new Float32Array(CELLS * CELLS).fill(1e9), yHi = new Float32Array(CELLS * CELLS).fill(-1e9);
    const a3 = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const c = cellOf[i], j = at[c]++;
      ord.set(recs.subarray(i * REC, i * REC + REC), j * REC);
      treeAlbedo(recs[i * REC + 5], recs[i * REC + 6], recs[i * REC + 7], a3);
      alb[j * 3] = a3[0]; alb[j * 3 + 1] = a3[1]; alb[j * 3 + 2] = a3[2];
      const gy = recs[i * REC + 1], top = gy + recs[i * REC + 3];
      if (gy < yLo[c]) yLo[c] = gy;
      if (top > yHi[c]) yHi[c] = top;
    }
    this.chunks.set(key, { cx, cz, x0, z0, ord, alb, off, yLo, yHi, ck, n });
    this.dirty = true;
  }

  dropChunk(key) {
    if (this.chunks.delete(key)) this.dirty = true;
  }

  /** Something changed that a refresh must see (a felled trunk). */
  invalidate() { this.dirty = true; }

  /**
   * Choose the mid and near sets for this camera, if it has moved or turned
   * enough since the last time. Call before the scene pass.
   */
  update(camera) {
    this.timeU.value = (performance.now() / 1000) % 10000;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14], fx = -e[8], fy = -e[9], fz = -e[10];
    const L = this.last;
    const moved = (px - L.x) ** 2 + (py - L.y) ** 2 + (pz - L.z) ** 2 > this.STEP * this.STEP;
    const turned = fx * L.fx + fy * L.fy + fz * L.fz < this.TURN;
    if (!this.dirty && !moved && !turned && camera.fov === L.fov && camera.aspect === L.aspect && !this.warm) return;
    const t0 = performance.now();
    L.x = px; L.y = py; L.z = pz; L.fx = fx; L.fy = fy; L.fz = fz; L.fov = camera.fov; L.aspect = camera.aspect;
    this.dirty = false;
    const fr = this._fr, sph = this._s;
    fr.setFromProjectionMatrix(this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const R1 = this.R1, R2 = this.R2, R1q = R1 * R1, R2q = R2 * R2;
    const nMid = [0, 0], nNear = [0, 0];
    const mid = this.mid, near = this.near;
    const capMid = mid[0].instanceMatrix.count, capNear = near[0].instanceMatrix.count;
    const obs = this.city ? this.city.obstacles : null;
    for (const C of this.chunks.values()) {
      // the chunk's square against the R1 disc
      const qx = clamp(px, C.x0, C.x0 + CHUNK) - px, qz = clamp(pz, C.z0, C.z0 + CHUNK) - pz;
      if (qx * qx + qz * qz > R1q) continue;
      const ol = obs && C.ck !== undefined ? obs.get(C.ck) : null;
      for (let c = 0; c < CELLS * CELLS; c++) {
        const i0 = C.off[c], i1 = C.off[c + 1];
        if (i0 === i1) continue;
        const ccx = C.x0 + ((c % CELLS) + 0.5) * CELL, ccz = C.z0 + (Math.floor(c / CELLS) + 0.5) * CELL;
        const dh = Math.hypot(ccx - px, ccz - pz);
        if (dh - CELL * 0.71 > R1) continue;
        // In view, or near enough that its shadow can fall into view. The
        // sphere is grown by how far the frustum may turn or slide before the
        // next refresh, so nothing at the edge is missing in between.
        if (dh > 70) {
          const ym = (C.yLo[c] + C.yHi[c]) / 2;
          sph.center.set(ccx, ym, ccz);
          sph.radius = Math.hypot(CELL * 0.71, (C.yHi[c] - C.yLo[c]) / 2) + this.STEP + 0.17 * dh;
          if (!fr.intersectsSphere(sph)) continue;
        }
        const ord = C.ord, alb = C.alb;
        for (let i = i0; i < i1; i++) {
          const o = i * REC;
          const x = ord[o], gy = ord[o + 1], z = ord[o + 2], th = ord[o + 3];
          const dx = x - px, dz = z - pz, dy = gy + th * 0.5 - py;
          const d2 = dx * dx + dz * dz + dy * dy;
          if (d2 > R1q) continue;
          const ob = ord[o + 8];
          if (ob >= 0 && ol && ol[ob * 3] > 1e8) continue;   // felled by the tank
          const kind = ord[o + 5], con = kind === CONIFER ? 0 : 1;
          let M, k;
          if (d2 < R2q) { M = near[con]; k = nNear[con]; if (k >= capNear) continue; nNear[con] = k + 1; }
          else { M = mid[con]; k = nMid[con]; if (k >= capMid) continue; nMid[con] = k + 1; }
          const cr = ord[o + 4], seed = ord[o + 6];
          // a crown is a little elliptical, each its own way -- never
          // narrower than the far crown it has to hide
          const s0 = con ? cr / B_CR : cr / C_CR, sy = con ? th / B_TH : th / C_TH;
          const sx = s0 * (1 + 0.14 * frac(seed * 97.3)), sz = s0 * (1 + 0.14 * frac(seed * 61.7));
          const a = seed * 43.98, cs = Math.cos(a), sn = Math.sin(a);
          const m = M.instanceMatrix.array, q = k * 16;
          m[q] = cs * sx; m[q + 1] = 0; m[q + 2] = -sn * sx; m[q + 3] = 0;
          m[q + 4] = 0; m[q + 5] = sy; m[q + 6] = 0; m[q + 7] = 0;
          m[q + 8] = sn * sz; m[q + 9] = 0; m[q + 10] = cs * sz; m[q + 11] = 0;
          m[q + 12] = x; m[q + 13] = gy; m[q + 14] = z; m[q + 15] = 1;
          const ca = M.instanceColor.array, k3 = k * 3;
          ca[k3] = alb[i * 3]; ca[k3 + 1] = alb[i * 3 + 1]; ca[k3 + 2] = alb[i * 3 + 2];
        }
      }
    }
    const done = (M, n) => {
      // behind the loading screen, draw at least one (degenerate) instance so
      // the program compiles there and not mid-play (see "Hitches")
      if (this.warm && n === 0) { M.instanceMatrix.array.fill(0, 0, 16); n = 1; }
      M.count = n;
      M.visible = n > 0;   // an empty tier is not a draw
      M.instanceMatrix.clearUpdateRanges(); M.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16); M.instanceMatrix.needsUpdate = true;
      M.instanceColor.clearUpdateRanges(); M.instanceColor.addUpdateRange(0, Math.max(1, n) * 3); M.instanceColor.needsUpdate = true;
    };
    done(mid[0], nMid[0]); done(mid[1], nMid[1]); done(near[0], nNear[0]); done(near[1], nNear[1]);
    this.refreshes++;
    this.refreshMs = performance.now() - t0;
  }

  /** Counts for tools: records held, instances drawn, triangles. */
  stats() {
    let recs = 0;
    for (const C of this.chunks.values()) recs += C.n;
    const [mc, mb] = this.mid, [nc, nb] = this.near;
    const t = this.tris;
    return {
      chunks: this.chunks.size, trees: recs,
      mid: mc.count + mb.count, near: nc.count + nb.count,
      instTris: mc.count * t.midCon + mb.count * t.midBroad + nc.count * t.nearCon + nb.count * t.nearBroad,
      shapeTris: t, refreshes: this.refreshes, refreshMs: +this.refreshMs.toFixed(2),
    };
  }
}

// --- planting ---------------------------------------------------------------

// A smooth 0..1 field at `s` metres (value noise on a hashed lattice).
function field(x, z, s, k) {
  const fx = x / s, fz = z / s, i0 = Math.floor(fx), j0 = Math.floor(fz);
  const tx = fx - i0, tz = fz - j0;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash2(i0 + k, j0), b = hash2(i0 + 1 + k, j0), c = hash2(i0 + k, j0 + 1), d = hash2(i0 + 1 + k, j0 + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

/** The chunk's playgrounds as [x, z, clear radius], as meshParkFurniture sizes them. */
function playgroundsOf(cx, cz) {
  const out = [];
  const list = G.PARK_PROPS.get(`${cx},${cz}`);
  if (list) for (const p of list) if (p.k === 'playground') out.push([p.x, p.z, Math.max(5, Math.min(p.r, 14)) + 1.5]);
  return out;
}

const WALK_W = { res: 2.6, st: 2.6, art: 3.2 };
export const NEAR_CAP = 1600, MID_CAP = 650;

// THE CHUNK'S OCCUPANCY, at 2 m: what stands on the ground (buildings, padded
// 1 m) and what is paved (every carriageway with its pavement and verge, and
// each junction's corner). Asking roadLift and inBuilding per candidate was
// most of a chunk's planting -- ~6 and ~5 us a call, ~1600 calls a chunk --
// and a mid-ring chunk's build went from 4 to 12 ms. Rasterised once, every
// candidate is one lookup. Conservative by half a cell's diagonal, so it only
// ever keeps a tree further off than the exact tests would. One buffer,
// reused: chunk builds run one at a time.
const OCC_C = 2, OCC_N = CHUNK / OCC_C, OCC_HALF = OCC_C * 0.7072;
const OCC_BLD = 1, OCC_PAVE = 2;
let OCC = null;
function occupancy(city, cx, cz) {
  if (!OCC) OCC = new Uint8Array(OCC_N * OCC_N);
  OCC.fill(0);
  const x0 = cx * CHUNK, z0 = cz * CHUNK, x1 = x0 + CHUNK, z1 = z0 + CHUNK;
  const seenB = new Set(), seenE = new Set(), nodes = new Map();
  const cells = (ax, az, bx, bz) => [
    Math.max(0, Math.floor((ax - x0) / OCC_C)), Math.min(OCC_N - 1, Math.floor((bx - x0) / OCC_C)),
    Math.max(0, Math.floor((az - z0) / OCC_C)), Math.min(OCC_N - 1, Math.floor((bz - z0) / OCC_C))];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const c = city.chunks.get(city.chunkKey(cx + dx, cz + dz));
    if (!c) continue;
    for (const bi of c.buildings) {
      if (seenB.has(bi)) continue;
      seenB.add(bi);
      const b = city.buildings[bi];
      const hw = b.w / 2 + 1.0 + OCC_HALF, hd = b.d / 2 + 1.0 + OCC_HALF, rr = Math.hypot(hw, hd);
      if (b.x + rr < x0 || b.x - rr > x1 || b.z + rr < z0 || b.z - rr > z1) continue;
      const co = Math.cos(-b.rot), si = Math.sin(-b.rot);
      const [i0, i1, j0, j1] = cells(b.x - rr, b.z - rr, b.x + rr, b.z + rr);
      for (let j = j0; j <= j1; j++) {
        const qz = z0 + (j + 0.5) * OCC_C - b.z;
        for (let i = i0; i <= i1; i++) {
          const qx = x0 + (i + 0.5) * OCC_C - b.x;
          if (Math.abs(qx * co - qz * si) < hw && Math.abs(qx * si + qz * co) < hd) OCC[j * OCC_N + i] |= OCC_BLD;
        }
      }
    }
    for (const ei of c.edges) {
      if (seenE.has(ei)) continue;
      seenE.add(ei);
      const e = city.edges[ei], A = city.nodes[e.a], B = city.nodes[e.b];
      const R = e.hw + (e.pbw || 0) + (WALK_W[e.cls] || 0) + VERGE + 0.3 + OCC_HALF;
      for (const [ni, n] of [[e.a, A], [e.b, B]]) nodes.set(ni, Math.max(nodes.get(ni) || 0, e.hw + (WALK_W[e.cls] || 0) + VERGE + 0.8 + OCC_HALF));
      const [i0, i1, j0, j1] = cells(Math.min(A.x, B.x) - R, Math.min(A.z, B.z) - R, Math.max(A.x, B.x) + R, Math.max(A.z, B.z) + R);
      if (i0 > i1 || j0 > j1) continue;
      const sx = B.x - A.x, sz = B.z - A.z, l2 = sx * sx + sz * sz || 1, R2 = R * R;
      for (let j = j0; j <= j1; j++) {
        const pz = z0 + (j + 0.5) * OCC_C;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + (i + 0.5) * OCC_C;
          let t = ((px - A.x) * sx + (pz - A.z) * sz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const rx = A.x + sx * t - px, rz = A.z + sz * t - pz;
          if (rx * rx + rz * rz <= R2) OCC[j * OCC_N + i] |= OCC_PAVE;
        }
      }
    }
  }
  // the junctions' corner rings, a disc round each node
  for (const [ni, R] of nodes) {
    const n = city.nodes[ni];
    const [i0, i1, j0, j1] = cells(n.x - R, n.z - R, n.x + R, n.z + R);
    for (let j = j0; j <= j1; j++) {
      const pz = z0 + (j + 0.5) * OCC_C - n.z;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * OCC_C - n.x;
        if (px * px + pz * pz <= R * R) OCC[j * OCC_N + i] |= OCC_PAVE;
      }
    }
  }
  return OCC;
}
const STREET_SPACING = { res: 10, st: 11, art: 12 };

/**
 * Plant a chunk: every tree it owns, as records, with its far crown written
 * into `flat` and (near ring only) its trunk registered as a solid street
 * object and its index range kept for the tank (`world._fell`). Sliced: it
 * yields when the streamer's budget runs out, like meshProps.
 *
 * `lod` 1 is a near chunk (solid trunks), 0 a mid-ring one (drawn only); the
 * same trees in both, so a chunk promoting from one to the other keeps them.
 * Returns the records (Float32Array, REC each) in world._treeRecs.
 */
export function* plantTrees(world, flat, ch, cx, cz, lod) {
  const city = world.city;
  const ck = world._ck;
  const solid = lod === 1;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const own = (x, z) => Math.floor(x / CHUNK) === cx && Math.floor(z / CHUNK) === cz;
  const recs = [];
  const playgrounds = playgroundsOf(cx, cz);
  const LOT_PLAZA = G.LOT_KINDS.indexOf('plaza');
  const st = cityStats;
  if (st.treesPlanted === undefined) { st.treesPlanted = 0; st.treesByKind = { forest: 0, park: 0, street: 0, yard: 0 }; }
  const yieldNow = () => performance.now() - world._yt > world._yb;
  // A mid-ring chunk (800 m to 1.8 km) plants a fixed 60 % of the near
  // build's trees, skipped before any test: at that range the canopy reads
  // the same, and the ring's builds -- what the streamer has to keep up with
  // in flight -- cost half as much. Promotion to the near ring adds the rest
  // where they were, so nothing moves.
  // Forest thins harder (35 %): the terrain already draws a wood as canopy
  // underneath, and a view over an island's woods is all forest.
  const thin = lod === 1 ? () => false : (a, b, keep = 0.6) => hash2(a * 5 + 17, b * 3 + 29) > keep;
  // THE CAPS, whatever the ground: a near chunk holds at most NEAR_CAP trees,
  // a mid one MID_CAP. A forested chunk reaches ~1,550 near; the caps bound
  // the far crowns' memory (~550 bytes a tree) and triangles (~12) in a view
  // that is woods to the horizon.
  const cap = lod === 1 ? NEAR_CAP : MID_CAP;

  // Everything a trunk must keep off, cheapest test first. `pad` is the clear
  // margin off a carriageway (onRoad's fine grid takes up to 2.5 m).
  // (cityStats.treeRejects counts why, by test: the tools' first question
  // when a kind of tree goes missing)
  const rej = st.treeRejects || (st.treeRejects = {});
  const no = (k) => { rej[k] = (rej[k] || 0) + 1; return false; };
  const occ = occupancy(city, cx, cz);
  // `mode`: OPEN (yard, park, forest: the raster), VERGE (a street tree just
  // past its pavement: exact, the raster's margin would push it into the
  // yard) or WALK (a street tree on the pavement: exact, and no lot test).
  const OPEN = 0, VERGE_T = 1, WALK = 2;
  const clear = (x, z, pad, mode) => {
    if (!own(x, z)) return no('chunk');
    const walk = mode === WALK;
    if (mode === OPEN) {
      const o = occ[Math.floor((z - z0) / OCC_C) * OCC_N + Math.floor((x - x0) / OCC_C)];
      if (o & OCC_PAVE) return no('pavement');
      if (o & OCC_BLD) return no('building');
    }
    if (G.isWater(x, z) || G.terrainHeight(x, z) < 0.35) return no('water');
    // (a pavement tree stands on the pavement, which is drawn over any lot:
    // downtown, the buildings' paved aprons run under every footway)
    const lk = walk ? -1 : G.lotAt(x, z);
    if (lk >= 0 && (lk !== LOT_PLAZA || hash2(Math.round(x * 3), Math.round(z * 3)) > 0.33)) return no('lot');
    if (city.onRoad(x, z, pad)) return no('road');
    if (world.inAirfield(x, z)) return no('airfield');
    if (city.jumpClear(x, z)) return no('keepClear');
    for (let q = 0; q < playgrounds.length; q++) {
      const p = playgrounds[q];
      if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < p[2] * p[2]) return no('playground');
    }
    if (world.inDrawnLake(x, z)) { st.treesInLake = (st.treesInLake || 0) + 1; return no('lake'); }
    if (world.cutDepth(x, z) > 0.3) { st.propsInPit = (st.propsInPit || 0) + 1; return no('pit'); }
    if (mode === VERGE_T && city.roadLift(x, z) > 0.02) return no('pavement');
    return mode !== OPEN && world.inBuilding(x, z, walk ? 0.6 : 1.0) ? no('building') : true;
  };
  const plant = (x, z, th, cr, kind, tone, from) => {
    if (recs.length >= cap * REC) { st.treesCapped = (st.treesCapped || 0) + 1; return; }
    const gy = G.terrainHeight(x, z);
    const seed = hash2(Math.round(x * 4) + 101, Math.round(z * 4) - 77);
    let obs = -1;
    const f0 = flat.ni;
    writeFarTree(flat, x, gy, z, th, cr, kind, seed, tone);
    if (solid) {
      const r = kind === SHRUB ? 0.5 : clamp((kind === CONIFER ? 0.09 : 0.075) * cr + 0.12, 0.3, 0.6);
      const l = city.obstacles.get(ck);
      obs = l ? l.length / 3 : 0;
      city.addObstacle(ck, x, z, r);
      if (world._fell) world._fell.push(x, z, f0, flat.ni);
    }
    recs.push(x, gy, z, th, cr, kind, seed, tone, obs);
    st.treesPlanted++;
    st.treesByKind[from]++;
  };

  // --- street trees: both kerbs of residential, minor and arterial streets
  for (const ei of ch.edges) {
    if (yieldNow()) { yield; world._yt = performance.now(); }
    const e = city.edges[ei];
    if (e.elev || e.prof || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp' || e.hw < 3.5) continue;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    if (!own((a.x + b.x) / 2, (a.z + b.z) / 2)) continue;
    const ux = (b.x - a.x) / e.len, uz = (b.z - a.z) / e.len, px = -uz, pz = ux;
    const sp = STREET_SPACING[e.cls], ww = WALK_W[e.cls];
    // How leafy this neighbourhood is: blocks vary, as Seattle's do.
    const leafy = 0.45 + 0.75 * field((a.x + b.x) / 2, (a.z + b.z) / 2, 520, 3);
    const fill = (e.cls === 'res' ? 0.8 : e.cls === 'st' ? 0.66 : 0.6) * leafy;
    // The kerb furniture's slots (meshProps' structural cascade and its
    // clutter), so a pavement tree never shares one: every slot, whatever
    // ended up in it.
    const slots = [];
    {
      const cnt = Math.floor(e.len / (e.cls === 'res' ? 34 : 30));
      for (let i = 1; i <= cnt; i++) slots.push((i / (cnt + 1)) * e.len, i % 2 === 0 ? 1 : -1);
      const cc = Math.floor(e.len / 22);
      for (let i = 1; i <= cc; i++) {
        const t = (i - 0.5) / (cc + 1);
        const hc = hash2(Math.round(lerp(a.x, b.x, t) * 7) + 3, Math.round(lerp(a.z, b.z, t) * 7) + 11);
        slots.push(t * e.len, hc < 0.5 ? 1 : -1);
      }
    }
    for (const sg of [1, -1]) {
      // clear of a junction's corner, but not of a node that only splits
      // the street (OSM's ways are cut every block or so, and a margin at
      // both ends of every 40 m piece left room for one tree)
      const s0 = a.e.length > 2 ? world.paveStart(e.a, ei, sg) + 5 : 1.5;
      const s1 = e.len - (b.e.length > 2 ? world.paveStart(e.b, ei, sg) + 5 : 1.5);
      for (let s = s0 + hash2(ei, sg + 5) * sp * 0.6; s < s1; s += sp * (0.85 + 0.3 * hash2(Math.round(s * 10), ei))) {
        const h = hash2(ei * 7 + Math.round(s), sg * 13 + 1);
        if (h > fill || thin(ei + Math.round(s), sg)) continue;
        const cxl = a.x + ux * s, czl = a.z + uz * s;
        // past the pavement and its verge, on the grass in front of the
        // houses; where a building, a lot or a drive meets the pavement,
        // a grate on the pavement instead (arterials and minor streets)
        let x = cxl + px * sg * (e.hw + ww + 1.5), z = czl + pz * sg * (e.hw + ww + 1.5), walk = false;
        if (e.cls === 'art' || !clear(x, z, 2.5, VERGE_T)) {
          let slot = false;
          for (let q = 0; q < slots.length; q += 2) if (slots[q + 1] === sg && Math.abs(slots[q] - s) < 2.8) { slot = true; break; }
          if (slot) { no('kerbSlot'); continue; }
          x = cxl + px * sg * (e.hw + 1.0); z = czl + pz * sg * (e.hw + 1.0); walk = true;
          { const ns = city.nodeSurface(x, z); if (ns && ns.inSquare) { no('junction'); continue; } }
          if (!clear(x, z, 0.55, WALK)) continue;
          // a grate on a commercial pavement, a square of earth on a
          // residential one's planting strip
          const gy = G.terrainHeight(x, z) + WALK_LIFT;
          flat.box(x, gy - 0.02, z, 1.4, 0.05, 1.4, Math.atan2(ux, uz), e.cls === 'res' ? [0.16, 0.13, 0.1] : [0.27, 0.27, 0.28]);
        }
        const r = hash2(Math.round(x * 5), Math.round(z * 5) + 3);
        const big = e.cls === 'res' ? leafy : 0.8;
        if (r < 0.06 && e.cls === 'res') plant(x, z, 14 + 10 * sub(r, 3), 2.6 + 1.2 * sub(r, 4), CONIFER, T_STREET, 'street');
        else if (r < 0.22) plant(x, z, 8 + 5 * sub(r, 3), 1.5 + 0.7 * sub(r, 4), COLUMNAR, T_STREET, 'street');
        else plant(x, z, (7 + 8 * sub(r, 3)) * (0.8 + 0.3 * big), (3 + 2.6 * sub(r, 4)) * (0.85 + 0.25 * big), BROAD, T_STREET, 'street');
      }
    }
  }

  // --- yard trees: round the houses
  for (const bi of ch.buildings) {
    if (yieldNow()) { yield; world._yt = performance.now(); }
    const bd = city.buildings[bi];
    let tries = 0, p = 0;
    if (bd.style === 'house') { tries = 4; p = 0.72; }
    else if (bd.style === 'campus') { tries = 2; p = 0.5; }
    else if ((bd.style === 'lowrise' || bd.style === 'brick') && bd.w * bd.d < 900) { tries = 1; p = 0.32; }
    if (!tries) continue;
    const leafy = 0.5 + 0.7 * field(bd.x, bd.z, 520, 3);
    const c = Math.cos(bd.rot), s = Math.sin(bd.rot);
    for (let t = 0; t < tries; t++) {
      const h = hash2(bi * 3 + t, 41);
      if (h > p * leafy || thin(bi, t)) continue;
      // a side of the house (by hash), out past its wall, along it a little
      const side = Math.floor(hash2(bi, t + 7) * 4);
      const gap = 2.6 + 4.5 * hash2(bi, t + 11), along = (hash2(bi, t + 13) - 0.5) * 0.8;
      let lx, lz;
      if (side < 2) { lx = (side ? 1 : -1) * (bd.w / 2 + gap); lz = along * bd.d; }
      else { lx = along * bd.w; lz = (side === 3 ? 1 : -1) * (bd.d / 2 + gap); }
      const x = bd.x + lx * c - lz * s, z = bd.z + lx * s + lz * c;
      if (!clear(x, z, 2.5, OPEN)) continue;
      const r = hash2(Math.round(x * 5) + 9, Math.round(z * 5));
      if (r < 0.32) plant(x, z, 13 + 14 * sub(r, 3) * leafy, 2.8 + 1.6 * sub(r, 4), CONIFER, T_STREET, 'yard');
      else if (r < 0.4) plant(x, z, 7 + 5 * sub(r, 3), 1.6 + 0.8 * sub(r, 4), COLUMNAR, T_STREET, 'yard');
      else plant(x, z, 8 + 9 * sub(r, 3) * leafy, 3.2 + 3.2 * sub(r, 4), BROAD, T_STREET, 'yard');
    }
  }

  // --- forest and park: a jittered grid over the chunk's green
  // The cells in a fixed scattered order (997 is prime to 44 x 44), so a
  // chunk that reaches its cap is thinned evenly rather than losing its
  // last rows.
  const N = 44, S = CHUNK / N;
  for (let q = 0; q < N * N; q++) {
    if (q % N === 0 && yieldNow()) { yield; world._yt = performance.now(); }
    {
      const cell = (q * 997) % (N * N), i = cell % N, j = Math.floor(cell / N);
      const hx = hash2(cx * 977 + i, cz * 613 + j), hz = hash2(cx * 389 + i + 7, cz * 211 + j + 3);
      const x = x0 + (i + 0.12 + 0.76 * hx) * S, z = z0 + (j + 0.12 + 0.76 * hz) * S;
      const gk = G.greenKind(x, z);
      if (!gk || gk === G.GREEN_OPEN || thin(cx * 64 + i, cz * 64 + j, gk === G.GREEN_WOOD ? 0.35 : 0.6)) continue;
      const h = hash2(cx * 131 + i * 3, cz * 71 + j * 5);
      if (gk === G.GREEN_WOOD) {
        if (h > 0.8) continue;
        if (!clear(x, z, 2.5, OPEN)) continue;
        // stands: some mostly fir, some mostly maple and alder
        const pc = 0.22 + 0.5 * field(x, z, 240, 11);
        const r = hash2(Math.round(x * 5) + 1, Math.round(z * 5) + 2), sz = sub(r, 3);
        if (r < pc) plant(x, z, 18 + 17 * sz, 4.4 + 2.0 * sz + 1.2 * sub(r, 4), CONIFER, T_FOREST, 'forest');
        else if (r < pc + 0.07) plant(x, z, 3 + 2.5 * sz, 2 + 1.2 * sub(r, 4), SHRUB, T_FOREST, 'forest');
        else plant(x, z, 14 + 10 * sz, 4.6 + 1.8 * sz + 0.8 * sub(r, 4), BROAD, T_FOREST, 'forest');
      } else if (gk === G.GREEN_SCRUB) {
        if (h > 0.5) continue;
        if (!clear(x, z, 2.5, OPEN)) continue;
        const r = hash2(Math.round(x * 5) + 1, Math.round(z * 5) + 2);
        if (r < 0.8) plant(x, z, 2.2 + 2.2 * sub(r, 3), 1.6 + 1.2 * sub(r, 4), SHRUB, T_PARK, 'park');
        else plant(x, z, 7 + 6 * sub(r, 3), 3 + 1.5 * sub(r, 4), BROAD, T_PARK, 'park');
      } else {
        // lawn: groves and open grass, by a 150 m noise field -- and a
        // park's edges and shores lined with trees, as Green Lake's path is
        // and most of Seattle's parks are: the mown middle stays open.
        const g = field(x, z, 150, 5);
        let p = 0.035 + 0.5 * clamp((g - 0.52) / 0.28, 0, 1);
        if (h < 0.55 && (!G.greenKind(x + 14, z) || !G.greenKind(x - 14, z) || !G.greenKind(x, z + 14) || !G.greenKind(x, z - 14))) p += 0.4;
        if (h > p) continue;
        if (!clear(x, z, 2.5, OPEN)) continue;
        const r = hash2(Math.round(x * 5) + 1, Math.round(z * 5) + 2);
        if (r < 0.34) plant(x, z, 14 + 14 * sub(r, 3), 3 + 1.6 * sub(r, 4), CONIFER, T_PARK, 'park');
        else plant(x, z, 9 + 9 * sub(r, 3), 3.6 + 2.6 * sub(r, 4), BROAD, T_PARK, 'park');
      }
    }
  }
  world._treeRecs = recs.length ? Float32Array.from(recs) : null;
}
