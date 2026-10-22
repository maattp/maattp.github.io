// Auto KW: junction controls -- traffic signals, stop signs, roundabouts and
// the paint at a junction -- from OSM (data/junctions.json, written by
// tools/kw/build_junctions.py). See "Junctions" in apps/autokw/CLAUDE.md.
//
// The road graph knows geometry and a class, never a node's tags, so this
// matches OSM's controls onto it once at boot (prepJunctions) and keeps, per
// graph node, which controller (if any) governs it:
//
//   SIG   a signalled intersection: one or more graph nodes (a divided road's
//         crossing is two or four), its APPROACHES (edges arriving from
//         outside it) split into two phase groups by axis, and a fixed cycle
//         (advance left arrows where OSM maps a left-turn lane, green, amber,
//         all-red). The clock is traffic.update's, so a paused game holds it.
//   STOP  a stop- (or yield-) controlled node: the approaches that carry the
//         sign, and `all` for an all-way stop (OSM stop=all, or every
//         approach signed).
//   RB    a roundabout ENTRY: a ring node with an approach from off the ring.
//         The ring is the graph's own one-way edges (OSM draws them
//         anticlockwise), matched to the junction=roundabout polyline.
//   MINI  a mini roundabout: an all-way yield.
//
// traffic.js asks `decide()` for the next controlled junction on a car's
// route; world.js asks `meshChunk()` for the paint, poles, signs and islands
// of a chunk; main.js's draw() calls `updateHeads()`, which draws the signal
// heads near the camera as two InstancedMeshes whose lenses change colour.

import * as THREE from './three.js';
import * as G from './geo.js';
import { CHUNK, ROAD_LIFT, WALK_LIFT } from './citygen.js';
import { hash2, clamp } from './util.js';
import { markBays, twoWayLayout, twoWayLaneOff } from './arterial.js';

export const K_SIG = 1, K_STOP = 2, K_RB = 3, K_MINI = 4;
const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
// signal heads are drawn within this of the camera
const HEAD_R = ON_PHONE ? 230 : 330;
// the cycle (s): advance left arrow, its clearance, amber by speed, all-red
const T_ADV = 7, T_CLR = 2, T_RED = 2;
const GREEN = { art: 24, st: 18, res: 14, ramp: 16, hwy: 26 };
const RANK = { hwy: 5, art: 4, ramp: 3, st: 2, res: 1 };
// the deceleration a driver will brake at for an amber
const AMBER_B = 3.2;
// a two-way stop's gap: no major-road car may arrive within this (s)
const GAP_T = 6;
// a roundabout entry's gap to circulating traffic (s)
const RB_GAP = 3.2;
// two lefts' ways through a box meet when they pass closer than their half
// widths and this (m) -- leftClash
const CLASH_PAD = 0.9;
/** Do two sampled ways (boxPath) come within `w` of each other? */
function pathsMeet(a, b, w) {
  const w2 = w * w;
  for (let i = 0; i < a.n; i++) {
    const ax = a[2 * i], az = a[2 * i + 1];
    for (let j = 0; j < b.n; j++) if ((b[2 * j] - ax) ** 2 + (b[2 * j + 1] - az) ** 2 < w2) return true;
  }
  return false;
}
// a signal's mast arm: at most this long (m; the Region's run 9-17)
const MAST_MAX = 17;
// where a signal pole may stand, relative to its nominal kerb corner: i m
// further out to the right, j m along the road; cheapest first
const POLE_SEARCH = [];
for (let i = 0; i <= 16; i++) for (let j = -6; j <= 10; j++) POLE_SEARCH.push([i * 0.7, j * 0.7, i * 0.7 + Math.abs(j * 0.7) * (j < 0 ? 1.4 : 0.8)]);
POLE_SEARCH.sort((a, b) => a[2] - b[2]);
// a stop or yield sign's post: i m out to the right, j m back from its line
const SIGN_SEARCH = [];
for (let i = 0; i <= 10; i++) for (let j = -2; j <= 8; j++) SIGN_SEARCH.push([i * 0.6, j * 0.6, i * 0.6 + Math.abs(j * 0.6) * (j < 0 ? 2 : 0.7)]);
SIGN_SEARCH.sort((a, b) => a[2] - b[2]);

const flowOf = (e) => (e.oneway ? (e.onewayRev ? -1 : 1) : e.cls === 'ramp' ? 1 : 0);
/** May traffic arrive at node ni along edge e? */
function into(e, ni) {
  const f = flowOf(e);
  return f === 0 || (f === 1 ? e.b === ni : e.a === ni);
}
/** Unit direction of travel along e arriving at ni. */
function dirInto(e, ni) { return e.b === ni ? [e.dx, e.dz] : [-e.dx, -e.dz]; }
const akey = (ei, ni, e) => ei * 2 + (e.b === ni ? 1 : 0);

function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
  const ex = px - ax - dx * t, ez = pz - az - dz * t;
  return { d2: ex * ex + ez * ez, t };
}

// traffic.js's route layout (v.rt: RT_F numbers an entry; R_EI, R_SG, the
// lane line's start R_QX/R_QZ, direction R_UX/R_UZ and length R_LEN)
const RT_F = 23, R_EI = 0, R_SG = 1, R_QX = 4, R_QZ = 5, R_UX = 6, R_UZ = 7, R_LEN = 8;
const _rt = { d: 0, key: 0 };
/** How far along car o's planned route node ni is, and the approach key it
 *  arrives by, or null when its route does not reach ni. */
function routeTo(city, o, ni) {
  const rt = o.rt;
  let d = rt[R_LEN] - ((o.x - rt[R_QX]) * rt[R_UX] + (o.z - rt[R_QZ]) * rt[R_UZ]);
  for (let j = 0; j < o.rtN; j++) {
    const q = j * RT_F;
    if (j > 0) d += rt[q + R_LEN];
    const ei = rt[q + R_EI], e = city.edges[ei];
    if ((rt[q + R_SG] > 0 ? e.b : e.a) === ni) { _rt.d = d; _rt.key = ei * 2 + (rt[q + R_SG] > 0 ? 1 : 0); return _rt; }
    if (d > 140) return null;
  }
  return null;
}

/** One way into a controlled junction: edge ei arriving at node ni. Its stop
 *  line's setback (`back`) needs the junction's shape, so it is worked out
 *  the first time anything asks (a car, the paint): ~5k stops at boot. */
class Approach {
  constructor(jc, id, c, ei, ni, u, e) {
    this.jc = jc; this.id = id; this.c = c; this.ei = ei; this.ni = ni; this.ux = u[0]; this.uz = u[1];
    this.cls = e.cls; this.hw = e.hw; this.two = flowOf(e) === 0;
    this.kind = 'go'; this.grp = 0; this.left = false; this._b = -1;
  }
  get back() { if (this._b < 0) this._b = this.jc.setback(this.ni, this.ei); return this._b; }
  /** The stop line's spot `o` m short of it, and the way the road runs
   *  there (it can be up the approach's chain, past its last edge). */
  at(o) { return this.jc.lineAt(this.ni, this.ei, this.back - o); }
}
/** A stop's box reaches its farthest stop line: worked out when first asked. */
function lazyR(C) {
  let r = -1;
  Object.defineProperty(C, 'r', { get() { if (r < 0) { r = 0.5; for (const A of C.appr.values()) r = Math.max(r, A.back + 0.5); } return r; } });
}

export function prepJunctions(city, data) {
  if (!data) return null;
  const t0 = performance.now();
  const jc = new Junctions(city, data);
  city.jc = jc;
  jc.stats.ms = Math.round(performance.now() - t0);
  return jc;
}

export class Junctions {
  constructor(city, data) {
    this.city = city;
    this.t = 0;
    const N = city.nodes.length, E = city.edges;
    this.ctl = new Int32Array(N).fill(-1);
    this.list = [];
    this.ring = new Int16Array(E.length);     // ring id + 1 per edge (0: none)
    this.rings = [];
    this.byChunk = new Map();                 // chunk key -> things to draw
    this.stats = { sig: 0, sigNodes: 0, sigApproaches: 0, sigLeft: 0, stop: 0, allWay: 0, yieldNodes: 0, rb: 0, rbEntries: 0, mini: 0, xing: 0, unmatched: {} };
    this._appr = 0;
    this._bpA = new Float64Array(120); this._bpB = new Float64Array(120); this._bpP = { x: 0, z: 0 };   // leftClash's paths
    this.crossOn = new Map();                 // edge -> [{s (m from a), k}]
    const ms = this.stats.phaseMs = {};
    let t = performance.now();
    const lap = (k) => { const n = performance.now(); ms[k] = Math.round(n - t); t = n; };
    this.matchCrossings(data.xing || []); lap('xing');
    this.matchRings(data.rb || []); lap('rb');
    this.matchSignals(data.sig || []); lap('sig');
    this.matchStops(data.stop || []); lap('stop');
    this.matchMini(data.mini || []); lap('mini');
    this._chains = null;
    // the left-turn bays on signal approaches (arterial.js): before any
    // layout is asked for
    Object.assign(this.stats, markBays(city, this)); lap('bays');
  }

  ok(ni) {
    const n = this.city.nodes[ni];
    if (!n || n.e.length < 2) return false;
    for (const ei of n.e) { const e = this.city.edges[ei]; if (e.elev || e.tunnel || (e.prof && !e.app)) return false; }
    return true;
  }
  miss(k) { this.stats.unmatched[k] = (this.stats.unmatched[k] || 0) + 1; }
  bucket(x, z) {
    const k = this.city.chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    let b = this.byChunk.get(k);
    if (!b) this.byChunk.set(k, (b = { paint: [], furn: [], heads: [] }));
    return b;
  }

  /** Where crossing X lies along its edge: OSM's spot, moved out of the
   *  junction to just past its arm's mouth (OSM puts the crossing node a few
   *  metres from the junction's; the drawn junction often reaches further).
   *  Worked out when first asked: it needs the junction's shape. */
  xingS(X) {
    if (X.sc < 0) {
      const e = this.city.edges[X.ei];
      const lo = this.mouth(e.a, X.ei) + X.w / 2 + 0.3, hi = e.len - this.mouth(e.b, X.ei) - X.w / 2 - 0.3;
      X.sc = lo > hi ? X.s0 : clamp(X.s0, lo, hi);
    }
    return X.sc;
  }

  /** Does crossing X (centred at cx, cz) overlap the painted strip of a
   *  crossing on another edge that wins (the lower edge index)? */
  xingClash(X, cx, cz) {
    const city = this.city, e = city.edges[X.ei], R = e.hw + X.w;
    for (const oi of this.edgesAround(cx, cz, 14)) {
      if (oi >= X.ei || this.city.edges[oi].prof) continue;
      const l = this.crossOn.get(oi);
      if (!l) continue;
      const o = city.edges[oi], oa = city.nodes[o.a];
      for (const Y of l) {
        const s = this.xingS(Y), ox = oa.x + o.dx * s, oz = oa.z + o.dz * s;
        const dx = cx - ox, dz = cz - oz;
        if (dx * dx + dz * dz > (R + o.hw + Y.w) ** 2) continue;
        // the two strips as segments across their roads: do they come within
        // the widths of each other?
        const ax0 = cx + e.dz * e.hw, az0 = cz - e.dx * e.hw, ax1 = cx - e.dz * e.hw, az1 = cz + e.dx * e.hw;
        const bx0 = ox + o.dz * o.hw, bz0 = oz - o.dx * o.hw, bx1 = ox - o.dz * o.hw, bz1 = oz + o.dx * o.hw;
        const near = Math.min(
          segDist2(ax0, az0, bx0, bz0, bx1, bz1).d2, segDist2(ax1, az1, bx0, bz0, bx1, bz1).d2,
          segDist2(bx0, bz0, ax0, az0, ax1, az1).d2, segDist2(bx1, bz1, ax0, az0, ax1, az1).d2);
        const cross = ((ax1 - ax0) * (bz0 - az0) - (az1 - az0) * (bx0 - ax0)) * ((ax1 - ax0) * (bz1 - az0) - (az1 - az0) * (bx1 - ax0)) < 0
          && ((bx1 - bx0) * (az0 - bz0) - (bz1 - bz0) * (ax0 - bx0)) * ((bx1 - bx0) * (az1 - bz0) - (bz1 - bz0) * (ax1 - bx0)) < 0;
        // (at a corner two arms' crosswalks end near each other: not a clash
        // unless they cross, or run side by side over each other)
        if (cross || (near < ((X.w + Y.w) / 2) ** 2 && Math.abs(e.dx * o.dx + e.dz * o.dz) > 0.9)) return true;
      }
    }
    return false;
  }

  /** Edge ei's mouth (where its own carriageway starts) at node ni. */
  mouth(ni, ei) {
    const J = this.city.junction ? this.city.junction(ni) : null;
    if (J && J.arms) for (const A of J.arms) if (A.ei === ei) return A.m;
    return 0;
  }

  /**
   * The road an approach (edge ei into node ni) comes in along, upstream
   * from the node: [{ ei, ni (the node it runs into), d0 (m from the
   * junction's node to ni), len, ux, uz, hw, two }]. OSM splits a way a few
   * metres short of most junctions -- at a crosswalk node, where a lane or a
   * name changes, where a roundabout's entry leaves its splitter island --
   * and the graph keeps the split as a degree-2 node, so the approach's own
   * edge is often 6-15 m long: shorter than the distance from the node to
   * the crossing street's kerb. The stop line belongs on the APPROACH, not
   * on its last edge: this carries on through such nodes (not into another
   * control, a ring, a bridge or a hairpin) to 45 m.
   */
  chain(ni, ei) {
    const key = ei * 2 + (this.city.edges[ei].b === ni ? 1 : 0);
    if (!this._chains) this._chains = new Map();
    let ch = this._chains.get(key);
    if (ch) return ch;
    const city = this.city;
    ch = [];
    let at = ni, k = ei, d0 = 0;
    for (let g = 0; g < 12; g++) {
      const e = city.edges[k], u = dirInto(e, at);
      ch.push({ ei: k, ni: at, d0, len: e.len, ux: u[0], uz: u[1], hw: e.hw, two: flowOf(e) === 0 });
      d0 += e.len;
      if (d0 >= 45) break;
      const up = e.a === at ? e.b : e.a, un = city.nodes[up];
      if (un.e.length !== 2 || this.ctl[up] >= 0) break;
      const nk = un.e[0] === k ? un.e[1] : un.e[0], ne = city.edges[nk];
      if (nk === k || ne.elev || ne.tunnel || (ne.prof && !ne.app) || this.ring[nk] || !into(ne, up)) break;
      const nu = dirInto(ne, up);
      if (nu[0] * u[0] + nu[1] * u[1] < 0.5) break;
      at = up; k = nk;
    }
    this._chains.set(key, ch);
    return ch;
  }

  /** The node approach chain `ch` starts at (its far end). */
  chainStart(ch) { const q = ch[ch.length - 1], e = this.city.edges[q.ei]; return e.a === q.ni ? e.b : e.a; }

  /** How far up chain `ch` a stop line may stand: 3 m short of the junction
   *  it starts at, or 0.5 m short of anything else (a dead end, a bridge's
   *  end, a hairpin). */
  chainRoom(ch) {
    const q = ch[ch.length - 1];
    return Math.max(2.5, q.d0 + q.len - (this.city.nodes[this.chainStart(ch)].e.length >= 3 ? 3 : 0.5));
  }

  /** An approach that is no way in: its chain starts at another node of the
   *  same junction (the short link between a divided road's carriageways, a
   *  kink through a degree-2 node), or it is a dead-end stub that lies
   *  inside the crossing street's lanes wherever a stop line could go. */
  noApproach(ni, ei, set) {
    const ch = this.chain(ni, ei), st = this.chainStart(ch);
    if (set && set.has(st)) return true;
    return this.city.nodes[st].e.length === 1 && !this.barFits(ni, ei);
  }

  /** Is there a stop line for approach (ei into ni) that is not across
   *  another street's lanes, anywhere up its chain? */
  barFits(ni, ei) {
    const L = this.chainRoom(this.chain(ni, ei));
    for (let b = 2.5; b <= L; b += 0.5) if (!this.barAcross(ni, ei, b)) return true;
    return false;
  }

  /** The point `s` m back up approach (ei into ni) from the node, with the
   *  way it runs there: { x, z, ux, uz, hw, two, ei }. */
  lineAt(ni, ei, s) {
    const ch = this.chain(ni, ei);
    let q = ch[ch.length - 1];
    for (const c of ch) if (s < c.d0 + c.len) { q = c; break; }
    const n = this.city.nodes[q.ni], r = s - q.d0;
    return { x: n.x - q.ux * r, z: n.z - q.uz * r, ux: q.ux, uz: q.uz, hw: q.hw, two: q.two, ei: q.ei };
  }

  /** The stop line's setback from node ni along approach edge ei (m along
   *  the approach's chain, the same measure as a car's route distance). */
  setback(ni, ei) {
    const city = this.city, n = city.nodes[ni];
    let m = 0;
    const J = city.junction ? city.junction(ni) : null;
    if (J && J.arms) for (const A of J.arms) if (A.ei === ei) m = A.m;
    if (!m) for (const oi of n.e) if (oi !== ei) m = Math.max(m, city.edges[oi].hw);
    let back = m + 0.9;
    const ch = this.chain(ni, ei), L = this.chainRoom(ch);
    // the crosswalks on this approach: (distance from the node, width)
    const xw = [];
    for (const c of ch) {
      const xs = this.crossOn.get(c.ei);
      if (!xs) continue;
      const e = city.edges[c.ei];
      for (const X of xs) { const s = this.xingS(X); xw.push([c.d0 + (e.b === c.ni ? e.len - s : s), X.w, c.d0 > 0]); }
    }
    // the junction's own crosswalk: the bar stands behind it (unless the bar
    // there is across another street wherever it goes -- the next junction
    // is just past the crosswalk -- when it goes where it is clear). On the
    // approach's last edge, as before, within 14 m of the mouth; up the
    // chain only one at the mouth (a roundabout's splitter-island crossing
    // a car length back is not the entry's: its yield line stays at the ring)
    const plain = clamp(back, 2.5, L);
    for (const [d, w, up] of xw) if (d > m - 2 && d < m + (up ? 6 : 14)) back = Math.max(back, d + w / 2 + 1.0);
    back = clamp(back, 2.5, L);
    const b = this.stepClear(ni, ei, back, L, xw);
    if (back === plain || !this.barAcross(ni, ei, b)) return b;
    const b0 = this.stepClear(ni, ei, plain, L, null);
    return this.barAcross(ni, ei, b0) ? b : b0;
  }

  /** Step a stop line back from `back` (at most to L) until it is clear of
   *  other streets' lanes, and behind any crosswalk in `xw` it lands on. */
  stepClear(ni, ei, back, L, xw) {
    // NOT IN ANOTHER STREET'S LANES. Where the graph's node is not where the
    // carriageways meet -- the far carriageway of a divided road, a skewed
    // crossing, a slip lane beside the arm -- the mouth is short of the road
    // the arm crosses and the bar (and the line cars stop at) lay across that
    // road's lanes, in the middle of the intersection. Stepped back along
    // the approach until the bar's middle and both ends are clear (and
    // behind a crosswalk it would land on).
    for (let k = 0; k < 80 && back + 0.5 <= L && this.barAcross(ni, ei, back); k++) {
      back += 0.5;
      if (xw) for (const [d, w] of xw) if (Math.abs(back - d) < w / 2 + 1.0) back = d + w / 2 + 1.0;
    }
    return Math.min(back, L);
  }

  /** Does the bar of approach (ei into ni) at setback `back` lie across
   *  another street's lanes (its middle or either end of its span)? */
  barAcross(ni, ei, back) {
    const city = this.city, ch = this.chain(ni, ei);
    const P = this.lineAt(ni, ei, back - 0.25), ux = P.ux, uz = P.uz;
    const across = (x, z) => {
      for (const oi of this.edgesAround(x, z, 16)) {
        if (ch.some((c) => c.ei === oi)) continue;
        const o = city.edges[oi];
        if (o.elev || o.tunnel || Math.abs(o.dx * ux + o.dz * uz) > 0.7) continue;
        const a = city.nodes[o.a], t = (x - a.x) * o.dx + (z - a.z) * o.dz;
        if (t < 1 || t > o.len - 1) continue;
        if (Math.abs((x - a.x) * -o.dz + (z - a.z) * o.dx) < o.hw - 0.3) return true;
      }
      return false;
    };
    // (a two-way arm's bar spans its own half: Painter.stopBar's o0..o1)
    const lo = P.two ? 0.15 : -(P.hw - 0.3), hi = P.hw - 0.3;
    for (const o of [lo, (lo + hi) / 2, hi]) if (across(P.x - uz * o, P.z + ux * o)) return true;
    return false;
  }

  approach(C, ei, ni) {
    const e = this.city.edges[ei], u = dirInto(e, ni);
    return new Approach(this, this._appr++, C.id, ei, ni, u, e);
  }

  /** Edges whose segment passes within `r` of (x, z): a 32 m grid of this
   *  module's own (city.edgesNear lists whole 400 m chunks, and the prep's
   *  ~12k lookups through it were most of its boot time). */
  edgesAround(x, z, r) {
    const city = this.city, S = 32;
    if (!this._eg) {
      const g = this._eg = new Map();
      for (let ei = 0; ei < city.edges.length; ei++) {
        const e = city.edges[ei];
        if (e.elev || e.tunnel) continue;   // (graded ones too: callers skip e.prof themselves)
        const a = city.nodes[e.a], b = city.nodes[e.b];
        const x0 = Math.floor(Math.min(a.x, b.x) / S), x1 = Math.floor(Math.max(a.x, b.x) / S);
        const z0 = Math.floor(Math.min(a.z, b.z) / S), z1 = Math.floor(Math.max(a.z, b.z) / S);
        for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
          const k = cx * 100003 + cz;
          let l = g.get(k);
          if (!l) g.set(k, (l = []));
          l.push(ei);
        }
      }
    }
    const out = new Set();
    for (let cx = Math.floor((x - r) / S); cx <= Math.floor((x + r) / S); cx++) {
      for (let cz = Math.floor((z - r) / S); cz <= Math.floor((z + r) / S); cz++) {
        const l = this._eg.get(cx * 100003 + cz);
        if (l) for (const ei of l) out.add(ei);
      }
    }
    return out;
  }

  add(C) {
    C.id = this.list.length;
    this.list.push(C);
    for (const ni of C.nodes) this.ctl[ni] = C.id;
    C.appr = new Map();
    C.q = [];
    return C;
  }

  // --- crossings -------------------------------------------------------------
  matchCrossings(xs) {
    const city = this.city;
    for (const X of xs) {
      const [x, z, dx, dz, fl] = X;
      let best = -1, bd = Infinity, bt = 0;
      for (const ei of this.edgesAround(x, z, 14)) {
        const e = city.edges[ei];
        if (e.elev || e.tunnel || (e.prof && !e.app) || e.cls === 'hwy') continue;
        // the road it crosses runs the way OSM's way does there (near a
        // junction the cross street's edge can be nearer)
        if ((dx || dz) && Math.abs(e.dx * dx + e.dz * dz) < 0.8) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        const r = segDist2(x, z, a.x, a.z, b.x, b.z);
        if (r.d2 < bd) { bd = r.d2; best = ei; bt = r.t; }
      }
      if (best < 0) { this.miss('xing'); continue; }
      const e = city.edges[best];
      if (bd > (e.hw + 1) * (e.hw + 1) || e.hw < 2.5) { this.miss('xing'); continue; }
      const s = bt * e.len;
      const w = fl & 1 ? 3.0 : 2.8;
      if (s < 1 || s > e.len - 1) { this.miss('xing'); continue; }
      let l = this.crossOn.get(best);
      if (!l) this.crossOn.set(best, (l = []));
      if (l.some((o) => Math.abs(o.s0 - s) < 3)) continue;
      const rec = { ei: best, s0: s, sc: -1, w, ladder: !!(fl & 1), feet: !!(fl & 2), sig: !!(fl & 4) };
      l.push(rec);
      const a = city.nodes[e.a];
      this.bucket(a.x + e.dx * s, a.z + e.dz * s).paint.push({ t: 'xing', X: rec });
      this.stats.xing++;
    }
  }

  // --- roundabouts -----------------------------------------------------------
  matchRings(rbs) {
    const city = this.city;
    for (const R of rbs) {
      const P = R.p;
      const near = (x, z) => {
        let b = Infinity;
        for (let i = 0; i < P.length; i++) {
          const p = P[i], q = P[(i + 1) % P.length];
          const r = segDist2(x, z, p[0], p[1], q[0], q[1]);
          if (r.d2 < b) b = r.d2;
        }
        return Math.sqrt(b);
      };
      const id = this.rings.length + 1;
      const edges = [];
      for (const ei of this.edgesAround(R.x, R.z, R.r + 6)) {
        const e = city.edges[ei];
        if (this.ring[ei] || e.elev || e.tunnel || (e.prof && !e.app) || !e.oneway) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        // (the graph's edges are chords of the circle: the middle of a long
        // one is metres inside it, never across the island)
        if (near(a.x, a.z) > 3.5 || near(b.x, b.z) > 3.5 || Math.hypot((a.x + b.x) / 2 - R.x, (a.z + b.z) / 2 - R.z) < R.r * 0.55) continue;
        edges.push(ei);
      }
      if (edges.length < 3) { this.miss('rb'); continue; }
      // the circulation: each ring node's next, by the edges' one-way flow
      const next = new Map(), eOf = new Map();
      for (const ei of edges) {
        const e = city.edges[ei], f = flowOf(e);
        const from = f === 1 ? e.a : e.b, to = f === 1 ? e.b : e.a;
        next.set(from, to); eOf.set(from, ei);
      }
      const start = city.edges[edges[0]].a;
      const nodes = [], s = new Map();
      let cur = start, acc = 0, closed = false;
      for (let g = 0; g < 400; g++) {
        if (s.has(cur)) { closed = cur === start; break; }
        s.set(cur, acc); nodes.push(cur);
        let nx = next.get(cur);
        if (nx === undefined) {
          // a break in the graph's ring (the importer can drop a few metres
          // between two pieces): carry on from the nearest piece's start
          const p = city.nodes[cur];
          let bd = 8;
          for (const k of next.keys()) {
            if (s.has(k) && k !== start) continue;
            const q = city.nodes[k], d = Math.hypot(q.x - p.x, q.z - p.z);
            if (d < bd) { bd = d; nx = k; }
          }
          if (nx === undefined) break;
          acc += bd;
          this.stats.ringGaps = (this.stats.ringGaps || 0) + 1;
          cur = nx;
          continue;
        }
        acc += city.edges[eOf.get(cur)].len;
        cur = nx;
      }
      if (!closed) { this.miss('rbOpen'); continue; }
      let cx = 0, cz = 0, hw = 0;
      for (const ni of nodes) { cx += city.nodes[ni].x; cz += city.nodes[ni].z; }
      cx /= nodes.length; cz /= nodes.length;
      let r = 0;
      for (const ni of nodes) r += Math.hypot(city.nodes[ni].x - cx, city.nodes[ni].z - cz);
      r /= nodes.length;
      for (const ei of edges) { this.ring[ei] = id; hw += city.edges[ei].hw; }
      hw /= edges.length;
      const ring = { id, nodes, s, L: acc, x: cx, z: cz, r, hw, ln: R.ln || 1, cls: R.cls, edges, entries: [] };
      this.rings.push(ring);
      this.stats.rb++;
      // the entries: ring nodes with an approach from off the ring
      for (const ni of nodes) {
        if (this.ctl[ni] >= 0) continue;
        const n = city.nodes[ni];
        const ins = n.e.filter((ei) => !this.ring[ei] && into(city.edges[ei], ni) && !city.edges[ei].elev);
        if (!ins.length) continue;
        const C = this.add({ k: K_RB, nodes: [ni], x: n.x, z: n.z, ring, r: hw + 2 });
        for (const ei of ins) {
          const A = this.approach(C, ei, ni);
          A.kind = 'yield';
          C.appr.set(akey(ei, ni, city.edges[ei]), A);
          ring.entries.push(A);
          this.stats.rbEntries++;
        }
      }
      this.bucket(cx, cz).furn.push({ t: 'island', ring });
      this.bucket(cx, cz).paint.push({ t: 'ringLanes', ring });
      for (const A of ring.entries) this.bucket(city.nodes[A.ni].x, city.nodes[A.ni].z).paint.push({ t: 'teeth', A });
    }
  }

  // --- signals ---------------------------------------------------------------
  matchSignals(sigs) {
    const city = this.city;
    for (const S of sigs) {
      const set = new Set();
      for (const [x, z] of S.p) {
        let ni = city.nearestNode(x, z, 12);
        if (ni < 0 || !this.ok(ni)) continue;
        // a signal node short of the junction: the junction it stands at
        if (city.nodes[ni].e.length < 3) {
          let best = -1, bd = 32;
          for (const ei of city.nodes[ni].e) {
            let at = ni, prev = ei, run = 0;
            for (let g = 0; g < 6; g++) {
              const e = city.edges[prev], o = e.a === at ? e.b : e.a;
              run += e.len;
              if (run > bd) break;
              if (city.nodes[o].e.length >= 3) { if (this.ok(o)) { bd = run; best = o; } break; }
              const n2 = city.nodes[o].e.find((k) => k !== prev);
              if (n2 === undefined) break;
              at = o; prev = n2;
            }
          }
          if (best >= 0) ni = best;
        }
        if (this.ctl[ni] < 0) set.add(ni);
      }
      if (!set.size) { this.miss('sig'); continue; }
      // AN APPROACH STARTS OUTSIDE THE INTERSECTION. Where OSM's signal nodes
      // sit on one carriageway of a divided road (or one corner of a wide,
      // skewed crossing), the next junction along an arm is inside the same
      // intersection: no stop line fits on the edge between them, it lies
      // across the crossing street's lanes wherever it goes. That junction
      // belongs to this signal (its edges in between are the box's own), so
      // the approaches start where the roads really come in.
      for (let pass = 0; pass < 3; pass++) {
        let grew = false;
        for (const ni of [...set]) {
          for (const ei of city.nodes[ni].e) {
            const e = city.edges[ei], o = e.a === ni ? e.b : e.a;
            if (set.has(o) || !into(e, ni) || e.elev || e.tunnel || e.len > 30) continue;
            if (city.nodes[o].e.length < 3 || this.ctl[o] >= 0 || !this.ok(o)) continue;
            if (this.barFits(ni, ei)) continue;
            set.add(o); grew = true;
            this.stats.sigAbsorbed = (this.stats.sigAbsorbed || 0) + 1;
          }
        }
        if (!grew) break;
      }
      const nodes = [...set];
      let cx = 0, cz = 0;
      for (const ni of nodes) { cx += city.nodes[ni].x; cz += city.nodes[ni].z; }
      cx /= nodes.length; cz /= nodes.length;
      const C = this.add({ k: K_SIG, nodes, x: cx, z: cz, set });
      const list = [];
      for (const ni of nodes) {
        for (const ei of city.nodes[ni].e) {
          const e = city.edges[ei], o = e.a === ni ? e.b : e.a;
          if (set.has(o) || !into(e, ni) || e.elev || e.tunnel || this.noApproach(ni, ei, set)) continue;
          const A = this.approach(C, ei, ni);
          C.appr.set(akey(ei, ni, e), A);
          list.push(A);
        }
      }
      if (!list.length) { this.list.pop(); for (const ni of nodes) this.ctl[ni] = -1; this.miss('sigNoApproach'); continue; }
      // the phase groups: along the top-ranked approach's axis, and across it
      let ref = list[0];
      for (const A of list) if ((RANK[A.cls] || 0) * 100 + A.hw > (RANK[ref.cls] || 0) * 100 + ref.hw) ref = A;
      C.refU = [ref.ux, ref.uz];
      for (const A of list) {
        A.grp = Math.abs(A.ux * ref.ux + A.uz * ref.uz) > 0.6 ? 0 : 1;
        A.kind = 'sig';
        A.left = S.L.some((l) => l[0] * A.ux + l[1] * A.uz > 0.85);
        if (A.left) this.stats.sigLeft++;
      }
      C.approaches = list;
      // the box: how far out the junction reaches from its centre (asked for
      // when first needed: the stop lines need the junctions' shapes)
      {
        let r = -1;
        Object.defineProperty(C, 'r', { get() {
          if (r < 0) { r = 0; for (const A of list) { const n = city.nodes[A.ni]; r = Math.max(r, Math.hypot(n.x - cx, n.z - cz) + A.back); } }
          return r;
        } });
      }
      // its hardware and paint are planned when its chunk is first built
      // or its heads first drawn (rigs())
      this.bucket(cx, cz).heads.push(C);
      this.planCycle(C);
      this.stats.sig++; this.stats.sigNodes += nodes.length; this.stats.sigApproaches += list.length;
    }
  }

  planCycle(C) {
    const ph = [];
    const grps = [0, 1].filter((g) => C.approaches.some((A) => A.grp === g));
    for (const g of grps) {
      const as = C.approaches.filter((A) => A.grp === g);
      let top = 'res', spd = 0;
      for (const A of as) {
        if ((RANK[A.cls] || 0) > (RANK[top] || 0)) top = A.cls;
        spd = Math.max(spd, this.city.edges[A.ei].spd || 12);
      }
      if (as.some((A) => A.left)) ph.push({ g, k: 'adv', d: T_ADV }, { g, k: 'clr', d: T_CLR });
      const amb = spd > 16.5 ? 4.2 : spd > 13.5 ? 3.7 : 3.0;
      ph.push({ g, k: 'grn', d: GREEN[top] || 16 }, { g, k: 'amb', d: amb }, { g, k: 'red', d: T_RED });
    }
    // a single group (a mid-block crossing, a T whose stem OSM omits): a
    // pedestrian phase stands in for the cross street
    if (grps.length === 1) ph.push({ g: -1, k: 'ped', d: 12 });
    let t = 0;
    for (const p of ph) { p.t0 = t; t += p.d; }
    C.phases = ph;
    C.cycle = t;
    C.off = hash2(Math.round(C.x), Math.round(C.z)) * t;
  }

  /** The phase signal C shows now: { p (the phase), rem (s left in it) }. */
  phase(C) {
    const tt = (this.t + C.off) % C.cycle;
    for (const p of C.phases) if (tt < p.t0 + p.d) return { p, rem: p.t0 + p.d - tt, el: tt - p.t0 };
    const p = C.phases[C.phases.length - 1];
    return { p, rem: 0, el: p.d };
  }

  /**
   * The pedestrian signal for walking along phase group `pg`'s axis:
   * 'walk' (the walking person: the group's green, its first 55 %), 'flash'
   * (the flashing hand: the rest of that green -- don't start) or 'hand'. In a
   * one-group signal's pedestrian phase the walk is across the road (the
   * other axis).
   */
  walkState(C, pg) {
    const { p, el } = this.phase(C);
    let g = -2;
    if (p.k === 'grn') g = p.g;
    else if (p.k === 'ped') g = 1 - C.phases[0].g;
    if (g !== pg) return 'hand';
    return el < p.d * 0.55 ? 'walk' : 'flash';
  }

  /** The phase group a walker going (wx, wz) across signal C walks with. */
  walkGroup(C, wx, wz) {
    const u = C.refU || [1, 0], L = Math.hypot(wx, wz) || 1;
    return Math.abs(u[0] * wx + u[1] * wz) / L > 0.707 ? 0 : 1;
  }

  /**
   * What approach A of signal C shows a driver making `move` ('L', 'S',
   * 'R'): { s: 'G' | 'Y' | 'R', prot (a protected left), rem }.
   */
  light(C, A, move) {
    const { p, rem } = this.phase(C);
    if (p.g !== A.grp) return { s: 'R', rem: 0, prot: false };
    if (p.k === 'adv') return move === 'L' && A.left ? { s: 'G', rem, prot: true } : { s: 'R', rem: 0, prot: false };
    if (p.k === 'clr' || p.k === 'red') return { s: 'R', rem: 0, prot: false };
    if (p.k === 'amb') return { s: 'Y', rem, prot: false };
    return { s: 'G', rem, prot: false };
  }

  // --- stops -------------------------------------------------------------------
  matchStops(stops) {
    const city = this.city;
    for (const S of stops) {
      const [x, z, jx, jz, ax, az, fl] = S;
      const ni = city.nearestNode(jx, jz, 8);
      if (ni < 0 || !this.ok(ni) || city.nodes[ni].e.length < 3) { this.miss('stop'); continue; }
      let C = this.ctl[ni] >= 0 ? this.list[this.ctl[ni]] : null;
      if (C && C.k !== K_STOP) continue;   // a signal or a roundabout governs it
      const n = city.nodes[ni];
      let ei = -1;
      if (ax || az) {
        let bd = 0.6;
        for (const k of n.e) {
          const e = city.edges[k];
          if (!into(e, ni)) continue;
          const u = dirInto(e, ni), d = u[0] * ax + u[1] * az;
          if (d > bd) { bd = d; ei = k; }
        }
      } else if (!(fl & 1)) {
        // on the junction node, no direction: the approach nearest the sign
        let bd = Infinity;
        for (const k of n.e) {
          const e = city.edges[k];
          if (!into(e, ni)) continue;
          const o = city.nodes[e.a === ni ? e.b : e.a];
          const d = Math.hypot(o.x - x, o.z - z);
          if (d < bd) { bd = d; ei = k; }
        }
        if (Math.hypot(n.x - x, n.z - z) < 2) ei = -1;
      }
      if (!C) C = this.add({ k: K_STOP, nodes: [ni], x: n.x, z: n.z, all: false });
      if (fl & 1) C.all = true;
      if (ei < 0) continue;
      const e = city.edges[ei];
      const key = akey(ei, ni, e);
      if (C.appr.has(key) || this.noApproach(ni, ei, null)) continue;
      const A = this.approach(C, ei, ni);
      A.kind = fl & 2 ? 'yield' : 'stop';
      C.appr.set(key, A);
    }
    // all-way where every approach is signed; the box's reach
    for (const C of this.list) {
      if (C.k !== K_STOP) continue;
      const ni = C.nodes[0], n = city.nodes[ni];
      const ins = n.e.filter((k) => into(city.edges[k], ni) && !this.noApproach(ni, k, null));
      if (C.all || ins.every((k) => C.appr.has(akey(k, ni, city.edges[k])))) {
        C.all = true;
        for (const k of ins) {
          const key = akey(k, ni, city.edges[k]);
          if (!C.appr.has(key)) { const A = this.approach(C, k, ni); A.kind = 'stop'; C.appr.set(key, A); }
          else C.appr.get(key).kind = 'stop';
        }
      }
      if (!C.appr.size) { this.ctl[ni] = -1; C.dead = true; continue; }
      // (its reach, from the stop lines: asked for when a car first needs it)
      lazyR(C);
      if (C.all) this.stats.allWay++;
      else if ([...C.appr.values()].every((A) => A.kind === 'yield')) this.stats.yieldNodes++;
      else this.stats.stop++;
      for (const A of C.appr.values()) {
        const p = city.nodes[A.ni];
        this.bucket(p.x, p.z).paint.push({ t: A.kind === 'stop' ? 'bar' : 'teeth', A });
        this.bucket(p.x, p.z).furn.push({ t: 'sign', A, all: C.all });
      }
    }
  }

  matchMini(minis) {
    const city = this.city;
    for (const M of minis) {
      const ni = city.nearestNode(M.x, M.z, 6);
      if (ni < 0 || !this.ok(ni) || city.nodes[ni].e.length < 3 || this.ctl[ni] >= 0) { this.miss('mini'); continue; }
      const n = city.nodes[ni];
      const C = this.add({ k: K_MINI, nodes: [ni], x: n.x, z: n.z, all: true });
      lazyR(C);
      for (const ei of n.e) {
        const e = city.edges[ei];
        if (!into(e, ni)) continue;
        const A = this.approach(C, ei, ni);
        A.kind = 'yield';
        C.appr.set(akey(ei, ni, e), A);

        this.bucket(n.x, n.z).paint.push({ t: 'teeth', A });
        this.bucket(n.x, n.z).furn.push({ t: 'sign', A, all: false });
      }
      this.bucket(n.x, n.z).paint.push({ t: 'mini', x: n.x, z: n.z });
      this.stats.mini++;
    }
  }

  // --- where the signal hardware stands -------------------------------------
  /**
   * Per signal approach: a pole on the FAR RIGHT corner (as the approaching
   * driver sees it), a mast arm back over its lanes with a head over each
   * lane (and a left-turn head over the left lane where it has an advance
   * arrow), a head on the pole, and pedestrian heads for the two crosswalks
   * that meet at that corner.
   */
  rigs(C) {
    if (C.rigs) return C.rigs;
    const city = this.city;
    C.rigs = [];
    {
      for (const A of C.approaches) {
        const n = city.nodes[A.ni], ux = A.ux, uz = A.uz, rx = -uz, rz = ux;
        // how far past the approach's node the junction reaches, along u
        let far = 0, cross = 0;
        for (const ni of C.nodes) {
          const m = city.nodes[ni];
          far = Math.max(far, (m.x - n.x) * ux + (m.z - n.z) * uz);
          for (const ei of m.e) {
            const e = city.edges[ei];
            if (Math.abs(e.dx * ux + e.dz * uz) < 0.6) cross = Math.max(cross, e.hw);
          }
        }
        const df0 = far + Math.max(cross, 4) + 2.2, lat0 = A.hw + 1.7;
        // the kerb corner: the nearest spot off every carriageway (and out of
        // any building) to the nominal one, searched out to the right and
        // along the road either way. It used to step diagonally six times and
        // give up IN the road (95 of 1701 poles: the far carriageway of a
        // divided road, a slip lane), the arm reaching over from a pole that
        // stood in the traffic or behind it.
        let px = n.x + ux * df0 + rx * lat0, pz = n.z + uz * df0 + rz * lat0, best = Infinity;
        for (const [i, j, cost] of POLE_SEARCH) {
          if (cost >= best) break;
          const qx = n.x + ux * (df0 + j) + rx * (lat0 + i), qz = n.z + uz * (df0 + j) + rz * (lat0 + i);
          if (city.onRoad(qx, qz, 0.5, false, false) || city.insideBuilding(qx, qz, G.terrainHeight(qx, qz) + 1, 0.4)) continue;
          best = cost; px = qx; pz = qz;
        }
        const lat = (px - n.x) * rx + (pz - n.z) * rz;
        const gy = G.terrainHeight(px, pz) + Math.max(0, city.roadLift(px, pz));
        // lane centres to hang heads over, measured right of the centreline
        const offs = A.two
          ? (A.hw >= 6.5 ? [A.hw * 0.28, A.hw * 0.72] : [A.hw * 0.5])
          : (A.hw >= 5 ? [-A.hw * 0.45, A.hw * 0.45] : [0]);
        let leftOff = A.left ? (A.two ? Math.max(0.6, A.hw * 0.1) : -A.hw * 0.72) : null;
        // (over its left-turn bay, where it has one: arterial.js markBays)
        if (A.left && A.two) {
          const ae = city.edges[A.ei], sg = ae.b === A.ni ? 1 : -1, T = (sg > 0 ? ae.bayP : ae.bayM) ? twoWayLayout(ae) : null;
          if (T) leftOff = twoWayLaneOff(T, sg, -1);
        }
        const minOff = Math.min(...offs, leftOff === null ? Infinity : leftOff);
        const mast = clamp(lat - minOff + 0.7, 3, MAST_MAX);
        const rig = { A, C, x: px, z: pz, y: gy, ux, uz, rx, rz, mast, heads: [] };
        const H = 5.55;   // head centre on the arm
        const four = A.left;   // Ontario's advance: a fourth section, the arrow
        // (a head past the arm's end would hang from nothing: those lanes
        // make do with the pole's head and the far side's)
        const reach = (d) => d <= mast - 0.3;
        for (const o of offs) {
          const d = lat - o;
          if (reach(d)) rig.heads.push({ x: px - rx * d, z: pz - rz * d, y: gy + H, kind: four ? 4 : 3, fx: -ux, fz: -uz });
        }
        if (leftOff !== null && !offs.some((o) => Math.abs(o - leftOff) < 1.6) && reach(lat - leftOff)) {
          const d = lat - leftOff;
          rig.heads.push({ x: px - rx * d, z: pz - rz * d, y: gy + H, kind: 4, fx: -ux, fz: -uz });
        }
        // the pole's own head, beside it at 3.4 m
        rig.heads.push({ x: px - rx * 0.42, z: pz - rz * 0.42, y: gy + 3.6, kind: four ? 4 : 3, fx: -ux, fz: -uz });
        // pedestrian heads: walking along u (parallel to this approach), and
        // across it (parallel to the cross street)
        // (beside the pole, not behind it, as each walker sees it)
        rig.heads.push({ x: px + rx * 0.4, z: pz + rz * 0.4, y: gy + 2.75, kind: 6, fx: -ux, fz: -uz, pg: A.grp });
        rig.heads.push({ x: px + ux * 0.4, z: pz + uz * 0.4, y: gy + 2.75, kind: 6, fx: -rx, fz: -rz, pg: 1 - A.grp });
        for (const h of rig.heads) h.rig = rig;
        C.rigs.push(rig);
      }
    }
    return C.rigs;
  }

  // --- the clock ---------------------------------------------------------------
  update(dt) { this.t += dt; }

  // --- the drivers' rules (called by traffic.js driveTraffic) -------------------
  /**
   * May car v, `gap` metres (its nose) short of approach A's stop line,
   * making `move`, go on? Returns 0 go, 1 stop at the line. `T` is the
   * TrafficSystem (its cars and stats), `player` the player.
   */
  decide(T, v, C, A, move, gap, sp, player) {
    v.jcC = C.id; v.jcMv = move;
    if (C.k === K_SIG) {
      const L = this.light(C, A, move);
      if (L.s === 'R') {
        // Ontario: a right turn on red after a full stop, yielding to the
        // traffic that has the green and to anyone on foot (HTA s.144(19))
        if (move === 'R' && !A.noRtor) {
          if (v.jcRtor !== A.id) {
            if (gap < 2.2 && sp < 0.35) { v.jcRtor = A.id; v.jcArr = this.t; }
          } else if (this.t - v.jcArr > 1.2 && !this.rtorBusy(T, v, C, A, player)) { T.stats.rtor = (T.stats.rtor || 0) + 1; return 2; }
        }
        T.stats.sigHolds += 1 / 60; return 1;
      }
      // A LEFT never goes while another left of the same green -- the
      // opposing one, protected or not -- would meet it in the box
      // (leftClash). Held where it is (3), even a little over its line: a
      // left told to wait after it rolled over the line used to be "too late:
      // through" and committed anyway, and two opposing lefts at signal 849,
      // a skewed crossing, both went.
      const clash = move === 'L' && this.leftClash(T, v, C, A);
      if (L.s === 'Y' || (L.prot && L.rem < 2.5)) {
        // amber (or the arrow about to end): stop if it can be done gently
        const tReach = gap / Math.max(sp, 1);
        if (L.prot && tReach + 1.2 < L.rem && !clash) return 0;
        if (gap > (sp * sp) / (2 * AMBER_B) + 0.5 || (L.prot && sp < 2)) return 1;
        // (a left that has crept to its line goes on the amber -- once the
        // way is clear: the oncoming car that cannot stop for it comes on)
        if (move === 'L' && sp < 4 && (clash || (!L.prot && this.oncoming(T, v, C, A, player)))) { T.stats.leftYields += 1 / 60; return 3; }
        return 2;   // go, committed
      }
      if (clash) { T.stats.leftYields += 1 / 60; T.stats.leftClash = (T.stats.leftClash || 0) + 1 / 60; return 3; }
      // a permissive left yields to oncoming traffic
      if (move === 'L' && !L.prot && this.oncoming(T, v, C, A, player)) { T.stats.leftYields += 1 / 60; return 3; }
      return 0;
    }
    if (C.k === K_RB) {
      if (this.ringBusy(T, v, C, A, player)) { T.stats.rbYields += 1 / 60; return 1; }
      return 0;
    }
    // STOP / MINI / yield signs
    const roll = C.k === K_MINI || A.kind === 'yield';
    if (v.jcStop !== A.id) {
      if (!roll) {
        if (gap < 2.2 && sp < 0.35) { v.jcStop = A.id; v.jcArr = this.t; T.stats.fullStops++; }
        else return 1;
      } else if (gap < 6 && sp < 4) { v.jcStop = A.id; v.jcArr = this.t; }
      else if (gap > 6) return 0;   // a yield: rolling up to it
    }
    if (!C.q.includes(v)) C.q.push(v);
    if (C.all) {
      // first come, first served: anyone who stopped before me and is still
      // waiting (and not for ever) goes first; and the box must be clear
      for (let i = C.q.length - 1; i >= 0; i--) {
        const o = C.q[i];
        if (o === v) continue;
        if (!T.cars.includes(o) || o.jcC !== C.id || !(o.jcStop >= 0) || o.jcGo === o.jcStop || this.t - o.jcArr > 25) { C.q.splice(i, 1); continue; }
        if (o.jcArr < v.jcArr - 0.05 || (Math.abs(o.jcArr - v.jcArr) <= 0.05 && o.prio < v.prio)) {
          if (this.t - o.jcArr < 9) { T.stats.stopWaits += 1 / 60; return 1; }
        }
      }
      if (this.boxBusy(T, v, C, player)) return 1;
    } else if (this.majorBusy(T, v, C, A, player)) { T.stats.stopWaits += 1 / 60; return 1; }
    const k = C.q.indexOf(v);
    if (k >= 0) C.q.splice(k, 1);
    return 2;
  }

  /** The cars a rule looks at: traffic, police, a free car, and yours. */
  *others(T, v, player) {
    for (const o of T.cars) {
      if (o === v || o.mode === 'parked' || o.mode === 'apron' || o.mode === 'trailer') continue;
      if (Math.abs(o.y - v.y) > 3) continue;
      yield o;
    }
    const pv = player && player.vehicle;
    if (pv && pv !== v && !T.cars.includes(pv) && Math.abs(pv.y - v.y) < 3) yield pv;
  }

  /** Anyone moving inside C's box (or standing in it, for a while)? */
  boxBusy(T, v, C, player) {
    const r = C.r + 0.5;
    for (const o of this.others(T, v, player)) {
      const dx = o.x - C.x, dz = o.z - C.z;
      if (dx * dx + dz * dz > r * r) continue;
      // one still short of its own line is waiting, not in the box
      if (o.jcC === C.id && o.ctlHold) continue;
      if (Math.abs(o.vLong) > 0.3 || (o.jcGo >= 0 && o.jcC === C.id)) return true;
    }
    return false;
  }

  /** At a two-way stop or a yield: a car with the right of way coming, or one in the box. */
  majorBusy(T, v, C, A, player) {
    const city = this.city, ni = C.nodes[0], n = city.nodes[ni];
    if (this.boxBusy(T, v, C, player)) return true;
    for (const o of this.others(T, v, player)) {
      const dx = n.x - o.x, dz = n.z - o.z, D = Math.hypot(dx, dz);
      if (D > 110 || D < 0.1) continue;
      const sp = Math.abs(o.vLong);
      // (one standing on the major road right by the junction -- queued behind
      // a turning car, giving way to someone on foot -- pulls away the moment
      // it can: a side-street car that went because it read 0 m/s was T-boned
      // by it at 4-8 m/s)
      if (sp < 0.8 && !(o.rt && o.rtN && D < C.r + 14 && !o.ctlHold)) continue;
      // coming through this junction: on its planned route (a driven car:
      // by its heading, and passing within a few metres of the node)
      let Dr = D, B = null;
      if (o.rt && o.rtN) {
        const r = routeTo(city, o, ni);
        if (!r) continue;
        Dr = r.d; B = C.appr.get(r.key);
      } else {
        const f = o.forward;
        if ((f.x * dx + f.z * dz) / D < 0.7 || Math.abs(f.x * dz - f.z * dx) > 8) continue;
      }
      // on a signed approach of this junction it waits too; mine is behind me
      if (B && (B === A || B.kind !== 'go')) continue;
      if (sp < 0.8 ? Dr - C.r < 12 : (Dr - C.r * 0.5) / sp < GAP_T) return true;
    }
    return false;
  }

  /**
   * A right turn on red: anything moving in the box, anyone on foot crossing
   * near it, or a car on an approach that has a light (green, amber, an
   * advance arrow) that will reach the junction within the gap -- or is
   * standing at its line, about to go.
   */
  rtorBusy(T, v, C, A, player) {
    if (this.boxBusy(T, v, C, player)) return true;
    const city = this.city, { p } = this.phase(C);
    const live = p.k === 'grn' || p.k === 'amb' || p.k === 'adv';
    const R2 = (C.r + 9) ** 2;
    for (let q = 0; q < (T.crossN || 0); q++) {
      const x = T.crossXZ[q * 3], z = T.crossXZ[q * 3 + 1];
      if ((x - C.x) ** 2 + (z - C.z) ** 2 < R2) return true;
    }
    if (!live) return false;
    for (const o of this.others(T, v, player)) {
      const dx = C.x - o.x, dz = C.z - o.z, D = Math.hypot(dx, dz);
      if (D > 120) continue;
      const sp = Math.abs(o.vLong);
      let B = null, Dr = D;
      if (o.rt && o.rtN) {
        for (const ni of C.nodes) {
          const r = routeTo(city, o, ni);
          if (r && C.appr.get(r.key)) { B = C.appr.get(r.key); Dr = r.d; break; }
        }
        if (!B) continue;
      } else {
        // a driven car: heading at the junction
        const f = o.forward;
        if (sp < 1 || (f.x * dx + f.z * dz) / Math.max(D, 0.1) < 0.7) continue;
        if ((D - C.r) / sp < GAP_T) return true;
        continue;
      }
      if (B === A || B.grp !== p.g) continue;
      const toLine = Dr - B.back;
      if (sp < 0.8 ? toLine < 12 : (toLine - 2) / sp < GAP_T) return true;
    }
    return false;
  }

  /** A permissive left: oncoming traffic within the gap, not itself turning left. */
  oncoming(T, v, C, A, player) {
    const city = this.city;
    for (const o of this.others(T, v, player)) {
      const f = o.forward;
      if (f.x * A.ux + f.z * A.uz > -0.5) continue;
      const sp = Math.abs(o.vLong);
      const dx = C.x - o.x, dz = C.z - o.z, D = Math.hypot(dx, dz);
      if (D > 110) continue;
      // in the box, moving: wait for it
      if (D < C.r * 0.7 && sp > 0.5 && !(o.jcC === C.id && o.jcMv === 'L')) return true;
      if (sp < 1 || !o.rt || !o.rtN) continue;
      // coming through it from the opposite approach, not turning left itself
      for (const ni of C.nodes) {
        const r = routeTo(city, o, ni);
        if (!r) continue;
        const B = C.appr.get(r.key);
        if (B && B.ux * A.ux + B.uz * A.uz < -0.6 && !(o.jcC === C.id && o.jcMv === 'L') && (r.d - B.back) / sp < 5) return true;
      }
    }
    return false;
  }


  /**
   * LEFTS THAT WOULD MEET: is there another left turner of the same green
   * (any approach of A's phase group but A -- the opposing one, skewed or
   * not) whose way through the box comes within a car's width of v's? It
   * holds v if it has committed and is still in the box (its way out must
   * stay clear), or if it is older and at its line on a light that lets it
   * turn (one at a time, the older first: two that judged each other the
   * same frame both went). Ways are traffic's own planned paths
   * (TrafficSystem.pathAhead) sampled through the box, so a normal
   * crossing's opposing lefts -- passing nearside to nearside, ~5 m apart --
   * still turn together, and a skewed one's, whose ways cross, do not.
   */
  leftClash(T, v, C, A) {
    const city = this.city;
    let mine = null;
    for (const o of T.cars) {
      if (o === v || o.jcC !== C.id || o.jcMv !== 'L' || !o.rt || !o.rtN) continue;
      if (o.mode !== 'traffic') continue;   // (a police unit asks no junction)
      let B = null, toLine = 0, gone = false;
      const from = o.jcGo >= 0 ? o.jcGo : o.jcFromC === C.id ? o.jcFrom : -1;
      if (from >= 0) {
        for (const q of C.approaches) if (q.id === from) { B = q; break; }
        // past its approach (jcGo is cleared there): in the box still?
        gone = o.jcGo < 0 && (o.x - C.x) ** 2 + (o.z - C.z) ** 2 > C.r * C.r;
      } else {
        for (const ni of C.nodes) {
          const r = routeTo(city, o, ni);
          if (r && C.appr.get(r.key)) { B = C.appr.get(r.key); toLine = r.d - B.back - o.halfLen; break; }
        }
      }
      // (committed: whatever its distance from the centre -- a stop line
      // can be further out than C.r + 4, and a car committed at its line was
      // "through and gone" to the first version. Through and gone is a way
      // with no point left in the box: boxPath's, below.)
      if (!B || gone || B.grp !== A.grp) continue;
      // my own approach: a car in my lane is followed (the scan's leader);
      // one in the lane beside me turning left too is not -- two lefts
      // abreast whose arcs close in the box (signal 447)
      if (B === A && Math.abs((o.x - v.x) * A.uz - (o.z - v.z) * A.ux) < 1.6) continue;
      if (from < 0 && (o.prio > v.prio || toLine > 8 || this.light(C, B, 'L').s === 'R')) continue;
      if (!mine) mine = this.boxPath(T, v, C, this._bpA);
      const theirs = this.boxPath(T, o, C, this._bpB);
      if (pathsMeet(mine, theirs, v.halfWid + o.halfWid + CLASH_PAD)) return true;
    }
    return false;
  }

  /** Car v's planned way through C's box: points every 1.5 m from where it
   *  is, kept while within the box (C.r + 3 of its centre). */
  boxPath(T, v, C, out) {
    const rt = v.rt, R2 = (C.r + 3) ** 2, P = this._bpP;
    const s0 = (v.x - rt[R_QX]) * rt[R_UX] + (v.z - rt[R_QZ]) * rt[R_UZ];
    const D0 = Math.hypot(v.x - C.x, v.z - C.z);
    let n = 0, was = false;
    for (let D = 0; D < D0 + C.r + 12 && n < 60; D += 1.5) {
      T.pathAhead(v, s0, D, P);
      const inb = (P.x - C.x) ** 2 + (P.z - C.z) ** 2 < R2;
      if (inb) { out[2 * n] = P.x; out[2 * n + 1] = P.z; n++; was = true; }
      else if (was) break;
    }
    out.n = n;
    return out;
  }

  /** A roundabout entry: circulating traffic that will pass the entry within the gap. */
  ringBusy(T, v, C, A, player) {
    const city = this.city, ring = C.ring, ni = A.ni, sN = ring.s.get(ni), n = city.nodes[ni];
    for (const o of this.others(T, v, player)) {
      const rid = this.ring[o.edge] || 0;
      if (rid !== ring.id) {
        // a car in the circle by the entry, whatever its edge says
        const dx = o.x - n.x, dz = o.z - n.z;
        if (dx * dx + dz * dz < 25 && Math.abs(o.vLong) > 0.3 && o !== v && o.edge !== A.ei) return true;
        continue;
      }
      const e = city.edges[o.edge], dir = o.dirSign != null ? o.dirSign : 1;
      const sn = dir > 0 ? e.a : e.b, a = city.nodes[sn];
      const prog = (o.x - a.x) * e.dx * dir + (o.z - a.z) * e.dz * dir;
      let dR = (sN - (ring.s.get(sn) + prog)) % ring.L;
      if (dR < 0) dR += ring.L;
      if (dR > ring.L - 4) dR -= ring.L;   // just past the entry: still in it
      if (dR < -o.halfLen - 1.5) continue;
      const sp = Math.max(Math.abs(o.vLong), 2.5);
      if (dR > 7 && dR / sp > RB_GAP) continue;
      // will it leave the ring before my entry?
      if (dR > 2 && o.rt && o.rtN) {
        let leaves = false;
        for (let k = 1; k < o.rtN; k++) {
          const q = k * 23, pe = city.edges[o.rt[q - 23]], ps = o.rt[q - 23 + 1];
          const at = ps > 0 ? pe.b : pe.a;
          if (at === ni) break;
          if (!this.ring[o.rt[q]]) { leaves = true; break; }
        }
        if (leaves) continue;
      }
      return true;
    }
    return false;
  }

  // --- drawing: paint, poles, signs, islands (world.js, per chunk) -------------
  /**
   * Everything this module draws in chunk (cx, cz) into the chunk's flat
   * (vertex-coloured) mesh: no new draw calls. `lod` 1 is the near ring
   * (furniture too); the mid ring gets the paint only.
   */
  meshChunk(world, flat, cx, cz, lod) {
    const b = this.byChunk.get(this.city.chunkKey(cx, cz));
    if (!b) return;
    const P = new Painter(this, flat);
    for (const C of b.heads) for (const rig of this.rigs(C)) {
      P.stopBar(rig.A);
      if (lod === 1) meshPole(world, flat, rig);
    }
    for (const it of b.paint) {
      if (it.t === 'xing') P.crossing(it.X);
      else if (it.t === 'bar') P.stopBar(it.A);
      else if (it.t === 'teeth') P.teeth(it.A);
      else if (it.t === 'mini') P.miniDisc(it.x, it.z);
      else if (it.t === 'ringLanes') P.ringLanes(it.ring);
    }
    if (lod !== 1) return;
    for (const it of b.furn) {
      if (it.t === 'pole') meshPole(world, flat, it.rig);
      else if (it.t === 'sign') meshStopSign(world, flat, it.A, it.all, this.list[it.A.c]);
      else if (it.t === 'island') meshIsland(world, flat, it.ring, this);
    }
  }

  /** The inner side of a ring edge (+1 its (-dz, dx) side, -1 the other), else 0. */
  apronSide(ei) {
    const id = this.ring[ei];
    if (!id) return 0;
    const R = this.rings[id - 1], e = this.city.edges[ei], a = this.city.nodes[e.a];
    return ((R.x - a.x) * -e.dz + (R.z - a.z) * e.dx) > 0 ? 1 : -1;
  }

  /** Is there a stop / yield controller at node ni (rural.js's own sign defers to it)? */
  signedAt(ni) { return this.ctl[ni] >= 0; }
}

// ---------------------------------------------------------------------------
// Paint. White, at the drawn surface (terrain + the lift the query reports)
// plus 1.6 cm, in pieces a couple of metres long so it follows the ground.
const WHITE = [0.94, 0.93, 0.88];
const PAINT_DY = 0.016;

class Painter {
  constructor(jc, flat) { this.jc = jc; this.city = jc.city; this.flat = flat; }
  y(x, z) {
    const l = this.city.roadLift(x, z);
    return G.terrainHeight(x, z) + (l > 0.01 && l < WALK_LIFT - 0.05 ? l : ROAD_LIFT) + PAINT_DY;
  }
  /** A flat painted quad: centre (x, z), half extents a along (ux, uz), b across. */
  rect(x, z, ux, uz, a, b, col = WHITE) {
    const px = -uz, pz = ux;
    const c = [[x - ux * a - px * b, z - uz * a - pz * b], [x + ux * a - px * b, z + uz * a - pz * b],
      [x + ux * a + px * b, z + uz * a + pz * b], [x - ux * a + px * b, z - uz * a + pz * b]];
    this.flat.quad([c[0][0], this.y(c[0][0], c[0][1]), c[0][1]], [c[1][0], this.y(c[1][0], c[1][1]), c[1][1]],
      [c[2][0], this.y(c[2][0], c[2][1]), c[2][1]], [c[3][0], this.y(c[3][0], c[3][1]), c[3][1]], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col);
  }
  /** A line from (x0, z0) to (x1, z1), half-width w, in ~2.5 m pieces. */
  line(x0, z0, x1, z1, w, col = WHITE) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 0.05) return;
    const ux = (x1 - x0) / L, uz = (z1 - z0) / L, n = Math.max(1, Math.ceil(L / 2.5));
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * (L / n);
      this.rect(x0 + ux * s, z0 + uz * s, ux, uz, L / n / 2, w, col);
    }
  }
  crossing(X) {
    const e = this.city.edges[X.ei], a = this.city.nodes[X.ei != null ? e.a : 0];
    const ux = e.dx, uz = e.dz, px = -uz, pz = ux;   // along the road, across it
    const s = this.jc.xingS(X);
    // two OSM crossings on one arm moved out to the same mouth: draw one
    for (const o of this.jc.crossOn.get(X.ei)) { if (o === X) break; if (Math.abs(this.jc.xingS(o) - s) < 3.5) return; }
    const cx = a.x + ux * s, cz = a.z + uz * s, hw = e.hw - 0.15, h = X.w / 2;
    // ...and two on different edges that overlap where they were moved to
    // (the two one-way legs of a split approach converging at its mouth --
    // two ladders crossed over each other at an angle): the lower edge's only
    if (this.jc.xingClash(X, cx, cz)) return;
    if (X.ladder) {
      // continental bars along the traffic, between two side lines (ladder)
      for (let o = -hw + 0.5; o <= hw - 0.3; o += 1.05) this.rect(cx + px * o, cz + pz * o, ux, uz, h - 0.15, 0.24);
      this.line(cx - ux * h - px * hw, cz - uz * h - pz * hw, cx - ux * h + px * hw, cz - uz * h + pz * hw, 0.1);
      this.line(cx + ux * h - px * hw, cz + uz * h - pz * hw, cx + ux * h + px * hw, cz + uz * h + pz * hw, 0.1);
    } else {
      // Ontario's signalled crosswalk: two parallel white lines
      this.line(cx - ux * h - px * hw, cz - uz * h - pz * hw, cx - ux * h + px * hw, cz - uz * h + pz * hw, 0.1);
      this.line(cx + ux * h - px * hw, cz + uz * h - pz * hw, cx + ux * h + px * hw, cz + uz * h + pz * hw, 0.1);
    }
    if (X.feet) {
      // a cycle crossride beside it: "elephant's feet", 0.4 m squares
      const o = h + 0.35 + 2.0;
      for (let q = -hw + 0.3; q <= hw - 0.2; q += 0.85) {
        this.rect(cx + ux * (h + 0.35) + px * q, cz + uz * (h + 0.35) + pz * q, ux, uz, 0.2, 0.2);
        this.rect(cx + ux * o + px * q, cz + uz * o + pz * q, ux, uz, 0.2, 0.2);
      }
    }
  }
  /** Across an approach's own lanes at its stop line (0.45 m: Ontario's 30-60 cm). */
  stopBar(A) {
    // still across another street wherever it goes up the approach (2 of
    // ~8.3k: an arm that leaves a Y with a ramp a few metres back): no bar
    // rather than one in the middle of it
    if (this.jc.barAcross(A.ni, A.ei, A.back)) return;
    const P = A.at(0.25), cx = P.x, cz = P.z, rx = -P.uz, rz = P.ux;
    let o0 = P.two ? 0.15 : -P.hw + 0.3;
    const o1 = P.hw - 0.3;
    // (a two-way arterial's half starts at its centre line, which a left-turn
    // bay or a lane more one way moves off the edge's middle: arterial.js)
    if (P.two) {
      const e = this.city.edges[P.ei], T = twoWayLayout(e);
      if (T) o0 = (e.dx * P.ux + e.dz * P.uz > 0 ? T.m : -T.m) + T.c0 + 0.05;
    }
    this.line(cx + rx * o0, cz + rz * o0, cx + rx * o1, cz + rz * o1, 0.225);
  }
  /** A yield line: "shark's teeth" pointing at the oncoming driver. */
  teeth(A) {
    if (this.jc.barAcross(A.ni, A.ei, A.back)) return;   // (as stopBar)
    const P = A.at(0.3), cx = P.x, cz = P.z, ux = P.ux, uz = P.uz, rx = -uz, rz = ux;
    const o0 = P.two ? 0.9 : -P.hw + 0.4, o1 = P.hw - 0.4;
    for (let o = o0 + 0.3; o <= o1 - 0.3; o += 0.9) {
      const bx = cx + rx * o, bz = cz + rz * o;
      const p0 = [bx - rx * 0.3, 0, bz - rz * 0.3], p1 = [bx + rx * 0.3, 0, bz + rz * 0.3], p2 = [bx - ux * 0.75, 0, bz - uz * 0.75];
      for (const p of [p0, p1, p2]) p[1] = this.y(p[0], p[2]);
      this.flat.tri(p0, p1, p2, [0, 1, 0], WHITE);
    }
  }
  /** A multi-lane roundabout's broken lane lines, round the circle. */
  ringLanes(R) {
    const n = Math.min(R.ln, Math.floor((2 * R.hw) / 3.3));
    if (n < 2) return;
    for (const ei of R.edges) {
      const e = this.city.edges[ei], a = this.city.nodes[e.a];
      const px = -e.dz, pz = e.dx, w = e.hw - 0.6;
      for (let k = 1; k < n; k++) {
        const o = -w + (2 * w * k) / n;
        for (let s = 1; s < e.len - 1; s += 6) {
          const s1 = Math.min(e.len - 0.5, s + 3);
          this.line(a.x + e.dx * s + px * o, a.z + e.dz * s + pz * o, a.x + e.dx * s1 + px * o, a.z + e.dz * s1 + pz * o, 0.06);
        }
      }
    }
  }
  /** A mini roundabout's painted dome: a white disc, 2 m. */
  miniDisc(x, z) {
    const R = 2.0, n = 14, c = [x, this.y(x, z) + 0.06, z];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = [x + Math.cos(a0) * R, 0, z + Math.sin(a0) * R], q = [x + Math.cos(a1) * R, 0, z + Math.sin(a1) * R];
      p[1] = this.y(p[0], p[2]); q[1] = this.y(q[0], q[2]);
      this.flat.tri(c, p, q, [0, 1, 0], WHITE);
    }
  }
}

// ---------------------------------------------------------------------------
// Signal poles and mast arms (static, in the chunk's flat mesh; the heads are
// instanced, below). Galvanised steel, as the Region's are.
const STEEL = [0.42, 0.44, 0.45], STEEL_D = [0.3, 0.31, 0.32];
function meshPole(world, flat, rig) {
  const { x, y, z, ux, uz, rx, rz, mast } = rig;
  const f0 = flat.ni;
  flat.box(x, y - 0.1, z, 0.6, 0.35, 0.6, Math.atan2(rz, rx), [0.5, 0.5, 0.48]);   // the footing
  flat.prism(x, y + 0.2, z, 0.14, 7.1, 8, STEEL);
  flat.prism(x, y + 7.3, z, 0.1, 0.25, 8, STEEL_D);
  // the arm: from the pole back over the lanes (-r), rising slightly
  const L = mast, ax = x - rx * L / 2, az = z - rz * L / 2;
  flat.box(ax, y + 6.35, az, L, 0.17, 0.17, Math.atan2(-rz, -rx), STEEL);
  // a brace from the pole up to the arm's first third
  flat.box(x - rx * L * 0.17, y + 6.85, z - rz * L * 0.17, L * 0.34, 0.07, 0.07, Math.atan2(-rz, -rx), STEEL_D);
  // hangers for the heads on the arm
  for (const h of rig.heads) {
    if (h.kind === 6 || h.y < y + 4.5) continue;
    flat.box(h.x, h.y + 0.85, h.z, 0.08, 0.6 + (y + 6.3 - (h.y + 1.45)), 0.08, 0, STEEL_D);
  }
  // the pushbutton for the crossing, chest high
  flat.box(x + ux * 0.18, y + 1.05, z + uz * 0.18, 0.12, 0.18, 0.1, Math.atan2(uz, ux), [0.15, 0.15, 0.15]);
  world.city.addObstacle(world._ck, x, z, 0.3);
  if (world._fell) world._fell.push(x, z, f0, flat.ni);
}

// ---------------------------------------------------------------------------
// Signs: Ontario's STOP (red octagon, white legend and border) with the
// ALL-WAY tab (white, red legend and border) at an all-way stop; YIELD (Ra-2,
// a red-bordered white triangle, no legend in Canada).
const FONT = {
  S: ['111', '100', '111', '001', '111'], T: ['111', '010', '010', '010', '010'],
  O: ['111', '101', '101', '101', '111'], P: ['111', '101', '111', '100', '100'],
  A: ['111', '101', '111', '101', '101'], L: ['100', '100', '100', '100', '111'],
  W: ['10001', '10001', '10101', '11011', '10001'], Y: ['101', '101', '010', '010', '010'],
  '-': ['000', '000', '111', '000', '000'],
};
const RED = [0.55, 0.02, 0.025], SIGN_W = [0.86, 0.86, 0.84], BACK = [0.5, 0.52, 0.53];

class Face {
  // a sign face at (x, y, z) facing (fx, fz); u right across it, v up
  constructor(flat, x, y, z, fx, fz) {
    this.flat = flat; this.x = x; this.y = y; this.z = z; this.fx = fx; this.fz = fz; this.ux = fz; this.uz = -fx;
  }
  P(u, v, o) { return [this.x + this.ux * u + this.fx * o, this.y + v, this.z + this.uz * u + this.fz * o]; }
  poly(pts, o, col, back) {
    const n = back ? [-this.fx, 0, -this.fz] : [this.fx, 0, this.fz];
    for (let i = 1; i + 1 < pts.length; i++) {
      this.flat.tri(this.P(pts[0][0], pts[0][1], o), this.P(pts[i][0], pts[i][1], o), this.P(pts[i + 1][0], pts[i + 1][1], o), n, col);
    }
  }
  rect(u0, v0, u1, v1, o, col) { this.poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], o, col); }
  /** Block letters, centred at (u, v), `h` tall. */
  text(str, u, v, h, o, col) {
    const px = h / 5, gap = px;
    let W = 0;
    for (const ch of str) W += FONT[ch][0].length * px + gap;
    W -= gap;
    let x0 = u - W / 2;
    for (const ch of str) {
      const g = FONT[ch];
      for (let r = 0; r < 5; r++) {
        const row = g[r];
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== '1') continue;
          let c1 = c;
          while (c1 + 1 < row.length && row[c1 + 1] === '1') c1++;
          this.rect(x0 + c * px, v + h / 2 - (r + 1) * px, x0 + (c1 + 1) * px, v + h / 2 - r * px, o, col);
          c = c1;
        }
      }
      x0 += g[0].length * px + gap;
    }
  }
}
const oct = (r) => { const o = []; for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; };

function meshStopSign(world, flat, A, all, C) {
  const city = world.city, P = A.at(0.4), ux = P.ux, uz = P.uz, rx = -uz, rz = ux;
  // on the right, at the stop line, a pace past the kerb
  // (the nearest spot off every carriageway, out to the right or back from
  // the line: four steps out and then standing in the road anyway left ten
  // posts in the lanes for traffic to wedge against; none found, no sign)
  const bx = P.x + rx * (P.hw + 0.9), bz = P.z + rz * (P.hw + 0.9);
  let x = 0, z = 0, found = false;
  for (const [i, j] of SIGN_SEARCH) {
    const qx = bx + rx * i - ux * j, qz = bz + rz * i - uz * j;
    if (city.onRoad(qx, qz, 0.3, false, false)) continue;
    x = qx; z = qz; found = true; break;
  }
  if (!found || !G.isBuildable(x, z)) return;
  const gy = G.terrainHeight(x, z) + Math.max(0, city.roadLift(x, z));
  const yieldSign = A.kind === 'yield';
  const H = yieldSign ? 2.1 : 2.15;
  const f0 = flat.ni;
  flat.box(x + ux * 0.05, gy - 0.2, z + uz * 0.05, 0.07, H + (all ? 0.45 : 0) + 0.25, 0.07, Math.atan2(uz, ux), [0.55, 0.57, 0.58]);
  const F = new Face(flat, x, gy + H + (all ? 0.42 : 0), z, -ux, -uz);
  if (yieldSign) {
    const tri = (r) => [[-r, r * 0.55], [r, r * 0.55], [0, -r * 1.18]];
    F.poly(tri(0.46), 0.0, BACK, true);
    F.poly(tri(0.46), 0.01, RED);
    F.poly(tri(0.3), 0.02, SIGN_W);
  } else {
    F.poly(oct(0.38), 0.0, BACK, true);
    F.poly(oct(0.38), 0.01, SIGN_W);
    F.poly(oct(0.355), 0.02, RED);
    F.text('STOP', 0, 0, 0.17, 0.03, SIGN_W);
    if (all) {
      // the ALL-WAY tab under it
      F.rect(-0.3, -0.62, 0.3, -0.44, 0.0, BACK);
      F.rect(-0.3, -0.62, 0.3, -0.44, 0.01, RED);
      F.rect(-0.285, -0.605, 0.285, -0.455, 0.02, SIGN_W);
      F.text('ALL-WAY', 0, -0.53, 0.09, 0.03, RED);
    }
  }
  city.addObstacle(world._ck, x, z, 0.12);
  if (world._fell) world._fell.push(x, z, f0, flat.ni);
}

// ---------------------------------------------------------------------------
// A roundabout's central island: a kerbed, slightly domed lawn inside the
// truck apron (the ring edges' inner pavement, tinted to red pavers in
// world.meshRoad), with ornamental grasses, shrubs and boulders, the bigger
// ones a few young spruce; a chevron sign facing each entry; YIELD signs and
// splitter islands at the entries.
function meshIsland(world, flat, ring, jc) {
  const city = world.city, { x: cx, z: cz } = ring;
  // the apron's inner edge: ring centreline less the carriageway and its pavement
  const sw = ring.cls === 'residential' || ring.cls === 'unclassified' ? 2.6 : 3.2;
  const rIn = ring.r - ring.hw - sw - 0.05;
  const seed = Math.round(cx * 3 + cz * 7);
  if (rIn > 1.5) {
    const N = clamp(Math.round(rIn * 2.2), 14, 40);
    const T = (x, z) => G.terrainHeight(x, z);
    const kerbH = WALK_LIFT + 0.18;
    const dome = Math.min(0.9, rIn * 0.06);
    const grass = [0.07, 0.13, 0.035], kerb = [0.6, 0.6, 0.58], mulch = [0.1, 0.065, 0.04];
    const ringPts = (r, lift) => {
      const o = [];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        o.push([x, T(x, z) + lift, z]);
      }
      return o;
    };
    const base = ringPts(rIn, WALK_LIFT - 0.02), top = ringPts(rIn, kerbH), inner = ringPts(rIn - 0.3, kerbH);
    for (let i = 0; i < N; i++) {
      const a = (i + 0.5) / N * Math.PI * 2;
      flat.quad(base[i], base[i + 1], top[i + 1], top[i], [Math.cos(a), 0, Math.sin(a)], [0, 0, 1, 0, 1, 1, 0, 1], kerb);
      flat.quad(top[i], top[i + 1], inner[i + 1], inner[i], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], kerb);
    }
    // the lawn, rising to the dome, with a planted bed of mulch round the
    // middle on the bigger islands: bands at these fractions of the radius
    const R0 = rIn - 0.3;
    const bands = rIn > 6 ? [[0.62, grass], [0.5, mulch], [0.22, grass], [0, mulch]] : [[0, grass]];
    let prev = inner;
    for (const [fr, col] of bands) {
      const lift = kerbH + dome * (1 - fr * fr);
      if (fr === 0) {
        const c = [cx, T(cx, cz) + kerbH + dome, cz];
        for (let i = 0; i < N; i++) flat.tri(prev[i], prev[i + 1], c, [0, 1, 0], col);
      } else {
        const cur = ringPts(R0 * fr, lift);
        for (let i = 0; i < N; i++) flat.quad(prev[i], prev[i + 1], cur[i + 1], cur[i], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col);
        prev = cur;
      }
    }
    // plantings
    const yAt = (x, z) => {
      const d = Math.hypot(x - cx, z - cz) / Math.max(rIn, 0.1);
      return T(x, z) + kerbH + dome * (1 - d * d) - 0.05;
    };
    // ornamental grasses (tan in October), low junipers and boulders in the bed
    const grassC = [0.42, 0.32, 0.16], shrub = [0.04, 0.09, 0.035], stone = [0.36, 0.34, 0.31];
    const big = rIn > 6;
    const nG = clamp(Math.round(rIn * 3.2), 5, 50);
    for (let i = 0; i < nG; i++) {
      // in the bed (0.5-0.62 of the radius) and the middle, else round the centre
      const ring = big ? (i % 3 === 0 ? 0.1 + 0.1 * hash2(seed + 3, i) : 0.51 + 0.1 * hash2(seed + 1, i)) : 0.15 + 0.3 * hash2(seed + 1, i);
      const a = (i / nG) * Math.PI * 2 + hash2(seed, i) * 0.3, r = R0 * ring;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, h = hash2(seed + 2, i);
      if (h < 0.18) flat.box(x, yAt(x, z) - 0.2, z, 0.9 + h * 2, 0.55 + h, 0.7 + h, a, stone);
      else if (h < 0.6) flat.cone(x, yAt(x, z) - 0.05, z, 0.55, 1.15, 6, grassC);
      else flat.cone(x, yAt(x, z) - 0.1, z, 0.85, 0.75, 7, shrub);
    }
    if (rIn > 7.5) {
      // a few young spruce in the middle
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + hash2(seed, 99) * 2, r = rIn * 0.22;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = yAt(x, z);
        flat.prism(x, y, z, 0.12, 0.8, 5, [0.25, 0.18, 0.12]);
        flat.cone(x, y + 0.6, z, 1.25, 3.6, 7, [0.05, 0.16, 0.07]);
      }
    }
  }
  // per entry: a chevron sign on the island facing it, a YIELD sign at the
  // entry, and a splitter island down a two-way approach
  for (const A of ring.entries) {
    meshStopSign(world, flat, A, false, null);
    const n = city.nodes[A.ni];
    const dx = cx - n.x, dz = cz - n.z, D = Math.hypot(dx, dz) || 1;
    if (rIn > 1.5) {
      // the sign stands on the island's edge where the entering driver looks:
      // straight ahead across the circle
      const sx = cx - (dx / D) * (rIn - 0.7), sz = cz - (dz / D) * (rIn - 0.7);
      const gy = G.terrainHeight(sx, sz) + WALK_LIFT + 0.15;
      flat.box(sx, gy, sz, 0.07, 1.25, 0.07, 0, [0.55, 0.57, 0.58]);
      const F = new Face(flat, sx, gy + 1.5, sz, -dx / D, -dz / D);
      F.rect(-0.6, -0.3, 0.6, 0.3, 0.0, BACK);
      F.rect(-0.6, -0.3, 0.6, 0.3, 0.01, [0.03, 0.03, 0.03]);
      // white chevrons pointing right (anticlockwise round the island)
      for (const c of [-0.32, 0, 0.32]) F.poly([[c - 0.13, 0.22], [c - 0.01, 0.22], [c + 0.13, 0], [c - 0.01, -0.22], [c - 0.13, -0.22], [c + 0.01, 0]], 0.02, SIGN_W);
      city.addObstacle(world._ck, sx, sz, 0.1);
    }
    if (A.two && A.hw >= 3.9) {
      const e = city.edges[A.ei], ux = A.ux, uz = A.uz, rx = -uz, rz = ux;
      // from the circle's outer kerb back along the approach
      const s0 = Math.max(A.back - 0.2, 1), L = Math.min(16, e.len * 0.55 - s0);
      if (L > 4) {
        const w0 = Math.min(0.85, A.hw * 0.48 - 1.25), w1 = 0.25;
        if (w0 > 0.3) {
          const pts = [];
          const steps = Math.ceil(L / 3);
          for (let i = 0; i <= steps; i++) {
            const s = s0 + (L * i) / steps, w = w0 + (w1 - w0) * (i / steps);
            const bx = n.x - ux * s, bz = n.z - uz * s;
            pts.push([bx + rx * w, bz + rz * w, bx - rx * w, bz - rz * w]);
          }
          const T = (x, z) => G.terrainHeight(x, z) + ROAD_LIFT;
          const hT = 0.17, topC = [0.62, 0.62, 0.6], side = [0.5, 0.5, 0.48];
          for (let i = 0; i < steps; i++) {
            const p = pts[i], q = pts[i + 1];
            flat.quad([p[0], T(p[0], p[1]) + hT, p[1]], [q[0], T(q[0], q[1]) + hT, q[1]], [q[2], T(q[2], q[3]) + hT, q[3]], [p[2], T(p[2], p[3]) + hT, p[3]], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], topC);
            flat.quad([p[0], T(p[0], p[1]) - 0.05, p[1]], [q[0], T(q[0], q[1]) - 0.05, q[1]], [q[0], T(q[0], q[1]) + hT, q[1]], [p[0], T(p[0], p[1]) + hT, p[1]], [rx, 0, rz], [0, 0, 1, 0, 1, 1, 0, 1], side);
            flat.quad([q[2], T(q[2], q[3]) - 0.05, q[3]], [p[2], T(p[2], p[3]) - 0.05, p[3]], [p[2], T(p[2], p[3]) + hT, p[3]], [q[2], T(q[2], q[3]) + hT, q[3]], [-rx, 0, -rz], [0, 0, 1, 0, 1, 1, 0, 1], side);
          }
          const p = pts[0];
          flat.quad([p[2], T(p[2], p[3]) - 0.05, p[3]], [p[0], T(p[0], p[1]) - 0.05, p[1]], [p[0], T(p[0], p[1]) + hT, p[1]], [p[2], T(p[2], p[3]) + hT, p[3]], [ux, 0, uz], [0, 0, 1, 0, 1, 1, 0, 1], side);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The signal heads: two InstancedMeshes, rebuilt from the heads near the
// camera a few times a second, the lenses' colours set every frame.
//
// Ontario's heads (OTM Book 12): vertical, 300 mm lenses, red over amber over
// green -- a fourth section with the green left arrow where the approach has
// an advance -- in a black housing on a black backplate with a yellow
// retroreflective border. Pedestrian heads: the orange hand and the white
// walking person (the hand flashes for the clearance).
//
// kinds: 3 (R, Y, G), 4 (R, Y, G, arrow: an approach with an advance),
// 6 (pedestrian). The lens atlas's cells: 0 ball, 1 left arrow, 2 hand, 3 walker.
const SEC = 0.36;
const OFF = { r: [0.06, 0.012, 0.01], y: [0.06, 0.04, 0.008], g: [0.008, 0.045, 0.03], p: [0.04, 0.03, 0.025] };
const ON = { r: [1.6, 0.08, 0.04], y: [1.5, 0.75, 0.03], g: [0.15, 1.35, 0.7], hand: [1.5, 0.5, 0.08], walk: [1.4, 1.4, 1.3] };
const LENSES = { 3: ['r', 'y', 'g'], 4: ['r', 'y', 'g', 'a'], 6: ['p'] };

function lensAtlas() {
  const S = 64, cv = document.createElement('canvas');
  cv.width = S * 4; cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S * 4, S);
  g.fillStyle = '#fff';
  // 0: the ball
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2); g.fill();
  // 1: a left arrow
  g.save(); g.translate(S * 1.5, S / 2);
  g.beginPath(); g.moveTo(-S * 0.38, 0); g.lineTo(-S * 0.08, -S * 0.28); g.lineTo(-S * 0.08, -S * 0.11); g.lineTo(S * 0.36, -S * 0.11);
  g.lineTo(S * 0.36, S * 0.11); g.lineTo(-S * 0.08, S * 0.11); g.lineTo(-S * 0.08, S * 0.28); g.closePath(); g.fill(); g.restore();
  // 2: the raised hand
  g.save(); g.translate(S * 2.5, S / 2);
  g.fillRect(-S * 0.2, -S * 0.02, S * 0.36, S * 0.34);
  for (let i = 0; i < 4; i++) g.fillRect(-S * 0.2 + i * S * 0.095, -S * 0.36 + (i === 0 || i === 3 ? S * 0.06 : 0), S * 0.075, S * 0.38);
  g.beginPath(); g.ellipse(S * 0.2, S * 0.05, S * 0.06, S * 0.15, -0.6, 0, Math.PI * 2); g.fill();
  g.restore();
  // 3: the walking person
  g.save(); g.translate(S * 3.5, S / 2);
  g.beginPath(); g.arc(S * 0.02, -S * 0.3, S * 0.08, 0, Math.PI * 2); g.fill();
  g.lineWidth = S * 0.09; g.lineCap = 'round'; g.strokeStyle = '#fff';
  g.beginPath(); g.moveTo(0, -S * 0.17); g.lineTo(-S * 0.03, S * 0.08); g.lineTo(-S * 0.17, S * 0.36); g.moveTo(-S * 0.03, S * 0.08); g.lineTo(S * 0.12, S * 0.2); g.lineTo(S * 0.14, S * 0.38);
  g.moveTo(-S * 0.14, -S * 0.02); g.lineTo(0, -S * 0.12); g.lineTo(S * 0.15, -S * 0.0); g.stroke();
  g.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

/** The housing: a unit section (1 per lens), centred, facing +z, vertex coloured. */
function housingGeometry() {
  const pos = [], col = [], nor = [];
  const box = (x0, y0, z0, x1, y1, z1, c) => {
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const F = [[4, 5, 6, 7, [0, 0, 1]], [1, 0, 3, 2, [0, 0, -1]], [5, 1, 2, 6, [1, 0, 0]], [0, 4, 7, 3, [-1, 0, 0]], [7, 6, 2, 3, [0, 1, 0]], [0, 1, 5, 4, [0, -1, 0]]];
    for (const [a, b, cc, d, n] of F) for (const k of [a, b, cc, a, cc, d]) { pos.push(...P[k]); nor.push(...n); col.push(...c); }
  };
  const Y = [0.75, 0.55, 0.02], K = [0.025, 0.025, 0.025];
  // backplate with the yellow border, then the black housing in front
  box(-0.33, -SEC / 2, -0.06, 0.33, SEC / 2, -0.035, Y);
  box(-0.29, -SEC / 2, -0.035, 0.29, SEC / 2, -0.03, K);
  box(-0.19, -SEC / 2 + 0.01, -0.03, 0.19, SEC / 2 - 0.01, 0.17, K);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
/** A lens (a 12-gon) with its visor: uv in its atlas cell; the visor maps to the cell's black corner. */
function lensGeometry() {
  const pos = [], uv = [];
  const n = 12, R = 0.14, z = 0.175;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    pos.push(0, 0, z, Math.cos(a0) * R, Math.sin(a0) * R, z, Math.cos(a1) * R, Math.sin(a1) * R, z);
    uv.push(0.5, 0.5, 0.5 + Math.cos(a0) * 0.5, 0.5 + Math.sin(a0) * 0.5, 0.5 + Math.cos(a1) * 0.5, 0.5 + Math.sin(a1) * 0.5);
  }
  // the visor: a hood over the top half, both faces
  const hz0 = z, hz1 = z + 0.2;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI, a1 = ((i + 1) / 6) * Math.PI;
    const p0 = [Math.cos(a0) * 0.16, Math.sin(a0) * 0.16], p1 = [Math.cos(a1) * 0.16, Math.sin(a1) * 0.16];
    const q = [[p0[0], p0[1], hz0], [p1[0], p1[1], hz0], [p1[0], p1[1], hz1], [p0[0], p0[1], hz1]];
    for (const k of [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]) { pos.push(...q[k]); uv.push(0.02, 0.02); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export class SignalHeads {
  constructor(scene, jc) {
    this.jc = jc;
    this.capH = 700; this.capL = 2200;
    const hm = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.housing = new THREE.InstancedMesh(housingGeometry(), hm, this.capH);
    const lm = new THREE.MeshBasicMaterial({ map: lensAtlas(), toneMapped: false, side: THREE.DoubleSide });
    lm.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float aCell;\n' + sh.vertexShader.replace('#include <uv_vertex>',
        '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vec2((uv.x + aCell) * 0.25, uv.y);\n#endif');
    };
    lm.customProgramCacheKey = () => 'signalLens';
    const lg = lensGeometry();
    this.cell = new Float32Array(this.capL);
    lg.setAttribute('aCell', new THREE.InstancedBufferAttribute(this.cell, 1));
    this.lens = new THREE.InstancedMesh(lg, lm, this.capL);
    this.lens.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capL * 3), 3);
    for (const m of [this.housing, this.lens]) {
      m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.lens.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.lenses = [];    // [head, slot] per lens instance
    this._t = 1e9;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** Rebuild the instance lists round (x, z): every 0.4 s, or after a jump. */
  gather(x, z) {
    const jc = this.jc, out = [];
    const c0 = Math.floor((x - HEAD_R) / CHUNK), c1 = Math.floor((x + HEAD_R) / CHUNK);
    const d0 = Math.floor((z - HEAD_R) / CHUNK), d1 = Math.floor((z + HEAD_R) / CHUNK);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const b = jc.byChunk.get(jc.city.chunkKey(cx, cz));
      if (!b) continue;
      for (const C of b.heads) {
        if ((C.x - x) ** 2 + (C.z - z) ** 2 > HEAD_R * HEAD_R) continue;
        for (const rig of jc.rigs(C)) for (const h of rig.heads) out.push(h);
      }
    }
    let nh = 0, nl = 0;
    const M = this._m, Q = this._q, S = this._s, P = this._p;
    this.lenses.length = 0;
    for (const h of out) {
      const L = LENSES[h.kind];
      if (nh >= this.capH || nl + L.length > this.capL) break;
      Q.setFromAxisAngle(this._up, Math.atan2(h.fx, h.fz));
      // the housing: one section per lens, stacked by scaling
      S.set(h.kind === 6 ? 1.05 : 1, L.length * (h.kind === 6 ? 1.15 : 1), 1);
      P.set(h.x, h.y, h.z);
      M.compose(P, Q, S);
      this.housing.setMatrixAt(nh++, M);
      S.set(1, 1, 1);
      for (let i = 0; i < L.length; i++) {
        const dy = (L.length - 1) / 2 * SEC - i * SEC;
        P.set(h.x, h.y + dy, h.z);
        M.compose(P, Q, h.kind === 6 ? S.set(1.25, 1.25, 1) : S);
        this.lens.setMatrixAt(nl, M);
        const k = L[i];
        this.cell[nl] = k === 'a' || k === 'ya' ? 1 : k === 'p' ? 2 : 0;
        this.lenses.push(h, k);
        nl++;
      }
    }
    this.housing.count = nh; this.lens.count = nl;
    this.housing.instanceMatrix.needsUpdate = true;
    this.lens.instanceMatrix.needsUpdate = true;
    this.lens.geometry.attributes.aCell.needsUpdate = true;
  }

  update(cam, dt) {
    if (!cam) return;
    this._t += dt;
    const x = cam.position.x, z = cam.position.z;
    if (this._t > 0.4 || !this._g || Math.hypot(x - this._g[0], z - this._g[1]) > 60) {
      this._t = 0; this._g = [x, z];
      this.gather(x, z);
    }
    const jc = this.jc, col = this.lens.instanceColor.array, cell = this.cell;
    const blink = (jc.t % 1) < 0.5;
    let cellDirty = false;
    for (let i = 0; i < this.lens.count; i++) {
      const h = this.lenses[2 * i], k = this.lenses[2 * i + 1], rig = h.rig, C = rig.C;
      const { p } = jc.phase(C);
      let c;
      if (k === 'p') {
        // the walk signal: the group's green, for its first 55 %
        const ws = jc.walkState(C, h.pg);
        const walk = ws === 'walk';
        const hand = ws === 'hand' || (ws === 'flash' && blink);
        const want = walk ? 3 : 2;
        if (cell[i] !== want) { cell[i] = want; cellDirty = true; }
        c = walk ? ON.walk : hand ? ON.hand : OFF.p;
      } else {
        const mine = p.g === rig.A.grp;
        const st = !mine || p.k === 'clr' || p.k === 'red' || p.k === 'ped' ? 'R'
          : p.k === 'adv' ? 'ADV' : p.k === 'amb' ? 'Y' : 'G';
        if (k === 'r') c = st === 'R' || st === 'ADV' ? ON.r : OFF.r;
        else if (k === 'y') c = st === 'Y' ? ON.y : OFF.y;
        else if (k === 'ya') c = st === 'Y' ? ON.y : OFF.y;
        else if (k === 'g') c = st === 'G' ? ON.g : OFF.g;
        else c = st === 'ADV' && rig.A.left ? ON.g : OFF.g;
      }
      col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2];
    }
    this.lens.instanceColor.needsUpdate = true;
    if (cellDirty) this.lens.geometry.attributes.aCell.needsUpdate = true;
  }
}
