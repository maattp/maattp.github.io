// THE RENTAL GO-KART (`kart` in vehicles.js TYPES; Erbsville Kartway, kartway.js).
//
// An open rental kart of the kind every outdoor track in Ontario ran: a low
// tubular chassis a hand's width off the ground, a moulded nose and side pods
// in the kart's colour, a black rear bumper right across the back wheels, a
// fibreglass bucket seat in the middle and a Honda-style single (a slanted
// cylinder, a red tank on top, a silver muffler) bolted beside it on the RIGHT,
// driving the solid rear axle by a chain. Small fat slicks. The driver, in a
// helmet, sits with his legs out under the front panel.
//
// Model axes as every vehicle: +z the nose, +y up, and the right-hand side is
// -x (vehicles.js "Kerb side is -x"). y = 0 is the ground.

const RF = 0.13, RR = 0.14;            // front 10 x 4.5-5, rear 11 x 7.1-5: rolling radius
const ZF = 0.52, ZR = -0.52;           // 1.04 m wheelbase
const XF = 0.50, XR = 0.60;            // wheel centres: front track ~1.13 m, rear ~1.39 m outside
const FRAME = [0.34, 0.35, 0.37];      // the chassis' tubes (painted silver-grey, matte)
const BLACK = [0.05, 0.05, 0.055];     // bumpers, floor tray, seat
const ALLOY = [0.62, 0.64, 0.67];
const STEEL = [0.45, 0.47, 0.5];
const HONDA = [0.62, 0.05, 0.04];      // the engine's tank
const ENGINE = [0.13, 0.135, 0.145];
const WHITE = [1, 1, 1];
const NUMBER = [0.92, 0.92, 0.88];     // the number board on the front panel
const HELMET = [0.9, 0.9, 0.88], VISOR = [0.03, 0.035, 0.045];

/** Ellipse ring for Builder.loft: [x, y] points round (cx, cy). */
function ring(hx, cy, hy, n = 12, cx = 0) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([cx + Math.cos(a) * hx, cy + Math.sin(a) * hy]);
  }
  return p;
}

/**
 * A thin plate through four corners (a b c d round its face) `t` thick
 * along `n`: both faces and the four edges, so it reads from either side.
 */
function slab(b, a, bb, c, d, t, n, col) {
  const off = (p, s) => [p[0] + n[0] * t * s, p[1] + n[1] * t * s, p[2] + n[2] * t * s];
  const F = [a, bb, c, d].map((p) => off(p, 0.5)), K = [a, bb, c, d].map((p) => off(p, -0.5));
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  b.quad(F[0], F[1], F[2], F[3], n, uv, col);
  b.quad(K[0], K[3], K[2], K[1], [-n[0], -n[1], -n[2]], uv, col);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // the edge's outward normal: across the plate's face from its middle
    const mx = (F[i][0] + F[j][0]) / 2 - (F[0][0] + F[2][0]) / 2, my = (F[i][1] + F[j][1]) / 2 - (F[0][1] + F[2][1]) / 2, mz = (F[i][2] + F[j][2]) / 2 - (F[0][2] + F[2][2]) / 2;
    b.quad(F[i], F[j], K[j], K[i], [mx, my, mz], uv, col);
  }
}

/** A ring of tube segments: a steering wheel's rim. */
function hoop(b, c, u, v, r, tr, n, col) {
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = [c[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r, c[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r, c[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r];
    if (prev) b.tube(prev, p, tr, 6, col, false);
    prev = p;
  }
}

/**
 * HAND_BUILT.kart: (spec, paint, trim, matte) -> wheels. `paint` is tinted
 * the kart's colour; `trim` is metallic; `matte` the rest.
 */
export function buildKart(spec, paint, trim, matte) {
  // --- the chassis: two main rails, cross members, the axles ------------------
  for (const s of [-1, 1]) {
    matte.tube([s * 0.22, 0.075, 0.74], [s * 0.29, 0.075, 0.12], 0.016, 6, FRAME, true);
    matte.tube([s * 0.29, 0.075, 0.12], [s * 0.31, 0.085, -0.72], 0.016, 6, FRAME, true);
    // the front's raised rails up to the steering bracket and the bumper mounts
    matte.tube([s * 0.22, 0.075, 0.74], [s * 0.16, 0.13, 0.86], 0.014, 6, FRAME, true);
    // bearing hangers for the rear axle, and the kingpin uprights
    matte.box(s * 0.30, 0.07, ZR, 0.05, 0.12, 0.09, 0, FRAME);
    matte.tube([s * 0.43, 0.06, ZF + 0.01], [s * 0.42, 0.21, ZF - 0.03], 0.014, 6, FRAME, true);
    trim.tube([s * 0.43, RF, ZF], [s * (XF - 0.06), RF, ZF], 0.011, 6, STEEL, true);
    // track rod from the column's arm to the kingpin's steering arm
    matte.tube([s * 0.03, 0.12, 0.58], [s * 0.40, 0.13, ZF - 0.06], 0.007, 5, STEEL, true);
  }
  matte.tube([-0.22, 0.075, 0.74], [0.22, 0.075, 0.74], 0.015, 6, FRAME, true);
  matte.tube([-0.29, 0.075, 0.12], [0.29, 0.075, 0.12], 0.015, 6, FRAME, true);
  matte.tube([-0.31, 0.085, -0.72], [0.31, 0.085, -0.72], 0.015, 6, FRAME, true);
  matte.tube([-0.43, 0.11, ZF], [0.43, 0.11, ZF], 0.016, 6, FRAME, true);          // front beam
  trim.tube([-0.66, RR, ZR], [0.66, RR, ZR], 0.02, 8, ALLOY, true);                 // rear axle
  trim.tube([0.12, RR, ZR], [0.13, RR, ZR], 0.085, 14, STEEL, true);              // brake disc
  matte.box(0.125, RR - 0.03, ZR + 0.07, 0.05, 0.06, 0.05, 0, [0.5, 0.08, 0.06]);  // its caliper
  // the floor tray, black, under the driver's legs and seat
  matte.box(0, 0.045, 0.16, 0.46, 0.012, 1.1, 0, BLACK);

  // --- the bodywork (paint): nose, front panel, side pods ----------------------
  paint.loft([
    { z: 0.60, pts: ring(0.30, 0.165, 0.105, 14) },
    { z: 0.70, pts: ring(0.37, 0.16, 0.10, 14) },
    { z: 0.84, pts: ring(0.38, 0.145, 0.08, 14) },
    { z: 0.95, pts: ring(0.33, 0.13, 0.06, 14) },
    { z: 1.00, pts: ring(0.24, 0.125, 0.04, 14) },
  ], WHITE, { capStart: true, capEnd: true });
  // the black lower lip of the nose, the bumper a rental kart leans on
  matte.loft([
    { z: 0.62, pts: ring(0.34, 0.085, 0.04, 12) },
    { z: 0.90, pts: ring(0.40, 0.08, 0.045, 12) },
    { z: 1.02, pts: ring(0.32, 0.085, 0.04, 12) },
  ], BLACK, { capStart: true, capEnd: true });
  // the front panel: a fairing standing up over the driver's shins, with the
  // number board on its face
  slab(paint, [-0.21, 0.22, 0.62], [0.21, 0.22, 0.62], [0.17, 0.40, 0.48], [-0.17, 0.40, 0.48], 0.018, [0, 0.62, 0.78], WHITE);
  slab(matte, [-0.13, 0.25, 0.611], [0.13, 0.25, 0.611], [0.11, 0.36, 0.526], [-0.11, 0.36, 0.526], 0.006, [0, 0.62, 0.78], NUMBER);
  for (const s of [-1, 1]) {
    const cx = s * 0.47;
    paint.loft([
      { z: -0.37, pts: ring(0.07, 0.15, 0.06, 12, cx) },
      { z: -0.30, pts: ring(0.13, 0.16, 0.095, 12, cx) },
      { z: 0.04, pts: ring(0.14, 0.165, 0.10, 12, cx) },
      { z: 0.26, pts: ring(0.12, 0.16, 0.09, 12, cx) },
      { z: 0.34, pts: ring(0.07, 0.15, 0.055, 12, cx) },
    ], WHITE, { capStart: true, capEnd: true });
    // the pod's black rubbing strip, and the side bumper tube under it
    matte.loft([
      { z: -0.33, pts: ring(0.015, 0.10, 0.025, 6, s * 0.605) },
      { z: 0.30, pts: ring(0.015, 0.10, 0.025, 6, s * 0.605) },
    ], BLACK, { capStart: true, capEnd: true });
    matte.tube([s * 0.31, 0.085, 0.30], [s * 0.56, 0.095, 0.30], 0.012, 6, FRAME, true);
    matte.tube([s * 0.31, 0.085, -0.30], [s * 0.56, 0.095, -0.30], 0.012, 6, FRAME, true);
  }

  // --- the rear bumper: right across, past the back wheels ---------------------
  matte.loft([
    { z: -0.79, pts: ring(0.70, 0.15, 0.06, 16) },
    { z: -0.84, pts: ring(0.73, 0.15, 0.07, 16) },
    { z: -0.90, pts: ring(0.69, 0.145, 0.06, 16) },
  ], BLACK, { capStart: true, capEnd: true });
  for (const s of [-1, 1]) matte.tube([s * 0.28, 0.085, -0.72], [s * 0.30, 0.14, -0.8], 0.013, 6, FRAME, true);

  // --- the seat: a black fibreglass bucket ------------------------------------
  matte.box(0, 0.055, -0.21, 0.34, 0.03, 0.34, 0, BLACK);
  slab(matte, [-0.18, 0.08, -0.36], [0.18, 0.08, -0.36], [0.2, 0.64, -0.53], [-0.2, 0.64, -0.53], 0.02, [0, 0.3, 0.95], BLACK);
  for (const s of [-1, 1]) {
    // low sides, flaring out, round the hips
    slab(matte, [s * 0.17, 0.07, -0.05], [s * 0.18, 0.07, -0.38], [s * 0.2, 0.32, -0.42], [s * 0.2, 0.2, -0.07], 0.02, [s, 0, 0], BLACK);
    // seat stays to the rails
    matte.tube([s * 0.17, 0.46, -0.5], [s * 0.3, 0.09, -0.62], 0.009, 5, FRAME, true);
  }

  // --- steering: column, wheel, pedals -----------------------------------------
  const wc = [0, 0.415, 0.225];
  trim.tube([0, 0.12, 0.6], [wc[0], wc[1] - 0.012, wc[2] + 0.016], 0.011, 6, STEEL, true);
  // the wheel's plane: its axis is the column's
  const ax = [0, 0.29, -0.4], al = Math.hypot(ax[1], ax[2]);
  const u = [1, 0, 0], v = [0, -ax[2] / al, ax[1] / al];
  hoop(matte, wc, u, v, 0.145, 0.015, 16, BLACK);
  for (const a of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const e = [wc[0] + (u[0] * Math.sin(a) + v[0] * Math.cos(a)) * 0.135, wc[1] + (v[1] * Math.cos(a)) * 0.135, wc[2] + (v[2] * Math.cos(a)) * 0.135];
    trim.tube(wc, e, 0.008, 5, ALLOY, false);
  }
  trim.tube([wc[0], wc[1] - 0.01, wc[2] + 0.014], [wc[0], wc[1] + 0.006, wc[2] - 0.008], 0.03, 8, ALLOY, true);
  for (const s of [-1, 1]) {
    matte.box(s * 0.085, 0.07, 0.66, 0.06, 0.1, 0.02, 0, STEEL);
  }

  // --- the engine, on the right (-x), ahead of the axle -------------------------
  const ex = -0.33, ez = -0.27;
  matte.box(ex, 0.07, ez, 0.27, 0.015, 0.3, 0, FRAME);                         // mount plate
  trim.box(ex, 0.085, ez, 0.2, 0.19, 0.23, 0, ALLOY);                          // crankcase
  // the cylinder, slanted outboard, finned
  const cyl0 = [ex - 0.06, 0.2, ez + 0.02], cyl1 = [ex - 0.17, 0.33, ez + 0.02];
  matte.tube(cyl0, cyl1, 0.055, 10, ENGINE, true);
  for (let i = 1; i <= 4; i++) {
    const t = 0.2 + i * 0.15, p = [cyl0[0] + (cyl1[0] - cyl0[0]) * t, cyl0[1] + (cyl1[1] - cyl0[1]) * t, cyl0[2]];
    trim.tube([p[0] - 0.007, p[1] - 0.008, p[2]], [p[0] + 0.007, p[1] + 0.008, p[2]], 0.078, 10, ALLOY, true);
  }
  matte.box(ex - 0.2, 0.31, ez + 0.02, 0.08, 0.08, 0.12, 0, ENGINE);         // rocker cover
  // the fuel tank, Honda red, on top
  matte.loft([
    { z: ez - 0.11, pts: ring(0.1, 0.38, 0.045, 10, ex + 0.02) },
    { z: ez - 0.08, pts: ring(0.115, 0.38, 0.055, 10, ex + 0.02) },
    { z: ez + 0.08, pts: ring(0.115, 0.38, 0.055, 10, ex + 0.02) },
    { z: ez + 0.11, pts: ring(0.1, 0.38, 0.045, 10, ex + 0.02) },
  ], HONDA, { capStart: true, capEnd: true });
  matte.tube([ex + 0.04, 0.43, ez], [ex + 0.04, 0.45, ez], 0.022, 8, BLACK, true);   // its cap
  // air filter forward, recoil starter facing the driver's side
  matte.box(ex + 0.03, 0.24, ez + 0.15, 0.13, 0.11, 0.08, 0, BLACK);
  matte.tube([ex + 0.1, 0.19, ez], [ex + 0.13, 0.19, ez], 0.085, 14, BLACK, true);
  matte.box(ex + 0.145, 0.17, ez, 0.02, 0.025, 0.07, 0, [0.6, 0.6, 0.58]);        // the pull handle
  // exhaust: the header off the head and a silver can along the back
  trim.tube([ex - 0.2, 0.3, ez - 0.03], [ex - 0.12, 0.29, ez - 0.17], 0.017, 6, STEEL, true);
  trim.tube([ex - 0.12, 0.29, ez - 0.17], [ex - 0.12, 0.29, ez - 0.42], 0.05, 12, ALLOY, true);
  matte.tube([ex - 0.12, 0.29, ez - 0.42], [ex - 0.12, 0.29, ez - 0.44], 0.018, 6, [0.02, 0.02, 0.02], true);
  // clutch drum outboard, the chain back to the axle's sprocket, its guard
  trim.tube([-0.43, 0.12, ez + 0.02], [-0.47, 0.12, ez + 0.02], 0.045, 10, STEEL, true);
  trim.tube([-0.465, RR, ZR], [-0.475, RR, ZR], 0.075, 14, STEEL, true);
  for (const dy of [0.035, -0.035]) matte.tube([-0.47, 0.12 + dy, ez + 0.02], [-0.47, RR + dy * 2, ZR], 0.006, 4, [0.15, 0.15, 0.16], false);
  matte.box(-0.49, 0.1, (ez + ZR) / 2, 0.012, 0.12, 0.34, 0, BLACK);

  // --- the driver's full-face helmet ---------------------------------------------
  // `matte.crew`: only in an occupied kart, round the posed rider's head
  // (KART_RIDER puts the head bone at (0, 0.75, -0.25) in this frame; the
  // rider's own cap sits inside it)
  const crew = matte.crew || matte;
  const hc = [0, 0.855, -0.245], hr = 0.152;
  const rings = [];
  for (let k = 0; k <= 8; k++) {
    const a = -Math.PI / 2 + (k / 8) * Math.PI, dz = Math.sin(a) * hr, rr = Math.max(0.012, Math.cos(a) * hr);
    rings.push({ z: hc[2] + dz, pts: ring(rr, hc[1], rr * 1.06, 14).map(([x, y]) => [x, y - (y < hc[1] ? (hc[1] - y) * 0.12 : 0)]) });
  }
  crew.loft(rings, HELMET, { capStart: true, capEnd: true });
  // the visor: a dark band across the front, and the chin bar under it
  const vis = [];
  for (let r = 0; r <= 3; r++) {
    const el = -0.05 + r * 0.11, row = [];
    for (let c = 0; c <= 8; c++) {
      const az = -1.05 + (c / 8) * 2.1, R = hr + 0.006;
      row.push([hc[0] + Math.sin(az) * Math.cos(el) * R, hc[1] + Math.sin(el) * R * 1.06, hc[2] + Math.cos(az) * Math.cos(el) * R]);
    }
    vis.push(row);
  }
  crew.patch(vis, VISOR, [0, 0, 1]);
  crew.box(0, hc[1] - hr * 0.98, hc[2] + 0.05, 0.16, 0.05, 0.13, 0, HELMET);
  // a stripe over the crown, front to back
  crew.loft([
    { z: hc[2] - hr * 0.7, pts: ring(0.02, hc[1] + hr * 0.73, 0.012, 6) },
    { z: hc[2], pts: ring(0.021, hc[1] + hr * 1.07, 0.012, 6) },
    { z: hc[2] + hr * 0.7, pts: ring(0.02, hc[1] + hr * 0.75, 0.012, 6) },
  ], [0.7, 0.06, 0.05], { capStart: true, capEnd: true });

  // --- the wheels: [x, y, z, r, w, out] ------------------------------------------
  return [
    [XF, RF, ZF, RF, 0.13, 1], [-XF, RF, ZF, RF, 0.13, -1],
    [XR, RR, ZR, RR, 0.19, 1], [-XR, RR, ZR, RR, 0.19, -1],
  ];
}

/**
 * The driver's pose (vehicles.js RIDERS.kart; the signs are explained there):
 * sitting on the floor of the bucket, legs out and knees up under the front
 * panel, arms forward to a wheel at chest height, leaning back.
 */
export const KART_RIDER = {
  z: -0.19, hipY: 0.15, seed: 91,
  lean: -0.26, head: 0.26,
  shoulder: [-0.95, -0.06], elbow: [-0.6, 0.04],
  thigh: [-1.86, 0.09], knee: 0.5, foot: -0.4,
};
