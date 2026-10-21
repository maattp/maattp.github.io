// THE HORSE AND BUGGY (Auto KW): Waterloo Region's Old Order Mennonites drive
// black top buggies on the rural roads round St. Jacobs, Conestogo, Heidelberg
// and Elmira -- a bay Standardbred in the shafts, steel-tyred wooden wheels,
// the orange slow-moving-vehicle triangle on the back.
//
// The `buggy` type (vehicles.js TYPES) is an ordinary Vehicle: the player
// drives it with the arcade model (slow, gentle, `noEngine`), traffic parks
// it ('apron') and Buggies below drives a few along the country roads
// ('path', like the cyclists). What is drawn is two things:
//
//  - the CART -- body, top, seat, running gear, the SMV triangle, the driver
//    (matte.crew: there only when someone is driving) -- is the vehicle's own
//    paint / trim / matte, built by buildBuggy. Those three meshes are turned
//    about the front axle's kingpin every frame (syncBuggy): the cart follows
//    the horse like a trailer, its rear axle dragged toward the kingpin.
//  - the HORSE, its harness, the shafts, the front axle and all four wheels
//    are ONE SkinnedMesh (attachBuggy): 22 bones, one draw. The legs are
//    placed by two-bone IK on their hooves (`pose`): walk (4-beat), trot
//    (diagonal pairs) and canter (3-beat, right lead), picked from the speed
//    with hysteresis and cross-faded; the trunk dips where a planted leg could
//    not otherwise reach its hoof (the walk's inverted pendulum) and the trot
//    adds its spring. Wheels are bones too, so every buggy's wheels turn.
//
// Coordinates are the vehicle's: +z forward (the horse's nose), +y up, +x the
// LEFT side (kerb side is -x). y = 0 is the ground. The whole rig is 6.3 m:
// muzzle at +3.1, the cart's tail at -3.05.

import * as THREE from './three.js';
import { Builder } from './build.js';
import { clamp, damp, angleWrap, hash2 } from './util.js';
import * as G from './geo.js';
import { mennoniteCountry } from './rural.js';

const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');

// Vertex colours are LINEAR (three's vertexColors): authored as sRGB here.
const lin = (r, g, b) => [r ** 2.2, g ** 2.2, b ** 2.2];
const COAT = lin(0.38, 0.19, 0.09);       // bay
const COAT_DK = lin(0.29, 0.14, 0.065);   // under the belly, inside the legs
const POINTS = lin(0.07, 0.055, 0.05);     // black points: legs, mane, tail
const MUZZLE = lin(0.16, 0.11, 0.09);
const HOOF = lin(0.16, 0.15, 0.14);
const EYE = lin(0.03, 0.02, 0.02);
const LEATHER = lin(0.06, 0.055, 0.05);
const NICKEL = lin(0.62, 0.62, 0.64);
const WOOD = lin(0.20, 0.13, 0.085);       // varnished hickory, gone dark
const STEEL = lin(0.42, 0.42, 0.43);
const IRON = lin(0.09, 0.09, 0.095);
const VINYL = lin(0.075, 0.075, 0.08);     // the top: black vinyl over a frame
const SEAT = lin(0.12, 0.13, 0.17);
const COATB = lin(0.05, 0.05, 0.055);      // the driver's black coat
const SHIRT = lin(0.80, 0.80, 0.78);
const SKIN = lin(0.80, 0.60, 0.50);
const SMV_OR = lin(1.0, 0.36, 0.05);
const SMV_RED = lin(0.78, 0.05, 0.04);
const WHITE = [1, 1, 1];
// trim markers (vehicles.js tagGlass): the exact colours it keys on
const GLASS = [0.06, 0.08, 0.10];
const SHADOW_G = 0.123, SHADOW_B = 0.456;
const TAIL_RED = [0.92, 0.12, 0.1];
const AMBER = [0.95, 0.55, 0.08];

// The cart: kingpin (the front axle's centre, where the cart turns on the
// fifth wheel) and the rear axle, the wheels, the body.
export const CART = { kz: -0.80, rz: -2.45, fr: 0.50, rr: 0.60, track: 0.78, len: 1.65 };
const K_Z = CART.kz;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * A smooth tube swept through stations in a plane holding x: station
 * { c: [x, y, z], w, u, d, col, e } is a superellipse ring of half-width `w`
 * across x and half-depths `u` / `d` either side of the spine along
 * U = T x X (T the spine's tangent): UP for a spine running forward, FORWARD
 * for one running down, BACK for one running up. Normals come off the grid,
 * so it shades as one surface. `col` may be a function of the ring angle.
 */
function sweep(b, S, K, { capA = false, capB = false } = {}) {
  const n = S.length, P = [], C = [], Tn = [];
  for (let i = 0; i < n; i++) {
    const a = S[Math.max(0, i - 1)].c, c = S[Math.min(n - 1, i + 1)].c;
    const T = norm3([c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    const U = norm3([0, T[2], -T[1]]);
    const s = S[i], e = s.e || 2.2, ring = [];
    for (let k = 0; k < K; k++) {
      const ang = (k / K) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
      const lx = Math.sign(ca) * Math.abs(ca) ** (2 / e) * s.w;
      const lu = sa >= 0 ? Math.abs(sa) ** (2 / e) * s.u : -(Math.abs(sa) ** (2 / e)) * s.d;
      ring.push([s.c[0] + lx, s.c[1] + U[1] * lu, s.c[2] + U[2] * lu]);
    }
    P.push(ring); C.push(s.c); Tn.push(T);
  }
  const N = [];
  for (let i = 0; i < n; i++) {
    N.push([]);
    for (let k = 0; k < K; k++) {
      const ip = P[Math.max(0, i - 1)][k], inx = P[Math.min(n - 1, i + 1)][k];
      const kp = P[i][(k - 1 + K) % K], kn = P[i][(k + 1) % K];
      const du = [kn[0] - kp[0], kn[1] - kp[1], kn[2] - kp[2]], dv = [inx[0] - ip[0], inx[1] - ip[1], inx[2] - ip[2]];
      let nn = norm3([du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]]);
      const o = [P[i][k][0] - C[i][0], P[i][k][1] - C[i][1], P[i][k][2] - C[i][2]];
      if (nn[0] * o[0] + nn[1] * o[1] + nn[2] * o[2] < 0) nn = [-nn[0], -nn[1], -nn[2]];
      N[i].push(nn);
    }
  }
  const colAt = (i, k) => (typeof S[i].col === 'function' ? S[i].col(k / K) : S[i].col);
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < K; k++) {
      const k2 = (k + 1) % K;
      b.quad(P[i][k], P[i][k2], P[i + 1][k2], P[i + 1][k], [N[i][k], N[i][k2], N[i + 1][k2], N[i + 1][k]], uv,
        [colAt(i, k), colAt(i, k2), colAt(i + 1, k2), colAt(i + 1, k)]);
    }
  }
  const cap = (i, sg) => {
    const T = Tn[i], nn = [T[0] * sg, T[1] * sg, T[2] * sg];
    for (let k = 0; k < K; k++) b.tri(C[i], P[i][k], P[i][(k + 1) % K], nn, colAt(i, k));
  };
  if (capA) cap(0, -1);
  if (capB) cap(n - 1, 1);
  return P;
}

/** A thin rope or strap through a polyline: round tube segments, joined. */
function rope(b, pts, r, sides, col) {
  for (let i = 0; i < pts.length - 1; i++) b.tube(pts[i], pts[i + 1], r, sides, col, false);
}

/** A flat plate (both faces) centred on c, spanned by unit axes a1 (half h1) and a2 (half h2). */
function plate(b, c, a1, h1, a2, h2, col, t = 0.004) {
  const nn = norm3([a1[1] * a2[2] - a1[2] * a2[1], a1[2] * a2[0] - a1[0] * a2[2], a1[0] * a2[1] - a1[1] * a2[0]]);
  for (const s of [-1, 1]) {
    const o = [c[0] + nn[0] * t * s, c[1] + nn[1] * t * s, c[2] + nn[2] * t * s];
    const P = (u, v) => [o[0] + a1[0] * u * h1 + a2[0] * v * h2, o[1] + a1[1] * u * h1 + a2[1] * v * h2, o[2] + a1[2] * u * h1 + a2[2] * v * h2];
    b.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [nn[0] * s, nn[1] * s, nn[2] * s], [0, 0, 1, 0, 1, 1, 0, 1], col);
  }
}

/** A ring of tube (a terret, a bit ring) round centre c in the plane of unit axes a1, a2. */
function loop(b, c, a1, a2, R, r, col, seg = 8) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2, x = Math.cos(t) * R, y = Math.sin(t) * R;
    pts.push([c[0] + a1[0] * x + a2[0] * y, c[1] + a1[1] * x + a2[1] * y, c[2] + a1[2] * x + a2[2] * y]);
  }
  rope(b, pts, r, 4, col);
}

// ---------------------------------------------------------------------------
// The horse's shape: tables in the rig's frame, standing square.
// ---------------------------------------------------------------------------

// Body: [z, top y, bottom y, half-width]. Croup to chest; the withers at 1.80.
const BODY = [
  [0.52, 1.31, 1.17, 0.04],
  [0.545, 1.41, 1.01, 0.12],
  [0.60, 1.475, 0.91, 0.19],
  [0.68, 1.515, 0.86, 0.235],
  [0.79, 1.535, 0.85, 0.26],
  [0.92, 1.53, 0.88, 0.275],
  [1.08, 1.50, 0.93, 0.285],
  [1.30, 1.465, 0.92, 0.30],
  [1.52, 1.48, 0.90, 0.30],
  [1.70, 1.54, 0.91, 0.28],
  [1.84, 1.555, 0.93, 0.26],
  [1.96, 1.52, 0.95, 0.24],
  [2.06, 1.45, 0.97, 0.22],
  [2.14, 1.37, 0.99, 0.19],
  [2.19, 1.29, 1.02, 0.15],
  [2.225, 1.21, 1.06, 0.08],
  [2.24, 1.15, 1.10, 0.02],
];
function bodyAt(z) {
  const B = BODY;
  if (z <= B[0][0]) return B[0];
  for (let i = 1; i < B.length; i++) {
    if (z <= B[i][0]) {
      const t = (z - B[i - 1][0]) / (B[i][0] - B[i - 1][0]), a = B[i - 1], c = B[i];
      return [z, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t, a[3] + (c[3] - a[3]) * t];
    }
  }
  return B[B.length - 1];
}
/** Half-width of the body's surface at (z, y), from the superellipse rings. */
function bodyX(z, y, e = 2.2) {
  const [, top, bot, w] = bodyAt(z);
  const yc = (top + bot) / 2, h = (top - bot) / 2;
  const q = clamp(Math.abs(y - yc) / h, 0, 1);
  return w * Math.max(0, 1 - q ** e) ** (1 / e);
}

// Neck: [z, y, half-width, crest side, throat side], base to poll.
const NECK = [
  [1.82, 1.25, 0.21, 0.27, 0.27],
  [1.98, 1.36, 0.19, 0.25, 0.25],
  [2.12, 1.49, 0.165, 0.22, 0.19],
  [2.25, 1.62, 0.14, 0.185, 0.15],
  [2.37, 1.75, 0.12, 0.155, 0.12],
  [2.48, 1.86, 0.105, 0.13, 0.105],
  [2.565, 1.94, 0.095, 0.11, 0.095],
  [2.625, 1.99, 0.086, 0.092, 0.09],
];
const NECK_A = [1.88, 1.31], NECK_B = [2.625, 1.985];   // (z, y) base and poll, for weights
// Head: poll at HEAD_P, axis HEAD_D down-forward; [t, half-width, face side, jaw side].
const HEAD_P = [2.585, 2.005];
const HEAD_D = (() => { const z = 0.43, y = -0.55, l = Math.hypot(z, y); return [z / l, y / l]; })();
const HEAD_U = [HEAD_D[0], -HEAD_D[1]];   // perpendicular in (z, y)... see headPt
const HEAD = [
  [-0.05, 0.062, 0.055, 0.06],
  [0.00, 0.09, 0.07, 0.10],
  [0.07, 0.105, 0.082, 0.175],
  [0.15, 0.11, 0.088, 0.20],
  [0.23, 0.10, 0.088, 0.165],
  [0.32, 0.084, 0.084, 0.105],
  [0.41, 0.074, 0.080, 0.082],
  [0.49, 0.071, 0.078, 0.078],
  [0.56, 0.075, 0.080, 0.084],
  [0.615, 0.068, 0.072, 0.076],
  [0.65, 0.046, 0.05, 0.052],
  [0.665, 0.012, 0.012, 0.012],
];
/** A point on the head's frame: `t` down the axis from the poll, `u` toward the face (+) or jaw (-), x across. */
function headPt(t, u, x = 0) {
  // U for this spine (sweep's T x X): (0, Tz, -Ty) -> the face side
  const Tz = HEAD_D[0], Ty = HEAD_D[1];
  return [x, HEAD_P[1] + Ty * t + Tz * u, HEAD_P[0] + Tz * t - Ty * u];
}
void HEAD_U;

// Legs. Fore: [y, z, half-width, front, back, colour]; the stations run down.
const FORE = [
  [1.15, 1.99, 0.11, 0.12, 0.12, COAT],
  [1.02, 1.975, 0.095, 0.105, 0.10, COAT],
  [0.88, 1.968, 0.074, 0.08, 0.072, COAT],
  [0.75, 1.966, 0.056, 0.058, 0.055, COAT],
  [0.64, 1.968, 0.044, 0.046, 0.048, POINTS],
  [0.57, 1.972, 0.050, 0.054, 0.050, POINTS],
  [0.50, 1.972, 0.039, 0.036, 0.048, POINTS],
  [0.41, 1.975, 0.031, 0.029, 0.046, POINTS],
  [0.33, 1.978, 0.033, 0.033, 0.05, POINTS],
  [0.275, 1.982, 0.038, 0.038, 0.058, POINTS],
  [0.215, 1.998, 0.034, 0.034, 0.04, POINTS],
  [0.135, 2.022, 0.035, 0.036, 0.035, POINTS],
  [0.10, 2.036, 0.045, 0.046, 0.041, HOOF],
  [0.05, 2.052, 0.051, 0.056, 0.046, HOOF],
  [0.005, 2.066, 0.055, 0.062, 0.05, HOOF],
];
const HIND = [
  [1.04, 0.86, 0.13, 0.13, 0.14, COAT],
  [0.92, 0.80, 0.11, 0.12, 0.13, COAT],
  [0.80, 0.74, 0.08, 0.09, 0.10, COAT],
  [0.69, 0.70, 0.06, 0.068, 0.085, COAT],
  [0.60, 0.672, 0.052, 0.052, 0.088, COAT],
  [0.525, 0.672, 0.044, 0.042, 0.058, POINTS],
  [0.44, 0.684, 0.035, 0.033, 0.048, POINTS],
  [0.34, 0.693, 0.034, 0.034, 0.05, POINTS],
  [0.275, 0.70, 0.038, 0.038, 0.058, POINTS],
  [0.215, 0.716, 0.034, 0.034, 0.04, POINTS],
  [0.135, 0.74, 0.035, 0.036, 0.035, POINTS],
  [0.10, 0.754, 0.045, 0.046, 0.041, HOOF],
  [0.05, 0.77, 0.050, 0.055, 0.046, HOOF],
  [0.005, 0.784, 0.054, 0.06, 0.05, HOOF],
];
// Tail: [z, y, half-width, back, front], root to tip.
const TAIL = [
  [0.60, 1.415, 0.045, 0.045, 0.045],
  [0.55, 1.385, 0.052, 0.05, 0.05],
  [0.49, 1.30, 0.07, 0.06, 0.05],
  [0.44, 1.14, 0.095, 0.065, 0.05],
  [0.415, 0.97, 0.105, 0.065, 0.05],
  [0.405, 0.80, 0.10, 0.06, 0.045],
  [0.41, 0.64, 0.08, 0.05, 0.04],
  [0.42, 0.54, 0.045, 0.03, 0.03],
  [0.425, 0.49, 0.008, 0.008, 0.008],
];

// The bones, by bind position in the rig. Legs: LF RF LH RH, x + is left.
const LEG_X = [0.15, -0.15, 0.162, -0.162];
const FORE_J = { root: [1.40, 1.82], knee: [0.565, 1.972], fet: [0.275, 1.982], hoof: [0.0, 2.062] };
const HIND_J = { root: [1.30, 0.80], knee: [0.585, 0.665], fet: [0.275, 0.70], hoof: [0.0, 0.782] };
const BONE_DEFS = [
  ['root', -1, [0, 0, 0]],
  ['trunk', 0, [0, 1.20, 1.35]],
  ['neck', 1, [0, 1.33, 1.93]],
  ['head', 2, [0, HEAD_P[1], HEAD_P[0]]],
  ['tail', 1, [0, 1.41, 0.59]],
];
for (let i = 0; i < 4; i++) {
  const J = i < 2 ? FORE_J : HIND_J, x = LEG_X[i];
  const base = BONE_DEFS.length;
  BONE_DEFS.push([`up${i}`, 1, [x, J.root[0], J.root[1]]]);
  BONE_DEFS.push([`lo${i}`, base, [x, J.knee[0], J.knee[1]]]);
  BONE_DEFS.push([`pa${i}`, base + 1, [x, J.fet[0], J.fet[1]]]);
}
BONE_DEFS.push(['wfl', 0, [CART.track, CART.fr, K_Z]], ['wfr', 0, [-CART.track, CART.fr, K_Z]]);
BONE_DEFS.push(['cart', 0, [0, CART.fr, K_Z]]);
BONE_DEFS.push(['wrl', BONE_DEFS.length - 1, [CART.track, CART.rr, CART.rz]], ['wrr', BONE_DEFS.length - 1, [-CART.track, CART.rr, CART.rz]]);
const BI = Object.fromEntries(BONE_DEFS.map((d, i) => [d[0], i]));

// Two-bone lengths and the bind angles of each segment (angle phi: direction
// (z, y) = (-sin phi, -cos phi), so a bone's rotation.x adds to it).
const angOf = (dz, dy) => Math.atan2(-dz, -dy);
function legRig(J) {
  const L1 = Math.hypot(J.knee[0] - J.root[0], J.knee[1] - J.root[1]);
  const L2 = Math.hypot(J.fet[0] - J.knee[0], J.fet[1] - J.knee[1]);
  return {
    L1, L2,
    a1: angOf(J.knee[1] - J.root[1], J.knee[0] - J.root[0]),
    a2: angOf(J.fet[1] - J.knee[1], J.fet[0] - J.knee[0]),
    // the hoof's contact point from the fetlock, held while the pastern keeps its angle
    hz: J.hoof[1] - J.fet[1], hy: J.hoof[0] - J.fet[0],
    // the root over the fetlock at bind
    rh: J.root[0] - J.fet[0], rz: J.root[1] - J.fet[1],
  };
}
const RIG_F = legRig(FORE_J), RIG_H = legRig(HIND_J);

// ---------------------------------------------------------------------------
// Skinned building: parts are added with a weight rule over their bind position.
// ---------------------------------------------------------------------------

class SkinB {
  constructor() { this.b = new Builder(false); this.si = []; this.sw = []; }
  /** Run `fn(builder)`; every vertex it adds takes weights `wf` ([[bone, w], ...] or a function of x, y, z). */
  add(fn, wf) {
    const b = this.b, v0 = b.pos.length / 3;
    fn(b);
    const v1 = b.pos.length / 3;
    for (let v = v0; v < v1; v++) {
      let W = typeof wf === 'function' ? wf(b.pos[v * 3], b.pos[v * 3 + 1], b.pos[v * 3 + 2]) : wf;
      if (typeof W === 'number') W = [[W, 1]];
      let tot = 0;
      for (const [, w] of W) tot += w;
      for (let j = 0; j < 4; j++) {
        this.si.push(W[j] ? W[j][0] : 0);
        this.sw.push(W[j] ? W[j][1] / (tot || 1) : 0);
      }
    }
  }
  build() {
    const geo = this.b.build();
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    return geo;
  }
}
const mix2 = (a, b, t) => (t <= 0 ? [[a, 1]] : t >= 1 ? [[b, 1]] : [[a, 1 - t], [b, t]]);

// ---------------------------------------------------------------------------
// The wheels: steel tyre on a wooden felloe, turned spokes, a hub and its cap.
// Built round the axle (x), at the hub. `out` is the outboard side.
// ---------------------------------------------------------------------------

function spokedWheel(b, cx, cy, cz, r, out, nSp) {
  const SEG = ON_PHONE ? 22 : 28, tw = 0.04, tt = 0.012, fd = 0.05, fw = 0.045;
  const r1 = r - tt, r2 = r1 - fd;
  const P = (x, rr, a) => [cx + x, cy + Math.cos(a) * rr, cz + Math.sin(a) * rr];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const n0 = [0, Math.cos(a0), Math.sin(a0)], n1 = [0, Math.cos(a1), Math.sin(a1)];
    // the tyre's tread and its two faces, then the felloe's
    b.quad(P(-tw / 2, r, a0), P(tw / 2, r, a0), P(tw / 2, r, a1), P(-tw / 2, r, a1), [n0, n0, n1, n1], uv, STEEL);
    for (const s of [-1, 1]) {
      b.quad(P(s * tw / 2, r, a0), P(s * tw / 2, r, a1), P(s * tw / 2, r1, a1), P(s * tw / 2, r1, a0), [s, 0, 0], uv, STEEL);
      b.quad(P(s * fw / 2, r1, a0), P(s * fw / 2, r1, a1), P(s * fw / 2, r2, a1), P(s * fw / 2, r2, a0), [s, 0, 0], uv, WOOD);
    }
    const m0 = [0, -n0[1], -n0[2]], m1 = [0, -n1[1], -n1[2]];
    b.quad(P(-fw / 2, r2, a0), P(fw / 2, r2, a0), P(fw / 2, r2, a1), P(-fw / 2, r2, a1), [m0, m0, m1, m1], uv, WOOD);
  }
  // spokes, dished: the hub sits a little inboard, so they cone out to the rim
  const dish = -out * 0.03;
  for (let k = 0; k < nSp; k++) {
    const a = (k / nSp) * Math.PI * 2;
    b.tube(P(dish, 0.07, a), P(0, r2 + 0.01, a), 0.013, 5, WOOD, false);
  }
  // the hub: a turned barrel, a steel band each side, the cap and nut outboard
  b.tube([cx - 0.085 + dish, cy, cz], [cx + 0.085 + dish, cy, cz], 0.072, 10, WOOD, true);
  for (const s of [-1, 1]) b.tube([cx + s * 0.07 + dish, cy, cz], [cx + s * 0.088 + dish, cy, cz], 0.076, 10, STEEL, false);
  b.tube([cx + out * 0.085 + dish, cy, cz], [cx + out * 0.13 + dish, cy, cz], 0.045, 8, STEEL, true);
  b.tube([cx + out * 0.13 + dish, cy, cz], [cx + out * 0.15 + dish, cy, cz], 0.026, 6, IRON, true);
}

// ---------------------------------------------------------------------------
// The horse, its harness, the shafts, the front axle and the wheels: one
// skinned geometry, shared by every buggy.
// ---------------------------------------------------------------------------

let RIG_GEO = null;
function rigGeometry() {
  if (RIG_GEO) return RIG_GEO;
  const sb = new SkinB();
  const K = ON_PHONE ? 12 : 16;
  const T = BI.trunk;
  // --- body
  sb.add((b) => sweep(b, BODY.map(([z, top, bot, w]) => ({
    c: [0, (top + bot) / 2, z], w, u: (top - bot) / 2, d: (top - bot) / 2,
    // the belly a shade darker than the flanks
    col: (f) => (f > 0.62 && f < 0.88 ? COAT_DK : COAT),
  })), K, { capA: true, capB: true }), T);
  // --- neck: weights trunk -> neck up its length, -> head at the poll
  const neckW = (x, y, z) => {
    const dz = NECK_B[0] - NECK_A[0], dy = NECK_B[1] - NECK_A[1];
    const s = ((z - NECK_A[0]) * dz + (y - NECK_A[1]) * dy) / (dz * dz + dy * dy);
    const n = sstep(0.06, 0.42, s), h = sstep(0.9, 1.02, s);
    const W = [];
    if (1 - n > 0) W.push([T, 1 - n]);
    if (n * (1 - h) > 0) W.push([BI.neck, n * (1 - h)]);
    if (n * h > 0) W.push([BI.head, n * h]);
    return W.length ? W : [[T, 1]];
  };
  const neckSt = NECK.map(([z, y, w, u, d]) => ({ c: [0, y, z], w, u, d, col: COAT }));
  sb.add((b) => sweep(b, neckSt, K), neckW);
  // the mane: a ridge along the crest, falling to the off (right, -x) side
  {
    const crest = [];
    for (let i = 0; i < NECK.length; i++) {
      const a = NECK[Math.max(0, i - 1)], c = NECK[Math.min(NECK.length - 1, i + 1)];
      const T2 = norm3([0, c[1] - a[1], c[0] - a[0]]);
      const [z, y, , u] = NECK[i];
      // U = (0, Tz, -Ty): up and back off a spine climbing forward
      crest.push([-0.025, y + T2[2] * (u - 0.01), z - T2[1] * (u - 0.01)]);
    }
    const st = crest.slice(1).map((c, i) => ({ c, w: 0.03, u: 0.055 - i * 0.003, d: 0.02, col: POINTS }));
    st[0].u = 0.03; st[st.length - 1].u = 0.025;
    sb.add((b) => sweep(b, st, 8, { capA: true, capB: true }), neckW);
  }
  // --- head
  const headSt = HEAD.map(([t, w, u, d], i) => {
    const c = headPt(t, 0);
    return { c, w, u, d, col: i >= 8 ? MUZZLE : COAT };
  });
  sb.add((b) => sweep(b, headSt, K, { capB: true }), BI.head);
  sb.add((b) => {
    // eyes, set high on the sides, under the blinkers
    for (const s of [-1, 1]) b.spheroid(s * 0.098, ...headPt(0.135, 0.045).slice(1), 0.022, 6, 4, EYE);
    // nostrils: dark ovals on the muzzle's front
    for (const s of [-1, 1]) b.spheroid(s * 0.04, ...headPt(0.6, 0.06).slice(1), 0.018, 6, 3, EYE, 1.4);
    // ears: up from the poll, pricked forward a little
    for (const s of [-1, 1]) {
      const base = headPt(-0.005, 0.03, s * 0.055);
      const st = [0, 0.04, 0.09, 0.13, 0.15].map((h, i) => ({
        c: [base[0] + s * h * 0.25, base[1] + h, base[2] + h * 0.22],
        w: [0.032, 0.03, 0.024, 0.012, 0.002][i], u: [0.022, 0.02, 0.016, 0.008, 0.002][i], d: [0.02, 0.018, 0.014, 0.008, 0.002][i],
        col: i >= 3 ? POINTS : COAT,
      }));
      sweep(b, st, 6);
    }
    // the forelock, between the ears down the forehead
    const fl = [0, 0.05, 0.1, 0.13].map((t, i) => ({ c: headPt(t - 0.02, 0.07 + (i === 0 ? 0.01 : 0), -0.005), w: 0.035 - i * 0.008, u: 0.02, d: 0.008, col: POINTS }));
    sweep(b, fl, 6, { capB: true });
  }, BI.head);
  // --- tail
  const tailSt = TAIL.map(([z, y, w, u, d], i) => ({ c: [0, y, z], w, u, d, col: i < 2 ? COAT : POINTS }));
  sb.add((b) => sweep(b, tailSt, 10, { capB: true }), (x, y) => mix2(T, BI.tail, sstep(1.43, 1.36, y)));
  // --- legs
  for (let i = 0; i < 4; i++) {
    const fore = i < 2, x = LEG_X[i], tab = fore ? FORE : HIND;
    const up = BI[`up${i}`], lo = BI[`lo${i}`], pa = BI[`pa${i}`];
    const st = tab.map(([y, z, w, u, d, col]) => ({ c: [x, y, z], w, u, d, col }));
    // the coat stops at a soft line above the knee / hock
    sb.add((b) => sweep(b, st, ON_PHONE ? 8 : 10, { capB: true }), (px, y) => {
      if (fore) {
        if (y > 1.06) return mix2(T, up, sstep(1.16, 1.06, y));
        if (y > 0.60) return [[up, 1]];
        if (y > 0.50) return mix2(up, lo, sstep(0.60, 0.53, y));
        if (y > 0.24) return mix2(lo, pa, sstep(0.30, 0.245, y));
        return [[pa, 1]];
      }
      if (y > 0.83) return mix2(T, up, sstep(1.0, 0.84, y));
      if (y > 0.62) return [[up, 1]];
      if (y > 0.52) return mix2(up, lo, sstep(0.62, 0.55, y));
      if (y > 0.24) return mix2(lo, pa, sstep(0.30, 0.245, y));
      return [[pa, 1]];
    });
  }
  // --- harness. A breast collar round the chest, held up by a neck strap; a
  // back pad with terrets and the girth; the breeching round the quarters; the
  // traces back to the singletree. Black leather, nickel fittings.
  sb.add((b) => {
    // breast collar: a band at y 1.10-1.17 following the body from the girth round the chest
    const band = (y0, y1, z0, z1, out = 0.012, n = 14) => {
      const rows = [];
      for (let k = 0; k <= n; k++) {
        const z = z0 + (z1 - z0) * (k / n);
        rows.push(z);
      }
      // left side forward, round the front, back along the right
      const pts = [];
      for (const z of rows) pts.push([bodyX(z, (y0 + y1) / 2) + out, z]);
      const ring = [...pts, ...pts.slice().reverse().map(([x, z]) => [-x, z])];
      for (let k = 0; k < ring.length - 1; k++) {
        const [xa, za] = ring[k], [xc, zc] = ring[k + 1];
        const nx = (zc - za), nz = -(xc - xa), l = Math.hypot(nx, nz) || 1;
        const side = k < pts.length - 1 ? 1 : -1;
        void side;
        b.quad([xa, y0, za], [xc, y0, zc], [xc, y1, zc], [xa, y1, za], [nx / l, 0, nz / l], [0, 0, 1, 0, 1, 1, 0, 1], LEATHER);
      }
    };
    band(1.15, 1.225, 1.74, 2.282);
    // the collar's fittings where the traces meet it
    for (const s of [-1, 1]) loop(b, [s * (bodyX(1.76, 1.19) + 0.016), 1.19, 1.76], [0, 1, 0], [0, 0, 1], 0.03, 0.007, NICKEL, 6);
    // back pad and girth
    const gz = 1.60;
    sweep(b, [gz - 0.025, gz + 0.025].map((z) => { const [, top, bot, w] = bodyAt(z); return { c: [0, (top + bot) / 2, z], w: w + 0.012, u: (top - bot) / 2 + 0.012, d: (top - bot) / 2 + 0.012, col: LEATHER }; }), 16);
    {
      const [, top, bot, w] = bodyAt(gz), yc = (top + bot) / 2, h = (top - bot) / 2;
      // the pad: a saddle-shaped shell over the back, down to the tugs
      const rows = [gz - 0.11, gz - 0.09, gz + 0.09, gz + 0.11].map((z, i) => {
        const o = i === 0 || i === 3 ? 0.006 : 0.024, row = [];
        for (let k = 0; k <= 10; k++) {
          const a = (0.2 + 0.6 * (k / 10)) * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
          row.push([Math.sign(ca) * Math.abs(ca) ** (2 / 2.2) * (w + o), yc + Math.abs(sa) ** (2 / 2.2) * (h + o), z]);
        }
        return row;
      });
      b.patch(rows, LEATHER, [0, 1, 0]);
    }
    for (const s of [-1, 1]) loop(b, [s * 0.075, 1.555, gz], [1, 0, 0], [0, 1, 0], 0.03, 0.007, NICKEL, 8);
    // the shaft tugs: loops on the girth that the shafts ride in
    for (const s of [-1, 1]) loop(b, [s * 0.39, 1.12, gz], [0, 1, 0], [s, 0, 0], 0.04, 0.012, LEATHER, 8);
  }, T);
  // neck strap over the neck, from the collar
  sb.add((b) => {
    const s0 = NECK[1], s1 = NECK[2], f = 0.35;
    const L = (k) => s0[k] + (s1[k] - s0[k]) * f;
    const T2 = norm3([0, s1[1] - s0[1], s1[0] - s0[0]]);
    sweep(b, [-0.022, 0.022].map((dt) => ({ c: [0, L(1) + T2[1] * dt, L(0) + T2[2] * dt], w: L(2) + 0.012, u: L(3) + 0.012, d: L(4) + 0.012, col: LEATHER })), 14);
  }, neckW);
  // breeching round the quarters, a hip strap over the croup, straps to the shafts
  sb.add((b) => {
    const pts = [];
    for (let k = 0; k <= 12; k++) { const z = 1.0 - (k / 12) * 0.47; pts.push([bodyX(z, 1.06) + 0.012, z]); }
    const ring = [...pts, ...pts.slice().reverse().map(([x, z]) => [-x, z])];
    for (let k = 0; k < ring.length - 1; k++) {
      const [xa, za] = ring[k], [xc, zc] = ring[k + 1];
      if (Math.abs(xa) < 0.005 && Math.abs(xc) < 0.005) continue;
      const nx = (zc - za), nz = -(xc - xa), l = Math.hypot(nx, nz) || 1;
      b.quad([xa, 1.03, za], [xc, 1.03, zc], [xc, 1.10, zc], [xa, 1.10, za], [nx / l, 0, nz / l], [0, 0, 1, 0, 1, 1, 0, 1], LEATHER);
    }
    // hip strap: over the croup at z 0.80
    sweep(b, [0.86, 0.90].map((z) => { const [, top, bot, w] = bodyAt(z); return { c: [0, (top + bot) / 2, z], w: w + 0.01, u: (top - bot) / 2 + 0.01, d: 0.0, col: LEATHER }; }), 12);
    for (const s of [-1, 1]) rope(b, [[s * (bodyX(1.0, 1.07) + 0.012), 1.07, 1.0], [s * 0.42, 1.06, 1.0]], 0.012, 4, LEATHER);
  }, T);
  // the bridle: crownpiece, browband, cheekpieces, noseband, blinkers, bit
  sb.add((b) => {
    const band = (t, dt, grow) => {
      const rows = [t - dt, t + dt].map((tt) => {
        const i = HEAD.findIndex((h) => h[0] >= tt);
        const h = HEAD[Math.max(0, i)];
        return { c: headPt(tt, 0), w: h[1] + grow, u: h[2] + grow, d: h[3] + grow, col: LEATHER };
      });
      sweep(b, rows, 12);
    };
    band(0.01, 0.018, 0.012);   // crownpiece behind the ears
    band(0.46, 0.022, 0.01);    // noseband
    for (const s of [-1, 1]) {
      // cheekpiece: down the side of the face to the bit
      rope(b, [headPt(0.01, 0.0, s * 0.102), headPt(0.2, 0.0, s * 0.112), headPt(0.4, -0.01, s * 0.086), headPt(0.55, -0.03, s * 0.084)], 0.009, 4, LEATHER);
      // blinker: a cup standing off the eye
      const e = headPt(0.135, 0.045, s * 0.128);
      const a1 = [0, HEAD_D[1], HEAD_D[0]], a2 = [0, HEAD_D[0], -HEAD_D[1]];
      plate(b, e, a1, 0.042, a2, 0.04, LEATHER, 0.004);
      // bit ring at the corner of the mouth
      loop(b, headPt(0.565, -0.04, s * 0.086), [0, 1, 0], [0, 0, 1], 0.03, 0.006, NICKEL, 8);
    }
    // browband across the forehead under the ears
    rope(b, [headPt(0.03, 0.03, 0.1), headPt(0.045, 0.085, 0.05), headPt(0.045, 0.09, 0), headPt(0.045, 0.085, -0.05), headPt(0.03, 0.03, -0.1)], 0.01, 4, LEATHER);
  }, BI.head);
  // reins: from the bit through the terrets on the pad to the dash rail
  const reinW = (x, y, z) => {
    if (z > 2.35) return [[BI.head, 1]];
    if (z > 1.62) return mix2(T, BI.head, clamp((z - 1.62) / (2.35 - 1.62), 0, 1));
    return mix2(BI.cart, T, clamp((z + 0.56) / (1.62 + 0.56), 0, 1));
  };
  sb.add((b) => {
    for (const s of [-1, 1]) {
      const bit = headPt(0.565, -0.04, s * 0.11);
      const pts = [bit];
      // along the neck, a little slack under the crest
      for (const f of [0.25, 0.5, 0.75]) {
        const n = NECK[Math.round((1 - f) * (NECK.length - 1))];
        pts.push([s * (n[2] + 0.02), n[1] + n[3] * 0.45, n[0] + 0.02]);
      }
      pts.push([s * 0.075, 1.565, 1.62]);
      // slack between the terret and the dash: a gentle sag
      for (let k = 1; k <= 6; k++) {
        const f = k / 6, z = 1.62 + (-0.56 - 1.62) * f;
        pts.push([s * (0.075 + 0.045 * f), 1.565 + (1.40 - 1.565) * f - Math.sin(f * Math.PI) * 0.16, z]);
      }
      rope(b, pts, 0.008, 4, LEATHER);
    }
  }, reinW);
  // --- shafts, crossbar, singletree, traces: the horse carries the shafts'
  // front, the axle the back.
  const shaftW = (x, y, z) => mix2(BI.root, T, clamp((z - 0.1) / 1.1, 0, 1));
  sb.add((b) => {
    for (const s of [-1, 1]) {
      const P = [[0.37, 1.20, 2.10], [0.395, 1.16, 1.85], [0.41, 1.13, 1.60], [0.42, 1.08, 1.15], [0.44, 0.96, 0.55], [0.455, 0.80, 0.0], [0.46, 0.68, -0.40], [0.46, 0.56, -0.74]]
        .map(([x, y, z]) => [s * x, y, z]);
      rope(b, P, 0.021, 6, WOOD);
      // the tips are capped in steel
      b.tube(P[0], [s * 0.365, 1.205, 2.14], 0.023, 6, STEEL, true);
    }
    // crossbar between the shafts and the singletree hung from it
    rope(b, [[-0.46, 0.68, -0.40], [0.46, 0.68, -0.40]], 0.03, 6, WOOD);
    rope(b, [[-0.34, 0.74, -0.30], [0.34, 0.74, -0.30]], 0.025, 6, WOOD);
    b.tube([0, 0.68, -0.40], [0, 0.74, -0.30], 0.012, 4, IRON, false);
    // traces, collar to singletree
    for (const s of [-1, 1]) {
      const a = [s * (bodyX(1.76, 1.19) + 0.02), 1.19, 1.74], c = [s * 0.34, 0.74, -0.30];
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const f = k / 6;
        pts.push([a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f - Math.sin(f * Math.PI) * 0.05, a[2] + (c[2] - a[2]) * f]);
      }
      rope(b, pts, 0.014, 4, LEATHER);
    }
  }, shaftW);
  // --- front axle: the bolster, the transverse spring, the axle and its clips
  sb.add((b) => {
    b.box(0, CART.fr - 0.03, K_Z, 2 * CART.track - 0.1, 0.06, 0.06, 0, IRON);
    b.box(0, 0.62, K_Z, 1.05, 0.05, 0.07, 0, IRON);
    // the elliptic spring: two leaves bowed apart
    for (const s of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 8; k++) { const f = k / 8, x = -0.5 + f; pts.push([x, 0.70 + s * 0.035 * Math.sin(f * Math.PI), K_Z]); }
      rope(b, pts, 0.012, 4, IRON);
    }
  }, BI.root);
  // --- the wheels, each on its own bone
  for (const [nm, x, y, z, r, nsp] of [['wfl', CART.track, CART.fr, K_Z, CART.fr, 14], ['wfr', -CART.track, CART.fr, K_Z, CART.fr, 14],
    ['wrl', CART.track, CART.rr, CART.rz, CART.rr, 16], ['wrr', -CART.track, CART.rr, CART.rz, CART.rr, 16]]) {
    sb.add((b) => spokedWheel(b, x, y, z, r, Math.sign(x), nsp), BI[nm]);
  }
  RIG_GEO = sb.build();
  RIG_GEO.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.1, 0), 4.2);
  return RIG_GEO;
}

let BONE_INV = null;
const MATS = [];
// a bay, a dark bay and a brown: the coat tinted per horse, the black points stay black
const COATS = [[1, 1, 1], [0.72, 0.72, 0.78], [0.9, 0.74, 0.62]];
function rigMaterial(k) {
  if (!MATS[k]) {
    MATS[k] = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.0, envMapIntensity: 0.6 });
    MATS[k].color.setRGB(...COATS[k]);
  }
  return MATS[k];
}

/** A fresh skeleton at bind pose; bones in BONE_DEFS order. */
function makeBones() {
  const bones = BONE_DEFS.map(([nm]) => { const b = new THREE.Bone(); b.name = nm; return b; });
  BONE_DEFS.forEach(([, p, w], i) => {
    if (p < 0) bones[i].position.set(w[0], w[1], w[2]);
    else {
      const q = BONE_DEFS[p][2];
      bones[i].position.set(w[0] - q[0], w[1] - q[1], w[2] - q[2]);
      bones[p].add(bones[i]);
    }
  });
  return bones;
}

// ---------------------------------------------------------------------------
// The cart: vehicles.js HAND_BUILT.buggy. Paint is the box body (lacquered
// black), matte the vinyl top, the seat, the running gear, the triangle and
// the driver (crew), trim the glass, lamps and reflectors.
// ---------------------------------------------------------------------------

export function buildBuggy(spec, paint, trim, matte) {
  const z0 = -2.82, z1 = -0.66, X = 0.60, FLOOR = 0.86, BELT = 1.30;
  const zc = (z0 + z1) / 2, L = z1 - z0;
  // the box: floor, sides, back, and a dash that sweeps up and forward
  paint.box(0, FLOOR - 0.06, zc, 2 * X, 0.06, L, 0, WHITE);
  for (const s of [-1, 1]) paint.box(s * (X - 0.015), FLOOR - 0.06, zc, 0.03, BELT - FLOOR + 0.06, L, 0, WHITE);
  paint.box(0, FLOOR - 0.06, z0 + 0.015, 2 * X, BELT - FLOOR + 0.06, 0.03, 0, WHITE);
  {
    const prof = [[z1, FLOOR - 0.06], [z1 + 0.02, 1.0], [z1 + 0.06, 1.16], [z1 + 0.13, 1.29], [z1 + 0.21, 1.37]];
    for (const t of [0, 0.025]) {
      const rows = prof.map(([z, y]) => [[-X, y, z - t], [X, y, z - t]]);
      paint.patch(rows, WHITE, t === 0 ? [0, 0.3, 1] : [0, -0.3, -1]);
    }
    // its top rail, where the reins are looped
    paint.box(0, 1.355, z1 + 0.21, 2 * X, 0.03, 0.05, 0, WHITE);
  }
  // a lacquered moulding along the box's top edge
  for (const s of [-1, 1]) paint.box(s * (X + 0.005), BELT - 0.03, zc, 0.03, 0.04, L + 0.02, 0, WHITE);
  // --- the top: vinyl over a frame, closed at the back and along the sides
  // behind the seat, open at the front with the storm curtain rolled up
  const ROOF = 2.26, zt0 = z0 - 0.02, zt1 = -0.98, zs = -1.70;
  {
    // roof: a gentle crown across, a little overhang
    const rows = [];
    for (let i = 0; i <= 6; i++) {
      const z = zt0 + (zt1 - zt0) * (i / 6), row = [];
      for (let j = 0; j <= 8; j++) { const x = -X - 0.04 + (2 * X + 0.08) * (j / 8); row.push([x, ROOF + 0.06 * (1 - (x / (X + 0.04)) ** 2), z]); }
      rows.push(row);
    }
    matte.patch(rows, VINYL, [0, 1, 0]);
    matte.patch(rows.map((r) => r.map(([x, y, z]) => [x, y - 0.025, z])), VINYL, [0, -1, 0]);
    // the roof's edge, a dark bead all round
    for (const s of [-1, 1]) matte.box(s * (X + 0.04), ROOF - 0.035, (zt0 + zt1) / 2, 0.025, 0.04, zt1 - zt0, 0, VINYL);
    matte.box(0, ROOF - 0.035, zt0, 2 * X + 0.1, 0.04, 0.025, 0, VINYL);
    // the storm curtain rolled up under the front edge
    matte.tube([-X, ROOF - 0.07, zt1 + 0.02], [X, ROOF - 0.07, zt1 + 0.02], 0.05, 8, VINYL, true);
  }
  // side panels (window in each), the back panel (a small window), the posts
  const WIN = { y0: 1.62, y1: 1.92, za: -2.38, zb: -1.86 };
  for (const s of [-1, 1]) {
    const x = s * (X - 0.012);
    const pan = (y0, y1, za, zb) => matte.box(x, y0, (za + zb) / 2, 0.024, y1 - y0, zb - za, 0, VINYL);
    pan(BELT, WIN.y0, z0, zs);
    pan(WIN.y1, ROOF, z0, zs);
    pan(WIN.y0, WIN.y1, z0, WIN.za);
    pan(WIN.y0, WIN.y1, WIN.zb, zs);
    // the quarter window
    trim.quad([s * X, WIN.y0, WIN.za], [s * X, WIN.y0, WIN.zb], [s * X, WIN.y1, WIN.zb], [s * X, WIN.y1, WIN.za], [s, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], GLASS);
    // the front posts and the door's post at the seat
    matte.box(s * (X - 0.02), BELT, zt1 + 0.03, 0.035, ROOF - BELT, 0.035, 0, VINYL);
    matte.box(s * (X - 0.02), BELT, zs, 0.04, ROOF - BELT, 0.04, 0, VINYL);
  }
  {
    const y0 = 1.66, y1 = 1.90, xw = 0.24, z = z0 + 0.012;
    const pan = (xa, xb, ya, yb) => matte.box((xa + xb) / 2, ya, z, xb - xa, yb - ya, 0.024, 0, VINYL);
    pan(-X, X, BELT, y0); pan(-X, X, y1, ROOF); pan(-X, -xw, y0, y1); pan(xw, X, y0, y1);
    trim.quad([-xw, y0, z0], [xw, y0, z0], [xw, y1, z0], [-xw, y1, z0], [0, 0, -1], [0, 0, 1, 0, 1, 1, 0, 1], GLASS);
  }
  // inside: the bench and its back, a lap robe over the floor's front
  matte.box(0, 1.24, -1.50, 2 * X - 0.08, 0.12, 0.46, 0, SEAT);
  matte.box(0, FLOOR, -1.50, 2 * X - 0.08, 1.24 - FLOOR, 0.40, 0, lin(0.06, 0.06, 0.07));
  matte.box(0, 1.34, -1.76, 2 * X - 0.08, 0.40, 0.07, 0, SEAT);
  matte.box(0, FLOOR, -1.0, 2 * X - 0.06, 0.012, 0.6, 0, lin(0.10, 0.08, 0.07));
  // --- running gear in the cart's frame: rear axle and springs, the reach,
  // the fifth wheel's ring under the front, a step each side
  matte.box(0, CART.rr - 0.03, CART.rz, 2 * CART.track - 0.1, 0.06, 0.06, 0, IRON);
  for (const s of [-1, 1]) {
    for (const sg of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 8; k++) { const f = k / 8; pts.push([s * 0.48, 0.71 + sg * 0.07 * Math.sin(f * Math.PI), CART.rz - 0.40 + 0.80 * f]); }
      for (let k = 0; k < pts.length - 1; k++) matte.tube(pts[k], pts[k + 1], 0.012, 4, IRON, false);
    }
    // the step: a hanger and a tread plate below the door
    matte.tube([s * (X - 0.02), FLOOR - 0.05, -1.25], [s * (X + 0.10), 0.52, -1.25], 0.012, 4, IRON, false);
    matte.box(s * (X + 0.10), 0.505, -1.25, 0.12, 0.02, 0.16, 0, IRON);
  }
  matte.tube([0, 0.66, CART.rz], [0, 0.66, K_Z], 0.028, 6, WOOD, false);
  {
    const pts = [];
    for (let k = 0; k <= 16; k++) { const a = (k / 16) * Math.PI * 2; pts.push([Math.cos(a) * 0.34, 0.76, K_Z + Math.sin(a) * 0.30]); }
    for (let k = 0; k < 16; k++) matte.tube(pts[k], pts[k + 1], 0.014, 4, IRON, false);
  }
  // --- the back: the slow-moving-vehicle triangle (fluorescent orange in a
  // red reflective border, point up), red reflectors and amber lamps
  {
    const z = z0 - 0.006, cy = 1.04, R0 = 0.235, R1 = 0.17;
    const tri = (R, zz, col) => {
      const P = (k) => { const a = Math.PI / 2 + (k * 2 * Math.PI) / 3; return [Math.cos(a) * R, cy + Math.sin(a) * R, zz]; };
      matte.tri(P(0), P(1), P(2), [0, 0, -1], col);
    };
    tri(R0, z, SMV_RED);
    tri(R1, z - 0.004, SMV_OR);
    for (const s of [-1, 1]) {
      trim.box(s * 0.48, 0.98, z0 - 0.01, 0.07, 0.07, 0.012, 0, TAIL_RED);
      trim.box(s * (X - 0.03), ROOF - 0.12, z0 - 0.02, 0.05, 0.07, 0.03, 0, AMBER);
    }
    // a lantern bracket at each front post
    for (const s of [-1, 1]) {
      matte.box(s * (X + 0.05), 1.50, zt1 + 0.03, 0.07, 0.12, 0.07, 0, IRON);
      trim.box(s * (X + 0.05), 1.53, zt1 + 0.067, 0.05, 0.06, 0.005, 0, [1.0, 0.95, 0.82]);
    }
  }
  // --- the contact shadow under the cart (vehicles.js would lay one under the
  // whole 6.3 m rig, horse and all; this one turns with the cart)
  {
    const il = 1.05, iw = 0.62, ol = 1.5, ow = 0.98, cz = (z0 + z1) / 2 - 0.15, y = 0.08, A = 0.62;
    const c = (a) => [a, SHADOW_G, SHADOW_B];
    const P = (x, z) => [x, y, cz + z];
    const up = [0, 1, 0], uv = [0, 0, 1, 0, 1, 1, 0, 1];
    trim.quad(P(-iw, -il), P(iw, -il), P(iw, il), P(-iw, il), up, uv, c(A));
    const ring = [[-iw, -il, -ow, -ol], [iw, -il, ow, -ol], [iw, il, ow, ol], [-iw, il, -ow, ol]];
    for (let k = 0; k < 4; k++) {
      const [ax, az, oax, oaz] = ring[k], [bx, bz, obx, obz] = ring[(k + 1) % 4];
      const sa = k % 2 === 0 ? P(ax, oaz) : P(oax, az), sbb = k % 2 === 0 ? P(bx, obz) : P(obx, bz);
      trim.quad(P(ax, az), P(bx, bz), sbb, sa, up, uv, [c(A), c(A), c(0), c(0)]);
      trim.quad(P(ax, az), k % 2 === 0 ? P(ax, oaz) : P(oax, az), P(oax, oaz), k % 2 === 0 ? P(oax, az) : P(ax, oaz), up, uv, [c(A), c(0), c(0), c(0)]);
    }
  }
  // --- the driver, on the left of the bench (crew: only while driven). Black
  // coat and trousers, white shirt at the collar, a black broad-brimmed hat.
  {
    const cr = matte.crew, x = 0.22, hz = -1.56, hy = 1.40;
    sweep(cr, [
      { c: [x, hy - 0.02, hz], w: 0.19, u: 0.12, d: 0.12, col: COATB },
      { c: [x, hy + 0.18, hz + 0.02], w: 0.18, u: 0.11, d: 0.11, col: COATB },
      { c: [x, hy + 0.40, hz + 0.05], w: 0.205, u: 0.11, d: 0.10, col: COATB },
      { c: [x, hy + 0.47, hz + 0.06], w: 0.17, u: 0.09, d: 0.08, col: COATB },
      { c: [x, hy + 0.51, hz + 0.065], w: 0.07, u: 0.055, d: 0.05, col: SHIRT },
      { c: [x, hy + 0.56, hz + 0.065], w: 0.055, u: 0.05, d: 0.045, col: SKIN },
    ], 10, { capA: true });
    cr.spheroid(x, hy + 0.66, hz + 0.08, 0.098, 10, 7, SKIN, 1.18);
    // hat: crown and a broad flat brim
    cr.tube([x, hy + 0.70, hz + 0.075], [x, hy + 0.80, hz + 0.075], 0.092, 12, COATB, true);
    cr.tube([x, hy + 0.695, hz + 0.075], [x, hy + 0.71, hz + 0.075], 0.19, 14, COATB, true);
    for (const s of [-1, 1]) {
      // arms forward to the reins, legs to the floor
      const sh = [x + s * 0.19, hy + 0.42, hz + 0.05], el = [x + s * 0.21, hy + 0.16, hz + 0.24], ha = [x + s * 0.08, hy + 0.14, hz + 0.50];
      cr.tube(sh, el, 0.05, 6, COATB, true);
      cr.tube(el, ha, 0.042, 6, COATB, true);
      cr.spheroid(ha[0], ha[1], ha[2] + 0.04, 0.04, 6, 4, SKIN);
      const hip = [x + s * 0.09, hy + 0.02, hz + 0.04], kn = [x + s * 0.10, hy + 0.04, hz + 0.46], ft = [x + s * 0.11, FLOOR + 0.06, hz + 0.58];
      cr.tube(hip, kn, 0.075, 6, COATB, true);
      cr.tube(kn, ft, 0.058, 6, COATB, true);
      cr.box(ft[0], FLOOR, ft[2] + 0.05, 0.10, 0.07, 0.26, 0, lin(0.03, 0.03, 0.03));
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Per vehicle: the rig and its animation
// ---------------------------------------------------------------------------

// Leg order LF RF LH RH. Phase offsets are touchdown times in the stride.
const GAITS = [
  // walk: four-beat, lateral sequence LH LF RH RF; legs overlap on the ground
  { off: [0.25, 0.75, 0, 0.5], duty: 0.62, lift: [0.11, 0.09], flex: 1.0, S: (v) => 1.15 + 0.32 * v, bob: 0, nod: 0.07, nodK: 2 },
  // trot: diagonal pairs, a moment of suspension between
  { off: [0, 0.5, 0.5, 0], duty: 0.42, lift: [0.21, 0.15], flex: 1.5, S: (v) => 1.45 + 0.38 * v, bob: 0.03, nod: 0.02, nodK: 2 },
  // canter, right lead: LH, then RH with LF, then RF, then suspension
  { off: [0.3, 0.46, 0, 0.3], duty: 0.36, lift: [0.21, 0.17], flex: 1.5, S: (v) => 1.75 + 0.42 * v, bob: 0.045, nod: 0.13, nodK: 1 },
];
const WALK_TROT = 2.3, TROT_WALK = 2.0, TROT_CANTER = 5.6, CANTER_TROT = 5.1;
const A_MAX = [0.40, 0.44, 0.48];   // half the stance's travel the legs can make, per gait

let CAM = null;   // the camera's position (Buggies.update): animation LOD
const FALLS = [];   // footfalls for the sound: { v, leg }

/** Make a buggy's horse and wheels (Vehicle constructor). */
export function attachBuggy(v) {
  const geo = rigGeometry();
  const bones = makeBones();
  const mesh = new THREE.SkinnedMesh(geo, rigMaterial(Math.floor(hash2((v.color | 0) + 7, 3) * 3) % 3));
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  if (!BONE_INV) {
    const sk0 = new THREE.Skeleton(bones);
    BONE_INV = sk0.boneInverses.map((m) => m.clone());
  }
  const skel = new THREE.Skeleton(bones, BONE_INV.map((m) => m.clone()));
  mesh.bind(skel, new THREE.Matrix4());
  mesh.boundingSphere = geo.boundingSphere;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.name = 'buggyHorse';
  mesh.userData.shared = true;   // traffic.remove: the geometry is everyone's
  for (const bn of bones) bn.rotation.order = 'YXZ';
  v.tilt.add(mesh);
  // black paint on wood, semi-gloss: not a car's lacquer, which mirrored the sky grey
  const pm = v.bodyMat;
  pm.metalness = 0.0; pm.roughness = 0.5; pm.envMapIntensity = 0.6;
  if (pm.clearcoat !== undefined) { pm.clearcoat = 0.3; pm.clearcoatRoughness = 0.3; }
  v.extra = mesh;   // also keeps it out of traffic's far LOD (which would draw no horse)
  const seed = hash2(v.color | 0, 11);
  return {
    mesh, bones,
    ph: seed, gait: 0, gw: [1, 0, 0], spd: 0, mv: 0,
    px: NaN, pz: NaN, ph0: [0, 0, 0, 0], h0: NaN, turn: 0,
    ax: NaN, az: NaN, art: 0, sf: 0, sr: 0,
    bob: 0, pitch: 0, t: -1, still: 0, rest: 0, restLeg: 2 + (seed > 0.5 ? 1 : 0), seed, skip: 0,
    falls: 0, startT: 0,
  };
}

/** Two-bone solve in the trunk's frame; writes the leg's three rotations. */
function solveLeg(R, i, ty, tz, flex, pitch) {
  const fore = i < 2, rig = fore ? RIG_F : RIG_H, J = fore ? FORE_J : HIND_J;
  const up = R.bones[BI[`up${i}`]], lo = R.bones[BI[`lo${i}`]], pa = R.bones[BI[`pa${i}`]];
  // the fetlock target, in the rig: the hoof's contact point less the pastern
  const fy = ty - rig.hy, fz = tz - rig.hz;
  // into the trunk's frame (bob, pitch about the trunk's pivot)
  const TP = BONE_DEFS[BI.trunk][2];
  const wy = fy - (TP[1] + R.bob), wz = fz - TP[2];
  const c = Math.cos(pitch), s = Math.sin(pitch);
  const ly = wy * c + wz * s, lz = -wy * s + wz * c;
  const dy = ly - (J.root[0] - TP[1]), dz = lz - (J.root[1] - TP[2]);
  let D = Math.hypot(dy, dz);
  const Dmax = (rig.L1 + rig.L2) * 0.9995, Dmin = Math.abs(rig.L1 - rig.L2) + 0.02;
  D = clamp(D, Dmin, Dmax);
  const phi = angOf(dz, dy);
  const ca = clamp((rig.L1 * rig.L1 + D * D - rig.L2 * rig.L2) / (2 * rig.L1 * D), -1, 1);
  const al = Math.acos(ca);
  // fore: the knee forward of the line; hind: the hock behind it
  const p1 = fore ? phi - al : phi + al;
  const kz = -Math.sin(p1) * rig.L1, ky = -Math.cos(p1) * rig.L1;
  const p2 = angOf(dz - kz, dy - ky);
  const r1 = p1 - rig.a1, r2 = p2 - rig.a2 - r1;
  up.rotation.x = r1;
  lo.rotation.x = r2;
  pa.rotation.x = flex - pitch - r1 - r2;
}

/** The pose and the cart, every frame (Vehicle.sync). */
export function syncBuggy(v) {
  const R = v.buggy;
  const now = performance.now() / 1000;
  const dt = R.t < 0 ? 0 : clamp(now - R.t, 0, 0.1);
  R.t = now;
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  // how far the horse went since last time, along itself (any mode: driven,
  // placed by Buggies, shunted)
  let ds = 0;
  if (Number.isFinite(R.px)) {
    ds = (v.x - R.px) * fx + (v.z - R.pz) * fz;
    if (Math.abs(ds) > 4) ds = 0;   // a teleport
  }
  R.px = v.x; R.pz = v.z;
  if (Number.isFinite(R.h0) && dt > 0) R.turn = damp(R.turn, clamp(angleWrap(v.heading - R.h0) / dt, -1.5, 1.5), 5, dt);
  R.h0 = v.heading;
  // --- the cart: its rear axle dragged toward the kingpin
  {
    const kx = v.x + fx * K_Z, kz = v.z + fz * K_Z, L = CART.len;
    let ax = R.ax, az = R.az;
    const d0 = Math.hypot(ax - kx, az - kz);
    if (!Number.isFinite(d0) || Math.abs(d0 - L) > 0.6) { ax = kx - fx * L; az = kz - fz * L; }
    else { ax = kx + (ax - kx) / d0 * L; az = kz + (az - kz) / d0 * L; }
    let psi = Math.atan2(kx - ax, kz - az);
    let art = angleWrap(psi - v.heading);
    const LIM = 0.75;
    if (Math.abs(art) > LIM) {
      art = Math.sign(art) * LIM;
      psi = v.heading + art;
      ax = kx - Math.sin(psi) * L; az = kz - Math.cos(psi) * L;
    }
    if (Number.isFinite(R.ax)) R.sr += ((ax - R.ax) * Math.sin(psi) + (az - R.az) * Math.cos(psi)) / CART.rr;
    R.ax = ax; R.az = az; R.art = art;
    const sn = Math.sin(art), cs = Math.cos(art);
    for (const m of [v.paintMesh, v.trimMesh, v.matteMesh]) {
      m.rotation.y = art;
      m.position.set(-K_Z * sn, m.position.y, K_Z * (1 - cs));
    }
  }
  R.sf += ds / CART.fr;
  if (!v.group.visible) return;
  // far away: the pose every fourth frame
  if (CAM) {
    const d2 = (CAM.x - v.x) ** 2 + (CAM.z - v.z) ** 2;
    if (d2 > 140 * 140 && (R.skip++ & 3)) return;
  }
  pose(v, R, dt, ds);
}

function pose(v, R, dt, ds) {
  const B = R.bones;
  B[BI.cart].rotation.y = R.art;
  B[BI.wfl].rotation.x = B[BI.wfr].rotation.x = R.sf;
  B[BI.wrl].rotation.x = B[BI.wrr].rotation.x = R.sr;
  // --- gait from the speed, with hysteresis; weights cross-fade
  const spd = Math.abs(v.vLong);
  R.spd = dt > 0 ? damp(R.spd, spd, 6, dt) : spd;
  const s = R.spd;
  if (R.gait === 0 && s > WALK_TROT) R.gait = 1;
  else if (R.gait === 1 && s < TROT_WALK) R.gait = 0;
  else if (R.gait === 1 && s > TROT_CANTER) R.gait = 2;
  else if (R.gait === 2 && s < CANTER_TROT) R.gait = 1;
  for (let g = 0; g < 3; g++) R.gw[g] = dt > 0 ? damp(R.gw[g], g === R.gait ? 1 : 0, 5, dt) : (g === R.gait ? 1 : 0);
  const gsum = R.gw[0] + R.gw[1] + R.gw[2];
  let S = 0;
  for (let g = 0; g < 3; g++) S += GAITS[g].S(s) * R.gw[g] / gsum;
  R.ph = (R.ph + ds / S) % 1;
  if (R.ph < 0) R.ph += 1;
  // moving at all: below a slow walk the legs come home and stand square
  R.mv = dt > 0 ? damp(R.mv, sstep(0.08, 0.6, s), 6, dt) : sstep(0.08, 0.6, s);
  // standing a while (unattended): rest a hind leg
  R.still = s < 0.05 ? R.still + dt : 0;
  const resting = R.still > 3 && (v.mode === 'apron' || v.mode === 'parked' || v.mode === 'free');
  R.rest = dt > 0 ? damp(R.rest, resting ? 1 : 0, 1.5, dt) : (resting ? 1 : 0);
  // --- hoof targets
  const tgt = [];
  let needF = 0, needH = 0;
  const bobT = [];
  for (let i = 0; i < 4; i++) {
    const fore = i < 2, J = fore ? FORE_J : HIND_J;
    let dz = 0, dy = 0, fl = 0, stance = 0;
    for (let g = 0; g < 3; g++) {
      const w = R.gw[g] / gsum;
      if (w < 0.001) continue;
      const G2 = GAITS[g];
      const A0 = A_MAX[g], Sg = GAITS[g].S(s);
      const D = Math.min(G2.duty, Math.max(0.3, (2 * A0) / Sg));
      const A = Math.min(A0, (Sg * D) / 2);
      let p = (R.ph + G2.off[i]) % 1;
      if (p < 0) p += 1;
      if (p < D) {
        const u = p / D;
        dz += w * A * (1 - 2 * u);
        stance += w;
      } else {
        const q = (p - D) / (1 - D), e = q * q * (3 - 2 * q);
        dz += w * A * (-1 + 2 * e);
        dy += w * G2.lift[fore ? 0 : 1] * Math.sin(Math.PI * Math.min(1, q * 1.12)) ** 1.2;
        fl += w * G2.flex * Math.sin(Math.PI * q);
      }
      // footfall: the dominant gait's touchdown
      if (g === R.gait && R.mv > 0.6) {
        const pp = R.ph0[i];
        if ((ds > 0 && pp > 0.75 && p < 0.25) || (ds < 0 && pp < 0.25 && p > 0.75)) { FALLS.push({ v, leg: i }); R.falls++; }
        R.ph0[i] = p;
      }
    }
    const m = R.mv;
    dz *= m; dy *= m; fl *= m;
    // the resting hind leg: hip dropped, hoof forward and tipped on its toe
    if (i === R.restLeg && R.rest > 0.01) {
      dz += R.rest * 0.08; dy += R.rest * 0.035; fl += R.rest * 0.75;
    }
    tgt.push([J.hoof[0] + dy, J.hoof[1] + dz, fl]);
    // how low the root must come for this planted hoof to stay planted
    const st = (1 - m) + m * stance;
    if (st > 0.3 && dy < 0.02) {
      const rig = fore ? RIG_F : RIG_H;
      const hz = rig.rz - dz;   // root ahead of the fetlock
      const reach = Math.sqrt(Math.max(0, ((rig.L1 + rig.L2) * 0.997) ** 2 - hz * hz));
      const need = Math.min(0, reach - rig.rh);
      if (fore) needF = Math.min(needF, need); else needH = Math.min(needH, need);
    }
    bobT.push(st);
  }
  // trunk: dips where a planted leg needs it; the trot's spring and the
  // canter's rock on top; the resting leg drops its hip
  const ph = R.ph;
  let springB = 0, rock = 0, nod = 0;
  for (let g = 0; g < 3; g++) {
    const w = R.gw[g] / gsum * R.mv;
    const G2 = GAITS[g];
    if (g === 1) springB += w * G2.bob * (0.5 + 0.5 * Math.cos(4 * Math.PI * (ph - G2.duty / 2)));
    if (g === 2) { springB += w * G2.bob * (0.5 + 0.5 * Math.cos(2 * Math.PI * (ph - 0.35))); rock += w * 0.05 * Math.sin(2 * Math.PI * (ph - 0.1)); }
    nod += w * G2.nod * Math.cos(G2.nodK * 2 * Math.PI * (ph - G2.off[0]));
  }
  const fz = FORE_J.root[1] - BONE_DEFS[BI.trunk][2][2], hz = HIND_J.root[1] - BONE_DEFS[BI.trunk][2][2];
  let pitchW = (needF - needH) / (hz - fz);   // + lowers the front
  pitchW = clamp(pitchW, -0.08, 0.08);
  let bobW = needF + fz * Math.sin(pitchW) - springB;
  bobW = clamp(bobW, -0.09, 0);
  R.bob = dt > 0 ? damp(R.bob, bobW, 18, dt) : bobW;
  R.pitch = dt > 0 ? damp(R.pitch, pitchW + rock, 18, dt) : pitchW + rock;
  const trunk = B[BI.trunk];
  const TP = BONE_DEFS[BI.trunk][2];
  trunk.position.y = TP[1] + R.bob;
  trunk.rotation.x = R.pitch;
  trunk.rotation.z = (R.restLeg === 2 ? -1 : 1) * 0.025 * R.rest;
  for (let i = 0; i < 4; i++) solveLeg(R, i, tgt[i][0], tgt[i][1], tgt[i][2], R.pitch);
  // --- neck and head: the walk's and canter's nod, into the turn, and at
  // rest the small movements of a horse waiting
  const t = performance.now() / 1000 + R.seed * 100;
  const idle = 1 - R.mv;
  const neck = B[BI.neck], head = B[BI.head], tail = B[BI.tail];
  neck.rotation.x = nod - R.pitch * 0.6 + idle * (0.05 * Math.sin(t * 0.31) + 0.025 * Math.sin(t * 0.83 + 1));
  neck.rotation.y = clamp(R.turn * 0.32, -0.32, 0.32) + idle * 0.12 * Math.sin(t * 0.17 + 2);
  head.rotation.x = -nod * 0.4 + idle * 0.04 * Math.sin(t * 0.53);
  head.rotation.y = clamp(R.turn * 0.2, -0.2, 0.2);
  // the tail: carried out a little with pace, swished at flies
  const swish = Math.max(0, Math.sin(t * 0.21 + 1)) ** 3;
  tail.rotation.z = 0.32 * swish * Math.sin(t * 2.3) + R.mv * 0.05 * Math.sin(2 * Math.PI * ph * 2);
  tail.rotation.x = -0.18 * sstep(1, 8, s) + R.mv * 0.04 * Math.sin(4 * Math.PI * ph);
}

/** The horn of a buggy is the horse: a whinny, not too often. */
export function buggyHorn(v, audio) {
  const now = performance.now();
  if (!audio || !audio.ready || now < (v.buggy._hornT || 0)) return;
  v.buggy._hornT = now + 1800;
  audio.play('whinny', { gain: 0.8 });
}

// ---------------------------------------------------------------------------
// Buggies: the parked ones and the ones on the road
// ---------------------------------------------------------------------------

// The country north and west of Waterloo, where the buggies are: around St.
// Jacobs, Conestogo, Heidelberg, St. Clements. Not the city, not a freeway.
// (rural.js: the buggy warning signs go up in the same country)
const rural = mennoniteCountry;
const ROAD_CLS = { res: 1, st: 1, art: 1 };
const POOL = ON_PHONE ? 3 : 5, SPAWN_R = [140, 460], DROP_R = 700;
const SHOW_R = ON_PHONE ? 220 : 320;
// Parked: [x, z, heading]. The market's horse sheds, and farmyards.
export const BUGGY_SPOTS = [
  // the horse shed at the St. Jacobs Farmers' Market: noses to its north side
  [-6700.0, -6505.2, 0], [-6697.3, -6505.2, 0], [-6694.6, -6505.2, 0], [-6691.9, -6505.2, 0],
  // farmyards, each facing its lane (found by a probe: open, level, dry ground
  // 8 m off the road beside the buildings)
  [-14097, -8288, -1.71], [-13061, -7742, 3.03], [-11762, -7875, -1.44], [-11012, -13415, 1.45],
];
const COLS = [0x141518, 0x17171a, 0x121314, 0x19181a];

export class Buggies {
  /**
   * `spots`: [x, z, heading] parked buggies ('apron', never despawned): the
   * St. Jacobs market's horse sheds and a few farmyards.
   */
  constructor(traffic, city, spots = []) {
    this.traffic = traffic; this.city = city; this.audio = null;
    this.riders = [];
    this.parked = [];
    this.spawnT = 0; this.seq = 0;
    this.stats = { spawned: 0, junctions: 0, uturns: 0, falls: 0 };
    this._pv = null; this._stillT = 0;
    traffic.buggies = this;
    for (const [x, z, h] of spots) {
      const v = traffic.spawnAt(x, z, h, 'buggy', COLS[this.seq++ % COLS.length], 'apron');
      v.vLong = 0;
      this.parked.push(v);
    }
  }

  /** Can a buggy drive this edge? A ground-level two-way country road. */
  ok(ei) {
    const e = this.city.edges[ei];
    // (a country road from the data -- rural.js -- in the Mennonite country)
    if (!e || e.elev || e.tunnel || e.oneway || !ROAD_CLS[e.cls] || e.noTraffic || !e.rural) return false;
    const a = this.city.nodes[e.a], b = this.city.nodes[e.b];
    return rural((a.x + b.x) / 2, (a.z + b.z) / 2);
  }

  update(dt, player, camera) {
    if (camera) CAM = camera.position;
    const p = player.position;
    this._sound(player, dt);
    // riders: drop the ones taken, wrecked or left far behind
    for (let i = this.riders.length - 1; i >= 0; i--) {
      const r = this.riders[i], v = r.v;
      if (v.mode !== 'path' || v.dead) { this.riders.splice(i, 1); continue; }
      if (Math.hypot(v.x - p.x, v.z - p.z) > DROP_R) { this._drop(v); this.riders.splice(i, 1); }
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.riders.length < POOL) {
      this.spawnT = 0.8;
      const a = Math.random() * Math.PI * 2, rr = SPAWN_R[0] + Math.random() * (SPAWN_R[1] - SPAWN_R[0]);
      const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
      if (rural(x, z)) this._spawnNear(x, z, p);
    }
    for (const r of this.riders) this._drive(r, dt, player);
  }

  _drop(v) {
    this.traffic.remove(v);
    if (v.buggy) v.buggy.mesh.skeleton.dispose();
  }

  /** A rider on the eligible road nearest (x, z), out of the player's way. */
  _spawnNear(x, z, p) {
    const city = this.city;
    let best = -1, bd = 150 * 150;
    for (const ei of city.edgesNear(x, z, 150)) {
      if (!this.ok(ei)) continue;
      const e = city.edges[ei], a = city.nodes[e.a], b = city.nodes[e.b];
      const d = (x - (a.x + b.x) / 2) ** 2 + (z - (a.z + b.z) / 2) ** 2;
      if (d < bd && e.len > 20) { bd = d; best = ei; }
    }
    if (best < 0) return null;
    const e = city.edges[best];
    const r = { v: null, ei: best, dir: Math.random() < 0.5 ? 1 : -1, t: e.len * (0.2 + Math.random() * 0.6),
      speed: 3.0 + Math.random() * 0.7, h: 0, x: 0, z: 0 };
    const q = this._at(r);
    if (Math.hypot(q.x - p.x, q.z - p.z) < SPAWN_R[0] * 0.8) return null;
    for (const o of this.traffic.cars) if (Math.abs(o.x - q.x) < 12 && Math.abs(o.z - q.z) < 12) return null;
    r.v = this.traffic.spawnAt(q.x, q.z, q.h, 'buggy', COLS[this.seq++ % COLS.length], 'path');
    r.h = q.h; r.x = q.x; r.z = q.z;
    r.v.vLong = r.speed;
    this.riders.push(r);
    this.stats.spawned++;
    return r;
  }

  /** Where rider r's lane is: `t` along its edge, kept to the right shoulder. */
  _at(r) {
    const e = this.city.edges[r.ei], A = this.city.nodes[r.dir > 0 ? e.a : e.b];
    const dx = e.dx * r.dir, dz = e.dz * r.dir;
    const h = Math.atan2(dx, dz);
    // a country road (rural.js): half on its gravel shoulder, keeping right;
    // a gravel road has no shoulder to speak of
    const off = e.rural ? (e.gravel ? e.hw - 1.0 : e.hw - 0.3) : clamp(e.hw - 1.3, 1.6, 4.2);
    return { x: A.x + dx * r.t - Math.cos(h) * off, z: A.z + dz * r.t + Math.sin(h) * off, h };
  }

  _drive(r, dt, player) {
    const v = r.v, city = this.city;
    const pos = player.position, d2 = (pos.x - v.x) ** 2 + (pos.z - v.z) ** 2;
    v.group.visible = d2 < SHOW_R * SHOW_R;
    // someone in the lane ahead (you, a car): ease up behind them
    let want = r.speed;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const ahead = (ox, oz, rad) => {
      const ax = ox - v.x, az = oz - v.z, al = ax * fx + az * fz, lat = Math.abs(ax * fz - az * fx);
      if (al > 0 && al < 16 && lat < 1.8 + rad * 0.4) want = Math.min(want, Math.max(0, (al - 4.5 - rad) * 0.5));
    };
    if (!player.vehicle || player.vehicle !== v) ahead(pos.x, pos.z, 0);
    for (const o of this.traffic.cars) if (o !== v && Math.abs(o.x - v.x) < 20 && Math.abs(o.z - v.z) < 20) ahead(o.x, o.z, o.halfLen);
    v.vLong = damp(v.vLong, want, want < v.vLong ? 3 : 0.8, dt);
    r.t += v.vLong * dt;
    const e = city.edges[r.ei];
    if (r.t > e.len) {
      // on to another country road at this node, as straight on as it goes
      const node = r.dir > 0 ? e.b : e.a, n = city.nodes[node];
      const hIn = Math.atan2(e.dx * r.dir, e.dz * r.dir);
      let best = -1, bs = -Infinity;
      for (const ei of n.e) {
        if (ei === r.ei || !this.ok(ei)) continue;
        const f = city.edges[ei], dir = f.a === node ? 1 : -1;
        const turn = Math.abs(angleWrap(Math.atan2(f.dx * dir, f.dz * dir) - hIn));
        if (turn > 2.2) continue;
        const sc = -turn + Math.random() * 0.9;
        if (sc > bs) { bs = sc; best = ei; }
      }
      const over = r.t - e.len;
      if (best >= 0) {
        const f = city.edges[best];
        r.ei = best; r.dir = f.a === node ? 1 : -1; r.t = Math.min(over, f.len);
        this.stats.junctions++;
      } else {
        // the road ends (or leaves the country): come round
        r.dir = -r.dir; r.t = Math.max(0, e.len - over - 6);
        this.stats.uturns++;
      }
    }
    const q = this._at(r);
    // the horse leans into a bend rather than snapping onto the next lane
    const k = Math.min(1, dt * 2.2);
    r.x += (q.x - r.x) * k; r.z += (q.z - r.z) * k;
    const mv = Math.hypot(q.x - r.x, q.z - r.z);
    const hh = mv > 0.4 ? Math.atan2(q.x - r.x, q.z - r.z) : q.h;
    r.h += angleWrap(hh - r.h) * Math.min(1, dt * 3);
    v.x = r.x; v.z = r.z; v.heading = r.h;
    v.lift = city.roadLift(v.x, v.z);
    v.y = city.groundAt(v.x, v.z, v.y + 0.6, v.lift);
    const gf = G.terrainHeight(v.x + fx * 2.5, v.z + fz * 2.5), gb = G.terrainHeight(v.x - fx * 2.5, v.z - fz * 2.5);
    v.pitch = Math.atan2(gb - gf, 5);
    v.roll = 0;
    v.sync();
  }

  /** Hooves for every footfall near the camera; a snort when yours sets off. */
  _sound(player, dt) {
    const au = this.audio, pv = player.vehicle && player.vehicle.buggy ? player.vehicle : null;
    const live = au && au.ready;
    if (pv !== this._pv) {
      if (pv && live) au.play('snort', { gain: 0.6 });
      this._pv = pv; this._stillT = 0;
    }
    if (pv) {
      const sp = Math.abs(pv.vLong);
      if (sp < 0.15) this._stillT += dt;
      else {
        if (this._stillT > 2.5 && sp > 0.3 && live) au.play(Math.random() < 0.25 ? 'whinny' : 'snort', { gain: 0.6 });
        this._stillT = 0;
      }
    }
    if (!live) { FALLS.length = 0; return; }
    let n = 0;
    for (const f of FALLS) {
      const v = f.v;
      if (n >= 8) break;
      const own = v === pv;
      if (!own && (!CAM || (CAM.x - v.x) ** 2 + (CAM.z - v.z) ** 2 > 70 * 70)) continue;
      // hooves on tarmac clip and clop; on grass and gravel they thud
      const hard = v.lift > 0.02 || this.city.onRoad(v.x, v.z, 0.5);
      const o = { gain: own ? 0.55 : 0.9, rate: f.leg < 2 ? 1.05 : 0.94, send: 0.06 };
      if (!own) { o.x = v.x; o.y = v.y + 0.3; o.z = v.z; o.ref = 6; o.maxD = 80; }
      if (!hard) o.gain *= 0.7;
      au.play(hard ? 'hoof' : 'hoof_soft', o);
      n++; this.stats.falls++;
    }
    FALLS.length = 0;
  }

  /** The map's mark: the market's horse sheds. */
  places() {
    return [{ x: -6693, z: -6493, kind: 'buggy', name: 'Horse & Buggy Parking', label: 'Buggies', near: false,
      hello: 'The horse sheds at the St. Jacobs Farmers\' Market. Climb into a buggy: GAS walks on, then a trot and a canter; the horn whinnies' }];
  }
}
