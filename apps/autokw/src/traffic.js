// Traffic, parked cars and the police response.

import * as THREE from './three.js';
import { Vehicle, TYPES, CIVILIAN_TYPES, randomCarColor, vehicleAssets, farLod, farLod2, nearLod, makeBellows, HITCH,
  LAMP_BRAKE, LAMP_L, LAMP_R, LAMP_REV, LAMP_LON, LAMP_RON, LAMP_STEP } from './vehicles.js';
import { clamp, lerp, angleWrap, hash2, rng, dist2, tierScale } from './util.js';
import * as G from './geo.js';
import { WXK } from './weather.js';
import { TODK } from './tod.js';
import { memo } from './bootcache.js';
import { edgeFlow, oneWaySpan, twoWayLayout, twoWayLaneOff, alBike, medianGaps, LANE_W } from './arterial.js';
import { SchoolStops, schoolStopsOn } from './schoolbus.js';
import { sceneryType } from './kwdriveway.js';

const TRAFFIC_TARGET = 26;
// Parked cars only exist within this radius, and each is 3 draw calls, so this
// is a draw-call dial as much as a distance one.
const PARKED_RADIUS = 105;
const LOT_TYPES = new Set(['sedan', 'suv', 'pickup', 'compact', 'hatch', 'ev', 'muscle', 'sports', 'convertible',
  'crossover', 'compsedan', 'minivan', 'wagon', 'pickupcap', 'suv3', 'jeep', 'evy', 'civic', 'dually']);
const DESPAWN = 520;
// The Belltown Hellcat (vehicles.js `hellcat`): the chance a Belltown spawn is
// one, and how many may be about at once.
const HELLCAT_P = 0.12, HELLCAT_MAX = 3;
// The Wienermobile (vehicles.js `wiener`): the chance any car-sized spawn
// anywhere is it, and never more than one about. Rare on purpose: driving
// spawned a car every ~110 m, so this is about one per 10 km driven. It goes
// when it is left behind, as every car does.
const WIENER_P = 0.01;
const HEAVY = new Set(['bus', 'busx', 'ionbus', 'artic', 'schoolbus', 'boxtruck', 'garbage', 'recycling', 'pickup', 'pickupcap', 'van', 'postvan', 'purovan', 'cruiser', 'sportbike', 'bicycle',
  'dually', 'jeep', 'uhaul', 'semi', 'opp']);
// Auto KW: types that never park at a kerb and keep off residential streets
// (every bus -- `spec.bus` -- the refuse and recycling trucks, the semi)
const NO_KERB = (tn) => !!(TYPES[tn] && TYPES[tn].bus) || tn === 'garbage' || tn === 'recycling' || tn === 'semi';
// Auto KW: the 401 and Hwy 8 / the Expressway: a share of every spawn on a
// highway edge is a semi (a 53 ft van behind a sleeper tractor), a few are the
// OPP (an Interceptor Utility, its light bar dark). Never off the highways --
// though, like everyone, they may take an exit. Hashes, not this.R, so the
// spawn stream after them is unchanged.
const HWY_SEMI_P = 0.16, HWY_OPP_P = 0.03, OPP_MAX = 2;
// Auto KW: what never drives a freeway or its ramps (spawned there it becomes
// a sedan; routing, it keeps off them while it has any other way on).
const FWY_BANNED = new Set(['bicycle', 'schoolbus', 'garbage', 'recycling']);
// FREEWAY DRIVING (see "Freeway driving" in apps/autokw/CLAUDE.md): the share
// of drivers who take a given exit, how far ahead it is decided, the lane
// change's lateral speed, and MOBIL's thresholds -- the gain a pass must buy,
// the loss keeping right may cost, and the hardest braking a change may ask of
// the car it cuts in front of (or of itself behind the new leader).
const XO_LATE = 90;   // m before an exit-only lane leaves: too late to move out of it
const EXIT_P = 0.3, EXIT_PLAN = [260, 1300], LC_TIME = 3.2, LC_GAIN = 0.25, LC_KEEP = 0.15, LC_SAFE = -2.5;
const SEMI_V = 29.0;   // a semi's speed limiter: 105 km/h
// Auto KW, LANE CHOICE IN TOWN (cityLaneDecide; CLAUDE.md "Lane choice and
// left-turn bays"): how far ahead a driver looks for the next turn (m), how
// long it signals before it moves over (s), how often it thinks about it
// (s), how late a turn is given up -- LC_LATE0 + LC_LATE_T x speed m short
// of the junction, still not in its lane -- the share of drivers who ease
// off to let a signalling car in, and the gap a slip lane's merge needs (s).
const LC_PLAN = 160, LC_SIG = 1.0, LC_TICK = 0.4, LC_LATE0 = 12, LC_LATE_T = 1.8, COURTESY_P = 0.7, SLIP_GAP = 3.0;
// A phone is draw-call bound, and the fleet was over half of it: an iPhone 17
// Pro driving downtown showed 58 vehicles (3 draws each, plus shadows) and 9.6
// ms of render submission. Parked cars are only drawn this close on a phone,
// and traffic only casts a shadow this close -- past it a car's shadow is a
// few pixels and three more draws in the shadow pass.
const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
// AUTO KW (v82): a parked car is shown as long as it exists (it is spawned
// at PARKED_RADIUS and kept to PARKED_RADIUS + 60). A phone hid them past
// 80 m -- but past FAR_LOD a phone draws them instanced anyway, so hiding
// saved nothing there, and every kerb's cars appeared at 80 m as you drove up
// and vanished at 80 m behind you.
const PARKED_SHOW = PARKED_RADIUS + 60;
// ...and PAST the parked cars, the same kerb slots and car-park bays are
// scenery out to PARK_DECOR_R (traffic.decor through kwdriveway.js: the far
// LOD's instances, solid to the player, no draws of their own) -- each the
// car that will be spawned there, same type, colour and heading, so the
// swap at PARKED_RADIUS changes nothing on screen. Before, kerbside cars came
// into being at 105 m in plain view and a car park held only its six nearest.
const PARK_DECOR_R = ON_PHONE ? 200 : 280;
// AUTO KW (v82): traffic spawned in the camera's view closer than this is
// thrown away (it appeared from nothing at 190 m, the old forward-cone rule's
// edge, in plain sight on a phone's wide view)
const SPAWN_SEEN = 300, SPAWN_FAR = 420;
const LOT_TILE = 100;   // m: lotBays' cache square
const SHADOW_NEAR = ON_PHONE ? 45 : Infinity;
// Past this, a phone draws a vehicle through its type's InstancedMesh over the
// far LOD (vehicles.js farLod): one draw per type on screen instead of three
// per car. Beyond SHADOW_NEAR, so nothing that casts is ever instanced.
const FAR_LOD = ON_PHONE ? 60 : Infinity;
// Auto KW: the scenery cars (traffic.decor: the driveways', the drive-through
// lines') this close to the camera, the nearest DECOR_CAP of them, are drawn
// with their type's detailed model (vehicles.js nearLod: one instanced draw
// per type in view, casting the sun's shadow as a traffic car this close
// does); the rest through the far LOD as before. Inside SHADOW_NEAR.
const DECOR_NEAR = ON_PHONE ? 40 : 55;
// Auto KW (v86): past FAR2 of the camera a far-LOD car (traffic or scenery)
// is drawn in its type's far-far LOD (vehicles.js farLod2: ~a third of the
// triangles), from a pool keyed `type|2` in farMeshes
const FAR2 = ON_PHONE ? 110 : 150;
const DECOR_CAP = ON_PHONE ? 10 : 18;
// VEHICLE LAMPS (updateLamps): lit out to LAMP_RANGE m; a blinker's period (s,
// half of it lit: ~86 flashes a minute); the stop lamps held BRAKE_HOLD s
// after the pedal; a signal judged every LAMP_TICK frames and held SIG_HOLD s
// after its reason ends (through the rest of the corner); a turn signalled
// SIG_D0 + SIG_DT x speed m before it, a freeway exit EXIT_SIG m before the
// diverge; hazards HAZ_HOLD s after the car is wedged or stopped by a hit.
const LAMP_RANGE = 260, BLINK = 0.7, BRAKE_HOLD = 0.3, LAMP_TICK = 4, SIG_HOLD = 1.2;
const SIG_D0 = 40, SIG_DT = 2.5, EXIT_SIG = 220, HAZ_HOLD = 5;

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

// --- crashes: an impulse at the contact point ----------------------------------
//
// Every hit -- car on car, car on wall -- is resolved as two rigid bodies in
// the plane: a contact point and normal, an impulse J along the normal (with
// restitution) plus friction along the face (bounded by mu J), applied to both
// bodies' velocity, longitudinal AND lateral, and to their yaw through the
// lever arm, (r x J) / I. It replaced a rule that only ever changed vLong
// projected on each car's own heading, which is why nothing spun and a T-bone
// was a brick wall: measured on v199, a sedan into a stationary one side-on at
// 20 m/s stopped dead, moved it 0.6 m and turned neither car at all.
//
// The yaw goes into Vehicle.spin (decaying, on top of the steering's yaw) and a
// hard hit lets the tyres go for a moment (Vehicle.slide), so the car that was
// hit skids and spins instead of stopping in its own length.
//
// Restitution and friction, car-car / wall / street object (a mast shears and
// a trunk gives).
const CRASH_E = 0.2, CRASH_MU = 0.5, WALL_E = 0.15, WALL_MU = 0.3, OB_E = 0.1, OB_MU = 0.3;
// THE CENTRE OF MASS IS AHEAD OF THE MIDDLE: the engine is in the front.
// It is also what spins a car hit squarely in the side -- through the middle
// of the box it would only slide -- and what a real T-bone does.
const CG_FWD = 0.06;
// No hit spins anything faster than this (rad/s); the tyres let go fully
// once the hit moves an end sideways by SLIDE_FROM + SLIDE_SPAN m/s.
const SPIN_MAX = 5, SLIDE_FROM = 2, SLIDE_SPAN = 6;
/** Can a hit turn this body? Not an aircraft, a hull, a tank on its tracks, a
 *  train, an articulated rear (placed by its front), a hulk or a flattened car. */
function canSpin(v) {
  const s = v.spec;
  return !(s.plane || s.boat || s.tank || s.rail || s.balloon) && !v.afloat
    && v.mode !== 'trailer' && !v.wreck && !v.crushed && !v.stunt;
}
const _cp = { x: 0, z: 0 };
/** Where body v touches a wall whose outward normal is (nx, nz): its corner
 *  furthest into the wall, or the middle of the face when two tie. */
function supportPoint(v, nx, nz) {
  const f = v.forward, hl = v.halfLen, hw = v.halfWid;
  const a = (f.x * nx + f.z * nz) * hl, b = (f.z * nx - f.x * nz) * hw;
  // depth of a corner (sl, sw) = -(sl a + sw b); pick the deepest signs, and
  // take the middle of the face where one axis hardly matters
  const sl = Math.abs(a) < 0.15 ? 0 : -Math.sign(a), sw = Math.abs(b) < 0.15 ? 0 : -Math.sign(b);
  _cp.x = v.x + f.x * hl * sl + f.z * hw * sw;
  _cp.z = v.z + f.z * hl * sl - f.x * hw * sw;
  return _cp;
}
/** Give v the impulse (Jx, Jz) at lever arm (rx, rz) from its centre of mass;
 *  im / ii its inverse mass and inverse moment of inertia (0: does not turn). */
function kick(v, Jx, Jz, rx, rz, im, ii) {
  const f = v.forward, dvx = Jx * im, dvz = Jz * im;
  const dLong = dvx * f.x + dvz * f.z, dLat = dvx * f.z - dvz * f.x;
  v.vLong += dLong;
  v.vLat += dLat;
  if (!ii) return;
  const dw = (rz * Jx - rx * Jz) * ii;
  v.spin = clamp(v.spin + dw, -SPIN_MAX, SPIN_MAX);
  v.yawRate += dw;
  // how hard the hit threw an end sideways: that is what breaks the tyres loose
  const side = Math.abs(dLat) + Math.abs(dw) * v.halfLen;
  v.slide = Math.max(v.slide, clamp((side - SLIDE_FROM) / SLIDE_SPAN, 0, 1));
}
// A TOUCH IS NOT A SPIN, AND A SCRAPE IS NOT A CRASH. Closing under
// TOUCH_FROM m/s (a car leaning on a wall as its lane bends, a queue nudging
// up) only stops the closing: no yaw, no friction, which fade in up to
// TOUCH_FROM + TOUCH_SPAN. Without the first every AI car brushing I-5's
// walls was turned a little each frame and steered back (aidrive's weave
// there 4 -> 11 reversals a car-minute); without the second a bus whose
// 3.5 m obstacle circle brushed a post on East Pike, steering back into it
// every frame, lost ~10 m/s^2 to the friction and wedged, a queue behind it.
const TOUCH_FROM = 1, TOUCH_SPAN = 3;
// TWO AI DRIVERS TOUCHING is not a crash until 4 m/s. Their low-speed
// contacts are the yielding's imperfections, mostly at junctions, and under
// the 1 m/s threshold every such bump spun both: on 1st Ave S a sedan left
// across both lanes held eight cars in a slow knot for a minute (trafficcheck
// stuck 4 -> 7). You, a police unit, a suspect or a shunted car: TOUCH_FROM.
const AI_TOUCH = 4, AI_TOUCH_SPAN = 6;
const touch = (closing) => clamp((closing - TOUCH_FROM) / TOUCH_SPAN, 0, 1);
const invI = (v) => (canSpin(v) ? 12 / (v.mass * 4 * (v.halfLen * v.halfLen + v.halfWid * v.halfWid)) : 0);
/**
 * The impulse between bodies a and b touching at (cx, cz), the normal
 * (nx, nz) pointing from a to b; ma / mb their masses. Returns the closing
 * speed at the contact (0 if they are already parting), the crash's size.
 */
function pairImpulse(a, b, nx, nz, cx, cz, ma, mb) {
  const fa = a.forward, fb = b.forward;
  const ga = CG_FWD * 2 * a.halfLen, gb = CG_FWD * 2 * b.halfLen;
  const rax = cx - a.x - fa.x * ga, raz = cz - a.z - fa.z * ga;
  const rbx = cx - b.x - fb.x * gb, rbz = cz - b.z - fb.z * gb;
  const ia0 = invI(a), ib0 = invI(b), oa = ia0 ? a.yawRate : 0, ob = ib0 ? b.yawRate : 0;
  // each body's velocity at the contact: v + w x r, with w x r = w (rz, -rx)
  const vax = fa.x * a.vLong + fa.z * a.vLat + oa * raz, vaz = fa.z * a.vLong - fa.x * a.vLat - oa * rax;
  const vbx = fb.x * b.vLong + fb.z * b.vLat + ob * rbz, vbz = fb.z * b.vLong - fb.x * b.vLat - ob * rbx;
  const rvx = vbx - vax, rvz = vbz - vaz, vn = rvx * nx + rvz * nz;
  if (vn >= 0) return 0;
  // (two AI drivers' own scrape -- at a junction, nosing into a gap -- is a
  // touch up to 4 m/s and spins in full only from 10: see AI_TOUCH)
  const k = a.mode === 'traffic' && b.mode === 'traffic' ? clamp((-vn - AI_TOUCH) / AI_TOUCH_SPAN, 0, 1) : touch(-vn);
  const ia = ia0 * k, ib = ib0 * k;
  const ima = 1 / ma, imb = 1 / mb;
  const pan = raz * nx - rax * nz, pbn = rbz * nx - rbx * nz;
  const j = -(1 + CRASH_E) * vn / (ima + imb + pan * pan * ia + pbn * pbn * ib);
  const tx = -nz, tz = nx, vt = rvx * tx + rvz * tz;
  const pat = raz * tx - rax * tz, pbt = rbz * tx - rbx * tz;
  const jm = CRASH_MU * k * j;
  const jt = clamp(-vt / (ima + imb + pat * pat * ia + pbt * pbt * ib), -jm, jm);
  const Jx = j * nx + jt * tx, Jz = j * nz + jt * tz;
  if (a.mode !== 'trailer') kick(a, -Jx, -Jz, rax, raz, ima, ia);
  if (b.mode !== 'trailer') kick(b, Jx, Jz, rbx, rbz, imb, ib);
  return -vn;
}
/** The same against something that does not move (a wall, a post): (nx, nz)
 *  points out of it at the body. Returns the closing speed, 0 if parting.
 *  `linear` false: the turn only (a street object keeps its own speed rule). */
function wallImpulse(v, nx, nz, e, mu, linear = true) {
  const f = v.forward, g = CG_FWD * 2 * v.halfLen;
  const c = supportPoint(v, nx, nz);
  v.hitX = c.x; v.hitZ = c.z;   // (your car's crumple goes here: Vehicle.dent)
  const rx = c.x - v.x - f.x * g, rz = c.z - v.z - f.z * g;
  const ii0 = invI(v), w = ii0 ? v.yawRate : 0;
  const vx = f.x * v.vLong + f.z * v.vLat + w * rz, vz = f.z * v.vLong - f.x * v.vLat - w * rx;
  const vn = vx * nx + vz * nz;
  if (vn >= 0) return 0;
  const k = touch(-vn), ii = ii0 * k;
  const im = 1 / v.mass;
  const pn = rz * nx - rx * nz;
  const j = -(1 + e) * vn / (im + pn * pn * ii);
  const tx = -nz, tz = nx, vt = vx * tx + vz * tz, pt = rz * tx - rx * tz;
  const jt = clamp(-vt / (im + pt * pt * ii), -mu * k * j, mu * k * j);
  kick(v, j * nx + jt * tx, j * nz + jt * tz, rx, rz, linear ? im : 0, ii);
  return -vn;
}

const _rail = { nx: 0, nz: 0, pen: 0 };
/** The deepest corner of v's body past the traffic face of a deck parapet at
 *  its height: the push-out normal and depth, or null. Only a body whose
 *  middle is still on the deck side: past the rail it is off the deck. */
function deckRailHit(v, city) {
  const f = v.forward, hl = v.halfLen, hw = v.halfWid, reach = v.bodyR + 1;
  let best = 0;
  for (const ei of city.edgesNear(v.x, v.z, reach)) {
    const e = city.edges[ei];
    if (!e.elev || e.tunnel) continue;
    const S = city.deckRails(ei);
    for (let i = 0; i < S.length; i += 7) {
      const ax = S[i], az = S[i + 1], sx = S[i + 2] - ax, sz = S[i + 3] - az;
      const L = Math.hypot(sx, sz);
      if (L < 1e-3) continue;
      const ux = sx / L, uz = sz / L, sg = S[i + 6];
      const ox = -e.dz * sg, oz = e.dx * sg;   // outward, off the deck
      const rx = v.x - ax, rz = v.z - az;
      const cd = rx * ox + rz * oz, ca = rx * ux + rz * uz;
      if (cd > 0.3 || cd < -reach || ca < -reach || ca > L + reach) continue;
      // at the deck's height there: the band a car on it stands in
      const y = S[i + 4] + (S[i + 5] - S[i + 4]) * clamp(ca / L, 0, 1);
      if (v.y < y - 1 || v.y > y + 1.6) continue;
      for (let c = 0; c < 4; c++) {
        const sl = c & 1 ? 1 : -1, sw = c & 2 ? 1 : -1;
        const qx = rx + f.x * hl * sl + f.z * hw * sw, qz = rz + f.z * hl * sl - f.x * hw * sw;
        const along = qx * ux + qz * uz;
        if (along < -0.3 || along > L + 0.3) continue;
        const d = qx * ox + qz * oz;
        if (d > best) { best = d; _rail.nx = -ox; _rail.nz = -oz; }
      }
    }
  }
  if (best <= 0) return null;
  _rail.pen = best;
  return _rail;
}

// Buses, trucks, fire rigs, the tank: a body this long (half-length, m) meets
// buildings as a rectangle; shorter cars keep the grown-circle test, which
// their routine contacts (and tools/trafficcheck's numbers) are tuned to.
const LONG_BODY = 4, BODY_SKIN = 0.25;
const _body = { fx: 0, fz: 1, hl: 0, hw: 0 };

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
  } else if (v.halfLen > LONG_BODY) {
    // a long body meets posts and trunks as its rectangle (citygen obstacleHit)
    _body.fx = v.forward.x; _body.fz = v.forward.z; _body.hl = v.halfLen + BODY_SKIN; _body.hw = v.halfWid + BODY_SKIN;
    ob = city.obstacleHit(v.x, v.z, v.radius * 0.7, v.y, ai, _body);
  } else ob = city.obstacleHit(v.x, v.z, v.radius * 0.7, v.y, ai);
  if (ob) {
    v.x += ob.nx * ob.pen;
    v.z += ob.nz * ob.pen;
    // A STREET OBJECT KEEPS ITS OWN SPEED RULE: the hit's spin from the
    // impulse (wallImpulse, `linear` off), and the speed by the angle as
    // before. The obstacle test is a circle of 0.7 x radius -- 3.5 m for a
    // bus, which is 1.3 m half-wide -- so it touches posts the body is well
    // clear of, and a hit that only steers the body round a post is what
    // lets a long vehicle get past one. With the full impulse a bus on East
    // Pike met a post square on its circle, stopped, and nosed into it for
    // good with a queue behind it.
    const f = v.forward;
    const along = f.x * ob.nx + f.z * ob.nz;
    const impact = Math.abs(v.vLong) * Math.abs(along) * 0.7 + Math.abs(v.vLat) * 0.3;
    wallImpulse(v, ob.nx, ob.nz, OB_E, OB_MU, false);
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
  // A DECK'S PARAPET (world.js deckRailSegs): solid where it is drawn -- for
  // you, a car nobody drives, a suspect, and any car still sliding from a hit.
  // A traffic or police driver in its lane is left as it was (its routine
  // contacts are not changed; see the buildings below).
  if (city.deckRails && (!ai || v.slide > 0 || (v.mode !== 'traffic' && v.mode !== 'police'))) {
    const rh = deckRailHit(v, city);
    if (rh) {
      v.x += rh.nx * rh.pen;
      v.z += rh.nz * rh.pen;
      const impact = wallImpulse(v, rh.nx, rh.nz, WALL_E, WALL_MU);
      if (onHit && impact > 3) onHit(impact);
      return Math.max(impact, 0.01);
    }
  }
  const near = city.buildingsNear(v.x, v.z, 14);
  for (const b of near) {
    const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
    const dx = v.x - b.x, dz = v.z - b.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    // the storey at this height: above a setback the tower is narrower, and a
    // helicopter on the ledge is not inside it (util tierScale)
    const k = b.h > 55 ? tierScale(b, v.y) : 1, hw = b.w * k / 2, hd = b.d * k / 2;
    let ex, ez;
    if (v.halfLen > LONG_BODY) {
      // A LONG BODY IS A RECTANGLE, NOT A CIRCLE. The circle grown by 0.8 x
      // radius is 4 m for a 12 m bus that is 1.3 m half-wide: it met walls
      // 2.7 m clear of its side (a bus westbound on East Pike at (1265,-308)
      // stopped dead from 17 m/s against a building it never touched, and
      // never got past) while its nose could sink 2 m into a wall ahead. The
      // body's half-extents along the building's axes, then a separating-axis
      // check on the body's own axes for a body turned across the corner.
      const f = v.forward, fx = f.x * c - f.z * s, fz = f.x * s + f.z * c;
      const ax = Math.abs(fx), az = Math.abs(fz);
      ex = hw + ax * v.halfLen + az * v.halfWid + BODY_SKIN;
      ez = hd + az * v.halfLen + ax * v.halfWid + BODY_SKIN;
      if (Math.abs(lx) > ex || Math.abs(lz) > ez) continue;
      if (Math.abs(lx * fx + lz * fz) > hw * ax + hd * az + v.halfLen + BODY_SKIN) continue;
      if (Math.abs(lx * fz - lz * fx) > hw * az + hd * ax + v.halfWid + BODY_SKIN) continue;
    } else {
      ex = hw + v.radius * 0.8; ez = hd + v.radius * 0.8;
      if (Math.abs(lx) > ex || Math.abs(lz) > ez) continue;
    }
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
    // A wall takes the speed into it at the corner that hit, and turns the
    // car about that corner: a glancing hit deflects along the wall instead
    // of stopping dead (it kept 28 % of vLong and 20 % of vLat, whatever the
    // angle -- 20 m/s at 30 deg came off 0 m/s, held against the wall).
    //
    // AN AI DRIVER'S ROUTINE CONTACT KEEPS THE OLD RULE; the impulse is for
    // you, and for a car still sliding from a hit. The test is the centre
    // against the footprint grown by 0.8 x radius -- 4 m for a bus -- so a
    // bus turning at a corner building "hits" it with a body that is 1.3 m
    // half-wide. Under the impulse that was a crash: measured, a bus on East
    // Pike stopped dead from 17.7 m/s at the corner of its turn, nosed back
    // into it every few seconds, and the queue behind it counted as stuck in
    // tools/trafficcheck. The old rule's leftover speed is what scraped it round.
    if (ai && !(v.slide > 0)) {
      const f = v.forward;
      const along = f.x * wx + f.z * wz;
      const impact = Math.abs(v.vLong) * Math.abs(along) + Math.abs(v.vLat) * 0.4;
      v.vLong *= along > 0 ? -0.18 : 0.28;
      v.vLat *= 0.2;
      return impact;
    }
    const impact = wallImpulse(v, wx, wz, WALL_E, WALL_MU);
    if (onHit && impact > 3) onHit(impact);
    return Math.max(impact, 0.01);
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
// (edgeFlow is arterial.js's: world.js paints the lanes from the same answer)

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

/**
 * NO EXIT. Per directed edge (ei * 2 + (driven a -> b ? 1 : 0)): 0, or -- when
 * every way on from its end, and from theirs, comes back to a dead end where
 * the only move is to turn round -- the longest drive (m) from its start to
 * that turn. A cul-de-sac, a court, a street that stops at the railway, or one
 * whose only legal way on is into such a stub (Union St E northbound at
 * Willow St, closed beyond for its rebuild: the one-way Willow comes in, it
 * does not go out). Found by propagating back from the dead ends: a directed
 * edge is a trap once every legal exit from its end node (other than back
 * along itself) is one. A driver with no business there does not turn into
 * one just to turn round at its end (pickNextEdge), and none is spawned
 * heading into one: they met each other U-turning at the end, nose to nose,
 * wedged and backed out (Linwood Ave off Braun St: 41 bumps in 10 minutes of
 * traffic round it; the stub at Union St E and Willow St).
 */
function noExitTraps(city, flow) {
  const E = city.edges, M = E.length * 2;
  const ok = (ei, f) => { const e = E[ei]; return !e.noTraffic && e.a !== e.b && (flow[ei] === 0 || flow[ei] === (f ? 1 : -1)); };
  const end = (s) => (s & 1 ? E[s >> 1].b : E[s >> 1].a);
  const exits = new Int32Array(M), far = new Float32Array(M), trap = new Float32Array(M);
  const q = [];
  for (let s = 0; s < M; s++) {
    if (!ok(s >> 1, s & 1)) continue;
    let k = 0;
    for (const ei of city.nodes[end(s)].e) {
      if (ei === s >> 1) continue;
      const e = E[ei], f = e.a === end(s) ? 1 : 0;
      if (ok(ei, f)) k++;
    }
    exits[s] = k;
    if (!k) { trap[s] = E[s >> 1].len; q.push(s); }
  }
  while (q.length) {
    const t = q.pop(), ti = t >> 1, te = E[ti];
    // the edges arriving where t starts: t was one of their ways on
    const st = t & 1 ? te.a : te.b;
    for (const ei of city.nodes[st].e) {
      if (ei === ti) continue;
      const e = E[ei], f = e.b === st ? 1 : 0, p = ei * 2 + f;
      if (!ok(ei, f) || trap[p] > 0) continue;
      if (trap[t] > far[p]) far[p] = trap[t];
      if (--exits[p] === 0) { trap[p] = e.len + far[p]; q.push(p); }
    }
  }
  return trap;
}
// a no-exit street at most this long is not turned into (traffic.pickNextEdge)
const CUL_MAX = 350;

// Spawns only go on components at least this big: a few-node loop is a car
// circling one block forever.
const MIN_COMPONENT = 60;
// Lanes on a one-way street are 3.6 m, a real lane. (They were 4.2 m while
// resolveCarCollisions tested circles of 0.42 x length, 2.0 m for a sedan,
// which touched across 3.6 m; it tests the bodies' rectangles now.) A one-way
// street with parking keeps 2.2 m clear at each kerb for the parked cars
// (they sit at hw - 1.15, see updateParked); anything else keeps a 0.8 m
// shoulder.
// (LANE_W, PARK_EDGE, SHOULDER: arterial.js)

/** ord[0..n) (indices) sorted by K[index] ascending, STABLE (equal keys keep
 *  their order): runs of 16 by insertion, then merged; tmp is scratch. */
function sortByKey(ord, tmp, K, n) {
  const RUN = 16;
  for (let lo = 0; lo < n; lo += RUN) {
    const hi = Math.min(lo + RUN, n);
    for (let i = lo + 1; i < hi; i++) {
      const x = ord[i], kx = K[x];
      let j = i - 1;
      while (j >= lo && K[ord[j]] > kx) { ord[j + 1] = ord[j]; j--; }
      ord[j + 1] = x;
    }
  }
  let src = ord, dst = tmp;
  for (let w = RUN; w < n; w *= 2) {
    for (let lo = 0; lo < n; lo += 2 * w) {
      const mid = Math.min(lo + w, n), hi = Math.min(lo + 2 * w, n);
      let i = lo, j = mid, k = lo;
      while (i < mid && j < hi) dst[k++] = K[src[j]] < K[src[i]] ? src[j++] : src[i++];
      while (i < mid) dst[k++] = src[i++];
      while (j < hi) dst[k++] = src[j++];
    }
    const t = src; src = dst; dst = t;
  }
  if (src !== ord) ord.set(src.subarray(0, n));
}

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
// (the route's fields schoolbus.js reads)
const SB_R = { EI: R_EI, SG: R_SG, LEN: R_LEN, F: RT_F };
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
const _hit = { nx: 0, nz: 0, pen: 0, refA: true };
// nobody at the wheel (traffic.update): read-only inputs, not one per car a frame
const COAST_IN = { throttle: 0, brake: 0.12, steer: 0 };
const PARK_IN = { throttle: 0, brake: 0, steer: 0, park: true };
/** Overlap of a's and b's footprints (d = b - a): the separating normal from
 *  a to b and the depth along it, or null. 2D SAT on the four body axes. */
function boxOverlap(a, b, dx, dz) {
  const fa = a.forward, fb = b.forward;
  const ax = [fa.x, fa.z, fa.z, -fa.x, fb.x, fb.z, fb.z, -fb.x];
  let best = Infinity, bx = 0, bz = 0, ref = true;
  for (let k = 0; k < 8; k += 2) {
    const ux = ax[k], uz = ax[k + 1];
    const ra = a.halfLen * Math.abs(fa.x * ux + fa.z * uz) + a.halfWid * Math.abs(fa.z * ux - fa.x * uz);
    const rb = b.halfLen * Math.abs(fb.x * ux + fb.z * uz) + b.halfWid * Math.abs(fb.z * ux - fb.x * uz);
    const dd = dx * ux + dz * uz;
    const o = ra + rb - Math.abs(dd);
    if (o <= 0) return null;
    if (o < best) { best = o; bx = dd < 0 ? -ux : ux; bz = dd < 0 ? -uz : uz; ref = k < 4; }
  }
  _hit.nx = bx; _hit.nz = bz; _hit.pen = best; _hit.refA = ref;
  return _hit;
}
/**
 * Where a and b touch, given boxOverlap's normal (a to b) and whose face it is
 * (refA): the other body's face most against that normal, clipped to the
 * reference face's extent and to the part of it that is inside, and the
 * middle of what is left. So a square T-bone touches mid-door, an offset
 * rear-end at the middle of the bumpers' overlap, and a corner on a corner.
 */
// pairContact's clip range [l0, l1] on the incident edge, and the clip that
// keeps p0 + dp l >= lo (module level: it ran per colliding pair per frame)
const _lr = new Float64Array(2);
function clipL(p0, dp, lo) {
  if (Math.abs(dp) < 1e-9) { if (p0 < lo) { _lr[0] = 1; _lr[1] = 0; } return; }
  const l = (lo - p0) / dp;
  if (dp > 0) { if (l > _lr[0]) _lr[0] = l; } else if (l < _lr[1]) _lr[1] = l;
}
function pairContact(a, b, nx, nz, refA) {
  const R = refA ? a : b, I = refA ? b : a;
  const sx = refA ? nx : -nx, sz = refA ? nz : -nz;   // out of R's face, into I
  const fr = R.forward;
  const onLong = Math.abs(fr.x * sx + fr.z * sz) > 0.7;
  const hN = onLong ? R.halfLen : R.halfWid, hT = onLong ? R.halfWid : R.halfLen;
  const tx = -sz, tz = sx;
  const fi = I.forward, dl = fi.x * sx + fi.z * sz, dw = fi.z * sx - fi.x * sz;
  let cx, cz, ex, ez;
  if (Math.abs(dl) >= Math.abs(dw)) {
    const g = -Math.sign(dl) * I.halfLen;
    cx = I.x + fi.x * g; cz = I.z + fi.z * g; ex = fi.z * I.halfWid; ez = -fi.x * I.halfWid;
  } else {
    const g = -Math.sign(dw) * I.halfWid;
    cx = I.x + fi.z * g; cz = I.z - fi.x * g; ex = fi.x * I.halfLen; ez = fi.z * I.halfLen;
  }
  // the incident edge p(l) = c + e (2l - 1), l in 0..1: across R's face (u)
  // and how deep past it (d)
  const qx = cx - ex - R.x, qz = cz - ez - R.z;
  const u0 = qx * tx + qz * tz, du = 2 * (ex * tx + ez * tz);
  const d0 = hN - (qx * sx + qz * sz), dd = -2 * (ex * sx + ez * sz);
  _lr[0] = 0; _lr[1] = 1;
  clipL(u0, du, -hT); clipL(-u0, -du, -hT); clipL(d0, dd, 0);
  const l = _lr[0] <= _lr[1] ? (_lr[0] + _lr[1]) / 2 : (d0 + dd > d0 ? 1 : 0);
  _cp.x = cx + ex * (2 * l - 1); _cp.z = cz + ez * (2 * l - 1);
  return _cp;
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
    // the vehicles in `cars` towing something (spawnAt sets v.trailer, remove
    // clears it): update's follow pass walks these, not all ~220
    this._rigs = [];
    this.farMeshes = new Map();
    // Cars that are only scenery (drivethru.js's queues): { type, x, y, z, h, col: THREE.Color },
    // drawn through the far LOD's InstancedMeshes, near or far, on a phone or not -- a slot each,
    // no draws of their own. Not vehicles: nothing here drives, hits or hashes them.
    this.decor = [];
    // ...and the nearest of them through their type's detailed model (sceneryTypes, updateFarLod)
    this.nearMeshes = new Map();
    this._near = [];
    // Every type's far LOD up front, on the loading screen: built on first use
    // it was a one-off 2-4 ms stall (40+ ms on a phone) the first time each
    // type drove past 60 m.
    if (FAR_LOD !== Infinity) for (const k of Object.keys(vehicleAssets().types)) { farLod(k); farLod2(k); }
    this._farM = new THREE.Matrix4();
    this._farFr = new THREE.Frustum();
    this._farS = new THREE.Sphere();
    this._tick = 0;
    this.parkedSlots = new Set();
    this.parkDecorR = PARK_DECOR_R;   // kwdriveway.js reads it (parkedScenery)
    // kerb slots given to something else for good (main.js: the car by the spawn)
    this.reservedSlots = new Set();
    // ground kept free of lot parking for good: [x, z, r] (tank.js: the tank's apron)
    this.keepClear = [];
    this.R = rng(99);
    this.police = null;   // police.js, set by main.js
    this.suspectDriver = null;   // policemissions.js drives mode 'suspect'
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
    // (~17 ms on the desktop: kept by the boot cache too)
    this.cul = memo('traffic:noexit', () => noExitTraps(city, this.flow),
      (v) => v instanceof Float32Array && v.length === E.length * 2);
    // Lane span per one-way edge, lazily: [lo, hi, lanes] in the edge's own
    // perpendicular (+ = the side to the right of a->b). NaN = not computed.
    this.lanes = new Float32Array(E.length * 3).fill(NaN);
    // Counters for tools/trafficcheck.mjs: dead ends a car still reached, and
    // turns that had to fall back past the normal choice.
    // where people are crossing a carriageway (peds.js writes these each frame)
    this.crossN = 0;
    this.crossXZ = null;
    this.stats = { deadEnd: 0, deadEndDespawn: 0, fallbackTurn: 0, stuckRecycled: 0, yielded: 0,
      laneChanges: 0, laneLeft: 0, laneRight: 0, laneMandatory: 0, mergeYields: 0, exitsPlanned: 0, exitsTaken: 0, exitsAborted: 0, fwySpawnBlocked: 0,
      // Auto KW junction controls (junctions.js): seconds held at a red, a
      // permissive left yielding, a roundabout entry yielding, a stop sign's
      // queue; full stops made at stop signs
      sigHolds: 0, leftYields: 0, rbYields: 0, stopWaits: 0, fullStops: 0 };
    // the junction controls: signals, stop signs, roundabouts (junctions.js)
    this.jc = city.jc || null;
    // Auto KW: the freeway edges -- every 'hwy' carriageway and every ramp
    // reachable from one through ramps (OSM's *_link is also a town's slip lane)
    this.fwy = new Uint8Array(E.length);
    {
      const q = [], seen = new Uint8Array(city.nodes.length);
      for (let i = 0; i < E.length; i++) if (E[i].cls === 'hwy') { this.fwy[i] = 1; q.push(E[i].a, E[i].b); }
      while (q.length) {
        const ni = q.pop();
        if (seen[ni]) continue;
        seen[ni] = 1;
        for (const k of city.nodes[ni].e) if (E[k].cls === 'ramp' && !this.fwy[k]) { this.fwy[k] = 1; q.push(E[k].a, E[k].b); }
      }
    }
    this.sirenFrom = null;   // your police car, siren on (main.js): traffic ahead yields to it
    this._P = { x: 0, z: 0 };
    this._ps = new Float64Array(24);   // driveTraffic's path samples
    this._pseg = new Float64Array(36); // ...and its segments: dx, dz, length
    this._prio = 0;
    // Auto KW: school buses stopping for children (schoolbus.js); `_sbOn` is
    // read once an update (window.__noSchoolStops switches it all off)
    this.sb = new SchoolStops(this);
    this._sbOn = false;
    this.peds = null;   // the crowd (main.js): the children stepping off
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
    if (this.flow[ei] === 0) {
      // A two-way arterial of two or more lanes a way (arterial.js
      // twoWayLayout, from OSM's lanes:forward / backward): lane floor(u * n)
      // of its side, counted from the centre. Else the old street: one lane
      // a way, right of the centreline at 0.48 hw.
      const T = twoWayLayout(e);
      if (!T) return e.hw * 0.48;
      const n = sign > 0 ? T.nP : T.nM;
      // (u < 0: the left-turn bay, where this side has one -- else the inner lane)
      if (u < 0) return twoWayLaneOff(T, sign, (sign > 0 ? T.yP : T.yM) ? -1 : 0);
      return twoWayLaneOff(T, sign, Math.min(n - 1, Math.floor(u * n)));
    }
    const L = this.lanes, k = ei * 3;
    if (Number.isNaN(L[k])) {
      // (arterial.js oneWaySpan: the narrowest point, lid barriers, an
      // opposing carriageway's half of an overlap, the kerbs' parking)
      const S = oneWaySpan(this.city, ei, (i) => this.flow[i]);
      L[k] = S[0];
      L[k + 1] = S[1];
      L[k + 2] = S[2];
    }
    const n = L[k + 2];
    const i = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
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
    const ri = this._rigs.indexOf(v);
    if (ri >= 0) this._rigs.splice(ri, 1);
    if (v.bellows) { this.scene.remove(v.bellows); v.bellows.geometry.dispose(); v.bellows = null; }
    const i = this.cars.indexOf(v);
    if (i >= 0) this.cars.splice(i, 1);
    if (v.sb) this.sb.drop(v);
    this.scene.remove(v.group);
    if (v.slot != null) { this.parkedSlots.delete(v.slot); this._parkVer = (this._parkVer | 0) + 1; }
    v.bodyMat.dispose();
    if (v.dentTrim) { v.dentTrim.dispose(); v.dentMatte.dispose(); v.dentTrim = v.dentMatte = null; }
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
      this._rigs.push(v);
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
        this._parkVer = (this._parkVer | 0) + 1;
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
    // (no kerbside parking on a country road: no kerb, a ditch -- rural.js)
    if (!(e.elev || e.cls === 'hwy' || e.cls === 'ramp' || e.noTraffic || e.rural)) {
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
        // (none in a painted bike lane, in the kerb lane of a multi-lane
        // two-way arterial, or against a divided road's median: arterial.js)
        if (alBike(e, side) || twoWayLayout(e) || medianGaps(city, e)[side > 0 ? 0 : 1] < 30) continue;
        const off = e.hw - 1.15;
        const x = lerp(a.x, b.x, t) - e.dz * off * side;
        const z = lerp(a.z, b.z, t) + e.dx * off * side;
        if (!G.isBuildable(x, z) || city.jumpClear(x, z) || this.wet(x, z)) continue;
        const tn = CIVILIAN_TYPES[Math.floor(hash2(ei + s * 7, 11) * CIVILIAN_TYPES.length)];
        if (NO_KERB(tn)) continue;
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
    const LOT_R = 90, LOT_CAP = 6;
    const kx = Math.round(px / 10), kz = Math.round(pz / 10);
    if (this._lotKey === kx * 100000 + kz) return;
    this._lotKey = kx * 100000 + kz;
    let alive = 0;
    for (const v of this.cars) if (v.mode === 'parked' && typeof v.slot === 'string') alive++;
    if (alive >= LOT_CAP) return;
    // the bays round the player, nearest first (lotBays: one per 10 m cell of
    // a world-aligned grid, so which bays hold a car no longer depends on where
    // the scan started -- the bays past the cap are parkedScenery's)
    const cand = [];
    const t0x = Math.floor((px - LOT_R) / LOT_TILE), t1x = Math.floor((px + LOT_R) / LOT_TILE);
    const t0z = Math.floor((pz - LOT_R) / LOT_TILE), t1z = Math.floor((pz + LOT_R) / LOT_TILE);
    for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
      for (const c of this.lotBays(tx, tz)) {
        const d = dist2(c.x, c.z, px, pz);
        if (d > LOT_R * LOT_R || this.parkedSlots.has(c.key)) continue;
        cand.push([d, c]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, c] of cand) {
      if (alive >= LOT_CAP) break;
      const v = this.spawnAt(c.x, c.z, c.heading, c.tn, randomCarColor(c.col), 'parked');
      v.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      v.slot = c.key;
      this.parkedSlots.add(c.key);
      this._parkVer = (this._parkVer | 0) + 1;
      alive++;
    }
  }

  /**
   * The occupied car-park bays of one LOT_TILE square (cached): the bays the
   * terrain shader paints (world.js, the lot layer: 2.6 m wide along the lot's
   * long side, rows 5.4 m deep either side of a 7.2 m aisle, an 18 m module in
   * the lot's own frame), one tried per 10 m cell, OCC of them with a car.
   * Each is { key, x, z, heading, tn, col }: the type a household car
   * (kwdriveway.js sceneryType: a type the scenery draws in its detailed
   * model up close), so a bay is the same car as a parked Vehicle or as
   * scenery.
   */
  lotBays(tx, tz) {
    const cache = this._lotBays || (this._lotBays = new Map());
    const tk = tx * 4096 + tz;
    let out = cache.get(tk);
    if (out) return out;
    out = [];
    const OCC = 0.16, city = this.city;
    const tried = new Set();
    for (let x = tx * LOT_TILE + 5; x < (tx + 1) * LOT_TILE; x += 10) {
      for (let z = tz * LOT_TILE + 5; z < (tz + 1) * LOT_TILE; z += 10) {
        const code = G.lotCodeAt(x, z);
        if (!code || ((code - 1) / G.LOT_ANG | 0) !== 0) continue;   // parking only
        const ang = ((code - 1) % G.LOT_ANG) / G.LOT_ANG * Math.PI;
        const ux = Math.cos(ang), uz = Math.sin(ang);
        const pu = x * ux + z * uz, pv = -x * uz + z * ux;
        const bu = Math.floor(pu / 2.6), m = Math.floor(pv / 18);
        const row = ((pv % 18) + 18) % 18 < 9 ? 0 : 1;
        // Auto KW: every 13th bay either side of every other seam is a kerbed
        // island with a light standard (world.lotLights)
        if (((bu % 13) + 13) % 13 === 0 && (row ? ((m + 1) % 2 + 2) % 2 === 0 : ((m % 2) + 2) % 2 === 0)) continue;
        const key = `L${bu},${m},${row},${code}`;
        if (tried.has(key)) continue;
        tried.add(key);
        if (hash2(bu * 7 + row, m * 13 + code) > OCC) continue;
        const cu = (bu + 0.5) * 2.6, cv = m * 18 + (row ? 15.3 : 2.7);
        const wx = cu * ux - cv * uz, wz = cu * uz + cv * ux;
        // (the bay's own tile files it: a bay found from a neighbour's cell is that tile's)
        if (Math.floor(wx / LOT_TILE) !== tx || Math.floor(wz / LOT_TILE) !== tz) continue;
        if (G.lotCodeAt(wx, wz) !== code) continue;
        if (city.onRoad(wx, wz, 2.5) || city.jumpClear(wx, wz)) continue;
        if (this.inFootprint(wx, wz, 1.5) || this.wet(wx, wz)) continue;
        // The seaplane dock's car park runs to the shore, and its landing deck
        // is inside the lot's coverage: a bay there parked a car on the pier.
        if (city.platformAt && city.platformAt(wx, wz) !== null) continue;
        if (this.keepClear.some(([kx, kz, kr]) => dist2(wx, wz, kx, kz) < kr * kr)) continue;
        const tn = sceneryType(hash2(wx | 0, wz | 0));
        if (!TYPES[tn]) continue;
        // Nose into the bay: the car's length runs across the row, along
        // the lot's short axis (-uz, ux); the two rows face each other.
        out.push({ key, x: wx, z: wz, heading: Math.atan2(-uz, ux) + (row ? 0 : Math.PI), tn, col: (wx * 7 + wz) | 0 });
      }
    }
    // (wet() needs main.js's waterAt: nothing is kept before it is set)
    if (this.waterAt) { if (cache.size > 600) cache.clear(); cache.set(tk, out); }
    return out;
  }

  /**
   * AUTO KW (v82): the parked cars that are not Vehicles, as scenery records
   * for kwdriveway.js (its `_choose` calls this): every kerb slot and lot bay
   * within R that no parked Vehicle holds -- each exactly the car updateParked
   * / updateLotParked would spawn there. `emit(x, y, z, heading, type, colour
   * seed)` takes each one.
   */
  parkedScenery(px, pz, R, emit) {
    const city = this.city, R2 = R * R;
    for (const ei of city.edgesNear(px, pz, R)) {
      const sl = this.kerbSlots(ei);
      for (const k of sl) {
        if (this.parkedSlots.has(k.key) || this.reservedSlots.has(k.key)) continue;
        if (dist2(k.x, k.z, px, pz) > R2) continue;
        if (k.y === undefined) k.y = city.groundAt(k.x, k.z, null, city.roadLift(k.x, k.z));
        emit(k.x, k.y, k.z, k.heading, k.tn, k.col);
      }
    }
    const t0x = Math.floor((px - R) / LOT_TILE), t1x = Math.floor((px + R) / LOT_TILE);
    const t0z = Math.floor((pz - R) / LOT_TILE), t1z = Math.floor((pz + R) / LOT_TILE);
    for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
      for (const c of this.lotBays(tx, tz)) {
        if (this.parkedSlots.has(c.key) || dist2(c.x, c.z, px, pz) > R2) continue;
        if (c.y === undefined) c.y = city.groundAt(c.x, c.z, null, city.roadLift(c.x, c.z));
        emit(c.x, c.y, c.z, c.heading, c.tn, c.col);
      }
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
    const pool = city.edgesNear(px, pz, SPAWN_FAR + 30);
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
      if (d < 90 || d > SPAWN_FAR) continue;
      // never in view closer than SPAWN_SEEN: the camera's own frustum (last
      // frame's, set in update; a sphere a car's size), else the old forward
      // cone. (Seen past SPAWN_SEEN a car is a few pixels; before, the cone's
      // 190 m let cars appear from nothing in plain view on a phone's wide
      // frame, and anything out of the cone -- the sides of the view -- at 90 m.)
      // Out of view it may be anywhere 90-330 m off; in view only from
      // SPAWN_SEEN out to SPAWN_FAR, so the road ahead still fills.
      if (this.camera && this._farFrOk) {
        this._farS.center.set(x, G.terrainHeight(x, z) + 1.5, z);
        this._farS.radius = 6;
        const seen = this._farFr.intersectsSphere(this._farS);
        if (seen ? d < SPAWN_SEEN : d > 330) continue;
      } else {
        if (d > 330) continue;
        if (camDir) {
          const dot = ((x - px) * camDir.x + (z - pz) * camDir.z) / d;
          if (dot > 0.4 && d < 190) continue;
        }
      }
      // Only where a car can keep driving legally forever (see
      // directedComponents), and only the way the street runs.
      if (!this.inComponent(ei)) continue;
      const draw = this.R.n();
      const sign = this.flow[ei] || (draw < 0.5 ? 1 : -1);
      // ...and not heading into a short no-exit street (noExitTraps): its few
      // cars are the residents', and one spawned there only U-turned at its end
      const cul = this.cul[ei * 2 + (sign > 0 ? 1 : 0)];
      if (cul > 0 && cul < CUL_MAX) continue;
      const laneU = this.R.n();
      const off = this.laneLat(ei, sign, { laneU });
      // right of travel: travelling (fx, fz), right is (-fz, fx)
      const lo = { x: -e.dz * sign * off, z: e.dx * sign * off };
      const heading = Math.atan2(e.dx * sign, e.dz * sign);
      let tn = CIVILIAN_TYPES[Math.floor(this.R.n() * CIVILIAN_TYPES.length)];
      // (a school bus does drive residential streets, to stop for children:
      // schoolbus.js -- unless that is switched off)
      if (e.cls === 'res' && (NO_KERB(tn) || tn === 'boxtruck' || tn === 'uhaul') && !(tn === 'schoolbus' && this._sbOn)) tn = 'sedan';
      // Auto KW: nothing that cannot hold 100 km/h on a freeway or its ramps
      if (this.fwy[ei] && FWY_BANNED.has(tn)) tn = 'sedan';
      if (e.cls === 'hwy' && !TYPES[tn].bus) {
        const hh = hash2(ei + 4099, this._prio);
        if (hh < HWY_SEMI_P) tn = 'semi';
        else if (hh < HWY_SEMI_P + HWY_OPP_P && this.cars.filter((c) => c.spec.hand === 'opp').length < OPP_MAX) tn = 'opp';
      }
      // The Wedge drives past now and then: a quarter of the EVs, ~1.5 % of
      // traffic. Not a CIVILIAN_TYPES slot: that array is hashed for kerbside
      // parking, and appending would move every parked car in the city. A
      // hash, not this.R, so the spawn stream after it is unchanged.
      if (tn === 'ev' && hash2(ei, this._prio) < 0.25) tn = 'wedge';
      // Auto KW: a third of the iXpress draws are the ION Bus (302) instead
      else if (tn === 'busx' && hash2(ei + 31, this._prio) < 0.34) tn = 'ionbus';
      // The Belltown Hellcat: a few, and only in Belltown (the HUD's
      // neighbourhood). A car-sized draw there turns into one now and then,
      // never more than HELLCAT_MAX about at once. A hash again, not this.R.
      if (!HEAVY.has(tn) && hash2(ei + 7919, this._prio) < HELLCAT_P && G.placeNameAt(x, z) === 'Belltown'
        && this.cars.filter((c) => c.spec.hellcat).length < HELLCAT_MAX) tn = 'hellcat';
      else if (!HEAVY.has(tn) && hash2(ei + 104729, this._prio) < WIENER_P && !this.cars.some((c) => c.spec.wiener)) tn = 'wiener';
      // AUTO KW, A FREEWAY SPAWN: in a gap in its lane (none within 45 m
      // ahead or behind), a semi in the right two lanes.
      let fs = null;
      if (this.fwy[ei] && e.oneway) {
        fs = this.fwySpawn(ei, sign, laneU, tn, x, z);
        if (!fs) continue;
        lo.x = -e.dz * sign * fs.off; lo.z = e.dx * sign * fs.off;
      }
      // AUTO KW, A CITY SPAWN: not on top of a car, and not at speed into
      // the back of a queue (a red, a stop sign): within 50 m ahead in its
      // direction the slowest car there sets its pace.
      let cap = Infinity;
      if (!fs) {
        const sx = x + lo.x, sz = z + lo.z, fx = e.dx * sign, fz = e.dz * sign;
        let clash = false;
        for (const o of this.cars) {
          const rx = o.x - sx, rz = o.z - sz, d2 = rx * rx + rz * rz;
          if (d2 > 55 * 55) continue;
          if (d2 < 15 * 15) { clash = true; break; }
          const fwd = rx * fx + rz * fz;
          if (fwd > 0 && Math.abs(rx * fz - rz * fx) < 3) cap = Math.min(cap, Math.max(0, Math.abs(o.vLong) + (fwd - 18) / 3));
        }
        if (clash) continue;
      }
      const v = this.spawnAt(x + lo.x, z + lo.z, heading, tn, randomCarColor((this.R.n() * 1e6) | 0), 'traffic');
      if (v.spec.hand === 'opp') {
        // the OPP on patrol: its light bar, dark (policeLights only runs for units)
        this.lightBar(v);
        for (const L of [v.lightL, v.lightR]) L.material.color.setHex(L.userData.cold);
      }
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
      v.laneU = fs ? fs.u : laneU;
      v.vLong = Math.min(6 + this.R.n() * 6, cap);
      v.panic = 0;
      // Every driver keeps a pace of their own, +-8 % on the limit: a whole
      // street at exactly the limit drives in formation.
      v.drvK = 0.92 + 0.16 * hash2(ei, (x * 7) | 0);
      if (v.spec.hellcat) v.drvK = 1.35;   // and the Hellcat keeps nobody's pace
      if (v.spec.wiener) v.drvK = 0.9;     // the Hotdoggers drive it gently
      // a freeway spawn joins at its own pace (fwySpawn chose its gap)
      if (fs) v.vLong = Math.min(e.spd * v.drvK, v.spec.hand === 'semi' ? SEMI_V : Infinity) * 0.95;
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
    v.lightL = mkL(0x3355ff, 0x2a3a74, -0.31);
    v.lightR = mkL(0xff2a2a, 0x742a2e, 0.31);
    v.tilt.add(bar);
    // Remember the light bar so `remove` can free it. A vehicle SHARES its
    // trim and matte geometry and materials with every other instance, so
    // nothing may traverse-and-dispose a car -- only the per-instance extras
    // built here. Cops churn continuously during a chase, and this was three
    // geometries and three materials leaked every time one despawned.
    v.extra = bar;
  }

  /** Strobe a light bar's lenses (`on`), or show them dark. A lens between
   *  flashes is its dark lens colour, never hidden: hiding it left the bar a
   *  bare housing half the time, as if the lights had fallen off. The flash
   *  is a wig-wag of double flashes (blue twice, red twice, ~1.4 a second). */
  policeLights(v, dt, on) {
    if (!v.lightL) return;
    const L = v.lightL, R = v.lightR;
    if (!L.visible || !R.visible) { L.visible = R.visible = true; }
    let l = false, r = false;
    if (on) {
      v.siren = (v.siren || 0) + dt;
      const ph = (v.siren * 1.4) % 1, q = ph % 0.5;
      const lit = q < 0.11 || (q > 0.17 && q < 0.28);
      if (ph < 0.5) l = lit; else r = lit;
    }
    const cl = l ? L.userData.hot : L.userData.cold, cr = r ? R.userData.hot : R.userData.cold;
    if (L.material.color.getHex() !== cl) L.material.color.setHex(cl);
    if (R.material.color.getHex() !== cr) R.material.color.setHex(cr);
  }

  // --- pathfinding ---------------------------------------------------------

  /**
   * A* over the street graph for the police, respecting one-way streets.
   *
   * What a real pursuit does, and so what this does: a unit never takes a
   * freeway or a ramp against its flow (that is the head-on on SR-99), but it
   * will run a block of a one-way SURFACE street the wrong way to cut a
   * suspect off, lights on -- so that is allowed at 3x the cost, and chosen
   * only when it saves a real detour. `strict` (a taxi's fare) forbids it:
   * no wrong-way edge at all.
   */
  findPath(fromNode, toNode, limit = 2500, strict = false) {
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
          // (a taxi's route, strict, never goes the wrong way: taxi.js)
          if (strict || e.cls === 'hwy' || e.cls === 'ramp') continue;
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
    if (FAR_LOD === Infinity && !this.decor.length && !this._decorWas) return;
    this._decorWas = this.decor.length > 0;
    const lim = FAR_LOD * FAR_LOD;
    for (const e of this.farMeshes.values()) e.n = 0;
    if (FAR_LOD !== Infinity) this._farCars(px, pz, player, lim);
    // the scenery cars, every one in the frustum: the nearest DECOR_CAP of
    // them within DECOR_NEAR of the camera in their type's detailed model
    // (nearLod), the rest in its far LOD -- same matrix, same colour, same
    // material, so the swap changes the mesh only
    const cam = this.camera, fr = this._farFr, sph = this._farS, M = this._farM;
    for (const e of this.nearMeshes.values()) e.n = 0;
    const near = this._near;
    near.length = 0;
    const cx = cam ? cam.position.x : px, cz = cam ? cam.position.z : pz, nq = DECOR_NEAR * DECOR_NEAR, f2q = FAR2 * FAR2;
    for (const d of this.decor) {
      d._fr = !cam || (sph.center.set(d.x, d.y + 1, d.z), sph.radius = 9, fr.intersectsSphere(sph));
      d._d2 = (d.x - cx) ** 2 + (d.z - cz) ** 2;
      if (d._fr && d._d2 < nq && this.nearMeshes.has(d.type)) near.push(d);
      else d._d2 = -1;
    }
    if (near.length > DECOR_CAP) {
      near.sort((a, b) => a._d2 - b._d2);
      for (let i = DECOR_CAP; i < near.length; i++) near[i]._d2 = -1;
      near.length = DECOR_CAP;
    }
    for (const d of this.decor) {
      if (!d._fr) continue;
      const nr = d._d2 >= 0;
      const pool = nr ? this.nearMeshes : this.farMeshes;
      const pk = !nr && (d.x - cx) ** 2 + (d.z - cz) ** 2 > f2q ? d.type + '|2' : d.type;
      let e = pool.get(pk);
      if (!e) pool.set(pk, (e = { mesh: null, cap: 0, n: 0 }));
      if (e.n === e.cap) (nr ? this.growNear : this.growFar).call(this, e, pk);
      const c = Math.cos(d.h), s = Math.sin(d.h);
      // the group's (x, y, z, yaw) times the tilt's lift (pivotY): as a parked car's
      M.set(c, 0, s, d.x, 0, 1, 0, d.y + (d.pivotY || 0), -s, 0, c, d.z, 0, 0, 0, 1);
      e.mesh.setMatrixAt(e.n, M);
      e.mesh.setColorAt(e.n, d.col);
      e.n++;
    }
    for (const e of this.nearMeshes.values()) {
      if (!e.mesh) continue;
      e.mesh.count = e.n;
      e.mesh.visible = e.n > 0;
      if (!e.n) continue;
      e.mesh.instanceMatrix.needsUpdate = true;
      e.mesh.instanceColor.needsUpdate = true;
      e.mesh.computeBoundingSphere();
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

  /** updateFarLod's traffic: every car past FAR_LOD into its type's InstancedMesh. */
  _farCars(px, pz, player, lim) {
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
      let frozen = far;
      if (!far && v !== player.vehicle) { const m = v.mode; frozen = (m === 'parked' || m === 'apron') && v._still >= 3; }
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
      const cc = cam ? cam.position : null;
      const pk = cc && (v.x - cc.x) ** 2 + (v.z - cc.z) ** 2 > FAR2 * FAR2 ? v.typeName + '|2' : v.typeName;
      let e = this.farMeshes.get(pk);
      if (!e) this.farMeshes.set(pk, (e = { mesh: null, cap: 0, n: 0 }));
      if (e.n === e.cap) this.growFar(e, pk);
      v.group.updateMatrix();
      v.tilt.updateMatrix();
      this._farM.multiplyMatrices(v.group.matrix, v.tilt.matrix);
      // its lamps (updateLamps), as the near trim's: the z column's scale
      if (v.lampBits) { const me = this._farM.elements, k = 1 + v.lampBits / LAMP_STEP; me[8] *= k; me[9] *= k; me[10] *= k; }
      e.mesh.setMatrixAt(e.n, this._farM);
      if (!v._farCol) v._farCol = new THREE.Color(v.color);
      e.mesh.setColorAt(e.n, v._farCol);
      e.n++;
    }
  }

  /**
   * Auto KW: the scenery cars' types (kwdriveway.js SCENERY_TYPES, at boot,
   * before a phone drops the vehicle arrays): each type's near LOD built now,
   * and its far LOD if it was not.
   */
  sceneryTypes(list) {
    const types = vehicleAssets().types;
    for (const t of list) {
      if (!types[t] || this.nearMeshes.has(t)) continue;
      farLod(t); farLod2(t); nearLod(t);
      this.nearMeshes.set(t, { mesh: null, cap: 0, n: 0 });
    }
  }

  /** growFar for the near LOD: casts the sun's shadow, as a traffic car's meshes do. */
  growNear(e, typeName) {
    const { geo, mat } = nearLod(typeName);
    const cap = Math.max(4, e.cap * 2);
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
    m.castShadow = true;
    m.name = 'sceneryCars';
    this.scene.add(m);
    e.mesh = m;
    e.cap = cap;
  }

  growFar(e, key) {
    // (`type|2`: the far-far LOD's pool, FAR2)
    const two = key.endsWith('|2'), { geo, mat } = two ? farLod2(key.slice(0, -2)) : farLod(key);
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

  /**
   * VEHICLE LAMPS (vehicles.js tagLamps / setLamps): what each driven car's
   * lamps show, from what its driver is already doing -- stop lamps braking
   * or standing, reversing lamps rolling back (a wedge's or the gridlock
   * rule's back-out), the turn signal for a lane change (signalled or under
   * way), a planned turn within SIG_D0 + SIG_DT x speed m (nextTurn) or a
   * planned freeway exit within EXIT_SIG m, hazards on a wedged car or one
   * stopped after a hit. VISUAL ONLY: it reads the drivers' state and writes
   * v.lampBits (setLamps) and v._lamp, which no driving code reads; no RNG.
   * Cars past LAMP_RANGE are dark.
   */
  updateLamps(dt, px, pz, player) {
    const T = (this._lampT = (this._lampT || 0) + dt);
    this._lampTick = ((this._lampTick || 0) + 1) | 0;
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      const v = cars[i], md = v.mode;
      if (v === player.vehicle || md === 'trailer') continue;
      let bits = 0;
      if ((md === 'traffic' || md === 'police' || md === 'suspect') && !v.wreck && v.group.visible
        && dist2(v.x, v.z, px, pz) < LAMP_RANGE * LAMP_RANGE) {
        const L = v._lamp || (v._lamp = { b: 0, dir: 0, sigT: 0, hz: 0, ph: hash2(v.prio || 0, 41) * BLINK });
        const inp = v._lin || v.aiIn, sp = v.vLong;
        // stop lamps: on the brake, held (the parking brake at a standstill),
        // or standing with no throttle -- with a short hold, so a driver
        // feathering the pedals does not flicker
        if (inp && ((inp.brake > 0.05 && sp > 0.3) || inp.park || v.held || (Math.abs(sp) < 0.3 && !(inp.throttle > 0.05)))) L.b = BRAKE_HOLD;
        else if (L.b > 0) L.b -= dt;
        if (L.b > 0) bits |= LAMP_BRAKE;
        if (sp < -0.3) bits |= LAMP_REV;
        // hazards: wedged (the back-out is coming), or stopped after a hit;
        // a police mission's suspect pulled over (getaway.js `stopT`)
        if ((md === 'traffic' && (v.stuckT > 1.5 || (v.panic > 0 && Math.abs(sp) < 0.5)))
          || (md === 'suspect' && v.suspect && v.suspect.stopT > 0)) L.hz = HAZ_HOLD;
        else if (L.hz > 0) L.hz -= dt;
        // the turn signal, judged every LAMP_TICK frames (staggered), held SIG_HOLD s:
        // traffic, and the police with their lights dark (a unit on its way
        // somewhere, or heading off once the heat is gone) -- not a unit
        // running with its lights on, nor a suspect fleeing (getaway.js)
        if ((this._lampTick + i) % LAMP_TICK === 0) {
          const calm = md === 'traffic' || (md === 'police' && !(this.game && this.game.wanted > 0));
          const d = calm && v.rt && v.rtN ? this.lampSignal(v) : 0;
          if (d) { L.dir = d; L.sigT = SIG_HOLD; }
        }
        if (L.sigT > 0) L.sigT -= dt;
        const on = (T + L.ph) % BLINK < BLINK * 0.5;
        if (L.hz > 0) bits |= LAMP_LON | LAMP_RON | (on ? LAMP_L | LAMP_R : 0);
        else if (L.sigT > 0) bits |= L.dir < 0 ? LAMP_LON | (on ? LAMP_L : 0) : LAMP_RON | (on ? LAMP_R : 0);
        // a school bus stopping for children: its warning lamps and stop arm (schoolbus.js)
        if (v.sb && v.sb.phase) bits = this.sb.lampBits(v, T);
      } else if (v._lamp) { v._lamp.sigT = 0; v._lamp.hz = 0; v._lamp.b = 0; }
      v.setLamps(bits);
      if (v.trailer) v.trailer.setLamps(bits);
    }
  }

  /** The way v's driver is signalling now: -1 left, +1 right, 0 none (updateLamps). */
  lampSignal(v) {
    const rt = v.rt;
    if (!rt || !v.rtN) return 0;
    // moving over (lcShift: how far right of its new lane it still is), or about to
    if (v.lcShift) return v.lcShift > 0 ? -1 : 1;
    if (v.lcSigOn) return v.lcSigDir;
    const s0 = (v.x - rt[R_QX]) * rt[R_UX] + (v.z - rt[R_QZ]) * rt[R_UZ];
    // a planned freeway exit, its diverge within EXIT_SIG m
    if (v.exitNode != null && v.exitNode >= 0) {
      let d = rt[R_LEN] - s0;
      for (let j = 0; j < v.rtN && d < EXIT_SIG; j++) {
        if (j) d += rt[j * RT_F + R_LEN];
        if (this.entryEnd(v, j) === v.exitNode) return d < EXIT_SIG ? (v.exitSide > 0 ? 1 : -1) : 0;
      }
      return 0;
    }
    const nt = this.nextTurn(v, s0);
    if (nt && nt.d < SIG_D0 + SIG_DT * Math.max(0, v.vLong)) return nt.mv === 'L' ? -1 : 1;
    return 0;
  }

  // --- per-frame -----------------------------------------------------------

  update(dt, px, pz, camDir, player) {
    const city = this.city;
    const game = this.game;
    if (this.jc) this.jc.update(dt);   // the signals' clock
    this._sbOn = schoolStopsOn();
    if (!this._sbOn && this.sb.list.length) for (const v of [...this.sb.list]) this.sb.end(v);

    this.updateParked(px, pz);

    // maintain traffic population
    let trafficCount = 0, policeCount = 0;
    for (const v of this.cars) {
      const m = v.mode;
      if (m === 'traffic') trafficCount++;
      else if (m === 'police') policeCount++;
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      // thinner after midnight (tod.js; TODK.traffic exactly 1 by day)
      const target = TODK.traffic < 1 ? Math.round(TRAFFIC_TARGET * TODK.traffic) : TRAFFIC_TARGET;
      if (trafficCount < target) this.spawnTraffic(px, pz, camDir);
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
      this._farFrOk = true;
    }
    this._tick = (this._tick + 1) | 0;

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v === player.vehicle) continue;
      // (its mode read once: a getter, and ~220 vehicles a frame asked it up
      // to nine times each; nothing below changes it before the driver runs)
      const md = v.mode;
      // an articulated bus's rear section is placed by its front (below)
      if (md === 'trailer') { if (!v.leader) this.remove(v); continue; }
      const d2 = dist2(v.x, v.z, px, pz);
      // 'apron' is the airport's planes: player-flyable set dressing that has
      // to still be there when you drive back an hour later.
      // 'race': the hydroplane race's boats (hydrorace.js drives them)
      // 'path': a cyclist on the bike paths (bikes.js rides them)
      if (md === 'race' || md === 'path') continue;
      // (a police mission's suspect is policemissions.js's to end)
      if (d2 > DESPAWN * DESPAWN && md !== 'parked' && md !== 'apron' && md !== 'suspect') { this.remove(v); continue; }
      if (md === 'police' && game.wanted === 0 && d2 > 140 * 140) { this.remove(v); continue; }

      if (md === 'parked') {
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
      const show = md !== 'apron' || d2 < (v.spec.showR || Math.max(PARKED_SHOW, v.spec.len * 80, v.spec.seeFar || 0)) ** 2;
      // ...and so, once settled, is anything else standing on an apron: the
      // bike-share bikes, the airfield's aircraft, a moored boat (except one
      // within 120 m, which bobs). 114 of the 158 vehicles in the list are
      // apron vehicles since the docks, and within 300 m each ran the whole
      // driving model every frame to stand still.
      // (a fire rig on its station apron too: its trailer is placed by follow below)
      // (only an apron vehicle inside 300 m asks whether it settles)
      if (md === 'apron' && d2 < 300 * 300 && (v.spec.atv || v.spec.tank || v.spec.bicycle || v.spec.fire || v.spec.ag || (v.spec.plane && !v.airborne) || (v.spec.boat && d2 > 120 * 120))
        && Math.abs(v.vLong) < 0.05 && Math.abs(v.vLat) < 0.05) {
        v.group.visible = show;
        if (v._still < 3) v._still++;
        else continue;
      } else v._still = 0;
      v.group.visible = show;
      // The airport's planes sit where place() put them, as parked cars do, and
      // from downtown all eight used to run the driving model every frame.
      if (md === 'apron' && d2 > 300 * 300) continue;
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
      if (ON_PHONE && cam && (md === 'traffic' || (v.unit && md === 'police' && d2 > 120 * 120)) && d2 > 80 * 80) {
        sph.center.set(v.x, v.y + 1, v.z);
        sph.radius = v.halfLen + 8;
        if (!fr.intersectsSphere(sph) && ((this._tick + i) & 1)) continue;
      }
      vdt = Math.min(v._acc, 0.1);
      v._acc = 0;

      let input;
      if (md === 'traffic') {
        input = this.driveTraffic(v, vdt, px, pz, player);
        if (v.recycle) { this.remove(v); continue; }
      }
      else if (md === 'police') input = this.drivePolice(v, vdt, px, pz, player);
      // a police mission's fleeing suspect (policemissions.js)
      else if (md === 'suspect' && this.suspectDriver) input = this.suspectDriver(v, vdt, px, pz, player);
      // shunted, abandoned or parked on an apron: nobody at the wheel, so the
      // parking brake (Vehicle.update `park`); aircraft and boats keep their old coast
      // (shared: Vehicle.update only reads its input)
      else input = v.spec.plane || v.spec.boat ? COAST_IN : PARK_IN;

      v.update(vdt, input);
      v._lin = input;   // (the lamps read it: updateLamps)
      collideWithBuildings(v, city, null, true);
    }

    this.resolveCarCollisions(dt, player);
    // articulated buses: each rear section follows its front, the player's too
    // (each rig moves only its own trailer, so the order is free)
    for (const v of this._rigs) {
      if (!v.trailer) continue;
      if (v.bellows) v.bellows.visible = v.group.visible && dist2(v.x, v.z, px, pz) < 150 * 150;
      // (a rig standing on its apron has not moved its trailer either)
      const k = v.x * 7.3 + v.z * 3.1 + v.heading * 11 + v.y;
      if (v._mode !== 'apron' || v === player.vehicle || k !== v._followK) { v._followK = k; v.trailer.follow(v); }
      v.trailer.group.visible = v.group.visible;
    }
    // collision resolution edits transforms directly, so re-sync every body.
    for (const v of this.cars) if (v !== player.vehicle) v.sync();
    if (this._sbOn) this.sb.update(dt, player);
    this.updateLamps(dt, px, pz, player);
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
    // A FREEWAY RAMP AT ITS GORE (citygen spreadGores, `e.gore`): its lane line runs from `g[0]`
    // right of its lanes at the start node to `g[1]` at the end, so the
    // ramp's lanes lie beside the main line's instead of across them
    const g = this.goreOf(ei, sign);
    if (g) {
      const nb = this.city.nodes[sign > 0 ? e.b : e.a];
      const sx = na.x - uz * (off + g[0]), sz = na.z + ux * (off + g[0]);
      const ex = nb.x - uz * (off + g[1]), ez = nb.z + ux * (off + g[1]);
      const L = Math.hypot(ex - sx, ez - sz) || 1e-3;
      rt[o + R_QX] = sx; rt[o + R_QZ] = sz; rt[o + R_UX] = (ex - sx) / L; rt[o + R_UZ] = (ez - sz) / L; rt[o + R_LEN] = L;
    }
    rt[o + V_K] = 0; rt[o + V_A] = 0; rt[o + V_B] = 0; rt[o + V_T] = 0; rt[o + V_R] = Infinity; rt[o + V_TH] = 0;
  }

  /** Start a car's route afresh on (v.edge, v.dirSign), lane v.laneU. */
  routeInit(v) {
    if (!v.rt) v.rt = new Float64Array(RT_F * RT_MAX);
    if (!v.aiIn) v.aiIn = { throttle: 0, brake: 0, steer: 0, handbrake: 0, park: false };
    this.routeEntry(v, 0, v.edge, v.dirSign, v.laneU != null ? v.laneU : 0.5);
    v.rtN = 1;
    v.lcShift = 0;
  }

  /** The lane fraction on one-way edge ei (driven `sign`) whose lane is
   *  nearest lateral offset `off`: a car carries on in ITS lane where the
   *  number of lanes changes, instead of keeping a fraction of the width. */
  nearestLaneU(ei, sign, off) {
    if (this.flow[ei] === 0) {
      // (a two-way arterial's lanes, counted from the centre: arterial.js)
      // (never the left-turn bay: a car goes into that on purpose, bayRule)
      const T = twoWayLayout(this.city.edges[ei]);
      if (!T) return 0.5;
      const n = sign > 0 ? T.nP : T.nM;
      const i = clamp(Math.floor((off - (sign > 0 ? T.m : -T.m) - T.c0) / T.w) - (sign > 0 ? T.yP : T.yM), 0, n - 1);
      return (i + 0.5) / n;
    }
    this.laneLatU(ei, sign, 0.5);          // fills the lane cache
    const L = this.lanes, k = ei * 3, n = L[k + 2];
    const w = (L[k + 1] - L[k]) / n;
    if (!(w > 0)) return 0.5;
    const i = clamp(Math.floor((off * sign - L[k]) / w), 0, n - 1);
    return (i + 0.5) / n;
  }

  // --- freeway gores (Auto KW) ------------------------------------------------
  //
  // OSM joins a freeway's ramp (a *_link) to the main line's CENTRE line: the
  // 401 EB's two-lane exit at Hespeler Rd leaves the middle of six lanes at 7
  // deg. Laid round that line, a car taking the exit came off the right lane
  // and jumped 7 m LEFT onto the ramp's lane line at the node (the lines never
  // cross within a vertex's reach), across the lane beside it -- the side-
  // swipes hwytraffic logged there; a merging car (Hwy 85 at Bridgeport) ran
  // across the right lane into the MIDDLE one, the lane nearest the link's
  // end. citygen spreadGores moves each such ramp out beside the main line
  // and gives the edge still touching the main line's node a lateral shift
  // (`e.gore`, right of travel at its start and end): its lanes run from the
  // main line's outer lanes at the node out to the moved ramp.

  /** [shift at the start of travel, at its end] right of travel, or null. */
  goreOf(ei, sign) {
    const g = this.city.edges[ei].gore;
    return g && sign === this.flow[ei] ? g : null;
  }

  /** v's gore shift where it is now on its entry (0 off a gore). */
  goreAt(v) {
    const rt = v.rt;
    if (!rt || !v.rtN) return 0;
    const g = this.goreOf(rt[R_EI], rt[R_SG]);
    if (!g) return 0;
    const t = clamp(((v.x - rt[R_QX]) * rt[R_UX] + (v.z - rt[R_QZ]) * rt[R_UZ]) / rt[R_LEN], 0, 1);
    return g[0] + (g[1] - g[0]) * t;
  }

  /** The lane on edge nei (driven nsg) a car carries on in from lane u of
   *  edge pei (driven psg) across node ni, at a freeway diverge where the
   *  carriageway loses lanes: counted from the side AWAY from the ramp, so
   *  the lanes that carry on stay side by side (the lane under the main
   *  line's centre was the nearest of two lanes, and both went into it).
   *  -1 elsewhere. */
  goreThrough(pei, psg, u, nei, nsg, ni) {
    const E = this.city.edges;
    if (E[pei].cls !== 'hwy' || E[nei].cls !== 'hwy' || !this.fwy[pei]) return -1;
    const [np, nn] = [this.laneIdx(pei, psg, u)[1], this.laneIdx(nei, nsg, 0.5)[1]];
    if (nn >= np) return -1;
    let side = 0;
    const ux = E[pei].dx * psg, uz = E[pei].dz * psg;
    for (const k of this.city.nodes[ni].e) {
      if (k === pei || k === nei || E[k].cls !== 'ramp' || !this.fwy[k] || this.flow[k] === 0) continue;
      const q = this.flow[k], f = q > 0 ? E[k].a : E[k].b;
      if (f !== ni) continue;
      const qx = E[k].dx * q, qz = E[k].dz * q;
      if (ux * qx + uz * qz < 0.9) continue;
      const fn = this.city.nodes[q > 0 ? E[k].b : E[k].a], nn0 = this.city.nodes[ni];
      side = (fn.x - nn0.x) * -uz + (fn.z - nn0.z) * ux >= 0 ? 1 : -1;
    }
    if (!side) return -1;
    const iL = this.laneIdx(pei, psg, u)[0];            // from the left of travel
    const keep = side > 0 ? iL : nn - 1 - (np - 1 - iL);   // a right exit: by the left
    return this.laneUOf(nei, nsg, clamp(keep, 0, nn - 1));
  }

  // --- lane choice in town (Auto KW) ------------------------------------------
  //
  // See "Lane choice and left-turn bays" in apps/autokw/CLAUDE.md. A city car
  // on a street of two or more lanes its way moves into the lane its next
  // turn needs -- a left from the leftmost lane (a signal's left-turn bay
  // where it has one: bayRule), a right from the kerb lane -- signalling
  // first, one lane at a time, into a gap that asks nobody to brake hard
  // (cityLaneDecide). A driver who cannot get over in time gives the turn up
  // and goes another way (missTurn), so no turn is made across a lane.

  /** The lane of fraction u on edge ei driven `sign`, counted from the LEFT
   *  of travel: [i (-1 the left-turn bay), n (its through lanes), whether
   *  it has a bay]. (One array, reused.) */
  laneIdx(ei, sign, u) {
    const out = this._li || (this._li = [0, 1, false]);
    if (this.flow[ei] === 0) {
      const T = twoWayLayout(this.city.edges[ei]);
      if (!T) { out[0] = 0; out[1] = 1; out[2] = false; return out; }
      const n = sign > 0 ? T.nP : T.nM, bay = !!(sign > 0 ? T.yP : T.yM);
      out[0] = u < 0 ? (bay ? -1 : 0) : Math.min(n - 1, Math.floor(u * n)); out[1] = n; out[2] = bay;
      return out;
    }
    this.laneLatU(ei, sign, 0.5);
    const n = this.lanes[ei * 3 + 2], iab = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
    out[0] = sign > 0 ? iab : n - 1 - iab; out[1] = n; out[2] = false;
    return out;
  }

  /** The lane fraction of lane i (from the left of travel, -1 the bay) on
   *  edge ei driven `sign`. */
  laneUOf(ei, sign, i) {
    if (i < 0) return -0.5;
    if (this.flow[ei] === 0) {
      const T = twoWayLayout(this.city.edges[ei]);
      if (!T) return 0.5;
      const n = sign > 0 ? T.nP : T.nM;
      return (Math.min(i, n - 1) + 0.5) / n;
    }
    this.laneLatU(ei, sign, 0.5);
    const n = this.lanes[ei * 3 + 2], j = Math.min(i, n - 1);
    return ((sign > 0 ? j : n - 1 - j) + 0.5) / n;
  }

  /** Re-lay planned entry j (not the one being driven) in lane fraction u;
   *  the corners round it are the caller's to redo (routeVertex). */
  relaneOnly(v, j, u) {
    const rt = v.rt, o = j * RT_F, end = rt[o + R_END];
    this.routeEntry(v, o, rt[o + R_EI], rt[o + R_SG], u);
    rt[o + R_END] = end;
  }

  /** Is edge ei inside a junction controller's own box (a divided road's
   *  crossing: both its nodes the same signal's)? */
  inBox(ei) {
    if (!this.jc) return false;
    const e = this.city.edges[ei], ca = this.jc.ctl[e.a];
    return ca >= 0 && ca === this.jc.ctl[e.b];
  }

  /**
   * The turn made at the end of route entry j: 'L', 'S' or 'R', judged to
   * the first entry that leaves the junction there (a signal's box can span
   * a divided road's two carriageways); null if that is not planned yet. A
   * bend in a street is straight on, and so is the straightest way on where
   * the street itself bends at a junction.
   */
  turnAt(v, j) {
    const rt = v.rt, city = this.city, o = j * RT_F, ei = rt[o + R_EI], e = city.edges[ei];
    const ni = rt[o + R_SG] > 0 ? e.b : e.a;
    const ci = this.jc ? this.jc.ctl[ni] : -1, C = ci >= 0 ? this.jc.list[ci] : null;
    let k = j + 1;
    if (C && C.set) {
      while (k < v.rtN) {
        const q = city.edges[rt[k * RT_F + R_EI]];
        if (!(C.set.has(q.a) && C.set.has(q.b))) break;
        k++;
      }
    }
    if (k >= v.rtN) return null;
    const q = k * RT_F, ux = rt[o + R_UX], uz = rt[o + R_UZ], nx = rt[q + R_UX], nz = rt[q + R_UZ];
    const cos = ux * nx + uz * nz;
    if (cos > 0.7 || city.nodes[ni].e.length < 3) return 'S';
    if (cos > 0.25 && k === j + 1) {
      let best = -2;
      for (const k2 of city.nodes[ni].e) {
        if (k2 === ei) continue;
        const e2 = city.edges[k2], sg = e2.a === ni ? 1 : -1;
        if (!this.allowed(k2, sg) || e2.noTraffic) continue;
        best = Math.max(best, e2.dx * sg * ux + e2.dz * sg * uz);
      }
      if (cos >= best - 1e-6) return 'S';
    }
    return ux * nz - uz * nx > 0 ? 'R' : 'L';
  }

  /** The next turn on v's route within LC_PLAN: { j (the entry it is made
   *  at the end of), mv, d (m to that node) }, or null. (One object, reused.) */
  nextTurn(v, s0) {
    const rt = v.rt;
    let d = rt[R_LEN] - s0;
    for (let j = 0; j < v.rtN - 1; j++) {
      if (j > 0) d += rt[j * RT_F + R_LEN];
      if (d > LC_PLAN + 40) return null;
      if (j > 0 && this.inBox(rt[j * RT_F + R_EI])) continue;
      const mv = this.turnAt(v, j);
      if (mv === null) return null;
      if (mv !== 'S') {
        const nt = this._nt || (this._nt = { j: 0, mv: 'S', d: 0 });
        nt.j = j; nt.mv = mv; nt.d = d;
        return nt;
      }
    }
    return null;
  }

  /**
   * A LEFT-TURN BAY (arterial.js markBays): when the newest route entry k is
   * the first out of a signal that a bay runs into, and the move there is a
   * left, the bay's entries are re-laid in the bay -- where the bay opens,
   * from the inner lane (a car not in it moves over first: cityLaneDecide,
   * and its re-planned route comes back through here). Only planned entries
   * (>= 1): the one being driven changes lane by cityChangeLane.
   */
  bayRule(v, k) {
    const rt = v.rt, city = this.city;
    let j = k - 1;
    for (; j >= 1; j--) {
      const o = j * RT_F, e = city.edges[rt[o + R_EI]];
      const bay = rt[o + R_SG] > 0 ? e.bayP : e.bayM;
      if (bay) { if (bay.d0 > 0.5) return; break; }
      if (!this.inBox(rt[o + R_EI])) return;
    }
    if (j < 1) return;
    const o = j * RT_F;
    if (rt[o + R_U] < 0 || this.turnAt(v, j) !== 'L') return;
    const e = city.edges[rt[o + R_EI]], A = (rt[o + R_SG] > 0 ? e.bayP : e.bayM).A;
    // the bay's run back up the street (OSM splits it at crosswalks)
    let js = j;
    while (js - 1 >= 1) {
      const p = (js - 1) * RT_F, pe = city.edges[rt[p + R_EI]];
      const pb = rt[p + R_SG] > 0 ? pe.bayP : pe.bayM;
      if (!pb || pb.A !== A) break;
      js--;
    }
    // into it from the inner lane (or from the bay itself, upstream)
    const p = (js - 1) * RT_F;
    if (rt[p + R_U] >= 0 && this.laneIdx(rt[p + R_EI], rt[p + R_SG], rt[p + R_U])[0] !== 0) return;
    for (let jj = js; jj <= j; jj++) if (rt[jj * RT_F + R_U] >= 0) this.relaneOnly(v, jj, -0.5);
    for (let kk = js; kk < v.rtN; kk++) this.routeVertex(v, kk);
    this.stats.bayPlans = (this.stats.bayPlans || 0) + 1;
  }

  /** Change v's lane (the entry being driven) to fraction u, the rest of
   *  its route re-planned over the same turns (so a bay ahead is taken). */
  cityChangeLane(v, u) {
    const rt = v.rt, oldOff = rt[R_OFF];
    const keep = rt.slice(V_K, RT_F);   // the corner behind
    const fw = [];
    for (let k = 1; k < v.rtN; k++) fw.push({ ei: rt[k * RT_F + R_EI], sign: rt[k * RT_F + R_SG] });
    const endLast = rt[(v.rtN - 1) * RT_F + R_END];
    this.routeEntry(v, 0, rt[R_EI], rt[R_SG], u);
    rt.set(keep, V_K);
    v.laneU = u;
    v.rtN = 1;
    for (const f of fw) if (!this.routeExtend(v, f)) break;
    if (v.rtN === fw.length + 1) rt[(v.rtN - 1) * RT_F + R_END] = endLast;
    v.lcShift = (v.lcShift || 0) + oldOff - rt[R_OFF];
    v.lcRate = Math.max(0.8, Math.abs(v.lcShift) / LC_TIME);
    this.stats.cityLaneChanges = (this.stats.cityLaneChanges || 0) + 1;
  }

  /** Is lateral offset T (right of travel, from v's edge's centre line;
   *  lanes w wide) clear for v to move into: nothing alongside there, the
   *  car ahead in it far enough, the one behind not made to brake hard
   *  (fwyLane's tests). A car moving or signalling over counts where it is going. */
  cityLaneClear(v, T, w, sp, v0, aMax) {
    const rt = v.rt, ux = rt[R_UX], uz = rt[R_UZ];
    const e = this.city.edges[rt[R_EI]], na = this.city.nodes[rt[R_SG] > 0 ? e.a : e.b];
    const myLat = (v.x - na.x) * -uz + (v.z - na.z) * ux;
    const nb = [];
    for (const o of this.cars) {
      if (o === v || o.leader === v || o.mode === 'parked' || o.mode === 'apron' || o.mode === 'path' || o.mode === 'race') continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (dx * dx + dz * dz > 90 * 90 || Math.abs(o.y - v.y) > 3) continue;
      const fo = o.forward;
      if (fo.x * ux + fo.z * uz < 0.5) continue;
      const lat = myLat + dx * -uz + dz * ux;
      const q = o.leader || o;
      const tgt = q.lcShift ? lat - q.lcShift : q.lcSigOn ? lat + q.lcSigShift : lat;
      nb.push({ o, along: dx * ux + dz * uz, lat, tgt, v: o.vLong, len: o.halfLen });
    }
    return this.fwyLane(v, nb, T, w, myLat, sp, v0, aMax);
  }

  /** A turn given up: the route is cut at the junction, and re-planned there
   *  without the turn this lane cannot make (pickNextEdge). */
  missTurn(v, nt) {
    const rt = v.rt, o = nt.j * RT_F, e = this.city.edges[rt[o + R_EI]];
    const ni = rt[o + R_SG] > 0 ? e.b : e.a;
    const ci = this.jc ? this.jc.ctl[ni] : -1, C = ci >= 0 ? this.jc.list[ci] : null;
    const li = this.laneIdx(rt[o + R_EI], rt[o + R_SG], rt[o + R_U]);
    v.lcMiss = C && C.set ? C.set : new Set([ni]);
    v.lcMissSeen = false;
    v.lcMissUX = rt[o + R_UX]; v.lcMissUZ = rt[o + R_UZ];
    // (a left from a bay approach is the bay's alone)
    v.lcMissL = li[2] ? li[0] === -1 : li[0] <= 0; v.lcMissR = li[0] >= li[1] - 1;
    this.cutRoute(v, nt.j);
    v.lcSigOn = false; v.lcSigT = 0;
    this.stats.turnsMissed = (this.stats.turnsMissed || 0) + 1;
  }

  /** A city driver's lane choice, every LC_TICK s (driveTraffic). */
  cityLaneDecide(v, s0, sp, v0, aMax) {
    const rt = v.rt, city = this.city;
    const stopSig = () => { v.lcSigOn = false; v.lcSigT = 0; };
    // a junction given up, once it is behind
    if (v.lcMiss) {
      const e = city.edges[rt[R_EI]], on = v.lcMiss.has(e.a) || v.lcMiss.has(e.b);
      if (on) v.lcMissSeen = true;
      else if (v.lcMissSeen) v.lcMiss = null;
    }
    if (v.lcShift) return stopSig();
    // still in the corner behind, or in a junction
    if ((rt[V_K] === 1 && s0 < rt[V_B] + rt[V_T]) || this.inBox(rt[R_EI])) return stopSig();
    // plan as far ahead as a driver looks for the turn
    let d = rt[R_LEN] - s0;
    for (let j = 1; j < v.rtN; j++) d += rt[j * RT_F + R_LEN];
    while (d < LC_PLAN && v.rtN < RT_MAX && this.routeExtend(v)) d += rt[(v.rtN - 1) * RT_F + R_LEN];
    const nt = this.nextTurn(v, s0);
    if (!nt) return stopSig();
    const ei = rt[R_EI], sign = rt[R_SG];
    const li = this.laneIdx(ei, sign, rt[R_U]);
    const cur = li[0], n = li[1];
    let want = nt.mv === 'R' ? n - 1 : 0;
    if (nt.mv === 'L' && li[2]) {
      // a bay under us that runs to the turn: into the bay
      const e = city.edges[ei], A = (sign > 0 ? e.bayP : e.bayM).A;
      let ok = true;
      for (let j = 1; j <= nt.j && ok; j++) {
        const qe = city.edges[rt[j * RT_F + R_EI]], qb = rt[j * RT_F + R_SG] > 0 ? qe.bayP : qe.bayM;
        ok = !!qb && qb.A === A;
      }
      if (ok) want = -1;
    }
    if (cur === want) return stopSig();
    // too late to get over: carry on, and turn somewhere else (once)
    if (nt.d < LC_LATE0 + LC_LATE_T * sp) {
      const o = nt.j * RT_F, ne = city.edges[rt[o + R_EI]], ni = rt[o + R_SG] > 0 ? ne.b : ne.a;
      if (!(v.lcMiss && v.lcMiss.has(ni))) this.missTurn(v, nt);
      return stopSig();
    }
    const dir = want > cur ? 1 : -1;   // +1 to the right
    const u = this.laneUOf(ei, sign, cur + dir);
    const T = this.laneLatU(ei, sign, u);
    // SIGNAL FIRST: LC_SIG s of it (cars behind in that lane may ease off
    // to let it in: driveTraffic's scan), then over when there is a gap
    if (!v.lcSigOn || v.lcSigDir !== dir) { v.lcSigOn = true; v.lcSigDir = dir; v.lcSigT = 0; }
    v.lcSigShift = T - rt[R_OFF];
    if (v.lcSigT < LC_SIG || sp < 1.5) return;
    const tw = this.flow[ei] === 0 ? twoWayLayout(city.edges[ei]) : null;
    const w = tw ? tw.w : this.laneInfo(ei).w;
    if (!this.cityLaneClear(v, T, w, sp, v0, aMax)) return;
    this.cityChangeLane(v, u);
    stopSig();
  }

  /**
   * A SLIP LANE'S MERGE (Auto KW): on a ramp whose route runs into a city
   * street at a merge (not across it) with no control at the join, the
   * merging car gives way: to any car whose route comes through the join
   * node by another way -- into the lane it is joining, or across it --
   * within SLIP_GAP s of this car's getting there. Returns the distance to
   * stop in short of the join, or Infinity. (A freeway merge is
   * fwyMergeGap's; a yield or stop at the join is junctionStop's.)
   */
  slipMerge(v, sp, s0) {
    const rt = v.rt, city = this.city;
    let j = 1, d = rt[R_LEN] - s0;
    for (; j < v.rtN && j < 4; j++) {
      if (city.edges[rt[j * RT_F + R_EI]].cls !== 'ramp') break;
      d += rt[j * RT_F + R_LEN];
    }
    if (j >= v.rtN || j >= 4 || d > 90) return Infinity;
    const q = j * RT_F, tei = rt[q + R_EI];
    if (city.edges[tei].cls === 'hwy') return Infinity;
    const p = (j - 1) * RT_F, pe = city.edges[rt[p + R_EI]];
    const M = rt[p + R_SG] > 0 ? pe.b : pe.a;
    if (this.jc && this.jc.ctl[M] >= 0) return Infinity;
    if (rt[p + R_UX] * rt[q + R_UX] + rt[p + R_UZ] * rt[q + R_UZ] < 0.3) return Infinity;
    // at the join and rolling: committed
    if (d < 1.5 && sp > 2) return Infinity;
    const myKey = rt[p + R_EI] * 2 + (rt[p + R_SG] > 0 ? 1 : 0);
    const tMe = d / Math.max(sp, 3), T = rt[q + R_OFF], tsg = rt[q + R_SG];
    const n = city.nodes[M], fx = rt[q + R_UX], fz = rt[q + R_UZ];
    for (const o of this.cars) {
      if (o === v || o.mode === 'parked' || o.mode === 'apron' || o.mode === 'trailer') continue;
      if (Math.abs(o.y - v.y) > 3) continue;
      const dx = n.x - o.x, dz = n.z - o.z;
      if (dx * dx + dz * dz > 150 * 150) continue;
      let dO = null;
      if (o.rt && o.rtN) {
        // along its route to the join
        const ort = o.rt;
        let dd = ort[R_LEN] - ((o.x - ort[R_QX]) * ort[R_UX] + (o.z - ort[R_QZ]) * ort[R_UZ]);
        for (let k = 0; k < o.rtN; k++) {
          const oo = k * RT_F;
          if (k > 0) dd += ort[oo + R_LEN];
          if (dd > 150) break;
          const oe = city.edges[ort[oo + R_EI]];
          if ((ort[oo + R_SG] > 0 ? oe.b : oe.a) !== M) continue;
          if (ort[oo + R_EI] * 2 + (ort[oo + R_SG] > 0 ? 1 : 0) === myKey) break;   // behind me on the slip
          // on into the street I join, but in another lane of it: not in my way
          if (k + 1 < o.rtN && ort[oo + RT_F + R_EI] === tei && ort[oo + RT_F + R_SG] === tsg && Math.abs(ort[oo + RT_F + R_OFF] - T) > 1.6) break;
          // ...or the other way down a two-way street, staying on its side
          if (ort[oo + R_UX] * fx + ort[oo + R_UZ] * fz < -0.3 && (k + 1 >= o.rtN || ort[oo + RT_F + R_UX] * fx + ort[oo + RT_F + R_UZ] * fz < -0.3)) break;
          dO = dd;
          break;
        }
      } else if (o.forward.x * fx + o.forward.z * fz > 0.7) {
        // a driven car (yours) coming down the street I join, in my lane
        const lat = (o.x - n.x) * -fz + (o.z - n.z) * fx;
        if (Math.abs(lat - T) < 2.4) dO = dx * fx + dz * fz;
      }
      if (dO === null || dO < -(o.halfLen + 3)) continue;
      const so = Math.abs(o.vLong);
      // standing well back (a queue at a light): not coming yet
      if (so < 1 && dO > 10) continue;
      if (dO / Math.max(so, 1) < tMe + SLIP_GAP) return Math.max(0, d - v.halfLen - 1.0);
    }
    return Infinity;
  }

  /** Plan one more entry onto the end of v's route. False at a dead end.
   *  `forced` ({ ei, sign }) re-plans a turn already chosen (cityChangeLane). */
  routeExtend(v, forced = null) {
    const rt = v.rt, city = this.city, o = (v.rtN - 1) * RT_F;
    if (rt[o + R_END] || v.rtN >= RT_MAX) return false;
    const ei = rt[o + R_EI], sign = rt[o + R_SG], e = city.edges[ei];
    const node = sign > 0 ? e.b : e.a;
    // (a police unit in pursuit takes its A* path's turns)
    const nx = forced || (v.unit && v.mode === 'police' ? this.pursuitEdge(v, ei, sign, node) : this.pickNextEdge(v, ei, sign, node));
    if (!nx) { rt[o + R_END] = 1; return false; }
    const ne = city.edges[nx.ei];
    const pux = rt[o + R_UX], puz = rt[o + R_UZ], nux = ne.dx * nx.sign, nuz = ne.dz * nx.sign;
    const cos = pux * nux + puz * nuz, crs = pux * nuz - puz * nux;
    // Straight on: the nearest lane. A turn: the same share of the width.
    // (out of a left-turn bay: the leftmost lane)
    let u = rt[o + R_U];
    if (u < 0) u = this.laneUOf(nx.ei, nx.sign, 0);
    const tw2 = this.flow[nx.ei] === 0 ? twoWayLayout(ne) : null;
    if (cos > 0.94 && (this.flow[nx.ei] !== 0 || tw2)) {
      // (across a freeway gore: the lane lines where they meet, shifts and all)
      const gp = this.fwy[ei] ? this.goreOf(ei, sign) : null, gn = this.fwy[nx.ei] ? this.goreOf(nx.ei, nx.sign) : null;
      const gt = this.fwy[ei] && rt[o + R_U] >= 0 ? this.goreThrough(ei, sign, rt[o + R_U], nx.ei, nx.sign, node) : -1;
      u = gt >= 0 ? gt : this.nearestLaneU(nx.ei, nx.sign, rt[o + R_OFF] + (gp ? gp[1] : 0) - (gn ? gn[0] : 0));
    }
    else if (tw2) {
      // ONTO A MULTI-LANE TWO-WAY ARTERIAL, by the rule of the road: a right
      // turn into the kerb lane, a left turn into the lane nearest the centre
      const n = nx.sign > 0 ? tw2.nP : tw2.nM;
      u = crs > 0 ? (n - 0.5) / n : 0.5 / n;
    }
    this.routeEntry(v, o + RT_F, nx.ei, nx.sign, u);
    this.routeVertex(v, v.rtN);
    v.rtN++;
    // a left turn planned out of a signal's left-turn bay: into the bay
    if (this.jc && !v.unit && v.mode === 'traffic') this.bayRule(v, v.rtN - 1);
    return true;
  }

  /** Entry k's vertex (the corner from entry k - 1 onto it), from the two
   *  lines as they are now. */
  routeVertex(v, k) {
    const rt = v.rt, city = this.city, o = (k - 1) * RT_F, q = k * RT_F;
    const e = city.edges[rt[o + R_EI]];
    const node = rt[o + R_SG] > 0 ? e.b : e.a;
    const pux = rt[o + R_UX], puz = rt[o + R_UZ], nux = rt[q + R_UX], nuz = rt[q + R_UZ];
    const cos = pux * nux + puz * nuz, crs = pux * nuz - puz * nux;
    // THE VERTEX: where the two lanes' centre lines cross (a on the old line,
    // b on the new), rounded by an arc of radius R that touches both lines t
    // either side of it. A junction's corner is at most JR_RIGHT / JR_LEFT
    // (a left turn swings wide, across the junction); a bend in a street is
    // whatever its segments leave room for.
    const plen = rt[o + R_LEN], nlen = rt[q + R_LEN];
    const th = Math.acos(clamp(cos, -1, 1));
    rt[q + V_K] = 2; rt[q + V_A] = plen; rt[q + V_B] = 0; rt[q + V_T] = 0; rt[q + V_TH] = 0;
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
    // (weather.js: slower round the corners in the wet, a lot in snow --
    // WXK.aiLat and .ai are exactly 1 when dry, so a clear day is unchanged)
    const aLat = (v.unit ? A_LAT_POLICE : A_LAT) * WXK.aiLat, unit = !!v.unit;
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
      if (!unit) cons(rt[q + R_SPD] * v.drvK * WXK.ai, d);
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
      // A CORNER SHARPER THAN 90 DEG never reaches its vertex along the old
      // line: the arc's farthest point along it is (a - t) + R, and t = R
      // tan(th / 2) > R. The car went round the arc, never moved on, chased a
      // pursuit point it could not pass and circled in the junction for
      // minutes (Gildner St onto Park St, stop sign 3701: a 100 deg left, a
      // 5 m circle until a car on Park St hit it). There it moves on at the
      // arc's middle, where the old line's projection is (a - t) + R sin(th / 2).
      const thr = rt[q + V_K] !== 1 ? rt[R_LEN]
        : rt[q + V_TH] > Math.PI / 2 ? rt[q + V_A] - rt[q + V_T] + rt[q + V_R] * Math.sin(rt[q + V_TH] / 2) : rt[q + V_A];
      if (s0 < thr) break;
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
    // A LANE CHANGE (fwyDecide): the route is already the new lane's, and
    // lcShift is how far right of it the car still is; it runs out at lcRate
    // m/s, and the pursuit point carries what is left by the time it is reached.
    if (v.lcShift) {
      const d = v.lcRate * dt;
      v.lcShift = Math.abs(v.lcShift) <= d ? 0 : v.lcShift - Math.sign(v.lcShift) * d;
      const lc = this.lcAt(v, L, sp);
      P.x -= rt[R_UZ] * lc; P.z += rt[R_UX] * lc;
    }
    const ddx = P.x - v.x, ddz = P.z - v.z, ld = Math.hypot(ddx, ddz) || 1;
    const alpha = angleWrap(Math.atan2(ddx, ddz) - v.heading);
    // Far off the path's heading (a U-turn, a car shunted round): full lock.
    inp.steer = Math.abs(alpha) > 1.3 ? Math.sign(alpha) : v.aiSteer((2 * Math.sin(alpha)) / ld);
    // BACKING OUT OF A WEDGE (set below), wheel reversed so the nose comes
    // round to the path, then a fresh route from where it ends up. A crash
    // that spins a car can leave it nose-in to another or to a post at an
    // angle no amount of throttle gets past; it used to sit there for good in
    // sight (only out of sight is a wedged car recycled).
    if (v.backT > 0) {
      v.backT -= dt;
      if (v.backT <= 0) this.reroute(v);
      // (at a walking pace: held in reverse for the whole 1.2 s a car backed
      // out at up to 6 m/s into whatever queued behind it)
      inp.brake = v.vLong > -2 ? 1 : 0; inp.steer = -clamp(alpha * 1.7, -1, 1);
      return inp;
    }

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
    let v0 = v.unit ? v.pursuitV : rt[R_SPD] * v.drvK * (v.panic > 0 ? 1.5 : 1) * yieldK * WXK.ai;
    if (v.spec.hand === 'semi') v0 = Math.min(v0, SEMI_V);
    let aWant = Math.min(aRoad, Math.abs(alpha) > 1.3 ? (9 - sp * sp) / 6 : Infinity);
    const heavy = v.spec.bus || v.spec.cargo;
    // (a unit in pursuit puts its foot down; so does the Hellcat, always)
    const aMax = v.unit ? 4.5 : v.spec.hellcat ? 5.5 : heavy ? 1.3 : 2.0;
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
      if (v.lcShift) { const lc = this.lcAt(v, D, sp); P.x -= rt[R_UZ] * lc; P.z += rt[R_UX] * lc; }
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
    // (the driver's own position and heading, read once: nothing in the scan
    // moves it, and this loop runs over all ~220 vehicles for every driver)
    const vx = v.x, vy = v.y, vz = v.z, fx = f.x, fz = f.z;
    for (const o of this.cars) {
      if (o === v) continue;
      // A car on another deck is not ahead of you. In SR-99's stacked bore the
      // other direction runs DECK_SEP overhead or underneath on the same
      // line, and the plan-only scan braked every car for oncoming traffic on
      // the other deck: stopped queues mid-bore. Same 3 m band the car-car
      // collision uses.
      if (Math.abs(o.y - vy) > 3) continue;
      const rx = o.x - vx, rz = o.z - vz;
      if (rx * rx + rz * rz > reach2) continue;
      const fwd = rx * fx + rz * fz;
      if (fwd < -2) continue;
      // Something standing still (a kerbside car, a settled apron vehicle)
      // only matters close in, to be dodged: most of the list is parked
      // cars, and walking the path for each one was the cost of this scan.
      if (fwd > 25 && (o.mode === 'parked' || o.mode === 'apron' || (o.mode === 'free' && Math.abs(o.vLong) < 0.5))) continue;
      // nearest point of the sampled path: how far along it, how far off it
      let best = Infinity, along = 0, acc = 0, sdx = fx, sdz = fz, sax = vx, saz = vz;
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
      // A CAR CHANGING LANES INTO MINE (freeway, fwyDecide) is in my lane
      // already: judged where it is going (its position less what is left of
      // its shift), not where it is, so I ease off as it starts over.
      if (best > wid * wid && o.lcShift && o.rt) {
        const tx = o.x + o.rt[R_UZ] * o.lcShift, tz = o.z - o.rt[R_UX] * o.lcShift;
        for (let k = 0; k < np - 1; k++) {
          const ax = ps[2 * k], az = ps[2 * k + 1], sx = sg[3 * k], sz = sg[3 * k + 1], l = sg[3 * k + 2];
          let t = ((tx - ax) * sx + (tz - az) * sz) / (l * l);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = tx - ax - sx * t, ez = tz - az - sz * t;
          if (ex * ex + ez * ez <= wid * wid) { best = ex * ex + ez * ez; break; }
        }
      }
      // A CAR SIGNALLING INTO MY LANE (cityLaneDecide) ahead of me: most
      // drivers ease off to let it in (as behind a leader, where it will be)
      if (best > wid * wid && o.lcSigOn && o.mode === 'traffic' && hash2(v.prio, 29) < COURTESY_P) {
        const tx = o.x - fo.z * o.lcSigShift, tz = o.z + fo.x * o.lcSigShift;
        for (let k = 0; k < np - 1; k++) {
          const ax = ps[2 * k], az = ps[2 * k + 1], sx = sg[3 * k], sz = sg[3 * k + 1], l = sg[3 * k + 2];
          let t = ((tx - ax) * sx + (tz - az) * sz) / (l * l);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = tx - ax - sx * t, ez = tz - az - sz * t;
          if (ex * ex + ez * ez <= wid * wid) { best = ex * ex + ez * ez; this.stats.courtesy = (this.stats.courtesy || 0) + 1 / 60; break; }
        }
      }
      if (best > wid * wid) {
        // CROSS TRAFFIC: a driven car crossing my path that will be where I
        // am going when I get there. Whoever gets there first goes; on a tie
        // the older car. Predicted along its heading at 0.8 / 1.6 / 2.4 s.
        // (a unit with its lights on yields to nobody)
        // (one braking for its own red or stop sign is not crossing: ctlHold)
        if (!v.unit && Math.abs(co) < 0.5 && Math.abs(o.vLong) > 1.5 && !(o.ctlHold && o.mode === 'traffic') && (o.mode === 'traffic' || o.mode === 'police' || o === player.vehicle)) {
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
        || (v.unit && (o.mode === 'traffic' || o.mode === 'suspect') && Math.abs(o.vLong) < v.pursuitV * 0.6)) && o !== player.vehicle && along < 25) {
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
      // A RING OF THEM TOO: after a crash at a junction the waiting can run
      // round three or four cars (A on B, B on C, C on A), which the pair
      // test never saw -- measured, 1st Ave S, a queue of eight for good.
      // Walked along the leads: if it comes back to this car through cars
      // all younger and all stopped, this one is the oldest and goes.
      // ...BUT NEVER THROUGH IT: only where its body leaves my way room to
      // pass (a body width, not the scan's margin). Where it does not (two
      // opposing lefts stopped across each other's ways in a skewed box),
      // the younger one is told to make way (`mkWay`) and goes first if ITS
      // way is clear of me; neither clear, both wait (and back out, below).
      // The older one used to drive on regardless: a 4 m/s scrape at signal
      // 849.
      if (o.prio > v.prio && Math.abs(o.vLong) < 1 && this.waitsOn(o, v)) {
        const room = v.halfWid + ext + 0.1;
        if (best > room * room) continue;
        o.mkWay = v; o.mkWayT = this._tick;
        this.stats.gridBlocked = (this.stats.gridBlocked || 0) + dt;
      }
      if (v.mkWay === o && this._tick - v.mkWayT <= 3 && o.prio < v.prio && Math.abs(o.vLong) < 1) {
        const room = v.halfWid + ext + 0.1;
        if (best > room * room) { this.stats.gridMadeWay = (this.stats.gridMadeWay || 0) + dt; continue; }
      }
      const g = along - v.halfLen - (o.halfLen * Math.abs(co) + o.halfWid * so);
      if (g < gap) { gap = g; vLead = o.vLong * co; lead = o; }
    }
    // A CITY LANE THAT ENDS AT A NODE: two lanes of a one-way street going on
    // into fewer (Erb St W at signal 384: two lanes into one, both cars'
    // lines jumping to the one lane at the node). Freeway merges have
    // fwyMergeGap; city cars drove on abreast and side-swiped where the lanes
    // met. A car whose lane line jumps sideways at the end of this edge gives
    // way to a car on the same edge bound for the same lane that is ahead of
    // it (or abreast and older): behind it as a leader, or abreast, stopped
    // short of the node until it has gone.
    // (a multi-lane two-way arterial's lanes too: arterial.js twoWayLayout)
    if (v.rtN >= 2 && (this.flow[v.edge] !== 0 || twoWayLayout(this.city.edges[v.edge])) && !v.unit && !this.fwy[v.edge]) {   // (freeway lanes that end: fwyDecide's dropT)
      const q = RT_F, toNode = rt[R_LEN] - s0;
      const jump = Math.abs(rt[q + R_OFF] - rt[R_OFF]);
      if (jump > 0.9 && toNode < 50 && toNode > -2 && rt[R_UX] * rt[q + R_UX] + rt[R_UZ] * rt[q + R_UZ] > 0.94) {
        for (const o of this.cars) {
          if (o === v || o.edge !== v.edge || o.dirSign !== v.dirSign || !o.rt || o.rtN < 2 || o.mode !== 'traffic') continue;
          const ort = o.rt;
          if (ort[q + R_EI] !== rt[q + R_EI] || ort[q + R_SG] !== rt[q + R_SG] || Math.abs(ort[q + R_OFF] - rt[q + R_OFF]) > 1.2) continue;
          if (Math.abs(ort[R_OFF] - rt[R_OFF]) < 1.2) continue;   // in my lane: the path scan has it
          const os0 = (o.x - ort[R_QX]) * ort[R_UX] + (o.z - ort[R_QZ]) * ort[R_UZ];
          const ds = os0 - s0, len = v.halfLen + o.halfLen;
          if (ds < -0.3 || (ds <= 0.3 && o.prio > v.prio)) continue;   // behind me (or abreast and younger): it gives way
          const g = ds > len + 1.5 ? ds - len : Math.max(0, toNode - v.halfLen - 1.5);
          if (g < gap) { gap = g; vLead = ds > len + 1.5 ? o.vLong : 0; lead = o; this.stats.cityMerges = (this.stats.cityMerges || 0) + dt; }
        }
      }
    }
    // ON A FREEWAY RAMP, the merge ahead: slot in behind whatever on the main
    // line will reach the merge first (fwyMergeGap), as a leader.
    if (this.fwy[v.edge] && this.city.edges[v.edge].cls === 'ramp' && !v.unit) {
      const m = this.fwyMergeGap(v, sp);
      if (m && m.gap < gap) { gap = m.gap; vLead = m.vL; this.stats.mergeYields += dt; }
    }
    // a freeway lane ending ahead with no gap to move over into (fwyDecide):
    // its end is a standing leader until one opens
    if (v.dropT > 0 && v.dropX != null) {
      v.dropT -= dt;
      const dd = (v.dropX - v.x) * rt[R_UX] + (v.dropZ - v.z) * rt[R_UZ];
      if (dd > 0 && dd - v.halfLen - 2 < gap) { gap = dd - v.halfLen - 2; vLead = 0; this.stats.dropWaits = (this.stats.dropWaits || 0) + dt; }
    }
    v.lead = lead;
    v.leadGap = gap; v.leadV = vLead;
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
        if (fr.blocks(v.x + f.x * d, v.z + f.z * d, v.y, v)) { stopAt = Math.min(stopAt, d - 4); break; }
      }
    }
    // A streetcar standing at its stop, or crossing ahead: queue behind it
    // (counterbalance.js)
    const sc = this.streetcars;
    if (sc && sc.ok && sc.near(v.x, v.z)) {
      for (let d = 3; d <= look; d += 3) {
        if (sc.blocks(v.x + f.x * d, v.z + f.z * d, v.y, v)) { stopAt = Math.min(stopAt, d - 4); break; }
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
    // PEOPLE CROSSING THE ROAD (peds.js planNode): stop short of one in the
    // lane ahead. Only those actually in the carriageway count -- one waiting
    // at the kerb waits for the cars -- so a queue is held for the seconds a
    // crossing takes, not for ever.
    if (this.crossN > 0) {
      const reach = Math.max(10, sp * sp / 12 + sp * 0.6 + 5), xz = this.crossXZ;
      for (let q = 0; q < this.crossN; q++) {
        const cx = xz[q * 3], cz = xz[q * 3 + 1];
        // (on the level he is on: a viaduct over the crossing does not stop for him)
        if (Math.abs(xz[q * 3 + 2] - v.y) > 3 || Math.abs(cx - v.x) > reach + 4 || Math.abs(cz - v.z) > reach + 4) continue;
        // along the PLANNED PATH, not the bonnet's line: a car turning at the
        // junction is not yet pointing at the crossing it will sweep across
        let best = Infinity, along = 0, acc = 0;
        for (let k = 0; k < np - 1; k++) {
          const ax = ps[2 * k], az = ps[2 * k + 1], sx = sg[3 * k], sz = sg[3 * k + 1], l = sg[3 * k + 2];
          let t = ((cx - ax) * sx + (cz - az) * sz) / (l * l);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = cx - ax - sx * t, ez = cz - az - sz * t, dd = ex * ex + ez * ez;
          if (dd < best) { best = dd; along = acc + t * l; }
          acc += l;
        }
        const wid = v.halfWid + 1.2;
        const rx = cx - v.x, rz = cz - v.z, fwd = rx * f.x + rz * f.z;
        // (and at the nose, wider, whatever the path says)
        const nose = fwd > -0.5 && fwd < v.halfLen + 3.5 && Math.abs(rx * f.z - rz * f.x) < v.halfWid + 2.4;
        if (!nose && (best > wid * wid || along > reach)) continue;
        const g = nose ? Math.max(fwd, 0) : along;
        stopAt = Math.min(stopAt, g - v.halfLen - 1.2);
        if (g < sp * sp / 12 + 4) urgent = true;
      }
    }
    // SCHOOL BUSES (schoolbus.js): a school bus's own stops, and every car's
    // duty to stop 20 m short of one whose reds flash
    if (this._sbOn) {
      if (v.spec.hand === 'schoolbus') {
        const s = this.sb.busDrive(v, s0, sp, dt, rt, SB_R);
        v.sbHold = s === 0 && v.sb.phase >= 2;
        if (s < stopAt) stopAt = s;
      } else v.sbHold = false;
      if (this.sb.list.length && !v.unit) {
        const s = this.sb.obey(v, ps, sg, np);
        if (s < Infinity) { v.sbHold = true; this.stats.sbHolds = (this.stats.sbHolds || 0) + dt; }
        if (s < stopAt) stopAt = s;
      }
    }
    // JUNCTION CONTROLS (junctions.js): a red, a stop sign, a roundabout's
    // circulating traffic -- the next controlled junction on the route says
    // where to stop, if anywhere.
    v.ctlHold = false;
    let jStop = Infinity;
    if (this.jc && !v.unit && v.mode === 'traffic') {
      jStop = this.junctionStop(v, s0, sp, player);
      // a slip lane's merge into a city street gives way (slipMerge)
      if (this.city.edges[v.edge].cls === 'ramp') {
        const m = this.slipMerge(v, sp, s0);
        if (m < jStop) { jStop = m; this.stats.slipYields = (this.stats.slipYields || 0) + dt; }
      }
      if (jStop < stopAt) v.ctlHold = true;
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
    // A junction's line is driven UP TO, not just stopped short of: braking
    // as for anything else ends wherever the speed runs out (metres short of
    // a stop sign's line, where it never counts as stopped), so below the
    // speed that can still stop at it (2 m/s^2) it creeps on.
    if (jStop < Infinity) {
      const vt = Math.sqrt(4 * Math.max(0, jStop - 0.4));
      aWant = Math.min(aWant, jStop <= 0.3 ? -9 : sp > vt ? -(sp * sp) / (2 * Math.max(jStop, 0.31)) : Math.min(aMax, (vt - sp) * 1.2));
    }
    if (urgent) aWant = Math.min(aWant, -v.spec.brakeA);
    aWant = Math.max(aWant, -v.spec.brakeA);
    // At a standstill the brake is reverse gear: a stopped car HOLDS (the
    // parking brake) until it wants to go again, with a little hysteresis.
    if (v.held ? aWant < 0.4 : (sp < 0.8 && aWant < 0)) { v.held = true; inp.park = true; }
    else { v.held = false; v.aiPedals(aWant, inp); }
    v.wantGo = aWant > 0.5 && stopAt === Infinity && jStop === Infinity;
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
    // three seconds of that: back out (above), once per wedge -- not with
    // a section or a trailer behind, which only jackknifes
    if (v.stuckT > 3 && v.stuckT - dt <= 3 && !v.trailer) v.backT = 1.2;
    // TOLD TO MAKE WAY (the gridlock rule, above) by an older car my body
    // blocks, while it blocks my own way too: neither can pass, so after
    // 2.5 s I back off a little -- only with room behind me -- and plan
    // afresh from there (backT). Before, the older one drove through me.
    if (v.mkWay && this._tick - v.mkWayT <= 3 && v.lead === v.mkWay && Math.abs(v.vLong) < 0.5 && !v.trailer) {
      v.mkWaitT = (v.mkWaitT || 0) + dt;
      if (v.mkWaitT > 2.5 && this.roomBehind(v, 4)) { v.backT = 1.2; v.mkWaitT = 0; this.stats.gridBackOut = (this.stats.gridBackOut || 0) + 1; }
    } else v.mkWaitT = 0;
    // ...and anything standing for 20 s out of sight, whatever it waits on:
    // there are no signals to wait at, so a car that long at rest is queued
    // behind a wedge or a gridlock of three or more, and the queue goes with it.
    // (waiting at a red or a stop sign is not that: the light changes)
    if (Math.abs(v.vLong) < 0.5) v.restT += v.ctlHold || v.sbHold ? dt * 0.2 : dt; else v.restT = 0;
    if ((v.stuckT > 8 || v.restT > 20) && dist2(v.x, v.z, px, pz) > 120 * 120) { this.stats.stuckRecycled++; v.recycle = true; }
    // FREEWAY DRIVING: lane changes, exits (fwyDecide), on freeway edges only
    if (this.fwy[v.edge] && !v.unit) {
      v.lcSigOn = false;
      if (v.lcCool > 0) v.lcCool -= dt;
      v.lcT = (v.lcT || 0) - dt;
      if (v.lcT <= 0) {
        v.lcT = 0.45 + 0.3 * hash2(v.prio, 17);
        this.fwyDecide(v, s0, sp, v0, aMax);
      }
    } else if (!v.unit && v.mode === 'traffic') {
      // LANE CHOICE IN TOWN: into the lane the next turn needs (cityLaneDecide)
      if (v.lcSigOn) v.lcSigT += dt;
      v.clT = (v.clT || 0) - dt;
      if (v.clT <= 0) {
        v.clT = LC_TICK + 0.2 * hash2(v.prio, 23);
        this.cityLaneDecide(v, s0, sp, v0, aMax);
      }
    }
    return inp;
  }

  // --- junction controls (Auto KW, junctions.js) ----------------------------
  //
  // See "Junctions" in apps/autokw/CLAUDE.md. Walks the planned route for the
  // next node with a controller that this car ARRIVES at by one of its
  // approaches (not from inside a signalled junction's own edges), and asks it
  // whether to go. Returns the gap (nose to stop line) to stop in, or
  // Infinity. A car that has decided to go on (crossed the line, an amber it
  // could not stop for, its turn at a stop sign) is committed to that approach
  // (`jcGo`) until the approach is behind it.
  junctionStop(v, s0, sp, player) {
    const jc = this.jc, rt = v.rt, city = this.city;
    const horizon = Math.max(45, (sp * sp) / 3 + 30);
    let d = rt[R_LEN] - s0, res = Infinity, seenGo = false;
    if (v.jcGo == null) { v.jcGo = -1; v.jcStop = -1; }
    for (let j = 0; j < v.rtN; j++) {
      const o = j * RT_F;
      if (j > 0) d += rt[o + R_LEN];
      if (d - 40 > horizon) break;
      const ei = rt[o + R_EI], sg = rt[o + R_SG], e = city.edges[ei];
      const ni = sg > 0 ? e.b : e.a;
      const ci = jc.ctl[ni];
      if (ci < 0) continue;
      const C = jc.list[ci], A = C.appr.get(ei * 2 + (sg > 0 ? 1 : 0));
      if (!A) continue;
      if (v.jcGo === A.id) { seenGo = true; continue; }
      const gap = d - A.back - v.halfLen - 0.3;
      if (gap < -2.5) continue;   // already over the line: in the box
      const r = jc.decide(this, v, C, A, this.moveAt(v, j, C), gap, sp, player);
      // (3: a left waiting for its way through -- held where it is, even
      // over its line: it is not too late to wait, as it is for a red)
      if (r === 1 || r === 3) {
        if (r === 1 && gap < -0.6) { v.jcGo = A.id; v.jcFrom = A.id; v.jcFromC = C.id; seenGo = true; continue; }   // too late: through
        res = Math.max(0, gap);
        break;
      }
      if (r === 2 || gap < 0.6) { v.jcGo = A.id; v.jcFrom = A.id; v.jcFromC = C.id; seenGo = true; }
      // nothing beyond this junction is decided before it is reached
      break;
    }
    if (!seenGo) v.jcGo = -1;
    return res;
  }

  /** The turn v makes at the end of route entry j ('L', 'S', 'R'): from
   *  its direction there to the first entry that leaves controller C. */
  moveAt(v, j, C) {
    const rt = v.rt, o = j * RT_F;
    let k = j + 1;
    if (C.set) {
      while (k < v.rtN) {
        const e = this.city.edges[rt[k * RT_F + R_EI]];
        if (!(C.set.has(e.a) && C.set.has(e.b))) break;
        k++;
      }
    }
    if (k >= v.rtN) { k = j + 1; if (k >= v.rtN) return 'S'; }
    const q = k * RT_F;
    const ux = rt[o + R_UX], uz = rt[o + R_UZ], nx = rt[q + R_UX], nz = rt[q + R_UZ];
    const cos = ux * nx + uz * nz, crs = ux * nz - uz * nx;
    if (cos > 0.7) return 'S';
    return crs > 0 ? 'R' : 'L';
  }

  // --- freeway driving (Auto KW) -------------------------------------------
  //
  // See "Freeway driving" in apps/autokw/CLAUDE.md. Everything here runs only
  // for a traffic car on a freeway edge (this.fwy): city traffic is untouched.

  /** Lane layout of one-way edge ei: lo, hi (a -> b right), count, width. */
  laneInfo(ei) {
    this.laneLatU(ei, 1, 0.5);
    const L = this.lanes, k = ei * 3, n = L[k + 2];
    return { lo: L[k], n, w: (L[k + 1] - L[k]) / n };
  }

  /** What is left of a lane change's shift D metres ahead at speed sp. */
  lcAt(v, D, sp) {
    const s = v.lcShift;
    if (!s) return 0;
    const rem = Math.abs(s) - (v.lcRate * D) / Math.max(sp, 4);
    return rem > 0 ? Math.sign(s) * rem : 0;
  }

  /** A freeway spawn: the lane (a semi's among the right two), clear 45 m
   *  ahead and behind (60 for a semi's trailer). { u, off } or null. */
  fwySpawn(ei, sign, laneU, tn, x, z) {
    const e = this.city.edges[ei], LI = this.laneInfo(ei);
    let i = Math.min(LI.n - 1, Math.floor(laneU * LI.n));
    if (tn === 'semi' && LI.n >= 3) {
      const fromR = sign > 0 ? LI.n - 1 - i : i;
      if (fromR > 1) { const r = this._prio & 1; i = sign > 0 ? LI.n - 1 - r : r; }
    }
    let off = (LI.lo + (i + 0.5) * LI.w) * sign;
    const fx = e.dx * sign, fz = e.dz * sign, rx = -fz, rz = fx;
    // (on a ramp at a gore: its lane where the gore shift lays it)
    const g = this.goreOf(ei, sign);
    if (g) {
      const na = this.city.nodes[sign > 0 ? e.a : e.b];
      const tt = clamp(((x - na.x) * fx + (z - na.z) * fz) / e.len, 0, 1);
      off += g[0] + (g[1] - g[0]) * tt;
    }
    const qx = x + rx * off, qz = z + rz * off;
    const back = tn === 'semi' ? 62 : 45;
    for (const o of this.cars) {
      const dx = o.x - qx, dz = o.z - qz;
      if (dx * dx + dz * dz > 70 * 70) continue;
      const al = dx * fx + dz * fz, lat = dx * rx + dz * rz;
      if (al > -back && al < 45 && Math.abs(lat) < 3.2) { this.stats.fwySpawnBlocked++; return null; }
    }
    return { u: (i + 0.5) / LI.n, off };
  }

  /** The way on along the freeway from nodeId: the continuing carriageway
   *  (at a fork of two, either, by a hash), or null to let pickNextEdge choose. */
  fwyOn(v, fromEi, fromSign, nodeId) {
    const city = this.city, fe = city.edges[fromEi];
    const fx = fe.dx * fromSign, fz = fe.dz * fromSign, comp = this.comp[nodeId];
    let best = null, bs = -Infinity;
    for (const ei of city.nodes[nodeId].e) {
      if (ei === fromEi) continue;
      const ne = city.edges[ei];
      if (ne.cls !== 'hwy' || ne.noTraffic) continue;
      const sign = ne.a === nodeId ? 1 : -1;
      if (!this.allowed(ei, sign) || this.comp[sign > 0 ? ne.b : ne.a] !== comp) continue;
      const dot = ne.dx * sign * fx + ne.dz * sign * fz;
      if (dot < 0.5) continue;
      const sc = dot + hash2(ei, v.prio) * 0.4;
      if (sc > bs) { bs = sc; best = { ei, sign }; }
    }
    return best;
  }

  /** The node at the end of route entry j. */
  entryEnd(v, j) {
    const e = this.city.edges[v.rt[j * RT_F + R_EI]];
    return v.rt[j * RT_F + R_SG] > 0 ? e.b : e.a;
  }

  /** Cut v's route back so entry j is its last (it is planned on again from
   *  the node at its end). */
  cutRoute(v, j) {
    if (j + 1 < v.rtN) { v.rtN = j + 1; v.rt[j * RT_F + R_END] = 0; }
  }

  /** Look down the freeway for the next diverge (a ramp leaving, the
   *  carriageway going on) EXIT_PLAN m ahead, and decide once whether to take
   *  it: EXIT_P of drivers do. */
  fwyPlanExit(v, s0, force = 0) {
    const city = this.city, rt = v.rt;
    let ei = rt[R_EI], sign = rt[R_SG];
    let node = sign > 0 ? city.edges[ei].b : city.edges[ei].a;
    let dist = rt[R_LEN] - s0;
    // force: the car is in an exit-only lane with no way out of it -- it
    // takes the next exit on the right if that is within `force` m
    if (force) {
      for (let hop = 0; hop < 20 && dist < force; hop++) {
        const e = city.edges[ei], fx = e.dx * sign, fz = e.dz * sign, comp = this.comp[node];
        for (const k of city.nodes[node].e) {
          if (k === ei) continue;
          const r = city.edges[k];
          if (r.cls !== 'ramp' || !this.fwy[k] || r.noTraffic) continue;
          const sg = r.a === node ? 1 : -1;
          if (!this.allowed(k, sg) || this.comp[sg > 0 ? r.b : r.a] !== comp) continue;
          if (r.dx * sg * fx + r.dz * sg * fz < 0.5 || fx * r.dz * sg - fz * r.dx * sg <= 0) continue;
          v.exitNode = node; v.exitEi = k; v.exitSign = sg; v.exitSide = 1; v.exitSeen = node;
          this.stats.exitsPlanned++;
          for (let j = 0; j < v.rtN; j++) if (this.entryEnd(v, j) === node) { this.cutRoute(v, j); break; }
          return true;
        }
        const on = this.fwyOn(v, ei, sign, node);
        if (!on) return false;
        ei = on.ei; sign = on.sign;
        node = sign > 0 ? city.edges[ei].b : city.edges[ei].a;
        dist += city.edges[ei].len;
      }
      return false;
    }
    for (let hop = 0; hop < 40 && dist < EXIT_PLAN[1]; hop++) {
      const e = city.edges[ei], fx = e.dx * sign, fz = e.dz * sign, comp = this.comp[node];
      let ramp = null;
      for (const k of city.nodes[node].e) {
        if (k === ei) continue;
        const r = city.edges[k];
        if (r.cls !== 'ramp' || !this.fwy[k] || r.noTraffic) continue;
        const sg = r.a === node ? 1 : -1;
        if (!this.allowed(k, sg) || this.comp[sg > 0 ? r.b : r.a] !== comp) continue;
        const dot = r.dx * sg * fx + r.dz * sg * fz;
        if (dot < 0.5) continue;
        ramp = { ei: k, sign: sg, side: fx * r.dz * sg - fz * r.dx * sg > 0 ? 1 : -1 };
      }
      const on = this.fwyOn(v, ei, sign, node);
      if (ramp && on) {
        if (v.exitSeen === node) return;
        v.exitSeen = node;
        if (dist < EXIT_PLAN[0] || hash2(v.prio * 7 + 3, node) >= EXIT_P) return;
        v.exitNode = node; v.exitEi = ramp.ei; v.exitSign = ramp.sign; v.exitSide = ramp.side;
        this.stats.exitsPlanned++;
        // the route may already run on past it
        for (let j = 0; j < v.rtN; j++) if (this.entryEnd(v, j) === node) { this.cutRoute(v, j); break; }
        return;
      }
      if (!on) return;
      ei = on.ei; sign = on.sign;
      node = sign > 0 ? city.edges[ei].b : city.edges[ei].a;
      dist += city.edges[ei].len;
    }
  }

  /** The cars around v on its carriageway: along (m ahead), lat (right of
   *  v's edge's centreline, in v's own frame) and tgt (the offset they are
   *  making for, in the same frame). Each is placed in v's frame through its
   *  position relative to v, bent for the road's curve between them (the
   *  centreline ahead is along x dtheta / 2 to the side, dtheta the turn from
   *  v's edge to the other's), so a car 100 m round a bend is in its lane --
   *  and not on an edge whose centreline OSM drew half a lane over. */
  fwyNeighbours(v) {
    const rt = v.rt, city = this.city, out = this._nb || (this._nb = []);
    out.length = 0;
    const ux = rt[R_UX], uz = rt[R_UZ];
    const e = city.edges[rt[R_EI]], na = city.nodes[rt[R_SG] > 0 ? e.a : e.b];
    const myLat = (v.x - na.x) * -uz + (v.z - na.z) * ux;
    for (const o of this.cars) {
      if (o === v || o.leader === v) continue;
      if (o.mode === 'parked' || o.mode === 'apron' || o.mode === 'path' || o.mode === 'race') continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (dx * dx + dz * dz > 140 * 140 || Math.abs(o.y - v.y) > 3) continue;
      const fo = o.forward;
      if (fo.x * ux + fo.z * uz < 0.6) continue;
      const along = dx * ux + dz * uz;
      const q = o.leader || o;   // a trailer goes where its tractor goes
      const qe = q.rt && q.rtN && q.edge != null ? city.edges[q.edge] : null;
      const rdx = qe ? qe.dx * q.dirSign : fo.x, rdz = qe ? qe.dz * q.dirSign : fo.z;
      const dth = Math.asin(clamp(ux * rdz - uz * rdx, -1, 1));   // + = the road bends right
      const lat = myLat + dx * -uz + dz * ux - (along * dth) / 2;
      let tgt = lat;
      if (qe && this.fwy[q.edge] && qe.oneway) {
        const qa = city.nodes[q.dirSign > 0 ? qe.a : qe.b];
        const qLat = (q.x - qa.x) * -rdz + (q.z - qa.z) * rdx;
        tgt = lat + (q.rt[R_OFF] + this.goreAt(q) - qLat);
      }
      out.push({ o, along, lat, tgt, v: o.vLong, len: o.halfLen });
    }
    return out;
  }

  /** IDM acceleration at speed sp toward v0 behind a leader gap m ahead at vL. */
  idm(sp, v0, aMax, gap, vL) {
    const vr = sp / Math.max(0.5, v0);
    let a = aMax * (1 - vr * vr * vr * vr);
    if (gap < Infinity) {
      const ss = IDM_S0 + Math.max(0, sp * IDM_T + (sp * (sp - vL)) / (2 * Math.sqrt(aMax * IDM_B)));
      const r = ss / Math.max(gap, 0.1);
      a -= aMax * r * r;
    }
    return a;
  }

  /** Lane target offset T (right of travel): is a change into it safe, and
   *  what would v's acceleration be there? */
  fwyLane(v, nb, T, w, myLat, sp, v0, aMax) {
    let gA = Infinity, vA = 0, gB = Infinity, fB = null;
    for (const n of nb) {
      // (a car on an on-ramp beside the lane is about to be in it)
      const q = n.o.leader || n.o, merging = q.edge != null && this.fwy[q.edge] && this.city.edges[q.edge].cls === 'ramp';
      if (Math.abs(n.lat - T) > (merging ? 1.6 : 0.55) * w && Math.abs(n.tgt - T) > 0.55 * w) continue;
      if (n.along >= 0) {
        const g = n.along - v.halfLen - n.len;
        if (g < gA) { gA = g; vA = n.v; }
      } else {
        const g = -n.along - v.halfLen - n.len;
        if (g < gB) { gB = g; fB = n; }
      }
    }
    // never alongside anything in the target lane
    if (gA < 3 + sp * 0.25 || gB < 4) return null;
    const aNew = this.idm(sp, v0, aMax, gA, vA);
    if (aNew < LC_SAFE) return null;
    if (fB) {
      const o = fB.o.leader || fB.o, vF = Math.max(0, fB.v);
      const vF0 = o.rt ? o.rt[R_SPD] * (o.drvK || 1) : vF + 3;
      const aF = this.idm(vF, Math.max(vF0, 1), 2.0, gB, sp);
      if (aF < LC_SAFE || gB < 4 + vF * 0.5) return null;
    }
    return { aNew, gA };
  }

  /** Change v's lane by one (+1 right of travel, -1 left). */
  changeLane(v, dir, LI, i) {
    const rt = v.rt, sign = rt[R_SG];
    const ni = i + dir * sign;
    if (ni < 0 || ni >= LI.n) return false;
    const oldOff = rt[R_OFF];
    const keep = rt.slice(V_K, RT_F);   // the vertex behind (the corner already turned)
    this.routeEntry(v, 0, rt[R_EI], sign, (ni + 0.5) / LI.n);
    rt.set(keep, V_K);
    v.laneU = rt[R_U];
    v.rtN = 1;
    v.lcShift = (v.lcShift || 0) + oldOff - rt[R_OFF];
    v.lcRate = Math.max(0.8, Math.abs(v.lcShift) / LC_TIME);
    v.lcCool = 4 + 3 * hash2(v.prio, this.stats.laneChanges);
    this.stats.laneChanges++;
    if (dir > 0) this.stats.laneRight++; else this.stats.laneLeft++;
    return true;
  }

  /** A freeway driver's decisions, every half second: plan an exit, move
   *  over for it (or for a lane that ends, or a semi out of the left lanes),
   *  pass on the left, keep right. */
  fwyDecide(v, s0, sp, v0, aMax) {
    const rt = v.rt, city = this.city, ei = rt[R_EI], e = city.edges[ei];
    // a planned exit taken: done with it
    if (v.exitNode != null && v.exitNode >= 0 && ei === v.exitEi) { v.exitNode = -1; this.stats.exitsTaken++; }
    if (e.cls !== 'hwy' || !e.oneway || e.tunnel) return;
    if (v.exitNode == null || v.exitNode < 0) this.fwyPlanExit(v, s0);
    if (v.lcShift) return;
    // still in the corner behind: its geometry is the old lane's
    if (rt[V_K] === 1 && s0 < rt[V_B] + rt[V_T]) return;
    const LI = this.laneInfo(ei), sign = rt[R_SG];
    if (LI.n < 2 || !(LI.w > 2.5)) return;
    const i = Math.min(LI.n - 1, Math.floor(rt[R_U] * LI.n));
    const fromR = sign > 0 ? LI.n - 1 - i : i, fromL = LI.n - 1 - fromR;
    const offOf = (j) => (LI.lo + (j + 0.5) * LI.w) * sign;
    const na = city.nodes[sign > 0 ? e.a : e.b];
    const myLat = (v.x - na.x) * -rt[R_UZ] + (v.z - na.z) * rt[R_UX];
    // MANDATORY: the exit's lane, a lane ending ahead, a semi in the left lanes
    let must = 0;
    v.dropX = null;
    if (v.exitNode == null) v.exitNode = -1;
    if (v.exitNode >= 0) {
      let dX = rt[R_LEN] - s0, found = this.entryEnd(v, 0) === v.exitNode;
      for (let j = 1; j < v.rtN && !found; j++) { dX += rt[j * RT_F + R_LEN]; found = this.entryEnd(v, j) === v.exitNode; }
      const inLane = v.exitSide > 0 ? fromR === 0 : fromL === 0;
      if (!inLane) {
        if (found && dX < 35) {
          // too late to get over: carry on, and leave at the next one
          v.exitSeen = v.exitNode; v.exitNode = -1; this.stats.exitsAborted++;
          for (let j = 0; j < v.rtN; j++) if (this.entryEnd(v, j) === v.exitSeen) { this.cutRoute(v, j); break; }
        } else must = v.exitSide;
      }
    }
    // AN EXIT-ONLY LANE (highways.js `e.xo`, painted with the continuity line
    // by world.js meshRoadMarks): a driver not taking the exit moves out of
    // it; one still in it with no gap as the exit nears takes the exit, as
    // people do, rather than stopping at the gore.
    const xo = e.xo || 0, inXo = xo > 0 && LI.n > xo && fromR < xo;
    if (!must && inXo && v.exitNode < 0) {
      // how far the exit-only stretch runs on along the route (to the
      // diverge): inside XO_LATE of it no driver cuts across the lanes any
      // more -- moving over at the gore met the cars exiting behind it
      let dX = rt[R_LEN] - s0;
      for (let j = 1; j < v.rtN; j++) { const q = city.edges[rt[j * RT_F + R_EI]]; if (!(q.xo > 0)) break; dX += rt[j * RT_F + R_LEN]; }
      if (dX < XO_LATE) { if (this.fwyPlanExit(v, s0, XO_LATE + 40)) this.stats.exitOnlyTaken = (this.stats.exitOnlyTaken || 0) + 1; return; }
      must = -1;
    }
    if (!must) {
      // a lane that ends within 250 m: the route jogs sideways at a node
      let d = rt[R_LEN] - s0;
      for (let j = 1; j < v.rtN && d < 250; j++) {
        const p = (j - 1) * RT_F, q = j * RT_F;
        const qe = city.edges[rt[q + R_EI]];
        if (qe.cls !== 'hwy') break;
        if (rt[p + R_UX] * rt[q + R_UX] + rt[p + R_UZ] * rt[q + R_UZ] < 0.94) break;
        const ex = rt[p + R_QX] + rt[p + R_UX] * rt[p + R_LEN], ez = rt[p + R_QZ] + rt[p + R_UZ] * rt[p + R_LEN];
        const jog = (rt[q + R_QX] - ex) * -rt[p + R_UZ] + (rt[q + R_QZ] - ez) * rt[p + R_UX];
        if (Math.abs(jog) > 2.2) { must = Math.sign(jog); if (this.laneInfo(rt[q + R_EI]).n < LI.n) { v.dropX = ex; v.dropZ = ez; } break; }
        d += rt[q + R_LEN];
      }
    }
    if (!must && v.spec.hand === 'semi' && LI.n >= 3 && fromR > 1) must = 1;
    const nb = this.fwyNeighbours(v);
    if (must) {
      if (i + must * sign < 0 || i + must * sign >= LI.n) return;
      const ok = (v.lcCool <= 2 || v.exitNode >= 0) && this.fwyLane(v, nb, offOf(i + must * sign), LI.w, myLat, sp, v0, aMax);
      if (ok && this.changeLane(v, must, LI, i)) { this.stats.laneMandatory++; v.dropT = 0; }
      else if (inXo && v.exitNode < 0) { if (this.fwyPlanExit(v, s0, XO_LATE + 40)) this.stats.exitOnlyTaken = (this.stats.exitOnlyTaken || 0) + 1; }
      // a lane that ends with no gap beside it: the car slows for its end
      // (driveTraffic) rather than swerving across at the node
      else if (v.dropX != null && v.exitNode < 0) v.dropT = 1.2;
      return;
    }
    if (v.lcCool > 0 || sp < 8) return;
    // planned to exit and in its lane: stay there
    if (v.exitNode >= 0) return;
    const aCur = this.idm(sp, v0, aMax, v.leadGap != null ? v.leadGap : Infinity, v.leadV || 0);
    // PASS ON THE LEFT: held up by a slower car, and the left lane is better
    if (fromL > 0 && !(v.spec.hand === 'semi' && LI.n >= 3 && fromR >= 1)) {
      const slow = v.leadGap < 90 && v.leadV < v0 - 1.5;
      if (slow) {
        const r = this.fwyLane(v, nb, offOf(i - sign), LI.w, myLat, sp, v0, aMax);
        if (r && r.aNew - aCur > LC_GAIN) { this.changeLane(v, -1, LI, i); return; }
      }
    }
    // KEEP RIGHT except to pass: back over once it costs nothing
    // (never back over into an exit-only lane)
    if (fromR > 0 && !(xo > 0 && LI.n > xo && fromR - 1 < xo)) {
      const r = this.fwyLane(v, nb, offOf(i + sign), LI.w, myLat, sp, v0, aMax);
      if (r && r.aNew > -0.2 && r.aNew >= aCur - LC_KEEP && r.gA > sp * 2.5) this.changeLane(v, 1, LI, i);
    }
  }

  /** On a freeway ramp: the merge into the main line ahead. The main-line car
   *  in the lane this car will join that reaches the merge before it (or
   *  within 1.5 s after) is a leader, its gap measured to the merge. */
  fwyMergeGap(v, sp) {
    const rt = v.rt, city = this.city;
    let j = 1;
    for (; j < v.rtN; j++) if (city.edges[rt[j * RT_F + R_EI]].cls === 'hwy') break;
    if (j >= v.rtN) return null;
    const q = j * RT_F, me = city.edges[rt[q + R_EI]], M = city.nodes[rt[q + R_SG] > 0 ? me.a : me.b];
    const dM = Math.hypot(M.x - v.x, M.z - v.z);
    if (dM > 170) return null;
    const fx = rt[q + R_UX], fz = rt[q + R_UZ], T = rt[q + R_OFF];
    const w = this.laneInfo(rt[q + R_EI]).w || 3.6;
    const tMe = dM / Math.max(sp, 1);
    let best = null;
    for (const o of this.cars) {
      if (o === v || o.leader === v || o.mode === 'parked' || o.mode === 'apron') continue;
      if (Math.abs(o.y - v.y) > 4) continue;
      const q2 = o.leader || o;
      if (q2.edge != null && this.fwy[q2.edge] && city.edges[q2.edge].cls === 'ramp') continue;
      const dx = M.x - o.x, dz = M.z - o.z;
      if (dx * dx + dz * dz > 260 * 260) continue;
      if (o.forward.x * fx + o.forward.z * fz < 0.7) continue;
      const lat = (o.x - M.x) * -fz + (o.z - M.z) * fx;
      if (Math.abs(lat - T) > (dM < 50 ? 1.15 : 0.6) * w) continue;   // (close in, an angled ramp sweeps the next lane too)
      const dO = dx * fx + dz * fz;
      if (dO < -40) continue;
      const tO = dO / Math.max(o.vLong, 1);
      if (tO > tMe + 1.5) continue;
      const g = dM - dO - v.halfLen - o.halfLen - 3;
      if (!best || g < best.gap) best = { gap: g, vL: o.vLong };
    }
    return best;
  }

  /** A traffic car back on the graph where it now stands, after a back-out:
   *  the edge under it the way it faces (snapRoute), turned round if that is
   *  against a one-way. Re-planning from its OLD edge (rtN = 0) sent a car
   *  that had turned into a junction back toward a lane it could not reach,
   *  and it circled the junction. */
  reroute(v) {
    if (!this.snapRoute(v)) { v.rtN = 0; return; }
    if (!this.allowed(v.edge, v.dirSign)) {
      v.dirSign = -v.dirSign;
      v.laneU = this.flow[v.edge] !== 0 ? this.nearestLaneU(v.edge, v.dirSign, 0) : 0.5;
      this.routeInit(v);
    }
  }

  /** Nothing within `m` metres behind car v (a body width either side)? */
  roomBehind(v, m) {
    const f = v.forward;
    for (const o of this.cars) {
      if (o === v || o.mode === 'apron' || Math.abs(o.y - v.y) > 3) continue;
      const rx = o.x - v.x, rz = o.z - v.z, back = -(rx * f.x + rz * f.z);
      if (back <= 0 || back > v.halfLen + o.halfLen + m) continue;
      if (Math.abs(rx * f.z - rz * f.x) < v.halfWid + o.halfWid + 0.5) return false;
    }
    return true;
  }

  /** Does o wait on v, through at most four cars each younger than v and
   *  stopped (driveTraffic's gridlock rule)? Last frame's leads. */
  waitsOn(o, v) {
    let q = o;
    for (let k = 0; k < 4; k++) {
      q = q.lead;
      if (q === v) return true;
      if (!q || q.prio < v.prio || Math.abs(q.vLong) >= 1) return false;
    }
    return false;
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
    // AUTO KW, ON A FREEWAY: the planned exit (fwyPlanExit), else straight on
    // along the freeway -- a car leaves only by an exit it planned for and
    // moved over for, never across the lanes at the gore.
    if (v.exitNode === nodeId && v.exitEi >= 0 && this.allowed(v.exitEi, v.exitSign) && this.comp[v.exitSign > 0 ? city.edges[v.exitEi].b : city.edges[v.exitEi].a] === comp) {
      return { ei: v.exitEi, sign: v.exitSign };
    }
    if (fe.cls === 'hwy' && fe.oneway && !v.unit) {
      const st = this.fwyOn(v, fromEi, fromSign, nodeId);
      if (st) return st;
    }
    const banned = FWY_BANNED.has(v.typeName);
    // a turn given up here for want of its lane (cityLaneDecide's missTurn):
    // not a turn this car's lane cannot make
    const miss = v.lcMiss && v.lcMiss.has(nodeId);
    // AT A SIGNAL, a quarter of drivers turn (Auto KW). Weighted as
    // everywhere else -- dot x 2 against a 1.1 hash -- a car never turned
    // where it could go straight on, so nobody ever turned left at a
    // signal and its left-turn bay stood empty. Here the hash weighs more.
    const ci = this.jc && fe.cls !== 'hwy' ? this.jc.ctl[nodeId] : -1;
    const atSig = ci >= 0 && this.jc.list[ci].k === 1;
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
      // (a short no-exit street: only if there is nothing else -- noExitTraps)
      const cul = this.flow[ei] === 0 ? this.cul[ei * 2 + (sign > 0 ? 1 : 0)] : 0;
      let score = (atSig ? dot * 1.2 + hash2(ei, (v.x * 3) | 0) * 2.5 : dot * 2 + hash2(ei, (v.x * 3) | 0) * 1.1) + (ne.cls === 'res' ? -0.6 : 0) + (banned && this.fwy[ei] ? -20 : 0)
        + (cul > 0 && cul < CUL_MAX ? -6 : 0);
      if (miss) {
        const mx = v.lcMissUX, mz = v.lcMissUZ;
        if (dx * mx + dz * mz < 0.7 && ((mx * dz - mz * dx > 0) ? !v.lcMissR : !v.lcMissL)) score -= 8;
      }
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
    //
    // THE SWEEP READS ARRAYS. Auto KW has ~180 apron vehicles in clusters
    // (bike docks, a dealer's lot, farms, fire halls), and past 300 m they
    // are not 'still' (their _still is only counted inside 300 m), so every
    // pair in a cluster was tested every frame: ~1,000 tests a frame in town,
    // each a dozen property reads on vehicles of many shapes (two of them the
    // mode getter) to find two bodies metres apart -- the biggest part of
    // traffic's cost at 8x. Each body's x, z, height, radius and still flag
    // are read once into arrays here; a pair goes to carPair (every test it
    // ever made, in the same order) only when the arrays say their circles
    // meet within 3 m of height, which are carPair's own first tests, with no
    // side effects to skip. A contact can move anything (its callbacks), so
    // after one the arrays are read again. The same pairs: the same frame.
    const cars = this.cars, n = cars.length, all = this._colOrd || (this._colOrd = []);
    if (!this._colX || this._colX.length < n) {
      const m = n + 64;
      this._colX = new Float64Array(m); this._colZ = new Float64Array(m); this._colY = new Float64Array(m);
      this._colR = new Float64Array(m); this._colK = new Float64Array(m); this._colS = new Uint8Array(m);
    }
    if (!this._colI || this._colI.length < n) { this._colI = new Int32Array(n + 64); this._colT = new Int32Array(n + 64); }
    const X = this._colX, Z = this._colZ, Y = this._colY, R = this._colR, K = this._colK, S = this._colS, ord = this._colI;
    // The order `all.sort((a, b) => a.x - b.x)` gave: Array.sort is stable,
    // so that is the vehicles by x, ties in list order -- which sortByKey
    // gives too, without ~1,500 calls of a comparator (a tenth of the sweep).
    // (a NaN or infinite x has no such order: the old sort, as it was)
    let finite = true;
    for (let k = 0; k < n; k++) { ord[k] = k; const x = cars[k].x; K[k] = x; if (!(x - x === 0)) finite = false; }
    if (finite) sortByKey(ord, this._colT, K, n);
    else { const o = Array.from({ length: n }, (_, k) => k).sort((p, q) => K[p] - K[q]); for (let k = 0; k < n; k++) ord[k] = o[k]; }
    all.length = n;
    let rMax = 0;
    for (let k = 0; k < n; k++) { const v = cars[ord[k]]; all[k] = v; const r = bodyR(v); R[k] = r; if (r > rMax) rMax = r; }
    const still = (v) => v !== player.vehicle && (v.mode === 'parked' || (v.mode === 'apron' && v._still >= 3));
    const read = () => {
      for (let k = 0; k < n; k++) { const v = all[k]; X[k] = v.x; Z[k] = v.z; Y[k] = v.y || 0; S[k] = still(v) ? 1 : 0; }
    };
    read();
    for (let i = 0; i < n; i++) {
      const sa = S[i] === 1, ra = R[i], reach = X[i] + ra + rMax;
      let xa = X[i], za = Z[i], ya = Y[i];
      for (let j = i + 1; j < n; j++) {
        if (X[j] > reach) break;
        if (sa && S[j] === 1) continue;
        if (Math.abs(ya - Y[j]) > 3) continue;
        const dx = X[j] - xa, dz = Z[j] - za, rr = ra + R[j], d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        if (this.carPair(all[i], all[j], player)) { read(); xa = X[i]; za = Z[i]; ya = Y[i]; }
      }
    }
  }

  /** One pair of the sweep (resolveCarCollisions): pushed apart and the
   *  impulse applied if their bodies overlap. True if anything changed. */
  carPair(a, b, player) {
    // The test is 2D, so gate on height or a plane at 200 m gets shunted
    // by the traffic it overflies -- the "invisible collision in the air".
    // Also stops a viaduct car trading paint with the street below it.
    if (Math.abs((a.y || 0) - (b.y || 0)) > 3) return false;
    // Two parked cars never move, so they cannot start overlapping.
    if (a.mode === 'parked' && b.mode === 'parked') return false;
    // an articulated bus's two sections are one vehicle
    if (a.leader === b || b.leader === a) return false;
    // a car flattened by a tank is driven over, not shunted (tank.js)
    if (a.crushed || b.crushed) return false;
    const dx = b.x - a.x, dz = b.z - a.z;
    const rr = bodyR(a) + bodyR(b);
    const d2 = dx * dx + dz * dz;
    if (d2 > rr * rr || d2 < 1e-6) return false;
    // THE BODIES, NOT CIRCLES: two oriented rectangles, separated along
    // the axis of least overlap. Circles of 0.42 x length (2 m for a
    // sedan) touched two cars abreast in 3.6 m lanes and shoved them
    // apart the whole way, which is why lanes used to be 4.2 m and a
    // 3-lane freeway carried 2.
    const hit = boxOverlap(a, b, dx, dz);
    if (!hit) return false;
    const nx = hit.nx, nz = hit.nz, pen = hit.pen;
    // a rear section is placed by its front, so it does not give way
    const ma = a.mode === 'trailer' ? 1e6 : a.mass, mb = b.mode === 'trailer' ? 1e6 : b.mass;
    const total = ma + mb;
    // (where they touch, judged before they are pushed apart)
    const cp = pairContact(a, b, nx, nz, hit.refA), cx = cp.x, cz = cp.z;
    a.hitX = b.hitX = cx; a.hitZ = b.hitZ = cz;
    a.x -= nx * pen * (mb / total);
    a.z -= nz * pen * (mb / total);
    b.x += nx * pen * (ma / total);
    b.z += nz * pen * (ma / total);
    // THE IMPULSE AT THE CONTACT (pairImpulse, above): both velocities,
    // along and across each car, and both yaws through the lever arm, so
    // a T-bone shoves and spins the car it hits, an offset shunt turns
    // both, and a glancing one deflects. It replaced each car taking its
    // share along its own heading only -- which itself replaced a
    // `b.vLong += ...` unprojected that pushed a head-on car forward into
    // the other (SR-99, an AI car 41 -> 110 m/s in four frames). The
    // impulse is along the contact normal by construction, so neither
    // can come back.
    const rel = pairImpulse(a, b, nx, nz, cx, cz, ma, mb);
    if (rel > 0) {
      const impact = rel;
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
    return true;
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
