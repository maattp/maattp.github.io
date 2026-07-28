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
import { makeHumanoid, buildCharacter, BONES } from './peds.js';
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
const DISC = [0.30, 0.31, 0.33];
const CALIPER = [0.55, 0.09, 0.07];
// Inside of every recess. Near-black rather than black so the wall still takes
// a little bounce and the depth of the pocket reads.
const CAVITY = [0.035, 0.04, 0.045];

// len/wid in metres; sill = bottom of the visible bodywork, belt = shoulder
// line, roof = roof height, cab = greenhouse extent as a fraction of length.
// Longitudinal resistance, shared by the integrator and by deriveSpec so the
// solved top speed is the one the integrator actually converges to.
// These were 0.0016 and 0.07, which at 57 m/s cost a sedan 5.2 and 4.0 m/s^2
// against a real ~0.9 and ~0.12 -- roughly five times too much drag and thirty
// times too much rolling resistance. That is what held every top speed far
// under its class and forced the launch accelerations up to compensate, so a
// family sedan did 0-100 in 3.5 s and still could not reach 100 km/h.
const DRAG = 0.00040;
const ROLL = 0.020;
const V0_100 = 100 / 3.6;

export const TYPES = {
  sedan: deriveSpec({len: 5.06, wid: 1.90, wheelR: 0.34, sill: 0.30, belt: 1.06, roof: 1.50, cab: [-0.26, 0.10], hand: 'sedan', mass: 1.0, acc: 4.1, topKph: 205, brakeM: 40, latG: 0.88 }),
  hatch: deriveSpec({len: 4.10, wid: 1.76, wheelR: 0.31, sill: 0.29, belt: 0.96, roof: 1.50, cab: [-0.30, 0.16], mass: 0.9, acc: 3.6, topKph: 185, brakeM: 41, latG: 0.85 }),
  compact: deriveSpec({len: 3.74, wid: 1.68, wheelR: 0.29, sill: 0.28, belt: 0.94, roof: 1.48, cab: [-0.28, 0.15], mass: 0.85, acc: 3.0, topKph: 170, brakeM: 43, latG: 0.83 }),
  suv: deriveSpec({len: 4.94, wid: 1.98, wheelR: 0.38, sill: 0.46, belt: 1.30, roof: 1.88, cab: [-0.34, 0.20], hand: 'suv', mass: 1.3, acc: 4.0, topKph: 195, brakeM: 42, latG: 0.8 }),
  // `hand` sends a type to its own authored builder instead of the shared
  // loft. sill/belt/roof are then a DESCRIPTION of what that builder draws
  // rather than an input to it, so they stay readable next to the other rows.
  sports: deriveSpec({len: 4.42, wid: 1.92, wheelR: 0.34, sill: 0.22, belt: 0.94, roof: 1.32, cab: [-0.24, 0.06], hand: 'sports', mass: 0.85, acc: 7.4, topKph: 275, brakeM: 33, latG: 1.02 }),
  // Cab-forward and low, on a long wheelbase with almost no overhang -- the
  // shape a floor full of batteries gives you. Heavier than the sports car and
  // quicker anyway, because the torque is all there from a standstill.
  ev: deriveSpec({len: 4.62, wid: 1.98, wheelR: 0.36, sill: 0.22, belt: 0.79, roof: 1.25, cab: [-0.28, 0.09], ev: true, mass: 1.2, acc: 9.0, topKph: 235, brakeM: 35, latG: 0.96 }),
  muscle: deriveSpec({len: 5.02, wid: 1.98, wheelR: 0.35, sill: 0.26, belt: 1.02, roof: 1.40, cab: [-0.24, 0.13], hand: 'muscle', mass: 1.15, acc: 7.0, topKph: 265, brakeM: 36, latG: 0.94 }),
  // Roofless muscle. `roof` is the top of the windscreen frame, 16 cm under the
  // coupe's, and there is no greenhouse above the beltline at all -- which is
  // why the interior has to be built: you look straight down into it.
  convertible: deriveSpec({len: 4.86, wid: 1.94, wheelR: 0.35, sill: 0.26, belt: 1.00, roof: 1.34, cab: [-0.24, 0.10], hand: 'convertible', mass: 1.10, acc: 6.6, topKph: 250, brakeM: 37, latG: 0.90 }),
  // Motorcycles. `moto` is not a styling flag: it switches the ground solve to
  // two contact patches and turns on lean, both of which are wrong for a car
  // and both of which a bike looks broken without. Light, quick, and with LESS
  // braking distance in hand and less lateral grip than a car of the same era
  // -- two contact patches the size of a credit card is what that costs.
  cruiser: deriveSpec({len: 2.56, wid: 0.95, wheelR: 0.40, sill: 0.30, belt: 0.80, roof: 1.24, cab: [-0.2, 0.1], hand: 'cruiser', moto: true, mass: 0.22, acc: 7.2, topKph: 190, brakeM: 48, latG: 0.80 }),
  sportbike: deriveSpec({len: 2.05, wid: 0.72, wheelR: 0.32, sill: 0.28, belt: 0.78, roof: 1.18, cab: [-0.2, 0.1], hand: 'sportbike', moto: true, mass: 0.16, acc: 10.2, topKph: 285, brakeM: 40, latG: 1.08 }),
  pickup: deriveSpec({len: 5.92, wid: 2.05, wheelR: 0.42, sill: 0.48, belt: 1.26, roof: 1.98, cab: [-0.15, 0.22], hand: 'pickup', mass: 1.4, acc: 4.4, topKph: 185, brakeM: 45, latG: 0.77 }),
  van: deriveSpec({len: 5.26, wid: 2.00, wheelR: 0.35, sill: 0.36, belt: 1.10, roof: 2.28, cab: [-0.44, 0.30], boxy: 2, mass: 1.5, acc: 2.9, topKph: 155, brakeM: 47, latG: 0.73 }),
  taxi: deriveSpec({len: 4.76, wid: 1.85, wheelR: 0.33, sill: 0.30, belt: 0.98, roof: 1.48, cab: [-0.28, 0.19], taxi: true, mass: 1.0, acc: 3.8, topKph: 195, brakeM: 41, latG: 0.85 }),
  police: deriveSpec({len: 4.98, wid: 1.92, wheelR: 0.34, sill: 0.30, belt: 1.00, roof: 1.48, cab: [-0.28, 0.19], police: true, mass: 1.1, acc: 5.6, topKph: 230, brakeM: 37, latG: 0.93 }),
  bus: deriveSpec({len: 12.0, wid: 2.55, wheelR: 0.50, sill: 0.50, belt: 1.30, roof: 3.10, cab: [-0.48, 0.48], bus: true, boxy: 3, mass: 4.5, acc: 1.4, topKph: 95, brakeM: 52, latG: 0.62 }),
  boxtruck: deriveSpec({len: 7.5, wid: 2.38, wheelR: 0.46, sill: 0.62, belt: 1.55, roof: 2.55, cab: [0.14, 0.46], cargo: 2.55, boxy: 2, mass: 3.0, acc: 2.5, topKph: 125, brakeM: 51, latG: 0.66 }),
  ambulance: deriveSpec({len: 6.3, wid: 2.28, wheelR: 0.42, sill: 0.56, belt: 1.42, roof: 2.35, cab: [0.16, 0.46], cargo: 2.25, boxy: 2, emergency: true, mass: 2.4, acc: 3.2, topKph: 155, brakeM: 48, latG: 0.72 }),
  garbage: deriveSpec({len: 8.1, wid: 2.48, wheelR: 0.50, sill: 0.66, belt: 1.62, roof: 2.6, cab: [0.20, 0.46], cargo: 2.5, boxy: 2, mass: 4.0, acc: 1.2, topKph: 90, brakeM: 55, latG: 0.61 }),
};

/**
 * Turn the declared class figures into the constants the driving model wants.
 *
 * `top` used to be a curve parameter that the code called a top speed, and the
 * two are not the same number: drag and rolling resistance balance the engine
 * well before it. Measured, a sedan declaring 42 m/s actually stopped at 27.8,
 * and NINE of the fifteen types could not reach 100 km/h at all -- including
 * the pickup, the SUV and the panel van.
 *
 * The table now declares what a vehicle DOES: real top speed in km/h, real
 * 100-0 braking in metres, real lateral grip in g. Everything the integrator
 * needs is solved from those, so the table can be read against a spec sheet and
 * `tools/vehicles.mjs` can check it.
 */
function deriveSpec(s) {
  const V = s.topKph / 3.6;                       // target terminal velocity
  // At terminal: acc * (1 - V/param) == drag + rolling. Solve for param.
  const resist = DRAG * V * V + ROLL * V;
  // The EV's pull tails off as sqrt(fade), not linearly, so the same parameter
  // carries it a good deal further -- solved as if it were linear it overshot
  // its declared top by 47 km/h.
  const frac = s.ev ? 1 - (resist / s.acc) ** 2 : 1 - resist / s.acc;
  // A vehicle whose launch acceleration cannot even overcome its own drag at
  // the declared top speed is a table error, not a tuning choice.
  if (frac <= 0.02) {
    throw new Error(`vehicle spec: acc ${s.acc} too low to reach ${s.topKph} km/h`);
  }
  s.fadeTop = V / frac;
  // 100-0 in `brakeM` metres, at constant deceleration: a = v^2 / 2d.
  // Drag and rolling resistance help stop the car too, so the brakes have to
  // supply the target deceleration MINUS what the air and the tyres already
  // give. Ignoring it made every vehicle stop about 15 % shorter than declared.
  const vMean = V0_100 / 2;
  s.brakeA = (V0_100 * V0_100) / (2 * s.brakeM) - (DRAG * vMean * vMean + ROLL * vMean);
  // Lateral limit in m/s^2, which is what the friction circle below compares.
  s.latA = s.latG * 9.81;
  return s;
}

// Weighted by repetition. Two bikes in eighteen is about one vehicle in nine,
// which is a summer afternoon in a American city and not a bike show.
export const CIVILIAN_TYPES = ['sedan', 'sedan', 'hatch', 'compact', 'suv', 'suv', 'sports', 'ev', 'muscle', 'convertible', 'pickup', 'van', 'taxi', 'boxtruck', 'bus', 'garbage', 'cruiser', 'sportbike'];

export const CAR_COLORS = [
  0x9fa4a9, 0x1b1d20, 0xe6e8ea, 0x6d0f14, 0x102b52, 0x14472f, 0x7a5a22,
  0x2f3a44, 0x9c968c, 0x4a2058, 0xb85f0c, 0x0d5b66, 0x5b5f63, 0xbcc2c8,
  0x243b6b, 0x7d2418,
];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Body cross-section: 16 points with the features a car section actually has.
 *
 * This replaced an eight-point octagon with one corner radius, which is why
 * every car in the fleet was the same shape at a different scale -- a sedan, a
 * hatchback, a compact, a muscle car, a taxi and a police cruiser all came out
 * at exactly 1430 triangles because the only thing separating them was the
 * numbers fed to the same tube.
 *
 * The parameters are the ones a body engineer would name:
 *
 *   shoulder  height of the widest point, as a fraction of the section. Low is
 *             a truck, high is a coupe with its waist up by the glass.
 *   tumble    tumblehome: how far the section leans IN above the shoulder.
 *             Dead vertical sides are the strongest "untextured box" signal a
 *             vehicle can give, and every one of these had zero.
 *   tuck      how far the sill pulls in underneath, so the body sits on the
 *             wheels rather than resting on a slab.
 *   crown     roof camber. Flat roofs read as cardboard.
 *   edge      how sharp the shoulder crease is: 0 is a soft radius, 1 a hard
 *             folded line down the side.
 *
 * Point count is fixed at 16 because `loft` requires every ring to have the
 * same number, and nothing may index into the result by position -- use
 * `maxX`/`maxY`, or the next profile change silently reshapes the roof.
 */
function section(w, y0, y1, o = {}) {
  const {
    r = 0.12, shoulder = 0.52, tumble = 0.05, tuck = 0.07, crown = 0.03, edge = 0.4,
  } = o;
  const h = Math.abs(y1 - y0);
  const rr = Math.min(r, h / 2.6, w / 2.6);
  const wb = w * (1 - tuck);
  const wt = w * (1 - tumble);
  const ysh = y0 + h * shoulder;
  const yc = y1 + h * crown;
  // Above and below the crease the section pulls in by `edge`: a hard crease
  // leaves the surfaces meeting at an angle, a soft one rounds them together.
  const lo = w - (w - wb) * (1 - edge) * 0.5;
  const hi = w - (w - wt) * (1 - edge) * 0.5;
  const half = (sx) => [
    [sx * wb, y0],
    [sx * lo, y0 + h * 0.16],
    [sx * w, ysh - h * 0.09],
    [sx * w, ysh],
    [sx * hi, ysh + h * 0.20],
    [sx * wt, y1 - rr],
    [sx * (wt - rr), yc],
    [sx * wt * 0.34, yc],
  ];
  // Left side bottom-to-top, then right side top-to-bottom: a closed loop.
  return [...half(-1), ...half(1).reverse()];
}

// The contiguous run of `section` points that forms the TOP arc of the loop:
// half(-1)'s last three, then half(1)'s last three, which the reverse puts
// straight after them. This lives here so it moves with the profile above --
// it is the one place anything is allowed to index into a section by position,
// and only because there is no other way to lay a panel exactly on top of a
// lofted shell. Change `half()` and change this.
const SEC_TOP = [5, 10];

/** Widest half-width of a section, so nothing has to index into it. */
function maxX(pts) {
  let m = 0;
  for (const p of pts) m = Math.max(m, Math.abs(p[0]));
  return m;
}

/** Highest point of a section. */
function maxY(pts) {
  let m = -1e9;
  for (const p of pts) m = Math.max(m, p[1]);
  return m;
}

/**
 * One wheel: tyre with a real sidewall into `matte`; rim, spokes, brake disc
 * and caliper into `trim`.
 *
 * What this replaced was 14 segments of flat tread, no sidewall at all, and
 * alternating triangles across a disc standing in for spokes -- on the one
 * part of a car a player is always looking at. A wheel is a lathe, so it is
 * built as a lathe: a chain of bands of revolution between (x, radius) pairs,
 * with the normal for each band derived from its own slope so the tread crown
 * and the sidewall bulge shade as curves rather than as facets.
 *
 * `out` is which way the OUTBOARD face points, +1 or -1. The spokes, disc and
 * caliper are only built on that side: the inboard face is never seen, and
 * building both doubles the cost on every vehicle in the fleet.
 *
 * `out` 0 dresses BOTH faces and skips the plain inboard dish. That is for a
 * motorcycle, whose wheels are on the centreline: there is no inboard side, a
 * player walks round the bike, and a dished blank facing the kerb would be the
 * most obvious thing on it.
 */
function addWheel(trim, matte, cx, cy, cz, r, w, out = 1) {
  const SEG = 18;
  const hw = w / 2;
  const bead = r * 0.70;              // where the tyre grips the rim
  const ang = (i) => (i / SEG) * Math.PI * 2;

  /**
   * Band of revolution about the axle from (x0, r0) to (x1, r1). `hint` is a
   * rough outward direction in (x, radial) so the band faces the right way --
   * the sign cannot be derived from the slope alone, because a sidewall that
   * bulges out and then tucks back in reverses it halfway along.
   */
  const band = (b, x0, r0, x1, r1, col, hint) => {
    let nx = -(r1 - r0), nr = x1 - x0;
    const l = Math.hypot(nx, nr) || 1;
    nx /= l; nr /= l;
    if (nx * hint[0] + nr * hint[1] < 0) { nx = -nx; nr = -nr; }
    for (let i = 0; i < SEG; i++) {
      const a0 = ang(i), a1 = ang(i + 1);
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const n0 = [nx, nr * c0, nr * s0], n1 = [nx, nr * c1, nr * s1];
      b.quad(
        [cx + x0, cy + c0 * r0, cz + s0 * r0], [cx + x0, cy + c1 * r0, cz + s1 * r0],
        [cx + x1, cy + c1 * r1, cz + s1 * r1], [cx + x1, cy + c0 * r1, cz + s0 * r1],
        [n0, n1, n1, n0], [0, 0, 1, 0, 1, 1, 0, 1], col);
    }
  };
  const disc = (b, x, r0, r1, dir, col) => {
    for (let i = 0; i < SEG; i++) {
      const a0 = ang(i), a1 = ang(i + 1);
      b.quad(
        [cx + x, cy + Math.cos(a0) * r0, cz + Math.sin(a0) * r0],
        [cx + x, cy + Math.cos(a1) * r0, cz + Math.sin(a1) * r0],
        [cx + x, cy + Math.cos(a1) * r1, cz + Math.sin(a1) * r1],
        [cx + x, cy + Math.cos(a0) * r1, cz + Math.sin(a0) * r1],
        [dir, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], col);
    }
  };

  // tread, crowned so the contact patch is not a flat ribbon
  band(matte, -hw, r * 0.955, -hw * 0.52, r, TYRE, [0, 1]);
  band(matte, -hw * 0.52, r, hw * 0.52, r, TYRE, [0, 1]);
  band(matte, hw * 0.52, r, hw, r * 0.955, TYRE, [0, 1]);
  for (const sx of [-1, 1]) {
    band(matte, sx * hw, r * 0.955, sx * hw * 1.10, r * 0.87, TYRE, [sx, 0.5]);
    band(matte, sx * hw * 1.10, r * 0.87, sx * hw * 0.96, bead, TYRE, [sx, 0.3]);
    band(trim, sx * hw * 0.96, bead, sx * hw * 0.55, bead * 0.99, RIM, [0, 1]);
  }
  // inboard face is a plain dish -- nothing behind a car's wheel is ever in
  // frame, and a bike (out 0) has no inboard face to hide
  if (out !== 0) disc(trim, -out * hw * 0.55, bead * 0.99, r * 0.16, -out, HUB);

  const dress = (o) => {
    const face = o * hw * 0.55;       // rim face plane, set in from the sidewall
    // brake disc first, so it shows through the gaps between spokes
    band(trim, face * 0.30, r * 0.60, face * 0.46, r * 0.60, DISC, [0, 1]);
    disc(trim, face * 0.46, r * 0.60, r * 0.22, o, DISC);
    const ca = 2.35;
    trim.tube(
      [cx + face * 0.14, cy + Math.cos(ca - 0.34) * r * 0.52, cz + Math.sin(ca - 0.34) * r * 0.52],
      [cx + face * 0.14, cy + Math.cos(ca + 0.34) * r * 0.52, cz + Math.sin(ca + 0.34) * r * 0.52],
      r * 0.11, 6, CALIPER, true);

    disc(trim, face, bead * 0.99, bead * 0.88, o, RIM);            // rim lip
    band(trim, face, bead * 0.88, face * 0.62, bead * 0.88, RIM, [0, 1]);
    const SPOKES = 5;
    const hubR = r * 0.20, spokeX = face * 0.62;
    for (let s = 0; s < SPOKES; s++) {
      const a = (s / SPOKES) * Math.PI * 2 + 0.35;
      const p = (rr, da, x) => [cx + x, cy + Math.cos(a + da) * rr, cz + Math.sin(a + da) * rr];
      const wo = 0.30, wi = 0.17;
      trim.quad(p(bead * 0.89, -wo, face), p(bead * 0.89, wo, face), p(hubR, wi, spokeX), p(hubR, -wi, spokeX),
        [o, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], RIM);
      // sides, so a spoke has depth and catches the light along its edge
      for (const sg of [-1, 1]) {
        trim.quad(p(bead * 0.89, sg * wo, face), p(hubR, sg * wi, spokeX),
          p(hubR, sg * wi, spokeX - o * 0.03), p(bead * 0.89, sg * wo, face - o * 0.03),
          [0, -Math.sin(a + sg * wo) * sg, Math.cos(a + sg * wo) * sg], [0, 0, 1, 0, 1, 1, 0, 1], HUB);
      }
    }
    disc(trim, spokeX, hubR, r * 0.05, o, HUB);
    disc(trim, spokeX + o * 0.012, r * 0.09, 0.001, o, CHROME);
  };
  if (out === 0) { dress(1); dress(-1); } else dress(out);
}

/**
 * A recess set into a body surface, facing +Z (`dir` 1) or -Z (`dir` -1).
 *
 * There is no boolean operation in this builder, so an aperture cannot be cut
 * out of a lofted shell, and a pocket sunk flush z-fights with the paint behind
 * it. The rim therefore stands about a centimetre PROUD of the surface: it
 * hides the skin behind it from every angle a car is seen from, and what reads
 * is a real opening rather than a black rectangle painted on the nose. This is
 * the difference between a grille and a decal, and between an exhaust outlet
 * and a pipe stuck on the bumper.
 *
 * Returns the back plane so the caller can put a lens or a mesh in it.
 */
function pocket(rimB, wallB, cx, cy, cz, hw, hh, depth, dir, o = {}) {
  const { rim = 0.03, lip = 0.022, rimCol = WHITE, wallCol = CAVITY, taper = 0.88 } = o;
  const zf = cz + dir * lip, zb = cz - dir * depth;
  const rect = (x, y, z) => [[cx - x, cy - y, z], [cx + x, cy - y, z], [cx + x, cy + y, z], [cx - x, cy + y, z]];
  const A = rect(hw + rim, hh + rim, zf), B = rect(hw, hh, zf);
  const C = rect(hw * taper, hh * taper, zb), D = rect(hw + rim, hh + rim, cz - dir * 0.01);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const ox = (A[i][0] + A[j][0]) / 2 - cx, oy = (A[i][1] + A[j][1]) / 2 - cy;
    const l = Math.hypot(ox, oy) || 1;
    rimB.quad(A[i], A[j], B[j], B[i], [0, 0, dir], [0, 0, 1, 0, 1, 1, 0, 1], rimCol);
    rimB.quad(A[i], A[j], D[j], D[i], [ox / l, oy / l, 0], [0, 0, 1, 0, 1, 1, 0, 1], rimCol);
    wallB.quad(B[i], B[j], C[j], C[i], [-ox / l, -oy / l, 0], [0, 0, 1, 0, 1, 1, 0, 1], wallCol);
  }
  wallB.quad(C[0], C[1], C[2], C[3], [0, 0, dir], [0, 0, 1, 0, 1, 1, 0, 1], wallCol);
  return { z: zb, hw: hw * taper, hh: hh * taper };
}

/**
 * Flat end face with the apertures genuinely cut out of it.
 *
 * `loft`'s cap is a solid triangle fan, so a `pocket` sunk into a capped end
 * looks straight back at painted bodywork a few centimetres behind the rim --
 * the grille and the headlamps come out as flat plates with a raised outline
 * and no depth at all. It does NOT show up in a render, which reads as "the
 * recess is too shallow"; a raycast down the middle of the grille returned
 * `paint` at z 2.21 with the pocket's own back panel 12 cm further in, which is
 * one step from the cause. Same lesson as the wheel-well slab.
 *
 * The face is built as horizontal bands with the aperture x-spans subtracted,
 * so there is nothing behind a hole. `prof` is [[y, halfWidth], ...] ascending
 * in y -- the end section's own outline, so the face follows the bodywork.
 * `holes` are [xCentre, yCentre, halfW, halfH] and mirror themselves in x.
 */
function endFace(b, z, dir, prof, holes, col) {
  const y0 = prof[0][0], y1 = prof[prof.length - 1][0];
  const hwAt = (y) => {
    if (y <= y0 || y >= y1) return 0;
    for (let i = 1; i < prof.length; i++) {
      if (y <= prof[i][0]) {
        const t = (y - prof[i - 1][0]) / ((prof[i][0] - prof[i - 1][0]) || 1);
        return prof[i - 1][1] + (prof[i][1] - prof[i - 1][1]) * t;
      }
    }
    return 0;
  };
  const cuts = new Set();
  for (const [, hy, , hh] of holes) { cuts.add(hy - hh); cuts.add(hy + hh); }
  const edges = [y0, ...[...cuts].filter((y) => y > y0 && y < y1).sort((a, c) => a - c), y1];
  const n = [0, 0, dir];
  const clip = (x, y) => Math.max(-hwAt(y), Math.min(hwAt(y), x));
  for (let i = 0; i < edges.length - 1; i++) {
    // Each band is subdivided so the outer edge follows the section's curve
    // instead of chording across it.
    const SUB = 3;
    for (let k = 0; k < SUB; k++) {
      const ya = edges[i] + ((edges[i + 1] - edges[i]) * k) / SUB;
      const yb = edges[i] + ((edges[i + 1] - edges[i]) * (k + 1)) / SUB;
      const mid = (ya + yb) / 2;
      const bad = [];
      for (const [hx, hy, hw, hh] of holes) {
        if (Math.abs(mid - hy) >= hh) continue;
        bad.push([hx - hw, hx + hw]);
        if (hx !== 0) bad.push([-hx - hw, -hx + hw]);
      }
      bad.sort((p, q) => p[0] - q[0]);
      const lim = Math.max(hwAt(ya), hwAt(yb));
      const spans = [];
      let x = -lim;
      for (const [a, c] of bad) { if (a > x) spans.push([x, Math.min(a, lim)]); x = Math.max(x, c); }
      if (x < lim) spans.push([x, lim]);
      for (const [xa, xb] of spans) {
        if (xb - xa < 1e-4) continue;
        b.quad([clip(xa, ya), ya, z], [clip(xb, ya), ya, z], [clip(xb, yb), yb, z], [clip(xa, yb), yb, z],
          n, [0, 0, 1, 0, 1, 1, 0, 1], col);
      }
    }
  }
}

/** Round version of `pocket` -- exhaust outlets, intakes. */
function hole(rimB, wallB, cx, cy, cz, r, depth, dir, o = {}) {
  const { rim = 0.022, lip = 0.016, seg = 12, rimCol = CHROME, wallCol = CAVITY } = o;
  const zf = cz + dir * lip, zb = cz - dir * depth;
  const at = (i, rr, z) => [cx + Math.cos((i / seg) * Math.PI * 2) * rr, cy + Math.sin((i / seg) * Math.PI * 2) * rr, z];
  for (let i = 0; i < seg; i++) {
    const j = i + 1;
    const mx = Math.cos(((i + 0.5) / seg) * Math.PI * 2), my = Math.sin(((i + 0.5) / seg) * Math.PI * 2);
    rimB.quad(at(i, r + rim, zf), at(j, r + rim, zf), at(j, r, zf), at(i, r, zf), [0, 0, dir], [0, 0, 1, 0, 1, 1, 0, 1], rimCol);
    rimB.quad(at(i, r + rim, zf), at(j, r + rim, zf), at(j, r + rim, cz - dir * 0.02), at(i, r + rim, cz - dir * 0.02),
      [mx, my, 0], [0, 0, 1, 0, 1, 1, 0, 1], rimCol);
    wallB.quad(at(i, r, zf), at(j, r, zf), at(j, r * 0.9, zb), at(i, r * 0.9, zb), [-mx, -my, 0], [0, 0, 1, 0, 1, 1, 0, 1], wallCol);
    wallB.tri([cx, cy, zb], at(i, r * 0.9, zb), at(j, r * 0.9, zb), [0, 0, dir], wallCol);
  }
}

/** Smooth curve through authored key stations, keyed on z. Keys ascend in z. */
function curve(keys) {
  return (z) => {
    if (z <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (z <= keys[i][0]) {
        const [z0, v0] = keys[i - 1], [z1, v1] = keys[i];
        const t = (z - z0) / (z1 - z0);
        // smoothstep, so the surface has no kink where two stations meet
        return v0 + (v1 - v0) * t * t * (3 - 2 * t);
      }
    }
    return keys[keys.length - 1][1];
  };
}

/**
 * The shared half of an authored body: the lofted volume, the wheel arches and
 * the end profiles the fascias are cut into.
 *
 * What is shared here is the TECHNIQUE, not the shape. Every number that
 * decides what the car looks like is a curve the caller writes; this function
 * only knows how to turn five curves into a shell with real arch openings and
 * to hand back the section so the caller can register panels against it. That
 * distinction is the whole difference from `buildGeneric`, where the shape
 * itself came out of one parameterised tube.
 */
function bodyCore(spec, paint, matte, cfg) {
  const {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR = 0.55, archGap = 0.05, archPow = 2, creaseAt = 0.60, tumble = 0.90,
    deckDrop = 0.030, lipOut = 0.07, endRound = 0.12, endMin = 0.88,
    lipInto = paint, lipCol = WHITE, deckDip = null,
    stations = 44,
  } = cfg;
  const W = spec.wid / 2, wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const archTop = wr * 2 + archGap;              // the opening clears the tyre
  // `archPow` squares the opening off. 2 is a semicircle, which is a car; above
  // that the corners pull out toward a rectangle, which is what a truck or a
  // crossover has, and it is visible in silhouette from across a street.
  // Everything downstream reads the arch through this ONE function -- the lip
  // takes its y from `half()` and the liner calls `archShape` itself -- so a
  // change of profile cannot leave the lip trimming a differently-shaped hole.
  const archShape = (u) => (1 - Math.abs(u) ** archPow) ** (1 / archPow);
  const archLift = (z) => {
    let l = 0;
    for (const az of [zR, zF]) {
      const d = Math.abs(z - az);
      if (d < archR) l = Math.max(l, archTop * archShape(d / archR));
    }
    return l;
  };

  const geom = (z) => {
    const w = W * halfW(z);
    const y0 = Math.max(sillY(z), archLift(z));
    const y1 = beltY(z);
    const h = Math.max(0.10, y1 - y0);
    return { w, wb: w * tuckAt(z), tw: w * topAt(z), y0, y1, h, yc: y0 + h * creaseAt };
  };

  // Half the body section, sill to deck centre. Two points are DOUBLED -- the
  // shoulder crease and the bonnet crest. `loft` averages a point's normals
  // from its neighbours, so a single corner shades as a soft radius however
  // sharp the numbers are; two coincident points give the surfaces either side
  // their own normal and the flank gets a hard folded line down it. That line
  // is most of what says a body was styled rather than extruded.
  //
  // `deckDip` sinks the two innermost points to a floor height, which turns
  // the closed deck into an open tub -- the convertible's cockpit. It is done
  // HERE, in the section, rather than by laying an interior over the deck,
  // because there is no boolean operation in this builder: bodywork drawn at
  // the beltline across the middle of the car hides anything put underneath it,
  // and no amount of interior helps if the lid is still on.
  const half = (z, s) => {
    const g = geom(z);
    const dip = deckDip ? Math.max(deckDip(z), g.y0 + 0.06) : null;
    if (dip !== null && dip < g.y1 - 0.02) {
      return [
        [s * g.wb * 0.58, g.y0],
        [s * g.wb, g.y0 + g.h * 0.06],
        [s * g.w * 0.975, g.y0 + g.h * 0.30],
        [s * g.w, g.yc - g.h * 0.10],
        [s * g.w, g.yc],
        [s * g.w, g.yc + 0.006],
        [s * g.w * 0.965, g.yc + g.h * 0.16],
        [s * g.w * tumble, g.y1 - g.h * 0.22],
        [s * g.tw, g.y1 - deckDrop],
        [s * g.tw * 0.965, g.y1 - deckDrop - 0.030],   // the door's inner lip
        [s * g.tw * 0.72, dip],                        // tub wall, then floor
        [s * g.tw * 0.24, dip],
      ];
    }
    return [
      [s * g.wb * 0.58, g.y0],
      [s * g.wb, g.y0 + g.h * 0.06],            // sill outer -- the arch edge
      [s * g.w * 0.975, g.y0 + g.h * 0.30],
      [s * g.w, g.yc - g.h * 0.10],
      [s * g.w, g.yc],
      [s * g.w, g.yc + 0.006],                  // crease, doubled
      [s * g.w * 0.965, g.yc + g.h * 0.16],
      [s * g.w * tumble, g.y1 - g.h * 0.22],    // tumblehome
      [s * g.tw, g.y1 - deckDrop],              // shoulder / deck edge
      [s * g.tw * 0.995, g.y1 - deckDrop + 0.008],
      [s * g.tw * 0.70, g.y1],
      [s * g.tw * 0.24, g.y1 + 0.008],
    ];
  };
  const P_SILL = 1;                             // index into half(), above

  // The last few centimetres at each end roll in, so the nose and tail have a
  // radius rather than a sheared-off edge. Not to a point, though: what is left
  // is the fascia the lamps and the grille are set into.
  const endK = (z) => {
    const e = Math.min((nose - z) / endRound, (z - tail) / endRound);
    return e >= 1 ? 1 : endMin + (1 - endMin) * Math.sqrt(Math.max(0, e));
  };
  const bodyRings = [];
  for (let i = 0; i <= stations; i++) {
    const z = tail + (nose - tail) * (i / stations);
    const g = geom(z), mid = (g.y0 + g.y1) / 2, k = endK(z);
    bodyRings.push({
      z,
      pts: [...half(z, -1), ...half(z, 1).reverse()].map(([x, y]) => [x * k, mid + (y - mid) * k]),
    });
  }
  // Uncapped: `endFace` closes both ends, with the apertures cut out of them.
  paint.loft(bodyRings, WHITE, { capStart: false, capEnd: false });

  // Wheel arches: a flared lip outside, a dark liner tunnelled in behind it.
  // Both walk the same angles and read their x from the same `half` that drew
  // the body, so the lip cannot drift off the opening it is trimming -- the
  // arithmetic that would have to be kept in step simply does not exist.
  const arch = (az, sx) => {
    // Where the opening meets the sill, inverted through `archShape` rather
    // than assumed to be a sine -- with a squared arch the two differ by enough
    // to leave the lip hanging in mid-air at both ends.
    const s = Math.min(0.99, sillY(az) / archTop);
    const th0 = Math.acos((1 - s ** archPow) ** (1 / archPow)) + 0.04;
    const N = 12;
    const lip = [[], [], []], liner = [[], [], [], []];
    // The liner closes over toward the axle, so an arch is a dark cavity from
    // every angle rather than a hole you can see daylight through.
    const inner = [[0.008, 1.00], [0.26, 1.00], [0.30, 0.74], [0.31, 0.26]];
    for (let i = 0; i <= N; i++) {
      const th = th0 + ((Math.PI - 2 * th0) * i) / N;
      const z = az + Math.cos(th) * archR;
      const [lx, ly] = half(z, sx)[P_SILL];
      lip[0].push([lx, ly, z]);
      lip[1].push([lx + sx * lipOut, ly - 0.014, z]);
      lip[2].push([lx + sx * lipOut * 0.66, ly - 0.058, z]);
      for (let k = 0; k < 4; k++) {
        const [inset, t] = inner[k];
        liner[k].push([lx - sx * inset,
          wr * 0.42 + (archTop * 0.97 * archShape(Math.cos(th)) - wr * 0.42) * t,
          az + Math.cos(th) * archR * 0.97 * t]);
      }
    }
    lipInto.patch(lip, lipCol, [sx, 0.2, 0]);
    matte.patch(liner, CAVITY, [-sx, 0, 0]);
  };
  for (const az of [zF, zR]) for (const sx of [-1, 1]) arch(az, sx);

  return {
    geom,
    half,
    /** The end section as [[y, halfWidth], ...] ascending, for `endFace`. */
    endProf: (z) => {
      const g = geom(z), mid = (g.y0 + g.y1) / 2, k = endK(z);
      return half(z, 1).map(([x, y]) => [mid + (y - mid) * k, x * k]);
    },
  };
}

/**
 * The sports car, modelled rather than parameterised.
 *
 * The technique, which is the point of this function and is meant to be copied
 * for the rest of the fleet:
 *
 *  1. The main volume is still a loft, but through ~44 stations driven by
 *     SEPARATE authored curves for half-width, sill height and beltline. One
 *     curve per feature is what lets the nose be low while the cowl rises and
 *     the rear haunch stands over the wheel -- with a single scalar and a
 *     handful of flags every car is the same tube at a different size.
 *  2. The wheel arches are cut into that loft's bottom edge and then dressed:
 *     a flared lip built from the SAME curves (so it registers by construction
 *     rather than by arithmetic that has to be kept in step) and a dark liner
 *     tunnelled in behind it. An arch has to be an opening; a chamfer in a
 *     straight sill reads as a toy.
 *  3. Everything that should be a hole -- grille, headlamps, taillamps,
 *     exhausts -- is a `pocket`/`hole` whose rim stands proud of the paint.
 *     See those functions for why proud and not flush.
 *  4. The greenhouse is authored PANELS: windscreen, two side windows and a
 *     rear screen in glass, with A-pillars, a roof and sail panels in body
 *     colour between them. This is also how the floating-roof-plank bug is
 *     designed out -- there is no roof skin lofted over a glass tube to
 *     mis-register, the roof is a panel whose edges are shared points with the
 *     glass either side of it.
 */
function buildSports(spec, paint, trim, matte) {
  const W = spec.wid / 2, wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.36, zR = -1.36;               // axle centres, 2.72 m wheelbase

  // --- the four longitudinal curves ----------------------------------------
  // The full declared width is spent on the arches and the waist between them
  // is pulled in, rather than the whole flank being one width. That difference
  // is what a flare IS -- with a constant width there is nothing for the lip to
  // stand proud of and the car reads slab-sided at any track.
  const halfW = curve([
    [tail, 0.84], [-1.95, 0.94], [zR, 1.00], [-0.70, 0.90], [0, 0.885],
    [0.70, 0.90], [zF, 0.985], [1.85, 0.90], [2.10, 0.85], [nose, 0.76],
  ]);
  const sillY = curve([
    [tail, 0.36], [-1.85, 0.24], [-0.60, 0.19], [0.60, 0.19], [1.85, 0.24], [nose, 0.24],
  ]);
  // Low nose, rising cowl, haunch over the rear axle, then down to the tail.
  const beltY = curve([
    [tail, 0.90], [-1.90, 0.98], [zR, 1.00], [-0.60, 0.96], [0, 0.94],
    [0.55, 0.95], [0.88, 0.94], [1.20, 0.90], [1.55, 0.85], [1.90, 0.80], [nose, 0.76],
  ]);
  // How far the sill tucks under. Pinched at the waist between the arches and
  // let out over them, which is what makes the flares read as flares.
  const tuckAt = curve([
    [tail, 0.84], [zR, 0.93], [-0.60, 0.85], [0.60, 0.85], [zF, 0.93], [nose, 0.84],
  ]);
  // Width of the flat top deck. Narrow at the ends (a crowned bonnet and boot
  // lid), wide across the cabin so the greenhouse has something to stand on.
  const topAt = curve([
    [tail, 0.84], [-1.60, 0.90], [0.60, 0.90], [1.50, 0.88], [2.05, 0.78], [nose, 0.70],
  ]);

  const { geom, half, endProf } = bodyCore(spec, paint, matte,
    { halfW, sillY, beltY, tuckAt, topAt, zF, zR });

  // --- wheels --------------------------------------------------------------
  // Staggered: the rear tyre is wider than the front, which is most of what
  // says "rear drive" about a shape standing still.
  const twF = 0.235, twR = 0.28;
  const wxF = geom(zF).wb - twF / 2 + 0.02;
  const wxR = geom(zR).wb - twR / 2 + 0.02;
  const wheels = [
    [-wxF, wr, zF, wr, twF], [wxF, wr, zF, wr, twF],
    [-wxR, wr, zR, wr, twR], [wxR, wr, zR, wr, twR],
  ];

  // --- greenhouse: separate panels, real pillars ---------------------------
  const cowlZ = 0.82, cowlY = 0.955;
  const scrZ = -0.08, roofY = spec.roof;
  const backZ = -0.72;
  const rearZ = -1.62, rearY = 1.00;
  // The roof is the widest thing up here and the side glass tucks in under it.
  // The other way round, the glass hides the roof panel from every side angle
  // and the whole greenhouse reads as one dark mass with no roof at all.
  const wScrB = 0.70, wScrT = 0.585, wRoof = 0.60, wRearT = 0.578, wRear = 0.66;
  const wGlassT = 0.572, wGlassB = 0.678;

  const lp = (a, b, t) => a + (b - a) * t;
  // Windscreen: bowed forward in the middle and wrapped back at the edges,
  // which is what stops a screen reading as a flat sheet of slate.
  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(cowlZ, scrZ, t) + 0.035 * Math.sin(Math.PI * t);
    const cy = lp(cowlY, roofY, t) + 0.012 * Math.sin(Math.PI * t);
    const hwv = lp(wScrB, wScrT, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.030 * u * u, cz - 0.10 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);

  // Roof, with the outermost column rolled down into a drip rail so the panel
  // has an edge instead of ending in a knife.
  const roofCols = [[-0.98, -0.055], [-1, -0.012], [-0.94, 0], [-0.66, 0.008], [-0.3, 0.013],
    [0, 0.015], [0.3, 0.013], [0.66, 0.008], [0.94, 0], [1, -0.012], [0.98, -0.055]];
  const roofRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const cz = lp(scrZ, backZ, t), cy = lp(roofY, roofY - 0.01, t) + 0.008 * Math.sin(Math.PI * t);
    roofRows.push(roofCols.map(([u, dy]) => [u * wRoof, cy + dy - 0.022 * u * u, cz]));
  }
  paint.patch(roofRows, WHITE, [0, 1, 0]);

  // Fastback rear screen.
  const rearRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(backZ, rearZ, t), cy = lp(roofY - 0.01, rearY, t) + 0.022 * Math.sin(Math.PI * t);
    const hwv = lp(wRearT, wRear, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.035 * u * u, cz + 0.05 * u * u]);
    }
    rearRows.push(row);
  }
  trim.patch(rearRows, GLASS, [0, 0.6, -1]);

  // Side glass and the sail panel behind it, per side.
  const sgFB = [0.66, 0.965], sgFT = [-0.02, 1.272], sgRT = [-0.78, 1.258], sgRB = [-1.16, 1.01];
  for (const sx of [-1, 1]) {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 4; j++) {
        const u = j / 4;
        const bz = lp(sgFB[0], sgRB[0], u), by = lp(sgFB[1], sgRB[1], u);
        const tz = lp(sgFT[0], sgRT[0], u), ty = lp(sgFT[1], sgRT[1], u);
        row.push([sx * lp(wGlassB, wGlassT, t), lp(by, ty, t), lp(bz, tz, t)]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sx, 0, 0]);

    // A-pillar: the strip between the windscreen's outer edge and the front
    // edge of the side glass, built from the screen's OWN edge points so it is
    // flush with it. The first pass ran a `tube` up there and it read as a roll
    // bar lying on the roof -- a pillar is a panel, not a pipe.
    paint.patch(scrRows.map((r, i) => {
      const e = r[r.length - 1], t = i / 3;
      return [[sx * e[0], e[1], e[2]],
        [sx * lp(wGlassB, wGlassT, t), lp(sgFB[1], sgFT[1], t), lp(sgFB[0], sgFT[0], t)]];
    }), WHITE, [sx, 0.4, 0]);
    // C-pillar / sail panel: the fastback's shoulder, running from the rear
    // screen's own outer edge out to the back of the side glass and down to the
    // deck. It starts as a line where the glass meets the screen -- built from
    // two independent outlines instead it comes out twisted, and a twisted quad
    // reads as a flat plate stuck on the quarter.
    const sailOuter = [[wGlassT, sgRT[1], sgRT[0]], [0.640, 1.130, -1.02],
      [wGlassB, sgRB[1], sgRB[0]], [0.700, 0.965, rearZ]];
    paint.patch(rearRows.map((r, i) => {
      const e = r[r.length - 1], o = sailOuter[i];
      return [[sx * e[0], e[1], e[2]], [sx * o[0], o[1], o[2]]];
    }), WHITE, [sx, 0.4, 0]);
  }

  // --- front fascia --------------------------------------------------------
  // Every aperture is listed once and drives both the hole in the face and the
  // pocket set into it -- two lists that have to agree is how a recess ends up
  // with a rim over solid paint.
  const GRILLE = [0, 0.455, 0.28, 0.065], LAMP_A = [0.345, 0.60, 0.128, 0.055];
  const INTAKE = [0, 0.335, 0.40, 0.035];
  const TAILBAR = [0, 0.72, 0.50, 0.05], PIPE = [0.34, 0.48, 0.040, 0.040];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILBAR, PIPE], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.16, 1);
  // slats standing in the mouth, not painted on the nose
  for (let i = 0; i < 3; i++) {
    trim.box(0, 0.415 + i * 0.040, gp.z + 0.03, gp.hw * 1.9, 0.014, 0.035, 0, CHROME);
  }
  for (const sx of [-1, 1]) {
    const lp2 = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.11, 1, { rim: 0.024 });
    // Lens near the MOUTH of the housing, not at the back of it. `trim` is
    // metalness 0.88, so a coloured lens buried 10 cm inside a black pocket
    // sees nothing to reflect and renders as another patch of the pocket.
    trim.box(sx * LAMP_A[0], 0.575, nose - 0.035, lp2.hw * 1.86, 0.050, 0.024, 0, LAMP);
    trim.box(sx * LAMP_A[0], 0.552, lp2.z + 0.05, lp2.hw * 1.86, 0.014, 0.024, 0, AMBER);
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.14, 1, { rim: 0.026 });
  // splitter: a blade under the nose, tucked close enough to read as part of
  // the car rather than a tray sliding out from under it
  matte.box(0, 0.226, nose - 0.06, 1.24, 0.030, 0.28, 0, PLASTIC);
  for (const sx of [-1, 1]) matte.box(sx * 0.60, 0.226, nose - 0.11, 0.05, 0.09, 0.16, 0, PLASTIC);

  // --- rear ----------------------------------------------------------------
  const rz = tail;
  const tp = pocket(paint, matte, TAILBAR[0], TAILBAR[1], rz, TAILBAR[2], TAILBAR[3], 0.09, -1, { rim: 0.026 });
  trim.box(0, 0.678, rz + 0.024, tp.hw * 1.94, 0.086, 0.026, 0, TAILC);
  // one body-colour bridge across the middle, so the bar reads as two lamps
  paint.box(0, 0.665, rz + 0.014, 0.10, 0.11, 0.035, 0, WHITE);
  for (const sx of [-1, 1]) {
    trim.box(sx * 0.40, 0.605, rz - 0.03, 0.11, 0.05, 0.022, 0, WHITE);   // reversing lamp
    hole(trim, matte, sx * PIPE[0], PIPE[1], rz, 0.055, 0.12, -1);
  }
  trim.box(0, 0.492, rz - 0.028, 0.42, 0.135, 0.02, 0, PLATE);
  // diffuser: a ramp under the tail with fins standing in it
  matte.patch([
    [[-0.56, 0.17, -1.82], [0, 0.17, -1.82], [0.56, 0.17, -1.82]],
    [[-0.52, 0.38, rz - 0.02], [0, 0.38, rz - 0.02], [0.52, 0.38, rz - 0.02]],
  ], PLASTIC, [0, -1, 0]);
  for (const x of [-0.44, -0.22, 0, 0.22, 0.44]) {
    matte.box(x, 0.16, -2.02, 0.028, 0.20, 0.40, 0, PLASTIC);
  }

  // --- flanks: side skirts, shut lines, handles, mirrors -------------------
  for (const sx of [-1, 1]) {
    matte.box(sx * (geom(0).wb - 0.02), 0.175, 0, 0.09, 0.05, 1.62, 0, PLASTIC);
    // Shut lines follow the section itself rather than being a straight box
    // laid on a curved flank, which is why they stay a constant hairline all
    // the way up the door.
    for (const zc of [0.62, -0.64]) {
      const rows = [-0.009, 0.009].map((dz) =>
        half(zc + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, zc + dz]));
      matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    }
    const hg = geom(-0.06);
    trim.tube([sx * (hg.w * 0.985), hg.yc + 0.075, -0.10], [sx * (hg.w * 0.985), hg.yc + 0.075, 0.10],
      0.017, 6, CHROME, true);
    // mirror on a stalk, not a block bolted to the door
    paint.tube([sx * 0.700, 0.960, 0.64], [sx * 0.828, 0.995, 0.60], 0.021, 6, WHITE, true);
    const pod = (k) => {
      const out = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        out.push([sx * 0.878 + Math.cos(a) * 0.058 * k, 1.005 + Math.sin(a) * 0.046 * k]);
      }
      return out;
    };
    paint.loft([{ z: 0.505, pts: pod(0.86) }, { z: 0.575, pts: pod(1) }, { z: 0.645, pts: pod(0.78) }],
      WHITE, { capStart: true, capEnd: true });
    trim.box(sx * 0.878, 0.962, 0.498, 0.094, 0.072, 0.02, 0, GLASS);
  }

  // --- rear wing -----------------------------------------------------------
  const blade = (yb, yt, k) => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      out.push([Math.cos(a) * 0.62 * k, (yb + yt) / 2 + Math.sin(a) * ((yt - yb) / 2)]);
    }
    return out;
  };
  paint.loft([
    { z: -1.70, pts: blade(1.030, 1.062, 1) },
    { z: -1.86, pts: blade(1.048, 1.086, 1) },
    { z: -2.00, pts: blade(1.064, 1.100, 0.985) },
  ], WHITE, { capStart: true, capEnd: true });
  for (const sx of [-1, 1]) {
    paint.tube([sx * 0.44, beltY(-1.84) - 0.01, -1.84], [sx * 0.44, 1.05, -1.84], 0.028, 6, WHITE, true);
    // end plate
    paint.box(sx * 0.615, 1.01, -1.85, 0.022, 0.12, 0.34, 0, WHITE);
  }
  // engine cover louvres, so the rear deck is not a blank lid
  for (let i = 0; i < 3; i++) {
    const lz = -1.70 - i * 0.10;
    matte.box(0, beltY(lz) - 0.014, lz, 0.60, 0.024, 0.055, 0, [0.10, 0.11, 0.12]);
  }
  // bonnet extractors: the front deck is the largest blank panel on the car
  for (const sx of [-1, 1]) {
    matte.box(sx * 0.30, beltY(1.52) - 0.020, 1.52, 0.24, 0.030, 0.13, 0, [0.08, 0.09, 0.10]);
  }

  return wheels;
}

/**
 * The muscle car, hand built on the same core as the sports car and sharing
 * none of its numbers: long flat bonnet, short deck, a formal notchback roof,
 * quad round lamps sunk in a full-width grille, chrome bumpers at both ends and
 * hips over the rear axle. Slab-sided on purpose -- the tumblehome and the
 * waist are both much flatter here, which is most of what separates 1970 from
 * a modern coupe.
 */
function buildMuscle(spec, paint, trim, matte) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.40, zR = -1.34;

  const halfW = curve([
    [tail, 0.90], [-2.10, 0.97], [zR, 1.00], [-0.55, 0.92], [0.30, 0.92],
    [zF, 0.985], [2.10, 0.94], [nose, 0.86],
  ]);
  const sillY = curve([
    [tail, 0.34], [-2.00, 0.26], [-0.60, 0.24], [0.60, 0.24], [2.00, 0.26], [nose, 0.34],
  ]);
  const beltY = curve([
    [tail, 1.02], [-2.05, 1.06], [zR, 1.08], [-0.60, 1.04], [0.20, 1.02],
    [0.85, 1.02], [1.30, 1.00], [1.90, 0.96], [2.25, 0.94], [nose, 0.92],
  ]);
  const tuckAt = curve([
    [tail, 0.88], [zR, 0.95], [-0.60, 0.88], [0.60, 0.88], [zF, 0.95], [nose, 0.88],
  ]);
  const topAt = curve([
    [tail, 0.90], [-1.90, 0.94], [0.80, 0.94], [1.60, 0.93], [2.20, 0.86], [nose, 0.78],
  ]);
  const { geom, half, endProf } = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR: 0.58, archGap: 0.06, creaseAt: 0.66, tumble: 0.94,
    deckDrop: 0.026, lipOut: 0.05, endRound: 0.14, endMin: 0.90,
  });

  const twF = 0.24, twR = 0.30;
  const wxF = geom(zF).wb - twF / 2 + 0.02;
  const wxR = geom(zR).wb - twR / 2 + 0.02;
  const wheels = [
    [-wxF, wr, zF, wr, twF], [wxF, wr, zF, wr, twF],
    [-wxR, wr, zR, wr, twR], [wxR, wr, zR, wr, twR],
  ];

  // --- notchback greenhouse ------------------------------------------------
  const cowlZ = 0.72, cowlY = 1.035, roofY = spec.roof;
  const scrZ = -0.22, backZ = -1.06, rearZ = -1.62, rearY = 1.055;
  const wScrB = 0.76, wScrT = 0.66, wRoof = 0.68, wRearT = 0.655, wRear = 0.74;
  const wGlassT = 0.652, wGlassB = 0.755;
  const lp = (a, b, t) => a + (b - a) * t;

  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(cowlZ, scrZ, t) + 0.03 * Math.sin(Math.PI * t);
    const cy = lp(cowlY, roofY, t) + 0.012 * Math.sin(Math.PI * t);
    const hwv = lp(wScrB, wScrT, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.028 * u * u, cz - 0.09 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);

  const roofCols = [[-0.98, -0.05], [-1, -0.010], [-0.94, 0], [-0.66, 0.006], [-0.3, 0.010],
    [0, 0.012], [0.3, 0.010], [0.66, 0.006], [0.94, 0], [1, -0.010], [0.98, -0.05]];
  const roofRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const cz = lp(scrZ, backZ, t), cy = roofY + 0.006 * Math.sin(Math.PI * t);
    roofRows.push(roofCols.map(([u, dy]) => [u * wRoof, cy + dy - 0.020 * u * u, cz]));
  }
  paint.patch(roofRows, WHITE, [0, 1, 0]);

  // A notchback's rear screen is steep and short, and the boot lid behind it is
  // flat -- that break is the whole difference from the sports car's fastback.
  const rearRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(backZ, rearZ, t), cy = lp(roofY - 0.006, rearY, t) + 0.014 * Math.sin(Math.PI * t);
    const hwv = lp(wRearT, wRear, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.028 * u * u, cz + 0.04 * u * u]);
    }
    rearRows.push(row);
  }
  trim.patch(rearRows, GLASS, [0, 0.7, -1]);

  const sgFB = [0.60, 1.035], sgFT = [-0.16, 1.360], sgRT = [-1.06, 1.352], sgRB = [-1.34, 1.058];
  for (const sx of [-1, 1]) {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 4; j++) {
        const u = j / 4;
        const bz = lp(sgFB[0], sgRB[0], u), by = lp(sgFB[1], sgRB[1], u);
        const tz = lp(sgFT[0], sgRT[0], u), ty = lp(sgFT[1], sgRT[1], u);
        row.push([sx * lp(wGlassB, wGlassT, t), lp(by, ty, t), lp(bz, tz, t)]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sx, 0, 0]);
    paint.patch(scrRows.map((r, i) => {
      const e = r[r.length - 1], t = i / 3;
      return [[sx * e[0], e[1], e[2]],
        [sx * lp(wGlassB, wGlassT, t), lp(sgFB[1], sgFT[1], t), lp(sgFB[0], sgFT[0], t)]];
    }), WHITE, [sx, 0.4, 0]);
    const sailOuter = [[wGlassT, sgRT[1], sgRT[0]], [0.700, 1.250, -1.20],
      [wGlassB, sgRB[1], sgRB[0]], [0.760, 1.030, rearZ]];
    paint.patch(rearRows.map((r, i) => {
      const e = r[r.length - 1], o = sailOuter[i];
      return [[sx * e[0], e[1], e[2]], [sx * o[0], o[1], o[2]]];
    }), WHITE, [sx, 0.4, 0]);
  }

  // --- front: quad lamps sunk in one full-width grille ----------------------
  const GRILLE = [0, 0.66, 0.60, 0.085], INTAKE = [0, 0.47, 0.46, 0.045];
  const TAILA = [0.40, 0.72, 0.24, 0.075], PIPE = [0.42, 0.60, 0.038, 0.038];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILA, PIPE], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.15, 1,
    { rim: 0.034, rimCol: WHITE });
  // Round sealed-beam units standing in the grille, chrome-ringed. They sit in
  // the recess rather than being holes of their own: a hole inside a hole needs
  // the back panel pierced too, and a lamp on a stalk in a dark pocket already
  // reads as inset from anywhere a player stands.
  for (const sx of [-1, 1]) {
    for (const xc of [0.24, 0.485]) {
      // Chrome barrel down the pocket with the lens across its mouth. Buried at
      // the back of the recess a lens has nothing to catch, and `trim` is
      // metalness 0.88 -- it renders as more pocket.
      trim.tube([sx * xc, GRILLE[1], gp.z + 0.01], [sx * xc, GRILLE[1], nose - 0.03], 0.082, 12, CHROME);
      trim.tube([sx * xc, GRILLE[1], nose - 0.055], [sx * xc, GRILLE[1], nose - 0.028], 0.072, 12, LAMP, true);
    }
    trim.box(sx * 0.62, 0.60, nose - 0.02, 0.10, 0.05, 0.03, 0, AMBER);
  }
  // grille mesh: vertical bars right across the mouth
  for (let i = -5; i <= 5; i++) {
    trim.box(i * 0.105, GRILLE[1] - 0.072, gp.z + 0.012, 0.016, 0.144, 0.02, 0, [0.30, 0.31, 0.33]);
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.11, 1, { rim: 0.026 });
  // Chrome bumper. A muscle car's is a separate bright bar standing off the
  // bodywork, not a colour-keyed moulding.
  trim.box(0, 0.372, nose + 0.012, 1.56, 0.098, 0.13, 0, CHROME);
  trim.box(0, 0.400, nose + 0.05, 0.42, 0.135, 0.02, 0, PLATE);

  // --- rear ----------------------------------------------------------------
  for (const sx of [-1, 1]) {
    const tp = pocket(paint, matte, sx * TAILA[0], TAILA[1], tail, TAILA[2], TAILA[3], 0.07, -1,
      { rim: 0.028 });
    trim.box(sx * TAILA[0], 0.655, tail + 0.022, tp.hw * 1.9, 0.130, 0.026, 0, TAILC);
    // three chrome ribs across each lens, the era's signature
    for (const d of [-0.045, 0, 0.045]) {
      trim.box(sx * TAILA[0] + d, 0.660, tail + 0.008, 0.014, 0.120, 0.02, 0, CHROME);
    }
    hole(trim, matte, sx * PIPE[0], PIPE[1], tail, 0.052, 0.12, -1);
  }
  trim.box(0, 0.372, tail - 0.012, 1.56, 0.098, 0.13, 0, CHROME);
  trim.box(0, 0.560, tail - 0.028, 0.42, 0.135, 0.02, 0, PLATE);
  // ducktail lip along the trailing edge of the boot lid
  paint.box(0, beltY(-2.28) - 0.01, -2.30, geom(-2.30).tw * 1.9, 0.055, 0.20, 0, WHITE);

  // --- bonnet scoop, flanks, trim ------------------------------------------
  const scoopY = beltY(1.62) - 0.02;
  paint.box(0, scoopY, 1.62, 0.66, 0.105, 0.78, 0, WHITE);
  pocket(paint, matte, 0, scoopY + 0.055, 2.02, 0.26, 0.035, 0.10, 1, { rim: 0.02 });
  for (const sx of [-1, 1]) {
    trim.box(sx * (geom(0).wb + 0.01), 0.255, 0, 0.03, 0.05, 2.10, 0, CHROME);  // rocker trim
    for (const zc of [0.55, -0.72]) {
      const rows = [-0.009, 0.009].map((dz) =>
        half(zc + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, zc + dz]));
      matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    }
    const hg = geom(-0.12);
    trim.tube([sx * hg.w * 0.985, hg.yc + 0.08, -0.22], [sx * hg.w * 0.985, hg.yc + 0.08, -0.02],
      0.017, 6, CHROME, true);
    // chrome bullet mirror on a short stalk
    trim.tube([sx * 0.760, 1.030, 0.50], [sx * 0.860, 1.070, 0.46], 0.018, 6, CHROME, true);
    trim.tube([sx * 0.860, 1.070, 0.52], [sx * 0.878, 1.074, 0.40], 0.052, 8, CHROME, true);
    trim.box(sx * 0.868, 1.032, 0.398, 0.086, 0.078, 0.02, 0, GLASS);
    // side gill behind the front arch
    for (let i = 0; i < 3; i++) {
      matte.box(sx * (geom(0.72).w + 0.004), geom(0.72).yc - 0.10 + i * 0.05, 0.72,
        0.012, 0.032, 0.24, 0, [0.10, 0.11, 0.12]);
    }
  }

  return wheels;
}

/**
 * The full-size American sedan -- the commonest car on these streets, so the
 * one that matters most. Long bonnet, long boot, a formal notchback greenhouse
 * on a thick C-pillar, a wide horizontal-bar grille and a tail lamp panel that
 * runs the whole width.
 *
 * Against the muscle car, which is the nearest thing to it in the fleet: the
 * cabin is a metre longer and sits further back (four doors, not two), the roof
 * is level rather than domed, and the flanks carry almost no flare. A full-size
 * sedan reads big precisely because nothing on it is dramatic, so the shape has
 * to be carried by proportion -- overhangs, the length of the roof and the
 * height of the beltline -- rather than by features.
 */
function buildSedan(spec, paint, trim, matte) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.52, zR = -1.46;                 // 2.98 m wheelbase

  // Nearly full width down the whole flank: a sedan's arches are wheel openings
  // in a flat side, not flares standing out of a waisted one.
  const halfW = curve([
    [tail, 0.86], [-2.20, 0.95], [zR, 1.00], [-0.60, 0.955], [0.60, 0.955],
    [zF, 1.00], [2.20, 0.95], [nose, 0.90],
  ]);
  const sillY = curve([
    [tail, 0.36], [-2.05, 0.30], [-0.60, 0.28], [0.60, 0.28], [2.05, 0.30], [nose, 0.36],
  ]);
  // A high, level beltline. The bonnet falls only 11 cm over 1.6 m, which is
  // what makes it read as long rather than as a wedge.
  const beltY = curve([
    [tail, 1.00], [-2.15, 1.05], [zR, 1.07], [-0.60, 1.06], [0.30, 1.055],
    [0.85, 1.045], [1.50, 1.01], [2.10, 0.98], [nose, 0.95],
  ]);
  const tuckAt = curve([
    [tail, 0.90], [zR, 0.95], [-0.60, 0.90], [0.60, 0.90], [zF, 0.95], [nose, 0.90],
  ]);
  const topAt = curve([
    [tail, 0.86], [-2.10, 0.92], [-1.10, 0.95], [1.10, 0.95], [1.90, 0.92],
    [2.25, 0.86], [nose, 0.76],
  ]);
  const { geom, half, endProf } = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR: 0.56, archGap: 0.05, creaseAt: 0.62, tumble: 0.93,
    deckDrop: 0.028, lipOut: 0.034, endRound: 0.16, endMin: 0.92,
  });

  // Square tyres front and rear -- a family sedan is not staggered.
  const tw = 0.235;
  const wx = geom(zF).wb - tw / 2 + 0.02;
  const wxR = geom(zR).wb - tw / 2 + 0.02;
  const wheels = [
    [-wx, wr, zF, wr, tw], [wx, wr, zF, wr, tw],
    [-wxR, wr, zR, wr, tw], [wxR, wr, zR, wr, tw],
  ];

  // --- formal four-door greenhouse -----------------------------------------
  const cowlZ = 0.80, cowlY = 1.045, roofY = spec.roof;
  const scrZ = 0.14, backZ = -1.24, rearZ = -1.80, rearY = 1.058;
  const wScrB = 0.80, wScrT = 0.70, wRoof = 0.715, wRearT = 0.695, wRear = 0.78;
  const wGlassT = 0.688, wGlassB = 0.790;
  const lp = (a, b, t) => a + (b - a) * t;

  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(cowlZ, scrZ, t) + 0.026 * Math.sin(Math.PI * t);
    const cy = lp(cowlY, roofY, t) + 0.010 * Math.sin(Math.PI * t);
    const hwv = lp(wScrB, wScrT, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.024 * u * u, cz - 0.085 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);

  // Level roof, 1.38 m of it. The crown is deliberately half what the coupes
  // carry -- a formal saloon roof is close to flat and the shallow camber is
  // the difference between "big car" and "bubble".
  const roofCols = [[-0.98, -0.048], [-1, -0.010], [-0.94, 0], [-0.66, 0.005], [-0.3, 0.008],
    [0, 0.010], [0.3, 0.008], [0.66, 0.005], [0.94, 0], [1, -0.010], [0.98, -0.048]];
  const roofRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const cz = lp(scrZ, backZ, t), cy = roofY + 0.005 * Math.sin(Math.PI * t);
    roofRows.push(roofCols.map(([u, dy]) => [u * wRoof, cy + dy - 0.016 * u * u, cz]));
  }
  paint.patch(roofRows, WHITE, [0, 1, 0]);

  const rearRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(backZ, rearZ, t), cy = lp(roofY - 0.006, rearY, t) + 0.012 * Math.sin(Math.PI * t);
    const hwv = lp(wRearT, wRear, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.024 * u * u, cz + 0.035 * u * u]);
    }
    rearRows.push(row);
  }
  trim.patch(rearRows, GLASS, [0, 0.7, -1]);

  const sgFB = [0.72, 1.055], sgFT = [0.16, 1.470], sgRT = [-1.24, 1.464], sgRB = [-1.44, 1.080];
  const sailOuter = [[wGlassT, 1.464, backZ], [0.745, 1.335, -1.4267],
    [0.788, 1.190, -1.6133], [0.800, 1.058, rearZ]];
  for (const sx of [-1, 1]) {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 6; j++) {
        const u = j / 6;
        const bz = lp(sgFB[0], sgRB[0], u), by = lp(sgFB[1], sgRB[1], u);
        const tz = lp(sgFT[0], sgRT[0], u), ty = lp(sgFT[1], sgRT[1], u);
        row.push([sx * lp(wGlassB, wGlassT, t), lp(by, ty, t), lp(bz, tz, t)]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sx, 0, 0]);
    // B-pillar, blacked out and laid ON the glass rather than splitting it into
    // two panels. A real sedan's centre pillar is a black-taped strip between
    // two windows and reads the same way at any distance a player sees it from.
    const bz0 = lp(sgFB[0], sgRB[0], 0.42), bz1 = lp(sgFT[0], sgRT[0], 0.42);
    matte.patch([
      [[sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 + 0.045], [sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 - 0.045]],
      [[sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 + 0.045], [sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 - 0.045]],
    ], [0.09, 0.10, 0.11], [sx, 0, 0]);
    // A-pillar, off the windscreen's own edge points so it is flush with it.
    paint.patch(scrRows.map((r, i) => {
      const e = r[r.length - 1], t = i / 3;
      return [[sx * e[0], e[1], e[2]],
        [sx * lp(wGlassB, wGlassT, t), lp(sgFB[1], sgFT[1], t), lp(sgFB[0], sgFT[0], t)]];
    }), WHITE, [sx, 0.4, 0]);
    // Thick formal C-pillar: the sail runs from the rear screen's own edge out
    // to the quarter and down onto the boot shoulder.
    paint.patch(rearRows.map((r, i) => {
      const e = r[r.length - 1], o = sailOuter[i];
      return [[sx * e[0], e[1], e[2]], [sx * o[0], o[1], o[2]]];
    }), WHITE, [sx, 0.4, 0]);
    // Bright window surround along the beltline, which is most of what says
    // "American full-size" about a greenhouse.
    trim.tube([sx * (wGlassB + 0.004), sgFB[1] - 0.012, sgFB[0]],
      [sx * (wGlassB + 0.004), sgRB[1] - 0.012, sgRB[0]], 0.014, 6, CHROME, true);
  }

  // --- front fascia: wide horizontal-bar grille ----------------------------
  const GRILLE = [0, 0.805, 0.390, 0.098], LAMP_A = [0.575, 0.812, 0.130, 0.062];
  const INTAKE = [0, 0.520, 0.520, 0.058];
  const TAILBAR = [0, 0.800, 0.620, 0.085], PLATEREC = [0, 0.560, 0.230, 0.075];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILBAR, PLATEREC], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.13, 1,
    { rim: 0.030, rimCol: CHROME });
  // Four chrome blades across the mouth, standing in the recess. Horizontal
  // bars are the American grille; vertical slats read European.
  for (let i = 0; i < 4; i++) {
    trim.box(0, 0.726 + i * 0.052, gp.z + 0.02, gp.hw * 1.94, 0.022, 0.045, 0, CHROME);
  }
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.10, 1,
      { rim: 0.022, rimCol: CHROME });
    trim.box(sx * LAMP_A[0], 0.818, nose - 0.030, hp.hw * 1.9, 0.068, 0.024, 0, LAMP);
    trim.box(sx * LAMP_A[0], 0.764, hp.z + 0.045, hp.hw * 1.9, 0.022, 0.024, 0, AMBER);
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.11, 1,
    { rim: 0.024, rimCol: PLASTIC });
  // Body-coloured bumper with a bright insert under the grille, and a valance
  // low enough that the nose does not end in a shelf.
  trim.box(0, 0.610, nose - 0.005, 1.42, 0.026, 0.05, 0, CHROME);
  matte.box(0, 0.392, nose - 0.10, 1.54, 0.040, 0.24, 0, PLASTIC);
  trim.box(0, 0.430, nose - 0.028, 0.42, 0.135, 0.02, 0, PLATE);

  // --- rear: one lamp panel across the full width --------------------------
  const tp = pocket(paint, matte, TAILBAR[0], TAILBAR[1], tail, TAILBAR[2], TAILBAR[3], 0.075, -1,
    { rim: 0.028, rimCol: CHROME });
  for (const sx of [-1, 1]) {
    trim.box(sx * 0.365, 0.760, tail + 0.020, 0.46, 0.130, 0.026, 0, TAILC);
    trim.box(sx * 0.575, 0.760, tail + 0.020, 0.11, 0.130, 0.026, 0, AMBER);
    trim.box(sx * 0.155, 0.775, tail + 0.020, 0.11, 0.075, 0.026, 0, WHITE);   // reversing lamp
    hole(trim, matte, sx * 0.470, 0.395, tail + 0.02, 0.048, 0.11, -1);
  }
  // Bright bar down the middle of the panel, tying the two lamps together.
  trim.box(0, 0.760, tail + 0.026, tp.hw * 0.62, 0.048, 0.03, 0, CHROME);
  pocket(paint, matte, PLATEREC[0], PLATEREC[1], tail, PLATEREC[2], PLATEREC[3], 0.05, -1,
    { rim: 0.024, rimCol: CHROME });
  trim.box(0, 0.500, tail - 0.030, 0.42, 0.135, 0.02, 0, PLATE);
  matte.box(0, 0.392, tail + 0.10, 1.54, 0.040, 0.24, 0, PLASTIC);
  // Boot shut line across the deck, so the lid is a lid.
  matte.box(0, beltY(-1.86) + 0.002, -1.86, geom(-1.86).tw * 1.86, 0.008, 0.014, 0, [0.15, 0.16, 0.17]);

  // --- flanks ---------------------------------------------------------------
  for (const sx of [-1, 1]) {
    // Four shut lines, because there are four doors, and their spacing is what
    // a player counts without knowing they are counting.
    for (const zc of [1.02, 0.06, -0.98]) {
      const rows = [-0.008, 0.008].map((dz) =>
        half(zc + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, zc + dz]));
      matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    }
    trim.box(sx * (geom(0).wb + 0.008), 0.318, 0.06, 0.026, 0.05, 2.60, 0, CHROME);  // rocker moulding
    for (const zc of [0.56, -0.50]) {
      const hg = geom(zc);
      trim.tube([sx * hg.w * 0.99, hg.yc + 0.115, zc - 0.09], [sx * hg.w * 0.99, hg.yc + 0.115, zc + 0.09],
        0.016, 6, CHROME, true);
    }
    // Mirror on a short body-colour stalk. The stalk STARTS inside the shoulder
    // at the A-pillar's own base (`sgFB`), not out over the bonnet -- placed by
    // eye it ends up a red brick hanging in the air beside the wing, which is
    // exactly what the first pass rendered.
    paint.tube([sx * 0.790, 1.062, sgFB[0] - 0.02], [sx * 0.900, 1.088, sgFB[0] - 0.06], 0.020, 6, WHITE, true);
    paint.box(sx * 0.940, 1.048, sgFB[0] - 0.10, 0.105, 0.090, 0.055, 0, WHITE);
    trim.box(sx * 0.940, 1.055, sgFB[0] - 0.128, 0.090, 0.070, 0.02, 0, GLASS);
  }
  // Roof aerial: a shark fin, which every American sedan built this century has.
  paint.patch([
    [[0, roofY - 0.002, -1.10], [0, roofY - 0.002, -1.30]],
    [[0.028, roofY + 0.030, -1.16], [0.028, roofY + 0.030, -1.29]],
    [[0, roofY + 0.062, -1.24], [0, roofY + 0.062, -1.29]],
  ], [0.10, 0.11, 0.12], [1, 0.4, 0]);
  paint.patch([
    [[0, roofY - 0.002, -1.10], [0, roofY - 0.002, -1.30]],
    [[-0.028, roofY + 0.030, -1.16], [-0.028, roofY + 0.030, -1.29]],
    [[0, roofY + 0.062, -1.24], [0, roofY + 0.062, -1.29]],
  ], [0.10, 0.11, 0.12], [-1, 0.4, 0]);

  return wheels;
}

/**
 * The mid-size American crossover: tall two-box, upright nose, a big grille, a
 * long roof on rails, a thick D-pillar and a tailgate with a spoiler over the
 * screen. It rides 16 cm higher than the sedan and the arches are SQUARED
 * (`archPow` above 2) and clad in black plastic, which together are most of
 * what a crossover is at a glance -- the rest of the fleet has semicircular
 * openings in painted metal.
 *
 * The cladding is why `bodyCore` takes `lipInto`: the arch lip is built from
 * the body's own sill points, so the only thing that should change for a clad
 * arch is which builder it lands in. Drawing a second black lip over a painted
 * one would z-fight along its whole length.
 */
function buildSuv(spec, paint, trim, matte) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.46, zR = -1.42;                 // 2.88 m wheelbase, short overhangs

  // Nearly constant width: a crossover's flanks are slabs and its arches are
  // squared cutouts in them, not flares.
  const halfW = curve([
    [tail, 0.90], [-2.10, 0.96], [zR, 1.00], [-0.60, 0.97], [0.60, 0.97],
    [zF, 1.00], [2.10, 0.96], [nose, 0.90],
  ]);
  const sillY = curve([
    [tail, 0.50], [-2.00, 0.46], [-0.60, 0.44], [0.60, 0.44], [2.00, 0.46], [nose, 0.52],
  ]);
  // The bonnet falls 10 cm in total. An upright nose is the point: a crossover
  // that noses down turns into a tall hatchback.
  const beltY = curve([
    [tail, 1.30], [-2.10, 1.32], [zR, 1.33], [-0.60, 1.32], [0.40, 1.31],
    [1.00, 1.30], [1.60, 1.28], [2.10, 1.24], [nose, 1.20],
  ]);
  const tuckAt = curve([
    [tail, 0.94], [zR, 0.97], [-0.60, 0.93], [0.60, 0.93], [zF, 0.97], [nose, 0.94],
  ]);
  const topAt = curve([
    [tail, 0.92], [-2.10, 0.96], [-1.20, 0.97], [1.20, 0.97], [1.90, 0.95],
    [2.25, 0.90], [nose, 0.82],
  ]);
  const { geom, half, endProf } = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR: 0.62, archGap: 0.07, archPow: 3.0, creaseAt: 0.50, tumble: 0.96,
    deckDrop: 0.030, lipOut: 0.052, endRound: 0.14, endMin: 0.94,
    lipInto: matte, lipCol: PLASTIC,
  });

  const tw = 0.265;
  const wx = geom(zF).wb - tw / 2 + 0.02;
  const wxR = geom(zR).wb - tw / 2 + 0.02;
  const wheels = [
    [-wx, wr, zF, wr, tw], [wx, wr, zF, wr, tw],
    [-wxR, wr, zR, wr, tw], [wxR, wr, zR, wr, tw],
  ];

  // --- tall two-box greenhouse ---------------------------------------------
  const cowlZ = 0.86, cowlY = 1.305, roofY = spec.roof;
  const scrZ = 0.10, backZ = -1.96, rearZ = -2.34, rearY = 1.325;
  const wScrB = 0.84, wScrT = 0.76, wRoof = 0.780, wRearT = 0.755, wRear = 0.800;
  const wGlassT = 0.752, wGlassB = 0.845;
  const lp = (a, b, t) => a + (b - a) * t;

  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(cowlZ, scrZ, t) + 0.030 * Math.sin(Math.PI * t);
    const cy = lp(cowlY, roofY, t) + 0.014 * Math.sin(Math.PI * t);
    const hwv = lp(wScrB, wScrT, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.026 * u * u, cz - 0.095 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);

  const roofCols = [[-0.98, -0.050], [-1, -0.012], [-0.94, 0], [-0.66, 0.006], [-0.3, 0.010],
    [0, 0.012], [0.3, 0.010], [0.66, 0.006], [0.94, 0], [1, -0.012], [0.98, -0.050]];
  const roofRows = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const cz = lp(scrZ, backZ, t), cy = roofY + 0.010 * Math.sin(Math.PI * t);
    roofRows.push(roofCols.map(([u, dy]) => [u * wRoof, cy + dy - 0.020 * u * u, cz]));
  }
  paint.patch(roofRows, WHITE, [0, 1, 0]);

  // The tailgate glass is 35 degrees off vertical -- steep, because the load
  // space behind the D-pillar has to be square. A raked one is an estate.
  const rearRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(backZ, rearZ, t), cy = lp(roofY - 0.010, rearY, t) + 0.010 * Math.sin(Math.PI * t);
    const hwv = lp(wRearT, wRear, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.022 * u * u, cz + 0.030 * u * u]);
    }
    rearRows.push(row);
  }
  trim.patch(rearRows, GLASS, [0, 0.5, -1]);

  const sgFB = [0.78, 1.315], sgFT = [0.14, 1.848], sgRT = [-1.50, 1.842], sgRB = [-1.62, 1.322];
  // The D-pillar is the whole panel between the side glass and the rear screen,
  // and it is 30-50 cm of painted metal -- the widest pillar on any vehicle
  // here, and the reason an SUV's rear quarter reads solid.
  //
  // Its first row has to be the side glass's OWN rear-top corner. Started at
  // the roof's trailing edge instead, the panel begins 24 cm behind where the
  // glass ends and the quarter has a hole in it half a metre tall -- which is
  // what the first pass looked straight through.
  const sailOuter = [[wGlassT, sgRT[1], sgRT[0]], [0.805, 1.640, -1.555],
    [wGlassB, sgRB[1], sgRB[0]], [0.870, 1.302, -2.10]];
  for (const sx of [-1, 1]) {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 6; j++) {
        const u = j / 6;
        const bz = lp(sgFB[0], sgRB[0], u), by = lp(sgFB[1], sgRB[1], u);
        const tz = lp(sgFT[0], sgRT[0], u), ty = lp(sgFT[1], sgRT[1], u);
        row.push([sx * lp(wGlassB, wGlassT, t), lp(by, ty, t), lp(bz, tz, t)]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sx, 0, 0]);
    for (const u of [0.40, 0.74]) {           // B-pillar and the quarter-light divider
      const bz0 = lp(sgFB[0], sgRB[0], u), bz1 = lp(sgFT[0], sgRT[0], u);
      matte.patch([
        [[sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 + 0.042], [sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 - 0.042]],
        [[sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 + 0.042], [sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 - 0.042]],
      ], [0.09, 0.10, 0.11], [sx, 0, 0]);
    }
    paint.patch(scrRows.map((r, i) => {
      const e = r[r.length - 1], t = i / 3;
      return [[sx * e[0], e[1], e[2]],
        [sx * lp(wGlassB, wGlassT, t), lp(sgFB[1], sgFT[1], t), lp(sgFB[0], sgFT[0], t)]];
    }), WHITE, [sx, 0.4, 0]);
    paint.patch(rearRows.map((r, i) => {
      const e = r[r.length - 1], o = sailOuter[i];
      return [[sx * e[0], e[1], e[2]], [sx * o[0], o[1], o[2]]];
    }), WHITE, [sx, 0.4, 0]);
    // Roof rail on two feet, standing just clear of the roof so daylight shows
    // under it. A rail flush to the panel is a painted stripe; one held 4 cm up
    // reads as bolted onto nothing.
    matte.box(sx * 0.615, roofY + 0.020, -0.90, 0.052, 0.044, 2.00, 0, [0.15, 0.16, 0.17]);
    for (const rz of [0.02, -1.82]) {
      matte.box(sx * 0.615, roofY - 0.020, rz, 0.046, 0.044, 0.11, 0, [0.15, 0.16, 0.17]);
    }
  }

  // Tailgate spoiler: it overhangs the roof's trailing edge, so it starts ON
  // the roof and cantilevers back. Centred behind the roof it hangs in the air
  // above the screen with a hand's width of daylight under it.
  paint.box(0, roofY - 0.056, backZ + 0.10, wRoof * 1.90, 0.058, 0.42, 0, WHITE);
  for (const sx of [-1, 1]) paint.box(sx * 0.735, roofY - 0.096, backZ + 0.06, 0.05, 0.10, 0.30, 0, WHITE);
  trim.box(0, roofY - 0.070, backZ - 0.06, 0.22, 0.05, 0.05, 0, [0.05, 0.05, 0.06]);  // high stop lamp

  // --- front: a big upright grille -----------------------------------------
  const GRILLE = [0, 1.010, 0.480, 0.130], LAMP_A = [0.640, 1.020, 0.135, 0.072];
  const INTAKE = [0, 0.740, 0.520, 0.075];
  const TAILA = [0.630, 1.055, 0.115, 0.150], TPLATE = [0, 0.770, 0.235, 0.075];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILA, TPLATE], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.15, 1,
    { rim: 0.036, rimCol: CHROME });
  for (let i = 0; i < 4; i++) {
    trim.box(0, 0.912 + i * 0.066, gp.z + 0.02, gp.hw * 1.94, 0.030, 0.05, 0, [0.20, 0.21, 0.23]);
  }
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.11, 1,
      { rim: 0.026, rimCol: PLASTIC });
    trim.box(sx * LAMP_A[0], 1.038, nose - 0.034, hp.hw * 1.9, 0.078, 0.024, 0, LAMP);
    trim.box(sx * LAMP_A[0], 0.972, hp.z + 0.05, hp.hw * 1.9, 0.024, 0.024, 0, AMBER);
    // Fog lamp in the lower cladding.
    hole(trim, matte, sx * 0.560, 0.660, nose - 0.03, 0.048, 0.07, 1, { rimCol: PLASTIC });
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.12, 1,
    { rim: 0.028, rimCol: PLASTIC });
  // Bumper cladding and a brushed skid plate, which is the crossover's one
  // gesture at the off-roader it is styled after.
  matte.box(0, 0.560, nose - 0.11, 1.62, 0.075, 0.26, 0, PLASTIC);
  trim.box(0, 0.508, nose - 0.16, 0.98, 0.030, 0.26, 0, [0.55, 0.57, 0.60]);
  trim.box(0, 0.610, nose - 0.030, 0.42, 0.135, 0.02, 0, PLATE);

  // --- rear: tall lamps up the corners of the tailgate ----------------------
  for (const sx of [-1, 1]) {
    const tp = pocket(paint, matte, sx * TAILA[0], TAILA[1], tail, TAILA[2], TAILA[3], 0.07, -1,
      { rim: 0.026, rimCol: PLASTIC });
    trim.box(sx * TAILA[0], 0.930, tail + 0.020, tp.hw * 1.9, 0.220, 0.026, 0, TAILC);
    trim.box(sx * TAILA[0], 1.168, tail + 0.020, tp.hw * 1.9, 0.048, 0.026, 0, AMBER);
  }
  pocket(paint, matte, TPLATE[0], TPLATE[1], tail, TPLATE[2], TPLATE[3], 0.05, -1,
    { rim: 0.024, rimCol: PLASTIC });
  trim.box(0, 0.710, tail - 0.030, 0.42, 0.135, 0.02, 0, PLATE);
  matte.box(0, 0.560, tail + 0.11, 1.62, 0.075, 0.26, 0, PLASTIC);
  trim.box(0, 0.508, tail + 0.16, 0.98, 0.030, 0.26, 0, [0.55, 0.57, 0.60]);
  for (const sx of [-1, 1]) hole(trim, matte, sx * 0.420, 0.470, tail + 0.06, 0.045, 0.10, -1);

  // --- flanks: cladding all the way round ----------------------------------
  for (const sx of [-1, 1]) {
    for (const zc of [0.88, -0.14, -1.10]) {
      const rows = [-0.008, 0.008].map((dz) =>
        half(zc + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, zc + dz]));
      matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    }
    // Rocker cladding between the two arches, deep enough to tie them together
    // into one black band round the bottom of the car.
    matte.box(sx * (geom(0).wb + 0.005), 0.470, 0.02, 0.055, 0.135, 2.10, 0, PLASTIC);
    matte.box(sx * (geom(0).w + 0.004), 0.860, 0.02, 0.016, 0.075, 2.30, 0, [0.14, 0.15, 0.16]);
    for (const zc of [0.62, -0.52]) {
      const hg = geom(zc);
      trim.tube([sx * hg.w * 0.99, hg.yc + 0.290, zc - 0.09], [sx * hg.w * 0.99, hg.yc + 0.290, zc + 0.09],
        0.017, 6, CHROME, true);
    }
    // Mirror hung off the A-pillar's base, not out over the wing -- see the
    // sedan's for what placing it by eye produces.
    paint.tube([sx * 0.830, 1.318, sgFB[0] - 0.03], [sx * 0.955, 1.348, sgFB[0] - 0.08], 0.022, 6, WHITE, true);
    paint.box(sx * 1.000, 1.300, sgFB[0] - 0.13, 0.115, 0.100, 0.060, 0, WHITE);
    trim.box(sx * 1.000, 1.308, sgFB[0] - 0.161, 0.098, 0.078, 0.02, 0, GLASS);
  }

  return wheels;
}

/**
 * The full-size American pickup, and the one vehicle here that is genuinely a
 * different ARCHITECTURE rather than a different set of curves: a cab and a bed
 * with a gap between them, not one body.
 *
 * The lofted shell covers sill to beltline over the whole length -- front
 * fenders, cab sides and bed sides are one surface on a real truck too, and
 * building it as one is what keeps the arches and the flares registered. What
 * stands ABOVE the beltline is built separately and is where the two-box reads:
 * a crew cab from z 1.30 to -0.86, an open slot, then bed walls from -1.00 back
 * to a hinged tailgate. Everything in that slot is deliberately dark, because
 * what a player sees between a cab and a bed is shadow.
 */
function buildPickup(spec, paint, trim, matte) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.86, zR = -1.82;                 // 3.68 m wheelbase

  const halfW = curve([
    [tail, 0.98], [-2.55, 1.00], [zR, 1.00], [-1.05, 0.965], [1.05, 0.965],
    [zF, 1.00], [2.45, 0.97], [nose, 0.92],
  ]);
  const sillY = curve([
    [tail, 0.52], [-2.40, 0.48], [-0.60, 0.46], [0.60, 0.46], [2.40, 0.48], [nose, 0.54],
  ]);
  // Flat to within 8 cm end to end. A truck's beltline is a straight line and
  // any dip in it turns the bonnet into a car's.
  const beltY = curve([
    [tail, 1.26], [-2.30, 1.26], [-1.00, 1.26], [1.00, 1.26], [1.60, 1.25],
    [2.30, 1.22], [nose, 1.18],
  ]);
  const tuckAt = curve([
    [tail, 0.97], [zR, 0.99], [-0.60, 0.95], [0.60, 0.95], [zF, 0.99], [nose, 0.97],
  ]);
  const topAt = curve([
    [tail, 0.98], [-2.40, 0.99], [1.40, 0.99], [2.10, 0.97], [2.55, 0.94], [nose, 0.88],
  ]);
  const { geom, half, endProf } = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR: 0.68, archGap: 0.09, archPow: 2.6, creaseAt: 0.42, tumble: 0.985,
    deckDrop: 0.022, lipOut: 0.082, endRound: 0.12, endMin: 0.94,
  });

  const tw = 0.30;
  const wx = geom(zF).wb - tw / 2 + 0.02;
  const wxR = geom(zR).wb - tw / 2 + 0.02;
  const wheels = [
    [-wx, wr, zF, wr, tw], [wx, wr, zF, wr, tw],
    [-wxR, wr, zR, wr, tw], [wxR, wr, zR, wr, tw],
  ];

  // --- crew cab -------------------------------------------------------------
  const cowlZ = 1.30, cowlY = 1.258, roofY = spec.roof;
  const scrZ = 0.68, backZ = -0.62, rearZ = -0.86, rearY = 1.40;
  const wScrB = 0.86, wScrT = 0.800, wRoof = 0.820, wRearT = 0.800, wRear = 0.840;
  const wGlassT = 0.790, wGlassB = 0.870;
  const lp = (a, b, t) => a + (b - a) * t;

  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(cowlZ, scrZ, t) + 0.024 * Math.sin(Math.PI * t);
    const cy = lp(cowlY, roofY, t) + 0.012 * Math.sin(Math.PI * t);
    const hwv = lp(wScrB, wScrT, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.022 * u * u, cz - 0.075 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);

  const roofCols = [[-0.98, -0.046], [-1, -0.010], [-0.94, 0], [-0.66, 0.005], [-0.3, 0.008],
    [0, 0.010], [0.3, 0.008], [0.66, 0.005], [0.94, 0], [1, -0.010], [0.98, -0.046]];
  const roofRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const cz = lp(scrZ, backZ, t), cy = roofY + 0.006 * Math.sin(Math.PI * t);
    roofRows.push(roofCols.map(([u, dy]) => [u * wRoof, cy + dy - 0.016 * u * u, cz]));
  }
  paint.patch(roofRows, WHITE, [0, 1, 0]);

  // Rear cab window: near vertical, and short. Everything behind it is bed.
  const rearRows = [];
  for (let i = 0; i <= 2; i++) {
    const t = i / 2, row = [];
    const cz = lp(backZ, rearZ, t), cy = lp(roofY - 0.008, rearY, t);
    const hwv = lp(wRearT, wRear, t);
    for (let j = 0; j <= 6; j++) {
      const u = -1 + (2 * j) / 6;
      row.push([u * hwv, cy - 0.018 * u * u, cz + 0.020 * u * u]);
    }
    rearRows.push(row);
  }
  trim.patch(rearRows, GLASS, [0, 0.5, -1]);
  // The painted panel under it, down to the beltline -- a truck's back-of-cab.
  paint.patch([
    rearRows[rearRows.length - 1].map(([x, y, z]) => [x, y, z]),
    rearRows[rearRows.length - 1].map(([x, , z]) => [x * 1.03, beltY(rearZ) - 0.005, z - 0.03]),
  ], WHITE, [0, 0.3, -1]);

  const sgFB = [1.24, 1.278], sgFT = [0.74, 1.944], sgRT = [-0.58, 1.938], sgRB = [-0.78, 1.282];
  const sailOuter = [[wGlassT, 1.938, backZ], [0.815, 1.660, -0.74], [0.830, 1.300, rearZ]];
  for (const sx of [-1, 1]) {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 6; j++) {
        const u = j / 6;
        const bz = lp(sgFB[0], sgRB[0], u), by = lp(sgFB[1], sgRB[1], u);
        const tz = lp(sgFT[0], sgRT[0], u), ty = lp(sgFT[1], sgRT[1], u);
        row.push([sx * lp(wGlassB, wGlassT, t), lp(by, ty, t), lp(bz, tz, t)]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sx, 0, 0]);
    const bz0 = lp(sgFB[0], sgRB[0], 0.46), bz1 = lp(sgFT[0], sgRT[0], 0.46);
    matte.patch([
      [[sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 + 0.045], [sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 - 0.045]],
      [[sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 + 0.045], [sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 - 0.045]],
    ], [0.09, 0.10, 0.11], [sx, 0, 0]);
    paint.patch(scrRows.map((r, i) => {
      const e = r[r.length - 1], t = i / 3;
      return [[sx * e[0], e[1], e[2]],
        [sx * lp(wGlassB, wGlassT, t), lp(sgFB[1], sgFT[1], t), lp(sgFB[0], sgFT[0], t)]];
    }), WHITE, [sx, 0.4, 0]);
    paint.patch(rearRows.map((r, i) => {
      const e = r[r.length - 1], o = sailOuter[i];
      return [[sx * e[0], e[1], e[2]], [sx * o[0], o[1], o[2]]];
    }), WHITE, [sx, 0.4, 0]);
  }

  // --- the bed --------------------------------------------------------------
  // Walls stand 34 cm above the beltline, which puts the rail just under the
  // cab's shoulder. Taller and the truck loses its two-box step; shorter and it
  // is a car with a hole in the back.
  const bedF = -1.00, bedR = tail - 0.02, railH = 0.34;
  const bedY = beltY(-2.0) - 0.005;
  const bedMid = (bedF + bedR) / 2, bedLen = bedF - bedR;
  const wallX = geom(-2.0).tw;
  for (const sx of [-1, 1]) {
    paint.box(sx * wallX, bedY, bedMid, 0.070, railH, bedLen, 0, WHITE);
    // Dark inner skin, set in behind the rail so the bed is a container rather
    // than a painted trough. Everything a player sees down in there is shadow.
    matte.box(sx * (wallX - 0.070), bedY, bedMid, 0.030, railH - 0.035, bedLen - 0.04, 0, CAVITY);
  }
  paint.box(0, bedY, bedF - 0.035, wallX * 2 + 0.07, railH, 0.070, 0, WHITE);   // bulkhead
  matte.box(0, bedY, bedF - 0.075, wallX * 2 - 0.14, railH - 0.035, 0.030, 0, CAVITY);
  matte.box(0, bedY - 0.06, bedMid, wallX * 2 - 0.14, 0.060, bedLen - 0.10, 0, [0.16, 0.17, 0.18]);
  // Corrugations in the floor -- a flat black rectangle down there reads as a
  // hole rather than as a load bed.
  for (let i = -3; i <= 3; i++) {
    matte.box(i * 0.22, bedY - 0.004, bedMid, 0.055, 0.012, bedLen - 0.14, 0, [0.20, 0.21, 0.22]);
  }
  // Tailgate: its own panel with a shut gap either side and a chrome handle.
  paint.box(0, bedY - 0.02, bedR + 0.055, wallX * 2 - 0.16, railH + 0.02, 0.075, 0, WHITE);
  matte.box(0, bedY + railH - 0.014, bedR + 0.055, wallX * 2 - 0.16, 0.020, 0.085, 0, PLASTIC);
  trim.box(0, bedY + railH - 0.110, bedR + 0.020, 0.30, 0.055, 0.030, 0, CHROME);
  // The slot between cab and bed. Painted bodywork carrying straight through
  // here is what would make the whole thing read as one body again.
  matte.box(0, beltY(bedF) - 0.075, bedF + 0.075, wallX * 1.96, 0.070, 0.16, 0, CAVITY);

  // --- front: rectangular grille with a chrome bar across it ---------------
  const GRILLE = [0, 0.985, 0.545, 0.140], LAMP_A = [0.710, 0.995, 0.140, 0.090];
  const INTAKE = [0, 0.700, 0.480, 0.065];
  const TAILA = [0.800, 1.020, 0.125, 0.160], TPLATE = [0, 0.745, 0.235, 0.075];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILA, TPLATE], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.16, 1,
    { rim: 0.042, rimCol: CHROME });
  // One heavy chrome bar across the middle with a black honeycomb above and
  // below it. That bar is the single most recognisable thing on a full-size
  // American truck's face.
  trim.box(0, GRILLE[1] - 0.028, gp.z + 0.075, gp.hw * 1.96, 0.056, 0.09, 0, CHROME);
  for (const dy of [-0.098, 0.086]) {
    for (let i = -6; i <= 6; i++) {
      trim.box(i * 0.082, GRILLE[1] + dy, gp.z + 0.02, 0.022, 0.058, 0.04, 0, [0.16, 0.17, 0.19]);
    }
  }
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.11, 1,
      { rim: 0.030, rimCol: CHROME });
    trim.box(sx * LAMP_A[0], 1.020, nose - 0.036, hp.hw * 1.9, 0.098, 0.026, 0, LAMP);
    trim.box(sx * LAMP_A[0], 0.938, hp.z + 0.05, hp.hw * 1.9, 0.030, 0.026, 0, AMBER);
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.12, 1,
    { rim: 0.028, rimCol: PLASTIC });
  // Chrome step bumper at both ends, standing off the body on its own brackets.
  const stepBumper = (z, dir) => {
    trim.box(0, 0.522, z + dir * 0.055, 2.00, 0.095, 0.110, 0, CHROME);
    matte.box(0, 0.498, z + dir * 0.055, 0.68, 0.032, 0.130, 0, PLASTIC);       // step pad
    for (const sx of [-1, 1]) matte.box(sx * 0.62, 0.560, z + dir * 0.015, 0.09, 0.11, 0.08, 0, PLASTIC);
  };
  stepBumper(nose, 1);
  stepBumper(tail, -1);
  trim.box(0, 0.640, nose + 0.114, 0.44, 0.145, 0.02, 0, PLATE);
  trim.box(0, 0.640, tail - 0.114, 0.44, 0.145, 0.02, 0, PLATE);

  // --- rear lamps: tall units up the corners, past the bed rail ------------
  for (const sx of [-1, 1]) {
    const tp = pocket(paint, matte, sx * TAILA[0], TAILA[1], tail, TAILA[2], TAILA[3], 0.07, -1,
      { rim: 0.028, rimCol: PLASTIC });
    trim.box(sx * TAILA[0], 0.890, tail + 0.020, tp.hw * 1.9, 0.230, 0.028, 0, TAILC);
    trim.box(sx * TAILA[0], 1.140, tail + 0.020, tp.hw * 1.9, 0.052, 0.028, 0, AMBER);
  }
  pocket(paint, matte, TPLATE[0], TPLATE[1], tail, TPLATE[2], TPLATE[3], 0.05, -1,
    { rim: 0.024, rimCol: PLASTIC });

  // --- flanks: flares, running boards, tow mirrors -------------------------
  for (const sx of [-1, 1]) {
    for (const zc of [1.18, 0.14]) {
      const rows = [-0.008, 0.008].map((dz) =>
        half(zc + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, zc + dz]));
      matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    }
    // Running board on two brackets, between the arches.
    matte.box(sx * (geom(0).wb + 0.055), 0.560, 0.10, 0.170, 0.055, 1.90, 0, PLASTIC);
    for (const bz of [0.90, -0.70]) {
      matte.box(sx * (geom(0).wb - 0.02), 0.600, bz, 0.14, 0.055, 0.07, 0, PLASTIC);
    }
    // Tow mirror: a tall flat glass on a double arm, which is the detail that
    // makes a truck read as a truck from the front.
    //
    // The arms have to START ON THE DOOR SKIN, not on the glass line. The
    // glass is 12 cm inboard of the door at this station, so arms run from
    // there spent their first 12 cm INSIDE the bodywork and only 16 cm of arm
    // ever emerged -- and from a front three-quarter, where the cab hides that
    // 16 cm, the head read as a block floating in mid-air beside the truck.
    // Now: a base plate on the door, two arms out from it, and a riser joining
    // them at the head, so the whole thing is one visible ladder from any
    // angle rather than a mirror with its supports behind the cab.
    // The arms have to START ON THE DOOR SKIN and reach FORWARD, past the
    // cowl. Two things were wrong before. They began at the glass line, 12 cm
    // inboard of the door, so a third of each arm was buried in the bodywork.
    // And the head sat level with the A-pillar, where the cab -- 72 cm taller
    // than the mirror -- hides every centimetre of arm on the far side: from a
    // front three-quarter the far head read as a block floating in the air
    // beside the truck, which is exactly what it was, visually. Ahead of the
    // cowl the arms cross only the BONNET, whose deck is 14 cm below them, so
    // they are seen against the sky and the mirror reads as bolted on from
    // every angle a player can stand in.
    const mz = sgFB[0] - 0.02, hz = mz + 0.22, mx = geom(mz).w;
    // Mounted ACROSS the beltline, where a door skin is, rather than up on the
    // glass -- the arms have to land on something a bracket could bolt to.
    matte.box(sx * (mx + 0.010), 1.250, mz, 0.030, 0.240, 0.140, 0, PLASTIC);   // base plate
    for (const ay of [1.315, 1.505]) {
      matte.tube([sx * (mx + 0.015), ay, mz], [sx * 1.190, ay + 0.020, hz], 0.026, 6, PLASTIC, true);
    }
    matte.tube([sx * 1.190, 1.305, hz], [sx * 1.190, 1.535, hz], 0.024, 6, PLASTIC, true);
    paint.box(sx * 1.228, 1.272, hz - 0.030, 0.075, 0.300, 0.085, 0, WHITE);
    trim.box(sx * 1.228, 1.286, hz - 0.074, 0.062, 0.266, 0.02, 0, GLASS);
    // Bed rail cap and a tie-down, so the rail has a top edge that catches light.
    trim.box(sx * wallX, bedY + railH - 0.006, bedMid, 0.078, 0.014, bedLen - 0.02, 0, [0.22, 0.23, 0.25]);
    // Fuel filler on the bed side, ahead of the rear arch.
    matte.box(sx * (geom(-1.10).w + 0.004), 0.900, -1.10, 0.014, 0.150, 0.190, 0, [0.20, 0.21, 0.23]);
  }

  return wheels;
}

// ---------------------------------------------------------------------------
// Motorcycles
//
// A bike is not a car with two of its wheels deleted, so none of it goes
// through `bodyCore`: there is no shell to loft, no arches to cut and no
// greenhouse. What there is instead is a frame, and everything hangs off it --
// which is why these are built almost entirely from `tube` between named
// points rather than from boxes. `box` and `prism` can only yaw, and on a
// motorcycle nearly every member is diagonal in Y: forks, downtube, swingarm,
// shocks, headers. Built from boxes they come out as level bars floating in
// the air, which is what the viaduct barriers looked like.
// ---------------------------------------------------------------------------

const LEATHER = [0.075, 0.075, 0.085];   // seat, grips, boots
const ENGINE = [0.15, 0.16, 0.175];
const ALLOY = [0.58, 0.60, 0.63];

/** Closed ellipse in the (x, y) plane, for a `loft` ring: tanks, mufflers. */
function ring2(hx, cy, hy, n = 12, cx = 0) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([cx + Math.cos(a) * hx, cy + Math.sin(a) * hy]);
  }
  return p;
}

/**
 * Mudguard: a crowned strip of sheet wrapped round a wheel.
 *
 * `a0`/`a1` are angles about the axle with 0 straight up and positive toward
 * the nose, so a front guard and a bobbed rear one differ only in their arc.
 * The section is crowned across its width because a flat one reads as a plank
 * laid over the tyre -- the same reason the roofs are cambered.
 */
function fender(b, cy, cz, r, halfW, a0, a1, col) {
  const rows = [];
  for (let i = 0; i <= 12; i++) {
    const a = a0 + ((a1 - a0) * i) / 12;
    const row = [];
    for (let j = 0; j <= 4; j++) {
      const u = -1 + j / 2;
      const rr = r * (1 - 0.05 * u * u);
      row.push([u * halfW, cy + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
    }
    rows.push(row);
  }
  b.patch(rows, col, [0, 1, 0]);
}

/** A round mirror head on a stalk, aimed back down the bike. */
function mirror(trim, x, y, z, r, stalkFrom, col) {
  trim.tube(stalkFrom, [x, y, z], 0.011, 6, col, true);
  trim.tube([x, y, z + 0.020], [x, y, z - 0.012], r, 10, col, true);
  trim.box(x, y, z - 0.016, r * 1.7, r * 1.7, 0.014, 0, GLASS);
}

/**
 * The cruiser: long, low and raked, with a 45-degree V-twin standing in an
 * open cradle frame where a player can see straight through it.
 *
 * Everything that separates this from the sportbike is deliberate and
 * measurable in the numbers below: 28 degrees of rake against 23, a 1.66 m
 * wheelbase against 1.36, bars 88 cm across against clip-ons that sit BELOW
 * the top yoke, feet forward of the engine rather than tucked behind it, and a
 * seat 20 cm lower. Two bikes that share a builder and differ by a scale
 * factor would read as the same bike twice, which is the mistake the whole
 * fleet used to make.
 */
function buildCruiser(spec, paint, trim, matte) {
  const zF = 0.86, rF = 0.42, twF = 0.11;      // 21 inch front, skinny
  const zR = -0.80, rR = spec.wheelR, twR = 0.20;
  // `out` 0: both faces of a bike's wheel are outboard faces.
  const wheels = [[0, rF, zF, rF, twF, 0], [0, rR, zR, rR, twR, 0]];

  // The steering axis, as ONE function of height. The forks, both yokes, the
  // headlamp and the bars all read their z from it, so raking the bike is a
  // change to two numbers rather than to fifteen coordinates that have to stay
  // in step -- the same reason the wheel arches read their x from `half()`.
  const fz = (y) => 0.545 - 0.525 * (y - 1.02);      // 28 deg from vertical
  const topY = 1.00, botY = 0.74;

  // --- frame ---------------------------------------------------------------
  const FRAME = [0.13, 0.135, 0.145];
  matte.tube([0, topY + 0.02, fz(topY) - 0.055], [0, botY - 0.02, fz(botY) - 0.055], 0.048, 8, FRAME, true);
  // backbone under the tank, then down behind the engine
  matte.tube([0, 0.985, 0.50], [0, 0.870, -0.12], 0.030, 8, FRAME, true);
  matte.tube([0, 0.870, -0.12], [0, 0.560, -0.36], 0.028, 8, FRAME, true);
  // downtube and cradle: the loop the engine sits in
  matte.tube([0, 0.760, 0.545], [0, 0.330, 0.400], 0.030, 8, FRAME, true);
  for (const sx of [-1, 1]) {
    matte.tube([0, 0.330, 0.400], [sx * 0.105, 0.300, 0.300], 0.024, 6, FRAME, true);
    matte.tube([sx * 0.105, 0.300, 0.300], [sx * 0.105, 0.290, -0.180], 0.024, 6, FRAME, true);
    matte.tube([sx * 0.105, 0.290, -0.180], [sx * 0.100, 0.560, -0.320], 0.024, 6, FRAME, true);
    // seat rails out to the back
    matte.tube([sx * 0.075, 0.735, -0.180], [sx * 0.095, 0.700, -0.760], 0.022, 6, FRAME, true);
  }

  // --- front end -----------------------------------------------------------
  for (const sx of [-1, 1]) {
    const x = sx * 0.105;
    trim.tube([x, 1.055, fz(1.055)], [x, 0.700, fz(0.700)], 0.026, 8, CHROME, true);  // stanchion
    matte.tube([x, 0.760, fz(0.760)], [x, rF, zF], 0.036, 8, [0.10, 0.11, 0.12], true); // slider
  }
  for (const y of [topY, botY]) {
    trim.tube([-0.155, y, fz(y)], [0.155, y, fz(y)], 0.030, 8, ALLOY, true);          // yokes
  }
  fender(paint, rF, zF, rF + 0.050, 0.078, -0.30, 1.05, WHITE);
  // Headlamp: a chrome bucket with the lens across its MOUTH. Buried at the
  // back of a bucket a lens catches nothing and renders as more shadow -- the
  // same trap as the muscle car's sealed beams.
  trim.tube([0, 0.945, 0.545], [0, 0.945, 0.660], 0.098, 12, CHROME, true);
  trim.tube([0, 0.945, 0.655], [0, 0.945, 0.678], 0.084, 12, LAMP, true);
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.135, 0.985, 0.560], [sx * 0.150, 0.985, 0.595], 0.030, 8, AMBER, true);
  }

  // --- bars: pulled back, high, and 84 cm across ---------------------------
  // The grips sit where the RIDER's hands reach, not where a bar looks best on
  // its own: shoulder to grip is 64 cm on this humanoid and the arms simply do
  // not stretch further, so a bar 10 cm too far forward leaves him steering
  // thin air with his fingertips.
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.075, topY + 0.01, fz(topY)], [sx * 0.085, 1.150, 0.500], 0.024, 6, CHROME, true);
    trim.tube([sx * 0.085, 1.170, 0.495], [sx * 0.230, 1.185, 0.455], 0.017, 8, CHROME, true);
    trim.tube([sx * 0.230, 1.185, 0.455], [sx * 0.410, 1.205, 0.392], 0.017, 8, CHROME, true);
    matte.tube([sx * 0.275, 1.194, 0.425], [sx * 0.402, 1.204, 0.395], 0.021, 8, LEATHER, true);
    trim.tube([sx * 0.270, 1.170, 0.432], [sx * 0.370, 1.170, 0.400], 0.010, 6, CHROME, true);  // lever
    mirror(trim, sx * 0.275, 1.345, 0.420, 0.055, [sx * 0.215, 1.190, 0.462], CHROME);
  }
  trim.box(0, 1.195, 0.462, 0.150, 0.055, 0.10, 0, ALLOY);      // clocks on the risers

  // --- V-twin --------------------------------------------------------------
  matte.box(0, 0.255, -0.030, 0.235, 0.230, 0.420, 0, ENGINE);   // crankcase
  matte.box(0, 0.215, -0.030, 0.290, 0.110, 0.360, 0, [0.11, 0.12, 0.13]); // sump
  // Two barrels in a 45 degree V, finned. The fins are what make a cylinder
  // read as an engine rather than as a can, and they cost eight rings each.
  const barrel = (z0, ang) => {
    const dy = Math.cos(ang), dz = Math.sin(ang);
    const base = [0, 0.360, z0];
    const top = [0, 0.360 + dy * 0.300, z0 + dz * 0.300];
    matte.tube(base, top, 0.072, 10, [0.09, 0.10, 0.11], true);
    for (let i = 0; i < 7; i++) {
      const t = 0.10 + i * 0.115;
      const p = [0, 0.360 + dy * 0.300 * t, z0 + dz * 0.300 * t];
      const q = [0, 0.360 + dy * 0.300 * (t + 0.03), z0 + dz * 0.300 * (t + 0.03)];
      trim.tube(p, q, 0.100, 10, ALLOY, true);
    }
    trim.tube(top, [0, 0.360 + dy * 0.375, z0 + dz * 0.375], 0.088, 10, ALLOY, true); // rocker box
  };
  barrel(0.115, 0.42);
  barrel(-0.115, -0.42);
  // Primary case on the left, air cleaner on the right: a V-twin is not
  // symmetrical, and which side each lands on is most of what tells the two
  // flanks apart. Offset in x, not centred -- a cover built on the centreline
  // is a lump growing out of the middle of the engine.
  paint.loft([
    { z: -0.180, pts: ring2(0.050, 0.300, 0.130, 12, 0.140) },
    { z: -0.030, pts: ring2(0.058, 0.300, 0.155, 12, 0.150) },
    { z: 0.130, pts: ring2(0.045, 0.310, 0.125, 12, 0.140) },
  ], WHITE, { capStart: true, capEnd: true });
  trim.tube([-0.135, 0.560, -0.010], [-0.245, 0.560, -0.010], 0.105, 12, CHROME, true);
  trim.tube([-0.245, 0.560, -0.010], [-0.262, 0.560, -0.010], 0.088, 12, ALLOY, true);

  // --- tank, seat, tail ----------------------------------------------------
  paint.loft([
    { z: 0.500, pts: ring2(0.055, 0.905, 0.055, 12) },
    { z: 0.360, pts: ring2(0.140, 0.905, 0.100, 12) },
    { z: 0.140, pts: ring2(0.185, 0.900, 0.120, 12) },
    { z: -0.040, pts: ring2(0.155, 0.885, 0.105, 12) },
    { z: -0.160, pts: ring2(0.070, 0.860, 0.055, 12) },
  ], WHITE, { capStart: true, capEnd: true });
  trim.box(0, 1.008, 0.150, 0.075, 0.020, 0.34, 0, CHROME);      // tank console
  trim.tube([0, 1.010, 0.320], [0, 1.010, 0.360], 0.030, 10, CHROME, true);  // filler cap

  matte.loft([
    { z: -0.150, pts: ring2(0.090, 0.735, 0.045, 10) },
    { z: -0.300, pts: ring2(0.160, 0.715, 0.055, 10) },
    { z: -0.460, pts: ring2(0.165, 0.730, 0.050, 10) },
    { z: -0.600, pts: ring2(0.135, 0.790, 0.055, 10) },
    { z: -0.720, pts: ring2(0.080, 0.815, 0.040, 10) },
  ], LEATHER, { capStart: true, capEnd: true });
  // Bobbed: the guard follows the top of the tyre and stops, rather than
  // wrapping down round the back of it. Carried too far round it stops being a
  // mudguard and becomes a skirt, which is a different decade of motorcycle.
  fender(paint, rR, zR, rR + 0.050, 0.115, -1.20, 0.75, WHITE);
  // Sissy bar. Nothing else on the bike stands up above the rear wheel, and
  // the silhouette from across a street is the point of it.
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.080, 0.760, -0.905], [sx * 0.070, 1.150, -0.980], 0.012, 6, CHROME, true);
  }
  trim.tube([-0.070, 1.146, -0.978], [0.070, 1.146, -0.978], 0.012, 6, CHROME, true);
  matte.loft([
    { z: -0.930, pts: ring2(0.070, 0.980, 0.105, 10) },
    { z: -0.968, pts: ring2(0.078, 0.975, 0.115, 10) },
  ], LEATHER, { capStart: true, capEnd: true });

  // --- rear end ------------------------------------------------------------
  for (const sx of [-1, 1]) {
    matte.tube([sx * 0.105, 0.330, -0.170], [sx * 0.085, rR, zR], 0.028, 8, [0.11, 0.12, 0.13], true);
    trim.tube([sx * 0.110, 0.690, -0.400], [sx * 0.090, 0.430, -0.720], 0.021, 8, CHROME, true);  // shock
    matte.tube([sx * 0.150, 0.300, 0.330], [sx * 0.265, 0.288, 0.355], 0.022, 6, PLASTIC, true);  // forward peg
  }
  // Staggered pipes down the right: two lengths, two heights, which is the
  // arrangement the shape is named after.
  matte.tube([-0.060, 0.640, 0.230], [-0.170, 0.420, 0.190], 0.036, 8, [0.10, 0.11, 0.12], true);
  trim.tube([-0.170, 0.420, 0.190], [-0.205, 0.355, 0.010], 0.038, 8, CHROME, true);
  trim.tube([-0.205, 0.355, 0.010], [-0.225, 0.345, -0.870], 0.049, 10, CHROME, true);
  matte.tube([-0.060, 0.615, -0.230], [-0.190, 0.330, -0.190], 0.034, 8, [0.10, 0.11, 0.12], true);
  trim.tube([-0.190, 0.330, -0.190], [-0.255, 0.275, -0.720], 0.044, 10, CHROME, true);
  hole(trim, matte, -0.225, 0.345, -0.872, 0.038, 0.07, -1);
  hole(trim, matte, -0.255, 0.275, -0.722, 0.034, 0.07, -1);

  // Lamp and plate ON the end of the guard, at the radius the guard actually
  // reaches -- placed by eye they hang in the air behind it.
  trim.box(0, 0.612, -1.198, 0.095, 0.060, 0.030, 0, TAILC);
  matte.box(0, 0.478, -1.205, 0.185, 0.125, 0.014, 0, PLASTIC);
  trim.box(0, 0.482, -1.214, 0.160, 0.100, 0.014, 0, PLATE);

  return wheels;
}

/**
 * The sportbike: everything the cruiser is not. Mass carried high and forward,
 * a fairing wrapped round the front of the engine, clip-ons under the top yoke
 * and a tail that runs up and away to nothing behind the rider.
 *
 * The fairing is a closed `loft`, not an open shell. A real one is open at the
 * bottom and along the flanks, but the section that is left when you close it
 * IS the belly pan, and a closed loft shades continuously round the nose where
 * two mirrored open patches would show a seam straight down the middle of the
 * thing a player looks at from in front.
 */
function buildSportbike(spec, paint, trim, matte) {
  const zF = 0.70, rF = 0.31, twF = 0.12;
  const zR = -0.66, rR = spec.wheelR, twR = 0.19;
  const wheels = [[0, rF, zF, rF, twF, 0], [0, rR, zR, rR, twR, 0]];

  const fz = (y) => 0.440 - 0.425 * (y - 0.900);     // 23 deg of rake
  const topY = 0.885, botY = 0.660;

  // --- frame: twin alloy beams round the outside of the engine -------------
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.075, 0.845, fz(0.845) - 0.030], [sx * 0.150, 0.760, 0.180], 0.038, 8, ALLOY, true);
    trim.tube([sx * 0.150, 0.760, 0.180], [sx * 0.140, 0.680, -0.120], 0.040, 8, ALLOY, true);
    trim.tube([sx * 0.140, 0.680, -0.120], [sx * 0.110, 0.430, -0.150], 0.034, 8, ALLOY, true);
  }
  matte.tube([0, topY + 0.03, fz(topY + 0.03) - 0.045], [0, botY - 0.02, fz(botY - 0.02) - 0.045],
    0.042, 8, [0.13, 0.135, 0.145], true);

  // --- front end -----------------------------------------------------------
  for (const sx of [-1, 1]) {
    const x = sx * 0.092;
    matte.tube([x, 0.925, fz(0.925)], [x, 0.640, fz(0.640)], 0.032, 8, [0.28, 0.29, 0.31], true); // upside-down
    trim.tube([x, 0.660, fz(0.660)], [x, rF, zF], 0.024, 8, CHROME, true);
  }
  for (const y of [topY, botY]) {
    trim.tube([-0.135, y, fz(y)], [0.135, y, fz(y)], 0.026, 8, ALLOY, true);
  }
  fender(paint, rF, zF, rF + 0.045, 0.075, -0.55, 1.05, WHITE);
  // Clip-ons: BELOW the top yoke and angled down. Bars above it would be the
  // cruiser's riding position on a different frame, and the rider's pose is
  // built on where these end up.
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.092, 0.858, fz(0.858)], [sx * 0.245, 0.840, 0.360], 0.016, 8, ALLOY, true);
    matte.tube([sx * 0.180, 0.848, 0.385], [sx * 0.242, 0.841, 0.362], 0.020, 8, LEATHER, true);
    trim.tube([sx * 0.185, 0.826, 0.372], [sx * 0.268, 0.822, 0.344], 0.009, 6, ALLOY, true);
  }

  // --- fairing -------------------------------------------------------------
  // Slim. The first pass ran this out to a 43 cm section and the bike came
  // back as one red torpedo with a rider sitting on it -- a fairing has to
  // read as a skin stretched over the front of a narrow machine, and the
  // wheel, forks and engine all have to stay visible past it.
  // Two-tone by height, which `loft` will do for nothing: the lower half of a
  // fairing is dark on most of these bikes, and without that break the
  // fairing, the tank and the tail run together into one red mass from nose to
  // tail with a rider sitting on top of it.
  paint.loft([
    { z: 0.860, pts: ring2(0.080, 0.860, 0.070, 14) },
    { z: 0.740, pts: ring2(0.120, 0.820, 0.115, 14) },
    { z: 0.580, pts: ring2(0.155, 0.760, 0.145, 14) },
    { z: 0.400, pts: ring2(0.155, 0.690, 0.155, 14) },
    { z: 0.220, pts: ring2(0.115, 0.618, 0.118, 14) },
  ], [0.26, 0.26, 0.28], { capStart: true, capEnd: false, colTop: WHITE, topFrom: 0.790 });
  // Screen: a small bubble standing off the top of the nose.
  const scr = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = 0.795 - 0.275 * t, cy = 0.928 + 0.145 * t;
    for (let j = 0; j <= 6; j++) {
      const u = -1 + j / 3;
      row.push([u * (0.085 + 0.060 * t), cy - 0.030 * u * u, cz + 0.028 * u * u]);
    }
    scr.push(row);
  }
  trim.patch(scr, GLASS, [0, 0.6, 1]);
  // Twin headlamps stacked into the nose, and mirrors on the fairing rather
  // than on the bars -- both are sportbike signatures.
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * 0.040, 0.862, 0.856, 0.032, 0.036, 0.06, 1, { rim: 0.012 });
    // Lens at the MOUTH of the housing. Sunk to the back of the pocket it has
    // nothing to catch and renders as more shadow -- see `pocket`.
    trim.box(sx * 0.040, 0.868, 0.870, hp.hw * 1.8, 0.046, 0.018, 0, LAMP);
    trim.box(sx * 0.120, 0.812, 0.775, 0.050, 0.028, 0.028, 0, AMBER);
    mirror(trim, sx * 0.235, 0.955, 0.665, 0.046, [sx * 0.120, 0.900, 0.740], [0.16, 0.17, 0.18]);
  }
  // Duct in the flank of the fairing, so the side is not one blank panel.
  for (const sx of [-1, 1]) {
    matte.box(sx * 0.168, 0.690, 0.420, 0.018, 0.070, 0.170, 0, [0.09, 0.10, 0.11]);
  }

  // --- engine and exhaust --------------------------------------------------
  matte.box(0, 0.330, 0.020, 0.290, 0.250, 0.320, 0, ENGINE);
  trim.box(0, 0.560, 0.060, 0.250, 0.090, 0.230, 0, ALLOY);       // cam cover
  // Four headers sweeping down and back into one collector under the engine,
  // then up to a can on the right. `tube` between arbitrary points is the only
  // thing here that can follow that.
  for (const sx of [-1, 1]) {
    for (const dx of [0.040, 0.110]) {
      trim.tube([sx * dx, 0.520, 0.185], [sx * dx * 0.9, 0.330, 0.290], 0.021, 6, CHROME, true);
      trim.tube([sx * dx * 0.9, 0.330, 0.290], [sx * dx * 0.5, 0.185, 0.090], 0.021, 6, CHROME, true);
    }
  }
  trim.tube([0, 0.175, 0.100], [-0.040, 0.190, -0.230], 0.048, 10, CHROME, true);
  matte.loft([
    { z: -0.240, pts: ring2(0.045, 0.235, 0.045, 10, -0.055) },
    { z: -0.420, pts: ring2(0.070, 0.360, 0.070, 10, -0.135) },
    { z: -0.640, pts: ring2(0.062, 0.470, 0.062, 10, -0.185) },
  ], [0.24, 0.25, 0.27], { capStart: true, capEnd: true });
  hole(trim, matte, -0.185, 0.470, -0.642, 0.048, 0.07, -1);
  matte.box(0, 0.145, 0.020, 0.285, 0.080, 0.430, 0, [0.09, 0.095, 0.105]);   // belly pan

  // --- tank, seat, tail unit -----------------------------------------------
  paint.loft([
    { z: 0.440, pts: ring2(0.085, 0.815, 0.055, 12) },
    { z: 0.280, pts: ring2(0.165, 0.840, 0.092, 12) },
    { z: 0.060, pts: ring2(0.178, 0.845, 0.096, 12) },
    { z: -0.090, pts: ring2(0.118, 0.855, 0.062, 12) },
  ], WHITE, { capStart: true, capEnd: true });
  matte.loft([
    { z: -0.090, pts: ring2(0.105, 0.872, 0.035, 10) },
    { z: -0.260, pts: ring2(0.130, 0.882, 0.040, 10) },
    { z: -0.380, pts: ring2(0.115, 0.905, 0.038, 10) },
  ], LEATHER, { capStart: false, capEnd: true });
  // The tail runs UP and back and finishes almost at a point. A level tail is
  // a commuter; this is the one line that carries the whole bike from behind.
  // It is also SHORT -- carried out to the end of the wheelbase it stops being
  // a tail unit and becomes a rocket with a bike underneath.
  paint.loft([
    { z: -0.340, pts: ring2(0.118, 0.898, 0.062, 12) },
    { z: -0.520, pts: ring2(0.102, 0.938, 0.062, 12) },
    { z: -0.660, pts: ring2(0.062, 0.976, 0.048, 12) },
    { z: -0.730, pts: ring2(0.028, 0.992, 0.026, 12) },
  ], WHITE, { capStart: false, capEnd: true });
  trim.box(0, 0.988, -0.742, 0.062, 0.026, 0.018, 0, TAILC);
  // Plate on a hanger off the swingarm side, which is where an undertail
  // exhaust leaves room for it.
  matte.tube([0, 0.930, -0.700], [0, 0.800, -0.775], 0.012, 6, PLASTIC, true);
  trim.box(0, 0.760, -0.790, 0.115, 0.075, 0.012, 0, PLATE);

  // --- single-sided swingarm, rear sets ------------------------------------
  // Only one arm, which is what the name means: from the other side the wheel
  // hangs on nothing, and that is the look. It is on the LEFT (+X), opposite
  // the silencer, the way the bikes that have one are built.
  matte.loft([
    { z: -0.140, pts: ring2(0.038, 0.395, 0.075, 8, 0.140) },
    { z: -0.420, pts: ring2(0.034, 0.360, 0.062, 8, 0.150) },
    { z: zR, pts: ring2(0.030, rR, 0.048, 8, 0.140) },
  ], [0.30, 0.31, 0.33], { capStart: true, capEnd: true });
  trim.tube([0.140, rR, zR], [0.190, rR, zR], 0.055, 10, ALLOY, true);   // hub nut
  trim.tube([0, 0.700, -0.240], [0.020, 0.430, -0.230], 0.026, 8, [0.55, 0.20, 0.16], true); // shock
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.115, 0.420, -0.180], [sx * 0.185, 0.400, -0.235], 0.012, 6, ALLOY, true);
    matte.tube([sx * 0.185, 0.400, -0.235], [sx * 0.245, 0.398, -0.250], 0.017, 6, PLASTIC, true);
  }

  return wheels;
}

/**
 * Where a rider sits, and how. One entry per bike, because the two riding
 * positions are as different as the bikes: a cruiser rider is upright with his
 * feet ahead of him, a sportbike rider is folded over the tank with his knees
 * behind his hips.
 *
 * Signs, all of which are easy to get backwards: the limb bones hang down the
 * -Y axis, so +x on a thigh or an upper arm swings it BACKWARD and -x swings
 * it forward; +x on the spine leans the torso forward; +z on a bone swings it
 * toward +X, which is the vehicle's left.
 */
const RIDERS = {
  // Sitting up, hands out on pullback bars, feet on forward controls -- so the
  // legs are nearly straight and the reach is almost horizontal.
  cruiser: {
    z: -0.200, hipY: 0.870, seed: 31,
    lean: 0.08, head: -0.14,
    shoulder: [-1.10, 0.30], elbow: [-0.40, 0.06],
    thigh: [-0.90, 0.18], knee: 0.28, foot: -0.20,
  },
  // Folded over the tank: chest down 35 degrees, head back up to look through
  // the screen, knees behind the hips and tucked into the tank.
  sportbike: {
    z: -0.120, hipY: 0.930, seed: 57,
    lean: 0.74, head: -0.82,
    shoulder: [-0.60, 0.22], elbow: [-0.22, 0.06],
    thigh: [-1.35, 0.26], knee: 1.55, foot: -0.25,
  },
};

// One rider mesh for the whole fleet, built once. Leathers and a helmet, so a
// rider is legible at the distance a bike is usually seen from.
let RIDER_GEO = null;
function riderGeometry() {
  if (!RIDER_GEO) {
    RIDER_GEO = buildCharacter({
      seed: 4242,
      shirt: [0.14, 0.15, 0.18], pants: [0.10, 0.10, 0.12],
      vest: [0.11, 0.12, 0.15], hat: [0.10, 0.11, 0.14],
    });
  }
  return RIDER_GEO;
}

/** Poses a humanoid onto a bike and returns it, ready to add to the tilt group. */
function makeRider(hand) {
  const p = RIDERS[hand];
  const h = makeHumanoid({ geometry: riderGeometry(), seed: p.seed, scale: 0.96 });
  const b = h.bones;
  b[BONES.spine].rotation.x = p.lean * 0.45;
  b[BONES.chest].rotation.x = p.lean * 0.55;
  b[BONES.neck].rotation.x = p.head * 0.4;
  b[BONES.head].rotation.x = p.head * 0.6;
  for (const [s, sh, el, th, kn, ft] of [
    [-1, BONES.shoulderL, BONES.elbowL, BONES.thighL, BONES.kneeL, BONES.footL],
    [1, BONES.shoulderR, BONES.elbowR, BONES.thighR, BONES.kneeR, BONES.footR],
  ]) {
    b[sh].rotation.set(p.shoulder[0] - p.lean, 0, s * p.shoulder[1]);
    b[el].rotation.set(p.elbow[0], 0, s * p.elbow[1]);
    b[th].rotation.set(p.thigh[0], 0, s * p.thigh[1]);
    b[kn].rotation.x = p.knee;
    b[ft].rotation.x = p.foot;
  }
  // 0.927 is the hip height of the unscaled character -- see peds.js `J`.
  h.group.position.set(0, p.hipY - 0.927 * h.scale, p.z);
  return h;
}

/**
 * The convertible: a US two-seater with the roof taken off, which is a
 * different problem from every other body here rather than the same one with
 * fewer panels.
 *
 * Nothing is lofted above the beltline at all -- no greenhouse, no roof, no
 * pillars past the screen header. What that leaves is an open box, and the
 * whole shape depends on what is INSIDE it: a floor, a tub, two seats, a dash
 * and a wheel. Without those you are looking down through the beltline at the
 * far sill and the car reads as an empty shell, which is exactly what a
 * roofless body is if nobody builds the interior.
 *
 * The cockpit is built the same way every other opening here is: as a recess
 * whose rim stands proud of the deck. There is no boolean operation in this
 * builder, so the aperture cannot be cut out of the loft -- but a tub dropped
 * in with its rim standing 2 cm above the deck hides the shell underneath from
 * every angle, and what reads is an opening.
 */
function buildConvertible(spec, paint, trim, matte) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.34, zR = -1.30;                 // 2.64 m wheelbase

  const halfW = curve([
    [tail, 0.90], [-2.00, 0.97], [zR, 1.00], [-0.55, 0.93], [0.30, 0.93],
    [zF, 0.99], [2.00, 0.94], [nose, 0.86],
  ]);
  const sillY = curve([
    [tail, 0.32], [-1.90, 0.26], [-0.60, 0.24], [0.60, 0.24], [1.90, 0.26], [nose, 0.32],
  ]);
  // Flat and low along the whole flank. With no roof over it the beltline IS
  // the top of the car, and a dipping one would leave the doors looking like a
  // coupe someone had cut the roof off with a saw.
  const beltY = curve([
    [tail, 0.985], [-1.95, 1.010], [zR, 1.020], [-0.60, 1.005], [0.30, 1.000],
    [0.90, 0.998], [1.40, 0.980], [1.95, 0.945], [nose, 0.920],
  ]);
  const tuckAt = curve([
    [tail, 0.88], [zR, 0.95], [-0.60, 0.88], [0.60, 0.88], [zF, 0.95], [nose, 0.88],
  ]);
  const topAt = curve([
    [tail, 0.90], [-1.80, 0.95], [0.80, 0.95], [1.50, 0.93], [2.10, 0.86], [nose, 0.78],
  ]);
  // The cockpit floor, as a curve rather than a step: the ramp up at the front
  // is the scuttle the dash sits under and the ramp at the back is the deck
  // the folded top stacks on, both of which a convertible has to have.
  const cockF = 0.88, cockR = -1.06, floorY = 0.520;
  // The ramp in FRONT is short on purpose: it is the firewall, and the screen
  // stands just behind it. Drawn out over 30 cm instead it becomes a wall
  // rising in front of the windscreen, which is a scuttle in the wrong place.
  const deckDip = curve([
    [cockR - 0.24, 1.06], [cockR, floorY], [cockF, floorY], [cockF + 0.14, 1.06],
  ]);
  const { geom, half, endProf } = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR: 0.56, archGap: 0.06, creaseAt: 0.64, tumble: 0.95,
    deckDrop: 0.026, lipOut: 0.048, endRound: 0.14, endMin: 0.90,
    deckDip,
  });

  const twF = 0.235, twR = 0.275;
  const wxF = geom(zF).wb - twF / 2 + 0.02;
  const wxR = geom(zR).wb - twR / 2 + 0.02;
  const wheels = [
    [-wxF, wr, zF, wr, twF], [wxF, wr, zF, wr, twF],
    [-wxR, wr, zR, wr, twR], [wxR, wr, zR, wr, twR],
  ];

  // --- cockpit: the tub the loft dips into ---------------------------------
  // The interior is laid ON the dipped section's own points, 5 mm proud, the
  // same trick the roof panels use. Registered by construction, so the trim
  // cannot drift off the opening it is lining -- and it has to be a surface of
  // its own regardless, because a `loft` forces every normal outward from the
  // ring's centre and the inside of a tub faces the other way.
  const NZ = 18;
  const tubRows = [], topEdge = [];
  for (let i = 0; i <= NZ; i++) {
    const z = cockR - 0.16 + ((cockF - cockR + 0.30) * i) / NZ;
    const L = half(z, -1), R = half(z, 1);
    const row = [];
    for (const k of [9, 10, 11]) row.push([L[k][0] * 0.985, L[k][1] + 0.005, z]);
    for (const k of [11, 10, 9]) row.push([R[k][0] * 0.985, R[k][1] + 0.005, z]);
    tubRows.push(row);
    topEdge.push([L[8], R[8], z]);
  }
  matte.patch(tubRows, [0.055, 0.058, 0.065], [0, 1, 0]);
  for (const sx of [-1, 1]) {
    // Roll over the top of the door: painted, between the shoulder and the
    // inner lip, which is what a convertible has instead of a window frame.
    paint.patch([
      topEdge.map(([L, R, z]) => (sx < 0 ? [L[0], L[1], z] : [R[0], R[1], z])),
      tubRows.map((r) => (sx < 0 ? [r[0][0], r[0][1] + 0.004, r[0][2]] : [r[5][0], r[5][1] + 0.004, r[5][2]])),
    ], WHITE, [sx, 0.5, 0]);
  }
  // Tunnel and a rear bulkhead, so the floor is not one flat sheet.
  matte.box(0, floorY, -0.200, 0.240, 0.105, 1.00, 0, [0.125, 0.128, 0.138]);
  matte.box(0, floorY, cockR + 0.075, 0.860, 0.230, 0.070, 0, [0.09, 0.095, 0.105]);

  // Seats: a cushion and a raked back, built as a lathe up Y so the back can
  // lean without `box`'s yaw-only rotation getting in the way.
  const seat = (sx) => {
    const cx = sx * 0.300, cz = -0.320;
    matte.loftY([
      { y: floorY + 0.030, pts: ring2(0.220, cz, 0.240, 10, cx) },
      { y: floorY + 0.150, pts: ring2(0.235, cz, 0.250, 10, cx) },
      { y: floorY + 0.200, pts: ring2(0.210, cz + 0.02, 0.220, 10, cx) },
    ], LEATHER, { capStart: true, capEnd: true });
    // Backrest, raked and tall enough to stand above the beltline -- a seat
    // whose top is under the door line cannot be seen from outside the car at
    // all, and the interior is the whole point of this body.
    matte.loftY([
      { y: floorY + 0.180, pts: ring2(0.215, cz - 0.190, 0.085, 10, cx) },
      { y: floorY + 0.380, pts: ring2(0.220, cz - 0.245, 0.080, 10, cx) },
      { y: floorY + 0.560, pts: ring2(0.190, cz - 0.305, 0.070, 10, cx) },
    ], LEATHER, { capStart: true, capEnd: true });
    matte.box(cx, floorY + 0.575, cz - 0.330, 0.185, 0.135, 0.095, 0, LEATHER);   // head restraint
  };
  seat(-1); seat(1);

  // Dash, binnacle and a wheel on a raked column. The wheel is a ring of tubes
  // rather than a torus primitive, since there is not one here.
  const cowlY = beltY(cockF);
  matte.patch([
    [[-0.560, cowlY - 0.020, cockF - 0.030], [0, cowlY - 0.010, cockF - 0.045], [0.560, cowlY - 0.020, cockF - 0.030]],
    [[-0.545, cowlY - 0.150, cockF - 0.220], [0, cowlY - 0.140, cockF - 0.235], [0.545, cowlY - 0.150, cockF - 0.220]],
    [[-0.520, floorY + 0.130, cockF - 0.250], [0, floorY + 0.140, cockF - 0.265], [0.520, floorY + 0.130, cockF - 0.250]],
  ], [0.145, 0.150, 0.160], [0, 0.6, -1]);
  // Bright strip along the top edge of the dash. Without it the dash, the tub
  // and the footwell are three dark surfaces meeting at unlit angles and the
  // whole front of the cockpit reads as one hole.
  trim.tube([-0.545, cowlY - 0.014, cockF - 0.034], [0.545, cowlY - 0.014, cockF - 0.034],
    0.014, 6, CHROME, true);
  // Left-hand drive: the wheel goes on the +X side, which is the vehicle's own
  // left. Built on -X it is on the kerb side of an American street.
  trim.tube([0.170, cowlY - 0.085, cockF - 0.160], [0.470, cowlY - 0.085, cockF - 0.150],
    0.078, 10, [0.19, 0.20, 0.21], true);        // instrument binnacle
  // The wheel goes where a DRIVER's hands are -- about 35 cm in front of the
  // seat back, not up against the dash. Pushed forward to look tidy against
  // the bulkhead it leaves the cockpit reading as an empty tub with a screen.
  const wc = [0.330, 0.915, 0.155];
  matte.tube([0.395, 1.000, 0.560], wc, 0.024, 8, [0.16, 0.17, 0.18], true);
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
    // The rim lies in a plane raked back 30 degrees, so its z varies with the
    // point's height -- a wheel built flat reads as a plate on the dash.
    const p = (a) => [wc[0] + Math.cos(a) * 0.175, wc[1] + Math.sin(a) * 0.175 * 0.87,
      wc[2] - Math.sin(a) * 0.175 * 0.50];
    // Bright rim, into `trim`. A dark-grey wheel in a dark tub is invisible
    // however carefully it is placed -- and a period wheel is chrome and wood
    // anyway, so the thing that reads is also the thing that is right.
    trim.tube(p(a0), p(a1), 0.020, 6, [0.62, 0.50, 0.34]);
  }
  for (const a of [1.7, 3.8, 5.9]) {
    trim.tube(wc, [wc[0] + Math.cos(a) * 0.155, wc[1] + Math.sin(a) * 0.135, wc[2] - Math.sin(a) * 0.078],
      0.013, 6, ALLOY, true);
  }
  trim.tube([wc[0], wc[1], wc[2] + 0.010], [wc[0], wc[1], wc[2] - 0.020], 0.048, 10, CHROME, true);
  matte.box(-0.180, cowlY - 0.110, cockF - 0.185, 0.320, 0.105, 0.14, 0, [0.19, 0.20, 0.21]);  // glovebox lid
  trim.tube([-0.055, floorY + 0.150, -0.080], [-0.060, floorY + 0.290, -0.045], 0.016, 6, CHROME, true); // shifter

  // --- windscreen frame and roll hoops -------------------------------------
  const hdrZ = 0.460, hdrY = spec.roof, baseY = cowlY + 0.010;
  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = cockF - 0.020 + (hdrZ - cockF + 0.020) * t, cy = baseY + (hdrY - baseY) * t;
    for (let j = 0; j <= 6; j++) {
      const u = -1 + j / 3;
      row.push([u * (0.560 - 0.055 * t), cy - 0.030 * u * u, cz - 0.075 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);
  // A-pillars off the screen's OWN edge points, and a header across the top.
  // Sized by eye they end up beside the glass rather than on it -- the sports
  // car's first pillar was a pipe lying on the roof for the same reason.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const a = scrRows[i][scrRows[i].length - 1], b2 = scrRows[i + 1][scrRows[i + 1].length - 1];
      trim.tube([sx * a[0], a[1], a[2]], [sx * b2[0], b2[1], b2[2]], 0.028, 8, CHROME, true);
    }
  }
  const hdr = scrRows[3];
  trim.tube([hdr[0][0], hdr[0][1], hdr[0][2]], [hdr[hdr.length - 1][0], hdr[hdr.length - 1][1], hdr[hdr.length - 1][2]],
    0.030, 8, CHROME, true);
  // Roll hoops behind the seats. Two of them, and they are the only thing that
  // stands above the beltline behind the screen.
  for (const sx of [-1, 1]) {
    const hz = -0.760, hy = beltY(hz);
    const arc = [];
    for (let i = 0; i <= 5; i++) {
      const a = (i / 5) * Math.PI * 0.5;
      arc.push([sx * (0.370 - 0.155 * Math.sin(a) * Math.sin(a)), hy + 0.300 * Math.sin(a), hz - 0.030 * Math.sin(a)]);
    }
    for (let i = 0; i < 5; i++) trim.tube(arc[i], arc[i + 1], 0.030, 8, [0.55, 0.57, 0.60], true);
  }

  // --- folded top stack ----------------------------------------------------
  // A soft top does not disappear; it stacks behind the seats, and the deck
  // over it is the reason a convertible's tail is longer than a coupe's.
  matte.loft([
    { z: -0.980, pts: ring2(0.520, beltY(-0.98) - 0.055, 0.085, 12) },
    { z: -1.180, pts: ring2(0.545, beltY(-1.18) - 0.010, 0.115, 12) },
    { z: -1.420, pts: ring2(0.500, beltY(-1.42) - 0.020, 0.100, 12) },
  ], [0.085, 0.09, 0.10], { capStart: true, capEnd: true });
  for (let i = 0; i < 3; i++) {
    // The bows showing through the cover. Evenly spaced bright bars read as a
    // grille laid on the deck; three dark ones read as folded fabric.
    matte.box(0, beltY(-1.18) + 0.090 - i * 0.006, -1.075 - i * 0.115, 0.980 - i * 0.05, 0.014, 0.028, 0,
      [0.055, 0.058, 0.065]);
  }
  // Body-colour lip round the front of the well, which is what the tonneau
  // shuts against.
  paint.box(0, beltY(-0.98) - 0.030, -0.950, 1.120, 0.045, 0.075, 0, WHITE);

  // --- front fascia --------------------------------------------------------
  const GRILLE = [0, 0.640, 0.520, 0.090], LAMP_A = [0.610, 0.680, 0.140, 0.070];
  const INTAKE = [0, 0.440, 0.440, 0.045];
  const TAILA = [0.400, 0.700, 0.230, 0.080], PIPE = [0.420, 0.560, 0.038, 0.038];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILA, PIPE], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.14, 1,
    { rim: 0.032, rimCol: CHROME });
  for (let i = -6; i <= 6; i++) {
    trim.box(i * 0.078, GRILLE[1], gp.z + 0.015, 0.018, 0.150, 0.03, 0, [0.28, 0.29, 0.31]);
  }
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.10, 1,
      { rim: 0.024, rimCol: CHROME });
    trim.box(sx * LAMP_A[0], 0.692, nose - 0.030, hp.hw * 1.9, 0.074, 0.024, 0, LAMP);
    trim.box(sx * LAMP_A[0], 0.632, hp.z + 0.045, hp.hw * 1.9, 0.022, 0.024, 0, AMBER);
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.11, 1, { rim: 0.024 });
  trim.box(0, 0.370, nose + 0.008, 1.52, 0.085, 0.12, 0, CHROME);
  trim.box(0, 0.395, nose + 0.046, 0.42, 0.135, 0.02, 0, PLATE);

  // --- rear ----------------------------------------------------------------
  for (const sx of [-1, 1]) {
    const tp = pocket(paint, matte, sx * TAILA[0], TAILA[1], tail, TAILA[2], TAILA[3], 0.07, -1,
      { rim: 0.026, rimCol: CHROME });
    trim.box(sx * TAILA[0], 0.700, tail + 0.022, tp.hw * 1.9, 0.135, 0.026, 0, TAILC);
    trim.box(sx * (TAILA[0] + 0.140), 0.700, tail + 0.022, 0.075, 0.135, 0.026, 0, AMBER);
    hole(trim, matte, sx * PIPE[0], PIPE[1], tail, 0.050, 0.12, -1);
  }
  trim.box(0, 0.370, tail - 0.008, 1.52, 0.085, 0.12, 0, CHROME);
  trim.box(0, 0.560, tail - 0.026, 0.42, 0.135, 0.02, 0, PLATE);

  // --- flanks --------------------------------------------------------------
  for (const sx of [-1, 1]) {
    trim.box(sx * (geom(0).wb + 0.008), 0.250, 0, 0.028, 0.048, 2.00, 0, CHROME);
    // One shut line: this is a two-door, and the door is long.
    const rows = [-0.009, 0.009].map((dz) =>
      half(0.94 + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, 0.94 + dz]));
    matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    const hg = geom(-0.10);
    trim.tube([sx * hg.w * 0.985, hg.yc + 0.09, -0.20], [sx * hg.w * 0.985, hg.yc + 0.09, 0.00],
      0.017, 6, CHROME, true);
    // Mirror on the door shoulder, at the base of the A-pillar.
    paint.tube([sx * 0.760, 1.000, 0.760], [sx * 0.870, 1.020, 0.720], 0.020, 6, WHITE, true);
    paint.box(sx * 0.905, 0.985, 0.688, 0.100, 0.085, 0.055, 0, WHITE);
    trim.box(sx * 0.905, 0.992, 0.660, 0.086, 0.066, 0.02, 0, GLASS);
    // Side gill behind the front arch, the one flank feature.
    for (let i = 0; i < 3; i++) {
      matte.box(sx * (geom(0.70).w + 0.004), geom(0.70).yc - 0.08 + i * 0.048, 0.70,
        0.012, 0.030, 0.22, 0, [0.10, 0.11, 0.12]);
    }
  }

  return wheels;
}

/**
 * The shared pipeline: one lofted tube varied by a handful of numbers.
 *
 * It is what every vehicle used to be, and it is still what the workaday shapes
 * are -- but it cannot make a car anyone modelled on purpose. Six types came
 * out of it at exactly 1430 triangles each because the only thing separating a
 * sedan from a taxi from a muscle car was the arguments. Anything that needs to
 * hold up under a chase camera gets an authored builder instead (`spec.hand`).
 */
function buildGeneric(spec, paint, trim, matte) {
  const L = spec.len, W = spec.wid / 2;
  const wr = spec.wheelR;
  const sill = spec.sill, belt = spec.belt, roof = spec.roof;
  const zAt = (t) => (t - 0.5) * L;
  const boxy = spec.boxy || 0;
  const round = boxy >= 2 ? 0.20 : boxy === 1 ? 0.16 : 0.13;

  // Per-type body language. Defaults are a generic sedan; every entry in TYPES
  // overrides what makes it that vehicle rather than a scaled copy of the last
  // one. These are authored numbers, not derived from a flag.
  const P = {
    shoulder: 0.55,   // height of the widest point up the section
    tumble: 0.06,     // how far the sides lean in above it
    tuck: 0.08,       // how far the sill pulls under
    crown: 0.03,      // roof camber
    edge: 0.4,        // 0 soft radius, 1 hard folded crease
    glassTumble: 0.10,
    roofCrown: 0.02,
    flare: 0.0,       // extra width over the arches
    ...(spec.profile || {}),
  };
  // Arches flare the body outward locally rather than the whole side being one
  // width -- a muscle car and a pickup are mostly arch, and neither had any.
  const bodySec = (t) => ({
    r: round,
    shoulder: P.shoulder,
    tumble: P.tumble,
    tuck: P.tuck,
    crown: P.crown,
    edge: P.edge,
  });

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
    const base = endWidth + (1 - endWidth) * Math.sqrt(e);
    // Local flare over each axle. A muscle car and a pickup are mostly arch;
    // with one width down the whole side they were slab-sided instead.
    let fl = 0;
    if (P.flare > 0) {
      for (const wt of [rearT, frontT]) {
        const dz = Math.abs(t - wt) * L;
        if (dz < archR * 1.5) fl = Math.max(fl, P.flare * (1 - (dz / (archR * 1.5)) ** 2));
      }
    }
    return base + fl;
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
      pts: section(W * widthAt(t), Math.max(sill, archLift(t)), beltAt(t), bodySec(t)),
    });
  }
  paint.loft(bodyRings, WHITE, { capStart: true, capEnd: true });

  // --- greenhouse ----------------------------------------------------------
  const c0 = 0.5 + spec.cab[0], c1 = 0.5 + spec.cab[1];
  const gw = boxy >= 2 ? 0.985 : boxy === 1 ? 0.93 : 0.88;
  // The greenhouse leans in much harder than the body does -- that taper is
  // most of what separates a car's silhouette from a box, and it was dead
  // vertical on every vehicle in the fleet.
  const cabSec = { shoulder: 0.16, tumble: P.glassTumble, tuck: 0.03, crown: P.roofCrown, edge: 0.25, r: 0.14 };
  // Cab stations as PLAIN NUMBERS first, so the roof skin can be built from the
  // same width and height rather than measured back off a finished section.
  // Reading them back off `maxY` picked up the section's own crown and then
  // added another, which floated the roof clear of the glass as a separate
  // plank.
  const cabPlan = spec.cargo ? [
    [c0, gw * 0.94, belt - 0.02, belt + 0.06],
    [c0 + 0.02, gw, belt - 0.02, roof - 0.02],
    [c1 - 0.05, gw, belt - 0.02, roof],
    [c1 - 0.015, gw * 0.95, belt - 0.02, roof - 0.08],
    [c1, gw * 0.82, belt - 0.02, belt + 0.22],
  ] : [
    [c0, gw * 0.80, belt - 0.03, belt + 0.05],
    [c0 + (boxy ? 0.03 : 0.075), gw * 0.93, belt - 0.03, roof - 0.04],
    [c0 + 0.17, gw, belt - 0.03, roof],
    [c1 - 0.15, gw, belt - 0.03, roof],
    [c1 - (boxy ? 0.03 : 0.085), gw * 0.94, belt - 0.03, roof - 0.05],
    [c1, gw * 0.78, belt - 0.03, belt + (boxy ? 0.3 : 0.12)],
  ];
  const cabRings = cabPlan.map(([t, wf, y0, y1]) =>
    ({ z: zAt(t), pts: section(W * wf, y0, y1, cabSec) }));
  // Cars get a glass greenhouse with a painted roof skin over it. Vans, trucks
  // and buses are painted boxes with glazing cut into them instead -- lofting
  // those in glass turned the whole upper body into one dark slab.
  const glassCab = boxy < 2;
  if (glassCab) {
    trim.loft(cabRings, GLASS, { capStart: false, capEnd: false });
    // The painted roof skin is laid ON the glass's own top arc, 4 mm proud --
    // it is not a section of its own.
    //
    // Three attempts to size it independently and line it up arithmetically all
    // failed, and this is why: a `section` derives its corner radius from its
    // OWN height and width, so a 16 cm-deep skin and a 51 cm-deep greenhouse
    // taper differently even given identical y1 and width. Measured on the
    // sedan the skin was 8.8 cm wider than the glass 6 cm down from the roof,
    // which is a plank overhanging the cabin on all four sides -- exactly what
    // it looked like. Sharing the points makes the two register by
    // construction, so there is no arithmetic left to get wrong.
    const roofRows = cabRings.slice(1, -1).map(({ z, pts }) =>
      pts.slice(SEC_TOP[0], SEC_TOP[1] + 1).map(([x, y]) => [x * 1.004, y + 0.004, z]));
    if (roofRows.length > 1) paint.patch(roofRows, WHITE, [0, 1, 0]);
  } else {
    paint.loft(cabRings, WHITE, { capStart: true, capEnd: true });
    // windscreen raked into the painted cab front
    const fz = cabRings[cabRings.length - 1].z;
    const fw = maxX(cabRings[cabRings.length - 2].pts);
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
      { z: bz0, pts: section(W * 1.005, sill + 0.05, belt + spec.cargo, { r: 0.1 }) },
      { z: bz1, pts: section(W * 1.005, sill + 0.05, belt + spec.cargo, { r: 0.1 }) },
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
  const wheels = [[-wx, wr, front, wr, tw], [wx, wr, front, wr, tw], [-wx, wr, rear, wr, tw], [wx, wr, rear, wr, tw]];
  if (spec.bus || (spec.cargo && L > 7)) wheels.push([-wx, wr, rear + 1.05, wr, tw], [wx, wr, rear + 1.05, wr, tw]);
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

  return wheels;
}

/** Types with their own authored builder, keyed by `spec.hand`. */
const HAND_BUILT = {
  sports: buildSports, muscle: buildMuscle,
  sedan: buildSedan, suv: buildSuv, pickup: buildPickup,
  convertible: buildConvertible, cruiser: buildCruiser, sportbike: buildSportbike,
};

function buildType(spec) {
  const paint = new Builder(false);
  const trim = new Builder(false);
  const matte = new Builder(false);
  const build = HAND_BUILT[spec.hand] || buildGeneric;
  const wheels = build(spec, paint, trim, matte);

  const clone = (base) => {
    const b = new Builder(false);
    b.pos = base.pos.slice(); b.nor = base.nor.slice();
    b.col = base.col.slice(); b.idx = base.idx.slice();
    return b;
  };
  const trimW = clone(trim), matteW = clone(matte);
  // A wheel may declare its own outboard side; a bike's are on the centreline,
  // where `Math.sign(ax)` says nothing.
  const outOf = ([ax, , , , , o]) => (o !== undefined ? o : (Math.sign(ax) || 1));
  for (const wl of wheels) addWheel(trimW, matteW, wl[0], wl[1], wl[2], wl[3], wl[4], outOf(wl));
  // The detailed build needs a wheel geometry per distinct size AND per side:
  // the spokes and brake disc are only on the outboard face, so the left and
  // right wheels are mirror images and cannot share a buffer. Staggered tyres
  // (a wider rear than front) are what makes that worth indexing rather than
  // building one.
  const geoKey = new Map(), wheelGeos = [];
  const placed = wheels.map((wl) => {
    const [ax, ay, az, r, w] = wl;
    const out = outOf(wl);
    const k = `${r}|${w}|${out}`;
    let gi = geoKey.get(k);
    if (gi === undefined) {
      const wt = new Builder(false), wm = new Builder(false);
      addWheel(wt, wm, 0, 0, 0, r, w, out);
      gi = wheelGeos.length;
      wheelGeos.push({ trim: wt.build(), matte: wm.build() });
      geoKey.set(k, gi);
    }
    return [ax, ay, az, gi];
  });

  return {
    paintGeo: paint.build(),
    trimGeo: trim.build(),
    matteGeo: matte.build(),
    trimGeoW: trimW.build(),
    matteGeoW: matteW.build(),
    wheelGeos,
    wheels: placed,
    spec,
    wheelR: spec.wheelR,
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
    // A bike carries its rider. He goes in the tilt group, so he leans with it
    // -- parented to `group` instead he would stay bolt upright through every
    // corner while the bike went over underneath him.
    this.rider = this.spec.moto ? makeRider(this.spec.hand) : null;
    if (this.rider) this.tilt.add(this.rider.group);
    this.wheelMeshes = [];

    this.x = 0; this.y = 0; this.z = 0;
    this.heading = 0;
    this.vLong = 0; this.vLat = 0;
    this.steer = 0;
    this.pitch = 0; this.roll = 0;
    this.health = 100;
    this.dead = false;
    this.understeer = 0;   // how far past the grip limit the front tyres are
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
      for (const [wx, wy, wz, gi] of this.assets.wheels) {
        const g = new THREE.Group();
        const a = new THREE.Mesh(this.assets.wheelGeos[gi].trim, A.trimMat);
        const b = new THREE.Mesh(this.assets.wheelGeos[gi].matte, A.matteMat);
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
    // Two contact patches for a bike, four for a car -- see update() for why
    // the cross-car pair is wrong on something with no track at all.
    const two = !!this.spec.moto;
    const lh = two ? 0 : at(rx * this.halfWid, rz * this.halfWid);
    const rh = two ? 0 : at(-rx * this.halfWid, -rz * this.halfWid);
    this.pitch = Math.atan2(bh - fh, this.halfLen * 2);
    // see update(): +X is raised by +rotation.z. A parked bike stands upright.
    this.roll = two ? 0 : Math.atan2(lh - rh, this.halfWid * 2);
    // Rest on the plane through the contact patches, not on the ground under
    // the centre -- otherwise a car parked across a camber sits with one pair
    // of wheels buried and the other pair in the air.
    this.y = two ? (fh + bh) / 2 : (fh + bh + lh + rh) / 4;
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

    const top = spec.fadeTop;
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
      // Braking is per-class now. A fixed 16 m/s^2 is 1.63 g -- beyond any road
      // tyre -- and it was applied to the refuse truck and the sports car
      // alike, so every vehicle in the game stopped from 100 km/h in exactly
      // 21.6 m. `brakeA` comes from the declared 100-0 distance.
      if (this.vLong > 0.4) acc -= spec.brakeA * brake;
      else acc -= spec.acc * 0.55 * brake * (1 - clamp(-this.vLong / (top * 0.42), 0, 1));
    }
    // slope
    const gy = this.city.groundAt(this.x, this.z, this.y + 0.6, this.lift);
    const ahead = this.city.groundAt(this.x + this.forward.x * 3, this.z + this.forward.z * 3, this.y + 2.5, this.lift);
    acc -= clamp((ahead - gy) / 3, -0.7, 0.7) * 9.0;

    acc -= this.vLong * Math.abs(this.vLong) * DRAG; // aero
    acc -= this.vLong * ROLL; // rolling resistance
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

    // The friction circle. There was no lateral limit at ALL: yaw came
    // straight from the steering angle, so a bus cornered at 1.1 g and a sedan
    // at 4.4 g, and no amount of speed could ever push a car wide. Nothing in
    // the game could be taken too fast, which removes most of what driving is.
    //
    // Beyond the limit the front tyres stop turning the car and it runs wide,
    // which is understeer -- the failure a road car actually has. Braking eats
    // into the same budget, so trail-braking into a corner lets go.
    const latDemand = Math.abs(yawRate * this.vLong);
    const braking = brake > 0 && this.vLong > 0.4 ? 0.75 : 1;
    const latMax = spec.latA * braking * (hand > 0.5 ? 0.45 : 1);
    // Signed lateral acceleration the tyres are actually delivering, which is
    // what a bike leans against -- the demand before the limiter would lay one
    // flat on the road at a cornering speed it cannot hold anyway.
    let latAcc = yawRate * this.vLong;
    if (latDemand > latMax && Math.abs(this.vLong) > 1) {
      const excess = latMax / latDemand;
      // Give back the yaw the tyres cannot support.
      this.heading -= yawRate * dt * (1 - excess);
      this.understeer = clamp((latDemand / latMax - 1) * 1.6, 0, 1);
      latAcc *= excess;
    } else {
      this.understeer = 0;
    }
    this.skid = clamp(Math.max(Math.abs(before) * 0.35, this.understeer * 0.8), 0, 1);

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
    // A bike has TWO contact patches, both on the centreline. Sampling out to
    // the half-width and averaging four is right for a car straddling a road's
    // camber; on a bike those two samples are the gutter and the crown of a
    // road it is nowhere near, and the average buries it or floats it by half
    // the camber. Two samples also cost two `groundAt` calls instead of four.
    const two = !!spec.moto;
    const lh = two ? 0 : gAt(rx2 * this.halfWid, rz2 * this.halfWid);
    const rh = two ? 0 : gAt(-rx2 * this.halfWid, -rz2 * this.halfWid);

    // vertical: follow ground, with a little air time over crests
    const target = two ? (fh + bh) / 2 : (fh + bh + lh + rh) / 4;
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
    // A motorcycle leans INTO the corner instead of rolling out of it, at the
    // angle that balances it: tan(lean) = lateral acceleration / g. `rotation.z`
    // raises local +X and a positive yaw rate turns the bike toward +X, so
    // leaning in is a NEGATIVE roll -- the sign that is easiest to get
    // backwards here, and a bike leaning out of its corners is unmissable.
    // Faded out below walking pace so a parked bike stands up straight.
    const tgtRoll = two
      ? -Math.atan2(latAcc, 9.81) * clamp((sp - 0.8) / 2.5, 0, 1)
      : Math.atan2(lh - rh, this.halfWid * 2) + clamp(this.vLat, -9, 9) * 0.016;
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
