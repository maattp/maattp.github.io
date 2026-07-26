// Vehicle models and the arcade driving model.
//
// Bodies are lofted through cross-sections rather than assembled from boxes, so
// they get a real shoulder line, a raked screen and smooth shading. Each type
// bakes down to three geometries that share materials across every instance:
//
//   paint  - the painted shell, tinted per car by its own material colour
//   trim   - glass, chrome, lamp lenses, wheel rims (shiny, metallic)
//   matte  - tyres, bumper rubber, plastic, wheel arches (rough, dielectric)

import * as THREE from './three.js';
import { Builder } from './build.js';
import { clamp, lerp, hash2 } from './util.js';
import * as G from './geo.js';

const TYRE = [0.05, 0.05, 0.055];
const RIM = [0.80, 0.82, 0.85];
const HUB = [0.42, 0.44, 0.47];
const GLASS = [0.06, 0.08, 0.10];
const CHROME = [0.84, 0.86, 0.89];
const PLASTIC = [0.11, 0.12, 0.13];
const LAMP = [1.0, 0.98, 0.9];
const TAILC = [0.92, 0.12, 0.1];
const AMBER = [0.95, 0.55, 0.08];
const PLATE = [0.86, 0.86, 0.82];
const WHITE = [1, 1, 1];

// len/wid in metres; sill = bottom of the visible bodywork, belt = shoulder
// line, roof = roof height, cab = greenhouse extent as a fraction of length.
export const TYPES = {
  sedan: { len: 4.72, wid: 1.83, wheelR: 0.33, sill: 0.30, belt: 0.98, roof: 1.46, cab: [-0.28, 0.19], mass: 1, top: 42, acc: 9.5 },
  hatch: { len: 4.10, wid: 1.76, wheelR: 0.31, sill: 0.29, belt: 0.96, roof: 1.50, cab: [-0.30, 0.16], mass: 0.9, top: 38, acc: 9 },
  compact: { len: 3.74, wid: 1.68, wheelR: 0.29, sill: 0.28, belt: 0.94, roof: 1.48, cab: [-0.28, 0.15], mass: 0.85, top: 36, acc: 8.6 },
  suv: { len: 4.94, wid: 1.96, wheelR: 0.38, sill: 0.42, belt: 1.24, roof: 1.86, cab: [-0.32, 0.24], boxy: 1, mass: 1.3, top: 40, acc: 8.8 },
  sports: { len: 4.42, wid: 1.92, wheelR: 0.34, sill: 0.24, belt: 0.80, roof: 1.20, cab: [-0.24, 0.06], spoiler: true, mass: 0.85, top: 62, acc: 15 },
  // Cab-forward and low, on a long wheelbase with almost no overhang -- the
  // shape a floor full of batteries gives you. Heavier than the sports car and
  // quicker anyway, because the torque is all there from a standstill.
  ev: { len: 4.62, wid: 1.98, wheelR: 0.36, sill: 0.22, belt: 0.79, roof: 1.25, cab: [-0.28, 0.09], ev: true, mass: 1.2, top: 68, acc: 19 },
  muscle: { len: 5.02, wid: 1.98, wheelR: 0.35, sill: 0.28, belt: 0.94, roof: 1.36, cab: [-0.24, 0.13], mass: 1.15, top: 55, acc: 13.5 },
  pickup: { len: 5.48, wid: 2.00, wheelR: 0.40, sill: 0.44, belt: 1.20, roof: 1.86, cab: [0.00, 0.28], bed: true, boxy: 1, mass: 1.4, top: 39, acc: 8.6 },
  van: { len: 5.26, wid: 2.00, wheelR: 0.35, sill: 0.36, belt: 1.10, roof: 2.28, cab: [-0.44, 0.30], boxy: 2, mass: 1.5, top: 36, acc: 7.6 },
  taxi: { len: 4.76, wid: 1.85, wheelR: 0.33, sill: 0.30, belt: 0.98, roof: 1.48, cab: [-0.28, 0.19], taxi: true, mass: 1, top: 42, acc: 9.5 },
  police: { len: 4.98, wid: 1.92, wheelR: 0.34, sill: 0.30, belt: 1.00, roof: 1.48, cab: [-0.28, 0.19], police: true, mass: 1.1, top: 56, acc: 14 },
  bus: { len: 12.0, wid: 2.55, wheelR: 0.50, sill: 0.50, belt: 1.30, roof: 3.10, cab: [-0.48, 0.48], bus: true, boxy: 3, mass: 4.5, top: 26, acc: 4.2 },
  boxtruck: { len: 7.5, wid: 2.38, wheelR: 0.46, sill: 0.62, belt: 1.55, roof: 2.55, cab: [0.14, 0.46], cargo: 2.55, boxy: 2, mass: 3, top: 30, acc: 5.2 },
  ambulance: { len: 6.3, wid: 2.28, wheelR: 0.42, sill: 0.56, belt: 1.42, roof: 2.35, cab: [0.16, 0.46], cargo: 2.25, boxy: 2, emergency: true, mass: 2.4, top: 40, acc: 8 },
  garbage: { len: 8.1, wid: 2.48, wheelR: 0.50, sill: 0.66, belt: 1.62, roof: 2.6, cab: [0.20, 0.46], cargo: 2.5, boxy: 2, mass: 4, top: 26, acc: 4.4 },
};

export const CIVILIAN_TYPES = ['sedan', 'sedan', 'hatch', 'compact', 'suv', 'suv', 'sports', 'ev', 'muscle', 'pickup', 'van', 'taxi', 'boxtruck', 'bus', 'garbage'];

export const CAR_COLORS = [
  0x9fa4a9, 0x1b1d20, 0xe6e8ea, 0x6d0f14, 0x102b52, 0x14472f, 0x7a5a22,
  0x2f3a44, 0x9c968c, 0x4a2058, 0xb85f0c, 0x0d5b66, 0x5b5f63, 0xbcc2c8,
  0x243b6b, 0x7d2418,
];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Rounded-rectangle cross-section: an octagon with chamfered corners. */
function ring(w, y0, y1, r) {
  const rr = Math.min(r, Math.abs(y1 - y0) / 2.2, w / 2.2);
  return [
    [-w, y0 + rr], [-w + rr, y0], [w - rr, y0], [w, y0 + rr],
    [w, y1 - rr], [w - rr, y1], [-w + rr, y1], [-w, y1 - rr],
  ];
}

/** Tyre into `matte`, rim and spokes into `trim`. */
function addWheel(trim, matte, cx, cy, cz, r, w) {
  const seg = 14;
  const inner = r * 0.6;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const n0 = [0, c0, s0], n1 = [0, c1, s1];
    matte.quad(
      [cx - w / 2, cy + c0 * r, cz + s0 * r], [cx + w / 2, cy + c0 * r, cz + s0 * r],
      [cx + w / 2, cy + c1 * r, cz + s1 * r], [cx - w / 2, cy + c1 * r, cz + s1 * r],
      [n0, n0, n1, n1], [0, 0, 1, 0, 1, 1, 0, 1], TYRE);
    for (const sx of [-1, 1]) {
      const x = cx + (sx * w) / 2;
      matte.quad(
        [x, cy + c0 * r, cz + s0 * r], [x, cy + c0 * inner, cz + s0 * inner],
        [x, cy + c1 * inner, cz + s1 * inner], [x, cy + c1 * r, cz + s1 * r],
        [sx, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], TYRE);
      // alternating wedges across the rim face read as spokes
      const rx = x - sx * 0.005;
      trim.tri([rx, cy, cz], [rx, cy + c0 * inner, cz + s0 * inner], [rx, cy + c1 * inner, cz + s1 * inner],
        [sx, 0, 0], i % 2 === 0 ? RIM : HUB);
    }
  }
  trim.prism(cx, cy - w * 0.5, cz, r * 0.18, w, 8, CHROME, Math.PI / 8);
}

function buildType(spec) {
  const paint = new Builder(false);
  const trim = new Builder(false);
  const matte = new Builder(false);
  const L = spec.len, W = spec.wid / 2;
  const wr = spec.wheelR;
  const sill = spec.sill, belt = spec.belt, roof = spec.roof;
  const zAt = (t) => (t - 0.5) * L;
  const boxy = spec.boxy || 0;
  const round = boxy >= 2 ? 0.20 : boxy === 1 ? 0.16 : 0.13;

  // --- lower body ----------------------------------------------------------
  // Sampled as a continuous profile rather than a handful of key stations, so
  // the bottom edge can arch up over each wheel. Without that cut the tyres
  // just intersect a straight sill and the whole thing reads as a toy.
  const frontT = spec.bus ? 0.84 : boxy >= 2 ? 0.80 : 0.785;
  const rearT = spec.bus ? 0.16 : boxy >= 2 ? 0.20 : 0.215;
  const archR = wr + (boxy >= 2 ? 0.13 : 0.11);
  const archTop = wr + (boxy >= 2 ? 0.10 : 0.08);
  const archLift = (t) => {
    let l = 0;
    for (const wt of [rearT, frontT]) {
      const dz = Math.abs(t - wt) * L;
      if (dz < archR) l = Math.max(l, archTop * Math.sqrt(1 - (dz / archR) ** 2));
    }
    return l;
  };
  const endTaper = boxy >= 2 ? 0.07 : 0.13;
  const endWidth = boxy >= 2 ? 0.86 : 0.72;
  const widthAt = (t) => {
    const e = clamp(Math.min(t, 1 - t) / endTaper, 0, 1);
    return endWidth + (1 - endWidth) * Math.sqrt(e);
  };
  const beltAt = (t) => {
    if (boxy >= 2) return belt;
    const hood = -0.17 * clamp((t - 0.70) / 0.30, 0, 1) ** 1.7;
    const trunk = -0.11 * clamp((0.22 - t) / 0.22, 0, 1) ** 1.7;
    const crown = 0.02 * Math.sin(Math.PI * clamp((t - 0.2) / 0.6, 0, 1));
    return belt + hood + trunk + crown;
  };
  const STATIONS = boxy >= 2 ? 20 : 26;
  const bodyRings = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    bodyRings.push({
      z: zAt(t),
      pts: ring(W * widthAt(t), Math.max(sill, archLift(t)), beltAt(t), round),
    });
  }
  paint.loft(bodyRings, WHITE, { capStart: true, capEnd: true });

  // --- greenhouse ----------------------------------------------------------
  const c0 = 0.5 + spec.cab[0], c1 = 0.5 + spec.cab[1];
  const gw = boxy >= 2 ? 0.985 : boxy === 1 ? 0.93 : 0.88;
  const cabRings = spec.cargo ? [
    { z: zAt(c0), pts: ring(W * gw * 0.94, belt - 0.02, belt + 0.06, 0.1) },
    { z: zAt(c0 + 0.02), pts: ring(W * gw, belt - 0.02, roof - 0.02, 0.14) },
    { z: zAt(c1 - 0.05), pts: ring(W * gw, belt - 0.02, roof, 0.14) },
    { z: zAt(c1 - 0.015), pts: ring(W * gw * 0.95, belt - 0.02, roof - 0.08, 0.12) },
    { z: zAt(c1), pts: ring(W * gw * 0.82, belt - 0.02, belt + 0.22, 0.1) },
  ] : [
    { z: zAt(c0), pts: ring(W * gw * 0.80, belt - 0.03, belt + 0.05, 0.1) },
    { z: zAt(c0 + (boxy ? 0.03 : 0.075)), pts: ring(W * gw * 0.93, belt - 0.03, roof - 0.04, 0.13) },
    { z: zAt(c0 + 0.17), pts: ring(W * gw, belt - 0.03, roof, 0.14) },
    { z: zAt(c1 - 0.15), pts: ring(W * gw, belt - 0.03, roof, 0.14) },
    { z: zAt(c1 - (boxy ? 0.03 : 0.085)), pts: ring(W * gw * 0.94, belt - 0.03, roof - 0.05, 0.13) },
    { z: zAt(c1), pts: ring(W * gw * 0.78, belt - 0.03, belt + (boxy ? 0.3 : 0.12), 0.1) },
  ];
  // Cars get a glass greenhouse with a painted roof skin over it. Vans, trucks
  // and buses are painted boxes with glazing cut into them instead -- lofting
  // those in glass turned the whole upper body into one dark slab.
  const glassCab = boxy < 2;
  if (glassCab) {
    trim.loft(cabRings, GLASS, { capStart: false, capEnd: false });
    const roofRings = cabRings.slice(1, -1).map((r0) => {
      const topY = Math.max.apply(null, r0.pts.map((p) => p[1]));
      return { z: r0.z, pts: ring(Math.abs(r0.pts[5][0]) * 0.998, topY - 0.075, topY + 0.006, 0.04) };
    });
    if (roofRings.length > 1) paint.loft(roofRings, WHITE, { capStart: true, capEnd: true });
  } else {
    paint.loft(cabRings, WHITE, { capStart: true, capEnd: true });
    // windscreen raked into the painted cab front
    const fz = cabRings[cabRings.length - 1].z;
    const fw = Math.abs(cabRings[cabRings.length - 2].pts[2][0]);
    trim.box(0, belt + 0.16, fz - 0.1, fw * 1.72, (roof - belt) * 0.62, 0.1, 0, GLASS);
    if (!spec.cargo && !spec.bus) {
      const bz2 = cabRings[0].z;
      trim.box(0, belt + 0.3, bz2 + 0.08, fw * 1.5, (roof - belt) * 0.44, 0.08, 0, GLASS);
    }
  }

  // --- cargo box / pickup bed ---------------------------------------------
  if (spec.cargo) {
    const bz0 = zAt(0.015), bz1 = zAt(c0 - 0.005);
    paint.loft([
      { z: bz0, pts: ring(W * 1.005, sill + 0.05, belt + spec.cargo, 0.1) },
      { z: bz1, pts: ring(W * 1.005, sill + 0.05, belt + spec.cargo, 0.1) },
    ], WHITE, { capStart: true, capEnd: true });
    matte.box(0, belt + spec.cargo, (bz0 + bz1) / 2, W * 2.04, 0.09, bz1 - bz0, 0, PLASTIC);
    matte.box(0, sill + 0.1, bz0 + 0.05, W * 1.86, belt + spec.cargo - sill - 0.3, 0.06, 0, [0.28, 0.29, 0.3]);
  }
  if (spec.bed) {
    const bz0 = zAt(0.03), bz1 = zAt(c0 - 0.02);
    for (const sx of [-1, 1]) paint.box(sx * (W - 0.07), belt, (bz0 + bz1) / 2, 0.13, 0.44, bz1 - bz0, 0, WHITE);
    paint.box(0, belt, bz0 + 0.07, W * 2 - 0.14, 0.44, 0.13, 0, WHITE);
    matte.box(0, belt - 0.02, (bz0 + bz1) / 2, W * 1.84, 0.05, bz1 - bz0 - 0.12, 0, [0.16, 0.17, 0.18]);
  }

  // --- wheels + arch flares -----------------------------------------------
  const wx = W - (boxy >= 2 ? 0.10 : 0.05);
  const front = zAt(frontT), rear = zAt(rearT);
  const tw = boxy >= 2 ? 0.32 : 0.24;
  const wheels = [[-wx, wr, front], [wx, wr, front], [-wx, wr, rear], [wx, wr, rear]];
  if (spec.bus || (spec.cargo && L > 7)) wheels.push([-wx, wr, rear + 1.05], [wx, wr, rear + 1.05]);
  // Dark wheel wells so you never see daylight through an arch -- but capped at
  // the shoulder line. The well is sized off the wheel and the bodywork off
  // `belt`, so a big wheel under a low body pushed a black slab up through the
  // top of the wing: two per side, which is what the electric car's first pass
  // was covered in. The sports car had it too, less obviously.
  for (const [ax, , az] of wheels) {
    const sx = Math.sign(ax);
    const wellY = wr + 0.16;
    const wellH = Math.max(0.12, Math.min(wr * 1.3, belt - wellY - 0.06));
    matte.box(ax - sx * 0.22, wellY, az, 0.22, wellH, wr * 1.9, 0, [0.035, 0.04, 0.045]);
  }

  // --- lamps, grille, bumpers, trim ---------------------------------------
  const nz = L / 2, tz = -L / 2;
  const lampY = boxy >= 2 ? sill + 0.44 : sill + 0.34;
  if (!spec.bus) {
    const nw = W * widthAt(0.97), tw2 = W * widthAt(0.03);
    for (const sx of [-1, 1]) {
      // dark housing, then an inset lens, so the lamp reads even on a white car
      // The housings are sized off the sill, but the bonnet line is set by
      // beltAt(), which dips at the nose -- on a body this low they would poke
      // up through it. The EV doesn't need them anyway: its bar is the lamp.
      if (!spec.ev) {
        matte.box(sx * nw * 0.62, lampY, zAt(0.968), nw * 0.54, 0.23, 0.14, 0, [0.05, 0.055, 0.06]);
        trim.box(sx * nw * 0.62, lampY + 0.005, zAt(0.982), nw * 0.44, 0.16, 0.09, 0, LAMP);
        matte.box(sx * tw2 * 0.62, lampY, zAt(0.032), tw2 * 0.56, 0.23, 0.14, 0, [0.05, 0.055, 0.06]);
        trim.box(sx * tw2 * 0.62, lampY + 0.005, zAt(0.018), tw2 * 0.46, 0.17, 0.09, 0, TAILC);
      }
      trim.box(sx * tw2 * 0.88, lampY + 0.005, zAt(0.02), tw2 * 0.16, 0.11, 0.07, 0, AMBER);
      trim.box(sx * nw * 0.92, lampY - 0.03, zAt(0.974), nw * 0.12, 0.08, 0.07, 0, AMBER);
    }
    if (spec.ev) {
      // One unbroken bar at each end and no grille: there is nothing behind it
      // that needs cooling, and the sealed nose is most of what makes an
      // electric car read as one at a glance.
      trim.box(0, lampY + 0.03, zAt(0.981), nw * 1.74, 0.095, 0.1, 0, LAMP);
      trim.box(0, lampY + 0.03, zAt(0.019), tw2 * 1.74, 0.095, 0.1, 0, TAILC);
      matte.box(0, lampY - 0.11, zAt(0.973), nw * 1.3, 0.14, 0.08, 0, PLASTIC);
      // charge flap behind the rear arch
      for (const sx of [-1, 1]) {
        matte.box(sx * (W + 0.004), belt - 0.19, zAt(0.115), 0.012, 0.13, 0.17, 0, [0.2, 0.21, 0.23]);
      }
    } else {
      // grille between the lamps, plus a lower intake under the bumper
      matte.box(0, lampY - 0.02, zAt(0.976), nw * 0.78, 0.2, 0.1, 0, [0.045, 0.05, 0.055]);
      for (let i = 0; i < 3; i++) trim.box(0, lampY - 0.07 + i * 0.07, zAt(0.984), nw * 0.74, 0.024, 0.035, 0, CHROME);
      matte.box(0, sill + 0.13, zAt(0.972), nw * 1.1, 0.14, 0.1, 0, [0.05, 0.055, 0.06]);
    }
    matte.box(0, sill + 0.04, zAt(0.958), nw * 1.86, 0.22, 0.26, 0, PLASTIC);
    matte.box(0, sill + 0.04, zAt(0.042), tw2 * 1.86, 0.22, 0.26, 0, PLASTIC);
    trim.box(0, sill + 0.19, zAt(0.995), 0.44, 0.15, 0.03, 0, PLATE);
    trim.box(0, sill + 0.19, zAt(0.005), 0.44, 0.15, 0.03, 0, PLATE);
    matte.prism(W * 0.5, sill + 0.02, tz + 0.05, 0.055, 0.16, 6, [0.3, 0.31, 0.33]);
  } else {
    trim.box(0, belt + 0.55, nz - 0.03, W * 1.7, 1.05, 0.08, 0, GLASS);
    trim.box(0, belt + 0.55, tz + 0.03, W * 1.7, 0.95, 0.08, 0, GLASS);
    for (const sx of [-1, 1]) {
      trim.box(sx * W * 0.6, sill + 0.3, nz - 0.02, W * 0.5, 0.24, 0.08, 0, LAMP);
      trim.box(sx * W * 0.6, sill + 0.3, tz + 0.02, W * 0.5, 0.24, 0.08, 0, TAILC);
    }
    matte.box(0, sill - 0.03, 0, W * 2.03, 0.18, L * 0.94, 0, PLASTIC);
    matte.box(0, roof - 0.08, zAt(0.35), W * 1.4, 0.24, 2.4, 0, [0.24, 0.26, 0.28]);
  }

  // glazing bands for the shapes that skip a proper greenhouse
  if (boxy >= 2 && !spec.cargo) {
    for (const sx of [-1, 1]) trim.box(sx * (W + 0.006), belt + 0.44, zAt(0.5), 0.03, 0.8, L * 0.72, 0, GLASS);
  }
  if (spec.bus) {
    for (const sx of [-1, 1]) trim.box(sx * (W + 0.008), belt + 0.66, 0, 0.03, 1.1, L * 0.9, 0, GLASS);
  }

  if (!spec.bus) {
    for (const sx of [-1, 1]) {
      // mirror tucked onto the shoulder at the base of the A-pillar
      const mz = zAt(c1 - 0.055);
      matte.box(sx * (W + 0.03), belt + 0.02, mz, 0.08, 0.05, 0.07, 0, PLASTIC);
      paint.box(sx * (W + 0.095), belt + 0.035, mz, 0.13, 0.11, 0.075, 0, WHITE);
      // shut lines and a side rubbing strip
      matte.box(sx * (W + 0.003), (sill + belt) / 2 + 0.05, zAt(c1 - 0.03), 0.01, belt - sill - 0.18, 0.022, 0, [0.16, 0.17, 0.18]);
      matte.box(sx * (W + 0.003), (sill + belt) / 2 + 0.05, zAt(c0 + 0.17), 0.01, belt - sill - 0.18, 0.022, 0, [0.16, 0.17, 0.18]);
    }
  }

  if (spec.spoiler) {
    paint.box(0, belt + 0.17, tz + 0.3, W * 1.6, 0.06, 0.3, 0, WHITE);
    for (const sx of [-1, 1]) paint.box(sx * W * 0.62, belt + 0.02, tz + 0.3, 0.07, 0.17, 0.2, 0, WHITE);
  }
  if (spec.ev) {
    // Ducktail rather than a wing -- it belongs to the bodywork, so it is
    // painted with the car instead of bolted on in a contrast colour.
    paint.box(0, belt + 0.02, tz + 0.20, W * 1.62, 0.05, 0.26, 0, WHITE);
    matte.box(0, sill + 0.02, tz + 0.16, W * 1.5, 0.1, 0.22, 0, PLASTIC); // diffuser
  }
  if (spec.taxi) {
    trim.box(0, roof + 0.03, zAt(0.5), 0.88, 0.22, 0.3, 0, [1.0, 0.78, 0.06]);
    matte.box(0, roof + 0.01, zAt(0.5), 0.92, 0.03, 0.34, 0, PLASTIC);
  }
  if (spec.emergency) {
    trim.box(0, belt + spec.cargo + 0.03, zAt(0.24), 1.2, 0.14, 0.34, 0, TAILC);
    matte.box(0, belt + spec.cargo + 0.01, zAt(0.24), 1.3, 0.05, 0.4, 0, PLASTIC);
  }

  const clone = (base) => {
    const b = new Builder(false);
    b.pos = base.pos.slice(); b.nor = base.nor.slice();
    b.col = base.col.slice(); b.idx = base.idx.slice();
    return b;
  };
  const trimW = clone(trim), matteW = clone(matte);
  for (const [ax, ay, az] of wheels) addWheel(trimW, matteW, ax, ay, az, wr, tw);
  const wt = new Builder(false), wm = new Builder(false);
  addWheel(wt, wm, 0, 0, 0, wr, tw);

  return {
    paintGeo: paint.build(),
    trimGeo: trim.build(),
    matteGeo: matte.build(),
    trimGeoW: trimW.build(),
    matteGeoW: matteW.build(),
    wheelTrim: wt.build(),
    wheelMatte: wm.build(),
    wheels,
    spec,
    wheelR: wr,
  };
}

let CACHE = null;
export function vehicleAssets() {
  if (CACHE) return CACHE;
  const types = {};
  for (const k of Object.keys(TYPES)) types[k] = buildType(TYPES[k]);
  CACHE = {
    types,
    trimMat: new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.88, roughness: 0.16, envMapIntensity: 1.7,
    }),
    matteMat: new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.05, roughness: 0.86, envMapIntensity: 0.55,
    }),
  };
  return CACHE;
}

export function paintMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color, metalness: 0.5, roughness: 0.26, envMapIntensity: 1.5,
  });
}

// ---------------------------------------------------------------------------

export class Vehicle {
  constructor(city, typeName, color, opts = {}) {
    const A = vehicleAssets();
    const t = A.types[typeName];
    this.city = city;
    this.typeName = typeName;
    // Named `assets`, not `t`. It used to be `this.t`, and traffic.js spawning a
    // car did `v.t = t` with its position along the edge -- silently replacing
    // the whole geometry table with a number. Nothing noticed until you tried to
    // get in, because the meshes were already built by then.
    this.assets = t;
    this.spec = t.spec;
    this.color = color;
    this.detailedWheels = false;

    this.group = new THREE.Group();
    this.bodyMat = paintMaterial(color);
    const paintMesh = new THREE.Mesh(t.paintGeo, this.bodyMat);
    this.trimMesh = new THREE.Mesh(t.trimGeoW, A.trimMat);
    this.matteMesh = new THREE.Mesh(t.matteGeoW, A.matteMat);
    paintMesh.castShadow = this.trimMesh.castShadow = this.matteMesh.castShadow = true;
    this.tilt = new THREE.Group();
    this.tilt.add(paintMesh, this.trimMesh, this.matteMesh);
    this.group.add(this.tilt);
    this.wheelMeshes = [];

    this.x = 0; this.y = 0; this.z = 0;
    this.heading = 0;
    this.vLong = 0; this.vLat = 0;
    this.steer = 0;
    this.pitch = 0; this.roll = 0;
    this.health = 100;
    this.dead = false;
    // Seconds before this vehicle can take collision damage again. One crash
    // spans many frames -- see damage().
    this.hitCd = 0;
    this.onGround = true;
    this.vy = 0;
    this.wheelSpin = 0;
    this.skid = 0;
    this.lift = 0;
    this.radius = Math.max(t.spec.len, t.spec.wid) * 0.42;
    this.halfLen = t.spec.len / 2;
    this.halfWid = t.spec.wid / 2;
    this.mass = t.spec.mass;
  }

  /** The player's own car gets steerable, spinning wheel meshes; traffic doesn't. */
  setDetailed(on) {
    if (this.detailedWheels === on) return;
    this.detailedWheels = on;
    const A = vehicleAssets();
    this.trimMesh.geometry = on ? this.assets.trimGeo : this.assets.trimGeoW;
    this.matteMesh.geometry = on ? this.assets.matteGeo : this.assets.matteGeoW;
    if (on) {
      for (const [wx, wy, wz] of this.assets.wheels) {
        const g = new THREE.Group();
        const a = new THREE.Mesh(this.assets.wheelTrim, A.trimMat);
        const b = new THREE.Mesh(this.assets.wheelMatte, A.matteMat);
        a.castShadow = b.castShadow = true;
        g.add(a, b);
        g.position.set(wx, wy, wz);
        g.userData.front = wz > 0;
        this.tilt.add(g);
        this.wheelMeshes.push(g);
      }
    } else {
      for (const m of this.wheelMeshes) this.tilt.remove(m);
      this.wheelMeshes.length = 0;
    }
  }

  place(x, z, heading) {
    this.x = x; this.z = z;
    this.heading = heading;
    this.lift = this.city.roadLift(x, z);
    this.y = this.city.groundAt(x, z, null, this.lift);
    // Sit on the slope, the same way update() does. A parked car never runs
    // update(), so left at zero pitch it stays level on a hillside street and
    // its downhill end is buried -- the sunken cars on Queen Anne.
    const f = this.forward;
    const rx = f.z, rz = -f.x;
    const at = (dx, dz) => this.city.groundAt(this.x + dx, this.z + dz, this.y + 1.5, this.lift);
    const fh = at(f.x * this.halfLen, f.z * this.halfLen);
    const bh = at(-f.x * this.halfLen, -f.z * this.halfLen);
    const lh = at(rx * this.halfWid, rz * this.halfWid);
    const rh = at(-rx * this.halfWid, -rz * this.halfWid);
    this.pitch = Math.atan2(bh - fh, this.halfLen * 2);
    this.roll = Math.atan2(lh - rh, this.halfWid * 2); // see update(): +X is raised by +rotation.z
    // Rest on the plane through the four contact patches, not on the ground
    // under the centre -- otherwise a car parked across a camber sits with one
    // pair of wheels buried and the other pair in the air.
    this.y = (fh + bh + lh + rh) / 4;
    this.sync();
  }

  get speed() {
    return Math.hypot(this.vLong, this.vLat);
  }

  get forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  update(dt, input) {
    const spec = this.spec;
    if (this.hitCd > 0) this.hitCd -= dt;
    const throttle = input.throttle || 0;
    const brake = input.brake || 0;
    const hand = input.handbrake || 0;
    const steerIn = clamp(input.steer || 0, -1, 1);

    // One paved-surface query per body per frame, reused by all seven ground
    // samples below -- the scan is too expensive to repeat per wheel.
    this.lift = this.city.roadLift(this.x, this.z);
    const sp = Math.abs(this.vLong);
    // Steering authority falls off with speed so the car stays controllable.
    const maxSteer = lerp(0.62, 0.16, clamp(sp / 34, 0, 1));
    this.steer = lerp(this.steer, steerIn * maxSteer, 1 - Math.exp(-11 * dt));

    const top = spec.top;
    let acc = 0;
    if (throttle > 0) {
      // A combustion car has to wind up to make power, so its pull fades
      // linearly with speed. An electric motor is at full torque from zero and
      // only tails off near the top, which is the whole character of the
      // thing -- squaring the falloff is what makes it leap off the line and
      // still feel like it runs out of road rather than out of revs.
      const fade = 1 - clamp(this.vLong / top, 0, 1);
      acc += spec.acc * throttle * (spec.ev ? Math.sqrt(fade) : fade);
      if (this.vLong < -0.5) acc += spec.acc * 1.4 * throttle;
    }
    if (brake > 0) {
      if (this.vLong > 0.4) acc -= 16 * brake;
      else acc -= spec.acc * 0.55 * brake * (1 - clamp(-this.vLong / (top * 0.42), 0, 1));
    }
    // slope
    const gy = this.city.groundAt(this.x, this.z, this.y + 0.6, this.lift);
    const ahead = this.city.groundAt(this.x + this.forward.x * 3, this.z + this.forward.z * 3, this.y + 2.5, this.lift);
    acc -= clamp((ahead - gy) / 3, -0.7, 0.7) * 9.0;

    acc -= this.vLong * Math.abs(this.vLong) * 0.0016; // aero
    acc -= this.vLong * 0.07; // rolling resistance
    if (throttle === 0 && brake === 0 && Math.abs(this.vLong) > 0.3) {
      // engine braking, or regen -- which bites noticeably harder
      acc -= Math.sign(this.vLong) * (spec.ev ? 4.6 : 2.4);
    }
    if (hand > 0.5 && this.vLong > 0) acc -= 11;
    this.vLong += acc * dt;
    if (Math.abs(this.vLong) < 0.12 && throttle === 0) this.vLong *= 0.82;

    // Bicycle-model yaw plus lateral slip for arcade drift.
    const wheelbase = spec.len * 0.62;
    const yawRate = (this.vLong / wheelbase) * Math.tan(this.steer);
    this.heading += yawRate * dt;

    // The battery floor puts the mass under the axle line, so it holds on
    // rather than leaning; the handbrake still breaks it loose.
    const gripBase = spec.bus || spec.cargo ? 7.5 : spec.ev ? 11.5 : 9.5;
    const grip = hand > 0.5 ? 1.5 : gripBase;
    this.vLat += -yawRate * this.vLong * dt;
    const before = this.vLat;
    this.vLat *= Math.exp(-grip * dt);
    this.skid = clamp(Math.abs(before) * 0.35, 0, 1);

    const f = this.forward;
    const rx = f.z, rz = -f.x;
    let dx = (f.x * this.vLong + rx * this.vLat) * dt;
    let dz = (f.z * this.vLong + rz * this.vLat) * dt;

    this.x += dx;
    this.z += dz;
    this.x = G.clampToMap(this.x);
    this.z = G.clampToMap(this.z);

    // Ground under each contact patch. Sampled BEFORE the vertical follow,
    // because the height the body should sit at is the plane through its four
    // wheels, not the ground under its centre. On a crest the centre reads high
    // and the wheels hang; in a dip it reads low and they sink.
    const f2 = this.forward;
    const rx2 = f2.z, rz2 = -f2.x;
    const gAt = (ox, oz) => this.city.groundAt(this.x + ox, this.z + oz, this.y + 1.5, this.lift);
    const fh = gAt(f2.x * this.halfLen, f2.z * this.halfLen);
    const bh = gAt(-f2.x * this.halfLen, -f2.z * this.halfLen);
    const lh = gAt(rx2 * this.halfWid, rz2 * this.halfWid);
    const rh = gAt(-rx2 * this.halfWid, -rz2 * this.halfWid);

    // vertical: follow ground, with a little air time over crests
    const target = (fh + bh + lh + rh) / 4;
    if (this.y > target + 0.25) {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      this.onGround = false;
      if (this.y <= target) { this.y = target; this.vy = 0; this.onGround = true; }
    } else {
      const rise = target - this.y;
      if (rise > 0.6 && sp > 6) { this.vy = Math.min(6, rise * 4); }
      this.y = lerp(this.y, target, 1 - Math.exp(-18 * dt));
      this.onGround = true;
    }

    // body attitude, from the samples taken above
    const tgtPitch = Math.atan2(bh - fh, this.halfLen * 2) - clamp(acc, -12, 12) * 0.0045;
    // `lh` is sampled along the body's local +X, and a positive rotation.z
    // raises local +X -- so the far side has to be SUBTRACTED, not the near one.
    // Reversed, the car leaned into the slope instead of along it: measured on
    // a 2.4 deg cross-slope, the +X wheels sat 7.2 cm under the road while the
    // other pair floated 7.1 cm above it, which is the two-wheels-in-the-air.
    const tgtRoll = Math.atan2(lh - rh, this.halfWid * 2) + clamp(this.vLat, -9, 9) * 0.016;
    this.pitch = lerp(this.pitch, tgtPitch, 1 - Math.exp(-10 * dt));
    this.roll = lerp(this.roll, tgtRoll, 1 - Math.exp(-10 * dt));

    this.wheelSpin += (this.vLong / (this.assets.wheelR || 0.34)) * dt;
    this.sync();
    return { dx, dz };
  }

  sync() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.heading;
    this.tilt.rotation.x = this.pitch;
    this.tilt.rotation.z = this.roll;
    if (this.detailedWheels) {
      for (const m of this.wheelMeshes) {
        // Steer OUTSIDE the spin. Euler order matters here: the default 'XYZ'
        // builds Rx*Ry, i.e. it steers the wheel and then rolls it about the
        // car's X axis rather than the wheel's own axle -- so a turned front
        // wheel tumbles instead of rolling, which is the visible wobble.
        // 'YXZ' gives Ry*Rx: roll on the axle first, then steer the whole thing.
        m.rotation.order = 'YXZ';
        m.rotation.x = this.wheelSpin;
        m.rotation.y = m.userData.front ? this.steer : 0;
      }
    }
  }

  /**
   * Collision damage, debounced.
   *
   * A crash is not one frame. The pair stays overlapping and closing for
   * several, and the caller ran on every one of them: a 20 m/s shunt is 14
   * damage a frame, so 100 health was gone in about an eighth of a second and
   * any real impact detonated the car on contact. `hitCd` makes one collision
   * count once. Gunfire and other scripted damage passes `force` and is never
   * debounced.
   */
  damage(n, force) {
    if (!force) {
      if (this.hitCd > 0) return false;
      this.hitCd = 0.4;
    }
    this.health -= n;
    if (this.health <= 0 && !this.dead) {
      this.health = 0;
      this.dead = true;
      return true;
    }
    return false;
  }

  /** Point on the vehicle's oriented box nearest to (px,pz), in world space. */
  nearest(px, pz) {
    const f = this.forward;
    const rx = f.z, rz = -f.x;
    const dx = px - this.x, dz = pz - this.z;
    let lf = clamp(dx * f.x + dz * f.z, -this.halfLen, this.halfLen);
    let lr = clamp(dx * rx + dz * rz, -this.halfWid, this.halfWid);
    return { x: this.x + f.x * lf + rx * lr, z: this.z + f.z * lf + rz * lr };
  }
}

export function randomCarColor(seed) {
  return CAR_COLORS[Math.floor(hash2(seed, 5) * CAR_COLORS.length) % CAR_COLORS.length];
}
