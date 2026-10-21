// Auto KW: JACK COUCH PARK, home of the KITCHENER PANTHERS (Intercounty
// Baseball League), and a home run derby there.
//
// The park: 400 East Ave, part of the Kitchener Memorial Auditorium complex,
// across the car park from the Aud (opened 1967; ~1,400 seats in aluminium
// bleachers; a permanent building behind home plate with the concession,
// washrooms and press box -- Stadium Journey, kitchenerpanthers.com). OSM maps
// the field as leisure=pitch way 134225852 (named "Peter Couch Ball Park" there);
// read against Esri's aerial (tools/kw/aerial.py, Oct 2026): home plate at the
// field's north-west corner, the left field line running east to the pole at
// OSM's corner (928.7, 540.2), the right field line south to (845.4, 658.2),
// the outfield fence along OSM's east and south-east edges with the dirt
// warning track inside it, bleachers down the first-base line (between the
// line and the car park) and along the third-base line, the building behind
// home, light standards round the outfield and behind the dugouts. The
// scoreboard's place, the fence's colours and its panels are not read off
// anything: a black board and a green fence in the Panthers' black and gold.
//
// All of it is drawn in kwsights.js's run (addSights: its Kit and atlas, so
// it merges into the landmark clusters: no draws of its own), and the
// building's own box goes flat (prepBallpark).
//
// The derby (Derby): ENTER at the gate by the building. Twelve swings: the
// Panthers' batting-practice pitcher throws, you swing (SWING, Space, J, a
// tap anywhere) -- the TIMING is the swing: on time and the ball goes to
// centre at ~105 mph off the bat, early pulls it to left, late pushes it to
// right, too early or late is a foul or a miss; the pitch's height lifts or
// flattens it. Over the fence is a home run (its distance in feet); a take
// (no swing) costs nothing. $25 a home run, $100 more for five; best
// in localStorage `autokw-derby`. The batter is your own humanoid (arms by
// vehicles.js solveArm, as golf's), the pitcher one of the crowd's looks; both,
// the bat, the ball and the overlay are built on ENTER and freed on LEAVE.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { addSights } from './kwsights.js';
import { lin, shade, hang, edges, inPoly, U0, SANS } from './kwplaces.js';
import { boxAt } from './kw.js';
import { BONES, animateWalk, makeHumanoid } from './peds.js';
import { solveArm } from './vehicles.js';
import { setInterior } from './interior.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const T = (x, z) => G.terrainHeight(x, z);
const FT = 3.2808;

// --- the field, from OSM and the aerial ----------------------------------------------
const HOME = [830.5, 560.0];
const LF_OSM = [928.7, 540.2], RF_OSM = [845.4, 658.2];
const FENCE_MID = [[928.7, 622.7], [921.9, 633.2]];
const BUILDING = [[805.1, 553.0], [812.4, 542.1], [817.0, 545.2], [809.7, 556.1]];   // OSM 1020162215
const FENCE_H = 2.4;
const BASE = 27.43, MOUND = 18.44;

/** The field's frame: d toward centre field, p toward the right field side. */
const F = (() => {
  const nrm = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
  const a = nrm([LF_OSM[0] - HOME[0], LF_OSM[1] - HOME[1]]), b = nrm([RF_OSM[0] - HOME[0], RF_OSM[1] - HOME[1]]);
  const d = nrm([a[0] + b[0], a[1] + b[1]]);
  let p = [-d[1], d[0]];
  if (p[0] * b[0] + p[1] * b[1] < 0) p = [-p[0], -p[1]];
  const W = (al, ac) => [HOME[0] + d[0] * al + p[0] * ac, HOME[1] + d[1] * al + p[1] * ac];
  // foul poles where the 45-degree lines reach the fence's distance at each end
  const s = Math.SQRT1_2;
  const lfR = Math.hypot(LF_OSM[0] - HOME[0], LF_OSM[1] - HOME[1]), rfR = Math.hypot(RF_OSM[0] - HOME[0], RF_OSM[1] - HOME[1]);
  const LF = W(lfR * s, -lfR * s), RF = W(rfR * s, rfR * s);
  return { d, p, W, LF, RF, fence: [LF, ...FENCE_MID, RF] };
})();

/** Where a 2D segment a->b crosses the fence: { t along a->b, i the fence segment } or null. */
function fenceCross(a, b) {
  const P = F.fence;
  for (let i = 0; i + 1 < P.length; i++) {
    const c = P[i], e = P[i + 1];
    const rx = b[0] - a[0], rz = b[1] - a[1], sx = e[0] - c[0], sz = e[1] - c[1];
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { t, i };
  }
  return null;
}

// --- prep and the drawing --------------------------------------------------------------

/** Before meshing (main.js): the building's box goes flat (drawn here), and the park joins kwsights' run. */
export function prepBallpark(city) {
  if (typeof window !== 'undefined' && window.__noBallpark) return { skipped: 0 };
  let skipped = 0;
  const cx = BUILDING.reduce((s, q) => s + q[0], 0) / 4, cz = BUILDING.reduce((s, q) => s + q[1], 0) / 4;
  const b = boxAt(city, cx, cz, 1.5);
  if (b && b.w * b.d < 140) { b.h = 0; b.kw = b.kw || {}; b.kw.skip = true; skipped++; }
  addSights('ballpark', buildBallpark, ballparkMap);
  return { skipped };
}

const STATS = {};
export function ballparkStats() { return STATS; }

function ballparkMap() {
  const g = gate();
  return [{ x: g[0], z: g[1], kind: 'ball', label: 'Panthers', name: 'Jack Couch Park — Kitchener Panthers', near: false,
    hello: 'Jack Couch Park, home of the Kitchener Panthers (IBL) — press ENTER at the gate for the home run derby' }];
}
/** The gate: on the car park side of the building, by the third-base bleachers. */
function gate() { return [BUILDING[1][0] + 1.5, BUILDING[1][1] - 4.5]; }

function buildBallpark(kit, ctx) {
  const t0 = performance.now();
  const L = ctx.atlas, [hx, hz] = HOME;
  const B = kit.B(hx + F.d[0] * 50, hz + F.d[1] * 50);
  const D = kit.B(hx + F.d[0] * 50, hz + F.d[1] * 50, true);
  const g = kit.grp(hx + F.d[0] * 50, hz + F.d[1] * 50);
  const W = F.W, d = F.d, p = F.p;
  const GOLD = lin([0.98, 0.76, 0.05]), BLACK = lin([0.06, 0.06, 0.07]), CLAY = lin([0.66, 0.45, 0.31]), CLAYD = lin([0.58, 0.39, 0.27]);
  const LINE = lin([0.97, 0.97, 0.94]), TURF = lin([0.36, 0.54, 0.26]), TURF2 = lin([0.32, 0.49, 0.23]), GREEN = lin([0.10, 0.26, 0.16]);
  const STEEL = lin([0.60, 0.62, 0.64]), ALU = lin([0.76, 0.78, 0.80]), BLOCK = lin([0.74, 0.68, 0.58]), ROOF = lin([0.36, 0.24, 0.17]);
  const Y = (x, z) => T(x, z) + 0.06;
  const V = (q, lift = 0) => [q[0], Y(q[0], q[1]) + lift, q[1]];
  const up = [0, 1, 0];
  // a flat patch on the ground through (x, z) points, subdivided ~6 m so it follows the terrain
  const fanTri = (a, b, c, col, lift) => D.tri(V(a, lift), V(b, lift), V(c, lift), up, col);

  // --- fair territory: the outfield grass in mown arcs, home to the fence
  const fpts = F.fence;
  for (let i = 0; i + 1 < fpts.length; i++) {
    const A = fpts[i], C = fpts[i + 1], n = Math.ceil(Math.hypot(C[0] - A[0], C[1] - A[1]) / 6);
    for (let k = 0; k < n; k++) {
      const a = [A[0] + (C[0] - A[0]) * k / n, A[1] + (C[1] - A[1]) * k / n], c = [A[0] + (C[0] - A[0]) * (k + 1) / n, A[1] + (C[1] - A[1]) * (k + 1) / n];
      const RN = 18;
      for (let r = 0; r < RN; r++) {
        const u0 = r / RN, u1 = (r + 1) / RN;
        const P0 = [hx + (a[0] - hx) * u0, hz + (a[1] - hz) * u0], P1 = [hx + (c[0] - hx) * u0, hz + (c[1] - hz) * u0];
        const Q0 = [hx + (a[0] - hx) * u1, hz + (a[1] - hz) * u1], Q1 = [hx + (c[0] - hx) * u1, hz + (c[1] - hz) * u1];
        // the warning track: the last ~3 m inside the fence
        const dist = Math.hypot(a[0] - hx, a[1] - hz), warn = u0 > 1 - 3.2 / dist;
        const col = warn ? CLAYD : (r % 2 ? TURF : TURF2);
        if (r) fanTri(P0, Q0, Q1, col, 0); else fanTri([hx, hz], Q0, Q1, col, 0);
        if (r) fanTri(P0, Q1, P1, col, 0);
      }
    }
  }
  // --- the infield: the skinned arc 95 ft from the rubber, the grass square, the home circle, the mound
  const mo = W(MOUND, 0);
  const NA = 28, rc = 28.96;
  for (let i = 0; i < NA; i++) {
    const a0 = -Math.PI / 4 + (Math.PI / 2) * i / NA, a1 = -Math.PI / 4 + (Math.PI / 2) * (i + 1) / NA;
    // a ray from home at angle a meets the arc round the mound at r(a)
    const rAt = (a) => { const ca = Math.cos(a); return MOUND * ca + Math.sqrt(Math.max(0, rc * rc - MOUND * MOUND * (1 - ca * ca))); };
    const e0 = W(Math.cos(a0) * rAt(a0), Math.sin(a0) * rAt(a0)), e1 = W(Math.cos(a1) * rAt(a1), Math.sin(a1) * rAt(a1));
    // in rings, so the skin follows the ground as the grass square over it does
    const RNG = 5, at = (a, k) => W(Math.cos(a) * rAt(a) * k / RNG, Math.sin(a) * rAt(a) * k / RNG);
    fanTri([hx, hz], at(a0, 1), at(a1, 1), CLAY, 0.04);
    for (let k = 1; k < RNG; k++) { fanTri(at(a0, k), at(a0, k + 1), at(a1, k + 1), CLAY, 0.04); fanTri(at(a0, k), at(a1, k + 1), at(a1, k), CLAY, 0.04); }
    void e0; void e1;
  }
  const r2 = BASE / Math.SQRT2, ins = 1.0;
  const sq = [W(ins * Math.SQRT2 + 1.2, 0), W(r2, -r2 + ins), W(r2 * 2 - ins * Math.SQRT2, 0), W(r2, r2 - ins)];
  // the grass square in 4 x 4 so it follows the ground
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const lerp2 = (u, v) => { const a = [sq[0][0] + (sq[1][0] - sq[0][0]) * u, sq[0][1] + (sq[1][1] - sq[0][1]) * u], b = [sq[3][0] + (sq[2][0] - sq[3][0]) * u, sq[3][1] + (sq[2][1] - sq[3][1]) * u]; return [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v]; };
    const q = [lerp2(i / 4, j / 4), lerp2((i + 1) / 4, j / 4), lerp2((i + 1) / 4, (j + 1) / 4), lerp2(i / 4, (j + 1) / 4)];
    D.quad(V(q[0], 0.09), V(q[1], 0.09), V(q[2], 0.09), V(q[3], 0.09), up, U0, (i + j) % 2 ? TURF : TURF2);
  }
  const disc = (c, r, col, lift, n = 20) => {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      fanTri(c, [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r], col, lift);
    }
  };
  disc(HOME, 3.96, CLAY, 0.13);
  disc(mo, 2.74, CLAY, 0.13);
  // the mound rises 10 in: a low cone, the rubber on top
  const moY = Y(mo[0], mo[1]) + 0.13;
  for (let k = 0; k < 16; k++) {
    const a0 = (k / 16) * Math.PI * 2, a1 = ((k + 1) / 16) * Math.PI * 2;
    B.tri([mo[0], moY + 0.25, mo[1]], [mo[0] + Math.cos(a1) * 2.6, moY, mo[1] + Math.sin(a1) * 2.6], [mo[0] + Math.cos(a0) * 2.6, moY, mo[1] + Math.sin(a0) * 2.6], up, CLAY);
  }
  B.box(mo[0], moY + 0.24, mo[1], 0.61, 0.03, 0.15, Math.atan2(p[1], p[0]), LINE);
  // bases, the plate, the batter's boxes, the foul lines
  for (const [al, ac] of [[r2, r2], [r2 * 2, 0], [r2, -r2]]) {
    const q = W(al, ac);
    B.box(q[0], Y(q[0], q[1]) + 0.02, q[1], 0.38, 0.08, 0.38, Math.atan2(d[1], d[0]) + Math.PI / 4, LINE);
  }
  const plate = [W(0.0, -0.22), W(0.0, 0.22), W(0.22, 0.22), W(0.43, 0), W(0.22, -0.22)];
  for (let k = 1; k + 1 < plate.length; k++) D.tri(V(plate[0], 0.17), V(plate[k], 0.17), V(plate[k + 1], 0.17), up, LINE);
  const strip = (a, b, w, col, lift) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(l / 8));
    const ox = -dz / l * w / 2, oz = dx / l * w / 2;
    for (let i = 0; i < n; i++) {
      const A = [a[0] + dx * i / n, a[1] + dz * i / n], C = [a[0] + dx * (i + 1) / n, a[1] + dz * (i + 1) / n];
      D.quad(V([A[0] - ox, A[1] - oz], lift), V([C[0] - ox, C[1] - oz], lift), V([C[0] + ox, C[1] + oz], lift), V([A[0] + ox, A[1] + oz], lift), up, U0, col);
    }
  };
  strip(HOME, F.LF, 0.1, LINE, 0.16); strip(HOME, F.RF, 0.1, LINE, 0.16);
  for (const s of [-1, 1]) {
    const box4 = [W(-0.9, s * 0.45), W(0.9, s * 0.45), W(0.9, s * 1.67), W(-0.9, s * 1.67)];
    for (let k = 0; k < 4; k++) strip(box4[k], box4[(k + 1) % 4], 0.07, LINE, 0.17);
    disc(W(-6, s * 12), 0.9, CLAYD, 0.06, 12);                      // the on-deck circles
  }
  // --- the outfield fence: dark green boards, the gold cap, panels and the distances
  let sAcc = 0;
  for (let i = 0; i + 1 < fpts.length; i++) {
    const A = fpts[i], C = fpts[i + 1], len = Math.hypot(C[0] - A[0], C[1] - A[1]);
    const ux = (C[0] - A[0]) / len, uz = (C[1] - A[1]) / len;
    let nx = -uz, nz = ux;                                   // the field side
    if ((hx - A[0]) * nx + (hz - A[1]) * nz < 0) { nx = -nx; nz = -nz; }
    const n = Math.ceil(len / 3);
    for (let k = 0; k < n; k++) {
      const a = [A[0] + ux * len * k / n, A[1] + uz * len * k / n], c = [A[0] + ux * len * (k + 1) / n, A[1] + uz * len * (k + 1) / n];
      const ya = T(a[0], a[1]), yc = T(c[0], c[1]);
      B.quad([a[0], ya - 0.3, a[1]], [c[0], yc - 0.3, c[1]], [c[0], yc + FENCE_H, c[1]], [a[0], ya + FENCE_H, a[1]], [nx, 0, nz], U0, GREEN);
      B.quad([c[0], yc - 0.3, c[1]], [a[0], ya - 0.3, a[1]], [a[0], ya + FENCE_H, a[1]], [c[0], yc + FENCE_H, c[1]], [-nx, 0, -nz], U0, shade(GREEN, 0.8));
      B.quad([a[0], ya + FENCE_H, a[1]], [c[0], yc + FENCE_H, c[1]], [c[0] - nx * 0.18, yc + FENCE_H, c[1] - nz * 0.18], [a[0] - nx * 0.18, ya + FENCE_H, a[1] - nz * 0.18], up, U0, GOLD);
      B.quad([a[0], ya + FENCE_H - 0.18, a[1]], [c[0], yc + FENCE_H - 0.18, c[1]], [c[0], yc + FENCE_H, c[1]], [a[0], ya + FENCE_H, a[1]], [nx, 0, nz], U0, GOLD);
      // posts behind
      B.box(a[0] - nx * 0.2, ya - 0.3, a[1] - nz * 0.2, 0.12, FENCE_H + 0.3, 0.12, 0, STEEL);
    }
    ctx.solids.push({ x: (A[0] + C[0]) / 2, z: (A[1] + C[1]) / 2, hw: len / 2, hd: 0.15, rot: Math.atan2(uz, ux), y0: T(A[0], A[1]) - 1, y1: T(A[0], A[1]) + FENCE_H });
    // panels down this stretch, every ~16 m
    const ADS = [['KITCHENER', 'PANTHERS', '#111111', '#f6c000'], ['IBL', 'INTERCOUNTY BASEBALL', '#f6c000', '#111111'], ['PLAY BALL', 'SINCE 1919', '#111111', '#ffffff'],
      ['GO', 'PANTHERS GO', '#f6c000', '#111111'], ['JACK COUCH', 'PARK · 1967', '#0e3b1f', '#f6c000']];
    for (let t = 8; t < len - 6; t += 16) {
      const k = (sAcc + Math.round(t)) % ADS.length, [t1, t2, bg, fg] = ADS[k];
      const m = L.panel(5.2, 1.5, 18, (q, Wd, Ht) => {
        q.fillStyle = bg; q.fillRect(0, 0, Wd, Ht);
        q.fillStyle = fg; q.textAlign = 'center'; q.textBaseline = 'middle';
        q.font = `900 ${Ht * 0.5}px ${SANS}`; q.fillText(t1, Wd / 2, Ht * 0.38, Wd * 0.92);
        q.font = `700 ${Ht * 0.24}px ${SANS}`; q.fillText(t2, Wd / 2, Ht * 0.78, Wd * 0.92);
      });
      const x = A[0] + ux * t, z = A[1] + uz * t;
      hang(g, m, x, T(x, z) + 1.25, z, nx, nz, 0.03);
    }
    sAcc += Math.round(len);
  }
  // the distances in feet, as painted: down each line and at the corner of the fence
  const mark = (q) => {
    const ft = Math.round(Math.hypot(q[0] - hx, q[1] - hz) * FT / 5) * 5;
    const m = L.panel(1.6, 0.8, 30, (c, Wd, Ht) => { c.fillStyle = '#f6c000'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `900 ${Ht * 0.8}px ${SANS}`; c.fillText(String(ft), Wd / 2, Ht * 0.55); });
    const nx = hx - q[0], nz = hz - q[1], l = Math.hypot(nx, nz);
    hang(g, m, q[0] + nx / l * 0.08, T(q[0], q[1]) + FENCE_H - 0.6, q[1] + nz / l * 0.08, nx / l, nz / l, 0.02);
    return ft;
  };
  STATS.ft = [mark(W(Math.hypot(F.LF[0] - hx, F.LF[1] - hz) * 0.99 * Math.SQRT1_2 + 0, -Math.hypot(F.LF[0] - hx, F.LF[1] - hz) * 0.99 * Math.SQRT1_2)),
    mark([FENCE_MID[0][0] - 0.3, FENCE_MID[0][1]]), mark(W(Math.hypot(F.RF[0] - hx, F.RF[1] - hz) * 0.99 * Math.SQRT1_2, Math.hypot(F.RF[0] - hx, F.RF[1] - hz) * 0.99 * Math.SQRT1_2))];
  // the foul poles
  for (const q of [F.LF, F.RF]) B.prism(q[0], T(q[0], q[1]) - 0.3, q[1], 0.11, 12.5, 8, GOLD);
  // --- the backstop: 60 ft behind the plate, posts and netting, and the low fences down the lines
  const chain = (pts, h) => {
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i], y = T(q[0], q[1]);
      B.prism(q[0], y - 0.2, q[1], 0.05, h + 0.2, 6, STEEL);
      if (!i) continue;
      const a = pts[i - 1], ya = T(a[0], a[1]);
      for (const yy of [0.05, h * 0.5, h]) B.tube([a[0], ya + yy, a[1]], [q[0], y + yy, q[1]], 0.025, 4, STEEL);
      // (the netting itself is see-through: rails at a quarter of the height carry it)
      const ux = q[0] - a[0], uz = q[1] - a[1], l = Math.hypot(ux, uz);
      for (const yy of [h * 0.25, h * 0.75]) B.tube([a[0], ya + yy, a[1]], [q[0], y + yy, q[1]], 0.018, 4, STEEL);
      ctx.solids.push({ x: (a[0] + q[0]) / 2, z: (a[1] + q[1]) / 2, hw: l / 2, hd: 0.1, rot: Math.atan2(uz, ux), y0: ya - 1, y1: ya + h });
    }
  };
  const bs = [];
  for (let i = 0; i <= 8; i++) { const a = Math.PI * 0.75 + (Math.PI * 0.5) * i / 8; bs.push(W(Math.cos(a) * 15 + 4, Math.sin(a) * 15)); }
  // (the backstop's net is high; draw it as a frame with the netting as a dark band at the top)
  chain(bs, 7);
  chain([W(-6.5, -10.5), W(24, -16.5), W(60, -19)], 1.3);
  chain([W(-6.5, 10.5), W(24, 16.5), W(62, 19)], 1.3);
  // --- the dugouts: block, a slot roof, sunk a step; home on third, the visitors on first
  for (const s of [-1, 1]) {
    const c = W(16, s * 16.2), y = T(c[0], c[1]);
    const rot = Math.atan2(d[1], d[0]) + s * 0.08;
    B.box(c[0], y - 0.6, c[1], 11, 2.7, 2.6, rot, BLOCK);
    B.box(c[0] - p[0] * s * 0.95, y + 2.05, c[1] - p[1] * s * 0.95, 11.4, 0.18, 3.4, rot, s < 0 ? GOLD : STEEL);
    // the open front: a dark slot toward the field
    const fx = -p[0] * s, fz = -p[1] * s;
    B.quad([c[0] + fx * 1.32 - d[0] * 5.2, y + 0.15, c[1] + fz * 1.32 - d[1] * 5.2], [c[0] + fx * 1.32 + d[0] * 5.2, y + 0.15, c[1] + fz * 1.32 + d[1] * 5.2],
      [c[0] + fx * 1.32 + d[0] * 5.2, y + 1.85, c[1] + fz * 1.32 + d[1] * 5.2], [c[0] + fx * 1.32 - d[0] * 5.2, y + 1.85, c[1] + fz * 1.32 - d[1] * 5.2], [fx, 0, fz], U0, lin([0.05, 0.05, 0.06]));
    ctx.solids.push({ x: c[0], z: c[1], hw: 5.5, hd: 1.3, rot, y0: y - 1, y1: y + 2.1 });
  }
  // --- the bleachers: aluminium rows down each line, rising away from the field
  const bleacher = (a, b, rows) => {
    const ux = b[0] - a[0], uz = b[1] - a[1], len = Math.hypot(ux, uz), tx = ux / len, tz = uz / len;
    let nx = -tz, nz = tx;                                  // away from the field
    if ((HOME[0] + d[0] * 30 - a[0]) * nx + (HOME[1] + d[1] * 30 - a[1]) * nz > 0) { nx = -nx; nz = -nz; }
    const rot = Math.atan2(tz, tx), y0 = Math.min(T(a[0], a[1]), T(b[0], b[1]));
    for (let r = 0; r < rows; r++) {
      const off = 0.5 + r * 0.8, ys = y0 + 0.45 + r * 0.42;
      const cx = (a[0] + b[0]) / 2 + nx * off, cz = (a[1] + b[1]) / 2 + nz * off;
      B.box(cx + nx * 0.18, ys, cz + nz * 0.18, len, 0.05, 0.3, rot, ALU);                   // the seat
      B.box(cx - nx * 0.22, ys - 0.24, cz - nz * 0.22, len, 0.04, 0.26, rot, shade(ALU, 0.85));  // the foot board
      B.box(cx + nx * 0.4, ys - 0.42, cz + nz * 0.4, len, 0.42, 0.02, rot, shade(ALU, 0.7));    // the riser behind
    }
    // the frame: an A-leg every 3 m, and the rail along the back
    const top = y0 + 0.45 + rows * 0.42, back = 0.5 + rows * 0.8;
    for (let t = 0; t <= len + 0.01; t += 3) {
      const x = a[0] + tx * t, z = a[1] + tz * t;
      B.tube([x + nx * 0.2, y0, z + nz * 0.2], [x + nx * back, top - 0.4, z + nz * back], 0.04, 4, STEEL);
      B.tube([x + nx * back, y0, z + nz * back], [x + nx * back, top + 0.6, z + nz * back], 0.04, 4, STEEL);
    }
    B.tube([a[0] + nx * back, top + 0.6, a[1] + nz * back], [b[0] + nx * back, top + 0.6, b[1] + nz * back], 0.035, 4, STEEL);
    ctx.solids.push({ x: (a[0] + b[0]) / 2 + nx * back / 2, z: (a[1] + b[1]) / 2 + nz * back / 2, hw: len / 2, hd: back / 2, rot, y0: y0 - 1, y1: top });
  };
  bleacher(W(-4, 13), W(48, 20.5), 8);       // first base, down the line toward the car park (the big run in the aerial)
  bleacher(W(-4, -13), W(34, -18.5), 6);     // third base
  bleacher(W(-12.2, -5.8), W(-12.2, 6.4), 4);   // behind the backstop
  // --- the building behind home: block, a brown roof, the press box window, the names
  {
    const pts = BUILDING, es = edges(pts);
    const yb = Math.min(...pts.map((q) => T(q[0], q[1]))) - 0.3, H = 6.2;
    for (const e of es) {
      B.quad(e.at(0, yb), e.at(e.L, yb), e.at(e.L, yb + H), e.at(0, yb + H), [e.nx, 0, e.nz], U0, BLOCK);
      B.quad(e.at(0, yb + H), e.at(e.L, yb + H), e.at(e.L, yb + H + 0.25), e.at(0, yb + H + 0.25), [e.nx, 0, e.nz], U0, BLACK);
    }
    const c = [pts.reduce((s, q) => s + q[0], 0) / 4, pts.reduce((s, q) => s + q[1], 0) / 4];
    for (const e of es) B.tri(e.at(0, yb + H + 0.25, 0.4), e.at(e.L, yb + H + 0.25, 0.4), [c[0], yb + H + 1.6, c[1]], up, ROOF);
    // the field face (the one toward home): press box glass, the concession window, KITCHENER PANTHERS
    const f = es.reduce((best, e) => { const s = (hx - e.mx) * e.nx + (hz - e.mz) * e.nz; return !best || s > best.s ? { e, s } : best; }, null).e;
    B.quad(f.at(0.6, yb + 3.6, 0.03), f.at(f.L - 0.6, yb + 3.6, 0.03), f.at(f.L - 0.6, yb + 5.4, 0.03), f.at(0.6, yb + 5.4, 0.03), [f.nx, 0, f.nz], U0, lin([0.12, 0.17, 0.2]));
    B.quad(f.at(f.L / 2 - 1.5, yb + 1.2, 0.03), f.at(f.L / 2 + 1.5, yb + 1.2, 0.03), f.at(f.L / 2 + 1.5, yb + 2.4, 0.03), f.at(f.L / 2 - 1.5, yb + 2.4, 0.03), [f.nx, 0, f.nz], U0, lin([0.2, 0.18, 0.15]));
    const sign = L.panel(Math.min(9, f.L - 1), 0.9, 30, (q, Wd, Ht) => {
      q.fillStyle = '#111111'; q.fillRect(0, 0, Wd, Ht); q.fillStyle = '#f6c000'; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `900 ${Ht * 0.7}px ${SANS}`; q.fillText('KITCHENER PANTHERS', Wd / 2, Ht * 0.55, Wd * 0.94);
    });
    const sp = f.at(f.L / 2, 0, 0.05);
    hang(g, sign, sp[0], yb + 6.0 - 0.55, sp[2], f.nx, f.nz, 0.02);
    // the car park face: the park's name, and the gate beside it
    const bk = es.reduce((best, e) => { const s = -((hx - e.mx) * e.nx + (hz - e.mz) * e.nz); return !best || s > best.s ? { e, s } : best; }, null).e;
    const nm = L.panel(Math.min(9, bk.L - 0.6), 1.5, 28, (q, Wd, Ht) => {
      q.fillStyle = '#f6c000'; q.fillRect(0, 0, Wd, Ht); q.fillStyle = '#111111'; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `900 ${Ht * 0.42}px ${SANS}`; q.fillText('JACK COUCH PARK', Wd / 2, Ht * 0.36, Wd * 0.94);
      q.font = `700 ${Ht * 0.2}px ${SANS}`; q.fillText('HOME OF THE KITCHENER PANTHERS', Wd / 2, Ht * 0.76, Wd * 0.94);
    });
    const bp = bk.at(bk.L / 2, 0, 0.05);
    hang(g, nm, bp[0], yb + 4.2, bp[2], bk.nx, bk.nz, 0.02);
    for (const e of es) ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.1, hd: 0.25, rot: Math.atan2(e.uz, e.ux), y0: yb - 1, y1: yb + H });
  }
  // the dedication rock by the gate
  { const q = gate(); B.spheroid(q[0] + 1.6, T(q[0], q[1]) + 0.3, q[1] - 0.8, 0.75, 7, 5, lin([0.52, 0.50, 0.47]), 0.65, 0.12); }
  // --- the light standards: steel poles, a bank of lamps each, aimed at the infield
  const LIGHTS = [W(-9, -24), W(-9, 24), W(55, -58), W(98, -34), W(102, 28), W(60, 62)];
  STATS.lights = 0;
  for (const q of LIGHTS) {
    if (ctx.city.onRoad(q[0], q[1], 1)) continue;
    const y = T(q[0], q[1]), H = 24;
    B.prism(q[0], y - 0.5, q[1], 0.3, H + 0.5, 8, STEEL);
    const tgt = W(30, 0), fx = tgt[0] - q[0], fz = tgt[1] - q[1], fl = Math.hypot(fx, fz), ux = fx / fl, uz = fz / fl;
    const rot = Math.atan2(-ux, uz);       // the bank across the line of aim
    B.box(q[0] + ux * 0.5, y + H - 2.4, q[1] + uz * 0.5, 4.2, 3.0, 0.3, rot, STEEL);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const ox = -uz * (-1.5 + i), oz = ux * (-1.5 + i);
      B.box(q[0] + ux * 0.72 + ox, y + H - 2.1 + j * 0.95, q[1] + uz * 0.72 + oz, 0.7, 0.62, 0.12, rot, lin([1.0, 0.98, 0.88]));
    }
    ctx.solids.push({ x: q[0], z: q[1], r: 0.35, y0: y - 1, y1: y + H });
    STATS.lights++;
  }
  // --- the scoreboard: beyond the fence in left-centre, facing home
  {
    const q = W(112, -22), y = T(q[0], q[1]);
    const nx = hx - q[0], nz = hz - q[1], nl = Math.hypot(nx, nz), Nx = nx / nl, Nz = nz / nl;
    for (const s of [-1, 1]) B.prism(q[0] - Nz * s * 4.2, y - 0.3, q[1] + Nx * s * 4.2, 0.2, 9.6, 6, STEEL);
    B.box(q[0] - Nx * 0.2, y + 4.4, q[1] - Nz * 0.2, 11, 5.2, 0.35, Math.atan2(-Nz, Nx) + Math.PI / 2 + Math.PI / 2, BLACK);
    const sb = L.panel(10.6, 4.9, 26, (c, Wd, Ht) => {
      c.fillStyle = '#0b0b0c'; c.fillRect(0, 0, Wd, Ht);
      c.fillStyle = '#f6c000'; c.fillRect(0, 0, Wd, Ht * 0.22);
      c.fillStyle = '#111111'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `900 ${Ht * 0.16}px ${SANS}`; c.fillText('KITCHENER PANTHERS', Wd / 2, Ht * 0.12, Wd * 0.94);
      c.fillStyle = '#f6c000'; c.font = `700 ${Ht * 0.09}px ${SANS}`; c.textAlign = 'left';
      const cols = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'R', 'H', 'E'], x0 = Wd * 0.28, cw = (Wd * 0.7) / cols.length;
      cols.forEach((t, i) => { c.textAlign = 'center'; c.fillText(String(t), x0 + cw * (i + 0.5), Ht * 0.32); });
      c.textAlign = 'left'; c.font = `800 ${Ht * 0.1}px ${SANS}`;
      c.fillText('GUESTS', Wd * 0.03, Ht * 0.48); c.fillText('PANTHERS', Wd * 0.03, Ht * 0.64);
      c.fillStyle = '#ffd24a'; c.textAlign = 'center';
      for (let i = 0; i < 12; i++) for (const yy of [0.48, 0.64]) c.fillText(i < 9 ? '0' : '0', x0 + cw * (i + 0.5), Ht * yy);
      c.fillStyle = '#f6c000'; c.font = `800 ${Ht * 0.09}px ${SANS}`;
      ['BALL', 'STRIKE', 'OUT'].forEach((t, i) => { c.textAlign = 'center'; c.fillText(t, Wd * (0.25 + i * 0.25), Ht * 0.86); });
    });
    hang(g, sb, q[0], y + 7.0, q[1], Nx, Nz, 0.0);
    ctx.solids.push({ x: q[0], z: q[1], hw: 5.5, hd: 0.4, rot: Math.atan2(Nx, -Nz), y0: y - 1, y1: y + 9.6 });
    STATS.board = [+q[0].toFixed(1), +q[1].toFixed(1)];
  }
  // the trees keep off the field and the stands
  if (ctx.clearAt) {
    ctx.clearAt.push([HOME[0] + d[0] * 50, HOME[1] + d[1] * 50, 62]);
    ctx.clearAt.push([HOME[0] - d[0] * 8, HOME[1] - d[1] * 8, 22]);
  }
  STATS.ms = Math.round(performance.now() - t0);
  STATS.fence = F.fence.map((q) => q.map((v) => +v.toFixed(1)));
  if (typeof window !== 'undefined') window.__ballpark = STATS;
}

// --- the derby ------------------------------------------------------------------------

const SWINGS = 12;
const SWING_T = 0.18;        // trigger to contact
const DRAG = 0.0062, LIFT = 0.0028;

export class Derby {
  /** opts: { scene, camera, player, audio, renderer, hud (getter obj), onReward, onEnd } */
  constructor(opts) {
    this.o = opts;
    this.state = 'off';
    this.best = { hr: 0, long: 0 };
    try { Object.assign(this.best, JSON.parse(localStorage.getItem('autokw-derby') || '{}')); } catch (e) { /* private */ }
    this.gate = gate();
    this.F = F;
    this.log = [];
  }
  get active() { return this.state !== 'off'; }
  places() { return []; }     // (ballparkMap puts the gate on the map, through kwsights)

  near(pl) {
    if (!pl.onFoot) return false;
    return Math.hypot(pl.x - this.gate[0], pl.z - this.gate[1]) < 7 && Math.abs(pl.y - T(this.gate[0], this.gate[1])) < 3;
  }

  start() {
    const o = this.o, P = o.player;
    this.cam0 = { fov: o.camera.fov };
    this.vis0 = P.h.group.visible;
    this._build();
    this._ui();
    setInterior(true);
    // the crowd off the field while you bat (the world is held: they would stand frozen on it)
    this.hidden = [];
    for (const q of (o.peds && o.peds.peds) || []) {
      if (Math.hypot(q.x - HOME[0], q.z - HOME[1]) < 140 && q.h.group.visible) { q.h.group.visible = false; this.hidden.push(q); }
    }
    this.outs = 0; this.hr = 0; this.long = 0; this.paid = 0; this.swings = 0; this.pitchN = 0;
    this.log = [];
    this.state = 'intro'; this.t = 0;
    this._msg('KITCHENER PANTHERS · HOME RUN DERBY', 2.2);
    this._hud();
    return true;
  }

  // --- building and freeing ----------------------------------------------------------

  _build() {
    const o = this.o, g = new THREE.Group();
    g.name = 'derby';
    // the bat: ash, a black grip, the barrel along +y from the knob
    const b = new Builder(false);
    b.tube([0, -0.05, 0], [0, 0.32, 0], 0.016, 8, [0.06, 0.06, 0.06], true);
    b.tube([0, 0.32, 0], [0, 0.55, 0], 0.022, 8, [0.62, 0.45, 0.25], true);
    b.tube([0, 0.55, 0], [0, 0.84, 0], 0.034, 10, [0.66, 0.48, 0.27], true);
    b.spheroid(0, -0.06, 0, 0.026, 8, 4, [0.06, 0.06, 0.06]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    this.bat = new THREE.Mesh(b.build(), mat);
    g.add(this.bat);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.5 }));
    g.add(this.ball);
    // the trail: the last couple of seconds of flight
    this.trailPos = new Float32Array(3 * 120);
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3)); tg.setDrawRange(0, 0);
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.85 }));
    this.trail.frustumCulled = false;
    g.add(this.trail);
    // the pitcher: a crowd look in the Panthers' black (a tint on his own material clone would cost a program: keep the look)
    this.pitcher = makeHumanoid({ seed: 1919 });
    g.add(this.pitcher.group);
    o.scene.add(g);
    this.g = g;
  }

  _free() {
    if (!this.g) return;
    this.o.scene.remove(this.g);
    this.pitcher.dispose();
    this.g.traverse((m) => {
      if (m === this.pitcher.mesh) return;
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
    this.g = null; this.pitcher = null;
  }

  _ui() {
    const el = document.createElement('div');
    el.id = 'derbyUi';
    el.innerHTML = `<style>
      #derbyUi { position: fixed; inset: 0; z-index: 30; pointer-events: none; font-family: ${SANS}; color: #fff; }
      #derbyUi .bar { position: absolute; top: calc(env(safe-area-inset-top) + 10px); left: 50%; transform: translateX(-50%); background: #111; border: 2px solid #f6c000;
        border-radius: 14px; padding: 6px 16px; font-weight: 800; letter-spacing: .04em; white-space: nowrap; font-size: 15px; }
      #derbyUi .bar b { color: #f6c000; }
      #derbyUi .msg { position: absolute; top: 34%; left: 50%; transform: translate(-50%, -50%); font-size: 30px; font-weight: 900; color: #f6c000;
        text-shadow: 0 2px 0 #000, 0 0 12px #000; opacity: 0; transition: opacity .2s; text-align: center; white-space: nowrap; }
      #derbyUi .msg.on { opacity: 1; }
      #derbyUi .swing { position: absolute; right: calc(env(safe-area-inset-right) + 22px); bottom: calc(env(safe-area-inset-bottom) + 22px); width: 112px; height: 112px;
        border-radius: 50%; background: #f6c000; color: #111; border: 4px solid #111; font-weight: 900; font-size: 20px; pointer-events: auto; touch-action: none; }
      #derbyUi .x { position: absolute; top: calc(env(safe-area-inset-top) + 10px); right: calc(env(safe-area-inset-right) + 12px); width: 40px; height: 40px;
        border-radius: 50%; background: #111; color: #f6c000; border: 2px solid #f6c000; font-size: 20px; pointer-events: auto; }
      #derbyUi .card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: #111; border: 3px solid #f6c000; border-radius: 16px;
        padding: 18px 26px; text-align: center; display: none; pointer-events: auto; min-width: 260px; }
      #derbyUi .card.on { display: block; }
      #derbyUi .card h2 { margin: 0 0 6px; color: #f6c000; font-size: 22px; }
      #derbyUi .card p { margin: 4px 0; font-size: 16px; }
      #derbyUi .card button { margin: 12px 6px 0; padding: 9px 18px; border-radius: 10px; border: 2px solid #f6c000; background: #f6c000; color: #111; font-weight: 900; font-size: 15px; }
      #derbyUi .card button.leave { background: #111; color: #f6c000; }
      #derbyUi .hint { position: absolute; bottom: calc(env(safe-area-inset-bottom) + 18px); left: 50%; transform: translateX(-50%); font-size: 13px; opacity: .85; text-shadow: 0 1px 2px #000; }
    </style>
    <div class="bar"></div><div class="msg"></div>
    <button class="swing">SWING</button><button class="x">✕</button>
    <div class="hint">SWING (Space · J · tap) as the ball reaches the plate — early pulls it, late pushes it</div>
    <div class="card"><h2></h2><p class="c1"></p><p class="c2"></p><button class="again">AGAIN</button><button class="leave">LEAVE</button></div>`;
    document.body.appendChild(el);
    const q = (s) => el.querySelector(s);
    this.ui = { el, bar: q('.bar'), msg: q('.msg'), swing: q('.swing'), x: q('.x'), card: q('.card'), h2: q('.card h2'), c1: q('.c1'), c2: q('.c2'), again: q('.again'), leave: q('.leave') };
    this.ui.swing.addEventListener('pointerdown', (e) => { e.preventDefault(); this.swing(); });
    this.ui.x.addEventListener('click', () => this.close());
    this.ui.again.addEventListener('click', () => this.again());
    this.ui.leave.addEventListener('click', () => this.close());
    this._key = (e) => {
      if (!this.active) return;
      if (e.code === 'Space' || e.code === 'KeyJ' || e.code === 'Enter' || e.code === 'KeyF' || e.code === 'KeyE') { e.preventDefault(); e.stopPropagation(); if (this.state === 'card') { if (e.code !== 'Space') this.again(); } else this.swing(); }
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    };
    window.addEventListener('keydown', this._key, true);
    // a tap anywhere on the field swings too
    this._tap = (e) => { if (this.active && e.target === this.o.renderer.domElement) this.swing(); };
    this.o.renderer.domElement.addEventListener('pointerdown', this._tap);
  }

  _hud() {
    if (!this.ui) return;
    this.ui.bar.innerHTML = `PANTHERS DERBY · <b>HR ${this.hr}</b> · SWING ${Math.min(SWINGS, this.swings)}/${SWINGS}${this.long ? ` · LONG ${this.long} FT` : ''}`;
  }
  _msg(s, t = 1.4) { if (!this.ui) return; this.ui.msg.textContent = s; this.ui.msg.classList.toggle('on', !!s); this._msgT = t; }

  again() {
    if (this.state !== 'card') return;
    this.ui.card.classList.remove('on');
    this.outs = 0; this.hr = 0; this.long = 0; this.paid = 0; this.swings = 0; this.pitchN = 0;
    this.log = [];
    this._hud();
    this.state = 'wait'; this.t = 0;
  }

  close() {
    if (!this.active) return;
    this.state = 'off';
    const o = this.o, P = o.player;
    window.removeEventListener('keydown', this._key, true);
    o.renderer.domElement.removeEventListener('pointerdown', this._tap);
    if (this.ui) { this.ui.el.remove(); this.ui = null; }
    setInterior(false);
    for (const q of this.hidden || []) q.h.group.visible = true;
    this.hidden = null;
    this._free();
    // back on foot at the gate, facing the field
    const gx = this.gate[0], gz = this.gate[1];
    P.respawn(gx, gz);
    P.heading = Math.atan2(HOME[0] - gx, HOME[1] - gz);
    P.camYaw = P.heading + Math.PI; P.camFootY = null;
    P.camPos.set(P.x - Math.sin(P.heading) * 4.6, P.y + 1.6, P.z - Math.cos(P.heading) * 4.6);
    P.h.group.visible = true;
    if (this.cam0) { o.camera.fov = this.cam0.fov; o.camera.updateProjectionMatrix(); }
    if (o.controls) o.controls.tapped = null;
    if (o.onEnd) o.onEnd();
  }

  // --- a pitch, a swing, a flight ------------------------------------------------------

  _pitch() {
    const d = F.d, p = F.p;
    this.pitchN++;
    const zH = 0.55 + Math.random() * 0.5, off = (Math.random() - 0.5) * 0.45;
    const mph = 56 + Math.random() * 10;
    const v = mph / 2.237;
    const mo = F.W(MOUND - 1.3, 0.45), y0 = T(mo[0], mo[1]) + 0.25 + 1.85;
    const tgt = F.W(0.2, off), ty = T(HOME[0], HOME[1]) + zH;
    const R = new THREE.Vector3(mo[0], y0, mo[1]), Tg = new THREE.Vector3(tgt[0], ty, tgt[1]);
    const dist = R.distanceTo(Tg), tf = dist / v;
    const vel = Tg.clone().sub(R).divideScalar(tf); vel.y += 0.5 * 9.81 * tf;
    this.pb = { pos: R.clone(), vel, zH, off, mph: Math.round(mph), t: 0, tf, swung: false };
    // when it crosses the contact plane (0.35 m in front of the plate)
    const along0 = (R.x - HOME[0]) * d[0] + (R.z - HOME[1]) * d[1];
    const vAlong = vel.x * d[0] + vel.z * d[1];
    this.pb.tc = (0.35 - along0) / vAlong;
    this.state = 'pitch'; this.t = 0;
    this.ball.visible = true;
    void p;
  }

  /** SWING: the bat starts now; it meets the ball SWING_T later. */
  swing() {
    if (this.state === 'wait' || this.state === 'windup') { if (!this.swingT) { this.swingT = 0.001; this._whiff(); } return; }
    if (this.state !== 'pitch' || this.pb.swung) return;
    this.pb.swung = true;
    this.swingT = 0.001;
    this.swings++;
    const e = (this.pb.t + SWING_T) - this.pb.tc;          // + late, - early
    this.pb.err = e;
    const ae = Math.abs(e);
    if (ae > 0.095) { this.pb.result = 'miss'; return; }
    // contact: exit speed by the timing and the pitch's height, the spray by the timing
    const zq = Math.max(0, Math.abs(this.pb.zH - 0.8) - 0.12) / 0.15;
    const ev = 48 * (1 - 0.5 * Math.pow(Math.max(0, (ae - 0.015) / 0.075), 1.4)) * (1 - 0.18 * zq) * (0.95 + Math.random() * 0.08);
    const spray = clamp(e * 7.5, -1.1, 1.1) + (Math.random() - 0.5) * 0.06;       // rad from centre, + to right field
    let la = 27 + (0.8 - this.pb.zH) * 30 + (Math.random() - 0.5) * 8 - Math.max(0, ae - 0.05) * 420;
    la = clamp(la, -12, 58) * Math.PI / 180;
    this.pb.contact = { ev, spray, la };
  }

  _launch() {
    const c = this.pb.contact, d = F.d, p = F.p;
    const hx = Math.cos(c.spray) * d[0] + Math.sin(c.spray) * p[0], hz = Math.cos(c.spray) * d[1] + Math.sin(c.spray) * p[1];
    const pos = this.pb.pos.clone();
    this.fly = { pos, vel: new THREE.Vector3(hx * Math.cos(c.la) * c.ev, Math.sin(c.la) * c.ev, hz * Math.cos(c.la) * c.ev), t: 0, foul: Math.abs(c.spray) > Math.PI / 4, landed: false, hr: false, bounced: 0 };
    this.trailN = 0;
    this.state = 'fly'; this.t = 0;
    this._crack(c.ev);
  }

  _flyStep(dt) {
    const f = this.fly, n = 4, sdt = dt / n;
    for (let k = 0; k < n; k++) {
      const v = f.vel, sp = v.length();
      const hx = Math.hypot(v.x, v.z) || 1;
      // drag, gravity, the backspin's lift (up and back, across the velocity)
      const ax = -DRAG * sp * v.x - LIFT * sp * v.y * (v.x / hx), az = -DRAG * sp * v.z - LIFT * sp * v.y * (v.z / hx);
      const ay = -9.81 - DRAG * sp * v.y + (f.bounced ? 0 : LIFT * sp * hx);
      const a0 = [f.pos.x, f.pos.z];
      v.x += ax * sdt; v.y += ay * sdt; v.z += az * sdt;
      f.pos.addScaledVector(v, sdt);
      // the fence: over it is gone, into it drops at its foot
      if (!f.hr && !f.foul && !f.wall) {
        const x = fenceCross(a0, [f.pos.x, f.pos.z]);
        if (x) {
          const fy = T(f.pos.x, f.pos.z) + FENCE_H;
          if (f.pos.y > fy) { f.hr = true; f.hrAt = [f.pos.x, f.pos.z]; this._homer(); }
          else { f.wall = true; v.x *= -0.25; v.z *= -0.25; f.pos.x = a0[0]; f.pos.z = a0[1]; }
        }
      }
      const gy = T(f.pos.x, f.pos.z) + 0.06;
      if (f.pos.y <= gy && v.y < 0) {
        if (!f.landed) { f.landed = true; f.land = [f.pos.x, f.pos.z]; }
        f.pos.y = gy; v.y = -v.y * 0.32; v.x *= 0.6; v.z *= 0.6; f.bounced++;
        if (Math.abs(v.y) < 0.6) v.y = 0;
      }
    }
    f.t += dt;
    this.ball.position.copy(f.pos);
    const N = this.trailPos.length / 3;
    if (this.trailN < N) { this.trailPos.set([f.pos.x, f.pos.y, f.pos.z], this.trailN * 3); this.trailN++; }
    else { this.trailPos.copyWithin(0, 3); this.trailPos.set([f.pos.x, f.pos.y, f.pos.z], (N - 1) * 3); }
    this.trail.geometry.setDrawRange(0, this.trailN);
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  _homer() {
    const f = this.fly;
    this.hr++;
    this._cheer();
  }

  _settle() {
    // the result of a ball in play (or out of the park)
    const f = this.fly, c = this.pb.contact;
    let res;
    const far = f.hr ? null : f.land;
    // a home run's distance: where it would have come down, flown on (the trail stops at the fence's top)
    if (f.hr) {
      const ft = Math.round(f.distFt);
      this.long = Math.max(this.long, ft);
      res = { kind: 'HR', ft };
      this._msg(`HOME RUN! ${ft} FT`, 2.2);
    } else {
      this.outs++;
      const ft = far ? Math.round(Math.hypot(far[0] - HOME[0], far[1] - HOME[1]) * FT) : 0;
      res = { kind: f.foul ? 'FOUL' : f.wall ? 'WALL' : c.la < 8 * Math.PI / 180 ? 'GROUNDER' : 'FLY', ft };
      this._msg(f.foul ? 'FOUL BALL' : f.wall ? `OFF THE WALL · ${ft} FT` : res.kind === 'GROUNDER' ? 'GROUND BALL' : `FLY OUT · ${ft} FT`, 1.6);
    }
    this.log.push({ n: this.pitchN, err: +this.pb.err.toFixed(3), ev: +(c.ev * 2.237).toFixed(0), la: Math.round(c.la * 180 / Math.PI), spray: Math.round(c.spray * 180 / Math.PI), ...res });
    this._hud();
  }

  /** The distance a home run flies: the same flight run on to the ground, at a fixed step. */
  _carry() {
    const c = this.pb.contact, d = F.d, p = F.p;
    const hx = Math.cos(c.spray) * d[0] + Math.sin(c.spray) * p[0], hz = Math.cos(c.spray) * d[1] + Math.sin(c.spray) * p[1];
    let x = 0, y = 0.9, vx = Math.cos(c.la) * c.ev, vy = Math.sin(c.la) * c.ev;
    const dt = 1 / 240;
    for (let i = 0; i < 4000 && y > 0; i++) {
      const v = Math.hypot(vx, vy);
      const ax = -DRAG * v * vx - LIFT * v * vy, ay = -9.81 - DRAG * v * vy + LIFT * v * vx;
      vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt;
    }
    void hx; void hz;
    return x * FT;
  }

  _card() {
    this.state = 'card';
    const pay = this.hr * 25 + (this.hr >= 5 ? 100 : 0);
    const bestHr = this.hr > this.best.hr, bestLong = this.long > this.best.long;
    if (bestHr) this.best.hr = this.hr;
    if (bestLong) this.best.long = this.long;
    try { localStorage.setItem('autokw-derby', JSON.stringify(this.best)); } catch (e) { /* private */ }
    this.paid = pay;
    if (pay > 0 && this.o.onReward) this.o.onReward(pay);
    this.ui.h2.textContent = `${this.hr} HOME RUN${this.hr === 1 ? '' : 'S'}`;
    this.ui.c1.textContent = this.long ? `Longest ${this.long} ft${bestLong ? ' — your best' : ''}` : 'Nothing left the yard';
    this.ui.c2.textContent = `Paid $${pay} · best ${this.best.hr} HR, ${this.best.long} ft`;
    this.ui.card.classList.add('on');
    this._msg('', 0);
  }

  // --- the frame -------------------------------------------------------------------------

  update(dt) {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    if (this._msgT > 0) { this._msgT -= dt; if (this._msgT <= 0) this._msg('', 0); }
    if (this.swingT) { this.swingT += dt; if (this.swingT > 0.7) this.swingT = 0; }
    const st = this.state;
    if (st === 'intro') { if (this.t > 2.4) { this.state = 'wait'; this.t = 0; } }
    else if (st === 'wait') { if (this.t > 1.2 && !this.swingT) { this.state = 'windup'; this.t = 0; } }
    else if (st === 'windup') { if (this.t > 1.1) this._pitch(); }
    else if (st === 'pitch') {
      const pb = this.pb;
      pb.t += dt;
      pb.pos.addScaledVector(pb.vel, dt); pb.vel.y -= 9.81 * dt;
      this.ball.position.copy(pb.pos);
      // the bat meets it
      if (pb.contact && pb.t >= pb.tc) { this._launch(); }
      else if (pb.t > pb.tf + 0.25) {
        // past the catcher: a take (no out), or a swing and a miss (an out)
        this.ball.visible = false;
        if (pb.swung) { this.outs++; this._msg('SWING AND A MISS', 1.4); this.log.push({ n: this.pitchN, err: +pb.err.toFixed(3), kind: 'MISS' }); }
        else { this._msg(`TAKE · ${pb.mph} MPH`, 1.0); this.log.push({ n: this.pitchN, kind: 'TAKE' }); }
        this._hud();
        this.state = this.swings >= SWINGS ? 'done' : 'wait'; this.t = 0;
      }
    } else if (st === 'fly') {
      this._flyStep(dt);
      const f = this.fly;
      if (f.hr && f.distFt === undefined) f.distFt = this._carry();
      const stopped = f.landed && f.vel.length() < 1.5;
      if ((f.hr && this.t > 3.2) || (stopped && this.t > 1.2) || (f.foul && this.t > 2.0) || this.t > 9) {
        this._settle();
        this.trail.geometry.setDrawRange(0, 0);
        this.state = this.swings >= SWINGS ? 'done' : 'after'; this.t = 0;
      }
    } else if (st === 'after') { if (this.t > 1.6) { this.ball.visible = false; this.state = 'wait'; this.t = 0; } }
    else if (st === 'done') { if (this.t > 1.8) this._card(); }
    this._pose(dt);
    this._camera(dt);
  }

  /** The batter (you) in the box and the pitcher on the mound. */
  _pose(dt) {
    const P = this.o.player, d = F.d, p = F.p;
    // a right-handed batter on the third-base side of the plate, chest to the plate
    const c = F.W(0.05, -0.98), y = T(c[0], c[1]) + 0.03;
    const face = Math.atan2(p[0], p[1]);
    P.x = c[0]; P.z = c[1]; P.y = y; P.heading = face;
    P.h.group.visible = true;
    P.h.group.position.set(c[0], y, c[1]);
    P.h.group.rotation.set(0, face, 0);
    animateWalk(P.h, 0, dt, 0);
    // the swing: s from cocked (0, the barrel back and up) through contact (pi/2) to the finish
    let s = 0;
    const u = this.swingT ? this.swingT : 0;
    if (u > 0) {
      if (u < SWING_T) s = (Math.PI / 2) * Math.pow(u / SWING_T, 1.6);
      else s = Math.PI / 2 + (Math.PI * 0.75) * Math.min(1, (u - SWING_T) / 0.2);
    }
    const bones = P.h.bones;
    bones[BONES.spine].rotation.set(0.18, -0.35 + s * 0.42, 0);
    bones[BONES.chest].rotation.set(0.05, -0.25 + s * 0.3, 0);
    bones[BONES.thighL].rotation.x += -0.25; bones[BONES.thighR].rotation.x += -0.25;
    bones[BONES.kneeL].rotation.x += 0.35; bones[BONES.kneeR].rotation.x += 0.35;
    bones[BONES.thighL].rotation.z += -0.18; bones[BONES.thighR].rotation.z += 0.18;
    // the barrel's way: back toward the catcher (-d) round through the plate (+p) to the pitcher (+d)
    const bx = -Math.cos(s) * d[0] + Math.sin(s) * p[0], bz = -Math.cos(s) * d[1] + Math.sin(s) * p[1];
    const tilt = s < Math.PI / 2 ? 1.05 - (1.05 + 0.12) * (s / (Math.PI / 2)) : -0.12 + 0.9 * Math.min(1, (s - Math.PI / 2) / (Math.PI * 0.75));
    const dir = new THREE.Vector3(bx * Math.cos(tilt), Math.sin(tilt), bz * Math.cos(tilt));
    // the hands: by the back shoulder at the stance, out in front at contact
    const cy = y + (s < 0.05 ? 1.42 : s < Math.PI / 2 ? 1.42 - 0.42 * (s / (Math.PI / 2)) : 1.0 + 0.45 * Math.min(1, (s - Math.PI / 2) / 2));
    const rr = 0.28;
    const ga = -Math.cos(s * 0.92) * rr, gp = 0.18 + Math.sin(s * 0.92) * rr;
    const grip = new THREE.Vector3(c[0] + d[0] * ga + p[0] * gp, cy, c[1] + d[1] * ga + p[1] * gp);
    P.h.group.updateMatrixWorld(true);
    solveArm(bones[BONES.shoulderL], bones[BONES.elbowL], bones[BONES.handL], grip.clone().addScaledVector(dir, 0.05), P.h.group, -1);
    solveArm(bones[BONES.shoulderR], bones[BONES.elbowR], bones[BONES.handR], grip.clone().addScaledVector(dir, -0.04), P.h.group, 1);
    this.bat.position.copy(grip).addScaledVector(dir, -0.08);
    this.bat.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    // the pitcher: set, the windup and the throw
    const H = this.pitcher, mo = F.W(MOUND, 0), my = T(mo[0], mo[1]) + 0.25;
    H.group.position.set(mo[0], my, mo[1]);
    H.group.rotation.set(0, Math.atan2(-d[0], -d[1]), 0);
    animateWalk(H, 0, dt, 0);
    H.group.updateMatrixWorld(true);
    let k = 0;          // 0 set, 0..1 windup, 1..2 the throw
    if (this.state === 'windup') k = Math.min(1, this.t / 1.1);
    else if (this.state === 'pitch') k = 1 + Math.min(1, this.pb.t / 0.35);
    const L = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(H.group.matrixWorld);
    // his right hand: at the glove, up and back over the shoulder, through the release, down across
    let hand;
    if (k <= 1) hand = k < 0.4 ? L(0.05, 1.25, 0.3) : L(-0.15 - 0.35 * (k - 0.4) / 0.6, 1.25 + 0.75 * (k - 0.4) / 0.6, 0.3 - 0.75 * (k - 0.4) / 0.6);
    else { const q = k - 1; hand = q < 0.35 ? L(-0.5 + 0.7 * q / 0.35, 2.0 - 0.15 * q / 0.35, -0.45 + 1.1 * q / 0.35) : L(0.2 - 0.6 * (q - 0.35) / 0.65, 1.85 - 0.95 * (q - 0.35) / 0.65, 0.65 - 0.1 * (q - 0.35) / 0.65); }
    const glove = k < 0.4 || k > 1.5 ? L(0.0, 1.25, 0.32) : L(0.25, 1.5, 0.5);
    const hb = H.bones;
    hb[BONES.spine].rotation.x = 0.1 + (k > 1 ? 0.35 * Math.min(1, (k - 1) / 0.4) : 0);
    solveArm(hb[BONES.shoulderR], hb[BONES.elbowR], hb[BONES.handR], hand, H.group, 1);
    solveArm(hb[BONES.shoulderL], hb[BONES.elbowL], hb[BONES.handL], glove, H.group, -1);
    if (this.state === 'windup' || this.state === 'wait' || this.state === 'intro') {
      this.ball.visible = true;
      this.ball.position.copy(hand);
    }
  }

  _camera(dt) {
    const cam = this.o.camera, d = F.d, p = F.p;
    const hy = T(HOME[0], HOME[1]);
    cam.up.set(0, 1, 0);
    if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
    if (this.state === 'fly' || this.state === 'after') {
      // up behind the plate, following the ball
      const b = this.ball.position;
      const want = new THREE.Vector3(HOME[0] - d[0] * 9 - p[0] * 2, hy + 6.5, HOME[1] - d[1] * 9 - p[1] * 2);
      cam.position.lerp(want, 1 - Math.exp(-3 * dt));
      this._look = this._look || new THREE.Vector3();
      this._look.lerp(b, 1 - Math.exp(-6 * dt));
      cam.lookAt(this._look);
    } else {
      // behind the catcher, over the plate, the pitcher framed
      cam.position.set(HOME[0] - d[0] * 5.0 + p[0] * 0.75, hy + 2.35, HOME[1] - d[1] * 5.0 + p[1] * 0.75);
      const t = F.W(MOUND * 0.6, 0);
      this._look = new THREE.Vector3(t[0], hy + 1.0, t[1]);
      cam.lookAt(this._look);
    }
    cam.updateMatrixWorld(true);
  }

  // --- sound ------------------------------------------------------------------------------

  _ctx() { const a = this.o.audio; return a && a.ctx ? a : null; }
  _noise(dur, f, q, gain, type = 'bandpass', decay = 0.05) {
    const a = this._ctx();
    if (!a) return;
    const ctx = a.ctx, n = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), dd = n.getChannelData(0);
    for (let i = 0; i < dd.length; i++) dd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * decay));
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = n; fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = gain;
    s.connect(fl).connect(g).connect(a.master || ctx.destination); s.start();
  }
  _crack(ev) { this._noise(0.25, 1900, 1.4, clamp(ev / 40, 0.4, 1.2), 'bandpass', 0.012); this._noise(0.3, 600, 4, 0.5, 'bandpass', 0.03); }
  _whiff() { this._noise(0.3, 900, 0.7, 0.25, 'bandpass', 0.08); }
  _cheer() {
    const a = this._ctx();
    if (!a) return;
    const ctx = a.ctx, dur = 2.6, n = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), dd = n.getChannelData(0);
    for (let i = 0; i < dd.length; i++) { const t = i / ctx.sampleRate; dd[i] = (Math.random() * 2 - 1) * Math.min(1, t * 4) * Math.exp(-Math.max(0, t - 0.8) * 1.5); }
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = n; fl.type = 'bandpass'; fl.frequency.value = 1100; fl.Q.value = 0.5; g.gain.value = 0.5;
    s.connect(fl).connect(g).connect(a.master || ctx.destination); s.start();
  }
}
