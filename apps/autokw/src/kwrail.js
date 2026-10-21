// HEAVY RAIL IN WATERLOO REGION: the lines trains run on, every other track in
// the box, the level crossings, and the trains -- GO, VIA, CN, CPKC and the
// Waterloo Central Railway's heritage train.
//
// THE LINES (data/rail.json, tools/kw/build_rail.py, from OSM):
//   guelph  the Guelph Subdivision: CN-owned west of Kitchener (toward Baden,
//           Stratford and London), Metrolinx-owned from Kitchener east
//           (toward Breslau, Guelph and Georgetown; bought from CN in 2014).
//           GO's Kitchener line terminates at Kitchener station (the 1897
//           station at Victoria and Weber -- the Kitchener Central Transit
//           Hub at King and Victoria is not due until ~2031); VIA's
//           Toronto-London trains call there; CN runs freight over the whole
//           line (it took the Guelph Sub back from GEXR in Nov 2018).
//   galt    CPKC's Galt Subdivision through Cambridge: the Toronto-Windsor /
//           Detroit main line, through freights both ways.
//   wsub    CPKC's Waterloo Subdivision, Galt north to Kitchener: a local.
//   spur    the Waterloo Spur north of Northfield Dr: the Waterloo Central
//           Railway's heritage train, Waterloo - Farmers' Market - St. Jacobs
//           - Elmira (WCR runs Apr-Oct on Thu/Sat, Tue in summer; here it
//           shuttles all day).
//
// Each line is ONE track as a link.js LinkTrack (the profile follows the
// ground's average and the ground is cut to it, freight.js's carve). Where OSM
// maps a second track beside it for long enough -- the double track through
// Kitchener, a passing siding -- that is a PASSING PLACE (`pp`): drawn at its
// offset from the line, and run on by any train told to take it. Trains meet
// at passing places: a single-track BLOCK between two of them is entered only
// when no train is in it, or bound into it, the other way (`_free`). Every
// train fits every passing place its line uses (shorter ones are only drawn).
//
// WHERE THE NUMBERS COME FROM
//   [TC]    Transport Canada Grade Crossings Standards (2014): gates and
//           flashing lights; a crossbuck on every approach, with the number of
//           tracks under it where there is more than one
//   [CROR]  Canadian Rail Operating Rules, rule 14(l): long, long, short,
//           long, the last held until the crossing is occupied; bell rung
//   [GO]    GO Kitchener line: weekday trains to Kitchener only (no other
//           station in the box), ~10-12 a day each way, peak-direction;
//           12 bilevels behind an MP40PH-3C (loco at the west end, cab car
//           leading east to Union)
//   [VIA]   Toronto-London via Kitchener, two round trips a day, Siemens
//           Venture sets (Charger + cars + cab car) since 2024
//   est.    speeds (60 mph passenger on the Guelph Sub east of Kitchener, 50
//           mph freight, 25 mph Waterloo Sub, 15 mph Waterloo Spur), dwells,
//           and the compressed timetable below: a train every few minutes,
//           not hours, or you would never see one

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder, ChunkBuilder, SinkBuilder, LazyChunks, dropStaticArrays, dropGeometryArrays } from './build.js';
import { LinkTrack, KIND } from './link.js';
import { vehicleAssets, tagGlass } from './vehicles.js';
import { railCar, railDecals } from './railcars.js';
import { clamp } from './util.js';
import { memo } from './bootcache.js';

const { TUN, BOX, DECK, FILL, CROSS } = KIND;
const _fw = new THREE.Vector3();

export const KWRAIL = {
  gauge: 1.435,
  lift: 0.55, liftX: 0.36, deck: 5.0, cover: 9.0,
  grade: 0.012,          // the subs' ruling grades are ~1 % (est.)
  aLat: 0.7,             // unbalanced lateral acceleration in a curve
  ramp: 45,              // a passing place's turnout: the offset eases in over this
};
// per line: track speed (m/s), and near the station
const LINE_V = { guelph: 26.8, galt: 22.4, wsub: 11.2, spur: 6.7 };
const STATION_V = 13.4, STATION_R = 1300;

const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const RANGE = ON_PHONE ? { flat: 1600, bed: 900, near: 380, train: 1300, gate: 260 }
  : { flat: 2400, bed: 1500, near: 650, train: 2000, gate: 380 };
const CHUNK = 500;

// ---------------------------------------------------------------------------
// The fleet. Each consist lists car types (railcars.js), lead end first; a
// `~` before a type turns that car round (a cab car's cab, a trailing unit).

const FLEET = [
  // GO: MP40PH-3C at the west end, eleven bilevels, the cab car east
  { id: 'go1', line: 'guelph', kind: 'go', name: 'GO', vMax: 26.8, acc: 0.55, dec: 0.75,
    consist: ['go647', ...Array(10).fill('goCoach'), '~goCab'], route: 'go' },
  { id: 'go2', line: 'guelph', kind: 'go', name: 'GO', vMax: 26.8, acc: 0.55, dec: 0.75,
    consist: ['go612', ...Array(10).fill('goCoach'), '~goCab'], route: 'go' },
  { id: 'go3', line: 'guelph', kind: 'go', name: 'GO', vMax: 26.8, acc: 0.55, dec: 0.75,
    consist: ['go660', ...Array(10).fill('goCoach'), '~goCab'], route: 'go' },
  // VIA: a Venture set (Charger, four cars, the cab car)
  { id: 'via', line: 'guelph', kind: 'via', name: 'VIA', vMax: 26.8, acc: 0.6, dec: 0.8,
    consist: ['viaCharger', 'viaCoach', 'viaCoach', 'viaCoach', 'viaCoach', '~viaCab'], route: 'through' },
  // CN through freights on the Guelph Sub
  { id: 'cn1', line: 'guelph', kind: 'freight', name: 'CN', vMax: 22.4, acc: 0.22, dec: 0.4,
    consist: ['cn2871', 'cn2925', 'boxCn', 'hopperCn1', 'tankCrude', 'autorackCn', 'boxCn2', 'hopperCn2', 'autorackTtgx',
      'tankEthanol', 'boxCn', 'hopperCn1', 'autorackCn', 'boxCn2', 'tankCrude2', 'hopperCn2'], route: 'through' },
  { id: 'cn2', line: 'guelph', kind: 'freight', name: 'CN', vMax: 22.4, acc: 0.22, dec: 0.4,
    consist: ['cn3004', 'boxCn2', 'boxCn', 'hopperCn2', 'hopperCn1', 'autorackTtgx', 'autorackCn', 'tankEthanol', 'tankCrude',
      'boxCn', 'hopperCn1', 'boxCn2', 'tankCrude2'], route: 'through' },
  // CPKC on the Galt Sub: long through freights
  { id: 'cp1', line: 'galt', kind: 'freight', name: 'CPKC', vMax: 22.4, acc: 0.2, dec: 0.38,
    consist: ['cpkc9375', 'cp8781', 'autorackCp', 'autorackTtgx', 'autorackCp', 'autorackTtgx', 'boxCp', 'boxCp2', 'hopperCp',
      'hopperCp', 'tankCrude', 'tankEthanol', 'boxCp', 'hopperCp2', 'autorackCp', 'boxCp2', 'tankCrude2', 'hopperCp', 'boxCp',
      'hopperCp2', 'autorackTtgx', 'boxCp', 'tankEthanol', '~cp8781'], route: 'through' },
  { id: 'cp2', line: 'galt', kind: 'freight', name: 'CPKC', vMax: 22.4, acc: 0.2, dec: 0.38,
    consist: ['cp8781', 'cpkc9375', 'hopperCp', 'hopperCp2', 'hopperCp', 'hopperCp2', 'hopperCp', 'hopperCp2', 'boxCp',
      'boxCp2', 'tankCrude', 'tankCrude2', 'tankEthanol', 'tankCrude', 'autorackCp', 'autorackTtgx', 'boxCp', 'hopperCp',
      'boxCp2', 'hopperCp2'], route: 'through' },
  { id: 'cp3', line: 'galt', kind: 'freight', name: 'CPKC', vMax: 22.4, acc: 0.2, dec: 0.38,
    consist: ['cpkc9375', 'autorackTtgx', 'autorackCp', 'autorackTtgx', 'autorackCp', 'autorackCp', 'boxCp', 'boxCp2', 'boxCp',
      'tankCrude', 'hopperCp', 'hopperCp2', 'boxCp2', 'autorackTtgx'], route: 'through' },
  // the Waterloo Sub's local, Galt to Kitchener and back
  { id: 'cpl', line: 'wsub', kind: 'freight', name: 'CPKC', vMax: 11.2, acc: 0.25, dec: 0.45,
    consist: ['cp8781', 'boxCp', 'hopperCp', 'boxCp2', 'tankCrude', 'boxCp', 'hopperCp2'], route: 'shuttle' },
  // the Waterloo Central Railway: GMD-1 1012 and its heritage coaches
  { id: 'wcr', line: 'spur', kind: 'heritage', name: 'WCR', vMax: 6.7, acc: 0.35, dec: 0.5,
    consist: ['wcr1012', 'wcrCoach', 'wcrCoach', 'wcrCoach'], route: 'shuttle' },
];

// ---------------------------------------------------------------------------
// Geometry helpers along a track (freight.js's)

const uv0 = [0, 0, 1, 0, 1, 1, 0, 1];
const UP = [0, 1, 0], DOWN = [0, -1, 0];
/** A frame at s, its rail head shifted `o` to the left (a passing place's track). */
function frame(tr, s, o = 0) {
  const h = tr.heading(s), lx = Math.cos(h), lz = -Math.sin(h);
  return { x: tr.x(s) + lx * o, y: tr.y(s), z: tr.z(s) + lz * o, fx: Math.sin(h), fz: Math.cos(h), lx, lz, h };
}
const at = (F, o, dy) => [F.x + F.lx * o, F.y + dy, F.z + F.lz * o];
const atY = (F, o, y) => [F.x + F.lx * o, y, F.z + F.lz * o];
function band(b, A, B, o0, dy0, o1, dy1, n, col, uvs = uv0) {
  b.quad(at(A, o0, dy0), at(A, o1, dy1), at(B, o1, dy1), at(B, o0, dy0), n, uvs, col);
}
const side = (F, sg) => [F.lx * sg, 0, F.lz * sg];
const C = {
  concrete: [0.50, 0.49, 0.46], concreteD: [0.36, 0.355, 0.34], concreteL: [0.62, 0.61, 0.58],
  railTop: [0.66, 0.66, 0.68], railSide: [0.28, 0.2, 0.15], steel: [0.3, 0.31, 0.32], steelD: [0.16, 0.16, 0.17],
  paving: [0.22, 0.22, 0.23], timber: [0.2, 0.15, 0.11], black: [0.02, 0.02, 0.025], white: [0.9, 0.9, 0.88],
  red: [0.75, 0.04, 0.03], girder: [0.16, 0.17, 0.18], earth: [0.16, 0.17, 0.09],
  plat: [0.5, 0.49, 0.47], tactile: [0.8, 0.62, 0.05], goGreen: [0.07, 0.3, 0.06], glassG: [0.25, 0.32, 0.33],
  wood: [0.32, 0.22, 0.13], woodL: [0.45, 0.33, 0.2], roofG: [0.12, 0.13, 0.14],
};

/** Ballast with timber ties: u across the 3.4 m bed, v along 2.4 m (five ties). */
function bedTexture() {
  const W = 128, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#86827a'; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 3600; k++) {
    const v = 82 + rnd() * 90;
    g.fillStyle = `rgb(${v + 4},${v + 1},${v - 4})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2.5, 1 + rnd() * 2);
  }
  for (let t = 0; t < 5; t++) {
    const y = t * H / 5 + 6, th = H * 0.058;
    const k = 0.8 + rnd() * 0.35;
    g.fillStyle = `rgb(${Math.round(58 * k)},${Math.round(46 * k)},${Math.round(38 * k)})`; g.fillRect(W * 0.12, y, W * 0.76, th);
    g.fillStyle = `rgb(${Math.round(80 * k)},${Math.round(66 * k)},${Math.round(54 * k)})`; g.fillRect(W * 0.12, y, W * 0.76, th * 0.22);
    g.fillStyle = 'rgba(20,16,14,0.6)'; g.fillRect(W * 0.12, y + th * 0.8, W * 0.76, th * 0.2);
    for (const u of [0.29, 0.71]) { g.fillStyle = '#3a3531'; g.fillRect(W * u - 7, y + 1, 14, th - 2); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
// the ballast-only strip of that texture (the shoulders, the fill between two tracks)
const BALLAST_U = [0.02, 0.05];

/** A passing place's track offset at s: 0 outside it, eased in over the turnout. */
function ppOff(pp, s) {
  if (!pp || s <= pp.s0 || s >= pp.s1) return 0;
  const t = clamp(Math.min(s - pp.s0, pp.s1 - s) / KWRAIL.ramp, 0, 1);
  return pp.off * t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------

export class KwRail {
  /**
   * From the map data alone, right after the map loads: citygen needs the
   * clear zones, and the ground must be cut for the beds before anything reads
   * it. The profiles, the raw crossings and the carve are settled here.
   */
  constructor(data, md) {
    this.data = data;
    const P = { ...KWRAIL, follow: 'mean', meanR: 45, seaFloor: -1e9 };
    P.bridgeFloor = (x, z) => {
      if (!G.isWater(x, z)) return -Infinity;
      const w = G.drawnWaterLevel(null, x, z);
      return w > -50 ? w + 4.6 : -Infinity;
    };
    this.P = P;
    this.lines = [];
    this.byKey = {};
    for (const ld of data.lines) {
      const tr = new LinkTrack(ld.key, ld.pts, P);
      const line = { key: ld.key, name: ld.name, owner: ld.owner, ends: ld.ends, tr, pps: [], stops: [], trains: [], vMax: LINE_V[ld.key] || 22.4 };
      tr.line = line;
      this.lines.push(line);
      this.byKey[ld.key] = line;
      line.pps = this._passingPlaces(tr, ld.twins || []);
    }
    // the profile, the crossings and the kinds: deterministic for a build, so
    // a later launch restores them (bootcache.js memo)
    const roads = md ? md.roads : null;
    for (const line of this.lines) {
      const tr = line.tr, k = line.key;
      const prof = memo(`kwrail:prof:${k}`, () => {
        this._rawCrossings(tr, roads);
        tr.setHeights([], tr._XW);
        tr.KD = new Uint8Array(tr.n);
        this._kinds(tr);
        return { Y: tr.Y.slice(), GR: tr.GR.slice(), KD: tr.KD.slice(), X: tr._X.slice(), XW: tr._XW.slice() };
      }, (v) => v && v.Y && v.Y.length === tr.n);
      tr.Y = prof.Y.slice(); tr.GR = prof.GR.slice(); tr.KD = prof.KD.slice(); tr._X = prof.X.slice(); tr._XW = prof.XW.slice();
    }
    this._carveGrid();
    G.setRailCarve((x, z) => this.carveDepth(x, z), (cx, cz) => this.cvBig.has(Math.floor(cx / 40) * 100003 + Math.floor(cz / 40)));
    // the open corridor: no trees, props or parked cars on it
    this.corrCells = new Set();
    const mark = (x, z) => {
      const cx = Math.floor(x / 40), cz = Math.floor(z / 40);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.corrCells.add((cx + dx) * 100003 + cz + dz);
    };
    for (const line of this.lines) for (let i = 0; i < line.tr.n; i += 8) mark(line.tr.X[i], line.tr.Z[i]);
    // every other track (spurs, yards), split into pieces of <= 300 m for the
    // lazy chunks' replay
    this.statics = [];
    for (const pts of data.static || []) {
      let cur = [pts[0]], acc = 0;
      for (let i = 1; i < pts.length; i++) {
        acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        cur.push(pts[i]);
        if (acc > 300 && i < pts.length - 1) { this.statics.push(cur); cur = [pts[i]]; acc = 0; }
      }
      if (cur.length > 1) this.statics.push(cur);
    }
    this.stCells = new Map();
    this.statics.forEach((pts, pi) => {
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i];
        mark(x, z);
        const k = Math.floor(x / 40) * 100003 + Math.floor(z / 40);
        if (!this.stCells.has(k)) this.stCells.set(k, []);
        this.stCells.get(k).push(pi);
      }
    });
    this.trains = [];
    this.crossings = [];
    this.solids = [];
    this.chunks = [];
    this.time = 0;
    this.stats = { spawns: 0, holds: 0, meets: 0, rescued: 0, dwells: 0 };
  }

  /** OSM's tracks beside a line, as passing places along it: { s0, s1, off }. */
  _passingPlaces(tr, twins) {
    const runs = [];
    for (const pts of twins) {
      const ss = [], os = [];
      for (const [x, z] of pts) {
        const q = tr.nearest(x, z, 12);
        if (!q) continue;
        ss.push(q.s); os.push(q.side * q.d);
      }
      if (ss.length < 4) continue;
      os.sort((a, b) => a - b);
      const off = os[os.length >> 1];
      if (Math.abs(off) < 2.8 || Math.abs(off) > 7.5) continue;
      runs.push({ s0: Math.min(...ss), s1: Math.max(...ss), off });
    }
    runs.sort((a, b) => a.s0 - b.s0);
    // the same side, overlapping or within 120 m (a crossover between): one
    const out = [];
    for (const r of runs) {
      const p = out[out.length - 1];
      if (p && Math.sign(p.off) === Math.sign(r.off) && r.s0 < p.s1 + 120) {
        const w0 = p.s1 - p.s0, w1 = r.s1 - r.s0;
        p.off = (p.off * w0 + r.off * w1) / (w0 + w1);
        p.s1 = Math.max(p.s1, r.s1);
      } else if (p && r.s0 < p.s1 + 40) {
        // the other side, overlapping: keep the longer
        if (r.s1 - r.s0 > p.s1 - p.s0) out[out.length - 1] = { ...r };
      } else out.push({ ...r });
    }
    // through the turnouts (OSM's twin starts where the tracks are 2.6 m apart)
    return out.map((r, i) => ({ id: i, s0: Math.max(0, r.s0 - 30), s1: Math.min(tr.len, r.s1 + 30), off: r.off, hold: [null, null] }))
      .filter((p) => p.s1 - p.s0 > 200);
  }

  /** Level crossings from the RAW road graph (freight.js): `_X` over the road, `_XW` a little wider. */
  _rawCrossings(tr, roads) {
    tr._X = new Uint8Array(tr.n); tr._XW = new Uint8Array(tr.n);
    if (!roads) return;
    const { nx, nz, ea, eb, eflags, ehw, edgeCount } = roads;
    const cells = new Map(), CELL = 64;
    for (let i = 0; i + 4 < tr.n; i += 4) {
      const k0 = Math.floor(tr.X[i] / CELL) * 100003 + Math.floor(tr.Z[i] / CELL);
      if (!cells.has(k0)) cells.set(k0, []);
      cells.get(k0).push(i);
    }
    for (let e = 0; e < edgeCount; e++) {
      if (eflags[e] & 3) continue;
      const ax = nx[ea[e]], az = nz[ea[e]], bx = nx[eb[e]], bz = nz[eb[e]];
      const c0 = Math.floor(Math.min(ax, bx) / CELL) - 1, c1 = Math.floor(Math.max(ax, bx) / CELL) + 1;
      const d0 = Math.floor(Math.min(az, bz) / CELL) - 1, d1 = Math.floor(Math.max(az, bz) / CELL) + 1;
      if ((c1 - c0) * (d1 - d0) > 400) continue;
      for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
        const l = cells.get(cx * 100003 + cz);
        if (!l) continue;
        for (const i of l) {
          const px = tr.X[i], pz = tr.Z[i], qx = tr.X[i + 4], qz = tr.Z[i + 4];
          const rx = bx - ax, rz = bz - az, sx = qx - px, sz = qz - pz;
          const den = rx * sz - rz * sx;
          if (Math.abs(den) < 1e-6) continue;
          const t = ((px - ax) * sz - (pz - az) * sx) / den, u = ((px - ax) * rz - (pz - az) * rx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const sinA = Math.abs(den) / (Math.hypot(rx, rz) * Math.hypot(sx, sz));
          if (sinA < 0.3) continue;
          const m = i + Math.round(u * 4), half = Math.ceil(ehw[e] / sinA) + 1;
          for (let j = Math.max(0, m - half); j <= Math.min(tr.n - 1, m + half); j++) tr._X[j] = 1;
          for (let j = Math.max(0, m - half - 10); j <= Math.min(tr.n - 1, m + half + 10); j++) tr._XW[j] = 1;
        }
      }
    }
  }

  _kinds(tr) {
    for (let i = 0; i < tr.n; i++) {
      const f = tr.F[i];
      tr.KD[i] = f === 2 ? DECK : tr._X[i] ? CROSS : FILL;
    }
  }

  /** The passing place of `line` covering s, or null. */
  ppAt(line, s) {
    for (const p of line.pps) if (s > p.s0 && s < p.s1) return p;
    return null;
  }

  /** THE GROUND IS CUT FOR THE BED (freight.js _carveGrid), the passing tracks' too. */
  _carveGrid() {
    const FORM_W = 5.5, CELL = 16;
    this.cvCells = new Map(); this.cvBig = new Set();
    const S = [];
    const add = (x, z, fl, h, w) => {
      const lx = Math.cos(h), lz = -Math.sin(h), fx = Math.sin(h), fz = Math.cos(h);
      let hmax = 0;
      for (const o of [-12, -8, -4, 0, 4, 8, 12]) hmax = Math.max(hmax, G.terrainRaw(x + lx * o, z + lz * o) - fl);
      if (hmax <= 0.02) return;
      const reach = Math.min(22, w + hmax + 1.5);
      const id = S.length;
      S.push({ x, z, fl, r: reach, w, lx, lz, fx, fz });
      for (let cx = Math.floor((x - reach) / CELL); cx <= Math.floor((x + reach) / CELL); cx++)
        for (let cz = Math.floor((z - reach) / CELL); cz <= Math.floor((z + reach) / CELL); cz++) {
          const kk = cx * 100003 + cz;
          let l = this.cvCells.get(kk);
          if (!l) this.cvCells.set(kk, (l = []));
          l.push(id);
        }
      for (let cx = Math.floor((x - reach) / 40); cx <= Math.floor((x + reach) / 40); cx++)
        for (let cz = Math.floor((z - reach) / 40); cz <= Math.floor((z + reach) / 40); cz++) this.cvBig.add(cx * 100003 + cz);
    };
    for (const line of this.lines) {
      const tr = line.tr;
      for (let i = 0; i < tr.n; i += 2) {
        if (tr.KD[i] === DECK) continue;
        const fl = tr.Y[i] - (tr._X[i] ? this.P.liftX + 0.04 : 1.0);
        add(tr.X[i], tr.Z[i], fl, tr.H[i], FORM_W);
        const pp = this.ppAt(line, i);
        const o = ppOff(pp, i);
        if (Math.abs(o) > 0.5) {
          const h = tr.H[i];
          add(tr.X[i] + Math.cos(h) * o, tr.Z[i] - Math.sin(h) * o, fl, h, FORM_W);
        }
      }
    }
    this.cvS = S;
  }

  /** How far the ground at (x, z) is cut down for a bed (reads terrainRaw only). */
  carveDepth(x, z) {
    const l = this.cvCells.get(Math.floor(x / 16) * 100003 + Math.floor(z / 16));
    if (!l) return 0;
    let best = 0, raw = null;
    for (let q = 0; q < l.length; q++) {
      const s = this.cvS[l[q]];
      const dx = x - s.x, dz = z - s.z;
      const al = dx * s.fx + dz * s.fz;
      if (al > 1.05 || al < -1.05) continue;
      const d = Math.abs(dx * s.lx + dz * s.lz);
      if (d > s.r) continue;
      if (raw === null) raw = G.terrainRaw(x, z);
      const dep = raw - (s.fl + (d > s.w ? d - s.w : 0));
      if (dep > best) best = dep;
    }
    return best;
  }

  /** Oriented rects no building may stand in (citygen): the lines' corridors, the other tracks. */
  clearZones() {
    const out = [];
    for (const line of this.lines) {
      const tr = line.tr;
      for (let s = 0; s < tr.len; s += 16) {
        const pp = this.ppAt(line, s + 8), o = pp ? pp.off / 2 : 0;
        const F = frame(tr, s + 8, o);
        out.push({ x: F.x, z: F.z, hw: 6.0 + Math.abs(o), hd: 9.5, rot: -tr.heading(s + 8), y: -1e9 });
      }
    }
    for (const pts of this.statics) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1) continue;
        out.push({ x: (ax + bx) / 2, z: (az + bz) / 2, hw: 2.6, hd: L / 2 + 0.5, rot: -Math.atan2(bx - ax, bz - az), y: -1e9 });
      }
    }
    return out;
  }

  /** Is (x, z) on a track's open corridor (no trees, props or parked cars)? */
  keepClear(x, z) {
    if (!this.corrCells.has(Math.floor(x / 40) * 100003 + Math.floor(z / 40))) return false;
    for (const line of this.lines) {
      const q = line.tr.nearest(x, z, 14);
      if (!q) continue;
      const pp = this.ppAt(line, q.s), lat = q.side * q.d, o = ppOff(pp, q.s);
      if (Math.min(Math.abs(lat), Math.abs(lat - o)) < 5.6) return true;
    }
    const l = this.stCells.get(Math.floor(x / 40) * 100003 + Math.floor(z / 40));
    if (l) {
      for (const pi of l) {
        const pts = this.statics[pi];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
          const sx = bx - ax, sz = bz - az, l2 = sx * sx + sz * sz || 1;
          const t = clamp(((x - ax) * sx + (z - az) * sz) / l2, 0, 1);
          if (Math.hypot(ax + sx * t - x, az + sz * t - z) < 3.2) return true;
        }
      }
    }
    return false;
  }

  /** The city is built: the ground under the profile, speed limits, the crossings, the stations. */
  attach(city, waterAt) {
    this.city = city;
    this.waterAt = waterAt;
    for (const line of this.lines) {
      const tr = line.tr;
      tr.GR.set(memo(`kwrail:ground:${line.key}`, () => {
        const gr = new Float64Array(tr.n);
        for (let i = 0; i < tr.n; i++) gr[i] = G.terrainHeight(tr.X[i], tr.Z[i]);
        return gr;
      }, (v) => v instanceof Float64Array && v.length === tr.n));
      // the stations: where each stands along the line, and its platform's side
      for (const st of this.data.lines.find((l) => l.key === line.key).stops || []) {
        const q = tr.nearest(st.x, st.z, 120);
        if (!q) continue;
        line.stops.push({ name: st.name, s: q.s, side: q.d > 2 ? q.side : 1, x: st.x, z: st.z });
      }
      line.stops.sort((a, b) => a.s - b.s);
      // the platforms OSM maps beside the line: their extent and side
      for (const pl of this.data.platforms || []) {
        const qs = pl.pts.map(([x, z]) => tr.nearest(x, z, 16)).filter(Boolean);
        if (qs.length < 2) continue;
        const s0 = Math.min(...qs.map((q) => q.s)), s1 = Math.max(...qs.map((q) => q.s));
        const lat = qs.reduce((a, q) => a + q.side * q.d, 0) / qs.length;
        const st = line.stops.find((t) => t.s > s0 - 80 && t.s < s1 + 80);
        if (st && !st.plat && s1 - s0 > 30) st.plat = { s0, s1, lat };
      }
      for (const st of line.stops) {
        if (!st.plat) st.plat = { s0: st.s - 25, s1: st.s + 25, lat: st.side * 4.2 };
        st.mid = (st.plat.s0 + st.plat.s1) / 2;
        // the track beside the platform: the passing place's if it is nearer
        const pp = this.ppAt(line, st.mid);
        st.pp = pp;
        st.track = pp && Math.sign(st.plat.lat) === Math.sign(pp.off) && Math.abs(st.plat.lat) > Math.abs(pp.off) * 0.6 ? 1 : 0;
      }
      // speed limits: the line's, slower round a station and in curves
      const n = tr.n, LIM = new Float32Array(n), P = this.P;
      for (let i = 0; i < n; i += 10) {
        let v = line.vMax;
        for (const st of line.stops) if (Math.abs(i - st.mid) < STATION_R && line.key === 'guelph') v = Math.min(v, STATION_V);
        let kk = 0;
        for (let j = Math.max(0, i - 20); j <= Math.min(n - 1, i + 20); j++) kk = Math.max(kk, Math.abs(tr.K[j]));
        if (kk > 1e-4) v = Math.min(v, Math.max(5, Math.sqrt(P.aLat / kk)));
        for (let j = i; j < Math.min(n, i + 10); j++) LIM[j] = v;
      }
      tr.LIM = LIM;
    }
    this.gradeCells = new Set();
    for (const line of this.lines) {
      const tr = line.tr;
      for (let i = 0; i < tr.n; i += 8) {
        if (tr.KD[i] === DECK) continue;
        const cx = Math.floor(tr.X[i] / 50), cz = Math.floor(tr.Z[i] / 50);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.gradeCells.add((cx + dx) * 100003 + cz + dz);
      }
    }
    this._findCrossings();
    this._staticCrossings();
  }

  /** The nearest road carriageway crossing heading h at (x, z), or null. */
  _roadAt(x, z, h) {
    const city = this.city;
    let best = null, bd = 1e9;
    for (const ei of city.edgesNear(x, z, 30)) {
      const e = city.edges[ei];
      if (e.tunnel || e.elev || e.prof) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz || 1;
      const t = clamp(((x - a.x) * sx + (z - a.z) * sz) / l2, 0, 1);
      const d = Math.hypot(a.x + sx * t - x, a.z + sz * t - z);
      const cr = Math.abs(e.dx * Math.cos(h) - e.dz * Math.sin(h));
      if (d < e.hw + 2 && cr > 0.42 && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** The lines' level crossings: gates and lights (active), with the road each carries. */
  _findCrossings() {
    const out = [];
    for (const line of this.lines) {
      const tr = line.tr;
      for (let i = 0; i < tr.n;) {
        if (!tr._X[i]) { i++; continue; }
        let j = i;
        while (j < tr.n && tr._X[j]) j++;
        const m = (i + j - 1) >> 1;
        const pp = this.ppAt(line, m), o = ppOff(pp, m);
        const F = frame(tr, m, o / 2);
        const road = this._roadAt(tr.X[m], tr.Z[m], tr.H[m]);
        i = j;
        if (!road) continue;
        // a crossing's every track; the spur's quiet country roads get lights only
        const gated = line.key !== 'spur' || road.hw > 3.4;
        out.push({ line, s: m, x: F.x, z: F.z, h: tr.H[m], road, spread: Math.abs(o), gated, passive: false,
          active: false, arm: 0, flash: 0, bellT: 0, lightT: 0, gates: [] });
      }
    }
    this.crossings = out;
    this._indexCrossings();
  }

  /** Every other track's road crossings: a crossbuck each way, nothing more. */
  _staticCrossings() {
    const found = [];
    this.statics.forEach((pts) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        for (let d = 0; d < L; d += 4) {
          const x = ax + (bx - ax) * d / L, z = az + (bz - az) * d / L;
          if (!this.city.onRoad(x, z, 0, false, false)) continue;
          if (found.some((c) => Math.hypot(c.x - x, c.z - z) < 25)) continue;
          if (this.crossings.some((c) => Math.hypot(c.x - x, c.z - z) < 40)) continue;
          const h = Math.atan2(bx - ax, bz - az);
          const road = this._roadAt(x, z, h);
          if (!road) continue;
          found.push({ line: null, s: 0, x, z, h, road, spread: 0, gated: false, passive: true, active: false, arm: 0, gates: [] });
        }
      }
    });
    this.crossings.push(...found);
    this._indexCrossings();
  }

  _indexCrossings() {
    this.crossCells = new Map();
    this.crossings.forEach((c, i) => {
      if (c.passive) return;
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
    const L = this.lazy = new LazyChunks(CHUNK, (sink) => {
      const mk = (uv) => (sink ? new SinkBuilder() : new ChunkBuilder(uv, 64));
      return { bed: mk(true), flat: mk(false), near: mk(false), dec: mk(true) };
    });
    const chunk = L.record;
    for (const line of this.lines) this._buildTrack(line, chunk, null, L);
    this.statics.forEach((pts, i) => { L.op({ st: i }); this._buildStatic(pts, chunk); });
    this.crossings.forEach((c, ci) => { L.op({ cross: ci }); this._buildCrossing(c, chunk); });
    this.lines.forEach((line, li) => line.stops.forEach((st, si) => { L.op({ stn: [li, si] }); this._buildStation(line, st, chunk); }));
    L.op(null);
    this.group = new THREE.Group(); this.group.name = 'kwrail';
    for (const e of L.chunks) { e.bed = e.flat = e.near = e.dec = null; this.chunks.push(e); }
    scene.add(this.group);
    this._buildGateArms(scene);
    if (this.city && this.city.setLandmarkSolids && this.solids.length) {
      this.city.setLandmarkSolids([...(this.city.landmarkSolids || []), ...this.solids]);
    }
  }

  _lazySys() {
    if (this._sys) return this._sys;
    const parts = ['bed', 'flat', 'near', 'dec'];
    this._sys = {
      run: (o, fn) => {
        const keep = this.solids;
        this.solids = [];
        try {
          if (o.seg) this._buildTrack(this.byKey[o.t], fn, o);
          else if (o.st !== undefined) this._buildStatic(this.statics[o.st], fn);
          else if (o.cross !== undefined) {
            const c = this.crossings[o.cross], gates = c.gates;
            try { this._buildCrossing(c, fn); } finally { c.gates = gates; }
          } else if (o.stn) { const line = this.lines[o.stn[0]]; this._buildStation(line, line.stops[o.stn[1]], fn); }
        } finally { this.solids = keep; }
      },
      finish: (e, B) => {
        const key = e.key, mats = this.world.mats, dec = railDecals();
        const mk = (b, mat, name, shadow) => {
          if (b.empty) return null;
          const m = new THREE.Mesh(b.build(), mat);
          m.name = name; m.castShadow = shadow; m.receiveShadow = shadow;
          m.matrixAutoUpdate = false;
          if (this.dropArrays) dropStaticArrays(m);
          this.group.add(m);
          return m;
        };
        e.bed = mk(B.bed, this.bedMat, `kwrail:bed:${key}`, false);
        e.flat = mk(B.flat, mats.flat, `kwrail:${key}`, true);
        e.near = mk(B.near, mats.flat, `kwrail:near:${key}`, false);
        e.dec = mk(B.dec, dec.mat, `kwrail:signs:${key}`, false);
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
        if (e.bed) e.bed.visible = d < RANGE.bed;
        if (e.flat) e.flat.visible = d < RANGE.flat;
        if (e.near) e.near.visible = d < RANGE.near;
        if (e.dec) e.dec.visible = d < RANGE.gate + 200;
      },
    };
    return this._sys;
  }

  /** Every chunk built now (harnesses). */
  buildAllChunks() { for (const e of this.chunks) if (!e.built) this.lazy.now(e, this._lazySys()); }

  /** One line's bed, rails and bridges, and its passing places' tracks beside it. */
  _buildTrack(line, chunk, only = null, L = null) {
    const tr = line.tr, P = this.P, DS = 4;
    const gauge = P.gauge / 2 + 0.035;
    const segs = Math.ceil(tr.len / DS);
    let pierNext = 0;
    const rails = (b, A, B, flush) => {
      for (const o of [-gauge, gauge]) {
        band(b, A, B, o - 0.036, 0, o + 0.036, 0, UP, C.railTop);
        if (!flush) for (const sg of [-1, 1]) band(b, A, B, o + 0.036 * sg, 0, o + 0.075 * sg, -0.18, side(A, sg), C.railSide);
      }
    };
    const seg = (k) => {
      const s0 = k * DS, s1 = Math.min(tr.len, s0 + DS), sm = (s0 + s1) / 2;
      if (L) L.segment(line.key, k, pierNext);
      const A = frame(tr, s0), B = frame(tr, s1);
      const kind = tr.kind(sm);
      const c = chunk(tr.x(sm), tr.z(sm));
      const v0 = s0 / 2.4, v1 = s1 / 2.4;
      const pp = this.ppAt(line, sm);
      const oA = ppOff(pp, s0), oB = ppOff(pp, s1);
      const twin = pp && (Math.abs(oA) > 0.05 || Math.abs(oB) > 0.05);
      const TA = twin ? frame(tr, s0, oA) : null, TB = twin ? frame(tr, s1, oB) : null;
      const sgn = pp ? Math.sign(pp.off) : 1;
      if (kind === CROSS) {
        // rubber panels flush with the rail heads, across both tracks
        const lo = Math.min(-2.4, Math.min(oA, oB) - 2.4), hi = Math.max(2.4, Math.max(oA, oB) + 2.4);
        band(c.flat, A, B, lo, -0.03, hi, -0.03, UP, C.paving);
        for (const o of [-0.62, 0.62]) band(c.flat, A, B, o - 0.1, -0.025, o + 0.1, -0.025, UP, [0.1, 0.1, 0.1]);
        rails(c.near, A, B, true);
        if (twin) rails(c.near, TA, TB, true);
      } else {
        c.bed.quad(at(A, -1.7, -0.18), at(A, 1.7, -0.18), at(B, 1.7, -0.18), at(B, -1.7, -0.18), UP, [0, v0, 1, v0, 1, v1, 0, v1], [1, 1, 1]);
        if (twin) {
          c.bed.quad(at(TA, -1.7, -0.18), at(TA, 1.7, -0.18), at(TB, 1.7, -0.18), at(TB, -1.7, -0.18), UP, [0, v0, 1, v0, 1, v1, 0, v1], [1, 1, 1]);
          // the ballast between the two beds
          const fA = Math.abs(oA) > 3.4, fB = Math.abs(oB) > 3.4;
          if (fA || fB) {
            const bu = [BALLAST_U[0], v0, BALLAST_U[1], v0, BALLAST_U[1], v1, BALLAST_U[0], v1];
            c.bed.quad(at(A, 1.7 * sgn, -0.18), at(A, oA - 1.7 * sgn, -0.18), at(B, oB - 1.7 * sgn, -0.18), at(B, 1.7 * sgn, -0.18), UP, bu, [0.92, 0.9, 0.86]);
          }
        }
        if (kind === FILL) {
          // ballast shoulders to 3.6 m, down to the formation; an embankment
          // (earth at 1:1.5) where the ground is lower than that
          for (const sg of [1, -1]) {
            const twinSide = twin && sg === sgn;
            const FA = twinSide ? TA : A, FB = twinSide ? TB : B;
            const yA = FA.y - 0.62, yB = FB.y - 0.62;
            c.bed.quad(at(FA, 1.7 * sg, -0.18), atY(FA, 3.6 * sg, yA), atY(FB, 3.6 * sg, yB), at(FB, 1.7 * sg, -0.18), [FA.lx * sg * 0.3, 1, FA.lz * sg * 0.3], [0.02, v0, 0.05, v0, 0.05, v1, 0.02, v1], [0.9, 0.88, 0.84]);
            const gA = G.terrainHeight(FA.x + FA.lx * 3.6 * sg, FA.z + FA.lz * 3.6 * sg), gB = G.terrainHeight(FB.x + FB.lx * 3.6 * sg, FB.z + FB.lz * 3.6 * sg);
            if (gA < yA - 0.15 || gB < yB - 0.15) {
              const ea = 3.6 + 1.5 * Math.max(0, yA - gA), eb = 3.6 + 1.5 * Math.max(0, yB - gB);
              const tA = G.terrainHeight(FA.x + FA.lx * ea * sg, FA.z + FA.lz * ea * sg) - 0.15, tB = G.terrainHeight(FB.x + FB.lx * eb * sg, FB.z + FB.lz * eb * sg) - 0.15;
              c.flat.quad(atY(FA, 3.6 * sg, yA), atY(FB, 3.6 * sg, yB), atY(FB, eb * sg, Math.min(tB, yB)), atY(FA, ea * sg, Math.min(tA, yA)), [FA.lx * sg * 0.55, 1, FA.lz * sg * 0.55], uv0, C.earth);
            }
          }
        }
        rails(c.near, A, B, false);
        if (twin) rails(c.near, TA, TB, false);
      }
      // a bridge: plate girders on concrete piers
      if (kind === DECK) {
        const lo = Math.min(-2.2, Math.min(oA, oB) - 2.2), hi = Math.max(2.2, Math.max(oA, oB) + 2.2);
        band(c.flat, A, B, lo, -0.25, hi, -0.25, UP, C.timber);
        for (const [W, sg] of [[hi, 1], [lo, -1]]) {
          band(c.flat, A, B, W, -0.25, W, -2.1, side(A, sg), C.girder);
          band(c.flat, A, B, W - 0.25 * sg, -2.1, W + 0.25 * sg, -2.1, DOWN, C.girder);
          band(c.flat, A, B, W - 0.2 * sg, -0.25, W + 0.2 * sg, -0.25, UP, C.girder);
          band(c.flat, A, B, W + 0.05 * sg, 0.9, W + 0.1 * sg, 0.9, UP, C.steel);
          if (Math.floor(s0 / 3) !== Math.floor(s1 / 3)) {
            const T = frame(tr, Math.floor(s1 / 3) * 3);
            c.flat.box(T.x + T.lx * (W + 0.08 * sg), T.y - 0.25, T.z + T.lz * (W + 0.08 * sg), 0.08, 1.15, 0.08, -T.h, C.steel);
          }
        }
        band(c.flat, A, B, lo, -2.1, hi, -2.1, DOWN, C.girder);
        if (sm >= pierNext) {
          pierNext = sm + 24;
          const Pf = frame(tr, sm, (oA + oB) / 4);
          const wl = this.waterAt ? this.waterAt(Pf.x, Pf.z) : null;
          const base = Math.min(G.terrainHeight(Pf.x, Pf.z), wl !== null ? wl - 3 : Infinity) - 1;
          const top = Pf.y - 2.1;
          if (top - base > 1) {
            c.flat.box(Pf.x, base, Pf.z, hi - lo + 1.0, top - base, 1.8, -Pf.h, C.concrete);
            c.flat.box(Pf.x, top - 0.6, Pf.z, hi - lo + 1.6, 0.6, 2.2, -Pf.h, C.concreteL);
            this.solids.push({ x: Pf.x, z: Pf.z, r: 1.4, y0: base, y1: top });
          }
        }
      }
    };
    if (only) {
      for (let i = 0; i < only.k.length; i++) { pierNext = only.st[i]; seg(only.k[i]); }
      return;
    }
    for (let k = 0; k < segs; k++) seg(k);
  }

  /** A spur or yard track: on the ground, flush across a road, not over water. */
  _buildStatic(pts, chunk) {
    const gauge = this.P.gauge / 2 + 0.035;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      // not where it is a running line (a switch's approach) or over water
      const onLine = this.lines.some((line) => {
        const q = line.tr.nearest(mx, mz, 6);
        if (!q) return false;
        const o = ppOff(this.ppAt(line, q.s), q.s), lat = q.side * q.d;
        return Math.min(Math.abs(lat), Math.abs(lat - o)) < 3.0;
      });
      if (onLine || G.isWater(mx, mz)) { acc += L; continue; }
      const road = this.city.onRoad(mx, mz, 0, false, false);
      const h = Math.atan2(bx - ax, bz - az), lx = Math.cos(h), lz = -Math.sin(h);
      const c = chunk(mx, mz);
      const lift = road ? 0.03 : 0.42;
      const A = { x: ax, z: az, y: G.terrainHeight(ax, az) + lift, lx, lz }, B = { x: bx, z: bz, y: G.terrainHeight(bx, bz) + lift, lx, lz };
      const v0 = acc / 2.4, v1 = (acc + L) / 2.4;
      if (!road) c.bed.quad(at(A, -1.7, -0.16), at(A, 1.7, -0.16), at(B, 1.7, -0.16), at(B, -1.7, -0.16), UP, [0, v0, 1, v0, 1, v1, 0, v1], [0.92, 0.9, 0.86]);
      for (const o of [-gauge, gauge]) {
        band(c.near, A, B, o - 0.035, 0, o + 0.035, 0, UP, C.railTop);
        if (!road) for (const sg of [-1, 1]) band(c.near, A, B, o + 0.035 * sg, 0, o + 0.07 * sg, -0.16, [lx * sg, 0, lz * sg], C.railSide);
      }
      acc += L;
    }
  }

  /**
   * A crossing's masts: flashing lights, the gate mechanism (where gated), the
   * bilingual crossbuck [TC] and the number of tracks under it; on a spur only
   * the crossbuck on its post.
   */
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
      const hx = -a * rdx, hz = -a * rdz;
      const rx = -hz, rz = hx;
      const mx = c.x + a * rdx * clear + rx * (hw + 0.9), mz = c.z + a * rdz * clear + rz * (hw + 0.9);
      const gy = G.terrainHeight(mx, mz) + (c.passive ? 0 : 0.3);
      const face = Math.atan2(-hx, -hz);
      const fx = -hx, fz = -hz;
      const ux = Math.cos(face), uz = -Math.sin(face);
      let top;
      if (c.passive) {
        ch.flat.box(mx, gy, mz, 0.1, 3.1, 0.1, -face, C.white);
        top = gy + 2.75;
      } else {
        ch.flat.box(mx, gy, mz, 0.2, 4.3, 0.2, 0, C.white);
        ch.flat.box(mx, gy, mz, 0.6, 0.35, 0.6, 0, C.concrete);
        for (const s of [1, -1]) {
          const lx = mx + ux * 0.38 * s, lz = mz + uz * 0.38 * s;
          ch.flat.box(lx, gy + 2.55, lz, 0.36, 0.36, 0.12, -face, C.black);
          ch.flat.box(lx + fx * 0.12, gy + 2.86, lz + fz * 0.12, 0.34, 0.03, 0.2, -face, C.black);
        }
        ch.flat.box(mx, gy + 2.72, mz, 1.0, 0.06, 0.06, -face, C.black);
        top = gy + 3.7;
      }
      // the crossbuck: two boards in an X facing the traffic, RAILWAY CROSSING
      // one way and TRAVERSE DE CHEMIN DE FER the other
      for (const [cell, rot] of [['xbuckEn', 0.785], ['xbuckFr', -0.785]]) {
        const cl = cells[cell];
        if (!cl) continue;
        const cx = mx + fx * 0.14, cz = mz + fz * 0.14, cy = top;
        const w = 1.22, h = 0.23, ca = Math.cos(rot), sa = Math.sin(rot);
        const Pq = (u, v) => [cx + ux * (u * ca - v * sa), cy + (u * sa + v * ca), cz + uz * (u * ca - v * sa)];
        ch.dec.quad(Pq(-w / 2, -h / 2), Pq(w / 2, -h / 2), Pq(w / 2, h / 2), Pq(-w / 2, h / 2), [fx, 0, fz], [cl[0], cl[1], cl[2], cl[1], cl[2], cl[3], cl[0], cl[3]], [1, 1, 1]);
      }
      // more than one track: the number under the crossbuck
      if (c.spread > 2 && cells.xtracks2) {
        const cl = cells.xtracks2, cx = mx + fx * 0.13, cz = mz + fz * 0.13, cy = top - (c.passive ? 0.85 : 0.62);
        const Pq = (u, v) => [cx + ux * u, cy + v, cz + uz * u];
        ch.dec.quad(Pq(-0.24, -0.17), Pq(0.24, -0.17), Pq(0.24, 0.17), Pq(-0.24, 0.17), [fx, 0, fz], [cl[0], cl[1], cl[2], cl[1], cl[2], cl[3], cl[0], cl[3]], [1, 1, 1]);
      }
      if (c.passive) continue;
      if (c.gated) ch.flat.box(mx - rx * 0.3, gy + 0.7, mz - rz * 0.3, 0.45, 0.8, 0.45, 0, C.steelD);
      this.solids.push({ x: mx, z: mz, r: 0.35, y0: gy, y1: gy + 4.3 });
      const len = Math.max(3, hw + 0.4);
      c.gates.push({ px: mx - rx * 0.3, py: gy + 1.1, pz: mz - rz * 0.3, dx: -rx, dz: -rz, len, lx: mx, ly: gy + 2.55, lz: mz, face, arm: c.gated });
    }
  }

  /**
   * A station: Kitchener's long low platform with its tactile edge, the
   * mini-high platform, shelters and name boards; WCR's timber platforms.
   */
  _buildStation(line, st, chunk) {
    const tr = line.tr, cells = railDecals().cells;
    const pl = st.plat, sg = Math.sign(pl.lat) || 1;
    const big = line.key === 'guelph';
    const trackO = (s) => (st.track === 1 ? ppOff(st.pp, s) : 0);
    const inner = 1.75, outer = big ? 6.5 : 4.2, topY = big ? 0.22 : 0.3;
    const DS = 6;
    for (let s = pl.s0; s < pl.s1 - 0.5; s += DS) {
      const s1 = Math.min(pl.s1, s + DS);
      const A = frame(tr, s, trackO(s)), B = frame(tr, s1, trackO(s1));
      const c = chunk(A.x, A.z);
      const col = big ? C.plat : C.woodL;
      band(c.flat, A, B, inner * sg, topY, outer * sg, topY, UP, col);
      band(c.flat, A, B, inner * sg, topY, inner * sg, -0.6, side(A, -sg), C.concreteD);
      band(c.flat, A, B, outer * sg, topY, outer * sg, -0.8, side(A, sg), C.concreteD);
      if (big) band(c.flat, A, B, (inner + 0.05) * sg, topY + 0.01, (inner + 0.65) * sg, topY + 0.01, UP, C.tactile);
    }
    const midS = (pl.s0 + pl.s1) / 2;
    const F = frame(tr, midS, trackO(midS));
    const c = chunk(F.x, F.z);
    const yaw = -F.h;
    const pt = (s, o) => { const Q = frame(tr, s, trackO(s)); return [Q.x + Q.lx * o * sg, Q.y, Q.z + Q.lz * o * sg, Q]; };
    if (big) {
      // the mini-high platform for the wheelchair car, with its ramp
      const [mxh, myh, mzh, Q] = pt(midS + 40, (inner + 3.4) / 2 + 0.1);
      c.flat.box(mxh, myh - 0.6, mzh, 3.4, 1.85, 16, -Q.h, C.concreteL);
      c.flat.box(mxh + Q.lx * sg * 1.65, myh + 1.25, mzh + Q.lz * sg * 1.65, 0.05, 1.0, 16, -Q.h, C.steel);
      this.solids.push({ x: mxh, z: mzh, r: 1.6, y0: myh - 0.6, y1: myh + 1.25 });
      // shelters: glass boxes under a flat roof, every 70 m
      for (let s = pl.s0 + 40; s < pl.s1 - 30; s += 70) {
        const [x, y, z, Q2] = pt(s, 4.8);
        const yy = y + topY;
        c.flat.box(x, yy, z, 1.6, 2.4, 6, -Q2.h, C.glassG);
        c.flat.box(x, yy + 2.4, z, 2.2, 0.15, 6.6, -Q2.h, C.roofG);
        this.solids.push({ x, z, r: 1.0, y0: yy, y1: yy + 2.5 });
      }
    }
    // name boards on posts along the platform
    const cell = cells[big ? 'stnKitchener' : `stnWcr${line.stops.indexOf(st)}`];
    for (let s = pl.s0 + 15; s < pl.s1 - 5; s += big ? 90 : 60) {
      const [x, y, z, Q] = pt(s, outer - 0.6);
      const yy = y + topY;
      for (const d of [-0.9, 0.9]) c.flat.box(x + Q.fx * d, yy, z + Q.fz * d, 0.08, 2.2, 0.08, yaw, C.steelD);
      c.flat.box(x, yy + 1.7, z, 0.06, 0.5, 2.0, yaw, C.steelD);
      if (cell) {
        for (const e of [-1, 1]) {
          const nx = Q.lx * sg * e, nz = Q.lz * sg * e;
          const cx = x + nx * 0.035, cz = z + nz * 0.035, cy = yy + 1.95;
          // the board reads left to right from the side it faces
          const ux = Q.fx * e * sg, uz = Q.fz * e * sg;
          const Pq = (u, v) => [cx - ux * u, cy + v, cz - uz * u];
          c.dec.quad(Pq(-0.95, -0.22), Pq(0.95, -0.22), Pq(0.95, 0.22), Pq(-0.95, 0.22), [nx, 0, nz], [cell[0], cell[1], cell[2], cell[1], cell[2], cell[3], cell[0], cell[3]], [1, 1, 1]);
        }
      }
    }
  }

  /** Every gate arm and lamp in one instanced draw each; posed per frame near you. */
  _buildGateArms(scene) {
    const n = this.crossings.reduce((a, c) => a + c.gates.length, 0);
    if (!n) return;
    const b = new Builder(false);
    const N = 8;
    for (let i = 0; i < N; i++) b.box((i + 0.5) / N, -0.05, 0, 1 / N, 0.1, 0.1, 0, i % 2 ? C.red : C.white);
    b.box(-0.08, -0.12, 0, 0.16, 0.24, 0.22, 0, C.steelD);
    this.armMesh = new THREE.InstancedMesh(b.build(), this.world.mats.flat, n);
    this.armMesh.name = 'kwrail:gates';
    this.armMesh.frustumCulled = false;
    this.armMesh.count = 0;
    scene.add(this.armMesh);
    const lb = new Builder(false);
    lb.box(0, -0.13, 0, 0.26, 0.26, 0.04, 0, [1.0, 0.1, 0.05]);
    this.lampMesh = new THREE.InstancedMesh(lb.build(), this.world.mats.glow, n * 2);
    this.lampMesh.name = 'kwrail:lamps';
    this.lampMesh.frustumCulled = false;
    this.lampMesh.count = 0;
    scene.add(this.lampMesh);
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YZX');
    this._v = new THREE.Vector3(); this._sc = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
  }

  // --- trains -------------------------------------------------------------------

  makeTrains(scene) {
    const A = vehicleAssets();
    this.freightMat = weatheredBody(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.55, envMapIntensity: 1.0 }));
    this.paxMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.42, envMapIntensity: 1.0 });
    this.trimMat = A.trimMat;
    this.decMat = railDecals().mat;
    this.fleet = FLEET.filter((f) => this.byKey[f.line]).map((f, i) => new RailTrain(this, i, this.byKey[f.line], f));
    for (const t of this.fleet) { scene.add(t.group); t.group.visible = false; }
    this._schedule();
    return this.fleet;
  }

  /**
   * THE TIMETABLE, compressed: when each train next comes onto the map. At
   * boot a few are already out -- a GO standing at Kitchener, a freight on
   * each sub, the WCR at Waterloo -- so there is something to see at once.
   */
  _schedule() {
    const T = (id) => this.fleet.find((t) => t.cfg.id === id);
    const at = (id, sec) => { const t = T(id); if (t) t.dueT = sec; };
    const g = this.byKey.guelph;
    if (g && g.stops.length) {
      const go = T('go1'), st = g.stops[0];
      // arriving westbound (toward s = 0) it stops; it leaves eastbound
      if (go && this._placeAtStop(go, st, -1)) { go.state = 'dwell'; go.dwellT = 150; go.reverseAfter = true; }
    }
    at('go2', 40); at('go3', 520); at('via', 200); at('cn1', 5); at('cn2', 330);
    const galt = this.byKey.galt;
    if (galt) {
      const t = T('cp1');
      if (t) this._placeRun(t, galt.tr.len * 0.35, 1);
      at('cp2', 150); at('cp3', 420);
    }
    const ws = this.byKey.wsub;
    if (ws) { const t = T('cpl'); if (t) this._placeRun(t, ws.tr.len * 0.5, -1); }
    const sp = this.byKey.spur;
    if (sp && sp.stops.length) {
      const t = T('wcr');
      if (t && this._placeAtStop(t, sp.stops[0], -1)) { t.state = 'dwell'; t.dwellT = 60; t.reverseAfter = true; }
    }
  }

  _placeRun(t, s, d) {
    t.d = d; t.s = s; t.u = Math.min(t.cfg.vMax, t.line.vMax) * 0.8; t.state = 'run';
    t.ori = d; t.served = new Set();
    const pp = this.ppAt(t.line, s);
    t.pp = pp; t.ppTrack = 0; if (pp) pp.hold[0] = t;
    t.commit = this._blockAt(t.line, s);
    if (!t.line.trains.includes(t)) t.line.trains.push(t);
    this.stats.spawns++;
  }
  /** Stand `t` at a stop, its centre on the platform's, having come in moving d. */
  _placeAtStop(t, st, d) {
    // the heritage train keeps its GMD-1 at the north end, leading out of Waterloo
    t.d = d; t.ori = t.cfg.kind === 'heritage' ? 1 : d; t.s = clamp(st.mid, t.len / 2 + 3, t.line.tr.len - t.len / 2 - 3); t.u = 0; t.state = 'run';
    t.served = new Set([st]); t.dwellStop = st;
    if (!t.line.trains.includes(t)) t.line.trains.push(t);
    t.pp = st.pp || null; t.ppTrack = st.pp ? st.track : 0;
    if (t.pp) t.pp.hold[t.ppTrack] = t;
    t.commit = null;
    return true;
  }

  /** Block index of s on `line` (between passing places), or -1 inside one. */
  _blockAt(line, s) {
    let i = 0;
    for (const p of line.pps) {
      if (s > p.s0 && s < p.s1) return -1;
      if (s >= p.s1) i++;
    }
    return i;
  }
  _blockRange(line, i) {
    const pp = line.pps;
    return [i === 0 ? -Infinity : pp[i - 1].s1, i === pp.length ? Infinity : pp[i].s0];
  }

  /** May a train moving d enter block i? No train in it, or bound into it, the other way. */
  _free(line, i, d, me) {
    const [a, b] = this._blockRange(line, i);
    for (const u of line.trains) {
      if (u === me || u.state === 'off' || u.d === d) continue;
      if (u.commit === i) return false;
      const lo = Math.min(u.lead, u.tail), hi = Math.max(u.lead, u.tail);
      if (hi > a && lo < b) return false;
    }
    return true;
  }

  bind(o) { Object.assign(this, { game: o.game, hud: o.hud, audio: o.audio, player: o.player }); }
  say(txt, ms) { if (this.hud) this.hud.showToast(txt, ms); }

  /** The trains out on the lines (audio.js hears the nearest two). */
  get audible() { return this.fleet ? this.fleet.filter((t) => t.state !== 'idle') : []; }

  /** Bring idle trains on when they are due and their way is clear. */
  _dispatch(dt, cx, cz) {
    for (const t of this.fleet) {
      if (t.state !== 'idle') continue;
      t.dueT -= dt;
      if (t.dueT > 0) continue;
      const line = t.line, tr = line.tr;
      // which end: GO from Guelph (the east, s = len); the rest alternate
      let d = t.nextD || (t.cfg.route === 'go' ? -1 : Math.random() < 0.5 ? 1 : -1);
      if (t.cfg.route === 'go') d = -1;
      const endIdx = d > 0 ? 0 : 1;
      if (line.ends[endIdx] !== 'edge') { t.dueT = 30; continue; }
      const blk = d > 0 ? 0 : line.pps.length;
      const s = d > 0 ? -t.len / 2 - 5 : tr.len + t.len / 2 + 5;
      // the way in is clear, nobody close behind the entry, and you are not
      // standing at the edge to watch it appear
      const ex = tr.x(d > 0 ? 0 : tr.len), ez = tr.z(d > 0 ? 0 : tr.len);
      const crowd = line.trains.some((u) => u !== t && u.state !== 'off' && u.state !== 'idle' && Math.abs(u.s - s) < t.len + u.len + 500);
      if (!this._free(line, blk, d, t) || crowd || Math.hypot(ex - cx, ez - cz) < 300) { t.dueT = 8; continue; }
      t.d = d; t.ori = d; t.s = s; t.u = Math.min(t.cfg.vMax, line.vMax) * 0.85; t.state = 'run';
      t.served = new Set(); t.pp = null; t.ppTrack = 0; t.commit = blk; t.reverseAfter = false; t.holdT = 0;
      if (!line.trains.includes(t)) line.trains.push(t);
      this.stats.spawns++;
    }
  }

  /** A train has left the map: idle until it is due back, from the end it left by. */
  _retire(t) {
    if (t.pp) { t.pp.hold[t.ppTrack] = t.pp.hold[t.ppTrack] === t ? null : t.pp.hold[t.ppTrack]; }
    t.pp = null; t.commit = null; t.state = 'idle'; t.u = 0;
    t.group.visible = false;
    const i = t.line.trains.indexOf(t);
    if (i >= 0) t.line.trains.splice(i, 1);
    t.nextD = -t.d;
    const R = t.cfg.route === 'go' ? 420 : t.cfg.kind === 'via' ? 600 : 240;
    t.dueT = R * (0.8 + Math.random() * 0.4);
  }

  /**
   * A train out of sight that has stood waiting four minutes is taken off
   * (a crossed pair of meets the dispatcher did not foresee); in sight, it
   * waits, as a real one would.
   */
  _rescue(t, cx, cz) {
    if (t.holdT < 240 || t.distTo(cx, cz) < 1600) return;
    this.stats.rescued++;
    this._retire(t);
  }

  update(dt, camera) {
    if (!this.fleet) return;
    this.time += dt;
    const cx = camera.position.x, cz = camera.position.z;
    this._dispatch(dt, cx, cz);
    for (const line of this.lines) {
      for (const t of line.trains.slice()) {
        if (t.state === 'idle') continue;
        let left = dt;
        while (left > 1e-6 && t.state !== 'idle') { const h = Math.min(0.1, left); t.service(h); left -= h; }
        if (t.state !== 'idle') this._rescue(t, cx, cz);
      }
    }
    const BUILD_R = Math.max(RANGE.flat, 900) + 300;
    this.lazy.stream(cx, cz, RANGE.near + 200, BUILD_R, BUILD_R + 700, CHUNK * 0.71, ON_PHONE ? 1.5 : 3, this._lazySys());
    for (const t of this.fleet) {
      if (t.state === 'idle') { t.group.visible = false; continue; }
      const d = t.distTo(cx, cz);
      const vis = d < RANGE.train;
      t.group.visible = vis;
      if (vis) { t.ensureGeometry(); t.pose(); }
      else if (!t._geoReady && d < RANGE.train + 1500) t.stepGeometry(ON_PHONE ? 1.5 : 3);
    }
    this._crossingsUpdate(dt, cx, cz);
    if (this.player) this._guard(dt, this.player);
    this._announce(dt);
  }

  /** On foot by a platform as a passenger train comes in: what it is. */
  _announce(dt) {
    const p = this.player;
    this._annT = (this._annT || 0) - dt;
    if (!p || !p.onFoot || this._annT > 0) return;
    for (const line of this.lines) {
      for (const t of line.trains) {
        if (t.cfg.kind === 'freight' || t.state !== 'dwell' || t.annFor === t.dwellStop) continue;
        const st = t.dwellStop;
        if (!st || Math.hypot(st.x - p.position.x, st.z - p.position.z) > 160) continue;
        t.annFor = st;
        this._annT = 20;
        const mins = Math.max(1, Math.round(t.dwellT / 60));
        const msg = t.cfg.kind === 'go' ? `GO train to Union Station — departs Kitchener in ${mins} min`
          : t.cfg.kind === 'via' ? `VIA Rail ${t.d > 0 ? 'to Toronto Union' : 'to London'} — boarding at Kitchener`
            : `Waterloo Central Railway — the heritage train at ${st.name}. All aboard in ${mins} min`;
        this.say(msg, 4500);
        return;
      }
    }
  }

  /** Gates down for any train near: arms, lamps, the bell. */
  _crossingsUpdate(dt, cx, cz) {
    let nArm = 0, nLamp = 0;
    const m = this._m4, q = this._q, e = this._e, v = this._v, scl = this._sc;
    for (const c of this.crossings) {
      if (c.passive) continue;
      let act = false;
      for (const t of c.line.trains) {
        if (t.state === 'off' || t.state === 'idle') continue;
        const ahead = (c.s - t.lead) * t.d, behindTail = (c.s - t.tail) * t.d;
        const sp = t.u;
        // a train standing 15 s short of the crossing lets the gates up
        const reach = sp < 0.05 && t.standT > 15 ? 15 : Math.max(120, sp * 25);
        if (ahead > -2 && ahead < reach) { act = true; break; }
        if (ahead <= 0 && behindTail >= -6) { act = true; break; }
      }
      c.active = act;
      c.lightT = act ? c.lightT + dt : 0;
      const want = act && c.lightT > 3 ? 1 : 0;
      c.arm = want ? Math.min(1, c.arm + dt / 7) : Math.max(0, c.arm - dt / 5);
      const d = Math.hypot(c.x - cx, c.z - cz);
      if (d > RANGE.gate || !this.armMesh) continue;
      const flashing = act || c.arm > 0.02;
      c.flash = (c.flash + dt * 1.6) % 2;
      for (const g of c.gates) {
        if (g.arm) {
          const ang = (1 - c.arm) * 1.48;
          e.set(0, Math.atan2(g.dx, g.dz) - Math.PI / 2, ang);
          q.setFromEuler(e);
          scl.set(g.len, 1, 1);
          v.set(g.px, g.py, g.pz);
          m.compose(v, q, scl);
          this.armMesh.setMatrixAt(nArm++, m);
        }
        if (flashing) {
          const sgn = c.flash < 1 ? -1 : 1;
          const lx = g.lx + Math.cos(g.face) * 0.38 * sgn, lz = g.lz - Math.sin(g.face) * 0.38 * sgn;
          const fx = Math.sin(g.face + Math.PI), fz = Math.cos(g.face + Math.PI);
          q.setFromAxisAngle(this._up, g.face);
          scl.set(1, 1, 1);
          v.set(lx + fx * 0.07, g.ly + 0.18, lz + fz * 0.07);
          m.compose(v, q, scl);
          this.lampMesh.setMatrixAt(nLamp++, m);
        }
      }
      if (flashing && this.audio && this.audio.ready) {
        c.bellT -= dt;
        if (c.bellT <= 0) {
          c.bellT = 0.52;
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

  /** For traffic.js: is (x, z) inside a crossing whose lights are on (or a train on it)? */
  blocks(x, z) {
    if (!this.crossCells) return false;
    const l = this.crossCells.get(Math.floor(x / 50) * 100003 + Math.floor(z / 50));
    if (!l) return false;
    for (const i of l) {
      const c = this.crossings[i];
      if (!c.active && c.arm < 0.05) continue;
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > 900) continue;
      const perp = Math.abs(dx * Math.cos(c.h) - dz * Math.sin(c.h));
      if (perp < c.spread / 2 + 4.6) return true;
    }
    return false;
  }

  /** A TRAIN IS SOLID ON FOOT (main.js trainBlock). */
  blockAt(x, z, y, r) {
    for (const t of this.fleet || []) {
      if (!t.group.visible || !t._geoReady || Math.hypot(t.cx - x, t.cz - z) > t.len / 2 + 20) continue;
      for (let i = 0; i < t.cars.length; i++) {
        const b = t.bones[i], p = b.position;
        if (b.scale.x < 0.5 || y < p.y - 1.2 || y > p.y + 4.9) continue;
        const dx = x - p.x, dz = z - p.z;
        const hl = t.cars[i].L / 2 + r;
        if (dx * dx + dz * dz > (hl + 2) * (hl + 2)) continue;
        _fw.set(0, 0, 1).applyQuaternion(b.quaternion);
        const l = Math.hypot(_fw.x, _fw.z) || 1, fx = _fw.x / l, fz = _fw.z / l;
        if (Math.abs(dx * fx + dz * fz) < hl && Math.abs(dx * fz - dz * fx) < 1.6 + r) return true;
      }
    }
    return false;
  }

  /** On the track at grade: the train blows for you, brakes, and cannot always stop. */
  _guard(dt, p) {
    this._hitCd = (this._hitCd || 0) - dt;
    const pv = p.vehicle;
    const x = p.position.x, z = p.position.z;
    if (!this.onGradeCorridor(x, z)) return;
    const rad = pv ? pv.halfWid * 0.9 + 0.3 : 0.35;
    for (const line of this.lines) {
      const tr = line.tr, q = tr.nearest(x, z, 12);
      if (!q) continue;
      const i = tr.idx(q.s);
      if (tr.KD[i] === DECK) continue;
      if (Math.abs((pv ? pv.y : p.y) - tr.y(q.s)) > 2.5) continue;
      const lat = q.side * q.d;
      for (const t of line.trains) {
        if (t.state === 'idle') continue;
        const o = t.offAt(q.s);
        const dl = Math.abs(lat - o);
        const foul = dl < 1.6 + rad + 0.3;
        if (!foul) continue;
        const ahead = (q.s - t.lead) * t.d;
        const within = (q.s - t.tail) * t.d > -1 && ahead < 1;
        if (ahead > 0 && ahead < Math.max(300, t.u * 25)) t.warn();
        if (ahead > 0 && ahead < 60 + t.u * t.u / (2 * 0.9) * 1.3) t.obstruct(ahead);
        if (within && t.u > 0.3 && this._hitCd <= 0) {
          this._hitCd = 1;
          const h = tr.H[i], lx = Math.cos(h), lz = -Math.sin(h);
          const sg = lat >= o ? 1 : -1, push = 1.6 + rad + 0.4 - dl;
          if (pv) {
            pv.x += lx * sg * push; pv.z += lz * sg * push; pv.vLong *= 0.2;
            if (this.game) { this.game.onCrash(t.u * 4, false); this.game.damagePlayer(t.u * 6, 'crash'); }
            if (pv.damage) pv.damage(t.u * 10, true);
            this.say(`Hit by a ${t.cfg.kind === 'freight' ? 'freight' : t.cfg.name} train!`);
          } else {
            p.x += lx * sg * push; p.z += lz * sg * push;
            if (this.game) { this.game.onCrash(t.u * 3, false); if (t.u > 1) this.game.damagePlayer(t.u * 9, 'crash'); }
          }
        }
      }
    }
  }

  /** Harness: bring a train of `line` toward crossing `ci` from ~`dist` m out (probe). */
  sendTo(ci, dist = 900) {
    const c = this.crossings[ci];
    if (!c || c.passive) return null;
    const line = c.line, tr = line.tr;
    const t = this.fleet.find((u) => u.line === line && u.state === 'idle') || line.trains[0];
    if (!t) return null;
    for (const u of line.trains.slice()) if (u !== t) this._retire(u);
    const d = c.s > tr.len / 2 ? 1 : -1;
    if (t.state !== 'idle') this._retire(t);
    t.d = d; t.ori = d; t.s = clamp(c.s - d * (dist + t.len / 2), t.len / 2 + 1, tr.len - t.len / 2 - 1);
    t.u = Math.min(t.cfg.vMax, line.vMax) * 0.8; t.state = 'run'; t.served = new Set(line.stops); t.pp = null; t.commit = this._blockAt(line, t.s);
    t.reverseAfter = false; t.holdT = 0;
    line.trains.push(t);
    return t;
  }
}

/** Is train t wholly on the straight of passing place p (clear of both turnouts)? */
function inside(t, p) {
  const lo = Math.min(t.lead, t.tail), hi = Math.max(t.lead, t.tail);
  return lo > p.s0 + KWRAIL.ramp && hi < p.s1 - KWRAIL.ramp;
}

// ---------------------------------------------------------------------------
// A train

export class RailTrain {
  constructor(sys, id, line, cfg) {
    this.sys = sys;
    this.id = id;
    this.line = line;
    this.cfg = cfg;
    this.track = line.tr;
    this.typeName = 'train';
    this.cars = [];
    let off = 0;
    for (const raw of cfg.consist) {
      const rev = raw.startsWith('~'), type = rev ? raw.slice(1) : raw;
      const c = railCar(type);
      this.cars.push({ type, L: c.L, truckC: c.truckC, off: off + c.L / 2, rev, loco: c.kind === 'loco' });
      off += c.L + 0.12;
    }
    this.len = off - 0.12;
    this.types = this.cars.map((c) => c.type);
    this.spec = { rail: true, len: 22, wid: 3.1, roof: 4.8 };
    this.x = 0; this.y = 0; this.z = 0; this.cx = 0; this.cz = 0; this.heading = 0;
    this.vLong = 0; this.speed = 0; this.notch = 0;
    this._fwd = { x: 0, z: 1 };
    this.s = 0; this.u = 0; this.d = 1; this.ori = 1;
    this.state = 'idle'; this.dueT = 1e9; this.dwellT = 0; this.standT = 0; this.holdT = 0;
    this.pp = null; this.ppTrack = 0; this.commit = null; this.served = new Set();
    this.reverseAfter = false; this.obstructAt = Infinity;
    this.horn = { seq: null, forS: null, urgent: false };
    this.hornOn = false; this.bellOn = false; this.bellT = 0;
    this._build();
  }

  /** What audio.js reads (freight.js's names): */
  get lead() { return this.s + this.d * this.len / 2; }
  get tail() { return this.s - this.d * this.len / 2; }
  get forward() { return this._fwd; }
  get dir() { return this.d; }
  get name() { return this.cfg.name; }

  _build() {
    const sys = this.sys;
    const geo = { body: new THREE.BufferGeometry(), trim: new THREE.BufferGeometry(), decal: new THREE.BufferGeometry() };
    this._geoReady = false;
    this.bones = this.cars.map(() => new THREE.Bone());
    this.group = new THREE.Group();
    this.group.name = `kwrail:${this.cfg.id}`;
    for (const b of this.bones) this.group.add(b);
    this.group.updateMatrixWorld(true);
    const skel = new THREE.Skeleton(this.bones);
    const body = this.cfg.kind === 'freight' ? sys.freightMat : sys.paxMat;
    this.meshes = [[geo.body, body], [geo.trim, sys.trimMat], [geo.decal, sys.decMat]].map(([g, m], i) => {
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
  ensureGeometry() {
    if (this._geoReady) return;
    let geo;
    if (this._geoJob) { let r = this._geoJob.next(); while (!r.done) r = this._geoJob.next(); geo = r.value; this._geoJob = null; }
    else geo = assembleTrain(this.types);
    this._setGeometry(geo);
  }
  stepGeometry(sliceMs) {
    if (this._geoReady) return;
    if (!this._geoJob) this._geoJob = assembleTrainSteps(this.types, sliceMs);
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

  /** This train's track offset at s (a passing place's track, if it is on one). */
  offAt(s) { return this.pp && this.ppTrack === 1 ? ppOff(this.pp, s) : 0; }

  distTo(x, z) {
    const tr = this.track;
    let d = Infinity;
    for (const s of [this.lead, this.s, this.tail]) {
      const ss = clamp(s, 0, tr.len);
      d = Math.min(d, Math.hypot(tr.x(ss) - x, tr.z(ss) - z));
    }
    return d;
  }

  _point() {
    const tr = this.track;
    const sl = clamp(this.lead - this.d * 4.2, 0, tr.len);
    const F = frame(tr, sl, this.offAt(sl));
    this.x = F.x; this.z = F.z; this.y = F.y;
    const sc = clamp(this.s, 0, tr.len);
    this.cx = tr.x(sc); this.cz = tr.z(sc);
    this.heading = tr.heading(sl) + (this.d > 0 ? 0 : Math.PI);
    this._fwd.x = Math.sin(this.heading); this._fwd.z = Math.cos(this.heading);
    this.vLong = this.u; this.speed = this.u;
  }

  /** Each car on its trucks; a car beyond the line's end (coming on, going off) hidden. */
  pose() {
    const tr = this.track;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i], bone = this.bones[i];
      const sc = this.s + this.ori * (this.len / 2 - c.off);
      if (sc < 2 || sc > tr.len - 2) { bone.scale.set(0, 0, 0); bone.position.set(this.cx, -500, this.cz); continue; }
      bone.scale.set(1, 1, 1);
      const face = this.ori * (c.rev ? -1 : 1);
      const sF = sc + face * c.truckC, sR = sc - face * c.truckC;
      const A = frame(tr, clamp(sR, 0, tr.len), this.offAt(sR)), B = frame(tr, clamp(sF, 0, tr.len), this.offAt(sF));
      this._z.set(B.x - A.x, B.y - A.y, B.z - A.z).normalize();
      this._x.set(this._z.z, 0, -this._z.x).normalize();
      this._y.crossVectors(this._z, this._x);
      this._m.makeBasis(this._x, this._y, this._z);
      bone.quaternion.setFromRotationMatrix(this._m);
      bone.position.set((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    }
    this.group.updateMatrixWorld(true);
    const sc = clamp(this.s, 0, tr.len);
    for (const m of this.meshes) m.boundingSphere.center.set(this.cx, tr.y(sc) + 2.4, this.cz);
  }

  limitAt(s) {
    const tr = this.track, v = tr.LIM ? tr.LIM[tr.idx(s)] || this.line.vMax : this.line.vMax;
    return Math.min(v, this.cfg.vMax);
  }
  obstruct(ahead) { this.obstructAt = Math.min(this.obstructAt, ahead); }
  warn() {
    if (this.horn.seq && this.horn.urgent) return;
    this._hornSeq([[1, 0.9], [0, 0.25], [1, 0.9], [0, 0.25], [1, 0.9], [0, 0.25], [1, 2.4]]);
    this.horn.urgent = true;
  }

  /** The speed that still brakes, at b, to the stop ahead and every limit. */
  allowed(stopLead, b) {
    const d = this.d, lead = this.lead;
    let v = stopLead === null ? this.cfg.vMax : Math.sqrt(Math.max(0, 2 * b * Math.max(0, (stopLead - lead) * d)));
    for (let k = 0; k <= 900; k += 20) v = Math.min(v, Math.sqrt(this.limitAt(lead + d * k) ** 2 + 2 * b * k));
    for (let k = 0; k <= this.len; k += 20) v = Math.min(v, this.limitAt(lead - d * k));
    return v;
  }

  /**
   * THE DISPATCHER'S PART: the passing place ahead (or the one we are in),
   * which of its tracks we take, and whether the block beyond it is ours.
   * Returns where the lead must stop for it, or null.
   */
  _plan() {
    const sys = this.sys, line = this.line, d = this.d, lead = this.lead, b = this.cfg.dec * 0.6;
    // release the passing place once the tail is past it
    if (this.pp) {
      const p = this.pp, exit = d > 0 ? p.s1 : p.s0;
      if ((this.tail - exit) * d > 0) {
        if (p.hold[this.ppTrack] === this) p.hold[this.ppTrack] = null;
        this.pp = null; this.ppTrack = 0;
      }
    }
    // the next passing place: the one the lead is in, or the first ahead
    let k = null;
    for (const p of (d > 0 ? line.pps : [...line.pps].reverse())) {
      const exit = d > 0 ? p.s1 : p.s0;
      if ((exit - lead) * d > 0) { k = p; break; }
    }
    if (!k) { this.holdT = 0; return null; }
    const entry = d > 0 ? k.s0 : k.s1, exit = d > 0 ? k.s1 : k.s0;
    const toEntry = (entry - lead) * d;
    const nextBlk = line.pps.indexOf(k) + (d > 0 ? 1 : 0);
    const look = this.u * this.u / (2 * b) + 400;
    if (this.pp !== k) {
      if (toEntry > look) return null;
      // our station stop is here: its platform's track
      const st = line.stops.find((q) => q.pp === k && !this.served.has(q));
      const clearNow = this.commit === nextBlk || sys._free(line, nextBlk, d, this);
      // (already past the turnout -- just put on the line here -- the main only)
      let want = toEntry < 5 ? [0] : st ? [st.track, 1 - st.track] : clearNow ? [0, 1] : [1, 0];
      const pick = want.find((tk) => !k.hold[tk]);
      if (pick === undefined) {
        if (!this._heldAt) { this._heldAt = k; sys.stats.holds++; }
        return entry - d * 15;
      }
      this._heldAt = null;
      this.pp = k; this.ppTrack = pick; k.hold[pick] = this;
      if (pick === 1 && !st) sys.stats.meets++;
    }
    // in the passing place (or coming to it): is the block beyond ours?
    if (this.commit !== nextBlk) {
      const nearExit = (exit - lead) * d < this.u * this.u / (2 * b) + 250;
      const st = line.stops.find((q) => q.pp === k && !this.served.has(q));
      if (nearExit && !st && sys._free(line, nextBlk, d, this)) { this.commit = nextBlk; this.holdT = 0; return null; }
      if (!nearExit || st) return null;
      // not ours: wait in the passing place, clear of its far turnout
      return exit - d * (KWRAIL.ramp + 10);
    }
    return null;
  }

  service(dt) {
    const sys = this.sys, line = this.line, tr = this.track;
    if (this.state === 'dwell') {
      this.dwellT -= dt;
      this.u = 0; this.notch = 0;
      this.standT += dt;
      this.bellOn = this.dwellT < 6;
      if (this.dwellT <= 0) {
        this.state = 'run';
        if (this.reverseAfter) {
          // the far end of the train leads back (push-pull; WCR runs the same)
          this.d = -this.d; this.reverseAfter = false; this.commit = null;
          this.served = new Set(this.dwellStop ? [this.dwellStop] : []);
        }
        this.bellT = 5;
        this.dwellStop = null;
      }
      this._point();
      this._sounds(dt);
      return;
    }
    const d = this.d;
    let stopLead = null;
    const take = (s) => { if (s !== null && (stopLead === null || (s - stopLead) * d < 0)) stopLead = s; };
    // the next station stop on the way
    let stop = null;
    for (const st of line.stops) {
      if (this.served.has(st) || this.cfg.kind === 'freight') continue;
      if ((st.mid - this.s) * d < -5) continue;
      if (!stop || (st.mid - stop.mid) * d < 0) stop = st;
    }
    const stopAt = (st) => clamp(st.mid + d * this.len / 2, 3, tr.len - 3);
    if (stop) take(stopAt(stop));
    // a shuttle's end of line (a line with no stations): turn short of the end
    const endTurn = this.cfg.route === 'shuttle' && !line.stops.length && line.ends[d > 0 ? 1 : 0] === 'end';
    if (endTurn) take(d > 0 ? tr.len - 25 : 25);
    take(this._plan());
    // the train ahead, on the same track here
    for (const o of line.trains) {
      if (o === this || o.state === 'idle') continue;
      const lo = Math.min(o.lead, o.tail), hi = Math.max(o.lead, o.tail);
      const gapS = d > 0 ? lo - this.lead : this.lead - hi;
      if (gapS < -2 || gapS > 1500) continue;
      // in the same passing place on different tracks, or one standing clear
      // on a passing track the other is not taking: they pass
      if (o.pp && o.pp === this.pp && o.ppTrack !== this.ppTrack) continue;
      if (o.ppTrack === 1 && o.pp && inside(o, o.pp) && !(this.pp === o.pp && this.ppTrack === 1)) continue;
      if (this.ppTrack === 1 && this.pp && inside(this, this.pp) && !(o.pp === this.pp && o.ppTrack === 1)) continue;
      take(this.lead + d * (gapS - (o.d === d ? 60 : 120)));
    }
    let vAllow = this.allowed(stopLead, this.cfg.dec * 0.6);
    let emerg = false;
    if (this.obstructAt < Infinity) {
      const vo = Math.sqrt(Math.max(0, 2 * 0.6 * (this.obstructAt - 10)));
      if (this.u > vo + 0.5) emerg = true;
      vAllow = Math.min(vAllow, vo);
      this.horn.forS = null;
      if (!this.horn.seq) this._hornSeq([[1, 3.5]]);
      this.obstructAt = Infinity;
    }
    // drive: ease toward the allowed speed
    const v = this.u, left = stopLead === null ? Infinity : (stopLead - this.lead) * d;
    let a;
    if (left < 0.4) a = -this.cfg.dec * 1.6;
    else if (v < vAllow - 0.4) a = this.cfg.acc * clamp((vAllow - v) / 2, 0.3, 1);
    else if (v > vAllow + 0.05) a = -Math.min(this.cfg.dec * (emerg ? 2.2 : 1.2), (v - vAllow) * 1.5 + 0.1);
    else a = 0;
    // creep up to the mark
    if (left < 6 && left > 0.4 && v < 0.8) a = Math.max(a, 0.2);
    this.u = Math.max(0, v + a * dt);
    if (left < 0.4 && this.u < 0.3) this.u = 0;
    this.notch = a > 0.02 ? 8 * clamp(a / this.cfg.acc, 0.3, 1) : this.u > 1 ? 2 : 0;
    this.s += d * this.u * dt;
    this.standT = this.u < 0.05 ? this.standT + dt : 0;
    this.holdT = this.u < 0.05 && stopLead !== null && !(stop && Math.abs(stopAt(stop) - this.lead) < 4) ? this.holdT + dt : 0;
    // at the platform: dwell
    if (stop && this.u < 0.05 && Math.abs(stopAt(stop) - this.lead) < 3) {
      this.served.add(stop);
      this.state = 'dwell';
      this.dwellStop = stop;
      sys.stats.dwells++;
      const terminus = this.cfg.route === 'go' || (this.cfg.route === 'shuttle' && stop === (d > 0 ? line.stops[line.stops.length - 1] : line.stops[0]));
      this.dwellT = this.cfg.kind === 'go' ? 180 : this.cfg.kind === 'via' ? 75 : terminus ? 150 : 40;
      this.reverseAfter = terminus;
      if (sys.audio && sys.audio.ready) sys.audio.play('airbrake', { gain: 0.6, x: this.x, y: this.y + 2, z: this.z, ref: 14 });
    } else if (endTurn && this.u < 0.05 && Math.abs(this.lead - (d > 0 ? tr.len - 25 : 25)) < 3) {
      this.state = 'dwell'; this.dwellT = 150; this.reverseAfter = true; this.dwellStop = null;
    }
    // off the end of the map
    if ((d > 0 && this.tail > tr.len + 5) || (d < 0 && this.tail < -5)) { sys._retire(this); return; }
    this._crossingHorn();
    this._point();
    this._sounds(dt);
  }

  /** CROR 14(l) for the crossing ahead: long, long, short, long, the last held. */
  _crossingHorn() {
    const v = this.u;
    if (v < 1) return;
    let next = null, nd = Infinity;
    for (const c of this.sys.crossings) {
      if (c.line !== this.line) continue;
      const dd = (c.s - this.lead) * this.d;
      if (dd > 0 && dd < nd) { nd = dd; next = c; }
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
  _hornSeq(seq) { this.horn.seq = seq.map((x) => x.slice()); this.horn.urgent = false; }

  _sounds(dt) {
    const h = this.horn;
    if (h.seq && h.seq.length) {
      h.seq[0][1] -= dt;
      this.hornOn = h.seq[0][0] === 1;
      if (h.seq[0][1] <= 0) h.seq.shift();
      if (!h.seq.length) { h.seq = null; this.hornOn = false; h.urgent = false; }
    } else this.hornOn = false;
    this.bellT -= dt;
    this.bellOn = this.bellT > 0 || (this.state === 'dwell' && this.dwellT < 6);
  }
}

// ---------------------------------------------------------------------------
// WEATHERING, in the shader (freight.js's): grime up from the wheels, streaks,
// soot on the roofs. Freight only: the passenger fleet is kept clean.
function weatheredBody(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vRL;\nvarying vec3 vRN;\nvarying float vRK;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
\tvRL = position; vRN = objectNormal;
\t#ifdef USE_SKINNING
\tvRK = 1.0;
\t#else
\tvRK = 0.0;
\t#endif`);
    sh.fragmentShader = 'varying vec3 vRL;\nvarying vec3 vRN;\nvarying float vRK;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      float rlGrime = 0.0;
      if (vRK > 0.5) {
        float yy = vRL.y;
        float lo = 1.0 - smoothstep(0.3, 2.8, yy);
        float col = floor(vRL.z * 5.5) + floor(vRL.x * 5.5) * 37.0;
        float sh = fract(sin(col * 12.9898) * 43758.5453);
        float run = smoothstep(0.3, 1.0, fract(sin(col * 7.13 + floor(yy * 0.8) * 3.1) * 15731.743));
        float streak = step(0.6, sh) * run * (1.0 - smoothstep(2.0, 4.6, yy)) * (0.4 + 0.6 * sh);
        vec2 pp = vRL.zy * vec2(0.33, 0.55) + vRL.x * 0.21;
        float n = sin(pp.x * 2.1 + sin(pp.y * 1.7) * 1.3) * sin(pp.y * 2.6 + pp.x * 0.9) * 0.5 + 0.5;
        float roof = smoothstep(0.5, 0.9, vRN.y) * smoothstep(2.6, 4.2, yy);
        rlGrime = clamp(lo * 0.62 + streak * 0.5 + n * 0.16 + roof * 0.5, 0.0, 0.85);
        vec3 dirt = vec3(0.105, 0.078, 0.056) * (0.75 + 0.5 * n);
        diffuseColor.rgb = mix(diffuseColor.rgb, dirt, rlGrime * 0.72);
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + rlGrime * 0.4, 0.0, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      metalnessFactor *= 1.0 - rlGrime * 0.7;`);
  };
  m.customProgramCacheKey = () => 'kwrailWeathered';
  return m;
}

// A train's geometry: every car copied into one SkinnedMesh per material, a
// bone per car (vertices stay in car-local metres).
function assembleTrain(types) {
  const it = assembleTrainSteps(types, Infinity);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
function* assembleTrainSteps(types, sliceMs) {
  const out = {};
  let t0 = performance.now();
  for (const key of ['body', 'trim', 'decal']) {
    const parts = types.map((t) => railCar(t)[key]);
    let nv = 0, ni = 0;
    for (const g of parts) { nv += g.attributes.position.count; ni += g.index ? g.index.count : 0; }
    const hasUV = parts.some((g) => g.attributes.uv);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = hasUV ? new Float32Array(nv * 2) : null;
    const idx = new Uint32Array(ni);
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    let v = 0, q = 0;
    for (let ci = 0; ci < parts.length; ci++) {
      const g = parts[ci], n = g.attributes.position.count;
      if (!n) continue;
      pos.set(g.attributes.position.array, v * 3); nor.set(g.attributes.normal.array, v * 3); col.set(g.attributes.color.array, v * 3);
      if (uv && g.attributes.uv) uv.set(g.attributes.uv.array, v * 2);
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
