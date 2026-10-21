// YKF'S AIR TRAFFIC (Auto KW): aircraft that use the Region of Waterloo
// International Airport, and a few that cross the region.
//
//   - AIRLINERS (vehicles.js 'airliner', a 737-class twinjet in a generic
//     livery: the vehicle's colour is its tail, cheatline and nacelles) fly
//     an approach to the runway in use -- straight in from the approach
//     side, or downwind, base and final from the other -- touch down 380 m
//     past the threshold, roll out, leave at the first exit they can make,
//     taxi to a gate (stands 1, 2, 3 by the terminal), turn round, are pushed
//     back, taxi out, hold short, line up, take off and climb out of the map.
//   - A BIZJET ('jet', Chartright's) does the same to Apron VII.
//   - A CESSNA ('plane') from the Waterloo Wellington Flight Centre flies
//     touch-and-goes round runway 14/32 for ever; another crosses the region.
//   - A NEWS HELICOPTER ('heli') tours the cities: it orbits a place a while
//     (Uptown, downtown, the Aud, the 401 at Freeport, Preston), then moves on.
//
// No flight model: every movement is a TRACK -- a polyline from waypoints
// whose corners are filleted into arcs, with a height and a speed at each
// waypoint interpolated along it -- and the aircraft rides it, banked by the
// track's curvature and pitched by its climb. On the ground the tracks come
// from the taxiway graph (OSM's taxiways, the runways' centrelines and the
// stands, ykf.js `aero`), and the speed is capped by each corner's radius.
//
// The player: a taxiing aircraft holds for anything in its path (you, or
// another aircraft); a departure holds short while the runway is occupied
// (by you too) or an arrival is close; an arrival 1.6 km out that finds the
// runway occupied GOES AROUND, flies a circuit and tries again; the Cessna
// makes a low pass instead of touching down. None of them is in
// traffic.cars: nothing collides with them, and each costs its 3 draws
// (+1 per live prop/rotor and gear leg within DETAIL_R of the camera).

import * as G from './geo.js';
import { Vehicle } from './vehicles.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const approach = (v, to, up, down) => (v < to ? Math.min(to, v + up) : Math.max(to, v - down));

// Airlines in plain text (no logos), each a tail colour.
export const AIRLINES = [
  { name: 'WestJet', col: 0x10848f },
  { name: 'Flair', col: 0x8dc63f },
  { name: 'Porter', col: 0x1b2d55 },
  { name: 'Sunwing', col: 0xf2a51a },
  { name: 'Air Canada', col: 0xc8202c },
];
// per kind: type, approach and touchdown speeds, rotation speed, take-off
// acceleration, taxi speed, rollout deceleration, wing half-span, range drawn
const KINDS = {
  airliner: { type: 'airliner', vApp: 76, vTd: 70, vr: 76, acc: 2.1, taxi: 10, dec: 1.9, span: 18, show: 9500, wake: 300 },
  biz: { type: 'jet', vApp: 62, vTd: 56, vr: 57, acc: 2.8, taxi: 9, dec: 2.2, span: 7, show: 6000, wake: 200 },
  circuit: { type: 'plane', span: 5.5, show: 4000 },
  xc: { type: 'plane', span: 5.5, show: 4000 },
  heli: { type: 'heli', span: 5.5, show: 3500 },
};
const BIZ = { name: 'Chartright', col: 0xe9ecef };
const DETAIL_R = 320;           // live props, rotors and gear inside this
const GATES = ['1', '2', '3'];  // the airline gates; their 'A' stands stay clear too
// Apron VII by Chartright's hangar: the bizjet's spot, and the taxiway end that feeds it
const BIZ_SPOT = [6398, -900], BIZ_FEED = [6374, -840];
// the news helicopter's tour (game x, z)
const HELI_TOUR = [[-3830, -1330, 'Uptown Waterloo'], [-620, -3396, 'Bridgeport'], [-1422, 149, 'downtown Kitchener'],
  [380, 358, 'the Aud'], [5306, 3528, 'the 401 at Freeport'], [9672, 6443, 'Preston'], [-1752, 800, 'Victoria Park']];
// the cross-country Cessna's loop: YKF, St. Jacobs, Waterloo, Baden, Doon, Hespeler
const XC_LOOP = [[7600, -2600], [-6500, -6900], [-5200, -2600], [-12600, 5200], [4100, 6900], [13000, 2300]];

// --- tracks -------------------------------------------------------------------------------

/**
 * A path through waypoints { x, z, y, v, r, g }: straight legs, each corner
 * filleted into an arc of radius r (shrunk to fit the legs), y and v
 * interpolated along each leg (and across each arc), `g` a leg on the
 * ground. Sampled densely; `closed` joins the last waypoint to the first.
 */
class Track {
  constructor(wps, closed = false) {
    const n = wps.length;
    const P = [];   // [x, z, y, v, g]
    const corner = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = wps[(i - 1 + n) % n], p = wps[i], b = wps[(i + 1) % n];
      let d1x = p.x - a.x, d1z = p.z - a.z; const L1 = Math.hypot(d1x, d1z); if (L1 < 0.01) continue; d1x /= L1; d1z /= L1;
      let d2x = b.x - p.x, d2z = b.z - p.z; const L2 = Math.hypot(d2x, d2z); if (L2 < 0.01) continue; d2x /= L2; d2z /= L2;
      const th = Math.acos(clamp(d1x * d2x + d1z * d2z, -1, 1));
      if (th < 0.6 * DEG) continue;
      let R = p.r || 30, T = R * Math.tan(th / 2);
      const Tmax = 0.48 * Math.min(L1, L2);
      if (T > Tmax) { T = Tmax; R = T / Math.tan(th / 2); }
      // the arc's centre: inward, perpendicular to the incoming leg
      let px = d2x - d1x * (d1x * d2x + d1z * d2z), pz = d2z - d1z * (d1x * d2x + d1z * d2z);
      const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
      const ix = p.x - d1x * T, iz = p.z - d1z * T, ox = p.x + d2x * T, oz = p.z + d2z * T;
      corner[i] = { ix, iz, ox, oz, cx: ix + px * R, cz: iz + pz * R, R, ti: 1 - T / L1, to: T / L2 };
    }
    const legs = closed ? n : n - 1;
    const val = (i, t) => { const a = wps[i], b = wps[(i + 1) % n]; return [lerp(a.y, b.y, t), lerp(a.v, b.v, t)]; };
    for (let i = 0; i < legs; i++) {
      const a = wps[i], b = wps[(i + 1) % n], ca = corner[i], cb = corner[(i + 1) % n];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const g = !!(a.g && b.g);
      const t0 = ca ? ca.to : 0, t1 = cb ? cb.ti : 1;
      const steps = Math.max(1, Math.ceil(((t1 - t0) * L) / (g ? 6 : 30)));
      for (let k = (P.length && !ca ? 1 : 0); k <= steps; k++) {
        const t = lerp(t0, t1, k / steps);
        const [y, v] = val(i, t);
        P.push([lerp(a.x, b.x, t), lerp(a.z, b.z, t), y, v, g]);
      }
      // the arc at b
      if (cb && (closed || i + 1 < n - 1)) {
        const [y0, v0] = val(i, cb.ti), [y1, v1] = val((i + 1) % n, cb.to);
        const a0 = Math.atan2(cb.iz - cb.cz, cb.ix - cb.cx), a1 = Math.atan2(cb.oz - cb.cz, cb.ox - cb.cx);
        const da = wrap(a1 - a0), m = Math.max(2, Math.ceil(Math.abs(da) / (4 * DEG)));
        const gb = !!(b.g && a.g && wps[(i + 2) % n].g);
        for (let k = 1; k < m; k++) {
          const f = k / m, q = a0 + da * f;
          P.push([cb.cx + Math.cos(q) * cb.R, cb.cz + Math.sin(q) * cb.R, lerp(y0, y1, f), lerp(v0, v1, f), gb]);
        }
      }
    }
    if (closed && P.length > 1) P.push(P[0].slice());
    this.P = P;
    const s = new Float64Array(P.length);
    for (let i = 1; i < P.length; i++) s[i] = s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]);
    this.s = s;
    this.len = s[P.length - 1];
    this.closed = closed;
    this.i = 0;
  }

  /** Sample at arc length s into `o`: x, y, z, heading, v, g, turn (heading change per metre). */
  at(s, o) {
    const S = this.s, P = this.P, N = P.length;
    if (this.closed) { s %= this.len; if (s < 0) s += this.len; } else s = clamp(s, 0, this.len);
    let i = this.i;
    if (i >= N - 1 || S[i] > s) i = 0;
    while (i < N - 2 && S[i + 1] < s) i++;
    this.i = i;
    const a = P[i], b = P[i + 1], d = S[i + 1] - S[i] || 1, t = clamp((s - S[i]) / d, 0, 1);
    o.x = lerp(a[0], b[0], t); o.z = lerp(a[1], b[1], t); o.y = lerp(a[2], b[2], t);
    o.v = lerp(a[3], b[3], t); o.g = t < 0.5 ? a[4] : b[4];
    const hx = b[0] - a[0], hz = b[1] - a[1];
    o.h = Math.atan2(hx, hz);
    o.climb = (b[2] - a[2]) / Math.max(0.01, Math.hypot(hx, hz));
    // the turn: the heading change over the neighbouring segments
    const c = P[Math.min(N - 1, i + 2)], p0 = P[Math.max(0, i - 1)];
    const h0 = Math.atan2(a[0] - p0[0], a[1] - p0[1]), h1 = Math.atan2(c[0] - b[0], c[1] - b[1]);
    const span = (i + 2 < N ? S[i + 2] : S[N - 1]) - (i > 0 ? S[i - 1] : 0);
    o.turn = i > 0 && i + 2 < N ? wrap(h1 - h0) / Math.max(1, span) : 0;
    return o;
  }
}

// --- the taxiway graph --------------------------------------------------------------------

/** OSM's taxiways + the runways' centrelines, as a graph to route ground tracks over. */
class TaxiGraph {
  constructor(aero) {
    this.nodes = [];   // { x, z, adj: [[j, len, runway]] }
    this.grid = new Map();
    const runways = aero.runways.map((r) => {
      const [a, b] = r.p, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return { r, a, b, L, ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L, ts: [] };
    });
    const onRunway = (x, z) => {
      for (const R of runways) {
        const dx = x - R.a[0], dz = z - R.a[1], t = dx * R.ux + dz * R.uz, l = -dx * R.uz + dz * R.ux;
        if (t > -20 && t < R.L + 20 && Math.abs(l) < 6) return [R, clamp(t, 0, R.L)];
      }
      return null;
    };
    // taxiways: every vertex a node, every leg an edge; a vertex on a runway's
    // centreline is where the taxiway joins it
    const joins = [];
    for (const t of aero.taxiways) {
      let prev = -1;
      for (const p of t.p) {
        const j = this.node(p[0], p[1]);
        if (prev >= 0 && prev !== j) this.link(prev, j, false);
        prev = j;
        const on = onRunway(p[0], p[1]);
        if (on) { on[0].ts.push(on[1]); joins.push([j, on[0], on[1]]); }
      }
    }
    // the runways: a node every 60 m and at every join, chained
    for (const R of runways) {
      for (let t = 0; t <= R.L; t += 60) R.ts.push(t);
      R.ts.push(R.L);
      R.ts.sort((p, q) => p - q);
      let prev = -1, pt = 0;
      R.nodes = [];
      for (const t of R.ts) {
        if (prev >= 0 && t - pt < 1) continue;
        const j = this.node(R.a[0] + R.ux * t, R.a[1] + R.uz * t, 1.5);
        if (prev >= 0 && j !== prev) this.link(prev, j, true);
        R.nodes.push([t, j]);
        prev = j; pt = t;
      }
    }
    for (const [j, R, t] of joins) {
      const k = this.node(R.a[0] + R.ux * t, R.a[1] + R.uz * t, 1.5);
      if (k !== j) this.link(j, k, false);
    }
    this.runways = runways;
  }

  node(x, z, snap = 2.5) {
    const key = (i, k) => i * 100003 + k;
    const gi = Math.floor(x / 8), gk = Math.floor(z / 8);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const j of this.grid.get(key(gi + a, gk + b)) || []) {
        const n = this.nodes[j];
        if (Math.hypot(n.x - x, n.z - z) < snap) return j;
      }
    }
    const j = this.nodes.length;
    this.nodes.push({ x, z, adj: [] });
    const k = key(gi, gk);
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k).push(j);
    return j;
  }

  link(i, j, rw) {
    const a = this.nodes[i], b = this.nodes[j], L = Math.hypot(a.x - b.x, a.z - b.z);
    if (a.adj.some((e) => e[0] === j)) return;
    a.adj.push([j, L, rw]); b.adj.push([i, L, rw]);
  }

  nearest(x, z, notRunway = false) {
    let best = -1, bd = Infinity;
    this.nodes.forEach((n, j) => {
      if (notRunway && n.adj.every((e) => e[2])) return;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = j; }
    });
    return best;
  }

  /** Dijkstra from i to j; runway edges cost `rwK` times their length (taxi off them). */
  route(i, j, rwK = 25) {
    const N = this.nodes.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    dist[i] = 0;
    for (;;) {
      let u = -1, bd = Infinity;
      for (let k = 0; k < N; k++) if (!done[k] && dist[k] < bd) { bd = dist[k]; u = k; }
      if (u < 0 || u === j) break;
      done[u] = 1;
      for (const [w, L, rw] of this.nodes[u].adj) {
        const nd = dist[u] + L * (rw ? rwK : 1);
        if (nd < dist[w]) { dist[w] = nd; prev[w] = u; }
      }
    }
    if (dist[j] === Infinity) return null;
    const out = [];
    for (let k = j; k >= 0; k = prev[k]) out.push(k);
    return out.reverse();
  }

  /** The runway's nodes in landing order from its threshold `rw` (ykf.runway): [[along, node, isJoin]]. */
  runwayNodes(rw) {
    const R = this.runways.find((q) => q.r.ref === rw.ref);
    const rev = Math.hypot(R.a[0] - rw.t[0], R.a[1] - rw.t[1]) > 5;
    return R.nodes.map(([t, j]) => [rev ? R.L - t : t, j, this.nodes[j].adj.some((e) => !e[2])]).sort((p, q) => p[0] - q[0]);
  }
}

/** Ground waypoints through graph nodes (corners rounded at taxi radius). */
function groundWps(graph, ids, v, r = 22) {
  return ids.map((j) => ({ x: graph.nodes[j].x, z: graph.nodes[j].z, y: 0, v, r, g: true }));
}

/** Drop near-duplicate and collinear-ish successive waypoints (OSM's curves are 3 m apart). */
function thin(wps, minGap = 9) {
  const out = [];
  for (const w of wps) {
    const l = out[out.length - 1];
    if (l && Math.hypot(w.x - l.x, w.z - l.z) < minGap) { if (w.keep) out[out.length - 1] = w; continue; }
    out.push(w);
  }
  return out;
}

// --- the aircraft ---------------------------------------------------------------------------

export class AirTraffic {
  /**
   * opts: { scene, city, ykf, phone, runway ('26' | '08'), hud (getter), rng }
   */
  constructor(opts) {
    this.o = opts;
    this.scene = opts.scene; this.city = opts.city; this.ykf = opts.ykf;
    this.phone = !!opts.phone;
    this.rng = opts.rng || Math.random;
    this.craft = [];
    this.t = 0;
    this.ok = !!(this.ykf && this.ykf.a);
    this.stats = { arrivals: 0, landed: 0, departures: 0, goArounds: 0, holds: 0, spawned: 0 };
    this.log = [];
    if (!this.ok) return;
    // prevailing westerlies: 26 most days
    this.rwId = opts.runway || (this.rng() < 0.7 ? '26' : '08');
    this.rw = this.ykf.runway(this.rwId);
    this.fe = this.rw.y;
    this.graph = new TaxiGraph(this.ykf.a);
    this.rwNodes = this.graph.runwayNodes(this.rw);
    // the gates (and their A stands, which a 737's wing covers)
    this.gates = [];
    for (const s of this.ykf.a.stands) {
      if (!GATES.includes(s.ref)) continue;
      const [p0, p1] = s.p;
      this.gates.push({ ref: s.ref, p0, p1, node: this.graph.nearest(p0[0], p0[1], true), busy: null });
    }
    this.biz = { ref: 'VII', p0: BIZ_FEED, p1: BIZ_SPOT, node: this.graph.nearest(BIZ_FEED[0], BIZ_FEED[1], true), busy: null };
    // the circuit runway: 14/32, into the wind with 08/26
    this.cRw = this.ykf.runway(this.rwId === '26' ? '32' : '14');
    // where the cities are (the airport's centre, for the entry ring)
    this.cx = (this.rw.t[0] + this.rw.e[0]) / 2; this.cz = (this.rw.t[1] + this.rw.e[1]) / 2;
    this.max = this.phone ? { airliner: 1, biz: 0, circuit: 1, xc: 0, heli: 1 } : { airliner: 2, biz: 1, circuit: 1, xc: 1, heli: 1 };
    this.nextArr = 25 + this.rng() * 20;
    this.nextBiz = 140 + this.rng() * 120;
    this.radioCd = 0;
    this._o = {};
  }

  /** The stands the parked fleet must leave free (main.js). */
  reserved(ref) { return this.ok && /^[123]A?$/.test(ref); }

  // --- spawning ---------------------------------------------------------------------------

  _make(kind, col) {
    const K = KINDS[kind];
    const v = new Vehicle(this.city, K.type, col);
    v.mode = 'air';
    for (const m of [v.paintMesh, v.trimMesh, v.matteMesh]) { m.castShadow = false; m.receiveShadow = true; }
    this.scene.add(v.group);
    const c = { kind, K, v, phase: 'none', track: null, s: 0, speed: 0, hold: 0, t: 0, gearK: 0, gearUp: false,
      roll: 0, pitch: 0, x: 0, y: 0, z: 0, h: 0, name: '', detailed: false, cast: false, rev: false, onGround: false };
    this.craft.push(c);
    this.stats.spawned++;
    return c;
  }

  _remove(c) {
    const i = this.craft.indexOf(c);
    if (i >= 0) this.craft.splice(i, 1);
    if (c.gate) c.gate.busy = null;
    this.scene.remove(c.v.group);
    c.v.bodyMat.dispose();
    c.gone = true;
  }

  _count(kind) { return this.craft.reduce((n, c) => n + (c.kind === kind ? 1 : 0), 0); }

  _callsign(kind) {
    if (kind === 'biz') return { ...BIZ, call: `${BIZ.name} ${100 + Math.floor(this.rng() * 899)}` };
    const a = AIRLINES[Math.floor(this.rng() * AIRLINES.length)];
    return { ...a, call: `${a.name} ${100 + Math.floor(this.rng() * 2800)}` };
  }

  /** Begin an arrival from the edge of the map (or from `at`, partway in). */
  spawnArrival(kind = 'airliner', opts = {}) {
    const free = this.gates.filter((g) => !g.busy);
    const gate = kind === 'biz' ? this.biz : free[Math.floor(this.rng() * free.length)];
    if (!gate || gate.busy) return null;
    const al = this._callsign(kind);
    const c = this._make(kind, al.col);
    c.name = al.call; c.gate = gate; gate.busy = c;
    c.track = this._approachTrack(c, opts.bearing);
    c.phase = 'approach';
    c.s = opts.s !== undefined ? opts.s : 0;
    c.speed = c.track.at(c.s, this._o).v;
    c.gearUp = true; c.gearK = 1;
    this.stats.arrivals++;
    this._note(`${c.name} inbound`);
    return c;
  }

  /** An airliner already at a gate, turning round (the boot's, so the field is alive). */
  spawnAtGate(kind = 'airliner', gate = null, wait = 30) {
    gate = gate || this.gates.find((g) => !g.busy);
    if (!gate) return null;
    const al = this._callsign(kind);
    const c = this._make(kind, al.col);
    c.name = al.call; c.gate = gate; gate.busy = c;
    this._park(c, wait);
    return c;
  }

  _park(c, wait) {
    const g = c.gate;
    c.phase = 'parked'; c.t = wait; c.track = null; c.speed = 0;
    c.h = Math.atan2(g.p1[0] - g.p0[0], g.p1[1] - g.p0[1]);   // nose in
    [c.x, c.z] = this._parkAt(c);
    c.y = this._ground(c.x, c.z); c.pitch = 0; c.roll = 0;
    c.gearUp = false; c.gearK = 0;
  }

  /** Where it stops on its stand: nose in, the nose gear on OSM's stop point (p1, where the apron gives way to grass before the terminal). */
  _parkAt(c) {
    const g = c.gate, h = Math.atan2(g.p1[0] - g.p0[0], g.p1[1] - g.p0[1]), back = c.v.halfLen * 0.75;
    return [g.p1[0] - Math.sin(h) * back, g.p1[1] - Math.cos(h) * back];
  }

  _ground(x, z) {
    const s = this.ykf.surface(x, z);
    return s !== null ? s : this.city.groundAt(x, z, null);
  }

  /** The entry point on a ring round the airport, inside the map. */
  _entry(bearing, R = 13000) {
    const dx = Math.sin(bearing), dz = -Math.cos(bearing);
    const lim = (G.MAP_HALF || 15600) - 600;
    let r = R;
    for (const [p, d] of [[this.cx, dx], [this.cz, dz]]) if (Math.abs(d) > 1e-3) r = Math.min(r, ((d > 0 ? lim : -lim) - p) / d);
    return [this.cx + dx * r, this.cz + dz * r];
  }

  /**
   * The approach to the runway in use: from `from` (else an entry on the
   * ring), via `via` (a go-around's climb-out), then straight in when it
   * comes from the approach side, else downwind, base and final; the final
   * is 6.5 km, a 2.8 degree glide to 15 m over the threshold.
   */
  _approachTrack(c, bearing, from = null, via = null) {
    const rw = this.rw, K = c.K, fe = this.fe, big = c.kind === 'airliner';
    const t = rw.t, ux = rw.ux, uz = rw.uz;
    const P = (along, side, y, v, r = 1300) => ({ x: t[0] + ux * along - uz * side, z: t[1] + uz * along + ux * side, y: fe + y, v, r });
    const safe = (w, agl) => { w.y = Math.max(w.y, G.terrainHeight(w.x, w.z) + agl); return w; };
    let E;
    if (from) E = { x: from.x, z: from.z, y: from.y, v: from.v, r: 900 };
    else {
      const [ex, ez] = this._entry(bearing !== undefined ? bearing : this.rng() * Math.PI * 2);
      E = safe({ x: ex, z: ez, y: fe + (big ? 1500 : 1100), v: big ? 135 : 115, r: 1300 }, 600);
    }
    // where it joins from, against the runway: along it (- is the approach side) and beside it
    const J = via || E;
    const along = (J.x - t[0]) * ux + (J.z - t[1]) * uz, side = -(J.x - t[0]) * uz + (J.z - t[1]) * ux;
    const sd = side >= 0 ? 1 : -1;
    const fin = [P(-6500, 0, 340, K.vApp + 4, 600), P(-1800, 0, 95, K.vApp), P(0, 0, 15, K.vTd + 2), P(380, 0, 0, K.vTd)];
    const wps = [E];
    if (via) wps.push(via);
    if (!via && along < -7000 && Math.abs(side) < -along * 0.6) {
      wps.push(safe(P(-12000, 0, 720, K.vApp + 30, 2500), 350));      // straight in
    } else {
      // downwind (joined abeam where it is), base, final
      const dw = 3400;
      if (along > -2000) wps.push(safe(P(Math.max(along - 1000, -1500), sd * dw, 760, K.vApp + 35), 400));
      wps.push(safe(P(-10000, sd * dw, 560, K.vApp + 18), 350), safe(P(-10000, 0, 480, K.vApp + 10), 300));
    }
    wps.push(...fin);
    for (let i = 1; i < wps.length - 3; i++) safe(wps[i], 150);
    return new Track(thin(wps, 50));
  }

  /** Departure: from the line-up point along the runway, rotate, climb out, leave the map. */
  _departTrack(c, x0, z0) {
    const rw = this.rw, K = c.K, fe = this.fe, big = c.kind === 'airliner';
    const t = rw.t, ux = rw.ux, uz = rw.uz;
    const a0 = (x0 - t[0]) * ux + (z0 - t[1]) * uz;
    const lo = a0 + (K.vr * K.vr) / (2 * K.acc) * 1.08;
    const P = (along, side, y, v, r = 1500, g = false) => ({ x: t[0] + ux * along - uz * side, z: t[1] + uz * along + ux * side, y: fe + y, v, r, g });
    const outB = this.rng() * Math.PI * 2;
    const [xx, xz] = this._entry(outB, 14000);
    const c1 = P(rw.L + 2600, 0, big ? 420 : 380, K.vr + 22);
    let dx = xx - c1.x, dz = xz - c1.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const wps = [P(a0, 0, 0, K.vr, 40, true), P(lo, 0, 0, K.vr, 40, true), P(lo + 600, 0, 45, K.vr + 6, 1500), c1,
      { x: c1.x + dx * Math.min(5000, dl * 0.4), z: c1.z + dz * Math.min(5000, dl * 0.4), y: fe + 1000, v: K.vr + 50, r: 1500 },
      { x: xx, z: xz, y: fe + 1900, v: K.vr + 80, r: 1500 }];
    for (const w of wps.slice(3)) w.y = Math.max(w.y, G.terrainHeight(w.x, w.z) + 300);
    return new Track(wps);
  }

  /** The rollout and the taxi in: along the runway from touchdown to an exit, then the graph to the gate. */
  _taxiInTrack(c) {
    const K = c.K, rw = this.rw;
    const tdAlong = (c.x - rw.t[0]) * rw.ux + (c.z - rw.t[1]) * rw.uz;
    const need = tdAlong + (c.speed * c.speed - K.taxi * K.taxi) / (2 * K.dec) + 60;
    // the first exit it can make (a join of the runway with a taxiway)
    const exits = this.rwNodes.filter(([a, , j]) => j && a > need && a < rw.L - 30);
    let exit = exits.length ? exits[0][1] : this.rwNodes[this.rwNodes.length - 1][1];
    let route = this.graph.route(exit, c.gate.node, 25);
    if (!route) { exit = this.rwNodes[this.rwNodes.length - 1][1]; route = this.graph.route(exit, c.gate.node, 25) || [exit]; }
    const g = this.graph.nodes;
    const wps = [{ x: c.x, z: c.z, y: 0, v: c.speed, r: 30, g: true, rw: true }];
    // the runway up to the exit, then the route
    const ex = g[exit];
    wps.push({ x: ex.x - rw.ux * 50, z: ex.z - rw.uz * 50, y: 0, v: K.taxi + 6, r: 40, g: true, rw: true });
    wps.push(...groundWps(this.graph, route, K.taxi, 30));
    const [px, pz] = this._parkAt(c);
    wps.push({ x: px, z: pz, y: 0, v: 2, r: 20, g: true, keep: true });
    return this._groundTrack(thin(wps), c, true);
  }

  /** A ground track's speed: corners capped by their radius, decelerating into them and to a stop at the end. */
  _groundTrack(wps, c, stopAtEnd) {
    const tr = new Track(wps);
    const K = c.K, P = tr.P, N = P.length, S = tr.s;
    const cap = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      if (i === 0 || i === N - 1) { cap[i] = P[i][3] > K.taxi + 1 ? P[i][3] : K.taxi; continue; }
      const a = P[i - 1], b = P[i], d = P[i + 1];
      const h0 = Math.atan2(b[0] - a[0], b[1] - a[1]), h1 = Math.atan2(d[0] - b[0], d[1] - b[1]);
      const len = Math.hypot(d[0] - a[0], d[1] - a[1]) || 1;
      const k = Math.abs(wrap(h1 - h0)) / len;
      cap[i] = Math.min(P[i][3] > K.taxi + 1 ? P[i][3] : K.taxi, k > 1e-4 ? Math.sqrt(1.6 / k) + 1.5 : 99);
    }
    if (stopAtEnd) cap[N - 1] = 0;
    // backward: decelerate into every cap
    for (let i = N - 2; i >= 0; i--) cap[i] = Math.min(cap[i], Math.sqrt(cap[i + 1] * cap[i + 1] + 2 * K.dec * (S[i + 1] - S[i])));
    for (let i = 0; i < N; i++) P[i][3] = cap[i];
    return tr;
  }

  /** Pushed back off the gate onto the taxilane, tail away from where it will taxi. */
  _pushTrack(c, dirX, dirZ) {
    const g = c.gate;
    const wps = [{ x: c.x, z: c.z, y: 0, v: 1.6, r: 18, g: true },
      { x: g.p0[0], z: g.p0[1], y: 0, v: 1.6, r: 22, g: true },
      { x: g.p0[0] - dirX * 34, z: g.p0[1] - dirZ * 34, y: 0, v: 0.8, r: 22, g: true }];
    return new Track(wps);
  }

  /** From the end of the pushback to the holding point short of the runway in use. */
  _taxiOutTrack(c, x0, z0) {
    const K = c.K, rw = this.rw;
    // the join nearest the threshold, within its first 400 m
    const joins = this.rwNodes.filter(([a, , j]) => j && a < 400);
    const thr = (joins.length ? joins[0] : this.rwNodes[0])[1];
    // hold short: the last off-runway node on the route
    const start = this.graph.nearest(x0, z0, true);
    let route = this.graph.route(start, thr, 25) || [start, thr];
    const g = this.graph.nodes;
    let k = route.length - 1;
    while (k > 0 && !g[route[k - 1]].adj.some((e) => !e[2] && e[0] === route[k])) k--;
    // hold short where the taxiway is the runway's half-width and 30 m off its centreline
    const hold = route.slice(0, k);
    const thrN = g[route[k]];
    const off = (n) => Math.abs(-(n.x - rw.t[0]) * rw.uz + (n.z - rw.t[1]) * rw.ux);
    const need = rw.w / 2 + 30;
    let cut = hold.length;
    while (cut > 1 && off(g[hold[cut - 1]]) < need) cut--;
    const wps = [{ x: x0, z: z0, y: 0, v: K.taxi, r: 20, g: true }, ...groundWps(this.graph, hold.slice(0, cut), K.taxi, 30)];
    if (cut < hold.length && cut > 0) {
      // the point on the leg out of the last node kept, `need` off the centreline
      const A = g[hold[cut - 1]], B = g[hold[cut]];
      const oa = off(A), ob = off(B), f = clamp((oa - need) / Math.max(0.01, oa - ob), 0, 1);
      wps.push({ x: lerp(A.x, B.x, f), z: lerp(A.z, B.z, f), y: 0, v: 3, r: 20, g: true, keep: true });
    }
    c.holdPath = hold.slice(cut).concat(route.slice(k, k + 1));
    c.thr = g[route[route.length - 1]];
    return this._groundTrack(thin(wps), c, true);
  }

  _lineUpTrack(c) {
    const rw = this.rw, thr = c.thr, g = this.graph.nodes;
    const a = (thr.x - rw.t[0]) * rw.ux + (thr.z - rw.t[1]) * rw.uz;
    const at = Math.max(a, 30) + 70;
    const wps = [{ x: c.x, z: c.z, y: 0, v: 5, r: 25, g: true },
      ...(c.holdPath || []).map((j) => ({ x: g[j].x, z: g[j].z, y: 0, v: 5, r: 30, g: true })),
      { x: thr.x, z: thr.z, y: 0, v: 5, r: 35, g: true },
      { x: rw.t[0] + rw.ux * at, z: rw.t[1] + rw.uz * at, y: 0, v: 3, r: 30, g: true, keep: true }];
    return this._groundTrack(thin(wps, 6), c, true);
  }

  // --- the circuit, the cross-country, the helicopter ------------------------------------------

  spawnCircuit() {
    const rw = this.cRw, fe = rw.y;
    const c = this._make('circuit', 0xf3f4f2);
    c.name = `C-G${'WWF'[Math.floor(this.rng() * 3)]}${String.fromCharCode(65 + Math.floor(this.rng() * 26))}${String.fromCharCode(65 + Math.floor(this.rng() * 26))}`;
    const t = rw.t, ux = rw.ux, uz = rw.uz;
    // left-hand: the pattern lies to the left of the landing direction
    const P = (along, left, y, v, r = 260, g = false) => ({ x: t[0] + ux * along + uz * left, z: t[1] + uz * along - ux * left, y: fe + y, v, r, g });
    c.wps = [P(160, 0, 0, 27, 60, true), P(470, 0, 0, 29, 60, true), P(rw.L + 500, 0, 150, 34), P(rw.L + 500, 1300, 300, 38),
      P(-1100, 1300, 300, 38), P(-1250, 0, 95, 31, 240), P(-500, 0, 40, 29, 60)];
    c.track = new Track(c.wps, true);
    c.s = c.track.len * 0.5; c.speed = 36;
    c.phase = 'circuit'; c.gearUp = false;
    return c;
  }

  spawnXc() {
    const c = this._make('xc', 0xd6dde6);
    const wps = XC_LOOP.map(([x, z]) => {
      let top = 0;
      for (let a = 0; a < 6; a++) for (const r of [0, 600, 1200]) top = Math.max(top, G.terrainHeight(x + Math.cos(a) * r, z + Math.sin(a) * r));
      return { x, z, y: top + 420, v: 52, r: 900 };
    });
    c.track = new Track(wps, true);
    for (const p of c.track.P) p[2] = Math.max(p[2], G.terrainHeight(p[0], p[1]) + 300);
    c.s = this.rng() * c.track.len; c.speed = 52;
    c.phase = 'xc'; c.gearUp = false;
    return c;
  }

  spawnHeli() {
    const c = this._make('heli', 0xc8202c);
    c.name = 'the news helicopter';
    c.phase = 'heli';
    c.tour = Math.floor(this.rng() * HELI_TOUR.length);
    const [x, z] = HELI_TOUR[c.tour];
    c.x = x + 300; c.z = z; c.y = G.terrainHeight(c.x, c.z) + 200; c.h = 0;
    c.vx = 0; c.vz = 0; c.orbit = 40 + this.rng() * 30; c.ang = 0;
    return c;
  }

  // --- the frame ----------------------------------------------------------------------------------

  /** The runway in use is occupied (by you, or an aircraft rolling or lined up on it). */
  runwayBusy(rw, player, except = null) {
    const occ = (x, z, y) => {
      const dx = x - rw.t[0], dz = z - rw.t[1], a = dx * rw.ux + dz * rw.uz, l = -dx * rw.uz + dz * rw.ux;
      return a > -90 && a < rw.L + 90 && Math.abs(l) < rw.w / 2 + 14 && y < rw.y + 18;
    };
    if (player) { const p = player.position; if (occ(p.x, p.z, p.y)) return 'you'; }
    for (const c of this.craft) {
      if (c === except || c.kind === 'heli' || c.kind === 'xc') continue;
      if (c.phase === 'lineup' || c.phase === 'takeoff' || c.phase === 'rollout' || (c.onGround && c.phase !== 'parked')) {
        if (occ(c.x, c.z, c.y)) return c;
      }
    }
    return null;
  }

  update(dt, player, camera) {
    if (!this.ok || dt <= 0) return;
    this.t += dt;
    this.radioCd = Math.max(0, this.radioCd - dt);
    this.player = player;
    // keep the sky populated
    if (this._count('circuit') < this.max.circuit) this.spawnCircuit();
    if (this._count('xc') < this.max.xc) this.spawnXc();
    if (this._count('heli') < this.max.heli) this.spawnHeli();
    if ((this.nextArr -= dt) <= 0) {
      this.nextArr = (this.phone ? 150 : 95) + this.rng() * 80;
      const inbound = this.craft.filter((c) => c.phase === 'approach' && c.kind === 'airliner').length;
      if (this._count('airliner') < this.max.airliner && inbound === 0) this.spawnArrival('airliner');
    }
    if (this.max.biz && (this.nextBiz -= dt) <= 0) {
      this.nextBiz = 200 + this.rng() * 200;
      if (this._count('biz') < this.max.biz && !this.craft.some((c) => c.phase === 'approach')) this.spawnArrival('biz');
    }
    for (const c of [...this.craft]) {
      if (c.kind === 'heli') this._heli(c, dt, player);
      else if (c.phase === 'circuit' || c.phase === 'xc') this._loop(c, dt, player);
      else this._step(c, dt, player);
      if (!c.gone) this._pose(c, dt, camera);
    }
  }

  _note(m) { this.log.push(`${this.t.toFixed(1)} ${m}`); if (this.log.length > 60) this.log.shift(); }

  /** Tower chatter as a toast, when you are near enough the field to hear it. */
  _radio(text, player) {
    const hud = this.o.hud;
    if (!hud || this.radioCd > 0 || !player) return;
    const p = player.position;
    if (Math.hypot(p.x - this.cx, p.z - this.cz) > 3200) return;
    this.radioCd = 10;
    hud.showToast(`YKF Tower: ${text}`, 3400);
  }

  /** Anything in the way ahead of a taxiing aircraft: how far to it (Infinity when clear). */
  _blocked(c, player) {
    const fx = Math.sin(c.h) * (c.rev ? -1 : 1), fz = Math.cos(c.h) * (c.rev ? -1 : 1);
    const reach = c.v.halfLen + 14 + c.speed * c.speed / (2 * 2.0);
    const lat = c.K.span * 0.8 + 3;
    let best = Infinity;
    const test = (x, z, y, r) => {
      if (Math.abs(y - c.y) > 8) return;
      const dx = x - c.x, dz = z - c.z, a = dx * fx + dz * fz, l = Math.abs(-dx * fz + dz * fx);
      if (a > 0 && a < reach + r && l < lat + r) best = Math.min(best, a - r);
    };
    if (player) { const p = player.position, pv = player.vehicle; test(p.x, p.z, p.y, pv ? pv.radius || 2 : 0.6); }
    // (held 25 s by another aircraft: a deadlock on a taxilane -- go round it)
    if (c.hold < 25) for (const o of this.craft) if (o !== c && o.onGround) test(o.x, o.z, o.y, o.v.halfLen * 0.8);
    return best;
  }

  _step(c, dt, player) {
    const K = c.K, o = this._o;
    switch (c.phase) {
      case 'approach': {
        c.speed = approach(c.speed, c.track.at(c.s, o).v, 2 * dt, 2 * dt);
        c.s += c.speed * dt;
        const left = c.track.len - c.s;
        c.gearUp = left > 9000;
        if (left < 7000 && !c.cleared) { c.cleared = true; this._radio(`${c.name}, runway ${this.rwId}, cleared to land`, player); }
        // short final and the runway is not clear: go around
        if (left < 1700 && left > 300 && this.runwayBusy(this.rw, player, c)) { this._goAround(c, player); break; }
        if (left <= 0.5) {
          c.track.at(c.track.len, o);
          c.x = o.x; c.z = o.z; c.y = this._ground(c.x, c.z); c.h = o.h;
          c.phase = 'rollout'; c.speed = Math.min(c.speed, K.vTd + 4);
          c.track = this._taxiInTrack(c); c.s = 0;
          this.stats.landed++;
          this._note(`${c.name} touched down`);
        }
        break;
      }
      case 'rollout': case 'taxiIn': case 'taxiOut': case 'push': case 'lineup': {
        const cap = c.track.at(c.s, o).v;
        let want = cap;
        if (c.phase !== 'rollout') {
          const b = this._blocked(c, player);
          // the gap is from its middle: stop with the nose (or tail) 7 m short
          const nose = c.v.halfLen + 7;
          if (b < Infinity) want = Math.min(want, Math.max(0, (b - nose) * 0.35));
          if (b < nose + 1) { want = 0; c.hold += dt; } else c.hold = 0;
        }
        c.speed = approach(c.speed, want, (c.phase === 'push' ? 0.5 : 1.2) * dt, (c.phase === 'rollout' ? K.dec : 2.5) * dt);
        c.s += c.speed * dt;
        if (c.phase === 'rollout' && c.speed <= K.taxi + 0.5) c.phase = 'taxiIn';
        if (c.s >= c.track.len - 0.3) { c.s = c.track.len; this._arrive(c, player); }
        break;
      }
      case 'parked': {
        c.t -= dt;
        if (c.t <= 0) {
          const pb = this._blocked({ ...c, h: c.h + Math.PI, speed: 1 }, player);
          if (pb < 30) { c.t = 5; break; }
          // which way it will taxi from the lane: toward the runway
          const g = c.gate, joins = this.rwNodes.filter(([a, , j]) => j && a < 400);
          const thr = this.graph.nodes[(joins.length ? joins[0] : this.rwNodes[0])[1]];
          const route = this.graph.route(g.node, this.graph.nearest(thr.x, thr.z), 25) || [g.node];
          const nxt = this.graph.nodes[route[Math.min(route.length - 1, 3)]];
          let dx = nxt.x - g.p0[0], dz = nxt.z - g.p0[1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
          c.track = this._pushTrack(c, dx, dz); c.s = 0; c.speed = 0;
          c.phase = 'push'; c.rev = true;
          c.pushDir = [dx, dz];
          this._note(`${c.name} pushing back`);
        }
        break;
      }
      case 'holdShort': {
        c.t += dt;
        const inbound = this.craft.some((q) => q.phase === 'approach' && q.track.len - q.s < (q.kind === 'airliner' ? 8000 : 6500));
        const busy = this.runwayBusy(this.rw, player, c);
        if (!inbound && !busy && c.t > 4) {
          c.phase = 'lineup'; c.track = this._lineUpTrack(c); c.s = 0;
          this._radio(`${c.name}, runway ${this.rwId}, line up and wait`, player);
        } else if (busy === 'you' && c.t > 6 && !c.toldYou) { c.toldYou = true; this.stats.holds++; this._radio(`${c.name}, hold short. Vehicle on the runway`, player); }
        break;
      }
      case 'takeoff': {
        c.t += dt;
        const tgt = c.track.at(c.s, o);
        const roll = tgt.g;
        if (roll && c.t < 3) { c.speed = 0; if (this.runwayBusy(this.rw, player, c) === 'you') c.t = 0; break; }
        c.speed = roll ? Math.min(c.speed + K.acc * dt, Math.max(tgt.v, c.speed)) : approach(c.speed, tgt.v, 2.5 * dt, 1 * dt);
        c.s += c.speed * dt;
        c.gearUp = !roll && c.y - this.fe > 30;
        if (c.s >= c.track.len - 1) { this._note(`${c.name} left the map`); this._remove(c); }
        break;
      }
      default: break;
    }
  }

  _arrive(c, player) {
    if (c.phase === 'taxiIn' || c.phase === 'rollout') {
      this._park(c, (this.phone ? 50 : 70) + this.rng() * 50);
      this._note(`${c.name} on stand ${c.gate.ref}`);
    } else if (c.phase === 'push') {
      c.rev = false;
      c.phase = 'taxiOut'; c.track = this._taxiOutTrack(c, c.x, c.z); c.s = 0; c.speed = 0;
      if (c.gate) { c.gate.busy = null; c.gate = null; }
      this._radio(`${c.name}, taxi to runway ${this.rwId}`, player);
    } else if (c.phase === 'taxiOut') {
      c.phase = 'holdShort'; c.t = 0;
    } else if (c.phase === 'lineup') {
      c.phase = 'takeoff'; c.t = 0;
      c.track = this._departTrack(c, c.x, c.z); c.s = 0; c.speed = 0;
      this.stats.departures++;
      this._radio(`${c.name}, runway ${this.rwId}, cleared for take-off`, player);
      this._note(`${c.name} cleared for take-off`);
    }
  }

  _goAround(c, player) {
    this.stats.goArounds++;
    this._note(`${c.name} going around`);
    this._radio(`${c.name}, go around. Runway ${this.rwId} is occupied`, player);
    const rw = this.rw, o = c.track.at(c.s, this._o);
    // straight ahead, climbing, then round the circuit to a new final
    const a = (o.x - rw.t[0]) * rw.ux + (o.z - rw.t[1]) * rw.uz;
    const up = { x: rw.t[0] + rw.ux * (a + 3500), z: rw.t[1] + rw.uz * (a + 3500), y: this.fe + 600, v: c.K.vApp + 30, r: 1100 };
    c.track = this._approachTrack(c, undefined, { x: o.x, z: o.z, y: o.y, v: c.speed }, up);
    c.s = 0; c.cleared = false; c.gearUp = false;
  }

  /** The circuit and the cross-country: closed tracks, for ever (a low pass when the runway is not clear). */
  _loop(c, dt, player) {
    const o = c.track.at(c.s, this._o);
    c.speed = approach(c.speed, o.v, 3 * dt, 3 * dt);
    c.s = (c.s + c.speed * dt) % c.track.len;
    if (c.phase === 'circuit') {
      // decide each lap, on short final: touch and go, or a low pass
      const fin = c.track.len - 1400;
      if (c.s > fin && c.s < fin + 40 && !c.decided) {
        c.decided = true;
        c.low = !!this.runwayBusy(this.cRw, player, c);
        if (c.low) this._note(`${c.name} low pass`);
      }
      if (c.s < 600 && c.s > 500) c.decided = false;
    }
  }

  _heli(c, dt, player) {
    const [px, pz] = HELI_TOUR[c.tour];
    const d = Math.hypot(px - c.x, pz - c.z);
    let tx, tz;
    if (c.orbit > 0 && d < 420) {
      c.orbit -= dt;
      c.ang += dt * 34 / 240;
      tx = px + Math.cos(c.ang) * 240; tz = pz + Math.sin(c.ang) * 240;
      if (c.orbit <= 0) c.tour = (c.tour + 1) % HELI_TOUR.length;
    } else {
      if (c.orbit <= 0) c.orbit = 50 + this.rng() * 40;
      tx = px; tz = pz;
      if (d < 420) c.ang = Math.atan2(c.z - pz, c.x - px);
    }
    let wx = tx - c.x, wz = tz - c.z;
    const wl = Math.hypot(wx, wz) || 1, top = c.orbit > 0 && d < 420 ? 34 : 52;
    wx = wx / wl * Math.min(top, wl * 0.6); wz = wz / wl * Math.min(top, wl * 0.6);
    const ax = clamp(wx - c.vx, -6 * dt, 6 * dt), az = clamp(wz - c.vz, -6 * dt, 6 * dt);
    c.vx += ax; c.vz += az;
    c.x += c.vx * dt; c.z += c.vz * dt;
    const sp = Math.hypot(c.vx, c.vz);
    const gy = Math.max(G.terrainHeight(c.x, c.z), G.terrainHeight(c.x + c.vx * 8, c.z + c.vz * 8)) + 190;
    c.y = lerp(c.y, gy, 1 - Math.exp(-0.5 * dt));
    if (sp > 2) {
      const want = Math.atan2(c.vx, c.vz);
      const dh = clamp(wrap(want - c.h), -0.5 * dt, 0.5 * dt);
      c.h += dh;
      c.turnRate = dh / dt;
    }
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    c.pitch = lerp(c.pitch, clamp((ax * fx + az * fz) / dt * 0.03 + sp * 0.0022, -0.2, 0.2), 1 - Math.exp(-2 * dt));
    c.roll = lerp(c.roll, clamp(-(c.turnRate || 0) * sp / 9.8, -0.4, 0.4), 1 - Math.exp(-2 * dt));
    c.speed = sp;
  }

  /** Put the vehicle where its track (or its own sim) says, banked and pitched; detail by distance. */
  _pose(c, dt, camera) {
    const v = c.v, o = this._o;
    if (c.kind !== 'heli' && c.phase !== 'parked') {
      c.track.at(c.s, o);
      c.x = o.x; c.z = o.z;
      const gy = this._ground(o.x, o.z);
      let y = o.g ? gy : Math.max(o.y, gy);
      if (c.phase === 'circuit' && c.low && (c.s > c.track.len - 1300 || c.s < 700)) y = Math.max(y, gy + 32);
      c.onGround = y - gy < 0.4;
      c.y = y;
      const h = c.rev ? o.h + Math.PI : o.h;
      c.h = c.onGround || Math.abs(wrap(h - c.h)) > 2.5 ? h : c.h + wrap(h - c.h) * Math.min(1, dt * 6);
      // bank from the track's turn at the current speed, pitch from its climb (+ the wing's angle at low speed)
      const yawRate = o.turn * c.speed;
      const bank = c.onGround ? 0 : clamp(-Math.atan(c.speed * yawRate / 9.8), -0.55, 0.55);
      const aoa = c.onGround ? 0 : c.kind === 'airliner' || c.kind === 'biz' ? (c.speed < 90 ? 0.04 + (90 - c.speed) * 0.002 : 0.03) : 0.05;
      let pitch = c.onGround ? 0 : -(Math.atan(o.climb) + aoa);
      // rotation: the nose comes up over the last seconds of the roll
      if (c.phase === 'takeoff' && o.g && c.speed > c.K.vr - 6) pitch = -0.17 * clamp((c.speed - c.K.vr + 6) / 6, 0, 1);
      // the flare
      if (c.phase === 'approach' && c.track.len - c.s < 500) pitch = Math.min(pitch, -0.06);
      c.roll = lerp(c.roll, bank, 1 - Math.exp(-2.5 * dt));
      c.pitch = lerp(c.pitch, pitch, 1 - Math.exp(-3 * dt));
    }
    v.x = c.x; v.y = c.y; v.z = c.z; v.heading = c.h; v.pitch = c.pitch; v.roll = c.roll;
    v.vLong = c.rev ? -c.speed : c.speed;
    v.airborne = !c.onGround && c.kind !== 'heli' ? true : c.kind === 'heli';
    // drawn only within its range of the camera, detailed (live props, gear) close
    const cam = camera ? camera.position : { x: c.x, y: c.y, z: c.z };
    const d = Math.hypot(cam.x - c.x, cam.y - c.y, cam.z - c.z);
    const show = d < c.K.show;
    if (v.group.visible !== show) v.group.visible = show;
    if (!show) return;
    const near = d < (this.phone ? DETAIL_R * 0.6 : DETAIL_R);
    if (near !== c.detailed) {
      c.detailed = near;
      v.setDetailed(near);
      v.mode = 'air';
      if (c.kind === 'heli') for (const m of v.spinMeshes) if (m.userData.axis === 'x') m.visible = false;
    }
    const cast = c.onGround && d < (this.phone ? 140 : 260);
    if (cast !== c.cast) { c.cast = cast; for (const m of [v.paintMesh, v.trimMesh, v.matteMesh]) m.castShadow = cast; }
    if (c.detailed) {
      if (c.kind === 'heli') v.spinParts(dt, 0, 34, 70);
      else v.spinParts(dt, c.kind === 'circuit' || c.kind === 'xc' ? 120 : 0);
      if (v.spec.retract) {
        c.gearK = approach(c.gearK, c.gearUp ? 1 : 0, dt / 2.5, dt / 2.5);
        for (const m of v.spinMeshes) if (m.userData.axis === 'g') {
          m.scale.set(1 - 0.5 * c.gearK, Math.max(0.02, 1 - c.gearK), 1 - 0.5 * c.gearK);
          m.visible = c.gearK < 0.97;
        }
      }
    }
    v.sync();
  }

  // --- for main.js -----------------------------------------------------------------------------

  /** The news helicopter nearest (x, z), for the rotor sound: its position, or null. */
  nearestHeli(x, z) {
    for (const c of this.craft) if (c.kind === 'heli' && c.v.group.visible && Math.hypot(c.x - x, c.z - z) < 900) return c.v.group.position;
    return null;
  }

  /** Aircraft near enough to hear (traffic's engine voices take them from this). */
  audible(out, x, z) {
    for (const c of this.craft) if (c.kind !== 'heli' && c.v.group.visible && Math.hypot(c.x - x, c.z - z) < 300) out.push(c.v);
  }

  /** Debug: run the sim forward `secs` at 1/30 s (headless harnesses). */
  advance(secs, player, camera, step = 1 / 30) {
    for (let t = 0; t < secs; t += step) this.update(step, player, camera);
  }

  /** Debug: one aircraft's state. */
  state(c) {
    return { kind: c.kind, name: c.name, phase: c.phase, x: +c.x.toFixed(1), y: +c.y.toFixed(1), z: +c.z.toFixed(1),
      h: +c.h.toFixed(3), speed: +c.speed.toFixed(1), s: +(c.s || 0).toFixed(0), len: c.track ? +c.track.len.toFixed(0) : 0, onGround: c.onGround };
  }
}
