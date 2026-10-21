// THE UNIVERSITY OF WATERLOO'S MAIN CAMPUS, building by building.
//
// data/uw.json (tools/kw/build_uw.py) is OSM's campus: every building's
// outline, levels and building:part masses (Dana Porter's stepped tower, MC's
// stair towers, DC's sloped glass), the enclosed bridges, Ring Road and the
// campus's own landmarks. This module draws all of it -- the boxes those
// buildings became go flat (prepCampus) -- each building in ITS look
// (STYLES, keyed by OSM ref), with the signatures that make it recognisable
// (SIGS): the E5 bridge over Ring Road, Dana Porter's white precast tower,
// MC's slit windows, DC's tan block with its stepped glass and ducts, QNC's
// honeycomb, the Arts quad's buff brick, Village 1's brown brick blocks, the
// UNIVERSITY OF WATERLOO letters at the main gate ...
//
// One landmarks.js extra (buildCampus). The shell (walls, glass, roofs) is
// drawn in kw.js's footprint material into buildPolys' own 'kwp' clusters,
// so it costs no draw of its own; the fine detail (mullions, MC's hoods, DP's
// fins, sills, sculptures, lettering) goes to 'near:' clusters that
// landmarks.js hides past ~520 m (updateLandmarkRange). Lettering is on a
// small atlas of its own.

import * as THREE from './three.js';
import * as G from './geo.js';
import { hash2 } from './util.js';
import { Builder } from './build.js';
import { LOOKS, polyMat, plainUV } from './kw.js';

const U0 = [0, 0, 0, 0, 0, 0, 0, 0];
const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const ckey = (x, z) => `${Math.round(x / 1200)},${Math.round(z / 1200)}`;
const T = (x, z) => G.terrainHeight(x, z);

const ST = 3.95;          // a storey, metres (UW's 1960s blocks: ~13 ft floor to floor)

let U = null;             // uw.json
const BLD = [];           // what prepCampus found: { r (record), base, boxes }
const STATS = { buildings: 0, parts: 0, bridges: 0, tris: 0, solids: 0 };
export function setUwData(d) { U = d; }
export function campusStats() { return STATS; }

// --- geometry helpers -------------------------------------------------------------

function inPoly(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}
function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; }
  return a / 2;
}
function centroid(p) {
  let x = 0, z = 0;
  for (const q of p) { x += q[0]; z += q[1]; }
  return [x / p.length, z / p.length];
}
/** Each edge of a footprint: ends, unit direction, outward normal, length, and a point-at helper. */
function edges(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.25) continue;
    const ux = dx / L, uz = dz / L;
    let nx = uz, nz = -ux;
    if (inPoly(pts, a[0] + dx / 2 + nx * 0.3, a[1] + dz / 2 + nz * 0.3)) { nx = -nx; nz = -nz; }
    out.push({ a, c, ux, uz, nx, nz, L, mx: a[0] + dx / 2, mz: a[1] + dz / 2,
      at: (t, y, off = 0) => [a[0] + ux * t + nx * off, y, a[1] + uz * t + nz * off] });
  }
  return out;
}
/** A polygon's oriented box: centre, half-sizes along u (the long side) and v, u's direction. */
function obb(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of pts) {
      const u = q[0] * ux + q[1] * uz, v = -q[0] * uz + q[1] * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      best = { A, x: cu * ux - cv * uz, z: cu * uz + cv * ux, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2, ux, uz };
    }
  }
  if (best && best.hv > best.hu) {
    const t = best.hu; best.hu = best.hv; best.hv = t;
    const ux = best.ux; best.ux = -best.uz; best.uz = ux;
  }
  return best;
}
/** Shrink (or grow, d < 0) a CCW-or-CW polygon by d metres (mitred, clamped). */
function inset(pts, d) {
  const n = pts.length, out = [];
  const s = polyArea(pts) > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], q = pts[i], r = pts[(i + 1) % n];
    const ax = q[0] - p[0], az = q[1] - p[1], la = Math.hypot(ax, az) || 1;
    const bx = r[0] - q[0], bz = r[1] - q[1], lb = Math.hypot(bx, bz) || 1;
    // inward normals of the two edges (left of travel for a CCW ring in x/z with this area sign)
    const n1x = -az / la * s, n1z = ax / la * s, n2x = -bz / lb * s, n2z = bx / lb * s;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const cosh = Math.max(0.35, mx * n1x + mz * n1z);
    out.push([q[0] + mx * d / cosh, q[1] + mz * d / cosh]);
  }
  return out;
}
function triangulate(pts) {
  try { return THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q[0], q[1])), []); } catch (e) { return []; }
}
function flatPoly(B, pts, y, col, down = false) {
  for (const [i, j, k] of triangulate(pts)) {
    B.tri([pts[i][0], y, pts[i][1]], [pts[j][0], y, pts[j][1]], [pts[k][0], y, pts[k][1]], [0, down ? -1 : 1, 0], col);
  }
}
function lowest(pts) {
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  return lo;
}

// --- one builder per cluster per material ---------------------------------------------

class Kit {
  constructor() { this.b = new Map(); this.g = new Map(); this.tris = 0; }
  /**
   * The cluster's builder for the shell (walls, roofs, glass: drawn at any
   * distance); its `.d` is the cluster's DETAIL builder (mullions, hoods,
   * fins, sills, sculptures), a landmark group of its own ('near:' key) that
   * landmarks.js hides past NEAR_R from the camera.
   */
  B(x, z) {
    // the shell joins kw.js buildPolys' clusters ('kwp' keys, the same
    // material), so a cluster's footprint buildings and the campus are one
    // draw; a builder is retired at 50k vertices (mergeByMaterial leaves a
    // mesh over 60k as a draw of its own) and the next merges with it
    const k = ckey(x, z);
    let b = this.b.get(k);
    if (!b || b.pos.length > 150000) {
      const n = (this.n = (this.n || 0) + 1);
      const d = b ? b.d : new Builder(false);
      b = new Builder(false);
      b.d = d;
      this.b.set(k, b);
      this.all = this.all || [];
      this.all.push(['kwp' + k, b]);
      if (!d.on) { d.on = true; this.all.push(['near:' + k, d]); }
    }
    // the detail likewise
    if (b.d.pos.length > 150000) {
      b.d = new Builder(false);
      this.all.push(['near:' + k, b.d]);
    }
    return b;
  }
  grp(x, z) {
    const k = 'near:' + ckey(x, z);
    let g = this.g.get(k);
    if (!g) this.g.set(k, (g = new THREE.Group()));
    return g;
  }
  flush(ctx) {
    const M = polyMat();
    for (const [key, b] of this.all || []) {
      if (b.empty) continue;
      this.tris += b.idx.length / 3;
      if (key.startsWith('near:')) this.near = (this.near || 0) + b.idx.length / 3;
      const m = new THREE.Mesh(plainUV(b.build()), M);
      let g = this.g.get(key);
      if (!g) this.g.set(key, (g = new THREE.Group()));
      g.add(m);
    }
    for (const [k, g] of this.g) ctx.addTo(k, g);
    this.b.clear(); this.g.clear(); this.all = [];
  }
}

// --- palettes (sRGB; lin() at use) ----------------------------------------------------

const C = {
  buffConc: [0.79, 0.75, 0.67],     // the 1960s precast: warm grey-buff aggregate (MC, NH, the sciences)
  dpTower: [0.86, 0.83, 0.76],      // Dana Porter's ribbed cream panels
  buffBrick: [0.76, 0.66, 0.51],    // DWE, E2, E3, the sciences: buff / tan brick
  brownBrick: [0.47, 0.30, 0.22],   // Hagey Hall, PAS, the Arts and Environment buildings
  redBrick: [0.66, 0.33, 0.22],     // M3, Tatham, MKV, Fed Hall
  v1Brick: [0.58, 0.40, 0.33],      // Village 1 / REV: red-brown brick (OSM building:colour #AE9183)
  dcTan: [0.74, 0.69, 0.58],        // DC's ribbed metal and concrete wings
  white: [0.90, 0.91, 0.91],        // E5's faceted panels
  charcoal: [0.30, 0.31, 0.33],     // E7's dark faceted panels
  silver: [0.70, 0.72, 0.74],
  glassBlue: [0.16, 0.24, 0.36],
  glassDark: [0.12, 0.15, 0.19],
  glassTeal: [0.34, 0.47, 0.49],
  glassGreen: [0.30, 0.46, 0.44],
  frameWhite: [0.86, 0.87, 0.88],
  frameDark: [0.20, 0.21, 0.22],
  roof: [0.55, 0.55, 0.53],
  roofDark: [0.36, 0.36, 0.36],
  red: [0.78, 0.10, 0.10],          // DC's portal frames
  duct: [0.50, 0.55, 0.57],
};

// A style: wall, trim (cap / sills), roof, and the window treatment:
//   'ribbon' a band of glass per storey (wf of it, mullions every mp),
//   'slit' narrow verticals (sw wide every sp, wf of the storey high),
//   'punch' ww x wh every sp, 'hood' MC's windows each in a projecting
//   precast frame, 'curtain' all glass (mullions every mp, a spandrel per
//   floor), 'facet' E5 / E7's diamond-faceted panels with glass bands,
//   'stripe' QNC's vertical panels in two tones, 'none'.
const S = (o) => ({ wall: C.buffConc, trim: null, roof: C.roof, glass: C.glassDark, frame: C.frameDark, win: 'ribbon', wf: 0.42,
  parapet: 0.6, mp: 0, sp: 2.4, sw: 0.6, ww: 1.4, wh: 1.6, ...o });
const STY = {
  conc: S({ wall: C.buffConc, win: 'ribbon', wf: 0.38, mp: 2.0 }),
  brown: S({ wall: C.brownBrick, win: 'ribbon', wf: 0.34, mp: 1.6, trim: [0.72, 0.68, 0.62] }),
  buff: S({ wall: C.buffBrick, win: 'ribbon', wf: 0.40, mp: 1.4, trim: [0.82, 0.80, 0.74] }),
  red: S({ wall: C.redBrick, win: 'punch', ww: 1.5, wh: 1.7, sp: 3.2, trim: [0.80, 0.78, 0.74] }),
  res: S({ wall: C.v1Brick, win: 'punch', ww: 1.1, wh: 1.4, sp: 3.0, trim: [0.78, 0.76, 0.72], parapet: 0.9 }),
  glass: S({ wall: C.silver, win: 'curtain', glass: C.glassBlue, frame: C.silver, mp: 1.6, parapet: 0.3 }),
  bio: S({ wall: [0.86, 0.85, 0.81], win: 'hood', ww: 1.0, wh: 2.3, sp: 1.55, trim: [0.93, 0.92, 0.89], glass: [0.16, 0.20, 0.26] }),
};
// Per building, by OSM ref (else name).
const BY = {
  // the precast core
  MC: S({ wall: C.buffConc, win: 'hood', ww: 1.15, wh: 1.45, sp: 1.75, trim: [0.84, 0.80, 0.73], mcBase: true }),
  NH: S({ wall: [0.86, 0.84, 0.78], win: 'ribbon', wf: 0.40, mp: 1.5 }),
  LIB: S({ wall: C.dpTower, win: 'slit', sw: 0.55, sp: 1.55, wf: 0.55 }),
  PAS: S({ wall: [0.80, 0.77, 0.70], win: 'ribbon', wf: 0.34, mp: 0, trim: [0.86, 0.83, 0.77] }),
  BMH: STY.conc,
  ML: S({ wall: C.buffConc, win: 'slit', sw: 0.9, sp: 2.6, wf: 0.5 }),
  // buff brick: the 1958-62 core (physics, chemistry, engineering)
  C2: STY.buff, PHY: STY.buff, CPH: STY.buff,
  // the biology / earth sciences block (Commons "BIO Connection"): white
  // precast, each pair of tall windows in a deep projecting frame
  B1: STY.bio, B2: STY.bio, ESC: STY.bio,
  // dark brick: the humanities
  HH: STY.brown, AL: STY.brown, EV1: STY.brown, OPT: STY.brown,
  EV2: S({ wall: [0.70, 0.38, 0.26], win: 'ribbon', wf: 0.34, mp: 1.6 }),
  SCH: S({ wall: [0.45, 0.27, 0.20], win: 'ribbon', wf: 0.36, mp: 1.6, trim: [0.90, 0.88, 0.80], parapet: 0.9, fascia: 1.1 }),
  // the PAC (1969): SCH's language -- dark brown brick, blank gym walls
  // between brick pilasters, a deep white precast fascia round every roof;
  // the low wings get a band of windows
  PAC: S({ wall: [0.42, 0.27, 0.21], win: 'none', trim: [0.88, 0.87, 0.82], parapet: 0.2, fascia: 1.5, pil: 5.4,
    low: S({ wall: [0.42, 0.27, 0.21], win: 'ribbon', wf: 0.38, mp: 1.8, glass: C.glassDark, trim: [0.88, 0.87, 0.82], parapet: 0.2, fascia: 1.1 }) }),
  // the SLC: brown brick and tan split-face block, the Great Hall's curved
  // two-storey wall of blue glass on the courtyard (PART_STY)
  SLC: S({ wall: [0.46, 0.30, 0.22], win: 'ribbon', wf: 0.40, mp: 1.6, glass: C.glassBlue, trim: [0.80, 0.72, 0.58], parapet: 0.4, fascia: 0.8 }),
  E2: STY.buff, E3: STY.buff, DWE: STY.buff, RCH: STY.buff, ERC: STY.buff, CSB: STY.buff, GSC: STY.red, COM: STY.buff,
  FED: STY.red, HS: STY.buff, UC: STY.brown, AHS: STY.red, LHI: STY.red, TH: STY.res,
  // glass and metal
  DC: S({ wall: C.dcTan, win: 'ribbon', wf: 0.30, mp: 0, glass: C.glassDark, trim: [0.62, 0.60, 0.55] }),
  E5: S({ wall: C.white, win: 'facet', glass: C.glassBlue, frame: C.frameWhite, parapet: 0.4 }),
  PSE: S({ wall: [0.44, 0.45, 0.47], win: 'facet', glass: C.glassDark, frame: [0.22, 0.22, 0.23], parapet: 0.4 }),
  E6: S({ wall: [0.34, 0.37, 0.42], win: 'curtain', glass: C.glassBlue, frame: [0.30, 0.32, 0.36], mp: 1.5, parapet: 0.4 }),
  // QNC's IQC bar: a barcode of silver-blue glass and bronze-to-black panels
  QNC: S({ wall: [0.58, 0.65, 0.72], win: 'stripe', glass: [0.12, 0.13, 0.15], frame: [0.36, 0.27, 0.22], parapet: 0.3 }),
  M3: S({ wall: [0.74, 0.36, 0.22], win: 'curtain', glass: C.glassTeal, frame: [0.80, 0.82, 0.82], mp: 1.5, parapet: 0.4 }),
  EIT: S({ wall: C.brownBrick, win: 'curtain', glass: C.glassGreen, frame: [0.62, 0.62, 0.60], mp: 1.8 }),
  // STC (2011): buff brick, teal-green glazing, grey metal-panel upper storey
  STC: S({ wall: [0.80, 0.70, 0.54], win: 'ribbon', wf: 0.52, mp: 1.4, glass: C.glassTeal, frame: [0.78, 0.80, 0.80], trim: [0.70, 0.72, 0.74] }),
  // EV3: warm grey panels, a lime-green band under each ribbon window
  EV3: S({ wall: [0.80, 0.78, 0.74], win: 'ribbon', wf: 0.42, mp: 1.2, glass: [0.22, 0.27, 0.33], frame: [0.40, 0.37, 0.34], trim: [0.62, 0.78, 0.18], parapet: 0.4 }),
  TC: S({ wall: C.redBrick, win: 'ribbon', wf: 0.30, mp: 2.0 }),
  // the CIF (Commons CIF_01-04): cream brick, a clerestory of glass under a
  // white metal fascia, red steel along its covered walkways (SIGS)
  CIF: S({ wall: [0.84, 0.78, 0.64], win: 'clere', glass: [0.30, 0.40, 0.46], frame: [0.88, 0.89, 0.90], trim: [0.92, 0.93, 0.94], parapet: 0.2, fascia: 1.0 }),
  ECH: S({ wall: [0.80, 0.80, 0.78], win: 'ribbon', wf: 0.3, mp: 0 }),
  // residences
  V1: STY.res, REV: STY.res, MHR: STY.res,
  MKV: S({ wall: C.redBrick, win: 'punch', ww: 1.0, wh: 1.4, sp: 3.4, trim: [0.80, 0.80, 0.78] }),
  // the colleges
  REN: S({ wall: [0.76, 0.66, 0.52], win: 'ribbon', wf: 0.36, mp: 1.4, trim: [0.84, 0.80, 0.72] }),   // beige block, split-face stone
  STJ: S({ wall: [0.52, 0.34, 0.25], win: 'punch', ww: 1.4, wh: 1.6, sp: 3.2, trim: [0.80, 0.78, 0.72] }),
  CGR: S({ wall: [0.56, 0.32, 0.24], win: 'punch', ww: 1.4, wh: 1.7, sp: 3.0, trim: [0.90, 0.90, 0.88] }),
  UTD: S({ wall: [0.56, 0.32, 0.24], win: 'punch', ww: 1.3, wh: 1.6, sp: 3.0, trim: [0.86, 0.84, 0.80] }),
};
const BY_NAME = {
  'United College Green Wing': STY.glass,
  "St. Jerome's Academic Centre SJ2": S({ wall: [0.30, 0.30, 0.32], win: 'curtain', glass: C.glassDark, frame: [0.30, 0.30, 0.32], mp: 1.2 }),
  "St. Jerome's University Residence Buildings": S({ wall: [0.58, 0.40, 0.30], win: 'punch', ww: 1.2, wh: 1.6, sp: 3.0 }),
  'Resurrection College': STY.buff,
  'Feridun Hamdullahpur Field House': S({ wall: [0.82, 0.84, 0.86], win: 'none', trim: [0.20, 0.22, 0.30], parapet: 0.3 }),
  'Bright Starts Co-operative Early Learning Centre': S({ wall: [0.90, 0.89, 0.85], win: 'punch', ww: 1.6, wh: 1.4, sp: 3.0 }),
  'Skén:nen Tsi Nón:we Tewaya’taróroks': S({ wall: [0.62, 0.48, 0.34], win: 'curtain', glass: C.glassDark, frame: [0.50, 0.38, 0.26], mp: 1.2 }),
  'Brubacher House': S({ wall: [0.86, 0.80, 0.62], win: 'punch', ww: 0.9, wh: 1.5, sp: 3.0 }),
};

// WILFRID LAURIER UNIVERSITY, by OSM name. Photos (Commons, Oct 2026): the
// 1990s-2000s buildings (Bricker Academic, the Science Building, the Woods
// building) are red brick banded in cream precast, a band under every row of
// windows; Lazaridis Hall (2015) a big box of blue-grey glass on a dark frame;
// the residences red brick with white trim; Martin Luther's seminary
// limestone; the older core (the Arts wings, FNCC, the library) darker
// red-brown brick.
const WRB = [0.58, 0.29, 0.22], CREAM = [0.88, 0.85, 0.76], OLD = [0.56, 0.31, 0.24];
const WBAND = S({ wall: WRB, win: 'banded', wf: 0.5, ww: 2.5, sp: 3.0, trim: CREAM, glass: [0.14, 0.17, 0.21], parapet: 0.5, fascia: 0.7 });
const WRES = S({ wall: WRB, win: 'punch', ww: 1.2, wh: 1.5, sp: 3.0, trim: CREAM, parapet: 0.6 });
const WOLD = S({ wall: OLD, win: 'punch', ww: 1.7, wh: 1.6, sp: 2.6, trim: [0.86, 0.84, 0.78], parapet: 0.6 });
const WLU = {
  'Bricker Academic Building': WBAND,
  'Science Building': WBAND,
  'Science Research Building': WBAND,
  'Dr. Alvin Woods Building': WBAND,
  'Schlegel Building': WBAND,
  'Laurier Library': S({ wall: [0.56, 0.30, 0.22], win: 'slit', sw: 1.0, sp: 3.4, wf: 0.62, trim: CREAM, parapet: 0.6, fascia: 0.9 }),
  'Arts Building - A Wing': WOLD, 'Arts Building - C Wing': WOLD, 'Arts Building - E Wing': WOLD,
  'Frank C. Peters Building': S({ wall: [0.72, 0.71, 0.68], win: 'ribbon', wf: 0.42, mp: 1.6, glass: C.glassDark, trim: [0.80, 0.79, 0.76], parapet: 0.5 }),
  'Fred Nichols Campus Centre': S({ wall: [0.50, 0.30, 0.23], win: 'ribbon', wf: 0.38, mp: 1.8, glass: C.glassDark, trim: CREAM, parapet: 0.6, fascia: 0.8 }),
  'Lazaridis Hall': S({ wall: [0.24, 0.25, 0.28], win: 'curtain', glass: [0.30, 0.40, 0.48], frame: [0.20, 0.21, 0.23], mp: 1.5, parapet: 0.4 }),
  'Solarium': S({ wall: [0.70, 0.73, 0.75], win: 'curtain', glass: [0.42, 0.52, 0.56], frame: [0.86, 0.87, 0.88], mp: 1.4, parapet: 0, glassRoof: true }),
  'John Aird Centre': S({ wall: [0.84, 0.76, 0.62], win: 'ribbon', wf: 0.36, mp: 1.8, trim: [0.92, 0.90, 0.84], parapet: 0.6 }),
  'Theatre Auditorium': S({ wall: OLD, win: 'none', trim: CREAM, fascia: 1.2, pil: 4.5 }),
  'Athletics Complex': S({ wall: [0.60, 0.33, 0.25], win: 'clere', glass: [0.20, 0.24, 0.30], frame: CREAM, trim: CREAM, parapet: 0.2, fascia: 1.2, pil: 6 }),
  'Martin Luther University College': S({ wall: [0.80, 0.74, 0.62], win: 'slit', sw: 0.7, sp: 3.4, wf: 0.75, trim: [0.86, 0.82, 0.72], parapet: 0.3 }),
  'King Street Residence': WRES, 'Bricker Residence': WRES, 'Clara Conrad Residence': WRES, 'Willison Residence': WRES,
  'Little House Residence': WRES, 'Bouckaert Residence': WRES, 'Leopold Residence': WRES, 'Euler Residence': WRES,
  'MacDonald House': WRES, 'Waterloo College Hall': WRES, 'Regina Residence': WRES,
  'Stadium Building': S({ wall: [0.70, 0.70, 0.68], win: 'none', parapet: 0.3 }),
};

function styleOf(r) {
  if (r.campus === 'wlu') return WLU[r.name] || (r.building === 'grandstand' ? WLU['Stadium Building'] : WOLD);
  if (r.ref && BY[r.ref]) return BY[r.ref];
  if (r.name && BY_NAME[r.name]) return BY_NAME[r.name];
  if (r.building === 'chapel') return S({ wall: [0.50, 0.46, 0.42], win: 'slit', sw: 0.5, sp: 3.0, wf: 0.6, parapet: 0 });  // Grebel's rubble stone
  if ((r['building:colour'] || '').toUpperCase() === '#AE9183') return STY.res;
  if (r.building === 'dormitory') return STY.res;
  if (r.building === 'bridge' || r['building:material'] === 'glass') return STY.glass;
  return STY.conc;
}

// Parts with a look of their own (OSM building:part ids).
const PART_STY = {
  // Dana Porter: the recessed ground floor of arches, the podium's band of
  // fins under a dark fascia, the dark glass neck, the ribbed tower
  1028136267: S({ wall: [0.20, 0.22, 0.24], win: 'arcade', glass: C.glassDark, trim: C.buffConc, parapet: 0 }),
  1028136266: S({ wall: C.dpTower, win: 'fins', glass: C.glassDark, trim: [0.24, 0.20, 0.17], sp: 1.6 }),
  1028136268: S({ wall: C.glassDark, win: 'none', parapet: 0, trim: C.glassDark }),
  513745232: S({ wall: C.dpTower, win: 'slit', sw: 0.42, sp: 1.6, wf: 0.62, ribs: true, parapet: 0.3, trim: [0.90, 0.88, 0.82] }),
  // MC's blank stair towers
  664040399: S({ wall: [0.76, 0.72, 0.64], win: 'none', flutes: true }), 664040401: S({ wall: [0.76, 0.72, 0.64], win: 'none', flutes: true }),
  664040406: S({ wall: [0.76, 0.72, 0.64], win: 'none', flutes: true }),
  // QNC: the honeycomb wing; its dark brick base
  1027581491: S({ wall: C.glassDark, win: 'hex', glass: [0.20, 0.26, 0.32], frame: [0.80, 0.82, 0.84], parapet: 0.3 }),
  1027581490: S({ wall: [0.24, 0.22, 0.22], win: 'ribbon', wf: 0.3, mp: 0, glass: C.glassDark }),
  // DC: the teal glass barrel vault and the glazed atrium
  692354659: S({ wall: C.glassTeal, win: 'curtain', glass: C.glassTeal, frame: [0.62, 0.70, 0.70], mp: 1.8, vault: true, parapet: 0 }),
  692354651: S({ wall: C.glassTeal, win: 'curtain', glass: C.glassTeal, frame: [0.62, 0.70, 0.70], mp: 1.8, vault: true, parapet: 0 }),
  // the SLC's Great Hall: the curved two-storey wall of blue glass round its
  // east side (OSM's curved parts), silver mullions, a tan block fascia;
  // the glass link to MC
  1027588307: S({ wall: [0.80, 0.72, 0.58], win: 'curtain', glass: [0.22, 0.34, 0.50], frame: [0.84, 0.85, 0.86], mp: 1.4, parapet: 0.4, fascia: 0.6 }),
  951370624: S({ wall: [0.80, 0.72, 0.58], win: 'curtain', glass: [0.22, 0.34, 0.50], frame: [0.84, 0.85, 0.86], mp: 1.4, parapet: 0.3, fascia: 0.5 }),
  1027588308: S({ wall: C.silver, win: 'curtain', glass: [0.26, 0.36, 0.46], frame: [0.84, 0.85, 0.86], mp: 1.6, parapet: 0.3 }),
};

// --- walls, windows, roofs ---------------------------------------------------------------

const O = 0.05;   // windows stand this far off the wall

/** One storey's windows on edge e, the storey's floor at ya. */
function windows(B, e, ya, k, st, cols, nFloors) {
  const L = e.L, N = [e.nx, 0, e.nz];
  const { glass, frame, trim, wall } = cols;
  const at = e.at;
  const e0 = Math.min(1.0, L * 0.12);
  switch (st.win) {
    case 'ribbon': {
      if (L < 3) return;
      const h = ST * st.wf, y = ya + (ST - h) * 0.55;
      B.quad(at(e0, y, O), at(L - e0, y, O), at(L - e0, y + h, O), at(e0, y + h, O), N, U0, glass);
      if (st.mp) {
        const n = Math.min(60, Math.floor((L - 2 * e0) / Math.max(2.4, st.mp)));
        for (let m = 1; m < n; m++) {
          const t = e0 + (m / n) * (L - 2 * e0);
          B.d.quad(at(t - 0.06, y, O * 2), at(t + 0.06, y, O * 2), at(t + 0.06, y + h, O * 2), at(t - 0.06, y + h, O * 2), N, U0, frame);
        }
      }
      if (trim) B.d.quad(at(e0, y - 0.14, O * 3), at(L - e0, y - 0.14, O * 3), at(L - e0, y, O * 3), at(e0, y, O * 3), N, U0, trim);
      return;
    }
    case 'slit': {
      const n = Math.floor((L - 0.6) / st.sp);
      if (n < 1) return;
      const h = ST * st.wf, y = ya + (ST - h) * 0.5, t0 = (L - n * st.sp) / 2 + st.sp / 2;
      // DP's tower: the slits stagger floor to floor
      const sh = st.ribs && k % 2 ? st.sp * 0.5 : 0;
      for (let m = 0; m < n; m++) {
        const t = t0 + m * st.sp + sh;
        if (t + st.sw / 2 > L - 0.3) continue;
        B.quad(at(t - st.sw / 2, y, O), at(t + st.sw / 2, y, O), at(t + st.sw / 2, y + h, O), at(t - st.sw / 2, y + h, O), N, U0, glass);
      }
      return;
    }
    case 'punch': case 'hood': {
      const n = Math.floor((L - 0.8) / st.sp);
      if (n < 1) return;
      if (st.win === 'hood' && k === 0 && st.mcBase) {
        // MC's ground floor: brown brick infill between precast piers
        B.quad(at(0.4, ya, O * 0.6), at(L - 0.4, ya, O * 0.6), at(L - 0.4, ya + ST - 0.3, O * 0.6), at(0.4, ya + ST - 0.3, O * 0.6), N, U0, cols.infill);
        const np = Math.max(1, Math.floor(L / 6));
        for (let m = 0; m <= np; m++) {
          const t = 0.4 + (m / np) * (L - 0.8);
          B.d.box(...pt(at(t, ya, 0.25)), 0.9, ST - 0.3, 0.5, Math.atan2(e.uz, e.ux), wall);
        }
        return;
      }
      const t0 = (L - n * st.sp) / 2 + st.sp / 2;
      const y = ya + (ST - st.wh) * 0.55;
      for (let m = 0; m < n; m++) {
        const t = t0 + m * st.sp, a = t - st.ww / 2, b = t + st.ww / 2;
        B.quad(at(a, y, O), at(b, y, O), at(b, y + st.wh, O), at(a, y + st.wh, O), N, U0, glass);
        if (st.win === 'hood') {
          // a precast frame standing 0.4 m proud: its two cheeks, its head and its sill
          const P = 0.42, c = trim;
          B.d.quad(at(a - 0.12, y - 0.12, P), at(b + 0.12, y - 0.12, P), at(b + 0.12, y + st.wh + 0.12, P), at(a - 0.12, y + st.wh + 0.12, P), N, U0, c);
          // the opening through it (dark), so the frame reads as a hood
          B.d.quad(at(a, y, P + 0.01), at(b, y, P + 0.01), at(b, y + st.wh, P + 0.01), at(a, y + st.wh, P + 0.01), N, U0, glass);
          B.d.quad(at(a - 0.12, y + st.wh + 0.12, 0), at(b + 0.12, y + st.wh + 0.12, 0), at(b + 0.12, y + st.wh + 0.12, P), at(a - 0.12, y + st.wh + 0.12, P), [0, 1, 0], U0, c);
          B.d.quad(at(a - 0.12, y - 0.12, 0), at(a - 0.12, y - 0.12, P), at(a - 0.12, y + st.wh + 0.12, P), at(a - 0.12, y + st.wh + 0.12, 0), [-e.ux, 0, -e.uz], U0, shade(c, 0.8));
          B.d.quad(at(b + 0.12, y - 0.12, 0), at(b + 0.12, y - 0.12, P), at(b + 0.12, y + st.wh + 0.12, P), at(b + 0.12, y + st.wh + 0.12, 0), [e.ux, 0, e.uz], U0, shade(c, 0.8));
        } else if (trim) {
          B.d.quad(at(a - 0.1, y - 0.12, O * 2), at(b + 0.1, y - 0.12, O * 2), at(b + 0.1, y, O * 2), at(a - 0.1, y, O * 2), N, U0, trim);
        }
      }
      return;
    }
    case 'banded': {
      // Laurier's red brick: a cream precast band the length of the face
      // under every row of windows, the windows in pairs between brick piers
      if (L < 3) return;
      const h = ST * st.wf, y = ya + (ST - h) * 0.55;
      B.quad(at(0, y - 0.6, O * 2), at(L, y - 0.6, O * 2), at(L, y, O * 2), at(0, y, O * 2), N, U0, trim);
      const n = Math.floor((L - 1) / st.sp);
      if (n < 1) return;
      const t0 = (L - n * st.sp) / 2;
      for (let m = 0; m < n; m++) {
        const a = t0 + m * st.sp + (st.sp - st.ww) / 2, b = a + st.ww;
        B.quad(at(a, y, O), at(b, y, O), at(b, y + h, O), at(a, y + h, O), N, U0, glass);
        B.d.quad(at((a + b) / 2 - 0.05, y, O * 2), at((a + b) / 2 + 0.05, y, O * 2), at((a + b) / 2 + 0.05, y + h, O * 2), at((a + b) / 2 - 0.05, y + h, O * 2), N, U0, frame);
      }
      return;
    }
    case 'facet': {
      // E5 / E7: the lowest two storeys glazed, above them diamond-faceted
      // panels, a band of glass every other floor
      if (k < 2) {
        B.quad(at(0.2, ya + 0.1, O), at(L - 0.2, ya + 0.1, O), at(L - 0.2, ya + ST - 0.3, O), at(0.2, ya + ST - 0.3, O), N, U0, glass);
        const n = Math.min(40, Math.floor(L / 1.6));
        for (let m = 1; m < n; m++) {
          const t = (m / n) * L;
          B.d.quad(at(t - 0.05, ya, O * 2), at(t + 0.05, ya, O * 2), at(t + 0.05, ya + ST, O * 2), at(t - 0.05, ya + ST, O * 2), N, U0, frame);
        }
        return;
      }
      if (k % 2 === 1 && k < nFloors - 1) {
        B.quad(at(0.3, ya + 0.9, O), at(L - 0.3, ya + 0.9, O), at(L - 0.3, ya + ST - 0.6, O), at(0.3, ya + ST - 0.6, O), N, U0, glass);
        return;
      }
      const pw = 3.0, n = Math.max(1, Math.round(L / pw)), w = L / n, D = 0.45;
      const lite = shade(wall, 1.12), dark = shade(wall, 0.72), mid = shade(wall, 0.9);
      for (let m = 0; m < n; m++) {
        const t0 = m * w, t1 = t0 + w, tc = t0 + w / 2, y0 = ya, y1 = ya + ST, yc = ya + ST * 0.5;
        const ctr = at(tc, yc, D);
        // four triangles round a point pushed out: lit from above, dark below
        B.tri(at(t0, y1, O), at(t1, y1, O), ctr, [e.nx * 0.6, 0.8, e.nz * 0.6], lite);
        B.tri(at(t1, y0, O), at(t0, y0, O), ctr, [e.nx * 0.6, -0.8, e.nz * 0.6], dark);
        B.tri(at(t0, y0, O), at(t0, y1, O), ctr, [e.nx * 0.7 - e.ux * 0.7, 0, e.nz * 0.7 - e.uz * 0.7], mid);
        B.tri(at(t1, y1, O), at(t1, y0, O), ctr, [e.nx * 0.7 + e.ux * 0.7, 0, e.nz * 0.7 + e.uz * 0.7], mid);
      }
      return;
    }
    case 'fins': {
      // DP's podium: a dark glass storey behind slender precast fins
      B.quad(at(0, ya + 0.2, O), at(L, ya + 0.2, O), at(L, ya + ST * 0.85, O), at(0, ya + ST * 0.85, O), N, U0, glass);
      const n = Math.floor(L / st.sp);
      for (let m = 0; m <= n; m++) {
        const t = (m / Math.max(1, n)) * L;
        B.d.box(...pt(at(t, ya + 0.2, 0.35)), 0.35, ST * 0.65, 0.7, Math.atan2(e.uz, e.ux), wall);
      }
      return;
    }
    case 'arcade': {
      // DP's ground floor: glass behind a row of concrete arches
      B.quad(at(0, ya, -1.2), at(L, ya, -1.2), at(L, ya + ST, -1.2), at(0, ya + ST, -1.2), N, U0, glass);
      const n = Math.max(1, Math.round(L / 7.5)), w = L / n;
      for (let m = 0; m <= n; m++) B.box(...pt(at(m * w, ya, 0.3)), 1.1, ST, 1.1, Math.atan2(e.uz, e.ux), trim);
      return;
    }
    default:
  }
}
const pt = (p) => [p[0], p[1], p[2]];

/**
 * One prism of a building: its walls from y0 to y1 (and a parapet), the
 * windows of each storey whose floor (base + k * ST) is inside it, the cap,
 * the roof; a soffit when it floats (a bridge, an overhang).
 */
function mass(B, solids, pts, base, y0, y1, st, opts = {}) {
  const E = edges(pts);
  const wall = lin(st.wall), trim = st.trim ? lin(st.trim) : shade(wall, 1.08);
  const cols = { wall, trim, glass: lin(st.glass), frame: lin(st.frame), infill: lin(C.brownBrick) };
  const ground = !opts.floating;
  const par = st.vault ? 0 : st.parapet;
  const foot = ground ? shade(wall, 0.7) : wall;
  const f0 = Math.max(0, Math.ceil((y0 - base) / ST - 0.25)), f1 = Math.floor((y1 - base) / ST + 0.05);
  const nFloors = f1;
  for (const e of E) {
    const N = [e.nx, 0, e.nz];
    B.quad(e.at(0, y0, 0), e.at(e.L, y0, 0), e.at(e.L, y1 + par, 0), e.at(0, y1 + par, 0), N, U0, [foot, foot, wall, wall]);
    if (par > 0) {
      B.quad(e.at(0, y1, -0.3), e.at(e.L, y1, -0.3), e.at(e.L, y1 + par, -0.3), e.at(0, y1 + par, -0.3), [-e.nx, 0, -e.nz], U0, shade(wall, 0.8));
      B.quad(e.at(0, y1 + par, 0.04), e.at(e.L, y1 + par, 0.04), e.at(e.L, y1 + par, -0.3), e.at(0, y1 + par, -0.3), [0, 1, 0], U0, trim);
    }
    if (ground && solids) solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: y0, y1: y1 + par });
    if (st.flutes) {
      // MC's stair towers: finely fluted ("corduroy") precast
      const n = Math.min(120, Math.floor(e.L / 0.7)), dk = shade(wall, 0.78);
      for (let m = 1; m < n; m++) {
        const t = (m / n) * e.L;
        B.d.quad(e.at(t - 0.12, y0 + 1, O), e.at(t + 0.12, y0 + 1, O), e.at(t + 0.12, y1, O), e.at(t - 0.12, y1, O), N, U0, dk);
      }
    }
    if (st.fascia && e.L > 1) {
      // a precast (or metal) band round the roof, standing proud of the wall
      const P = 0.35, ft = y1 + par + 0.05, fb = ft - st.fascia;
      B.quad(e.at(-P, fb, P), e.at(e.L + P, fb, P), e.at(e.L + P, ft, P), e.at(-P, ft, P), N, U0, trim);
      B.quad(e.at(-P, fb, 0), e.at(e.L + P, fb, 0), e.at(e.L + P, fb, P), e.at(-P, fb, P), [0, -1, 0], U0, shade(trim, 0.6));
      B.quad(e.at(-P, ft, 0), e.at(e.L + P, ft, 0), e.at(e.L + P, ft, P), e.at(-P, ft, P), [0, 1, 0], U0, trim);
    }
    if (st.pil && e.L > st.pil * 1.5) {
      // brick pilasters, a shade darker, the wall's height
      const n = Math.floor(e.L / st.pil), dk = shade(wall, 0.8), top = y1 + par - (st.fascia || 0);
      for (let m = 1; m < n; m++) {
        const t = (m / n) * e.L;
        B.d.quad(e.at(t - 0.45, y0 + 1, 0.22), e.at(t + 0.45, y0 + 1, 0.22), e.at(t + 0.45, top, 0.22), e.at(t - 0.45, top, 0.22), N, U0, dk);
      }
    }
    if (st.win === 'clere') {
      // a clerestory: one band of glass high on the wall, under the fascia
      if (e.L < 4 || y1 - y0 < 5) continue;
      const yt = y1 + par - (st.fascia || 0) - 0.25, yb = yt - 1.8;
      B.quad(e.at(0.6, yb, O), e.at(e.L - 0.6, yb, O), e.at(e.L - 0.6, yt, O), e.at(0.6, yt, O), N, U0, cols.glass);
      const n = Math.min(60, Math.floor(e.L / 2.4));
      for (let m = 1; m < n; m++) {
        const t = (m / n) * e.L;
        B.d.quad(e.at(t - 0.07, yb, O * 2), e.at(t + 0.07, yb, O * 2), e.at(t + 0.07, yt, O * 2), e.at(t - 0.07, yt, O * 2), N, U0, cols.frame);
      }
      continue;
    }
    if (st.win === 'none') continue;
    if (st.win === 'curtain' || st.win === 'stripe' || st.win === 'hex') { facade(B, e, base, y0, y1, st, cols, f0, f1); continue; }
    for (let k = f0; k < f1; k++) {
      const ya = base + k * ST;
      if (ya < y0 - 0.1 || ya + ST > y1 + 0.2) continue;
      windows(B, e, ya, k, st, cols, nFloors);
    }
    // DP's ribs: a light fin every bay, the tower's full height
    if (st.ribs) {
      const n = Math.floor(e.L / st.sp);
      for (let m = 1; m < n; m++) {
        const t = (m / n) * e.L;
        B.d.quad(e.at(t - 0.32, y0, 0.32), e.at(t + 0.32, y0, 0.32), e.at(t + 0.32, y1, 0.32), e.at(t - 0.32, y1, 0.32), N, U0, trim);
      }
    }
  }
  if (st.vault) vault(B, pts, y1, cols);
  else if (st.glassRoof) glassRoof(B, pts, y1, cols);
  else flatPoly(B, pts, y1, lin(st.roof || C.roof));
  if (!ground) flatPoly(B, pts, y0, shade(wall, 0.85), true);
}

/** Whole-face treatments: a curtain wall, QNC's stripes, QNC's honeycomb. */
function facade(B, e, base, y0, y1, st, cols, f0, f1) {
  const L = e.L, N = [e.nx, 0, e.nz], at = e.at;
  if (L < 1.5) return;
  const ya = Math.max(y0, base + f0 * ST) + 0.1, yb = y1 - 0.15;
  if (yb - ya < 1) return;
  if (st.win === 'stripe') {
    // vertical panels: silver, dark glass, bronze, in a rhythm that does not repeat
    const n = Math.max(2, Math.round(L / 1.15)), w = L / n;
    const tones = [cols.wall, cols.glass, cols.frame, cols.glass, shade(cols.wall, 0.82), cols.frame, cols.glass];
    for (let m = 0; m < n; m++) {
      const c = tones[Math.floor(hash2(m * 7 + Math.round(e.mx), 3) * tones.length)];
      B.quad(at(m * w, ya, O), at((m + 1) * w, ya, O), at((m + 1) * w, yb, O), at(m * w, yb, O), N, U0, c);
    }
    return;
  }
  B.quad(at(0.1, ya, O), at(L - 0.1, ya, O), at(L - 0.1, yb, O), at(0.1, yb, O), N, U0, cols.glass);
  if (st.win === 'hex') {
    // the honeycomb: a steel line round each 5.6 m hexagon, rows offset
    const hw = 2.8, hh = 2.6, f = cols.frame, th = 0.16;
    const seg = (t0, v0, t1, v1) => {
      const dt = t1 - t0, dv = v1 - v0, l = Math.hypot(dt, dv) || 1, ot = -dv / l * th, ov = dt / l * th;
      B.d.quad(at(t0 - ot, v0 - ov, O * 3), at(t1 - ot, v1 - ov, O * 3), at(t1 + ot, v1 + ov, O * 3), at(t0 + ot, v0 + ov, O * 3), N, U0, f);
    };
    let row = 0;
    for (let v = ya; v < yb - 0.5; v += hh, row++) {
      const off = row % 2 ? hw * 0.75 : 0;
      for (let t = off; t < L - 0.5; t += hw * 1.5) {
        const v1 = Math.min(yb, v + hh);
        seg(t, v, t + hw * 0.25, v + hh * 0.5);
        seg(t + hw * 0.25, v + hh * 0.5, t, v1);
        seg(Math.min(L, t + hw * 0.25), v + hh * 0.5, Math.min(L, t + hw * 0.75), v + hh * 0.5);
      }
    }
    return;
  }
  // mullions the full height, a spandrel at each floor
  if (st.mp) {
    const n = Math.min(80, Math.floor(L / Math.max(2.2, st.mp)));
    for (let m = 1; m < n; m++) {
      const t = (m / n) * L;
      B.d.quad(at(t - 0.06, ya, O * 2), at(t + 0.06, ya, O * 2), at(t + 0.06, yb, O * 2), at(t - 0.06, yb, O * 2), N, U0, cols.frame);
    }
  }
  for (let k = Math.max(1, f0); k < f1; k++) {
    const y = base + k * ST;
    if (y < ya + 0.5 || y > yb - 0.5) continue;
    B.quad(at(0.1, y - 0.45, O * 2), at(L - 0.1, y - 0.45, O * 2), at(L - 0.1, y + 0.15, O * 2), at(0.1, y + 0.15, O * 2), N, U0, cols.frame);
  }
  // a curtain wall on a brick building: brick piers at its ends
  if (st.wall !== st.glass && st.win === 'curtain' && L > 12) {
    for (const t of [0.8, L - 0.8]) B.quad(at(t - 0.8, y0, O * 3), at(t + 0.8, y0, O * 3), at(t + 0.8, y1, O * 3), at(t - 0.8, y1, O * 3), N, U0, cols.wall);
  }
}

/** Where the line u = const (in obb o's frame) crosses polygon pts: [vmin, vmax], or null. */
function spanAt(pts, o, u) {
  const vx = -o.uz, vz = o.ux;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ua = (a[0] - o.x) * o.ux + (a[1] - o.z) * o.uz, ub = (b[0] - o.x) * o.ux + (b[1] - o.z) * o.uz;
    if ((ua > u) === (ub > u)) continue;
    const t = (u - ua) / (ub - ua);
    const va = (a[0] - o.x) * vx + (a[1] - o.z) * vz, vb = (b[0] - o.x) * vx + (b[1] - o.z) * vz;
    const v = va + (vb - va) * t;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return hi - lo > 1 ? [lo, hi] : null;
}

/**
 * DC's glass vault, fitted to the part's real outline: slices every ~3 m
 * along its long axis, each as wide as the outline is there, so the slanted
 * ends of OSM's parallelogram are followed rather than boxed. The section
 * is DC's own (Commons photos): the glazed wall turns over in a tight
 * rounded eave (~3.4 m) into a shallow crown, not a half-round -- the whole
 * vault rises ~5 m over the walls, not the 9 a Quonset of that span would.
 */
function vault(B, pts, y, cols) {
  const o = obb(pts);
  if (!o) return;
  const vx = -o.uz, vz = o.ux;
  const P = (u, v, h) => [o.x + o.ux * u + vx * v, y + h, o.z + o.uz * u + vz * v];
  const Nw = (nv, nh) => [vx * nv, nh, vz * nv];
  // the section across [v0, v1]: points [v, h] and their normals [nv, nh]
  const section = (v0, v1) => {
    const W = v1 - v0, re = Math.min(3.4, W * 0.2), rc = Math.min(1.6, W * 0.05), out = [];
    for (const a of [Math.PI, Math.PI * 5 / 6, Math.PI * 2 / 3, Math.PI / 2]) out.push([v0 + re + Math.cos(a) * re, Math.sin(a) * re, Math.cos(a), Math.sin(a)]);
    for (const s of [0.25, 0.5, 0.75]) {
      const d = rc * Math.PI * Math.cos(Math.PI * s) / Math.max(1, W - 2 * re), l = Math.hypot(d, 1);
      out.push([v0 + re + (W - 2 * re) * s, re + rc * Math.sin(Math.PI * s), -d / l, 1 / l]);
    }
    for (const a of [Math.PI / 2, Math.PI / 3, Math.PI / 6, 0]) out.push([v1 - re + Math.cos(a) * re, Math.sin(a) * re, Math.cos(a), Math.sin(a)]);
    return out;
  };
  const n = Math.max(2, Math.ceil((o.hu * 2) / 3));
  const rows = [];
  for (let i = 0; i <= n; i++) {
    const u = -o.hu + 0.05 + (i / n) * (o.hu * 2 - 0.1);
    const s = spanAt(pts, o, u);
    if (s) rows.push({ u, s, p: section(s[0], s[1]) });
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    const A = rows[i], Bq = rows[i + 1];
    for (let k = 0; k + 1 < A.p.length; k++) {
      const a0 = A.p[k], a1 = A.p[k + 1], b0 = Bq.p[k], b1 = Bq.p[k + 1];
      B.quad(P(A.u, a0[0], a0[1]), P(Bq.u, b0[0], b0[1]), P(Bq.u, b1[0], b1[1]), P(A.u, a1[0], a1[1]),
        [Nw(a0[2], a0[3]), Nw(b0[2], b0[3]), Nw(b1[2], b1[3]), Nw(a1[2], a1[3])], U0, cols.glass);
    }
  }
  // the end walls (glass), and a rib every other slice
  for (const [r, s] of [[rows[0], -1], [rows[rows.length - 1], 1]]) {
    if (!r) continue;
    const mid = (r.s[0] + r.s[1]) / 2;
    for (let k = 0; k + 1 < r.p.length; k++) B.tri(P(r.u, r.p[k][0], r.p[k][1]), P(r.u, r.p[k + 1][0], r.p[k + 1][1]), P(r.u, mid, 0), [o.ux * s, 0, o.uz * s], cols.glass);
  }
  for (let i = 0; i < rows.length; i += 2) {
    const r = rows[i];
    for (let k = 0; k + 1 < r.p.length; k++) {
      const a = P(r.u, r.p[k][0], r.p[k][1] + 0.05), b = P(r.u, r.p[k + 1][0], r.p[k + 1][1] + 0.05);
      B.d.quad([a[0] - o.ux * 0.1, a[1], a[2] - o.uz * 0.1], [a[0] + o.ux * 0.1, a[1], a[2] + o.uz * 0.1],
        [b[0] + o.ux * 0.1, b[1], b[2] + o.uz * 0.1], [b[0] - o.ux * 0.1, b[1], b[2] - o.uz * 0.1], Nw(r.p[k][2], r.p[k][3]), U0, cols.frame);
    }
  }
  return o;
}

/** A hipped glass roof on a light frame (Laurier's solarium). */
function glassRoof(B, pts, y, cols) {
  const o = obb(pts);
  if (!o) return;
  flatPoly(B, pts, y, shade(cols.frame, 0.8));
  const r = Math.min(3, o.hv * 0.45), hu = Math.max(0, o.hu - o.hv);
  const P = (u, v, h) => [o.x + o.ux * u - o.uz * v, y + h, o.z + o.uz * u + o.ux * v];
  const c = [P(-o.hu, -o.hv, 0.1), P(o.hu, -o.hv, 0.1), P(o.hu, o.hv, 0.1), P(-o.hu, o.hv, 0.1)], t0 = P(-hu, 0, r), t1 = P(hu, 0, r);
  B.quad(c[0], c[1], t1, t0, [o.uz * 0.6, 0.8, -o.ux * 0.6], U0, cols.glass);
  B.quad(c[2], c[3], t0, t1, [-o.uz * 0.6, 0.8, o.ux * 0.6], U0, cols.glass);
  B.tri(c[1], c[2], t1, [o.ux * 0.6, 0.8, o.uz * 0.6], cols.glass);
  B.tri(c[3], c[0], t0, [-o.ux * 0.6, 0.8, -o.uz * 0.6], cols.glass);
  const n = Math.max(2, Math.round(o.hu / 1.6));
  for (let i = 0; i <= n; i++) {
    const u = -o.hu + (i / n) * o.hu * 2, ur = Math.max(-hu, Math.min(hu, u));
    for (const s of [-1, 1]) B.d.tube(P(u, s * o.hv, 0.15), P(ur, 0, r + 0.05), 0.05, 4, cols.frame);
  }
}

// --- heights -------------------------------------------------------------------------

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
/** [bottom, top] of a building or part, metres over its floor 0. */
function span(r, dflt) {
  const lv = num(r['building:levels']), mlv = num(r['building:min_level']);
  const h = num(r.height), mh = num(r.min_height);
  const top = h ?? (lv !== null ? lv * ST + 0.4 : dflt);
  const bot = mh ?? (mlv !== null ? mlv * ST : 0);
  return [bot, Math.max(bot + 2.5, top)];
}
function defaultTop(r) {
  const L = r.name && LOOKS[r.name];
  if (L && L.h) return L.h;
  if (r.building === 'dormitory') return 4 * ST + 0.4;
  if (r.building === 'chapel') return 6;
  return 3 * ST + 0.4;
}

// --- before meshing ----------------------------------------------------------------------

/**
 * Every campus building's box goes flat and is skipped by world.js and
 * kw.js buildPolys (kw.skip); it keeps a `kw.poly` of the real outline, so
 * kw.js's nameplates and stores still find the wall nearest the street.
 */
export function prepCampus(city) {
  BLD.length = 0;
  if (typeof window !== 'undefined' && window.__noCampus) return { buildings: 0, boxes: 0 };
  if (!U) return { buildings: 0, boxes: 0 };
  let boxes = 0;
  for (const r of [...U.b, ...((U.wlu && U.wlu.b) || [])]) {
    const [cx, cz] = centroid(r.p);
    const A = Math.abs(polyArea(r.p));
    const hit = new Set();
    for (const o of city.buildingsNear(cx, cz, 120)) {
      if (inPoly(r.p, o.x, o.z) && o.w * o.d < A * 3 + 300) hit.add(o);
    }
    const [, top] = span(r, defaultTop(r));
    for (const o of hit) {
      o.h = 0;
      if (!o.kw) o.kw = {};
      o.kw.skip = true;
      o.kw.uw = true;
      if (r.name && !o.kw.name) o.kw.name = r.name;
      o.kw.poly = { pts: r.p, h: top, n: r.name || '', bt: r.building, retail: false, arena: false, civic: false, fam: null };
      boxes++;
    }
    BLD.push({ r, cx, cz, base: T(cx, cz), A });
  }
  return { buildings: BLD.length, boxes };
}

// --- the buildings ---------------------------------------------------------------------------

function drawBuilding(kit, ctx, b) {
  const { r, cx, cz, base } = b;
  // University Stadium: the grandstand is drawn as one (laurierFields); OSM's
  // Stadium Building is the space under it (layer -1)
  if (r.campus === 'wlu' && (r.building === 'grandstand' || r.name === 'Stadium Building')) return;
  const B = kit.B(cx, cz);
  const st = styleOf(r);
  const parts = r.parts || [];
  const pa = parts.reduce((s, p) => s + Math.abs(polyArea(p.p)), 0);
  const [ob, ot] = span(r, defaultTop(r));
  const masses = [];
  if (parts.length && pa >= 0.7 * b.A) {
    for (const p of parts) masses.push({ p: p.p, sp: span(p, ot), st: PART_STY[p.id] || partStyle(p, st), id: p.id });
  } else {
    masses.push({ p: r.p, sp: [ob, ot], st, id: r.id });
    for (const p of parts) {
      const s = span(p, ot);
      if (s[0] > 0.5 || s[1] > ot + 0.5) masses.push({ p: p.p, sp: [Math.max(s[0], s[0] > 0.5 ? s[0] : ot), s[1]], st: PART_STY[p.id] || partStyle(p, st), id: p.id });
    }
  }
  for (const m of masses) {
    if (Math.abs(polyArea(m.p)) < 6) continue;
    const floating = m.sp[0] > 0.5;
    const y0 = floating ? base + m.sp[0] : lowest(m.p) - 1.2;
    mass(B, ctx.solids, m.p, base, y0, base + m.sp[1], m.st, { floating });
    STATS.parts++;
  }
  const sig = (r.campus !== 'wlu' && SIGS[r.ref]) || SIGS[r.name] || SIGS[r.id];
  if (sig) sig(kit, ctx, b, B, masses);
}

/** A part's own material where OSM gives one (DC's metal and glass, a glazed link). */
function partStyle(p, st) {
  const m = p['building:material'];
  if (st.low && (num(p['building:levels']) || 0) <= 2) return st.low;
  if (m === 'glass') return p['building:colour'] === 'teal' ? PART_STY[692354651] : STY.glass;
  if (m === 'metal' && st === BY.DC) return S({ wall: [0.74, 0.70, 0.60], win: 'ribbon', wf: 0.22, mp: 0, glass: C.glassDark, trim: [0.40, 0.40, 0.40] });
  return st;
}

// --- signatures ----------------------------------------------------------------------------

/** A tube bent through points (DC's ducts), r metres round. */
function pipe(B, pts, r, col) {
  for (let i = 0; i + 1 < pts.length; i++) B.tube(pts[i], pts[i + 1], r, 8, col, i === 0);
}

const SIGS = {
  // DC: grey-green gooseneck ducts rising beside the glass vault and arching
  // over onto it, red steel portal frames at the entrances
  DC(kit, ctx, b, B, masses) {
    const v = masses.find((m) => m.id === 692354659);
    if (!v) return;
    const o = obb(v.p), y = b.base + v.sp[1];
    const vx = -o.uz, vz = o.ux, duct = lin([0.52, 0.62, 0.58]), red = lin(C.red);
    // up the glass wall, over the eave and down onto the crown (the vault's
    // own section: eave radius ~3.4 m, crown ~3.4-5 m up)
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const u = -o.hu * 0.6 + i * o.hu * 0.6, sp = spanAt(v.p, o, u);
      if (!sp) continue;
      const ve = s < 0 ? sp[0] : sp[1];
      const P = (dv, h) => [o.x + o.ux * u + vx * (ve + s * dv), y + h, o.z + o.uz * u + vz * (ve + s * dv)];
      const pts = [P(1.6, -(y - b.base) * 0.55), P(1.6, 1.0), P(1.4, 3.4), P(0.4, 4.7), P(-1.6, 5.0), P(-3.6, 4.2)];
      pipe(B, pts, 0.7, duct);
    }
    // red portals at both ends of the vault
    for (const s of [-1, 1]) {
      const ex = o.x + o.ux * s * (o.hu + 3), ez = o.z + o.uz * s * (o.hu + 3), g = T(ex, ez);
      for (const k of [-1, 1]) {
        const px = ex + vx * k * 3.2, pz = ez + vz * k * 3.2;
        B.tube([px, g - 0.2, pz], [px, g + 9, pz], 0.22, 8, red);
      }
      B.box(ex, g + 8.6, ez, 7.2, 0.6, 0.45, Math.atan2(vz, vx), red);
      B.box(ex, g + 4.2, ez, 6.6, 0.35, 0.35, Math.atan2(vz, vx), red);
    }
  },
  // Dana Porter: the dark brown mechanical cap on the tower, and its mast
  LIB(kit, ctx, b, B, masses) {
    const t = masses.find((m) => m.id === 513745232);
    if (!t) return;
    const o = obb(t.p), y = b.base + t.sp[1] + 0.3, brown = lin([0.26, 0.20, 0.16]);
    const P = (u, v, h) => [o.x + o.ux * u - o.uz * v, y + h, o.z + o.uz * u + o.ux * v];
    const a = o.hu * 0.55, c = o.hv * 0.55, h = 3.2;
    B.quad(P(-a, -c, 0), P(a, -c, 0), P(a * 0.6, -c * 0.6, h), P(-a * 0.6, -c * 0.6, h), [0, 0.6, -0.8], U0, brown);
    B.quad(P(a, c, 0), P(-a, c, 0), P(-a * 0.6, c * 0.6, h), P(a * 0.6, c * 0.6, h), [0, 0.6, 0.8], U0, brown);
    B.quad(P(a, -c, 0), P(a, c, 0), P(a * 0.6, c * 0.6, h), P(a * 0.6, -c * 0.6, h), [0.8, 0.6, 0], U0, shade(brown, 0.85));
    B.quad(P(-a, c, 0), P(-a, -c, 0), P(-a * 0.6, -c * 0.6, h), P(-a * 0.6, c * 0.6, h), [-0.8, 0.6, 0], U0, shade(brown, 0.85));
    B.quad(P(-a * 0.6, -c * 0.6, h), P(a * 0.6, -c * 0.6, h), P(a * 0.6, c * 0.6, h), P(-a * 0.6, c * 0.6, h), [0, 1, 0], U0, brown);
    B.tube(P(0, 0, h), P(0, 0, h + 9), 0.15, 5, lin([0.5, 0.5, 0.5]));
  },
  // DC's glass bridge over the lane to EIT, on red steel pipe legs
  1028424096(kit, ctx, b, B, masses) {
    const m = masses[0];
    if (!m) return;
    const o = obb(m.p), y = b.base + m.sp[0], red = lin(C.red);
    for (const su of [-0.6, 0.6]) for (const sv of [-1, 1]) {
      const x = o.x + o.ux * su * o.hu - o.uz * sv * (o.hv - 0.3), z = o.z + o.uz * su * o.hu + o.ux * sv * (o.hv - 0.3);
      if (ctx.city.onRoad(x, z, 0.5, false)) continue;
      B.tube([x, T(x, z) - 0.2, z], [x, y, z], 0.2, 8, red);
    }
  },
  // MC: THE PINK TIE (the Math Faculty's emblem, Commons "UW-MathFaculty-
  // PinkTie"): ~12 m of pink tie hung down a fluted stair tower, on the
  // tower face Ring Road sees best
  MC(kit, ctx, b, B, masses) {
    const ring = U.ring || [];
    let best = null;
    for (const m of masses) {
      if (![664040399, 664040401, 664040406, 664040408].includes(m.id)) continue;
      for (const e of edges(m.p)) {
        if (e.L < 5) continue;
        // not against another of MC's masses
        const tx = e.mx + e.nx * 2.5, tz = e.mz + e.nz * 2.5;
        if (masses.some((o) => o !== m && o.sp[1] > m.sp[1] * 0.5 && inPoly(o.p, tx, tz))) continue;
        let rq = null, rd = Infinity;
        for (const q of ring) { const d = Math.hypot(q[0] - e.mx, q[1] - e.mz); if (d < rd) { rd = d; rq = q; } }
        if (!rq) continue;
        // the open ground in front of the face (a tie nobody can see is no tie), then Ring Road
        let open = 4;
        while (open < 120 && !insideAny(e.mx + e.nx * open, e.mz + e.nz * open)) open += 4;
        const s = open + 20 * (e.nx * (rq[0] - e.mx) + e.nz * (rq[1] - e.mz)) / rd;
        if (!best || s > best.s) best = { s, e, top: b.base + m.sp[1] };
      }
    }
    if (!best) return;
    const e = best.e, tc = e.L / 2, yt = best.top - 4.5, D = 0.32;
    const pink = lin([0.93, 0.36, 0.53]), knot = lin([0.82, 0.28, 0.44]), N = [e.nx, 0, e.nz];
    const at = (t, y) => e.at(tc + t, y, D);
    B.quad(at(-1.1, yt), at(1.1, yt), at(0.75, yt - 1.8), at(-0.75, yt - 1.8), N, U0, knot);
    B.quad(at(-0.75, yt - 1.85), at(0.75, yt - 1.85), at(1.9, yt - 10.4), at(-1.9, yt - 10.4), N, U0, pink);
    B.tri(at(-1.9, yt - 10.4), at(1.9, yt - 10.4), at(0, yt - 12.4), N, pink);
    STATS.tie = [Math.round(e.mx), Math.round(e.mz), Math.round(yt - b.base), +e.nx.toFixed(2), +e.nz.toFixed(2)];
  },
  // the CIF: red steel columns and beams along its walkway faces, the
  // walkway roof a sheet of white metal on them (Commons CIF_01-03)
  CIF(kit, ctx, b, B) {
    const red = lin([0.62, 0.12, 0.10]), roof = lin([0.86, 0.87, 0.88]);
    const r = towardRoad(ctx.city, b.cx, b.cz, 160);
    for (const e of edges(b.r.p)) {
      if (e.L < 24) continue;
      if (r && e.nx * r.nx + e.nz * r.nz < 0.3) continue;
      const g = T(e.mx + e.nx * 3, e.mz + e.nz * 3), h = 4.2, D = 3.2;
      const n = Math.max(2, Math.round(e.L / 7.5));
      for (let m = 0; m <= n; m++) {
        const t = 1 + (m / n) * (e.L - 2), p = e.at(t, 0, D);
        B.tube([p[0], g - 0.3, p[2]], [p[0], g + h, p[2]], 0.2, 6, red);
        const w0 = e.at(t, g + h, 0), w1 = e.at(t, g + h + 0.6, D + 0.4);
        B.d.tube(w0, w1, 0.14, 5, red);
        ctx.solids.push({ x: p[0], z: p[2], r: 0.25, y0: g - 1, y1: g + h });
      }
      const a = e.at(0.6, g + h + 0.6, D + 0.6), c = e.at(e.L - 0.6, g + h + 0.6, D + 0.6), a0 = e.at(0.6, g + h, 0), c0 = e.at(e.L - 0.6, g + h, 0);
      B.quad(a0, c0, c, a, [0, 1, 0], U0, roof);
      B.quad(a0, c0, c, a, [0, -1, 0], U0, shade(roof, 0.55));
      B.quad(e.at(0.6, g + h + 0.3, D + 0.62), e.at(e.L - 0.6, g + h + 0.3, D + 0.62), c, a, [e.nx, 0, e.nz], U0, red);
    }
  },
  // Laurier's Science Building: the octagonal brick corner tower, its
  // cream bands, a grey metal hipped cap (Commons "Science Building WLU")
  'Science Building'(kit, ctx, b, B, masses) {
    // the far (west) end of the long wing from King St, which ends in the
    // round bay OSM draws: the photo is from the lot by Alumni Field, the
    // tower at the building's left end
    const r = towardRoad(ctx.city, b.cx, b.cz, 160);
    if (!r) return;
    let q = null, qs = Infinity;
    for (const p of b.r.p) { const s = (p[0] - b.cx) * r.nx + (p[1] - b.cz) * r.nz; if (s < qs) { qs = s; q = p; } }
    const [cx, cz] = q, g = T(cx, cz) - 0.5, H = 5 * ST, R = 5.2;
    B.prism(cx, g, cz, R, H, 8, lin(WRB), Math.PI / 8);
    for (let k = 1; k < 5; k++) B.d.prism(cx, b.base + k * ST + 0.4, cz, R + 0.06, 0.55, 8, lin(CREAM), Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8 + Math.PI / 8;
      for (let f = 0; f < 5; f++) {
        const y = b.base + f * ST + 1.1, ux = -Math.sin(a), uz = Math.cos(a);
        const px = cx + Math.cos(a) * (R * 0.93 + 0.05), pz = cz + Math.sin(a) * (R * 0.93 + 0.05);
        B.quad([px - ux * 0.7, y, pz - uz * 0.7], [px + ux * 0.7, y, pz + uz * 0.7], [px + ux * 0.7, y + 1.9, pz + uz * 0.7], [px - ux * 0.7, y + 1.9, pz - uz * 0.7], [Math.cos(a), 0, Math.sin(a)], U0, lin([0.14, 0.17, 0.21]));
      }
    }
    B.cone(cx, g + H, cz, R + 0.6, 4.2, 8, lin([0.58, 0.60, 0.60]));
    ctx.solids.push({ x: cx, z: cz, r: R, y0: g, y1: g + H });
  },
  // Bricker Academic: the stair tower of dark glass up the middle of its
  // street face, standing a little proud and a storey taller
  'Bricker Academic Building'(kit, ctx, b, B, masses) {
    const r = towardRoad(ctx.city, b.cx, b.cz, 160);
    if (!r) return;
    let best = null;
    for (const e of edges(b.r.p)) { const s = (e.nx * r.nx + e.nz * r.nz) * e.L; if (!best || s > best.s) best = { s, e }; }
    const e = best.e, y0 = lowest(b.r.p) - 1, y1 = b.base + span(b.r, 20)[1] + 2.5;
    const w = 7, t0 = e.L / 2 - w / 2, t1 = e.L / 2 + w / 2, D = 1.2, N = [e.nx, 0, e.nz];
    const gl = lin([0.10, 0.12, 0.15]), fr = lin([0.30, 0.32, 0.34]);
    B.quad(e.at(t0, y0, D), e.at(t1, y0, D), e.at(t1, y1, D), e.at(t0, y1, D), N, U0, gl);
    for (const t of [t0, t1]) B.quad(e.at(t, y0, 0), e.at(t, y0, D), e.at(t, y1, D), e.at(t, y1, 0), [e.ux * (t === t0 ? -1 : 1), 0, e.uz * (t === t0 ? -1 : 1)], U0, gl);
    B.quad(e.at(t0, y1, 0), e.at(t1, y1, 0), e.at(t1, y1, D), e.at(t0, y1, D), [0, 1, 0], U0, fr);
    for (let y = b.base + ST; y < y1 - 1; y += ST) B.d.quad(e.at(t0, y, D + 0.05), e.at(t1, y, D + 0.05), e.at(t1, y + 0.3, D + 0.05), e.at(t0, y + 0.3, D + 0.05), N, U0, fr);
    for (const t of [t0 + w / 3, t0 + 2 * w / 3]) B.d.quad(e.at(t - 0.06, y0, D + 0.05), e.at(t + 0.06, y0, D + 0.05), e.at(t + 0.06, y1, D + 0.05), e.at(t - 0.06, y1, D + 0.05), N, U0, fr);
  },
  // Martin Luther University College: the seminary's bell tower -- two tall
  // pale concrete piers, three bells between them, a cross on top
  'Martin Luther University College'(kit, ctx, b, B) {
    const r = towardRoad(ctx.city, b.cx, b.cz, 160);
    if (!r) return;
    let best = null;
    for (const e of edges(b.r.p)) { const s = e.nx * r.nx + e.nz * r.nz; if (e.L > 8 && (!best || s > best.s)) best = { s, e }; }
    if (!best) return;
    const e = best.e, p = e.at(2.5, 0, 4), g = T(p[0], p[2]), conc = lin([0.86, 0.84, 0.78]), rot = Math.atan2(e.uz, e.ux);
    const H = 20;
    for (const s of [-1, 1]) B.box(p[0] + e.ux * s * 1.5, g - 0.3, p[2] + e.uz * s * 1.5, 0.7, H, 1.2, rot, conc);
    for (const y of [H * 0.55, H * 0.8, H - 0.6]) B.box(p[0], g + y, p[2], 3.6, 0.5, 1.2, rot, conc);
    for (const y of [H * 0.6, H * 0.67, H * 0.74]) B.d.cone(p[0], g + y, p[2], 0.45, 0.8, 8, lin([0.42, 0.34, 0.20]));
    B.box(p[0], g + H - 0.1, p[2], 0.22, 4.2, 0.22, rot, conc);
    B.box(p[0], g + H + 2.6, p[2], 1.8, 0.22, 0.22, rot, conc);
    ctx.solids.push({ x: p[0], z: p[2], hw: 2, hd: 0.7, rot, y0: g - 1, y1: g + H });
  },
  // Physics: the white observatory dome on the roof
  PHY(kit, ctx, b, B, masses) {
    const m = masses.reduce((a, c) => (c.sp[1] > a.sp[1] ? c : a), masses[0]);
    const [x, z] = centroid(m.p), y = b.base + m.sp[1];
    B.prism(x, y, z, 2.8, 2.2, 12, lin([0.86, 0.86, 0.84]));
    B.spheroid(x, y + 2.2, z, 2.8, 12, 5, lin([0.94, 0.94, 0.93]));
  },
  // E5: the bronze penthouse band and its two rooftop masts
  E5(kit, ctx, b, B, masses) {
    const m = masses.reduce((a, c) => (Math.abs(polyArea(c.p)) > Math.abs(polyArea(a.p)) ? c : a), masses[0]);
    const y = b.base + m.sp[1];
    const pts = inset(m.p, 6);
    if (Math.abs(polyArea(pts)) < 40) return;
    mass(B, null, pts, b.base, y, y + 3.6, S({ wall: [0.30, 0.24, 0.19], win: 'none', parapet: 0.2 }), { floating: false });
    const o = obb(pts);
    for (const s of [-1, 1]) B.tube([o.x + o.ux * s * o.hu * 0.6, y + 3.6, o.z + o.uz * s * o.hu * 0.6], [o.x + o.ux * s * o.hu * 0.6, y + 9, o.z + o.uz * s * o.hu * 0.6], 0.12, 5, lin([0.85, 0.85, 0.85]));
  },
  // SCH: the tall brick chimney on its roof
  SCH(kit, ctx, b, B, masses) {
    const [x, z] = centroid(b.r.p), y = b.base + span(b.r, 12)[1];
    B.box(x + 6, y - 1, z - 4, 2.2, 6, 2.2, 0.3, lin([0.45, 0.27, 0.20]));
  },
  // Conrad Grebel's chapel: rubble stone under a gabled roof, a cross on the gable
  'Conrad Grebel University College'(kit, ctx, b, B) {
    if (b.r.building !== 'chapel') return;
    const o = obb(b.r.p), y = b.base + 6, stone = lin([0.50, 0.46, 0.42]), roof = lin([0.30, 0.30, 0.31]);
    const P = (u, v, h) => [o.x + o.ux * u - o.uz * v, y + h, o.z + o.uz * u + o.ux * v];
    const R = 4.5;
    for (const s of [-1, 1]) {
      B.quad(P(-o.hu - 0.4, s * (o.hv + 0.4), -0.2), P(o.hu + 0.4, s * (o.hv + 0.4), -0.2), P(o.hu + 0.4, 0, R), P(-o.hu - 0.4, 0, R), [-o.uz * s * 0.7, 0.7, o.ux * s * 0.7], U0, roof);
      B.tri(P(s * o.hu, -o.hv, 0), P(s * o.hu, o.hv, 0), P(s * o.hu, 0, R), [o.ux * s, 0, o.uz * s], stone);
    }
    const c = P(o.hu + 0.1, 0, R);
    B.box(c[0], c[1], c[2], 0.25, 2.2, 0.25, 0, lin([0.9, 0.9, 0.88]));
    B.box(c[0], c[1] + 1.3, c[2], 0.25, 0.25, 1.2, Math.atan2(o.uz, o.ux), lin([0.9, 0.9, 0.88]));
  },
};

// --- the bridges ---------------------------------------------------------------------------

/** A box along a polyline: glass sides on a mullion grid, a light soffit and roof edge. */
function tubeBox(B, line, y0, y1, w, cols) {
  const { glass, frame, skin } = cols;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], c = line[i + 1];
    const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.3) continue;
    const ux = dx / L, uz = dz / L, nx = uz, nz = -ux;
    // run each segment w/2 past its ends so the bends close
    const e0 = i === 0 ? 0 : w / 2, e1 = i + 2 === line.length ? 0 : w / 2;
    const at = (t, y, v) => [a[0] + ux * t + nx * v, y, a[1] + uz * t + nz * v];
    const t0 = -e0, t1 = L + e1, h = w / 2;
    for (const s of [-1, 1]) {
      const N = [nx * s, 0, nz * s];
      B.quad(at(t0, y0, s * h), at(t1, y0, s * h), at(t1, y0 + 0.7, s * h), at(t0, y0 + 0.7, s * h), N, U0, skin);
      B.quad(at(t0, y0 + 0.7, s * h), at(t1, y0 + 0.7, s * h), at(t1, y1 - 0.5, s * h), at(t0, y1 - 0.5, s * h), N, U0, glass);
      B.quad(at(t0, y1 - 0.5, s * h), at(t1, y1 - 0.5, s * h), at(t1, y1, s * h), at(t0, y1, s * h), N, U0, skin);
      const n = Math.max(1, Math.round((t1 - t0) / 1.6));
      for (let m = 0; m <= n; m++) {
        const t = t0 + (m / n) * (t1 - t0);
        B.d.quad(at(t - 0.06, y0 + 0.7, s * (h + 0.04)), at(t + 0.06, y0 + 0.7, s * (h + 0.04)), at(t + 0.06, y1 - 0.5, s * (h + 0.04)), at(t - 0.06, y1 - 0.5, s * (h + 0.04)), N, U0, frame);
      }
    }
    B.quad(at(t0, y1, -h), at(t1, y1, -h), at(t1, y1, h), at(t0, y1, h), [0, 1, 0], U0, shade(skin, 0.8));
    B.quad(at(t0, y0, -h), at(t1, y0, -h), at(t1, y0, h), at(t0, y0, h), [0, -1, 0], U0, skin);
  }
}
function lineLen(l) {
  let s = 0;
  for (let i = 0; i + 1 < l.length; i++) s += Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]);
  return s;
}
/** The point `d` metres along a polyline. */
function along(l, d) {
  for (let i = 0; i + 1 < l.length; i++) {
    const L = Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]);
    if (d <= L || i + 2 === l.length) {
      const t = L > 0 ? Math.min(1, d / L) : 0;
      return [l[i][0] + (l[i + 1][0] - l[i][0]) * t, l[i][1] + (l[i + 1][1] - l[i][1]) * t];
    }
    d -= L;
  }
  return l[l.length - 1];
}
function insideAny(x, z) {
  for (const b of BLD) if (Math.abs(b.cx - x) < 200 && Math.abs(b.cz - z) < 200 && inPoly(b.r.p, x, z)) return true;
  return false;
}

function bridges(kit, ctx) {
  const city = ctx.city;
  for (const br of U.bridges) {
    const l = br.l, L = lineLen(l);
    const mid = along(l, L / 2);
    const B = kit.B(mid[0], mid[1]);
    let tmax = -Infinity;
    for (let d = 0; d <= L; d += 4) { const p = along(l, d); tmax = Math.max(tmax, T(p[0], p[1])); }
    if (br.n === 'E5 Bridge') {
      // THE E5 BRIDGE: one storey of dark blue glass on a silver mullion grid,
      // ~7 m over Ring Road and the ION tracks, on round grey columns, from
      // E5 to E3's third floor
      const y0 = tmax + 6.8, y1 = y0 + 4.4;
      tubeBox(B, l, y0, y1, 4.6, { glass: lin([0.10, 0.17, 0.30]), frame: lin([0.74, 0.76, 0.78]), skin: lin([0.84, 0.85, 0.85]) });
      const conc = lin([0.70, 0.70, 0.68]);
      // no street tree grows up through it
      if (ctx.clearAt) for (let d = 0; d <= L; d += 6) { const p = along(l, d); ctx.clearAt.push([p[0], p[1], 7]); }
      for (let d = 14; d < L - 8; d += 17) {
        const p = along(l, d);
        if (city.onRoad(p[0], p[1], 1.2, false) || insideAny(p[0], p[1])) continue;
        const g = T(p[0], p[1]);
        B.tube([p[0], g - 0.3, p[1]], [p[0], y0, p[1]], 0.6, 10, conc);
        ctx.solids.push({ x: p[0], z: p[1], hw: 0.6, hd: 0.6, rot: 0, y0: g - 0.3, y1: y0 });
      }
      STATS.e5 = { len: Math.round(L), y0: +(y0 - tmax).toFixed(1) };
      STATS.bridges++;
      continue;
    }
    if (br.n === 'REV') {
      // REV's covered walkway over Laurel Creek: a flat roof on posts
      const y0 = Math.max(T(l[0][0], l[0][1]), T(l[l.length - 1][0], l[l.length - 1][1])) + 0.2;
      const brick = lin(C.v1Brick), roof = lin([0.30, 0.30, 0.31]);
      for (let i = 0; i + 1 < l.length; i++) {
        const a = l[i], c = l[i + 1], dx = c[0] - a[0], dz = c[1] - a[1], Ls = Math.hypot(dx, dz);
        const rot = Math.atan2(dz, dx);
        B.box((a[0] + c[0]) / 2, y0 + 2.7, (a[1] + c[1]) / 2, Ls, 0.35, 3.6, rot, roof);
        B.box((a[0] + c[0]) / 2, y0 - 0.25, (a[1] + c[1]) / 2, Ls, 0.25, 2.6, rot, lin([0.6, 0.6, 0.58]));
        const ux = dx / Ls, uz = dz / Ls;
        for (let d = 0; d <= Ls; d += 4.5) for (const s of [-1, 1]) {
          B.box(a[0] + ux * d - uz * s * 1.5, y0, a[1] + uz * d + ux * s * 1.5, 0.45, 2.7, 0.45, rot, brick);
        }
      }
      STATS.bridges++;
      continue;
    }
    // the rest: a one-storey glazed link at the second floor, unless OSM
    // already draws it as a building (a building=bridge or a raised part)
    if (L < 6 || insideAny(mid[0], mid[1])) continue;
    const y0 = tmax + ST * Math.max(1, Math.min(2, br.layer)) - 0.3;
    tubeBox(B, l, y0, y0 + 3.6, 3.6, { glass: lin([0.18, 0.25, 0.30]), frame: lin([0.80, 0.81, 0.82]), skin: lin([0.80, 0.80, 0.78]) });
    STATS.bridges++;
  }
}

// --- lettering --------------------------------------------------------------------------------

class Atlas {
  constructor(w = 1024, h = 512) {
    this.c = document.createElement('canvas');
    this.c.width = w; this.c.height = h;
    this.g = this.c.getContext('2d');
    this.x = 0; this.y = 0; this.row = 0; this.full = 0;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false });
    this.mat.userData.noShadow = true;
  }
  panel(w, h, px, draw) {
    const W = Math.min(1024, Math.round(w * px)), H = Math.min(256, Math.round(h * px));
    if (this.x + W > this.c.width) { this.x = 0; this.y += this.row + 2; this.row = 0; }
    if (this.y + H > this.c.height) this.full++;
    const x = this.x, y = this.y;
    this.x += W + 2; this.row = Math.max(this.row, H);
    const g = this.g;
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, W, H); g.clip();
    draw(g, W, H);
    g.restore();
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    const u0 = (x + 0.5) / this.c.width, u1 = (x + W - 0.5) / this.c.width;
    const v0 = 1 - (y + H - 0.5) / this.c.height, v1 = 1 - (y + 0.5) / this.c.height;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
    return new THREE.Mesh(geo, this.mat);
  }
}
const SANS = 'Helvetica, Arial, sans-serif';
/** Brushed-steel letters on nothing (the sculptures). */
function steelLetters(A, lines, w, h) {
  return A.panel(w, h, 40, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    const fs = (H / lines.length) * 0.8;
    g.font = `800 ${fs}px ${SANS}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((t, i) => {
      const y = (H / lines.length) * (i + 0.52);
      const gr = g.createLinearGradient(0, y - fs / 2, 0, y + fs / 2);
      gr.addColorStop(0, '#f2f3f4'); gr.addColorStop(0.5, '#a9adb1'); gr.addColorStop(1, '#d8dadc');
      g.lineWidth = fs * 0.06; g.strokeStyle = '#3a3c3e';
      g.strokeText(t, W / 2, y, W * 0.98);
      g.fillStyle = gr; g.fillText(t, W / 2, y, W * 0.98);
    });
  });
}
/** The gate sign's face: black, the gold shield, UNIVERSITY OF WATERLOO in white. */
function gatePanel(A, w, h) {
  return A.panel(w, h, 48, (g, W, H) => {
    g.fillStyle = '#121212'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fed34c'; g.fillRect(0, H * 0.86, W, H * 0.14);
    // the shield: gold, a black chevron, three red lions (as dots)
    const sx = H * 0.12, sw = H * 0.5, sy = H * 0.12, sh = H * 0.62;
    g.fillStyle = '#fed34c';
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + sw, sy); g.lineTo(sx + sw, sy + sh * 0.6);
    g.quadraticCurveTo(sx + sw, sy + sh, sx + sw / 2, sy + sh); g.quadraticCurveTo(sx, sy + sh, sx, sy + sh * 0.6); g.closePath(); g.fill();
    g.strokeStyle = '#121212'; g.lineWidth = sw * 0.14;
    g.beginPath(); g.moveTo(sx + sw * 0.08, sy + sh * 0.62); g.lineTo(sx + sw / 2, sy + sh * 0.32); g.lineTo(sx + sw * 0.92, sy + sh * 0.62); g.stroke();
    g.fillStyle = '#c8102e';
    for (const [px, py] of [[0.25, 0.2], [0.75, 0.2], [0.5, 0.78]]) { g.beginPath(); g.arc(sx + sw * px, sy + sh * py, sw * 0.09, 0, 7); g.fill(); }
    g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = `700 ${H * 0.2}px ${SANS}`;
    g.fillText('UNIVERSITY OF', sx + sw + H * 0.14, H * 0.3, W - sx - sw - H * 0.2);
    g.font = `800 ${H * 0.32}px ${SANS}`;
    g.fillText('WATERLOO', sx + sw + H * 0.12, H * 0.6, W - sx - sw - H * 0.2);
  });
}
function hang(g, mesh, x, y, z, nx, nz, off = 0.06) {
  mesh.position.set(x + nx * off, y, z + nz * off);
  mesh.rotation.y = Math.atan2(nx, nz);
  g.add(mesh);
}

/** The direction from (x, z) to the nearest street's kerb, and how far. */
function towardRoad(city, x, z, r = 80) {
  let best = null;
  for (const ei of city.edgesNear(x, z, r)) {
    const e = city.edges[ei];
    if (e.elev || e.tunnel) continue;
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(e.len, (x - a.x) * e.dx + (z - a.z) * e.dz));
    const qx = a.x + e.dx * t, qz = a.z + e.dz * t, d = Math.hypot(x - qx, z - qz);
    if (!best || d < best.d) best = { d, nx: (qx - x) / (d || 1), nz: (qz - z) / (d || 1), qx, qz, hw: e.hw, name: e.name || '' };
  }
  return best;
}

// --- the campus's things -----------------------------------------------------------------------

function landmarks(kit, ctx, A) {
  const P = U.pois || {}, city = ctx.city;
  // UNIVERSITY OF WATERLOO: the steel letters on their plinth by the main gate
  if (P.letters) {
    const [x, z] = P.letters, g = T(x, z), B = kit.B(x, z), grp = kit.grp(x, z);
    const r = towardRoad(city, x, z) || { nx: 0, nz: 1 };
    const rot = Math.atan2(r.nx, r.nz);
    const ux = Math.cos(rot), uz = -Math.sin(rot);
    B.box(x, g - 0.3, z, 17.5, 0.9, 1.4, Math.atan2(uz, ux), lin([0.62, 0.61, 0.58]));
    hang(grp, steelLetters(A, ['UNIVERSITY OF WATERLOO'], 17, 1.7), x, g + 1.45, z, r.nx, r.nz, 0.0);
    ctx.solids.push({ x, z, hw: 8.8, hd: 0.7, rot: Math.atan2(uz, ux), y0: g - 0.3, y1: g + 2.3 });
  }
  // the Plant Operations stack: a tall, slightly tapered round brown-brick chimney
  if (P.stack) {
    const [x, z] = P.stack, g = T(x, z), B = kit.B(x, z), brick = lin([0.50, 0.38, 0.30]);
    const H = 46, n = 6;
    for (let i = 0; i < n; i++) {
      const r0 = 2.2 - (i / n) * 0.7, r1 = 2.2 - ((i + 1) / n) * 0.7;
      const y0 = g - 0.5 + (i / n) * H, y1 = g - 0.5 + ((i + 1) / n) * H;
      // a frustum ring of 12 quads
      for (let k = 0; k < 12; k++) {
        const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2, am = (a0 + a1) / 2;
        B.quad([x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0], [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0],
          [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1], [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1], [Math.cos(am), 0.02, Math.sin(am)], U0, i === n - 1 ? shade(brick, 0.55) : brick);
      }
    }
    ctx.solids.push({ x, z, hw: 2.2, hd: 2.2, rot: 0, y0: g - 1, y1: g + H });
  }
  // Ron Baird's Triad (1965): two tall grey steel posts with a starburst on top
  if (P.triad) {
    const [x, z] = P.triad, g = T(x, z), B = kit.B(x, z), steel = lin([0.52, 0.54, 0.56]);
    B.d.box(x, g - 0.2, z, 2.2, 0.6, 1.4, 0.4, lin([0.70, 0.69, 0.66]));
    for (const s of [-0.5, 0.5]) B.d.box(x + s * 0.9, g + 0.4, z + s * 0.4, 0.25, 4.5, 0.25, 0.4, steel);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      B.d.tube([x, g + 5.0, z], [x + Math.cos(a) * 1.3, g + 5.0 + Math.sin(a) * 1.3, z + 0.2], 0.08, 4, steel);
    }
  }
  // Bachinski's Obelisk (1975) by the SLC
  if (P.obelisk) {
    const [x, z] = P.obelisk, g = T(x, z), B = kit.B(x, z);
    B.d.box(x, g - 0.2, z, 1.0, 0.6, 1.0, 0.3, lin([0.66, 0.65, 0.62]));
    B.d.prism(x, g + 0.4, z, 0.42, 5.2, 4, lin([0.30, 0.25, 0.20]), Math.PI / 4);
    B.d.cone(x, g + 5.6, z, 0.42, 0.7, 4, lin([0.30, 0.25, 0.20]));
  }
  // the Porcellino: a bronze boar on a stone plinth
  if (P.boar) {
    const [x, z] = P.boar, g = T(x, z), B = kit.B(x, z), br = lin([0.36, 0.26, 0.16]);
    B.d.box(x, g - 0.2, z, 1.6, 1.0, 0.8, 0, lin([0.62, 0.62, 0.60]));
    B.d.spheroid(x, g + 1.25, z, 0.55, 8, 5, br, 0.7);
    B.d.box(x + 0.62, g + 1.05, z, 0.42, 0.34, 0.34, 0, br);
    for (const dx of [-0.32, 0.32]) for (const dz of [-0.16, 0.16]) B.d.box(x + dx, g + 0.8, z + dz, 0.12, 0.35, 0.12, 0, br);
  }
  // grey limestone boulders: the campus's edging, round the gate's flagpoles in front of SCH
  const sch = BLD.find((b) => b.r.ref === 'SCH');
  if (sch) {
    const r = towardRoad(city, sch.cx, sch.cz, 120);
    if (r) {
      const fx = r.qx - r.nx * (r.hw + 9), fz = r.qz - r.nz * (r.hw + 9);
      if (!insideAny(fx, fz)) {
        const B = kit.B(fx, fz), stone = lin([0.78, 0.77, 0.74]), g = T(fx, fz);
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2, rr = 4.6;
          B.d.spheroid(fx + Math.cos(a) * rr, g + 0.2, fz + Math.sin(a) * rr, 0.55 + hash2(k, 9) * 0.3, 6, 3, shade(stone, 0.9 + hash2(k, 4) * 0.15), 0.6, 0.15);
        }
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + 0.3;
          const px = fx + Math.cos(a) * 1.8, pz = fz + Math.sin(a) * 1.8;
          B.d.tube([px, g, pz], [px, g + 12, pz], 0.08, 5, lin([0.82, 0.83, 0.84]));
        }
        STATS.gate = [Math.round(fx), Math.round(fz)];
      }
    }
  }
  // the gate signs: black with the gold shield, where Ring Road meets
  // University Ave (by Seagram Dr), and the north gate where North Campus
  // Road leaves Columbia St (on the corner toward campus, facing Columbia)
  const gates = [];
  {
    const r = towardRoad(city, -5232, -1868, 40);
    if (r) {
      for (const off of [7, 9, 11, 13]) {
        for (const sgn of [1, -1]) {
          const cx = r.qx - r.nx * (r.hw + off) + r.nz * sgn * 6, cz = r.qz - r.nz * (r.hw + off) - r.nx * sgn * 6;
          if (gates.length < 1 && !city.onRoad(cx, cz, 3, false) && !insideAny(cx, cz)) gates.push([cx, cz, r.nx, r.nz]);
        }
      }
    }
    const q = junction(city, 'Columbia Street West', 'North Campus Road', -5800, -2560, 300);
    STATS.northGate = q ? [Math.round(q.x), Math.round(q.z)] : null;
    if (q) {
      const s = cornerSpot(city, q, q.x + 94, q.z + 33, 10);
      if (s) {
        // face up Columbia St: square to the street, not to the corner
        const c = towardRoad(city, s[0], s[1], 40);
        gates.push([s[0], s[1], c && /Columbia/.test(c.name) ? c.nx : s[2], c && /Columbia/.test(c.name) ? c.nz : s[3]]);
      }
    }
  }
  for (const [sx, sz, nx, nz] of gates) {
    const r = { nx, nz };
    const g = T(sx, sz), B = kit.B(sx, sz), grp = kit.grp(sx, sz);
    const rot = Math.atan2(r.nx, r.nz), ux = Math.cos(rot), uz = -Math.sin(rot);
    B.box(sx, g - 0.4, sz, 7.0, 2.4, 0.9, Math.atan2(uz, ux), lin([0.56, 0.52, 0.47]));
    B.box(sx, g + 2.0, sz, 7.2, 0.2, 1.0, Math.atan2(uz, ux), lin([0.40, 0.38, 0.35]));
    hang(grp, gatePanel(A, 5.6, 1.5), sx, g + 1.0, sz, r.nx, r.nz, 0.47);
    hang(grp, gatePanel(A, 5.6, 1.5), sx, g + 1.0, sz, -r.nx, -r.nz, 0.47);
    ctx.solids.push({ x: sx, z: sz, hw: 3.5, hd: 0.45, rot: Math.atan2(uz, ux), y0: g - 0.4, y1: g + 2.2 });
    (STATS.gates = STATS.gates || []).push([Math.round(sx), Math.round(sz)]);
  }
  // WATERLOO ENGINEERING: polished-steel letters at E7, toward Ring Road
  const e7 = BLD.find((b) => b.r.ref === 'PSE');
  if (e7) {
    const r = towardRoad(city, e7.cx, e7.cz, 120);
    if (r) {
      // the wall of E7 facing that road, and 4 m in front of it
      let best = null;
      for (const e of edges(e7.r.p)) {
        const s = e.nx * r.nx + e.nz * r.nz;
        if (e.L > 14 && (!best || s > best.s)) best = { e, s };
      }
      if (best) {
        const e = best.e, x = e.mx + e.nx * 4, z = e.mz + e.nz * 4, g = T(x, z);
        const B = kit.B(x, z), grp = kit.grp(x, z);
        B.box(x, g - 0.3, z, 10, 0.75, 1.0, Math.atan2(e.uz, e.ux), lin([0.74, 0.73, 0.70]));
        hang(grp, steelLetters(A, ['WATERLOO', 'ENGINEERING'], 9.4, 3.0), x, g + 1.95, z, e.nx, e.nz, 0);
        ctx.solids.push({ x, z, hw: 5, hd: 0.55, rot: Math.atan2(e.uz, e.ux), y0: g - 0.3, y1: g + 3.5 });
      }
    }
  }
}

// --- Wilfrid Laurier University --------------------------------------------------------------------

const PURPLE = '#4f2683', GOLD = '#f2a900';

/** The LAURIER sign's face (Commons "WLU 2014 Sign"): white, LAURIER and the maple leaf in purple, the name in white on dark stone below. */
function laurierPanel(A, w, h) {
  return A.panel(w, h, 48, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H * 0.66);
    g.fillStyle = '#2d2a2e'; g.fillRect(0, H * 0.66, W, H * 0.34);
    g.fillStyle = PURPLE; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = `700 ${H * 0.36}px ${SANS}`;
    g.fillText('LAURIER', W * 0.05, H * 0.43, W * 0.62);
    g.font = `italic 400 ${H * 0.11}px Georgia, serif`;
    g.fillText('Inspiring Lives.', W * 0.30, H * 0.58, W * 0.4);
    // the maple leaf: eleven points round a centre, a short stem
    const cx = W * 0.82, cy = H * 0.30, R = H * 0.25;
    g.beginPath();
    const pts = [[0, -1], [0.18, -0.62], [0.42, -0.72], [0.36, -0.3], [0.84, -0.42], [0.72, -0.14], [0.98, 0.06], [0.5, 0.3], [0.56, 0.52], [0.08, 0.42], [0.06, 0.82],
      [-0.06, 0.82], [-0.08, 0.42], [-0.56, 0.52], [-0.5, 0.3], [-0.98, 0.06], [-0.72, -0.14], [-0.84, -0.42], [-0.36, -0.3], [-0.42, -0.72], [-0.18, -0.62]];
    pts.forEach(([x, y], i) => (i ? g.lineTo(cx + x * R, cy + y * R) : g.moveTo(cx + x * R, cy + y * R)));
    g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.textAlign = 'center';
    g.font = `700 ${H * 0.15}px ${SANS}`;
    g.fillText('WILFRID LAURIER UNIVERSITY', W / 2, H * 0.88, W * 0.9);
  });
}
/** University Stadium's scoreboard: Laurier purple, GOLDEN HAWKS in gold over the score. */
function scorePanel(A, w, h) {
  return A.panel(w, h, 36, (g, W, H) => {
    g.fillStyle = PURPLE; g.fillRect(0, 0, W, H);
    g.fillStyle = GOLD; g.fillRect(0, H * 0.36, W, H * 0.03);
    g.fillStyle = GOLD; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${H * 0.24}px ${SANS}`;
    g.fillText('LAURIER GOLDEN HAWKS', W / 2, H * 0.19, W * 0.92);
    g.fillStyle = '#111111';
    for (const x of [0.08, 0.62]) g.fillRect(W * x, H * 0.5, W * 0.3, H * 0.38);
    g.fillStyle = '#ffffff'; g.font = `700 ${H * 0.12}px ${SANS}`;
    g.fillText('HAWKS', W * 0.23, H * 0.45); g.fillText('VISITOR', W * 0.77, H * 0.45);
    g.fillStyle = '#ffb000'; g.font = `700 ${H * 0.3}px ${SANS}`;
    g.fillText('00', W * 0.23, H * 0.7); g.fillText('00', W * 0.77, H * 0.7);
  });
}
/** The golden hawk painted at centre field: a gold bird, wings spread, on transparent turf. */
function hawkPanel(A, w, h) {
  return A.panel(w, h, 14, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = GOLD;
    const P = (x, y) => [W * x, H * y];
    g.beginPath();
    // a stylised hawk in flight: swept wings, fanned tail, hooked head to the left
    for (const [i, q] of [[0, P(0.03, 0.40)], [1, P(0.30, 0.30)], [1, P(0.40, 0.08)], [1, P(0.50, 0.30)], [1, P(0.62, 0.26)], [1, P(0.98, 0.10)],
      [1, P(0.70, 0.45)], [1, P(0.95, 0.70)], [1, P(0.66, 0.62)], [1, P(0.58, 0.95)], [1, P(0.46, 0.62)], [1, P(0.22, 0.52)], [1, P(0.10, 0.50)]]) {
      if (i) g.lineTo(...q); else g.moveTo(...q);
    }
    g.closePath(); g.fill();
    g.fillStyle = PURPLE; g.beginPath(); g.arc(W * 0.15, H * 0.42, H * 0.03, 0, 7); g.fill();
  });
}

/** (x, z) in field frame o: u along the field, v across. */
const FP = (o, u, v) => [o.x + o.ux * u - o.uz * v, o.z + o.uz * u + o.ux * v];

/**
 * A Canadian football field on its OSM pitch: 110 yd between the goal
 * lines, 20 yd end zones, 65 yd wide, scaled down to fit a smaller pitch;
 * artificial turf laid on the terrain in 10 m tiles, the yard lines every
 * 5 yd, hash marks, the goal posts. End zones in Laurier purple at the stadium.
 */
function gridiron(kit, ctx, pts, opts = {}) {
  const o = obb(pts);
  if (!o) return null;
  const YD = 0.9144, s = Math.min(1, (o.hu * 2 - 6) / (150 * YD), (o.hv * 2 - 6) / (65 * YD));
  const hu = 75 * YD * s, hv = 32.5 * YD * s, gl = 55 * YD * s;
  const B = kit.B(o.x, o.z), D = B.d;
  const TURF = lin([0.21, 0.40, 0.21]), TURF2 = lin([0.24, 0.44, 0.23]), LINE = lin([0.95, 0.95, 0.92]), EZ = lin(opts.ez || [0.20, 0.42, 0.20]);
  const Y = (u, v, l) => { const [x, z] = FP(o, u, v); return [x, T(x, z) + l, z]; };
  // the turf (and the apron round it, a shade darker), tiled so it follows the ground
  const tile = (u0, u1, v0, v1, col, l) => {
    const n = Math.max(1, Math.ceil((u1 - u0) / 10)), m = Math.max(1, Math.ceil((v1 - v0) / 10));
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const a0 = u0 + (u1 - u0) * i / n, a1 = u0 + (u1 - u0) * (i + 1) / n, b0 = v0 + (v1 - v0) * j / m, b1 = v0 + (v1 - v0) * (j + 1) / m;
      B.quad(Y(a0, b0, l), Y(a1, b0, l), Y(a1, b1, l), Y(a0, b1, l), [0, 1, 0], U0, col);
    }
  };
  tile(-o.hu + 1, o.hu - 1, -o.hv + 1, o.hv - 1, TURF, 0.10);
  for (let k = 0; k < 11; k++) if (k % 2) tile(-gl + (k * 10 * YD * s), -gl + ((k + 1) * 10 * YD * s), -hv, hv, TURF2, 0.13);
  for (const sg of [-1, 1]) tile(sg > 0 ? gl : -hu, sg > 0 ? hu : -gl, -hv, hv, EZ, 0.13);
  // lines: the sidelines and end lines, every 5 yd, short hash marks
  const strip = (u0, v0, u1, v1, w) => {
    const L = Math.hypot(u1 - u0, v1 - v0), n = Math.max(1, Math.ceil(L / 10));
    const du = (u1 - u0) / L, dv = (v1 - v0) / L, pu = -dv * w, pv = du * w;
    for (let i = 0; i < n; i++) {
      const a = i / n, c = (i + 1) / n;
      const ua = u0 + (u1 - u0) * a, va = v0 + (v1 - v0) * a, uc = u0 + (u1 - u0) * c, vc = v0 + (v1 - v0) * c;
      D.quad(Y(ua - pu, va - pv, 0.17), Y(uc - pu, vc - pv, 0.17), Y(uc + pu, vc + pv, 0.17), Y(ua + pu, va + pv, 0.17), [0, 1, 0], U0, LINE);
    }
  };
  for (const sg of [-1, 1]) { strip(-hu, sg * hv, hu, sg * hv, 0.1); strip(sg * hu, -hv, sg * hu, hv, 0.1); }
  for (let k = 0; k <= 22; k++) {
    const u = -gl + k * 5 * YD * s;
    strip(u, -hv, u, hv, k === 0 || k === 22 ? 0.12 : 0.06);
    for (const v of [-hv * 0.36, hv * 0.36]) for (let m = 1; m < 5; m++) strip(u + m * YD * s - 0.3, v, u + m * YD * s + 0.3, v, 0.05);
  }
  // goal posts on the goal lines (Canadian), gold
  const post = lin([0.95, 0.80, 0.15]);
  for (const sg of [-1, 1]) {
    const [x, z] = FP(o, sg * gl, 0), g = T(x, z);
    B.tube([x, g, z], [x, g + 3.0, z], 0.12, 6, post);
    const [ax, az] = FP(o, sg * gl, -2.8), [bx, bz] = FP(o, sg * gl, 2.8);
    B.tube([ax, g + 3.0, az], [bx, g + 3.0, bz], 0.08, 5, post);
    for (const [px, pz] of [[ax, az], [bx, bz]]) B.tube([px, g + 3.0, pz], [px, g + 12, pz], 0.06, 5, post);
    ctx.solids.push({ x, z, r: 0.25, y0: g - 1, y1: g + 3 });
  }
  if (ctx.clearAt) ctx.clearAt.push([o.x, o.z, Math.min(o.hu, o.hv) + 2]);
  return { o, hu, hv };
}

/** The running track: every 2.5 m cell of the track polygon outside the field, terracotta, on the ground. */
function trackRing(kit, pts, f) {
  const o = obb(pts);
  if (!o) return;
  const B = kit.B(o.x, o.z), RED = lin([0.54, 0.25, 0.19]), c = 2.5;
  const Y = (u, v) => { const [x, z] = FP(o, u, v); return [x, T(x, z) + 0.07, z]; };
  for (let u = -o.hu; u < o.hu; u += c) for (let v = -o.hv; v < o.hv; v += c) {
    const [x, z] = FP(o, u + c / 2, v + c / 2);
    if (!inPoly(pts, x, z)) continue;
    if (f) {
      const lu = (x - f.o.x) * f.o.ux + (z - f.o.z) * f.o.uz, lv = -(x - f.o.x) * f.o.uz + (z - f.o.z) * f.o.ux;
      if (Math.abs(lu) < f.o.hu - 1 && Math.abs(lv) < f.o.hv - 1) continue;
    }
    B.quad(Y(u, v), Y(u + c, v), Y(u + c, v + c), Y(u, v + c), [0, 1, 0], U0, RED);
  }
}

/** University Stadium's grandstand from its OSM footprint: concrete rows rising away from the field, purple seats, a press box on top. */
function grandstand(kit, ctx, r, field) {
  const o = obb(r.p);
  if (!o || !field) return;
  // which long side faces the field
  const sg = ((field.o.x - o.x) * -o.uz + (field.o.z - o.z) * o.ux) > 0 ? 1 : -1;
  const B = kit.B(o.x, o.z), CONC = lin([0.72, 0.71, 0.68]), SEAT = lin([0.31, 0.15, 0.51]), GLASS = lin([0.16, 0.20, 0.26]);
  const g = lowest(r.p), H = 9.5, front = 1.4, rows = 14, dep = o.hv * 2 - 1;
  const P = (u, v, y) => { const [x, z] = FP(o, u, v); return [x, y, z]; };
  const vf = sg * (o.hv - 0.5);   // the front edge's v; rows go toward -sg
  for (let i = 0; i < rows; i++) {
    const v0 = vf - sg * (i / rows) * dep, v1 = vf - sg * ((i + 1) / rows) * dep;
    const y0 = g + front + (i / rows) * (H - front), y1 = g + front + ((i + 1) / rows) * (H - front);
    B.quad(P(-o.hu, v0, y0), P(o.hu, v0, y0), P(o.hu, v0, y1), P(-o.hu, v0, y1), [-o.uz * sg, 0, o.ux * sg], U0, CONC);
    B.quad(P(-o.hu, v0, y1), P(o.hu, v0, y1), P(o.hu, v1, y1), P(-o.hu, v1, y1), [0, 1, 0], U0, i % 2 ? CONC : SEAT);
  }
  const vb = vf - sg * dep;
  B.quad(P(-o.hu, vb, g - 0.5), P(o.hu, vb, g - 0.5), P(o.hu, vb, g + H), P(-o.hu, vb, g + H), [o.uz * sg, 0, -o.ux * sg], U0, CONC);
  for (const s of [-1, 1]) {
    B.quad(P(s * o.hu, vf, g - 0.5), P(s * o.hu, vb, g - 0.5), P(s * o.hu, vb, g + H), P(s * o.hu, vf, g + front), [o.ux * s, 0, o.uz * s], U0, CONC);
  }
  // the press box along the top
  const pb = vb + sg * 4, pw = o.hu * 0.45;
  const [bx, bz] = FP(o, 0, (pb + vb) / 2);
  B.box(bx, g + H, bz, pw * 2, 3.4, 4, Math.atan2(o.uz, o.ux), lin([0.80, 0.79, 0.76]));
  B.quad(P(-pw + 0.4, pb + sg * 0.03, g + H + 0.8), P(pw - 0.4, pb + sg * 0.03, g + H + 0.8), P(pw - 0.4, pb + sg * 0.03, g + H + 2.8), P(-pw + 0.4, pb + sg * 0.03, g + H + 2.8), [-o.uz * sg, 0, o.ux * sg], U0, GLASS);
  ctx.solids.push({ x: o.x, z: o.z, hw: o.hu, hd: o.hv, rot: Math.atan2(o.uz, o.ux), y0: g - 1, y1: g + H });
}

/** The node where streets named a and b meet, nearest (x, z). */
function junction(city, a, b, x, z, r = 300) {
  const na = new Set(), nb = new Set();
  for (const ei of city.edgesNear(x, z, r)) {
    const e = city.edges[ei], n = e.name || '';
    if (n.includes(a)) { na.add(e.a); na.add(e.b); }
    if (n.includes(b)) { nb.add(e.a); nb.add(e.b); }
  }
  let best = null, bd = Infinity;
  for (const i of na) if (nb.has(i)) { const q = city.nodes[i], d = Math.hypot(q.x - x, q.z - z); if (d < bd) { bd = d; best = q; } }
  return best;
}
/** A spot on the corner of junction q toward (tx, tz), clear of the road and of buildings. */
function cornerSpot(city, q, tx, tz, k0 = 14) {
  const a0 = Math.atan2(tz - q.z, tx - q.x);
  for (const da of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
    const dx = Math.cos(a0 + da), dz = Math.sin(a0 + da);
    for (let k = k0; k < k0 + 24; k += 2) {
      const x = q.x + dx * k, z = q.z + dz * k;
      if (!city.onRoad(x, z, 3, false) && !insideAny(x, z)) return [x, z, -dx, -dz];
    }
  }
  return null;
}
/** A sign on a low stone plinth at (x, z) facing (nx, nz), both faces. */
function plinthSign(kit, ctx, panel, x, z, nx, nz, w, h) {
  const g = T(x, z), B = kit.B(x, z), grp = kit.grp(x, z);
  const rot = Math.atan2(nx, nz), ux = Math.cos(rot), uz = -Math.sin(rot);
  B.box(x, g - 0.4, z, w + 0.6, 1.1, 1.0, Math.atan2(uz, ux), lin([0.42, 0.40, 0.38]));
  B.box(x, g + 0.7, z, w + 0.1, h, 0.5, Math.atan2(uz, ux), lin([0.30, 0.29, 0.30]));
  hang(grp, panel(), x, g + 0.7 + h / 2, z, nx, nz, 0.27);
  hang(grp, panel(), x, g + 0.7 + h / 2, z, -nx, -nz, 0.27);
  // boulders and a bed of flowers in front
  for (let k = 0; k < 5; k++) {
    const t = (k - 2) * (w / 4.5), px = x + ux * t + nx * 1.6, pz = z + uz * t + nz * 1.6;
    B.d.spheroid(px, g + 0.15, pz, 0.45 + hash2(k, 31) * 0.25, 6, 3, lin([0.74, 0.72, 0.68]), 0.6, 0.15);
  }
  ctx.solids.push({ x, z, hw: w / 2 + 0.3, hd: 0.5, rot: Math.atan2(uz, ux), y0: g - 0.4, y1: g + 0.7 + h });
}

function laurier(kit, ctx, A) {
  const W = U.wlu;
  if (!W) return;
  const city = ctx.city, F = W.fields || {};
  // Alumni Field, mid-campus: artificial turf, lit
  let alumni = null, stadium = null;
  if (F.alumni) {
    alumni = gridiron(kit, ctx, F.alumni.p, {});
    if (alumni) {
      const o = obb(F.alumni.p), B = kit.B(o.x, o.z), steel = lin([0.62, 0.64, 0.66]);
      for (const su of [-0.6, 0.6]) for (const sv of [-1, 1]) {
        const [x, z] = FP(o, su * o.hu, sv * (o.hv + 2)), g = T(x, z);
        if (city.onRoad(x, z, 1) || insideAny(x, z)) continue;
        B.prism(x, g - 0.5, z, 0.28, 20, 6, steel);
        B.box(x, g + 19, z, 3.4, 1.8, 0.5, Math.atan2(o.uz, o.ux), steel);
        ctx.solids.push({ x, z, r: 0.35, y0: g - 1, y1: g + 20 });
      }
    }
  }
  // University Stadium: Knight-Newbrough Field, purple end zones, the
  // golden hawk at centre field, the track round it, the grandstand
  if (F.stadium) {
    stadium = gridiron(kit, ctx, F.stadium.p, { ez: [0.31, 0.15, 0.51] });
    if (stadium) {
      const o = stadium.o, [x, z] = [o.x, o.z], grp = kit.grp(x, z);
      const m = hawkPanel(A, 18, 12);
      m.rotation.order = 'YXZ';
      m.rotation.y = -Math.atan2(o.uz, o.ux);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, T(x, z) + 0.2, z);
      grp.add(m);
      // the scoreboard beyond the north-west end zone
      const [sx, sz] = FP(o, -(o.hu + 9), 0), g = T(sx, sz);
      if (!city.onRoad(sx, sz, 2) && !insideAny(sx, sz)) {
        const B = kit.B(sx, sz), steel = lin([0.30, 0.30, 0.32]), rot = Math.atan2(o.uz, o.ux);
        for (const s of [-1, 1]) { const [px, pz] = FP(o, -(o.hu + 9), s * 4); B.tube([px, g - 0.3, pz], [px, g + 7, pz], 0.25, 6, steel); }
        B.box(sx, g + 6, sz, 1.0, 5.4, 11, rot, steel);
        hang(grp, scorePanel(A, 10.4, 4.8), sx, g + 8.7, sz, o.ux, o.uz, 0.52);
        ctx.solids.push({ x: sx, z: sz, hw: 0.6, hd: 5.5, rot, y0: g - 1, y1: g + 11 });
      }
    }
  }
  if (F.track) trackRing(kit, F.track.p, stadium);
  for (const r of W.b) if (r.building === 'grandstand') { try { grandstand(kit, ctx, r, stadium); } catch (e) { warn('grandstand: ' + e.message); } }
  // the LAURIER signs: at King and University (by the Athletic Complex),
  // and at the main entrance on University Ave at Hazel St
  const mid = [-4250, -2380];
  for (const [a, b, x, z] of [['University Avenue', 'King Street North', -4044, -2683], ['University Avenue West', 'Hazel Street', -4292, -2562]]) {
    const q = junction(city, a, b, x, z, 120);
    if (!q) continue;
    const s = cornerSpot(city, q, mid[0], mid[1]);
    if (!s) continue;
    plinthSign(kit, ctx, () => laurierPanel(A, 6.4, 2.6), s[0], s[1], s[2], s[3], 6.4, 2.6);
    (STATS.wluSigns = STATS.wluSigns || []).push([Math.round(s[0]), Math.round(s[1])]);
  }
}

/**
 * Open lawns: nothing grows against a campus facade (10 m), trees are
 * thinned in front of one (to 24 m) and along Ring Road's verges, and none
 * on Laurier's fields -- real UW is lawns and walkways round its buildings,
 * and a tree on every verge hid them from the road (city.extraClear).
 */
let CLR = null;
const CLR_C = 40;
function clearIndex() {
  CLR = new Map();
  const add = (a, b, R, ring) => {
    const x0 = Math.floor((Math.min(a[0], b[0]) - R) / CLR_C), x1 = Math.floor((Math.max(a[0], b[0]) + R) / CLR_C);
    const z0 = Math.floor((Math.min(a[1], b[1]) - R) / CLR_C), z1 = Math.floor((Math.max(a[1], b[1]) + R) / CLR_C);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * 100000 + j;
      let l = CLR.get(k);
      if (!l) CLR.set(k, (l = []));
      l.push([a[0], a[1], b[0], b[1], ring]);
    }
  };
  for (const b of BLD) for (let i = 0; i < b.r.p.length; i++) add(b.r.p[i], b.r.p[(i + 1) % b.r.p.length], 24, false);
  const ring = U.ring || [];
  for (let i = 0; i + 1 < ring.length; i++) add(ring[i], ring[i + 1], 18, true);
  CLR.fields = Object.values((U.wlu && U.wlu.fields) || {}).filter((f) => f.n !== 'University Stadium').map((f) => f.p);
}
export function campusKeepClear(x, z) {
  if (!BLD.length || x < -6700 || x > -3400 || z < -3200 || z > -1300) return false;
  if (!CLR) clearIndex();
  const l = CLR.get(Math.floor(x / CLR_C) * 100000 + Math.floor(z / CLR_C));
  let db = Infinity, dr = Infinity;
  if (l) for (const [ax, az, bx, bz, ring] of l) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (ring) dr = Math.min(dr, d); else db = Math.min(db, d);
  }
  if (db < 10) return true;
  const h = hash2(Math.round(x * 2) + 17, Math.round(z * 2) - 5);
  if (db < 24 && h < 0.6) return true;
  if (dr < 18 && h < 0.8) return true;
  for (const p of CLR.fields) if (inPoly(p, x, z)) return true;
  return false;
}

// --- the extra -----------------------------------------------------------------------------------

function warn(m) { console.warn('uwcampus ' + m); (STATS.errors = STATS.errors || []).push(m); }

/** landmarks.js extra: the whole campus. */
export function buildCampus(ctx) {
  if (!U || !BLD.length) return;
  const t0 = performance.now();
  const kit = new Kit();
  const A = new Atlas(1024, 1024);
  for (const b of BLD) {
    try { drawBuilding(kit, ctx, b); STATS.buildings++; } catch (e) { warn((b.r.ref || b.r.name || b.r.id) + ': ' + e.message); }
  }
  try { bridges(kit, ctx); } catch (e) { warn('bridges: ' + e.message); }
  try { landmarks(kit, ctx, A); } catch (e) { warn('landmarks: ' + e.message); }
  try { laurier(kit, ctx, A); } catch (e) { warn('laurier: ' + e.message); }
  A.tex.needsUpdate = true;
  kit.flush(ctx);
  STATS.tris = kit.tris;
  STATS.nearTris = kit.near || 0;
  STATS.atlasFull = A.full;
  STATS.ms = Math.round(performance.now() - t0);
  if (typeof window !== 'undefined') window.__uwCampus = STATS;
}
