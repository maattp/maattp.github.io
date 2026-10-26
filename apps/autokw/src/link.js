// AUTO KW: THIS IS ION, Waterloo Region's light rail (route 301, Conestoga
// to Fairway, 19 stations), on Seattle's Link engine: the profile, the
// lazy chunks and the driving are Link's; the car (ION's Flexity Freedom),
// the stations (OSM's platforms, ION's canopies and signs), the street and
// corridor track, the catenary poles, the gated crossings and the 10-minute
// timetable are ION's -- see apps/autokw/CLAUDE.md, "ION". Seattle's notes
// follow.
//
// LINK LIGHT RAIL: the 1 Line across the whole map -- from the Lynnwood
// extension at the north edge, over the Northgate guideway, 13 km of bored
// tunnel under Roosevelt, the U District, the Montlake Cut, Capitol Hill and
// downtown's transit tunnel, out at International District, down the SODO
// busway, up through Beacon Hill, over Mount Baker, down the middle of Martin
// Luther King Jr Way and up onto the guideway toward Tukwila at the south
// edge. Both tracks, all sixteen stations, and a service of four-car trains
// you can board at any station and drive.
//
// WHERE THE NUMBERS COME FROM. The route, its tunnels and bridges and the
// stations are OpenStreetMap's (data/link.json, tools/build_link.py). The rest
// is published, and each figure names its source:
//   [ST]  Sound Transit, Link light rail facts and system description
//   [S70] Siemens Mobility, S700/S70 low-floor LRV data sheets (Link Series 2)
//   [WP]  Wikipedia, "1 Line (Sound Transit)", "Link light rail"
//   est.  no source publishes it; what it was set from is said
//
//   car           95 ft (28.9 m) long, 8 ft 8 in (2.65 m) wide, three sections
//                 on three bogies, a cab at each end [S70][ST]
//   floor         14 in (0.36 m) over the rail, level with the platforms [ST]
//   trains        up to four cars; platforms 380 ft (116 m) [ST]
//   speed         55 mph (24.6 m/s) top; 35 mph in MLK Jr Way's median [ST][WP]
//   acceleration  ~3 mph/s (1.34 m/s2) [S70]; brake about the same in service,
//                 emergency ~5 mph/s (2.2 m/s2) [S70]
//   gauge         4 ft 8.5 in, overhead catenary at 1500 V DC [ST]
//   tunnels       twin bored tubes; the downtown transit tunnel is one box
//                 [WP] -- here every track has its own box section (est.)
//
// Track parameter s runs along each track from its NORTH end (s = 0, at the
// map edge) to its south end. Trains keep right: `sb` is the western track and
// runs toward +s, `nb` the eastern toward -s. A train's local frame has +z
// toward +s and y = 0 on the rail head.

import { buildXingMast, XingSignals, xingIndex, xingClosed } from './xing.js';
import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder, ChunkBuilder, SinkBuilder, LazyChunks, dropStaticArrays } from './build.js';
import { GLASS, tagGlass, vehicleAssets } from './vehicles.js';
import { clamp, angleWrap } from './util.js';

export const LINK = {
  gauge: 1.435,
  lift: 0.62,            // rail head over the smoothed ground at grade: the bed stands clear of the
                         // road surface (+0.30) beside it, as MLK Jr Way's raised trackway does (est.)
  liftX: 0.36,           // ...and at a level crossing, flush with the road
  deck: 8.5,             // rail head over the ground on the elevated guideway (est.)
  cover: 7.8,            // a bored track's rail head at least this far under the ground (est.)
  grade: 0.055,          // steepest grade the profile may take (Link's steepest are ~5.5 %, est.)
  boreW: 3.1,            // box half-width inside (est.)
  boreH: 5.4,            // box height inside over the rail head (est.)
  roofOut: 6.0,          // top of the box's roof slab over the rail head
  wire: 5.0,             // contact wire over the rail head (est.)
  platH: 0.36,           // platform over the rail head [ST]
  platLen: 64,           // Auto KW: ION's platforms, sized for two cars coupled one day (est.)
  // Auto KW: ONE Bombardier (Alstom) Flexity Freedom: 30.2 m, 2.65 m wide,
  // five sections -- the two cabs and the centre on bogies, the two short
  // sections between them suspended [WP Ion rapid transit; Flexity Freedom].
  // ION runs them singly: the platforms were built for two coupled, but the
  // second car's canopy and wall were left for "when two-car trains become
  // the norm" [WP]. `cars: 2` couples them (the code is general).
  carLen: 30.2, cars: 1, couple: 0.8,
  wid: 2.65, roof: 3.42,
  // 70 km/h on the rail corridor, 50 in the street [WP]
  vMax: 19.4, vStreet: 11.1, vSlow: 6.9,   // ... 40 in most of the street, 25 through Uptown and downtown Kitchener
  acc: 1.2, brake: 1.2, brakeEmerg: 2.4,
  aLat: 1.0,             // unbalanced lateral acceleration in service (est.)
  dwell: 22,             // seconds at a platform (est.: ION's are ~20-30)
  headway: 600,          // every 10 minutes, weekdays 6 am - 10 pm [WP]: the game is always daytime
  turn: 75,              // the least a train stands at a terminus between trips (est.)
  perTrack: 0,           // (ION: the train count comes from the headway, makeTrains)
  perTrack2: 0,          // (ION is one line: its sb2/nb2 are the same rails)
  floatDeck: 3.2,        // the rail head over Lake Washington on the I-90 floating bridge (est.)
};
LINK.len = LINK.cars * LINK.carLen + (LINK.cars - 1) * LINK.couple;

// A Flexity Freedom's five sections, car-local z (the car centred on 0, +z
// its B end): cab A, the suspended F1, the centre C over the middle bogie,
// F2, cab B -- with a 0.5 m articulation between each [photos: Commons
// "Ion Flexity Freedom 514 service livery", "ION 505 Kitchener City Hall"].
const FF = (() => {
  const h = LINK.carLen / 2, J = 0.5, cab = 8.05, f = 4.05;
  const A = [-h, -h + cab], F1 = [A[1] + J, A[1] + J + f], B = [h - cab, h], F2 = [B[0] - J - f, B[0] - J];
  return { J, sec: [A, F1, [F1[1] + J, F2[0] - J], F2, B], doors: [-h + 6.65, F1[0] + 2.75, F2[1] - 2.75, h - 6.65] };
})();
// The sections of a whole train, [z0, z1] in its local frame, car by car.
const SECTIONS = (() => {
  const out = [];
  for (let c = 0; c < LINK.cars; c++) {
    const zc = -LINK.len / 2 + LINK.carLen / 2 + c * (LINK.carLen + LINK.couple);
    for (const [a, b] of FF.sec) out.push([zc + a, zc + b]);
  }
  return out;
})();

const STEP = 1;
// ION's colours (linear): the blue of the cars' roof line and of the
// canopies' frit, the grey steel of the poles and canopies
const ION_BLUE = [0.018, 0.10, 0.42];
const _lfw = new THREE.Vector3();
const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
// how far each part is drawn: the structure, the ballast bed, the near
// detail (rails, wires, poles), the boards, a train (a phone draws less).
// Auto KW (v86): a phone's structure to 1300 m (was 1900): ION is at grade
// almost everywhere, so its 200 m chunks past ~1.3 km are platforms and
// kerbs a pixel or two tall -- and a draw each: 23 of them (33k triangles)
// from a Westmount street.
const RANGE = ON_PHONE ? { flat: 1300, bed: 900, near: 380, sign: 500, train: 1000 }
  : { flat: 2800, bed: 1500, near: 600, sign: 700, train: 1600 };
const TUN = 1, BOX = 2, DECK = 3, FILL = 4, CROSS = 5;
/** What each metre of a track is (LinkTrack.KD): freight.js shares them. */
export const KIND = { TUN, BOX, DECK, FILL, CROSS };

/**
 * THE BALLAST IS GROUND: a query for city.bedQueries. The bed is drawn over
 * the ground the city answers for (freight's on a formation cut 1 m under the
 * rail head, Link's on the ground), so a car or a walker on the line stood in
 * it. Flat at the rail head - 0.15 (ties and rails) across `top` either side,
 * then the shoulder down to `shY` under the rail head at `shW`. Tunnels, decks
 * and level crossings answer for themselves. Built once the tracks have their
 * heights (main.js).
 */
export function railBedSurface(tracks, top, shW, shY) {
  const C = 16, cells = new Map();
  tracks.forEach((tr, ti) => {
    for (let i = 0; i < tr.n; i += 2) {
      const kd = tr.KD ? tr.KD[i] : FILL;
      if (kd === TUN || kd === DECK || kd === CROSS) continue;
      const x0 = Math.floor((tr.X[i] - shW) / C), x1 = Math.floor((tr.X[i] + shW) / C);
      const z0 = Math.floor((tr.Z[i] - shW) / C), z1 = Math.floor((tr.Z[i] + shW) / C);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = cx * 100003 + cz;
        let l = cells.get(k);
        if (!l) cells.set(k, (l = []));
        l.push(ti, i);
      }
    }
  });
  return (x, z) => {
    const l = cells.get(Math.floor(x / C) * 100003 + Math.floor(z / C));
    if (!l) return null;
    let best = null;
    for (let q = 0; q < l.length; q += 2) {
      const tr = tracks[l[q]], i = l[q + 1];
      const h = tr.H[i], fx = Math.sin(h), fz = Math.cos(h);
      const dx = x - tr.X[i], dz = z - tr.Z[i];
      const al = dx * fx + dz * fz;
      if (al > 1.05 || al < -1.05) continue;
      const d = Math.abs(dx * fz - dz * fx);
      if (d > shW) continue;
      const y = tr.Y[i] - 0.15 + (d <= top ? 0 : (shY + 0.15) * (d - top) / (shW - top));
      if (best === null || y > best) best = y;
    }
    return best;
  };
}

function boxAvg(a, r) {
  const n = a.length, out = new Float64Array(n), c = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) c[i + 1] = c[i] + a[i];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - r), i1 = Math.min(n - 1, i + r);
    out[i] = (c[i1 + 1] - c[i0]) / (i1 - i0 + 1);
  }
  return out;
}
function dilate(a, r) {
  const n = a.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) if (a[j] > m) m = a[j];
    out[i] = m;
  }
  return out;
}
function erode(a, r) {
  const n = a.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j += 2) if (a[j] < m) m = a[j];
    out[i] = m;
  }
  return out;
}

// ---------------------------------------------------------------------------
// A track: the OSM line smoothed, resampled every metre, with its structure
// flag (tunnel / bridge / ground), height profile and speed limits.

export class LinkTrack {
  /** `P`: the line's numbers (LINK's shape: lift, liftX, deck, cover, grade);
   *  freight.js passes its own. `P.bridgeFloor(x, z)`, if given, is the
   *  lowest a bridge's rail head may be there (clearance over the water). */
  constructor(key, raw, P = LINK) {
    this.key = key;
    this.P = P;
    this.dir = key.startsWith('sb') ? 1 : -1;   // direction of travel along s (sb, sb2: +s)
    // Chaikin corner-cutting, twice, endpoints kept. A point's flag is the
    // flag of the way it came from, which build_link.py writes on the END
    // point of each segment.
    let p = raw.map((q) => [q[0], q[1], q[2] || 0]);
    for (let it = 0; it < 2; it++) {
      const o = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        if (i > 0) o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, b[2]]);
        if (i < p.length - 2) o.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, b[2]]);
      }
      o.push(p[p.length - 1]);
      p = o;
    }
    const cum = [0];
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    this.len = cum[cum.length - 1];
    const n = Math.floor(this.len / STEP) + 1;
    this.n = n;
    this.X = new Float64Array(n); this.Z = new Float64Array(n); this.F = new Uint8Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.min(this.len, i * STEP);
      while (j < p.length - 2 && cum[j + 1] < s) j++;
      const t = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      this.X[i] = p[j][0] + (p[j + 1][0] - p[j][0]) * t;
      this.Z[i] = p[j][1] + (p[j + 1][1] - p[j][1]) * t;
      this.F[i] = p[j + 1][2];
    }
    // A short "tunnel" is the track passing under something at its own level
    // -- a freeway's ramps, a plaza (the 45 and 224 m pieces south of
    // International District): not a bore to dive into.
    for (let i = 0; i < n;) {
      let k = i;
      while (k < n && this.F[k] === this.F[i]) k++;
      if (this.F[i] === 1 && k - i < 400) this.F.fill(0, i, k);
      i = k;
    }
    this.H = new Float64Array(n); this.K = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
      this.H[i] = Math.atan2(this.X[b] - this.X[a], this.Z[b] - this.Z[a]);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 12), b = Math.min(n - 1, i + 12);
      this.K[i] = b > a ? angleWrap(this.H[b] - this.H[a]) / ((b - a) * STEP) : 0;
    }
    // nearest-point grid: 64 m cells listing every 4th sample within reach
    this.cells = new Map();
    for (let i = 0; i < n; i += 4) {
      const cx = Math.floor(this.X[i] / 64), cz = Math.floor(this.Z[i] / 64);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const k = (cx + dx) * 100003 + (cz + dz);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(i);
      }
    }
    this.Y = null;
  }

  _i(s) {
    const f = clamp(s, 0, this.len) / STEP;
    const i = Math.min(this.n - 2, Math.floor(f));
    return [i, f - i];
  }
  x(s) { const [i, t] = this._i(s); return this.X[i] + (this.X[i + 1] - this.X[i]) * t; }
  z(s) { const [i, t] = this._i(s); return this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t; }
  y(s) { const [i, t] = this._i(s); return this.Y[i] + (this.Y[i + 1] - this.Y[i]) * t; }
  heading(s) { const [i, t] = this._i(s); return this.H[i] + angleWrap(this.H[i + 1] - this.H[i]) * t; }
  curv(s) { const [i, t] = this._i(s); return this.K[i] + (this.K[i + 1] - this.K[i]) * t; }
  idx(s) { return Math.round(clamp(s, 0, this.len) / STEP); }
  flag(s) { return this.F[this.idx(s)]; }
  kind(s) { return this.KD ? this.KD[this.idx(s)] : FILL; }
  ground(s) { return this.GR[this.idx(s)]; }

  /** Nearest sample to (x, z) within `maxD` (null past it): { s, d, side } --
   *  side +1 when the point is to the track's left (facing +s). */
  nearest(x, z, maxD = 60) {
    const l = this.cells.get(Math.floor(x / 64) * 100003 + Math.floor(z / 64));
    if (!l) return null;
    let best = -1, bd = maxD * maxD + 64;
    for (let q = 0; q < l.length; q++) {
      const i = l[q], d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    for (let i = Math.max(0, best - 4); i <= Math.min(this.n - 1, best + 4); i++) {
      const d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const d = Math.sqrt(bd);
    if (d > maxD) return null;
    const h = this.H[best];
    const side = (x - this.X[best]) * Math.cos(h) - (z - this.Z[best]) * Math.sin(h) >= 0 ? 1 : -1;
    return { s: best * STEP, d, side };
  }

  /**
   * The rail-head profile. At grade it follows the ground (smoothed so it is
   * never under it); on a bridge it climbs to the guideway at the ruling
   * grade; in a bore it dives to its cover at the same grade -- where the
   * grade cannot get it under the ground in time, the box it runs in stands
   * above the ground as a covered approach, which is what a portal is.
   * Stations are level. `zones`: [[s0, s1, kindHint]].
   */
  setHeights(zones, crossing) {
    const P = this.P, n = this.n, g = P.grade;
    const gr = new Float64Array(n);
    for (let i = 0; i < n; i++) gr[i] = G.terrainHeight(this.X[i], this.Z[i]);
    this.GR = gr;
    // Link rides OVER the ground's bumps (dilate, then smooth). A freight bed
    // (`P.follow` 'mean') follows the ground's AVERAGE and the ground is cut
    // down to it (freight.js carveDepth): at a 2.2 % ruling grade the 40 m
    // DEM's 5-8 m noise lifted the line onto fills everywhere.
    const ga = P.follow === 'mean' ? boxAvg(gr.map((v) => Math.max(v, P.seaFloor || -1e9)), P.meanR || 40) : boxAvg(dilate(gr, 4), 6);
    const cov = erode(gr, 30);
    const lo = new Float64Array(n), hi = new Float64Array(n), tg = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const f = this.F[i];
      if (f === 1) { hi[i] = cov[i] - P.cover; lo[i] = hi[i] - 90; tg[i] = cov[i] - P.cover - 6; }
      else if (f === 2) {
        lo[i] = ga[i] + P.lift; hi[i] = ga[i] + P.deck;
        if (P.bridgeFloor) { const b = P.bridgeFloor(this.X[i], this.Z[i]); if (b > hi[i]) hi[i] = b; if (b > lo[i]) lo[i] = b; }
        tg[i] = hi[i];
      } else if (crossing && crossing[i] && P.follow === 'mean') {
        // a level crossing is pinned to the road it carries: flush with the
        // raw ground there, which the carve then meets
        lo[i] = hi[i] = tg[i] = Math.max(gr[i], P.seaFloor || -1e9) + P.liftX;
      } else {
        lo[i] = hi[i] = tg[i] = ga[i] + (crossing && crossing[i] ? P.liftX : P.lift);
        // `P.waterAtGrade`: track OSM has at grade over water the mask calls
        // a lake (the 2 Line past Mercer Slough) keeps a bridge's floor too
        if (P.waterAtGrade && P.bridgeFloor) { const b = P.bridgeFloor(this.X[i], this.Z[i]); if (b > lo[i]) lo[i] = hi[i] = tg[i] = b; }
      }
    }
    for (const z of zones) {
      const [s0, s1] = z;
      const i0 = Math.max(0, Math.floor(s0)), i1 = Math.min(n - 1, Math.ceil(s1));
      const f = this.F[Math.round((i0 + i1) / 2)];
      if (f === 0) continue;
      let y;
      if (z[2] !== undefined) y = z[2];
      else if (f === 1) { y = Infinity; for (let i = i0; i <= i1; i++) y = Math.min(y, hi[i]); y -= 2; }
      else { y = 0; for (let i = i0; i <= i1; i++) y += tg[i]; y /= (i1 - i0 + 1); }
      z.level = y;
      for (let i = i0; i <= i1; i++) lo[i] = hi[i] = tg[i] = y;
    }
    // Lipschitz envelopes: U the highest profile under every `hi`, L the
    // lowest over every `lo`, both at the ruling grade. Where they cross the
    // grade wins (L): a bore that cannot get deep enough in time runs higher.
    const U = Float64Array.from(hi), L = Float64Array.from(lo);
    for (let i = 1; i < n; i++) U[i] = Math.min(U[i], U[i - 1] + g);
    for (let i = n - 2; i >= 0; i--) U[i] = Math.min(U[i], U[i + 1] + g);
    for (let i = 1; i < n; i++) L[i] = Math.max(L[i], L[i - 1] - g);
    for (let i = n - 2; i >= 0; i--) L[i] = Math.max(L[i], L[i + 1] - g);
    const fit = (a) => { for (let i = 0; i < n; i++) a[i] = L[i] > U[i] ? L[i] : clamp(a[i], L[i], U[i]); return a; };
    // The first fit follows `tg`, which is as rough as the ground; lowering
    // its peaks to the ruling grade (never under L) makes it a profile a
    // train can ride, and the smoothing after that keeps it one.
    let y = fit(Float64Array.from(tg));
    for (let i = 1; i < n; i++) y[i] = Math.min(y[i], y[i - 1] + g);
    for (let i = n - 2; i >= 0; i--) y[i] = Math.min(y[i], y[i + 1] + g);
    for (let i = 0; i < n; i++) y[i] = Math.max(y[i], L[i]);
    for (let it = 0; it < 4; it++) y = fit(boxAvg(y, 24));
    this.Y = y;
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers along a track.

const uv0 = [0, 0, 1, 0, 1, 1, 0, 1];
/** A quad's uvs (corners a, b, c, d) mirrored left to right: a and b swap, c and d. */
const mirrorUV = (u) => [u[2], u[3], u[0], u[1], u[6], u[7], u[4], u[5]];
/** A frame at s: rail-head point, forward and left (horizontal). */
function frame(tr, s) {
  const h = tr.heading(s);
  return { x: tr.x(s), y: tr.y(s), z: tr.z(s), fx: Math.sin(h), fz: Math.cos(h), lx: Math.cos(h), lz: -Math.sin(h), h };
}
const at = (F, o, dy) => [F.x + F.lx * o, F.y + dy, F.z + F.lz * o];
const atY = (F, o, y) => [F.x + F.lx * o, y, F.z + F.lz * o];
/** The quad between two frames, at lateral offsets o0 -> o1 and heights
 *  dy0 -> dy1 over the rail head (the same at both ends). */
function band(b, A, B, o0, dy0, o1, dy1, n, col, uvs = uv0) {
  b.quad(at(A, o0, dy0), at(A, o1, dy1), at(B, o1, dy1), at(B, o0, dy0), n, uvs, col);
}
const UP = [0, 1, 0], DOWN = [0, -1, 0];
const side = (F, sg) => [F.lx * sg, 0, F.lz * sg];

// Colours (linear, vertex)
const C = {
  concrete: [0.50, 0.49, 0.46], concreteD: [0.36, 0.355, 0.34], concreteL: [0.62, 0.61, 0.58],
  railTop: [0.66, 0.66, 0.68], railSide: [0.30, 0.22, 0.17], steel: [0.36, 0.37, 0.38],
  paving: [0.20, 0.20, 0.21], plat: [0.58, 0.57, 0.54], tactile: [0.78, 0.66, 0.12],
  canopy: [0.82, 0.84, 0.86], teal: [0.78, 0.07, 0.10], navy: [0.16, 0.17, 0.19],
  wire: [0.12, 0.12, 0.12], black: [0.02, 0.02, 0.025],
  slab: [0.60, 0.59, 0.56], post: [0.05, 0.05, 0.055], pole: [0.40, 0.43, 0.46],
};

/** The ballast-and-sleepers texture, u 0..0.5 across the 3 m bed, v along
 *  2.4 m; and in u 0.5..1 the corridor's black chain-link fence (u up its
 *  1.8 m, v along it), cut out by the material's alphaTest. */
function bedTexture() {
  const W = 256, H = 256, BW = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#6b655c'; g.fillRect(0, 0, BW, H);
  for (let k = 0; k < 2600; k++) {
    const v = 70 + rnd() * 70;
    g.fillStyle = `rgb(${v + 6},${v},${v - 8})`;
    g.fillRect(rnd() * BW, rnd() * H, 1 + rnd() * 2.5, 1 + rnd() * 2);
  }
  // four concrete sleepers a repeat (0.6 m), 2.6 m of the 3 m
  for (let t = 0; t < 4; t++) {
    const y = t * H / 4 + 10;
    g.fillStyle = '#9d9a92'; g.fillRect(BW * 0.065, y, BW * 0.87, H * 0.1);
    g.fillStyle = '#b3b0a8'; g.fillRect(BW * 0.065, y, BW * 0.87, H * 0.02);
    g.fillStyle = '#56534e'; g.fillRect(BW * 0.065, y + H * 0.085, BW * 0.87, H * 0.015);
    // rail seats (fastenings) under each rail
    for (const u of [0.26, 0.74]) { g.fillStyle = '#2c2a28'; g.fillRect(BW * u - 6, y + 2, 12, H * 0.1 - 4); }
  }
  // the chain-link: diamonds ~9 cm, a top and bottom tension wire
  g.clearRect(BW, 0, W - BW, H);
  g.strokeStyle = '#141516'; g.lineWidth = 1.6;
  const step = 8;
  g.beginPath();
  for (let k = -H; k < H + W; k += step) {
    g.moveTo(BW + 0, k); g.lineTo(BW + (W - BW), k + (W - BW));
    g.moveTo(BW + 0, k); g.lineTo(BW + (W - BW), k - (W - BW));
  }
  g.stroke();
  g.fillStyle = '#141516'; g.fillRect(BW, 0, 4, H); g.fillRect(W - 5, 0, 5, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
const BED_U = 0.5;                       // the ballast's share of the bed texture's width

/** Each station's colour: the feature wall at its platform's end (ION gives
 *  every station its own colour scheme and pattern there -- Queen's is orange
 *  and blue; the rest are stand-ins in the same spirit). sRGB hex. */
const FEATURE = ['#e8742c', '#2a8fd0', '#7bb342', '#c2185b', '#f2b51d', '#00897b', '#5e35b1', '#d84315', '#1e88e5',
  '#8d6e63', '#43a047', '#fb8c00', '#3949ab', '#e53935', '#00acc1', '#7cb342', '#ab47bc', '#f4511e', '#26a69a'];

/** ION's lettering for the line: station name boards (black, the ion mark,
 *  the name in white), each station's feature-wall panel, the platform LED
 *  next-train signs, the Canadian crossbuck. One canvas, shelf-packed. */
function signAtlas(names) {
  const W = 2048, H = 640;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const cells = {};
  let x = 0, y = 0, rowH = 0;
  const cell = (name, w, h, draw) => {
    if (x + w > W) { x = 0; y += rowH + 4; rowH = 0; }
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(g, w, h); g.restore();
    cells[name] = [(x + 0.5) / W, 1 - (y + h - 0.5) / H, (x + w - 0.5) / W, 1 - (y + 0.5) / H];
    x += w + 4; rowH = Math.max(rowH, h);
  };
  const font = (wt, s) => `${wt} ${s}px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const ion = (q, x0, y0, h, col) => {
    q.save(); q.translate(x0, y0); q.fillStyle = col; q.strokeStyle = col;
    const s = h / 100; q.lineWidth = 17 * s; q.lineCap = 'round';
    q.beginPath(); q.arc(10 * s, 18 * s, 10 * s, 0, Math.PI * 2); q.fill();
    q.beginPath(); q.moveTo(10 * s, 44 * s); q.lineTo(10 * s, 92 * s); q.stroke();
    q.beginPath(); q.arc(58 * s, 68 * s, 24 * s, 0, Math.PI * 2); q.stroke();
    q.beginPath(); q.moveTo(103 * s, 92 * s); q.lineTo(103 * s, 66 * s); q.arc(127 * s, 66 * s, 24 * s, Math.PI, 0); q.lineTo(151 * s, 92 * s); q.stroke();
    q.restore();
  };
  const fit = (q, txt, wt, size, maxW) => { let fs = size; q.font = font(wt, fs); while (q.measureText(txt).width > maxW && fs > 10) { fs -= 1; q.font = font(wt, fs); } };
  // the feature walls: the station's colour, a pattern of its stripes, the
  // ion mark, the name down a white band, GRT at the foot
  names.forEach((nm, i) => cell('fw:' + nm, 96, 240, (q, w, h) => {
    const col = FEATURE[i % FEATURE.length];
    q.fillStyle = col; q.fillRect(0, 0, w, h);
    q.fillStyle = 'rgba(255,255,255,0.18)';
    for (let k = 0; k < 9; k++) q.fillRect(((k * 37) % 80), 150 + (k * 11) % 70, 10 + (k % 3) * 6, 4);
    q.fillStyle = '#ffffff'; q.fillRect(0, 70, w, 72);
    ion(q, 14, 14, 42, '#ffffff');
    q.fillStyle = '#16181b'; q.textAlign = 'center'; q.textBaseline = 'middle';
    const words = nm.split(' ');
    const lines = nm.includes(' - ') ? nm.split(' - ') : words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : words.length === 2 && nm.length > 9 ? words : [nm];
    lines.forEach((ln, j) => { fit(q, ln, 800, 20, w - 8); q.fillText(ln, w / 2, 106 + (j - (lines.length - 1) / 2) * 24); });
    q.fillStyle = '#ffffff'; q.font = `italic ${font(900, 22)}`; q.fillText('GRT', w / 2, h - 22);
  }));
  // the platform's next-train sign, one per direction
  for (const [k, to, m] of [['led:sb', 'Fairway', '3 min'], ['led:nb', 'Conestoga', '4 min']]) cell(k, 384, 48, (q, w, h) => {
    q.fillStyle = '#060606'; q.fillRect(0, 0, w, h);
    q.fillStyle = '#ffa514'; q.font = font(700, 24); q.textBaseline = 'middle'; q.textAlign = 'left';
    q.fillText(`301 ${to}`, 12, h / 2 + 1);
    q.textAlign = 'right'; q.fillText(m, w - 12, h / 2 + 1);
  });
  // the crossbuck: Canada's white X with a red border (one board of it)
  cell('xbuck', 384, 64, (q, w, h) => {
    q.fillStyle = '#c8102e'; q.fillRect(0, 0, w, h);
    q.fillStyle = '#ffffff'; q.fillRect(7, 7, w - 14, h - 14);
  });
  // the canopies' glass: pale blue, fritted with a scatter of white
  // rectangles (Mill's, Kitchener City Hall's), drawn unlit -- it is lit
  // through, so its underside is never in shade
  cell('frit', 128, 128, (q, w, h) => {
    q.fillStyle = '#9ec3e6'; q.fillRect(0, 0, w, h);
    let sd = 11;
    const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 140; k++) { q.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.75)' : 'rgba(40,90,170,0.35)'; q.fillRect(r() * w, r() * h, 3 + r() * 6, 2 + r() * 2); }
  });
  // a validator's screen and the ticket machine's face
  cell('tvm', 96, 160, (q, w, h) => {
    q.fillStyle = '#9aa0a6'; q.fillRect(0, 0, w, h);
    q.fillStyle = '#1f5bb0'; q.fillRect(0, 0, w, 26);
    q.fillStyle = '#ffffff'; q.font = font(800, 16); q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText('TICKETS', w / 2, 13);
    q.fillStyle = '#101418'; q.fillRect(14, 36, w - 28, 48);
    q.fillStyle = '#2b6fd6'; q.fillRect(18, 40, w - 36, 40);
    q.fillStyle = '#2a2d31'; q.fillRect(20, 96, w - 40, 10); q.fillRect(30, 116, w - 60, 26);
  });
  // (packed last: the tall cells fill the first two rows)
  // the name boards: black, the ion mark in ION blue, the name in white
  names.forEach((nm) => cell(nm, 384, 48, (q, w, h) => {
    q.fillStyle = '#0d0e10'; q.fillRect(0, 0, w, h);
    ion(q, 10, 8, 32, '#3f86e0');
    q.fillStyle = '#ffffff'; q.textAlign = 'left'; q.textBaseline = 'middle';
    fit(q, nm, 700, 28, w - 76); q.fillText(nm, 66, h / 2 + 1);
  }));
  if (y + rowH > H) console.warn('ION sign atlas overflows: ' + (y + rowH) + ' > ' + H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide, forceSinglePass: true });
  mat.userData.noShadow = true;
  return { mat, cells };
}

// ---------------------------------------------------------------------------
// The line.

const CHUNK = 500;

export class Link {
  /** From the map data alone, right after the map loads: citygen needs
   *  clearZones() (buildings off the line) before the city exists. */
  constructor(data, md, cache = null) {
    this.data = data;
    // The profile's two solves (from the map alone, then over the city) are
    // deterministic for a build, so a later launch restores them from the
    // boot cache (`cache` = { pre, post }); `cacheOut` is what this one made.
    this.cache = cache;
    this.cacheOut = cache && cache.pre && cache.post ? null : {};
    // A bridge over water clears it: the 2 Line's deck on the I-90 floating
    // bridge rides just over Lake Washington, not 8.5 m over its bed
    const lakes = md ? md.lakes : null;
    this.lakes = lakes;
    const P = { ...LINK, waterAtGrade: true, bridgeFloor: (x, z) => (G.isWater(x, z) ? G.drawnWaterLevel(lakes, x, z) + LINK.floatDeck : -Infinity) };
    this.P = P;
    // The 1 Line's two tracks, and (v161) the 2 Line's: `sb2` / `nb2` ride
    // the 1 Line's rails from the north end to the junction south of
    // International District (`share`), then their own branch east over I-90
    this.keys = ['sb', 'nb', ...(data.sb2 ? ['sb2', 'nb2'] : [])];
    this.tracks = {};
    // (the 1 Line keeps LINK's numbers: its profile is exactly what it was)
    for (const k of this.keys) this.tracks[k] = new LinkTrack(k, data[k], k.endsWith('2') ? P : LINK);
    this.tracks.sb.other = this.tracks.nb; this.tracks.nb.other = this.tracks.sb;
    if (this.tracks.sb2) {
      this.tracks.sb2.other = this.tracks.nb2; this.tracks.nb2.other = this.tracks.sb2;
      for (const [k2, k1] of [['sb2', 'sb'], ['nb2', 'nb']]) {
        const a = this.tracks[k2], b = this.tracks[k1];
        // where the branch leaves: the first sample more than 0.3 m off the parent
        let i = 0;
        while (i < a.n && i < b.n && Math.hypot(a.X[i] - b.X[i], a.Z[i] - b.Z[i]) < 0.3) i++;
        a.share = { track: b, end: i * STEP };
        b.shareBy = a;
      }
    }
    this.lineOf = (k) => (k.endsWith('2') ? 2 : 1);
    this.stations = data.stations.map((q, i) => ({ i, name: q.name.replace('International District Chinatown', 'Intl District/Chinatown').replace('University of Washington', 'Univ of Washington'),
      full: q.name, x: q.x, z: q.z, s: {} }));
    // each station's centre on each track that serves it: the nearest sample
    // to the station's own point (the build's s is along the unsmoothed line)
    for (const st of this.stations) {
      for (const k of this.keys) {
        if (data.stations[st.i]['s_' + k] === undefined) continue;
        const q = this.tracks[k].nearest(st.x, st.z, 120);
        st.s[k] = q ? q.s : data.stations[st.i]['s_' + k];
      }
      st.lines = [...new Set(Object.keys(st.s).map((k) => this.lineOf(k)))];
      // the track whose half of the station is DRAWN: a shared station is the 1 Line's
      // (Auto KW: ION's split stations are on ONE track -- Waterloo Public
      // Square on Caroline, Kitchener City Hall and Frederick on Charles)
      st.key = ['sb', 'nb', 'sb2', 'nb2'].find((k) => st.s[k] !== undefined) || 'sb';
      // where a train stands: the platform's centre, but never with its
      // ends off the rails (both termini's platforms end the track)
      st.stop = {};
      for (const k of Object.keys(st.s)) st.stop[k] = clamp(st.s[k], LINK.len / 2 + 1, this.tracks[k].len - LINK.len / 2 - 1);
      st.plats = data.stations[st.i].plats || [];
    }
    // the termini: the last station each track's trains run to
    for (const k of this.keys) {
      const tr = this.tracks[k], on = this.stations.filter((st) => st.s[k] !== undefined);
      if (!on.length) continue;
      tr.to = on.reduce((a, b) => ((b.s[k] - a.s[k]) * tr.dir > 0 ? b : a));
      tr.from = on.reduce((a, b) => ((b.s[k] - a.s[k]) * tr.dir < 0 ? b : a));
    }
    for (const k of this.keys) {
      const tr = this.tracks[k];
      tr.zones = this.stations.filter((st) => st.s[k] !== undefined).map((st) => {
        const z = [st.s[k] - LINK.platLen / 2 - 12, st.s[k] + LINK.platLen / 2 + 12];
        z.st = st;
        return z;
      });
      // A platform partly in the open is an open station: OSM ends the
      // downtown tunnel halfway along International District's nb platform
      // (the real station is an open cut); the bore starts past its end.
      for (const [z0, z1] of tr.zones) {
        const i0 = tr.idx(z0 + 12), i1 = tr.idx(z1 - 12);
        let open = false;
        for (let i = i0; i <= i1; i++) if (tr.F[i] !== 1) { open = true; break; }
        if (open) for (let i = tr.idx(z0); i <= tr.idx(z1); i++) if (tr.F[i] === 1) tr.F[i] = 0;
      }
    }
    // the open corridor, coarse: 40 m cells within reach of a track that is
    // not in a bore (keepClear's fast reject)
    this.corrCells = new Set();
    for (const tr of Object.values(this.tracks)) {
      for (let i = 0; i < tr.n; i += 8) {
        if (tr.F[i] === 1) continue;
        const cx = Math.floor(tr.X[i] / 40), cz = Math.floor(tr.Z[i] / 40);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.corrCells.add((cx + dx) * 100003 + cz + dz);
      }
    }
    // the profile from the map alone (see _profile)
    if (!this._restore('pre')) this._profile(null);
    if (this.cacheOut) this.cacheOut.pre = this._snapshot();
    this.trains = [];
    this.city = null;
    this.camUnder = false;
    this.tunnelMode = false;
    this.chunks = [];
    this.solids = [];
    this.entrances = [];
  }

  /** Oriented rects over the line that no building may stand in (citygen
   *  2d, the monorail's format): the at-grade and elevated corridor and the
   *  portals. Bores are underground and clear nothing. */
  clearZones() {
    const out = [];
    for (const tr of Object.values(this.tracks)) {
      for (let s = 0; s < tr.len; s += 16) {
        const f = tr.flag(s);
        // a bore clears nothing -- unless its box stands above the ground
        if (f === 1 && tr.kind(s + 8) === TUN) continue;
        const h = tr.heading(s + 8);
        const st = this.stations.find((q) => Math.abs(q.s[tr.key] - s) < LINK.platLen / 2 + 10);
        out.push({ x: tr.x(s + 8), z: tr.z(s + 8), hw: st ? 9 : 4.2, hd: 9.5, rot: -h, y: f === 2 ? -1e9 : -1e9 });
      }
    }
    return out;
  }

  /** Is (x, z) on the line's open corridor (no trees, props or parked cars)? */
  keepClear(x, z) {
    if (!this.corrCells.has(Math.floor(x / 40) * 100003 + Math.floor(z / 40))) return false;
    for (const k of this.keys) {
      const tr = this.tracks[k];
      const q = tr.nearest(x, z, 12);
      if (!q) continue;
      const f = tr.flag(q.s);
      if (f === 1 && tr.KD && tr.KD[tr.idx(q.s)] === TUN) continue;
      const st = this.stations.some((c) => Math.abs(c.s[k] - q.s) < LINK.platLen / 2 + 6);
      if (q.d < (st ? 9 : 3.6)) return true;
    }
    return false;
  }

  /**
   * Each track's profile and what each metre of it is (bore, box, guideway,
   * fill, level crossing). Once from the map alone, before the city is
   * built (clearZones needs to know where a box stands above the ground),
   * and again once it is, over the carved terrain and with its crossings.
   */
  _profile(city) {
    for (const tr of Object.values(this.tracks)) {
      const n = tr.n, KD = new Uint8Array(n);
      for (const z of tr.zones) { z.length = 2; delete z.level; }
      // Level crossings: a track at grade whose centreline is on a carriageway
      // that CROSSES it -- one that also covers the track 11 m either way
      // along is a street the track runs in or beside (MLK Jr Way's median),
      // not a crossing. Found first: the rail comes down to the road there.
      const X = new Uint8Array(n);
      for (let i = 0; i < n && city; i += 2) {
        if (tr.F[i] !== 0) continue;
        const x = tr.X[i], z = tr.Z[i];
        if (!city.onRoad(x, z, 0.6, false, false)) continue;
        const fx = Math.sin(tr.H[i]) * 11, fz = Math.cos(tr.H[i]) * 11;
        if (city.onRoad(x + fx, z + fz, 0, false, false) && city.onRoad(x - fx, z - fz, 0, false, false)) continue;
        X[i] = 1; if (i + 1 < n) X[i + 1] = 1;
      }
      // the rail stays down for a few metres either side of the paving
      const XW = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (X[i]) for (let j = Math.max(0, i - 6); j <= Math.min(n - 1, i + 6); j++) XW[j] = 1;
      // Auto KW: where ION runs in the street (embedded track on a raised
      // trackway; its height stays LINK.lift: the city's sidewalks beside it
      // stand ~0.5 m over the smoothed ground, and a lower trackway sank
      // under them)
      if (city) tr.ST = this._streetMask(tr, city);
      tr._X = X; tr._XW = XW;
      tr.setHeights(tr.zones, XW);
      tr.KD = KD;
      this._kinds(tr);
    }
    // A station's two tracks at ONE level (an island platform, a hall or a
    // deck shared between them): the lower of the two for a bore, the higher
    // on the guideway; then both profiles again.
    let redo = false;
    for (const [ka, kb] of [['sb', 'nb'], ['sb2', 'nb2']]) {
      const A = this.tracks[ka], B = this.tracks[kb];
      if (!A) continue;
      for (const a of A.zones) {
        const b = B.zones.find((z) => z.st === a.st);
        if (!b || a.level === undefined || b.level === undefined) continue;
        const bore = A.F[A.idx(a.st.s[ka])] === 1;
        const y = bore ? Math.min(a.level, b.level) : Math.max(a.level, b.level);
        a[2] = y; b[2] = y; redo = true;
      }
    }
    if (redo) for (const tr of Object.values(this.tracks)) { tr.setHeights(tr.zones, tr._XW); this._kinds(tr); }
    this._joinShared();
  }

  /**
   * Where a track RUNS IN THE STREET (King St, Charles St, Northfield Dr...):
   * at grade with a carriageway beside it within 9 m, or under the track
   * itself for 11 m either way -- sampled every 10 m, and only runs of 60 m
   * or more (a road crossing the corridor is a crossing, not a street).
   */
  _streetMask(tr, city) {
    const n = tr.n, m = Math.ceil(n / 10), R = new Uint8Array(m), out = new Uint8Array(n);
    for (let j = 0; j < m; j++) {
      const i = Math.min(n - 1, j * 10);
      if (tr.F[i] !== 0) continue;
      const h = tr.H[i], lx = Math.cos(h), lz = -Math.sin(h), fx = Math.sin(h) * 11, fz = Math.cos(h) * 11;
      const x = tr.X[i], z = tr.Z[i];
      let on = false;
      for (const o of [-9, 9]) if (city.onRoad(x + lx * o, z + lz * o, 2, false, false)) on = true;
      if (!on && city.onRoad(x, z, 0.6, false, false) && city.onRoad(x + fx, z + fz, 0, false, false) && city.onRoad(x - fx, z - fz, 0, false, false)) on = true;
      R[j] = on ? 1 : 0;
    }
    for (let j = 0; j < m;) {
      let k = j;
      while (k < m && R[k] === R[j]) k++;
      if (R[j] && k - j >= 6) out.fill(1, j * 10, Math.min(n, k * 10));
      j = k;
    }
    return out;
  }

  /** Everything _profile leaves on the tracks, for the boot cache. */
  _snapshot() {
    const out = {};
    for (const [k, tr] of Object.entries(this.tracks)) {
      out[k] = { Y: tr.Y.slice(), KD: tr.KD.slice(), GR: tr.GR.slice(), X: tr._X.slice(), XW: tr._XW.slice(), ST: tr.ST ? tr.ST.slice() : null,
        zones: tr.zones.map((z) => [z.level === undefined ? null : z.level, z.length > 2 ? z[2] : null]) };
    }
    return out;
  }

  /** _profile's results from the boot cache, if they fit these tracks. */
  _restore(which) {
    const snap = this.cache && this.cache[which];
    if (!snap) return false;
    const ok = Object.entries(this.tracks).every(([k, tr]) => snap[k] && snap[k].Y.length === tr.n && snap[k].zones.length === tr.zones.length);
    if (!ok) {
      this.cacheOut = this.cacheOut || {};
      if (which === 'post' && this.cache.pre) this.cacheOut.pre = this.cache.pre;
      return false;
    }
    for (const [k, tr] of Object.entries(this.tracks)) {
      const q = snap[k];
      tr.Y = q.Y; tr.KD = q.KD; tr.GR = q.GR; tr._X = q.X; tr._XW = q.XW; if (q.ST) tr.ST = q.ST;
      tr.zones.forEach((z, i) => {
        z.length = 2; delete z.level;
        if (q.zones[i][1] !== null) z[2] = q.zones[i][1];
        if (q.zones[i][0] !== null) z.level = q.zones[i][0];
      });
    }
    return true;
  }

  /** The 2 Line's shared rails ARE the 1 Line's: the same profile and kinds
   *  as far as the junction, eased back to its own over 250 m past it. */
  _joinShared() {
    for (const tr of Object.values(this.tracks)) {
      if (!tr.share) continue;
      const p = tr.share.track, iE = tr.idx(tr.share.end);
      for (let i = 0; i < iE && i < p.n; i++) { tr.Y[i] = p.Y[i]; tr.KD[i] = p.KD[i]; tr.GR[i] = p.GR[i]; if (p._X) tr._X[i] = p._X[i]; }
      const d = p.Y[Math.min(iE, p.n - 1)] - tr.Y[iE];
      for (let k = 0; k < 250 && iE + k < tr.n; k++) tr.Y[iE + k] += d * (1 - k / 250);
    }
  }

  _kinds(tr) {
    for (let i = 0; i < tr.n; i++) {
      const f = tr.F[i], y = tr.Y[i], g = tr.GR[i];
      // a bore that starts in the air (the 40 m ground cannot see the
      // hillside its portal is in) is guideway until it meets the ground
      if (f === 1) tr.KD[i] = y + LINK.roofOut < g - 0.4 ? TUN : y - g > 3.4 ? DECK : BOX;
      else if (y - g > 3.4) tr.KD[i] = DECK;
      else tr.KD[i] = tr._X[i] ? CROSS : FILL;
    }
  }

  /** The city is built: the profile again over the carved terrain, speed
   *  limits, the at-grade corridor, the station entrances. */
  attach(city) {
    this.city = city;
    // ON I-90 THE RAILS ARE IN THE CENTRE ROADWAY, level with the traffic
    // either side of them: over the lake a 2 Line bridge rides the road
    // decks beside it (what the city draws), else just over the water
    const floorMemo = new Map();   // _profile runs setHeights twice: sample the city once
    this.P.bridgeFloor = (x, z) => {
      if (!G.isWater(x, z)) return -Infinity;
      const key = Math.round(x * 4) * 1e6 + Math.round(z * 4);
      const hit = floorMemo.get(key);
      if (hit !== undefined) return hit;
      const f = floorAt(x, z);
      floorMemo.set(key, f);
      return f;
    };
    const floorAt = (x, z) => {
      const wl = G.drawnWaterLevel(this.lakes, x, z);
      let deck = -Infinity;
      for (let a = 0; a < 8; a++) {
        for (const r of [9, 13]) {
          const px = x + Math.cos(a * Math.PI / 4) * r, pz = z + Math.sin(a * Math.PI / 4) * r;
          const y = city.groundAt(px, pz, null);
          if (y > wl + 1 && city.onRoad(px, pz, 0, true)) deck = Math.max(deck, y);
        }
      }
      return Math.max(wl + LINK.floatDeck, deck + 0.25);
    };
    if (!this._restore('post')) this._profile(city);
    if (this.cacheOut) this.cacheOut.post = this._snapshot();
    for (const tr of Object.values(this.tracks)) {
      const n = tr.n, KD = tr.KD, LIM = new Float32Array(n);
      // Speed limits (Auto KW, ION's): 70 km/h on the rail corridor, 40 in
      // the street, 25 where the pedestrians are -- through Uptown Waterloo
      // and downtown Kitchener [WP: "as low as 20-25 km/h"] -- 40 over a
      // level crossing; curves at aLat.
      if (!tr.ST) tr.ST = this._streetMask(tr, city);
      const slow = this.stations.filter((st) => /Willis Way|Public Square|City Hall|Victoria Park|Queen|Frederick/.test(st.name));
      for (let i = 0; i < n; i += 10) {
        let v = LINK.vMax;
        if (tr.ST[i] || KD[i] === CROSS) {
          v = LINK.vStreet;
          if (tr.ST[i] && slow.some((st) => Math.hypot(tr.X[i] - st.x, tr.Z[i] - st.z) < 420)) v = LINK.vSlow;
        }
        let k = 0;
        for (let j = Math.max(0, i - 20); j <= Math.min(n - 1, i + 20); j++) k = Math.max(k, Math.abs(tr.K[j]));
        if (k > 1e-4) v = Math.min(v, Math.max(6, Math.sqrt(LINK.aLat / k)));
        for (let j = i; j < Math.min(n, i + 10); j++) LIM[j] = v;
      }
      tr.LIM = LIM;
    }
    // the at-grade corridor, coarse: which 50 m cells hold a track at grade
    this.gradeCells = new Set();
    for (const tr of Object.values(this.tracks)) {
      for (let i = 0; i < tr.n; i += 8) {
        if (tr.KD[i] !== FILL && tr.KD[i] !== CROSS) continue;
        const cx = Math.floor(tr.X[i] / 50), cz = Math.floor(tr.Z[i] / 50);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.gradeCells.add((cx + dx) * 100003 + cz + dz);
      }
    }
    this._entrances();
  }

  /** Where each station is entered from the street: the nearest open, dry
   *  ground off the road and out of any building near the station's point. */
  _entrances() {
    const city = this.city;
    const inBld = (x, z) => city.buildingsNear(x, z, 20).some((b) => {
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) < b.w / 2 + 2 && Math.abs(lz) < b.d / 2 + 2;
    });
    for (const st of this.stations) {
      const sb = this.tracks[st.key], sS = st.s[st.key];
      const under = sb.kind(sS) === TUN;
      const cx = sb.x(sS), cz = sb.z(sS);
      let best = null;
      for (let r = under ? 10 : 12; r < 160 && !best; r += 5) {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
          if (G.isWater(x, z) || city.onRoad(x, z, 2.2) || inBld(x, z)) continue;
          if (!under && this.keys.some((kk) => this.tracks[kk].nearest(x, z, 8))) continue;
          const y = city.groundAt(x, z, null);
          if (Math.abs(y - G.terrainHeight(x, z)) > 1.2) continue;
          // face the station
          best = { x, z, y, h: Math.atan2(cx - x, cz - z) };
          break;
        }
      }
      if (!best) best = { x: cx + 12, z: cz, y: G.terrainHeight(cx + 12, cz), h: 0 };
      st.ent = best;
      st.under = under;
      st.elevated = sb.kind(sS) === DECK;
    }
  }

  // --- the structure ------------------------------------------------------------

  /** Everything static: bed, rails and wires, guideway, boxes, bores, the
   *  stations. Chunked by 500 m so each piece culls, with the near detail
   *  (rails, wires) and the bores switched separately. */
  build(scene, world) {
    this.world = world;
    this.bedMat = new THREE.MeshStandardMaterial({ map: bedTexture(), vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.5, alphaTest: 0.5, side: THREE.DoubleSide });
    this.cardMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const sign = signAtlas(this.stations.map((s) => s.name));
    this.signMat = sign.mat; this.signCells = sign.cells;
    // LAZY: the pass below draws into builders that keep nothing and files
    // what drew where (build.js LazyChunks); a chunk's geometry is made when
    // you come within range of it (update -> _buildChunk) and let go past it.
    const L = this.lazy = new LazyChunks(CHUNK, (sink) => {
      const mk = (uv) => (sink ? new SinkBuilder() : new ChunkBuilder(uv, 64));
      return { bed: mk(true), flat: mk(false), near: mk(false), tun: mk(false), card: mk(false), sign: mk(true) };
    });
    const chunk = L.record;
    // each station's platforms first: the track pass keeps its ballast and
    // fences off them, the poles go round them
    for (const st of this.stations) for (const k of this.keys) if (st.s[k] !== undefined) this._stationPlan(st, this.tracks[k]);
    for (const tr of Object.values(this.tracks)) this._buildTrack(tr, chunk, null, L);
    // each track's half of each station it serves -- a shared station once,
    // by the 1 Line's tracks
    this.stations.forEach((st, si) => {
      for (const k of this.keys) {
        const tr = this.tracks[k];
        if (st.s[k] === undefined || (tr.share && st.s[k] < tr.share.end + 70)) continue;
        L.op({ st: si, t: k });
        this._buildStation(st, tr, chunk);
      }
    });
    this.stations.forEach((st, si) => { L.op({ ent: si }); this._buildEntrance(st, chunk); });
    this._findCrossings();
    this.crossings.forEach((c, ci) => { L.op({ cross: ci }); this._buildCrossing(c, chunk); });
    L.op(null);
    // meshes
    this.group = new THREE.Group(); this.group.name = 'link';
    this.tunGroup = new THREE.Group(); this.tunGroup.name = 'link:bores'; this.tunGroup.visible = false;
    for (const e of L.chunks) {
      e.bed = e.flat = e.near = e.tun = e.card = e.sign = null;
      this.chunks.push(e);
    }
    scene.add(this.group);
    scene.add(this.tunGroup);
    this._buildPoles(scene);
    this._buildGateArms(scene);
    if (this.city && this.city.setLandmarkSolids && this.solids.length) {
      this.city.setLandmarkSolids([...(this.city.landmarkSolids || []), ...this.solids]);
    }
    if (this.city && this.city.setPlatforms && this.platforms && this.platforms.length) {
      this.city.setPlatforms([...(this.city.platforms || []), ...this.platforms]);
    }
  }

  // --- the overhead line's poles ---------------------------------------------------

  /**
   * THE POLES, as ION's: round grey steel, a cantilever of two tubes over the
   * track (the messenger's support over the registration arm) with a stay,
   * the insulators by the pole. A centre pole between the two tracks where
   * they run 3-6.5 m apart (an arm each way -- two instances), else a side
   * pole 3 m off the outer rail; ~50 m apart (35 on curves), never on a
   * carriageway. All of them are ONE InstancedMesh, refilled with the poles
   * within RANGE.near of the camera (update, _polesUpdate): one draw.
   * An instance's arm length rides in `armK` (the arm, not the pole, scales).
   */
  _buildPoles(scene) {
    const city = this.city, poles = [];
    const ok = (x, z) => !city.onRoad(x, z, 0.5, false, false) && !G.isWater(x, z);
    for (const k of ['sb', 'nb']) {
      const tr = this.tracks[k];
      if (!tr) continue;
      const other = tr.other;
      let next = 20;
      for (let s = 20; s < tr.len - 10; s += 2) {
        if (s < next) continue;
        const kd = tr.kind(s);
        if (kd === TUN || kd === BOX || kd === DECK) continue;
        if (tr._X && tr._X[tr.idx(s)]) continue;                 // not in the road at a crossing
        const P = frame(tr, s);
        const q = other.nearest(P.x, P.z, 20);
        const d = q ? q.d : 99;
        const toward = q ? ((other.x(q.s) - P.x) * P.lx + (other.z(q.s) - P.z) * P.lz >= 0 ? 1 : -1) : 1;
        // the platform's side at a station: the pole goes on the other side (or between, at a centre platform)
        const st = this.stations.find((c) => c.plan && c.plan[k] && s > c.plan[k].a0 - 3 && s < c.plan[k].a1 + 3);
        const pl = st && st.plan[k];
        let placed = false;
        if (d > 3 && d < 6.5 && (!pl || pl.island)) {
          // a centre pole: placed by sb only, between the two
          if (k === 'sb') {
            const x = P.x + P.lx * toward * d / 2, z = P.z + P.lz * toward * d / 2;
            if (ok(x, z)) {
              const ang = Math.atan2(P.lx * toward, P.lz * toward);    // local +x toward the other track
              poles.push({ x, z, y: P.y, ang, arm: d / 2 }, { x, z, y: P.y, ang: ang + Math.PI, arm: d / 2 });
              placed = true;
            }
          } else placed = true;
        } else if (d >= 6.5 || !pl || !pl.island) {
          const sides = pl ? [-pl.sg] : d < 6.5 ? [-toward] : [-toward, toward];
          for (const sg of sides) {
            const x = P.x + P.lx * 3.0 * sg, z = P.z + P.lz * 3.0 * sg;
            if (!ok(x, z)) continue;
            poles.push({ x, z, y: P.y, ang: Math.atan2(-P.lx * sg, -P.lz * sg), arm: 3.0 });
            placed = true;
            break;
          }
        }
        next = s + (placed ? (Math.abs(tr.curv(s)) > 1 / 400 ? 34 : 48) : 6);
      }
    }
    this.poles = poles;
    // the pole and its cantilever, local +x toward the track, y = 0 the rail head
    const b = new Builder(false), STEEL = C.pole, INS = [0.42, 0.24, 0.13];
    b.tube([0, -4.0, 0], [0, 7.0, 0], 0.13, 8, STEEL, true);
    b.tube([0, 6.55, 0], [3.25, 6.0, 0], 0.035, 5, STEEL);            // the stay over the messenger's support
    b.tube([0.12, 6.0, 0], [3.3, 6.0, 0], 0.04, 6, STEEL);            // the messenger's support
    b.tube([0.12, 5.25, 0], [2.6, 5.12, 0], 0.035, 5, STEEL);         // the registration tube
    b.tube([2.55, 5.12, 0], [3.0, LINK.wire + 0.02, 0], 0.018, 4, STEEL);
    for (const y of [6.0, 5.22]) b.tube([0.2, y, 0], [0.62, y, 0], 0.07, 6, INS);
    b.box(0.12, 4.0, 0, 0.12, 0.6, 0.34, 0, [0.30, 0.32, 0.34]);          // the switch box
    const geo = b.build();
    const n = Math.max(1, poles.length);
    geo.setAttribute('armK', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.6 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float armK;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  if (transformed.x > 0.2) transformed.x = 0.2 + (transformed.x - 0.2) * armK;');
    };
    mat.customProgramCacheKey = () => 'ionPoleArm';
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = 'link:poles';
    mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.count = 0;
    scene.add(mesh);
    this.poleMesh = mesh;
    // a grid of 200 m cells for the range query
    this.poleCells = new Map();
    poles.forEach((p, i) => {
      const kk = Math.floor(p.x / 200) * 100003 + Math.floor(p.z / 200);
      if (!this.poleCells.has(kk)) this.poleCells.set(kk, []);
      this.poleCells.get(kk).push(i);
    });
    this._poleAt = null;
  }

  /** Refill the poles' instances with those near the camera (every 25 m it moves). */
  _polesUpdate(cx, cz) {
    const m = this.poleMesh;
    if (!m) return;
    if (this._poleAt && Math.hypot(cx - this._poleAt[0], cz - this._poleAt[1]) < 25) return;
    this._poleAt = [cx, cz];
    const R = RANGE.near + 60, c0x = Math.floor((cx - R) / 200), c1x = Math.floor((cx + R) / 200);
    const c0z = Math.floor((cz - R) / 200), c1z = Math.floor((cz + R) / 200);
    const M = new THREE.Matrix4(), arm = m.geometry.attributes.armK;
    let n = 0;
    for (let gx = c0x; gx <= c1x; gx++) for (let gz = c0z; gz <= c1z; gz++) {
      const l = this.poleCells.get(gx * 100003 + gz);
      if (!l) continue;
      for (const i of l) {
        const p = this.poles[i];
        if ((p.x - cx) ** 2 + (p.z - cz) ** 2 > R * R) continue;
        // local +x along `ang` (a compass-style angle: x = sin, z = cos)
        const s = Math.sin(p.ang), c = Math.cos(p.ang);
        M.set(s, 0, -c, p.x, 0, 1, 0, p.y, c, 0, s, p.z, 0, 0, 0, 1);
        m.setMatrixAt(n, M);
        arm.array[n] = p.arm / 3.0;
        n++;
      }
    }
    m.count = n;
    m.visible = n > 0;             // (an empty instanced draw is still a draw)
    m.instanceMatrix.needsUpdate = true;
    arm.needsUpdate = true;
  }

  // --- level crossings -------------------------------------------------------------

  /**
   * The level crossings: runs of CROSS on either track, merged where both
   * tracks cross the same road, each with the road it carries. Gates where
   * OSM has crossing:barrier on the line within 16 m (Northfield, Bearinger,
   * Columbia, University, Seagram, Erb, Ottawa, Mill, Hayward, Block Line,
   * Courtland, Wilson... -- ION's gated crossings), flashing lights alone
   * where it has only crossing:light; nothing in the street (signals there).
   */
  _findCrossings() {
    const city = this.city, pts = [];
    for (const k of ['sb', 'nb']) {
      const tr = this.tracks[k];
      if (!tr || !tr._X) continue;
      for (let i = 0; i < tr.n;) {
        if (!tr._X[i]) { i++; continue; }
        let j = i;
        while (j < tr.n && tr._X[j]) j++;
        const m = (i + j - 1) >> 1;
        pts.push({ k, s: m, x: tr.X[m], z: tr.Z[m], h: tr.H[m], street: !!(tr.ST && tr.ST[m]) });
        i = j;
      }
    }
    const out = [];
    for (const p of pts) {
      let c = out.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 16);
      if (!c) { c = { x: p.x, z: p.z, h: p.h, s: {}, street: p.street }; out.push(c); }
      c.s[p.k] = p.s;
    }
    const osm = this.data.crossings || [];
    for (const c of out) {
      for (const k of ['sb', 'nb']) {
        if (c.s[k] === undefined) { const q = this.tracks[k].nearest(c.x, c.z, 14); if (q) c.s[k] = q.s; }
      }
      // in the street only a ROAD crossing's own gates and lights count (a
      // signalised junction has neither; a footpath's gates are its own)
      const near = osm.filter((o) => Math.hypot(o.x - c.x, o.z - c.z) < 16);
      c.gate = near.some((o) => o.gate && (o.road || !c.street));
      c.lights = c.gate || near.some((o) => (o.light || o.bell) && (o.road || !c.street));
      // the road: the nearest carriageway crossing the track at 25 deg or more
      let best = null, bd = 1e9;
      for (const ei of city.edgesNear(c.x, c.z, 30)) {
        const e = city.edges[ei];
        if (e.tunnel || e.elev || e.prof) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        const sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz || 1;
        const t = clamp(((c.x - a.x) * sx + (c.z - a.z) * sz) / l2, 0, 1);
        const d = Math.hypot(a.x + sx * t - c.x, a.z + sz * t - c.z);
        const cr = Math.abs(e.dx * Math.cos(c.h) - e.dz * Math.sin(c.h));
        if (d < e.hw + 2 && cr > 0.42 && d < bd) { bd = d; best = e; }
      }
      c.road = best;
      const q0 = this.tracks.sb.nearest(c.x, c.z, 20), q1 = this.tracks.nb.nearest(c.x, c.z, 20);
      c.spread = q0 && q1 ? Math.hypot(this.tracks.sb.x(q0.s) - this.tracks.nb.x(q1.s), this.tracks.sb.z(q0.s) - this.tracks.nb.z(q1.s)) : 0;
      c.active = false; c.arm = 0; c.flash = 0; c.bellT = 0; c.lightT = 0;
    }
    this.crossings = out.filter((c) => c.road && c.lights);
    this.crossCells = xingIndex(this.crossings);
  }

  /** A crossing's signal masts (static parts), and its arms' pivots: Canada's
   *  -- a white mast, the red-bordered white crossbuck at its head, two red
   *  lamps on a black backboard, the bell, the gate's mechanism. */
  _buildCrossing(c, chunk) {
    const ch = chunk(c.x, c.z);
    buildXingMast(c, ch.flat, ch.sign, this._cellUV('xbuck'), {
      groundAt: (x, z) => (this.city.groundAt ? this.city.groundAt(x, z, null) : G.terrainHeight(x, z)),
      solids: this.solids,
      onRoad: (x, z) => !!(this.city.onRoad && this.city.onRoad(x, z, 0.5, false, false)),
    });
  }

  /** Every gate arm and every lit lamp in one instanced draw each, posed near you (xing.js). */
  _buildGateArms(scene) {
    this.xsig = new XingSignals(scene, this.world.mats, this.crossings || [], 'link');
    this.armMesh = this.xsig.armMesh; this.lampMesh = this.xsig.lampMesh;
  }

  /** Gates down, lights flashing and the bell ringing for any train near. */
  _crossingsUpdate(dt, cx, cz) {
    if (!this.crossings || !this.xsig) return;
    this.xsig.update(this.crossings, dt, cx, cz, RANGE.near, this.audio, (c) => {
      // active: a train will be on it within ~22 s (or 110 m), or is on it
      for (const t of this.trains) {
        if (t.state === 'off') continue;
        const s = c.s[t.track.key];
        if (s === undefined) continue;
        const ahead = (s - t.lead) * t.dir, behindTail = (s - t.tail) * t.dir;
        const sp = Math.abs(t.u);
        // standing at a platform short of it (a dwell), the circuit times out
        const reach = sp < 0.05 ? 12 : Math.max(110, sp * 22);
        if (ahead > -2 && ahead < reach) return true;
        if (ahead <= 0 && behindTail >= -6) return true;
      }
      return false;
    });
  }

  /** Is (x, z) between a crossing's gates while they are coming down (or a train is on it)? */
  crossingClosed(x, z) { return xingClosed(this.crossCells, this.crossings, x, z, 4.8); }

  /** What LazyChunks.stream drives: replay an op (the pass's other output --
   *  solids, platforms -- was kept at boot, so the replay's is thrown away),
   *  make and let go of a chunk's meshes, and set what of it is drawn. */
  _lazySys() {
    if (this._sys) return this._sys;
    const parts = ['bed', 'flat', 'near', 'tun', 'card', 'sign'];
    this._sys = {
      run: (o, fn) => {
        const keep = [this.solids, this.platforms];
        this.solids = []; this.platforms = [];
        try {
          if (o.seg) this._buildTrack(this.tracks[o.t], fn, o);
          else if (o.st !== undefined) this._buildStation(this.stations[o.st], this.tracks[o.t], fn);
          else if (o.ent !== undefined) this._buildEntrance(this.stations[o.ent], fn);
          else if (o.cross !== undefined) {
            const c = this.crossings[o.cross], gates = c.gates;
            try { this._buildCrossing(c, fn); } finally { c.gates = gates; }
          }
        } finally { this.solids = keep[0]; this.platforms = keep[1]; }
      },
      finish: (e, B) => {
        const key = e.key, mats = this.world.mats;
        const mk = (b, mat, name, shadow, grp) => {
          if (b.empty) return null;
          const m = new THREE.Mesh(b.build(), mat);
          m.name = name; m.castShadow = shadow; m.receiveShadow = shadow;
          m.matrixAutoUpdate = false;
          if (this.dropArrays) dropStaticArrays(m);
          grp.add(m);
          return m;
        };
        e.bed = mk(B.bed, this.bedMat, `link:bed:${key}`, false, this.group);
        e.flat = mk(B.flat, mats.flat, `link:${key}`, true, this.group);
        e.near = mk(B.near, mats.flat, `link:near:${key}`, false, this.group);
        e.tun = mk(B.tun, mats.glow, `link:bore:${key}`, false, this.tunGroup);
        e.card = mk(B.card, this.cardMat, `link:mouth:${key}`, false, this.group);
        e.sign = mk(B.sign, this.signMat, `link:sign:${key}`, false, this.group);
        if (e.bed) e.bed.receiveShadow = true;
        if (this.onChunkChange) this.onChunkChange(e.x, e.z, CHUNK * 0.71);
      },
      drop: (e) => {
        for (const k of parts) {
          const m = e[k];
          if (!m) continue;
          m.parent.remove(m);
          m.geometry.dispose();
          e[k] = null;
        }
        if (this.onChunkChange) this.onChunkChange(e.x, e.z, CHUNK * 0.71);
      },
      visible: (e, d) => {
        const R = RANGE, tm = this.tunnelMode;
        if (e.bed) e.bed.visible = !tm && d < R.bed;
        if (e.flat) e.flat.visible = d < (tm ? 300 : R.flat);
        if (e.near) e.near.visible = !tm && d < R.near;
        if (e.sign) e.sign.visible = d < R.sign;
        if (e.card) e.card.visible = !tm && d < R.flat;
        if (e.tun) e.tun.visible = d < 900;
      },
    };
    return this._sys;
  }

  /** Every chunk built now (harnesses: geometry hashes). */
  buildAllChunks() { for (const e of this.chunks) if (!e.built) this.lazy.now(e, this._lazySys()); }

  /** The whole pass (`only` null, recording into `L`), or one chunk's
   *  recorded segments of this track (`only`: { k, st } from LazyChunks). */
  _buildTrack(tr, chunk, only = null, L = null) {
    const other = tr.other, DS = 4;
    const gauge = LINK.gauge / 2 + 0.035;
    const outer = []; // per station: which side is away from the other track
    const segs = Math.ceil(tr.len / DS);
    let pole = 25;
    let colNext = 18;
    const seg = (k, F0) => {
      const s0 = k * DS, s1 = Math.min(tr.len, s0 + DS), sm = (s0 + s1) / 2;
      const F1 = frame(tr, s1);
      const A = F0, B = F1;
      // the 2 Line's shared rails are the 1 Line's, drawn once
      if (tr.share && s1 < tr.share.end - 1) return F1;
      const kind = tr.kind(sm);
      if (L) L.segment(tr.key, k, pole, colNext);
      const c = chunk(tr.x(sm), tr.z(sm));
      const q = other.nearest(tr.x(sm), tr.z(sm), 40);
      const otherD = q ? q.d : 99, towardOther = q ? (() => {
        const dx = other.x(q.s) - tr.x(sm), dz = other.z(q.s) - tr.z(sm);
        return dx * A.lx + dz * A.lz >= 0 ? 1 : -1;
      })() : 1;
      outer.push(-towardOther);
      const inStation = this.stations.some((st) => {
        const p = st.plan && st.plan[tr.key];
        return p ? sm > p.a0 - 2 && sm < p.a1 + 2 : Math.abs(st.s[tr.key] - sm) < LINK.platLen / 2 + 2;
      });
      // running in the street (tr.ST, attach): embedded track on its own
      // curbed concrete trackway, no ballast and no fence
      const ist = tr.idx(sm), street = !!(tr.ST && tr.ST[ist]);
      // an underground station's hall replaces the bore round it (_buildStation)
      const inHall = kind === TUN && this.stations.some((st) => Math.abs(st.s[tr.key] - sm) < LINK.platLen / 2 + 6);
      const bedB = kind === TUN ? c.tun : c.bed;
      const railB = kind === TUN ? c.tun : c.near;
      // --- the bed -------------------------------------------------------------
      const v0 = s0 / 2.4, v1 = s1 / 2.4;
      if (kind === CROSS && !street) {
        // a level crossing: paved flush with the rail heads
        band(c.flat, A, B, -2.2, -0.03, 2.2, -0.03, UP, C.paving);
      } else if (street && (kind === FILL || kind === CROSS)) {
        // EMBEDDED TRACK: concrete flush with the rail heads, out to meet the
        // other track's where they run together, a kerb down to the street
        const wi = otherD < 6.5 ? otherD / 2 + 0.03 : 1.8, wo = 1.8;
        const oi = wi * towardOther, oo = -wo * towardOther;
        band(c.flat, A, B, oo, -0.025, oi, -0.025, UP, kind === CROSS ? C.paving : C.slab);
        if (kind !== CROSS) {
          band(c.flat, A, B, oo, -0.025, oo, -LINK.liftX - 0.25, side(A, -towardOther), C.concreteD);
          if (otherD >= 6.5) band(c.flat, A, B, oi, -0.025, oi, -LINK.liftX - 0.25, side(A, towardOther), C.concreteD);
          // the joints across the slab, every 4 m
          band(c.flat, A, frame(tr, s0 + 0.08), oo, -0.02, oi, -0.02, UP, C.concreteD);
        }
      } else if (kind === TUN) {
        band(bedB, A, B, -1.5, -0.17, 1.5, -0.17, UP, [0.1, 0.1, 0.1]);
        // sleepers as darker bars, one a metre (unlit, no texture here)
        for (let s = Math.ceil(s0); s < s1; s += 1) {
          const T = frame(tr, s), T2 = frame(tr, s + 0.26);
          band(bedB, T, T2, -1.3, -0.15, 1.3, -0.15, UP, [0.19, 0.185, 0.18]);
        }
      } else {
        bedB.quad(at(A, -1.5, -0.17), at(A, 1.5, -0.17), at(B, 1.5, -0.17), at(B, -1.5, -0.17), UP, [0, v0, BED_U, v0, BED_U, v1, 0, v1], [1, 1, 1]);
        if (kind === FILL || kind === BOX) {
          // ballast shoulders down to the ground (plain ballast: the texture's edge)
          for (const sg of [1, -1]) {
            const gA = G.terrainHeight(A.x + A.lx * 2.4 * sg, A.z + A.lz * 2.4 * sg), gB = G.terrainHeight(B.x + B.lx * 2.4 * sg, B.z + B.lz * 2.4 * sg);
            const yA = Math.min(A.y - 0.45, Math.max(gA, A.y - 1.2)), yB = Math.min(B.y - 0.45, Math.max(gB, B.y - 1.2));
            bedB.quad(at(A, 1.5 * sg, -0.17), atY(A, 2.4 * sg, yA), atY(B, 2.4 * sg, yB), at(B, 1.5 * sg, -0.17), [A.lx * sg * 0.4, 1, A.lz * sg * 0.4], [0.01, v0, 0.025, v0, 0.025, v1, 0.01, v1], [0.92, 0.9, 0.86]);
            // on a fill higher than its shoulder: a retaining wall to the ground
            const dA = yA - gA, dB = yB - gB;
            if (kind === FILL && (dA > 0.25 || dB > 0.25) && !inStation) {
              c.flat.quad(atY(A, 2.4 * sg, yA + 0.2), atY(B, 2.4 * sg, yB + 0.2), atY(B, 2.4 * sg, gB - 0.4), atY(A, 2.4 * sg, gA - 0.4), side(A, sg), uv0, C.concrete);
              c.flat.quad(atY(A, 2.4 * sg, yA + 0.2), atY(B, 2.4 * sg, yB + 0.2), atY(B, 2.1 * sg, yB + 0.2), atY(A, 2.1 * sg, yA + 0.2), UP, uv0, C.concreteL);
            }
          }
        }
      }
      // --- the corridor's fence --------------------------------------------------
      // black chain-link along the rail corridor's edge (the far side of the
      // pair), not at platforms or within 18 m of a crossing (bed texture's
      // right half, cut out by the bed material's alphaTest)
      if (kind === FILL && !street && !inStation && tr._X) {
        let nearX = false;
        for (let j = Math.max(0, ist - 18); j <= Math.min(tr.n - 1, ist + 18) && !nearX; j += 2) if (tr._X[j]) nearX = true;
        if (!nearX) {
          for (const sg of otherD < 9 ? [-towardOther] : [1, -1]) {
            const pA = at(A, 3.75 * sg, 0), pB = at(B, 3.75 * sg, 0);
            if (G.isWater(pA[0], pA[2]) || this.city.onRoad(pA[0], pA[2], 0.8, false, false) || this.city.onRoad(pB[0], pB[2], 0.8, false, false)) continue;
            const gA = G.terrainHeight(pA[0], pA[2]), gB = G.terrainHeight(pB[0], pB[2]);
            if (Math.abs(gA - A.y) > 3) continue;
            c.bed.quad([pA[0], gA - 0.05, pA[2]], [pB[0], gB - 0.05, pB[2]], [pB[0], gB + 1.8, pB[2]], [pA[0], gA + 1.8, pA[2]], side(A, -sg),
              [0.505, v0, 0.505, v1, 0.995, v1, 0.995, v0], [1, 1, 1]);
            const sp = Math.ceil(s0 / 3) * 3;
            if (sp < s1) {
              const T = frame(tr, sp), px = T.x + T.lx * 3.75 * sg, pz = T.z + T.lz * 3.75 * sg, gy = G.terrainHeight(px, pz);
              c.near.box(px, gy - 0.1, pz, 0.06, 1.95, 0.06, -T.h, C.post);
            }
          }
        }
      }
      // --- rails ---------------------------------------------------------------
      for (const o of [-gauge, gauge]) {
        if (kind === CROSS || (street && kind === FILL)) {
          band(railB, A, B, o - 0.035, 0.0, o + 0.035, 0.0, UP, C.railTop);
          band(railB, A, B, o - 0.1, -0.012, o - 0.035, -0.012, UP, C.black);
          continue;
        }
        band(railB, A, B, o - 0.035, 0, o + 0.035, 0, UP, kind === TUN ? [0.5, 0.5, 0.52] : C.railTop);
        for (const sg of [-1, 1]) band(railB, A, B, o + 0.035 * sg, 0, o + 0.07 * sg, -0.17, side(A, sg), kind === TUN ? [0.16, 0.13, 0.11] : C.railSide);
      }
      // --- the guideway ----------------------------------------------------------
      if (kind === DECK) {
        // the deck reaches the other track's where they share the structure,
        // and at a station it carries the platform: to the middle for an
        // island, out past the edge for a side platform
        const isl = inStation && otherD >= 8.4 && otherD < 22;
        const wIn = otherD < 8.5 || isl ? otherD / 2 + 0.05 : 2.5, wOut = inStation && !isl ? 6.25 : 2.55;
        const oIn = wIn * towardOther, oOut = -wOut * towardOther;
        band(c.flat, A, B, oOut, -0.18, oIn, -0.18, UP, C.concrete);
        // fascia and soffit, then the box girder's webs
        band(c.flat, A, B, oOut, -0.18, oOut, -0.75, side(A, -towardOther), C.concreteL);
        band(c.flat, A, B, oOut, -0.75, oIn, -0.75, DOWN, C.concreteD);
        if (otherD >= 8.5 && !isl) band(c.flat, A, B, oIn, -0.18, oIn, -0.75, side(A, towardOther), C.concreteL);
        for (const sg of [-1, 1]) {
          c.flat.quad(at(A, 1.55 * sg, -0.75), at(B, 1.55 * sg, -0.75), at(B, 1.1 * sg, -2.25), at(A, 1.1 * sg, -2.25), [A.lx * sg, -0.3, A.lz * sg], uv0, C.concrete);
        }
        band(c.flat, A, B, -1.1, -2.25, 1.1, -2.25, DOWN, C.concreteD);
        // the outer parapet
        band(c.flat, A, B, oOut, -0.18, oOut, 0.95, side(A, -towardOther), C.concreteL);
        band(c.flat, A, B, oOut + 0.2 * towardOther, -0.18, oOut + 0.2 * towardOther, 0.95, side(A, towardOther), C.concrete);
        band(c.flat, A, B, oOut, 0.95, oOut + 0.2 * towardOther, 0.95, UP, C.concreteL);
        if (otherD >= 8.5 && !isl && !inStation) {
          band(c.flat, A, B, oIn, -0.18, oIn, 0.95, side(A, towardOther), C.concreteL);
          band(c.flat, A, B, oIn - 0.2 * towardOther, -0.18, oIn - 0.2 * towardOther, 0.95, side(A, -towardOther), C.concrete);
          band(c.flat, A, B, oIn, 0.95, oIn - 0.2 * towardOther, 0.95, UP, C.concreteL);
        }
        // columns every ~32 m, off the carriageways; one between the two
        // tracks where they share the deck (the western track places it)
        if (sm >= colNext) {
          const shared = otherD < 8.5;
          if (!shared || tr.key.startsWith('sb')) {
            let placed = false;
            for (const ds of [0, 5, -5, 10, -10, 15]) {
              const sc = sm + ds;
              if (tr.kind(sc) !== DECK) continue;
              const P = frame(tr, sc);
              const off = shared ? otherD / 2 * towardOther : 0;
              const x = P.x + P.lx * off, z = P.z + P.lz * off;
              const gy = G.terrainHeight(x, z);
              const top = P.y - 2.25;
              // THE FLOATING BRIDGE: over deep water the guideway rides a
              // concrete pontoon, as I-90's does -- a column 60 m down to the
              // lake bed would be the wrong bridge entirely
              const wl = G.isWater(x, z) ? G.drawnWaterLevel(this.lakes, x, z) : null;
              if (wl !== null && wl - gy > 2.5 && top - wl < 2.2) {
                const pw = shared ? otherD + 5.5 : 5.5;
                c.flat.box(x, wl - 2.6, z, pw, top - (wl - 2.6), 32.6, -P.h, C.concrete);
                c.flat.box(x, wl + 0.35, z, pw + 0.1, 0.08, 32.6, -P.h, C.concreteL);
                placed = true;
                break;
              }
              if (this.city.onRoad(x, z, 1.3, false, false)) continue;
              if (top - gy < 2) continue;
              const cw = shared ? 2.0 : 1.6;
              c.flat.box(x, gy - 0.5, z, cw, top - gy + 0.5 - 0.6, cw, -P.h, C.concrete);
              // the crosshead under the girder(s)
              const hw = shared ? otherD / 2 + 1.6 : 1.5;
              c.flat.box(x, top - 0.6, z, hw * 2, 0.6, 2.4, -P.h, C.concreteL);
              this.solids.push({ x, z, r: cw * 0.62, y0: gy, y1: top });
              placed = true;
              break;
            }
            colNext = sm + (placed ? 32 : 12);
          } else colNext = sm + 32;
        }
      }
      // --- the covered approach and the bore -------------------------------------
      if ((kind === BOX || kind === TUN) && inHall) {
        band(c.tun, A, B, -0.015, LINK.wire, 0.015, LINK.wire, DOWN, [0.06, 0.06, 0.06]);
      } else if (kind === BOX || kind === TUN) {
        const b = kind === TUN ? c.tun : c.flat;
        const W = LINK.boreW, H = LINK.boreH;
        // interior: walls, walkways, ceiling -- unlit in the bore, light
        // pools every 18 m baked into the colours
        const lit = (s) => { const d = Math.abs(((s % 18) + 18) % 18 - 9) / 9; return 0.55 + 0.45 * d * d; };
        const kA = kind === TUN ? lit(s0) : 1, kB = kind === TUN ? lit(s1) : 1;
        const wallC = kind === TUN ? [[0.19 * kA, 0.19 * kA, 0.185 * kA], [0.19 * kB, 0.19 * kB, 0.185 * kB]] : null;
        for (const sg of [-1, 1]) {
          const cw = kind === TUN ? [wallC[0], wallC[1], wallC[1], wallC[0]] : C.concreteD;
          b.quad(at(A, W * sg, -0.3), at(B, W * sg, -0.3), at(B, W * sg, H), at(A, W * sg, H), side(A, -sg),
            uv0, kind === TUN ? [cw[0], cw[1], [0.13 * kB, 0.13 * kB, 0.125 * kB], [0.13 * kA, 0.13 * kA, 0.125 * kA]] : cw);
          // the walkway along each wall
          band(b, A, B, 1.9 * sg, 0.55, W * sg, 0.55, UP, kind === TUN ? [0.17, 0.17, 0.165] : C.concrete);
          band(b, A, B, 1.9 * sg, -0.25, 1.9 * sg, 0.55, side(A, -sg), kind === TUN ? [0.11, 0.11, 0.11] : C.concreteD);
          band(b, A, B, 1.5 * sg, -0.25, 1.9 * sg, -0.25, UP, kind === TUN ? [0.08, 0.08, 0.08] : C.concreteD);
        }
        band(b, A, B, -W, H, W, H, DOWN, kind === TUN ? [0.1, 0.1, 0.1] : C.concreteD);
        // the contact wire, held from the roof
        band(b, A, B, -0.015, LINK.wire, 0.015, LINK.wire, DOWN, kind === TUN ? [0.06, 0.06, 0.06] : C.wire);
        if (kind === TUN) {
          // a lamp on each wall every 18 m, a cable tray
          const sl = Math.ceil(s0 / 18) * 18;
          if (sl < s1) {
            const T = frame(tr, sl), T2 = frame(tr, sl + 1.4);
            for (const sg of [-1, 1]) band(b, T, T2, (W - 0.02) * sg, 3.6, (W - 0.02) * sg, 3.85, side(T, -sg), [1.0, 0.92, 0.74]);
          }
          for (const sg of [-1, 1]) band(b, A, B, (W - 0.02) * sg, 2.2, (W - 0.02) * sg, 2.3, side(A, -sg), [0.12, 0.12, 0.12]);
        } else {
          // outside: walls down to the ground and the roof slab, where they stand above it
          for (const sg of [-1, 1]) {
            const gA = G.terrainHeight(A.x + A.lx * (W + 0.3) * sg, A.z + A.lz * (W + 0.3) * sg);
            const gB = G.terrainHeight(B.x + B.lx * (W + 0.3) * sg, B.z + B.lz * (W + 0.3) * sg);
            const tA = A.y + LINK.roofOut, tB = B.y + LINK.roofOut;
            if (tA > gA || tB > gB) c.flat.quad(atY(A, (W + 0.3) * sg, gA - 0.6), atY(B, (W + 0.3) * sg, gB - 0.6), atY(B, (W + 0.3) * sg, tB), atY(A, (W + 0.3) * sg, tA), side(A, sg), uv0, C.concrete);
          }
          band(c.flat, A, B, -W - 0.3, LINK.roofOut, W + 0.3, LINK.roofOut, UP, C.concreteL);
          band(c.flat, A, B, -W, H, -W - 0.3, LINK.roofOut, UP, C.concrete);
        }
      }
      // mouths: a headwall where the box starts from open track, a dark card
      // where the box goes under the ground (the bore beyond is drawn only
      // for a camera inside it)
      const kPrev = tr.kind(s0 - 1), kNext = tr.kind(s1 + 1);
      if (kind === BOX && (kPrev === FILL || kPrev === DECK || kPrev === CROSS) || kind === BOX && s0 === 0) this._headwall(tr, s0, c, 1);
      if (kind === BOX && (kNext === FILL || kNext === DECK || kNext === CROSS)) this._headwall(tr, s1, c, -1);
      if (kind === BOX && kNext === TUN) this._card(tr, s1, c, 1);
      if (kind === BOX && kPrev === TUN) this._card(tr, s0, c, -1);
      // --- catenary: the poles are one instanced mesh (_buildPoles) ------------------
      if (kind !== TUN && kind !== BOX) {
        // contact wire and, over it, the messenger, with a dropper every 9 m
        band(c.near, A, B, -0.02, LINK.wire, 0.02, LINK.wire, DOWN, C.wire);
        band(c.near, A, B, -0.02, LINK.wire, 0.02, LINK.wire, UP, C.wire);
        band(c.near, A, B, -0.018, LINK.wire + 1.0, 0.018, LINK.wire + 1.0, DOWN, C.wire);
        band(c.near, A, B, -0.018, LINK.wire + 1.0, 0.018, LINK.wire + 1.0, UP, C.wire);
        const dp = Math.ceil(s0 / 9) * 9;
        if (dp < s1) { const T = frame(tr, dp); band(c.near, T, frame(tr, dp + 0.02), 0, LINK.wire, 0, LINK.wire + 1.0, side(T, 1), C.wire); }
      }
      return F1;
    };
    if (only) {
      for (let i = 0; i < only.k.length; i++) {
        pole = only.st[i * 2]; colNext = only.st[i * 2 + 1];
        seg(only.k[i], frame(tr, only.k[i] * DS));
      }
      return;
    }
    let F0 = frame(tr, 0);
    for (let k = 0; k < segs; k++) F0 = seg(k, F0);
  }

  _headwall(tr, s, c, dirIn) {
    // a portal face across both the box and a margin, facing out of it
    const P = frame(tr, s), W = LINK.boreW + 0.3;
    const n = [-P.fx * dirIn, 0, -P.fz * dirIn];
    const gy = Math.min(G.terrainHeight(P.x, P.z), P.y - 0.4);
    const top = P.y + LINK.roofOut + 0.5;
    const w = W + 1.6;
    const q = (o0, y0, o1, y1) => c.flat.quad(atY(P, o0, y0), atY(P, o1, y0), atY(P, o1, y1), atY(P, o0, y1), n, uv0, C.concreteL);
    q(-w, gy - 0.5, -W, top); q(W, gy - 0.5, w, top); q(-W, P.y + LINK.boreH, W, top);
    // the coping on top, a little proud
    const o = [P.fx * 0.35 * -dirIn, P.fz * 0.35 * -dirIn];
    c.flat.quad([P.x - P.lx * w + o[0], top, P.z - P.lz * w + o[1]], [P.x + P.lx * w + o[0], top, P.z + P.lz * w + o[1]],
      [P.x + P.lx * w - o[0], top, P.z + P.lz * w - o[1]], [P.x - P.lx * w - o[0], top, P.z - P.lz * w - o[1]], UP, uv0, C.concreteL);
  }

  _card(tr, s, c, dirIn) {
    const P = frame(tr, s), W = LINK.boreW;
    const n = [-P.fx * dirIn, 0, -P.fz * dirIn];
    c.card.quad(at(P, -W, -0.4), at(P, W, -0.4), at(P, W, LINK.boreH), at(P, -W, LINK.boreH), n, uv0, [0, 0, 0]);
  }

  /**
   * One track's platform at a station, from OSM's platform ways (build_ion.py
   * `plats`): the side of the track it is on (`sg`, +1 = the track's left),
   * its edge and back (`e0`, `e1`, metres off the track), whether it is a
   * CENTRE platform shared with the other track (`island`; then e1 is half
   * way to it and only one of the two tracks builds it, `builds`), and its
   * ends along the track (`a0`, `a1`). Without an OSM platform: the old
   * guess (a centre platform when the tracks are 8.4-22 m apart).
   */
  _stationPlan(st, tr) {
    st.plan = st.plan || {};
    if (st.plan[tr.key]) return st.plan[tr.key];
    const k = tr.key, sC = st.s[k], other = tr.other;
    const P0 = frame(tr, sC);
    const q = other.nearest(P0.x, P0.z, 60);
    const d = q ? q.d : 99;
    const toward = q ? ((other.x(q.s) - P0.x) * P0.lx + (other.z(q.s) - P0.z) * P0.lz >= 0 ? 1 : -1) : 1;
    let best = null;
    for (const pl of st.plats || []) {
      let l0 = Infinity, l1 = -Infinity, a0 = Infinity, a1 = -Infinity, ok = true;
      for (const [x, z] of pl.p) {
        const r = tr.nearest(x, z, 40);
        if (!r || Math.abs(r.s - sC) > 90) { ok = false; break; }
        const lat = r.d * r.side;
        l0 = Math.min(l0, lat); l1 = Math.max(l1, lat); a0 = Math.min(a0, r.s); a1 = Math.max(a1, r.s);
      }
      if (!ok || (l0 < -0.6 && l1 > 0.6)) continue;
      const side = l0 + l1 > 0 ? 1 : -1, near = side > 0 ? Math.max(0, l0) : Math.max(0, -l1);
      if (near > 8 || a1 - a0 < 12) continue;
      if (!best || near < best.near) best = { side, near, w: pl.area ? clamp(l1 - l0, 2.4, 9) : 3.4, a0, a1 };
    }
    const e0 = 1.45;
    let plan;
    if (best) {
      const sg = best.side;
      // a centre platform: the other track is on the platform's side, just past it
      const island = !!q && toward === sg && d < e0 + best.w + e0 + 2.5;
      let e1 = island ? d / 2 : e0 + best.w;
      if (!island && q && toward === sg) e1 = Math.min(e1, d - e0 - 0.3);
      let a0 = Math.max(best.a0, sC - 48), a1 = Math.min(best.a1, sC + 48);
      const sp = st.stop[k];
      a0 = Math.max(0, Math.min(a0, sp - LINK.len / 2 - 3)); a1 = Math.min(tr.len, Math.max(a1, sp + LINK.len / 2 + 3));
      plan = { sg, e0, e1, island, a0, a1, d, osm: true };
    } else {
      const island = d >= 8.4 && d < 22;
      const sp = st.stop[k];
      plan = { sg: island ? toward : -toward, e0, e1: island ? d / 2 : e0 + 3.6, island, a0: Math.max(0, sp - LINK.platLen / 2), a1: Math.min(tr.len, sp + LINK.platLen / 2), d, osm: false };
    }
    // a centre platform is built once, by the first track (its outline covers both edges)
    plan.builds = !plan.island || k === 'sb' || st.s.sb === undefined;
    st.plan[k] = plan;
    return plan;
  }

  /** Where you step off a train standing at `st`: onto its platform, beside the middle door. */
  platformSpot(st, t) {
    const tr = t.track, pl = this._stationPlan(st, tr);
    const F = frame(tr, t.s), o = (pl.e0 + Math.min(pl.e1, pl.e0 + 2.2)) / 2 * pl.sg;
    return { x: F.x + F.lx * o, z: F.z + F.lz * o, y: F.y + LINK.platH };
  }

  /**
   * One track's platform at a station, ION's way (Commons photographs of
   * Mill, Queen, Kitchener City Hall, Fairway, University of Waterloo): a
   * concrete platform at the low floor's height with the yellow tactile edge;
   * a canopy of blue-fritted glass on slim grey steel posts over the length
   * of one car -- on a side platform cantilevered from posts along its back,
   * rising toward the track; on a centre platform a butterfly on posts down
   * its middle -- with the black name fascia along its edge; the station's
   * coloured feature wall at the canopy's end; the ticket machine, the PRESTO
   * validators, the next-train sign, benches in a glass shelter, the name
   * totems at the platform's ends, and ramps down to the street.
   */
  _buildStation(st, tr, chunk) {
    const pl = this._stationPlan(st, tr);
    if (!pl.builds) return;
    const sC = st.s[tr.key], sp = st.stop[tr.key];
    const c = chunk(tr.x(sC), tr.z(sC));
    const kind = tr.kind(sC);
    const under = kind === TUN || kind === BOX;
    const b = under ? c.tun : c.flat;
    const { sg, e0, island } = pl;
    // a centre platform reaches the other track's edge: its far edge is d - e0
    const eFar = island ? pl.d - e0 : pl.e1;
    const H = LINK.platH, DS = 4;
    const CONC = [0.56, 0.55, 0.52], CONC_D = [0.36, 0.355, 0.34], STEEL = [0.30, 0.32, 0.34], DARK = [0.08, 0.085, 0.09];
    const s0 = pl.a0, s1 = pl.a1;
    if (!this.platforms) this.platforms = [];
    for (let s = s0; s < s1 - 0.01; s += DS) {
      const A = frame(tr, s), B = frame(tr, Math.min(s1, s + DS));
      band(b, A, B, e0 * sg, H, eFar * sg, H, UP, CONC);
      // the tactile strip along the track's edge (both edges of a centre platform)
      band(b, A, B, e0 * sg, H + 0.012, (e0 + 0.6) * sg, H + 0.012, UP, C.tactile);
      band(b, A, B, e0 * sg, -0.25, e0 * sg, H, side(A, -sg), CONC_D);
      if (island) {
        band(b, A, B, (eFar - 0.6) * sg, H + 0.012, eFar * sg, H + 0.012, UP, C.tactile);
        band(b, A, B, eFar * sg, -0.25, eFar * sg, H, side(A, sg), CONC_D);
      } else {
        // the back: a guard rail on a low kerb, and the face down to the ground
        band(b, A, B, (eFar - 0.05) * sg, H + 1.02, (eFar + 0.02) * sg, H + 1.02, UP, STEEL);
        band(b, A, B, (eFar + 0.02) * sg, H + 0.97, (eFar + 0.02) * sg, H + 1.02, side(A, sg), STEEL);
        b.box(A.x + A.lx * (eFar - 0.03) * sg, A.y + H, A.z + A.lz * (eFar - 0.03) * sg, 0.06, 1.0, 0.06, -A.h, STEEL);
        const gA = G.terrainHeight(A.x + A.lx * eFar * sg, A.z + A.lz * eFar * sg);
        if (A.y + H - gA > 0.05) band(b, A, B, eFar * sg, Math.min(-0.25, gA - A.y - 0.3), eFar * sg, H, side(A, sg), CONC_D);
      }
      const mx = (A.x + B.x) / 2 + A.lx * ((e0 + eFar) / 2) * sg, mz = (A.z + B.z) / 2 + A.lz * ((e0 + eFar) / 2) * sg;
      if (!under) this.platforms.push({ x: mx, z: mz, hw: (eFar - e0) / 2, hd: DS / 2 + 0.05, rot: -A.h, y0: (A.y + B.y) / 2 + H, y1: (A.y + B.y) / 2 + H });
    }
    // the ends: a ramp down to the ground, and the end faces
    for (const [s, dn] of [[s0, -1], [s1, 1]]) {
      const P = frame(tr, s), Q = frame(tr, clamp(s + dn * 5, 0, tr.len));
      const gy = G.terrainHeight(Q.x + Q.lx * (e0 + eFar) / 2 * sg, Q.z + Q.lz * (e0 + eFar) / 2 * sg);
      const yq = Math.max(gy, Q.y - 0.3);
      b.quad(at(P, e0 * sg, H), at(P, eFar * sg, H), atY(Q, eFar * sg, yq), atY(Q, e0 * sg, yq), UP, uv0, CONC);
      for (const o of [e0, eFar]) b.quad(at(P, o * sg, H), atY(Q, o * sg, yq), atY(Q, o * sg, yq - 0.4), at(P, o * sg, -0.25), side(P, o === e0 ? -sg : sg), uv0, CONC_D);
    }
    if (under) return;
    // --- the canopy, over one car's length about where the train stops -----------
    const CL = 26, c0 = clamp(sp - CL / 2, s0 + 1, s1 - CL - 1), c1 = c0 + CL;
    const mid = (e0 + eFar) / 2;
    // its section across the platform: [offset, height over the platform]
    const roofAt = island
      ? (o) => 3.25 + 0.45 * Math.abs(o - mid) / Math.max(1, (eFar - e0) / 2)       // a butterfly, low over the middle
      : (o) => 3.3 + 0.45 * (eFar - o) / Math.max(1, eFar - e0);                    // rising toward the track
    const r0 = e0 + 0.35, r1 = island ? eFar - 0.35 : eFar + 0.15;
    const posts = island ? [mid] : [eFar - 0.45];
    const sign = this._cellUV(st.name), frit = this._cellUV('frit');
    for (let s = c0; s < c1 - 0.01; s += 3.25) {
      const A = frame(tr, s), B = frame(tr, Math.min(c1, s + 3.25));
      // the glass in two pieces across a butterfly (its valley in the middle)
      const cuts = island ? [r0, mid, r1] : [r0, r1];
      // (the sign material is double-sided and unlit: one quad is both faces)
      for (let i = 0; i < cuts.length - 1; i++) {
        const o0 = cuts[i], o1 = cuts[i + 1];
        c.sign.quad(at(A, o0 * sg, H + roofAt(o0)), at(A, o1 * sg, H + roofAt(o1)), at(B, o1 * sg, H + roofAt(o1)), at(B, o0 * sg, H + roofAt(o0)), UP, frit, [1, 1, 1]);
      }
      // a cross beam under the glass at each bay, the posts every other bay
      const bi = Math.round((s - c0) / 3.25);
      for (let i = 0; i < cuts.length - 1; i++) {
        const o0 = cuts[i], o1 = cuts[i + 1];
        b.quad(at(A, o0 * sg, H + roofAt(o0) - 0.06), at(A, o1 * sg, H + roofAt(o1) - 0.06), at(A, o1 * sg, H + roofAt(o1) - 0.3), at(A, o0 * sg, H + roofAt(o0) - 0.3), [A.fx, 0, A.fz], uv0, STEEL);
      }
      if (bi % 2 === 0) {
        for (const o of posts) {
          const x = A.x + A.lx * o * sg, z = A.z + A.lz * o * sg;
          b.tube([x, A.y + H, z], [x, A.y + H + roofAt(o) - 0.2, z], 0.11, 8, STEEL);
          this.solids.push({ x, z, r: 0.2, y0: A.y + H, y1: A.y + H + roofAt(o) });
        }
      }
      // the fascia along the track side: a black band (the name on it, below)
      for (const o of island ? [r0, r1] : [r0]) {
        const sd = o === r0 ? -sg : sg, y = H + roofAt(o);
        b.quad(at(A, o * sg, y + 0.06), at(B, o * sg, y + 0.06), at(B, o * sg, y - 0.42), at(A, o * sg, y - 0.42), side(A, sd), uv0, DARK);
        b.quad(at(A, o * sg, y - 0.42), at(B, o * sg, y - 0.42), at(B, (o - 0.25 * sd * sg) * sg, y - 0.42), at(A, (o - 0.25 * sd * sg) * sg, y - 0.42), DOWN, uv0, DARK);
      }
    }
    // the name on the fascia, twice along it, both faces of each edge
    for (const s of [c0 + CL * 0.27, c0 + CL * 0.73]) {
      const P = frame(tr, s);
      for (const o of island ? [r0, r1] : [r0]) {
        const sd = o === r0 ? -sg : sg, y = P.y + H + roofAt(o) - 0.39, h = 0.4, w = 3.2;
        const n = [P.lx * sd, 0, P.lz * sd];
        const cx = P.x + P.lx * (o * sg + sd * 0.012), cz = P.z + P.lz * (o * sg + sd * 0.012);
        // reads left to right seen from the track: +f runs right when the face looks -left
        const flip = sd > 0;
        const a = [cx - P.fx * w / 2, y, cz - P.fz * w / 2], bb = [cx + P.fx * w / 2, y, cz + P.fz * w / 2];
        const U = flip ? mirrorUV(sign) : sign;
        c.sign.quad(a, bb, [bb[0], y + h, bb[2]], [a[0], y + h, a[2]], n, U, [1, 1, 1]);
      }
    }
    // the next-train sign hung under the canopy's edge, facing along the platform
    {
      const P = frame(tr, c0 + CL * 0.5), o = island ? mid : r0 + 1.0, y = P.y + H + roofAt(o) - 0.85;
      const cx = P.x + P.lx * o * sg, cz = P.z + P.lz * o * sg, w = 1.7, h = 0.24;
      b.box(cx, y - 0.04, cz, 0.36, h + 0.08, 0.14, -P.h + Math.PI / 2, DARK);
      for (const fs of [1, -1]) {
        // seen from +f the track's left (+l) is on the viewer's right
        const n = [P.fx * fs, 0, P.fz * fs], rx = P.lx * fs, rz = P.lz * fs;
        const fx = cx + P.fx * 0.075 * fs, fz = cz + P.fz * 0.075 * fs;
        const L2 = this._cellUV(tr.dir > 0 ? 'led:sb' : 'led:nb');
        const a = [fx - rx * w / 2, y, fz - rz * w / 2], bb = [fx + rx * w / 2, y, fz + rz * w / 2];
        c.sign.quad(a, bb, [bb[0], y + h, bb[2]], [a[0], y + h, a[2]], n, L2, [1, 1, 1]);
      }
      b.tube([cx, y + h + 0.04, cz], [cx, P.y + H + roofAt(o) - 0.3, cz], 0.02, 4, STEEL);
    }
    // the feature wall at the canopy's far end, square to the track
    {
      const sw = tr.dir > 0 ? c1 + 1.2 : c0 - 1.2, P = frame(tr, sw);
      const o = island ? mid : Math.max(e0 + 1.4, eFar - 0.9), wW = island ? Math.min(1.6, eFar - e0 - 2.4) : 1.3;
      const x = P.x + P.lx * o * sg, z = P.z + P.lz * o * sg, y = P.y + H;
      b.box(x, y, z, Math.max(0.6, wW), 3.0, 0.32, -P.h, C.concreteD);
      this.solids.push({ x, z, r: 0.7, y0: y, y1: y + 3 });
      const fwc = this._cellUV('fw:' + st.name);
      for (const fs of [1, -1]) {
        const n = [P.fx * fs, 0, P.fz * fs], cx = x + P.fx * 0.17 * fs, cz = z + P.fz * 0.17 * fs;
        const hw = Math.max(0.6, wW) / 2 - 0.05, ux = P.lx, uz = P.lz;
        // seen from +f, the track's left (+l) is on the viewer's right
        const a = [cx - ux * hw * fs, y + 0.15, cz - uz * hw * fs], bb = [cx + ux * hw * fs, y + 0.15, cz + uz * hw * fs];
        c.sign.quad(a, bb, [bb[0], y + 2.9, bb[2]], [a[0], y + 2.9, a[2]], n, fwc, [1, 1, 1]);
      }
    }
    // the ticket machine and the PRESTO validators by the feature wall, a
    // glass shelter with its bench mid-canopy, two benches
    {
      const sT = tr.dir > 0 ? c1 - 2.2 : c0 + 2.2, P = frame(tr, sT);
      const o = island ? mid + 0.9 : Math.min(eFar - 0.7, e0 + 2.6);
      const x = P.x + P.lx * o * sg, z = P.z + P.lz * o * sg, y = P.y + H;
      b.box(x, y, z, 0.6, 1.8, 0.75, -P.h, [0.52, 0.54, 0.57]);
      b.box(x, y + 1.8, z, 0.62, 0.08, 0.77, -P.h, ION_BLUE);
      const tv = this._cellUV('tvm'), fsn = -sg;           // its face looks across the platform toward the track
      const fxn = P.lx * fsn, fzn = P.lz * fsn;
      const cx = x + fxn * 0.31, cz = z + fzn * 0.31;
      c.sign.quad([cx - P.fx * 0.36, y + 0.2, cz - P.fz * 0.36], [cx + P.fx * 0.36, y + 0.2, cz + P.fz * 0.36],
        [cx + P.fx * 0.36, y + 1.75, cz + P.fz * 0.36], [cx - P.fx * 0.36, y + 1.75, cz - P.fz * 0.36], [fxn, 0, fzn], fsn > 0 ? mirrorUV(tv) : tv, [1, 1, 1]);
      this.solids.push({ x, z, r: 0.45, y0: y, y1: y + 1.9 });
      for (const ds of [2.2, 3.4]) {
        const V = frame(tr, sT - tr.dir * ds);
        const vx = V.x + V.lx * o * sg, vz = V.z + V.lz * o * sg;
        b.box(vx, y, vz, 0.12, 1.12, 0.12, -V.h, DARK);
        b.box(vx, y + 1.12, vz, 0.2, 0.3, 0.16, -V.h, [0.05, 0.05, 0.055]);
        b.box(vx + V.lx * -sg * 0.09, y + 1.22, vz + V.lz * -sg * 0.09, 0.03, 0.12, 0.1, -V.h, [0.25, 0.85, 0.35]);
      }
      // the shelter: a glass box's frame and its roof, a bench inside
      const sS = sp, S = frame(tr, sS), so = island ? mid : Math.min(eFar - 1.0, e0 + 2.9);
      const sx = S.x + S.lx * so * sg, sz = S.z + S.lz * so * sg;
      const sh = 2.3, sl = 4.2, swd = island ? 1.5 : 1.6;
      for (const a of [-sl / 2, sl / 2]) for (const l of [-swd / 2, swd / 2]) {
        b.box(sx + S.fx * a + S.lx * l * sg, y, sz + S.fz * a + S.lz * l * sg, 0.07, sh, 0.07, -S.h, STEEL);
      }
      b.box(sx, y + sh, sz, swd + 0.1, 0.08, sl + 0.1, -S.h, STEEL);
      b.box(sx, y + 0.08, sz, swd + 0.02, 0.05, sl, -S.h, STEEL);
      b.box(sx + S.lx * (swd / 2 - 0.35) * sg, y, sz + S.lz * (swd / 2 - 0.35) * sg, 0.45, 0.46, 3.0, -S.h, [0.20, 0.30, 0.55]);
      for (const ds of [-9, 9]) {
        const Bn = frame(tr, sS + ds), bo = island ? mid : Math.min(eFar - 0.7, e0 + 2.7);
        b.box(Bn.x + Bn.lx * bo * sg, y, Bn.z + Bn.lz * bo * sg, 0.5, 0.45, 1.8, -Bn.h, STEEL);
        b.box(Bn.x + Bn.lx * bo * sg, y + 0.42, Bn.z + Bn.lz * bo * sg, 0.55, 0.06, 1.9, -Bn.h, [0.34, 0.22, 0.14]);
      }
    }
    // the name totems at the platform's ends: a pole with the board at its head
    for (const s of [s0 + 4, s1 - 4]) {
      const P = frame(tr, s), o = island ? mid : eFar - 0.35;
      const x = P.x + P.lx * o * sg, z = P.z + P.lz * o * sg, y = P.y + H;
      b.box(x, y, z, 0.12, 2.95, 0.12, -P.h, STEEL);
      for (const fs of [1, -1]) {
        const n = [P.lx * -sg * fs, 0, P.lz * -sg * fs];
        const a = [x - P.fx * 1.1 + n[0] * 0.07, y + 2.4, z - P.fz * 1.1 + n[2] * 0.07], bb = [x + P.fx * 1.1 + n[0] * 0.07, y + 2.4, z + P.fz * 1.1 + n[2] * 0.07];
        const flip = sg * fs < 0;
        const U = flip ? mirrorUV(sign) : sign;
        c.sign.quad(a, bb, [bb[0], y + 2.95, bb[2]], [a[0], y + 2.95, a[2]], n, U, [1, 1, 1]);
      }
      this.solids.push({ x, z, r: 0.15, y0: y, y1: y + 3 });
    }
  }

  _cellUV(name, inset = 0) {
    const cl = this.signCells[name];
    if (!cl) return uv0;
    const [u0, v0, u1, v1] = cl;
    const iu = (u1 - u0) * inset * 0.5, iv = (v1 - v0) * inset * 0.5;
    return [u0 + iu, v0 + iv, u1 - iu, v0 + iv, u1 - iu, v1 - iv, u0 + iu, v1 - iv];
  }

  /** A station's way in from the street. ION's are at grade: you walk up the
   *  ramp at a platform's end, so nothing is drawn here (Seattle's glass
   *  entrance canopies and pylons were Link's); `st.ent` stays the spot the
   *  map icon and the boarding test use. */
  _buildEntrance(st, chunk) { /* nothing to draw */ }

  // --- trains -----------------------------------------------------------------

  makeTrains(scene) {
    const geo = buildLRVGeometry();
    this.geo = geo;
    const A = vehicleAssets();
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.42, envMapIntensity: 1.1 });
    this.trimMat = A.trimMat;
    // the lettering: per train a clone of this (its own texture offset)
    this.decMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: decalTexture(), alphaTest: 0.5, metalness: 0.1, roughness: 0.5,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    this.decMat.userData.noShadow = true;
    // THE TIMETABLE. Route 301 every LINK.headway seconds each way: a trip
    // takes Tsb Conestoga -> Fairway and Tnb back (timed by running one
    // train alone, _tripProfile), and the trains in service are as many as
    // fill the round trip with at least LINK.turn at each terminus. Each
    // starts at its own phase of the cycle, one headway apart.
    const sb = this.tracks.sb, nb = this.tracks.nb;
    const P = { sb: this._tripProfile(sb), nb: this._tripProfile(nb) };
    const T = P.sb.T + P.nb.T, H = LINK.headway;
    const N = Math.max(2, Math.ceil((T + 2 * LINK.turn) / H));
    const lay = (N * H - T) / 2;
    this.timetable = { N, H, Tsb: P.sb.T, Tnb: P.nb.T, layover: lay, cycle: N * H };
    this.clock = 0;
    // each terminus's last departure, by the track it leaves on (_turnBack)
    this.lastDep = { sb: -Infinity, nb: -Infinity };
    const dep = (k, at) => { this.lastDep[k] = Math.max(this.lastDep[k], at); };
    for (let i = 0; i < N; i++) {
      const t = new LinkTrain(this, i, sb);
      const put = (k, q) => {
        t.track = this.tracks[k]; t.place(q.s, t.track.dir); t.u = q.u;
        t.state = q.state; t.timer = q.timer; t.station = q.st; t.lastStop = q.last; t.doors = q.state === 'dwell';
      };
      // where in the cycle: the sb trip, the layover at Fairway (standing at
      // the nb platform), the nb trip, the layover at Conestoga
      let tau = (i * H) % (N * H);
      if (tau < P.sb.T) { put('sb', P.sb.at(tau)); dep('sb', -tau); } else if ((tau -= P.sb.T) < lay) {
        const st = nb.from; put('nb', { s: st.stop.nb, u: 0, state: 'dwell', timer: lay - tau, st, last: st }); dep('nb', lay - tau);
      } else if ((tau -= lay) < P.nb.T) { put('nb', P.nb.at(tau)); dep('nb', -tau); } else {
        tau -= P.nb.T;
        const st = sb.from; put('sb', { s: st.stop.sb, u: 0, state: 'dwell', timer: lay - tau, st, last: st }); dep('sb', lay - tau);
      }
      this.trains.push(t);
      scene.add(t.group);
    }
    for (const t of this.trains) { t.setSign(); t.group.visible = false; }
    return this.trains;
  }

  /**
   * One train alone on track `tr`, from its first platform to its last, by
   * the service's own code at a coarse step: how long the trip takes (T) and
   * where the train is at any time into it (at(t)).
   */
  _tripProfile(tr) {
    const ghost = Object.create(LinkTrain.prototype);
    const sys = Object.create(this);
    Object.assign(sys, { trains: [], player: null, audio: null, merge: null, onDoors() {} });
    Object.assign(ghost, { sys, track: tr, dir: tr.dir, _fwd: { x: 0, z: 1 }, driver: null, obstructAt: Infinity, hornT: 0, held: 0, id: -1, doors: false, ghost: true });
    const st0 = tr.from;
    ghost.place(st0.stop[tr.key], tr.dir);
    ghost.state = 'run'; ghost.lastStop = st0; ghost.station = null; ghost.timer = 0;
    const snaps = [], DT = 0.5, EVERY = 4;
    let t = 0;
    for (let i = 0; i < 20000; i++) {
      if (i % EVERY === 0) snaps.push({ s: ghost.s, u: ghost.u, state: ghost.state, timer: ghost.timer, st: ghost.station, last: ghost.lastStop });
      ghost.service(DT);
      t += DT;
      if (ghost.state === 'dwell' && ghost.station === tr.to) break;
    }
    return { T: t, at: (tt) => snaps[Math.min(snaps.length - 1, Math.max(0, Math.round(tt / (DT * EVERY))))] };
  }

  /**
   * AT THE TERMINUS: its passengers off, the train changes ends onto the
   * other track's platform (the crossover is beside the platforms) as soon as
   * that platform is clear, and stands there doors open until its slot: a
   * headway after that terminus's last departure, and never less than
   * LINK.turn after it arrived. False while it must wait.
   */
  _turnBack(t) {
    const nt = t.track.other, k = nt.key, st = t.track.to;
    if (nt.from !== st || st.stop[k] === undefined) return false;
    const s = st.stop[k];
    for (const o of this.trains) if (o !== t && o.track === nt && o.state !== 'off' && Math.abs(o.s - s) < LINK.len + 6) return false;
    const due = Math.max(this.lastDep[k] + LINK.headway, this.clock + LINK.turn - LINK.dwell);
    this.lastDep[k] = due;
    t.track = nt; t.dir = nt.dir; t.place(s, nt.dir);
    t.state = 'dwell'; t.station = st; t.lastStop = st; t.held = 0; t.doors = true;
    t.timer = Math.max(LINK.dwell, due - this.clock);
    t.setSign();
    return true;
  }

  /** Hooks into the game. */
  bind(o) { Object.assign(this, { game: o.game, hud: o.hud, audio: o.audio, player: o.player }); }
  say(t, ms) { if (this.hud) this.hud.showToast(t, ms); }

  /** Where two tracks are the same rails: [0, E] (a 2 Line track and its
   *  1 Line track), or null. */
  sharedEnd(ta, tb) {
    if (ta.share && ta.share.track === tb) return ta.share.end;
    if (tb.share && tb.share.track === ta) return tb.share.end;
    return null;
  }

  /**
   * The train whose tail is next ahead of `t` on the rails `t` will run on,
   * and where that tail is, in `t`'s s: { o, tail }, or null. A train on the
   * other line counts while any of it is on the rails the two share -- and
   * one merging ahead of `t` ends, for `t`, at the junction.
   */
  aheadOf(t) {
    let best = null, bd = Infinity, bt = 0;
    for (const o of this.trains) {
      if (o === t || o.state === 'off') continue;
      let tail;
      if (o.track === t.track) tail = o.tail;
      else {
        const E = this.sharedEnd(t.track, o.track);
        if (E === null) continue;
        if (t.dir > 0) { if (t.lead > E + 5 || o.tail > E) continue; tail = o.tail; }
        else { if (o.lead > E) continue; tail = Math.min(o.tail, E); }
      }
      const d = (tail - t.lead) * t.dir;
      if (d > -LINK.len && d < bd) { bd = d; best = o; bt = tail; }
    }
    return best ? { o: best, tail: bt } : null;
  }
  ahead(t) { const a = this.aheadOf(t); return a ? a.o : null; }

  /** Are these two trains on the same rails somewhere, overlapping? (a collision) */
  sharedOverlap(a, b) {
    const E = this.sharedEnd(a.track, b.track);
    if (E === null) return false;
    const a0 = Math.min(a.lead, a.tail), a1 = Math.min(E, Math.max(a.lead, a.tail));
    const b0 = Math.min(b.lead, b.tail), b1 = Math.min(E, Math.max(b.lead, b.tail));
    return a0 < E && b0 < E && a0 < b1 && b0 < a1;
  }

  /**
   * THE MERGE. A northbound train takes the junction south of International
   * District before it runs onto the shared rails, one at a time; the token
   * lapses once its holder is clear of the junction.
   */
  mergeFree(t) {
    const m = this.merge;
    if (!m || t.dir > 0 || !(t.track === this.tracks.nb || t.track === this.tracks.nb2)) return true;
    if (t.lead < m.E - 2) return true;                    // through it already
    const o = m.owner;
    if (o && o !== t && o.state !== 'off' && o.tail > m.E - 3 && (o.track === this.tracks.nb || o.track === this.tracks.nb2)) return false;
    // nothing of the other line's still standing in the junction
    for (const q of this.trains) {
      if (q === t || q.state === 'off' || !(q.track === this.tracks.nb || q.track === this.tracks.nb2) || q.track === t.track) continue;
      if (q.lead < m.E && q.tail > m.E - 3) return false;
    }
    m.owner = t;
    return true;
  }

  /** Where a train is bound: '1 Line to Federal Way', '2 Line to Downtown Redmond'. */
  bound(t, full = false) {
    // Auto KW: ION's two ends
    const to = t.dir < 0 ? 'Conestoga' : 'Fairway';
    return full ? `ION to ${to}` : `ION · ${to}`;
  }

  /** Where a station stops a train on track `tr`: its centre s. */
  stopS(st, tr) { return st.s[tr.key]; }

  _service(dt, boot = false) {
    const p = this.player, pos = p ? p.position : null;
    // the service's clock: the timetable's departures are on it (_turnBack)
    this.clock = (this.clock || 0) + dt;
    this._tick = (this._tick || 0) + 1;
    for (const t of this.trains) {
      if (t.driver === 'player') continue;
      // (Seattle ran the far service 6x while you waited: ION keeps its
      // timetable, and ENTER at a platform calls the next train in instead)
      const far = pos && Math.hypot(t.x - pos.x, t.z - pos.z);
      // More than 2 km off, a train is run every fourth frame on the time it
      // has saved up (round robin, by id).
      t._acc = (t._acc || 0) + dt;
      if (!boot && far > 2000 && (this._tick + t.id) % 4 !== 0) continue;
      let left = t._acc;
      t._acc = 0;
      while (left > 1e-6) { const h = Math.min(0.25, left); t.service(h); left -= h; }
    }
  }

  /** The station you are at: within 14 m of its street entrance, or -- at
   *  one in the open -- anywhere on or beside its platforms. Else null. */
  waitingAt(x, z) {
    for (const st of this.stations) if (Math.hypot(x - st.ent.x, z - st.ent.z) < 14) return st;
    for (const st of this.stations) {
      if (st.under) continue;
      for (const k of this.keys) {
        if (st.s[k] === undefined) continue;
        const tr = this.tracks[k], q = tr.nearest(x, z, 14);
        if (q && Math.abs(q.s - st.s[k]) < LINK.platLen / 2 + 8) return st;
      }
    }
    return null;
  }

  /**
   * A TRAIN IS SOLID ON FOOT: is (x, z) at height y inside any car's body,
   * grown by r? player.blocked and the crowd's _place ask it (main.js
   * trainBlock). Walking through a standing train was the car bug again.
   */
  blockAt(x, z, y, r) {
    for (const t of this.trains) {
      if (!t.group.visible || Math.hypot(t.cx - x, t.cz - z) > LINK.len / 2 + 10) continue;
      for (let k = 0; k < SECTIONS.length; k++) {
        const b = t.bones[k], p = b.position;
        if (y < p.y - 1.2 || y > p.y + 4.2) continue;
        const dx = x - p.x, dz = z - p.z, hl = (SECTIONS[k][1] - SECTIONS[k][0]) / 2 + r;
        if (dx * dx + dz * dz > (hl + 2) * (hl + 2)) continue;
        _lfw.set(0, 0, 1).applyQuaternion(b.quaternion);
        const l = Math.hypot(_lfw.x, _lfw.z) || 1, fx = _lfw.x / l, fz = _lfw.z / l;
        if (Math.abs(dx * fx + dz * fz) < hl && Math.abs(dx * fz - dz * fx) < 1.33 + r) return true;
      }
    }
    return false;
  }

  update(dt, camera) {
    if (!this.trains.length) return;
    this._service(dt);
    const p = this.player, pv = p && p.vehicle;
    const driving = pv && pv.spec && pv.spec.link;
    this.tunnelMode = !!(driving && this.camUnder);
    if (!driving) this.camUnder = false;
    this.tunGroup.visible = this.tunnelMode;
    const cx = camera.position.x, cz = camera.position.z;
    // (a chunk's centre is up to 0.71 of its side from anything in it)
    // The structure streams (build.js LazyChunks): within the near detail's
    // range at once, out to the flat range a slice a frame, let go 700 m past.
    const R = RANGE, pad = CHUNK * 0.71, BUILD_R = Math.max(R.flat, 900) + 300;
    this.lazy.stream(cx, cz, R.near + 200, BUILD_R, BUILD_R + 700, pad, ON_PHONE ? 1.5 : 3, this._lazySys());
    this._polesUpdate(cx, cz);
    this._crossingsUpdate(dt, cx, cz);
    for (const t of this.trains) {
      const d = Math.hypot(t.cx - cx, t.cz - cz);
      const buried = t.buried();
      const vis = t.state !== 'off' && (t.driver === 'player' || (d < RANGE.train && (this.tunnelMode ? d < 900 : !buried)));
      t.group.visible = vis;
      // the lettering is a draw of its own: only near (it is unreadable past ~250 m)
      if (vis) { t.meshes[2].visible = d < 260 || t.driver === 'player'; t.pose(); }
    }
    // a called train: board it when its doors open, if you are still there
    const pd = this.pending;
    if (pd && p) {
      if (!p.onFoot || this.waitingAt(p.position.x, p.position.z) !== pd.st || performance.now() - pd.at > 240000) this.pending = null;
      else {
        const t = this.trains.find((q) => !q.driver && q.state === 'dwell' && q.station === pd.st);
        if (t) { this.pending = null; p.enterVehicle(t); }
      }
    }
    // people and cars on the track
    if (p) this._guard(dt, p);
    // the operator's readout
    if (driving && this.hud) {
      this._hudT = (this._hudT || 0) - dt;
      if (this._hudT <= 0) { this._hudT = 0.25; this.hud.setObjective(pv.readout()); }
    }
  }

  /**
   * THE TRACK AT GRADE IS NOT A FORCE FIELD. You, on foot or in a car, on
   * the track: an oncoming train sounds its horn and brakes for you; a train
   * that reaches you shoves you off the track and hurts. Only at grade -- the
   * guideway and the bores are nowhere you can be.
   */
  _guard(dt, p) {
    const pv = p.vehicle;
    if (pv && pv.spec.rail) return;
    const x = p.position.x, z = p.position.z;
    if (!this.onGradeCorridor(x, z)) return;
    const rad = pv ? pv.halfWid * 0.9 + 0.3 : 0.35;
    for (const k of this.keys) {
      const tr = this.tracks[k];
      const q = tr.nearest(x, z, 8);
      if (!q) continue;
      const ki = tr.KD[tr.idx(q.s)];
      if (ki !== FILL && ki !== CROSS) continue;
      if (Math.abs((pv ? pv.y : p.y) - tr.y(q.s)) > 2.5) continue;
      const foul = q.d < LINK.wid / 2 + rad + 0.3;
      for (const t of this.trains) {
        if (t.track !== tr || t.state === 'off' || t.driver === 'player') continue;
        const ahead = (q.s - t.lead) * t.dir;              // metres in front of its nose
        const within = (q.s - t.tail) * t.dir > -1 && ahead < 1;
        if (foul && ahead > 0 && ahead < 40 + t.u * t.u / (2 * LINK.brake) * 1.2) t.obstruct(ahead);
        if (foul && within && Math.abs(t.u) > 0.3) {
          // shove off the track, sideways
          const h = tr.H[tr.idx(q.s)], lx = Math.cos(h), lz = -Math.sin(h);
          const push = LINK.wid / 2 + rad + 0.35 - q.d;
          const sp = Math.abs(t.u);
          if (pv) {
            pv.x += lx * q.side * push; pv.z += lz * q.side * push;
            pv.vLong *= 0.3;
            if (this._hitCd <= 0 || this._hitCd === undefined) {
              this._hitCd = 1;
              if (this.game) { this.game.onCrash(sp * 3.2, false); this.game.damagePlayer(sp * 4.5, 'crash'); }
              if (pv.damage) pv.damage(sp * 6, true);
              this.say('Hit by an ION train!');
            }
          } else {
            p.x += lx * q.side * push; p.z += lz * q.side * push;
            if (this._hitCd <= 0 || this._hitCd === undefined) {
              this._hitCd = 1;
              if (this.game) { this.game.onCrash(sp * 2, false); if (sp > 1) this.game.damagePlayer(sp * 7, 'crash'); }
            }
          }
        }
      }
    }
    this._hitCd = (this._hitCd || 0) - dt;
  }

  onGradeCorridor(x, z) {
    return !!this.gradeCells && this.gradeCells.has(Math.floor(x / 50) * 100003 + Math.floor(z / 50));
  }

  /**
   * For traffic.js: is a train on (or about to be on) the track at (x, z)?
   * An AI car stops short of a train crossing its road, and of one that
   * will be there within a few seconds.
   */
  blocks(x, z, y) {
    if (!this.onGradeCorridor(x, z)) return false;
    // a crossing's gates coming down: stop at the arm
    if (this.crossingClosed(x, z)) return true;
    for (const k of this.keys) {
      const tr = this.tracks[k];
      const q = tr.nearest(x, z, 6);
      if (!q || q.d > LINK.wid / 2 + 1.6) continue;
      const ki = tr.KD[tr.idx(q.s)];
      if (ki !== FILL && ki !== CROSS) continue;
      if (y !== undefined && Math.abs(y - tr.y(q.s)) > 3) continue;
      for (const t of this.trains) {
        if (t.track !== tr || t.state === 'off') continue;
        const reach = Math.max(8, Math.abs(t.u) * 5);
        const a = t.tail - t.dir * 3, b = t.lead + t.dir * reach;
        if ((q.s - a) * (q.s - b) <= 0) return true;
      }
    }
    return false;
  }

  /** A train you can step into from here: stopped at the station whose
   *  street entrance you are at, doors open. */
  boardable(x, y, z) {
    const st = this.waitingAt(x, z);
    if (!st) return null;
    let best = null, bd = Infinity;
    for (const t of this.trains) {
      if (t.driver || t.state === 'off' || t.stationHere() !== st) continue;
      // the one you are standing beside, else the one with the longest to wait
      const q = t.track.nearest(x, z, 20), d = q && (q.s - t.tail) * (q.s - t.lead) <= 0 ? q.d : 50 - (t.timer || 0);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /**
   * ENTER at a station with no train in: the next one is called in. The
   * nearest train coming toward this station on either track that is not
   * already close is moved up the line to 160 m short of the platform (the
   * wait you would have had, skipped), provided the track there is clear,
   * and you board it by yourself when its doors open (update).
   */
  call(st) {
    let best = null;
    for (const k of this.keys) {
      if (st.stop[k] === undefined) continue;
      const tr = this.tracks[k], sS = st.stop[k];
      for (const t of this.trains) {
        if (t.track !== tr || t.driver || t.state === 'off') continue;
        const d = (sS - t.s) * t.dir;
        if (d < 5) continue;
        if (!best || d < best.d) best = { t, d, k };
      }
    }
    if (!best) return null;
    const { t, d, k } = best, tr = this.tracks[k], sS = st.stop[k];
    if (d > 190) {
      const s = sS - t.dir * 180;
      let clear = s > LINK.len && s < tr.len - LINK.len;
      for (const o of this.trains) {
        if (o === t || o.track !== tr || o.state === 'off') continue;
        // nothing where it would go, nor between there and the platform
        if (Math.abs(o.s - s) < LINK.len + 40 || ((o.s - s) * t.dir > 0 && (sS - o.s) * t.dir > -70)) clear = false;
      }
      if (clear) { t.place(s, t.dir); t.state = 'run'; t.u = t.dir * 10; t.lastStop = null; t.station = null; }
    }
    this.pending = { st, t, at: performance.now() };
    return t;
  }

  /** When the next train in each direction is due at `st`, in seconds (null: none coming). */
  nextAt(st) {
    const out = {};
    for (const k of this.keys) {
      if (st.stop[k] === undefined) continue;
      const tr = this.tracks[k], sS = st.stop[k];
      let best = null;
      for (const t of this.trains) {
        if (t.track !== tr || t.state === 'off') continue;
        const d = (sS - t.s) * t.dir;
        if (d < -5) continue;
        if (t.state === 'dwell' && t.station === st) { best = 0; break; }
        // ~13 m/s running average plus the stops between
        const stops = this.stations.filter((q) => { const e = (q.stop[k] - t.s) * t.dir; return e > 5 && e < d - 5; }).length;
        const eta = d / 13 + stops * (LINK.dwell + 12) + (t.state === 'dwell' ? t.timer : 0);
        if (best === null || eta < best) best = eta;
      }
      out[k] = best;
    }
    return out;
  }

  /** ENTER at a station with no train in: call the next one in. */
  onWait(x, z) {
    const st = this.waitingAt(x, z);
    if (!st) return false;
    const t = this.call(st);
    if (!t) { this.say(`${st.full} Station — no train coming just now`); return true; }
    const n = this.nextAt(st), eta = n[t.track.key];
    this.say(`${st.full} Station — a ${this.bound(t)} train is ${eta === null || eta < 8 ? 'pulling in' : `${Math.ceil(eta / 5) * 5} s away`}. Stay here: you'll board when its doors open`, 5200);
    return true;
  }

  /** Where you step off, or null if the doors stay shut: at a station, its street entrance. */
  exitSpot(t) {
    const st = t.stationHere();
    if (!st) return null;
    // ION's platforms are at grade: you step off onto the platform
    if (!st.under && st.s[t.track.key] !== undefined) return this.platformSpot(st, t);
    return { x: st.ent.x, z: st.ent.z, y: st.ent.y };
  }
  get noExitMsg() { return 'The doors only open at a station — stop at a platform'; }

  onBoard(t) {
    t.driver = 'player';
    t.mode = 'free';
    const st = t.stationHere();
    t.arrival = { from: st, t: 0, rated: false };
    if (st) t.lastStop = st;
    t.doors = true;
    this._objBefore = this.hud ? this.hud.objective.textContent : '';
    this.say(`${this.bound(t, true)} — you're driving. POWER to go, BRAKE to stop: every platform has a stop mark`, 4600);
  }
  onLeave(t) {
    t.resume();
    if (this.hud) this.hud.setObjective(this._objBefore || '');
    this.camUnder = false;
  }
  /** The doors: their chime (a rising pair opening, the falling warning
   *  closing), for anyone near or aboard; aboard, the next stop announced
   *  as the train leaves. */
  onDoors(t, open) {
    const p = this.player, aboard = p && p.vehicle === t;
    const a = this.audio;
    if (a && a.ready && p && (aboard || Math.hypot(p.position.x - t.x, p.position.z - t.z) < 90)) {
      a.play(open ? 'ion_doors_open' : 'ion_doors_close', aboard ? { gain: 0.7 } : { gain: 0.8, x: t.cx, y: t.y + 2, z: t.cz, ref: 8, maxD: 120 });
    }
    if (aboard && !open) {
      const nx = t.nextStation();
      if (nx) { t._announced = null; this.announce(`Next stop: ${nx.full}`, nx === t.track.to ? `${nx.full}. This is the last stop` : null); }
    }
  }

  /** ION's on-board announcements: the toast, and the voice (the platform's
   *  speech synthesis, where there is one) -- "Next stop: Waterloo Public
   *  Square". `extra` is said after, on the toast only. */
  announce(text, extra = null) {
    this.say(extra ? `${text} · ${extra}` : text, 4200);
    try {
      const ss = typeof window !== 'undefined' && window.speechSynthesis;
      if (!ss || !this.audio || !this.audio.enabled || window.__noSpeech) return;
      ss.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(':', ','));
      u.lang = 'en-CA'; u.rate = 0.95; u.pitch = 1.0; u.volume = 0.9;
      ss.speak(u);
    } catch (e) { /* no voice: the toast says it */ }
    this.lastAnnounce = text;
  }
  onArrive(t, st, err, secs) {
    const e = Math.abs(err);
    let pay = 0, verdict;
    if (e < 1) { verdict = 'right on the mark'; pay = 60; }
    else if (e < 3) { verdict = `${e.toFixed(1)} m ${err > 0 ? 'short' : 'past'} — a good stop`; pay = 30; }
    else { verdict = `${e.toFixed(1)} m ${err > 0 ? 'short of' : 'past'} the mark`; pay = 10; }
    if (this.game && pay) this.game.money += pay;
    const mm = Math.floor(secs / 60), ss = Math.round(secs % 60).toString().padStart(2, '0');
    this.say(`${st.full} Station${secs > 0 ? ` in ${mm}:${ss}` : ''} — ${verdict}${pay ? ` +$${pay}` : ''}. Doors open`, 4200);
    this.onDoors(t, true);
  }
  onCollide(t, speed) {
    this.say(`Collision with the train ahead at ${Math.round(speed * 3.6)} km/h!`);
    if (this.game) { this.game.onCrash(speed * 2, false); this.game.damagePlayer(speed * 6, 'crash'); }
  }
  onEnd(t) {
    this.say('End of the map — the line runs on beyond it. POWER to change ends and take the other track back', 4200);
  }
}

// ---------------------------------------------------------------------------
// The car: ION's Bombardier Flexity Freedom, from the Commons photographs of
// cars 504-515 in service (2018-2026). A low-floor car in five sections:
// light grey skirt; a white body; a dark window band of big panes between
// black pillars; a white band over it and ION's BLUE along the roof line,
// which runs down the cab's corners in the blue swoosh either side of the
// black windscreen cap. Tall black articulations between the sections. The
// front: a black cap over a raked windscreen with the amber destination sign
// ("301 to Conestoga" / "301 to Fairway") at its top, the lower nose white
// with a black band holding two pairs of headlamps and the red tail lamps,
// the fleet number in white on that band. Four glazed double doors a side
// (one on each cab section near its back, one on each suspended section
// next to the centre), the ion logo low on the cabs, the Region of
// Waterloo's mark over the windows behind the cab, GRT on the centre
// section, the pantograph on the centre section. Built once in car-local
// metres (+z toward the B end, y = 0 on the rail head, x to the left) into
// three geometries skinned to the sections' bones: the body (vertex
// colours), the trim (glass and lamps, the vehicles' glass material) and
// the decals (the lettering atlas: per train, its destination and number).

const LIV = {
  white: [0.86, 0.87, 0.88], skirt: [0.50, 0.52, 0.54], blue: ION_BLUE, black: [0.025, 0.026, 0.03],
  pillar: [0.03, 0.032, 0.036], roof: [0.62, 0.63, 0.64], under: [0.06, 0.06, 0.065], bogie: [0.10, 0.10, 0.11],
  seat: [0.07, 0.17, 0.42], floor: [0.24, 0.25, 0.26], liner: [0.80, 0.80, 0.78], ceil: [0.88, 0.88, 0.86],
  pole: [0.85, 0.66, 0.05], lamp: [1.0, 0.98, 0.9], red: [0.85, 0.05, 0.04], wheel: [0.22, 0.2, 0.19],
  bellows: [0.03, 0.03, 0.035], green: [0.2, 0.9, 0.35], doorway: [0.05, 0.05, 0.055], step: [0.4, 0.4, 0.4],
};
const HW = LINK.wid / 2;
// the half-section, bottom to top: [y, half-width, band above]
const LPROF = [
  [0.18, HW - 0.09, 'skirt'], [0.36, HW - 0.02, 'skirt'], [0.64, HW, 'white'], [1.0, HW, 'win'],
  [2.2, HW - 0.035, 'white'], [2.5, HW - 0.07, 'blue'], [2.84, HW - 0.17, 'roof'], [3.16, HW - 0.42, 'roof'],
  [3.36, 0.72, 'roof'], [LINK.roof, 0, 'end'],
];
const bandCol = (t) => t === 'skirt' ? LIV.skirt : t === 'blue' ? LIV.blue : t === 'roof' ? LIV.roof : LIV.white;
const NOSE = 1.35;                              // how far the cab's nose runs past its body sides
const DOOR_W = 1.3;

/** The cars' lettering: one canvas of 8 blocks, 2 across (the destination:
 *  bound for Conestoga | for Fairway) by 4 down (four fleet numbers). Every
 *  block holds the same cells at the same place, so a train picks its block
 *  with its texture's offset and its geometry never changes. */
const DEC = { W: 1024, H: 1024, BW: 512, BH: 256, cells: {} };
const FLEET = ['504', '507', '510', '514'];
let _decTex = null;
function decalTexture() {
  if (_decTex) return _decTex;
  const c = document.createElement('canvas'); c.width = DEC.W; c.height = DEC.H;
  const g = c.getContext('2d');
  // cells inside a block: [x, y, w, h]
  const CELL = {
    signA: [4, 4, 300, 40], signB: [4, 48, 300, 40], side: [310, 4, 196, 30],
    ion: [4, 96, 170, 74], grt: [180, 96, 150, 50], region: [4, 176, 330, 44], numA: [340, 96, 160, 40], numB: [340, 140, 160, 40],
    numA2: [340, 184, 160, 34], numB2: [340, 220, 160, 34],
  };
  const font = (w, s) => `${w} ${s}px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const ionLogo = (q, x, y, h, col) => {
    // the lowercase ion wordmark: a dotted i, an o and an n, heavy and round
    q.save(); q.translate(x, y); q.fillStyle = col; q.strokeStyle = col;
    const s = h / 100;
    q.lineWidth = 17 * s; q.lineCap = 'round';
    q.beginPath(); q.arc(10 * s, 18 * s, 10 * s, 0, Math.PI * 2); q.fill();
    q.beginPath(); q.moveTo(10 * s, 44 * s); q.lineTo(10 * s, 92 * s); q.stroke();
    q.beginPath(); q.arc(58 * s, 68 * s, 24 * s, 0, Math.PI * 2); q.stroke();
    q.beginPath(); q.moveTo(103 * s, 92 * s); q.lineTo(103 * s, 66 * s); q.arc(127 * s, 66 * s, 24 * s, Math.PI, 0); q.lineTo(151 * s, 92 * s); q.stroke();
    q.restore();
  };
  for (let bx = 0; bx < 2; bx++) for (let by = 0; by < 4; by++) {
    const ox = bx * DEC.BW, oy = by * DEC.BH;
    const at = (k) => { const [x, y, w, h] = CELL[k]; return [ox + x, oy + y, w, h]; };
    // the destination signs: amber LEDs on black; the trailing cab's is dark
    const sign = (k, txt) => {
      const [x, y, w, h] = at(k);
      g.fillStyle = '#050505'; g.fillRect(x, y, w, h);
      if (!txt) return;
      g.fillStyle = '#ffae1a'; g.font = font(700, 30); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt, x + w / 2, y + h / 2 + 1, w - 10);
    };
    sign('signA', bx === 0 ? '301 to Conestoga' : '');
    sign('signB', bx === 1 ? '301 to Fairway' : '');
    sign('side', bx === 0 ? '301 Conestoga' : '301 Fairway');
    { const [x, y, , h] = at('ion'); ionLogo(g, x + 4, y + 2, h - 4, '#1f5bb0'); }
    { const [x, y, w, h] = at('grt');
      g.fillStyle = '#1f5bb0'; g.font = `italic ${font(900, 46)}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('GRT', x + w / 2, y + h / 2 + 2); }
    { const [x, y, w, h] = at('region');
      // the Region's mark (a stylised blue V of leaves) and its name
      g.fillStyle = '#1f5bb0';
      g.beginPath(); g.moveTo(x + 4, y + 6); g.lineTo(x + 22, y + h - 6); g.lineTo(x + 40, y + 6); g.lineTo(x + 30, y + 6); g.lineTo(x + 22, y + 24); g.lineTo(x + 14, y + 6); g.closePath(); g.fill();
      g.fillStyle = '#3a3d42'; g.font = font(600, 26); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('Region of Waterloo', x + 50, y + h / 2 + 1); }
    const num = (k, t, col, bg) => { const [x, y, w, h] = at(k); if (bg) { g.fillStyle = bg; g.fillRect(x, y, w, h); }
      g.fillStyle = col; g.font = font(800, h - 8); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x + w / 2, y + h / 2 + 1); };
    num('numA', FLEET[by] + 'A', '#f2f2f2', '#060606'); num('numB', FLEET[by] + 'B', '#f2f2f2', '#060606');
    num('numA2', FLEET[by] + 'A', '#202226', null); num('numB2', FLEET[by] + 'B', '#202226', null);
  }
  // uv of each cell in block (0, 0); a train's texture offset moves the block
  for (const [k, [x, y, w, h]] of Object.entries(CELL)) DEC.cells[k] = [(x + 1) / DEC.W, 1 - (y + h - 1) / DEC.H, (x + w - 1) / DEC.W, 1 - (y + 1) / DEC.H];
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _decTex = tex;
  return tex;
}
/** uvs for a quad a, b, c, d (bottom-left, bottom-right, top-right, top-left as seen) over a cell. */
function cellQuad(k, flip = false) {
  const [u0, v0, u1, v1] = DEC.cells[k];
  return flip ? [u1, v0, u0, v0, u0, v1, u1, v1] : [u0, v0, u1, v0, u1, v1, u0, v1];
}

function buildLRVGeometry() {
  decalTexture();
  const NS = FF.sec.length;
  // per section: body, trim, decals, and the open doorways (on the doors' bones)
  const body = FF.sec.map(() => new Builder(false)), trim = FF.sec.map(() => new Builder(false));
  const dec = FF.sec.map(() => new Builder(true)), open = FF.sec.map(() => new Builder(false));
  const half = LINK.carLen / 2;
  const sec = FF.sec;
  const secOf = (z) => sec.findIndex(([a, b]) => z >= a - 0.01 && z <= b + 0.01);

  // the sides of a stretch z0..z1 of section k, with its doors
  const sides = (k, z0, z1, doors) => {
    const B = body[k], T = trim[k];
    for (const sd of [1, -1]) {
      for (let i = 0; i < LPROF.length - 1; i++) {
        const [ya, wa, tag] = LPROF[i], [yb, wb] = LPROF[i + 1];
        const nn = (() => { const nx = sd * (yb - ya), ny = -(wb - wa), l = Math.hypot(nx, ny) || 1; return [nx / l, ny / l, 0]; })();
        const A = (z, y, w) => [sd * w, y, z];
        let zc = z0;
        const cuts = doors.map((d) => [d - DOOR_W / 2, d + DOOR_W / 2]).sort((p, q) => p[0] - q[0]);
        const pieces = [];
        for (const [c0, c1] of cuts) { if (c0 > zc) pieces.push([zc, c0, false]); pieces.push([c0, c1, true]); zc = c1; }
        if (zc < z1) pieces.push([zc, z1, false]);
        for (const [p0, p1, isDoor] of pieces) {
          if (isDoor && ya >= 0.3 && yb <= 2.21) {
            // a door: two leaves glazed nearly to the floor in black frames
            const m = (p0 + p1) / 2;
            for (const [g0, g1] of [[p0 + 0.09, m - 0.06], [m + 0.06, p1 - 0.09]]) {
              T.quad(A(g0, Math.max(ya, 0.42), wa - 0.02), A(g1, Math.max(ya, 0.42), wa - 0.02), A(g1, Math.min(yb, 2.08), wb - 0.02), A(g0, Math.min(yb, 2.08), wb - 0.02), nn, uv0, GLASS);
            }
            B.quad(A(p0, ya, wa), A(p1, ya, wa), A(p1, yb, wb), A(p0, yb, wb), nn, uv0, LIV.black);
            continue;
          }
          if (tag === 'win') {
            // big panes between black pillars, ~1.7 m a pane
            const len = p1 - p0, nP = Math.max(1, Math.round(len / 1.7)), w = len / nP;
            B.quad(A(p0, ya, wa), A(p1, ya, wa), A(p1, yb, wb), A(p0, yb, wb), nn, uv0, LIV.pillar);
            for (let j = 0; j < nP; j++) {
              const g0 = p0 + j * w + 0.08, g1 = p0 + (j + 1) * w - 0.08;
              T.quad(A(g0, ya + 0.06, wa + 0.004), A(g1, ya + 0.06, wa + 0.004), A(g1, yb - 0.06, wb + 0.004), A(g0, yb - 0.06, wb + 0.004), nn, uv0, GLASS);
            }
            continue;
          }
          B.quad(A(p0, ya, wa), A(p1, ya, wa), A(p1, yb, wb), A(p0, yb, wb), nn, uv0, bandCol(tag));
        }
      }
      // the open doorways (drawn while the doors are open), the green
      // open-door buttons, the step plate
      for (const d of doors) {
        const x = sd * (HW + 0.025);
        open[k].quad([x, 0.36, d - 0.62], [x, 0.36, d + 0.62], [x, 2.12, d + 0.62], [x, 2.12, d - 0.62], [sd, 0, 0], uv0, LIV.doorway);
        open[k].quad([sd * (HW + 0.03), 0.33, d - 0.62], [sd * (HW + 0.03), 0.33, d + 0.62], [sd * (HW + 0.03), 0.37, d + 0.62], [sd * (HW + 0.03), 0.37, d - 0.62], [sd, 0, 0], uv0, [0.9, 0.75, 0.1]);
        T.quad([sd * (HW + 0.02), 1.15, d - DOOR_W / 2 - 0.12], [sd * (HW + 0.02), 1.15, d - DOOR_W / 2 - 0.04], [sd * (HW + 0.02), 1.23, d - DOOR_W / 2 - 0.04], [sd * (HW + 0.02), 1.23, d - DOOR_W / 2 - 0.12], [sd, 0, 0], uv0, LIV.green);
      }
      // the underframe inside the skirt
      B.quad([sd * (HW - 0.14), 0.12, z0], [sd * (HW - 0.14), 0.12, z1], [sd * (HW - 0.14), 0.36, z1], [sd * (HW - 0.14), 0.36, z0], [-sd, 0, 0], uv0, LIV.under);
    }
    B.quad([-(HW - 0.12), 0.36, z0], [HW - 0.12, 0.36, z0], [HW - 0.12, 0.36, z1], [-(HW - 0.12), 0.36, z1], DOWN, uv0, LIV.under);
    // inside: floor, liners, ceiling, seats and poles
    const lin = HW - 0.1, fl = LINK.platH;
    B.quad([-lin, fl, z0], [lin, fl, z0], [lin, fl, z1], [-lin, fl, z1], UP, uv0, LIV.floor);
    B.quad([-(lin - 0.2), 2.4, z0], [lin - 0.2, 2.4, z0], [lin - 0.2, 2.4, z1], [-(lin - 0.2), 2.4, z1], DOWN, uv0, LIV.ceil);
    for (const sd of [1, -1]) {
      B.quad([sd * lin, fl, z0], [sd * lin, fl, z1], [sd * lin, 1.0, z1], [sd * lin, 1.0, z0], [-sd, 0, 0], uv0, LIV.liner);
      B.quad([sd * lin, 2.2, z0], [sd * lin, 2.2, z1], [sd * (lin - 0.2), 2.4, z1], [sd * (lin - 0.2), 2.4, z0], [-sd, -0.6, 0], uv0, LIV.liner);
      T.quad([sd * (lin - 0.35), 2.39, z0 + 0.2], [sd * (lin - 0.2), 2.39, z0 + 0.2], [sd * (lin - 0.2), 2.39, z1 - 0.2], [sd * (lin - 0.35), 2.39, z1 - 0.2], DOWN, uv0, LIV.lamp);
    }
    // seats: facing pairs in the bays between doors, a yellow pole at each
    const bays = [];
    let zc = z0 + 0.3;
    for (const [c0, c1] of doors.map((d) => [d - 0.95, d + 0.95]).sort((p, q) => p[0] - q[0])) { if (c0 - zc > 1.3) bays.push([zc, c0]); zc = Math.max(zc, c1); }
    if (z1 - 0.3 - zc > 1.3) bays.push([zc, z1 - 0.3]);
    for (const [b0, b1] of bays) {
      for (let z = b0 + 0.45; z < b1 - 0.4; z += 0.85) {
        for (const sd of [1, -1]) {
          const x = sd * (lin - 0.48);
          B.box(x, fl, z, 0.9, 0.44, 0.45, 0, LIV.seat);
          B.box(x, fl + 0.44, z + 0.19, 0.9, 0.55, 0.08, 0, LIV.seat);
        }
      }
      T.tube([0.4, fl, (b0 + b1) / 2], [0.4, 2.4, (b0 + b1) / 2], 0.02, 5, LIV.pole);
    }
    for (const d of doors) for (const sd of [1, -1]) T.tube([sd * (lin - 0.12), fl, d - 0.8], [sd * (lin - 0.12), 2.3, d - 0.8], 0.02, 5, LIV.pole);
  };

  const roofBox = (k, z, len, w, h, col) => body[k].box(0, LINK.roof - 0.12, z, w, h + 0.12, len, 0, col);

  // A cab nose: the profile swept round a superellipse in plan, longest at the
  // bumper and raking back up the windscreen. Columns 0..1 of the sweep are the
  // cab's corners (the blue swoosh above the waist), the rest its front. `dir`
  // +1: the +z end.
  const cab = (k, z0, dir) => {
    const B = body[k], T = trim[k], D = dec[k];
    const LEN = (y) => y < 0.64 ? NOSE * (0.9 + 0.1 * (y / 0.64)) : y < 1.0 ? NOSE : NOSE - Math.pow((y - 1.0) / (LINK.roof - 1.0), 1.15) * (NOSE - 0.2);
    const N = 10, EXP = 3.0, CORNER = 2;
    const rows = LPROF.map(([y, w]) => {
      const row = [];
      for (let j = 0; j <= N; j++) {
        const th = (j / N) * Math.PI / 2;
        const c = Math.pow(Math.cos(th), 2 / EXP), s = Math.pow(Math.sin(th), 2 / EXP);
        row.push([w * c, y, z0 + dir * LEN(y) * s]);
      }
      return row;
    });
    for (const sd of [1, -1]) {
      const up = rows.map((r) => r.map(([x, y, z]) => [sd * x, y, z]));
      const out = [sd, 0, dir];
      for (let i = 0; i < up.length - 1; i++) {
        const tag = LPROF[i][2], y = LPROF[i][0];
        const r0 = up[i], r1 = up[i + 1];
        const side = (c) => B.patch([r0.slice(0, CORNER + 1), r1.slice(0, CORNER + 1)], c, out);
        const front = (b, c, j0 = CORNER) => b.patch([r0.slice(j0), r1.slice(j0)], c, out);
        if (tag === 'skirt') { B.patch([r0, r1], LIV.skirt, out); continue; }
        if (tag === 'white' && y < 0.9) {
          // the lower nose: white at the corners, the black lamp band across the front
          side(LIV.white); front(B, LIV.black);
          continue;
        }
        if (tag === 'win') {
          // the swoosh down the corner, the windscreen's black frame, the glass
          side(LIV.blue);
          B.patch([r0.slice(CORNER, CORNER + 2), r1.slice(CORNER, CORNER + 2)], LIV.black, out);
          T.patch([r0.slice(CORNER + 1).map(([x, yy, z]) => [x * 0.996, yy, z + dir * 0.006]), r1.slice(CORNER + 1).map(([x, yy, z]) => [x * 0.996, yy, z + dir * 0.006])], GLASS, out);
          continue;
        }
        // over the windscreen: blue corners, the black cap; the roof's grey
        // goes black too where it meets the cap
        side(tag === 'roof' && y > 2.9 ? LIV.roof : LIV.blue);
        front(B, LIV.black);
      }
      // headlamps: two pairs in the black band, the red tail lamps outboard
      const lz = (y) => z0 + dir * (LEN(y) - 0.015);
      for (const [x, r, col] of [[0.52, 0.085, LIV.lamp], [0.74, 0.085, LIV.lamp], [0.96, 0.06, LIV.red]]) {
        T.spheroid(sd * x, 0.78, lz(0.78) - dir * (x > 0.9 ? 0.18 : x > 0.7 ? 0.09 : 0.04), r, 8, 5, col, 1);
      }
      // the mirror-camera arm at the cab corner
      T.tube([sd * (HW - 0.05), 2.22, z0 + dir * 0.3], [sd * (HW + 0.2), 2.26, z0 + dir * 0.42], 0.025, 4, LIV.pillar);
      B.box(sd * (HW + 0.22), 2.1, z0 + dir * 0.43, 0.09, 0.2, 0.14, 0, LIV.pillar);
    }
    // the destination sign at the top of the windscreen, the fleet number
    // in the lamp band: decals just proud of the nose
    {
      const y0 = 2.0, y1 = 2.32, za = z0 + dir * (LEN(y0) + 0.02), zb = z0 + dir * (LEN(y1) + 0.02), w = 0.62;
      const q = [[-w, y0, za], [w, y0, za], [w, y1, zb], [-w, y1, zb]];
      // seen from the front, +x is on the left for the +z end: flip the cell there
      D.quad(q[0], q[1], q[2], q[3], [0, 0.29, dir * 0.96], cellQuad(dir > 0 ? 'signB' : 'signA', dir < 0), [2.2, 2.2, 2.2]);
      const ny0 = 0.7, ny1 = 0.82, zn = z0 + dir * (NOSE + 0.012), nw = 0.2;
      D.quad([-nw, ny0, zn], [nw, ny0, zn], [nw, ny1, zn], [-nw, ny1, zn], [0, 0, dir], cellQuad(dir > 0 ? 'numB' : 'numA', dir < 0), [1, 1, 1]);
    }
    // the anticlimber, and the cab's console behind the glass
    B.box(0, 0.16, z0 + dir * (NOSE * 0.9 - 0.06), 1.9, 0.24, 0.14, 0, LIV.under);
    B.box(0, LINK.platH, z0 + dir * 0.4, 2.2, 0.85, 0.55, 0, [0.16, 0.17, 0.18]);
    B.box(-0.5, LINK.platH, z0 - dir * 0.35, 0.55, 0.6, 0.55, 0, LIV.seat);
    // the cab's back wall
    B.quad([-(HW - 0.1), LINK.platH, z0 - dir * 1.0], [HW - 0.1, LINK.platH, z0 - dir * 1.0], [HW - 0.1, 2.4, z0 - dir * 1.0], [-(HW - 0.1), 2.4, z0 - dir * 1.0], [0, 0, dir], uv0, LIV.liner);
  };

  // an articulation: the end walls of a section, and on one side of each
  // joint the tall black bellows across the gap
  const joint = (k, z, dir, bellows) => {
    const B = body[k];
    for (let i = 0; i < LPROF.length - 1; i++) {
      const [ya, wa] = LPROF[i], [yb, wb] = LPROF[i + 1];
      B.quad([-wa, ya, z], [wa, ya, z], [wb, yb, z], [-wb, yb, z], [0, 0, dir], uv0, LIV.black);
    }
    if (bellows) {
      const b0 = z, b1 = z + dir * FF.J;
      for (let r = 0; r < 4; r++) {
        const zz = b0 + (b1 - b0) * (r + 0.5) / 4;
        B.box(0, 0.24, zz, 2 * HW - 0.06 - (r % 2) * 0.05, 3.1, FF.J / 4 + 0.01, 0, r % 2 ? LIV.bellows : [0.06, 0.06, 0.065]);
      }
    }
  };

  // a bogie: frame, four wheels on the rail heads
  const bogie = (k, z, motor) => {
    const B = body[k];
    B.box(0, 0.26, z, 1.9, 0.2, 2.1, 0, LIV.bogie);
    for (const sd of [1, -1]) {
      B.box(sd * 0.92, 0.18, z, 0.16, 0.32, 2.4, 0, LIV.bogie);
      for (const az of [-0.9, 0.9]) {
        B.tube([sd * 0.66, 0.3, z + az], [sd * 0.8, 0.3, z + az], 0.3, 12, LIV.wheel, true);
        B.tube([sd * 0.8, 0.3, z + az], [sd * 0.86, 0.3, z + az], 0.11, 8, [0.5, 0.5, 0.52], true);
      }
      if (motor) B.box(sd * 0.3, 0.2, z, 0.5, 0.28, 1.0, 0, [0.16, 0.16, 0.17]);
    }
  };

  // the lettering on both sides, at a section-local z
  const decal = (k, z, y, w, h, cell) => {
    for (const sd of [1, -1]) {
      const x = sd * (HW + 0.012);
      // the side reads left to right: on the +x side that runs toward -z
      const a = [x, y, z + (sd > 0 ? w / 2 : -w / 2)], b = [x, y, z - (sd > 0 ? w / 2 : -w / 2)];
      dec[k].quad(a, b, [b[0], y + h, b[2]], [a[0], y + h, a[2]], [sd, 0, 0], cellQuad(cell), cell === 'side' ? [2.0, 2.0, 2.0] : [1, 1, 1]);
    }
  };

  // The five sections. Cab A: -z end. Doors at FF.doors.
  const doorsIn = (k) => FF.doors.filter((d) => secOf(d) === k);
  sides(0, sec[0][0] + NOSE, sec[0][1], doorsIn(0));
  cab(0, sec[0][0] + NOSE, -1);
  joint(0, sec[0][1], 1, true);
  for (const k of [1, 2, 3]) {
    sides(k, sec[k][0], sec[k][1], doorsIn(k));
    joint(k, sec[k][0], -1, false);
    joint(k, sec[k][1], 1, true);
  }
  sides(4, sec[4][0], sec[4][1] - NOSE, doorsIn(4));
  cab(4, sec[4][1] - NOSE, 1);
  joint(4, sec[4][0], -1, false);
  bogie(0, sec[0][0] + NOSE + 2.4, true);
  bogie(2, 0, false);
  bogie(4, sec[4][1] - NOSE - 2.4, true);
  // decals: ion low on the cab sections behind the door, the Region's mark
  // over the windows behind the cab, GRT over the centre section's windows,
  // the fleet number by the cab door, the side destination sign in the
  // window band beside the first door
  for (const [k, sgn] of [[0, -1], [4, 1]]) {
    const zd = FF.doors[sgn < 0 ? 0 : 3];
    decal(k, zd + sgn * 2.0, 0.62, 0.8, 0.35, 'ion');
    decal(k, zd + sgn * 3.6, 2.24, 1.9, 0.25, 'region');
    decal(k, zd - sgn * 1.05, 2.24, 0.42, 0.11, sgn < 0 ? 'numA2' : 'numB2');
    decal(k, zd + sgn * 1.25, 1.84, 0.9, 0.14, 'side');
  }
  decal(2, 0, 2.23, 0.86, 0.29, 'grt');
  decal(2, 0.2, 0.62, 0.7, 0.3, 'ion');
  // roof equipment: the air-conditioning on the cab sections, traction gear
  // on the suspended ones, the pantograph on the centre section
  for (const k of [0, 4]) {
    const zc = (sec[k][0] + sec[k][1]) / 2;
    roofBox(k, zc + (k ? 0.6 : -0.6), 3.0, 1.6, 0.34, [0.74, 0.75, 0.76]);
  }
  for (const k of [1, 3]) roofBox(k, (sec[k][0] + sec[k][1]) / 2, 2.4, 1.4, 0.3, [0.6, 0.61, 0.62]);
  {
    const B = body[2], T = trim[2], y0 = LINK.roof;
    B.box(0, y0 - 0.05, 0, 1.3, 0.16, 1.5, 0, [0.5, 0.5, 0.52]);
    for (const x of [-0.45, 0.45]) for (const z of [-0.55, 0.55]) T.tube([x, y0 + 0.1, z], [x, y0 + 0.26, z], 0.05, 6, [0.72, 0.4, 0.2]);
    const hy = LINK.wire - 0.02;
    T.tube([0, y0 + 0.26, -0.5], [0, y0 + (hy - y0) * 0.5, 0.5], 0.04, 5, [0.7, 0.7, 0.7]);
    T.tube([0, y0 + (hy - y0) * 0.5, 0.5], [0, hy - 0.1, -0.05], 0.03, 5, [0.7, 0.7, 0.7]);
    T.tube([-0.3, y0 + 0.26, -0.5], [0.3, y0 + 0.26, -0.5], 0.04, 5, [0.7, 0.7, 0.7]);
    B.box(0, hy - 0.1, -0.05, 1.6, 0.07, 0.26, 0, [0.15, 0.15, 0.16]);
  }

  // copy the car into train geometries skinned to the sections' bones; the
  // open doorways ride a second bone per section (DOOR bones, scaled to
  // nothing while the doors are shut)
  const assemble = (list, boneOff = 0) => {
    const parts = list.map((b) => b.build());
    let nv = 0, ni = 0;
    for (const g of parts) { nv += g.attributes.position.count; ni += g.index.count; }
    nv *= LINK.cars; ni *= LINK.cars;
    const uvOn = !!parts[0].attributes.uv;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = uvOn ? new Float32Array(nv * 2) : null;
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    let v = 0, q = 0;
    for (let c = 0; c < LINK.cars; c++) {
      const dz = -LINK.len / 2 + LINK.carLen / 2 + c * (LINK.carLen + LINK.couple);
      parts.forEach((g, k) => {
        const P = g.attributes.position.array, Nn = g.attributes.normal.array, Cc = g.attributes.color.array, I = g.index.array;
        const U = uvOn ? g.attributes.uv.array : null;
        const n = g.attributes.position.count;
        for (let i = 0; i < n; i++) {
          pos[(v + i) * 3] = P[i * 3]; pos[(v + i) * 3 + 1] = P[i * 3 + 1]; pos[(v + i) * 3 + 2] = P[i * 3 + 2] + dz;
          nor[(v + i) * 3] = Nn[i * 3]; nor[(v + i) * 3 + 1] = Nn[i * 3 + 1]; nor[(v + i) * 3 + 2] = Nn[i * 3 + 2];
          col[(v + i) * 3] = Cc[i * 3]; col[(v + i) * 3 + 1] = Cc[i * 3 + 1]; col[(v + i) * 3 + 2] = Cc[i * 3 + 2];
          if (U) { uv[(v + i) * 2] = U[i * 2]; uv[(v + i) * 2 + 1] = U[i * 2 + 1]; }
          si[(v + i) * 4] = boneOff + c * NS + k; sw[(v + i) * 4] = 1;
        }
        for (let i = 0; i < I.length; i++) idx[q + i] = I[i] + v;
        v += n; q += I.length;
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  };
  // the body and the open doorways in one draw: the doorways on the door bones
  const merged = (() => {
    const a = assemble(body), b = assemble(open, SECTIONS.length);
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'skinIndex', 'skinWeight']) {
      const A = a.attributes[name].array, Bb = b.attributes[name].array;
      const out = new A.constructor(A.length + Bb.length); out.set(A); out.set(Bb, A.length);
      g.setAttribute(name, new THREE.BufferAttribute(out, a.attributes[name].itemSize));
    }
    const na = a.attributes.position.count, IA = a.index.array, IB = b.index.array;
    const n = na + b.attributes.position.count;
    const idx = n > 65535 ? new Uint32Array(IA.length + IB.length) : new Uint16Array(IA.length + IB.length);
    idx.set(IA); for (let i = 0; i < IB.length; i++) idx[IA.length + i] = IB[i] + na;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  })();
  const geo = { body: merged, trim: assemble(trim), dec: assemble(dec) };
  tagGlass(geo.trim);
  return geo;
}

// ---------------------------------------------------------------------------
// A train: the posed model, its place on its track, and the two ways it is
// driven -- by you from a cab, or in service.

const G_ACC = 9.81;

export class LinkTrain {
  constructor(sys, id, track) {
    this.sys = sys;
    this.id = id;
    this.track = track;
    this.typeName = 'link';
    this.spec = { rail: true, link: true, hand: 'link', engine: 'traction', len: 16, wid: LINK.wid, roof: LINK.roof,
      topKph: LINK.vMax * 3.6, mass: 160 };
    this.x = 0; this.y = 0; this.z = 0; this.heading = 0; this.cx = 0; this.cz = 0;
    this.vLong = 0; this.vLat = 0; this.vy = 0; this.speed = 0;
    this.halfLen = 2.5; this.halfWid = LINK.wid / 2; this.radius = 3;
    this.health = 100; this.dead = false; this.exploded = false;
    this.mode = 'service'; this.wasParked = false;
    this.skid = 0; this.airborne = false; this.stunt = false; this.stuntLaunch = null;
    this.rampAlong = 0; this.latAcc = 0; this.accLong = 0; this.hitCd = 0;
    this._fwd = { x: 0, z: 1 };
    this.s = 0; this.u = 0; this.dir = track.dir;
    this.driver = null;
    this.state = 'run'; this.timer = 0; this.station = null;
    this.obstructAt = Infinity; this.hornT = 0; this.lastStop = null; this.held = 0;
    this.arrival = null; this.doors = false; this.warned = 0;
    this.offT = 0; this._acc = 0;
    const g = sys.geo || (sys.geo = buildLRVGeometry());
    this.bones = [];
    for (let k = 0; k < SECTIONS.length; k++) {
      const b = new THREE.Bone();
      b.position.set(0, 0, (SECTIONS[k][0] + SECTIONS[k][1]) / 2);
      this.bones.push(b);
    }
    // a DOOR bone per section, its child: the open doorways hang on these,
    // scaled to nothing while the doors are shut (pose)
    this.doorBones = this.bones.map((p) => { const b = new THREE.Bone(); p.add(b); return b; });
    this.group = new THREE.Group();
    this.group.name = `link:train${id}`;
    for (const b of this.bones) this.group.add(b);
    this.group.updateMatrixWorld(true);
    const skel = new THREE.Skeleton([...this.bones, ...this.doorBones]);
    // the lettering: this train's own copy of the decal texture (one image
    // on the GPU), offset to its block -- its destination and fleet number
    this.decTex = decalTexture().clone();
    this.decTex.needsUpdate = false;
    this.decMat = sys.decMat.clone();
    this.decMat.map = this.decTex;
    this.decTex.offset.set(0, -(id % FLEET.length) * DEC.BH / DEC.H);
    this._signDir = 0;
    this.meshes = [[g.body, sys.bodyMat], [g.trim, sys.trimMat], [g.dec, this.decMat]].map(([geo, m], i) => {
      const mesh = new THREE.SkinnedMesh(geo, m);
      mesh.bind(skel, new THREE.Matrix4());
      mesh.castShadow = i < 2;
      mesh.receiveShadow = true;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), LINK.len / 2 + 4);
      this.group.add(mesh);
      return mesh;
    });
    this.setSign();
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
  }

  /** The destination signs: "301 to Conestoga" on cab A leading toward -s,
   *  "301 to Fairway" on cab B leading toward +s (the decal block's column). */
  setSign() {
    this._signDir = this.dir;
    this.decTex.offset.x = this.dir > 0 ? DEC.BW / DEC.W : 0;
  }

  get lead() { return this.s + this.dir * LINK.len / 2; }
  get tail() { return this.s - this.dir * LINK.len / 2; }
  get forward() { return this._fwd; }
  setDetailed() {}
  sync() {}
  damage() {}

  place(s, dir) {
    this.s = s; this.dir = dir; this.u = 0;
    this._point();
  }

  /** Every part of it in a bore (nothing of it above ground to draw)? */
  buried() {
    const tr = this.track;
    return tr.kind(this.s - LINK.len / 2) === TUN && tr.kind(this.s) === TUN && tr.kind(this.s + LINK.len / 2) === TUN;
  }

  /** The station it is standing at (centre within 12 m, stopped), or null. */
  stationHere() {
    if (Math.abs(this.u) > 0.1) return null;
    for (const st of this.sys.stations) if (Math.abs(st.stop[this.track.key] - this.s) < 12) return st;
    return null;
  }

  _point() {
    const tr = this.track;
    const sl = this.lead - this.dir * 2.0;
    this.x = tr.x(sl); this.z = tr.z(sl); this.y = tr.y(sl);
    this.cx = tr.x(this.s); this.cz = tr.z(this.s);
    this.heading = tr.heading(sl) + (this.dir > 0 ? 0 : Math.PI);
    this._fwd.x = Math.sin(this.heading); this._fwd.z = Math.cos(this.heading);
    this.vLong = this.u * this.dir;
    this.speed = Math.abs(this.u);
  }

  pose() {
    const tr = this.track;
    for (let k = 0; k < SECTIONS.length; k++) {
      const s0 = this.s + SECTIONS[k][0], s1 = this.s + SECTIONS[k][1];
      const ax = tr.x(s0), ay = tr.y(s0), az = tr.z(s0), bx = tr.x(s1), by = tr.y(s1), bz = tr.z(s1);
      this._z.set(bx - ax, by - ay, bz - az).normalize();
      this._x.set(this._z.z, 0, -this._z.x).normalize();
      this._y.crossVectors(this._z, this._x);
      this._m.makeBasis(this._x, this._y, this._z);
      const bone = this.bones[k];
      bone.quaternion.setFromRotationMatrix(this._m);
      bone.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    }
    this.group.updateMatrixWorld(true);
    for (const m of this.meshes) m.boundingSphere.center.set(this.cx, tr.y(this.s) + 1.8, this.cz);
    // the doors: open while it stands at a platform
    const ds = this.doors ? 1 : 1e-4;
    for (const b of this.doorBones) b.scale.setScalar(ds);
    if (this._signDir !== this.dir) this.setSign();
  }

  /** Speed limit at s for the run (and the whole train must be under it). */
  limitAt(s) {
    const tr = this.track;
    return tr.LIM ? tr.LIM[tr.idx(s)] || LINK.vMax : LINK.vMax;
  }

  /** Something on the track `ahead` metres in front of the nose (_guard). */
  obstruct(ahead) { this.obstructAt = Math.min(this.obstructAt, ahead); }

  /** One step: tractive command in [-1, 1] along the lead direction, brake in [0, 1]. */
  step(dt, power, brake) {
    const tr = this.track;
    const v = this.u * this.dir;
    let a = 0;
    if (power > 0) a += LINK.acc * power * clamp(1.4 - Math.abs(v) / LINK.vMax, 0, 1) * (v < -0.2 ? 0 : 1);
    if (power < 0) a += 0.5 * power * (Math.abs(v) < 2.4 ? 1 : 0);
    const bk = brake > 0.92 ? LINK.brakeEmerg : LINK.brake * brake;
    const drag = 0.03 + 0.0006 * v * v;
    const slope = (tr.y(this.s + 3) - tr.y(this.s - 3)) / 6;
    let vn = v + (a - G_ACC * slope * this.dir * 0.8) * dt;
    const stop = (bk + drag) * dt;
    if (Math.abs(vn) <= stop && power === 0) vn = 0;
    else vn -= Math.sign(vn) * stop;
    this.u = vn * this.dir;
    this.accLong = a;
    this.s += this.u * dt;
    const ev = {};
    // the ends of the line (the map's edge)
    const lo = LINK.len / 2 + 0.5, hi = tr.len - LINK.len / 2 - 0.5;
    if (this.driver === 'player' && (this.s < lo || this.s > hi)) {
      ev.end = Math.abs(this.u);
      this.s = clamp(this.s, lo, hi);
      this.u = 0;
    }
    // the train ahead, and behind (a player's train reversing)
    for (const o of this.sys.trains) {
      if (o === this || o.state === 'off') continue;
      // the other line's train counts where the two run on the same rails
      if (o.track !== tr && !this.sys.sharedOverlap(this, o)) continue;
      const gap = Math.abs(o.s - this.s) - LINK.len;
      if (gap < 0) {
        const rel = Math.abs(this.u - o.u);
        const sg = Math.sign(this.s - o.s) || 1;
        this.s = o.s + sg * (LINK.len + 0.05);
        if (rel > 1.5) ev.collide = rel;
        const m = (this.u + o.u) / 2;
        this.u = m; o.u = m;
      }
    }
    const k = tr.curv(this.s);
    this.latAcc = this.u * this.u * Math.abs(k);
    ev.lat = this.latAcc;
    this._point();
    return ev;
  }

  /** The speed that still brakes, at `b`, to the stop ahead and every limit. */
  allowed(stopLead, b) {
    const dirn = this.dir, lead = this.lead;
    let v = stopLead === null ? LINK.vMax : Math.sqrt(Math.max(0, 2 * b * Math.max(0, (stopLead - lead) * dirn)));
    for (let d = 0; d <= 320; d += 10) v = Math.min(v, Math.sqrt(this.limitAt(lead + dirn * d) ** 2 + 2 * b * d));
    // the whole train under whatever it is still on
    for (let d = 0; d <= LINK.len; d += 10) v = Math.min(v, this.limitAt(lead - dirn * d));
    return v;
  }

  /** The next stop ahead: a station it has not just stopped at, whose
   *  mark it has not passed by more than 6 m -- or null (run off the end). */
  nextStation() {
    let best = null, bd = Infinity;
    for (const st of this.sys.stations) {
      if (st === this.lastStop) continue;
      const d = (st.stop[this.track.key] - this.s) * this.dir;
      if (d > -6 && d < bd) { bd = d; best = st; }
    }
    return best;
  }

  service(dt) {
    const sys = this.sys, tr = this.track;
    if (this.state === 'off') {
      // beyond the map's edge: the rest of the line, a terminal, a turn back
      this.offT -= dt;
      if (this.offT > 0) return;
      const nt = tr.other, s0 = this.dir > 0 ? tr.len : 0;   // the end it left by
      const s = clamp(s0 + (s0 > 0 ? -1 : 1) * (LINK.len / 2 + 2), LINK.len / 2, nt.len - LINK.len / 2);
      // the rails it comes back on are clear -- the other line's too, where they share them
      for (const o of sys.trains) if (o !== this && o.state !== 'off' && (o.track === nt || sys.sharedEnd(nt, o.track) > s) && Math.abs(o.s - s) < LINK.len + 200) { this.offT = 5; return; }
      this.track = nt; this.dir = nt.dir; this.s = s; this.u = this.dir * 8; this.lastStop = null;
      this.state = 'run';
      this._point();
      return;
    }
    if (this.state === 'dwell') {
      this.u = 0;
      this.timer -= dt;
      // A TRAIN WAITS FOR YOU: standing at this station's entrance, the
      // train at its platform holds (up to two minutes)
      const p = sys.player;
      if (p && p.onFoot && this.station && sys.waitingAt(p.position.x, p.position.z) === this.station && this.timer < 2 && this.held < 120) {
        this.timer = 2; this.held += dt;
      }
      if (this.timer <= 0) {
        // the end of the line: change ends for the trip back (or wait for
        // the other platform to clear)
        if (this.station && this.station === tr.to && !this.ghost && sys._turnBack) {
          if (!sys._turnBack(this)) { this.timer = 2; if (this.doors) { this.doors = false; sys.onDoors(this, false); } }
          return;
        }
        this.state = 'run'; this.doors = false;
        sys.onDoors(this, false);
      }
      this.step(dt, 0, 1);
      return;
    }
    const st = this.nextStation();
    let stopLead = st ? st.stop[tr.key] + this.dir * LINK.len / 2 : null;
    // the merge south of International District: a signal 25 m short of it
    // until this train has the junction
    const M = sys.merge;
    if (M && this.dir < 0 && this.lead > M.E && this.lead - M.E < 260 && !sys.mergeFree(this)) {
      const sig = M.E + 25;
      if (stopLead === null || sig > stopLead) stopLead = sig;
    }
    let vAllow = this.allowed(stopLead, 1.0);
    // the train ahead: moving block, 30 m behind its tail (the other line's
    // too, on the rails the two share)
    const ah = sys.aheadOf(this), o = ah && ah.o;
    const oTail = ah ? ah.tail : 0;
    if (o) {
      const gap = (oTail - this.lead) * this.dir - 30;
      vAllow = Math.min(vAllow, Math.sqrt(Math.max(0, 2 * 1.0 * gap)) + Math.max(0, o.u * o.dir) * 0.5);
      if (gap < 0) vAllow = 0;
    }
    // something on the track ahead: brake for it (planned at the service
    // rate, the emergency brake the moment it is late), and ring the bell
    let emerg = false;
    if (this.obstructAt < Infinity) {
      const vo = Math.sqrt(Math.max(0, 2 * 1.1 * (this.obstructAt - 8)));
      if (this.u * this.dir > vo + 0.2) emerg = true;
      vAllow = Math.min(vAllow, vo);
      if (this.hornT <= 0 && sys.audio && sys.audio.ready && sys.player && Math.hypot(sys.player.position.x - this.x, sys.player.position.z - this.z) < 200) {
        this.hornT = 2.2;
        sys.audio.play('tram_bell', { gain: 1, x: this.x, y: this.y + 2, z: this.z });
      }
      this.obstructAt = Infinity;
    }
    this.hornT -= dt;
    const v = this.u * this.dir;
    let power = 0, brake = 0;
    if (v < vAllow - 0.8) power = 1;
    else if (v > vAllow + 0.3) brake = clamp((v - vAllow) / 1.5, 0.25, 1);
    else if (v > vAllow) brake = 0.25;
    const left = stopLead === null ? Infinity : (stopLead - this.lead) * this.dir;
    if (left < 0.3 || emerg) { power = 0; brake = 1; }
    else if (left < 4 && v < 0.8 && (!o || (oTail - this.lead) * this.dir > 32)) power = 0.35;
    this.step(dt, power, brake);
    if (st && Math.abs(this.u) < 0.05 && left < 0.8 && (st.stop[tr.key] + this.dir * LINK.len / 2 - this.lead) * this.dir < 0.8) {
      this.u = 0;
      this.state = 'dwell'; this.timer = LINK.dwell; this.station = st; this.held = 0; this.doors = true; this.lastStop = st;
      sys.onDoors(this, true);
    }
    // off the end of the map
    if (!st && ((this.dir > 0 && this.lead > tr.len - 2) || (this.dir < 0 && this.lead < 2))) {
      this.state = 'off'; this.offT = 40 + (this.id % 5) * 6; this.u = 0;
      this.group.visible = false;
    }
  }

  /** Back into service from wherever it stands (you left it). */
  resume() {
    this.driver = null;
    this.mode = 'service';
    const st = this.stationHere();
    if (st) { this.state = 'dwell'; this.station = st; this.timer = 6; this.held = 0; this.lastStop = st; } else this.state = 'run';
  }

  /** In a bore the camera goes into the cab: the driver's view down the
   *  tunnel through the windscreen (a chase boom would be in the rock). */
  camRig(p, dt) {
    const tr = this.track;
    const k = tr.kind(this.lead - this.dir * 20), kl = tr.kind(this.lead + this.dir * 4);
    const under = k === TUN || k === BOX || kl === TUN;
    this.sys.camUnder = under && (k === TUN || kl === TUN || this.sys.camUnder);
    if (!under) { this.sys.camUnder = false; this._cab = false; return false; }
    const cs = this.lead - this.dir * 1.15;
    const h = tr.heading(cs), lx = Math.cos(h), lz = -Math.sin(h);
    const want = new THREE.Vector3(tr.x(cs) + lx * 0.3 * this.dir, tr.y(cs) + 2.12, tr.z(cs) + lz * 0.3 * this.dir);
    const ls = this.lead + this.dir * 45;
    const look = new THREE.Vector3(tr.x(ls), tr.y(ls) + 1.6, tr.z(ls));
    // into the cab in one cut, then held rigidly: a seat does not lag
    p.camPos.copy(want);
    if (!this._cab) p.camLook.copy(look); else p.camLook.lerp(look, 1 - Math.exp(-10 * dt));
    this._cab = true;
    p.camRel = null; p.camLookRel = null; p.camUp = null;
    p.camYaw = Math.atan2(-this._fwd.x, -this._fwd.z);
    p.camFloor = null;
    return true;
  }

  /** The operator's readout. */
  readout() {
    const sys = this.sys;
    const here = this.stationHere();
    const kph = (v) => Math.round(v * 3.6);
    const lim = kph(Math.min(...[0, 20, 40, 60].map((d) => this.limitAt(this.lead + this.dir * d))));
    const bound = sys.bound(this);
    if (here && this.doors) return `${bound} · ${here.full} Station — doors open · POWER to depart`;
    const st = this.nextStation();
    const ah = sys.aheadOf(this), o = ah && ah.o;
    const gap = ah ? (ah.tail - this.lead) * this.dir : Infinity;
    // the train ahead: a figure within 600 m, a warning inside braking distance
    const v = Math.abs(this.u), stopD = v * v / (2 * LINK.brake) + 40;
    const ahead = gap < stopD ? ` · STOP — TRAIN AHEAD ${Math.max(0, Math.round(gap))} m` : gap < 600 ? ` · train ahead ${Math.round(gap)} m` : '';
    const M = sys.merge;
    const sig = M && this.dir < 0 && this.lead > M.E && this.lead - M.E < 400 && !(M.owner === this || sys.mergeFree(this)) ? ` · JUNCTION SIGNAL STOP ${Math.round(this.lead - M.E)} m` : '';
    if (!st) return `${bound} · end of the map ahead · limit ${lim} km/h${ahead}${sig}`;
    const left = (st.stop[this.track.key] + this.dir * LINK.len / 2 - this.lead) * this.dir;
    return `${sys.lineOf(this.track.key) === 2 ? '2 Line · ' : ''}Next: ${st.full} ${Math.max(0, left).toFixed(left < 30 ? 1 : 0)} m · limit ${lim} km/h${ahead}${sig}`;
  }

  /** player.js calls this as it calls any vehicle's update. */
  update(dt, input) {
    const sys = this.sys, tr = this.track;
    this.driver = 'player';
    const thr = clamp(input.throttle || 0, 0, 1), brk = clamp(input.brake || 0, 0, 1);
    // THE END OF THE MAP: change ends and take the other track back (the
    // crossover and the terminal are off the map)
    const atEnd = (this.dir > 0 && this.s > tr.len - LINK.len / 2 - 1) || (this.dir < 0 && this.s < LINK.len / 2 + 1);
    if (atEnd && Math.abs(this.u) < 0.05 && thr > 0.3) {
      const nt = tr.other;
      const s = this.dir > 0 ? nt.len - LINK.len / 2 - 2 : LINK.len / 2 + 2;
      const busy = sys.trains.some((o) => o !== this && o.track === nt && o.state !== 'off' && Math.abs(o.s - s) < LINK.len + 60);
      if (busy) { if (this.warned <= 0) { sys.say('Wait — a train is on the other track'); this.warned = 3; } }
      else {
        this.track = nt; this.dir = nt.dir; this.s = s; this.u = 0; this.lastStop = null;
        sys.say(`You change ends — the ${sys.bound(this)} on the other track`);
        this.arrival = { from: null, t: 0, rated: false };
      }
    }
    let power = thr;
    const v = this.u * this.dir;
    if (brk > 0.5 && thr < 0.1 && v <= 0.05) {
      this._revT = (this._revT || 0) + dt;
      if (this._revT > 0.6) power = -1;
    } else this._revT = 0;
    if (power !== 0 && this.doors) { this.doors = false; sys.onDoors(this, false); }
    const ev = this.step(dt, power, power < 0 ? 0 : brk);
    if (this.arrival) this.arrival.t += dt;
    // the next stop called as you come into it
    const nx = this.nextStation();
    if (nx && nx !== this._announced && Math.abs(this.u) > 1) {
      const togo = (nx.stop[this.track.key] + this.dir * LINK.len / 2 - this.lead) * this.dir;
      if (togo < 220 && togo > 8) { this._announced = nx; sys.announce(nx.full); }
    }
    if (ev.end > 1.5) sys.onEnd(this);
    else if (ev.end !== undefined && this.warned <= 0) { sys.onEnd(this); this.warned = 6; }
    if (ev.collide) sys.onCollide(this, ev.collide);
    // too fast for a curve: the wheels squeal; far too fast, it hurts
    if (ev.lat > 1.6) {
      if (this.warned <= 0) { sys.say('Too fast for the curve — ease off'); this.warned = 5; }
      if (ev.lat > 3.2) { sys.game && sys.game.damagePlayer((ev.lat - 3.2) * dt * 8, 'crash'); this.u *= Math.exp(-0.4 * dt); }
      this.skid = clamp((ev.lat - 1.6) / 2, 0, 1);
    } else this.skid = 0;
    this.warned -= dt;
    // at rest at a platform: doors open, the stop is judged
    if (Math.abs(this.u) < 0.02 && this.arrival && !this.arrival.rated) {
      let st = null, err = 0;
      for (const q of sys.stations) {
        const e = (q.stop[tr.key] - this.s) * this.dir;     // + short of the mark
        if (Math.abs(e) < 12) { st = q; err = e; }
      }
      if (st && st !== this.arrival.from) {
        this.arrival.rated = true;
        this.doors = true;
        sys.onArrive(this, st, err, this.arrival.t);
        this.lastStop = st;
        this.arrival = { from: st, t: 0, rated: true };
      }
    }
    if (this.arrival && this.arrival.rated && Math.abs(this.u) > 0.5) this.arrival = { from: this.arrival.from, t: 0, rated: false };
  }
}
