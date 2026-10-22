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
import { Builder, cropAtlas } from './build.js';
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
  constructor(w = 2048, h = 1280) {
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
  /** Done drawing: cut the unused rows (build.js cropAtlas) and upload. */
  finish() { this.cut = cropAtlas(this.tex, this.y + this.row); this.tex.needsUpdate = true; return this.cut; }
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

/** A flat-roofed footprint's roof at y (`holes`: open courtyards cut out of it). */
function roof(B, pts, y, col, holes = []) {
  let tris = [];
  const all = holes.length ? pts.concat(...holes) : pts;
  try { tris = THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q[0], q[1])), holes.map((h) => h.map((q) => new THREE.Vector2(q[0], q[1])))); } catch (e) { tris = []; }
  for (const [i, j, k] of tris) B.tri([all[i][0], y, all[i][1]], [all[j][0], y, all[j][1]], [all[k][0], y, all[k][1]], [0, 1, 0], col);
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
const STONES = [[0.69, 0.65, 0.56], [0.62, 0.59, 0.52], [0.74, 0.70, 0.60], [0.58, 0.55, 0.50], [0.66, 0.60, 0.50], [0.71, 0.68, 0.62]];
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

/**
 * A shop's sign band. `sty` (a researched look's shop, kwuptown.js) overrides
 * the hashed palette: { bg, fg, serif, wt, k, frame: false, text }.
 */
function signPanel(L, name, brand, w, h, seed, sty = null) {
  const col = sty && sty.bg ? [sty.bg, sty.fg || '#ffffff'] : BRAND_SIGN[brand] || BRAND_SIGN[name] || SIGN_PAL[Math.floor(hash2(seed, 11) * SIGN_PAL.length)];
  const serif = sty && sty.serif !== undefined ? sty.serif : !BRAND_SIGN[brand] && !BRAND_SIGN[name] && hash2(seed, 12) < 0.55;
  const label = (sty && sty.text) || name;
  return L.panel(w, h, 30, (g, W, H) => {
    if (col[0] === 'none') g.clearRect(0, 0, W, H);
    else { g.fillStyle = col[0]; g.fillRect(0, 0, W, H); }
    if (!sty || sty.frame !== false) {
      g.strokeStyle = col[1]; g.globalAlpha = 0.6; g.lineWidth = Math.max(1, H * 0.05);
      g.strokeRect(H * 0.08, H * 0.08, W - H * 0.16, H - H * 0.16); g.globalAlpha = 1;
    }
    g.fillStyle = col[1]; g.textAlign = 'center'; g.textBaseline = 'middle';
    const wt = (sty && sty.wt) || (serif ? 'italic 700' : '700');
    g.font = `${wt} ${H * ((sty && sty.k) || 0.55)}px ${serif ? SERIF : SANS}`;
    g.fillText(label, W / 2, H * 0.54, W * 0.9);
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
  // Uptown's two big neighbours of the square, drawn from their OSM plans here
  for (const p of [MARSLAND, MARSLAND_W, MARSLAND_E, PARKADE]) n += skipBox(city, p);
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
  // a researched look (kwuptown.js UPTOWN_LOOKS): real colours, heights, windows, cornice, signs
  const lk = r.look || null;
  const lc = (k, f) => (lk && lk[k] ? lin(hex(lk[k])) : f);
  const lv = lk && lk.lv ? lk.lv : Math.max(1, Math.min(5, Math.round(r.lv || 2)));
  const H = lk && lk.H ? lk.H : r.ht ? Math.min(+r.ht, 30) : lv === 1 ? 5.8 : 4.6 + (lv - 1) * 3.7 + 0.5;
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const yb = lo - 1.2;
  const base = walkY(city, cx, cz);
  const yTop = base + (po && !(lk && lk.H) ? 15.2 : H);
  // Galt's blocks (kwsights.js, `pal` 'stone') are the Grand's grey-buff limestone
  const PAL = r.pal === 'stone' ? (hash2(seed, 8) < 0.78 ? STONES : BRICK) : BRICK;
  const wall = lc('wall', lin(po ? [0.62, 0.27, 0.20] : PAL[Math.floor(hash2(seed, 1) * PAL.length)]));
  const trim = lc('trim', lin(po ? [0.80, 0.70, 0.52] : TRIMS[Math.floor(hash2(seed, 2) * TRIMS.length)]));
  const dark = shade(wall, 0.72);
  const GLASS = lin([0.13, 0.17, 0.21]), GLASS2 = lin([0.22, 0.28, 0.33]);
  const FRAME = lc('frame', lin(hash2(seed, 3) < 0.5 ? [0.16, 0.16, 0.15] : [0.90, 0.88, 0.82]));
  const BULK = lc('bulk', lin(TRIMS[Math.floor(hash2(seed, 4) * TRIMS.length)]));
  const STONE = lc('stone', lin([0.78, 0.69, 0.53]));
  const SILL = lc('sill', trim);
  const BAND = lc('band', trim);
  const E = edges(pts);
  // which faces front a street, and which is on King
  const fronts = [];
  for (const e of E) {
    if (e.L < 2.5) continue;
    const s = street(city, e.mx + e.nx * 1.5, e.mz + e.nz * 1.5, 40);
    if (!s || s.kerb > ((lk && lk.reach) || 7.5)) continue;
    const tx = s.qx - e.mx, tz = s.qz - e.mz, tl = Math.hypot(tx, tz) || 1;
    if ((tx * e.nx + tz * e.nz) / tl < 0.45) continue;
    if (partyWall(pts, e.mx + e.nx * 1.2, e.mz + e.nz * 1.2)) continue;
    e.front = true;
    e.king = /^King Street/.test(s.name);
    fronts.push(e);
  }
  fronts.sort((a, b) => (b.king - a.king) || (b.L - a.L));
  // the shops, King's face first (a look's own list replaces OSM's on the main face)
  const shops = r.s.slice();
  for (const e of fronts) e.shops = [];
  if (fronts.length) {
    if (lk && lk.shops) {
      fronts[0].shops = lk.shops.map((s) => [s.n, s.k || 'shop', '', s]);
      if (lk.side && fronts[1]) fronts[1].shops = lk.side.map((s) => [s.n, s.k || 'shop', '', s]);
    } else {
      shops.forEach((s, i) => {
        const e = fronts.length > 1 && i >= Math.ceil(shops.length * fronts[0].L / fronts.reduce((a, f) => a + f.L, 0)) ? fronts[1] : fronts[0];
        e.shops.push(s);
      });
    }
  }
  const residential = /apartments|residential|house/.test(r.bt) && !r.s.length && !(lk && lk.shops);
  const W = (lk && lk.win) || {};
  const cornice = (lk && lk.cornice) || 'bracket';
  for (const e of E) {
    const N = [e.nx, 0, e.nz];
    // the wall to the parapet, its inside face over the roof, the coping
    B.quad(e.at(0, yb), e.at(e.L, yb), e.at(e.L, yTop + 0.9), e.at(0, yTop + 0.9), N, U0, [dark, dark, wall, wall]);
    B.quad(e.at(0, yTop, -0.01), e.at(e.L, yTop, -0.01), e.at(e.L, yTop + 0.9, -0.01), e.at(0, yTop + 0.9, -0.01), [-e.nx, 0, -e.nz], U0, dark);
    B.quad(e.at(0, yTop + 0.9, 0.15), e.at(e.L, yTop + 0.9, 0.15), e.at(e.L, yTop + 1.0, 0), e.at(0, yTop + 1.0, 0), [0, 1, 0], U0, cornice === 'corbel' ? shade(wall, 0.9) : trim);
    ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: yb, y1: yTop + 0.9 });
    if (e.L < 3) continue;
    const gy = walkY(city, e.mx + e.nx * 1.4, e.mz + e.nz * 1.4);
    const party = !e.front && partyWall(pts, e.mx + e.nx * 1.2, e.mz + e.nz * 1.2);
    if (party) continue;
    const front = !!e.front;
    // upper storeys: windows
    const gfH = lv === 1 ? 0 : (lk && lk.gf) || 4.6;
    const upper = po ? 2 : lv - 1;
    const fp = (lk && lk.fp) || 3.7;
    const main = front && fronts[0] === e;
    let spacing = front ? 2.3 : 3.4;
    let nw = Math.floor((e.L - 1.2) / spacing);
    if (lk && front && (main ? W.n : W.ns)) { nw = main ? W.n : W.ns; spacing = (e.L - (W.m ?? 1.4)) / nw; }
    else if (lk && W.sp) { spacing = front ? W.sp : W.sp * 1.4; nw = Math.floor((e.L - 1.2) / spacing); }
    if (nw >= 1 && (front || e.L > 6)) {
      const pad = (e.L - nw * spacing) / 2;
      for (let k = 0; k < upper; k++) {
        const y0 = gy + gfH + (po ? 1.3 : 0) + k * fp + 0.75, wh = W.h ? (k === 0 ? W.h : W.h * 0.92) : k === 0 ? 2.0 : 1.8;
        const ww = W.w || 1.05;
        if (y0 + wh > yTop - 0.4) break;
        for (let i = 0; i < nw; i++) {
          const tc = pad + spacing * (i + 0.5);
          // a pair shares one opening's head, split by a pier
          if (W.shape === 'hex' && main) {
            // the Art Deco theatre's hexagonal lights: a frame ring and the glass
            const rr = ww / 2, yc0 = y0 + wh / 2;
            for (let s = 0; s < 6; s++) {
              const a0 = Math.PI / 3 * s, a1 = Math.PI / 3 * (s + 1);
              B.tri(e.at(tc, yc0, 0.04), e.at(tc + Math.cos(a0) * rr, yc0 + Math.sin(a0) * rr, 0.04), e.at(tc + Math.cos(a1) * rr, yc0 + Math.sin(a1) * rr, 0.04), N, GLASS2);
              B.quad(e.at(tc + Math.cos(a0) * rr, yc0 + Math.sin(a0) * rr, 0.035), e.at(tc + Math.cos(a1) * rr, yc0 + Math.sin(a1) * rr, 0.035), e.at(tc + Math.cos(a1) * (rr + 0.18), yc0 + Math.sin(a1) * (rr + 0.18), 0.035), e.at(tc + Math.cos(a0) * (rr + 0.18), yc0 + Math.sin(a0) * (rr + 0.18), 0.035), N, U0, FRAME);
            }
            continue;
          }
          for (const t of W.pair ? [tc - ww / 2 - 0.12, tc + ww / 2 + 0.12] : [tc]) {
            B.quad(e.at(t - ww / 2 - 0.1, y0 - 0.08, 0.02), e.at(t + ww / 2 + 0.1, y0 - 0.08, 0.02), e.at(t + ww / 2 + 0.1, y0 + wh + 0.08, 0.02), e.at(t - ww / 2 - 0.1, y0 + wh + 0.08, 0.02), N, U0, FRAME);
            B.quad(e.at(t - ww / 2, y0, 0.04), e.at(t + ww / 2, y0, 0.04), e.at(t + ww / 2, y0 + wh, 0.04), e.at(t - ww / 2, y0 + wh, 0.04), N, U0, [GLASS, GLASS, GLASS2, GLASS2]);
            B.quad(e.at(t - ww / 2, y0 + wh * 0.55, 0.05), e.at(t + ww / 2, y0 + wh * 0.55, 0.05), e.at(t + ww / 2, y0 + wh * 0.55 + 0.06, 0.05), e.at(t - ww / 2, y0 + wh * 0.55 + 0.06, 0.05), N, U0, FRAME);
            // sill
            B.quad(e.at(t - ww / 2 - 0.18, y0 - 0.2, 0.1), e.at(t + ww / 2 + 0.18, y0 - 0.2, 0.1), e.at(t + ww / 2 + 0.18, y0 - 0.08, 0.1), e.at(t - ww / 2 - 0.18, y0 - 0.08, 0.1), N, U0, SILL);
            B.quad(e.at(t - ww / 2 - 0.18, y0 - 0.08, 0.1), e.at(t + ww / 2 + 0.18, y0 - 0.08, 0.1), e.at(t + ww / 2 + 0.18, y0 - 0.08, 0), e.at(t - ww / 2 - 0.18, y0 - 0.08, 0), [0, 1, 0], U0, SILL);
          }
          // the head: a look's own (seg / round / flat / hood), else hashed
          const hw = W.pair ? ww + 0.12 : ww / 2;
          const head = lk && W.head ? W.head : front && (po || hash2(seed, 20) < 0.6) ? 'seg' : 'flat';
          const HC = W.hc ? lin(hex(W.hc)) : po ? STONE : head === 'flat' ? SILL : shade(wall, 0.8);
          const yh = y0 + wh + 0.08;
          if (head === 'seg') {
            B.quad(e.at(tc - hw - 0.15, yh, 0.03), e.at(tc + hw + 0.15, yh, 0.03), e.at(tc + hw, yh + 0.34, 0.03), e.at(tc - hw, yh + 0.34, 0.03), N, U0, HC);
            B.tri(e.at(tc - hw, yh + 0.34, 0.035), e.at(tc + hw, yh + 0.34, 0.035), e.at(tc, yh + 0.54, 0.035), N, HC);
          } else if (head === 'round') {
            // a semicircular brick arch over the opening (the glass fills it)
            for (let s = 0; s < 6; s++) {
              const a0 = Math.PI * s / 6, a1 = Math.PI * (s + 1) / 6, rr = hw;
              B.tri(e.at(tc, yh - 0.08, 0.04), e.at(tc + Math.cos(a0) * rr, yh - 0.08 + Math.sin(a0) * rr, 0.04), e.at(tc + Math.cos(a1) * rr, yh - 0.08 + Math.sin(a1) * rr, 0.04), N, GLASS2);
              const o0 = [tc + Math.cos(a0) * (rr + 0.24), yh - 0.08 + Math.sin(a0) * (rr + 0.24)], o1 = [tc + Math.cos(a1) * (rr + 0.24), yh - 0.08 + Math.sin(a1) * (rr + 0.24)];
              B.quad(e.at(tc + Math.cos(a0) * rr, yh - 0.08 + Math.sin(a0) * rr, 0.035), e.at(tc + Math.cos(a1) * rr, yh - 0.08 + Math.sin(a1) * rr, 0.035), e.at(o1[0], o1[1], 0.035), e.at(o0[0], o0[1], 0.035), N, U0, HC);
            }
          } else if (head === 'hood') {
            // a projecting label moulding (an Italianate hood) over the head
            B.quad(e.at(tc - hw - 0.22, yh, 0.12), e.at(tc + hw + 0.22, yh, 0.12), e.at(tc + hw + 0.22, yh + 0.3, 0.12), e.at(tc - hw - 0.22, yh + 0.3, 0.12), N, U0, HC);
            B.quad(e.at(tc - hw - 0.22, yh, 0), e.at(tc + hw + 0.22, yh, 0), e.at(tc + hw + 0.22, yh, 0.12), e.at(tc - hw - 0.22, yh, 0.12), [0, -1, 0], U0, shade(HC, 0.6));
          } else {
            B.quad(e.at(tc - hw - 0.12, yh, 0.03), e.at(tc + hw + 0.12, yh, 0.03), e.at(tc + hw + 0.12, yh + 0.22, 0.03), e.at(tc - hw - 0.12, yh + 0.22, 0.03), N, U0, HC);
          }
        }
        // a string course at each floor line on the street
        if (front && k > 0 && !(lk && lk.noBands)) {
          const ys = gy + gfH + (po ? 1.3 : 0) + k * fp + 0.2;
          B.quad(e.at(0, ys, 0.06), e.at(e.L, ys, 0.06), e.at(e.L, ys + 0.18, 0.06), e.at(0, ys + 0.18, 0.06), N, U0, BAND);
        }
      }
    }
    if (!front) continue;
    // stone quoins up the street face's corners
    if (lk && lk.quoin) {
      const Q = lin(hex(lk.quoin));
      for (let y = gy + gfH; y < yTop - 0.5; y += 0.6) {
        const w2 = (Math.round((y - gy) / 0.6) % 2) ? 0.55 : 0.85;
        for (const [ta, tb] of [[0, w2], [e.L - w2, e.L]]) B.quad(e.at(ta, y, 0.05), e.at(tb, y, 0.05), e.at(tb, y + 0.5, 0.05), e.at(ta, y + 0.5, 0.05), N, U0, Q);
      }
    }
    // the cornice
    const yc = yTop - 0.15;
    if (cornice === 'bracket') {
      // a projecting band with brackets under it
      B.quad(e.at(-0.25, yc, 0.42), e.at(e.L + 0.25, yc, 0.42), e.at(e.L + 0.25, yc + 0.55, 0.42), e.at(-0.25, yc + 0.55, 0.42), N, U0, trim);
      B.quad(e.at(-0.25, yc, 0), e.at(e.L + 0.25, yc, 0), e.at(e.L + 0.25, yc, 0.42), e.at(-0.25, yc, 0.42), [0, -1, 0], U0, shade(trim, 0.6));
      B.quad(e.at(-0.25, yc + 0.55, 0.42), e.at(e.L + 0.25, yc + 0.55, 0.42), e.at(e.L + 0.25, yc + 0.55, 0), e.at(-0.25, yc + 0.55, 0), [0, 1, 0], U0, trim);
      // brackets: a face and an underside each (all anyone sees from the street)
      for (let t = 0.5; t < e.L - 0.3; t += 1.25) {
        B.quad(e.at(t - 0.09, yc - 0.45, 0.32), e.at(t + 0.09, yc - 0.45, 0.32), e.at(t + 0.09, yc, 0.32), e.at(t - 0.09, yc, 0.32), N, U0, trim);
        B.quad(e.at(t - 0.09, yc - 0.45, 0), e.at(t + 0.09, yc - 0.45, 0), e.at(t + 0.09, yc - 0.45, 0.32), e.at(t - 0.09, yc - 0.45, 0.32), [0, -1, 0], U0, shade(trim, 0.6));
      }
    } else if (cornice === 'corbel') {
      // corbelled brick: three courses stepping out, a dentil row under them
      const CB = lk && lk.trim ? trim : shade(wall, 1.05);
      for (let s = 0; s < 3; s++) {
        const y = yc - 0.25 - s * 0.22, d = 0.12 * (3 - s);
        B.quad(e.at(0, y, d), e.at(e.L, y, d), e.at(e.L, y + 0.22, d), e.at(0, y + 0.22, d), N, U0, s ? CB : shade(CB, 1.1));
        B.quad(e.at(0, y, 0), e.at(e.L, y, 0), e.at(e.L, y, d), e.at(0, y, d), [0, -1, 0], U0, shade(CB, 0.6));
      }
      for (let t = 0.2; t < e.L - 0.2; t += 0.45) {
        B.quad(e.at(t, yc - 1.15, 0.1), e.at(t + 0.2, yc - 1.15, 0.1), e.at(t + 0.2, yc - 0.91, 0.1), e.at(t, yc - 0.91, 0.1), N, U0, CB);
      }
    } else if (cornice === 'plain') {
      B.quad(e.at(-0.1, yc - 0.1, 0.2), e.at(e.L + 0.1, yc - 0.1, 0.2), e.at(e.L + 0.1, yc + 0.5, 0.2), e.at(-0.1, yc + 0.5, 0.2), N, U0, trim);
      B.quad(e.at(-0.1, yc - 0.1, 0), e.at(e.L + 0.1, yc - 0.1, 0), e.at(e.L + 0.1, yc - 0.1, 0.2), e.at(-0.1, yc - 0.1, 0.2), [0, -1, 0], U0, shade(trim, 0.6));
    }
    // a raised name panel (pediment) at the middle of the main face's parapet
    if (lk && lk.name && main) {
      const pw = Math.min(e.L - 1, lk.nameW || 6), ph = lk.nameH || 1.3, tm = e.L / 2;
      B.quad(e.at(tm - pw / 2, yTop + 0.9, 0), e.at(tm + pw / 2, yTop + 0.9, 0), e.at(tm + pw / 2, yTop + 0.9 + ph, 0), e.at(tm - pw / 2, yTop + 0.9 + ph, 0), N, U0, wall);
      B.quad(e.at(tm - pw / 2, yTop + 0.9, -0.3), e.at(tm + pw / 2, yTop + 0.9, -0.3), e.at(tm + pw / 2, yTop + 0.9 + ph, -0.3), e.at(tm - pw / 2, yTop + 0.9 + ph, -0.3), [-e.nx, 0, -e.nz], U0, dark);
      B.quad(e.at(tm - pw / 2 - 0.1, yTop + 0.9 + ph, 0.12), e.at(tm + pw / 2 + 0.1, yTop + 0.9 + ph, 0.12), e.at(tm + pw / 2 + 0.1, yTop + 1.05 + ph, -0.3), e.at(tm - pw / 2 - 0.1, yTop + 1.05 + ph, -0.3), [0, 1, 0], U0, trim);
      const m = L.panel(pw - 0.6, ph * 0.62, 40, (q, Wd, Hd) => {
        q.fillStyle = lk.nameBg || '#d9cfb8'; q.fillRect(0, 0, Wd, Hd);
        q.fillStyle = lk.nameFg || '#3a2a20'; q.textAlign = 'center'; q.textBaseline = 'middle';
        q.font = `700 ${Hd * 0.66}px ${SERIF}`;
        q.fillText(lk.name, Wd / 2, Hd * 0.54, Wd * 0.92);
      });
      const p = e.at(tm, yTop + 0.9 + ph * 0.48, 0.02);
      hang(g, m, p[0], p[1], p[2], e.nx, e.nz, 0.02);
    }
    // the ground floor
    if (lk && lk.ground === 'none') continue;
    if (lk && lk.ground === 'bank') {
      // a bank's ashlar ground floor: a plinth, tall windows, the door in the middle
      B.quad(e.at(0, gy - 0.3, 0.06), e.at(e.L, gy - 0.3, 0.06), e.at(e.L, gy + 0.9, 0.06), e.at(0, gy + 0.9, 0.06), N, U0, shade(wall, 0.85));
      const na = Math.max(1, Math.floor(e.L / 3.0)), pd = (e.L - na * 3.0) / 2;
      for (let i = 0; i < na; i++) {
        const t = pd + 3.0 * (i + 0.5), door = main && i === Math.floor(na / 2);
        const ya = door ? gy : gy + 1.2, yz = gy + 3.9;
        B.quad(e.at(t - 0.75, ya, 0.07), e.at(t + 0.75, ya, 0.07), e.at(t + 0.75, yz, 0.07), e.at(t - 0.75, yz, 0.07), N, U0, door ? shade(FRAME, 0.6) : [GLASS, GLASS, GLASS2, GLASS2]);
        B.quad(e.at(t - 0.95, yz, 0.09), e.at(t + 0.95, yz, 0.09), e.at(t + 0.95, yz + 0.35, 0.09), e.at(t - 0.95, yz + 0.35, 0.09), N, U0, trim);
      }
      if (main && lk.sign) {
        const sp = e.at(e.L / 2, gy + 4.75, 0.12);
        hang(g, signPanel(L, lk.sign.n, '', lk.sign.w || 3, 0.8, seed, lk.sign), sp[0], sp[1], sp[2], e.nx, e.nz, 0.02);
      }
      continue;
    }
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
    const nb = lk && lk.shops && main ? Math.max(1, nShops) : Math.max(1, Math.min(Math.max(nShops, Math.round(e.L / 8)), Math.floor(e.L / 3.4)));
    // a look's shops may say how much of the face each takes (`f`, fractions)
    const fr = e.shops.map((s) => (s[3] && s[3].f) || 0), fsum = fr.reduce((a, b) => a + b, 0);
    const span = (k) => {
      if (main && lk && lk.shops && fsum > 0) {
        let a = 0;
        for (let i = 0; i < k; i++) a += fr[i] || (1 - fsum) / Math.max(1, fr.filter((x) => !x).length);
        const w = fr[k] || (1 - fsum) / Math.max(1, fr.filter((x) => !x).length);
        return [a * e.L, (a + w) * e.L];
      }
      return [k * e.L / nb, (k + 1) * e.L / nb];
    };
    for (let k = 0; k < nb; k++) {
      let [s0, s1] = span(k);
      if (main && lk && lk.flip) [s0, s1] = [e.L - s1, e.L - s0];   // the look's shops run the other way along the face
      const t0 = s0 + 0.3, t1 = s1 - 0.3, tm = (t0 + t1) / 2;
      const sd = seed + k * 31;
      const shop = e.shops[k];
      const sty = shop && shop[3] ? shop[3] : null;
      const PIER = lk && lk.pier ? lin(hex(lk.pier)) : trim;
      // piers between the shopfronts
      for (const t of (k === 0 ? [s0, s1] : [s1])) {
        const ta = Math.max(0, t - 0.3), tb = Math.min(e.L, t + 0.3);
        B.quad(e.at(ta, gy - 0.3, 0.22), e.at(tb, gy - 0.3, 0.22), e.at(tb, gy + 3.2, 0.22), e.at(ta, gy + 3.2, 0.22), N, U0, PIER);
        B.quad(e.at(ta, gy - 0.3, 0), e.at(ta, gy - 0.3, 0.22), e.at(ta, gy + 3.2, 0.22), e.at(ta, gy + 3.2, 0), [-e.ux, 0, -e.uz], U0, shade(PIER, 0.8));
        B.quad(e.at(tb, gy - 0.3, 0.22), e.at(tb, gy - 0.3, 0), e.at(tb, gy + 3.2, 0), e.at(tb, gy + 3.2, 0.22), [e.ux, 0, e.uz], U0, shade(PIER, 0.8));
      }
      // bulkhead, glass, a mullion, the transom bar, and the recessed door
      const doorL = hash2(sd, 5) < 0.5;
      const dA = doorL ? t0 + 0.15 : t1 - 1.25, dB = dA + 1.1;
      const SB = sty && sty.bulk ? lin(hex(sty.bulk)) : BULK;
      B.quad(e.at(t0, gy - 0.3, 0.04), e.at(t1, gy - 0.3, 0.04), e.at(t1, gy + 0.55, 0.04), e.at(t0, gy + 0.55, 0.04), N, U0, SB);
      B.quad(e.at(t0, gy + 0.55, 0.03), e.at(t1, gy + 0.55, 0.03), e.at(t1, gy + 3.05, 0.03), e.at(t0, gy + 3.05, 0.03), N, U0, [GLASS, GLASS, GLASS2, GLASS2]);
      B.quad(e.at(dA, gy - 0.3, 0.05), e.at(dB, gy - 0.3, 0.05), e.at(dB, gy + 2.45, 0.05), e.at(dA, gy + 2.45, 0.05), N, U0, shade(SB, 0.55));
      B.quad(e.at(dA + 0.15, gy + 0.9, 0.06), e.at(dB - 0.15, gy + 0.9, 0.06), e.at(dB - 0.15, gy + 2.2, 0.06), e.at(dA + 0.15, gy + 2.2, 0.06), N, U0, GLASS2);
      B.quad(e.at(t0, gy + 2.45, 0.06), e.at(t1, gy + 2.45, 0.06), e.at(t1, gy + 2.55, 0.06), e.at(t0, gy + 2.55, 0.06), N, U0, FRAME);
      const mid = doorL ? (dB + t1) / 2 : (t0 + dA) / 2;
      B.quad(e.at(mid - 0.05, gy + 0.55, 0.06), e.at(mid + 0.05, gy + 0.55, 0.06), e.at(mid + 0.05, gy + 3.05, 0.06), e.at(mid - 0.05, gy + 3.05, 0.06), N, U0, FRAME);
      // the sign band
      const band = sty && sty.band ? lin(hex(sty.band)) : lk && lk.signBand ? lin(hex(lk.signBand)) : lin(TRIMS[Math.floor(hash2(sd, 6) * TRIMS.length)]);
      B.quad(e.at(t0 - 0.3, gy + 3.05, 0.12), e.at(t1 + 0.3, gy + 3.05, 0.12), e.at(t1 + 0.3, gy + 4.15, 0.12), e.at(t0 - 0.3, gy + 4.15, 0.12), N, U0, band);
      B.quad(e.at(t0 - 0.3, gy + 4.15, 0.12), e.at(t1 + 0.3, gy + 4.15, 0.12), e.at(t1 + 0.3, gy + 4.15, 0), e.at(t0 - 0.3, gy + 4.15, 0), [0, 1, 0], U0, band);
      if (shop && shop[0]) {
        const sw = Math.min(t1 - t0 - 0.1, sty && sty.w ? sty.w : Math.max(2.4, shop[0].length * 0.32 + 1));
        const sp = e.at(tm, gy + 3.6, 0.14);
        hang(g, signPanel(L, shop[0], shop[2], sw, 0.78, seed + k, sty), sp[0], sp[1], sp[2], e.nx, e.nz, 0.02);
        // a blade sign over the pavement for the pubs and restaurants
        const blade = sty ? sty.blade : /pub|bar|restaurant|cafe|nightclub|cinema/.test(shop[1]) && hash2(sd, 9) < 0.7;
        if (blade) {
          const bp = e.at(doorL ? t0 + 0.3 : t1 - 0.3, gy + 4.9, 0.75);
          const bl = signPanel(L, sty && sty.bladeText || shop[0], shop[2], 0.95, 0.95, seed + k + 99, sty);
          // two faces back to back (opaque, so neither shows the other mirrored)
          hang(g, bl, bp[0], bp[1], bp[2], e.ux, e.uz, 0.03);
          hang(g, bl.clone(), bp[0], bp[1], bp[2], -e.ux, -e.uz, 0.03);
          const bb = e.at(doorL ? t0 + 0.3 : t1 - 0.3, gy + 5.45, 0.4);
          B.box(bb[0], bb[1], bb[2], 0.05, 0.05, 0.85, Math.atan2(e.nz, e.nx) + Math.PI / 2, lin([0.1, 0.1, 0.1]));
        }
      }
      // an awning: a look's shop says its colour (or false), else hashed
      const awn = sty ? sty.awn : lk && lk.awn === false ? null
        : lk && lk.awnPal ? (hash2(sd, 7) < (lk.awnP ?? 0.3) ? lk.awnPal[Math.floor(hash2(sd, 8) * lk.awnPal.length)] : null)
          : hash2(sd, 7) < 0.62 ? AWN[Math.floor(hash2(sd, 8) * AWN.length)] : null;
      if (awn) {
        const [ac, as] = Array.isArray(awn) ? awn : [awn, null];
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
  // (where it is on the roof: the vertex centroid of an L is off it, over the yard)
  if (Math.abs(polyArea(pts)) > 300 && [[0, 0], [1.8, 1.8], [-1.8, 1.8], [1.8, -1.8], [-1.8, -1.8]].every(([dx, dz]) => inPoly(pts, cx + dx, cz + dz))) {
    B.box(cx, yTop, cz, 2.2, 1.3, 1.6, hash2(seed, 30) * 3, lin([0.62, 0.63, 0.64]));
  }
  // the Old Post Office's clock tower, on its King and Dupont corner
  if (po) postOfficeTower(kit, ctx, pts, base, yTop, wall, STONE, lk && lk.tower);
  // whatever else a researched building carries (kwuptown.js): a tower, a sign, a marquee
  if (lk && lk.extra) {
    try { lk.extra({ kit, ctx, B, g, L, pts, E, fronts, base, yTop, wall, trim, dark, cx, cz }); } catch (err) { console.warn('uptown look ' + (lk.addr || '') + ': ' + err.message); }
  }
}

/**
 * THE OLD POST OFFICE, 35 King St N (1912): Romanesque, sandstone ground
 * floor and red brick above, and the clock tower on the corner of King and
 * Dupont that commands Uptown's skyline. The tower came down in 1956 and was
 * rebuilt in 1991, the clock in 2003. OSM gives the building 23 m.
 */
function postOfficeTower(kit, ctx, pts, base, yTop, wall, STONE, at = null) {
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
  const S = at ? at[2] : 5.6;
  const ix = cx - best[0], iz = cz - best[1], il = Math.hypot(ix, iz) || 1;
  // OSM maps the tower as its own part (way 682351484): a researched look passes its centre and size
  const tx = at ? at[0] : best[0] + (ix / il) * S * 0.62, tz = at ? at[1] : best[1] + (iz / il) * S * 0.62;
  const B = kit.B(tx, tz), g = kit.grp(tx, tz);
  const rot = Math.atan2(uz, ux);
  // OSM's tower part is 23 m to the tip of its pyramid (the 1987 rebuild to full height)
  const top = base + 17.6;
  B.box(tx, base - 1, tz, S, top - base + 1, S, rot, wall);
  B.box(tx, base - 1, tz, S + 0.3, 5.9, S + 0.3, rot, STONE);
  // the belfry stage: a stone band, corner piers, the clock faces, a pyramid roof
  B.box(tx, top - 5.4, tz, S + 0.4, 0.4, S + 0.4, rot, STONE);
  B.box(tx, top, tz, S + 0.6, 0.5, S + 0.6, rot, STONE);
  const RF = lin([0.30, 0.36, 0.34]);
  const c = Math.cos(rot), s = Math.sin(rot), hs = S / 2 + 0.3;
  const corner = (a, b) => [tx + a * c - b * s, top + 0.5, tz + a * s + b * c];
  const apex = [tx, top + 5.4, tz];
  const C = [corner(-hs, -hs), corner(hs, -hs), corner(hs, hs), corner(-hs, hs)];
  for (let i = 0; i < 4; i++) {
    const a = C[i], b = C[(i + 1) % 4];
    const mx = (a[0] + b[0]) / 2 - tx, mz = (a[2] + b[2]) / 2 - tz, ml = Math.hypot(mx, mz);
    B.tri(a, b, apex, [mx / ml * 0.8, 0.6, mz / ml * 0.8], RF);
  }
  B.box(tx, top + 5.3, tz, 0.12, 1.2, 0.12, rot, lin([0.2, 0.2, 0.2]));
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
  // the banners: white, teal and blue as they hung in May 2026 (Commons); the
  // BIA's artwork itself was not found, so the lettering is a stand-in
  const banner = L.panel(0.62, 1.5, 60, (q, W, H) => {
    q.fillStyle = '#ffffff'; q.fillRect(0, 0, W, H);
    q.fillStyle = '#1a9a9a'; q.beginPath(); q.moveTo(0, H * 0.62); q.quadraticCurveTo(W * 0.5, H * 0.5, W, H * 0.6); q.lineTo(W, H); q.lineTo(0, H); q.fill();
    q.fillStyle = '#1f4fa0'; q.beginPath(); q.moveTo(0, H * 0.8); q.quadraticCurveTo(W * 0.5, H * 0.7, W, H * 0.78); q.lineTo(W, H); q.lineTo(0, H); q.fill();
    q.fillStyle = '#1f4fa0'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `800 ${W * 0.2}px ${SANS}`;
    q.fillText('UPTOWN', W / 2, H * 0.2, W * 0.92);
    q.font = `700 ${W * 0.15}px ${SANS}`;
    q.fillText('WATERLOO', W / 2, H * 0.32, W * 0.92);
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
        // the ornamental head: a crossarm along the street and two globes
        B.box(x, y + 5.8, z, 1.3, 0.08, 0.08, Math.atan2(k.ez, k.ex), POST);
        for (const s of [-0.6, 0.6]) {
          const gx = x + k.ex * s, gz = z + k.ez * s;
          B.prism(gx, y + 5.84, gz, 0.07, 0.12, 6, POST);
          B.spheroid(gx, y + 6.18, gz, 0.22, 8, 5, GLOBE);
          B.box(gx, y + 6.38, gz, 0.2, 0.08, 0.2, 0, POST);
        }
        B.prism(x, y + 5.8, z, 0.06, 0.75, 6, POST);
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
  // street trees in grates half way between the lamps (the 2019 streetscape),
  // where the pavement has room: not on a road, in a building or on the square
  let nt = 0;
  for (let i = 0; i < UPTOWN_KING.length - 1; i++) {
    const a = UPTOWN_KING[i], b = UPTOWN_KING[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    for (let t = 27; t < len - 4; t += 30) {
      const k = street(city, a[0] + dx * t / len, a[1] + dz * t / len, 30, /^King Street/);
      if (!k) continue;
      for (const sd of [-1, 1]) {
        const off = k.hw + 1.25, nx = -k.ez * sd, nz = k.ex * sd;
        const x = k.qx + nx * off, z = k.qz + nz * off;
        if (inPoly(COURT, x, z) || city.onRoad(x, z, 0.9, false, false)) continue;
        if (boxAt(city, x, z, 1.2) && boxAt(city, x, z, 1.2).h > 0.5) continue;
        if (KING_SKIP.some((p) => inPoly(p, x, z) || segDist(x, z, p.concat([p[0]])) < 1.6)) continue;
        const y = walkY(city, x, z), B = kit.B(x, z);
        B.box(x, y - 0.17, z, 1.3, 0.2, 1.3, Math.atan2(k.ez, k.ex), lin([0.18, 0.18, 0.18]));
        tree(B, x, y, z, 6 + hash2(x, z) * 1.5, Math.round(x * 3 + z), ctx.solids);
        nt++;
      }
    }
  }
  STATS.kingTrees = nt;
  return n;
}

// --- Uptown: Waterloo Public Square and the Town Square ----------------------------------
//
// WATERLOO PUBLIC SQUARE (2009, on the mall's old parking lot; OSM way
// 62299949). King St S runs down its east side, Willis Way cuts its south
// corner on a diagonal, the ION track and Waterloo Public Square station (one
// platform, northbound) close its north side, and the Shops at Waterloo Town
// Square front it on the west. From the City's site plan (July 2026), its
// 2012 photographs and OSM's pedestrian area (760863913):
//   - a flat concrete courtyard on King (light grey slabs in a big grid of
//     darker bands) with the rink's rounded rectangle in the middle;
//   - round its south-west side a curved raised stage and seat-steps that rise
//     to an upper terrace (the mall's floor, ~1.35 m up: twelve steps in OSM
//     from the main entrance down to the courtyard);
//   - on that terrace the five leaf shade structures (2023): a curved steel
//     spine each with timber slats stacked up it, ~8 m tall, lit from below;
//   - the water feature in front of Beertown's patio: a water wall and pools
//     cascading north beside a stepped walk (OSM 760863914, steps 2-2-4);
//   - the Waterloo Bell (Royden Rabinowitch, 2009, Corten) on its round
//     plinth at the foot of the seat-steps;
//   - a planted triangle with a grove of trees along Willis Way, young trees
//     in grates, concrete benches and the GRT shelter along King, tall grey
//     light poles with banners and hanging baskets, the event trailer and a
//     hedge on the fire route by the station.
// The rink is the City's: public skating only, "not designed for hockey" --
// a low white curb with a red stripe round a white sheet (2019 photographs).

// the rink (OSM way 202051421, leisure=ice_rink) is drawn as a symmetric
// rounded rectangle on OSM's axis and extent: OSM's outline is lopsided (one
// round end, skewed sides), the rink isn't. 31.4 m x 19.8 m, 5 m corners.
const RINK_C = [-3834.48, -1327.70], RINK_U = [-0.186, -0.983], RINK_HL = 15.7, RINK_HW = 9.9, RINK_R = 5;
const RINK = (() => {
  const [ux, uz] = RINK_U, vx = -uz, vz = ux, pts = [];
  for (const [su, sv, a0] of [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI * 1.5]]) {
    const cu = su * (RINK_HL - RINK_R), cv = sv * (RINK_HW - RINK_R);
    for (let k = 0; k <= 4; k++) {
      const a = a0 + k * Math.PI / 8, u = cu + Math.cos(a) * RINK_R, v = cv + Math.sin(a) * RINK_R;
      pts.push([RINK_C[0] + ux * u + vx * v, RINK_C[1] + uz * u + vz * v]);
    }
  }
  return pts;
})();
// the courtyard (OSM's pedestrian area, its north and King parts)
const COURT = [[-3849.6, -1338.6], [-3846.4, -1319.6], [-3846.0, -1318.1], [-3845.2, -1315.1], [-3843.3, -1312.1], [-3841.2, -1309.5],
  [-3838.5, -1307.2], [-3835.4, -1305.4], [-3831.8, -1304.3], [-3828.0, -1303.2], [-3825.0, -1301.5], [-3821.5, -1300.0],
  [-3815.1, -1296.7], [-3810.9, -1299.7], [-3819.6, -1356.5], [-3825.6, -1359.3], [-3832.0, -1359.6], [-3852.2, -1356.8],
  [-3851.6, -1353.7], [-3863.5, -1351.3], [-3861.2, -1340.1], [-3853.5, -1340.6]];
// the seat-steps' foot: the courtyard's curved edge, from the entrance stair round to Willis Way
const AMPHI = [[-3845.2, -1315.1], [-3843.3, -1312.1], [-3841.2, -1309.5], [-3838.5, -1307.2], [-3835.4, -1305.4], [-3831.8, -1304.3],
  [-3828.0, -1303.2], [-3825.0, -1301.5], [-3821.5, -1300.0], [-3818.5, -1298.6]];
// [from, to, height]: the stage, two rows of seat-steps, the terrace's edge
const TIERS = [[0, 2.4, 0.45], [2.4, 3.3, 0.9], [3.3, 5.4, 1.35]];
const TERRACE = 1.35;
// the King St edge of the square, south to north
const KING_EDGE = [[-3810.9, -1299.7], [-3819.6, -1356.5]];
// the mall's wall on the square, Willis Way to the north end
const MALL_FRONT = [[-3850.7, -1273.6], [-3857.7, -1316.1], [-3861.8, -1339.6]];
// the water feature (OSM 760863914): four pools stepping down north, the walk beside them
const POOLS = [[-1320.5, -1326.0, 1.2], [-1326.0, -1330.7, 0.88], [-1330.7, -1335.4, 0.56], [-1335.4, -1340.0, 0.24]];
// the walk beside the pools: [z north, z south, y at the north end, y at the south end]
const WALK = [[-1325.4, -1320.0, 1.35, 1.35], [-1327.0, -1325.4, 1.0, 1.35], [-1330.3, -1327.0, 1.0, 1.0], [-1331.7, -1330.3, 0.68, 1.0],
  [-1335.1, -1331.7, 0.68, 0.68], [-1338.1, -1335.1, 0, 0.68]];
const WALK_X = [-3852.3, -3849.6];
// the planted beds on the terrace (OSM gardens 760863915-7) and the triangle on Willis Way (202051422)
const BEDS = [[[-3852.4, -1303.2], [-3853.6, -1310.5], [-3850.3, -1305.4], [-3849.3, -1304.5], [-3849.9, -1304.0]],
  [[-3841.9, -1298.3], [-3838.6, -1296.7], [-3840.6, -1291.4], [-3843.4, -1292.4], [-3844.1, -1294.8]],
  [[-3850.0, -1288.9], [-3848.8, -1289.2], [-3842.6, -1286.5], [-3847.3, -1275.4]]];
const GROVE = [[-3843.0, -1277.4], [-3815.1, -1296.7], [-3820.3, -1295.6], [-3828.9, -1294.3], [-3835.7, -1295.9]];
const BELL = [-3827.4, -1304.6];   // The Waterloo Bell (OSM node 1583470085)
const SHELTER = [-3814.5, -1316.8]; // GRT's stop on King (OSM node 502854873)

/** A polyline offset by d along its (mitred) normals, the side away from `away`. */
function offsetLine(pts, d, away) {
  const n = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
    let nx = -tz / tl, nz = tx / tl;
    if ((p[0] - away[0]) * nx + (p[1] - away[1]) * nz < 0) { nx = -nx; nz = -nz; }
    return [nx, nz];
  });
  return pts.map((p, i) => [p[0] + n[i][0] * d, p[1] + n[i][1] * d]);
}
function segDist(px, pz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2));
    best = Math.min(best, Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t));
  }
  return best;
}
/** A street tree: a trunk and a lumpy crown in its fall colour. */
function tree(B, x, y, z, h, seed, solids) {
  const FALL = [[0.80, 0.42, 0.10], [0.86, 0.62, 0.14], [0.62, 0.20, 0.12], [0.55, 0.60, 0.22], [0.90, 0.72, 0.20]];
  const c = lin(FALL[Math.floor(hash2(seed, 41) * FALL.length)]);
  B.prism(x, y - 0.2, z, 0.11, h * 0.62, 6, lin([0.30, 0.24, 0.19]));
  // a young street tree: an upright crown of three lumps, not a ball
  const r = h * 0.17;
  for (let k = 0; k < 3; k++) {
    const a = hash2(seed, k) * 6.28, o = k ? r * 0.55 : 0;
    B.spheroid(x + Math.cos(a) * o, y + h * (0.62 + 0.12 * k), z + Math.sin(a) * o, r * (1 - 0.15 * k), 6, 4, shade(c, 0.9 + 0.12 * k), 1.35, 0.35);
  }
  if (solids) solids.push({ x, z, r: 0.2, y0: y - 1, y1: y + h * 0.55 });
}
/** A tall grey square light: banner arms, a hanging basket, a lantern on an arm. */
function squareLight(B, g, ctx, x, y, z, ax, az, banner) {
  const POLE = lin([0.55, 0.56, 0.57]);
  B.prism(x, y - 0.2, z, 0.11, 8.6, 8, POLE);
  B.box(x, y - 0.2, z, 0.4, 0.7, 0.4, 0, POLE);
  B.tube([x, y + 8.2, z], [x + ax * 1.3, y + 8.5, z + az * 1.3], 0.05, 5, POLE);
  B.box(x + ax * 1.3, y + 8.05, z + az * 1.3, 0.5, 0.35, 0.3, Math.atan2(az, ax), lin([0.25, 0.26, 0.27]));
  B.box(x + ax * 1.3, y + 7.98, z + az * 1.3, 0.42, 0.07, 0.24, Math.atan2(az, ax), lin([1.0, 0.95, 0.80]));
  // the hanging basket (red geraniums) off the other side
  B.tube([x, y + 4.6, z], [x - ax * 0.6, y + 4.6, z - az * 0.6], 0.03, 4, POLE);
  B.spheroid(x - ax * 0.6, y + 4.0, z - az * 0.6, 0.38, 6, 4, lin([0.70, 0.10, 0.12]), 0.8, 0.35);
  if (banner) {
    for (const yy of [5.6, 7.3]) B.tube([x, y + yy, z], [x + ax * 0.65, y + yy, z + az * 0.65], 0.025, 4, POLE);
    for (const s of [1, -1]) hang(g, banner.clone(), x + ax * 0.34, y + 6.45, z + az * 0.34, -az * s, ax * s, 0.02);
  }
  ctx.solids.push({ x, z, r: 0.22, y0: y - 1, y1: y + 8.6 });
}

/**
 * The rink: a white sheet on the courtyard inside a low white curb with a red
 * stripe along its top, one gap toward King St. Walkable (two platforms).
 */
function rink(kit, ctx) {
  const city = ctx.city;
  let pts = RINK.slice();
  if (polyArea(pts) < 0) pts = pts.reverse();
  const [cx, cz] = centroid(pts);
  const B = kit.B(cx, cz);
  // the courtyard falls toward King: level the sheet on its highest point, or
  // the paving shows through it on the high side
  let y = walkY(city, cx, cz);
  for (const p of pts) y = Math.max(y, walkY(city, p[0], p[1]), walkY(city, (p[0] + cx) / 2, (p[1] + cz) / 2));
  const yi = y + 0.1;
  const ICE = lin([0.90, 0.94, 0.97]), CURB = lin([0.95, 0.95, 0.93]), STRIPE = lin([0.80, 0.10, 0.12]);
  // the sheet: a fan from the middle (it is convex), level everywhere
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    B.quad([cx, yi, cz], [b[0], yi, b[1]], [a[0], yi, a[1]], [cx, yi, cz], [0, 1, 0], U0, ICE);
  }
  for (const e of edges(pts)) {
    const gate = e.L > 15 && e.nx > 0.5;   // the long side facing King St
    const segs = gate ? [[0, e.L / 2 - 1.1], [e.L / 2 + 1.1, e.L]] : [[0, e.L]];
    for (const [t0, t1] of segs) {
      const h = 0.32, th = 0.1;
      B.quad(e.at(t0, y - 0.2), e.at(t1, y - 0.2), e.at(t1, yi + h - 0.07), e.at(t0, yi + h - 0.07), [e.nx, 0, e.nz], U0, CURB);
      B.quad(e.at(t0, yi + h - 0.07), e.at(t1, yi + h - 0.07), e.at(t1, yi + h), e.at(t0, yi + h), [e.nx, 0, e.nz], U0, STRIPE);
      B.quad(e.at(t1, yi, -th), e.at(t0, yi, -th), e.at(t0, yi + h, -th), e.at(t1, yi + h, -th), [-e.nx, 0, -e.nz], U0, CURB);
      B.quad(e.at(t0, yi + h, 0), e.at(t1, yi + h, 0), e.at(t1, yi + h, -th), e.at(t0, yi + h, -th), [0, 1, 0], U0, STRIPE);
      if (gate) for (const t of [t0, t1]) B.quad(e.at(t, y - 0.2, -th), e.at(t, y - 0.2, 0), e.at(t, yi + h, 0), e.at(t, yi + h, -th), [e.ux, 0, e.uz], U0, CURB);
    }
  }
  // the ice is walkable: one flat platform over the sheet
  ctx.platforms.push({ x: RINK_C[0], z: RINK_C[1], hw: RINK_HL, hd: RINK_HW, rot: Math.atan2(RINK_U[1], RINK_U[0]), y0: yi, y1: yi });
  STATS.rink = { y: +yi.toFixed(2), boardH: 0.32 };
}

/** The seat-steps, the stage, the terrace, the entrance stair and the stepped walk by the water. */
function terraces(kit, ctx, y) {
  const away = [-3833, -1325];
  const B = kit.B(-3840, -1305);
  const CONC = lin([0.74, 0.73, 0.70]), STEP = lin([0.80, 0.79, 0.76]), RISER = lin([0.58, 0.57, 0.55]), STONE = lin([0.48, 0.48, 0.49]);
  // the tiers: each a band between two offsets of the foot, flat on top, a riser in front
  let hPrev = 0;
  for (const [d0, d1, h] of TIERS) {
    const A = offsetLine(AMPHI, d0, away), Bn = offsetLine(AMPHI, Math.min(d1, 4.2), away);
    for (let i = 0; i < AMPHI.length - 1; i++) {
      const a0 = A[i], a1 = A[i + 1], b0 = Bn[i], b1 = Bn[i + 1];
      const tx = a1[0] - a0[0], tz = a1[1] - a0[1], tl = Math.hypot(tx, tz) || 1;
      const nI = [-(b0[0] - a0[0]), 0, -(b0[1] - a0[1])], nl = Math.hypot(nI[0], nI[2]) || 1;
      B.quad([a0[0], y + h, a0[1]], [a1[0], y + h, a1[1]], [b1[0], y + h, b1[1]], [b0[0], y + h, b0[1]], [0, 1, 0], U0, d0 === 0 ? CONC : STEP);
      B.quad([a0[0], y + hPrev - (d0 ? 0 : 0.2), a0[1]], [a1[0], y + hPrev - (d0 ? 0 : 0.2), a1[1]], [a1[0], y + h, a1[1]], [a0[0], y + h, a0[1]], [nI[0] / nl, 0, nI[2] / nl], U0, RISER);
      // walkable: a flat platform over the band (the terrace's own band runs on under the terrace)
      const mA = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2];
      const Bp = offsetLine(AMPHI, d1, away), mB = [(Bp[i][0] + Bp[i + 1][0]) / 2, (Bp[i][1] + Bp[i + 1][1]) / 2];
      ctx.platforms.push({ x: (mA[0] + mB[0]) / 2, z: (mA[1] + mB[1]) / 2, hw: tl / 2 + 0.25, hd: (d1 - d0) / 2, rot: Math.atan2(tz, tx), y0: y + h, y1: y + h });
    }
    // the band's two ends
    for (const i of [0, AMPHI.length - 1]) {
      const a = A[i], b = Bn[i], tx = AMPHI[i === 0 ? 1 : i - 1][0] - AMPHI[i][0], tz = AMPHI[i === 0 ? 1 : i - 1][1] - AMPHI[i][1], tl = Math.hypot(tx, tz);
      B.quad([a[0], y - 0.2, a[1]], [b[0], y - 0.2, b[1]], [b[0], y + h, b[1]], [a[0], y + h, a[1]], [-tx / tl, 0, -tz / tl], U0, RISER);
    }
    hPrev = h;
  }
  // the terrace: from the seat-steps back to the mall and Willis Way
  const top = offsetLine(AMPHI, 4.2, away);
  let TP = [...top, [-3843.0, -1277.4], [-3849.7, -1272.5], [-3856.9, -1316.1]];
  if (polyArea(TP) < 0) TP = TP.reverse();
  roof(B, TP, y + TERRACE, CONC);
  // the entrance landing, north of the terrace's edge (1 cm under it where they meet)
  B.box(-3854.3, y - 0.2, -1317.9, 7.2, TERRACE + 0.19, 4.4, 0, CONC);
  for (const e of edges(TP)) {
    // the Willis Way side is a stone retaining wall (the mall and the tiers close the rest)
    if (segDist(e.mx, e.mz, [[-3820.3, -1294.8], [-3843.0, -1277.4], [-3849.7, -1272.5]]) > 1) continue;
    B.quad(e.at(0, y - 0.3), e.at(e.L, y - 0.3), e.at(e.L, y + TERRACE + 0.45), e.at(0, y + TERRACE + 0.45), [e.nx, 0, e.nz], U0, STONE);
    B.quad(e.at(0, y + TERRACE + 0.45), e.at(e.L, y + TERRACE + 0.45), e.at(e.L, y + TERRACE + 0.45, -0.4), e.at(0, y + TERRACE + 0.45, -0.4), [0, 1, 0], U0, RISER);
    ctx.solids.push({ x: e.mx - e.nx * 0.2, z: e.mz - e.nz * 0.2, hw: e.L / 2 + 0.2, hd: 0.3, rot: Math.atan2(e.uz, e.ux), y0: y - 1, y1: y + TERRACE + 0.45 });
  }
  // the terrace is walkable: 1.5 m cells over it, clear of the tiers (which carry their own)
  let n = 0;
  for (let x = -3860; x < -3812; x += 1.5) {
    for (let z = -1322; z < -1270; z += 1.5) {
      if (!inPoly(TP, x, z) || segDist(x, z, AMPHI) < 5.3) continue;
      ctx.platforms.push({ x, z, hw: 0.8, hd: 0.8, rot: 0, y0: y + TERRACE, y1: y + TERRACE });
      n++;
    }
  }
  // the entrance landing, the stair down to the courtyard (nine risers), Beertown's patio
  ctx.platforms.push({ x: -3854.6, z: -1316.8, hw: 3.9, hd: 4.4, rot: 0, y0: y + TERRACE, y1: y + TERRACE });
  const sx0 = -3850.7, sx1 = -3846.2, sz0 = -1319.6, sz1 = -1315.4;
  for (let k = 0; k < 9; k++) {
    const xa = sx0 + (sx1 - sx0) * k / 9, xb = sx0 + (sx1 - sx0) * (k + 1) / 9;
    const hk = TERRACE * (9 - k) / 9;
    B.box((xa + xb) / 2, y - 0.2, (sz0 + sz1) / 2, Math.abs(xb - xa), hk + 0.2, sz1 - sz0, 0, k % 2 ? STEP : CONC);
  }
  // the stair is a slope to the walker: a platform rising west (local v runs along -x)
  ctx.platforms.push({ x: (sx0 + sx1) / 2, z: (sz0 + sz1) / 2, hw: (sz1 - sz0) / 2, hd: (sx1 - sx0) / 2, rot: Math.PI / 2, y0: y + 0.08, y1: y + TERRACE });
  // handrails up the middle and the sides
  const RAIL = lin([0.70, 0.71, 0.72]);
  for (const z of [sz0 + 0.1, (sz0 + sz1) / 2, sz1 - 0.1]) {
    B.tube([sx1, y + 0.95, z], [sx0, y + TERRACE + 0.95, z], 0.03, 5, RAIL);
    for (const x of [sx1, (sx0 + sx1) / 2, sx0]) {
      const yy = y + TERRACE * (x - sx1) / (sx0 - sx1);
      B.tube([x, yy, z], [x, yy + 0.95, z], 0.025, 4, RAIL);
    }
  }
  // the walk beside the pools, stepping down north
  for (const [z0, z1, y0, y1] of WALK) {
    const steps = Math.max(1, Math.round(Math.abs(y1 - y0) / 0.17));
    for (let k = 0; k < steps; k++) {
      const za = z0 + (z1 - z0) * k / steps, zb = z0 + (z1 - z0) * (k + 1) / steps;
      const hk = y0 + (y1 - y0) * (k + 1) / steps;
      B.box((WALK_X[0] + WALK_X[1]) / 2, y - 0.2, (za + zb) / 2, WALK_X[1] - WALK_X[0], Math.max(0.05, hk + 0.2), zb - za, 0, k % 2 ? STEP : CONC);
    }
    ctx.platforms.push({ x: (WALK_X[0] + WALK_X[1]) / 2, z: (z0 + z1) / 2, hw: (WALK_X[1] - WALK_X[0]) / 2, hd: (z1 - z0) / 2, rot: 0, y0: y + y0, y1: y + y1 });
    // its edge to the courtyard is a wall to anyone below
    if (Math.max(y0, y1) > 0.5) ctx.solids.push({ x: WALK_X[1] - 0.15, z: (z0 + z1) / 2, hw: 0.15, hd: (z1 - z0) / 2, rot: 0, y0: y - 1, y1: y + Math.min(y0, y1) - 0.3 });
  }
  return n;
}

/** The water feature: a granite water wall at Beertown's patio and four pools stepping down north. */
function waterFeature(kit, ctx, y) {
  const B = kit.B(-3856, -1330);
  const GRANITE = lin([0.30, 0.30, 0.32]), RIM = lin([0.62, 0.61, 0.58]), WATER = lin([0.30, 0.50, 0.62]), SHEET = lin([0.80, 0.88, 0.93]);
  const wallX = (z) => -3855.4 + (z + 1320.5) * (3.6 / 19.5);   // the pools' west edge (OSM)
  for (const [z0, z1, h] of POOLS) {
    const xa = wallX((z0 + z1) / 2), xb = WALK_X[0];
    const cx = (xa + xb) / 2, cz = (z0 + z1) / 2, w = xb - xa, d = z0 - z1;
    B.box(cx, y - 0.2, cz, w, h + 0.2, d, 0, RIM);
    B.box(cx, y + h, cz, w - 0.5, 0.02, d - 0.4, 0, WATER);
    // the spill over its north lip
    B.quad([xa + 0.3, y + h, z1 - 0.01], [xb - 0.3, y + h, z1 - 0.01], [xb - 0.3, y + h - 0.24, z1 - 0.01], [xa + 0.3, y + h - 0.24, z1 - 0.01], [0, 0, -1], U0, SHEET);
  }
  // the water wall along the patio's edge, a sheet of water down its east face
  const za = -1320.5, zb = -1340.0, xa = wallX(za), xb = wallX(zb);
  const rot = Math.atan2(zb - za, xb - xa), L = Math.hypot(xb - xa, zb - za);
  B.box((xa + xb) / 2, y - 0.2, (za + zb) / 2, L, TERRACE + 0.65, 0.5, rot, GRANITE);
  const nx = -(zb - za) / L, nz = (xb - xa) / L, s = nx > 0 ? 1 : -1;
  const at = (t, yy) => [xa + (xb - xa) * t + nx * s * 0.27, yy, za + (zb - za) * t + nz * s * 0.27];
  B.quad(at(0.04, y + 0.5), at(0.96, y + 0.5), at(0.96, y + TERRACE + 0.4), at(0.04, y + TERRACE + 0.4), [nx * s, 0, nz * s], U0, [WATER, WATER, SHEET, SHEET]);
  ctx.solids.push({ x: (xa + xb) / 2, z: (za + zb) / 2, hw: L / 2, hd: 0.3, rot, y0: y - 1, y1: y + TERRACE + 1.0 });
  // and the pools themselves, to a walker on the courtyard or the walk
  ctx.solids.push({ x: (xa + WALK_X[0]) / 2 + 0.3, z: (za + zb) / 2, hw: (WALK_X[0] - xa) / 2 - 0.3, hd: L / 2, rot: 0, y0: y - 1, y1: y + 0.3 });
  // Beertown's patio on the terrace between the mall and the water wall: a railing, tables
  {
    const [a, b] = [[-3857.7, -1320.6], [-3861.6, -1339.4]], Lp = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / Lp, uz = (b[1] - a[1]) / Lp;
    const ex = -uz, ez = ux;   // toward the square
    ctx.platforms.push({ x: (a[0] + b[0]) / 2 + ex * 1.5, z: (a[1] + b[1]) / 2 + ez * 1.5, hw: Lp / 2, hd: 1.6, rot: Math.atan2(uz, ux), y0: y + TERRACE, y1: y + TERRACE });
    const yp = y + TERRACE;
    B.quad([a[0], yp, a[1]], [b[0], yp, b[1]], [b[0] + ex * 3.1, yp, b[1] + ez * 3.1], [a[0] + ex * 3.1, yp, a[1] + ez * 3.1], [0, 1, 0], U0, lin([0.52, 0.30, 0.22]));
    // its railing over the water
    const RAIL = lin([0.12, 0.12, 0.13]);
    B.tube([a[0] + ex * 3.0, yp + 1.0, a[1] + ez * 3.0], [b[0] + ex * 3.0, yp + 1.0, b[1] + ez * 3.0], 0.03, 5, RAIL);
    for (let t = 0; t <= Lp; t += 2.4) B.tube([a[0] + ux * t + ex * 3.0, yp, a[1] + uz * t + ez * 3.0], [a[0] + ux * t + ex * 3.0, yp + 1.0, a[1] + uz * t + ez * 3.0], 0.025, 4, RAIL);
    // a few of the patio's tables under red umbrellas
    for (let t = 3; t < Lp - 2; t += 5) {
      const px = a[0] + ux * t + ex * 1.4, pz = a[1] + uz * t + ez * 1.4;
      B.prism(px, yp, pz, 0.04, 2.2, 5, RAIL);
      B.cone(px, yp + 1.95, pz, 1.3, 0.45, 8, lin([0.78, 0.12, 0.12]));
      B.prism(px, yp + 0.7, pz, 0.45, 0.05, 8, RAIL);
    }
  }
}

/**
 * The five leaf shade structures (2023): each a dark steel spine rising out
 * of the terrace and curving back over it, with reclaimed-arena timber slats
 * stacked up it -- a tall leaf face-on to the courtyard, ~8 m high.
 */
function leaves(kit, ctx, y) {
  const away = [-3833, -1325];
  const STEEL = lin([0.18, 0.19, 0.21]), WOOD = lin([0.80, 0.62, 0.42]), WOOD2 = lin([0.72, 0.54, 0.35]);
  // along the tiers' foot, two staggered rows on the terrace (site plan)
  const spots = [[0.10, 6.0, 7.6], [0.22, 8.8, 8.3], [0.34, 6.2, 8.0], [0.46, 9.0, 7.4], [0.58, 6.4, 7.8]];
  const Ls = [0];
  for (let i = 1; i < AMPHI.length; i++) Ls.push(Ls[i - 1] + Math.hypot(AMPHI[i][0] - AMPHI[i - 1][0], AMPHI[i][1] - AMPHI[i - 1][1]));
  const total = Ls[Ls.length - 1];
  for (const [f, off, H] of spots) {
    const s = f * total;
    let i = 0;
    while (i < AMPHI.length - 2 && Ls[i + 1] < s) i++;
    const t = (s - Ls[i]) / (Ls[i + 1] - Ls[i]);
    const a = AMPHI[i], b = AMPHI[i + 1];
    const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
    const tl = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let rx = -(b[1] - a[1]) / tl, rz = (b[0] - a[0]) / tl;
    if ((px - away[0]) * rx + (pz - away[1]) * rz < 0) { rx = -rx; rz = -rz; }
    const sx = -rz, sz = rx;   // the leaf's face runs along the tiers
    const bx = px + rx * off, bz = pz + rz * off, by = y + TERRACE;
    const B = kit.B(bx, bz);
    const lean = 2.6;   // how far the top curls back over the terrace
    const spine = (u) => [bx + rx * lean * u * u, by + H * u, bz + rz * lean * u * u];
    const NS = 12;
    for (let k = 0; k < NS; k++) B.tube(spine(k / NS), spine((k + 1) / NS), k < 3 ? 0.16 : 0.12, 6, STEEL);
    // the slats: each a board across the face, the leaf widest two-thirds up
    const N = 30;
    for (let k = 2; k <= N; k++) {
      const u = k / N, p = spine(u);
      const w = 0.7 + 2.5 * Math.pow(Math.sin(Math.PI * (0.1 + 0.78 * u)), 0.7);
      B.box(p[0] - rx * 0.12, p[1], p[2] - rz * 0.12, w, 0.15, 0.42,Math.atan2(sz, sx), k % 3 ? WOOD : WOOD2);
    }
    B.box(bx, by - 0.2, bz, 0.7, 0.32, 0.7, 0, lin([0.40, 0.40, 0.41]));
    ctx.solids.push({ x: bx, z: bz, r: 0.3, y0: by - 1, y1: by + H });
  }
}

/** The Waterloo Bell (Royden Rabinowitch, 2009): a Corten bell on a round plinth. */
function waterlooBell(kit, ctx, y) {
  const [x, z] = BELL;
  const B = kit.B(x, z);
  const CORTEN = lin([0.40, 0.21, 0.12]), CORT2 = lin([0.34, 0.17, 0.10]), PLINTH = lin([0.62, 0.61, 0.58]);
  B.prism(x, y - 0.2, z, 1.6, 0.65, 16, PLINTH);
  roof(B, Array.from({ length: 16 }, (_, i) => [x + Math.cos(i * Math.PI / 8) * 1.6, z + Math.sin(i * Math.PI / 8) * 1.6]), y + 0.45, PLINTH);
  // the bell's profile: lip, waist, shoulder, crown
  const prof = [[1.05, 0], [0.98, 0.15], [0.80, 0.55], [0.66, 1.2], [0.64, 1.75], [0.55, 2.05], [0.32, 2.22], [0, 2.26]];
  const n = 18, y0 = y + 0.45;
  for (let k = 0; k < prof.length - 1; k++) {
    const [r0, h0] = prof[k], [r1, h1] = prof[k + 1];
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
      const ny = (r0 - r1), nr = (h1 - h0), nl = Math.hypot(ny, nr) || 1;
      B.quad([x + Math.cos(a0) * r0, y0 + h0, z + Math.sin(a0) * r0], [x + Math.cos(a1) * r0, y0 + h0, z + Math.sin(a1) * r0],
        [x + Math.cos(a1) * r1, y0 + h1, z + Math.sin(a1) * r1], [x + Math.cos(a0) * r1, y0 + h1, z + Math.sin(a0) * r1],
        [Math.cos(am) * nr / nl, ny / nl, Math.sin(am) * nr / nl], U0, k % 2 ? CORT2 : CORTEN);
    }
  }
  ctx.solids.push({ x, z, r: 1.6, y0: y - 1, y1: y + 2.7 });
}

/** The square's furniture: trees, benches, lights, the GRT shelter, the trailer, the hedge, the beds. */
function squareFurniture(kit, ctx, y) {
  const city = ctx.city, L = ctx.atlas;
  const B = kit.B(-3830, -1320), g = kit.grp(-3830, -1320);
  const BENCH = lin([0.66, 0.65, 0.62]), BIN = lin([0.10, 0.10, 0.11]);
  const banner = L.panel(0.62, 1.5, 60, (q, W, H) => {
    q.fillStyle = '#f2b51c'; q.fillRect(0, 0, W, H);
    q.fillStyle = '#16346b'; q.fillRect(0, H * 0.8, W, H * 0.2);
    q.fillStyle = '#16346b'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `800 ${W * 0.22}px ${SANS}`;
    q.fillText('WATERLOO', W / 2, H * 0.24, W * 0.92);
    q.fillText('PUBLIC', W / 2, H * 0.42, W * 0.92);
    q.fillText('SQUARE', W / 2, H * 0.60, W * 0.92);
    q.fillStyle = '#ffffff'; q.font = `700 ${W * 0.13}px ${SANS}`;
    q.fillText('UPTOWN', W / 2, H * 0.9, W * 0.92);
  });
  // along King: trees in grates, concrete benches, bins, the shelter
  const [k0, k1] = KING_EDGE;
  const kL = Math.hypot(k1[0] - k0[0], k1[1] - k0[1]), kux = (k1[0] - k0[0]) / kL, kuz = (k1[1] - k0[1]) / kL;
  const knx = kuz, knz = -kux;   // into the square (west)
  const K = (t, o) => [k0[0] + kux * t + knx * o, k0[1] + kuz * t + knz * o];
  let seed = 7;
  for (const t of [7, 26, 37, 48]) {
    const [x, z] = K(t, 4.6);
    B.box(x, y - 0.18, z, 1.4, 0.2, 1.4, Math.atan2(kuz, kux), lin([0.22, 0.22, 0.22]));
    tree(B, x, y, z, 6.5, seed++, ctx.solids);
  }
  for (const t of [12, 31.5, 42.5]) {
    const [x, z] = K(t, 4.4);
    B.box(x, y - 0.1, z, 2.4, 0.55, 0.6, Math.atan2(kuz, kux), BENCH);
    ctx.solids.push({ x, z, hw: 1.2, hd: 0.3, rot: Math.atan2(kuz, kux), y0: y - 1, y1: y + 0.45 });
  }
  for (const t of [22, 29.5]) {
    const [x, z] = K(t, 3.2);
    B.prism(x, y - 0.1, z, 0.3, 1.0, 8, BIN);
  }
  {
    // GRT's glass shelter (the square's own, by the stop)
    const [x, z] = K(17.3, 3.2);
    const rot = Math.atan2(kuz, kux), GL = lin([0.32, 0.42, 0.46]), FR = lin([0.30, 0.32, 0.33]);
    B.box(x - knx * 0.7, y - 0.05, z - knz * 0.7, 4.4, 0.05, 1.8, rot, FR);
    B.box(x + knx * 0.2, y, z + knz * 0.2, 4.2, 2.3, 0.06, rot, GL);          // back pane
    for (const s of [-1, 1]) B.box(x + kux * s * 2.1 - knx * 0.4, y, z + kuz * s * 2.1 - knz * 0.4, 0.06, 2.3, 1.2, rot, GL);
    B.box(x - knx * 0.5, y + 2.35, z - knz * 0.5, 4.6, 0.1, 1.9, rot, lin([0.40, 0.62, 0.62]));
    B.box(x + kux * 2.3 - knx * 0.6, y, z + kuz * 2.3 - knz * 0.6, 0.12, 2.6, 0.12, rot, FR);
    ctx.solids.push({ x: x + knx * 0.2, z: z + knz * 0.2, hw: 2.2, hd: 0.15, rot, y0: y - 1, y1: y + 2.3 });
  }
  // the square's lights: down the King side, round the courtyard, on the terrace
  const lights = [[...K(2, 2.0)], [...K(19.5, 2.0)], [...K(36, 2.0)], [...K(53, 2.0)],
    [-3848.4, -1342], [-3836, -1352.5], [-3847, -1323.5]];
  for (const [x, z] of lights) {
    const ax = -3833 - x, az = -1325 - z, al = Math.hypot(ax, az) || 1;
    squareLight(B, g, ctx, x, walkY(city, x, z), z, ax / al, az / al, banner);
  }
  for (const p of offsetLine([AMPHI[1], AMPHI[4], AMPHI[7]], 7.2, [-3833, -1325])) {
    const ax = -3833 - p[0], az = -1325 - p[1], al = Math.hypot(ax, az);
    squareLight(B, g, ctx, p[0], y + TERRACE, p[1], ax / al, az / al, banner);
  }
  // the event trailer and the hedge on the fire route, by the station
  {
    const x = -3844, z = -1351.0, rot = Math.atan2(-1359.6 - -1356.8, -3832.0 - -3852.2);
    B.box(x, y + 0.45, z, 6.4, 2.4, 2.4, rot, lin([0.93, 0.93, 0.91]));
    B.box(x, y + 2.85, z, 6.4, 0.08, 2.4, rot, lin([0.80, 0.80, 0.79]));
    for (const s of [-0.9, 0.9]) B.box(x + Math.cos(rot) * 0.3 * s - Math.sin(rot) * s * 1.1, y, z + Math.sin(rot) * 0.3 * s + Math.cos(rot) * s * 1.1, 0.7, 0.7, 0.25, rot, lin([0.08, 0.08, 0.08]));
    ctx.solids.push({ x, z, hw: 3.3, hd: 1.25, rot, y0: y - 1, y1: y + 2.9 });
    const HEDGE = lin([0.16, 0.30, 0.13]);
    for (const [a, b] of [[[-3851.6, -1355.4], [-3832.0, -1358.4]], [[-3832.0, -1358.4], [-3822.0, -1357.0]]]) {
      const Lh = Math.hypot(b[0] - a[0], b[1] - a[1]);
      B.box((a[0] + b[0]) / 2, y - 0.1, (a[1] + b[1]) / 2, Lh, 1.15, 0.9, Math.atan2(b[1] - a[1], b[0] - a[0]), HEDGE);
    }
  }
  // the planted beds on the terrace and the grove on Willis Way
  const SOIL = lin([0.22, 0.30, 0.14]), EDGE = lin([0.55, 0.55, 0.54]);
  for (const bed of BEDS) {
    const p = polyArea(bed) < 0 ? bed.slice().reverse() : bed;
    roof(B, p, y + TERRACE + 0.45, SOIL);
    for (const e of edges(p)) B.quad(e.at(0, y + TERRACE), e.at(e.L, y + TERRACE), e.at(e.L, y + TERRACE + 0.45), e.at(0, y + TERRACE + 0.45), [e.nx, 0, e.nz], U0, EDGE);
    const [cx, cz] = centroid(p);
    for (let k = 0; k < 4; k++) B.spheroid(cx + (hash2(k, cx) - 0.5) * 2.2, y + TERRACE + 0.75, cz + (hash2(k, cz) - 0.5) * 2.2, 0.55, 6, 4, lin(k % 2 ? [0.30, 0.42, 0.18] : [0.62, 0.40, 0.20]), 0.8, 0.3);
    wallSolids(ctx.solids, p, y - 1, y + TERRACE + 0.45);
  }
  {
    const p = polyArea(GROVE) < 0 ? GROVE.slice().reverse() : GROVE;
    roof(B, p, y + TERRACE + 0.12, SOIL);
    let s = 31;
    for (let k = 0; k < 40 && s < 43; k++) {
      const x = -3843 + hash2(k, 5) * 28, z = -1296.5 + hash2(k, 9) * 19;
      if (!inPoly(p, x, z) || segDist(x, z, p.concat([p[0]])) < 1.4) continue;
      tree(B, x, y + TERRACE, z, 7 + hash2(k, 3) * 2.5, s++, ctx.solids);
    }
  }
  // the paving: big light slabs in a grid of darker bands, square to King
  const D = kit.B(-3830, -1320, true), BAND = lin([0.50, 0.50, 0.49]);
  const court = polyArea(COURT) < 0 ? COURT.slice().reverse() : COURT;
  for (const along of [true, false]) {
    for (let o = -60; o <= 60; o += 6.2) {
      for (let t = -10; t < 80; t += 1.5) {
        const cxa = along ? K(t + 0.75, o) : K(o, t + 0.75);
        if (!inPoly(court, cxa[0], cxa[1]) || inPoly(RINK, cxa[0], cxa[1])) continue;
        if ((city.roadLift(cxa[0], cxa[1]) || 0) > 0.05) continue;
        const yy = T(cxa[0], cxa[1]) + 0.025;
        const a = along ? K(t, o - 0.22) : K(o - 0.22, t), b = along ? K(t + 1.5, o - 0.22) : K(o - 0.22, t + 1.5);
        const c2 = along ? K(t + 1.5, o + 0.22) : K(o + 0.22, t + 1.5), d2 = along ? K(t, o + 0.22) : K(o + 0.22, t);
        D.quad([a[0], yy, a[1]], [b[0], yy, b[1]], [c2[0], yy, c2[1]], [d2[0], yy, d2[1]], [0, 1, 0], U0, BAND);
      }
    }
  }
}

function publicSquare(kit, ctx) {
  const city = ctx.city;
  // the courtyard's level: King's side of it, at the rink
  const y = walkY(city, -3833, -1328);
  rink(kit, ctx);
  STATS.terraceCells = terraces(kit, ctx, y);
  waterFeature(kit, ctx, y);
  leaves(kit, ctx, y);
  waterlooBell(kit, ctx, y);
  squareFurniture(kit, ctx, y);
}

/**
 * The Shops at Waterloo Town Square (2006, the old mall converted): one tall
 * storey of grey precast panels and big glass storefronts; on the square the
 * main entrance under its glass canopy at the top of the stair (THE SHOPS,
 * 75 KING), Shoppers Drug Mart south of it, Beertown's patio and the Piper
 * Arms, the mall's floor a terrace above the courtyard.
 */
function townSquare(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  let pts = simplify(P.townsq.p, 0.6);
  if (polyArea(pts) < 0) pts = pts.slice().reverse();
  const [cx, cz] = centroid(pts);
  const B = kit.B(cx, cz), g = kit.grp(cx, cz);
  const sqY = walkY(city, -3833, -1328);
  const floor = sqY + TERRACE, yTop = floor + 7.6;
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const PRE = lin([0.72, 0.71, 0.68]), PRE2 = lin([0.56, 0.56, 0.55]), MET = lin([0.30, 0.31, 0.33]), GL = lin([0.16, 0.21, 0.26]), GL2 = lin([0.34, 0.42, 0.48]);
  const signs = [];
  for (const e of edges(pts)) {
    const N = [e.nx, 0, e.nz];
    const onSquare = e.nx > 0.8 && e.mx > -3866 && e.mz > -1345 && e.mz < -1270;
    B.quad(e.at(0, lo - 1.2), e.at(e.L, lo - 1.2), e.at(e.L, yTop + 0.6), e.at(0, yTop + 0.6), N, U0, PRE);
    // the dark metal fascia and the coping
    B.quad(e.at(0, yTop - 1.3, 0.25), e.at(e.L, yTop - 1.3, 0.25), e.at(e.L, yTop + 0.6, 0.25), e.at(0, yTop + 0.6, 0.25), N, U0, onSquare ? PRE2 : MET);
    B.quad(e.at(0, yTop + 0.6, 0.25), e.at(e.L, yTop + 0.6, 0.25), e.at(e.L, yTop + 0.6, 0), e.at(0, yTop + 0.6, 0), [0, 1, 0], U0, MET);
    ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: lo - 1.2, y1: yTop + 0.6 });
    if (e.L < 6) continue;
    const gy = onSquare ? floor : walkY(city, e.mx + e.nx * 1.5, e.mz + e.nz * 1.5);
    // glass storefronts between precast piers, a transom bar, mullions
    const nb = Math.floor(e.L / 6);
    for (let k = 0; k < nb; k++) {
      const t0 = (e.L - nb * 6) / 2 + k * 6 + 0.6, t1 = t0 + 4.8;
      B.quad(e.at(t0, gy - 0.1, 0.04), e.at(t1, gy - 0.1, 0.04), e.at(t1, gy + 4.6, 0.04), e.at(t0, gy + 4.6, 0.04), N, U0, [GL, GL, GL2, GL2]);
      B.quad(e.at(t0, gy + 3.0, 0.06), e.at(t1, gy + 3.0, 0.06), e.at(t1, gy + 3.12, 0.06), e.at(t0, gy + 3.12, 0.06), N, U0, MET);
      for (const t of [t0 + 1.6, t0 + 3.2]) B.quad(e.at(t - 0.04, gy - 0.1, 0.06), e.at(t + 0.04, gy - 0.1, 0.06), e.at(t + 0.04, gy + 4.6, 0.06), e.at(t - 0.04, gy + 4.6, 0.06), N, U0, MET);
      // a dark awning band over every other one, as the photographs
      if (k % 2 === 0 && !onSquare) B.quad(e.at(t0, gy + 3.2, 0.05), e.at(t1, gy + 3.2, 0.05), e.at(t1, gy + 2.9, 1.0), e.at(t0, gy + 2.9, 1.0), [e.nx * 0.4, 0.9, e.nz * 0.4], U0, lin([0.16, 0.16, 0.17]));
    }
    if (onSquare) {
      // the main entrance (OSM's entrance node): a taller glass bay, its canopy, the doors
      const te = (-3857.7 - e.a[0]) * e.ux + (-1316.1 - e.a[1]) * e.uz;
      if (te > 3 && te < e.L - 3) {
        B.quad(e.at(te - 3.2, gy - 0.1, 0.08), e.at(te + 3.2, gy - 0.1, 0.08), e.at(te + 3.2, yTop + 0.4, 0.08), e.at(te - 3.2, yTop + 0.4, 0.08), N, U0, [GL, GL, GL2, GL2]);
        for (const t of [te - 1.1, te + 1.1]) B.quad(e.at(t - 0.05, gy - 0.1, 0.1), e.at(t + 0.05, gy - 0.1, 0.1), e.at(t + 0.05, gy + 2.5, 0.1), e.at(t - 0.05, gy + 2.5, 0.1), N, U0, MET);
        B.quad(e.at(te - 2.3, gy + 2.5, 0.1), e.at(te + 2.3, gy + 2.5, 0.1), e.at(te + 2.3, gy + 2.62, 0.1), e.at(te - 2.3, gy + 2.62, 0.1), N, U0, MET);
        const cy = gy + 4.0, CAN = lin([0.62, 0.74, 0.78]);
        B.quad(e.at(te - 3.8, cy, 0.1), e.at(te + 3.8, cy, 0.1), e.at(te + 3.8, cy, 3.4), e.at(te - 3.8, cy, 3.4), [0, 1, 0], U0, CAN);
        B.quad(e.at(te - 3.8, cy - 0.02, 3.4), e.at(te + 3.8, cy - 0.02, 3.4), e.at(te + 3.8, cy - 0.02, 0.1), e.at(te - 3.8, cy - 0.02, 0.1), [0, -1, 0], U0, shade(CAN, 0.7));
        for (const t of [te - 3.6, te + 3.6]) {
          const p = e.at(t, gy - 0.2, 3.2);
          B.box(p[0], p[1], p[2], 0.14, cy - gy + 0.2, 0.14, 0, MET);
        }
        const m = L.panel(4.6, 1.2, 50, (q, W, H) => {
          q.clearRect(0, 0, W, H);
          q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
          q.font = `italic 700 ${H * 0.62}px ${SERIF}`; q.fillText('The Shops', W / 2, H * 0.36, W * 0.94);
          q.font = `600 ${H * 0.22}px ${SANS}`; q.fillText('AT WATERLOO TOWN SQUARE', W / 2, H * 0.82, W * 0.94);
        });
        const p = e.at(te, yTop - 0.7, 0.3);
        hang(g, m, p[0], p[1], p[2], e.nx, e.nz, 0.02);
        const k75 = L.panel(1.9, 0.55, 50, (q, W, H) => {
          q.clearRect(0, 0, W, H);
          q.fillStyle = '#f4f4f4'; q.textAlign = 'center'; q.textBaseline = 'middle';
          q.font = `700 ${H * 0.75}px ${SANS}`; q.fillText('75 KING', W / 2, H * 0.55, W * 0.94);
        });
        const p2 = e.at(te - 5.6, yTop - 0.7, 0.3);
        hang(g, k75, p2[0], p2[1], p2[2], e.nx, e.nz, 0.02);
      }
    }
    signs.push(e);
  }
  roof(B, pts, yTop, lin([0.46, 0.46, 0.45]));
  // the stores' signs, on the face nearest each store
  const put = (text, sub, bg, fg, w, h, px, pz, font, face) => {
    let best = null, bd = Infinity;
    for (const e of signs) {
      const t = Math.max(w / 2 + 0.3, Math.min(e.L - w / 2 - 0.3, (px - e.a[0]) * e.ux + (pz - e.a[1]) * e.uz));
      if (e.L < w + 0.6) continue;
      const q = e.at(t, 0), d = Math.hypot(q[0] - px, q[2] - pz);
      if (d < bd) { bd = d; best = { e, t }; }
    }
    if (!best) return;
    const { e, t } = best;
    const p = e.at(t, yTop - 0.65, 0.27);
    const m = L.panel(w, h, 40, (q, W, H) => {
      if (bg) { q.fillStyle = bg; q.fillRect(0, 0, W, H); } else q.clearRect(0, 0, W, H);
      q.fillStyle = fg; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `${font || '700'} ${H * (sub ? 0.5 : 0.7)}px ${face || SANS}`;
      q.fillText(text, W / 2, H * (sub ? 0.38 : 0.54), W * 0.94);
      if (sub) { q.font = `600 ${H * 0.26}px ${SANS}`; q.fillText(sub, W / 2, H * 0.8, W * 0.94); }
    });
    hang(g, m, p[0], p[1], p[2], e.nx, e.nz, 0.02);
  };
  put('SHOPPERS DRUG MART', null, null, '#d6202a', 8.5, 0.95, -3855.5, -1302.3, '800');
  put('BEERTOWN', 'PUBLIC HOUSE', '#141414', '#d9b25a', 6, 1.4, -3860, -1331, '800');
  put('PIPER ARMS', null, null, '#f1ead6', 6, 0.9, -3852, -1281, '700', SERIF);
  put('your independent grocer', null, '#ffffff', '#d21f26', 9, 1.25, -3954, -1325, '800');
  put('WATERLOO TOWN SQUARE', null, null, '#f2f2f2', 13, 1.25, -3925, -1230, '700');
}

// THE MARSLAND CENTRE, 20 Erb St W (Carl Rieder, 1971-74; OSM 89585912):
// Uptown's tower, 13 storeys and 52 m (OSM), the BMO tower to everyone --
// tan precast fins running the full height over dark brown spandrels, the
// BMO roundel near the top, a two-storey wing west and a four-storey east.
const MARSLAND = [[-3978.3, -1476.1], [-3966.0, -1456.2], [-3937.8, -1472.9], [-3950.1, -1492.8]];
const MARSLAND_W = [[-3986.0, -1471.6], [-3978.3, -1476.1], [-3966.0, -1456.2], [-3974.0, -1451.5], [-3982.4, -1465.6]];
const MARSLAND_E = [[-3950.1, -1492.8], [-3938.6, -1499.7], [-3926.6, -1479.5], [-3937.8, -1472.9]];
// The Uptown Waterloo Parkade, 60 King St S (OSM 149976265): five levels, across King from the square
const PARKADE = [[-3748.9, -1310.3], [-3716.5, -1316.8], [-3723.7, -1352.5], [-3725.7, -1362.1], [-3789.1, -1349.4], [-3788.2, -1344.9],
  [-3792.9, -1343.9], [-3786.7, -1313.1], [-3757.3, -1319.0], [-3754.6, -1319.5], [-3751.0, -1320.3]];

/** A plain block of `floors` storeys with a dark window band per floor (the Marsland's wings). */
function bandBlock(B, ctx, pts, y0, floors, st, wall, win) {
  const yTop = y0 + floors * st + 0.6;
  for (const e of edges(pts)) {
    const N = [e.nx, 0, e.nz];
    B.quad(e.at(0, y0 - 1.2), e.at(e.L, y0 - 1.2), e.at(e.L, yTop), e.at(0, yTop), N, U0, wall);
    for (let f = 0; f < floors; f++) {
      const ya = y0 + f * st + (f ? 1.0 : 0.6);
      B.quad(e.at(0.4, ya, 0.03), e.at(e.L - 0.4, ya, 0.03), e.at(e.L - 0.4, ya + st * 0.5, 0.03), e.at(0.4, ya + st * 0.5, 0.03), N, U0, win);
    }
    ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: y0 - 1.2, y1: yTop });
  }
  roof(B, pts, yTop, lin([0.36, 0.35, 0.34]));
}

function marsland(kit, ctx) {
  const L = ctx.atlas;
  let pts = MARSLAND.slice();
  if (polyArea(pts) < 0) pts.reverse();
  const [cx, cz] = centroid(pts);
  const B = kit.B(cx, cz), g = kit.grp(cx, cz);
  let lo = Infinity;
  for (const q of [...MARSLAND, ...MARSLAND_W, ...MARSLAND_E]) lo = Math.min(lo, T(q[0], q[1]));
  const y0 = lo, H = 52, yTop = y0 + H;
  // Commons (BMOTower-Waterloo.jpg, 2013; the 2025 station photo): precast
  // fins running the full height, alternately maroon-brown and light beige,
  // with dark slit windows between them; the BMO box sign at the top corner
  const SLIT = lin([0.16, 0.16, 0.18]), MAROON = lin(hex('#6f4846')), BEIGE = lin(hex('#c9c2b2')), LOBBY = lin([0.14, 0.17, 0.20]);
  const signs = [];
  for (const e of edges(pts)) {
    const N = [e.nx, 0, e.nz];
    B.quad(e.at(0, y0 - 1.2), e.at(e.L, y0 - 1.2), e.at(e.L, yTop), e.at(0, yTop), N, U0, SLIT);
    B.quad(e.at(0.8, y0, 0.05), e.at(e.L - 0.8, y0, 0.05), e.at(e.L - 0.8, y0 + 4.2, 0.05), e.at(0.8, y0 + 4.2, 0.05), N, U0, LOBBY);
    const nf = Math.round(e.L / 1.45);
    for (let k = 0; k <= nf; k++) {
      const t = e.L * k / nf, end = k === 0 || k === nf, w = end ? 1.1 : 0.8;
      const col = end || k % 2 ? MAROON : BEIGE;
      const ta = Math.max(0, t - w / 2), tb = Math.min(e.L, t + w / 2);
      B.quad(e.at(ta, y0 + 4.2, 0.32), e.at(tb, y0 + 4.2, 0.32), e.at(tb, yTop + 0.3, 0.32), e.at(ta, yTop + 0.3, 0.32), N, U0, col);
      B.quad(e.at(ta, y0 + 4.2, 0), e.at(ta, y0 + 4.2, 0.32), e.at(ta, yTop + 0.3, 0.32), e.at(ta, yTop + 0.3, 0), [-e.ux, 0, -e.uz], U0, shade(col, 0.8));
      B.quad(e.at(tb, y0 + 4.2, 0.32), e.at(tb, y0 + 4.2, 0), e.at(tb, yTop + 0.3, 0), e.at(tb, yTop + 0.3, 0.32), [e.ux, 0, e.uz], U0, shade(col, 0.8));
    }
    // the fins stand on a maroon band over the lobby; a maroon coping
    B.quad(e.at(-0.3, y0 + 4.2, 0.36), e.at(e.L + 0.3, y0 + 4.2, 0.36), e.at(e.L + 0.3, y0 + 5.0, 0.36), e.at(-0.3, y0 + 5.0, 0.36), N, U0, MAROON);
    B.quad(e.at(-0.3, yTop + 0.3, 0.36), e.at(e.L + 0.3, yTop + 0.3, 0.36), e.at(e.L + 0.3, yTop + 0.3, 0), e.at(-0.3, yTop + 0.3, 0), [0, 1, 0], U0, MAROON);
    ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.4, rot: Math.atan2(e.uz, e.ux), y0: y0 - 1.2, y1: yTop });
    signs.push(e);
  }
  // the BMO box sign at the top of the face toward King (the east), near its north corner, and round it
  signs.sort((a, b) => (b.nx * 1 + b.nz * 0) - (a.nx * 1 + a.nz * 0));
  for (const [e, tf] of [[signs[0], 0.8], [signs[1], 0.2]]) {
    if (!e) continue;
    const m = L.panel(6.4, 2.2, 36, (q, W, Hh) => {
      q.fillStyle = '#0079c1'; q.fillRect(0, 0, W, Hh);
      q.fillStyle = '#ffffff'; q.font = `800 ${Hh * 0.6}px ${SANS}`; q.textBaseline = 'middle'; q.textAlign = 'center';
      q.fillText('BMO', W * 0.42, Hh * 0.55);
      q.fillStyle = '#e31837'; q.beginPath(); q.arc(W * 0.78, Hh / 2, Hh * 0.3, 0, Math.PI * 2); q.fill();
      q.fillStyle = '#ffffff'; q.font = `800 ${Hh * 0.34}px ${SANS}`; q.fillText('M', W * 0.78, Hh * 0.53);
    });
    const p = e.at(Math.min(e.L - 3.6, Math.max(3.6, e.L * tf)), yTop - 1.4, 0.45);
    B.box(p[0], yTop - 2.6, p[2], 6.6, 2.4, 0.3, Math.atan2(e.uz, e.ux), lin(hex('#0079c1')));
    hang(g, m, p[0], p[1], p[2], e.nx, e.nz, 0.17);
  }
  roof(B, pts, yTop + 0.3, lin([0.34, 0.33, 0.32]));
  B.box(cx, yTop + 0.3, cz, 10, 3.2, 7, Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]), lin([0.40, 0.33, 0.30]));
  // the wings: dark mirror glass (BMO Nesbitt Burns on the east one)
  const WING = lin([0.20, 0.22, 0.24]), WIN = lin([0.34, 0.40, 0.45]);
  for (const [p, fl] of [[MARSLAND_W, 2], [MARSLAND_E, 4]]) {
    const q = polyArea(p) < 0 ? p.slice().reverse() : p;
    bandBlock(kit.B(...centroid(q)), ctx, q, y0, fl, 3.8, WING, WIN);
  }
  const qe = polyArea(MARSLAND_E) < 0 ? MARSLAND_E.slice().reverse() : MARSLAND_E;
  const ee = edges(qe).sort((a, b) => b.nx - a.nx)[0];
  if (ee) {
    const m = L.panel(5, 0.6, 40, (q, W, Hh) => {
      q.fillStyle = '#0079c1'; q.fillRect(0, 0, W, Hh);
      q.fillStyle = '#ffffff'; q.font = `700 ${Hh * 0.6}px ${SANS}`; q.textBaseline = 'middle'; q.textAlign = 'center';
      q.fillText('BMO Nesbitt Burns', W / 2, Hh * 0.55, W * 0.94);
    });
    const p = ee.at(ee.L / 2, y0 + 4 * 3.8 - 0.2, 0.05);
    hang(g, m, p[0], p[1], p[2], ee.nx, ee.nz, 0.03);
  }
}

/**
 * The Uptown Waterloo Parkade (Commons UptownParkade-Waterloo.jpg): buff brick
 * on every face, cream precast pilasters and the cream arches of the top deck,
 * square openings on the decks below, and at the King St face's south end the
 * blue glass stair tower with its pyramid cap and UPTOWN PARKADE on a blue fascia.
 */
function parkade(kit, ctx) {
  const city = ctx.city, L = ctx.atlas;
  let pts = PARKADE.slice();
  if (polyArea(pts) < 0) pts.reverse();
  const [cx, cz] = centroid(pts);
  const B = kit.B(cx, cz), g = kit.grp(cx, cz);
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const y0 = lo, st = 3.0, lv = 5, yTop = y0 + (lv - 1) * st + 1.4;
  const BUFF = lin(hex('#d3ae7d')), CREAM = lin(hex('#e8dcc2')), DARK = lin([0.10, 0.10, 0.11]), BLUE = lin(hex('#2f5fa8'));
  let kingE = null;
  for (const e of edges(pts)) {
    const N = [e.nx, 0, e.nz];
    B.quad(e.at(0, y0 - 1.2), e.at(e.L, y0 - 1.2), e.at(e.L, yTop), e.at(0, yTop), N, U0, BUFF);
    B.quad(e.at(-0.2, yTop, 0.25), e.at(e.L + 0.2, yTop, 0.25), e.at(e.L + 0.2, yTop + 0.5, 0.25), e.at(-0.2, yTop + 0.5, 0.25), N, U0, CREAM);
    ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.4, rot: Math.atan2(e.uz, e.ux), y0: y0 - 1.2, y1: yTop });
    if (e.L < 4) continue;
    const s = street(city, e.mx + e.nx * 3, e.mz + e.nz * 3, 30, /^King Street/);
    const onKing = s && e.L > 20 && s.kerb < 14 && ((s.qx - e.mx) * e.nx + (s.qz - e.mz) * e.nz) / (Math.hypot(s.qx - e.mx, s.qz - e.mz) || 1) > 0.6;
    if (onKing && (!kingE || e.L > kingE.L)) kingE = e;
    // bays between cream pilasters; openings per deck, arches on the top one
    const nb = Math.max(1, Math.round(e.L / 8.5)), bw = e.L / nb;
    for (let k = 0; k <= nb; k++) {
      const t = k * bw, ta = Math.max(0, t - 0.45), tb = Math.min(e.L, t + 0.45);
      B.quad(e.at(ta, y0 - 0.5, 0.18), e.at(tb, y0 - 0.5, 0.18), e.at(tb, yTop, 0.18), e.at(ta, yTop, 0.18), N, U0, CREAM);
    }
    for (let k = 0; k < nb; k++) {
      const a = k * bw + 0.8, b2 = (k + 1) * bw - 0.8;
      for (let l = 0; l < lv - 1; l++) {
        const ya = y0 + l * st + 1.0, yb = ya + 1.5;
        const n = Math.max(1, Math.round((b2 - a) / 1.8));
        for (let i = 0; i < n; i++) {
          const ca = a + (b2 - a) * i / n + 0.25, cb = a + (b2 - a) * (i + 1) / n - 0.25;
          B.quad(e.at(ca, ya, 0.03), e.at(cb, ya, 0.03), e.at(cb, yb, 0.03), e.at(ca, yb, 0.03), N, U0, DARK);
        }
      }
      // the top deck: a cream arch over the bay, open below it
      const ya = y0 + (lv - 1) * st - 1.6, tm = (a + b2) / 2, r = (b2 - a) / 2;
      B.quad(e.at(a, ya, 0.03), e.at(b2, ya, 0.03), e.at(b2, ya + 1.3, 0.03), e.at(a, ya + 1.3, 0.03), N, U0, DARK);
      for (let i = 0; i < 8; i++) {
        const a0 = Math.PI * i / 8, a1 = Math.PI * (i + 1) / 8;
        B.tri(e.at(tm, ya + 1.3, 0.03), e.at(tm + Math.cos(a0) * r, ya + 1.3 + Math.sin(a0) * r * 0.55, 0.03), e.at(tm + Math.cos(a1) * r, ya + 1.3 + Math.sin(a1) * r * 0.55, 0.03), N, DARK);
        const o0 = [tm + Math.cos(a0) * (r + 0.5), ya + 1.3 + Math.sin(a0) * (r * 0.55 + 0.5)], o1 = [tm + Math.cos(a1) * (r + 0.5), ya + 1.3 + Math.sin(a1) * (r * 0.55 + 0.5)];
        B.quad(e.at(tm + Math.cos(a0) * r, ya + 1.3 + Math.sin(a0) * r * 0.55, 0.06), e.at(tm + Math.cos(a1) * r, ya + 1.3 + Math.sin(a1) * r * 0.55, 0.06), e.at(o1[0], o1[1], 0.06), e.at(o0[0], o0[1], 0.06), N, U0, CREAM);
      }
    }
  }
  roof(B, pts, y0 + (lv - 1) * st, lin([0.44, 0.44, 0.43]));
  // the stair tower at the King face's south end
  if (kingE) {
    const tS = kingE.at(3.2, 0)[2] > kingE.at(kingE.L - 3.2, 0)[2] ? 3.2 : kingE.L - 3.2;   // larger z is south
    const p = kingE.at(tS, 0, 1.6), rot = Math.atan2(kingE.uz, kingE.ux);
    const yT = yTop + 5.5;
    B.box(p[0], y0 - 1, p[2], 5.4, yT - y0 + 1, 3.6, rot, BLUE);
    for (const d of [-2.95, 2.95]) {
      const q = kingE.at(tS + d, 0, 1.6);
      B.box(q[0], y0 - 1, q[2], 0.9, yT - y0 + 1.3, 3.9, rot, BUFF);
    }
    // mullions on the glass
    for (let y = y0 + 4.6; y < yT; y += 1.4) {
      const q = kingE.at(tS, 0, 3.42);
      B.box(q[0], y, q[2], 5.2, 0.08, 0.05, rot, lin([0.75, 0.80, 0.86]));
    }
    // the pyramid cap
    const c = Math.cos(rot), sn = Math.sin(rot), hx = 3.2, hz = 2.2;
    const P = (lx, lz, y) => [p[0] + lx * c - lz * sn, y, p[2] + lx * sn + lz * c];
    const apex = P(0, 0, yT + 2.6), Cs = [P(-hx, -hz, yT + 0.3), P(hx, -hz, yT + 0.3), P(hx, hz, yT + 0.3), P(-hx, hz, yT + 0.3)];
    for (let i = 0; i < 4; i++) {
      const a = Cs[i], b2 = Cs[(i + 1) % 4], mx = (a[0] + b2[0]) / 2 - p[0], mz = (a[2] + b2[2]) / 2 - p[2], ml = Math.hypot(mx, mz) || 1;
      B.tri(a, b2, apex, [mx / ml * 0.7, 0.7, mz / ml * 0.7], lin(hex('#3a6ab0')));
    }
    B.box(p[0], yT, p[2], 6.6, 0.3, 4.6, rot, BUFF);
    // the fascia
    const f = kingE.at(tS, 0, 3.5), gy = walkY(city, f[0] + kingE.nx, f[2] + kingE.nz);
    B.box(f[0], gy + 3.4, f[2], 6.2, 0.9, 0.5, rot, lin(hex('#1d4f9c')));
    const w = L.panel(5.8, 0.75, 40, (q, W, Hh) => {
      q.fillStyle = '#1d4f9c'; q.fillRect(0, 0, W, Hh);
      q.fillStyle = '#ffffff'; q.font = `800 ${Hh * 0.62}px ${SANS}`; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.fillText('UPTOWN PARKADE', W / 2, Hh * 0.55, W * 0.95);
    });
    hang(g, w, f[0], gy + 3.85, f[2], kingE.nx, kingE.nz, 0.27);
    ctx.solids.push({ x: p[0], z: p[2], hw: 2.8, hd: 1.9, rot, y0: y0 - 1, y1: yT });
  }
}


/**
 * THE SEAGRAM LOFTS, 3 and 5 Father David Bauer Dr: Seagram's barrel
 * warehouses (1905 and 1907) in buff Waterloo brick, lofts since 2001 (Commons
 * Category:Seagram Lofts, 2004-2025; the Heritage Register): rows of small
 * segmental-headed windows with blue-grey shutters, a corbelled brick cornice,
 * and on top the 2001 penthouse floors in beige stucco, set back behind a
 * railing, with black steel pergola frames. The painted sign -- two navy
 * bands, SEAGRAM / DISTILLERS / SINCE 1857 in gold, a protected heritage
 * feature -- is high on No. 3's east face, toward Caroline St.
 */
function seagram(kit, ctx) {
  const L = ctx.atlas;
  const BUFF = lin(hex('#bdb196')), DARK = lin(hex('#a09479')), WIN = lin([0.14, 0.15, 0.16]), SILL = lin(hex('#d6ccb4'));
  const SHUT = lin(hex('#4f6c78')), STUCCO = lin(hex('#cdb98f')), STEEL = lin([0.06, 0.06, 0.06]);
  for (const key of ['seagram3', 'seagram5']) {
    let pts = P[key].p;
    if (polyArea(pts) < 0) pts = pts.slice().reverse();
    const [cx, cz] = centroid(pts);
    const B = kit.B(cx, cz), g = kit.grp(cx, cz);
    const st = 3.3, brick = key === 'seagram3' ? 5 : 6, pent = key === 'seagram3' ? 2 : 3;
    const base = T(cx, cz), yTop = base + brick * st + 1.4;
    let lo = Infinity;
    for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
    const E = edges(pts);
    // the painted sign: No. 3's face toward Caroline St (east of it)
    let signE = null, sk = -Infinity;
    if (key === 'seagram3') {
      for (const e of E) {
        if (e.L < 8) continue;
        const k = e.nx;   // east
        if (k > sk) { sk = k; signE = e; }
      }
    }
    for (const e of E) {
      const N = [e.nx, 0, e.nz];
      B.quad(e.at(0, lo - 1.2), e.at(e.L, lo - 1.2), e.at(e.L, yTop + 0.6), e.at(0, yTop + 0.6), N, U0, [DARK, DARK, BUFF, BUFF]);
      // the corbelled cornice: three courses stepping out
      for (let s = 0; s < 3; s++) {
        const y = yTop - 0.9 + s * 0.25, d = 0.1 * (s + 1);
        B.quad(e.at(0, y, d), e.at(e.L, y, d), e.at(e.L, y + 0.25, d), e.at(0, y + 0.25, d), N, U0, s === 2 ? BUFF : DARK);
      }
      ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: lo - 1.2, y1: yTop + 0.6 });
      const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
      const sgn = e === signE;
      const nw = Math.max(1, Math.floor((e.L - 1.5) / 2.6)), pad = (e.L - nw * 2.6) / 2;
      for (let f = 0; f < brick; f++) {
        const y0 = gy + 1.0 + f * st;
        if (y0 + 1.5 > yTop - 1.0) break;
        if (sgn && f >= brick - 2) continue;   // the painted sign's field
        for (let i = 0; i < nw; i++) {
          const t = pad + 2.6 * (i + 0.5);
          B.quad(e.at(t - 0.42, y0, 0.04), e.at(t + 0.42, y0, 0.04), e.at(t + 0.42, y0 + 1.45, 0.04), e.at(t - 0.42, y0 + 1.45, 0.04), N, U0, WIN);
          B.tri(e.at(t - 0.55, y0 + 1.45, 0.05), e.at(t + 0.55, y0 + 1.45, 0.05), e.at(t, y0 + 1.75, 0.05), N, DARK);
          B.quad(e.at(t - 0.52, y0 - 0.12, 0.07), e.at(t + 0.52, y0 - 0.12, 0.07), e.at(t + 0.52, y0, 0.07), e.at(t - 0.52, y0, 0.07), N, U0, SILL);
          for (const s of [-1, 1]) B.quad(e.at(t + s * 0.46, y0, 0.08), e.at(t + s * 0.88, y0, 0.08), e.at(t + s * 0.88, y0 + 1.45, 0.08), e.at(t + s * 0.46, y0 + 1.45, 0.08), N, U0, SHUT);
        }
      }
      if (sgn) {
        const w = Math.min(e.L - 2, 24), h = st * 1.9;
        const m = L.panel(w, h, 14, (q, W, H) => {
          q.clearRect(0, 0, W, H);
          q.fillStyle = '#2e3550';
          q.fillRect(0, 0, W, H * 0.44); q.fillRect(0, H * 0.5, W, H * 0.5);
          q.fillStyle = '#c9a44c'; q.textAlign = 'center'; q.textBaseline = 'middle';
          q.font = `800 ${H * 0.34}px ${SERIF}`;
          q.fillText('SEAGRAM', W / 2, H * 0.24, W * 0.92);
          q.fillText('DISTILLERS', W / 2, H * 0.7, W * 0.92);
          q.font = `700 ${H * 0.09}px ${SERIF}`;
          q.fillText('SINCE 1857', W / 2, H * 0.93, W * 0.5);
        });
        const p = e.at(e.L / 2, yTop - 1.1 - h / 2, 0.12);
        hang(g, m, p[0], p[1], p[2], e.nx, e.nz, 0.02);
        STATS.seagramSign = [Math.round(p[0]), Math.round(p[1]), Math.round(p[2]), +e.nx.toFixed(2), +e.nz.toFixed(2), w, h];
      }
    }
    roof(B, pts, yTop + 0.6, lin([0.34, 0.33, 0.32]));
    // the penthouse floors: set back 1.8 m, beige stucco, big lofts' windows, a railing, black pergola frames
    const o = obb(pts);
    if (o) {
      const hu = o.hu - 1.8, hv = o.hv - 1.8, rot = Math.atan2(o.uz, o.ux);
      const yP = yTop + 0.6, hP = pent * 3.2;
      B.box(o.x, yP, o.z, hu * 2, hP, hv * 2, rot, STUCCO);
      const vx = -o.uz, vz = o.ux;
      const faces = [[vx, vz, o.ux, o.uz, hv, hu], [-vx, -vz, o.ux, o.uz, hv, hu], [o.ux, o.uz, vx, vz, hu, hv], [-o.ux, -o.uz, vx, vz, hu, hv]];
      for (const [nx, nz, ax, az, d, len] of faces) {
        for (let f = 0; f < pent; f++) {
          for (let t = -len + 2.5; t < len - 2.0; t += 5.0) {
            const px = o.x + nx * (d + 0.03) + ax * t, pz = o.z + nz * (d + 0.03) + az * t, y = yP + 0.7 + f * 3.2;
            B.quad([px - ax * 0.9, y, pz - az * 0.9], [px + ax * 0.9, y, pz + az * 0.9], [px + ax * 0.9, y + 1.9, pz + az * 0.9], [px - ax * 0.9, y + 1.9, pz - az * 0.9], [nx, 0, nz], U0, WIN);
          }
        }
        // the railing at the setback's edge, pergola posts and beams on the terrace
        const rx = o.x + nx * (d + 1.7), rz = o.z + nz * (d + 1.7), L2 = (len + 1.8) * 2;
        B.box(rx, yP + 1.0, rz, L2, 0.06, 0.06, Math.atan2(az, ax), STEEL);
        for (let t = -len + 1; t < len - 0.5; t += 4.5) {
          const px = o.x + nx * (d + 1.0) + ax * t, pz = o.z + nz * (d + 1.0) + az * t;
          B.box(px, yP, pz, 0.2, 3.0, 0.2, 0, STEEL);
          B.box(px - nx * 0.5, yP + 2.9, pz - nz * 0.5, 0.18, 0.2, 0.18, 0, STEEL);
          B.box(o.x + nx * (d + 0.5) + ax * t, yP + 2.95, o.z + nz * (d + 0.5) + az * t, 0.16, 0.16, 0.16, 0, STEEL);
        }
        // a beam along the pergola line
        B.box(o.x + nx * (d + 1.0), yP + 2.95, o.z + nz * (d + 1.0), len * 2, 0.16, 0.16, Math.atan2(az, ax), STEEL);
      }
      ctx.solids.push({ x: o.x, z: o.z, hw: hu, hd: hv, rot, y0: yP, y1: yP + hP });
    }
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
// skylights and Zehrs' solar roof, measured off the aerial (Esri World Imagery, 2026)
const MALL_COURTS = [[-4241, -5125], [-4168, -5122]];
const MALL_CLERESTORY = [[-4239, -5207, -5051]];
const ZEHRS_SOLAR = [-4108, -5045, -4012, -4950];
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
  // the concourse skylights, from the aerial (Esri World Imagery, 2026): the
  // two octagonal courts where the corridors cross, a glazed clerestory down
  // the north-south corridor, and Zehrs' roof covered in solar panels
  const o = obb(pts);
  const SKY = lin([0.34, 0.44, 0.50]), FRM = lin([0.80, 0.80, 0.78]);
  for (const [x, z] of MALL_COURTS) {
    B.prism(x, yTop, z, 6.2, 1.8, 8, FRM, Math.PI / 8);
    B.cone(x, yTop + 1.8, z, 6.4, 3.4, 8, SKY);
    B.cone(x, yTop + 1.79, z, 6.4, 0.01, 8, FRM);
  }
  for (const [x, z0, z1] of MALL_CLERESTORY) {
    for (let z = z0; z < z1; z += 9) {
      if (MALL_COURTS.some(([cx, cz]) => Math.hypot(cx - x, cz - z - 3.5) < 9)) continue;
      B.box(x, yTop, z + 3.5, 4.5, 1.3, 7, 0, SKY);
      B.box(x, yTop + 1.3, z + 3.5, 5, 0.25, 7.6, 0, FRM);
    }
  }
  {
    const [x0, z0, x1, z1] = ZEHRS_SOLAR, PV = lin([0.10, 0.13, 0.22]), PVF = lin([0.55, 0.56, 0.58]);
    for (let z = z0; z < z1; z += 3.2) for (let x = x0; x < x1; x += 5.2) {
      if (!inPoly(pts, x, z) || !inPoly(pts, x + 4.6, z + 2)) continue;
      // a south-facing tilted panel row
      B.quad([x, yTop + 0.4, z + 2], [x + 4.8, yTop + 0.4, z + 2], [x + 4.8, yTop + 1.1, z + 0.2], [x, yTop + 1.1, z + 0.2], [0, 0.93, 0.36], U0, PV);
      B.quad([x, yTop + 0.02, z + 0.2], [x + 4.8, yTop + 0.02, z + 0.2], [x + 4.8, yTop + 1.1, z + 0.2], [x, yTop + 1.1, z + 0.2], [0, 0, -1], U0, PVF);
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
// Uptown's researched buildings (kwuptown.js) build inside the uptown run: same kit, same atlas, no new draws
const UPTOWN_EXTRA = [];
export function addUptown(fn) { UPTOWN_EXTRA.push(fn); }
export function placesData() { return P; }
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
    marsland(kit, ctx);
    parkade(kit, ctx);
    for (const fn of UPTOWN_EXTRA) fn(kit, ctx);
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
  STATS.atlas = { y: PA.y + PA.row, full: PA.full };
  PA.finish();
  if (typeof window !== 'undefined') window.__kwPlaces = STATS;   // harness probes
}
export function placesStats() { return STATS; }
/** Waterloo Public Square's rink for skating.js: the outline, centre, long axis, half sizes, corner radius and the ice's height. */
export function rinkData() {
  return { pts: RINK, c: RINK_C, u: RINK_U, hl: RINK_HL, hw: RINK_HW, r: RINK_R, y: STATS.rink ? STATS.rink.y : null };
}

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

// The kit and helpers kwsights.js (downtown Kitchener, Cambridge, the malls...)
// builds with: one shared pair of materials, so a cluster holding both stays
// one draw per material.
export {
  inPoly, polyArea, centroid, obb, simplify, edges, street, walkY, hang, PlaceAtlas, Kit, roof, wallSolids, gabled,
  lin, shade, hex, meshKing, KING_SKIP, signPanel, gazebo, tree, squareLight, SANS, SERIF, U0, T,
};
