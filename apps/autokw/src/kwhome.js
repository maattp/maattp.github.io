// THE NORTH-EAST WATERLOO THE PLAYER GREW UP IN, and Conestoga's Doon campus
// (data/home.json, tools/kw/build_home.py; docs/home-*.jpg).
//
// Each place from its OSM footprint, laid out against Esri World Imagery
// (tools/kw/aerial.py) and the photographs on Wikimedia Commons:
//
//   - UNIVERSITY & BRIDGE (425 University Ave E): one 52-sided building of
//     tan brick -- Rexall at the north tip, FreshCo's raised green entrance in
//     the middle (its vestibule is the bump on the lot side in the aerial), the
//     units down the south-east wing under a walkway canopy (Uncle's Shwarma,
//     Subway, New Orleans Pizza, Global Pet Foods, Mediterraneo); loading
//     docks behind; a pylon at the corner. The Tims, the 7-Eleven and the Esso
//     on their pads are kw.js's and kwshops.js's.
//   - THE STUDENT PLAZA at University Ave W and Phillip St: every unit OSM
//     maps, grouped as the buildings they are (University Shops Plaza's big
//     160 block with its row of 13 units facing University, the 170 row,
//     Molly Bloom's, the 158/160 corner; Campus Court across Phillip) in
//     red-brown brick under the BROWN SHINGLED MANSARDS the aerial shows on
//     every one of them -- Campus Court's tall, the second storey inside the
//     roof with gabled dormers, an L round its lot. Each shop OSM maps gets
//     its own sign over its own door.
//   - CONESTOGA DOON: the Recreation Centre's two dark barrel vaults sunk in
//     grass berms (Commons, "Gymnasium Corner"; the aerial's two black roofs),
//     with the flat-roofed lobby between and along them; the wings in
//     red-brown brick (Commons photos), CONESTOGA high on B Wing over the
//     library pond; the Doon residence (99 Conestoga College Blvd), U-shaped.
//   - THE BRIDGEPORT BRIDGE (1934): Bridge St's five-span concrete bowstring
//     arches over the Grand (Region of Waterloo heritage bridge, rehabilitated).
//   - ST. MATTHEW AND ST. DAVID: their buildings through kw.js buildSchools
//     (SCHOOL_HOOKS), into that school's own mesh.
//
// Phone cost: everything goes into kwshops.js's two builders per 1200 m cluster
// (SHOP_HOOKS: kw.js's footprint material, the brand atlas) or the school's
// own mesh, so it adds triangles but no draws where those clusters already
// draw; a footprint drawn here is flattened first (kw.skip) so nothing else
// draws it.

import * as G from './geo.js';
import { hash2 } from './util.js';
import { boxAt, SCHOOL_HOOKS, LOOKS } from './kw.js';
import { SHOP_HOOKS } from './kwshops.js';
import { inPoly, polyArea, centroid, obb, edges, street, roof, lin, shade, T } from './kwplaces.js';

let H = null;
const STATS = {};
const hexL = (h) => lin([parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]);
const ccw = (p) => (polyArea(p) < 0 ? p.slice().reverse() : p);
const U0 = [0, 0, 0, 0, 0, 0, 0, 0];

// --- before meshing ----------------------------------------------------------------------

/** Every box under a footprint drawn here goes flat and is skipped by world.js, buildPolys, kwshops and the signs. */
function flatten(city, pts) {
  const [cx, cz] = centroid(pts);
  let r = 0;
  for (const q of pts) r = Math.max(r, Math.hypot(q[0] - cx, q[1] - cz));
  const A = Math.abs(polyArea(pts));
  const hit = new Set();
  const b = boxAt(city, cx, cz, 2);
  if (b && b.w * b.d < A * 4 + 300) hit.add(b);
  for (const o of city.buildingsNear(cx, cz, Math.max(60, r))) if (inPoly(pts, o.x, o.z) && o.w * o.d < A * 2 + 200) hit.add(o);
  for (const o of hit) {
    o.h = 0;
    if (!o.kw) o.kw = {};
    o.kw.skip = true;
    delete o.kw.poly;
    delete o.kw.strip;
  }
  return hit.size;
}

// Conestoga Doon's wings: red-brown brick (Commons: "Conestoga College (Doon Campus)",
// "Conestoga College, Kitchener" 2008), heights in storeys x ~4.2 m
const CON_BRICK = { m: 'brick', c: [0.60, 0.36, 0.27], u: 12, v: 12 };
const CON_H = { 'A Wing': 11.5, 'B Wing': 10.5, 'C Wing': 8.5, 'D Wing': 8.5, 'E Wing': 8.5, 'F Wing': 8.5, 'Welcome Centre': 8,
  'Employee Services BLDG': 7.5, 'Early Childhood Education BLDG': 7, 'A.T.S Engineering Complex': 9, 'Toyota Power Engineering Centre': 7,
  'Woodworking Centre of Ontario': 8.5, 'Service Facilities/Power House': 7.5, 'Emergency Medical Services': 7 };

export function prepHome(city, data) {
  H = data;
  if (typeof window !== 'undefined' && window.__noHome) H = null;
  if (!H) return { skipped: 0 };
  let n = 0;
  n += flatten(city, H.ub.p);
  for (const u of H.uwp) if (uwpGroup(u)) n += flatten(city, u.p);
  n += flatten(city, H.stm.p);
  for (const p of H.stm.port) n += flatten(city, p);
  n += flatten(city, H.con.rec.p);
  n += flatten(city, H.con.res.p);
  let wings = 0;
  for (const w of H.con.named) {
    const b = boxAt(city, w.x, w.z, 2);
    if (!b || !CON_H[w.n] || (b.kw && b.kw.skip)) continue;
    if (!b.kw) b.kw = {};
    if (b.kw.poly) { b.kw.poly.fam = CON_BRICK; b.kw.poly.h = CON_H[w.n]; b.kw.poly.retail = false; b.kw.poly.arena = false; }   // a box is left as it is: a new family or height can be a new material in its chunk (a draw)
    wings++;
  }
  // St. David's footprint is unnamed in OSM: its look by position (kw.js LOOKS)
  const [dx, dz] = centroid(H.std.p);
  const sd = boxAt(city, dx, dz, 3), SL = LOOKS['St. David Catholic Secondary School'];
  if (sd && sd.kw && sd.kw.poly && SL) { sd.kw.poly.fam = SL.fam; sd.kw.poly.h = SL.h; }
  STATS.prep = { flat: n, wings, stDavid: !!(sd && sd.kw && sd.kw.poly) };
  SHOP_HOOKS.push(buildHome);
  SCHOOL_HOOKS.push(schoolHome);
  return { skipped: n, wings };
}

// --- geometry ----------------------------------------------------------------------------

/** Outward unit normals of a ring's edges, and each vertex moved d out along the mitre (clamped). */
function offsetRing(pts, d) {
  const E = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz) || 1;
    let nx = dz / L, nz = -dx / L;
    if (inPoly(pts, a[0] + dx / 2 + nx * 0.3, a[1] + dz / 2 + nz * 0.3)) { nx = -nx; nz = -nz; }
    E.push([nx, nz]);
  }
  return pts.map((p, i) => {
    const [ax, az] = E[(i + n - 1) % n], [bx, bz] = E[i];
    const k = 1 + ax * bx + az * bz;
    let mx = (ax + bx) / Math.max(k, 0.25), mz = (az + bz) / Math.max(k, 0.25);
    const ml = Math.hypot(mx, mz);
    if (ml > 2.5) { mx *= 2.5 / ml; mz *= 2.5 / ml; }
    return [p[0] + mx * d, p[1] + mz * d];
  });
}

/** A 3D point on edge e: t along it, height y, `off` out from the wall. */
const at = (e, t, y, off = 0) => e.at(t, y, off);

/**
 * Walls of a footprint (from below its lowest corner to `top`), as solids too.
 * `skip(e)` leaves an edge out (a party wall inside a neighbour).
 */
function walls(Bd, solid, pts, top, col, skip = null) {
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const dark = shade(col, 0.8);
  const E = edges(pts);
  for (const e of E) {
    if (skip && skip(e)) continue;
    Bd.quad(at(e, 0, lo - 1.2), at(e, e.L, lo - 1.2), at(e, e.L, top), at(e, 0, top), [e.nx, 0, e.nz], U0, [dark, dark, col, col]);
    solid({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: lo - 1.2, y1: top });
  }
  return { E, lo };
}

/** A storefront on edge e from t0 to t1: glass to 3 m, aluminium mullions, a door every other bay. */
function storefront(Bd, e, t0, t1, gy, o = {}) {
  const GL = o.glass || lin([0.13, 0.17, 0.21]), FR = o.frame || lin([0.62, 0.63, 0.64]);
  const top = gy + (o.h || 2.9), N = [e.nx, 0, e.nz];
  if (t1 - t0 < 1.5) return;
  Bd.quad(at(e, t0, gy + 0.35, 0.04), at(e, t1, gy + 0.35, 0.04), at(e, t1, top, 0.04), at(e, t0, top, 0.04), N, U0, [GL, GL, shade(GL, 1.7), shade(GL, 1.7)]);
  Bd.quad(at(e, t0, gy - 0.3, 0.05), at(e, t1, gy - 0.3, 0.05), at(e, t1, gy + 0.35, 0.05), at(e, t0, gy + 0.35, 0.05), N, U0, o.base || shade(FR, 0.7));
  const nb = Math.max(1, Math.round((t1 - t0) / (o.bay || 3.0)));
  for (let k = 0; k <= nb; k++) {
    const t = t0 + (k / nb) * (t1 - t0);
    Bd.quad(at(e, t - 0.06, gy + 0.35, 0.07), at(e, t + 0.06, gy + 0.35, 0.07), at(e, t + 0.06, top, 0.07), at(e, t - 0.06, top, 0.07), N, U0, FR);
    if (k < nb && k % 2 === 1) {
      // a door: its frame and push bar
      const tm = t + (t1 - t0) / nb / 2;
      Bd.quad(at(e, tm - 0.5, gy - 0.05, 0.08), at(e, tm + 0.5, gy - 0.05, 0.08), at(e, tm + 0.5, gy + 2.2, 0.08), at(e, tm - 0.5, gy + 2.2, 0.08), N, U0, shade(GL, 0.7));
      Bd.quad(at(e, tm - 0.45, gy + 1.0, 0.1), at(e, tm + 0.45, gy + 1.0, 0.1), at(e, tm + 0.45, gy + 1.06, 0.1), at(e, tm - 0.45, gy + 1.06, 0.1), N, U0, FR);
    }
  }
  Bd.quad(at(e, t0, top, 0.07), at(e, t1, top, 0.07), at(e, t1, top + 0.12, 0.07), at(e, t0, top + 0.12, 0.07), N, U0, FR);
}

/** Punched windows in a row along edge e at sill height y. */
function windows(Bd, e, y, h, sp, w, col, frame, t0 = 0.8, t1 = null) {
  t1 = t1 ?? e.L - 0.8;
  const nw = Math.floor((t1 - t0) / sp);
  if (nw < 1) return;
  const pad = (t1 - t0 - nw * sp) / 2, N = [e.nx, 0, e.nz];
  for (let i = 0; i < nw; i++) {
    const t = t0 + pad + sp * (i + 0.5);
    Bd.quad(at(e, t - w / 2 - 0.08, y - 0.08, 0.02), at(e, t + w / 2 + 0.08, y - 0.08, 0.02), at(e, t + w / 2 + 0.08, y + h + 0.08, 0.02), at(e, t - w / 2 - 0.08, y + h + 0.08, 0.02), N, U0, frame);
    Bd.quad(at(e, t - w / 2, y, 0.04), at(e, t + w / 2, y, 0.04), at(e, t + w / 2, y + h, 0.04), at(e, t - w / 2, y + h, 0.04), N, U0, [col, col, shade(col, 1.6), shade(col, 1.6)]);
  }
}

/** A mansard on edge e: shingles from `out` past the wall at yE up to `inn` inside it at yT, the ends run past by `ext`. */
function mansardEdge(Bd, e, yE, yT, out, inn, col, ext = 0.8) {
  const ny = (out + inn) / Math.hypot(out + inn, yT - yE);
  const nh = (yT - yE) / Math.hypot(out + inn, yT - yE);
  const N = [e.nx * nh, ny, e.nz * nh];
  Bd.quad(at(e, -ext, yE, out), at(e, e.L + ext, yE, out), at(e, e.L + ext, yT, -inn), at(e, -ext, yT, -inn), N, U0, [shade(col, 0.85), shade(col, 0.85), col, col]);
  // the soffit under the eave and the back of the band over the roof
  Bd.quad(at(e, -ext, yE, 0), at(e, e.L + ext, yE, 0), at(e, e.L + ext, yE, out), at(e, -ext, yE, out), [0, -1, 0], U0, shade(col, 0.45));
  Bd.quad(at(e, -ext, yT - 0.7, -inn), at(e, e.L + ext, yT - 0.7, -inn), at(e, e.L + ext, yT, -inn), at(e, -ext, yT, -inn), [-e.nx, 0, -e.nz], U0, shade(col, 0.6));
  // the cap
  Bd.quad(at(e, -ext, yT, -inn), at(e, e.L + ext, yT, -inn), at(e, e.L + ext, yT + 0.08, -inn - 0.25), at(e, -ext, yT + 0.08, -inn - 0.25), [0, 1, 0], U0, shade(col, 0.7));
}

/** A gabled dormer on a mansard slope of edge e, centred at t: its window faces out. */
function dormer(Bd, e, t, yE, yT, out, inn, col, wall, glass) {
  const s = (yT - yE) / (out + inn);       // rise per metre in
  const off = -inn * 0.15 + out * 0.15;    // the dormer face, part way up the slope
  const yb = yE + (out - off) * s, w = 0.95;
  const yt = yb + 1.7, yr = yt + 0.7;
  const back = off - 2.0;
  const ybk = yE + (out - back) * s;       // where its roof meets the slope
  const N = [e.nx, 0, e.nz];
  Bd.quad(at(e, t - w, yb - 0.1, off), at(e, t + w, yb - 0.1, off), at(e, t + w, yt, off), at(e, t - w, yt, off), N, U0, wall);
  Bd.tri(at(e, t - w - 0.1, yt, off + 0.1), at(e, t + w + 0.1, yt, off + 0.1), at(e, t, yr, off + 0.1), N, wall);
  Bd.quad(at(e, t - 0.6, yb + 0.25, off + 0.03), at(e, t + 0.6, yb + 0.25, off + 0.03), at(e, t + 0.6, yt - 0.2, off + 0.03), at(e, t - 0.6, yt - 0.2, off + 0.03), N, U0, glass);
  for (const sd of [-1, 1]) {
    const ex = [e.ux * sd, 0, e.uz * sd];
    Bd.quad(at(e, t + sd * w, yb - 0.1, off), at(e, t + sd * w, yb - 0.1, back), at(e, t + sd * w, Math.max(yt, ybk), back), at(e, t + sd * w, yt, off), ex, U0, shade(wall, 0.8));
    // the dormer's roof, from its ridge down to the eave each side
    Bd.quad(at(e, t, yr, off + 0.25), at(e, t + sd * (w + 0.25), yt - 0.05, off + 0.25), at(e, t + sd * (w + 0.25), yt - 0.05, back), at(e, t, yr, back), [e.ux * sd * 0.7, 0.7, e.uz * sd * 0.7], U0, col);
  }
}

// --- lettering: cells in kwshops.js's brand atlas -----------------------------------------

function cellText(K, s, fg, bgc, w = 210, h = 34, font = 'Helvetica, Arial, sans-serif', wt = 800) {
  return K.A.cell(`home:${s}|${fg}|${bgc}|${w}x${h}`, w, h, (g, W, Hh) => {
    if (bgc) { g.fillStyle = bgc; g.fillRect(0, 0, W, Hh); } else g.clearRect(0, 0, W, Hh);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${wt} ${Hh * 0.6}px ${font}`;
    g.fillText(s, W / 2, Hh * 0.55, W * 0.92);
  });
}
/** A sign of cell c on edge e at t, centred at height y, `off` out from the wall, at most w wide and h tall. */
function sign(K, c, e, t, y, w, h, off = 0.12) {
  if (!c) return;
  let lw = h * c.a, lh = h;
  if (lw > w) { lw = w; lh = w / c.a; }
  const p = at(e, t, y, off);
  K.A.quad(K.Lb(p[0], p[2]), c, p[0], y, p[2], e.nx, e.nz, lw, lh);
}
/** A plain tenant's sign: a brand's logo if kwshops draws it, else lettering in a colour by name. */
const SIGN_PAL = [['#7a1f1f', '#ffffff'], ['#1d3557', '#ffffff'], ['#f4efe2', '#7a1f1f'], ['#2b2b2b', '#ffd23f'], ['#0f5e3a', '#ffffff'],
  ['#ffffff', '#1d3557'], ['#c8102e', '#ffffff'], ['#3d2b1f', '#f4d58d'], ['#f2c230', '#2b2b2b'], ['#2a2c30', '#ffffff']];
function tenantCell(K, name, seed) {
  const k = K.brandOf(name);
  if (k) { const c = K.logoOf(k); if (c) return c; }
  const [bgc, fg] = SIGN_PAL[Math.floor(hash2(seed, 31) * SIGN_PAL.length)];
  const w = Math.max(130, Math.min(300, 40 + name.length * 13));
  return cellText(K, name, fg, bgc, w, 34);
}

/** The edge of E nearest (x, z) among those `ok` says take a sign, and the distance along it. */
function nearestEdge(E, x, z, ok = null) {
  let best = null, bd = Infinity;
  for (const e of E) {
    if (e.L < 2.5 || (ok && !ok(e))) continue;
    const t = Math.max(0, Math.min(e.L, (x - e.a[0]) * e.ux + (z - e.a[1]) * e.uz));
    const qx = e.a[0] + e.ux * t, qz = e.a[1] + e.uz * t;
    const d = Math.hypot(x - qx, z - qz);
    if (d < bd) { bd = d; best = { e, t, d }; }
  }
  return best;
}

// --- University & Bridge -----------------------------------------------------------------

const UB_BRICK = lin([0.74, 0.60, 0.46]), UB_BASE = lin([0.55, 0.50, 0.45]), UB_FASCIA = lin([0.86, 0.82, 0.74]);
const UB_LOT = [-1445, -4140];           // the lot's middle, the side the stores face
const UB_FRESH = [-1385, -4176];         // FreshCo's vestibule (the bump on the lot side in the aerial)

function uniBridge(K) {
  const { Gb, ctx, solid } = K;
  const pts = ccw(H.ub.p);
  const [cx, cz] = centroid(pts);
  const Bd = Gb(cx, cz);
  const base = T(cx, cz), top = base + 6.0;
  const { E } = walls(Bd, solid, pts, top + 0.6, UB_BRICK);
  roof(Bd, pts, top + 0.05, lin([0.66, 0.66, 0.64]));
  for (const e of E) Bd.quad(at(e, 0, top + 0.6, 0.1), at(e, e.L, top + 0.6, 0.1), at(e, e.L, top + 0.72, -0.2), at(e, 0, top + 0.72, -0.2), [0, 1, 0], U0, UB_FASCIA);
  const front = (e) => {
    const dx = UB_LOT[0] - e.mx, dz = UB_LOT[1] - e.mz, dl = Math.hypot(dx, dz) || 1;
    return (dx * e.nx + dz * e.nz) / dl > 0.2;
  };
  let units = 0;
  for (const e of E) {
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2), N = [e.nx, 0, e.nz];
    Bd.quad(at(e, 0, gy - 0.4, 0.04), at(e, e.L, gy - 0.4, 0.04), at(e, e.L, gy + 0.5, 0.04), at(e, 0, gy + 0.5, 0.04), N, U0, UB_BASE);
    if (!front(e)) {
      // the back: a man door now and then, the loading docks behind FreshCo
      if (e.L > 12) {
        const dk = Math.abs(e.mz - UB_FRESH[1]) < 30;
        for (let t = 6; t < e.L - 4; t += dk ? 7 : 18) {
          if (dk) Bd.quad(at(e, t - 1.5, gy + 0.9, 0.05), at(e, t + 1.5, gy + 0.9, 0.05), at(e, t + 1.5, gy + 3.8, 0.05), at(e, t - 1.5, gy + 3.8, 0.05), N, U0, lin([0.70, 0.71, 0.72]));
          else Bd.quad(at(e, t - 0.5, gy, 0.05), at(e, t + 0.5, gy, 0.05), at(e, t + 0.5, gy + 2.1, 0.05), at(e, t - 0.5, gy + 2.1, 0.05), N, U0, lin([0.45, 0.32, 0.25]));
        }
      }
      continue;
    }
    if (e.L < 3) continue;
    storefront(Bd, e, 0.6, e.L - 0.6, gy, { bay: 3.2 });
    // the sign band, and on the wing (south of FreshCo) a walkway canopy on posts
    Bd.quad(at(e, 0, gy + 3.3, 0.15), at(e, e.L, gy + 3.3, 0.15), at(e, e.L, gy + 4.7, 0.15), at(e, 0, gy + 4.7, 0.15), N, U0, UB_FASCIA);
    if (e.mz > -4150) {
      const D = 2.6, y = gy + 3.25;
      Bd.quad(at(e, 0, y, D), at(e, e.L, y, D), at(e, e.L, y, 0), at(e, 0, y, 0), [0, -1, 0], U0, lin([0.80, 0.78, 0.74]));
      Bd.quad(at(e, 0, y + 0.45, 0), at(e, e.L, y + 0.45, 0), at(e, e.L, y + 0.45, D), at(e, 0, y + 0.45, D), [0, 1, 0], U0, lin([0.6, 0.6, 0.6]));
      Bd.quad(at(e, 0, y, D), at(e, e.L, y, D), at(e, e.L, y + 0.45, D), at(e, 0, y + 0.45, D), N, U0, UB_FASCIA);
      for (let t = 1.5; t < e.L; t += 6.4) {
        const p = at(e, t, gy, D - 0.25);
        Bd.box(p[0], gy - 0.2, p[2], 0.35, 3.5, 0.35, Math.atan2(e.uz, e.ux), UB_BRICK);
        solid({ x: p[0], z: p[2], r: 0.25, y0: gy - 1, y1: gy + 3.4 });
      }
      units++;
    }
  }
  // FreshCo's entrance: a raised green parapet over a glass vestibule
  const fe = nearestEdge(E, UB_FRESH[0], UB_FRESH[1], front);
  if (fe) {
    const { e } = fe, t = Math.max(11, Math.min(e.L - 11, fe.t)), gy = T(e.mx + e.nx * 3, e.mz + e.nz * 3), N = [e.nx, 0, e.nz];
    const GREEN = lin([0.30, 0.60, 0.16]), ORANGE = lin([0.95, 0.57, 0.0]);
    Bd.quad(at(e, t - 10, gy + 4.7, 0.2), at(e, t + 10, gy + 4.7, 0.2), at(e, t + 10, gy + 8.6, 0.2), at(e, t - 10, gy + 8.6, 0.2), N, U0, GREEN);
    Bd.quad(at(e, t - 10, gy + 8.6, 0.2), at(e, t + 10, gy + 8.6, 0.2), at(e, t + 10, gy + 8.6, -2), at(e, t - 10, gy + 8.6, -2), [0, 1, 0], U0, shade(GREEN, 0.7));
    for (const sd of [-1, 1]) Bd.quad(at(e, t + sd * 10, gy + 4.7, 0.2), at(e, t + sd * 10, gy + 4.7, -2), at(e, t + sd * 10, gy + 8.6, -2), at(e, t + sd * 10, gy + 8.6, 0.2), [e.ux * sd, 0, e.uz * sd], U0, shade(GREEN, 0.85));
    Bd.quad(at(e, t - 10, gy + 4.7, 0.21), at(e, t + 10, gy + 4.7, 0.21), at(e, t + 10, gy + 4.95, 0.21), at(e, t - 10, gy + 4.95, 0.21), N, U0, ORANGE);
    // the vestibule: 9 m of glass box standing 4 m out
    const p = at(e, t, gy, 2.0), rot = Math.atan2(e.uz, e.ux);
    Bd.box(p[0], gy - 0.2, p[2], 9, 3.8, 4, rot, lin([0.16, 0.20, 0.24]));
    Bd.box(p[0], gy + 3.6, p[2], 9.6, 0.5, 4.6, rot, lin([0.86, 0.86, 0.84]));
    solid({ x: p[0], z: p[2], hw: 4.5, hd: 2, rot, y0: gy - 1, y1: gy + 4 });
    const c = K.A.cell('home:freshco', 255, 68, (g, W, Hh) => {
      g.fillStyle = '#4c9a2a'; g.fillRect(0, 0, W, Hh);     // FreshCo's green (the atlas material is opaque)
      g.fillStyle = '#f39200'; g.beginPath(); g.ellipse(W * 0.1, Hh * 0.42, Hh * 0.2, Hh * 0.11, -0.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 ${Hh * 0.66}px Helvetica, Arial, sans-serif`; g.fillText('FreshCo', W * 0.56, Hh * 0.55, W * 0.82);
    });
    sign(K, c, e, t, gy + 6.8, 12, 3.0, 0.26);
  }
  // every other tenant over its own bay
  for (const [n, x, z] of H.ub.s) {
    if (/FreshCo/.test(n)) continue;
    const r = nearestEdge(E, x, z, front);
    if (!r) continue;
    const { e } = r, gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    let c;
    if (/Rexall/.test(n)) {
      c = K.A.cell('home:rexall', 290, 68, (g, W, Hh) => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, Hh);
        g.fillStyle = '#0a3d91'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `italic 800 ${Hh * 0.62}px Georgia, "Times New Roman", serif`; g.fillText('Rexall', W * 0.5, Hh * 0.46, W * 0.8);
        g.fillStyle = '#d6001c'; g.fillRect(W * 0.2, Hh * 0.8, W * 0.6, Hh * 0.07);
      });
    } else c = tenantCell(K, n, Math.round(x * 3 + z));
    const t = Math.max(2.2, Math.min(e.L - 2.2, r.t));
    sign(K, c, e, t, gy + 4.0, Math.min(/Rexall/.test(n) ? 8 : 6, e.L - 0.8), /Rexall/.test(n) ? 1.25 : 1.0, 0.2);
  }
  // the pylon at the corner of University and Bridge: the address and the tenants
  pylon(K, -1489, -4157, ['425', 'UNIVERSITY AVE E'], ['FreshCo', 'Rexall', 'Subway', 'New Orleans Pizza', 'Global Pet Foods', "Uncle's Shwarma", 'Mediterraneo'], UB_BRICK);
  STATS.ub = { edges: E.length, units, fresh: !!fe };
  if (ctx.clearAt) { const o = obb(pts); if (o) ctx.clearAt.push([o.x, o.z, Math.min(o.hu, o.hv) + 3]); }
}

/** A plaza pylon: brick legs, a header with the plaza's name, a row per tenant, both faces. Pushed off the road to (x, z) or near it. */
function pylon(K, x, z, head, tenants, legCol) {
  const city = K.ctx.city;
  // stand clear of the carriageway
  for (let i = 0; i < 8; i++) {
    const s = street(city, x, z, 30);
    if (!s || s.kerb > 3.5) break;
    const dx = x - s.qx, dz = z - s.qz, dl = Math.hypot(dx, dz) || 1;
    x += (dx / dl) * (3.6 - s.kerb); z += (dz / dl) * (3.6 - s.kerb);
  }
  const s = street(city, x, z, 60);
  const yaw = s ? Math.atan2(s.ex, s.ez) + Math.PI / 2 : 0;
  const nx = Math.sin(yaw), nz = Math.cos(yaw), ux = nz, uz = -nx, rot = Math.atan2(-nx, nz);
  const y0 = T(x, z), Bd = K.Gb(x, z);
  const W = 3.4, rowH = 0.62, headH = 1.3, gap = 0.08, leg = 1.4;
  const Hh = headH + tenants.length * (rowH + gap) + 0.3;
  for (const sd of [-1, 1]) Bd.box(x + ux * sd * (W / 2 + 0.3), y0 - 0.5, z + uz * sd * (W / 2 + 0.3), 0.6, leg + Hh + 1.0, 0.7, rot, legCol);
  Bd.box(x, y0 + leg, z, W, Hh, 0.4, rot, lin([0.20, 0.20, 0.22]));
  Bd.box(x, y0 + leg + Hh + 0.5, z, W + 1.4, 0.4, 0.9, rot, lin([0.84, 0.80, 0.72]));
  const hc = K.A.cell(`home:pylon:${head.join('|')}`, 176, 68, (g, Wp, Hp) => {
    g.fillStyle = '#7a1f1f'; g.fillRect(0, 0, Wp, Hp);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${Hp * 0.46}px Helvetica, Arial, sans-serif`; g.fillText(head[0], Wp / 2, Hp * 0.33, Wp * 0.9);
    g.font = `700 ${Hp * 0.24}px Helvetica, Arial, sans-serif`; g.fillText(head[1], Wp / 2, Hp * 0.75, Wp * 0.92);
  });
  let y = y0 + leg + Hh - 0.15 - headH / 2;
  for (const sd of [1, -1]) K.A.quad(K.Lb(x, z), hc, x + nx * sd * 0.215, y, z + nz * sd * 0.215, nx * sd, nz * sd, W - 0.2, headH - 0.1);
  y -= headH / 2 + gap + rowH / 2;
  for (const t of tenants) {
    const c = /FreshCo/.test(t) ? cellText(K, 'FreshCo', '#ffffff', '#4c9a2a', 210, 34) : /Rexall/.test(t) ? cellText(K, 'Rexall', '#0a3d91', '#ffffff', 210, 34, 'Georgia, serif')
      : (K.brandOf(t) && K.logoOf(K.brandOf(t))) || cellText(K, t, '#1d1d1d', '#f4f4f2', 210, 34);
    let lw = W - 0.3, lh = rowH;
    if (c.a < lw / lh) { lw = lh * c.a; }
    Bd.box(x, y - rowH / 2, z, W - 0.25, rowH, 0.42, rot, lin([0.95, 0.95, 0.93]));
    for (const sd of [1, -1]) K.A.quad(K.Lb(x, z), c, x + nx * sd * 0.215, y, z + nz * sd * 0.215, nx * sd, nz * sd, lw, lh);
    y -= rowH + gap;
  }
  K.solid({ x, z, hw: W / 2 + 0.6, hd: 0.45, rot, y0: y0 - 2, y1: y0 + leg + Hh + 0.7 });
}

// --- the student plaza at University and Phillip ---------------------------------------------

/** Which building a UW plaza footprint belongs to, or null (not drawn here). */
function uwpGroup(u) {
  if (/WCRI/.test(u.n) || (u.lv && u.lv > 2)) return null;
  const [cx, cz] = centroid(u.p);
  if (cx > -4975) return cz < -2318 ? 'ne' : 'court';
  if (/Molly/.test(u.n)) return 'molly';
  if (cz > -2255) return 'se';
  if (Math.abs(polyArea(u.p)) > 1500) return 'big';
  return 'row';
}
// each building's lot: its storefronts face it
const UWP_LOT = { big: [-5065, -2212], row: [-5075, -2285], molly: [-5065, -2310], se: [-5062, -2228], court: [-4915, -2300], ne: [-4890, -2305] };
const UWP_BRICK = lin([0.55, 0.33, 0.25]), SHINGLE = lin([0.33, 0.25, 0.19]), UWP_ROOF = lin([0.55, 0.55, 0.54]);

/**
 * A hipped roof over an oriented box o (eaves at yE, `ov` overhang, ridge `rise` up),
 * and the long sides as edges for dormers. Returns those edges' params.
 */
function hipRoof(Bd, o, yE, rise, col, ov = 0.6) {
  const { ux, uz } = o, vx = -uz, vz = ux;
  const P = (u, v, y) => [o.x + ux * u + vx * v, y, o.z + uz * u + vz * v];
  const hu = o.hu + ov, hv = o.hv + ov, r = Math.max(0, hu - hv);
  const R0 = P(-r, 0, yE + rise), R1 = P(r, 0, yE + rise);
  const c = [P(-hu, -hv, yE), P(hu, -hv, yE), P(hu, hv, yE), P(-hu, hv, yE)];
  const k = rise / hv, nl = Math.hypot(1, k);
  const n = (a, b) => [a / nl * k, 1 / nl, b / nl * k];
  const lo = shade(col, 0.85);
  Bd.quad(c[0], c[1], R1, R0, n(-vx, -vz), U0, [lo, lo, col, col]);
  Bd.quad(c[2], c[3], R0, R1, n(vx, vz), U0, [lo, lo, col, col]);
  Bd.tri(c[1], c[2], R1, n(ux, uz), shade(col, 0.92));
  Bd.tri(c[3], c[0], R0, n(-ux, -uz), shade(col, 0.92));
  Bd.quad(c[0], c[3], c[2], c[1], [0, -1, 0], U0, shade(col, 0.45));
  // the long sides as wall edges (for dormers): along u, outward -v and +v
  const side = (s) => {
    const a = [o.x - ux * o.hu + vx * o.hv * s, o.z - uz * o.hu + vz * o.hv * s];
    const nx = vx * s, nz = vz * s;
    return { a, ux, uz, nx, nz, L: o.hu * 2, mx: o.x + vx * o.hv * s, mz: o.z + vz * o.hv * s,
      at: (t, y, off = 0) => [a[0] + ux * t + nx * off, y, a[1] + uz * t + nz * off] };
  };
  return [side(-1), side(1)];
}

/**
 * The outline of a group of units that share walls: their outside edges chained
 * end to end (OSM's units share vertices). The longest closed ring, or null.
 */
function unionRing(list, party) {
  const segs = [];
  for (const u of list) for (const e of edges(u.p)) if (!party(u, e)) segs.push([e.a, e.c]);
  if (segs.length < 3) return null;
  const used = new Array(segs.length).fill(false);
  let best = null;
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    const ring = [segs[s0][0]];
    used[s0] = true;
    let cur = segs[s0][1], closed = false;
    for (let guard = 0; guard < segs.length; guard++) {
      if (Math.hypot(cur[0] - ring[0][0], cur[1] - ring[0][1]) < 1.2 && ring.length > 2) { closed = true; break; }
      let bi = -1, bd = 1.5, flip = false;
      for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        const d0 = Math.hypot(segs[i][0][0] - cur[0], segs[i][0][1] - cur[1]);
        const d1 = Math.hypot(segs[i][1][0] - cur[0], segs[i][1][1] - cur[1]);
        if (d0 < bd) { bd = d0; bi = i; flip = false; }
        if (d1 < bd) { bd = d1; bi = i; flip = true; }
      }
      if (bi < 0) break;
      used[bi] = true;
      ring.push(cur);
      cur = flip ? segs[bi][0] : segs[bi][1];
    }
    if (closed && ring.length > 3 && (!best || Math.abs(polyArea(ring)) > Math.abs(polyArea(best)))) best = ring;
  }
  if (!best) return null;
  // drop the vertices that only split a straight run
  const out = [];
  for (let i = 0; i < best.length; i++) {
    const a = best[(i + best.length - 1) % best.length], b = best[i], c = best[(i + 1) % best.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) / (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) || 1) > 0.08) out.push(b);
  }
  return out.length > 3 ? ccw(out) : null;
}

/** A steep shingled mansard round ring R (its second storey in the roof): out past the wall at yE, up to `inn` inside at yT, a flat top. */
function mansardRing(Bd, R, yE, yT, out, inn, col, top) {
  const O = offsetRing(R, out), I = offsetRing(R, -inn), n = R.length;
  const lo = shade(col, 0.85);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = R[j][0] - R[i][0], ez = R[j][1] - R[i][1], L = Math.hypot(ex, ez) || 1;
    let nx = ez / L, nz = -ex / L;
    if (inPoly(R, (R[i][0] + R[j][0]) / 2 + nx * 0.3, (R[i][1] + R[j][1]) / 2 + nz * 0.3)) { nx = -nx; nz = -nz; }
    const hh = Math.hypot(out + inn, yT - yE), N = [nx * (yT - yE) / hh, (out + inn) / hh, nz * (yT - yE) / hh];
    Bd.quad([O[i][0], yE, O[i][1]], [O[j][0], yE, O[j][1]], [I[j][0], yT, I[j][1]], [I[i][0], yT, I[i][1]], N, U0, [lo, lo, col, col]);
    Bd.quad([R[i][0], yE, R[i][1]], [R[j][0], yE, R[j][1]], [O[j][0], yE, O[j][1]], [O[i][0], yE, O[i][1]], [0, -1, 0], U0, shade(col, 0.6));
  }
  roof(Bd, I, yT, top);
}

function studentPlaza(K) {
  const { Gb, solid } = K;
  const groups = {};
  for (const u of H.uwp) {
    const g = uwpGroup(u);
    if (g) (groups[g] = groups[g] || []).push({ ...u, p: ccw(u.p) });
  }
  const st = { units: 0, signs: 0, dormers: 0, rings: 0 };
  for (const [gk, list] of Object.entries(groups)) {
    // the roofs the aerial shows: Campus Court and the building behind it are steep
    // shingled mansards with dormers (their second storey is in the roof) round a flat
    // top; the 160 block a low hip; the 170 row, Molly Bloom's and the 158-160 corner
    // flat behind a shingled mansard fascia
    const court = gk === 'court' || gk === 'ne';
    const lot = UWP_LOT[gk];
    let gx = 0, gz = 0;
    for (const u of list) { const [x, z] = centroid(u.p); gx += x; gz += z; }
    gx /= list.length; gz /= list.length;
    const base = T(gx, gz);
    const eave = base + (court ? 3.9 : 4.2);
    const out = 0.8, inn = 1.0, yT = eave + 1.8, slope = (yT - eave) / (out + inn);
    const party = (u, e) => list.some((o) => o !== u && (inPoly(o.p, e.mx + e.nx * 0.7, e.mz + e.nz * 0.7) || inPoly(o.p, e.mx + e.nx * 1.6, e.mz + e.nz * 1.6)));
    const Bd = Gb(gx, gz);
    const ring = court ? unionRing(list, party) : null;
    let ringE = null;
    const cIn = 5.0, cOut = 0.5, cTop = eave + 4.4;
    if (ring) {
      mansardRing(Bd, ring, eave + 0.1, cTop, cOut, cIn, SHINGLE, lin([0.30, 0.30, 0.31]));
      ringE = edges(ring);
      st.rings++;
    }
    const hipped = gk === 'big';
    let o = null;
    if (hipped) { o = obb(list[0].p); hipRoof(Bd, o, eave + 0.1, Math.min(3.2, o.hv * 0.3), SHINGLE, 0.7); }
    for (const u of list) {
      const skip = (e) => party(u, e);
      const { E } = walls(Bd, solid, u.p, eave + 0.15, UWP_BRICK, skip);
      const flat = !hipped && !ring;
      if (flat) roof(Bd, u.p, eave + out * slope - 0.12, UWP_ROOF);
      const faces = (e) => {
        const dx = lot[0] - e.mx, dz = lot[1] - e.mz, dl = Math.hypot(dx, dz) || 1;
        return (dx * e.nx + dz * e.nz) / dl > (court ? -0.2 : 0.3);
      };
      for (const e of E) {
        if (skip(e)) continue;
        if (flat) mansardEdge(Bd, e, eave, yT, out, inn, SHINGLE, Math.min(out + 0.1, 0.9));
        if (e.L < 2.5) continue;
        const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
        if (faces(e)) storefront(Bd, e, 0.5, e.L - 0.5, gy, { bay: 2.8, h: 2.8, base: shade(UWP_BRICK, 0.8) });
        else windows(Bd, e, gy + 1.2, 1.2, 6, 1.2, lin([0.14, 0.17, 0.2]), shade(UWP_BRICK, 1.3));
      }
      // its shops: a sign each over the door, on the face toward the lot
      const ok = (e) => !skip(e) && faces(e);
      for (const [n, x, z] of u.s) {
        const r = nearestEdge(E, x, z, ok) || nearestEdge(E, x, z, (e) => !skip(e));
        if (!r) continue;
        const { e } = r, gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
        const w = Math.min(Math.max(2.6, n.length * 0.36 + 0.8), e.L - 0.4);
        const t = Math.max(w / 2 + 0.1, Math.min(e.L - w / 2 - 0.1, r.t));
        // under a steep roof or a hip, on the brick band over the storefront; on a mansard fascia, on its face
        if (!flat) sign(K, tenantCell(K, n, Math.round(x * 3 + z)), e, t, gy + 3.35, w, 0.8, 0.12);
        else sign(K, tenantCell(K, n, Math.round(x * 3 + z)), e, t, eave + 0.75, w, 0.9, out + 0.15);
        st.signs++;
      }
      st.units++;
    }
    // the second storey's dormers, down every long enough run of the mansard
    if (ringE) for (const e of ringE) {
      if (e.L < 7) continue;
      for (let t = 3.2; t < e.L - 3; t += 5.4) {
        dormer(Bd, e, t, eave + 0.1, cTop, cOut, cIn, SHINGLE, lin([0.78, 0.72, 0.62]), lin([0.15, 0.19, 0.23]));
        st.dormers++;
      }
    }
  }
  STATS.uwp = st;
}

// --- Conestoga Doon ------------------------------------------------------------------------

// The Recreation Centre (Esri imagery): two black barrel roofs running east-west,
// a flat link between them and a two-storey front along their east ends.
const REC_VAULTS = [[5431, 6930, 5479, 6977], [5424, 6998, 5497, 7045]];
const REC_LINK = [[5420, 6977, 5481, 6998], [5479, 6938, 5513, 7030]];

function barrelVault(Bd, solid, x0, z0, x1, z1, eaveH, rise, col, endCol) {
  const yB = Math.min(T(x0, z0), T(x1, z0), T(x0, z1), T(x1, z1));
  const base = T((x0 + x1) / 2, (z0 + z1) / 2), yE = base + eaveH;
  const hz = (z1 - z0) / 2, zc = (z0 + z1) / 2, n = 12;
  const arc = [];
  for (let k = 0; k <= n; k++) { const a = Math.PI * k / n; arc.push([-Math.cos(a) * hz, Math.sin(a) * rise, -Math.cos(a), Math.sin(a) * hz / rise]); }
  for (let k = 0; k < n; k++) {
    const a = arc[k], b = arc[k + 1];
    const nz = (a[2] + b[2]) / 2, ny = (a[3] + b[3]) / 2, nl = Math.hypot(nz, ny);
    const sh = 0.75 + 0.25 * Math.sin(Math.PI * (k + 0.5) / n);
    Bd.quad([x1, yE + a[1], zc + a[0]], [x0, yE + a[1], zc + a[0]], [x0, yE + b[1], zc + b[0]], [x1, yE + b[1], zc + b[0]], [0, ny / nl, nz / nl], U0, shade(col, sh));
    // the arched ends
    for (const [x, sx] of [[x0, -1], [x1, 1]]) Bd.tri([x, yE + a[1], zc + a[0]], [x, yE + b[1], zc + b[0]], [x, yE, zc], [sx, 0, 0], endCol);
  }
  // the walls under the eave: brick, with the ends' glazed doors
  const BR = lin([0.56, 0.34, 0.26]);
  Bd.quad([x0, yB - 1, z0], [x1, yB - 1, z0], [x1, yE, z0], [x0, yE, z0], [0, 0, -1], U0, BR);
  Bd.quad([x1, yB - 1, z1], [x0, yB - 1, z1], [x0, yE, z1], [x1, yE, z1], [0, 0, 1], U0, BR);
  for (const [x, sx] of [[x0, -1], [x1, 1]]) Bd.quad([x, yB - 1, sx < 0 ? z1 : z0], [x, yB - 1, sx < 0 ? z0 : z1], [x, yE, sx < 0 ? z0 : z1], [x, yE, sx < 0 ? z1 : z0], [sx, 0, 0], U0, BR);
  solid({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2, hd: hz, rot: 0, y0: yB - 1, y1: yE + rise * 0.8 });
  return { yE, base };
}

/** A grass berm along a wall from (ax, az) to (bx, bz): up to h against it, out d along (nx, nz). */
function berm(Bd, ax, az, bx, bz, nx, nz, h, d) {
  const GR = lin([0.34, 0.50, 0.24]), n = 6;
  for (let k = 0; k < n; k++) {
    const s0 = k / n, s1 = (k + 1) / n;
    const P = (s, o, y) => { const x = ax + (bx - ax) * s + nx * o, z = az + (bz - az) * s + nz * o; return [x, T(x, z) + y, z]; };
    const top0 = P(s0, 0, 0), top1 = P(s1, 0, 0);
    Bd.quad(P(s0, d, 0.02), P(s1, d, 0.02), [top1[0], top1[1] + h, top1[2]], [top0[0], top0[1] + h, top0[2]], [nx * 0.5, 0.85, nz * 0.5], U0, GR);
  }
}

// All of Conestoga goes into the 1200 m cluster that already holds kwshops' Petro-Canada and
// Pioneer by Homer Watson (both builders there already draw): no new draws on the campus.
const CON_KEY = [5100, 7300];
function conestoga(K0) {
  const K = { ...K0, Gb: () => K0.Gb(CON_KEY[0], CON_KEY[1]), Lb: () => K0.Lb(CON_KEY[0], CON_KEY[1]) };
  const { Gb, solid } = K;
  const DARK = lin([0.17, 0.17, 0.18]), ENDC = lin([0.22, 0.22, 0.23]);
  const Bd = Gb(5470, 6990);
  let yE = 0;
  REC_VAULTS.forEach(([x0, z0, x1, z1], i) => {
    const r = barrelVault(Bd, solid, x0, z0, x1, z1, 3.6, (z1 - z0) * 0.24, DARK, ENDC);
    yE = r.yE;
    // the berms on the outer long side and the west end
    if (i === 0) berm(Bd, x0, z0, x1, z0, 0, -1, 3.75, 9);
    else berm(Bd, x0, z1, x1, z1, 0, 1, 3.75, 9);
    berm(Bd, x0, z0, x0, z1, -1, 0, 3.75, 9);
  });
  // the link and the front: flat roofs, brick and glass, two storeys at the front
  const GL = lin([0.12, 0.15, 0.18]);
  REC_LINK.forEach(([x0, z0, x1, z1], i) => {
    const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const top = T((x0 + x1) / 2, (z0 + z1) / 2) + (i ? 8.2 : 6.0);
    const { E } = walls(Bd, solid, pts, top + 0.5, lin([0.56, 0.34, 0.26]));
    roof(Bd, pts, top, lin([0.82, 0.82, 0.80]));
    for (const e of E) {
      const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
      if (i && e.nx > 0.5) {
        // the east front: black glass from the ground to the roof between brick piers (as the main building's)
        Bd.quad(at(e, 2, gy + 0.2, 0.05), at(e, e.L - 2, gy + 0.2, 0.05), at(e, e.L - 2, top - 0.6, 0.05), at(e, 2, top - 0.6, 0.05), [e.nx, 0, e.nz], U0, [GL, GL, shade(GL, 1.8), shade(GL, 1.8)]);
        for (let t = 2; t <= e.L - 2 + 0.01; t += (e.L - 4) / 10) Bd.quad(at(e, t - 0.08, gy + 0.2, 0.08), at(e, t + 0.08, gy + 0.2, 0.08), at(e, t + 0.08, top - 0.6, 0.08), at(e, t - 0.08, top - 0.6, 0.08), [e.nx, 0, e.nz], U0, lin([0.1, 0.1, 0.1]));
        const c = K.A.cell('home:conrec', 318, 68, (g, W, Hh) => {
          g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, W, Hh);
          g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.font = `800 ${Hh * 0.42}px Helvetica, Arial, sans-serif`; g.fillText('CONESTOGA', W / 2, Hh * 0.34, W * 0.9);
          g.font = `600 ${Hh * 0.22}px Helvetica, Arial, sans-serif`; g.fillText('STUDENT RECREATION CENTRE', W / 2, Hh * 0.76, W * 0.92);
        });
        sign(K, c, e, e.L / 2, top - 0.1, 12, 2.6, 0.3);
      } else windows(Bd, e, gy + 1.2, 1.6, 4, 2.4, GL, lin([0.2, 0.2, 0.2]));
    }
  });
  // CONESTOGA high on B Wing, toward the library pond (Commons, "Conestoga College (Doon Campus)")
  const bw = H.con.named.find((w) => w.n === 'B Wing');
  if (bw) {
    const b = boxAt(K.ctx.city, bw.x, bw.z, 2);
    if (b) {
      const P = b.kw && b.kw.poly ? b.kw.poly.pts : null;
      const E = P ? edges(ccw(P)) : null;
      const r = E ? nearestEdge(E, 5810, 7060) : null;
      if (r) {
        const top = T(b.x, b.z) + (b.kw.poly.h || 10.5);
        const c = K.A.cell('home:conestoga', 408, 68, (g, W, Hh) => {
          g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, W, Hh);
          g.fillStyle = '#111111'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.font = `800 ${Hh * 0.66}px Helvetica, Arial, sans-serif`; g.fillText('CONESTOGA', W / 2, Hh * 0.55, W * 0.9);
        });
        sign(K, c, r.e, Math.max(5, Math.min(r.e.L - 5, r.t)), top - 1.6, 9, 1.5, 0.15);
        STATS.conSign = [Math.round(r.e.mx), Math.round(r.e.mz)];
      }
    }
  }
  // the Doon residence: U-shaped, four storeys of brick
  {
    const pts = ccw(H.con.res.p);
    const [cx, cz] = centroid(pts);
    const top = T(cx, cz) + 13.2, BR = lin([0.62, 0.45, 0.34]);
    const Bd2 = Gb(cx, cz);
    const { E } = walls(Bd2, solid, pts, top + 0.6, BR);
    roof(Bd2, pts, top, lin([0.62, 0.62, 0.60]));
    for (const e of E) {
      const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
      Bd2.quad(at(e, 0, top + 0.6, 0.12), at(e, e.L, top + 0.6, 0.12), at(e, e.L, top + 0.72, -0.2), at(e, 0, top + 0.72, -0.2), [0, 1, 0], U0, lin([0.8, 0.78, 0.74]));
      for (let f = 0; f < 4; f++) windows(Bd2, e, gy + 1.0 + f * 3.1, 1.5, 3.2, 1.4, lin([0.15, 0.18, 0.22]), lin([0.85, 0.84, 0.8]));
    }
  }
  STATS.con = { vaultEave: +yE.toFixed(1) };
}

// --- the Bridgeport Bridge ---------------------------------------------------------------------

function bridgeport(K) {
  const city = K.ctx.city;
  const [A, B] = [H.bridge.p[0], H.bridge.p[H.bridge.p.length - 1]];
  let deck = null;
  for (const ei of city.edgesNear((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, 50)) {
    const e = city.edges[ei];
    if (/^Bridge Street/.test(e.name || '') && e.elev && (!deck || e.len > deck.len)) deck = e;
  }
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const ux = (B[0] - A[0]) / len, uz = (B[1] - A[1]) / len, nx = -uz, nz = ux;
  const hw = (deck ? deck.hw : 5) + 1.0;
  const CON = lin([0.76, 0.74, 0.69]);
  const dy = (t) => { const x = A[0] + ux * t, z = A[1] + uz * t; let y = null; try { y = city.groundAt(x, z, null); } catch (e) { y = null; } return y ?? T(x, z); };
  const Bd = K.Gb((A[0] + B[0]) / 2, (A[1] + B[1]) / 2);
  const spans = 5, sl = len / spans;
  for (const side of [-1, 1]) {
    for (let s = 0; s < spans; s++) {
      const t0 = s * sl + 0.5, t1 = (s + 1) * sl - 0.5, n = 10, rise = 5.2;
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const f = k / n, t = t0 + (t1 - t0) * f;
        const x = A[0] + ux * t + nx * hw * side, z = A[1] + uz * t + nz * hw * side;
        const y = dy(t) + 0.5 + rise * Math.sin(Math.PI * f);
        const p = [x, y, z];
        if (prev) Bd.tube(prev, p, 0.5, 6, CON);
        if (k > 0 && k < n) Bd.box(x, dy(t) + 0.5, z, 0.22, y - dy(t) - 0.5, 0.22, 0, CON);
        prev = p;
      }
    }
    // the parapet rail, and the deck's edge beam
    const p0 = [A[0] + nx * hw * side, dy(0) + 0.95, A[1] + nz * hw * side], p1 = [B[0] + nx * hw * side, dy(len) + 0.95, B[1] + nz * hw * side];
    Bd.tube(p0, p1, 0.12, 4, CON);
    for (let t = 1; t < len; t += 2.4) {
      const x = A[0] + ux * t + nx * hw * side, z = A[1] + uz * t + nz * hw * side;
      Bd.box(x, dy(t), z, 0.14, 0.95, 0.14, 0, CON);
    }
  }
  // the four piers in the river
  for (let s = 1; s < spans; s++) {
    const t = s * sl, px = A[0] + ux * t, pz = A[1] + uz * t;
    const yb = T(px, pz) - 3;
    Bd.box(px, yb, pz, 2.4, dy(t) - yb - 0.3, hw * 2 + 0.8, Math.atan2(uz, ux), shade(CON, 0.85));
  }
  STATS.bridge = { len: Math.round(len), hw: +hw.toFixed(1), deck: !!deck };
}

/** The kwshops.js hook: everything above, into its builders and atlas. */
function buildHome(K) {
  if (!H) return;
  const run = (name, fn) => { try { fn(K); } catch (e) { console.warn('kwhome ' + name + ': ' + (e.stack || e.message)); STATS.err = (STATS.err || []).concat(name + ': ' + e.message); } };
  run('ub', uniBridge);
  run('uwp', studentPlaza);
  run('con', conestoga);
  run('bridge', bridgeport);
  if (typeof window !== 'undefined') window.__kwHome = STATS;
}

// --- the schools (kw.js buildSchools calls this for each, with that school's builder) -------------

function schoolHome(S, k) {
  if (!H) return;
  try {
    if (S.key === 'stmatt') stMatthew(S, k);
    else if (S.key === 'stdavid') stDavid(S, k);
  } catch (e) { console.warn('kwhome school ' + S.key + ': ' + (e.stack || e.message)); STATS.err = (STATS.err || []).concat(S.key + ': ' + e.message); }
  if (typeof window !== 'undefined') window.__kwHome = STATS;
}

// St. Matthew (1995, "brick and steel"): one storey round a courtyard, the gym
// standing up in the middle, the roofs covered in solar panels (Esri imagery),
// the entrance toward Pastern Trail and the board's sign.
const STM_BRICK = lin([0.58, 0.34, 0.26]), STM_BAND = lin([0.84, 0.76, 0.60]), STM_COPING = lin([0.20, 0.33, 0.45]);
const STM_GYM = [-1560, -4823];

function stMatthew(S, { B, ctx, g }) {
  const solid = (s) => ctx.solids.push(s);
  const pts = ccw(H.stm.p);
  const [cx, cz] = centroid(pts);
  const base = T(cx, cz), top = base + 4.8;
  const { E } = walls(B, solid, pts, top + 0.5, STM_BRICK);
  roof(B, pts, top, lin([0.72, 0.72, 0.70]));
  const sx = H.stm.sign[0], sz = H.stm.sign[1];
  // the entrance: the long face nearest the sign
  let ent = null, bd = Infinity;
  for (const e of E) {
    if (e.L < 8) continue;
    const dx = sx - e.mx, dz = sz - e.mz, d = Math.hypot(dx, dz);
    if ((dx * e.nx + dz * e.nz) / d > 0.3 && d < bd) { bd = d; ent = e; }
  }
  for (const e of E) {
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2), N = [e.nx, 0, e.nz];
    B.quad(at(e, 0, top + 0.5, 0.1), at(e, e.L, top + 0.5, 0.1), at(e, e.L, top + 0.62, -0.2), at(e, 0, top + 0.62, -0.2), [0, 1, 0], U0, STM_COPING);
    B.quad(at(e, 0, top - 0.1, 0.06), at(e, e.L, top - 0.1, 0.06), at(e, e.L, top + 0.5, 0.06), at(e, 0, top + 0.5, 0.06), N, U0, STM_COPING);
    B.quad(at(e, 0, gy + 0.6, 0.04), at(e, e.L, gy + 0.6, 0.04), at(e, e.L, gy + 0.85, 0.04), at(e, 0, gy + 0.85, 0.04), N, U0, STM_BAND);
    if (e === ent) continue;
    // classrooms: tall windows in pairs
    windows(B, e, gy + 1.0, 2.0, 3.6, 2.4, lin([0.16, 0.2, 0.24]), lin([0.86, 0.86, 0.84]));
    B.quad(at(e, 0, gy + 3.25, 0.04), at(e, e.L, gy + 3.25, 0.04), at(e, e.L, gy + 3.45, 0.04), at(e, 0, gy + 3.45, 0.04), N, U0, STM_BAND);
  }
  if (ent) {
    const e = ent, t = e.L / 2, gy = T(e.mx + e.nx * 3, e.mz + e.nz * 3), N = [e.nx, 0, e.nz];
    storefront(B, e, t - 4, t + 4, gy, { bay: 2, h: 3.0, frame: lin([0.2, 0.33, 0.45]) });
    // the canopy: a flat roof on four steel posts
    const D = 4.5, y = gy + 3.4;
    B.quad(at(e, t - 6, y, D), at(e, t + 6, y, D), at(e, t + 6, y, 0), at(e, t - 6, y, 0), [0, -1, 0], U0, lin([0.85, 0.85, 0.83]));
    B.quad(at(e, t - 6, y + 0.5, 0), at(e, t + 6, y + 0.5, 0), at(e, t + 6, y + 0.5, D), at(e, t - 6, y + 0.5, D), [0, 1, 0], U0, lin([0.6, 0.6, 0.6]));
    B.quad(at(e, t - 6, y, D), at(e, t + 6, y, D), at(e, t + 6, y + 0.5, D), at(e, t - 6, y + 0.5, D), N, U0, STM_COPING);
    for (const sd of [-1, 1]) for (const dd of [D - 0.3]) {
      const p = at(e, t + sd * 5.6, gy, dd);
      B.box(p[0], gy - 0.3, p[2], 0.25, 3.8, 0.25, 0, STM_COPING);
      solid({ x: p[0], z: p[2], r: 0.2, y0: gy - 1, y1: gy + 3.5 });
    }
    const pnl = ctx.atlas.panel(9, 0.9, 30, (q, W, Hh) => {
      q.clearRect(0, 0, W, Hh);
      q.fillStyle = '#f2efe6'; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `700 ${Hh * 0.5}px Helvetica, Arial, sans-serif`; q.fillText('ST. MATTHEW CATHOLIC ELEMENTARY SCHOOL', W / 2, Hh * 0.55, W * 0.98);
    });
    const p = at(e, t, gy + 4.5, 0.08);
    hangIn(g, pnl, p[0], gy + 4.5, p[2], e.nx, e.nz);
    STATS.stmEntrance = [Math.round(e.mx), Math.round(e.mz)];
  }
  // the gym: up through the roof by the courtyard
  {
    const o = obb(pts), rot = Math.atan2(o.uz, o.ux);
    B.box(STM_GYM[0], base, STM_GYM[1], 22, 7.6, 18, rot, STM_BRICK);
    B.box(STM_GYM[0], base + 7.6, STM_GYM[1], 22.4, 0.4, 18.4, rot, STM_COPING);
    solid({ x: STM_GYM[0], z: STM_GYM[1], hw: 11, hd: 9, rot, y0: base, y1: base + 8 });
    // the solar arrays: rows of tilted panels over the classroom roofs
    const PV = lin([0.10, 0.14, 0.24]), PVF = lin([0.55, 0.56, 0.58]);
    let n = 0;
    for (let u = -o.hu + 4; u < o.hu - 3; u += 5.2) for (let v = -o.hv + 3; v < o.hv - 2; v += 2.6) {
      const x = o.x + o.ux * u - o.uz * v, z = o.z + o.uz * u + o.ux * v;
      if (!inPoly(pts, x, z) || Math.abs((x - STM_GYM[0]) * o.ux + (z - STM_GYM[1]) * o.uz) < 13 && Math.abs(-(x - STM_GYM[0]) * o.uz + (z - STM_GYM[1]) * o.ux) < 11) continue;
      if (!inPoly(pts, x + o.ux * 2.3, z + o.uz * 2.3) || !inPoly(pts, x - o.ux * 2.3, z - o.uz * 2.3)) continue;
      const P = (du, dv, dyy) => [x + o.ux * du - o.uz * dv, top + 0.25 + dyy, z + o.uz * du + o.ux * dv];
      B.quad(P(-2.4, -0.9, 0), P(2.4, -0.9, 0), P(2.4, 0.9, 0.7), P(-2.4, 0.9, 0.7), [0, 0.92, 0.38], U0, [PV, PV, shade(PV, 1.5), shade(PV, 1.5)]);
      B.quad(P(-2.4, 0.9, 0.7), P(2.4, 0.9, 0.7), P(2.4, 0.9, -0.2), P(-2.4, 0.9, -0.2), [0, 0, 1], U0, PVF);
      n++;
    }
    STATS.stmPanels = n;
  }
  // the portables: beige siding on skirting, a wooden ramp to the door
  for (const p0 of H.stm.port) {
    const o = obb(p0);
    if (!o) continue;
    const rot = Math.atan2(o.uz, o.ux), gy = T(o.x, o.z);
    B.box(o.x, gy - 0.3, o.z, o.hu * 2, 0.9, o.hv * 2, rot, lin([0.45, 0.45, 0.44]));
    B.box(o.x, gy + 0.6, o.z, o.hu * 2, 2.7, o.hv * 2, rot, lin([0.82, 0.77, 0.66]));
    B.box(o.x, gy + 3.3, o.z, o.hu * 2 + 0.3, 0.25, o.hv * 2 + 0.3, rot, lin([0.40, 0.40, 0.40]));
    // windows down the long sides, the door and ramp on the end facing the school
    for (const sd of [-1, 1]) for (let u = -o.hu + 1.8; u < o.hu - 1; u += 2.6) {
      const x = o.x + o.ux * u - o.uz * sd * (o.hv + 0.03), z = o.z + o.uz * u + o.ux * sd * (o.hv + 0.03);
      B.box(x, gy + 1.6, z, 1.3, 1.0, 0.06, rot, lin([0.16, 0.2, 0.24]));
    }
    const toward = Math.sign((cx - o.x) * o.ux + (cz - o.z) * o.uz) || 1;
    const dx = o.x + o.ux * toward * (o.hu + 1.6), dz = o.z + o.uz * toward * (o.hu + 1.6);
    B.box(dx, gy - 0.2, dz, 3.2, 0.75, 1.6, rot, lin([0.55, 0.42, 0.30]));
    ctx.solids.push({ x: o.x, z: o.z, hw: o.hu, hd: o.hv, rot, y0: gy - 1, y1: gy + 3.6 });
  }
  if (ctx.clearAt) { const o = obb(pts); if (o) ctx.clearAt.push([o.x, o.z, Math.min(o.hu, o.hv) + 6]); }
}
function hangIn(g, mesh, x, y, z, nx, nz, off = 0.06) {
  mesh.position.set(x + nx * off, y, z + nz * off);
  mesh.rotation.y = Math.atan2(nx, nz);
  g.add(mesh);
}

// St. David (1965, Commons "St David HS Waterloo", 2009): kw.js draws its walls
// (red brick now); here the round two-tone brick drum over the glazed entrance
// between grey concrete piers, its canopy, the cream precast bands, and the
// long wing's sloped glazing along its roof.
const STD_DRUM = [-4369, -3585];        // the circle in the aerial, on the east front
const STD_H = 9;                        // kw.js LOOKS: its walls' height
function stDavid(S, { B, ctx }) {
  const solid = (s) => ctx.solids.push(s);
  const pts = ccw(H.std.p);
  const E = edges(pts);
  const r = nearestEdge(E, STD_DRUM[0], STD_DRUM[1]);
  if (!r) return;
  const e = r.e, gy = T(STD_DRUM[0] + e.nx * 6, STD_DRUM[1] + e.nz * 6);
  const BR1 = lin([0.72, 0.40, 0.25]), BR2 = lin([0.56, 0.30, 0.22]), PRE = lin([0.86, 0.82, 0.72]), CONC = lin([0.66, 0.65, 0.62]);
  // the drum: 9 m across, standing half out of the wall
  const dc = at(e, r.t, gy, 3.6), R = 5.2, n = 18;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const P = (a, y, rr = R) => [dc[0] + Math.cos(a) * rr, y, dc[2] + Math.sin(a) * rr];
    const N = [Math.cos(am), 0, Math.sin(am)];
    B.quad(P(a0, gy + 3.6), P(a1, gy + 3.6), P(a1, gy + 7.4), P(a0, gy + 7.4), N, U0, BR1);
    B.quad(P(a0, gy + 7.4), P(a1, gy + 7.4), P(a1, gy + 12.2), P(a0, gy + 12.2), N, U0, BR2);
    for (const yb of [gy + 7.3, gy + 12.0]) B.quad(P(a0, yb, R + 0.08), P(a1, yb, R + 0.08), P(a1, yb + 0.28, R + 0.08), P(a0, yb + 0.28, R + 0.08), N, U0, PRE);
    B.tri(P(a0, gy + 12.3, R + 0.15), P(a1, gy + 12.3, R + 0.15), [dc[0], gy + 12.5, dc[2]], [0, 1, 0], lin([0.75, 0.75, 0.74]));
    B.quad(P(a0, gy + 3.6, R), P(a1, gy + 3.6, R), P(a1, gy + 3.6, 0.5), P(a0, gy + 3.6, 0.5), [0, -1, 0], U0, CONC);
    // the strip of glass round its north-east quarter
    if (i % n >= 14 || i < 2) B.quad(P(a0, gy + 8.0, R + 0.04), P(a1, gy + 8.0, R + 0.04), P(a1, gy + 9.8, R + 0.04), P(a0, gy + 9.8, R + 0.04), N, U0, lin([0.2, 0.26, 0.3]));
  }
  solid({ x: dc[0], z: dc[2], r: R, y0: gy + 3.4, y1: gy + 12.4 });
  // under it: the entrance, glass doors between concrete piers, a flat canopy
  const N = [e.nx, 0, e.nz], t = r.t;
  storefront(B, e, t - 4.2, t + 4.2, gy, { bay: 1.4, h: 3.3, frame: lin([0.80, 0.80, 0.78]) });
  for (const sd of [-1, 1]) {
    const p = at(e, t + sd * 5.2, gy, 8.0);
    B.box(p[0], gy - 0.3, p[2], 0.9, 12.6, 0.9, Math.atan2(e.uz, e.ux), CONC);
    solid({ x: p[0], z: p[2], r: 0.5, y0: gy - 1, y1: gy + 11 });
  }
  B.quad(at(e, t - 6, gy + 3.55, 9.2), at(e, t + 6, gy + 3.55, 9.2), at(e, t + 6, gy + 3.55, 0), at(e, t - 6, gy + 3.55, 0), [0, -1, 0], U0, CONC);
  B.quad(at(e, t - 6, gy + 3.55, 9.2), at(e, t + 6, gy + 3.55, 9.2), at(e, t + 6, gy + 3.95, 9.2), at(e, t - 6, gy + 3.95, 9.2), N, U0, lin([0.78, 0.78, 0.76]));
  // the long wing north of it: the sloped glazing along its roof edge, and precast bands
  for (const w of E) {
    if (w.L < 25 || w.nx < 0.6) continue;              // the east faces
    if (Math.hypot(w.mx - dc[0], w.mz - dc[2]) > 90) continue;
    const top = T(w.mx, w.mz) + STD_H, wy = T(w.mx + w.nx * 2, w.mz + w.nz * 2);
    const GL = lin([0.62, 0.68, 0.72]);
    B.quad(at(w, 1, top - 1.2, 0.05), at(w, w.L - 1, top - 1.2, 0.05), at(w, w.L - 1, top + 0.9, -2.2), at(w, 1, top + 0.9, -2.2), [w.nx * 0.6, 0.8, w.nz * 0.6], U0, [GL, GL, shade(GL, 1.2), shade(GL, 1.2)]);
    for (let tt = 1; tt < w.L - 1; tt += 2.2) B.quad(at(w, tt - 0.05, top - 1.2, 0.08), at(w, tt + 0.05, top - 1.2, 0.08), at(w, tt + 0.05, top + 0.9, -2.17), at(w, tt - 0.05, top + 0.9, -2.17), [w.nx * 0.6, 0.8, w.nz * 0.6], U0, lin([0.85, 0.85, 0.85]));
    for (const yb of [wy + 0.9, wy + 3.2]) B.quad(at(w, 0, yb, 0.06), at(w, w.L, yb, 0.06), at(w, w.L, yb + 0.25, 0.06), at(w, 0, yb + 0.25, 0.06), [w.nx, 0, w.nz], U0, PRE);
  }
  STATS.stdDrum = [Math.round(dc[0]), Math.round(dc[2])];
}

// the schools' hello lines and labels stay kw.js's; the plaza and the bridge:
export function homeMap() {
  if (!H) return [];
  const [ux, uz] = centroid(H.ub.p);
  return [
    { x: ux, z: uz, kind: 'plaza', name: 'University & Bridge', near: false, label: false,
      hello: 'The plaza at University & Bridge, 425 University Ave E — FreshCo, Rexall, Subway, New Orleans Pizza, Global Pet Foods, Uncle\'s Shwarma, Mediterraneo; the Tims and the Esso on the corner' },
    { x: -5040, z: -2265, kind: 'plaza', name: 'UW Plaza', near: false, label: 'UW Plaza',
      hello: 'The plaza at University & Phillip — Campus Pizza, Kismet, Subway, Molly Bloom\'s, Rooster\'s and two dozen more; Campus Court across Phillip' },
    { x: (H.bridge.p[0][0] + H.bridge.p[H.bridge.p.length - 1][0]) / 2, z: (H.bridge.p[0][1] + H.bridge.p[H.bridge.p.length - 1][1]) / 2,
      kind: 'lm', name: 'Bridgeport Bridge', near: false, label: false, hello: 'The Bridgeport Bridge (1934): five concrete bowstring arches over the Grand' },
  ];
}
export function homeStats() { return STATS; }
