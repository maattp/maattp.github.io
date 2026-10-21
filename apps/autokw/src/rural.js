// Auto KW: THE COUNTRY ROADS. Which roads are rural, and the cross-section a
// rural road has instead of a city street's kerb and pavement.
//
// A road is rural from the data, not by hand (tagRural, at load, in citygen
// before anything reads a pavement width): OSM's unpaved roads (gravel.js)
// always are; any other ground-level street is when it runs through open
// country -- few buildings along it (their centres within 60 m, averaged over
// 300 m of the road) and little built footprint round it (citygen's per-chunk
// `built`, the measure world.groundTint paints fields by). Short runs flip to
// what surrounds them, so a farmyard does not grow a 50 m pavement.
//
// A rural road has no kerb and no pavement (citygen walkWidthOf = 0). Its
// cross-section, from the carriageway's edge outward (`m` metres):
//
//     carriageway  | shoulder | foreslope | bottom | backslope | fade
//     ROAD + RAISE | SH       | FS        | DB     | BS        | FD   -> ground
//
// The carriageway stands RAISE over the usual ROAD_LIFT (an embankment, as a
// real concession road is graded up out of its ditches), back down to 0 by
// each junction (`raise`); the ditch bottom is at the ground, the backslope
// climbs to a BERM on the field side and the fade takes it back to the ground.
// The terrain mesh is 40 m, so a ditch cannot be dug INTO it: the road and the
// field edge stand up round it instead, which reads the same from a car.
//
// One function (`ruralLift`) gives the height at any (chain position, side,
// m), crossings (driveways, field entrances, paths) included; world.js meshes
// the ditch from it and citygen.roadLift answers from it, so what is drawn and
// what is driven / walked on cannot disagree.
//
// Chains: maximal runs of rural edges joined at "pass-through" nodes (two
// rural edges meeting at under 35 deg: OSM splits a concession road every
// ~50 m). A pass-through node has no junction polygon (citygen buildJunction
// returns null; world mitres the strips into each other), and the raise and
// the hydro line run on through it. Chain position `c` is metres from the
// chain's start; an edge maps s -> c = e.rs0 + e.rsd * s.

import * as G from './geo.js';
import { hash2 } from './util.js';

// the cross-section (m beyond the carriageway edge)
export const SH = 1.3, FS = 1.7, DB = 0.9, BS = 1.3, FD = 2.4;
export const RW = SH + FS + DB + BS + FD;          // 7.6: the whole reach
export const PROF_M = [0, SH, SH + FS, SH + FS + DB, SH + FS + DB + BS, RW];
export const RAISE = 0.42;     // the carriageway over ROAD_LIFT, at full raise
export const RAMP = 22;        // metres the raise takes to come up off a junction
export const BOT = 0.04;       // the ditch bottom over the ground
export const BERM = 0.45;      // the field-side lip
export const CROWN = 0.07;     // a gravel road's crown at its centreline
const FILL_SLOPE = 0.5;        // a crossing's fill falls 0.5 m per metre along the ditch

/** The country north and west of Waterloo where the Old Order Mennonites
 *  drive their buggies (St. Jacobs, Conestogo, Heidelberg, St. Clements):
 *  buggy.js drives them here, world.js puts up the buggy warning signs. */
export const mennoniteCountry = (x, z) => (z < -6200 && x < -4200) || (z < -4800 && x < -7200);

const CAND = { res: 1, st: 1, art: 1 };
const PASS_COS = Math.cos((35 * Math.PI) / 180);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The lift at m metres beyond the carriageway edge (no crossing): `R` the
 * carriageway's own lift at that point, `f` the raise (0..1).
 */
export function ditchLift(R, f, m) {
  if (m <= 0) return R;
  const y4 = BERM * f + 0.02 * (1 - f);
  if (m < SH) return R - (0.03 * m) / SH;
  let a = SH, ya = R - 0.03;
  if (m < SH + FS) return ya + (BOT - ya) * ((m - a) / FS);
  a = SH + FS;
  if (m < a + DB) return BOT;
  a += DB;
  if (m < a + BS) return BOT + (y4 - BOT) * ((m - a) / BS);
  a += BS;
  if (m < RW) return y4 + (0.015 - y4) * ((m - a) / FD);
  return 0;
}

/** A crossing's fill: level with the shoulder out over the ditch to the
 *  backslope's crest, then down across the fade. */
function fillLift(R, m) {
  const top = R - 0.04, mc = SH + FS + DB + BS;
  if (m <= mc) return top;
  if (m < RW) return top + (0.015 - top) * ((m - mc) / FD);
  return 0;
}

/**
 * Tag the rural roads (e.rural) and build their chains, crossings and keep-
 * clear grid. `g` = { nodes, edges }; `buildings` citygen's boxes; `builtAt`
 * the per-chunk footprint cover. Returns the stats.
 */
export function tagRural(g, buildings, builtAt) {
  const { nodes, edges } = g;
  const N = edges.length;
  const cand = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const e = edges[i];
    if (!e.elev && !e.tunnel && CAND[e.cls]) cand[i] = 1;
  }
  // buildings by their centres, 60 m cells
  const BC = 60, bgrid = new Map();
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (b.h <= 0) continue;
    const k = Math.floor(b.x / BC) * 65536 + Math.floor(b.z / BC);
    let l = bgrid.get(k);
    if (!l) bgrid.set(k, (l = []));
    l.push(i);
  }
  const countNear = (x, z, R) => {
    let n = 0;
    const c0 = Math.floor((x - R) / BC), c1 = Math.floor((x + R) / BC);
    const d0 = Math.floor((z - R) / BC), d1 = Math.floor((z + R) / BC);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const l = bgrid.get(cx * 65536 + cz);
      if (!l) continue;
      for (const i of l) { const b = buildings[i]; if ((b.x - x) ** 2 + (b.z - z) ** 2 < R * R) n++; }
    }
    return n;
  };
  // --- chains of candidate edges through degree-2 nodes (for the window) ---
  const other = (ni, ei) => { const n = nodes[ni]; return n.e.length === 2 ? (n.e[0] === ei ? n.e[1] : n.e[0]) : -1; };
  const walkChain = (start, okEdge, okNode) => {
    // returns [edges in order, dir per edge (+1 = a->b along the chain)]
    const left = [], right = [];
    const go = (ei, fromNode, out) => {
      let cur = ei, ni = fromNode;
      for (let guard = 0; guard < 100000; guard++) {
        const e = edges[cur];
        const nxtNode = e.a === ni ? e.b : e.a;
        if (!okNode(nxtNode, cur)) break;
        const o = other(nxtNode, cur);
        if (o < 0 || !okEdge(o) || o === start) break;
        out.push([o, edges[o].a === nxtNode ? 1 : -1]);
        cur = o; ni = nxtNode;
      }
    };
    const s = edges[start];
    go(start, s.a, right);   // onward past b
    go(start, s.b, left);    // back past a
    const list = [];
    for (let i = left.length - 1; i >= 0; i--) list.push([left[i][0], -left[i][1]]);
    list.push([start, 1]);
    for (const r of right) list.push(r);
    return list;
  };
  const seen = new Uint8Array(N);
  const score = new Float32Array(N);
  const rural = new Uint8Array(N);
  const pre = [], cid = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (!cand[i] || seen[i]) continue;
    const ch = walkChain(i, (o) => cand[o] && !seen[o], () => true);
    for (const [ei] of ch) { seen[ei] = 1; cid[ei] = pre.length; }
    pre.push(ch);
  }
  // Street density: metres of OTHER streets (not this chain) with their
  // middles within 110 m. A concession road has the odd crossing road; a
  // subdivision, mapped or not mapped with its houses, is a net of streets.
  const SC = 110, sgrid = new Map();
  for (let i = 0; i < N; i++) {
    if (!cand[i] && edges[i].cls !== 'hwy' && edges[i].cls !== 'ramp') continue;
    const e = edges[i], a = nodes[e.a], b = nodes[e.b];
    const k = Math.floor((a.x + b.x) / 2 / SC) * 65536 + Math.floor((a.z + b.z) / 2 / SC);
    let l = sgrid.get(k); if (!l) sgrid.set(k, (l = [])); l.push(i);
  }
  const streetsNear = (x, z, own) => {
    let L = 0;
    const cx = Math.floor(x / SC), cz = Math.floor(z / SC);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = sgrid.get((cx + dx) * 65536 + cz + dz);
      if (!l) continue;
      for (const i of l) {
        if (cid[i] === own) continue;
        const e = edges[i], a = nodes[e.a], b = nodes[e.b];
        if (((a.x + b.x) / 2 - x) ** 2 + ((a.z + b.z) / 2 - z) ** 2 < SC * SC) L += e.len;
      }
    }
    return L;
  };
  for (let p = 0; p < pre.length; p++) {
    const ch = pre[p];
    // per edge: buildings near its middle, built cover, other streets; then
    // a 300 m window
    const n = ch.length, mid = new Float32Array(n), cnt = new Float32Array(n), bt = new Float32Array(n), st = new Float32Array(n);
    let c = 0;
    for (let k = 0; k < n; k++) {
      const e = edges[ch[k][0]], a = nodes[e.a], b = nodes[e.b];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      mid[k] = c + e.len / 2; c += e.len;
      cnt[k] = countNear(mx, mz, 60);
      bt[k] = builtAt(mx, mz);
      st[k] = streetsNear(mx, mz, p);
    }
    let lo = 0, hi = 0, sc = 0, sb = 0, ss = 0, sl = 0;
    for (let k = 0; k < n; k++) {
      while (hi < n && mid[hi] <= mid[k] + 150) { const L = edges[ch[hi][0]].len; sc += cnt[hi] * L; sb += bt[hi] * L; ss += st[hi] * L; sl += L; hi++; }
      while (mid[lo] < mid[k] - 150) { const L = edges[ch[lo][0]].len; sc -= cnt[lo] * L; sb -= bt[lo] * L; ss -= st[lo] * L; sl -= L; lo++; }
      const per50 = sl > 0 ? sc / sl : 0, built = sl > 0 ? sb / sl : 0, streets = sl > 0 ? ss / sl : 0;
      const ei = ch[k][0];
      score[ei] = per50;
      rural[ei] = edges[ei].gravel || (per50 < 3.5 && built < 0.05 && streets < 260) ? 1 : 0;
    }
    // hysteresis: a run under 160 m takes what surrounds it (gravel stays)
    for (let pass = 0; pass < 2; pass++) {
      let k = 0;
      while (k < n) {
        let j = k, L = 0;
        const v = rural[ch[k][0]];
        while (j < n && rural[ch[j][0]] === v) { L += edges[ch[j][0]].len; j++; }
        const before = k > 0 ? rural[ch[k - 1][0]] : -1, after = j < n ? rural[ch[j][0]] : -1;
        const flip = L < 160 && (before === after ? before === 1 - v : (before < 0 || after < 0) && (before === 1 - v || after === 1 - v) && L < 80);
        if (flip) for (let q = k; q < j; q++) if (!edges[ch[q][0]].gravel) rural[ch[q][0]] = 1 - v;
        k = j;
      }
    }
  }
  let km = 0, kmGravel = 0, nr = 0;
  for (let i = 0; i < N; i++) {
    const e = edges[i];
    e.rural = rural[i] === 1;
    if (e.rural) { nr++; km += e.len / 1000; if (e.gravel) kmGravel += e.len / 1000; }
  }
  // --- pass-through nodes: two rural edges, nearly straight on ---
  let passN = 0;
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    n.rpass = false;
    if (n.e.length !== 2 || n.elev) continue;
    const e0 = edges[n.e[0]], e1 = edges[n.e[1]];
    if (!e0.rural || !e1.rural || n.e[0] === n.e[1]) continue;
    // the two ways out of the node
    const u0x = e0.a === ni ? e0.dx : -e0.dx, u0z = e0.a === ni ? e0.dz : -e0.dz;
    const u1x = e1.a === ni ? e1.dx : -e1.dx, u1z = e1.a === ni ? e1.dz : -e1.dz;
    if (-(u0x * u1x + u0z * u1z) < PASS_COS) continue;
    n.rpass = true; passN++;
  }
  // --- rural chains through pass-through nodes ---
  const chains = [];
  const seen2 = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!edges[i].rural || seen2[i]) continue;
    const ch = walkChain(i, (o) => edges[o].rural && !seen2[o], (ni) => nodes[ni].rpass);
    const id = chains.length;
    const C = { id, edges: [], dir: [], cum: [], len: 0, ends: null, xing: [], bikeDone: false, m0: -1, m1: -1, gravel: true, cls: 'res', name: null };
    let c = 0;
    for (const [ei, d] of ch) {
      seen2[ei] = 1;
      const e = edges[ei];
      e.rc = id; e.rsd = d; e.rs0 = d > 0 ? c : c + e.len;
      C.edges.push(ei); C.dir.push(d); C.cum.push(c);
      c += e.len;
      if (!e.gravel) C.gravel = false;
      if (e.cls === 'art' || (e.cls === 'st' && C.cls === 'res')) C.cls = e.cls;
      if (!C.name && e.name) C.name = e.name;
    }
    C.cum.push(c);
    C.len = c;
    const first = edges[C.edges[0]], last = edges[C.edges[C.edges.length - 1]];
    C.ends = [
      { ni: C.dir[0] > 0 ? first.a : first.b, ei: C.edges[0], k: C.dir[0] > 0 ? 0 : 1 },
      { ni: C.dir[C.dir.length - 1] > 0 ? last.b : last.a, ei: C.edges[C.edges.length - 1], k: C.dir[C.dir.length - 1] > 0 ? 1 : 0 },
    ];
    C.seed = hash2(Math.round(first.len * 10) + id, 77);
    chains.push(C);
  }
  // --- driveways: one per farm (a cluster of buildings) off a rural road ---
  const RC = 100, egrid = new Map();
  for (let i = 0; i < N; i++) {
    const e = edges[i];
    if (!e.rural) continue;
    const a = nodes[e.a], b = nodes[e.b];
    for (let cx = Math.floor((Math.min(a.x, b.x) - 150) / RC); cx <= Math.floor((Math.max(a.x, b.x) + 150) / RC); cx++) {
      for (let cz = Math.floor((Math.min(a.z, b.z) - 150) / RC); cz <= Math.floor((Math.max(a.z, b.z) + 150) / RC); cz++) {
        const k = cx * 65536 + cz;
        let l = egrid.get(k);
        if (!l) egrid.set(k, (l = []));
        l.push(i);
      }
    }
  }
  const nearestRural = (x, z) => {
    const l = egrid.get(Math.floor(x / RC) * 65536 + Math.floor(z / RC));
    if (!l) return null;
    let best = null, bd = 150;
    for (const ei of l) {
      const e = edges[ei], a = nodes[e.a];
      const s = (x - a.x) * e.dx + (z - a.z) * e.dz;
      if (s < 0 || s > e.len) continue;
      const side = (x - a.x) * -e.dz + (z - a.z) * e.dx;
      const d = Math.abs(side);
      if (d < bd) { bd = d; best = { ei, s, d, sg: side >= 0 ? 1 : -1 }; }
    }
    return best;
  };
  // clusters: buildings within 45 m of another, near a rural road
  const near = [];
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (b.h <= 0 || b.w * b.d < 40) continue;
    const r = nearestRural(b.x, b.z);
    if (r && r.d > edges[r.ei].hw + RW + 4) near.push([i, r]);
  }
  const parent = new Int32Array(near.length).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  {
    const cg = new Map();
    near.forEach(([bi], k) => {
      const b = buildings[bi], key = Math.floor(b.x / 45) * 65536 + Math.floor(b.z / 45);
      let l = cg.get(key); if (!l) cg.set(key, (l = [])); l.push(k);
    });
    near.forEach(([bi], k) => {
      const b = buildings[bi], cx = Math.floor(b.x / 45), cz = Math.floor(b.z / 45);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const l = cg.get((cx + dx) * 65536 + cz + dz);
        if (!l) continue;
        for (const q of l) {
          if (q <= k) continue;
          const o = buildings[near[q][0]];
          if ((o.x - b.x) ** 2 + (o.z - b.z) ** 2 < 45 * 45) parent[find(q)] = find(k);
        }
      }
    });
  }
  const best = new Map();
  near.forEach(([bi, r], k) => {
    const root = find(k), cur = best.get(root);
    // the farm's lane runs to its house: the nearest building to the road
    if (!cur || r.d < cur[1].d) best.set(root, [bi, r]);
  });
  let drives = 0;
  for (const [bi, r] of best.values()) {
    const e = edges[r.ei], C = chains[e.rc];
    const c = e.rs0 + e.rsd * r.s;
    if (c < 30 || c > C.len - 30) continue;
    const sg = r.sg * e.rsd;
    if (C.xing.some((x) => x.sg === sg && Math.abs(x.c - c) < 30)) continue;
    const b = buildings[bi];
    // aim at the near face of the house, 1.5 m out from it
    const a = nodes[e.a];
    const px = a.x + e.dx * r.s, pz = a.z + e.dz * r.s;
    const ux = (b.x - px) / r.d, uz = (b.z - pz) / r.d;
    const reach = Math.max(0, r.d - (Math.min(b.w, b.d) / 2 + 1.5));
    C.xing.push({ c, sg, hw: 1.9, kind: 'drive', tx: px + ux * reach, tz: pz + uz * reach, b: bi });
    drives++;
  }
  // field entrances: now and then on each side, where no lane is near
  let fields = 0;
  for (const C of chains) {
    for (const sg of [1, -1]) {
      for (let c = 45 + hash2(C.id, sg + 3) * 120; c < C.len - 45; c += 170 + hash2(Math.round(c), C.id) * 160) {
        if (hash2(C.id * 3 + sg, Math.round(c)) > 0.45) continue;
        if (C.xing.some((x) => x.sg === sg && Math.abs(x.c - c) < 50)) continue;
        C.xing.push({ c, sg, hw: 1.8, kind: 'field', tx: null, tz: null, b: -1 });
        fields++;
      }
    }
    C.xing.sort((p, q) => p.c - q.c);
  }
  // the lanes beyond the ditch, for the keep-clear grid
  const lanes = [];
  for (const C of chains) {
    for (const X of C.xing) {
      const P = chainPoint(g, C, X.c);
      if (!P) continue;
      const ox = P.px * X.sg, oz = P.pz * X.sg;
      const hw = edges[P.ei].hw;
      const x0 = P.x + ox * (hw + RW - 0.6), z0 = P.z + oz * (hw + RW - 0.6);
      let x1, z1;
      if (X.kind === 'drive') { x1 = X.tx; z1 = X.tz; } else { x1 = P.x + ox * (hw + RW + 7); z1 = P.z + oz * (hw + RW + 7); }
      X.lane = [x0, z0, x1, z1];
      lanes.push([x0, z0, x1, z1, X.kind === 'drive' ? 1.7 : 1.5]);
    }
  }
  const rural0 = { chains, lanes, stats: { edges: nr, km: +km.toFixed(1), kmGravel: +kmGravel.toFixed(1), chains: chains.length, pass: passN, drives, fields } };
  // keep-clear grid: the ditch zone of every rural edge, and the lanes
  const KC = 32, kgrid = new Map();
  const file = (x0, z0, x1, z1, r, item) => {
    for (let cx = Math.floor((Math.min(x0, x1) - r) / KC); cx <= Math.floor((Math.max(x0, x1) + r) / KC); cx++) {
      for (let cz = Math.floor((Math.min(z0, z1) - r) / KC); cz <= Math.floor((Math.max(z0, z1) + r) / KC); cz++) {
        const k = cx * 65536 + cz;
        let l = kgrid.get(k);
        if (!l) kgrid.set(k, (l = []));
        l.push(item);
      }
    }
  };
  for (let i = 0; i < N; i++) {
    const e = edges[i];
    if (!e.rural) continue;
    const a = nodes[e.a], b = nodes[e.b];
    file(a.x, a.z, b.x, b.z, e.hw + RW + 0.6, [a.x, a.z, b.x, b.z, e.hw + RW + 0.6]);
  }
  for (const L of lanes) file(L[0], L[1], L[2], L[3], L[4] + 0.8, [L[0], L[1], L[2], L[3], L[4] + 0.8]);
  rural0.clear = (x, z) => {
    const l = kgrid.get(Math.floor(x / KC) * 65536 + Math.floor(z / KC));
    if (!l) return false;
    for (const s of l) {
      const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((x - s[0]) * dx + (z - s[1]) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if ((x - s[0] - dx * t) ** 2 + (z - s[1] - dz * t) ** 2 < s[4] * s[4]) return true;
    }
    return false;
  };
  g.rural = rural0;
  return rural0;
}

/** The point at chain position c: x, z, the edge, s along it, and the
 *  chain's right-hand perpendicular (px, pz) there (+1 side). */
export function chainPoint(g, C, c) {
  if (c < 0 || c > C.len) return null;
  let lo = 0, hi = C.edges.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (C.cum[m] <= c) lo = m; else hi = m - 1; }
  const ei = C.edges[lo], e = g.edges[ei], d = C.dir[lo];
  const s = d > 0 ? c - C.cum[lo] : e.len - (c - C.cum[lo]);
  const a = g.nodes[e.a];
  return { x: a.x + e.dx * s, z: a.z + e.dz * s, ei, s, px: -e.dz * d, pz: e.dx * d, dx: e.dx * d, dz: e.dz * d };
}

/**
 * The raise (0..1) at chain position c: 0 at each end's junction (out past
 * its mouth and the strip's climb to it, `m0`/`m1`), full RAMP metres on.
 */
export function chainRaise(C, c) {
  return smooth(Math.min(c - C.m0, C.len - C.m1 - c) / RAMP);
}

/**
 * The lift at chain position c, on side sg (of the chain's direction), m
 * metres beyond the carriageway edge whose lift there is R: the ditch, or a
 * crossing's fill where one is.
 */
export function ruralLift(C, c, sg, m, R, f) {
  let y = ditchLift(R, f, m);
  if (m <= 0 || m >= RW) return y;
  const X = C.xing;
  if (!X.length) return y;
  // the crossings near c (sorted by c)
  let lo = 0, hi = X.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (X[mid].c < c - 8) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < X.length && X[i].c < c + 8; i++) {
    const x = X[i];
    if (x.sg !== sg) continue;
    const over = Math.abs(c - x.c) - x.hw;
    const fy = fillLift(R, m) - Math.max(0, over) * FILL_SLOPE;
    if (fy > y) y = fy;
  }
  return y;
}
