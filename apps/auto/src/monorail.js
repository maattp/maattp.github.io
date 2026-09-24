// The Seattle Center Monorail: the 1962 Alweg line from Westlake Center up 5th
// Avenue, through MoPOP to Seattle Center -- its twin beams, both stations, and
// the two trains, which you can drive.
//
// WHERE THE NUMBERS COME FROM. The route is OpenStreetMap's (data/monorail.json,
// written by tools/build_monorail.py). The rest is published, and each figure
// below names its source:
//   [LM]  Seattle Landmarks Preservation Board, Seattle Monorail designation
//         report (2003)
//   [PCI] H. Enderlein, "The Alweg Monorail", PCI Journal, June 1962 -- the
//         structural engineer's own account of the guideway
//   [SMS] Seattle Monorail Services, seattlemonorail.com (about, FAQ)
//   [WP]  Wikipedia, "Seattle Center Monorail"
//   est.  no source publishes it; what it was set from is said
//
//   beam          0.91 m wide x 1.52 m deep, hollow prestressed concrete [LM][PCI]
//   beam top      ~7.6 m (25 ft) over the street [LM]
//   columns       T-shaped, a cantilevered crossarm under both beams, ~85 ft
//                 apart on straights and ~60 ft on curves [LM][PCI]; one arm
//                 per beam where the beams part [WP]
//   Denny curve   591 ft (180 m) radius, 8 deg superelevation [PCI]
//   beam spacing  ~12 ft (3.7-4.0 m) on 5th Ave, narrowing to a gauntlet
//                 near Olive Way where one train at a time may pass [LM][WP]
//   trains        122 ft x 10 ft 3 in x 14 ft (37.2 x 3.12 x 4.27 m), four
//                 articulated sections, a cab at each end [LM]
//   Blue train    "Spirit of Seattle", 6201, the west beam [LM]
//   Red train     "Spirit of Century 21", 6202, the east beam [LM]
//   speed         45 mph (20 m/s) in service [SMS]; 60 mph was the design [LM]
//   braking       3.4 mph/s service, 5.7 mph/s emergency [PCI]
//   trip          ~2 min end to end; 95 s in 1962 [LM][WP]
//
// The beams are named for where they run on 5th Avenue, `west` and `east`.
// Track parameter s runs from the Westlake Center buffer stop (s = 0) to the
// Seattle Center one. A train's local frame has +z toward Seattle Center
// (increasing s) and y = 0 on the beam's running surface.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { GLASS, tagGlass, vehicleAssets } from './vehicles.js';
import { clamp, angleWrap } from './util.js';

export const MONO = {
  beamW: 0.91, beamD: 1.52,
  topOver: 7.6,
  span: 25.9, spanCurve: 18.3,
  bankMax: 8 * Math.PI / 180, bankR: 180,
  len: 37.2, wid: 3.12, secLen: 9.3,
  floor: 0.62,              // floor over the running surface (est.: over 1 m load tyres, whose housings rise into the cars)
  vService: 20.1, vMax: 26.8,
  acc: 1.15,                // est.: 0-45 mph in ~18 s, which the 95 s 1962 run needs
  brake: 1.52, brakeEmerg: 2.55,
  stopGap: 1.4,             // the stop mark: nose this far short of the buffer (est.)
};
const STEP = 1;

// ---------------------------------------------------------------------------
// A beam: the OSM line smoothed, resampled every metre, and given its height,
// curvature and bank.

export class Track {
  constructor(name, raw) {
    this.name = name;
    // Chaikin corner-cutting, endpoints kept: OSM draws the Denny and MoPOP
    // curves as a handful of chords, and a train riding chords jerks at each.
    let p = raw.map((q) => [q[0], q[1], q[2] || 0]);
    for (let it = 0; it < 3; it++) {
      const o = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1], f = a[2] && b[2] ? 1 : 0;
        if (i > 0) o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, f]);
        if (i < p.length - 2) o.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, f]);
      }
      o.push(p[p.length - 1]);
      p = o;
    }
    // resample by arc length
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
      this.F[i] = p[j][2] && p[j + 1][2] ? 1 : 0;
    }
    // heading of travel toward Seattle Center, and curvature (+ = turning
    // left: heading rises, HEADING_SENSE) over +-4 m
    this.H = new Float64Array(n); this.K = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      this.H[i] = Math.atan2(this.X[b] - this.X[a], this.Z[b] - this.Z[a]);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 4), b = Math.min(n - 1, i + 4);
      this.K[i] = b > a ? angleWrap(this.H[b] - this.H[a]) / ((b - a) * STEP) : 0;
    }
    // The passage through MoPOP, as an s range.
    let f0 = -1, f1 = -1;
    for (let i = 0; i < n; i++) if (this.F[i]) { if (f0 < 0) f0 = i; f1 = i; }
    this.mopop = f0 >= 0 ? [f0 * STEP, f1 * STEP] : null;
    // Bank: 8 deg at the Denny curve's 180 m radius [PCI], in proportion
    // below it, capped there above it, and eased in over 24 m like a
    // transition spiral so the car does not snap into it.
    const B = new Float64Array(n);
    for (let i = 0; i < n; i++) B[i] = Math.sign(this.K[i]) * Math.min(MONO.bankMax, MONO.bankMax * Math.abs(this.K[i]) * MONO.bankR);
    this.B = boxAvg(B, 12);
  }

  /** Beam-top heights: the street under it plus 7.6 m, smoothed, levelled
   *  through the stations. `zones` = [[s0, s1], ...] held flat. */
  setHeights(zones, ground) {
    const n = this.n, r = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = ground(this.X[i], this.Z[i]) + MONO.topOver;
    for (const [s0, s1] of zones) {
      const i0 = Math.max(0, Math.floor(s0 / STEP)), i1 = Math.min(n - 1, Math.ceil(s1 / STEP));
      let m = -Infinity;
      for (let i = i0; i <= i1; i++) m = Math.max(m, r[i]);
      for (let i = i0; i <= i1; i++) r[i] = m;
    }
    // average(dilate(r)) >= r at every sample: never below its clearance
    this.Y = boxAvg(dilate(r, 30), 30);
    for (const [s0, s1] of zones) {
      const i0 = Math.max(0, Math.floor(s0 / STEP)), i1 = Math.min(n - 1, Math.ceil(s1 / STEP));
      let m = -Infinity;
      for (let i = i0; i <= i1; i++) m = Math.max(m, this.Y[i]);
      for (let i = i0; i <= i1; i++) this.Y[i] = m;
    }
    this.Y = boxAvg(dilate(this.Y, 8), 8);
  }

  _i(s) {
    const f = clamp(s, 0, this.len) / STEP;
    const i = Math.min(this.n - 2, Math.floor(f));
    return [i, f - i];
  }
  x(s) { const [i, t] = this._i(s); return this.X[i] + (this.X[i + 1] - this.X[i]) * t; }
  z(s) { const [i, t] = this._i(s); return this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t; }
  y(s) { const [i, t] = this._i(s); return this.Y[i] + (this.Y[i + 1] - this.Y[i]) * t; }
  bank(s) { const [i, t] = this._i(s); return this.B[i] + (this.B[i + 1] - this.B[i]) * t; }
  curv(s) { const [i, t] = this._i(s); return this.K[i] + (this.K[i + 1] - this.K[i]) * t; }
  heading(s) { const [i, t] = this._i(s); return this.H[i] + angleWrap(this.H[i + 1] - this.H[i]) * t; }
  /** Nearest s to a point (a scan: boot-time and a few times a second only). */
  nearest(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return { s: best * STEP, d: Math.sqrt(bd) };
  }
}

function boxAvg(a, r) {
  const n = a.length, o = new Float64Array(n);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - r), i1 = Math.min(n - 1, i + r);
    o[i] = (pre[i1 + 1] - pre[i0]) / (i1 - i0 + 1);
  }
  return o;
}
function dilate(a, r) {
  const n = a.length, o = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) if (a[j] > m) m = a[j];
    o[i] = m;
  }
  return o;
}

/** The rectangle a platform polygon covers, laid along `yaw` (world heading). */
function rectAlong(poly, yaw) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);   // along
  const lx = fz, lz = -fx;                         // across
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [x, z] of poly) {
    const a = x * fx + z * fz, b = x * lx + z * lz;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  const am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
  return { x: fx * am + lx * bm, z: fz * am + lz * bm, along: (a1 - a0) / 2, across: (b1 - b0) / 2, fx, fz, lx, lz };
}

// ---------------------------------------------------------------------------
// Colours (linear-ish sRGB triples for vertex colours)

const C = {
  concrete: [0.60, 0.59, 0.56], concreteDk: [0.47, 0.46, 0.44], worn: [0.40, 0.39, 0.37],
  rail: [0.20, 0.20, 0.21], pad: [0.12, 0.12, 0.12], white: [0.90, 0.90, 0.87],
  teal: [0.05, 0.42, 0.44], roof: [0.55, 0.57, 0.58], roofLt: [0.80, 0.84, 0.84],
  deck: [0.66, 0.65, 0.62], tactile: [0.86, 0.72, 0.12], yellow: [0.88, 0.70, 0.08],
  black: [0.06, 0.06, 0.06], spandrel: [0.07, 0.17, 0.18], globe: [0.97, 0.96, 0.9],
  shop: [0.30, 0.33, 0.35], soffit: [0.52, 0.52, 0.50], glassDk: [0.10, 0.16, 0.18],
};

const add3 = (a, v, k) => [a[0] + v[0] * k, a[1] + v[1] * k, a[2] + v[2] * k];
const T = (x, z) => G.terrainHeight(x, z);
const GLASS_C = GLASS;
const uv = [0, 0, 1, 0, 1, 1, 0, 1];

/** A box with arbitrary axes: centre c, half-extents along unit vectors u, v, w. */
function obox(b, c, u, hu, v, hv, w, hw, col, faces = 63) {
  const P = (su, sv, sw) => [c[0] + u[0] * hu * su + v[0] * hv * sv + w[0] * hw * sw,
    c[1] + u[1] * hu * su + v[1] * hv * sv + w[1] * hw * sw, c[2] + u[2] * hu * su + v[2] * hv * sv + w[2] * hw * sw];
  const neg = (a) => [-a[0], -a[1], -a[2]];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  if (faces & 1) b.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), u, uv, col);
  if (faces & 2) b.quad(P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), P(-1, -1, 1), neg(u), uv, col);
  if (faces & 4) b.quad(P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1), v, uv, col);
  if (faces & 8) b.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), neg(v), uv, col);
  if (faces & 16) b.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), w, uv, col);
  if (faces & 32) b.quad(P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), neg(w), uv, col);
}
/** Axis-aligned-in-yaw box: base centre (x, y0, z), yaw = world heading of its +w axis. */
function ybox(b, x, y0, z, yaw, hu, hv, hw, col, faces = 63) {
  const w = [Math.sin(yaw), 0, Math.cos(yaw)], u = [Math.cos(yaw), 0, -Math.sin(yaw)];
  obox(b, [x, y0 + hv, z], u, hu, [0, 1, 0], hv, w, hw, col, faces);
}
/** A tapered vertical shaft: square-ish section (hu0 x hw0 at y0 to hu1 x hw1 at y1). */
function shaft(b, x, z, yaw, y0, y1, hu0, hw0, hu1, hw1, col) {
  const w = [Math.sin(yaw), 0, Math.cos(yaw)], u = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const P = (su, sw, top) => {
    const hu = top ? hu1 : hu0, hw = top ? hw1 : hw0, y = top ? y1 : y0;
    return [x + u[0] * hu * su + w[0] * hw * sw, y, z + u[2] * hu * su + w[2] * hw * sw];
  };
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  for (const [a, bb, n] of [[[1, -1], [1, 1], u], [[-1, 1], [-1, -1], [-u[0], 0, -u[2]]], [[1, 1], [-1, 1], w], [[-1, -1], [1, -1], [-w[0], 0, -w[2]]]]) {
    b.quad(P(a[0], a[1], 0), P(bb[0], bb[1], 0), P(bb[0], bb[1], 1), P(a[0], a[1], 1), n, uv, col);
  }
}

/** Frame of a beam at s: forward f, left l, up u (banked), top-centre p. */
function frameAt(tr, s) {
  const h = tr.heading(s), phi = -tr.bank(s);
  const f = [Math.sin(h), 0, Math.cos(h)];
  const l0 = [Math.cos(h), 0, -Math.sin(h)];
  const c = Math.cos(phi), sn = Math.sin(phi);
  const l = [l0[0] * c, sn, l0[2] * c];
  const u = [-l0[0] * sn, c, -l0[2] * sn];
  return { f, l, u, p: [tr.x(s), tr.y(s), tr.z(s)], h };
}

// ---------------------------------------------------------------------------
// The line: both beams, their stations, where columns can stand, and the
// static structure.

export class Monorail {
  /**
   * From the map data alone, right after the map loads: citygen needs
   * clearZones() before the city exists. attach(city) comes later.
   */
  constructor(data) {
    this.city = null;
    this.data = data;
    this.tracks = { west: new Track('west', data.tracks.west), east: new Track('east', data.tracks.east) };
    const st = (re) => data.stations.find((q) => re.test(q.name || ''));
    this.wlStation = st(/Westlake/); this.scStation = st(/Seattle Center/);
    // Platforms: Seattle Center's three (exit on the two outer, board on the
    // middle one [LM]) and Westlake's one on the west side [LM][OSM].
    const cen = (p) => p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]);
    this.scPlatforms = data.platforms.filter((p) => { const c = cen(p.p); return Math.hypot(c[0] - this.scStation.x, c[1] - this.scStation.z) < 80; });
    this.wlPlatforms = data.platforms.filter((p) => { const c = cen(p.p); return Math.hypot(c[0] - this.wlStation.x, c[1] - this.wlStation.z) < 80; });
    // Station zones along each beam: Westlake from its buffer to past the
    // platform's north end; Seattle Center the last 52 m.
    for (const tr of Object.values(this.tracks)) {
      let wl1 = 30;
      for (const p of this.wlPlatforms) for (const [x, z] of p.p) wl1 = Math.max(wl1, tr.nearest(x, z).s);
      let sc0 = tr.len - 40;
      for (const p of this.scPlatforms) for (const [x, z] of p.p) { const q = tr.nearest(x, z); if (q.d < 12) sc0 = Math.min(sc0, q.s); }
      tr.wlZone = [0, wl1 + 4];
      tr.scZone = [sc0 - 4, tr.len];
    }
    this._heights();
    const W = this.tracks.west, E = this.tracks.east;
    // The gauntlet: where the beams close in near Olive Way and only one
    // train may be at a time [LM][WP]. Measured from the geometry: the run
    // from Westlake over which the beams are nearer than two half-widths plus
    // a margin.
    let g = 0;
    for (let s = 0; s < W.len; s += 2) {
      if (E.nearest(W.x(s), W.z(s)).d < MONO.wid + 0.4) g = s; else if (s > 40) break;
    }
    this.gauntlet = g;
    this.columns = [];
    this.solids = [];
    this.platforms = [];
  }

  /**
   * The passage through MoPOP (tunnel=building_passage in OSM): the midline
   * between the beams, 12 m either side of the mapped stretch, and the
   * half-width a lobe must keep clear of it. landmarks.js pushes MoPOP's
   * skins out of it: the real line runs through a valley in the building
   * between a flat blue wall and an overhanging gold one [WP].
   */
  passage() {
    const W = this.tracks.west, E = this.tracks.east;
    if (!W.mopop) return null;
    const pts = [];
    for (let s = W.mopop[0] - 12; s <= W.mopop[1] + 12; s += 2) {
      const q = E.nearest(W.x(s), W.z(s));
      pts.push([(W.x(s) + E.x(q.s)) / 2, (W.z(s) + E.z(q.s)) / 2, q.d / 2 + MONO.wid / 2 + 0.9]);
    }
    return pts;
  }

  /** The city is built: heights again over the carved terrain. */
  attach(city) {
    this.city = city;
    this._heights();
  }

  _heights() {
    const W = this.tracks.west, E = this.tracks.east;
    for (const tr of [W, E]) tr.setHeights([tr.wlZone, tr.scZone], (x, z) => G.terrainHeight(x, z));
    // Both beams at one level through each station, so the platforms between
    // them are level too.
    for (const zoneKey of ['wlZone', 'scZone']) {
      const yw = W.y((W[zoneKey][0] + W[zoneKey][1]) / 2), ye = E.y((E[zoneKey][0] + E[zoneKey][1]) / 2);
      const m = Math.max(yw, ye);
      for (const tr of [W, E]) {
        const [s0, s1] = tr[zoneKey], d = m - tr.y((s0 + s1) / 2);
        if (d <= 0) continue;
        // lift the zone and ease back over 40 m outside it
        for (let i = 0; i < tr.n; i++) {
          const s = i * STEP, out = s < s0 ? s0 - s : s > s1 ? s - s1 : 0;
          tr.Y[i] += d * clamp(1 - out / 40, 0, 1);
        }
      }
    }
    this.wlFloor = W.y(W.wlZone[0] + 10) + MONO.floor;
    this.scFloor = W.y(W.len - 10) + MONO.floor;
  }

  /**
   * Where no building may stand, for citygen: along both beams (a train's
   * half-width and a margin), and the two stations with Seattle Center's
   * ramp. Oriented rects {x, z, hw, hd, rot} in the landmark-solid convention,
   * with `y`: a building whose roof is below it (under the beams, say) stays.
   */
  clearZones() {
    const out = [];
    for (const tr of Object.values(this.tracks)) {
      for (let s = 0; s < tr.len; s += 8) {
        const s1 = Math.min(tr.len, s + 8), sm = (s + s1) / 2;
        const h = tr.heading(sm);
        out.push({ x: tr.x(sm), z: tr.z(sm), hw: 2.3, hd: (s1 - s) / 2 + 0.5, rot: -h, y: tr.y(sm) - MONO.beamD - 0.6 });
      }
    }
    const around = (poly, pad, y) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      out.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2 + pad, hd: (z1 - z0) / 2 + pad, rot: 0, y });
    };
    // Seattle Center: platforms, the concourse 12 m past them, the ramp south.
    // Tight to what _stationSC builds: the Armory's east face is 0.2 m past
    // the concourse's end, and a padded zone deleted the whole building.
    const scPts = this.scPlatforms.flatMap((p) => p.p);
    around(scPts, 3, -Infinity);
    let wx = Infinity;
    for (const [x] of scPts) wx = Math.min(wx, x);
    const zs = scPts.map((q) => q[1]), z0 = Math.min(...zs), z1 = Math.max(...zs);
    around([[wx - 11.8, z0], [wx, z1]], 0, -Infinity);
    around([[wx - 11.5, z1], [wx - 6, z1 + 80]], 0, -Infinity);
    // Westlake: the platform and the hall behind it
    around(this.wlPlatforms.flatMap((p) => p.p), 5, -Infinity);
    return out;
  }

  // --- where a column may stand ---------------------------------------------
  //
  // The real columns stand in the middle of 5th Avenue, splitting its lanes
  // [WP] -- OSM draws the avenue as two one-way carriageways either side of
  // them -- and on the west kerb of 5th Avenue N. So the landmark rule
  // (nothing solid on a carriageway) is replaced here by the one that
  // matters: nothing solid where a lane of traffic drives. A one-way edge's
  // lanes run within hw - 2.2 of its centreline (parking at the kerb,
  // traffic.js), a two-way edge's at +-0.48 hw; a car is ~2 m wide. And no
  // column inside a junction, where turning traffic sweeps the corner.
  laneClear(x, z, r) {
    const city = this.city;
    for (const ei of city.edgesNear(x, z, 40)) {
      const e = city.edges[ei];
      if (e.elev || e.tunnel) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const ab = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const t = clamp(((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / (ab * ab), 0, 1);
      const d = Math.hypot(x - (a.x + (b.x - a.x) * t), z - (a.z + (b.z - a.z) * t));
      if (d > e.hw + r + 1) continue;
      // the lanes as traffic.js lays them (laneLat): a one-way edge's across
      // its width less parking or shoulder, 4.2 m apart; a two-way edge's
      // at 0.48 hw each side. A car's body is ~1 m either side of its lane.
      let lanes;
      if (e.oneway || e.onewayRev) {
        const inset = e.elev || e.cls === 'hwy' || e.cls === 'ramp' ? 0.8 : 2.2;
        const lo = -e.hw + inset, hi = e.hw - inset;
        const n = hi > lo ? Math.max(1, Math.floor((hi - lo) / 4.2)) : 1;
        lanes = [];
        for (let i = 0; i < n; i++) lanes.push(hi > lo ? lo + ((i + 0.5) * (hi - lo)) / n : 0);
      } else lanes = [e.hw * 0.48, -e.hw * 0.48];
      for (const c of lanes) if (Math.abs(d - Math.abs(c)) < 1.0 + 0.4 + r || (c === 0 && d < 1.4 + r)) return false;
    }
    for (const ei of city.edgesNear(x, z, 30)) {
      const e = city.edges[ei];
      for (const ni of [e.a, e.b]) {
        const n = city.nodes[ni];
        if (n.e.length < 3 || n.elev) continue;
        let hw = 0;
        for (const k of n.e) hw = Math.max(hw, city.edges[k].hw);
        if (Math.hypot(n.x - x, n.z - z) < hw + 2.5 + r) return false;
      }
    }
    return true;
  }

  /** Column sites along the line: [{x, z, yaw, arms: [{tr, s, off}], y0}]. */
  placeColumns() {
    const W = this.tracks.west, E = this.tracks.east;
    const out = [];
    const busy = (tr, s) => (s < tr.wlZone[1] + 2) || (s > tr.scZone[0] - 2) || (tr.mopop && s > tr.mopop[0] - 3 && s < tr.mopop[1] + 3);
    let s = W.wlZone[1] + 6;
    while (s < W.len) {
      if (busy(W, s)) { s += 2; continue; }
      const f = frameAt(W, s);
      const q = E.nearest(f.p[0], f.p[2]);
      const k = Math.max(Math.abs(W.curv(s)), Math.abs(E.curv(q.s)));
      const span = k > 1 / 400 ? MONO.spanCurve : MONO.span;
      // centre between the beams, then sideways off it until no lane is hit
      let site = null;
      const tryAt = (along) => {
        const ss = s + along;
        if (busy(W, ss)) return null;
        const g = frameAt(W, ss), qe = E.nearest(g.p[0], g.p[2]);
        if (busy(E, qe.s)) return null;
        const ex2 = E.x(qe.s), ez2 = E.z(qe.s);
        const cx = (g.p[0] + ex2) / 2, cz = (g.p[2] + ez2) / 2;
        for (const off of [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6, 7.5, -7.5]) {
          const x = cx + g.l[0] * off, z = cz + g.l[2] * off;
          if (this.laneClear(x, z, 0.8)) return { x, z, yaw: g.h, sw: ss, se: qe.s, off };
        }
        return null;
      };
      for (const along of [0, 2, -2, 4, -4, 6, -6]) { site = tryAt(along); if (site) break; }
      if (site) {
        out.push(site);
        s = site.sw + span;
      } else s += 4;
    }
    this.columns = out;
    return out;
  }

  /**
   * The static line: beams, columns, both stations. `h.sign(text, w, h, bg,
   * fg, opts)` is the landmarks' sign atlas (one texture for all lettering).
   * Returns { meshes, signs, solids, platforms, clear, lamps }: the meshes are
   * already merged (one vertex-coloured material, in ~500 m blocks so each
   * culls on its own), the signs go through the landmark clusters.
   */
  buildStructure(h) {
    const W = this.tracks.west, E = this.tracks.east;
    // Two halves, split at Denny Way: smaller blocks culled better and cost a
    // draw (and a shadow draw) each, and from anywhere near the line three or
    // four of them were in view at once.
    const blocks = new Map();
    const B = (x, z) => {
      const k = x > -420 ? 'downtown' : 'center';
      let b = blocks.get(k);
      if (!b) blocks.set(k, (b = new Builder(false)));
      return b;
    };
    const signs = new THREE.Group();
    const solids = this.solids, platforms = this.platforms, clear = [];
    const add = add3;

    // --- the beams --------------------------------------------------------
    const HB = MONO.beamW / 2, D = MONO.beamD;
    for (const tr of [W, E]) {
      const N = Math.ceil(tr.len / 2);
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const s = (i / N) * tr.len;
        const fr = frameAt(tr, s);
        const TL = add(fr.p, fr.l, HB), TR = add(fr.p, fr.l, -HB);
        const ring = {
          TL, TR, BL: add(TL, fr.u, -D), BR: add(TR, fr.u, -D),
          // the power rail's channel at mid-height, a little proud [LM][PCI]
          rL0: add(add(TL, fr.u, -0.62), fr.l, 0.03), rL1: add(add(TL, fr.u, -0.88), fr.l, 0.03),
          rR0: add(add(TR, fr.u, -0.62), fr.l, -0.03), rR1: add(add(TR, fr.u, -0.88), fr.l, -0.03),
          l: fr.l, u: fr.u, s,
        };
        if (prev) {
          const a = prev, c = ring, b = B(fr.p[0], fr.p[2]);
          const nl = a.l, nr = [-a.l[0], -a.l[1], -a.l[2]], nu = a.u, nd = [-a.u[0], -a.u[1], -a.u[2]];
          // a span joint every ~26 m reads as a dark line
          const joint = Math.floor(a.s / MONO.span) !== Math.floor(c.s / MONO.span);
          b.quad(a.TL, a.TR, c.TR, c.TL, nu, uv, joint ? C.pad : C.worn);
          b.quad(a.TL, a.BL, c.BL, c.TL, nl, uv, joint ? C.concreteDk : C.concrete);
          b.quad(a.TR, a.BR, c.BR, c.TR, nr, uv, joint ? C.concreteDk : C.concrete);
          b.quad(a.BL, a.BR, c.BR, c.BL, nd, uv, C.concreteDk);
          b.quad(a.rL0, a.rL1, c.rL1, c.rL0, nl, uv, C.rail);
          b.quad(a.rR0, a.rR1, c.rR1, c.rR0, nr, uv, C.rail);
        }
        if (i === 0 || i === N) {
          const b = B(fr.p[0], fr.p[2]), n = i === 0 ? [-fr.f[0], 0, -fr.f[2]] : fr.f;
          b.quad(ring.TL, ring.TR, ring.BR, ring.BL, n, uv, C.concreteDk);
          // hydraulic buffer stop on the beam end: yellow with a black face
          const at = add(fr.p, fr.f, i === 0 ? 0.45 : -0.45);
          obox(b, add(at, fr.u, 0.55), fr.l, 0.62, fr.u, 0.55, fr.f, 0.4, C.yellow);
          obox(b, add(add(at, fr.u, 0.55), fr.f, i === 0 ? 0.42 : -0.42), fr.l, 0.5, fr.u, 0.4, fr.f, 0.03, C.black);
        }
        prev = ring;
      }
    }

    // --- the gauntlet's signal heads, on a mast off each beam's outer side ---
    for (const l of this.signalSites()) {
      const b = B(l.x, l.z);
      shaft(b, l.x, l.z, l.yaw, l.y - 3.2, l.y - 0.55, 0.07, 0.07, 0.07, 0.07, [0.24, 0.24, 0.25]);
      ybox(b, l.x, l.y - 0.55, l.z, l.yaw, 0.28, 0.55, 0.18, [0.08, 0.08, 0.08]);
    }

    // --- the columns ------------------------------------------------------
    for (const c of this.placeColumns()) {
      const fw = frameAt(W, c.sw), fe = frameAt(E, c.se);
      const bw = add(fw.p, fw.u, -D), be = add(fe.p, fe.u, -D);
      const l = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)], f = [Math.sin(c.yaw), 0, Math.cos(c.yaw)];
      const lat = (p) => (p[0] - c.x) * l[0] + (p[2] - c.z) * l[2];
      const aw = lat(bw), ae = lat(be);
      const a0 = Math.min(aw, ae, 0) - 0.75, a1 = Math.max(aw, ae, 0) + 0.75;
      const armTop = Math.min(bw[1], be[1]) - 0.06;
      const y0 = T(c.x, c.z) - 0.3;
      const b = B(c.x, c.z);
      const am = (a0 + a1) / 2;
      // the crossarm: deep over the shaft, 1.0 m at the tips [PCI est.]
      obox(b, [c.x + l[0] * am, armTop - 0.5, c.z + l[2] * am], l, (a1 - a0) / 2, [0, 1, 0], 0.5, f, 0.55, C.concrete);
      // the haunch where the shaft flares into the arm
      shaft(b, c.x, c.z, c.yaw, armTop - 1.9, armTop - 1.0, 0.55, 0.5, 1.15, 0.55, C.concrete);
      // the shaft: ~4 ft square at the street, tapering [PCI]
      shaft(b, c.x, c.z, c.yaw, y0, armTop - 1.9, 0.62, 0.62, 0.55, 0.5, C.concrete);
      // a kerbed plinth in the median
      ybox(b, c.x, y0, c.z, c.yaw, 1.0, 0.42, 0.95, C.concreteDk);
      // bearing pads under each beam
      for (const p of [bw, be]) ybox(b, p[0], armTop, p[2], c.yaw, HB * 0.8, (p[1] - armTop) / 2, 0.4, C.pad);
      solids.push({ x: c.x, z: c.z, hw: 0.8, hd: 0.75, rot: -c.yaw, y0, y1: armTop, mono: true });
    }

    this._stationSC(B, h, signs, clear);
    this._stationWL(B, h, signs, clear);

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04, envMapIntensity: 0.62 });
    const meshes = [];
    for (const b of blocks.values()) {
      if (b.empty) continue;
      const m = new THREE.Mesh(b.build(), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.name = 'monorail';
      meshes.push(m);
    }
    this.lampSites = this.signalSites();
    return { meshes, signs, solids, platforms, clear, lamps: this.lampSites };
  }

  /**
   * Seattle Center: the 1962 station. Upper level: three platforms, exit on
   * the two outer and board on the middle one [LM], under a canopy of
   * welded steel painted deep turquoise, corrugated metal with translucent
   * panels, and globe lights on stems [LM]. Lower level: the maintenance
   * shop [LM]. At the west end the concourse to the Armory, and a wide
   * ramp down to the south [LM] toward the Needle.
   */
  _stationSC(B, h, signs, clear) {
    const W = this.tracks.west, E = this.tracks.east;
    const yaw = W.heading(W.len - 24);                // toward the buffers (west)
    const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = fz, lz = -fx;
    const A = (x, z) => x * fx + z * fz, Bc = (x, z) => x * lx + z * lz;
    const P = (a, b) => [fx * a + lx * b, fz * a + lz * b];
    const floor = this.scFloor;
    const beamTop = Math.min(W.y(W.len - 10), E.y(E.len - 10));
    const lowRoof = beamTop - MONO.beamD - 0.05;
    const b = B(this.scStation.x, this.scStation.z);
    const trackB = (tr, a) => {
      // the beam's across-coordinate where it passes along-coordinate a
      let best = null, bd = Infinity;
      for (let s = tr.scZone[0] - 20; s <= tr.len; s += 1) {
        const d = Math.abs(A(tr.x(s), tr.z(s)) - a);
        if (d < bd) { bd = d; best = Bc(tr.x(s), tr.z(s)); }
      }
      return best;
    };
    let ua0 = Infinity, ua1 = -Infinity, ub0 = Infinity, ub1 = -Infinity;
    const decks = [];
    for (const pl of this.scPlatforms) {
      const r = rectAlong(pl.p, yaw);
      const a0 = A(r.x, r.z) - r.along, a1 = A(r.x, r.z) + r.along;
      let lo = Bc(r.x, r.z) - r.across, hi = Bc(r.x, r.z) + r.across;
      // clear of both trains: 1.62 m from each beam's centreline
      const edges = [], reach = { 1: Infinity, [-1]: Infinity };
      const tbs = [];
      for (const tr of [W, E]) {
        const pair = [];
        for (const a of [a0, a1]) {
          const tb = trackB(tr, a);
          if (tb === null) continue;
          const mid = (lo + hi) / 2;
          if (tb >= mid) { hi = Math.min(hi, tb - 1.66); edges.push(1); } else { lo = Math.max(lo, tb + 1.66); edges.push(-1); }
          pair.push(tb);
        }
        tbs.push(pair);
      }
      // How far each track-facing edge is from ITS beam (the nearer one on
      // that side -- an outer platform also sees the far beam past the middle
      // platform) at the farther end: the beams are not parallel to the frame.
      for (const pair of tbs) {
        if (!pair.length) continue;
        if (pair.every((tb) => tb >= hi)) reach[1] = Math.min(reach[1], Math.max(...pair.map((tb) => tb - hi)));
        else if (pair.every((tb) => tb <= lo)) reach[-1] = Math.min(reach[-1], Math.max(...pair.map((tb) => lo - tb)));
      }
      decks.push({ a0, a1, lo, hi, faces: new Set(edges), reach });
      ua0 = Math.min(ua0, a0); ua1 = Math.max(ua1, a1); ub0 = Math.min(ub0, lo); ub1 = Math.max(ub1, hi);
    }
    // Every platform runs the station's whole length, into the concourse: OSM's
    // three are 47-48 m and differ by up to 0.9 m, and the gap a short one left
    // at the concourse was a hole into the track slot you fell through.
    for (const d of decks) { d.a0 = ua0; d.a1 = ua1 + 0.3; }
    // the concourse: 12 m on past the buffers, the full width
    const conA0 = ua1, conA1 = ua1 + 12;
    const deckBox = (a0, a1, lo, hi, y0, y1, col) => {
      const [cx, cz] = P((a0 + a1) / 2, (lo + hi) / 2);
      ybox(b, cx, y0, cz, yaw, (hi - lo) / 2, (y1 - y0) / 2, (a1 - a0) / 2, col);
      return { x: cx, z: cz, hw: (hi - lo) / 2, hd: (a1 - a0) / 2, rot: -yaw };
    };
    for (const d of decks) {
      const pr = deckBox(d.a0, d.a1, d.lo, d.hi, lowRoof, floor, C.deck);
      this.platforms.push({ ...pr, y0: floor, y1: floor });
      // Yellow tactile strip along each edge that faces a train, and a
      // knee-high barrier on the edge. Stepping off into an empty track slot
      // dropped you 2 m, under the platforms, with no way back; a thin solid
      // on the edge was slipped past when a long frame slid you along it. So
      // the solid fills the slot itself, edge to beam, where only a train
      // ever is (trains collide with nothing). ENTER boards over it
      // (boardable reaches 2.2 m past a train's side).
      for (const side of d.faces) {
        const e = side > 0 ? d.hi : d.lo;
        const [sx, sz] = P((d.a0 + d.a1) / 2, e - side * 0.3);
        ybox(b, sx, floor, sz, yaw, 0.3, 0.012, (d.a1 - d.a0) / 2 - 0.1, C.tactile, 4);
        const [bx, bz] = P((d.a0 + d.a1) / 2, e - side * 0.06);
        ybox(b, bx, floor, bz, yaw, 0.05, 0.3, (d.a1 - d.a0) / 2, [0.85, 0.72, 0.1]);
        // edge to the beam's centreline (at the farther end: the beams are not
        // parallel to the station): the platform across the slot fills the
        // other half, and one reaching past the beam narrowed the platform
        // beyond it until you could not walk onto it
        const w = d.reach[side] + 0.15;
        const [qx, qz] = P((d.a0 + d.a1) / 2, e + side * (w / 2 - 0.1));
        this.solids.push({ x: qx, z: qz, hw: w / 2, hd: (d.a1 - d.a0) / 2, rot: -yaw, y0: floor - 0.3, y1: floor + 1.2, mono: true });
      }
    }
    const con = deckBox(conA0, conA1, ub0 - 1, ub1 + 1, lowRoof, floor, C.deck);
    this.platforms.push({ ...con, y0: floor, y1: floor });
    // the lower level: the shop, under everything, ground to the beams
    {
      const a0 = ua0 - 2, a1 = conA1, lo = ub0 - 1.2, hi = ub1 + 1.2;
      const [cx, cz] = P((a0 + a1) / 2, (lo + hi) / 2);
      let g = Infinity;
      for (const ta of [a0, (a0 + a1) / 2, a1]) for (const tb of [lo, (lo + hi) / 2, hi]) g = Math.min(g, T(...P(ta, tb)));
      g -= 0.5;
      ybox(b, cx, g, cz, yaw, (hi - lo) / 2, (lowRoof - g) / 2, (a1 - a0) / 2, C.concrete);
      // a band of dark shop windows and roller doors round it
      for (const side of [-1, 1]) {
        const [wx, wz] = P((a0 + a1) / 2, side > 0 ? hi + 0.02 : lo - 0.02);
        ybox(b, wx, g + 1.2, wz, yaw, 0.01, 1.1, (a1 - a0) / 2 - 3, C.shop, side > 0 ? 1 : 2);
      }
      this.solids.push({ x: cx, z: cz, hw: (hi - lo) / 2, hd: (a1 - a0) / 2, rot: -yaw, y0: g, y1: lowRoof, mono: true });
      // its roof is ground too: anything that still gets into a track slot
      // stands on it rather than falling into a solid
      this.platforms.push({ x: cx, z: cz, hw: (hi - lo) / 2, hd: (a1 - a0) / 2, rot: -yaw, y0: lowRoof, y1: lowRoof });
      clear.push([cx, cz, Math.hypot(a1 - a0, hi - lo) / 2 + 4]);
    }
    // the canopy: steel posts on each platform, a corrugated roof with
    // translucent bands, turquoise fascia, globe lights on stems
    const roofY = floor + 4.5;
    {
      const a0 = ua0 - 1, a1 = conA1, lo = ub0 - 1.6, hi = ub1 + 1.6;
      const n = 14;
      for (let k = 0; k < n; k++) {
        const b0 = lo + ((hi - lo) * k) / n, b1 = lo + ((hi - lo) * (k + 1)) / n;
        const [cx, cz] = P((a0 + a1) / 2, (b0 + b1) / 2);
        ybox(b, cx, roofY + (k % 2 ? 0.05 : 0), cz, yaw, (b1 - b0) / 2, 0.08, (a1 - a0) / 2, k % 3 === 1 ? C.roofLt : C.roof);
      }
      for (const bb of [lo, hi]) {
        const [cx, cz] = P((a0 + a1) / 2, bb);
        ybox(b, cx, roofY - 0.55, cz, yaw, 0.12, 0.35, (a1 - a0) / 2, C.teal);
      }
      for (const aa of [a0, a1]) {
        const [cx, cz] = P(aa, (lo + hi) / 2);
        ybox(b, cx, roofY - 0.55, cz, yaw, (hi - lo) / 2, 0.35, 0.12, C.teal);
      }
      for (const d of [...decks, { a0: conA0, a1: conA1, lo: ub0, hi: ub1 }]) {
        const mb = (d.lo + d.hi) / 2;
        for (let a = d.a0 + 3; a < d.a1 - 1; a += 7) {
          const [px, pz] = P(a, mb);
          shaft(b, px, pz, yaw, floor, roofY, 0.14, 0.14, 0.14, 0.14, C.teal);
          // a raked strut under the roof each way
          for (const sd of [-1, 1]) {
            const [qx, qz] = P(a, mb + sd * 2.4);
            b.tube([px, roofY - 1.3, pz], [qx, roofY - 0.05, qz], 0.07, 5, C.teal);
          }
          // globe light on a stem
          const [gx, gz] = P(a + 3.5, mb);
          b.tube([gx, floor, gz], [gx, floor + 3.1, gz], 0.05, 5, C.teal);
          b.spheroid(gx, floor + 3.35, gz, 0.26, 8, 6, C.globe);
        }
      }
      // the name, on the fascia both long sides
      for (const side of [-1, 1]) {
        const s = h.sign('SEATTLE CENTER MONORAIL', 11, 0.62, '#0b6b70', '#ffffff', { px: 60 });
        const [cx, cz] = P((a0 + a1) / 2, side > 0 ? hi + 0.14 : lo - 0.14);
        s.position.set(cx, roofY - 0.2, cz);
        s.rotation.y = yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
        signs.add(s);
      }
      clear.push([...P((a0 + a1) / 2, (lo + hi) / 2), Math.hypot(a1 - a0, hi - lo) / 2]);
    }
    // Parapet rails round every open edge of the upper level -- the outer
    // platforms' far sides and the concourse -- so a walker cannot step off.
    // `rail(p, q)` runs between two (along, across) points.
    const rail = (p, q) => {
      const [x0, z0] = P(p[0], p[1]), [x1, z1] = P(q[0], q[1]);
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.3) return;
      const ry = Math.atan2(x1 - x0, z1 - z0);
      ybox(b, (x0 + x1) / 2, floor, (z0 + z1) / 2, ry, 0.05, 0.55, len / 2, C.teal);
      this.solids.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: 0.2, hd: len / 2, rot: -ry, y0: floor - 0.5, y1: floor + 1.1, mono: true });
    };
    for (const d of decks) {
      if (!d.faces.has(1)) rail([d.a0, d.hi - 0.1], [d.a1, d.hi - 0.1]);
      if (!d.faces.has(-1)) rail([d.a0, d.lo + 0.1], [d.a1, d.lo + 0.1]);
      // and across the far end, where the beams come in
      rail([d.a0 + 0.1, d.lo], [d.a0 + 0.1, d.hi]);
    }
    const southHi = lz > 0;                   // the +across side is the south one
    const cLo = ub0 - 0.9, cHi = ub1 + 0.9;
    rail([conA1 - 0.1, cLo], [conA1 - 0.1, cHi]);
    // The ramp: from the concourse's far end, down to the south at 1 in 8.
    {
      const southB = southHi ? ub1 + 1 : ub0 - 1;
      const [sx, sz] = P(conA1 - 3.2, southB);
      let L = 40;
      for (let it = 0; it < 4; it++) L = Math.max(12, (floor - T(sx, sz + L)) * 8);
      const y1 = T(sx, sz + L) + 0.05;
      const cz = sz + L / 2;
      // slab, kerbs and teal rails; its top is a sloped platform
      const Nn = 10;
      for (let k = 0; k < Nn; k++) {
        const za = sz + (L * k) / Nn, zb = sz + (L * (k + 1)) / Nn;
        const ya = floor + (y1 - floor) * (k / Nn), yb = floor + (y1 - floor) * ((k + 1) / Nn);
        b.quad([sx - 2.6, ya, za], [sx + 2.6, ya, za], [sx + 2.6, yb, zb], [sx - 2.6, yb, zb], [0, 1, 0], uv, C.deck);
        for (const sd of [-1, 1]) {
          const x = sx + sd * 2.6;
          b.quad([x, ya, za], [x, yb, zb], [x, Math.min(yb, T(x, zb)) - 0.3, zb], [x, Math.min(ya, T(x, za)) - 0.3, za], [sd, 0, 0], uv, C.concrete);
          b.quad([x, ya + 1.05, za], [x, yb + 1.05, zb], [x, yb + 0.95, zb], [x, ya + 0.95, za], [sd, 0, 0], uv, C.teal);
        }
      }
      this.platforms.push({ x: sx, z: cz, hw: 2.6, hd: L / 2, rot: 0, y0: floor, y1 });
      // and under it, solid: a walker at the foot went in under the slab and
      // was trapped between its side walls. Each tenth is a box whose top is
      // just under the slab's lower end, so on the ramp nothing blocks you.
      for (let k = 0; k < Nn; k++) {
        const za = sz + (L * k) / Nn, zb = sz + (L * (k + 1)) / Nn;
        const top = floor + (y1 - floor) * ((k + 1) / Nn) - 0.2;
        this.solids.push({ x: sx, z: (za + zb) / 2, hw: 2.6, hd: (zb - za) / 2, rot: 0, y0: Math.min(T(sx, za), T(sx, zb)) - 1, y1: top, mono: true });
      }
      for (const sd of [-1, 1]) this.solids.push({ x: sx + sd * 2.75, z: cz, hw: 0.15, hd: L / 2, rot: 0, y0: Math.min(floor, y1) - 0.5, y1: Math.max(floor, y1) + 1.1, mono: true });
      for (let k = 0; k <= 4; k++) clear.push([sx, sz + (L * k) / 4, 5]);
      this.scRamp = { x: sx, z: sz + L - 1.5, y: y1 };
      // the concourse's two long edges: the south one open onto the ramp
      // the ramp's 5.2 m width, measured along the concourse
      const rw = 2.7 * Math.abs(fx) + 0.2;
      const rampA0 = A(sx, sz) - rw, rampA1 = A(sx, sz) + rw;
      const northB = southHi ? cLo : cHi, sB = southHi ? cHi : cLo;
      rail([conA0, northB], [conA1, northB]);
      rail([conA0, sB], [Math.min(rampA0, conA1), sB]);
      if (rampA1 < conA1) rail([rampA1, sB], [conA1, sB]);
    }
    this.scYaw = yaw;
  }

  /**
   * Westlake Center: the terminal on the mall's third floor, in a long
   * opening in its 5th Avenue face framed by a white concrete truss and set
   * in blue-green spandrel glass [LM][SMS]. One platform, on the west side
   * [LM]. In the game the mall's box stops short of 5th Avenue, so the hall
   * stands over the sidewalk between them on white columns, and you reach it
   * from the street door under its south end (in life, the mall's escalators).
   */
  _stationWL(B, h, signs, clear) {
    const W = this.tracks.west, E = this.tracks.east;
    const yaw = W.heading(12);                      // toward Seattle Center
    const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = fz, lz = -fx;
    const A = (x, z) => x * fx + z * fz, Bc = (x, z) => x * lx + z * lz;
    const P = (a, bb) => [fx * a + lx * bb, fz * a + lz * bb];
    const floor = this.wlFloor;
    const beamTop = Math.min(W.y(8), E.y(8));
    const b = B(this.wlStation.x, this.wlStation.z);
    const pl = this.wlPlatforms[0];
    const r = rectAlong(pl.p, yaw);
    const bw = Bc(W.x(12), W.z(12)), be = Bc(E.x(12), E.z(12));
    const pb = Bc(r.x, r.z);
    const side = pb < bw ? -1 : 1;                  // the platform's side of the pair
    // platform: its OSM extent, kept 1.66 m off the west beam
    const pa0 = A(r.x, r.z) - r.along, pa1 = A(r.x, r.z) + r.along;
    let plo = pb - r.across, phi = pb + r.across;
    if (side < 0) phi = Math.min(phi, bw - 1.66); else plo = Math.max(plo, bw + 1.66);
    // from just behind the buffer stops (Pine St's crossing is beyond them)
    const a0 = Math.min(A(W.x(0), W.z(0)), A(E.x(0), E.z(0))) - 1, a1 = Math.max(pa1, A(W.x(W.wlZone[1]), W.z(W.wlZone[1]))) + 2;
    const hallFar = side < 0 ? Math.min(plo, pb - 1.5) - 3.5 : Math.max(phi, pb + 1.5) + 3.5;
    const trackFar = side < 0 ? Math.max(bw, be) + 2.3 : Math.min(bw, be) - 2.3;
    const lo = Math.min(hallFar, trackFar), hi = Math.max(hallFar, trackFar);
    const slabTop = beamTop - 1.12, slabBot = beamTop - 1.6, roofY = floor + 5.2;
    const box = (aa0, aa1, bb0, bb1, y0, y1, col, faces) => {
      const [cx, cz] = P((aa0 + aa1) / 2, (bb0 + bb1) / 2);
      ybox(b, cx, y0, cz, yaw, (bb1 - bb0) / 2, (y1 - y0) / 2, (aa1 - aa0) / 2, col, faces);
      return [cx, cz];
    };
    // Blue-green spandrel glass: the landmarks' sky-folded glass, tinted in a
    // backing box just behind it, through the sign clusters.
    const glass = (aa0, aa1, bb0, bb1, y0, y1) => {
      box(aa0, aa1, bb0, bb1, y0, y1, C.spandrel);
      const [cx, cz] = P((aa0 + aa1) / 2, (bb0 + bb1) / 2);
      const m = new THREE.Mesh(new THREE.BoxGeometry(bb1 - bb0 + 0.06, y1 - y0 - 0.04, aa1 - aa0 + 0.06), h.glass);
      m.position.set(cx, (y0 + y1) / 2, cz);
      m.rotation.y = yaw;
      signs.add(m);
    };
    // slab over the sidewalk, its soffit, and the hall floor behind the platform
    box(a0, a1, lo, hi, slabBot, slabTop, C.soffit);
    const hallLo = side < 0 ? lo : phi, hallHi = side < 0 ? plo : hi;
    box(a0, a1, hallLo, hallHi, slabTop, floor, C.deck);
    const [pcx, pcz] = box(pa0, pa1, plo, phi, slabTop, floor, C.deck);
    this.platforms.push({ x: pcx, z: pcz, hw: (phi - plo) / 2, hd: (pa1 - pa0) / 2, rot: -yaw, y0: floor, y1: floor });
    const [hcx, hcz] = P((a0 + a1) / 2, (hallLo + hallHi) / 2);
    this.platforms.push({ x: hcx, z: hcz, hw: (hallHi - hallLo) / 2, hd: (a1 - a0) / 2, rot: -yaw, y0: floor, y1: floor });
    // the platform edge's tactile strip, and the eight safety gates [LM]
    const edge = side < 0 ? phi : plo;
    box(pa0 + 0.2, pa1 - 0.2, edge - (side < 0 ? 0.6 : 0), edge + (side < 0 ? 0 : 0.6), floor, floor + 0.012, C.tactile, 4);
    for (let k = 0; k < 8; k++) {
      const a = pa0 + ((pa1 - pa0) * (k + 0.5)) / 8;
      box(a - 1.3, a - 1.2, edge - 0.05, edge + 0.05, floor, floor + 1.1, C.teal);
      box(a + 1.2, a + 1.3, edge - 0.05, edge + 0.05, floor, floor + 1.1, C.teal);
    }
    // roof and white fascia
    box(a0, a1, lo, hi, roofY, roofY + 0.35, C.roof);
    box(a0, a1, lo - 0.2, lo, roofY - 0.5, roofY + 0.45, C.white);
    box(a0, a1, hi, hi + 0.2, roofY - 0.5, roofY + 0.45, C.white);
    // The 5th Avenue face: blue-green spandrels over and under a long
    // opening that a white concrete truss spans.
    const face = side < 0 ? hi : lo, out = side < 0 ? 1 : -1;
    const fB0 = Math.min(face, face + out * 0.25), fB1 = Math.max(face, face + out * 0.25);
    glass(a0, a1, fB0, fB1, slabBot, floor - 0.2);
    glass(a0, a1, fB0, fB1, floor + 3.9, roofY);
    box(a0, a1, fB0 - 0.1, fB1 + 0.1, floor - 0.2, floor + 0.25, C.white);
    box(a0, a1, fB0 - 0.1, fB1 + 0.1, floor + 3.5, floor + 3.9, C.white);
    const panels = Math.max(4, Math.round((a1 - a0) / 4.2));
    for (let k = 0; k <= panels; k++) {
      const a = a0 + ((a1 - a0) * k) / panels;
      const [x0, z0] = P(a, (fB0 + fB1) / 2);
      shaft(b, x0, z0, yaw, floor + 0.25, floor + 3.5, 0.18, 0.18, 0.18, 0.18, C.white);
      if (k < panels) {
        const an = a0 + ((a1 - a0) * (k + 1)) / panels;
        const [x1, z1] = P(an, (fB0 + fB1) / 2);
        const up = k % 2 === 0;
        b.tube([x0, up ? floor + 0.3 : floor + 3.45, z0], [x1, up ? floor + 3.45 : floor + 0.3, z1], 0.15, 4, C.white);
      }
    }
    // The back wall to the mall, and the south end: glass over white.
    const back = side < 0 ? lo : hi;
    glass(a0, a1, Math.min(back, back - out * 0.25), Math.max(back, back - out * 0.25), slabTop, roofY);
    glass(a0 - 0.25, a0, lo, hi, slabBot, roofY);
    // The north end: two portals where the beams come in, the rest walled.
    {
      const tb0 = Math.min(bw, be) - 1.9, tb1 = Math.max(bw, be) + 1.9;
      glass(a1, a1 + 0.3, lo, hi, floor + 3.9, roofY);
      if (tb0 > lo) glass(a1, a1 + 0.3, lo, tb0, slabTop, floor + 3.9);
      if (tb1 < hi) glass(a1, a1 + 0.3, tb1, hi, slabTop, floor + 3.9);
      box(a1 - 0.05, a1 + 0.35, tb0 - 0.3, tb1 + 0.3, floor + 3.6, floor + 3.95, C.white);
    }
    // white columns under the slab at the kerb side, every ~12 m, stepped
    // back toward the mall until they stand clear of every lane
    const kerb = side < 0 ? hi - 0.9 : lo + 0.9, back2 = side < 0 ? -1 : 1;
    this.wlColumnsMoved = 0;
    for (let a = a0 + 2; a <= a1 - 1; a += 12) {
      let bb = kerb;
      for (const k of [0, 1, 2, 3, 4, 5]) {
        const [tx, tz] = P(a, kerb + back2 * k * 0.8);
        if (this.laneClear(tx, tz, 0.5)) { bb = kerb + back2 * k * 0.8; if (k) this.wlColumnsMoved++; break; }
      }
      const [cx, cz] = P(a, bb);
      const g = T(cx, cz) - 0.3;
      shaft(b, cx, cz, yaw, g, slabBot, 0.4, 0.4, 0.4, 0.4, C.white);
      this.solids.push({ x: cx, z: cz, r: 0.5, y0: g, y1: slabBot, mono: true });
    }
    // The street door: a glazed stair-and-escalator box under the south end,
    // on the mall side, with the name over it.
    {
      const tb = side < 0 ? lo + 3 : hi - 3;
      const [cx, cz] = P(a0 + 3.4, tb);
      const g = T(cx, cz) - 0.3;
      ybox(b, cx, g, cz, yaw, 2.8, (slabBot - g) / 2, 3.0, C.glassDk);
      // white frame posts
      for (const [da, db] of [[-3, -2.8], [3, -2.8], [-3, 2.8], [3, 2.8]]) {
        const [px, pz] = P(a0 + 3.4 + da, tb + db);
        shaft(b, px, pz, yaw, g, slabBot, 0.14, 0.14, 0.14, 0.14, C.white);
      }
      this.solids.push({ x: cx, z: cz, hw: 2.8, hd: 3.0, rot: -yaw, y0: g, y1: slabBot, mono: true });
      // the door faces south, out of the hall's end
      const [dx, dz] = P(a0 + 0.35, tb);
      const s = h.sign('MONORAIL', 3.2, 0.7, '#0b6b70', '#ffffff', { px: 70 });
      s.position.set(dx - fx * 0.05, g + 3.1, dz - fz * 0.05);
      s.rotation.y = yaw + Math.PI;
      signs.add(s);
      const s2 = h.sign('Seattle Center Monorail\nto Seattle Center', 3.0, 0.9, '#10181c', '#e8f2f2', { px: 60, weight: 600 });
      s2.position.set(dx - fx * 0.05, g + 2.2, dz - fz * 0.05);
      s2.rotation.y = yaw + Math.PI;
      signs.add(s2);
      const [ex, ez] = P(a0 - 2.2, tb);
      this.wlDoor = { x: ex, z: ez, y: T(ex, ez), yaw: yaw + Math.PI };
    }
    // the name on the 5th Avenue face
    {
      const s = h.sign('WESTLAKE CENTER  ·  MONORAIL', 14, 0.9, null, '#ffffff', { px: 60 });
      const [cx, cz] = P((a0 + a1) / 2, face + out * 0.3);
      s.position.set(cx, roofY - 0.9, cz);
      s.rotation.y = yaw + (out > 0 ? Math.PI / 2 : -Math.PI / 2);
      signs.add(s);
    }
    clear.push([...P((a0 + a1) / 2, (lo + hi) / 2), Math.hypot(a1 - a0, hi - lo) / 2]);
    this.wlYaw = yaw;
  }

  /** Where the gauntlet's signals stand: one per beam, for trains heading to
   *  Westlake, a train length before the narrows (est.). */
  signalSites() {
    return ['west', 'east'].map((k) => {
      const tr = this.tracks[k];
      const s = this.signalS() - 3;
      const fr = frameAt(tr, s);
      const side = k === 'west' ? 1 : -1;   // outboard of the pair
      const p = add3(fr.p, fr.l, side * (MONO.wid / 2 + 0.45));
      return { track: k, x: p[0], y: p[1] + 2.6, z: p[2], yaw: fr.h };
    });
  }
  /** The stop point (nose s) at the gauntlet's signal for a train toward Westlake. */
  signalS() { return this.gauntlet + 14; }

  // --- the trains in the world -------------------------------------------------

  /** Both trains and the gauntlet's signal lamps; after buildStructure. */
  makeTrains(scene) {
    this.trains = { blue: new MonorailTrain(this, 'blue'), red: new MonorailTrain(this, 'red') };
    const { blue, red } = this.trains;
    blue.other = red; red.other = blue;
    // Blue at Seattle Center about to leave, Red at Westlake: they cross
    // mid-line, as the two-train service does.
    blue.place(blue.markSC - MONO.len / 2, -1); blue.state = 'dwell'; blue.timer = 12;
    red.place(red.markWL + MONO.len / 2, 1); red.state = 'dwell'; red.timer = 26;
    for (const t of [blue, red]) scene.add(t.group);
    // The signal lamps, red over green on each head (the heads are in the
    // structure): one mesh for all four, relit by rewriting its colours.
    {
      const b = new Builder(false);
      this.lampRanges = [];
      for (const l of this.lampSites || []) {
        const fx = Math.sin(l.yaw), fz = Math.cos(l.yaw);
        for (const dy of [0.26, -0.26]) {
          const v0 = b.pos.length / 3;
          // facing up the line, toward a train heading for Westlake
          b.spheroid(l.x + fx * 0.19, l.y + dy, l.z + fz * 0.19, 0.16, 8, 5, [1, 1, 1]);
          this.lampRanges.push({ track: l.track, red: dy > 0, v0, v1: b.pos.length / 3 });
        }
      }
      if (!b.empty) {
        this.lampMesh = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
        this.lampMesh.name = 'monorail:signals';
        scene.add(this.lampMesh);
      }
    }
    return this.trains;
  }

  /** Hooks into the game: toasts, money, damage, sound. */
  bind(o) { Object.assign(this, { game: o.game, hud: o.hud, audio: o.audio, player: o.player }); }

  say(t, ms) { if (this.hud) this.hud.showToast(t, ms); }

  /** Is the gauntlet held against a train on this beam heading for Westlake? */
  signalRed(key) {
    const t = Object.values(this.trains).find((q) => q.liv.track === key);
    return !!(t && t.other && t.other.inGauntlet());
  }

  update(dt) {
    if (!this.trains) return;
    for (const t of Object.values(this.trains)) {
      if (t.driver === 'player') continue;
      t.service(dt);
      t.pose();
    }
    // the signals are only worth a draw within sight of them
    if (this.lampMesh && this.player) {
      const p = this.player.position, l = this.lampSites[0];
      this.lampMesh.visible = Math.hypot(p.x - l.x, p.z - l.z) < 800;
    }
    if (this.lampMesh && this.lampMesh.visible) {
      const col = this.lampMesh.geometry.attributes.color;
      let changed = false;
      for (const r of this.lampRanges) {
        const red = this.signalRed(r.track), lit = r.red ? red : !red;
        if (r.lit === lit) continue;
        r.lit = lit;
        const c = r.red ? (lit ? [1, 0.16, 0.08] : [0.16, 0.03, 0.02]) : (lit ? [0.1, 1, 0.34] : [0.02, 0.12, 0.05]);
        for (let v = r.v0; v < r.v1; v++) col.setXYZ(v, c[0], c[1], c[2]);
        changed = true;
      }
      if (changed) col.needsUpdate = true;
    }
    // the operator's readout, while you drive one
    const pv = this.player && this.player.vehicle;
    if (pv && pv.spec && pv.spec.monorail && this.hud) {
      this._hudT = (this._hudT || 0) - dt;
      if (this._hudT <= 0) {
        this._hudT = 0.25;
        const toSC = pv.dir > 0;
        const left = toSC ? pv.markSC - pv.sA : pv.sB - pv.markWL;
        const lim = Math.round(pv.limitAt(pv.lead) * 3.6 / 1.609);
        const sig = !toSC && pv.sB > this.gauntlet ? (this.signalRed(pv.liv.track) ? ' · SIGNAL RED' : ' · signal clear') : '';
        const where = toSC ? 'Seattle Center' : 'Westlake Center';
        this.hud.setObjective(pv.at() ? `${pv.liv.name} at ${pv.at() === 'wl' ? 'Westlake Center' : 'Seattle Center'} — POWER to depart`
          : `${where} ${Math.max(0, left).toFixed(left < 20 ? 1 : 0)} m · curve limit ${lim} mph${sig}`);
      }
    }
  }

  /**
   * A train you can step into from here, or null: stopped at a platform with
   * you beside its doors on the platform, or -- at Westlake -- at the street
   * door under the terminal (the mall's escalators, in life).
   */
  boardable(x, y, z) {
    if (!this.trains) return null;
    for (const t of Object.values(this.trains)) {
      const st = t.at();
      if (!st || t.driver) continue;
      if (st === 'wl' && this.wlDoor && Math.hypot(x - this.wlDoor.x, z - this.wlDoor.z) < 4.5) return t;
      const floor = st === 'wl' ? this.wlFloor : this.scFloor;
      if (Math.abs(y - floor) > 1.6) continue;
      const q = t.track.nearest(x, z);
      if (q.s < t.sB - 0.5 || q.s > t.sA + 0.5) continue;
      if (q.d < MONO.wid / 2 + 2.2) return t;
    }
    return null;
  }
  /** Are you within reach of that station ('wl' or 'sc'), on foot or
   *  driving up to it -- anything but driving a train yourself? */
  waiting(st) {
    const p = this.player;
    if (!p || (p.vehicle && p.vehicle.spec.monorail)) return false;
    const q = st === 'wl' ? this.wlDoor : this.scStation, pos = p.position;
    return !!q && Math.hypot(pos.x - q.x, pos.z - q.z) < 350;
  }
  /** Is a train (other than `but`) at that station or running toward it? */
  servedSoon(st, but) {
    for (const t of Object.values(this.trains)) {
      if (t === but || t.driver) continue;
      if (t.at() === st) return true;
      if (t.state === 'run' && (st === 'sc' ? t.dir > 0 : t.dir < 0)) return true;
    }
    return false;
  }
  /** When a train pulls in, what to tell you if you are waiting nearby. */
  nextAt(st) {
    let best = null;
    for (const t of Object.values(this.trains)) {
      if (t.driver) continue;
      if (t.at() === st && t.state === 'dwell') return 0;
      const toward = st === 'sc' ? t.dir > 0 : t.dir < 0;
      if (t.state !== 'run' || !toward) continue;
      const d = st === 'sc' ? t.markSC - t.sA : t.sB - t.markWL;
      const eta = d / Math.max(8, MONO.vService * 0.75);
      if (best === null || eta < best) best = eta;
    }
    return best;
  }

  /** Where you step off, or null if the doors stay shut. */
  exitSpot(t) {
    const st = t.at();
    if (!st) return null;
    if (st === 'wl') return { x: this.wlDoor.x, z: this.wlDoor.z, y: this.wlDoor.y };
    // Seattle Center: out onto whichever platform is beside the lead cab
    const tr = t.track, s = t.lead - t.dir * 5;
    const fr = frameAt(tr, s);
    for (const sd of [1, -1]) {
      const x = fr.p[0] + fr.l[0] * sd * (MONO.wid / 2 + 1.1), z = fr.p[2] + fr.l[2] * sd * (MONO.wid / 2 + 1.1);
      const py = this.city.platformAt(x, z);
      if (py !== null && Math.abs(py - this.scFloor) < 0.5) return { x, z, y: py };
    }
    return null;
  }

  // --- what happens -----------------------------------------------------------
  onBoard(t) {
    t.driver = 'player';
    t.mode = 'free';
    t.state = 'run';
    const st = t.at();
    // take the cab facing away from the buffers
    if (st === 'wl') t.dir = 1; else if (st === 'sc') t.dir = -1;
    t.arrival = { from: st, t: 0, rated: false };
    this._objBefore = this.hud ? this.hud.objective.textContent : '';
    this.say(`${t.liv.name} · "${t.liv.title}" · ${t.liv.number} — you're the operator. POWER to go, BRAKE to stop at the mark`, 4200);
  }
  onLeave(t) {
    t.resume();
    if (this.hud) this.hud.setObjective(this._objBefore || '');
  }
  onDoors(t, open) {
    if (this.audio && this.audio.chime && this.player && Math.hypot(this.player.position.x - t.x, this.player.position.z - t.z) < 90) this.audio.chime(open);
  }
  onArrive(t, st, err, secs) {
    const name = st === 'wl' ? 'Westlake Center' : 'Seattle Center';
    const mm = Math.floor(secs / 60), ss = Math.round(secs % 60).toString().padStart(2, '0');
    const e = Math.abs(err);
    let pay = 0, verdict;
    if (e < 0.5) { verdict = 'a perfect stop on the mark'; pay = 75; }
    else if (e < 1.5) { verdict = `${e.toFixed(1)} m ${err > 0 ? 'short of' : 'past'} the mark — a good stop`; pay = 40; }
    else { verdict = `${e.toFixed(1)} m ${err > 0 ? 'short of' : 'past'} the mark`; pay = 15; }
    if (this.game && pay) this.game.money += pay;
    this.say(`${name} in ${mm}:${ss} — ${verdict}${pay ? ` +$${pay}` : ''}. Doors open`, 4200);
    this.onDoors(t, true);
  }
  onBuffer(t, speed) {
    this.say(`Hit the buffer stop at ${Math.round(speed * 3.6)} km/h`);
    if (this.game) { this.game.onCrash(speed * 1.2, false); if (speed > 3) this.game.damagePlayer((speed - 3) * 7, 'crash'); }
  }
  onSideswipe(t, speed) {
    this.say('Sideswipe in the gauntlet! Only one train may be between Olive Way and Westlake — as in 2005', 4500);
    if (this.game) { this.game.onCrash(8 + speed * 2, false); this.game.damagePlayer(10 + speed * 3, 'crash'); }
  }
  onScrub(t, amount) {
    if (this.game) this.game.damagePlayer(amount * 6, 'crash');
  }
}

// ---------------------------------------------------------------------------
// The trains. Four sections, each 9.3 m, on one skinned mesh per material with
// a bone per section: the articulated body bends through the curves at three
// draws a train. Built straight, +z toward Seattle Center, y = 0 on the beam.

// Liveries as photographed [IMG, see the report in apps/auto/CLAUDE.md]: the
// Red train cream over a red belt stripe and roofline with a red chevron on
// the nose and a bare ribbed aluminium skirt; the Blue train cream with a
// light-blue band over a pale-blue ribbed skirt.
export const LIVERIES = {
  blue: { name: 'Blue train', title: 'Spirit of Seattle', number: 6201, track: 'west',
    band: [0.16, 0.44, 0.78], roofline: [0.16, 0.44, 0.78], skirt: [0.60, 0.74, 0.86], vinyl: [0.13, 0.26, 0.62] },
  red: { name: 'Red train', title: 'Spirit of Century 21', number: 6202, track: 'east',
    band: [0.74, 0.10, 0.10], roofline: [0.74, 0.10, 0.10], skirt: [0.72, 0.73, 0.75], vinyl: [0.62, 0.10, 0.10] },
};

// The body's half-section, bottom to top, [y, half-width], and what colours
// each band between two points: rib/groove on the skirt, the livery belt,
// the window band, the roofline, the skylight glass, the roof.
const HALF = MONO.wid / 2;
const SKIRT_IN = 0.74;         // inside face of the skirt, round the beam's 0.455 and its guide tyres
const PROF = (() => {
  const p = [];
  // horizontal corrugations from the skirt's hem to the belt [IMG]
  for (let y = -1.05, k = 0; y < 1.2 - 1e-6; y += 0.075, k++) {
    const w = y < 0.35 ? 1.47 + (y + 1.05) * 0.05 : 1.54 + (y - 0.35) * 0.024;
    p.push([y, w + (k % 2 ? 0 : 0.012), k % 2 ? 'groove' : 'rib']);
  }
  p.push([1.2, HALF, 'belt'], [1.42, HALF, 'cream'], [1.55, HALF - 0.005, 'win'],
    [2.55, HALF - 0.06, 'cream'], [2.72, HALF - 0.1, 'roofline'], [2.88, HALF - 0.2, 'sky'],
    [3.05, 1.12, 'roof'], [3.17, 0.62, 'roof'], [3.22, 0.0, 'end']);
  return p;
})();

function buildTrainGeometry(liv) {
  // Two draws a train: the body (paint, skirt linings and the interior, one
  // vertex-coloured material) and the trim (glazing, lamps, poles). A third
  // for the matte parts measured as +2 draws a train for no visible change.
  const body = new Builder(false), trim = new Builder(false), matte = body;
  const L = MONO.len, S = MONO.secLen, NOSE = 3.3, GAP = 0.13;
  const cream = [0.90, 0.87, 0.78], white = [0.93, 0.93, 0.9];
  const colOf = (tag, front) => tag === 'rib' ? liv.skirt : tag === 'groove' ? liv.skirt.map((c) => c * 0.72)
    : tag === 'belt' ? liv.band : tag === 'roofline' ? liv.roofline : tag === 'roof' ? white
    : front && tag === 'cream' ? cream : cream;
  const ranges = [];
  const mark = () => [body.pos.length / 3, trim.pos.length / 3];

  // One side (sd = +1 left, -1 right) of a straight stretch z0..z1: the
  // profile extruded, the window band glazed between pillars, with doors.
  const side = (sd, z0, z1, doors) => {
    for (let i = 0; i < PROF.length - 1; i++) {
      const [ya, wa, tag] = PROF[i], [yb, wb] = PROF[i + 1];
      const n = [sd * (yb - ya), -(wb - wa), 0], nl = Math.hypot(n[0], n[1]) || 1;
      const nn = [n[0] / nl, n[1] / nl, 0];
      const A = (z, y, w) => [sd * w, y, z];
      if (tag === 'win' || tag === 'sky') {
        // panes and pillars; the skylight strip is one long pane per section
        const glass = tag === 'sky' ? [[z0 + 0.2, z1 - 0.2]] : panes(z0, z1, doors);
        let zc = z0;
        for (const [g0, g1] of glass) {
          if (g0 > zc) body.quad(A(zc, ya, wa), A(g0, ya, wa), A(g0, yb, wb), A(zc, yb, wb), nn, uv, cream);
          trim.quad(A(g0, ya, wa - 0.02), A(g1, ya, wa - 0.02), A(g1, yb, wb - 0.02), A(g0, yb, wb - 0.02), nn, uv, GLASS_C);
          zc = g1;
        }
        if (zc < z1) body.quad(A(zc, ya, wa), A(z1, ya, wa), A(z1, yb, wb), A(zc, yb, wb), nn, uv, cream);
        continue;
      }
      body.quad(A(z0, ya, wa), A(z1, ya, wa), A(z1, yb, wb), A(z0, yb, wb), nn, uv, colOf(tag));
    }
    // the skirt's inside face and hem, round the beam
    matte.quad([sd * SKIRT_IN, -1.05, z0], [sd * SKIRT_IN, -1.05, z1], [sd * SKIRT_IN, 0.36, z1], [sd * SKIRT_IN, 0.36, z0], [-sd, 0, 0], uv, [0.12, 0.12, 0.13]);
    matte.quad([sd * SKIRT_IN, -1.05, z0], [sd * 1.47, -1.05, z0], [sd * 1.47, -1.05, z1], [sd * SKIRT_IN, -1.05, z1], [0, -1, 0], uv, [0.2, 0.2, 0.21]);
    // doors: a dark seam each side of each leaf, and the glazing runs lower
    for (const dz of doors) {
      for (const e of [dz - 0.62, dz + 0.62, dz]) {
        body.quad([sd * (HALF + 0.004), 0.62, e - 0.018], [sd * (HALF + 0.004), 0.62, e + 0.018], [sd * (HALF + 0.004), 2.52, e + 0.018], [sd * (HALF + 0.004), 2.52, e - 0.018], [sd, 0, 0], uv, [0.25, 0.25, 0.26]);
      }
      trim.quad([sd * (HALF - 0.01), 0.95, dz - 0.52], [sd * (HALF - 0.01), 0.95, dz + 0.52], [sd * (HALF - 0.01), 1.55, dz + 0.52], [sd * (HALF - 0.01), 1.55, dz - 0.52], [sd, 0, 0], uv, GLASS_C);
    }
    // inside: the liner behind the pillars (so the far wall is not see-through),
    // cream, and the window reveals
    const lin = HALF - 0.1;
    let zc = z0;
    for (const [g0, g1] of panes(z0, z1, doors)) {
      if (g0 > zc) matte.quad([sd * lin, 1.55, zc], [sd * lin, 1.55, g0], [sd * lin, 2.55, g0], [sd * lin, 2.55, zc], [-sd, 0, 0], uv, [0.82, 0.8, 0.74]);
      zc = g1;
    }
    if (zc < z1) matte.quad([sd * lin, 1.55, zc], [sd * lin, 1.55, z1], [sd * lin, 2.55, z1], [sd * lin, 2.55, zc], [-sd, 0, 0], uv, [0.82, 0.8, 0.74]);
    matte.quad([sd * lin, MONO.floor, z0], [sd * lin, MONO.floor, z1], [sd * lin, 1.55, z1], [sd * lin, 1.55, z0], [-sd, 0, 0], uv, [0.74, 0.72, 0.66]);
    matte.quad([sd * lin, 2.55, z0], [sd * lin, 2.55, z1], [sd * (lin - 0.25), 2.95, z1], [sd * (lin - 0.25), 2.95, z0], [-sd, -0.6, 0], uv, [0.84, 0.83, 0.78]);
  };

  // Interior of a stretch: floor, ceiling, back-to-back benches down the
  // middle over the wheel housings [IMG], grab poles.
  const inside = (z0, z1) => {
    const lin = HALF - 0.1;
    matte.quad([-lin, MONO.floor, z0], [lin, MONO.floor, z0], [lin, MONO.floor, z1], [-lin, MONO.floor, z1], [0, 1, 0], uv, [0.42, 0.42, 0.43]);
    matte.quad([-(lin - 0.25), 2.95, z0], [lin - 0.25, 2.95, z0], [lin - 0.25, 2.95, z1], [-(lin - 0.25), 2.95, z1], [0, -1, 0], uv, [0.88, 0.87, 0.82]);
    for (let z = z0 + 1.3; z < z1 - 1.0; z += 2.9) {
      ybox(matte, 0, MONO.floor, z, 0, 0.62, 0.23, 0.55, [0.35, 0.35, 0.36]);
      ybox(matte, 0, MONO.floor + 0.46, z, 0, 0.6, 0.06, 0.52, liv.vinyl);
      ybox(matte, 0, MONO.floor + 0.52, z, 0, 0.08, 0.36, 0.52, liv.vinyl);
      trim.tube([0.75, MONO.floor, z + 1.4], [0.75, 2.95, z + 1.4], 0.025, 5, [0.8, 0.8, 0.82]);
      trim.tube([-0.75, MONO.floor, z + 1.4], [-0.75, 2.95, z + 1.4], 0.025, 5, [0.8, 0.8, 0.82]);
    }
  };

  // A nose: the body's section swept round a superellipse in plan, running
  // longer at the belt and raking back up the windscreen; the big curved
  // Plexiglas windscreen wraps the front [LM]. `dir` +1 = the +z end.
  const nose = (z0, dir) => {
    const LEN = (y) => y < 0.35 ? 2.55 + (y + 1.05) * 0.25 : y < 1.55 ? 2.9 + (y - 0.35) * 0.25
      : 3.2 - Math.pow((y - 1.55) / 1.67, 1.6) * 2.75;
    const N = 9, EXP = 2.6;
    // one sweep, bottom to top: below the slot's roof the section ends at the
    // skirt's inside face (the beam runs through there), above it at the
    // centreline
    const rows = PROF.map(([y, w]) => {
      const xEnd = y < 0.36 ? SKIRT_IN : 0, row = [];
      for (let j = 0; j <= N; j++) {
        const th = (j / N) * Math.PI / 2;
        const c = Math.pow(Math.cos(th), 2 / EXP), s = Math.pow(Math.sin(th), 2 / EXP);
        row.push([xEnd + (w - xEnd) * c, y, z0 + dir * LEN(y) * s]);
      }
      return row;
    });
    const lip = z0 + dir * LEN(0.35);
    for (const sd of [1, -1]) {
      const out = [sd, 0, dir];
      const up = rows.map((r) => r.map(([x, y, z]) => [sd * x, y, z]));
      // the slot's inside faces, forward to the nose's lower lip
      matte.quad([sd * SKIRT_IN, -1.05, z0], [sd * SKIRT_IN, -1.05, lip], [sd * SKIRT_IN, 0.36, lip], [sd * SKIRT_IN, 0.36, z0], [-sd, 0, 0], uv, [0.12, 0.12, 0.13]);
      // the windscreen band is glass round the front; the belt band widens
      // there into the nose chevron
      for (let i = 0; i < up.length - 1; i++) {
        const tag = PROF[i][2], y = PROF[i][0];
        const cut = tag === 'win' || tag === 'cream' && y > 2 || tag === 'roofline' || tag === 'sky' ? 3 : -1;
        const chev = (tag === 'rib' || tag === 'groove') && y > 0.8 ? 5 : -1;
        const r0 = up[i], r1 = up[i + 1];
        if (cut > 0) {
          body.patch([r0.slice(0, cut + 1), r1.slice(0, cut + 1)], tag === 'win' || tag === 'sky' ? cream : colOf(tag), out);
          trim.patch([r0.slice(cut).map(([x, yy, z]) => [x * 0.995, yy, z - dir * 0.01]), r1.slice(cut).map(([x, yy, z]) => [x * 0.995, yy, z - dir * 0.01])], GLASS_C, out);
        } else if (chev > 0) {
          body.patch([r0.slice(0, chev + 1), r1.slice(0, chev + 1)], colOf(tag), out);
          body.patch([r0.slice(chev), r1.slice(chev)], liv.band, out);
        } else body.patch([r0, r1], colOf(tag), out);
      }
      // the slot's roof
      matte.quad([sd * SKIRT_IN, 0.35, z0], [0, 0.35, z0], [0, 0.35, lip], [sd * SKIRT_IN, 0.35, lip], [0, -1, 0], uv, [0.15, 0.15, 0.16]);
      // headlamp and marker lamp each side, low on the nose
      const hz = z0 + dir * (LEN(1.0) - 0.35);
      trim.spheroid(sd * 0.95, 1.0, hz, 0.14, 8, 5, [1, 0.97, 0.86], 1);
      trim.spheroid(sd * 1.22, 0.62, z0 + dir * (LEN(0.62) - 0.75), 0.07, 6, 4, [0.85, 0.12, 0.08], 1);
    }
    // behind the windscreen: the cab's console and the operator's seat on
    // the left [LM][NYC], and the bulkhead to the cars
    const cz = z0 + dir * 1.7;
    ybox(matte, 0, MONO.floor, cz, 0, 1.25, 0.45, 0.38, [0.2, 0.21, 0.22]);
    ybox(matte, 0, MONO.floor + 0.9, cz + dir * 0.25, 0, 1.2, 0.05, 0.2, [0.1, 0.1, 0.1]);
    ybox(matte, 0.55, MONO.floor, z0 + dir * 0.5, 0, 0.3, 0.55, 0.3, liv.vinyl);
    matte.quad([-(HALF - 0.1), MONO.floor, z0], [HALF - 0.1, MONO.floor, z0], [HALF - 0.1, MONO.floor, cz + dir * 1.2], [-(HALF - 0.1), MONO.floor, cz + dir * 1.2], [0, 1, 0], uv, [0.3, 0.3, 0.31]);
  };

  // An end of a section at an articulation joint: a flat bulkhead face, and
  // the dark bellows that close the gap to the next section.
  const joint = (z, dir, bellows) => {
    const ring = PROF.filter(([y]) => y > -0.2);
    for (let i = 0; i < ring.length - 1; i++) {
      const [ya, wa] = ring[i], [yb, wb] = ring[i + 1];
      body.quad([-wa, ya, z], [wa, ya, z], [wb, yb, z], [-wb, yb, z], [0, 0, dir], uv, [0.8, 0.78, 0.7]);
    }
    if (bellows) {
      const b0 = z, b1 = z + dir * 2 * GAP;
      for (const sd of [1, -1]) matte.quad([sd * 1.4, 0, b0], [sd * 1.4, 0, b1], [sd * 1.4, 3.02, b1], [sd * 1.4, 3.02, b0], [sd, 0, 0], uv, [0.1, 0.1, 0.1]);
      matte.quad([-1.4, 3.02, b0], [1.4, 3.02, b0], [1.4, 3.02, b1], [-1.4, 3.02, b1], [0, 1, 0], uv, [0.1, 0.1, 0.1]);
    }
  };

  for (let k = 0; k < 4; k++) {
    const m0 = mark();
    const za = -L / 2 + k * S, zb = za + S;
    const z0 = k === 0 ? za + NOSE : za + GAP, z1 = k === 3 ? zb - NOSE : zb - GAP;
    // two doors a side a section: eight a side a train [LM][WP]
    const mid = (za + zb) / 2;
    const doors = k === 0 ? [mid + 0.4, mid + 3.0] : k === 3 ? [mid - 3.0, mid - 0.4] : [mid - 2.3, mid + 2.3];
    for (const sd of [1, -1]) side(sd, z0, z1, doors);
    inside(z0, z1);
    // roof: two of the six roof vents on each middle section, one on each end [LM]
    for (const vz of k === 0 || k === 3 ? [mid] : [mid - 2, mid + 2]) ybox(matte, 0, 3.2, vz, 0, 0.42, 0.09, 0.62, [0.62, 0.63, 0.64]);
    if (k === 0) nose(z0, -1); else joint(z0, -1, false);
    if (k === 3) nose(z1, 1); else joint(z1, 1, true);
    ranges.push([m0, mark()]);
  }

  const skinned = (b, which) => {
    const geo = b.build();
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let k = 0; k < 4; k++) {
      const [a, e] = ranges[k];
      for (let v = a[which]; v < e[which]; v++) { si[v * 4] = k; sw[v * 4] = 1; }
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    return geo;
  };
  return { body: skinned(body, 0), trim: skinned(trim, 1) };
}

/** Glazing and pillars along a stretch z0..z1: [[g0, g1], ...], doors kept as door. */
function panes(z0, z1, doors) {
  const out = [];
  const segs = [];
  let a = z0 + 0.25;
  for (const d of [...doors].sort((p, q) => p - q)) {
    segs.push([a, d - 0.72]);
    a = d + 0.72;
  }
  segs.push([a, z1 - 0.25]);
  for (const [s0, s1] of segs) {
    const len = s1 - s0;
    if (len < 0.6) continue;
    const n = Math.max(1, Math.round(len / 1.45));
    const w = len / n;
    for (let i = 0; i < n; i++) out.push([s0 + i * w + 0.09, s0 + (i + 1) * w - 0.09]);
  }
  for (const d of doors) out.push([d - 0.52, d + 0.52]);
  return out.sort((p, q) => p[0] - q[0]);
}

// ---------------------------------------------------------------------------
// A train: the posed model, its state along its beam, and the two ways it is
// driven -- by you from a cab, or in service between the stations.

const G_ACC = 9.81;
// Curve comfort for the service run (est.): unbalanced lateral acceleration a
// seated passenger shrugs off, over the bank the beam gives.
const A_LAT = 1.1;

export class MonorailTrain {
  constructor(sys, key) {
    this.sys = sys;
    this.key = key;
    this.liv = LIVERIES[key];
    this.track = sys.tracks[this.liv.track];
    this.other = null;
    this.typeName = 'monorail';
    // What the rest of the game reads off a vehicle (player.js, main.js,
    // hud.js, audio.js, activities.js): a spec with its flags, and the fields
    // below. `len` sizes the chase camera; the train's own length is MONO.len.
    this.spec = { monorail: true, hand: 'monorail', engine: 'traction', len: 14, wid: MONO.wid, roof: 3.2,
      topKph: MONO.vMax * 3.6, mass: 45 };
    this.x = 0; this.y = 0; this.z = 0; this.heading = 0;
    this.vLong = 0; this.vLat = 0; this.vy = 0; this.speed = 0;
    this.halfLen = 2.5; this.halfWid = MONO.wid / 2; this.radius = 3;
    this.health = 100; this.dead = false; this.exploded = false;
    this.mode = 'service'; this.wasParked = false;
    this.skid = 0; this.airborne = false; this.stunt = false; this.stuntLaunch = null;
    this.rampAlong = 0; this.latAcc = 0; this.accLong = 0; this.hitCd = 0;
    this._fwd = { x: 0, z: 1 };
    // along the beam: centre s, speed u in +s, and which cab leads (+1 = the
    // +z cab, toward Seattle Center)
    this.s = 0; this.u = 0; this.dir = 1;
    this.sway = 0; this.swayV = 0;
    this.driver = null;          // null: in service; 'player'
    // service: 'dwell' at a platform, 'run' to a stop point
    this.state = 'dwell'; this.timer = 10;
    this.arrival = null;         // the run a player is on: {from, t, rated}
    this.warned = 0;

    const geo = buildTrainGeometry(this.liv);
    const A = vehicleAssets();
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.28, roughness: 0.36, envMapIntensity: 1.2 });
    tagGlass(geo.trim);
    this.bones = [];
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Bone();
      b.position.set(0, 0, -MONO.len / 2 + (k + 0.5) * MONO.secLen);
      this.bones.push(b);
    }
    this.group = new THREE.Group();
    this.group.name = `monorail:${key}`;
    for (const b of this.bones) this.group.add(b);
    this.group.updateMatrixWorld(true);
    const skel = new THREE.Skeleton(this.bones);
    this.meshes = [[geo.body, this.bodyMat], [geo.trim, A.trimMat]].map(([g, m]) => {
      const mesh = new THREE.SkinnedMesh(g, m);
      mesh.bind(skel, new THREE.Matrix4());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), MONO.len / 2 + 4);
      this.group.add(mesh);
      return mesh;
    });
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
  }

  // The nose positions (s of each end) and which one leads.
  get sA() { return this.s + MONO.len / 2; }
  get sB() { return this.s - MONO.len / 2; }
  get lead() { return this.dir > 0 ? this.sA : this.sB; }
  get forward() { return this._fwd; }
  setDetailed() {}
  sync() {}
  damage() {}

  /** Where each end must stop: the marks at the two platforms. */
  get markWL() { return MONO.stopGap; }                       // sB at Westlake
  get markSC() { return this.track.len - MONO.stopGap; }      // sA at Seattle Center
  /** At a platform, stopped: 'wl', 'sc' or null. */
  at() {
    if (Math.abs(this.u) > 0.15) return null;
    if (this.sB < this.markWL + 6) return 'wl';
    if (this.sA > this.markSC - 6) return 'sc';
    return null;
  }
  /** Any part of the train in the gauntlet? */
  inGauntlet() { return this.sB < this.sys.gauntlet + 1; }

  place(s, dir) {
    this.s = s; this.dir = dir; this.u = 0;
    this.pose();
  }

  // --- posing ---------------------------------------------------------------
  pose() {
    const tr = this.track;
    const P = (s) => [tr.x(s), tr.y(s), tr.z(s)];
    for (let k = 0; k < 4; k++) {
      const s0 = this.s - MONO.len / 2 + k * MONO.secLen, s1 = s0 + MONO.secLen;
      const a = P(s0), b = P(s1), sm = (s0 + s1) / 2;
      this._z.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      // local +x is the train's left; bank lowers the inside of a curve, and
      // the sway is the body leaning out when the curve is taken too fast
      const roll = -tr.bank(sm) + this.sway;
      this._x.set(this._z.z, 0, -this._z.x).normalize();
      const c = Math.cos(roll), sn = Math.sin(roll);
      const up = new THREE.Vector3().crossVectors(this._z, this._x);
      this._x.multiplyScalar(c).addScaledVector(up, sn);
      this._y.crossVectors(this._z, this._x);
      this._m.makeBasis(this._x, this._y, this._z);
      const bone = this.bones[k];
      bone.quaternion.setFromRotationMatrix(this._m);
      bone.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    }
    this.group.updateMatrixWorld(true);
    const cx = tr.x(this.s), cy = tr.y(this.s), cz = tr.z(this.s);
    for (const m of this.meshes) m.boundingSphere.center.set(cx, cy + 1.5, cz);
    // the vehicle's point is the operator's seat in the leading cab
    const sl = this.lead - this.dir * 2.2;
    this.x = tr.x(sl); this.z = tr.z(sl); this.y = tr.y(sl);
    this.heading = tr.heading(sl) + (this.dir > 0 ? 0 : Math.PI);
    this._fwd.x = Math.sin(this.heading); this._fwd.z = Math.cos(this.heading);
    this.vLong = this.u * this.dir;
    this.speed = Math.abs(this.u);
  }

  // --- the physics both drivers share ----------------------------------------
  /**
   * One step with a tractive command in [-1, 1] along the lead direction
   * (negative = back up) and a brake demand in [0, 1]. Returns the events a
   * driver cares about: a buffer strike, a gauntlet sideswipe.
   */
  step(dt, power, brake) {
    const tr = this.track;
    const v = this.u * this.dir;                 // speed toward the lead cab
    let a = 0;
    // traction: full effort to about a third of top speed, then falling off
    // as an electric motor's does
    if (power > 0) a += MONO.acc * power * clamp(1.35 - Math.abs(v) / MONO.vMax, 0, 1) * (v < -0.2 ? 0 : 1);
    if (power < 0) a += 0.55 * power * (Math.abs(v) < 2.4 ? 1 : 0);   // yard moves backward
    // brakes: service up to 3.4 mph/s, the last of the handle is emergency [PCI]
    const bk = brake > 0.92 ? MONO.brakeEmerg : MONO.brake * brake;
    // rubber tyres on concrete roll with a little resistance, plus air
    const drag = 0.035 + 0.0009 * v * v;
    const slope = (tr.y(this.s + 2) - tr.y(this.s - 2)) / 4;   // rise per metre along +s
    let vn = v + (a - G_ACC * slope * this.dir) * dt;
    const stop = (bk + drag) * dt;
    if (Math.abs(vn) <= stop && power === 0) vn = 0;
    else vn -= Math.sign(vn) * stop;
    this.u = vn * this.dir;
    this.accLong = a;
    this.s += this.u * dt;
    const ev = {};
    // buffer stops
    const lo = 0.95 + MONO.len / 2, hi = tr.len - 0.95 - MONO.len / 2;
    if (this.s < lo || this.s > hi) {
      ev.buffer = Math.abs(this.u);
      this.s = clamp(this.s, lo, hi);
      this.u = 0;
    }
    // the gauntlet: two trains in it at once sideswipe (2005, above Olive Way)
    const o = this.other;
    if (o && this.inGauntlet() && o.inGauntlet() && (Math.abs(this.u) > 0.1 || Math.abs(o.u) > 0.1)
      && Math.abs(this.sB - o.sB) < MONO.len) {
      ev.sideswipe = Math.max(Math.abs(this.u), Math.abs(o.u));
      this.s -= Math.sign(this.u || 1) * 0.6;
      this.u = 0; o.u = 0;
    }
    // Curve: the lateral acceleration the bank does not take up sways the
    // body out. Too much and the guide tyres complain.
    const k = tr.curv(this.s), bank = Math.abs(tr.bank(this.s));
    const lat = this.u * this.u * Math.abs(k) - G_ACC * Math.tan(bank);
    this.latAcc = lat;
    const want = clamp(Math.max(0, lat) * 0.014, 0, 0.09) * -Math.sign(k) * 1;
    this.swayV += ((want - this.sway) * 40 - this.swayV * 9) * dt;
    this.sway += this.swayV * dt;
    ev.lat = lat;
    return ev;
  }

  // --- in service --------------------------------------------------------------
  /** Speed limit at s for the service run: curves at A_LAT over the bank. */
  limitAt(s) {
    const tr = this.track, k = Math.abs(tr.curv(s));
    if (k < 1e-4) return MONO.vService;
    return Math.min(MONO.vService, Math.sqrt((A_LAT + G_ACC * Math.tan(Math.abs(tr.bank(s)))) / k));
  }
  /** The speed that still brakes, at `b`, to every limit and the stop point ahead. */
  allowed(stopLead, b) {
    const dirn = this.dir, lead = this.lead;
    let v = Math.sqrt(Math.max(0, 2 * b * Math.max(0, (stopLead - lead) * dirn)));
    for (let d = 0; d <= 160; d += 8) {
      const sq = this.s + dirn * d;
      if (sq < 0 || sq > this.track.len) break;
      // the whole train must be under the limit through the curve
      v = Math.min(v, Math.sqrt(this.limitAt(sq) ** 2 + 2 * b * Math.max(0, d - MONO.len / 2)));
    }
    return Math.min(v, MONO.vService);
  }
  /** Stop point (lead nose s) for the run it is on, with the interlock. */
  target() {
    if (this.dir > 0) return this.markSC;
    // toward Westlake: hold at the signal unless the gauntlet is ours
    const o = this.other;
    const sig = this.sys.signalS();
    const blocked = o && (o.inGauntlet() || (o.dir < 0 && o.state !== 'dwell' && o.sB < sig && o.sB < this.sB));
    return blocked && this.sB > sig - 0.5 ? sig : this.markWL;
  }
  service(dt) {
    if (this.state === 'dwell') {
      this.u = 0;
      this.timer -= dt;
      // A TRAIN WAITS FOR YOU. Within reach of a station, the train at
      // its platform holds there; and if none is there or on its way, the one
      // at the far end leaves now instead of dwelling out its time (you should
      // not stand a hundred seconds on an empty platform).
      const here = this.at(), sys = this.sys;
      if (here && sys.waiting(here) && this.timer < 2) this.timer = 2;
      const far = here === 'wl' ? 'sc' : 'wl';
      if (here && sys.waiting(far) && !sys.servedSoon(far, this)) this.timer = Math.min(this.timer, 1);
      // leaving Westlake through the gauntlet needs it empty too
      const o = this.other;
      if (this.timer <= 0 && !(this.at() === 'wl' && o && o.inGauntlet())) {
        this.state = 'run';
        this.dir = this.at() === 'sc' || this.sA > this.track.len / 2 + MONO.len / 2 ? -1 : 1;
      }
      this.step(dt, 0, 1);
      return;
    }
    const tgt = this.target();
    const vAllow = this.allowed(tgt, 1.05);
    const v = this.u * this.dir;
    let power = 0, brake = 0;
    if (v < vAllow - 0.8) power = 1;
    else if (v > vAllow + 0.3) brake = clamp((v - vAllow) / 1.5, 0.2, 0.9);
    else if (v > vAllow) brake = 0.25;
    // crawl the last metres
    const left = (tgt - this.lead) * this.dir;
    if (left < 0.25) { power = 0; brake = 1; }
    else if (left < 3 && v < 0.6) power = 0.35;
    this.step(dt, power, brake);
    if (Math.abs(this.u) < 0.05 && left < 0.6) {
      this.u = 0;
      if (this.at()) { this.state = 'dwell'; this.timer = 28; this.sys.onDoors(this, true); }
    }
  }

  /** Put it back in service from wherever it stands (the player left it). */
  resume() {
    this.driver = null;
    this.mode = 'service';
    this.state = this.at() ? 'dwell' : 'run';
    this.timer = 20;
    // run on to whichever station its lead faces
  }

  // --- driven -----------------------------------------------------------------
  /** player.js calls this as it calls any vehicle's update. */
  update(dt, input) {
    const sys = this.sys;
    this.driver = 'player';
    const thr = clamp(input.throttle || 0, 0, 1), brk = clamp(input.brake || 0, 0, 1);
    // THE OTHER CAB. There are no switches and no turning: at a terminal the
    // operator walks to the far cab [LM][WP]. Stopped at a platform with the
    // lead facing the buffer, asking for power changes ends.
    const st = this.at();
    if (st && thr > 0.3 && Math.abs(this.u) < 0.05
      && ((st === 'wl' && this.dir < 0) || (st === 'sc' && this.dir > 0))) {
      this.dir = -this.dir;
      sys.say(`You walk through to the ${this.dir > 0 ? 'north' : 'south'} cab — ${this.dir > 0 ? 'Seattle Center' : 'Westlake Center'} ahead`);
      this.arrival = { from: st, t: 0, rated: false };
    }
    // BRAKE held at a stand is a yard move backward, as a car's reverse is
    let power = thr;
    const v = this.u * this.dir;
    if (brk > 0.5 && thr < 0.1 && v <= 0.05) {
      this._revT = (this._revT || 0) + dt;
      if (this._revT > 0.6) power = -1;
    } else this._revT = 0;
    const ev = this.step(dt, power, power < 0 ? 0 : brk);
    if (this.arrival) this.arrival.t += dt;
    if (ev.buffer > 1.2) sys.onBuffer(this, ev.buffer);
    if (ev.sideswipe) sys.onSideswipe(this, ev.sideswipe);
    // Taken too fast, a curve throws the passengers about; far too fast and
    // the guide tyres give. A straddle beam cannot drop a train, so that is
    // the whole of the penalty.
    if (ev.lat > 2.2) {
      if (this.warned <= 0) { sys.say('Too fast for the curve — ease off'); this.warned = 5; }
      if (ev.lat > 4.0) { sys.onScrub(this, (ev.lat - 4) * dt); this.u *= Math.exp(-0.35 * dt); }
      this.skid = clamp((ev.lat - 2.2) / 3, 0, 1);
    } else this.skid = 0;
    this.warned -= dt;
    // rest at a platform: the doors open, and the stop is judged
    if (Math.abs(this.u) < 0.02 && this.arrival && !this.arrival.rated) {
      const at = this.at();
      if (at && at !== this.arrival.from) {
        this.arrival.rated = true;
        const err = at === 'wl' ? this.sB - this.markWL : this.markSC - this.sA;
        sys.onArrive(this, at, err, this.arrival.t);
      }
    }
    this.pose();
  }
}
