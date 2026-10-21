// ERBSVILLE KARTWAY: the outdoor go-kart track at 4057 Erbsville Rd, Waterloo,
// in the bush off Erbsville Road from 1959 until it closed in 2021.
//
// THE CIRCUIT is OSM's (data/kart.json, tools/kw/build_kart.py): ~970 m of
// twisty kart track that crosses over itself on a bridge -- a figure eight.
// Rounded (two Chaikin passes), resampled every metre, it is a ribbon of
// asphalt 6.6 m wide with white edge lines, red and white kerbs where it
// turns hard, and walls of stacked tyres on the outside, pulled in to a
// single wall where two parts of the track run close. The bridge is a deck
// 3.6 m up on two earth ramps between retaining walls; the lower track runs
// under its span. `deckAt` answers the surface to groundAt (city.movers,
// the nearest-layer rule), so a kart on the bridge rides the deck and one
// under it the ground.
//
// THE PADDOCK is beside the start/finish straight, between the track and the
// clubhouse (OSM's small building by the parking): a paved apron with the
// rental karts lined up, a pit wall with a fence on it, a grandstand of
// aluminium bleachers, the clubhouse with its ERBSVILLE KARTWAY sign, and a
// gantry with the start lights over the line.
//
// THE RACE (KartRace): walk into the paddock, ENTER at the counter, and race
// five of the regulars over 3 laps from a standing start on a 2 x 3 grid.
// Five red lights come on a second apart and go out together. The AI drive a
// racing line (the centreline relaxed toward minimum curvature) at a speed
// profile from its curvature, each with its own pace, line and temper, and
// make mistakes: run wide, lift. Leave the track and you are on the grass;
// cut across the infield and it is a time penalty and the lap does not count.
// Positions by laps and distance; the purse by finishing place; the best
// clean lap is kept in localStorage `autokw-kart-best`.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { boxAt } from './kw.js';
import { collideWithBuildings } from './traffic.js';

const DS = 1;               // m between centreline samples
export const HW = 3.3;      // track half width
const KERB = 0.9;           // kerb width outside the edge
const LIFT = 0.08;          // the asphalt over the ground (paved to the grass rule: > 0.05)
const DECK = 3.6;           // the bridge deck's height over the ground
const SPAN = 7;             // m of flat deck either side of the crossing
const RAMP = 40;            // m of ramp from the deck down to the ground
const LAPS = 3;
const PURSE = [250, 150, 100, 60, 40, 25];
const BEST_KEY = 'autokw-kart-best';
// the start line, on the straight past the clubhouse; the clubhouse itself (OSM's footprint)
const START = [-9960, -3054];
const CLUB = [-9960, -3031];

const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
const ckey = (x, z) => `${Math.round(x / 1200)},${Math.round(z / 1200)}`;
const U0 = [0, 0, 1, 0, 1, 1, 0, 1];
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
function hash(i) { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

const ASPHALT = lin([0.33, 0.33, 0.34]), RUBBER = lin([0.2, 0.2, 0.21]);
const LINE_W = lin([0.86, 0.86, 0.84]), KERB_R = lin([0.78, 0.12, 0.10]), KERB_W = lin([0.90, 0.90, 0.88]);
const TYRE_C = lin([0.10, 0.10, 0.11]), TYRE_HOLE = lin([0.03, 0.03, 0.035]);
const TYRE_PAINT = [lin([0.86, 0.86, 0.84]), lin([0.80, 0.14, 0.12])];
const CONCRETE = lin([0.68, 0.67, 0.64]), STEEL = lin([0.55, 0.57, 0.60]), DARK = lin([0.12, 0.12, 0.13]);
const APRON = lin([0.33, 0.33, 0.33]);

/** Erbsville Kartway: the circuit's geometry, its queries and its scenery. */
export class Kartway {
  constructor(data, city) {
    this.d = data;
    this.city = city;
    this.ok = !!(data && data.line && data.line.length > 10);
    if (!this.ok) return;
    // --- the centreline: rounded, resampled, closed --------------------------------
    let p = data.line;
    for (let it = 0; it < 2; it++) {
      const q = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      p = q;
    }
    const cum = [0];
    for (let i = 1; i <= p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i % p.length][0] - p[i - 1][0], p[i % p.length][1] - p[i - 1][1]));
    const L = cum[p.length], N = Math.round(L / DS), ds = L / N;
    this.L = L; this.N = N; this.ds = ds;
    const X = new Float64Array(N), Z = new Float64Array(N);
    for (let i = 0, k = 0; i < N; i++) {
      const s = i * ds;
      while (cum[k + 1] < s) k++;
      const t = (s - cum[k]) / (cum[k + 1] - cum[k]), a = p[k], b = p[(k + 1) % p.length];
      X[i] = a[0] + (b[0] - a[0]) * t; Z[i] = a[1] + (b[1] - a[1]) * t;
    }
    this.X = X; this.Z = Z;
    const TX = new Float64Array(N), TZ = new Float64Array(N), H = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.w(i - 1), b = this.w(i + 1);
      const dx = X[b] - X[a], dz = Z[b] - Z[a], l = Math.hypot(dx, dz) || 1;
      TX[i] = dx / l; TZ[i] = dz / l; H[i] = Math.atan2(TX[i], TZ[i]);
    }
    this.TX = TX; this.TZ = TZ;
    // curvature (+ = turning left, the heading sense), smoothed over 7 m
    const K = new Float64Array(N);
    for (let i = 0; i < N; i++) K[i] = wrapA(H[this.w(i + 3)] - H[this.w(i - 3)]) / (6 * ds);
    this.K = K;

    // --- the bridge: where the loop crosses itself ---------------------------------
    // two segments that intersect, far apart along the loop; the one running
    // along OSM's bridge way is the deck
    const bi = data.bridge, bp = data.line[bi], bq = data.line[(bi + 1) % data.line.length];
    const bdx = bq[0] - bp[0], bdz = bq[1] - bp[1], bl = Math.hypot(bdx, bdz);
    let cross = null;
    for (let i = 0; i < N && !cross; i++) {
      const i2 = this.w(i + 1);
      for (let j = i + 30; j < N - 30 + i && j < N; j++) {
        const j2 = this.w(j + 1);
        const hit = segX(X[i], Z[i], X[i2], Z[i2], X[j], Z[j], X[j2], Z[j2]);
        if (hit) { cross = [i, j]; break; }
      }
    }
    this.ib = -1; this.il = -1;
    if (cross) {
      const [i, j] = cross;
      const di = Math.abs(TX[i] * bdx / bl + TZ[i] * bdz / bl), dj = Math.abs(TX[j] * bdx / bl + TZ[j] * bdz / bl);
      this.ib = di > dj ? i : j; this.il = di > dj ? j : i;
    }
    const E = new Float64Array(N);
    if (this.ib >= 0) {
      for (let i = 0; i < N; i++) {
        const d = this.gap(i, this.ib) * ds;
        E[i] = d <= SPAN ? DECK : DECK * (1 - smooth((d - SPAN) / RAMP));
      }
    }
    this.E = E;
    // ground under the centreline, once (a kart's surface is T + LIFT + E)
    this.Tc = new Float64Array(N);
    for (let i = 0; i < N; i++) this.Tc[i] = G.terrainHeight(X[i], Z[i]);

    // --- the start, the grid, the paddock ---------------------------------------------
    this.iStart = this.nearestIndex(START[0], START[1]);
    const s0 = this.iStart;
    this.paddock = this.frame(s0, -22, 8, -(HW + 1.0), -14.5);      // along [-22, 8], right of the track
    this.club = null;

    // --- the racing line: the centreline relaxed toward least curvature -----------
    const O = new Float64Array(N), lim = HW - 0.85;
    const NX = (i) => TZ[i], NZ = (i) => -TX[i];   // the LEFT normal
    for (let it = 0; it < 260; it++) {
      for (let i = 0; i < N; i++) {
        const a = this.w(i - 5), b = this.w(i + 5);
        const mx = (X[a] + NX(a) * O[a] + X[b] + NX(b) * O[b]) / 2, mz = (Z[a] + NZ(a) * O[a] + Z[b] + NZ(b) * O[b]) / 2;
        const o = (mx - X[i]) * NX(i) + (mz - Z[i]) * NZ(i);
        O[i] = Math.max(-lim, Math.min(lim, O[i] + (o - O[i]) * 0.6));
      }
    }
    this.O = O;
    // its curvature and the speed it allows (AI: aiPace sets the grip they use)
    this.LK = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.w(i - 4), b = this.w(i + 4);
      const ax = X[a] + NX(a) * O[a], az = Z[a] + NZ(a) * O[a], cx = X[i] + NX(i) * O[i], cz = Z[i] + NZ(i) * O[i];
      const bx = X[b] + NX(b) * O[b], bz = Z[b] + NZ(b) * O[b];
      this.LK[i] = wrapA(Math.atan2(bx - cx, bz - cz) - Math.atan2(cx - ax, cz - az)) / Math.max(1, Math.hypot(bx - ax, bz - az) / 2);
    }
    this.V = this.speedProfile(17.4, 21, 9, 3.6);

    // --- lookups ----------------------------------------------------------------
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < N; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); z0 = Math.min(z0, Z[i]); z1 = Math.max(z1, Z[i]); }
    for (const q of data.outline || []) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    this.bb = [x0 - 30, z0 - 30, x1 + 30, z1 + 30];
    this.grid = new Map();
    for (let i = 0; i < N; i++) {
      const k = `${Math.floor(X[i] / 8)},${Math.floor(Z[i] / 8)}`;
      let l = this.grid.get(k); if (!l) this.grid.set(k, (l = [])); l.push(i);
    }
    // trees: nothing grows on the property or within 10 m of the track (2 m cells)
    const cw = 2, gw = Math.ceil((this.bb[2] - this.bb[0]) / cw), gh = Math.ceil((this.bb[3] - this.bb[1]) / cw);
    const clear = new Uint8Array(gw * gh);
    const R = HW + 10, rc = Math.ceil(R / cw);
    for (let i = 0; i < N; i++) {
      const ci = Math.floor((X[i] - this.bb[0]) / cw), cj = Math.floor((Z[i] - this.bb[1]) / cw);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        if ((di * di + dj * dj) * cw * cw > R * R) continue;
        const a = ci + di, b = cj + dj;
        if (a >= 0 && b >= 0 && a < gw && b < gh) clear[b * gw + a] = 1;
      }
    }
    const ol = data.outline || [];
    for (let b = 0; b < gh; b++) for (let a = 0; a < gw; a++) {
      const x = this.bb[0] + (a + 0.5) * cw, z = this.bb[1] + (b + 0.5) * cw;
      if (!clear[b * gw + a] && ol.length > 2 && inPoly(ol, x, z)) clear[b * gw + a] = 1;
    }
    this.clear = { cw, gw, gh, m: clear };
    // groundAt asks every frame: the nearest-layer rule (citygen groundAt, `movers`)
    if (city) city.movers = [...(city.movers || []), this];
    this.prep(city);
  }

  /** Index modulo the loop. */
  w(i) { const N = this.N; return ((i % N) + N) % N; }
  /** Samples between two indices, the short way round. */
  gap(i, j) { const d = Math.abs(i - j) % this.N; return Math.min(d, this.N - d); }

  /** Closest centreline sample to a point (no layer test). */
  nearestIndex(x, z) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < this.N; i++) { const d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    return bi;
  }

  /**
   * A rectangle in the frame of sample `i`: along the track [a0, a1], across
   * [o0, o1] (left +). Returns its centre, axes and half-sizes.
   */
  frame(i, a0, a1, o0, o1) {
    const tx = this.TX[i], tz = this.TZ[i], nx = tz, nz = -tx;
    const am = (a0 + a1) / 2, om = (o0 + o1) / 2;
    return { x: this.X[i] + tx * am + nx * om, z: this.Z[i] + tz * am + nz * om, tx, tz, nx, nz,
      ha: Math.abs(a1 - a0) / 2, ho: Math.abs(o1 - o0) / 2, am, om, i, ox: this.X[i], oz: this.Z[i] };
  }
  inFrame(f, x, z, pad = 0) {
    const dx = x - f.x, dz = z - f.z;
    return Math.abs(dx * f.tx + dz * f.tz) <= f.ha + pad && Math.abs(dx * f.nx + dz * f.nz) <= f.ho + pad;
  }
  /** World point at (along, across) from the frame's track sample (left +). */
  at(f, a, o) { return [f.ox + f.tx * a + f.nx * o, f.oz + f.tz * a + f.nz * o]; }

  /** The speed the line allows at each sample: grip `aLat`, top `vTop`, braking `br`, drive `ac`. */
  speedProfile(vTop, aLat, br, ac) {
    const N = this.N, V = new Float64Array(N), ds = this.ds;
    for (let i = 0; i < N; i++) V[i] = Math.min(vTop, Math.sqrt(aLat / Math.max(1e-4, Math.abs(this.LK[i]))));
    for (let pass = 0; pass < 3; pass++) {
      for (let i = N - 1; i >= 0; i--) { const n = V[this.w(i + 1)]; V[i] = Math.min(V[i], Math.sqrt(n * n + 2 * br * ds)); }
      for (let i = 0; i < N; i++) { const q = V[this.w(i - 1)]; V[i] = Math.min(V[i], Math.sqrt(q * q + 2 * ac * ds)); }
    }
    return V;
  }

  /** Surface height of the track at sample i under (x, z). */
  surfY(i, x, z) { return G.terrainHeight(x, z) + LIFT + this.E[i]; }

  /**
   * city.movers: the track's surface under (x, z) -- the layer nearest `curY`
   * (the bridge over the lower track), the highest with none; the paddock's
   * apron too. null off it.
   */
  deckAt(x, z, curY) {
    const b = this.bb;
    if (!this.ok || x < b[0] || z < b[1] || x > b[2] || z > b[3]) return null;
    let best = null, bd = Infinity;
    const gx = Math.floor(x / 8), gz = Math.floor(z / 8);
    for (let a = gx - 1; a <= gx + 1; a++) for (let c = gz - 1; c <= gz + 1; c++) {
      const l = this.grid.get(`${a},${c}`);
      if (!l) continue;
      for (const i of l) {
        const dx = x - this.X[i], dz = z - this.Z[i];
        const al = dx * this.TX[i] + dz * this.TZ[i];
        if (al > 0.75 || al < -0.75) continue;
        const lat = dx * this.TZ[i] - dz * this.TX[i];
        if (lat > HW + KERB || lat < -HW - KERB) continue;
        const y = G.terrainHeight(x, z) + LIFT + this.E[i] + (Math.abs(lat) > HW ? 0.025 : 0);
        const d = curY == null ? -y : Math.abs(y - curY);
        if (d < bd) { bd = d; best = y; }
      }
    }
    if (best === null && this.inFrame(this.paddock, x, z)) best = G.terrainHeight(x, z) + LIFT;
    return best;
  }

  /** Nothing grows on the property or near the track (city.extraClear). */
  keepClear(x, z) {
    if (!this.ok) return false;
    const c = this.clear, a = Math.floor((x - this.bb[0]) / c.cw), b = Math.floor((z - this.bb[1]) / c.cw);
    return a >= 0 && b >= 0 && a < c.gw && b < c.gh && c.m[b * c.gw + a] === 1;
  }

  /**
   * Where a kart is on the circuit: the sample nearest (x, z) on ITS layer
   * (within 1.8 m of the surface height there), searched from `i0` -back..+ahead,
   * or everywhere when i0 is null. { i, lat (left +), along }.
   */
  project(x, z, y, i0, back = 8, ahead = 30) {
    let bi = -1, bd = Infinity;
    const test = (i) => {
      const d = (x - this.X[i]) ** 2 + (z - this.Z[i]) ** 2;
      if (d >= bd) return;
      if (y != null && Math.abs(this.Tc[i] + LIFT + this.E[i] - y) > 1.8) return;
      bd = d; bi = i;
    };
    if (i0 == null) for (let i = 0; i < this.N; i++) test(i);
    else for (let k = -back; k <= ahead; k++) test(this.w(i0 + k));
    if (bi < 0) return null;
    const dx = x - this.X[bi], dz = z - this.Z[bi];
    return { i: bi, lat: dx * this.TZ[bi] - dz * this.TX[bi], along: dx * this.TX[bi] + dz * this.TZ[bi], d: Math.sqrt(bd) };
  }

  /** A grid slot: k = 0 pole. Two abreast, rows 4.5 m apart, the pole on the left. */
  gridSlot(k) {
    const r = Math.floor(k / 2), side = k % 2 ? -1 : 1;
    const i = this.w(this.iStart - Math.round((3.5 + r * 4.5 + (side < 0 ? 1.4 : 0)) / this.ds));
    const o = side * 1.55;
    return { x: this.X[i] + this.TZ[i] * o, z: this.Z[i] - this.TX[i] * o, h: Math.atan2(this.TX[i], this.TZ[i]), i };
  }

  /** The rental karts' bays in the paddock: [x, z, heading], nose to the track. */
  bays() {
    const f = this.paddock, out = [];
    for (let k = 0; k < 5; k++) {
      const [x, z] = this.at(f, -6 + k * 2.2, -11.6);
      out.push([x, z, Math.atan2(f.nx, f.nz)]);
    }
    return out;
  }
  /** Where ENTER opens the race office: the counter at the clubhouse's front. */
  counter() {
    if (this.clubFront) return this.clubFront;
    const [x, z] = this.at(this.paddock, -13, -12.2);
    return { x, z };
  }

  /** Map place (main.js mapPlaces). */
  places() {
    if (!this.ok) return [];
    const c = this.counter();
    return [{ x: c.x, z: c.z, kind: 'hydro', name: 'Erbsville Kartway', label: 'Kartway', near: false,
      hello: 'Erbsville Kartway — rental karts on the figure-eight. Walk to the counter at the clubhouse and press ENTER to race, or take a kart out for practice' }];
  }

  /**
   * Before the city is meshed: the buildings the track or the paddock run
   * through go flat, and the clubhouse's footprint is drawn here instead.
   */
  prep(city) {
    if (!city || !city.buildingsNear) return;
    const flat = (b) => { b.h = 0; if (!b.kw) b.kw = {}; b.kw.skip = true; };
    const c = boxAt(city, CLUB[0], CLUB[1], 3);
    if (c && c.w * c.d < 400) { this.club = { x: c.x, z: c.z, w: c.w, d: c.d, rot: c.rot }; flat(c); }
    const cx = (this.bb[0] + this.bb[2]) / 2, cz = (this.bb[1] + this.bb[3]) / 2;
    for (const b of city.buildingsNear(cx, cz, 320)) {
      if (b.h === 0) continue;
      const co = Math.cos(-b.rot), si = Math.sin(-b.rot);
      const inBox = (x, z, pad) => {
        const dx = x - b.x, dz = z - b.z, lx = dx * co - dz * si, lz = dx * si + dz * co;
        return Math.abs(lx) <= b.w / 2 + pad && Math.abs(lz) <= b.d / 2 + pad;
      };
      let hit = false;
      for (let i = 0; i < this.N && !hit; i += 2) if (inBox(this.X[i], this.Z[i], HW + 2.5)) hit = true;
      if (!hit && inBox(this.paddock.x, this.paddock.z, Math.min(this.paddock.ha, this.paddock.ho))) hit = true;
      if (hit) flat(b);
    }
  }

  // --- the scenery: a landmarks.js extra ------------------------------------------------

  build(ctx) {
    if (!this.ok) return;
    const S = new Builder(false);        // the asphalt, lines, kerbs, apron: lifted, polygon-offset
    const B = new Builder(false);        // everything that stands: tyres, walls, bridge, buildings
    const Fn = new Builder(true);        // chain-link fence (alpha-tested texture)
    const solids = ctx.solids;
    const N = this.N, X = this.X, Z = this.Z, TX = this.TX, TZ = this.TZ, E = this.E;
    const T = G.terrainHeight;
    const P = (i, o, up = 0) => { const x = X[i] + TZ[i] * o, z = Z[i] - TX[i] * o; return [x, T(x, z) + LIFT + E[i] + up, z]; };
    const UP = [0, 1, 0];

    // --- the asphalt: five lanes of vertices so the rubbered line can darken ------
    const lanes = [-HW + 0.18, -HW / 2, 0, HW / 2, HW - 0.18];
    const asph = (i, o) => {
      const r = Math.exp(-(((o - this.O[i]) / 1.3) ** 2)) * 0.75;
      const n = 0.9 + 0.12 * hash(Math.floor(i / 9) * 7 + Math.round(o));
      return [(ASPHALT[0] * (1 - r) + RUBBER[0] * r) * n, (ASPHALT[1] * (1 - r) + RUBBER[1] * r) * n, (ASPHALT[2] * (1 - r) + RUBBER[2] * r) * n];
    };
    for (let i = 0; i < N; i++) {
      const j = this.w(i + 1);
      for (let k = 0; k < lanes.length - 1; k++) {
        S.quad(P(i, lanes[k]), P(j, lanes[k]), P(j, lanes[k + 1]), P(i, lanes[k + 1]), UP, U0,
          [asph(i, lanes[k]), asph(j, lanes[k]), asph(j, lanes[k + 1]), asph(i, lanes[k + 1])]);
      }
    }
    // kerbs where it turns hard (inside from 1/30, outside from 1/18), else the white line
    const kerbAt = new Int8Array(N * 2);   // [i*2 + (left ? 1 : 0)]
    for (let i = 0; i < N; i++) {
      const k = this.K[i];
      if (Math.abs(k) < 1 / 30) continue;
      for (let d = -4; d <= 4; d++) {
        const q = this.w(i + d);
        kerbAt[q * 2 + (k > 0 ? 1 : 0)] = 1;                       // the inside of the turn
        if (Math.abs(k) > 1 / 18) kerbAt[q * 2 + (k > 0 ? 0 : 1)] = 1;
      }
    }
    for (let i = 0; i < N; i++) {
      const j = this.w(i + 1);
      for (const s of [-1, 1]) {
        if (kerbAt[i * 2 + (s > 0 ? 1 : 0)] && E[i] < 0.3) {
          const c = Math.floor(i * this.ds / 1.15) % 2 ? KERB_R : KERB_W;
          S.quad(P(i, s * (HW - 0.18), 0.01), P(j, s * (HW - 0.18), 0.01), P(j, s * (HW + KERB), 0.04), P(i, s * (HW + KERB), 0.04), UP, U0, c);
          // its outer lip down to the grass
          S.quad(P(i, s * (HW + KERB), 0.04), P(j, s * (HW + KERB), 0.04), P(j, s * (HW + KERB + 0.12), -LIFT - 0.02), P(i, s * (HW + KERB + 0.12), -LIFT - 0.02), [s * TZ[i], 1, -s * TX[i]], U0, c);
        } else {
          S.quad(P(i, s * (HW - 0.18), 0.004), P(j, s * (HW - 0.18), 0.004), P(j, s * HW, 0.004), P(i, s * HW, 0.004), UP, U0, LINE_W);
          // the asphalt's own edge, a short bevel to the grass (not on the ramps: walls there)
          if (E[i] < 0.05) S.quad(P(i, s * HW, 0.004), P(j, s * HW, 0.004), P(j, s * (HW + 0.25), -LIFT - 0.02), P(i, s * (HW + 0.25), -LIFT - 0.02), [s * TZ[i], 1, -s * TX[i]], U0, ASPHALT);
        }
      }
    }
    // the start/finish: a chequered band, and the grid's slots behind it
    {
      const i0 = this.iStart, n = 12, w = (2 * HW) / n;
      for (let r = 0; r < 2; r++) for (let c = 0; c < n; c++) {
        const ia = this.w(i0 + r), ib = this.w(i0 + r + 1);
        const o0 = -HW + c * w, o1 = o0 + w;
        S.quad(P(ia, o0, 0.008), P(ib, o0, 0.008), P(ib, o1, 0.008), P(ia, o1, 0.008), UP, U0, (r + c) % 2 ? DARK : LINE_W);
      }
      for (let k = 0; k < 6; k++) {
        const g = this.gridSlot(k), ia = this.w(g.i + 1), ib = this.w(g.i + 2);
        const o = (k % 2 ? -1 : 1) * 1.55;
        S.quad(P(ia, o - 0.75, 0.008), P(ib, o - 0.75, 0.008), P(ib, o + 0.75, 0.008), P(ia, o + 0.75, 0.008), UP, U0, LINE_W);
        for (const e of [-0.75, 0.6]) {
          const ic = this.w(g.i - 1);
          S.quad(P(ic, o + e, 0.008), P(ib, o + e, 0.008), P(ib, o + e + 0.15, 0.008), P(ic, o + e + 0.15, 0.008), UP, U0, LINE_W);
        }
      }
    }
    // the paddock's apron (and the pit lane along its front)
    {
      const f = this.paddock, steps = 12;
      for (let a = 0; a < steps; a++) for (let b = 0; b < 4; b++) {
        const a0 = -f.ha + (2 * f.ha * a) / steps, a1 = -f.ha + (2 * f.ha * (a + 1)) / steps;
        const b0 = -f.ho + (2 * f.ho * b) / 4, b1 = -f.ho + (2 * f.ho * (b + 1)) / 4;
        const q = (aa, bb) => { const [x, z] = this.at(f, aa + f.am, bb + f.om); return [x, T(x, z) + LIFT - 0.01, z]; };
        S.quad(q(a0, b0), q(a1, b0), q(a1, b1), q(a0, b1), UP, U0, APRON);
      }
      // painted bays for the rental karts
      for (const [bx, bz] of this.bays()) {
        const dx = bx - f.ox, dz = bz - f.oz, a = dx * f.tx + dz * f.tz, o = dx * f.nx + dz * f.nz;
        for (const e of [-1.05, 1.05]) {
          const q = (aa, bb) => { const [x, z] = this.at(f, aa, bb); return [x, T(x, z) + LIFT, z]; };
          S.quad(q(a + e - 0.05, o - 1.4), q(a + e + 0.05, o - 1.4), q(a + e + 0.05, o + 1.4), q(a + e - 0.05, o + 1.4), UP, U0, lin([0.85, 0.75, 0.2]));
        }
      }
    }

    // --- the bridge: retaining walls up the ramps, the deck over the span --------------
    if (this.ib >= 0) {
      const ib = this.ib;
      for (let d = -(SPAN + RAMP); d < SPAN + RAMP; d++) {
        const i = this.w(ib + d), j = this.w(ib + d + 1);
        if (E[i] < 0.05 && E[j] < 0.05) continue;
        const span = Math.abs(d) < SPAN && Math.abs(d + 1) <= SPAN;
        for (const s of [-1, 1]) {
          const o0 = s * (HW + 0.05), o1 = s * (HW + 0.35);
          const top = (k) => P(k, 0, 0)[1] + 0.12 + Math.min(1, E[k]) * 0.75;   // the parapet stands up with the deck
          const g = (k, o) => { const x = X[k] + TZ[k] * o, z = Z[k] - TX[k] * o; return T(x, z) - 0.3; };
          const xz = (k, o) => [X[k] + TZ[k] * o, Z[k] - TX[k] * o];
          const [ax, az] = xz(i, o1), [bx, bz] = xz(j, o1), [cx, cz] = xz(i, o0), [dx2, dz2] = xz(j, o0);
          const bot = (k, o) => (span ? P(k, 0, 0)[1] - 0.55 : g(k, o));
          // outer face, inner face (the parapet's above the deck), the coping
          B.quad([ax, bot(i, o1), az], [bx, bot(j, o1), bz], [bx, top(j), bz], [ax, top(i), az], [s * TZ[i], 0, -s * TX[i]], U0, CONCRETE);
          B.quad([cx, P(i, 0, 0)[1] - 0.02, cz], [dx2, P(j, 0, 0)[1] - 0.02, dz2], [dx2, top(j), dz2], [cx, top(i), cz], [-s * TZ[i], 0, s * TX[i]], U0, CONCRETE);
          B.quad([cx, top(i), cz], [dx2, top(j), dz2], [bx, top(j), bz], [ax, top(i), az], UP, U0, lin([0.74, 0.73, 0.70]));
          if (span) B.quad([cx, bot(i, o0), cz], [dx2, bot(j, o0), dz2], [dx2, P(j, 0, 0)[1] - 0.02, dz2], [cx, P(i, 0, 0)[1] - 0.02, cz], [-s * TZ[i], 0, s * TX[i]], U0, CONCRETE);
          // the parapet / wall is solid to anyone beside it at its level (a kart on
          // the deck is above a wall's top band only where there is no parapet)
          if (d % 2 === 0) {
            const mx = (ax + bx + cx + dx2) / 4, mz = (az + bz + cz + dz2) / 4, yTop = Math.max(top(i), top(j));
            solids.push({ x: mx, z: mz, hw: 1.15, hd: 0.2, rot: Math.atan2(TZ[i], TX[i]), y0: span ? P(i, 0, 0)[1] - 0.1 : Math.min(g(i, o1), g(j, o1)) - 0.2, y1: yTop });
          }
        }
        if (span) {
          // the deck's underside
          B.quad(P(i, -HW - 0.35, -0.55), P(j, -HW - 0.35, -0.55), P(j, HW + 0.35, -0.55), P(i, HW + 0.35, -0.55), [0, -1, 0], U0, lin([0.5, 0.49, 0.47]));
        }
      }
      // the abutments: the ramps' end walls facing the lower track, solid to it
      for (const d of [-SPAN, SPAN]) {
        const i = this.w(ib + d), sg = Math.sign(d);
        const a = P(i, -HW - 0.35, -0.5), b = P(i, HW + 0.35, -0.5);
        const ga = T(a[0], a[2]) - 0.3, gb = T(b[0], b[2]) - 0.3;
        B.quad([a[0], ga, a[2]], [b[0], gb, b[2]], b, a, [-sg * TX[i], 0, -sg * TZ[i]], U0, CONCRETE);
        const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2;
        solids.push({ x: mx - sg * TX[i] * 0.3, z: mz - sg * TZ[i] * 0.3, hw: HW + 0.4, hd: 0.35, rot: Math.atan2(-TX[i], TZ[i]), y0: Math.min(ga, gb), y1: P(i, 0, 0)[1] - 0.45 });
      }
    }

    // --- tyre walls ------------------------------------------------------------------
    const tyres = this.tyreWalls();
    let tyreN = 0;
    for (const run of tyres) {
      for (let k = 0; k < run.length; k++) {
        const [x, z, paint] = run[k];
        this.tyreStack(B, x, T(x, z) - 0.02, z, k * 0.7 + x, paint);
        tyreN++;
      }
      // solids: a box per four stacks
      for (let k = 0; k < run.length; k += 4) {
        const a = run[k], b = run[Math.min(run.length - 1, k + 3)];
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const y = T(mx, mz);
        solids.push({ x: mx, z: mz, hw: len / 2 + 0.3, hd: 0.32, rot: Math.atan2(b[1] - a[1], b[0] - a[0]), y0: y - 0.5, y1: y + 0.5 });
      }
    }
    this.tyreCount = tyreN;

    // --- the paddock: pit wall and fence, gantry, clubhouse, bleachers -----------------
    const f = this.paddock;
    const fy = (a, o) => { const [x, z] = this.at(f, a, o); return [x, T(x, z), z]; };
    const rotA = Math.atan2(f.tz, f.tx);          // a box's long side along the straight
    {
      // the pit wall: a low concrete wall between the track and the pit lane,
      // open at both ends, a chain-link fence on it
      const o = -(HW + 2.6), a0 = -17, a1 = 3;
      for (let a = a0; a < a1; a += 2) {
        const [x, y, z] = fy(a + 1, o);
        B.box(x, y - 0.2, z, 2.0, 1.0, 0.3, rotA, CONCRETE);
        solids.push({ x, z, hw: 1.0, hd: 0.2, rot: rotA, y0: y - 1, y1: y + 0.8 });
      }
      this.fence(Fn, B, (t) => fy(a0 + (a1 - a0) * t, o), a1 - a0, 0.8, 1.6);
    }
    // the start gantry: two posts, a beam, the light pod (lit by KartRace), a banner
    const g0 = P(this.iStart, -(HW + 0.7)), g1 = P(this.iStart, HW + 0.7);
    const gy = Math.max(g0[1], g1[1]);
    for (const q of [g0, g1]) {
      B.box(q[0], q[1] - 0.3, q[2], 0.22, gy - q[1] + 4.1, 0.22, 0, lin([0.85, 0.85, 0.84]));
      solids.push({ x: q[0], z: q[2], r: 0.25, y0: q[1] - 1, y1: q[1] + 4 });
    }
    const gr = Math.atan2(-TX[this.iStart], TZ[this.iStart]);       // across the track
    B.box((g0[0] + g1[0]) / 2, gy + 3.55, (g0[2] + g1[2]) / 2, Math.hypot(g1[0] - g0[0], g1[2] - g0[2]) + 0.22, 0.3, 0.3, gr, lin([0.85, 0.85, 0.84]));
    B.box((g0[0] + g1[0]) / 2, gy + 3.0, (g0[2] + g1[2]) / 2, 1.85, 0.44, 0.3, gr, DARK);
    this.lightsAt = { x: (g0[0] + g1[0]) / 2, y: gy + 3.22, z: (g0[2] + g1[2]) / 2, rot: gr, tx: TX[this.iStart], tz: TZ[this.iStart] };
    if (ctx.atlas) {
      for (const s of [-1, 1]) {
        const ban = ctx.atlas.panel(5.2, 0.62, 48, (g, W, Hh) => {
          // chequered ends, the words in the middle
          const q = Hh / 2;
          for (let c = 0; c < Math.ceil(W / q); c++) for (let r = 0; r < 2; r++) { g.fillStyle = (c + r) % 2 ? '#111' : '#f4f4f0'; g.fillRect(c * q, r * q, q, q); }
          g.fillStyle = '#c8102e'; g.fillRect(Hh * 1.6, 0, W - Hh * 3.2, Hh);
          g.fillStyle = '#fff'; g.font = `900 ${Hh * 0.62}px Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText('START · FINISH', W / 2, Hh * 0.54, W - Hh * 3.6);
        });
        ban.position.set(this.lightsAt.x - s * TX[this.iStart] * 0.17, gy + 3.55, this.lightsAt.z - s * TZ[this.iStart] * 0.17);
        ban.position.y = gy + 4.0;
        ban.rotation.y = Math.atan2(-s * TX[this.iStart], -s * TZ[this.iStart]);
        const grp = new THREE.Group(); grp.add(ban); ctx.addTo(ckey(ban.position.x, ban.position.z), grp);
      }
    }
    this.buildClubhouse(ctx, B, solids);
    this.buildBleachers(B, Fn, solids);

    // --- meshes ---------------------------------------------------------------------
    const g = new THREE.Group();
    const surf = new THREE.Mesh(S.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    surf.receiveShadow = true;
    const body = new THREE.Mesh(B.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }));
    body.castShadow = true; body.receiveShadow = true;
    const fence = new THREE.Mesh(Fn.build(), new THREE.MeshStandardMaterial({ map: chainLink(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5, color: 0xb8bcc0 }));
    fence.material.userData.noShadow = true;
    g.add(surf, body, fence);
    this.mats = [surf.material, body.material, fence.material];   // (harness: which merged meshes are the kartway's)
    this.stats = { tris: (S.idx.length + B.idx.length + Fn.idx.length) / 3, tyres: tyreN, solids: solids.length };
    ctx.addTo(ckey(X[this.iStart], Z[this.iStart]), g);
  }

  /**
   * Where the tyre walls stand: runs of points 0.62 m apart. Each side of the
   * track is offset to the outside of its run-off; a point that lands on or
   * next to another part of the track is pulled back to half way (one wall
   * between the two), one that folds into its own track (the inside of a
   * hairpin) is left out, as is the inside of a turn with nothing beyond it,
   * the bridge, and the paddock (the pit wall is the barrier there).
   */
  tyreWalls() {
    const N = this.N, X = this.X, Z = this.Z, TX = this.TX, TZ = this.TZ;
    const minOther = (x, z, i, excl) => {
      let m = Infinity;
      const gx = Math.floor(x / 8), gz = Math.floor(z / 8);
      for (let a = gx - 3; a <= gx + 3; a++) for (let c = gz - 3; c <= gz + 3; c++) {
        const l = this.grid.get(`${a},${c}`);
        if (l) for (const j of l) {
          if (this.gap(i, j) * this.ds < excl) continue;
          // the bridge's two layers: a wall on the ground ignores the deck above it
          if (this.E[j] > 1.2 && this.E[i] < 0.3) continue;
          m = Math.min(m, Math.hypot(x - X[j], z - Z[j]));
        }
      }
      return m;
    };
    const minOwn = (x, z, i) => {
      let m = Infinity;
      for (let k = -14; k <= 14; k++) { const j = this.w(i + k); m = Math.min(m, Math.hypot(x - X[j], z - Z[j])); }
      return m;
    };
    const runs = [];
    const placed = new Map();
    const near = (x, z) => {
      const a = Math.floor(x / 2), b = Math.floor(z / 2);
      for (let p = a - 1; p <= a + 1; p++) for (let q = b - 1; q <= b + 1; q++) {
        const l = placed.get(`${p},${q}`);
        if (l) for (const [u, v] of l) if ((u - x) ** 2 + (v - z) ** 2 < 0.45 * 0.45) return true;
      }
      return false;
    };
    const put = (x, z) => { const k = `${Math.floor(x / 2)},${Math.floor(z / 2)}`; let l = placed.get(k); if (!l) placed.set(k, (l = [])); l.push([x, z]); };
    const bridgeNear = (x, z) => {
      if (this.ib < 0) return false;
      for (let d = -(SPAN + 12); d <= SPAN + 12; d++) {
        const j = this.w(this.ib + d);
        if (Math.hypot(x - X[j], z - Z[j]) < HW + 1.6) return true;
      }
      return false;
    };
    for (const s of [-1, 1]) {
      // the outside of every turn, and ten metres either side of it
      const zone = new Uint8Array(N);
      for (let i = 0; i < N; i++) if (this.K[i] * s < -1 / 32) for (let d = -7; d <= 7; d++) zone[this.w(i + d)] = 1;
      let run = [], acc = 0, prev = null;
      const flush = () => { if (run.length >= 3) runs.push(run); run = []; acc = 0; prev = null; };
      for (let i = 0; i < N; i++) {
        const k = this.K[i] * s;                      // > 0: this side is the inside of the turn
        const out = k < -1 / 40 ? 3.4 : 2.4;
        let d = HW + out;
        const ok = (dd) => { const x = X[i] + TZ[i] * s * dd, z = Z[i] - TX[i] * s * dd; return minOther(x, z, i, 16) >= HW + 0.75; };
        let x = X[i] + TZ[i] * s * d, z = Z[i] - TX[i] * s * d;
        let valid = this.E[i] < 0.05;
        if (valid && minOwn(x, z, i) < d - 0.4) valid = false;            // folds into its own turn
        if (valid && !ok(d)) {
          // another part of the track is there: one wall half way between
          let lo = HW + 0.75, hi = d;
          if (!ok(lo)) valid = false;
          else { for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; } d = lo; }
          x = X[i] + TZ[i] * s * d; z = Z[i] - TX[i] * s * d;
        } else if (valid && !zone[i]) valid = false;   // a straight, or the inside of a turn with nothing beyond
        if (valid && (bridgeNear(x, z) || this.inFrame(this.paddock, x, z, 1.5))) valid = false;
        if (!valid) { flush(); continue; }
        if (!prev) { if (!near(x, z)) { run.push([x, z, 0]); put(x, z); } prev = [x, z]; continue; }
        // walk the wall's own length, a stack every 0.62 m
        let seg = Math.hypot(x - prev[0], z - prev[1]);
        if (seg > 3) { flush(); prev = [x, z]; continue; }
        let t = 0.62 - acc;
        while (t <= seg) {
          const u = t / seg, px = prev[0] + (x - prev[0]) * u, pz = prev[1] + (z - prev[1]) * u;
          if (!near(px, pz)) {
            // painted tyres on the outside of the turns, in blocks of four
            const paint = k < -1 / 25 ? 1 + (Math.floor((i + 400) / 4) % 2) : 0;
            run.push([px, pz, paint]); put(px, pz);
          } else if (run.length) { if (run.length >= 3) runs.push(run); run = []; }
          t += 0.62;
        }
        acc = seg - (t - 0.62);
        prev = [x, z];
      }
      flush();
    }
    return runs;
  }

  /**
   * One stack of two tyres, ~30 triangles: two six-sided bands turned 30 deg
   * on each other (the joint reads in the facets), the top a fan to a dark
   * centre (the hole).
   */
  tyreStack(B, x, y, z, seed, paint) {
    const n = 6, R = 0.29, th = 0.21;
    const rot = hash(Math.round(seed * 13)) * Math.PI;
    const col = paint ? TYRE_PAINT[paint - 1] : TYRE_C;
    const ring = (rr, yy, r0) => { const out = []; for (let k = 0; k < n; k++) { const a = r0 + (k / n) * Math.PI * 2; out.push([x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr]); } return out; };
    for (let t = 0; t < 2; t++) {
      const r0 = rot + t * Math.PI / n, A = ring(R, y + t * th, r0), C = ring(R * (t ? 0.97 : 1), y + (t + 1) * th - 0.012, r0);
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n, a = r0 + ((k + 0.5) / n) * Math.PI * 2;
        B.quad(A[k], A[k2], C[k2], C[k], [Math.cos(a), 0, Math.sin(a)], U0, col);
      }
      if (t) for (let k = 0; k < n; k++) B.tri([x, y + 2 * th - 0.05, z], C[k], C[(k + 1) % n], [UP_N, UP_N, UP_N], [TYRE_HOLE, col, col]);
    }
  }

  /** A chain-link fence along `at(t)` (t 0..1, `len` m): posts, a top rail, the mesh. */
  fence(Fn, B, at, len, y0, h) {
    const n = Math.max(1, Math.round(len / 2.5));
    for (let k = 0; k <= n; k++) {
      const [x, y, z] = at(k / n);
      B.box(x, y + y0 - 0.1, z, 0.06, h + 0.1, 0.06, 0, STEEL);
    }
    for (let k = 0; k < n; k++) {
      const [ax, ay, az] = at(k / n), [bx, by, bz] = at((k + 1) / n);
      const L = Math.hypot(bx - ax, bz - az), u0 = (k * L) / 1, u1 = ((k + 1) * L) / 1;
      Fn.quad([ax, ay + y0, az], [bx, by + y0, bz], [bx, by + y0 + h, bz], [ax, ay + y0 + h, az], [bz - az, 0, ax - bx], [u0, 0, u1, 0, u1, h, u0, h], [1, 1, 1]);
      B.tube([ax, ay + y0 + h, az], [bx, by + y0 + h, bz], 0.025, 5, STEEL, false);
    }
  }

  /** The clubhouse on OSM's footprint: siding, windows, a counter under an awning, the sign. */
  buildClubhouse(ctx, B, solids) {
    const T = G.terrainHeight;
    const c = this.club || { x: CLUB[0], z: CLUB[1], w: 10.7, d: 8.7, rot: 0.86 };
    // its front faces the paddock: whichever local axis points at the apron
    const f = this.paddock;
    const ux = Math.cos(c.rot), uz = Math.sin(c.rot), vx = -uz, vz = ux;
    const toP = [f.x - c.x, f.z - c.z];
    const alongU = Math.abs(toP[0] * ux + toP[1] * uz) > Math.abs(toP[0] * vx + toP[1] * vz);
    // (fx, fz) the front's outward normal; (sx, sz) along the front; W the front's width, D the depth
    let fx, fz, sx, sz, W, D;
    if (alongU) { const sg = Math.sign(toP[0] * ux + toP[1] * uz) || 1; fx = ux * sg; fz = uz * sg; sx = vx; sz = vz; W = c.d; D = c.w; }
    else { const sg = Math.sign(toP[0] * vx + toP[1] * vz) || 1; fx = vx * sg; fz = vz * sg; sx = ux; sz = uz; W = c.w; D = c.d; }
    const y = Math.min(T(c.x + fx * D / 2, c.z + fz * D / 2), T(c.x - fx * D / 2, c.z - fz * D / 2));
    const Hh = 3.3, rotW = Math.atan2(sz, sx);
    const SIDING = lin([0.86, 0.84, 0.76]), TRIM = lin([0.70, 0.12, 0.10]), ROOF = lin([0.30, 0.31, 0.33]), GLASSC = lin([0.12, 0.15, 0.18]);
    const Q = (a, b, h) => [c.x + sx * a + fx * b, y + h, c.z + sz * a + fz * b];
    B.box(c.x, y - 0.4, c.z, W, Hh + 0.4, D, rotW, SIDING, { ao: 0.12 });
    B.box(c.x, y + Hh - 0.25, c.z, W + 0.2, 0.3, D + 0.2, rotW, TRIM);
    // a low-pitched roof, the ridge along the front
    const rh = 1.1, ov = 0.5;
    const r0 = Q(-W / 2 - ov, D / 2 + ov, Hh), r1 = Q(W / 2 + ov, D / 2 + ov, Hh), r2 = Q(W / 2 + ov, 0, Hh + rh), r3 = Q(-W / 2 - ov, 0, Hh + rh);
    const r4 = Q(-W / 2 - ov, -D / 2 - ov, Hh), r5 = Q(W / 2 + ov, -D / 2 - ov, Hh);
    B.quad(r0, r1, r2, r3, [fx * 0.4, 1, fz * 0.4], U0, ROOF);
    B.quad(r4, r3, r2, r5, [-fx * 0.4, 1, -fz * 0.4], U0, ROOF);
    B.tri(Q(-W / 2, D / 2, Hh), Q(-W / 2, -D / 2, Hh), Q(-W / 2, 0, Hh + rh * 0.9), [-sx, 0, -sz], SIDING);
    B.tri(Q(W / 2, -D / 2, Hh), Q(W / 2, D / 2, Hh), Q(W / 2, 0, Hh + rh * 0.9), [sx, 0, sz], SIDING);
    // the front: a counter window under an awning, a door, two windows
    const fd = D / 2 + 0.02, nF = [fx, 0, fz];
    const pane = (a0, a1, h0, h1, col) => B.quad(Q(a0, fd, h0), Q(a1, fd, h0), Q(a1, fd, h1), Q(a0, fd, h1), nF, U0, col);
    pane(-W / 2 + 0.8, -W / 2 + 4.2, 1.0, 2.3, GLASSC);
    pane(-W / 2 + 0.7, -W / 2 + 4.3, 0.95, 1.0, TRIM);
    pane(-0.2, 0.8, 0, 2.15, lin([0.42, 0.10, 0.08]));
    pane(W / 2 - 3.0, W / 2 - 1.2, 1.1, 2.2, GLASSC);
    // the counter's shelf and an awning in the kartway's red and white
    B.box(Q(-W / 2 + 2.5, fd + 0.25, 0)[0], y + 0.95, Q(-W / 2 + 2.5, fd + 0.25, 0)[2], 3.6, 0.08, 0.5, rotW, lin([0.55, 0.40, 0.26]));
    for (let k = 0; k < 8; k++) {
      const a0 = -W / 2 + 0.4 + k * 0.6, a1 = a0 + 0.6;
      B.quad(Q(a0, fd, 2.75), Q(a1, fd, 2.75), Q(a1, fd + 1.3, 2.35), Q(a0, fd + 1.3, 2.35), [fx, 1, fz], U0, k % 2 ? KERB_W : KERB_R);
    }
    // the timing box on the roof: race control, glazed all round
    const tb = Q(W / 2 - 2.2, 0.6, Hh);
    B.box(tb[0], y + Hh + 0.2, tb[2], 2.6, 1.9, 2.4, rotW, SIDING);
    for (const [a, b] of [[0, 1.21], [0, -1.21]]) {
      const q = Q(W / 2 - 2.2 + a, 0.6 + b, Hh);
      B.box(q[0], y + Hh + 1.05, q[2], 2.2, 0.75, 0.02, rotW, GLASSC);
    }
    B.box(tb[0], y + Hh + 2.1, tb[2], 2.9, 0.15, 2.7, rotW, ROOF);
    solids.push({ x: c.x, z: c.z, hw: W / 2 + 0.1, hd: D / 2 + 0.1, rot: rotW, y0: y - 1, y1: y + Hh + 1 });
    // the sign: ERBSVILLE KARTWAY over the front, on the eave
    if (ctx.atlas) {
      const sgn = ctx.atlas.panel(W * 0.86, 1.15, 56, (g, Wd, Hd) => {
        g.fillStyle = '#c8102e'; g.fillRect(0, 0, Wd, Hd);
        g.fillStyle = '#ffffff'; g.fillRect(0, Hd * 0.06, Wd, Hd * 0.05); g.fillRect(0, Hd * 0.89, Wd, Hd * 0.05);
        // a chequered flag at each end
        const q = Hd * 0.18;
        for (const x0 of [Hd * 0.12, Wd - Hd * 0.12 - q * 4]) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { g.fillStyle = (r + k) % 2 ? '#111' : '#fff'; g.fillRect(x0 + k * q, Hd * 0.14 + r * q, q, q); }
        g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `900 italic ${Hd * 0.56}px Helvetica, Arial, sans-serif`;
        g.fillText('ERBSVILLE KARTWAY', Wd / 2, Hd * 0.52, Wd - Hd * 2.2);
      });
      const p = Q(0, fd + 0.08, Hh + 0.45);
      sgn.position.set(p[0], p[1], p[2]);
      sgn.rotation.y = Math.atan2(fx, fz);
      const back = new THREE.Group(); back.add(sgn);
      ctx.addTo(ckey(c.x, c.z), back);
      B.box(p[0] - fx * 0.06, y + Hh - 0.1, p[2] - fz * 0.06, W * 0.88, 1.2, 0.08, rotW, lin([0.9, 0.9, 0.88]));
      // and over the counter
      const sm = ctx.atlas.text('RENTALS · RACE ENTRY', 3.4, 0.42, '#111111', '#ffd23a', { weight: 900 });
      const p2 = Q(-W / 2 + 2.5, fd + 1.32, 2.15);
      sm.position.set(p2[0], p2[1], p2[2]); sm.rotation.y = Math.atan2(fx, fz);
      const g2 = new THREE.Group(); g2.add(sm); ctx.addTo(ckey(c.x, c.z), g2);
    }
    this.clubFront = { x: c.x + fx * (D / 2 + 2.2), z: c.z + fz * (D / 2 + 2.2) };
  }

  /** Aluminium bleachers beside the clubhouse, facing the straight. */
  buildBleachers(B, Fn, solids) {
    const T = G.terrainHeight, f = this.paddock;
    const [cx, cz] = this.at(f, -26, -11.2);
    const rot = Math.atan2(f.tz, f.tx);
    const y = T(cx, cz);
    const ALU = lin([0.78, 0.79, 0.80]), FRAMEC = lin([0.42, 0.44, 0.46]);
    const len = 8, rows = 5;
    for (let r = 0; r < rows; r++) {
      // each row backs away from the track (-nx) and up
      const ox = -f.nx * r * 0.72, oz = -f.nz * r * 0.72, h = 0.42 + r * 0.42;
      B.box(cx + ox, y + h, cz + oz, len, 0.05, 0.32, rot, ALU);                       // the seat plank
      B.box(cx + ox + f.nx * 0.3, y + h - 0.42, cz + oz + f.nz * 0.3, len, 0.03, 0.26, rot, ALU);   // the footboard
    }
    for (const a of [-len / 2 + 0.3, 0, len / 2 - 0.3]) {
      for (let r = 0; r < rows; r++) {
        const x = cx + f.tx * a - f.nx * r * 0.72, z = cz + f.tz * a - f.nz * r * 0.72;
        B.box(x, y - 0.1, z, 0.06, 0.52 + r * 0.42, 0.06, rot, FRAMEC);
      }
    }
    // a rail behind and along the top row
    const bx = cx - f.nx * (rows - 1) * 0.72 - f.nx * 0.3, bz = cz - f.nz * (rows - 1) * 0.72 - f.nz * 0.3;
    this.fence(Fn, B, (t) => [bx + f.tx * len * (t - 0.5), y + 0.42 * rows, bz + f.tz * len * (t - 0.5)], len, 0.05, 0.9);
    solids.push({ x: cx - f.nx * 1.5, z: cz - f.nz * 1.5, hw: len / 2, hd: 2.0, rot, y0: y - 1, y1: y + 2.4 });
    this.stands = { x: cx, z: cz, y, rot, nx: f.nx, nz: f.nz, tx: f.tx, tz: f.tz, len, rows };
  }
}

const UP_N = [0, 1, 0];

/** Do segments ab and cd cross? */
function segX(ax, az, bx, bz, cx, cz, dx, dz) {
  const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
  const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function inPoly(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}

let _chain = null;
/** Chain-link: a diamond mesh of galvanised wire, one 1 m tile, alpha-tested. */
function chainLink() {
  if (_chain) return _chain;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#ffffff'; g.lineWidth = 2.2;
  for (let k = -64; k <= 128; k += 16) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke();
    g.beginPath(); g.moveTo(k + 64, 0); g.lineTo(k, 64); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _chain = t;
  return t;
}

// ---------------------------------------------------------------------------------------------
// THE RACE

// The regulars. Pace is a share of the line's speed profile; `line` how far
// off the racing line they drive; `temper` how often they make a mistake.
const DRIVERS = [
  { name: 'YOU', num: 7, col: 0x1f6fd1, player: true },
  { name: 'Gord Weber', num: 11, col: 0xd8261c, pace: 1.0, line: 0.2, temper: 0.5 },
  { name: 'Steph Bauman', num: 3, col: 0xf2c014, pace: 0.985, line: -0.3, temper: 0.35 },
  { name: 'Priya Shah', num: 22, col: 0x22a05a, pace: 0.97, line: 0.4, temper: 0.6 },
  { name: 'Bruno Costa', num: 5, col: 0xe8742a, pace: 0.955, line: -0.5, temper: 0.9 },
  { name: 'Hans Martin', num: 18, col: 0x8a3fc2, pace: 0.935, line: 0.1, temper: 0.7 },
];
const RENTAL_COLS = [0x1f6fd1, 0xd8261c, 0xf2c014, 0x22a05a, 0xe8742a];
// the player starts fifth: a race to come through the field
const GRID = [1, 2, 3, 4, 0, 5];   // grid slot k -> driver index

export class KartRace {
  /** opts: { track, scene, city, traffic, onReward, getters: player, game, hud, audio } */
  constructor(opts) {
    this.o = opts;
    this.track = opts.track;
    this.state = 'idle';               // idle | menu | grid | race | done
    this.karts = [];
    this.rentals = [];
    this.best = this._load();
    this.practice = null;
    this._buildDom();
    this._buildLights();
  }

  get active() { return this.state === 'menu' || this.state === 'done'; }

  _load() {
    try { const s = JSON.parse(localStorage.getItem(BEST_KEY) || 'null'); if (s && typeof s === 'object') return s; } catch (e) { /* private mode */ }
    return { lap: 0, races: 0, wins: 0 };
  }
  _save() { try { localStorage.setItem(BEST_KEY, JSON.stringify(this.best)); } catch (e) { /* private mode */ } }

  /** At boot: the rental karts in their bays, mode 'apron' (never despawned). */
  spawnRentals() {
    const t = this.track;
    if (!t || !t.ok) return;
    t.bays().forEach(([x, z, h], k) => {
      const v = this.o.traffic.spawnAt(x, z, h, 'kart', RENTAL_COLS[k % RENTAL_COLS.length], 'apron');
      v.vLong = 0;
      this.rentals.push(v);
    });
  }

  /** On foot at the counter? */
  near(pl) {
    const t = this.track;
    if (!t || !t.ok || this.state !== 'idle' || !t.clubFront) return false;
    return Math.hypot(pl.x - t.clubFront.x, pl.z - t.clubFront.z) < 5;
  }

  // --- the overlay ---------------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'kartUi';
    d.innerHTML = `<div class="kBox"><span class="kPos"></span><span class="kLap"></span><span class="kTime"></span><span class="kBest"></span></div>
      <div class="kLights"><i></i><i></i><i></i><i></i><i></i></div><div class="kMsg"></div><div class="kPanel"></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #kartUi { position: absolute; inset: 0; z-index: 14; pointer-events: none; display: none; font: 900 14px -apple-system, Helvetica, sans-serif; color: #fff; }
      #kartUi.show { display: block; }
      #kartUi .kBox { position: absolute; top: calc(8px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%); display: flex; gap: 14px; align-items: baseline;
        background: rgba(12, 12, 14, .74); padding: 6px 14px; border-radius: 10px; border-bottom: 3px solid #c8102e; text-shadow: 0 1px 0 #0008; white-space: nowrap; }
      #kartUi .kPos { font-size: 22px; color: #ffd23a; } #kartUi .kBest { color: #9ae4ff; } #kartUi .kTime { font-variant-numeric: tabular-nums; }
      #kartUi .kLights { position: absolute; top: 18%; left: 50%; transform: translateX(-50%); display: none; gap: 10px; padding: 10px 14px; background: #111d; border-radius: 12px; }
      #kartUi .kLights i { width: 34px; height: 34px; border-radius: 50%; background: #3a0b0b; box-shadow: inset 0 0 6px #000; display: block; }
      #kartUi .kLights i.on { background: radial-gradient(circle at 40% 35%, #ff9a8a, #e3120b 55%, #8a0805); box-shadow: 0 0 18px #ff2a1a; }
      #kartUi .kMsg { position: absolute; top: 30%; left: 50%; transform: translateX(-50%); font: 900 54px -apple-system, Helvetica, sans-serif; text-shadow: 0 3px 0 #0009; opacity: 0; transition: opacity .25s; white-space: nowrap; }
      #kartUi .kMsg.show { opacity: 1; }
      #kartUi .kPanel { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(10, 10, 12, .86);
        pointer-events: auto; text-align: center; padding: 0 20px; }
      #kartUi .kPanel.on { display: flex; }
      #kartUi .kPanel .big { font: 900 30px -apple-system, Helvetica, sans-serif; color: #ffd23a; letter-spacing: .04em; }
      #kartUi .kPanel .sm { font: 700 14px/1.5 -apple-system, Helvetica, sans-serif; max-width: 620px; opacity: .95; }
      #kartUi .kPanel table { border-collapse: collapse; font: 700 13px -apple-system, Helvetica, sans-serif; }
      #kartUi .kPanel td { padding: 3px 10px; text-align: left; } #kartUi .kPanel tr.me td { color: #ffd23a; }
      #kartUi .kPanel button { padding: 10px 24px; border-radius: 999px; border: none; color: #fff; font: 900 15px -apple-system, sans-serif; background: #c8102e; margin: 2px; }
      #kartUi .kPanel button.back { background: rgba(255,255,255,.18); }`;
    document.head.appendChild(st);
    (document.getElementById('app') || document.body).appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { box: q('.kBox'), pos: q('.kPos'), lap: q('.kLap'), time: q('.kTime'), best: q('.kBest'), lights: q('.kLights'), msg: q('.kMsg'), panel: q('.kPanel') };
    this.ui.lamps = [...d.querySelectorAll('.kLights i')];
  }

  _panel(html, buttons) {
    const p = this.ui.panel;
    p.innerHTML = html + `<div>${buttons.map((b, i) => `<button data-i="${i}" class="${b.back ? 'back' : ''}">${b.label}</button>`).join('')}</div>`;
    p.classList.add('on');
    this.el.classList.add('show');
    p.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { p.classList.remove('on'); buttons[+b.dataset.i].go(); }));
  }

  _msg(text, t = 1.2) {
    this.ui.msg.textContent = text;
    this.ui.msg.classList.add('show');
    this.msgT = t;
  }

  /** The gantry's five lights: one small mesh, its colours set per state. */
  _buildLights() {
    const t = this.track;
    if (!t || !t.ok) return;
    const geo = new THREE.BufferGeometry();
    const pos = [], col = [], idx = [];
    for (let s = -1; s <= 1; s += 2) {
      for (let k = 0; k < 5; k++) {
        const b = pos.length / 3, a = (k - 2) * 0.34, r = 0.12;
        for (const [u, v] of [[-r, -r], [r, -r], [r, r], [-r, r]]) {
          // across the beam (local x), up (y), out of the pod toward the grid (s)
          pos.push(a + u, v, s * 0.17);
          col.push(0.12, 0.02, 0.02);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }));
    m.name = 'kart:lights';
    this.lights = m;
    this.lightsOn = -1;
    this._placeLights();
    this.o.scene.add(m);
  }
  _placeLights() {
    const L = this.track.lightsAt;
    if (!L || !this.lights) return;
    this.lights.position.set(L.x, L.y, L.z);
    this.lights.rotation.y = Math.atan2(L.tx, L.tz);
  }
  _setLights(n) {
    if (!this.lights || n === this.lightsOn) return;
    this.lightsOn = n;
    const c = this.lights.geometry.attributes.color;
    for (let s = 0; s < 2; s++) for (let k = 0; k < 5; k++) for (let q = 0; q < 4; q++) {
      const on = k < n;
      c.setXYZ((s * 5 + k) * 4 + q, on ? 1.6 : 0.12, on ? 0.08 : 0.02, on ? 0.05 : 0.02);
    }
    c.needsUpdate = true;
    this.ui.lamps.forEach((l, k) => l.classList.toggle('on', k < n));
  }

  /** ENTER at the counter: the race office. */
  open() {
    const { game } = this.o;
    this.state = 'menu';
    game.hold('kart');
    const B = this.best;
    this._panel(`<div class="big">ERBSVILLE KARTWAY</div><div class="sm">Three laps of the figure eight against five of the regulars, from a standing start.
      You start fifth in kart #7. Five red lights come on -- go when they go out.
      Stay on the asphalt: the grass is slow, and cutting across the infield costs time and the lap.</div>
      <table>${DRIVERS.slice(1).map((d) => `<tr><td>#${d.num}</td><td>${d.name}</td></tr>`).join('')}</table>
      <div class="sm">Purse: 1st $${PURSE[0]} · 2nd $${PURSE[1]} · 3rd $${PURSE[2]}${B.lap ? ` · Your best lap ${fmt(B.lap)}` : ''}${B.wins ? ` · Wins: ${B.wins}` : ''}</div>`,
    [{ label: 'RACE (3 LAPS)', go: () => this.startRace() }, { label: 'PRACTICE', go: () => this._practice() }, { label: 'LEAVE', back: true, go: () => this._close() }]);
  }

  _close() { this.state = 'idle'; this.o.game.release('kart'); this.el.classList.remove('show'); }

  /** Practice: into a rental kart in the pit lane; laps are timed. */
  _practice() {
    this._close();
    const v = this.rentals.find((k) => k && !k.dead && k !== this.o.player.vehicle && this.o.traffic.cars.includes(k));
    if (!v) return;
    v.group.visible = true;
    this.o.player.enterVehicle(v);
    this.o.hud.showToast('Practice: out of the pit lane and round. Laps are timed', 3500);
  }

  // --- a race ----------------------------------------------------------------------------------

  startRace() {
    const { traffic, player, game } = this.o, t = this.track;
    game.release('kart');
    this.el.classList.add('show');
    if (player.vehicle) player.exitVehicle(true);
    this._clear();
    this.state = 'grid';
    this.t = 0;
    this.raceT = 0;
    this.goAt = 5 + 0.4 + Math.random() * 0.9;
    for (let k = 0; k < GRID.length; k++) {
      const d = DRIVERS[GRID[k]], g = t.gridSlot(k);
      const v = traffic.spawnAt(g.x, g.z, g.h, 'kart', d.col, d.player ? 'free' : 'race');
      v.vLong = 0;
      v.group.visible = true;
      const kt = { d, v, k, slot: g, i: g.i, lat: 0, prog: -this._ahead(g.i), laps: 0, lapT0: 0, lapTimes: [], best: 0, done: 0, pen: 0,
        clean: true, lane: null, err: null, errT: 0, off: null, place: 0 };
      this.karts.push(kt);
      if (d.player) { player.enterVehicle(v); this.me = kt; }
    }
    this._setLights(0);
    this.ui.lights.style.display = 'flex';
    if (this.o.audio) this.o.audio.ui('start');
  }

  /** Metres from sample i forward to the start line. */
  _ahead(i) { const t = this.track; return t.w(t.iStart - i) * t.ds; }

  _clear() {
    const { traffic, player } = this.o;
    for (const k of this.karts) if (traffic.cars.includes(k.v) && k.v !== player.vehicle) traffic.remove(k.v);
    if (this.me && this.me.v && this.me.v !== player.vehicle && traffic.cars.includes(this.me.v)) traffic.remove(this.me.v);
    this.karts = [];
    this.me = null;
  }

  update(dt) {
    const t = this.track;
    if (!t || !t.ok) return;
    const cam = this.o.camera;
    if (this.lights && cam) this.lights.visible = Math.hypot(cam.position.x - t.lightsAt.x, cam.position.z - t.lightsAt.z) < 260;
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.ui.msg.classList.remove('show'); }
    if (this.state === 'grid' || this.state === 'race') this._raceStep(dt);
    else if (this.state === 'idle') this._practiceStep(dt);
    // a rental driven off and left (traffic despawns it far away) is back in its bay
    // the next time nobody is looking
    if ((this._bayT = (this._bayT || 0) - dt) <= 0 && cam) {
      this._bayT = 5;
      const far = Math.hypot(cam.position.x - t.X[t.iStart], cam.position.z - t.Z[t.iStart]) > 400;
      if (far) t.bays().forEach(([x, z, h], k) => {
        const v = this.rentals[k];
        if (v && this.o.traffic.cars.includes(v) && v !== this.o.player.vehicle) return;
        const n = this.o.traffic.spawnAt(x, z, h, 'kart', RENTAL_COLS[k % RENTAL_COLS.length], 'apron');
        n.vLong = 0;
        this.rentals[k] = n;
      });
    }
  }

  _raceStep(dt) {
    const { player, game } = this.o, t = this.track;
    if (game.dead) { this._abandon('The race is off.'); return; }
    this.t += dt;
    if (this.state === 'grid') {
      // the lights: one a second, then out together after a pause nobody can guess
      const n = Math.min(5, Math.floor(this.t));
      this._setLights(this.t >= this.goAt ? 0 : n);
      if (n > (this._lastN || 0) && this.t < this.goAt && this.o.audio) this.o.audio.ui('tick');
      this._lastN = n;
      if (this.t >= this.goAt) {
        this.state = 'race';
        this.raceT = 0;
        this._msg('GO!', 1.1);
        if (this.o.audio) this.o.audio.ui('go');
        setTimeout(() => { if (this.state === 'race') this.ui.lights.style.display = 'none'; }, 1200);
      }
      // held on the grid: anything the stick or the revs did this frame is undone
      for (const k of this.karts) {
        k.pos = k.k + 1;
        const v = k.v;
        v.x = k.slot.x; v.z = k.slot.z; v.heading = k.slot.h; v.vLong = 0; v.vLat = 0;
        if (v !== player.vehicle) v.update(dt, { throttle: 0, brake: 1, steer: 0 });
        v.x = k.slot.x; v.z = k.slot.z; v.heading = k.slot.h; v.vLong = 0; v.vLat = 0;
        if (v.sync) v.sync();
      }
      this._hud();
      return;
    }
    this.raceT += dt;
    for (const k of this.karts) {
      if (!k.d.player) this._drive(k, dt, k.done ? 0.55 : 1);   // (after the flag, a cool-down lap)
      this._track(k, dt, this.raceT, LAPS);
    }
    // the race order
    const order = this._order();
    order.forEach((k, n) => { k.pos = n + 1; });
    const me = this.me;
    if (me) {
      if (player.vehicle !== me.v) { this._offT = (this._offT || 0) + dt; if (this._offT > 4 && !me.done) { this._abandon('You left your kart: the race goes on without you.'); return; } }
      else this._offT = 0;
      if (Math.hypot(me.v.x - t.X[t.iStart], me.v.z - t.Z[t.iStart]) > 600) { this._abandon('Too far from the track: the race is off.'); return; }
    }
    this._hud();
    const allDone = this.karts.every((k) => k.done);
    if (allDone || (me && me.done && this.raceT - me.done > 25)) this._end();
  }

  /** Progress, laps, cuts, penalties for one kart; `clock` the race's, `laps` to run (Infinity: practice). */
  _track(k, dt, clock, laps) {
    const t = this.track, v = k.v;
    let pr = t.project(v.x, v.z, v.y, k.i, 10, 40);
    const offNow = !pr || Math.abs(pr.lat) > HW + KERB + 0.4 || pr.d > HW + 6;
    if (offNow) {
      // off the asphalt: where along the loop is it now? (a cut lands far ahead)
      const g = t.project(v.x, v.z, v.y, k.i, 20, 320);
      if (g && Math.abs(g.lat) < HW + 8) pr = g;
    }
    if (!pr) return;
    let di = pr.i - k.i;
    if (di > t.N / 2) di -= t.N; else if (di < -t.N / 2) di += t.N;
    const was = k.prog;
    k.prog += di * t.ds;
    k.i = pr.i; k.lat = pr.lat;
    // CUTTING: off the track, then back on further along than the distance driven allows
    const sp = Math.abs(v.vLong);
    if (offNow) {
      if (!k.off) k.off = { prog: was, dist: 0 };
      k.off.dist += sp * dt;
    } else if (k.off) {
      const gained = k.prog - k.off.prog;
      if (gained > k.off.dist * 1.3 + 12) {
        const pen = Math.min(10, 2 + Math.round(gained / 25));
        k.pen += pen; k.clean = false;
        if (k.d.player) { this._msg(`CUT +${pen} s`, 1.6); this.o.hud.showToast(`Corner cut — ${pen} s penalty, and the lap won't count`, 2600); if (this.o.audio) this.o.audio.ui('fail'); }
      }
      k.off = null;
    }
    // laps: past the line, a whole loop further than the last time
    if (k.done || (laps === Infinity && !k.started)) return;
    const L = t.L;
    while (k.prog >= (k.laps + 1) * L) {
      k.laps++;
      const lt = clock - k.lapT0;
      k.lapT0 = clock;
      k.lapTimes.push(lt);
      if (k.clean && (!k.best || lt < k.best)) k.best = lt;
      if (k.d.player) {
        const rec = k.clean && (!this.best.lap || lt < this.best.lap);
        if (rec) { this.best.lap = +lt.toFixed(3); this._save(); }
        if (k.laps < laps) this.o.hud.showToast(`Lap ${laps === Infinity ? '' : k.laps + ': '}${fmt(lt)}${k.clean ? '' : ' (cut — no time)'}${rec ? ' · BEST LAP' : ''}`, 2400);
        if (k.laps === laps - 1) this._msg('FINAL LAP', 1.4);
        if (this.o.audio) this.o.audio.ui('check');
      }
      k.clean = true;
      if (k.laps >= laps) {
        k.done = clock;
        if (k.d.player) {
          const place = this._order().indexOf(k) + 1;
          this._msg(place === 1 ? 'WINNER!' : `FINISHED P${place}`, 3);
          if (this.o.audio) this.o.audio.cash();
        }
        break;
      }
    }
  }

  /** Finishers by time (penalties in), then the rest by distance. */
  _order() {
    return this.karts.slice().sort((a, b) => {
      if (a.done && b.done) return (a.done + a.pen) - (b.done + b.pen);
      if (a.done) return -1;
      if (b.done) return 1;
      return b.prog - a.prog;
    });
  }

  /**
   * An AI driver (and the harness's autopilot): pure pursuit of a point down
   * the racing line, at the line's speed times its pace, round slower karts,
   * with the odd mistake.
   */
  _drive(k, dt, paceScale = 1) {
    const inp = this._decide(k, dt, paceScale);
    k.v.update(dt, inp);
    collideWithBuildings(k.v, this.o.city, null, true);
  }

  /** The driver's inputs { throttle, brake, steer } for this frame. */
  _decide(k, dt, paceScale = 1) {
    const t = this.track, v = k.v, d = k.d, sp = Math.abs(v.vLong);
    const pace = (d.pace || 1) * paceScale;
    // mistakes: now and then a driver runs wide or lifts
    if (k.errT > 0) { k.errT -= dt; if (k.errT <= 0) k.err = null; }
    else if (!d.player && Math.random() < dt * (d.temper || 0) * 0.09) {
      k.err = Math.random() < 0.55 ? 'wide' : 'lift';
      k.errT = k.err === 'wide' ? 1.6 : 0.9;
    }
    const look = 3.2 + sp * 0.3;
    const ti = t.w(k.i + Math.round(look / t.ds));
    const kurv = t.K[ti];
    const lim = HW - 0.7;
    // the line: the racing line, this driver's habit off it, a mistake's run wide
    let want = t.O[ti] + (d.line || 0) * 0.6;
    if (k.err === 'wide') want -= Math.sign(kurv) * 1.4;
    // traffic: a kart just ahead in my lane -- pull out to the side with the
    // room and go by; if there is no room, sit behind it
    let cap = Infinity;
    for (const o of this.karts) {
      if (o === k) continue;
      const gapM = o.prog - k.prog, rel = o.lat - k.lat;
      if (gapM > 0 && gapM < 12 && Math.abs(rel) < 1.7 && (sp > Math.abs(o.v.vLong) - 0.3 || gapM < 4)) {
        const roomL = lim - o.lat, roomR = o.lat + lim;
        const side = roomL > roomR ? 1 : -1, room = Math.max(roomL, roomR);
        if (room > 1.6) want = o.lat + side * 1.75;
        if (gapM < 4.5 && Math.abs(rel) < 1.25) cap = Math.min(cap, Math.abs(o.v.vLong) * 0.98);
      } else if (Math.abs(gapM) < 2.2 && Math.abs(rel) < 1.3) {
        // side by side: give it room
        want = k.lat - Math.sign(rel || 1) * 1.4;
      }
    }
    want = Math.max(-lim, Math.min(lim, want));
    if (k.lane == null) k.lane = k.lat;
    k.lane += (want - k.lane) * Math.min(1, dt * 2.2);
    const lane = k.lane;
    let px = t.X[ti] + t.TZ[ti] * lane, pz = t.Z[ti] - t.TX[ti] * lane;
    // in the paddock (behind the pit wall): out by the pit exit first
    const inPits = k.lat < -(HW + 1.5) && t.inFrame(t.paddock, v.x, v.z);
    if (inPits) {
      // down the pit lane, parallel to the wall, until it ends; then out onto the track
      const f = t.paddock, al = (v.x - f.ox) * f.tx + (v.z - f.oz) * f.tz;
      [px, pz] = al < 4 ? t.at(f, al + 7, -7.6) : t.at(f, al + 6, -2.4);
    }
    const dx = px - v.x, dz = pz - v.z, dist = Math.hypot(dx, dz) || 1;
    const alpha = wrapA(Math.atan2(dx, dz) - v.heading);
    const kappa = (2 * Math.sin(alpha)) / dist;
    const steer = v.aiSteer ? v.aiSteer(kappa) : Math.max(-1, Math.min(1, alpha * 2.4));
    // speed: the profile a little ahead, scaled by pace (and the mistake)
    // (off the line, through the corner it is slower: the lane's own radius)
    const offLine = Math.abs(lane - t.O[ti]);
    let vt = Math.min(t.V[t.w(k.i + 2)], t.V[t.w(k.i + 5)]) * pace * (1 - Math.min(0.12, offLine * Math.abs(kurv) * 0.6));
    if (k.err === 'wide') vt *= 1.07;
    if (k.err === 'lift') vt *= 0.72;
    vt = Math.min(vt, cap);
    if (Math.abs(k.lat) > HW + KERB) vt = Math.min(vt, 9);   // on the grass: back to the asphalt
    if (inPits) vt = Math.min(vt, 7);
    const inp = { throttle: 0, brake: 0, steer };
    const a = Math.max(-12, Math.min(8, (vt - v.vLong) * 2.6));
    if (v.aiPedals) v.aiPedals(a, inp);
    else if (a > 0) inp.throttle = Math.min(1, a / 4); else inp.brake = Math.min(1, -a / 8);
    return inp;
  }

  /** Harness: the AI drives the player's kart (player.autoDrive, through the player's own driving path). */
  get autopilot() { return !!this._ap; }
  set autopilot(on) {
    this._ap = !!on;
    this.o.player.autoDrive = on ? (input, dt) => {
      const k = this.state === 'race' ? this.me : this.state === 'idle' ? this.practice : null;
      if (!k || k.v !== this.o.player.vehicle) return { x: 0, y: 0, gasAmt: 0, brakeAmt: this.state === 'grid' ? 1 : 0 };
      const inp = this._decide(k, dt || 1 / 60, this.autoPace || 1);
      return { x: -inp.steer, y: 0, gasAmt: inp.throttle, brakeAmt: inp.brake };
    } : null;
  }

  _hud() {
    const me = this.me, u = this.ui;
    if (!me) return;
    u.box.style.display = 'flex';
    u.pos.textContent = `P${me.pos || 6}/${this.karts.length}`;
    u.lap.textContent = this.state === 'grid' ? 'ON THE GRID' : me.done ? 'FINISHED' : `LAP ${Math.min(LAPS, me.laps + 1)}/${LAPS}`;
    u.time.textContent = this.state === 'race' ? `${fmt(this.raceT - me.lapT0)}${me.pen ? ` +${me.pen}s` : ''}` : '';
    u.best.textContent = me.best ? `BEST ${fmt(me.best)}` : this.best.lap ? `RECORD ${fmt(this.best.lap)}` : '';
  }

  _end() {
    if (this.state !== 'race') return;
    this.state = 'done';
    const res = this._order();
    res.forEach((k, n) => { k.place = n + 1; });
    const me = this.me, place = me ? me.place : 6;
    const pay = me && me.done ? PURSE[place - 1] || 0 : 0;
    this.best.races = (this.best.races || 0) + 1;
    if (place === 1 && me && me.done) this.best.wins = (this.best.wins || 0) + 1;
    this._save();
    if (pay && this.o.onReward) this.o.onReward(pay);
    this.lastResult = { place, pay, order: res.map((k) => ({ name: k.d.name, num: k.d.num, done: k.done, pen: k.pen, best: k.best, laps: k.laps })) };
    const rows = res.map((k) => `<tr class="${k.d.player ? 'me' : ''}"><td>${k.done ? 'P' + k.place : 'DNF'}</td><td>#${k.d.num}</td><td>${k.d.name}</td>
      <td>${k.done ? fmt(k.done + k.pen) : `${k.laps}/${LAPS} laps`}</td><td>${k.best ? 'best ' + fmt(k.best) : ''}</td><td>${k.pen ? '+' + k.pen + ' s' : ''}</td></tr>`).join('');
    const head = !me || !me.done ? 'DID NOT FINISH' : place === 1 ? 'YOU WIN!' : `FINISHED P${place}`;
    this.ui.lights.style.display = 'none';
    this._panel(`<div class="big">${head}</div><table>${rows}</table>
      <div class="sm">${pay ? `Paid $${pay}` : 'No purse'}${this.best.lap ? ` · Your best lap ${fmt(this.best.lap)}` : ''}</div>`,
    [{ label: 'RACE AGAIN', go: () => { this.o.game.release('kart'); this.startRace(); } }, { label: 'BACK TO THE PADDOCK', back: true, go: () => this._toPaddock() }]);
    this.o.game.hold('kart');
  }

  _abandon(note) {
    this.state = 'idle';
    this.ui.lights.style.display = 'none';
    this.ui.panel.classList.remove('on');
    this.o.game.release('kart');
    this._orphan = this.me && this.me.v;
    this._clear();
    this.el.classList.remove('show');
    if (note) this.o.hud.showToast(note, 3000);
  }

  _toPaddock() {
    const { player, game, traffic } = this.o, t = this.track;
    game.release('kart');
    const mine = player.vehicle;
    if (mine) player.exitVehicle(true);
    this._clear();
    if (mine && traffic.cars.includes(mine) && !this.rentals.includes(mine)) traffic.remove(mine);
    this.state = 'idle';
    this.el.classList.remove('show');
    const c = t.clubFront;
    if (c && player.respawn) player.respawn(c.x, c.z);
  }

  /** Not racing: a lap timer for anyone in a kart on the circuit. */
  _practiceStep(dt) {
    const { player } = this.o, t = this.track, v = player.vehicle;
    if (this._orphan && v !== this._orphan) { if (this.o.traffic.cars.includes(this._orphan)) this.o.traffic.remove(this._orphan); this._orphan = null; }
    if (!v || !v.spec.kart) { if (this.practice) { this.practice = null; this.el.classList.remove('show'); } return; }
    let P = this.practice;
    const pr = t.project(v.x, v.z, v.y, P ? P.i : null, 10, 40);
    if (!pr || pr.d > 40) { if (P) { this.practice = null; this.el.classList.remove('show'); } return; }
    if (!P) {
      P = this.practice = { d: DRIVERS[0], v, i: pr.i, lat: pr.lat, prog: -this._ahead(pr.i), laps: 0, lapT0: 0, t: 0, clean: false, best: 0, pen: 0, off: null, lapTimes: [] };
      this.el.classList.add('show');
    }
    P.v = v;
    P.t += dt;
    const was = P.prog;
    this._track(P, dt, P.t, Infinity);
    // the clock starts the first time over the line
    if (!P.started && was <= 0 && P.prog > 0) { P.started = true; P.lapT0 = P.t; P.clean = true; P.laps = 0; P.prog = Math.min(P.prog, 5); }
    const u = this.ui;
    u.box.style.display = 'flex';
    u.pos.textContent = 'PRACTICE';
    u.lap.textContent = P.started ? `LAP ${P.laps + 1}` : 'TO THE LINE';
    u.time.textContent = P.started ? fmt(P.t - P.lapT0) : '';
    u.best.textContent = this.best.lap ? `BEST ${fmt(this.best.lap)}` : '';
  }
}

function fmt(s) {
  if (!isFinite(s) || s <= 0) return '--';
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`;
}
