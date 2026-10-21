// FOUR PLACES A WATERLOO KID KNOWS: Uptown, Waterloo Park, RIM Park and
// Conestoga Mall, from their OSM plans (kw.json `places`, tools/kw/build_kw.py)
// and the research notes beside each builder.
//
//   - UPTOWN WATERLOO: King Street's two- and three-storey blocks between
//     William St and Bridgeport Rd drawn from their footprints as a main
//     street -- brick in five tones, storefront glass with bulkheads and
//     recessed doors, awnings, painted sign bands carrying the shops OSM maps
//     inside each building, upper windows with sills and lintels, bracketed
//     cornices -- and black lamp posts with Uptown banners. The Old Post
//     Office (35 King N, 1912) has its Romanesque clock tower back; the
//     Seagram Lofts are buff-brick barrel warehouses with their pint-sized
//     windows and the painted SEAGRAM sign; Waterloo Public Square has its
//     slatted leaf shade structures (2023) and the water wall in front of
//     Beertown (2024); the Shops at Waterloo Town Square front the square.
//   - WATERLOO PARK: footbridges over Silver Lake and Laurel Creek, the
//     1998 grist mill replica with its wheel, the 1820 log schoolhouse, the
//     Eby farmhouse (the Potters' Workshop) and barn with its paddocks --
//     empty: the animal farm closed in 2024 -- the gazebos, the Jubilee
//     gateway replica, the splash pad, the four ball diamonds, and Canada
//     geese (Geese, animated: they graze, waddle off, take flight from a car,
//     and the gander stands his ground and honks at you).
//   - RIM PARK: every OSM pitch drawn (soccer lines and goals, the two
//     artificial turf fields, the ball diamonds), light masts on all of them,
//     the Elam Martin farmstead's bank barn, silo and yellow-brick house, and
//     the park's sign at University Ave.
//   - CONESTOGA MALL: the mall from its 168-point plan (precast walls, the
//     2010 entrances with their glass vestibules and canopies, skylights down
//     the concourse), Galaxy Cinemas as its own dark block, the anchors'
//     signs (Zehrs, Winners, Sport Chek, Indigo, Old Navy, H&M, Shoppers Drug
//     Mart, Urban Behavior in the old Bay), and the pylon on King St.
//
// Everything is a landmarks.js extra merged into its 1200 m cluster: one
// vertex-coloured material for the solid pieces, one with a polygon offset
// for what lies on the ground, and the sign atlas.

import * as THREE from './three.js';
import * as G from './geo.js';
import { hash2 } from './util.js';
import { Builder } from './build.js';
import { boxAt, kwData } from './kw.js';

const U0 = [0, 0, 0, 0, 0, 0, 0, 0];
const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
const ckey = (x, z) => `${Math.round(x / 1200)},${Math.round(z / 1200)}`;
const T = (x, z) => G.terrainHeight(x, z);
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

let P = null;          // kw.json places
let CITY = null;
const KING_SKIP = [];  // the King St footprints we draw (party-wall tests)

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
/**
 * A closed outline with its near-collinear vertices dropped (Douglas-Peucker,
 * `tol` metres): OSM traces a mall's long wall as dozens of short edges, and a
 * sign or an entrance wants the whole wall.
 */
function simplify(pts, tol) {
  const n = pts.length;
  if (n < 5) return pts;
  // split at the two vertices farthest apart, simplify each half
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) { best = d; i1 = i; }
  }
  const keep = new Array(n).fill(false);
  keep[i0] = keep[i1] = true;
  const dp = (a, b) => {
    // vertices strictly between a and b, walking forward round the ring
    let far = -1, fd = tol;
    const A = pts[a], B = pts[b], dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz) || 1;
    for (let k = (a + 1) % n; k !== b; k = (k + 1) % n) {
      const d = Math.abs((pts[k][0] - A[0]) * dz - (pts[k][1] - A[1]) * dx) / L;
      if (d > fd) { fd = d; far = k; }
    }
    if (far >= 0) { keep[far] = true; dp(a, far); dp(far, b); }
  };
  dp(i0, i1); dp(i1, i0);
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}

/** Each edge of a footprint: ends, unit direction, outward normal, length. */
function edges(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.3) continue;
    const ux = dx / L, uz = dz / L;
    let nx = uz, nz = -ux;
    if (inPoly(pts, a[0] + dx / 2 + nx * 0.5, a[1] + dz / 2 + nz * 0.5)) { nx = -nx; nz = -nz; }
    out.push({ a, c, ux, uz, nx, nz, L, mx: a[0] + dx / 2, mz: a[1] + dz / 2,
      at: (t, y, off = 0) => [a[0] + ux * t + nx * off, y, a[1] + uz * t + nz * off] });
  }
  return out;
}
/** The nearest street (not a freeway, deck or bore) to (x, z): distance from its kerb, its name. */
function street(city, x, z, r = 40, re = null) {
  let best = null;
  for (const ei of city.edgesNear(x, z, r)) {
    const e = city.edges[ei];
    if (e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp') continue;
    if (re && !(e.name && re.test(e.name))) continue;
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(e.len, (x - a.x) * e.dx + (z - a.z) * e.dz));
    const qx = a.x + e.dx * t, qz = a.z + e.dz * t;
    const d = Math.hypot(x - qx, z - qz);
    if (!best || d - e.hw < best.kerb) best = { kerb: d - e.hw, d, qx, qz, hw: e.hw, ex: e.dx, ez: e.dz, name: e.name || '' };
  }
  return best;
}
/** The pavement's height at (x, z): terrain plus whatever paving lifts it. */
function walkY(city, x, z) {
  let lf = 0;
  try { lf = city.roadLift(x, z) || 0; } catch (e) { lf = 0; }
  return T(x, z) + lf;
}

/** Hang an atlas panel on a wall: centred at (x, y, z), facing (nx, nz). */
function hang(g, mesh, x, y, z, nx, nz, off = 0.06) {
  mesh.position.set(x + nx * off, y, z + nz * off);
  mesh.rotation.y = Math.atan2(nx, nz);
  g.add(mesh);
  return mesh;
}

/**
 * The places' own lettering: a second canvas laid out as landmarks.js's
 * SignAtlas (same `panel` API, one material, so a cluster's signs are one
 * draw). The shared atlas is nine-tenths full before these run -- every Tims,
 * FreshCo and storefront in the region is on it.
 */
class PlaceAtlas {
  constructor(w = 2048, h = 1024) {
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
  alloc(w, h) {
    if (this.x + w > this.c.width) { this.x = 0; this.y += this.row + 2; this.row = 0; }
    if (this.y + h > this.c.height) this.full++;
    const at = [this.x, this.y];
    this.x += w + 2; this.row = Math.max(this.row, h);
    return at;
  }
  panel(w, h, px, draw) {
    const W = Math.min(1024, Math.max(32, Math.round(w * px))), H = Math.min(512, Math.max(16, Math.round(h * px)));
    const [x, y] = this.alloc(W, H);
    const g = this.g;
    g.save(); g.translate(x, y);
    g.beginPath(); g.rect(0, 0, W, H); g.clip();
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

// One builder per cluster per material; flushed into the landmark clusters.
let MAT_S = null, MAT_D = null;
function mats() {
  if (!MAT_S) {
    MAT_S = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 });
    MAT_D = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    MAT_D.userData.noShadow = true;   // paint on the ground casts nothing
  }
}
class Kit {
  constructor() { this.b = new Map(); this.g = new Map(); this.tris = 0; }
  B(x, z, decal = false) {
    const k = ckey(x, z) + (decal ? '|d' : '|s');
    let b = this.b.get(k);
    if (!b) this.b.set(k, (b = new Builder(false)));
    return b;
  }
  grp(x, z) {
    const k = ckey(x, z);
    let g = this.g.get(k);
    if (!g) this.g.set(k, (g = new THREE.Group()));
    return g;
  }
  flush(ctx) {
    mats();
    for (const [k, b] of this.b) {
      if (b.empty) continue;
      const [key, kind] = k.split('|');
      this.tris += b.idx.length / 3;
      const m = new THREE.Mesh(b.build(), kind === 'd' ? MAT_D : MAT_S);
      let g = this.g.get(key);
      if (!g) this.g.set(key, (g = new THREE.Group()));
      g.add(m);
    }
    for (const [k, g] of this.g) ctx.addTo(k, g);
    this.b.clear(); this.g.clear();
  }
}

/** A flat-roofed footprint's roof at y. */
function roof(B, pts, y, col) {
  let tris = [];
  try { tris = THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q[0], q[1])), []); } catch (e) { tris = []; }
  for (const [i, j, k] of tris) B.tri([pts[i][0], y, pts[i][1]], [pts[j][0], y, pts[j][1]], [pts[k][0], y, pts[k][1]], [0, 1, 0], col);
}
/** The walls of a footprint as solids (thin boxes), as kw.js meshPoly's. */
function wallSolids(solids, pts, y0, y1) {
  for (const e of edges(pts)) {
    solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0, y1 });
  }
}
/** A gabled block on an oriented box: walls to the eave, two roof slopes, gable ends. */
function gabled(B, o, y0, eave, ridge, wall, roofc, opts = {}) {
  const { ux, uz } = o, vx = -uz, vz = ux;
  const P = (u, v, y) => [o.x + ux * u + vx * v, y, o.z + uz * u + vz * v];
  const hu = o.hu, hv = o.hv, ov = opts.overhang ?? 0.4;
  const long = opts.ridgeAlongV ? false : true;   // the ridge runs along u by default
  // walls
  for (const s of [-1, 1]) {
    B.quad(P(-hu, s * hv, y0), P(hu, s * hv, y0), P(hu, s * hv, eave), P(-hu, s * hv, eave), [vx * s, 0, vz * s], U0, wall);
    B.quad(P(s * hu, -hv, y0), P(s * hu, hv, y0), P(s * hu, hv, eave), P(s * hu, -hv, eave), [ux * s, 0, uz * s], U0, wall);
  }
  if (long) {
    for (const s of [-1, 1]) {
      const n = [vx * s * 0.7, 0.7, vz * s * 0.7];
      B.quad(P(-hu - ov, s * (hv + ov), eave - ov * 0.5), P(hu + ov, s * (hv + ov), eave - ov * 0.5), P(hu + ov, 0, ridge), P(-hu - ov, 0, ridge), n, U0, roofc);
      B.quad(P(-hu - ov, s * (hv + ov), eave - ov * 0.5 - 0.02), P(hu + ov, s * (hv + ov), eave - ov * 0.5 - 0.02), P(hu + ov, 0, ridge - 0.02), P(-hu - ov, 0, ridge - 0.02), [-n[0], -n[1], -n[2]], U0, shade(roofc, 0.6));
      B.tri(P(s * hu, -hv, eave), P(s * hu, hv, eave), P(s * hu, 0, ridge), [ux * s, 0, uz * s], opts.gable || wall);
    }
  } else {
    for (const s of [-1, 1]) {
      const n = [ux * s * 0.7, 0.7, uz * s * 0.7];
      B.quad(P(s * (hu + ov), -hv - ov, eave - ov * 0.5), P(s * (hu + ov), hv + ov, eave - ov * 0.5), P(0, hv + ov, ridge), P(0, -hv - ov, ridge), n, U0, roofc);
      B.tri(P(-hu, s * hv, eave), P(hu, s * hv, eave), P(0, s * hv, ridge), [vx * s, 0, vz * s], opts.gable || wall);
    }
  }
  return P;
}

// --- palettes (sRGB; lin() at use) ---------------------------------------------------

const BRICK = [[0.60, 0.29, 0.21], [0.52, 0.25, 0.19], [0.68, 0.38, 0.27], [0.80, 0.68, 0.48], [0.47, 0.31, 0.24],
  [0.84, 0.80, 0.70], [0.40, 0.47, 0.42], [0.62, 0.60, 0.56], [0.72, 0.62, 0.46]];
const TRIMS = [[0.92, 0.90, 0.84], [0.20, 0.22, 0.20], [0.86, 0.80, 0.66], [0.18, 0.26, 0.20], [0.42, 0.14, 0.12]];
const AWN = [['#1f4d36', null], ['#7a1f24', null], ['#1d2f55', null], ['#1a1a1a', null], ['#2f6b3b', '#f3efe2'],
  ['#8a2b1e', '#f3efe2'], ['#24476b', '#f3efe2'], ['#c46a1f', null], ['#5a2a4a', null]];
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const SIGN_PAL = [['#1b1b1b', '#e8c46a'], ['#1f3a2c', '#f2ead2'], ['#f3efe2', '#7a1f24'], ['#5a1e1e', '#f6e7c8'],
  ['#203457', '#ffffff'], ['#2a2a2a', '#ffffff'], ['#ece5d4', '#1f3a2c'], ['#6b3b1f', '#f2d9a4']];
const BRAND_SIGN = {
  BMO: ['#0079c1', '#ffffff'], RBC: ['#005daa', '#ffd200'], CIBC: ['#c41f3e', '#ffffff'], TD: ['#008a00', '#ffffff'],
  Scotiabank: ['#ec111a', '#ffffff'], 'Home Hardware': ['#d2232a', '#ffffff'], 'Long & McQuade': ['#111111', '#f6c400'],
  'Marble Slab Creamery': ['#2a1a5e', '#ffffff'], 'Score Pizza': ['#111111', '#f9a51b'], 'Stag Shop': ['#000000', '#e5007d'],
  'The Works': ['#111111', '#f2c600'], 'Massage Addict': ['#5b2c83', '#ffffff'], Cinnaholic: ['#5c2d91', '#ffffff'],
};
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'Helvetica, Arial, sans-serif';

function signPanel(L, name, brand, w, h, seed) {
  const col = BRAND_SIGN[brand] || BRAND_SIGN[name] || SIGN_PAL[Math.floor(hash2(seed, 11) * SIGN_PAL.length)];
  const serif = !BRAND_SIGN[brand] && !BRAND_SIGN[name] && hash2(seed, 12) < 0.55;
  return L.panel(w, h, 30, (g, W, H) => {
    g.fillStyle = col[0]; g.fillRect(0, 0, W, H);
    g.strokeStyle = col[1]; g.globalAlpha = 0.6; g.lineWidth = Math.max(1, H * 0.05);
    g.strokeRect(H * 0.08, H * 0.08, W - H * 0.16, H - H * 0.16); g.globalAlpha = 1;
    g.fillStyle = col[1]; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${serif ? 'italic 700' : '700'} ${H * 0.55}px ${serif ? SERIF : SANS}`;
    g.fillText(name, W / 2, H * 0.54, W * 0.9);
  });
}

// --- before meshing --------------------------------------------------------------------

/** Flatten every box this module draws itself (kw.skip: world.js and buildPolys leave it). */
function skipBox(city, pts) {
  const [cx, cz] = centroid(pts);
  const A = Math.abs(polyArea(pts));
  const hit = new Set();
  const b = boxAt(city, cx, cz, 2);
  if (b && b.w * b.d < A * 4 + 300) hit.add(b);
  // and any other box whose centre lies inside the footprint (a building split in two)
  for (const o of city.buildingsNear(cx, cz, 80)) if (inPoly(pts, o.x, o.z) && o.w * o.d < A * 2 + 200) hit.add(o);
  for (const o of hit) {
    o.h = 0;
    if (!o.kw) o.kw = {};
    o.kw.skip = true;
  }
  return hit.size;
}

/** Before anything is meshed: the boxes of everything drawn here go flat. */
export function prepPlaces(city) {
  const kw = kwData();
  P = kw && kw.places;
  CITY = city;
  // a before/after switch for the harnesses (kwshots VIEW_BOOT_JS)
  if (typeof window !== 'undefined' && window.__noPlaces) P = null;
  if (!P) return { skipped: 0 };
  let n = 0;
  KING_SKIP.length = 0;
  for (const r of P.king) { n += skipBox(city, r.p); KING_SKIP.push(r.p); }
  for (const k of ['townsq', 'mall', 'cinema', 'seagram3', 'seagram5', 'school', 'mill', 'potters', 'ebybarn', 'parkinn',
    'gazeboE', 'gazeboT', 'gazeboW', 'martinHouse', 'martinBarn']) if (P[k]) n += skipBox(city, P[k].p);
  return { skipped: n };
}

// --- Uptown: King Street -----------------------------------------------------------------

// King Street's centreline, William St to Bridgeport Rd (as build_kw.py's)
const UPTOWN_KING = [[-3756, -1073], [-3772, -1150], [-3800, -1291], [-3813, -1356], [-3820, -1391], [-3834, -1465],
  [-3845, -1519], [-3855, -1557], [-3880, -1691], [-3889, -1738], [-3902, -1802]];

function partyWall(self, x, z) {
  for (const p of KING_SKIP) if (p !== self && inPoly(p, x, z)) return true;
  return false;
}

/**
 * One King St block: brick walls to a parapet, and on each face toward a
 * street a storefront per shop (bulkhead, glass, recessed door, sign band,
 * maybe an awning), windows with sills and lintels on every upper storey,
 * a string course per floor and a bracketed cornice.
 */
function meshKing(kit, ctx, r, idx) {
  const city = ctx.city, L = ctx.atlas;
  let pts = r.p;
  if (polyArea(pts) < 0) pts = pts.slice().reverse();
  const [cx, cz] = centroid(pts);
  const seed = Math.round(cx * 13 + cz * 7);
  const B = kit.B(cx, cz), g = kit.grp(cx, cz);
  const po = /Old Post Office/.test(r.n);
  const lv = Math.max(1, Math.min(5, Math.round(r.lv || 2)));
  const H = r.ht ? Math.min(+r.ht, 30) : lv === 1 ? 5.8 : 4.6 + (lv - 1) * 3.7 + 0.5;
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const yb = lo - 1.2;
  const base = walkY(city, cx, cz);
  const yTop = base + (po ? 15.2 : H);
  const wall = lin(po ? [0.62, 0.27, 0.20] : BRICK[Math.floor(hash2(seed, 1) * BRICK.length)]);
  const trim = lin(po ? [0.80, 0.70, 0.52] : TRIMS[Math.floor(hash2(seed, 2) * TRIMS.length)]);
  const dark = shade(wall, 0.72);
  const GLASS = lin([0.13, 0.17, 0.21]), GLASS2 = lin([0.22, 0.28, 0.33]);
  const FRAME = lin(hash2(seed, 3) < 0.5 ? [0.16, 0.16, 0.15] : [0.90, 0.88, 0.82]);
  const BULK = lin(TRIMS[Math.floor(hash2(seed, 4) * TRIMS.length)]);
  const STONE = lin([0.78, 0.69, 0.53]);
  const E = edges(pts);
  // which faces front a street, and which is on King
  const fronts = [];
  for (const e of E) {
    if (e.L < 2.5) continue;
    const s = street(city, e.mx + e.nx * 1.5, e.mz + e.nz * 1.5, 40);
    if (!s || s.kerb > 7.5) continue;
    const tx = s.qx - e.mx, tz = s.qz - e.mz, tl = Math.hypot(tx, tz) || 1;
    if ((tx * e.nx + tz * e.nz) / tl < 0.45) continue;
    if (partyWall(pts, e.mx + e.nx * 1.2, e.mz + e.nz * 1.2)) continue;
    e.front = true;
    e.king = /^King Street/.test(s.name);
    fronts.push(e);
  }
  fronts.sort((a, b) => (b.king - a.king) || (b.L - a.L));
  // the shops, King's face first
  const shops = r.s.slice();
  for (const e of fronts) e.shops = [];
  if (fronts.length) {
    shops.forEach((s, i) => {
      const e = fronts.length > 1 && i >= Math.ceil(shops.length * fronts[0].L / fronts.reduce((a, f) => a + f.L, 0)) ? fronts[1] : fronts[0];
      e.shops.push(s);
    });
  }
  const residential = /apartments|residential|house/.test(r.bt) && !r.s.length;
  for (const e of E) {
    const N = [e.nx, 0, e.nz];
    // the wall to the parapet, its inside face over the roof, the coping
    B.quad(e.at(0, yb), e.at(e.L, yb), e.at(e.L, yTop + 0.9), e.at(0, yTop + 0.9), N, U0, [dark, dark, wall, wall]);
    B.quad(e.at(0, yTop, -0.01), e.at(e.L, yTop, -0.01), e.at(e.L, yTop + 0.9, -0.01), e.at(0, yTop + 0.9, -0.01), [-e.nx, 0, -e.nz], U0, dark);
    B.quad(e.at(0, yTop + 0.9, 0.15), e.at(e.L, yTop + 0.9, 0.15), e.at(e.L, yTop + 1.0, 0), e.at(0, yTop + 1.0, 0), [0, 1, 0], U0, trim);
    ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: yb, y1: yTop + 0.9 });
    if (e.L < 3) continue;
    const gy = walkY(city, e.mx + e.nx * 1.4, e.mz + e.nz * 1.4);
    const party = !e.front && partyWall(pts, e.mx + e.nx * 1.2, e.mz + e.nz * 1.2);
    if (party) continue;
    const front = !!e.front;
    // upper storeys: windows
    const gfH = lv === 1 ? 0 : 4.6;
    const upper = po ? 2 : lv - 1;
    const spacing = front ? 2.3 : 3.4;
    const nw = Math.floor((e.L - 1.2) / spacing);
    if (nw >= 1 && (front || e.L > 6)) {
      const pad = (e.L - nw * spacing) / 2;
      for (let k = 0; k < upper; k++) {
        const y0 = gy + gfH + (po ? 1.3 : 0) + k * 3.7 + 0.75, wh = k === 0 ? 2.0 : 1.8, ww = 1.05;
        if (y0 + wh > yTop - 0.4) break;
        for (let i = 0; i < nw; i++) {
          const t = pad + spacing * (i + 0.5);
          B.quad(e.at(t - ww / 2 - 0.1, y0 - 0.08, 0.02), e.at(t + ww / 2 + 0.1, y0 - 0.08, 0.02), e.at(t + ww / 2 + 0.1, y0 + wh + 0.08, 0.02), e.at(t - ww / 2 - 0.1, y0 + wh + 0.08, 0.02), N, U0, FRAME);
          B.quad(e.at(t - ww / 2, y0, 0.04), e.at(t + ww / 2, y0, 0.04), e.at(t + ww / 2, y0 + wh, 0.04), e.at(t - ww / 2, y0 + wh, 0.04), N, U0, [GLASS, GLASS, GLASS2, GLASS2]);
          B.quad(e.at(t - ww / 2, y0 + wh * 0.55, 0.05), e.at(t + ww / 2, y0 + wh * 0.55, 0.05), e.at(t + ww / 2, y0 + wh * 0.55 + 0.06, 0.05), e.at(t - ww / 2, y0 + wh * 0.55 + 0.06, 0.05), N, U0, FRAME);
          // sill, and a lintel (a segmental arch in the brick on the old blocks)
          B.quad(e.at(t - ww / 2 - 0.18, y0 - 0.2, 0.1), e.at(t + ww / 2 + 0.18, y0 - 0.2, 0.1), e.at(t + ww / 2 + 0.18, y0 - 0.08, 0.1), e.at(t - ww / 2 - 0.18, y0 - 0.08, 0.1), N, U0, trim);
          B.quad(e.at(t - ww / 2 - 0.18, y0 - 0.08, 0.1), e.at(t + ww / 2 + 0.18, y0 - 0.08, 0.1), e.at(t + ww / 2 + 0.18, y0 - 0.08, 0), e.at(t - ww / 2 - 0.18, y0 - 0.08, 0), [0, 1, 0], U0, trim);
          if (front && (po || hash2(seed, 20) < 0.6)) {
            B.quad(e.at(t - ww / 2 - 0.15, y0 + wh + 0.08, 0.03), e.at(t + ww / 2 + 0.15, y0 + wh + 0.08, 0.03), e.at(t + ww / 2, y0 + wh + 0.42, 0.03), e.at(t - ww / 2, y0 + wh + 0.42, 0.03), N, U0, po ? STONE : shade(wall, 0.8));
            B.tri(e.at(t - ww / 2, y0 + wh + 0.42, 0.035), e.at(t + ww / 2, y0 + wh + 0.42, 0.035), e.at(t, y0 + wh + 0.62, 0.035), N, po ? STONE : shade(wall, 0.8));
          } else {
            B.quad(e.at(t - ww / 2 - 0.12, y0 + wh + 0.08, 0.03), e.at(t + ww / 2 + 0.12, y0 + wh + 0.08, 0.03), e.at(t + ww / 2 + 0.12, y0 + wh + 0.3, 0.03), e.at(t - ww / 2 - 0.12, y0 + wh + 0.3, 0.03), N, U0, trim);
          }
        }
        // a string course at each floor line on the street
        if (front && k > 0) {
          const ys = gy + gfH + (po ? 1.3 : 0) + k * 3.7 + 0.2;
          B.quad(e.at(0, ys, 0.06), e.at(e.L, ys, 0.06), e.at(e.L, ys + 0.18, 0.06), e.at(0, ys + 0.18, 0.06), N, U0, trim);
        }
      }
    }
    if (!front) continue;
    // the cornice: a projecting band with brackets under it
    const yc = yTop - 0.15;
    B.quad(e.at(-0.25, yc, 0.42), e.at(e.L + 0.25, yc, 0.42), e.at(e.L + 0.25, yc + 0.55, 0.42), e.at(-0.25, yc + 0.55, 0.42), N, U0, trim);
    B.quad(e.at(-0.25, yc, 0), e.at(e.L + 0.25, yc, 0), e.at(e.L + 0.25, yc, 0.42), e.at(-0.25, yc, 0.42), [0, -1, 0], U0, shade(trim, 0.6));
    B.quad(e.at(-0.25, yc + 0.55, 0.42), e.at(e.L + 0.25, yc + 0.55, 0.42), e.at(e.L + 0.25, yc + 0.55, 0), e.at(-0.25, yc + 0.55, 0), [0, 1, 0], U0, trim);
    // brackets: a face and an underside each (all anyone sees from the street)
    for (let t = 0.5; t < e.L - 0.3; t += 1.25) {
      B.quad(e.at(t - 0.09, yc - 0.45, 0.32), e.at(t + 0.09, yc - 0.45, 0.32), e.at(t + 0.09, yc, 0.32), e.at(t - 0.09, yc, 0.32), N, U0, trim);
      B.quad(e.at(t - 0.09, yc - 0.45, 0), e.at(t + 0.09, yc - 0.45, 0), e.at(t + 0.09, yc - 0.45, 0.32), e.at(t - 0.09, yc - 0.45, 0.32), [0, -1, 0], U0, shade(trim, 0.6));
    }
    // the ground floor
    if (po) {
      // sandstone, round-arched openings
      B.quad(e.at(0, gy - 0.3, 0.05), e.at(e.L, gy - 0.3, 0.05), e.at(e.L, gy + 4.9, 0.05), e.at(0, gy + 4.9, 0.05), N, U0, STONE);
      const na = Math.max(1, Math.floor(e.L / 3.2)), pd = (e.L - na * 3.2) / 2;
      for (let i = 0; i < na; i++) {
        const t = pd + 3.2 * (i + 0.5);
        B.quad(e.at(t - 0.8, gy + 0.6, 0.08), e.at(t + 0.8, gy + 0.6, 0.08), e.at(t + 0.8, gy + 3.1, 0.08), e.at(t - 0.8, gy + 3.1, 0.08), N, U0, GLASS);
        for (let k = 0; k < 6; k++) {
          const a0 = Math.PI * k / 6, a1 = Math.PI * (k + 1) / 6;
          B.tri(e.at(t, gy + 3.1, 0.08), e.at(t + Math.cos(a0) * 0.8, gy + 3.1 + Math.sin(a0) * 0.8, 0.08), e.at(t + Math.cos(a1) * 0.8, gy + 3.1 + Math.sin(a1) * 0.8, 0.08), N, GLASS);
        }
      }
      continue;
    }
    if (residential) {
      // a house-fronted block: a door and two windows
      const dt = e.L * 0.3;
      B.quad(e.at(dt - 0.55, gy, 0.05), e.at(dt + 0.55, gy, 0.05), e.at(dt + 0.55, gy + 2.3, 0.05), e.at(dt - 0.55, gy + 2.3, 0.05), N, U0, BULK);
      for (const t of [e.L * 0.6, e.L * 0.82]) {
        if (t > e.L - 0.8) continue;
        B.quad(e.at(t - 0.55, gy + 0.9, 0.04), e.at(t + 0.55, gy + 0.9, 0.04), e.at(t + 0.55, gy + 2.6, 0.04), e.at(t - 0.55, gy + 2.6, 0.04), N, U0, GLASS);
      }
      continue;
    }
    const nShops = e.shops.length;
    const nb = Math.max(1, Math.min(Math.max(nShops, Math.round(e.L / 8)), Math.floor(e.L / 3.4)));
    const bw = e.L / nb;
    for (let k = 0; k < nb; k++) {
      const t0 = k * bw + 0.3, t1 = (k + 1) * bw - 0.3, tm = (t0 + t1) / 2;
      const sd = seed + k * 31;
      // piers between the shopfronts
      for (const t of (k === 0 ? [0, bw] : [(k + 1) * bw])) {
        const ta = Math.max(0, t - 0.3), tb = Math.min(e.L, t + 0.3);
        B.quad(e.at(ta, gy - 0.3, 0.22), e.at(tb, gy - 0.3, 0.22), e.at(tb, gy + 3.2, 0.22), e.at(ta, gy + 3.2, 0.22), N, U0, trim);
        B.quad(e.at(ta, gy - 0.3, 0), e.at(ta, gy - 0.3, 0.22), e.at(ta, gy + 3.2, 0.22), e.at(ta, gy + 3.2, 0), [-e.ux, 0, -e.uz], U0, shade(trim, 0.8));
        B.quad(e.at(tb, gy - 0.3, 0.22), e.at(tb, gy - 0.3, 0), e.at(tb, gy + 3.2, 0), e.at(tb, gy + 3.2, 0.22), [e.ux, 0, e.uz], U0, shade(trim, 0.8));
      }
      // bulkhead, glass, a mullion, the transom bar, and the recessed door
      const doorL = hash2(sd, 5) < 0.5;
      const dA = doorL ? t0 + 0.15 : t1 - 1.25, dB = dA + 1.1;
      B.quad(e.at(t0, gy - 0.3, 0.04), e.at(t1, gy - 0.3, 0.04), e.at(t1, gy + 0.55, 0.04), e.at(t0, gy + 0.55, 0.04), N, U0, BULK);
      B.quad(e.at(t0, gy + 0.55, 0.03), e.at(t1, gy + 0.55, 0.03), e.at(t1, gy + 3.05, 0.03), e.at(t0, gy + 3.05, 0.03), N, U0, [GLASS, GLASS, GLASS2, GLASS2]);
      B.quad(e.at(dA, gy - 0.3, 0.05), e.at(dB, gy - 0.3, 0.05), e.at(dB, gy + 2.45, 0.05), e.at(dA, gy + 2.45, 0.05), N, U0, shade(BULK, 0.55));
      B.quad(e.at(dA + 0.15, gy + 0.9, 0.06), e.at(dB - 0.15, gy + 0.9, 0.06), e.at(dB - 0.15, gy + 2.2, 0.06), e.at(dA + 0.15, gy + 2.2, 0.06), N, U0, GLASS2);
      B.quad(e.at(t0, gy + 2.45, 0.06), e.at(t1, gy + 2.45, 0.06), e.at(t1, gy + 2.55, 0.06), e.at(t0, gy + 2.55, 0.06), N, U0, FRAME);
      const mid = doorL ? (dB + t1) / 2 : (t0 + dA) / 2;
      B.quad(e.at(mid - 0.05, gy + 0.55, 0.06), e.at(mid + 0.05, gy + 0.55, 0.06), e.at(mid + 0.05, gy + 3.05, 0.06), e.at(mid - 0.05, gy + 3.05, 0.06), N, U0, FRAME);
      // the sign band
      const band = lin(TRIMS[Math.floor(hash2(sd, 6) * TRIMS.length)]);
      B.quad(e.at(t0 - 0.3, gy + 3.05, 0.12), e.at(t1 + 0.3, gy + 3.05, 0.12), e.at(t1 + 0.3, gy + 4.15, 0.12), e.at(t0 - 0.3, gy + 4.15, 0.12), N, U0, band);
      B.quad(e.at(t0 - 0.3, gy + 4.15, 0.12), e.at(t1 + 0.3, gy + 4.15, 0.12), e.at(t1 + 0.3, gy + 4.15, 0), e.at(t0 - 0.3, gy + 4.15, 0), [0, 1, 0], U0, band);
      const shop = e.shops[k];
      if (shop) {
        const sw = Math.min(t1 - t0 - 0.1, Math.max(2.4, shop[0].length * 0.32 + 1));
        const sp = e.at(tm, gy + 3.6, 0.14);
        hang(g, signPanel(L, shop[0], shop[2], sw, 0.78, seed + k), sp[0], sp[1], sp[2], e.nx, e.nz, 0.02);
        // a blade sign over the pavement for the pubs and restaurants
        if (/pub|bar|restaurant|cafe|nightclub|cinema/.test(shop[1]) && hash2(sd, 9) < 0.7) {
          const bp = e.at(doorL ? t0 + 0.3 : t1 - 0.3, gy + 4.9, 0.75);
          const bl = signPanel(L, shop[0], shop[2], 0.95, 0.95, seed + k + 99);
          // two faces back to back (opaque, so neither shows the other mirrored)
          hang(g, bl, bp[0], bp[1], bp[2], e.ux, e.uz, 0.03);
          hang(g, bl.clone(), bp[0], bp[1], bp[2], -e.ux, -e.uz, 0.03);
          const bb = e.at(doorL ? t0 + 0.3 : t1 - 0.3, gy + 5.45, 0.4);
          B.box(bb[0], bb[1], bb[2], 0.05, 0.05, 0.85, Math.atan2(e.nz, e.nx) + Math.PI / 2, lin([0.1, 0.1, 0.1]));
        }
      }
      // an awning
      if (hash2(sd, 7) < 0.62) {
        const [ac, as] = AWN[Math.floor(hash2(sd, 8) * AWN.length)];
        const A = lin(hex(ac)), S = as ? lin(hex(as)) : null;
        const D = 1.55, y1 = gy + 3.0, y2 = gy + 2.35;
        const strips = S ? Math.max(2, Math.round((t1 - t0) / 0.5)) : 1;
        for (let s = 0; s < strips; s++) {
          const ta = t0 + (t1 - t0) * s / strips, tb = t0 + (t1 - t0) * (s + 1) / strips;
          const c = S && s % 2 ? S : A;
          const n = [e.nx * 0.4, 0.92, e.nz * 0.4];
          B.quad(e.at(ta, y1, 0.05), e.at(tb, y1, 0.05), e.at(tb, y2, D), e.at(ta, y2, D), n, U0, c);
          B.quad(e.at(ta, y1 - 0.02, 0.05), e.at(tb, y1 - 0.02, 0.05), e.at(tb, y2 - 0.02, D), e.at(ta, y2 - 0.02, D), [-n[0], -n[1], -n[2]], U0, shade(c, 0.55));
          B.quad(e.at(ta, y2, D), e.at(tb, y2, D), e.at(tb, y2 - 0.32, D), e.at(ta, y2 - 0.32, D), N, U0, c);
        }
        for (const [t, s] of [[t0, -1], [t1, 1]]) {
          B.tri(e.at(t, y1, 0.05), e.at(t, y2, D), e.at(t, y2 - 0.32, D), [e.ux * s, 0, e.uz * s], shade(A, 0.8));
        }
      }
    }
  }
  roof(B, pts, yTop, lin([0.36, 0.35, 0.34]));
  // some plant on the bigger roofs
  if (Math.abs(polyArea(pts)) > 300) {
    B.box(cx, yTop, cz, 2.2, 1.3, 1.6, hash2(seed, 30) * 3, lin([0.62, 0.63, 0.64]));
  }
  // the Old Post Office's clock tower, on its King and Dupont corner
  if (po) postOfficeTower(kit, ctx, pts, base, yTop, wall, STONE);
}

/**
 * THE OLD POST OFFICE, 35 King St N (1912): Romanesque, sandstone ground
 * floor and red brick above, and the clock tower on the corner of King and
 * Dupont that commands Uptown's skyline. The tower came down in 1956 and was
 * rebuilt in 1991, the clock in 2003. OSM gives the building 23 m.
 */
function postOfficeTower(kit, ctx, pts, base, yTop, wall, STONE) {
  const city = ctx.city;
  // the corner: the footprint's vertex nearest both King St and Dupont St
  let best = null, bs = Infinity;
  for (const q of pts) {
    const k = street(city, q[0], q[1], 60, /^King Street/), d = street(city, q[0], q[1], 60, /^Dupont/);
    const s = (k ? k.kerb : 60) + (d ? d.kerb : 60);
    if (s < bs) { bs = s; best = q; }
  }
  if (!best) return;
  const [cx, cz] = centroid(pts);
  // the tower stands inside the corner, its sides square to the King face
  const k = street(city, best[0], best[1], 60, /^King Street/);
  const ux = k ? k.ex : 1, uz = k ? k.ez : 0;
  const S = 5.6;
  const ix = cx - best[0], iz = cz - best[1], il = Math.hypot(ix, iz) || 1;
  const tx = best[0] + (ix / il) * S * 0.62, tz = best[1] + (iz / il) * S * 0.62;
  const B = kit.B(tx, tz), g = kit.grp(tx, tz);
  const rot = Math.atan2(uz, ux);
  const top = base + 21.5;
  B.box(tx, base - 1, tz, S, top - base + 1, S, rot, wall);
  B.box(tx, base - 1, tz, S + 0.3, 5.9, S + 0.3, rot, STONE);
  // the belfry stage: a stone band, corner piers, the clock faces, a pyramid roof
  B.box(tx, top - 5.4, tz, S + 0.4, 0.4, S + 0.4, rot, STONE);
  B.box(tx, top, tz, S + 0.6, 0.5, S + 0.6, rot, STONE);
  const RF = lin([0.30, 0.36, 0.34]);
  const c = Math.cos(rot), s = Math.sin(rot), hs = S / 2 + 0.3;
  const corner = (a, b) => [tx + a * c - b * s, top + 0.5, tz + a * s + b * c];
  const apex = [tx, top + 6.5, tz];
  const C = [corner(-hs, -hs), corner(hs, -hs), corner(hs, hs), corner(-hs, hs)];
  for (let i = 0; i < 4; i++) {
    const a = C[i], b = C[(i + 1) % 4];
    const mx = (a[0] + b[0]) / 2 - tx, mz = (a[2] + b[2]) / 2 - tz, ml = Math.hypot(mx, mz);
    B.tri(a, b, apex, [mx / ml * 0.8, 0.6, mz / ml * 0.8], RF);
  }
  B.box(tx, top + 6.4, tz, 0.12, 1.4, 0.12, rot, lin([0.2, 0.2, 0.2]));
  // the clock, all four faces
  const clock = ctx.atlas.panel(2.6, 2.6, 60, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    const r = W / 2 - 2;
    q.fillStyle = '#f4efe2'; q.beginPath(); q.arc(W / 2, H / 2, r, 0, Math.PI * 2); q.fill();
    q.lineWidth = r * 0.07; q.strokeStyle = '#1e1e1e'; q.stroke();
    q.fillStyle = '#1e1e1e'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `700 ${r * 0.2}px ${SERIF}`;
    const RN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      q.fillText(RN[i], W / 2 + Math.cos(a) * r * 0.74, H / 2 + Math.sin(a) * r * 0.74);
    }
    // ten past ten, as every clock in a photograph
    q.lineCap = 'round';
    q.lineWidth = r * 0.07; q.beginPath(); q.moveTo(W / 2, H / 2); q.lineTo(W / 2 + Math.cos(-Math.PI / 2 + Math.PI * 2 * (10.17 / 12)) * r * 0.45, H / 2 + Math.sin(-Math.PI / 2 + Math.PI * 2 * (10.17 / 12)) * r * 0.45); q.stroke();
    q.lineWidth = r * 0.045; q.beginPath(); q.moveTo(W / 2, H / 2); q.lineTo(W / 2 + Math.cos(-Math.PI / 2 + Math.PI * 2 * (2 / 12)) * r * 0.66, H / 2 + Math.sin(-Math.PI / 2 + Math.PI * 2 * (2 / 12)) * r * 0.66); q.stroke();
  });
  for (const [a, b] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const nx = a * c - b * s, nz = a * s + b * c;
    const m = clock.clone();
    hang(g, m, tx + nx * (S / 2), top - 2.6, tz + nz * (S / 2), nx, nz, 0.05);
    // louvred belfry openings under the clock
    const ax = -nz, az = nx;
    for (const o of [-1.2, 0, 1.2]) {
      const p = [tx + nx * (S / 2 + 0.03) + ax * o, top - 4.9, tz + nz * (S / 2 + 0.03) + az * o];
      B.quad([p[0] - ax * 0.35, p[1], p[2] - az * 0.35], [p[0] + ax * 0.35, p[1], p[2] + az * 0.35], [p[0] + ax * 0.35, p[1] + 0.9, p[2] + az * 0.35], [p[0] - ax * 0.35, p[1] + 0.9, p[2] - az * 0.35], [nx, 0, nz], U0, lin([0.12, 0.12, 0.13]));
    }
  }
  ctx.solids.push({ x: tx, z: tz, hw: S / 2, hd: S / 2, rot, y0: base - 1, y1: top + 6 });
}

/** Black lamp posts down both sides of King St, each with two Uptown banners. */
function kingLamps(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const banner = L.panel(0.62, 1.5, 60, (q, W, H) => {
    q.fillStyle = '#16346b'; q.fillRect(0, 0, W, H);
    q.fillStyle = '#e8b830'; q.fillRect(0, H * 0.84, W, H * 0.05);
    q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `800 ${W * 0.62}px ${SERIF}`;
    q.fillText('W', W / 2, H * 0.26);
    q.font = `700 ${W * 0.19}px ${SANS}`;
    q.fillText('UPTOWN', W / 2, H * 0.55, W * 0.92);
    q.fillText('WATERLOO', W / 2, H * 0.68, W * 0.92);
  });
  const POST = lin([0.08, 0.09, 0.09]), GLOBE = lin([0.95, 0.93, 0.84]);
  let n = 0;
  for (let i = 0; i < UPTOWN_KING.length - 1; i++) {
    const a = UPTOWN_KING[i], b = UPTOWN_KING[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    for (let t = 12; t < len; t += 30) {
      const x0 = a[0] + ux * t, z0 = a[1] + uz * t;
      const k = street(city, x0, z0, 30, /^King Street/);
      if (!k) continue;
      for (const sd of [-1, 1]) {
        const off = k.hw + 1.0;
        const nx = -k.ez * sd, nz = k.ex * sd;
        const x = k.qx + nx * off, z = k.qz + nz * off;
        if (city.onRoad(x, z, 0.25, false, false)) continue;
        if (boxAt(city, x, z, 0.4) && boxAt(city, x, z, 0.4).h > 0.5) continue;
        if (KING_SKIP.some((p) => inPoly(p, x, z))) continue;
        const y = walkY(city, x, z);
        const B = kit.B(x, z);
        B.box(x, y - 0.2, z, 0.42, 0.9, 0.42, 0, POST);
        B.prism(x, y + 0.6, z, 0.085, 5.2, 6, POST);
        B.box(x, y + 5.8, z, 0.3, 0.12, 0.3, 0, POST);
        B.prism(x, y + 5.92, z, 0.2, 0.55, 6, GLOBE);
        B.box(x, y + 6.47, z, 0.48, 0.1, 0.48, 0, POST);
        // the banner arms reach out over the kerb; the banner hangs between
        // them, its faces up and down the street to the traffic
        for (const yy of [3.45, 4.95]) B.box(x - nx * 0.36, y + yy, z - nz * 0.36, 0.72, 0.05, 0.05, Math.atan2(nz, nx), POST);
        const g = kit.grp(x, z);
        for (const s2 of [1, -1]) hang(g, banner.clone(), x - nx * 0.4, y + 4.2, z - nz * 0.4, k.ex * s2, k.ez * s2, 0.02);
        ctx.solids.push({ x, z, r: 0.25, y0: y - 1, y1: y + 6.5 });
        n++;
      }
    }
  }
  return n;
}

// --- Uptown: Waterloo Public Square and the Town Square ----------------------------------

// Waterloo Public Square (OSM way 62299949) and the water wall's line along
// its west edge, in front of Beertown (75 King St S)
const SQUARE = [[-3863.5, -1351.3], [-3832.0, -1359.6], [-3819.6, -1356.5], [-3810.9, -1299.7], [-3843.0, -1277.4], [-3849.7, -1272.5], [-3861.9, -1343.6]];
const WATERWALL = [[-3855.0, -1318.5], [-3857.4, -1333.5]];
// the shade structures (2023): "large leaf-like structures with wood slats
// on steel posts" -- [x, z, yaw (rad, the leaf's long axis), length, width]
const LEAVES = [[-3829, -1289, 0.95, 11, 5.5], [-3843, -1297, 2.3, 9.5, 5], [-3820, -1312, 1.45, 9, 4.6], [-3848, -1281, 0.35, 8, 4.4], [-3823, -1349, 1.5, 8, 4]];

function publicSquare(kit, ctx) {
  const city = ctx.city;
  const STEEL = lin([0.24, 0.25, 0.27]), WOOD = lin([0.66, 0.47, 0.29]), WOOD2 = lin([0.56, 0.38, 0.22]);
  for (const [x, z, yaw, Lf, Wf] of LEAVES) {
    const B = kit.B(x, z);
    const ux = Math.cos(yaw), uz = Math.sin(yaw), vx = -uz, vz = ux;
    const y = walkY(city, x, z), h = 4.4;
    // two raked steel posts and a spine
    for (const s of [-0.28, 0.28]) {
      const px = x + ux * Lf * s, pz = z + uz * Lf * s;
      B.tube([px, y - 0.3, pz], [px + ux * s * 0.6, y + h + Math.abs(s) * 0.6, pz + uz * s * 0.6], 0.13, 6, STEEL);
      ctx.solids.push({ x: px, z: pz, r: 0.22, y0: y - 1, y1: y + h });
    }
    B.tube([x - ux * Lf * 0.48, y + h + 0.55, z - uz * Lf * 0.48], [x + ux * Lf * 0.48, y + h + 0.75, z + uz * Lf * 0.48], 0.09, 6, STEEL);
    // the slats across the leaf, the outline an ellipse, the leaf cambered
    for (let u = -Lf / 2 + 0.25; u < Lf / 2 - 0.2; u += 0.4) {
      const f = 1 - Math.pow(2 * u / Lf, 2);
      const hv = (Wf / 2) * Math.sqrt(Math.max(0, f));
      if (hv < 0.3) continue;
      const yy = y + h + 0.5 + 0.35 * f + u * 0.02;
      const cxs = x + ux * u, czs = z + uz * u;
      B.box(cxs, yy, czs, 0.14, 0.07, hv * 2, yaw, Math.round(u / 0.4) % 3 ? WOOD : WOOD2);
    }
  }
  // the water wall: a granite wall, a sheet of water down its face, three
  // pools stepping down into the square (off for the winter; October still runs)
  const [a, b] = WATERWALL;
  const dx = b[0] - a[0], dz = b[1] - a[1], Lw = Math.hypot(dx, dz);
  const ux = dx / Lw, uz = dz / Lw;
  // the square side is east (+x)
  let nx = uz, nz = -ux;
  if (nx < 0) { nx = -nx; nz = -nz; }
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, y = walkY(city, mx + nx * 3, mz + nz * 3);
  const B = kit.B(mx, mz);
  const GRANITE = lin([0.30, 0.30, 0.32]), RIM = lin([0.62, 0.61, 0.58]), WATER = lin([0.36, 0.56, 0.68]), SHEET = lin([0.80, 0.88, 0.93]);
  const rot = Math.atan2(uz, ux);
  B.box(mx, y - 0.3, mz, Lw, 2.2, 0.6, rot, GRANITE);
  const at = (t, yy, o) => [a[0] + ux * t + nx * o, yy, a[1] + uz * t + nz * o];
  B.quad(at(0.6, y + 0.3, 0.32), at(Lw - 0.6, y + 0.3, 0.32), at(Lw - 0.6, y + 1.75, 0.32), at(0.6, y + 1.75, 0.32), [nx, 0, nz], U0, [WATER, WATER, SHEET, SHEET]);
  ctx.solids.push({ x: mx, z: mz, hw: Lw / 2, hd: 0.3, rot, y0: y - 1, y1: y + 1.9 });
  for (let k = 0; k < 3; k++) {
    const o0 = 0.3 + k * 1.6, o1 = o0 + 1.6, top = 0.5 - k * 0.15;
    const t0 = 0.4 + k * 0.6, t1 = Lw - 0.4 - k * 0.6;
    const cxp = mx + nx * (o0 + o1) / 2, czp = mz + nz * (o0 + o1) / 2;
    B.box(cxp, y - 0.3, czp, t1 - t0, top + 0.3, 1.6, rot, RIM);
    B.quad(at(t0 + 0.15, y + top + 0.01, o0 + 0.1), at(t1 - 0.15, y + top + 0.01, o0 + 0.1), at(t1 - 0.15, y + top + 0.01, o1 - 0.15), at(t0 + 0.15, y + top + 0.01, o1 - 0.15), [0, 1, 0], U0, WATER);
    // the spill over each lip
    B.quad(at(t0 + 0.3, y + top, o1 + 0.01), at(t1 - 0.3, y + top, o1 + 0.01), at(t1 - 0.3, y + top - 0.15, o1 + 0.01), at(t0 + 0.3, y + top - 0.15, o1 + 0.01), [nx, 0, nz], U0, SHEET);
  }
}

/** The Shops at Waterloo Town Square: brick piers, glass, a metal cornice, and their signs. */
function townSquare(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  let pts = simplify(P.townsq.p, 0.6);
  if (polyArea(pts) < 0) pts = pts.slice().reverse();
  const [cx, cz] = centroid(pts);
  const B = kit.B(cx, cz), g = kit.grp(cx, cz);
  const base = walkY(city, cx, cz), yTop = base + 8.4;
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const BR = lin([0.55, 0.30, 0.22]), MET = lin([0.30, 0.32, 0.34]), GL = lin([0.16, 0.21, 0.26]), GL2 = lin([0.30, 0.38, 0.44]);
  const signs = [];
  for (const e of edges(pts)) {
    const N = [e.nx, 0, e.nz];
    B.quad(e.at(0, lo - 1.2), e.at(e.L, lo - 1.2), e.at(e.L, yTop + 0.6), e.at(0, yTop + 0.6), N, U0, BR);
    B.quad(e.at(0, yTop - 1.6, 0.25), e.at(e.L, yTop - 1.6, 0.25), e.at(e.L, yTop + 0.6, 0.25), e.at(0, yTop + 0.6, 0.25), N, U0, MET);
    B.quad(e.at(0, yTop + 0.6, 0.25), e.at(e.L, yTop + 0.6, 0.25), e.at(e.L, yTop + 0.6, 0), e.at(0, yTop + 0.6, 0), [0, 1, 0], U0, MET);
    ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: lo - 1.2, y1: yTop + 0.6 });
    if (e.L < 6) continue;
    const gy = walkY(city, e.mx + e.nx * 1.5, e.mz + e.nz * 1.5);
    // glass bays between brick piers, on every face but the loading side
    const nb = Math.floor(e.L / 6);
    for (let k = 0; k < nb; k++) {
      const t0 = (e.L - nb * 6) / 2 + k * 6 + 0.5, t1 = t0 + 5;
      B.quad(e.at(t0, gy - 0.2, 0.04), e.at(t1, gy - 0.2, 0.04), e.at(t1, gy + 5.6, 0.04), e.at(t0, gy + 5.6, 0.04), N, U0, [GL, GL, GL2, GL2]);
      B.quad(e.at(t0, gy + 2.9, 0.06), e.at(t1, gy + 2.9, 0.06), e.at(t1, gy + 3.05, 0.06), e.at(t0, gy + 3.05, 0.06), N, U0, MET);
      for (const t of [t0 + 1.66, t0 + 3.33]) B.quad(e.at(t - 0.05, gy - 0.2, 0.06), e.at(t + 0.05, gy - 0.2, 0.06), e.at(t + 0.05, gy + 5.6, 0.06), e.at(t - 0.05, gy + 5.6, 0.06), N, U0, MET);
    }
    signs.push(e);
  }
  roof(B, pts, yTop, lin([0.42, 0.42, 0.41]));
  // the signs: the centre's name to the square, the grocer to its lot, Beertown by its door
  const put = (text, sub, bg, fg, w, h, px, pz, font) => {
    let best = null, bd = Infinity;
    for (const e of signs) {
      const t = Math.max(w / 2 + 0.3, Math.min(e.L - w / 2 - 0.3, (px - e.a[0]) * e.ux + (pz - e.a[1]) * e.uz));
      if (e.L < w + 0.6) continue;
      const q = e.at(t, 0), d = Math.hypot(q[0] - px, q[2] - pz);
      if (d < bd) { bd = d; best = { e, t }; }
    }
    if (!best) return;
    const { e, t } = best;
    const p = e.at(t, yTop - 0.5, 0.27);
    const m = L.panel(w, h, 40, (q, W, H) => {
      if (bg) { q.fillStyle = bg; q.fillRect(0, 0, W, H); } else q.clearRect(0, 0, W, H);
      q.fillStyle = fg; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `${font || '700'} ${H * (sub ? 0.5 : 0.7)}px ${SANS}`;
      q.fillText(text, W / 2, H * (sub ? 0.38 : 0.54), W * 0.94);
      if (sub) { q.font = `600 ${H * 0.26}px ${SANS}`; q.fillText(sub, W / 2, H * 0.8, W * 0.94); }
    });
    hang(g, m, p[0], p[1], p[2], e.nx, e.nz, 0.02);
  };
  put('WATERLOO TOWN SQUARE', null, null, '#f2f2f2', 13, 1.25, -3855, -1300, '700');
  put('your independent grocer', null, '#ffffff', '#d21f26', 9, 1.25, -3954, -1325, '800');
  put('BEERTOWN', 'PUBLIC HOUSE', '#141414', '#d9b25a', 6, 1.4, -3862, -1331, '800');
}

/**
 * THE SEAGRAM LOFTS, 3 and 5 Father David Bauer Dr: Seagram's barrel
 * warehouses (1905 and 1907) in buff Waterloo brick, their "pint-sized"
 * windows that vented the ageing whisky, lofts since 2001; the painted
 * SEAGRAM sign on No. 3.
 */
function seagram(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  const BUFF = lin([0.80, 0.69, 0.50]), DARK = lin([0.62, 0.52, 0.37]), WIN = lin([0.14, 0.15, 0.16]), SILL = lin([0.86, 0.82, 0.72]);
  for (const key of ['seagram3', 'seagram5']) {
    let pts = P[key].p;
    if (polyArea(pts) < 0) pts = pts.slice().reverse();
    const [cx, cz] = centroid(pts);
    const B = kit.B(cx, cz), g = kit.grp(cx, cz);
    const fl = P[key].lv || 6, st = 3.3;
    const base = T(cx, cz), yTop = base + fl * st + 1;
    let lo = Infinity;
    for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
    const E = edges(pts);
    // the painted sign: on No. 3's long face that looks toward Uptown
    let signE = null, sk = -Infinity;
    if (key === 'seagram3') {
      const longest = Math.max(...E.map((e) => e.L));
      const ux = -3840 - cx, uz = -1400 - cz, ul = Math.hypot(ux, uz);
      for (const e of E) {
        if (e.L < longest * 0.8) continue;
        const k = (e.nx * ux + e.nz * uz) / ul;
        if (k > sk) { sk = k; signE = e; }
      }
    }
    for (const e of E) {
      const N = [e.nx, 0, e.nz];
      B.quad(e.at(0, lo - 1.2), e.at(e.L, lo - 1.2), e.at(e.L, yTop + 0.8), e.at(0, yTop + 0.8), N, U0, [DARK, DARK, BUFF, BUFF]);
      B.quad(e.at(0, yTop + 0.8, 0.12), e.at(e.L, yTop + 0.8, 0.12), e.at(e.L, yTop + 0.9, 0), e.at(0, yTop + 0.9, 0), [0, 1, 0], U0, SILL);
      ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: lo - 1.2, y1: yTop + 0.8 });
      const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
      // brick pilasters every 4.5 m, small windows between them on every floor
      const nb = Math.max(1, Math.floor(e.L / 4.5));
      const bw = e.L / nb;
      for (let k = 0; k <= nb; k++) {
        const p = e.at(k * bw, gy - 0.5, 0.08);
        B.box(p[0], p[1], p[2], 0.7, yTop - gy + 0.5, 0.2, Math.atan2(e.uz, e.ux), DARK);
      }
      const sgn = e === signE;
      for (let f = 0; f < fl; f++) {
        const y0 = gy + 1.2 + f * st;
        if (y0 + 1.1 > yTop - 0.5) break;
        if (sgn && f >= fl - 3) continue;   // the painted sign's field
        for (let k = 0; k < nb * 2; k++) {
          const t = (Math.floor(k / 2) + (k % 2 ? 0.7 : 0.3)) * bw;
          B.quad(e.at(t - 0.4, y0, 0.04), e.at(t + 0.4, y0, 0.04), e.at(t + 0.4, y0 + 1.1, 0.04), e.at(t - 0.4, y0 + 1.1, 0.04), N, U0, WIN);
          B.quad(e.at(t - 0.5, y0 - 0.14, 0.07), e.at(t + 0.5, y0 - 0.14, 0.07), e.at(t + 0.5, y0, 0.07), e.at(t - 0.5, y0, 0.07), N, U0, SILL);
          B.quad(e.at(t - 0.5, y0 + 1.1, 0.06), e.at(t + 0.5, y0 + 1.1, 0.06), e.at(t + 0.5, y0 + 1.3, 0.06), e.at(t - 0.5, y0 + 1.3, 0.06), N, U0, DARK);
        }
      }
      if (sgn) {
        const w = Math.min(e.L - 3, 26), h = st * 2.6;
        const m = L.panel(w, h, 14, (q, W, H) => {
          q.fillStyle = '#9a7c55'; q.fillRect(0, 0, W, H);
          q.fillStyle = 'rgba(245,238,220,0.92)'; q.textAlign = 'center'; q.textBaseline = 'middle';
          q.font = `800 ${H * 0.36}px ${SERIF}`;
          q.fillText('SEAGRAM', W / 2, H * 0.36, W * 0.94);
          q.font = `700 ${H * 0.2}px ${SERIF}`;
          q.fillText('DISTILLERS  LIMITED', W / 2, H * 0.74, W * 0.94);
        });
        const p = e.at(e.L / 2, yTop - 0.4 - h / 2, 0.2);
        hang(g, m, p[0], p[1], p[2], e.nx, e.nz, 0.02);
        STATS.seagramSign = [Math.round(p[0]), Math.round(p[1]), Math.round(p[2]), +e.nx.toFixed(2), +e.nz.toFixed(2), w, h];
      }
    }
    roof(B, pts, yTop, lin([0.34, 0.33, 0.32]));
  }
}

// --- Waterloo Park --------------------------------------------------------------------

// Footbridges (OSM ways): the steel one by the grist mill (917459902), the
// wooden one and the Laurel Trail's boardwalk bridge beside ION's at the lake's
// west end (610946356, 34732744), the steel path bridge over Laurel Creek (1244773175)
const BRIDGES = [
  { a: [-4137.3, -1524.0], b: [-4167.5, -1510.2], w: 2.6, kind: 'steel' },
  { a: [-4470.4, -1541.3], b: [-4446.4, -1519.1], w: 2.4, kind: 'wood' },
  { a: [-4474.4, -1536.7], b: [-4450.3, -1513.9], w: 2.8, kind: 'wood' },
  { a: [-4623.9, -1555.5], b: [-4639.0, -1552.1], w: 2.4, kind: 'steel' },
];
const JUBILEE_GATE = [-4212, -1749], YOUNG_ENTRANCE = [-4182, -1757];
// the splash pad off Father David Bauer Dr (OSM way 824034895)
const SPLASH = [[-4736.2, -1511.3], [-4749.2, -1521.8], [-4735.9, -1529.2], [-4727.4, -1533.7], [-4717.7, -1518.3], [-4727.5, -1515.5]];

function bridges(kit, ctx, waterAt) {
  for (const br of BRIDGES) {
    const dx = br.b[0] - br.a[0], dz = br.b[1] - br.a[1], Lb = Math.hypot(dx, dz);
    const ux = dx / Lb, uz = dz / Lb, vx = -uz, vz = ux;
    // over the water: a clear metre over the drawn surface, never under the banks
    let wl = -Infinity;
    for (let t = 0; t <= Lb; t += 2) {
      const w = waterAt(br.a[0] + ux * t, br.a[1] + uz * t);
      if (w !== null) wl = Math.max(wl, w);
    }
    const ends = [T(br.a[0], br.a[1]), T(br.b[0], br.b[1])];
    const top = Math.max(ends[0] + 0.2, ends[1] + 0.2, wl + 1.1);
    const ext = 3;   // ramps down to the path beyond each end
    const prof = (t) => {
      if (t < 0) return ends[0] + 0.15 + (top - ends[0] - 0.15) * (1 + t / ext);
      if (t > Lb) return ends[1] + 0.15 + (top - ends[1] - 0.15) * (1 - (t - Lb) / ext);
      return top + 0.25 * Math.sin(Math.PI * t / Lb);
    };
    const [mx, mz] = [(br.a[0] + br.b[0]) / 2, (br.a[1] + br.b[1]) / 2];
    const B = kit.B(mx, mz);
    const DECK = lin(br.kind === 'wood' ? [0.55, 0.40, 0.27] : [0.50, 0.50, 0.49]);
    const RAIL = lin(br.kind === 'wood' ? [0.45, 0.32, 0.21] : [0.20, 0.33, 0.27]);
    const hw = br.w / 2;
    const P = (t, v, y) => [br.a[0] + ux * t + vx * v, y, br.a[1] + uz * t + vz * v];
    const NS = Math.max(6, Math.round((Lb + 2 * ext) / 2));
    for (let i = 0; i < NS; i++) {
      const t0 = -ext + (Lb + 2 * ext) * i / NS, t1 = -ext + (Lb + 2 * ext) * (i + 1) / NS;
      const y0 = prof(t0), y1 = prof(t1);
      B.quad(P(t0, -hw, y0), P(t1, -hw, y1), P(t1, hw, y1), P(t0, hw, y0), [0, 1, 0], U0, DECK);
      for (const s of [-1, 1]) B.quad(P(t0, s * hw, y0), P(t1, s * hw, y1), P(t1, s * hw, y1 - 0.35), P(t0, s * hw, y0 - 0.35), [vx * s, 0, vz * s], U0, shade(DECK, 0.7));
      B.quad(P(t0, -hw, y0 - 0.35), P(t1, -hw, y1 - 0.35), P(t1, hw, y1 - 0.35), P(t0, hw, y0 - 0.35), [0, -1, 0], U0, shade(DECK, 0.5));
      // the walkable deck, a sloped platform per piece
      const cxp = br.a[0] + ux * (t0 + t1) / 2, czp = br.a[1] + uz * (t0 + t1) / 2;
      ctx.platforms.push({ x: cxp, z: czp, hw, hd: (t1 - t0) / 2 + 0.05, rot: Math.atan2(uz, ux) - Math.PI / 2, y0, y1 });
    }
    // railings: posts and two rails over the span
    for (let t = 0; t <= Lb + 0.01; t += Lb / Math.max(2, Math.round(Lb / 2.2))) {
      for (const s of [-1, 1]) {
        const p = P(t, s * (hw - 0.06), prof(t));
        B.box(p[0], p[1], p[2], 0.1, 1.05, 0.1, Math.atan2(uz, ux), RAIL);
      }
    }
    for (const s of [-1, 1]) {
      for (const yy of [0.5, 1.02]) {
        const NR = 8;
        for (let i = 0; i < NR; i++) {
          const t0 = Lb * i / NR, t1 = Lb * (i + 1) / NR;
          B.tube(P(t0, s * (hw - 0.06), prof(t0) + yy), P(t1, s * (hw - 0.06), prof(t1) + yy), 0.04, 4, RAIL);
        }
      }
      ctx.solids.push({ x: mx + vx * s * hw, z: mz + vz * s * hw, hw: Lb / 2 - 0.6, hd: 0.08, rot: Math.atan2(uz, ux), y0: top - 0.2, y1: top + 1.1 });
    }
    if (br.kind === 'steel') {
      // a shallow steel arch along each side, the bridge's truss
      for (const s of [-1, 1]) {
        const NA = 10;
        for (let i = 0; i < NA; i++) {
          const t0 = Lb * i / NA, t1 = Lb * (i + 1) / NA;
          const h0 = 1.3 + 0.9 * Math.sin(Math.PI * t0 / Lb), h1 = 1.3 + 0.9 * Math.sin(Math.PI * t1 / Lb);
          B.tube(P(t0, s * (hw + 0.05), prof(t0) + h0 - 0.4), P(t1, s * (hw + 0.05), prof(t1) + h1 - 0.4), 0.07, 5, RAIL);
        }
      }
    }
  }
}

/** The grist mill replica (1998) at Silver Lake's outlet: board-and-batten, stone footing, gable, the wheel. */
function gristMill(kit, ctx) {
  const pts = P.mill.p, o = obb(pts);
  const B = kit.B(o.x, o.z), g = kit.grp(o.x, o.z);
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const WOOD = lin([0.44, 0.30, 0.20]), BAT = lin([0.34, 0.23, 0.15]), STONE = lin([0.55, 0.53, 0.50]), ROOF = lin([0.32, 0.29, 0.27]);
  B.box(o.x, lo - 1, o.z, o.hu * 2 + 0.3, 2.2, o.hv * 2 + 0.3, Math.atan2(o.uz, o.ux), STONE);
  const Pf = gabled(B, o, lo + 1.2, lo + 7.2, lo + 10.6, WOOD, ROOF, { overhang: 0.5 });
  // battens down the long walls
  const vx = -o.uz, vz = o.ux;
  for (const s of [-1, 1]) {
    for (let u = -o.hu + 0.4; u < o.hu; u += 0.6) {
      B.quad(Pf(u - 0.04, s * (o.hv + 0.02), lo + 1.2), Pf(u + 0.04, s * (o.hv + 0.02), lo + 1.2), Pf(u + 0.04, s * (o.hv + 0.02), lo + 7.2), Pf(u - 0.04, s * (o.hv + 0.02), lo + 7.2), [vx * s, 0, vz * s], U0, BAT);
    }
    // two windows a floor
    for (const u of [-o.hu * 0.5, o.hu * 0.5]) {
      for (const yy of [2.6, 5.2]) {
        B.quad(Pf(u - 0.45, s * (o.hv + 0.04), lo + yy), Pf(u + 0.45, s * (o.hv + 0.04), lo + yy), Pf(u + 0.45, s * (o.hv + 0.04), lo + yy + 1.1), Pf(u - 0.45, s * (o.hv + 0.04), lo + yy + 1.1), [vx * s, 0, vz * s], U0, lin([0.12, 0.12, 0.12]));
      }
    }
  }
  // the wheel, on the side toward the race (the canal by the weir, OSM 808607195)
  const race = [-4134, -1501];
  const side = ((race[0] - o.x) * vx + (race[1] - o.z) * vz) > 0 ? 1 : -1;
  const wx = o.x + vx * side * (o.hv + 0.9), wz = o.z + vz * side * (o.hv + 0.9), wy = lo + 2.6;
  const R = 2.6, NSp = 12, W = 1.1;
  const ax = vx * side, az = vz * side;   // the axle direction
  const pt = (a, r, s) => [wx + o.ux * Math.cos(a) * r + ax * s, wy + Math.sin(a) * r, wz + o.uz * Math.cos(a) * r + az * s];
  const WW = lin([0.38, 0.27, 0.18]);
  for (const s of [-W / 2, W / 2]) {
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
      B.tube(pt(a0, R, s), pt(a1, R, s), 0.09, 4, WW);
    }
    for (let i = 0; i < NSp; i++) B.tube(pt(0, 0, s), pt((i / NSp) * Math.PI * 2, R, s), 0.06, 4, WW);
  }
  for (let i = 0; i < NSp * 2; i++) {
    const a = (i / (NSp * 2)) * Math.PI * 2;
    const p0 = pt(a, R - 0.4, -W / 2), p1 = pt(a, R - 0.4, W / 2), p2 = pt(a, R + 0.05, W / 2), p3 = pt(a, R + 0.05, -W / 2);
    B.quad(p0, p1, p2, p3, [o.ux * Math.cos(a + Math.PI / 2), Math.sin(a + Math.PI / 2), o.uz * Math.cos(a + Math.PI / 2)], U0, WW);
  }
  B.tube(pt(0, 0, -W / 2 - 0.9), pt(0, 0, W / 2 + 0.2), 0.15, 6, lin([0.2, 0.2, 0.2]));
  ctx.solids.push({ x: o.x, z: o.z, hw: o.hu + 0.2, hd: o.hv + 0.2, rot: Math.atan2(o.uz, o.ux), y0: lo - 1, y1: lo + 10 });
  ctx.solids.push({ x: wx, z: wz, r: R * 0.9, y0: wy - R, y1: wy + R });
  const p = Pf(o.hu + 0.05, 0, lo + 7.9);
  const sg = ctx.atlas.panel(3.2, 0.7, 40, (q, Wd, H) => {
    q.fillStyle = '#2b1d12'; q.fillRect(0, 0, Wd, H);
    q.fillStyle = '#efe0bf'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `700 ${H * 0.6}px ${SERIF}`; q.fillText('GRIST MILL', Wd / 2, H * 0.55, Wd * 0.92);
  });
  hang(g, sg, p[0], p[1], p[2], o.ux, o.uz, 0.03);
}

/** The 1820 log schoolhouse: Waterloo's first school, the region's oldest log school house. */
function logSchool(kit, ctx) {
  const o = obb(P.school.p);
  const B = kit.B(o.x, o.z), g = kit.grp(o.x, o.z);
  let lo = Infinity;
  for (const q of P.school.p) lo = Math.min(lo, T(q[0], q[1]));
  const LOG = [lin([0.42, 0.29, 0.18]), lin([0.36, 0.25, 0.16])], CHINK = lin([0.78, 0.74, 0.66]);
  const rot = Math.atan2(o.uz, o.ux), vx = -o.uz, vz = o.ux;
  B.box(o.x, lo - 0.6, o.z, o.hu * 2, 0.9, o.hv * 2, rot, lin([0.5, 0.48, 0.45]));
  // the logs: courses 0.32 m, the corners notched past each other
  for (let k = 0; k < 9; k++) {
    const y = lo + 0.3 + k * 0.32;
    const alongU = k % 2 === 0;
    B.box(o.x, y, o.z, o.hu * 2 + (alongU ? 0.5 : 0), 0.3, o.hv * 2 + (alongU ? 0 : 0.5), rot, LOG[k % 2]);
    B.box(o.x, y + 0.29, o.z, o.hu * 2 + 0.02, 0.04, o.hv * 2 + 0.02, rot, CHINK);
  }
  const top = lo + 0.3 + 9 * 0.32;
  const Pf = gabled(B, { ...o, hu: o.hu, hv: o.hv }, top - 0.01, top, top + 2.2, LOG[0], lin([0.30, 0.27, 0.24]), { overhang: 0.45 });
  // a door at one end and a window each side
  const dP = Pf(o.hu + 0.03, 0, lo + 0.35);
  B.quad([dP[0] - vx * 0.5, dP[1], dP[2] - vz * 0.5], [dP[0] + vx * 0.5, dP[1], dP[2] + vz * 0.5], [dP[0] + vx * 0.5, dP[1] + 2.0, dP[2] + vz * 0.5], [dP[0] - vx * 0.5, dP[1] + 2.0, dP[2] - vz * 0.5], [o.ux, 0, o.uz], U0, lin([0.25, 0.17, 0.10]));
  for (const s of [-1, 1]) {
    const w = Pf(0, s * (o.hv + 0.03), lo + 1.2);
    B.quad([w[0] - o.ux * 0.45, w[1], w[2] - o.uz * 0.45], [w[0] + o.ux * 0.45, w[1], w[2] + o.uz * 0.45], [w[0] + o.ux * 0.45, w[1] + 0.9, w[2] + o.uz * 0.45], [w[0] - o.ux * 0.45, w[1] + 0.9, w[2] - o.uz * 0.45], [vx * s, 0, vz * s], U0, lin([0.12, 0.13, 0.14]));
  }
  ctx.solids.push({ x: o.x, z: o.z, hw: o.hu + 0.25, hd: o.hv + 0.25, rot, y0: lo - 1, y1: top + 2.2 });
  // the plaque post by the door
  const sx = o.x + o.ux * (o.hu + 2.4), sz = o.z + o.uz * (o.hu + 2.4), sy = T(sx, sz);
  B.box(sx, sy - 0.3, sz, 0.12, 1.3, 0.12, rot, lin([0.2, 0.2, 0.2]));
  const pl = ctx.atlas.panel(1.1, 0.7, 60, (q, W, H) => {
    q.fillStyle = '#123a6b'; q.fillRect(0, 0, W, H);
    q.strokeStyle = '#d7b44a'; q.lineWidth = 3; q.strokeRect(3, 3, W - 6, H - 6);
    q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `700 ${H * 0.2}px ${SERIF}`; q.fillText('FIRST SCHOOL HOUSE', W / 2, H * 0.32, W * 0.9);
    q.font = `600 ${H * 0.16}px ${SERIF}`; q.fillText('IN WATERLOO · 1820', W / 2, H * 0.62, W * 0.9);
  });
  hang(g, pl, sx, sy + 1.25, sz, o.ux, o.uz, 0.07);
}

/** A gazebo / shelter: an octagonal (or square) hip roof on posts, over a deck. */
function gazebo(kit, ctx, pts, opts = {}) {
  const [cx, cz] = centroid(pts);
  let r = 0;
  for (const q of pts) r = Math.max(r, Math.hypot(q[0] - cx, q[1] - cz));
  r = Math.min(Math.max(r * 0.9, 2.5), 7);
  const B = kit.B(cx, cz);
  const y = T(cx, cz), n = 8;
  const POST = lin([0.93, 0.92, 0.88]), ROOF = lin(opts.roof || [0.20, 0.32, 0.24]), DECK = lin([0.60, 0.52, 0.42]);
  B.prism(cx, y - 0.3, cz, r, 0.55, n, DECK);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    B.tri([cx + Math.cos(a0) * r, y + 0.25, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y + 0.25, cz + Math.sin(a1) * r], [cx, y + 0.25, cz], [0, 1, 0], DECK);
    const px = cx + Math.cos(a0) * (r - 0.3), pz = cz + Math.sin(a0) * (r - 0.3);
    B.prism(px, y + 0.25, pz, 0.1, 2.6, 6, POST);
    ctx.solids.push({ x: px, z: pz, r: 0.15, y0: y - 1, y1: y + 2.9 });
    const R = r + 0.4, e = y + 2.85, apex = y + 2.85 + r * 0.55;
    const ax = cx + Math.cos(a0) * R, az = cz + Math.sin(a0) * R, bx = cx + Math.cos(a1) * R, bz = cz + Math.sin(a1) * R;
    const am = (a0 + a1) / 2;
    B.tri([ax, e, az], [bx, e, bz], [cx, apex, cz], [Math.cos(am) * 0.6, 0.8, Math.sin(am) * 0.6], ROOF);
    B.tri([ax, e - 0.02, az], [bx, e - 0.02, bz], [cx, apex - 0.05, cz], [-Math.cos(am) * 0.6, -0.8, -Math.sin(am) * 0.6], shade(ROOF, 0.6));
    B.quad([ax, e, az], [bx, e, bz], [bx, e - 0.3, bz], [ax, e - 0.3, az], [Math.cos(am), 0, Math.sin(am)], U0, POST);
  }
  B.prism(cx, y + 2.85 + r * 0.55 - 0.1, cz, 0.12, 0.6, 6, POST);
}

/** The Eby farmhouse (the Potters' Workshop since 1967), the Eby Farmstead's barn and its paddocks, empty since 2024. */
function ebyFarmstead(kit, ctx) {
  const city = ctx.city;
  {
    // the farmhouse: a storey and a half of buff brick under a gable
    const o = obb(P.potters.p);
    const B = kit.B(o.x, o.z), g = kit.grp(o.x, o.z);
    const y = T(o.x, o.z) - 0.4;
    const W = lin([0.84, 0.74, 0.54]), R = lin([0.28, 0.26, 0.25]);
    const Pf = gabled(B, o, y, y + 5.4, y + 8.6, W, R, { overhang: 0.35 });
    const vx = -o.uz, vz = o.ux;
    for (const s of [-1, 1]) for (const u of [-o.hu * 0.6, -o.hu * 0.2, o.hu * 0.2, o.hu * 0.6]) {
      for (const yy of [1.1, 3.5]) {
        const p = Pf(u, s * (o.hv + 0.03), y + yy);
        B.quad([p[0] - o.ux * 0.45, p[1], p[2] - o.uz * 0.45], [p[0] + o.ux * 0.45, p[1], p[2] + o.uz * 0.45], [p[0] + o.ux * 0.45, p[1] + 1.4, p[2] + o.uz * 0.45], [p[0] - o.ux * 0.45, p[1] + 1.4, p[2] - o.uz * 0.45], [vx * s, 0, vz * s], U0, lin([0.13, 0.14, 0.15]));
      }
    }
    ctx.solids.push({ x: o.x, z: o.z, hw: o.hu, hd: o.hv, rot: Math.atan2(o.uz, o.ux), y0: y - 1, y1: y + 8.6 });
    const rd = street(city, o.x, o.z, 120);
    const fx = rd ? (rd.qx - o.x) : vx, fz = rd ? (rd.qz - o.z) : vz, fl = Math.hypot(fx, fz) || 1;
    // the sign at the side nearest a path
    const sp = ctx.atlas.panel(3.4, 0.6, 40, (q, Wd, H) => {
      q.fillStyle = '#f4efe2'; q.fillRect(0, 0, Wd, H);
      q.fillStyle = '#5a2a1a'; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `italic 700 ${H * 0.55}px ${SERIF}`; q.fillText("Waterloo Potters' Workshop", Wd / 2, H * 0.55, Wd * 0.94);
    });
    const dot = (fx / fl) * vx + (fz / fl) * vz, s = dot >= 0 ? 1 : -1;
    const p = Pf(0, s * (o.hv + 0.05), y + 2.9);
    hang(g, sp, p[0], p[1], p[2], vx * s, vz * s, 0.03);
  }
  {
    // the barn: red board, a gambrel roof, white trim
    const o = obb(P.ebybarn.p);
    const B = kit.B(o.x, o.z), g = kit.grp(o.x, o.z);
    const y = T(o.x, o.z) - 0.3;
    const RED = lin([0.55, 0.16, 0.12]), WH = lin([0.92, 0.91, 0.88]), RF = lin([0.30, 0.30, 0.31]);
    const rot = Math.atan2(o.uz, o.ux), vx = -o.uz, vz = o.ux;
    const hu = Math.max(o.hu, 4), hv = Math.max(o.hv, 3.5);
    const ob = { ...o, hu, hv };
    const Pf = gabled(B, ob, y, y + 3.6, y + 3.6, RED, RF, { overhang: 0 });
    // gambrel: a steep lower pitch and a shallow upper one, gable ends filled
    const prof = [[hv + 0.3, 3.4], [hv * 0.62, 5.6], [0, 6.8]];
    for (const s of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const [v0, h0] = prof[k], [v1, h1] = prof[k + 1];
        const n = [vx * s * (h1 - h0), (v0 - v1), vz * s * (h1 - h0)];
        const nl = Math.hypot(n[0], n[1], n[2]);
        B.quad(Pf(-hu - 0.3, s * v0, y + h0), Pf(hu + 0.3, s * v0, y + h0), Pf(hu + 0.3, s * v1, y + h1), Pf(-hu - 0.3, s * v1, y + h1), [n[0] / nl, n[1] / nl, n[2] / nl], U0, RF);
      }
      for (const e of [-1, 1]) {
        B.quad(Pf(e * hu, -hv, y + 3.6), Pf(e * hu, hv, y + 3.6), Pf(e * hu, prof[1][0], y + prof[1][1]), Pf(e * hu, -prof[1][0], y + prof[1][1]), [o.ux * e, 0, o.uz * e], U0, RED);
        B.tri(Pf(e * hu, -prof[1][0], y + prof[1][1]), Pf(e * hu, prof[1][0], y + prof[1][1]), Pf(e * hu, 0, y + prof[2][1]), [o.ux * e, 0, o.uz * e], RED);
      }
    }
    // the big doors with their white X
    for (const e of [-1, 1]) {
      const c0 = Pf(e * (hu + 0.03), -1.4, y), c1 = Pf(e * (hu + 0.03), 1.4, y), c2 = Pf(e * (hu + 0.03), 1.4, y + 3.0), c3 = Pf(e * (hu + 0.03), -1.4, y + 3.0);
      B.quad(c0, c1, c2, c3, [o.ux * e, 0, o.uz * e], U0, shade(RED, 0.8));
      B.tube(Pf(e * (hu + 0.06), -1.4, y), Pf(e * (hu + 0.06), 1.4, y + 3.0), 0.07, 4, WH);
      B.tube(Pf(e * (hu + 0.06), 1.4, y), Pf(e * (hu + 0.06), -1.4, y + 3.0), 0.07, 4, WH);
    }
    ctx.solids.push({ x: o.x, z: o.z, hw: hu, hd: hv, rot, y0: y - 1, y1: y + 6.8 });
    // the paddocks: three post-and-rail pens off the barn's long side, empty
    const FENCE = lin([0.62, 0.55, 0.44]);
    let side = 1;
    for (const s of [1, -1]) {
      const px = o.x + vx * s * (hv + 9), pz = o.z + vz * s * (hv + 9);
      if (!city.onRoad(px, pz, 6) && !boxAt(city, px, pz, 4)) { side = s; break; }
    }
    const v0 = hv + 1.5, v1 = hv + 15, u0 = -hu - 12, u1 = hu + 12;
    // a post-and-rail run, broken wherever a path or road crosses it
    const rail = (pa, pb) => {
      const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), n = Math.max(1, Math.round(L / 2.5));
      const at = (i) => [pa[0] + (pb[0] - pa[0]) * i / n, pa[1] + (pb[1] - pa[1]) * i / n];
      const clear = (q) => !city.onRoad(q[0], q[1], 0.8) && !boxAt(city, q[0], q[1], 0.5);
      for (let i = 0; i < n; i++) {
        const a = at(i), b = at(i + 1), m = at(i + 0.5);
        if (!clear(a) || !clear(b) || !clear(m)) continue;
        B.box(a[0], T(a[0], a[1]) - 0.2, a[1], 0.14, 1.45, 0.14, rot, FENCE);
        B.box(b[0], T(b[0], b[1]) - 0.2, b[1], 0.14, 1.45, 0.14, rot, FENCE);
        for (const yy of [0.55, 1.05]) B.tube([a[0], T(a[0], a[1]) + yy, a[1]], [b[0], T(b[0], b[1]) + yy, b[1]], 0.05, 4, FENCE);
        ctx.solids.push({ x: m[0], z: m[1], hw: L / n / 2, hd: 0.1, rot: Math.atan2(pb[1] - pa[1], pb[0] - pa[0]), y0: T(m[0], m[1]) - 1, y1: T(m[0], m[1]) + 1.3 });
      }
    };
    const Q = (u, v) => [o.x + o.ux * u + vx * side * v, o.z + o.uz * u + vz * side * v];
    rail(Q(u0, v0), Q(u1, v0)); rail(Q(u1, v0), Q(u1, v1)); rail(Q(u1, v1), Q(u0, v1)); rail(Q(u0, v1), Q(u0, v0));
    rail(Q((u0 + u1) / 2 - 6, v0), Q((u0 + u1) / 2 - 6, v1)); rail(Q((u0 + u1) / 2 + 6, v0), Q((u0 + u1) / 2 + 6, v1));
    // the farmstead's board at the corner of the pens
    const sq = Q(u1 + 2, v0), sy = T(sq[0], sq[1]);
    for (const d of [-0.9, 0.9]) B.box(sq[0] + o.ux * d, sy - 0.3, sq[1] + o.uz * d, 0.12, 2.1, 0.12, rot, FENCE);
    const sg = ctx.atlas.panel(2.2, 0.8, 50, (q, W, H) => {
      q.fillStyle = '#2f4a2a'; q.fillRect(0, 0, W, H);
      q.fillStyle = '#f2e8cf'; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `700 ${H * 0.36}px ${SERIF}`; q.fillText('EBY FARMSTEAD', W / 2, H * 0.36, W * 0.92);
      q.font = `600 ${H * 0.2}px ${SERIF}`; q.fillText('WATERLOO PARK', W / 2, H * 0.74, W * 0.92);
    });
    hang(g, sg, sq[0], sy + 1.35, sq[1], vx * side, vz * side, 0.02);
    const sg2 = sg.clone();
    hang(g, sg2, sq[0], sy + 1.35, sq[1], -vx * side, -vz * side, 0.02);
  }
  {
    // the Park Inn's servery: a white cottage with a green roof
    const o = obb(P.parkinn.p);
    const B = kit.B(o.x, o.z), g = kit.grp(o.x, o.z);
    const y = T(o.x, o.z) - 0.3;
    const Pf = gabled(B, { ...o, hu: Math.max(o.hu, 3), hv: Math.max(o.hv, 2.5) }, y, y + 3.2, y + 5, lin([0.93, 0.92, 0.88]), lin([0.18, 0.36, 0.24]), { overhang: 0.6 });
    ctx.solids.push({ x: o.x, z: o.z, hw: Math.max(o.hu, 3), hd: Math.max(o.hv, 2.5), rot: Math.atan2(o.uz, o.ux), y0: y - 1, y1: y + 5 });
    const p = Pf(Math.max(o.hu, 3) + 0.05, 0, y + 3.6);
    const sg = ctx.atlas.panel(2, 0.55, 50, (q, W, H) => {
      q.fillStyle = '#1f4a30'; q.fillRect(0, 0, W, H);
      q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `700 ${H * 0.6}px ${SERIF}`; q.fillText('PARK INN', W / 2, H * 0.55, W * 0.92);
    });
    hang(g, sg, p[0], p[1], p[2], o.ux, o.uz, 0.03);
  }
}

/** The Victoria Jubilee Gateway (replica, 1993): two stone piers and an iron arch over the path from Young St. */
function jubileeGate(kit, ctx) {
  const [gx, gz] = JUBILEE_GATE;
  const dx = gx - YOUNG_ENTRANCE[0], dz = gz - YOUNG_ENTRANCE[1], dl = Math.hypot(dx, dz);
  const px = -dz / dl, pz = dx / dl;   // across the path
  const B = kit.B(gx, gz), g = kit.grp(gx, gz);
  const y = T(gx, gz), half = 2.3;
  const STONE = lin([0.66, 0.60, 0.52]), IRON = lin([0.08, 0.09, 0.09]);
  for (const s of [-1, 1]) {
    const x = gx + px * s * half, z = gz + pz * s * half;
    B.box(x, y - 0.4, z, 0.9, 3.4, 0.9, Math.atan2(pz, px), lin([0.56, 0.28, 0.21]));
    B.box(x, y + 3.0, z, 1.1, 0.25, 1.1, Math.atan2(pz, px), STONE);
    B.prism(x, y + 3.25, z, 0.3, 0.4, 8, STONE);
    ctx.solids.push({ x, z, r: 0.6, y0: y - 1, y1: y + 3.6 });
  }
  const N = 14;
  for (const yo of [0, 0.5]) {
    for (let i = 0; i < N; i++) {
      const t0 = -1 + 2 * i / N, t1 = -1 + 2 * (i + 1) / N;
      const h0 = 3.2 + yo + 1.3 * Math.sqrt(Math.max(0, 1 - t0 * t0)), h1 = 3.2 + yo + 1.3 * Math.sqrt(Math.max(0, 1 - t1 * t1));
      B.tube([gx + px * t0 * (half - 0.2), y + h0, gz + pz * t0 * (half - 0.2)], [gx + px * t1 * (half - 0.2), y + h1, gz + pz * t1 * (half - 0.2)], 0.05, 4, IRON);
    }
  }
  for (let i = -3; i <= 3; i++) {
    const t = i / 3.6, h = 3.2 + 1.3 * Math.sqrt(Math.max(0, 1 - t * t));
    B.tube([gx + px * t * (half - 0.2), y + 3.2, gz + pz * t * (half - 0.2)], [gx + px * t * (half - 0.2), y + h + 0.5, gz + pz * t * (half - 0.2)], 0.03, 4, IRON);
  }
  // an iron plate (opaque: each face hides the one behind it, mirrored)
  const sg = ctx.atlas.panel(2.6, 0.42, 60, (q, W, H) => {
    q.fillStyle = '#15171a'; q.fillRect(0, 0, W, H);
    q.fillStyle = '#c9a646'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `700 ${H * 0.72}px ${SERIF}`; q.fillText('WATERLOO PARK', W / 2, H * 0.55, W * 0.96);
  });
  for (const s of [1, -1]) hang(g, sg.clone(), gx, y + 3.95, gz, (dx / dl) * s, (dz / dl) * s, 0.02);
}

function splashPad(kit, ctx) {
  const [cx, cz] = centroid(SPLASH);
  const B = kit.B(cx, cz, true), Bs = kit.B(cx, cz);
  const y = T(cx, cz) + 0.05;
  const PAD = lin([0.42, 0.64, 0.78]), RING = lin([0.90, 0.88, 0.80]);
  const pts = polyArea(SPLASH) < 0 ? SPLASH.slice().reverse() : SPLASH;
  roof(B, pts, y, PAD);
  const COLS = [lin([0.95, 0.75, 0.10]), lin([0.90, 0.25, 0.20]), lin([0.20, 0.60, 0.85]), lin([0.35, 0.75, 0.30])];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = cx + Math.cos(a) * 6, z = cz + Math.sin(a) * 4.5;
    if (!inPoly(pts, x, z)) continue;
    Bs.prism(x, y, z, 0.12, 2.1 + (i % 2), 6, COLS[i % 4]);
    Bs.prism(x, y + 2.1 + (i % 2), z, 0.32, 0.18, 8, COLS[(i + 1) % 4]);
    ctx.solids.push({ x, z, r: 0.18, y0: y - 1, y1: y + 2.5 });
  }
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2;
    B.quad([cx + Math.cos(a0) * 2.2, y + 0.01, cz + Math.sin(a0) * 2.2], [cx + Math.cos(a1) * 2.2, y + 0.01, cz + Math.sin(a1) * 2.2],
      [cx + Math.cos(a1) * 2.6, y + 0.01, cz + Math.sin(a1) * 2.6], [cx + Math.cos(a0) * 2.6, y + 0.01, cz + Math.sin(a0) * 2.6], [0, 1, 0], U0, RING);
  }
}

// --- the playing fields (RIM Park, Waterloo Park) -----------------------------------------

/**
 * A pitch from its OSM polygon: a soccer field's lines and goals, or a ball
 * diamond (its home plate the fan's corner): infield clay, bases, mound,
 * backstop, the outfield fence. `lights` adds masts.
 */
function field(kit, ctx, pt, opts) {
  const pts = pt.p, o = obb(pts);
  if (!o) return;
  const D = kit.B(o.x, o.z, true), B = kit.B(o.x, o.z);
  const LINE = lin([0.95, 0.95, 0.92]), STEEL = lin([0.62, 0.64, 0.66]), TURF = lin([0.20, 0.50, 0.20]);
  const CLAY = lin([0.66, 0.42, 0.28]), FENCE = lin([0.20, 0.26, 0.22]), YEL = lin([0.95, 0.80, 0.15]);
  const Ty = (x, z) => T(x, z) + 0.06;
  const rot = Math.atan2(o.uz, o.ux);
  const mast = (x, z, face) => {
    const y = T(x, z);
    B.prism(x, y - 0.5, z, 0.28, 19.5, 6, STEEL);
    const fx = face[0], fz = face[1], fl = Math.hypot(fx, fz) || 1;
    B.box(x + fx / fl * 0.6, y + 18.4, z + fz / fl * 0.6, 3.2, 1.8, 0.5, Math.atan2(fz, fx) + Math.PI / 2, STEEL);
    B.box(x + fx / fl * 0.88, y + 18.55, z + fz / fl * 0.88, 2.9, 1.5, 0.06, Math.atan2(fz, fx) + Math.PI / 2, lin([0.98, 0.97, 0.90]));
    ctx.solids.push({ x, z, r: 0.35, y0: y - 1, y1: y + 19 });
  };
  if (!pt.d) {
    // soccer: inside the polygon by 2 m, the lines a pitch carries
    const hu = o.hu - 2, hv = o.hv - 2;
    if (hu < 10 || hv < 6) return;
    const R = (cu, cv, du, dv, col, lift = 0) => {
      const Q = (u, v) => { const x = o.x + o.ux * u - o.uz * v, z = o.z + o.uz * u + o.ux * v; return [x, Ty(x, z) + lift, z]; };
      const n = Math.max(1, Math.ceil(du / 12)), m = Math.max(1, Math.ceil(dv / 12));
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
        const u0 = cu - du + (2 * du * i) / n, u1 = cu - du + (2 * du * (i + 1)) / n;
        const v0 = cv - dv + (2 * dv * j) / m, v1 = cv - dv + (2 * dv * (j + 1)) / m;
        D.quad(Q(u0, v0), Q(u1, v0), Q(u1, v1), Q(u0, v1), [0, 1, 0], U0, col);
      }
    };
    if (opts.turf || /AF/.test(pt.n)) R(0, 0, o.hu - 0.5, o.hv - 0.5, TURF, -0.02);
    const W = 0.07;
    for (const s of [-1, 1]) { R(0, s * hv, hu, W, LINE); R(s * hu, 0, W, hv, LINE); }
    R(0, 0, W, hv, LINE);
    const box = (s, du, dv) => { R(s * (hu - du / 2), -dv, du / 2, W, LINE); R(s * (hu - du / 2), dv, du / 2, W, LINE); R(s * (hu - du), 0, W, dv, LINE); };
    const big = hu > 40;
    for (const s of [-1, 1]) { box(s, big ? 16.5 : 12, Math.min(hv - 1, big ? 20 : 14)); box(s, big ? 5.5 : 4, Math.min(hv - 2, big ? 9 : 6)); }
    // the centre circle
    const cr = Math.min(9.15, hv * 0.4);
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
      const q = (a, r) => { const u = Math.cos(a) * r, v = Math.sin(a) * r; const x = o.x + o.ux * u - o.uz * v, z = o.z + o.uz * u + o.ux * v; return [x, Ty(x, z), z]; };
      D.quad(q(a0, cr - W), q(a1, cr - W), q(a1, cr + W), q(a0, cr + W), [0, 1, 0], U0, LINE);
    }
    // goals
    const gw = big ? 3.66 : 2.5, gh = big ? 2.44 : 2;
    for (const s of [-1, 1]) {
      const gx = o.x + o.ux * s * hu, gz = o.z + o.uz * s * hu, y = T(gx, gz);
      for (const v of [-gw, gw]) {
        const x = gx - o.uz * v, z = gz + o.ux * v;
        B.box(x, y - 0.2, z, 0.12, gh + 0.2, 0.12, rot, LINE);
        ctx.solids.push({ x, z, r: 0.12, y0: y - 1, y1: y + gh });
      }
      B.box(gx, y + gh - 0.06, gz, 0.12, 0.12, gw * 2 + 0.12, rot, LINE);
      // the net's frame back to the ground
      for (const v of [-gw, gw]) {
        const x = gx - o.uz * v, z = gz + o.ux * v;
        B.tube([x, y + gh, z], [x + o.ux * s * 1.6, y, z + o.uz * s * 1.6], 0.03, 4, LINE);
      }
    }
    if (opts.lights) {
      for (const s of [-1, 1]) for (const u of (hu > 40 ? [-0.75, 0, 0.75] : [-0.6, 0.6])) {
        const v = s * (o.hv + 4), x = o.x + o.ux * u * hu - o.uz * v, z = o.z + o.uz * u * hu + o.ux * v;
        if (ctx.city.onRoad(x, z, 1)) continue;
        mast(x, z, [o.x - x, o.z - z]);
      }
    }
    return;
  }
  // a ball diamond: home is the fan's corner -- the vertex farthest from the
  // centroid among those with a near-right interior angle
  const [cx, cz] = centroid(pts);
  let home = null, hd = -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const ax = a[0] - b[0], az = a[1] - b[1], cxv = c[0] - b[0], czv = c[1] - b[1];
    const cos = (ax * cxv + az * czv) / ((Math.hypot(ax, az) * Math.hypot(cxv, czv)) || 1);
    const d = Math.hypot(b[0] - cx, b[1] - cz);
    if (cos > -0.35 && cos < 0.35 && d > hd) { hd = d; home = b; }
  }
  if (!home) return;
  const fx = cx - home[0], fz = cz - home[1], fl = Math.hypot(fx, fz);
  const dx = fx / fl, dz = fz / fl;            // toward second base / centre field
  const px = -dz, pz = dx;
  const W2 = (along, across) => [home[0] + dx * along + px * across, home[1] + dz * along + pz * across];
  const fieldR = Math.min(fl * 1.35, 95);
  const base = 27.43 * (fieldR < 70 ? 0.85 : 1);   // little league diamonds where the fan is small
  const r2 = base / Math.SQRT2;
  // the infield clay: a fan out to ~1.45 base paths, the grass diamond inside it
  const NF = 18, rc = base * 1.45;
  for (let i = 0; i < NF; i++) {
    const a0 = -Math.PI / 4 + (Math.PI / 2) * i / NF, a1 = -Math.PI / 4 + (Math.PI / 2) * (i + 1) / NF;
    const p0 = W2(0, 0), p1 = W2(Math.cos(a0) * rc, Math.sin(a0) * rc), p2 = W2(Math.cos(a1) * rc, Math.sin(a1) * rc);
    D.tri([p0[0], Ty(p0[0], p0[1]), p0[1]], [p1[0], Ty(p1[0], p1[1]), p1[1]], [p2[0], Ty(p2[0], p2[1]), p2[1]], [0, 1, 0], CLAY);
  }
  const GRASS = lin([0.30, 0.52, 0.24]);
  const ins = 1.6;
  const di = [W2(ins * Math.SQRT2, 0), W2(r2, -r2 + ins), W2(r2 * 2 - ins * Math.SQRT2, 0), W2(r2, r2 - ins)];
  D.quad(...di.map((q) => [q[0], Ty(q[0], q[1]) + 0.01, q[1]]), [0, 1, 0], U0, GRASS);
  // bases, mound, plate, foul lines
  for (const [al, ac] of [[r2, -r2], [r2 * 2, 0], [r2, r2]]) {
    const q = W2(al, ac);
    D.quad([q[0] - 0.25, Ty(q[0], q[1]) + 0.03, q[1] - 0.25], [q[0] + 0.25, Ty(q[0], q[1]) + 0.03, q[1] - 0.25], [q[0] + 0.25, Ty(q[0], q[1]) + 0.03, q[1] + 0.25], [q[0] - 0.25, Ty(q[0], q[1]) + 0.03, q[1] + 0.25], [0, 1, 0], U0, LINE);
  }
  const mo = W2(r2 * 1.0, 0);
  D.quad([mo[0] - 1.6, Ty(mo[0], mo[1]) + 0.02, mo[1] - 1.6], [mo[0] + 1.6, Ty(mo[0], mo[1]) + 0.02, mo[1] - 1.6], [mo[0] + 1.6, Ty(mo[0], mo[1]) + 0.02, mo[1] + 1.6], [mo[0] - 1.6, Ty(mo[0], mo[1]) + 0.02, mo[1] + 1.6], [0, 1, 0], U0, CLAY);
  for (const s of [-1, 1]) {
    const e = W2(Math.cos(s * Math.PI / 4) * fieldR * 0.98, Math.sin(s * Math.PI / 4) * fieldR * 0.98);
    const n = Math.ceil(fieldR / 10);
    for (let i = 0; i < n; i++) {
      const a = [home[0] + (e[0] - home[0]) * i / n, home[1] + (e[1] - home[1]) * i / n], b = [home[0] + (e[0] - home[0]) * (i + 1) / n, home[1] + (e[1] - home[1]) * (i + 1) / n];
      const nx = (s * px - dx * 0) * 0.07, nz = (s * pz) * 0.07;
      const ox = -(e[1] - home[1]) / fieldR * 0.07, oz = (e[0] - home[0]) / fieldR * 0.07;
      void nx; void nz;
      D.quad([a[0] - ox, Ty(a[0], a[1]) + 0.025, a[1] - oz], [b[0] - ox, Ty(b[0], b[1]) + 0.025, b[1] - oz], [b[0] + ox, Ty(b[0], b[1]) + 0.025, b[1] + oz], [a[0] + ox, Ty(a[0], a[1]) + 0.025, a[1] + oz], [0, 1, 0], U0, LINE);
    }
    // foul pole
    const fp = W2(Math.cos(s * Math.PI / 4) * fieldR, Math.sin(s * Math.PI / 4) * fieldR);
    B.prism(fp[0], T(fp[0], fp[1]) - 0.2, fp[1], 0.1, 9, 6, YEL);
  }
  // the backstop: posts, rails and wires on an arc behind home
  const bs = 6.5;
  let prev = null;
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * 0.6 + (Math.PI * 0.8) * i / 8 + Math.PI;
    const q = W2(Math.cos(a + Math.PI) * -bs, Math.sin(a + Math.PI) * -bs);
    const y = T(q[0], q[1]);
    B.prism(q[0], y - 0.2, q[1], 0.06, 4.5, 5, FENCE);
    if (prev) {
      for (const yy of [0.2, 1.2, 2.2, 3.2, 4.2]) B.tube([prev[0], prev[2] + yy, prev[1]], [q[0], y + yy, q[1]], 0.03, 3, FENCE);
      ctx.solids.push({ x: (prev[0] + q[0]) / 2, z: (prev[1] + q[1]) / 2, hw: Math.hypot(q[0] - prev[0], q[1] - prev[1]) / 2, hd: 0.1, rot: Math.atan2(q[1] - prev[1], q[0] - prev[0]), y0: y - 1, y1: y + 4.3 });
    }
    prev = [q[0], q[1], y];
  }
  // the outfield fence: posts and a yellow-capped rail at fieldR
  prev = null;
  for (let i = 0; i <= 16; i++) {
    const a = -Math.PI / 4 + (Math.PI / 2) * i / 16;
    const q = W2(Math.cos(a) * fieldR, Math.sin(a) * fieldR);
    const y = T(q[0], q[1]);
    B.prism(q[0], y - 0.2, q[1], 0.05, 1.5, 5, FENCE);
    if (prev) {
      B.tube([prev[0], prev[2] + 1.3, prev[1]], [q[0], y + 1.3, q[1]], 0.07, 4, YEL);
      B.tube([prev[0], prev[2] + 0.6, prev[1]], [q[0], y + 0.6, q[1]], 0.03, 3, FENCE);
    }
    prev = [q[0], q[1], y];
  }
  if (opts.lights) {
    for (const [al, ac] of [[-4, -14], [-4, 14], [fieldR * 0.55, -fieldR * 0.75], [fieldR * 0.55, fieldR * 0.75]]) {
      const q = W2(al, ac);
      if (ctx.city.onRoad(q[0], q[1], 1)) continue;
      mast(q[0], q[1], [mo[0] - q[0], mo[1] - q[1]]);
    }
  }
}

// --- RIM Park --------------------------------------------------------------------------

/** The Elam Martin farmstead (house 1856, bank barn, a c.1920 poured-concrete silo), inside RIM Park by Woolwich St. */
function martinFarm(kit, ctx) {
  {
    const o = obb(P.martinHouse.p);
    const B = kit.B(o.x, o.z);
    const y = T(o.x, o.z) - 0.4;
    const YB = lin([0.86, 0.76, 0.52]), R = lin([0.33, 0.33, 0.35]);
    const Pf = gabled(B, o, y, y + 6.2, y + 9.2, YB, R, { overhang: 0.3 });
    const vx = -o.uz, vz = o.ux;
    for (const s of [-1, 1]) for (let u = -o.hu + 1.4; u < o.hu - 0.8; u += 2.4) for (const yy of [1.2, 4.0]) {
      const p = Pf(u, s * (o.hv + 0.03), y + yy);
      B.quad([p[0] - o.ux * 0.5, p[1], p[2] - o.uz * 0.5], [p[0] + o.ux * 0.5, p[1], p[2] + o.uz * 0.5], [p[0] + o.ux * 0.5, p[1] + 1.5, p[2] + o.uz * 0.5], [p[0] - o.ux * 0.5, p[1] + 1.5, p[2] - o.uz * 0.5], [vx * s, 0, vz * s], U0, lin([0.12, 0.13, 0.14]));
      B.quad([p[0] - o.ux * 0.62, p[1] - 0.12, p[2] - o.uz * 0.62], [p[0] + o.ux * 0.62, p[1] - 0.12, p[2] + o.uz * 0.62], [p[0] + o.ux * 0.62, p[1] - 0.01, p[2] + o.uz * 0.62], [p[0] - o.ux * 0.62, p[1] - 0.01, p[2] - o.uz * 0.62], [vx * s, 0, vz * s], U0, lin([0.92, 0.9, 0.86]));
    }
    // the red-brick centre chimney
    B.box(o.x, y + 8.0, o.z, 0.8, 2.2, 0.8, Math.atan2(o.uz, o.ux), lin([0.55, 0.25, 0.19]));
    ctx.solids.push({ x: o.x, z: o.z, hw: o.hu, hd: o.hv, rot: Math.atan2(o.uz, o.ux), y0: y - 1, y1: y + 9.2 });
  }
  {
    const o = obb(P.martinBarn.p);
    const B = kit.B(o.x, o.z), g = kit.grp(o.x, o.z);
    let lo = Infinity;
    for (const q of P.martinBarn.p) lo = Math.min(lo, T(q[0], q[1]));
    const BOARD = lin([0.52, 0.44, 0.35]), BAT = lin([0.40, 0.33, 0.26]), STONE = lin([0.58, 0.55, 0.50]), METAL = lin([0.58, 0.60, 0.62]);
    const rot = Math.atan2(o.uz, o.ux), vx = -o.uz, vz = o.ux;
    // the stone basement of a bank barn, then the boards to the eave, a metal gable roof
    B.box(o.x, lo - 1, o.z, o.hu * 2, 3.6, o.hv * 2, rot, STONE);
    const Pf = gabled(B, o, lo + 2.6, lo + 7.4, lo + 12.2, BOARD, METAL, { overhang: 0.6 });
    for (const s of [-1, 1]) {
      for (let u = -o.hu + 0.3; u < o.hu; u += 0.7) B.quad(Pf(u - 0.04, s * (o.hv + 0.02), lo + 2.6), Pf(u + 0.04, s * (o.hv + 0.02), lo + 2.6), Pf(u + 0.04, s * (o.hv + 0.02), lo + 7.4), Pf(u - 0.04, s * (o.hv + 0.02), lo + 7.4), [vx * s, 0, vz * s], U0, BAT);
      // the diamond vents under the eaves
      for (let u = -o.hu + 3; u < o.hu - 2; u += 4) {
        const c = Pf(u, s * (o.hv + 0.03), lo + 6.4);
        B.quad([c[0] - o.ux * 0.35, c[1], c[2] - o.uz * 0.35], [c[0], c[1] - 0.35, c[2]], [c[0] + o.ux * 0.35, c[1], c[2] + o.uz * 0.35], [c[0], c[1] + 0.35, c[2]], [vx * s, 0, vz * s], U0, lin([0.1, 0.1, 0.1]));
      }
    }
    // the silo, attached at the barn's end by a boarded shaft
    const sx = o.x + o.ux * (o.hu + 3.2), sz = o.z + o.uz * (o.hu + 3.2), sy = T(sx, sz);
    const CON = lin([0.74, 0.73, 0.70]);
    B.prism(sx, sy - 0.5, sz, 2.7, 21, 14, CON);
    for (let k = 1; k < 10; k++) B.prism(sx, sy + k * 2.0, sz, 2.76, 0.1, 14, shade(CON, 0.8));
    // shed roof sloping west
    const top = sy + 20.5;
    const pts = [];
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; pts.push([sx + Math.cos(a) * 2.9, sz + Math.sin(a) * 2.9]); }
    const yRoof = (x) => top + 0.9 + (x - sx) * 0.25;
    for (let i = 0; i < 14; i++) {
      const a = pts[i], b = pts[(i + 1) % 14];
      B.tri([sx, yRoof(sx), sz], [a[0], yRoof(a[0]), a[1]], [b[0], yRoof(b[0]), b[1]], [-0.24, 0.97, 0], METAL);
      B.quad([a[0], top - 0.4, a[1]], [b[0], top - 0.4, b[1]], [b[0], yRoof(b[0]), b[1]], [a[0], yRoof(a[0]), a[1]], [Math.cos((i + 0.5) / 14 * Math.PI * 2), 0, Math.sin((i + 0.5) / 14 * Math.PI * 2)], U0, shade(CON, 0.9));
    }
    B.box(o.x + o.ux * (o.hu + 0.8), lo + 2, o.z + o.uz * (o.hu + 0.8), 1.8, top - lo - 3, 1.6, rot, BOARD);
    ctx.solids.push({ x: o.x, z: o.z, hw: o.hu, hd: o.hv, rot, y0: lo - 1, y1: lo + 12.2 });
    ctx.solids.push({ x: sx, z: sz, r: 2.7, y0: sy - 1, y1: top });
    // its board
    const bx = o.x + vx * (o.hv + 6), bz = o.z + vz * (o.hv + 6), by = T(bx, bz);
    for (const d of [-1, 1]) B.box(bx + o.ux * d, by - 0.3, bz + o.uz * d, 0.12, 2.0, 0.12, rot, BAT);
    const sg = ctx.atlas.panel(2.4, 0.9, 50, (q, W, H) => {
      q.fillStyle = '#5a2a1a'; q.fillRect(0, 0, W, H);
      q.fillStyle = '#f2e8cf'; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `700 ${H * 0.28}px ${SERIF}`; q.fillText('ELAM MARTIN', W / 2, H * 0.3, W * 0.92);
      q.fillText('FARMSTEAD', W / 2, H * 0.6, W * 0.92);
      q.font = `600 ${H * 0.15}px ${SERIF}`; q.fillText('c. 1820 · CITY OF WATERLOO', W / 2, H * 0.86, W * 0.92);
    });
    hang(g, sg, bx, by + 1.3, bz, vx, vz, 0.07);
    hang(g, sg.clone(), bx, by + 1.3, bz, -vx, -vz, 0.07);
  }
}

/** RIM Park's sign at the University Ave entrance: a stone base and the name. */
function rimSign(kit, ctx) {
  const city = ctx.city;
  const at = [-2222, -7355];
  const rd = street(city, at[0], at[1], 120, /University Avenue/);
  if (!rd) return;
  const nx = (at[0] - rd.qx) / rd.d, nz = (at[1] - rd.qz) / rd.d;
  const x = rd.qx + nx * (rd.hw + 7), z = rd.qz + nz * (rd.hw + 7);
  if (city.onRoad(x, z, 1)) return;
  const y = T(x, z), yaw = Math.atan2(rd.ex, rd.ez);
  const B = kit.B(x, z), g = kit.grp(x, z);
  B.box(x, y - 0.5, z, 7.5, 1.6, 1.0, -yaw + Math.PI / 2, lin([0.56, 0.52, 0.46]));
  B.box(x, y + 1.1, z, 7.2, 1.9, 0.5, -yaw + Math.PI / 2, lin([0.10, 0.22, 0.42]));
  const sg = ctx.atlas.panel(7.0, 1.7, 40, (q, W, H) => {
    q.fillStyle = '#0b3e8a'; q.fillRect(0, 0, W, H);
    q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `800 ${H * 0.46}px ${SANS}`; q.fillText('RIM PARK', W / 2, H * 0.38, W * 0.92);
    q.font = `600 ${H * 0.17}px ${SANS}`; q.fillText('MANULIFE FINANCIAL SPORTSPLEX & HEALTHY LIVING CENTRE', W / 2, H * 0.78, W * 0.94);
  });
  hang(g, sg, x, y + 2.05, z, -nx, -nz, 0.27);
  hang(g, sg.clone(), x, y + 2.05, z, nx, nz, 0.27);
  ctx.solids.push({ x, z, hw: 3.8, hd: 0.55, rot: -yaw + Math.PI / 2, y0: y - 1, y1: y + 3 });
}

// --- Conestoga Mall ----------------------------------------------------------------------

// The anchors (2026: the Bay closed in June 2025, Urban Behavior has its
// space; Target's old box is Indigo, Sport Chek and Miniso) at their OSM points
const MALL_ANCHORS = [
  ['ZEHRS', '#ffffff', '#d2232a', -4057, -4993, 9, '800', SANS],
  ['GALAXY CINEMAS', null, null, -4110, -4930, 0],     // on the cinema's own block (below)
  ['WINNERS', '#000000', '#ffffff', -4130, -5139, 8, '800', SANS],
  ['SPORT CHEK', '#e31837', '#ffffff', -4249, -5305, 9, '800 italic', SANS],
  ['indigo', '#ffffff', '#1a2b4c', -4190, -5244, 6.5, '700', SERIF],
  ['OLD NAVY', '#00205b', '#ffffff', -4285, -5136, 7, '800', SANS],
  ['H&M', '#ffffff', '#e50010', -4248, -5022, 4, '700', SANS],
  ['Shoppers Drug Mart', '#d71920', '#ffffff', -4108, -5080, 9, 'italic 700', SERIF],
  ['URBAN BEHAVIOR', '#111111', '#ffffff', -4240, -4938, 10, '800', SANS],
  ['The Pickle Barrel', '#2f5d2a', '#f4e7c3', -4291, -5086, 7, '700', SERIF],
];
// OSM's entrance nodes; the first is the main entrance (ref 1) on the west, facing the ION
const MALL_DOORS = [[-4297, -5125, 1], [-4126, -4911, 1], [-4131, -5154], [-4171, -5277], [-4275, -5211], [-4077, -5057], [-4171, -4954], [-4300, -4941], [-4269, -5313], [-4032, -5008]];

function mall(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  let pts = simplify(P.mall.p, 0.9);
  if (polyArea(pts) < 0) pts = pts.slice().reverse();
  const [cx, cz] = centroid(pts);
  const B = kit.B(cx, cz), g = kit.grp(cx, cz);
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const base = T(cx, cz), yTop = base + 9;
  const WALL = lin([0.80, 0.76, 0.68]), BAND = lin([0.28, 0.33, 0.40]), BASEB = lin([0.55, 0.51, 0.46]), JOINT = lin([0.66, 0.62, 0.55]);
  const E = edges(pts);
  for (const e of E) {
    const N = [e.nx, 0, e.nz];
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    B.quad(e.at(0, lo - 1.2), e.at(e.L, lo - 1.2), e.at(e.L, yTop + 0.8), e.at(0, yTop + 0.8), N, U0, WALL);
    B.quad(e.at(0, lo - 1.2, 0.05), e.at(e.L, lo - 1.2, 0.05), e.at(e.L, gy + 0.9, 0.05), e.at(0, gy + 0.9, 0.05), N, U0, BASEB);
    B.quad(e.at(0, yTop - 1.4, 0.2), e.at(e.L, yTop - 1.4, 0.2), e.at(e.L, yTop + 0.8, 0.2), e.at(0, yTop + 0.8, 0.2), N, U0, BAND);
    B.quad(e.at(0, yTop + 0.8, 0.2), e.at(e.L, yTop + 0.8, 0.2), e.at(e.L, yTop + 0.8, 0), e.at(0, yTop + 0.8, 0), [0, 1, 0], U0, BAND);
    ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: lo - 1.2, y1: yTop + 0.8 });
    for (let t = 7; t < e.L - 1; t += 7.5) B.quad(e.at(t - 0.06, gy + 0.9, 0.04), e.at(t + 0.06, gy + 0.9, 0.04), e.at(t + 0.06, yTop - 1.4, 0.04), e.at(t - 0.06, yTop - 1.4, 0.04), N, U0, JOINT);
  }
  roof(B, pts, yTop, lin([0.62, 0.62, 0.60]));
  // the concourse skylights: a row of glazed pyramids down the long axis
  const o = obb(pts);
  const SKY = lin([0.40, 0.52, 0.60]);
  for (let u = -o.hu + 15; u < o.hu - 15; u += 14) {
    const x = o.x + o.ux * u, z = o.z + o.uz * u;
    if (!inPoly(pts, x, z)) continue;
    const s = 3.2, h = 2.4, rot = Math.atan2(o.uz, o.ux), c = Math.cos(rot), sn = Math.sin(rot);
    const C = [[-s, -s], [s, -s], [s, s], [-s, s]].map(([a, b]) => [x + a * c - b * sn, yTop, z + a * sn + b * c]);
    for (let i = 0; i < 4; i++) {
      const a = C[i], b = C[(i + 1) % 4], mx = (a[0] + b[0]) / 2 - x, mz = (a[2] + b[2]) / 2 - z, ml = Math.hypot(mx, mz);
      B.tri(a, b, [x, yTop + h, z], [mx / ml * 0.7, 0.7, mz / ml * 0.7], SKY);
    }
  }
  // rooftop units
  for (let i = 0; i < 14; i++) {
    const u = (hash2(i, 51) - 0.5) * o.hu * 1.6, v = (hash2(i, 52) - 0.5) * o.hv * 1.4;
    const x = o.x + o.ux * u - o.uz * v, z = o.z + o.uz * u + o.ux * v;
    if (!inPoly(pts, x, z)) continue;
    B.box(x, yTop, z, 3 + hash2(i, 53) * 2, 1.4, 2.2, Math.atan2(o.uz, o.ux), lin([0.70, 0.71, 0.72]));
  }
  // the entrances: a glass vestibule, a canopy, the mall's name over the main ones
  const nearestEdge = (px, pz, minL = 6) => {
    let best = null, bd = Infinity;
    for (const e of E) {
      if (e.L < minL) continue;
      const t = Math.max(3, Math.min(e.L - 3, (px - e.a[0]) * e.ux + (pz - e.a[1]) * e.uz));
      const q = e.at(t, 0), d = Math.hypot(q[0] - px, q[2] - pz);
      if (d < bd) { bd = d; best = { e, t, d }; }
    }
    return best;
  };
  const GL = lin([0.20, 0.27, 0.33]), FR = lin([0.75, 0.77, 0.80]), CAN = lin([0.88, 0.88, 0.86]);
  const nameSign = L.panel(9, 1.6, 40, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `800 ${H * 0.7}px ${SANS}`; q.fillText('CONESTOGA', W / 2, H * 0.55, W * 0.96);
  });
  for (const [px, pz, main] of MALL_DOORS) {
    const f = nearestEdge(px, pz);
    if (!f || f.d > 25) continue;
    const { e, t } = f;
    const gy = T(e.mx + e.nx * 3, e.mz + e.nz * 3);
    const w = main ? 12 : 7, d = main ? 4.5 : 3.2, h = main ? 6 : 4.4;
    const N = [e.nx, 0, e.nz];
    // vestibule: glass front and sides, a frame
    B.quad(e.at(t - w / 2, gy - 0.2, d), e.at(t + w / 2, gy - 0.2, d), e.at(t + w / 2, gy + h, d), e.at(t - w / 2, gy + h, d), N, U0, GL);
    for (const s of [-1, 1]) {
      B.quad(e.at(t + s * w / 2, gy - 0.2, 0), e.at(t + s * w / 2, gy - 0.2, d), e.at(t + s * w / 2, gy + h, d), e.at(t + s * w / 2, gy + h, 0), [e.ux * s, 0, e.uz * s], U0, GL);
    }
    for (let k = 0; k <= 4; k++) {
      const tt = t - w / 2 + (w * k) / 4;
      B.quad(e.at(tt - 0.08, gy - 0.2, d + 0.03), e.at(tt + 0.08, gy - 0.2, d + 0.03), e.at(tt + 0.08, gy + h, d + 0.03), e.at(tt - 0.08, gy + h, d + 0.03), N, U0, FR);
    }
    B.quad(e.at(t - w / 2, gy + 2.6, d + 0.03), e.at(t + w / 2, gy + 2.6, d + 0.03), e.at(t + w / 2, gy + 2.75, d + 0.03), e.at(t - w / 2, gy + 2.75, d + 0.03), N, U0, FR);
    // the canopy
    const cw = w + 4, cd = d + 3.5, cy = gy + h;
    B.quad(e.at(t - cw / 2, cy + 0.6, 0), e.at(t + cw / 2, cy + 0.6, 0), e.at(t + cw / 2, cy + 0.6, cd), e.at(t - cw / 2, cy + 0.6, cd), [0, 1, 0], U0, CAN);
    B.quad(e.at(t - cw / 2, cy, 0), e.at(t + cw / 2, cy, 0), e.at(t + cw / 2, cy, cd), e.at(t - cw / 2, cy, cd), [0, -1, 0], U0, shade(CAN, 0.7));
    B.quad(e.at(t - cw / 2, cy, cd), e.at(t + cw / 2, cy, cd), e.at(t + cw / 2, cy + 0.6, cd), e.at(t - cw / 2, cy + 0.6, cd), N, U0, BAND);
    for (const s of [-1, 1]) {
      const p = e.at(t + s * (cw / 2 - 0.4), gy - 0.2, cd - 0.4);
      B.prism(p[0], p[1], p[2], 0.18, cy - gy + 0.3, 8, FR);
      ctx.solids.push({ x: p[0], z: p[2], r: 0.25, y0: gy - 1, y1: cy });
    }
    ctx.solids.push({ x: (e.at(t, 0, d / 2))[0], z: (e.at(t, 0, d / 2))[2], hw: w / 2, hd: d / 2, rot: Math.atan2(e.uz, e.ux), y0: gy - 1, y1: gy + h });
    if (main) {
      // a tower over the main door carrying the name
      const tp = e.at(t, gy - 0.2, 1.5);
      B.box(tp[0], tp[1], tp[2], w * 0.8, 14.5, 3, Math.atan2(e.uz, e.ux), BAND);
      const sp = e.at(t, gy + 11.5, 3.05);
      hang(g, nameSign.clone(), sp[0], sp[1], sp[2], e.nx, e.nz, 0.02);
    }
  }
  // the anchors' signs high on the wall nearest each
  for (const [text, bg, fg, ax, az, w, wt, font] of MALL_ANCHORS) {
    if (!w) continue;
    const f = nearestEdge(ax, az, w + 6);
    if (!f) continue;
    const { e } = f;
    if (e.L < w + 1) continue;
    const t = Math.max(w / 2 + 0.5, Math.min(e.L - w / 2 - 0.5, f.t));
    const h = text.length > 12 ? w * 0.16 : w * 0.22;
    // the anchor's own raised parapet, the sign on it
    const pw = Math.min(e.L, w + 5), gy = T(e.mx + e.nx * 3, e.mz + e.nz * 3);
    const N = [e.nx, 0, e.nz], PAR = lin([0.88, 0.86, 0.82]), py1 = yTop + Math.max(3.2, h + 1.2);
    B.quad(e.at(t - pw / 2, gy + 3.2, 0.5), e.at(t + pw / 2, gy + 3.2, 0.5), e.at(t + pw / 2, py1, 0.5), e.at(t - pw / 2, py1, 0.5), N, U0, PAR);
    for (const s of [-1, 1]) B.quad(e.at(t + s * pw / 2, gy + 3.2, 0), e.at(t + s * pw / 2, gy + 3.2, 0.5), e.at(t + s * pw / 2, py1, 0.5), e.at(t + s * pw / 2, py1, 0), [e.ux * s, 0, e.uz * s], U0, shade(PAR, 0.8));
    B.quad(e.at(t - pw / 2, py1, 0.5), e.at(t + pw / 2, py1, 0.5), e.at(t + pw / 2, py1, -1.5), e.at(t - pw / 2, py1, -1.5), [0, 1, 0], U0, BAND);
    B.quad(e.at(t - pw / 2, py1, -1.5), e.at(t + pw / 2, py1, -1.5), e.at(t + pw / 2, yTop, -1.5), e.at(t - pw / 2, yTop, -1.5), [-e.nx, 0, -e.nz], U0, PAR);
    B.quad(e.at(t - pw / 2, gy + 3.2, 0.5), e.at(t + pw / 2, gy + 3.2, 0.5), e.at(t + pw / 2, gy + 3.2, 0), e.at(t - pw / 2, gy + 3.2, 0), [0, -1, 0], U0, shade(PAR, 0.5));
    const m = L.panel(w, h, 36, (q, W, H) => {
      q.fillStyle = bg; q.fillRect(0, 0, W, H);
      q.fillStyle = fg; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `${wt} ${H * 0.68}px ${font}`; q.fillText(text, W / 2, H * 0.56, W * 0.92);
    });
    const p = e.at(t, (yTop + py1) / 2 - 0.2, 0.52);
    hang(g, m, p[0], p[1], p[2], e.nx, e.nz, 0.03);
    (STATS.mallSigns = STATS.mallSigns || []).push([text, Math.round(p[0]), Math.round(p[2]), +e.nx.toFixed(2), +e.nz.toFixed(2), Math.round(e.L)]);
  }
  // Galaxy Cinemas: its own block, taller, dark (OSM: grey, blue, black)
  {
    let cp = simplify(P.cinema.p, 0.6);
    if (polyArea(cp) < 0) cp = cp.slice().reverse();
    const [ccx, ccz] = centroid(cp);
    const CB = kit.B(ccx, ccz), cg = kit.grp(ccx, ccz);
    let clo = Infinity;
    for (const q of cp) clo = Math.min(clo, T(q[0], q[1]));
    const cTop = T(ccx, ccz) + 13.5;
    const DK = lin([0.18, 0.22, 0.32]), BK = lin([0.08, 0.08, 0.09]), GR = lin([0.55, 0.57, 0.60]);
    let bestE = null, bs = -1;
    for (const e of edges(cp)) {
      const N = [e.nx, 0, e.nz];
      CB.quad(e.at(0, clo - 1.2), e.at(e.L, clo - 1.2), e.at(e.L, cTop), e.at(0, cTop), N, U0, [BK, BK, DK, DK]);
      CB.quad(e.at(0, cTop - 1.2, 0.15), e.at(e.L, cTop - 1.2, 0.15), e.at(e.L, cTop + 0.3, 0.15), e.at(0, cTop + 0.3, 0.15), N, U0, GR);
      ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: clo - 1.2, y1: cTop });
      // the sign goes on the long face that has open lot in front
      if (e.L < 10 || inPoly(pts, e.mx + e.nx * 3, e.mz + e.nz * 3)) continue;
      const sc = e.L + (G.lotAt(e.mx + e.nx * 15, e.mz + e.nz * 15) >= 0 ? 40 : 0);
      if (sc > bs) { bs = sc; bestE = e; }
    }
    roof(CB, cp, cTop + 0.3, lin([0.40, 0.40, 0.42]));
    STATS.cinema = bestE ? [Math.round(bestE.mx), Math.round(bestE.mz), +bestE.nx.toFixed(2), +bestE.nz.toFixed(2), Math.round(bestE.L)] : null;
    if (bestE) {
      const e = bestE, w = Math.min(14, e.L - 2), h = w * 0.2;
      const m = L.panel(w, h, 36, (q, W, H) => {
        q.fillStyle = '#0b1f4a'; q.fillRect(0, 0, W, H);
        q.fillStyle = '#ffd23a';
        const r = H * 0.28, sx = H * 0.5, sy = H / 2;
        q.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; q.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
        q.fill();
        q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
        q.font = `800 ${H * 0.5}px ${SANS}`; q.fillText('GALAXY', W * 0.5 + H * 0.3, H * 0.4, W * 0.8);
        q.font = `700 ${H * 0.22}px ${SANS}`; q.fillText('C I N E M A S', W * 0.5 + H * 0.3, H * 0.78, W * 0.8);
      });
      const p = e.at(e.L / 2, cTop - 1.8 - h / 2, 0.06);
      hang(cg, m, p[0], p[1], p[2], e.nx, e.nz, 0.03);
      // the lobby's glass front and a lit marquee band over it
      const gy = T(e.mx + e.nx * 3, e.mz + e.nz * 3), gw = Math.min(18, e.L - 4), N = [e.nx, 0, e.nz];
      CB.quad(e.at(e.L / 2 - gw / 2, gy - 0.2, 0.05), e.at(e.L / 2 + gw / 2, gy - 0.2, 0.05), e.at(e.L / 2 + gw / 2, gy + 4.2, 0.05), e.at(e.L / 2 - gw / 2, gy + 4.2, 0.05), N, U0, lin([0.22, 0.30, 0.40]));
      for (let k = 0; k <= 6; k++) {
        const t = e.L / 2 - gw / 2 + gw * k / 6;
        CB.quad(e.at(t - 0.07, gy - 0.2, 0.08), e.at(t + 0.07, gy - 0.2, 0.08), e.at(t + 0.07, gy + 4.2, 0.08), e.at(t - 0.07, gy + 4.2, 0.08), N, U0, GR);
      }
      CB.quad(e.at(e.L / 2 - gw / 2 - 1, gy + 4.4, 2.5), e.at(e.L / 2 + gw / 2 + 1, gy + 4.4, 2.5), e.at(e.L / 2 + gw / 2 + 1, gy + 5.4, 2.5), e.at(e.L / 2 - gw / 2 - 1, gy + 5.4, 2.5), N, U0, lin([0.95, 0.80, 0.25]));
      CB.quad(e.at(e.L / 2 - gw / 2 - 1, gy + 4.4, 0), e.at(e.L / 2 + gw / 2 + 1, gy + 4.4, 0), e.at(e.L / 2 + gw / 2 + 1, gy + 4.4, 2.5), e.at(e.L / 2 - gw / 2 - 1, gy + 4.4, 2.5), [0, -1, 0], U0, lin([0.9, 0.88, 0.8]));
      CB.quad(e.at(e.L / 2 - gw / 2 - 1, gy + 5.4, 0), e.at(e.L / 2 + gw / 2 + 1, gy + 5.4, 0), e.at(e.L / 2 + gw / 2 + 1, gy + 5.4, 2.5), e.at(e.L / 2 - gw / 2 - 1, gy + 5.4, 2.5), [0, 1, 0], U0, BK);
    }
  }
  // the pylon on King St, by the mall's main road in
  {
    const f = nearestEdge(MALL_DOORS[0][0], MALL_DOORS[0][1]);
    const k = street(city, MALL_DOORS[0][0], MALL_DOORS[0][1], 320, /^King Street/);
    if (k && f) {
      const nx = (MALL_DOORS[0][0] - k.qx) / k.d, nz = (MALL_DOORS[0][1] - k.qz) / k.d;
      let x = k.qx + nx * (k.hw + 6), z = k.qz + nz * (k.hw + 6);
      for (let i = 0; i < 12 && (city.onRoad(x, z, 3) || boxAt(city, x, z, 2)); i++) { x += k.ex * 8; z += k.ez * 8; }
      if (!city.onRoad(x, z, 2)) {
        const y = T(x, z), yaw = Math.atan2(k.ex, k.ez);
        const PB = kit.B(x, z), pg = kit.grp(x, z);
        PB.box(x, y - 0.5, z, 3.8, 11.5, 0.9, -yaw + Math.PI / 2, lin([0.28, 0.33, 0.40]));
        PB.box(x, y - 0.5, z, 4.4, 1.4, 1.3, -yaw + Math.PI / 2, lin([0.55, 0.51, 0.46]));
        const top = L.panel(3.5, 1.4, 50, (q, W, H) => {
          q.fillStyle = '#1d2b3e'; q.fillRect(0, 0, W, H);
          q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
          q.font = `800 ${H * 0.36}px ${SANS}`; q.fillText('CONESTOGA', W / 2, H * 0.42, W * 0.94);
          q.font = `600 ${H * 0.16}px ${SANS}`; q.fillText('550 KING ST N', W / 2, H * 0.78, W * 0.94);
        });
        const ten = L.panel(3.5, 5.6, 40, (q, W, H) => {
          const rows = [['ZEHRS', '#ffffff', '#d2232a'], ['GALAXY CINEMAS', '#0b1f4a', '#ffffff'], ['WINNERS', '#000000', '#ffffff'],
            ['SPORT CHEK', '#e31837', '#ffffff'], ['indigo', '#ffffff', '#1a2b4c'], ['OLD NAVY', '#00205b', '#ffffff'], ['H&M', '#ffffff', '#e50010']];
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
    }
  }
}

// --- the extra --------------------------------------------------------------------------

const STATS = {};
/** landmarks.js extra: all four places. */
export function buildPlaces(ctx) {
  if (!P) return;
  const t0 = performance.now();
  const PA = new PlaceAtlas();
  ctx = { ...ctx, atlas: PA };
  const kit = new Kit();
  const waterAt = (x, z) => { const w = G.waterLevel(x, z); return w > 0 ? w : null; };
  const run = (name, fn) => {
    const s0 = ctx.solids.length, tr0 = kit.tris;
    try { fn(); } catch (e) { console.warn('kwplaces ' + name + ': ' + e.message); }
    kit.flush(ctx);
    STATS[name] = { tris: kit.tris - tr0, solids: ctx.solids.length - s0 };
  };
  run('uptown', () => {
    P.king.forEach((r, i) => meshKing(kit, ctx, r, i));
    STATS.lamps = kingLamps(kit, ctx);
    publicSquare(kit, ctx);
    townSquare(kit, ctx);
    seagram(kit, ctx);
  });
  // open ground the tree scatter keeps off (landmarks.js clearAt -> city.clearCircles)
  const keep = (pts, pad) => {
    const o = obb(pts);
    if (!o) return;
    const r = Math.min(o.hu, o.hv) + pad, n = Math.max(1, Math.ceil(o.hu / Math.max(4, o.hv)));
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : -o.hu + o.hv + (2 * (o.hu - o.hv) * i) / (n - 1);
      ctx.clearAt.push([o.x + o.ux * u, o.z + o.uz * u, r]);
    }
  };
  if (ctx.clearAt) {
    for (const k of ['mill', 'school', 'potters', 'parkinn', 'gazeboE', 'gazeboT', 'gazeboW']) keep(P[k].p, 5);
    keep(P.ebybarn.p, 30);
    keep(P.martinHouse.p, 6); keep(P.martinBarn.p, 10);
    keep(SPLASH, 6);
    ctx.clearAt.push([JUBILEE_GATE[0], JUBILEE_GATE[1], 6]);
    for (const pt of [...P.pitches.rim, ...P.pitches.wpark]) keep(pt.p, pt.d ? 0 : 2);
  }
  run('wpark', () => {
    bridges(kit, ctx, waterAt);
    gristMill(kit, ctx);
    logSchool(kit, ctx);
    ebyFarmstead(kit, ctx);
    for (const k of ['gazeboE', 'gazeboT', 'gazeboW']) gazebo(kit, ctx, P[k].p);
    jubileeGate(kit, ctx);
    splashPad(kit, ctx);
    for (const pt of P.pitches.wpark) field(kit, ctx, pt, { lights: false });
  });
  run('rim', () => {
    for (const pt of P.pitches.rim) field(kit, ctx, pt, { lights: true });
    martinFarm(kit, ctx);
    rimSign(kit, ctx);
  });
  run('mall', () => mall(kit, ctx));
  STATS.ms = Math.round(performance.now() - t0);
  PA.tex.needsUpdate = true;
  STATS.atlas = { y: PA.y + PA.row, full: PA.full };
  if (typeof window !== 'undefined') window.__kwPlaces = STATS;   // harness probes
}
export function placesStats() { return STATS; }

/** The map's marks and hellos. */
export function placesMap() {
  if (!P) return [];
  return [
    { x: -3832, z: -1395, kind: 'lm', label: 'Uptown', name: 'Uptown Waterloo', near: false,
      hello: 'Uptown Waterloo — King Street between William and Bridgeport: the old blocks, the Post Office clock tower, the Public Square and the ION' },
    { x: -3838, z: -1310, kind: 'lm', label: false, name: 'Waterloo Public Square', near: false, foot: true,
      hello: 'Waterloo Public Square — the leaf shades, the water wall by Beertown, and the rink when it freezes' },
    { x: -4380, z: -1610, kind: 'lm', label: 'Waterloo Park', name: 'Waterloo Park', near: false,
      hello: 'Waterloo Park — Silver Lake, the 1820 log schoolhouse, the grist mill and the Eby Farmstead. Mind the geese' },
    { x: -2150, z: -7380, kind: 'lm', label: 'RIM Park', name: 'RIM Park', near: false,
      hello: 'RIM Park — the Manulife Sportsplex, its lit fields and diamonds, and the Elam Martin farmstead by the Grand' },
    { x: -4300, z: -5130, kind: 'lm', label: 'Conestoga', name: 'Conestoga Mall', near: false,
      hello: 'Conestoga Mall, 550 King St N — Zehrs, Galaxy Cinemas, Winners, Sport Chek, Indigo, and the end of the ION line' },
  ];
}

// --- Canada geese ------------------------------------------------------------------------

// Flocks: Waterloo Park's lawns and Silver Lake, and the University of
// Waterloo's (the campus geese are famous): [x, z, count, on water]
const FLOCKS = [[-4372, -1640, 9, false], [-4250, -1585, 6, true], [-4560, -1580, 8, false], [-4700, -1700, 7, false],
  [-4986, -1600, 6, false], [-5600, -2350, 8, false], [-6000, -2500, 7, false]];

function gooseGeometry(pose) {
  const B = new Builder(false);
  const BODY = lin([0.56, 0.49, 0.40]), BREAST = lin([0.86, 0.82, 0.74]), BLACK = lin([0.06, 0.06, 0.06]), WHITE = lin([0.95, 0.95, 0.93]);
  // an ellipsoid, its own little lathe
  const ell = (cx, cy, cz, rx, ry, rz, colFn, sides = 8, stacks = 5) => {
    const P = (i, j) => {
      const th = (i / stacks) * Math.PI, ph = (j / sides) * Math.PI * 2;
      const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
      return { p: [cx + rx * nx, cy + ry * ny, cz + rz * nz], n: [nx / rx, ny / ry, nz / rz] };
    };
    for (let i = 0; i < stacks; i++) for (let j = 0; j < sides; j++) {
      const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j);
      const nn = (q) => { const l = Math.hypot(...q.n); return [q.n[0] / l, q.n[1] / l, q.n[2] / l]; };
      B.quad(a.p, b.p, c.p, d.p, [nn(a), nn(b), nn(c), nn(d)], U0, colFn((a.p[1] - cy) / ry, (a.p[2] - cz) / rz));
    }
  };
  const fly = pose === 'fly';
  const by = fly ? 0 : 0.42;
  // body: brown-grey back, pale breast, white under the tail
  ell(0, by, 0, 0.17, 0.15, 0.32, (v, w) => (v < -0.3 ? (w < -0.4 ? WHITE : BREAST) : w > 0.55 && v < 0.2 ? BREAST : BODY));
  ell(0, by + 0.02, -0.33, 0.09, 0.06, 0.1, () => BLACK, 6, 3);   // the tail
  // neck and head: black, the white chinstrap
  let n0, n1, hd;
  if (pose === 'graze') { n0 = [0, by + 0.05, 0.26]; n1 = [0, 0.12, 0.5]; hd = [0, 0.09, 0.56]; }
  else if (fly) { n0 = [0, by + 0.03, 0.28]; n1 = [0, by + 0.06, 0.58]; hd = [0, by + 0.07, 0.66]; }
  else { n0 = [0, by + 0.08, 0.24]; n1 = [0, by + 0.42, 0.33]; hd = [0, by + 0.46, 0.38]; }
  B.tube(n0, n1, 0.045, 6, BLACK);
  ell(hd[0], hd[1], hd[2], 0.045, 0.045, 0.07, (v) => (v < 0.1 ? WHITE : BLACK), 6, 4);
  const dir = [hd[0] - n1[0], hd[1] - n1[1], hd[2] - n1[2]], dl = Math.hypot(...dir) || 1;
  B.tube([hd[0] + dir[0] / dl * 0.05, hd[1] + dir[1] / dl * 0.05, hd[2] + dir[2] / dl * 0.05], [hd[0] + dir[0] / dl * 0.12, hd[1] + dir[1] / dl * 0.12 - 0.01, hd[2] + dir[2] / dl * 0.12], 0.018, 4, BLACK, true);
  if (fly) {
    for (const s of [-1, 1]) {
      const root = [s * 0.12, by + 0.06, 0.05];
      const tip = [s * 0.85, by + 0.2, -0.12];
      B.quad(root, [s * 0.12, by + 0.06, -0.18], [tip[0], tip[1], tip[2] - 0.12], tip, [0, 1, 0], U0, BODY);
      B.quad(root, tip, [tip[0], tip[1], tip[2] - 0.12], [s * 0.12, by + 0.06, -0.18], [0, -1, 0], U0, shade(BODY, 0.8));
    }
  } else {
    for (const s of [-1, 1]) B.tube([s * 0.07, 0.3, 0.02], [s * 0.07, 0, 0.05], 0.018, 4, BLACK);
  }
  return B.build();
}

/**
 * Canada geese on Waterloo Park's lawns and Silver Lake and on UW's campus:
 * they graze and wander near home, waddle away from someone on foot (the
 * gander faces you and honks first), and lift off, honking, from anything
 * coming fast -- to come down again a few dozen metres off. Three instanced
 * meshes (standing, grazing, flying), drawn only within 260 m of the camera.
 */
export class Geese {
  constructor({ scene, city, world, audio = null, hud = null }) {
    this.city = city; this.world = world; this.audio = audio; this.hud = hud;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    this.meshes = {};
    this.geese = [];
    this.flocks = [];
    const MAXN = FLOCKS.reduce((a, f) => a + f[2], 0);
    for (const pose of ['stand', 'graze', 'fly']) {
      const m = new THREE.InstancedMesh(gooseGeometry(pose), mat, MAXN);
      m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
      m.name = 'geese:' + pose;
      scene.add(m);
      this.meshes[pose] = m;
    }
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const [fx, fz, n, water] of (P ? FLOCKS : [])) {
      const fl = { x: fx, z: fz, water, honkT: 0, geese: [] };
      for (let i = 0; i < n; i++) {
        let x = fx, z = fz;
        for (let k = 0; k < 20; k++) {
          const a = rnd() * Math.PI * 2, r = 2 + rnd() * 12;
          x = fx + Math.cos(a) * r; z = fz + Math.sin(a) * r;
          if (this.ok(x, z, water)) break;
        }
        const g = { x, z, y: 0, h: rnd() * Math.PI * 2, st: rnd() < 0.6 ? 'graze' : 'stand', t: rnd() * 4, sp: 0, fl, vy: 0, alt: 0, phase: rnd() * 10, gander: i === 0 };
        fl.geese.push(g);
        this.geese.push(g);
      }
      this.flocks.push(fl);
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this.last = null;
    this.toasted = false;
  }
  water(x, z) {
    const w = this.world && this.world.waterLevelAt ? this.world.waterLevelAt(x, z) : null;
    return w !== null && w !== undefined && w > T(x, z) + 0.15 ? w : null;
  }
  /** Ground a goose may walk (or water it may swim). */
  ok(x, z, water) {
    if (water) return this.water(x, z) !== null;
    if (this.water(x, z) !== null) return false;
    if (this.city.onRoad(x, z, 1.5)) return false;
    const b = boxAt(this.city, x, z, 1.2);
    if (b && b.h > 0.3) return false;
    return true;
  }
  update(dt, player, camera) {
    if (!dt || dt > 0.25) dt = Math.min(dt || 0, 0.25);
    const cx = camera.position.x, cz = camera.position.z;
    const pp = player.position || { x: player.x, z: player.z };
    const px = pp.x, pz = pp.z;
    // how fast the player is going, from the position itself (on foot or in anything)
    let pv = 0;
    if (this.last && dt > 0) pv = Math.hypot(px - this.last[0], pz - this.last[1]) / dt;
    this.last = [px, pz];
    if (pv > 80) pv = 0;   // a teleport
    const onFoot = player.onFoot !== false;
    const cnt = { stand: 0, graze: 0, fly: 0 };
    for (const fl of this.flocks) {
      if (Math.hypot(fl.x - cx, fl.z - cz) > 260) continue;
      fl.honkT -= dt;
      for (const g of fl.geese) {
        this.step(g, dt, px, pz, pv, onFoot);
        const pose = g.st === 'fly' ? 'fly' : g.st === 'graze' ? 'graze' : 'stand';
        const m = this.meshes[pose];
        const bob = g.st === 'walk' || g.st === 'flee' ? Math.abs(Math.sin(g.phase * 9)) * 0.03 : 0;
        const roll = g.st === 'walk' || g.st === 'flee' ? Math.sin(g.phase * 9) * 0.12 : g.st === 'fly' ? Math.sin(g.phase * 2) * 0.15 : 0;
        this._e.set(g.st === 'fly' ? -Math.max(-0.3, Math.min(0.4, g.vy * 0.08)) : 0, g.h, roll);
        this._q.setFromEuler(this._e);
        this._p.set(g.x, g.y + bob, g.z);
        this._s.setScalar(g.gander ? 1.35 : 1.22);
        this._m.compose(this._p, this._q, this._s);
        m.setMatrixAt(cnt[pose]++, this._m);
      }
    }
    for (const pose of ['stand', 'graze', 'fly']) {
      const m = this.meshes[pose];
      m.count = cnt[pose];
      m.visible = cnt[pose] > 0;
      if (cnt[pose]) m.instanceMatrix.needsUpdate = true;
    }
  }
  honk(g, gain = 0.8) {
    if (!this.audio || g.fl.honkT > 0) return;
    g.fl.honkT = 0.7 + Math.random() * 0.8;
    this.audio.play('goose', { x: g.x, y: g.y + 0.5, z: g.z, gain, ref: 10, maxD: 160 });
  }
  step(g, dt, px, pz, pv, onFoot) {
    g.phase += dt;
    g.t -= dt;
    const dx = g.x - px, dz = g.z - pz, d = Math.hypot(dx, dz) || 0.01;
    const fl = g.fl;
    const swim = fl.water;
    if (g.st === 'fly') {
      // up and away, then a long glide down onto open ground near home
      g.t -= 0;
      const fwd = 11;
      g.x += Math.sin(g.h) * fwd * dt; g.z += Math.cos(g.h) * fwd * dt;
      if (g.t > 2.5) g.vy = Math.min(4, g.vy + 6 * dt);
      else {
        // turn for home and come down
        const hx = fl.x - g.x, hz = fl.z - g.z;
        const want = Math.atan2(hx, hz);
        let dh = want - g.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
        g.h += Math.max(-1, Math.min(1, dh)) * dt * 1.2;
        g.vy = Math.max(-2.6, g.vy - 3 * dt);
      }
      g.alt = Math.max(0, g.alt + g.vy * dt);
      const gy = swim ? (this.water(g.x, g.z) ?? T(g.x, g.z)) : T(g.x, g.z);
      g.y = gy + g.alt;
      if (g.t < 0 && g.alt < 0.3 && this.ok(g.x, g.z, swim)) { g.st = 'stand'; g.t = 2 + Math.random() * 3; g.alt = 0; g.vy = 0; }
      else if (g.t < -14) {
        // nowhere to land on the way: back over home
        g.x = fl.x + (Math.random() - 0.5) * 10; g.z = fl.z + (Math.random() - 0.5) * 10; g.alt = 0; g.st = 'stand'; g.t = 3;
      }
      return;
    }
    // startled into the air: anything fast and close, or a player right on top
    if ((pv > 7 && d < 16) || (d < 2.2 && !g.gander) || (d < 1.4)) {
      g.st = 'fly'; g.t = 4 + Math.random() * 2.5; g.vy = 2; g.alt = 0.1;
      g.h = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.8;
      this.honk(g, 1);
      return;
    }
    let sp = 0;
    if (d < 9 && onFoot) {
      if (g.gander && d > 2.2) {
        // the gander stands his ground: head up, facing you, honking
        g.st = 'stand';
        g.h = Math.atan2(-dx, -dz);
        if (Math.random() < dt * 1.5) this.honk(g, 0.9);
        if (!this.toasted && d < 5 && this.hud && this.hud.showToast) {
          this.toasted = true;
          this.hud.showToast('A Canada goose. It does not care that you are bigger.', 2600);
        }
      } else {
        g.st = 'flee';
        g.h = Math.atan2(dx, dz) + Math.sin(g.phase) * 0.3;
        sp = swim ? 1.2 : 1.6;
        if (Math.random() < dt * 0.5) this.honk(g, 0.6);
      }
    } else if (g.st === 'flee') {
      g.st = 'stand'; g.t = 1 + Math.random() * 2;
    } else if (g.t <= 0) {
      // graze, look up, wander a few steps -- drifting back toward home
      const r = Math.random();
      if (r < 0.5) { g.st = 'graze'; g.t = 2 + Math.random() * 5; }
      else if (r < 0.75) { g.st = 'stand'; g.t = 1 + Math.random() * 3; }
      else {
        g.st = 'walk'; g.t = 1 + Math.random() * 2.5;
        const hx = fl.x - g.x, hz = fl.z - g.z;
        g.h = Math.hypot(hx, hz) > 14 ? Math.atan2(hx, hz) + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
      }
    }
    if (g.st === 'walk') sp = swim ? 0.45 : 0.4;
    if (sp > 0) {
      const nx = g.x + Math.sin(g.h) * sp * dt, nz = g.z + Math.cos(g.h) * sp * dt;
      if (this.ok(nx, nz, swim)) { g.x = nx; g.z = nz; }
      else { g.h += Math.PI * (0.5 + Math.random() * 0.5); }
    }
    const w = this.water(g.x, g.z);
    g.y = w !== null ? w - 0.2 : T(g.x, g.z);
    if (w !== null && g.st === 'graze') g.st = 'stand';   // no grazing afloat
  }
}
