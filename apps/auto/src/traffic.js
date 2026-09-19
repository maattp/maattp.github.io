// Traffic, parked cars and the police response.

import * as THREE from './three.js';
import { Vehicle, CIVILIAN_TYPES, randomCarColor, vehicleAssets } from './vehicles.js';
import { clamp, lerp, angleWrap, hash2, rng, dist2 } from './util.js';
import * as G from './geo.js';

const TRAFFIC_TARGET = 26;
// Parked cars only exist within this radius, and each is 3 draw calls, so this
// is a draw-call dial as much as a distance one.
const PARKED_RADIUS = 105;
const LOT_TYPES = new Set(['sedan', 'suv', 'pickup', 'compact', 'hatch', 'ev', 'muscle', 'sports', 'convertible']);
const DESPAWN = 520;

/**
 * Free everything under a node.
 *
 * Only safe on geometry that is genuinely per-instance. Vehicles share their
 * geometry and their trim/matte materials across every instance in the game --
 * see the "never dispose a pooled geometry" law in CLAUDE.md, which is the same
 * trap one level down.
 */
function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) m.dispose();
  });
}

export function collideWithBuildings(v, city, onHit) {
  // Street objects first: a tree or a lamp post is closer than the building
  // line and is what you actually hit coming off a kerb. Until this existed
  // the only solid thing in the entire map was a building, so every tree in
  // Seattle was scenery you drove straight through.
  //
  // Softer than a wall: a mast shears and a trunk gives, so the car is pushed
  // out and loses most of its speed rather than stopping dead against it.
  const ob = city.obstacleHit(v.x, v.z, v.radius * 0.7, v.y);
  if (ob) {
    v.x += ob.nx * ob.pen;
    v.z += ob.nz * ob.pen;
    const f = v.forward;
    const along = f.x * ob.nx + f.z * ob.nz;
    const impact = Math.abs(v.vLong) * Math.abs(along) * 0.7 + Math.abs(v.vLat) * 0.3;
    // A SCRAPE IS NOT A CRASH. The push-out took 80 % of the speed whatever
    // the angle, so a vehicle grazing a wall side-on -- along ~ 0 -- lost it
    // every frame it stayed in contact and wedged at full throttle. Measured:
    // a bus in the right lane of SR-99's upper deck, its collision circle
    // (0.7 x radius + the barrier's 0.8 m, 4.3 m) touching the bore wall, stopped
    // dead and a column queued behind it. Head-on (along <= -0.3, ~17 deg or
    // more into the obstacle) keeps the full loss; shallower keeps
    // proportionally more, and a pure side contact keeps all of it.
    const glance = clamp(-along / 0.3, 0, 1);
    v.vLong *= along > 0.05 ? -0.1 : 1 - 0.8 * glance;
    v.vLat *= 0.3;
    if (onHit && impact > 3) onHit(impact);
    return impact;
  }
  const near = city.buildingsNear(v.x, v.z, 14);
  for (const b of near) {
    const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
    const dx = v.x - b.x, dz = v.z - b.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const ex = b.w / 2 + v.radius * 0.8, ez = b.d / 2 + v.radius * 0.8;
    if (Math.abs(lx) > ex || Math.abs(lz) > ez) continue;
    if (v.y > b.y + b.h - 1) continue;
    // A TUNNEL PASSES UNDER BUILDINGS, and this test is 2D. The skip above
    // frees a plane over the roof; nothing freed a car UNDER the base, so a
    // bore under downtown ended at the first footprint overhead -- an
    // invisible wall ~140 m into SR-99, hit at the same station on every run.
    // "You can't even traverse this damn tunnel" was this line.
    //
    // Underground is judged against the PRE-CUT ground under the car,
    // terrainRaw, and both alternatives shipped a bug each. The building's
    // stored base height b.y is terrain sampled once at the footprint's
    // centroid, and a large box on a Seattle grade drops more than 2.5 m from
    // centroid to corner -- reviewer-caught; it let cars through the downhill
    // corner of big sloped buildings. terrainHeight is carved near portals, so
    // where the cut tapers it hugs the deck, the difference read ~0, and the
    // invisible wall came back at the corridor's end -- measured, the same
    // traversal that passed 20/20 waypoints stalled at 5 again. Raw ground is
    // what "underground" actually means.
    if (G.terrainRaw(v.x, v.z) - v.y > 2.5) continue;
    const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
    let nx, nz, pen;
    if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; pen = px; }
    else { nx = 0; nz = Math.sign(lz) || 1; pen = pz; }
    const wx = nx * c + nz * s;
    const wz = -nx * s + nz * c;
    v.x += wx * pen;
    v.z += wz * pen;
    const f = v.forward;
    const along = f.x * wx + f.z * wz;
    const impact = Math.abs(v.vLong) * Math.abs(along) + Math.abs(v.vLat) * 0.4;
    v.vLong *= along > 0 ? -0.18 : 0.28;
    v.vLat *= 0.2;
    if (onHit && impact > 3) onHit(impact);
    return impact;
  }
  return 0;
}

// --- one-way streets ---------------------------------------------------------
//
// FLAG SEMANTICS, confirmed against tools/build_roads.py: an edge's a -> b is
// the OSM way's own node order (the importer never reverses a way, and pack()
// writes edges as [a, b] in that order). `oneway=yes` (and every roundabout)
// sets F_ONEWAY: travel a -> b only. `oneway=-1` sets F_ONEWAY | F_ONEWAY_REV:
// travel b -> a only. So `onewayRev` never appears without `oneway`.
//
// One more case the flags cannot say: I-5's express lanes are
// `oneway=reversible`, which the importer maps to nothing, so they arrive as
// TWO-WAY motorway with their ramps as two-way links -- a single carriageway
// with traffic spawned in both directions, head-on. Every reversible way in the
// extract is drawn northbound (47 of 47, checked against raw_roads.json), so
// they are driven as their drawn direction: the afternoon configuration. The
// test below is exact for this extract: every untagged motorway way is an
// express way, and the only untagged links are the express ramps plus four
// `oneway=no` ones, which lose nothing by being one-way.
function edgeFlow(e) {
  if (e.oneway) return e.onewayRev ? -1 : 1;
  if (e.cls === 'ramp') return 1;
  if (e.cls === 'hwy' && /Express|Ship Canal Bridge/.test(e.name || '')) return 1;
  return 0;
}

/**
 * Strongly connected components of the directed street graph (two-way edges
 * both ways, one-way edges their legal way only), iterative Tarjan.
 *
 * Imported one-way chains end in dead ends -- 650 one-way stubs end at a node
 * with nothing else on it, 18 more meet a junction with no legal way out, and
 * 471 leave the map at the rim. A car that only ever moves to a node in the
 * component it is already in can never reach one of those, because from any
 * node of a component there is a legal way on that stays inside it. So spawns
 * are restricted to components and turns keep to them: no car can get stuck at
 * the end of a one-way street, and none has to U-turn against the flow.
 */
function directedComponents(city, flow) {
  const N = city.nodes.length;
  const comp = new Int32Array(N).fill(-1);
  const index = new Int32Array(N).fill(-1);
  const low = new Int32Array(N);
  const onStack = new Uint8Array(N);
  const stack = [];
  const sizes = [];
  let next = 0;
  const callN = [], callI = [];
  const out = (n, k) => {
    const ei = city.nodes[n].e[k];
    const e = city.edges[ei], f = flow[ei];
    if (f === 0 || (f === 1 ? e.a === n : e.b === n)) return e.a === n ? e.b : e.a;
    return -1;
  };
  for (let root = 0; root < N; root++) {
    if (index[root] >= 0) continue;
    callN.push(root); callI.push(0);
    index[root] = low[root] = next++; stack.push(root); onStack[root] = 1;
    while (callN.length) {
      const top = callN.length - 1, n = callN[top];
      const ne = city.nodes[n].e.length;
      if (callI[top] < ne) {
        const m = out(n, callI[top]++);
        if (m < 0) continue;
        if (index[m] < 0) {
          index[m] = low[m] = next++; stack.push(m); onStack[m] = 1;
          callN.push(m); callI.push(0);
        } else if (onStack[m] && index[m] < low[n]) low[n] = index[m];
        continue;
      }
      if (low[n] === index[n]) {
        const id = sizes.length;
        let sz = 0, m;
        do { m = stack.pop(); onStack[m] = 0; comp[m] = id; sz++; } while (m !== n);
        sizes.push(sz);
      }
      callN.pop(); callI.pop();
      if (callN.length) { const p = callN[callN.length - 1]; if (low[n] < low[p]) low[p] = low[n]; }
    }
  }
  return { comp, sizes };
}

// Spawns only go on components at least this big: a few-node loop is a car
// circling one block forever.
const MIN_COMPONENT = 60;
// Lanes on a one-way street are at least 4.2 m apart. A real lane is 3.6 m, but
// resolveCarCollisions tests CIRCLES of radius 0.42 x length -- 2.0 m for a
// sedan -- so two cars abreast in 3.6 m lanes overlap and shove each other
// sideways the whole way down the street. A one-way street with parking keeps
// 2.2 m clear at each kerb for the parked cars (they sit at hw - 1.15, see
// updateParked); anything else keeps a 0.8 m shoulder.
const LANE_W = 4.2, PARK_EDGE = 2.2, SHOULDER = 0.8;

export class TrafficSystem {
  constructor(scene, city, game) {
    this.scene = scene;
    this.city = city;
    this.game = game;
    this.cars = [];
    this.parkedSlots = new Set();
    this.R = rng(99);
    this.heli = null;
    this.spawnTimer = 0;
    this.copTimer = 0;
    vehicleAssets();
    // Legal direction per edge (+1 a->b, -1 b->a, 0 both) and the directed
    // components; see edgeFlow / directedComponents.
    const E = city.edges;
    this.flow = new Int8Array(E.length);
    for (let i = 0; i < E.length; i++) this.flow[i] = edgeFlow(E[i]);
    const cc = directedComponents(city, this.flow);
    this.comp = cc.comp;
    this.compSize = cc.sizes;
    // Lane span per one-way edge, lazily: [lo, hi, lanes] in the edge's own
    // perpendicular (+ = the side to the right of a->b). NaN = not computed.
    this.lanes = new Float32Array(E.length * 3).fill(NaN);
    // Counters for tools/trafficcheck.mjs: dead ends a car still reached, and
    // turns that had to fall back past the normal choice.
    this.stats = { deadEnd: 0, deadEndDespawn: 0, fallbackTurn: 0, stuckRecycled: 0 };
  }

  /** May a car drive edge ei in direction `sign` (+1 = a -> b)? */
  allowed(ei, sign) {
    const f = this.flow[ei];
    return f === 0 || f === sign;
  }

  /**
   * Lateral offset of a car's lane, positive to the right of its direction of
   * travel. A two-way street keeps right of the centreline at 0.48 hw, as it
   * always has. A one-way street has no centreline: its lanes are laid across
   * the whole carriageway (less parking or shoulder), and each car keeps the
   * lane fraction it was spawned with, so a car holds its lane down a freeway
   * (lanes 4.2 m apart: see LANE_W, so a 3-lane carriageway runs 2 AI lanes).
   */
  laneLat(ei, sign, v) {
    const e = this.city.edges[ei];
    if (this.flow[ei] === 0) return e.hw * 0.48;
    const L = this.lanes, k = ei * 3;
    if (Number.isNaN(L[k])) {
      // A graded carriageway can be trimmed back where it runs over another
      // (e.tw, per sample and side): lanes stay inside the narrowest point.
      let w0 = e.hw, w1 = e.hw;
      if (e.tw) {
        for (let i = 0; i < e.tw.length; i += 2) {
          if (e.tw[i] < w0) w0 = e.tw[i];
          if (e.tw[i + 1] < w1) w1 = e.tw[i + 1];
        }
      }
      // An OPPOSING carriageway overlapping this one owns its half of the
      // overlap. SR-99's twin tubes are two 14 m roads with centrelines
      // 7.5-11 m apart for ~2.8 km (see "SR-99" in CLAUDE.md); laid across
      // the full width, each tube's left lane ran 1.3 m from the other tube's
      // oncoming left lane, and the cars traded paint the whole way. The
      // boundary is the midline between the two centrelines.
      const my = this.flow[ei];
      const na = this.city.nodes[e.a], nb = this.city.nodes[e.b];
      const mx = (na.x + nb.x) / 2, mz = (na.z + nb.z) / 2;
      for (const oi of this.city.edgesNear(mx, mz, e.len / 2 + 30)) {
        if (oi === ei) continue;
        const o = this.city.edges[oi];
        const par = e.dx * o.dx + e.dz * o.dz;
        if (Math.abs(par) < 0.9) continue;
        const of = this.flow[oi];
        if (of !== 0 && of * my * par > 0) continue; // same way: not opposing
        const oa = this.city.nodes[o.a], ob = this.city.nodes[o.b];
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
      L[k] = hi > lo ? lo : (lo + hi) / 2;
      L[k + 1] = hi > lo ? hi : (lo + hi) / 2;
      L[k + 2] = n;
    }
    const n = L[k + 2];
    const i = Math.min(n - 1, Math.floor((v && v.laneU != null ? v.laneU : 0.5) * n));
    const c = L[k] + ((i + 0.5) * (L[k + 1] - L[k])) / n;
    // c is measured to the right of a -> b; travelling b -> a, right is -c.
    return c * sign;
  }

  /**
   * Is edge ei a spawnable, never-trapping place for traffic? Both ends in
   * one directed component of MIN_COMPONENT+ nodes: 131k of 139k nodes; the
   * largest component alone is 128k.
   */
  inComponent(ei) {
    const e = this.city.edges[ei];
    const c = this.comp[e.a];
    return c === this.comp[e.b] && this.compSize[c] >= MIN_COMPONENT;
  }

  add(v, mode) {
    v.mode = mode;
    this.cars.push(v);
    this.scene.add(v.group);
    return v;
  }

  remove(v) {
    const i = this.cars.indexOf(v);
    if (i >= 0) this.cars.splice(i, 1);
    this.scene.remove(v.group);
    if (v.slot != null) this.parkedSlots.delete(v.slot);
    v.bodyMat.dispose();
    if (v.extra) { disposeTree(v.extra); v.extra = null; }
  }

  spawnAt(x, z, heading, typeName, color, mode) {
    const v = new Vehicle(this.city, typeName, color);
    v.place(x, z, heading);
    return this.add(v, mode);
  }

  // --- parked cars ---------------------------------------------------------

  updateParked(px, pz) {
    const city = this.city;
    const eids = city.edgesNear(px, pz, PARKED_RADIUS);
    const seen = new Set();
    for (const ei of eids) {
      const e = city.edges[ei];
      if (e.elev || e.cls === 'hwy' || e.cls === 'ramp') continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (dist2(mid.x, mid.z, px, pz) > PARKED_RADIUS * PARKED_RADIUS) continue;
      const slots = Math.floor(e.len / 13);
      for (let s = 1; s < slots; s++) {
        const h = hash2(ei * 31 + s, 7);
        // Kerbside occupancy. 0.32 across BOTH sides is about one car in six
        // per kerb, which reads as a street where nobody lives. Parked cars do
        // more for a populated city than any amount of shader work, and they
        // share geometry and two of their three materials across every
        // instance, so the cost is draw calls rather than memory.
        // Kerbside occupancy. Every parked car is 3 draw calls and there are a
        // lot of kerbs in view at once -- measured on device, 67 vehicles were
        // alive at once and the fleet was over half the frame's draw calls.
        // 0.30 still reads as a lived-in street.
        if (h > 0.30) continue;
        const key = ei * 64 + s;
        seen.add(key);
        if (this.parkedSlots.has(key)) continue;
        const t = s / slots;
        const side = h < 0.24 ? 1 : -1;
        const off = e.hw - 1.15;
        const x = lerp(a.x, b.x, t) - e.dz * off * side;
        const z = lerp(a.z, b.z, t) + e.dx * off * side;
        if (dist2(x, z, px, pz) > PARKED_RADIUS * PARKED_RADIUS) continue;
        if (!G.isBuildable(x, z)) continue;
        const heading = Math.atan2(e.dx, e.dz) + (side > 0 ? 0 : Math.PI);
        const tn = CIVILIAN_TYPES[Math.floor(hash2(ei + s * 7, 11) * CIVILIAN_TYPES.length)];
        if (tn === 'bus' || tn === 'garbage') continue;
        const v = this.spawnAt(x, z, heading, tn, randomCarColor(ei * 13 + s), 'parked');
        // A parked car sits against a kerb with buildings behind it, so its
        // shadow lands almost entirely on ground that is already shaded -- and
        // it is three more meshes through the shadow pass. Measured, the parked
        // cars in one downtown frame were 10 draws and 19k triangles of it.
        v.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
        v.slot = key;
        this.parkedSlots.add(key);
      }
    }
    this.updateLotParked(px, pz);
    // despawn parked cars that drifted out of range
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v.mode !== 'parked') continue;
      if (dist2(v.x, v.z, px, pz) > (PARKED_RADIUS + 60) * (PARKED_RADIUS + 60)) this.remove(v);
    }
  }

  /**
   * A few cars in the bays of the car parks around the player.
   *
   * The bays are the ones the terrain shader paints (world.js, the lot layer):
   * 2.6 m wide along the lot's long side, rows 5.4 m deep either side of a
   * 7.2 m aisle, an 18 m module anchored in world space in the lot's own frame.
   * Snapping to that same grid is what puts a car between the lines.
   *
   * Sparse and capped, because every car is 3 draws: LOT_CAP of them at most,
   * and the scan only reruns when the player has moved a cell.
   */
  updateLotParked(px, pz) {
    const LOT_R = 90, LOT_CAP = 6, OCC = 0.16;
    const kx = Math.round(px / 10), kz = Math.round(pz / 10);
    if (this._lotKey === kx * 100000 + kz) return;
    this._lotKey = kx * 100000 + kz;
    let alive = 0;
    for (const v of this.cars) if (v.mode === 'parked' && typeof v.slot === 'string') alive++;
    if (alive >= LOT_CAP) return;
    const city = this.city;
    const cand = [];
    const tried = new Set();
    for (let x = px - LOT_R; x <= px + LOT_R; x += 10) {
      for (let z = pz - LOT_R; z <= pz + LOT_R; z += 10) {
        const code = G.lotCodeAt(x, z);
        if (!code || ((code - 1) / G.LOT_ANG | 0) !== 0) continue;   // parking only
        const ang = ((code - 1) % G.LOT_ANG) / G.LOT_ANG * Math.PI;
        const ux = Math.cos(ang), uz = Math.sin(ang);
        const pu = x * ux + z * uz, pv = -x * uz + z * ux;
        const bu = Math.floor(pu / 2.6), m = Math.floor(pv / 18);
        const row = ((pv % 18) + 18) % 18 < 9 ? 0 : 1;
        const key = `L${bu},${m},${row},${code}`;
        if (tried.has(key)) continue;
        tried.add(key);
        if (hash2(bu * 7 + row, m * 13 + code) > OCC) continue;
        const cu = (bu + 0.5) * 2.6, cv = m * 18 + (row ? 15.3 : 2.7);
        const wx = cu * ux - cv * uz, wz = cu * uz + cv * ux;
        if (dist2(wx, wz, px, pz) > LOT_R * LOT_R || G.lotCodeAt(wx, wz) !== code) continue;
        if (this.parkedSlots.has(key) || city.onRoad(wx, wz, 2.5)) continue;
        if (this.inFootprint(wx, wz, 1.5)) continue;
        cand.push({ key, wx, wz, d: dist2(wx, wz, px, pz),
          // Nose into the bay: the car's length runs across the row, along
          // the lot's short axis (-uz, ux); the two rows face each other.
          heading: Math.atan2(-uz, ux) + (row ? 0 : Math.PI) });
      }
    }
    cand.sort((a, b) => a.d - b.d);
    for (const c of cand) {
      if (alive >= LOT_CAP) break;
      const h = hash2(c.wx | 0, c.wz | 0);
      const tn = CIVILIAN_TYPES[Math.floor(h * CIVILIAN_TYPES.length)];
      // A bay holds a car; a taxi or a cop-looking cruiser waiting in a
      // retail lot reads as staged.
      if (!LOT_TYPES.has(tn)) continue;
      const v = this.spawnAt(c.wx, c.wz, c.heading, tn, randomCarColor((c.wx * 7 + c.wz) | 0), 'parked');
      v.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      v.slot = c.key;
      this.parkedSlots.add(c.key);
      alive++;
    }
  }

  inFootprint(x, z, pad) {
    for (const b of this.city.buildingsNear(x, z, 30)) {
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.w / 2 + pad && Math.abs(lz) < b.d / 2 + pad) return true;
    }
    return false;
  }

  // --- traffic -------------------------------------------------------------

  spawnTraffic(px, pz, camDir) {
    const city = this.city;
    // Sample only from edges near the player -- picking uniformly from the whole
    // 10 km map would almost never land in range.
    const pool = city.edgesNear(px, pz, 360);
    if (!pool.length) return null;
    for (let attempt = 0; attempt < 14; attempt++) {
      const ei = pool[Math.floor(this.R.n() * pool.length)];
      const e = city.edges[ei];
      if (e.len < 16) continue;
      if (e.cls === 'res' && this.R.n() < 0.6) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const t = 0.2 + this.R.n() * 0.6;
      const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
      const d = Math.hypot(x - px, z - pz);
      if (d < 90 || d > 330) continue;
      // prefer off-screen spawns
      if (camDir) {
        const dot = ((x - px) * camDir.x + (z - pz) * camDir.z) / d;
        if (dot > 0.4 && d < 190) continue;
      }
      // Only where a car can keep driving legally forever (see
      // directedComponents), and only the way the street runs.
      if (!this.inComponent(ei)) continue;
      const draw = this.R.n();
      const sign = this.flow[ei] || (draw < 0.5 ? 1 : -1);
      const laneU = this.R.n();
      const off = this.laneLat(ei, sign, { laneU });
      // right of travel: travelling (fx, fz), right is (-fz, fx)
      const lo = { x: -e.dz * sign * off, z: e.dx * sign * off };
      const heading = Math.atan2(e.dx * sign, e.dz * sign);
      let tn = CIVILIAN_TYPES[Math.floor(this.R.n() * CIVILIAN_TYPES.length)];
      if (e.cls === 'res' && (tn === 'bus' || tn === 'boxtruck' || tn === 'garbage')) tn = 'sedan';
      const v = this.spawnAt(x + lo.x, z + lo.z, heading, tn, randomCarColor((this.R.n() * 1e6) | 0), 'traffic');
      if (e.tunnel) {
        // IN the bore, not on the street over it. place() seeds groundAt with
        // no height, which takes the highest surface -- the street -- so every
        // car spawned on a tunnel edge drove the bore's line across town at
        // street level, through whatever stood on it, and stuck in the first
        // building (4 of downtown's stuck cars, both builds). A bore's node
        // heights are its deck.
        v.y = city.groundAt(v.x, v.z, lerp(a.y, b.y, t) + 0.3, v.lift);
        v.pitch = 0; v.roll = 0;
        v.sync();
      }
      v.edge = ei;
      v.dirSign = sign;
      v.laneU = laneU;
      v.vLong = 6 + this.R.n() * 6;
      v.panic = 0;
      return v;
    }
    return null;
  }

  // --- police --------------------------------------------------------------

  spawnPolice(px, pz) {
    const city = this.city;
    const pool = city.edgesNear(px, pz, 340);
    if (!pool.length) return null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const ei = pool[Math.floor(this.R.n() * pool.length)];
      const e = city.edges[ei];
      // (not in a bore either: spawned at a node's plan position, a unit
      // would appear on the street over it -- see spawnTraffic)
      if (e.cls === 'res' || e.elev || e.tunnel) continue;
      // Rolled out the way the street runs: from its tail node, facing along it.
      const sign = this.flow[ei] || 1;
      const a = city.nodes[sign > 0 ? e.a : e.b];
      const d = Math.hypot(a.x - px, a.z - pz);
      if (d < 90 || d > 320) continue;
      const v = this.spawnAt(a.x, a.z, Math.atan2(e.dx * sign, e.dz * sign), 'police', 0xf2f4f6, 'police');
      v.siren = 0;
      v.path = null;
      v.pathT = 0;
      v.repath = 0;
      v.rammed = 0;
      // roof light bar: a dark housing with two strobing lenses
      const bar = new THREE.Group();
      const y = v.spec.roof + 0.09;
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(1.24, 0.1, 0.34),
        new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6, metalness: 0.1 })
      );
      housing.position.set(0, y - 0.03, 0.05);
      bar.add(housing);
      const mkL = (c, x) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.52, 0.15, 0.3),
          new THREE.MeshBasicMaterial({ color: c, toneMapped: false })
        );
        m.position.set(x, y + 0.07, 0.05);
        bar.add(m);
        return m;
      };
      v.lightL = mkL(0x3355ff, -0.31);
      v.lightR = mkL(0xff2a2a, 0.31);
      v.tilt.add(bar);
      // Remember the light bar so `remove` can free it. A vehicle SHARES its
      // trim and matte geometry and materials with every other instance, so
      // nothing may traverse-and-dispose a car -- only the per-instance extras
      // built here. Cops churn continuously during a chase, and this was three
      // geometries and three materials leaked every time one despawned.
      v.extra = bar;
      return v;
    }
    return null;
  }

  ensureHeli(active, px, pz) {
    // main.js sets heliBlind while the player is under the ground: in a bore
    // the air unit has no line of sight, which is what makes a tunnel worth
    // driving into with the police behind you.
    if (this.heliBlind) active = false;
    if (active && !this.heli) {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: 0x1b2733 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 3.2, 6, 10), mat);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 5.2), mat);
      tail.position.set(0, 0.3, -4);
      g.add(tail);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 1.0), mat);
      fin.position.set(0, 1.1, -6.2);
      g.add(fin);
      const rotor = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 8.5), new THREE.MeshLambertMaterial({ color: 0x2c3a48 }));
        b.rotation.y = (i / 4) * Math.PI * 2;
        rotor.add(b);
      }
      rotor.position.y = 1.6;
      g.add(rotor);
      const tr = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.2), new THREE.MeshLambertMaterial({ color: 0x2c3a48 }));
        b.rotation.z = (i / 3) * Math.PI * 2;
        tr.add(b);
      }
      tr.position.set(0.35, 0.8, -6.2);
      g.add(tr);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
      beacon.position.set(0, -1.2, 1.5);
      g.add(beacon);
      g.position.set(px, 120, pz);
      this.scene.add(g);
      this.heli = { g, rotor, tr, beacon, a: 0, ang: 0 };
    } else if (!active && this.heli) {
      this.scene.remove(this.heli.g);
      // Nothing in the helicopter is shared, and it is rebuilt from scratch
      // every time the wanted level crosses four -- so without this an entire
      // airframe leaked on each transition, in both directions.
      disposeTree(this.heli.g);
      this.heli = null;
    }
  }

  // --- pathfinding ---------------------------------------------------------

  /**
   * A* over the street graph for the police, respecting one-way streets.
   *
   * What a real pursuit does, and so what this does: a unit never takes a
   * freeway or a ramp against its flow (that is the head-on on SR-99), but it
   * will run a block of a one-way SURFACE street the wrong way to cut a
   * suspect off, lights on -- so that is allowed at 3x the cost, and chosen
   * only when it saves a real detour.
   */
  findPath(fromNode, toNode, limit = 2500) {
    const city = this.city;
    if (fromNode < 0 || toNode < 0) return null;
    const open = [fromNode];
    const came = new Map([[fromNode, -1]]);
    const gScore = new Map([[fromNode, 0]]);
    const goal = city.nodes[toNode];
    const fScore = new Map([[fromNode, 0]]);
    let count = 0;
    while (open.length && count++ < limit) {
      let bi = 0, bf = Infinity;
      for (let i = 0; i < open.length; i++) {
        const f = fScore.get(open[i]);
        if (f < bf) { bf = f; bi = i; }
      }
      const cur = open.splice(bi, 1)[0];
      if (cur === toNode) {
        const path = [];
        let n = cur;
        while (n !== -1) { path.push(n); n = came.get(n); }
        return path.reverse();
      }
      const node = city.nodes[cur];
      for (const ei of node.e) {
        const e = city.edges[ei];
        const nb = e.a === cur ? e.b : e.a;
        let mul = e.cls === 'res' ? 1.4 : e.cls === 'hwy' ? 0.7 : 1;
        if (!this.allowed(ei, e.a === cur ? 1 : -1)) {
          if (e.cls === 'hwy' || e.cls === 'ramp') continue;
          mul *= 3;
        }
        const cost = gScore.get(cur) + e.len * mul;
        if (gScore.has(nb) && gScore.get(nb) <= cost) continue;
        gScore.set(nb, cost);
        came.set(nb, cur);
        const nn = city.nodes[nb];
        fScore.set(nb, cost + Math.hypot(nn.x - goal.x, nn.z - goal.z));
        if (!open.includes(nb)) open.push(nb);
      }
    }
    return null;
  }

  // --- per-frame -----------------------------------------------------------

  update(dt, px, pz, camDir, player) {
    const city = this.city;
    const game = this.game;

    this.updateParked(px, pz);

    // maintain traffic population
    let trafficCount = 0, policeCount = 0;
    for (const v of this.cars) {
      if (v.mode === 'traffic') trafficCount++;
      else if (v.mode === 'police') policeCount++;
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      if (trafficCount < TRAFFIC_TARGET) this.spawnTraffic(px, pz, camDir);
    }
    const wantPolice = game.wanted === 0 ? 0 : Math.min(9, 1 + game.wanted * 2);
    this.copTimer -= dt;
    if (this.copTimer <= 0 && policeCount < wantPolice) {
      this.copTimer = 1.4;
      this.spawnPolice(px, pz);
    }
    this.ensureHeli(game.wanted >= 4, px, pz);

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v === player.vehicle) continue;
      const d2 = dist2(v.x, v.z, px, pz);
      // 'apron' is the airport's planes: player-flyable set dressing that has
      // to still be there when you drive back an hour later.
      if (d2 > DESPAWN * DESPAWN && v.mode !== 'parked' && v.mode !== 'apron') { this.remove(v); continue; }
      if (v.mode === 'police' && game.wanted === 0 && d2 > 140 * 140) { this.remove(v); continue; }

      if (v.mode === 'parked') {
        v.group.visible = d2 < 140 * 140;
        continue;
      }
      v.group.visible = true;

      let input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
      if (v.mode === 'traffic') {
        input = this.driveTraffic(v, dt, px, pz, player);
        if (v.recycle) { this.remove(v); continue; }
      }
      else if (v.mode === 'police') input = this.drivePolice(v, dt, px, pz, player);
      else input = { throttle: 0, brake: 0.12, steer: 0 }; // shunted or abandoned: coast

      v.update(dt, input);
      collideWithBuildings(v, city);
    }

    this.resolveCarCollisions(dt, player);
    // collision resolution edits transforms directly, so re-sync every body.
    for (const v of this.cars) if (v !== player.vehicle) v.sync();

    if (this.heli) {
      const h = this.heli;
      h.a += dt;
      h.ang += dt * 0.45;
      const r = 70;
      const tx = px + Math.cos(h.ang) * r;
      const tz = pz + Math.sin(h.ang) * r;
      const ty = Math.max(city.groundAt(tx, tz, null) + 95, 110);
      h.g.position.x = lerp(h.g.position.x, tx, 1 - Math.exp(-1.2 * dt));
      h.g.position.z = lerp(h.g.position.z, tz, 1 - Math.exp(-1.2 * dt));
      h.g.position.y = lerp(h.g.position.y, ty, 1 - Math.exp(-1.0 * dt));
      h.g.rotation.y = Math.atan2(px - h.g.position.x, pz - h.g.position.z);
      h.g.rotation.z = -0.18;
      h.rotor.rotation.y += dt * 26;
      h.tr.rotation.x += dt * 34;
      h.beacon.visible = Math.sin(h.a * 9) > 0;
    }
  }

  driveTraffic(v, dt, px, pz, player) {
    const city = this.city;
    let e = city.edges[v.edge];
    if (!e) { v.mode = 'free'; return { throttle: 0, brake: 1, steer: 0 }; }
    const a = city.nodes[v.dirSign > 0 ? e.a : e.b];
    const b = city.nodes[v.dirSign > 0 ? e.b : e.a];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    // progress along the edge
    const proj = ((v.x - a.x) * ux + (v.z - a.z) * uz) / len;
    if (proj > 0.94) {
      const next = this.pickNextEdge(v, e, v.dirSign > 0 ? e.b : e.a);
      if (next) { v.edge = next.ei; v.dirSign = next.sign; }
      else if (this.allowed(v.edge, -v.dirSign)) v.dirSign = -v.dirSign; // two-way dead end: U-turn
      else {
        // The end of a one-way chain with no legal way on. Spawns and turns
        // keep to directed components so this should not happen; if it does,
        // a car out of the player's sight is recycled (the population refills
        // legally) rather than turned round into the oncoming lane.
        this.stats.deadEnd++;
        const seen = dist2(v.x, v.z, px, pz) < 120 * 120;
        if (!seen) { this.stats.deadEndDespawn++; v.recycle = true; return { throttle: 0, brake: 1, steer: 0 }; }
        v.dirSign = -v.dirSign;
      }
      e = city.edges[v.edge];
    }
    const ee = city.edges[v.edge];
    const na = city.nodes[v.dirSign > 0 ? ee.a : ee.b];
    const nb = city.nodes[v.dirSign > 0 ? ee.b : ee.a];
    const ndx = nb.x - na.x, ndz = nb.z - na.z;
    const nlen = Math.hypot(ndx, ndz) || 1;
    const fx = ndx / nlen, fz = ndz / nlen;
    let off = this.laneLat(v.edge, v.dirSign, v);
    // A BORE'S WALLS ARE SOLID (hw + 0.4), and a vehicle collides as a
    // circle: 0.7 x radius plus the barrier's 0.8 m, 4.3 m for a bus. In a
    // tube's right lane (+3.1 m) a bus was permanently in contact with the
    // wall, pushed off it every frame and steered back into it, and crawled
    // along the stacked SR-99 decks at 6 m/s with the traffic behind it (the
    // side-by-side twins had no shared walls there, so it never showed).
    // Long vehicles hold their lane a hand's breadth clear of the wall.
    if (ee.tunnel && !ee.elev) {
      const lim = Math.max(0, ee.hw + 0.4 - (v.radius * 0.7 + 1.1));
      off = clamp(off, -lim, lim);
    }
    const aimAhead = clamp(6 + Math.abs(v.vLong) * 0.75, 6, 24);
    const p = ((v.x - na.x) * fx + (v.z - na.z) * fz);
    const ap = clamp(p + aimAhead, 0, nlen);
    const tx = na.x + fx * ap - fz * off;
    const tz = na.z + fz * ap + fx * off;

    const desired = Math.atan2(tx - v.x, tz - v.z);
    const err = angleWrap(desired - v.heading);
    const steer = clamp(err * 1.5, -1, 1);

    // obstacle scan
    let brake = 0;
    const f = v.forward;
    const scanLen = 5 + Math.abs(v.vLong) * 1.1;
    for (const o of this.cars) {
      if (o === v) continue;
      // A car on another deck is not ahead of you. In SR-99's stacked bore the
      // other direction runs DECK_SEP overhead or underneath on the same
      // line, and the plan-only scan braked every car for oncoming traffic on
      // the other deck: stopped queues mid-bore. Same 3 m band the car-car
      // collision uses.
      if (Math.abs(o.y - v.y) > 3) continue;
      const rx = o.x - v.x, rz = o.z - v.z;
      const fwd = rx * f.x + rz * f.z;
      if (fwd < 0.5 || fwd > scanLen) continue;
      const lat = Math.abs(rx * f.z - rz * f.x);
      if (lat > 2.2) continue;
      brake = Math.max(brake, clamp(1.4 - fwd / scanLen, 0.35, 1));
    }
    if (player.onFoot && Math.abs(player.y - v.y) < 3) {
      const rx = player.x - v.x, rz = player.z - v.z;
      const fwd = rx * f.x + rz * f.z;
      const lat = Math.abs(rx * f.z - rz * f.x);
      if (fwd > 0 && fwd < 10 && lat < 2.2) brake = Math.max(brake, 0.8);
    }
    const targetSpeed = Math.min(ee.spd, 8 + ee.spd) * (v.panic > 0 ? 1.5 : 1);
    const throttle = brake > 0.2 ? 0 : clamp((targetSpeed - v.vLong) * 0.4, 0, 1);
    if (v.panic > 0) v.panic -= dt;
    // Wedged: full throttle, nothing ahead to wait for, and not moving -- a
    // bus against a lamp post on a lidded ramp, a car shunted onto a kerb
    // tree. The collision response takes most of its speed every frame, so it
    // never frees itself, and every car behind it queues. Out of the player's
    // sight it is recycled like a dead-end car; in sight it keeps trying.
    if (throttle > 0.5 && Math.abs(v.vLong) < 0.5) v.stuckT = (v.stuckT || 0) + dt;
    else v.stuckT = 0;
    if (v.stuckT > 8 && dist2(v.x, v.z, px, pz) > 120 * 120) { this.stats.stuckRecycled++; v.recycle = true; }
    return { throttle, brake, steer, handbrake: 0 };
  }

  pickNextEdge(v, e, nodeId) {
    const city = this.city;
    const node = city.nodes[nodeId];
    if (!node) return null;
    const f = v.forward;
    // Only legal exits, and only ones that stay in this car's directed
    // component (so it can never be led into a one-way dead end). A turn
    // sharper than ~120 deg is still refused while anything else is on offer;
    // where a legal exit is only that sharp (a one-way street's end at a
    // hairpin), it is taken rather than stopping.
    const comp = this.comp[nodeId];
    let best = null, bestScore = -Infinity, sharp = null, sharpScore = -Infinity;
    for (const ei of node.e) {
      if (ei === v.edge) continue;
      const ne = city.edges[ei];
      const sign = ne.a === nodeId ? 1 : -1;
      if (!this.allowed(ei, sign)) continue;
      if (this.comp[sign > 0 ? ne.b : ne.a] !== comp) continue;
      const dx = ne.dx * sign, dz = ne.dz * sign;
      const dot = dx * f.x + dz * f.z;
      const score = dot * 2 + hash2(ei, (v.x * 3) | 0) * 1.1 + (ne.cls === 'res' ? -0.6 : 0);
      if (dot < -0.5) {
        if (score > sharpScore) { sharpScore = score; sharp = { ei, sign }; }
        continue;
      }
      if (score > bestScore) { bestScore = score; best = { ei, sign }; }
    }
    if (best) return best;
    // On a two-way street, null turns the car round (driveTraffic flips
    // dirSign), exactly as before. On a one-way street that would be driving
    // into the oncoming flow, so the hairpin is taken instead.
    if (this.allowed(v.edge, -v.dirSign)) return null;
    if (sharp) this.stats.fallbackTurn++;
    return sharp;
  }

  drivePolice(v, dt, px, pz, player) {
    const city = this.city;
    v.siren = (v.siren || 0) + dt;
    const blink = Math.sin(v.siren * 11) > 0;
    if (v.lightL) { v.lightL.visible = blink; v.lightR.visible = !blink; }

    const d = Math.hypot(px - v.x, pz - v.z);
    let tx = px, tz = pz;
    v.repath -= dt;
    if (d > 55) {
      if (!v.path || v.repath <= 0) {
        const from = city.nearestNode(v.x, v.z);
        const to = city.nearestNode(px, pz);
        v.path = this.findPath(from, to, 1400);
        v.pathT = 0;
        v.repath = 2.2;
      }
      if (v.path && v.path.length) {
        while (v.pathT < v.path.length) {
          const n = city.nodes[v.path[v.pathT]];
          if (Math.hypot(n.x - v.x, n.z - v.z) < 16) v.pathT++;
          else break;
        }
        const idx = Math.min(v.pathT, v.path.length - 1);
        const n = city.nodes[v.path[idx]];
        tx = n.x; tz = n.z;
      }
    }
    const desired = Math.atan2(tx - v.x, tz - v.z);
    const err = angleWrap(desired - v.heading);
    const steer = clamp(err * 1.7, -1, 1);
    const f = v.forward;

    let brake = 0;
    for (const o of this.cars) {
      if (o === v || o.mode === 'police' || Math.abs(o.y - v.y) > 3) continue;
      const rx = o.x - v.x, rz = o.z - v.z;
      const fwd = rx * f.x + rz * f.z;
      if (fwd < 0.5 || fwd > 10) continue;
      if (Math.abs(rx * f.z - rz * f.x) > 2.0) continue;
      brake = 0.7;
    }
    const targetSpeed = d < 18 ? 12 : 34;
    let throttle = brake > 0.2 ? 0 : clamp((targetSpeed - v.vLong) * 0.5, 0, 1);
    if (Math.abs(err) > 1.4 && v.vLong > 10) brake = Math.max(brake, 0.5);
    return { throttle, brake, steer, handbrake: 0 };
  }

  resolveCarCollisions(dt, player) {
    const all = this.cars;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.mode === 'parked' && a !== player.vehicle) {
        // parked cars still get shoved
      }
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        // The test is 2D, so gate on height or a plane at 200 m gets shunted
        // by the traffic it overflies -- the "invisible collision in the air".
        // Also stops a viaduct car trading paint with the street below it.
        if (Math.abs((a.y || 0) - (b.y || 0)) > 3) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const pen = rr - d;
        const ma = a.mass, mb = b.mass;
        const total = ma + mb;
        a.x -= nx * pen * (mb / total);
        a.z -= nz * pen * (mb / total);
        b.x += nx * pen * (ma / total);
        b.z += nz * pen * (ma / total);
        const fa = a.forward.x * nx + a.forward.z * nz;
        const fb = b.forward.x * nx + b.forward.z * nz;
        const av = a.vLong * fa;
        const bv = b.vLong * fb;
        const rel = av - bv;
        if (rel > 0) {
          // EACH CAR TAKES ITS SHARE ALONG ITS OWN HEADING. `b.vLong += ...`
          // unprojected is right only when b faces along the normal: a car
          // coming HEAD-ON was pushed forward into the other one, re-overlapped
          // next frame and was pushed again. Measured riding SR-99 south out of
          // the SB exit into oncoming traffic, an AI car went 41 -> 110 m/s in
          // four frames while the player's car bounced backwards (-3.4 m/s).
          // Projected, the head-on car is pushed back along the normal, and a
          // side-on one (heading across it) barely changes its speed.
          a.vLong -= rel * 0.55 * (mb / total) * fa;
          b.vLong += rel * 0.5 * (ma / total) * fb;
          const impact = Math.abs(rel);
          if (impact > 4) {
            a.damage(impact * 0.7);
            b.damage(impact * 0.7);
            if (b.mode === 'traffic') b.panic = 4;
            if (a.mode === 'traffic') a.panic = 4;
            if (a === player.vehicle || b === player.vehicle) {
              this.game.onCrash(impact, b.mode === 'police' || a.mode === 'police');
            }
          }
        }
        if (a.mode === 'parked') a.mode = 'free';
        if (b.mode === 'parked') b.mode = 'free';
      }
    }
  }

  /** Nearest vehicle the player can climb into. */
  nearestEnterable(x, z, maxD = 4.5) {
    let best = null, bd = maxD * maxD;
    for (const v of this.cars) {
      if (v.dead) continue;
      const p = v.nearest(x, z);
      const d = dist2(p.x, p.z, x, z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
}
