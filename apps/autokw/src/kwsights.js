// THE REGION'S OTHER LANDMARKS, from their OSM footprints (data/sights.json,
// tools/kw/build_sights.py) and what the photographs and the heritage
// registers say they are made of. kwplaces.js did Uptown, Waterloo Park, RIM
// Park and Conestoga Mall; this is everywhere else a Kitchener kid would
// point at from the car:
//
//   - DOWNTOWN KITCHENER: City Hall (1993, KPMB: red Indian sandstone over a
//     green stone band, the drum of the Civic Rotunda under its ring of
//     frosted glass in green copper, the Berlin Tower with its open steel cube
//     and beacon mast) round Carl Zehr Square and its fountain pool; King
//     Street's old blocks (kwplaces.js meshKing, with the shops OSM maps in
//     each); the Kitchener Market; Centre in the Square's fly tower; the
//     Breithaupt Block (Google: the 1903 Merchants Rubber factory, its glass
//     phase III); the Tannery (Communitech; arched windows, the 55 m stack,
//     LANG TANNING CO. painted on the brick); Kaufman Lofts (Albert Kahn's
//     concrete frame and red brick, the KAUFMAN stack and the carved frieze).
//   - VICTORIA PARK: the 1924 City Hall clock tower at the Gaukel St gate,
//     the 1924 pavilion, the boathouse, the shelter on the island, Queen
//     Victoria on her plinth; Joseph Schneider Haus beside it.
//   - Bauer Lofts in Waterloo (the 1917 factory and the 15-storey tower).
//   - THE AUD: concrete, the bowl under its barrel roof, the name on the
//     East Ave front, Rangers banners.
//   - CF FAIRVIEW PARK and THE BOARDWALK: anchors' parapets and signs.
//   - BINGEMANS: the conference centre and Big Splash's slides down the hill.
//   - The WATERLOO REGION MUSEUM's quilt of coloured glass, the 1914 village
//     behind it, Homer Watson House.
//   - CAMBRIDGE: Galt's stone Main / Water / Ainslie St blocks, the 1931
//     bowstring arches of the Main St bridge, the Cambridge Mill, the Old Post
//     Office (Idea Exchange) with its clock tower and the glass pavilion over
//     the river, the Forbes mill in Hespeler, and Toyota's plant.
//
// All of it is one landmarks.js extra, built with kwplaces.js's Kit (the same
// two vertex-coloured materials, so a cluster holding both is still one draw
// each) and a lettering atlas of its own.

import * as G from './geo.js';
import { hash2 } from './util.js';
import { boxAt } from './kw.js';
import {
  inPoly, polyArea, centroid, obb, simplify, edges, street, walkY, hang, PlaceAtlas, Kit, roof, gabled,
  lin, shade, meshKing, KING_SKIP, gazebo, tree, SANS, SERIF, U0, T,
} from './kwplaces.js';

let S = null;          // sights.json
const STATS = {};
const hexc = (h) => lin([parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]);
const ccw = (p) => (polyArea(p) < 0 ? p.slice().reverse() : p);

// --- before meshing --------------------------------------------------------------------

/** Every box under a footprint we draw goes flat and is skipped by world.js, buildPolys and the signs. */
function flatten(city, pts) {
  const [cx, cz] = centroid(pts);
  let r = 0;
  for (const q of pts) r = Math.max(r, Math.hypot(q[0] - cx, q[1] - cz));
  const A = Math.abs(polyArea(pts));
  const hit = new Set();
  const b = boxAt(city, cx, cz, 2);
  if (b && b.w * b.d < A * 4 + 300) hit.add(b);
  for (const o of city.buildingsNear(cx, cz, Math.max(80, r))) if (inPoly(pts, o.x, o.z) && o.w * o.d < A * 2 + 200) hit.add(o);
  for (const o of hit) {
    o.h = 0;
    if (!o.kw) o.kw = {};
    o.kw.skip = true;
    delete o.kw.poly;      // no storefront signs on a face that is not drawn
  }
  return hit.size;
}

export function prepSights(city, data) {
  S = data;
  if (typeof window !== 'undefined' && window.__noSights) S = null;
  if (!S) return { skipped: 0 };
  let n = 0;
  for (const k of Object.keys(S.b)) n += flatten(city, S.b[k].p);
  for (const r of S.king) { n += flatten(city, r.p); KING_SKIP.push(r.p); }
  for (const r of S.doon) n += flatten(city, r.p);
  for (const r of S.boardwalk) n += flatten(city, r.p);
  return { skipped: n };
}

// --- kit ----------------------------------------------------------------------------------

/**
 * A flat-roofed block on a footprint: walls from below the lowest corner to a
 * parapet, coping, and on every face long enough rows of windows:
 *   win.style 'punch' (framed, sill, maybe an arched head), 'grid' (a
 *   factory's concrete frame: piers and spandrels round wide glass), 'ribbon'
 *   (a band of glass a floor), 'curtain' (glass from base to top with mullions).
 */
function block(kit, ctx, pts, o) {
  pts = ccw(pts);
  const [cx, cz] = centroid(pts);
  const B = kit.B(cx, cz);
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const base = o.base !== undefined ? o.base : T(cx, cz);
  const yTop = base + o.h, par = o.parapet ?? 0.8;
  const wall = o.wall, dark = shade(wall, 0.78), trim = o.trim || shade(wall, 1.25);
  const GL = o.glass || lin([0.14, 0.18, 0.22]), GL2 = shade(GL, 1.6);
  const FR = o.frame || lin([0.85, 0.83, 0.78]);
  const E = edges(pts);
  const W = o.win;
  for (const e of E) {
    const N = [e.nx, 0, e.nz];
    B.quad(e.at(0, lo - 1.2), e.at(e.L, lo - 1.2), e.at(e.L, yTop + par), e.at(0, yTop + par), N, U0, [dark, dark, wall, wall]);
    if (par > 0) {
      B.quad(e.at(0, yTop, -0.01), e.at(e.L, yTop, -0.01), e.at(e.L, yTop + par, -0.01), e.at(0, yTop + par, -0.01), [-e.nx, 0, -e.nz], U0, dark);
      B.quad(e.at(0, yTop + par, 0.12), e.at(e.L, yTop + par, 0.12), e.at(e.L, yTop + par + 0.1, 0), e.at(0, yTop + par + 0.1, 0), [0, 1, 0], U0, trim);
    }
    if (o.solid !== false) ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: lo - 1.2, y1: yTop + par });
    if (e.L < 3) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    if (o.plinth) {
      const [ph, pc] = o.plinth;
      B.quad(e.at(0, gy - 0.4, 0.05), e.at(e.L, gy - 0.4, 0.05), e.at(e.L, gy + ph, 0.05), e.at(0, gy + ph, 0.05), N, U0, pc);
    }
    if (o.cornice) {
      const yc = yTop - o.cornice;
      B.quad(e.at(-0.2, yc, 0.35), e.at(e.L + 0.2, yc, 0.35), e.at(e.L + 0.2, yTop, 0.35), e.at(-0.2, yTop, 0.35), N, U0, trim);
      B.quad(e.at(-0.2, yc, 0), e.at(e.L + 0.2, yc, 0), e.at(e.L + 0.2, yc, 0.35), e.at(-0.2, yc, 0.35), [0, -1, 0], U0, shade(trim, 0.6));
    }
    if (!W || e.L < (W.minL || 5)) continue;
    const fl = W.fl || 3.8, g0 = W.g0 ?? 1.0;
    const top = yTop - (W.top ?? 0.9);
    if (W.style === 'curtain') {
      B.quad(e.at(0.3, gy + g0, 0.04), e.at(e.L - 0.3, gy + g0, 0.04), e.at(e.L - 0.3, top, 0.04), e.at(0.3, top, 0.04), N, U0, [GL, GL, GL2, GL2]);
      for (let t = 0.3; t <= e.L - 0.3 + 1e-3; t += W.sp || 1.5) B.quad(e.at(t - 0.05, gy + g0, 0.06), e.at(t + 0.05, gy + g0, 0.06), e.at(t + 0.05, top, 0.06), e.at(t - 0.05, top, 0.06), N, U0, FR);
      for (let y = gy + g0 + fl; y < top; y += fl) B.quad(e.at(0.3, y - 0.12, 0.06), e.at(e.L - 0.3, y - 0.12, 0.06), e.at(e.L - 0.3, y + 0.12, 0.06), e.at(0.3, y + 0.12, 0.06), N, U0, W.slab || FR);
      continue;
    }
    for (let f = 0; ; f++) {
      const y0 = gy + g0 + f * fl, wh = W.h || fl * 0.55;
      if (y0 + wh > top) break;
      if (W.style === 'ribbon') {
        B.quad(e.at(0.6, y0, 0.04), e.at(e.L - 0.6, y0, 0.04), e.at(e.L - 0.6, y0 + wh, 0.04), e.at(0.6, y0 + wh, 0.04), N, U0, [GL, GL, GL2, GL2]);
        continue;
      }
      const sp = W.sp || 3.2, nw = Math.floor((e.L - 0.8) / sp);
      if (nw < 1) break;
      const pad = (e.L - nw * sp) / 2, ww = W.w || sp * 0.5;
      if (W.style === 'grid') {
        // the glass right across, then the frame over it: piers, and the spandrel's edge
        B.quad(e.at(pad, y0, 0.03), e.at(e.L - pad, y0, 0.03), e.at(e.L - pad, y0 + wh, 0.03), e.at(pad, y0 + wh, 0.03), N, U0, [GL, GL, GL2, GL2]);
        for (let i = 0; i <= nw; i++) {
          const t = pad + sp * i;
          B.quad(e.at(t - 0.3, y0 - 0.3, 0.09), e.at(t + 0.3, y0 - 0.3, 0.09), e.at(t + 0.3, y0 + wh + 0.3, 0.09), e.at(t - 0.3, y0 + wh + 0.3, 0.09), N, U0, FR);
          if (i < nw) for (const m of [0.33, 0.66]) {
            const tm = t + sp * m;
            B.quad(e.at(tm - 0.04, y0, 0.05), e.at(tm + 0.04, y0, 0.05), e.at(tm + 0.04, y0 + wh, 0.05), e.at(tm - 0.04, y0 + wh, 0.05), N, U0, lin([0.12, 0.12, 0.12]));
          }
        }
        B.quad(e.at(pad - 0.3, y0 - 0.3, 0.09), e.at(e.L - pad + 0.3, y0 - 0.3, 0.09), e.at(e.L - pad + 0.3, y0, 0.09), e.at(pad - 0.3, y0, 0.09), N, U0, FR);
        continue;
      }
      for (let i = 0; i < nw; i++) {
        const t = pad + sp * (i + 0.5);
        B.quad(e.at(t - ww / 2 - 0.08, y0 - 0.08, 0.02), e.at(t + ww / 2 + 0.08, y0 - 0.08, 0.02), e.at(t + ww / 2 + 0.08, y0 + wh + 0.08, 0.02), e.at(t - ww / 2 - 0.08, y0 + wh + 0.08, 0.02), N, U0, FR);
        B.quad(e.at(t - ww / 2, y0, 0.04), e.at(t + ww / 2, y0, 0.04), e.at(t + ww / 2, y0 + wh, 0.04), e.at(t - ww / 2, y0 + wh, 0.04), N, U0, [GL, GL, GL2, GL2]);
        if (W.sill) B.quad(e.at(t - ww / 2 - 0.15, y0 - 0.22, 0.09), e.at(t + ww / 2 + 0.15, y0 - 0.22, 0.09), e.at(t + ww / 2 + 0.15, y0 - 0.08, 0.09), e.at(t - ww / 2 - 0.15, y0 - 0.08, 0.09), N, U0, W.sill);
        if (W.arch) {
          // a segmental brick arch over the head, and the glass under it
          const ac = W.arch, r = ww / 2;
          for (let k = 0; k < 5; k++) {
            const a0 = Math.PI * k / 5, a1 = Math.PI * (k + 1) / 5;
            const p0 = [t + Math.cos(a0) * r, y0 + wh + Math.sin(a0) * r * 0.55], p1 = [t + Math.cos(a1) * r, y0 + wh + Math.sin(a1) * r * 0.55];
            B.tri(e.at(t, y0 + wh, 0.04), e.at(p0[0], p0[1], 0.04), e.at(p1[0], p1[1], 0.04), N, GL2);
            const q0 = [t + Math.cos(a0) * (r + 0.28), y0 + wh + Math.sin(a0) * (r * 0.55 + 0.28)], q1 = [t + Math.cos(a1) * (r + 0.28), y0 + wh + Math.sin(a1) * (r * 0.55 + 0.28)];
            B.quad(e.at(p0[0], p0[1], 0.035), e.at(p1[0], p1[1], 0.035), e.at(q1[0], q1[1], 0.035), e.at(q0[0], q0[1], 0.035), N, U0, ac);
          }
        }
      }
      if (W.bands && f > 0) B.quad(e.at(0, y0 - 0.55, 0.05), e.at(e.L, y0 - 0.55, 0.05), e.at(e.L, y0 - 0.35, 0.05), e.at(0, y0 - 0.35, 0.05), N, U0, W.bands);
    }
  }
  roof(B, pts, yTop, o.roof || lin([0.38, 0.37, 0.36]));
  return { E, pts, yTop, base, lo, B, cx, cz, g: kit.grp(cx, cz) };
}

/** The edge of `E` that best faces a street matching `re` (or any street): the nearest, then the longest. */
function frontEdge(city, E, re = null, minL = 6, reach = 70) {
  let best = null, bs = Infinity;
  for (const e of E) {
    if (e.L < minL) continue;
    const s = street(city, e.mx + e.nx * 2, e.mz + e.nz * 2, reach, re);
    if (!s) continue;
    const tx = s.qx - e.mx, tz = s.qz - e.mz, tl = Math.hypot(tx, tz) || 1;
    if ((tx * e.nx + tz * e.nz) / tl < 0.35) continue;
    const sc = s.kerb - e.L * 0.15;
    if (sc < bs) { bs = sc; best = e; }
  }
  return best;
}

/** Lettering on an atlas panel: `bg` null = letters alone on the wall. */
function text(L, w, h, str, { bg = null, fg = '#ffffff', font = SANS, wt = '800', k = 0.62, px = 24, sub = null, subk = 0.22 } = {}) {
  return L.panel(w, h, px, (q, W, H) => {
    if (bg) { q.fillStyle = bg; q.fillRect(0, 0, W, H); } else q.clearRect(0, 0, W, H);
    q.fillStyle = fg; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `${wt} ${H * k}px ${font}`;
    q.fillText(str, W / 2, sub ? H * 0.38 : H * 0.54, W * 0.94);
    if (sub) { q.font = `700 ${H * subk}px ${SANS}`; q.fillText(sub, W / 2, H * 0.78, W * 0.94); }
  });
}
/** A panel on an edge at distance t along it, centred at height y, `off` out from the wall. */
function onWall(kit, e, t, y, mesh, off = 0.08) {
  const p = e.at(t, y, 0);
  hang(kit.grp(p[0], p[2]), mesh, p[0], y, p[2], e.nx, e.nz, off);
}

/** A clock face (ten past ten). */
function clockFace(L, size, roman = true) {
  return L.panel(size, size, 40, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    const r = W / 2 - 2;
    q.fillStyle = '#f4efe2'; q.beginPath(); q.arc(W / 2, H / 2, r, 0, Math.PI * 2); q.fill();
    q.lineWidth = r * 0.08; q.strokeStyle = '#1e1e1e'; q.stroke();
    q.fillStyle = '#1e1e1e'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `700 ${r * 0.2}px ${SERIF}`;
    const RN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      if (roman) q.fillText(RN[i], W / 2 + Math.cos(a) * r * 0.74, H / 2 + Math.sin(a) * r * 0.74);
      else q.fillRect(W / 2 + Math.cos(a) * r * 0.8 - r * 0.04, H / 2 + Math.sin(a) * r * 0.8 - r * 0.04, r * 0.08, r * 0.08);
    }
    q.lineCap = 'round';
    const hand = (f, len, wd) => { q.lineWidth = r * wd; q.beginPath(); q.moveTo(W / 2, H / 2); q.lineTo(W / 2 + Math.cos(-Math.PI / 2 + Math.PI * 2 * f) * r * len, H / 2 + Math.sin(-Math.PI / 2 + Math.PI * 2 * f) * r * len); q.stroke(); };
    hand(10.17 / 12, 0.45, 0.07); hand(2 / 12, 0.66, 0.045);
  });
}

/** A pyramid (or with `apexY` lower, a hip) roof over a square centred at (x, z). */
function pyramid(B, x, y, z, hs, rise, rot, col) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const C = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]].map(([a, b]) => [x + a * c - b * s, y, z + a * s + b * c]);
  const apex = [x, y + rise, z];
  for (let i = 0; i < 4; i++) {
    const a = C[i], b = C[(i + 1) % 4];
    const mx = (a[0] + b[0]) / 2 - x, mz = (a[2] + b[2]) / 2 - z, ml = Math.hypot(mx, mz) || 1;
    B.tri(a, b, apex, [mx / ml * 0.7, 0.7, mz / ml * 0.7], col);
  }
}
/** A hipped roof over an oriented box `o` (eaves at y, `ov` overhang). */
function hipRoof(B, o, y, rise, col, ov = 0.5) {
  const { ux, uz } = o, vx = -uz, vz = ux;
  const P = (u, v, yy) => [o.x + ux * u + vx * v, yy, o.z + uz * u + vz * v];
  const hu = o.hu + ov, hv = o.hv + ov, r = Math.max(0, hu - hv);
  const R0 = P(-r, 0, y + rise), R1 = P(r, 0, y + rise);
  const c = [P(-hu, -hv, y), P(hu, -hv, y), P(hu, hv, y), P(-hu, hv, y)];
  const n = (a, b) => [a * 0.7, 0.7, b * 0.7];
  B.quad(c[0], c[1], R1, R0, n(-vx, -vz), U0, col);
  B.quad(c[2], c[3], R0, R1, n(vx, vz), U0, col);
  B.tri(c[1], c[2], R1, n(ux, uz), col);
  B.tri(c[3], c[0], R0, n(-ux, -uz), col);
  // the soffit
  B.quad(c[0], c[1], c[2], c[3], [0, -1, 0], U0, shade(col, 0.5));
}
/** A barrel roof along `o`'s long axis: eaves at yE, crown at yE + rise; the gable ends filled with `end`. */
function barrel(B, o, yE, rise, col, end, n = 10) {
  const { ux, uz } = o, vx = -uz, vz = ux;
  const P = (u, v, y) => [o.x + ux * u + vx * v, y, o.z + uz * u + vz * v];
  const arc = [];
  for (let k = 0; k <= n; k++) {
    const t = Math.PI * k / n;
    arc.push([o.hv * Math.cos(t), rise * Math.sin(t), Math.cos(t) / o.hv, Math.sin(t) / rise]);
  }
  for (let k = 0; k < n; k++) {
    const a = arc[k], b = arc[k + 1];
    const nv = (a[2] + b[2]) / 2, ny = (a[3] + b[3]) / 2, nl = Math.hypot(nv, ny);
    B.quad(P(-o.hu, a[0], yE + a[1]), P(o.hu, a[0], yE + a[1]), P(o.hu, b[0], yE + b[1]), P(-o.hu, b[0], yE + b[1]),
      [vx * nv / nl, ny / nl, vz * nv / nl], U0, col);
    for (const s of [-1, 1]) B.tri(P(s * o.hu, a[0], yE + a[1]), P(s * o.hu, b[0], yE + b[1]), P(s * o.hu, 0, yE), [ux * s, 0, uz * s], end);
  }
}
/** A brick smokestack, tapering, with a cap; `letters` run down its face toward (fx, fz). */
function stack(kit, ctx, x, z, h, r0, r1, col, letters = null, fx = 0, fz = 1, cap = null) {
  const B = kit.B(x, z), y = T(x, z) - 0.5, n = 10;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    B.quad([x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0], [x + Math.cos(a1) * r0, y, z + Math.sin(a1) * r0],
      [x + Math.cos(a1) * r1, y + h, z + Math.sin(a1) * r1], [x + Math.cos(a0) * r1, y + h, z + Math.sin(a0) * r1],
      [Math.cos(am), 0.05, Math.sin(am)], U0, [shade(col, 0.8), shade(col, 0.8), col, col]);
  }
  B.prism(x, y + h - 1.2, z, r1 + 0.25, 1.2, n, cap || shade(col, 0.6));
  ctx.solids.push({ x, z, r: r0, y0: y - 1, y1: y + h });
  if (letters) {
    const n2 = letters.length, lh = 2.4;
    const m = kit.atlas.panel(1.7, n2 * lh, 13, (q, W, H) => {
      q.clearRect(0, 0, W, H);
      q.fillStyle = '#f2ece0'; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `800 ${H / n2 * 0.78}px ${SANS}`;
      for (let i = 0; i < n2; i++) q.fillText(letters[i], W / 2, (i + 0.55) * H / n2, W);
    });
    const yc = y + h - 4 - n2 * lh / 2, rr = r1 + (r0 - r1) * (1 - (yc - y) / h);
    hang(kit.grp(x, z), m, x + fx * rr, yc, z + fz * rr, fx, fz, 0.06);
  }
}

// --- downtown Kitchener -------------------------------------------------------------------

const SANDSTONE = lin([0.64, 0.36, 0.29]);
const GREENSTONE = lin([0.27, 0.37, 0.30]);
const PRECAST = lin([0.84, 0.80, 0.73]);
const COPPER = lin([0.37, 0.61, 0.54]);
// Carl Zehr Square's fountain pool (OSM water polygon in the square)
const ZEHR_POOL = [[-1454.8, 70.1], [-1420.5, 86.6], [-1414.7, 69.4], [-1444.8, 54.9]];
// the square between the wings: their inner corners, out to King's back of walk
const ZEHR = [[-1465.1, 63.6], [-1445.6, 24.7], [-1400.4, 47.3], [-1407.2, 91.9], [-1416, 96], [-1458, 77]];

function cityHall(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const r = block(kit, ctx, S.b.cityhall.p, {
    h: 14.5, wall: SANDSTONE, trim: PRECAST, glass: lin([0.30, 0.42, 0.44]), frame: PRECAST,
    plinth: [1.3, GREENSTONE], cornice: 1.1,
    win: { style: 'punch', sp: 3.4, w: 2.1, h: 2.0, fl: 4.2, g0: 1.9, sill: PRECAST, bands: PRECAST },
  });
  const { B } = r;
  const base = r.base;
  // the square: granite with a grid, the green stone band across it, the pool and its jets
  const sy = walkY(ctx.city, -1432, 62);
  const D = kit.B(-1432, 62, true);
  const GRAN = lin([0.60, 0.60, 0.58]);
  {
    let tris = [];
    const sq = ZEHR;
    for (let i = 1; i < sq.length - 1; i++) tris.push([0, i, i + 1]);
    for (const [a, b, c] of tris) D.tri([sq[a][0], sy + 0.06, sq[a][1]], [sq[b][0], sy + 0.06, sq[b][1]], [sq[c][0], sy + 0.06, sq[c][1]], [0, 1, 0], GRAN);
    // grid lines along and across the King face
    const ex = -1400.4 - -1445.6, ez = 47.3 - 24.7, el = Math.hypot(ex, ez), ux = ex / el, uz = ez / el;
    for (let k = -8; k <= 8; k++) {
      const ox = -1432 + ux * k * 4.5, oz = 52 + uz * k * 4.5;
      D.quad([ox - uz * 30 - ux * 0.06, sy + 0.08, oz + ux * 30 - uz * 0.06], [ox - uz * 30 + ux * 0.06, sy + 0.08, oz + ux * 30 + uz * 0.06],
        [ox + uz * 30 + ux * 0.06, sy + 0.08, oz - ux * 30 + uz * 0.06], [ox + uz * 30 - ux * 0.06, sy + 0.08, oz - ux * 30 - uz * 0.06], [0, 1, 0], U0, lin([0.45, 0.45, 0.44]));
    }
    // the green band
    D.quad([-1468, sy + 0.09, 49], [-1466, sy + 0.09, 45], [-1396, sy + 0.09, 82], [-1398, sy + 0.09, 86], [0, 1, 0], U0, GREENSTONE);
  }
  {
    const P = ZEHR_POOL, py = sy + 0.42;
    const W = lin([0.20, 0.42, 0.52]), CURB = lin([0.70, 0.70, 0.68]);
    B.tri([P[0][0], py - 0.12, P[0][1]], [P[1][0], py - 0.12, P[1][1]], [P[2][0], py - 0.12, P[2][1]], [0, 1, 0], W);
    B.tri([P[0][0], py - 0.12, P[0][1]], [P[2][0], py - 0.12, P[2][1]], [P[3][0], py - 0.12, P[3][1]], [0, 1, 0], W);
    for (const e of edges(P)) {
      B.quad(e.at(0, sy - 0.2, 0.35), e.at(e.L, sy - 0.2, 0.35), e.at(e.L, py, 0.35), e.at(0, py, 0.35), [e.nx, 0, e.nz], U0, CURB);
      B.quad(e.at(0, py, 0.35), e.at(e.L, py, 0.35), e.at(e.L, py, -0.15), e.at(0, py, -0.15), [0, 1, 0], U0, CURB);
    }
    // the jets: two rows of white plumes
    const JET = lin([0.92, 0.95, 0.97]);
    for (let i = 0; i < 7; i++) for (const s of [0.33, 0.66]) {
      const a = P[0], b = P[1], c = P[3], t = (i + 0.5) / 7;
      const x = a[0] + (b[0] - a[0]) * t + (c[0] - a[0]) * s, z = a[1] + (b[1] - a[1]) * t + (c[1] - a[1]) * s;
      const h = 1.6 + 1.4 * Math.abs(Math.sin(i * 1.3));
      B.cone(x, py - 0.12, z, 0.18, h, 5, JET);
    }
  }
  // the Civic Rotunda: a drum at the back of the square, the frosted ring in green copper under a low cone
  const RX = -1423.5, RZ = 31.5, RR = 9.5;
  B.prism(RX, base - 1, RZ, RR, 16.5, 20, PRECAST);
  for (let i = 0; i < 20; i += 2) {
    const a = (i / 20) * Math.PI * 2 + 0.16;
    B.box(RX + Math.cos(a) * (RR + 0.05), base + 1, RZ + Math.sin(a) * (RR + 0.05), 1.2, 12.5, 0.12, -a + Math.PI / 2, lin([0.30, 0.42, 0.44]));
  }
  B.prism(RX, base + 15.5, RZ, RR + 0.2, 0.6, 20, COPPER);
  B.prism(RX, base + 16.1, RZ, RR - 0.6, 3.2, 20, lin([0.86, 0.90, 0.89]));
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    B.box(RX + Math.cos(a) * (RR - 0.55), base + 16.1, RZ + Math.sin(a) * (RR - 0.55), 0.18, 3.2, 0.18, 0, COPPER);
  }
  B.prism(RX, base + 19.3, RZ, RR - 0.3, 0.5, 20, COPPER);
  B.cone(RX, base + 19.8, RZ, RR - 0.2, 2.6, 20, COPPER);
  ctx.solids.push({ x: RX, z: RZ, r: RR, y0: base - 1, y1: base + 22 });
  // the Berlin Tower on the east: sandstone shaft, pale bands, glass, the open cube and the beacon mast
  const TX = -1383.5, TZ = 19.5, TW = 11, TH = 44, rot = Math.atan2(47.3 - 24.7, -1400.4 - -1445.6);
  B.box(TX, base - 1, TZ, TW, TH + 1, TW, rot, SANDSTONE);
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let y = base + 6; y < base + TH - 2; y += 4.2) {
    B.box(TX, y, TZ, TW + 0.2, 0.5, TW + 0.2, rot, PRECAST);
    for (const [a, b] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = a * c - b * s, nz = a * s + b * c, tx = -nz, tz = nx;
      for (const o of [-3, 0, 3]) {
        const px = TX + nx * (TW / 2 + 0.03) + tx * o, pz = TZ + nz * (TW / 2 + 0.03) + tz * o;
        B.quad([px - tx * 0.9, y + 1.1, pz - tz * 0.9], [px + tx * 0.9, y + 1.1, pz + tz * 0.9], [px + tx * 0.9, y + 3.3, pz + tz * 0.9], [px - tx * 0.9, y + 3.3, pz - tz * 0.9], [nx, 0, nz], U0, lin([0.30, 0.42, 0.44]));
      }
    }
  }
  B.box(TX, base + TH, TZ, TW + 0.8, 0.8, TW + 0.8, rot, PRECAST);
  // the cube: twelve steel members
  const STEEL = lin([0.80, 0.82, 0.84]), cy0 = base + TH + 0.8, cs = 9.5, ch = 9;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const px = TX + (a * c - b * s) * cs / 2, pz = TZ + (a * s + b * c) * cs / 2;
    B.box(px, cy0, pz, 0.45, ch, 0.45, rot, STEEL);
  }
  for (const yy of [cy0 + ch - 0.45, cy0 + 2.6]) for (const [a, b, w, d] of [[0, -1, cs, 0.45], [0, 1, cs, 0.45], [-1, 0, 0.45, cs], [1, 0, 0.45, cs]]) {
    const px = TX + (a * c - b * s) * cs / 2, pz = TZ + (a * s + b * c) * cs / 2;
    B.box(px, yy, pz, w, 0.45, d, rot, STEEL);
  }
  B.box(TX, cy0 + 2.6, TZ, cs - 0.6, 0.25, cs - 0.6, rot, lin([0.55, 0.55, 0.55]));    // the deck
  B.prism(TX, cy0, TZ, 0.35, ch + 13, 6, STEEL);
  B.prism(TX, cy0 + ch + 12.6, TZ, 0.6, 1.0, 8, lin([0.95, 0.20, 0.15]));
  ctx.solids.push({ x: TX, z: TZ, hw: TW / 2, hd: TW / 2, rot, y0: base - 1, y1: base + TH + 1 });
  // the lettering: KITCHENER CITY HALL in bronze on the King face of each wing end
  const kf = frontEdge(city, r.E, /^King Street/, 6, 40);
  if (kf) {
    const m = text(L, Math.min(12, kf.L - 1), 0.9, 'KITCHENER CITY HALL', { fg: '#3b2a1a', font: SERIF, wt: '700', k: 0.8 });
    onWall(kit, kf, kf.L / 2, T(kf.mx, kf.mz) + 11.2, m, 0.37);
    STATS.cityHallFace = [Math.round(kf.mx), Math.round(kf.mz)];
  }
  // trees in the square's planters along King
  for (const [x, z] of [[-1462, 72], [-1453, 81], [-1411, 99], [-1401, 93]]) tree(B, x, walkY(city, x, z), z, 7, Math.round(x * 3 + z), ctx.solids);
}

function market(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const BR = lin([0.62, 0.31, 0.22]);
  const r = block(kit, ctx, S.b.market.p, {
    h: 12.5, wall: BR, trim: lin([0.80, 0.76, 0.68]), cornice: 0.8, roof: lin([0.42, 0.48, 0.47]),
    plinth: [0.9, lin([0.55, 0.52, 0.48])],
    win: { style: 'punch', sp: 3.6, w: 2.2, h: 3.0, fl: 5.6, g0: 1.2, arch: shade(BR, 0.8), sill: lin([0.80, 0.76, 0.68]) },
  });
  const f = frontEdge(city, r.E, /^King Street/, 10);
  if (!f) return;
  // the glazed atrium on King: a tall glass bay with a gable of glass and a green metal roof
  const B = r.B, gy = T(f.mx + f.nx * 2, f.mz + f.nz * 2), w = Math.min(22, f.L * 0.45), t = f.L / 2, d = 3.5, top = gy + 13.5;
  const GL = lin([0.26, 0.36, 0.42]), FR = lin([0.30, 0.38, 0.36]), N = [f.nx, 0, f.nz];
  B.quad(f.at(t - w / 2, gy - 0.3, d), f.at(t + w / 2, gy - 0.3, d), f.at(t + w / 2, top - 3, d), f.at(t - w / 2, top - 3, d), N, U0, GL);
  B.tri(f.at(t - w / 2, top - 3, d), f.at(t + w / 2, top - 3, d), f.at(t, top + 1.5, d), N, GL);
  for (const sd of [-1, 1]) B.quad(f.at(t + sd * w / 2, gy - 0.3, 0), f.at(t + sd * w / 2, gy - 0.3, d), f.at(t + sd * w / 2, top - 3, d), f.at(t + sd * w / 2, top - 3, 0), [f.ux * sd, 0, f.uz * sd], U0, GL);
  for (let k = 0; k <= 8; k++) {
    const tt = t - w / 2 + w * k / 8, yy = top - 3 + 4.5 * (1 - Math.abs(k - 4) / 4);
    B.quad(f.at(tt - 0.08, gy - 0.3, d + 0.04), f.at(tt + 0.08, gy - 0.3, d + 0.04), f.at(tt + 0.08, yy, d + 0.04), f.at(tt - 0.08, yy, d + 0.04), N, U0, FR);
  }
  for (const yy of [gy + 3.2, gy + 6.6]) B.quad(f.at(t - w / 2, yy, d + 0.04), f.at(t + w / 2, yy, d + 0.04), f.at(t + w / 2, yy + 0.18, d + 0.04), f.at(t - w / 2, yy + 0.18, d + 0.04), N, U0, FR);
  for (const sd of [-1, 1]) {
    const nrm = [f.ux * sd * 0.6 + f.nx * 0.0, 0.8, f.uz * sd * 0.6];
    B.quad(f.at(t + sd * (w / 2 + 0.4), top - 3.1, d + 0.4), f.at(t + sd * (w / 2 + 0.4), top - 3.1, -0.5), f.at(t, top + 1.6, -0.5), f.at(t, top + 1.6, d + 0.4), nrm, U0, lin([0.30, 0.42, 0.36]));
  }
  const m = text(L, Math.min(w - 2, 15), 1.5, 'KITCHENER MARKET', { bg: '#7a1f24', fg: '#f4e4c1', font: SERIF, wt: '700', k: 0.62 });
  onWall(kit, f, t, gy + 7.7, m, d + 0.1);
  ctx.solids.push({ ...(() => { const p = f.at(t, 0, d / 2); return { x: p[0], z: p[2] }; })(), hw: w / 2, hd: d / 2, rot: Math.atan2(f.uz, f.ux), y0: gy - 1, y1: top });
}

function centreInTheSquare(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const BUFF = lin([0.66, 0.56, 0.45]);
  const r = block(kit, ctx, S.b.centre.p, {
    h: 12, wall: BUFF, trim: lin([0.80, 0.74, 0.64]), cornice: 1.2,
    win: { style: 'ribbon', fl: 4.5, g0: 4.5, h: 1.6, minL: 10 },
  });
  // the hall and its fly tower over the middle
  const o = obb(r.pts);
  const B = r.B, rot = Math.atan2(o.uz, o.ux);
  B.box(o.x, r.base - 1, o.z, o.hu * 1.1, 24, o.hv * 1.0, rot, shade(BUFF, 0.92));
  B.box(o.x + o.ux * o.hu * 0.25, r.base - 1, o.z + o.uz * o.hu * 0.25, o.hu * 0.55, 31, o.hv * 0.95, rot, shade(BUFF, 0.85));
  B.box(o.x + o.ux * o.hu * 0.25, r.base + 29.6, o.z + o.uz * o.hu * 0.25, o.hu * 0.55 + 0.6, 0.6, o.hv * 0.95 + 0.6, rot, lin([0.80, 0.74, 0.64]));
  ctx.solids.push({ x: o.x, z: o.z, hw: o.hu * 0.55, hd: o.hv * 0.5, rot, y0: r.base - 1, y1: r.base + 30 });
  // the lobby's glass toward Queen St and the name over it
  const f = frontEdge(city, r.E, /^Queen Street/, 10) || frontEdge(city, r.E, null, 10);
  if (!f) return;
  const gy = T(f.mx + f.nx * 2, f.mz + f.nz * 2), N = [f.nx, 0, f.nz], GL = lin([0.20, 0.25, 0.28]);
  B.quad(f.at(1, gy - 0.3, 0.06), f.at(f.L - 1, gy - 0.3, 0.06), f.at(f.L - 1, gy + 8, 0.06), f.at(1, gy + 8, 0.06), N, U0, GL);
  for (let t = 1; t <= f.L - 1; t += 2) B.quad(f.at(t - 0.06, gy - 0.3, 0.08), f.at(t + 0.06, gy - 0.3, 0.08), f.at(t + 0.06, gy + 8, 0.08), f.at(t - 0.06, gy + 8, 0.08), N, U0, lin([0.25, 0.25, 0.25]));
  const m = text(L, Math.min(16, f.L - 2), 1.3, 'CENTRE IN THE SQUARE', { fg: '#f6f1e6', wt: '700', k: 0.66 });
  onWall(kit, f, f.L / 2, gy + 9.9, m, 0.1);
}

function tannery(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const BR = lin([0.56, 0.25, 0.18]);
  const r = block(kit, ctx, S.b.tannery.p, {
    h: 19.5, wall: BR, trim: lin([0.48, 0.21, 0.15]), cornice: 0.7, parapet: 0.9,
    win: { style: 'punch', sp: 3.1, w: 1.6, h: 2.3, fl: 3.9, g0: 1.3, arch: shade(BR, 0.78), sill: lin([0.72, 0.68, 0.60]), frame: lin([0.18, 0.18, 0.17]) },
    frame: lin([0.18, 0.18, 0.17]),
  });
  // the stack, off Joseph St at the south end
  let sv = r.pts[0];
  for (const q of r.pts) if (q[1] > sv[1]) sv = q;
  const sx = sv[0] + (r.cx - sv[0]) * 0.12, sz = sv[1] + (r.cz - sv[1]) * 0.12;
  stack(kit, ctx, sx, sz, 55, 2.4, 1.5, lin([0.54, 0.26, 0.19]));
  STATS.tanneryStack = [Math.round(sx), Math.round(sz)];
  // the names: THE TANNERY and COMMUNITECH on Charles St, LANG TANNING CO. painted high on the brick
  const f = frontEdge(city, r.E, /^Charles Street/, 15) || frontEdge(city, r.E, null, 15);
  if (f) {
    const gy = T(f.mx + f.nx * 2, f.mz + f.nz * 2);
    onWall(kit, f, f.L * 0.5, gy + 15.6, text(L, Math.min(26, f.L - 2), 2.6, 'LANG TANNING CO.', { fg: 'rgba(240,232,214,0.86)', font: SERIF, wt: '700', k: 0.72 }), 0.06);
    onWall(kit, f, f.L * 0.25, gy + 4.6, text(L, 7, 1.1, 'THE TANNERY', { bg: '#2b1a12', fg: '#f2c48a', font: SERIF, wt: '700', k: 0.6 }), 0.1);
    onWall(kit, f, f.L * 0.75, gy + 4.6, text(L, 7, 1.1, 'COMMUNITECH', { bg: '#111111', fg: '#ffffff', wt: '800', k: 0.55 }), 0.1);
  }
  const v = frontEdge(city, r.E, /^Victoria Street/, 10);
  if (v) onWall(kit, v, v.L * 0.5, T(v.mx, v.mz) + 15.6, text(L, Math.min(20, v.L - 2), 2.2, 'THE TANNERY', { fg: 'rgba(240,232,214,0.86)', font: SERIF, wt: '700', k: 0.72 }), 0.06);
}

function breithaupt(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const BR = lin([0.52, 0.27, 0.20]);
  const r1 = block(kit, ctx, S.b.bb1.p, {
    h: 17, wall: BR, trim: lin([0.66, 0.60, 0.52]), cornice: 0.6,
    win: { style: 'grid', sp: 4.2, fl: 4.0, g0: 1.2, h: 2.7 }, frame: shade(BR, 1.05), glass: lin([0.16, 0.22, 0.26]),
  });
  const r2 = block(kit, ctx, S.b.bb2.p, {
    h: 25, wall: lin([0.50, 0.30, 0.24]), trim: lin([0.30, 0.32, 0.34]),
    win: { style: 'grid', sp: 3.0, fl: 4.0, g0: 1.0, h: 3.0 }, frame: lin([0.48, 0.30, 0.24]), glass: lin([0.30, 0.42, 0.48]),
  });
  const r3 = block(kit, ctx, S.b.bb3.p, {
    h: 46, wall: lin([0.46, 0.30, 0.25]), trim: lin([0.28, 0.30, 0.32]), parapet: 1.4,
    win: { style: 'curtain', sp: 1.6, fl: 4.0, g0: 4.5, top: 1.0, slab: lin([0.50, 0.30, 0.24]) }, frame: lin([0.20, 0.22, 0.24]), glass: lin([0.36, 0.48, 0.55]),
  });
  void r2;
  // the Google sign: the four colours, on the old factory's face toward King and on the tower's crown
  const goo = (w) => L.panel(w, w * 0.34, 28, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    q.textBaseline = 'middle'; q.font = `500 ${H * 0.8}px "Product Sans", "Helvetica Neue", Arial, sans-serif`;
    const word = 'Google', cols = ['#4285F4', '#EA4335', '#FBBC05', '#4285F4', '#34A853', '#EA4335'];
    let tw = 0; for (const ch of word) tw += q.measureText(ch).width;
    let x = (W - tw) / 2;
    for (let i = 0; i < 6; i++) { q.fillStyle = cols[i]; q.fillText(word[i], x, H * 0.5); x += q.measureText(word[i]).width; }
  });
  const f = frontEdge(city, r1.E, /^King Street/, 8, 120);
  if (f) onWall(kit, f, f.L / 2, r1.yTop - 2.4, goo(Math.min(10, f.L - 1)), 0.12);
  const f3 = frontEdge(city, r3.E, /^King Street/, 8, 160) || frontEdge(city, r3.E, null, 8, 160);
  if (f3) onWall(kit, f3, f3.L / 2, r3.yTop - 3, goo(Math.min(12, f3.L - 2)), 0.12);
}

function kaufman(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const BR = lin([0.52, 0.22, 0.16]), CON = lin([0.80, 0.77, 0.70]);
  const r = block(kit, ctx, S.b.kaufman.p, {
    h: 21, wall: BR, trim: CON, cornice: 1.0, frame: CON, glass: lin([0.18, 0.22, 0.25]),
    plinth: [1.1, CON],
    win: { style: 'grid', sp: 5.6, fl: 4.0, g0: 1.6, h: 2.6, top: 1.6 },
  });
  const f = frontEdge(city, r.E, /^King Street/, 20);
  if (f) {
    onWall(kit, f, f.L / 2, r.yTop - 0.6, text(L, Math.min(22, f.L - 4), 0.9, 'KAUFMAN RUBBER CO. LTD.', { bg: '#cfc8b8', fg: '#4a3f33', font: SERIF, wt: '700', k: 0.74 }), 0.38);
    onWall(kit, f, f.L * 0.2, T(f.mx, f.mz) + 3.6, text(L, 5.5, 0.8, 'KAUFMAN LOFTS', { bg: '#1b1b1b', fg: '#e8dcc4', font: SERIF, wt: '700', k: 0.6 }), 0.12);
  }
  // the stack behind, KAUFMAN down its King St face
  const fx = f ? f.nx : 0, fz = f ? f.nz : 1;
  const sx = -1762, sz = -116;
  stack(kit, ctx, sx, sz, 42, 2.0, 1.3, lin([0.50, 0.22, 0.16]), 'KAUFMAN', fx, fz);
}

function bauer(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const BR = lin([0.55, 0.27, 0.19]);
  const tw = block(kit, ctx, S.b.bauer.p, {
    h: 48, wall: lin([0.60, 0.61, 0.62]), trim: lin([0.30, 0.31, 0.32]), parapet: 1.2,
    plinth: [10.5, BR],
    win: { style: 'ribbon', fl: 3.1, g0: 11.5, h: 1.9 }, glass: lin([0.24, 0.32, 0.38]),
  });
  void tw;
  const f1 = block(kit, ctx, S.b.bauerS1.p, {
    h: 15, wall: BR, trim: lin([0.72, 0.66, 0.56]), cornice: 0.7,
    win: { style: 'grid', sp: 4.0, fl: 3.7, g0: 1.4, h: 2.4 }, frame: shade(BR, 1.06),
  });
  block(kit, ctx, S.b.bauerS2.p, {
    h: 8, wall: BR, trim: lin([0.72, 0.66, 0.56]), cornice: 0.6,
    win: { style: 'grid', sp: 4.0, fl: 3.7, g0: 1.4, h: 2.4 }, frame: shade(BR, 1.06),
  });
  const f = frontEdge(city, f1.E, /^King Street/, 8);
  if (f) {
    onWall(kit, f, f.L / 2, f1.yTop - 1.6, text(L, Math.min(12, f.L - 2), 1.5, 'BAUER', { fg: 'rgba(242,234,218,0.9)', font: SERIF, wt: '700', k: 0.8 }), 0.06);
    onWall(kit, f, f.L * 0.3, T(f.mx, f.mz) + 3.7, text(L, 6, 0.9, 'THE BAUER KITCHEN', { bg: '#121212', fg: '#e9d9b8', wt: '700', k: 0.5 }), 0.1);
  }
}

// --- Victoria Park -------------------------------------------------------------------------

const VP_CLOCK = [-1527, 388];      // OSM: amenity=clock, historic=monument (the 1924 City Hall's tower)
const VP_QUEEN = [-1695, 496];      // Queen Victoria (Zaccagnini, 1911)

function victoriaPark(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  // THE CLOCK TOWER: buff stone shaft, a cornice, the clock stage, a cupola
  {
    const [x, z] = VP_CLOCK, y = walkY(city, x, z), B = kit.B(x, z), g = kit.grp(x, z);
    const STONE = lin([0.78, 0.73, 0.62]), DK = lin([0.62, 0.57, 0.48]), rot = 0.45, S0 = 3.8;
    B.box(x, y - 0.5, z, S0 + 1.2, 1.6, S0 + 1.2, rot, DK);
    B.box(x, y + 1.1, z, S0, 10, S0, rot, STONE);
    B.box(x, y + 11.1, z, S0 + 0.6, 0.6, S0 + 0.6, rot, DK);
    B.box(x, y + 11.7, z, S0 + 0.2, 3.4, S0 + 0.2, rot, STONE);
    B.box(x, y + 15.1, z, S0 + 0.8, 0.6, S0 + 0.8, rot, DK);
    // the cupola: eight posts, a dome, a finial
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      B.prism(x + Math.cos(a) * 1.4, y + 15.7, z + Math.sin(a) * 1.4, 0.13, 2.4, 6, STONE);
    }
    B.prism(x, y + 18.1, z, 1.7, 0.4, 8, DK);
    B.spheroid(x, y + 18.5, z, 1.55, 10, 5, lin([0.36, 0.52, 0.46]), 0.75);
    B.prism(x, y + 19.4, z, 0.08, 1.6, 5, lin([0.30, 0.28, 0.22]));
    // vertical recesses on the shaft
    const c = Math.cos(rot), s = Math.sin(rot);
    const clock = clockFace(L, 2.5);
    for (const [a, b] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = a * c - b * s, nz = a * s + b * c, tx = -nz, tz = nx;
      const px = x + nx * (S0 / 2 + 0.11), pz = z + nz * (S0 / 2 + 0.11);
      hang(g, clock.clone(), px, y + 13.4, pz, nx, nz, 0.03);
      const qx = x + nx * (S0 / 2 + 0.02), qz = z + nz * (S0 / 2 + 0.02);
      B.quad([qx - tx * 0.5, y + 3, qz - tz * 0.5], [qx + tx * 0.5, y + 3, qz + tz * 0.5], [qx + tx * 0.5, y + 9.5, qz + tz * 0.5], [qx - tx * 0.5, y + 9.5, qz - tz * 0.5], [nx, 0, nz], U0, DK);
    }
    ctx.solids.push({ x, z, hw: S0 / 2 + 0.6, hd: S0 / 2 + 0.6, rot, y0: y - 1, y1: y + 19 });
    // the fountain beside it
    const fx = x + 7 * Math.cos(rot + 0.6), fz = z + 7 * Math.sin(rot + 0.6), fy = walkY(city, fx, fz);
    if (!city.onRoad(fx, fz, 3.2, false, false)) {
      B.prism(fx, fy - 0.3, fz, 3.0, 0.8, 14, lin([0.70, 0.68, 0.64]));
      B.prism(fx, fy - 0.3, fz, 2.7, 0.75, 14, lin([0.20, 0.40, 0.48]));
      B.cone(fx, fy + 0.4, fz, 2.68, 0.02, 14, lin([0.22, 0.44, 0.52]));
      B.prism(fx, fy + 0.4, fz, 0.35, 1.2, 8, lin([0.70, 0.68, 0.64]));
      B.cone(fx, fy + 1.6, fz, 0.25, 1.4, 6, lin([0.92, 0.95, 0.97]));
      ctx.solids.push({ x: fx, z: fz, r: 3.0, y0: fy - 1, y1: fy + 0.5 });
    }
    ctx.clearAt && ctx.clearAt.push([x, z, 9]);
  }
  // THE PAVILION (1924): pale, two storeys, a hipped roof
  {
    const r = block(kit, ctx, S.b.vicpav.p, {
      h: 7.5, wall: lin([0.88, 0.84, 0.74]), trim: lin([0.24, 0.36, 0.28]), parapet: 0,
      plinth: [0.7, lin([0.55, 0.50, 0.44])],
      win: { style: 'punch', sp: 2.6, w: 1.3, h: 2.0, fl: 3.5, g0: 0.9, sill: lin([0.24, 0.36, 0.28]) }, frame: lin([0.24, 0.36, 0.28]),
    });
    hipRoof(r.B, obb(r.pts), r.yTop, 4.2, lin([0.30, 0.40, 0.34]), 1.4);
    const f = frontEdge(city, r.E, null, 8, 90);
    if (f) onWall(kit, f, f.L / 2, r.yTop - 1.2, text(L, 6, 0.75, 'VICTORIA PARK PAVILION', { bg: '#24402f', fg: '#f3ead2', font: SERIF, wt: '700', k: 0.52 }), 0.1);
    ctx.clearAt && ctx.clearAt.push([r.cx, r.cz, 26]);
  }
  // THE BOATHOUSE: timber, gabled, on the water's edge
  {
    const p = ccw(S.b.boathouse.p), o = obb(p), y = T(o.x, o.z);
    const B = kit.B(o.x, o.z);
    gabled(B, o, y - 1, y + 4.4, y + 8.2, lin([0.50, 0.30, 0.22]), lin([0.26, 0.28, 0.27]), { overhang: 0.8 });
    const E = edges([[o.x - o.ux * o.hu - o.uz * o.hv, o.z - o.uz * o.hu + o.ux * o.hv], [o.x + o.ux * o.hu - o.uz * o.hv, o.z + o.uz * o.hu + o.ux * o.hv],
      [o.x + o.ux * o.hu + o.uz * o.hv, o.z + o.uz * o.hu - o.ux * o.hv], [o.x - o.ux * o.hu + o.uz * o.hv, o.z - o.uz * o.hu - o.ux * o.hv]]);
    for (const e of E) {
      ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: y - 1, y1: y + 4.4 });
      if (e.L < 8) continue;
      for (let t = 2; t < e.L - 1.5; t += 3) B.quad(e.at(t - 0.7, y + 1.1, 0.04), e.at(t + 0.7, y + 1.1, 0.04), e.at(t + 0.7, y + 3.0, 0.04), e.at(t - 0.7, y + 3.0, 0.04), [e.nx, 0, e.nz], U0, lin([0.16, 0.2, 0.22]));
    }
    const f = frontEdge(city, E, null, 8, 90) || E[0];
    onWall(kit, f, f.L / 2, y + 3.75, text(L, 5.5, 0.9, 'THE BOATHOUSE', { bg: '#1d2b22', fg: '#f2e6c8', font: SERIF, wt: '700', k: 0.58 }), 0.1);
  }
  // THE SHELTER ON THE ISLAND
  {
    const [cx, cz] = centroid(S.b.island.p);
    const wl = G.waterLevel(cx, cz);
    gazebo(kit, ctx, S.b.island.p, { roof: [0.48, 0.20, 0.16] });
    STATS.island = { y: +T(cx, cz).toFixed(2), water: wl == null ? null : +wl.toFixed(2) };
  }
  // QUEEN VICTORIA on her plinth
  {
    const [x, z] = VP_QUEEN, y = walkY(city, x, z), B = kit.B(x, z);
    const GR = lin([0.62, 0.61, 0.58]), BZ = lin([0.20, 0.27, 0.22]);
    B.box(x, y - 0.4, z, 3.4, 0.9, 3.4, 0.3, GR);
    B.box(x, y + 0.5, z, 2.2, 2.8, 2.2, 0.3, GR);
    B.box(x, y + 3.3, z, 2.6, 0.4, 2.6, 0.3, GR);
    B.cone(x, y + 3.7, z, 0.75, 2.1, 10, BZ);
    B.prism(x, y + 4.3, z, 0.38, 1.3, 8, BZ);
    B.spheroid(x, y + 5.85, z, 0.27, 8, 5, BZ);
    B.cone(x, y + 6.05, z, 0.2, 0.3, 6, BZ);
    ctx.solids.push({ x, z, r: 1.7, y0: y - 1, y1: y + 6 });
    ctx.clearAt && ctx.clearAt.push([x, z, 5]);
  }
  // JOSEPH SCHNEIDER HAUS (1816): white frame Georgian, two storeys, chimneys at both ends, a verandah
  {
    const p = ccw(S.b.schneider.p), o0 = obb(p);
    const o = { ...o0, hu: Math.min(o0.hu, 9), hv: Math.min(o0.hv, 5.5) };
    const y = T(o.x, o.z), B = kit.B(o.x, o.z);
    const WH = lin([0.92, 0.90, 0.84]), RF = lin([0.30, 0.28, 0.26]);
    const P = gabled(B, o, y - 1, y + 6.0, y + 9.4, WH, RF, { overhang: 0.35 });
    for (const s of [-1, 1]) B.box(P(s * (o.hu - 0.6), 0, 0)[0], y + 5.5, P(s * (o.hu - 0.6), 0, 0)[2], 0.9, 4.6, 0.9, Math.atan2(o.uz, o.ux), lin([0.55, 0.30, 0.22]));
    const vx = -o.uz, vz = o.ux;
    for (const s of [-1, 1]) {
      for (let k = -2; k <= 2; k++) for (const yy of [1.0, 3.9]) {
        const c = P(k * o.hu * 0.36, s * (o.hv + 0.03), 0);
        const N = [vx * s, 0, vz * s];
        B.quad([c[0] - o.ux * 0.5, y + yy, c[2] - o.uz * 0.5], [c[0] + o.ux * 0.5, y + yy, c[2] + o.uz * 0.5], [c[0] + o.ux * 0.5, y + yy + 1.6, c[2] + o.uz * 0.5], [c[0] - o.ux * 0.5, y + yy + 1.6, c[2] - o.uz * 0.5], N, U0, lin([0.12, 0.14, 0.16]));
        for (const sh of [-1, 1]) B.quad([c[0] + o.ux * sh * 0.55, y + yy, c[2] + o.uz * sh * 0.55], [c[0] + o.ux * sh * 0.95, y + yy, c[2] + o.uz * sh * 0.95], [c[0] + o.ux * sh * 0.95, y + yy + 1.6, c[2] + o.uz * sh * 0.95], [c[0] + o.ux * sh * 0.55, y + yy + 1.6, c[2] + o.uz * sh * 0.55], N, U0, lin([0.18, 0.26, 0.20]));
      }
    }
    // the verandah along the street side
    const q = street(city, o.x, o.z, 120, /^Queen Street/);
    const s = q ? Math.sign((q.qx - o.x) * vx + (q.qz - o.z) * vz) || 1 : 1;
    const a0 = P(-o.hu, s * o.hv, y + 3.3), a1 = P(o.hu, s * o.hv, y + 3.3), b0 = P(-o.hu, s * (o.hv + 2.6), y + 2.7), b1 = P(o.hu, s * (o.hv + 2.6), y + 2.7);
    B.quad(a0, a1, b1, b0, [vx * s * 0.3, 0.95, vz * s * 0.3], U0, RF);
    for (let k = 0; k <= 5; k++) { const c = P(-o.hu + 0.3 + k * (2 * o.hu - 0.6) / 5, s * (o.hv + 2.3), y); B.prism(c[0], y - 0.2, c[2], 0.09, 2.95, 6, WH); }
    for (const sd of [-1, 1]) ctx.solids.push({ x: P(0, sd * o.hv, 0)[0], z: P(0, sd * o.hv, 0)[2], hw: o.hu, hd: 0.3, rot: Math.atan2(o.uz, o.ux), y0: y - 1, y1: y + 6 });
    for (const sd of [-1, 1]) ctx.solids.push({ x: P(sd * o.hu, 0, 0)[0], z: P(sd * o.hu, 0, 0)[2], hw: 0.3, hd: o.hv, rot: Math.atan2(o.uz, o.ux), y0: y - 1, y1: y + 6 });
    // its sign by the walk
    const sp = P(0, s * (o.hv + 9), 0), sy = walkY(city, sp[0], sp[2]);
    if (!city.onRoad(sp[0], sp[2], 1.5, false, false)) {
      B.box(sp[0], sy - 0.3, sp[2], 2.6, 0.5, 0.35, Math.atan2(o.uz, o.ux), lin([0.42, 0.38, 0.32]));
      const m = text(L, 2.4, 0.9, 'JOSEPH SCHNEIDER HAUS', { bg: '#efe7d2', fg: '#3a2f22', font: SERIF, wt: '700', k: 0.3, sub: 'MUSEUM · 1816', subk: 0.2 });
      for (const sd of [1, -1]) hang(kit.grp(sp[0], sp[2]), m.clone(), sp[0], sy + 0.75, sp[2], vx * s * sd, vz * s * sd, 0.18);
    }
    ctx.clearAt && ctx.clearAt.push([o.x, o.z, 14]);
  }
}

// --- the Aud ---------------------------------------------------------------------------------

function aud(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const CON = lin([0.66, 0.65, 0.62]), RED = lin([0.62, 0.10, 0.14]);
  const r = block(kit, ctx, simplify(S.b.aud.p, 0.8), {
    h: 10.5, wall: CON, trim: lin([0.80, 0.79, 0.76]), cornice: 0.9,
    plinth: [1.0, lin([0.50, 0.49, 0.47])],
    win: { style: 'ribbon', fl: 6, g0: 6.4, h: 1.4, minL: 14 }, glass: lin([0.20, 0.26, 0.30]),
  });
  const B = r.B;
  // the two bowls under their barrel roofs: the Aud (west, East Ave) and the Kinsmen/Kiwanis rinks
  const west = r.pts.filter((q) => q[0] < 652), east = r.pts.filter((q) => q[0] >= 652);
  const RF = lin([0.56, 0.58, 0.60]);
  const bw = obb(west), be = obb(east);
  if (bw) barrel(B, { ...bw, hu: bw.hu - 2, hv: bw.hv - 2 }, r.yTop - 0.2, 9.5, RF, CON, 12);
  if (be) barrel(B, { ...be, hu: be.hu - 3, hv: be.hv - 3 }, r.yTop - 0.2, 6.5, shade(RF, 1.05), CON, 10);
  // KITCHENER MEMORIAL AUDITORIUM etched along the East Ave front; THE AUD and the Rangers by the doors
  const f = frontEdge(city, r.E, /^East Avenue/, 12, 120);
  if (f) {
    const gy = T(f.mx + f.nx * 2, f.mz + f.nz * 2);
    onWall(kit, f, f.L / 2, r.yTop - 1.6, text(L, Math.min(30, f.L - 2), 1.3, 'KITCHENER MEMORIAL AUDITORIUM', { fg: '#3c3b38', wt: '700', k: 0.72 }), 0.06);
    // glass doors with a red canopy
    const w = Math.min(18, f.L * 0.5), t = f.L / 2, N = [f.nx, 0, f.nz];
    B.quad(f.at(t - w / 2, gy - 0.3, 0.06), f.at(t + w / 2, gy - 0.3, 0.06), f.at(t + w / 2, gy + 3.6, 0.06), f.at(t - w / 2, gy + 3.6, 0.06), N, U0, lin([0.18, 0.24, 0.28]));
    B.quad(f.at(t - w / 2 - 1, gy + 3.8, 2.6), f.at(t + w / 2 + 1, gy + 3.8, 2.6), f.at(t + w / 2 + 1, gy + 4.6, 2.6), f.at(t - w / 2 - 1, gy + 4.6, 2.6), N, U0, RED);
    B.quad(f.at(t - w / 2 - 1, gy + 4.6, 2.6), f.at(t + w / 2 + 1, gy + 4.6, 2.6), f.at(t + w / 2 + 1, gy + 4.6, 0), f.at(t - w / 2 - 1, gy + 4.6, 0), [0, 1, 0], U0, RED);
    B.quad(f.at(t - w / 2 - 1, gy + 3.8, 2.6), f.at(t + w / 2 + 1, gy + 3.8, 2.6), f.at(t + w / 2 + 1, gy + 3.8, 0), f.at(t - w / 2 - 1, gy + 3.8, 0), [0, -1, 0], U0, shade(RED, 0.5));
    onWall(kit, f, t, gy + 6.2, text(L, 7, 1.5, 'THE AUD', { bg: '#c8102e', fg: '#ffffff', wt: '900', k: 0.7 }), 0.1);
  }
  // Rangers banners on the long faces
  const banner = L.panel(2.4, 5.2, 16, (q, W, H) => {
    q.fillStyle = '#002d62'; q.fillRect(0, 0, W, H);
    q.fillStyle = '#c8102e'; q.fillRect(0, H * 0.06, W, H * 0.07); q.fillRect(0, H * 0.87, W, H * 0.07);
    q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `italic 800 ${W * 0.36}px ${SERIF}`;
    q.save(); q.translate(W / 2, H / 2); q.rotate(-Math.PI / 2); q.fillText('Rangers', 0, 0, H * 0.7); q.restore();
  });
  let nb = 0;
  for (const e of r.E) {
    if (e.L < 30 || e === f || nb >= 6) continue;
    const s = street(city, e.mx + e.nx * 3, e.mz + e.nz * 3, 200);
    if (!s) continue;
    for (const tt of [e.L * 0.3, e.L * 0.7]) { onWall(kit, e, tt, r.yTop - 3.8, banner.clone(), 0.1); nb++; }
  }
  STATS.aud = { front: f ? [Math.round(f.mx), Math.round(f.mz)] : null, banners: nb };
}

// --- the malls -----------------------------------------------------------------------------

const BRANDS = {
  Walmart: ['#0071ce', '#ffffff', 'spark'], 'Walmart Supercentre': ['#0071ce', '#ffffff', 'spark'],
  Winners: ['#000000', '#ffffff'], 'Sport Chek': ['#e31837', '#ffffff', 'italic'], "Mark's": ['#c8102e', '#ffffff'],
  RBC: ['#005daa', '#ffd200'], Rona: ['#003da5', '#ffffff'], 'The Brick': ['#111111', '#e4002b'], Structube: ['#111111', '#ffffff'],
  'Landmark Cinemas 10 Waterloo': ['#b3001b', '#ffffff'], Marshalls: ['#0b2d6b', '#ffffff'], Staples: ['#cc0000', '#ffffff'],
  'Golf Town': ['#00573f', '#ffffff'], Solutions: ['#5c2d91', '#ffffff'], 'Bulk Barn': ['#ffd200', '#006a3a'], Dollarama: ['#00a651', '#ffe600'],
  CIBC: ['#c41f3e', '#ffffff'], 'TD Canada Trust': ['#008a00', '#ffffff'], 'Swiss Chalet': ['#d71920', '#ffffff'],
  "Montana's": ['#5a2a12', '#f2c14e'], Milestones: ['#111111', '#ffffff'], 'Movati Athletic': ['#111111', '#00b3e3'],
  Sephora: ['#000000', '#ffffff'], "McDonald's": ['#da291c', '#ffc72c'], Telus: ['#4b286d', '#ffffff'], Bell: ['#00549a', '#ffffff'],
  'Hudson\'s Bay': ['#ffffff', '#1a1a1a'], 'H&M': ['#ffffff', '#e50010'], Hollister: ['#0f2847', '#ffffff'],
};
const NAME = { 'Landmark Cinemas 10 Waterloo': 'LANDMARK CINEMAS', 'TD Canada Trust': 'TD', 'Walmart Supercentre': 'Walmart', 'Movati Athletic': 'MOVATI' };
function brandPanel(L, name, w, h) {
  const [bg, fg, style] = BRANDS[name] || ['#1d2a3a', '#ffffff'];
  const label = NAME[name] || name;
  return L.panel(w, h, 26, (q, W, H) => {
    q.fillStyle = bg; q.fillRect(0, 0, W, H);
    q.fillStyle = fg; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `${style === 'italic' ? 'italic ' : ''}800 ${H * 0.6}px ${SANS}`;
    const sp = style === 'spark';
    q.fillText(label, sp ? W * 0.44 : W / 2, H * 0.55, W * (sp ? 0.7 : 0.92));
    if (sp) {
      // Walmart's yellow spark
      q.fillStyle = '#ffc220';
      const cx = W * 0.86, cy = H * 0.5, rr = H * 0.32;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        q.save(); q.translate(cx + Math.cos(a) * rr * 0.55, cy + Math.sin(a) * rr * 0.55); q.rotate(a + Math.PI / 2);
        q.beginPath(); q.ellipse(0, 0, rr * 0.16, rr * 0.42, 0, 0, Math.PI * 2); q.fill(); q.restore();
      }
    }
  });
}
/** A store's raised parapet on edge e at t, with its sign. */
function parapetSign(kit, ctx, e, t, yTop, name, w, wallc) {
  const B = kit.B(e.mx, e.mz), gy = T(e.mx + e.nx * 3, e.mz + e.nz * 3);
  const h = Math.max(1.4, w * 0.2), pw = Math.min(e.L, w + 4), N = [e.nx, 0, e.nz];
  const py1 = yTop + h + 1.6, PAR = shade(wallc, 1.08);
  B.quad(e.at(t - pw / 2, gy + 3.5, 0.6), e.at(t + pw / 2, gy + 3.5, 0.6), e.at(t + pw / 2, py1, 0.6), e.at(t - pw / 2, py1, 0.6), N, U0, PAR);
  for (const s of [-1, 1]) B.quad(e.at(t + s * pw / 2, gy + 3.5, 0), e.at(t + s * pw / 2, gy + 3.5, 0.6), e.at(t + s * pw / 2, py1, 0.6), e.at(t + s * pw / 2, py1, 0), [e.ux * s, 0, e.uz * s], U0, shade(PAR, 0.8));
  B.quad(e.at(t - pw / 2, py1, 0.6), e.at(t + pw / 2, py1, 0.6), e.at(t + pw / 2, py1, -1.4), e.at(t - pw / 2, py1, -1.4), [0, 1, 0], U0, shade(PAR, 0.7));
  B.quad(e.at(t - pw / 2, py1, -1.4), e.at(t + pw / 2, py1, -1.4), e.at(t + pw / 2, yTop, -1.4), e.at(t - pw / 2, yTop, -1.4), [-e.nx, 0, -e.nz], U0, PAR);
  B.quad(e.at(t - pw / 2, gy + 3.5, 0.6), e.at(t + pw / 2, gy + 3.5, 0.6), e.at(t + pw / 2, gy + 3.5, 0), e.at(t - pw / 2, gy + 3.5, 0), [0, -1, 0], U0, shade(PAR, 0.5));
  onWall(kit, e, t, (yTop + py1) / 2 - 0.1, brandPanel(ctx.atlas, name, w, h), 0.63);
}
/** The edge nearest (px, pz) at least minL long, and how far along it. */
function nearestEdge(E, px, pz, minL = 6) {
  let best = null, bd = Infinity;
  for (const e of E) {
    if (e.L < minL) continue;
    const t = Math.max(3, Math.min(e.L - 3, (px - e.a[0]) * e.ux + (pz - e.a[1]) * e.uz));
    const q = e.at(t, 0), d = Math.hypot(q[0] - px, q[2] - pz);
    if (d < bd) { bd = d; best = { e, t, d }; }
  }
  return best;
}
/** An entrance: glass vestibule and canopy. */
function entrance(kit, ctx, e, t, w, h, name = null, opts = {}) {
  const B = kit.B(e.mx, e.mz), gy = T(e.mx + e.nx * 3, e.mz + e.nz * 3), d = opts.d || 3.6, N = [e.nx, 0, e.nz];
  const GL = lin([0.20, 0.27, 0.33]), FR = lin([0.75, 0.77, 0.80]), CAN = lin([0.88, 0.88, 0.86]);
  B.quad(e.at(t - w / 2, gy - 0.2, d), e.at(t + w / 2, gy - 0.2, d), e.at(t + w / 2, gy + h, d), e.at(t - w / 2, gy + h, d), N, U0, GL);
  for (const s of [-1, 1]) B.quad(e.at(t + s * w / 2, gy - 0.2, 0), e.at(t + s * w / 2, gy - 0.2, d), e.at(t + s * w / 2, gy + h, d), e.at(t + s * w / 2, gy + h, 0), [e.ux * s, 0, e.uz * s], U0, GL);
  for (let k = 0; k <= 4; k++) { const tt = t - w / 2 + w * k / 4; B.quad(e.at(tt - 0.08, gy - 0.2, d + 0.03), e.at(tt + 0.08, gy - 0.2, d + 0.03), e.at(tt + 0.08, gy + h, d + 0.03), e.at(tt - 0.08, gy + h, d + 0.03), N, U0, FR); }
  const cw = w + 4, cd = d + 3, cy = gy + h;
  B.quad(e.at(t - cw / 2, cy + 0.6, 0), e.at(t + cw / 2, cy + 0.6, 0), e.at(t + cw / 2, cy + 0.6, cd), e.at(t - cw / 2, cy + 0.6, cd), [0, 1, 0], U0, CAN);
  B.quad(e.at(t - cw / 2, cy, 0), e.at(t + cw / 2, cy, 0), e.at(t + cw / 2, cy, cd), e.at(t - cw / 2, cy, cd), [0, -1, 0], U0, shade(CAN, 0.7));
  B.quad(e.at(t - cw / 2, cy, cd), e.at(t + cw / 2, cy, cd), e.at(t + cw / 2, cy + 0.6, cd), e.at(t - cw / 2, cy + 0.6, cd), N, U0, opts.can || lin([0.30, 0.32, 0.36]));
  for (const s of [-1, 1]) { const p = e.at(t + s * (cw / 2 - 0.4), gy - 0.2, cd - 0.4); B.prism(p[0], p[1], p[2], 0.18, cy - gy + 0.3, 8, FR); ctx.solids.push({ x: p[0], z: p[2], r: 0.25, y0: gy - 1, y1: cy }); }
  const c = e.at(t, 0, d / 2);
  ctx.solids.push({ x: c[0], z: c[2], hw: w / 2, hd: d / 2, rot: Math.atan2(e.uz, e.ux), y0: gy - 1, y1: gy + h });
  if (name) onWall(kit, e, t, cy + 0.3, name, cd + 0.03);
}

// CF FAIRVIEW PARK, from the 2026 aerial (Esri World Imagery) and photographs:
// a long concourse SW-NE between the Bay's dark brick box (empty since 2025)
// and Walmart's wing (the old Woolco), the Sears wing to the SE split into
// Winners, Sport Chek, Mark's and RBC with their own doors, the main entrance
// on the south toward Fairway station and its roundabout. Tan precast with a
// brown fascia and pilasters; a raised clerestory down the concourse with
// glass pyramids over the courts; white membrane roofs with plant on them.
const FAIR_WALMART = [[2933, 2952], [3030, 2851], [3082, 2898], [2982, 3002]];
const FAIR_BAY = [[2722, 3165], [2765, 3122], [2826, 3184], [2784, 3229]];
const FAIR_SEARS = [[2952, 3177], [3039, 3071], [3098, 3111], [3001, 3208]];
const FAIR_SPINE = [[2795, 3148], [2876, 3066], [2918, 3030], [2952, 2995]];
const FAIR_COURTS = [[2942, 2992], [2918, 3030], [2876, 3066], [2904, 3120]];
// the anchors' own doors (OSM's points, and the aerial for Walmart's front)
const FAIR_ANCHORS = [['Walmart', 3040, 2960, 15], ['Winners', 2987, 3178, 8], ['Sport Chek', 3045, 3140, 9], ["Mark's", 3080, 3118, 6], ['RBC', 3092, 3100, 3.5]];
// mall entrances seen on the aerial: [x, z, main]
const FAIR_DOORS = [[2838, 3177, 1], [2885, 2983, 1], [2758, 3111, 0], [2928, 3160, 0]];

function fairZone(x, z) {
  if (inPoly(FAIR_WALMART, x, z)) return 'walmart';
  if (inPoly(FAIR_BAY, x, z)) return 'bay';
  if (inPoly(FAIR_SEARS, x, z)) return 'sears';
  return 'mall';
}
const FAIR_LOOK = {
  mall: { h: 9.5, wall: [0.83, 0.73, 0.59], band: [0.40, 0.30, 0.22] },
  walmart: { h: 9.0, wall: [0.78, 0.76, 0.71], band: [0.00, 0.33, 0.64] },
  bay: { h: 15.0, wall: [0.36, 0.25, 0.19], band: [0.30, 0.21, 0.16] },
  sears: { h: 11.0, wall: [0.76, 0.69, 0.58], band: [0.36, 0.27, 0.20] },
};

function fairview(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const pts = ccw(simplify(S.b.fairview.p, 0.9));
  const [cx, cz] = centroid(pts);
  const B = kit.B(cx, cz);
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const base = T(cx, cz);
  const E = edges(pts);
  const PIL = lin([0.86, 0.80, 0.70]), BASEC = lin([0.50, 0.45, 0.40]);
  const zoneOf = (e) => fairZone(e.mx - e.nx * 8, e.mz - e.nz * 8);
  for (const e of E) {
    const Z = FAIR_LOOK[zoneOf(e)], yTop = base + Z.h, wall = lin(Z.wall), band = lin(Z.band), N = [e.nx, 0, e.nz];
    e.zone = zoneOf(e); e.yTop = yTop;
    B.quad(e.at(0, lo - 1.2), e.at(e.L, lo - 1.2), e.at(e.L, yTop + 0.9), e.at(0, yTop + 0.9), N, U0, [shade(wall, 0.8), shade(wall, 0.8), wall, wall]);
    B.quad(e.at(0, yTop + 0.9, 0.12), e.at(e.L, yTop + 0.9, 0.12), e.at(e.L, yTop + 1.0, 0), e.at(0, yTop + 1.0, 0), [0, 1, 0], U0, band);
    ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: lo - 1.2, y1: yTop + 0.9 });
    if (e.L < 3) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    // the fascia band, the base course
    B4(B, e, 0, e.L, yTop - (e.zone === 'walmart' ? 2.4 : 1.6), yTop + 0.9, 0.25, N, band);
    B4(B, e, 0, e.L, yTop - (e.zone === 'walmart' ? 2.4 : 1.6) - 0.01, yTop - (e.zone === 'walmart' ? 2.4 : 1.6), 0.25, [0, -1, 0], shade(band, 0.5));
    if (e.zone !== 'bay') B4(B, e, 0, e.L, gy - 0.4, gy + 1.0, 0.05, N, BASEC);
    // pilasters (brick-banded on the Bay)
    if (e.zone === 'bay') { for (let y = gy + 2; y < yTop - 1; y += 2.6) B4(B, e, 0, e.L, y, y + 0.25, 0.04, N, lin([0.28, 0.19, 0.15])); }
    else if (e.zone !== 'walmart') for (let t = 4.5; t < e.L - 2; t += 9) B4(B, e, t - 0.45, t + 0.45, gy + 1.0, yTop - 1.6, 0.12, N, PIL);
    if (e.zone === 'walmart') B4(B, e, 0, e.L, gy + 1.0, gy + 1.6, 0.06, N, lin([0.55, 0.56, 0.58]));
  }
  // the roofs: membrane over all, then the taller boxes, the Bay dark
  roof(B, pts, base + 9.0, lin([0.80, 0.80, 0.78]));
  for (const [zn, poly] of [['bay', FAIR_BAY], ['sears', FAIR_SEARS], ['mall', null]]) {
    if (!poly) continue;
    const inner = pts.filter((q) => inPoly(poly, q[0], q[1]));
    const o = obb(inner.length > 3 ? inner : poly);
    const Z = FAIR_LOOK[zn], rot = Math.atan2(o.uz, o.ux);
    B.box(o.x, base + 8.8, o.z, o.hu * 2 - 1, Z.h - 8.8 + 0.9, o.hv * 2 - 1, rot, zn === 'bay' ? lin([0.30, 0.22, 0.17]) : lin(Z.wall), { top: false });
    B.box(o.x, base + Z.h + 0.6, o.z, o.hu * 2 - 1.6, 0.05, o.hv * 2 - 1.6, rot, zn === 'bay' ? lin([0.24, 0.22, 0.20]) : lin([0.82, 0.82, 0.80]), { sides: false });
  }
  // plant on the roofs
  const o = obb(pts);
  for (let i = 0; i < 30; i++) {
    const u = (hash2(i, 61) - 0.5) * o.hu * 1.8, v = (hash2(i, 62) - 0.5) * o.hv * 1.6;
    const x = o.x + o.ux * u - o.uz * v, z = o.z + o.uz * u + o.ux * v;
    if (!inPoly(pts, x, z)) continue;
    const zn = fairZone(x, z), y = base + FAIR_LOOK[zn].h + (zn === 'mall' || zn === 'walmart' ? -0.5 : 0.6);
    B.box(x, y, z, 2.6 + hash2(i, 63) * 2.5, 1.5, 2.0, Math.atan2(o.uz, o.ux), lin([0.68, 0.69, 0.70]));
  }
  // the clerestory down the concourse and the glass pyramids over the courts
  const GLC = lin([0.30, 0.37, 0.41]), CW = lin([0.84, 0.80, 0.72]);
  for (let i = 0; i < FAIR_SPINE.length - 1; i++) {
    const a = FAIR_SPINE[i], b = FAIR_SPINE[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, rot = Math.atan2(dz, dx), y = base + 9.4;
    B.box(mx, y, mz, len, 1.6, 8, rot, GLC, { top: false });
    B.box(mx, y + 1.6, mz, len + 0.6, 0.5, 8.6, rot, CW);
    // a shallow gable of glass along it
    const ux = dx / len, uz = dz / len, vx = -uz, vz = ux;
    for (const s of [-1, 1]) B.quad([a[0] + vx * 4.3 * s, y + 2.1, a[1] + vz * 4.3 * s], [b[0] + vx * 4.3 * s, y + 2.1, b[1] + vz * 4.3 * s], [b[0], y + 3.6, b[1]], [a[0], y + 3.6, a[1]], [vx * s * 0.4, 0.9, vz * s * 0.4], U0, GLC);
  }
  for (const [x, z] of FAIR_COURTS) {
    B.box(x, base + 9.4, z, 9, 1.4, 9, 0.79, CW);
    pyramid(B, x, base + 10.8, z, 4.4, 3.8, 0.79, GLC);
  }
  // Walmart's front: the blue fascia, the sign and its two doors
  const used = new Set();
  for (const [name, x, z, w] of FAIR_ANCHORS) {
    const f = nearestEdge(E, x, z, Math.max(w + 2, 8));
    if (!f) continue;
    const e = f.e, t = Math.max(w / 2 + 1, Math.min(e.L - w / 2 - 1, f.t));
    used.add(e);
    if (name === 'Walmart') {
      // the blue fascia runs the whole front; the sign stands proud of it, a grey band at the doors
      B4(kit.B(e.mx, e.mz), e, 0, e.L, T(e.mx, e.mz) + 4.6, T(e.mx, e.mz) + 5.0, 0.08, [e.nx, 0, e.nz], lin([0.42, 0.44, 0.47]));
      onWall(kit, e, t, e.yTop - 0.9, brandPanel(L, name, 22, 3.6), 0.4);
      for (const s of [-1, 1]) {
        const td = t + s * Math.min(22, e.L / 2 - 6);
        entrance(kit, ctx, e, td, 9, 4.2, text(L, 5, 0.75, s < 0 ? 'Grocery' : 'Home & Pharmacy', { fg: '#ffffff', wt: '700', k: 0.62 }), { can: lin([0.00, 0.33, 0.64]), d: 4.5 });
      }
    } else {
      storeFront(kit, ctx, e, t, e.yTop, name, w, lin(FAIR_LOOK[e.zone].wall), 'parapet');
    }
  }
  // the mall's own doors; the main ones are glazed gables with the name
  const cf = (w) => L.panel(w, w * 0.16, 40, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `700 ${H * 0.7}px ${SANS}`; q.fillText('CF Fairview Park', W / 2, H * 0.55, W * 0.97);
  });
  for (const [x, z, main] of FAIR_DOORS) {
    const f = nearestEdge(E, x, z, 10);
    if (!f || f.d > 20) continue;
    const e = f.e, t = Math.max(8, Math.min(e.L - 8, f.t));
    if (main) atriumEntrance(kit, ctx, e, t, 14, e.yTop + 3.5, cf(9));
    else entrance(kit, ctx, e, t, 8, 4.4, null, { can: lin([0.40, 0.30, 0.22]) });
    used.add(e);
  }
  // the red paving and the roundabout plaza before the south entrance
  {
    const D = kit.B(2822, 3205), py = walkY(city, 2822, 3205) + 0.12, n = 18;   // a slab, not a decal: no extra draw
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      D.tri([2822, py, 3205], [2822 + Math.cos(a0) * 11, py, 3205 + Math.sin(a0) * 11], [2822 + Math.cos(a1) * 11, py, 3205 + Math.sin(a1) * 11], [0, 1, 0], lin([0.55, 0.30, 0.24]));
    }
  }
  // the pylon on Fairway Rd
  const k = street(city, 2860, 3330, 120, /^Fairway Road/);
  if (k) {
    const nx = (cx - k.qx) / k.d, nz = (cz - k.qz) / k.d;
    let x = k.qx + nx * (k.hw + 8), z = k.qz + nz * (k.hw + 8);
    for (let i = 0; i < 10 && (city.onRoad(x, z, 3) || boxAt(city, x, z, 2)); i++) { x += k.ex * 8; z += k.ez * 8; }
    if (!city.onRoad(x, z, 2)) pylon(kit, ctx, x, z, Math.atan2(k.ex, k.ez), 'CF FAIRVIEW PARK', '2960 KINGSWAY DR',
      [['Walmart', '#0071ce', '#ffffff'], ['WINNERS', '#000000', '#ffffff'], ['SPORT CHEK', '#e31837', '#ffffff'], ["Mark's", '#c8102e', '#ffffff'], ['H&M', '#ffffff', '#e50010'], ['HOLLISTER', '#0f2847', '#ffffff']], '#1d2b3e');
  }
  STATS.fair = { edges: E.length, used: used.size };
}
/**
 * A tall glazed entrance: a gable of glass standing out of the wall, steel
 * frame, a pitched glass roof, the mall's name across its face.
 */
function atriumEntrance(kit, ctx, e, t, w, top, name) {
  const B = kit.B(e.mx, e.mz), gy = T(e.mx + e.nx * 3, e.mz + e.nz * 3), d = 5, N = [e.nx, 0, e.nz];
  const GL = lin([0.24, 0.34, 0.40]), FR = lin([0.86, 0.87, 0.88]), ey = top - 3.2;
  B4(B, e, t - w / 2, t + w / 2, gy - 0.2, ey, d, N, [GL, GL, shade(GL, 1.5), shade(GL, 1.5)]);
  B.tri(e.at(t - w / 2, ey, d), e.at(t + w / 2, ey, d), e.at(t, top, d), N, shade(GL, 1.5));
  for (const s of [-1, 1]) B.quad(e.at(t + s * w / 2, gy - 0.2, 0), e.at(t + s * w / 2, gy - 0.2, d), e.at(t + s * w / 2, ey, d), e.at(t + s * w / 2, ey, 0), [e.ux * s, 0, e.uz * s], U0, GL);
  for (const s of [-1, 1]) B.quad(e.at(t + s * (w / 2 + 0.3), ey - 0.1, d + 0.4), e.at(t + s * (w / 2 + 0.3), ey - 0.1, -0.5), e.at(t, top + 0.1, -0.5), e.at(t, top + 0.1, d + 0.4), [e.ux * s * 0.6, 0.8, e.uz * s * 0.6], U0, FR);
  for (let k = 0; k <= 6; k++) {
    const tt = t - w / 2 + w * k / 6, yy = ey + (top - ey) * (1 - Math.abs(k - 3) / 3);
    B4(B, e, tt - 0.1, tt + 0.1, gy - 0.2, yy, d + 0.04, N, FR);
  }
  for (const yy of [gy + 3.2, gy + 6.4]) B4(B, e, t - w / 2, t + w / 2, yy, yy + 0.16, d + 0.04, N, FR);
  // the doors' canopy
  B.quad(e.at(t - w / 2 - 1, gy + 3.0, d + 2.4), e.at(t + w / 2 + 1, gy + 3.0, d + 2.4), e.at(t + w / 2 + 1, gy + 3.0, d), e.at(t - w / 2 - 1, gy + 3.0, d), [0, -1, 0], U0, shade(FR, 0.7));
  B.quad(e.at(t - w / 2 - 1, gy + 3.35, d + 2.4), e.at(t + w / 2 + 1, gy + 3.35, d + 2.4), e.at(t + w / 2 + 1, gy + 3.35, d), e.at(t - w / 2 - 1, gy + 3.35, d), [0, 1, 0], U0, FR);
  B4(B, e, t - w / 2 - 1, t + w / 2 + 1, gy + 3.0, gy + 3.35, d + 2.4, N, FR);
  const c = e.at(t, 0, d / 2);
  ctx.solids.push({ x: c[0], z: c[2], hw: w / 2, hd: d / 2, rot: Math.atan2(e.uz, e.ux), y0: gy - 1, y1: top });
  if (name) onWall(kit, e, t, gy + 4.6, name, d + 0.08);
}
/**
 * A store's front on edge e at t: 'parapet' raises the wall over the sign
 * (Fairview's anchors); 'tower' stands an entrance tower with a hipped
 * metal roof out of the wall, the sign on its face (the Boardwalk).
 */
function storeFront(kit, ctx, e, t, yTop, name, w, wallc, style, opts = {}) {
  const B = kit.B(e.mx, e.mz), gy = T(e.mx + e.nx * 3, e.mz + e.nz * 3), N = [e.nx, 0, e.nz];
  const h = Math.max(1.2, Math.min(2.4, w * 0.19));
  if (style === 'tower') {
    const tw = Math.max(w + 2.5, 7), d = 2.2, top = yTop + h + 2.6;
    const TW = opts.towerc || shade(wallc, 0.9), ST = lin([0.50, 0.45, 0.38]);
    // the tower's front and sides, its stone base, a cornice, the roof
    B4(B, e, t - tw / 2, t + tw / 2, gy - 0.4, top, d, N, TW);
    for (const s of [-1, 1]) B.quad(e.at(t + s * tw / 2, gy - 0.4, 0), e.at(t + s * tw / 2, gy - 0.4, d), e.at(t + s * tw / 2, top, d), e.at(t + s * tw / 2, top, 0), [e.ux * s, 0, e.uz * s], U0, shade(TW, 0.85));
    B4(B, e, t - tw / 2, t + tw / 2, gy - 0.4, gy + 1.6, d + 0.06, N, ST);
    B4(B, e, t - tw / 2 - 0.2, t + tw / 2 + 0.2, top - 0.5, top, d + 0.25, N, lin([0.90, 0.88, 0.82]));
    const o = (() => { const p = e.at(t, 0, d / 2 - 0.5); return { x: p[0], z: p[2], hu: tw / 2, hv: d / 2 + 0.5, ux: e.ux, uz: e.uz }; })();
    hipRoof(B, o, top, Math.min(3.2, tw * 0.3), opts.roofc || lin([0.20, 0.30, 0.26]), 0.5);
    // the door: glass in a dark frame, an awning
    const dw = Math.min(tw - 2, 5);
    B4(B, e, t - dw / 2, t + dw / 2, gy - 0.2, gy + 3.2, d + 0.08, N, lin([0.18, 0.24, 0.30]));
    B4(B, e, t - dw / 2 - 0.2, t + dw / 2 + 0.2, gy + 3.2, gy + 3.5, d + 0.1, N, lin([0.15, 0.15, 0.15]));
    if (name) onWall(kit, e, t, (gy + 3.5 + top - 0.5) / 2 + 0.3, brandPanel(ctx.atlas, name, Math.min(w, tw - 1), h), d + 0.1);
    const c = e.at(t, 0, d / 2);
    ctx.solids.push({ x: c[0], z: c[2], hw: tw / 2, hd: d / 2, rot: Math.atan2(e.uz, e.ux), y0: gy - 1, y1: top });
    return;
  }
  parapetSign(kit, ctx, e, t, yTop, name, w, wallc);
  // a glass storefront and a canopy under the sign
  const gw = Math.min(w + 1, e.L - 1);
  B4(B, e, t - gw / 2, t + gw / 2, gy - 0.2, gy + 3.4, 0.65, N, lin([0.18, 0.24, 0.30]));
  B.quad(e.at(t - gw / 2 - 0.6, gy + 3.6, 2.6), e.at(t + gw / 2 + 0.6, gy + 3.6, 2.6), e.at(t + gw / 2 + 0.6, gy + 3.6, 0.6), e.at(t - gw / 2 - 0.6, gy + 3.6, 0.6), [0, -1, 0], U0, lin([0.30, 0.30, 0.30]));
  B4(B, e, t - gw / 2 - 0.6, t + gw / 2 + 0.6, gy + 3.6, gy + 4.1, 2.6, N, lin([0.22, 0.22, 0.24]));
  B.quad(e.at(t - gw / 2 - 0.6, gy + 4.1, 2.6), e.at(t + gw / 2 + 0.6, gy + 4.1, 2.6), e.at(t + gw / 2 + 0.6, gy + 4.1, 0.6), e.at(t - gw / 2 - 0.6, gy + 4.1, 0.6), [0, 1, 0], U0, lin([0.30, 0.30, 0.30]));
}

/** A two-faced pylon sign by a road: the name on top, tenants below. */
function pylon(kit, ctx, x, z, yaw, title, sub, rows, bg) {
  const L = ctx.atlas, y = T(x, z), PB = kit.B(x, z), pg = kit.grp(x, z);
  PB.box(x, y - 0.5, z, 3.8, 11.5, 0.9, -yaw + Math.PI / 2, hexc(bg));
  PB.box(x, y - 0.5, z, 4.4, 1.4, 1.3, -yaw + Math.PI / 2, lin([0.55, 0.51, 0.46]));
  const top = L.panel(3.5, 1.4, 50, (q, W, H) => {
    q.fillStyle = bg; q.fillRect(0, 0, W, H);
    q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `800 ${H * 0.3}px ${SANS}`; q.fillText(title, W / 2, H * 0.42, W * 0.94);
    q.font = `600 ${H * 0.15}px ${SANS}`; q.fillText(sub, W / 2, H * 0.78, W * 0.94);
  });
  const ten = L.panel(3.5, 5.6, 40, (q, W, H) => {
    const rh = H / rows.length;
    rows.forEach(([t, b, c], i) => {
      q.fillStyle = b; q.fillRect(0, i * rh + 1, W, rh - 2);
      q.fillStyle = c; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `800 ${rh * 0.5}px ${SANS}`; q.fillText(t, W / 2, i * rh + rh * 0.55, W * 0.9);
    });
  });
  for (const s of [1, -1]) {
    const fx = Math.sin(yaw + Math.PI / 2) * s, fz = Math.cos(yaw + Math.PI / 2) * s;
    hang(pg, top.clone(), x, y + 9.6, z, fx, fz, 0.47);
    hang(pg, ten.clone(), x, y + 5.6, z, fx, fz, 0.47);
  }
  ctx.solids.push({ x, z, hw: 2.2, hd: 0.65, rot: -yaw + Math.PI / 2, y0: y - 1, y1: y + 11 });
}

// THE BOARDWALK (Ira Needles Blvd, 2006-): a power centre dressed as a
// village -- two-tone stucco over a stone-faced base, each store's door in an
// entrance tower under a hipped green or brown metal roof, white membrane
// roofs behind; red-paved roundabouts and a fountain court with a pergola.
const STUCCO = [[0.84, 0.76, 0.62], [0.74, 0.62, 0.48], [0.86, 0.80, 0.70], [0.66, 0.54, 0.42]];
const BW_ROOFS = [[0.20, 0.30, 0.26], [0.36, 0.22, 0.16], [0.24, 0.26, 0.30]];
const BW_FOUNTAIN = [-7033, 1763];
const BW_LOTS = [-6920, 1900];    // the middle of the parking the stores face
function boardwalk(kit, ctx) {
  const city = ctx.city;
  for (const [i, st] of S.boardwalk.entries()) {
    const big = Math.abs(polyArea(st.p)) > 4000;
    const wall = lin(STUCCO[i % STUCCO.length]), upper = lin(STUCCO[(i + 1) % STUCCO.length]);
    const isWal = /Walmart/.test(st.n);
    const r = block(kit, ctx, simplify(st.p, 0.6), {
      h: big ? 9.5 : 7, wall, trim: lin([0.92, 0.90, 0.84]), cornice: 0.7, parapet: 0.9, roof: lin([0.84, 0.84, 0.82]),
      plinth: [1.4, lin([0.50, 0.45, 0.38])],
    });
    // the upper band in the second tone, and a dark reveal between
    for (const e of r.E) {
      if (e.L < 4) continue;
      const N = [e.nx, 0, e.nz];
      B4(r.B, e, 0, e.L, r.yTop - 2.6, r.yTop - 0.7, 0.03, N, isWal ? lin([0.00, 0.33, 0.64]) : upper);
      B4(r.B, e, 0, e.L, r.yTop - 2.75, r.yTop - 2.6, 0.04, N, lin([0.30, 0.26, 0.22]));
    }
    // the front: the long face with the parking lot before it
    // (the side toward the lots in the middle: every store here faces in)
    let f = null, fs = -Infinity;
    for (const e of r.E) {
      if (e.L < 8) continue;
      const dx = BW_LOTS[0] - e.mx, dz = BW_LOTS[1] - e.mz, dl = Math.hypot(dx, dz) || 1;
      const sc = e.L * Math.max(0.05, (dx * e.nx + dz * e.nz) / dl);
      if (sc > fs) { fs = sc; f = e; }
    }
    if (!f) continue;
    // (a strip OSM names no tenant in still gets its towers, unsigned)
    const names = st.n && !/Columbia Lake/.test(st.n) ? [st.n] : st.s.length ? st.s.slice(0, Math.max(1, Math.floor(f.L / 16))) : new Array(Math.max(1, Math.floor(f.L / 28))).fill(null);
    // every face turned the same way as the front shares the stores, in order along the strip
    const fronts = r.E.filter((e) => e.L >= 8 && e.nx * f.nx + e.nz * f.nz > 0.8);
    const total = fronts.reduce((a, e) => a + e.L, 0);
    const n = names.length, bay = total / n;
    const at = (p) => { for (const e of fronts) { if (p <= e.L) return [e, p]; p -= e.L; } const e = fronts[fronts.length - 1]; return [e, e.L / 2]; };
    const roofc = lin(BW_ROOFS[i % BW_ROOFS.length]);
    names.forEach((nm, k) => {
      const [fe, t0] = at(bay * (k + 0.5));
      const w = Math.min(bay - 3, n === 1 ? Math.min(isWal ? 16 : 12, f.L * 0.4) : 6.5, fe.L - 4);
      const t = Math.max(w / 2 + 2, Math.min(fe.L - w / 2 - 2, t0));
      if (w < 2.5) return;
      if (isWal) {
        onWall(kit, fe, t, r.yTop - 1.6, brandPanel(ctx.atlas, 'Walmart', w, w * 0.2), 0.1);
        for (const s of [-1, 1]) entrance(kit, ctx, fe, t + s * Math.min(24, fe.L / 2 - 6), 9, 4.2, null, { can: lin([0.00, 0.33, 0.64]), d: 4.5 });
        return;
      }
      storeFront(kit, ctx, fe, t, r.yTop, nm, w, wall, 'tower', { roofc: k % 2 ? lin(BW_ROOFS[(i + 1) % BW_ROOFS.length]) : roofc, towerc: shade(k % 2 ? wall : upper, 0.95) });
      // shop windows either side of the tower
      const gy = T(fe.mx + fe.nx * 2, fe.mz + fe.nz * 2), gw = Math.min(bay / 2 - w / 2 - 2, 7);
      if (gw > 1.5) for (const sd of [-1, 1]) {
        const c = t + sd * (w / 2 + 2.5 + gw / 2);
        if (c - gw / 2 > 0.5 && c + gw / 2 < fe.L - 0.5) B4(r.B, fe, c - gw / 2, c + gw / 2, gy + 0.4, gy + 3.0, 0.05, [fe.nx, 0, fe.nz], lin([0.18, 0.24, 0.30]));
      }
    });
    // stone pilasters down every face, a bay apart
    for (const e of r.E) {
      if (e.L < 10) continue;
      const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
      for (let t = 5; t < e.L - 3; t += 10) B4(r.B, e, t - 0.4, t + 0.4, gy - 0.3, r.yTop - 2.75, 0.1, [e.nx, 0, e.nz], lin([0.56, 0.50, 0.42]));
    }
    // a timber pergola walk along the long strips' fronts
    if (n > 2) {
      const gy = T(f.mx + f.nx * 3, f.mz + f.nz * 3), TB = lin([0.42, 0.28, 0.18]);
      for (let t = 2; t < f.L - 2; t += 3.2) {
        const p = f.at(t, gy - 0.2, 3.2);
        r.B.box(p[0], p[1], p[2], 0.3, 3.6, 0.3, Math.atan2(f.uz, f.ux), TB);
        const q = f.at(t, gy + 3.4, 1.6);
        r.B.box(q[0], q[1], q[2], 0.18, 0.25, 3.6, Math.atan2(f.uz, f.ux), TB);
        ctx.solids.push({ x: p[0], z: p[2], r: 0.2, y0: gy - 1, y1: gy + 3.6 });
      }
      const a = f.at(0, gy + 3.65, 3.2), b = f.at(f.L, gy + 3.65, 3.2);
      r.B.tube(a, b, 0.14, 4, TB);
    }
  }
  // the fountain court
  {
    const [x, z] = BW_FOUNTAIN;
    if (!city.onRoad(x, z, 6)) {
      const y = walkY(city, x, z), B = kit.B(x, z), STN = lin([0.62, 0.58, 0.52]);
      B.prism(x, y - 0.3, z, 6, 0.85, 20, STN);
      B.prism(x, y - 0.3, z, 5.6, 0.8, 20, lin([0.20, 0.45, 0.55]));
      B.cone(x, y + 0.5, z, 5.58, 0.01, 20, lin([0.22, 0.48, 0.58]));
      B.prism(x, y + 0.5, z, 1.2, 0.6, 10, STN);
      B.cone(x, y + 1.1, z, 0.5, 2.6, 6, lin([0.92, 0.95, 0.97]));
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; B.cone(x + Math.cos(a) * 3.6, y + 0.5, z + Math.sin(a) * 3.6, 0.12, 1.4, 4, lin([0.92, 0.95, 0.97])); }
      ctx.solids.push({ x, z, r: 6, y0: y - 1, y1: y + 0.6 });
      const D = kit.B(x, z), n = 20;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        D.tri([x, y + 0.12, z], [x + Math.cos(a0) * 14, y + 0.12, z + Math.sin(a0) * 14], [x + Math.cos(a1) * 14, y + 0.12, z + Math.sin(a1) * 14], [0, 1, 0], lin([0.58, 0.34, 0.27]));
      }
      if (ctx.clearAt) ctx.clearAt.push([x, z, 9]);
    }
  }
}

// --- Bingemans ----------------------------------------------------------------------------

const SPLASH = [2005, -2345];   // Bingemans Big Splash (OSM leisure=water_park)
function bingemans(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const r = block(kit, ctx, S.b.bing.p, {
    h: 8.5, wall: lin([0.78, 0.70, 0.58]), trim: lin([0.30, 0.22, 0.16]), cornice: 1.0, plinth: [1.2, lin([0.52, 0.44, 0.36])],
    win: { style: 'punch', sp: 4, w: 2.4, h: 2.4, fl: 5, g0: 1.0 },
  });
  const f = frontEdge(city, r.E, null, 12, 220);
  if (f) {
    onWall(kit, f, f.L / 2, r.yTop - 1.4, text(L, Math.min(14, f.L - 2), 2.0, 'BINGEMANS', { bg: '#1a3a8a', fg: '#ffd23a', wt: '900', k: 0.6, sub: 'MARSHALL HALL · CONFERENCE CENTRE', subk: 0.17 }), 0.1);
  }
  // BIG SPLASH: the wave pool up top, a tower, and the slides down to the run-out pools
  const [x, z] = SPLASH;
  let ok = true;
  for (const [dx, dz] of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20]]) if (city.onRoad(x + dx, z + dz, 4) || (boxAt(city, x + dx, z + dz, 3) && boxAt(city, x + dx, z + dz, 3).h > 0.5)) ok = false;
  STATS.splashOk = ok;
  const B = kit.B(x, z), y = T(x, z);
  const DECK = lin([0.86, 0.84, 0.78]), POOL = lin([0.18, 0.62, 0.78]);
  // the wave pool: a fan-shaped deck and water
  const px = x - 26, pz = z + 4, py = T(px, pz);
  B.box(px, py - 0.6, pz, 30, 0.9, 22, 0.35, DECK);
  B.box(px, py - 0.55, pz, 26, 0.9, 18, 0.35, POOL);
  // the tower
  const tx = x + 6, tz = z - 6, ty = T(tx, tz), TH = 13;
  // downhill from the tower: the way the ground falls over 40 m
  let DOWN = 0, dmin = Infinity;
  for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, h = T(tx + Math.cos(a) * 40, tz + Math.sin(a) * 40); if (h < dmin && !city.onRoad(tx + Math.cos(a) * 40, tz + Math.sin(a) * 40, 4)) { dmin = h; DOWN = a; } }
  for (const [a, b] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) B.box(tx + a, ty - 0.5, tz + b, 0.4, TH + 0.5, 0.4, 0, lin([0.85, 0.85, 0.85]));
  B.box(tx, ty + TH, tz, 5.4, 0.4, 5.4, 0, lin([0.85, 0.85, 0.85]));
  B.box(tx, ty + TH + 2.8, tz, 6, 0.3, 6, 0, lin([0.12, 0.45, 0.70]));
  ctx.solids.push({ x: tx, z: tz, hw: 2.4, hd: 2.4, rot: 0, y0: ty - 1, y1: ty + TH + 3 });
  // four slides: green, green, blue, yellow (Typhoon Twister, 2026), plus the old red and orange
  const COLS = [[0.20, 0.70, 0.25], [0.12, 0.55, 0.20], [0.10, 0.40, 0.85], [0.98, 0.80, 0.10], [0.85, 0.15, 0.12], [0.95, 0.50, 0.10]];
  COLS.forEach((c, i) => {
    // they fan out down the hill, each snaking its own way (a tight helix for the blue bowl slide)
    const a0 = DOWN + (i / (COLS.length - 1) - 0.5) * 2.4;
    let prev = null;
    const N = 30, len = 34 + (i % 3) * 9, wig = i === 2 ? 0 : 0.35 + 0.15 * (i % 2);
    for (let k = 0; k <= N; k++) {
      const s = k / N, a = a0 + wig * Math.sin(s * Math.PI * (2 + i % 2) + i), rr = 3 + len * s;
      const qx = tx + Math.cos(a) * rr, qz = tz + Math.sin(a) * rr;
      const qy = Math.max(T(qx, qz) + 1.2, ty + TH - (TH - 0.8) * s);
      const p = [qx, qy, qz];
      if (prev) B.tube(prev, p, 0.62, 8, lin(c));
      if (k % 4 === 2 && qy - T(qx, qz) > 1.6) B.prism(qx, T(qx, qz) - 0.4, qz, 0.14, qy - T(qx, qz) - 0.2, 5, lin([0.80, 0.80, 0.80]));
      prev = p;
    }
    // the run-out pool at the bottom
    B.box(prev[0], T(prev[0], prev[2]) - 0.5, prev[2], 4, 0.8, 7, a0, POOL);
  });
  if (ctx.clearAt) { ctx.clearAt.push([x, z, 36]); ctx.clearAt.push([px, pz, 20]); ctx.clearAt.push([tx + Math.cos(DOWN) * 35, tz + Math.sin(DOWN) * 35, 30]); }
  const sx = x + 22, sz = z + 18;
  if (!city.onRoad(sx, sz, 2)) {
    const sy = T(sx, sz);
    kit.B(sx, sz).box(sx, sy - 0.4, sz, 0.3, 4.2, 0.3, 0, lin([0.3, 0.3, 0.3]));
    const m = text(L, 4.5, 1.6, 'BIG SPLASH', { bg: '#0a7fc2', fg: '#ffffff', wt: '900', k: 0.55, sub: 'BINGEMANS WATERPARK', subk: 0.2 });
    for (const s of [1, -1]) hang(kit.grp(sx, sz), m.clone(), sx, sy + 4.4, sz, 0.6 * s, 0.8 * s, 0.17);
  }
}

// --- the museum, the village, Homer Watson ----------------------------------------------------------

function museum(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const r = block(kit, ctx, S.b.museum.p, { h: 9.5, wall: lin([0.50, 0.50, 0.49]), trim: lin([0.30, 0.30, 0.30]), parapet: 0.6, roof: lin([0.86, 0.86, 0.84]) });
  // the Colour Wall: sixteen colours in a quilt (the Laurier quotation in hex) round the curved face to Homer Watson Blvd
  const Q = ['#c8102e', '#e8542a', '#f2a900', '#ffd23a', '#8cc63f', '#2e9e4f', '#00796b', '#00a3e0', '#1e5aa8', '#3f2a8c', '#7b2d8e', '#c2185b', '#8b4513', '#d4b483', '#f4f1e8', '#4a4a4a'].map(hexc);
  let best = null, nq = 0;
  for (const e of r.E) {
    if (e.L < 3) continue;
    const s2 = street(city, e.mx + e.nx * 2, e.mz + e.nz * 2, 120, /^Homer Watson/);
    if (!s2) continue;
    const tx = s2.qx - e.mx, tz = s2.qz - e.mz, tl = Math.hypot(tx, tz) || 1;
    if ((tx * e.nx + tz * e.nz) / tl < 0.3) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2), cw = 1.5, ch = 1.25, N = [e.nx, 0, e.nz];
    const nc = Math.max(1, Math.floor((e.L - 0.4) / cw)), w = (e.L - 0.4) / nc, nr = Math.floor((r.yTop - gy - 0.6) / ch);
    for (let i = 0; i < nc; i++) for (let j = 0; j < nr; j++) {
      const c = Q[Math.floor(hash2(Math.round(e.mx) + i * 7, j * 13 + 5) * 16)];
      const t0 = 0.2 + i * w, y0 = gy + 0.2 + j * ch;
      B4(r.B, e, t0 + 0.04, t0 + w - 0.04, y0 + 0.04, y0 + ch - 0.04, 0.06, N, c);
    }
    nq++;
    if (!best || e.L > best.L) best = e;
  }
  STATS.colourWall = nq;
  const f = best;
  if (f) {
    const N = [f.nx, 0, f.nz];
    onWall(kit, f, f.L * 0.5, r.yTop + 1.2, text(L, Math.min(18, f.L - 1), 1.4, 'WATERLOO REGION MUSEUM', { bg: '#2b2b2b', fg: '#ffffff', wt: '800', k: 0.6 }), 0.1);
    r.B.quad(f.at(f.L * 0.5 - 9.5, r.yTop + 0.3, 0.05), f.at(f.L * 0.5 + 9.5, r.yTop + 0.3, 0.05), f.at(f.L * 0.5 + 9.5, r.yTop + 2.1, 0.05), f.at(f.L * 0.5 - 9.5, r.yTop + 2.1, 0.05), N, U0, lin([0.17, 0.17, 0.17]));
  }
  // DOON HERITAGE VILLAGE, 1914: frame houses in white clapboard, brick, red barns
  for (const [i, b] of S.doon.entries()) {
    const p = ccw(b.p), o = obb(p);
    if (!o) continue;
    const A = Math.abs(polyArea(p)), barn = A > 250;
    const y = T(o.x, o.z), B = kit.B(o.x, o.z);
    const wall = barn ? lin([0.55, 0.18, 0.14]) : hash2(i, 3) < 0.6 ? lin([0.93, 0.91, 0.85]) : hash2(i, 4) < 0.5 ? lin([0.62, 0.30, 0.22]) : lin([0.80, 0.70, 0.52]);
    const eave = barn ? 5.5 : A > 90 ? 5.6 : 3.4, ridge = eave + Math.min(o.hv, 6) * (barn ? 1.0 : 0.8);
    const P = gabled(B, o, y - 1, y + eave, y + ridge, wall, barn ? lin([0.35, 0.36, 0.37]) : lin([0.32, 0.30, 0.28]), { overhang: 0.35 });
    // a door and windows on the long sides
    const vx = -o.uz, vz = o.ux;
    for (const s of [-1, 1]) {
      const N = [vx * s, 0, vz * s];
      const nwin = Math.max(1, Math.floor(o.hu * 2 / 2.6));
      for (let k = 0; k < nwin; k++) {
        const u = -o.hu + (k + 0.5) * (2 * o.hu / nwin), c = P(u, s * (o.hv + 0.03), 0);
        const door = k === Math.floor(nwin / 2) && s === 1;
        const y0 = door ? y : y + 0.9, y1 = door ? y + 2.2 : y + 2.3;
        B.quad([c[0] - o.ux * 0.45, y0, c[2] - o.uz * 0.45], [c[0] + o.ux * 0.45, y0, c[2] + o.uz * 0.45], [c[0] + o.ux * 0.45, y1, c[2] + o.uz * 0.45], [c[0] - o.ux * 0.45, y1, c[2] - o.uz * 0.45], N, U0, door ? lin([0.30, 0.20, 0.14]) : lin([0.12, 0.14, 0.16]));
      }
    }
    for (const sd of [-1, 1]) {
      const c = P(0, sd * o.hv, 0), d = P(sd * o.hu, 0, 0);
      ctx.solids.push({ x: c[0], z: c[2], hw: o.hu, hd: 0.3, rot: Math.atan2(o.uz, o.ux), y0: y - 1, y1: y + eave });
      ctx.solids.push({ x: d[0], z: d[2], hw: 0.3, hd: o.hv, rot: Math.atan2(o.uz, o.ux), y0: y - 1, y1: y + eave });
    }
  }
  // HOMER WATSON HOUSE (1834): buff brick, a steep roof and a front gable
  {
    const p = ccw(S.b.homer.p), o0 = obb(p), o = { ...o0, hu: Math.min(o0.hu, 9), hv: Math.min(o0.hv, 5.5) };
    const y = T(o.x, o.z), B = kit.B(o.x, o.z);
    const BR = lin([0.78, 0.64, 0.46]), RF = lin([0.28, 0.27, 0.26]);
    const P = gabled(B, o, y - 1, y + 4.6, y + 10.2, BR, RF, { overhang: 0.4 });
    const q = street(city, o.x, o.z, 120);
    const vx = -o.uz, vz = o.ux, s = q ? Math.sign((q.qx - o.x) * vx + (q.qz - o.z) * vz) || 1 : 1;
    // the front gable
    const g0 = P(-2.2, s * (o.hv + 0.05), y + 4.6), g1 = P(2.2, s * (o.hv + 0.05), y + 4.6), g2 = P(0, s * (o.hv + 0.05), y + 8.6);
    B.tri(g0, g1, g2, [vx * s, 0, vz * s], BR);
    const r0 = P(-2.6, s * (o.hv + 0.4), y + 4.3), r1 = P(0, s * (o.hv + 0.4), y + 8.9), b0 = P(-2.6, 0, y + 4.3), b1 = P(0, 0, y + 8.9), r2 = P(2.6, s * (o.hv + 0.4), y + 4.3), b2 = P(2.6, 0, y + 4.3);
    B.quad(r0, r1, b1, b0, [-o.ux * 0.6, 0.8, -o.uz * 0.6], U0, RF);
    B.quad(r2, r1, b1, b2, [o.ux * 0.6, 0.8, o.uz * 0.6], U0, RF);
    for (const u of [-5, -2.2, 2.2, 5]) { const c = P(u, s * (o.hv + 0.06), 0); B.quad([c[0] - o.ux * 0.45, y + 1, c[2] - o.uz * 0.45], [c[0] + o.ux * 0.45, y + 1, c[2] + o.uz * 0.45], [c[0] + o.ux * 0.45, y + 3, c[2] + o.uz * 0.45], [c[0] - o.ux * 0.45, y + 3, c[2] - o.uz * 0.45], [vx * s, 0, vz * s], U0, lin([0.12, 0.14, 0.16])); }
    for (const sd of [-1, 1]) ctx.solids.push({ x: P(0, sd * o.hv, 0)[0], z: P(0, sd * o.hv, 0)[2], hw: o.hu, hd: 0.3, rot: Math.atan2(o.uz, o.ux), y0: y - 1, y1: y + 4.6 });
    for (const sd of [-1, 1]) ctx.solids.push({ x: P(sd * o.hu, 0, 0)[0], z: P(sd * o.hu, 0, 0)[2], hw: 0.3, hd: o.hv, rot: Math.atan2(o.uz, o.ux), y0: y - 1, y1: y + 4.6 });
    if (q) {
      const nx = (o.x - q.qx) / q.d, nz = (o.z - q.qz) / q.d, sx = q.qx + nx * (q.hw + 4), sz = q.qz + nz * (q.hw + 4);
      if (!city.onRoad(sx, sz, 1.5)) {
        const sy = T(sx, sz);
        kit.B(sx, sz).box(sx, sy - 0.3, sz, 2.8, 0.6, 0.3, Math.atan2(nx, -nz), lin([0.40, 0.36, 0.30]));
        const m = text(L, 2.6, 1.0, 'HOMER WATSON', { bg: '#1f3a2c', fg: '#f2ead2', font: SERIF, wt: '700', k: 0.36, sub: 'HOUSE & GALLERY', subk: 0.22 });
        for (const sd of [1, -1]) hang(kit.grp(sx, sz), m.clone(), sx, sy + 0.85, sz, -nx * sd, -nz * sd, 0.17);
      }
    }
  }
}
/** A wall rectangle between t0..t1, y0..y1 on edge e, `off` out. */
function B4(B, e, t0, t1, y0, y1, off, N, c) {
  B.quad(e.at(t0, y0, off), e.at(t1, y0, off), e.at(t1, y1, off), e.at(t0, y1, off), N, U0, c);
}

// --- Toyota ------------------------------------------------------------------------------------

function toyota(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const pts = simplify(S.b.toyota.p, 1.5);
  const WH = lin([0.88, 0.89, 0.90]);
  const r = block(kit, ctx, pts, { h: 17, wall: WH, trim: lin([0.62, 0.64, 0.66]), parapet: 0.8, plinth: [2.2, lin([0.56, 0.58, 0.60])] });
  // panel joints
  for (const e of r.E) {
    if (e.L < 20) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2), N = [e.nx, 0, e.nz];
    for (let t = 12; t < e.L - 4; t += 12) B4(r.B, e, t - 0.1, t + 0.1, gy + 2.2, r.yTop, 0.04, N, lin([0.70, 0.72, 0.74]));
    B4(r.B, e, 0, e.L, r.yTop - 3.2, r.yTop - 2.8, 0.05, N, lin([0.66, 0.68, 0.70]));
  }
  // rooftop plant and stacks
  const o = obb(r.pts);
  for (let i = 0; i < 40; i++) {
    const u = (hash2(i, 71) - 0.5) * o.hu * 1.8, v = (hash2(i, 72) - 0.5) * o.hv * 1.8;
    const x = o.x + o.ux * u - o.uz * v, z = o.z + o.uz * u + o.ux * v;
    if (!inPoly(r.pts, x, z)) continue;
    if (i % 4 === 0) r.B.prism(x, r.yTop, z, 1.0, 9, 8, lin([0.75, 0.76, 0.78]));
    else r.B.box(x, r.yTop, z, 6 + hash2(i, 73) * 6, 2.4, 4, Math.atan2(o.uz, o.ux), lin([0.72, 0.73, 0.75]));
  }
  // TOYOTA on the faces toward Fountain St and the 401
  const logo = (w) => L.panel(w, w * 0.2, 12, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    // the three ellipses
    q.strokeStyle = '#eb0a1e'; q.lineWidth = H * 0.08;
    const cx = H * 0.75, cy = H / 2;
    q.beginPath(); q.ellipse(cx, cy, H * 0.62, H * 0.42, 0, 0, Math.PI * 2); q.stroke();
    q.beginPath(); q.ellipse(cx, cy - H * 0.06, H * 0.36, H * 0.2, 0, 0, Math.PI * 2); q.stroke();
    q.beginPath(); q.ellipse(cx, cy + H * 0.04, H * 0.13, H * 0.36, 0, 0, Math.PI * 2); q.stroke();
    q.fillStyle = '#eb0a1e'; q.textAlign = 'left'; q.textBaseline = 'middle';
    q.font = `800 ${H * 0.62}px ${SANS}`; q.fillText('TOYOTA', H * 1.55, H * 0.54, W - H * 1.6);
  });
  const sides = [];
  for (const re of [/^Fountain Street/, /401|Highway 401|Macdonald-Cartier/]) {
    const f = frontEdge(city, r.E, re, 40, 400);
    if (f && !sides.includes(f)) sides.push(f);
  }
  if (!sides.length) { const f = frontEdge(city, r.E, null, 40, 400); if (f) sides.push(f); }
  for (const f of sides) onWall(kit, f, f.L / 2, r.yTop - 5.5, logo(Math.min(40, f.L - 6)), 0.1);
  STATS.toyota = sides.map((f) => [Math.round(f.mx), Math.round(f.mz), Math.round(f.L)]);
  // the gate's monument sign (Fountain / Toyota Gate 1)
  const gx = 8070, gz = 3925;
  if (!city.onRoad(gx, gz, 2)) {
    const gy = T(gx, gz), B = kit.B(gx, gz);
    B.box(gx, gy - 0.4, gz, 7, 2.6, 0.9, 0.3, lin([0.92, 0.92, 0.92]));
    B.box(gx, gy - 0.4, gz, 7.4, 0.6, 1.2, 0.3, lin([0.50, 0.50, 0.52]));
    const m = text(L, 6.4, 1.6, 'TOYOTA', { bg: '#ffffff', fg: '#eb0a1e', wt: '800', k: 0.5, sub: 'TOYOTA MOTOR MANUFACTURING CANADA', subk: 0.13 });
    for (const s of [1, -1]) hang(kit.grp(gx, gz), m.clone(), gx, gy + 1.3, gz, Math.sin(-0.3 + Math.PI / 2) * s * 0 + -Math.sin(0.3) * s, Math.cos(0.3) * s, 0.47);
    ctx.solids.push({ x: gx, z: gz, hw: 3.6, hd: 0.6, rot: 0.3, y0: gy - 1, y1: gy + 2.4 });
  }
}

// --- Cambridge ---------------------------------------------------------------------------------

const GALT = lin([0.66, 0.62, 0.53]);
function cambridge(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  // THE CAMBRIDGE MILL: stone, five storeys to a pitched roof, the glass pavilion
  {
    const r = block(kit, ctx, S.b.cmill.p, {
      h: 15, wall: GALT, trim: shade(GALT, 0.8), parapet: 0.3,
      win: { style: 'punch', sp: 3.0, w: 1.3, h: 1.9, fl: 3.4, g0: 1.2, arch: shade(GALT, 0.85), sill: shade(GALT, 1.15) }, frame: lin([0.85, 0.85, 0.82]),
    });
    const o = obb(r.pts);
    const RF = lin([0.30, 0.31, 0.32]);
    const { ux, uz } = o, vx = -uz, vz = ux, P = (u, v, y) => [o.x + ux * u + vx * v, y, o.z + uz * u + vz * v];
    for (const s of [-1, 1]) {
      r.B.quad(P(-o.hu, s * o.hv, r.yTop), P(o.hu, s * o.hv, r.yTop), P(o.hu, 0, r.yTop + o.hv * 0.6), P(-o.hu, 0, r.yTop + o.hv * 0.6), [vx * s * 0.6, 0.8, vz * s * 0.6], U0, RF);
      r.B.tri(P(s * o.hu, -o.hv, r.yTop), P(s * o.hu, o.hv, r.yTop), P(s * o.hu, 0, r.yTop + o.hv * 0.6), [ux * s, 0, uz * s], GALT);
    }
    const pv = block(kit, ctx, S.b.cmillpav.p, { h: 5, wall: lin([0.28, 0.34, 0.38]), trim: lin([0.25, 0.25, 0.25]), parapet: 0.4, glass: lin([0.30, 0.40, 0.46]), win: { style: 'curtain', sp: 1.6, g0: 0.2, fl: 5, top: 0.4 } });
    void pv;
    const f = frontEdge(city, r.E, /^Water Street/, 8, 80) || frontEdge(city, r.E, null, 8, 120);
    if (f) onWall(kit, f, f.L / 2, r.yTop - 2.2, text(L, Math.min(9, f.L - 1.5), 1.3, 'CAMBRIDGE MILL', { bg: '#3a2a20', fg: '#f4e4c1', font: SERIF, wt: '700', k: 0.56 }), 0.1);
  }
  // THE OLD POST OFFICE (Thomas Fuller, 1885) -- IDEA EXCHANGE: stone, a mansard, the clock tower; the 2018 glass pavilion over the river
  {
    const r = block(kit, ctx, S.b.opo.p, {
      h: 10.5, wall: lin([0.70, 0.64, 0.53]), trim: lin([0.56, 0.50, 0.42]), parapet: 0, cornice: 0.7,
      win: { style: 'punch', sp: 2.8, w: 1.4, h: 2.4, fl: 4.4, g0: 1.4, arch: lin([0.56, 0.50, 0.42]), sill: lin([0.80, 0.74, 0.62]) }, frame: lin([0.20, 0.22, 0.20]),
    });
    // the mansard
    const SL = lin([0.29, 0.31, 0.34]);
    for (const e of r.E) {
      if (e.L < 0.8) continue;
      r.B.quad(e.at(0, r.yTop), e.at(e.L, r.yTop), e.at(e.L - 0.0, r.yTop + 3.4, -1.6), e.at(0, r.yTop + 3.4, -1.6), [e.nx * 0.85, 0.5, e.nz * 0.85], U0, SL);
    }
    roof(r.B, r.pts.map((q) => { const dx = r.cx - q[0], dz = r.cz - q[1], d = Math.hypot(dx, dz) || 1; return [q[0] + dx / d * 1.6, q[1] + dz / d * 1.6]; }), r.yTop + 3.4, SL);
    // the clock tower on the Water St / Main St corner
    let cv = r.pts[0];
    for (const q of r.pts) if (q[0] + -q[1] * 0.3 > cv[0] + -cv[1] * 0.3) cv = q;
    const tx = cv[0] + (r.cx - cv[0]) * 0.25, tz = cv[1] + (r.cz - cv[1]) * 0.25, TS = 4.6, base = r.base;
    const B = kit.B(tx, tz), rot = Math.atan2(0.0137, 1);
    B.box(tx, base - 1, tz, TS, 22, TS, rot, lin([0.70, 0.64, 0.53]));
    B.box(tx, base + 20.8, tz, TS + 0.5, 0.5, TS + 0.5, rot, lin([0.56, 0.50, 0.42]));
    pyramid(B, tx, base + 21.3, tz, TS / 2 + 0.3, 6.5, rot, COPPER);
    B.prism(tx, base + 27.6, tz, 0.08, 1.6, 5, lin([0.2, 0.2, 0.2]));
    const clock = clockFace(L, 2.6);
    for (const [a, b] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = a * Math.cos(rot) - b * Math.sin(rot), nz = a * Math.sin(rot) + b * Math.cos(rot);
      hang(kit.grp(tx, tz), clock.clone(), tx + nx * TS / 2, base + 18.2, tz + nz * TS / 2, nx, nz, 0.05);
    }
    ctx.solids.push({ x: tx, z: tz, hw: TS / 2, hd: TS / 2, rot, y0: base - 1, y1: base + 22 });
    // the glass pavilion on the river side (west), cantilevered over the river wall
    const wx = Math.min(...r.pts.map((q) => q[0])), z0 = Math.min(...r.pts.map((q) => q[1])) + 1, z1 = Math.max(...r.pts.map((q) => q[1])) - 1;
    const gx = wx - 4.5, gz = (z0 + z1) / 2, gy = r.base;
    const GB = kit.B(gx, gz), GL = lin([0.42, 0.55, 0.60]), FR = lin([0.85, 0.86, 0.86]);
    GB.box(gx, gy - 0.2, gz, 9, 6.2, z1 - z0, 0, GL);
    GB.box(gx, gy + 6, gz, 9.4, 0.5, z1 - z0 + 0.4, 0, FR);
    GB.box(gx, gy - 0.6, gz, 9.4, 0.5, z1 - z0 + 0.4, 0, FR);
    for (let z = z0; z <= z1 + 0.01; z += 1.8) GB.box(gx - 4.52, gy - 0.2, z, 0.08, 6.2, 0.08, 0, FR);
    ctx.solids.push({ x: gx, z: gz, hw: 4.5, hd: (z1 - z0) / 2, rot: 0, y0: gy - 1, y1: gy + 6.5 });
    const f = frontEdge(city, r.E, /^Water Street/, 6, 60);
    if (f) onWall(kit, f, f.L / 2, r.base + 3.6, text(L, Math.min(6, f.L - 1), 0.75, 'IDEA EXCHANGE', { bg: '#1d1d1d', fg: '#ffffff', wt: '800', k: 0.56 }), 0.1);
    STATS.opo = { tower: [Math.round(tx), Math.round(tz)], glass: [Math.round(gx), Math.round(gz)] };
  }
  // THE MAIN STREET BRIDGE (1931): two concrete bowstring arches each side of the deck
  {
    let deck = null;
    for (const ei of city.edgesNear(12868, 10338, 40)) {
      const e = city.edges[ei];
      if (e.name === 'Main Street' && e.len > 10 && (!deck || e.len > deck.len)) deck = e;
    }
    if (deck) {
      const xa = 12839, xb = 12897.8, za = 10337.5, zb = 10338.3;
      const ux = (xb - xa) / Math.hypot(xb - xa, zb - za), uz = (zb - za) / Math.hypot(xb - xa, zb - za), nx = -uz, nz = ux;
      const len = Math.hypot(xb - xa, zb - za), hw = deck.hw + 0.9;
      const CON = lin([0.74, 0.72, 0.67]);
      const dy = (t) => city.groundAt(xa + ux * t, za + uz * t, null);
      const B = kit.B((xa + xb) / 2, (za + zb) / 2);
      for (const side of [-1, 1]) {
        for (const [t0, t1] of [[0, len / 2 - 0.6], [len / 2 + 0.6, len]]) {
          const n = 12, rise = 6.2;
          let prev = null;
          for (let k = 0; k <= n; k++) {
            const s = k / n, t = t0 + (t1 - t0) * s;
            const x = xa + ux * t + nx * hw * side, z = za + uz * t + nz * hw * side;
            const y = dy(t) + 0.6 + rise * Math.sin(Math.PI * s);
            const p = [x, y, z];
            if (prev) B.tube(prev, p, 0.42, 6, CON);
            if (k > 0 && k < n) B.box(x, dy(t) + 0.6, z, 0.18, y - dy(t) - 0.6, 0.18, 0, CON);
            prev = p;
          }
        }
        // the parapet rail between the arches
        const p0 = [xa + nx * hw * side, dy(0) + 0.9, za + nz * hw * side], p1 = [xb + nx * hw * side, dy(len) + 0.9, zb + nz * hw * side];
        B.tube(p0, p1, 0.2, 4, CON);
      }
      // the pier in the river
      const px = xa + ux * len / 2, pz = za + uz * len / 2;
      B.box(px, T(px, pz) - 3, pz, 3, dy(len / 2) - T(px, pz) + 2.6, hw * 2 + 1, Math.atan2(uz, ux), shade(CON, 0.85));
      STATS.bridge = { hw: +hw.toFixed(1), y: +dy(len / 2).toFixed(1) };
    }
  }
  // THE FORBES TEXTILE MILL, Hespeler (1863-): long, stone and brick, three and four storeys
  {
    block(kit, ctx, S.b.forbes.p, {
      h: 14, wall: lin([0.60, 0.55, 0.47]), trim: lin([0.46, 0.42, 0.36]), cornice: 0.6,
      win: { style: 'punch', sp: 3.0, w: 1.4, h: 2.0, fl: 3.6, g0: 1.2, arch: lin([0.52, 0.26, 0.20]), sill: lin([0.76, 0.72, 0.64]) }, frame: lin([0.85, 0.85, 0.82]),
    });
  }
}

// --- the extra ---------------------------------------------------------------------------------

/** landmarks.js extra: every sight. */
export function buildSights(ctx) {
  if (!S) return;
  const t0 = performance.now();
  const kit = new Kit();
  const atlas = new PlaceAtlas(2048, 1536);
  kit.atlas = atlas;
  ctx = { ...ctx, atlas };
  const run = (name, fn) => {
    const s0 = ctx.solids.length, tr0 = kit.tris;
    try { fn(); } catch (e) { console.warn('kwsights ' + name + ': ' + (e.stack || e.message)); STATS.err = (STATS.err || []).concat(name + ': ' + e.message); }
    kit.flush(ctx);
    STATS[name] = { tris: kit.tris - tr0, solids: ctx.solids.length - s0, atlasY: atlas.y + atlas.row };
  };
  // the trees keep off what is drawn here
  const keep = (pts, pad) => { const o = obb(pts); if (o && ctx.clearAt) ctx.clearAt.push([o.x, o.z, Math.min(o.hu, o.hv) + pad]); };
  for (const k of Object.keys(S.b)) keep(S.b[k].p, 3);
  run('downtown', () => {
    cityHall(kit, ctx);
    market(kit, ctx);
    centreInTheSquare(kit, ctx);
    tannery(kit, ctx);
    breithaupt(kit, ctx);
    kaufman(kit, ctx);
  });
  run('mainstreets', () => S.king.forEach((r, i) => meshKing(kit, ctx, r, i)));
  run('vicpark', () => victoriaPark(kit, ctx));
  run('bauer', () => bauer(kit, ctx));
  run('aud', () => aud(kit, ctx));
  run('fairview', () => fairview(kit, ctx));
  run('boardwalk', () => boardwalk(kit, ctx));
  run('bingemans', () => bingemans(kit, ctx));
  run('museum', () => museum(kit, ctx));
  run('toyota', () => toyota(kit, ctx));
  run('cambridge', () => cambridge(kit, ctx));
  STATS.atlas = { y: atlas.y + atlas.row, full: atlas.full };
  atlas.finish();
  STATS.ms = Math.round(performance.now() - t0);
  if (typeof window !== 'undefined') window.__kwSights = STATS;
}
export function sightsStats() { return STATS; }

/** The map's marks and hellos. */
export function sightsMap() {
  if (!S) return [];
  const at = (k) => centroid(S.b[k].p);
  const m = (k, label, name, hello, extra = {}) => { const [x, z] = Array.isArray(k) ? k : at(k); return { x, z, kind: 'lm', label, name, near: false, hello, ...extra }; };
  return [
    m('cityhall', 'City Hall', 'Kitchener City Hall', 'Kitchener City Hall, 200 King St W — the rotunda, the Berlin Tower and Carl Zehr Square: a fountain in summer, a rink in winter'),
    m([-1150, 230], 'Downtown', 'Downtown Kitchener', 'Downtown Kitchener — King Street, the Market, City Hall, Victoria Park and the ION'),
    m('market', false, 'Kitchener Market', 'Kitchener Market, 300 King St E — farmers downstairs on Saturday mornings'),
    m('centre', false, 'Centre in the Square', 'Centre In The Square, 101 Queen St N — the KW Symphony\'s concert hall'),
    m('tannery', false, 'The Tannery', 'The Tannery, 151 Charles St W — the old Lang tannery, Communitech\'s hub; its stack is 55 m'),
    m('bb1', false, 'Breithaupt Block', 'The Breithaupt Block, 51 Breithaupt St — a 1903 rubber factory and its glass tower, Google\'s biggest office in Canada'),
    m('kaufman', false, 'Kaufman Lofts', 'Kaufman Lofts, 410 King St W — Albert Kahn\'s Kaufman Rubber factory, 1907-25'),
    m('bauer', false, 'Bauer Lofts', 'Bauer Lofts, 187 King St S, Waterloo — the 1917 Bauer factory and its 15-storey tower'),
    m([-1840, 560], 'Victoria Park', 'Victoria Park', 'Victoria Park (1896) — the lake and its islands, the 1924 pavilion, the boathouse, Queen Victoria, and the old City Hall\'s clock tower at the Gaukel St gate'),
    m(VP_CLOCK, false, 'Victoria Park clock tower', 'The clock tower of the 1924 City Hall, rebuilt at Victoria Park\'s Gaukel St gate'),
    m('schneider', false, 'Joseph Schneider Haus', 'Joseph Schneider Haus, 466 Queen St S — the 1816 Pennsylvania German homestead, Kitchener\'s oldest house'),
    m('aud', 'The Aud', 'Kitchener Memorial Auditorium', 'The Aud, 400 East Ave (1951) — the Kitchener Rangers\' barn'),
    m('fairview', 'Fairview', 'CF Fairview Park', 'CF Fairview Park, 2960 Kingsway Dr — Walmart, Winners, Sport Chek, Mark\'s; the Bay\'s box sits empty'),
    m([-6960, 2000], 'Boardwalk', 'The Boardwalk', 'The Boardwalk at Ira Needles — Walmart, Landmark Cinemas, Rona, Winners, The Brick and the rest'),
    m('bing', 'Bingemans', 'Bingemans', 'Bingemans, 425 Bingemans Centre Dr — Marshall Hall, and Big Splash\'s slides down the hill'),
    m('museum', 'Museum', 'Waterloo Region Museum', 'Ken Seiling Waterloo Region Museum, 10 Huron Rd — the colour wall, and Doon Heritage Village (1914) behind it'),
    m('homer', false, 'Homer Watson House', 'Homer Watson House & Gallery, 1754 Old Mill Rd — the painter\'s home in Doon'),
    m('toyota', 'Toyota', 'Toyota Motor Manufacturing Canada', 'TMMC, Cambridge — where the RAV4s come from'),
    m('cmill', false, 'Cambridge Mill', 'The Cambridge Mill — the 1842 Dickson stone mill on the Grand'),
    m('opo', 'Galt', 'Idea Exchange Old Post Office', 'Idea Exchange, Old Post Office (1885) — the clock tower, and the glass reading room hung over the Grand'),
    m([12880, 10338], false, 'Main Street Bridge', 'The Main Street Bridge (1931): two bowstring arches over the Grand'),
    m('forbes', false, 'Forbes Textile Mill', 'The Forbes mill, Hespeler — once Canada\'s biggest woollen mill'),
  ];
}
