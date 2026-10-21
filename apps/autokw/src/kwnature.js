// THE GRAND RIVER VALLEY: Waterloo Region's natural places, its river banks
// and its trails' furniture.
//
//   - THE BANKS. The Grand runs over limestone: its shores are pale grey-buff
//     stone shelves and scattered blocks at the waterline, not lawn to the
//     water's edge. Every shoreline of SLOPING water (the rivers: the field
//     falls along them; lakes and ponds keep their grass) is found exactly as
//     the terrain and water meshes draw it -- the zero of (terrain - water)
//     on each of their shared triangles (geo.riverField says which bodies
//     are rivers) -- and gets a 1.6-4 m stone shelf laid on the bank and
//     limestone blocks along the line. In downtown Galt the river runs
//     between stone walls instead (GALT): a limestone retaining wall with a
//     coped parapet along each shore and the paved riverwalk behind it.
//   - THE TRAILS' FURNITURE (bikes.js draws the trails themselves): the
//     bridges that carry a trail over a creek, a road or the river where
//     nothing else draws one (97: the footbridges along Laurel, Schneider and
//     Bechtel creeks, the Trans Canada's over the 401 ...; a road bridge's
//     own footway is the road import's, Waterloo Park's are kwplaces.js's)
//     as walkable decks (city platforms; bikes.js rides and walks them:
//     P.deck), a truck's clearance over a road; a trail sign where one of the
//     region's trails (over 2 km of it on the map) meets a road, one per
//     700 m of it (two posts, a panel each way: green, the Trans Canada's
//     red); a bench every 210-300 m along the named trails.
//   - DOON PIONEER MEMORIAL TOWER (1926, William A. Langton; OSM way
//     827907152, 18.9 m): the six-sided fieldstone shaft, tapering, on the
//     ridge over the Grand; the open lookout on white columns with its iron
//     railing; the concave copper roof (2009) with the Conestoga-wagon vane.
//   - THE WEST MONTROSE COVERED BRIDGE (the Kissing Bridge, 1881; OSM way
//     35928828): Ontario's last covered bridge, 62 m in two spans over the
//     Grand on a concrete pier, red-painted pine boards, cedar-shingle gable
//     roof, window openings down each side. Closed since August 2025 for
//     the Region's rehabilitation (reopening spring 2027): raised on steel
//     cribbing, fenced at both ends, BRIDGE CLOSED. Walkable (platforms).
//
// WHERE IT IS DRAWN, for the phone. The tower, the covered bridge and Galt's
// walls are built inside kwsights.js's run (addSights: its Kit and atlas,
// merged into the landmark clusters). The signs are scattered through parks
// that have no other landmark, so they are in 'near:nature:' clusters, drawn
// within ~1 km. The banks' stone, the benches and the trail bridges are drawn
// into bikes.js's 1 km ground chunks (`groundDetail`: its one material, built
// lazily when the chunk first comes into range) -- the Walter Bean follows
// the Grand, so along most of the river that chunk is drawn anyway. (Built
// into the landmark clusters they were +50-100 draws in a wide view: a merged
// cluster mesh over 60k vertices is not merged again, so every flush that
// reached a cluster was a draw of its own.)
// `window.__kwNature` has the counts; `window.__noNature = true` before boot
// turns it off for a before/after (`__natureSkip = ['signs', ...]` one part).

import * as G from './geo.js';
import { hash2 } from './util.js';
import { boxAt } from './kw.js';
import { addSights } from './kwsights.js';
import { lin, shade, U0, T, SANS, Kit } from './kwplaces.js';

let NET = null;          // bikes.js BikeNet
let CITY = null;
const STATS = { banks: 0, rocks: 0, walls: 0, bridges: 0, signs: 0, benches: 0 };

const TOWER = { p: [[4753.3, 5758.3], [4753.9, 5761.2], [4756.7, 5762.3], [4759.2, 5760.2], [4758.5, 5757.2], [4755.7, 5756.1]], h: 18.9 };
const KISSING = { a: [-505.0, -14813.1], b: [-544.3, -14876.1] };
// downtown Galt, where the river runs between walls: Park Hill Rd to below Concession St
const GALT = { x0: 12560, x1: 13120, z0: 9780, z1: 10820 };

/** The trails, before the city is meshed (main.js): the tower's footprint box goes flat. */
export function prepNature(city, net) {
  NET = net; CITY = city;
  if (typeof window !== 'undefined' && window.__noNature) return { skipped: 0 };
  let skipped = 0;
  const [cx, cz] = centre(TOWER.p);
  const b = boxAt(city, cx, cz, 2);
  if (b && b.w * b.d < 80) { b.h = 0; b.kw = b.kw || {}; b.kw.skip = true; skipped++; }
  addSights('nature', buildNature);
  return { skipped };
}

function centre(p) {
  let x = 0, z = 0;
  for (const q of p) { x += q[0]; z += q[1]; }
  return [x / p.length, z / p.length];
}

function buildNature(kit, ctx) {
  const t0 = performance.now();
  const run = (name, fn) => {
    if (typeof window !== "undefined" && (window.__natureSkip || []).includes(name)) return;
    const tr = kit.tris;
    try { fn(); } catch (e) { console.warn('kwnature ' + name + ': ' + (e.stack || e.message)); STATS.err = (STATS.err || []).concat(name + ': ' + e.message); }
    STATS[name + 'Ms'] = Math.round(performance.now() - t0);
    STATS[name + 'Tris'] = kit.tris - tr;
  };
  run('galt', () => galtWalls(kit, ctx));
  run('tower', () => pioneerTower(kit, ctx));
  run('kissing', () => kissingBridge(kit, ctx));
  if (NET) {
    run('trailBridges', () => trailBridges(kit, ctx));
    // (the signs are small and scattered through parks: in 'near:' clusters,
    // drawn only within ~1 km, not a draw in every far cluster in view)
    run('signs', () => { const nk = new Kit(); trailSigns(nk, ctx); nk.flush({ ...ctx, addTo: (k, g) => ctx.addTo('near:nature:' + k, g) }); });
  }
  STATS.ms = Math.round(performance.now() - t0);
  if (typeof window !== 'undefined') window.__kwNature = STATS;
}

// --- the banks ---------------------------------------------------------------------------------

const LIME = [[0.66, 0.62, 0.54], [0.60, 0.57, 0.50], [0.72, 0.68, 0.59], [0.56, 0.53, 0.47], [0.63, 0.58, 0.48]].map(lin);
const MUD = lin([0.36, 0.32, 0.25]);

/**
 * Every piece of RIVER shoreline in the heightfield cells [i0, i1) x [j0, j1):
 * fn(p, q, nx, nz) with p, q on the water line ({ x, z, l: the level }) and
 * (nx, nz) inland. Lakes and ponds (flat water) are left out.
 */
function forShore(i0, j0, i1, j1, fn) {
  const WL = G.waterField();
  if (!WL || !G.riverField()) return;
  const N = G.HF_N, S = G.HF_STEP, H = G.MAP_HALF;
  i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(N - 1, i1); j1 = Math.min(N - 1, j1);
  const L = (i, j) => (i < 0 || j < 0 || i >= N || j >= N ? NaN : WL[j * N + i]);
  // the level the water MESH stands at a vertex (world.js buildWater's lvAt)
  const lv = (i, j) => {
    const v = L(i, j);
    if (v === v) return v;
    let m = -Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const w = L(i + di, j + dj); if (w === w && w > m) m = w; }
    return m;
  };
  // river water at or next to the cell (geo.riverField: the bodies whose level falls)
  const RF = G.riverField();
  const river = (i, j) => {
    for (let dj = -1; dj <= 2; dj++) for (let di = -1; di <= 2; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < N && jj < N && RF[jj * N + ii]) return true;
    }
    return false;
  };
  const vtx = (i, j) => {
    const x = i * S - H, z = j * S - H;
    return { x, z, f: T(x, z) - lv(i, j), l: lv(i, j) };
  };
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const k = j * N + i;
    if (!(WL[k] === WL[k] || WL[k + 1] === WL[k + 1] || WL[k + N] === WL[k + N] || WL[k + N + 1] === WL[k + N + 1])) continue;
    if (!river(i, j)) continue;
    const a = vtx(i, j), b = vtx(i + 1, j), c = vtx(i, j + 1), d = vtx(i + 1, j + 1);
    if (!(a.l > -1e9 && b.l > -1e9 && c.l > -1e9 && d.l > -1e9)) continue;
    // the meshes' own split: (a, c, b) and (b, c, d)
    for (const tri of [[a, c, b], [b, c, d]]) {
      const pts = [];
      for (let e = 0; e < 3; e++) {
        const p = tri[e], q = tri[(e + 1) % 3];
        if ((p.f > 0) !== (q.f > 0)) {
          const t = p.f / (p.f - q.f);
          pts.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, l: p.l + (q.l - p.l) * t });
        }
      }
      if (pts.length !== 2) continue;
      // inland: up the gradient of (terrain - water) over the triangle
      const [p, q, r] = tri;
      const ux = q.x - p.x, uz = q.z - p.z, vx = r.x - p.x, vz = r.z - p.z, df1 = q.f - p.f, df2 = r.f - p.f;
      const det = ux * vz - uz * vx;
      if (Math.abs(det) < 1e-6) continue;
      let gx = (df1 * vz - df2 * uz) / det, gz = (df2 * ux - df1 * vx) / det;
      const gl = Math.hypot(gx, gz) || 1;
      gx /= gl; gz /= gl;
      fn(pts[0], pts[1], gx, gz);
    }
  }
}

const inBld = (city, x, z) => city.buildingsNear(x, z, 10).some((b) => {
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
  return Math.abs(dx * c - dz * s) < b.w / 2 + 1 && Math.abs(dx * s + dz * c) < b.d / 2 + 1;
});
const inGalt = (x, z) => x > GALT.x0 && x < GALT.x1 && z > GALT.z0 && z < GALT.z1;
const cellsOf = (x0, z0, x1, z1) => [Math.floor((x0 + G.MAP_HALF) / G.HF_STEP), Math.floor((z0 + G.MAP_HALF) / G.HF_STEP),
  Math.ceil((x1 + G.MAP_HALF) / G.HF_STEP), Math.ceil((z1 + G.MAP_HALF) / G.HF_STEP)];

/** Downtown Galt's walls, in the landmark clusters (they are few, and Galt's cluster exists). */
function galtWalls(kit, ctx) {
  const [i0, j0, i1, j1] = cellsOf(GALT.x0, GALT.z0, GALT.x1, GALT.z1);
  forShore(i0, j0, i1, j1, (p, q, nx, nz) => {
    const len = Math.hypot(q.x - p.x, q.z - p.z), mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
    if (len < 0.5 || !inGalt(mx, mz)) return;
    if (ctx.city.onRoad(mx + nx * 2, mz + nz * 2, 2) || inBld(ctx.city, mx + nx * 2, mz + nz * 2)) return;
    galtWall(kit, ctx, p, q, nx, nz, Math.max(1, Math.ceil(len / 4)));
  });
}

/**
 * The bank shelves and limestone blocks of one 1 km ground-detail chunk of
 * bikes.js (its `extra` hook): drawn into that chunk's mesh when it first
 * comes into range, so they cost no draw where a trail's chunk is already
 * drawn (the Walter Bean follows the Grand) and nothing at boot.
 */
export function drawShore(b, x0, z0, size) {
  if (!CITY) return 0;
  const [i0, j0, i1, j1] = cellsOf(x0, z0, x0 + size, z0 + size);
  let n = 0;
  forShore(i0, j0, i1, j1, (p, q, nx, nz) => {
    const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
    if (mx < x0 || mx >= x0 + size || mz < z0 || mz >= z0 + size || inGalt(mx, mz)) return;
    n += shore(b, p, q, nx, nz, CITY);
  });
  return n;
}

/** The 1 km chunks (bikes.js's) that have any water at all: where drawShore may draw. */
export function shoreChunks(size) {
  const WL = G.waterField(), out = new Set();
  if (!WL || (typeof window !== 'undefined' && window.__noNature)) return out;
  const N = G.HF_N, S = G.HF_STEP, H = G.MAP_HALF;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v = WL[j * N + i];
    if (v === v) out.add(`${Math.floor((i * S - H) / size)},${Math.floor((j * S - H) / size)}`);
  }
  return out;
}

/** One piece of shoreline p..q (on the water line), inland (nx, nz). */
function shore(D, p, q, nx, nz, city) {
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  if (len < 0.5) return 0;
  const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
  if (city.onRoad(mx + nx * 2, mz + nz * 2, 2) || inBld(city, mx + nx * 2, mz + nz * 2)) return 0;
  const n = Math.max(1, Math.ceil(len / 4));
  const ux = (q.x - p.x) / len, uz = (q.z - p.z) / len;
  const B = D;
  STATS.banks++;
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const x0 = p.x + (q.x - p.x) * t0, z0 = p.z + (q.z - p.z) * t0, l0 = p.l + (q.l - p.l) * t0;
    const x1 = p.x + (q.x - p.x) * t1, z1 = p.z + (q.z - p.z) * t1, l1 = p.l + (q.l - p.l) * t1;
    // the shelf: 1.6-4 m of pale stone and gravel up the bank, fading into the grass
    const w0 = 1.6 + 2.4 * hash2(Math.round(x0 * 3), Math.round(z0 * 3) + 7), w1 = 1.6 + 2.4 * hash2(Math.round(x1 * 3), Math.round(z1 * 3) + 7);
    const c0 = LIME[Math.floor(hash2(Math.round(x0), Math.round(z0)) * LIME.length)];
    const c1 = LIME[Math.floor(hash2(Math.round(x1), Math.round(z1)) * LIME.length)];
    const fade = (c) => [c[0] * 0.55 + MUD[0] * 0.45, c[1] * 0.55 + MUD[1] * 0.45, c[2] * 0.55 + MUD[2] * 0.45];
    const ia = [x0 + nx * w0, 0, z0 + nz * w0], ib = [x1 + nx * w1, 0, z1 + nz * w1];
    ia[1] = T(ia[0], ia[2]) + 0.05; ib[1] = T(ib[0], ib[2]) + 0.05;
    const oa = [x0 - nx * 0.4, l0 + 0.02, z0 - nz * 0.4], ob = [x1 - nx * 0.4, l1 + 0.02, z1 - nz * 0.4];
    // (the water line itself, a hair over the water: the shelf meets it there)
    const wa = [x0, Math.max(l0, T(x0, z0)) + 0.04, z0], wb = [x1, Math.max(l1, T(x1, z1)) + 0.04, z1];
    D.quad(oa, ob, wb, wa, [0, 1, 0], U0, [c0, c1, c1, c0]);
    D.quad(wa, wb, ib, ia, [0, 1, 0], U0, [c0, c1, fade(c1), fade(c0)]);
    // limestone blocks along the water line, half in the water
    const hb = hash2(Math.round(x0 * 7) + 3, Math.round(z0 * 7) - 5);
    if (hb < 0.62) {
      const s = 0.35 + 0.85 * hash2(Math.round(x0 * 5), Math.round(z0 * 5) + 1);
      const off = (hash2(Math.round(x0 * 9), Math.round(z0 * 9)) - 0.35) * 1.6;
      const bx = x0 + ux * 2 + nx * off, bz = z0 + uz * 2 + nz * off;
      rock(B, bx, Math.min(l0, T(bx, bz)) - 0.25, bz, s, hb * 9.1, LIME[Math.floor(hb * 31) % LIME.length]);
      STATS.rocks++;
    }
  }
  return 1;
}

/** A limestone block: a squashed, turned octahedron with a flat-ish top. */
function rock(B, x, y, z, s, seed, col) {
  const a = seed * 2.4, ca = Math.cos(a), sa = Math.sin(a);
  const rx = s * (0.8 + 0.5 * hash2(Math.round(seed * 100), 3)), rz = s * (0.6 + 0.4 * hash2(Math.round(seed * 100), 5)), ry = s * 0.55;
  const P = (lx, ly, lz) => [x + lx * ca - lz * sa, y + ly, z + lx * sa + lz * ca];
  const top = P(0.1 * rx, ry + 0.25, 0), bot = P(0, -0.2, 0);
  const ring = [P(rx, 0.25, 0), P(0, 0.3, rz), P(-rx, 0.22, 0), P(0, 0.28, -rz)];
  const lt = [col[0] * 1.08, col[1] * 1.08, col[2] * 1.08], dk = shade(col, 0.7);
  for (let k = 0; k < 4; k++) {
    const p = ring[k], q = ring[(k + 1) % 4];
    const mx = (p[0] + q[0]) / 2 - x, mz = (p[2] + q[2]) / 2 - z, ml = Math.hypot(mx, mz) || 1;
    B.tri(p, q, top, [mx / ml * 0.6, 0.8, mz / ml * 0.6], lt);
    B.tri(q, p, bot, [mx / ml, -0.3, mz / ml], dk);
  }
}

const GALT_STONE = [[0.66, 0.63, 0.56], [0.61, 0.58, 0.52], [0.70, 0.67, 0.60]].map(lin);
const CAP = lin([0.76, 0.74, 0.69]), WALK = lin([0.60, 0.58, 0.55]);

/** Downtown Galt: a limestone retaining wall along the water line, its
 *  coped parapet, and the paved riverwalk behind it. */
function galtWall(kit, ctx, p, q, nx, nz, n) {
  const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
  const B = kit.B(mx, mz), D = kit.B(mx, mz, true);
  STATS.walls++;
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const x0 = p.x + (q.x - p.x) * t0, z0 = p.z + (q.z - p.z) * t0, l0 = p.l + (q.l - p.l) * t0;
    const x1 = p.x + (q.x - p.x) * t1, z1 = p.z + (q.z - p.z) * t1, l1 = p.l + (q.l - p.l) * t1;
    const top0 = Math.max(T(x0 + nx * 3, z0 + nz * 3) + 0.95, l0 + 2.6), top1 = Math.max(T(x1 + nx * 3, z1 + nz * 3) + 0.95, l1 + 2.6);
    // the face in courses, each its own tone
    const nn = [-nx, 0, -nz];
    const C = 5;
    for (let c = 0; c < C; c++) {
      const ya0 = l0 - 0.5 + (top0 - l0 + 0.5) * c / C, ya1 = l0 - 0.5 + (top0 - l0 + 0.5) * (c + 1) / C;
      const yb0 = l1 - 0.5 + (top1 - l1 + 0.5) * c / C, yb1 = l1 - 0.5 + (top1 - l1 + 0.5) * (c + 1) / C;
      const col = GALT_STONE[Math.floor(hash2(Math.round(x0 * 2) + c, Math.round(z0 * 2)) * 3)];
      B.quad([x0, ya0, z0], [x1, yb0, z1], [x1, yb1, z1], [x0, ya1, z0], nn, U0, col);
    }
    // the cope: 0.55 m deep, a lip over the face
    const ox = nx * 0.55, oz = nz * 0.55;
    B.quad([x0 - nx * 0.06, top0 + 0.12, z0 - nz * 0.06], [x1 - nx * 0.06, top1 + 0.12, z1 - nz * 0.06], [x1 + ox, top1 + 0.12, z1 + oz], [x0 + ox, top0 + 0.12, z0 + oz], [0, 1, 0], U0, CAP);
    B.quad([x0 - nx * 0.06, top0, z0 - nz * 0.06], [x1 - nx * 0.06, top1, z1 - nz * 0.06], [x1 - nx * 0.06, top1 + 0.12, z1 - nz * 0.06], [x0 - nx * 0.06, top0 + 0.12, z0 - nz * 0.06], nn, U0, shade(CAP, 0.85));
    // the back, down to the ground
    const g0 = T(x0 + ox, z0 + oz), g1 = T(x1 + ox, z1 + oz);
    B.quad([x0 + ox, g0 - 0.2, z0 + oz], [x1 + ox, g1 - 0.2, z1 + oz], [x1 + ox, top1 + 0.12, z1 + oz], [x0 + ox, top0 + 0.12, z0 + oz], [nx, 0, nz], U0, GALT_STONE[1]);
    // the riverwalk behind: 3 m of paving
    const r0 = [x0 + nx * 0.6, 0, z0 + nz * 0.6], r1 = [x1 + nx * 0.6, 0, z1 + nz * 0.6], r2 = [x1 + nx * 3.6, 0, z1 + nz * 3.6], r3 = [x0 + nx * 3.6, 0, z0 + nz * 3.6];
    for (const r of [r0, r1, r2, r3]) r[1] = T(r[0], r[2]) + 0.06;
    D.quad(r0, r1, r2, r3, [0, 1, 0], U0, WALK);
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len > 0.8) ctx.solids.push({ x: (x0 + x1) / 2 + nx * 0.25, z: (z0 + z1) / 2 + nz * 0.25, hw: len / 2, hd: 0.3, rot: Math.atan2(z1 - z0, x1 - x0), y0: Math.min(l0, l1) - 0.5, y1: Math.max(top0, top1) + 0.12 });
  }
}

// --- Doon Pioneer Memorial Tower ----------------------------------------------------------------

const FIELDSTONE = [[0.62, 0.55, 0.46], [0.55, 0.50, 0.44], [0.68, 0.62, 0.52], [0.50, 0.44, 0.38], [0.60, 0.58, 0.54], [0.70, 0.60, 0.48], [0.47, 0.45, 0.42]].map(lin);
const WHITE = lin([0.92, 0.91, 0.88]), COPPER = lin([0.34, 0.47, 0.40]), IRON = lin([0.12, 0.12, 0.12]), DARK = lin([0.10, 0.09, 0.08]);

function pioneerTower(kit, ctx) {
  const [cx, cz] = centre(TOWER.p);
  let y0 = Infinity;
  for (const [x, z] of TOWER.p) y0 = Math.min(y0, T(x, z));
  const B = kit.B(cx, cz);
  const ang = TOWER.p.map(([x, z]) => Math.atan2(z - cz, x - cx));
  const R0 = TOWER.p.reduce((s, [x, z]) => s + Math.hypot(x - cx, z - cz), 0) / TOWER.p.length;
  const DECK = 13.2, EAVE = 16.0, R1 = R0 * 0.78;
  const at = (k, r, y) => [cx + Math.cos(ang[k % 6]) * r, y0 + y, cz + Math.sin(ang[k % 6]) * r];
  // the shaft: courses of fieldstone, each face's stones their own tones
  const ROWS = 22;
  for (let row = 0; row < ROWS; row++) {
    const ya = -0.5 + (DECK + 0.5) * row / ROWS, yb = -0.5 + (DECK + 0.5) * (row + 1) / ROWS;
    const ra = R0 + (R1 - R0) * (ya / DECK), rb = R0 + (R1 - R0) * (yb / DECK);
    for (let k = 0; k < 6; k++) {
      const a0 = at(k, ra, ya), a1 = at(k + 1, ra, ya), b1 = at(k + 1, rb, yb), b0 = at(k, rb, yb);
      const mid = (ang[k] + ang[(k + 1) % 6]) / 2 + (Math.abs(ang[k] - ang[(k + 1) % 6]) > Math.PI ? Math.PI : 0);
      const n = [Math.cos(mid), 0.08, Math.sin(mid)];
      // two stones a course a face
      const off = (row & 1) ? 0.3 : -0.3;
      const s0 = [a0[0] + (a1[0] - a0[0]) * (0.5 + off * 0.5), a0[1], a0[2] + (a1[2] - a0[2]) * (0.5 + off * 0.5)];
      const s1 = [b0[0] + (b1[0] - b0[0]) * (0.5 + off * 0.5), b0[1], b0[2] + (b1[2] - b0[2]) * (0.5 + off * 0.5)];
      B.quad(a0, s0, s1, b0, n, U0, FIELDSTONE[Math.floor(hash2(row, k * 2) * FIELDSTONE.length)]);
      B.quad(s0, a1, b1, s1, n, U0, FIELDSTONE[Math.floor(hash2(row, k * 2 + 1) * FIELDSTONE.length)]);
    }
  }
  // the door (toward the path, south-west) and slit windows up the shaft
  for (let k = 0; k < 6; k++) {
    const mid = (ang[k] + ang[(k + 1) % 6]) / 2 + (Math.abs(ang[k] - ang[(k + 1) % 6]) > Math.PI ? Math.PI : 0);
    const nx = Math.cos(mid), nz = Math.sin(mid);
    for (const [y, h, w] of k === 2 ? [[0, 2.2, 1.0], [6.5, 1.0, 0.35]] : [[4.2, 0.9, 0.3], [9.0, 1.0, 0.3]]) {
      const r = (R0 + (R1 - R0) * ((y + h / 2) / DECK)) * Math.cos(Math.PI / 6) + 0.03;
      B.box(cx + nx * r, y0 + y, cz + nz * r, 0.05, h, w, Math.atan2(nz, nx), DARK);
    }
  }
  // the lookout: the deck, six white columns, the iron railing
  const ring = (r, y) => [0, 1, 2, 3, 4, 5].map((k) => at(k, r, y));
  const deck = ring(R1 + 0.25, DECK);
  for (let k = 0; k < 6; k++) {
    const a = deck[k], b = deck[(k + 1) % 6];
    B.tri([cx, y0 + DECK, cz], a, b, [0, 1, 0], lin([0.55, 0.53, 0.50]));
    B.quad(a, b, [b[0], b[1] - 0.3, b[2]], [a[0], a[1] - 0.3, a[2]], [Math.cos(ang[k]), 0, Math.sin(ang[k])], U0, WHITE);
  }
  const cols = ring(R1 + 0.05, DECK);
  for (const c of cols) B.box(c[0], c[1], c[2], 0.32, EAVE - DECK, 0.32, 0, WHITE);
  for (let k = 0; k < 6; k++) {
    const a = cols[k], b = cols[(k + 1) % 6];
    for (const yy of [0.5, 1.05]) B.tube([a[0], a[1] + yy, a[2]], [b[0], b[1] + yy, b[2]], 0.035, 4, IRON);
    for (let t = 1; t < 6; t++) {
      const x = a[0] + (b[0] - a[0]) * t / 6, z = a[2] + (b[2] - a[2]) * t / 6;
      B.tube([x, a[1], z], [x, a[1] + 1.05, z], 0.015, 3, IRON);
    }
  }
  // the roof: a concave six-sided copper cap, eave to point, the spire and vane
  const eave = ring(R1 + 0.7, EAVE), knee = ring((R1 + 0.7) * 0.4, EAVE + 1.0), tip = [cx, y0 + TOWER.h - 0.6, cz];
  for (let k = 0; k < 6; k++) {
    const a = eave[k], b = eave[(k + 1) % 6], c = knee[(k + 1) % 6], d = knee[k];
    const mid = (ang[k] + ang[(k + 1) % 6]) / 2 + (Math.abs(ang[k] - ang[(k + 1) % 6]) > Math.PI ? Math.PI : 0);
    B.quad(a, b, c, d, [Math.cos(mid) * 0.5, 0.85, Math.sin(mid) * 0.5], U0, COPPER);
    B.tri(d, c, tip, [Math.cos(mid) * 0.85, 0.5, Math.sin(mid) * 0.85], shade(COPPER, 0.92));
    B.quad(a, b, [b[0], b[1] - 0.2, b[2]], [a[0], a[1] - 0.2, a[2]], [Math.cos(mid), 0, Math.sin(mid)], U0, WHITE);
    B.tri(a, b, [cx, y0 + EAVE - 0.2, cz], [0, -1, 0], WHITE);
  }
  B.tube(tip, [cx, y0 + TOWER.h + 0.6, cz], 0.05, 4, IRON);
  // the Conestoga wagon on the vane: a box with a hooped cover
  B.box(cx, y0 + TOWER.h + 0.25, cz, 0.7, 0.18, 0.28, 0.6, IRON);
  B.box(cx, y0 + TOWER.h + 0.43, cz, 0.55, 0.22, 0.3, 0.6, IRON);
  ctx.solids.push({ x: cx, z: cz, hw: R0 * 0.85, hd: R0 * 0.85, rot: 0, y0: y0 - 1, y1: y0 + DECK });
  if (ctx.clearAt) ctx.clearAt.push([cx, cz, R0 + 3]);
  STATS.tower = { x: Math.round(cx), z: Math.round(cz), y0: +y0.toFixed(1) };
}

// --- the West Montrose Covered Bridge -----------------------------------------------------------

const BARN_RED = lin([0.55, 0.16, 0.12]), RED_IN = lin([0.36, 0.20, 0.14]), SHINGLE = lin([0.40, 0.36, 0.31]);
const PLANK = lin([0.42, 0.34, 0.26]), CONC = lin([0.66, 0.65, 0.62]), STEEL = lin([0.30, 0.31, 0.32]);
const ORANGE = lin([0.95, 0.42, 0.06]);

function kissingBridge(kit, ctx) {
  const [ax, az] = KISSING.a, [bx, bz] = KISSING.b;
  const Lw = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / Lw, uz = (bz - az) / Lw, vx = -uz, vz = ux;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const B = kit.B(mx, mz);
  // the water under it, and the deck: over the floodplain (the rehabilitation raises it)
  let wl = -Infinity;
  for (let t = 0; t <= Lw; t += 3) { const w = G.waterLevel(ax + ux * t, az + uz * t); if (w !== null) wl = Math.max(wl, w); }
  const ea = T(ax, az), eb = T(bx, bz);
  const deckY = Math.max(ea, eb, wl + 3.2) + 0.1;
  const LC = 62, t0 = (Lw - LC) / 2, t1 = t0 + LC;   // the covered part, centred on the way
  const P = (t, v, y) => [ax + ux * t + vx * v, y, az + uz * t + vz * v];
  const rot = Math.atan2(uz, ux);
  const HW = 2.9, WALL = 4.3, RIDGE = 6.6;
  // approaches: ramps from each end of the way up to the deck
  for (const [ta, tb, ya, yb] of [[0, t0, ea + 0.1, deckY], [t1, Lw, deckY, eb + 0.1]]) {
    const NS = 6;
    for (let i = 0; i < NS; i++) {
      const s0 = ta + (tb - ta) * i / NS, s1 = ta + (tb - ta) * (i + 1) / NS;
      const y0 = ya + (yb - ya) * i / NS, y1 = ya + (yb - ya) * (i + 1) / NS;
      B.quad(P(s0, -2.6, y0), P(s1, -2.6, y1), P(s1, 2.6, y1), P(s0, 2.6, y0), [0, 1, 0], U0, lin([0.45, 0.43, 0.40]));
      for (const s of [-1, 1]) B.quad(P(s0, s * 2.6, y0), P(s1, s * 2.6, y1), P(s1, s * 2.6, Math.min(y1, T(...xz(P(s1, s * 2.6, 0)))) - 0.5), P(s0, s * 2.6, Math.min(y0, T(...xz(P(s0, s * 2.6, 0)))) - 0.5), [vx * s, 0, vz * s], U0, CONC);
      ctx.platforms.push({ x: ax + ux * (s0 + s1) / 2, z: az + uz * (s0 + s1) / 2, hw: 2.6, hd: (s1 - s0) / 2 + 0.05, rot: rot - Math.PI / 2, y0, y1 });
    }
  }
  // the deck and floor
  B.quad(P(t0, -HW, deckY), P(t1, -HW, deckY), P(t1, HW, deckY), P(t0, HW, deckY), [0, 1, 0], U0, PLANK);
  B.quad(P(t0, -HW, deckY - 1.1), P(t1, -HW, deckY - 1.1), P(t1, HW, deckY - 1.1), P(t0, HW, deckY - 1.1), [0, -1, 0], U0, shade(PLANK, 0.5));
  for (let i = 0; i < 8; i++) {
    const s0 = t0 + LC * i / 8, s1 = t0 + LC * (i + 1) / 8;
    ctx.platforms.push({ x: ax + ux * (s0 + s1) / 2, z: az + uz * (s0 + s1) / 2, hw: HW - 0.3, hd: (s1 - s0) / 2 + 0.05, rot: rot - Math.PI / 2, y0: deckY, y1: deckY });
  }
  // walls: red boards outside (battens every 0.6 m), plain inside, window openings down each side
  for (const s of [-1, 1]) {
    const n = [vx * s, 0, vz * s];
    B.quad(P(t0, s * HW, deckY - 1.1), P(t1, s * HW, deckY - 1.1), P(t1, s * HW, deckY + WALL), P(t0, s * HW, deckY + WALL), n, U0, BARN_RED);
    B.quad(P(t0, s * (HW - 0.15), deckY), P(t1, s * (HW - 0.15), deckY), P(t1, s * (HW - 0.15), deckY + WALL), P(t0, s * (HW - 0.15), deckY + WALL), [-n[0], 0, -n[2]], U0, RED_IN);
    for (let t = t0 + 0.3; t < t1; t += 0.6) B.box(...xz3(P(t, s * (HW + 0.02), deckY - 1.0)), 0.06, WALL + 0.9, 0.05, rot, shade(BARN_RED, 0.82));
    // window openings: dark on the outside face, light through them inside
    for (let t = t0 + 5; t < t1 - 4; t += 6.2) {
      if (Math.abs(t - (t0 + LC / 2)) < 2) continue;
      B.box(...xz3(P(t, s * (HW + 0.05), deckY + 1.6)), 1.4, 0.75, 0.04, rot, DARK);
      B.box(...xz3(P(t, s * (HW - 0.17), deckY + 1.6)), 1.4, 0.75, 0.04, rot, lin([0.75, 0.78, 0.80]));
    }
    ctx.solids.push({ x: mx + vx * s * HW, z: mz + vz * s * HW, hw: LC / 2, hd: 0.15, rot, y0: deckY, y1: deckY + WALL });
  }
  // portals: the gable ends with the opening (4.4 x 3.7 m), white-trimmed
  for (const [t, sg] of [[t0, -1], [t1, 1]]) {
    const n = [ux * sg, 0, uz * sg];
    B.quad(P(t, -HW, deckY + 3.7), P(t, HW, deckY + 3.7), P(t, HW, deckY + WALL), P(t, -HW, deckY + WALL), n, U0, BARN_RED);
    for (const s of [-1, 1]) B.quad(P(t, s * HW, deckY - 1.1), P(t, s * 2.2, deckY - 1.1), P(t, s * 2.2, deckY + 3.7), P(t, s * HW, deckY + 3.7), n, U0, BARN_RED);
    B.tri(P(t, -HW - 0.4, deckY + WALL), P(t, HW + 0.4, deckY + WALL), P(t, 0, deckY + RIDGE), n, BARN_RED);
    for (const s of [-1, 1]) B.box(...xz3(P(t + sg * 0.04, s * 2.25, deckY)), 0.1, 3.75, 0.14, rot, WHITE);
    B.box(...xz3(P(t + sg * 0.04, 0, deckY + 3.65)), 0.1, 0.14, 4.6, rot, WHITE);
  }
  // the roof: cedar shingles, weathered, overhanging the portals
  for (const s of [-1, 1]) {
    const o = 0.6;
    B.quad(P(t0 - o, s * (HW + 0.5), deckY + WALL - 0.25), P(t1 + o, s * (HW + 0.5), deckY + WALL - 0.25), P(t1 + o, 0, deckY + RIDGE + 0.15), P(t0 - o, 0, deckY + RIDGE + 0.15), [vx * s * 0.55, 0.83, vz * s * 0.55], U0, SHINGLE);
    B.quad(P(t0 - o, s * (HW + 0.5), deckY + WALL - 0.3), P(t1 + o, s * (HW + 0.5), deckY + WALL - 0.3), P(t1 + o, 0, deckY + RIDGE + 0.1), P(t0 - o, 0, deckY + RIDGE + 0.1), [-vx * s * 0.55, -0.83, -vz * s * 0.55], U0, RED_IN);
  }
  // the pier (mid-river) and abutments, concrete; the steel cribbing the bridge is lifted on
  const bed = (t) => T(...xz(P(t, 0, 0)));
  for (const [t, w] of [[t0 + 0.8, 1.8], [t0 + LC / 2, 2.2], [t1 - 0.8, 1.8]]) {
    B.box(...xz3(P(t, 0, bed(t) - 1)), w, deckY - 1.2 - bed(t) + 1, HW * 2 + 1.2, rot, CONC);
  }
  for (const t of [t0 + LC / 4, t0 + LC * 3 / 4]) {
    for (const s of [-1, 1]) {
      const [x, , z] = P(t, s * 1.8, 0), yb = Math.max(bed(t), wl - 0.5);
      B.box(x, yb, z, 1.4, deckY - 1.1 - yb, 1.4, rot, STEEL);
      for (let y = yb + 1; y < deckY - 1.2; y += 1.6) B.box(x, y, z, 1.6, 0.25, 1.6, rot, shade(STEEL, 1.3));
    }
  }
  // closed: construction fence and barrels across each approach, the Region's sign
  for (const [t, sg] of [[t0 - 4.5, -1], [t1 + 4.5, 1]]) {
    const y = deckY - (deckY - (sg < 0 ? ea : eb) - 0.1) * Math.min(1, 4.5 / Math.max(t0, 1));
    for (let v = -2.4; v <= 2.4; v += 1.2) {
      B.box(...xz3(P(t, v, y)), 0.05, 1.2, 1.15, rot, lin([0.86, 0.86, 0.84]));
      B.box(...xz3(P(t, v, y + 0.3)), 0.06, 0.18, 1.16, rot, ORANGE);
      B.box(...xz3(P(t, v, y + 0.8)), 0.06, 0.18, 1.16, rot, ORANGE);
    }
    ctx.solids.push({ x: ax + ux * t, z: az + uz * t, hw: 0.3, hd: 2.7, rot, y0: y - 0.5, y1: y + 1.4 });
  }
  if (ctx.atlas) {
    for (const [t, sg] of [[t0 - 5.5, -1], [t1 + 5.5, 1]]) {
      const pn = ctx.atlas.panel(2.0, 1.0, 60, (g, W, H) => {
        g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#e8590c'; g.fillRect(0, 0, W, H * 0.16); g.fillRect(0, H * 0.84, W, H * 0.16);
        g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `700 ${H * 0.3}px ${SANS}`; g.fillText('BRIDGE CLOSED', W / 2, H * 0.4, W * 0.92);
        g.font = `600 ${H * 0.14}px ${SANS}`; g.fillText('REHABILITATION · REGION OF WATERLOO', W / 2, H * 0.66, W * 0.92);
      });
      const p = P(t, 1.2, 0);
      const y = T(p[0], p[2]);
      pn.position.set(p[0], y + 1.6, p[2]);
      pn.rotation.y = Math.atan2(ux * sg, uz * sg);
      kit.grp(p[0], p[2]).add(pn);
      B.box(p[0], y, p[2], 0.08, 1.1, 0.08, 0, IRON);
    }
  }
  if (ctx.clearAt) ctx.clearAt.push([mx, mz, Lw / 2 + 4]);
  STATS.kissing = { deckY: +deckY.toFixed(1), water: +wl.toFixed(1), len: +Lw.toFixed(0) };
}
const xz = (p) => [p[0], p[2]];
const xz3 = (p) => [p[0], p[1], p[2]];

// --- the trails: bridges, signs, benches ---------------------------------------------------------

const DECK_C = lin([0.62, 0.61, 0.58]), DECK_W = lin([0.50, 0.38, 0.26]), RAIL_S = lin([0.22, 0.30, 0.26]), RAIL_W = lin([0.42, 0.31, 0.21]);

function trailBridges(kit, ctx) {
  const city = ctx.city;
  const existing = ctx.platforms.slice();
  for (const P of NET.paths) {
    if (!P.bridge || P.tunnel || P.len < 3 || P.len > 260) continue;
    const mid = NET.at(P, P.len / 2);
    // a road bridge's own footway, or a bridge a place module drew (Waterloo Park)
    // (along a road most of its length: a road bridge's footway, which the
    // road import draws; one CROSSING a road is a footbridge over it)
    let along = 0, nS = 0;
    for (let s = 1; s < P.len; s += 3) { const q = NET.at(P, s); nS++; if (city.onRoad(q.x, q.z, 2.5)) along++; }
    if (along > nS * 0.6) continue;
    if (existing.some((q) => Math.abs(q.x - mid.x) < 25 && Math.abs(q.z - mid.z) < 25)) continue;
    const wood = P.wood || /wood/.test(P.name || '');
    const conc = !wood && P.len > 60;
    const hw = wood ? 1.25 : 1.6;
    const ea = T(P.p[0][0], P.p[0][1]), eb = T(P.p[P.p.length - 1][0], P.p[P.p.length - 1][1]);
    let wl = -Infinity, gmax = -Infinity, road = -Infinity;
    for (let s = 0; s <= P.len; s += 2) {
      const q = NET.at(P, s);
      const w = G.waterLevel(q.x, q.z);
      if (w !== null && G.isWater(q.x, q.z)) wl = Math.max(wl, w);
      if (s > 3 && s < P.len - 3) gmax = Math.max(gmax, T(q.x, q.z));
      // over a road (a footbridge over the 401 or an expressway): a truck's clearance over it
      if (s > 2 && s < P.len - 2 && city.onRoad(q.x, q.z, 0.5)) road = Math.max(road, city.groundAt(q.x, q.z, null) + 5.4);
    }
    const ext = road > -Infinity ? Math.min(25, P.len * 0.3) : Math.min(4, P.len * 0.2);
    const need = Math.max(wl + 1.4, gmax + 0.6, road);
    const prof = (s) => {
      const lin0 = ea + (eb - ea) * s / P.len + 0.12;
      const hump = Math.max(0, need - lin0);
      const k = s < ext ? s / ext : s > P.len - ext ? (P.len - s) / ext : 1;
      return lin0 + hump * Math.max(0, Math.min(1, k)) + 0.25 * Math.sin(Math.PI * s / P.len);
    };
    const NS = Math.max(4, Math.ceil(P.len / 3));
    // recorded now (the decks are platforms before the city's are set), drawn
    // into bikes.js's ground chunk when it comes into range (groundDetail):
    // in a landmark cluster each bridge was a draw wherever kwsights' own
    // meshes were too big to merge with
    const rec = [];
    const B = { quad: (...a) => rec.push(0, a), tube: (...a) => rec.push(1, a), box: (...a) => rec.push(2, a) };
    DEFER.push({ x: mid.x, z: mid.z, rec });
    const deck = wood ? DECK_W : DECK_C, rail = wood ? RAIL_W : conc ? DECK_C : RAIL_S;
    for (let i = 0; i < NS; i++) {
      const s0 = P.len * i / NS, s1 = P.len * (i + 1) / NS;
      const a = NET.at(P, s0), b = NET.at(P, s1);
      const lx0 = Math.cos(a.h), lz0 = -Math.sin(a.h), lx1 = Math.cos(b.h), lz1 = -Math.sin(b.h);
      const y0 = prof(s0), y1 = prof(s1);
      const A = (s, o) => (s ? [b.x + lx1 * o, y1, b.z + lz1 * o] : [a.x + lx0 * o, y0, a.z + lz0 * o]);
      B.quad(A(0, -hw), A(1, -hw), A(1, hw), A(0, hw), [0, 1, 0], U0, deck);
      for (const sg of [-1, 1]) {
        const p0 = A(0, sg * hw), p1 = A(1, sg * hw);
        B.quad(p0, p1, [p1[0], p1[1] - 0.45, p1[2]], [p0[0], p0[1] - 0.45, p0[2]], [lx0 * sg, 0, lz0 * sg], U0, shade(deck, 0.7));
        if (conc) {
          // a concrete parapet (the old Freeport bridge)
          B.quad([p0[0], p0[1], p0[2]], [p1[0], p1[1], p1[2]], [p1[0], p1[1] + 1.0, p1[2]], [p0[0], p0[1] + 1.0, p0[2]], [-lx0 * sg, 0, -lz0 * sg], U0, shade(rail, 0.9));
          B.quad([p0[0], p0[1] + 1.0, p0[2]], [p1[0], p1[1] + 1.0, p1[2]], [p1[0] + lx1 * sg * 0.3, p1[1] + 1.0, p1[2] + lz1 * sg * 0.3], [p0[0] + lx0 * sg * 0.3, p0[1] + 1.0, p0[2] + lz0 * sg * 0.3], [0, 1, 0], U0, rail);
          B.quad([p0[0] + lx0 * sg * 0.3, p0[1] - 0.45, p0[2] + lz0 * sg * 0.3], [p1[0] + lx1 * sg * 0.3, p1[1] - 0.45, p1[2] + lz1 * sg * 0.3], [p1[0] + lx1 * sg * 0.3, p1[1] + 1.0, p1[2] + lz1 * sg * 0.3], [p0[0] + lx0 * sg * 0.3, p0[1] + 1.0, p0[2] + lz0 * sg * 0.3], [lx0 * sg, 0, lz0 * sg], U0, shade(rail, 0.8));
        } else {
          B.tube([p0[0], p0[1] + 1.05, p0[2]], [p1[0], p1[1] + 1.05, p1[2]], 0.04, 4, rail);
          B.tube([p0[0], p0[1] + 0.55, p0[2]], [p1[0], p1[1] + 0.55, p1[2]], 0.03, 4, rail);
          B.box(p0[0], p0[1], p0[2], 0.09, 1.08, 0.09, 0, rail);
        }
      }
      ctx.platforms.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, hw, hd: (s1 - s0) / 2 + 0.05, rot: Math.atan2(b.z - a.z, b.x - a.x) - Math.PI / 2, y0, y1 });
    }
    // piers under a long span
    if (P.len > 28) {
      const np = Math.floor(P.len / 24);
      for (let k = 1; k <= np; k++) {
        const s = P.len * k / (np + 1), q = NET.at(P, s), y = prof(s), g = T(q.x, q.z);
        if (city.onRoad(q.x, q.z, 1.5)) continue;   // never a pier in a lane
        B.box(q.x, g - 2, q.z, conc ? 1.6 : 0.6, y - 0.45 - g + 2, hw * 2 + (conc ? 0.6 : 0), -q.h + Math.PI / 2, conc ? CONC : STEEL);
      }
    }
    P.deck = true;
    STATS.bridges++;
    (STATS.bridgeAt || (STATS.bridgeAt = [])).push([P.name || '', Math.round(mid.x), Math.round(mid.z), Math.round(P.len), conc ? 'c' : wood ? 'w' : 's']);
  }
}

/** A trail's sign: two posts and a panel each way, where a named trail meets a road. */
function trailSigns(kit, ctx) {
  if (!ctx.atlas) return;
  const city = ctx.city;
  const panels = new Map();
  const panel = (name) => {
    let p = panels.get(name);
    if (p) return p;
    const tct = /trans.?canada/i.test(name);
    const words = name.replace(/\s*\(.*\)$/, '').toUpperCase().split(/\s+/);
    // two lines when long: the name, then the last word or two
    let l1 = words.join(' '), l2 = '';
    if (l1.length > 16 && words.length > 1) {
      let cut = words.length - 1;
      while (cut > 1 && words.slice(cut).join(' ').length < l1.length / 2.5) cut--;
      l1 = words.slice(0, cut).join(' '); l2 = words.slice(cut).join(' ');
    }
    // (one panel drawn per name; each sign face is a copy of its mesh)
    const first = ctx.atlas.panel(1.5, 0.62, 80, (g, W, H) => {
      g.fillStyle = tct ? '#b3232b' : '#1f4a33'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#efe8d4'; g.lineWidth = H * 0.04; g.strokeRect(H * 0.06, H * 0.06, W - H * 0.12, H - H * 0.12);
      g.fillStyle = '#efe8d4'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 ${H * (l2 ? 0.27 : 0.36)}px ${SANS}`;
      if (l2) { g.fillText(l1, W / 2, H * 0.34, W * 0.88); g.fillText(l2, W / 2, H * 0.68, W * 0.88); } else g.fillText(l1, W / 2, H * 0.52, W * 0.88);
    });
    p = () => first.clone();
    panels.set(name, p);
    return p;
  };
  const placed = [];
  const POST = lin([0.33, 0.24, 0.16]);
  // the region's trails proper (over 2 km of them on the map), not every named park path
  const tot = new Map();
  for (const P of NET.paths) if (P.name) tot.set(P.name, (tot.get(P.name) || 0) + P.len);
  for (const P of NET.paths) {
    if (!P.name || !/trail|trailway|loop/i.test(P.name) || P.bridge || P.tunnel || P.len < 25 || tot.get(P.name) < 2000) continue;
    for (const end of [0, 1]) {
      const e = P.p[end ? P.p.length - 1 : 0];
      if (!city.onRoad(e[0], e[1], 7)) continue;
      const s = end ? P.len - 7 : 7, q = NET.at(P, s);
      if (placed.some((o) => o.n === P.name && Math.hypot(o.x - q.x, o.z - q.z) < 700)) continue;
      if (placed.some((o) => Math.hypot(o.x - q.x, o.z - q.z) < 20)) continue;
      // beside the trail, the panel across it, read from the road
      const lx = Math.cos(q.h), lz = -Math.sin(q.h);
      let x = q.x + lx * 2.4, z = q.z + lz * 2.4;
      if (city.onRoad(x, z, 1.5) || G.isWater(x, z)) { x = q.x - lx * 2.4; z = q.z - lz * 2.4; }
      if (city.onRoad(x, z, 1.5) || G.isWater(x, z)) continue;
      const y = T(x, z), B = kit.B(x, z);
      const fx = Math.sin(q.h) * (end ? 1 : -1), fz = Math.cos(q.h) * (end ? 1 : -1);   // toward the road
      for (const o of [-0.65, 0.65]) B.box(x + lx * o, y - 0.2, z + lz * o, 0.12, 2.35, 0.12, 0, POST);
      B.box(x, y + 1.45, z, 1.55, 0.7, 0.06, Math.atan2(lz, lx), POST);
      const mk = panel(P.name);
      for (const sg of [1, -1]) {
        const m = mk();
        m.position.set(x + fx * sg * 0.035, y + 1.8, z + fz * sg * 0.035);
        m.rotation.y = Math.atan2(fx * sg, fz * sg);
        kit.grp(x, z).add(m);
      }
      ctx.solids.push({ x, z, hw: 0.8, hd: 0.12, rot: Math.atan2(lz, lx), y0: y - 0.2, y1: y + 2.1 });
      if (ctx.clearAt) ctx.clearAt.push([x, z, 1.6]);
      placed.push({ n: P.name, x: q.x, z: q.z });
      if (!STATS.signAt) STATS.signAt = [];
      if (STATS.signAt.length < 12) STATS.signAt.push([P.name, Math.round(x), Math.round(z), Math.round(q.x), Math.round(q.z)]);
      STATS.signs++;
    }
  }
}

/** Where the benches go: beside a named trail every couple of hundred
 *  metres, on level open ground; bucketed by bikes.js's chunk. */
function benchSpots(size) {
  const out = new Map(), city = CITY;
  for (const P of NET.paths) {
    if (!P.name || P.bridge || P.tunnel || P.len < 80 || P.wood) continue;
    const step = 210 + 90 * hash2(P.i, 3);
    for (let s = 40 + 100 * hash2(P.i, 7); s < P.len - 20; s += step) {
      const q = NET.at(P, s);
      const sg = hash2(P.i, Math.round(s)) < 0.5 ? 1 : -1;
      const lx = Math.cos(q.h) * sg, lz = -Math.sin(q.h) * sg;
      const off = (P.earth ? 0.6 : P.gravel ? 1.3 : 1.5) + 1.1;
      const x = q.x + lx * off, z = q.z + lz * off;
      if (G.isWater(x, z) || city.onRoad(x, z, 2) || Math.abs(T(x + lx, z + lz) - T(x - lx, z - lz)) > 0.6) continue;
      if (inBld(city, x, z) || NET.keepClear(x, z)) continue;
      const k = `${Math.floor(x / size)},${Math.floor(z / size)}`;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push({ x, z, ax: Math.sin(q.h), az: Math.cos(q.h), lx, lz });
      STATS.benches++;
    }
  }
  return out;
}

const BENCH_WOOD = lin([0.45, 0.30, 0.18]), BENCH_FRAME = lin([0.10, 0.10, 0.10]);
function drawBench(B, { x, z, ax, az, lx, lz }) {
  const y = T(x, z), rot = Math.atan2(az, ax);   // the seat along the trail, the back away from it
  for (const o of [-0.75, 0.75]) B.box(x + ax * o, y - 0.1, z + az * o, 0.08, 0.55, 0.5, rot, BENCH_FRAME);
  B.box(x, y + 0.43, z, 1.8, 0.06, 0.46, rot, BENCH_WOOD);
  const bx = x + lx * 0.25, bz = z + lz * 0.25;
  B.box(bx, y + 0.5, bz, 1.8, 0.42, 0.05, rot, BENCH_WOOD);
  for (const o of [-0.75, 0.75]) B.box(bx + ax * o, y + 0.4, bz + az * o, 0.06, 0.55, 0.06, rot, BENCH_FRAME);
}

/**
 * bikes.js's ground-detail hook: which of its 1 km chunks have something of
 * ours (a river bank, a bench), and drawing it into the chunk's mesh when the
 * chunk is first in range. One material (bikes.js's), no draw of its own
 * where the chunk has a trail anyway, nothing built at boot.
 */
let BENCHES = null;
const DEFER = [];   // trail bridges' recorded geometry: { x, z, rec }
const replay = (b, rec) => {
  for (let i = 0; i < rec.length; i += 2) {
    const a = rec[i + 1];
    if (rec[i] === 0) b.quad(...a); else if (rec[i] === 1) b.tube(...a); else b.box(...a);
  }
};
export const groundDetail = {
  keys(size) {
    if (typeof window !== 'undefined' && window.__noNature) return new Set();
    const t0 = performance.now();
    BENCHES = NET ? benchSpots(size) : new Map();
    // the benches are solid (a landmark solid each: seat and back as one
    // box, knee-high to the back's top), joined after the landmarks' and the
    // freeways' -- a bench is never on a carriageway (benchSpots)
    if (CITY && CITY.addLandmarkSolids) {
      const sol = [];
      for (const l of BENCHES.values()) for (const { x, z, ax, az, lx, lz } of l) {
        const y = T(x, z);
        sol.push({ x: x + lx * 0.1, z: z + lz * 0.1, hw: 0.95, hd: 0.34, rot: Math.atan2(az, ax), y0: y - 0.1, y1: y + 0.95 });
      }
      CITY.addLandmarkSolids(sol);
      STATS.benchSolids = sol.length;
    }
    const k = shoreChunks(size);
    for (const b of BENCHES.keys()) k.add(b);
    for (const d of DEFER) { d.key = `${Math.floor(d.x / size)},${Math.floor(d.z / size)}`; k.add(d.key); }
    STATS.groundKeysMs = Math.round(performance.now() - t0);
    return k;
  },
  draw(b, x0, z0, size) {
    const key = `${Math.floor((x0 + 1) / size)},${Math.floor((z0 + 1) / size)}`;
    drawShore(b, x0, z0, size);
    for (const bn of (BENCHES && BENCHES.get(key)) || []) drawBench(b, bn);
    for (const d of DEFER) if (d.key === key) replay(b, d.rec);
  },
};

export function natureStats() { return STATS; }
