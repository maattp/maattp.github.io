// Auto KW: THE FARMSTEADS AND THE CHURCHES. What world.js draws for a box
// tools/kw/build_buildings.py calls a farm building (cls 6: a barn, an
// outbuilding, a silo or the farmhouse, in the box's roof bits) or a church
// (cls 7). Until v32 every barn was "industrial" -- tilt-up panels and
// rooftop units in a Woolwich cornfield -- every untagged barn under 460 m2
// a suburban house with a garage door and a driveway, and a church was a
// school with a steeple-less flat roof.
//
// What Waterloo Region's countryside is made of (Esri aerials round St.
// Jacobs, Conestogo, Heidelberg, Maryhill and North Dumfries; photographs of
// the Old Order farms on the Woolwich and Wellesley sideroads):
//
//   - THE BANK BARN: a fieldstone or concrete stable storey dug into a
//     slope, the timber barn over it -- red, white, grey weathered board, or
//     brown -- under a gambrel or a steep gable of galvanised steel, with an
//     earth ramp (the "barn bridge") up to the big doors on the uphill side
//     and the stable windows on the low side, ventilators on the ridge.
//     Bigger and longer ones are the modern free-stall and poultry barns:
//     low white steel walls, curtain sides, a shallow roof, a ridge vent.
//   - SILOS: concrete stave silos with their hoops and a metal dome, blue
//     Harvestores, and on the cash-crop farms corrugated grain bins.
//   - THE FARMHOUSE: two storeys of buff ("Waterloo County yellow") or red
//     brick, or white, under a steep gable with a chimney at each end, a
//     verandah on the front, and on the Mennonite farms the doddy house --
//     the smaller wing the grandparents move into -- at one end. Mennonite
//     farms have no hydro: a windmill pumps the water, and the washing hangs
//     on a line (dark blue, purple, black) out the back.
//   - DRIVE SHEDS: long low steel sheds, open bays on the yard side or big
//     sliding doors; small board sheds; the odd white fabric coverall.
//   - CHURCHES: a nave under a steep roof with lancet windows down its sides,
//     and at the end toward the street a square tower, its belfry louvred,
//     carrying a spire -- the white or brick steeple that is every
//     village's skyline. Red brick, buff brick, Grand River limestone, white
//     clapboard on the small country ones.
//
// Everything goes into the chunk's existing builders (the textured facade and
// the vertex-coloured `flat`): no new materials, no new draws.

import { hash2, clamp } from './util.js';
import * as G from './geo.js';
import { mennoniteCountry } from './rural.js';

const ZU = [0, 0, 0, 0, 0, 0, 0, 0];
/** sRGB -> the linear values vertex colours are. */
const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
// the vertex colour that makes the facade atlas's industrial cell (its mean,
// world.js CELL_MEAN) come out as the sRGB colour c: per channel, or its
// blue-grey cast turns every red barn plum and every grey one green
const IND_MEAN = [0.29, 0.316, 0.333];
const ind = (c) => { const l = lin(c); return [l[0] / IND_MEAN[0], l[1] / IND_MEAN[1], l[2] / IND_MEAN[2]]; };
const pick = (list, u) => {
  let acc = 0;
  for (const [w, c] of list) { acc += w; if (u <= acc) return c; }
  return list[list.length - 1][1];
};

/** What was built, for the harnesses (window.__farmstead). */
export const FARM_STATS = { windmills: 0, laundry: 0 };
if (typeof window !== 'undefined') window.__farmstead = FARM_STATS;

export const FARM_STYLES = new Set(['barn', 'shed', 'silo', 'farmhouse', 'church']);
const FARM_SUB = ['barn', 'shed', 'silo', 'farmhouse'];

/** citygen: the style of a cls-6 box from its sub-kind (the roof bits). */
export function farmStyle(sub) { return FARM_SUB[sub & 3]; }

// --- proportions, shared by the mesher and the box's height ------------------------

const FOUND = 2.5;          // a bank barn's stone stable storey
function barnSpec(bd) {
  const hl = Math.max(bd.w, bd.d) / 2, hs = Math.min(bd.w, bd.d) / 2;
  const A = bd.w * bd.d, seed = bd.seed;
  const modern = A > 1500 || (hl / hs > 3.0 && A > 500);
  if (modern) {
    const wall = 3.8 + Math.min(1.2, hs * 0.05);
    return { modern: true, hl, hs, eave: wall, rise: clamp(hs * 0.26, 1.2, 4.2) };
  }
  const gambrel = hash2(seed, 601) < 0.42 && hs >= 5;
  const wood = 4.2 + Math.min(1.6, hs * 0.1);
  return { modern: false, gambrel, hl, hs, eave: FOUND + wood, rise: gambrel ? hs * 0.86 : hs * 0.78 };
}
function siloSpec(bd) {
  const r = clamp(Math.min(bd.w, bd.d) / 2, 2.2, 7.5), seed = bd.seed;
  const u = hash2(seed, 611);
  if (r >= 4.2) return { kind: 'bin', r, h: clamp(r * 1.25, 6, 12), cap: r * 0.42 };
  const kind = u < 0.58 ? 'stave' : u < 0.88 ? 'harvestore' : 'bare';
  const h = (kind === 'harvestore' ? 19 : 15) + hash2(seed, 612) * 7;
  return { kind, r, h, cap: kind === 'bare' ? 0 : r * 0.55 };
}
function shedSpec(bd) {
  const hl = Math.max(bd.w, bd.d) / 2, hs = Math.min(bd.w, bd.d) / 2, A = bd.w * bd.d;
  if (A < 75) return { small: true, hl, hs, eave: 2.7, rise: hs * 0.6 };
  const hoop = A < 320 && hash2(bd.seed, 621) < 0.07;
  return { small: false, hoop, hl, hs, eave: hoop ? 0 : 4.4, rise: hoop ? hs * 0.95 : clamp(hs * 0.24, 0.8, 2.6) };
}
function houseSpec(bd) {
  const hl = Math.max(bd.w, bd.d) / 2, hs = Math.min(bd.w, bd.d) / 2;
  // a doddy house: the main block square-ish, the rest of the footprint a
  // lower wing at one end
  const doddy = hl * 2 >= 13 && hl / hs >= 1.45;
  const mainL = doddy ? Math.min(hl * 2 - 4.2, hs * 2 * 1.3) : hl * 2;
  return { hl, hs, doddy, mainL, eave: 6.1, rise: clamp(hs * 0.82, 2.6, 5.4) };
}

/** citygen: the height of a farm box (its collision and the far massing) from what will be drawn. */
export function farmHeight(style, bd) {
  if (style === 'barn') { const s = barnSpec(bd); return s.eave + s.rise; }
  if (style === 'silo') { const s = siloSpec(bd); return s.h + s.cap * 0.5; }
  if (style === 'shed') { const s = shedSpec(bd); return s.eave + s.rise * 0.6; }
  if (style === 'farmhouse') { const s = houseSpec(bd); return s.eave + s.rise * 0.5; }
  return bd.h;
}

/** world.massColour for the far rings: the wall a farm box or a church reads as. */
export function farmMass(bd) {
  if (bd.style === 'barn') return barnSpec(bd).modern ? lin([0.80, 0.80, 0.78]) : lin(barnWall(bd));
  if (bd.style === 'silo') return lin(siloWall(siloSpec(bd)));
  if (bd.style === 'shed') return lin([0.66, 0.66, 0.64]);
  if (bd.style === 'farmhouse') return lin(houseWallC(bd)[0]);
  return lin(churchWall(bd));
}

// --- the local frame: u along the box's long side, v across ------------------------

function frame(bd) {
  const cs = Math.cos(bd.rot), sn = Math.sin(bd.rot);
  const alongX = bd.w >= bd.d;
  const P = (u, v, y) => {
    const lx = alongX ? u : v, lz = alongX ? v : u;
    return [bd.x + lx * cs - lz * sn, y, bd.z + lx * sn + lz * cs];
  };
  const N = (nu, ny, nv) => {
    const lx = alongX ? nu : nv, lz = alongX ? nv : nu;
    return [lx * cs - lz * sn, ny, lx * sn + lz * cs];
  };
  // a Builder.box rotation whose local x runs along u (its local z is then -v or v: boxes here are symmetric in v)
  const rotU = alongX ? bd.rot : bd.rot + Math.PI / 2;
  return { P, N, rotU };
}

/** A quad with its normal from its corners, turned to agree with `hint`. */
function face(B, a, b, c, d, hint, col) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
  B.quad(a, b, c, d, [nx, ny, nz], ZU, col);
}
function tri(B, a, b, c, hint, col) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
  B.tri(a, b, c, [nx, ny, nz], col);
}

/**
 * A roof over the u-run [u0, u1] whose cross-section is `prof` -- [v, y]
 * pairs from the eave (v > 0) to the ridge (v = 0) -- mirrored about v = 0,
 * with the gable ends filled in `gable` (null: open, something else fills
 * them). Underside drawn darker for the overhang.
 */
function profRoof(B, F, u0, u1, prof, roofc, gable, ov = 0.35) {
  const dark = mul(roofc, 0.55);
  for (const s of [-1, 1]) {
    for (let k = 0; k + 1 < prof.length; k++) {
      const [v0, y0] = prof[k], [v1, y1] = prof[k + 1];
      const a = F.P(u0 - ov, s * v0, y0), b = F.P(u1 + ov, s * v0, y0), c = F.P(u1 + ov, s * v1, y1), d = F.P(u0 - ov, s * v1, y1);
      const hn = F.N(0, 1, s * 0.6);
      face(B, a, b, c, d, hn, k % 2 ? mul(roofc, 0.92) : roofc);
      if (k === 0) face(B, a, b, c, d, [-hn[0], -1, -hn[2]], dark);
    }
  }
  if (!gable) return;
  for (const e of [u0, u1]) {
    const hn = F.N(e < (u0 + u1) / 2 ? -1 : 1, 0, 0);
    for (let k = 0; k + 1 < prof.length; k++) {
      const [v0, y0] = prof[k], [v1, y1] = prof[k + 1];
      if (v1 > 0.01) face(B, F.P(e, -v0, y0), F.P(e, v0, y0), F.P(e, v1, y1), F.P(e, -v1, y1), hn, gable);
      else tri(B, F.P(e, -v0, y0), F.P(e, v0, y0), F.P(e, 0, y1), hn, gable);
    }
  }
}

/** A wall quad on the u-face at u = e (s = +-1 out), across v0..v1, y0..y1, `off` proud. */
function endRect(B, F, e, s, v0, v1, y0, y1, col, off = 0.04) {
  const u = e + s * off;
  face(B, F.P(u, v0, y0), F.P(u, v1, y0), F.P(u, v1, y1), F.P(u, v0, y1), F.N(s, 0, 0), col);
}
/** A wall quad on the v-face at v = e (s = +-1 out), along u0..u1. */
function sideRect(B, F, e, s, u0, u1, y0, y1, col, off = 0.04) {
  const v = e + s * off;
  face(B, F.P(u0, v, y0), F.P(u1, v, y0), F.P(u1, v, y1), F.P(u0, v, y1), F.N(0, 0, s), col);
}

/** The lowest terrain under the box's corners (walls reach down to it). */
function lowGround(bd) {
  let lo = bd.y;
  const cs = Math.cos(bd.rot), sn = Math.sin(bd.rot);
  for (const [fx, fz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = fx * bd.w / 2, lz = fz * bd.d / 2;
    const x = bd.x + lx * cs - lz * sn, z = bd.z + lx * sn + lz * cs;
    if (G.isWater(x, z)) continue;
    lo = Math.min(lo, G.terrainHeight(x, z));
  }
  return lo;
}

/** Is (x, z) free ground for a prop: no road, no ditch or lane, no other building. */
function clear(city, x, z, r, self) {
  if (city.onRoad(x, z, r + 1, false)) return false;
  if (city.ruralClear && city.ruralClear(x, z)) return false;
  if (G.isWater(x, z)) return false;
  for (const o of city.buildingsNear(x, z, r + 30)) {
    if (o === self || o.h <= 0) continue;
    const c = Math.cos(-o.rot), s = Math.sin(-o.rot), dx = x - o.x, dz = z - o.z;
    if (Math.abs(dx * c - dz * s) < o.w / 2 + r && Math.abs(dx * s + dz * c) < o.d / 2 + r) return false;
  }
  return true;
}

/** The nearest street to (x, z) within r: its distance, or Infinity. */
function streetDist(city, x, z, r) {
  let best = Infinity;
  for (const ei of city.edgesNear(x, z, r)) {
    const e = city.edges[ei];
    if (e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp') continue;
    const a = city.nodes[e.a];
    const t = clamp((x - a.x) * e.dx + (z - a.z) * e.dz, 0, e.len);
    const d = Math.hypot(x - a.x - e.dx * t, z - a.z - e.dz * t) - e.hw;
    if (d < best) best = d;
  }
  return best;
}
/** Which way a box's front faces: [su, sv] with one of them +-1 -- the side nearest a street. */
function frontSide(city, bd, F, ends = false) {
  const hl = Math.max(bd.w, bd.d) / 2, hs = Math.min(bd.w, bd.d) / 2;
  const sides = ends ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1], [1, 0], [-1, 0]];
  let best = sides[0], bd0 = Infinity;
  for (const [su, sv] of sides) {
    const p = F.P(su * (hl + 6), sv * (hs + 6), 0);
    const d = streetDist(city, p[0], p[2], 140);
    if (d < bd0 - 0.5) { bd0 = d; best = [su, sv]; }
  }
  return best;
}

// --- barns ---------------------------------------------------------------------------

const BARN_WOOD = [
  [0.46, [0.56, 0.17, 0.13]],   // barn red
  [0.24, [0.90, 0.89, 0.85]],   // white
  [0.18, [0.56, 0.54, 0.50]],   // weathered grey board
  [0.12, [0.47, 0.35, 0.25]],   // brown
];
const ROOF_STEEL = [
  [0.55, [0.66, 0.68, 0.70]],   // galvanised
  [0.18, [0.30, 0.31, 0.33]],   // charcoal
  [0.12, [0.45, 0.17, 0.14]],   // red
  [0.10, [0.26, 0.33, 0.28]],   // green
  [0.05, [0.30, 0.25, 0.20]],   // old shingle
];
function barnWall(bd) { return pick(BARN_WOOD, hash2(bd.seed, 602)); }
const STONE = [0.60, 0.56, 0.49];

function meshBarn(W, bl, flat, bd) {
  const C = W.cells, F = frame(bd), S = barnSpec(bd), seed = bd.seed;
  const { hl, hs } = S;
  const lo = lowGround(bd) - 0.4;
  const y0 = bd.y;
  if (S.modern) {
    // the modern barn: concrete curb, white steel to a low eave, curtain sides, shallow roof, ridge vent
    const wallc = pick([[0.6, [0.92, 0.92, 0.90]], [0.25, [0.80, 0.80, 0.78]], [0.15, [0.84, 0.78, 0.66]]], hash2(seed, 603));
    flat.box(bd.x, lo, bd.z, hl * 2 + 0.1, y0 + 0.9 - lo, hs * 2 + 0.1, F.rotU, lin([0.62, 0.61, 0.58]), { top: false });
    bl.facade.box(bd.x, y0 + 0.9, bd.z, hl * 2, S.eave - 0.9, hs * 2, F.rotU, ind(wallc),
      { top: false, uScale: 9, vScale: 9, vOff: 0.55, cell: C.industrial });
    const curtain = hash2(seed, 604) < 0.7;
    if (curtain) for (const s of [-1, 1]) sideRect(flat, F, hs, s, -hl + 1.2, hl - 1.2, y0 + 1.2, y0 + S.eave - 0.6, lin([0.70, 0.68, 0.56]), 0.05);
    const roofc = lin(hash2(seed, 605) < 0.6 ? [0.86, 0.87, 0.86] : [0.62, 0.64, 0.66]);
    const e = y0 + S.eave;
    profRoof(flat, F, -hl, hl, [[hs + 0.5, e - 0.13], [0, e + S.rise]], roofc, lin(wallc), 0.5);
    // the ridge vent
    flat.box(bd.x, e + S.rise - 0.1, bd.z, hl * 2 - 2, 0.5, 1.4, F.rotU, mul(roofc, 0.8));
    // fans in the gable ends of the poultry and hog barns
    if (!curtain) for (const s of [-1, 1]) for (let v = -hs + 1.6; v < hs - 1.2; v += 2.4) {
      const c = F.P(s * (hl + 0.05), v, y0 + 1.6);
      endRect(flat, F, s * hl, s, v - 0.6, v + 0.6, y0 + 1.0, y0 + 2.2, lin([0.16, 0.16, 0.17]), 0.06);
      void c;
    }
    return;
  }
  // THE BANK BARN. The ramp side is the uphill long side.
  const pa = F.P(0, hs + 6, 0), pb = F.P(0, -hs - 6, 0);
  const ramp = G.terrainHeight(pa[0], pa[2]) >= G.terrainHeight(pb[0], pb[2]) ? 1 : -1;
  const wood = barnWall(bd);
  const white = wood[0] > 0.8;
  const roofc = lin(pick(ROOF_STEEL, hash2(seed, 606)));
  const floor = y0 + FOUND;
  // the stone stable storey (the ground floor of a bank barn), its mortar a little lighter at the top
  const stone = lin(hash2(seed, 607) < 0.6 ? STONE : [0.68, 0.67, 0.64]);
  flat.box(bd.x, lo, bd.z, hl * 2, floor - lo, hs * 2, F.rotU, stone, { top: false, ao: 0.25 });
  // the timber barn over it
  const eave = y0 + S.eave;
  bl.facade.box(bd.x, floor, bd.z, hl * 2, eave - floor, hs * 2, F.rotU, ind(wood),
    { top: false, uScale: 5.5, vScale: 6.5, vOff: 0.34, cell: C.industrial });
  const gable = mul(lin(wood), 0.93);
  const trimc = lin(white ? [0.40, 0.14, 0.11] : [0.92, 0.91, 0.88]);
  // the roof: a gambrel (a steep lower pitch and a shallow upper one), or a steep gable
  const prof = S.gambrel
    ? [[hs + 0.45, eave - 0.3], [hs * 0.58, eave + hs * 0.62], [0, eave + S.rise]]
    : [[hs + 0.45, eave - 0.35], [0, eave + S.rise]];
  profRoof(flat, F, -hl, hl, prof, roofc, gable, 0.45);
  // fascia trim along the eaves
  for (const s of [-1, 1]) sideRect(flat, F, hs, s, -hl, hl, eave - 0.32, eave, trimc, 0.06);
  // ventilators on the ridge
  const nv = hl > 14 ? 2 : 1;
  for (let i = 0; i < nv; i++) {
    const u = nv === 1 ? 0 : (i ? 1 : -1) * hl * 0.45;
    const p = F.P(u, 0, eave + S.rise - 0.2);
    flat.box(p[0], p[1], p[2], 1.3, 1.1, 1.3, F.rotU, lin(white ? [0.9, 0.9, 0.88] : [0.70, 0.71, 0.72]));
    flat.cone(p[0], p[1] + 1.1, p[2], 1.05, 0.8, 4, roofc);
  }
  // the barn bridge: an earth ramp up to the big doors in the middle of the ramp side
  const dw = Math.min(4.2, hl * 0.4), rl = 7.5;
  const ru = (hash2(seed, 608) - 0.5) * Math.max(0, hl - dw - 3);
  const g0 = F.P(ru, ramp * (hs + rl), 0), gy = G.terrainHeight(g0[0], g0[2]);
  if (floor - gy > 0.5) {
    const earth = lin([0.42, 0.40, 0.29]), side = lin([0.36, 0.33, 0.26]);
    const A0 = F.P(ru - dw / 2 - 0.6, ramp * hs, floor + 0.02), A1 = F.P(ru + dw / 2 + 0.6, ramp * hs, floor + 0.02);
    const B1 = F.P(ru + dw / 2 + 0.6, ramp * (hs + rl), gy - 0.1), B0 = F.P(ru - dw / 2 - 0.6, ramp * (hs + rl), gy - 0.1);
    face(flat, A0, A1, B1, B0, [0, 1, 0], earth);
    for (const s of [-1, 1]) {
      const uu = ru + s * (dw / 2 + 0.6);
      tri(flat, F.P(uu, ramp * hs, floor + 0.02), F.P(uu, ramp * (hs + rl), gy - 0.1), F.P(uu, ramp * hs, gy - 0.6), F.N(s, 0, 0), side);
    }
  }
  // the big doors (sliding, on the ramp side), with a white X on a red barn
  const dark = mul(lin(wood), 0.55);
  sideRect(flat, F, hs, ramp, ru - dw / 2, ru + dw / 2, floor, floor + 4.0, dark, 0.05);
  if (!white) {
    for (const k of [-1, 1]) {
      const a = F.P(ru - dw / 2, ramp * (hs + 0.08), floor + 0.1), b = F.P(ru + dw / 2, ramp * (hs + 0.08), floor + 3.9);
      if (k > 0) flat.tube(a, b, 0.07, 4, trimc);
      else flat.tube(F.P(ru + dw / 2, ramp * (hs + 0.08), floor + 0.1), F.P(ru - dw / 2, ramp * (hs + 0.08), floor + 3.9), 0.07, 4, trimc);
    }
  }
  sideRect(flat, F, hs, ramp, ru - dw / 2 - 0.15, ru + dw / 2 + 0.15, floor + 4.0, floor + 4.25, trimc, 0.07);
  // the stable side: a row of small windows and a door or two in the stone
  const low = -ramp;
  const glass = lin([0.12, 0.13, 0.14]);
  for (let u = -hl + 2.2; u < hl - 1.6; u += 3.2) {
    sideRect(flat, F, hs, low, u - 0.45, u + 0.45, y0 + 0.9, y0 + 1.65, glass, 0.05);
  }
  for (const u of [-hl * 0.5, hl * 0.35]) sideRect(flat, F, hs, low, u - 0.7, u + 0.7, y0 - 0.2, y0 + 2.2, mul(lin(wood), 0.7), 0.06);
  // hay door high in a gable end
  const he = hash2(seed, 609) < 0.5 ? 1 : -1;
  endRect(flat, F, hl, he, -1.1, 1.1, eave - 1.2, eave + 1.3, dark, 0.05);
}

// --- silos ------------------------------------------------------------------------------

function siloWall(S) {
  return S.kind === 'harvestore' ? [0.13, 0.20, 0.36] : S.kind === 'bin' ? [0.74, 0.75, 0.76]
    : S.kind === 'bare' ? [0.66, 0.65, 0.61] : [0.74, 0.73, 0.69];
}
function meshSilo(W, bl, flat, bd) {
  const S = siloSpec(bd), seed = bd.seed;
  const lo = lowGround(bd) - 0.5;
  const y0 = bd.y, n = S.kind === 'bin' ? 16 : 12;
  const wall = lin(siloWall(S)), top = y0 + S.h;
  flat.prism(bd.x, lo, bd.z, S.r, top - lo, n, wall);
  // the hoops of a stave silo, the rings of a bin's corrugation
  const ring = S.kind === 'harvestore' ? null : mul(wall, S.kind === 'bin' ? 0.82 : 0.7);
  if (ring) {
    const step = S.kind === 'bin' ? 0.9 : 1.6;
    for (let y = y0 + step; y < top - 0.4; y += step) flat.prism(bd.x, y, bd.z, S.r + 0.04, 0.07, n, ring);
  } else {
    // a Harvestore's white band and its name panel under the dome
    flat.prism(bd.x, top - 1.1, bd.z, S.r + 0.03, 0.55, n, lin([0.88, 0.88, 0.86]));
  }
  if (S.cap > 0) {
    const roofc = lin(S.kind === 'harvestore' ? [0.70, 0.72, 0.74] : [0.62, 0.63, 0.64]);
    if (S.kind === 'bin') {
      flat.cone(bd.x, top, bd.z, S.r + 0.25, S.cap, n, roofc);
      flat.prism(bd.x, top + S.cap - 0.1, bd.z, 0.55, 0.45, 6, roofc);
    } else {
      // a dome: two stacked cones
      flat.prism(bd.x, top, bd.z, S.r + 0.08, 0.3, n, roofc);
      flat.cone(bd.x, top + 0.3, bd.z, S.r + 0.08, S.cap * 0.55, n, roofc);
      flat.cone(bd.x, top + 0.3 + S.cap * 0.45, bd.z, S.r * 0.55, S.cap * 0.55, n, mul(roofc, 1.05));
    }
  }
  // the unloading chute / ladder cage up one side of a stave silo
  if (S.kind === 'stave' || S.kind === 'bare') {
    const a = hash2(seed, 613) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
    flat.box(bd.x + cx * (S.r + 0.45), y0 - 0.2, bd.z + cz * (S.r + 0.45), 0.9, S.h - 0.2, 0.9, a, lin([0.62, 0.62, 0.60]));
  }
}

// --- sheds ------------------------------------------------------------------------------

const SHED_STEEL = [
  [0.30, [0.90, 0.90, 0.88]], [0.25, [0.62, 0.64, 0.66]], [0.18, [0.29, 0.40, 0.29]],
  [0.15, [0.76, 0.68, 0.54]], [0.12, [0.55, 0.17, 0.13]],
];
function meshShed(W, bl, flat, bd) {
  const C = W.cells, F = frame(bd), S = shedSpec(bd), seed = bd.seed;
  const { hl, hs } = S;
  const lo = lowGround(bd) - 0.3, y0 = bd.y;
  if (S.hoop) {
    // a white fabric coverall over a low block wall
    const k = 8, fab = lin([0.92, 0.92, 0.90]);
    flat.box(bd.x, lo, bd.z, hl * 2, y0 + 0.8 - lo, hs * 2, F.rotU, lin([0.60, 0.59, 0.56]), { top: false });
    for (let i = 0; i < k; i++) {
      const a0 = Math.PI * i / k, a1 = Math.PI * (i + 1) / k;
      const v0 = Math.cos(a0) * hs, v1 = Math.cos(a1) * hs, h0 = y0 + 0.8 + Math.sin(a0) * S.rise, h1 = y0 + 0.8 + Math.sin(a1) * S.rise;
      face(flat, F.P(-hl, v0, h0), F.P(hl, v0, h0), F.P(hl, v1, h1), F.P(-hl, v1, h1), F.N(0, Math.sin((a0 + a1) / 2), Math.cos((a0 + a1) / 2)), fab);
      for (const s of [-1, 1]) tri(flat, F.P(s * hl, 0, y0 + 0.8), F.P(s * hl, v0, h0), F.P(s * hl, v1, h1), F.N(s, 0, 0), mul(fab, 0.85));
    }
    return;
  }
  const wallc = S.small ? pick(BARN_WOOD, hash2(seed, 622)) : pick(SHED_STEEL, hash2(seed, 623));
  const eave = y0 + S.eave;
  flat.box(bd.x, lo, bd.z, hl * 2 + 0.06, y0 + 0.3 - lo, hs * 2 + 0.06, F.rotU, lin([0.58, 0.57, 0.54]), { top: false });
  bl.facade.box(bd.x, y0 + 0.3, bd.z, hl * 2, eave - y0 - 0.3, hs * 2, F.rotU, ind(wallc),
    { top: false, uScale: S.small ? 4 : 7, vScale: 7, vOff: 0.4, cell: C.industrial });
  const roofc = lin(pick(ROOF_STEEL, hash2(seed, 624)));
  profRoof(flat, F, -hl, hl, [[hs + 0.4, eave - 0.1], [0, eave + S.rise]], roofc, mul(lin(wallc), 0.92), 0.4);
  // the doors: open bays along the yard side of a drive shed, or a big slider
  const fs = frontSide(W.city, bd, F);
  const dark = lin([0.07, 0.07, 0.07]);
  if (S.small) {
    if (fs[0]) endRect(flat, F, hl, fs[0], -0.6, 0.6, y0, y0 + 2.0, mul(lin(wallc), 0.55));
    else sideRect(flat, F, hs, fs[1], -0.6, 0.6, y0, y0 + 2.0, mul(lin(wallc), 0.55));
    return;
  }
  const sv = fs[1] || (hash2(seed, 625) < 0.5 ? 1 : -1);
  if (hash2(seed, 626) < 0.55 && hl > 6) {
    const nb = Math.max(2, Math.round(hl * 2 / 5.5)), bw = hl * 2 / nb;
    for (let i = 0; i < nb; i++) sideRect(flat, F, hs, sv, -hl + i * bw + 0.25, -hl + (i + 1) * bw - 0.25, y0, eave - 0.5, dark, 0.05);
  } else {
    const dw = Math.min(hl * 0.8, 5);
    sideRect(flat, F, hs, sv, -dw, dw, y0, eave - 0.6, mul(lin(wallc), 0.62), 0.05);
  }
}

// --- the farmhouse --------------------------------------------------------------------------

const FH_WALL = [
  [0.40, [0.88, 0.78, 0.56], 'brick'],    // buff, "Waterloo County yellow brick"
  [0.24, [0.66, 0.30, 0.22], 'brick'],    // red brick
  [0.30, [0.93, 0.92, 0.89], 'siding'],   // white
  [0.06, [0.80, 0.80, 0.76], 'siding'],   // grey-white board
];
function houseWallC(bd) {
  const mat = (bd.look || 0) >> 2 & 7;
  if (mat === 1) return [[0.66, 0.30, 0.22], 'brick'];
  if (mat === 2) return [[0.88, 0.78, 0.56], 'brick'];
  if (mat === 4 || mat === 5) return [[0.93, 0.92, 0.89], 'siding'];
  let acc = 0;
  const u = hash2(bd.seed, 631);
  for (const [w, c, k] of FH_WALL) { acc += w; if (u <= acc) return [c, k]; }
  return [FH_WALL[0][1], FH_WALL[0][2]];
}
const FH_ROOF = [[0.4, [0.30, 0.30, 0.32]], [0.25, [0.62, 0.64, 0.66]], [0.15, [0.20, 0.24, 0.22]], [0.2, [0.40, 0.36, 0.33]]];

function meshFarmhouse(W, bl, flat, bd) {
  const C = W.cells, F = frame(bd), S = houseSpec(bd), seed = bd.seed, city = W.city;
  const { hl, hs } = S;
  const lo = lowGround(bd) - 0.4, y0 = bd.y;
  const [wc, kind] = houseWallC(bd);
  const cell = kind === 'brick' ? C.brickhouse : C.house;
  const mean = kind === 'brick' ? [0.54, 0.5, 0.46] : [0.608, 0.579, 0.522];
  const wcol = [Math.pow(wc[0], 2.2) / mean[0], Math.pow(wc[1], 2.2) / mean[1], Math.pow(wc[2], 2.2) / mean[2]];
  const flatWall = lin(wc);
  const roofc = lin(pick(FH_ROOF, hash2(seed, 632)));
  const trim = lin([0.93, 0.92, 0.89]);
  // which end the doddy house is on, and the front (toward the road)
  const de = hash2(seed, 633) < 0.5 ? 1 : -1;
  const fs = frontSide(city, bd, F);
  const fv = fs[1] || 1;
  const mainC = S.doddy ? -de * (hl * 2 - S.mainL) / 2 : 0;   // the main block's centre along u
  const mh = S.mainL / 2;
  const blocks = [{ c: mainC, h: mh, w: hs, eave: S.eave, rise: S.rise }];
  if (S.doddy) {
    const dl = hl * 2 - S.mainL;
    // the wing flush with the back wall, narrower, a storey and a half
    blocks.push({ c: de * (hl - dl / 2), h: dl / 2, w: hs * 0.78, eave: 3.9, rise: clamp(hs * 0.78 * 0.8, 2, 4), off: -fv * hs * 0.22 });
  }
  for (const b of blocks) {
    const off = b.off || 0;
    const cP = F.P(b.c, off, 0);
    flat.box(cP[0], lo, cP[2], b.h * 2 + 0.12, y0 + 0.35 - lo, b.w * 2 + 0.12, F.rotU, lin([0.55, 0.54, 0.51]), { top: false });
    bl.facade.box(cP[0], y0 + 0.3, cP[2], b.h * 2, b.eave - 0.3, b.w * 2, F.rotU, wcol,
      { top: false, uScale: 10, uFit: true, vScale: 0, ao: 0.15, cell });
    const e = y0 + b.eave;
    // a steep gable, its ridge along the block, with the gable ends in the wall colour
    const Fb = { P: (u, v, y) => F.P(b.c + u, off + v, y), N: F.N };
    profRoof(flat, Fb, -b.h, b.h, [[b.w + 0.4, e - 0.25], [0, e + b.rise]], roofc, flatWall, 0.35);
    // fascia
    for (const s of [-1, 1]) sideRect(flat, Fb, b.w, s, -b.h, b.h, e - 0.3, e, trim, 0.05);
  }
  // a chimney at each end of the main block
  for (const s of [-1, 1]) {
    if (S.doddy && s === de) continue;
    const p = F.P(mainC + s * (mh - 0.6), 0, 0);
    flat.box(p[0], y0 + S.eave + S.rise * 0.6, p[2], 0.7, S.rise * 0.4 + 1.2, 0.9, F.rotU, lin([0.55, 0.30, 0.22]));
  }
  // the verandah along the front of the main block
  if (fs[1] || hash2(seed, 634) < 0.6) {
    const pw = Math.min(S.mainL - 1.0, 11), pd = 2.3, py = y0 + 0.25;
    const c0 = F.P(mainC, fv * (hs + pd / 2), 0);
    if (!city.onRoad(c0[0], c0[2], 1, false)) {
      flat.box(c0[0], py - 0.3, c0[2], pw, 0.45, pd, F.rotU, lin([0.55, 0.52, 0.47]));
      for (let k = 0; k <= 4; k++) {
        const p = F.P(mainC - pw / 2 + 0.2 + (pw - 0.4) * k / 4, fv * (hs + pd - 0.2), 0);
        flat.box(p[0], py + 0.15, p[2], 0.16, 2.55, 0.16, F.rotU, trim);
      }
      // the shed roof sloping off the wall
      const a = F.P(mainC - pw / 2 - 0.2, fv * hs, py + 3.1), b = F.P(mainC + pw / 2 + 0.2, fv * hs, py + 3.1);
      const c = F.P(mainC + pw / 2 + 0.2, fv * (hs + pd + 0.3), py + 2.6), d = F.P(mainC - pw / 2 - 0.2, fv * (hs + pd + 0.3), py + 2.6);
      face(flat, a, b, c, d, F.N(0, 1, fv * 0.3), roofc);
      face(flat, a, b, c, d, F.N(0, -1, 0), mul(trim, 0.8));
    }
  }
  if (!mennoniteCountry(bd.x, bd.z)) return;
  // THE MENNONITE FARM: no hydro, so a windmill pumps the well; the washing on the line out back
  if (hash2(seed, 635) < 0.6) {
    for (const t of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const p = F.P(t[0] * (hl + 14), -fv * t[1] * (hs + 10), 0);
      if (!clear(city, p[0], p[2], 3, bd)) continue;
      windmill(flat, p[0], G.terrainHeight(p[0], p[2]), p[2], hash2(seed, 636) * Math.PI * 2);
      FARM_STATS.windmills++;
      break;
    }
  }
  if (hash2(seed, 637) < 0.75) {
    // from the back corner of the house out to a pole, 16 m
    const s = -de;
    const a = F.P(s * hl * 0.7, -fv * (hs + 0.4), 0), b = F.P(s * (hl * 0.7 + 3), -fv * (hs + 15), 0);
    if (clear(city, b[0], b[2], 1.5, bd) && clear(city, (a[0] + b[0]) / 2, (a[2] + b[2]) / 2, 1, bd)) {
      laundry(flat, a, b, seed);
      FARM_STATS.laundry++;
    }
  }
}

/** An Aermotor-style steel windmill: a four-legged lattice tower, the wheel and the tail vane. */
function windmill(flat, x, y, z, yaw) {
  const H = 11.5, steel = lin([0.62, 0.63, 0.64]), dk = lin([0.36, 0.37, 0.38]);
  const b = 1.6, t = 0.35;
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of legs) flat.tube([x + sx * b, y - 0.3, z + sz * b], [x + sx * t, y + H, z + sz * t], 0.06, 3, steel);
  for (let k = 1; k <= 3; k++) {
    const yy = y + H * k / 4, r = b + (t - b) * k / 4;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i], [bx, bz] = legs[(i + 1) % 4];
      flat.tube([x + ax * r, yy, z + az * r], [x + bx * r, yy, z + bz * r], 0.035, 3, steel);
    }
  }
  // the head, the wheel (a ring of 18 blades as one fan of tris) and the vane
  const ux = Math.cos(yaw), uz = Math.sin(yaw);
  const hx = x + ux * 0.5, hz = z + uz * 0.5, hy = y + H + 0.6;
  flat.box(x, y + H, z, 0.5, 0.8, 0.5, yaw, dk);
  const R = 1.9, n = 18;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = a0 + (Math.PI * 2 / n) * 0.62;
    const p = (a, r) => [hx - uz * Math.cos(a) * r, hy + Math.sin(a) * r, hz + ux * Math.cos(a) * r];
    const nrm = [ux, 0, uz];
    flat.quad(p(a0, 0.45), p(a1, 0.45), p(a1, R), p(a0, R), nrm, ZU, steel);
    flat.quad(p(a0, 0.45), p(a1, 0.45), p(a1, R), p(a0, R), [-ux, 0, -uz], ZU, dk);
  }
  flat.tube([hx, hy, hz], [x - ux * 2.6, hy + 0.1, z - uz * 2.6], 0.05, 3, dk);
  const vx = x - ux * 2.6, vz = z - uz * 2.6;
  flat.quad([vx, hy - 0.5, vz], [vx - ux * 1.4, hy - 0.4, vz - uz * 1.4], [vx - ux * 1.4, hy + 0.6, vz - uz * 1.4], [vx, hy + 0.7, vz], [-uz, 0, ux], ZU, steel);
  flat.quad([vx, hy - 0.5, vz], [vx - ux * 1.4, hy - 0.4, vz - uz * 1.4], [vx - ux * 1.4, hy + 0.6, vz - uz * 1.4], [vx, hy + 0.7, vz], [uz, 0, -ux], ZU, steel);
}

/** A washing line on a pulley from the house to a pole: the plain dress's colours. */
const WASH = [[0.10, 0.13, 0.32], [0.28, 0.12, 0.34], [0.06, 0.06, 0.07], [0.88, 0.88, 0.86], [0.16, 0.26, 0.42], [0.30, 0.20, 0.14], [0.22, 0.32, 0.30]];
function laundry(flat, a, b, seed) {
  const ya = G.terrainHeight(a[0], a[2]), yb = G.terrainHeight(b[0], b[2]);
  const pole = lin([0.45, 0.40, 0.33]);
  flat.box(b[0], yb - 0.3, b[2], 0.14, 4.6, 0.14, 0, pole);
  const A = [a[0], ya + 3.6, a[2]], Bq = [b[0], yb + 4.1, b[2]];
  flat.tube(A, Bq, 0.015, 3, lin([0.8, 0.8, 0.8]));
  const dx = Bq[0] - A[0], dz = Bq[2] - A[2], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  const n = Math.floor((L - 2) / 0.95);
  for (let i = 0; i < n; i++) {
    const t = (1.2 + i * 0.95) / L;
    const sag = Math.sin(t * Math.PI) * 0.35;
    const x = A[0] + dx * t, z = A[2] + dz * t, y = A[1] + (Bq[1] - A[1]) * t - sag;
    const c = lin(WASH[Math.floor(hash2(seed + i, 638) * WASH.length)]);
    const w = 0.35 + hash2(seed + i, 639) * 0.12, h = 0.6 + hash2(seed + i, 640) * 0.5;
    const p0 = [x - ux * w, y, z - uz * w], p1 = [x + ux * w, y, z + uz * w];
    flat.quad(p0, p1, [p1[0], y - h, p1[2]], [p0[0], y - h, p0[2]], [-uz, 0, ux], ZU, c);
    flat.quad(p0, p1, [p1[0], y - h, p1[2]], [p0[0], y - h, p0[2]], [uz, 0, -ux], ZU, mul(c, 0.8));
  }
}

// --- churches -------------------------------------------------------------------------------

const CH_WALL = [
  [0.40, [0.62, 0.27, 0.20]],   // red brick
  [0.24, [0.86, 0.75, 0.55]],   // buff brick
  [0.18, [0.80, 0.77, 0.69]],   // limestone
  [0.18, [0.94, 0.93, 0.90]],   // white clapboard / stucco
];
function churchWall(bd) {
  const mat = (bd.look || 0) >> 2 & 7;
  if (mat === 1) return [0.62, 0.27, 0.20];
  if (mat === 2) return [0.86, 0.75, 0.55];
  if (mat === 3) return [0.80, 0.77, 0.69];
  if (mat === 4 || mat === 5) return [0.94, 0.93, 0.90];
  return pick(CH_WALL, hash2(bd.seed, 651));
}

/** The church's proportions and its steeple, shared by the near mesh and the skyline. */
export function churchSpec(bd, city) {
  const F = frame(bd);
  const hl = Math.max(bd.w, bd.d) / 2, hs = Math.min(bd.w, bd.d) / 2;
  const A = bd.w * bd.d, seed = bd.seed;
  const eave = clamp(bd.h * 0.72, 5.2, 11);
  const rise = clamp(hs * 0.95, 3, 11);
  // the end toward the street carries the tower (one of the short ends)
  const fe = city ? frontSide(city, bd, F, true)[0] : 1;
  const modern = A > 1300 && hash2(seed, 652) < 0.55;
  const tw = clamp(hs * 0.62, 3.2, A > 900 ? 7.5 : 5.5);
  const towerTop = eave + rise + clamp(tw * 1.1, 3.5, 7.5) + (A > 900 ? 4 : 0);
  const spire = modern ? tw * 1.8 : tw * (2.4 + hash2(seed, 653) * 0.9) + (A > 900 ? 6 : 0);
  return { F, hl, hs, eave, rise, fe, tw, towerTop, spire, modern, tu: fe * (hl - tw / 2) };
}

function meshChurch(W, bl, flat, bd) {
  const S = churchSpec(bd, W.city), F = S.F, seed = bd.seed;
  const { hl, hs, eave, rise, fe, tw } = S;
  const lo = lowGround(bd) - 0.5, y0 = bd.y;
  const wc = churchWall(bd), wall = lin(wc), white = wc[0] > 0.9;
  const trim = lin(white ? [0.28, 0.30, 0.32] : [0.90, 0.88, 0.82]);
  const roofc = lin(pick([[0.5, [0.25, 0.26, 0.28]], [0.2, [0.40, 0.42, 0.44]], [0.15, [0.28, 0.40, 0.36]], [0.15, [0.36, 0.26, 0.22]]], hash2(seed, 654)));
  const glass = lin([0.16, 0.18, 0.26]), glass2 = lin([0.30, 0.24, 0.34]);
  const e = y0 + eave;
  // the nave
  flat.box(bd.x, lo, bd.z, hl * 2, e - lo, hs * 2, F.rotU, wall, { top: false, ao: 0.18 });
  profRoof(flat, F, -hl, hl, [[hs + 0.45, e - 0.45], [0, e + rise]], roofc, mul(wall, 0.95), 0.45);
  // a plinth course
  for (const s of [-1, 1]) sideRect(flat, F, hs, s, -hl, hl, lo, y0 + 0.7, mul(wall, 0.72), 0.05);
  // the lancet windows down both sides
  const lancet = (B, side, u, ww, y1, y2, col) => {
    const s = side;
    const a = F.P(u - ww / 2, s * (hs + 0.05), y1), b = F.P(u + ww / 2, s * (hs + 0.05), y1);
    const c = F.P(u + ww / 2, s * (hs + 0.05), y2), d = F.P(u - ww / 2, s * (hs + 0.05), y2);
    face(B, a, b, c, d, F.N(0, 0, s), [col, col, glass2, glass2]);
    tri(B, d, c, F.P(u, s * (hs + 0.05), y2 + ww * 0.8), F.N(0, 0, s), glass2);
    // the surround
    face(B, F.P(u - ww / 2 - 0.15, s * (hs + 0.03), y1 - 0.25), F.P(u + ww / 2 + 0.15, s * (hs + 0.03), y1 - 0.25),
      F.P(u + ww / 2 + 0.15, s * (hs + 0.03), y1 - 0.05), F.P(u - ww / 2 - 0.15, s * (hs + 0.03), y1 - 0.05), F.N(0, 0, s), trim);
  };
  const towerU0 = S.tu - fe * tw / 2;   // the tower's back face along u
  const naveU0 = fe > 0 ? -hl : towerU0, naveU1 = fe > 0 ? towerU0 : hl;
  const wh = Math.min(eave - 2.4, 4.2), ww = 1.25;
  const nWin = Math.max(1, Math.floor((naveU1 - naveU0 - 2) / 3.6));
  const sp = (naveU1 - naveU0) / nWin;
  for (const s of [-1, 1]) for (let i = 0; i < nWin; i++) {
    lancet(flat, s, naveU0 + sp * (i + 0.5), ww, y0 + 1.6, y0 + 1.6 + wh, glass);
  }
  // the rear (chancel) end: a big window
  endRect(flat, F, hl, -fe, -1.0, 1.0, y0 + 2.0, y0 + 2.0 + wh, glass);
  // THE TOWER at the street end
  const tc = F.P(S.tu, 0, 0);
  const tTop = y0 + S.towerTop;
  flat.box(tc[0], lo, tc[2], tw, tTop - lo, tw, F.rotU, wall, { top: true, ao: 0.2 });
  // the door: a pointed double door in the tower's front, steps before it
  const fu = S.tu + fe * tw / 2;
  const dw = Math.min(2.2, tw * 0.45);
  endRect(flat, F, fu, fe, -dw / 2, dw / 2, y0 - 0.1, y0 + 2.8, lin([0.32, 0.18, 0.12]), 0.06);
  tri(flat, F.P(fu + fe * 0.06, -dw / 2, y0 + 2.8), F.P(fu + fe * 0.06, dw / 2, y0 + 2.8), F.P(fu + fe * 0.06, 0, y0 + 2.8 + dw * 0.6), F.N(fe, 0, 0), lin([0.32, 0.18, 0.12]));
  const st = F.P(fu + fe * 0.9, 0, 0);
  flat.box(st[0], y0 - 0.3, st[2], 1.8, 0.45, dw + 1.6, F.rotU, lin([0.70, 0.69, 0.66]));
  // a window over the door
  if (eave > 6) endRect(flat, F, fu, fe, -0.6, 0.6, y0 + 4.0, y0 + 4.0 + Math.min(3, eave - 4.5), glass, 0.06);
  // the belfry: louvred openings on all four faces, a cornice
  const by0 = tTop - Math.min(3.4, tw * 0.75), by1 = tTop - 0.6;
  const lw = tw * 0.32;
  for (const [su, sv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = F.N(su, 0, sv);
    const at = (t, y) => F.P(S.tu + su * (tw / 2 + 0.05) + (sv ? t : 0), sv * (tw / 2 + 0.05) + (su ? t : 0), y);
    face(flat, at(-lw, by0), at(lw, by0), at(lw, by1), at(-lw, by1), n, lin([0.08, 0.08, 0.09]));
    tri(flat, at(-lw, by1), at(lw, by1), at(0, by1 + lw * 0.9), n, lin([0.08, 0.08, 0.09]));
    for (let y = by0 + 0.35; y < by1 - 0.1; y += 0.42) face(flat, at(-lw, y), at(lw, y), at(lw, y + 0.1), at(-lw, y + 0.1), n, trim);
    // a clock face on the street side of the big ones
    if (su === fe && tw >= 4.5 && hash2(seed, 655) < 0.5) {
      const cy = by0 - 1.4, cr = tw * 0.22;
      const c = at(0, cy);
      for (let k = 0; k < 10; k++) {
        const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2;
        const pa = at(Math.cos(a0) * cr, cy + Math.sin(a0) * cr), pb = at(Math.cos(a1) * cr, cy + Math.sin(a1) * cr);
        tri(flat, c, pa, pb, n, lin([0.92, 0.91, 0.86]));
      }
    }
  }
  const cor = F.P(S.tu, 0, 0);
  flat.box(cor[0], tTop - 0.05, cor[2], tw + 0.5, 0.45, tw + 0.5, F.rotU, trim);
  // the spire: eight-sided, on a short drum, a cross on top
  const spc = lin(pick([[0.40, [0.90, 0.90, 0.88]], [0.30, [0.30, 0.31, 0.33]], [0.18, [0.40, 0.58, 0.50]], [0.12, [0.62, 0.64, 0.66]]], hash2(seed, 656)));
  const sr = tw * 0.5;
  flat.prism(cor[0], tTop + 0.4, cor[2], sr * 0.98, 0.6, 8, white ? spc : trim, Math.PI / 8 + F.rotU);
  flat.cone(cor[0], tTop + 1.0, cor[2], sr * 0.98, S.spire, 8, spc);
  const ct = tTop + 1.0 + S.spire;
  flat.box(cor[0], ct - 0.2, cor[2], 0.14, 1.9, 0.14, F.rotU, lin([0.80, 0.70, 0.40]));
  const cb = F.P(S.tu, 0, ct + 1.05);
  flat.box(cb[0], cb[1], cb[2], 0.14, 0.14, 0.95, F.rotU, lin([0.80, 0.70, 0.40]));
}

/** world.buildSkyline: a church's steeple as far massing (inside the near mesh's). */
export function steepleMass(b, bd, city, col) {
  const S = churchSpec(bd, city), F = S.F;
  const c = F.P(S.tu, 0, 0), tTop = bd.y + S.towerTop;
  b.box(c[0], bd.y - 1, c[2], S.tw * 0.96, tTop - bd.y + 0.9, S.tw * 0.96, F.rotU, col, { top: true });
  b.cone(c[0], tTop + 0.9, c[2], S.tw * 0.4, S.spire * 0.95, 4, mul(col, 1.1));
}

/** world.meshBuilding's entry for the styles here. */
export function meshFarmBuilding(W, bl, flat, bd) {
  switch (bd.style) {
    case 'barn': meshBarn(W, bl, flat, bd); break;
    case 'silo': meshSilo(W, bl, flat, bd); break;
    case 'shed': meshShed(W, bl, flat, bd); break;
    case 'farmhouse': meshFarmhouse(W, bl, flat, bd); break;
    case 'church': meshChurch(W, bl, flat, bd); break;
  }
}
