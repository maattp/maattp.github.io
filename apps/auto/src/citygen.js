// Builds the city from the imported OpenStreetMap graph and footprints.
//
// This file used to *generate* Seattle -- district street grids, hand-drawn
// arterials chained into the graph, then a long repair pipeline (planarize,
// stitch, dedupeGrid, districtOwner) to make the result coherent. None of that
// survives, because none of it is needed: OSM ways already form a planar graph
// where every ground-level crossing shares a node, and real footprints are not
// standing in real roads. What is left is decoding, indexing, and the surface
// queries -- roadLift / nodeSurface / groundAt -- which are unchanged, because
// they were never about where the roads came from.

import * as G from './geo.js';
import { CLS_NAME, F_ELEV, F_TUNNEL, F_ONEWAY, F_ONEWAY_REV } from './mapdata.js';
import { LANDMARK_CLEAR } from './landmarks.js';
import { distToSeg, clamp, hash2 } from './util.js';

export const CHUNK = 400;

// Road and sidewalk surfaces are drawn slightly proud of the terrain so they
// don't z-fight it. Anything that stands ON them has to be lifted by the same
// amount or it sinks into the asphalt -- these are the single source of truth,
// shared with world.js.
// Raised from 0.22/0.25/0.44. Adaptive tessellation got terrain poking through
// the asphalt down from 139 cm to about 28 cm, but a road quad is a chord and
// some residue is unavoidable on a curved 40 m heightfield -- and 28 cm through
// a 22 cm lift is grass growing on the road. 30 cm clears the measured worst
// case. The kerb is still 22 cm (WALK_LIFT - ROAD_LIFT), which is the number
// world.js draws and the lift query reports.
export const ROAD_LIFT = 0.30;
export const NODE_LIFT = 0.33;
export const WALK_LIFT = 0.52;

// Half-widths now come per-edge from the import (real lane counts), so these are
// only the fallback and the bounds a lift query scans within.
const CLASS_HW = { hwy: 15, art: 9.5, st: 6.5, res: 5.5, ramp: 5.5 };
const MAX_HW = 20; // the widest half-width build_roads.py will emit
const MAX_WALK = 3.2;
// How far a paved surface tapers out at its outer edge, so nothing steps off a
// cliff. Note this is the only place the lift is smoothed: the kerb between
// road and pavement is a real 22 cm step and the query has to report it,
// because world.js draws it that way. Smoothing belongs in the character and
// the camera -- soften it here and you sink into the kerb instead.
const RAMP = 0.5;
// ...and a pavement's outer edge is not a cliff either: it comes down to the
// ground across this verge, drawn by world.meshRoad / meshNode and reported by
// roadLift / nodeSurface. 1 m for the 52 cm of WALK_LIFT, about 27 deg -- a
// step you walk off, not a slab you stand waist-deep behind.
export const VERGE = 1.0;

// How far ABOVE its current ride height a vehicle may be captured by a bridge
// deck. This was 2.6 m, which is taller than a car: driving along ground-level
// I-5 under an overpass, the deck was within reach, the car was lifted onto it,
// and when the deck ended it fell back down -- measured on I-5, held at 47.3 m
// over ground descending 45.3 -> 43.6, then a 3.76 m drop. Those are the jumps
// and bumps on the freeways.
//
// A car is only ever ON a deck when the deck is essentially at its wheels.
// 0.9 m is far more than a ramp can climb between frames (a 10 % grade at
// 30 m/s rises 5 cm a frame), so joining a viaduct still works, while an
// overpass a metre or more overhead can no longer pick the car up.
const DECK_REACH = 0.9;
// groundAt's scratch for extrapolating graded pieces (see there): an
// extrapolation within EX_TIE of a piece that covers the point is the same
// road handing over, and yields to it.
const EX_MAX = 32, EX_TIE = 0.6;
const exY = new Float64Array(EX_MAX), exPen = new Float64Array(EX_MAX), covY = new Float64Array(EX_MAX);
// The bore's interior height, shared with world.js (which draws it) and
// player.js (whose camera has to stay under it). One literal, because a camera
// that thinks the ceiling is somewhere else than where it is drawn is exactly
// the kind of disagreement "The one height surface" exists to prevent.
export const TUNNEL_H = 5.4;
// SR-99 IS ONE BORE WITH TWO DECKS, southbound on top. WSDOT's bore is a
// single 17.5 m (57.5 ft) tube, ~15.8 m inside, carrying two 9.8 m (32 ft)
// roadways -- two 3.4 m lanes, a 2.4 m west and a 0.6 m east shoulder -- each
// with 4.8 m (15 ft 9 in) of vertical clearance, the upper slab hung off the
// lining walls and the lower one on continuous corbels. Road surface to road
// surface: one TUNNEL_H interior plus a 1.2 m slab, the separation the game's
// box section needs so neither deck's walls, roof or catch zone reach the
// other's. OSM draws it as two roads side by side (see stackBores).
export const DECK_SEP = TUNNEL_H + 1.2;
const CLASS_SPEED = { hwy: 30, art: 17, st: 12, res: 9, ramp: 14 };

const walkWidth = (cls) => (cls === 'st' || cls === 'res' ? 2.6 : cls === 'art' ? 3.2 : 0);

// Building class (tools/build_buildings.py) + height -> facade style.
function styleFor(cls, h, w, d) {
  // An untagged, unnamed OSM building falls to cls 0, which used to mean
  // "house" outright -- so a 30 m commercial block with no tags came out clad
  // in clapboard siding at domestic plank scale. Size overrides the tag: a
  // house is small AND low.
  if (cls === 0 && (h > 11 || (w != null && w * d > 260))) {
    return h > 22 ? 'midrise' : 'brick';
  }
  if (cls === 0) return 'house';
  if (cls === 1) return h > 25 ? 'midrise' : 'lowrise';
  if (cls === 3) return 'industrial';
  if (cls === 4) return 'campus';
  return h > 60 ? 'tower' : h > 22 ? 'midrise' : 'brick';
}

// ---------------------------------------------------------------------------

// Counters the verify harness asserts on, so a regression in the clearing
// passes shows up as a number rather than as a screenshot nobody looks at.
export const cityStats = {
  buildingsShrunk: 0, buildingsDropped: 0, treesSkipped: 0, landmarkCleared: 0,
  propsSkipped: 0, nodesReheighted: 0, worstReheight: 0,
};

const skey = (cx, cz) => cx * 100003 + cz;

// ---------------------------------------------------------------------------
// Grading: the vertical profile of every road that is not simply draped.
//
// Two defects with one cause. The importer gave a deck the Laplacian of its
// neighbours with a floor of ground + 0.6 m, and the 40 m DEM cannot see an
// underpass, so an overpass came out as a slab lying on the street it crosses:
// measured on the shipped graph, 211 of 367 freeway decks over a ground street
// sat under 5 m above it and 108 under 2 m, and 105 freeway "bridges" never
// rose 3 m above anything -- concrete parapets lining ground-level I-5 with
// the cross streets running into their fascia. And ground-level freeway draped
// the triangulated DEM, so every triangle it crossed was a kink in the grade.
//
// The fix CLAUDE.md asked for is profiling whole connected chains, not edges:
// a per-edge envelope measured WORSE (5.62 % -> 9.48 %) because a freeway is
// ~35 m pieces that each disagreed with the next at every node. Here the unit
// is the SAMPLE GRAPH: every deck and every ground freeway/ramp edge is cut
// into ~5 m samples that share one variable at each node, so merges, diverges
// and bridge touchdowns are one profile by construction.
//
//   floor f   the lowest the surface may be: terrain across the whole width
//             (no grass through tarmac), the imported deck height (water
//             clearance), and OVER_CLEAR above anything a deck crosses.
//   dilate    max of f within PROF_R -- crests become plateaus
//   cone      from each overpass, fall no faster than the class's grade
//   average   box average within PROF_R
//
// average(dilate(f)) >= f at every sample, because every sample in the window
// already holds the max over a window containing this one -- so the smoothing
// can never push tarmac below the ground or a deck into the road under it,
// which is what "plain smoothing put 1.01 m of ground through the tarmac" was.
// Where a graded road meets an ungraded one (an at-grade junction, a ramp
// terminal) the node is pinned to the ground and the profile may climb out of
// it no faster than GRADE_CAP unless a floor demands more, so the street it
// meets is untouched.
const PROF_STEP = 5;       // metres between profile samples
const PROF_R = 20;         // envelope half-window: dilation and average
// Running surface over running surface at an overpass. meshViaduct's girder is
// 1.35 m deep, so this leaves ~4.6 m under the soffit -- a truck's clearance.
const OVER_CLEAR = 6.0;
// An overpass the neighbourhood cannot climb to at this grade is refused and
// left as imported, rather than turned into a ski jump.
const MAX_CLIMB = 0.15;
// How fast a locked deck's raise onto the ground may come and go (see
// gradeRoads' locked decks).
const LOCK_RAISE_GRADE = 0.08;
// Freeway near a bore stays draped: the portal cut is carved into the terrain
// after the city is built, and a profile graded off the uncarved ground would
// float the approach over its own trench.
const PORTAL_KEEP = 200;
const CLASS_GRADE = { hwy: 0.06, ramp: 0.08 };
// Steepest camber a graded road takes from its hillside -- about a real
// freeway's superelevation. Past it the floor fills the downhill side instead.
const CAMBER_MAX = 0.06;
/** Embankment batter: horizontal metres per metre of fill. */
export const BERM = 1.5;

function gradeRoads(nodes, edges) {
  const T = G.terrainHeight;
  const portals = [];
  for (const n of nodes) {
    let tun = false, surf = false;
    for (const ei of n.e) { if (edges[ei].tunnel) tun = true; else surf = true; }
    if (tun && surf) portals.push(n);
  }
  const nearPortal = (n) => {
    for (const p of portals) {
      if (Math.abs(p.x - n.x) < PORTAL_KEEP && Math.abs(p.z - n.z) < PORTAL_KEEP
        && Math.hypot(p.x - n.x, p.z - n.z) < PORTAL_KEEP) return true;
    }
    return false;
  };
  for (const e of edges) {
    e.prof = false;
    if (e.tunnel) continue;
    const fwy = e.cls === 'hwy' || e.cls === 'ramp';
    if (!e.elev && !fwy) continue;
    const near = nearPortal(nodes[e.a]) || nearPortal(nodes[e.b]);
    if (!e.elev && near) continue;
    e.prof = true;
    // A deck beside a portal keeps its imported heights exactly.
    e.lock = near;
  }

  // --- the sample graph ---
  const SX = [], SZ = [], ED = [], ST = [], NV = [];
  const nodeVar = new Map();
  const varOf = (ni) => {
    let v = nodeVar.get(ni);
    if (v === undefined) {
      v = SX.length; nodeVar.set(ni, v);
      SX.push(nodes[ni].x); SZ.push(nodes[ni].z); ED.push(-1); ST.push(0); NV.push(ni);
    }
    return v;
  };
  const adj = [];
  const link = (i, j, d, gr) => {
    (adj[i] || (adj[i] = [])).push(j, d, gr);
    (adj[j] || (adj[j] = [])).push(i, d, gr);
  };
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    if (!e.prof) continue;
    const a = nodes[e.a], b = nodes[e.b];
    const k = Math.max(1, Math.ceil(e.len / PROF_STEP));
    const ps = new Int32Array(k + 1);
    ps[0] = varOf(e.a);
    for (let i = 1; i < k; i++) {
      ps[i] = SX.length;
      SX.push(a.x + ((b.x - a.x) * i) / k); SZ.push(a.z + ((b.z - a.z) * i) / k);
      ED.push(ei); ST.push(i / k); NV.push(-1);
    }
    ps[k] = varOf(e.b);
    const gr = CLASS_GRADE[e.cls] || 0.12;
    for (let i = 0; i < k; i++) link(ps[i], ps[i + 1], e.len / k, gr);
    e.pk = k;
    e.ps = ps;
  }
  const N = SX.length;
  for (let i = 0; i < N; i++) if (!adj[i]) adj[i] = [];
  // The edges a sample belongs to, with its parameter along each.
  const edgesOf = (i, fn) => {
    if (ED[i] >= 0) { fn(edges[ED[i]], ST[i]); return; }
    const ni = NV[i];
    for (const ei of nodes[ni].e) {
      const e = edges[ei];
      if (e.prof) fn(e, e.a === ni ? 0 : 1);
    }
  };

  // --- anchors: graded meets ungraded, and decks locked to a portal ---
  const fixed = new Uint8Array(N), fixVal = new Float64Array(N);
  for (const [ni, v] of nodeVar) {
    const n = nodes[ni];
    n.prof = true;
    n.anchor = n.e.some((ei) => !edges[ei].prof);
    if (n.anchor) { fixed[v] = 1; fixVal[v] = T(n.x, n.z) + ROAD_LIFT; }
  }
  // A deck is flat across, so the ground under its UPHILL edge is what it has
  // to clear, not the ground under its centre line. Floored at the centre, a
  // deck landing across a hillside ran under the terrain on its high side --
  // up to 1 m at I-5 downtown, with grass drawn over the tarmac and cars
  // riding the grass (58 of 262 graded samples off their drawn deck).
  const deckFloor = (e, x, z) => {
    const px = -e.dz, pz = e.dx;
    let v = -Infinity;
    for (const o of [-e.hw, -e.hw / 2, 0, e.hw / 2, e.hw]) v = Math.max(v, T(x + px * o, z + pz * o));
    return v + ROAD_LIFT;
  };
  const lockRaise = [];
  for (const e of edges) {
    if (!e.prof || !e.lock) continue;
    const a = nodes[e.a], b = nodes[e.b], k = e.pk, step = e.len / k;
    // A locked deck keeps its imported heights -- except where they are under
    // the ground (the importer's bilinear DEM against the mesh's triangles,
    // and a chord across a crest). There it is raised onto the ground: the
    // raise is dilated along the edge at LOCK_RAISE_GRADE so it eases in and
    // out rather than stepping sample to sample (verify's riders fall off a
    // step), and it never reaches the portal itself -- that height is the
    // bore's mouth, so the raise comes in at the same grade from it.
    const base = new Float64Array(k + 1), need = new Float64Array(k + 1), cap = new Float64Array(k + 1);
    for (let i = 0; i <= k; i++) {
      base[i] = a.y + ((b.y - a.y) * i) / k + ROAD_LIFT * 0.3;
      const x = a.x + ((b.x - a.x) * i) / k, z = a.z + ((b.z - a.z) * i) / k;
      need[i] = Math.max(0, deckFloor(e, x, z) - base[i]);
      let dp = Infinity;
      for (const p of portals) {
        if (Math.abs(p.x - x) < PORTAL_KEEP && Math.abs(p.z - z) < PORTAL_KEEP) dp = Math.min(dp, Math.hypot(p.x - x, p.z - z));
      }
      // ...nor at an at-grade end, where a draped road meets the deck at its
      // imported height: raised there, the deck began with a step 2-4 m over
      // the road driving onto it (verify's approach climb).
      if (a.anchor) dp = Math.min(dp, 5 + i * step);
      if (b.anchor) dp = Math.min(dp, 5 + (k - i) * step);
      cap[i] = Math.max(0, dp - 5) * LOCK_RAISE_GRADE;
    }
    lockRaise.push({ e, base, need, cap, step });
  }
  // Pass 2, per edge, with each end node needing whatever the raise of ANY
  // locked deck meeting there gives it, so two decks meeting at a node agree
  // there and each eases into it (a node taking the higher of two raises on
  // its own was a 1.5 m step at the end of the lower one).
  const raiseAt = (L) => {
    const { need, cap, step } = L, k = need.length - 1, out = new Float64Array(k + 1);
    for (let i = 0; i <= k; i++) {
      let r = 0;
      for (let j = 0; j <= k; j++) r = Math.max(r, need[j] - Math.abs(i - j) * step * LOCK_RAISE_GRADE);
      out[i] = Math.min(r, cap[i]);
    }
    return out;
  };
  const nodeRaise = new Map();
  for (const L of lockRaise) {
    const r = raiseAt(L), k = r.length - 1;
    for (const [ni, v] of [[L.e.a, r[0]], [L.e.b, r[k]]]) nodeRaise.set(ni, Math.max(nodeRaise.get(ni) || 0, v));
  }
  for (const L of lockRaise) {
    const { e, base, need, cap } = L, k = need.length - 1;
    need[0] = Math.max(need[0], nodeRaise.get(e.a) || 0);
    need[k] = Math.max(need[k], nodeRaise.get(e.b) || 0);
    cap[0] = Math.max(cap[0], nodeRaise.get(e.a) || 0);
    cap[k] = Math.max(cap[k], nodeRaise.get(e.b) || 0);
    const r = raiseAt(L);
    for (let i = 0; i <= k; i++) {
      fixed[e.ps[i]] = 1;
      fixVal[e.ps[i]] = base[i] + r[i];
    }
  }

  // --- neighbourhood walk within a graph radius ---
  const bd = new Float64Array(N), stamp = new Int32Array(N);
  let tick = 0;
  const touched = [], stack = [];
  const around = (i, rad) => {
    tick++;
    touched.length = 0; stack.length = 0;
    stamp[i] = tick; bd[i] = 0; touched.push(i); stack.push(i);
    while (stack.length) {
      const u = stack.pop();
      const l = adj[u];
      for (let q = 0; q < l.length; q += 3) {
        const j = l[q], nd = bd[u] + l[q + 1];
        if (nd > rad) continue;
        if (stamp[j] !== tick) { stamp[j] = tick; bd[j] = nd; touched.push(j); stack.push(j); }
        else if (nd < bd[j]) { bd[j] = nd; stack.push(j); }
      }
    }
    return touched;
  };
  const W = new Float64Array(N);
  for (let i = 0; i < N; i++) { const l = adj[i]; for (let q = 1; q < l.length; q += 3) W[i] += l[q] / 2; }

  // --- carriageways that overlap at the same level ---
  // Real carriageways run shoulder to shoulder, and widths from lane counts
  // make them overlap by a metre or three -- I-5's express lanes, a ramp
  // running alongside before it diverges. Profiled independently, two
  // overlapping surfaces cross each other along the length and the depth
  // buffer shows whichever is higher piece by piece: the sawtooth. Worse, a
  // car rides whichever sits slightly above -- groundAt prefers it -- and hops
  // between them. Coupled samples take each other's base floor and no camber,
  // so they solve to one surface (see the solve loop for why only once).
  const hwOf = new Float64Array(N), levelOf = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    edgesOf(i, (e, t) => {
      if (e.hw > hwOf[i]) hwOf[i] = e.hw;
      const a = nodes[e.a], b = nodes[e.b];
      levelOf[i] = e.elev ? a.y + (b.y - a.y) * t : T(SX[i], SZ[i]);
    });
  }
  const couple = [];
  const coupled = new Uint8Array(N);
  {
    const SC = 16, sgrid = new Map();
    for (let i = 0; i < N; i++) {
      const k = skey(Math.floor(SX[i] / SC), Math.floor(SZ[i] / SC));
      let l = sgrid.get(k);
      if (!l) sgrid.set(k, (l = []));
      l.push(i);
    }
    for (let i = 0; i < N; i++) {
      if (fixed[i]) continue;
      const cx = Math.floor(SX[i] / SC), cz = Math.floor(SZ[i] / SC);
      let near = null;
      for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) {
        const l = sgrid.get(skey(cx + ox, cz + oz));
        if (!l) continue;
        for (const j of l) {
          if (j === i || fixed[j]) continue;
          const d = Math.hypot(SX[i] - SX[j], SZ[i] - SZ[j]);
          if (d >= hwOf[i] + hwOf[j] - 0.5 || Math.abs(levelOf[i] - levelOf[j]) > 2) continue;
          // Not its own carriageway: anything within 30 m along the graph is
          // the same road carrying on, and coupling to it would ratchet the
          // whole chain up to its highest sample.
          if (!near) near = new Set(around(i, 30));
          if (near.has(j)) continue;
          couple.push(i, j);
          coupled[i] = 1;
        }
      }
    }
  }

  // --- cross-slope ---
  // A freeway on a hillside is cambered with the hill, not levelled across it:
  // levelling a 14 m carriageway on a 10 % side slope floats one edge 1.4 m.
  // The TERRAIN gradient is smoothed along the chain, and each edge takes its
  // component across itself. Decks are flat, so a graded road touching one
  // flattens out to meet it -- and so does one coupled to a neighbour.
  const isDeck = new Uint8Array(N);
  for (let i = 0; i < N; i++) edgesOf(i, (e) => { if (e.elev) isDeck[i] = 1; });
  const rgx = new Float64Array(N), rgz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (isDeck[i] || coupled[i]) continue;
    const x = SX[i], z = SZ[i];
    rgx[i] = (T(x + 4, z) - T(x - 4, z)) / 8;
    rgz[i] = (T(x, z + 4) - T(x, z - 4)) / 8;
  }
  const gx = new Float64Array(N), gz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (isDeck[i] || coupled[i]) continue;
    if (fixed[i]) { gx[i] = rgx[i]; gz[i] = rgz[i]; continue; }
    let sx = 0, sz = 0, sw = 0;
    for (const j of around(i, PROF_R)) { sx += rgx[j] * W[j]; sz += rgz[j] * W[j]; sw += W[j]; }
    if (sw > 0) { gx[i] = sx / sw; gz[i] = sz / sw; }
  }

  // --- distance to the nearest anchor ---
  // ...and the cone every graded road may climb out of an anchor within: the
  // lowest of (anchor height + GRADE_CAP x distance) over all anchors.
  const dFix = new Float64Array(N).fill(Infinity);
  const capFix = new Float64Array(N).fill(Infinity);
  const GRADE_CAP = 0.08;
  {
    const st = [];
    for (let i = 0; i < N; i++) if (fixed[i]) { dFix[i] = 0; capFix[i] = fixVal[i]; st.push(i); }
    while (st.length) {
      const u = st.pop(), l = adj[u];
      for (let q = 0; q < l.length; q += 3) {
        const j = l[q], nd = dFix[u] + l[q + 1], nc = capFix[u] + l[q + 1] * GRADE_CAP;
        let moved = false;
        if (nd < dFix[j] && nd < 400) { dFix[j] = nd; moved = true; }
        if (nc < capFix[j]) { capFix[j] = nc; moved = true; }
        if (moved) st.push(j);
      }
    }
  }

  // --- base floors ---
  const F0 = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (fixed[i]) { F0[i] = fixVal[i]; continue; }
    const x = SX[i], z = SZ[i];
    let f = -Infinity;
    edgesOf(i, (e, t) => {
      let v;
      if (e.elev) {
        const a = nodes[e.a], b = nodes[e.b];
        // Never below the imported deck (that is the water clearance), and
        // never INTO the ground mid-span: the importer only floored the nodes,
        // so a long span's chord could pass under a crest.
        // (Floored across the width, like the locked decks above, was tried
        // here too: it bought 2 of the probe's samples and changed which
        // overpasses the clearance pass refuses -- one came back as a 45 %
        // piece off its junction and verify's riders fell off it.)
        v = Math.max(a.y + (b.y - a.y) * t + ROAD_LIFT * 0.3, T(x, z) + ROAD_LIFT + 0.1);
      } else {
        // Camber is capped at CAMBER_MAX: following the smoothed hillside, a
        // freeway leaned 15-20 % across -- twice a real superelevation -- and
        // the floor below takes up the rest as fill on the downhill side.
        const px = -e.dz, pz = e.dx, hw = e.hw;
        const s = clamp(gx[i] * px + gz[i] * pz, -CAMBER_MAX, CAMBER_MAX);
        v = -Infinity;
        for (const o of [-hw, -hw / 2, 0, hw / 2, hw]) v = Math.max(v, T(x + px * o, z + pz * o) - s * o);
        v += ROAD_LIFT;
      }
      if (v > f) f = v;
    });
    F0[i] = f;
  }

  // --- overpasses ---
  // A deck is over whatever it crosses without sharing a node. Two decks: the
  // higher imported one is on top. Near-parallel pairs are a merge, not a
  // crossing.
  const CELL = 100, grid = new Map();
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    if (e.tunnel) continue;
    const a = nodes[e.a], b = nodes[e.b];
    for (let cx = Math.floor(Math.min(a.x, b.x) / CELL); cx <= Math.floor(Math.max(a.x, b.x) / CELL); cx++)
      for (let cz = Math.floor(Math.min(a.z, b.z) / CELL); cz <= Math.floor(Math.max(a.z, b.z) / CELL); cz++) {
        const k = skey(cx, cz);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(ei);
      }
  }
  const crossings = [];
  for (let ai = 0; ai < edges.length; ai++) {
    const A = edges[ai];
    if (!A.elev || !A.prof || A.lock) continue;
    const p0 = nodes[A.a], p1 = nodes[A.b];
    const seen = new Set();
    for (let cx = Math.floor(Math.min(p0.x, p1.x) / CELL); cx <= Math.floor(Math.max(p0.x, p1.x) / CELL); cx++)
      for (let cz = Math.floor(Math.min(p0.z, p1.z) / CELL); cz <= Math.floor(Math.max(p0.z, p1.z) / CELL); cz++) {
        const l = grid.get(skey(cx, cz));
        if (!l) continue;
        for (const bi of l) {
          if (bi === ai || seen.has(bi)) continue;
          seen.add(bi);
          const B = edges[bi];
          if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) continue;
          const sin = Math.abs(A.dx * B.dz - A.dz * B.dx);
          if (sin < 0.26) continue;
          const r0 = nodes[B.a], r1 = nodes[B.b];
          const dd = (p1.x - p0.x) * (r1.z - r0.z) - (p1.z - p0.z) * (r1.x - r0.x);
          const t = ((r0.x - p0.x) * (r1.z - r0.z) - (r0.z - p0.z) * (r1.x - r0.x)) / dd;
          const u = ((r0.x - p0.x) * (p1.z - p0.z) - (r0.z - p0.z) * (p1.x - p0.x)) / dd;
          if (!(t > 0 && t < 1 && u > 0 && u < 1)) continue;
          if (B.elev) {
            const ya = p0.y + (p1.y - p0.y) * t, yb = r0.y + (r1.y - r0.y) * u;
            if (yb > ya || (yb === ya && bi < ai)) continue;
          }
          const cos = Math.abs(A.dx * B.dx + A.dz * B.dz);
          crossings.push({
            ai, bi, t, u,
            x: p0.x + (p1.x - p0.x) * t, z: p0.z + (p1.z - p0.z) * t,
            ext: Math.min(45, B.hw / sin + (A.hw * cos) / sin + 3),
          });
        }
      }
  }

  // --- solve ---
  const H = new Float64Array(F0);
  const f = new Float64Array(N), D = new Float64Array(N), C = new Float64Array(N);
  const Fg = new Float64Array(N);
  const hAt = (e, t) => {
    const x = t * e.pk, i = Math.min(e.pk - 1, Math.floor(x)), fr = x - i;
    return H[e.ps[i]] * (1 - fr) + H[e.ps[i + 1]] * fr;
  };
  let raised = 0, refused = 0;
  const refusedList = [];
  cityStats.refusedCrossings = refusedList;
  for (let pass = 0; pass < 3; pass++) {
    f.set(F0);
    raised = 0; refused = 0;
    for (const c of crossings) {
      const A = edges[c.ai], B = edges[c.bi];
      const under = B.prof ? hAt(B, c.u) : T(c.x, c.z) + ROAD_LIFT;
      const target = under + OVER_CLEAR;
      const sc = A.ps[Math.round(c.t * A.pk)];
      const rise = target - F0[sc];
      if (rise <= 0) continue;
      if (dFix[sc] - c.ext < rise / MAX_CLIMB) {
        refused++;
        // Kept for the underpass pass and for the harness: where, how short
        // of clearance, and what runs underneath.
        if (pass === 2) {
          refusedList.push({ x: c.x, z: c.z, ai: c.ai, bi: c.bi, u: c.u, rise: +rise.toFixed(2),
            under: B.cls + (B.prof ? (B.elev ? '/deck' : '/graded') : '/draped') });
        }
        continue;
      }
      raised++;
      // Per sample, not just at the crossing: the plateau spreads by graph
      // distance and can run through a node onto a branch right beside a
      // different anchor, where the same clearance is a 2 m step in 2.5 m.
      for (const j of around(sc, c.ext)) {
        if (fixed[j]) continue;
        const v = Math.min(target, F0[j] + MAX_CLIMB * dFix[j]);
        if (f[j] < v) f[j] = v;
      }
    }
    // Overlapping carriageways rise to each other's BASE floor, once. Taking
    // the neighbour's solved height from the previous pass instead ratcheted:
    // each pass raised a sample to a neighbour already raised by ITS
    // neighbour, so a cluster of parallel carriageways climbed to the highest
    // height anywhere in it. Measured: mean fill 0.68 -> 1.38 m, worst 15 m,
    // freeway 3 m grade breaks 1.53 % -> 2.01 % and 0.5 m jolts 156 -> 668.
    // ...and no higher than a climb out of the nearest anchor allows. A
    // coupled neighbour up to 2 m higher, beside a pinned at-grade node, is a
    // step with nowhere to ramp: 2.3 m inside 2.5 m at the first sample of a
    // deck, and verify's riders fell off it.
    for (let q = 0; q < couple.length; q += 2) {
      const i = couple[q], j = couple[q + 1];
      const v = Math.min(F0[j], capFix[i]);
      if (v > f[i]) f[i] = v;
    }
    for (let i = 0; i < N; i++) {
      if (fixed[i]) { D[i] = f[i]; continue; }
      let m = f[i];
      for (const j of around(i, PROF_R)) if (f[j] > m) m = f[j];
      D[i] = m;
    }
    C.set(D);
    // Seeded from the DILATED plateau, not just the raised samples. The cone
    // only pushes a neighbour whose value it raises, and inside the dilation
    // window every neighbour already holds the plateau height -- so seeded
    // from the raised samples alone it never got past the window's edge, and
    // the profile fell off a clearance plateau instead of easing down it: on
    // I-5 north of the ship canal a 56.09 m plateau dropped to 52.6 in one
    // sample and the ride went -2 % -> -11 % for 35 m.
    const st = [];
    for (let i = 0; i < N; i++) if (D[i] > F0[i] + 0.01) st.push(i);
    while (st.length) {
      const u = st.pop(), l = adj[u];
      for (let q = 0; q < l.length; q += 3) {
        const j = l[q], cand = C[u] - l[q + 2] * l[q + 1];
        if (cand > C[j] + 1e-4 && !fixed[j]) { C[j] = cand; st.push(j); }
      }
    }
    // The floor with its steps ramped: an overpass clearance is a plateau in
    // f with vertical edges, and wherever the cap below pulls the profile
    // down onto the floor, those edges become cliffs in the road. Measured
    // with max(f, cap) the real falls off a deck in verify's ride went 46 ->
    // 86. No floor step is steeper than FLOOR_RAMP once ramped, and the ramp
    // only ever raises.
    const FLOOR_RAMP = 0.15;
    Fg.set(f);
    {
      // Ramped from RAISED samples only -- clearance and coupling floors, the
      // ones with vertical edges. Ramping every sample lifted a steep imported
      // floor onto a 15 % line hung from its top and pushed the whole climb
      // against the pinned anchor: an 84 % first piece on the west-rim pier
      // decks. A continuous floor is left exactly as imported.
      const st = [];
      for (let i = 0; i < N; i++) if (f[i] > F0[i] + 0.01) st.push(i);
      while (st.length) {
        const u = st.pop(), l = adj[u];
        for (let q = 0; q < l.length; q += 3) {
          // Bounded by the same climb out of the nearest anchor that the
          // clearance floors obey, or the ramp itself lands on the pinned
          // node as the cliff: a street deck at (1913, 7020) stood 2.8 m
          // above its anchor 5 m in.
          const j = l[q];
          const cand = Math.min(Fg[u] - FLOOR_RAMP * l[q + 1], F0[j] + MAX_CLIMB * dFix[j]);
          if (cand > Fg[j] + 1e-4 && !fixed[j]) { Fg[j] = cand; st.push(j); }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      if (fixed[i]) { H[i] = fixVal[i]; continue; }
      let s = 0, sw = 0;
      for (const j of around(i, PROF_R)) { s += C[j] * W[j]; sw += W[j]; }
      const h = sw > 0 ? s / sw : C[i];
      // Out of an anchor the profile may climb no faster than GRADE_CAP
      // unless a floor demands it. A smoothstep taper used to do this job and
      // squeezed whatever the envelope added into its first ~20 m: 2-3 m of
      // rise within 9 m at deck ends, and verify's riders fell off them.
      H[i] = Math.max(Fg[i], Math.min(h, capFix[i]));
    }
  }

  // --- blend coupled carriageways ---
  // Coupling raises each overlapping pair to the other's base floor, but the
  // two are still solved as separate chains, and they came out up to ~0.2 m
  // apart where they overlap -- under the split-level band, so groundAt took
  // the higher one for a single step (+4.7 % on the I-5 ride at a three-way
  // merge). Coupled samples go to the mean of the pair (never below their own
  // ramped floor), eased out over half a window around them so the blend does
  // not end in a step of its own.
  if (couple.length) {
    const acc = new Float64Array(N), cnt = new Uint16Array(N);
    for (let q = 0; q < couple.length; q += 2) { acc[couple[q]] += H[couple[q + 1]]; cnt[couple[q]]++; }
    const Hb = new Float64Array(H);
    const near = new Uint8Array(N);
    // Bounded like the solve itself: never over the climb out of the nearest
    // anchor. Clamped only to the floor, the blend lifted deck starts back into
    // cliffs next to their junctions (verify's riders: 0 -> 13 falls).
    for (let i = 0; i < N; i++) {
      if (!cnt[i] || fixed[i]) continue;
      Hb[i] = Math.max(Fg[i], Math.min((H[i] + acc[i]) / (1 + cnt[i]), capFix[i]));
      for (const j of around(i, PROF_R)) near[j] = 1;
    }
    for (let i = 0; i < N; i++) {
      if (!near[i] || fixed[i]) continue;
      let s = 0, sw = 0;
      for (const j of around(i, PROF_R / 2)) { s += Hb[j] * W[j]; sw += W[j]; }
      H[i] = Math.max(Fg[i], Math.min(sw > 0 ? s / sw : Hb[i], capFix[i]));
    }
  }

  // Dev-only: the solver's intermediates per sample, for diagnosing a profile
  // (set globalThis.__profDebug before boot). Shipping builds carry nothing.
  if (globalThis.__profDebug) {
    for (const e of edges) {
      if (!e.prof) continue;
      const k = e.pk, dbg = { F0: [], f: [], Fg: [], C: [], H: [], cap: [], fixed: [], dFix: [] };
      for (let i = 0; i <= k; i++) {
        const v = e.ps[i];
        dbg.F0.push(+F0[v].toFixed(2)); dbg.f.push(+f[v].toFixed(2)); dbg.Fg.push(+Fg[v].toFixed(2));
        dbg.C.push(+C[v].toFixed(2)); dbg.H.push(+H[v].toFixed(2));
        dbg.cap.push(Number.isFinite(capFix[v]) ? +capFix[v].toFixed(2) : null);
        dbg.fixed.push(fixed[v]); dbg.dFix.push(Number.isFinite(dFix[v]) ? Math.round(dFix[v]) : null);
      }
      e.pdbg = dbg;
    }
  }

  // --- underpasses ---
  // An overpass the deck cannot climb to without a ski-jump (refused above)
  // is how real Seattle does it the other way round: the road underneath dips
  // into a cut. Along the lower road, a trench as deep as the missing
  // clearance runs under the deck and ramps out at UP_GRADE; world.js carves
  // it into the terrain (the same carve hook the portal cuts use) and stands
  // walls along it. A graded lower road has its profile lowered by the same
  // amount; a draped one follows the carved ground by itself. Skipped where
  // the dip would exceed UP_MAX or a junction falls inside it -- a street does
  // not meet another at the bottom of an underpass.
  const UP_MAX = 7;
  // Run-out grade by the lower road's class, eased in and out on a cosine: a
  // freeway dipping under a street on straight 10 % ramps kinked its profile at
  // both ends of every ramp (graded-ground grade breaks 1.66 % -> 2.65 %).
  const UP_GRADE = { hwy: 0.06, ramp: 0.08 };
  const underpasses = [];
  let upNoRoom = 0, upGraded = 0;
  for (const c of refusedList) {
    const A = edges[c.ai], B = edges[c.bi];
    const pa = nodes[A.a];
    const tA = clamp(((c.x - pa.x) * A.dx + (c.z - pa.z) * A.dz) / A.len, 0, 1);
    const deckH = hAt(A, tA);
    // Streets only. Dipping a graded freeway under a refused ramp was tried:
    // in the interchanges the cuts overlap, each chain's samples picked up its
    // neighbours' dips, and the lowered profiles stepped -- 0.5-2.8 m in 3 m,
    // ~400 of 522 half-metre jolts on graded freeway. Those crossings stay as
    // imported (counted in underpassGraded).
    if (B.prof) { upGraded++; continue; }
    const lower = T(c.x, c.z) + ROAD_LIFT;
    const dip = lower - (deckH - OVER_CLEAR);
    if (dip <= 0.2) continue;
    if (dip > UP_MAX) { upNoRoom++; continue; }
    const sin = Math.abs(A.dx * B.dz - A.dz * B.dx) || 1;
    const grade = UP_GRADE[B.cls] || 0.1;
    const plat = A.hw / sin + 3, reach = plat + (Math.PI * dip) / (2 * grade);
    // walk the lower road both ways from the crossing, straightest onward
    const pts = [{ x: c.x, z: c.z, s: 0 }];
    const chain = new Set([c.bi]);
    let blocked = false;
    for (const dir of [1, -1]) {
      let ei = c.bi, ni = dir > 0 ? B.b : B.a, s = (dir > 0 ? 1 - c.u : c.u) * B.len;
      let px0 = c.x, pz0 = c.z;
      const seenE = chain;
      while (true) {
        const n = nodes[ni];
        if (s <= plat + (reach - plat) * 0.5 && n.e.length > 2) { blocked = true; break; }
        const leg = { x: n.x, z: n.z, s: dir * Math.min(s, reach) };
        if (s >= reach) {
          const f = (reach - (s - Math.hypot(n.x - px0, n.z - pz0))) / Math.hypot(n.x - px0, n.z - pz0);
          leg.x = px0 + (n.x - px0) * f; leg.z = pz0 + (n.z - pz0) * f; leg.s = dir * reach;
          if (dir > 0) pts.push(leg); else pts.unshift(leg);
          break;
        }
        if (dir > 0) pts.push(leg); else pts.unshift(leg);
        const e = edges[ei];
        const ix = ni === e.b ? e.dx : -e.dx, iz = ni === e.b ? e.dz : -e.dz;
        let next = -1, best = 0.7;
        for (const oi of n.e) {
          if (seenE.has(oi)) continue;
          const o = edges[oi];
          // a street's cut stays on streets: graded roads are never lowered
          if (o.tunnel || o.elev || o.prof) continue;
          const ox = ni === o.a ? o.dx : -o.dx, oz = ni === o.a ? o.dz : -o.dz;
          const cc = ix * ox + iz * oz;
          if (cc > best) { best = cc; next = oi; }
        }
        // Running out of road before the dip has eased out -- onto a deck,
        // into a bore, a dead end -- would leave the cut ending in a cliff.
        if (next < 0) { blocked = true; break; }
        seenE.add(next);
        px0 = n.x; pz0 = n.z;
        ei = next;
        const o = edges[next];
        ni = o.a === ni ? o.b : o.a;
        s += o.len;
      }
      if (blocked) break;
    }
    if (blocked || pts.length < 2) { upNoRoom++; continue; }
    const hw = B.hw + walkWidth(B.cls) + 0.3;
    // A cut must not reach under a bridge's landing. The carve is a footprint,
    // not a road: by the West Seattle bridge it caught the street climbing to
    // another deck's anchor and dropped it 5 m under that deck.
    {
      const near = (x, z) => {
        for (let i = 0; i < pts.length - 1; i++) {
          const r = distToSeg(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
          if (r.d < hw + 4) return true;
        }
        return false;
      };
      const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
      const z0 = Math.min(...pts.map((p) => p.z)), z1 = Math.max(...pts.map((p) => p.z));
      let landing = false;
      for (let gx0 = Math.floor((x0 - 30) / CELL); gx0 <= Math.floor((x1 + 30) / CELL) && !landing; gx0++) {
        for (let gz0 = Math.floor((z0 - 30) / CELL); gz0 <= Math.floor((z1 + 30) / CELL) && !landing; gz0++) {
          const l = grid.get(skey(gx0, gz0));
          if (!l) continue;
          for (const oi of l) {
            const o = edges[oi];
            if (!o.elev || oi === c.ai) continue;
            for (const ni of [o.a, o.b]) {
              const n = nodes[ni];
              if (!n.elev && near(n.x, n.z)) { landing = true; break; }
            }
            if (landing) break;
          }
        }
      }
      if (landing) { upNoRoom++; continue; }
    }
    const up = { pts, dip, plat, reach, hw, bi: c.bi, chain,
      x0: Math.min(...pts.map((p) => p.x)) - hw - 2, x1: Math.max(...pts.map((p) => p.x)) + hw + 2,
      z0: Math.min(...pts.map((p) => p.z)) - hw - 2, z1: Math.max(...pts.map((p) => p.z)) + hw + 2 };
    underpasses.push(up);
  }
  const depthAlong = (up, s) => {
    const a2 = Math.abs(s);
    if (a2 <= up.plat) return up.dip;
    if (a2 >= up.reach) return 0;
    // cosine run-out: no grade break where the dip starts or where it ends
    const u = (a2 - up.plat) / (up.reach - up.plat);
    return up.dip * (1 + Math.cos(Math.PI * u)) / 2;
  };
  /** Carve depth at (x,z) from every underpass: full over the road, a 1.5 m bank. */
  // A 64 m bbox grid over them: this is inside the terrain carve, so every
  // terrainHeight() call -- chunk meshing, and every ground query a frame --
  // used to walk the whole list. `best` is a max, so order does not matter.
  const UP_CELL = 64, upGrid = new Map(), UP_NONE = [];
  for (const up of underpasses) {
    for (let cx = Math.floor(up.x0 / UP_CELL); cx <= Math.floor(up.x1 / UP_CELL); cx++) {
      for (let cz = Math.floor(up.z0 / UP_CELL); cz <= Math.floor(up.z1 / UP_CELL); cz++) {
        const k = skey(cx, cz);
        let l = upGrid.get(k);
        if (!l) upGrid.set(k, (l = []));
        l.push(up);
      }
    }
  }
  const underpassDepth = (x, z) => {
    let best = 0;
    const list = upGrid.get(skey(Math.floor(x / UP_CELL), Math.floor(z / UP_CELL))) || UP_NONE;
    for (const up of list) {
      if (x < up.x0 || x > up.x1 || z < up.z0 || z > up.z1) continue;
      for (let i = 0; i < up.pts.length - 1; i++) {
        const p = up.pts[i], q = up.pts[i + 1];
        const r = distToSeg(x, z, p.x, p.z, q.x, q.z);
        if (r.d > up.hw + 1.5) continue;
        const dd = depthAlong(up, p.s + (q.s - p.s) * r.t);
        const v = r.d <= up.hw ? dd : dd * (1 - (r.d - up.hw) / 1.5);
        if (v > best) best = v;
      }
    }
    return best;
  };
  // Every cut is under a draped street, which follows the carved ground by
  // itself -- nothing graded is lowered.
  cityStats.underpasses = underpasses.length;
  cityStats.underpassNoRoom = upNoRoom;
  cityStats.underpassGraded = upGraded;

  // --- publish ---
  for (const e of edges) {
    if (!e.prof) continue;
    const k = e.pk;
    e.ph = new Float32Array(k + 1);
    e.pg = new Float32Array(k + 1);
    const px = -e.dz, pz = e.dx;
    for (let i = 0; i <= k; i++) {
      const v = e.ps[i];
      e.ph[i] = H[v];
      if (!e.elev) e.pg[i] = clamp(gx[v] * px + gz[v] * pz, -CAMBER_MAX, CAMBER_MAX);
    }
  }

  // --- split levels ---
  // Carriageways run shoulder to shoulder and widths from lane counts make
  // them overlap by metres. Where two are the same level they are one surface
  // (coupling, above); where one really stands over the other by a street's
  // headroom it is a viaduct and stays. Between those -- 0.4 to 6 m apart --
  // the upper surface was drawn straight over the lower lanes: one road
  // poking through another, 90 % of what barrier-on-road counted, and the
  // sawtooth at I-5 downtown. Measured on the graded network before this pass:
  // ~19 km of carriageway overlapped a neighbour 0.4-2 m out of level and ~15
  // km overlapped one 2-6 m out.
  //
  // The upper one is trimmed back to the lower one's edge on that side (never
  // under TRIM_MIN of half-width) and world.js stands a retaining wall on the
  // cut. `e.tw` holds [left, right] half-widths per sample and `e.tlo` the
  // height of the road below a trimmed side (NaN where untrimmed).
  const TRIM_MIN = 3.0, SPLIT_LO = 0.4, SPLIT_HI = 6.0;
  let trimmedM = 0;
  const surfAt = (o, t, x, z) => {
    if (!o.prof) return T(x, z) + ROAD_LIFT;
    const P = profAt(o, t), oa = nodes[o.a];
    const cx = oa.x + o.dx * o.len * t, cz = oa.z + o.dz * o.len * t;
    return P.h + P.s * ((x - cx) * -o.dz + (z - cz) * o.dx);
  };
  for (const e of edges) {
    if (!e.prof) continue;
    const k = e.pk, a = nodes[e.a];
    e.tw = new Float32Array((k + 1) * 2).fill(e.hw);
    e.tlo = new Float32Array((k + 1) * 2).fill(NaN);
    // Sides with a near-parallel carriageway inside groundAt's catch fringe.
    // Such a side catches nothing past its drawn edge: along I-5's ramp decks a
    // neighbour 0.1-1 m higher -- too close in level to trim -- caught cars on
    // this deck with its 1.5 m fringe, the biggest class of samples standing off
    // their own drawn deck (136 of 181 at I-5 downtown).
    e.tnb = new Uint8Array((k + 1) * 2);
    const px = -e.dz, pz = e.dx;
    for (let i = 0; i <= k; i++) {
      const cx = a.x + e.dx * (e.len * i) / k, cz = a.z + e.dz * (e.len * i) / k;
      const seen = new Set();
      for (let gx0 = Math.floor((cx - 30) / CELL); gx0 <= Math.floor((cx + 30) / CELL); gx0++) {
        for (let gz0 = Math.floor((cz - 30) / CELL); gz0 <= Math.floor((cz + 30) / CELL); gz0++) {
          const l = grid.get(skey(gx0, gz0));
          if (!l) continue;
          for (const oi of l) {
            const o = edges[oi];
            if (o === e || seen.has(oi)) continue;
            seen.add(oi);
            // Sharing a node is not the same road: a ramp diverging from the
            // main line shares the diverge node and then runs alongside it for
            // tens of metres -- skipping every node-sharing pair left those
            // untrimmed, with the main line's fringe catching cars off the ramp
            // (the largest class of samples off their own drawn deck). Only the
            // joint itself, where the two centrelines are still under 1 m
            // apart, is the same road carrying on.
            const shares = o.a === e.a || o.a === e.b || o.b === e.a || o.b === e.b;
            // Converging at up to ~37 deg still puts the neighbour's lanes in
            // this side's catch fringe (a ramp merging onto a deck at 15-26
            // deg); only near-parallel pairs are candidates for the trim.
            const par = Math.abs(e.dx * o.dx + e.dz * o.dz);
            if (par < 0.8) continue;
            const oa = nodes[o.a];
            // Inclusive of the ends, with a little slack: where a sample sits
            // opposite a node of the neighbour, the foot lands on the endpoint
            // of BOTH edges meeting there, and a strict interior test skipped
            // it on both -- the neighbour's piece at that joint kept its full
            // 1.5 m fringe over this road's lanes.
            let u = ((cx - oa.x) * o.dx + (cz - oa.z) * o.dz) / o.len;
            if (u < -0.02 || u > 1.02) continue;
            u = Math.min(1, Math.max(0, u));
            const fx = oa.x + o.dx * o.len * u, fz = oa.z + o.dz * o.len * u;
            const dd = Math.hypot(cx - fx, cz - fz);
            if (shares && dd < 1.0) continue;
            const side = (fx - cx) * px + (fz - cz) * pz >= 0 ? 0 : 1;
            // Neighbour's edge inside this side's 1.5 m catch fringe, any level.
            if (dd - o.hw < e.hw + 1.5) e.tnb[i * 2 + side] = 1;
            if (par < 0.966 || e.hw + o.hw - dd < 0.5) continue;
            const sg = side === 0 ? 1 : -1;
            const mine = e.ph[i] + e.pg[i] * sg * Math.min(e.hw, dd);
            const lower = surfAt(o, u, cx + px * sg * Math.min(e.hw, dd), cz + pz * sg * Math.min(e.hw, dd));
            const gap = mine - lower;
            if (gap < SPLIT_LO || gap >= SPLIT_HI) continue;
            const w = Math.max(TRIM_MIN, dd - o.hw);
            if (w < e.tw[i * 2 + side]) {
              e.tw[i * 2 + side] = w;
              e.tlo[i * 2 + side] = Number.isNaN(e.tlo[i * 2 + side]) ? lower : Math.max(e.tlo[i * 2 + side], lower);
            }
          }
        }
      }
      for (let s = 0; s < 2; s++) if (e.tw[i * 2 + s] < e.hw) trimmedM += e.len / k / 2;
    }
  }
  cityStats.splitLevelTrimmedM = Math.round(trimmedM);

  let fillSum = 0, fillN = 0, worstFill = 0;
  for (const e of edges) {
    if (!e.prof) continue;
    const k = e.pk;
    const px = -e.dz, pz = e.dx;
    if (e.elev) continue;
    // Embankment either side: from the carriageway edge down at BERM to where
    // it meets the ground. [edgeY, width, toeY] per sample, left then right.
    e.pe = new Float32Array((k + 1) * 6);
    e.pwall = new Uint8Array((k + 1) * 2);
    let widest = 0;
    const a = nodes[e.a];
    for (let i = 0; i <= k; i++) {
      const cx = a.x + e.dx * (e.len * i) / k, cz = a.z + e.dz * (e.len * i) / k;
      const tc = T(cx, cz);
      fillSum += e.ph[i] - ROAD_LIFT - tc; fillN++;
      if (e.ph[i] - ROAD_LIFT - tc > worstFill) worstFill = e.ph[i] - ROAD_LIFT - tc;
      for (let s = 0; s < 2; s++) {
        const sg = s === 0 ? 1 : -1;
        // From the TRIMMED edge; a trimmed side has a wall to the road below
        // instead of a batter, so it carries no berm at all.
        const tw = e.tw[i * 2 + s], trimmed = !Number.isNaN(e.tlo[i * 2 + s]);
        const ex = cx + px * sg * tw, ez = cz + pz * sg * tw;
        const ey = e.ph[i] + e.pg[i] * sg * tw;
        const drop = ey - T(ex, ez);
        let w = !trimmed && drop > 0.05 ? drop * BERM : 0;
        let ty = T(ex + px * sg * w, ez + pz * sg * w) - 0.05;
        // What stands on this side is decided HERE, once, and roadLift and
        // world.meshGraded both read it. Under the batter's first metre or so:
        // another road at this level means tarmac is already there (no berm);
        // a lower one means the batter would sweep over its lanes, so a
        // retaining wall holds the fill instead (no berm either -- a wall has
        // no slope to stand on).
        if (w > 0) {
          const wm = Math.min(1.5, w / 2);
          const bx = ex + px * sg * wm, bz = ez + pz * sg * wm;
          let atLevel = false, below = false;
          for (let gx0 = Math.floor((bx - 25) / CELL); gx0 <= Math.floor((bx + 25) / CELL); gx0++) {
            for (let gz0 = Math.floor((bz - 25) / CELL); gz0 <= Math.floor((bz + 25) / CELL); gz0++) {
              const l = grid.get(skey(gx0, gz0));
              if (!l) continue;
              for (const oi of l) {
                const o = edges[oi];
                if (o === e) continue;
                const oa = nodes[o.a];
                const u = ((bx - oa.x) * o.dx + (bz - oa.z) * o.dz) / o.len;
                if (u <= 0 || u >= 1) continue;
                const dd = Math.hypot(bx - (oa.x + o.dx * o.len * u), bz - (oa.z + o.dz * o.len * u));
                if (dd > o.hw - 0.3) continue;
                const sy = surfAt(o, u, bx, bz);
                if (Math.abs(sy - ey) < 1.6) atLevel = true;
                else if (sy < ey && sy > ty - 0.3) below = true;
              }
            }
          }
          if (atLevel || below) {
            if (below && !atLevel) e.pwall[i * 2 + s] = 1;
            w = 0;
            ty = T(ex, ez) - 0.05;
          }
        }
        // ...and past that first metre, a batter STOPS at the next
        // carriageway it reaches, with its toe on that road's surface. Only the
        // first 1.5 m was tested, so a tall fill's batter ran on across the
        // lanes of the road beside it: drawn over them (in verge colours) and
        // reported by roadLift, so cars on that road rode the slope up to 3.7 m
        // above their own drawn tarmac at I-5 downtown.
        if (w > 1.5) {
          let hitD = Infinity, hitY = 0;
          for (let gx0 = Math.floor((ex - w - 25) / CELL); gx0 <= Math.floor((ex + w + 25) / CELL); gx0++) {
            for (let gz0 = Math.floor((ez - w - 25) / CELL); gz0 <= Math.floor((ez + w + 25) / CELL); gz0++) {
              const l = grid.get(skey(gx0, gz0));
              if (!l) continue;
              for (const oi of l) {
                const o = edges[oi];
                if (o === e || o.elev) continue;
                const oa = nodes[o.a], ob = nodes[o.b];
                for (let q = 1.5; q <= w && q < hitD; q += 0.5) {
                  const bx = ex + px * sg * q, bz = ez + pz * sg * q;
                  const r = distToSeg(bx, bz, oa.x, oa.z, ob.x, ob.z);
                  if (r.t <= 0 || r.t >= 1 || r.d > o.hw) continue;
                  hitD = q; hitY = surfAt(o, r.t, bx, bz);
                  break;
                }
              }
            }
          }
          if (hitD < w) {
            const line = ey + (ty - ey) * (hitD / w);
            ty = Math.min(line, hitY) - 0.05;
            w = hitD;
          }
        }
        e.pe[i * 6 + s * 3] = ey; e.pe[i * 6 + s * 3 + 1] = w; e.pe[i * 6 + s * 3 + 2] = ty;
        if (w > widest) widest = w;
      }
    }
    e.pbw = widest;
  }
  for (const [ni, v] of nodeVar) {
    const n = nodes[ni];
    n.ph = H[v];
    // A graded node's y is its road, as an elevated node's always was: the
    // surface is y + 0.09. A ground node on a 3 m fill left at terrain height
    // is a node three metres under its own carriageway, and anything starting
    // "at the node" -- a race marker, verify's deck rides -- starts inside the
    // embankment. At an anchor the profile IS the ground plus lift, so this
    // moves it 21 cm and nothing drawn from it (the square reads terrain).
    n.y = H[v] - ROAD_LIFT * 0.3;
  }
  cityStats.gradedSamples = N;
  cityStats.overpassesRaised = raised;
  cityStats.overpassesRefused = refused;
  cityStats.fillMean = +(fillSum / Math.max(1, fillN)).toFixed(2);
  cityStats.fillWorst = +worstFill.toFixed(2);
  return { underpasses, underpassDepth };
}

/** Profile height and cross-slope along a graded edge, at parameter t. */
function profAt(e, t) {
  const x = clamp(t, 0, 1) * e.pk;
  const i = Math.min(e.pk - 1, Math.floor(x)), fr = x - i;
  return {
    h: e.ph[i] * (1 - fr) + e.ph[i + 1] * fr,
    s: e.pg[i] * (1 - fr) + e.pg[i + 1] * fr,
    i, fr,
  };
}

// ---------------------------------------------------------------------------
// SR-99's stacked bore, in plan.
//
// OSM draws the double-deck tube as two one-way roads with centrelines 7.5-11 m
// apart and hw 7 each, so their carriageways overlap for ~2.8 km. Drawn that
// way they were two overlapping tubes at one level, and every workaround for
// that (walls dropped where they stand in the twin's lane, decks blended to a
// common floor, cells clipped against the twin's rectangle) left a symptom:
// the SB exit climbing through the NB interior, NB running open through the SB
// exit cutting, the twin's deck capturing a car. The real bore is one corridor
// with the decks DECK_SEP apart, so that is what gets built:
//
//   - a MIDLINE through the overlap, and every node of both tubes moved onto it
//     where they are stacked (citygen's profile then puts them DECK_SEP apart);
//   - at the NORTH portal (Aurora / Harrison) the two mouths sit side by side at
//     street level, as they do in life, so the tubes are held SIDE apart --
//     clear of each other -- for the first STACK_SPLIT m while the lower deck
//     dives under the upper, and only then merge onto the midline;
//   - at the SOUTH end the upper deck surfaces at its own portal (Royal
//     Brougham) straight off the stack, while the lower one carries on under
//     the upper's cutting and its approach to its own portal ~290 m further
//     south (the SODO portal), back on its own alignment.
//
// Done here, at load, before anything reads the edge vectors, so the graph is
// the single authority on where each deck runs -- traffic, groundAt, walls and
// the profile all see the stacked alignment. Portal nodes never move.
const STACK_SPLIT = 200;   // side by side this far from the north mouths
const STACK_MERGE = 120;   // ...then onto the midline over this far
function stackBores(g) {
  const { nodes, edges } = g;
  const inSet = (e) => e.tunnel && !e.elev && e.cls === 'hwy' && /State Route 99/.test(e.name || '');
  const isPortal = (ni) => nodes[ni].e.some((k) => !edges[k].tunnel);
  // chains: in at an entry portal, follow the one-way direction to the exit
  const chains = [];
  for (let ni = 0; ni < nodes.length; ni++) {
    if (!isPortal(ni)) continue;
    const out = nodes[ni].e.find((k) => inSet(edges[k]) && edges[k].a === ni && edges[k].oneway);
    if (out === undefined) continue;
    const ch = [ni];
    let cur = ni, seen = new Set([ni]);
    for (;;) {
      const k = nodes[cur].e.find((q) => inSet(edges[q]) && edges[q].a === cur && edges[q].oneway);
      if (k === undefined) break;
      cur = edges[k].b;
      if (seen.has(cur)) break;
      seen.add(cur); ch.push(cur);
      if (isPortal(cur)) break;
    }
    if (ch.length > 20 && isPortal(ch[ch.length - 1])) chains.push(ch);
  }
  if (chains.length !== 2) return null;
  // southbound on top: the chain whose exit is south (+z) of its entry
  const sb = (c) => nodes[c[c.length - 1]].z > nodes[c[0]].z;
  const up = chains.find(sb), lo = chains.find((c) => !sb(c));
  if (!up || !lo) return null;
  const hwU = edges[nodes[up[1]].e.find((k) => inSet(edges[k]))].hw;
  const hwL = edges[nodes[lo[1]].e.find((k) => inSet(edges[k]))].hw;
  const SIDE = hwU + hwL + 2.5;
  const orig = new Map();
  for (const ni of [...up, ...lo]) orig.set(ni, { x: nodes[ni].x, z: nodes[ni].z });
  const arc = (c) => {
    const s = [0];
    for (let i = 1; i < c.length; i++) {
      s.push(s[i - 1] + Math.hypot(nodes[c[i]].x - nodes[c[i - 1]].x, nodes[c[i]].z - nodes[c[i - 1]].z));
    }
    return s;
  };
  // nearest point on a polyline of {x, z}
  const project = (P, x, z) => {
    let best = null;
    for (let i = 0; i + 1 < P.length; i++) {
      const r = distToSeg(x, z, P[i].x, P[i].z, P[i + 1].x, P[i + 1].z);
      if (!best || r.d < best.d) best = { d: r.d, i, t: r.t, x: r.x, z: r.z };
    }
    return best;
  };
  // THE MIDLINE: halfway between the lower tube (sampled every 4 m) and the
  // nearest point of the upper, wherever the two are within 22 m.
  const upP = up.map((ni) => orig.get(ni)), loP = lo.map((ni) => orig.get(ni));
  const M = [];
  for (let i = 0; i + 1 < loP.length; i++) {
    const a = loP[i], b = loP[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 4));
    for (let k = 0; k < n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
      const q = project(upP, x, z);
      if (q.d < 22) M.push({ x: (x + q.x) / 2, z: (z + q.z) / 2 });
    }
  }
  if (M.length < 50) return null;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i + 1 < M.length; i++) {
      M[i] = { x: (M[i - 1].x + 2 * M[i].x + M[i + 1].x) / 4, z: (M[i - 1].z + 2 * M[i].z + M[i + 1].z) / 4 };
    }
  }
  const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const moved = new Set();
  const place = (c, isUp) => {
    const s = arc(c), tot = s[s.length - 1];
    for (let i = 1; i + 1 < c.length; i++) {
      const ni = c[i], o = orig.get(ni);
      // distance from this tube's own north / south portal
      const dN = isUp ? s[i] : tot - s[i], dS = isUp ? tot - s[i] : s[i];
      const q = project(M, o.x, o.z);
      if (!q || q.d > 25) continue;
      const A = M[q.i], B = M[q.i + 1];
      const L = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      const nx = -(B.z - A.z) / L, nz = (B.x - A.x) / L;
      const lat = (o.x - q.x) * nx + (o.z - q.z) * nz;
      const sg = lat >= 0 ? 1 : -1;
      // past the midline's end (the lower tube south of the upper's exit):
      // fade back onto its own alignment
      const atEnd = (q.i === M.length - 2 && q.t >= 1) || (q.i === 0 && q.t <= 0);
      const beyond = atEnd ? Math.hypot(o.x - q.x, o.z - q.z) : 0;
      // the mouths are 16.7-18 m apart already; held apart from the first node
      const a = sm((dN - 2) / 20);
      const b = sm((dN - STACK_SPLIT) / STACK_MERGE);
      const wS = isUp ? sm((dS - 5) / 40) : 1 - sm(beyond / 50);
      const sbx = q.x + nx * sg * (SIDE / 2), sbz = q.z + nz * sg * (SIDE / 2);
      let x = o.x + (sbx - o.x) * a, z = o.z + (sbz - o.z) * a;
      x += (q.x - x) * b; z += (q.z - z) * b;
      x = o.x + (x - o.x) * wS; z = o.z + (z - o.z) * wS;
      if (Math.hypot(x - o.x, z - o.z) < 0.01) continue;
      nodes[ni].x = x; nodes[ni].z = z;
      moved.add(ni);
    }
  };
  place(up, true);
  place(lo, false);
  // Ramps forking off a moved node (the lower deck's Republican St off-ramp,
  // its Royal Brougham on-ramp) carry the junction's shift, fading to nothing
  // along the ramp, so the fork keeps its shape.
  const chainSet = new Set([...up, ...lo]);
  const ramps = [];
  for (const J of [...moved]) {
    for (const k0 of nodes[J].e) {
      const e0 = edges[k0];
      if (!e0.tunnel || e0.elev || inSet(e0)) continue;
      const path = [J];
      let cur = J, k = k0, d = 0;
      const dists = [0];
      while (k !== undefined) {
        const e = edges[k];
        const nx = e.a === cur ? e.b : e.a;
        if (chainSet.has(nx) || path.includes(nx)) break;
        d += e.len; path.push(nx); dists.push(d); cur = nx;
        if (isPortal(nx)) break;
        k = nodes[nx].e.find((q) => q !== k && edges[q].tunnel && !edges[q].elev);
      }
      ramps.push({ path, dists });
      const oj = orig.get(J), dx = nodes[J].x - oj.x, dz = nodes[J].z - oj.z;
      const len = dists[dists.length - 1] || 1;
      for (let i = 1; i < path.length; i++) {
        if (isPortal(path[i])) continue;
        const f = Math.max(0, 1 - dists[i] / Math.min(80, len));
        nodes[path[i]].x += dx * f; nodes[path[i]].z += dz * f;
        if (f > 0) moved.add(path[i]);
      }
    }
  }
  const touched = new Set();
  for (const ni of moved) {
    // the ground over the new position: the profile's cover clamp reads it
    if (!nodes[ni].elev) nodes[ni].y = G.terrainHeight(nodes[ni].x, nodes[ni].z);
    for (const k of nodes[ni].e) touched.add(k);
  }
  for (const k of touched) {
    const e = edges[k], a = nodes[e.a], b = nodes[e.b];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    e.len = len; e.dx = dx / len; e.dz = dz / len;
  }
  for (const ni of up) nodes[ni].deck = 'upper';
  for (const ni of lo) nodes[ni].deck = 'lower';
  for (const k of edges.keys()) {
    const e = edges[k];
    if (!e.tunnel || e.elev) continue;
    const da = nodes[e.a].deck, db = nodes[e.b].deck;
    if (da && da === db) e.deck = da;
  }
  for (const r of ramps) {
    for (let i = 1; i < r.path.length; i++) {
      for (const k of nodes[r.path[i]].e) if (edges[k].tunnel && !edges[k].elev && !edges[k].deck) edges[k].deck = nodes[r.path[0]].deck;
    }
  }
  let worst = 0;
  for (const ni of moved) {
    const o = orig.get(ni);
    if (o) worst = Math.max(worst, Math.hypot(nodes[ni].x - o.x, nodes[ni].z - o.z));
  }
  cityStats.stackMoved = moved.size;
  cityStats.stackWorstShift = +worst.toFixed(1);
  return { up, lo, ramps, hwU, hwL };
}

export function* cityGenerator(md) {
  yield { p: 0.02, msg: 'Unpacking the street graph' };

  // --- 1. Road graph ------------------------------------------------------
  const R = md.roads;
  const nodes = new Array(R.nodeCount);
  let reheighted = 0, worstReheight = 0;
  for (let i = 0; i < R.nodeCount; i++) {
    const elev = R.nElev[i] !== 0;
    let y = R.ny[i];
    // Re-read a ground node's height from the ONE height surface.
    //
    // build_roads.py bakes node heights with a bilinear sample, and its comment
    // still claims that matches geo.terrainHeight() -- which it did until
    // terrainHeight was changed to interpolate the way the terrain MESH is
    // triangulated, to stop grass showing through the road. The two differ by
    // (a + d - b - c) / 4 on a 40 m cell, which on Seattle's grades reaches
    // 1.18 m: junction squares are drawn at n.y while groundAt stands you at
    // terrainHeight, so you sank into your own crossroads by over a metre.
    //
    // Done here rather than in the importer for the same reason roadFit() is:
    // the correction travels with the geometry and cannot go stale against a
    // re-import. Elevated nodes keep their baked height -- that is a deck, not
    // the ground under it.
    if (!elev) {
      const t = G.terrainHeight(R.nx[i], R.nz[i]);
      const d = Math.abs(t - y);
      if (d > 0.01) { reheighted++; if (d > worstReheight) worstReheight = d; }
      y = t;
    }
    nodes[i] = { x: R.nx[i], z: R.nz[i], y, elev, e: [] };
  }
  cityStats.nodesReheighted = reheighted;
  cityStats.worstReheight = +worstReheight.toFixed(2);
  const edges = new Array(R.edgeCount);
  for (let i = 0; i < R.edgeCount; i++) {
    const a = R.ea[i], b = R.eb[i];
    const na = nodes[a], nb = nodes[b];
    const dx = nb.x - na.x, dz = nb.z - na.z;
    const len = Math.hypot(dx, dz) || 1;
    const cls = CLS_NAME[R.ecls[i]] || 'res';
    const fl = R.eflags[i];
    const nameId = R.ename[i];
    edges[i] = {
      a, b, cls,
      name: nameId === 0xFFFF ? null : R.names[nameId],
      hw: R.ehw[i] || CLASS_HW[cls],
      spd: CLASS_SPEED[cls] || 12,
      len, dx: dx / len, dz: dz / len,
      elev: (fl & F_ELEV) !== 0,
      tunnel: (fl & F_TUNNEL) !== 0,
      oneway: (fl & F_ONEWAY) !== 0,
      onewayRev: (fl & F_ONEWAY_REV) !== 0,
    };
    na.e.push(i);
    nb.e.push(i);
  }
  const g = { nodes, edges };
  // One bore, two decks: SR-99's twin OSM ways onto a shared alignment.
  const stack = stackBores(g);
  yield { p: 0.3, msg: 'Opening the streets' };

  // --- 2. Buildings -------------------------------------------------------
  // Oriented boxes fitted to real OSM footprints, streamed straight out of the
  // packed file. There is no lot generation, no road-clearance test and no
  // tower placement search: a real footprint is already clear of a real road.
  const B = md.buildings;
  const buildings = [];
  const REC = 12;
  const built = new Float32Array(B.nx * B.nz); // per-chunk cover, for the ground tint
  for (let cj = 0; cj < B.nz; cj++) {
    for (let ci = 0; ci < B.nx; ci++) {
      const k = cj * B.nx + ci;
      const from = B.dir[k], to = B.dir[k + 1];
      const ox = -G.MAP_HALF + ci * CHUNK - 200;
      const oz = -G.MAP_HALF + cj * CHUNK - 200;
      let area = 0;
      for (let o = from; o < to; o += REC) {
        const x = ox + B.blob.getUint16(o, true) / 10;
        const z = oz + B.blob.getUint16(o + 2, true) / 10;
        const w = B.blob.getUint16(o + 4, true) / 20;
        const d = B.blob.getUint16(o + 6, true) / 20;
        const h = B.blob.getUint16(o + 8, true) / 20;
        const rot = (B.blob.getUint8(o + 10) * Math.PI) / 256;
        const cls = B.blob.getUint8(o + 11);
        area += w * d;
        buildings.push({
          x, z, w, d, rot, h,
          y: G.terrainHeight(x, z),
          style: styleFor(cls, h, w, d),
          seed: (hash2(Math.round(x), Math.round(z)) * 65536) | 0,
          kind: null,
        });
      }
      built[k] = clamp(area / (CHUNK * CHUNK), 0, 1);
    }
    if (cj % 6 === 0) yield { p: 0.3 + 0.5 * (cj / B.nz), msg: 'Raising the skyline' };
  }

  // --- 2b. Keep buildings out of the carriageway ---------------------------
  //
  // This pass came back after being deleted. The reasoning for deleting it --
  // "a real footprint is not standing in a real road, because the road is real
  // too" -- is true of the FOOTPRINT and false of what actually ships, which is
  // the footprint's minimum-area oriented rectangle. An L-shaped or U-shaped
  // building's bounding box covers the notch, and if a street runs through that
  // notch the box lands squarely on it. Measured on the built data: 11,131
  // boxes (8.9%) overlapped a carriageway and 8,290 of them by more than 3 m,
  // including a 274 x 68 m box sitting 38 m into I-5. That is what "so many
  // roads are blocked" was, and it is what made the freeway impassable.
  //
  // Deliberately a runtime pass over the shipped boxes rather than a filter in
  // the importer: the road graph is right there, so the fix travels with the
  // geometry it is correcting and cannot go stale against a re-import.
  const FIT_CELL = 60;
  const fitGrid = new Map();
  for (let ei = 0; ei < g.edges.length; ei++) {
    const e = g.edges[ei];
    // A bridge passes over, and a tunnel under, so neither blocks anything --
    // and a building above a tunnel is where buildings normally are.
    if (e.elev || e.tunnel) continue;
    const a = g.nodes[e.a], b = g.nodes[e.b];
    const x0 = Math.floor((Math.min(a.x, b.x) - e.hw) / FIT_CELL);
    const x1 = Math.floor((Math.max(a.x, b.x) + e.hw) / FIT_CELL);
    const z0 = Math.floor((Math.min(a.z, b.z) - e.hw) / FIT_CELL);
    const z1 = Math.floor((Math.max(a.z, b.z) + e.hw) / FIT_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = skey(cx, cz);
        let l = fitGrid.get(k);
        if (!l) fitGrid.set(k, (l = []));
        l.push(ei);
      }
    }
  }

  /**
   * Scale in (0,1] that pulls a box clear of every carriageway near it, or 0
   * if it cannot be saved.
   *
   * The box is measured as the rotated rectangle it is, via its support
   * function `|hw*(u.n)| + |hd*(v.n)|` along the line to each road. A bounding
   * circle cannot do this job: one large enough to contain the rectangle
   * rejects half a block, and anything smaller lets the corners stand in the
   * road, which is the bug the original version of this was written for.
   *
   * Only the carriageway is cleared, not the pavement. Real buildings front the
   * pavement -- that is what a pavement is for -- and clearing it too would
   * shrink most of downtown for no gain in drivability.
   */
  const CLEAR_MARGIN = 0.8;
  const roadFit = (x, z, w, d, rot) => {
    const hw = w / 2, hd = d / 2;
    const rad = Math.hypot(hw, hd);
    const ux = Math.cos(rot), uz = Math.sin(rot);
    const vx = -Math.sin(rot), vz = Math.cos(rot);
    let fit = 1;
    const c0 = Math.floor((x - rad) / FIT_CELL), c1 = Math.floor((x + rad) / FIT_CELL);
    const d0 = Math.floor((z - rad) / FIT_CELL), d1 = Math.floor((z + rad) / FIT_CELL);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = d0; cz <= d1; cz++) {
        const l = fitGrid.get(skey(cx, cz));
        if (!l) continue;
        for (const ei of l) {
          const e = g.edges[ei];
          const a = g.nodes[e.a], b = g.nodes[e.b];
          const r = distToSeg(x, z, a.x, a.z, b.x, b.z);
          const room = r.d - e.hw - CLEAR_MARGIN;
          if (room <= 0) return 0; // the centre itself is in the road
          if (r.d > rad + e.hw) continue;
          const nx = (x - r.x) / r.d, nz = (z - r.z) / r.d;
          const reach = Math.abs(hw * (ux * nx + uz * nz)) + Math.abs(hd * (vx * nx + vz * nz));
          if (reach > room) fit = Math.min(fit, room / reach);
        }
      }
    }
    return fit;
  };

  const MIN_SIDE = 4.0; // below this it is a kiosk, not a building
  let shrunk = 0, dropped = 0;
  for (let bi = buildings.length - 1; bi >= 0; bi--) {
    const bd = buildings[bi];
    const fit = roadFit(bd.x, bd.z, bd.w, bd.d, bd.rot);
    if (fit >= 1) continue;
    // Shrink to fit rather than dropping where possible: a block that came out
    // as one big box legitimately overlaps the road, and deleting it empties
    // the whole block instead of putting a smaller building on it.
    if (fit > 0 && bd.w * fit >= MIN_SIDE && bd.d * fit >= MIN_SIDE) {
      bd.w *= fit;
      bd.d *= fit;
      shrunk++;
    } else {
      buildings.splice(bi, 1);
      dropped++;
    }
  }
  cityStats.buildingsShrunk = shrunk;
  cityStats.buildingsDropped = dropped;

  // --- 2c. Landmarks get their site to themselves -------------------------
  //
  // We draw our own Space Needle, and OSM has a building footprint for it as
  // well -- 38 x 38 m, tagged 184 m tall. Imported as an ordinary tower it
  // lands on exactly the same spot and encloses the hand-built mesh, which is
  // where the Space Needle went. Same for the stadiums, the Market and the
  // locks. `reserved` did this job before the import rewrite and was dropped on
  // the reasoning that "towers are just buildings" -- true of towers, false of
  // anything we model ourselves.
  let landmarkCleared = 0;
  // A LANDMARK_CLEAR entry is a radius round the landmark's position, or a
  // list of [dx, dz, r] circles offset from it (world axes) for a landmark
  // whose model is not centred on its OSM point -- the Market's sign and
  // clock stand 220 m from the node that names it.
  const clearAt = [];
  for (const l of G.LANDMARKS) {
    const spec = LANDMARK_CLEAR[l.kind];
    const x0 = l.p ? l.p[0] : l.x, z0 = l.p ? l.p[1] : l.z;
    if (Array.isArray(spec)) for (const [dx, dz, r] of spec) clearAt.push([x0 + dx, z0 + dz, r]);
    else clearAt.push([x0, z0, spec || 55]);
  }
  for (const [lx, lz, r] of clearAt) {
    for (let bi = buildings.length - 1; bi >= 0; bi--) {
      const bd = buildings[bi];
      const dx = lx - bd.x, dz = lz - bd.z;
      if (dx * dx + dz * dz > (r + 90) * (r + 90)) continue;
      // Nearest point of the rotated box to the landmark centre.
      const c = Math.cos(-bd.rot), s = Math.sin(-bd.rot);
      const px = dx * c - dz * s, pz = dx * s + dz * c;
      const qx = clamp(px, -bd.w / 2, bd.w / 2);
      const qz = clamp(pz, -bd.d / 2, bd.d / 2);
      if ((px - qx) ** 2 + (pz - qz) ** 2 < r * r) {
        buildings.splice(bi, 1);
        landmarkCleared++;
      }
    }
  }
  cityStats.landmarkCleared = landmarkCleared;

  // Nothing may stand where the player gets put down. Inside a footprint,
  // blocked() refuses every direction and the player is stuck for good, walking
  // on the spot -- and 1.5 m inside a facade there is no visual clue why.
  const CLEAR = 2.2; // player's collision half-width, plus room to turn around
  for (let bi = buildings.length - 1; bi >= 0; bi--) {
    const bd = buildings[bi];
    const c = Math.cos(-bd.rot), s = Math.sin(-bd.rot);
    for (const p of G.KEEP_CLEAR) {
      const dx = p.x - bd.x, dz = p.z - bd.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < bd.w / 2 + CLEAR && Math.abs(lz) < bd.d / 2 + CLEAR) {
        buildings.splice(bi, 1);
        break;
      }
    }
  }

  yield { p: 0.88, msg: 'Indexing the city' };

  // --- 3. Chunk index ------------------------------------------------------
  const chunks = new Map();
  const ck = (cx, cz) => cx * 100003 + cz;
  const getChunk = (cx, cz) => {
    const k = ck(cx, cz);
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { cx, cz, edges: [], buildings: [] }));
    return c;
  };
  for (let ei = 0; ei < g.edges.length; ei++) {
    const e = g.edges[ei];
    const a = g.nodes[e.a], b = g.nodes[e.b];
    const x0 = Math.floor(Math.min(a.x, b.x) / CHUNK), x1 = Math.floor(Math.max(a.x, b.x) / CHUNK);
    const z0 = Math.floor(Math.min(a.z, b.z) / CHUNK), z1 = Math.floor(Math.max(a.z, b.z) / CHUNK);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) getChunk(cx, cz).edges.push(ei);
  }
  for (let bi = 0; bi < buildings.length; bi++) {
    const bd = buildings[bi];
    getChunk(Math.floor(bd.x / CHUNK), Math.floor(bd.z / CHUNK)).buildings.push(bi);
  }

  // Tarmac counts as built-up too. Keyed on footprints alone, a freeway corridor
  // has no buildings in it and came out as bright green meadow -- the I-5 trench
  // through Chinatown was a lawn. Adding the paved area per chunk makes "urban"
  // mean buildings OR pavement, which is what it should have meant.
  const HALF_CHUNKS = B.nx / 2;
  for (let ei = 0; ei < g.edges.length; ei++) {
    const e = g.edges[ei];
    const a = g.nodes[e.a], b = g.nodes[e.b];
    const ci = Math.floor((a.x + b.x) / 2 / CHUNK) + HALF_CHUNKS;
    const cj = Math.floor((a.z + b.z) / 2 / CHUNK) + HALF_CHUNKS;
    if (ci < 0 || ci >= B.nx || cj < 0 || cj >= B.nz) continue;
    built[cj * B.nx + ci] = Math.min(1, built[cj * B.nx + ci]
      + (e.len * e.hw * 2) / (CHUNK * CHUNK));
  }

  // --- 3.9 Tunnel vertical profiles ---------------------------------------
  //
  // Tunnels have always been in the graph but never in the WORLD: their nodes
  // carried ground heights and nothing drew a bore, so SR-99 and the Mount
  // Baker tunnels read as surface roads through the buildings above them --
  // or, once their drawing was suppressed, as gaps.
  //
  // A bore's profile: PORTALS (nodes where a tunnel edge meets a surface
  // edge) sit at grade. Interior nodes take the graph-distance interpolation
  // between their two nearest portals -- the chord through the hill -- pushed
  // down to at least CLEAR below the terrain above them so the bore never
  // breaks the surface mid-hill. Near a portal the clearance requirement is
  // relaxed over RELAX metres, because the ground there IS the portal cut.
  {
    const CLEAR = 7;
    const tunNodes = new Set();
    for (const e of g.edges) if (e.tunnel && !e.elev) { tunNodes.add(e.a); tunNodes.add(e.b); }
    const portals = new Set();
    for (const ni of tunNodes) {
      const n = g.nodes[ni];
      if (n.e.some((ei) => !g.edges[ei].tunnel)) portals.add(ni);
    }
    // A PORTAL DOES NOT SIT AT STREET LEVEL. Left at grade, the cutting can
    // only begin where the bore does, so everything you can see on the
    // approach is flat road and the trench is a foreshortened sliver at the
    // horizon -- judged three times as "there is no cutting; the road never
    // goes down or under anything". Dropping the portal itself puts the ramp
    // in FRONT of the mouth, where a driver is looking: the surface road
    // descends into a walled channel, then the headwall.
    //
    // The surface approach follows automatically. The cut is part of
    // terrainHeight now (geo.setCarve), and meshRoad draws its strips from
    // terrainHeight, so lowering the ground along the approach lowers the road
    // on it without touching a single road vertex.
    const PORTAL_DROP = 5;
    for (const ni of portals) g.nodes[ni].y -= PORTAL_DROP;

    // multi-source Dijkstra over tunnel edges, tracking the two nearest
    // DISTINCT portals per node
    const best = new Map();   // ni -> [{p, d}, {p, d}]
    const heap = [];
    for (const p of portals) { heap.push([0, p, p]); }
    heap.sort((a, b) => a[0] - b[0]);
    const seen = new Set();
    while (heap.length) {
      heap.sort((a, b) => a[0] - b[0]);
      const [d, ni, src] = heap.shift();
      const key = ni + '|' + src;
      if (seen.has(key)) continue;
      seen.add(key);
      let b2 = best.get(ni);
      if (!b2) best.set(ni, (b2 = []));
      // DISTINCT ENDS, NOT DISTINCT NODES. The northbound SR-99 tube surfaces
      // through TWO portals at each end -- the main line and a ramp ~30 m
      // beside it -- so its "two nearest portals" were the same mouth twice,
      // and the chord between them was flat: -11.9 for the whole southern half
      // and +9 for the northern half, joined by a 21 m cliff mid-bore at the
      // node where the nearest pair flipped. The southbound tube, with one
      // portal per end, profiled correctly, so the twins disagreed by up to
      // 5 m and each walled the other's lane. A second portal only counts if
      // it is a different mouth.
      const sameMouth = (q) => {
        const pa = g.nodes[q], pb = g.nodes[src];
        return Math.hypot(pa.x - pb.x, pa.z - pb.z) < 150;
      };
      if (!b2.some((x) => sameMouth(x.p))) {
        if (b2.length < 2) b2.push({ p: src, d });
        else continue;
      }
      for (const ei of g.nodes[ni].e) {
        const e = g.edges[ei];
        if (!e.tunnel) continue;
        const other = e.a === ni ? e.b : e.a;
        heap.push([d + e.len, other, src]);
      }
    }
    let profiled = 0, worstDrop = 0;
    const groundY = new Map(), portalDist = new Map();
    for (const ni of tunNodes) {
      if (portals.has(ni)) continue;         // portals stay at grade
      const n = g.nodes[ni];
      const b2 = best.get(ni) || [];
      let y;
      if (b2.length >= 2) {
        const [A, B] = b2;
        const ya = g.nodes[A.p].y, yb = g.nodes[B.p].y;
        y = ya + (yb - ya) * (A.d / (A.d + B.d));
      } else if (b2.length === 1) {
        // one reachable portal (a stub clipped by the map edge): shallow dive
        y = g.nodes[b2[0].p].y - Math.min(12, b2[0].d * 0.05);
      } else {
        continue;                            // isolated fragment: leave as-is
      }
      // DESCEND AT A REAL GRADE FROM THE PORTAL. Interpolating portal-to-
      // portal over a 3 km bore leaves the first 100 m within a metre of grade,
      // so the tunnel's walls and ceiling were drawn standing on flat ground --
      // a concrete box in the open, which is what the north SR-99 portal was.
      // 5.5 % gets under the hill in about 130 m, which is both drivable and
      // what a real portal approach does.
      //
      // BUT 5.5 % ON FLAT GROUND IS NOT A PORTAL YOU CAN SEE. world.js closes
      // the bore only where the ground covers it -- roof plus 0.4 m, so 5.8 m
      // of cut -- and at 5.5 % that boundary is 105 m from the mouth. Standing
      // at the mouth you were looking down a shallow trench with the tunnel
      // starting somewhere out of sight: no entrance to drive into, which is
      // exactly what the north SR-99 portal looked like. The first stretch
      // dives at 9 % (steep, but real portal approaches are: SR-99's own is
      // about 8 %) until it is 8 m down, which brings the mouth to ~65 m --
      // inside the frame from the approach, and legible from a car.
      const dPortal = b2.length ? b2[0].d : 1e9;
      const portalY = b2.length ? g.nodes[b2[0].p].y : n.y;
      // THE MOUTH IS LEVEL. Starting the dive at the portal node puts a 9 %
      // break in the road exactly where you drive in, which reads as a floor
      // that is not flat -- the surface road arrives at grade and the deck
      // pitches away from under it in the same metre. APRON metres of level
      // deck carry the grade change back inside the bore, where a car is
      // already committed and nothing outside has to line up with it.
      // ...but LEVEL IS NOT AN OPTION EITHER. A dead-flat apron sits at grade
      // while the ground beside it keeps rising, so the terrain mesh comes up
      // through the tunnel deck a few metres inside the mouth -- a wedge of
      // hillside lying across the carriageway you are about to drive onto.
      // The apron is a gentle 6 % instead: enough to stay under the terrain the
      // whole way in, shallow enough that the road does not break at the mouth
      // the way a 9 % ramp starting at the portal node did.
      // Steep enough that the cutting is deep where you can still see it. A
      // 6 % approach put the portal 60 m away at the bottom of a 2 m scrape;
      // a judge scoring the render called the cut depth "essentially zero".
      // 9 % from the kerb, 13 % once clear of the apron, to 12 m.
      // 9 % from the kerb, 13 % once clear of the apron, to 12 m. Steeper was
      // tried -- 15/19 % -- to make the retaining walls tall enough to read as
      // walls rather than as pale ribbons on the ground. It does that and
      // costs more than it buys: the bore reaches its cover so fast that the
      // cutting is over before it starts, and the headwall ends up buried out
      // of sight of the approach. The walls are a geometry problem, not a
      // gradient one.
      const APRON = 10;
      // THE CAP GOES AROUND THE WHOLE DIVE. max(0.09 d, min(0.13 d, 12))
      // caps only the second branch: the 9 % floor grows without bound, so a
      // node a kilometre from its nearest portal was driven 90 m underground
      // -- phantom bores at -93 under downtown in a tunnel whose real floor
      // is -16, found by probing a mid-ride stall that sat 2 m from one.
      const dive = Math.min(12, Math.max(0.09 * dPortal,
        0.13 * Math.max(0, dPortal - APRON)));
      // DIVE BELOW THE CHORD, NOT BELOW THE NEAREST PORTAL. `portalY - dive`
      // is only continuous while both portals sit at the same height, and
      // SR-99's do not: the north mouth is at 21 m, the south at 0.1. At the
      // node where the nearest portal flips, the clamp jumped from 21 - 12 =
      // 9 to 0.1 - 12 = -11.9 -- a 21 m cliff inside the bore, 50 m long,
      // measured riding the southbound tube at (-206, 207) -> (-178, 253),
      // and at a different station in each tube because their portals are
      // staggered, so the twin decks disagreed by metres over hundreds of
      // metres and each tube's walls stood in the other's lane. The chord
      // between the two portals is continuous by construction, and once the
      // dive is capped (past ~100 m) the flip between nearest portals is too.
      // Near a mouth the chord is within ~0.4 m of the portal itself, so the
      // approach profile is unchanged. A stub with one portal has no chord.
      let yFinal = b2.length >= 2 ? y - dive : Math.min(y, portalY - dive);
      // Past the approach, never break the surface mid-hill. Inside it, the
      // GEOMETRY decides: world.js draws an open cut until the ground closes
      // over the bore, so there is nothing to clamp here.
      // The clamp and the portal cutting have to MEET. Inside the approach the
      // geometry decides (world.js carves an open cut); past it the bore must
      // be genuinely buried. At 80 m there was a gap: corridors reach roughly
      // 50-70 m at these grades, so between the two the roof sat inside the
      // ground with the terrain surface passing through the bore -- earth
      // across the carriageway with an unlined hole in it, which portalcheck
      // counts as a sliced bore.
      if (dPortal > 50) yFinal = Math.min(yFinal, n.y - CLEAR);
      if (n.y - yFinal > worstDrop) worstDrop = n.y - yFinal;
      groundY.set(ni, n.y);
      portalDist.set(ni, dPortal);
      n.y = yFinal;
      n.tunnel = true;
      profiled++;
    }

    // THE LOWER DECK RUNS DECK_SEP UNDER THE UPPER ONE (see stackBores). The
    // upper (southbound) deck keeps the profile it was given above -- dive from
    // its portals, chord between them, cover clamp -- which is the one the SB
    // rides were proven on. The lower deck is held DECK_SEP under it wherever
    // the two tubes' carriageways overlap in plan, and under the upper's
    // approach cutting past its south portal, where the lower carries on
    // beneath the trench floor. That is a ceiling, so it only ever LOWERS the
    // deck; a grade cone (LO_GRADE) carries it back up to its own profile
    // towards its mouths, so the north mouths still meet side by side at
    // street level and the lower deck is under the upper by the time the
    // tubes merge onto the midline.
    const stackNodes = new Set();
    if (stack) {
      const LO_GRADE = 0.10;
      const { up, lo, ramps, hwU, hwL } = stack;
      for (const ni of [...up, ...lo]) stackNodes.add(ni);
      for (const r of ramps) for (const ni of r.path.slice(1)) stackNodes.add(ni);
      const upY = up.map((ni) => g.nodes[ni].y);
      // the upper's approach beyond its south portal: the cutting's floor there
      // starts at the portal's height, so the lower deck stays DECK_SEP under
      // that for the approach's length
      const upEnd = g.nodes[up[up.length - 1]];
      const upPre = g.nodes[up[up.length - 2]];
      const ux = upEnd.x - upPre.x, uz = upEnd.z - upPre.z, uL = Math.hypot(ux, uz) || 1;
      const reach = hwU + hwL + 1;
      // The lower deck's distance from its north mouth: from STACK_SPLIT on
      // the tubes merge in plan, so it must already be DECK_SEP down there
      // rather than start diving once the carriageways overlap -- which put
      // the NB wall 0.2 m into the SB shoulder at the start of the merge.
      const loS = [0];
      for (let i = 1; i < lo.length; i++) {
        loS.push(loS[i - 1] + Math.hypot(g.nodes[lo[i]].x - g.nodes[lo[i - 1]].x, g.nodes[lo[i]].z - g.nodes[lo[i - 1]].z));
      }
      const loTot = loS[loS.length - 1];
      const cap = lo.map((ni, li) => {
        const n = g.nodes[ni];
        let best = null;
        for (let i = 0; i + 1 < up.length; i++) {
          const a = g.nodes[up[i]], b = g.nodes[up[i + 1]];
          const r = distToSeg(n.x, n.z, a.x, a.z, b.x, b.z);
          if (!best || r.d < best.d) best = { d: r.d, y: upY[i] + (upY[i + 1] - upY[i]) * r.t };
        }
        const merging = loTot - loS[li] >= STACK_SPLIT - 20 && best && best.d < reach + 10;
        let c = best && (best.d < reach || merging) ? best.y - DECK_SEP : Infinity;
        const al = ((n.x - upEnd.x) * ux + (n.z - upEnd.z) * uz) / uL;
        const lt = Math.abs(((n.x - upEnd.x) * -uz + (n.z - upEnd.z) * ux) / uL);
        if (al >= 0 && al < 90 && lt < reach) c = Math.min(c, upEnd.y - DECK_SEP);
        return c;
      });
      const s = [0];
      for (let i = 1; i < lo.length; i++) {
        const a = g.nodes[lo[i - 1]], b = g.nodes[lo[i]];
        s.push(s[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
      }
      const own = lo.map((ni) => g.nodes[ni].y);
      const y0 = own.map((y, i) => Math.min(y, cap[i]));
      // cone: no steeper than LO_GRADE out of any capped point
      // (out of the CAPPED points only: the deck's own mouth dive is steeper
      // than LO_GRADE and is left exactly as it was)
      const yc = y0.map((_, i) => {
        let m = y0[i];
        for (let j = 0; j < lo.length; j++) {
          if (cap[j] < own[j]) m = Math.min(m, cap[j] + LO_GRADE * Math.abs(s[i] - s[j]));
        }
        return m;
      });
      // and a 25 m triangular smoothing of the cone's kinks, never above the
      // cap or the deck's own (cover-clamped) profile
      let deepest = 0;
      const yl = yc.map((_, i) => {
        if (i === 0 || i === lo.length - 1) return yc[i];
        let sw = 0, sy = 0, lowered = false;
        for (let j = 0; j < lo.length; j++) {
          const w = 1 - Math.abs(s[i] - s[j]) / 25;
          if (w > 0) { sw += w; sy += w * yc[j]; if (yc[j] < own[j] - 0.01) lowered = true; }
        }
        // untouched stretches (the mouths) keep their own profile exactly
        if (!lowered) return own[i];
        return Math.min(sy / sw, cap[i], own[i]);
      });
      // BETWEEN NODES TOO. Both decks are straight between their own nodes,
      // so the lower one clearing the upper at every LOWER node is not enough:
      // where the upper deck kinks between two of them -- the foot of the SB
      // exit ramp at z 1612 -- the lower's chord passed 0.6 m closer, and the
      // upper's trench floor sliced the lower bore (portalcheck). Each upper
      // node is checked against the lower chord under it and both ends are
      // lowered by any shortfall.
      for (let pass = 0; pass < 3; pass++) {
        for (let j = 1; j < up.length; j++) {
          const u = g.nodes[up[j]];
          let bi = -1, bt = 0, bd = 1e9;
          for (let i = 0; i + 1 < lo.length; i++) {
            const a = g.nodes[lo[i]], b = g.nodes[lo[i + 1]];
            const r = distToSeg(u.x, u.z, a.x, a.z, b.x, b.z);
            if (r.d < bd) { bd = r.d; bi = i; bt = r.t; }
          }
          if (bi < 0 || bd >= reach || bt <= 0 || bt >= 1) continue;
          const short = (1 - bt) * yl[bi] + bt * yl[bi + 1] - (upY[j] - DECK_SEP);
          if (short <= 0.005) continue;
          if (bi > 0) yl[bi] -= short;
          if (bi + 1 < lo.length - 1) yl[bi + 1] -= short;
        }
      }
      for (let i = 1; i + 1 < lo.length; i++) {
        deepest = Math.max(deepest, own[i] - yl[i]);
        g.nodes[lo[i]].y = yl[i];
      }
      // ramps forking off the lower deck follow their junction, fading out
      // along the ramp to its own portal
      for (const r of ramps) {
        const J = r.path[0], k = lo.indexOf(J);
        if (k < 0) continue;
        const dy = yl[k] - own[k];
        const len = r.dists[r.dists.length - 1] || 1;
        for (let i = 1; i < r.path.length; i++) {
          if (portals.has(r.path[i])) continue;
          g.nodes[r.path[i]].y += dy * Math.max(0, 1 - r.dists[i] / len);
        }
      }
      cityStats.stackLowered = +deepest.toFixed(1);
      if (globalThis.__profDebug) globalThis.__stackDbg = lo.map((ni, i) => [ni, Math.round(s[i]), +own[i].toFixed(2), +cap[i].toFixed(2), +yc[i].toFixed(2), +yl[i].toFixed(2)]);
    }

    // THE TWIN TUBES SHARE ONE FLOOR. OSM maps SR-99's double-deck bore as two
    // ways whose carriageways overlap for ~2.8 km (world.inOtherBore has the
    // numbers), and each is profiled from its OWN portals -- staggered 290 m at
    // the south end -- so side by side their decks disagreed by 1.3-2.4 m over
    // most of downtown. That is a kerb-sized step across the middle of one
    // shared hole, the drawn walls cannot open onto it, and riding either tube
    // the player's car was captured by the twin's deck and pinned against the
    // twin's wall: 15 and 12 failures end to end. Where a node stands on
    // another tube's carriageway, the two are pulled to their mean -- fully
    // while they are within 3 m, tapering to untouched by 5 m, so a tube diving
    // to its own mouth beside a twin that is still deep keeps its profile.
    // Blended from the pre-pass heights so the result is order-independent.
    {
      const comp = new Map();
      let nc = 0;
      for (const s of tunNodes) {
        if (comp.has(s)) continue;
        const st = [s];
        comp.set(s, nc);
        while (st.length) {
          const ni = st.pop();
          for (const k of g.nodes[ni].e) {
            const e = g.edges[k];
            if (!e.tunnel || e.elev) continue;
            const o = e.a === ni ? e.b : e.a;
            if (!comp.has(o)) { comp.set(o, nc); st.push(o); }
          }
        }
        nc++;
      }
      const y0 = new Map();
      for (const ni of tunNodes) y0.set(ni, g.nodes[ni].y);
      const tEdges = [];
      for (let k = 0; k < g.edges.length; k++) {
        const e = g.edges[k];
        if (e.tunnel && !e.elev) tEdges.push(k);
      }
      let blended = 0;
      for (const ni of tunNodes) {
        if (portals.has(ni) || !groundY.has(ni) || stackNodes.has(ni)) continue;
        const n = g.nodes[ni];
        let hwN = 0;
        for (const k of n.e) if (g.edges[k].tunnel) hwN = Math.max(hwN, g.edges[k].hw);
        let near = null;
        for (const k of tEdges) {
          const e = g.edges[k];
          if (comp.get(e.a) === comp.get(ni) || e.deck) continue;
          const a = g.nodes[e.a], b = g.nodes[e.b];
          const reach = hwN + e.hw;
          if (n.x < Math.min(a.x, b.x) - reach || n.x > Math.max(a.x, b.x) + reach
            || n.z < Math.min(a.z, b.z) - reach || n.z > Math.max(a.z, b.z) + reach) continue;
          const r = distToSeg(n.x, n.z, a.x, a.z, b.x, b.z);
          if (r.d > reach) continue;
          if (!near || r.d < near.d) {
            near = { d: r.d, y: y0.get(e.a) + (y0.get(e.b) - y0.get(e.a)) * r.t };
          }
        }
        if (!near) continue;
        const dy = near.y - y0.get(ni);
        const w = 0.5 * clamp((5 - Math.abs(dy)) / 2, 0, 1);
        if (w <= 0) continue;
        let yb = y0.get(ni) + dy * w;
        if (portalDist.get(ni) > 50) yb = Math.min(yb, groundY.get(ni) - CLEAR);
        n.y = yb;
        blended++;
      }
      cityStats.tunnelTwinBlended = blended;
    }
    cityStats.tunnelNodes = profiled;
    cityStats.tunnelWorstDepth = +worstDrop.toFixed(1);
  }

  // --- 4. Elevated deck surfaces for vehicle physics -----------------------
  //
  // ...and tunnel decks, which are the same contract from below: a drivable
  // surface at the edge's own heights that groundAt's nearest-deck rule picks
  // when you are down there and ignores when you are on the street above.
  yield { p: 0.92, msg: 'Grading the freeways' };
  const grading = gradeRoads(g.nodes, g.edges);

  const surfaces = [];
  const isPortal = (ni) => g.nodes[ni].e.some((ei) => !g.edges[ei].tunnel);
  for (let sei = 0; sei < g.edges.length; sei++) {
    const e = g.edges[sei];
    // A graded road is a deck to groundAt, one piece per profile sample, so a
    // car rides the profile that is drawn rather than the terrain under it --
    // every wheel sample, not just the centre whose lift was scanned. Ground
    // freeways carry their cross-slope as `sa`/`sb` across (px, pz).
    if (e.prof) {
      const a = g.nodes[e.a];
      const px = -e.dz, pz = e.dx;
      const continued = (ni) => g.nodes[ni].e.some((oi) => g.edges[oi] !== e && g.edges[oi].prof);
      const ca = continued(e.a), cb = continued(e.b);
      const margin = e.elev ? 1.5 : 0.4;
      for (let i = 0; i < e.pk; i++) {
        const s0 = (e.len * i) / e.pk, s1 = (e.len * (i + 1)) / e.pk;
        // Per-side extents. A side trimmed off a lower neighbour catches
        // nothing past its drawn edge: its old fringe stood over the lower
        // lanes, where it picked cars up onto a surface a metre or more above
        // them with nothing drawn there.
        const sideOf = (j, s) => {
          const trimmed = !Number.isNaN(e.tlo[j * 2 + s]) || !Number.isNaN(e.tlo[(j + 1) * 2 + s]);
          const crowded = e.tnb[j * 2 + s] || e.tnb[(j + 1) * 2 + s];
          return Math.max(e.tw[j * 2 + s], e.tw[(j + 1) * 2 + s]) + (trimmed || crowded ? 0 : margin);
        };
        // The pieces either side, for the 3 m this one extrapolates past its
        // ends: that ground belongs to them. With its own untrimmed extent the
        // extrapolation reached over a neighbour's trimmed piece and caught
        // cars on the road beside it (ramp decks at I-5 downtown).
        const prev = i > 0 ? i - 1 : i, next = i < e.pk - 1 ? i + 1 : i;
        // Per-END extents too: the drawn edge line runs straight from one
        // sample's trimmed width to the next, so inside the piece the catch
        // follows it rather than the wider end (which caught cars off the
        // road beside a trim that narrows along the piece).
        const endOf = (j, s) => e.tw[j * 2 + s] + (!Number.isNaN(e.tlo[j * 2 + s]) || e.tnb[j * 2 + s] ? 0 : margin);
        surfaces.push({
          wl: sideOf(i, 0), wr: sideOf(i, 1),
          la: endOf(i, 0), lb: endOf(i + 1, 0), ra: endOf(i, 1), rb: endOf(i + 1, 1),
          wl0: Math.min(sideOf(i, 0), sideOf(prev, 0)), wr0: Math.min(sideOf(i, 1), sideOf(prev, 1)),
          wl1: Math.min(sideOf(i, 0), sideOf(next, 0)), wr1: Math.min(sideOf(i, 1), sideOf(next, 1)),
          ax: a.x + e.dx * s0, az: a.z + e.dz * s0, ay: e.ph[i] - ROAD_LIFT * 0.3,
          bx: a.x + e.dx * s1, bz: a.z + e.dz * s1, by: e.ph[i + 1] - ROAD_LIFT * 0.3,
          // A deck catches 1.5 m past its edge, as it always has. Pulling
          // that in to the drawn parapet (hw + 0.6) was tried to stop parallel
          // decks' fringes picking cars up, and bought little -- samples more
          // than 10 cm off the drawn deck at I-5 downtown went 182 -> 166 of
          // 1656 -- while by SR-99's north portal the carved ramp falls away
          // under a locked deck and the later capture left verify's approach
          // walk 2.5 m under it, where master catches it.
          hw: e.elev ? e.hw + 1.5 : e.hw + 0.4,
          sa: e.pg[i], sb: e.pg[i + 1], px, pz,
          // Continued ends: another piece -- of this edge, or the graded
          // edge carrying on through the node -- answers past them (see
          // groundAt). An at-grade end may extend; the square takes over.
          in0: i > 0 || ca, in1: i < e.pk - 1 || cb,
          tun: false, mouth: false, ei: sei, pi: i,
        });
      }
      continue;
    }
    if (!e.elev && !e.tunnel) continue;
    const a = g.nodes[e.a], b = g.nodes[e.b];
    surfaces.push({ ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, hw: e.hw + 1.5,
      tun: !!e.tunnel, ei: sei,
      // a MOUTH is the first span of a bore -- one end is a portal node
      mouth: !!e.tunnel && (isPortal(e.a) || isPortal(e.b)) });
  }
  const surfCell = 120;
  const surfGrid = new Map();
  for (let si = 0; si < surfaces.length; si++) {
    const s = surfaces[si];
    const x0 = Math.floor((Math.min(s.ax, s.bx) - s.hw) / surfCell), x1 = Math.floor((Math.max(s.ax, s.bx) + s.hw) / surfCell);
    const z0 = Math.floor((Math.min(s.az, s.bz) - s.hw) / surfCell), z1 = Math.floor((Math.max(s.az, s.bz) + s.hw) / surfCell);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const k = skey(cx, cz);
        let l = surfGrid.get(k);
        if (!l) surfGrid.set(k, (l = []));
        l.push(si);
      }
  }

  // --- 5. Building collision index ----------------------------------------
  const bCell = 60;
  const bGrid = new Map();
  for (let bi = 0; bi < buildings.length; bi++) {
    const bd = buildings[bi];
    const r = Math.max(bd.w, bd.d) * 0.75;
    const x0 = Math.floor((bd.x - r) / bCell), x1 = Math.floor((bd.x + r) / bCell);
    const z0 = Math.floor((bd.z - r) / bCell), z1 = Math.floor((bd.z + r) / bCell);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const k = skey(cx, cz);
        let l = bGrid.get(k);
        if (!l) bGrid.set(k, (l = []));
        l.push(bi);
      }
  }

  // --- 6. Node spatial index for AI ---------------------------------------
  const nCell = 150;
  const nGrid = new Map();
  for (let ni = 0; ni < g.nodes.length; ni++) {
    const n = g.nodes[ni];
    const k = skey(Math.floor(n.x / nCell), Math.floor(n.z / nCell));
    let l = nGrid.get(k);
    if (!l) nGrid.set(k, (l = []));
    l.push(ni);
  }

  const drivable = [];
  for (let ei = 0; ei < g.edges.length; ei++) if (g.edges[ei].len > 15) drivable.push(ei);

  yield { p: 0.96, msg: 'Waking the city' };

  // --- Lift-query indices (roadLift / nodeSurface) -------------------------
  //
  // Built lazily on the first query, after gradeRoads, stackBores and every
  // other load-time pass have fixed widths, batters and node positions. Both
  // are exact: see roadLift.
  const LIFT_CELL = 32;
  let liftGrid = null;
  const liftCell = (x, z) => {
    if (!liftGrid) {
      liftGrid = new Map();
      for (let ei = 0; ei < g.edges.length; ei++) {
        const e = g.edges[ei];
        // A tunnel draws no surface and a deck lifts nothing here (both answer
        // through groundAt), so neither is a candidate -- as in the old scan.
        if (e.elev || e.tunnel) continue;
        const reach = (e.prof ? e.hw + (e.pbw || 0) : e.hw + walkWidth(e.cls) + VERGE) + 0.01;
        const a = g.nodes[e.a], b = g.nodes[e.b];
        const x0 = Math.floor((Math.min(a.x, b.x) - reach) / LIFT_CELL);
        const x1 = Math.floor((Math.max(a.x, b.x) + reach) / LIFT_CELL);
        const z0 = Math.floor((Math.min(a.z, b.z) - reach) / LIFT_CELL);
        const z1 = Math.floor((Math.max(a.z, b.z) + reach) / LIFT_CELL);
        const lim = reach + LIFT_CELL * 0.7072;   // cells the segment reaches; see roadCell
        for (let cx = x0; cx <= x1; cx++) {
          for (let cz = z0; cz <= z1; cz++) {
            if (distToSeg((cx + 0.5) * LIFT_CELL, (cz + 0.5) * LIFT_CELL, a.x, a.z, b.x, b.z).d > lim) continue;
            const k = skey(cx, cz);
            let l = liftGrid.get(k);
            if (!l) liftGrid.set(k, (l = []));
            l.push(ei);
          }
        }
      }
    }
    return liftGrid.get(skey(Math.floor(x / LIFT_CELL), Math.floor(z / LIFT_CELL)));
  };
  // onRoad's grid: EVERY edge (tunnels and decks too, as the chunk scan had),
  // under its bbox grown by the farthest onRoad can answer true for it.
  const ROAD_PAD_MAX = 2.5;
  let roadGrid = null, roadReachMax = 0;
  const roadCell = (x, z) => {
    if (!roadGrid) {
      roadGrid = new Map();
      for (let ei = 0; ei < g.edges.length; ei++) {
        const e = g.edges[ei];
        const reach = e.hw + (e.pbw || 0) + ROAD_PAD_MAX + 0.01;
        if (reach > roadReachMax) roadReachMax = reach;
        const a = g.nodes[e.a], b = g.nodes[e.b];
        const x0 = Math.floor((Math.min(a.x, b.x) - reach) / LIFT_CELL);
        const x1 = Math.floor((Math.max(a.x, b.x) + reach) / LIFT_CELL);
        const z0 = Math.floor((Math.min(a.z, b.z) - reach) / LIFT_CELL);
        const z1 = Math.floor((Math.max(a.z, b.z) + reach) / LIFT_CELL);
        // Only cells the padded SEGMENT reaches, not its whole bbox: downtown's
        // grid runs 32 deg off the axes, and a diagonal edge's bbox filed it
        // under cells it passes nowhere near -- every one a candidate every
        // query there had to test. Centre distance within reach plus the cell's
        // half-diagonal is a superset of every cell the reach touches.
        const lim = reach + LIFT_CELL * 0.7072;
        for (let cx = x0; cx <= x1; cx++) {
          for (let cz = z0; cz <= z1; cz++) {
            if (distToSeg((cx + 0.5) * LIFT_CELL, (cz + 0.5) * LIFT_CELL, a.x, a.z, b.x, b.z).d > lim) continue;
            const k = skey(cx, cz);
            let l = roadGrid.get(k);
            if (!l) roadGrid.set(k, (l = []));
            l.push(ei);
          }
        }
      }
    }
    return roadGrid.get(skey(Math.floor(x / LIFT_CELL), Math.floor(z / LIFT_CELL)));
  };
  // Per node: null where world.meshNode draws no square, else its half-size,
  // orientation and ring width -- the same rules meshNode applies.
  let nodeSqCache = null;
  const nodeSq = (ni) => {
    if (!nodeSqCache) nodeSqCache = new Array(g.nodes.length);
    let q = nodeSqCache[ni];
    if (q !== undefined) return q;
    q = null;
    const n = g.nodes[ni];
    // world.meshNode draws no square at a graded node that is not an at-grade
    // junction (the strips are mitred into one another there), nor at a dead end.
    if (!(n.elev || (n.prof && !n.anchor)) && n.e.length >= 2) {
      let hw = 0, rot = 0, sw = 0;
      for (const ei of n.e) {
        const e = g.edges[ei];
        // Mirrors world.meshNode: a tunnel draws no surface, so it must not
        // size the crossing square nor lift anything standing on it.
        if (e.tunnel) continue;
        if (e.hw > hw) { hw = e.hw; rot = Math.atan2(e.dx, -e.dz); }
        sw = Math.max(sw, walkWidth(e.cls));
      }
      if (hw > 0) q = { hw, sw, c: Math.cos(rot), s: Math.sin(rot) };
    }
    nodeSqCache[ni] = q;
    return q;
  };

  // Build the query grids now, during loading, rather than on the first
  // query: the first road meshed after boot used to pay ~15 ms for them.
  liftCell(0, 0);
  roadCell(0, 0);

  // carriagewayAt's test for one edge, and the chunk scan whose order decides
  // which road it returns. Only the INTERIOR of a segment counts; see there.
  const cwHit = (ei, x, z, y, tol) => {
    const e = g.edges[ei];
    if (e.tunnel) return false;
    const a = g.nodes[e.a], b = g.nodes[e.b];
    const r = distToSeg(x, z, a.x, a.z, b.x, b.z);
    if (r.t <= 0.001 || r.t >= 0.999 || r.d > e.hw - 0.3) return false;
    let sy;
    if (e.prof) {
      const P = profAt(e, r.t);
      const lat = (x - r.x) * -e.dz + (z - r.z) * e.dx;
      // A graded road's carriageway ends at its trimmed edge on that side.
      const s = lat >= 0 ? 0 : 1;
      const sw = e.tw[P.i * 2 + s] * (1 - P.fr) + e.tw[(P.i + 1) * 2 + s] * P.fr;
      if (r.d > sw - 0.3) return false;
      sy = P.h + P.s * lat;
    } else {
      sy = G.terrainHeight(x, z) + ROAD_LIFT;
    }
    return Math.abs(sy - y) < tol;
  };
  const cwScan = (x, z, y, skip, tol) => {
    const c0 = Math.floor((x - MAX_HW) / CHUNK), c1 = Math.floor((x + MAX_HW) / CHUNK);
    const d0 = Math.floor((z - MAX_HW) / CHUNK), d1 = Math.floor((z + MAX_HW) / CHUNK);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = d0; cz <= d1; cz++) {
        const c = chunks.get(ck(cx, cz));
        if (!c) continue;
        for (const ei of c.edges) {
          // The edge index + 1, so a caller that needs to know WHICH road
          // (a median barrier drawn once for a pair) can have it and
          // everyone else can treat it as a boolean.
          if (ei !== skip && cwHit(ei, x, z, y, tol)) return ei + 1;
        }
      }
    }
    return 0;
  };

  /** A graded road's drawn surface (profile + camber) at (x, z), bias aside. */
  const gradedY = (e, x, z) => {
    const a = g.nodes[e.a];
    const t = ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len;
    const P = profAt(e, t);
    return P.h + P.s * ((x - a.x) * -e.dz + (z - a.z) * e.dx);
  };
  const drawnY = (e, x, z) => (e.prof ? gradedY(e, x, z) : G.terrainHeight(x, z) + ROAD_LIFT);

  return {
    nodes: g.nodes,
    edges: g.edges,
    buildings,
    chunks,
    chunkKey: ck,
    drivable,
    surfaces,

    /** Underpass cuts dug under refused overpasses (see gradeRoads). */
    underpasses: grading.underpasses,
    /** Carve depth of every underpass at (x,z); world.js adds it to the carve. */
    underpassDepth: grading.underpassDepth,
    /** Does this 40 m terrain cell touch an underpass? (re-tessellated like a portal cell) */
    underpassCell(cx, cz, S) {
      if (!grading.underpasses.length) return false;
      for (let j = 0; j <= 2; j++) {
        for (let i = 0; i <= 2; i++) {
          if (grading.underpassDepth(cx + (i * S) / 2, cz + (j * S) / 2) > 0.05) return true;
        }
      }
      return false;
    },

    /**
     * How built-up the ground is at (x,z), 0..1, from the footprint area packed
     * into each 400 m chunk. world.js blends the terrain tint across it, which
     * is what makes the map read as a city from above -- and unlike the district
     * rectangles it replaces, it follows the actual edge of the built area.
     */
    builtAt(x, z) {
      const ci = Math.floor((x + G.MAP_HALF) / CHUNK);
      const cj = Math.floor((z + G.MAP_HALF) / CHUNK);
      if (ci < 0 || ci >= B.nx || cj < 0 || cj >= B.nz) return 0;
      return built[cj * B.nx + ci];
    },

    /**
     * Is edge `ei`'s carriageway at (x,z) already paved by a road that outranks
     * it?
     *
     * Far rarer than it was -- real carriageways don't overlap the way the
     * hand-drawn arterials overlapped the district grids -- but a motorway and
     * its parallel frontage road still share ground, and two full-width surfaces
     * in the same place each paint their own centre line, so the depth buffer
     * picks a winner per pixel per frame and the markings flicker. Rank is width
     * first then edge order, so the pairing is antisymmetric and exactly one of
     * any overlapping pair draws. Only the surface is dropped -- the edge stays
     * in the graph and traffic still routes over it.
     */
    roadCoveredAt(x, z, ei) {
      const me = g.edges[ei];
      if (!me || me.elev) return false;
      // Candidates from the fine grid (see roadCell): an edge can only cover
      // (x,z) where the point is within its own hw + 0.5 of it, far inside the
      // grid's reach, so the answer is the old 3x3-chunk scan's -- which was
      // 30 % of a downtown chunk build after onRoad moved to the grid.
      const cand = roadCell(x, z);
      if (!cand) return false;
      {
        {
          for (let q = 0; q < cand.length; q++) {
            const oi = cand[q];
            if (oi === ei) continue;
            const o = g.edges[oi];
            if (o.elev) continue;
            // Dead since tunnels stopped being drawn at all (world.meshRoad
            // returns before either caller reaches here), and kept only so the
            // rule is written down if a bore is ever rendered: a tunnel must
            // never be
            // the thing that suppresses the street above it.
            if (o.tunnel && !me.tunnel) continue;
            const surfaceWins = me.tunnel && !o.tunnel;
            if (!surfaceWins && (o.hw < me.hw || (o.hw === me.hw && oi > ei))) continue;
            // Near-parallel only. Two roads crossing at a junction each have the
            // other's centre inside their width, and neither is redundant.
            if (!surfaceWins && Math.abs(me.dx * o.dx + me.dz * o.dz) < 0.93) continue;
            const a = g.nodes[o.a], b = g.nodes[o.b];
            const d = distToSeg(x, z, a.x, a.z, b.x, b.z).d;
            // Containment, not centreline proximity. The old test skipped this
            // road whenever its CENTRE fell inside the other's width -- but a
            // motorway's half-width spans several lanes, so every ramp running
            // beside it qualified and 30% of all ramp segments were drawn with
            // no tarmac at all. That is what made the freeway impassable: you
            // took an off-ramp and there was nothing under you. A road is only
            // redundant where its whole width is inside the other's.
            if (!(surfaceWins ? d <= o.hw : d + me.hw <= o.hw + 0.5)) continue;
            // Two GRADED roads are only one surface where they are at one
            // level. A ramp still inside the main line's width just past its
            // diverge has already climbed away from it (coupling skips the
            // first 30 m along the graph), and dropping its tarmac there left
            // groundAt carrying cars on a ramp 0.1-1 m over the drawn main
            // line -- with nothing drawn under them.
            // Same for a graded ramp over a wider draped street.
            if ((me.prof || o.prof) && Math.abs(drawnY(me, x, z) - drawnY(o, x, z)) > 0.05) continue;
            return true;
          }
        }
      }
      return false;
    },

    roadLift(x, z) {
      // A junction square is drawn at NODE_LIFT and covers the ends of every
      // strip that meets there, so inside one it IS the surface -- take it
      // outright rather than maxing against the strips the scan below reports.
      const ns = this.nodeSurface(x, z);
      if (ns && ns.inSquare) return ns.lift;

      let lift = 0, wlift = 0, vlift = 0, onCw = false;
      // THE CANDIDATES COME FROM A FINE GRID, not a 3x3-chunk scan. That scan
      // is a 1.2 km square: downtown it walked several hundred edges per call,
      // each through an allocating distToSeg, at ~50 calls a frame (one per car
      // and pedestrian). Measured on the phone profile driving I-5 it was
      // 31.7 us a call, 1.57 ms a frame -- the largest single query in the
      // loop. liftCell lists every edge whose bbox, grown by the farthest this
      // function can reach from it (carriageway + pavement + verge, or
      // carriageway + batter), touches the cell, so every edge that can lift
      // (x,z) is a candidate and the answer is identical. Tunnels (no surface
      // drawn) and decks (groundAt's job) are never in it, as before.
      const cand = liftCell(x, z);
      if (cand) {
        {
          for (let q = 0; q < cand.length; q++) {
            const e = g.edges[cand[q]];
            const a = g.nodes[e.a], b = g.nodes[e.b];
            // distToSeg inline: no object per edge in the hottest loop.
            const sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz;
            let rt = l2 > 0 ? ((x - a.x) * sx + (z - a.z) * sz) / l2 : 0;
            rt = rt < 0 ? 0 : rt > 1 ? 1 : rt;
            const rx = a.x + sx * rt, rz = a.z + sz * rt;
            const rd = Math.hypot(x - rx, z - rz);
            if (e.prof) {
              // On the carriageway a graded road answers through groundAt's
              // deck query, per sample and with its camber. Off it, the
              // embankment world.meshGraded draws: a straight batter from
              // the carriageway edge to the toe, mirrored exactly here.
              if (rd > e.hw + e.pbw || rt <= 0 || rt >= 1) continue;
              const side = ((x - rx) * -e.dz + (z - rz) * e.dx) >= 0 ? 0 : 3;
              const P = profAt(e, rt), o6 = P.i * 6 + side, o7 = o6 + 6;
              // From the trimmed edge on this side (split levels).
              const sw = e.tw[P.i * 2 + side / 3] * (1 - P.fr) + e.tw[(P.i + 1) * 2 + side / 3] * P.fr;
              if (rd <= sw) { onCw = true; continue; }
              const ey = e.pe[o6] * (1 - P.fr) + e.pe[o7] * P.fr;
              const w = e.pe[o6 + 1] * (1 - P.fr) + e.pe[o7 + 1] * P.fr;
              const ty = e.pe[o6 + 2] * (1 - P.fr) + e.pe[o7 + 2] * P.fr;
              if (w <= 0 || rd - sw >= w) continue;
              const l = ey + (ty - ey) * ((rd - sw) / w) - G.terrainHeight(x, z);
              if (l > lift) lift = l;
              continue;
            }
            const ww = walkWidth(e.cls), outer = e.hw + ww;
            // (interior only: past an end the clamped distance is a round cap,
            // which the junction square and ring already answer for)
            if (rd <= e.hw && rt > 0 && rt < 1) onCw = true;
            if (ww > 0) {
              // A pavement is flat to its outer edge and then comes down to
              // the ground on the verge world.meshRoad draws: WALK_LIFT to 0
              // across VERGE. It used to taper to nothing inside the slab's
              // last RAMP metres while the slab was drawn flat to its edge,
              // then stop -- an open 52 cm step to the grass.
              if (rd > outer + VERGE) continue;
              if (rd > outer) {
                const vl = WALK_LIFT * (1 - (rd - outer) / VERGE);
                if (vl > vlift) vlift = vl;
                continue;
              }
              if (rd <= e.hw) { if (ROAD_LIFT > lift) lift = ROAD_LIFT; }
              else if (WALK_LIFT > wlift) wlift = WALK_LIFT;
              continue;
            }
            if (rd > outer) continue;
            let l = ROAD_LIFT;
            if (rd > outer - RAMP) l *= (outer - rd) / RAMP;
            if (l > lift) lift = l;
          }
        }
      }
      // Neither a pavement nor its verge lifts another road's carriageway:
      // world.meshRoad drops every pavement piece and verge that would lie on
      // one, so there the road is the surface. Taken wherever it overlapped,
      // the 52 cm slab stood you 22 cm above the drawn tarmac of the road
      // beside it (until now hidden by the slab's tapered edge).
      if (onCw) { wlift = 0; vlift = 0; }
      lift = Math.max(lift, wlift);
      // The pavement ring around a junction reaches past the end of every strip
      // -- its diagonal corners especially, which no radiating edge comes near.
      //
      // Only where the scan found NOTHING. Taking the ring wherever it is
      // higher was tried and is wrong: nodeSurface reports the ring as a plain
      // box, but meshNode cuts the ring into pieces and DROPS the ones covering
      // each approach road, so over an approach the ring is reported and not
      // drawn -- the override floated you above the carriageway there and moved
      // sink 11.8% -> 12.44%. Fixing this properly means teaching nodeSurface
      // the approach-dropping that meshNode does; until then the empty-scan test
      // is the conservative approximation.
      if (ns && lift <= 0) return Math.max(ns.lift, vlift);
      return Math.max(lift, vlift);
    },

    /**
     * What a junction paints at (x,z), or null if it paints nothing there.
     *
     * Mirrors world.meshNode() exactly, because the two have to agree or things
     * standing here sink into it: a square of carriageway at NODE_LIFT, sized
     * and oriented by the widest edge at the node, and a ring of pavement at
     * WALK_LIFT around it. `inSquare` marks the carriageway, which overrides the
     * strip scan outright; the ring only fills in where the strips find nothing.
     */
    nodeSurface(x, z) {
      const reach = MAX_HW + MAX_WALK + VERGE;
      const c0 = Math.floor((x - reach) / nCell), c1 = Math.floor((x + reach) / nCell);
      const d0 = Math.floor((z - reach) / nCell), d1 = Math.floor((z + reach) / nCell);
      let ring = null;
      for (let cx = c0; cx <= c1; cx++) {
        for (let cz = d0; cz <= d1; cz++) {
          const l = nGrid.get(skey(cx, cz));
          if (!l) continue;
          for (const ni of l) {
            const n = g.nodes[ni];
            // The square's size, orientation and ring width are per-node
            // constants, so they are worked out once (nodeSq) rather than per
            // call -- this ran an atan2, a cos and a sin for every node near
            // every roadLift query.
            const q = nodeSq(ni);
            if (!q) continue;
            const hw = q.hw, sw = q.sw, c = q.c, s = q.s;
            const ux = x - n.x, uz = z - n.z;
            const lx = Math.abs(ux * c + uz * s), lz = Math.abs(-ux * s + uz * c);
            if (lx <= hw && lz <= hw) return { lift: NODE_LIFT, inSquare: true };
            // The ring's outer edge comes down across a VERGE, as a strip's does.
            if (sw > 0) {
              const m = Math.max(lx, lz) - hw - sw;
              if (m <= VERGE) {
                const l = m <= 0 ? WALK_LIFT : WALK_LIFT * (1 - m / VERGE);
                if (!ring || l > ring.lift) ring = { lift: l, inSquare: false };
              }
            }
          }
        }
      }
      return ring;
    },

    /** Ground height accounting for paved lift and for bridge decks under Y. */
    groundAt(x, z, curY, lift) {
      const lf = lift != null ? lift : this.roadLift(x, z);
      let terr = G.terrainHeight(x, z) + lf;
      // A LID OVER A PORTAL CUTTING (world.buildLids) is the ground for anyone
      // at its level, by the same nearest-surface rule as a deck: a car on the
      // road over the cutting rides the slab at the road's own grade, and a
      // car in the trench under it never reaches it.
      if (this.lidQuads) {
        const lr = this.lidAt(x, z);
        if (lr !== null) {
          const ly = lr + lf;
          if (curY == null ? ly > terr
            : ly <= curY + DECK_REACH && Math.abs(ly - curY) < Math.abs(terr - curY)) terr = ly;
        }
      }
      let best = terr;
      // NEAREST deck to where you already are, not the highest one within
      // reach. Taking the highest meant any deck up to 2.6 m above the car
      // captured it -- so on a freeway, where decks stack, driving along the
      // ground under an overpass snapped you up onto it, and the next frame's
      // curY was higher again, so the car ratcheted up through the whole stack.
      // Measured on I-5, 25 % of 3 m steps along a freeway moved more than
      // 10 cm and the worst was an 11 m leap. That is the bumps and jumps.
      //
      // Nearest keeps every case that mattered: climbing a ramp, the deck you
      // are joining is the closest surface; driving off a bridge, the terrain
      // becomes closest and you fall; sitting on a deck, the deck is 0.6 m away
      // and the ground is metres, so it wins easily.
      let bestD = curY == null ? Infinity : Math.abs(terr - curY);
      let nEx = 0, nCov = 0;
      const l = surfGrid.get(skey(Math.floor(x / surfCell), Math.floor(z / surfCell)));
      if (l) {
        for (const si of l) {
          const s = surfaces[si];
          const r = distToSeg(x, z, s.ax, s.az, s.bx, s.bz);
          // A BORE HOLDS ITS CAR WITH A MARGIN. At exact half-width, a car
          // weaving at a bend where two tunnel edges of different widths join
          // can sit outside BOTH segments for a frame; the deck query then
          // falls back to the terrain 20 m overhead, the car's y climbs, and
          // the in-bore midpoint rule -- a ratchet -- flips: it can never be
          // recaptured and surfaces through the roof. Measured on the SR-99
          // ride: one +5 m sample around 150 m in, then a smooth climb out.
          // The margin only widens the DECK's catch for a car already riding
          // it; the walls at hw + 0.4 still stop the CAR itself, and a street
          // query from above is untouched because the midpoint rule already
          // rejects it there.
          // 4.0, not 2.4: measured at the first bend past the SR-99 north
          // mouth, a point 4.5 m off-centre escapes BOTH adjacent segments at
          // hw + 2.4 and the carried ground jumps 19.9 -> 29.1. The walls hold
          // the car's centre inside about hw - 0.8, so hw + 4 covers every
          // position a car can physically reach, bend corners included.
          const margin = s.tun ? 4.0 : 0;
          if (r.d > s.hw + margin) continue;
          let y;
          // A graded piece answering from PAST its own ends is only
          // extrapolating over its neighbour's ground; where the two are within
          // a hand's breadth the neighbour, whose own span covers the point,
          // should win. Nearest-to-curY otherwise took the extrapolation
          // whenever it sat a few cm higher: a 7 cm step at a lane-count change
          // on the I-5 ride.
          // ...but the margin is for a car riding THIS bore round a bend, and
          // it reaches 4 m past the wall. Where two tubes run side by side --
          // SR-99's north mouths, held SIDE apart while the lower deck dives
          // (stackBores) -- a car in the right lane of one is inside the
          // other's margin, and when the other deck was the nearer surface it
          // rode it up the far tube's grade: measured 1.9 m high for 7 m by
          // the NB exit. A catch through the margin alone loses to any deck
          // whose own width holds the point.
          let pen = s.tun && r.d > s.hw ? 0.6 : 0;
          let extrap = false;
          if (s.px !== undefined) {
            // A GRADED ROAD IS MANY SHORT PIECES, and distToSeg clamps. Past
            // a piece's end the clamped answer is that end's height held
            // flat, and the nearest-to-curY rule prefers whichever flat
            // extension sits higher -- on a climb, always the piece ahead. A
            // car rode the profile as a staircase: 17.9 % of 3 m steps broke
            // grade by 5 % against 0.2 % on the profile itself.
            //
            // So a piece extrapolates along its own grade for up to 3 m past
            // either end -- enough to cover the outside of a mitred bend,
            // and within a centimetre of its neighbour's answer -- and past
            // that yields to the neighbour wherever one continues.
            const lx = s.bx - s.ax, lz = s.bz - s.az, L = Math.sqrt(lx * lx + lz * lz);
            const tu = ((x - s.ax) * lx + (z - s.az) * lz) / (L * L), over = 3 / L;
            if ((s.in0 && tu < -over) || (s.in1 && tu > 1 + over)) continue;
            // Per-side extent (split levels, see gradeRoads): left along +p.
            // Past either end the piece is extrapolating over its neighbour's
            // ground, so that neighbour's (narrower) extent applies there.
            const lat = (x - s.ax) * s.px + (z - s.az) * s.pz;
            const wl = tu < 0 ? s.wl0 : tu > 1 ? s.wl1 : s.la + (s.lb - s.la) * tu;
            const wr = tu < 0 ? s.wr0 : tu > 1 ? s.wr1 : s.ra + (s.rb - s.ra) * tu;
            if (lat > wl || -lat > wr) continue;
            const tt = tu < -over ? -over : tu > 1 + over ? 1 + over : tu;
            // Only where a neighbour actually covers that ground. Past a free
            // end -- an anchor, a dead end, a locked deck by a portal -- the
            // extrapolation IS the only deck there, and penalising it cost the
            // SR-99 north approach its capture onto the deck (4 cm short).
            extrap = (tu < 0 && s.in0) || (tu > 1 && s.in1);
            if (extrap) pen = 0.12;
            y = s.ay + (s.by - s.ay) * tt + ROAD_LIFT * 0.3;
            // Cambered with its hillside (see gradeRoads), across the piece's
            // own perpendicular so it holds past the ends too.
            if (s.sa || s.sb) {
              const tc = tu < 0 ? 0 : tu > 1 ? 1 : tu;
              y += (s.sa + (s.sb - s.sa) * tc) * ((x - s.ax) * s.px + (z - s.az) * s.pz);
            }
          } else {
            y = s.ay + (s.by - s.ay) * r.t + ROAD_LIFT * 0.3;
          }
          // AN EXTRAPOLATION NEVER BEATS A PIECE THAT COVERS THE POINT at its
          // own level. The 0.12 penalty below only settled near-ties, and a
          // car asks from y + 1.2, so any extrapolation a few centimetres
          // above the covering piece won: past the foot of an 8 % piece its
          // grade line runs 14 cm over the flatter piece it hands on to, and
          // cars rode that line with nothing drawn there -- the largest class
          // of graded samples off their drawn deck at the dense interchanges
          // (107 of 262). Deferred until the covering pieces are known.
          if (extrap) {
            if (nEx < EX_MAX) { exY[nEx] = y; exPen[nEx] = pen; nEx++; }
            continue;
          }
          if (s.px !== undefined && nCov < EX_MAX && (curY == null || y <= curY + DECK_REACH)) covY[nCov++] = y;
          if (curY == null) {
            // No reference height -- a spawn or a placement query. The highest
            // deck is the only sane answer, and is what this always did.
            if (y > best) best = y;
          } else if (y <= curY + DECK_REACH) {
            const dd = Math.abs(y - curY) + pen;
            // A bore is entered at its MOUTH, and no distance heuristic can
            // say so: the portal bank rises in frame-legal steps, so terrain
            // recaptures the tracker every frame and a 3 km ride through
            // SR-99 measured 0 m below ground -- twice, under two different
            // tie-break rules. The data has to say it instead. Over a mouth
            // span, anyone at portal grade is going IN: terrain stops being a
            // floor (the portal face is a wall). Over deeper spans, whoever
            // is below the midpoint between deck and ground above is in the
            // tunnel and keeps it; whoever is above is on the street and
            // never sees the bore.
            // ...AND ANYONE UNDER THIS SPAN'S ROOF IS IN IT. The midpoint alone
            // fails at the end of a cutting, where the carved ground climbs back
            // over the bore and sits only a few metres above the deck: measured
            // at the SR-99 south mouth, 79 m in, deck -8.5 and carved ground
            // -3.6 put the midpoint 2.5 m over the deck. A car coming off the
            // 9 % -> 13 % grade break rides 1-1.7 m high, its wheel query
            // (y + 1.5) lands above that midpoint, the ground wins as the nearer
            // surface, and frame by frame the car climbed out through the roof
            // onto Alaskan Way -- the player's drive in from SODO surfaced 98 m
            // in on every run. Nothing on the street above can be below the
            // roof: past the cutting the ground is over the roof by construction
            // (portalcheck asserts it), and inside the cutting it is below the
            // deck.
            const inBore = s.tun && (s.mouth
              ? curY < Math.max(s.ay, s.by) + 1.6
              : curY < Math.max((terr + y) / 2, y + TUNNEL_H - 0.4));
            if (inBore) {
              if (best === terr || dd < bestD) { bestD = dd; best = y; }
            } else if (dd < bestD) { bestD = dd; best = y; }
          }
        }
      }
      // The deferred extrapolations: only where no piece at their level
      // covers the point -- the outside of a mitred bend, a free end.
      for (let q = 0; q < nEx; q++) {
        const y = exY[q];
        let covered = false;
        for (let c = 0; c < nCov; c++) if (Math.abs(covY[c] - y) < EX_TIE) { covered = true; break; }
        if (covered) continue;
        if (curY == null) { if (y > best) best = y; }
        else if (y <= curY + DECK_REACH) {
          const dd = Math.abs(y - curY) + exPen[q];
          if (dd < bestD) { bestD = dd; best = y; }
        }
      }
      return best;
    },

    /**
     * Solid street objects -- tree trunks and poles -- recorded by world.js as
     * it meshes each chunk.
     *
     * They live here rather than in world.js because collision already takes
     * `city` and nothing else does: a tree you can drive through is a tree the
     * player does not believe in, and until now the ONLY solid thing in the
     * whole map was a building. Only near chunks are meshed, which is exactly
     * the range collision needs, so the store is filled and cleared with them.
     *
     * Keyed by chunk so it can be pruned when a chunk unloads without walking
     * the whole city.
     */
    obstacles: new Map(),

    // --- Portal-cutting barriers ------------------------------------------
    //
    // The retaining walls of a portal cutting, as COLLISION. Two attempts to
    // register these through addObstacle failed the same way: obstacles are
    // keyed by the chunk that drew them and cleared on both build and dispose,
    // so wall segments spanning chunk lines or registered mid-build quietly
    // vanished -- and a 14 m trench had no solid edge, which is "a hole that I
    // ran into". These are installed ONCE by world from the same corridor
    // polylines that draw the walls (setBarriers), indexed by POSITION, so the
    // store and the lookup cannot disagree and no chunk lifecycle touches them.
    barrierSegs: null,
    barrierGrid: new Map(),

    // --- Cut-and-cover lids ------------------------------------------------
    //
    // Plan-view quads (four [x, z] corners, convex) of the slabs world.js
    // builds where a surface road passes over a portal cutting. The slab's top
    // is the RAW ground there -- the road's own grade before the cut dug it --
    // so lidAt answers terrainRaw and groundAt adds the road's lift.
    lidQuads: null,
    lidGrid: new Map(),
    setLids(quads) {
      this.lidQuads = quads.length ? quads : null;
      this.lidGrid = new Map();
      for (let i = 0; i < quads.length; i++) {
        const q = quads[i];
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (const [x, z] of q) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        for (let cx = Math.floor(x0 / 40); cx <= Math.floor(x1 / 40); cx++) {
          for (let cz = Math.floor(z0 / 40); cz <= Math.floor(z1 / 40); cz++) {
            const k = skey(cx, cz);
            let l = this.lidGrid.get(k);
            if (!l) this.lidGrid.set(k, (l = []));
            l.push(i);
          }
        }
      }
    },
    lidAt(x, z) {
      if (!this.lidQuads) return null;
      const l = this.lidGrid.get(skey(Math.floor(x / 40), Math.floor(z / 40)));
      if (!l) return null;
      for (const i of l) {
        const q = this.lidQuads[i];
        let pos = false, neg = false;
        for (let k = 0; k < 4; k++) {
          const [ax, az] = q[k], [bx, bz] = q[(k + 1) & 3];
          const cr = (bx - ax) * (z - az) - (bz - az) * (x - ax);
          if (cr > 1e-9) pos = true; else if (cr < -1e-9) neg = true;
        }
        if (!(pos && neg)) return G.terrainRaw(x, z);
      }
      return null;
    },

    // Stride 6: ax, az, bx, bz, y0, y1. The band is what lets a barrier be a
    // TUNNEL wall: a 2D fence along 3 km of bore under downtown would wall
    // off every surface street above it, so a segment only exists for
    // entities inside its height range.
    setBarriers(segs) {
      this.barrierSegs = segs;
      this.barrierGrid = new Map();
      for (let i = 0; i < segs.length; i += 6) {
        const c0 = Math.floor((Math.min(segs[i], segs[i + 2]) - 2) / CHUNK);
        const c1 = Math.floor((Math.max(segs[i], segs[i + 2]) + 2) / CHUNK);
        const d0 = Math.floor((Math.min(segs[i + 1], segs[i + 3]) - 2) / CHUNK);
        const d1 = Math.floor((Math.max(segs[i + 1], segs[i + 3]) + 2) / CHUNK);
        for (let cx = c0; cx <= c1; cx++) {
          for (let cz = d0; cz <= d1; cz++) {
            const k = skey(cx, cz);
            let l = this.barrierGrid.get(k);
            if (!l) this.barrierGrid.set(k, (l = []));
            l.push(i);
          }
        }
      }
    },

    /** Deepest barrier overlap for a circle, same shape obstacleHit returns. */
    barrierHit(x, z, rad, y) {
      if (!this.barrierSegs) return null;
      const HALF = 0.8; // wall half-thickness
      let best = null;
      const c0 = Math.floor((x - rad) / CHUNK), c1 = Math.floor((x + rad) / CHUNK);
      const d0 = Math.floor((z - rad) / CHUNK), d1 = Math.floor((z + rad) / CHUNK);
      // Allocated lazily: this runs inside obstacleHit for every vehicle and
      // pedestrian every frame, and almost everywhere on the map every queried
      // cell is empty.
      let seen = null;
      for (let cx = c0; cx <= c1; cx++) {
        for (let cz = d0; cz <= d1; cz++) {
          const l = this.barrierGrid.get(skey(cx, cz));
          if (!l) continue;
          for (const i of l) {
            if (!seen) seen = new Set();
            if (seen.has(i)) continue;
            seen.add(i);
            const S = this.barrierSegs;
            if (y !== undefined && (y < S[i + 4] || y > S[i + 5])) continue;
            const r = distToSeg(x, z, S[i], S[i + 1], S[i + 2], S[i + 3]);
            const rr = rad + HALF;
            if (r.d >= rr) continue;
            const d = r.d || 1e-4;
            const pen = rr - d;
            if (!best || pen > best.pen) {
              best = { pen, nx: (x - r.x) / d, nz: (z - r.z) / d };
            }
          }
        }
      }
      return best;
    },

    // --- Landmark solids ---------------------------------------------------
    //
    // The hand-built landmarks (landmarks.js, needle.js) are one merged mesh
    // with no collision of their own, so you drove through the Needle's legs
    // and walked into a stadium wall. Their solids are installed ONCE at boot
    // (setLandmarkSolids), indexed by position like the barriers above, and
    // answer through obstacleHit, so the player's car, traffic and walking all
    // collide with them without a call site changing.
    //
    // Each is a circle {x, z, r} or an oriented box {x, z, hw, hd, rot} --
    // local u = (cos rot, sin rot), v = (-sin rot, cos rot) -- with a height
    // band [y0, y1] in world metres: nothing above y1 is blocked (a plane over
    // a roof, the space under a canopy is a separate question of the band), and
    // nothing more than 2.5 m below y0 (a bore under it), the same underground
    // rule as trunks.
    landmarkSolids: null,
    landmarkGrid: new Map(),
    setLandmarkSolids(list) {
      this.landmarkSolids = list.length ? list : null;
      this.landmarkGrid = new Map();
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const e = s.r !== undefined ? s.r : Math.hypot(s.hw, s.hd);
        for (let cx = Math.floor((s.x - e) / 40); cx <= Math.floor((s.x + e) / 40); cx++) {
          for (let cz = Math.floor((s.z - e) / 40); cz <= Math.floor((s.z + e) / 40); cz++) {
            const k = skey(cx, cz);
            let l = this.landmarkGrid.get(k);
            if (!l) this.landmarkGrid.set(k, (l = []));
            l.push(i);
          }
        }
      }
    },

    /** Deepest landmark-solid overlap for a circle, same shape obstacleHit returns. */
    landmarkHit(x, z, rad, y) {
      if (!this.landmarkSolids) return null;
      let best = null, seen = null;
      const c0 = Math.floor((x - rad) / 40), c1 = Math.floor((x + rad) / 40);
      const d0 = Math.floor((z - rad) / 40), d1 = Math.floor((z + rad) / 40);
      for (let cx = c0; cx <= c1; cx++) {
        for (let cz = d0; cz <= d1; cz++) {
          const l = this.landmarkGrid.get(skey(cx, cz));
          if (!l) continue;
          for (const i of l) {
            if (c0 !== c1 || d0 !== d1) {
              if (!seen) seen = new Set();
              if (seen.has(i)) continue;
              seen.add(i);
            }
            const s = this.landmarkSolids[i];
            if (y !== undefined && (y > s.y1 || y < s.y0 - 2.5)) continue;
            let pen, nx, nz;
            if (s.r !== undefined) {
              const dx = x - s.x, dz = z - s.z, rr = rad + s.r;
              const d2 = dx * dx + dz * dz;
              if (d2 >= rr * rr) continue;
              const d = Math.sqrt(d2) || 1e-4;
              pen = rr - d; nx = dx / d; nz = dz / d;
            } else {
              const c = Math.cos(s.rot), sn = Math.sin(s.rot);
              const dx = x - s.x, dz = z - s.z;
              const u = dx * c + dz * sn, v = -dx * sn + dz * c;
              const qu = Math.max(-s.hw, Math.min(s.hw, u)), qv = Math.max(-s.hd, Math.min(s.hd, v));
              const eu = u - qu, ev = v - qv, e2 = eu * eu + ev * ev;
              let lu, lv;
              if (e2 > 0) {
                // Centre outside the box: circle against its nearest point.
                if (e2 >= rad * rad) continue;
                const e = Math.sqrt(e2);
                pen = rad - e; lu = eu / e; lv = ev / e;
              } else {
                // Centre inside: out through the nearest face.
                const pu = s.hw - Math.abs(u), pv = s.hd - Math.abs(v);
                if (pu < pv) { pen = pu + rad; lu = Math.sign(u) || 1; lv = 0; }
                else { pen = pv + rad; lu = 0; lv = Math.sign(v) || 1; }
              }
              nx = lu * c - lv * sn; nz = lu * sn + lv * c;
            }
            if (!best || pen > best.pen) best = { pen, nx, nz };
          }
        }
      }
      return best;
    },

    addObstacle(ck, x, z, r) {
      let l = this.obstacles.get(ck);
      if (!l) this.obstacles.set(ck, (l = []));
      l.push(x, z, r);
    },

    clearObstacles(ck) {
      this.obstacles.delete(ck);
    },

    /**
     * Nearest solid street object overlapping a circle, or null. Returns the
     * deepest overlap rather than the first, so a car wedged between a tree and
     * a pole is pushed out of the one it is furthest into.
     */
    obstacleHit(x, z, rad, y) {
      let best = null;
      const c0 = Math.floor((x - rad) / CHUNK), c1 = Math.floor((x + rad) / CHUNK);
      const d0 = Math.floor((z - rad) / CHUNK), d1 = Math.floor((z + rad) / CHUNK);
      for (let cx = c0; cx <= c1; cx++) {
        for (let cz = d0; cz <= d1; cz++) {
          const l = this.obstacles.get(skey(cx, cz));
          if (!l) continue;
          for (let i = 0; i < l.length; i += 3) {
            const dx = x - l[i], dz = z - l[i + 1];
            const rr = rad + l[i + 2];
            const d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr) continue;
            // A TRUNK STANDS ON THE STREET, NOT IN THE BORE UNDER IT. The store
            // is 2D, so every street tree and lamp post above SR-99 was a solid
            // post in the tunnel carriageway 20-40 m below it: measured riding
            // the player's car, 24 -> 4.8 m/s dead stops at five stations under
            // downtown with 17-41 m of ground overhead. Same underground rule
            // as collideWithBuildings (2.5 m of ground above you), judged at the
            // post's own footing -- world.js plants it on terrainHeight.
            if (y !== undefined && G.terrainHeight(l[i], l[i + 1]) - y > 2.5) continue;
            const d = Math.sqrt(d2) || 1e-4;
            const pen = rr - d;
            if (!best || pen > best.pen) best = { pen, nx: dx / d, nz: dz / d };
          }
        }
      }
      // The cutting walls answer through the same query, so every consumer --
      // traffic AI, the player's car, walking -- collides with them without a
      // single call site changing.
      const b = this.barrierHit(x, z, rad, y);
      if (b && (!best || b.pen > best.pen)) best = b;
      const lm = this.landmarkHit(x, z, rad, y);
      if (lm && (!best || lm.pen > best.pen)) best = lm;
      return best;
    },

    buildingsNear(x, z, rad) {
      const out = [];
      const c0 = Math.floor((x - rad) / bCell), c1 = Math.floor((x + rad) / bCell);
      const d0 = Math.floor((z - rad) / bCell), d1 = Math.floor((z + rad) / bCell);
      const seen = new Set();
      for (let cx = c0; cx <= c1; cx++)
        for (let cz = d0; cz <= d1; cz++) {
          const l = bGrid.get(skey(cx, cz));
          if (!l) continue;
          for (const bi of l) {
            if (seen.has(bi)) continue;
            seen.add(bi);
            out.push(buildings[bi]);
          }
        }
      return out;
    },

    /**
     * Is (x,z) on (or within `pad` of) a paved carriageway?
     *
     * For anything scattered over the ground -- trees, and whatever comes next.
     * `G.inPark()` is a raster of OSM greenspace and knows nothing about tarmac,
     * so a road crossing a park (Aurora through Woodland Park, Lake Washington
     * Boulevard down the length of its own) reads as plantable ground.
     */
    onRoad(x, z, pad = 0, includeElev = true) {
      // FROM THE FINE GRID for every pad a caller uses (<= ROAD_PAD_MAX). The
      // chunk scan below walked every edge of up to four 400 m chunks through
      // an allocating distToSeg, and chunk meshing calls this per pavement
      // piece, ring piece and verge sample: measured, it was over half of a
      // downtown chunk build (3.7 s of 6.7 s for 25 chunks). The grid files each
      // edge under its bbox grown by hw + batter + ROAD_PAD_MAX, so every edge
      // that can answer true is a candidate and the answer is identical.
      if (pad <= ROAD_PAD_MAX) {
        const cand = roadCell(x, z);
        if (!cand) return false;
        for (let q = 0; q < cand.length; q++) {
          const e = g.edges[cand[q]];
          if (e.elev && !includeElev) continue;
          const a = g.nodes[e.a], b = g.nodes[e.b];
          const sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz;
          let t = l2 > 0 ? ((x - a.x) * sx + (z - a.z) * sz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const rx = a.x + sx * t - x, rz = a.z + sz * t - z;
          const r = e.hw + pad + (e.pbw || 0);
          if (rx * rx + rz * rz <= r * r) return true;
        }
        return false;
      }
      const c0 = Math.floor((x - MAX_HW - pad) / CHUNK);
      const c1 = Math.floor((x + MAX_HW + pad) / CHUNK);
      const d0 = Math.floor((z - MAX_HW - pad) / CHUNK);
      const d1 = Math.floor((z + MAX_HW + pad) / CHUNK);
      for (let cx = c0; cx <= c1; cx++) {
        for (let cz = d0; cz <= d1; cz++) {
          const c = chunks.get(ck(cx, cz));
          if (!c) continue;
          for (const ei of c.edges) {
            const e = g.edges[ei];
            // Elevated edges count BY DEFAULT: anything scattered on the ground
            // under a viaduct grows straight up through the deck -- there was a
            // pine tree in the middle of the I-90 bridge because this skipped
            // them. Pavement is the exception: a bridge passing overhead is no
            // reason to leave a hole in the footpath under it.
            if (e.elev && !includeElev) continue;
            const a = g.nodes[e.a], b = g.nodes[e.b];
            // A graded road's embankment is part of it: a tree on the batter
            // is buried to its canopy, a pavement piece on it floats.
            if (distToSeg(x, z, a.x, a.z, b.x, b.z).d <= e.hw + pad + (e.pbw || 0)) return true;
          }
        }
      }
      return false;
    },

    /**
     * Every edge that could make onRoad(x, z, 0, includeElev) true for some
     * point within `R` of (x, z), for a caller about to test many such points
     * (a junction's pavement ring asks ~300 times). onRoadAmong answers against
     * it with onRoad's own arithmetic, so the result is onRoad's.
     */
    roadsNear(x, z, R, includeElev = true) {
      const out = [];
      roadCell(0, 0);
      // An edge within R + its reach of (x, z) is filed under the cell holding
      // its nearest point, which lies within R + the widest reach.
      const M = R + roadReachMax;
      const c0 = Math.floor((x - M) / LIFT_CELL), c1 = Math.floor((x + M) / LIFT_CELL);
      const d0 = Math.floor((z - M) / LIFT_CELL), d1 = Math.floor((z + M) / LIFT_CELL);
      const seen = new Set();
      for (let cx = c0; cx <= c1; cx++) {
        for (let cz = d0; cz <= d1; cz++) {
          const l = roadGrid.get(skey(cx, cz));
          if (!l) continue;
          for (let q = 0; q < l.length; q++) {
            const ei = l[q];
            if (seen.has(ei)) continue;
            seen.add(ei);
            const e = g.edges[ei];
            if (e.elev && !includeElev) continue;
            const a = g.nodes[e.a], b = g.nodes[e.b];
            if (distToSeg(x, z, a.x, a.z, b.x, b.z).d <= R + e.hw + (e.pbw || 0) + 0.01) out.push(ei);
          }
        }
      }
      return out;
    },

    onRoadAmong(list, x, z) {
      for (let q = 0; q < list.length; q++) {
        const e = g.edges[list[q]];
        const a = g.nodes[e.a], b = g.nodes[e.b];
        const sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz;
        let t = l2 > 0 ? ((x - a.x) * sx + (z - a.z) * sz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const rx = a.x + sx * t - x, rz = a.z + sz * t - z;
        const r = e.hw + 0 + (e.pbw || 0);
        if (rx * rx + rz * rz <= r * r) return true;
      }
      return false;
    },

    /** Profile height and cross-slope of graded edge `e` at parameter t. */
    profAt,

    /**
     * Is (x,z) inside some OTHER road's carriageway, at a surface within 1.6 m
     * of height y?
     *
     * For anything that must not stand on, or be painted across, a carriageway
     * it does not belong to: a deck's parapet where a ramp's deck overlaps it,
     * a lane line where a ramp runs into the main line. Height matters, because
     * a street six metres under a deck is not in the way of its parapet.
     *
     * Only the INTERIOR of a segment counts. At a straight-through joint the
     * next piece's end is right beside this piece's parapet and paint, and
     * clamping to that endpoint would open every rail and trim every line at
     * every node.
     */
    carriagewayAt(x, z, y, skip, tol = 1.6) {
      // Candidates from onRoad's grid, which holds every edge under a bbox far
      // wider than hw. The chunk scan below decides which road is returned when
      // more than one qualifies, so ties still go the way they always went.
      const l = roadCell(x, z);
      if (!l) return 0;
      let hit = 0;
      for (let k = 0; k < l.length; k++) {
        const ei = l[k];
        if (ei === skip || !cwHit(ei, x, z, y, tol)) continue;
        if (hit) return cwScan(x, z, y, skip, tol);
        hit = ei + 1;
      }
      return hit;
    },

    /**
     * A point on a road near (x,z), for dropping the player somewhere they
     * picked off the map.
     *
     * Snaps to a graph node rather than to the raw tap: nodes sit ~50 m apart
     * along every carriageway, so one is always on tarmac, whereas the tap
     * itself is usually in the middle of a block. Ground-level nodes are
     * preferred over decks -- landing on an unmarked freeway bridge is a worse
     * surprise than walking 30 m -- but a deck is still better than refusing,
     * which is what happens out on Harbor Island or the far shore.
     */
    respawnPointNear(x, z, maxR = 1200) {
      let best = -1, bd = maxR * maxR;
      let anyBest = -1, anyBd = maxR * maxR;
      const c0 = Math.floor((x - maxR) / nCell), c1 = Math.floor((x + maxR) / nCell);
      const d0 = Math.floor((z - maxR) / nCell), d1 = Math.floor((z + maxR) / nCell);
      for (let cx = c0; cx <= c1; cx++) {
        for (let cz = d0; cz <= d1; cz++) {
          const l = nGrid.get(skey(cx, cz));
          if (!l) continue;
          for (const ni of l) {
            const n = g.nodes[ni];
            if (!n.e.length) continue;
            const dd = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
            if (dd < anyBd) { anyBd = dd; anyBest = ni; }
            if (n.elev) continue;
            if (dd < bd) { bd = dd; best = ni; }
          }
        }
      }
      const ni = best >= 0 ? best : anyBest;
      if (ni < 0) return null;
      const n = g.nodes[ni];
      return { x: n.x, z: n.z, elev: !!n.elev, dist: Math.hypot(n.x - x, n.z - z) };
    },

    nearestNode(x, z, maxR = 260) {
      let best = -1, bd = maxR * maxR;
      const c0 = Math.floor((x - maxR) / nCell), c1 = Math.floor((x + maxR) / nCell);
      const d0 = Math.floor((z - maxR) / nCell), d1 = Math.floor((z + maxR) / nCell);
      for (let cx = c0; cx <= c1; cx++)
        for (let cz = d0; cz <= d1; cz++) {
          const l = nGrid.get(skey(cx, cz));
          if (!l) continue;
          for (const ni of l) {
            const n = g.nodes[ni];
            const dd = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
            if (dd < bd) { bd = dd; best = ni; }
          }
        }
      return best;
    },

    /** Edges whose centre lies within `rad` of (x,z). */
    edgesNear(x, z, rad) {
      const out = [];
      const c0 = Math.floor((x - rad) / CHUNK), c1 = Math.floor((x + rad) / CHUNK);
      const d0 = Math.floor((z - rad) / CHUNK), d1 = Math.floor((z + rad) / CHUNK);
      for (let cx = c0; cx <= c1; cx++)
        for (let cz = d0; cz <= d1; cz++) {
          const c = chunks.get(ck(cx, cz));
          if (!c) continue;
          for (const ei of c.edges) out.push(ei);
        }
      return out;
    },
  };
}
