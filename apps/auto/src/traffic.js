// Traffic, parked cars and the police response.

import * as THREE from './three.js';
import { Vehicle, CIVILIAN_TYPES, randomCarColor, vehicleAssets, farLod, makeBellows, HITCH } from './vehicles.js';
import { clamp, lerp, angleWrap, hash2, rng, dist2 } from './util.js';
import * as G from './geo.js';
import { memo } from './bootcache.js';

const TRAFFIC_TARGET = 26;
// Parked cars only exist within this radius, and each is 3 draw calls, so this
// is a draw-call dial as much as a distance one.
const PARKED_RADIUS = 105;
const LOT_TYPES = new Set(['sedan', 'suv', 'pickup', 'compact', 'hatch', 'ev', 'muscle', 'sports', 'convertible']);
const DESPAWN = 520;
// A phone is draw-call bound, and the fleet was over half of it: an iPhone 17
// Pro driving downtown showed 58 vehicles (3 draws each, plus shadows) and 9.6
// ms of render submission. Parked cars are only drawn this close on a phone,
// and traffic only casts a shadow this close -- past it a car's shadow is a
// few pixels and three more draws in the shadow pass.
const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const PARKED_SHOW = ON_PHONE ? 80 : 140;
const SHADOW_NEAR = ON_PHONE ? 45 : Infinity;
// Past this, a phone draws a vehicle through its type's InstancedMesh over the
// far LOD (vehicles.js farLod): one draw per type on screen instead of three
// per car. Beyond SHADOW_NEAR, so nothing that casts is ever instanced.
const FAR_LOD = ON_PHONE ? 60 : Infinity;

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

export function collideWithBuildings(v, city, onHit, ai = false) {
  // Street objects first: a tree or a lamp post is closer than the building
  // line and is what you actually hit coming off a kerb. Until this existed
  // the only solid thing in the entire map was a building, so every tree in
  // Seattle was scenery you drove straight through.
  //
  // Softer than a wall: a mast shears and a trunk gives, so the car is pushed
  // out and loses most of its speed rather than stopping dead against it.
  // A car in a stunt flight is over the lamp posts, not among them: the store
  // is 2D, so without this a jump clipped every post it passed over.
  // Walls and landmarks still answer (they carry their own height bands).
  let ob;
  if (v.stunt && v.y - G.terrainHeight(v.x, v.z) > 3.5) {
    const b = city.barrierHit(v.x, v.z, v.radius * 0.7, v.y), lm = city.landmarkHit(v.x, v.z, v.radius * 0.7, v.y, ai);
    ob = b && lm ? (b.pen > lm.pen ? b : lm) : b || lm;
  } else ob = city.obstacleHit(v.x, v.z, v.radius * 0.7, v.y, ai);
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
    // A stunt ramp's block (stunts.js) is no road for traffic: leaving it out
    // of the graph cuts a dead-end block off, so nothing spawns on it either.
    if (e.noTraffic) return -1;
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
// Lanes on a one-way street are 3.6 m, a real lane. (They were 4.2 m while
// resolveCarCollisions tested circles of 0.42 x length, 2.0 m for a sedan,
// which touched across 3.6 m; it tests the bodies' rectangles now.) A one-way
// street with parking keeps 2.2 m clear at each kerb for the parked cars
// (they sit at hw - 1.15, see updateParked); anything else keeps a 0.8 m
// shoulder.
const LANE_W = 3.6, PARK_EDGE = 2.2, SHOULDER = 0.8;

const byX = (a, b) => a.x - b.x;

// THE AI'S ROUTE (see "How the AI drives"): RT_MAX entries of RT_F numbers in
// v.rt. An entry is an edge, its direction and lane, and its lane's centre
// line (start Q, direction U, length); the V_ fields are the VERTEX between
// it and the entry before: kind (0 none, 1 an arc, 2 a jog), where it is on
// the old line (A) and the new (B), the arc's tangent length T, radius R and
// angle TH, its centre O, the unit N from its first tangent point to O, and
// the old line's direction P.
const R_EI = 0, R_SG = 1, R_OFF = 2, R_U = 3, R_QX = 4, R_QZ = 5, R_UX = 6, R_UZ = 7, R_LEN = 8, R_SPD = 9, R_END = 10;
const V_K = 11, V_A = 12, V_B = 13, V_T = 14, V_R = 15, V_TH = 16, V_OX = 17, V_OZ = 18, V_NX = 19, V_NZ = 20, V_PX = 21, V_PZ = 22;
const RT_F = 23, RT_MAX = 10;
// Comfortable lateral acceleration through a corner (m/s^2), the deceleration
// speed is planned with, and a junction's corner radius turning right / left.
// A bend in the road has no cap but the room its segments leave.
const A_LAT = 3.0, B_PLAN = 2.0, JR_RIGHT = 7, JR_LEFT = 11, CURVE_RMAX = 400;
// A police unit in pursuit corners at this (driveTraffic via drivePolice).
const A_LAT_POLICE = 9, BRAKE_POLICE = 5;
// Car following (the Intelligent Driver Model): time headway, standstill gap,
// comfortable deceleration. The acceleration is per class (driveTraffic).
const IDM_T = 1.2, IDM_S0 = 2.2, IDM_B = 2.5;

// A vehicle's body for car-car collision: its footprint rectangle.
// (Vehicle keeps it: Math.hypot three times a pair was a profile line of its own)
const bodyR = (v) => v.bodyR || Math.hypot(v.halfLen, v.halfWid);
const _hit = { nx: 0, nz: 0, pen: 0 };
// nobody at the wheel (traffic.update): read-only inputs, not one per car a frame
const COAST_IN = { throttle: 0, brake: 0.12, steer: 0 };
const PARK_IN = { throttle: 0, brake: 0, steer: 0, park: true };
/** Overlap of a's and b's footprints (d = b - a): the separating normal from
 *  a to b and the depth along it, or null. 2D SAT on the four body axes. */
function boxOverlap(a, b, dx, dz) {
  const fa = a.forward, fb = b.forward;
  const ax = [fa.x, fa.z, fa.z, -fa.x, fb.x, fb.z, fb.z, -fb.x];
  let best = Infinity, bx = 0, bz = 0;
  for (let k = 0; k < 8; k += 2) {
    const ux = ax[k], uz = ax[k + 1];
    const ra = a.halfLen * Math.abs(fa.x * ux + fa.z * uz) + a.halfWid * Math.abs(fa.z * ux - fa.x * uz);
    const rb = b.halfLen * Math.abs(fb.x * ux + fb.z * uz) + b.halfWid * Math.abs(fb.z * ux - fb.x * uz);
    const dd = dx * ux + dz * uz;
    const o = ra + rb - Math.abs(dd);
    if (o <= 0) return null;
    if (o < best) { best = o; bx = dd < 0 ? -ux : ux; bz = dd < 0 ? -uz : uz; }
  }
  _hit.nx = bx; _hit.nz = bz; _hit.pen = best;
  return _hit;
}

/** Warm-up stand-ins for the light bar's materials (main.js, Hitches): the
 *  lenses' unlit material compiled the first time a cop appeared. */
export function warmLightBar() {
  const fake = { spec: { roof: 0 }, tilt: new THREE.Group(), lightL: null, lightR: null, extra: null };
  TrafficSystem.prototype.lightBar.call(null, fake);
  return fake.tilt;
}

export class TrafficSystem {
  constructor(scene, city, game) {
    this.scene = scene;
    this.city = city;
    this.game = game;
    this.cars = [];
    this.farMeshes = new Map();
    // Every type's far LOD up front, on the loading screen: built on first use
    // it was a one-off 2-4 ms stall (40+ ms on a phone) the first time each
    // type drove past 60 m.
    if (FAR_LOD !== Infinity) for (const k of Object.keys(vehicleAssets().types)) farLod(k);
    this._farM = new THREE.Matrix4();
    this._farFr = new THREE.Frustum();
    this._farS = new THREE.Sphere();
    this._tick = 0;
    this.parkedSlots = new Set();
    // kerb slots given to something else for good (main.js: the car by the spawn)
    this.reservedSlots = new Set();
    // ground kept free of lot parking for good: [x, z, r] (tank.js: the tank's apron)
    this.keepClear = [];
    this.R = rng(99);
    this.police = null;   // police.js, set by main.js
    this.spawnTimer = 0;
    this.copTimer = 0;
    vehicleAssets();
    // Legal direction per edge (+1 a->b, -1 b->a, 0 both) and the directed
    // components; see edgeFlow / directedComponents.
    const E = city.edges;
    this.flow = new Int8Array(E.length);
    for (let i = 0; i < E.length; i++) this.flow[i] = edgeFlow(E[i]);
    // (kept by the boot cache, bootcache.js memo; read-only once made)
    const cc = memo('traffic:components', () => directedComponents(city, this.flow),
      (v) => v && v.comp instanceof Int32Array && v.comp.length === city.nodes.length && Array.isArray(v.sizes));
    this.comp = cc.comp;
    this.compSize = cc.sizes;
    // Lane span per one-way edge, lazily: [lo, hi, lanes] in the edge's own
    // perpendicular (+ = the side to the right of a->b). NaN = not computed.
    this.lanes = new Float32Array(E.length * 3).fill(NaN);
    // Counters for tools/trafficcheck.mjs: dead ends a car still reached, and
    // turns that had to fall back past the normal choice.
    this.stats = { deadEnd: 0, deadEndDespawn: 0, fallbackTurn: 0, stuckRecycled: 0, yielded: 0 };
    this.sirenFrom = null;   // your police car, siren on (main.js): traffic ahead yields to it
    this._P = { x: 0, z: 0 };
    this._ps = new Float64Array(24);   // driveTraffic's path samples
    this._pseg = new Float64Array(36); // ...and its segments: dx, dz, length
    this._prio = 0;
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
   * (lanes 3.6 m apart, see LANE_W).
   */
  laneLat(ei, sign, v) {
    return this.laneLatU(ei, sign, v && v.laneU != null ? v.laneU : 0.5);
  }

  /** laneLat for a lane fraction `u` in [0, 1): lane floor(u * n) of the n,
   *  counted from the left of a -> b. */
  laneLatU(ei, sign, u) {
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
      // ...and inside any lid barrier standing in the carriageway (world
      // buildLids' e.barW, [+p, -p] like e.tw): that is where the road ends.
      if (e.barW) { w0 = Math.min(w0, e.barW[0]); w1 = Math.min(w1, e.barW[1]); }
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
    const i = Math.min(n - 1, Math.floor(u * n));
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
    if (e.noTraffic) return false;
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
    // an articulated bus goes as one: its rear section and bellows with it
    if (v.trailer) { const r = v.trailer; v.trailer = null; r.leader = null; this.remove(r); }
    if (v.bellows) { this.scene.remove(v.bellows); v.bellows.geometry.dispose(); v.bellows = null; }
    const i = this.cars.indexOf(v);
    if (i >= 0) this.cars.splice(i, 1);
    this.scene.remove(v.group);
    if (v.slot != null) this.parkedSlots.delete(v.slot);
    v.bodyMat.dispose();
    if (v.extra) { if (!v.extra.userData.shared) disposeTree(v.extra); v.extra = null; }
  }

  /**
   * Is there water DRAWN over the ground here? The 10 m water mask
   * (isBuildable) and the drawn water disagree along every shore: ground under
   * the sea's plane, a kerb just inside a lake's shore. Parked cars stood in
   * both. `waterAt` is main.js's (the drawn surface, as the boats use).
   */
  wet(x, z) {
    if (!this.waterAt) return false;
    const wl = this.waterAt(x, z);
    return wl !== null && wl > G.terrainHeight(x, z) + 0.05;
  }

  spawnAt(x, z, heading, typeName, color, mode) {
    const v = new Vehicle(this.city, typeName, color);
    v.place(x, z, heading);
    this.add(v, mode);
    if (v.spec.towed) {
      // the rear section or trailer, straight behind (and an artic's bellows between)
      const r = new Vehicle(this.city, v.spec.towed, color);
      const f = v.forward, H = HITCH[v.spec.towed], back = H.hitchF + H.hitchR;
      r.place(x - f.x * back, z - f.z * back, heading);
      r.leader = v; v.trailer = r;
      this.add(r, 'trailer');
      if (v.spec.artic) {
        v.bellows = makeBellows();
        this.scene.add(v.bellows);
      }
      r.follow(v);
    }
    return v;
  }

  // --- parked cars ---------------------------------------------------------

  updateParked(px, pz) {
    const city = this.city;
    const eids = city.edgesNear(px, pz, PARKED_RADIUS);
    const R2 = PARKED_RADIUS * PARKED_RADIUS;
    for (const ei of eids) {
      const sl = this.kerbSlots(ei);
      if (!sl.length) continue;
      const e = city.edges[ei];
      const a = city.nodes[e.a], b = city.nodes[e.b];
      if (dist2((a.x + b.x) / 2, (a.z + b.z) / 2, px, pz) > R2) continue;
      for (const k of sl) {
        if (this.reservedSlots.has(k.key) || this.parkedSlots.has(k.key)) continue;
        if (dist2(k.x, k.z, px, pz) > R2) continue;
        const v = this.spawnAt(k.x, k.z, k.heading, k.tn, randomCarColor(k.col), 'parked');
        // A parked car sits against a kerb with buildings behind it, so its
        // shadow lands almost entirely on ground that is already shaded -- and
        // it is three more meshes through the shadow pass. Measured, the parked
        // cars in one downtown frame were 10 draws and 19k triangles of it.
        v.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
        v.slot = k.key;
        this.parkedSlots.add(k.key);
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
   * The kerbside parking slots of edge ei that can hold a car: where, which
   * way, what type. Everything here is fixed by the edge and the map, so it is
   * worked out once per edge (updateParked used to rerun every hash and the
   * water, buildable and jump-clear tests for every slot in 105 m, every
   * frame, mostly for slots that fail them).
   */
  kerbSlots(ei) {
    const cache = this._kerb || (this._kerb = new Map());
    let out = cache.get(ei);
    if (out) return out;
    out = [];
    const city = this.city, e = city.edges[ei];
    if (!(e.elev || e.cls === 'hwy' || e.cls === 'ramp' || e.noTraffic)) {
      const a = city.nodes[e.a], b = city.nodes[e.b];
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
        const t = s / slots;
        const side = h < 0.24 ? 1 : -1;
        const off = e.hw - 1.15;
        const x = lerp(a.x, b.x, t) - e.dz * off * side;
        const z = lerp(a.z, b.z, t) + e.dx * off * side;
        if (!G.isBuildable(x, z) || city.jumpClear(x, z) || this.wet(x, z)) continue;
        const tn = CIVILIAN_TYPES[Math.floor(hash2(ei + s * 7, 11) * CIVILIAN_TYPES.length)];
        if (tn === 'bus' || tn === 'artic' || tn === 'garbage') continue;
        out.push({ key: ei * 64 + s, x, z, heading: Math.atan2(e.dx, e.dz) + (side > 0 ? 0 : Math.PI), tn, col: ei * 13 + s });
      }
    }
    // (the water test needs main.js's waterAt: nothing is kept before it is
    // set; and the cache is only the neighbourhood's, not every street driven)
    if (this.waterAt) { if (cache.size > 3000) cache.clear(); cache.set(ei, out); }
    return out;
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
        if (this.parkedSlots.has(key) || city.onRoad(wx, wz, 2.5) || city.jumpClear(wx, wz)) continue;
        if (this.inFootprint(wx, wz, 1.5) || this.wet(wx, wz)) continue;
        // The seaplane dock's car park runs to the shore, and its landing deck
        // is inside the lot's coverage: a bay there parked a car on the pier.
        if (city.platformAt && city.platformAt(wx, wz) !== null) continue;
        if (this.keepClear.some(([kx, kz, kr]) => dist2(wx, wz, kx, kz) < kr * kr)) continue;
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
      if (e.cls === 'res' && (tn === 'bus' || tn === 'artic' || tn === 'boxtruck' || tn === 'garbage')) tn = 'sedan';
      // The Wedge drives past now and then: a quarter of the EVs, ~1.5 % of
      // traffic. Not a CIVILIAN_TYPES slot: that array is hashed for kerbside
      // parking, and appending would move every parked car in the city. A
      // hash, not this.R, so the spawn stream after it is unchanged.
      if (tn === 'ev' && hash2(ei, this._prio) < 0.25) tn = 'wedge';
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
      // Every driver keeps a pace of their own, +-8 % on the limit: a whole
      // street at exactly the limit drives in formation.
      v.drvK = 0.92 + 0.16 * hash2(ei, (x * 7) | 0);
      v.prio = ++this._prio;
      this.routeInit(v);
      return v;
    }
    return null;
  }

  // --- police --------------------------------------------------------------

  /** A unit 90-320 m off on a non-residential surface street: 'car' (a
   *  cruiser) or 'swat' (the tactical van, police.js level 4+). */
  spawnPolice(px, pz, unit = 'car', avoid = null, near = false) {
    const city = this.city;
    const pool = city.edgesNear(px, pz, 340);
    if (!pool.length) return null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const ei = pool[Math.floor(this.R.n() * pool.length)];
      const e = city.edges[ei];
      // (not in a bore either: spawned at a node's plan position, a unit
      // would appear on the street over it -- see spawnTraffic)
      if (e.cls === 'res' || e.elev || e.tunnel) continue;
      // Not on a freeway or a ramp unless nothing else will do: a unit put on
      // I-5 beside you is 240 nodes from you (the next exit and back), and
      // drove off half a kilometre before it turned.
      if ((e.cls === 'hwy' || e.cls === 'ramp') && attempt < 45) continue;
      // the near band first; where it has no street, the usual one
      const nr = near && attempt < 30;
      // Rolled out the way the street runs: from its tail node, facing along it.
      const sign = this.flow[ei] || 1;
      const a = city.nodes[sign > 0 ? e.a : e.b];
      const d = Math.hypot(a.x - px, a.z - pz);
      // (to a target standing still, the nearer half: 320 m out at downtown
      // pursuit speeds was half a minute before anyone came)
      if (d < (nr ? 70 : 90) || d > (nr ? 190 : 320)) continue;
      // (searching: dispatched to where you were last seen, never in sight of
      // where you are now -- and not past the despawn ring either, or it is
      // removed the frame it appears and replaced 1.4 s later, 34 cruisers a
      // minute at one star)
      if (avoid) {
        const da = Math.hypot(a.x - avoid.x, a.z - avoid.z);
        if (da < 140 || da > DESPAWN - 80) continue;
      }
      return this.spawnUnitAt(a.x, a.z, Math.atan2(e.dx * sign, e.dz * sign), unit);
    }
    return null;
  }

  /** A police unit ('car' | 'swat') at (x, z), heading h, driving. */
  spawnUnitAt(x, z, h, unit) {
    {
      const swat = unit === 'swat';
      const v = this.spawnAt(x, z, h, swat ? 'swat' : 'police', 0xf2f4f6, 'police');
      v.unit = swat ? 'swat' : 'car';
      v.crew = 0;
      v.siren = 0;
      v.path = null;
      v.pathT = 0;
      v.repath = 0;
      v.rammed = 0;
      this.lightBar(v);
      v.vLong = 12;
      if (this.police) this.police.stats.spawned[swat ? 'swat' : 'car']++;
      return v;
    }
    return null;
  }

  /**
   * A police car's roof light bar: a dark housing with two strobing lenses.
   * Every unit gets one at spawn; a cruiser bought from the delivery menu
   * gets one when you first drive it (main.js updateSiren). Idempotent.
   */
  lightBar(v) {
    if (v.lightL) return;
    const bar = new THREE.Group();
    const y = v.spec.roof + 0.09;
    // the SWAT van's sits on the front of its box, and is wider
    if (v.spec.swat) { bar.position.set(0, 2.92 + 0.09 - y, 0.40); bar.scale.set(1.37, 1, 1); }
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(1.24, 0.1, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6, metalness: 0.1 })
    );
    housing.position.set(0, y - 0.03, 0.05);
    bar.add(housing);
    // `hot` lit, `cold` the lens with the lights off (policeLights)
    const mkL = (hot, cold, x) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 0.15, 0.3),
        new THREE.MeshBasicMaterial({ color: hot, toneMapped: false })
      );
      m.userData.hot = hot;
      m.userData.cold = cold;
      m.position.set(x, y + 0.07, 0.05);
      bar.add(m);
      return m;
    };
    v.lightL = mkL(0x3355ff, 0x1a2338, -0.31);
    v.lightR = mkL(0xff2a2a, 0x3a1a1c, 0.31);
    v.tilt.add(bar);
    // Remember the light bar so `remove` can free it. A vehicle SHARES its
    // trim and matte geometry and materials with every other instance, so
    // nothing may traverse-and-dispose a car -- only the per-instance extras
    // built here. Cops churn continuously during a chase, and this was three
    // geometries and three materials leaked every time one despawned.
    v.extra = bar;
  }

  /** Strobe a light bar's lenses (`on`), or show them dark. */
  policeLights(v, dt, on) {
    if (!v.lightL) return;
    const L = v.lightL, R = v.lightR;
    if (on) {
      v.siren = (v.siren || 0) + dt;
      const blink = Math.sin(v.siren * 11) > 0;
      if (L.visible !== blink) { L.visible = blink; R.visible = !blink; }
    } else if (!L.visible || !R.visible) { L.visible = R.visible = true; }
    const want = on ? 'hot' : 'cold';
    if (L.material.color.getHex() !== L.userData[want]) {
      L.material.color.setHex(L.userData[want]);
      R.material.color.setHex(R.userData[want]);
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
        if (e.noTraffic) continue;         // a stunt ramp stands on it
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

  /**
   * Hand every vehicle past FAR_LOD to its type's InstancedMesh, and take back
   * the ones that came closer. The car keeps its own group, transform and
   * collision; only its `tilt` (every mesh it draws) is hidden while a slot in
   * the instanced mesh stands in for it.
   */
  updateFarLod(px, pz, player) {
    if (FAR_LOD === Infinity) return;
    const lim = FAR_LOD * FAR_LOD;
    for (const e of this.farMeshes.values()) e.n = 0;
    // An InstancedMesh culls as ONE object, so every slot in it would be drawn
    // whenever any is on screen. Cull per car here instead, against last
    // frame's camera (the camera moves after traffic), with a margin for it.
    // (frustum computed at the top of update)
    const cam = this.camera, fr = this._farFr, sph = this._farS;
    for (const v of this.cars) {
      const far = v !== player.vehicle && v.group.visible && !v.rider && !v.extra && !v.detailedWheels
        && dist2(v.x, v.z, px, pz) > lim;
      if (v.tilt.visible === far) v.tilt.visible = !far;
      // Nothing of a far car's own is drawn, and a settled parked car does not
      // move: neither needs three to recompute its five matrices every frame.
      // (A shunt makes a parked car 'free', which thaws it.)
      const frozen = v !== player.vehicle && (far || ((v.mode === 'parked' || v.mode === 'apron') && v._still >= 3));
      if (v.group.matrixWorldAutoUpdate === frozen) {
        v.group.matrixWorldAutoUpdate = !frozen;
        // FREEZE WHAT IS THERE NOW. A frozen car keeps the world matrices it
        // has, and three may never have composed them: a parked car spawned
        // hidden past PARKED_SHOW (the scene skips hidden objects,
        // skipHiddenMatrices) or straight into the far band (instanced, its
        // own meshes never drawn) froze at identity, and a parked car never
        // thaws -- so where the far LOD handed it back, at 60 m, its meshes
        // were drawn at the origin and the car vanished.
        if (frozen) v.group.updateMatrixWorld(true);
      }
      if (!far) continue;
      if (cam) {
        sph.center.set(v.x, v.y + 1, v.z);
        sph.radius = v.halfLen + 6;
        if (!fr.intersectsSphere(sph)) continue;
      }
      let e = this.farMeshes.get(v.typeName);
      if (!e) this.farMeshes.set(v.typeName, (e = { mesh: null, cap: 0, n: 0 }));
      if (e.n === e.cap) this.growFar(e, v.typeName);
      v.group.updateMatrix();
      v.tilt.updateMatrix();
      this._farM.multiplyMatrices(v.group.matrix, v.tilt.matrix);
      e.mesh.setMatrixAt(e.n, this._farM);
      if (!v._farCol) v._farCol = new THREE.Color(v.color);
      e.mesh.setColorAt(e.n, v._farCol);
      e.n++;
    }
    for (const e of this.farMeshes.values()) {
      if (!e.mesh) continue;
      e.mesh.count = e.n;
      e.mesh.visible = e.n > 0;
      if (!e.n) continue;
      e.mesh.instanceMatrix.needsUpdate = true;
      e.mesh.instanceColor.needsUpdate = true;
      e.mesh.computeBoundingSphere();
    }
  }

  growFar(e, typeName) {
    const { geo, mat } = farLod(typeName);
    const cap = Math.max(8, e.cap * 2);
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (e.mesh) {
      m.instanceMatrix.array.set(e.mesh.instanceMatrix.array.subarray(0, e.n * 16));
      m.instanceColor.array.set(e.mesh.instanceColor.array.subarray(0, e.n * 3));
      this.scene.remove(e.mesh);
      e.mesh.dispose();
    }
    m.name = 'farTraffic';
    this.scene.add(m);
    e.mesh = m;
    e.cap = cap;
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
    // Units by the wanted level's table (police.js LEVELS): cruisers first,
    // then the SWAT vans. police.n counts what is out (a unit whose crew is
    // on foot nearby still counts) -- last frame's, which is close enough
    // for a spawn that comes 1.4 s apart. While they are SEARCHING, new
    // units are sent to where you were last seen and never spawn within
    // 140 m of you: a fresh unit appearing beside you would find you every
    // time.
    this.copTimer -= dt;
    if (game.wanted > 0 && this.copTimer <= 0) {
      const pol = this.police, lv = pol ? pol.level() : null;
      const nCars = pol ? pol.n.cars : policeCount, nVans = pol ? pol.n.vans : 0;
      const want = lv ? lv.cars : Math.min(9, 1 + game.wanted * 2);
      const srch = pol && pol.searching;
      const cx = srch ? pol.lastX : px, cz = srch ? pol.lastZ : pz, avoid = srch ? { x: px, z: pz } : null;
      const near = !srch && pol && pol.playerSlow;
      // (the vans go out after the first cruiser, not after the last: they
      // are what four stars is)
      if (lv && nVans < lv.vans && (nCars >= 1 || nCars >= want)) { this.copTimer = 1.4; this.spawnPolice(cx, cz, 'swat', avoid, near); pol.n.vans++; }
      else if (nCars < want) { this.copTimer = 1.4; this.spawnPolice(cx, cz, 'car', avoid, near); if (pol) pol.n.cars++; }
    }

    // Last frame's camera frustum, for the far LOD and the half-rate AI below
    // (the camera moves after traffic; the tests carry a margin for it).
    const cam = this.camera, fr = this._farFr, sph = this._farS;
    if (cam) {
      cam.updateMatrixWorld();
      this._farM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      fr.setFromProjectionMatrix(this._farM);
    }
    this._tick = (this._tick + 1) | 0;

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v === player.vehicle) continue;
      // an articulated bus's rear section is placed by its front (below)
      if (v.mode === 'trailer') { if (!v.leader) this.remove(v); continue; }
      const d2 = dist2(v.x, v.z, px, pz);
      // 'apron' is the airport's planes: player-flyable set dressing that has
      // to still be there when you drive back an hour later.
      // 'race': the hydroplane race's boats (hydrorace.js drives them)
      // 'path': a cyclist on the bike paths (bikes.js rides them)
      if (v.mode === 'race' || v.mode === 'path') continue;
      if (d2 > DESPAWN * DESPAWN && v.mode !== 'parked' && v.mode !== 'apron') { this.remove(v); continue; }
      if (v.mode === 'police' && game.wanted === 0 && d2 > 140 * 140) { this.remove(v); continue; }

      if (v.mode === 'parked') {
        v.group.visible = d2 < PARKED_SHOW * PARKED_SHOW;
        if (v._still < 3) v._still++;   // settled: updateFarLod freezes its matrices
        continue;
      }
      // A quad left on the grass ('apron', the parks' own) is a parked car
      // once it has settled: no driving model, seven ground samples, every
      // frame, for something standing still. A shunt gives it speed, which
      // wakes it.
      // 'apron' vehicles (the airfield's aircraft, the dock's boats, the
      // parks' quads) never despawn, and they were drawn at ANY range: from
      // downtown six of the nineteen, 1-10 km away, were in the frustum, three
      // draws each, and all nineteen were culled every frame. They show out
      // to 80 lengths, about 10 px on a phone -- a jet to 1.2 km, a boat to
      // 460 m, a quad to 160 m -- and never closer than a parked car does.
      // (`showR` caps it: a fire rig is three draws, six with its trailer, and a
      // dozen stations' aprons would otherwise draw from 800 m)
      const show = v.mode !== 'apron' || d2 < (v.spec.showR || Math.max(PARKED_SHOW, v.spec.len * 80, v.spec.seeFar || 0)) ** 2;
      // ...and so, once settled, is anything else standing on an apron: the
      // bike-share bikes, the airfield's aircraft, a moored boat (except one
      // within 120 m, which bobs). 114 of the 158 vehicles in the list are
      // apron vehicles since the docks, and within 300 m each ran the whole
      // driving model every frame to stand still.
      // (a fire rig on its station apron too: its trailer is placed by follow below)
      const settles = v.spec.atv || v.spec.tank || v.spec.bicycle || v.spec.fire || (v.spec.plane && !v.airborne) || (v.spec.boat && d2 > 120 * 120);
      if (v.mode === 'apron' && settles && d2 < 300 * 300 && Math.abs(v.vLong) < 0.05 && Math.abs(v.vLat) < 0.05) {
        v.group.visible = show;
        if (v._still < 3) v._still++;
        else continue;
      } else v._still = 0;
      v.group.visible = show;
      // The airport's planes sit where place() put them, as parked cars do, and
      // from downtown all eight used to run the driving model every frame.
      if (v.mode === 'apron' && d2 > 300 * 300) continue;
      // Distant AI cars take one ground sample instead of four (Vehicle.update).
      v.lowDetail = ON_PHONE && d2 > 60 * 60;
      if (SHADOW_NEAR !== Infinity) {
        const cast = d2 < SHADOW_NEAR * SHADOW_NEAR;
        if (v._cast !== cast) { v._cast = cast; v.group.traverse((o) => { if (o.isMesh) o.castShadow = cast; }); }
      }

      // HALF-RATE AI where nobody can see it: on a phone, a car 80 m+ away and
      // off screen drives and collides with the world every other frame, on
      // the time it has accumulated. Car-car collisions and the far LOD still
      // run every frame; the moment it is on screen it is back to every frame.
      let vdt = dt;
      v._acc += dt;
      // (a police unit too, 120 m+ off: it drives the same driver now)
      if (ON_PHONE && cam && (v.mode === 'traffic' || (v.unit && v.mode === 'police' && d2 > 120 * 120)) && d2 > 80 * 80) {
        sph.center.set(v.x, v.y + 1, v.z);
        sph.radius = v.halfLen + 8;
        if (!fr.intersectsSphere(sph) && ((this._tick + i) & 1)) continue;
      }
      vdt = Math.min(v._acc, 0.1);
      v._acc = 0;

      let input;
      if (v.mode === 'traffic') {
        input = this.driveTraffic(v, vdt, px, pz, player);
        if (v.recycle) { this.remove(v); continue; }
      }
      else if (v.mode === 'police') input = this.drivePolice(v, vdt, px, pz, player);
      // shunted, abandoned or parked on an apron: nobody at the wheel, so the
      // parking brake (Vehicle.update `park`); aircraft and boats keep their old coast
      // (shared: Vehicle.update only reads its input)
      else input = v.spec.plane || v.spec.boat ? COAST_IN : PARK_IN;

      v.update(vdt, input);
      collideWithBuildings(v, city, null, true);
    }

    this.resolveCarCollisions(dt, player);
    // articulated buses: each rear section follows its front, the player's too
    for (const v of this.cars) {
      if (!v.trailer) continue;
      if (v.bellows) v.bellows.visible = v.group.visible && dist2(v.x, v.z, px, pz) < 150 * 150;
      // (a rig standing on its apron has not moved its trailer either)
      const k = v.x * 7.3 + v.z * 3.1 + v.heading * 11 + v.y;
      if (v._mode !== 'apron' || v === player.vehicle || k !== v._followK) { v._followK = k; v.trailer.follow(v); }
      v.trailer.group.visible = v.group.visible;
    }
    // collision resolution edits transforms directly, so re-sync every body.
    for (const v of this.cars) if (v !== player.vehicle) v.sync();
    this.updateFarLod(px, pz, player);

  }

  // --- how the AI drives ----------------------------------------------------
  //
  // See "How the AI drives" in CLAUDE.md. A car carries a short planned ROUTE
  // (v.rt, RT_MAX entries of RT_F numbers): the edge it is on, then the next
  // few it will take, each with the lane it will hold there. Between two
  // entries is a VERTEX: where the two lanes' centre lines meet, rounded off
  // by a circular arc (a fillet) whose radius is what the corner allows. The
  // car steers by pure pursuit along that path and plans its speed along it:
  // every arc and every slower street ahead is a speed it must be down to by
  // the time it gets there, and the car ahead is an IDM leader. Nothing here
  // is per-frame state but the route; it is rebuilt one entry at a time as
  // the car moves on.

  /** Fill route entry `o` (an offset into v.rt) with edge ei driven `sign`,
   *  in lane fraction `u`. */
  routeEntry(v, o, ei, sign, u) {
    const rt = v.rt, e = this.city.edges[ei];
    let off = this.laneLatU(ei, sign, u);
    // A BORE'S WALLS ARE SOLID (hw + 0.4), and a vehicle collides as a
    // circle: 0.7 x radius plus the barrier's 0.8 m, 4.3 m for a bus. In a
    // tube's right lane (+3.1 m) a bus was permanently in contact with the
    // wall, pushed off it every frame and steered back into it, and crawled
    // along the stacked SR-99 decks at 6 m/s with the traffic behind it (the
    // side-by-side twins had no shared walls there, so it never showed).
    // Long vehicles hold their lane a hand's breadth clear of the wall.
    if (e.tunnel && !e.elev) {
      const lim = Math.max(0, e.hw + 0.4 - (v.radius * 0.7 + 1.1));
      off = clamp(off, -lim, lim);
    }
    const na = this.city.nodes[sign > 0 ? e.a : e.b];
    const ux = e.dx * sign, uz = e.dz * sign;
    rt[o + R_EI] = ei; rt[o + R_SG] = sign; rt[o + R_OFF] = off; rt[o + R_U] = u;
    // the lane's centre line starts at the start node, `off` to the right
    // (travelling (ux, uz), right is (-uz, ux))
    rt[o + R_QX] = na.x - uz * off; rt[o + R_QZ] = na.z + ux * off;
    rt[o + R_UX] = ux; rt[o + R_UZ] = uz;
    rt[o + R_LEN] = e.len; rt[o + R_SPD] = e.spd; rt[o + R_END] = 0;
    rt[o + V_K] = 0; rt[o + V_A] = 0; rt[o + V_B] = 0; rt[o + V_T] = 0; rt[o + V_R] = Infinity; rt[o + V_TH] = 0;
  }

  /** Start a car's route afresh on (v.edge, v.dirSign), lane v.laneU. */
  routeInit(v) {
    if (!v.rt) v.rt = new Float64Array(RT_F * RT_MAX);
    if (!v.aiIn) v.aiIn = { throttle: 0, brake: 0, steer: 0, handbrake: 0, park: false };
    this.routeEntry(v, 0, v.edge, v.dirSign, v.laneU != null ? v.laneU : 0.5);
    v.rtN = 1;
  }

  /** The lane fraction on one-way edge ei (driven `sign`) whose lane is
   *  nearest lateral offset `off`: a car carries on in ITS lane where the
   *  number of lanes changes, instead of keeping a fraction of the width. */
  nearestLaneU(ei, sign, off) {
    this.laneLatU(ei, sign, 0.5);          // fills the lane cache
    const L = this.lanes, k = ei * 3, n = L[k + 2];
    const w = (L[k + 1] - L[k]) / n;
    if (!(w > 0)) return 0.5;
    const i = clamp(Math.floor((off * sign - L[k]) / w), 0, n - 1);
    return (i + 0.5) / n;
  }

  /** Plan one more entry onto the end of v's route. False at a dead end. */
  routeExtend(v) {
    const rt = v.rt, city = this.city, o = (v.rtN - 1) * RT_F;
    if (rt[o + R_END] || v.rtN >= RT_MAX) return false;
    const ei = rt[o + R_EI], sign = rt[o + R_SG], e = city.edges[ei];
    const node = sign > 0 ? e.b : e.a;
    // (a police unit in pursuit takes its A* path's turns)
    const nx = v.unit && v.mode === 'police' ? this.pursuitEdge(v, ei, sign, node) : this.pickNextEdge(v, ei, sign, node);
    if (!nx) { rt[o + R_END] = 1; return false; }
    const ne = city.edges[nx.ei];
    const pux = rt[o + R_UX], puz = rt[o + R_UZ], nux = ne.dx * nx.sign, nuz = ne.dz * nx.sign;
    const cos = pux * nux + puz * nuz, crs = pux * nuz - puz * nux;
    // Straight on: the nearest lane. A turn: the same share of the width.
    let u = rt[o + R_U];
    if (cos > 0.94 && this.flow[nx.ei] !== 0) u = this.nearestLaneU(nx.ei, nx.sign, rt[o + R_OFF]);
    const q = o + RT_F;
    this.routeEntry(v, q, nx.ei, nx.sign, u);
    // THE VERTEX: where the two lanes' centre lines cross (a on the old line,
    // b on the new), rounded by an arc of radius R that touches both lines t
    // either side of it. A junction's corner is at most JR_RIGHT / JR_LEFT
    // (a left turn swings wide, across the junction); a bend in a street is
    // whatever its segments leave room for.
    const plen = rt[o + R_LEN], nlen = rt[q + R_LEN];
    const th = Math.acos(clamp(cos, -1, 1));
    rt[q + V_K] = 2; rt[q + V_A] = plen; rt[q + V_B] = 0;
    // A jog (near-parallel lines, a lane shift, a hairpin): no arc. Its speed
    // is still the bend's, from the radius its segments allow.
    rt[q + V_R] = th < 0.035 ? Infinity : (0.5 * Math.min(plen, nlen)) / Math.tan(Math.min(th, 2.8) / 2);
    if (Math.abs(crs) > 0.035 && cos > -0.9) {
      const dx = rt[q + R_QX] - rt[o + R_QX], dz = rt[q + R_QZ] - rt[o + R_QZ];
      const a = (dx * nuz - dz * nux) / crs, b = (dx * puz - dz * pux) / crs;
      const pStart = rt[o + V_K] === 1 ? rt[o + V_B] + rt[o + V_T] : 0;
      if (a > pStart - 2 && a < plen + 25 && b > -25 && b < nlen) {
        const tanH = Math.tan(th / 2);
        const jn = city.nodes[node].e.length >= 3;
        const rCap = jn ? (crs > 0 ? JR_RIGHT : JR_LEFT) : CURVE_RMAX;
        const t = Math.min(rCap * tanH, 0.45 * Math.max(0, a - pStart), 0.45 * Math.max(0, nlen - b));
        if (t > 0.25) {
          const R = t / tanH, side = crs > 0 ? 1 : -1;
          // n0: from the arc's first tangent point towards its centre
          const n0x = -puz * side, n0z = pux * side;
          const cx = rt[o + R_QX] + pux * a, cz = rt[o + R_QZ] + puz * a;
          rt[q + V_K] = 1; rt[q + V_A] = a; rt[q + V_B] = b; rt[q + V_T] = t; rt[q + V_R] = R; rt[q + V_TH] = th;
          rt[q + V_OX] = cx - pux * t + n0x * R; rt[q + V_OZ] = cz - puz * t + n0z * R;
          rt[q + V_NX] = n0x; rt[q + V_NZ] = n0z; rt[q + V_PX] = pux; rt[q + V_PZ] = puz;
        }
      }
    }
    v.rtN++;
    return true;
  }

  /** Where entry j's straight ends (the next arc's first tangent point, or
   *  its end node), in its own along-line distance. */
  lineEnd(rt, rtN, j) {
    if (j + 1 < rtN) { const q = (j + 1) * RT_F; return rt[q + V_A] - rt[q + V_T]; }
    return rt[j * RT_F + R_END] ? rt[j * RT_F + R_LEN] : Infinity;
  }

  /** The point `d` along vertex q's arc from its first tangent point. */
  arcPoint(rt, q, d, out) {
    const R = rt[q + V_R], ph = clamp(d / R, 0, rt[q + V_TH]);
    const c = Math.cos(ph), s = Math.sin(ph);
    out.x = rt[q + V_OX] + R * (-rt[q + V_NX] * c + rt[q + V_PX] * s);
    out.z = rt[q + V_OZ] + R * (-rt[q + V_NZ] * c + rt[q + V_PZ] * s);
  }

  /** The point `L` ahead of along-distance s0 on entry 0, along the path. */
  pathAhead(v, s0, L, out) {
    const rt = v.rt, rtN = v.rtN;
    let s = s0, rem = L;
    // still in the second half of the arc behind (the corner just turned)
    if (rt[V_K] === 1) {
      const t2 = rt[V_B] + rt[V_T];
      if (s < t2) {
        const left = t2 - s, alen = rt[V_R] * rt[V_TH];
        if (rem < left) { this.arcPoint(rt, 0, alen - Math.min(alen, left - rem), out); return; }
        rem -= left; s = t2;
      }
    }
    for (let j = 0; ; j++) {
      const o = j * RT_F, end = this.lineEnd(rt, rtN, j);
      if (s + rem <= end || j + 1 >= rtN) {
        const a = Math.min(s + rem, end === Infinity ? s + rem : end);
        out.x = rt[o + R_QX] + rt[o + R_UX] * a;
        out.z = rt[o + R_QZ] + rt[o + R_UZ] * a;
        return;
      }
      // (s past `end` is a car already into the arc's first half: the
      // overshoot is its progress round it)
      rem -= end - s;
      const q = o + RT_F;
      if (rt[q + V_K] === 1) {
        const alen = rt[q + V_R] * rt[q + V_TH];
        if (rem <= alen) { this.arcPoint(rt, q, rem, out); return; }
        rem -= alen;
        s = rt[q + V_B] + rt[q + V_T];
      } else s = rt[q + V_B];
    }
  }

  /**
   * The acceleration the road ahead asks for at speed `vel`: for every
   * corner, every slower street and a dead end along the planned route, the
   * constant deceleration that arrives there at its speed (or Infinity: no
   * constraint). The route is extended as far as the stopping horizon.
   */
  roadAccel(v, s0, vel) {
    const rt = v.rt;
    // a unit in pursuit corners harder, and holds its own pace whatever the
    // street's limit (its corners still bind)
    const aLat = v.unit ? A_LAT_POLICE : A_LAT, unit = !!v.unit;
    const horizon = (vel * vel) / (2 * B_PLAN) + 30;
    let aMin = Infinity, d = 0;
    const cons = (vk, dist) => {
      if (vel <= vk) return;
      const a = (vk * vk - vel * vel) / (2 * Math.max(dist, 1.5));
      // (a unit in pursuit brakes late and hard: traffic starts easing off
      // for a corner the moment it is inside the horizon, which held a
      // cruiser to ~10 m/s on a downtown grid)
      if (unit && a > -BRAKE_POLICE) return;
      if (a < aMin) aMin = a;
    };
    // the corner being turned
    if (rt[V_K] === 1 && s0 < rt[V_B] + rt[V_T]) cons(Math.sqrt(aLat * rt[V_R]), 0);
    for (let j = 0; ; j++) {
      const o = j * RT_F;
      const start = j === 0 ? s0 : rt[o + V_K] === 1 ? rt[o + V_B] + rt[o + V_T] : rt[o + V_B];
      // plan further while the route is shorter than the horizon
      if (j + 1 >= v.rtN && d + rt[o + R_LEN] - start < horizon + 10) this.routeExtend(v);
      const end = this.lineEnd(rt, v.rtN, j);
      if (end === Infinity) break;
      d += Math.max(0, end - start);
      if (j + 1 >= v.rtN) {
        // the end of the line: a dead end, turned at a crawl (or recycled)
        if (rt[o + R_END]) cons(2.5, d - 2);
        break;
      }
      if (d > horizon) break;
      const q = o + RT_F;
      if (rt[q + V_R] < 1e5) cons(Math.sqrt(aLat * rt[q + V_R]), d);
      if (!unit) cons(rt[q + R_SPD] * v.drvK, d);
      if (rt[q + V_K] === 1) d += rt[q + V_R] * rt[q + V_TH];
    }
    return aMin;
  }

  /** Move v onto its route's next entry. */
  routeAdvance(v) {
    const rt = v.rt;
    rt.copyWithin(0, RT_F, v.rtN * RT_F);
    v.rtN--;
    v.edge = rt[R_EI]; v.dirSign = rt[R_SG]; v.laneU = rt[R_U];
  }

  driveTraffic(v, dt, px, pz, player) {
    const city = this.city;
    if (!city.edges[v.edge]) { v.mode = 'free'; return { throttle: 0, brake: 1, steer: 0 }; }
    if (!v.rt || v.rtN === 0) this.routeInit(v);
    const rt = v.rt, inp = v.aiIn;
    inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.handbrake = 0; inp.park = false;
    // where the car is along its edge's lane line, and onto the next entry
    // once it is past the vertex (the middle of the corner)
    let s0 = (v.x - rt[R_QX]) * rt[R_UX] + (v.z - rt[R_QZ]) * rt[R_UZ];
    for (let guard = 0; guard < 3; guard++) {
      if (v.rtN < 2 && !this.routeExtend(v)) break;
      const q = RT_F;
      if (s0 < (rt[q + V_K] === 1 ? rt[q + V_A] : rt[R_LEN])) break;
      this.routeAdvance(v);
      s0 = (v.x - rt[R_QX]) * rt[R_UX] + (v.z - rt[R_QZ]) * rt[R_UZ];
    }
    if (v.rtN < 2 && s0 > rt[R_LEN] - 2) {
      // The end of the route with nowhere legal to go on.
      if (this.allowed(v.edge, -v.dirSign)) {
        // two-way dead end: U-turn into the other lane
        v.dirSign = -v.dirSign; this.routeInit(v);
      } else {
        // The end of a one-way chain with no legal way on. Spawns and turns
        // keep to directed components so this should not happen; if it does,
        // a car out of the player's sight is recycled (the population refills
        // legally) rather than turned round into the oncoming lane.
        this.stats.deadEnd++;
        const seen = dist2(v.x, v.z, px, pz) < 120 * 120;
        if (!seen) { this.stats.deadEndDespawn++; v.recycle = true; inp.brake = 1; return inp; }
        v.dirSign = -v.dirSign; this.routeInit(v);
      }
      s0 = (v.x - rt[R_QX]) * rt[R_UX] + (v.z - rt[R_QZ]) * rt[R_UZ];
    }
    const sp = Math.max(0, v.vLong);
    // (first: it extends the route as far as the car can see)
    const aRoad = this.roadAccel(v, s0, sp);

    // STEERING: pure pursuit of the point L along the path. The curvature
    // that reaches it, 2 sin(alpha) / distance, is turned into a wheel angle
    // by the vehicle's own bicycle model (aiSteer), so the same path is the
    // same path for a hatchback and a bus, at any speed.
    const L = clamp(3.5 + 0.5 * sp, 5, 20);
    const P = this._P;
    this.pathAhead(v, s0, L, P);
    // steering round a car standing in the lane (the scan below sets it)
    if (v.dodgeT > 0) { P.x -= rt[R_UZ] * v.dodge; P.z += rt[R_UX] * v.dodge; v.dodgeT -= dt; } else v.dodge = 0;
    const ddx = P.x - v.x, ddz = P.z - v.z, ld = Math.hypot(ddx, ddz) || 1;
    const alpha = angleWrap(Math.atan2(ddx, ddz) - v.heading);
    // Far off the path's heading (a U-turn, a car shunted round): full lock.
    inp.steer = Math.abs(alpha) > 1.3 ? Math.sign(alpha) : v.aiSteer((2 * Math.sin(alpha)) / ld);

    // SPEED: the road ahead (corners, slower streets) and the car ahead (IDM),
    // whichever asks for less, as one wanted acceleration.
    // A SIREN COMING UP BEHIND (your police car with its siren on: main.js
    // sets sirenFrom): ease off to 40 % and, off residential streets, keep
    // right (the dodge's offset, + = right) so it can get by.
    let yieldK = 1;
    const sf = this.sirenFrom;
    if (sf && sf !== v && !v.unit) {
      const bx = v.x - sf.x, bz = v.z - sf.z, sw = sf.forward, vf = v.forward;
      const ahead = bx * sw.x + bz * sw.z;
      if (ahead > 0 && ahead < 70 && Math.abs(bx * sw.z - bz * sw.x) < 9
        && vf.x * sw.x + vf.z * sw.z > 0.5 && Math.abs(v.y - sf.y) < 3) {
        yieldK = 0.4;
        this.stats.yielded++;
        if (v.dodgeT <= 0 && city.edges[v.edge].cls !== 'res') { v.dodge = 0.7; v.dodgeT = 0.3; }
      }
    }
    const v0 = v.unit ? v.pursuitV : rt[R_SPD] * v.drvK * (v.panic > 0 ? 1.5 : 1) * yieldK;
    let aWant = Math.min(aRoad, Math.abs(alpha) > 1.3 ? (9 - sp * sp) / 6 : Infinity);
    const heavy = v.spec.bus || v.spec.cargo;
    const aMax = v.unit ? 4.5 : heavy ? 1.3 : 2.0;   // (a unit in pursuit puts its foot down)
    // THE CAR AHEAD, judged along the PATH: the planned route sampled every
    // few metres out to the scan length. A straight corridor along the bonnet
    // saw the far side of every junction a car was about to turn at (and
    // waited on whatever stood there), and on a bend the next lane's cars.
    const f = v.forward;
    const scanLen = Math.max(30, (sp * sp) / (2 * IDM_B) + sp * IDM_T + 15);
    const step = Math.max(4, scanLen / 10), ps = this._ps;
    ps[0] = v.x; ps[1] = v.z;
    let np = 1;
    for (let D = step; np < 12 && D < scanLen + step; D += step, np++) {
      this.pathAhead(v, s0, D, P);
      ps[2 * np] = P.x; ps[2 * np + 1] = P.z;
    }
    // The sampled path's segments, once: every car near enough is projected
    // onto all of them (three more times if it is crossing), and this was a
    // Math.hypot per segment per car looked at.
    const sg = this._pseg;
    for (let k = 0; k < np - 1; k++) {
      const sx = ps[2 * k + 2] - ps[2 * k], sz = ps[2 * k + 3] - ps[2 * k + 1];
      sg[3 * k] = sx; sg[3 * k + 1] = sz; sg[3 * k + 2] = Math.hypot(sx, sz) || 1e-3;
    }
    let gap = Infinity, vLead = 0, lead = null;
    let stopAt = Infinity;   // distance to stop short of something that is not a car in the lane
    const reach2 = (scanLen + 8) * (scanLen + 8);
    for (const o of this.cars) {
      if (o === v) continue;
      // A car on another deck is not ahead of you. In SR-99's stacked bore the
      // other direction runs DECK_SEP overhead or underneath on the same
      // line, and the plan-only scan braked every car for oncoming traffic on
      // the other deck: stopped queues mid-bore. Same 3 m band the car-car
      // collision uses.
      if (Math.abs(o.y - v.y) > 3) continue;
      const rx = o.x - v.x, rz = o.z - v.z;
      if (rx * rx + rz * rz > reach2) continue;
      const fwd = rx * f.x + rz * f.z;
      if (fwd < -2) continue;
      // Something standing still (a kerbside car, a settled apron vehicle)
      // only matters close in, to be dodged: most of the list is parked
      // cars, and walking the path for each one was the cost of this scan.
      if (fwd > 25 && (o.mode === 'parked' || o.mode === 'apron' || (o.mode === 'free' && Math.abs(o.vLong) < 0.5))) continue;
      // nearest point of the sampled path: how far along it, how far off it
      let best = Infinity, along = 0, acc = 0, sdx = f.x, sdz = f.z, sax = v.x, saz = v.z;
      for (let k = 0; k < np - 1; k++) {
        const ax = ps[2 * k], az = ps[2 * k + 1], sx = sg[3 * k], sz = sg[3 * k + 1], l = sg[3 * k + 2];
        let t = ((o.x - ax) * sx + (o.z - az) * sz) / (l * l);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = o.x - ax - sx * t, ez = o.z - az - sz * t, dd = ex * ex + ez * ez;
        if (dd < best) { best = dd; along = acc + t * l; sdx = sx / l; sdz = sz / l; sax = ax; saz = az; }
        acc += l;
      }
      if (along < 0.5) continue;
      const fo = o.forward, co = fo.x * sdx + fo.z * sdz, so = Math.abs(fo.x * sdz - fo.z * sdx);
      // its half-extent across my path, and along it
      const ext = o.halfWid * Math.abs(co) + o.halfLen * so;
      const wid = v.halfWid + ext + 0.35;
      if (best > wid * wid) {
        // CROSS TRAFFIC: a driven car crossing my path that will be where I
        // am going when I get there. Whoever gets there first goes; on a tie
        // the older car. Predicted along its heading at 0.8 / 1.6 / 2.4 s.
        // (a unit with its lights on yields to nobody)
        if (!v.unit && Math.abs(co) < 0.5 && Math.abs(o.vLong) > 1.5 && (o.mode === 'traffic' || o.mode === 'police' || o === player.vehicle)) {
          for (let tt = 0.8; tt < 2.5; tt += 0.8) {
            const qx = o.x + fo.x * o.vLong * tt, qz = o.z + fo.z * o.vLong * tt;
            let bq = Infinity, aq = 0, ac = 0;
            for (let k = 0; k < np - 1; k++) {
              const ax = ps[2 * k], az = ps[2 * k + 1], sx = sg[3 * k], sz = sg[3 * k + 1], l = sg[3 * k + 2];
              let t = ((qx - ax) * sx + (qz - az) * sz) / (l * l);
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              const ex = qx - ax - sx * t, ez = qz - az - sz * t, dd = ex * ex + ez * ez;
              if (dd < bq) { bq = dd; aq = ac + t * l; }
              ac += l;
            }
            if (bq > wid * wid || aq < v.halfLen) continue;
            const tMe = aq / Math.max(sp, 1);
            if (tt < tMe - 0.4 || (tt <= tMe + 0.4 && o.prio < v.prio)) {
              const g = aq - v.halfLen - o.halfWid - 1.5;
              if (g < gap) { gap = g; vLead = 0; lead = o; }
            }
            break;
          }
        }
        continue;
      }
      // AN UNATTENDED CAR STANDING IN THE PATH is driven round, not queued
      // behind: a parked car knocked out of its slot, one you got out of.
      // Car-car collision used to shove it along (circles pushing circles);
      // with the bodies' boxes a queue sat behind it for good. The dodge is
      // an offset from the lane, away from the side the car stands on, held
      // for 1.2 s after it was last seen.
      // (a unit in pursuit drives round slow traffic the same way: there are
      // no signals, and a queue behind a wedge is a chase that never comes)
      if ((((o.mode === 'free' || o.mode === 'parked') && Math.abs(o.vLong) < 0.5)
        || (v.unit && o.mode === 'traffic' && Math.abs(o.vLong) < v.pursuitV * 0.6)) && o !== player.vehicle && along < 25) {
        const lat = (o.x - sax) * -sdz + (o.z - saz) * sdx;   // + = right of the path
        const need = wid + 0.35, dl = lat >= 0 ? lat - need : lat + need;
        if (Math.abs(dl) > Math.abs(v.dodge) || v.dodgeT <= 0) v.dodge = clamp(dl, -LANE_W, LANE_W);
        v.dodgeT = 1.2;
        // too close to get round: stop
        if (along < v.halfLen + o.halfLen + 1.5 && Math.abs(lat - v.dodge) < wid - 0.4) stopAt = 0;
        continue;
      }
      // GRIDLOCK: two cars each waiting on the other (crossing at a junction,
      // nosing into the same gap) would wait for ever. The older one goes.
      if (o.lead === v && o.prio > v.prio && Math.abs(o.vLong) < 1) continue;
      const g = along - v.halfLen - (o.halfLen * Math.abs(co) + o.halfWid * so);
      if (g < gap) { gap = g; vLead = o.vLong * co; lead = o; }
    }
    v.lead = lead;
    // A Link train on (or coming to) the level crossing ahead: wait for it.
    const lk = this.link;
    const look = Math.max(scanLen * 0.5, 20);
    if (lk && lk.onGradeCorridor(v.x, v.z)) {
      for (let d = 3; d <= look; d += 3) {
        if (lk.blocks(v.x + f.x * d, v.z + f.z * d, v.y)) { stopAt = Math.min(stopAt, d - 4); break; }
      }
    }
    // A freight crossing's gates coming down ahead: stop at the arm.
    const fr = this.freight;
    if (fr && fr.crossCells) {
      for (let d = 3; d <= look + 6; d += 3) {
        if (fr.blocks(v.x + f.x * d, v.z + f.z * d, v.y)) { stopAt = Math.min(stopAt, d - 4); break; }
      }
    }
    // YOU, ON FOOT. It used to look 10 m ahead, which at 15 m/s is well
    // inside its stopping distance, and only at where you were: a car saw you
    // step off the kerb once it was too late to stop. Now it looks as far as
    // it needs to stop (plus a margin), at where you will be by the time it
    // gets there, and stops short of you when you are inside that.
    let urgent = false;
    if (player.onFoot && Math.abs(player.y - v.y) < 3) {
      const reach = Math.max(10, sp * sp / 12 + sp * 0.6 + 6);
      const rx = player.x - v.x, rz = player.z - v.z;
      const fwd = rx * f.x + rz * f.z;
      if (fwd > 0 && fwd < reach) {
        const t = Math.min(2, fwd / Math.max(sp, 3));
        const pv = player.speed || 0, ph = player.heading || 0;
        const qx = rx + Math.sin(ph) * pv * t, qz = rz + Math.cos(ph) * pv * t;
        const lat = Math.min(Math.abs(rx * f.z - rz * f.x), Math.abs(qx * f.z - qz * f.x));
        if (lat < v.halfWid + 1.3) {
          stopAt = Math.min(stopAt, fwd - v.halfLen - 1.5);
          if (fwd < sp * sp / 12 + 7) urgent = true;
        }
      }
    }
    // IDM: free-road term plus the interaction with the leader.
    const vr = sp / Math.max(0.5, v0);
    let aIdm = aMax * (1 - vr * vr * vr * vr);
    if (gap < Infinity) {
      const ss = IDM_S0 + Math.max(0, sp * IDM_T + (sp * (sp - vLead)) / (2 * Math.sqrt(aMax * IDM_B)));
      const r = ss / Math.max(gap, 0.1);
      aIdm -= aMax * r * r;
    }
    aWant = Math.min(aWant, aIdm);
    if (stopAt < Infinity) aWant = Math.min(aWant, stopAt <= 0.3 ? -9 : -(sp * sp) / (2 * stopAt));
    if (urgent) aWant = Math.min(aWant, -v.spec.brakeA);
    aWant = Math.max(aWant, -v.spec.brakeA);
    // At a standstill the brake is reverse gear: a stopped car HOLDS (the
    // parking brake) until it wants to go again, with a little hysteresis.
    if (v.held ? aWant < 0.4 : (sp < 0.8 && aWant < 0)) { v.held = true; inp.park = true; }
    else { v.held = false; v.aiPedals(aWant, inp); }
    v.wantGo = aWant > 0.5 && stopAt === Infinity;
    // Wanting to go and not moving for a second: pressed against a post or a
    // wall, where a gentle throttle loses to the contact every frame. Floor it.
    if (v.wantGo && v.stuckT > 1) { inp.throttle = 1; inp.brake = 0; }
    if (v.panic > 0) v.panic -= dt;
    // Wedged: wanting to go, nothing ahead to wait for, and not moving -- a
    // bus against a lamp post on a lidded ramp, a car shunted onto a kerb
    // tree. The collision response takes most of its speed every frame, so it
    // never frees itself, and every car behind it queues. Out of the player's
    // sight it is recycled like a dead-end car; in sight it keeps trying.
    if (v.wantGo && Math.abs(v.vLong) < 0.5) v.stuckT += dt;
    else v.stuckT = 0;
    // ...and anything standing for 20 s out of sight, whatever it waits on:
    // there are no signals to wait at, so a car that long at rest is queued
    // behind a wedge or a gridlock of three or more, and the queue goes with it.
    if (Math.abs(v.vLong) < 0.5) v.restT += dt; else v.restT = 0;
    if ((v.stuckT > 8 || v.restT > 20) && dist2(v.x, v.z, px, pz) > 120 * 120) { this.stats.stuckRecycled++; v.recycle = true; }
    return inp;
  }

  /** The way on from nodeId for a car arriving along edge fromEi (driven
   *  fromSign), or null to turn round. */
  pickNextEdge(v, fromEi, fromSign, nodeId) {
    const city = this.city;
    const node = city.nodes[nodeId];
    if (!node) return null;
    const fe = city.edges[fromEi];
    const fx = fe.dx * fromSign, fz = fe.dz * fromSign;
    // Only legal exits, and only ones that stay in this car's directed
    // component (so it can never be led into a one-way dead end). A turn
    // sharper than ~120 deg is still refused while anything else is on offer;
    // where a legal exit is only that sharp (a one-way street's end at a
    // hairpin), it is taken rather than stopping.
    const comp = this.comp[nodeId];
    let best = null, bestScore = -Infinity, sharp = null, sharpScore = -Infinity;
    for (const ei of node.e) {
      if (ei === fromEi) continue;
      const ne = city.edges[ei];
      if (ne.noTraffic) continue;          // a stunt ramp's block
      const sign = ne.a === nodeId ? 1 : -1;
      if (!this.allowed(ei, sign)) continue;
      if (this.comp[sign > 0 ? ne.b : ne.a] !== comp) continue;
      const dx = ne.dx * sign, dz = ne.dz * sign;
      const dot = dx * fx + dz * fz;
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
    if (this.allowed(fromEi, -fromSign)) return null;
    if (sharp) this.stats.fallbackTurn++;
    return sharp;
  }

  /**
   * A police unit's driving (police.js units). FAR from its target it drives
   * the planned-path driver traffic uses (driveTraffic: lanes, filleted
   * corners, pure pursuit, the IDM), with the route's turns taken off an A*
   * path to the target (pickNextEdge, `v.path`) instead of at random, at a
   * pursuit pace (`v.pursuitV`), cornering harder than traffic, driving round
   * slow traffic and yielding to nobody. The old driver aimed straight at
   * the next node of its A* path with `heading error x 1.7` and braked for
   * anything 10 m ahead: it cut corners into kerbs and walls, the 6.6 m SWAT
   * van wedged, and a cruiser queued behind traffic for good -- two-star
   * units that never reached a man standing still. CLOSE (60 m), and off
   * the road graph, it still drives straight at you to ram or stop beside you.
   */
  drivePolice(v, dt, px, pz, player) {
    const pol = this.police;
    if (!pol) this.policeLights(v, dt, true);
    // police.js: the search point (or, heat gone, away) instead of you
    const ord = pol ? pol.carTarget(v, px, pz, dt) : null;
    const tx = ord ? ord.x : px, tz = ord ? ord.z : pz;
    const d = Math.hypot(tx - v.x, tz - v.z);
    // backing out of a wedge (below), wheel reversed: at a standstill the
    // brake is reverse
    if (v.backT > 0) {
      v.backT -= dt;
      if (v.backT <= 0) v.rtN = 0;   // and a fresh route from where it ends up
      const inp = v.aiIn || (v.aiIn = { throttle: 0, brake: 0, steer: 0, handbrake: 0, park: false });
      inp.throttle = 0; inp.brake = 1; inp.handbrake = 0; inp.park = false;
      inp.steer = -clamp(angleWrap(Math.atan2(tx - v.x, tz - v.z) - v.heading) * 1.7, -1, 1);
      return inp;
    }
    // Not getting anywhere for 5 s, whatever the reason (nose in a wall, a
    // queue it could not get round): back out for 1.6 s and plan again.
    if (Math.abs(v.vLong) < 1) v.polStuckT += dt; else v.polStuckT = 0;
    if (v.polStuckT > 5 && !(d < 20 && pol && pol.playerSlow)) {
      v.polStuckT = 0; v.backT = 1.6;
      if (pol) pol.stats.wedged[v.unit === 'swat' ? 'swat' : 'car']++;   // (wantedcheck counts them)
    }
    const lv = pol ? pol.level() : null;
    const swat = v.unit === 'swat';
    // (no A* path at all and within 160 m -- you are on a piece of the
    // graph it cannot drive to, a plaza, a pier -- it comes straight)
    if (v.noPath && (v.repath -= dt) <= 0) v.noPath = false;   // (ask again)
    if ((d > 60 && !(d < 160 && v.noPath)) || ord) {
      const pace = ord ? ord.speed : swat ? 27 : 31;
      const inp = this.pursue(v, dt, tx, tz, pace, px, pz, player);
      if (inp) return inp;
    }
    // CLOSE: straight at the target. Inside 18 m: ram at the level's speed
    // (a van harder), or stop beside a target that is not getting away, so
    // the crew can get out.
    v.rtN = 0;   // (the route is planned afresh when it next needs one)
    const desired = Math.atan2(tx - v.x, tz - v.z);
    const err = angleWrap(desired - v.heading);
    const f = v.forward;
    let brake = 0;
    for (const o of this.cars) {
      if (o === v || o.mode === 'police' || Math.abs(o.y - v.y) > 3) continue;
      const rx = o.x - v.x, rz = o.z - v.z;
      const fwd = rx * f.x + rz * f.z;
      if (fwd < 0.5 || fwd > 8) continue;
      if (Math.abs(rx * f.z - rz * f.x) > 2.0) continue;
      if (o === player.vehicle) continue;   // that one it rams
      brake = 0.7;
    }
    const slow = pol && pol.playerSlow;
    const targetSpeed = ord ? (d < 12 ? 6 : ord.speed)
      : d < 18 ? (slow ? (d < 9 ? 0 : 4) : (lv ? lv.ram : 12) + (swat ? 4 : 0))
      // (to a target standing still, a speed it can stop from in time)
      : slow ? Math.min(swat ? 22 : 26, 4 + (d - 9) * 0.55) : swat ? 22 : 26;
    const inp = v.aiIn || (v.aiIn = { throttle: 0, brake: 0, steer: 0, handbrake: 0, park: false });
    inp.steer = clamp(err * 1.7, -1, 1);
    inp.handbrake = 0; inp.park = false;
    inp.throttle = brake > 0.2 ? 0 : clamp((targetSpeed - v.vLong) * 0.5, 0, 1);
    if (targetSpeed < v.vLong - 2) brake = Math.max(brake, clamp((v.vLong - targetSpeed) * 0.15, 0, 1));
    if (Math.abs(err) > 1.4 && v.vLong > 10) brake = Math.max(brake, 0.5);
    // stopped beside a slow target: hold, don't creep back (brake = reverse)
    if (targetSpeed === 0 && Math.abs(v.vLong) < 0.8) { inp.throttle = 0; brake = 0; inp.park = true; }
    inp.brake = brake;
    return inp;
  }

  /**
   * The far half of drivePolice: a route along an A* path to (tx, tz),
   * driven by driveTraffic. Null when the unit is off the road graph (it
   * then drives straight at the target).
   */
  pursue(v, dt, tx, tz, pace, px, pz, player) {
    const city = this.city;
    // on its route's lane line? (after a ram, a spin, a back-out: plan anew)
    if (v.rt && v.rtN > 0) {
      const rt = v.rt;
      const lat = Math.abs((v.x - rt[R_QX]) * rt[R_UZ] - (v.z - rt[R_QZ]) * rt[R_UX]);
      const s0 = (v.x - rt[R_QX]) * rt[R_UX] + (v.z - rt[R_QZ]) * rt[R_UZ];
      if (lat > 7 || s0 < -15 || s0 > rt[R_LEN] + 25) v.rtN = 0;
    }
    if (!v.rt || v.rtN === 0) { if (!this.snapRoute(v)) return null; v.repath = 0; }
    // Getting no closer for 10 s (round and round a block, a path into a
    // corner the A* cannot see): a fresh route and a fresh path -- or, within
    // 160 m, 6 s straight at the target.
    const dTo = Math.hypot(tx - v.x, tz - v.z);
    if (dTo < v.progD - 10) { v.progD = dTo; v.progT = 0; }
    else if ((v.progT += dt) > 10) {
      v.progD = dTo; v.progT = 0; v.path = null; v.rtN = 1; v.rt[R_END] = 0; v.repath = 0;
      // ...and if it is close, straight at you for 6 s (drivePolice)
      if (dTo < 160) { v.noPath = true; v.repath = 6; }
    }
    // the A* path, from the end of the route's next entry; replanned every
    // 2.5 s (you move), and the route beyond that entry with it
    v.repath -= dt;
    if (v.repath <= 0 || !v.path) {
      v.repath = 2.5;
      const to = city.nearestNode(tx, tz, 250);
      const j = Math.min(1, v.rtN - 1), o = j * RT_F, e = city.edges[v.rt[o + R_EI]];
      const from = v.rt[o + R_SG] > 0 ? e.b : e.a;
      // the A* is the costly part (up to 1400 nodes): a path that still ends
      // within 60 m of the target and still runs through where the route is
      // going is kept
      const P = v.path;
      const pe = P && P.length ? city.nodes[P[P.length - 1]] : null;
      if (!(pe && to >= 0 && Math.hypot(pe.x - tx, pe.z - tz) < 60 && P.indexOf(from) >= 0)) {
        v.path = to >= 0 ? this.findPath(from, to, 1400) : null;
        v.offGraph = !v.path;
        // No path to the nearest node (a freeway's, say, which cannot be
        // driven into against its flow from here): the nearest surface
        // street's instead -- with no path at all a unit wandered by
        // compass from node to node, and could take a minute.
        if (!v.path) {
          const alt = this.surfaceNodeNear(tx, tz, this.comp[from]);
          if (alt >= 0 && alt !== to) v.path = this.findPath(from, alt, 1400);
        }
        v.noPath = !v.path;
        if (v.noPath) v.repath = 4;
        if (v.rtN > j + 1) { v.rtN = j + 1; v.rt[o + R_END] = 0; }
      }
    }
    v.pursuitTX = tx; v.pursuitTZ = tz;
    v.pursuitV = pace;
    return this.driveTraffic(v, dt, px, pz, player);
  }

  /** The nearest node of a surface street (not a freeway, ramp, deck or
   *  bore) within 150 m of (x, z) in directed component `comp` (one the unit
   *  can drive to), or -1. */
  surfaceNodeNear(x, z, comp) {
    const city = this.city;
    let best = -1, bd = 150 * 150;
    for (const ei of city.edgesNear(x, z, 150)) {
      const e = city.edges[ei];
      if (e.cls === 'hwy' || e.cls === 'ramp' || e.elev || e.tunnel || e.noTraffic) continue;
      for (const ni of [e.a, e.b]) {
        if (comp !== undefined && this.comp[ni] !== comp) continue;
        const n = city.nodes[ni], dd = (n.x - x) ** 2 + (n.z - z) ** 2;
        if (dd < bd) { bd = dd; best = ni; }
      }
    }
    return best;
  }

  /**
   * Put a unit on the road graph where it stands: the nearest drivable edge
   * at its height, driven the way it faces (a surface one-way either way, a
   * freeway or a ramp only with its flow). False off the graph.
   */
  snapRoute(v) {
    const city = this.city, f = v.forward;
    let best = -1, bs = Infinity, bsign = 1, bt = 0;
    for (const ei of city.edgesNear(v.x, v.z, 120)) {
      const e = city.edges[ei];
      if (e.noTraffic) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const t = clamp(((v.x - a.x) * e.dx + (v.z - a.z) * e.dz) / e.len, 0, 1);
      const qx = a.x + e.dx * e.len * t, qz = a.z + e.dz * e.len * t;
      const dd = Math.hypot(v.x - qx, v.z - qz);
      if (dd > Math.max(12, e.hw + 6)) continue;
      if (!e.tunnel && Math.abs(lerp(a.y, b.y, t) - v.y) > 4) continue;
      const dot = e.dx * f.x + e.dz * f.z;
      let sign = dot >= 0 ? 1 : -1;
      if ((e.cls === 'hwy' || e.cls === 'ramp') && !this.allowed(ei, sign)) sign = -sign;
      const sc = dd + (1 - Math.abs(dot)) * 6 + (dot * sign < 0 ? 8 : 0);
      if (sc < bs) { bs = sc; best = ei; bsign = sign; bt = t; }
    }
    if (best < 0) return false;
    v.edge = best; v.dirSign = bsign;
    v.laneU = this.flow[best] !== 0 ? this.nearestLaneU(best, bsign, 0) : 0.5;
    this.routeInit(v);
    return true;
  }

  /** pickNextEdge for a unit in pursuit: the next node of its A* path, or
   *  (off it) the exit heading most toward its target. */
  pursuitEdge(v, fromEi, fromSign, nodeId) {
    const city = this.city, node = city.nodes[nodeId];
    const P = v.path;
    if (P) {
      const i = P.indexOf(nodeId);
      if (i >= 0 && i + 1 < P.length) {
        const nn = P[i + 1];
        for (const ei of node.e) {
          const ne = city.edges[ei];
          if (ne.noTraffic) continue;
          if ((ne.a === nodeId ? ne.b : ne.a) === nn) return { ei, sign: ne.a === nodeId ? 1 : -1 };
        }
      }
      if (i < 0) v.repath = Math.min(v.repath, 0.3);   // off the path: plan again soon
    }
    const tx = v.pursuitTX - node.x, tz = v.pursuitTZ - node.z, tl = Math.hypot(tx, tz) || 1;
    let best = null, bs = -Infinity;
    for (const ei of node.e) {
      const ne = city.edges[ei];
      if (ne.noTraffic) continue;
      const sign = ne.a === nodeId ? 1 : -1;
      if ((ne.cls === 'hwy' || ne.cls === 'ramp') && !this.allowed(ei, sign)) continue;
      // (back the way it came only when everything else leads away: a unit
      // that had passed the target's corner drove on round the block)
      const sc = (ne.dx * sign * tx + ne.dz * sign * tz) / tl + (this.allowed(ei, sign) ? 0.2 : 0) - (ei === fromEi ? 0.9 : 0);
      if (sc > bs) { bs = sc; best = { ei, sign }; }
    }
    return best;
  }

  resolveCarCollisions(dt, player) {
    // SORT AND SWEEP along x: all-pairs was 12k tests a frame with the docks'
    // 158 vehicles, nearly all of them between things kilometres apart. A pair
    // is only looked at while their x ranges can overlap, and two vehicles
    // that are standing still (parked, or a settled apron one) never can
    // start to.
    const n = this.cars.length, all = this._colOrd || (this._colOrd = []);
    all.length = n;
    let rMax = 0;
    for (let k = 0; k < n; k++) { const v = this.cars[k]; all[k] = v; const r = bodyR(v); if (r > rMax) rMax = r; }
    all.sort(byX);
    const still = (v) => v !== player.vehicle && (v.mode === 'parked' || (v.mode === 'apron' && v._still >= 3));
    for (let i = 0; i < n; i++) {
      const a = all[i], sa = still(a), reach = a.x + bodyR(a) + rMax;
      for (let j = i + 1; j < n; j++) {
        const b = all[j];
        if (b.x > reach) break;
        if (sa && still(b)) continue;
        // The test is 2D, so gate on height or a plane at 200 m gets shunted
        // by the traffic it overflies -- the "invisible collision in the air".
        // Also stops a viaduct car trading paint with the street below it.
        if (Math.abs((a.y || 0) - (b.y || 0)) > 3) continue;
        // Two parked cars never move, so they cannot start overlapping.
        if (a.mode === 'parked' && b.mode === 'parked') continue;
        // an articulated bus's two sections are one vehicle
        if (a.leader === b || b.leader === a) continue;
        // a car flattened by a tank is driven over, not shunted (tank.js)
        if (a.crushed || b.crushed) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const rr = bodyR(a) + bodyR(b);
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        // THE BODIES, NOT CIRCLES: two oriented rectangles, separated along
        // the axis of least overlap. Circles of 0.42 x length (2 m for a
        // sedan) touched two cars abreast in 3.6 m lanes and shoved them
        // apart the whole way, which is why lanes used to be 4.2 m and a
        // 3-lane freeway carried 2.
        const hit = boxOverlap(a, b, dx, dz);
        if (!hit) continue;
        const nx = hit.nx, nz = hit.nz, pen = hit.pen;
        // a rear section is placed by its front, so it does not give way
        const ma = a.mode === 'trailer' ? 1e6 : a.mass, mb = b.mode === 'trailer' ? 1e6 : b.mass;
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
              this.game.onCrash(impact, b.mode === 'police' || a.mode === 'police', a === player.vehicle ? b : a);
            } else if (impact > 6 && this.game.onTrafficCrash) {
              this.game.onTrafficCrash(impact, (a.x + b.x) / 2, (a.z + b.z) / 2);
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
    // an articulated bus is driven from its front section
    return best && best.leader ? best.leader : best;
  }
}
