// THE LANDMARKS PASS: the places in Waterloo Region people would name from the
// car that were still drawn as the importer's generic boxes, each from its
// OSM footprint (data/lm2.json, tools/kw/build_lm2.py) in its real look.
//
//   - THE HOSPITALS (the Waterloo Regional Health Network since April 2025):
//     WRHN @ Midtown, the old Grand River Hospital on King St W (red brick at
//     the back, the white-and-grey front block, the cancer centre on Green St);
//     WRHN @ Queen's Blvd, the old St. Mary's General (the 1962 ten-storey
//     tower over the 1924 hospital's low wings); WRHN @ Chicopee, the old
//     Freeport hospital (brick pavilions under red-brown hipped roofs, the
//     glass pyramid); Cambridge Memorial (the 2020 A wing bending along the
//     Grand, the old tower behind). The three with an emergency department
//     have its EMERGENCY entrance.
//   - PERIMETER INSTITUTE (Saucier + Perrotte 2004; the Stephen Hawking Centre,
//     Teeple 2011): the black aluminium blades of the south front, the
//     mirror-glass slots, the reflecting pool and the entrance bridge over it,
//     the glass north wall with its study boxes over Silver Lake.
//   - THE CIGI CAMPUS (KPMB 2011): brick to the streets, glass round the
//     courtyard (cut out of the roof), the auditorium's green roof.
//   - SUN LIFE (the Mutual Life head office, 227 King St S): the 1912 Darling &
//     Pearson front (buff Roman brick, the paired columns and the pediment,
//     the balustrade), the later office blocks behind it.
//   - MANULIFE's Canadian head office (500 King St N): the long low curve of
//     pale precast and green-grey glass along the ravine, the green sign.
//   - BLACKBERRY's campus on University Ave E (A, B, C, D): grey panels and
//     blue glass, the logo on A.
//   - DOWNTOWN KITCHENER: the Waterloo Region Courthouse (NORR 2013: stone and
//     zinc, the three-storey glazed atrium on Frederick St); the Region's
//     headquarters at 150 Frederick (brick, the round council chamber under
//     its copper cone); Kitchener station (the 1897 Grand Trunk station: red
//     brick, the hipped slate roof, the platform canopy) and the 1925 freight
//     shed beside it.
//
// Sources (Oct 2026): the Esri World Imagery aerial (tools/kw/aerial.py) for
// every plan and every tower's place -- the towers are oriented boxes read off
// it, not OSM parts (OSM maps none here); OSM's tags (tools/kw/probe_blocks.py:
// levels for St. Mary's 10, the courthouse 7, 150 Frederick 8, BlackBerry 4-5);
// Canadian Architect, perimeterinstitute.ca and tboake.com (Perimeter); KPMB,
// Canadian Architect and Doors Open (CIGI); NORR and Infrastructure Ontario
// (the courthouse); Stantec's 2020 release (Cambridge Memorial); smgh.ca / CBC
// (St. Mary's tower, 1960-62); historicplaces.ca 11829 and waterlooheritage.com
// (the Mutual Life building); historicplaces.ca 4571 and Wikipedia (Kitchener
// station). ESTIMATED, not from a source: every colour is read off photographs
// or the aerial; the hospitals' tower heights other than St. Mary's; which
// face each EMERGENCY entrance is on (placed on the face toward the ambulance
// drive the aerial shows, not checked on the ground); Sun Life's and
// Manulife's heights; the WRHN wordmarks (lettering, not the logo).
//
// A landmarks.js extra of its own, drawn with kwsights.js's block() and
// friends but through LmKit (below): the shells in kw.js's footprint material
// in buildPolys' clusters, the lettering on the shared sign atlas in kw.js
// buildSigns' clusters, so no cluster gets a draw it did not have.

import {
  inPoly, polyArea, centroid, obb, edges, street, walkY, hang, lin, shade, hex, SANS, SERIF, U0, T,
} from './kwplaces.js';
import { boxAt, polyMat, plainUV, addSignHost } from './kw.js';
import { Builder } from './build.js';
import * as THREE from './three.js';
import {
  block, frontEdge, text, onWall, pyramid, hipRoof, B4, nearestEdge, entrance, sightsData,
} from './kwsights.js';

const STATS = { skipped: 0, built: [], err: [] };
const C = (h) => lin(hex(h));
const ccw = (p) => (polyArea(p) < 0 ? p.slice().reverse() : p);
let D = null;      // lm2.json

// ---------------------------------------------------------------------------------------
// before meshing: every box under a footprint drawn here goes flat (kwsights.js flatten)
// ---------------------------------------------------------------------------------------
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
    delete o.kw.poly;
  }
  return hit.size;
}

/** After prepSights: flatten the boxes; buildLandmarks2 is a landmarks.js extra of its own. */
export function prepLandmarks2(city, data) {
  D = data;
  if (typeof window !== 'undefined' && window.__noLm2) D = null;
  if (!D || !sightsData()) return STATS;
  for (const k of Object.keys(D.b)) STATS.skipped += flatten(city, D.b[k].p);
  // the stores inside them (a Tims in each hospital lobby) sign on their real walls
  for (const k of Object.keys(D.b)) addSignHost(D.b[k].p);
  if (typeof window !== 'undefined') window.__kwLm2 = STATS;
  return STATS;
}

// ---------------------------------------------------------------------------------------
// the kit: no cluster gets a draw it did not have
// ---------------------------------------------------------------------------------------
// kwsights' Kit puts its pieces in the plain 1200 m clusters, where these
// places' cells had nothing (GRH, Freeport, Cambridge Memorial, BlackBerry:
// three new draws each, the sights atlas a fourth elsewhere). Every cell here
// already has (1) buildPolys' 'kwp' cluster in kw.js's footprint material --
// the generic shells these buildings replace were drawn in it -- and (2)
// kw.js buildSigns' 'kw' cluster in the shared sign atlas (their nameplates
// and the Tims signs). So the shells go into the first (uwcampus.js does the
// same; a builder retires at 50k vertices, as there, since mergeByMaterial
// leaves a bigger mesh as a draw of its own) and the lettering into the
// second: this is a landmarks.js extra of its own, so ctx.atlas IS the shared
// atlas (2048 x 1344 used of 2048 x 2048 before this pass).
const ck = (x, z) => `${Math.round(x / 1200)},${Math.round(z / 1200)}`;
class LmKit {
  constructor(atlas) { this.atlas = atlas; this.b = new Map(); this.all = []; this.g = new Map(); this.tris = 0; }
  B(x, z) {
    const k = ck(x, z);
    let b = this.b.get(k);
    if (!b || b.pos.length > 150000) {
      b = new Builder(false);
      this.b.set(k, b);
      this.all.push(['kwp' + k, b]);
    }
    return b;
  }
  grp(x, z) {
    const k = 'kw' + ck(x, z);
    let g = this.g.get(k);
    if (!g) this.g.set(k, (g = new THREE.Group()));
    return g;
  }
  flush(ctx) {
    const M = polyMat();
    for (const [key, b] of this.all) {
      if (b.empty) continue;
      this.tris += b.idx.length / 3;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(plainUV(b.build()), M));
      ctx.addTo(key, g);
    }
    for (const [k, g] of this.g) ctx.addTo(k, g);
    this.b.clear(); this.g.clear(); this.all = [];
  }
}

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------

/** An oriented box from two ends of its long axis and a half width. */
function ob(a, b, hv) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, hu: L / 2, hv, ux: dx / L, uz: dz / L };
}
/** An oriented box's corners, as a footprint. */
function obPts(o) {
  const vx = -o.uz, vz = o.ux;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [o.x + o.ux * o.hu * a + vx * o.hv * b, o.z + o.uz * o.hu * a + vz * o.hv * b]);
}
/** Keep the points of `pts` on the side of the line through `o` that `n` points to. */
function clip(pts, o, n) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const da = (a[0] - o[0]) * n[0] + (a[1] - o[1]) * n[1], db = (b[0] - o[0]) * n[0] + (b[1] - o[1]) * n[1];
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
/** The lowest ground under a footprint. */
function lowest(pts) { let lo = Infinity; for (const q of pts) lo = Math.min(lo, T(q[0], q[1])); return lo; }
/** The edge nearest a point (kwsights nearestEdge, the edge only). */
function edgeNear(E, x, z, minL = 6) { const n = nearestEdge(E, x, z, minL); return n ? n : null; }
/** Lettering on a wall: centred at t along e, at height y. */
function letters(kit, ctx, e, t, y, w, h, str, o = {}) {
  onWall(kit, e, t, y, text(ctx.atlas, w, h, str, { px: 22, ...o }), o.off ?? 0.12);
}

/**
 * A hospital entrance: kwsights' glass vestibule and canopy, the red
 * EMERGENCY band over it and EMERGENCY on the canopy's fascia; the
 * ambulance bay's kerb paint in front.
 */
function emergency(kit, ctx, e, t, label = 'EMERGENCY') {
  const gy = T(e.mx + e.nx * 3, e.mz + e.nz * 3), w = 7, h = 3.4, d = 3.6;
  { const q = e.at(t, 0, 0); (STATS.er = STATS.er || []).push([label, Math.round(q[0]), Math.round(q[2]), +e.nx.toFixed(2), +e.nz.toFixed(2)]); }
  entrance(kit, ctx, e, t, w, h, null, { d, can: C('#b3121f') });
  const cd = d + 3, cy = gy + h;
  // the fascia's lettering, on the canopy front
  const f = text(ctx.atlas, w + 3, 0.55, label, { bg: '#b3121f', fg: '#ffffff', k: 0.78, px: 26 });
  const p = e.at(t, cy + 0.3, cd + 0.04);
  hang(kit.grp(p[0], p[2]), f, p[0], cy + 0.3, p[2], e.nx, e.nz, 0.02);
  // the big band on the wall over it
  letters(kit, ctx, e, t, cy + 2.4, 9, 1.3, label, { bg: '#b3121f', fg: '#ffffff', k: 0.7, off: 0.1 });
  // the ambulance bay: two yellow lines out from the doors
  const B = kit.B(e.mx, e.mz), Y = C('#e8c21a');
  for (const s of [-1, 1]) {
    const a = e.at(t + s * 4.5, gy + 0.12, cd), b = e.at(t + s * 4.5, gy + 0.12, cd + 9);
    const nx = e.ux * 0.08, nz = e.uz * 0.08;
    B.quad([a[0] - nx, a[1], a[2] - nz], [a[0] + nx, a[1], a[2] + nz], [b[0] + nx, b[1], b[2] + nz], [b[0] - nx, b[1], b[2] - nz], [0, 1, 0], U0, Y);
  }
}
/** A red-cross H-sign box on a pole, by the drive (the Ontario hospital sign). */
function hSign(kit, ctx, x, z, nx, nz, label) {
  const y = T(x, z), B = kit.B(x, z);
  B.box(x, y - 0.3, z, 0.18, 3.2, 0.18, 0, C('#5a5e63'));
  const m = ctx.atlas.panel(2.6, 1.4, 30, (q, W, H) => {
    q.fillStyle = '#0b4ea2'; q.fillRect(0, 0, W, H);
    q.fillStyle = '#ffffff'; q.font = `800 ${H * 0.62}px ${SANS}`; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.fillRect(W * 0.06, H * 0.12, H * 0.76, H * 0.76);
    q.fillStyle = '#0b4ea2'; q.fillText('H', W * 0.06 + H * 0.38, H * 0.54);
    q.fillStyle = '#ffffff'; q.font = `700 ${H * 0.2}px ${SANS}`; q.textAlign = 'left';
    const lines = label.split('\n');
    lines.forEach((l, i) => q.fillText(l, W * 0.06 + H * 0.9, H * (0.5 + (i - (lines.length - 1) / 2) * 0.26), W - H));
  });
  hang(kit.grp(x, z), m, x, y + 3.6, z, nx, nz, 0.02);
  const back = m.clone();
  hang(kit.grp(x, z), back, x, y + 3.6, z, -nx, -nz, 0.02);
  ctx.solids.push({ x, z, r: 0.2, y0: y - 1, y1: y + 4.3 });
}
/** Rooftop plant: a few boxes and louvred penthouses. */
function plant(kit, o, y, n, seed, col = C('#9a9c9e')) {
  const B = kit.B(o.x, o.z), rot = Math.atan2(o.uz, o.ux), vx = -o.uz, vz = o.ux;
  for (let i = 0; i < n; i++) {
    const a = ((seed * 7 + i * 13) % 17) / 17 - 0.5, b = ((seed * 3 + i * 11) % 13) / 13 - 0.5;
    const x = o.x + o.ux * a * o.hu * 1.2 + vx * b * o.hv * 1.1, z = o.z + o.uz * a * o.hu * 1.2 + vz * b * o.hv * 1.1;
    B.box(x, y, z, 3 + (i % 3) * 1.5, 1.6 + (i % 2) * 1.2, 2.5 + (i % 2), rot, shade(col, 0.9 + 0.1 * (i % 3)));
  }
}
/** A slab tower on an oriented box: block() on its corners from `y0` (its windows start above `podium`). */
function tower(kit, ctx, o, h, look, podium = 0) {
  const pts = obPts(o);
  const base = lowest(pts);
  return block(kit, ctx, pts, { base, h: h, ...look, win: look.win ? { ...look.win, g0: (look.win.g0 || 1) + podium } : null });
}

// ---------------------------------------------------------------------------------------
// THE HOSPITALS
// ---------------------------------------------------------------------------------------

// WRHN @ Midtown (Grand River Hospital, 835 King St W): the complex follows
// King St's grid (21 degrees); on the aerial the tallest block is the red-brown
// brick one behind the main entrance, the white-and-grey block faces the
// drive and its curved glass canopy.
const GRH_U = [Math.cos(0.37), Math.sin(0.37)];
function grh(kit, ctx) {
  const BR = C('#8b4a36'), BR2 = C('#7a3f2e'), STONE = C('#cfc6b6'), WH = C('#e4e4e0'), GR = C('#8d939a');
  const pts = ccw(D.b.grh.p);
  const r = block(kit, ctx, pts, {
    h: 14.5, wall: BR, trim: STONE, parapet: 0.9, roof: C('#77736d'),
    win: { style: 'punch', sp: 3.1, w: 1.7, h: 1.6, fl: 3.7, g0: 1.4, sill: STONE },
  });
  // the tall brick block behind the entrance, and the white front block on the drive
  const A = { x: -3044, z: -551, hu: 23, hv: 13, ux: GRH_U[0], uz: GRH_U[1] };
  const ta = tower(kit, ctx, A, 31, { wall: BR2, trim: STONE, parapet: 1.0, roof: C('#6f6b66'),
    win: { style: 'punch', sp: 2.6, w: 1.5, h: 1.6, fl: 3.6, sill: STONE } }, 14);
  plant(kit, A, ta.yTop, 5, 3);
  const Bk = { x: -3004, z: -500, hu: 26, hv: 12, ux: GRH_U[0], uz: GRH_U[1] };
  const tb = tower(kit, ctx, Bk, 23, { wall: WH, trim: GR, parapet: 0.8, roof: C('#8a8884'), glass: C('#3d5566'),
    win: { style: 'ribbon', fl: 3.9, h: 2.2 }, cornice: 0 }, 14);
  plant(kit, Bk, tb.yTop, 3, 5);
  // the main entrance at the curved glass canopy on the drive, and the name over it
  const me = edgeNear(r.E, -2992, -476);
  if (me) {
    entrance(kit, ctx, me.e, me.t, 9, 3.8, null, { d: 4.5 });
    letters(kit, ctx, me.e, me.t, T(me.e.mx, me.e.mz) + 6.2, 10, 0.9, 'MAIN ENTRANCE', { fg: '#1e2a38', bg: '#e9e9e4', k: 0.6 });
  }
  const tf = edgeNear(tb.E, -2990, -470, 10);
  if (tf) {
    letters(kit, ctx, tf.e, tf.e.L / 2, tb.yTop - 2.2, Math.min(18, tf.e.L - 2), 2.2, 'WRHN @ Midtown', { fg: '#0b4ea2', wt: '800', k: 0.7, off: 0.1 });
    letters(kit, ctx, tf.e, tf.e.L / 2, tb.yTop - 4.2, Math.min(18, tf.e.L - 2), 0.9, 'WATERLOO REGIONAL HEALTH NETWORK', { fg: '#3a4a5a', k: 0.7, off: 0.1 });
  }
  // EMERGENCY: on the west wing's face toward the ambulance drive off Mary St
  const er = edgeNear(r.E, -3128, -468);
  if (er) emergency(kit, ctx, er.e, er.t);
  hSign(kit, ctx, -2958, -447, -0.6, 0.8, 'WRHN @ Midtown\nEmergency  Parking');
  // the cancer centre on Green St: pale panels, glass, the sawtooth skylights the aerial shows
  const cc = block(kit, ctx, ccw(D.b.grhcc.p), {
    h: 12.5, wall: C('#d9d8d2'), trim: C('#7f878f'), parapet: 0.7, glass: C('#41606f'),
    win: { style: 'ribbon', fl: 4.0, g0: 1.2, h: 2.4 },
  });
  const cf = frontEdge(ctx.city, cc.E, /^Green Street|^King Street/, 8, 60);
  if (cf) letters(kit, ctx, cf, cf.L / 2, cc.yTop - 1.6, Math.min(20, cf.L - 2), 1.0, 'GRAND RIVER REGIONAL CANCER CENTRE', { fg: '#1e3a5a', k: 0.62, off: 0.1 });
}

// WRHN @ Queen's Blvd (St. Mary's General, 911 Queen's Blvd): the 1962 tower
// (10 storeys, ~49 m: skydb / SkyscraperPage) is the grey slab on the aerial's
// north-east, over low buff wings; the red-brown wing on the east end.
function stMary(kit, ctx) {
  const BUFF = C('#b9a181'), TRIM = C('#e2dccd');
  const r = block(kit, ctx, ccw(D.b.stmary.p), {
    h: 13, wall: BUFF, trim: TRIM, parapet: 0.8, roof: C('#86837e'),
    win: { style: 'punch', sp: 3.0, w: 1.8, h: 1.6, fl: 3.8, g0: 1.3, sill: TRIM },
  });
  const Tw = ob([-2122, 1504], [-2086, 1534], 8);
  const t = tower(kit, ctx, Tw, 45, { wall: C('#cfc8b8'), trim: C('#efeadd'), parapet: 1.2, roof: C('#7d7b77'), glass: C('#2c3640'),
    win: { style: 'grid', sp: 2.2, fl: 3.95, h: 2.0, top: 1.4 }, frame: C('#d9d3c4') }, 13);
  // the mechanical penthouse on the slab, the red-brown east wing
  const B = kit.B(Tw.x, Tw.z);
  B.box(Tw.x, t.yTop, Tw.z, Tw.hu * 1.2, 4.5, Tw.hv * 1.4, Math.atan2(Tw.uz, Tw.ux), C('#a9a397'));
  const ew = ob([-2091, 1559], [-2080, 1530], 9);
  tower(kit, ctx, ew, 17, { wall: C('#8e4d37'), trim: TRIM, parapet: 0.6, roof: C('#7a3e2c'),
    win: { style: 'punch', sp: 3.0, w: 1.6, h: 1.6, fl: 3.8, sill: TRIM } }, 0);
  const tf = edgeNear(t.E, -2140, 1490, 20);
  if (tf) {
    letters(kit, ctx, tf.e, tf.e.L / 2, t.yTop - 2.4, Math.min(24, tf.e.L - 3), 2.0, "WRHN @ Queen's Blvd", { fg: '#0b4ea2', k: 0.7, off: 0.1 });
    letters(kit, ctx, tf.e, tf.e.L / 2, t.yTop - 4.4, Math.min(24, tf.e.L - 3), 0.9, "ST. MARY'S", { fg: '#3a4a5a', font: SERIF, k: 0.75, off: 0.1 });
  }
  const me = edgeNear(r.E, -2186, 1540);
  if (me) entrance(kit, ctx, me.e, me.t, 8, 3.6, null, { d: 4 });
  const er = edgeNear(r.E, -2146, 1612);
  if (er) emergency(kit, ctx, er.e, er.t);
  hSign(kit, ctx, -2210, 1535, -0.6, -0.8, "WRHN @ Queen's Blvd\nEmergency");
}

// WRHN @ Chicopee (the Freeport hospital, 3570 King St E): brick pavilions,
// each under its own red-brown hipped roof (the aerial), and the glass pyramid
// over the courtyard.
const FREEPORT_ROOFS = [
  [5048, 2901, 8], [5083, 2901, 8], [5100, 2922, 7], [5100, 2938, 7], [5023, 2920, 8], [5010, 2938, 7],
  [5044, 2972, 7], [5065, 2980, 7], [5091, 2990, 7], [5083, 3006, 7], [5057, 3002, 7],
];
function freeport(kit, ctx) {
  const BR = C('#9a5c46'), RF = C('#5e3b30');
  const pts = ccw(D.b.freeport.p);
  const r = block(kit, ctx, pts, {
    h: 8.5, wall: BR, trim: C('#d8cbb4'), parapet: 0.3, roof: shade(RF, 0.85),
    win: { style: 'punch', sp: 3.2, w: 1.5, h: 1.6, fl: 3.6, g0: 1.2, sill: C('#d8cbb4') },
  });
  const B = r.B;
  for (const [x, z, hs] of FREEPORT_ROOFS) if (inPoly(pts, x, z)) pyramid(B, x, r.yTop + 0.3, z, hs, hs * 0.55, 0.3, RF);
  // the round pavilion, and the glass pyramid over the court
  B.prism(5113, r.yTop - 0.5, 2968, 8, 1.2, 14, BR);
  B.cone(5113, r.yTop + 0.7, 2968, 8.6, 4.2, 14, RF);
  pyramid(B, 5036, r.yTop + 0.2, 2946, 6, 4.5, 0.3, C('#7fa6b8'));
  // no emergency department here (rehabilitation and complex care): the main doors and the name
  const me = edgeNear(r.E, 5150, 2930);
  if (me) {
    entrance(kit, ctx, me.e, me.t, 8, 3.4, null, { d: 4 });
    letters(kit, ctx, me.e, me.t, r.yTop - 1.6, 14, 1.4, 'WRHN @ Chicopee', { fg: '#0b4ea2', bg: '#efe9dc', k: 0.66 });
  }
}

// Cambridge Memorial Hospital (700 Coronation Blvd): Stantec's 2020 A wing,
// five storeys bending along the Grand in two straight runs (the aerial),
// warm masonry and floor-to-ceiling glass; the old brick tower; the low wings.
function cmh(kit, ctx) {
  const pts = ccw(D.b.cmh.p);
  const r = block(kit, ctx, pts, {
    h: 11, wall: C('#c9c3b6'), trim: C('#8e9296'), parapet: 0.8, roof: C('#8b8985'),
    win: { style: 'ribbon', fl: 3.9, g0: 1.2, h: 1.8 },
  });
  const MAS = C('#b5876a'), GL = C('#3f5a68');
  const a1 = ob([11748, 8158], [11797, 8141], 12), a2 = ob([11797, 8141], [11833, 8096], 12);
  for (const o of [a1, a2]) {
    const t = tower(kit, ctx, o, 23, { wall: MAS, trim: C('#e3ddd2'), parapet: 1.0, roof: C('#7e7b76'), glass: GL,
      win: { style: 'curtain', sp: 1.6, fl: 4.2, top: 1.0, slab: C('#e3ddd2') }, frame: C('#c9ccce') }, 11);
    plant(kit, o, t.yTop, 3, Math.round(o.x));
  }
  const old = { x: 11881, z: 8217, hu: 15, hv: 11, ux: 0.785, uz: 0.619 };
  tower(kit, ctx, old, 30, { wall: C('#8d5a44'), trim: C('#d6cdbd'), parapet: 0.8, roof: C('#706c66'),
    win: { style: 'punch', sp: 2.6, w: 1.4, h: 1.5, fl: 3.6, sill: C('#d6cdbd') } }, 11);
  const fe = edgeNear(r.E, 11912, 8160, 10);
  if (fe) {
    entrance(kit, ctx, fe.e, fe.t, 9, 3.8, null, { d: 4.5 });
    letters(kit, ctx, fe.e, fe.t, r.yTop - 2.0, 18, 1.4, 'CAMBRIDGE MEMORIAL HOSPITAL', { fg: '#0d5c46', bg: '#f0ede6', k: 0.6 });
  }
  const er = edgeNear(r.E, 11982, 8268);
  if (er) emergency(kit, ctx, er.e, er.t);
  hSign(kit, ctx, 11965, 8150, 0.6, -0.8, 'Cambridge Memorial\nEmergency');
}

// ---------------------------------------------------------------------------------------
// PERIMETER INSTITUTE, 31 Caroline St N
// ---------------------------------------------------------------------------------------
// OSM's outline runs south to Caroline St's walk; the strip south of z -1466
// is the reflecting pool and the terrace (the aerial), the building north of it.
const PI_SPLIT = -1466;
function perimeter(kit, ctx) {
  const BLK = C('#1a1c1f'), BLK2 = C('#2a2d31'), MIR = C('#4f6272'), MIR2 = C('#8fa3b2'), SS = C('#b9bdc0');
  const all = ccw(D.b.pi.p);
  const pts = ccw(clip(all, [0, PI_SPLIT], [0, -1]));
  const r = block(kit, ctx, pts, { h: 15.5, wall: BLK, trim: BLK2, parapet: 0.6, roof: C('#5b5d60') });
  const B = r.B;
  for (const e of r.E) {
    if (e.L < 4) continue;
    const gy = T(e.mx + e.nx * 3, e.mz + e.nz * 3), N = [e.nx, 0, e.nz], top = r.yTop + 0.6;
    if (e.nz < -0.7) {
      // north, over Silver Lake: glass from end to end, the study boxes stacked out of it
      B4(B, e, 0.4, e.L - 0.4, gy + 0.6, top - 0.8, 0.05, N, [MIR, MIR, MIR2, MIR2]);
      for (let t = 0.4; t <= e.L - 0.4; t += 1.8) B4(B, e, t - 0.05, t + 0.05, gy + 0.6, top - 0.8, 0.08, N, BLK2);
      for (let f = 0; f < 3; f++) for (let t = 6 + f * 4.5; t < e.L - 5; t += 13) {
        const y0 = gy + 4.2 + f * 3.8, w = 3.6, d = 1.8;
        B.quad(e.at(t, y0, d), e.at(t + w, y0, d), e.at(t + w, y0 + 3, d), e.at(t, y0 + 3, d), N, U0, [MIR, MIR, MIR2, MIR2]);
        for (const s of [0, w]) B.quad(e.at(t + s, y0, 0), e.at(t + s, y0, d), e.at(t + s, y0 + 3, d), e.at(t + s, y0 + 3, 0), [e.ux, 0, e.uz], U0, BLK);
        B.quad(e.at(t, y0 + 3, 0), e.at(t + w, y0 + 3, 0), e.at(t + w, y0 + 3, d), e.at(t, y0 + 3, d), [0, 1, 0], U0, BLK);
        B.quad(e.at(t, y0, d), e.at(t + w, y0, d), e.at(t + w, y0, 0), e.at(t, y0, 0), [0, -1, 0], U0, BLK2);
      }
    } else if (e.nz > 0.7) {
      // south: the blade facade -- black aluminium fins standing off the wall at
      // a slant, stainless-lined slots of mirror glass between them
      for (let t = 1.2; t < e.L - 1; t += 2.4) {
        const sl = 0.8, y0 = gy - 0.2, y1 = top - 0.2;
        B.quad(e.at(t, y0, 0), e.at(t + sl, y0, 1.4), e.at(t + sl, y1, 1.4), e.at(t, y1, 0), [e.nx * 0.5 - e.ux * 0.86, 0, e.nz * 0.5 - e.uz * 0.86], U0, BLK2);
        B.quad(e.at(t + sl, y0, 1.4), e.at(t, y0, 0), e.at(t, y1, 0), e.at(t + sl, y1, 1.4), [-(e.nx * 0.5 - e.ux * 0.86), 0, -(e.nz * 0.5 - e.uz * 0.86)], U0, BLK);
        const ys = [gy + 1.0, gy + 5.6, gy + 10.0];
        for (let i = 0; i < ys.length; i++) {
          const y = ys[i] + ((t * 7) % 3) * 0.4, hh = i === 0 ? 3.2 : 2.2;
          B4(B, e, t + 0.95, t + 1.85, y - 0.08, y + hh + 0.08, 0.04, N, SS);
          B4(B, e, t + 1.03, t + 1.77, y, y + hh, 0.06, N, [MIR, MIR, MIR2, MIR2]);
        }
      }
    } else {
      // the ends: tall mirror slots
      for (let t = 2; t < e.L - 1.5; t += 4.5) {
        B4(B, e, t - 0.5, t + 0.5, gy + 1, top - 2, 0.04, N, SS);
        B4(B, e, t - 0.42, t + 0.42, gy + 1.08, top - 2.08, 0.06, N, [MIR, MIR, MIR2, MIR2]);
      }
    }
  }
  // the Stephen Hawking Centre's two-storey lantern of mirror glass on the east roof
  const hx = -4250, hz = -1497;
  B.box(hx, r.yTop - 0.2, hz, 28, 4.2, 18, 0, MIR);
  B.box(hx, r.yTop + 4, hz, 28.6, 0.5, 18.6, 0, BLK);
  // the reflecting pool south of the front, its black coping, the bridge to the doors
  const P = ccw(clip(all, [0, PI_SPLIT + 0.8], [0, 1]));
  const py = Math.min(...P.map((q) => T(q[0], q[1]))) + 0.35;
  const W = C('#1d2a33'), CO = C('#3a3c3f');
  const Dd = kit.B(-4270, -1460);
  for (let i = 1; i < P.length - 1; i++) Dd.tri([P[0][0], py, P[0][1]], [P[i][0], py, P[i][1]], [P[i + 1][0], py, P[i + 1][1]], [0, 1, 0], W);
  for (const e of edges(P)) {
    B.quad(e.at(0, py - 0.6, 0.3), e.at(e.L, py - 0.6, 0.3), e.at(e.L, py + 0.15, 0.3), e.at(0, py + 0.15, 0.3), [e.nx, 0, e.nz], U0, CO);
    B.quad(e.at(0, py + 0.15, 0.3), e.at(e.L, py + 0.15, 0.3), e.at(e.L, py + 0.15, -0.2), e.at(0, py + 0.15, -0.2), [0, 1, 0], U0, CO);
  }
  const bx = -4262, b0 = PI_SPLIT, b1 = -1452;
  B.box(bx, py + 0.15, (b0 + b1) / 2, 4.2, 0.3, b1 - b0, Math.PI / 2, C('#6f7275'));
  for (const s of [-1, 1]) B.box(bx + s * 2.05, py + 0.45, (b0 + b1) / 2, 0.08, 1.0, b1 - b0, Math.PI / 2, SS);
  // the name on the south front, cut in the black
  const sf = r.E.filter((e) => e.nz > 0.7).sort((a, b) => b.L - a.L)[0];
  if (sf) letters(kit, ctx, sf, sf.L * 0.3, r.yTop - 1.6, 16, 1.2, 'PERIMETER INSTITUTE', { fg: '#e9ecef', k: 0.66, off: 1.5 });
}

// ---------------------------------------------------------------------------------------
// THE CIGI CAMPUS, 67 Erb St W (KPMB 2011)
// ---------------------------------------------------------------------------------------
// Brick to the streets (the Seagram buildings' brick), three storeys of glass
// round the courtyard (CIGI_COURT, open to the sky: cut out of the roof), the
// auditorium pavilion's green roof (CIGI_GREEN), limestone at the base.
const CIGI_COURT = [[-4142, -1283], [-4123, -1294.6], [-4102, -1261], [-4122.4, -1249]];
const CIGI_GREEN = [[-4109, -1312.6], [-4084.4, -1314.6], [-4077, -1278], [-4100.4, -1275.6]];
function cigi(kit, ctx) {
  const BR = C('#7a4634'), LIME = C('#d6cdb8'), GL = C('#47606c'), FIR = C('#b07a48');
  const pts = ccw(D.b.cigi.p);
  const court = CIGI_COURT.slice();
  const r = block(kit, ctx, pts, {
    h: 13, wall: BR, trim: LIME, parapet: 0.9, roof: C('#7c7a76'), plinth: [1.2, LIME], holes: [court],
    win: { style: 'punch', sp: 2.4, w: 1.1, h: 2.5, fl: 4.1, g0: 1.6, sill: LIME },
  });
  const B = r.B;
  // the courtyard: glass walls facing in, fir mullions; the court's lawn and its trees' place
  const cpts = ccw(court);
  const gy = Math.min(...cpts.map((q) => T(q[0], q[1])));
  for (const e of edges(cpts)) {
    const N = [-e.nx, 0, -e.nz];
    B.quad(e.at(e.L, gy - 0.5, 0), e.at(0, gy - 0.5, 0), e.at(0, r.yTop + 0.9, 0), e.at(e.L, r.yTop + 0.9, 0), N, U0, [GL, GL, shade(GL, 1.5), shade(GL, 1.5)]);
    for (let t = 0.5; t < e.L; t += 2.2) B.quad(e.at(t + 0.08, gy, -0.05), e.at(t - 0.08, gy, -0.05), e.at(t - 0.08, r.yTop, -0.05), e.at(t + 0.08, r.yTop, -0.05), N, U0, FIR);
    for (let y = gy + 4.1; y < r.yTop; y += 4.1) B.quad(e.at(e.L, y - 0.15, -0.05), e.at(0, y - 0.15, -0.05), e.at(0, y + 0.15, -0.05), e.at(e.L, y + 0.15, -0.05), N, U0, FIR);
  }
  const Dd = kit.B(-4122, -1272);
  Dd.tri([cpts[0][0], gy + 0.14, cpts[0][1]], [cpts[1][0], gy + 0.14, cpts[1][1]], [cpts[2][0], gy + 0.14, cpts[2][1]], [0, 1, 0], C('#5a7040'));
  Dd.tri([cpts[0][0], gy + 0.14, cpts[0][1]], [cpts[2][0], gy + 0.14, cpts[2][1]], [cpts[3][0], gy + 0.14, cpts[3][1]], [0, 1, 0], C('#5a7040'));
  // the long water feature down the court's middle
  const m0 = [(cpts[0][0] + cpts[1][0]) / 2, (cpts[0][1] + cpts[1][1]) / 2], m1 = [(cpts[2][0] + cpts[3][0]) / 2, (cpts[2][1] + cpts[3][1]) / 2];
  const wo = ob(m0, m1, 0.9);
  B.box(wo.x, gy - 0.2, wo.z, wo.hu * 1.6, 0.55, 1.8, Math.atan2(wo.uz, wo.ux), C('#3a4a52'));
  // the auditorium pavilion's green roof and its raised clerestory
  const G = CIGI_GREEN;
  B.tri([G[0][0], r.yTop + 0.05, G[0][1]], [G[1][0], r.yTop + 0.05, G[1][1]], [G[2][0], r.yTop + 0.05, G[2][1]], [0, 1, 0], C('#55703c'));
  B.tri([G[0][0], r.yTop + 0.05, G[0][1]], [G[2][0], r.yTop + 0.05, G[2][1]], [G[3][0], r.yTop + 0.05, G[3][1]], [0, 1, 0], C('#55703c'));
  // the name on the Erb St front
  const ef = frontEdge(ctx.city, r.E, /^Erb Street/, 10, 60);
  if (ef) {
    letters(kit, ctx, ef, ef.L / 2, r.base + 9.6, 6, 2.2, 'CIGI', { fg: '#efe9dc', k: 0.8, off: 0.1 });
    letters(kit, ctx, ef, ef.L / 2, r.base + 7.9, Math.min(20, ef.L - 2), 0.8, 'CENTRE FOR INTERNATIONAL GOVERNANCE INNOVATION', { fg: '#efe9dc', k: 0.62, off: 0.1 });
  }
  const cf = frontEdge(ctx.city, r.E, /^Caroline Street/, 10, 60);
  if (cf) letters(kit, ctx, cf, cf.L / 2, r.base + 8.4, Math.min(22, cf.L - 2), 1.0, 'BALSILLIE SCHOOL OF INTERNATIONAL AFFAIRS', { fg: '#efe9dc', k: 0.6, off: 0.1 });
}

// ---------------------------------------------------------------------------------------
// SUN LIFE (the Mutual Life head office), 227 King St S, Waterloo
// ---------------------------------------------------------------------------------------
// The 1912 building (Darling & Pearson; 1921 addition): two storeys of buff
// and yellow Roman brick, grey stone quoins, pedimented windows, the King St
// entrance between paired Ionic columns under a pediment, a balustrade on the
// parapet. On the aerial it is the north-east block with the skylight,
// SUN_FRONT here; the later offices fill the rest of OSM's outline, the tall
// dark one at its west end (SUN_TOWER; its height is an estimate).
const SUN_FRONT = ob([-3335, -690], [-3354, -642], 12.5);
const SUN_TOWER = ob([-3445, -672], [-3400, -652], 14);
function sunLife(kit, ctx) {
  const BUFF = C('#c9ae7c'), STONE = C('#bdb8ad');
  const pts = ccw(D.b.sunlife.p);
  block(kit, ctx, pts, {
    h: 15.5, wall: C('#bfae90'), trim: C('#e7e1d4'), parapet: 0.8, roof: C('#86847f'), glass: C('#3b3127'),
    win: { style: 'punch', sp: 2.6, w: 1.5, h: 1.9, fl: 3.8, g0: 1.4, sill: C('#e7e1d4') },
  });
  const t = tower(kit, ctx, SUN_TOWER, 33, { wall: C('#4a3e33'), trim: C('#8a7a66'), parapet: 1.0, roof: C('#6e6a64'), glass: C('#2b241e'),
    win: { style: 'ribbon', fl: 3.7, h: 2.3 } }, 15.5);
  plant(kit, SUN_TOWER, t.yTop, 3, 9);
  // the 1912 front
  const f = tower(kit, ctx, SUN_FRONT, 11.5, { wall: BUFF, trim: STONE, parapet: 1.3, roof: C('#8a8a86'), cornice: 0.9, plinth: [1.4, STONE],
    glass: C('#2d3438'), frame: C('#efe9dc'), win: { style: 'punch', sp: 3.4, w: 1.5, h: 2.6, fl: 4.6, g0: 1.6, sill: STONE } }, 0);
  const kf = frontEdge(ctx.city, f.E, /^King Street/, 8, 90) || f.E.sort((a, b) => b.L - a.L)[0];
  const B = f.B, N = [kf.nx, 0, kf.nz], gy = T(kf.mx + kf.nx * 3, kf.mz + kf.nz * 3), mid = kf.L / 2;
  // quoins on the corners
  for (const e of f.E) for (const tt of [0.4, e.L - 0.4]) for (let y = gy; y < f.yTop - 0.5; y += 0.9) B4(B, e, tt - 0.45, tt + 0.45, y, y + 0.45, 0.06, [e.nx, 0, e.nz], STONE);
  // the balustrade along the front's parapet
  for (let tt = 0.8; tt < kf.L - 0.6; tt += 0.55) {
    const p = kf.at(tt, f.yTop + 0.1, 0.12);
    B.prism(p[0], p[1], p[2], 0.11, 0.8, 5, STONE);
  }
  B4(B, kf, 0.2, kf.L - 0.2, f.yTop + 0.9, f.yTop + 1.1, 0.14, N, STONE);
  // the entrance: paired Ionic columns either side, the entablature and the pediment
  const COL = C('#e2dccf');
  for (const s of [-1, 1]) for (const k of [2.4, 3.4]) {
    const p = kf.at(mid + s * k, gy, 1.4);
    B.prism(p[0], gy - 0.2, p[2], 0.42, 8.2, 10, COL);
    B.box(p[0], gy + 8.0, p[2], 1.1, 0.4, 1.1, Math.atan2(kf.uz, kf.ux), COL);
  }
  B4(B, kf, mid - 4.2, mid + 4.2, gy + 8.4, gy + 9.6, 2.0, N, COL);
  for (const s of [-1, 1]) B.quad(kf.at(mid + s * 4.2, gy + 8.4, 0), kf.at(mid + s * 4.2, gy + 8.4, 2.0), kf.at(mid + s * 4.2, gy + 9.6, 2.0), kf.at(mid + s * 4.2, gy + 9.6, 0), [kf.ux * s, 0, kf.uz * s], U0, shade(COL, 0.85));
  B.tri(kf.at(mid - 4.4, gy + 9.6, 2.05), kf.at(mid + 4.4, gy + 9.6, 2.05), kf.at(mid, gy + 11.6, 2.05), N, COL);
  B.quad(kf.at(mid - 4.4, gy + 9.6, 2.05), kf.at(mid, gy + 11.6, 2.05), kf.at(mid, gy + 11.6, 0), kf.at(mid - 4.4, gy + 9.6, 0), [0, 0.7, 0], U0, shade(COL, 0.8));
  B.quad(kf.at(mid, gy + 11.6, 2.05), kf.at(mid + 4.4, gy + 9.6, 2.05), kf.at(mid + 4.4, gy + 9.6, 0), kf.at(mid, gy + 11.6, 0), [0, 0.7, 0], U0, shade(COL, 0.8));
  B4(B, kf, mid - 1.3, mid + 1.3, gy, gy + 4.2, 0.1, N, C('#5a3c22'));       // the oak doors
  letters(kit, ctx, kf, mid, gy + 9.0, 7.6, 0.7, 'MUTUAL LIFE', { fg: '#5c5446', font: SERIF, wt: '700', k: 0.7, off: 2.06 });
  // the Sun Life sign on the lawn toward King
  const sx = kf.mx + kf.nx * 16, sz = kf.mz + kf.nz * 16, sy = T(sx, sz);
  const SB = kit.B(sx, sz);
  SB.box(sx, sy - 0.3, sz, 5.4, 1.0, 0.7, Math.atan2(kf.uz, kf.ux), STONE);
  const m = text(ctx.atlas, 5.0, 1.0, 'Sun Life', { bg: '#ffffff', fg: '#e8a300', k: 0.72, px: 26 });
  hang(kit.grp(sx, sz), m, sx, sy + 1.2, sz, kf.nx, kf.nz, 0.36);
  SB.box(sx, sy + 0.6, sz, 5.2, 1.2, 0.6, Math.atan2(kf.uz, kf.ux), C('#ffffff'));
  ctx.solids.push({ x: sx, z: sz, hw: 2.8, hd: 0.4, rot: Math.atan2(kf.uz, kf.ux), y0: sy - 1, y1: sy + 1.8 });
}

// ---------------------------------------------------------------------------------------
// MANULIFE, 500 King St N, Waterloo
// ---------------------------------------------------------------------------------------
function manulife(kit, ctx) {
  const PRE = C('#d9d2c2'), GL = C('#3e5751');
  const pts = ccw(D.b.manulife.p);
  const r = block(kit, ctx, pts, {
    h: 16, wall: PRE, trim: C('#efe9dc'), parapet: 1.0, roof: C('#8c8a85'), glass: GL, plinth: [1.0, C('#a59d8e')],
    win: { style: 'ribbon', fl: 3.9, g0: 1.4, h: 2.2, top: 1.4 },
  });
  // the curved east end's terraces: glass from the second floor up
  const ee = edgeNear(r.E, -4068, -4345, 4);
  // the sign on the parking face (north)
  const nf = r.E.filter((e) => e.nz < -0.4).sort((a, b) => b.L - a.L)[0];
  if (nf) {
    const m = ctx.atlas.panel(14, 2.4, 22, (q, W, H) => {
      q.clearRect(0, 0, W, H);
      q.fillStyle = '#00a758'; q.font = `800 ${H * 0.72}px ${SANS}`; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.fillText('Manulife', W / 2 + H * 0.4, H * 0.55, W * 0.8);
      // the stylised leaf
      q.beginPath(); q.moveTo(W * 0.08, H * 0.85); q.quadraticCurveTo(W * 0.1, H * 0.1, W * 0.2, H * 0.15); q.quadraticCurveTo(W * 0.18, H * 0.75, W * 0.08, H * 0.85); q.fill();
    });
    onWall(kit, nf, nf.L * 0.62, r.yTop - 2.2, m, 0.1);
  }
  if (ee) entrance(kit, ctx, ee.e, ee.t, 8, 4, null, { d: 4 });
}

// ---------------------------------------------------------------------------------------
// BLACKBERRY, University Ave E (A 2300, B 2200, C 2240, D)
// ---------------------------------------------------------------------------------------
function blackberry(kit, ctx) {
  const PAN = C('#c8ccd1'), GL = C('#34495a'), GL2 = C('#567d9c');
  for (const k of ['bbA', 'bbB', 'bbC', 'bbD']) {
    const b = D.b[k];
    const lv = b.lv || 4, pts = ccw(b.p);
    const r = block(kit, ctx, pts, {
      h: lv * 4.1 + 0.8, wall: PAN, trim: C('#e9ebee'), parapet: 1.1, roof: C('#9d9fa2'), glass: GL, frame: C('#d9dcdf'),
      win: { style: 'curtain', sp: 1.5, fl: 4.1, g0: 0.4, top: 1.2, slab: C('#aeb4ba') },
    });
    // the long faces get a white fin frame every bay; the ends stay panel
    for (const e of r.E) {
      if (e.L < 30) continue;
      const N = [e.nx, 0, e.nz], gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
      for (let t = 4.5; t < e.L - 4; t += 9) B4(r.B, e, t - 0.35, t + 0.35, gy, r.yTop + 1.1, 0.25, N, C('#eef0f2'));
    }
    if (k === 'bbA' || k === 'bbB') {
      const f = frontEdge(ctx.city, r.E, /^University Avenue/, 15, 120) || r.E.sort((a, b) => b.L - a.L)[0];
      const m = ctx.atlas.panel(13, 2.2, 22, (q, W, H) => {
        q.clearRect(0, 0, W, H);
        q.fillStyle = '#111111';
        // the seven-dot logo
        const s = H * 0.17;
        for (const [a, c] of [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [2, 0.5]]) {
          q.beginPath(); q.ellipse(H * 0.2 + a * s * 1.5, H * 0.24 + c * s * 1.3, s * 0.6, s * 0.48, 0, 0, Math.PI * 2); q.fill();
        }
        q.font = `800 ${H * 0.58}px ${SANS}`; q.textAlign = 'left'; q.textBaseline = 'middle';
        q.fillText('BlackBerry', H * 1.05, H * 0.55, W - H * 1.1);
      });
      onWall(kit, f, f.L / 2, r.yTop - 1.4, m, 0.3);
    }
  }
}

// ---------------------------------------------------------------------------------------
// DOWNTOWN KITCHENER'S CIVIC BUILDINGS
// ---------------------------------------------------------------------------------------

// The Waterloo Region Courthouse (85 Frederick St, NORR 2013): seven storeys
// of pale stone and custom concrete with zinc above, the three-storey glazed
// atrium along its Frederick St front behind a one-storey glass entrance.
function courthouse(kit, ctx) {
  const ST = C('#d3cbbb'), ZN = C('#7b8186'), GL = C('#5c7684'), GL2 = C('#9fb5bf');
  const pts = ccw(D.b.court.p);
  const r = block(kit, ctx, pts, {
    h: 30, wall: ST, trim: C('#eae5da'), parapet: 1.0, roof: C('#8a8986'), glass: C('#2f3e48'),
    win: { style: 'punch', sp: 2.2, w: 1.0, h: 2.6, fl: 4.0, g0: 13.5, sill: C('#eae5da') },
  });
  const B = r.B;
  // the zinc top two floors
  for (const e of r.E) {
    if (e.L < 4) continue;
    B4(B, e, 0, e.L, r.yTop - 7.6, r.yTop + 1.0, 0.03, [e.nx, 0, e.nz], ZN);
    for (let t = 1; t < e.L - 1; t += 3.2) B4(B, e, t, t + 2.0, r.yTop - 6.6, r.yTop - 4.6, 0.06, [e.nx, 0, e.nz], C('#2f3e48'));
  }
  // the atrium front on Frederick St: glass three storeys, then the entrance pavilion
  const ff = frontEdge(ctx.city, r.E, /^Frederick Street/, 15, 60) || r.E.sort((a, b) => b.L - a.L)[0];
  const N = [ff.nx, 0, ff.nz], gy = T(ff.mx + ff.nx * 3, ff.mz + ff.nz * 3);
  B4(B, ff, 1.0, ff.L - 1.0, gy - 0.3, gy + 13, 0.08, N, [GL, GL, GL2, GL2]);
  for (let t = 1.0; t <= ff.L - 1; t += 2.0) B4(B, ff, t - 0.06, t + 0.06, gy - 0.3, gy + 13, 0.12, N, C('#c9cdd0'));
  for (let y = gy + 4.4; y < gy + 13; y += 4.3) B4(B, ff, 1, ff.L - 1, y - 0.1, y + 0.1, 0.12, N, C('#c9cdd0'));
  entrance(kit, ctx, ff, ff.L / 2, 14, 4.6, null, { d: 6 });
  letters(kit, ctx, ff, ff.L / 2, gy + 15.2, Math.min(24, ff.L - 2), 1.1, 'WATERLOO REGION COURTHOUSE', { fg: '#2c3338', k: 0.66, off: 0.1 });
  letters(kit, ctx, ff, ff.L / 2, gy + 14.0, Math.min(24, ff.L - 2), 0.7, 'PALAIS DE JUSTICE DE LA RÉGION DE WATERLOO', { fg: '#2c3338', k: 0.62, off: 0.1 });
}

// The Region of Waterloo's headquarters (150 Frederick St): eight storeys of
// brick, and on OSM's outline the round council chamber at its east end, under
// a copper cone (the aerial's orange disc).
function regionHq(kit, ctx) {
  const BR = C('#9a5a42'), TR = C('#ddd5c6');
  const all = ccw(D.b.regionhq.p);
  // the drum is the outline's arc round (-761, -80); the slab is the rest
  const RX = -761.3, RZ = -80.6, RR = 14.2;
  const slab = ccw(all.filter((q) => Math.hypot(q[0] - RX, q[1] - RZ) > RR + 1.5));
  const r = block(kit, ctx, slab, {
    h: 30, wall: BR, trim: TR, parapet: 1.0, roof: C('#837f79'), glass: C('#30404a'),
    win: { style: 'ribbon', fl: 3.6, g0: 4.5, h: 1.9, top: 1.6 }, plinth: [4.0, C('#5f6a70')],
  });
  const B = r.B, base = lowest([[RX, RZ]]);
  B.prism(RX, base - 1, RZ, RR, 12, 24, TR);
  for (let i = 0; i < 24; i += 2) {
    const a = (i / 24) * Math.PI * 2;
    B.box(RX + Math.cos(a) * (RR + 0.05), base + 1.5, RZ + Math.sin(a) * (RR + 0.05), 2.2, 8.5, 0.12, -a + Math.PI / 2, C('#36505e'));
  }
  B.prism(RX, base + 11, RZ, RR + 0.4, 0.8, 24, C('#5f6a70'));
  B.cone(RX, base + 11.8, RZ, RR + 0.3, 6.5, 24, C('#b0714a'));
  ctx.solids.push({ x: RX, z: RZ, r: RR, y0: base - 1, y1: base + 12 });
  const ff = frontEdge(ctx.city, r.E, /^Frederick Street/, 12, 60);
  if (ff) {
    letters(kit, ctx, ff, ff.L / 2, r.base + 5.6, Math.min(16, ff.L - 2), 1.3, 'Region of Waterloo', { fg: '#ffffff', k: 0.72, off: 0.1 });
    entrance(kit, ctx, ff, ff.L / 2, 8, 3.6, null, { d: 3.5 });
  }
}

// Kitchener station (126 Weber St W): the 1897 Grand Trunk station, one
// storey of red brick on a stone base, round-arched windows, the hipped slate
// roof with its deep eaves on brackets; the platform canopy on the track side.
// The 1925 freight shed beside it is the Goderich-Exeter Railway's office.
function station(kit, ctx) {
  const BR = C('#9c4632'), ST = C('#b5ab98'), SL = C('#3f4246');
  const pts = ccw(D.b.station.p);
  const o = obb(pts);
  const r = block(kit, ctx, pts, {
    h: 5.2, wall: BR, trim: ST, parapet: 0, plinth: [0.9, ST], roof: SL, glass: C('#2c3236'), frame: C('#e7e1d2'),
    win: { style: 'punch', sp: 3.2, w: 1.3, h: 2.3, fl: 4.5, g0: 1.2, sill: ST, arch: shade(BR, 0.8) },
  });
  hipRoof(r.B, o, r.yTop, 4.2, SL, 1.6);
  // the brackets under the eaves
  for (const e of r.E) for (let t = 1; t < e.L; t += 2.4) {
    const p = e.at(t, r.yTop - 0.9, 0.5);
    r.B.box(p[0], p[1], p[2], 0.2, 0.9, 1.0, Math.atan2(e.uz, e.ux), C('#5a3a28'));
  }
  // KITCHENER on the ends, VIA and GO by the doors
  const ends = r.E.filter((e) => e.L < 16 && e.L > 6);
  for (const e of ends) letters(kit, ctx, e, e.L / 2, r.yTop - 1.0, Math.min(7, e.L - 1), 0.7, 'KITCHENER', { fg: '#ffffff', bg: '#1d1d1d', k: 0.66, off: 0.1 });
  const wf = frontEdge(ctx.city, r.E, /^Weber Street/, 10, 80);
  if (wf) {
    onWall(kit, wf, wf.L * 0.3, r.yTop - 1.5, text(ctx.atlas, 2.2, 0.9, 'VIA', { bg: '#ffd700', fg: '#1a1a1a', k: 0.7 }), 0.1);
    onWall(kit, wf, wf.L * 0.7, r.yTop - 1.5, text(ctx.atlas, 2.0, 0.9, 'GO', { bg: '#00853f', fg: '#ffffff', k: 0.7 }), 0.1);
  }
  // the platform canopy on the far side from Weber: posts and a shallow roof
  const tf = r.E.filter((e) => e.L > 20).sort((a, b) => (wf ? (a.nx * wf.nx + a.nz * wf.nz) - (b.nx * wf.nx + b.nz * wf.nz) : 0))[0];
  if (tf) {
    const gy = T(tf.mx + tf.nx * 3, tf.mz + tf.nz * 3), N = [tf.nx, 0, tf.nz], cy = gy + 3.6, dep = 4.2;
    for (let t = 1.5; t < tf.L; t += 5) {
      const p = tf.at(t, gy, dep - 0.4);
      r.B.prism(p[0], gy - 0.2, p[2], 0.12, cy - gy + 0.2, 6, C('#2f3a40'));
      ctx.solids.push({ x: p[0], z: p[2], r: 0.18, y0: gy - 1, y1: cy });
    }
    r.B.quad(tf.at(-2, cy, 0), tf.at(tf.L + 2, cy, 0), tf.at(tf.L + 2, cy - 0.4, dep + 0.4), tf.at(-2, cy - 0.4, dep + 0.4), [N[0] * 0.2, 0.98, N[2] * 0.2], U0, C('#2f3a40'));
    r.B.quad(tf.at(-2, cy - 0.4, dep + 0.4), tf.at(tf.L + 2, cy - 0.4, dep + 0.4), tf.at(tf.L + 2, cy - 0.12, 0), tf.at(-2, cy - 0.12, 0), [0, -1, 0], U0, C('#8a9298'));
  }
  // the freight shed
  const fr = block(kit, ctx, ccw(D.b.freight.p), {
    h: 5.0, wall: C('#8f4733'), trim: ST, parapet: 0.6, cornice: 0.4, roof: C('#4d4b48'), glass: C('#2c3236'),
    win: { style: 'punch', sp: 4.0, w: 1.6, h: 2.0, fl: 4.5, g0: 1.2, sill: ST },
  });
  const sf = fr.E.sort((a, b) => b.L - a.L)[0];
  letters(kit, ctx, sf, sf.L / 2, fr.yTop - 0.9, Math.min(16, sf.L - 2), 0.6, 'GODERICH-EXETER RAILWAY', { fg: '#f2ece0', k: 0.66, off: 0.1 });
}

// ---------------------------------------------------------------------------------------
// the extra
// ---------------------------------------------------------------------------------------
export function buildLandmarks2(ctx) {
  if (!D) return;
  const t0 = performance.now(), kit = new LmKit(ctx.atlas);
  // trees keep off what is drawn here
  for (const k of Object.keys(D.b)) { const o = obb(D.b[k].p); if (o && ctx.clearAt) ctx.clearAt.push([o.x, o.z, Math.min(o.hu, o.hv) + 3]); }
  const run = (name, fn) => {
    const s0 = ctx.solids.length;
    try { fn(kit, ctx); STATS.built.push(name); } catch (e) { console.warn('kwlandmarks2 ' + name + ': ' + (e.stack || e.message)); STATS.err.push(name + ': ' + e.message); }
    STATS[name] = { solids: ctx.solids.length - s0, atlasY: ctx.atlas.y + ctx.atlas.row };
  };
  run('grh', grh);
  run('stmary', stMary);
  run('freeport', freeport);
  run('cmh', cmh);
  run('perimeter', perimeter);
  run('cigi', cigi);
  run('sunlife', sunLife);
  run('manulife', manulife);
  run('blackberry', blackberry);
  run('courthouse', courthouse);
  run('regionhq', regionHq);
  run('station', station);
  kit.flush(ctx);
  STATS.tris = kit.tris;
  STATS.ms = Math.round(performance.now() - t0);
  STATS.atlas = { y: ctx.atlas.y + ctx.atlas.row, full: ctx.atlas.full || 0 };
}

/** The map's marks and hellos (as kwsights.js sightsMap's). */
export function landmarks2Map() {
  if (!D) return [];
  const m = ([x, z], label, name, hello) => ({ x, z, kind: 'lm', label, name, near: false, hello });
  const at = (k) => centroid(D.b[k].p);
  return [
    m(at('grh'), 'Hospital', 'WRHN @ Midtown', 'WRHN @ Midtown, 835 King St W — Grand River Hospital until 2025; emergency, and the cancer centre on Green St'),
    m(at('stmary'), false, "WRHN @ Queen's Blvd", "WRHN @ Queen's Blvd, 911 Queen's Blvd — St. Mary's General (1924) and its 1962 tower"),
    m(at('freeport'), false, 'WRHN @ Chicopee', 'WRHN @ Chicopee, 3570 King St E — the old Freeport hospital above the Grand'),
    m(at('cmh'), 'Hospital', 'Cambridge Memorial Hospital', 'Cambridge Memorial Hospital, 700 Coronation Blvd — the 2020 wing bends along the Grand'),
    m(at('pi'), false, 'Perimeter Institute', 'Perimeter Institute for Theoretical Physics, 31 Caroline St N (2004) — black blades on Silver Lake'),
    m(at('cigi'), false, 'CIGI Campus', 'The CIGI Campus, 67 Erb St W (KPMB 2011) — and the Balsillie School, on the old Seagram site'),
    m(at('sunlife'), false, 'Sun Life', 'Sun Life, 227 King St S — the 1912 Mutual Life head office, paired columns and a pediment'),
    m(at('manulife'), false, 'Manulife', "Manulife's Canadian head office, 500 King St N"),
    m(at('bbA'), false, 'BlackBerry', 'BlackBerry, 2200-2300 University Ave E — where the phones came from'),
    m(at('court'), false, 'Waterloo Region Courthouse', 'The Waterloo Region Courthouse, 85 Frederick St (2013)'),
    m(at('regionhq'), false, 'Region of Waterloo', 'Region of Waterloo headquarters, 150 Frederick St — the council chamber is the drum'),
    m(at('station'), 'Station', 'Kitchener station', 'Kitchener station, 126 Weber St W (1897) — VIA to Toronto and Sarnia, GO to Union'),
  ];
}

export function landmarks2Stats() { return STATS; }
