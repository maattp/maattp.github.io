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
//   - ROUND THREE (below): KCI's 1924 front on King St W; Cambridge City
//     Hall (2008); Laurel Dam's embankment, intake tower and outlet channel;
//     the Inn of Waterloo; Delta Waterloo; the Hespeler library's glass box.
//   - ROUND FOUR (below): Market Square's rotunda, clock tower and skywalk;
//     the Crowne Plaza; St. Mary's and St. Peter's churches; the Waterloo
//     County Gaol and the Governor's House; the Canadian Clay and Glass
//     Gallery; the Waterloo Memorial Recreation Complex; Galt Arena Gardens.
//     `window.__noLm4 = true` before boot turns round four alone off.
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
import * as G from './geo.js';
import {
  block, frontEdge, text, onWall, pyramid, hipRoof, barrel, B4, nearestEdge, entrance, sightsData, clockFace,
} from './kwsights.js';

const STATS = { skipped: 0, built: [], err: [] };
const ROUND4 = ['mktsq', 'skywalk', 'crowne', 'stmaryrc', 'stpeter', 'gaol', 'govhouse', 'claygl', 'wmrc', 'galtarena'];
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
  // window.__noLm4: round four off (its footprints stay the importer's boxes), for a before/after
  if (typeof window !== 'undefined' && window.__noLm4) { D = { b: { ...D.b } }; for (const k of ROUND4) delete D.b[k]; }
  for (const k of Object.keys(D.b)) STATS.skipped += flatten(city, D.b[k].p);
  // the King St skywalk is one of kwsights' `king` blocks (building=bridge):
  // meshKing would draw it on the road; it is drawn up in the air here instead
  const S = sightsData();
  if (D.b.skywalk && S.king) {
    const [sx, sz] = centroid(D.b.skywalk.p);
    const keep = S.king.filter((r) => { const [cx, cz] = centroid(r.p); return Math.hypot(cx - sx, cz - sz) > 4; });
    STATS.kingTaken = S.king.length - keep.length;
    S.king.length = 0; S.king.push(...keep);
  }
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

// =======================================================================================
// ROUND THREE
// =======================================================================================

/** The edge of `E` whose outward normal is nearest (nx, nz), of at least minL. */
function facing(E, nx, nz, minL = 6) {
  let best = null, bd = -2;
  for (const e of E) { if (e.L < minL) continue; const d = e.nx * nx + e.nz * nz; if (d > bd) { bd = d; best = e; } }
  return best;
}
/** An oriented box with one long face on the edge a..b of a footprint, pushed `out` m past it, `dep` deep inward (`inx`, `inz` the inward normal). */
function obOn(a, b, dep, inx, inz, out = 0.3, endOut = 0) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
  const c = (dep / 2 - out);
  return { x: (a[0] + b[0]) / 2 + inx * c, z: (a[1] + b[1]) / 2 + inz * c, hu: L / 2 + endOut, hv: dep / 2, ux, uz };
}

// ---------------------------------------------------------------------------------------
// KITCHENER-WATERLOO COLLEGIATE (KCI), 787 King St W
// ---------------------------------------------------------------------------------------
// From the King St photograph (Wikimedia Commons "Kci bldg.JPG") and the aerial:
// the 1924 front (Wikipedia: built 1922-23, opened as KCI on April 4, 1924) on the
// west half of the King frontage -- buff stone, tall windows between pilasters
// two storeys high, an attic band, a low copper hipped roof gone green; the red
// brick classroom blocks behind it; the four-storey red brick east wing whose
// blank end faces King; the 1903-04 wing with its hipped roof in the middle
// of the complex (the aerial's dark Y). The terrace wall and steps along King
// are the street's. Heights: OSM's 4 levels for the east wing; the rest estimated.
const KCI_FRONT = [[-2769.4, -455.9], [-2728.9, -436.6]];   // OSM footprint corners on King
const KCI_EAST = [[-2694.35, -421.65], [-2711.0, -383.0]];  // the east wing's axis, King end first
const KCI_OLD = [[-2743.8, -380.5], [-2736.5, -358.1]];     // the 1903-04 wing's axis
function kci(kit, ctx) {
  const BR = C('#94523d'), BR2 = C('#a3614a'), STONE = C('#cdbf9f'), ST2 = C('#e0d6bf'), CU = C('#6f9c8a'), GL = C('#2a3238');
  const pts = ccw(D.b.kci.p);
  const r = block(kit, ctx, pts, {
    h: 12.5, wall: BR, trim: ST2, parapet: 0.7, roof: C('#7b7872'), glass: GL,
    win: { style: 'punch', sp: 3.2, w: 2.0, h: 1.9, fl: 3.9, g0: 1.3, sill: ST2 },
  });
  // the 1903-04 wing's hipped roof
  hipRoof(r.B, ob(KCI_OLD[0], KCI_OLD[1], 6.2), r.yTop + 0.7, 3.6, C('#6a4c3d'), 0.4);
  // the four-storey east wing; its King end is blank brick
  const ea = KCI_EAST[0], eb = KCI_EAST[1], eu = [eb[0] - ea[0], eb[1] - ea[1]], el = Math.hypot(eu[0], eu[1]);
  const EW = ob([ea[0] - eu[0] / el * 0.3, ea[1] - eu[1] / el * 0.3], eb, 10.5);
  const ew = tower(kit, ctx, EW, 16.5, { wall: BR2, trim: ST2, parapet: 0.8, roof: C('#77736d'), glass: GL,
    win: { style: 'punch', sp: 3.4, w: 2.4, h: 1.9, fl: 3.9, g0: 1.2, sill: ST2, minL: 25 } }, 0);
  plant(kit, EW, ew.yTop, 2, 4);
  // the 1924 front: inward normal of the King edge
  const [a, b] = KCI_FRONT, fu = [b[0] - a[0], b[1] - a[1]], fl = Math.hypot(fu[0], fu[1]);
  const inx = -fu[1] / fl, inz = fu[0] / fl;   // (-0.43, 0.90): into the site, away from King
  const FO = obOn(a, b, 13, inx, inz, 0.3, 0.3);
  const f = tower(kit, ctx, FO, 15, { wall: STONE, trim: ST2, parapet: 0, roof: C('#8a8780'), plinth: [1.3, C('#b3a684')] }, 0);
  hipRoof(f.B, FO, f.yTop, 2.4, CU, 0.5);
  const B = f.B;
  for (const e of f.E) {
    if (e.L < 6 || e.nx * inx + e.nz * inz > 0.5) continue;    // not the inner face
    const N = [e.nx, 0, e.nz], gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2), top = f.yTop;
    // the attic band and cornice
    B4(B, e, -0.3, e.L + 0.3, top - 2.2, top, 0.32, N, ST2);
    B4(B, e, -0.3, e.L + 0.3, top - 2.5, top - 2.2, 0.22, N, shade(ST2, 0.8));
    // tall glass between pilasters, three storeys, with spandrels
    const sp = 3.3, n = Math.floor((e.L - 1.6) / sp), pad = (e.L - n * sp) / 2;
    for (let i = 0; i <= n; i++) B4(B, e, pad + i * sp - 0.42, pad + i * sp + 0.42, gy + 1.3, top - 2.5, 0.26, N, ST2);
    for (let i = 0; i < n; i++) {
      const t0 = pad + i * sp + 0.62, t1 = pad + (i + 1) * sp - 0.62;
      B4(B, e, t0, t1, gy + 1.8, top - 3.0, 0.05, N, [GL, GL, shade(GL, 1.6), shade(GL, 1.6)]);
      for (const y of [gy + 5.2, gy + 9.0]) B4(B, e, t0, t1, y - 0.5, y + 0.3, 0.08, N, shade(STONE, 0.92));
      B4(B, e, t0 + (t1 - t0) / 2 - 0.05, t0 + (t1 - t0) / 2 + 0.05, gy + 1.8, top - 3.0, 0.09, N, ST2);
    }
  }
  const kf = facing(f.E, -inx, -inz, 20);
  if (kf) {
    const gy = T(kf.mx + kf.nx * 3, kf.mz + kf.nz * 3);
    // the central doorway: a stone surround, oak doors, and the school's name on the attic
    B4(B, kf, kf.L / 2 - 3.2, kf.L / 2 + 3.2, gy - 0.3, gy + 5.4, 0.4, [kf.nx, 0, kf.nz], ST2);
    B4(B, kf, kf.L / 2 - 2.0, kf.L / 2 + 2.0, gy, gy + 3.6, 0.45, [kf.nx, 0, kf.nz], C('#4c3423'));
    letters(kit, ctx, kf, kf.L / 2, f.yTop - 1.1, Math.min(34, kf.L - 4), 0.95, 'KITCHENER-WATERLOO COLLEGIATE AND VOCATIONAL SCHOOL', { fg: '#5f5646', font: SERIF, wt: '700', k: 0.62, off: 0.36 });
  }
  // the east wing's door on its west side by King
  const wd = edgeNear(ew.E, -2712, -420, 10);
  if (wd) entrance(kit, ctx, wd.e, Math.min(wd.e.L - 6, 8), 5, 3.2, null, { d: 3 });
}

// ---------------------------------------------------------------------------------------
// CAMBRIDGE CITY HALL, 50 Dickson St (Diamond Schmitt 2008)
// ---------------------------------------------------------------------------------------
// From tboake.com's photographs of the building as it opened (2008) and the
// aerial: four storeys (BD+C: 85,000 sf, LEED Gold); a base of rough-faced grey
// stone with fritted glass, silver aluminium and ribbon glazing above; on the
// south front, toward the civic square and the 1858 Galt Town Hall, horizontal
// sunshades stood out from the wall on posts and the main entrance under an
// overhang; a framed bay standing out of the north elevation over the parking;
// the skylit atrium (the aerial's glass grid) and the vegetated roof on the
// southern wing. Height and colours estimated.
const CCH_SKY = [13175, 10169, 21, 8];        // the atrium's skylight on the aerial (x, z, w, d)
const CCH_CLER = [13211, 10169, 31, 3];       // the glazed strip down the east wing
const CCH_GREEN = [[13148.3, 10180.6], [13196.0, 10181.6], [13196.1, 10192.6], [13148.1, 10191.4]];
function cambridgeHall(kit, ctx) {
  const ALU = C('#b3b7b9'), ALU2 = C('#d6d9da'), STONE = C('#c6c2b8'), GL = C('#3b4e59'), FRIT = C('#7d8e96');
  const pts = ccw(D.b.cch.p);
  const r = block(kit, ctx, pts, {
    h: 17.5, wall: ALU, trim: ALU2, parapet: 0.6, roof: C('#8d8c88'), glass: GL, plinth: [4.4, STONE],
    win: { style: 'ribbon', fl: 4.1, g0: 4.9, h: 2.6, top: 1.0 },
  });
  const B = r.B;
  for (const e of r.E) {
    if (e.L < 6) continue;
    const N = [e.nx, 0, e.nz], gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    // the ground floor: fritted glass in the stone, stone piers
    B4(B, e, 0.8, e.L - 0.8, gy + 0.7, gy + 3.7, 0.08, N, [FRIT, FRIT, GL, GL]);
    for (let t = 0.8; t <= e.L - 0.8; t += 6) B4(B, e, t - 0.4, t + 0.4, gy - 0.2, gy + 4.4, 0.14, N, STONE);
    // the south: sunshades on posts, a metre out
    if (e.nz > 0.7 && e.L > 12) {
      for (let t = 1; t <= e.L - 1; t += 4.5) B4(B, e, t - 0.1, t + 0.1, gy + 4.4, r.yTop + 0.4, 0.95, N, ALU2);
      for (let f = 0; f < 3; f++) for (let k = 0; k < 4; k++) {
        const y = gy + 5.3 + f * 4.1 + k * 0.62;
        B4(B, e, 0.6, e.L - 0.6, y, y + 0.16, 1.0, N, ALU2);
        B.quad(e.at(0.6, y, 0.6), e.at(e.L - 0.6, y, 0.6), e.at(e.L - 0.6, y, 1.0), e.at(0.6, y, 1.0), [0, -1, 0], U0, shade(ALU2, 0.6));
      }
    }
  }
  // the north bay: a deep aluminium frame round a curtain of glass
  const nf = facing(r.E, 0, -1, 30);
  if (nf) {
    const gy = T(nf.mx + nf.nx * 2, nf.mz + nf.nz * 2), N = [nf.nx, 0, nf.nz], t0 = nf.L / 2 - 9, t1 = nf.L / 2 + 9, y0 = gy + 4.4, y1 = r.yTop + 0.6, d = 1.6;
    B4(B, nf, t0 + 0.6, t1 - 0.6, y0, y1 - 0.6, 1.2, N, [GL, GL, shade(GL, 1.5), shade(GL, 1.5)]);
    for (let t = t0 + 0.6 + 1.6; t < t1 - 0.6; t += 1.6) B4(B, nf, t - 0.05, t + 0.05, y0, y1 - 0.6, 1.25, N, ALU2);
    for (let y = y0 + 4.1; y < y1 - 1; y += 4.1) B4(B, nf, t0 + 0.6, t1 - 0.6, y - 0.12, y + 0.12, 1.25, N, ALU2);
    for (const [a0, a1] of [[t0, t0 + 0.6], [t1 - 0.6, t1]]) B4(B, nf, a0, a1, y0 - 0.4, y1, d, N, ALU2);
    B4(B, nf, t0, t1, y1 - 0.6, y1, d, N, ALU2);
    B4(B, nf, t0, t1, y0 - 0.4, y0, d, N, ALU2);
    for (const t of [t0, t1]) B.quad(nf.at(t, y0 - 0.4, 0), nf.at(t, y0 - 0.4, d), nf.at(t, y1, d), nf.at(t, y1, 0), [nf.ux * (t === t0 ? -1 : 1), 0, nf.uz * (t === t0 ? -1 : 1)], U0, ALU);
    B.quad(nf.at(t0, y1, 0), nf.at(t1, y1, 0), nf.at(t1, y1, d), nf.at(t0, y1, d), [0, 1, 0], U0, ALU);
  }
  // the atrium's skylight and the east wing's glazed strip
  const SKY = C('#8aa3b0');
  for (const [x, z, w, dd] of [CCH_SKY, CCH_CLER]) {
    B.box(x, r.yTop + 0.4, z, w, 1.3, dd, 0, SKY);
    for (let k = -w / 2 + 2.5; k < w / 2; k += 2.5) B.box(x + k, r.yTop + 1.65, z, 0.12, 0.1, dd + 0.05, 0, ALU2);
  }
  // the green roof on the southern wing
  const G0 = CCH_GREEN, gy = r.yTop + 0.08, GR = C('#5e7a3d');
  B.tri([G0[0][0], gy, G0[0][1]], [G0[2][0], gy, G0[2][1]], [G0[1][0], gy, G0[1][1]], [0, 1, 0], GR);
  B.tri([G0[0][0], gy, G0[0][1]], [G0[3][0], gy, G0[3][1]], [G0[2][0], gy, G0[2][1]], [0, 1, 0], GR);
  // the main entrance under the overhang on the square, and the name in the stone
  const sf = facing(r.E, 0, 1, 30);
  if (sf) {
    const gy2 = T(sf.mx + sf.nx * 3, sf.mz + sf.nz * 3);
    entrance(kit, ctx, sf, sf.L * 0.62, 10, 4.0, null, { d: 4.5, can: C('#9ea3a6') });
    letters(kit, ctx, sf, sf.L * 0.24, gy2 + 3.0, 13, 0.85, 'CAMBRIDGE CITY HALL', { fg: '#33393d', k: 0.66, off: 0.16 });
  }
}

// ---------------------------------------------------------------------------------------
// LAUREL DAM (the Grand River Conservation Authority, 1968): the reservoir's dam
// ---------------------------------------------------------------------------------------
// OSM way 1284678747 (waterway=dam, material=soil, height 5.6, start_date 1968)
// maps the earth embankment's outline; the aerial shows the crest road a few
// metres in from the reservoir's edge, rip-rap down to the water, the long
// grass slope behind, and the control structure: a concrete intake tower out
// in the water at OSM's jog in the outline (its gate hoists in the house on
// top), the walkway bridge to the crest, and the concrete outlet channel down
// the back of the dam. The game's terrain is the 40 m DEM, which smooths the
// embankment away: the reservoir (wlevel.png, 90.44 here) floods the crest's
// line and ~15 m past it. So the embankment is built here as a surface of its
// own over OSM's outline, its crest 1.6 m over the water (its height over the
// river below is the DEM's, not 5.6 m) -- it covers the water east of the
// crest; the outlet channel is cut out of it, and the reservoir shows in the
// channel up to where the field ends.
const DAM = [
  [-7689.6, -3397.2], [-7696.5, -3394.0], [-7717.1, -3421.4], [-7770.5, -3525.6], [-7777.1, -3536.1], [-7777.1, -3542.2],
  [-7787.4, -3538.8], [-7789.1, -3542.5], [-7790.9, -3546.7], [-7783.0, -3551.8], [-7786.8, -3556.6], [-7789.5, -3560.0],
  [-7793.2, -3566.9], [-7810.5, -3616.6], [-7779.6, -3590.9], [-7759.6, -3566.0], [-7750.9, -3551.0], [-7720.1, -3469.3],
  [-7709.4, -3440.1],
];
const DAM_LAKE = DAM.slice(1, 14);                 // the reservoir's side, south-east to north
const DAM_TOWER = [-7793.5, -3543.0];              // the intake tower, in the water off the jog
const DAM_IN = [0.885, -0.463];                    // across the dam, lake to river (the aerial's bridge)
const DAM_OUT = { a: [-7774.5, -3552.2], u: [0.92, -0.39], L: 24, hw: 4.4 };   // the outlet channel
function segDist(P, x, z, closed) {
  let d = Infinity;
  const n = closed ? P.length : P.length - 1;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return d;
}
function laurelDam(kit, ctx) {
  const P = ccw(DAM);
  const wl = G.waterLevel(-7800, -3545) || 90.44, CREST = wl + 1.6;
  const CON = C('#b9b6ae'), CON2 = C('#9a978f'), GRASS = C('#5f7a3c'), GRAV = C('#a39a87'), RIP = C('#7a7770'), STEEL = C('#3f5a50');
  const O = DAM_OUT, ou = O.u, ov = [-ou[1], ou[0]];
  const inChute = (x, z) => {
    const s = (x - O.a[0]) * ou[0] + (z - O.a[1]) * ou[1], l = (x - O.a[0]) * ov[0] + (z - O.a[1]) * ov[1];
    return s > -0.5 && s < O.L + 0.5 && Math.abs(l) < O.hw + 0.25;
  };
  // the embankment's surface on a 2 m grid over OSM's outline -- and, behind it,
  // over the reservoir's field where it runs on below the dam (ground just over it)
  const M = 36;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of P) { x0 = Math.min(x0, q[0] - M); x1 = Math.max(x1, q[0] + M); z0 = Math.min(z0, q[1] - M); z1 = Math.max(z1, q[1] + M); }
  const S = 2, nx = Math.ceil((x1 - x0) / S) + 1, nz = Math.ceil((z1 - z0) / S) + 1;
  const Y = new Float32Array(nx * nz), IN = new Uint8Array(nx * nz), K = new Uint8Array(nx * nz);
  // which side of the reservoir's edge a point is on (> 0: the dam's and the river's)
  const side = (x, z) => {
    let bd = Infinity, sg = 0;
    for (let i = 0; i < DAM_LAKE.length - 1; i++) {
      const a = DAM_LAKE[i], b = DAM_LAKE[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
      const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
      if (d < bd) { bd = d; sg = dx * (z - a[1]) - dz * (x - a[0]); }
    }
    return sg;
  };
  let covered = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * S, z = z0 + j * S, k = j * nx + i;
    const dEdge = segDist(P, x, z, true), inside = inPoly(P, x, z);
    const t = T(x, z);
    Y[k] = t;
    if (!inside) {
      if (dEdge > M) continue;
      const w = G.waterLevel(x, z);
      if (dEdge > 1.5 && (w > t - 0.3) && side(x, z) > 0) { Y[k] = Math.max(t + 0.04, w + 0.25); IN[k] = 2; covered++; }
      if (dEdge > 1.5) continue;
    } else IN[k] = 1;
    const dW = segDist(DAM_LAKE, x, z, false), dIn = inside ? dEdge : 0;
    // up the rip-rap from the lake bed, the crest ~4.5 m wide, the long slope down behind it
    let y = Math.max(t + 0.04, Math.min(CREST, t + dW * 0.5, CREST - Math.max(0, dW - 12.5) * 0.17, t + dIn * 0.6 + 0.04));
    if (side(x, z) > 0 && dW > 3) { const w = G.waterLevel(x, z); if (w > t - 0.3) y = Math.max(y, w + 0.25); }
    Y[k] = y;
    if (inside) K[k] = y >= CREST - 0.02 && dW < 13 ? 1 : (y < wl + 0.7 && dW < 9 ? 2 : 0);
  }
  const Bd = kit.B(-7770, -3520), col = [GRASS, GRAV, RIP];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const k = j * nx + i, ks = [k, k + 1, k + nx + 1, k + nx];
    if (!ks.some((q) => IN[q])) continue;
    const cx = x0 + (i + 0.5) * S, cz = z0 + (j + 0.5) * S;
    if (inChute(cx, cz)) continue;
    const v = ks.map((q) => [x0 + (q % nx) * S, Y[q], z0 + Math.floor(q / nx) * S]);
    // the normal of the cell, from its diagonals
    const ax = v[2][0] - v[0][0], ay = v[2][1] - v[0][1], az = v[2][2] - v[0][2], bx = v[3][0] - v[1][0], by = v[3][1] - v[1][1], bz = v[3][2] - v[1][2];
    let n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    if (n[1] < 0) n = n.map((q) => -q);
    const nl = Math.hypot(...n) || 1;
    Bd.quad(v[0], v[1], v[2], v[3], [n[0] / nl, n[1] / nl, n[2] / nl], U0, ks.map((q) => col[K[q]]));
  }
  STATS.damCover = covered;
  // the outlet channel: concrete floor and walls stepping down the slope, the headwall at the crest
  const at = (s, l, y) => [O.a[0] + ou[0] * s + ov[0] * l, y, O.a[1] + ou[1] * s + ov[1] * l];
  const ground = (s) => { const p = at(s, 0, 0); return T(p[0], p[2]); };
  const floorY = (s) => Math.min(wl - 0.9, ground(s) - 0.9);
  const wallTop = (s) => Math.max(ground(s) + 1.1, CREST + 0.3 - s * 0.075);
  const Bc = kit.B(O.a[0], O.a[1]);
  for (let s = 0; s < O.L; s += 2) {
    const s1 = Math.min(O.L, s + 2), f0 = floorY(s), f1 = floorY(s1);
    Bc.quad(at(s, -O.hw, f0), at(s, O.hw, f0), at(s1, O.hw, f1), at(s1, -O.hw, f1), [0, 1, 0], U0, CON2);
    for (const side of [-1, 1]) {
      const l = side * O.hw, lo = side * (O.hw + 0.45), t0 = wallTop(s), t1 = wallTop(s1);
      const nIn = [-ov[0] * side, 0, -ov[1] * side], nOut = [ov[0] * side, 0, ov[1] * side];
      Bc.quad(at(s, l, f0 - 0.3), at(s1, l, f1 - 0.3), at(s1, l, t1), at(s, l, t0), nIn, U0, CON);
      Bc.quad(at(s1, lo, f1 - 2), at(s, lo, f0 - 2), at(s, lo, t0), at(s1, lo, t1), nOut, U0, CON);
      Bc.quad(at(s, l, t0), at(s1, l, t1), at(s1, lo, t1), at(s, lo, t0), [0, 1, 0], U0, shade(CON, 1.1));
      const m = at((s + s1) / 2, side * (O.hw + 0.22), 0);
      ctx.solids.push({ x: m[0], z: m[2], hw: (s1 - s) / 2 + 0.1, hd: 0.3, rot: Math.atan2(ou[1], ou[0]), y0: f0 - 1, y1: Math.max(t0, t1) });
    }
    if (s1 >= O.L) for (const side of [-1, 1]) {
      const l = side * O.hw, lo = side * (O.hw + 0.45), t1 = wallTop(s1);
      Bc.quad(at(s1, l, f1 - 0.3), at(s1, lo, f1 - 0.3), at(s1, lo, t1), at(s1, l, t1), [ou[0], 0, ou[1]], U0, CON);
    }
  }
  // the headwall: across the channel's head under the crest, the two conduits' mouths
  {
    const f0 = floorY(0), top = CREST + 0.2, w = O.hw + 0.45;
    Bc.quad(at(0, w, f0 - 0.3), at(0, -w, f0 - 0.3), at(0, -w, top), at(0, w, top), [ou[0], 0, ou[1]], U0, CON);
    Bc.quad(at(0, -w, top), at(0, w, top), at(-1.2, w, top), at(-1.2, -w, top), [0, 1, 0], U0, shade(CON, 1.1));
    for (const l of [-2, 2]) Bc.quad(at(0.04, l + 1.3, f0 + 0.1), at(0.04, l - 1.3, f0 + 0.1), at(0.04, l - 1.3, f0 + 2.3), at(0.04, l + 1.3, f0 + 2.3), [ou[0], 0, ou[1]], U0, C('#1d2224'));
    // a railing along its top
    for (let l = -w; l <= w + 0.01; l += w / 3) { const p = at(-0.3, l, top); Bc.box(p[0], top, p[2], 0.08, 1.05, 0.08, 0, STEEL); }
    const p0 = at(-0.3, 0, top + 1.0);
    Bc.box(p0[0], p0[1], p0[2], 0.07, 0.07, w * 2, Math.atan2(ou[1], ou[0]), STEEL);
  }
  // the intake tower out in the water, the gate house on it, the bridge to the crest
  const [tx, tz] = DAM_TOWER, rot = Math.atan2(DAM_IN[1], DAM_IN[0]), bed = T(tx, tz);
  const Bt = kit.B(tx, tz);
  Bt.box(tx, bed - 1, tz, 5.6, CREST + 0.6 - (bed - 1), 5.6, rot, CON);
  Bt.box(tx, CREST + 0.6, tz, 6.2, 0.35, 6.2, rot, shade(CON, 1.08));
  Bt.box(tx, CREST + 0.95, tz, 4.4, 2.5, 4.0, rot, C('#d4d0c3'));
  pyramid(Bt, tx, CREST + 3.45, tz, 2.6, 1.1, rot, C('#4f5a55'));
  // the trash rack on its lake face, the stains of the water line
  const la = [-DAM_IN[0], -DAM_IN[1]], lv = [-la[1], la[0]];
  for (let k = -2; k <= 2; k += 0.4) {
    const x = tx + la[0] * 2.85 + lv[0] * k, z = tz + la[1] * 2.85 + lv[1] * k;
    Bt.box(x, wl - 3, z, 0.06, 4.2, 0.12, rot, STEEL);
  }
  Bt.box(tx, wl - 0.25, tz, 5.7, 0.5, 5.7, rot, C('#6f6c62'));
  const bA = [tx + DAM_IN[0] * 3.1, tz + DAM_IN[1] * 3.1], bB = [tx + DAM_IN[0] * 15.5, tz + DAM_IN[1] * 15.5];
  const BL = Math.hypot(bB[0] - bA[0], bB[1] - bA[1]), bm = [(bA[0] + bB[0]) / 2, (bA[1] + bB[1]) / 2];
  Bt.box(bm[0], CREST + 0.35, bm[1], BL, 0.3, 1.8, rot, CON2);
  for (const s of [-1, 1]) {
    const x = bm[0] + DAM_IN[1] * -0.85 * s, z = bm[1] + DAM_IN[0] * 0.85 * s;
    Bt.box(x, CREST + 1.55, z, BL, 0.07, 0.07, rot, STEEL);
    for (let k = -BL / 2; k <= BL / 2 + 0.01; k += BL / 6) Bt.box(x + DAM_IN[0] * k, CREST + 0.65, z + DAM_IN[1] * k, 0.07, 0.95, 0.07, rot, STEEL);
  }
  ctx.solids.push({ x: tx, z: tz, hw: 3.1, hd: 3.1, rot, y0: bed - 1, y1: CREST + 3.5 });
  STATS.dam = { wl: +wl.toFixed(2), crest: +CREST.toFixed(2) };
}
// ---------------------------------------------------------------------------------------
// THE INN OF WATERLOO (the Waterloo Inn), 475 King St N
// ---------------------------------------------------------------------------------------
// Read off the aerial alone (no photograph of it found): two-storey wings round
// a glass-roofed court, the four-storey block on its east side, the lobby wing
// toward the drive and the roundabout. Every colour and height estimated.
const INN_EAST = [[-4452, -4247], [-4441.5, -4291]];
const INN_COURT = [[-4497, -4271], [-4463, -4263]];
function innOfWaterloo(kit, ctx) {
  const BR = C('#87604a'), CREAM = C('#e3ddcf'), TR = C('#efe9dc');
  const r = block(kit, ctx, ccw(D.b.inn.p), {
    h: 7.6, wall: BR, trim: TR, parapet: 0.6, roof: C('#6c6862'), glass: C('#2c3236'),
    win: { style: 'punch', sp: 3.6, w: 1.9, h: 1.5, fl: 3.5, g0: 1.0, sill: TR },
  });
  const EO = ob(INN_EAST[0], INN_EAST[1], 12.5);
  const e = tower(kit, ctx, EO, 13.6, { wall: CREAM, trim: TR, parapet: 0.7, roof: C('#a9a59c'), glass: C('#2f3a40'),
    win: { style: 'punch', sp: 3.4, w: 2.3, h: 1.6, fl: 3.3, g0: 1.1, sill: TR } }, 0);
  plant(kit, EO, e.yTop, 3, 11);
  // the court's glass roof
  hipRoof(r.B, ob(INN_COURT[0], INN_COURT[1], 9.5), r.yTop + 0.7, 3.4, C('#7f9aa6'), 0);
  // the lobby doors on the drive, and the name over them
  const dr = edgeNear(r.E, -4421, -4224, 8);
  if (dr) entrance(kit, ctx, dr.e, dr.t, 8, 3.4, null, { d: 5, can: C('#2f4a3a') });
  const ef = facing(e.E, 1, 0, 20);
  if (ef) letters(kit, ctx, ef, ef.L / 2, e.yTop - 1.6, Math.min(20, ef.L - 3), 1.6, 'THE INN OF WATERLOO', { fg: '#2f4a3a', font: SERIF, wt: '700', k: 0.66, off: 0.1 });
}

// ---------------------------------------------------------------------------------------
// DELTA WATERLOO, 110 Erb St W (Delta Hotels, opened September 2014)
// ---------------------------------------------------------------------------------------
// Nine storeys (OSM; Delta's release), the slab along Erb read off the aerial
// (its pale roof, its glass faces); no photograph found, so its colours, its
// frame and the wordmark's place are estimated.
function deltaWaterloo(kit, ctx) {
  const r = block(kit, ctx, ccw(D.b.delta.p), {
    h: 31, wall: C('#d9dad7'), trim: C('#f1f1ee'), parapet: 1.0, roof: C('#c9c9c4'), glass: C('#28343e'), frame: C('#e9e9e6'),
    plinth: [4.6, C('#3a4046')], win: { style: 'grid', sp: 3.1, fl: 3.3, g0: 5.6, h: 2.3, top: 1.4 },
  });
  plant(kit, obb(r.pts), r.yTop, 4, 7);
  const ef = frontEdge(ctx.city, r.E, /^Erb Street/, 12, 60) || facing(r.E, 0.5, 0.86, 12);
  if (ef) {
    const gy = T(ef.mx + ef.nx * 3, ef.mz + ef.nz * 3);
    B4(r.B, ef, 0.6, ef.L - 0.6, gy + 0.4, gy + 4.2, 0.08, [ef.nx, 0, ef.nz], [C('#3f5462'), C('#3f5462'), C('#6f8794'), C('#6f8794')]);
    entrance(kit, ctx, ef, ef.L / 2, 8, 3.8, null, { d: 4.5, can: C('#2a2d30') });
    const m = ctx.atlas.panel(12, 1.9, 22, (q, W, H) => {
      q.clearRect(0, 0, W, H);
      q.fillStyle = '#1b1d1f';
      q.beginPath(); q.moveTo(H * 0.12, H * 0.86); q.lineTo(H * 0.5, H * 0.14); q.lineTo(H * 0.88, H * 0.86); q.closePath(); q.fill();
      q.fillStyle = '#d9dad7';
      q.beginPath(); q.moveTo(H * 0.36, H * 0.72); q.lineTo(H * 0.5, H * 0.44); q.lineTo(H * 0.64, H * 0.72); q.closePath(); q.fill();
      q.fillStyle = '#1b1d1f'; q.font = `700 ${H * 0.56}px ${SANS}`; q.textAlign = 'left'; q.textBaseline = 'middle';
      q.fillText('DELTA HOTELS', H * 1.1, H * 0.54, W - H * 1.2);
    });
    onWall(kit, ef, ef.L / 2, r.yTop - 1.6, m, 0.12);
  }
}

// ---------------------------------------------------------------------------------------
// IDEA EXCHANGE HESPELER, 5 Tannery St E (Kongats Architects, 2006)
// ---------------------------------------------------------------------------------------
// Canadian Architect (Awards of Excellence 2004, "Redressing Urbanity") and
// Doors Open: the 1980s addition came down, the 1923 Carnegie library was kept
// as the "book vault" and the whole was wrapped in a two-storey box of glass
// whose ceramic frit is woven round it in bands (the town's textile mills), a
// "ship in a bottle". The box is OSM's footprint; the old library's roof is the
// square the aerial shows in its south-east half. Opaque here, so the brick
// inside is not seen: the frit pattern is drawn, its weave estimated.
const HESP_OLD = [[13370.3, 2354.9], [13380.5, 2343.4], [13388.3, 2350.0], [13378.1, 2362.7]];
function hespeler(kit, ctx) {
  const GL = C('#8fa6a5'), GL2 = C('#c5d3d0'), FRIT = C('#eef0ec'), MUL = C('#5c6366');
  const r = block(kit, ctx, ccw(D.b.hesp.p), { h: 8.6, wall: GL, trim: C('#d9dcda'), parapet: 0.5, roof: C('#d2d2cc') });
  const B = r.B;
  for (const e of r.E) {
    if (e.L < 4) continue;
    const N = [e.nx, 0, e.nz], gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    B4(B, e, 0.1, e.L - 0.1, gy - 0.2, r.yTop + 0.3, 0.03, N, [GL, GL, GL2, GL2]);
    for (let t = 0; t <= e.L + 1e-3; t += 1.5) B4(B, e, t - 0.04, t + 0.04, gy - 0.2, r.yTop + 0.3, 0.06, N, MUL);
    // the frit: white bands that thicken and thin along the wall, woven
    for (let y = gy + 2.6; y < r.yTop; y += 0.42) for (let t = 0; t < e.L - 0.01; t += 1.5) {
      const ph = Math.sin((e.mx + e.mz + t) * 0.31 + y * 0.9);
      const hh = 0.04 + 0.16 * (0.5 + 0.5 * ph);
      B4(B, e, t + 0.05, Math.min(e.L, t + 1.5) - 0.05, y, y + hh, 0.05, N, FRIT);
    }
  }
  // the old library's roof inside, a step up
  const O = HESP_OLD, ry = r.yTop + 0.45, RC = C('#bdbdb6');
  B.tri([O[0][0], ry, O[0][1]], [O[1][0], ry, O[1][1]], [O[2][0], ry, O[2][1]], [0, 1, 0], RC);
  B.tri([O[0][0], ry, O[0][1]], [O[2][0], ry, O[2][1]], [O[3][0], ry, O[3][1]], [0, 1, 0], RC);
  // the doors off the parking. No lettering: this cell has no sign cluster
  // (kw.js buildSigns' 'kw' group), and a name would be a draw of its own.
  const de = edgeNear(r.E, 13374, 2332, 8);
  if (de) entrance(kit, ctx, de.e, de.t, 5, 3.2, null, { d: 2.5, can: C('#4a5054') });
}

// =======================================================================================
// ROUND FOUR
// =======================================================================================

/** A gable roof along o's long axis: eaves at y, the ridge `rise` over them; the gable ends in `end` (null: none). */
function gable(B, o, y, rise, col, ov = 0.4, end = null) {
  const { ux, uz } = o, vx = -uz, vz = ux;
  const P = (u, v, yy) => [o.x + ux * u + vx * v, yy, o.z + uz * u + vz * v];
  const hu = o.hu + ov, hv = o.hv + ov, s = Math.hypot(rise, hv), ny = hv / s, nh = rise / s;
  B.quad(P(-hu, -hv, y), P(hu, -hv, y), P(hu, 0, y + rise), P(-hu, 0, y + rise), [-vx * nh, ny, -vz * nh], U0, col);
  B.quad(P(hu, hv, y), P(-hu, hv, y), P(-hu, 0, y + rise), P(hu, 0, y + rise), [vx * nh, ny, vz * nh], U0, col);
  B.quad(P(-hu, -hv, y - 0.02), P(-hu, hv, y - 0.02), P(hu, hv, y - 0.02), P(hu, -hv, y - 0.02), [0, -1, 0], U0, shade(col, 0.5));
  if (end) for (const sg of [-1, 1]) B.tri(P(sg * o.hu, -o.hv, y - 0.05), P(sg * o.hu, o.hv, y - 0.05), P(sg * o.hu, 0, y + rise * o.hv / hv), [ux * sg, 0, uz * sg], end);
}
/** A horizontal disc (a drum's lid). */
function disc(B, x, y, z, r, n, col) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    B.tri([x, y, z], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [0, 1, 0], col);
  }
}
/** A lidded cylinder. */
function cyl(B, x, y, z, r, h, n, col, top = col) { B.prism(x, y, z, r, h, n, col); disc(B, x, y + h, z, r, n, top); }
/** An awning on an edge from t0 to t1: its top on the wall at y, `d` out, dropping 0.8. */
function awning(B, e, t0, t1, y, d, col) {
  B.quad(e.at(t0, y, 0.05), e.at(t1, y, 0.05), e.at(t1, y - 0.8, d), e.at(t0, y - 0.8, d), [e.nx * 0.6, 0.8, e.nz * 0.6], U0, col);
  B.quad(e.at(t0, y - 0.8, d), e.at(t1, y - 0.8, d), e.at(t1, y - 1.05, d), e.at(t0, y - 1.05, d), [e.nx, 0, e.nz], U0, shade(col, 0.8));
  for (const [t, s] of [[t0, -1], [t1, 1]]) B.tri(e.at(t, y, 0.05), e.at(t, y - 0.8, d), e.at(t, y - 0.8, 0.05), [e.ux * s, 0, e.uz * s], shade(col, 0.85));
}
/** An oriented box in a frame: u along `U`, v along its left normal (obPts' sense). */
function obUV(U, u0, u1, v0, v1) {
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  return { x: U[0] * um - U[1] * vm, z: U[1] * um + U[0] * vm, hu: Math.abs(u1 - u0) / 2, hv: Math.abs(v1 - v0) / 2, ux: U[0], uz: U[1] };
}
/** A world point from frame coordinates. */
const atUV = (U, u, v) => [U[0] * u - U[1] * v, U[1] * u + U[0] * v];
/** The faces of an oriented box as edges (block's E), wound like edges(). */
const obEdges = (o) => edges(ccw(obPts(o)));
/** A pointed (lancet) window on an edge: glass with a triangular head, a stone hood. */
function lancet(B, e, t, y0, w, h, glass, stone) {
  const N = [e.nx, 0, e.nz], hh = w * 0.75;
  B4(B, e, t - w / 2 - 0.18, t + w / 2 + 0.18, y0 - 0.25, y0 - 0.05, 0.1, N, stone);
  B4(B, e, t - w / 2, t + w / 2, y0, y0 + h, 0.05, N, glass);
  B.tri(e.at(t - w / 2, y0 + h, 0.05), e.at(t + w / 2, y0 + h, 0.05), e.at(t, y0 + h + hh, 0.05), N, glass);
  B.quad(e.at(t - w / 2 - 0.2, y0 + h, 0.08), e.at(t - w / 2, y0 + h, 0.08), e.at(t, y0 + h + hh, 0.08), e.at(t, y0 + h + hh + 0.25, 0.08), N, U0, stone);
  B.quad(e.at(t + w / 2, y0 + h, 0.08), e.at(t + w / 2 + 0.2, y0 + h, 0.08), e.at(t, y0 + h + hh + 0.25, 0.08), e.at(t, y0 + h + hh, 0.08), N, U0, stone);
}
/** A round window on an edge (a rose), centred at t, y: a stone ring round stained glass. */
function rose(B, e, t, y, r, glass, stone, off = 0.12) {
  const N = [e.nx, 0, e.nz], n = 16;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a, rr, o) => e.at(t + Math.cos(a) * rr, y + Math.sin(a) * rr, o);
    B.tri(p(0, 0, off), p(a0, r, off), p(a1, r, off), N, i % 2 ? glass : shade(glass, 1.5));
    B.quad(p(a0, r, off + 0.02), p(a1, r, off + 0.02), p(a1, r + 0.45, off + 0.02), p(a0, r + 0.45, off + 0.02), N, U0, stone);
  }
}

// ---------------------------------------------------------------------------------------
// MARKET SQUARE (King St E at Frederick) and its skywalk
// ---------------------------------------------------------------------------------------
// From the Commons photographs (2011-2016, "Market Square Shopping Centre -
// Kitchener, ON", "MarketSquare-Frederick&KingStE-Kitchener") and the aerial:
// the mall's corner at King and Frederick is a drum of green-framed glass,
// taller than the two-storey mall, with GoodLife Fitness in red round its top
// and MARKET SQUARE over the doors; beside it the square clock tower of green
// glass in a steel frame, a clock on each face under a glass pyramid; the King
// St front is green-framed glass over the storefronts and green awnings; the
// glass skywalk crosses King to the hotel. Heights estimated (OSM: 2 levels).
const MS_DRUM = [-995.0, 307.5, 10.5];        // the rotunda: centre and radius (the outline's arc at the corner)
const MS_CLOCK = [-985.5, 317.5];             // the clock tower, beside the drum on King
function marketSquare(kit, ctx) {
  const BR = C('#7d4535'), GRN = C('#2e6656'), GL = C('#3b6a66'), GL2 = C('#9cc4bb'), WH = C('#e4e2da'), AW = C('#1d5a3a');
  const pts = ccw(D.b.mktsq.p);
  const r = block(kit, ctx, pts, {
    h: 11, wall: BR, trim: C('#d6d0c2'), parapet: 0.8, roof: C('#8c8a85'), glass: GL, plinth: [0.6, C('#55534f')],
    win: { style: 'ribbon', fl: 5.2, g0: 5.6, h: 3.4, top: 1.2 },
  });
  const B = r.B;
  // the King St front: green-framed glass over the shops, green awnings
  const kf = frontEdge(ctx.city, r.E, /^King Street/, 20, 60) || facing(r.E, -0.49, 0.87, 20);
  if (kf) {
    const gy = T(kf.mx + kf.nx * 2, kf.mz + kf.nz * 2), N = [kf.nx, 0, kf.nz];
    B4(B, kf, 1, kf.L - 1, gy + 5.2, r.yTop - 0.5, 0.12, N, [GL, GL, GL2, GL2]);
    for (let t = 1; t <= kf.L - 1 + 1e-3; t += 2.4) B4(B, kf, t - 0.09, t + 0.09, gy + 5.2, r.yTop - 0.5, 0.18, N, GRN);
    B4(B, kf, 1, kf.L - 1, gy + 4.9, gy + 5.2, 0.2, N, GRN);
    B4(B, kf, 1, kf.L - 1, gy + 0.6, gy + 3.2, 0.06, N, [GL, GL, GL2, GL2]);
    for (let t = 3; t + 5 < kf.L - 2; t += 7.5) awning(B, kf, t, t + 5.5, gy + 3.6, 1.5, AW);
  }
  // the rotunda
  const [dx, dz, dr] = MS_DRUM, gy = T(dx, dz), top = gy + 17.5;
  B.prism(dx, gy - 0.5, dz, dr, top - gy + 0.5, 24, GL);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    B.box(dx + Math.cos(a) * (dr + 0.06), gy - 0.4, dz + Math.sin(a) * (dr + 0.06), 0.22, top - gy + 0.4, 0.22, a, GRN);
  }
  for (const y of [gy + 4.2, gy + 9.4, gy + 13.6]) B.prism(dx, y, dz, dr + 0.12, 0.35, 24, GRN);
  B.prism(dx, top, dz, dr + 0.5, 1.8, 24, WH);
  disc(B, dx, top + 1.8, dz, dr + 0.5, 24, C('#a9aaa6'));
  B.cone(dx, top + 1.8, dz, dr * 0.55, 2.2, 16, C('#7fa9a0'));
  ctx.solids.push({ x: dx, z: dz, r: dr, y0: gy - 1, y1: top + 2 });
  // GoodLife Fitness round its top and MARKET SQUARE over the doors, toward the corner
  const ang = Math.atan2(310 - dz, -1003 - dx);
  const gl = ctx.atlas.panel(12, 1.5, 22, (q, W, H) => {
    q.clearRect(0, 0, W, H); q.textAlign = 'center'; q.textBaseline = 'middle';
    q.fillStyle = '#d6232a'; q.font = `italic 800 ${H * 0.62}px ${SANS}`; q.fillText('GoodLife', W * 0.3, H * 0.52, W * 0.55);
    q.font = `800 ${H * 0.52}px ${SANS}`; q.fillText('FITNESS', W * 0.75, H * 0.55, W * 0.42);
  });
  for (const da of [0, 0.75]) {
    const a = ang + da, nx = Math.cos(a), nz = Math.sin(a);
    const m = da ? gl.clone() : gl;
    hang(kit.grp(dx, dz), m, dx + nx * dr, top + 0.9, dz + nz * dr, nx, nz, 0.55);
  }
  {
    const nx = Math.cos(ang), nz = Math.sin(ang);
    const ms = text(ctx.atlas, 7, 0.8, 'MARKET SQUARE', { fg: '#eef2ef', bg: '#2b4d45', k: 0.66 });
    // the entrance: a glass porch and a canopy at the corner
    const px = dx + nx * dr, pz = dz + nz * dr, rot = Math.atan2(nz, nx) + Math.PI / 2;
    B.box(px + nx * 1.0, gy - 0.2, pz + nz * 1.0, 6, 3.3, 2.4, rot, GL2);
    B.box(px + nx * 1.6, gy + 3.3, pz + nz * 1.6, 7.5, 0.4, 3.6, rot, GRN);
    hang(kit.grp(dx, dz), ms, px + nx * 3.4, gy + 4.25, pz + nz * 3.4, nx, nz, 0.02);
  }
  // the clock tower: green glass in a steel frame, a clock on each face, a glass pyramid
  {
    const [cx, cz] = MS_CLOCK, cg = T(cx, cz), H = 29, hs = 2.1;
    const rot = Math.atan2(kf ? kf.uz : 0.49, kf ? kf.ux : 0.87);
    B.box(cx, cg - 0.5, cz, hs * 2 - 0.3, H + 0.5, hs * 2 - 0.3, rot, GL);
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box(cx + (a * c - b * s) * hs, cg - 0.5, cz + (a * s + b * c) * hs, 0.45, H + 0.6, 0.45, rot, GRN);
    for (let y = cg + 3; y < cg + H; y += 3) B.box(cx, y, cz, hs * 2 + 0.2, 0.22, hs * 2 + 0.2, rot, GRN);
    B.box(cx, cg + H, cz, hs * 2 + 0.6, 0.5, hs * 2 + 0.6, rot, GRN);
    pyramid(B, cx, cg + H + 0.5, cz, hs + 0.3, 4.2, rot, C('#5f8f86'));
    const cf = clockFace(ctx.atlas, 2.8, false);
    let first = true;
    for (const [nx, nz] of [[c, s], [-s, c], [-c, -s], [s, -c]]) {
      hang(kit.grp(cx, cz), first ? cf : cf.clone(), cx + nx * hs, cg + H - 2.4, cz + nz * hs, nx, nz, 0.3);
      first = false;
    }
    ctx.solids.push({ x: cx, z: cz, r: hs, y0: cg - 1, y1: cg + H });
  }
  // the skywalk over King St: green-framed glass from the second floor to the hotel
  if (D.b.skywalk) {
    const sp = D.b.skywalk.p, o = obb(sp);
    const sx = o.x, sz = o.z, y0 = T(sx, sz) + 5.4, rot = Math.atan2(o.uz, o.ux), L = o.hu * 2 + 1.2, w = o.hv * 2 + 0.6;
    const Bs = kit.B(sx, sz);
    Bs.box(sx, y0, sz, L, 0.5, w, rot, GRN);
    Bs.box(sx, y0 + 0.5, sz, L - 0.1, 2.6, w - 0.1, rot, GL2);
    Bs.box(sx, y0 + 3.1, sz, L, 0.45, w + 0.3, rot, GRN);
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let k = -L / 2 + 1; k <= L / 2 - 1 + 1e-3; k += 2.2) for (const sd of [-1, 1]) {
      Bs.box(sx + c * k - s * sd * (w / 2), y0 + 0.5, sz + s * k + c * sd * (w / 2), 0.14, 2.6, 0.14, rot, GRN);
    }
  }
}

// ---------------------------------------------------------------------------------------
// CROWNE PLAZA KITCHENER-WATERLOO, 105 King St E (1970; the Delta until 2014)
// ---------------------------------------------------------------------------------------
// From the 2011 Commons photograph up King St from Frederick (then the Delta)
// and the aerial: the hotel's slab along King, beige stucco piers and bands
// framing recessed bays of brown brick with the windows in pairs, five storeys
// over a red-brick ground floor with navy awnings; a square corner tower at
// the Frederick end, a storey higher, under a grey-green standing-seam
// pyramid, the sign on it; a smaller capped tower at the far end; the low
// block behind it (the parking and the ballroom). Nine floors per one listing
// is not what the photograph shows on King: the heights are the photograph's.
const CP_KING = [[-1018.6, 327.7], [-966.5, 357.5]];   // the King face, Frederick end first
function crownePlaza(kit, ctx) {
  const ST = C('#cdb99a'), ST2 = C('#e2d4bb'), BRK = C('#7c3c2c'), BR2 = C('#83503d'), NAVY = C('#1f2c4c'), GL = C('#272d33'), CAP = C('#788781');
  const pts = ccw(D.b.crowne.p);
  block(kit, ctx, pts, {
    h: 9.5, wall: ST, trim: ST2, parapet: 0.8, roof: C('#86837d'), plinth: [4.4, BRK], glass: GL,
    win: { style: 'punch', sp: 3.6, w: 1.5, h: 1.4, fl: 3.2, g0: 5.6, sill: ST2 },
  });
  const [a, b] = CP_KING, L = Math.hypot(b[0] - a[0], b[1] - a[1]), U = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const inx = -U[1], inz = U[0];       // into the block, away from King (south-west)
  const S = obOn(a, b, 16, inx, inz, 0.3, 0);
  const s = tower(kit, ctx, S, 22, { wall: ST, trim: ST2, parapet: 0.9, cornice: 0.6, roof: C('#8a8780'), plinth: [4.6, BRK] }, 0);
  const B = s.B;
  // the bays: brown brick between stucco piers, windows in pairs
  for (const e of s.E) {
    if (e.L < 12) continue;
    const N = [e.nx, 0, e.nz], gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2), sp = 6.2, n = Math.floor((e.L - 2) / sp), pad = (e.L - n * sp) / 2;
    for (let i = 0; i < n; i++) {
      const t0 = pad + i * sp + 0.8, t1 = pad + (i + 1) * sp - 0.8;
      B4(B, e, t0, t1, gy + 5.4, s.yTop - 1.6, 0.04, N, BR2);
      for (let y = gy + 6.0; y + 1.6 < s.yTop - 1.6; y += 3.15) for (const f of [0.27, 0.73]) {
        const t = t0 + (t1 - t0) * f;
        B4(B, e, t - 0.75, t + 0.75, y, y + 1.65, 0.07, N, [GL, GL, shade(GL, 1.7), shade(GL, 1.7)]);
        B4(B, e, t - 0.85, t + 0.85, y - 0.12, y, 0.1, N, ST2);
      }
    }
    // the ground floor's glass and the band over it
    B4(B, e, 1, e.L - 1, gy + 0.5, gy + 3.3, 0.07, N, [GL, GL, shade(GL, 1.6), shade(GL, 1.6)]);
    B4(B, e, 0, e.L, gy + 4.6, gy + 5.4, 0.12, N, ST2);
  }
  // navy awnings along King
  const kf = facing(s.E, -inx, -inz, 30);
  if (kf) for (let t = 9; t + 4 < kf.L - 8; t += 5.2) awning(B, kf, t, t + 4.2, T(kf.mx, kf.mz) + 3.9, 1.4, NAVY);
  // the corner tower at Frederick (the sign) and the small one at the far end
  const T1 = obOn(a, [a[0] + U[0] * 10, a[1] + U[1] * 10], 11, inx, inz, 1.0, 0.6);
  const t1 = tower(kit, ctx, T1, 26, { wall: ST, trim: ST2, parapet: 0, roof: C('#8a8780'), plinth: [4.6, BRK], glass: GL,
    win: { style: 'punch', sp: 2.8, w: 1.4, h: 1.65, fl: 3.15, g0: 6.0, sill: ST2 } }, 0);
  hipRoof(B, T1, t1.yTop, 3.6, CAP, 0.6);
  const bE = [b[0] - U[0] * 7.5, b[1] - U[1] * 7.5];
  const T2 = obOn(bE, b, 8, inx, inz, 0.8, 0.4);
  const t2 = tower(kit, ctx, T2, 24.5, { wall: ST, trim: ST2, parapet: 0, roof: C('#8a8780'), plinth: [4.6, BRK] }, 0);
  pyramid(B, T2.x, t2.yTop, T2.z, Math.max(T2.hu, T2.hv) + 0.5, 3.0, Math.atan2(T2.uz, T2.ux), CAP);
  const sign = (e, w) => {
    const m = ctx.atlas.panel(w, w * 0.3, 22, (q, W, H) => {
      q.clearRect(0, 0, W, H);
      q.fillStyle = '#2b2b5e';
      // the crown
      const cx = W / 2, cw = H * 0.5, cy = H * 0.06;
      q.beginPath(); q.moveTo(cx - cw / 2, cy + H * 0.3); q.lineTo(cx - cw / 2, cy + H * 0.06); q.lineTo(cx - cw / 4, cy + H * 0.18);
      q.lineTo(cx, cy); q.lineTo(cx + cw / 4, cy + H * 0.18); q.lineTo(cx + cw / 2, cy + H * 0.06); q.lineTo(cx + cw / 2, cy + H * 0.3); q.closePath(); q.fill();
      q.font = `600 ${H * 0.36}px ${SERIF}`; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.fillText('CROWNE PLAZA', W / 2, H * 0.68, W * 0.96);
    });
    onWall(kit, e, e.L / 2, t1.yTop - 2.4, m, 0.1);
  };
  const tk = facing(t1.E, -inx, -inz, 6), tf = facing(t1.E, -U[0], -U[1], 6);
  if (tk) sign(tk, Math.min(9, tk.L - 1));
  if (tf) sign(tf, Math.min(9, tf.L - 1));
  // the hotel's doors on King under a canopy
  if (kf) entrance(kit, ctx, kf, kf.L * 0.4, 7, 3.4, null, { d: 2.5, can: NAVY });
}

// ---------------------------------------------------------------------------------------
// ST. MARY OUR LADY OF SEVEN SORROWS, 56 Duke St W (1900-03)
// ---------------------------------------------------------------------------------------
// The Commons photograph of the front (2012) and the City's 1983 designation
// (the exterior walls, the towers, the slate roof, the rose window): red brick
// Neo-Gothic, a Latin cross; the front on Young St with the tall north tower
// (its belfry's paired lancets, four pinnacles) and the shorter south tower,
// the gable between them with the rose window over three pointed doors; the
// slate nave behind, the north porch, the rectory on the south side. The
// plan is OSM's outline in the nave's own frame (u along it, ESE to the front;
// v its left normal): the nave u -1116 to -1069, v 586 to 602.5; the aerial
// shows the towers' octagonal caps at the front corners. Heights estimated.
const SM_U = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
function stMaryChurch(kit, ctx) {
  const BR = C('#a24a33'), ST = C('#d6cdb9'), SL = C('#3e4246'), GL = C('#2c3550'), DOOR = C('#4a2c1e');
  const U = SM_U;
  const nave = obUV(U, -1116.2, -1069.4, 586.0, 602.4);
  const n = tower(kit, ctx, nave, 12.5, { wall: BR, trim: ST, parapet: 0, roof: SL, plinth: [1.0, ST] }, 0);
  gable(n.B, nave, n.yTop, 8.5, SL, 0.5, BR);
  const B = n.B;
  // the nave's lancets
  for (const e of n.E) {
    if (e.L < 30) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    for (let t = 5; t < e.L - 4; t += 5.2) lancet(B, e, t, gy + 3.2, 1.5, 5.0, GL, ST);
    for (let t = 2.6; t < e.L; t += 5.2) B4(B, e, t - 0.35, t + 0.35, gy - 0.4, n.yTop - 0.4, 0.35, [e.nx, 0, e.nz], BR);   // buttresses
  }
  // the north porch's cross gable and the sacristy on the south
  const porch = obUV([-U[1], U[0]], 579.4, 593, 1080.6, 1090);    // u = v, v = -u: its ridge across the nave
  const po = tower(kit, ctx, porch, 9, { wall: BR, trim: ST, parapet: 0, roof: SL, plinth: [1.0, ST] }, 0);
  gable(B, porch, po.yTop, 5, SL, 0.4, BR);
  const sac = obUV(U, -1082, -1073, 602.4, 610.5);
  tower(kit, ctx, sac, 6.5, { wall: BR, trim: ST, parapet: 0.6, roof: SL, plinth: [0.8, ST] }, 0);
  // the towers
  const tw = (v0, v1, h, pin) => {
    const o = obUV(U, -1074.8, -1068.2, v0, v1);
    const t = tower(kit, ctx, o, h, { wall: BR, trim: ST, parapet: 0.8, roof: SL, plinth: [1.0, ST], cornice: 0.5 }, 0);
    for (const e of t.E) {
      const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2), N = [e.nx, 0, e.nz];
      // corner buttresses, stone bands, the belfry's paired lancets
      for (const tt of [0.35, e.L - 0.35]) B4(B, e, tt - 0.35, tt + 0.35, gy - 0.4, t.yTop, 0.3, N, BR);
      for (const y of [gy + 12.6, t.yTop - 8.5]) B4(B, e, -0.05, e.L + 0.05, y, y + 0.35, 0.34, N, ST);
      for (const f of [0.33, 0.67]) lancet(B, e, e.L * f, t.yTop - 7.6, 0.8, 4.4, C('#1e2024'), ST);
      if (h > 30) lancet(B, e, e.L / 2, gy + 14.5, 1.0, 4.0, GL, ST);
    }
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = atUV(U, (-1074.8 - 1068.2) / 2 + a * (o.hu - 0.4), (v0 + v1) / 2 + b * (o.hv - 0.4));
      B.prism(p[0], t.yTop + 0.8, p[1], 0.45, 1.2, 6, ST);
      B.cone(p[0], t.yTop + 2.0, p[1], 0.45, pin, 6, ST);
    }
    pyramid(B, o.x, t.yTop + 0.8, o.z, Math.min(o.hu, o.hv) - 0.9, pin * 0.55, Math.atan2(o.uz, o.ux), SL);
    return t;
  };
  tw(584.6, 591.0, 36, 6.5);       // north: the tall one
  tw(598.0, 603.8, 22, 3.6);       // south
  // the front between them: the rose window, three pointed doors
  const fo = obUV(U, -1070.0, -1068.6, 591.0, 598.0);
  const fe = obEdges(fo).filter((e) => e.nx * U[0] + e.nz * U[1] > 0.9)[0];
  const f = tower(kit, ctx, fo, 12.5, { wall: BR, trim: ST, parapet: 0, roof: SL, plinth: [1.0, ST] }, 0);
  if (fe) {
    const gy = T(fe.mx + fe.nx * 3, fe.mz + fe.nz * 3), N = [fe.nx, 0, fe.nz];
    // the front gable over it
    B.tri(fe.at(-0.2, f.yTop, 0.02), fe.at(fe.L + 0.2, f.yTop, 0.02), fe.at(fe.L / 2, f.yTop + 6.2, 0.02), N, BR);
    B.quad(fe.at(-0.4, f.yTop - 0.1, 0.1), fe.at(fe.L / 2, f.yTop + 6.2, 0.1), fe.at(fe.L / 2, f.yTop + 6.6, 0.1), fe.at(-0.4, f.yTop + 0.3, 0.1), N, U0, ST);
    B.quad(fe.at(fe.L / 2, f.yTop + 6.2, 0.1), fe.at(fe.L + 0.4, f.yTop - 0.1, 0.1), fe.at(fe.L + 0.4, f.yTop + 0.3, 0.1), fe.at(fe.L / 2, f.yTop + 6.6, 0.1), N, U0, ST);
    rose(B, fe, fe.L / 2, gy + 9.2, 2.1, C('#3a4a82'), ST);
    for (const [t, w, h] of [[fe.L / 2, 2.0, 3.2], [fe.L / 2 - 2.4, 1.1, 2.6], [fe.L / 2 + 2.4, 1.1, 2.6]]) {
      lancet(B, fe, t, gy + 0.05, w, h, DOOR, ST);
    }
  }
  // the rectory on the south side: two and a half storeys of brick, a hipped slate roof
  const rec = obUV(U, -1082.6, -1066.0, 610.5, 633.6);
  const rc = tower(kit, ctx, rec, 8.6, { wall: C('#9a5641'), trim: ST, parapet: 0, roof: SL, glass: C('#2a2f33'),
    win: { style: 'punch', sp: 3.0, w: 1.1, h: 1.9, fl: 3.6, g0: 1.2, sill: ST } }, 0);
  hipRoof(B, rec, rc.yTop, 3.4, SL, 0.5);
}

// ---------------------------------------------------------------------------------------
// ST. PETER'S LUTHERAN CHURCH, 49 Queen St N (Kruschen & Dailey, 1966-68)
// ---------------------------------------------------------------------------------------
// The 1960s church that replaced the 1868 one (Doors Open; the Laurier archive),
// from the Commons photograph (2026) on Queen St: a tall nave of brown brick
// with narrow full-height windows, the low brick wings round it, a concrete-
// framed glazed front on Queen, and the open bell tower -- two concrete piers
// joined by bands, louvres at the top, the cross over it. The nave's pitched
// roof is read off the aerial. Heights estimated.
const SP_NAVE = { x: -1008.5, z: 85.5, hu: 22.5, hv: 9.3, ux: Math.cos(0.49), uz: Math.sin(0.49) };
const SP_TOWER = [-1025.5, 74.5];
function stPeters(kit, ctx) {
  const BR = C('#6e4632'), BR2 = C('#7d5139'), CON = C('#cfc9bd'), GL = C('#2a3036'), RF = C('#4c3d34');
  const pts = ccw(D.b.stpeter.p);
  const r = block(kit, ctx, pts, {
    h: 6.5, wall: BR2, trim: CON, parapet: 0.7, roof: C('#7c7872'), glass: GL,
    win: { style: 'punch', sp: 3.4, w: 1.6, h: 1.7, fl: 3.6, g0: 1.2, sill: CON },
  });
  const n = tower(kit, ctx, SP_NAVE, 14.5, { wall: BR, trim: CON, parapet: 0, roof: RF }, 0);
  gable(n.B, SP_NAVE, n.yTop, 3.6, RF, 0.6, BR);
  const B = n.B;
  for (const e of n.E) {
    if (e.L < 30) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    for (let t = 3; t < e.L - 2; t += 3.6) B4(B, e, t - 0.35, t + 0.35, gy + 6.6, n.yTop - 0.8, 0.05, [e.nx, 0, e.nz], [GL, GL, shade(GL, 1.6), shade(GL, 1.6)]);
  }
  // the glazed front on Queen St between concrete fins
  const qf = frontEdge(ctx.city, r.E, /^Queen Street/, 10, 60);
  if (qf) {
    const gy = T(qf.mx + qf.nx * 2, qf.mz + qf.nz * 2), N = [qf.nx, 0, qf.nz];
    const t0 = Math.max(0.5, qf.L / 2 - 8), t1 = Math.min(qf.L - 0.5, qf.L / 2 + 8);
    B4(B, qf, t0, t1, gy + 0.2, r.yTop - 0.4, 0.08, N, [GL, GL, shade(GL, 1.7), shade(GL, 1.7)]);
    for (let t = t0; t <= t1 + 1e-3; t += 2) B4(B, qf, t - 0.2, t + 0.2, gy - 0.3, r.yTop + 0.3, 0.6, N, CON);
    B4(B, qf, t0 - 0.3, t1 + 0.3, r.yTop - 0.5, r.yTop + 0.5, 0.7, N, CON);
  }
  // the bell tower
  const [tx, tz] = SP_TOWER, ty = T(tx, tz) - 0.4, H = 28, rot = Math.atan2(SP_NAVE.uz, SP_NAVE.ux) + Math.PI / 2;
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const sd of [-1, 1]) B.box(tx + c * sd * 1.6, ty, tz + s * sd * 1.6, 0.7, H, 3.0, rot, CON);
  for (let y = ty + 6; y < ty + H - 0.5; y += 5.5) B.box(tx, y, tz, 2.6, 0.5, 3.0, rot, CON);
  B.box(tx, ty + H - 6, tz, 2.5, 5.2, 0.5, rot, C('#3a3a38'));
  B.box(tx, ty + H, tz, 4.0, 0.6, 3.2, rot, CON);
  B.box(tx, ty + H + 0.6, tz, 0.3, 4.6, 0.3, rot, C('#2e2e2e'));
  B.box(tx, ty + H + 3.4, tz, 2.0, 0.3, 0.3, rot, C('#2e2e2e'));
  ctx.solids.push({ x: tx, z: tz, r: 2.0, y0: ty - 1, y1: ty + H });
}

// ---------------------------------------------------------------------------------------
// THE WATERLOO COUNTY GAOL (1853) AND THE GOVERNOR'S HOUSE (1878), 73-77 Queen St N
// ---------------------------------------------------------------------------------------
// The Commons photographs (2009-2026, "Kitchener old gaol and house", "Waterloo
// County Jail and Governor's House") and OSM (the gaol's two-storey stone part,
// its one-level yard; the house's architect and date): the gaol is rubble
// stone, two storeys, small barred windows, a hipped roof; its yard walled in
// stone; the Governor's House beside it on Queen St is buff brick Italianate
// with cream trim, a hipped roof, the square tower on the front under a
// bell-cast mansard, the verandah with its balcony.
const GAOL_STONE = [[-931.0, -10.4], [-918.5, -3.4], [-914.6, -10.4], [-909.8, -7.7], [-907.7, -11.3], [-912.8, -14.2], [-908.6, -21.8], [-920.7, -28.6], [-925.6, -19.9]];
function gaol(kit, ctx) {
  const STN = C('#a1978a'), ST2 = C('#cfc6b4'), SL = C('#4a4c50'), BUFF = C('#c8b48f'), CR = C('#efe7d4'), GL = C('#2a2f33');
  const g = block(kit, ctx, ccw(GAOL_STONE), {
    h: 8.0, wall: STN, trim: ST2, parapet: 0, roof: SL, plinth: [0.8, shade(STN, 0.85)], glass: C('#1f2226'),
    win: { style: 'punch', sp: 3.0, w: 0.9, h: 1.3, fl: 3.8, g0: 1.6, sill: ST2 },
  });
  hipRoof(g.B, obb(GAOL_STONE), g.yTop, 3.2, SL, 0.4);
  // the bars
  for (const e of g.E) {
    if (e.L < 5) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2), n = Math.floor((e.L - 0.8) / 3.0), pad = (e.L - n * 3.0) / 2;
    for (let i = 0; i < n; i++) for (let f = 0; f < 2; f++) for (const k of [-0.25, 0, 0.25]) {
      const t = pad + 3.0 * (i + 0.5) + k, y0 = gy + 1.6 + f * 3.8;
      B4(g.B, e, t - 0.03, t + 0.03, y0, y0 + 1.3, 0.07, [e.nx, 0, e.nz], C('#202020'));
    }
  }
  // the yard's stone walls: every edge of the outline not on the stone house
  const yard = ccw(D.b.gaol.p), B = g.B, gy0 = lowest(yard);
  for (const e of edges(yard)) {
    const ix = e.mx - e.nx * 0.6, iz = e.mz - e.nz * 0.6;
    if (inPoly(GAOL_STONE, ix, iz) && inPoly(GAOL_STONE, e.mx - e.nx * 0.6 + e.ux * 0.4, e.mz - e.nz * 0.6 + e.uz * 0.4)) continue;
    const y1 = T(e.mx, e.mz) + 5.2;
    B.quad(e.at(0, gy0 - 1, 0), e.at(e.L, gy0 - 1, 0), e.at(e.L, y1, 0), e.at(0, y1, 0), [e.nx, 0, e.nz], U0, [shade(STN, 0.8), shade(STN, 0.8), STN, STN]);
    B.quad(e.at(0, gy0 - 1, -0.7), e.at(e.L, gy0 - 1, -0.7), e.at(e.L, y1, -0.7), e.at(0, y1, -0.7), [-e.nx, 0, -e.nz], U0, shade(STN, 0.75));
    B.quad(e.at(0, y1, 0.05), e.at(e.L, y1, 0.05), e.at(e.L, y1, -0.75), e.at(0, y1, -0.75), [0, 1, 0], U0, ST2);
    ctx.solids.push({ x: e.mx - e.nx * 0.35, z: e.mz - e.nz * 0.35, hw: e.L / 2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: gy0 - 1, y1 });
  }
  // the Governor's House
  const hp = ccw(D.b.govhouse.p);
  const h = block(kit, ctx, hp, {
    h: 8.6, wall: BUFF, trim: CR, parapet: 0, cornice: 0.5, roof: SL, plinth: [0.9, C('#9a8f7f')], glass: GL, frame: CR,
    win: { style: 'punch', sp: 2.7, w: 1.0, h: 2.1, fl: 3.7, g0: 1.3, sill: CR, arch: CR },
  });
  hipRoof(h.B, obb(hp), h.yTop, 2.6, SL, 0.7);
  const qf = frontEdge(ctx.city, h.E, /^Queen Street/, 6, 60) || facing(h.E, -0.87, -0.49, 6);
  STATS.govFront = qf && [Math.round(qf.mx), Math.round(qf.mz), +qf.nx.toFixed(2), +qf.nz.toFixed(2)];
  if (qf) {
    const gy = T(qf.mx + qf.nx * 2, qf.mz + qf.nz * 2), N = [qf.nx, 0, qf.nz], tt = qf.L * 0.55;
    // the tower: a storey over the eaves, a bell-cast mansard with iron cresting
    const p = qf.at(tt, 0, 0.6), rot = Math.atan2(qf.uz, qf.ux), top = h.yTop + 3.4;
    h.B.box(p[0], gy - 0.5, p[2], 3.8, top - gy + 0.5, 3.8, rot, BUFF);
    h.B.box(p[0], top - 0.4, p[2], 4.3, 0.5, 4.3, rot, CR);
    pyramid(h.B, p[0], top + 0.1, p[2], 2.3, 2.3, rot, SL);
    h.B.box(p[0], top + 2.3, p[2], 1.8, 0.35, 1.8, rot, C('#262626'));
    const te = obEdges({ x: p[0], z: p[2], hu: 1.9, hv: 1.9, ux: qf.ux, uz: qf.uz }).filter((e) => e.nx * qf.nx + e.nz * qf.nz > 0.9)[0];
    if (te) for (const y of [gy + 1.2, gy + 4.9, h.yTop + 0.8]) for (const k of [-0.6, 0.6]) {
      B4(h.B, te, te.L / 2 + k - 0.32, te.L / 2 + k + 0.32, y, y + 1.9, 0.04, N, GL);
      B4(h.B, te, te.L / 2 + k - 0.42, te.L / 2 + k + 0.42, y - 0.15, y, 0.07, N, CR);
    }
    // the verandah and the balcony over it
    const v0 = Math.max(0.3, tt + 2.4), v1 = Math.min(qf.L - 0.3, v0 + 6.5), vy = gy + 3.4, vd = 2.4;
    h.B.quad(qf.at(v0, vy + 0.3, 0), qf.at(v1, vy + 0.3, 0), qf.at(v1, vy + 0.3, vd), qf.at(v0, vy + 0.3, vd), [0, 1, 0], U0, CR);
    h.B.quad(qf.at(v0, vy, vd), qf.at(v1, vy, vd), qf.at(v1, vy + 0.3, vd), qf.at(v0, vy + 0.3, vd), N, U0, CR);
    h.B.quad(qf.at(v0, vy, 0), qf.at(v1, vy, 0), qf.at(v1, vy, vd), qf.at(v0, vy, vd), [0, -1, 0], U0, shade(CR, 0.7));
    for (let t = v0 + 0.2; t <= v1 - 0.2 + 1e-3; t += (v1 - v0 - 0.4) / 3) {
      const q = qf.at(t, gy - 0.2, vd - 0.2);
      h.B.prism(q[0], q[1], q[2], 0.16, vy - gy + 0.2, 8, CR);
    }
    B4(h.B, qf, v0, v1, vy + 0.3, vy + 1.2, vd - 0.05, N, C('#3c4a3e'));
  }
}

// ---------------------------------------------------------------------------------------
// THE CANADIAN CLAY AND GLASS GALLERY, 25 Caroline St N (Patkau Architects, 1993)
// ---------------------------------------------------------------------------------------
// The Commons photographs ("Canadian Clay and Glass Gallery - Waterloo, ON",
// "Clay and Glass Museum (External Turrent)"), Patkau's project page (brick,
// concrete and wood; daylight from above) and the aerial: a long low block of
// dark red brick, small clerestory windows high on the walls, the white roof;
// down the east side toward Caroline St a long dark timber canopy on squat
// concrete piers (the aerial's brown strip) -- the walk to the doors; CANADIAN
// CLAY & GLASS GALLERY on the brick at its north end; the concrete half-round
// turret by the west wall. Heights estimated.
const CG_CANOPY = -4142.0;     // the canopy's inner edge (x): the outline runs out to it
function clayGlass(kit, ctx) {
  const BR = C('#6f3426'), CON = C('#bdb8ad'), TIM = C('#4a3326'), GL = C('#2b3238');
  const raw = ccw(D.b.claygl.p);
  // the outline to the canopy's inner edge: the canopy is drawn, not a wall
  const pts = raw.map((q) => (q[0] > CG_CANOPY && q[1] > -1458 && q[1] < -1402 ? [CG_CANOPY, q[1]] : q));
  const r = block(kit, ctx, pts, {
    h: 8.2, wall: BR, trim: CON, parapet: 0.5, roof: C('#d4d3cf'), glass: GL,
    win: { style: 'ribbon', fl: 10, g0: 6.3, h: 0.9, top: 0.6 },
  });
  const B = r.B;
  // the canopy: dark timber slats on concrete piers, from the wall out to the old outline
  const z0 = -1455.5, z1 = -1403.5, x0 = CG_CANOPY, x1 = -4135.6, gy = T(-4138.5, -1430), cy = gy + 4.2;
  B.box((x0 + x1) / 2, cy, (z0 + z1) / 2, x1 - x0 + 0.6, 0.45, z1 - z0, 0, TIM);
  for (let z = z0 + 0.6; z < z1; z += 1.2) B.box((x0 + x1) / 2 + 0.3, cy - 0.22, z, x1 - x0, 0.22, 0.14, 0, shade(TIM, 0.8));
  for (let z = z0 + 3; z < z1 - 1; z += 8) {
    cyl(B, x1 - 0.9, gy - 0.4, z, 0.75, cy - gy + 0.4, 10, CON);
    ctx.solids.push({ x: x1 - 0.9, z, r: 0.75, y0: gy - 1, y1: cy });
  }
  // the doors at the north end of the walk
  const de = edgeNear(r.E, -4142, -1446, 6);
  if (de) entrance(kit, ctx, de.e, de.t, 5, 3.0, null, { d: 0.6, can: TIM });
  // the lettering on the north end
  const ne = r.E.filter((e) => e.nz < -0.6 && e.L > 5).sort((p, q) => q.L - p.L)[0];
  if (ne) {
    const g2 = T(ne.mx + ne.nx * 2, ne.mz + ne.nz * 2);
    const pw = Math.min(9, ne.L - 0.6), m = ctx.atlas.panel(pw, pw / 3, 22, (q, W, H) => {
      q.clearRect(0, 0, W, H); q.fillStyle = '#f1ece4'; q.textAlign = 'left'; q.textBaseline = 'middle';
      q.font = `600 ${H * 0.16}px ${SANS}`; q.fillText('CANADIAN', W * 0.04, H * 0.15);
      q.font = `500 ${H * 0.38}px ${SERIF}`; q.fillText('CLAY & GLASS', W * 0.04, H * 0.5, W * 0.92);
      q.font = `600 ${H * 0.16}px ${SANS}`; q.fillText('GALLERY', W * 0.6, H * 0.86);
    });
    onWall(kit, ne, ne.L / 2, g2 + 5.0, m, 0.08);
  }
  // the concrete half-round turret by the west wall
  {
    const tx = -4167.2, tz = -1436, ty = T(tx, tz) - 0.4;
    B.prism(tx, ty, tz, 1.4, 6.8, 12, CON);
    disc(B, tx, ty + 6.8, tz, 1.4, 12, shade(CON, 0.9));
    ctx.solids.push({ x: tx, z: tz, r: 1.4, y0: ty - 1, y1: ty + 6.8 });
  }
}

// ---------------------------------------------------------------------------------------
// THE WATERLOO MEMORIAL RECREATION COMPLEX, 101 Father David Bauer Dr
// ---------------------------------------------------------------------------------------
// The Commons photographs (2025: the aerial over it, the arena inside) and the
// Esri aerial: the arena -- the Waterloo Siskins' -- under a long white barrel
// roof, its ends curved to the arch, a band of glass below it; the pool's wing
// on the east with solar panels on its roof and its glass to the north; the
// older recreation centre on the west with its round end; the curved glass
// entrance between them off the parking. OSM maps the outline (unnamed,
// building=public); the arena is the outline's south rectangle. Heights
// estimated.
const WM_ARENA = [[-4694.3, -1339.5], [-4646.4, -1259.6], [-4592.4, -1292.0]];   // three corners: the west side, then the south end
const WM_SOLAR = { x: -4609, z: -1352, hu: 9, hv: 6.5 };
const WM_DOOR = [-4627, -1381];
function waterlooRec(kit, ctx) {
  const WH = C('#dcddd9'), WH2 = C('#c4c7c4'), GL = C('#3b5560'), GL2 = C('#88a8b0'), RF = C('#e4e5e1');
  const pts = ccw(D.b.wmrc.p);
  const r = block(kit, ctx, pts, {
    h: 9.0, wall: WH2, trim: WH, parapet: 0.8, roof: C('#b9bab6'), glass: GL, plinth: [1.0, C('#8e8b85')],
    win: { style: 'ribbon', fl: 4.5, g0: 1.2, h: 2.2, top: 1.2 },
  });
  // the arena: walls a little proud of the outline, the barrel roof along it
  const [a, b, c] = WM_ARENA, La = Math.hypot(b[0] - a[0], b[1] - a[1]), Lb = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const u = [(b[0] - a[0]) / La, (b[1] - a[1]) / La];
  const o = { x: (a[0] + c[0]) / 2, z: (a[1] + c[1]) / 2, hu: La / 2 + 0.25, hv: Lb / 2 + 0.25, ux: u[0], uz: u[1] };
  const ar = tower(kit, ctx, o, 11.5, { wall: WH, trim: WH, parapet: 0, roof: RF, glass: GL,
    win: { style: 'ribbon', fl: 20, g0: 6.8, h: 2.6, top: 0.8 } }, 0);
  barrel(ar.B, { ...o, hu: o.hu + 0.6, hv: o.hv + 0.4 }, ar.yTop, 7.5, RF, WH, 14);
  for (let k = -o.hu + 6; k < o.hu - 3; k += 8) {
    // the roof's ribs
    barrel(ar.B, { x: o.x + o.ux * k, z: o.z + o.uz * k, hu: 0.12, hv: o.hv + 0.45, ux: o.ux, uz: o.uz }, ar.yTop + 0.05, 7.55, WH2, WH2, 14);
  }
  // the pool wing's solar panels
  const B = r.B, rot = Math.atan2(u[1], u[0]);
  for (let k = -WM_SOLAR.hv; k <= WM_SOLAR.hv; k += 2.6) {
    const x = WM_SOLAR.x - u[1] * k, z = WM_SOLAR.z + u[0] * k;
    B.box(x, r.yTop + 0.9, z, WM_SOLAR.hu * 2, 0.12, 1.7, rot, C('#1f2f4a'));
    B.box(x, r.yTop, z, WM_SOLAR.hu * 2, 0.9, 0.12, rot, C('#77797a'));
  }
  // the curved glass entrance: a glazed drum segment and a canopy
  const [ex, ez] = WM_DOOR, ey = T(ex, ez);
  B.prism(ex, ey - 0.3, ez, 7.5, 8.6, 18, GL2);
  for (let i = 0; i < 18; i++) {
    const aa = (i / 18) * Math.PI * 2;
    B.box(ex + Math.cos(aa) * 7.55, ey - 0.3, ez + Math.sin(aa) * 7.55, 0.16, 8.6, 0.16, aa, WH);
  }
  disc(B, ex, ey + 8.3, ez, 7.9, 18, RF);
  ctx.solids.push({ x: ex, z: ez, r: 7.5, y0: ey - 1, y1: ey + 8.3 });
  const de = edgeNear(r.E, ex, ez - 9, 6);
  if (de) {
    const m = text(ctx.atlas, 16, 1.1, 'WATERLOO MEMORIAL RECREATION COMPLEX', { fg: '#1d3c6e', k: 0.6 });
    onWall(kit, de.e, de.t, r.yTop - 1.4, m, 0.1);
  }
}

// ---------------------------------------------------------------------------------------
// GALT ARENA GARDENS, 98 Shade St, Cambridge (1922)
// ---------------------------------------------------------------------------------------
// The Commons photographs ("Galt Arena Gardens exterior", 2026-06) and the
// aerial: brick walls on a high base of rough limestone, stone piers, tall
// windows; the front on Shade St is the gable end of the arched roof -- a
// curved parapet over it, stepped parapets and stone-capped piers at the
// corners -- with the canopy over the doors; the maroon arched roof along
// the length. One of the oldest arenas still in use in Canada. Heights
// estimated.
function galtArena(kit, ctx) {
  const BR = C('#a35c3d'), LS = C('#bfb39a'), LS2 = C('#d8cfbb'), RF = C('#6a3b3c'), GL = C('#2a3034');
  const pts = ccw(D.b.galtarena.p);
  const o = obb(pts);
  const r = block(kit, ctx, pts, {
    h: 10.0, wall: BR, trim: LS2, parapet: 0, roof: RF, plinth: [2.2, LS], glass: GL,
    win: { style: 'punch', sp: 6.0, w: 2.4, h: 3.2, fl: 10, g0: 4.4, sill: LS2 },
  });
  barrel(r.B, { ...o, hu: o.hu - 0.3, hv: o.hv + 0.4 }, r.yTop, 5.8, RF, BR, 12);
  const B = r.B;
  for (const e of r.E) {
    const N = [e.nx, 0, e.nz], gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    // stone piers, a stone band under the eaves
    const n = Math.max(2, Math.round(e.L / 6));
    for (let i = 0; i <= n; i++) B4(B, e, e.L * i / n - 0.5, e.L * i / n + 0.5, gy - 0.4, r.yTop + (i === 0 || i === n ? 1.6 : 0.3), 0.25, N, LS2);
    B4(B, e, 0, e.L, r.yTop - 0.6, r.yTop, 0.2, N, LS2);
  }
  // the front: the curved parapet over the gable end, the canopy, the name
  const sf = frontEdge(ctx.city, r.E, /^Shade Street/, 30, 60) || facing(r.E, 0.87, -0.5, 30);
  if (sf) {
    const N = [sf.nx, 0, sf.nz], gy = T(sf.mx + sf.nx * 2, sf.mz + sf.nz * 2), half = sf.L / 2, nA = 10;
    for (let k = 0; k < nA; k++) {
      const t0 = (k / nA) * sf.L, t1 = ((k + 1) / nA) * sf.L;
      const y = (t) => r.yTop + 5.8 * Math.sqrt(Math.max(0, 1 - ((t - half) / (half + 0.4)) ** 2)) + 0.6;
      B.quad(sf.at(t0, r.yTop - 0.1, 0.02), sf.at(t1, r.yTop - 0.1, 0.02), sf.at(t1, y(t1), 0.02), sf.at(t0, y(t0), 0.02), N, U0, BR);
      B.quad(sf.at(t0, y(t0), 0.02), sf.at(t1, y(t1), 0.02), sf.at(t1, y(t1) + 0.45, 0.25), sf.at(t0, y(t0) + 0.45, 0.25), N, U0, LS2);
    }
    // tall arched windows in the end, between the piers
    for (const f of [0.3, 0.42, 0.58, 0.7]) B4(B, sf, sf.L * f - 1.2, sf.L * f + 1.2, gy + 4.6, gy + 9.6, 0.06, N, [GL, GL, shade(GL, 1.6), shade(GL, 1.6)]);
    entrance(kit, ctx, sf, half, 12, 3.4, null, { d: 0.4, can: C('#2a2c30') });
    const m = text(ctx.atlas, 13, 1.0, 'GALT ARENA GARDENS', { fg: '#f3efe6', bg: '#2a2c30', k: 0.66 });
    onWall(kit, sf, half, gy + 4.05, m, 3.45);
  }
}

// ---------------------------------------------------------------------------------------
// the extra
// ---------------------------------------------------------------------------------------
export function buildLandmarks2(ctx) {
  if (!D) return;
  const t0 = performance.now(), kit = new LmKit(ctx.atlas);
  // trees keep off what is drawn here
  for (const k of Object.keys(D.b)) { const o = obb(D.b[k].p); if (o && ctx.clearAt) ctx.clearAt.push([o.x, o.z, Math.min(o.hu, o.hv) + 3]); }
  // and off Laurel Dam's embankment
  if (ctx.clearAt) for (let i = 1; i < DAM_LAKE.length; i++) {
    const a = DAM_LAKE[i - 1], b = DAM_LAKE[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t < L; t += 8) ctx.clearAt.push([a[0] + (b[0] - a[0]) * t / L + DAM_IN[0] * 9, a[1] + (b[1] - a[1]) * t / L + DAM_IN[1] * 9, 13]);
  }
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
  // round three
  run('kci', kci);
  run('cambridgehall', cambridgeHall);
  run('laureldam', laurelDam);
  run('inn', innOfWaterloo);
  run('delta', deltaWaterloo);
  run('hespeler', hespeler);
  // round four
  if (D.b.mktsq) {
    run('marketsquare', marketSquare);
    run('crowne', crownePlaza);
    run('stmaryrc', stMaryChurch);
    run('stpeter', stPeters);
    run('gaol', gaol);
    run('claygl', clayGlass);
    run('wmrc', waterlooRec);
    run('galtarena', galtArena);
  }
  kit.flush(ctx);
  STATS.tris = kit.tris;
  STATS.ms = Math.round(performance.now() - t0);
  STATS.atlas = { y: ctx.atlas.y + ctx.atlas.row, full: ctx.atlas.full || 0 };
}

/** The map's marks and hellos (as kwsights.js sightsMap's). */
export function landmarks2Map() {
  if (!D) return [];
  const m = (p, label, name, hello) => (p ? { x: p[0], z: p[1], kind: 'lm', label, name, near: false, hello } : null);
  const at = (k) => (D.b[k] ? centroid(D.b[k].p) : null);
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
    m(at('kci'), false, 'KCI', 'Kitchener-Waterloo Collegiate and Vocational School, 787 King St W — the 1924 front, and the oldest high school in the region'),
    m(at('cch'), false, 'Cambridge City Hall', 'Cambridge City Hall, 50 Dickson St (2008) — behind the 1858 Galt Town Hall, a green roof on top'),
    m(DAM_TOWER, false, 'Laurel Dam', 'Laurel Dam (GRCA, 1968) — the earth dam that holds back Laurel Creek reservoir; the intake tower and its bridge'),
    m(at('inn'), false, 'The Inn of Waterloo', 'The Inn of Waterloo, 475 King St N — the old Waterloo Inn'),
    m(at('hesp'), false, 'Idea Exchange Hespeler', 'Idea Exchange Hespeler, 5 Tannery St E — the 1923 Carnegie library inside a box of fritted glass (Kongats, 2006)'),
    m(at('delta'), false, 'Delta Waterloo', 'Delta Hotels Waterloo, 110 Erb St W (2014) — nine storeys on Erb'),
    m(at('mktsq'), false, 'Market Square', 'Market Square, King St E at Frederick — the glass rotunda, the clock tower and the skywalk over King'),
    m(at('crowne'), false, 'Crowne Plaza', 'Crowne Plaza Kitchener-Waterloo, 105 King St E (1970) — the Delta until 2014'),
    m(at('stmaryrc'), false, "St. Mary's Church", "St. Mary Our Lady of Seven Sorrows, 56 Duke St W (1903) — the region's oldest and largest Catholic church"),
    m(at('stpeter'), false, "St. Peter's Lutheran", "St. Peter's Lutheran Church, 49 Queen St N — the congregation since 1863, this church since the 1960s"),
    m(at('gaol'), false, 'Waterloo County Gaol', "The Waterloo County Gaol (1853) and the Governor's House (1878), 73-77 Queen St N"),
    m(at('claygl'), false, 'Canadian Clay & Glass Gallery', 'The Canadian Clay and Glass Gallery, 25 Caroline St N (Patkau Architects, 1993)'),
    m(at('wmrc'), false, 'Waterloo Memorial Rec Complex', 'The Waterloo Memorial Recreation Complex, 101 Father David Bauer Dr — the Siskins\' rink and the pool'),
    m(at('galtarena'), false, 'Galt Arena Gardens', 'Galt Arena Gardens, 98 Shade St (1922) — one of the oldest arenas still in use in Canada'),
  ].filter(Boolean);
}

export function landmarks2Stats() { return STATS; }
