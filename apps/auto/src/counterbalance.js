// THE QUEEN ANNE COUNTERBALANCE: Route 26, "West Queen Anne", the streetcar
// that climbed Queen Anne Hill on a cable. It ran from 1901 to 11 August 1940.
// Rails, slot and wire are laid on today's streets, and four Stephenson cars
// of the 311-320 series run it on a timetable. You can ride one or drive it.
//
// HOW IT WORKED. Each of the two tracks between W Roy St and W Lee St had its
// own endless cable over two 10 ft sheaves. The upper run lay in a slotted
// conduit between the rails; the lower run lay in a 5 x 4 ft tunnel beneath
// and pulled a 16-ton counterweight, cast-iron slabs on two four-wheeled
// trucks, on a 30 in track at a uniform 13.7 % [EN]. At the foot or the top,
// a car stopped and the conductor dropped a forked "finger" on its truck
// into a notched steel "plow" clamped to the cable [EN]. A car going up then
// let the weight down, and was pulled up by it. A car going down hauled the
// weight back up, and was held back by it. Attendants in little boxes on the
// kerb at Roy and at Lee hooked the cars on and off [K][QA2]. Uphill cars ran
// on whichever track's weight was waiting at the top, so the tracks were not
// one-way: the 1940 photographs show the crossovers at Lee [PNR][QA2].
//
// SOURCES
//   [EN]  Engineering News, 9 Mar 1911, "A Cable Counterweight System for a
//         Steep Grade on an Electric Railway at Seattle": the 2,600 ft
//         system, the street at 13.8-18.7 %, the 13.7 % tunnels, the 16 t
//         weights, the plow and finger, a 12 min headway per track and five
//         stops each way
//   [K]   HistoryLink 20746 (Kershner): Roy St to the top, "five steep
//         blocks", up to 19 %, opened 1901 with a second track in 1902, the
//         1919 runaway near Aloha St, the 1937 race
//   [D]   HistoryLink 3027 (Dorpat): about 8 mph on the hill, cars 311-320,
//         about 20 % between Prospect St and Highland Dr
//   [F]   HistoryLink 20980: the last run, 11 Aug 1940, and the dogleg at Galer
//   [QA1] [QA2] Queen Anne Historical Society: "Counterbalance & Streetcars"
//         and "Men in Little Boxes"
//   [PNR] Pacific Northwest Railroad Archive, photographs of car 315 at
//         6th Ave W and McGraw St, and at Lee St, July 1940
//   [T]   Seattle Municipal Street Railway route list, 1 Apr 1931, as
//         transcribed at tundria.com: Route 26 "W Queen Anne"
//   est.  no source publishes it; what it was set from is said
//
// THE ROUTE [T][PNR][F]: north on 1st Ave from Pioneer Square, onto Queen
// Anne Ave N at Denny Way, up the counterbalance from Roy St to Lee St, west
// on W Galer St, north on 6th Ave W to W McGraw St, where a wye turned the
// cars. Three changes for today's streets, each said where it is made:
//   - The line ends at 1st Ave and Cherry St. In 1931 it ran three blocks
//     further, to S King St, but today's 1st Ave S is a divided road south of
//     Cherry.
//   - Northbound cars run up 1st Ave N and along Roy St. Today's lower Queen
//     Anne Ave N is one-way southbound, so only southbound cars use it.
//   - Each terminus is a stub. The double-ended cars change ends there,
//     where the real ones used a wye at McGraw.
//
// THE CARS [PNR, car 315 photographed in July 1940]: double-truck, enclosed
// and double-ended, with a railroad clerestory roof, about ten side windows
// with guard bars, folding vestibule doors, a dash headlight, the "26" route
// box on the roof and a single trolley pole. Dimensions are est., from the
// photograph against a 4 ft 8.5 in gauge: 13.4 m over the fenders, 2.54 m
// wide. Colours are est. too: the 1940 photographs are black and white, with
// a light body and a dark roof and trucks. No source gives the livery, so
// this is a period cream with dark green trim.
//
// FRAMES. Each track (`out` runs north to McGraw, `in` runs back) has its own
// s, increasing in its own direction of travel. A car's local +z points along
// its travel and y = 0 is the rail head. Each track lies CB.lat to the right
// of its street's centreline. On the hill a car may run on the other track,
// the one whose weight is at its end. It is then shifted 2 x CB.lat to its
// left, through the crossovers below Roy and above Lee.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { GLASS, tagGlass, vehicleAssets } from './vehicles.js';
import { clamp, smooth } from './util.js';
import { animateWalk } from './peds.js';

export const CB = {
  gauge: 1.435,
  lat: 1.7,            // each track right of the street's centreline: track centres 3.4 m (est., 11 ft)
  railH: 0.03,         // rail head over the pavement (flush, but it has to show)
  wire: 5.5,           // trolley wire over the rail head (est.)
  carLen: 13.4, wid: 2.54, roof: 3.66,
  truck: 3.35,         // truck centres either side of the car's centre (est.)
  vMax: 11.2,          // 25 mph in the street (est.)
  vHill: 3.6,          // ~8 mph on the cable [D]
  vX: 3.0,             // through the crossovers and into the stub ends (est.)
  aLat: 0.9,           // unbalanced lateral acceleration on curves (est.)
  acc: 1.3, brake: 1.25, brakeEmerg: 2.0,
  mass: 20,            // t, a loaded double-truck car (est.)
  cw: 16,              // t, the counterweight [EN]
  tunnel: 0.137,       // the weights' tunnel, a uniform grade [EN]
  mu: 0.16,            // wheel-rail adhesion, sanded (est.): a car alone climbs ~12 % and holds ~17 %, so not the counterbalance
  dwell: 9, termDwell: 24, hitchDwell: 5,
  hookTol: 1.0,        // the finger meets the plow within this of the mark, and the plow cannot run past it further
  cars: 4,
  numbers: [312, 315, 317, 319],   // of the 311-320 series [D][QA1][W]
};

const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
// how far the rails/wire chunks, a car, and a car's glass and brass are drawn
const RANGE = ON_PHONE ? { near: 360, car: 450, trim: 70 } : { near: 560, car: 700, trim: 110 };
// The line's geometry in 1200 m cells, the grid shifted so the whole
// counterbalance -- Roy to Lee and both crossovers -- is one cell: at the foot
// of the hill that is one draw, not three.
const CHUNK = 1200, CX0 = 1900, CZ0 = 2500;
const ZONE = 30;       // a crossover's length
const ZG = 4;          // gap between a crossover and its hitch point

// The route as way points: each leg runs to `at` along streets matching `on`
// (Dijkstra over the road graph, other streets 25x dearer, one-way streets
// only their own way).
const PT = {
  cherry: [47.60255, -122.3343],     // 1st Ave & Cherry St (the stub ends 14 m short of it)
  denny1: [47.61857, -122.35535],    // 1st Ave / 1st Ave N at Denny Way
  roy1: [47.62545, -122.35539],      // 1st Ave N & Roy St
  royQ: [47.62544, -122.35672],      // Queen Anne Ave N & Roy St
  galerQ: [47.63232, -122.35696],    // Queen Anne Ave N & W Galer St
  galer6: [47.63234, -122.36504],    // 6th Ave W & W Galer St
  mcgraw: [47.63958, -122.36496],    // 6th Ave W & W McGraw St
  dennyQ: [47.61859, -122.35675],    // Queen Anne Ave N & Denny Way
};
export const LEGS = {
  out: [PT.cherry, [/^1st Avenue$/, PT.denny1], [/^1st Avenue North$/, PT.roy1], [/Roy Street$/, PT.royQ],
    [/^Queen Anne Avenue North$/, PT.galerQ], [/^West Galer Street$/, PT.galer6], [/^6th Avenue West$/, PT.mcgraw]],
  in: [PT.mcgraw, [/^6th Avenue West$/, PT.galer6], [/^West Galer Street$/, PT.galerQ],
    [/^Queen Anne Avenue North$/, PT.dennyQ], [/Denny Way$/, PT.denny1], [/^1st Avenue$/, PT.cherry]],
};
// The hitch points, on Queen Anne Ave N: just above Roy (the foot, past the
// corner onto the hill) and at Lee [K][PNR]
const HITCH = { bot: [47.62598, -122.35672], top: [47.63136, -122.35662] };
// Stops: the car stands with its centre `back` metres short of the point.
// Five on the cable each way [EN]: Roy, Aloha, Highland (for Kerry Park),
// Lee, and the attendants' boxes at each end.
const STOPS = [
  { name: 'Pioneer Square', full: '1st Ave & Cherry St, Pioneer Square', term: true },
  { name: 'Madison St', at: [47.60469, -122.33625] },
  { name: 'Pike Place Market', full: '1st Ave & Pike St, for Pike Place Market', at: [47.60885, -122.34] },
  { name: 'Bell St', full: '1st Ave & Bell St, Belltown', at: [47.61338, -122.34652] },
  { name: 'Denny Way', out: [47.61857, -122.35535], in: [47.61859, -122.35675] },
  { name: 'Mercer St', out: [47.62458, -122.3554], in: [47.62458, -122.35672] },
  { name: 'Roy St', full: 'Roy St, the foot of the Counterbalance', hitch: 'bot' },
  { name: 'Aloha St', full: 'Aloha St, on the Counterbalance', at: [47.6272, -122.3567] },
  { name: 'Highland Dr', full: 'Highland Dr, for Kerry Park', at: [47.62957, -122.35664] },
  { name: 'Lee St', full: 'Lee St, the top of the Counterbalance', hitch: 'top' },
  { name: '3rd Ave W', full: 'W Galer St & 3rd Ave W', at: [47.63232, -122.36103] },
  { name: 'Blaine St', full: '6th Ave W & W Blaine St', at: [47.63474, -122.36502] },
  { name: 'McGraw St', full: '6th Ave W & W McGraw St', term: true },
];

// ---------------------------------------------------------------------------
// Routing over the road graph

export function routeNodes(city, legs) {
  const N = city.nodes, E = city.edges;
  const near = ([lat, lon]) => { const [x, z] = G.toWorld(lat, lon); return city.nearestNode(x, z, 80); };
  let cur = near(legs[0]);
  if (cur < 0) return null;
  const path = [cur];
  for (let k = 1; k < legs.length; k++) {
    const [re, at] = legs[k];
    const goal = near(at);
    if (goal < 0) return null;
    // OSM's street can be split by a metre where two ways meet without
    // sharing a node (1st Ave N at Thomas St): the leg's own street's nodes
    // within 3 m of each other are joined
    const cell = new Map(), bridge = new Map();
    for (const e of E) {
      if (!re.test(e.name || '')) continue;
      for (const n of [e.a, e.b]) {
        const key = `${Math.floor(N[n].x / 3)},${Math.floor(N[n].z / 3)}`;
        let c = cell.get(key);
        if (!c) cell.set(key, (c = new Set()));
        c.add(n);
      }
    }
    for (const c of cell.values()) {
      for (const n of c) {
        const cx = Math.floor(N[n].x / 3), cz = Math.floor(N[n].z / 3);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          const o = cell.get(`${cx + i},${cz + j}`);
          if (!o) continue;
          for (const m of o) {
            if (m === n || Math.hypot(N[m].x - N[n].x, N[m].z - N[n].z) > 3) continue;
            if (!bridge.has(n)) bridge.set(n, []);
            bridge.get(n).push(m);
          }
        }
      }
    }
    // Dijkstra (a binary heap: a leg is a few hundred nodes)
    const dist = new Map([[cur, 0]]), prev = new Map(), heap = [[0, cur]];
    const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    let found = false;
    while (heap.length) {
      const [d, n] = pop();
      if (d > dist.get(n)) continue;
      if (n === goal) { found = true; break; }
      if (d > 20000) break;
      for (const ei of N[n].e) {
        const e = E[ei];
        if (e.cls === 'hwy' || e.cls === 'ramp' || e.tunnel || e.elev) continue;
        const fwd = e.a === n, m = fwd ? e.b : e.a;
        if ((e.oneway && !fwd) || (e.onewayRev && fwd)) continue;
        const nd = d + e.len * (re.test(e.name || '') ? 1 : 25);
        if (nd < (dist.has(m) ? dist.get(m) : Infinity)) { dist.set(m, nd); prev.set(m, n); push([nd, m]); }
      }
      for (const m of bridge.get(n) || []) {
        const nd = d + Math.hypot(N[m].x - N[n].x, N[m].z - N[n].z);
        if (nd < (dist.has(m) ? dist.get(m) : Infinity)) { dist.set(m, nd); prev.set(m, n); push([nd, m]); }
      }
    }
    if (!found) return null;
    const seg = [];
    for (let n = goal; n !== cur; n = prev.get(n)) seg.push(n);
    seg.reverse();
    path.push(...seg);
    cur = goal;
  }
  return path;
}

/** The road's half-width along a node path (the edge between each pair). */
function pathWidths(city, path) {
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.max(1, i)];
    let hw = out.length ? out[out.length - 1] : 5;   // a bridged gap: the street's width before it
    for (const ei of city.nodes[b].e) { const e = city.edges[ei]; if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) { hw = e.hw; break; } }
    out.push(hw);
  }
  return out;
}

// Rounds every corner of a polyline [[x, z, hw], ...] with a quadratic
// curve of radius up to `rMax(theta)`, never using more than 48 % of either
// segment, then resamples it every `step` metres.
function filletResample(P, step) {
  const pts = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (l1 < 0.01 || l2 < 0.01) continue;
    const d1 = [(b[0] - a[0]) / l1, (b[1] - a[1]) / l1], d2 = [(c[0] - b[0]) / l2, (c[1] - b[1]) / l2];
    const th = Math.acos(clamp(d1[0] * d2[0] + d1[1] * d2[1], -1, 1));
    if (th < 0.02) { pts.push(b); continue; }
    const t = Math.tan(th / 2);
    const r = Math.min(th > 0.5 ? 20 : 160, (0.48 * Math.min(l1, l2)) / t);
    const k = r * t;
    const p1 = [b[0] - d1[0] * k, b[1] - d1[1] * k], p2 = [b[0] + d2[0] * k, b[1] + d2[1] * k];
    const n = Math.max(2, Math.ceil((th * r) / 1.5));
    const hw = Math.min(a[2], b[2], c[2]);
    for (let j = 0; j <= n; j++) {
      const u = j / n, w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u;
      pts.push([w0 * p1[0] + w1 * b[0] + w2 * p2[0], w0 * p1[1] + w1 * b[1] + w2 * p2[1], hw]);
    }
  }
  pts.push(P[P.length - 1]);
  return resample(pts, step);
}

function resample(pts, step) {
  const out = [pts[0].slice()];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    let d = step - carry;
    while (d <= l) {
      const u = d / l;
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, b[2]]);
      d += step;
    }
    carry = l - (d - step);
  }
  const last = pts[pts.length - 1], lo = out[out.length - 1];
  if (Math.hypot(last[0] - lo[0], last[1] - lo[1]) > step * 0.3) out.push(last.slice());
  return out;
}

// ---------------------------------------------------------------------------
// A track: one direction's rails, sampled every metre.

export class CBTrack {
  constructor(key, centre) {
    this.key = key;
    // the street's centreline, then the track CB.lat right of it, easing
    // onto the centreline over the last 30 m at either end (the stub ends)
    const C = filletResample(centre, 1);
    const n = C.length, off = [];
    // A 13.4 m car on a 20 m curve swings its ends ~1 m out and its middle
    // in: double track is laid wider apart round a corner, or two cars
    // meeting there would touch. Widened by up to 1 m, from 12 m before.
    const hd = (i) => { const a = C[Math.max(0, i - 1)], b = C[Math.min(n - 1, i + 1)]; return Math.atan2(b[0] - a[0], b[1] - a[1]); };
    const wid = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let dh = hd(Math.min(n - 1, i + 4)) - hd(Math.max(0, i - 4));
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      wid[i] = clamp((Math.abs(dh) / 8) * 20, 0, 1);
    }
    const widen = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = 0; for (let j = Math.max(0, i - 12); j <= Math.min(n - 1, i + 12); j++) m = Math.max(m, wid[j] * (1 - Math.abs(j - i) / 13)); widen[i] = m; }
    for (let i = 0; i < n; i++) {
      const a = C[Math.max(0, i - 1)], b = C[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const ease = smooth(clamp(Math.min(i, n - 1 - i) / 30, 0, 1));
      // right of the travel direction (sin h, cos h) is (-cos h, sin h)
      const rx = -dz / l, rz = dx / l, lat = (CB.lat + 1.0 * widen[i]) * ease;
      off.push([C[i][0] + rx * lat, C[i][1] + rz * lat, C[i][2]]);
    }
    const R = resample(off, 1);
    this.n = R.length;
    this.len = this.n - 1;
    this.X = new Float64Array(this.n); this.Z = new Float64Array(this.n); this.HW = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) { this.X[i] = R[i][0]; this.Z[i] = R[i][1]; this.HW[i] = R[i][2]; }
    this.H = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(this.n - 1, i + 2);
      this.H[i] = Math.atan2(this.X[b] - this.X[a], this.Z[b] - this.Z[a]);
    }
    this.K = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const a = Math.max(0, i - 4), b = Math.min(this.n - 1, i + 4);
      let dh = this.H[b] - this.H[a];
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      this.K[i] = Math.abs(dh) / Math.max(1, b - a);
    }
    // spatial index: samples by 16 m cell
    this.cells = new Map();
    for (let i = 0; i < this.n; i++) {
      const k = Math.floor(this.X[i] / 16) * 100003 + Math.floor(this.Z[i] / 16);
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(i);
    }
  }

  idx(s) { return clamp(Math.round(s), 0, this.n - 1); }
  _f(A, s) {
    const t = clamp(s, 0, this.len), i = Math.min(this.len - 1, Math.floor(t)), u = t - i;
    return A[i] + (A[i + 1] - A[i]) * u;
  }
  x(s) { return this._f(this.X, s); }
  z(s) { return this._f(this.Z, s); }
  y(s) { return this._f(this.Y, s); }
  heading(s) { return this.H[this.idx(s)]; }

  /** Heights: the ground under every sample (the road surface, decks and
   *  all, seeded from the sample before), and the same `2 x lat` to the left,
   *  where a car on the other hill track runs. */
  setHeights(city) {
    const n = this.n;
    const walk = (dx) => {
      const out = new Float64Array(n);
      let prev = null;
      for (let i = 0; i < n; i++) {
        const h = this.H[i], lx = Math.cos(h), lz = -Math.sin(h);
        const y = city.groundAt(this.X[i] + lx * dx, this.Z[i] + lz * dx, prev);
        out[i] = y; prev = y;
      }
      // a light smoothing: rails do not follow 40 m terrain cells' creases
      const sm = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0, c = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { s += out[j]; c++; }
        sm[i] = Math.max(out[i], s / c);
      }
      return sm;
    };
    this.Y = walk(0);
    this.YL = walk(2 * CB.lat);
  }

  /** Nearest sample to (x, z) within `maxD`: { s, d (signed, + to the left), i }. */
  nearest(x, z, maxD = 30) {
    const r = Math.ceil(maxD / 16);
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    let best = -1, bd = maxD * maxD;
    for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) {
      const c = this.cells.get(i * 100003 + j);
      if (!c) continue;
      for (const k of c) { const d = (this.X[k] - x) ** 2 + (this.Z[k] - z) ** 2; if (d < bd) { bd = d; best = k; } }
    }
    if (best < 0) return null;
    const h = this.H[best], fx = Math.sin(h), fz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
    const ex = x - this.X[best], ez = z - this.Z[best];
    return { i: best, s: clamp(best + ex * fx + ez * fz, 0, this.len), d: ex * lx + ez * lz };
  }
}

/** Cut `a` metres off the start of a polyline [[x, z, hw], ...] and `b` off its end. */
function trimPoly(P, a, b) {
  const cut = (Q, d) => {
    let acc = 0;
    for (let i = 1; i < Q.length; i++) {
      const l = Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]);
      if (acc + l >= d) {
        const u = (d - acc) / l;
        return [[Q[i - 1][0] + (Q[i][0] - Q[i - 1][0]) * u, Q[i - 1][1] + (Q[i][1] - Q[i - 1][1]) * u, Q[i][2]], ...Q.slice(i)];
      }
      acc += l;
    }
    return Q;
  };
  let Q = a > 0 ? cut(P, a) : P;
  if (b > 0) Q = cut(Q.slice().reverse(), b).reverse();
  return Q;
}

// ---------------------------------------------------------------------------
// The line

export class Counterbalance {
  constructor() {
    this.ok = false;
    this.keys = ['out', 'in'];
    this.tracks = {};
    this.cars = [];
    this.stops = [];
    // the two counterweights, by the track they run under: E is the out
    // track's own side, W the in track's. f = 1 at the top of the tunnel.
    this.weights = { E: { f: 1, car: null }, W: { f: 0, car: null } };
    // the two scissors crossovers, below Roy and above Lee: one car changing
    // sides in each at a time, and nobody else in it meanwhile (xlock)
    this.xlock = { bot: null, top: null };
    this.chunks = [];
    this.group = null;
    this.firstRide = false;
  }

  /** Lay the route on the city's road graph. Before the city's furniture
   *  and parked cars are placed (keepClear). */
  attach(city) {
    this.city = city;
    try {
      const raw = {};
      for (const k of this.keys) {
        const path = routeNodes(city, LEGS[k]);
        if (!path || path.length < 4) throw new Error(`no route for the ${k} track`);
        const hw = pathWidths(city, path);
        raw[k] = path.map((ni, i) => [city.nodes[ni].x, city.nodes[ni].z, hw[i]]);
      }
      // each end stops 14 m short of its junction's middle
      raw.out = trimPoly(raw.out, 14, 14);
      raw.in = trimPoly(raw.in, 14, 14);
      for (const k of this.keys) {
        const tr = new CBTrack(k, raw[k]);
        tr.setHeights(city);
        this.tracks[k] = tr;
      }
    } catch (e) {
      console.warn('counterbalance:', e.message);
      return;
    }
    const T = this.tracks;
    T.out.side = 'E'; T.in.side = 'W';
    T.out.other = T.in; T.in.other = T.out;
    for (const k of this.keys) {
      const tr = T[k];
      const qb = tr.nearest(...G.toWorld(...HITCH.bot), 40), qt = tr.nearest(...G.toWorld(...HITCH.top), 40);
      if (!qb || !qt) { console.warn('counterbalance: hitch points off the route'); return; }
      tr.sBot = qb.s; tr.sTop = qt.s;
      tr.climbs = tr.sTop > tr.sBot;           // the out track climbs, the in track descends
      tr.h1 = Math.min(tr.sBot, tr.sTop); tr.h2 = Math.max(tr.sBot, tr.sTop);
      tr.zIn = [tr.h1 - ZG - ZONE, tr.h1 - ZG];
      tr.zOut = [tr.h2 + ZG, tr.h2 + ZG + ZONE];
      // THE GATE, where a car waits for a cable: short of the crossover and
      // on straight track -- the out track turns off Roy St onto the hill
      // right there, and a car waiting on the corner fouled the other track
      let g = tr.zIn[0] - CB.carLen / 2 - 3;
      for (let k = 0; k < 80 && g > CB.carLen; k++) {
        let bent = false;
        for (let d = -CB.carLen / 2 - 2; d <= CB.carLen / 2 + 2; d += 2) if (tr.K[tr.idx(g + d)] > 1 / 90) bent = true;
        if (!bent) break;
        g -= 2;
      }
      tr.gate = g;
    }
    // the stops on each track
    this.stops = STOPS.map((d) => ({ name: d.name, full: d.full || d.name, term: !!d.term, hitch: d.hitch || null, s: {} }));
    this.stops.forEach((st, i) => {
      const d = STOPS[i];
      for (const k of this.keys) {
        const tr = T[k];
        if (d.term) {
          // a track's far end: McGraw for the out track, Pioneer Square for the in track
          if ((k === 'out') === (d.name === 'McGraw St')) st.s[k] = tr.len - CB.carLen / 2 - 0.6;
        } else if (d.hitch) st.s[k] = d.hitch === 'bot' ? tr.sBot : tr.sTop;
        else {
          const ll = d.at || d[k];
          const q = ll && tr.nearest(...G.toWorld(...ll), 30);
          if (q) st.s[k] = q.s - 12;
        }
      }
      // where it is marked: the kerb beside the first track that serves it
      const k = st.s.out !== undefined ? 'out' : 'in', tr = T[k], s = st.s[k];
      const h = tr.heading(s), rx = -Math.cos(h), rz = Math.sin(h);
      const off = Math.max(2.6, tr.HW[tr.idx(s)] - CB.lat + 0.9);
      st.x = tr.x(s) + rx * off; st.z = tr.z(s) + rz * off; st.y = city.groundAt(st.x, st.z, null);
      st.track = k;
    });
    for (const k of this.keys) {
      const tr = T[k];
      tr.stops = this.stops.filter((st) => st.s[k] !== undefined).sort((a, b) => a.s[k] - b.s[k]);
      // speed limits: the street, curves, the cable, the crossovers and the stub ends
      tr.LIM = new Float32Array(tr.n);
      for (let i = 0; i < tr.n; i++) {
        let v = CB.vMax;
        v = Math.min(v, Math.sqrt(CB.aLat / Math.max(tr.K[i], 1e-5)));
        if (i > tr.zIn[0] && i < tr.zOut[1]) v = Math.min(v, CB.vHill);
        if ((i > tr.zIn[0] && i < tr.zIn[1]) || (i > tr.zOut[0] && i < tr.zOut[1])) v = Math.min(v, CB.vX);
        if (i < 24 || i > tr.len - 24) v = Math.min(v, CB.vX);
        tr.LIM[i] = Math.max(2, v);
      }
    }
    // cells near the rails, for keepClear (trees, furniture, parked cars)
    this.clearCells = new Set();
    for (const k of this.keys) {
      const tr = T[k];
      for (let i = 0; i < tr.n; i += 2) {
        for (const [dx, dz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) this.clearCells.add(Math.floor((tr.X[i] + dx) / 10) * 100003 + Math.floor((tr.Z[i] + dz) / 10));
      }
    }
    this.ok = true;
  }

  /** Nothing stands, parks or grows over the rails (city.extraClear). */
  keepClear(x, z) {
    if (!this.ok || !this.clearCells.has(Math.floor(x / 10) * 100003 + Math.floor(z / 10))) return false;
    for (const k of this.keys) {
      const q = this.tracks[k].nearest(x, z, 6);
      if (q && Math.abs(q.d) < CB.wid / 2 + 1.25) return true;
    }
    return false;
  }

  /**
   * The rails set into the street, the counterbalance's slot between them,
   * the crossovers below Roy and above Lee, the poles, brackets and trolley
   * wire, the stop posts, the attendants' boxes and two plaques (their
   * lettering is pixel quads, so no texture and no extra draw). One mesh per
   * chunk, vertex colours, drawn within RANGE.near.
   */
  build(scene) {
    if (!this.ok) return;
    const city = this.city;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.55, envMapIntensity: 0.6,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const chunks = new Map();
    const B = (x, z) => {
      const i = Math.floor((x + CX0) / CHUNK), j = Math.floor((z + CZ0) / CHUNK), k = `${i},${j}`;
      let e = chunks.get(k);
      if (!e) chunks.set(k, (e = { b: new Builder(false), x: (i + 0.5) * CHUNK - CX0, z: (j + 0.5) * CHUNK - CZ0 }));
      return e.b;
    };
    const uv = [0, 0, 1, 0, 1, 1, 0, 1], UP = [0, 1, 0];
    const RAIL = [0.36, 0.35, 0.34], GROOVE = [0.02, 0.02, 0.022], BAND = [0.27, 0.26, 0.24], SLOT = [0.008, 0.008, 0.009];
    const ZBAR = [0.32, 0.31, 0.3], PLATE = [0.07, 0.07, 0.075], POLE = [0.1, 0.115, 0.1], WIRE = [0.09, 0.06, 0.04];
    const WHITE = [0.82, 0.82, 0.78], KIOSK = [0.03, 0.09, 0.05], PLAQUE = [0.02, 0.07, 0.035], BRONZE = [0.6, 0.45, 0.18], INK = [0.8, 0.72, 0.5];
    const g = CB.gauge / 2, a = {}, b = {};
    // a strip across the rails from lateral l0 to l1 (+ = left), `dy` over the rail head
    const strip = (tr, s0, s1, wf, l0, l1, dy, col) => {
      railPoint(tr, s0, wf(s0), a); railPoint(tr, s1, wf(s1), b);
      const ax = Math.cos(a.h), az = -Math.sin(a.h), bx = Math.cos(b.h), bz = -Math.sin(b.h);
      B((a.x + b.x) / 2, (a.z + b.z) / 2).quad(
        [a.x + ax * l0, a.y + dy, a.z + az * l0], [b.x + bx * l0, b.y + dy, b.z + bz * l0],
        [b.x + bx * l1, b.y + dy, b.z + bz * l1], [a.x + ax * l1, a.y + dy, a.z + az * l1], UP, uv, col);
    };
    const rails = (tr, s0, s1, wf, band = true) => {
      for (let s = s0; s < s1 - 0.01; s += 2) {
        const e = Math.min(s1, s + 2);
        if (band) strip(tr, s, e, wf, -g - 0.32, g + 0.32, -CB.railH + 0.012, BAND);
        for (const r of [1, -1]) {
          strip(tr, s, e, wf, r * (g - 0.036), r * (g + 0.036), 0, RAIL);
          strip(tr, s, e, wf, r * (g - 0.084), r * (g - 0.036), -0.016, GROOVE);
        }
      }
    };
    const own = () => 0;
    for (const k of this.keys) {
      const tr = this.tracks[k];
      rails(tr, 0, tr.len, own);
      // the crossovers onto the other hill track, below Roy and above Lee
      const xIn = (s) => smooth(clamp((s - tr.zIn[0]) / (tr.zIn[1] - tr.zIn[0]), 0, 1));
      const xOut = (s) => 1 - smooth(clamp((s - tr.zOut[0]) / (tr.zOut[1] - tr.zOut[0]), 0, 1));
      rails(tr, tr.zIn[0] + 2, tr.zIn[1], xIn, false);
      rails(tr, tr.zOut[0], tr.zOut[1] - 2, xOut, false);
      // the cable's slot between the rails, its Z-bars, and a plate every 22 m
      for (let s = tr.h1 - 2; s < tr.h2 + 2; s += 2) {
        const e = Math.min(tr.h2 + 2, s + 2);
        strip(tr, s, e, own, -0.028, 0.028, -0.014, SLOT);
        for (const r of [1, -1]) strip(tr, s, e, own, r * 0.028, r * 0.05, -0.012, ZBAR);
      }
      for (let s = tr.h1 + 8; s < tr.h2; s += 22) strip(tr, s - 0.55, s + 0.55, own, -0.38, 0.38, -0.01, PLATE);
      // poles on the kerb, a bracket arm out over the rails, the wire
      const wire = [];
      let s = 4;
      while (s < tr.len) {
        const q = railPoint(tr, s, 0, {});
        const rx = -Math.cos(q.h), rz = Math.sin(q.h);
        const off = Math.max(2.4, tr.HW[tr.idx(s)] - CB.lat + 0.45);
        let px = q.x + rx * off, pz = q.z + rz * off, okPole = !city.onRoad(px, pz, 0.15);
        for (const ds of [4, -4, 8, -8]) {
          if (okPole) break;
          const q2 = railPoint(tr, clamp(s + ds, 0, tr.len), 0, {});
          px = q2.x - Math.cos(q2.h) * off; pz = q2.z + Math.sin(q2.h) * off;
          okPole = !city.onRoad(px, pz, 0.15);
        }
        wire.push([q.x, q.y + CB.wire, q.z]);
        if (okPole) {
          const by = city.groundAt(px, pz, null), top = q.y + CB.wire + 0.75;
          const P = B(px, pz);
          P.prism(px, by, pz, 0.11, top - by, 6, POLE);
          const L = off + 0.35, cx = px - rx * L / 2, cz = pz - rz * L / 2;
          P.box(cx, q.y + CB.wire + 0.32, cz, L, 0.07, 0.07, Math.atan2(rz, rx), POLE);
          P.box(q.x, q.y + CB.wire, q.z, 0.05, 0.32, 0.05, 0, POLE);
        }
        s += tr.K[tr.idx(s)] > 1 / 60 ? 9 : 32;
      }
      const qe = railPoint(tr, tr.len, 0, {});
      wire.push([qe.x, qe.y + CB.wire, qe.z]);
      for (let i = 0; i < wire.length - 1; i++) {
        const p0 = wire[i], p1 = wire[i + 1];
        B((p0[0] + p1[0]) / 2, (p0[2] + p1[2]) / 2).tube(p0, p1, 0.018, 3, WIRE);
      }
    }
    // the stop posts: a white band and a CAR STOP plate, on the kerb
    for (const st of this.stops) {
      for (const k of this.keys) {
        const tr = this.tracks[k], ss = st.s[k];
        if (ss === undefined) continue;
        const q = railPoint(tr, ss + CB.carLen / 2 - 2, 0, {});
        const rx = -Math.cos(q.h), rz = Math.sin(q.h), fx = Math.sin(q.h), fz = Math.cos(q.h);
        const off = Math.max(2.6, tr.HW[tr.idx(ss)] - CB.lat + 0.75);
        const px = q.x + rx * off, pz = q.z + rz * off, by = city.groundAt(px, pz, null);
        const P = B(px, pz);
        P.prism(px, by, pz, 0.05, 2.75, 6, POLE);
        P.prism(px, by + 1.9, pz, 0.055, 0.4, 6, WHITE);
        P.box(px, by + 2.32, pz, 0.62, 0.3, 0.03, Math.atan2(fz, fx), WHITE);
        for (const sd of [1, -1]) text(P, 'CAR STOP', [px + rx * sd * 0.017, by + 2.42, pz + rz * sd * 0.017], [fx * sd, 0, fz * sd], [rx * sd, 0, rz * sd], 0.075, [0.6, 0.04, 0.04]);
      }
    }
    // the attendants' boxes at the foot and the top, and the plaques beside them
    this.plaqueAt = [];
    for (const [k, which] of [['out', 'sBot'], ['in', 'sTop']]) {
      const tr = this.tracks[k], ss = tr[which];
      const q = railPoint(tr, ss - 4, 0, {});
      const rx = -Math.cos(q.h), rz = Math.sin(q.h), fx = Math.sin(q.h), fz = Math.cos(q.h);
      const off = Math.max(3.2, tr.HW[tr.idx(ss)] - CB.lat + 1.5);
      const px = q.x + rx * off, pz = q.z + rz * off, by = city.groundAt(px, pz, null), rot = Math.atan2(fz, fx);
      const P = B(px, pz);
      P.box(px, by, pz, 1.1, 2.25, 1.1, rot, KIOSK);
      P.box(px, by + 1.05, pz, 1.12, 0.12, 1.12, rot, C.cream);
      P.box(px, by + 2.25, pz, 1.3, 0.12, 1.3, rot, C.roof);
      P.box(px - rx * 0.56, by + 1.3, pz - rz * 0.56, 0.7, 0.6, 0.02, rot, GLASS);
      // the plaque, on a post 3 m on
      const qx = px + fx * 3, qz = pz + fz * 3, qy = city.groundAt(qx, qz, null);
      P.prism(qx, qy, qz, 0.05, 1.3, 6, POLE);
      const w = 1.3, h = 0.78, cy = qy + 1.6;
      P.box(qx, cy - h / 2 - 0.04, qz, w + 0.08, h + 0.08, 0.05, rot, BRONZE);
      const fx0 = qx - rx * 0.03, fz0 = qz - rz * 0.03;
      P.quad([fx0 - fx * w / 2, cy - h / 2, fz0 - fz * w / 2], [fx0 + fx * w / 2, cy - h / 2, fz0 + fz * w / 2], [fx0 + fx * w / 2, cy + h / 2, fz0 + fz * w / 2], [fx0 - fx * w / 2, cy + h / 2, fz0 - fz * w / 2], [-rx, 0, -rz], uv, PLAQUE);
      // read from the street: left to right is -forward of the track it stands by
      const tx = fx0 - rx * 0.004, tz = fz0 - rz * 0.004, u = [-fx, 0, -fz], n = [-rx, 0, -rz];
      text(P, 'THE COUNTERBALANCE', [tx, cy + 0.22, tz], u, n, 0.085, BRONZE);
      text(P, '1901 - 1940', [tx, cy + 0.1, tz], u, n, 0.06, INK);
      text(P, 'STREETCARS ON THIS HILL WERE', [tx, cy - 0.02, tz], u, n, 0.045, INK);
      text(P, 'HOOKED TO A 16-TON WEIGHT', [tx, cy - 0.1, tz], u, n, 0.045, INK);
      text(P, 'IN A TUNNEL UNDER THE STREET', [tx, cy - 0.18, tz], u, n, 0.045, INK);
      text(P, 'ROUTE 26 - WEST QUEEN ANNE', [tx, cy - 0.3, tz], u, n, 0.035, BRONZE);
      this.plaqueAt.push({ x: qx, z: qz });
    }
    this.group = new THREE.Group();
    this.group.name = 'counterbalance';
    for (const e of chunks.values()) {
      if (e.b.empty) continue;
      const m = new THREE.Mesh(e.b.build(), this.mat);
      m.name = 'counterbalance:rails';
      m.castShadow = false; m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      this.chunks.push({ x: e.x, z: e.z, mesh: m });
    }
    scene.add(this.group);
  }

  /** Hooks into the game. */
  bind(o) {
    Object.assign(this, { game: o.game, hud: o.hud, audio: o.audio, player: o.player, fx: o.fx, peds: o.peds, traffic: o.traffic });
    this._button();
  }
  say(t, ms) { if (this.hud) this.hud.showToast(t, ms); }
  /** say(), at most once every `cd` seconds for `key`: a stand at a mark must not spam. */
  sayOnce(key, t, cd = 6, ms) {
    const now = performance.now() / 1000, m = this._said || (this._said = {});
    if (m[key] !== undefined && now - m[key] < cd) return;
    m[key] = now;
    this.say(t, ms);
  }

  /**
   * Is `o` on the rails `c` is running on -- by where it physically is, not
   * by which track it belongs to? On the hill a car of the other direction
   * can stand on c's rails (it took the other cable). Returns where it is
   * along c's track and how it faces (+1 the same way, -1 nose to nose), or
   * null.
   */
  sameRails(c, o) {
    const tr = c.track, q = tr.nearest(o.cx, o.cz, 10);
    if (!q) return null;
    const off = Math.abs(q.d - 2 * CB.lat * c.shiftAt(q.s));
    const h = tr.heading(q.s), facing = o._fwd.x * Math.sin(h) + o._fwd.z * Math.cos(h);
    // a car going our way is in the way if its body reaches ours (a
    // crossover); one coming the other way only if it is on our very rails --
    // passing on the next pair at a corner it swings a few centimetres over,
    // and waiting for that would stop both for good
    const stub = (x) => x.s < 40 || x.s > x.track.len - 40;
    if (off > (facing > 0 || stub(c) || stub(o) ? CB.wid + 0.3 : 1.4)) return null;
    return { s: q.s, facing, off };
  }

  /** sameRails, from either car's side: a car changing sides in a crossover
   *  is off one's path while its body is still across the other's. */
  inWay(c, o) {
    const r = this.sameRails(c, o);
    if (r || o.track !== c.track || !this.sameRails(o, c)) return r;
    return { s: o.s, facing: 1, off: 0 };
  }

  /** A track's crossover zone at end `end` ('bot' below Roy, 'top' above Lee). */
  zoneAt(tr, end) { return (end === 'bot') === tr.climbs ? tr.zIn : tr.zOut; }

  /** Is car o's body in the crossover area at `end`? */
  inXArea(o, end) {
    const z = this.zoneAt(o.track, end);
    return o.s > z[0] - CB.carLen / 2 + 0.5 && o.s < z[1] + CB.carLen / 2 + 3;
  }

  /** The crossover at `end` for `car` changing sides: true if it holds it
   *  (taking it now if it is free and empty). */
  takeX(car, end) {
    const L = this.xlock;
    if (L[end] && L[end] !== car) {
      // a holder that is no longer changing sides there lets go
      const h = L[end];
      if (!this.cars.includes(h) || !h.hill || h.hill === h.track.side || !(this.inXArea(h, end) || this._nearX(h, end))) L[end] = null;
    }
    if (L[end] === car) return true;
    if (L[end]) return false;
    for (const o of this.cars) if (o !== car && this.inXArea(o, end)) return false;
    L[end] = car;
    return true;
  }
  _nearX(o, end) { const z = this.zoneAt(o.track, end); return o.s > z[0] - 40 && o.s < z[0]; }

  /** Held by someone else (a car must not enter the area meanwhile)? */
  xHeld(car, end) {
    const h = this.xlock[end];
    if (!h || h === car) return false;
    // (a holder queued behind this very car cannot be holding it)
    if (!this.cars.includes(h) || !h.hill || h.hill === h.track.side || !(this.inXArea(h, end) || this._nearX(h, end)) || (h.track === car.track && h.s < car.s)) { this.xlock[end] = null; return false; }
    return true;
  }

  /** Nose to nose, which gives way? The car on the cable keeps the hill; then
   *  the car on its own rails; then you; then the older car. */
  yields(c, o) {
    // a car with nowhere to back to (just out of a stub end) does not
    const room = (x) => x.s - CB.carLen / 2 - 1;
    if ((room(c) < 10) !== (room(o) < 10)) return room(o) < 10;
    if (!!c.hitch !== !!o.hitch) return !c.hitch;
    const cOwn = !c.hill || c.hill === c.track.side, oOwn = !o.hill || o.hill === o.track.side;
    if (cOwn !== oOwn) return !cOwn;
    if (o.driver === 'player') return true;
    return c.id > o.id;
  }

  // ---- the counterweights --------------------------------------------------

  /** Could `car` take hill track P now: its weight at the car's end, nobody
   *  else on it or holding it? */
  free(P, car) {
    const need = car.track.climbs ? 1 : 0;
    const w = this.weights[P];
    if (w.car || Math.abs(w.f - need) > 0.02) return false;
    // A CAR CHANGING SIDES HAS THE HILL TO ITSELF. Cars on their own cables
    // share it (opposite ways on their own rails never meet; one way, they
    // queue), but one on the other cable crosses everybody's rails twice,
    // in the scissors at each end -- every rule that tried to share the
    // crossovers with it left a jam for the fuzz probe to find.
    const changes = P !== car.track.side;
    for (const o of this.cars) {
      if (o === car) continue;
      const tr = o.track;
      const onHill = o.s > tr.zIn[0] - (o.hill ? 90 : 0) && o.s < tr.zOut[1] + 2;
      if (!onHill) continue;
      // (a car behind this one on its own track, with no cable, is not in its
      // way: it follows, and takes the next weight)
      if (tr === car.track && o.s < car.s && !o.hitch) continue;
      if ((o.hill || tr.side) === P) return false;
      if (changes || (o.hill && o.hill !== tr.side)) return false;
    }
    return true;
  }

  /** A car of its own track between `car` and the hill, with no cable yet
   *  (the queue's front gets the cable first: one reserved behind it held
   *  both cables while the front car waited for ever). */
  queuedBehind(car) {
    const tr = car.track;
    if (car.s > tr.zIn[0]) return false;
    return this.cars.some((o) => o !== car && o.track === tr && !o.hill && o.s > car.s && o.s < tr.zIn[0] + 2);
  }

  /** Give `car` a hill track, its own side first. */
  assign(car, ownOnly = false) {
    if (this.queuedBehind(car)) return false;
    const own = car.track.side, other = own === 'E' ? 'W' : 'E';
    for (const P of ownOnly ? [own] : [own, other]) if (this.free(P, car)) { car.hill = P; return true; }
    return false;
  }

  hitch(car) {
    const P = car.hill;
    if (!P || car.hitch) return false;
    const w = this.weights[P];
    if (w.car || Math.abs(w.f - (car.track.climbs ? 1 : 0)) > 0.02) return false;
    car.hitch = P; w.car = car;
    this._clunk(car, true);
    return true;
  }

  unhitch(car) {
    if (!car.hitch) return;
    const w = this.weights[car.hitch];
    w.f = Math.round(w.f);
    w.car = null; car.hitch = null;
    this._clunk(car, false);
  }

  _clunk(car, on) {
    const p = this.player;
    if (this.audio && this.audio.ready && p && Math.hypot(p.position.x - car.cx, p.position.z - car.cz) < 160) {
      this.audio.play('cb_clunk', { gain: 0.9, x: car.cx, y: car.cy - 0.5, z: car.cz, ref: 10, maxD: 180 });
    }
    if (car.driver === 'player' && p && p.vehicle === car) {
      if (on) {
        const firstHitch = !this._hitchedOnce;
        this._hitchedOnce = true;
        this.sayOnce('hook', `Hooked on — 16 tons under the street ${car.track.climbs ? 'pull you up' : 'hold you back'}`, 3, firstHitch ? 4200 : 2200);
      } else this.sayOnce('unhook', 'Unhooked — the attendant lifts the finger out', 3, 2200);
    }
  }

  /** Why `car` cannot hook on here, in a toast's words. */
  noHookWhy(car) {
    const need = car.track.climbs ? 1 : 0;
    const f = car.facingCar && car.facingCar();
    if (f && f.hitch) return 'a car is coming to this mark on the cable — back up (hold BRAKE)';
    const here = ['E', 'W'].filter((P) => Math.abs(this.weights[P].f - need) < 0.02);
    if (!here.length) return `no weight at ${car.track.climbs ? 'the top' : 'the bottom'} yet — a car the other way brings one`;
    return 'the cable is in use — wait for the car on it';
  }

  /** A weight nobody can bring back (you left a car where it should not be,
   *  or drove the hill without one): the attendants wind it to the end it is
   *  wanted at. */
  winch(need, car = null) {
    // the car's own cable if it has been given one; never a weight another
    // car holds or has been given (two waiting cars winding one weight back
    // and forth at each other was a jam the fuzz probe found)
    const order = car && car.hill ? [car.hill] : car ? [car.track.side, car.track.side === 'E' ? 'W' : 'E'] : ['E', 'W'];
    for (const P of order) {
      const w = this.weights[P];
      if (w.car || Math.abs(w.f - need) <= 0.02) continue;
      if (this.cars.some((o) => o !== car && o.hill === P)) continue;
      w.f = need;
      return P;
    }
    return null;
  }

  // ---- service ---------------------------------------------------------------

  makeCars(scene) {
    if (!this.ok) return [];
    const A = vehicleAssets();
    // varnished paint, and the vehicles' trim draw for the glass, brass and nickel
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.06, roughness: 0.5, envMapIntensity: 0.9 });
    this.trimMat = A.trimMat;
    const T = this.tracks;
    // where each starts: two each way, spread round the loop, none on the hill
    const at = [['out', 0.06], ['out', 0.42], ['in', 0.1], ['in', 0.6]];
    let above = 0;
    for (let i = 0; i < CB.cars; i++) {
      const [k, f] = at[i % at.length];
      const tr = T[k];
      let s = clamp(f * tr.len, CB.carLen, tr.len - CB.carLen);
      if (s > tr.zIn[0] - 30 && s < tr.zOut[1] + 20) s = tr.zIn[0] - 40;
      const car = new Streetcar(this, i, CB.numbers[i % CB.numbers.length], tr);
      car.place(s);
      if ((k === 'out') === (s > tr.zOut[1])) above++;
      this.cars.push(car);
      scene.add(car.group);
    }
    // a weight stands at the bottom for every car above the hill
    this.weights.E.f = above >= 2 ? 0 : 1;
    this.weights.W.f = above >= 1 ? 0 : 1;
    // settle the service: six minutes of it, at a coarse step
    for (let k = 0; k < 1440; k++) this._service(0.25, true);
    for (const c of this.cars) c.group.visible = false;
    return this.cars;
  }

  _service(dt, boot = false) {
    for (const c of this.cars) if (c.driver !== 'player') c.service(dt, boot);
    this._carsCollide();
    // A CAR THAT CANNOT MOVE IS TOWED. Anything the rules above miss (you
    // parked across the rails, a car left where two cables meet) must not
    // stop the line for good: a car standing in service for two minutes,
    // nowhere near you, is put back on its own rails short of the hill.
    for (const c of this.cars) {
      const atGate = !c.hill && Math.abs(c.s - c.track.gate) < 4;
      if (c.driver === 'player' || c.backoff || atGate || Math.abs(c.u) > 0.05 || (c.state === 'dwell' && c.timer > 0 && c.held < 60)) { c.stuckT = 0; continue; }
      c.stuckT = (c.stuckT || 0) + dt;
      if (c.stuckT < 120) continue;
      // the car in its way, if that is an AI car too: tow the cause
      let who = c;
      for (const o of this.cars) {
        if (o === c || o.driver === 'player') continue;
        const r = this.sameRails(c, o);
        if (r && r.s > c.s && r.s - c.s < CB.carLen + 60) { who = o; break; }
      }
      if (this.tow(who, boot)) c.stuckT = 0;
    }
  }

  /** Out of sight: farther than a car is drawn from the camera and you. */
  unseen(x, z) {
    const p = this.player, cam = this.camera;
    const r = RANGE.car + 60;
    if (p && Math.hypot(p.position.x - x, p.position.z - z) < r) return false;
    if (cam && Math.hypot(cam.position.x - x, cam.position.z - z) < r) return false;
    return true;
  }

  /** Put `c` back on its own rails at a clear spot short of the hill (or at
   *  its track's start), off the cable, in service. */
  tow(c, boot = false) {
    const tr = c.track;
    if (!boot && !this.unseen(c.cx, c.cz)) return false;
    for (const s of [tr.zIn[0] - 160, tr.zIn[0] - 320, CB.carLen, tr.zOut[1] + 120, tr.len * 0.25, tr.len * 0.75]) {
      if (s < CB.carLen || s > tr.len - CB.carLen || (s > tr.zIn[0] - 40 && s < tr.zOut[1] + 20)) continue;
      const x = tr.x(s), z = tr.z(s);
      if (!boot && !this.unseen(x, z)) continue;
      if (this.cars.some((o) => o !== c && Math.hypot(o.cx - x, o.cz - z) < CB.carLen + 25)) continue;
      if (c.hitch) this.unhitch(c);
      c.hill = null; c.backoff = false; c.headOnT = 0; c.stuckT = 0;
      c.place(s); c.state = 'run'; c.lastStop = null; c.stop = null;
      this.towed = (this.towed || 0) + 1;
      return true;
    }
    return false;
  }

  /** Cars meeting where the tracks do (a player's car, the crossovers): the
   *  one moving into the other is put back clear and both stop. */
  _carsCollide() {
    const C = this.cars;
    for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) {
      const a = C[i], b = C[j];
      const dx = b.cx - a.cx, dz = b.cz - a.cz;
      if (dx * dx + dz * dz > (CB.carLen + 2) ** 2) continue;
      // the two bodies as oriented boxes, separated along any of their four axes?
      const hl = CB.carLen / 2, hw = CB.wid / 2 - 0.12;
      let pen = Infinity;
      for (const ax of [a._fwd, { x: a._fwd.z, z: -a._fwd.x }, b._fwd, { x: b._fwd.z, z: -b._fwd.x }]) {
        const ra = hl * Math.abs(a._fwd.x * ax.x + a._fwd.z * ax.z) + hw * Math.abs(a._fwd.z * ax.x - a._fwd.x * ax.z);
        const rb = hl * Math.abs(b._fwd.x * ax.x + b._fwd.z * ax.z) + hw * Math.abs(b._fwd.z * ax.x - b._fwd.x * ax.z);
        pen = Math.min(pen, ra + rb - Math.abs(dx * ax.x + dz * ax.z));
        if (pen <= 0) break;
      }
      if (pen <= 0) continue;
      // which of them is running into the other: its nose more toward it
      const dl = Math.hypot(dx, dz) + 1e-6;
      const va = (Math.sign(a.u || 1) * (a._fwd.x * dx + a._fwd.z * dz)) / dl, vb = -(Math.sign(b.u || 1) * (b._fwd.x * dx + b._fwd.z * dz)) / dl;
      const mover = va >= vb ? a : b, other = mover === a ? b : a;
      const rel = Math.abs(a.u) + Math.abs(b.u);
      mover.s -= Math.sign(mover.u || 1) * (Math.min(pen, 3) + 0.05);
      mover._point();
      const you = mover.driver === 'player' || other.driver === 'player';
      if (rel > 1.5 && you) this.onCollide(rel);
      mover.u = 0;
      if (you) other.u *= 0.3;
    }
  }

  /** Is (x, z) near enough a car to need the fine test (traffic.js)? */
  near(x, z) {
    for (const c of this.cars) if ((c.cx - x) ** 2 + (c.cz - z) ** 2 < 90 * 90) return true;
    return false;
  }

  /**
   * For traffic.js: does a streetcar stand at (x, z), or will it be there in
   * a couple of seconds? An AI car queues behind one standing at its stop,
   * and waits for one crossing its road.
   */
  blocks(x, z, y) {
    for (const c of this.cars) {
      const dx = x - c.cx, dz = z - c.cz;
      if (dx * dx + dz * dz > 40 * 40) continue;
      if (y !== undefined && Math.abs(y - c.cy) > 3.5) continue;
      const f = c._fwd, a = dx * f.x + dz * f.z, b = dx * f.z - dz * f.x;
      const reach = Math.max(0, c.u) * 2.5;
      if (Math.abs(b) < CB.wid / 2 + 1.15 && a > -CB.carLen / 2 - 1.5 && a < CB.carLen / 2 + 1.5 + reach) return true;
    }
    return false;
  }

  update(dt, camera) {
    if (!this.ok || !this.cars.length) return;
    this.camera = camera;
    const p = this.player, pv = p && p.vehicle;
    // a car you left by a door that did not tell us (a warp, a respawn)
    for (const c of this.cars) if (c.driver === 'player' && pv !== c) this.onLeave(c);
    this._guard(dt);
    this._service(dt);
    const cx = camera.position.x, cz = camera.position.z;
    for (const c of this.cars) {
      const d = Math.hypot(c.cx - cx, c.cz - cz);
      const vis = c.driver === 'player' || d < RANGE.car;
      c.group.visible = vis;
      // its glass, brass and nickel only close: one draw a car further off
      c.meshes[1].visible = c.driver === 'player' || d < RANGE.trim;
      if (vis) c.pose();
      // the plow in the slot: a spark now and then, under a car on the cable
      if (vis && c.hitch && Math.abs(c.u) > 0.8 && d < 70 && this.fx && Math.random() < dt * 2.2) this.fx.sparks(c.cx, c.cy + 0.05, c.cz, 3);
    }
    for (const e of this.chunks) {
      const d = Math.hypot(e.x - cx, e.z - cz) - CHUNK * 0.71;
      if (e.mesh) e.mesh.visible = d < RANGE.near;
    }
    // the motorman's readout, and the RIDE / DRIVE button
    const mine = pv && pv.spec && pv.spec.streetcar ? pv : null;
    // RIDING, you are out on the front entrance's step, as on a cable car's
    // running board: upright whatever the grade, facing up the line
    if (mine && mine.mode === 'ride' && p.h) {
      const h = p.h, v = this._rv || (this._rv = new THREE.Vector3());
      v.set(-(CB.wid / 2 + 0.22), 0.42, 5.0).applyMatrix4(mine.group.matrixWorld);
      h.group.visible = true;
      h.group.position.copy(v);
      h.group.rotation.set(0, mine.heading, 0);
      animateWalk(h, 0, dt, 0);
      h.group.updateMatrixWorld(true);
      this._rider = true;
    } else if (this._rider) {
      if (p.h && !p.onFoot) p.h.group.visible = false;
      this._rider = false;
    }
    if (mine && this.hud) {
      this._hudT = (this._hudT || 0) - dt;
      if (this._hudT <= 0) { this._hudT = 0.25; this.hud.setObjective(mine.readout()); }
    }
    if (this.btn) {
      const show = !!mine;
      if (this._btnShown !== show) { this.btn.style.display = show ? 'block' : 'none'; this._btnShown = show; }
      if (mine) { const t = mine.mode === 'ride' ? 'DRIVE ▸' : 'RIDE ▸'; if (this.btn.textContent !== t) this.btn.textContent = t; }
    }
  }

  /**
   * People and cars in a streetcar's way. A car in service rings its bell and
   * brakes for whoever is on the rails ahead (you, on foot or driving, and AI
   * traffic). And every body that overlaps one -- your car, traffic, you on
   * foot -- is put back outside it: a streetcar is not a ghost, and one that
   * reaches you hurts.
   */
  _guard(dt) {
    const p = this.player;
    if (!p) return;
    const pv = p.vehicle, mine = pv && pv.spec && pv.spec.streetcar ? pv : null;
    const px = p.position.x, pz = p.position.z, py = p.position.y;
    const pr = mine ? 0 : pv ? (pv.halfWid || 1) : 0.35, pl = mine ? 0 : pv ? (pv.halfLen || 2.2) : 0.35;
    const tcars = this.traffic ? this.traffic.cars : [];
    for (const c of this.cars) {
      if ((c.cx - px) ** 2 + (c.cz - pz) ** 2 > 400 * 400) continue;
      // what is on the rails ahead of a car in service
      if (c.driver !== 'player' && c.u > -0.2) {
        const look = 12 + ((c.u * c.u) / 2) * 1.3;
        let hit = Infinity;
        for (let d = 0; d <= look && hit === Infinity; d += 3) {
          const s = c.s + CB.carLen / 2 + d;
          if (s > c.track.len) break;
          const q = c.pointAt(s);
          if (!mine && Math.abs(py - q.y) < 3 && (q.x - px) ** 2 + (q.z - pz) ** 2 < (CB.wid / 2 + pr + 0.2) ** 2) {
            // you, standing on the rails: it rings and waits -- then, after
            // 8 s, edges on at a walk and nudges you aside (a car that waits
            // for ever for someone who never moves is a jam)
            c._youT = (c._youT || 0) + dt;
            if (!pv && c._youT > 8) { c.creep = true; break; }
            hit = d; break;
          }
          // people crossing the street at a corner (peds.js, traffic's crossXZ), at its level
          const T = this.traffic, xz = T && T.crossXZ;
          if (xz) for (let k = 0; k < (T.crossN || 0); k++) {
            if (Math.abs(xz[k * 3 + 2] - q.y) < 3 && (q.x - xz[k * 3]) ** 2 + (q.z - xz[k * 3 + 1]) ** 2 < (CB.wid / 2 + 0.9) ** 2) { hit = d; break; }
          }
          if (hit < Infinity) break;
          for (const o of tcars) {
            if (o === pv || o.dead) continue;
            // one standing nose to nose with the car is waiting for it (traffic
            // sees the streetcar): it is not an obstacle, or neither ever moves
            const of = o.forward;
            if (Math.abs(o.vLong) < 0.5 && of && of.x * c._fwd.x + of.z * c._fwd.z < -0.3) continue;
            const r = CB.wid / 2 + (o.halfWid || 1) + 0.2;
            if ((q.x - o.x) ** 2 + (q.z - o.z) ** 2 < r * r && Math.abs(o.y - q.y) < 3) { hit = d; break; }
          }
        }
        if (hit < Infinity) c.obstruct(hit);
        if (hit === Infinity && !c.creep) c._youT = 0;
      }
      // bodies inside the car's box, pushed out the short way
      const push = (o, hl, hw, isPlayer, isVehicle) => {
        const dx = o.x - c.cx, dz = o.z - c.cz, f = c._fwd;
        const a = dx * f.x + dz * f.z, b = dx * f.z - dz * f.x;
        const ea = CB.carLen / 2 + hl, eb = CB.wid / 2 + hw;
        if (Math.abs(a) >= ea || Math.abs(b) >= eb) return;
        if (Math.abs((o.y !== undefined ? o.y : c.cy) - c.cy) > 3) return;
        const pa = ea - Math.abs(a), pb = eb - Math.abs(b);
        if (pb < pa) { const sg = Math.sign(b) || 1; o.x += f.z * sg * (pb + 0.02); o.z += -f.x * sg * (pb + 0.02); } else { const sg = Math.sign(a) || 1; o.x += f.x * sg * (pa + 0.02); o.z += f.z * sg * (pa + 0.02); }
        const sp = Math.abs(c.u) + (isVehicle ? Math.abs(o.vLong || 0) : 0);
        if (isVehicle) o.vLong = (o.vLong || 0) * 0.4;
        if (isPlayer && sp > 1.5 && !(this._hitCd > 0)) {
          this._hitCd = 1;
          if (this.game) { this.game.onCrash(sp * (isVehicle ? 3 : 2), false); if (sp > 2.5) this.game.damagePlayer(sp * (isVehicle ? 3 : 5), 'crash'); }
          if (isVehicle && o.damage) o.damage(sp * 5, true);
          if (Math.abs(c.u) > 1.5) this.say(isVehicle ? 'Hit by a streetcar!' : 'Knocked down by a streetcar!');
        } else if (!isPlayer && mine === c && sp > 2.5 && !(this._hitCd > 0)) {
          this._hitCd = 1;
          if (this.game) this.game.onCrash(sp * 2, false);
          if (o.damage) o.damage(sp * 4, true);
        }
      };
      if (!mine) {
        if (pv) push(pv, pl, pr, true, true);
        else push(p, 0.3, 0.3, true, false);
      }
      for (const o of tcars) if (o !== pv && (o.x - c.cx) ** 2 + (o.z - c.cz) ** 2 < 20 * 20) push(o, o.halfLen || 2.2, o.halfWid || 0.9, false, true);
    }
    this._hitCd = (this._hitCd || 0) - dt;
  }

  /** A car you can step onto from here: stopped or rolling slowly beside you
   *  (a cable car's running board is boarded on the move). */
  boardable(x, y, z) {
    if (!this.ok) return null;
    let best = null, bd = Infinity;
    for (const c of this.cars) {
      if (c.driver || Math.abs(c.u) > 2.6 || Math.abs(y - c.cy) > 3) continue;
      const dx = x - c.cx, dz = z - c.cz, f = c._fwd;
      const a = dx * f.x + dz * f.z, b = dx * f.z - dz * f.x;
      if (Math.abs(a) > CB.carLen / 2 + 2.5 || Math.abs(b) > CB.wid / 2 + 3) continue;
      const d = Math.abs(b) + Math.max(0, Math.abs(a) - CB.carLen / 2);
      if (d < bd) { bd = d; best = c; }
    }
    // at a stop's post, the car standing at that stop (the post is on the
    // kerb, up to 11 m from the rails)
    const st = !best && this.stopAt(x, z);
    if (st) for (const c of this.cars) if (!c.driver && Math.abs(c.u) < 0.1 && c.stopHere() === st && Math.abs(y - c.cy) < 4) return c;
    return best;
  }

  /** The stop whose marker you are standing by, or null. */
  stopAt(x, z) {
    for (const st of this.stops) if (Math.hypot(x - st.x, z - st.z) < 12) return st;
    return null;
  }

  /** ENTER at a stop with no car in: the next car toward it is called up
   *  (moved up the line to ~150 m out if the way is clear and it would not
   *  skip the counterbalance), and it waits for you there. */
  onWait(x, z) {
    if (!this.ok) return false;
    const st = this.stopAt(x, z);
    if (!st) return false;
    let best = null;
    for (const c of this.cars) {
      const k = c.track.key, sS = st.s[k];
      if (sS === undefined || c.driver) continue;
      const d = sS - c.s;
      if (d < -2) continue;
      if (!best || d < best.d) best = { c, d };
    }
    if (!best) { this.say(`${st.name} — no car coming just now`); return true; }
    const { c, d } = best, tr = c.track, sS = st.s[tr.key];
    if (d > 200 && c.state !== 'dwell') {
      const s = sS - 150;
      const skipsHill = c.s < tr.zOut[1] + 5 && s > tr.zIn[0] - 20;
      const clear = !skipsHill && !c.hitch && this.cars.every((o) => o === c || o.track !== tr || (Math.abs(o.s - s) > CB.carLen + 40 && !(o.s > s && o.s < sS + 5)));
      if (clear) { c.place(s); c.u = Math.min(CB.vMax, tr.LIM[tr.idx(s)]); c.state = 'run'; c.lastStop = null; }
    }
    this.waitFor = { st, at: performance.now() };
    const eta = Math.max(0, (st.s[tr.key] - c.s) / 7);
    this.say(`${st.name}: Car ${c.number} ${eta < 10 ? 'is coming' : `in ~${Math.ceil(eta / 10) * 10} s`} — ENTER here when it stops`, 4200);
    return true;
  }

  /** Where you step off, or null if it is moving too fast. */
  exitSpot(t) {
    if (Math.abs(t.u) > 4.2) return null;
    const f = t._fwd, rx = -f.z, rz = f.x;   // the car's right (the door side)
    const x = t.cx + rx * (CB.wid / 2 + 1.0), z = t.cz + rz * (CB.wid / 2 + 1.0);
    return { x, z, y: this.city.groundAt(x, z, t.cy + 1) };
  }
  get noExitMsg() { return 'Too fast to step off — BRAKE first'; }

  onBoard(t) {
    t.driver = 'player';
    t.mode = 'drive';
    t.arrival = { from: t.state === 'dwell' ? t.stop : null, t: 0, rated: t.state === 'dwell' };
    t.state = 'run';
    t.timer = 0;
    this.waitFor = null;
    this._objBefore = this.hud && this.hud.objective ? this.hud.objective.textContent : '';
    let first = false;
    try { first = !localStorage.getItem('auto-counterbalance'); localStorage.setItem('auto-counterbalance', '1'); } catch (e) { first = !this.firstRide; }
    this.firstRide = true;
    if (this.btn) { this.btn.textContent = 'RIDE ▸'; this.btn.style.display = 'block'; this._btnShown = true; }
    this.say(`Car ${t.number}, Route 26 — you're the motorman. RIDE: the crew drives`, 4200);
    if (first) {
      const still = () => this.player && this.player.vehicle === t;
      this._firstT = setTimeout(() => { if (still()) this.say('The Queen Anne Counterbalance, 1901–1940', 3600); }, 4400);
      setTimeout(() => { if (still()) this.say('Too steep for a streetcar: a 16-ton weight did the work', 5200); }, 8200);
    }
  }

  onLeave(t) {
    t.resume();
    if (this.hud && this.hud.objective) this.hud.setObjective(this._objBefore || '');
    this._objBefore = '';
    if (this.btn) { this.btn.style.display = 'none'; this._btnShown = false; }
  }

  onArrive(t, st, err) {
    const e = Math.abs(err);
    let pay, verdict;
    if (e < 1) { verdict = 'right on the mark'; pay = 15; } else if (e < 3) { verdict = `${e.toFixed(1)} m ${err > 0 ? 'short' : 'past'}`; pay = 8; } else { verdict = `${e.toFixed(1)} m ${err > 0 ? 'short of' : 'past'} the mark`; pay = 2; }
    if (this.game) this.game.money += pay;
    this.say(`${st.name} — ${verdict} +$${pay}`, 2800);
  }

  onCollide(speed) {
    this.say(`Collision with another streetcar at ${Math.round(speed * 3.6)} km/h!`);
    if (this.game) { this.game.onCrash(speed * 2, false); this.game.damagePlayer(speed * 5, 'crash'); }
  }

  /** The RIDE / DRIVE button: on the right edge, like the ferry's ARRIVE. */
  _button() {
    if (typeof document === 'undefined' || this.btn) return;
    const host = document.getElementById('hud') || document.body;
    const el = document.createElement('button');
    el.id = 'streetcarBtn';
    el.style.cssText = 'position:absolute;right:calc(16px + var(--safe-r, 0px));top:40%;z-index:7;display:none;'
      + 'height:46px;padding:0 20px;border-radius:23px;border:1px solid rgba(255,255,255,0.35);'
      + 'background:rgba(122,30,36,0.9);color:#fff;font:800 15px/1 system-ui,-apple-system,sans-serif;letter-spacing:0.06em;'
      + 'box-shadow:0 4px 14px rgba(0,0,0,0.35);pointer-events:auto;-webkit-tap-highlight-color:transparent';
    el.textContent = 'RIDE ▸';
    el.addEventListener('pointerup', (e) => { e.stopPropagation(); this.toggleRide(); });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    host.appendChild(el);
    this.btn = el;
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyV' && !e.repeat) this.toggleRide(); });
  }

  /** Ride as a passenger (the crew drives, on the timetable) or drive. */
  toggleRide() {
    const v = this.player && this.player.vehicle;
    if (!v || !v.spec || !v.spec.streetcar) return;
    if (this.btn) this.btn.textContent = v.mode === 'ride' ? 'RIDE ▸' : 'DRIVE ▸';
    if (v.mode === 'ride') { v.mode = 'drive'; this.say('You have the controls'); } else { v.mode = 'ride'; v.state = 'run'; v.lastStop = v.stopHere(); this.say('Riding — the crew drives. DRIVE takes over'); }
  }
}

/** How far two cars' bodies overlap (> 0) or stand apart (< 0), as oriented
 *  boxes: the least penetration over their four axes. */
function boxPen(ax, az, af, bx, bz, bf) {
  const hl = CB.carLen / 2, hw = CB.wid / 2, dx = bx - ax, dz = bz - az;
  let pen = Infinity;
  for (const u of [af, { x: af.z, z: -af.x }, bf, { x: bf.z, z: -bf.x }]) {
    const ra = hl * Math.abs(af.x * u.x + af.z * u.z) + hw * Math.abs(af.z * u.x - af.x * u.z);
    const rb = hl * Math.abs(bf.x * u.x + bf.z * u.z) + hw * Math.abs(bf.z * u.x - bf.x * u.z);
    pen = Math.min(pen, ra + rb - Math.abs(dx * u.x + dz * u.z));
  }
  return pen;
}

/** The rail head's middle at s on track `tr`, `w` of the way across to the
 *  other hill track (0 on its own rails). */
function railPoint(tr, s, w, o = {}) {
  const h = tr.heading(s), sh = 2 * CB.lat * w;
  o.x = tr.x(s) + Math.cos(h) * sh; o.z = tr.z(s) - Math.sin(h) * sh;
  o.y = tr._f(tr.Y, s) * (1 - w) + tr._f(tr.YL, s) * w + CB.railH;
  o.h = h;
  return o;
}

// ---------------------------------------------------------------------------
// A car: the posed model, its place on its track, and the two ways it is
// driven -- by you, or by its crew on the timetable.

const G_ACC = 9.81;

export class Streetcar {
  constructor(sys, id, number, track) {
    this.sys = sys;
    this.id = id;
    this.number = number;
    this.track = track;
    this.typeName = 'streetcar';
    this.spec = { rail: true, streetcar: true, hand: 'link', engine: 'traction', len: CB.carLen, wid: CB.wid, roof: CB.roof,
      topKph: CB.vMax * 3.6, mass: CB.mass };
    this.x = 0; this.y = 0; this.z = 0; this.cx = 0; this.cy = 0; this.cz = 0; this.heading = 0;
    this.vLong = 0; this.vLat = 0; this.vy = 0; this.speed = 0;
    this.halfLen = CB.carLen / 2; this.halfWid = CB.wid / 2; this.radius = 3;
    this.health = 100; this.dead = false; this.exploded = false;
    this.mode = 'service'; this.wasParked = false;
    this.skid = 0; this.airborne = false; this.stunt = false; this.stuntLaunch = null;
    this.rampAlong = 0; this.latAcc = 0; this.accLong = 0; this.hitCd = 0;
    this._fwd = { x: 0, z: 1 };
    this.s = 0; this.u = 0; this.grade = 0;
    this.hill = null; this.hitch = null; this._ghost = false;
    this.driver = null;
    this.state = 'run'; this.timer = 0; this.stop = null; this.lastStop = null; this.held = 0; this.waitT = 0;
    this.obstructAt = Infinity; this.bellT = 0; this.arrival = null; this.warned = 0; this._hitchT = 0; this._revT = 0;
    this.backoff = false; this.backTo = 0; this.headOnT = 0; this.stuckT = 0;
    this._q = { x: 0, y: 0, z: 0 }; this._pf = { x: 0, y: 0, z: 0 }; this._pr = { x: 0, y: 0, z: 0 };
    const geo = buildCarGeometry(number);
    this.group = new THREE.Group();
    this.group.name = `streetcar:${number}`;
    this.meshes = [[geo.body, sys.bodyMat], [geo.trim, sys.trimMat]].map(([g, m], i) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = i === 0;   // the body's shadow; glass and brass add nothing to it
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    });
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
  }

  get forward() { return this._fwd; }
  setDetailed() {}
  sync() {}
  damage() {}

  place(s) { this.s = s; this.u = 0; this._point(); }

  /** How far across to the other hill track it is at s: 0 on its own rails,
   *  1 on the other, eased through the crossovers. */
  shiftAt(s) {
    const tr = this.track;
    if (!this.hill || this.hill === tr.side || s <= tr.zIn[0] || s >= tr.zOut[1]) return 0;
    if (s < tr.zIn[1]) return smooth((s - tr.zIn[0]) / (tr.zIn[1] - tr.zIn[0]));
    if (s > tr.zOut[0]) return 1 - smooth((s - tr.zOut[0]) / (tr.zOut[1] - tr.zOut[0]));
    return 1;
  }

  /** The rail head's middle at s, on whichever rails it is on there. */
  pointAt(s, o = this._q) { return railPoint(this.track, s, this.shiftAt(s), o); }

  _point() {
    const f = this.pointAt(this.s + CB.truck, this._pf), r = this.pointAt(this.s - CB.truck, this._pr);
    this.cx = this.x = (f.x + r.x) / 2; this.cy = this.y = (f.y + r.y) / 2; this.cz = this.z = (f.z + r.z) / 2;
    const dx = f.x - r.x, dz = f.z - r.z, l = Math.hypot(dx, dz) || 1;
    this._fwd.x = dx / l; this._fwd.z = dz / l;
    this.heading = Math.atan2(dx, dz);
    this.grade = (f.y - r.y) / (2 * CB.truck);
    this.vLong = this.u; this.speed = Math.abs(this.u);
  }

  pose() {
    const f = this._pf, r = this._pr;
    this._z.set(f.x - r.x, f.y - r.y, f.z - r.z).normalize();
    this._x.set(this._z.z, 0, -this._z.x).normalize();
    this._y.crossVectors(this._z, this._x);
    this._m.makeBasis(this._x, this._y, this._z);
    this.group.quaternion.setFromRotationMatrix(this._m);
    this.group.position.set(this.cx, this.cy, this.cz);
    this.group.updateMatrixWorld(true);
  }

  limitAt(s) { const tr = this.track; return tr.LIM[tr.idx(s)]; }

  /** Something on the rails `ahead` metres in front of the fender (_guard). */
  obstruct(ahead) { this.obstructAt = Math.min(this.obstructAt, ahead); }

  /** Its next stop: one it has not just made, whose mark it has not passed. */
  nextStop() {
    const k = this.track.key;
    for (const st of this.track.stops) if (st !== this.lastStop && st.s[k] > this.s - 1.5) return st;
    return null;
  }
  stopHere() {
    const k = this.track.key;
    for (const st of this.track.stops) if (Math.abs(st.s[k] - this.s) < 6) return st;
    return null;
  }

  /** The car's own physics: tractive command in [-1, 1], brake in [0, 1]. */
  step(dt, power, brake) {
    const sys = this.sys, tr = this.track, m = CB.mass;
    const hooked = !!(this.hitch || this._ghost);
    const M = m + (hooked ? CB.cw : 0);
    const adh = CB.mu * m * G_ACC;
    let Fm = 0;
    if (power > 0 && this.u > -0.3) Fm = Math.min(CB.acc * m * power * clamp(1.6 - Math.max(0, this.u) / CB.vMax, 0, 1), adh);
    else if (power < 0 && this.u < 0.3) Fm = -Math.min(CB.acc * m * clamp(1 - Math.max(0, -this.u - 2) / 1.5, 0, 1), adh);
    const Fg = -m * G_ACC * this.grade;
    // the weight pulls the car toward the top of the hill, whichever way it goes
    const Fcw = hooked ? CB.cw * G_ACC * CB.tunnel * (tr.climbs ? 1 : -1) : 0;
    const Fb = Math.min(brake > 0.95 ? CB.brakeEmerg * m : CB.brake * m * brake, adh);
    // on the cable the weight's own brake governs it: the tunnel car does
    // not run away, so neither does a car hooked to it (est.)
    const gov = this.hitch ? Math.max(0, Math.abs(this.u) - CB.vHill - 0.25) * 9 * (m + CB.cw) : 0;
    const Fr = 0.012 * m * G_ACC + 0.006 * this.u * this.u + gov;
    const Fd = Fm + Fg + Fcw, res = Fb + Fr;
    let u = this.u, a = 0;
    if (Math.abs(u) < 0.05 && Math.abs(Fd) <= res) u = 0;
    else {
      const dirn = Math.abs(u) < 0.05 ? Math.sign(Fd) : Math.sign(u);
      a = (Fd - dirn * res) / M;
      const un = u + a * dt;
      u = Math.sign(un) !== Math.sign(u) && Math.abs(u) >= 0.05 && Math.abs(Fd) <= res ? 0 : un;
    }
    // the wheels spin: trying to climb what adhesion cannot
    this.slip = power > 0.3 && Fm + Fg + Fcw < Fr && u < 0.3 && this.grade > 0.05;
    this.skid = this.slip ? 0.8 : brake > 0.5 && Math.abs(Fg + Fcw) > adh && Math.abs(u) > 0.3 ? 0.6 : 0;
    this.u = u;
    this.accLong = a;
    this.s += u * dt;
    const ev = {};
    const lo = CB.carLen / 2 + 0.3, hi = tr.len - CB.carLen / 2 - 0.3;
    if (this.s < lo || this.s > hi) { if (Math.abs(this.u) > 2) ev.end = Math.abs(this.u); this.s = clamp(this.s, lo, hi); this.u = 0; }
    this._cable(ev);
    // the car ahead (and behind) on the same RAILS -- where it is, not which
    // track it belongs to
    for (const o of sys.cars) {
      if (o === this) continue;
      const r = sys.inWay(this, o);
      if (!r) continue;
      const gap = Math.abs(r.s - this.s) - CB.carLen;
      if (gap < 0) {
        const rel = Math.abs(this.u - o.u * r.facing);
        this.s = r.s + (Math.sign(this.s - r.s) || -1) * (CB.carLen + 0.05);
        if (rel > 1.5) ev.collide = rel;
        if (r.facing > 0) { const mu = (this.u + o.u) / 2; this.u = mu; o.u = mu; } else { this.u = 0; o.u = 0; }
      }
    }
    // past the far crossover (or backed away from the near one): the hill is given back
    if (this.hill && (this.s > tr.zOut[1] || (!this.hitch && this.s < tr.gate - 100))) this.hill = null;
    this.latAcc = this.u * this.u * tr.K[tr.idx(this.s)];
    ev.lat = this.latAcc;
    this._point();
    return ev;
  }

  /** On the cable: the weight follows the car, and the plow cannot pass a
   *  sheave -- run past the mark (CB.hookTol) and you are stopped there and
   *  unhooked. The hook window is the same tolerance, so hooking on short of
   *  the mark never jumps the car to it. */
  _cable(ev) {
    if (!this.hitch) return;
    const tr = this.track, sys = this.sys;
    if (this.s > tr.h2 + CB.hookTol || this.s < tr.h1 - CB.hookTol) {
      const top = Math.abs(this.s - tr.sTop) < Math.abs(this.s - tr.sBot);
      this.s = clamp(this.s, tr.h1 - CB.hookTol, tr.h2 + CB.hookTol);
      if (Math.abs(this.u) > 1) ev.sheave = Math.abs(this.u);
      this.u = 0;
      sys.weights[this.hitch].f = top ? 0 : 1;
      sys.unhitch(this);
      this._sheaveAt = this.s;
    } else sys.weights[this.hitch].f = clamp(1 - (this.s - tr.sBot) / (tr.sTop - tr.sBot), 0, 1);
  }

  /** Backing off the hill (it met a car nose to nose and gives way):
   *  kinematic, at a walking pace, to its own rails short of the crossover. */
  _backOff(dt) {
    const sys = this.sys, tr = this.track;
    let blocked = false;
    for (const o of sys.cars) {
      if (o === this) continue;
      const r = sys.inWay(this, o);
      if (!r || r.s > this.s || this.s - r.s > CB.carLen + 2.5) continue;
      blocked = true;
      // a car of the crew behind, in the way: it backs off too, further back
      // (two cars that cannot pass must clear the hill in order)
      if (o.driver !== 'player' && r.facing > 0) {
        if (!o.backoff) o.startBackoff();
        o.backTo = Math.min(o.backTo, this.backTo - CB.carLen - 3);
      }
    }
    // nor back into any body the rails do not see (a car fouling a corner)
    if (!blocked) {
      const a = this.pointAt(this.s + CB.truck - 3, {}), b = this.pointAt(this.s - CB.truck - 3, {});
      const fx = a.x - b.x, fz = a.z - b.z, l = Math.hypot(fx, fz) || 1, f = { x: fx / l, z: fz / l };
      for (const o of sys.cars) {
        if (o === this || (o.cx - this.cx) ** 2 + (o.cz - this.cz) ** 2 > 30 * 30) continue;
        const next = boxPen((a.x + b.x) / 2, (a.z + b.z) / 2, f, o.cx, o.cz, o._fwd);
        if (next > -0.2 && next > boxPen(this.cx, this.cz, this._fwd, o.cx, o.cz, o._fwd) + 0.01) blocked = true;
      }
    }
    // (waiting for a weight counts here too: a queue backing to its gate)
    if (blocked && !this.hill && !this.hitch && this.s < tr.zIn[0] + 2) this._waitWeight(dt);
    if (!blocked) {
      this.u = -3.0;
      this.s = Math.max(this.backTo, this.s + this.u * dt);
      this._cable({});
      this._point();
    } else this.u = 0;
    this._boT = (this._boT || 0) + dt;
    if (this.s <= this.backTo + 0.01 || (blocked && this._boT > 12)) {
      this.backoff = false; this.u = 0; this._boT = 0; this.headOnT = 0;
      if (!this.hitch && this.s < tr.zIn[1] + 2) this.hill = null;
      this.state = 'run'; this.lastStop = null;
    }
  }

  /** Waiting at the gate: after 45 s the attendants wind a weight to this end. */
  _waitWeight(dt) {
    this.waitT += dt;
    if (this.waitT > 45) { this.sys.winch(this.track.climbs ? 1 : 0, this); this.waitT = 0; }
  }

  /** The car nose to nose with this one on its rails within 50 m, or null. */
  facingCar() {
    let best = null, bd = Infinity;
    for (const o of this.sys.cars) {
      if (o === this) continue;
      const r = this.sys.sameRails(this, o);
      if (!r || r.s < this.s || r.facing > -0.5) continue;
      const gap = r.s - this.s - CB.carLen;
      if (gap < 50 && gap < bd) { bd = gap; best = o; }
    }
    return best;
  }

  /**
   * NOSE TO NOSE on one pair of rails (a car you left on the hill, you
   * waiting on a mark a climbing car needs): one has to give way or neither
   * ever moves. The car on the cable keeps the hill (`yields`); the other
   * backs off to its own rails short of the hill. In service, standing or
   * dwelling alike -- a car dwelling at a mark used to wait for ever.
   */
  _headOn(dt) {
    const o = Math.abs(this.u) < 0.1 ? this.facingCar() : null;
    if (!o) { this.headOnT = 0; return false; }
    this.headOnT += dt;
    if (this.headOnT < 3 || !this.sys.yields(this, o)) return false;
    this.startBackoff();
    return true;
  }

  /** Back off: off the hill to the gate short of its crossover, or else 30 m. */
  startBackoff() {
    const tr = this.track;
    this.backoff = true; this._boT = 0; this.state = 'run';
    this.backTo = this.s > tr.gate - CB.carLen && this.s < tr.zOut[1] ? Math.min(this.s, tr.gate) : Math.max(CB.carLen / 2 + 1, this.s - 30);
  }

  /** The speed that still brakes, at `b`, to `stopS` and every limit ahead. */
  allowed(stopS, b) {
    const front = this.s + CB.carLen / 2;
    let v = stopS === null ? CB.vMax : Math.sqrt(Math.max(0, 2 * b * Math.max(0, stopS - this.s)));
    for (let d = 0; d <= 120; d += 6) v = Math.min(v, Math.sqrt(this.limitAt(front + d) ** 2 + 2 * b * d));
    for (let d = 0; d <= CB.carLen; d += 4) v = Math.min(v, this.limitAt(front - d));
    return v;
  }

  /** Change ends at a terminus: onto the other track, where this one ended. */
  flip() {
    const o = this.track.other, s = CB.carLen / 2 + 0.6;
    if (this.sys.cars.some((c) => c !== this && c.track === o && c.s < s + CB.carLen + 8)) return false;
    this.track = o; this.s = s; this.u = 0;
    this.hill = null; this.lastStop = null;
    this._point();
    return true;
  }

  _bell(gain = 0.9, n = 2) {
    const sys = this.sys, p = sys.player;
    if (!sys.audio || !sys.audio.ready || !p || Math.hypot(p.position.x - this.cx, p.position.z - this.cz) > 180) return;
    for (let i = 0; i < n; i++) sys.audio.play('cable_bell', { gain, x: this.cx, y: this.cy + 2.5, z: this.cz, ref: 12, maxD: 220, at: i * 0.32, jitter: false });
  }

  /** The crew drives: the timetable, the stops, the hitch and the hill gate. */
  service(dt, boot = false) {
    const sys = this.sys, tr = this.track, k = tr.key;
    this._ghost = false;
    if (this.backoff) { this._backOff(dt); return; }
    // ON THE HILL WITH NO CABLE OF ITS OWN (you left it there, or at the mark
    // a climbing car needs): the crew backs it to the gate, where it waits
    // its turn like any car
    if (!this.hitch && !this.hill && this.s > tr.zIn[0] && this.s < tr.h2 - 2 && !sys.assign(this, this.s > tr.zIn[1] - 2)) {
      // past the mark, on its own rails, it goes on (the crew gets it up or
      // down, `_ghost`): backing it would run it into whoever follows it
      if (this.s > tr.h1 + CB.hookTol + 2) this.hill = tr.side;
      else { this.startBackoff(); return; }
    }
    if (this._headOn(dt)) return;
    if (this.state === 'dwell') {
      this.u = 0;
      this.timer -= dt;
      const st = this.stop;
      // the attendants hook it on, or off
      if (st && st.hitch && this.timer < CB.hitchDwell - 1.5) {
        if (this.hitch && Math.abs(this.s - tr.h2) < 3) sys.unhitch(this);
        else if (!this.hitch && Math.abs(this.s - tr.h1) < 3) {
          if (!this.hill) sys.assign(this, true);
          if (!sys.hitch(this)) {
            this.timer = Math.max(this.timer, 1);
            this.waitT += dt;
            if (this.waitT > 40) { sys.winch(tr.climbs ? 1 : 0, this); this.waitT = 0; }
          }
        }
      }
      // A CAR WAITS FOR YOU: on foot beside it, it holds (up to a minute)
      const p = sys.player;
      if (!boot && p && p.onFoot && this.timer < 2 && this.held < 60 && Math.hypot(p.position.x - this.cx, p.position.z - this.cz) < 25) { this.timer = 2; this.held += dt; }
      if (this.timer > 0) return;
      if (st && st.term && this.s > tr.len - CB.carLen) {
        if (!this.flip()) { this.timer = 2; return; }
        this.state = 'run';
        if (!boot) this._bell(0.8, 2);
        return;
      }
      this.state = 'run';
      this.lastStop = st;
      if (!boot) this._bell(0.8, 2);
      return;
    }
    const st = this.nextStop();
    let stopS = st ? st.s[k] : null;
    this._why = '';
    // at the end of the line with no stop ahead (the terminus was already
    // made -- you stopped there and got off rolling): change ends
    if (!st && this.s > tr.len - CB.carLen) {
      const term = tr.stops[tr.stops.length - 1];
      if (term && term.term) { this.u = 0; this.state = 'dwell'; this.stop = term; this.timer = 2; this.held = 60; return; }
    }
    // THE SCISSORS: changing sides, a car takes the crossover for itself
    // (and waits short of it until it is empty); anyone else waits short of
    // a crossover someone is changing sides in
    const waitAt = (sx) => { stopS = stopS === null ? sx : Math.min(stopS, sx); };
    for (const end of ['bot', 'top']) {
      // (into the hill everyone waits at the gate, which is off the Roy
      // corner; out of it, at the far mark)
      const z = sys.zoneAt(tr, end), isIn = z === tr.zIn, entry = isIn ? tr.gate : tr.h2;
      const crossing = this.hill && this.hill !== tr.side;
      const before = isIn ? this.s > entry - 60 && this.s < z[0] - CB.carLen / 2 + 0.5 : this.s >= tr.h2 - 6 && this.s < z[0] - CB.carLen / 2 + 0.5;
      const front = isIn ? this.s > entry - 15 : true;
      if (crossing && before && front) {
        if (!sys.takeX(this, end)) {
          if (isIn && this.s > entry + 1.5) { this.startBackoff(); return; }
          waitAt(Math.max(this.s, entry)); this._why = 'xlock';
        }
      } else if (crossing && sys.xlock[end] === this && this.s > z[1] + CB.carLen / 2 + 3) sys.xlock[end] = null;
      else if (before && sys.xHeld(this, end)) {
        if (isIn && this.s > entry + 1.5 && this.s < z[0] - CB.carLen / 2) { this.startBackoff(); return; }
        waitAt(Math.max(this.s, entry)); this._why = 'xheld';
      }
    }
    // THE HILL GATE: the hill is taken only on a track whose weight is at
    // this end; with neither free it waits short of the crossover
    if (!this.hill && this.s < tr.zIn[0] && tr.gate - this.s < 90) {
      if (!sys.assign(this)) {
        // a car already past the gate (you left it there) backs to it: the
        // gate is where a waiting car fouls nothing
        if (this.s > tr.gate + 1.5) { this.startBackoff(); return; }
        const sig = tr.gate;
        if (stopS === null || sig < stopS) { stopS = sig; this._why = 'gate'; }
        if (Math.abs(this.u) < 0.05 && this.s > sig - 2) this._waitWeight(dt);
      } else this.waitT = 0;
    }
    // left on the cable unhooked (you got off there): the crew hooks it back on
    if (!this.hitch && this.s > tr.h1 - 1 && this.s < tr.h2 + 1) this._ghost = true;
    // braking planned at what the brakes leave over the grade going down
    const bEff = clamp(0.9 + G_ACC * Math.min(0, this.grade) * (this.hitch ? 0.25 : 0.8), 0.35, 0.9);
    let v = this.allowed(stopS, bEff);
    // ANY BODY, whatever the rails say (yours fouling a corner, one across a
    // crossover, the Roy corner's swing): the crew does not drive into it.
    // Only a move that brings the two closer counts, and two cars blocking
    // each other this way for 8 s settle it as nose to nose does.
    let boxBy = null;
    const look = 3 + Math.max(0, this.u) ** 2 / 2;   // (as far as it takes to stop)
    for (const o of sys.cars) {
      if (o === this || (o.cx - this.cx) ** 2 + (o.cz - this.cz) ** 2 > 30 * 30) continue;
      const now = boxPen(this.cx, this.cz, this._fwd, o.cx, o.cz, o._fwd);
      // every 2 m of the way: passing a corner, the closest point is on the way
      for (let d = 2; d <= look + 0.01 && !boxBy; d = Math.min(look, d + 2) === d ? look + 1 : Math.min(look, d + 2)) {
        const a = this.pointAt(this.s + CB.truck + d, {}), b = this.pointAt(this.s - CB.truck + d, {});
        const fx = a.x - b.x, fz = a.z - b.z, l = Math.hypot(fx, fz) || 1;
        const next = boxPen((a.x + b.x) / 2, (a.z + b.z) / 2, { x: fx / l, z: fz / l }, o.cx, o.cz, o._fwd);
        if (next > -0.2 && next > now + 0.01) { v = 0; boxBy = o; this._why = 'box ' + o.number; }
      }
    }
    if (boxBy && Math.abs(this.u) < 0.1) {
      this.boxT = (this.boxT || 0) + dt;
      if (this.boxT > 8 && boxBy.driver !== 'player' && sys.yields(this, boxBy)) { this.boxT = 0; this.startBackoff(); return; }
    } else this.boxT = 0;
    // the car ahead on these RAILS, 10 m behind its back fender (20 m from
    // one nose to nose): by where it is, for on the hill a car of the other
    // direction can be on ours
    for (const o of sys.cars) {
      if (o === this) continue;
      // (a car ahead on this track counts wherever it is: through a crossover
      // the two may be on different rails and still overlap)
      const r = sys.inWay(this, o);
      if (!r || r.s < this.s) continue;
      const gap = r.s - this.s - CB.carLen - (r.facing < 0 ? 20 : 10);
      if (gap < 2) this._why = 'ahead ' + o.number; v = Math.min(v, gap > 0 ? Math.sqrt(2 * 0.9 * gap) : 0);
      // you, just ahead, holding BRAKE to back up: the crew backs out of your way
      if (o.driver === 'player' && r.facing > 0 && gap < 6 && o._revT > 0.6 && Math.abs(this.u) < 0.1) { this.startBackoff(); return; }
    }
    if (this._headOn(dt)) return;
    // edging on past you at a walk (you would not get off the rails)
    if (this.creep) { v = Math.min(v, 1.0); this.creep = false; if (this.bellT <= 0 && !boot) { this.bellT = 1.7; this._bell(1, 2); } }
    // something on the rails: brake for it, and ring
    let emerg = false;
    if (this.obstructAt < Infinity) {
      const vo = Math.sqrt(Math.max(0, 2 * 1.0 * (this.obstructAt - 3)));
      if (this.u > vo + 0.3) emerg = true;
      v = Math.min(v, vo); if (vo < 0.5) this._why = 'obstruct';
      if (this.bellT <= 0 && !boot) { this.bellT = 1.7; this._bell(1, 3); }
      this.obstructAt = Infinity;
    }
    this.bellT -= dt;
    // standing on the approach or the hill for want of a cable: the
    // attendants wind a weight round to this end in the end, wherever it stands
    if (Math.abs(this.u) < 0.05 && !this.hitch && this.s > tr.gate - 30 && this.s < tr.h2 && v < 0.3) this._waitWeight(dt);
    if (v < 0.3 && !this._why) this._why = `v ${v.toFixed(1)} stop ${stopS === null ? '-' : Math.round(stopS - this.s)}`;
    const u = this.u;
    let power = 0, brake = 0;
    if (u < v - 0.5) power = 1;
    else if (u > v + 0.2) brake = clamp((u - v) / 0.5 + Math.max(0, -this.grade) * 3, 0.3, 1);
    else if (u > v) brake = 0.2;
    // standing (or all but): hold it on the brake, or a grade rolls it back
    if (v < 0.4 && u < 0.4) { power = 0; brake = 1; }
    // rolling backwards (you left it sliding back down the hill): brake first
    if (u < -0.3) { power = 0; brake = 1; }
    const left = stopS === null ? Infinity : stopS - this.s;
    // creeping onto the mark: enough power to hold the grade it is on
    const hold = clamp(0.3 + Math.max(0, CB.mass * G_ACC * this.grade - (this.hitch || this._ghost ? CB.cw * G_ACC * CB.tunnel * (tr.climbs ? 1 : -1) : 0)) / (CB.acc * CB.mass), 0.3, 1);
    if (left < 0.25 || emerg) { power = 0; brake = 1; } else if (left < 3 && u < 0.6) { power = hold; brake = 0; }
    this.step(dt, power, brake);
    if (st && stopS === st.s[k] && Math.abs(this.u) < 0.06 && stopS - this.s < 0.7 && stopS - this.s > -1.5) {
      this.u = 0;
      this.state = 'dwell'; this.stop = st; this.lastStop = st; this.held = 0; this.waitT = 0;
      this.timer = st.term ? CB.termDwell : st.hitch ? Math.max(CB.dwell, CB.hitchDwell) : CB.dwell;
    }
  }

  /** Back into service from wherever it stands (you left it). */
  resume() {
    this.driver = null;
    this.mode = 'service';
    const st = Math.abs(this.u) < 0.1 ? this.stopHere() : null;
    if (st) { this.state = 'dwell'; this.stop = st; this.timer = 4; this.held = 0; this.lastStop = st; } else this.state = 'run';
    this.headOnT = 0; this.stuckT = 0;
  }

  /**
   * RIDING THE HILL: from the back platform, looking down Queen Anne Avenue
   * at the city -- Lower Queen Anne, the Needle, downtown -- the view the
   * line was ridden for. Only riding (RIDE), only on the counterbalance and
   * its approaches, and only while you are not looking round yourself.
   * player.updateCamera's hook, as Link's cab camera is.
   */
  camRig(p, dt) {
    const tr = this.track;
    if (this.mode !== 'ride' || p.lookT < 3 || this.s < tr.h1 - 40 || this.s > tr.h2 + 40) { this._rig = false; return false; }
    // the end facing down the hill: the back of a car going up, the front of one coming down
    const down = tr.climbs ? -1 : 1;
    const f = this._fwd, rx = -f.z, rz = f.x;
    const e = this.pointAt(this.s + down * (CB.carLen / 2 + 1.5), {});
    const want = new THREE.Vector3(e.x + rx * 1.9, e.y + 3.1, e.z + rz * 1.9);
    const far = this.pointAt(clamp(this.s + down * 420, 0, tr.len), {});
    const look = new THREE.Vector3(far.x, far.y + 18, far.z);
    if (!this._rig) { p.camPos.copy(want); p.camLook.copy(look); } else {
      const k = 1 - Math.exp(-4 * dt);
      p.camPos.lerp(want, k); p.camLook.lerp(look, k);
    }
    this._rig = true;
    p.camRel = null; p.camLookRel = null; p.camUp = null; p.camFloor = null;
    p.camYaw = Math.atan2(p.camPos.x - p.camLook.x, p.camPos.z - p.camLook.z);
    return true;
  }

  /** The motorman's readout (and the passenger's): short enough for a
   *  phone's top pill, in the speedometer's km/h. */
  readout() {
    const sys = this.sys, tr = this.track, kmh = (v) => Math.round(v * 3.6);
    if (this.mode === 'ride') {
      const st = this.state === 'dwell' ? this.stop : this.nextStop();
      return `Riding ${this.number}${st ? ` · ${this.state === 'dwell' ? 'at' : 'next'} ${st.name}` : ''}${this.hitch ? ' · on the cable' : ''}`;
    }
    const lim = kmh(Math.min(...[0, 15, 30].map((d) => this.limitAt(this.s + CB.carLen / 2 + d))));
    const head = `${this.number} · ${kmh(Math.abs(this.u))}/${lim} km/h`;
    const near = tr.climbs ? 'Roy' : 'Lee', far = tr.climbs ? 'Lee' : 'Roy';
    if (this.hitch) return `${head} · cable ${Math.round(sys.weights[this.hitch].f * 100)}% · ${far} ${Math.round(Math.abs(tr.h2 - this.s))} m`;
    const d1 = tr.h1 - this.s;
    if (d1 > -CB.hookTol - 1 && d1 < 160) {
      const ok = this.hill ? sys.free(this.hill, this) : sys.free('E', this) || sys.free('W', this);
      if (ok) return `${head} · hook on at ${near}: ${d1.toFixed(d1 < 30 ? 1 : 0)} m`;
      const fc = this.facingCar();
      return `${head} · ${near}: ${fc && fc.hitch ? 'car coming — hold BRAKE, back up' : sys.noHookWhy(this).startsWith('no weight') ? 'no weight yet, wait' : 'cable busy, wait'}`;
    }
    if (this.s > tr.h1 + 3 && this.s < tr.h2 - 3) return `${head} · no weight: ${tr.climbs ? 'back down to Roy' : 'brakes won\'t hold'}`;
    const st = this.nextStop();
    if (!st) return `${head} · end: POWER to change ends`;
    const left = st.s[tr.key] - this.s;
    return `${head} · ${st.name} ${Math.max(0, left).toFixed(left < 30 ? 1 : 0)} m`;
  }

  /** player.js calls this as it calls any vehicle's update. */
  update(dt, input) {
    const sys = this.sys, tr = this.track;
    this.driver = 'player';
    this.warned -= dt;
    if (this.mode === 'ride') { this.service(dt); return; }
    const thr = clamp(input.throttle || 0, 0, 1), brk = clamp(input.brake || 0, 0, 1);
    // THE END OF THE LINE: POWER at a stand changes ends
    if (this.s > tr.len - CB.carLen / 2 - 2 && Math.abs(this.u) < 0.05 && thr > 0.3) {
      if (this.flip()) { sys.say(`Changed ends — back toward ${this.track.key === 'out' ? 'McGraw St' : 'Pioneer Square'}`); this.arrival = { from: null, t: 0, rated: false }; } else sys.sayOnce('flip', 'Wait — a car is at the other platform', 4);
      return;
    }
    let power = thr;
    // BRAKE held at a stand reverses, on any grade (the brake holds a stand
    // by itself, below, so holding it means "back"): you must always be able
    // to get out of the way
    if (brk > 0.5 && thr < 0.1 && (Math.abs(this.u) < 0.05 || this._revT > 1.2)) { this._revT += dt; if (this._revT > 1.2) power = -1; } else this._revT = 0;
    // backing up into a crew's car just behind you: it backs out of your way
    if (this._revT > 0.6) {
      for (const o of sys.cars) {
        if (o === this || o.driver === 'player' || o.backoff) continue;
        const r = sys.inWay(this, o);
        if (r && r.facing > 0 && r.s < this.s && this.s - r.s < CB.carLen + 5) o.startBackoff();
      }
    }
    // AT A STAND THE BRAKE HOLDS by itself until you touch POWER (a grade
    // must not roll a car you have just boarded)
    let brake = brk;
    if (thr < 0.05 && power >= 0 && Math.abs(this.u) < 0.15) brake = 1;
    // the hill: a track is given you on the way to the crossover, if one is
    // free -- and if none is, THE SIGNAL holds you short of the crossover, as
    // it holds the crew's cars: a car waiting on a mark stands where a car on
    // the cable has to arrive
    const gate = tr.gate;
    if (!this.hill && this.s < tr.zIn[0] + 2 && tr.gate - this.s < 60) {
      sys.assign(this);
      if (!this.hill && this.s > gate - 25) sys.sayOnce('signal', `Signal at ${tr.climbs ? 'Roy' : 'Lee'}: ${sys.noHookWhy(this)}`, 8);
    }
    // hook on (or off), standing at the attendants' box
    // hook on (or off) standing on the mark (within CB.hookTol), not pressing
    // POWER or reversing; never straight back on where a sheave just let go
    if (this._sheaveAt !== undefined && Math.abs(this.s - this._sheaveAt) > 3) this._sheaveAt = undefined;
    if (Math.abs(this.u) < 0.3 && thr < 0.05 && power >= 0 && this._sheaveAt === undefined) {
      if (!this.hitch && Math.abs(this.s - tr.h1) <= CB.hookTol) {
        this._hitchT += dt;
        if (this._hitchT > 0.8) {
          if (!this.hill) sys.assign(this, true);
          if (!sys.hitch(this)) {
            this.waitT += dt;
            sys.sayOnce('noweight', sys.noHookWhy(this), 8);
            if (this.waitT > 20) { const P = sys.winch(tr.climbs ? 1 : 0, this); this.waitT = 0; if (P) sys.say(`The attendants wind the ${P === 'E' ? 'east' : 'west'} weight ${tr.climbs ? 'up' : 'down'} for you`); }
          } else this.waitT = 0;
        }
      } else if (this.hitch && Math.abs(this.s - tr.h2) <= CB.hookTol) {
        this._hitchT += dt;
        if (this._hitchT > 0.8) { sys.unhitch(this); this._hitchT = 0; }
      } else {
        this._hitchT = 0;
        if (!this.hitch && Math.abs(this.s - tr.h1) < 4) sys.sayOnce('closer', `Closer — the plow is at the mark (${(tr.h1 - this.s).toFixed(1)} m)`, 4);
      }
    } else this._hitchT = 0;
    const ev = this.step(dt, power, power < 0 ? 0 : brake);
    if (!this.hill && !this.hitch && this.s > gate && this.s < tr.zIn[0] + 4 && this.u >= 0) {
      this.s = gate; this.u = 0; this._point();
    }
    // THE STOP BLOCK: nobody goes DOWN the counterbalance without a weight.
    // The attendant at Lee throws it in front of a car that is not hooked on
    // (the 1919 runaway [K] is how they learned).
    if (!tr.climbs && !this.hitch && this.s > tr.h1 + CB.hookTol && this.s < tr.h1 + 12) {
      this.s = tr.h1 + CB.hookTol - 0.25; this.u = Math.min(this.u, 0); this._point();   // (0.75 m: inside the hook window)
      sys.sayOnce('block', 'Stop block — no going down without a weight. Hook on at the mark', 6);
    }
    if (this.arrival) this.arrival.t += dt;
    if (ev.end) sys.sayOnce('end', 'End of the line — POWER at a stand to change ends', 6);
    if (ev.sheave) { sys.sayOnce('sheave', 'CLUNK — the plow hit the sheave: unhooked', 6); if (ev.sheave > 3 && sys.game) { sys.game.onCrash(ev.sheave * 2, false); sys.game.damagePlayer(ev.sheave * 3, 'crash'); } }
    if (ev.collide) sys.onCollide(ev.collide);
    if (this.slip) sys.sayOnce('slip', 'Wheels spinning — too steep without a weight', 8);
    // too fast for a curve: the flanges squeal; far too fast, it hurts
    if (ev.lat > 1.5) {
      sys.sayOnce('curve', 'Too fast for the curve — ease off', 4);
      if (ev.lat > 3) { if (sys.game) sys.game.damagePlayer((ev.lat - 3) * dt * 8, 'crash'); this.u *= Math.exp(-0.5 * dt); }
      this.skid = Math.max(this.skid, clamp((ev.lat - 1.5) / 2, 0, 1));
    }
    // the 1919 runaway [K]
    const onHill = this.s > tr.h1 && this.s < tr.h2;
    if (onHill && !this.hitch && Math.abs(this.u) > 7 && !this._runaway) { this._runaway = true; sys.say('RUNAWAY! As in 1919, near Aloha St, at 35 mph', 4200); }
    if (!onHill) this._runaway = false;
    // at rest on a stop's mark: the stop is judged
    if (Math.abs(this.u) < 0.02 && this.arrival && !this.arrival.rated) {
      let best = null, err = 0;
      for (const st of tr.stops) { const e = st.s[tr.key] - this.s; if (Math.abs(e) < 12 && (!best || Math.abs(e) < Math.abs(err))) { best = st; err = e; } }
      if (best && best !== this.arrival.from) {
        sys.onArrive(this, best, err);
        this.lastStop = best;
        this.arrival = { from: best, t: 0, rated: true };
      }
    }
    if (this.arrival && this.arrival.rated && Math.abs(this.u) > 0.5) this.arrival = { from: this.arrival.from, t: 0, rated: false };
    if (!this.arrival) this.arrival = { from: null, t: 0, rated: false };
  }
}

// ---------------------------------------------------------------------------
// The car, as car 315 stands in the July 1940 photograph [PNR]. Car-local
// metres: +z toward the end it is running to, y = 0 on the rail head, +x to
// the left. Body (one draw) and trim -- glass, nickel, brass (the vehicles'
// trim draw). Both ends are the same car turned through 180 degrees, so a
// car that changes ends at a terminus needs no other model; only the trolley
// poles differ, and the raised one is always at the back.

const C = {
  cream: [0.70, 0.60, 0.38], green: [0.02, 0.075, 0.04], roof: [0.075, 0.068, 0.06], dark: [0.03, 0.03, 0.032],
  under: [0.045, 0.043, 0.04], rattan: [0.42, 0.30, 0.13], ceil: [0.6, 0.56, 0.44], floor: [0.13, 0.08, 0.045],
  brass: [0.62, 0.45, 0.16], nickel: [0.55, 0.56, 0.58], lamp: [1.0, 0.95, 0.78], sign: [0.86, 0.85, 0.8],
  steel: [0.16, 0.16, 0.17], ad: [0.06, 0.06, 0.07], adInk: [0.85, 0.8, 0.6],
};
// a 3 x 5 pixel font: enough for route numbers, car numbers and destinations
const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '111100100100111', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '111100101101111', H: '101101111101101', I: '111010010010111', J: '001001001101111',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '111101101101111',
  P: '111101111100100', Q: '111101101111011', R: '110101110101101', S: '111100111001111', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101101111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '-': '000000111000000', '.': '000000000000010', ' ': '000000000000000',
};

/** Pixel text: from `o` along unit `u`, `h` tall, on a face with normal `n`. */
function text(B, str, o, u, n, h, col, centre = true) {
  const c = h / 5, adv = 4 * c, w = str.length * adv - c;
  const o0 = centre ? [o[0] - u[0] * w / 2, o[1], o[2] - u[2] * w / 2] : o;
  for (let k = 0; k < str.length; k++) {
    const g = FONT[str[k]] || FONT[' '];
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) {
      if (g[r * 3 + q] !== '1') continue;
      const a = k * adv + q * c, y = o0[1] + (4 - r) * c;
      const P = (du, dv) => [o0[0] + u[0] * (a + du), y + dv, o0[2] + u[2] * (a + du)];
      B.quad(P(0, 0), P(c, 0), P(c, c), P(0, c), n, [0, 0, 1, 0, 1, 1, 0, 1], col);
    }
  }
}

function buildCarGeometry(number) {
  const B = new Builder(false), T = new Builder(false);
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  const HW = CB.wid / 2, YS = 0.72, YB = 1.84, YT = 2.76, YE = 3.0, FL = 1.0;
  const ZS = 4.45, ZV = 5.62, ZE = 6.25, XE = 0.64;
  // a wall piece on the plane x = sd * w, z0..z1, y0..y1
  const wallX = (b, sd, w, z0, z1, y0, y1, col) => b.quad([sd * w, y0, z0], [sd * w, y0, z1], [sd * w, y1, z1], [sd * w, y1, z0], [sd, 0, 0], uv, col);

  // ---- the saloon's sides: ten windows a side with guard bars ----
  const nW = 10, pitch = (2 * ZS) / nW;
  for (const sd of [1, -1]) {
    wallX(B, sd, HW, -ZS, ZS, 0.5, YS, C.under);
    wallX(B, sd, HW, -ZS, ZS, YS, YB - 0.1, C.cream);
    wallX(B, sd, HW + 0.012, -ZS, ZS, YB - 0.1, YB, C.green);           // the belt rail
    wallX(B, sd, HW, -ZS, ZS, YT, YE, C.cream);                           // the letterboard
    wallX(B, sd, HW + 0.004, -ZS, ZS, YT, YT + 0.035, C.green);
    wallX(B, sd, HW + 0.004, -ZS, ZS, YE - 0.035, YE, C.green);
    wallX(B, sd, HW + 0.004, -ZS, ZS, YS + 0.05, YS + 0.08, C.green);     // a lining stripe
    for (let j = 0; j < nW; j++) {
      const z0 = -ZS + j * pitch, z1 = z0 + pitch, g0 = z0 + 0.06, g1 = z1 - 0.06;
      wallX(B, sd, HW, z0, g0, YB, YT, C.green);
      wallX(B, sd, HW, g1, z1, YB, YT, C.green);
      wallX(B, sd, HW + 0.006, g0, g1, 2.38, 2.43, C.green);               // the upper sash's rail
      wallX(T, sd, HW - 0.02, g0, g1, YB, YT, GLASS);
      // the guard bars across the lower sash, as the photograph shows them
      for (const yb of [1.98, 2.13]) wallX(T, sd, HW + 0.035, g0 - 0.02, g1 + 0.02, yb, yb + 0.022, C.nickel);
    }
    // the car's number near each end, read from the street
    const dir = sd > 0 ? [0, 0, -1] : [0, 0, 1];
    for (const zc of [-3.55, 3.55]) text(B, String(number), [sd * (HW + 0.006), 1.12, zc], dir, [sd, 0, 0], 0.2, C.green);
  }
  // inside: floor, liners under the windows, the ceiling, the cross seats
  B.quad([-HW + 0.05, FL, -ZE + 0.1], [HW - 0.05, FL, -ZE + 0.1], [HW - 0.05, FL, ZE - 0.1], [-HW + 0.05, FL, ZE - 0.1], [0, 1, 0], uv, C.floor);
  B.quad([-HW + 0.05, YE - 0.03, -ZS], [HW - 0.05, YE - 0.03, -ZS], [HW - 0.05, YE - 0.03, ZS], [-HW + 0.05, YE - 0.03, ZS], [0, -1, 0], uv, C.ceil);
  for (const sd of [1, -1]) {
    wallX(B, sd, HW - 0.04, -ZS, ZS, FL, YB, C.green);
    B.quad([sd * (HW - 0.04), FL, -ZS], [sd * (HW - 0.04), FL, ZS], [sd * (HW - 0.04), YB, ZS], [sd * (HW - 0.04), YB, -ZS], [-sd, 0, 0], uv, C.green);
    for (let j = 1; j < nW - 1; j++) {
      const zc = -ZS + (j + 0.5) * pitch;
      B.box(sd * 0.66, FL + 0.38, zc, 0.84, 0.1, 0.46, 0, C.rattan);
      B.box(sd * 0.66, FL + 0.48, zc + 0.24, 0.84, 0.5, 0.07, 0, C.rattan);
    }
  }
  // grab poles at the bulkheads (brass)
  for (const zz of [-ZS + 0.1, ZS - 0.1]) for (const sd of [1, -1]) T.tube([sd * 0.3, FL, zz], [sd * 0.3, YE - 0.05, zz], 0.02, 5, C.brass);

  // ---- the roof: a railroad clerestory over the saloon ----
  const prof = [[HW + 0.05, YE - 0.02], [1.06, 3.17], [0.8, 3.25], [0.8, 3.27], [0.78, 3.5], [0.62, 3.57], [0.32, 3.62], [0, 3.635]];
  const ring = (z, sd) => prof.map(([x, y]) => [sd * x, y, z]);
  for (const sd of [1, -1]) {
    const A = ring(-ZS, sd), Bz = ring(ZS, sd);
    for (let i = 0; i < prof.length - 1; i++) {
      const ex = prof[i + 1][1] - prof[i][1], ey = prof[i][0] - prof[i + 1][0], l = Math.hypot(ex, ey) || 1;
      const n = [sd * ex / l, ey / l, 0];
      if (i === 3) {
        // the clerestory's side: little windows between posts
        const n2 = [sd, 0, 0];
        const nC = 12, pc = (2 * ZS) / nC;
        for (let j = 0; j < nC; j++) {
          const z0 = -ZS + j * pc, z1 = z0 + pc;
          B.quad([sd * 0.79, 3.27, z0], [sd * 0.79, 3.27, z1], [sd * 0.79, 3.31, z1], [sd * 0.79, 3.31, z0], n2, uv, C.green);
          B.quad([sd * 0.79, 3.46, z0], [sd * 0.79, 3.46, z1], [sd * 0.79, 3.5, z1], [sd * 0.79, 3.5, z0], n2, uv, C.green);
          B.quad([sd * 0.79, 3.31, z0], [sd * 0.79, 3.31, z0 + 0.08], [sd * 0.79, 3.46, z0 + 0.08], [sd * 0.79, 3.46, z0], n2, uv, C.green);
          T.quad([sd * 0.785, 3.31, z0 + 0.08], [sd * 0.785, 3.31, z1], [sd * 0.785, 3.46, z1], [sd * 0.785, 3.46, z0 + 0.08], n2, uv, GLASS);
        }
        continue;
      }
      B.quad(A[i], Bz[i], Bz[i + 1], A[i + 1], n, uv, C.roof);
    }
  }
  // the clerestory's ends, sloping down to the vestibule roofs
  for (const ez of [-1, 1]) {
    const z0 = ez * ZS, z1 = ez * (ZS + 0.55);
    B.quad([-0.8, 3.27, z0], [0.8, 3.27, z0], [0.62, 3.57, z0], [-0.62, 3.57, z0], [0, 0.2, ez], uv, C.roof);
    B.quad([-0.62, 3.57, z0], [0.62, 3.57, z0], [0.3, 3.32, z1], [-0.3, 3.32, z1], [0, 0.8, ez * 0.6], uv, C.roof);
    B.quad([0.62, 3.57, z0], [0.8, 3.27, z0], [0.8, 3.27, z0], [0.3, 3.32, z1], [0.6, 0.6, ez * 0.4], uv, C.roof);
    B.quad([-0.62, 3.57, z0], [-0.3, 3.32, z1], [-0.8, 3.27, z0], [-0.8, 3.27, z0], [-0.6, 0.6, ez * 0.4], uv, C.roof);
  }

  // ---- each end: the vestibule, its dash, doors and signs, the fender ----
  for (const sz of [1, -1]) {
    const P = (x, y, z) => [sz * x, y, sz * z];
    const N = (x, y, z) => [sz * x, y, sz * z];
    const q = (b, a, bb, c, d, n, col) => b.quad(P(...a), P(...bb), P(...c), P(...d), N(...n), uv, col);
    const hwAt = (z) => (z <= ZV ? HW : HW - ((HW - XE) * (z - ZV)) / (ZE - ZV));
    // the vestibule's roof: a hood over the end, narrowing with the plan
    const vprof = [[1, YE - 0.02], [0.84, 3.17], [0.5, 3.28], [0, 3.33]];
    const vz = [ZS, ZV, ZE + 0.06];
    for (let r = 0; r < vz.length - 1; r++) {
      for (const sd of [1, -1]) {
        for (let i = 0; i < vprof.length - 1; i++) {
          const w0 = hwAt(Math.min(vz[r], ZE)) + 0.05, w1 = hwAt(Math.min(vz[r + 1], ZE)) + 0.05;
          const a = [sd * vprof[i][0] * w0, vprof[i][1], vz[r]], b = [sd * vprof[i][0] * w1, vprof[i][1], vz[r + 1]];
          const c = [sd * vprof[i + 1][0] * w1, vprof[i + 1][1], vz[r + 1]], d = [sd * vprof[i + 1][0] * w0, vprof[i + 1][1], vz[r]];
          q(B, a, b, c, d, [sd * 0.3, 1, 0], C.roof);
        }
      }
    }
    // the hood's front edge
    for (const sd of [1, -1]) {
      const w = XE + 0.05, z = ZE + 0.06;
      for (let i = 0; i < vprof.length - 1; i++) q(B, [sd * vprof[i][0] * w, vprof[i][1], z], [sd * vprof[i + 1][0] * w, vprof[i + 1][1], z], [0, YE - 0.02, z], [0, YE - 0.02, z], [0, 0, 1], C.roof);
    }
    // ceiling of the vestibule
    q(B, [-HW + 0.05, YE - 0.03, ZS], [HW - 0.05, YE - 0.03, ZS], [XE, YE - 0.03, ZE - 0.05], [-XE, YE - 0.03, ZE - 0.05], [0, -1, 0], C.ceil);
    // the sides of the vestibule, ZS..ZV: the door on the right (x < 0), a window on the left
    for (const sd of [1, -1]) {
      const x = sd * HW;
      if (sd < 0) {
        // the folding doors, open-work: green frames, glazed above, panels below
        const d0 = ZS + 0.1, d1 = ZV - 0.08, dm = (d0 + d1) / 2;
        for (const [a, b] of [[d0, dm - 0.01], [dm + 0.01, d1]]) {
          q(B, [x, 0.5, a], [x, 0.5, b], [x, YB - 0.1, b], [x, YB - 0.1, a], [-1, 0, 0], C.green);
          q(T, [x + 0.01, YB - 0.1, a + 0.05], [x + 0.01, YB - 0.1, b - 0.05], [x + 0.01, YT - 0.05, b - 0.05], [x + 0.01, YT - 0.05, a + 0.05], [-1, 0, 0], GLASS);
          q(B, [x, YB - 0.1, a], [x, YB - 0.1, a + 0.05], [x, YT, a + 0.05], [x, YT, a], [-1, 0, 0], C.green);
          q(B, [x, YB - 0.1, b - 0.05], [x, YB - 0.1, b], [x, YT, b], [x, YT, b - 0.05], [-1, 0, 0], C.green);
          q(B, [x, YT - 0.05, a], [x, YT - 0.05, b], [x, YT, b], [x, YT, a], [-1, 0, 0], C.green);
        }
        q(B, [x, YT, ZS], [x, YT, ZV], [x, YE, ZV], [x, YE, ZS], [-1, 0, 0], C.cream);
        // the step, and the grab rails either side of the door
        const st = P(-(HW - 0.15), 0.38, (d0 + d1) / 2);
        B.box(st[0], 0.36, st[2], 0.36, 0.06, d1 - d0, 0, C.steel);
        for (const zz of [d0 - 0.03, d1 + 0.03]) T.tube(P(-(HW + 0.05), 1.0, zz), P(-(HW + 0.05), 2.4, zz), 0.017, 5, C.brass);
      } else {
        q(B, [x, 0.5, ZS], [x, 0.5, ZV], [x, YS, ZV], [x, YS, ZS], [1, 0, 0], C.under);
        q(B, [x, YS, ZS], [x, YS, ZV], [x, YB - 0.06, ZV], [x, YB - 0.06, ZS], [1, 0, 0], C.cream);
        q(T, [x - 0.02, YB - 0.06, ZS + 0.08], [x - 0.02, YB - 0.06, ZV - 0.08], [x - 0.02, YT, ZV - 0.08], [x - 0.02, YT, ZS + 0.08], [1, 0, 0], GLASS);
        q(B, [x, YB - 0.06, ZS], [x, YB - 0.06, ZS + 0.08], [x, YT, ZS + 0.08], [x, YT, ZS], [1, 0, 0], C.green);
        q(B, [x, YB - 0.06, ZV - 0.08], [x, YB - 0.06, ZV], [x, YT, ZV], [x, YT, ZV - 0.08], [1, 0, 0], C.green);
        q(B, [x, YT, ZS], [x, YT, ZV], [x, YE, ZV], [x, YE, ZS], [1, 0, 0], C.cream);
      }
    }
    // the rounded end: two angled faces and the front, dash below, windows above
    const faces = [[[HW, ZV], [XE, ZE]], [[XE, ZE], [-XE, ZE]], [[-XE, ZE], [-HW, ZV]]];
    for (const [[xa, za], [xb, zb]] of faces) {
      const nx = zb - za, nz = -(xb - xa), l = Math.hypot(nx, nz);
      const n = [nx / l, 0, nz / l];
      const front = Math.abs(n[2]) > 0.99;
      q(B, [xa, 0.5, za], [xb, 0.5, zb], [xb, YS, zb], [xa, YS, za], n, C.under);
      q(B, [xa, YS, za], [xb, YS, zb], [xb, YB - 0.06, zb], [xa, YB - 0.06, za], n, C.cream);
      q(B, [xa, YB - 0.12, za], [xb, YB - 0.12, zb], [xb, YB - 0.06, zb], [xa, YB - 0.06, za], n.map((v, i) => v * 1.0 + (i === 1 ? 0 : 0)), C.green);
      const lerpP = (t, y) => [xa + (xb - xa) * t, y, za + (zb - za) * t];
      const t0 = 0.06 / Math.hypot(xb - xa, zb - za), t1 = 1 - t0;
      q(T, lerpP(t0, YB - 0.06), lerpP(front ? 0.495 : t1, YB - 0.06), lerpP(front ? 0.495 : t1, YT), lerpP(t0, YT), n, GLASS);
      if (front) q(T, lerpP(0.505, YB - 0.06), lerpP(t1, YB - 0.06), lerpP(t1, YT), lerpP(0.505, YT), n, GLASS);
      q(B, lerpP(0, YB - 0.06), lerpP(t0, YB - 0.06), lerpP(t0, YT), lerpP(0, YT), n, C.green);
      q(B, lerpP(t1, YB - 0.06), lerpP(1, YB - 0.06), lerpP(1, YT), lerpP(t1, YT), n, C.green);
      if (front) q(B, lerpP(0.495, YB - 0.06), lerpP(0.505, YB - 0.06), lerpP(0.505, YT), lerpP(0.495, YT), n, C.green);
      q(B, [xa, YT, za], [xb, YT, zb], [xb, YE, zb], [xa, YE, za], n, C.cream);
    }
    // the dash: headlight, the route sign, the destination glass, an ad card
    const zf = ZE + 0.004;
    const hl = P(0, 1.3, ZE);
    B.tube(hl, P(0, 1.3, ZE + 0.13), 0.17, 10, C.dark, true);
    T.tube(P(0, 1.3, ZE + 0.13), P(0, 1.3, ZE + 0.15), 0.13, 10, C.lamp, true);
    T.tube(P(0, 1.3, ZE + 0.12), P(0, 1.3, ZE + 0.14), 0.175, 10, C.nickel);
    // "WEST QUEEN ANNE 26" on the dash, viewer's left of the headlight
    q(B, [-0.6, 0.92, zf], [-0.14, 0.92, zf], [-0.14, 1.62, zf], [-0.6, 1.62, zf], [0, 0, 1], C.sign);
    const u = [sz, 0, 0], tn = [0, 0, sz];
    text(B, 'WEST', P(-0.37, 1.5, zf + 0.004), u, tn, 0.06, C.dark);
    text(B, 'QUEEN ANNE', P(-0.37, 1.39, zf + 0.004), u, tn, 0.045, C.dark);
    text(B, '26', P(-0.37, 1.0, zf + 0.004), u, tn, 0.3, C.dark);
    // the ad card (a sale at the Bon Marche, in the photograph)
    q(B, [0.24, 0.98, zf], [0.6, 0.98, zf], [0.6, 1.6, zf], [0.24, 1.6, zf], [0, 0, 1], C.ad);
    for (let r = 0; r < 5; r++) q(B, [0.29, 1.08 + r * 0.1, zf + 0.003], [0.55 - (r % 2) * 0.06, 1.08 + r * 0.1, zf + 0.003], [0.55 - (r % 2) * 0.06, 1.12 + r * 0.1, zf + 0.003], [0.29, 1.12 + r * 0.1, zf + 0.003], [0, 0, 1], C.adInk);
    // the destination glass over the front window
    q(B, [-0.5, YT + 0.03, zf], [0.5, YT + 0.03, zf], [0.5, YE - 0.03, zf], [-0.5, YE - 0.03, zf], [0, 0, 1], C.sign);
    text(B, 'WEST Q-ANNE', P(0, YT + 0.07, zf + 0.004), u, tn, 0.1, C.dark);
    // the bumper, and the lifeguard's fender under the dash
    const bm = P(0, 0.62, ZE + 0.08);
    B.box(bm[0], 0.62, bm[2], 2.1, 0.12, 0.16, 0, C.steel);
    const fd = P(0, 0.16, ZE + 0.22);
    B.box(fd[0], 0.16, fd[2], 1.85, 0.16, 0.3, 0, C.dark);
    // the route box on the roof: "26"
    const rb = P(0, 3.3, ZE - 0.42);
    B.box(rb[0], 3.3, rb[2], 0.56, 0.4, 0.14, 0, C.dark);
    q(B, [-0.24, 3.34, ZE - 0.344], [0.24, 3.34, ZE - 0.344], [0.24, 3.66, ZE - 0.344], [-0.24, 3.66, ZE - 0.344], [0, 0, 1], C.sign);
    text(B, '26', P(0, 3.39, ZE - 0.338), u, tn, 0.22, C.dark);
  }

  // ---- underneath: the trucks, the air tank, the sill ----
  for (const tz of [-CB.truck, CB.truck]) {
    for (const sd of [1, -1]) {
      B.box(sd * 0.95, 0.24, tz, 0.1, 0.36, 2.2, 0, C.dark);
      for (const az of [tz - 0.76, tz + 0.76]) B.tube([sd * 0.66, 0.42, az], [sd * 0.8, 0.42, az], 0.42, 12, C.steel, true);
    }
    B.box(0, 0.5, tz, 1.9, 0.14, 0.4, 0, C.dark);       // the bolster
    B.box(0, 0.24, tz + 0.38, 1.0, 0.38, 0.5, 0, C.dark); // a motor
  }
  T.tube([0.42, 0.45, -1.9], [0.42, 0.45, 0.3], 0.21, 10, C.steel, true);
  B.box(0, 0.5, 0, 2.3, 0.2, 2 * ZE - 0.2, 0, C.under);

  // ---- the trolley poles: the back one up to the wire, the front one hooked down ----
  const tipY = CB.wire - 0.06, base = 1.3;
  B.box(0, 3.62, -base, 0.34, 0.14, 0.5, 0, C.dark);
  B.box(0, 3.62, base, 0.34, 0.14, 0.5, 0, C.dark);
  const len = 4.75, dz = Math.sqrt(len * len - (tipY - 3.76) ** 2);
  B.tube([0, 3.76, -base], [0, tipY, -base - dz], 0.035, 6, C.dark);
  B.box(0, tipY - 0.06, -base - dz, 0.1, 0.12, 0.16, 0, C.dark);           // the harp and its wheel
  B.tube([0, 3.76, base], [0, 3.92, base + 4.5], 0.035, 6, C.dark);
  B.box(0, 3.36, base + 4.45, 0.12, 0.56, 0.06, 0, C.dark);                 // the hook it rests in

  const geo = { body: B.build(), trim: T.build() };
  tagGlass(geo.trim);
  return geo;
}
