// WATERLOO REGION'S LOCAL LAYER, on top of the imported city.
//
// data/kw.json (tools/kw/build_kw.py) names things the boxes cannot: which
// box is the Dana Porter Library, which storefront in the plaza at University
// and Bridge is the FreshCo, where every Tim Hortons is. This module
//
//   1. finds the box each named building became (applyNamed, before any chunk
//      is meshed) and gives the ones LOOKS knows their real height and
//      material (world.buildingFamily reads `bd.kw.fam`);
//   2. hangs the signs (buildSigns, a landmarks.js extra, so they merge into
//      the landmark clusters and cull with them): campus nameplates, school
//      signs, the storefronts in the detail zones, and every Tim Hortons and
//      FreshCo -- each store's sign on the face of its building nearest the
//      store, a pylon at the road for a stand-alone one, and a whole small
//      store where OSM maps the shop but no building;
//   3. lists the map's places (mapPlaces): every Tims and FreshCo, labelled.

import * as THREE from './three.js';
import * as G from './geo.js';
import { hash2 } from './util.js';

let KW = null;
export function setKwData(d) { KW = d; }
export function kwData() { return KW; }

// --- the boxes ----------------------------------------------------------------

/** Local frame of a building box: (lx along w, lz along d), as world.js's off(). */
function toLocal(b, x, z) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.x, dz = z - b.z;
  return [dx * c + dz * s, -dx * s + dz * c];
}
function toWorld(b, lx, lz) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return [b.x + lx * c - lz * s, b.z + lx * s + lz * c];
}
/** The box holding (x, z) (within pad), smallest first; else null. */
export function boxAt(city, x, z, pad = 0) {
  let best = null, ba = Infinity;
  for (const b of city.buildingsNear(x, z, 60)) {
    const [lx, lz] = toLocal(b, x, z);
    if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(lz) <= b.d / 2 + pad && b.w * b.d < ba) { best = b; ba = b.w * b.d; }
  }
  return best;
}

// --- real looks -------------------------------------------------------------------
// Families as world.buildingFamily's: m = material cell, c = colour, u/v = tile metres.
const CONCRETE = { m: 'masonry', c: [0.74, 0.72, 0.68], u: 14, v: 13.6 };
const BRUT = { m: 'masonry', c: [0.66, 0.64, 0.60], u: 14, v: 13.6 };          // board-formed 1960s concrete
const BUFF = { m: 'brick', c: [0.86, 0.74, 0.52], u: 12, v: 12 };
const RED = { m: 'brick', c: [0.74, 0.36, 0.27], u: 12, v: 12 };
const BROWN = { m: 'brick', c: [0.55, 0.33, 0.25], u: 12, v: 12 };
const GLASS = { m: 'glass', c: [0.50, 0.60, 0.68], u: 14, v: 13.6 };
const DARKGLASS = { m: 'glass', c: [0.40, 0.46, 0.52], u: 14, v: 13.6 };
const WHITE = { m: 'masonry', c: [0.92, 0.91, 0.88], u: 13, v: 13 };

// name -> { h: metres, fam, style }. Heights are storeys x ~4 m where the
// research found no survey figure. Keyed by OSM's name exactly.
export const LOOKS = {
  // University of Waterloo
  'Dana Porter Library': { h: 46, fam: BRUT },
  'Mathematics & Computer': { h: 26, fam: BRUT },
  'Mathematics 3': { h: 16, fam: GLASS },
  'Mike & Ophelia Lazaridis Quantum Nano Centre': { h: 30, fam: GLASS },
  'Student Life Centre': { h: 12, fam: BUFF },
  'Physical Activities Complex': { h: 15, fam: BUFF },
  'Ira G. Needles Hall': { h: 20, fam: CONCRETE },
  'J. G. Hagey Hall of the Humanities': { h: 13, fam: BROWN },
  'Modern Languages': { h: 13, fam: BRUT },
  'Douglas Wright Engineering Building': { h: 14, fam: BRUT },
  'Carl A. Pollock Hall': { h: 16, fam: BRUT },
  'Engineering 2': { h: 16, fam: BUFF },
  'Engineering 3': { h: 13, fam: BUFF },
  'Engineering 5': { h: 26, fam: RED },
  'Engineering 6': { h: 26, fam: RED },
  'Engineering 7': { h: 30, fam: DARKGLASS },
  'Pearl Sullivan Engineering Building': { h: 30, fam: DARKGLASS },
  'Physics': { h: 14, fam: BRUT },
  'Biology 1': { h: 13, fam: BRUT },
  'Biology 2': { h: 13, fam: BRUT },
  'Chemistry 2': { h: 16, fam: BRUT },
  'Earth Sciences & Chemistry': { h: 13, fam: BRUT },
  'Science Teaching Complex': { h: 20, fam: GLASS },
  'Centre for Environmental and Information Technology': { h: 22, fam: BUFF },
  'Environment 1': { h: 12, fam: BUFF },
  'Environment 2': { h: 9, fam: BUFF },
  'Environment 3': { h: 16, fam: GLASS },
  'Arts Lecture Hall': { h: 9, fam: CONCRETE },
  'Federation Hall': { h: 9, fam: RED },
  'Health Services': { h: 9, fam: BUFF },
  'South Campus Hall': { h: 12, fam: BUFF },
  'Renison University College': { h: 12, fam: BUFF },
  "St. Jerome's University": { h: 14, fam: BUFF },
  'Columbia Icefield': { h: 11, fam: WHITE },
  // Wilfrid Laurier University
  'Arts Building': { h: 15, fam: RED },
  'Peters Building': { h: 16, fam: RED },
  'Frank C. Peters Building': { h: 16, fam: RED },
  'Lazaridis Hall': { h: 28, fam: GLASS },
  'Bricker Academic Building': { h: 16, fam: RED },
  'Science Building': { h: 15, fam: RED },
  'Library': { h: 22, fam: RED },
  'Athletic Complex': { h: 12, fam: RED },
  'Fred Nichols Campus Centre': { h: 13, fam: RED },
  'Dr. Alvin Woods Building': { h: 15, fam: RED },
  'Schlegel Centre for Entrepreneurship': { h: 12, fam: RED },
  // the schools
  'St. David Catholic Secondary School': { h: 10, fam: BUFF },
  'St. Matthew Catholic Elementary School': { h: 7, fam: BUFF },
};

// Which campus a point is on, for the nameplates' colours.
const CAMPUS_SIGN = {
  uw: { bg: '#141414', fg: '#ffffff', bar: '#fed34c' },          // Waterloo black and gold
  wlu: { bg: '#330072', fg: '#ffffff', bar: '#f2a900' },         // Laurier purple and gold
  con: { bg: '#0b2d4a', fg: '#ffffff', bar: '#7ab800' },         // Conestoga navy
  school: { bg: '#123a6b', fg: '#ffffff', bar: '#d7a72a' },
};
function campusOf(x, z) {
  if (x > -6900 && x < -4900 && z > -3200 && z < -1600) return 'uw';
  if (x > -4500 && x < -3900 && z > -2800 && z < -2100) return 'wlu';
  if (x > 4800 && x < 6400 && z > 6200 && z < 7600) return 'con';
  return null;
}

/**
 * Give every named box its name, and the ones LOOKS knows their look. Before
 * world.js meshes a chunk or builds the skyline: both read bd.h and the family.
 */
export function applyNamed(city) {
  if (!KW) return { named: 0, looks: 0 };
  let named = 0, looks = 0;
  for (const [n, x, z, bt] of KW.named) {
    const b = boxAt(city, x, z, 2);
    if (!b) continue;
    // the biggest name wins a shared box (a wing and its hall)
    if (!b.kw) { b.kw = { name: n, bt }; named++; }
    const L = LOOKS[n];
    if (L && !b.kw.fam) {
      b.kw.name = n; b.kw.bt = bt;
      b.kw.fam = L.fam;
      if (L.h) b.h = L.h;
      if (b.style === 'house' || b.style === 'industrial') b.style = 'campus';
      looks++;
    }
  }
  const strips = markStrips(city);
  return { named, looks, strips };
}

/**
 * Every low commercial box becomes a strip plaza unit (world._stripMall):
 * one storey, its storefront on the face toward the road. A box world.js
 * styles 'brick' under 7.5 m and over 200 m2 is a store in Waterloo Region
 * (build_buildings.py gives untagged retail 6 m); a named campus building is not.
 */
function markStrips(city) {
  let n = 0;
  for (const b of city.buildings) {
    if (b.style !== 'brick' || b.h > 7.5 || b.w * b.d < 200 || b.w < 8 || b.d < 8) continue;
    if (b.kw && (b.kw.fam || campusOf(b.x, b.z))) continue;
    const f = faceFor(city, b, b.x, b.z, 3, true);
    if (!f) continue;
    if (!b.kw) b.kw = {};
    b.kw.strip = { face: f.i };
    n++;
  }
  return n;
}

// --- signs ------------------------------------------------------------------------

/**
 * The face of box b to hang a sign on for a store at (px, pz): the face
 * nearest the point for a big building (a strip plaza: each store's sign over
 * its own door), the face nearest the road for a small one. Returns the
 * sign's world point at the wall, the outward normal, and the face's length.
 */
function faceFor(city, b, px, pz, signW, roadOnly = false) {
  const [lx, lz] = toLocal(b, px, pz);
  const hw = b.w / 2, hd = b.d / 2;
  const faces = [
    { n: [1, 0], c: [hw, 0], len: b.d, along: [0, 1] },
    { n: [-1, 0], c: [-hw, 0], len: b.d, along: [0, 1] },
    { n: [0, 1], c: [0, hd], len: b.w, along: [1, 0] },
    { n: [0, -1], c: [0, -hd], len: b.w, along: [1, 0] },
  ];
  const road = (x, z) => {
    let m = 80;
    for (const ei of city.edgesNear(x, z, 80)) {
      const e = city.edges[ei];
      if (e.elev || e.tunnel) continue;
      const a = city.nodes[e.a];
      const t = Math.max(0, Math.min(e.len, (x - a.x) * e.dx + (z - a.z) * e.dz));
      const d = Math.hypot(x - (a.x + e.dx * t), z - (a.z + e.dz * t)) - e.hw;
      if (d < m) m = d;
    }
    return m;
  };
  const big = !roadOnly && b.w * b.d > 900;
  // a strip plaza's signs hang on its fascia, on its storefront face
  const strip = !roadOnly && b.kw && b.kw.strip ? b.kw.strip.face : -1;
  let best = null, bs = Infinity;
  for (let fi = 0; fi < 4; fi++) {
    const f = faces[fi];
    if (strip >= 0 && fi !== strip) continue;
    if (f.len < Math.min(signW, 3) + 0.4) continue;
    // where along the face: the store's own spot on a big building
    const t = big ? (f.along[0] ? lx : lz) : 0;
    const half = Math.max(0, f.len / 2 - signW / 2 - 0.3);
    const tt = Math.max(-half, Math.min(half, t));
    const fx = f.c[0] + f.along[0] * tt, fz = f.c[1] + f.along[1] * tt;
    const [wx, wz] = toWorld(b, fx, fz);
    // score: distance from the store's point to the face, then to a road
    const dPoint = big ? Math.abs((f.n[0] ? lx - f.c[0] : lz - f.c[1])) : 0;
    const [ox, oz] = toWorld(b, fx + f.n[0] * 6, fz + f.n[1] * 6);
    let s = dPoint + road(ox, oz) * (big ? 0.35 : 1);
    if (roadOnly) {
      // a store faces its parking: count the car park in front of the face
      let park = 0;
      for (let k = 1; k <= 4; k++) for (let j = -2; j <= 2; j++) {
        const [qx, qz] = toWorld(b, f.c[0] + f.n[0] * (k * 8) + f.along[0] * j * f.len * 0.2,
          f.c[1] + f.n[1] * (k * 8) + f.along[1] * j * f.len * 0.2);
        if (G.lotAt(qx, qz) === 0) park++;
      }
      s -= park * 4;
    }
    if (s < bs) {
      bs = s;
      const c = Math.cos(b.rot), sn = Math.sin(b.rot);
      best = { x: wx, z: wz, nx: f.n[0] * c - f.n[1] * sn, nz: f.n[0] * sn + f.n[1] * c, len: f.len, i: fi, strip: fi === strip };
    }
  }
  return best;
}

const TIMS_RED = '#c8102e';
const SCRIPT = '"Brush Script MT", "Snell Roundhand", "Segoe Script", cursive';

/** A Tim Hortons sign: red, the name in white script. */
const SHARED = new Map();
/** One atlas cell for every sign that looks the same: a mesh sharing its geometry. */
function shared(key, make) {
  let m = SHARED.get(key);
  if (!m) SHARED.set(key, (m = make()));
  return m.clone();
}
function timsPanel(L, w, h) {
  return shared(`tims${w.toFixed(1)}x${h.toFixed(1)}`, () => L.panel(w, h, 44, (g, W, H) => {
    g.fillStyle = TIMS_RED; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `italic 700 ${H * 0.66}px ${SCRIPT}`;
    g.fillText('Tim Hortons', W / 2, H * 0.54, W * 0.94);
  }));
}
/** FreshCo: green, the name in heavy white with an orange leaf. */
function freshPanel(L, w, h) {
  return shared(`fresh${w.toFixed(1)}x${h.toFixed(1)}`, () => L.panel(w, h, 44, (g, W, H) => {
    g.fillStyle = '#4c9a2a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f39200';
    g.beginPath(); g.ellipse(W * 0.12, H * 0.42, H * 0.2, H * 0.11, -0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${H * 0.62}px Helvetica, Arial, sans-serif`;
    g.fillText('FreshCo', W * 0.56, H * 0.53, W * 0.8);
  }));
}
/** A campus or school nameplate: the name over a coloured bar. */
function namePanel(L, text, w, h, col) {
  return L.panel(w, h, 27, (g, W, H) => {
    g.fillStyle = col.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = col.bar; g.fillRect(0, H * 0.82, W, H * 0.18);
    g.fillStyle = col.fg;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = text.length > 26 && text.includes(' ') ? wrap(text) : [text];
    const fs = (H * 0.74 / lines.length) * 0.72;
    g.font = `600 ${fs}px Helvetica, Arial, sans-serif`;
    lines.forEach((l, i) => g.fillText(l, W / 2, H * 0.08 + (H * 0.74 / lines.length) * (i + 0.5), W * 0.94));
  });
}
function wrap(t) {
  const words = t.split(' '), half = t.length / 2;
  let acc = 0, k = 0;
  for (; k < words.length - 1; k++) { acc += words[k].length + 1; if (acc >= half) break; }
  return [words.slice(0, k + 1).join(' '), words.slice(k + 1).join(' ')];
}
// storefront colours by brand, else a palette by name
const BRAND_COL = {
  'Subway': ['#008c15', '#ffc600'], 'Rexall': ['#0b3e8a', '#ffffff'], '7-Eleven': ['#ffffff', '#00843d'],
  'Burger King': ['#d62300', '#ffc72c'], "McDonald's": ['#da291c', '#ffc72c'], 'Shoppers Drug Mart': ['#d71920', '#ffffff'],
  'Pizza Nova': ['#c8102e', '#ffffff'], 'Pizza Pizza': ['#ee3124', '#ffffff'], 'Esso': ['#ffffff', '#d6001c'],
  'Starbucks': ['#00704a', '#ffffff'], 'Domino\'s': ['#006491', '#ffffff'], 'A&W': ['#f26522', '#ffffff'],
  'Little Caesars': ['#f26a1b', '#ffffff'], 'Global Pet Foods': ['#00863e', '#ffffff'], 'New Orleans Pizza': ['#0a2c66', '#f5c400'],
  'LCBO': ['#1d1d1b', '#ffffff'], 'The Beer Store': ['#e2231a', '#ffffff'], 'Dollarama': ['#00843d', '#ffd200'],
  'Scotiabank': ['#ec111a', '#ffffff'], 'TD Canada Trust': ['#008a00', '#ffffff'], 'RBC': ['#005daa', '#ffd200'],
  'CIBC': ['#c41f3e', '#ffffff'], 'BMO': ['#0079c1', '#ffffff'], 'Shell': ['#fbce07', '#dd1d21'], 'Petro-Canada': ['#e01f2d', '#ffffff'],
};
const SHOP_PAL = [['#1f2a36', '#ffffff'], ['#7a1f24', '#ffffff'], ['#f4efe4', '#2a2a2a'], ['#21543d', '#ffffff'],
  ['#2c3e66', '#f0d36a'], ['#111111', '#e8c46a'], ['#c84b1e', '#ffffff'], ['#e9e1cf', '#7a1f24']];
function shopPanel(L, name, brand, w, h, seed) {
  const col = BRAND_COL[brand] || BRAND_COL[name] || SHOP_PAL[Math.floor(hash2(seed, 7) * SHOP_PAL.length)];
  return L.panel(w, h, 24, (g, W, H) => {
    g.fillStyle = col[0]; g.fillRect(0, 0, W, H);
    g.fillStyle = col[1];
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${H * 0.56}px Helvetica, Arial, sans-serif`;
    g.fillText(name, W / 2, H * 0.54, W * 0.92);
  });
}

const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.8, metalness: o.m ?? 0 });
const MATS = {};
function mats() {
  if (MATS.pole) return MATS;
  MATS.pole = M(0x6f7478, { r: 0.5, m: 0.6 });
  MATS.brick = M(0x8a5a44);
  MATS.trim = M(0xb3121b, { r: 0.6 });
  MATS.roof = M(0x3a3634);
  MATS.glass = M(0x2a3a44, { r: 0.15, m: 0.3 });
  MATS.base = M(0xb8b2a6);
  return MATS;
}

/** Hang a panel on a wall: centred at (x, y, z), facing (nx, nz). */
function hang(g, mesh, x, y, z, nx, nz, off = 0.14) {
  mesh.position.set(x + nx * off, y, z + nz * off);
  mesh.rotation.y = Math.atan2(nx, nz);
  g.add(mesh);
}

/** A pylon at the road: two posts and a lit box with the panel on both faces. */
function pylon(ctx, g, x, z, yaw, h, makePanel) {
  const m = mats();
  const y0 = G.terrainHeight(x, z);
  const W = 2.6, H = 1.4;
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, 0.22), m.pole);
    p.position.set(x + Math.cos(yaw) * s * (W / 2 - 0.25), y0 + h / 2, z - Math.sin(yaw) * s * (W / 2 - 0.25));
    g.add(p);
  }
  const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.4), m.trim);
  box.position.set(x, y0 + h + H / 2, z); box.rotation.y = yaw;
  g.add(box);
  for (const s of [1, -1]) {
    const pn = makePanel(W - 0.12, H - 0.12);
    const nx = Math.sin(yaw) * s, nz = Math.cos(yaw) * s;
    hang(g, pn, x, y0 + h + H / 2, z, nx, nz, 0.21);
  }
  ctx.solids.push({ x, z, r: 0.5, y0: y0 - 2, y1: y0 + h + H });
}

/**
 * A small stand-alone store where OSM has the shop and no building: brick,
 * a dark glass front, a red band and the sign. Faces the nearest road.
 */
function smallStore(ctx, g, x, z, yaw, makePanel) {
  const m = mats();
  const y0 = G.terrainHeight(x, z);
  const W = 15, D = 11, H = 5.2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H + 2, D), m.brick);
  body.position.set(x, y0 + H / 2 - 1, z); body.rotation.y = yaw; g.add(body);
  const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 1.0, D + 0.3), m.trim);
  band.position.set(x, y0 + H - 0.2, z); band.rotation.y = yaw; g.add(band);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.35, D + 0.6), m.roof);
  roof.position.set(x, y0 + H + 0.45, z); roof.rotation.y = yaw; g.add(roof);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 2.6, 0.1), m.glass);
  glass.position.set(x + fx * (D / 2 + 0.02), y0 + 1.6, z + fz * (D / 2 + 0.02)); glass.rotation.y = yaw; g.add(glass);
  hang(g, makePanel(6.5, 1.05), x + fx * (D / 2 + 0.16), y0 + H - 0.2, z + fz * (D / 2 + 0.16), fx, fz, 0.02);
  ctx.solids.push({ x, z, hw: W / 2, hd: D / 2, rot: -yaw, y0: y0 - 2, y1: y0 + H + 0.6 });
  return { x, z, y: y0 + H + 0.6 };
}

/** The heading (rotation.y) from (x, z) to the nearest street, or null. */
function faceRoad(city, x, z, r = 90) {
  let best = null, bd = r;
  for (const ei of city.edgesNear(x, z, r)) {
    const e = city.edges[ei];
    if (e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp') continue;
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(e.len, (x - a.x) * e.dx + (z - a.z) * e.dz));
    const qx = a.x + e.dx * t, qz = a.z + e.dz * t;
    const d = Math.hypot(x - qx, z - qz);
    if (d < bd) { bd = d; best = { yaw: Math.atan2(qx - x, qz - z), d, qx, qz, hw: e.hw }; }
  }
  return best;
}

/**
 * landmarks.js extra: every sign. `ctx` is buildLandmarks's
 * { addTo, solids, atlas, city, onRoad }.
 */
export function buildSigns(ctx) {
  if (!KW) return;
  const { addTo, atlas: L, city } = ctx;
  const key = (x, z) => `${Math.round(x / 1200)},${Math.round(z / 1200)}`;
  const groups = new Map();
  const grp = (x, z) => { const k = 'kw' + key(x, z); let g = groups.get(k); if (!g) groups.set(k, (g = new THREE.Group())); return g; };
  const stats = { tims: 0, timsStore: 0, timsBuilt: 0, fresh: 0, shops: 0, plates: 0 };
  const signedBoxes = new Set();
  const out = { tims: [], freshco: [] };

  const storeSign = (x, z, w, h, makePanel, opts = {}) => {
    const b = boxAt(city, x, z, 3);
    if (b && b.h > 3 && b.w * b.d < 60000) {
      const f = faceFor(city, b, x, z, w);
      if (f) {
        const g = grp(f.x, f.z);
        const top = b.y + b.h;
        const ty = G.terrainHeight(f.x + f.nx * 1.5, f.z + f.nz * 1.5);
        if (f.strip) {
          // on the fascia's face (world._stripMall: 1.8 m deep, 3.2-4.45 m up)
          hang(g, makePanel(Math.min(w, f.len - 0.6), Math.min(h, 1.05)), f.x, b.y + 3.82, f.z, f.nx, f.nz, 1.88);
          return { b, f };
        }
        const y = Math.min(top - h / 2 - 0.25, Math.max(ty + (opts.y || 3.6), b.y + 2.4));
        hang(g, makePanel(Math.min(w, f.len - 0.6), h), f.x, y, f.z, f.nx, f.nz);
        return { b, f };
      }
    }
    return null;
  };

  // Tim Hortons, every one
  for (const [x, z, addr] of KW.tims) {
    const mk = (w, h) => timsPanel(L, w, h);
    const r = storeSign(x, z, 5.2, 1.15, mk);
    let at = { x, z };
    if (r) {
      stats.tims++;
      signedBoxes.add(r.b);
      // a stand-alone Tims (a box under ~700 m2) gets its pylon at the road
      if (r.b.w * r.b.d < 700) {
        const rd = faceRoad(city, r.f.x, r.f.z, 70);
        if (rd && rd.d > rd.hw + 4) {
          const px = rd.qx - Math.sin(rd.yaw) * (rd.hw + 3.2), pz = rd.qz - Math.cos(rd.yaw) * (rd.hw + 3.2);
          if (!boxAt(city, px, pz, 1.5) && !city.onRoad(px, pz, 1.2, true)) {
            pylon(ctx, grp(px, pz), px, pz, rd.yaw + Math.PI / 2, 5.5, mk);
            stats.timsStore++;
          }
        }
      }
    } else {
      // no building: a small Tims of our own, if there is room
      const rd = faceRoad(city, x, z, 90);
      if (rd && !city.onRoad(x, z, 9, true) && !boxAt(city, x, z, 9)) {
        const s = smallStore(ctx, grp(x, z), x, z, rd.yaw, mk);
        at = s; stats.timsBuilt++;
      } else if (rd) {
        // in a lot or a forecourt: a pylon by the road says it is here
        const px = rd.qx - Math.sin(rd.yaw) * (rd.hw + 3.2), pz = rd.qz - Math.cos(rd.yaw) * (rd.hw + 3.2);
        if (!boxAt(city, px, pz, 1.5) && !city.onRoad(px, pz, 1.2, true)) pylon(ctx, grp(px, pz), px, pz, rd.yaw + Math.PI / 2, 5.5, mk);
      }
    }
    out.tims.push({ x: at.x, z: at.z, addr });
  }
  // FreshCo
  for (const [x, z, addr] of KW.freshco) {
    const mk = (w, h) => freshPanel(L, w, h);
    const r = storeSign(x, z, 9, 1.7, mk, { y: 4.2 });
    if (r) { stats.fresh++; signedBoxes.add(r.b); }
    out.freshco.push({ x, z, addr });
  }
  // the detail zones' storefronts
  const seen = new Set();
  for (const [n, x, z, kind, brand] of KW.shops) {
    if (/tim horton|freshco/i.test(n)) continue;
    const k = n + Math.round(x / 20) + ',' + Math.round(z / 20);
    if (seen.has(k)) continue;
    seen.add(k);
    const w = Math.max(2.6, Math.min(8, n.length * 0.42 + 1));
    const r = storeSign(x, z, w, 0.95, (ww, hh) => shopPanel(L, n, brand, ww, hh, Math.round(x * 7 + z)), { y: 3.4 });
    if (r) stats.shops++;
  }
  // campus nameplates and the schools: one per named box
  const plated = new Set();
  for (const b of city.buildings) {
    if (!b.kw || plated.has(b)) continue;
    const bt = b.kw.bt, n = b.kw.name;
    const camp = campusOf(b.x, b.z);
    const school = bt === 'school' || /Catholic (Elementary|Secondary) School|Public School|Collegiate|Secondary School/.test(n);
    if (!((camp && (bt === 'university' || bt === 'college' || bt === 'dormitory' || LOOKS[n])) || school)) continue;
    if (n.length > 60 || /^[A-Z]\d$/.test(n)) continue;
    plated.add(b);
    const col = school ? CAMPUS_SIGN.school : CAMPUS_SIGN[camp];
    const w = Math.max(3.2, Math.min(9, n.length * (n.length > 26 ? 0.24 : 0.36) + 1.2));
    const h = n.length > 26 ? 1.5 : 1.0;
    const f = faceFor(city, b, b.x, b.z, w);
    if (!f) continue;
    const ty = G.terrainHeight(f.x + f.nx * 1.5, f.z + f.nz * 1.5);
    const y = Math.min(b.y + b.h - h / 2 - 0.3, ty + 3.2);
    hang(grp(f.x, f.z), namePanel(L, n, w, h, col), f.x, y, f.z, f.nx, f.nz);
    stats.plates++;
  }
  for (const [k, g] of groups) addTo(k, g);
  stats.atlasFull = L.full || 0;
  stats.atlasY = L.y + L.row;
  KW.built = out;
  KW.signStats = stats;
}

/** The map's marked places: every Tims and FreshCo. */
export function mapPlaces() {
  if (!KW || !KW.built) return [];
  return [
    ...KW.built.tims.map((t) => ({ x: t.x, z: t.z, kind: 'tims', name: 'Tim Hortons', near: false, foot: true,
      hello: `Tim Hortons${t.addr ? `, ${t.addr}` : ''}. Double-double?` })),
    ...KW.built.freshco.map((t) => ({ x: t.x, z: t.z, kind: 'freshco', name: 'FreshCo', near: false, label: 'FreshCo',
      hello: `FreshCo${t.addr ? `, ${t.addr}` : ''}` })),
  ];
}
