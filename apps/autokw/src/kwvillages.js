// THE VILLAGES' MAIN STREETS (data/villages.json, tools/kw/build_villages.py).
// Small-town Waterloo County: St. Jacobs' King Street is a row of 1850-1900
// buildings -- two-storey brick commercial blocks with cornices, and the
// village's old frame and brick houses turned into quilt shops, gift shops
// and cafes, a shop window and a sign board where the parlour was, some
// behind a square false front, a verandah on others -- running from the
// mill and the Village Silos at the Conestogo bridge to the church. In
// Conestogo, Heidelberg, St. Clements, Maryhill and Breslau the same, for
// the few buildings on the main road OSM maps a shop in (the Olde
// Heidelberg Tavern, Maryhill's Commercial Tavern...). The churches whose
// steeples are each village's skyline are world.js's (farmstead.js).
//
// One landmarks.js extra built with kwplaces.js's Kit (its two vertex-
// coloured materials, so a cluster holding kwplaces/kwsights pieces too is
// still one draw each) and a small lettering atlas of its own.

import { hash2 } from './util.js';
import { boxAt } from './kw.js';
import {
  inPoly, polyArea, centroid, obb, edges, street, walkY, hang, PlaceAtlas, Kit, roof, gabled,
  lin, shade, meshKing, KING_SKIP, signPanel, U0, T,
} from './kwplaces.js';

let V = null;
const STATS = {};

/** Every box under a footprint drawn here goes flat (world.js, buildPolys and the signs skip it). */
function flatten(city, pts) {
  const [cx, cz] = centroid(pts);
  const A = Math.abs(polyArea(pts));
  const hit = new Set();
  const b = boxAt(city, cx, cz, 2);
  if (b && b.w * b.d < A * 4 + 300) hit.add(b);
  for (const o of city.buildingsNear(cx, cz, 60)) if (inPoly(pts, o.x, o.z) && o.w * o.d < A * 2 + 200) hit.add(o);
  for (const o of hit) {
    o.h = 0;
    if (!o.kw) o.kw = {};
    o.kw.skip = true;
    delete o.kw.poly;
    delete o.kw.strip;
  }
  return hit.size;
}

export function prepVillages(city, data) {
  V = data;
  if (typeof window !== 'undefined' && window.__noVillages) V = null;
  if (!V) return { skipped: 0 };
  let n = flatten(city, V.mill.p);
  for (const r of V.main) {
    n += flatten(city, r.p);
    if (r.kind === 'block') KING_SKIP.push(r.p);
  }
  return { skipped: n };
}

// --- a converted house on the main street ------------------------------------------

const HOUSE_WALL = [[0.88, 0.78, 0.56], [0.66, 0.30, 0.22], [0.93, 0.92, 0.88], [0.86, 0.82, 0.70], [0.62, 0.68, 0.62],
  [0.58, 0.64, 0.72], [0.78, 0.72, 0.62]];
const ROOFS = [[0.28, 0.28, 0.30], [0.36, 0.30, 0.26], [0.45, 0.47, 0.50], [0.22, 0.30, 0.26]];
const TRIM = [[0.94, 0.93, 0.89], [0.20, 0.24, 0.22], [0.45, 0.16, 0.13], [0.16, 0.22, 0.34]];

function mainHouse(kit, ctx, r) {
  const city = ctx.city;
  const o = obb(r.p);
  if (!o) return;
  const [cx, cz] = centroid(r.p);
  const seed = Math.round(cx * 13 + cz * 7);
  const B = kit.B(o.x, o.z), g = kit.grp(o.x, o.z);
  let lo = Infinity;
  for (const q of r.p) lo = Math.min(lo, T(q[0], q[1]));
  const y = walkY(city, o.x, o.z) - 0.05;
  const wall = lin(HOUSE_WALL[Math.floor(hash2(seed, 1) * HOUSE_WALL.length)]);
  const roofc = lin(ROOFS[Math.floor(hash2(seed, 2) * ROOFS.length)]);
  const trim = lin(TRIM[Math.floor(hash2(seed, 3) * TRIM.length)]);
  const twoStorey = (r.lv || 0) >= 2 || hash2(seed, 4) < 0.6;
  const eave = y + (twoStorey ? 6.0 : 4.6);
  const hv = Math.min(o.hv, o.hu);
  // the face toward the main street: one of the box's four sides
  const vx = -o.uz, vz = o.ux;
  const sides = [[o.ux, o.uz, o.hu, o.hv], [-o.ux, -o.uz, o.hu, o.hv], [vx, vz, o.hv, o.hu], [-vx, -vz, o.hv, o.hu]];
  let best = sides[0], bk = Infinity;
  for (const s of sides) {
    const st = street(city, o.x + s[0] * (s[2] + 3), o.z + s[1] * (s[2] + 3), 40);
    if (st && st.kerb < bk) { bk = st.kerb; best = s; }
  }
  const [nx, nz, depth, half] = best;
  const gableFront = depth === o.hu;          // the front is a short (gable) end
  const ridge = eave + Math.min(4.2, hv * (gableFront ? 0.9 : 0.75));
  // wall to the ground's lowest point, a gabled roof (ridge along the long side)
  gabled(B, o, lo - 1, eave, ridge, wall, roofc, { overhang: 0.35, gable: wall });
  ctx.solids.push({ x: o.x, z: o.z, hw: o.hu, hd: o.hv, rot: Math.atan2(o.uz, o.ux), y0: lo - 1, y1: ridge });
  // the front face's frame: t along it (tx, tz), out along (nx, nz)
  const tx = -nz, tz = nx;
  const at = (t, yy, off = 0) => [o.x + nx * (depth + off) + tx * t, yy, o.z + nz * (depth + off) + tz * t];
  const N = [nx, 0, nz];
  const q = (t0, t1, y0, y1, off, col) => B.quad(at(t0, y0, off), at(t1, y0, off), at(t1, y1, off), at(t0, y1, off), N, U0, col);
  // A FALSE FRONT on a gable-fronted one: the front wall carried up square past the roof, a cornice on top
  const falseFront = gableFront && hash2(seed, 5) < 0.55;
  if (falseFront) {
    const top = ridge + 0.5;
    q(-half, half, eave - 0.1, top, 0.02, wall);
    B.quad(at(-half, eave - 0.1, -0.02), at(half, eave - 0.1, -0.02), at(half, top, -0.02), at(-half, top, -0.02), [-nx, 0, -nz], U0, shade(wall, 0.7));
    q(-half - 0.2, half + 0.2, top - 0.5, top, 0.3, trim);
    B.quad(at(-half - 0.2, top, 0.3), at(half + 0.2, top, 0.3), at(half + 0.2, top, 0), at(-half - 0.2, top, 0), [0, 1, 0], U0, trim);
    B.quad(at(-half - 0.2, top - 0.5, 0.3), at(half + 0.2, top - 0.5, 0.3), at(half + 0.2, top - 0.5, 0), at(-half - 0.2, top - 0.5, 0), [0, -1, 0], U0, shade(trim, 0.6));
  }
  // corner boards
  for (const s of [-1, 1]) q(s * half - (s > 0 ? 0.22 : 0), s * half + (s > 0 ? 0 : 0.22), y - 0.3, eave, 0.03, trim);
  // THE SHOP: a big window each side of the door, the door, a sign board over them
  const GL = lin([0.13, 0.16, 0.19]), GL2 = lin([0.24, 0.29, 0.33]);
  const dw = 1.0;
  const shopW = Math.min(half - 0.5, 2.6);
  for (const s of [-1, 1]) {
    const t0 = s < 0 ? -shopW - dw / 2 - 0.15 : dw / 2 + 0.15, t1 = s < 0 ? -dw / 2 - 0.15 : shopW + dw / 2 + 0.15;
    if (Math.abs(t0) > half - 0.3 || Math.abs(t1) > half - 0.3) continue;
    q(t0 - 0.12, t1 + 0.12, y + 0.45, y + 2.75, 0.03, trim);
    B.quad(at(t0, y + 0.6, 0.05), at(t1, y + 0.6, 0.05), at(t1, y + 2.6, 0.05), at(t0, y + 2.6, 0.05), N, U0, [GL, GL, GL2, GL2]);
  }
  q(-dw / 2, dw / 2, y - 0.1, y + 2.3, 0.05, shade(trim, hash2(seed, 6) < 0.5 ? 0.6 : 1));
  // upper windows
  if (twoStorey) {
    const nw = Math.max(1, Math.min(3, Math.floor(half * 2 / 2.4)));
    for (let i = 0; i < nw; i++) {
      const t = -half + (2 * half) * (i + 0.5) / nw;
      q(t - 0.55, t + 0.55, y + 3.6, y + 5.2, 0.03, trim);
      q(t - 0.42, t + 0.42, y + 3.7, y + 5.1, 0.05, GL);
    }
  } else if (gableFront || falseFront) {
    q(-0.45, 0.45, eave + 0.3, eave + 1.5, 0.05, GL);
  }
  // a verandah across the front of the houses without a false front
  if (!falseFront && hash2(seed, 7) < 0.5 && bk > 2.5) {
    const D = Math.min(2.2, bk - 0.6), yr = y + 2.9;
    for (const t of [-half + 0.2, -dw / 2 - 0.4, dw / 2 + 0.4, half - 0.2]) {
      const p = at(t, y, D - 0.15);
      B.box(p[0], y, p[2], 0.16, yr - y, 0.16, Math.atan2(tz, tx), trim);
    }
    const n = [nx * 0.25, 0.97, nz * 0.25];
    B.quad(at(-half - 0.1, yr + 0.45, 0), at(half + 0.1, yr + 0.45, 0), at(half + 0.1, yr, D + 0.2), at(-half - 0.1, yr, D + 0.2), n, U0, roofc);
    B.quad(at(-half - 0.1, yr + 0.43, 0), at(half + 0.1, yr + 0.43, 0), at(half + 0.1, yr - 0.02, D + 0.2), at(-half - 0.1, yr - 0.02, D + 0.2), [-n[0], -n[1], -n[2]], U0, shade(trim, 0.75));
  }
  // the sign board: the shop's name over the windows (the first shop OSM maps here)
  const shop = r.s[0];
  if (shop) {
    const sw = Math.min(half * 2 - 0.6, Math.max(2.2, shop[0].length * 0.3 + 1));
    const sp = at(0, y + 3.15, 0.1);
    hang(g, signPanel(ctx.atlas, shop[0], shop[2], sw, 0.62, seed), sp[0], sp[1], sp[2], nx, nz, 0.02);
  }
}

// --- St. Jacobs: the mill and the Village Silos ---------------------------------------

// the five concrete silos at King and Front (Esri imagery, 2026): centres and radii
const SILOS = [[-6391, -9838, 2.5], [-6386.4, -9836.6, 2.5], [-6381.3, -9836.6, 2.5], [-6376.2, -9836.8, 2.5], [-6380.6, -9842.2, 2.6]];
// the mill's four-storey gabled block by the bridge (x, z, half-length, half-width, the ridge's direction)
const MILL_HOUSE = { x: -6358.5, z: -9856, hu: 10.5, hv: 7, ux: 0.08, uz: -0.9968 };

function mill(kit, ctx) {
  const pts = polyArea(V.mill.p) < 0 ? V.mill.p.slice().reverse() : V.mill.p;
  const [cx, cz] = centroid(pts);
  const B = kit.B(cx, cz);
  const city = ctx.city;
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const base = walkY(city, cx, cz);
  const top = base + 7.2;
  const BRICK = lin([0.55, 0.30, 0.22]), BOARD = lin([0.62, 0.58, 0.52]), TRIMC = lin([0.92, 0.90, 0.85]);
  const GL = lin([0.13, 0.15, 0.17]);
  // the low wings: brick to the parapet, rows of small windows
  for (const e of edges(pts)) {
    const N = [e.nx, 0, e.nz];
    B.quad(e.at(0, lo - 1.2), e.at(e.L, lo - 1.2), e.at(e.L, top + 0.6), e.at(0, top + 0.6), N, U0, [shade(BRICK, 0.75), shade(BRICK, 0.75), BRICK, BRICK]);
    B.quad(e.at(0, top + 0.6, 0.12), e.at(e.L, top + 0.6, 0.12), e.at(e.L, top + 0.7, 0), e.at(0, top + 0.7, 0), [0, 1, 0], U0, TRIMC);
    ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: lo - 1.2, y1: top + 0.6 });
    if (e.L < 3) continue;
    for (let t = 1.5; t < e.L - 1; t += 2.6) for (const yy of [1.0, 4.4]) {
      B.quad(e.at(t - 0.5, base + yy, 0.04), e.at(t + 0.5, base + yy, 0.04), e.at(t + 0.5, base + yy + 1.6, 0.04), e.at(t - 0.5, base + yy + 1.6, 0.04), N, U0, GL);
      B.quad(e.at(t - 0.62, base + yy + 1.6, 0.05), e.at(t + 0.62, base + yy + 1.6, 0.05), e.at(t + 0.62, base + yy + 1.9, 0.05), e.at(t - 0.62, base + yy + 1.9, 0.05), N, U0, TRIMC);
    }
  }
  roof(B, pts, top, lin([0.34, 0.32, 0.30]));
  // the mill house: board over brick, four storeys, a steep gable
  const o = MILL_HOUSE;
  const my = walkY(city, o.x, o.z);
  const P = gabled(B, o, lo - 1, my + 13.5, my + 18.5, BOARD, lin([0.36, 0.25, 0.20]), { overhang: 0.5 });
  const vx = -o.uz, vz = o.ux;
  for (const s of [-1, 1]) {
    B.quad(P(-o.hu, s * (o.hv + 0.03), lo - 1), P(o.hu, s * (o.hv + 0.03), lo - 1), P(o.hu, s * (o.hv + 0.03), my + 4.2), P(-o.hu, s * (o.hv + 0.03), my + 4.2), [vx * s, 0, vz * s], U0, BRICK);
    for (let u = -o.hu + 1.6; u < o.hu - 1; u += 2.7) for (const yy of [5.4, 8.6, 11.6]) {
      const c = P(u, s * (o.hv + 0.05), my + yy);
      B.quad([c[0] - o.ux * 0.5, c[1], c[2] - o.uz * 0.5], [c[0] + o.ux * 0.5, c[1], c[2] + o.uz * 0.5], [c[0] + o.ux * 0.5, c[1] + 1.4, c[2] + o.uz * 0.5], [c[0] - o.ux * 0.5, c[1] + 1.4, c[2] - o.uz * 0.5], [vx * s, 0, vz * s], U0, GL);
    }
  }
  ctx.solids.push({ x: o.x, z: o.z, hw: o.hu, hd: o.hv, rot: Math.atan2(o.uz, o.ux), y0: lo - 1, y1: my + 18.5 });
  // THE VILLAGE SILOS: five poured-concrete silos, a copper cap on the inner one
  const CON = lin([0.86, 0.85, 0.82]);
  for (const [sx, sz, r] of SILOS) {
    const h = 17.5;
    B.prism(sx, lo - 1, sz, r, base + h - lo + 1, 14, CON);
    for (let k = 1; k < 8; k++) B.prism(sx, base + k * 2.1, sz, r + 0.03, 0.08, 14, shade(CON, 0.82));
    B.prism(sx, base + h, sz, r + 0.12, 0.35, 14, shade(CON, 0.9));
    ctx.solids.push({ x: sx, z: sz, r, y0: lo - 1, y1: base + h + 0.35 });
  }
  const [dx, dz] = SILOS[4];
  B.cone(dx, base + 17.85, dz, 2.0, 2.6, 12, lin([0.55, 0.36, 0.22]));
  B.prism(dx, base + 20.3, dz, 0.35, 1.2, 8, lin([0.45, 0.62, 0.52]));
}

/** landmarks.js extra. */
export function buildVillages(ctx) {
  if (!V) return;
  const t0 = performance.now();
  const kit = new Kit();
  const atlas = new PlaceAtlas(1024, 512);
  ctx = { ...ctx, atlas };
  const run = (name, fn) => {
    const s0 = ctx.solids.length, tr0 = kit.tris;
    try { fn(); } catch (e) { console.warn('kwvillages ' + name + ': ' + (e.stack || e.message)); STATS.err = (STATS.err || []).concat(name + ': ' + e.message); }
    kit.flush(ctx);
    STATS[name] = { tris: kit.tris - tr0, solids: ctx.solids.length - s0 };
  };
  if (ctx.clearAt) for (const r of V.main) { const o = obb(r.p); if (o) ctx.clearAt.push([o.x, o.z, Math.min(o.hu, o.hv) + 2]); }
  run('main', () => V.main.forEach((r, i) => (r.kind === 'block' ? meshKing(kit, ctx, { ...r, ht: null }, 900 + i) : mainHouse(kit, ctx, r))));
  run('mill', () => mill(kit, ctx));
  STATS.atlas = { y: atlas.y + atlas.row, full: atlas.full };
  atlas.finish();
  STATS.ms = Math.round(performance.now() - t0);
  if (typeof window !== 'undefined') window.__kwVillages = STATS;
}

export function villagesMap() {
  if (!V) return [];
  return [
    { x: -6395, z: -9660, kind: 'lm', label: 'St. Jacobs', name: 'St. Jacobs', near: false,
      hello: 'St. Jacobs — King Street\'s quilt shops, the mill and the Village Silos by the Conestogo, St. James\' steeple' },
    { x: -6383, z: -9838, kind: 'lm', label: false, name: 'The Village Silos', near: false,
      hello: 'The Village Silos, King and Front — the old mill\'s concrete silos, shops inside' },
  ];
}
