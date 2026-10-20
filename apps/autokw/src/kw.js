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
import { Builder } from './build.js';

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

// The region's landmarks, each with a big sign high on its street face.
export const LM_SIGNS = {
  'Kitchener Memorial Auditorium': { text: 'THE AUD', sub: 'HOME OF THE KITCHENER RANGERS', bg: '#c8102e', fg: '#ffffff', w: 16 },
  'Kitchener City Hall': { text: 'KITCHENER CITY HALL', bg: '#1d2a3a', fg: '#ffffff', w: 16 },
  'Kitchener Market': { text: 'KITCHENER MARKET', bg: '#7a1f24', fg: '#f4e4c1', w: 12 },
  'Perimeter Institute for Theoretical Physics': { text: 'PERIMETER INSTITUTE', sub: 'FOR THEORETICAL PHYSICS', bg: '#111418', fg: '#ffffff', w: 14 },
  'CIGI Campus': { text: 'CIGI', sub: 'CENTRE FOR INTERNATIONAL GOVERNANCE INNOVATION', bg: '#2a2a2a', fg: '#ffffff', w: 12 },
  'The Tannery': { text: 'THE TANNERY', sub: 'COMMUNITECH · D2L', bg: '#3a2418', fg: '#f2c48a', fg2: '#ffffff', w: 14 },
  'Google': { text: 'Google', bg: '#ffffff', fg: '#4285f4', w: 10 },
  'Bingemans Conference Centre': { text: 'BINGEMANS', bg: '#1a3a8a', fg: '#ffd23a', w: 14 },
  'Fairview Park': { text: 'CF FAIRVIEW PARK', bg: '#ffffff', fg: '#1d2a3a', w: 16 },
  'Cambridge Mill': { text: 'CAMBRIDGE MILL', bg: '#3a2a20', fg: '#f4e4c1', w: 10 },
  'Cambridge City Hall': { text: 'CAMBRIDGE CITY HALL', bg: '#1d2a3a', fg: '#ffffff', w: 12 },
  'Manulife Financial': { text: 'Manulife', bg: '#00a758', fg: '#ffffff', w: 12 },
  'Sun Life Financial': { text: 'Sun Life', bg: '#ffffff', fg: '#e8a300', w: 12 },
  'BlackBerry A': { text: 'BlackBerry', bg: '#111111', fg: '#ffffff', w: 12 },
  'Ken Seiling Waterloo Region Museum': { text: 'WATERLOO REGION MUSEUM', bg: '#4a2a5a', fg: '#ffffff', w: 14 },
  'Galt Arena Gardens': { text: 'GALT ARENA GARDENS', bg: '#7a1f24', fg: '#ffffff', w: 12 },
  'Manulife Financial Sportsplex': { text: 'RIM PARK', sub: 'MANULIFE SPORTSPLEX', bg: '#0b3e8a', fg: '#ffffff', w: 14 },
  'Conestoga Student Recreation Centre': { text: 'CONESTOGA COLLEGE', sub: 'RECREATION CENTRE', bg: '#0b2d4a', fg: '#ffffff', w: 14 },
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
  const polys = markPolys(city);
  const strips = markStrips(city);
  return { named, looks, strips, polys };
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
    if (b.kw && b.kw.poly) continue;
    if (b.kw && (b.kw.fam || campusOf(b.x, b.z))) continue;
    const f = faceFor(city, b, b.x, b.z, 3, true);
    if (!f) continue;
    if (!b.kw) b.kw = {};
    b.kw.strip = { face: f.i };
    n++;
  }
  return n;
}

// --- footprints drawn as themselves -------------------------------------------------

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

/**
 * The schools, the campuses and the plazas' stores (kw.json polys) are
 * drawn from their real footprints (buildPolys), not their boxes: St.
 * Matthew's is a 35-sided plan the box made a 95 x 101 m cube of. The box
 * stays for the scatter and the ground's tint but goes flat (h 0), so
 * nothing collides with it; the polygon's walls are solids of their own.
 */
function markPolys(city) {
  let n = 0;
  for (const [nm, bt, lv, pts] of KW.polys || []) {
    let cx = 0, cz = 0;
    for (const q of pts) { cx += q[0]; cz += q[1]; }
    cx /= pts.length; cz /= pts.length;
    const A = Math.abs(polyArea(pts));
    if (A < 60) continue;
    const b = boxAt(city, cx, cz, 3);
    if (!b || (b.kw && b.kw.poly)) continue;
    if (b.w * b.d > A * 6 + 400) continue;     // a different, bigger building
    const L = LOOKS[nm];
    const arena = /stadium|sports_centre|sports_hall/.test(bt) || /Arena|Auditorium|Sportsplex|Recreation Complex/.test(nm);
    const civic = !arena && (/civic|public|government|townhall/.test(bt) || /City Hall|Museum/.test(nm));
    const retail = !arena && !civic && (bt === 'retail' || bt === 'commercial' || bt === 'supermarket' || bt === 'yes');
    const h = L && L.h ? L.h : arena ? (A > 6000 ? 17 : 12) : lv ? lv * 3.9 + 1.2 : retail ? 6 : b.h > 0.5 ? Math.max(b.h, 7) : 8;
    if (!b.kw) b.kw = {};
    if (nm && !b.kw.name) b.kw.name = nm;
    if (bt) b.kw.bt = bt;
    b.kw.poly = { pts: A < 0 ? pts.slice().reverse() : pts, h, n: nm, bt, retail, arena, civic, fam: L ? L.fam : null };
    b.h = 0;
    n++;
  }
  return n;
}

const BRICKS = [[0.80, 0.66, 0.48], [0.56, 0.36, 0.27], [0.70, 0.42, 0.31], [0.84, 0.78, 0.64], [0.64, 0.60, 0.55]];
const STUCCO = [[0.86, 0.80, 0.68], [0.80, 0.72, 0.60], [0.74, 0.56, 0.44], [0.82, 0.82, 0.80], [0.66, 0.62, 0.56]];

/** A polygon building's walls, windows, parapet, roof and plant into `B`; its solids into `solids`. */
const U0 = [0, 0, 0, 0, 0, 0, 0, 0];
function meshPoly(B, solids, b, P, city) {
  // is there a street within 45 m of (x, z)?
  const streetward = (x, z) => !!faceRoad(city, x, z, 45);
  const pts = P.pts, n = pts.length;
  const seed = Math.round(b.x * 3 + b.z * 7);
  const T = G.terrainHeight;
  let cx = 0, cz = 0, lo = Infinity;
  for (const q of pts) { cx += q[0]; cz += q[1]; lo = Math.min(lo, T(q[0], q[1])); }
  cx /= n; cz /= n;
  const yTop = T(cx, cz) + P.h, y0 = lo - 1.2;
  const camp = campusOf(cx, cz);
  const col = P.fam ? P.fam.c : P.arena ? [[0.72, 0.70, 0.66], [0.60, 0.62, 0.64], [0.78, 0.70, 0.56]][Math.floor(hash2(seed, 4) * 3)]
    : P.civic ? [0.80, 0.76, 0.68] : P.retail ? STUCCO[Math.floor(hash2(seed, 5) * STUCCO.length)]
    : camp === 'wlu' ? BRICKS[2] : camp === 'uw' ? [BRICKS[0], BRICKS[3], BRICKS[4]][Math.floor(hash2(seed, 6) * 3)]
      : BRICKS[Math.floor(hash2(seed, 7) * BRICKS.length)];
  const glassy = P.fam && P.fam.m === 'glass';
  // vertex colours are linear: the palettes above are sRGB
  const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
  const colL = lin(col);
  const dark = [colL[0] * 0.75, colL[1] * 0.75, colL[2] * 0.75];
  const GLASS = lin([0.16, 0.2, 0.24]), FRAME = lin([0.36, 0.37, 0.38]), TRIM = lin([0.84, 0.83, 0.8]);
  const storey = P.retail ? 6 : 3.9;
  const floors = Math.max(1, Math.round((P.h - 0.8) / storey));
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.3) continue;
    const ux = dx / L, uz = dz / L;
    // CCW: outward is (dz, -dx) -- unless the outline is a tangle (the Aud's
    // is several rinks in one way): then it is whichever side is outside
    let nx = uz, nz = -ux;
    if (inPoly(pts, a[0] + dx / 2 + nx * 0.6, a[1] + dz / 2 + nz * 0.6)) { nx = -nx; nz = -nz; }
    const N = [nx, 0, nz];
    // the wall, to a parapet 0.7 m over the roof, and its inside face above the roof
    B.quad([a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], yTop + 0.7, c[1]], [a[0], yTop + 0.7, a[1]], N, U0, [dark, dark, colL, colL]);
    B.quad([a[0], yTop, a[1]], [c[0], yTop, c[1]], [c[0], yTop + 0.7, c[1]], [a[0], yTop + 0.7, a[1]], [-nx, 0, -nz], U0, dark);
    B.quad([a[0] + nx * 0.12, yTop + 0.7, a[1] + nz * 0.12], [c[0] + nx * 0.12, yTop + 0.7, c[1] + nz * 0.12], [c[0], yTop + 0.84, c[1]], [a[0], yTop + 0.84, a[1]], [0, 1, 0], U0, TRIM);
    // collision: the wall as a thin box
    solids.push({ x: (a[0] + c[0]) / 2, z: (a[1] + c[1]) / 2, hw: L / 2 + 0.2, hd: 0.35, rot: Math.atan2(dz, dx), y0: y0, y1: yTop + 0.7 });
    if (L < 4) continue;
    const gy = T(a[0] + dx / 2 + nx * 2, a[1] + dz / 2 + nz * 2);
    const o = 0.05, e0 = Math.min(1.2, L * 0.15);
    const at = (t, y, off) => [a[0] + ux * t + nx * off, y, a[1] + uz * t + nz * off];
    if (P.arena) {
      // an arena: blank walls with ribs, a band at the eaves, glass doors
      // on the faces toward a street
      const nr = Math.floor(L / 6);
      for (let k = 1; k < nr; k++) {
        const t = (k / nr) * L;
        B.quad(at(t - 0.2, gy + 2, o), at(t + 0.2, gy + 2, o), at(t + 0.2, yTop, o), at(t - 0.2, yTop, o), N, U0, dark);
      }
      B.quad(at(0, yTop - 1.6, o * 2), at(L, yTop - 1.6, o * 2), at(L, yTop - 0.4, o * 2), at(0, yTop - 0.4, o * 2), N, U0, TRIM);
      if (L > 20 && streetward(a[0] + dx / 2 + nx * 3, a[1] + dz / 2 + nz * 3)) {
        const w = Math.min(L * 0.5, 24), t0 = L / 2 - w / 2;
        B.quad(at(t0, gy - 0.3, o), at(t0 + w, gy - 0.3, o), at(t0 + w, gy + 4.2, o), at(t0, gy + 4.2, o), N, U0, GLASS);
        B.quad(at(t0 - 1, gy + 4.2, 2.2), at(t0 + w + 1, gy + 4.2, 2.2), at(t0 + w + 1, gy + 4.2, 0), at(t0 - 1, gy + 4.2, 0), [0, -1, 0], U0, TRIM);
        B.quad(at(t0 - 1, gy + 4.2, 2.2), at(t0 + w + 1, gy + 4.2, 2.2), at(t0 + w + 1, gy + 4.7, 2.2), at(t0 - 1, gy + 4.7, 2.2), N, U0, TRIM);
      }
      continue;
    }
    if (P.retail) {
      // a store: a storefront of glass along any face that is not a back wall
      // (a back wall faces a lane, a fence or the neighbours: no lot, no road in front)
      const fx = a[0] + dx / 2 + nx * 12, fz = a[1] + dz / 2 + nz * 12;
      const front = G.lotAt(fx, fz) >= 0;
      if (!front) continue;
      B.quad(at(e0, gy - 0.3, o), at(L - e0, gy - 0.3, o), at(L - e0, gy + 3.0, o), at(e0, gy + 3.0, o), N, U0, GLASS);
      const nm = Math.max(1, Math.round((L - 2 * e0) / 3));
      for (let k = 0; k <= nm; k++) {
        const t = e0 + (k / nm) * (L - 2 * e0);
        B.quad(at(t - 0.06, gy - 0.3, o * 2), at(t + 0.06, gy - 0.3, o * 2), at(t + 0.06, gy + 3.0, o * 2), at(t - 0.06, gy + 3.0, o * 2), N, U0, FRAME);
      }
      // the fascia the signs hang on: 1.8 m out, 3.2-4.45 m up
      const f0 = gy + 3.2, f1 = gy + 4.45, D = 1.8;
      B.quad(at(0, f0, D), at(L, f0, D), at(L, f1, D), at(0, f1, D), N, U0, TRIM);
      B.quad(at(0, f0, 0), at(L, f0, 0), at(L, f0, D), at(0, f0, D), [0, -1, 0], U0, lin([0.5, 0.5, 0.5]));
      B.quad(at(0, f1, 0), at(L, f1, 0), at(L, f1, D), at(0, f1, D), [0, 1, 0], U0, lin([0.6, 0.6, 0.6]));
      continue;
    }
    // ribbon windows, a band per storey (a curtain wall: most of the storey)
    for (let k = 0; k < floors; k++) {
      const ya = gy + 1.0 + k * storey, yb = ya + (glassy ? storey - 0.7 : 1.55);
      if (yb > yTop - 0.3) break;
      B.quad(at(e0, ya, o), at(L - e0, ya, o), at(L - e0, yb, o), at(e0, yb, o), N, U0, GLASS);
      // mullions every 2.6 m
      const nm = Math.floor((L - 2 * e0) / 2.6);
      for (let m = 1; m < nm; m++) {
        const t = e0 + (m / nm) * (L - 2 * e0);
        B.quad(at(t - 0.07, ya, o * 2), at(t + 0.07, ya, o * 2), at(t + 0.07, yb, o * 2), at(t - 0.07, yb, o * 2), N, U0, FRAME);
      }
      // a sill under the band
      B.quad(at(e0, ya - 0.12, o * 3), at(L - e0, ya - 0.12, o * 3), at(L - e0, ya, o * 3), at(e0, ya, o * 3), N, U0, TRIM);
    }
  }
  // the roof, triangulated
  const contour = pts.map((q) => new THREE.Vector2(q[0], q[1]));
  let tris = [];
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
  const RC = lin([0.56, 0.56, 0.54]);
  for (const [i, j, k] of tris) {
    const A = pts[i], Bq = pts[j], C = pts[k];
    B.tri([A[0], yTop, A[1]], [Bq[0], yTop, Bq[1]], [C[0], yTop, C[1]], [0, 1, 0], RC);
  }
  // plant on the roof: a few units inside the footprint
  const nu = Math.min(8, Math.max(1, Math.round(Math.abs(polyArea(pts)) / 700)));
  for (let u = 0; u < nu; u++) {
    const q = pts[Math.floor(hash2(seed, 40 + u) * n)];
    const t = 0.35 + hash2(seed, 60 + u) * 0.4;
    const ux = cx + (q[0] - cx) * t, uz = cz + (q[1] - cz) * t;
    B.box(ux, yTop, uz, 2 + hash2(seed, 80 + u) * 2, 1.2 + hash2(seed, 90 + u), 1.6, 0, lin([0.66, 0.67, 0.68]));
  }
}

let POLY_MAT = null;
/** landmarks.js extra: every polygon building, merged per 1200 m cluster. */
export function buildPolys(ctx) {
  if (!KW) return;
  const { addTo, city } = ctx;
  if (!POLY_MAT) POLY_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  const builders = new Map();
  let n = 0;
  for (const b of city.buildings) {
    if (!b.kw || !b.kw.poly) continue;
    const k = 'kwp' + Math.round(b.x / 1200) + ',' + Math.round(b.z / 1200);
    let B = builders.get(k);
    if (!B) builders.set(k, (B = new Builder(false)));
    meshPoly(B, ctx.solids, b, b.kw.poly, city);
    n++;
  }
  for (const [k, B] of builders) {
    if (B.empty) continue;
    const m = new THREE.Mesh(B.build(), POLY_MAT);
    const g = new THREE.Group();
    g.add(m);
    addTo(k, g);
  }
  if (KW) KW.polyStats = { buildings: n, clusters: builders.size };
}

/** The face of a polygon building nearest (px, pz): world point at the wall, outward normal, length. */
function polyFace(P, px, pz) {
  const pts = P.pts, n = pts.length;
  let best = null, bd = Infinity;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 3) continue;
    const ux = dx / L, uz = dz / L;
    let nx = uz, nz = -ux;
    if (inPoly(pts, a[0] + dx / 2 + nx * 0.6, a[1] + dz / 2 + nz * 0.6)) { nx = -nx; nz = -nz; }
    const t = Math.max(0, Math.min(L, (px - a[0]) * ux + (pz - a[1]) * uz));
    const qx = a[0] + ux * t, qz = a[1] + uz * t, d = Math.hypot(px - qx, pz - qz);
    // a store's face is one in front of a lot (the storefront): prefer those
    const front = G.lotAt(a[0] + dx / 2 + nx * 12, a[1] + dz / 2 + nz * 12) >= 0;
    const sc = d + (P.retail && !front ? 60 : 0);
    if (sc < bd) { bd = sc; best = { x: qx, z: qz, nx, nz, len: L, t, ux, uz, ax: a[0], az: a[1] }; }
  }
  return best;
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
    if (b && b.kw && b.kw.poly) {
      const P = b.kw.poly, f = polyFace(P, x, z);
      if (!f) return null;
      const ww = Math.min(w, f.len - 0.6), half = (f.len - ww) / 2;
      const t = Math.max(ww / 2 + 0.3, Math.min(f.len - ww / 2 - 0.3, f.t));
      const sx = f.ax + f.ux * t, sz = f.az + f.uz * t;
      const gy = G.terrainHeight(sx + f.nx * 2, sz + f.nz * 2);
      const g = grp(sx, sz);
      if (P.retail) hang(g, makePanel(ww, Math.min(h, 1.05)), sx, gy + 3.82, sz, f.nx, f.nz, 1.88);
      else hang(g, makePanel(ww, h), sx, gy + (opts.y || 3.4), sz, f.nx, f.nz);
      void half;
      return { b, f: { ...f, x: sx, z: sz } };
    }
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
  // the region's landmarks: a big sign high on the face toward the street
  const plated = new Set();
  for (const b of city.buildings) {
    const S = b.kw && b.kw.name && LM_SIGNS[b.kw.name];
    if (!S || plated.has(b)) continue;
    plated.add(b);
    const rd = faceRoad(city, b.x, b.z, 260);
    const tx = rd ? rd.qx : b.x + 100, tz = rd ? rd.qz : b.z;
    let f, sx, sz, top;
    if (b.kw.poly) {
      f = polyFace(b.kw.poly, tx, tz);
      if (!f) continue;
      const ww = Math.min(S.w, f.len - 1);
      const t = Math.max(ww / 2 + 0.3, Math.min(f.len - ww / 2 - 0.3, f.t));
      sx = f.ax + f.ux * t; sz = f.az + f.uz * t;
      top = G.terrainHeight(b.x, b.z) + b.kw.poly.h;
    } else {
      f = faceFor(city, b, tx, tz, S.w, true);
      if (!f) continue;
      sx = f.x; sz = f.z; top = b.y + b.h;
    }
    const w = Math.min(S.w, f.len - 1), h = S.sub ? w * 0.28 : w * 0.18;
    const p = L.panel(w, h, 22, (g, W, H) => {
      g.fillStyle = S.bg; g.fillRect(0, 0, W, H);
      g.fillStyle = S.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 ${H * (S.sub ? 0.46 : 0.62)}px Helvetica, Arial, sans-serif`;
      g.fillText(S.text, W / 2, H * (S.sub ? 0.36 : 0.52), W * 0.94);
      if (S.sub) {
        g.fillStyle = S.fg2 || S.fg; g.font = `700 ${H * 0.22}px Helvetica, Arial, sans-serif`;
        g.fillText(S.sub, W / 2, H * 0.78, W * 0.94);
      }
    });
    hang(grp(sx, sz), p, sx, Math.max(G.terrainHeight(sx, sz) + h / 2 + 2, top - h / 2 - 0.9), sz, f.nx, f.nz, 0.18);
    stats.landmarks = (stats.landmarks || 0) + 1;
  }
  // campus nameplates and the schools: one per named box
  for (const b of city.buildings) {
    if (!b.kw || !b.kw.name || plated.has(b)) continue;
    const bt = b.kw.bt, n = b.kw.name;
    const camp = campusOf(b.x, b.z);
    const school = bt === 'school' || /Catholic (Elementary|Secondary) School|Public School|Collegiate|Secondary School/.test(n);
    if (!((camp && (bt === 'university' || bt === 'college' || bt === 'dormitory' || LOOKS[n])) || school)) continue;
    if (n.length > 60 || /^[A-Z]\d$/.test(n)) continue;
    plated.add(b);
    const col = school ? CAMPUS_SIGN.school : CAMPUS_SIGN[camp];
    const w = Math.max(3.2, Math.min(9, n.length * (n.length > 26 ? 0.24 : 0.36) + 1.2));
    const h = n.length > 26 ? 1.5 : 1.0;
    if (b.kw.poly) {
      // on the face nearest a street
      const rd = faceRoad(city, b.x, b.z, 200);
      const f = polyFace(b.kw.poly, rd ? rd.qx : b.x, rd ? rd.qz : b.z);
      if (!f || f.len < w + 0.6) continue;
      const t = Math.max(w / 2 + 0.3, Math.min(f.len - w / 2 - 0.3, f.t));
      const sx = f.ax + f.ux * t, sz = f.az + f.uz * t;
      const gy = G.terrainHeight(sx + f.nx * 2, sz + f.nz * 2);
      hang(grp(sx, sz), namePanel(L, n, w, h, col), sx, gy + Math.min(3.2, b.kw.poly.h - 1.2), sz, f.nx, f.nz);
      stats.plates++;
      continue;
    }
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
