// Auto KW: how an arterial is laid out ACROSS -- the lanes traffic drives,
// and so where the paint goes (CLAUDE.md "The arterials from the driver's
// seat"). One place, read by traffic.js (where a car drives) and world.js
// (the lane lines, the centre, the bike lanes, the raised medians), so the
// paint can never disagree with the cars.
//
// `e.al` (citygen, from data/artlanes.bin, tools/kw/build_artlanes.py): bits
// 0-2 lanes driven a -> b, 3-5 lanes driven b -> a, 6 a two-way left-turn
// lane, 7 matched to an OSM way; bits 8-9 a painted bike lane on the +p side
// (+p = (-dz, dx), the right of a -> b), 10-11 on the -p side.

// Lanes on a one-way street are 3.6 m, a real lane. A one-way street with
// parking keeps 2.2 m clear at each kerb for the parked cars (they sit at
// hw - 1.15, traffic.js kerbSlots); anything else keeps a 0.8 m shoulder.
export const LANE_W = 3.6, PARK_EDGE = 2.2, SHOULDER = 0.8;

/** Legal direction of edge e: +1 a -> b, -1 b -> a, 0 both. */
export function edgeFlow(e) {
  if (e.oneway) return e.onewayRev ? -1 : 1;
  if (e.cls === 'ramp') return 1;
  if (e.cls === 'hwy' && /Express|Ship Canal Bridge/.test(e.name || '')) return 1;
  return 0;
}

/**
 * The lanes of a ONE-WAY edge ei as traffic lays them: [lo, hi, n] in the
 * edge's own perpendicular (+ = the right of a -> b), n lanes evenly across.
 * `flowAt(i)` is edge i's edgeFlow. (This is traffic.js laneLatU's own
 * computation, moved here unchanged so world.js paints the same lanes.)
 */
export function oneWaySpan(city, ei, flowAt) {
  const e = city.edges[ei];
  // A graded carriageway can be trimmed back where it runs over another
  // (e.tw, per sample and side): lanes stay inside the narrowest point.
  let w0 = e.hw, w1 = e.hw;
  if (e.tw) {
    for (let i = 0; i < e.tw.length; i += 2) {
      if (e.tw[i] < w0) w0 = e.tw[i];
      if (e.tw[i + 1] < w1) w1 = e.tw[i + 1];
    }
  }
  // ...and inside any lid barrier standing in the carriageway (world
  // buildLids' e.barW, [+p, -p] like e.tw): that is where the road ends.
  if (e.barW) { w0 = Math.min(w0, e.barW[0]); w1 = Math.min(w1, e.barW[1]); }
  // An OPPOSING carriageway overlapping this one owns its half of the
  // overlap. SR-99's twin tubes are two 14 m roads with centrelines
  // 7.5-11 m apart for ~2.8 km (see "SR-99" in CLAUDE.md); laid across
  // the full width, each tube's left lane ran 1.3 m from the other tube's
  // oncoming left lane, and the cars traded paint the whole way. The
  // boundary is the midline between the two centrelines.
  const my = flowAt(ei);
  const na = city.nodes[e.a], nb = city.nodes[e.b];
  const mx = (na.x + nb.x) / 2, mz = (na.z + nb.z) / 2;
  for (const oi of city.edgesNear(mx, mz, e.len / 2 + 30)) {
    if (oi === ei) continue;
    const o = city.edges[oi];
    const par = e.dx * o.dx + e.dz * o.dz;
    if (Math.abs(par) < 0.9) continue;
    const of = flowAt(oi);
    if (of !== 0 && of * my * par > 0) continue; // same way: not opposing
    const oa = city.nodes[o.a], ob = city.nodes[o.b];
    for (let s = 0.1; s < 1; s += 0.2) {
      const sx = na.x + (nb.x - na.x) * s, sz = na.z + (nb.z - na.z) * s;
      const u = ((sx - oa.x) * o.dx + (sz - oa.z) * o.dz) / o.len;
      if (u < 0 || u > 1) continue;
      const qx = oa.x + o.dx * o.len * u, qz = oa.z + o.dz * o.len * u;
      if (Math.abs((na.y + (nb.y - na.y) * s) - (oa.y + (ob.y - oa.y) * u)) > 3) continue;
      const side = (qx - sx) * -e.dz + (qz - sz) * e.dx; // + = the a->b right side
      const dd = Math.abs(side);
      if (dd < 1 || dd > e.hw + o.hw) continue;
      if (side > 0) w0 = Math.min(w0, dd / 2);
      else w1 = Math.min(w1, dd / 2);
    }
  }
  const parks = !(e.elev || e.cls === 'hwy' || e.cls === 'ramp');
  const inset = parks ? PARK_EDGE : SHOULDER;
  const lo = -w1 + inset, hi = w0 - inset;
  const n = hi > lo ? Math.max(1, Math.floor((hi - lo) / LANE_W)) : 1;
  return hi > lo ? [lo, hi, n] : [(lo + hi) / 2, (lo + hi) / 2, n];
}

export const alFwd = (e) => (e.al ? e.al & 7 : 0);
export const alBwd = (e) => (e.al ? (e.al >> 3) & 7 : 0);
export const alTwltl = (e) => !!(e.al && e.al & 64);
/** A painted bike lane on side sg (+1 = +p, the right of a -> b). */
export const alBike = (e, sg) => !!(e.al && (sg > 0 ? (e.al >> 8) & 3 : (e.al >> 10) & 3));

// the two-way layout's pieces (metres)
const TW_C0 = 1.75;       // half a two-way left-turn lane
const DY_C0 = 0.2;        // half the double yellow's span (two 12 cm lines, 16 cm apart)
const KERB_IN = 0.5;      // the gutter, a kerb with no bike lane
const BIKE_IN = 2.1;      // a 1.6 m painted bike lane and its gutter
const LANE_MIN = 2.9, LANE_MAX = 3.7;

/**
 * A TWO-WAY arterial with more than one lane a way (OSM `lanes:forward` /
 * `lanes:backward`, or an even `lanes`): its layout across, or null (the old
 * two-way street: one lane a way at 0.48 hw, a broken yellow centre).
 *   m   the centre line's offset (+p): the lanes are centred in the kerbs
 *   c0  half the centre's width (the double yellow, or the two-way left-turn lane)
 *   w   one lane's width, the same both ways
 *   nP, nM  lanes on the +p side (driven a -> b) and the -p side
 *   kP, kM  kerb insets (the gutter, or the bike lane and its gutter)
 * Lane i of a side (0 the inner) is centred c0 + (i + 0.5) w from m, to the
 * right of its traffic.
 */
export function twoWayLayout(e) {
  if (e._tw2 !== undefined) return e._tw2;
  let out = null;
  const nP = alFwd(e), nM = alBwd(e);
  if (!e.oneway && (e.cls === 'art' || e.cls === 'st') && !e.rural && !e.tunnel && !e.gravel
    && nP >= 1 && nM >= 1 && Math.max(nP, nM) >= 2) {
    let w0 = e.hw, w1 = e.hw;
    if (e.tw) for (let i = 0; i < e.tw.length; i += 2) { w0 = Math.min(w0, e.tw[i]); w1 = Math.min(w1, e.tw[i + 1]); }
    const twl = alTwltl(e);
    const c0 = twl ? TW_C0 : DY_C0;
    const bP = alBike(e, 1), bM = alBike(e, -1);
    const kP = bP ? BIKE_IN : KERB_IN, kM = bM ? BIKE_IN : KERB_IN;
    const A = -(w1 - kM), B = w0 - kP;
    const w = Math.min(LANE_MAX, (B - A - 2 * c0) / (nP + nM));
    if (w >= LANE_MIN) {
      const m = (A + B) / 2 - ((nP - nM) * w) / 2;
      out = { m, c0, w, nP, nM, kP, kM, bP, bM, twl };
    }
  }
  return (e._tw2 = out);
}

/** On a two-way layout L, lane i (0 the inner) of the side driven `sign`:
 *  its centre's offset to the right of travel. */
export function twoWayLaneOff(L, sign, i) {
  return (sign > 0 ? L.m : -L.m) + L.c0 + (i + 0.5) * L.w;
}

/**
 * A one-way art / st carriageway's median: the kerb-to-kerb gap to the
 * nearest OPPOSING parallel carriageway on each side, [+p, -p] (Infinity
 * where there is none within 30 m of the kerb). Cached on the edge (the
 * edge object, not its index: world.js hydroEdge asks with one).
 */
export function medianGaps(city, e) {
  if (e._med !== undefined) return e._med;
  let gP = Infinity, gM = Infinity;
  if (e.oneway && (e.cls === 'art' || e.cls === 'st') && !e.tunnel && !e.elev) {
    const my = edgeFlow(e);
    const na = city.nodes[e.a], nb = city.nodes[e.b];
    const mx = (na.x + nb.x) / 2, mz = (na.z + nb.z) / 2;
    // per side, the gap at each of five stations along the edge; the side's
    // gap is the mean of those that see one, if three or more do (a station
    // past the other carriageway's end sees none)
    const sP = [Infinity, Infinity, Infinity, Infinity, Infinity], sM = sP.slice();
    for (const oi of city.edgesNear(mx, mz, e.len / 2 + 40)) {
      if (city.edges[oi] === e) continue;
      const o = city.edges[oi];
      if (!o.oneway || o.tunnel || o.elev || (o.cls !== 'art' && o.cls !== 'st')) continue;
      const par = e.dx * o.dx + e.dz * o.dz;
      if (Math.abs(par) < 0.9 || edgeFlow(o) * my * par > 0) continue;
      const oa = city.nodes[o.a];
      for (let k = 0; k < 5; k++) {
        const s = 0.1 + 0.2 * k;
        const sx = na.x + (nb.x - na.x) * s, sz = na.z + (nb.z - na.z) * s;
        const u = ((sx - oa.x) * o.dx + (sz - oa.z) * o.dz) / o.len;
        if (u < 0 || u > 1) continue;
        const qx = oa.x + o.dx * o.len * u, qz = oa.z + o.dz * o.len * u;
        const side = (qx - sx) * -e.dz + (qz - sz) * e.dx;
        const gap = Math.abs(side) - e.hw - o.hw;
        if (gap < -0.5 || gap > 30) continue;
        if (side > 0) sP[k] = Math.min(sP[k], gap);
        else sM[k] = Math.min(sM[k], gap);
      }
    }
    const pick = (S) => {
      const f = S.filter((g) => g < Infinity);
      return f.length >= 3 ? Math.max(0, f.reduce((p, q) => p + q, 0) / f.length) : Infinity;
    };
    gP = pick(sP); gM = pick(sM);
  }
  return (e._med = [gP, gM]);
}
