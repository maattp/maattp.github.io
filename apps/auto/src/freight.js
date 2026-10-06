// FREIGHT: BNSF's main line through Seattle -- the Scenic Subdivision down
// from Golden Gardens along Shilshole, over Salmon Bay on the bascule bridge,
// through Balmer Yard at Interbay and along the waterfront, under downtown in
// the Great Northern Tunnel, and the Seattle Subdivision south through SODO
// and Georgetown toward Tukwila. Both main tracks where the line has two,
// single track at the ends where it has one. Freights of twenty -- BNSF and
// CN power up front, grain hoppers, coal, crude oil tank cars and boxcars --
// run it, sound for every level crossing, and stop at Balmer Yard for a crew
// change, where you can take one over and drive it.
//
// WHERE THE NUMBERS COME FROM. The route, its tunnel and bridges: OSM
// (data/freight.json, tools/build_freight.py). The rolling stock: railcars.js.
//   [GE]   ES44 data sheets: 4,400 hp, ~680 kN starting tractive effort
//   [AAR]  air brakes: full-service ~0.3-0.5 m/s2 on a loaded train, emergency
//          ~1 m/s2; 286,000 lb cars; 49 CFR 222 horn rule: long, long,
//          short, long, starting 15-20 s before a crossing, the last long held
//          until the locomotive occupies it
//   [BNSF] Seattle-area timetable speeds ~30-50 mph (est. from the
//          subdivisions' published maximums)
//   est.   the arcade multipliers below, which make a 2,700 t train drivable
//          on a phone rather than a lesson in patience

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder, ChunkBuilder, SinkBuilder, LazyChunks, dropStaticArrays, dropGeometryArrays } from './build.js';
import { LinkTrack, KIND } from './link.js';
import { vehicleAssets, tagGlass } from './vehicles.js';
import { railCar, railDecals, RAIL_COLOURS } from './railcars.js';
import { clamp, angleWrap } from './util.js';
import { memo } from './bootcache.js';

const { TUN, BOX, DECK, FILL, CROSS } = KIND;

export const FREIGHT = {
  gauge: 1.435,
  lift: 0.55,            // rail head over the smoothed ground at grade (ballast shoulders)
  liftX: 0.36,           // flush with the road at a level crossing
  deck: 5.0,             // a bridge's rail head over the ground under it (est.)
  cover: 9.0,            // the tunnel's rail head at least this far under the ground (est.)
  grade: 0.022,          // BNSF's ruling grades here are ~1.5-2.2 %
  boreW: 3.1, boreH: 7.1, roofOut: 7.9,    // one box per track, double-stack clearance (est.)
  vMax: 22.4,            // 50 mph
  vTunnel: 13.4,         // 30 mph through the Great Northern Tunnel
  vYard: 11.2,           // 25 mph past Balmer Yard
  aLat: 0.7,             // unbalanced lateral acceleration in a curve (est.)
  dwell: 75,             // a crew change, seconds (est.)
  // traction: per locomotive, times the arcade factor
  teMax: 680e3, power: 3.28e6, arcade: 1.7,
  brakeService: 0.55, brakeEmerg: 1.0,     // m/s2 at full application (arcade)
  applyRate: 0.45, releaseRate: 0.22,      // brake cylinder, per second
};

const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const RANGE = ON_PHONE ? { flat: 1900, bed: 900, near: 380, train: 1300, gate: 260, yard: 700 }
  : { flat: 2800, bed: 1500, near: 650, train: 2000, gate: 380, yard: 1100 };
const CHUNK = 500;
const G_ACC = 9.81;

// Two freights, one on each main. The same twenty are the ones that stop at
// the yard, so they are built as the whole train (one geometry each).
const CONSISTS = [
  ['bnsf6603', 'cn2871', 'boxBnsf', 'boxCn', 'hopperCn1', 'hopperCn2', 'hopperBnsf', 'tankCrude', 'tankCrude2', 'tankEthanol',
    'coal1', 'coal2', 'coal1', 'boxCn2', 'hopperBnsf', 'hopperCn1', 'tankCrude', 'boxBnsf', 'coal2', 'boxCn'],
  ['cn2925', 'bnsf6712', 'hopperCn1', 'hopperCn2', 'hopperCn1', 'hopperBnsf', 'hopperCn2', 'boxCn', 'boxCn2', 'tankCrude2',
    'tankEthanol', 'tankCrude', 'coal1', 'coal2', 'coal1', 'coal2', 'boxBnsf', 'hopperCn1', 'boxCn', 'hopperBnsf'],
];
// the cuts standing in Balmer Yard (static, drawn within RANGE.yard)
const YARD_CUTS = [
  ['hopperCn1', 'hopperCn2', 'hopperCn1', 'hopperBnsf', 'hopperCn2', 'hopperCn1', 'hopperBnsf', 'hopperCn2'],
  ['boxCn', 'boxBnsf', 'boxCn2', 'boxBnsf', 'boxCn', 'tankCrude', 'tankEthanol'],
  ['coal1', 'coal2', 'coal1', 'coal2', 'coal1', 'coal2', 'coal1'],
  ['tankCrude', 'tankCrude2', 'tankEthanol', 'tankCrude', 'tankCrude2', 'boxCn2'],
];

// ---------------------------------------------------------------------------
// Geometry helpers along a track (link.js's, for this line)

const uv0 = [0, 0, 1, 0, 1, 1, 0, 1];
const UP = [0, 1, 0], DOWN = [0, -1, 0];
function frame(tr, s) {
  const h = tr.heading(s);
  return { x: tr.x(s), y: tr.y(s), z: tr.z(s), fx: Math.sin(h), fz: Math.cos(h), lx: Math.cos(h), lz: -Math.sin(h), h };
}
const at = (F, o, dy) => [F.x + F.lx * o, F.y + dy, F.z + F.lz * o];
const atY = (F, o, y) => [F.x + F.lx * o, y, F.z + F.lz * o];
function band(b, A, B, o0, dy0, o1, dy1, n, col, uvs = uv0) {
  b.quad(at(A, o0, dy0), at(A, o1, dy1), at(B, o1, dy1), at(B, o0, dy0), n, uvs, col);
}
const side = (F, sg) => [F.lx * sg, 0, F.lz * sg];
const C = {
  ballast: [0.30, 0.28, 0.25], concrete: [0.50, 0.49, 0.46], concreteD: [0.36, 0.355, 0.34], concreteL: [0.62, 0.61, 0.58],
  railTop: [0.66, 0.66, 0.68], railSide: [0.28, 0.2, 0.15], steel: [0.3, 0.31, 0.32], steelD: [0.16, 0.16, 0.17],
  paving: [0.22, 0.22, 0.23], timber: [0.2, 0.15, 0.11], black: [0.02, 0.02, 0.025], white: [0.9, 0.9, 0.88],
  red: [0.75, 0.04, 0.03], yellow: [0.9, 0.7, 0.05], girder: [0.16, 0.17, 0.18], earth: [0.16, 0.17, 0.09],
};

/** Ballast with timber ties: u across the 3.4 m bed, v along 2.4 m (five ties). */
function bedTexture() {
  const W = 128, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // granite ballast: grey, a little warm, speckled
  g.fillStyle = '#86827a'; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 3600; k++) {
    const v = 82 + rnd() * 90;
    g.fillStyle = `rgb(${v + 4},${v + 1},${v - 4})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2.5, 1 + rnd() * 2);
  }
  // five timber ties a repeat (19.5 in centres, 7 x 9 in), 2.6 m of the 3.4 m bed
  for (let t = 0; t < 5; t++) {
    const y = t * H / 5 + 6, th = H * 0.058;
    const k = 0.8 + rnd() * 0.35;
    g.fillStyle = `rgb(${Math.round(58 * k)},${Math.round(46 * k)},${Math.round(38 * k)})`; g.fillRect(W * 0.12, y, W * 0.76, th);
    g.fillStyle = `rgb(${Math.round(80 * k)},${Math.round(66 * k)},${Math.round(54 * k)})`; g.fillRect(W * 0.12, y, W * 0.76, th * 0.22);
    g.fillStyle = 'rgba(20,16,14,0.6)'; g.fillRect(W * 0.12, y + th * 0.8, W * 0.76, th * 0.2);
    // tie plates under each rail
    for (const u of [0.29, 0.71]) { g.fillStyle = '#3a3531'; g.fillRect(W * u - 7, y + 1, 14, th - 2); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------
// The line

export class Freight {
  /**
   * From the map data alone, right after the map loads: citygen needs
   * clearZones, and the ground must be cut for the bed (carveDepth) before
   * anything reads it -- so the profile, the level crossings (from the raw
   * road graph) and the carve are all settled here.
   */
  constructor(data, md, cache = null) {
    this.data = data;
    const lakes = md ? md.lakes : null;
    const P = { ...FREIGHT, follow: 'mean', meanR: 45, seaFloor: 1.4 };
    // a bridge over water clears it (Salmon Bay's, at the canal's level)
    P.bridgeFloor = (x, z) => (G.isWater(x, z) ? G.drawnWaterLevel(lakes, x, z) + 4.6 : -Infinity);
    this.P = P;
    this.tracks = { sb: new LinkTrack('sb', data.sb, P), nb: new LinkTrack('nb', data.nb, P) };
    this.tracks.sb.other = this.tracks.nb; this.tracks.nb.other = this.tracks.sb;
    for (const tr of Object.values(this.tracks)) tr.zones = [];
    // Where the two tracks are one: runs of the western track within 0.6 m
    // of the eastern. Trains take a section of single track one at a time.
    this.sections = this._shared();
    // the crew-change stop on each track: where the lead locomotive's cab halts
    const y = data.yard;
    this.yard = { name: y.name, x: y.x, z: y.z, s: {} };
    for (const k of ['sb', 'nb']) {
      const q = this.tracks[k].nearest(y.x, y.z, 200);
      this.yard.s[k] = q ? q.s : this.tracks[k].len / 2;
    }
    // The crossings and the profile are deterministic for a build: a later
    // launch restores them from the boot cache; `cacheOut` is this one's.
    this.cacheOut = null;
    const fits = cache && Object.entries(this.tracks).every(([k, tr]) => cache[k] && cache[k].Y.length === tr.n);
    if (fits) {
      for (const [k, tr] of Object.entries(this.tracks)) {
        const q = cache[k];
        tr.Y = q.Y; tr.GR = q.GR; tr.KD = q.KD; tr._X = q.X; tr._XW = q.XW;
      }
    } else {
      this._rawCrossings(md ? md.roads : null);
      for (const tr of Object.values(this.tracks)) {
        tr.setHeights(tr.zones, tr._XW);
        tr.KD = new Uint8Array(tr.n);
      }
      this._joinShared();
      for (const tr of Object.values(this.tracks)) this._kinds(tr);
      this.cacheOut = {};
      for (const [k, tr] of Object.entries(this.tracks)) {
        this.cacheOut[k] = { Y: tr.Y.slice(), GR: tr.GR.slice(), KD: tr.KD.slice(), X: tr._X.slice(), XW: tr._XW.slice() };
      }
    }
    this._carveGrid();
    G.setRailCarve((x, z) => this.carveDepth(x, z), (cx, cz) => this.cvBig.has(Math.floor(cx / 40) * 100003 + Math.floor(cz / 40)));
    this.corrCells = new Set();
    for (const tr of Object.values(this.tracks)) {
      for (let i = 0; i < tr.n; i += 8) {
        if (tr.F[i] === 1) continue;
        const cx = Math.floor(tr.X[i] / 40), cz = Math.floor(tr.Z[i] / 40);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.corrCells.add((cx + dx) * 100003 + cz + dz);
      }
    }
    this.trains = [];
    this.city = null;
    this.camUnder = false;
    this.tunnelMode = false;
    this.chunks = [];
    this.solids = [];
    this.crossings = [];
  }

  _shared() {
    const sb = this.tracks.sb, nb = this.tracks.nb, out = [];
    let run = null;
    for (let i = 0; i < sb.n; i += 2) {
      const q = nb.nearest(sb.X[i], sb.Z[i], 3);
      const on = !!q && q.d < 0.6;
      if (on && !run) run = { a: i, b: i, na: q.s, nb: q.s };
      else if (on) { run.b = i; run.nb = q.s; }
      else if (run) { out.push(run); run = null; }
    }
    if (run) out.push(run);
    return out.filter((r) => r.b - r.a > 60).map((r, id) => ({
      id, sb: [r.a, r.b], nb: [Math.min(r.na, r.nb), Math.max(r.na, r.nb)], owner: null,
    }));
  }

  /**
   * Level crossings from the RAW road graph (the city does not exist yet): a
   * road at ground level whose segment crosses a track. The track is marked
   * `_X` over the road's width at the angle it crosses, `_XW` a few metres
   * further, where the rail comes down to the road.
   */
  _rawCrossings(roads) {
    for (const tr of Object.values(this.tracks)) { tr._X = new Uint8Array(tr.n); tr._XW = new Uint8Array(tr.n); }
    if (!roads) return;
    const { nx, nz, ea, eb, eflags, ehw, edgeCount } = roads;
    for (const tr of Object.values(this.tracks)) {
      // the track as 4 m segments in a 64 m grid
      const cells = new Map(), CELL = 64;
      for (let i = 0; i + 4 < tr.n; i += 4) {
        const k0 = Math.floor(tr.X[i] / CELL) * 100003 + Math.floor(tr.Z[i] / CELL);
        if (!cells.has(k0)) cells.set(k0, []);
        cells.get(k0).push(i);
      }
      for (let e = 0; e < edgeCount; e++) {
        if (eflags[e] & 3) continue;                       // elevated or a tunnel
        const ax = nx[ea[e]], az = nz[ea[e]], bx = nx[eb[e]], bz = nz[eb[e]];
        const c0 = Math.floor(Math.min(ax, bx) / CELL) - 1, c1 = Math.floor(Math.max(ax, bx) / CELL) + 1;
        const d0 = Math.floor(Math.min(az, bz) / CELL) - 1, d1 = Math.floor(Math.max(az, bz) / CELL) + 1;
        if ((c1 - c0) * (d1 - d0) > 400) continue;
        for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
          const l = cells.get(cx * 100003 + cz);
          if (!l) continue;
          for (const i of l) {
            const px = tr.X[i], pz = tr.Z[i], qx = tr.X[i + 4], qz = tr.Z[i + 4];
            // segment intersection
            const rx = bx - ax, rz = bz - az, sx = qx - px, sz = qz - pz;
            const den = rx * sz - rz * sx;
            if (Math.abs(den) < 1e-6) continue;
            const t = ((px - ax) * sz - (pz - az) * sx) / den, u = ((px - ax) * rz - (pz - az) * rx) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            const sinA = Math.abs(den) / (Math.hypot(rx, rz) * Math.hypot(sx, sz));
            if (sinA < 0.3) continue;                        // running alongside, not across
            const m = i + Math.round(u * 4), half = Math.ceil(ehw[e] / sinA) + 1;
            for (let j = Math.max(0, m - half); j <= Math.min(tr.n - 1, m + half); j++) tr._X[j] = 1;
            for (let j = Math.max(0, m - half - 10); j <= Math.min(tr.n - 1, m + half + 10); j++) tr._XW[j] = 1;
          }
        }
      }
    }
  }

  /** Single track is ONE track: the eastern follows the western's profile
   *  there, and eases back to its own over 300 m either side. */
  _joinShared() {
    const sb = this.tracks.sb, nb = this.tracks.nb;
    for (const sc of this.sections) {
      const i0 = nb.idx(sc.nb[0]), i1 = nb.idx(sc.nb[1]);
      let d0 = null, d1 = null;
      for (let i = i0; i <= i1; i++) {
        const q = sb.nearest(nb.X[i], nb.Z[i], 3);
        if (!q) continue;
        const want = sb.y(q.s);
        if (d0 === null) d0 = want - nb.Y[i];
        d1 = want - nb.Y[i];
        nb.Y[i] = want;
      }
      const T = 300;
      for (let k = 1; k <= T; k++) {
        if (d0 !== null && i0 - k >= 0) nb.Y[i0 - k] += d0 * (1 - k / T);
        if (d1 !== null && i1 + k < nb.n) nb.Y[i1 + k] += d1 * (1 - k / T);
      }
    }
  }

  /** Is s on track k inside a single-track section? The section, or null. */
  sectionAt(k, s) {
    for (const sc of this.sections) if (s >= sc[k][0] - 2 && s <= sc[k][1] + 2) return sc;
    return null;
  }

  /**
   * THE GROUND IS CUT FOR THE BED. The freight profile follows the ground's
   * average (link.js setHeights, `follow: 'mean'`), and wherever the raw
   * ground stands above the bed's formation it is cut down to it: flat to
   * FORM_W either side of the centreline (the ballast shoulders stop at 3.6 m,
   * leaving a shallow ditch), then a 1:1 bank up to the ground. At a level
   * crossing the formation is the road's, just under the rail heads. Every
   * consumer of terrainHeight sees it (geo.setRailCarve), and world.js
   * re-tessellates the cells it touches.
   */
  _carveGrid() {
    const P = this.P, FORM_W = 5.5, CELL = 16;
    this.cvCells = new Map(); this.cvBig = new Set();
    const S = [];
    for (const [k, tr] of Object.entries(this.tracks)) {
      for (let i = 0; i < tr.n; i += 2) {
        if (tr.F[i] !== 0) continue;
        if (k === 'nb' && this.sectionAt('nb', i)) continue;
        const kd = tr.KD[i];
        if (kd === TUN || kd === BOX || kd === DECK) continue;
        const fl = tr.Y[i] - (tr._X[i] ? P.liftX + 0.04 : 1.0);
        const h = tr.H[i], lx = Math.cos(h), lz = -Math.sin(h), fx = Math.sin(h), fz = Math.cos(h);
        let hmax = 0;
        for (const o of [-12, -8, -4, 0, 4, 8, 12]) hmax = Math.max(hmax, G.terrainRaw(tr.X[i] + lx * o, tr.Z[i] + lz * o) - fl);
        if (hmax <= 0.02) continue;
        const reach = Math.min(22, FORM_W + hmax + 1.5);
        const id = S.length;
        S.push({ x: tr.X[i], z: tr.Z[i], fl, r: reach, lx, lz, fx, fz });
        const c0 = Math.floor((tr.X[i] - reach) / CELL), c1 = Math.floor((tr.X[i] + reach) / CELL);
        const d0 = Math.floor((tr.Z[i] - reach) / CELL), d1 = Math.floor((tr.Z[i] + reach) / CELL);
        for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
          const kk = cx * 100003 + cz;
          let l = this.cvCells.get(kk);
          if (!l) this.cvCells.set(kk, (l = []));
          l.push(id);
        }
        const b0 = Math.floor((tr.X[i] - reach) / 40), b1 = Math.floor((tr.X[i] + reach) / 40);
        const e0 = Math.floor((tr.Z[i] - reach) / 40), e1 = Math.floor((tr.Z[i] + reach) / 40);
        for (let cx = b0; cx <= b1; cx++) for (let cz = e0; cz <= e1; cz++) this.cvBig.add(cx * 100003 + cz);
      }
    }
    this.cvS = S;
    this.FORM_W = FORM_W;
  }

  /** How far the ground at (x, z) is cut down for the bed (reads terrainRaw only). */
  carveDepth(x, z) {
    const l = this.cvCells.get(Math.floor(x / 16) * 100003 + Math.floor(z / 16));
    if (!l) return 0;
    let best = 0, raw = null;
    const W = this.FORM_W;
    for (let q = 0; q < l.length; q++) {
      const s = this.cvS[l[q]];
      const dx = x - s.x, dz = z - s.z;
      const al = dx * s.fx + dz * s.fz;
      if (al > 1.05 || al < -1.05) continue;
      const d = Math.abs(dx * s.lx + dz * s.lz);
      if (d > s.r) continue;
      if (raw === null) raw = G.terrainRaw(x, z);
      const dep = raw - (s.fl + (d > W ? d - W : 0));
      if (dep > best) best = dep;
    }
    return best;
  }

  /** Oriented rects no building may stand in (citygen): the open corridor. */
  clearZones() {
    const out = [];
    for (const tr of Object.values(this.tracks)) {
      for (let s = 0; s < tr.len; s += 16) {
        const f = tr.flag(s);
        if (f === 1 && tr.kind(s + 8) === TUN) continue;
        out.push({ x: tr.x(s + 8), z: tr.z(s + 8), hw: 6.0, hd: 9.5, rot: -tr.heading(s + 8), y: -1e9 });
      }
    }
    return out;
  }

  /** Is (x, z) on the line's open corridor (no trees, props or parked cars)? */
  keepClear(x, z) {
    if (!this.corrCells.has(Math.floor(x / 40) * 100003 + Math.floor(z / 40))) return false;
    for (const k of ['sb', 'nb']) {
      const tr = this.tracks[k];
      const q = tr.nearest(x, z, 12);
      if (!q) continue;
      if (tr.KD && tr.KD[tr.idx(q.s)] === TUN) continue;
      if (q.d < 5.6) return true;
    }
    return false;
  }

  _kinds(tr) {
    const P = this.P;
    for (let i = 0; i < tr.n; i++) {
      const f = tr.F[i], y = tr.Y[i], g = tr.GR[i];
      if (f === 1) tr.KD[i] = y + P.roofOut < g - 0.4 ? TUN : y - g > 3.4 ? DECK : BOX;
      // only a bridge OSM maps is drawn as one: anything else is an embankment
      else if (f === 2) tr.KD[i] = DECK;
      else tr.KD[i] = tr._X[i] ? CROSS : FILL;
    }
  }

  /** The city is built: the profile over the carved terrain, limits, crossings. */
  attach(city, waterAt) {
    this.city = city;
    this.waterAt = waterAt;
    // the profile stands (the ground was cut to it); what each metre is, over
    // the carved ground
    // (kept by the boot cache, bootcache.js memo: copied in, never aliased)
    for (const [k, tr] of Object.entries(this.tracks)) {
      tr.GR.set(memo(`freight:ground:${k}`, () => {
        const gr = new Float64Array(tr.n);
        for (let i = 0; i < tr.n; i++) gr[i] = G.terrainHeight(tr.X[i], tr.Z[i]);
        return gr;
      }, (v) => v instanceof Float64Array && v.length === tr.n));
      this._kinds(tr);
    }
    const P = this.P;
    for (const [k, tr] of Object.entries(this.tracks)) {
      const n = tr.n, LIM = new Float32Array(n);
      const ys = this.yard.s[k];
      for (let i = 0; i < n; i += 10) {
        let v = P.vMax;
        const kd = tr.KD[i];
        if (kd === TUN || kd === BOX) v = P.vTunnel;
        if (Math.abs(i - ys) < 900) v = Math.min(v, P.vYard);
        let kk = 0;
        for (let j = Math.max(0, i - 20); j <= Math.min(n - 1, i + 20); j++) kk = Math.max(kk, Math.abs(tr.K[j]));
        if (kk > 1e-4) v = Math.min(v, Math.max(5, Math.sqrt(P.aLat / kk)));
        for (let j = i; j < Math.min(n, i + 10); j++) LIM[j] = v;
      }
      tr.LIM = LIM;
    }
    this.gradeCells = new Set();
    for (const tr of Object.values(this.tracks)) {
      for (let i = 0; i < tr.n; i += 8) {
        if (tr.KD[i] !== FILL && tr.KD[i] !== CROSS) continue;
        const cx = Math.floor(tr.X[i] / 50), cz = Math.floor(tr.Z[i] / 50);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.gradeCells.add((cx + dx) * 100003 + cz + dz);
      }
    }
    this._findCrossings();
  }

  /**
   * Level crossings: runs of CROSS on either track, merged where the two
   * tracks cross the same road, each with the road it carries -- which way it
   * runs and how wide -- for its gates.
   */
  _findCrossings() {
    const city = this.city, pts = [];
    for (const [k, tr] of Object.entries(this.tracks)) {
      for (let i = 0; i < tr.n;) {
        if (!tr._X[i]) { i++; continue; }
        let j = i;
        while (j < tr.n && tr._X[j]) j++;
        const m = (i + j - 1) >> 1;
        pts.push({ k, s: m, x: tr.X[m], z: tr.Z[m], h: tr.H[m] });
        i = j;
      }
    }
    const out = [];
    for (const p of pts) {
      let c = out.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 16);
      if (!c) { c = { x: p.x, z: p.z, h: p.h, s: {}, n: 0 }; out.push(c); }
      c.s[p.k] = p.s;
      c.n++;
    }
    for (const c of out) {
      for (const k of ['sb', 'nb']) {
        if (c.s[k] === undefined) {
          const q = this.tracks[k].nearest(c.x, c.z, 14);
          if (q) c.s[k] = q.s;
        }
      }
      // the road: the nearest carriageway crossing the track at 25 deg or more
      let best = null, bd = 1e9;
      for (const ei of city.edgesNear(c.x, c.z, 30)) {
        const e = city.edges[ei];
        if (e.tunnel || e.elev || e.prof) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        const sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz || 1;
        const t = clamp(((c.x - a.x) * sx + (c.z - a.z) * sz) / l2, 0, 1);
        const d = Math.hypot(a.x + sx * t - c.x, a.z + sz * t - c.z);
        const cr = Math.abs(e.dx * Math.cos(c.h) - e.dz * Math.sin(c.h));   // |sin| of the crossing angle
        if (d < e.hw + 2 && cr > 0.42 && d < bd) { bd = d; best = e; }
      }
      c.road = best;
      // the tracks' spread across the crossing (both tracks, or one)
      const q0 = this.tracks.sb.nearest(c.x, c.z, 20), q1 = this.tracks.nb.nearest(c.x, c.z, 20);
      c.spread = q0 && q1 ? Math.hypot(this.tracks.sb.x(q0.s) - this.tracks.nb.x(q1.s), this.tracks.sb.z(q0.s) - this.tracks.nb.z(q1.s)) : 0;
      c.active = false; c.arm = 0; c.flash = 0; c.bellT = 0; c.idleT = 99;
    }
    this.crossings = out.filter((c) => c.road);
    this.crossCells = new Map();
    this.crossings.forEach((c, i) => {
      const cx = Math.floor(c.x / 50), cz = Math.floor(c.z / 50);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const kk = (cx + dx) * 100003 + cz + dz;
        if (!this.crossCells.has(kk)) this.crossCells.set(kk, []);
        this.crossCells.get(kk).push(i);
      }
    });
  }

  // --- the structure ------------------------------------------------------------

  build(scene, world) {
    this.world = world;
    this.scene = scene;
    this.bedMat = new THREE.MeshStandardMaterial({ map: bedTexture(), vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.5 });
    this.cardMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    // LAZY, as Link's (build.js LazyChunks): the pass records, update builds.
    const L = this.lazy = new LazyChunks(CHUNK, (sink) => {
      const mk = (uv) => (sink ? new SinkBuilder() : new ChunkBuilder(uv, 64));
      return { bed: mk(true), flat: mk(false), near: mk(false), tun: mk(false), card: mk(false), dec: mk(true) };
    });
    const chunk = L.record;
    // the eastern track is not drawn where it IS the western (single track)
    for (const [k, tr] of Object.entries(this.tracks)) this._buildTrack(tr, chunk, k === 'nb', null, L);
    L.op({ yard: true });
    this._buildYard(chunk);
    L.op({ bascule: true });
    this._buildBascule(chunk);
    this.crossings.forEach((c, ci) => { L.op({ cross: ci }); this._buildCrossing(c, chunk); });
    L.op(null);
    this.group = new THREE.Group(); this.group.name = 'freight';
    this.tunGroup = new THREE.Group(); this.tunGroup.name = 'freight:bores'; this.tunGroup.visible = false;
    for (const e of L.chunks) {
      e.bed = e.flat = e.near = e.tun = e.card = e.dec = null;
      this.chunks.push(e);
    }
    scene.add(this.group);
    scene.add(this.tunGroup);
    this._buildGateArms(scene);
    if (this.city && this.city.setLandmarkSolids && this.solids.length) {
      this.city.setLandmarkSolids([...(this.city.landmarkSolids || []), ...this.solids]);
    }
  }

  /** What LazyChunks.stream drives (see link.js). The pass's other output --
   *  solids, the yard's slots, the bascule, each crossing's gates -- was kept
   *  at boot; the replay's is thrown away. */
  _lazySys() {
    if (this._sys) return this._sys;
    const parts = ['bed', 'flat', 'near', 'tun', 'card', 'dec'];
    this._sys = {
      run: (o, fn) => {
        const keep = [this.solids, this.yardSlots, this.bascule];
        this.solids = [];
        try {
          if (o.seg) this._buildTrack(this.tracks[o.t], fn, o.t === 'nb', o);
          else if (o.yard) this._buildYard(fn);
          else if (o.bascule) this._buildBascule(fn);
          else if (o.cross !== undefined) {
            const c = this.crossings[o.cross], gates = c.gates;
            try { this._buildCrossing(c, fn); } finally { c.gates = gates; }
          }
        } finally { this.solids = keep[0]; this.yardSlots = keep[1]; this.bascule = keep[2]; }
      },
      finish: (e, B) => {
        const key = e.key, mats = this.world.mats, dec = railDecals();
        const mk = (b, mat, name, shadow, grp) => {
          if (b.empty) return null;
          const m = new THREE.Mesh(b.build(), mat);
          m.name = name; m.castShadow = shadow; m.receiveShadow = shadow;
          m.matrixAutoUpdate = false;
          if (this.dropArrays) dropStaticArrays(m);
          grp.add(m);
          return m;
        };
        e.bed = mk(B.bed, this.bedMat, `freight:bed:${key}`, false, this.group);
        e.flat = mk(B.flat, mats.flat, `freight:${key}`, true, this.group);
        e.near = mk(B.near, mats.flat, `freight:near:${key}`, false, this.group);
        e.tun = mk(B.tun, mats.glow, `freight:bore:${key}`, false, this.tunGroup);
        e.card = mk(B.card, this.cardMat, `freight:mouth:${key}`, false, this.group);
        e.dec = mk(B.dec, dec.mat, `freight:signs:${key}`, false, this.group);
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
        const tm = this.tunnelMode;
        if (e.bed) e.bed.visible = !tm && d < RANGE.bed;
        if (e.flat) e.flat.visible = d < (tm ? 300 : RANGE.flat);
        if (e.near) e.near.visible = !tm && d < RANGE.near;
        if (e.card) e.card.visible = !tm && d < RANGE.flat;
        if (e.dec) e.dec.visible = !tm && d < RANGE.gate + 200;
        if (e.tun) e.tun.visible = d < 900;
      },
    };
    return this._sys;
  }

  /** Every chunk built now (harnesses: geometry hashes). */
  buildAllChunks() { for (const e of this.chunks) if (!e.built) this.lazy.now(e, this._lazySys()); }

  _buildTrack(tr, chunk, skipShared, only = null, L = null) {
    const P = this.P, DS = 4;
    const gauge = P.gauge / 2 + 0.035;
    const segs = Math.ceil(tr.len / DS);
    let pierNext = 0;
    const seg = (k, F0) => {
      const s0 = k * DS, s1 = Math.min(tr.len, s0 + DS), sm = (s0 + s1) / 2;
      const F1 = frame(tr, s1);
      const A = F0, B = F1;
      if (skipShared && this.sectionAt('nb', sm)) return F1;
      const kind = tr.kind(sm);
      if (L) L.segment(tr.key, k, pierNext);
      const c = chunk(tr.x(sm), tr.z(sm));
      const bedB = kind === TUN ? c.tun : c.bed;
      const railB = kind === TUN ? c.tun : c.near;
      const v0 = s0 / 2.4, v1 = s1 / 2.4;
      // --- the bed -----------------------------------------------------------
      if (kind === CROSS) {
        // a level crossing: rubber panels flush with the rail heads
        band(c.flat, A, B, -2.4, -0.03, 2.4, -0.03, UP, C.paving);
        for (const o of [-0.62, 0.62]) band(c.flat, A, B, o - 0.1, -0.025, o + 0.1, -0.025, UP, [0.1, 0.1, 0.1]);
      } else if (kind === TUN) {
        band(bedB, A, B, -1.7, -0.18, 1.7, -0.18, UP, [0.07, 0.066, 0.062]);
        for (let s = Math.ceil(s0 / 0.5) * 0.5; s < s1; s += 0.5) {
          const T = frame(tr, s), T2 = frame(tr, s + 0.22);
          band(bedB, T, T2, -1.3, -0.16, 1.3, -0.16, UP, [0.16, 0.13, 0.1]);
        }
      } else {
        bedB.quad(at(A, -1.7, -0.18), at(A, 1.7, -0.18), at(B, 1.7, -0.18), at(B, -1.7, -0.18), UP, [0, v0, 1, v0, 1, v1, 0, v1], [1, 1, 1]);
        if (kind === FILL || kind === BOX) {
          // Ballast shoulders out to 3.6 m, down to the formation (the ground
          // is cut to 1 m under the rail head there: carveDepth). Where the
          // ground is LOWER than that, an embankment: earth at 1:1.5 down to it.
          for (const sg of [1, -1]) {
            const yA = A.y - 0.62, yB = B.y - 0.62;
            bedB.quad(at(A, 1.7 * sg, -0.18), atY(A, 3.6 * sg, yA), atY(B, 3.6 * sg, yB), at(B, 1.7 * sg, -0.18), [A.lx * sg * 0.3, 1, A.lz * sg * 0.3], [0.02, v0, 0.05, v0, 0.05, v1, 0.02, v1], [0.9, 0.88, 0.84]);
            const gA = G.terrainHeight(A.x + A.lx * 3.6 * sg, A.z + A.lz * 3.6 * sg), gB = G.terrainHeight(B.x + B.lx * 3.6 * sg, B.z + B.lz * 3.6 * sg);
            if (gA < yA - 0.15 || gB < yB - 0.15) {
              const oA = 3.6 + 1.5 * Math.max(0, yA - gA), oB = 3.6 + 1.5 * Math.max(0, yB - gB);
              const tA = G.terrainHeight(A.x + A.lx * oA * sg, A.z + A.lz * oA * sg) - 0.15, tB = G.terrainHeight(B.x + B.lx * oB * sg, B.z + B.lz * oB * sg) - 0.15;
              c.flat.quad(atY(A, 3.6 * sg, yA), atY(B, 3.6 * sg, yB), atY(B, oB * sg, Math.min(tB, yB)), atY(A, oA * sg, Math.min(tA, yA)), [A.lx * sg * 0.55, 1, A.lz * sg * 0.55], uv0, C.earth);
            }
          }
        }
      }
      // --- rails -----------------------------------------------------------------
      for (const o of [-gauge, gauge]) {
        if (kind === CROSS) {
          band(railB, A, B, o - 0.035, 0, o + 0.035, 0, UP, C.railTop);
          continue;
        }
        band(railB, A, B, o - 0.036, 0, o + 0.036, 0, UP, kind === TUN ? [0.45, 0.45, 0.47] : C.railTop);
        for (const sg of [-1, 1]) band(railB, A, B, o + 0.036 * sg, 0, o + 0.075 * sg, -0.18, side(A, sg), kind === TUN ? [0.15, 0.12, 0.1] : C.railSide);
      }
      // --- a bridge: plate girders on concrete piers ------------------------------
      if (kind === DECK) {
        const W = 2.2;
        band(c.flat, A, B, -W, -0.25, W, -0.25, UP, C.timber);
        for (const sg of [-1, 1]) {
          // the girder's web, flanges and the walkway railing
          band(c.flat, A, B, W * sg, -0.25, W * sg, -2.1, side(A, sg), C.girder);
          band(c.flat, A, B, (W - 0.25) * sg, -2.1, (W + 0.25) * sg, -2.1, DOWN, C.girder);
          band(c.flat, A, B, (W - 0.2) * sg, -0.25, (W + 0.2) * sg, -0.25, UP, C.girder);
          band(c.flat, A, B, (W + 0.05) * sg, 0.9, (W + 0.1) * sg, 0.9, UP, C.steel);
          // stiffeners every metre down the web
          for (let s = Math.ceil(s0); s < s1; s += 1.2) {
            const T = frame(tr, s), T2 = frame(tr, s + 0.12);
            band(c.flat, T, T2, (W + 0.03) * sg, -0.3, (W + 0.03) * sg, -2.05, side(T, sg), C.steelD);
          }
          if (Math.floor(s0 / 3) !== Math.floor(s1 / 3)) {
            const T = frame(tr, Math.floor(s1 / 3) * 3);
            c.flat.box(T.x + T.lx * (W + 0.08) * sg, T.y - 0.25, T.z + T.lz * (W + 0.08) * sg, 0.08, 1.15, 0.08, -T.h, C.steel);
          }
        }
        band(c.flat, A, B, -W, -2.1, W, -2.1, DOWN, C.girder);
        // piers every 24 m: a concrete bent down to the water or the ground
        if (sm >= pierNext) {
          pierNext = sm + 24;
          const Pf = frame(tr, sm);
          const wl = this.waterAt ? this.waterAt(Pf.x, Pf.z) : null;
          const base = Math.min(G.terrainHeight(Pf.x, Pf.z), wl !== null ? wl - 3 : Infinity) - 1;
          const top = Pf.y - 2.1;
          if (top - base > 1) {
            c.flat.box(Pf.x, base, Pf.z, 5.4, top - base, 1.8, -Pf.h, C.concrete);
            c.flat.box(Pf.x, top - 0.6, Pf.z, 6.0, 0.6, 2.2, -Pf.h, C.concreteL);
            this.solids.push({ x: Pf.x, z: Pf.z, r: 1.4, y0: base, y1: top });
          }
        }
      }
      // --- the tunnel ------------------------------------------------------------
      if (kind === BOX || kind === TUN) {
        const b = kind === TUN ? c.tun : c.flat;
        const W = P.boreW, H = P.boreH;
        // a century of diesel smoke: the lining is dark, lamp pools every 20 m
        const lit = (s) => { const d = Math.abs(((s % 20) + 20) % 20 - 10) / 10; return 0.45 + 0.55 * d * d; };
        const kA = kind === TUN ? lit(s0) : 1, kB = kind === TUN ? lit(s1) : 1;
        for (const sg of [-1, 1]) {
          const cw = kind === TUN ? [[0.11 * kA, 0.1 * kA, 0.09 * kA], [0.11 * kB, 0.1 * kB, 0.09 * kB], [0.06 * kB, 0.055 * kB, 0.05 * kB], [0.06 * kA, 0.055 * kA, 0.05 * kA]] : C.concreteD;
          b.quad(at(A, W * sg, -0.3), at(B, W * sg, -0.3), at(B, W * sg, H), at(A, W * sg, H), side(A, -sg), uv0, cw);
          band(b, A, B, 2.2 * sg, 0.45, W * sg, 0.45, UP, kind === TUN ? [0.08, 0.075, 0.07] : C.concrete);
          // the floor out to the walkway, and the walkway's face: no gap
          // beside the bed to see the ground (or the sea plane) through
          band(b, A, B, 1.65 * sg, -0.22, 2.2 * sg, -0.22, UP, kind === TUN ? [0.05, 0.048, 0.045] : C.concreteD);
          band(b, A, B, 2.2 * sg, -0.22, 2.2 * sg, 0.45, side(A, -sg), kind === TUN ? [0.07, 0.065, 0.06] : C.concreteD);
        }
        // an arched roof, faceted
        const arch = [[W, H], [W * 0.8, H + 0.7], [W * 0.45, H + 1.05], [0, H + 1.15]];
        for (const sg of [-1, 1]) {
          for (let i = 0; i < arch.length - 1; i++) {
            const [o0, y0] = arch[i], [o1, y1] = arch[i + 1];
            b.quad(at(A, o0 * sg, y0), at(A, o1 * sg, y1), at(B, o1 * sg, y1), at(B, o0 * sg, y0), [0, -1, 0], uv0, kind === TUN ? [0.045, 0.042, 0.04] : C.concreteD);
          }
        }
        if (kind === TUN) {
          const sl = Math.ceil(s0 / 20) * 20;
          if (sl < s1) {
            const T = frame(tr, sl), T2 = frame(tr, sl + 1.2);
            for (const sg of [-1, 1]) band(b, T, T2, (W - 0.02) * sg, 4.2, (W - 0.02) * sg, 4.5, side(T, -sg), [1.0, 0.9, 0.7]);
          }
        } else {
          for (const sg of [-1, 1]) {
            const gA = G.terrainHeight(A.x + A.lx * (W + 0.3) * sg, A.z + A.lz * (W + 0.3) * sg);
            const gB = G.terrainHeight(B.x + B.lx * (W + 0.3) * sg, B.z + B.lz * (W + 0.3) * sg);
            const tA = A.y + P.roofOut, tB = B.y + P.roofOut;
            if (tA > gA || tB > gB) c.flat.quad(atY(A, (W + 0.3) * sg, gA - 0.6), atY(B, (W + 0.3) * sg, gB - 0.6), atY(B, (W + 0.3) * sg, tB), atY(A, (W + 0.3) * sg, tA), side(A, sg), uv0, C.concrete);
          }
          band(c.flat, A, B, -W - 0.3, P.roofOut, W + 0.3, P.roofOut, UP, C.concreteL);
        }
      }
      const kPrev = tr.kind(s0 - 1), kNext = tr.kind(s1 + 1);
      const open = (q) => q === FILL || q === DECK || q === CROSS;
      if (kind === BOX && (open(kPrev) || s0 === 0)) this._portal(tr, s0, c, 1);
      if (kind === BOX && open(kNext)) this._portal(tr, s1, c, -1);
      if (kind === BOX && kNext === TUN) this._card(tr, s1, c, 1);
      if (kind === BOX && kPrev === TUN) this._card(tr, s0, c, -1);
      return F1;
    };
    if (only) {
      for (let i = 0; i < only.k.length; i++) { pierNext = only.st[i]; seg(only.k[i], frame(tr, only.k[i] * DS)); }
      return;
    }
    let F0 = frame(tr, 0);
    for (let k = 0; k < segs; k++) F0 = seg(k, F0);
  }

  /** The Great Northern Tunnel's portal: a stone face round an arched mouth. */
  _portal(tr, s, c, dirIn) {
    const P = this.P, F = frame(tr, s), W = P.boreW + 0.3;
    const n = [-F.fx * dirIn, 0, -F.fz * dirIn];
    const gy = Math.min(G.terrainHeight(F.x, F.z), F.y - 0.4);
    const top = F.y + P.roofOut + 1.2, w = W + 2.4;
    const q = (o0, y0, o1, y1, col = C.concreteL) => c.flat.quad(atY(F, o0, y0), atY(F, o1, y0), atY(F, o1, y1), atY(F, o0, y1), n, uv0, col);
    q(-w, gy - 0.5, -W, top); q(W, gy - 0.5, w, top); q(-W, F.y + P.boreH + 1.15, W, top);
    // the arch ring and a date stone
    q(-W, F.y + P.boreH, -W + 0.5, F.y + P.boreH + 1.15, C.concrete); q(W - 0.5, F.y + P.boreH, W, F.y + P.boreH + 1.15, C.concrete);
    q(-0.9, top - 1.0, 0.9, top - 0.35, [0.7, 0.68, 0.62]);
  }
  _card(tr, s, c, dirIn) {
    const P = this.P, F = frame(tr, s), W = P.boreW;
    const n = [-F.fx * dirIn, 0, -F.fz * dirIn];
    c.card.quad(at(F, -W, -0.4), at(F, W, -0.4), at(F, W, P.boreH + 1.15), at(F, -W, P.boreH + 1.15), n, uv0, [0, 0, 0]);
  }

  /**
   * THE SALMON BAY BRIDGE: a Strauss heel-trunnion bascule (1914) -- its
   * steel tower straddling both tracks at the channel's south side, the huge
   * concrete counterweight riding high over the rails on its arm. The leaf is
   * down (the line is open); the tower is the bridge you recognise.
   */
  _buildBascule(chunk) {
    const tr = this.tracks.sb, nb = this.tracks.nb;
    // the longest bridge, and the deepest water under it
    let br = null, run = null;
    for (let i = 0; i < tr.n; i++) {
      const on = tr.KD[i] === DECK;
      if (on && !run) run = [i, i]; else if (on) run[1] = i;
      else if (run) { if (!br || run[1] - run[0] > br[1] - br[0]) br = run; run = null; }
    }
    if (!br || br[1] - br[0] < 200) return;
    let best = -1, bd = -Infinity;
    for (let i = br[0] + 30; i < br[1] - 30; i += 4) {
      const d = (this.waterAt ? this.waterAt(tr.X[i], tr.Z[i]) || 0 : 0) - G.terrainRaw(tr.X[i], tr.Z[i]);
      if (d > bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    const s = best + 18;                       // the tower stands on the channel's far pier
    const F = frame(tr, s);
    const q = nb.nearest(F.x, F.z, 20);
    const mid = q ? ((nb.x(q.s) - F.x) * F.lx + (nb.z(q.s) - F.z) * F.lz) / 2 : 0;
    const c = chunk(F.x, F.z);
    const cx = F.x + F.lx * mid, cz = F.z + F.lz * mid, y0 = F.y - 2.1;
    const halfW = Math.abs(mid) + 3.8, halfL = 5.5, top = F.y + 26;
    const col = [0.14, 0.15, 0.16], rust = [0.22, 0.14, 0.1], conc = [0.52, 0.51, 0.47];
    const P = (u, v, y) => [cx + F.lx * u + F.fx * v, y, cz + F.lz * u + F.fz * v];
    // four legs, raking in toward the top
    const legs = [];
    for (const u of [-1, 1]) for (const v of [-1, 1]) {
      const a = P(u * halfW, v * halfL, y0), b = P(u * (halfW - 1.2), v * (halfL - 1.5), top);
      c.flat.tube(a, b, 0.42, 6, col, true);
      legs.push([a, b]);
    }
    // cross bracing on every face, and struts
    const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const faces = [[0, 1], [2, 3], [0, 2], [1, 3]];
    for (const [i, j] of faces) {
      for (let k = 0; k < 3; k++) {
        const t0 = 0.25 + k * 0.25, t1 = t0 + 0.25;
        c.flat.tube(lerp3(legs[i][0], legs[i][1], t0), lerp3(legs[j][0], legs[j][1], t1), 0.14, 4, col);
        c.flat.tube(lerp3(legs[j][0], legs[j][1], t0), lerp3(legs[i][0], legs[i][1], t1), 0.14, 4, col);
        c.flat.tube(lerp3(legs[i][0], legs[i][1], t1), lerp3(legs[j][0], legs[j][1], t1), 0.18, 4, col);
      }
    }
    // the trunnion girders across the top, the counterweight arm, the block
    c.flat.box(cx, top - 0.3, cz, (halfW - 1.2) * 2 + 1.2, 1.4, 3.4, -F.h, rust);
    const cw = P(0, -halfL - 3.5, top + 1.2);
    c.flat.box(cw[0], top + 0.9, cw[2], (halfW - 1.2) * 2 + 0.6, 1.0, 9.5, -F.h, rust);
    c.flat.box(cw[0], top + 1.9, cw[2], (halfW - 1.2) * 2 - 0.6, 7.2, 9.0, -F.h, conc);
    // the operator's house on the tower
    const hs = P(halfW - 1.6, 0, top - 7);
    c.flat.box(hs[0], top - 7, hs[2], 3.2, 3.0, 4.2, -F.h, [0.55, 0.5, 0.42]);
    this.bascule = { x: cx, z: cz, y: top };
  }

  /** Balmer Yard's own tracks (drawn, not run on) and the cuts standing on them. */
  _buildYard(chunk) {
    const yt = this.data.yardTracks || [];
    const gauge = this.P.gauge / 2 + 0.035;
    const ys = (x, z) => G.terrainHeight(x, z) + 0.42;
    this.yardSlots = [];
    for (const pts of yt) {
      let acc = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.5) continue;
        // skip a piece that lies on a main track (a switch's shared stretch)
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const onMain = ['sb', 'nb'].some((k) => { const q = this.tracks[k].nearest(mx, mz, 3); return q && q.d < 2.6; });
        if (onMain || this.city.onRoad(mx, mz, 0, false, false)) { acc += L; continue; }
        const h = Math.atan2(bx - ax, bz - az), lx = Math.cos(h), lz = -Math.sin(h);
        const c = chunk(mx, mz);
        const A = { x: ax, z: az, y: ys(ax, az), lx, lz }, B = { x: bx, z: bz, y: ys(bx, bz), lx, lz };
        const v0 = acc / 2.4, v1 = (acc + L) / 2.4;
        c.bed.quad(at(A, -1.7, -0.16), at(A, 1.7, -0.16), at(B, 1.7, -0.16), at(B, -1.7, -0.16), UP, [0, v0, 1, v0, 1, v1, 0, v1], [0.92, 0.9, 0.86]);
        for (const o of [-gauge, gauge]) {
          band(c.near, A, B, o - 0.035, 0, o + 0.035, 0, UP, C.railTop);
          for (const sg of [-1, 1]) band(c.near, A, B, o + 0.035 * sg, 0, o + 0.07 * sg, -0.16, [lx * sg, 0, lz * sg], C.railSide);
        }
        acc += L;
      }
      // a long straight-ish yard track gets a cut of cars
      const len = pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);
      if (len > 160) this.yardSlots.push({ pts, len });
    }
  }

  /** A crossing's gates, lights and crossbucks (static parts), and its arms' pivots. */
  _buildCrossing(c, chunk) {
    const e = c.road, ch = chunk(c.x, c.z);
    const rdx = e.dx, rdz = e.dz;
    const tdx = Math.sin(c.h), tdz = Math.cos(c.h);
    const sinA = Math.abs(rdx * tdz - rdz * tdx) || 1;
    const clear = (c.spread / 2 + 4.2) / sinA;
    const hw = e.hw;
    const cells = railDecals().cells;
    c.gates = [];
    for (const a of [1, -1]) {
      // traffic coming toward the tracks from +a along the road keeps right:
      // its gate stands at its right kerb and its arm reaches the centreline
      const hx = -a * rdx, hz = -a * rdz;
      const rx = -hz, rz = hx;          // right of a car heading (hx, hz)
      const mx = c.x + a * rdx * clear + rx * (hw + 0.9), mz = c.z + a * rdz * clear + rz * (hw + 0.9);
      const gy = G.terrainHeight(mx, mz) + 0.3;
      const cw = 0.14;
      // the mast, the light heads on their cross arm, the crossbuck, the bell
      ch.flat.box(mx, gy, mz, 0.2, 4.3, 0.2, 0, C.white);
      ch.flat.box(mx, gy, mz, 0.6, 0.35, 0.6, 0, C.concrete);
      const face = Math.atan2(-hx, -hz);                 // the lights face the traffic
      const fx = -hx, fz = -hz;
      for (const s of [1, -1]) {
        const lx = mx + rz * 0 + Math.cos(face) * 0.38 * s, lz = mz - Math.sin(face) * 0.38 * s;
        ch.flat.box(lx, gy + 2.55, lz, 0.36, 0.36, 0.12, -face, C.black);
        // visors
        ch.flat.box(lx + fx * 0.12, gy + 2.86, lz + fz * 0.12, 0.34, 0.03, 0.2, -face, C.black);
      }
      ch.flat.box(mx, gy + 2.72, mz, 1.0, 0.06, 0.06, -face, C.black);
      // the crossbuck: two boards in an X, facing the traffic
      for (const [cell, rot] of [['xbuck', 0.785], ['xbuck2', -0.785]]) {
        const cl = cells[cell];
        const cx = mx + fx * 0.14, cz = mz + fz * 0.14, cy = gy + 3.7;
        const ux = Math.cos(face), uz = -Math.sin(face);
        const w = 1.22, h = 0.23, ca = Math.cos(rot), sa = Math.sin(rot);
        const P = (u, v) => [cx + ux * (u * ca - v * sa), cy + (u * sa + v * ca), cz + uz * (u * ca - v * sa)];
        ch.dec.quad(P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2), [fx, 0, fz], [cl[0], cl[1], cl[2], cl[1], cl[2], cl[3], cl[0], cl[3]], [1, 1, 1]);
      }
      // the gate mechanism box and its counterweight side
      ch.flat.box(mx - rx * 0.3, gy + 0.7, mz - rz * 0.3, 0.45, 0.8, 0.45, 0, C.steelD);
      this.solids.push({ x: mx, z: mz, r: 0.35, y0: gy, y1: gy + 4.3 });
      // the arm: from the pivot across the approach, to the centreline
      const len = Math.max(3, hw + 0.4);
      c.gates.push({ px: mx - rx * 0.3, py: gy + 1.1, pz: mz - rz * 0.3, dx: -rx, dz: -rz, len, lx: mx, ly: gy + 2.55, lz: mz, face });
    }
  }

  /** Every gate arm and lamp in one instanced draw each; posed per frame near you. */
  _buildGateArms(scene) {
    const n = this.crossings.reduce((a, c) => a + c.gates.length, 0);
    if (!n) return;
    // a unit arm along +x: striped red and white, with lamps along it
    const b = new Builder(false);
    const N = 8;
    for (let i = 0; i < N; i++) b.box((i + 0.5) / N, -0.05, 0, 1 / N, 0.1, 0.1, 0, i % 2 ? C.red : C.white);
    b.box(-0.08, -0.12, 0, 0.16, 0.24, 0.22, 0, C.steelD);
    const geo = b.build();
    this.armMesh = new THREE.InstancedMesh(geo, this.world.mats.flat, n);
    this.armMesh.name = 'freight:gates';
    this.armMesh.frustumCulled = false;
    this.armMesh.count = 0;
    scene.add(this.armMesh);
    const lb = new Builder(false);
    lb.box(0, -0.13, 0, 0.26, 0.26, 0.04, 0, [1.0, 0.1, 0.05]);
    this.lampMesh = new THREE.InstancedMesh(lb.build(), this.world.mats.glow, n * 2);
    this.lampMesh.name = 'freight:lamps';
    this.lampMesh.frustumCulled = false;
    this.lampMesh.count = 0;
    scene.add(this.lampMesh);
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YZX');
    this._v = new THREE.Vector3(); this._sc = new THREE.Vector3();
  }

  // --- trains -------------------------------------------------------------------

  makeTrains(scene) {
    const A = vehicleAssets();
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.55, envMapIntensity: 1.0 });
    this.trimMat = A.trimMat;
    this.decMat = railDecals().mat;
    CONSISTS.forEach((cons, i) => {
      const tr = i === 0 ? this.tracks.sb : this.tracks.nb;
      const t = new FreightTrain(this, i, tr, cons);
      this.trains.push(t);
      scene.add(t.group);
    });
    // the western train waits at Balmer Yard for you; the other is out on the line
    const a = this.trains[0], b = this.trains[1];
    a.place(this.yardStopS(a), a.track.dir);
    a.state = 'dwell'; a.timer = FREIGHT.dwell; a.yardDone = true; a.atYard = true;
    b.place(clamp(b.track.len * 0.3, b.len, b.track.len - b.len), b.track.dir);
    b.state = 'run';
    for (const t of this.trains) t.group.visible = false;
    this._buildYardCuts(scene);
    return this.trains;
  }

  /** The static cuts of cars on Balmer Yard's tracks: one merged mesh per material. */
  _buildYardCuts(scene) {
    const slots = (this.yardSlots || []).sort((p, q) => q.len - p.len).slice(0, YARD_CUTS.length);
    if (!slots.length) return;
    const parts = { body: [], trim: [], decal: [] };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const cutSolids = [];
    const pointAt = (pts, d) => {
      let acc = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        if (acc + L >= d) { const t = (d - acc) / L; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; }
        acc += L;
      }
      return pts[pts.length - 1];
    };
    slots.forEach((sl, k) => {
      // centred on the track, so the cuts stand round the crew-change stop
      const cutLen = YARD_CUTS[k].reduce((a, ty) => a + railCar(ty).L + 0.15, 0);
      let d = Math.max(30, (sl.len - cutLen) / 2);
      for (const type of YARD_CUTS[k]) {
        const car = railCar(type);
        if (d + car.L > sl.len - 20) break;
        const f = pointAt(sl.pts, d + car.L / 2 + car.truckC), r = pointAt(sl.pts, d + car.L / 2 - car.truckC);
        const cx = (f[0] + r[0]) / 2, cz = (f[1] + r[1]) / 2;
        const yy = G.terrainHeight(cx, cz) + 0.42;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f[0] - r[0], f[1] - r[1]));
        p.set(cx, yy, cz);
        m.compose(p, q, sc);
        for (const key of ['body', 'trim', 'decal']) { const g = car[key].clone(); g.applyMatrix4(m); parts[key].push(g); }
        // a standing car is solid (citygen's box: u along the car)
        const yaw = Math.atan2(f[0] - r[0], f[1] - r[1]);
        cutSolids.push({ x: cx, z: cz, hw: car.L / 2, hd: 1.62, rot: Math.PI / 2 - yaw, y0: yy, y1: yy + car.h });
        d += car.L + 0.15;
      }
    });
    const merge = (list) => {
      if (!list.length) return null;
      let nv = 0, ni = 0;
      for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
      const hasUV = !!list[0].attributes.uv;
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = hasUV ? new Float32Array(nv * 2) : null;
      const idx = new Uint32Array(ni);
      let v = 0, o = 0;
      for (const g of list) {
        pos.set(g.attributes.position.array, v * 3); nor.set(g.attributes.normal.array, v * 3); col.set(g.attributes.color.array, v * 3);
        if (uv) uv.set(g.attributes.uv.array, v * 2);
        const I = g.index.array;
        for (let i = 0; i < I.length; i++) idx[o + i] = I[i] + v;
        v += g.attributes.position.count; o += I.length;
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      return geo;
    };
    this.yardGroup = new THREE.Group(); this.yardGroup.name = 'freight:yard';
    for (const [key, mat] of [['body', this.bodyMat], ['trim', this.trimMat], ['decal', this.decMat]]) {
      const g = merge(parts[key]);
      if (!g) continue;
      if (key === 'trim') tagGlass(g);
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = key === 'body'; mesh.receiveShadow = true;
      this.yardGroup.add(mesh);
    }
    scene.add(this.yardGroup);
    if (this.city && this.city.setLandmarkSolids && cutSolids.length) {
      this.city.setLandmarkSolids([...(this.city.landmarkSolids || []), ...cutSolids]);
    }
  }

  /** Where a train's centre stands for its lead cab to halt at the yard. */
  yardStopS(t) {
    const ys = this.yard.s[t.track.key];
    return ys - t.dir * (t.len / 2 - 4.5);
  }

  bind(o) { Object.assign(this, { game: o.game, hud: o.hud, audio: o.audio, player: o.player }); }
  say(txt, ms) { if (this.hud) this.hud.showToast(txt, ms); }

  /** The train on `t`'s track whose tail is next ahead of it. */
  ahead(t) {
    let best = null, bd = Infinity;
    for (const o of this.trains) {
      if (o === t || o.track !== t.track || o.state === 'off') continue;
      const d = (o.s - t.s) * t.dir;
      if (d > 0 && d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /** Does any train other than `t` occupy section `sc`? */
  occupied(sc, t) {
    for (const o of this.trains) {
      if (o === t || o.state === 'off') continue;
      const k = o.track.key, lo = Math.min(o.lead, o.tail), hi = Math.max(o.lead, o.tail);
      if (hi >= sc[k][0] - 5 && lo <= sc[k][1] + 5) return o;
    }
    return null;
  }

  /** May `t` enter section `sc`? Reserves it for `t` if so. */
  reserve(sc, t) {
    if (sc.owner && sc.owner !== t && sc.owner.state !== 'off') {
      // a reservation lapses once its train is gone from the section and past it
      const o = sc.owner, k = o.track.key;
      const lo = Math.min(o.lead, o.tail), hi = Math.max(o.lead, o.tail);
      const inside = hi >= sc[k][0] - 5 && lo <= sc[k][1] + 5;
      const coming = (sc[k][0] - o.lead) * o.dir > 0 || (sc[k][1] - o.lead) * o.dir > 0;
      if (inside || (coming && o.wantSec === sc)) return false;
      sc.owner = null;
    }
    const occ = this.occupied(sc, t);
    if (occ) return false;
    sc.owner = t;
    return true;
  }

  update(dt, camera) {
    if (!this.trains.length) return;
    const p = this.player, pv = p && p.vehicle;
    const driving = pv && pv.spec && pv.spec.freight;
    for (const t of this.trains) {
      if (t.driver === 'player') continue;
      let left = dt;
      while (left > 1e-6) { const h = Math.min(0.1, left); t.service(h); left -= h; }
    }
    this.tunnelMode = !!(driving && this.camUnder);
    if (!driving) this.camUnder = false;
    this.tunGroup.visible = this.tunnelMode;
    const cx = camera.position.x, cz = camera.position.z;
    const tm = this.tunnelMode;
    // the structure streams, as Link's (build.js LazyChunks)
    const BUILD_R = Math.max(RANGE.flat, 900) + 300;
    this.lazy.stream(cx, cz, RANGE.near + 200, BUILD_R, BUILD_R + 700, CHUNK * 0.71, ON_PHONE ? 1.5 : 3, this._lazySys());
    if (this.yardGroup) this.yardGroup.visible = !tm && Math.hypot(this.yard.x - cx, this.yard.z - cz) < RANGE.yard + 400;
    for (const t of this.trains) {
      const d = t.distTo(cx, cz);
      const vis = t.state !== 'off' && (t.driver === 'player' || (d < RANGE.train && (tm ? d < 900 : !t.buried())));
      t.group.visible = vis;
      if (vis) { t.ensureGeometry(); t.pose(); }
      // its geometry is made a slice a frame on the way in (see _build)
      else if (!t._geoReady && d < RANGE.train + 1500) t.stepGeometry(ON_PHONE ? 1.5 : 3);
    }
    this._crossingsUpdate(dt, cx, cz);
    const pd = this.pending;
    if (pd && p) {
      if (!p.onFoot || Math.hypot(p.position.x - this.yard.x, p.position.z - this.yard.z) > 120 || performance.now() - pd.at > 300000) this.pending = null;
    }
    if (p) this._guard(dt, p);
    if (driving && this.hud) {
      this._hudT = (this._hudT || 0) - dt;
      if (this._hudT <= 0) { this._hudT = 0.25; this.hud.setObjective(pv.readout()); }
    }
  }

  /** Gates down for any train near: arms, lamps, the bell. */
  _crossingsUpdate(dt, cx, cz) {
    let nArm = 0, nLamp = 0;
    const m = this._m4, q = this._q, e = this._e, v = this._v, scl = this._sc;
    for (const c of this.crossings) {
      // active: a train will be here within ~25 s, or is on it now
      let act = false;
      for (const t of this.trains) {
        if (t.state === 'off') continue;
        const s = c.s[t.track.key];
        if (s === undefined) continue;
        const ahead = (s - t.lead) * t.dir;           // metres in front of its nose
        const behindTail = (s - t.tail) * t.dir;
        const sp = Math.abs(t.u);
        if (ahead > -2 && ahead < Math.max(120, sp * 25)) { act = true; break; }
        if (ahead <= 0 && behindTail >= -6) { act = true; break; }
      }
      c.active = act;
      c.idleT = act ? 0 : c.idleT + dt;
      // the arms come down over ~7 s once the lights have flashed for 3, go up in 5
      c.lightT = act ? (c.lightT || 0) + dt : 0;
      const want = act && c.lightT > 3 ? 1 : 0;
      c.arm = want ? Math.min(1, c.arm + dt / 7) : Math.max(0, c.arm - dt / 5);
      const near = Math.hypot(c.x - cx, c.z - cz) < RANGE.gate;
      if (!near || !this.armMesh) continue;
      const flashing = act || c.arm > 0.02;
      c.flash = (c.flash + dt * 1.6) % 2;
      for (const g of c.gates) {
        // the arm pivots about the horizontal axis across the road; up is near vertical
        const ang = (1 - c.arm) * 1.48;
        const yaw = Math.atan2(g.dx, g.dz) - Math.PI / 2;
        e.set(0, yaw, ang);
        q.setFromEuler(e);
        scl.set(g.len, 1, 1);
        v.set(g.px, g.py, g.pz);
        m.compose(v, q, scl);
        this.armMesh.setMatrixAt(nArm++, m);
        if (flashing) {
          // two lamps, alternating
          const on = c.flash < 1 ? 0 : 1;
          const s = on ? 1 : -1;
          const lx = g.lx + Math.cos(g.face) * 0.38 * s, lz = g.lz - Math.sin(g.face) * 0.38 * s;
          const fx = Math.sin(g.face + Math.PI), fz = Math.cos(g.face + Math.PI);
          q.setFromAxisAngle(this._up || (this._up = new THREE.Vector3(0, 1, 0)), g.face);
          scl.set(1, 1, 1);
          v.set(lx - fx * -0.07, g.ly + 0.18, lz - fz * -0.07);
          m.compose(v, q, scl);
          this.lampMesh.setMatrixAt(nLamp++, m);
        }
      }
      // the crossing bell while the lights flash, if you are near
      if (flashing && this.audio && this.audio.ready) {
        c.bellT -= dt;
        if (c.bellT <= 0) {
          c.bellT = 0.52;
          const d = Math.hypot(c.x - cx, c.z - cz);
          if (d < 170) this.audio.play('xing_bell', { gain: 0.55, x: c.x, y: G.terrainHeight(c.x, c.z) + 3, z: c.z, ref: 10, maxD: 200, jitter: false });
        }
      }
    }
    if (this.armMesh) {
      this.armMesh.count = nArm; this.armMesh.instanceMatrix.needsUpdate = true;
      this.lampMesh.count = nLamp; this.lampMesh.instanceMatrix.needsUpdate = true;
    }
  }

  onGradeCorridor(x, z) {
    return !!this.gradeCells && this.gradeCells.has(Math.floor(x / 50) * 100003 + Math.floor(z / 50));
  }

  /**
   * For traffic.js: is (x, z) inside a crossing whose gates are coming down
   * (or a train is on it)? A car stops at the arm, not on the tracks.
   */
  blocks(x, z, y) {
    if (!this.crossCells) return false;
    const l = this.crossCells.get(Math.floor(x / 50) * 100003 + Math.floor(z / 50));
    if (!l) return false;
    for (const i of l) {
      const c = this.crossings[i];
      if (!c.active && c.arm < 0.05) continue;
      if (Math.hypot(x - c.x, z - c.z) > 30) continue;
      // within the gates: across the tracks' spread plus the gate setback
      const dx = x - c.x, dz = z - c.z;
      const perp = Math.abs(dx * Math.cos(c.h) - dz * Math.sin(c.h));
      if (perp < c.spread / 2 + 4.6) return true;
    }
    return false;
  }

  /** The track at grade: a freight brakes for you and cannot stop in time. */
  _guard(dt, p) {
    const pv = p.vehicle;
    if (pv && pv.spec.rail) return;
    const x = p.position.x, z = p.position.z;
    if (!this.onGradeCorridor(x, z)) return;
    const rad = pv ? pv.halfWid * 0.9 + 0.3 : 0.35;
    for (const k of ['sb', 'nb']) {
      const tr = this.tracks[k];
      const q = tr.nearest(x, z, 8);
      if (!q) continue;
      const ki = tr.KD[tr.idx(q.s)];
      if (ki !== FILL && ki !== CROSS) continue;
      if (Math.abs((pv ? pv.y : p.y) - tr.y(q.s)) > 2.5) continue;
      const foul = q.d < 1.6 + rad + 0.3;
      for (const t of this.trains) {
        if (t.track !== tr || t.state === 'off' || t.driver === 'player') continue;
        const ahead = (q.s - t.lead) * t.dir;
        const within = (q.s - t.tail) * t.dir > -1 && ahead < 1;
        // a freight cannot stop for you: it blows for you from a long way off,
        // and throws the brakes on once you are inside its stopping distance
        if (foul && ahead > 0 && ahead < Math.max(300, Math.abs(t.u) * 25)) t.warn();
        if (foul && ahead > 0 && ahead < 60 + t.u * t.u / (2 * 0.9) * 1.3) t.obstruct(ahead);
        if (foul && within && Math.abs(t.u) > 0.3) {
          const h = tr.H[tr.idx(q.s)], lx = Math.cos(h), lz = -Math.sin(h);
          const push = 1.6 + rad + 0.4 - q.d;
          const sp = Math.abs(t.u);
          if (this._hitCd > 0) continue;
          this._hitCd = 1;
          if (pv) {
            pv.x += lx * q.side * push; pv.z += lz * q.side * push;
            pv.vLong *= 0.2;
            if (this.game) { this.game.onCrash(sp * 4, false); this.game.damagePlayer(sp * 6, 'crash'); }
            if (pv.damage) pv.damage(sp * 10, true);
            this.say('Hit by a freight train!');
          } else {
            p.x += lx * q.side * push; p.z += lz * q.side * push;
            if (this.game) { this.game.onCrash(sp * 3, false); if (sp > 1) this.game.damagePlayer(sp * 9, 'crash'); }
          }
        }
      }
    }
    this._hitCd = (this._hitCd || 0) - dt;
  }

  /** A train you can climb into from here: stopped, you beside its lead cab. */
  boardable(x, y, z) {
    for (const t of this.trains) {
      if (t.driver || t.state === 'off' || Math.abs(t.u) > 0.15) continue;
      const cab = t.cabPoint();
      if (Math.hypot(cab.x - x, cab.z - z) < 11 && Math.abs(cab.y - y) < 4) return t;
    }
    return null;
  }

  /** ENTER at Balmer Yard with no train in: bring the next one in. */
  onWait(x, z) {
    if (Math.hypot(x - this.yard.x, z - this.yard.z) > 45) return false;
    let best = null;
    for (const t of this.trains) {
      if (t.driver) continue;
      const d = t.state === 'off' ? 1e9 : (this.yardStopS(t) - t.s) * t.dir;
      if (t.state === 'dwell' && t.atYard) { this.say('The freight is in — climb up at the lead locomotive\'s cab (ENTER)'); return true; }
      if (d > 0 && (!best || d < best.d)) best = { t, d };
    }
    if (!best) {
      // nothing coming toward the yard: bring back whichever is off the map or past it
      const t = this.trains.find((q) => !q.driver);
      if (!t) return false;
      best = { t, d: 1e9 };
    }
    const t = best.t;
    if (best.d > 1100 || t.state === 'off') {
      // skip the wait: up the line to ~900 m short of the yard, if it is clear
      const tr = t.track, ys = this.yardStopS(t);
      const s = ys - t.dir * 900;
      const busy = this.trains.some((o) => o !== t && o.track === tr && o.state !== 'off' && Math.abs(o.s - s) < t.len + 300);
      const sec = this.sectionAt(tr.key, s);
      if (!busy && !(sec && this.occupied(sec, t)) && s > t.len / 2 && s < tr.len - t.len / 2) {
        t.place(s, tr.dir); t.state = 'run'; t.u = tr.dir * 10; t.yardDone = false; t.atYard = false;
      }
    }
    this.pending = { t, at: performance.now() };
    this.say('A freight is coming into Balmer Yard for a crew change — wait by the tracks and climb up at the cab', 5200);
    return true;
  }

  /** Where you step down: beside the cab, off the track, on the ground -- or null. */
  exitSpot(t) {
    if (Math.abs(t.u) > 0.3) return null;
    const tr = t.track, s = t.lead - t.dir * 4.5;
    const kd = tr.kind(s);
    if (kd !== FILL && kd !== CROSS) return null;
    const F = frame(tr, s);
    // the side away from the other track
    const q = tr.other.nearest(F.x, F.z, 20);
    let sg = 1;
    if (q && q.d < 12) sg = ((tr.other.x(q.s) - F.x) * F.lx + (tr.other.z(q.s) - F.z) * F.lz) > 0 ? -1 : 1;
    const x = F.x + F.lx * 3.6 * sg, z = F.z + F.lz * 3.6 * sg;
    return { x, z, y: G.terrainHeight(x, z) };
  }
  get noExitMsg() { return 'Stop somewhere you can climb down — not on the bridge or in the tunnel'; }

  onBoard(t) {
    t.driver = 'player';
    t.mode = 'free';
    t.notch = 0;
    t.warned = 0;
    t.hornedFor = new Set();
    this.pending = null;
    this._objBefore = this.hud ? this.hud.objective.textContent : '';
    const to = t.dir > 0 ? 'south to SODO and Tukwila' : 'north to Ballard and Everett';
    this.say(`${t.name} — you have the train, ${to}. Hold POWER to notch up, BRAKE for the air (tap it twice for emergency), HORN at every crossing`, 6000);
    if (this.audio && this.audio.ready) this.audio.play('airbrake', { gain: 0.5 });
  }
  onLeave(t) {
    t.resume();
    if (this.hud) this.hud.setObjective(this._objBefore || '');
    this.camUnder = false;
  }
  onCollide(t, speed) {
    this.say(`Collision at ${Math.round(speed * 2.237)} mph!`);
    if (this.game) { this.game.onCrash(speed * 3, false); this.game.damagePlayer(speed * 5, 'crash'); }
  }
  onEnd(t) {
    this.say('End of the map — the line runs on. POWER at a stand to change ends and take the other main back', 4200);
  }
}

// ---------------------------------------------------------------------------
// A train

export class FreightTrain {
  constructor(sys, id, track, consist) {
    this.sys = sys;
    this.id = id;
    this.track = track;
    this.typeName = 'freight';
    this.consist = consist;
    // cars, lead first: each car's centre as an offset back from the lead
    this.cars = [];
    let off = 0, mass = 0, locos = 0;
    for (const type of consist) {
      const c = railCar(type);
      this.cars.push({ type, L: c.L, truckC: c.truckC, off: off + c.L / 2, loco: c.kind === 'loco' });
      off += c.L + 0.12;
      mass += c.mass;
      if (c.kind === 'loco') locos++;
    }
    this.len = off - 0.12;
    this.mass = mass * 1000;
    this.locos = locos;
    const lead = consist[0];
    this.name = lead.startsWith('cn') ? `CN ${lead.slice(2)}` : `BNSF ${lead.slice(4)}`;
    this.spec = { rail: true, freight: true, hand: 'freight', engine: 'gevo', len: 22, wid: 3.1, roof: 4.8,
      topKph: FREIGHT.vMax * 3.6, mass: this.mass / 1000 };
    this.x = 0; this.y = 0; this.z = 0; this.heading = 0; this.cx = 0; this.cz = 0;
    this.vLong = 0; this.vLat = 0; this.vy = 0; this.speed = 0;
    this.halfLen = 3; this.halfWid = 1.6; this.radius = 3;
    this.health = 100; this.dead = false; this.exploded = false;
    this.mode = 'service'; this.wasParked = false;
    this.skid = 0; this.airborne = false; this.stunt = false; this.stuntLaunch = null;
    this.rampAlong = 0; this.latAcc = 0; this.accLong = 0; this.hitCd = 0;
    this._fwd = { x: 0, z: 1 };
    this.s = 0; this.u = 0; this.dir = track.dir;
    this.notch = 0; this.brakeCmd = 0; this.brakeCyl = 0; this.emerg = false; this.rev = false;
    this.driver = null;
    this.state = 'run'; this.timer = 0; this.offT = 0; this.held = 0;
    this.yardDone = false; this.atYard = false; this.wantSec = null;
    this.obstructAt = Infinity; this.warned = 0; this._notchT = 0; this._brkT = 0; this._revT = 0;
    this.horn = { seq: null, t: 0, on: false, forS: null };
    this.hornOn = false; this.bellOn = false; this.bellT = 0;
    this._build();
  }

  _build() {
    const sys = this.sys;
    // The whole train's geometry (~8 MB a train) is made the first time it is
    // drawn (ensureGeometry): till then each mesh holds an empty stand-in.
    const geo = { body: new THREE.BufferGeometry(), trim: new THREE.BufferGeometry(), decal: new THREE.BufferGeometry() };
    this._geoReady = false;
    this.bones = this.cars.map(() => new THREE.Bone());
    this.group = new THREE.Group();
    this.group.name = `freight:train${this.id}`;
    for (const b of this.bones) this.group.add(b);
    this.group.updateMatrixWorld(true);
    const skel = new THREE.Skeleton(this.bones);
    this.meshes = [[geo.body, sys.bodyMat], [geo.trim, sys.trimMat], [geo.decal, sys.decMat]].map(([g, m], i) => {
      const mesh = new THREE.SkinnedMesh(g, m);
      mesh.bind(skel, new THREE.Matrix4());
      mesh.castShadow = i === 0;
      mesh.receiveShadow = i !== 2;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.len / 2 + 8);
      mesh.renderOrder = i === 2 ? 1 : 0;
      this.group.add(mesh);
      return mesh;
    });
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
  }

  /** The train's geometry, built on its first showing (see _build). */
  ensureGeometry() {
    if (this._geoReady) return;
    let geo;
    if (this._geoJob) { let r = this._geoJob.next(); while (!r.done) r = this._geoJob.next(); geo = r.value; this._geoJob = null; }
    else geo = assembleTrain(this.consist);
    this._setGeometry(geo);
  }
  /** ...or a slice of it a frame while it comes nearer (Freight.update). */
  stepGeometry(sliceMs) {
    if (this._geoReady) return;
    if (!this._geoJob) this._geoJob = assembleTrainSteps(this.consist, sliceMs);
    const r = this._geoJob.next();
    if (r.done) { this._geoJob = null; this._setGeometry(r.value); }
  }
  _setGeometry(geo) {
    this._geoReady = true;
    ['body', 'trim', 'decal'].forEach((k, i) => {
      const m = this.meshes[i], old = m.geometry;
      m.geometry = geo[k];
      old.dispose();
      if (this.sys.dropArrays) dropGeometryArrays(geo[k]);
    });
  }

  get lead() { return this.s + this.dir * this.len / 2; }
  get tail() { return this.s - this.dir * this.len / 2; }
  get forward() { return this._fwd; }
  setDetailed() {}
  sync() {}
  damage() {}

  place(s, dir) {
    this.s = s; this.dir = dir; this.u = 0;
    this._point();
  }

  distTo(x, z) {
    // nearest of the lead, the middle and the tail (a 360 m train)
    const tr = this.track;
    let d = Infinity;
    for (const s of [this.lead, this.s, this.tail]) d = Math.min(d, Math.hypot(tr.x(s) - x, tr.z(s) - z));
    return d;
  }

  buried() {
    const tr = this.track;
    for (let d = 0; d <= this.len; d += 40) if (tr.kind(this.tail + this.dir * d) !== TUN) return false;
    return true;
  }

  /** The lead cab (where you climb in), in world terms. */
  cabPoint() {
    const tr = this.track, s = this.lead - this.dir * 4.2;
    return { x: tr.x(s), y: tr.y(s) + 1.5, z: tr.z(s) };
  }

  _point() {
    const tr = this.track;
    const sl = this.lead - this.dir * 4.2;
    this.x = tr.x(sl); this.z = tr.z(sl); this.y = tr.y(sl);
    this.cx = tr.x(this.s); this.cz = tr.z(this.s);
    this.heading = tr.heading(sl) + (this.dir > 0 ? 0 : Math.PI);
    this._fwd.x = Math.sin(this.heading); this._fwd.z = Math.cos(this.heading);
    this.vLong = this.u * this.dir;
    this.speed = Math.abs(this.u);
  }

  pose() {
    const tr = this.track, lead = this.lead;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const sc = lead - this.dir * c.off;
      const sF = sc + this.dir * c.truckC, sR = sc - this.dir * c.truckC;
      const ax = tr.x(sR), ay = tr.y(sR), az = tr.z(sR), bx = tr.x(sF), by = tr.y(sF), bz = tr.z(sF);
      this._z.set(bx - ax, by - ay, bz - az).normalize();
      this._x.set(this._z.z, 0, -this._z.x).normalize();
      this._y.crossVectors(this._z, this._x);
      this._m.makeBasis(this._x, this._y, this._z);
      const bone = this.bones[i];
      bone.quaternion.setFromRotationMatrix(this._m);
      bone.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    }
    this.group.updateMatrixWorld(true);
    for (const m of this.meshes) m.boundingSphere.center.set(this.cx, tr.y(this.s) + 2.4, this.cz);
  }

  limitAt(s) {
    const tr = this.track;
    return tr.LIM ? tr.LIM[tr.idx(s)] || FREIGHT.vMax : FREIGHT.vMax;
  }
  obstruct(ahead) { this.obstructAt = Math.min(this.obstructAt, ahead); }
  /** Someone on the track ahead: short, urgent blasts. */
  warn() {
    if (this.driver === 'player' || (this.horn.seq && this.horn.urgent)) return;
    this._hornSeq([[1, 0.9], [0, 0.25], [1, 0.9], [0, 0.25], [1, 0.9], [0, 0.25], [1, 2.4]]);
    this.horn.urgent = true;
  }

  /** Grade force along the train's forward direction, per unit mass: the average under it. */
  _gradeAcc() {
    const tr = this.track;
    let acc = 0, n = 0;
    for (let d = 0; d <= this.len; d += 30) {
      const s = this.lead - this.dir * d;
      acc += (tr.y(s + 3) - tr.y(s - 3)) / 6;
      n++;
    }
    return -G_ACC * (acc / n) * this.dir;
  }

  /** One step of the physics. notch 0..8, brakeCmd 0..1, emergency. */
  step(dt) {
    const P = FREIGHT;
    const v = this.u * this.dir;                 // + moving toward the lead end
    const m = this.mass;
    // tractive effort: the lesser of adhesion-limited and power-limited, per unit
    const nf = this.notch / 8;
    let F = 0;
    if (nf > 0) {
      const sgn = this.rev ? -1 : 1;
      const vs = Math.max(1.2, Math.abs(v));
      F = sgn * Math.min(P.teMax * nf, P.power * nf / vs) * this.locos * P.arcade;
      // no power against the direction you are rolling until nearly stopped
      if (v * sgn < -0.3) F *= 0.3;
    }
    // the air brakes: the cylinder follows the command, slowly
    const want = this.emerg ? 1.3 : this.brakeCmd;
    const rate = want > this.brakeCyl ? (this.emerg ? 2.4 : P.applyRate) : P.releaseRate;
    this.brakeCyl += clamp(want - this.brakeCyl, -rate * dt, rate * dt);
    const bDec = this.brakeCyl >= 1.05 ? P.brakeEmerg * (this.brakeCyl / 1.3) : P.brakeService * Math.min(1, this.brakeCyl);
    // resistance: rolling (Davis A and B) and air (C)
    const res = 0.010 + 0.0006 * Math.abs(v) + (0.85 * v * v) / (m / 1000);
    const a = F / m + this._gradeAcc();
    let vn = v + a * dt;
    const stop = (bDec + res) * dt;
    if (Math.abs(vn) <= stop && Math.abs(F / m) < bDec + res + Math.abs(this._gradeAcc()) + 0.001) vn = 0;
    else vn -= Math.sign(vn) * stop;
    this.accLong = (vn - v) / Math.max(dt, 1e-4);
    this.u = vn * this.dir;
    this.s += this.u * dt;
    const tr = this.track, ev = {};
    const lo = this.len / 2 + 0.5, hi = tr.len - this.len / 2 - 0.5;
    if (this.driver === 'player' && (this.s < lo || this.s > hi)) {
      ev.end = Math.abs(this.u);
      this.s = clamp(this.s, lo, hi);
      this.u = 0;
    }
    // other trains: on this track, and head-on in a single-track section
    for (const o of this.sys.trains) {
      if (o === this || o.state === 'off') continue;
      if (o.track === tr) {
        const gap = Math.abs(o.s - this.s) - (this.len + o.len) / 2;
        if (gap < 0) {
          const rel = Math.abs(this.u - o.u);
          const sg = Math.sign(this.s - o.s) || 1;
          this.s = o.s + sg * ((this.len + o.len) / 2 + 0.05);
          if (rel > 1.5) ev.collide = rel;
          const mm = (this.u * this.mass + o.u * o.mass) / (this.mass + o.mass);
          this.u = mm; o.u = mm;
        }
      } else {
        const sc = this.sys.sectionAt(tr.key, this.lead);
        if (sc && this.sys.occupied(sc, this) === o) {
          // head-on on single track: both in the same stretch, closing
          const k = tr.key, ok = o.track.key;
          const mine = (this.lead - sc[k][0]) / Math.max(1, sc[k][1] - sc[k][0]);
          const lo2 = Math.min(o.lead, o.tail), hi2 = Math.max(o.lead, o.tail);
          const f0 = (lo2 - sc[ok][0]) / Math.max(1, sc[ok][1] - sc[ok][0]), f1 = (hi2 - sc[ok][0]) / Math.max(1, sc[ok][1] - sc[ok][0]);
          // the two tracks run the same way through a shared section, so the
          // fractions along it compare
          if (mine >= f0 - 0.002 && mine <= f1 + 0.002) {
            const rel = Math.abs(this.u) + Math.abs(o.u);
            if (rel > 0.5) ev.collide = rel;
            this.s -= this.u * dt; this.u = 0; o.u = 0;
          }
        }
      }
    }
    this.latAcc = this.u * this.u * Math.abs(tr.curv(this.lead - this.dir * 10));
    ev.lat = this.latAcc;
    this._point();
    return ev;
  }

  /** The speed that still brakes, at `b`, to the stop ahead and every limit. */
  allowed(stopLead, b) {
    const dirn = this.dir, lead = this.lead;
    let v = stopLead === null ? FREIGHT.vMax : Math.sqrt(Math.max(0, 2 * b * Math.max(0, (stopLead - lead) * dirn)));
    for (let d = 0; d <= 900; d += 20) v = Math.min(v, Math.sqrt(this.limitAt(lead + dirn * d) ** 2 + 2 * b * d));
    for (let d = 0; d <= this.len; d += 20) v = Math.min(v, this.limitAt(lead - dirn * d));
    return v;
  }

  /** The next single-track section the lead will enter (not one it is in). */
  _nextSection() {
    const k = this.track.key;
    let best = null, bd = Infinity;
    for (const sc of this.sys.sections) {
      const entry = this.dir > 0 ? sc[k][0] : sc[k][1];
      const d = (entry - this.lead) * this.dir;
      if (d > -1 && d < bd) { bd = d; best = { sc, d, entry }; }
    }
    return best;
  }

  service(dt) {
    const sys = this.sys, tr = this.track, P = FREIGHT;
    if (this.state === 'off') {
      this.offT -= dt;
      if (this.offT > 0) return;
      // back in on the other main, from the end it left by
      const nt = tr.other, fromNorth = this.dir < 0;
      const s = fromNorth ? this.len / 2 + 2 : nt.len - this.len / 2 - 2;
      const sec = sys.sectionAt(nt.key, s);
      const busy = sys.trains.some((o) => o !== this && o.track === nt && o.state !== 'off' && Math.abs(o.s - s) < this.len + 300);
      if (busy || (sec && !sys.reserve(sec, this))) { this.offT = 6; return; }
      this.track = nt; this.dir = nt.dir; this.s = s; this.u = this.dir * 12; this.yardDone = false; this.atYard = false;
      this.state = 'run'; this.notch = 6; this.brakeCmd = 0; this.brakeCyl = 0;
      this._point();
      return;
    }
    if (this.state === 'dwell') {
      this.timer -= dt;
      this.notch = 0; this.brakeCmd = 1;
      // the crew waits for you while you walk up to the cab
      const p = sys.player;
      if (p && p.onFoot && this.atYard && this.held < 180) {
        const cab = this.cabPoint();
        if (Math.hypot(p.position.x - cab.x, p.position.z - cab.z) < 160 && this.timer < 3) { this.timer = 3; this.held += dt; }
      }
      if (sys.pending && sys.pending.t === this && this.timer < 3 && this.held < 240) { this.timer = 3; this.held += dt; }
      if (this.timer <= 0) { this.state = 'run'; this.atYard = false; this.bellT = 6; }
      this.step(dt);
      this._sounds(dt);
      return;
    }
    // --- plan: the yard stop, a signal at single track, the train ahead ----
    let stopLead = null;
    if (!this.yardDone) {
      // a crew change happens even a few car lengths long of the mark
      const ys = sys.yard.s[tr.key];
      const stopAt = ys + this.dir * 4.2;
      if ((this.lead - stopAt) * this.dir < 40) stopLead = stopAt;
      else this.yardDone = true;
    }
    this.wantSec = null;
    const nx = this._nextSection();
    if (nx && nx.d < 700) {
      this.wantSec = nx.sc;
      if (!sys.reserve(nx.sc, this)) {
        const sig = nx.entry - this.dir * 40;
        if (stopLead === null || (sig - stopLead) * this.dir < 0) stopLead = sig;
      }
    }
    let vAllow = this.allowed(stopLead, 0.26);
    const o = sys.ahead(this);
    if (o) {
      const gap = (o.tail - this.lead) * this.dir - 120;
      vAllow = Math.min(vAllow, Math.sqrt(Math.max(0, 2 * 0.3 * gap)) + Math.max(0, o.u * o.dir) * 0.6);
      if (gap < 0) vAllow = 0;
    }
    let emerg = false;
    if (this.obstructAt < Infinity) {
      const vo = Math.sqrt(Math.max(0, 2 * 0.6 * (this.obstructAt - 10)));
      if (this.u * this.dir > vo + 0.5) emerg = true;
      vAllow = Math.min(vAllow, vo);
      this.horn.forS = null;
      if (!this.horn.seq) this._hornSeq([[1, 3.5]]);
      this.obstructAt = Infinity;
    }
    // --- drive: notch up to hold the speed, brake to meet the plan ----------
    const v = this.u * this.dir;
    this._notchT -= dt;
    if (v < vAllow - 1.2) {
      this.brakeCmd = Math.max(0, this.brakeCmd - dt * 0.8);
      if (this._notchT <= 0 && this.notch < 8) { this.notch++; this._notchT = 0.9; }
    } else if (v > vAllow - 0.3) {
      if (this._notchT <= 0 && this.notch > 0) { this.notch = Math.max(0, this.notch - 2); this._notchT = 0.5; }
      // on the braking curve (planned at 0.26 m/s2, the brakes give 0.55):
      // more air the further over it
      const over = v - vAllow;
      this.brakeCmd = over > 0 ? clamp(0.45 + over * 0.5, 0, 1) : Math.max(0, this.brakeCmd - dt * 0.5);
    } else {
      this.brakeCmd = Math.max(0, this.brakeCmd - dt * 0.5);
    }
    const left = stopLead === null ? Infinity : (stopLead - this.lead) * this.dir;
    if (left < 0.5 || emerg) { this.notch = 0; this.brakeCmd = 1; }
    else if (left < 6 && v < 1.2) { this.notch = Math.max(this.notch, 2); this.brakeCmd = 0; }
    this.emerg = emerg && v > 2;
    const ev = this.step(dt);
    if (ev.collide && this.sys.player && this.sys.player.vehicle && this.sys.player.vehicle.spec.freight) this.sys.onCollide(this, ev.collide);
    // stopped at the yard: a crew change
    if (!this.yardDone && Math.abs(this.u) < 0.05 && left < 2.5) {
      this.u = 0; this.state = 'dwell'; this.timer = P.dwell; this.held = 0; this.yardDone = true; this.atYard = true;
      if (sys.audio && sys.audio.ready) sys.audio.play('airbrake', { gain: 0.8, x: this.x, y: this.y + 2, z: this.z, ref: 14 });
    }
    // off the end of the map
    if ((this.dir > 0 && this.lead > tr.len - 2) || (this.dir < 0 && this.lead < 2)) {
      this.state = 'off'; this.offT = 50 + this.id * 20; this.u = 0;
      this.group.visible = false;
      for (const sc of sys.sections) if (sc.owner === this) sc.owner = null;
    }
    this._crossingHorn(dt);
    this._sounds(dt);
  }

  /** Rule 14(L) for the crossing ahead: long, long, short, long, the last held. */
  _crossingHorn(dt) {
    const sys = this.sys, k = this.track.key, v = Math.abs(this.u);
    if (v < 1) return;
    let next = null, nd = Infinity;
    for (const c of sys.crossings) {
      const s = c.s[k];
      if (s === undefined) continue;
      const d = (s - this.lead) * this.dir;
      if (d > 0 && d < nd) { nd = d; next = c; }
    }
    if (!next) return;
    const tta = nd / Math.max(v, 1);
    if (tta < 16 && this.horn.forS !== next && !this.horn.seq) {
      this.horn.forS = next;
      const hold = clamp(tta - 8.6, 1.2, 5);
      this._hornSeq([[1, 2.2], [0, 0.55], [1, 2.2], [0, 0.55], [1, 0.8], [0, 0.45], [1, hold]]);
      this.bellT = Math.max(this.bellT, tta + 3);
    }
  }
  _hornSeq(seq) { this.horn.seq = seq.map((x) => x.slice()); this.horn.t = 0; this.horn.urgent = false; }

  /** Horn and bell: what an AI train sounds this frame (audio reads hornOn / bellOn). */
  _sounds(dt) {
    const h = this.horn;
    if (h.seq && h.seq.length) {
      h.seq[0][1] -= dt;
      this.hornOn = h.seq[0][0] === 1;
      if (h.seq[0][1] <= 0) h.seq.shift();
      if (!h.seq.length) { h.seq = null; this.hornOn = false; h.urgent = false; }
    } else this.hornOn = false;
    this.bellT -= dt;
    this.bellOn = this.bellT > 0 || this.state === 'dwell' && this.timer < 8;
  }

  resume() {
    this.driver = null;
    this.mode = 'service';
    this.rev = false;
    this.emerg = false;
    this.yardDone = true;
    this.state = Math.abs(this.u) < 0.1 ? 'dwell' : 'run';
    if (this.state === 'dwell') { this.timer = 20; this.held = 0; this.atYard = false; }
  }

  /** In the tunnel the camera goes into the cab. */
  camRig(p, dt) {
    const tr = this.track;
    const k = tr.kind(this.lead - this.dir * 25), kl = tr.kind(this.lead + this.dir * 4);
    const under = k === TUN || k === BOX || kl === TUN;
    this.sys.camUnder = under && (k === TUN || kl === TUN || this.sys.camUnder);
    if (!under) { this.sys.camUnder = false; this._cab = false; return false; }
    // the engineer's eye, just ahead of the glass, over the nose
    const cs = this.lead - this.dir * 1.45;
    const h = tr.heading(cs), lx = Math.cos(h), lz = -Math.sin(h);
    const want = new THREE.Vector3(tr.x(cs) + lx * 0.6 * this.dir, tr.y(cs) + 3.95, tr.z(cs) + lz * 0.6 * this.dir);
    const ls = this.lead + this.dir * 60;
    const look = new THREE.Vector3(tr.x(ls), tr.y(ls) + 2.5, tr.z(ls));
    p.camPos.copy(want);
    if (!this._cab) p.camLook.copy(look); else p.camLook.lerp(look, 1 - Math.exp(-10 * dt));
    this._cab = true;
    p.camRel = null; p.camLookRel = null; p.camUp = null;
    p.camYaw = Math.atan2(-this._fwd.x, -this._fwd.z);
    p.camFloor = null;
    return true;
  }

  readout() {
    const mph = (v) => Math.round(v * 2.237);
    const v = Math.abs(this.u);
    const lim = mph(Math.min(...[0, 60, 150, 300].map((d) => this.limitAt(this.lead + this.dir * d))));
    const thr = this.emerg ? 'EMERGENCY' : this.notch > 0 ? `N${this.notch}` : this.brakeCyl > 0.03 ? `BRAKE ${Math.round(Math.min(1, this.brakeCyl) * 100)}%` : 'IDLE';
    let sig = '';
    const nx = this._nextSection();
    if (nx && nx.d < 1500) {
      const own = nx.sc.owner === this || !nx.sc.owner || nx.sc.owner.state === 'off';
      const clear = own && !this.sys.occupied(nx.sc, this);
      sig = clear ? ` · signal CLEAR ${Math.round(nx.d)} m` : ` · signal STOP ${Math.round(nx.d)} m`;
    }
    const o = this.sys.ahead(this);
    const gap = o ? (o.tail - this.lead) * this.dir : Infinity;
    const ahead = gap < 800 ? ` · train ahead ${Math.round(gap)} m` : '';
    let xing = '';
    let nd = Infinity;
    for (const c of this.sys.crossings) {
      const s = c.s[this.track.key];
      if (s === undefined) continue;
      const d = (s - this.lead) * this.dir;
      if (d > 0 && d < nd) nd = d;
    }
    if (nd < 600) xing = ` · crossing ${Math.round(nd)} m`;
    const rev = this.rev ? ' · REVERSE' : '';
    return `${this.name} · ${mph(v)} mph (limit ${lim}) · ${thr}${rev}${xing}${sig}${ahead}`;
  }

  /** player.js calls this as it calls any vehicle's update: you are driving. */
  update(dt, input) {
    const sys = this.sys, tr = this.track, P = FREIGHT;
    this.driver = 'player';
    const gas = (input.throttle || 0) > 0.3, brk = (input.brake || 0) > 0.3;
    const v = this.u * this.dir;
    // THE END OF THE MAP: change ends onto the other main
    const atEnd = (this.dir > 0 && this.s > tr.len - this.len / 2 - 1.5) || (this.dir < 0 && this.s < this.len / 2 + 1.5);
    if (atEnd && Math.abs(this.u) < 0.05 && gas) {
      const nt = tr.other;
      const s = this.dir > 0 ? nt.len - this.len / 2 - 2 : this.len / 2 + 2;
      const busy = sys.trains.some((o) => o !== this && o.track === nt && o.state !== 'off' && Math.abs(o.s - s) < this.len + 100);
      if (busy) { if (this.warned <= 0) { sys.say('Wait — a train is on the other main'); this.warned = 3; } }
      else {
        this.track = nt; this.dir = nt.dir; this.s = s; this.u = 0; this.rev = false; this.notch = 0;
        sys.say(`You change ends — heading ${this.dir > 0 ? 'south' : 'north'} on the other main`);
      }
    }
    // throttle: hold POWER to notch up (one every half second), releasing the brakes
    this._notchT -= dt;
    if (gas) {
      if (this.emerg && Math.abs(this.u) < 0.1) { this.emerg = false; sys.say('Emergency brake reset — POWER to go'); }
      if (!this.emerg) {
        this.brakeCmd = Math.max(0, this.brakeCmd - dt * 1.2);
        if (this._notchT <= 0 && this.notch < 8) {
          this.notch++; this._notchT = 0.5;
          if (sys.audio && sys.audio.ready) sys.audio.ui('tick');
        }
      }
      this._brkT = 0;
    } else if (!brk) this._notchT = Math.min(this._notchT, 0);
    // BRAKE: back to idle first, then the air; held full for 2.5 s it dumps to emergency
    // a second press of BRAKE within 0.4 s of letting go of the first
    if (brk && !this._brkWas) { this._tap2 = (this._sinceRel || 99) < 0.4; }
    if (!brk && this._brkWas) this._sinceRel = 0;
    this._sinceRel = (this._sinceRel || 0) + dt;
    this._brkWas = brk;
    if (brk) {
      this._brkT += dt;
      if (this.notch > 0) {
        if (this._notchT <= 0) { this.notch--; this._notchT = 0.28; if (sys.audio && sys.audio.ready) sys.audio.ui('tick'); }
      } else {
        const was = this.brakeCmd;
        this.brakeCmd = Math.min(1, this.brakeCmd + dt * 0.55);
        if (was < 0.02 && this.brakeCmd >= 0.02 && sys.audio && sys.audio.ready) sys.audio.play('airbrake', { gain: 0.45 });
        // BRAKE tapped twice: the emergency application
        if (this._tap2 && !this.emerg && Math.abs(v) > 1) {
          this.emerg = true;
          if (sys.audio && sys.audio.ready) sys.audio.play('brake_dump', { gain: 0.9, duck: 0.3 });
          this._tap2 = false;
          sys.say('EMERGENCY — the brake pipe dumps. Hold POWER once stopped to reset');
        }
        // at a stand with the brakes on: flip the reverser
        if (Math.abs(this.u) < 0.02 && this.brakeCmd >= 1) {
          this._revT += dt;
          if (this._revT > 3) { this._revT = -99; this.rev = !this.rev; sys.say(this.rev ? 'Reverser: REVERSE — POWER backs the train up' : 'Reverser: FORWARD'); }
        }
      }
    } else {
      this._revT = 0;
      if (!gas && this.brakeCmd > 0 && !this.emerg) {
        const was = this.brakeCmd;
        this.brakeCmd = Math.max(0, this.brakeCmd - dt * 0.35);
        if (was > 0.15 && this.brakeCmd <= 0.15 && sys.audio && sys.audio.ready) sys.audio.play('brake_release', { gain: 0.5 });
      }
    }
    const ev = this.step(dt);
    if (ev.end > 1.5) sys.onEnd(this);
    else if (ev.end !== undefined && this.warned <= 0) { sys.onEnd(this); this.warned = 6; }
    if (ev.collide) sys.onCollide(this, ev.collide);
    // too fast for the curve: flange squeal, then damage
    if (ev.lat > 1.1) {
      if (this.warned <= 0) { sys.say('Too fast for the curve — ease off!'); this.warned = 5; }
      if (ev.lat > 2.2) { sys.game && sys.game.damagePlayer((ev.lat - 2.2) * dt * 10, 'crash'); this.brakeCmd = 1; }
    }
    this.skid = clamp((ev.lat - 0.5) / 1.2, 0, 1);
    this.warned -= dt;
    // the crossings: horn blown in the 18 s before one earns a little
    this._hornPlayer(dt);
    this.bellT -= dt;
    this.bellOn = this.bellT > 0;
  }

  /** You hold the horn: audio reads hornOn. At each crossing, were you sounding it? */
  _hornPlayer(dt) {
    const sys = this.sys;
    this._hornHeld = (this._hornHeld || 0) - dt;
    this.hornOn = this._hornHeld > 0;
    if (this.hornOn) this._lastHorn = 0; else this._lastHorn = (this._lastHorn || 99) + dt;
    const k = this.track.key, v = Math.abs(this.u);
    for (const c of sys.crossings) {
      const s = c.s[k];
      if (s === undefined) continue;
      const d = (s - this.lead) * this.dir;
      if (d < 250 && d > 0) this.bellT = Math.max(this.bellT, 4);
      if (d <= 0 && d > -v * 0.4 - 1 && v > 2 && !this.hornedFor.has(c)) {
        this.hornedFor.add(c);
        if (this._lastHorn < 12) {
          if (sys.game) sys.game.money += 15;
          sys.say('Sounded for the crossing +$15', 1600);
        } else if ((this._missed = (this._missed || 0) + 1) <= 3) sys.say('Sound the HORN before every crossing!', 2000);
      }
    }
  }
  /** The horn button (main.js onHorn): keeps the horn blowing while held. */
  blow() { this._hornHeld = 0.46; this.hornOn = true; }
}

// ---------------------------------------------------------------------------
// A train's geometry: every car copied into one SkinnedMesh per material, a
// bone per car (the car's own frame: vertices stay in car-local metres).

function assembleTrain(consist) {
  const it = assembleTrainSteps(consist, Infinity);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
/** assembleTrain a slice at a time: yields whenever `sliceMs` is used up. */
function* assembleTrainSteps(consist, sliceMs) {
  const out = {};
  let t0 = performance.now();
  for (const key of ['body', 'trim', 'decal']) {
    const parts = consist.map((t) => railCar(t)[key]);
    let nv = 0, ni = 0;
    for (const g of parts) { nv += g.attributes.position.count; ni += g.index.count; }
    const hasUV = !!parts[0].attributes.uv;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = hasUV ? new Float32Array(nv * 2) : null;
    const idx = new Uint32Array(ni);
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    let v = 0, q = 0;
    for (let ci = 0; ci < parts.length; ci++) {
      const g = parts[ci], n = g.attributes.position.count;
      pos.set(g.attributes.position.array, v * 3); nor.set(g.attributes.normal.array, v * 3); col.set(g.attributes.color.array, v * 3);
      if (uv) uv.set(g.attributes.uv.array, v * 2);
      for (let i = 0; i < n; i++) { si[(v + i) * 4] = ci; sw[(v + i) * 4] = 1; }
      const I = g.index.array;
      for (let i = 0; i < I.length; i++) idx[q + i] = I[i] + v;
      v += n; q += I.length;
      if (performance.now() - t0 > sliceMs) { yield; t0 = performance.now(); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    if (key === 'trim') tagGlass(geo);
    out[key] = geo;
  }
  return out;
}
