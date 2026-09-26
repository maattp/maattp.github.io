// Vehicle models and the arcade driving model.
//
// Bodies are lofted through cross-sections rather than assembled from boxes, so
// they get a real shoulder line, a raked screen and smooth shading. Each type
// bakes down to three geometries that share materials across every instance:
//
//   paint  - the painted shell, tinted per car by its own material colour
//   trim   - glass, chrome, lamp lenses, wheel rims (shiny, metallic)
//   matte  - tyres, bumper rubber, plastic, wheel arches (rough, dielectric)

import * as THREE from './three.js';
import { Builder } from './build.js';
import { makeHumanoid, buildCharacter, BONES, gripHands } from './peds.js';
import { clamp, lerp, hash2, damp } from './util.js';
import * as G from './geo.js';

const TYRE = [0.05, 0.05, 0.055];
const RIM = [0.80, 0.82, 0.85];
const HUB = [0.42, 0.44, 0.47];
// Glazing. This exact colour is what marks a trim vertex as GLASS: buildType
// tags every trim vertex carrying it with the `glass` attribute, and the trim
// shader turns those into see-through, sky-reflecting glass (see glassShader).
// Anything that must stay opaque and merely looks dark -- a mirror face, a lamp
// housing -- takes another colour.
export const GLASS = [0.06, 0.08, 0.10];
// A door mirror's face: silvered, so it mirrors the sky rather than being a
// dark tile, and deliberately NOT the glass colour, or it would go see-through
// onto the empty inside of its pod.
const MIRROR = [0.52, 0.55, 0.58];
const CHROME = [0.84, 0.86, 0.89];
const PLASTIC = [0.11, 0.12, 0.13];
const LAMP = [1.0, 0.98, 0.9];
const TAILC = [0.92, 0.12, 0.1];
const AMBER = [0.95, 0.55, 0.08];
const PLATE = [0.86, 0.86, 0.82];
const WHITE = [1, 1, 1];
const DISC = [0.30, 0.31, 0.33];
const CALIPER = [0.55, 0.09, 0.07];
// Inside of every recess. Near-black rather than black so the wall still takes
// a little bounce and the depth of the pocket reads.
const CAVITY = [0.035, 0.04, 0.045];

// len/wid in metres; sill = bottom of the visible bodywork, belt = shoulder
// line, roof = roof height, cab = greenhouse extent as a fraction of length.
// Longitudinal resistance, shared by the integrator and by deriveSpec so the
// solved top speed is the one the integrator actually converges to.
// These were 0.0016 and 0.07, which at 57 m/s cost a sedan 5.2 and 4.0 m/s^2
// against a real ~0.9 and ~0.12 -- roughly five times too much drag and thirty
// times too much rolling resistance. That is what held every top speed far
// under its class and forced the launch accelerations up to compensate, so a
// family sedan did 0-100 in 3.5 s and still could not reach 100 km/h.
const DRAG = 0.00040;
const ROLL = 0.020;
// Off a stunt ramp (stunts.js) the flight is arcade, not the crest hop: lower
// gravity for hang time, the flight path held while steering spins the body.
const STUNT_G = 15;
const STUNT_SPIN = 2.6;   // rad/s of yaw at full steer, in the air
const STILL = { dx: 0, dz: 0 };
const V0_100 = 100 / 3.6;

// How much punchier than real the throttle is.
//
// The bench measures against real-world 0-100 figures and the table declares
// them, which is the right way to keep a bus from out-dragging a hatchback --
// but a real family sedan takes 8.6 s to 100 km/h and in a game that feels
// broken. You spend the whole time waiting for the car to do something.
//
// So the ratios between vehicles stay real and the whole scale is compressed:
// everything accelerates ARCADE_PUNCH times harder than its spec sheet, which
// keeps a sports car quicker than a van by the right margin while making both
// enjoyable. Top speed stays honest; grip and braking are scaled together by
// ARCADE_GRIP / ARCADE_BRAKE, so the ratios between classes survive and the
// whole scale moves as one.
const ARCADE_PUNCH = 2.4;

// And how much more grip than real. Same bargain as ARCADE_PUNCH: the ratios
// between classes stay honest, the whole scale moves. At true road-tyre grip a
// sedan's cornering radius at 72 km/h is 46 m, which in a city built from real
// street widths means you cannot make a junction at any speed worth driving.
const ARCADE_GRIP = 2.2;

// The flight model needs the LOCAL water surface for floatplanes, and lakes
// live on world, which vehicles never see. main.js injects the query at boot.
let waterQuery = null;
const _dq = new THREE.Quaternion(), _tv = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export function setWaterQuery(fn) { waterQuery = fn; }
// How hard a corner may be asked for, as a fraction of the grip that exists.
// Above 1 on purpose: this is a GTA-style car, not a simulator. It should feel
// planted and willing -- lane changes and sweeping bends at speed take no
// thought, a hairpin at 120 km/h is simply not on -- so the car leans on its
// tyres a bit harder than physics allows without ever demanding the multiples
// that made it pivot on rails.
const STEER_BITE = 1.25;

// Braking was the one axis left at real-world scale, and that is why it felt
// slow: you accelerated 2.4x harder than the spec sheet and cornered at 2.2x
// the grip, then braked at exactly 1.0x. The comment above used to claim
// braking stayed honest alongside grip -- but grip has not been honest since
// ARCADE_GRIP arrived, so all that survived was an inconsistency. A tyre that
// gives 2.2x laterally gives it longitudinally too, which also keeps the
// friction budget isotropic.
const ARCADE_BRAKE = 2.2;

// The trainer's handling, which every aircraft without its own `fly` flies.
const PLANE_FLY = { vr: 27, stall: 21, bank: 0.72, turn: 1, climb: 14, vne: 0 };

export const TYPES = {
  // Boeing Field's resident: a high-wing single-prop trainer. `plane: true`
  // sends update() to the flight model; wid is the FUSELAGE (collision), the
  // 11 m wingspan lives in the builder. Speeds in kph as everywhere: rotates
  // ~100, cruises ~190.
  plane: deriveSpec({ wheelbase: 4.6, len: 8.3, wid: 2.0, wheelR: 0.30, sill: 0.55, belt: 1.35, roof: 2.10, cab: [0.6, 0.3], hand: 'plane', plane: true, mass: 0.8, acc: 6.5, topKph: 330, brakeM: 60, latG: 0.7 }),
  // Low-wing sport single: hotter (cruise ~380), rotates later, banks harder.
  sportplane: deriveSpec({ wheelbase: 4.2, len: 7.6, wid: 1.9, wheelR: 0.28, sill: 0.5, belt: 1.2, roof: 1.7, cab: [0.4, 0.3], hand: 'plane', plane: true, wing: 'low', mass: 0.75, acc: 8.0, topKph: 385, brakeM: 55, latG: 0.85 }),
  // Floatplane: pontoons instead of gear, lands on WATER (spec.floats routes
  // the flight model's ground query through the lake surface).
  floatplane: deriveSpec({ wheelbase: 5.0, len: 9.0, wid: 2.1, wheelR: 0.55, sill: 0.6, belt: 1.4, roof: 2.2, cab: [0.6, 0.3], hand: 'plane', plane: true, floats: true, mass: 0.95, acc: 5.5, topKph: 280, brakeM: 70, latG: 0.62 }),
  // `fly` is the flight model's per-type handling (updatePlane): rotation
  // speed `vr` and `stall` in m/s, `bank` the full-stick bank in radians,
  // `turn` a multiplier on the bank-to-yaw rate, `climb` the climb rate the
  // excess airspeed buys, `vne` a soft cap on airspeed in m/s (the drag above
  // gives every airframe ~30 % more in level flight than its declared top, and
  // the streamer has only been proven to ~120 m/s). Types without it fly as
  // the trainer always has.
  //
  // Twin turboprop, King Air 350 proportions: 14.2 m long, 17.6 m span, T-tail,
  // two PT6 nacelles on a low wing. Heavier and steadier than the singles --
  // it banks less and turns wider -- and faster in a straight line.
  twin: deriveSpec({ wheelbase: 5.2, len: 14.2, wid: 1.7, wheelR: 0.34, sill: 0.85, belt: 1.75, roof: 2.65, cab: [0.6, 0.3], hand: 'twin', plane: true, turboprop: true, mass: 1.6, acc: 6.8, topKph: 440, brakeM: 75, latG: 0.6,
    fly: { vr: 31, stall: 25, bank: 0.60, turn: 0.85, climb: 17, vne: 118 } }),
  // Light business jet, Learjet 45 proportions: 15 m, 15.5 m span, swept low
  // wing, two fans on pylons at the tail, T-tail. Rotates at 150 km/h, stalls
  // at 120, and is held near 150 m/s (~560 km/h level, measured) -- the
  // fastest thing in the game, and still inside what the streamer keeps up with.
  // A fighter: its own flight model (updateFighter, full 3D attitude), so it
  // rolls, loops and flies inverted; the others fly heading-and-bank.
  fighter: deriveSpec({ wheelbase: 6.7, len: 16.0, wid: 2.6, wheelR: 0.36, sill: 0.8, belt: 1.95, roof: 2.95, cab: [0.6, 0.3], hand: 'fighter', plane: true, fighter: true, jet: true, mass: 2.2, acc: 17, topKph: 780, brakeM: 90, latG: 0.8,
    // `thrust` is updateFighter's own, in m/s^2 (acc is the shared arcade
    // figure deriveSpec validates against the ground-drag model)
    fly: { vr: 62, stall: 46, bank: 1.2, turn: 1.4, climb: 40, vne: 215, thrust: 21 } }),
  jet: deriveSpec({ wheelbase: 6.2, len: 15.0, wid: 1.7, wheelR: 0.30, sill: 0.7, belt: 1.55, roof: 2.45, cab: [0.6, 0.3], hand: 'jet', plane: true, jet: true, mass: 2.0, acc: 9.0, topKph: 540, brakeM: 90, latG: 0.6,
    fly: { vr: 42, stall: 33, bank: 0.78, turn: 0.80, climb: 26, vne: 150 } }),
  // Boeing-Stearman Model 75: the biplane Boeing built, and the one hanging
  // in the Museum of Flight next door. A taildragger: it sits 11 degrees nose
  // up on its tailwheel until the tail lifts at ~15 m/s (`taildragger` is the
  // three-point attitude and where the main wheels are, which is what it
  // pivots about). Slow, floaty, and the tightest turner in the hangar.
  biplane: deriveSpec({ wheelbase: 5.3, len: 7.5, wid: 1.0, wheelR: 0.40, sill: 1.0, belt: 1.5, roof: 2.6, cab: [0.6, 0.3], hand: 'biplane', plane: true, mass: 0.7, acc: 6.0, topKph: 215, brakeM: 55, latG: 0.8,
    taildragger: { deg: 11, zMain: 2.1, tailUp: 15 },
    fly: { vr: 20, stall: 15, bank: 0.85, turn: 1.2, climb: 9, vne: 64 } }),
  // Helicopter: Bell 407 proportions (fuselage 9.5 m, 10.7 m rotor), skids.
  // `heli` sends update() to updateHeli instead of the fixed-wing model;
  // `plane` stays set so everything that treats an aircraft as an aircraft
  // (the flying camera rig, the streamer's altitude feed, no contact shadow,
  // flying courses) does so. topKph is the cruise the stick asks for.
  // `pivotY` puts the attitude pivot at the rotor's centre of mass instead of
  // on the skids, or pitching forward swung the whole cabin out over the nose.
  heli: deriveSpec({ wheelbase: 3.0, len: 9.9, wid: 1.9, wheelR: 0.3, sill: 0.5, belt: 1.2, roof: 3.1, cab: [0.6, 0.3], hand: 'heli', plane: true, heli: true, mass: 1.2, acc: 6.0, topKph: 230, brakeM: 60, latG: 0.8,
    pivotY: 1.5,
    rotor: { climb: 9, sink: 7, accel: 7.5, grip: 14, yaw: 1.35, yawFast: 0.5, back: 10 } }),
  sedan: deriveSpec({ wheelbase: 2.98,len: 5.06, wid: 1.90, wheelR: 0.34, sill: 0.30, belt: 1.06, roof: 1.50, cab: [-0.26, 0.10], hand: 'sedan', mass: 1.0, acc: 4.1, topKph: 205, brakeM: 40, latG: 0.88 }),
  hatch: deriveSpec({ wheelbase: 2.6,len: 4.10, wid: 1.76, wheelR: 0.31, sill: 0.29, belt: 0.96, roof: 1.50, cab: [-0.30, 0.16], hand: 'hatch', mass: 0.9, acc: 3.6, topKph: 185, brakeM: 41, latG: 0.85 }),
  compact: deriveSpec({ wheelbase: 2.42,len: 3.74, wid: 1.68, wheelR: 0.29, sill: 0.28, belt: 0.94, roof: 1.48, cab: [-0.28, 0.15], hand: 'compact', mass: 0.85, acc: 3.0, topKph: 170, brakeM: 43, latG: 0.83 }),
  suv: deriveSpec({ wheelbase: 2.87,len: 4.94, wid: 1.98, wheelR: 0.38, sill: 0.46, belt: 1.30, roof: 1.88, cab: [-0.34, 0.20], hand: 'suv', mass: 1.3, acc: 4.0, topKph: 195, brakeM: 42, latG: 0.8 }),
  // `hand` sends a type to its own authored builder instead of the shared
  // loft. sill/belt/roof are then a DESCRIPTION of what that builder draws
  // rather than an input to it, so they stay readable next to the other rows.
  sports: deriveSpec({ wheelbase: 2.72,len: 4.42, wid: 1.92, wheelR: 0.34, sill: 0.22, belt: 0.94, roof: 1.32, cab: [-0.24, 0.06], hand: 'sports', mass: 0.85, acc: 7.4, topKph: 275, brakeM: 33, latG: 1.02 }),
  // Cab-forward and low, on a long wheelbase with almost no overhang -- the
  // shape a floor full of batteries gives you. Heavier than the sports car and
  // quicker anyway, because the torque is all there from a standstill.
  ev: deriveSpec({ wheelbase: 2.96,len: 4.62, wid: 1.98, wheelR: 0.36, sill: 0.23, belt: 0.90, roof: 1.40, cab: [-0.28, 0.09], hand: 'ev', ev: true, mass: 1.2, acc: 9.0, topKph: 235, brakeM: 35, latG: 0.96 }),
  muscle: deriveSpec({ wheelbase: 2.95,len: 5.02, wid: 1.98, wheelR: 0.35, sill: 0.26, belt: 1.02, roof: 1.40, cab: [-0.24, 0.13], hand: 'muscle', mass: 1.15, acc: 7.0, topKph: 265, brakeM: 36, latG: 0.94 }),
  // Roofless muscle. `roof` is the top of the windscreen frame, 16 cm under the
  // coupe's, and there is no greenhouse above the beltline at all -- which is
  // why the interior has to be built: you look straight down into it.
  convertible: deriveSpec({ wheelbase: 2.95,len: 4.86, wid: 1.94, wheelR: 0.35, sill: 0.26, belt: 1.00, roof: 1.34, cab: [-0.24, 0.10], hand: 'convertible', mass: 1.10, acc: 6.6, topKph: 250, brakeM: 37, latG: 0.90 }),
  // Motorcycles. `moto` is not a styling flag: it switches the ground solve to
  // two contact patches and turns on lean, both of which are wrong for a car
  // and both of which a bike looks broken without. Light, quick, and with LESS
  // braking distance in hand and less lateral grip than a car of the same era
  // -- two contact patches the size of a credit card is what that costs.
  cruiser: deriveSpec({ wheelbase: 1.66,len: 2.56, wid: 0.95, wheelR: 0.40, sill: 0.30, belt: 0.80, roof: 1.24, cab: [-0.2, 0.1], hand: 'cruiser', moto: true, mass: 0.22, acc: 7.2, topKph: 190, brakeM: 48, latG: 0.80 }),
  sportbike: deriveSpec({ wheelbase: 1.36,len: 2.05, wid: 0.72, wheelR: 0.32, sill: 0.28, belt: 0.78, roof: 1.18, cab: [-0.2, 0.1], hand: 'sportbike', moto: true, mass: 0.16, acc: 10.2, topKph: 285, brakeM: 40, latG: 1.08 }),
  // Quad bike. Four wheels, so the car's ground solve and camber roll -- but
  // a rider (`atv` puts one on, as `moto` does) and handling of its own:
  // `offroad` skips the grass drag road cars pay and halves the grade term
  // (low gearing, four driven knobblies), and `minTurnR` tightens the
  // low-speed lock below every car's 4.5 m. Top speed ~95 km/h, like a
  // sport quad; 0-80 in about 5 s real, which the arcade punch halves.
  atv: deriveSpec({ wheelbase: 1.26, len: 2.00, wid: 1.20, wheelR: 0.29, sill: 0.30, belt: 0.80, roof: 1.25, cab: [-0.2, 0.1], hand: 'atv', atv: true, offroad: true, minTurnR: 3.0, mass: 0.34, acc: 8.5, topKph: 125, brakeM: 42, latG: 0.92 }),
  // A 5.7 m outboard runabout. `boat` sends update() to the hull model
  // (updateBoat): it floats on the LOCAL water surface and treats anything
  // shallower than its draft as a wall. `wheelR` is only there because
  // deriveSpec's callers read it; there are no wheels. `cockpit` is the
  // floor buildBoat draws: [height over the waterline, aft z, fore z, half-width],
  // which updateBoat keeps above the water.
  // A personal watercraft: the boat's physics (boat: true) on a 3.2 m hull
  // with a rider astride it, quicker to plane and far quicker to turn
  // (updateBoat reads `jetski`). Moored at the marinas, never traffic.
  jetski: deriveSpec({ wheelbase: 1.8, len: 3.20, wid: 1.20, wheelR: 0.20, sill: 0.3, belt: 0.6, roof: 1.05, cab: [-0.1, 0.1], hand: 'jetski', boat: true, jetski: true, mass: 0.4, acc: 7.5, topKph: 105, brakeM: 30, latG: 0.9 }),
  boat: deriveSpec({ wheelbase: 3.2, len: 5.70, wid: 2.20, wheelR: 0.30, sill: 0.4, belt: 0.7, roof: 1.45, cab: [-0.2, 0.1], hand: 'boat', boat: true, cockpit: [0.12, -2.2, 0.9, 0.86], mass: 1.1, acc: 3.0, topKph: 70, brakeM: 45, latG: 0.6 }),
  pickup: deriveSpec({ wheelbase: 3.68,len: 5.92, wid: 2.05, wheelR: 0.42, sill: 0.48, belt: 1.26, roof: 1.98, cab: [-0.15, 0.22], hand: 'pickup', mass: 1.4, acc: 4.4, topKph: 185, brakeM: 45, latG: 0.77 }),
  van: deriveSpec({ wheelbase: 3.5,len: 5.26, wid: 2.00, wheelR: 0.35, sill: 0.36, belt: 1.10, roof: 2.28, cab: [-0.44, 0.30], hand: 'van', boxy: 2, mass: 1.5, acc: 2.9, topKph: 155, brakeM: 47, latG: 0.73 }),
  taxi: deriveSpec({ wheelbase: 2.98,len: 4.76, wid: 1.85, wheelR: 0.33, sill: 0.30, belt: 1.06, roof: 1.50, cab: [-0.28, 0.19], hand: 'service', taxi: true, livery: 0xf0b40c, mass: 1.0, acc: 3.8, topKph: 195, brakeM: 41, latG: 0.85 }),
  police: deriveSpec({ wheelbase: 2.95,len: 4.98, wid: 1.92, wheelR: 0.34, sill: 0.30, belt: 1.06, roof: 1.50, cab: [-0.28, 0.19], hand: 'service', police: true, livery: 0xf2f4f6, mass: 1.1, acc: 5.6, topKph: 230, brakeM: 37, latG: 0.93 }),
  bus: deriveSpec({ wheelbase: 6.0,len: 12.0, wid: 2.55, wheelR: 0.50, sill: 0.50, belt: 1.30, roof: 3.10, cab: [-0.48, 0.48], hand: 'bus', livery: 0xeceae3, bus: true, boxy: 3, mass: 4.5, acc: 1.4, topKph: 95, brakeM: 52, latG: 0.62 }),
  boxtruck: deriveSpec({ wheelbase: 4.3,len: 7.5, wid: 2.38, wheelR: 0.46, sill: 0.62, belt: 1.55, roof: 2.55, cab: [0.14, 0.46], cargo: 2.55, hand: 'boxtruck', boxy: 2, mass: 3.0, acc: 2.5, topKph: 125, brakeM: 51, latG: 0.66 }),
  ambulance: deriveSpec({ wheelbase: 3.9,len: 6.3, wid: 2.28, wheelR: 0.42, sill: 0.56, belt: 1.42, roof: 2.35, cab: [0.16, 0.46], cargo: 2.25, hand: 'ambulance', livery: 0xf4f4f0, boxy: 2, emergency: true, mass: 2.4, acc: 3.2, topKph: 155, brakeM: 48, latG: 0.72 }),
  garbage: deriveSpec({ wheelbase: 4.6,len: 8.1, wid: 2.48, wheelR: 0.50, sill: 0.66, belt: 1.62, roof: 2.6, cab: [0.20, 0.46], cargo: 2.5, hand: 'garbage', livery: 0x2e6a3f, boxy: 2, mass: 4.0, acc: 1.45, topKph: 90, brakeM: 55, latG: 0.61 }),
};

/**
 * Turn the declared class figures into the constants the driving model wants.
 *
 * `top` used to be a curve parameter that the code called a top speed, and the
 * two are not the same number: drag and rolling resistance balance the engine
 * well before it. Measured, a sedan declaring 42 m/s actually stopped at 27.8,
 * and NINE of the fifteen types could not reach 100 km/h at all -- including
 * the pickup, the SUV and the panel van.
 *
 * The table now declares what a vehicle DOES: real top speed in km/h, real
 * 100-0 braking in metres, real lateral grip in g. Everything the integrator
 * needs is solved from those, so the table can be read against a spec sheet and
 * `tools/vehicles.mjs` can check it.
 */
function deriveSpec(s) {
  const V = s.topKph / 3.6;                       // target terminal velocity
  // At terminal: acc * (1 - V/param) == drag + rolling. Solve for param.
  const resist = DRAG * V * V + ROLL * V;
  // The EV's pull tails off as sqrt(fade), not linearly, so the same parameter
  // carries it a good deal further -- solved as if it were linear it overshot
  // its declared top by 47 km/h.
  s.acc *= ARCADE_PUNCH;
  const frac = s.ev ? 1 - (resist / s.acc) ** 2 : 1 - resist / s.acc;
  // A vehicle whose launch acceleration cannot even overcome its own drag at
  // the declared top speed is a table error, not a tuning choice.
  if (frac <= 0.02) {
    throw new Error(`vehicle spec: acc ${s.acc} too low to reach ${s.topKph} km/h`);
  }
  s.fadeTop = V / frac;
  // 100-0 in `brakeM` metres, at constant deceleration: a = v^2 / 2d.
  // Drag and rolling resistance help stop the car too, so the brakes have to
  // supply the target deceleration MINUS what the air and the tyres already
  // give. Ignoring it made every vehicle stop about 15 % shorter than declared.
  const vMean = V0_100 / 2;
  s.brakeA = ((V0_100 * V0_100) / (2 * s.brakeM) - (DRAG * vMean * vMean + ROLL * vMean))
    * ARCADE_BRAKE;
  // Lateral limit in m/s^2, which is what the friction circle below compares.
  s.latA = s.latG * 9.81;
  return s;
}

// Weighted by repetition. Two bikes in eighteen is about one vehicle in nine,
// which is a summer afternoon in a American city and not a bike show.
/**
 * What actually drives past, weighted like an American city.
 *
 * This was a flat array sampled uniformly, so a refuse truck was exactly as
 * likely to appear as a hatchback and heavy freight was a fifth of all traffic
 * -- both moving and parked at the kerb. Sedans, SUVs and pickups are most of
 * what a Seattle street holds, and they should be most of what spawns.
 */
export const CIVILIAN_TYPES = [
  ...Array(9).fill('sedan'),
  ...Array(8).fill('suv'),
  ...Array(7).fill('pickup'),
  ...Array(4).fill('compact'),
  ...Array(4).fill('hatch'),
  ...Array(3).fill('ev'),
  ...Array(3).fill('taxi'),
  ...Array(3).fill('van'),
  ...Array(2).fill('muscle'),
  ...Array(2).fill('sports'),
  ...Array(2).fill('cruiser'),
  'convertible', 'sportbike', 'boxtruck', 'bus', 'garbage',
];

export const CAR_COLORS = [
  0x9fa4a9, 0x1b1d20, 0xe6e8ea, 0x6d0f14, 0x102b52, 0x14472f, 0x7a5a22,
  0x2f3a44, 0x9c968c, 0x4a2058, 0xb85f0c, 0x0d5b66, 0x5b5f63, 0xbcc2c8,
  0x243b6b, 0x7d2418,
];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * One wheel: tyre with a real sidewall into `matte`; rim, spokes, brake disc
 * and caliper into `trim`.
 *
 * What this replaced was 14 segments of flat tread, no sidewall at all, and
 * alternating triangles across a disc standing in for spokes -- on the one
 * part of a car a player is always looking at. A wheel is a lathe, so it is
 * built as a lathe: a chain of bands of revolution between (x, radius) pairs,
 * with the normal for each band derived from its own slope so the tread crown
 * and the sidewall bulge shade as curves rather than as facets.
 *
 * `out` is which way the OUTBOARD face points, +1 or -1. The spokes, disc and
 * caliper are only built on that side: the inboard face is never seen, and
 * building both doubles the cost on every vehicle in the fleet.
 *
 * `out` 0 dresses BOTH faces and skips the plain inboard dish. That is for a
 * motorcycle, whose wheels are on the centreline: there is no inboard side, a
 * player walks round the bike, and a dished blank facing the kerb would be the
 * most obvious thing on it.
 */
function addWheel(trim, matte, cx, cy, cz, r, w, out = 1, knobby = false) {
  const SEG = 18;
  // Knob tops at the rolling radius, the carcass under them: the wheel
  // still stands on `r`, as the ground solve assumes.
  if (knobby) { knobs(matte, cx, cy, cz, r, w); r *= 0.9; }
  const hw = w / 2;
  // where the tyre grips the rim; an off-road tyre is mostly sidewall
  const bead = r * (knobby ? 0.60 : 0.70);
  const ang = (i) => (i / SEG) * Math.PI * 2;

  /**
   * Band of revolution about the axle from (x0, r0) to (x1, r1). `hint` is a
   * rough outward direction in (x, radial) so the band faces the right way --
   * the sign cannot be derived from the slope alone, because a sidewall that
   * bulges out and then tucks back in reverses it halfway along.
   */
  const band = (b, x0, r0, x1, r1, col, hint) => {
    let nx = -(r1 - r0), nr = x1 - x0;
    const l = Math.hypot(nx, nr) || 1;
    nx /= l; nr /= l;
    if (nx * hint[0] + nr * hint[1] < 0) { nx = -nx; nr = -nr; }
    for (let i = 0; i < SEG; i++) {
      const a0 = ang(i), a1 = ang(i + 1);
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const n0 = [nx, nr * c0, nr * s0], n1 = [nx, nr * c1, nr * s1];
      b.quad(
        [cx + x0, cy + c0 * r0, cz + s0 * r0], [cx + x0, cy + c1 * r0, cz + s1 * r0],
        [cx + x1, cy + c1 * r1, cz + s1 * r1], [cx + x1, cy + c0 * r1, cz + s0 * r1],
        [n0, n1, n1, n0], [0, 0, 1, 0, 1, 1, 0, 1], col);
    }
  };
  const disc = (b, x, r0, r1, dir, col) => {
    for (let i = 0; i < SEG; i++) {
      const a0 = ang(i), a1 = ang(i + 1);
      b.quad(
        [cx + x, cy + Math.cos(a0) * r0, cz + Math.sin(a0) * r0],
        [cx + x, cy + Math.cos(a1) * r0, cz + Math.sin(a1) * r0],
        [cx + x, cy + Math.cos(a1) * r1, cz + Math.sin(a1) * r1],
        [cx + x, cy + Math.cos(a0) * r1, cz + Math.sin(a0) * r1],
        [dir, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], col);
    }
  };

  // tread, crowned so the contact patch is not a flat ribbon
  band(matte, -hw, r * 0.955, -hw * 0.52, r, TYRE, [0, 1]);
  band(matte, -hw * 0.52, r, hw * 0.52, r, TYRE, [0, 1]);
  band(matte, hw * 0.52, r, hw, r * 0.955, TYRE, [0, 1]);
  for (const sx of [-1, 1]) {
    band(matte, sx * hw, r * 0.955, sx * hw * 1.10, r * 0.87, TYRE, [sx, 0.5]);
    band(matte, sx * hw * 1.10, r * 0.87, sx * hw * 0.96, bead, TYRE, [sx, 0.3]);
    band(trim, sx * hw * 0.96, bead, sx * hw * 0.55, bead * 0.99, RIM, [0, 1]);
  }
  // inboard face is a plain dish -- nothing behind a car's wheel is ever in
  // frame, and a bike (out 0) has no inboard face to hide
  if (out !== 0) disc(trim, -out * hw * 0.55, bead * 0.99, r * 0.16, -out, HUB);

  const dress = (o) => {
    const face = o * hw * 0.55;       // rim face plane, set in from the sidewall
    // brake disc first, so it shows through the gaps between spokes
    band(trim, face * 0.30, r * 0.60, face * 0.46, r * 0.60, DISC, [0, 1]);
    disc(trim, face * 0.46, r * 0.60, r * 0.22, o, DISC);
    const ca = 2.35;
    trim.tube(
      [cx + face * 0.14, cy + Math.cos(ca - 0.34) * r * 0.52, cz + Math.sin(ca - 0.34) * r * 0.52],
      [cx + face * 0.14, cy + Math.cos(ca + 0.34) * r * 0.52, cz + Math.sin(ca + 0.34) * r * 0.52],
      r * 0.11, 6, CALIPER, true);

    disc(trim, face, bead * 0.99, bead * 0.88, o, RIM);            // rim lip
    band(trim, face, bead * 0.88, face * 0.62, bead * 0.88, RIM, [0, 1]);
    const SPOKES = 5;
    const hubR = r * 0.20, spokeX = face * 0.62;
    for (let s = 0; s < SPOKES; s++) {
      const a = (s / SPOKES) * Math.PI * 2 + 0.35;
      const p = (rr, da, x) => [cx + x, cy + Math.cos(a + da) * rr, cz + Math.sin(a + da) * rr];
      const wo = 0.30, wi = 0.17;
      trim.quad(p(bead * 0.89, -wo, face), p(bead * 0.89, wo, face), p(hubR, wi, spokeX), p(hubR, -wi, spokeX),
        [o, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], RIM);
      // sides, so a spoke has depth and catches the light along its edge
      for (const sg of [-1, 1]) {
        trim.quad(p(bead * 0.89, sg * wo, face), p(hubR, sg * wi, spokeX),
          p(hubR, sg * wi, spokeX - o * 0.03), p(bead * 0.89, sg * wo, face - o * 0.03),
          [0, -Math.sin(a + sg * wo) * sg, Math.cos(a + sg * wo) * sg], [0, 0, 1, 0, 1, 1, 0, 1], HUB);
      }
    }
    disc(trim, spokeX, hubR, r * 0.05, o, HUB);
    disc(trim, spokeX + o * 0.012, r * 0.09, 0.001, o, CHROME);
  };
  if (out === 0) { dress(1); dress(-1); } else dress(out);
}

/**
 * Knobbly tread for an off-road tyre: blocks standing proud of the crown in
 * two staggered rows, the shoulder rows wrapping over the edge of the
 * sidewall. A plain crowned tyre on a quad reads as a lawnmower's. Each knob
 * is five faces of a block laid in the wheel's own (axle, radial, tangent)
 * frame, so it turns with the wheel group like the rest of the tyre.
 */
function knobs(matte, cx, cy, cz, r, w) {
  const N = 14, hw = w / 2, h = r * 0.12;
  const block = (x0, x1, a, da, r0) => {
    const r1 = r0 + h;
    const P = (x, rr, aa) => [cx + x, cy + Math.cos(aa) * rr, cz + Math.sin(aa) * rr];
    const a0 = a - da, a1 = a + da;
    const up = [0, Math.cos(a), Math.sin(a)], t0 = [0, -Math.sin(a0), Math.cos(a0)], t1 = [0, Math.sin(a1), -Math.cos(a1)];
    const uv = [0, 0, 1, 0, 1, 1, 0, 1];
    matte.quad(P(x0, r1, a0), P(x1, r1, a0), P(x1, r1, a1), P(x0, r1, a1), up, uv, TYRE);
    matte.quad(P(x0, r0, a0), P(x1, r0, a0), P(x1, r1, a0), P(x0, r1, a0), [0, -t0[1], -t0[2]], uv, TYRE);
    matte.quad(P(x0, r0, a1), P(x1, r0, a1), P(x1, r1, a1), P(x0, r1, a1), [0, -t1[1], -t1[2]], uv, TYRE);
    matte.quad(P(x0, r0, a0), P(x0, r0, a1), P(x0, r1, a1), P(x0, r1, a0), [-1, 0, 0], uv, TYRE);
    matte.quad(P(x1, r0, a0), P(x1, r0, a1), P(x1, r1, a1), P(x1, r1, a0), [1, 0, 0], uv, TYRE);
  };
  const da = Math.PI / N * 0.42;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // centre row alternates sides; the shoulder blocks sit on the other half-turn
    const s = i % 2 ? 1 : -1;
    block(s * hw * 0.04, s * hw * 0.66, a, da, r - h);
    block(-s * hw * 0.60, -s * hw * 1.04, a + Math.PI / N, da * 0.9, r - h * 1.25);
  }
}

/**
 * A recess set into a body surface, facing +Z (`dir` 1) or -Z (`dir` -1).
 *
 * There is no boolean operation in this builder, so an aperture cannot be cut
 * out of a lofted shell, and a pocket sunk flush z-fights with the paint behind
 * it. The rim therefore stands about a centimetre PROUD of the surface: it
 * hides the skin behind it from every angle a car is seen from, and what reads
 * is a real opening rather than a black rectangle painted on the nose. This is
 * the difference between a grille and a decal, and between an exhaust outlet
 * and a pipe stuck on the bumper.
 *
 * Returns the back plane so the caller can put a lens or a mesh in it.
 */
function pocket(rimB, wallB, cx, cy, cz, hw, hh, depth, dir, o = {}) {
  const { rim = 0.03, lip = 0.022, rimCol = WHITE, wallCol = CAVITY, taper = 0.88 } = o;
  const zf = cz + dir * lip, zb = cz - dir * depth;
  const rect = (x, y, z) => [[cx - x, cy - y, z], [cx + x, cy - y, z], [cx + x, cy + y, z], [cx - x, cy + y, z]];
  const A = rect(hw + rim, hh + rim, zf), B = rect(hw, hh, zf);
  const C = rect(hw * taper, hh * taper, zb), D = rect(hw + rim, hh + rim, cz - dir * 0.01);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const ox = (A[i][0] + A[j][0]) / 2 - cx, oy = (A[i][1] + A[j][1]) / 2 - cy;
    const l = Math.hypot(ox, oy) || 1;
    rimB.quad(A[i], A[j], B[j], B[i], [0, 0, dir], [0, 0, 1, 0, 1, 1, 0, 1], rimCol);
    rimB.quad(A[i], A[j], D[j], D[i], [ox / l, oy / l, 0], [0, 0, 1, 0, 1, 1, 0, 1], rimCol);
    wallB.quad(B[i], B[j], C[j], C[i], [-ox / l, -oy / l, 0], [0, 0, 1, 0, 1, 1, 0, 1], wallCol);
  }
  wallB.quad(C[0], C[1], C[2], C[3], [0, 0, dir], [0, 0, 1, 0, 1, 1, 0, 1], wallCol);
  return { z: zb, hw: hw * taper, hh: hh * taper };
}

/**
 * Flat end face with the apertures genuinely cut out of it.
 *
 * `loft`'s cap is a solid triangle fan, so a `pocket` sunk into a capped end
 * looks straight back at painted bodywork a few centimetres behind the rim --
 * the grille and the headlamps come out as flat plates with a raised outline
 * and no depth at all. It does NOT show up in a render, which reads as "the
 * recess is too shallow"; a raycast down the middle of the grille returned
 * `paint` at z 2.21 with the pocket's own back panel 12 cm further in, which is
 * one step from the cause. Same lesson as the wheel-well slab.
 *
 * The face is built as horizontal bands with the aperture x-spans subtracted,
 * so there is nothing behind a hole. `prof` is [[y, halfWidth], ...] ascending
 * in y -- the end section's own outline, so the face follows the bodywork.
 * `holes` are [xCentre, yCentre, halfW, halfH] and mirror themselves in x.
 */
function endFace(b, z, dir, prof, holes, col) {
  const y0 = prof[0][0], y1 = prof[prof.length - 1][0];
  const hwAt = (y) => {
    if (y <= y0 || y >= y1) return 0;
    for (let i = 1; i < prof.length; i++) {
      if (y <= prof[i][0]) {
        const t = (y - prof[i - 1][0]) / ((prof[i][0] - prof[i - 1][0]) || 1);
        return prof[i - 1][1] + (prof[i][1] - prof[i - 1][1]) * t;
      }
    }
    return 0;
  };
  const cuts = new Set();
  for (const [, hy, , hh] of holes) { cuts.add(hy - hh); cuts.add(hy + hh); }
  // Every station of the outline is a band edge too. Banded only at the holes,
  // a face with none is three quads whose top one runs from full width down to
  // the crown's zero -- a 2 m cargo box's front face came out as a triangle
  // standing up above the cab.
  for (const [py] of prof) cuts.add(py);
  const edges = [y0, ...[...cuts].filter((y) => y > y0 && y < y1).sort((a, c) => a - c), y1];
  const n = [0, 0, dir];
  const clip = (x, y) => Math.max(-hwAt(y), Math.min(hwAt(y), x));
  for (let i = 0; i < edges.length - 1; i++) {
    // No subdivision: every station of the outline is already a band edge
    // (above), so the outer edge is exactly linear across each band. Splitting
    // each one in three as well was ~250 triangles a car that drew nothing new.
    const SUB = 1;
    for (let k = 0; k < SUB; k++) {
      const ya = edges[i] + ((edges[i + 1] - edges[i]) * k) / SUB;
      const yb = edges[i] + ((edges[i + 1] - edges[i]) * (k + 1)) / SUB;
      const mid = (ya + yb) / 2;
      const bad = [];
      for (const [hx, hy, hw, hh] of holes) {
        if (Math.abs(mid - hy) >= hh) continue;
        bad.push([hx - hw, hx + hw]);
        if (hx !== 0) bad.push([-hx - hw, -hx + hw]);
      }
      bad.sort((p, q) => p[0] - q[0]);
      const lim = Math.max(hwAt(ya), hwAt(yb));
      const spans = [];
      let x = -lim;
      for (const [a, c] of bad) { if (a > x) spans.push([x, Math.min(a, lim)]); x = Math.max(x, c); }
      if (x < lim) spans.push([x, lim]);
      for (const [xa, xb] of spans) {
        if (xb - xa < 1e-4) continue;
        b.quad([clip(xa, ya), ya, z], [clip(xb, ya), ya, z], [clip(xb, yb), yb, z], [clip(xa, yb), yb, z],
          n, [0, 0, 1, 0, 1, 1, 0, 1], col);
      }
    }
  }
}

/** Round version of `pocket` -- exhaust outlets, intakes. */
function hole(rimB, wallB, cx, cy, cz, r, depth, dir, o = {}) {
  const { rim = 0.022, lip = 0.016, seg = 12, rimCol = CHROME, wallCol = CAVITY } = o;
  const zf = cz + dir * lip, zb = cz - dir * depth;
  const at = (i, rr, z) => [cx + Math.cos((i / seg) * Math.PI * 2) * rr, cy + Math.sin((i / seg) * Math.PI * 2) * rr, z];
  for (let i = 0; i < seg; i++) {
    const j = i + 1;
    const mx = Math.cos(((i + 0.5) / seg) * Math.PI * 2), my = Math.sin(((i + 0.5) / seg) * Math.PI * 2);
    rimB.quad(at(i, r + rim, zf), at(j, r + rim, zf), at(j, r, zf), at(i, r, zf), [0, 0, dir], [0, 0, 1, 0, 1, 1, 0, 1], rimCol);
    rimB.quad(at(i, r + rim, zf), at(j, r + rim, zf), at(j, r + rim, cz - dir * 0.02), at(i, r + rim, cz - dir * 0.02),
      [mx, my, 0], [0, 0, 1, 0, 1, 1, 0, 1], rimCol);
    wallB.quad(at(i, r, zf), at(j, r, zf), at(j, r * 0.9, zb), at(i, r * 0.9, zb), [-mx, -my, 0], [0, 0, 1, 0, 1, 1, 0, 1], wallCol);
    wallB.tri([cx, cy, zb], at(i, r * 0.9, zb), at(j, r * 0.9, zb), [0, 0, dir], wallCol);
  }
}

/** Smooth curve through authored key stations, keyed on z. Keys ascend in z. */
function curve(keys) {
  return (z) => {
    if (z <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (z <= keys[i][0]) {
        const [z0, v0] = keys[i - 1], [z1, v1] = keys[i];
        const t = (z - z0) / (z1 - z0);
        // smoothstep, so the surface has no kink where two stations meet
        return v0 + (v1 - v0) * t * t * (3 - 2 * t);
      }
    }
    return keys[keys.length - 1][1];
  };
}

/**
 * The shared half of an authored body: the lofted volume, the wheel arches and
 * the end profiles the fascias are cut into.
 *
 * What is shared here is the TECHNIQUE, not the shape. Every number that
 * decides what the car looks like is a curve the caller writes; this function
 * only knows how to turn five curves into a shell with real arch openings and
 * to hand back the section so the caller can register panels against it. That
 * distinction is the whole difference from `buildGeneric`, where the shape
 * itself came out of one parameterised tube.
 */
function bodyCore(spec, paint, matte, cfg) {
  const {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR = 0.55, archGap = 0.05, archPow = 2, creaseAt = 0.60, tumble = 0.90,
    deckDrop = 0.030, lipOut = 0.07, endRound = 0.12, endMin = 0.88,
    lipInto = paint, lipCol = WHITE, deckDip = null,
    stations = 44,
  } = cfg;
  const W = spec.wid / 2, wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const archTop = wr * 2 + archGap;              // the opening clears the tyre
  // `archPow` squares the opening off. 2 is a semicircle, which is a car; above
  // that the corners pull out toward a rectangle, which is what a truck or a
  // crossover has, and it is visible in silhouette from across a street.
  // Everything downstream reads the arch through this ONE function -- the lip
  // takes its y from `half()` and the liner calls `archShape` itself -- so a
  // change of profile cannot leave the lip trimming a differently-shaped hole.
  const archShape = (u) => (1 - Math.abs(u) ** archPow) ** (1 / archPow);
  const archLift = (z) => {
    let l = 0;
    for (const az of [zR, zF]) {
      const d = Math.abs(z - az);
      if (d < archR) l = Math.max(l, archTop * archShape(d / archR));
    }
    return l;
  };

  const geom = (z) => {
    const w = W * halfW(z);
    const y0 = Math.max(sillY(z), archLift(z));
    const y1 = beltY(z);
    const h = Math.max(0.10, y1 - y0);
    return { w, wb: w * tuckAt(z), tw: w * topAt(z), y0, y1, h, yc: y0 + h * creaseAt };
  };

  // Half the body section, sill to deck centre. Two points are DOUBLED -- the
  // shoulder crease and the bonnet crest. `loft` averages a point's normals
  // from its neighbours, so a single corner shades as a soft radius however
  // sharp the numbers are; two coincident points give the surfaces either side
  // their own normal and the flank gets a hard folded line down it. That line
  // is most of what says a body was styled rather than extruded.
  //
  // `deckDip` sinks the two innermost points to a floor height, which turns
  // the closed deck into an open tub -- the convertible's cockpit. It is done
  // HERE, in the section, rather than by laying an interior over the deck,
  // because there is no boolean operation in this builder: bodywork drawn at
  // the beltline across the middle of the car hides anything put underneath it,
  // and no amount of interior helps if the lid is still on.
  const half = (z, s) => {
    const g = geom(z);
    const dip = deckDip ? Math.max(deckDip(z), g.y0 + 0.06) : null;
    if (dip !== null && dip < g.y1 - 0.02) {
      return [
        [s * g.wb * 0.58, g.y0],
        [s * g.wb, g.y0 + g.h * 0.06],
        [s * g.w * 0.975, g.y0 + g.h * 0.30],
        [s * g.w, g.yc - g.h * 0.10],
        [s * g.w, g.yc],
        [s * g.w, g.yc + 0.006],
        [s * g.w * 0.965, g.yc + g.h * 0.16],
        [s * g.w * tumble, g.y1 - g.h * 0.22],
        [s * g.tw, g.y1 - deckDrop],
        [s * g.tw * 0.965, g.y1 - deckDrop - 0.030],   // the door's inner lip
        [s * g.tw * 0.72, dip],                        // tub wall, then floor
        [s * g.tw * 0.24, dip],
      ];
    }
    return [
      [s * g.wb * 0.58, g.y0],
      [s * g.wb, g.y0 + g.h * 0.06],            // sill outer -- the arch edge
      [s * g.w * 0.975, g.y0 + g.h * 0.30],
      [s * g.w, g.yc - g.h * 0.10],
      [s * g.w, g.yc],
      [s * g.w, g.yc + 0.006],                  // crease, doubled
      [s * g.w * 0.965, g.yc + g.h * 0.16],
      [s * g.w * tumble, g.y1 - g.h * 0.22],    // tumblehome
      [s * g.tw, g.y1 - deckDrop],              // shoulder / deck edge
      [s * g.tw * 0.995, g.y1 - deckDrop + 0.008],
      [s * g.tw * 0.70, g.y1],
      [s * g.tw * 0.24, g.y1 + 0.008],
    ];
  };
  const P_SILL = 1;                             // index into half(), above

  // The last few centimetres at each end roll in, so the nose and tail have a
  // radius rather than a sheared-off edge. Not to a point, though: what is left
  // is the fascia the lamps and the grille are set into.
  const endK = (z) => {
    const e = Math.min((nose - z) / endRound, (z - tail) / endRound);
    return e >= 1 ? 1 : endMin + (1 - endMin) * Math.sqrt(Math.max(0, e));
  };
  const bodyRings = [];
  for (let i = 0; i <= stations; i++) {
    const z = tail + (nose - tail) * (i / stations);
    const g = geom(z), mid = (g.y0 + g.y1) / 2, k = endK(z);
    bodyRings.push({
      z,
      pts: [...half(z, -1), ...half(z, 1).reverse()].map(([x, y]) => [x * k, mid + (y - mid) * k]),
    });
  }
  // Uncapped: `endFace` closes both ends, with the apertures cut out of them.
  paint.loft(bodyRings, WHITE, { capStart: false, capEnd: false });

  // Wheel arches: a flared lip outside, a dark liner tunnelled in behind it.
  // Both walk the same angles and read their x from the same `half` that drew
  // the body, so the lip cannot drift off the opening it is trimming -- the
  // arithmetic that would have to be kept in step simply does not exist.
  const arch = (az, sx) => {
    // Where the opening meets the sill, inverted through `archShape` rather
    // than assumed to be a sine -- with a squared arch the two differ by enough
    // to leave the lip hanging in mid-air at both ends.
    const s = Math.min(0.99, sillY(az) / archTop);
    const th0 = Math.acos((1 - s ** archPow) ** (1 / archPow)) + 0.04;
    const N = 12;
    const lip = [[], [], []], liner = [[], [], [], []];
    // The liner closes over toward the axle, so an arch is a dark cavity from
    // every angle rather than a hole you can see daylight through.
    const inner = [[0.008, 1.00], [0.26, 1.00], [0.30, 0.74], [0.31, 0.26]];
    for (let i = 0; i <= N; i++) {
      const th = th0 + ((Math.PI - 2 * th0) * i) / N;
      const z = az + Math.cos(th) * archR;
      const [lx, ly] = half(z, sx)[P_SILL];
      lip[0].push([lx, ly, z]);
      lip[1].push([lx + sx * lipOut, ly - 0.014, z]);
      lip[2].push([lx + sx * lipOut * 0.66, ly - 0.058, z]);
      for (let k = 0; k < 4; k++) {
        const [inset, t] = inner[k];
        liner[k].push([lx - sx * inset,
          wr * 0.42 + (archTop * 0.97 * archShape(Math.cos(th)) - wr * 0.42) * t,
          az + Math.cos(th) * archR * 0.97 * t]);
      }
    }
    lipInto.patch(lip, lipCol, [sx, 0.2, 0]);
    matte.patch(liner, CAVITY, [-sx, 0, 0]);
  };
  for (const az of [zF, zR]) for (const sx of [-1, 1]) arch(az, sx);

  return {
    geom,
    half,
    /**
     * A point of the DRAWN shell: `half` with the end roll-in applied, pushed
     * `d` metres out along the section. A lens or a stripe laid on the flank
     * near an end has to follow the shell as lofted -- `half` is the section
     * before the nose rolls in, and a patch built from it stands off the paint
     * by up to 12 % of the section there.
     */
    surf: (z, s, i, d = 0) => {
      const g = geom(z), mid = (g.y0 + g.y1) / 2, k = endK(z);
      const [x, y] = half(z, s)[i];
      const px = x * k, py = mid + (y - mid) * k;
      const l = Math.hypot(px, py - mid) || 1;
      return [px + (px / l) * d, py + ((py - mid) / l) * d, z];
    },
    /** The end section as [[y, halfWidth], ...] ascending, for `endFace`. */
    endProf: (z) => {
      const g = geom(z), mid = (g.y0 + g.y1) / 2, k = endK(z);
      return half(z, 1).map(([x, y]) => [mid + (y - mid) * k, x * k]);
    },
  };
}

/**
 * The sports car, modelled rather than parameterised.
 *
 * The technique, which is the point of this function and is meant to be copied
 * for the rest of the fleet:
 *
 *  1. The main volume is still a loft, but through ~44 stations driven by
 *     SEPARATE authored curves for half-width, sill height and beltline. One
 *     curve per feature is what lets the nose be low while the cowl rises and
 *     the rear haunch stands over the wheel -- with a single scalar and a
 *     handful of flags every car is the same tube at a different size.
 *  2. The wheel arches are cut into that loft's bottom edge and then dressed:
 *     a flared lip built from the SAME curves (so it registers by construction
 *     rather than by arithmetic that has to be kept in step) and a dark liner
 *     tunnelled in behind it. An arch has to be an opening; a chamfer in a
 *     straight sill reads as a toy.
 *  3. Everything that should be a hole -- grille, headlamps, taillamps,
 *     exhausts -- is a `pocket`/`hole` whose rim stands proud of the paint.
 *     See those functions for why proud and not flush.
 *  4. The greenhouse is authored PANELS: windscreen, two side windows and a
 *     rear screen in glass, with A-pillars, a roof and sail panels in body
 *     colour between them. This is also how the floating-roof-plank bug is
 *     designed out -- there is no roof skin lofted over a glass tube to
 *     mis-register, the roof is a panel whose edges are shared points with the
 *     glass either side of it.
 */
function buildSports(spec, paint, trim, matte) {
  const W = spec.wid / 2, wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.36, zR = -1.36;               // axle centres, 2.72 m wheelbase

  // --- the four longitudinal curves ----------------------------------------
  // The full declared width is spent on the arches and the waist between them
  // is pulled in, rather than the whole flank being one width. That difference
  // is what a flare IS -- with a constant width there is nothing for the lip to
  // stand proud of and the car reads slab-sided at any track.
  const halfW = curve([
    [tail, 0.84], [-1.95, 0.94], [zR, 1.00], [-0.70, 0.90], [0, 0.885],
    [0.70, 0.90], [zF, 0.985], [1.85, 0.90], [2.10, 0.85], [nose, 0.76],
  ]);
  const sillY = curve([
    [tail, 0.36], [-1.85, 0.24], [-0.60, 0.19], [0.60, 0.19], [1.85, 0.24], [nose, 0.24],
  ]);
  // Low nose, rising cowl, haunch over the rear axle, then down to the tail.
  const beltY = curve([
    [tail, 0.90], [-1.90, 0.98], [zR, 1.00], [-0.60, 0.96], [0, 0.94],
    [0.55, 0.95], [0.88, 0.94], [1.20, 0.90], [1.55, 0.85], [1.90, 0.80], [nose, 0.76],
  ]);
  // How far the sill tucks under. Pinched at the waist between the arches and
  // let out over them, which is what makes the flares read as flares.
  const tuckAt = curve([
    [tail, 0.84], [zR, 0.93], [-0.60, 0.85], [0.60, 0.85], [zF, 0.93], [nose, 0.84],
  ]);
  // Width of the flat top deck. Narrow at the ends (a crowned bonnet and boot
  // lid), wide across the cabin so the greenhouse has something to stand on.
  const topAt = curve([
    [tail, 0.84], [-1.60, 0.90], [0.60, 0.90], [1.50, 0.88], [2.05, 0.78], [nose, 0.70],
  ]);

  const { geom, half, endProf } = bodyCore(spec, paint, matte,
    { halfW, sillY, beltY, tuckAt, topAt, zF, zR });

  // --- wheels --------------------------------------------------------------
  // Staggered: the rear tyre is wider than the front, which is most of what
  // says "rear drive" about a shape standing still.
  const twF = 0.235, twR = 0.28;
  const wxF = geom(zF).wb - twF / 2 + 0.02;
  const wxR = geom(zR).wb - twR / 2 + 0.02;
  const wheels = [
    [-wxF, wr, zF, wr, twF], [wxF, wr, zF, wr, twF],
    [-wxR, wr, zR, wr, twR], [wxR, wr, zR, wr, twR],
  ];

  // --- greenhouse: separate panels, real pillars ---------------------------
  const cowlZ = 0.82, cowlY = 0.955;
  const scrZ = -0.08, roofY = spec.roof;
  const backZ = -0.72;
  const rearZ = -1.62, rearY = 1.00;
  // The roof is the widest thing up here and the side glass tucks in under it.
  // The other way round, the glass hides the roof panel from every side angle
  // and the whole greenhouse reads as one dark mass with no roof at all.
  const wScrB = 0.70, wScrT = 0.585, wRoof = 0.60, wRearT = 0.578, wRear = 0.66;
  const wGlassT = 0.572, wGlassB = 0.678;

  const lp = (a, b, t) => a + (b - a) * t;
  // Windscreen: bowed forward in the middle and wrapped back at the edges,
  // which is what stops a screen reading as a flat sheet of slate.
  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(cowlZ, scrZ, t) + 0.035 * Math.sin(Math.PI * t);
    const cy = lp(cowlY, roofY, t) + 0.012 * Math.sin(Math.PI * t);
    const hwv = lp(wScrB, wScrT, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.030 * u * u, cz - 0.10 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);

  // Roof, with the outermost column rolled down into a drip rail so the panel
  // has an edge instead of ending in a knife.
  const roofCols = [[-0.98, -0.055], [-1, -0.012], [-0.94, 0], [-0.66, 0.008], [-0.3, 0.013],
    [0, 0.015], [0.3, 0.013], [0.66, 0.008], [0.94, 0], [1, -0.012], [0.98, -0.055]];
  const roofRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const cz = lp(scrZ, backZ, t), cy = lp(roofY, roofY - 0.01, t) + 0.008 * Math.sin(Math.PI * t);
    roofRows.push(roofCols.map(([u, dy]) => [u * wRoof, cy + dy - 0.022 * u * u, cz]));
  }
  paint.patch(roofRows, WHITE, [0, 1, 0]);

  // Fastback rear screen.
  const rearRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(backZ, rearZ, t), cy = lp(roofY - 0.01, rearY, t) + 0.022 * Math.sin(Math.PI * t);
    const hwv = lp(wRearT, wRear, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.035 * u * u, cz + 0.05 * u * u]);
    }
    rearRows.push(row);
  }
  trim.patch(rearRows, GLASS, [0, 0.6, -1]);

  // Side glass and the sail panel behind it, per side.
  const sgFB = [0.66, 0.965], sgFT = [-0.02, 1.272], sgRT = [-0.78, 1.258], sgRB = [-1.16, 1.01];
  carCabin(matte, { cowlZ, cowlY, scrZ, roofY, backZ, rearZ, rearY, wScrB, wRoof, wRear, wGlassT, wGlassB, sgFB, sgRB, rows: [-0.46], scrWrap: 0.1, rearWrap: 0.05 }, paint);
  for (const sx of [-1, 1]) {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 4; j++) {
        const u = j / 4;
        const bz = lp(sgFB[0], sgRB[0], u), by = lp(sgFB[1], sgRB[1], u);
        const tz = lp(sgFT[0], sgRT[0], u), ty = lp(sgFT[1], sgRT[1], u);
        row.push([sx * lp(wGlassB, wGlassT, t), lp(by, ty, t), lp(bz, tz, t)]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sx, 0, 0]);

    // A-pillar: the strip between the windscreen's outer edge and the front
    // edge of the side glass, built from the screen's OWN edge points so it is
    // flush with it. The first pass ran a `tube` up there and it read as a roll
    // bar lying on the roof -- a pillar is a panel, not a pipe.
    paint.patch(scrRows.map((r, i) => {
      const e = r[r.length - 1], t = i / 3;
      return [[sx * e[0], e[1], e[2]],
        [sx * lp(wGlassB, wGlassT, t), lp(sgFB[1], sgFT[1], t), lp(sgFB[0], sgFT[0], t)]];
    }), WHITE, [sx, 0.4, 0]);
    // C-pillar / sail panel: the fastback's shoulder, running from the rear
    // screen's own outer edge out to the back of the side glass and down to the
    // deck. It starts as a line where the glass meets the screen -- built from
    // two independent outlines instead it comes out twisted, and a twisted quad
    // reads as a flat plate stuck on the quarter.
    const sailOuter = [[wGlassT, sgRT[1], sgRT[0]], [0.640, 1.130, -1.02],
      [wGlassB, sgRB[1], sgRB[0]], [0.700, 0.965, rearZ]];
    paint.patch(rearRows.map((r, i) => {
      const e = r[r.length - 1], o = sailOuter[i];
      return [[sx * e[0], e[1], e[2]], [sx * o[0], o[1], o[2]]];
    }), WHITE, [sx, 0.4, 0]);
  }

  // --- front fascia --------------------------------------------------------
  // Every aperture is listed once and drives both the hole in the face and the
  // pocket set into it -- two lists that have to agree is how a recess ends up
  // with a rim over solid paint.
  const GRILLE = [0, 0.455, 0.28, 0.065], LAMP_A = [0.345, 0.60, 0.128, 0.055];
  const INTAKE = [0, 0.335, 0.40, 0.035];
  const TAILBAR = [0, 0.72, 0.50, 0.05], PIPE = [0.34, 0.48, 0.040, 0.040];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILBAR, PIPE], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.16, 1);
  // slats standing in the mouth, not painted on the nose
  for (let i = 0; i < 3; i++) {
    trim.box(0, 0.415 + i * 0.040, gp.z + 0.03, gp.hw * 1.9, 0.014, 0.035, 0, CHROME);
  }
  for (const sx of [-1, 1]) {
    const lp2 = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.11, 1, { rim: 0.024 });
    // Lens near the MOUTH of the housing, not at the back of it. `trim` is
    // metalness 0.88, so a coloured lens buried 10 cm inside a black pocket
    // sees nothing to reflect and renders as another patch of the pocket.
    trim.box(sx * LAMP_A[0], 0.575, nose - 0.035, lp2.hw * 1.86, 0.050, 0.024, 0, LAMP);
    trim.box(sx * LAMP_A[0], 0.552, lp2.z + 0.05, lp2.hw * 1.86, 0.014, 0.024, 0, AMBER);
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.14, 1, { rim: 0.026 });
  // splitter: a blade under the nose, tucked close enough to read as part of
  // the car rather than a tray sliding out from under it
  matte.box(0, 0.226, nose - 0.06, 1.24, 0.030, 0.28, 0, PLASTIC);
  for (const sx of [-1, 1]) matte.box(sx * 0.60, 0.226, nose - 0.11, 0.05, 0.09, 0.16, 0, PLASTIC);

  // --- rear ----------------------------------------------------------------
  const rz = tail;
  const tp = pocket(paint, matte, TAILBAR[0], TAILBAR[1], rz, TAILBAR[2], TAILBAR[3], 0.09, -1, { rim: 0.026 });
  trim.box(0, 0.678, rz + 0.024, tp.hw * 1.94, 0.086, 0.026, 0, TAILC);
  // one body-colour bridge across the middle, so the bar reads as two lamps
  paint.box(0, 0.665, rz + 0.014, 0.10, 0.11, 0.035, 0, WHITE);
  for (const sx of [-1, 1]) {
    trim.box(sx * 0.40, 0.605, rz - 0.03, 0.11, 0.05, 0.022, 0, WHITE);   // reversing lamp
    hole(trim, matte, sx * PIPE[0], PIPE[1], rz, 0.055, 0.12, -1);
  }
  trim.box(0, 0.492, rz - 0.028, 0.42, 0.135, 0.02, 0, PLATE);
  // diffuser: a ramp under the tail with fins standing in it
  matte.patch([
    [[-0.56, 0.17, -1.82], [0, 0.17, -1.82], [0.56, 0.17, -1.82]],
    [[-0.52, 0.38, rz - 0.02], [0, 0.38, rz - 0.02], [0.52, 0.38, rz - 0.02]],
  ], PLASTIC, [0, -1, 0]);
  for (const x of [-0.44, -0.22, 0, 0.22, 0.44]) {
    matte.box(x, 0.16, -2.02, 0.028, 0.20, 0.40, 0, PLASTIC);
  }

  // --- flanks: side skirts, shut lines, handles, mirrors -------------------
  for (const sx of [-1, 1]) {
    matte.box(sx * (geom(0).wb - 0.02), 0.175, 0, 0.09, 0.05, 1.62, 0, PLASTIC);
    // Shut lines follow the section itself rather than being a straight box
    // laid on a curved flank, which is why they stay a constant hairline all
    // the way up the door.
    for (const zc of [0.62, -0.64]) {
      const rows = [-0.009, 0.009].map((dz) =>
        half(zc + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, zc + dz]));
      matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    }
    const hg = geom(-0.06);
    trim.tube([sx * (hg.w * 0.985), hg.yc + 0.075, -0.10], [sx * (hg.w * 0.985), hg.yc + 0.075, 0.10],
      0.017, 6, CHROME, true);
    // mirror on a stalk, not a block bolted to the door
    paint.tube([sx * 0.700, 0.960, 0.64], [sx * 0.828, 0.995, 0.60], 0.021, 6, WHITE, true);
    const pod = (k) => {
      const out = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        out.push([sx * 0.878 + Math.cos(a) * 0.058 * k, 1.005 + Math.sin(a) * 0.046 * k]);
      }
      return out;
    };
    paint.loft([{ z: 0.505, pts: pod(0.86) }, { z: 0.575, pts: pod(1) }, { z: 0.645, pts: pod(0.78) }],
      WHITE, { capStart: true, capEnd: true });
    trim.box(sx * 0.878, 0.962, 0.498, 0.094, 0.072, 0.02, 0, MIRROR);
  }

  // --- rear wing -----------------------------------------------------------
  const blade = (yb, yt, k) => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      out.push([Math.cos(a) * 0.62 * k, (yb + yt) / 2 + Math.sin(a) * ((yt - yb) / 2)]);
    }
    return out;
  };
  paint.loft([
    { z: -1.70, pts: blade(1.030, 1.062, 1) },
    { z: -1.86, pts: blade(1.048, 1.086, 1) },
    { z: -2.00, pts: blade(1.064, 1.100, 0.985) },
  ], WHITE, { capStart: true, capEnd: true });
  for (const sx of [-1, 1]) {
    paint.tube([sx * 0.44, beltY(-1.84) - 0.01, -1.84], [sx * 0.44, 1.05, -1.84], 0.028, 6, WHITE, true);
    // end plate
    paint.box(sx * 0.615, 1.01, -1.85, 0.022, 0.12, 0.34, 0, WHITE);
  }
  // engine cover louvres, so the rear deck is not a blank lid
  for (let i = 0; i < 3; i++) {
    const lz = -1.70 - i * 0.10;
    matte.box(0, beltY(lz) - 0.014, lz, 0.60, 0.024, 0.055, 0, [0.10, 0.11, 0.12]);
  }
  // bonnet extractors: the front deck is the largest blank panel on the car
  for (const sx of [-1, 1]) {
    matte.box(sx * 0.30, beltY(1.52) - 0.020, 1.52, 0.24, 0.030, 0.13, 0, [0.08, 0.09, 0.10]);
  }

  return wheels;
}

/**
 * The muscle car, hand built on the same core as the sports car and sharing
 * none of its numbers: long flat bonnet, short deck, a formal notchback roof,
 * quad round lamps sunk in a full-width grille, chrome bumpers at both ends and
 * hips over the rear axle. Slab-sided on purpose -- the tumblehome and the
 * waist are both much flatter here, which is most of what separates 1970 from
 * a modern coupe.
 */
function buildMuscle(spec, paint, trim, matte) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.40, zR = -1.34;

  const halfW = curve([
    [tail, 0.90], [-2.10, 0.97], [zR, 1.00], [-0.55, 0.92], [0.30, 0.92],
    [zF, 0.985], [2.10, 0.94], [nose, 0.86],
  ]);
  const sillY = curve([
    [tail, 0.34], [-2.00, 0.26], [-0.60, 0.24], [0.60, 0.24], [2.00, 0.26], [nose, 0.34],
  ]);
  const beltY = curve([
    [tail, 1.02], [-2.05, 1.06], [zR, 1.08], [-0.60, 1.04], [0.20, 1.02],
    [0.85, 1.02], [1.30, 1.00], [1.90, 0.96], [2.25, 0.94], [nose, 0.92],
  ]);
  const tuckAt = curve([
    [tail, 0.88], [zR, 0.95], [-0.60, 0.88], [0.60, 0.88], [zF, 0.95], [nose, 0.88],
  ]);
  const topAt = curve([
    [tail, 0.90], [-1.90, 0.94], [0.80, 0.94], [1.60, 0.93], [2.20, 0.86], [nose, 0.78],
  ]);
  const { geom, half, endProf } = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR: 0.58, archGap: 0.06, creaseAt: 0.66, tumble: 0.94,
    deckDrop: 0.026, lipOut: 0.05, endRound: 0.14, endMin: 0.90,
  });

  const twF = 0.24, twR = 0.30;
  const wxF = geom(zF).wb - twF / 2 + 0.02;
  const wxR = geom(zR).wb - twR / 2 + 0.02;
  const wheels = [
    [-wxF, wr, zF, wr, twF], [wxF, wr, zF, wr, twF],
    [-wxR, wr, zR, wr, twR], [wxR, wr, zR, wr, twR],
  ];

  // --- notchback greenhouse ------------------------------------------------
  const cowlZ = 0.72, cowlY = 1.035, roofY = spec.roof;
  const scrZ = -0.22, backZ = -1.06, rearZ = -1.62, rearY = 1.055;
  const wScrB = 0.76, wScrT = 0.66, wRoof = 0.68, wRearT = 0.655, wRear = 0.74;
  const wGlassT = 0.652, wGlassB = 0.755;
  const lp = (a, b, t) => a + (b - a) * t;

  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(cowlZ, scrZ, t) + 0.03 * Math.sin(Math.PI * t);
    const cy = lp(cowlY, roofY, t) + 0.012 * Math.sin(Math.PI * t);
    const hwv = lp(wScrB, wScrT, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.028 * u * u, cz - 0.09 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);

  const roofCols = [[-0.98, -0.05], [-1, -0.010], [-0.94, 0], [-0.66, 0.006], [-0.3, 0.010],
    [0, 0.012], [0.3, 0.010], [0.66, 0.006], [0.94, 0], [1, -0.010], [0.98, -0.05]];
  const roofRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const cz = lp(scrZ, backZ, t), cy = roofY + 0.006 * Math.sin(Math.PI * t);
    roofRows.push(roofCols.map(([u, dy]) => [u * wRoof, cy + dy - 0.020 * u * u, cz]));
  }
  paint.patch(roofRows, WHITE, [0, 1, 0]);

  // A notchback's rear screen is steep and short, and the boot lid behind it is
  // flat -- that break is the whole difference from the sports car's fastback.
  const rearRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(backZ, rearZ, t), cy = lp(roofY - 0.006, rearY, t) + 0.014 * Math.sin(Math.PI * t);
    const hwv = lp(wRearT, wRear, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.028 * u * u, cz + 0.04 * u * u]);
    }
    rearRows.push(row);
  }
  trim.patch(rearRows, GLASS, [0, 0.7, -1]);

  const sgFB = [0.60, 1.035], sgFT = [-0.16, 1.360], sgRT = [-1.06, 1.352], sgRB = [-1.34, 1.058];
  carCabin(matte, { cowlZ, cowlY, scrZ, roofY, backZ, rearZ, rearY, wScrB, wRoof, wRear, wGlassT, wGlassB, sgFB, sgRB, rows: [-0.30, -1.02], scrWrap: 0.09, rearWrap: 0.04 }, paint);
  for (const sx of [-1, 1]) {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 4; j++) {
        const u = j / 4;
        const bz = lp(sgFB[0], sgRB[0], u), by = lp(sgFB[1], sgRB[1], u);
        const tz = lp(sgFT[0], sgRT[0], u), ty = lp(sgFT[1], sgRT[1], u);
        row.push([sx * lp(wGlassB, wGlassT, t), lp(by, ty, t), lp(bz, tz, t)]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sx, 0, 0]);
    paint.patch(scrRows.map((r, i) => {
      const e = r[r.length - 1], t = i / 3;
      return [[sx * e[0], e[1], e[2]],
        [sx * lp(wGlassB, wGlassT, t), lp(sgFB[1], sgFT[1], t), lp(sgFB[0], sgFT[0], t)]];
    }), WHITE, [sx, 0.4, 0]);
    const sailOuter = [[wGlassT, sgRT[1], sgRT[0]], [0.700, 1.250, -1.20],
      [wGlassB, sgRB[1], sgRB[0]], [0.760, 1.030, rearZ]];
    paint.patch(rearRows.map((r, i) => {
      const e = r[r.length - 1], o = sailOuter[i];
      return [[sx * e[0], e[1], e[2]], [sx * o[0], o[1], o[2]]];
    }), WHITE, [sx, 0.4, 0]);
  }

  // --- front: quad lamps sunk in one full-width grille ----------------------
  const GRILLE = [0, 0.66, 0.60, 0.085], INTAKE = [0, 0.47, 0.46, 0.045];
  const TAILA = [0.40, 0.72, 0.24, 0.075], PIPE = [0.42, 0.60, 0.038, 0.038];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILA, PIPE], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.15, 1,
    { rim: 0.034, rimCol: WHITE });
  // Round sealed-beam units standing in the grille, chrome-ringed. They sit in
  // the recess rather than being holes of their own: a hole inside a hole needs
  // the back panel pierced too, and a lamp on a stalk in a dark pocket already
  // reads as inset from anywhere a player stands.
  for (const sx of [-1, 1]) {
    for (const xc of [0.24, 0.485]) {
      // Chrome barrel down the pocket with the lens across its mouth. Buried at
      // the back of the recess a lens has nothing to catch, and `trim` is
      // metalness 0.88 -- it renders as more pocket.
      trim.tube([sx * xc, GRILLE[1], gp.z + 0.01], [sx * xc, GRILLE[1], nose - 0.03], 0.082, 12, CHROME);
      trim.tube([sx * xc, GRILLE[1], nose - 0.055], [sx * xc, GRILLE[1], nose - 0.028], 0.072, 12, LAMP, true);
    }
    trim.box(sx * 0.62, 0.60, nose - 0.02, 0.10, 0.05, 0.03, 0, AMBER);
  }
  // grille mesh: vertical bars right across the mouth
  for (let i = -5; i <= 5; i++) {
    trim.box(i * 0.105, GRILLE[1] - 0.072, gp.z + 0.012, 0.016, 0.144, 0.02, 0, [0.30, 0.31, 0.33]);
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.11, 1, { rim: 0.026 });
  // Chrome bumper. A muscle car's is a separate bright bar standing off the
  // bodywork, not a colour-keyed moulding.
  trim.box(0, 0.372, nose + 0.012, 1.56, 0.098, 0.13, 0, CHROME);
  trim.box(0, 0.400, nose + 0.05, 0.42, 0.135, 0.02, 0, PLATE);

  // --- rear ----------------------------------------------------------------
  for (const sx of [-1, 1]) {
    const tp = pocket(paint, matte, sx * TAILA[0], TAILA[1], tail, TAILA[2], TAILA[3], 0.07, -1,
      { rim: 0.028 });
    trim.box(sx * TAILA[0], 0.655, tail + 0.022, tp.hw * 1.9, 0.130, 0.026, 0, TAILC);
    // three chrome ribs across each lens, the era's signature
    for (const d of [-0.045, 0, 0.045]) {
      trim.box(sx * TAILA[0] + d, 0.660, tail + 0.008, 0.014, 0.120, 0.02, 0, CHROME);
    }
    hole(trim, matte, sx * PIPE[0], PIPE[1], tail, 0.052, 0.12, -1);
  }
  trim.box(0, 0.372, tail - 0.012, 1.56, 0.098, 0.13, 0, CHROME);
  trim.box(0, 0.560, tail - 0.028, 0.42, 0.135, 0.02, 0, PLATE);
  // ducktail lip along the trailing edge of the boot lid
  paint.box(0, beltY(-2.28) - 0.01, -2.30, geom(-2.30).tw * 1.9, 0.055, 0.20, 0, WHITE);

  // --- bonnet scoop, flanks, trim ------------------------------------------
  const scoopY = beltY(1.62) - 0.02;
  paint.box(0, scoopY, 1.62, 0.66, 0.105, 0.78, 0, WHITE);
  pocket(paint, matte, 0, scoopY + 0.055, 2.02, 0.26, 0.035, 0.10, 1, { rim: 0.02 });
  for (const sx of [-1, 1]) {
    trim.box(sx * (geom(0).wb + 0.01), 0.255, 0, 0.03, 0.05, 2.10, 0, CHROME);  // rocker trim
    for (const zc of [0.55, -0.72]) {
      const rows = [-0.009, 0.009].map((dz) =>
        half(zc + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, zc + dz]));
      matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    }
    const hg = geom(-0.12);
    trim.tube([sx * hg.w * 0.985, hg.yc + 0.08, -0.22], [sx * hg.w * 0.985, hg.yc + 0.08, -0.02],
      0.017, 6, CHROME, true);
    // chrome bullet mirror on a short stalk
    trim.tube([sx * 0.760, 1.030, 0.50], [sx * 0.860, 1.070, 0.46], 0.018, 6, CHROME, true);
    trim.tube([sx * 0.860, 1.070, 0.52], [sx * 0.878, 1.074, 0.40], 0.052, 8, CHROME, true);
    trim.box(sx * 0.868, 1.032, 0.398, 0.086, 0.078, 0.02, 0, MIRROR);
    // side gill behind the front arch
    for (let i = 0; i < 3; i++) {
      matte.box(sx * (geom(0.72).w + 0.004), geom(0.72).yc - 0.10 + i * 0.05, 0.72,
        0.012, 0.032, 0.24, 0, [0.10, 0.11, 0.12]);
    }
  }

  return wheels;
}

/**
 * The full-size American sedan -- the commonest car on these streets, so the
 * one that matters most. Long bonnet, long boot, a formal notchback greenhouse
 * on a thick C-pillar, a wide horizontal-bar grille and a tail lamp panel that
 * runs the whole width.
 *
 * Against the muscle car, which is the nearest thing to it in the fleet: the
 * cabin is a metre longer and sits further back (four doors, not two), the roof
 * is level rather than domed, and the flanks carry almost no flare. A full-size
 * sedan reads big precisely because nothing on it is dramatic, so the shape has
 * to be carried by proportion -- overhangs, the length of the roof and the
 * height of the beltline -- rather than by features.
 */
function buildSedan(spec, paint, trim, matte) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.52, zR = -1.46;                 // 2.98 m wheelbase

  // Nearly full width down the whole flank: a sedan's arches are wheel openings
  // in a flat side, not flares standing out of a waisted one.
  const halfW = curve([
    [tail, 0.86], [-2.20, 0.95], [zR, 1.00], [-0.60, 0.955], [0.60, 0.955],
    [zF, 1.00], [2.20, 0.95], [nose, 0.90],
  ]);
  const sillY = curve([
    [tail, 0.36], [-2.05, 0.30], [-0.60, 0.28], [0.60, 0.28], [2.05, 0.30], [nose, 0.36],
  ]);
  // A high, level beltline. The bonnet falls only 11 cm over 1.6 m, which is
  // what makes it read as long rather than as a wedge.
  const beltY = curve([
    [tail, 1.00], [-2.15, 1.05], [zR, 1.07], [-0.60, 1.06], [0.30, 1.055],
    [0.85, 1.045], [1.50, 1.01], [2.10, 0.98], [nose, 0.95],
  ]);
  const tuckAt = curve([
    [tail, 0.90], [zR, 0.95], [-0.60, 0.90], [0.60, 0.90], [zF, 0.95], [nose, 0.90],
  ]);
  const topAt = curve([
    [tail, 0.86], [-2.10, 0.92], [-1.10, 0.95], [1.10, 0.95], [1.90, 0.92],
    [2.25, 0.86], [nose, 0.76],
  ]);
  const { geom, half, endProf } = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR: 0.56, archGap: 0.05, creaseAt: 0.62, tumble: 0.93,
    deckDrop: 0.028, lipOut: 0.034, endRound: 0.16, endMin: 0.92,
  });

  // Square tyres front and rear -- a family sedan is not staggered.
  const tw = 0.235;
  const wx = geom(zF).wb - tw / 2 + 0.02;
  const wxR = geom(zR).wb - tw / 2 + 0.02;
  const wheels = [
    [-wx, wr, zF, wr, tw], [wx, wr, zF, wr, tw],
    [-wxR, wr, zR, wr, tw], [wxR, wr, zR, wr, tw],
  ];

  // --- formal four-door greenhouse -----------------------------------------
  const cowlZ = 0.80, cowlY = 1.045, roofY = spec.roof;
  const scrZ = 0.14, backZ = -1.24, rearZ = -1.80, rearY = 1.058;
  const wScrB = 0.80, wScrT = 0.70, wRoof = 0.715, wRearT = 0.695, wRear = 0.78;
  const wGlassT = 0.688, wGlassB = 0.790;
  const lp = (a, b, t) => a + (b - a) * t;

  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(cowlZ, scrZ, t) + 0.026 * Math.sin(Math.PI * t);
    const cy = lp(cowlY, roofY, t) + 0.010 * Math.sin(Math.PI * t);
    const hwv = lp(wScrB, wScrT, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.024 * u * u, cz - 0.085 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);

  // Level roof, 1.38 m of it. The crown is deliberately half what the coupes
  // carry -- a formal saloon roof is close to flat and the shallow camber is
  // the difference between "big car" and "bubble".
  const roofCols = [[-0.98, -0.048], [-1, -0.010], [-0.94, 0], [-0.66, 0.005], [-0.3, 0.008],
    [0, 0.010], [0.3, 0.008], [0.66, 0.005], [0.94, 0], [1, -0.010], [0.98, -0.048]];
  const roofRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const cz = lp(scrZ, backZ, t), cy = roofY + 0.005 * Math.sin(Math.PI * t);
    roofRows.push(roofCols.map(([u, dy]) => [u * wRoof, cy + dy - 0.016 * u * u, cz]));
  }
  paint.patch(roofRows, WHITE, [0, 1, 0]);

  const rearRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(backZ, rearZ, t), cy = lp(roofY - 0.006, rearY, t) + 0.012 * Math.sin(Math.PI * t);
    const hwv = lp(wRearT, wRear, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.024 * u * u, cz + 0.035 * u * u]);
    }
    rearRows.push(row);
  }
  trim.patch(rearRows, GLASS, [0, 0.7, -1]);

  const sgFB = [0.72, 1.055], sgFT = [0.16, 1.470], sgRT = [-1.24, 1.464], sgRB = [-1.44, 1.080];
  carCabin(matte, { cowlZ, cowlY, scrZ, roofY, backZ, rearZ, rearY, wScrB, wRoof, wRear, wGlassT, wGlassB, sgFB, sgRB, rows: [-0.26, -1.14], scrWrap: 0.085, rearWrap: 0.035 }, paint);
  const sailOuter = [[wGlassT, 1.464, backZ], [0.745, 1.335, -1.4267],
    [0.788, 1.190, -1.6133], [0.800, 1.058, rearZ]];
  for (const sx of [-1, 1]) {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 6; j++) {
        const u = j / 6;
        const bz = lp(sgFB[0], sgRB[0], u), by = lp(sgFB[1], sgRB[1], u);
        const tz = lp(sgFT[0], sgRT[0], u), ty = lp(sgFT[1], sgRT[1], u);
        row.push([sx * lp(wGlassB, wGlassT, t), lp(by, ty, t), lp(bz, tz, t)]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sx, 0, 0]);
    // B-pillar, blacked out and laid ON the glass rather than splitting it into
    // two panels. A real sedan's centre pillar is a black-taped strip between
    // two windows and reads the same way at any distance a player sees it from.
    const bz0 = lp(sgFB[0], sgRB[0], 0.42), bz1 = lp(sgFT[0], sgRT[0], 0.42);
    matte.patch([
      [[sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 + 0.045], [sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 - 0.045]],
      [[sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 + 0.045], [sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 - 0.045]],
    ], [0.09, 0.10, 0.11], [sx, 0, 0]);
    // A-pillar, off the windscreen's own edge points so it is flush with it.
    paint.patch(scrRows.map((r, i) => {
      const e = r[r.length - 1], t = i / 3;
      return [[sx * e[0], e[1], e[2]],
        [sx * lp(wGlassB, wGlassT, t), lp(sgFB[1], sgFT[1], t), lp(sgFB[0], sgFT[0], t)]];
    }), WHITE, [sx, 0.4, 0]);
    // Thick formal C-pillar: the sail runs from the rear screen's own edge out
    // to the quarter and down onto the boot shoulder.
    paint.patch(rearRows.map((r, i) => {
      const e = r[r.length - 1], o = sailOuter[i];
      return [[sx * e[0], e[1], e[2]], [sx * o[0], o[1], o[2]]];
    }), WHITE, [sx, 0.4, 0]);
    // Bright window surround along the beltline, which is most of what says
    // "American full-size" about a greenhouse.
    trim.tube([sx * (wGlassB + 0.004), sgFB[1] - 0.012, sgFB[0]],
      [sx * (wGlassB + 0.004), sgRB[1] - 0.012, sgRB[0]], 0.014, 6, CHROME, true);
  }

  // --- front fascia: wide horizontal-bar grille ----------------------------
  const GRILLE = [0, 0.805, 0.390, 0.098], LAMP_A = [0.575, 0.812, 0.130, 0.062];
  const INTAKE = [0, 0.520, 0.520, 0.058];
  const TAILBAR = [0, 0.800, 0.620, 0.085], PLATEREC = [0, 0.560, 0.230, 0.075];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILBAR, PLATEREC], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.13, 1,
    { rim: 0.030, rimCol: CHROME });
  // Four chrome blades across the mouth, standing in the recess. Horizontal
  // bars are the American grille; vertical slats read European.
  for (let i = 0; i < 4; i++) {
    trim.box(0, 0.726 + i * 0.052, gp.z + 0.02, gp.hw * 1.94, 0.022, 0.045, 0, CHROME);
  }
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.10, 1,
      { rim: 0.022, rimCol: CHROME });
    trim.box(sx * LAMP_A[0], 0.818, nose - 0.030, hp.hw * 1.9, 0.068, 0.024, 0, LAMP);
    trim.box(sx * LAMP_A[0], 0.764, hp.z + 0.045, hp.hw * 1.9, 0.022, 0.024, 0, AMBER);
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.11, 1,
    { rim: 0.024, rimCol: PLASTIC });
  // Body-coloured bumper with a bright insert under the grille, and a valance
  // low enough that the nose does not end in a shelf.
  trim.box(0, 0.610, nose - 0.005, 1.42, 0.026, 0.05, 0, CHROME);
  matte.box(0, 0.392, nose - 0.10, 1.54, 0.040, 0.24, 0, PLASTIC);
  trim.box(0, 0.430, nose - 0.028, 0.42, 0.135, 0.02, 0, PLATE);

  // --- rear: one lamp panel across the full width --------------------------
  const tp = pocket(paint, matte, TAILBAR[0], TAILBAR[1], tail, TAILBAR[2], TAILBAR[3], 0.075, -1,
    { rim: 0.028, rimCol: CHROME });
  for (const sx of [-1, 1]) {
    trim.box(sx * 0.365, 0.760, tail + 0.020, 0.46, 0.130, 0.026, 0, TAILC);
    trim.box(sx * 0.575, 0.760, tail + 0.020, 0.11, 0.130, 0.026, 0, AMBER);
    trim.box(sx * 0.155, 0.775, tail + 0.020, 0.11, 0.075, 0.026, 0, WHITE);   // reversing lamp
    hole(trim, matte, sx * 0.470, 0.395, tail + 0.02, 0.048, 0.11, -1);
  }
  // Bright bar down the middle of the panel, tying the two lamps together.
  trim.box(0, 0.760, tail + 0.026, tp.hw * 0.62, 0.048, 0.03, 0, CHROME);
  pocket(paint, matte, PLATEREC[0], PLATEREC[1], tail, PLATEREC[2], PLATEREC[3], 0.05, -1,
    { rim: 0.024, rimCol: CHROME });
  trim.box(0, 0.500, tail - 0.030, 0.42, 0.135, 0.02, 0, PLATE);
  matte.box(0, 0.392, tail + 0.10, 1.54, 0.040, 0.24, 0, PLASTIC);
  // Boot shut line across the deck, so the lid is a lid.
  matte.box(0, beltY(-1.86) + 0.002, -1.86, geom(-1.86).tw * 1.86, 0.008, 0.014, 0, [0.15, 0.16, 0.17]);

  // --- flanks ---------------------------------------------------------------
  for (const sx of [-1, 1]) {
    // Four shut lines, because there are four doors, and their spacing is what
    // a player counts without knowing they are counting.
    for (const zc of [1.02, 0.06, -0.98]) {
      const rows = [-0.008, 0.008].map((dz) =>
        half(zc + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, zc + dz]));
      matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    }
    trim.box(sx * (geom(0).wb + 0.008), 0.318, 0.06, 0.026, 0.05, 2.60, 0, CHROME);  // rocker moulding
    for (const zc of [0.56, -0.50]) {
      const hg = geom(zc);
      trim.tube([sx * hg.w * 0.99, hg.yc + 0.115, zc - 0.09], [sx * hg.w * 0.99, hg.yc + 0.115, zc + 0.09],
        0.016, 6, CHROME, true);
    }
    // Mirror on a short body-colour stalk. The stalk STARTS inside the shoulder
    // at the A-pillar's own base (`sgFB`), not out over the bonnet -- placed by
    // eye it ends up a red brick hanging in the air beside the wing, which is
    // exactly what the first pass rendered.
    paint.tube([sx * 0.790, 1.062, sgFB[0] - 0.02], [sx * 0.900, 1.088, sgFB[0] - 0.06], 0.020, 6, WHITE, true);
    paint.box(sx * 0.940, 1.048, sgFB[0] - 0.10, 0.105, 0.090, 0.055, 0, WHITE);
    trim.box(sx * 0.940, 1.055, sgFB[0] - 0.128, 0.090, 0.070, 0.02, 0, MIRROR);
  }
  // Roof aerial: a shark fin, which every American sedan built this century has.
  paint.patch([
    [[0, roofY - 0.002, -1.10], [0, roofY - 0.002, -1.30]],
    [[0.028, roofY + 0.030, -1.16], [0.028, roofY + 0.030, -1.29]],
    [[0, roofY + 0.062, -1.24], [0, roofY + 0.062, -1.29]],
  ], [0.10, 0.11, 0.12], [1, 0.4, 0]);
  paint.patch([
    [[0, roofY - 0.002, -1.10], [0, roofY - 0.002, -1.30]],
    [[-0.028, roofY + 0.030, -1.16], [-0.028, roofY + 0.030, -1.29]],
    [[0, roofY + 0.062, -1.24], [0, roofY + 0.062, -1.29]],
  ], [0.10, 0.11, 0.12], [-1, 0.4, 0]);

  return wheels;
}

/**
 * The mid-size American crossover: tall two-box, upright nose, a big grille, a
 * long roof on rails, a thick D-pillar and a tailgate with a spoiler over the
 * screen. It rides 16 cm higher than the sedan and the arches are SQUARED
 * (`archPow` above 2) and clad in black plastic, which together are most of
 * what a crossover is at a glance -- the rest of the fleet has semicircular
 * openings in painted metal.
 *
 * The cladding is why `bodyCore` takes `lipInto`: the arch lip is built from
 * the body's own sill points, so the only thing that should change for a clad
 * arch is which builder it lands in. Drawing a second black lip over a painted
 * one would z-fight along its whole length.
 */
function buildSuv(spec, paint, trim, matte) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.46, zR = -1.42;                 // 2.88 m wheelbase, short overhangs

  // Nearly constant width: a crossover's flanks are slabs and its arches are
  // squared cutouts in them, not flares.
  const halfW = curve([
    [tail, 0.90], [-2.10, 0.96], [zR, 1.00], [-0.60, 0.97], [0.60, 0.97],
    [zF, 1.00], [2.10, 0.96], [nose, 0.90],
  ]);
  const sillY = curve([
    [tail, 0.50], [-2.00, 0.46], [-0.60, 0.44], [0.60, 0.44], [2.00, 0.46], [nose, 0.52],
  ]);
  // The bonnet falls 10 cm in total. An upright nose is the point: a crossover
  // that noses down turns into a tall hatchback.
  const beltY = curve([
    [tail, 1.30], [-2.10, 1.32], [zR, 1.33], [-0.60, 1.32], [0.40, 1.31],
    [1.00, 1.30], [1.60, 1.28], [2.10, 1.24], [nose, 1.20],
  ]);
  const tuckAt = curve([
    [tail, 0.94], [zR, 0.97], [-0.60, 0.93], [0.60, 0.93], [zF, 0.97], [nose, 0.94],
  ]);
  const topAt = curve([
    [tail, 0.92], [-2.10, 0.96], [-1.20, 0.97], [1.20, 0.97], [1.90, 0.95],
    [2.25, 0.90], [nose, 0.82],
  ]);
  const { geom, half, endProf } = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR: 0.62, archGap: 0.07, archPow: 3.0, creaseAt: 0.50, tumble: 0.96,
    deckDrop: 0.030, lipOut: 0.052, endRound: 0.14, endMin: 0.94,
    lipInto: matte, lipCol: PLASTIC,
  });

  const tw = 0.265;
  const wx = geom(zF).wb - tw / 2 + 0.02;
  const wxR = geom(zR).wb - tw / 2 + 0.02;
  const wheels = [
    [-wx, wr, zF, wr, tw], [wx, wr, zF, wr, tw],
    [-wxR, wr, zR, wr, tw], [wxR, wr, zR, wr, tw],
  ];

  // --- tall two-box greenhouse ---------------------------------------------
  const cowlZ = 0.86, cowlY = 1.305, roofY = spec.roof;
  const scrZ = 0.10, backZ = -1.96, rearZ = -2.34, rearY = 1.325;
  const wScrB = 0.84, wScrT = 0.76, wRoof = 0.780, wRearT = 0.755, wRear = 0.800;
  const wGlassT = 0.752, wGlassB = 0.845;
  const lp = (a, b, t) => a + (b - a) * t;

  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(cowlZ, scrZ, t) + 0.030 * Math.sin(Math.PI * t);
    const cy = lp(cowlY, roofY, t) + 0.014 * Math.sin(Math.PI * t);
    const hwv = lp(wScrB, wScrT, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.026 * u * u, cz - 0.095 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);

  const roofCols = [[-0.98, -0.050], [-1, -0.012], [-0.94, 0], [-0.66, 0.006], [-0.3, 0.010],
    [0, 0.012], [0.3, 0.010], [0.66, 0.006], [0.94, 0], [1, -0.012], [0.98, -0.050]];
  const roofRows = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const cz = lp(scrZ, backZ, t), cy = roofY + 0.010 * Math.sin(Math.PI * t);
    roofRows.push(roofCols.map(([u, dy]) => [u * wRoof, cy + dy - 0.020 * u * u, cz]));
  }
  paint.patch(roofRows, WHITE, [0, 1, 0]);

  // The tailgate glass is 35 degrees off vertical -- steep, because the load
  // space behind the D-pillar has to be square. A raked one is an estate.
  const rearRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(backZ, rearZ, t), cy = lp(roofY - 0.010, rearY, t) + 0.010 * Math.sin(Math.PI * t);
    const hwv = lp(wRearT, wRear, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.022 * u * u, cz + 0.030 * u * u]);
    }
    rearRows.push(row);
  }
  trim.patch(rearRows, GLASS, [0, 0.5, -1]);

  const sgFB = [0.78, 1.315], sgFT = [0.14, 1.848], sgRT = [-1.50, 1.842], sgRB = [-1.62, 1.322];
  carCabin(matte, { cowlZ, cowlY, scrZ, roofY, backZ, rearZ, rearY, wScrB, wRoof, wRear, wGlassT, wGlassB, sgFB, sgRB, rows: [-0.30, -1.30], scrWrap: 0.095, rearWrap: 0.03 }, paint);
  // The D-pillar is the whole panel between the side glass and the rear screen,
  // and it is 30-50 cm of painted metal -- the widest pillar on any vehicle
  // here, and the reason an SUV's rear quarter reads solid.
  //
  // Its first row has to be the side glass's OWN rear-top corner. Started at
  // the roof's trailing edge instead, the panel begins 24 cm behind where the
  // glass ends and the quarter has a hole in it half a metre tall -- which is
  // what the first pass looked straight through.
  const sailOuter = [[wGlassT, sgRT[1], sgRT[0]], [0.805, 1.640, -1.555],
    [wGlassB, sgRB[1], sgRB[0]], [0.870, 1.302, -2.10]];
  for (const sx of [-1, 1]) {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 6; j++) {
        const u = j / 6;
        const bz = lp(sgFB[0], sgRB[0], u), by = lp(sgFB[1], sgRB[1], u);
        const tz = lp(sgFT[0], sgRT[0], u), ty = lp(sgFT[1], sgRT[1], u);
        row.push([sx * lp(wGlassB, wGlassT, t), lp(by, ty, t), lp(bz, tz, t)]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sx, 0, 0]);
    for (const u of [0.40, 0.74]) {           // B-pillar and the quarter-light divider
      const bz0 = lp(sgFB[0], sgRB[0], u), bz1 = lp(sgFT[0], sgRT[0], u);
      matte.patch([
        [[sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 + 0.042], [sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 - 0.042]],
        [[sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 + 0.042], [sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 - 0.042]],
      ], [0.09, 0.10, 0.11], [sx, 0, 0]);
    }
    paint.patch(scrRows.map((r, i) => {
      const e = r[r.length - 1], t = i / 3;
      return [[sx * e[0], e[1], e[2]],
        [sx * lp(wGlassB, wGlassT, t), lp(sgFB[1], sgFT[1], t), lp(sgFB[0], sgFT[0], t)]];
    }), WHITE, [sx, 0.4, 0]);
    paint.patch(rearRows.map((r, i) => {
      const e = r[r.length - 1], o = sailOuter[i];
      return [[sx * e[0], e[1], e[2]], [sx * o[0], o[1], o[2]]];
    }), WHITE, [sx, 0.4, 0]);
    // Roof rail on two feet, standing just clear of the roof so daylight shows
    // under it. A rail flush to the panel is a painted stripe; one held 4 cm up
    // reads as bolted onto nothing.
    matte.box(sx * 0.615, roofY + 0.020, -0.90, 0.052, 0.044, 2.00, 0, [0.15, 0.16, 0.17]);
    for (const rz of [0.02, -1.82]) {
      matte.box(sx * 0.615, roofY - 0.020, rz, 0.046, 0.044, 0.11, 0, [0.15, 0.16, 0.17]);
    }
  }

  // Tailgate spoiler: it overhangs the roof's trailing edge, so it starts ON
  // the roof and cantilevers back. Centred behind the roof it hangs in the air
  // above the screen with a hand's width of daylight under it.
  paint.box(0, roofY - 0.056, backZ + 0.10, wRoof * 1.90, 0.058, 0.42, 0, WHITE);
  for (const sx of [-1, 1]) paint.box(sx * 0.735, roofY - 0.096, backZ + 0.06, 0.05, 0.10, 0.30, 0, WHITE);
  trim.box(0, roofY - 0.070, backZ - 0.06, 0.22, 0.05, 0.05, 0, [0.05, 0.05, 0.06]);  // high stop lamp

  // --- front: a big upright grille -----------------------------------------
  const GRILLE = [0, 1.010, 0.480, 0.130], LAMP_A = [0.640, 1.020, 0.135, 0.072];
  const INTAKE = [0, 0.740, 0.520, 0.075];
  const TAILA = [0.630, 1.055, 0.115, 0.150], TPLATE = [0, 0.770, 0.235, 0.075];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILA, TPLATE], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.15, 1,
    { rim: 0.036, rimCol: CHROME });
  for (let i = 0; i < 4; i++) {
    trim.box(0, 0.912 + i * 0.066, gp.z + 0.02, gp.hw * 1.94, 0.030, 0.05, 0, [0.20, 0.21, 0.23]);
  }
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.11, 1,
      { rim: 0.026, rimCol: PLASTIC });
    trim.box(sx * LAMP_A[0], 1.038, nose - 0.034, hp.hw * 1.9, 0.078, 0.024, 0, LAMP);
    trim.box(sx * LAMP_A[0], 0.972, hp.z + 0.05, hp.hw * 1.9, 0.024, 0.024, 0, AMBER);
    // Fog lamp in the lower cladding.
    hole(trim, matte, sx * 0.560, 0.660, nose - 0.03, 0.048, 0.07, 1, { rimCol: PLASTIC });
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.12, 1,
    { rim: 0.028, rimCol: PLASTIC });
  // Bumper cladding and a brushed skid plate, which is the crossover's one
  // gesture at the off-roader it is styled after.
  matte.box(0, 0.560, nose - 0.11, 1.62, 0.075, 0.26, 0, PLASTIC);
  trim.box(0, 0.508, nose - 0.16, 0.98, 0.030, 0.26, 0, [0.55, 0.57, 0.60]);
  trim.box(0, 0.610, nose - 0.030, 0.42, 0.135, 0.02, 0, PLATE);

  // --- rear: tall lamps up the corners of the tailgate ----------------------
  for (const sx of [-1, 1]) {
    const tp = pocket(paint, matte, sx * TAILA[0], TAILA[1], tail, TAILA[2], TAILA[3], 0.07, -1,
      { rim: 0.026, rimCol: PLASTIC });
    trim.box(sx * TAILA[0], 0.930, tail + 0.020, tp.hw * 1.9, 0.220, 0.026, 0, TAILC);
    trim.box(sx * TAILA[0], 1.168, tail + 0.020, tp.hw * 1.9, 0.048, 0.026, 0, AMBER);
  }
  pocket(paint, matte, TPLATE[0], TPLATE[1], tail, TPLATE[2], TPLATE[3], 0.05, -1,
    { rim: 0.024, rimCol: PLASTIC });
  trim.box(0, 0.710, tail - 0.030, 0.42, 0.135, 0.02, 0, PLATE);
  matte.box(0, 0.560, tail + 0.11, 1.62, 0.075, 0.26, 0, PLASTIC);
  trim.box(0, 0.508, tail + 0.16, 0.98, 0.030, 0.26, 0, [0.55, 0.57, 0.60]);
  for (const sx of [-1, 1]) hole(trim, matte, sx * 0.420, 0.470, tail + 0.06, 0.045, 0.10, -1);

  // --- flanks: cladding all the way round ----------------------------------
  for (const sx of [-1, 1]) {
    for (const zc of [0.88, -0.14, -1.10]) {
      const rows = [-0.008, 0.008].map((dz) =>
        half(zc + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, zc + dz]));
      matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    }
    // Rocker cladding between the two arches, deep enough to tie them together
    // into one black band round the bottom of the car.
    matte.box(sx * (geom(0).wb + 0.005), 0.470, 0.02, 0.055, 0.135, 2.10, 0, PLASTIC);
    matte.box(sx * (geom(0).w + 0.004), 0.860, 0.02, 0.016, 0.075, 2.30, 0, [0.14, 0.15, 0.16]);
    for (const zc of [0.62, -0.52]) {
      const hg = geom(zc);
      trim.tube([sx * hg.w * 0.99, hg.yc + 0.290, zc - 0.09], [sx * hg.w * 0.99, hg.yc + 0.290, zc + 0.09],
        0.017, 6, CHROME, true);
    }
    // Mirror hung off the A-pillar's base, not out over the wing -- see the
    // sedan's for what placing it by eye produces.
    paint.tube([sx * 0.830, 1.318, sgFB[0] - 0.03], [sx * 0.955, 1.348, sgFB[0] - 0.08], 0.022, 6, WHITE, true);
    paint.box(sx * 1.000, 1.300, sgFB[0] - 0.13, 0.115, 0.100, 0.060, 0, WHITE);
    trim.box(sx * 1.000, 1.308, sgFB[0] - 0.161, 0.098, 0.078, 0.02, 0, MIRROR);
  }

  return wheels;
}

/**
 * The full-size American pickup, and the one vehicle here that is genuinely a
 * different ARCHITECTURE rather than a different set of curves: a cab and a bed
 * with a gap between them, not one body.
 *
 * The lofted shell covers sill to beltline over the whole length -- front
 * fenders, cab sides and bed sides are one surface on a real truck too, and
 * building it as one is what keeps the arches and the flares registered. What
 * stands ABOVE the beltline is built separately and is where the two-box reads:
 * a crew cab from z 1.30 to -0.86, an open slot, then bed walls from -1.00 back
 * to a hinged tailgate. Everything in that slot is deliberately dark, because
 * what a player sees between a cab and a bed is shadow.
 */
function buildPickup(spec, paint, trim, matte) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.86, zR = -1.82;                 // 3.68 m wheelbase

  const halfW = curve([
    [tail, 0.98], [-2.55, 1.00], [zR, 1.00], [-1.05, 0.965], [1.05, 0.965],
    [zF, 1.00], [2.45, 0.97], [nose, 0.92],
  ]);
  const sillY = curve([
    [tail, 0.52], [-2.40, 0.48], [-0.60, 0.46], [0.60, 0.46], [2.40, 0.48], [nose, 0.54],
  ]);
  // Flat to within 8 cm end to end. A truck's beltline is a straight line and
  // any dip in it turns the bonnet into a car's.
  const beltY = curve([
    [tail, 1.26], [-2.30, 1.26], [-1.00, 1.26], [1.00, 1.26], [1.60, 1.25],
    [2.30, 1.22], [nose, 1.18],
  ]);
  const tuckAt = curve([
    [tail, 0.97], [zR, 0.99], [-0.60, 0.95], [0.60, 0.95], [zF, 0.99], [nose, 0.97],
  ]);
  const topAt = curve([
    [tail, 0.98], [-2.40, 0.99], [1.40, 0.99], [2.10, 0.97], [2.55, 0.94], [nose, 0.88],
  ]);
  const { geom, half, endProf } = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR: 0.68, archGap: 0.09, archPow: 2.6, creaseAt: 0.42, tumble: 0.985,
    deckDrop: 0.022, lipOut: 0.082, endRound: 0.12, endMin: 0.94,
  });

  const tw = 0.30;
  const wx = geom(zF).wb - tw / 2 + 0.02;
  const wxR = geom(zR).wb - tw / 2 + 0.02;
  const wheels = [
    [-wx, wr, zF, wr, tw], [wx, wr, zF, wr, tw],
    [-wxR, wr, zR, wr, tw], [wxR, wr, zR, wr, tw],
  ];

  // --- crew cab -------------------------------------------------------------
  const cowlZ = 1.30, cowlY = 1.258, roofY = spec.roof;
  const scrZ = 0.68, backZ = -0.62, rearZ = -0.86, rearY = 1.40;
  const wScrB = 0.86, wScrT = 0.800, wRoof = 0.820, wRearT = 0.800, wRear = 0.840;
  const wGlassT = 0.790, wGlassB = 0.870;
  const lp = (a, b, t) => a + (b - a) * t;

  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(cowlZ, scrZ, t) + 0.024 * Math.sin(Math.PI * t);
    const cy = lp(cowlY, roofY, t) + 0.012 * Math.sin(Math.PI * t);
    const hwv = lp(wScrB, wScrT, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.022 * u * u, cz - 0.075 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);

  const roofCols = [[-0.98, -0.046], [-1, -0.010], [-0.94, 0], [-0.66, 0.005], [-0.3, 0.008],
    [0, 0.010], [0.3, 0.008], [0.66, 0.005], [0.94, 0], [1, -0.010], [0.98, -0.046]];
  const roofRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const cz = lp(scrZ, backZ, t), cy = roofY + 0.006 * Math.sin(Math.PI * t);
    roofRows.push(roofCols.map(([u, dy]) => [u * wRoof, cy + dy - 0.016 * u * u, cz]));
  }
  paint.patch(roofRows, WHITE, [0, 1, 0]);

  // Rear cab window: near vertical, and short. Everything behind it is bed.
  const rearRows = [];
  for (let i = 0; i <= 2; i++) {
    const t = i / 2, row = [];
    const cz = lp(backZ, rearZ, t), cy = lp(roofY - 0.008, rearY, t);
    const hwv = lp(wRearT, wRear, t);
    for (let j = 0; j <= 6; j++) {
      const u = -1 + (2 * j) / 6;
      row.push([u * hwv, cy - 0.018 * u * u, cz + 0.020 * u * u]);
    }
    rearRows.push(row);
  }
  trim.patch(rearRows, GLASS, [0, 0.5, -1]);
  // The painted panel under it, down to the beltline -- a truck's back-of-cab.
  paint.patch([
    rearRows[rearRows.length - 1].map(([x, y, z]) => [x, y, z]),
    rearRows[rearRows.length - 1].map(([x, , z]) => [x * 1.03, beltY(rearZ) - 0.005, z - 0.03]),
  ], WHITE, [0, 0.3, -1]);

  const sgFB = [1.24, 1.278], sgFT = [0.74, 1.944], sgRT = [-0.58, 1.938], sgRB = [-0.78, 1.282];
  carCabin(matte, { cowlZ, cowlY, scrZ, roofY, backZ, rearZ, rearY, wScrB, wRoof, wRear, wGlassT, wGlassB, sgFB, sgRB, rows: [0.34, -0.48], scrWrap: 0.075, rearWrap: 0.02 }, paint);
  const sailOuter = [[wGlassT, 1.938, backZ], [0.815, 1.660, -0.74], [0.830, 1.300, rearZ]];
  for (const sx of [-1, 1]) {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 6; j++) {
        const u = j / 6;
        const bz = lp(sgFB[0], sgRB[0], u), by = lp(sgFB[1], sgRB[1], u);
        const tz = lp(sgFT[0], sgRT[0], u), ty = lp(sgFT[1], sgRT[1], u);
        row.push([sx * lp(wGlassB, wGlassT, t), lp(by, ty, t), lp(bz, tz, t)]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sx, 0, 0]);
    const bz0 = lp(sgFB[0], sgRB[0], 0.46), bz1 = lp(sgFT[0], sgRT[0], 0.46);
    matte.patch([
      [[sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 + 0.045], [sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 - 0.045]],
      [[sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 + 0.045], [sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 - 0.045]],
    ], [0.09, 0.10, 0.11], [sx, 0, 0]);
    paint.patch(scrRows.map((r, i) => {
      const e = r[r.length - 1], t = i / 3;
      return [[sx * e[0], e[1], e[2]],
        [sx * lp(wGlassB, wGlassT, t), lp(sgFB[1], sgFT[1], t), lp(sgFB[0], sgFT[0], t)]];
    }), WHITE, [sx, 0.4, 0]);
    paint.patch(rearRows.map((r, i) => {
      const e = r[r.length - 1], o = sailOuter[i];
      return [[sx * e[0], e[1], e[2]], [sx * o[0], o[1], o[2]]];
    }), WHITE, [sx, 0.4, 0]);
  }

  // --- the bed --------------------------------------------------------------
  // Walls stand 34 cm above the beltline, which puts the rail just under the
  // cab's shoulder. Taller and the truck loses its two-box step; shorter and it
  // is a car with a hole in the back.
  const bedF = -1.00, bedR = tail - 0.02, railH = 0.34;
  const bedY = beltY(-2.0) - 0.005;
  const bedMid = (bedF + bedR) / 2, bedLen = bedF - bedR;
  const wallX = geom(-2.0).tw;
  for (const sx of [-1, 1]) {
    paint.box(sx * wallX, bedY, bedMid, 0.070, railH, bedLen, 0, WHITE);
    // Dark inner skin, set in behind the rail so the bed is a container rather
    // than a painted trough. Everything a player sees down in there is shadow.
    matte.box(sx * (wallX - 0.070), bedY, bedMid, 0.030, railH - 0.035, bedLen - 0.04, 0, CAVITY);
  }
  paint.box(0, bedY, bedF - 0.035, wallX * 2 + 0.07, railH, 0.070, 0, WHITE);   // bulkhead
  matte.box(0, bedY, bedF - 0.075, wallX * 2 - 0.14, railH - 0.035, 0.030, 0, CAVITY);
  matte.box(0, bedY - 0.06, bedMid, wallX * 2 - 0.14, 0.060, bedLen - 0.10, 0, [0.16, 0.17, 0.18]);
  // Corrugations in the floor -- a flat black rectangle down there reads as a
  // hole rather than as a load bed.
  for (let i = -3; i <= 3; i++) {
    matte.box(i * 0.22, bedY - 0.004, bedMid, 0.055, 0.012, bedLen - 0.14, 0, [0.20, 0.21, 0.22]);
  }
  // Tailgate: its own panel with a shut gap either side and a chrome handle.
  paint.box(0, bedY - 0.02, bedR + 0.055, wallX * 2 - 0.16, railH + 0.02, 0.075, 0, WHITE);
  matte.box(0, bedY + railH - 0.014, bedR + 0.055, wallX * 2 - 0.16, 0.020, 0.085, 0, PLASTIC);
  trim.box(0, bedY + railH - 0.110, bedR + 0.020, 0.30, 0.055, 0.030, 0, CHROME);
  // The slot between cab and bed. Painted bodywork carrying straight through
  // here is what would make the whole thing read as one body again.
  matte.box(0, beltY(bedF) - 0.075, bedF + 0.075, wallX * 1.96, 0.070, 0.16, 0, CAVITY);

  // --- front: rectangular grille with a chrome bar across it ---------------
  const GRILLE = [0, 0.985, 0.545, 0.140], LAMP_A = [0.710, 0.995, 0.140, 0.090];
  const INTAKE = [0, 0.700, 0.480, 0.065];
  const TAILA = [0.800, 1.020, 0.125, 0.160], TPLATE = [0, 0.745, 0.235, 0.075];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILA, TPLATE], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.16, 1,
    { rim: 0.042, rimCol: CHROME });
  // One heavy chrome bar across the middle with a black honeycomb above and
  // below it. That bar is the single most recognisable thing on a full-size
  // American truck's face.
  trim.box(0, GRILLE[1] - 0.028, gp.z + 0.075, gp.hw * 1.96, 0.056, 0.09, 0, CHROME);
  for (const dy of [-0.098, 0.086]) {
    for (let i = -6; i <= 6; i++) {
      trim.box(i * 0.082, GRILLE[1] + dy, gp.z + 0.02, 0.022, 0.058, 0.04, 0, [0.16, 0.17, 0.19]);
    }
  }
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.11, 1,
      { rim: 0.030, rimCol: CHROME });
    trim.box(sx * LAMP_A[0], 1.020, nose - 0.036, hp.hw * 1.9, 0.098, 0.026, 0, LAMP);
    trim.box(sx * LAMP_A[0], 0.938, hp.z + 0.05, hp.hw * 1.9, 0.030, 0.026, 0, AMBER);
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.12, 1,
    { rim: 0.028, rimCol: PLASTIC });
  // Chrome step bumper at both ends, standing off the body on its own brackets.
  const stepBumper = (z, dir) => {
    trim.box(0, 0.522, z + dir * 0.055, 2.00, 0.095, 0.110, 0, CHROME);
    matte.box(0, 0.498, z + dir * 0.055, 0.68, 0.032, 0.130, 0, PLASTIC);       // step pad
    for (const sx of [-1, 1]) matte.box(sx * 0.62, 0.560, z + dir * 0.015, 0.09, 0.11, 0.08, 0, PLASTIC);
  };
  stepBumper(nose, 1);
  stepBumper(tail, -1);
  trim.box(0, 0.640, nose + 0.114, 0.44, 0.145, 0.02, 0, PLATE);
  trim.box(0, 0.640, tail - 0.114, 0.44, 0.145, 0.02, 0, PLATE);

  // --- rear lamps: tall units up the corners, past the bed rail ------------
  for (const sx of [-1, 1]) {
    const tp = pocket(paint, matte, sx * TAILA[0], TAILA[1], tail, TAILA[2], TAILA[3], 0.07, -1,
      { rim: 0.028, rimCol: PLASTIC });
    trim.box(sx * TAILA[0], 0.890, tail + 0.020, tp.hw * 1.9, 0.230, 0.028, 0, TAILC);
    trim.box(sx * TAILA[0], 1.140, tail + 0.020, tp.hw * 1.9, 0.052, 0.028, 0, AMBER);
  }
  pocket(paint, matte, TPLATE[0], TPLATE[1], tail, TPLATE[2], TPLATE[3], 0.05, -1,
    { rim: 0.024, rimCol: PLASTIC });

  // --- flanks: flares, running boards, tow mirrors -------------------------
  for (const sx of [-1, 1]) {
    for (const zc of [1.18, 0.14]) {
      const rows = [-0.008, 0.008].map((dz) =>
        half(zc + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, zc + dz]));
      matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    }
    // Running board on two brackets, between the arches.
    matte.box(sx * (geom(0).wb + 0.055), 0.560, 0.10, 0.170, 0.055, 1.90, 0, PLASTIC);
    for (const bz of [0.90, -0.70]) {
      matte.box(sx * (geom(0).wb - 0.02), 0.600, bz, 0.14, 0.055, 0.07, 0, PLASTIC);
    }
    // Tow mirror: a tall flat glass on a double arm, which is the detail that
    // makes a truck read as a truck from the front.
    //
    // The arms have to START ON THE DOOR SKIN, not on the glass line. The
    // glass is 12 cm inboard of the door at this station, so arms run from
    // there spent their first 12 cm INSIDE the bodywork and only 16 cm of arm
    // ever emerged -- and from a front three-quarter, where the cab hides that
    // 16 cm, the head read as a block floating in mid-air beside the truck.
    // Now: a base plate on the door, two arms out from it, and a riser joining
    // them at the head, so the whole thing is one visible ladder from any
    // angle rather than a mirror with its supports behind the cab.
    // The arms have to START ON THE DOOR SKIN and reach FORWARD, past the
    // cowl. Two things were wrong before. They began at the glass line, 12 cm
    // inboard of the door, so a third of each arm was buried in the bodywork.
    // And the head sat level with the A-pillar, where the cab -- 72 cm taller
    // than the mirror -- hides every centimetre of arm on the far side: from a
    // front three-quarter the far head read as a block floating in the air
    // beside the truck, which is exactly what it was, visually. Ahead of the
    // cowl the arms cross only the BONNET, whose deck is 14 cm below them, so
    // they are seen against the sky and the mirror reads as bolted on from
    // every angle a player can stand in.
    const mz = sgFB[0] - 0.02, hz = mz + 0.22, mx = geom(mz).w;
    // Mounted ACROSS the beltline, where a door skin is, rather than up on the
    // glass -- the arms have to land on something a bracket could bolt to.
    matte.box(sx * (mx + 0.010), 1.250, mz, 0.030, 0.240, 0.140, 0, PLASTIC);   // base plate
    for (const ay of [1.315, 1.505]) {
      matte.tube([sx * (mx + 0.015), ay, mz], [sx * 1.190, ay + 0.020, hz], 0.026, 6, PLASTIC, true);
    }
    matte.tube([sx * 1.190, 1.305, hz], [sx * 1.190, 1.535, hz], 0.024, 6, PLASTIC, true);
    paint.box(sx * 1.228, 1.272, hz - 0.030, 0.075, 0.300, 0.085, 0, WHITE);
    trim.box(sx * 1.228, 1.286, hz - 0.074, 0.062, 0.266, 0.02, 0, MIRROR);
    // Bed rail cap and a tie-down, so the rail has a top edge that catches light.
    trim.box(sx * wallX, bedY + railH - 0.006, bedMid, 0.078, 0.014, bedLen - 0.02, 0, [0.22, 0.23, 0.25]);
    // Fuel filler on the bed side, ahead of the rear arch.
    matte.box(sx * (geom(-1.10).w + 0.004), 0.900, -1.10, 0.014, 0.150, 0.190, 0, [0.20, 0.21, 0.23]);
  }

  return wheels;
}

// ---------------------------------------------------------------------------
// Motorcycles
//
// A bike is not a car with two of its wheels deleted, so none of it goes
// through `bodyCore`: there is no shell to loft, no arches to cut and no
// greenhouse. What there is instead is a frame, and everything hangs off it --
// which is why these are built almost entirely from `tube` between named
// points rather than from boxes. `box` and `prism` can only yaw, and on a
// motorcycle nearly every member is diagonal in Y: forks, downtube, swingarm,
// shocks, headers. Built from boxes they come out as level bars floating in
// the air, which is what the viaduct barriers looked like.
// ---------------------------------------------------------------------------

const LEATHER = [0.075, 0.075, 0.085];   // seat, grips, boots
const ENGINE = [0.15, 0.16, 0.175];
const ALLOY = [0.58, 0.60, 0.63];

/** Closed ellipse in the (x, y) plane, for a `loft` ring: tanks, mufflers. */
function ring2(hx, cy, hy, n = 12, cx = 0) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([cx + Math.cos(a) * hx, cy + Math.sin(a) * hy]);
  }
  return p;
}

/**
 * Mudguard: a crowned strip of sheet wrapped round a wheel.
 *
 * `a0`/`a1` are angles about the axle with 0 straight up and positive toward
 * the nose, so a front guard and a bobbed rear one differ only in their arc.
 * The section is crowned across its width because a flat one reads as a plank
 * laid over the tyre -- the same reason the roofs are cambered.
 */
function fender(b, cy, cz, r, halfW, a0, a1, col) {
  const rows = [];
  for (let i = 0; i <= 12; i++) {
    const a = a0 + ((a1 - a0) * i) / 12;
    const row = [];
    for (let j = 0; j <= 4; j++) {
      const u = -1 + j / 2;
      const rr = r * (1 - 0.05 * u * u);
      row.push([u * halfW, cy + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
    }
    rows.push(row);
  }
  b.patch(rows, col, [0, 1, 0]);
}

/** A round mirror head on a stalk, aimed back down the bike. */
function mirror(trim, x, y, z, r, stalkFrom, col) {
  trim.tube(stalkFrom, [x, y, z], 0.011, 6, col, true);
  trim.tube([x, y, z + 0.020], [x, y, z - 0.012], r, 10, col, true);
  trim.box(x, y, z - 0.016, r * 1.7, r * 1.7, 0.014, 0, MIRROR);
}

/**
 * The cruiser: long, low and raked, with a 45-degree V-twin standing in an
 * open cradle frame where a player can see straight through it.
 *
 * Everything that separates this from the sportbike is deliberate and
 * measurable in the numbers below: 28 degrees of rake against 23, a 1.66 m
 * wheelbase against 1.36, bars 88 cm across against clip-ons that sit BELOW
 * the top yoke, feet forward of the engine rather than tucked behind it, and a
 * seat 20 cm lower. Two bikes that share a builder and differ by a scale
 * factor would read as the same bike twice, which is the mistake the whole
 * fleet used to make.
 */
function buildCruiser(spec, paint, trim, matte) {
  const zF = 0.86, rF = 0.42, twF = 0.11;      // 21 inch front, skinny
  const zR = -0.80, rR = spec.wheelR, twR = 0.20;
  // `out` 0: both faces of a bike's wheel are outboard faces.
  const wheels = [[0, rF, zF, rF, twF, 0], [0, rR, zR, rR, twR, 0]];

  // The steering axis, as ONE function of height. The forks, both yokes, the
  // headlamp and the bars all read their z from it, so raking the bike is a
  // change to two numbers rather than to fifteen coordinates that have to stay
  // in step -- the same reason the wheel arches read their x from `half()`.
  const fz = (y) => 0.545 - 0.525 * (y - 1.02);      // 28 deg from vertical
  const topY = 1.00, botY = 0.74;

  // --- frame ---------------------------------------------------------------
  const FRAME = [0.13, 0.135, 0.145];
  matte.tube([0, topY + 0.02, fz(topY) - 0.055], [0, botY - 0.02, fz(botY) - 0.055], 0.048, 8, FRAME, true);
  // backbone under the tank, then down behind the engine
  matte.tube([0, 0.985, 0.50], [0, 0.870, -0.12], 0.030, 8, FRAME, true);
  matte.tube([0, 0.870, -0.12], [0, 0.560, -0.36], 0.028, 8, FRAME, true);
  // downtube and cradle: the loop the engine sits in
  matte.tube([0, 0.760, 0.545], [0, 0.330, 0.400], 0.030, 8, FRAME, true);
  for (const sx of [-1, 1]) {
    matte.tube([0, 0.330, 0.400], [sx * 0.105, 0.300, 0.300], 0.024, 6, FRAME, true);
    matte.tube([sx * 0.105, 0.300, 0.300], [sx * 0.105, 0.290, -0.180], 0.024, 6, FRAME, true);
    matte.tube([sx * 0.105, 0.290, -0.180], [sx * 0.100, 0.560, -0.320], 0.024, 6, FRAME, true);
    // seat rails out to the back
    matte.tube([sx * 0.075, 0.735, -0.180], [sx * 0.095, 0.700, -0.760], 0.022, 6, FRAME, true);
  }

  // --- front end -----------------------------------------------------------
  for (const sx of [-1, 1]) {
    const x = sx * 0.105;
    trim.tube([x, 1.055, fz(1.055)], [x, 0.700, fz(0.700)], 0.026, 8, CHROME, true);  // stanchion
    matte.tube([x, 0.760, fz(0.760)], [x, rF, zF], 0.036, 8, [0.10, 0.11, 0.12], true); // slider
  }
  for (const y of [topY, botY]) {
    trim.tube([-0.155, y, fz(y)], [0.155, y, fz(y)], 0.030, 8, ALLOY, true);          // yokes
  }
  fender(paint, rF, zF, rF + 0.050, 0.078, -0.30, 1.05, WHITE);
  // Headlamp: a chrome bucket with the lens across its MOUTH. Buried at the
  // back of a bucket a lens catches nothing and renders as more shadow -- the
  // same trap as the muscle car's sealed beams.
  trim.tube([0, 0.945, 0.545], [0, 0.945, 0.660], 0.098, 12, CHROME, true);
  trim.tube([0, 0.945, 0.655], [0, 0.945, 0.678], 0.084, 12, LAMP, true);
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.135, 0.985, 0.560], [sx * 0.150, 0.985, 0.595], 0.030, 8, AMBER, true);
  }

  // --- bars: pulled back, high, and 84 cm across ---------------------------
  // The grips sit where the RIDER's hands reach, not where a bar looks best on
  // its own: shoulder to grip is 64 cm on this humanoid and the arms simply do
  // not stretch further, so a bar 10 cm too far forward leaves him steering
  // thin air with his fingertips.
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.075, topY + 0.01, fz(topY)], [sx * 0.085, 1.150, 0.500], 0.024, 6, CHROME, true);
    trim.tube([sx * 0.085, 1.170, 0.495], [sx * 0.230, 1.185, 0.455], 0.017, 8, CHROME, true);
    trim.tube([sx * 0.230, 1.185, 0.455], [sx * 0.410, 1.205, 0.392], 0.017, 8, CHROME, true);
    matte.tube([sx * 0.275, 1.194, 0.425], [sx * 0.402, 1.204, 0.395], 0.021, 8, LEATHER, true);
    trim.tube([sx * 0.270, 1.170, 0.432], [sx * 0.370, 1.170, 0.400], 0.010, 6, CHROME, true);  // lever
    mirror(trim, sx * 0.275, 1.345, 0.420, 0.055, [sx * 0.215, 1.190, 0.462], CHROME);
  }
  trim.box(0, 1.195, 0.462, 0.150, 0.055, 0.10, 0, ALLOY);      // clocks on the risers

  // --- V-twin --------------------------------------------------------------
  matte.box(0, 0.255, -0.030, 0.235, 0.230, 0.420, 0, ENGINE);   // crankcase
  matte.box(0, 0.215, -0.030, 0.290, 0.110, 0.360, 0, [0.11, 0.12, 0.13]); // sump
  // Two barrels in a 45 degree V, finned. The fins are what make a cylinder
  // read as an engine rather than as a can, and they cost eight rings each.
  const barrel = (z0, ang) => {
    const dy = Math.cos(ang), dz = Math.sin(ang);
    const base = [0, 0.360, z0];
    const top = [0, 0.360 + dy * 0.300, z0 + dz * 0.300];
    matte.tube(base, top, 0.072, 10, [0.09, 0.10, 0.11], true);
    for (let i = 0; i < 7; i++) {
      const t = 0.10 + i * 0.115;
      const p = [0, 0.360 + dy * 0.300 * t, z0 + dz * 0.300 * t];
      const q = [0, 0.360 + dy * 0.300 * (t + 0.03), z0 + dz * 0.300 * (t + 0.03)];
      trim.tube(p, q, 0.100, 10, ALLOY, true);
    }
    trim.tube(top, [0, 0.360 + dy * 0.375, z0 + dz * 0.375], 0.088, 10, ALLOY, true); // rocker box
  };
  barrel(0.115, 0.42);
  barrel(-0.115, -0.42);
  // Primary case on the left, air cleaner on the right: a V-twin is not
  // symmetrical, and which side each lands on is most of what tells the two
  // flanks apart. Offset in x, not centred -- a cover built on the centreline
  // is a lump growing out of the middle of the engine.
  paint.loft([
    { z: -0.180, pts: ring2(0.050, 0.300, 0.130, 12, 0.140) },
    { z: -0.030, pts: ring2(0.058, 0.300, 0.155, 12, 0.150) },
    { z: 0.130, pts: ring2(0.045, 0.310, 0.125, 12, 0.140) },
  ], WHITE, { capStart: true, capEnd: true });
  trim.tube([-0.135, 0.560, -0.010], [-0.245, 0.560, -0.010], 0.105, 12, CHROME, true);
  trim.tube([-0.245, 0.560, -0.010], [-0.262, 0.560, -0.010], 0.088, 12, ALLOY, true);

  // --- tank, seat, tail ----------------------------------------------------
  paint.loft([
    { z: 0.500, pts: ring2(0.055, 0.905, 0.055, 12) },
    { z: 0.360, pts: ring2(0.140, 0.905, 0.100, 12) },
    { z: 0.140, pts: ring2(0.185, 0.900, 0.120, 12) },
    { z: -0.040, pts: ring2(0.155, 0.885, 0.105, 12) },
    { z: -0.160, pts: ring2(0.070, 0.860, 0.055, 12) },
  ], WHITE, { capStart: true, capEnd: true });
  trim.box(0, 1.008, 0.150, 0.075, 0.020, 0.34, 0, CHROME);      // tank console
  trim.tube([0, 1.010, 0.320], [0, 1.010, 0.360], 0.030, 10, CHROME, true);  // filler cap

  matte.loft([
    { z: -0.150, pts: ring2(0.090, 0.735, 0.045, 10) },
    { z: -0.300, pts: ring2(0.160, 0.715, 0.055, 10) },
    { z: -0.460, pts: ring2(0.165, 0.730, 0.050, 10) },
    { z: -0.600, pts: ring2(0.135, 0.790, 0.055, 10) },
    { z: -0.720, pts: ring2(0.080, 0.815, 0.040, 10) },
  ], LEATHER, { capStart: true, capEnd: true });
  // Bobbed: the guard follows the top of the tyre and stops, rather than
  // wrapping down round the back of it. Carried too far round it stops being a
  // mudguard and becomes a skirt, which is a different decade of motorcycle.
  fender(paint, rR, zR, rR + 0.050, 0.115, -1.20, 0.75, WHITE);
  // Sissy bar. Nothing else on the bike stands up above the rear wheel, and
  // the silhouette from across a street is the point of it.
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.080, 0.760, -0.905], [sx * 0.070, 1.150, -0.980], 0.012, 6, CHROME, true);
  }
  trim.tube([-0.070, 1.146, -0.978], [0.070, 1.146, -0.978], 0.012, 6, CHROME, true);
  matte.loft([
    { z: -0.930, pts: ring2(0.070, 0.980, 0.105, 10) },
    { z: -0.968, pts: ring2(0.078, 0.975, 0.115, 10) },
  ], LEATHER, { capStart: true, capEnd: true });

  // --- rear end ------------------------------------------------------------
  for (const sx of [-1, 1]) {
    matte.tube([sx * 0.105, 0.330, -0.170], [sx * 0.085, rR, zR], 0.028, 8, [0.11, 0.12, 0.13], true);
    trim.tube([sx * 0.110, 0.690, -0.400], [sx * 0.090, 0.430, -0.720], 0.021, 8, CHROME, true);  // shock
    matte.tube([sx * 0.150, 0.300, 0.330], [sx * 0.265, 0.288, 0.355], 0.022, 6, PLASTIC, true);  // forward peg
  }
  // Staggered pipes down the right: two lengths, two heights, which is the
  // arrangement the shape is named after.
  matte.tube([-0.060, 0.640, 0.230], [-0.170, 0.420, 0.190], 0.036, 8, [0.10, 0.11, 0.12], true);
  trim.tube([-0.170, 0.420, 0.190], [-0.205, 0.355, 0.010], 0.038, 8, CHROME, true);
  trim.tube([-0.205, 0.355, 0.010], [-0.225, 0.345, -0.870], 0.049, 10, CHROME, true);
  matte.tube([-0.060, 0.615, -0.230], [-0.190, 0.330, -0.190], 0.034, 8, [0.10, 0.11, 0.12], true);
  trim.tube([-0.190, 0.330, -0.190], [-0.255, 0.275, -0.720], 0.044, 10, CHROME, true);
  hole(trim, matte, -0.225, 0.345, -0.872, 0.038, 0.07, -1);
  hole(trim, matte, -0.255, 0.275, -0.722, 0.034, 0.07, -1);

  // Lamp and plate ON the end of the guard, at the radius the guard actually
  // reaches -- placed by eye they hang in the air behind it.
  trim.box(0, 0.612, -1.198, 0.095, 0.060, 0.030, 0, TAILC);
  matte.box(0, 0.478, -1.205, 0.185, 0.125, 0.014, 0, PLASTIC);
  trim.box(0, 0.482, -1.214, 0.160, 0.100, 0.014, 0, PLATE);

  return wheels;
}

/**
 * The sportbike: everything the cruiser is not. Mass carried high and forward,
 * a fairing wrapped round the front of the engine, clip-ons under the top yoke
 * and a tail that runs up and away to nothing behind the rider.
 *
 * The fairing is a closed `loft`, not an open shell. A real one is open at the
 * bottom and along the flanks, but the section that is left when you close it
 * IS the belly pan, and a closed loft shades continuously round the nose where
 * two mirrored open patches would show a seam straight down the middle of the
 * thing a player looks at from in front.
 */
function buildSportbike(spec, paint, trim, matte) {
  const zF = 0.70, rF = 0.31, twF = 0.12;
  const zR = -0.66, rR = spec.wheelR, twR = 0.19;
  const wheels = [[0, rF, zF, rF, twF, 0], [0, rR, zR, rR, twR, 0]];

  const fz = (y) => 0.440 - 0.425 * (y - 0.900);     // 23 deg of rake
  const topY = 0.885, botY = 0.660;

  // --- frame: twin alloy beams round the outside of the engine -------------
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.075, 0.845, fz(0.845) - 0.030], [sx * 0.150, 0.760, 0.180], 0.038, 8, ALLOY, true);
    trim.tube([sx * 0.150, 0.760, 0.180], [sx * 0.140, 0.680, -0.120], 0.040, 8, ALLOY, true);
    trim.tube([sx * 0.140, 0.680, -0.120], [sx * 0.110, 0.430, -0.150], 0.034, 8, ALLOY, true);
  }
  matte.tube([0, topY + 0.03, fz(topY + 0.03) - 0.045], [0, botY - 0.02, fz(botY - 0.02) - 0.045],
    0.042, 8, [0.13, 0.135, 0.145], true);

  // --- front end -----------------------------------------------------------
  for (const sx of [-1, 1]) {
    const x = sx * 0.092;
    matte.tube([x, 0.925, fz(0.925)], [x, 0.640, fz(0.640)], 0.032, 8, [0.28, 0.29, 0.31], true); // upside-down
    trim.tube([x, 0.660, fz(0.660)], [x, rF, zF], 0.024, 8, CHROME, true);
  }
  for (const y of [topY, botY]) {
    trim.tube([-0.135, y, fz(y)], [0.135, y, fz(y)], 0.026, 8, ALLOY, true);
  }
  fender(paint, rF, zF, rF + 0.045, 0.075, -0.55, 1.05, WHITE);
  // Clip-ons: BELOW the top yoke and angled down. Bars above it would be the
  // cruiser's riding position on a different frame, and the rider's pose is
  // built on where these end up.
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.092, 0.858, fz(0.858)], [sx * 0.245, 0.840, 0.360], 0.016, 8, ALLOY, true);
    matte.tube([sx * 0.180, 0.848, 0.385], [sx * 0.242, 0.841, 0.362], 0.020, 8, LEATHER, true);
    trim.tube([sx * 0.185, 0.826, 0.372], [sx * 0.268, 0.822, 0.344], 0.009, 6, ALLOY, true);
  }

  // --- fairing -------------------------------------------------------------
  // Slim. The first pass ran this out to a 43 cm section and the bike came
  // back as one red torpedo with a rider sitting on it -- a fairing has to
  // read as a skin stretched over the front of a narrow machine, and the
  // wheel, forks and engine all have to stay visible past it.
  // Two-tone by height, which `loft` will do for nothing: the lower half of a
  // fairing is dark on most of these bikes, and without that break the
  // fairing, the tank and the tail run together into one red mass from nose to
  // tail with a rider sitting on top of it.
  paint.loft([
    { z: 0.860, pts: ring2(0.080, 0.860, 0.070, 14) },
    { z: 0.740, pts: ring2(0.120, 0.820, 0.115, 14) },
    { z: 0.580, pts: ring2(0.155, 0.760, 0.145, 14) },
    { z: 0.400, pts: ring2(0.155, 0.690, 0.155, 14) },
    { z: 0.220, pts: ring2(0.115, 0.618, 0.118, 14) },
  ], [0.26, 0.26, 0.28], { capStart: true, capEnd: false, colTop: WHITE, topFrom: 0.790 });
  // Screen: a small bubble standing off the top of the nose.
  const scr = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = 0.795 - 0.275 * t, cy = 0.928 + 0.145 * t;
    for (let j = 0; j <= 6; j++) {
      const u = -1 + j / 3;
      row.push([u * (0.085 + 0.060 * t), cy - 0.030 * u * u, cz + 0.028 * u * u]);
    }
    scr.push(row);
  }
  trim.patch(scr, GLASS, [0, 0.6, 1]);
  // Twin headlamps stacked into the nose, and mirrors on the fairing rather
  // than on the bars -- both are sportbike signatures.
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * 0.040, 0.862, 0.856, 0.032, 0.036, 0.06, 1, { rim: 0.012 });
    // Lens at the MOUTH of the housing. Sunk to the back of the pocket it has
    // nothing to catch and renders as more shadow -- see `pocket`.
    trim.box(sx * 0.040, 0.868, 0.870, hp.hw * 1.8, 0.046, 0.018, 0, LAMP);
    trim.box(sx * 0.120, 0.812, 0.775, 0.050, 0.028, 0.028, 0, AMBER);
    mirror(trim, sx * 0.235, 0.955, 0.665, 0.046, [sx * 0.120, 0.900, 0.740], [0.16, 0.17, 0.18]);
  }
  // Duct in the flank of the fairing, so the side is not one blank panel.
  for (const sx of [-1, 1]) {
    matte.box(sx * 0.168, 0.690, 0.420, 0.018, 0.070, 0.170, 0, [0.09, 0.10, 0.11]);
  }

  // --- engine and exhaust --------------------------------------------------
  matte.box(0, 0.330, 0.020, 0.290, 0.250, 0.320, 0, ENGINE);
  trim.box(0, 0.560, 0.060, 0.250, 0.090, 0.230, 0, ALLOY);       // cam cover
  // Four headers sweeping down and back into one collector under the engine,
  // then up to a can on the right. `tube` between arbitrary points is the only
  // thing here that can follow that.
  for (const sx of [-1, 1]) {
    for (const dx of [0.040, 0.110]) {
      trim.tube([sx * dx, 0.520, 0.185], [sx * dx * 0.9, 0.330, 0.290], 0.021, 6, CHROME, true);
      trim.tube([sx * dx * 0.9, 0.330, 0.290], [sx * dx * 0.5, 0.185, 0.090], 0.021, 6, CHROME, true);
    }
  }
  trim.tube([0, 0.175, 0.100], [-0.040, 0.190, -0.230], 0.048, 10, CHROME, true);
  matte.loft([
    { z: -0.240, pts: ring2(0.045, 0.235, 0.045, 10, -0.055) },
    { z: -0.420, pts: ring2(0.070, 0.360, 0.070, 10, -0.135) },
    { z: -0.640, pts: ring2(0.062, 0.470, 0.062, 10, -0.185) },
  ], [0.24, 0.25, 0.27], { capStart: true, capEnd: true });
  hole(trim, matte, -0.185, 0.470, -0.642, 0.048, 0.07, -1);
  matte.box(0, 0.145, 0.020, 0.285, 0.080, 0.430, 0, [0.09, 0.095, 0.105]);   // belly pan

  // --- tank, seat, tail unit -----------------------------------------------
  paint.loft([
    { z: 0.440, pts: ring2(0.085, 0.815, 0.055, 12) },
    { z: 0.280, pts: ring2(0.165, 0.840, 0.092, 12) },
    { z: 0.060, pts: ring2(0.178, 0.845, 0.096, 12) },
    { z: -0.090, pts: ring2(0.118, 0.855, 0.062, 12) },
  ], WHITE, { capStart: true, capEnd: true });
  matte.loft([
    { z: -0.090, pts: ring2(0.105, 0.872, 0.035, 10) },
    { z: -0.260, pts: ring2(0.130, 0.882, 0.040, 10) },
    { z: -0.380, pts: ring2(0.115, 0.905, 0.038, 10) },
  ], LEATHER, { capStart: false, capEnd: true });
  // The tail runs UP and back and finishes almost at a point. A level tail is
  // a commuter; this is the one line that carries the whole bike from behind.
  // It is also SHORT -- carried out to the end of the wheelbase it stops being
  // a tail unit and becomes a rocket with a bike underneath.
  paint.loft([
    { z: -0.340, pts: ring2(0.118, 0.898, 0.062, 12) },
    { z: -0.520, pts: ring2(0.102, 0.938, 0.062, 12) },
    { z: -0.660, pts: ring2(0.062, 0.976, 0.048, 12) },
    { z: -0.730, pts: ring2(0.028, 0.992, 0.026, 12) },
  ], WHITE, { capStart: false, capEnd: true });
  trim.box(0, 0.988, -0.742, 0.062, 0.026, 0.018, 0, TAILC);
  // Plate on a hanger off the swingarm side, which is where an undertail
  // exhaust leaves room for it.
  matte.tube([0, 0.930, -0.700], [0, 0.800, -0.775], 0.012, 6, PLASTIC, true);
  trim.box(0, 0.760, -0.790, 0.115, 0.075, 0.012, 0, PLATE);

  // --- single-sided swingarm, rear sets ------------------------------------
  // Only one arm, which is what the name means: from the other side the wheel
  // hangs on nothing, and that is the look. It is on the LEFT (+X), opposite
  // the silencer, the way the bikes that have one are built.
  matte.loft([
    { z: -0.140, pts: ring2(0.038, 0.395, 0.075, 8, 0.140) },
    { z: -0.420, pts: ring2(0.034, 0.360, 0.062, 8, 0.150) },
    { z: zR, pts: ring2(0.030, rR, 0.048, 8, 0.140) },
  ], [0.30, 0.31, 0.33], { capStart: true, capEnd: true });
  trim.tube([0.140, rR, zR], [0.190, rR, zR], 0.055, 10, ALLOY, true);   // hub nut
  trim.tube([0, 0.700, -0.240], [0.020, 0.430, -0.230], 0.026, 8, [0.55, 0.20, 0.16], true); // shock
  for (const sx of [-1, 1]) {
    trim.tube([sx * 0.115, 0.420, -0.180], [sx * 0.185, 0.400, -0.235], 0.012, 6, ALLOY, true);
    matte.tube([sx * 0.185, 0.400, -0.235], [sx * 0.245, 0.398, -0.250], 0.017, 6, PLASTIC, true);
  }

  return wheels;
}

/** `fender`, off the centreline: a quad's four guards sit out on the track. */
function fenderAt(b, cx, cy, cz, r, halfW, a0, a1, col) {
  const rows = [];
  for (let i = 0; i <= 10; i++) {
    const a = a0 + ((a1 - a0) * i) / 10;
    const row = [];
    for (let j = 0; j <= 4; j++) {
      const u = -1 + j / 2;
      const rr = r * (1 - 0.06 * u * u);
      row.push([cx + u * halfW, cy + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
    }
    rows.push(row);
  }
  b.patch(rows, col, [0, 1, 0]);
  // the guard's outer lip turned down, so from the side it has a thickness
  const lip = rows.map((row) => {
    const p = row[cx > 0 ? 4 : 0];
    return [p, [p[0], p[1] - 0.05, p[2]]];
  });
  b.patch(lip, col, [Math.sign(cx) || 1, 0, 0]);
}

const FRAME_C = [0.11, 0.115, 0.125];
const SPRING = [0.72, 0.14, 0.10];

/**
 * The quad bike: a sport-utility ATV, which is a different animal from
 * either motorcycle. Four fat knobbly tyres on a wide track, the plastics as
 * four separate guards joined by a nose and a tail deck, steel racks front and
 * rear, footboards between the wheels, and a straight bar with a lamp pod on
 * it. The rider is the bikes' posed humanoid (see RIDERS.atv) sitting
 * upright on a saddle, feet on the boards.
 *
 * `paint` is the plastics, `matte` the frame, seat, racks and tyres, `trim`
 * the lamps, suspension springs and the chrome.
 */
function buildAtv(spec, paint, trim, matte) {
  const r = spec.wheelR;
  const zF = 0.63, zR = -0.63, xF = 0.46, xR = 0.47;
  // [x, y, z, r, w, out, knobby]
  const wheels = [
    [xF, r, zF, r, 0.24, 1, 1], [-xF, r, zF, r, 0.24, -1, 1],
    [xR, r, zR, r, 0.29, 1, 1], [-xR, r, zR, r, 0.29, -1, 1],
  ];

  // --- frame, engine, footboards -------------------------------------------
  for (const sx of [-1, 1]) {
    matte.tube([sx * 0.15, 0.28, 0.78], [sx * 0.16, 0.26, -0.62], 0.028, 6, FRAME_C, true);
    matte.tube([sx * 0.13, 0.64, 0.50], [sx * 0.14, 0.68, -0.86], 0.026, 6, FRAME_C, true);
    matte.tube([sx * 0.15, 0.28, 0.62], [sx * 0.13, 0.64, 0.50], 0.024, 6, FRAME_C, true);
    matte.tube([sx * 0.16, 0.26, -0.52], [sx * 0.14, 0.67, -0.60], 0.024, 6, FRAME_C, true);
    // footboard and its nerf bar
    matte.box(sx * 0.33, 0.29, -0.03, 0.24, 0.035, 0.56, 0, PLASTIC);
    for (let k = 0; k < 4; k++) matte.box(sx * 0.33, 0.325, -0.24 + k * 0.14, 0.22, 0.012, 0.03, 0, [0.2, 0.21, 0.22]);
    matte.tube([sx * 0.45, 0.33, -0.33], [sx * 0.45, 0.33, 0.26], 0.018, 6, FRAME_C, true);
    matte.tube([sx * 0.45, 0.33, 0.26], [sx * 0.20, 0.30, 0.34], 0.018, 6, FRAME_C, true);
    matte.tube([sx * 0.45, 0.33, -0.33], [sx * 0.20, 0.30, -0.40], 0.018, 6, FRAME_C, true);
  }
  matte.box(0, 0.16, 0.02, 0.32, 0.30, 0.50, 0, ENGINE);                       // crankcase
  matte.tube([0, 0.44, 0.10], [0, 0.66, 0.22], 0.085, 10, [0.09, 0.10, 0.11], true); // barrel
  for (let i = 0; i < 5; i++) {
    const t = 0.15 + i * 0.16;
    trim.tube([0, 0.44 + 0.22 * t, 0.10 + 0.12 * t], [0, 0.44 + 0.22 * (t + 0.05), 0.10 + 0.12 * (t + 0.05)], 0.11, 10, ALLOY, true);
  }
  matte.box(0, 0.06, 0.05, 0.40, 0.05, 0.9, 0, [0.20, 0.21, 0.22]);             // skid plate

  // --- suspension ------------------------------------------------------------
  for (const sx of [-1, 1]) {
    // front double wishbones to the knuckle, a coil-over standing up to the frame
    matte.tube([sx * 0.14, 0.27, zF + 0.10], [sx * (xF - 0.10), r - 0.03, zF], 0.020, 6, FRAME_C, true);
    matte.tube([sx * 0.14, 0.27, zF - 0.10], [sx * (xF - 0.10), r - 0.03, zF], 0.020, 6, FRAME_C, true);
    matte.tube([sx * 0.14, 0.44, zF + 0.08], [sx * (xF - 0.11), r + 0.09, zF], 0.018, 6, FRAME_C, true);
    matte.tube([sx * 0.14, 0.44, zF - 0.08], [sx * (xF - 0.11), r + 0.09, zF], 0.018, 6, FRAME_C, true);
    trim.tube([sx * 0.17, 0.66, zF - 0.04], [sx * (xF - 0.13), r + 0.05, zF - 0.02], 0.040, 8, SPRING, true);
    trim.tube([sx * 0.17, 0.67, zF - 0.04], [sx * (xF - 0.13), r + 0.04, zF - 0.02], 0.018, 6, CHROME, true);
    // rear: swingarm to the axle, and a shock each side
    matte.tube([sx * 0.12, 0.30, -0.18], [sx * 0.20, r, zR], 0.030, 6, FRAME_C, true);
    trim.tube([sx * 0.13, 0.68, -0.40], [sx * 0.19, r + 0.06, zR + 0.10], 0.038, 8, SPRING, true);
  }
  matte.tube([-xR + 0.10, r, zR], [xR - 0.10, r, zR], 0.032, 8, FRAME_C, true);   // rear axle
  matte.tube([-xF + 0.10, r, zF], [-xF + 0.13, r, zF], 0.05, 8, FRAME_C, true);

  // --- plastics --------------------------------------------------------------
  for (const sx of [-1, 1]) {
    fenderAt(paint, sx * xF, r, zF, r + 0.075, 0.155, -0.75, 1.30, WHITE);
    fenderAt(paint, sx * xR, r, zR, r + 0.075, 0.165, -1.30, 0.80, WHITE);
  }
  // nose: from between the front guards up to the bar
  paint.loft([
    { z: 1.00, pts: ring2(0.18, 0.60, 0.06, 12) },
    { z: 0.88, pts: ring2(0.29, 0.64, 0.10, 12) },
    { z: 0.60, pts: ring2(0.33, 0.69, 0.12, 12) },
    { z: 0.34, pts: ring2(0.28, 0.72, 0.11, 12) },
    { z: 0.14, pts: ring2(0.19, 0.76, 0.08, 12) },
  ], WHITE, { capStart: true, capEnd: true });
  // side covers under the saddle
  paint.loft([
    { z: 0.20, pts: ring2(0.17, 0.62, 0.13, 12) },
    { z: -0.10, pts: ring2(0.21, 0.64, 0.15, 12) },
    { z: -0.50, pts: ring2(0.21, 0.66, 0.14, 12) },
    { z: -0.70, pts: ring2(0.16, 0.68, 0.10, 12) },
  ], WHITE, { capStart: true, capEnd: true });
  // tail deck joining the rear guards
  paint.loft([
    { z: -0.44, pts: ring2(0.30, 0.74, 0.05, 12) },
    { z: -0.70, pts: ring2(0.34, 0.75, 0.06, 12) },
    { z: -1.00, pts: ring2(0.30, 0.72, 0.05, 12) },
  ], WHITE, { capStart: true, capEnd: true });
  // saddle
  matte.loft([
    { z: 0.18, pts: ring2(0.11, 0.80, 0.045, 10) },
    { z: 0.02, pts: ring2(0.17, 0.83, 0.065, 10) },
    { z: -0.36, pts: ring2(0.18, 0.845, 0.07, 10) },
    { z: -0.62, pts: ring2(0.15, 0.835, 0.06, 10) },
  ], LEATHER, { capStart: true, capEnd: true });

  // --- lamps -------------------------------------------------------------------
  for (const sx of [-1, 1]) {
    matte.box(sx * 0.14, 0.585, 0.985, 0.13, 0.075, 0.04, 0, [0.03, 0.03, 0.035]);
    trim.box(sx * 0.14, 0.595, 1.004, 0.10, 0.052, 0.012, 0, LAMP);
  }
  trim.box(0, 0.70, -1.015, 0.16, 0.05, 0.02, 0, TAILC);

  // --- racks and bumper --------------------------------------------------------
  const rack = (z0, z1, y, hx) => {
    for (const sx of [-1, 1]) matte.tube([sx * hx, y, z0], [sx * hx, y, z1], 0.015, 6, FRAME_C, true);
    for (let k = 0; k <= 4; k++) {
      const z = z0 + ((z1 - z0) * k) / 4;
      matte.tube([-hx, y, z], [hx, y, z], 0.013, 6, FRAME_C, true);
    }
    for (const sx of [-1, 1]) for (const z of [z0, z1]) matte.tube([sx * hx, y, z], [sx * hx * 0.8, y - 0.14, z], 0.013, 6, FRAME_C, true);
  };
  rack(0.44, 0.93, 0.86, 0.36);
  rack(-0.50, -0.99, 0.90, 0.40);
  matte.tube([-0.26, 0.38, 1.06], [0.26, 0.38, 1.06], 0.022, 6, FRAME_C, true);
  for (const sx of [-1, 1]) {
    matte.tube([sx * 0.26, 0.38, 1.06], [sx * 0.24, 0.62, 1.03], 0.022, 6, FRAME_C, true);
    matte.tube([sx * 0.24, 0.62, 1.03], [sx * 0.10, 0.66, 1.00], 0.020, 6, FRAME_C, true);
    matte.tube([sx * 0.26, 0.38, 1.06], [sx * 0.14, 0.30, 0.82], 0.020, 6, FRAME_C, true);
  }

  // --- bars ------------------------------------------------------------------------
  trim.tube([0, 0.74, 0.34], [0, 0.98, 0.29], 0.022, 8, ALLOY, true);
  for (const sx of [-1, 1]) {
    trim.tube([0, 1.00, 0.29], [sx * 0.16, 1.01, 0.28], 0.016, 8, ALLOY, true);
    trim.tube([sx * 0.16, 1.01, 0.28], [sx * 0.41, 1.04, 0.24], 0.016, 8, ALLOY, true);
    matte.tube([sx * 0.30, 1.03, 0.255], [sx * 0.415, 1.04, 0.24], 0.021, 8, LEATHER, true);
    trim.tube([sx * 0.26, 1.02, 0.28], [sx * 0.36, 1.03, 0.31], 0.008, 6, ALLOY, true);   // lever
  }
  matte.box(0, 0.995, 0.29, 0.14, 0.04, 0.05, 0, [0.06, 0.06, 0.07]);                   // bar pad
  paint.loft([
    { z: 0.28, pts: ring2(0.12, 0.94, 0.05, 10) },
    { z: 0.36, pts: ring2(0.13, 0.935, 0.055, 10) },
    { z: 0.40, pts: ring2(0.11, 0.93, 0.045, 10) },
  ], WHITE, { capStart: true, capEnd: true });
  trim.box(0, 0.93, 0.405, 0.16, 0.05, 0.012, 0, LAMP);

  // --- exhaust down the right --------------------------------------------------
  trim.tube([-0.08, 0.60, 0.20], [-0.22, 0.52, 0.00], 0.030, 8, CHROME, true);
  trim.tube([-0.22, 0.52, 0.00], [-0.25, 0.62, -0.52], 0.030, 8, CHROME, true);
  matte.loft([
    { z: -0.50, pts: ring2(0.05, 0.64, 0.05, 10, -0.26) },
    { z: -0.62, pts: ring2(0.065, 0.645, 0.065, 10, -0.26) },
    { z: -0.90, pts: ring2(0.06, 0.65, 0.06, 10, -0.26) },
  ], [0.22, 0.23, 0.25], { capStart: true, capEnd: true });
  hole(trim, matte, -0.26, 0.65, -0.905, 0.028, 0.05, -1);
  return wheels;
}

// --- the boat --------------------------------------------------------------------
const GEL = [0.86, 0.86, 0.83];        // deck and liner gelcoat
const VINYL = [0.88, 0.85, 0.78];      // upholstery
const NONSKID = [0.70, 0.70, 0.66];
const HULL_BOTTOM = [0.80, 0.81, 0.79];   // a trailer boat's white bottom: the entry shows above water

/**
 * A 5.7 m outboard runabout. Its y = 0 is the WATERLINE (updateBoat sets the
 * group on the local surface), so the V-bottom hangs below it.
 *
 * The hull is a patch per side through ten stations, keel -> chine -> spray
 * rail lip -> flared topside -> sheer, with a real deadrise: 20-odd degrees
 * aft, sharpening to a fine entry forward where the keel sweeps up into the
 * stem. `paint` is the topsides only, so a navy boat still has a white deck
 * (matte gelcoat) the way real ones do. The cockpit is OPEN -- the section
 * is never closed across the top -- with a liner, a floor, two buckets, a
 * bench, consoles, and a wrap-round screen in trim glass you look through at
 * all of it. The driver is `matte.crew`, so a moored boat is empty.
 */
function buildBoat(spec, paint, trim, matte) {
  //        z      hb    sheer  chineX chineY  keelY
  const S = [
    [-2.80, 1.00, 0.60, 0.90, -0.14, -0.30],
    [-2.20, 1.05, 0.61, 0.95, -0.15, -0.32],
    [-1.20, 1.09, 0.63, 0.98, -0.15, -0.34],
    [0.00, 1.10, 0.67, 0.96, -0.13, -0.34],
    [0.90, 1.05, 0.72, 0.88, -0.08, -0.31],
    [1.60, 0.92, 0.77, 0.72, 0.00, -0.24],
    [2.20, 0.68, 0.83, 0.48, 0.12, -0.12],
    [2.62, 0.40, 0.88, 0.24, 0.30, 0.06],
    [2.86, 0.12, 0.92, 0.06, 0.52, 0.32],
    [2.93, 0.02, 0.93, 0.01, 0.72, 0.60],
  ];
  const at = (z) => {
    for (let i = 1; i < S.length; i++) {
      if (z <= S[i][0]) {
        const a = S[i - 1], b = S[i], t = (z - a[0]) / (b[0] - a[0]);
        return a.map((v, k) => v + (b[k] - v) * t);
      }
    }
    return S[S.length - 1].slice();
  };
  const bottomPts = (s, sd) => {
    const [, , , cx, cy, ky] = s;
    return [[0, ky], [sd * cx * 0.5, ky + (cy - ky) * 0.52], [sd * cx, cy], [sd * (cx + 0.05), cy + 0.02]];
  };
  const topPts = (s, sd) => {
    const [, hb, sy, cx, cy] = s;
    return [[sd * (cx + 0.05), cy + 0.02], [sd * (cx + 0.05 + (hb - cx - 0.05) * 0.6), cy + (sy - cy) * 0.45], [sd * hb, sy]];
  };
  for (const sd of [-1, 1]) {
    paint.patch(S.map((s) => topPts(s, sd).map(([x, y]) => [x, y, s[0]])), WHITE, [sd, 0.2, 0]);
    matte.patch(S.map((s) => bottomPts(s, sd).map(([x, y]) => [x, y, s[0]])), HULL_BOTTOM, [sd * 0.5, -1, 0]);
    // a boot stripe laid on the topside just above the water, and a sheer
    // stripe under the rub rail -- the two lines that say "boat"
    const stripe = (f0, f1, col) => {
      matte.patch(S.slice(0, 9).map((s) => {
        const p = topPts(s, sd);
        const q = (f) => {
          // along the topside profile, 0 = chine lip, 1 = sheer
          const seg = f < 0.5 ? [p[0], p[1], f / 0.5] : [p[1], p[2], (f - 0.5) / 0.5];
          const x = seg[0][0] + (seg[1][0] - seg[0][0]) * seg[2], y = seg[0][1] + (seg[1][1] - seg[0][1]) * seg[2];
          return [x + sd * 0.004, y, s[0]];
        };
        return [q(f0), q(f1)];
      }), col, [sd, 0, 0]);
    };
    stripe(0.12, 0.2, [0.07, 0.08, 0.09]);
    stripe(0.80, 0.86, [0.62, 0.10, 0.08]);
    // rub rail along the sheer
    for (let i = 0; i < S.length - 2; i++) {
      matte.tube([sd * (S[i][1] + 0.012), S[i][2] - 0.01, S[i][0]], [sd * (S[i + 1][1] + 0.012), S[i + 1][2] - 0.01, S[i + 1][0]], 0.028, 6, [0.08, 0.08, 0.09], false);
    }
  }
  // transom, both halves, in the topside colour above the chine lip
  for (const sd of [-1, 1]) {
    const s = S[0];
    const prof = [...bottomPts(s, sd), ...topPts(s, sd).slice(1)];
    paint.patch([prof.map(([x, y]) => [x, y, s[0]]), prof.map(([, y]) => [0, y, s[0]])], WHITE, [0, 0, -1]);
  }

  // --- deck ----------------------------------------------------------------------
  // the floor updateBoat keeps above the water (spec.cockpit)
  const [FLOOR, COCK_R, COCK_F] = spec.cockpit, CAP = 0.15;
  const deckStations = S.filter((s) => s[0] <= COCK_F + 1e-6).map((s) => s[0]);
  // gunwale caps down the cockpit
  for (const sd of [-1, 1]) {
    matte.patch(deckStations.map((z) => {
      const s = at(z);
      return [[sd * s[1], s[2], z], [sd * (s[1] - CAP), s[2] + 0.01, z]];
    }), GEL, [0, 1, 0]);
    // inner liner from the cap down to the floor
    matte.patch(deckStations.filter((z) => z >= COCK_R).map((z) => {
      const s = at(z);
      return [[sd * (s[1] - CAP), s[2] + 0.01, z], [sd * (s[1] - CAP - 0.04), FLOOR, z]];
    }), GEL, [-sd, 0.3, 0]);
  }
  // foredeck, cambered, from the screen to the stem
  {
    const rows = [];
    for (const s of S.filter((s) => s[0] >= COCK_F - 1e-6)) {
      const row = [];
      for (let j = 0; j <= 6; j++) {
        const u = -1 + j / 3;
        row.push([u * s[1], s[2] + 0.07 * (1 - u * u) * Math.min(1, s[1] / 0.5), s[0]]);
      }
      rows.push(row);
    }
    matte.patch(rows, GEL, [0, 1, 0]);
  }
  // cockpit floor and the bulkheads fore and aft
  {
    const fr = [];
    for (const z of [COCK_R, -1.2, 0, COCK_F]) {
      const w = at(z)[1] - CAP - 0.04;
      fr.push([[-w, FLOOR, z], [0, FLOOR, z], [w, FLOOR, z]]);
    }
    matte.patch(fr, NONSKID, [0, 1, 0]);
    const sF = at(COCK_F), sR = at(COCK_R);
    matte.quad([-(sF[1] - CAP), FLOOR, COCK_F], [sF[1] - CAP, FLOOR, COCK_F], [sF[1] - CAP, sF[2] + 0.02, COCK_F], [-(sF[1] - CAP), sF[2] + 0.02, COCK_F], [0, 0, -1], [0, 0, 1, 0, 1, 1, 0, 1], GEL);
    matte.quad([-(sR[1] - CAP), FLOOR, COCK_R], [sR[1] - CAP, FLOOR, COCK_R], [sR[1] - CAP, sR[2] + 0.01, COCK_R], [-(sR[1] - CAP), sR[2] + 0.01, COCK_R], [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], GEL);
    // aft deck over the splash well, to the transom
    matte.patch([S[0], S[1]].map((s) => [[-s[1], s[2], s[0]], [0, s[2] + 0.03, s[0]], [s[1], s[2], s[0]]]), GEL, [0, 1, 0]);
  }
  // rear bench: base, cushion, back against the bulkhead
  {
    const w = at(COCK_R + 0.3)[1] - CAP - 0.06;
    matte.box(0, FLOOR, COCK_R + 0.24, w * 2, 0.30, 0.46, 0, GEL);
    matte.box(0, FLOOR + 0.30, COCK_R + 0.25, w * 2 - 0.04, 0.10, 0.44, 0, VINYL);
    rakedBox(matte, 0, FLOOR + 0.40, COCK_R + 0.06, w * 2 - 0.1, 0.34, 0.10, 0.08, VINYL);
  }
  // consoles: helm to starboard (-x), passenger to port
  const HELM = -0.50;
  for (const sx of [-1, 1]) {
    const x = sx * 0.50, top = sx < 0 ? 0.80 : 0.70;
    matte.box(x, FLOOR, 0.62, 0.52, top - FLOOR, 0.52, 0, GEL);
    // raked dash face toward the seat
    matte.quad([x - 0.26, top, 0.36], [x + 0.26, top, 0.36], [x + 0.26, top + 0.10, 0.62], [x - 0.26, top + 0.10, 0.62], [0, 0.93, -0.36], [0, 0, 1, 0, 1, 1, 0, 1], CAB_DASH);
    matte.quad([x - 0.26, top + 0.10, 0.62], [x + 0.26, top + 0.10, 0.62], [x + 0.26, top + 0.10, 0.88], [x - 0.26, top + 0.10, 0.88], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], GEL);
    matte.quad([x - 0.26, top, 0.36], [x - 0.26, FLOOR, 0.36], [x + 0.26, FLOOR, 0.36], [x + 0.26, top, 0.36], [0, 0, -1], [0, 0, 1, 0, 1, 1, 0, 1], GEL);
    // bucket seat on a pedestal
    matte.tube([x, FLOOR, -0.30], [x, FLOOR + 0.30, -0.30], 0.05, 8, [0.5, 0.52, 0.55], true);
    matte.box(x, FLOOR + 0.30, -0.28, 0.46, 0.12, 0.46, 0, VINYL);
    rakedBox(matte, x, FLOOR + 0.40, -0.50, 0.44, 0.46, 0.10, 0.10, VINYL);
  }
  // gauges and wheel at the helm
  for (const dx of [-0.10, 0.10]) trim.tube([HELM + dx, 0.86, 0.47], [HELM + dx, 0.875, 0.455], 0.045, 10, [0.9, 0.9, 0.86], true);
  {
    const R = 0.17, c = [HELM, 0.92, 0.36], tilt = 0.9;
    const pt = (a) => [c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R * Math.cos(tilt), c[2] - Math.sin(a) * R * Math.sin(tilt)];
    for (let i = 0; i < 10; i++) trim.tube(pt((i / 10) * Math.PI * 2), pt(((i + 1) / 10) * Math.PI * 2), 0.014, 4, CHROME, false);
    trim.tube([HELM, 0.92, 0.36], [HELM, 0.86, 0.48], 0.02, 6, CHROME, true);
  }
  // throttle lever beside the helm
  trim.tube([HELM + 0.30, 0.80, 0.42], [HELM + 0.30, 0.95, 0.36], 0.012, 6, CHROME, true);
  trim.box(HELM + 0.30, 0.95, 0.36, 0.06, 0.04, 0.05, 0, [0.06, 0.06, 0.07]);

  // --- windscreen: one wrap-round pane in trim glass, framed ----------------------
  {
    const rows = [];
    const bot = (u) => { const s = at(COCK_F - 0.05); const w = s[1] - 0.10; return [u * w, s[2] + 0.06, COCK_F + 0.02 - 0.42 * u * u]; };
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 8; j++) {
        const u = -1 + j / 4, b = bot(u);
        // raked back 30 degrees and drawn in 8 % at the top
        row.push([b[0] * (1 - 0.08 * t), b[1] + 0.40 * t, b[2] - 0.23 * t]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [0, 0.5, 1]);
    for (let j = 0; j < 8; j++) trim.tube(rows[2][j], rows[2][j + 1], 0.014, 5, CHROME, false);
    for (const j of [0, 8]) trim.tube(rows[0][j], rows[2][j], 0.016, 5, CHROME, false);
  }
  // bow rail on stanchions, bow cleat and nav light, stern cleats and light pole
  for (const sd of [-1, 1]) {
    const pts = [1.05, 1.60, 2.20, 2.62].map((z) => { const s = at(z); return [sd * (s[1] - 0.07), s[2] + 0.30, z]; });
    for (let i = 0; i < pts.length - 1; i++) trim.tube(pts[i], pts[i + 1], 0.013, 6, CHROME, false);
    for (const p of pts) trim.tube([p[0], p[1] - 0.30, p[2]], p, 0.011, 6, CHROME, false);
    trim.box(sd * 0.85, 0.61, -2.55, 0.06, 0.04, 0.18, 0, CHROME);
  }
  trim.tube([-0.08, 0.99, 2.62], [0.08, 0.99, 2.62], 0.015, 6, CHROME, true);        // bow rail tip
  trim.box(0.05, 0.94, 2.72, 0.05, 0.04, 0.07, 0, [0.1, 0.85, 0.3]);
  trim.box(-0.05, 0.94, 2.72, 0.05, 0.04, 0.07, 0, TAILC);
  trim.box(0, 0.95, 2.45, 0.05, 0.03, 0.2, 0, CHROME);
  trim.tube([0.62, 0.61, -2.62], [0.62, 1.55, -2.62], 0.014, 6, CHROME, true);
  trim.tube([0.62, 1.55, -2.62], [0.62, 1.60, -2.62], 0.03, 8, LAMP, true);

  // --- outboard ---------------------------------------------------------------------
  const OZ = -3.08;
  matte.box(0, 0.40, -2.86, 0.34, 0.24, 0.14, 0, [0.12, 0.12, 0.13]);            // transom bracket
  matte.loft([
    { z: -2.86, pts: ring2(0.15, 0.95, 0.24, 12) },
    { z: -3.00, pts: ring2(0.21, 1.00, 0.30, 12) },
    { z: -3.22, pts: ring2(0.20, 0.98, 0.28, 12) },
    { z: -3.38, pts: ring2(0.12, 0.92, 0.20, 12) },
  ], [0.07, 0.07, 0.08], { capStart: true, capEnd: true });
  trim.box(0, 1.00, -3.39, 0.18, 0.05, 0.01, 0, [0.85, 0.86, 0.88]);               // decal band
  matte.box(0, -0.25, OZ, 0.12, 0.95, 0.26, 0, [0.09, 0.09, 0.10]);                  // leg
  matte.box(0, -0.25, OZ - 0.02, 0.30, 0.018, 0.40, 0, [0.09, 0.09, 0.10]);         // cavitation plate
  matte.tube([0, -0.38, OZ + 0.20], [0, -0.38, OZ - 0.16], 0.07, 8, [0.09, 0.09, 0.10], true);
  matte.box(0, -0.58, OZ - 0.04, 0.03, 0.20, 0.16, 0, [0.09, 0.09, 0.10]);          // skeg
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    trim.tube([0, -0.38, OZ - 0.20], [Math.cos(a) * 0.19, -0.38 + Math.sin(a) * 0.19, OZ - 0.23], 0.035, 4, ALLOY, true);
  }

  // --- the driver, at the helm (occupied geometry only) ---------------------------
  if (matte.crew) occupant(matte.crew, HELM, 1.06, -0.46, 0.46, [HELM, 0.92, 0.36]);
  return [];
}

/**
 * Where a rider sits, and how. One entry per bike, because the two riding
 * positions are as different as the bikes: a cruiser rider is upright with his
 * feet ahead of him, a sportbike rider is folded over the tank with his knees
 * behind his hips.
 *
 * Signs, all of which are easy to get backwards: the limb bones hang down the
 * -Y axis, so +x on a thigh or an upper arm swings it BACKWARD and -x swings
 * it forward; +x on the spine leans the torso forward; +z on a bone swings it
 * toward +X, which is the vehicle's left.
 */
const RIDERS = {
  // Sitting up, hands out on pullback bars, feet on forward controls -- so the
  // legs are nearly straight and the reach is almost horizontal.
  cruiser: {
    z: -0.200, hipY: 0.870, seed: 31,
    lean: 0.08, head: -0.14,
    shoulder: [-1.10, 0.30], elbow: [-0.40, 0.06],
    thigh: [-0.90, 0.18], knee: 0.28, foot: -0.20,
  },
  // Folded over the tank: chest down 35 degrees, head back up to look through
  // the screen, knees behind the hips and tucked into the tank.
  sportbike: {
    z: -0.120, hipY: 0.930, seed: 57,
    lean: 0.74, head: -0.82,
    shoulder: [-0.60, 0.22], elbow: [-0.22, 0.06],
    thigh: [-1.35, 0.26], knee: 1.55, foot: -0.25,
  },
  // Upright on the saddle, arms out to a wide straight bar, knees bent over
  // the footboards and splayed round the tank: the quad's stance.
  // Measured in the quad's frame: hands land within ~5 cm of the grips
  // (+-0.36, 1.035, 0.25), soles on the boards (top 0.325).
  // Astride the saddle, knees bent into the footwells, hands on the bars
  // (+-0.36, 0.98, 0.22): the quad's stance, lower and further aft.
  jetski: {
    z: -0.42, hipY: 0.90, seed: 91,
    lean: 0.26, head: -0.24,
    shoulder: [-0.74, 0.30], elbow: [-0.18, 0.06],
    thigh: [-1.20, 0.34], knee: 1.50, foot: -0.12,
  },
  atv: {
    z: -0.19, hipY: 0.96, seed: 77,
    lean: 0.20, head: -0.22,
    shoulder: [-0.70, 0.30], elbow: [-0.16, 0.06],
    thigh: [-1.25, 0.36], knee: 1.45, foot: -0.15,
  },
};

// One rider mesh for the whole fleet, built once. Leathers and a helmet, so a
// rider is legible at the distance a bike is usually seen from.
let RIDER_GEO = null;
function riderGeometry() {
  if (!RIDER_GEO) {
    RIDER_GEO = buildCharacter({
      seed: 4242,
      shirt: [0.14, 0.15, 0.18], pants: [0.10, 0.10, 0.12],
      vest: [0.11, 0.12, 0.15], hat: [0.10, 0.11, 0.14],
    });
  }
  return RIDER_GEO;
}

/** Poses a humanoid onto a bike and returns it, ready to add to the tilt group. */
function makeRider(hand) {
  const p = RIDERS[hand];
  const h = makeHumanoid({ geometry: riderGeometry(), seed: p.seed, scale: 0.96 });
  const b = h.bones;
  b[BONES.spine].rotation.x = p.lean * 0.45;
  b[BONES.chest].rotation.x = p.lean * 0.55;
  b[BONES.neck].rotation.x = p.head * 0.4;
  b[BONES.head].rotation.x = p.head * 0.6;
  for (const [s, sh, el, th, kn, ft] of [
    [-1, BONES.shoulderL, BONES.elbowL, BONES.thighL, BONES.kneeL, BONES.footL],
    [1, BONES.shoulderR, BONES.elbowR, BONES.thighR, BONES.kneeR, BONES.footR],
  ]) {
    b[sh].rotation.set(p.shoulder[0] - p.lean, 0, s * p.shoulder[1]);
    b[el].rotation.set(p.elbow[0], 0, s * p.elbow[1]);
    b[th].rotation.set(p.thigh[0], 0, s * p.thigh[1]);
    b[kn].rotation.x = p.knee;
    b[ft].rotation.x = p.foot;
  }
  gripHands(h);   // palms down, fingers round the bars
  // 0.927 is the hip height of the unscaled character -- see peds.js `J`.
  h.group.position.set(0, p.hipY - 0.927 * h.scale, p.z);
  return h;
}

/**
 * The convertible: a US two-seater with the roof taken off, which is a
 * different problem from every other body here rather than the same one with
 * fewer panels.
 *
 * Nothing is lofted above the beltline at all -- no greenhouse, no roof, no
 * pillars past the screen header. What that leaves is an open box, and the
 * whole shape depends on what is INSIDE it: a floor, a tub, two seats, a dash
 * and a wheel. Without those you are looking down through the beltline at the
 * far sill and the car reads as an empty shell, which is exactly what a
 * roofless body is if nobody builds the interior.
 *
 * The cockpit is built the same way every other opening here is: as a recess
 * whose rim stands proud of the deck. There is no boolean operation in this
 * builder, so the aperture cannot be cut out of the loft -- but a tub dropped
 * in with its rim standing 2 cm above the deck hides the shell underneath from
 * every angle, and what reads is an opening.
 */
function buildConvertible(spec, paint, trim, matte) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.34, zR = -1.30;                 // 2.64 m wheelbase

  const halfW = curve([
    [tail, 0.90], [-2.00, 0.97], [zR, 1.00], [-0.55, 0.93], [0.30, 0.93],
    [zF, 0.99], [2.00, 0.94], [nose, 0.86],
  ]);
  const sillY = curve([
    [tail, 0.32], [-1.90, 0.26], [-0.60, 0.24], [0.60, 0.24], [1.90, 0.26], [nose, 0.32],
  ]);
  // Flat and low along the whole flank. With no roof over it the beltline IS
  // the top of the car, and a dipping one would leave the doors looking like a
  // coupe someone had cut the roof off with a saw.
  const beltY = curve([
    [tail, 0.985], [-1.95, 1.010], [zR, 1.020], [-0.60, 1.005], [0.30, 1.000],
    [0.90, 0.998], [1.40, 0.980], [1.95, 0.945], [nose, 0.920],
  ]);
  const tuckAt = curve([
    [tail, 0.88], [zR, 0.95], [-0.60, 0.88], [0.60, 0.88], [zF, 0.95], [nose, 0.88],
  ]);
  const topAt = curve([
    [tail, 0.90], [-1.80, 0.95], [0.80, 0.95], [1.50, 0.93], [2.10, 0.86], [nose, 0.78],
  ]);
  // The cockpit floor, as a curve rather than a step: the ramp up at the front
  // is the scuttle the dash sits under and the ramp at the back is the deck
  // the folded top stacks on, both of which a convertible has to have.
  const cockF = 0.88, cockR = -1.06, floorY = 0.520;
  // The ramp in FRONT is short on purpose: it is the firewall, and the screen
  // stands just behind it. Drawn out over 30 cm instead it becomes a wall
  // rising in front of the windscreen, which is a scuttle in the wrong place.
  const deckDip = curve([
    [cockR - 0.24, 1.06], [cockR, floorY], [cockF, floorY], [cockF + 0.14, 1.06],
  ]);
  const { geom, half, endProf } = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, tuckAt, topAt, zF, zR,
    archR: 0.56, archGap: 0.06, creaseAt: 0.64, tumble: 0.95,
    deckDrop: 0.026, lipOut: 0.048, endRound: 0.14, endMin: 0.90,
    deckDip,
  });

  const twF = 0.235, twR = 0.275;
  const wxF = geom(zF).wb - twF / 2 + 0.02;
  const wxR = geom(zR).wb - twR / 2 + 0.02;
  const wheels = [
    [-wxF, wr, zF, wr, twF], [wxF, wr, zF, wr, twF],
    [-wxR, wr, zR, wr, twR], [wxR, wr, zR, wr, twR],
  ];

  // --- cockpit: the tub the loft dips into ---------------------------------
  // The interior is laid ON the dipped section's own points, 5 mm proud, the
  // same trick the roof panels use. Registered by construction, so the trim
  // cannot drift off the opening it is lining -- and it has to be a surface of
  // its own regardless, because a `loft` forces every normal outward from the
  // ring's centre and the inside of a tub faces the other way.
  const NZ = 18;
  const tubRows = [], topEdge = [];
  for (let i = 0; i <= NZ; i++) {
    const z = cockR - 0.16 + ((cockF - cockR + 0.30) * i) / NZ;
    const L = half(z, -1), R = half(z, 1);
    const row = [];
    for (const k of [9, 10, 11]) row.push([L[k][0] * 0.985, L[k][1] + 0.005, z]);
    for (const k of [11, 10, 9]) row.push([R[k][0] * 0.985, R[k][1] + 0.005, z]);
    tubRows.push(row);
    topEdge.push([L[8], R[8], z]);
  }
  matte.patch(tubRows, [0.055, 0.058, 0.065], [0, 1, 0]);
  for (const sx of [-1, 1]) {
    // Roll over the top of the door: painted, between the shoulder and the
    // inner lip, which is what a convertible has instead of a window frame.
    paint.patch([
      topEdge.map(([L, R, z]) => (sx < 0 ? [L[0], L[1], z] : [R[0], R[1], z])),
      tubRows.map((r) => (sx < 0 ? [r[0][0], r[0][1] + 0.004, r[0][2]] : [r[5][0], r[5][1] + 0.004, r[5][2]])),
    ], WHITE, [sx, 0.5, 0]);
  }
  // Tunnel and a rear bulkhead, so the floor is not one flat sheet.
  matte.box(0, floorY, -0.200, 0.240, 0.105, 1.00, 0, [0.125, 0.128, 0.138]);
  matte.box(0, floorY, cockR + 0.075, 0.860, 0.230, 0.070, 0, [0.09, 0.095, 0.105]);

  // Seats: a cushion and a raked back, built as a lathe up Y so the back can
  // lean without `box`'s yaw-only rotation getting in the way.
  const seat = (sx) => {
    const cx = sx * 0.300, cz = -0.320;
    matte.loftY([
      { y: floorY + 0.030, pts: ring2(0.220, cz, 0.240, 10, cx) },
      { y: floorY + 0.150, pts: ring2(0.235, cz, 0.250, 10, cx) },
      { y: floorY + 0.200, pts: ring2(0.210, cz + 0.02, 0.220, 10, cx) },
    ], LEATHER, { capStart: true, capEnd: true });
    // Backrest, raked and tall enough to stand above the beltline -- a seat
    // whose top is under the door line cannot be seen from outside the car at
    // all, and the interior is the whole point of this body.
    matte.loftY([
      { y: floorY + 0.180, pts: ring2(0.215, cz - 0.190, 0.085, 10, cx) },
      { y: floorY + 0.380, pts: ring2(0.220, cz - 0.245, 0.080, 10, cx) },
      { y: floorY + 0.560, pts: ring2(0.190, cz - 0.305, 0.070, 10, cx) },
    ], LEATHER, { capStart: true, capEnd: true });
    matte.box(cx, floorY + 0.575, cz - 0.330, 0.185, 0.135, 0.095, 0, LEATHER);   // head restraint
  };
  seat(-1); seat(1);

  // Dash, binnacle and a wheel on a raked column. The wheel is a ring of tubes
  // rather than a torus primitive, since there is not one here.
  const cowlY = beltY(cockF);
  matte.patch([
    [[-0.560, cowlY - 0.020, cockF - 0.030], [0, cowlY - 0.010, cockF - 0.045], [0.560, cowlY - 0.020, cockF - 0.030]],
    [[-0.545, cowlY - 0.150, cockF - 0.220], [0, cowlY - 0.140, cockF - 0.235], [0.545, cowlY - 0.150, cockF - 0.220]],
    [[-0.520, floorY + 0.130, cockF - 0.250], [0, floorY + 0.140, cockF - 0.265], [0.520, floorY + 0.130, cockF - 0.250]],
  ], [0.145, 0.150, 0.160], [0, 0.6, -1]);
  // Bright strip along the top edge of the dash. Without it the dash, the tub
  // and the footwell are three dark surfaces meeting at unlit angles and the
  // whole front of the cockpit reads as one hole.
  trim.tube([-0.545, cowlY - 0.014, cockF - 0.034], [0.545, cowlY - 0.014, cockF - 0.034],
    0.014, 6, CHROME, true);
  // Left-hand drive: the wheel goes on the +X side, which is the vehicle's own
  // left. Built on -X it is on the kerb side of an American street.
  trim.tube([0.170, cowlY - 0.085, cockF - 0.160], [0.470, cowlY - 0.085, cockF - 0.150],
    0.078, 10, [0.19, 0.20, 0.21], true);        // instrument binnacle
  // The wheel goes where a DRIVER's hands are -- about 35 cm in front of the
  // seat back, not up against the dash. Pushed forward to look tidy against
  // the bulkhead it leaves the cockpit reading as an empty tub with a screen.
  const wc = [0.330, 0.915, 0.155];
  matte.tube([0.395, 1.000, 0.560], wc, 0.024, 8, [0.16, 0.17, 0.18], true);
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
    // The rim lies in a plane raked back 30 degrees, so its z varies with the
    // point's height -- a wheel built flat reads as a plate on the dash.
    const p = (a) => [wc[0] + Math.cos(a) * 0.175, wc[1] + Math.sin(a) * 0.175 * 0.87,
      wc[2] - Math.sin(a) * 0.175 * 0.50];
    // Bright rim, into `trim`. A dark-grey wheel in a dark tub is invisible
    // however carefully it is placed -- and a period wheel is chrome and wood
    // anyway, so the thing that reads is also the thing that is right.
    trim.tube(p(a0), p(a1), 0.020, 6, [0.62, 0.50, 0.34]);
  }
  for (const a of [1.7, 3.8, 5.9]) {
    trim.tube(wc, [wc[0] + Math.cos(a) * 0.155, wc[1] + Math.sin(a) * 0.135, wc[2] - Math.sin(a) * 0.078],
      0.013, 6, ALLOY, true);
  }
  trim.tube([wc[0], wc[1], wc[2] + 0.010], [wc[0], wc[1], wc[2] - 0.020], 0.048, 10, CHROME, true);
  matte.box(-0.180, cowlY - 0.110, cockF - 0.185, 0.320, 0.105, 0.14, 0, [0.19, 0.20, 0.21]);  // glovebox lid
  trim.tube([-0.055, floorY + 0.150, -0.080], [-0.060, floorY + 0.290, -0.045], 0.016, 6, CHROME, true); // shifter

  // --- windscreen frame and roll hoops -------------------------------------
  const hdrZ = 0.460, hdrY = spec.roof, baseY = cowlY + 0.010;
  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = cockF - 0.020 + (hdrZ - cockF + 0.020) * t, cy = baseY + (hdrY - baseY) * t;
    for (let j = 0; j <= 6; j++) {
      const u = -1 + j / 3;
      row.push([u * (0.560 - 0.055 * t), cy - 0.030 * u * u, cz - 0.075 * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);
  // A-pillars off the screen's OWN edge points, and a header across the top.
  // Sized by eye they end up beside the glass rather than on it -- the sports
  // car's first pillar was a pipe lying on the roof for the same reason.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const a = scrRows[i][scrRows[i].length - 1], b2 = scrRows[i + 1][scrRows[i + 1].length - 1];
      trim.tube([sx * a[0], a[1], a[2]], [sx * b2[0], b2[1], b2[2]], 0.028, 8, CHROME, true);
    }
  }
  const hdr = scrRows[3];
  trim.tube([hdr[0][0], hdr[0][1], hdr[0][2]], [hdr[hdr.length - 1][0], hdr[hdr.length - 1][1], hdr[hdr.length - 1][2]],
    0.030, 8, CHROME, true);
  // Roll hoops behind the seats. Two of them, and they are the only thing that
  // stands above the beltline behind the screen.
  for (const sx of [-1, 1]) {
    const hz = -0.760, hy = beltY(hz);
    const arc = [];
    for (let i = 0; i <= 5; i++) {
      const a = (i / 5) * Math.PI * 0.5;
      arc.push([sx * (0.370 - 0.155 * Math.sin(a) * Math.sin(a)), hy + 0.300 * Math.sin(a), hz - 0.030 * Math.sin(a)]);
    }
    for (let i = 0; i < 5; i++) trim.tube(arc[i], arc[i + 1], 0.030, 8, [0.55, 0.57, 0.60], true);
  }

  // --- folded top stack ----------------------------------------------------
  // A soft top does not disappear; it stacks behind the seats, and the deck
  // over it is the reason a convertible's tail is longer than a coupe's.
  matte.loft([
    { z: -0.980, pts: ring2(0.520, beltY(-0.98) - 0.055, 0.085, 12) },
    { z: -1.180, pts: ring2(0.545, beltY(-1.18) - 0.010, 0.115, 12) },
    { z: -1.420, pts: ring2(0.500, beltY(-1.42) - 0.020, 0.100, 12) },
  ], [0.085, 0.09, 0.10], { capStart: true, capEnd: true });
  for (let i = 0; i < 3; i++) {
    // The bows showing through the cover. Evenly spaced bright bars read as a
    // grille laid on the deck; three dark ones read as folded fabric.
    matte.box(0, beltY(-1.18) + 0.090 - i * 0.006, -1.075 - i * 0.115, 0.980 - i * 0.05, 0.014, 0.028, 0,
      [0.055, 0.058, 0.065]);
  }
  // Body-colour lip round the front of the well, which is what the tonneau
  // shuts against.
  paint.box(0, beltY(-0.98) - 0.030, -0.950, 1.120, 0.045, 0.075, 0, WHITE);

  // --- front fascia --------------------------------------------------------
  const GRILLE = [0, 0.640, 0.520, 0.090], LAMP_A = [0.610, 0.680, 0.140, 0.070];
  const INTAKE = [0, 0.440, 0.440, 0.045];
  const TAILA = [0.400, 0.700, 0.230, 0.080], PIPE = [0.420, 0.560, 0.038, 0.038];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
  endFace(paint, tail, -1, endProf(tail), [TAILA, PIPE], WHITE);

  const gp = pocket(paint, matte, GRILLE[0], GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.14, 1,
    { rim: 0.032, rimCol: CHROME });
  for (let i = -6; i <= 6; i++) {
    trim.box(i * 0.078, GRILLE[1], gp.z + 0.015, 0.018, 0.150, 0.03, 0, [0.28, 0.29, 0.31]);
  }
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.10, 1,
      { rim: 0.024, rimCol: CHROME });
    trim.box(sx * LAMP_A[0], 0.692, nose - 0.030, hp.hw * 1.9, 0.074, 0.024, 0, LAMP);
    trim.box(sx * LAMP_A[0], 0.632, hp.z + 0.045, hp.hw * 1.9, 0.022, 0.024, 0, AMBER);
  }
  pocket(paint, matte, INTAKE[0], INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.11, 1, { rim: 0.024 });
  trim.box(0, 0.370, nose + 0.008, 1.52, 0.085, 0.12, 0, CHROME);
  trim.box(0, 0.395, nose + 0.046, 0.42, 0.135, 0.02, 0, PLATE);

  // --- rear ----------------------------------------------------------------
  for (const sx of [-1, 1]) {
    const tp = pocket(paint, matte, sx * TAILA[0], TAILA[1], tail, TAILA[2], TAILA[3], 0.07, -1,
      { rim: 0.026, rimCol: CHROME });
    trim.box(sx * TAILA[0], 0.700, tail + 0.022, tp.hw * 1.9, 0.135, 0.026, 0, TAILC);
    trim.box(sx * (TAILA[0] + 0.140), 0.700, tail + 0.022, 0.075, 0.135, 0.026, 0, AMBER);
    hole(trim, matte, sx * PIPE[0], PIPE[1], tail, 0.050, 0.12, -1);
  }
  trim.box(0, 0.370, tail - 0.008, 1.52, 0.085, 0.12, 0, CHROME);
  trim.box(0, 0.560, tail - 0.026, 0.42, 0.135, 0.02, 0, PLATE);

  // --- flanks --------------------------------------------------------------
  for (const sx of [-1, 1]) {
    trim.box(sx * (geom(0).wb + 0.008), 0.250, 0, 0.028, 0.048, 2.00, 0, CHROME);
    // One shut line: this is a two-door, and the door is long.
    const rows = [-0.009, 0.009].map((dz) =>
      half(0.94 + dz, sx).slice(2, 9).map(([x, y]) => [x + sx * 0.005, y, 0.94 + dz]));
    matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
    const hg = geom(-0.10);
    trim.tube([sx * hg.w * 0.985, hg.yc + 0.09, -0.20], [sx * hg.w * 0.985, hg.yc + 0.09, 0.00],
      0.017, 6, CHROME, true);
    // Mirror on the door shoulder, at the base of the A-pillar.
    paint.tube([sx * 0.760, 1.000, 0.760], [sx * 0.870, 1.020, 0.720], 0.020, 6, WHITE, true);
    paint.box(sx * 0.905, 0.985, 0.688, 0.100, 0.085, 0.055, 0, WHITE);
    trim.box(sx * 0.905, 0.992, 0.660, 0.086, 0.066, 0.02, 0, MIRROR);
    // Side gill behind the front arch, the one flank feature.
    for (let i = 0; i < 3; i++) {
      matte.box(sx * (geom(0.70).w + 0.004), geom(0.70).yc - 0.08 + i * 0.048, 0.70,
        0.012, 0.030, 0.22, 0, [0.10, 0.11, 0.12]);
    }
  }

  return wheels;
}

/**
 * A tapered aerofoil surface through span stations `{ x, y, zLE, c }` -- a
 * wing, a tailplane or (with `vertical`) a fin. Upper and lower skins are
 * patches over a NACA 00xx half-thickness with cosine chord spacing, so the
 * leading edge is round and the trailing edge thin. The wings used to be
 * 18 cm boxes: a plank reads as a plank from every angle a player flies past.
 */
function aerofoil(b, col, stations, { thick = 0.12, n = 8, vertical = false } = {}) {
  const half = (t) => thick * 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);
  const ts = [];
  for (let i = 0; i <= n; i++) ts.push((1 - Math.cos((Math.PI * i) / n)) / 2);
  const upper = [], lower = [];
  for (const st of stations) {
    const ru = [], rl = [];
    for (const t of ts) {
      const z = st.zLE - t * st.c, h = half(t) * st.c;
      if (vertical) { ru.push([st.x + h, st.y, z]); rl.push([st.x - h, st.y, z]); }
      else { ru.push([st.x, st.y + h * 1.2, z]); rl.push([st.x, st.y - h * 0.8, z]); }
    }
    upper.push(ru); lower.push(rl);
  }
  b.patch(upper, col, vertical ? [1, 0, 0] : [0, 1, 0]);
  b.patch(lower, col, vertical ? [-1, 0, 0] : [0, -1, 0]);
  const tip = stations.length - 1;
  b.patch([upper[tip], lower[tip]], col, vertical ? [0, 1, 0] : [Math.sign(stations[tip].x) || 1, 0, 0]);
}

// ---------------------------------------------------------------------------
// Aircraft kit: shared by the twin, the jet, the biplane and the helicopter.
// ---------------------------------------------------------------------------

/**
 * A SPINNING part -- a propeller or a rotor. `b` is a Builder of matte-coloured
 * geometry centred on its own hub; `at` is where the hub sits on the airframe
 * and `axis` what it turns about ('x', 'y' or 'z').
 *
 * buildType bakes every spin part STILL into the parked/traffic geometries
 * (matteGeoW / matteGeoWE, and so the far LOD), and keeps it as its own
 * geometry for the flown aircraft: Vehicle.setDetailed(true) hangs one live
 * mesh per part and drops the baked copy with the rest of the W geometry. A
 * parked aircraft is 3 draws; only the one being flown pays for its rotors.
 * The live prop used to exist on every plane, parked or not, and spin at
 * idle beside the runway.
 */
function spinPart(matte, at, axis, b) {
  if (!matte.spins) throw new Error('spinPart: buildType did not open matte.spins');
  matte.spins.push({ b, at, axis });
}

/** Rotate the vertices a builder added since `from` about Y (and their normals). */
function rotYFrom(b, from, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  for (let i = from * 3; i < b.pos.length; i += 3) {
    const x = b.pos[i], z = b.pos[i + 2];
    b.pos[i] = x * c + z * s; b.pos[i + 2] = -x * s + z * c;
    const nx = b.nor[i], nz = b.nor[i + 2];
    b.nor[i] = nx * c + nz * s; b.nor[i + 2] = -nx * s + nz * c;
  }
}

/** Swap two axes of everything a builder added since `from` (a blade laid along x, stood up). */
function swapFrom(b, from, a0, a1) {
  for (let i = from * 3; i < b.pos.length; i += 3) {
    let t = b.pos[i + a0]; b.pos[i + a0] = b.pos[i + a1]; b.pos[i + a1] = t;
    t = b.nor[i + a0]; b.nor[i + a0] = b.nor[i + a1]; b.nor[i + a1] = t;
  }
  // an axis swap is a reflection: flip the winding back
  for (let i = 0; i < b.idx.length; i += 3) {
    if (b.idx[i] < from) continue;
    const t = b.idx[i + 1]; b.idx[i + 1] = b.idx[i + 2]; b.idx[i + 2] = t;
  }
}

/**
 * Rotor or propeller blades in the XZ plane round the origin, turning about
 * Y: `n` blades from `r0` to `r`, `chord` wide, a thin aerofoil in section,
 * with a painted tip band. Twist is baked in (`twist` radians root to tip) --
 * a flat plank is what reads as a toy propeller. Stood up for a propeller by
 * swapping Y and Z afterwards (see propeller()).
 */
function blades(b, n, r0, r, chord, col, tipCol, { twist = 0.35, thick = 0.10, droop = 0, tipChord = null, phase = 0 } = {}) {
  const tc = tipChord === null ? chord : tipChord;
  for (let k = 0; k < n; k++) {
    const from = b.pos.length / 3;
    const tipAt = r - Math.min(0.30, r * 0.09);
    const st = [];
    for (const u of [0, 0.35, 0.75, 1]) {
      const x = lerp(r0, tipAt, u);
      st.push({ x, c: lerp(chord, tc, u), tw: twist * (1 - u), y: -droop * u * u });
    }
    st.push({ x: r, c: tc * 0.8, tw: 0, y: -droop });
    const skin = (sgn) => st.map(({ x, c, tw, y }) => {
      const row = [];
      for (let j = 0; j <= 4; j++) {
        const t = j / 4;
        const h = thick * c * 0.5 * Math.sin(Math.PI * Math.sqrt(t)) * (sgn > 0 ? 1 : 0.35);
        const z0 = (0.5 - t) * c;
        // twist: rotate the section about the blade axis (x)
        row.push([x, y + z0 * Math.sin(tw) + sgn * h * Math.cos(tw), z0 * Math.cos(tw) - sgn * h * Math.sin(tw)]);
      }
      return row;
    });
    const up = skin(1), dn = skin(-1);
    // tip band colour on the last two stations
    const body = (rows) => rows.slice(0, 4), tip = (rows) => rows.slice(3);
    b.patch(body(up), col, [0, 1, 0]); b.patch(body(dn), col, [0, -1, 0]);
    b.patch(tip(up), tipCol, [0, 1, 0]); b.patch(tip(dn), tipCol, [0, -1, 0]);
    b.patch([up[up.length - 1], dn[dn.length - 1]], tipCol, [1, 0, 0]);
    rotYFrom(b, from, phase + (k / n) * Math.PI * 2);
  }
}

/** A propeller turning about +Z (nose), hub at the origin: blades plus a hub. */
function propeller(n, r, chord, col = [0.08, 0.08, 0.09], tipCol = [0.95, 0.78, 0.10], opts = {}) {
  const b = new Builder(false);
  blades(b, n, 0.08, r, chord, col, tipCol, { twist: 0.55, thick: 0.12, ...opts });
  // Y and Z swapped: the disc now lies in XY and turns about Z.
  swapFrom(b, 0, 1, 2);
  return b;
}

// Symmetric ring angles for a fuselage section: 0 is +x (port), pi/2 the
// crown. From the keel round the port side to the crown and down the
// starboard, so a quad index k names one strip of skin. `HULL_A` gives
// window rows on each side and a narrow crown strip.
const HULL_HALF = [-Math.PI / 2, -1.12, -0.74, -0.38, -0.05, 0.28, 0.58, 0.88, 1.18, 1.40];
const HULL_A = [...HULL_HALF, Math.PI / 2, ...HULL_HALF.slice(1).reverse().map((a) => Math.PI - a)];

/**
 * One fuselage section: a superellipse `w` wide either side, `ht` over and
 * `hb` under the centre height `yc`, through the given angles. `sq` above 2
 * squares it off (a fabric fuselage's longerons), 2 is an ellipse.
 */
function hullRing(z, w, ht, hb, yc, angs = HULL_A, sq = 2) {
  const e = 2 / sq;
  return { z, pts: angs.map((a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [Math.sign(c) * Math.abs(c) ** e * w, yc + Math.sign(s) * Math.abs(s) ** e * (s > 0 ? ht : hb)];
  }) };
}

/** Linear lookup in a station table [[z, ...values]] ordered nose (high z) to tail. */
function stationAt(ST, z) {
  if (z >= ST[0][0]) return ST[0].slice(1);
  for (let i = 1; i < ST.length; i++) {
    if (z >= ST[i][0]) {
      const a = ST[i], b = ST[i - 1], t = (z - a[0]) / (b[0] - a[0] || 1);
      return a.slice(1).map((v, j) => lerp(v, b[j + 1], t));
    }
  }
  return ST[ST.length - 1].slice(1);
}

/**
 * Loft a hull through `rings` and send each quad to a builder of its own:
 * `pick(i, k, zMid)` returns [builder, colour] (paint, glass in trim, a matte
 * livery band) or null for an opening. Windows cut this way are the skin
 * itself, so a see-through pane shows the cabin behind it and never the
 * painted shell. Normals come from the whole surface like loft's, so the
 * panes and the paint around them shade as one skin. `inset` shrinks the
 * rings toward their centre and `inward` turns the normals in -- the liner of
 * a cockpit you look into.
 */
function hullLoft(rings, pick, { inset = 0, inward = false, caps = true } = {}) {
  const R = rings.length, K = rings[0].pts.length;
  const cen = rings.map((r) => {
    let x = 0, y = 0;
    for (const p of r.pts) { x += p[0]; y += p[1]; }
    return [x / K, y / K];
  });
  const P = rings.map((r, i) => r.pts.map(([x, y]) => {
    const dx = x - cen[i][0], dy = y - cen[i][1], l = Math.hypot(dx, dy) || 1;
    const k = inset ? Math.max(0, 1 - inset / l) : 1;
    return [cen[i][0] + dx * k, cen[i][1] + dy * k, r.z];
  }));
  const N = [];
  for (let i = 0; i < R; i++) {
    N.push([]);
    for (let k = 0; k < K; k++) {
      const a = P[Math.max(0, i - 1)][k], c = P[Math.min(R - 1, i + 1)][k];
      const kp = P[i][(k - 1 + K) % K], kn = P[i][(k + 1) % K];
      const u = [kn[0] - kp[0], kn[1] - kp[1], kn[2] - kp[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      const ox = P[i][k][0] - cen[i][0], oy = P[i][k][1] - cen[i][1];
      if ((n[0] * ox + n[1] * oy < 0) !== inward) n = [-n[0], -n[1], -n[2]];
      N[i].push(n);
    }
  }
  for (let i = 0; i < R - 1; i++) {
    const zm = (rings[i].z + rings[i + 1].z) / 2;
    for (let k = 0; k < K; k++) {
      const got = pick(i, k, zm);
      if (!got) continue;
      const k2 = (k + 1) % K;
      got[0].quad(P[i][k], P[i][k2], P[i + 1][k2], P[i + 1][k],
        [N[i][k], N[i][k2], N[i + 1][k2], N[i + 1][k]], [0, 0, 1, 0, 1, 1, 0, 1], got[1]);
    }
  }
  if (caps) {
    for (const [i, dir] of [[0, 1], [R - 1, -1]]) {
      const got = pick(i === 0 ? -1 : R - 1, -1, rings[i].z);
      if (!got) continue;
      const c = [cen[i][0], cen[i][1], rings[i].z];
      for (let k = 0; k < K; k++) got[0].tri(c, P[i][k], P[i][(k + 1) % K], [0, 0, inward ? -dir : dir], got[1]);
    }
  }
  return { P, cen };
}

/**
 * A rounded cabin window ON a fuselage skin: a dark matte backing 3 mm proud
 * and the pane 3 mm over that (see "Vehicle glass is see-through": glass over
 * a skin is backed, or it shows the paint under it). `skin(z, y)` is the
 * skin's half-width at a point; the window is centred on (zc, yc), `w` long
 * and `h` tall, with superellipse corners.
 */
function skinWindow(trim, matte, skin, sd, zc, yc, w, h, back = CAB_FLOOR) {
  const rows = [], J = 6;
  for (let j = 0; j <= J; j++) {
    const t = -1 + (2 * j) / J;
    const hh = (h / 2) * (1 - Math.abs(t) ** 3) ** (1 / 3);
    const z = zc + t * w / 2, row = [];
    for (const f of [-1, -0.33, 0.33, 1]) {
      const y = yc + f * Math.max(hh, 0.004);
      row.push([z, y]);
    }
    rows.push(row);
  }
  const lay = (b, d, col) => b.patch(rows.map((r) => r.map(([z, y]) => [sd * (skin(z, y) + d), y, z])), col, [sd, 0, 0]);
  lay(matte, 0.003, back);
  lay(trim, 0.006, GLASS);
}

/** A simple aircraft wheel about X: tyre in matte, hub in trim. */
function airWheel(trim, matte, x, y, z, r, w) {
  matte.tube([x - w / 2, y, z], [x + w / 2, y, z], r, 14, TYRE, true);
  matte.tube([x - w / 2 - 0.004, y, z], [x + w / 2 + 0.004, y, z], r * 0.72, 12, [0.07, 0.07, 0.075], true);
  trim.tube([x - w / 2 - 0.012, y, z], [x + w / 2 + 0.012, y, z], r * 0.46, 10, HUB, true);
}

const ALU = [0.72, 0.73, 0.75];
const DARK = [0.10, 0.105, 0.11];
const NAV_R = TAILC, NAV_G = [0.1, 0.85, 0.3];

/**
 * Light aircraft, nose at +z: the high-wing trainer, the low-wing sport single
 * and the floatplane. `wid` stays the FUSELAGE so street-scale collision
 * works; the wings are simply drawn wider. Gear is drawn into `matte` rather
 * than returned as wheels -- aircraft wheels neither steer nor need
 * articulation, and an empty wheel list keeps setDetailed() a no-op.
 */
function buildPlane(spec, paint, trim, matte) {
  const half = spec.len / 2;
  const low = spec.wing === 'low';
  const N = 14;
  // Fuselage stations: [z, halfWidth, halfHeight, centreY], nose to tail.
  const ST = [
    [half, 0.16, 0.16, 1.15], [half - 0.30, 0.50, 0.47, 1.12], [half - 0.90, 0.60, 0.60, 1.16],
    [half - 1.50, 0.64, 0.74, 1.26], [half - 2.30, 0.66, 0.84, 1.34], [half - 3.20, 0.62, 0.78, 1.34],
    [half - 4.20, 0.44, 0.52, 1.36], [-half + 1.60, 0.28, 0.34, 1.42], [-half + 0.60, 0.16, 0.25, 1.50],
    [-half + 0.08, 0.09, 0.18, 1.54],
  ];
  const ring = (z, w, h, yc) => {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push([Math.cos(a) * w, yc + Math.sin(a) * h]);
    }
    return { z, pts };
  };
  paint.loft([...ST].reverse().map((s) => ring(...s)), WHITE, { capStart: true, capEnd: true });
  // The body's own ellipse at any station, so windows and the cheat line sit
  // ON it rather than floating at a guessed radius.
  const at = (z) => {
    for (let i = 1; i < ST.length; i++) {
      if (z >= ST[i][0]) {
        const [z0, w0, h0, y0] = ST[i], [z1, w1, h1, y1] = ST[i - 1];
        const t = (z - z0) / (z1 - z0 || 1);
        return [lerp(w0, w1, t), lerp(h0, h1, t), lerp(y0, y1, t)];
      }
    }
    return ST[ST.length - 1].slice(1);
  };
  const skinX = (z, y, d) => {
    const [w, h, yc] = at(z), u = clamp((y - yc) / h, -0.98, 0.98);
    return w * Math.sqrt(1 - u * u) + d;
  };
  for (const sd of [-1, 1]) {
    // Cabin side windows, laid on the skin.
    const rows = [];
    for (let i = 0; i <= 3; i++) {
      const z = lerp(half - 1.55, half - 3.05, i / 3), row = [];
      for (const y of [1.44, 1.60, 1.76]) row.push([sd * skinX(z, y, 0.008), y, z]);
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sd, 0, 0]);
    // The pane is laid on the skin, so the see-through glass would show the
    // paint under it: back it with the cabin's dark, 4 mm in.
    matte.patch(rows.map((r) => r.map(([x, y, z]) => [x - sd * 0.004, y, z])), CAB_FLOOR, [sd, 0, 0]);
    matte.patch([0, 1, 2, 3].map((i) => {
      const z = lerp(half - 2.25, half - 2.33, 0), y0 = 1.40 + i * 0.13;
      return [[sd * skinX(z, y0, 0.012), y0, z], [sd * skinX(z - 0.08, y0, 0.012), y0, z - 0.08]];
    }), [0.08, 0.09, 0.10], [sd, 0, 0]);
    // Cheat line down the flank.
    const band = [];
    for (let i = 0; i <= 8; i++) {
      const z = lerp(half - 0.40, -half + 0.50, i / 8), [, h, yc] = at(z);
      const ya = yc - h * 0.05, yb = yc + h * 0.09;
      band.push([[sd * skinX(z, ya, 0.006), ya, z], [sd * skinX(z, yb, 0.006), yb, z]]);
    }
    matte.patch(band, [0.06, 0.11, 0.26], [sd, 0, 0]);
  }
  // Windscreen, wrapping over the cowl into the cabin roof.
  trim.loft([
    ring(half - 1.30, 0.56, 0.30, 1.70), ring(half - 1.70, 0.64, 0.40, 1.80), ring(half - 2.25, 0.63, 0.40, 1.80),
  ].reverse(), GLASS, { capStart: true, capEnd: true });
  // And a dark cockpit a centimetre inside it, for the same reason.
  matte.loft([
    ring(half - 1.31, 0.55, 0.29, 1.70), ring(half - 1.70, 0.63, 0.39, 1.80), ring(half - 2.24, 0.62, 0.39, 1.80),
  ].reverse(), CAB_FLOOR, { capStart: true, capEnd: true });
  // Spinner. No baked blades: the constructor hangs a LIVE prop group at the
  // nose for spec.plane, and baked ones underneath it would show as a frozen
  // ghost cross behind the spinning one.
  paint.loft([
    ring(half + 0.02, 0.17, 0.17, 1.12), ring(half + 0.24, 0.10, 0.10, 1.12), ring(half + 0.36, 0.03, 0.03, 1.12),
  ], WHITE, { capEnd: true });
  for (const sd of [-1, 1]) {
    trim.tube([sd * 0.30, 0.98, half - 0.31], [sd * 0.30, 0.98, half - 0.27], 0.085, 10, CAVITY, true);    // cooling inlets
    matte.tube([sd * 0.22, 0.66, half - 0.70], [sd * 0.24, 0.60, half - 0.35], 0.030, 6, [0.25, 0.24, 0.22], true);   // exhaust
  }

  // --- wings --------------------------------------------------------------------
  const wingY = low ? 0.95 : 2.13;
  const span = low ? 4.3 : 5.5;
  for (const sd of [-1, 1]) {
    const st = low
      ? [{ x: 0, y: wingY, zLE: half - 1.60, c: 1.75 }, { x: sd * 2.2, y: wingY + 0.12, zLE: half - 1.78, c: 1.45 },
        { x: sd * span, y: wingY + 0.28, zLE: half - 2.02, c: 0.85 }]
      : [{ x: 0, y: wingY, zLE: half - 1.90, c: 1.60 }, { x: sd * 3.0, y: wingY + 0.06, zLE: half - 1.92, c: 1.52 },
        { x: sd * span, y: wingY + 0.14, zLE: half - 2.10, c: 1.05 }];
    aerofoil(paint, WHITE, st, { thick: 0.12 });
    // Aileron hinge line and a nav light at the tip: red to port (+x, since
    // the nose is +z), green to starboard.
    const tip = st[st.length - 1], mid = st[1];
    matte.patch([
      [[mid.x, mid.y + 0.012, mid.zLE - mid.c * 0.74], [tip.x * 0.97, tip.y + 0.010, tip.zLE - tip.c * 0.74]],
      [[mid.x, mid.y + 0.012, mid.zLE - mid.c * 0.77], [tip.x * 0.97, tip.y + 0.010, tip.zLE - tip.c * 0.77]],
    ], [0.12, 0.13, 0.14], [0, 1, 0]);
    trim.box(tip.x + sd * 0.02, tip.y - 0.03, tip.zLE - 0.20, 0.05, 0.06, 0.16, 0, sd > 0 ? TAILC : [0.1, 0.85, 0.3]);
    if (!low) {
      // Lift strut from the lower fuselage to a third of the way out.
      matte.tube([sd * 0.52, 0.86, half - 2.10], [sd * 2.60, wingY - 0.04, half - 2.30], 0.040, 6, [0.72, 0.73, 0.75], true);
    }
  }
  // --- tail -----------------------------------------------------------------------
  for (const sd of [-1, 1]) {
    aerofoil(paint, WHITE, [{ x: 0, y: 1.50, zLE: -half + 1.18, c: 0.98 }, { x: sd * 1.65, y: 1.53, zLE: -half + 0.92, c: 0.55 }], { thick: 0.10, n: 6 });
  }
  aerofoil(paint, WHITE, [{ x: 0, y: 1.56, zLE: -half + 1.45, c: 1.40 }, { x: 0, y: 2.10, zLE: -half + 0.95, c: 0.95 },
    { x: 0, y: 2.62, zLE: -half + 0.58, c: 0.62 }], { thick: 0.10, n: 6, vertical: true });
  trim.box(0, 2.62, -half + 0.10, 0.04, 0.05, 0.08, 0, WHITE);        // tail light

  if (spec.floats) {
    // Pontoons: long hulls with upswept bows and a step, on V-struts.
    for (const sd of [-1, 1]) {
      paint.loft([
        ring(-half + 1.05, 0.10, 0.08, 0.40), ring(-half + 1.50, 0.26, 0.20, 0.34), ring(-half + 3.40, 0.33, 0.28, 0.30),
        ring(half - 2.40, 0.34, 0.30, 0.30), ring(half - 1.40, 0.30, 0.25, 0.36), ring(half - 0.90, 0.16, 0.12, 0.48),
      ].map((r) => ({ z: r.z, pts: r.pts.map(([x, y]) => [x + sd * 1.05, y]) })), WHITE, { capStart: true, capEnd: true });
      for (const [z0, z1] of [[half - 1.70, half - 2.00], [half - 3.10, half - 2.80]]) {
        matte.tube([sd * 1.05, 0.55, z0], [sd * 0.45, 0.80, z1], 0.035, 6, [0.72, 0.73, 0.75], true);
        matte.tube([sd * 1.05, 0.55, z0], [sd * 0.62, 1.05, z0], 0.030, 6, [0.72, 0.73, 0.75], true);
      }
    }
    for (const z of [half - 1.75, half - 3.05]) matte.tube([-1.05, 0.58, z], [1.05, 0.58, z], 0.030, 6, [0.72, 0.73, 0.75], true);
  } else {
    // Spring-steel main legs, a nose leg, and the wheels in spats.
    const wheel = (x, z, r, legFrom) => {
      matte.tube(legFrom, [x, r + 0.05, z], 0.035, 6, [0.72, 0.73, 0.75], true);
      matte.tube([x - 0.07, r, z], [x + 0.07, r, z], r, 12, TYRE, true);
      // `ring` is centred on the fuselage axis, so the spat has to be moved
      // out to its wheel -- without it all three hang under the belly.
      paint.loft([
        ring(z + r * 1.45, 0.02, 0.05, r + 0.05), ring(z + r * 0.6, 0.11, r * 0.75, r + 0.04),
        ring(z - r * 0.7, 0.11, r * 0.72, r + 0.06), ring(z - r * 1.55, 0.02, 0.06, r + 0.12),
      ].reverse().map((rg) => ({ z: rg.z, pts: rg.pts.map(([px, py]) => [px + x, py]) })),
      WHITE, { capStart: true, capEnd: true });
    };
    for (const sd of [-1, 1]) wheel(sd * 1.15, half - 3.30, 0.28, [sd * 0.40, 0.78, half - 3.10]);
    wheel(0, half - 0.75, 0.24, [0, 0.82, half - 0.95]);
  }
  // Two-blade metal prop, 1.9 m, turning in front of the spinner.
  spinPart(matte, [0, 1.12, half + 0.30], 'z', propeller(2, 0.95, 0.15, [0.14, 0.14, 0.15], [0.92, 0.92, 0.9]));
  return [];
}

/**
 * A fuselage from a station table [z, halfWidth, heightOver, heightUnder,
 * centreY] (nose first), as rings through HULL_A, plus the queries a builder
 * needs to put things ON it: `sec(z)` the interpolated station and `skinX(z,
 * y)` the skin's half-width at a height, so windows and livery lie on the
 * surface rather than at a guessed radius.
 */
function hullTable(ST, sq = 2) {
  const rings = ST.map(([z, w, ht, hb, yc]) => hullRing(z, w, ht, hb, yc, HULL_A, sq));
  const sec = (z) => stationAt(ST, z);
  const skinX = (z, y) => {
    const [w, ht, hb, yc] = sec(z);
    const u = clamp(Math.abs(y - yc) / (y > yc ? ht : hb), 0, 0.999);
    return w * (1 - u ** sq) ** (1 / sq);
  };
  return { rings, sec, skinX, zs: ST.map((r) => r[0]) };
}

/** skinX over a raw station table without building its rings. */
function hullTableX(ST, z, y, sq = 3) {
  const [w, ht, hb, yc] = stationAt(ST, z);
  const u = clamp(Math.abs(y - yc) / (y > yc ? ht : hb), 0, 0.999);
  return w * (1 - u ** sq) ** (1 / sq);
}

// Port-side index of a HULL_A quad: 0-2 keel, 3-4 the flank either side of
// the waterline, 5-8 up the side, 9 the crown. Starboard quads mirror to it.
const hullSide = (k) => (k <= 9 ? k : 19 - k);

/**
 * A livery band along the flank over a z range, laid on the skin. `f0`..`f1`
 * are heights as FRACTIONS of the section's own half-height (negative is
 * under the centre line), so a cheat line follows the tail cone up and in
 * instead of running on level and leaving the hull where it narrows.
 */
function hullBand(b, hull, sd, z0, z1, f0, f1, col, n = 14) {
  const rows = [];
  const yAt = (z, f) => { const [, ht, hb, yc] = hull.sec(z); return yc + f * (f > 0 ? ht : hb); };
  // Sampled AT the hull's own stations as well: the skin is straight
  // between them and bends at them, so a band sampled only in between cuts
  // the corner and sinks under a convex nose -- it showed as dashes.
  const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
  const zs = new Set();
  for (let i = 0; i <= n; i++) zs.add(lerp(z0, z1, i / n));
  for (const z of hull.zs) if (z > lo && z < hi) zs.add(z);
  for (const z of [...zs].sort((a, c) => (z1 > z0 ? a - c : c - a))) {
    const ya = yAt(z, f0), yb = yAt(z, f1);
    rows.push([[sd * (hull.skinX(z, ya) + 0.005), ya, z], [sd * (hull.skinX(z, yb) + 0.005), yb, z]]);
  }
  b.patch(rows, col, [sd, 0, 0]);
}

/**
 * A cockpit you can see into through its screen: an inward-facing liner
 * over the hull between zBack and zFront, a floor, an instrument panel under
 * the screen with its glare shield, two seats, and a pilot in `crew`.
 * `pilotX` is the pilot's side (+x is port: the captain's seat).
 */
function flightDeck(matte, trim, hull, zBack, zFront, { floorY, panelZ, seatZ, halfW, headY, pilotX }) {
  const { rings, skinX } = hull;
  const sub = rings.filter((r) => r.z <= zFront + 1e-6 && r.z >= zBack - 1e-6);
  hullLoft(sub, () => [matte, CAB_FLOOR], { inset: 0.035, inward: true, caps: false });
  // Everything sized off the skin, not a width: the hull narrows fast below
  // the centre line and a fixed-width floor stood out of both flanks.
  const inX = (z, y) => Math.max(0.05, skinX(z, y) - 0.04);
  matte.patch([zBack + 0.02, (zBack + panelZ) / 2, panelZ].map((z) => [-1, 0, 1].map((u) => [u * inX(z, floorY), floorY, z])), CAB_FLOOR, [0, 1, 0]);
  // panel, with two dark screens, and the shield over it
  const pw = Math.min(inX(panelZ + 0.15, floorY + 0.06), inX(panelZ - 0.15, floorY + 0.06), halfW);
  matte.box(0, floorY + 0.06, panelZ, pw * 2, headY - 0.42 - floorY, 0.30, 0, CAB_DASH);
  const sw = Math.min(inX(panelZ + 0.25, headY - 0.38), halfW);
  matte.box(0, headY - 0.38, panelZ + 0.05, sw * 2, 0.035, 0.45, 0, [0.03, 0.03, 0.035]);
  for (const sx of [-1, 1]) trim.box(sx * pw * 0.48, headY - 0.64, panelZ - 0.152, pw * 0.62, 0.20, 0.004, 0, [0.03, 0.05, 0.09]);
  // bulkhead behind the seats, cut to the skin
  const bz = zBack + 0.02, ys = [0, 0.25, 0.5, 0.75, 1].map((t) => lerp(floorY, headY + 0.35, t));
  matte.patch(ys.map((y) => [-1, 0, 1].map((u) => [u * inX(bz, y), y, bz])), [0.16, 0.16, 0.17], [0, 0, 1]);
  const H = (headY - floorY) / 0.53 * 0.5;
  for (const sx of [-1, 1]) seat(matte, sx * Math.abs(pilotX), floorY + 0.40, seatZ, 0.46, H, false, 0.40);
  if (matte.crew) occupant(matte.crew, pilotX, headY - 0.53 * 0.9, seatZ, 0.9, [pilotX, floorY + 0.40, seatZ + 0.55]);
}

/**
 * Twin turboprop, King Air 350 proportions: 14.2 m, 17.6 m span with
 * winglets, a T-tail 4.4 m up, the wing low and the two PT6 nacelles on it
 * with four-blade props. Cabin windows are backed panes on the skin; the
 * windscreen and cockpit side windows are cut into the skin, and behind them
 * is a flight deck with a pilot in it.
 */
function buildTwin(spec, paint, trim, matte) {
  const ST = [
    [7.10, 0.05, 0.05, 0.05, 1.60], [6.95, 0.26, 0.24, 0.24, 1.62], [6.60, 0.46, 0.42, 0.42, 1.65],
    [6.00, 0.62, 0.56, 0.58, 1.69], [5.20, 0.74, 0.62, 0.74, 1.72], [4.55, 0.79, 0.66, 0.82, 1.74],
    [4.15, 0.80, 0.79, 0.85, 1.75], [3.75, 0.81, 0.90, 0.87, 1.75], [3.05, 0.81, 0.90, 0.88, 1.75],
    [2.95, 0.81, 0.90, 0.88, 1.75], [0.5, 0.81, 0.90, 0.88, 1.755], [-1.8, 0.80, 0.90, 0.88, 1.76],
    [-3.2, 0.70, 0.80, 0.64, 1.88], [-4.8, 0.48, 0.58, 0.38, 2.08], [-6.2, 0.28, 0.38, 0.20, 2.30],
    [-7.0, 0.13, 0.18, 0.09, 2.44], [-7.12, 0.05, 0.08, 0.04, 2.47],
  ];
  const hull = hullTable(ST), { rings, skinX } = hull;
  hullLoft(rings, (i, k, zm) => {
    if (k < 0) return [paint, WHITE];
    const s = hullSide(k);
    if (zm < 4.55 && zm > 3.75 && s >= 5) return [trim, GLASS];            // windscreen
    if (zm < 3.75 && zm > 3.05 && s >= 5 && s <= 7) return [trim, GLASS];   // cockpit side windows
    return [paint, WHITE];
  });
  flightDeck(matte, trim, hull, 2.95, 4.55, { floorY: 1.08, panelZ: 4.30, seatZ: 3.30, halfW: 0.70, headY: 2.20, pilotX: 0.36 });
  for (const sd of [-1, 1]) {
    // seven cabin windows a side, and the airstair door's outline to port
    for (let i = 0; i < 7; i++) skinWindow(trim, matte, skinX, sd, 2.30 - i * 0.72, 1.94, 0.40, 0.34);
    hullBand(matte, hull, sd, 6.4, -6.9, -0.15, -0.035, [0.07, 0.12, 0.30]);
    hullBand(matte, hull, sd, 6.1, -6.7, -0.23, -0.19, [0.78, 0.58, 0.16]);
  }
  // the airstair door's outline, to port behind the wing
  for (const [z0, z1, f0, f1] of [[-2.75, -2.73, -0.80, 0.74], [-3.52, -3.50, -0.80, 0.74], [-3.52, -2.73, 0.73, 0.75], [-3.52, -2.73, -0.81, -0.79]]) {
    hullBand(matte, hull, 1, z0, z1, f0, f1, [0.35, 0.36, 0.38], 2);
  }
  // --- wing, low, 6 deg dihedral, winglets ----------------------------------------
  for (const sd of [-1, 1]) {
    const st = [{ x: 0, y: 1.12, zLE: 1.35, c: 2.45 }, { x: sd * 2.75, y: 1.40, zLE: 1.20, c: 2.15 },
      { x: sd * 8.6, y: 2.02, zLE: 0.62, c: 0.95 }];
    aerofoil(paint, WHITE, st, { thick: 0.15, n: 8 });
    aerofoil(paint, WHITE, [{ x: sd * 8.60, y: 2.02, zLE: 0.62, c: 0.95 }, { x: sd * 8.72, y: 2.62, zLE: 0.22, c: 0.42 }], { thick: 0.10, n: 6, vertical: true });
    // flap and aileron hinge lines, and the nav light
    const hl = (a, b2, f) => matte.patch([
      [[a.x, a.y + 0.03, a.zLE - a.c * f], [b2.x, b2.y + 0.022, b2.zLE - b2.c * f]],
      [[a.x, a.y + 0.03, a.zLE - a.c * (f + 0.02)], [b2.x, b2.y + 0.022, b2.zLE - b2.c * (f + 0.02)]],
    ], [0.30, 0.31, 0.33], [0, 1, 0]);
    const mid = (u) => ({ x: lerp(st[1].x, st[2].x, u), y: lerp(st[1].y, st[2].y, u), zLE: lerp(st[1].zLE, st[2].zLE, u), c: lerp(st[1].c, st[2].c, u) });
    hl({ x: sd * 0.85, y: 1.18, zLE: 1.30, c: 2.35 }, mid(0.55), 0.74);
    hl(mid(0.58), mid(0.96), 0.72);
    trim.box(sd * 8.62, 2.00, 0.30, 0.05, 0.06, 0.14, 0, sd > 0 ? NAV_R : NAV_G);
    // --- nacelle ---------------------------------------------------------------------
    const nx = sd * 2.75;
    const NS = [[3.35, 0.20, 0.20, 0.20, 1.50], [3.12, 0.34, 0.34, 0.36, 1.48], [2.40, 0.40, 0.42, 0.47, 1.46],
      [1.20, 0.40, 0.42, 0.49, 1.44], [0.00, 0.36, 0.34, 0.43, 1.44], [-1.40, 0.24, 0.20, 0.30, 1.46], [-2.10, 0.07, 0.05, 0.09, 1.48]];
    const nr = NS.map(([z, w, ht, hb, yc]) => { const r = hullRing(z, w, ht, hb, yc); return { z, pts: r.pts.map(([x, y]) => [x + nx, y]) }; });
    hullLoft(nr, (i, k) => (k < 0 ? [matte, [0.05, 0.05, 0.055]] : [paint, WHITE]));
    // intake under the spinner, two exhaust stacks sweeping back, and the spinner
    trim.tube([nx, 1.19, 3.14], [nx, 1.19, 3.02], 0.12, 10, CAVITY, true);
    for (const ex of [-1, 1]) {
      matte.tube([nx + ex * 0.36, 1.50, 2.30], [nx + ex * 0.50, 1.53, 1.85], 0.085, 8, [0.22, 0.21, 0.20], false);
      trim.tube([nx + ex * 0.50, 1.53, 1.85], [nx + ex * 0.51, 1.53, 1.83], 0.07, 8, CAVITY, true);
    }
    paint.loft([
      { z: 3.33, pts: hullRing(0, 0.21, 0.21, 0.21, 1.50, HULL_A).pts.map(([x, y]) => [x + nx, y]) },
      { z: 3.58, pts: hullRing(0, 0.15, 0.15, 0.15, 1.50, HULL_A).pts.map(([x, y]) => [x + nx, y]) },
      { z: 3.74, pts: hullRing(0, 0.04, 0.04, 0.04, 1.50, HULL_A).pts.map(([x, y]) => [x + nx, y]) },
    ], WHITE, { capEnd: true });
    spinPart(matte, [nx, 1.50, 3.45], 'z', propeller(4, 1.33, 0.19, [0.07, 0.07, 0.08], [0.95, 0.80, 0.12], { phase: sd > 0 ? 0 : 0.4 }));
    // main gear: a leg out of the nacelle onto a pair of wheels
    matte.tube([nx, 1.02, -0.05], [nx, 0.36, -0.25], 0.055, 8, ALU, false);
    matte.tube([nx - 0.14, 0.34, -0.25], [nx + 0.14, 0.34, -0.25], 0.04, 6, ALU, false);
    for (const wx of [-0.13, 0.13]) airWheel(trim, matte, nx + wx, 0.34, -0.25, 0.34, 0.15);
  }
  // nose gear
  matte.tube([0, 1.05, 5.30], [0, 0.26, 5.45], 0.045, 8, ALU, false);
  airWheel(trim, matte, 0, 0.23, 5.45, 0.23, 0.13);
  // --- T-tail ------------------------------------------------------------------------
  aerofoil(paint, WHITE, [{ x: 0, y: 2.34, zLE: -3.85, c: 2.65 }, { x: 0, y: 3.40, zLE: -5.55, c: 1.75 },
    { x: 0, y: 4.30, zLE: -6.55, c: 1.25 }], { thick: 0.12, n: 7, vertical: true });
  for (const sd of [-1, 1]) {
    aerofoil(paint, WHITE, [{ x: 0, y: 4.28, zLE: -6.30, c: 1.32 }, { x: sd * 2.85, y: 4.30, zLE: -7.02, c: 0.72 }], { thick: 0.10, n: 6 });
    // ventral strakes under the tail cone
    matte.tube([sd * 0.22, 1.86, -5.6], [sd * 0.30, 1.72, -6.3], 0.02, 4, [0.62, 0.63, 0.65], true);
  }
  trim.box(0, 4.30, -7.85, 0.05, 0.05, 0.06, 0, WHITE);
  trim.box(0, 2.66, -0.80, 0.07, 0.06, 0.16, 0, TAILC);               // beacon
  for (const [z, h] of [[1.55, 0.24], [-2.45, 0.20]]) {                // blade antennas
    aerofoil(paint, WHITE, [{ x: 0, y: 2.62, zLE: z, c: 0.30 }, { x: 0, y: 2.62 + h, zLE: z - 0.14, c: 0.15 }], { thick: 0.12, n: 4, vertical: true });
  }
  trim.box(0, 0.86, 3.20, 0.10, 0.03, 0.14, 0, LAMP);                  // taxi light
  return [];
}

/**
 * Light business jet, Learjet 45 proportions: 15 m, a 21-degree swept low wing
 * with winglets, two fans on pylons at the tail, a T-tail, sat low on short
 * gear. No propeller: the only fixed-wing type with no spin part.
 */
function buildJet(spec, paint, trim, matte) {
  const ST = [
    [7.50, 0.04, 0.04, 0.04, 1.40], [7.30, 0.22, 0.20, 0.20, 1.42], [6.85, 0.42, 0.38, 0.38, 1.45],
    [6.10, 0.62, 0.52, 0.58, 1.50], [5.30, 0.75, 0.60, 0.74, 1.53], [4.80, 0.80, 0.72, 0.80, 1.54],
    [4.25, 0.83, 0.86, 0.84, 1.55], [3.60, 0.84, 0.88, 0.86, 1.55], [3.50, 0.84, 0.88, 0.86, 1.55],
    [0.8, 0.84, 0.88, 0.86, 1.555], [-1.8, 0.84, 0.88, 0.86, 1.56], [-3.4, 0.76, 0.80, 0.70, 1.65],
    [-5.0, 0.56, 0.62, 0.44, 1.84], [-6.4, 0.34, 0.40, 0.22, 2.04], [-7.3, 0.14, 0.18, 0.08, 2.20],
    [-7.52, 0.05, 0.07, 0.04, 2.24],
  ];
  const hull = hullTable(ST), { rings, skinX } = hull;
  hullLoft(rings, (i, k, zm) => {
    if (k < 0) return [paint, WHITE];
    const s = hullSide(k);
    if (zm < 5.30 && zm > 4.25 && s >= 5) return [trim, GLASS];
    if (zm < 4.25 && zm > 3.60 && s >= 5 && s <= 7) return [trim, GLASS];
    return [paint, WHITE];
  });
  flightDeck(matte, trim, hull, 3.50, 5.30, { floorY: 0.90, panelZ: 5.00, seatZ: 3.95, halfW: 0.72, headY: 2.02, pilotX: 0.37 });
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 6; i++) skinWindow(trim, matte, skinX, sd, 2.55 - i * 0.84, 1.76, 0.44, 0.36);
    hullBand(matte, hull, sd, 6.9, -7.3, -0.22, -0.105, [0.13, 0.14, 0.17]);
    hullBand(matte, hull, sd, 6.6, -7.1, -0.29, -0.255, [0.66, 0.08, 0.08]);
  }
  // --- wing ---------------------------------------------------------------------
  for (const sd of [-1, 1]) {
    const st = [{ x: 0, y: 0.92, zLE: 1.30, c: 3.0 }, { x: sd * 1.4, y: 0.99, zLE: 0.95, c: 2.5 },
      { x: sd * 7.5, y: 1.38, zLE: -1.45, c: 1.05 }];
    aerofoil(paint, WHITE, st, { thick: 0.12, n: 8 });
    aerofoil(paint, WHITE, [{ x: sd * 7.50, y: 1.38, zLE: -1.45, c: 1.05 }, { x: sd * 7.78, y: 2.28, zLE: -2.30, c: 0.45 }], { thick: 0.09, n: 6, vertical: true });
    const P = (u, f, dy) => ({ x: lerp(st[1].x, st[2].x, u), y: lerp(st[1].y, st[2].y, u) + dy, z: lerp(st[1].zLE, st[2].zLE, u) - lerp(st[1].c, st[2].c, u) * f });
    for (const [u0, u1] of [[0.02, 0.55], [0.58, 0.95]]) {
      const a0 = P(u0, 0.76, 0.03), a1 = P(u1, 0.76, 0.02), b0 = P(u0, 0.78, 0.03), b1 = P(u1, 0.78, 0.02);
      matte.patch([[[a0.x, a0.y, a0.z], [a1.x, a1.y, a1.z]], [[b0.x, b0.y, b0.z], [b1.x, b1.y, b1.z]]], [0.32, 0.33, 0.35], [0, 1, 0]);
    }
    trim.box(sd * 7.52, 1.36, -1.62, 0.05, 0.06, 0.14, 0, sd > 0 ? NAV_R : NAV_G);
    // --- engine on its pylon -----------------------------------------------------
    const ex = sd * 1.42, ey = 2.02;
    const ES = [[-2.00, 0.37, 0.37, 0.37, ey], [-2.25, 0.43, 0.43, 0.43, ey], [-3.20, 0.45, 0.45, 0.45, ey],
      [-4.30, 0.39, 0.39, 0.39, ey], [-4.85, 0.30, 0.30, 0.30, ey]];
    const er = ES.map(([z, w, ht, hb, yc]) => { const r = hullRing(z, w, ht, hb, yc); return { z, pts: r.pts.map(([x, y]) => [x + ex, y]) }; });
    hullLoft(er, (i, k) => (i === -1 ? [matte, CAVITY] : k < 0 ? [matte, [0.16, 0.15, 0.14]] : [paint, WHITE]));
    trim.tube([ex, ey, -1.97], [ex, ey, -2.06], 0.375, 14, CHROME, false);
    trim.tube([ex, ey, -2.08], [ex, ey, -2.20], 0.10, 8, CHROME, true);         // fan spinner
    matte.tube([ex, ey, -4.84], [ex, ey, -5.05], 0.16, 10, [0.14, 0.13, 0.12], true);   // exhaust cone
    aerofoil(paint, WHITE, [{ x: sd * 0.60, y: 1.96, zLE: -2.75, c: 1.55 }, { x: sd * 1.06, y: 2.0, zLE: -2.85, c: 1.35 }], { thick: 0.16, n: 6 });
  }
  // gear: mains out of the wing roots, twin nosewheels
  for (const sd of [-1, 1]) {
    matte.tube([sd * 1.60, 0.96, -0.10], [sd * 1.62, 0.32, -0.32], 0.05, 8, ALU, false);
    airWheel(trim, matte, sd * 1.68, 0.30, -0.32, 0.30, 0.18);
  }
  matte.tube([0, 0.86, 5.60], [0, 0.24, 5.74], 0.04, 8, ALU, false);
  for (const wx of [-0.085, 0.085]) airWheel(trim, matte, wx, 0.21, 5.74, 0.21, 0.10);
  // --- T-tail -------------------------------------------------------------------
  aerofoil(paint, WHITE, [{ x: 0, y: 2.20, zLE: -4.35, c: 2.85 }, { x: 0, y: 3.60, zLE: -6.30, c: 1.75 },
    { x: 0, y: 4.45, zLE: -7.20, c: 1.25 }], { thick: 0.11, n: 7, vertical: true });
  for (const sd of [-1, 1]) {
    aerofoil(paint, WHITE, [{ x: 0, y: 4.42, zLE: -6.95, c: 1.35 }, { x: sd * 2.90, y: 4.52, zLE: -7.95, c: 0.70 }], { thick: 0.10, n: 6 });
  }
  trim.box(0, 4.45, -8.46, 0.05, 0.05, 0.06, 0, WHITE);
  trim.box(0, 2.44, -1.2, 0.07, 0.06, 0.16, 0, TAILC);
  trim.box(0, 0.66, 1.5, 0.07, 0.05, 0.16, 0, TAILC);
  aerofoil(paint, WHITE, [{ x: 0, y: 2.40, zLE: 1.75, c: 0.30 }, { x: 0, y: 2.62, zLE: 1.62, c: 0.16 }], { thick: 0.12, n: 4, vertical: true });
  trim.box(0, 0.70, 5.90, 0.12, 0.04, 0.14, 0, LAMP);
  return [];
}

/**
 * A single-seat twin-engined fighter, F/A-18-ish: a pointed nose, a bubble
 * canopy, side intakes under swept wings, twin canted fins and twin nozzles,
 * sitting tall on its gear. Navy grey (the livery comes from the spawn).
 */
function buildFighter(spec, paint, trim, matte) {
  const ST = [
    [8.00, 0.03, 0.03, 0.03, 1.70], [7.50, 0.18, 0.16, 0.14, 1.72], [6.60, 0.40, 0.36, 0.30, 1.78],
    [5.40, 0.58, 0.55, 0.42, 1.86], [4.60, 0.66, 0.92, 0.46, 1.90], [3.40, 0.80, 1.00, 0.52, 1.92],
    [2.40, 1.10, 0.72, 0.58, 1.92], [0.60, 1.30, 0.60, 0.60, 1.92], [-2.40, 1.28, 0.56, 0.56, 1.92],
    [-5.20, 1.05, 0.50, 0.50, 1.92], [-6.90, 0.86, 0.44, 0.44, 1.92], [-7.50, 0.80, 0.42, 0.42, 1.92],
  ];
  const hull = hullTable(ST), { rings } = hull;
  hullLoft(rings, (i, k, zm) => {
    if (k < 0) return i === -1 ? [matte, CAVITY] : [paint, WHITE];
    if (zm < 5.3 && zm > 2.9 && hullSide(k) >= 6) return [trim, GLASS];
    return [paint, WHITE];
  });
  flightDeck(matte, trim, hull, 3.0, 5.2, { floorY: 1.55, panelZ: 5.0, seatZ: 3.55, halfW: 0.5, headY: 2.62, pilotX: 0 });
  const DARK = [0.20, 0.21, 0.23];
  for (const sd of [-1, 1]) {
    // wing, swept, thin
    aerofoil(paint, WHITE, [{ x: sd * 0.9, y: 1.86, zLE: 2.1, c: 5.8 }, { x: sd * 1.6, y: 1.86, zLE: 1.4, c: 4.9 },
      { x: sd * 5.7, y: 1.80, zLE: -2.5, c: 1.5 }], { thick: 0.06, n: 8 });
    trim.box(sd * 5.72, 1.80, -2.9, 0.05, 0.06, 0.14, 0, sd > 0 ? NAV_R : NAV_G);
    // tailplane
    aerofoil(paint, WHITE, [{ x: sd * 1.0, y: 1.95, zLE: -4.9, c: 2.6 }, { x: sd * 3.3, y: 1.90, zLE: -6.6, c: 1.1 }], { thick: 0.05, n: 6 });
    // fins, canted out
    aerofoil(paint, WHITE, [{ x: sd * 0.95, y: 2.40, zLE: -3.8, c: 2.9 }, { x: sd * 1.60, y: 4.55, zLE: -6.1, c: 1.2 }], { thick: 0.06, n: 6, vertical: true });
    // intake trunk down each side, a dark mouth at its front
    matte.box(sd * 1.22, 1.32, 0.9, 0.52, 0.72, 2.8, 0, [0.42, 0.44, 0.47]);
    matte.quad([sd * 0.98, 1.36, 2.31], [sd * 1.46, 1.36, 2.31], [sd * 1.46, 1.98, 2.31], [sd * 0.98, 1.98, 2.31], [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], CAVITY);
    // twin nozzles
    matte.tube([sd * 0.44, 1.92, -7.2], [sd * 0.44, 1.92, -8.05], 0.40, 12, DARK, false);
    matte.tube([sd * 0.44, 1.92, -7.95], [sd * 0.44, 1.92, -8.02], 0.31, 10, CAVITY, true);
    // main gear
    matte.tube([sd * 1.15, 1.40, -0.9], [sd * 1.40, 0.36, -1.05], 0.06, 8, ALU, false);
    airWheel(trim, matte, sd * 1.44, 0.36, -1.05, 0.36, 0.2);
  }
  // nose gear
  matte.tube([0, 1.45, 5.55], [0, 0.30, 5.70], 0.05, 8, ALU, false);
  airWheel(trim, matte, 0, 0.30, 5.70, 0.30, 0.14);
  // a dark anti-glare panel ahead of the canopy, and the refuelling probe fairing
  matte.patch([[[-0.34, 2.33, 5.35], [0, 2.41, 5.35], [0.34, 2.33, 5.35]], [[-0.2, 2.06, 6.5], [0, 2.12, 6.5], [0.2, 2.06, 6.5]]], [0.16, 0.17, 0.19], [0, 1, 0.3]);
  return [];
}

/**
 * Boeing-Stearman Model 75 -- blue fabric fuselage, yellow wings, the
 * striped rudder, an exposed seven-cylinder radial and two open cockpits.
 * Built LEVEL, main wheels at z = spec.taildragger.zMain; the flight model
 * rocks it back onto the tailwheel (updatePlane's `rest` and `yVis`), so the
 * tailwheel hangs here exactly (zMain - zTail) tan(11 deg) above the ground.
 * The pilot flies from the rear cockpit, as a Stearman is flown solo.
 */
function buildBiplane(spec, paint, trim, matte) {
  const WING = [0.86, 0.62, 0.08];
  const SQ = 3;
  const ST = [
    [3.10, 0.52, 0.53, 0.53, 1.60], [2.70, 0.47, 0.51, 0.50, 1.56], [2.00, 0.44, 0.47, 0.52, 1.52],
    [1.10, 0.43, 0.45, 0.52, 1.50], [0.35, 0.43, 0.44, 0.52, 1.49], [-0.15, 0.42, 0.43, 0.50, 1.48],
    [-0.85, 0.40, 0.42, 0.47, 1.47], [-2.00, 0.27, 0.34, 0.32, 1.46], [-3.20, 0.12, 0.22, 0.14, 1.47],
    [-3.75, 0.04, 0.12, 0.05, 1.49],
  ];
  const { rings, skinX } = hullTable(ST, SQ);
  const pit = (zm) => (zm < 1.10 && zm > 0.35) || (zm < -0.15 && zm > -0.85);
  hullLoft(rings, (i, k, zm) => {
    if (k < 0) return i === -1 ? [matte, [0.20, 0.20, 0.21]] : [paint, WHITE];
    return pit(zm) && hullSide(k) >= 7 ? null : [paint, WHITE];
  });
  // Cockpit tubs: a leather-dark liner, a floor and the bulkheads.
  const TUB = [0.13, 0.10, 0.075];
  for (const [zF, zB] of [[1.10, 0.35], [-0.15, -0.85]]) {
    const sub = rings.filter((r) => r.z <= zF + 1e-6 && r.z >= zB - 1e-6);
    hullLoft(sub, () => [matte, TUB], { inset: 0.02, inward: true, caps: false });
    matte.box(0, 1.10, (zF + zB) / 2, 0.76, 0.02, zF - zB, 0, TUB);
    for (const [z, nz] of [[zF - 0.01, -1], [zB + 0.01, 1]]) {
      matte.quad([-0.40, 1.02, z], [0.40, 1.02, z], [0.40, 1.93, z], [-0.40, 1.93, z], [0, 0, nz], [0, 0, 1, 0, 1, 1, 0, 1], [0.10, 0.08, 0.06]);
    }
    // Leather coaming round the opening: the rim runs along ring points 7 and
    // 13 (the quads 7..12 are the hole) and across at both ends.
    const r0 = rings.find((r) => Math.abs(r.z - zF) < 1e-6), r1 = rings.find((r) => Math.abs(r.z - zB) < 1e-6);
    const rim = (r, j) => [r.pts[j][0], r.pts[j][1] + 0.015, r.z];
    const LEATHER = [0.22, 0.12, 0.06];
    for (const j of [7, 13]) matte.tube(rim(r0, j), rim(r1, j), 0.028, 5, LEATHER, false);
    for (const r of [r0, r1]) for (let j = 7; j < 13; j++) matte.tube(rim(r, j), rim(r, j + 1), 0.028, 5, LEATHER, false);
    // instrument panel under the front coaming, a seat back, and a windscreen
    matte.box(0, 1.55, zF - 0.06, 0.62, 0.28, 0.05, 0, [0.07, 0.07, 0.075]);
    seat(matte, 0, 1.45, zB + 0.20, 0.48, 0.95, false, 0.35);
    const scr = [];
    for (let i = 0; i <= 2; i++) {
      const row = [];
      for (let j = 0; j <= 4; j++) {
        const u = -1 + j / 2, t = i / 2;
        row.push([u * 0.26, 1.93 + t * 0.20, zF + 0.10 - t * 0.09 - 0.05 * u * u]);
      }
      scr.push(row);
    }
    trim.patch(scr, GLASS, [0, 0.4, 1]);
  }
  // The pilot, in the rear seat, head well out over the coaming.
  if (matte.crew) occupant(matte.crew, 0, 1.52, -0.66, 0.95, [0, 1.40, -0.20]);
  // --- the radial: crankcase, seven finned cylinders, nose case ---------------------
  matte.tube([0, 1.60, 3.10], [0, 1.60, 3.52], 0.24, 12, [0.16, 0.16, 0.17], true);
  for (let c = 0; c < 7; c++) {
    const a = Math.PI / 2 + (c / 7) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const at = (r, dz = 0) => [ca * r, 1.60 + sa * r, 3.33 + dz];
    matte.tube(at(0.18), at(0.40), 0.085, 8, [0.34, 0.34, 0.36], true);
    matte.tube(at(0.40), at(0.55), 0.105, 8, [0.46, 0.46, 0.48], true);
    for (let fn = 0; fn < 3; fn++) matte.tube(at(0.24 + fn * 0.06), at(0.25 + fn * 0.06), 0.10, 8, [0.24, 0.24, 0.26], false);
    matte.tube(at(0.48, 0.08), at(0.22, -0.20), 0.016, 4, [0.55, 0.50, 0.40], false);        // pushrod
  }
  matte.tube([0, 1.60, 3.50], [0, 1.60, 3.74], 0.14, 10, [0.30, 0.30, 0.32], true);
  // exhaust collector out along the lower flank
  for (const sd of [-1, 1]) matte.tube([sd * 0.35, 1.18, 3.05], [sd * 0.46, 1.10, 1.70], 0.045, 6, [0.25, 0.22, 0.19], true);
  spinPart(matte, [0, 1.60, 3.80], 'z', propeller(2, 1.30, 0.21, [0.40, 0.40, 0.42], [0.92, 0.72, 0.08], { twist: 0.6 }));
  // --- wings: upper staggered ahead of the lower, both yellow fabric ----------------
  for (const sd of [-1, 1]) {
    aerofoil(matte, WING, [{ x: 0, y: 2.62, zLE: 1.62, c: 1.45 }, { x: sd * 4.50, y: 2.62, zLE: 1.62, c: 1.45 },
      { x: sd * 4.90, y: 2.62, zLE: 1.52, c: 1.10 }], { thick: 0.12, n: 8 });
    aerofoil(matte, WING, [{ x: sd * 0.30, y: 1.02, zLE: 1.10, c: 1.40 }, { x: sd * 4.25, y: 1.25, zLE: 1.10, c: 1.40 },
      { x: sd * 4.62, y: 1.27, zLE: 0.98, c: 1.02 }], { thick: 0.12, n: 8 });
    // aileron hinge lines on the upper wing, and the nav light
    matte.patch([[[sd * 2.3, 2.71, 0.54], [sd * 4.6, 2.71, 0.54]], [[sd * 2.3, 2.71, 0.51], [sd * 4.6, 2.71, 0.51]]], [0.55, 0.40, 0.06], [0, 1, 0]);
    trim.box(sd * 4.92, 2.60, 1.20, 0.04, 0.05, 0.12, 0, sd > 0 ? NAV_R : NAV_G);
    // Interplane N-struts, cabane struts, and the flying and landing wires.
    const lo = (x, z) => [sd * x, 1.02 + (1.25 - 1.02) * (x - 0.3) / 3.95, z];
    const hi = (x, z) => [sd * x, 2.60, z];
    matte.tube(lo(3.30, 0.76), hi(3.36, 1.26), 0.035, 6, ALU, false);
    matte.tube(lo(3.30, 0.14), hi(3.36, 0.62), 0.035, 6, ALU, false);
    matte.tube(lo(3.30, 0.76), hi(3.36, 0.62), 0.025, 6, ALU, false);
    for (const z of [1.26, 0.64]) matte.tube([sd * 0.30, 1.93, z - 0.02], [sd * 0.46, 2.60, z], 0.028, 6, ALU, false);
    matte.tube([sd * 0.30, 1.93, 1.24], [sd * 0.46, 2.60, 0.64], 0.02, 5, ALU, false);
    const WIRE = [0.56, 0.57, 0.60];
    for (const [zl, zh] of [[0.76, 1.26], [0.14, 0.62]]) {
      matte.tube(lo(0.55, zl), hi(3.30, zh), 0.008, 3, WIRE, false);
      matte.tube(hi(0.50, zh), lo(3.25, zl), 0.008, 3, WIRE, false);
    }
    // --- main gear -----------------------------------------------------------------
    const hub = [sd * 0.92, 0.40, 2.10];
    matte.tube([sd * 0.26, 1.00, 2.40], hub, 0.035, 6, [0.20, 0.21, 0.22], false);
    matte.tube([sd * 0.26, 1.00, 1.78], hub, 0.035, 6, [0.20, 0.21, 0.22], false);
    matte.tube([sd * 0.62, 1.06, 2.00], [sd * 0.90, 0.46, 2.08], 0.05, 8, ALU, false);    // oleo
    airWheel(trim, matte, sd * 0.98, 0.40, 2.10, 0.40, 0.17);
  }
  // tailwheel on its spring
  matte.tube([0, 1.30, -3.02], [0, 1.15, -3.20], 0.025, 5, [0.20, 0.21, 0.22], false);
  airWheel(trim, matte, 0, 1.14, -3.20, 0.11, 0.07);
  // --- tail: yellow stabiliser and fin, a red-and-white striped rudder ------------------
  for (const sd of [-1, 1]) {
    aerofoil(matte, WING, [{ x: 0, y: 1.52, zLE: -2.50, c: 1.05 }, { x: sd * 1.55, y: 1.52, zLE: -2.58, c: 0.86 },
      { x: sd * 1.74, y: 1.52, zLE: -2.72, c: 0.55 }], { thick: 0.10, n: 6 });
    matte.tube([sd * 0.10, 1.30, -2.85], [sd * 0.80, 1.51, -2.90], 0.012, 4, ALU, false);   // stab strut
  }
  const fin = (y) => ({ zLE: lerp(-2.62, -3.12, (y - 1.62) / 0.92), c: lerp(1.10, 0.62, (y - 1.62) / 0.92) });
  const hinge = (y) => { const f = fin(y); return { zLE: f.zLE - f.c * 0.52, c: f.c * 0.48 }; };
  aerofoil(matte, WING, [1.62, 2.10, 2.54].map((y) => ({ x: 0, y, zLE: fin(y).zLE, c: fin(y).c * 0.54 })), { thick: 0.13, n: 6, vertical: true });
  const bands = 7;
  for (let s = 0; s < bands; s++) {
    const y0 = lerp(1.48, 2.54, s / bands), y1 = lerp(1.48, 2.54, (s + 1) / bands);
    aerofoil(matte, s % 2 ? [0.92, 0.92, 0.90] : [0.72, 0.07, 0.07],
      [y0, y1].map((y) => ({ x: 0, y, ...hinge(y) })), { thick: 0.12, n: 5, vertical: true });
  }
  trim.box(0, 2.50, -3.72, 0.04, 0.05, 0.06, 0, WHITE);
  return [];
}

/**
 * Helicopter, Bell 407 proportions: a 1.4 m-wide cabin whose front half is
 * glass (windscreen wrapped over the roof and down into the chin, door
 * windows cut into the skin), a turbine cowl behind the mast, a 6.3 m tail
 * boom with its stabiliser and fin, a four-blade 10.7 m main rotor and a
 * two-blade tail rotor to port, on skids.
 *
 * The glass is the skin itself (hullLoft), so it is see-through onto a real
 * cabin: floor, console, seats, a pilot in the right-hand seat, a headliner
 * and a rear bulkhead -- and out through the far side.
 */
function buildHeli(spec, paint, trim, matte) {
  const SQ = 2.3;
  const ST = [
    [4.75, 0.10, 0.10, 0.10, 1.15], [4.62, 0.42, 0.46, 0.40, 1.15], [4.35, 0.60, 0.66, 0.56, 1.18],
    [3.85, 0.67, 0.76, 0.63, 1.20], [3.55, 0.69, 0.79, 0.68, 1.20], [3.45, 0.70, 0.80, 0.69, 1.20],
    [3.10, 0.70, 0.80, 0.70, 1.20], [2.40, 0.70, 0.80, 0.71, 1.20], [2.28, 0.70, 0.80, 0.71, 1.20],
    [1.60, 0.69, 0.80, 0.71, 1.20], [1.50, 0.69, 0.80, 0.71, 1.20], [0.90, 0.62, 0.74, 0.62, 1.28],
    [0.30, 0.46, 0.52, 0.40, 1.46], [-0.40, 0.26, 0.28, 0.24, 1.62], [-2.70, 0.17, 0.18, 0.16, 1.74],
    [-4.90, 0.11, 0.12, 0.11, 1.80], [-5.12, 0.05, 0.06, 0.05, 1.81],
  ];
  const hull = hullTable(ST, SQ), { rings, skinX } = hull;
  const BELLY = [0.15, 0.16, 0.17];
  hullLoft(rings, (i, k, zm) => {
    if (k < 0) return [paint, WHITE];
    const s = hullSide(k);
    let glass = false;
    if (zm > 4.35 && zm < 4.62) glass = s >= 3;              // nose: screen down to the chin
    else if (zm > 3.55 && zm < 4.35) glass = s >= 2;         // windscreen over the top, chin bubbles
    else if (zm > 2.40 && zm < 3.45) glass = s >= 3 && s <= 7;   // front door
    else if (zm > 1.60 && zm < 2.28) glass = s >= 4 && s <= 7;   // rear door
    if (glass) return [trim, GLASS];
    if (s <= 1 && zm > 0.3) return [matte, BELLY];
    return [paint, WHITE];
  });
  // --- cabin --------------------------------------------------------------------
  const FY = 0.68;
  const fw = (z) => skinX(z, FY) - 0.03;
  const floor = [];
  for (const z of [4.05, 3.6, 3.0, 2.3, 1.52]) floor.push([-1, -0.5, 0, 0.5, 1].map((u) => [u * fw(z), FY, z]));
  matte.patch(floor, CAB_FLOOR, [0, 1, 0]);
  matte.box(0, FY, 3.86, 1.00, 0.46, 0.34, 0, CAB_DASH);                          // console
  matte.box(0, FY + 0.46, 3.80, 1.10, 0.035, 0.52, 0, [0.03, 0.03, 0.035]);      // glare shield
  for (const sx of [-1, 1]) trim.box(sx * 0.24, FY + 0.20, 3.688, 0.30, 0.22, 0.004, 0, [0.03, 0.05, 0.09]);
  matte.quad([-0.62, 1.965, 1.52], [0.62, 1.965, 1.52], [0.62, 1.965, 3.45], [-0.62, 1.965, 3.45], [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], CAB_ROOF);
  matte.quad([-0.66, FY, 1.53], [0.66, FY, 1.53], [0.66, 1.97, 1.53], [-0.66, 1.97, 1.53], [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], [0.20, 0.20, 0.21]);
  for (const sx of [-1, 1]) {
    seat(matte, sx * 0.34, 1.05, 2.55, 0.46, 0.9, false, 0.40);
    matte.box(sx * 0.34, FY, 2.80, 0.46, 0.27, 0.46, 0, CAB_SEAT);
  }
  seat(matte, 0, 1.05, 1.62, 1.12, 0.9, true, 0.40);
  matte.box(0, FY, 1.86, 1.12, 0.27, 0.44, 0, CAB_SEAT);
  // The pilot flies from the right seat (-x), hands on the cyclic.
  matte.tube([-0.34, FY, 3.10], [-0.34, 1.02, 3.05], 0.016, 5, [0.05, 0.05, 0.05], false);
  if (matte.crew) occupant(matte.crew, -0.34, 1.18, 2.55, 0.95, [-0.34, 1.02, 3.05]);
  for (const sd of [-1, 1]) {
    trim.box(sd * (skinX(2.95, 1.12) + 0.01), 1.10, 2.72, 0.03, 0.03, 0.14, 0, CHROME);   // door handles
    // door seams, a dark hairline on the paint below each door window
    hullBand(matte, hull, sd, 3.44, 1.61, -0.44, -0.42, [0.30, 0.31, 0.33], 4);
  }
  // --- engine cowl, mast, exhaust ------------------------------------------------------
  // Transmission and turbine under one cowl, from over the front seats back:
  // on a 407 it stands half a metre proud of the cabin roof.
  const CW = [[3.05, 0.30, 0.03, 0.05, 1.99], [2.70, 0.48, 0.40, 0.05, 2.00], [1.90, 0.54, 0.60, 0.05, 2.00],
    [0.70, 0.52, 0.56, 0.06, 1.97], [-0.35, 0.36, 0.36, 0.06, 1.88], [-0.98, 0.12, 0.12, 0.05, 1.82]];
  hullLoft(CW.map(([z, w, ht, hb, yc]) => hullRing(z, w, ht, hb, yc, HULL_A, 3)), () => [paint, WHITE]);
  for (const sd of [-1, 1]) {
    // intake grilles either side, just behind the mast
    matte.patch([0, 1, 2].map((i) => [[sd * (hullTableX(CW, 1.35, 2.20 + i * 0.08) + 0.004), 2.20 + i * 0.08, 1.35],
      [sd * (hullTableX(CW, 0.90, 2.20 + i * 0.08) + 0.004), 2.20 + i * 0.08, 0.90]]), [0.06, 0.065, 0.07], [sd, 0, 0]);
    matte.tube([sd * 0.17, 2.20, -0.20], [sd * 0.24, 2.44, -0.64], 0.095, 8, [0.24, 0.22, 0.20], false);   // exhaust stacks
    trim.tube([sd * 0.24, 2.44, -0.64], [sd * 0.245, 2.45, -0.66], 0.08, 8, CAVITY, true);
  }
  matte.tube([0, 2.55, 1.50], [0, 3.10, 1.50], 0.075, 8, [0.22, 0.23, 0.24], false);          // mast
  matte.tube([0, 2.68, 1.50], [0, 2.76, 1.50], 0.20, 10, [0.30, 0.31, 0.33], true);           // swashplate
  trim.box(0, 2.53, 0.20, 0.07, 0.06, 0.14, 0, TAILC);                                         // beacon
  // --- tail --------------------------------------------------------------------------
  for (const sd of [-1, 1]) {
    aerofoil(paint, WHITE, [{ x: 0, y: 1.73, zLE: -2.80, c: 0.50 }, { x: sd * 1.05, y: 1.73, zLE: -2.86, c: 0.42 }], { thick: 0.12, n: 6 });
    aerofoil(paint, WHITE, [{ x: sd * 1.05, y: 1.54, zLE: -2.80, c: 0.46 }, { x: sd * 1.05, y: 1.96, zLE: -2.92, c: 0.34 }], { thick: 0.10, n: 5, vertical: true });
    trim.box(sd * 1.07, 1.72, -3.02, 0.04, 0.05, 0.10, 0, sd > 0 ? NAV_R : NAV_G);
  }
  aerofoil(paint, WHITE, [{ x: 0, y: 1.82, zLE: -4.40, c: 0.86 }, { x: 0, y: 2.30, zLE: -4.72, c: 0.66 },
    { x: 0, y: 2.72, zLE: -5.00, c: 0.48 }], { thick: 0.13, n: 6, vertical: true });
  aerofoil(paint, WHITE, [{ x: 0, y: 1.78, zLE: -4.52, c: 0.66 }, { x: 0, y: 1.22, zLE: -4.86, c: 0.40 }], { thick: 0.12, n: 5, vertical: true });
  matte.tube([0, 1.24, -4.70], [0, 1.15, -5.10], 0.018, 5, ALU, true);                       // tail skid
  matte.tube([0.02, 1.84, -4.80], [0.22, 1.84, -4.80], 0.07, 8, [0.26, 0.27, 0.29], true);  // tail gearbox
  trim.box(0, 2.72, -5.30, 0.04, 0.05, 0.05, 0, WHITE);
  // --- skids -------------------------------------------------------------------------
  for (const sd of [-1, 1]) {
    const x = sd * 1.08;
    matte.tube([x, 0.065, 3.45], [x, 0.065, -0.55], 0.048, 8, ALU, true);
    matte.tube([x, 0.065, 3.45], [x, 0.13, 3.77], 0.048, 8, ALU, false);
    matte.tube([x, 0.13, 3.77], [x, 0.30, 3.93], 0.048, 8, ALU, true);
    for (const z of [3.00, 0.75]) {
      matte.tube([x, 0.08, z], [sd * 1.00, 0.40, z], 0.042, 8, ALU, false);
      matte.tube([sd * 1.00, 0.40, z], [sd * 0.55, 0.56, z], 0.042, 8, ALU, false);
    }
    trim.box(x, 0.02, 2.4, 0.035, 0.03, 0.30, 0, [0.9, 0.9, 0.9]);   // skid shoe
  }
  trim.box(0, 0.52, 4.05, 0.14, 0.04, 0.14, 0, LAMP);                // landing light
  // --- rotors (spin parts) -------------------------------------------------------------
  const main = new Builder(false);
  blades(main, 4, 0.20, 5.35, 0.29, DARK, [0.95, 0.95, 0.92], { twist: 0.14, thick: 0.12, droop: 0.12, phase: Math.PI / 4 });
  main.prism(0, -0.07, 0, 0.26, 0.14, 8, [0.26, 0.27, 0.29]);
  main.cone(0, 0.07, 0, 0.26, 0.12, 8, [0.26, 0.27, 0.29]);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k / 4) * Math.PI * 2;
    main.tube([Math.cos(a) * 0.1, 0, -Math.sin(a) * 0.1], [Math.cos(a) * 0.36, 0, -Math.sin(a) * 0.36], 0.06, 6, [0.20, 0.21, 0.22], true);
  }
  spinPart(matte, [0, 3.12, 1.50], 'y', main);
  const tail = new Builder(false);
  blades(tail, 2, 0.07, 0.83, 0.13, DARK, [0.90, 0.20, 0.16], { twist: 0.25, thick: 0.10 });
  tail.prism(0, -0.05, 0, 0.07, 0.10, 8, [0.26, 0.27, 0.29]);
  swapFrom(tail, 0, 0, 1);   // disc into the YZ plane, turning about X
  spinPart(matte, [0.30, 1.84, -4.80], 'x', tail);
  return [];
}

/**
 * The four-panel greenhouse every hand-built car uses -- windscreen, roof, rear
 * screen and side glass as separate patches, with the A- and C-pillars built
 * from those panels' OWN edge points -- driven by one table of stations instead
 * of another ninety-line copy of the sedan's. The construction is the sedan's
 * exactly; see there for why the roof is a panel and not a skin over a tube.
 *
 * `g` names what a body engineer would: cowl and roof heights, where the
 * screen tops out and the roof ends, where the rear screen lands, the widths of
 * each panel, and the four corners of the side glass. `deck` is the deck edge
 * at `rearZ`, where the C-pillar comes down onto the body.
 */
function greenhouse(paint, trim, matte, g) {
  const {
    cowlZ, cowlY, scrZ, roofY, backZ, rearZ, rearY,
    wScrB, wScrT, wRoof, wRearT, wRear, wGlassT, wGlassB,
    sgFB, sgFT, sgRT, sgRB, deck,
    bPillars = [0.42], pillarInto = paint, pillarCol = WHITE, roofInto = paint, roofCol = WHITE,
    scrBow = 0.026, scrWrap = 0.085, rearBow = 0.012, rearWrap = 0.035, crown = 0.010,
  } = g;
  const lp = (a, b, t) => a + (b - a) * t;

  const scrRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(cowlZ, scrZ, t) + scrBow * Math.sin(Math.PI * t);
    const cy = lp(cowlY, roofY, t) + 0.010 * Math.sin(Math.PI * t);
    const hwv = lp(wScrB, wScrT, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.024 * u * u, cz - scrWrap * u * u]);
    }
    scrRows.push(row);
  }
  trim.patch(scrRows, GLASS, [0, 0.5, 1]);

  const roofCols = [[-0.98, -0.048], [-1, -0.010], [-0.94, 0], [-0.66, 0.5 * crown], [-0.3, 0.8 * crown],
    [0, crown], [0.3, 0.8 * crown], [0.66, 0.5 * crown], [0.94, 0], [1, -0.010], [0.98, -0.048]];
  const roofRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const cz = lp(scrZ, backZ, t), cy = roofY + 0.005 * Math.sin(Math.PI * t);
    roofRows.push(roofCols.map(([u, dy]) => [u * wRoof, cy + dy - 0.016 * u * u, cz]));
  }
  roofInto.patch(roofRows, roofCol, [0, 1, 0]);

  const rearRows = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3, row = [];
    const cz = lp(backZ, rearZ, t), cy = lp(roofY - 0.006, rearY, t) + rearBow * Math.sin(Math.PI * t);
    const hwv = lp(wRearT, wRear, t);
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8;
      row.push([u * hwv, cy - 0.024 * u * u, cz + rearWrap * u * u]);
    }
    rearRows.push(row);
  }
  trim.patch(rearRows, GLASS, [0, 0.7, -1]);
  // A hatch's screen stops short of the deck and the tailgate carries on in
  // paint below it. Run the glass all the way down instead and the whole back
  // of the car is one black slab -- which is what the first pass of the
  // hatchback looked like from behind.
  if (rearY - deck[1] > 0.03) {
    const foot = rearRows[rearRows.length - 1];
    paint.patch([foot.map(([x, y, z]) => [x * 1.004, y + 0.004, z + 0.006]),
      foot.map(([x, , z]) => [x * (deck[0] / wRear), deck[1] + 0.002, z - 0.012])], WHITE, [0, 0.2, -1]);
  }

  // The C-pillar's outer edge walks DOWN the back of the side glass and then
  // along the deck to the rear screen's foot -- one row per rear-screen row, so
  // the sail is a strip between two lines that each belong to a real edge.
  const sailOuter = [
    [wGlassT, sgRT[1], sgRT[0]],
    [lp(wGlassT, wGlassB, 0.5), lp(sgRT[1], sgRB[1], 0.5), lp(sgRT[0], sgRB[0], 0.5)],
    [wGlassB, sgRB[1], sgRB[0]],
    [deck[0], Math.max(deck[1], rearY - 0.03), rearZ],
  ];
  for (const sx of [-1, 1]) {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, row = [];
      for (let j = 0; j <= 6; j++) {
        const u = j / 6;
        const bz = lp(sgFB[0], sgRB[0], u), by = lp(sgFB[1], sgRB[1], u);
        const tz = lp(sgFT[0], sgRT[0], u), ty = lp(sgFT[1], sgRT[1], u);
        row.push([sx * lp(wGlassB, wGlassT, t), lp(by, ty, t), lp(bz, tz, t)]);
      }
      rows.push(row);
    }
    trim.patch(rows, GLASS, [sx, 0, 0]);
    for (const u of bPillars) {
      const bz0 = lp(sgFB[0], sgRB[0], u), bz1 = lp(sgFT[0], sgRT[0], u);
      matte.patch([
        [[sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 + 0.045], [sx * (wGlassB + 0.006), sgFB[1] - 0.01, bz0 - 0.045]],
        [[sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 + 0.045], [sx * (wGlassT + 0.006), sgFT[1] + 0.005, bz1 - 0.045]],
      ], [0.09, 0.10, 0.11], [sx, 0, 0]);
    }
    pillarInto.patch(scrRows.map((r, i) => {
      const e = r[r.length - 1], t = i / 3;
      return [[sx * e[0], e[1], e[2]],
        [sx * lp(wGlassB, wGlassT, t), lp(sgFB[1], sgFT[1], t), lp(sgFB[0], sgFT[0], t)]];
    }), pillarCol, [sx, 0.4, 0]);
    pillarInto.patch(rearRows.map((r, i) => {
      const e = r[r.length - 1], o = sailOuter[i];
      return [[sx * e[0], e[1], e[2]], [sx * o[0], o[1], o[2]]];
    }), pillarCol, [sx, 0.4, 0]);
    // Black seal along the foot of the side glass. Painted metal running
    // straight into glass is the "window drawn on" look.
    matte.tube([sx * (wGlassB + 0.006), sgFB[1] - 0.004, sgFB[0]],
      [sx * (wGlassB + 0.006), sgRB[1] - 0.004, sgRB[0]], 0.012, 5, PLASTIC, true);
  }
  // A glass roof (the EV's) has nothing to line: you look down into the cabin.
  if (g.rows) carCabin(matte, { ...g, scrWrap, rearWrap, headliner: roofInto !== trim }, paint);
  return { scrRows, rearRows, roofRows };
}

// --- cabins -----------------------------------------------------------------
//
// The glass is see-through (glassShader), so what is behind it has to exist.
// Behind a car's glass was the top of the body's own deck in car colour and
// nothing above it, so a cabin is the few things that actually show over a
// beltline: a dark floor over that deck, a dash under the screen, seat backs
// with their headrests standing clear on posts, a light headliner, and in an
// occupied car a driver. Everything is in `matte` (no extra draw); the driver
// goes in `matte.crew`, which buildType merges only into the geometries of
// cars somebody is in -- a parked car is empty.
//
// Colours are dim but NOT black. Behind a pane passing 45 % and under its own roof's
// shadow, a black cabin is the old dark slab over again; it is the lighter
// headliner and the headrest-against-window silhouettes that read as a cabin.
const CAB_FLOOR = [0.045, 0.045, 0.05];
const CAB_SEAT = [0.10, 0.10, 0.108];
const CAB_DASH = [0.055, 0.056, 0.06];
const CAB_ROOF = [0.34, 0.33, 0.31];
const SKIN = [0.52, 0.36, 0.26];
const HAIR = [0.05, 0.04, 0.035];
const SHIRT = [0.13, 0.16, 0.22];

/**
 * A box on its base whose top leans back by `rake` -- a seat back. Open
 * underneath, like `box`; the bottom is always below the deck.
 */
function rakedBox(b, x, y, z, w, h, d, rake, col) {
  const hw = w / 2, hd = d / 2;
  const P = (sx, up, sz) => [x + sx * hw, y + (up ? h : 0), z + sz * hd - (up ? rake : 0)];
  const nb = Math.hypot(rake, h);
  b.quad(P(-1, 0, 1), P(1, 0, 1), P(1, 1, 1), P(-1, 1, 1), [0, rake / nb, h / nb], [0, 0, 1, 0, 1, 1, 0, 1], col);
  b.quad(P(1, 0, -1), P(-1, 0, -1), P(-1, 1, -1), P(1, 1, -1), [0, -rake / nb, -h / nb], [0, 0, 1, 0, 1, 1, 0, 1], col);
  for (const s of [-1, 1]) b.quad(P(s, 0, 1), P(s, 0, -1), P(s, 1, -1), P(s, 1, 1), [s, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], col);
  b.quad(P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col);
}

/**
 * One seat seen over a beltline: the top of the back, and a headrest on two
 * posts with daylight between -- that gap is most of what makes it read as a
 * seat rather than a box. `y` is the floor, `H` the floor-to-headliner height.
 */
function seat(b, x, y, z, w, H, bench = false, down = 0.25) {
  const back = 0.22 * H, hr0 = 0.30 * H, hr1 = 0.60 * H;
  rakedBox(b, x, y - down, z, w, back + down, 0.13, 0.05, CAB_SEAT);
  const heads = bench ? [-w * 0.3, w * 0.3] : [0];
  for (const hx of heads) {
    for (const px of [-0.07, 0.07]) b.box(x + hx + px, y + back - 0.01, z - 0.045, 0.014, hr0 - back + 0.02, 0.014, 0, [0.30, 0.31, 0.33]);
    b.box(x + hx, y + hr0, z - 0.05, 0.26, hr1 - hr0, 0.09, 0, CAB_SEAT);
  }
}

/**
 * A seated occupant as seen through a side window: head, hair, neck, the top of
 * the shoulders, and forearms out to the wheel. Built facing +z on the seat
 * whose back is at `z`.
 */
function occupant(b, x, y, z, H, wheelAt = null) {
  const r = Math.min(0.105, 0.26 * H);
  const hy = y + 0.53 * H, hz = z + 0.17;
  b.spheroid(x, hy, hz, r, 8, 5, SKIN, 1.18);
  // Hair: a cap over the crown and the back, a hair's breadth outside the head.
  b.spheroid(x, hy + r * 0.28, hz - r * 0.12, r * 1.06, 8, 4, HAIR, 1.0);
  b.prism(x, hy - r * 1.75, hz - 0.02, r * 0.42, r * 0.9, 6, SKIN);
  rakedBox(b, x, y - 0.30, z + 0.16, 0.44, 0.30 + 0.16 * H, 0.22, 0.04, SHIRT);
  if (wheelAt) {
    for (const s of [-1, 1]) {
      b.tube([x + s * 0.19, y + 0.10 * H, z + 0.14], [wheelAt[0] + s * 0.15, wheelAt[1], wheelAt[2] - 0.02], 0.038, 5, SHIRT, true);
    }
  }
}

/**
 * Steering wheel: the top half of the rim, tilted back, which is all a beltline
 * lets you see of one.
 */
function wheelRim(b, cx, cy, cz, R = 0.18) {
  const tilt = 0.45, seg = 6;
  const at = (a) => [cx + Math.cos(a) * R, cy + Math.sin(a) * R * Math.cos(tilt), cz - Math.sin(a) * R * Math.sin(tilt)];
  for (let i = 0; i < seg; i++) {
    b.tube(at((Math.PI * i) / seg), at((Math.PI * (i + 1)) / seg), 0.016, 4, [0.03, 0.03, 0.035], false);
  }
}

/**
 * A car's cabin, derived from the same greenhouse stations that drew its glass
 * so it can never poke through it: the floor is held inside the screens' feet
 * (following their wrap), the headliner inside the roof, the seats between the
 * side glass. `rows` are seat-back stations, front first; `front` is 'pair'
 * (buckets) and later rows are benches unless `rowKind` says otherwise.
 */
/**
 * Highest point of `b`'s geometry straight under (x, z) within a band round
 * `yRef` -- the top of a car's deck under its cabin. Brute force over the
 * builder's triangles; it runs a few dozen times per type at boot.
 */
function deckAt(b, x, z, yRef) {
  const p = b.pos, ix = b.idx;
  let best = -Infinity;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, c = ix[i + 1] * 3, e = ix[i + 2] * 3;
    const ya = p[a + 1], yc = p[c + 1], ye = p[e + 1];
    if (Math.max(ya, yc, ye) < yRef - 0.15 || Math.min(ya, yc, ye) > yRef + 0.15) continue;
    const x0 = p[a], z0 = p[a + 2], x1 = p[c], z1 = p[c + 2], x2 = p[e], z2 = p[e + 2];
    const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(d) < 1e-9) continue;
    const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
    const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
    if (l0 < 0 || l1 < 0 || l0 + l1 > 1) continue;
    const y = l0 * ya + l1 * yc + (1 - l0 - l1) * ye;
    if (y < yRef + 0.12 && y > best) best = y;
  }
  return best;
}

function carCabin(matte, g, paint = null) {
  const {
    cowlZ, cowlY, scrZ, roofY, backZ, rearZ, rearY, wScrB, wRoof, wRear, wGlassT, wGlassB,
    sgFB, sgRB, rows, scrWrap = 0.085, rearWrap = 0.035, headliner = true, driverX = null,
  } = g;
  const y = Math.max(sgFB[1], sgRB[1]) + 0.010;
  const H = roofY - 0.035 - y;
  const rakeF = (scrZ - cowlZ) / (roofY - cowlY), rakeR = (backZ - rearZ) / (roofY - rearY);
  const zF = cowlZ + Math.max(0, y - cowlY) * rakeF - 0.035;
  const zR = rearZ + Math.max(0, y - rearY) * rakeR + 0.035;
  const x = Math.min(wGlassB, wScrB, wRear) - 0.05;
  // Floor over the deck, out to the glass on every side -- any deck left
  // showing is a strip of body colour inside the car. Cut to the screens'
  // wrap at both ends, and to the side glass's foot between them.
  const xS = wGlassB - 0.015, zSR = Math.max(sgRB[0], zR + 0.06), zSF = Math.min(sgFB[0], zF - 0.06);
  const row = (hw, z, wrap) => {
    const out = [];
    for (let j = 0; j <= 6; j++) { const u = -1 + (2 * j) / 6; out.push([u * hw, y, z + wrap * u * u]); }
    return out;
  };
  const floor = [row(wRear - 0.03, zR, rearWrap)];
  if (zSF - zSR > 0.1) {
    for (let i = 0; i <= 4; i++) floor.push(row(xS, lerp(zSR, zSF, i / 4), 0));
  }
  floor.push(row(wScrB - 0.03, zF, -scrWrap));
  // The deck is not flat -- it climbs toward a hatch's tailgate and an SUV's
  // cargo sill -- so a flat floor at the glass line had the car's own colour
  // showing through it behind the rear seats. Drape it on the paint instead.
  if (paint) for (const r of floor) for (const pt of r) pt[1] = Math.max(y, deckAt(paint, pt[0], pt[2], y) + 0.012);
  matte.patch(floor, CAB_FLOOR, [0, 1, 0]);
  // Dash: a step up under the screen, kept a margin under the glass.
  const dashD = Math.min(0.34, (zF - zR) * 0.2);
  const dashH = Math.min(0.07, Math.max(0.02, (dashD * 0.5) / Math.max(0.5, -rakeF) - 0.01));
  matte.box(0, y, zF - dashD / 2 - 0.02, x * 1.9, dashH, dashD, 0, CAB_DASH);
  if (headliner) {
    const hx = Math.min(wRoof * 0.92, wGlassT - 0.04);
    matte.quad([-hx, roofY - 0.035, scrZ - 0.01], [hx, roofY - 0.035, scrZ - 0.01],
      [hx, roofY - 0.035, backZ + 0.01], [-hx, roofY - 0.035, backZ + 0.01], [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], CAB_ROOF);
  }
  const sx = Math.min(0.37, x * 0.52);
  const dx = driverX === null ? sx : driverX;
  rows.forEach((z, i) => {
    if (i === 0) for (const s of [-1, 1]) seat(matte, s * sx, y, z, Math.min(0.50, x * 0.68), H);
    else seat(matte, 0, y, z, x * 1.75, H, true);
  });
  const wheel = [dx, y - 0.07, rows[0] + 0.55];
  wheelRim(matte, wheel[0], wheel[1], wheel[2]);
  if (matte.crew) occupant(matte.crew, dx, y, rows[0], H, wheel);
  return { y, H, x, zF, zR };
}

/**
 * The cabin inside a `boxShell` (van, truck and bus cabs), which unlike a car's
 * greenhouse has no deck under it and no roof lining: a floor at `y` between
 * `zR` and `zF`, a dash at the front, a bulkhead at `zR` facing forward, a
 * headliner at `top` back from `hzF`, and seat rows. Every figure comes from
 * the shell's own stations at the call site, inside the glass.
 */
function boxCabin(matte, c) {
  // `sit` is the level a car's beltline would be at -- about the seated
  // shoulder -- which in a van or truck is well above the cab floor.
  const { y, x, zR, zF, top, hzF = zF, rows, wheelDz = 0.55, bulkhead = true, driverX = null, benches = 'pair' } = c;
  const sit = c.sit === undefined ? y : c.sit;
  matte.quad([-x, y, zR], [x, y, zR], [x, y, zF], [-x, y, zF], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], CAB_FLOOR);
  matte.box(0, y, zF - 0.20, x * 1.96, Math.max(0.10, sit - y - 0.12), 0.36, 0, CAB_DASH);
  if (bulkhead) matte.quad([-x, y, zR], [x, y, zR], [x, top, zR], [-x, top, zR], [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], CAB_FLOOR);
  matte.quad([-x, top, zR], [x, top, zR], [x, top, hzF], [-x, top, hzF], [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], CAB_ROOF);
  const sx = Math.min(0.46, x * 0.52), dx = driverX === null ? sx : driverX;
  const Hs = Math.min(top - sit, 0.72);   // a seat is a seat's height, however tall the box
  const down = sit - y + 0.02;
  rows.forEach((z) => {
    if (benches === 'pair') for (const s of [-1, 1]) seat(matte, s * sx, sit, z, 0.50, Hs, false, down);
    else seat(matte, 0, sit, z, x * 1.75, Hs, true, down);
  });
  const wheel = [dx, sit - 0.04, rows[0] + wheelDz];
  wheelRim(matte, wheel[0], wheel[1], wheel[2], 0.22);
  if (matte.crew) occupant(matte.crew, dx, sit, rows[0], Hs, wheel);
}

/**
 * A city bus's saloon: a floor, a light ceiling, forward-facing double seats
 * down both sides of an aisle, the driver's cab at the front on the left, and
 * a few passengers. The windows run both sides, so this is seen THROUGH, the
 * way a real bus is -- no liner walls.
 */
function busCabin(matte, shell, o) {
  const { belt, nose, tail, roofY } = o;
  const y = belt + 0.01, sit = belt + 0.05, top = roofY - 0.14, Hs = 0.72;
  const x = shell.sec(0).w0 - 0.06;
  const z0 = tail + 0.25, z1 = nose - 0.20;
  matte.quad([-x, y, z0], [x, y, z0], [x, y, z1], [-x, y, z1], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], CAB_FLOOR);
  matte.quad([-x, top, z0], [x, top, z0], [x, top, z1], [-x, top, z1], [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], CAB_ROOF);
  matte.box(0, y, nose - 0.45, x * 1.96, 0.22, 0.40, 0, CAB_DASH);
  // Driver on the left (+x), behind a screen; the wheel is flat and big.
  const dz = nose - 1.35;
  rakedBox(matte, 0.62, y - 0.02, dz, 0.52, sit - y + 0.55 * Hs, 0.12, 0.05, CAB_SEAT);
  const wheel = [0.62, sit + 0.02, dz + 0.62];
  wheelRim(matte, wheel[0], wheel[1], wheel[2], 0.24);
  matte.box(0.18, y, dz + 0.10, 0.03, 0.80 * Hs + sit - y, 0.60, 0, [0.30, 0.31, 0.33]);    // cab screen
  if (matte.crew) occupant(matte.crew, 0.62, sit, dz, Hs, wheel);
  // Double seats, one tall back each, every 0.85 m down both sides.
  const seatX = x - 0.46, backH = sit - y + 0.58 * Hs;
  const riders = new Set([1, 4, 6, 9, 13, 17, 20]);
  let n = 0;
  for (let z = nose - 2.35; z > tail + 1.0; z -= 0.85) {
    for (const sx of [-1, 1]) {
      // The kerb-side doors are standing room.
      if (sx < 0 && ((z > 4.35 && z < 5.65) || (z > -0.70 && z < 0.70))) continue;
      rakedBox(matte, sx * seatX, y - 0.02, z, 0.86, backH, 0.10, 0.06, CAB_SEAT);
      if (matte.crew && riders.has(n)) occupant(matte.crew, sx * (seatX + (n % 2 ? 0.2 : -0.2)), sit, z, Hs);
      n++;
    }
  }
}

/**
 * A lens or trim strip laid over the drawn shell between two stations and two
 * section points, `d` proud of the paint. This is how a lamp WRAPS: a pocket in
 * the end face is a lamp seen from dead ahead, and a modern car's lamps turn the
 * corner onto the wing, which is most of what separates a face from a decal.
 */
function onShell(core, b, sx, z0, z1, i0, i1, col, d = 0.006, rows = 3) {
  const out = [];
  for (let r = 0; r <= rows; r++) {
    const z = z0 + ((z1 - z0) * r) / rows, row = [];
    for (let i = i0; i <= i1; i++) row.push(core.surf(z, sx, i, d));
    out.push(row);
  }
  b.patch(out, col, [sx, 0.3, 0]);
}

/**
 * The corner of a headlamp as it turns onto the wing: a gloss-black housing
 * over the shoulder with a slim lamp strip set in it. A bright lens laid
 * straight on the paint mirrors the sky from `trim`'s metalness and reads as a
 * chrome shard stuck to the wing -- which is what the first pass did.
 */
function headlampWrap(core, trim, sx, nose, len) {
  onShell(core, trim, sx, nose - len, nose - 0.02, 6, 8, [0.035, 0.04, 0.045], 0.006, 2);
  onShell(core, trim, sx, nose - len * 0.75, nose - 0.03, 7, 8, LAMP, 0.010, 1);
}

/** One door shut line: a hairline patch that follows the section at `zc`. */
function shutLine(core, matte, sx, zc, i0 = 2, i1 = 8) {
  const rows = [-0.008, 0.008].map((dz) =>
    core.half(zc + dz, sx).slice(i0, i1 + 1).map(([x, y]) => [x + sx * 0.005, y, zc + dz]));
  matte.patch(rows, [0.13, 0.14, 0.15], [sx, 0, 0]);
}

/**
 * Door mirror on a stalk from the A-pillar's foot. Placed from the glass
 * corner, never by eye -- see the sedan's for the red brick hanging in the air
 * that placing it by eye produced.
 */
function doorMirror(paint, trim, sx, fb, wGlassB, reach = 0.15) {
  const [z, y] = fb;
  paint.tube([sx * wGlassB, y + 0.004, z - 0.02], [sx * (wGlassB + reach * 0.75), y + 0.03, z - 0.06], 0.019, 6, WHITE, true);
  const mx = sx * (wGlassB + reach), my = y + 0.01;
  const pod = (k) => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      out.push([mx + Math.cos(a) * 0.070 * k, my + Math.sin(a) * 0.048 * k]);
    }
    return out;
  };
  paint.loft([{ z: z - 0.14, pts: pod(0.80) }, { z: z - 0.07, pts: pod(1) }, { z: z - 0.02, pts: pod(0.72) }],
    WHITE, { capStart: true, capEnd: true });
  trim.box(mx, my - 0.040, z - 0.146, 0.118, 0.080, 0.012, 0, MIRROR);
}

/**
 * The two small cars, on one builder with two looks.
 *
 * What they replaced was `buildGeneric`: one tube through `section`, capped
 * with a flat triangle fan at each end and dressed in boxes. On a short car the
 * caps are most of what you see, and the lamp "housings" were boxes standing
 * off the corners of that slab -- a hatchback read as a bread loaf with ears.
 *
 * Both run through `bodyCore` + `greenhouse`, so the end faces are real
 * fascias with the apertures cut out and the pillars are panels.
 *
 *   hatch    a C-segment five-door: short sloping nose, raked screen, a steep
 *            tailgate and a THICK C-pillar, swept lamps that turn the corner.
 *   compact  a city car: stubby, tall for its length, upright tail, round lamps
 *            in black housings and blacked-out pillars, so the roof floats --
 *            the one detail that says "small and cheerful" from across a road.
 */
const SMALL_LOOKS = {
  hatch: {
    zF: 1.19, zR: -1.41,                       // 2.60 m wheelbase, FWD overhangs
    halfW: [[-2.05, 0.88], [-1.85, 0.96], [-1.41, 1.00], [-0.55, 0.965], [0.55, 0.965], [1.19, 1.00], [1.75, 0.95], [2.05, 0.86]],
    sillY: [[-2.05, 0.40], [-1.75, 0.32], [-0.60, 0.29], [0.60, 0.29], [1.70, 0.32], [2.05, 0.38]],
    // The bonnet falls 17 cm over the last 1.25 m: a hatch's nose is short
    // and sloped, where the sedan's is long and level.
    beltY: [[-2.05, 0.97], [-1.80, 0.99], [-1.41, 1.00], [-0.50, 0.98], [0.40, 0.965], [0.80, 0.955], [1.30, 0.91], [1.75, 0.85], [2.05, 0.79]],
    tuckAt: [[-2.05, 0.90], [-1.41, 0.95], [-0.60, 0.90], [0.60, 0.90], [1.19, 0.95], [2.05, 0.90]],
    topAt: [[-2.05, 0.88], [-1.80, 0.93], [-1.00, 0.95], [0.90, 0.95], [1.50, 0.90], [1.85, 0.84], [2.05, 0.74]],
    core: { archR: 0.50, archGap: 0.05, creaseAt: 0.60, tumble: 0.93, deckDrop: 0.028, lipOut: 0.030, endRound: 0.16, endMin: 0.90 },
    tw: 0.215,
    gh: {
      cowlZ: 0.78, scrZ: -0.08, backZ: -1.34, rearZ: -1.80, rearY: 1.10,
      wScrB: 0.76, wScrT: 0.64, wRoof: 0.655, wRearT: 0.635, wRear: 0.735, wGlassT: 0.630, wGlassB: 0.740,
      sgFB: [0.70, 0.965], sgFT: [-0.06, 1.470], sgRT: [-1.05, 1.462], sgRB: [-1.30, 0.995],
      bPillars: [0.46], rearWrap: 0.030, rows: [-0.24, -1.02],
    },
    doors: [0.70, -0.33, -1.22],
  },
  compact: {
    zF: 1.13, zR: -1.29,                       // 2.42 m wheelbase on 3.74 m
    halfW: [[-1.87, 0.90], [-1.70, 0.97], [-1.29, 1.00], [-0.50, 0.97], [0.50, 0.97], [1.13, 1.00], [1.62, 0.96], [1.87, 0.88]],
    sillY: [[-1.87, 0.38], [-1.60, 0.31], [-0.50, 0.28], [0.50, 0.28], [1.55, 0.31], [1.87, 0.36]],
    beltY: [[-1.87, 0.95], [-1.60, 0.97], [-1.29, 0.975], [-0.40, 0.96], [0.40, 0.95], [0.75, 0.94], [1.20, 0.90], [1.60, 0.85], [1.87, 0.80]],
    tuckAt: [[-1.87, 0.92], [-1.29, 0.96], [-0.50, 0.91], [0.50, 0.91], [1.13, 0.96], [1.87, 0.92]],
    topAt: [[-1.87, 0.90], [-1.60, 0.94], [-0.90, 0.95], [0.80, 0.95], [1.35, 0.90], [1.70, 0.84], [1.87, 0.76]],
    core: { archR: 0.47, archGap: 0.05, creaseAt: 0.58, tumble: 0.94, deckDrop: 0.026, lipOut: 0.036, endRound: 0.15, endMin: 0.92 },
    tw: 0.195,
    gh: {
      cowlZ: 0.74, scrZ: -0.02, backZ: -1.50, rearZ: -1.72, rearY: 1.07,
      wScrB: 0.72, wScrT: 0.63, wRoof: 0.648, wRearT: 0.628, wRear: 0.700, wGlassT: 0.622, wGlassB: 0.722,
      sgFB: [0.66, 0.955], sgFT: [-0.02, 1.450], sgRT: [-1.36, 1.446], sgRB: [-1.47, 0.978],
      bPillars: [0.52], rearWrap: 0.024, rearBow: 0.006, rows: [-0.30, -1.16],
      pillarBlack: true,
    },
    doors: [0.62, -0.60],
  },
};

function buildSmallCar(spec, paint, trim, matte, S) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const { zF, zR } = S;
  const halfW = curve(S.halfW), sillY = curve(S.sillY), beltY = curve(S.beltY);
  const core = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, tuckAt: curve(S.tuckAt), topAt: curve(S.topAt), zF, zR, ...S.core,
  });
  const { geom, endProf } = core;
  const round = S === SMALL_LOOKS.compact;

  const tw = S.tw;
  const wx = geom(zF).wb - tw / 2 + 0.02, wxR = geom(zR).wb - tw / 2 + 0.02;
  const wheels = [[-wx, wr, zF, wr, tw], [wx, wr, zF, wr, tw], [-wxR, wr, zR, wr, tw], [wxR, wr, zR, wr, tw]];

  const G = S.gh;
  const BLACKOUT = [0.065, 0.07, 0.075];
  greenhouse(paint, trim, matte, {
    ...G, cowlY: beltY(G.cowlZ) - 0.005, roofY: spec.roof,
    deck: [geom(G.rearZ).tw * 0.985, beltY(G.rearZ) - 0.006],
    pillarInto: G.pillarBlack ? matte : paint, pillarCol: G.pillarBlack ? BLACKOUT : WHITE,
  });

  // --- front ------------------------------------------------------------------
  const yN = sillY(nose), bN = beltY(nose);
  if (round) {
    const LAMP_A = [0.505, yN + 0.300, 0.105, 0.092], GRILLE = [0, yN + 0.215, 0.250, 0.070];
    const INTAKE = [0, yN + 0.085, 0.380, 0.045];
    endFace(paint, nose, 1, endProf(nose), [LAMP_A, GRILLE, INTAKE], WHITE);
    const gp = pocket(paint, matte, 0, GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.10, 1, { rim: 0.024, rimCol: CHROME });
    for (let i = -4; i <= 4; i++) trim.box(i * 0.052, GRILLE[1] - GRILLE[3] * 0.85, gp.z + 0.02, 0.014, GRILLE[3] * 1.7, 0.03, 0, [0.20, 0.21, 0.23]);
    for (const sx of [-1, 1]) {
      pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.08, 1, { rim: 0.018, rimCol: PLASTIC });
      // Round lamp in the square housing: a chrome bezel and a domed lens.
      trim.tube([sx * LAMP_A[0], LAMP_A[1], nose - 0.030], [sx * LAMP_A[0], LAMP_A[1], nose + 0.004], 0.086, 14, CHROME, true);
      trim.tube([sx * LAMP_A[0], LAMP_A[1], nose - 0.020], [sx * LAMP_A[0], LAMP_A[1], nose + 0.016], 0.070, 14, LAMP, true);
      trim.box(sx * 0.66, yN + 0.155, nose - 0.02, 0.07, 0.035, 0.03, 0, AMBER);
    }
    pocket(paint, matte, 0, INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.09, 1, { rim: 0.02, rimCol: PLASTIC });
  } else {
    const GRILLE = [0, yN + 0.225, 0.300, 0.046], LAMP_A = [0.505, bN - 0.115, 0.165, 0.060];
    const INTAKE = [0, yN + 0.090, 0.440, 0.058];
    endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
    const gp = pocket(paint, matte, 0, GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.10, 1, { rim: 0.018, rimCol: PLASTIC });
    trim.box(0, GRILLE[1] + GRILLE[3] + 0.004, nose + 0.012, GRILLE[2] * 2.1, 0.014, 0.02, 0, CHROME);
    for (let i = 0; i < 2; i++) trim.box(0, GRILLE[1] - 0.024 + i * 0.030, gp.z + 0.02, gp.hw * 1.9, 0.012, 0.03, 0, [0.20, 0.21, 0.23]);
    for (const sx of [-1, 1]) {
      const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.09, 1, { rim: 0.016, rimCol: PLASTIC });
      trim.box(sx * LAMP_A[0], LAMP_A[1] - 0.042, nose - 0.028, hp.hw * 1.9, 0.084, 0.022, 0, LAMP);
      trim.box(sx * LAMP_A[0], LAMP_A[1] - 0.036, nose - 0.004, hp.hw * 1.8, 0.012, 0.012, 0, WHITE); // DRL
      // The lamp turns the corner onto the wing.
      headlampWrap(core, trim, sx, nose, 0.15);
      hole(trim, matte, sx * 0.50, yN + 0.085, nose - 0.01, 0.036, 0.06, 1, { rimCol: PLASTIC });
    }
    pocket(paint, matte, 0, INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.10, 1, { rim: 0.02, rimCol: PLASTIC });
  }
  matte.box(0, yN - 0.03, nose - 0.17, geom(nose - 0.17).wb * 1.6, 0.050, 0.20, 0, PLASTIC);   // chin, tucked under
  trim.box(0, yN + 0.155, nose + 0.004, 0.40, 0.11, 0.02, 0, PLATE);

  // --- rear -------------------------------------------------------------------
  const yT = sillY(tail), bT = beltY(tail);
  const TAILA = round ? [0.600, bT - 0.150, 0.080, 0.100] : [0.585, bT - 0.120, 0.115, 0.058];
  const TPLATE = [0, yT + 0.210, 0.230, 0.070];
  endFace(paint, tail, -1, endProf(tail), [TAILA, TPLATE], WHITE);
  for (const sx of [-1, 1]) {
    const tp = pocket(paint, matte, sx * TAILA[0], TAILA[1], tail, TAILA[2], TAILA[3], 0.06, -1, { rim: 0.018, rimCol: PLASTIC });
    trim.box(sx * TAILA[0], TAILA[1] - tp.hh * 0.95, tail + 0.018, tp.hw * 1.9, tp.hh * 1.9, 0.022, 0, TAILC);
    if (!round) onShell(core, trim, sx, tail + 0.02, tail + 0.13, 6, 8, TAILC, 0.006, 2);
    hole(trim, matte, sx * 0.40, yT + 0.03, tail + 0.03, 0.036, 0.09, -1);
  }
  pocket(paint, matte, 0, TPLATE[1], tail, TPLATE[2], TPLATE[3], 0.04, -1, { rim: 0.018, rimCol: PLASTIC });
  trim.box(0, TPLATE[1] - 0.062, tail - 0.024, 0.40, 0.12, 0.02, 0, PLATE);
  matte.box(0, yT - 0.03, tail + 0.17, geom(tail + 0.17).wb * 1.6, 0.070, 0.20, 0, PLASTIC);    // valance, tucked under
  // Tailgate shut line across the back, and a spoiler over the screen.
  matte.box(0, bT - 0.004, tail + 0.03, geom(tail + 0.03).tw * 1.6, 0.010, 0.012, 0, [0.13, 0.14, 0.15]);
  paint.box(0, spec.roof - 0.040, G.backZ - 0.02, G.wRoof * 1.94, 0.036, 0.13, 0, WHITE);
  trim.box(0, spec.roof - 0.052, G.backZ - 0.085, 0.20, 0.022, 0.012, 0, TAILC);          // high stop lamp
  matte.tube([0.02, G.rearY + 0.03, G.rearZ + 0.02], [0.42, G.rearY + 0.13, G.rearZ - 0.06], 0.010, 4, PLASTIC, true); // wiper

  // --- flanks -----------------------------------------------------------------
  for (const sx of [-1, 1]) {
    for (const zc of S.doors) shutLine(core, matte, sx, zc);
    matte.box(sx * (geom(0).wb + 0.004), sillY(0) + 0.005, (zF + zR) / 2 + 0.02, 0.030, 0.07, (zF - zR) - 0.95, 0, PLASTIC);
    for (let k = 0; k < S.doors.length - 1; k++) {
      const zc = S.doors[k + 1] + 0.14, hg = geom(zc);
      trim.tube([sx * hg.w * 0.99, hg.yc + 0.07, zc - 0.075], [sx * hg.w * 0.99, hg.yc + 0.07, zc + 0.075], 0.014, 6, CHROME, true);
    }
    doorMirror(paint, trim, sx, G.sgFB, G.wGlassB, 0.13);
    trim.box(sx * (geom(zF + 0.52).w + 0.004), geom(zF + 0.52).yc + 0.02, zF + 0.52, 0.01, 0.025, 0.07, 0, AMBER);
  }
  // Shark-fin aerial over the rear of the roof.
  for (const sx of [-1, 1]) {
    paint.patch([
      [[0, spec.roof - 0.002, G.backZ + 0.30], [0, spec.roof - 0.002, G.backZ + 0.12]],
      [[sx * 0.026, spec.roof + 0.028, G.backZ + 0.25], [sx * 0.026, spec.roof + 0.028, G.backZ + 0.13]],
      [[0, spec.roof + 0.056, G.backZ + 0.18], [0, spec.roof + 0.056, G.backZ + 0.13]],
    ], [0.10, 0.11, 0.12], [sx, 0.4, 0]);
  }
  return wheels;
}

/**
 * The electric car: a low fastback on a long wheelbase with short overhangs,
 * a sealed nose, a screen raked so far it runs into a black glass roof, and one
 * full-width light bar at each end (see "The electric car is a spec flag" in
 * CLAUDE.md for what else `ev` switches). It was `buildGeneric` with its lamps
 * removed, which left the flat end caps as the only thing at either end.
 *
 * The roof is glass rather than paint, laid into `trim` on the same rows the
 * painted roof would use -- that single change is most of what makes it read
 * as a modern electric saloon rather than as a coupe.
 */
function buildEv(spec, paint, trim, matte) {
  const wr = spec.wheelR;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.48, zR = -1.48;                 // 2.96 m wheelbase, 83 cm overhangs

  const halfW = curve([
    [tail, 0.86], [-2.00, 0.95], [zR, 1.00], [-0.60, 0.955], [0.60, 0.955], [zF, 1.00], [2.00, 0.94], [nose, 0.84],
  ]);
  const sillY = curve([[tail, 0.36], [-1.95, 0.26], [-0.60, 0.23], [0.60, 0.23], [1.95, 0.26], [nose, 0.30]]);
  // The nose is the lowest here -- 66 cm, against the sedan's 95 -- because
  // there is no engine under it. Held up to 86 cm over the front axle so the
  // wing still covers the tyre by 9 cm.
  const beltY = curve([
    [tail, 0.92], [-2.00, 0.95], [zR, 0.96], [-0.60, 0.93], [0.30, 0.915], [0.80, 0.90],
    [1.30, 0.88], [1.80, 0.81], [2.10, 0.74], [nose, 0.66],
  ]);
  const core = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, zF, zR,
    tuckAt: curve([[tail, 0.86], [zR, 0.93], [-0.60, 0.88], [0.60, 0.88], [zF, 0.93], [nose, 0.86]]),
    topAt: curve([[tail, 0.84], [-1.90, 0.90], [-1.00, 0.93], [0.90, 0.93], [1.60, 0.88], [2.05, 0.80], [nose, 0.70]]),
    archR: 0.55, archGap: 0.05, creaseAt: 0.55, tumble: 0.92, deckDrop: 0.030, lipOut: 0.030,
    endRound: 0.22, endMin: 0.86,
  });
  const { geom, endProf } = core;
  const tw = 0.245;
  const wx = geom(zF).wb - tw / 2 + 0.02, wxR = geom(zR).wb - tw / 2 + 0.02;
  const wheels = [[-wx, wr, zF, wr, tw], [wx, wr, zF, wr, tw], [-wxR, wr, zR, wr, tw], [wxR, wr, zR, wr, tw]];

  const G = {
    cowlZ: 0.92, cowlY: beltY(0.92) - 0.005, scrZ: -0.26, roofY: spec.roof, backZ: -0.90,
    rearZ: -1.80, rearY: beltY(-1.80) + 0.070,
    wScrB: 0.80, wScrT: 0.655, wRoof: 0.672, wRearT: 0.650, wRear: 0.80, wGlassT: 0.645, wGlassB: 0.80,
    sgFB: [0.86, beltY(0.86) + 0.008], sgFT: [-0.24, spec.roof - 0.030],
    sgRT: [-1.00, spec.roof - 0.040], sgRB: [-1.50, beltY(-1.50) + 0.008],
    deck: [geom(-1.80).tw * 0.985, beltY(-1.80) - 0.006],
    bPillars: [0.47], scrWrap: 0.10, rearWrap: 0.045, rearBow: 0.020, crown: 0.014,
    // A real glass roof now that glass is see-through: from above, or looking
    // up through a side window, you see the cabin and the sky.
    roofInto: trim, roofCol: GLASS, rows: [-0.22, -1.14],
  };
  greenhouse(paint, trim, matte, G);

  // --- front: sealed, with slim lamps joined by a light bar -------------------
  const yN = sillY(nose), bN = beltY(nose);
  const LAMP_A = [0.52, bN - 0.080, 0.140, 0.028], INTAKE = [0, yN + 0.080, 0.40, 0.038];
  endFace(paint, nose, 1, endProf(nose), [LAMP_A, INTAKE], WHITE);
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.07, 1, { rim: 0.012, rimCol: PLASTIC });
    trim.box(sx * LAMP_A[0], LAMP_A[1] - 0.020, nose - 0.024, hp.hw * 1.9, 0.040, 0.020, 0, LAMP);
    headlampWrap(core, trim, sx, nose, 0.17);
  }
  trim.box(0, LAMP_A[1] + 0.012, nose + 0.004, (LAMP_A[0] - LAMP_A[2]) * 2, 0.012, 0.010, 0, WHITE);   // light bar
  pocket(paint, matte, 0, INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.08, 1, { rim: 0.016, rimCol: PLASTIC });
  matte.box(0, yN - 0.035, nose - 0.17, geom(nose - 0.17).wb * 1.5, 0.045, 0.20, 0, PLASTIC);
  trim.box(0, yN + 0.150, nose + 0.004, 0.40, 0.11, 0.02, 0, PLATE);

  // --- rear: one lamp bar across the tail, a ducktail over it ------------------
  const yT = sillY(tail), bT = beltY(tail);
  const TAILBAR = [0, bT - 0.085, 0.62, 0.030], TPLATE = [0, yT + 0.170, 0.230, 0.070];
  endFace(paint, tail, -1, endProf(tail), [TAILBAR, TPLATE], WHITE);
  const tp = pocket(paint, matte, 0, TAILBAR[1], tail, TAILBAR[2], TAILBAR[3], 0.06, -1, { rim: 0.014, rimCol: PLASTIC });
  trim.box(0, TAILBAR[1] - tp.hh * 0.95, tail + 0.016, tp.hw * 1.96, tp.hh * 1.9, 0.020, 0, TAILC);
  for (const sx of [-1, 1]) onShell(core, trim, sx, tail + 0.02, tail + 0.14, 6, 8, TAILC, 0.006, 2);
  pocket(paint, matte, 0, TPLATE[1], tail, TPLATE[2], TPLATE[3], 0.04, -1, { rim: 0.016, rimCol: PLASTIC });
  trim.box(0, TPLATE[1] - 0.062, tail - 0.022, 0.40, 0.12, 0.02, 0, PLATE);
  // Ducktail rather than a wing -- it belongs to the bodywork, so it is painted
  // with the car instead of bolted on in a contrast colour.
  paint.box(0, beltY(tail + 0.14) - 0.012, tail + 0.13, geom(tail + 0.13).tw * 1.80, 0.034, 0.20, 0, WHITE);
  matte.box(0, yT - 0.06, tail + 0.16, geom(tail + 0.16).wb * 1.5, 0.070, 0.20, 0, PLASTIC);   // diffuser

  // --- flanks -----------------------------------------------------------------
  for (const sx of [-1, 1]) {
    for (const zc of [0.86, -0.12, -1.10]) shutLine(core, matte, sx, zc);
    matte.box(sx * (geom(0).wb + 0.004), sillY(0) - 0.01, 0, 0.034, 0.075, 1.80, 0, PLASTIC);
    // Flush handles: a dark sliver, not a chrome bar standing off the door.
    for (const zc of [0.50, -0.50]) {
      const hg = geom(zc);
      matte.box(sx * (hg.w + 0.002), hg.yc + 0.055, zc, 0.008, 0.022, 0.15, 0, [0.12, 0.13, 0.14]);
    }
    doorMirror(paint, trim, sx, G.sgFB, G.wGlassB, 0.13);
  }
  // Charge flap on the rear quarter, driver's side.
  matte.box(-(geom(-1.95).w + 0.003), geom(-1.95).yc + 0.02, -1.95, 0.008, 0.085, 0.11, 0, [0.14, 0.15, 0.16]);
  return wheels;
}

/**
 * Build a hand-built type at another type's size. The sedan's builder is
 * authored in absolute stations for a 5.06 x 1.90 m car; a taxi and a police
 * cruiser ARE that car, a little shorter or wider. Scaling the finished
 * vertices keeps every registered panel registered -- re-deriving the stations
 * by hand is ninety numbers to keep in step. Normals take the inverse scale.
 * The wheels are scaled in POSITION only, because they are built round by
 * `addWheel` afterwards; squashing them would make them ellipses.
 */
function scaledBuild(build, refLen, refWid) {
  return (spec, paint, trim, matte) => {
    const kx = spec.wid / refWid, kz = spec.len / refLen;
    const bs = [paint, trim, matte, matte.crew].filter(Boolean), from = bs.map((b) => b.pos.length);
    const wheels = build({ ...spec, len: refLen, wid: refWid }, paint, trim, matte);
    bs.forEach((b, j) => {
      for (let i = from[j]; i < b.pos.length; i += 3) {
        b.pos[i] *= kx; b.pos[i + 2] *= kz;
        const nx = b.nor[i] / kx, ny = b.nor[i + 1], nz = b.nor[i + 2] / kz;
        const l = Math.hypot(nx, ny, nz) || 1;
        b.nor[i] = nx / l; b.nor[i + 1] = ny / l; b.nor[i + 2] = nz / l;
      }
    });
    return wheels.map((wl) => [wl[0] * kx, wl[1], wl[2] * kz, ...wl.slice(3)]);
  };
}

/**
 * Taxi and police cruiser: the sedan's body at their own size, dressed. Both
 * used to be `buildGeneric` -- a bread-loaf shell with a sign on it -- so the
 * two vehicles a player sees most in a chase were the ugliest on the street.
 */
function buildServiceSedan(spec, paint, trim, matte) {
  const wheels = scaledBuild(buildSedan, 5.06, 1.90)(spec, paint, trim, matte);
  const kx = spec.wid / 1.90, kz = spec.len / 5.06;
  const roofY = spec.roof;
  // Door band, between the arches: the sedan's flank is vertical from y 0.69
  // to 0.77 along the doors, which is where a livery stripe sits flat.
  const doorBand = (y0, y1, z0, z1, col, into, segs = 1) => {
    for (const sx of [-1, 1]) {
      const x = sx * (0.95 * 0.955 * kx + 0.004);
      for (let i = 0; i < segs; i++) {
        const za = z0 + ((z1 - z0) * i) / segs, zb = z0 + ((z1 - z0) * (i + 1)) / segs;
        into.quad([x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za], [sx, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], col);
      }
    }
  };
  if (spec.taxi) {
    // A roof sign on two feet, lit face front and back, and the checker band
    // down the doors that says "cab" from a block away.
    matte.box(0, roofY + 0.004, -0.55 * kz, 0.62, 0.030, 0.26, 0, PLASTIC);
    paint.patch([
      [[-0.44, roofY + 0.034, -0.42 * kz], [0.44, roofY + 0.034, -0.42 * kz]],
      [[-0.40, roofY + 0.21, -0.51 * kz], [0.40, roofY + 0.21, -0.51 * kz]],
    ], WHITE, [0, 0.3, 1]);
    paint.patch([
      [[-0.44, roofY + 0.034, -0.68 * kz], [0.44, roofY + 0.034, -0.68 * kz]],
      [[-0.40, roofY + 0.21, -0.59 * kz], [0.40, roofY + 0.21, -0.59 * kz]],
    ], WHITE, [0, 0.3, -1]);
    paint.box(0, roofY + 0.206, -0.55 * kz, 0.80, 0.022, 0.10, 0, WHITE);
    for (const sx of [-1, 1]) paint.box(sx * 0.43, roofY + 0.034, -0.55 * kz, 0.04, 0.17, 0.26, 0, WHITE);
    trim.box(0, roofY + 0.075, -0.435 * kz, 0.50, 0.09, 0.02, 0, [1.0, 0.97, 0.86]);
    trim.box(0, roofY + 0.075, -0.665 * kz, 0.50, 0.09, 0.02, 0, [1.0, 0.97, 0.86]);
    const z0 = 0.95 * kz, z1 = -0.95 * kz, N = 18, h = 0.045;
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < N; i++) {
        if ((i + r) % 2) continue;
        const za = z0 + ((z1 - z0) * i) / N, zb = z0 + ((z1 - z0) * (i + 1)) / N;
        doorBand(0.70 + r * h, 0.70 + (r + 1) * h, za, zb, [0.04, 0.04, 0.045], matte);
      }
    }
  }
  if (spec.police) {
    // Blue stripe the length of the doors, over a dark lower band.
    doorBand(0.72, 0.79, 0.98 * kz, -0.98 * kz, [0.05, 0.10, 0.24], matte, 4);
    doorBand(0.79, 0.805, 0.98 * kz, -0.98 * kz, [0.78, 0.62, 0.18], matte, 4);
    // Push bar: two uprights and a crossbar standing clear of the grille.
    const nz = spec.len / 2;
    for (const sx of [-1, 1]) {
      matte.tube([sx * 0.30, 0.42, nz + 0.12], [sx * 0.30, 0.98, nz + 0.10], 0.030, 6, PLASTIC, true);
      matte.tube([sx * 0.30, 0.50, nz - 0.02], [sx * 0.30, 0.50, nz + 0.12], 0.028, 6, PLASTIC, true);
    }
    matte.box(0, 0.62, nz + 0.12, 0.72, 0.060, 0.045, 0, PLASTIC);
    matte.box(0, 0.86, nz + 0.11, 0.66, 0.050, 0.045, 0, PLASTIC);
    // Spotlights on the A-pillars, and a trunk-lid antenna.
    for (const sx of [-1, 1]) {
      matte.tube([sx * 0.80 * kx, 1.12, 0.66 * kz], [sx * 0.86 * kx, 1.16, 0.64 * kz], 0.014, 5, PLASTIC, true);
      trim.tube([sx * 0.86 * kx, 1.16, 0.56 * kz], [sx * 0.86 * kx, 1.16, 0.68 * kz], 0.045, 8, CHROME, true);
      trim.tube([sx * 0.86 * kx, 1.16, 0.68 * kz], [sx * 0.86 * kx, 1.16, 0.69 * kz], 0.038, 8, LAMP, true);
    }
    matte.tube([0.30, 1.05, -2.10 * kz], [0.33, 1.72, -2.16 * kz], 0.006, 4, PLASTIC, true);
  }
  return wheels;
}

/**
 * A tall painted volume -- the upper body of a van, a bus, a truck cab or a
 * cargo box -- lofted through a section with flat sides, a radiused roof edge
 * and a crowned roof, between two height curves over [z0, z1].
 *
 * Glazing goes ON this shell, a few millimetres proud, rather than being lofted
 * in glass: `buildGeneric` lofted a van's upper body as a glass tube and stood
 * slab boxes of glass off its sides, which is the "black sails" the van used to
 * wear. The shell's sides are exactly vertical up to `side` (y), so a pane
 * placed at `w0 + d` sits flat on them however the height curves change.
 */
function boxShell(into, cfg) {
  const {
    z0, z1, stations = 30, wAt, y0At, y1At, rr = 0.12, tumble = 0.03, crown = 0.02,
    capStart = false, capEnd = false, col = WHITE, windows = [], slope = null,
  } = cfg;
  const sec = (z) => {
    const w0 = wAt(z), y0 = y0At(z), y1 = Math.max(y0 + 0.02, y1At(z)), h = y1 - y0;
    const r = Math.min(rr, h * 0.2);
    return { w0, wT: w0 - Math.min(tumble, h * 0.03), y0, y1, h, r, side: y1 - r * 1.6 };
  };
  const half = (z, s) => {
    const g = sec(z);
    return [[s * g.w0, g.y0], [s * g.w0, g.side], [s * g.wT, g.y1 - g.r],
      [s * (g.wT - g.r * 0.3), g.y1 - g.r * 0.3], [s * (g.wT - g.r), g.y1], [s * g.wT * 0.35, g.y1 + crown]];
  };
  // Openings. The glass on a shell used to be laid over unbroken paint, which
  // was fine while glass was opaque; see-through, every van and bus window
  // showed its own body colour. `windows` are the `sideGlass` calls that will
  // glaze this shell ({ sx, zA, zB, yBot, yTopMax, cols }; yTopMax may be a
  // function of `sec`), `slope` the `slopeGlass` one ({ zA, zB, rows }). Their
  // stations become ring stations, so every hole edge is a ring edge and
  // nothing is left half-covered behind the glass.
  const zSet = [];
  for (let i = 0; i <= stations; i++) zSet.push(z0 + ((z1 - z0) * i) / stations);
  const wins = windows.map((w) => ({
    ...w, cols: w.cols || 6, lo: Math.min(w.zA, w.zB), hi: Math.max(w.zA, w.zB),
    top: typeof w.yTopMax === 'function' ? w.yTopMax(sec) : w.yTopMax,
  }));
  for (const w of wins) for (let j = 0; j <= w.cols; j++) zSet.push(w.zA + ((w.zB - w.zA) * j) / w.cols);
  const sl = slope && { ...slope, rows: slope.rows || 4, lo: Math.min(slope.zA, slope.zB), hi: Math.max(slope.zA, slope.zB) };
  if (sl) for (let i = 0; i <= sl.rows; i++) zSet.push(sl.zA + ((sl.zB - sl.zA) * i) / sl.rows);
  zSet.sort((a, b) => (z1 > z0 ? a - b : b - a));
  const zs = zSet.filter((z, i) => i === 0 || Math.abs(z - zSet[i - 1]) > 1e-4);
  const rings = zs.map((z) => ({ z, pts: [...half(z, -1), ...half(z, 1).reverse()] }));
  const within = (o, za, zb) => Math.min(za, zb) >= o.lo - 1e-4 && Math.max(za, zb) <= o.hi + 1e-4;
  // Ring points run L0..L5 then R5..R0: segment 0 is the left flat side, 10
  // the right, and 4..6 the top between the roof radii.
  const sideWin = (i, sx) => wins.find((w) => w.sx === sx && within(w, rings[i].z, rings[i + 1].z));
  const skip = (i, k) => (k === 0 && !!sideWin(i, -1)) || (k === 10 && !!sideWin(i, 1))
    || (!!sl && k >= 4 && k <= 6 && within(sl, rings[i].z, rings[i + 1].z));
  into.loft(rings, col, { capStart, capEnd, skip: wins.length || sl ? skip : null });
  const UV = [0, 0, 1, 0, 1, 1, 0, 1];
  for (let i = 0; i < rings.length - 1; i++) {
    const za = rings[i].z, zb = rings[i + 1].z, ga = sec(za), gb = sec(zb);
    for (const sx of [-1, 1]) {
      const w = sideWin(i, sx);
      if (!w) continue;
      // The same top edge sideGlass draws, so pane and hole agree.
      const yt = (g) => Math.max(w.yBot + 0.002, Math.min(w.top, g.side - 0.035));
      const xa = sx * ga.w0, xb = sx * gb.w0;
      if (w.yBot - Math.min(ga.y0, gb.y0) > 1e-3) into.quad([xa, ga.y0, za], [xb, gb.y0, zb], [xb, w.yBot, zb], [xa, w.yBot, za], [sx, 0, 0], UV, col);
      if (ga.side - yt(ga) > 1e-3 || gb.side - yt(gb) > 1e-3) {
        into.quad([xa, yt(ga), za], [xb, yt(gb), zb], [xb, gb.side, zb], [xa, ga.side, za], [sx, 0, 0], UV, col);
      }
    }
    if (sl && within(sl, za, zb)) {
      // slopeGlass spans 93 % of the flat top; paint the last 7 % to the radius.
      for (const s of [-1, 1]) {
        const edge = (g) => {
          const ax = (g.wT - g.r) * 0.93, flat = g.wT * 0.35;
          return [s * ax, g.y1 + crown * (1 - (ax - flat) / (g.wT - g.r - flat))];
        };
        const ea = edge(ga), eb = edge(gb);
        const A = [s * (ga.wT - ga.r), ga.y1, za], B = [s * (gb.wT - gb.r), gb.y1, zb], C = [eb[0], eb[1], zb], D = [ea[0], ea[1], za];
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
        let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const l = Math.hypot(...n) || 1;
        n = n.map((c) => (c / l) * (n[1] < 0 ? -1 : 1));
        into.quad(A, B, C, D, n, UV, col);
      }
    }
  }
  return {
    sec, half, crown,
    /** The section as [[y, halfWidth], ...] ascending, for `endFace`. */
    prof: (z) => half(z, 1).map(([x, y]) => [y, x]),
  };
}

/** A pane laid flat on a `boxShell`'s side between two stations. */
function sideGlass(trim, shell, sx, zA, zB, yBot, yTopMax, d = 0.007, cols = 6) {
  const bot = [], top = [];
  for (let j = 0; j <= cols; j++) {
    const z = zA + ((zB - zA) * j) / cols, g = shell.sec(z);
    const yt = Math.max(yBot + 0.002, Math.min(yTopMax, g.side - 0.035));
    bot.push([sx * (g.w0 + d), yBot, z]);
    top.push([sx * (g.w0 + d), yt, z]);
  }
  trim.patch([bot, top], GLASS, [sx, 0, 0]);
}

/**
 * The panel van: a short sloping bonnet, a windscreen raked straight into a
 * tall painted box, a sliding door, and rear doors with their own glass. The
 * lower body is `bodyCore` (so it has real arches and fascias); everything
 * above the beltline is one `boxShell` whose roof line comes down the
 * windscreen to the cowl, which is what gives a van its side outline -- the
 * cab sides follow the screen, they do not stop square.
 */
function buildVan(spec, paint, trim, matte) {
  const wr = spec.wheelR, roofY = spec.roof;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 1.70, zR = -1.80;                 // 3.50 m wheelbase, 93 cm front overhang
  const halfW = curve([[tail, 0.96], [-2.40, 0.99], [zR, 1.00], [0, 0.99], [zF, 1.00], [2.25, 0.97], [nose, 0.90]]);
  const sillY = curve([[tail, 0.50], [-2.35, 0.42], [-1.00, 0.38], [1.00, 0.38], [2.30, 0.42], [nose, 0.46]]);
  const beltY = curve([[tail, 1.12], [-1.00, 1.12], [1.00, 1.12], [1.50, 1.115], [1.95, 1.07], [2.35, 0.99], [nose, 0.93]]);
  const core = bodyCore(spec, paint, matte, {
    halfW, sillY, beltY, zF, zR,
    tuckAt: curve([[tail, 0.95], [zR, 0.98], [0, 0.95], [zF, 0.98], [nose, 0.95]]),
    topAt: curve([[tail, 0.98], [1.40, 0.98], [1.95, 0.95], [2.35, 0.88], [nose, 0.80]]),
    archR: 0.58, archGap: 0.07, archPow: 2.4, creaseAt: 0.45, tumble: 0.985,
    deckDrop: 0.020, lipOut: 0.030, endRound: 0.10, endMin: 0.94,
  });
  const { geom, endProf } = core;
  const tw = 0.235;
  const wx = geom(zF).wb - tw / 2 + 0.02, wxR = geom(zR).wb - tw / 2 + 0.02;
  const wheels = [[-wx, wr, zF, wr, tw], [wx, wr, zF, wr, tw], [-wxR, wr, zR, wr, tw], [wxR, wr, zR, wr, tw]];

  // --- upper body ----------------------------------------------------------
  const cowlZ = 1.62;
  const shell = boxShell(paint, {
    z0: tail, z1: cowlZ, stations: 34, rr: 0.14, tumble: 0.035, crown: 0.03, capEnd: true,
    wAt: (z) => geom(z).tw,
    y0At: (z) => beltY(z) - 0.03,
    // Level roof, then a curve down the screen that meets the bonnet tangent.
    y1At: curve([[tail, roofY - 0.03], [tail + 0.18, roofY], [0.80, roofY], [1.00, roofY - 0.05], [cowlZ, beltY(cowlZ) + 0.03]]),
    windows: [-1, 1].map((sx) => ({ sx, zA: 0.46, zB: 1.50, yBot: beltY(1.0) + 0.06, yTopMax: roofY - 0.30 })),
    slope: { zA: 1.54, zB: 1.04 },
  });

  // Windscreen, laid on the shell's sloping top between the two corners.
  slopeGlass(trim, shell, 1.54, 1.04);
  // Cab: the floor at the belt, a bulkhead behind the seats closing off the
  // cargo box (whose inside you would otherwise see straight through), and a
  // headliner under the level roof.
  boxCabin(matte, { y: beltY(1.0) + 0.01, sit: 1.50, x: shell.sec(1.0).w0 - 0.06, zR: 0.26, zF: 1.46, top: roofY - 0.07,
    hzF: 0.96, rows: [0.52], wheelDz: 0.62 });

  for (const sx of [-1, 1]) {
    sideGlass(trim, shell, sx, 0.46, 1.50, beltY(1.0) + 0.06, roofY - 0.30);
    // B-pillar and sliding-door shut lines, lower body and upper, and the
    // door's track along the waist behind it.
    for (const zc of [0.40, -0.92]) {
      shutLine(core, matte, sx, zc);
      const g = shell.sec(zc);
      matte.box(sx * (g.w0 + 0.004), g.y0 + 0.03, zc, 0.010, g.side - g.y0 - 0.06, 0.016, 0, [0.13, 0.14, 0.15]);
    }
    const gT = shell.sec(-1.6);
    matte.box(sx * (gT.w0 + 0.006), roofY - 0.40, -1.75, 0.014, 0.028, 1.70, 0, [0.12, 0.13, 0.14]);
    for (const zc of [0.30, -0.80]) matte.box(sx * (geom(zc).w + 0.006), 1.02, zc, 0.012, 0.030, 0.16, 0, PLASTIC);   // handles
    // Black rubbing strip down the lower body, between the arches.
    matte.box(sx * (geom(0).w + 0.006), 0.64, (zF + zR) / 2, 0.020, 0.10, (zF - zR) - 1.30, 0, PLASTIC);
    // Commercial mirror on a black arm off the A-pillar.
    const mz = 1.46, bx = geom(mz).tw;
    matte.tube([sx * bx, 1.22, mz], [sx * (bx + 0.20), 1.34, mz + 0.03], 0.022, 6, PLASTIC, true);
    matte.box(sx * (bx + 0.25), 1.10, mz + 0.03, 0.080, 0.34, 0.12, 0, PLASTIC);
    trim.box(sx * (bx + 0.25), 1.12, mz - 0.034, 0.060, 0.30, 0.012, 0, MIRROR);
    trim.box(sx * (geom(2.30).w + 0.004), 0.86, 2.30, 0.010, 0.030, 0.08, 0, AMBER);
  }

  // --- front --------------------------------------------------------------------
  const yN = sillY(nose);
  const GRILLE = [0, yN + 0.230, 0.420, 0.100], LAMP_A = [0.630, yN + 0.345, 0.155, 0.060];
  const INTAKE = [0, yN + 0.070, 0.440, 0.040];
  endFace(paint, nose, 1, endProf(nose), [GRILLE, LAMP_A, INTAKE], WHITE);
  const gp = pocket(paint, matte, 0, GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.12, 1, { rim: 0.026, rimCol: PLASTIC });
  for (let i = 0; i < 3; i++) trim.box(0, GRILLE[1] - 0.070 + i * 0.060, gp.z + 0.02, gp.hw * 1.92, 0.020, 0.04, 0, CHROME);
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.09, 1, { rim: 0.018, rimCol: PLASTIC });
    trim.box(sx * LAMP_A[0], LAMP_A[1] - 0.046, nose - 0.028, hp.hw * 1.9, 0.092, 0.022, 0, LAMP);
    headlampWrap(core, trim, sx, nose, 0.16);
  }
  pocket(paint, matte, 0, INTAKE[1], nose, INTAKE[2], INTAKE[3], 0.08, 1, { rim: 0.02, rimCol: PLASTIC });
  matte.box(0, yN - 0.06, nose - 0.06, geom(nose - 0.06).wb * 1.96, 0.13, 0.16, 0, PLASTIC);    // bumper
  trim.box(0, yN + 0.130, nose + 0.024, 0.40, 0.11, 0.02, 0, PLATE);

  // --- rear: two doors, each with its own glass -------------------------------
  const yT = sillY(tail);
  const TAILA = [0.820, yT + 0.420, 0.065, 0.170], TPLATE = [0, yT + 0.250, 0.230, 0.070];
  endFace(paint, tail, -1, endProf(tail), [TAILA, TPLATE], WHITE);
  const RW = [0.42, roofY - 0.52, 0.30, 0.22];
  endFace(paint, tail, -1, shell.prof(tail), [RW], WHITE);
  for (const sx of [-1, 1]) {
    const tp = pocket(paint, matte, sx * TAILA[0], TAILA[1], tail, TAILA[2], TAILA[3], 0.05, -1, { rim: 0.016, rimCol: PLASTIC });
    trim.box(sx * TAILA[0], TAILA[1] - tp.hh * 0.95, tail + 0.016, tp.hw * 1.9, tp.hh * 1.9, 0.020, 0, TAILC);
    const wp = pocket(paint, matte, sx * RW[0], RW[1], tail, RW[2], RW[3], 0.03, -1, { rim: 0.020, rimCol: PLASTIC });
    trim.box(sx * RW[0], RW[1] - wp.hh, tail + 0.012, wp.hw * 2, wp.hh * 2, 0.010, 0, GLASS);
    trim.box(sx * 0.10, roofY - 1.05, tail - 0.020, 0.030, 0.16, 0.030, 0, CHROME);   // door handles
  }
  matte.box(0, yT + 0.05, tail - 0.005, 0.014, roofY - yT - 0.18, 0.012, 0, [0.12, 0.13, 0.14]);   // door split
  pocket(paint, matte, 0, TPLATE[1], tail, TPLATE[2], TPLATE[3], 0.04, -1, { rim: 0.016, rimCol: PLASTIC });
  trim.box(0, TPLATE[1] - 0.062, tail - 0.022, 0.40, 0.12, 0.02, 0, PLATE);
  matte.box(0, yT - 0.06, tail + 0.06, geom(tail + 0.06).wb * 1.96, 0.14, 0.16, 0, PLASTIC);    // step bumper
  trim.box(0, roofY - 0.070, tail - 0.012, 0.26, 0.030, 0.02, 0, TAILC);                         // high stop lamp
  return wheels;
}

/** Windscreen laid on a `boxShell`'s sloping top, from station zA (low) to zB (high). */
function slopeGlass(trim, shell, zA, zB, rows = 4) {
  const scr = [];
  for (let i = 0; i <= rows; i++) {
    const z = zA + ((zB - zA) * i) / rows, g = shell.sec(z);
    const slope = (shell.sec(z + 0.01).y1 - shell.sec(z - 0.01).y1) / 0.02;
    const nl = Math.hypot(1, slope), ny = 1 / nl, nz = -slope / nl;
    const row = [];
    for (let j = 0; j <= 8; j++) {
      const u = -1 + (2 * j) / 8, x = u * (g.wT - g.r) * 0.93, ax = Math.abs(x);
      const flat = g.wT * 0.35;
      const y = ax <= flat ? g.y1 + shell.crown : g.y1 + shell.crown * (1 - (ax - flat) / (g.wT - g.r - flat));
      row.push([x, y + ny * 0.008, z + nz * 0.008]);
    }
    scr.push(row);
  }
  trim.patch(scr, GLASS, [0, 0.6, 1]);
}

/** Squared wheel-arch opening as a height over z, for a `boxShell`'s bottom edge. */
function archCut(zs, archR, archTop, pow = 3) {
  const shape = (u) => (1 - Math.abs(u) ** pow) ** (1 / pow);
  return (z) => {
    let l = 0;
    for (const az of zs) {
      const d = Math.abs(z - az);
      if (d < archR) l = Math.max(l, archTop * shape(d / archR));
    }
    return l;
  };
}

/** Dark well behind a `boxShell` arch, and a black flare round its edge. */
function shellArch(matte, shell, zc, wr, archR, archTop, floor) {
  for (const sx of [-1, 1]) {
    const w = shell.sec(zc).w0;
    matte.box(sx * (w - 0.17), wr * 0.85, zc, 0.30, archTop - wr * 0.85 - 0.012, archR * 1.85, 0, CAVITY);
    const lipA = [], lipB = [];
    for (let i = 0; i <= 12; i++) {
      const th = 0.12 + ((Math.PI - 0.24) * i) / 12, z = zc + Math.cos(th) * archR * 0.995;
      const g = shell.sec(z), y = Math.max(floor, g.y0);
      lipA.push([sx * (g.w0 + 0.002), y, z]);
      lipB.push([sx * (g.w0 + 0.045), y - 0.018, z]);
    }
    matte.patch([lipA, lipB], PLASTIC, [sx, -0.3, 0]);
  }
}

/**
 * A commercial cab as one `boxShell`: flat sides with the front arch cut into
 * the bottom edge, and either a cab-over brow (the roof rolls down onto a flat
 * face) or a short bonnet (the roof line comes down a raked screen and along
 * the hood). The plan corners at the nose roll in, so the face is not a slab.
 */
function truckCab(paint, matte, o) {
  const { z0, z1, W, roofY, zF, wr, archR, sill, bonnet = null, windows = [], slope = null } = o;
  const archTop = wr * 2 + 0.07;
  const lift = archCut([zF], archR, archTop, 3.0);
  const k = (z) => 0.93 + 0.07 * Math.sqrt(clamp((z1 - z) / 0.22, 0, 1));
  const y1At = bonnet
    ? curve([[z0, roofY], [bonnet.scrTopZ, roofY], [bonnet.cowlZ, bonnet.cowlY], [z1 - 0.18, bonnet.noseY + 0.04], [z1, bonnet.noseY]])
    : curve([[z0, roofY], [z1 - 0.40, roofY], [z1, roofY - 0.16]]);
  const shell = boxShell(paint, {
    z0, z1, stations: 34, rr: 0.16, tumble: 0.05, crown: 0.04, capStart: true,
    wAt: (z) => W * k(z), y0At: (z) => Math.max(sill, lift(z)), y1At, windows, slope,
  });
  shellArch(matte, shell, zF, wr, archR, archTop, sill);
  return { shell, archTop };
}

/** Big flat commercial mirror on an arm reaching forward of the A-pillar. */
function truckMirror(trim, matte, sx, x, y, z) {
  matte.tube([sx * x, y, z - 0.10], [sx * (x + 0.22), y - 0.04, z + 0.12], 0.024, 6, PLASTIC, true);
  matte.tube([sx * (x + 0.22), y - 0.04, z + 0.12], [sx * (x + 0.22), y - 0.52, z + 0.12], 0.020, 6, PLASTIC, true);
  matte.box(sx * (x + 0.27), y - 0.58, z + 0.12, 0.085, 0.50, 0.14, 0, PLASTIC);
  trim.box(sx * (x + 0.27), y - 0.56, z + 0.046, 0.065, 0.46, 0.012, 0, MIRROR);
}

/**
 * The cab-over trucks: the box truck and the refuse truck, one cab on one
 * chassis carrying either a cargo box or a rear-loading packer body.
 *
 * `buildGeneric` gave these a car's bonnet and greenhouse on the front of a
 * 4 m slab, which is the shape of nothing on a road. An American city's
 * medium-duty box truck is a cab-over: a flat face with the windscreen high on
 * it, a roof brow, the front wheel UNDER the door, and a separate box behind a
 * visible gap, standing on a ladder chassis you can see daylight under.
 */
const TRUCK_LOOKS = {
  boxtruck: { ovF: 1.20, cabLen: 2.00, gap: 0.13, boxTop: 3.45, boxY: 1.12, packer: false },
  garbage: { ovF: 1.25, cabLen: 2.10, gap: 0.13, boxTop: 3.30, boxY: 1.15, packer: true },
};

function buildTruck(spec, paint, trim, matte, S) {
  const wr = spec.wheelR, W = spec.wid / 2, roofY = spec.roof;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = nose - S.ovF, zR = zF - spec.wheelbase;
  const cz0 = nose - S.cabLen, cabW = W * 0.95, archR = wr + 0.17;
  const { shell: cab } = truckCab(paint, matte, {
    z0: cz0, z1: nose, W: cabW, roofY, zF, wr, archR, sill: 0.56,
    windows: [-1, 1].map((sx) => ({ sx, zA: cz0 + 0.32, zB: nose - 0.30, yBot: 1.50, yTopMax: (sec) => sec(nose).side - 0.06 })),
  });
  const cs = cab.sec(nose);

  // --- face ---------------------------------------------------------------------
  const LAMP_A = [cs.w0 * 0.78, 0.84, 0.14, 0.07], GRILLE = [0, 1.06, cs.w0 * 0.46, 0.17];
  // The windscreen is a hole in the face now, not a pane on painted metal.
  const fw = cs.w0 - 0.12, zs = nose + 0.008, scrTop = cs.side - 0.05;
  const SCR = [0, (1.50 + scrTop) / 2, fw, (scrTop - 1.50) / 2];
  endFace(paint, nose, 1, cab.prof(nose), [GRILLE, LAMP_A, SCR], WHITE);
  const gp = pocket(paint, matte, 0, GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.14, 1, { rim: 0.030, rimCol: CHROME });
  for (let i = 0; i < 5; i++) trim.box(0, GRILLE[1] - GRILLE[3] + 0.04 + i * 0.056, gp.z + 0.02, gp.hw * 1.92, 0.018, 0.04, 0, [0.20, 0.21, 0.23]);
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.08, 1, { rim: 0.020, rimCol: PLASTIC });
    trim.box(sx * LAMP_A[0], LAMP_A[1] - 0.052, nose - 0.026, hp.hw * 1.9, 0.104, 0.022, 0, LAMP);
    trim.box(sx * (LAMP_A[0] - 0.22), LAMP_A[1] - 0.03, nose - 0.01, 0.06, 0.06, 0.03, 0, AMBER);
  }
  trim.patch([[[-fw, 1.50, zs], [0, 1.50, zs], [fw, 1.50, zs]],
    [[-fw, scrTop, zs], [0, scrTop, zs], [fw, scrTop, zs]]], GLASS, [0, 0, 1]);
  // Cab-over: you sit over the front wheel, the floor is at the glass line
  // and the back wall is the cab's own rear face.
  boxCabin(matte, { y: 1.44, sit: 1.62, x: cs.w0 - 0.10, zR: cz0 + 0.06, zF: nose - 0.06, top: roofY - 0.10,
    rows: [cz0 + 0.55], wheelDz: 0.72 });
  matte.box(0, 1.47, nose + 0.004, fw * 2 + 0.06, 0.035, 0.02, 0, PLASTIC);
  for (const x of [-0.55, 0.25]) matte.tube([x, 1.54, nose + 0.024], [x + 0.42, 1.64, nose + 0.024], 0.011, 4, PLASTIC, true);
  matte.box(0, 0.42, nose + 0.05, cabW * 1.98, 0.28, 0.16, 0, PLASTIC);                      // bumper
  trim.box(0, 0.47, nose + 0.135, 0.40, 0.12, 0.02, 0, PLATE);
  for (let i = -1; i <= 1; i++) trim.box(i * 0.26, roofY - 0.085, nose - 0.24, 0.09, 0.04, 0.06, 0, AMBER);   // cab markers

  // --- cab sides ----------------------------------------------------------------
  for (const sx of [-1, 1]) {
    sideGlass(trim, cab, sx, cz0 + 0.32, nose - 0.30, 1.50, cs.side - 0.06);
    for (const zc of [cz0 + 0.20, nose - 0.16]) {
      const g = cab.sec(zc);
      matte.box(sx * (g.w0 + 0.004), 0.90, zc, 0.010, g.side - 0.95, 0.016, 0, [0.13, 0.14, 0.15]);
    }
    trim.box(sx * (cab.sec(cz0 + 0.5).w0 + 0.01), 1.32, cz0 + 0.50, 0.02, 0.03, 0.18, 0, CHROME);   // handle
    truckMirror(trim, matte, sx, cs.w0 - 0.02, cs.side - 0.05, nose - 0.10);
  }

  // --- body -----------------------------------------------------------------------
  const bz1 = cz0 - S.gap, y0 = S.boxY;
  const y1At = S.packer ? curve([[tail, S.boxTop - 0.80], [tail + 1.20, S.boxTop], [bz1, S.boxTop]]) : () => S.boxTop;
  const body = boxShell(paint, {
    z0: tail, z1: bz1, stations: S.packer ? 22 : 10, rr: S.packer ? 0.16 : 0.05, tumble: 0.01, crown: 0.015,
    wAt: () => W, y0At: () => y0, y1At,
  });
  endFace(paint, bz1, 1, body.prof(bz1), [], WHITE);
  const post = [0.55, 0.56, 0.58];
  for (const sx of [-1, 1]) {
    trim.box(sx * (W + 0.008), y0, (tail + bz1) / 2, 0.02, 0.11, bz1 - tail, 0, post);            // bottom rail
    trim.box(sx * (geom0(body, bz1 - 0.05) + 0.004), y0 + 0.30, bz1 - 0.08, 0.014, 0.05, 0.08, 0, AMBER);
    trim.box(sx * (W + 0.004), y0 + 0.30, tail + 0.12, 0.014, 0.05, 0.08, 0, TAILC);
  }
  if (S.packer) {
    // Packer: vertical ribs down the body, a black hopper hanging under the
    // tail and the tailgate's rams, which together are most of what says
    // "garbage truck" in silhouette.
    for (const sx of [-1, 1]) {
      for (let zc = tail + 1.5; zc < bz1 - 0.3; zc += 0.80) {
        matte.box(sx * (W + 0.012), y0 + 0.12, zc, 0.024, S.boxTop - y0 - 0.30, 0.06, 0, [0.16, 0.17, 0.18]);
      }
      trim.tube([sx * (W + 0.03), y0 + 0.20, tail + 1.25], [sx * (W + 0.03), S.boxTop - 0.55, tail + 0.30], 0.055, 8, CHROME, true);
    }
    endFace(paint, tail, -1, body.prof(tail), [], WHITE);
    matte.box(0, 0.62, tail + 0.28, W * 1.94, 0.96, 0.62, 0, [0.12, 0.13, 0.14]);                 // hopper
    matte.box(0, 1.20, tail - 0.04, W * 1.60, 0.10, 0.06, 0, PLASTIC);
    for (const sx of [-1, 1]) {
      trim.box(sx * (W - 0.18), 0.92, tail - 0.034, 0.16, 0.12, 0.02, 0, TAILC);
      trim.box(sx * (W - 0.18), 0.80, tail - 0.034, 0.16, 0.06, 0.02, 0, AMBER);
    }
  } else {
    // Roll-up door set into the rear frame, with its slats.
    const DOOR = [0, (y0 + S.boxTop) / 2, W - 0.13, (S.boxTop - y0) / 2 - 0.14];
    endFace(paint, tail, -1, body.prof(tail), [DOOR], WHITE);
    const dp = pocket(trim, matte, 0, DOOR[1], tail, DOOR[2], DOOR[3], 0.04, -1, { rim: 0.05, rimCol: post });
    matte.box(0, DOOR[1] - dp.hh, tail + 0.015, dp.hw * 2, dp.hh * 2, 0.01, 0, [0.62, 0.63, 0.62]);
    for (let yy = DOOR[1] - dp.hh + 0.20; yy < DOOR[1] + dp.hh; yy += 0.20) {
      matte.box(0, yy, tail + 0.003, dp.hw * 1.98, 0.012, 0.012, 0, [0.40, 0.41, 0.41]);
    }
    trim.box(0, DOOR[1] - dp.hh + 0.10, tail - 0.01, 0.30, 0.04, 0.03, 0, CHROME);
    for (const sx of [-1, 1]) trim.box(sx * (W - 0.03), y0, tail + 0.03, 0.09, S.boxTop - y0, 0.09, 0, post);   // corner posts
  }

  // --- chassis ------------------------------------------------------------------
  matte.box(0, 0.96, (tail + bz1) / 2, W * 1.55, 0.16, bz1 - tail - 0.20, 0, PLASTIC);   // subframe
  for (const sx of [-1, 1]) matte.box(sx * 0.46, 0.72, (cz0 + tail) / 2 + 0.3, 0.14, 0.26, cz0 - tail - 0.2, 0, PLASTIC);
  trim.tube([-0.84, 0.64, zF - archR - 0.35], [-0.84, 0.64, zF - archR - 1.05], 0.23, 10, [0.72, 0.74, 0.77], true);   // tank
  matte.box(0.84, 0.46, zF - archR - 0.60, 0.40, 0.36, 0.60, 0, PLASTIC);                                             // battery box
  if (!S.packer) {
    matte.box(0, 0.48, tail + 0.14, W * 1.70, 0.12, 0.08, 0, PLASTIC);                          // underride bar
    for (const sx of [-1, 1]) {
      matte.box(sx * 0.62, 0.58, tail + 0.18, 0.08, 0.40, 0.06, 0, PLASTIC);
      trim.box(sx * 0.72, 0.52, tail + 0.095, 0.16, 0.06, 0.02, 0, TAILC);
    }
    trim.box(0, 0.64, tail + 0.20, 0.40, 0.12, 0.02, 0, PLATE);
  }
  const twF = 0.30, twR = 0.44;
  const wxF = cab.sec(zF).w0 - 0.17, wxR = W - 0.26;
  for (const sx of [-1, 1]) {
    matte.box(sx * wxR, wr * 2 + 0.03, zR, twR + 0.08, 0.04, wr * 2.3, 0, PLASTIC);               // guard
    matte.box(sx * wxR, 0.20, zR - wr - 0.22, twR, 0.60, 0.02, 0, PLASTIC);                        // mud flap
  }
  return [[-wxF, wr, zF, wr, twF], [wxF, wr, zF, wr, twF], [-wxR, wr, zR, wr, twR], [wxR, wr, zR, wr, twR]];
}

/** Half-width of a `boxShell` at a station. */
function geom0(shell, z) { return shell.sec(z).w0; }

/**
 * Type III ambulance: a bonneted van cab with a tall square module behind it.
 * The module is wider and taller than the cab and carries its own arch, a red
 * band and a light at every corner -- the corners are what a player reads at a
 * distance, and the one old version had was a bar on top of a box truck.
 */
function buildAmbulance(spec, paint, trim, matte) {
  const wr = spec.wheelR, W = spec.wid / 2;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = nose - 1.05, zR = zF - spec.wheelbase;
  const cabW = 1.00, modTop = 2.80, modZ1 = 0.66;
  const { shell: cab } = truckCab(paint, matte, {
    z0: 0.62, z1: nose, W: cabW, roofY: spec.roof, zF, wr, archR: wr + 0.16, sill: 0.50,
    bonnet: { scrTopZ: 1.30, cowlZ: 2.00, cowlY: 1.28, noseY: 1.08 },
    windows: [-1, 1].map((sx) => ({ sx, zA: 0.84, zB: 1.86, yBot: 1.38, yTopMax: spec.roof - 0.26 })),
    slope: { zA: 1.92, zB: 1.36 },
  });
  slopeGlass(trim, cab, 1.92, 1.36);
  boxCabin(matte, { y: 1.30, sit: 1.52, x: cab.sec(1.2).w0 - 0.07, zR: 0.70, zF: 1.86, top: spec.roof - 0.08,
    hzF: 1.32, rows: [0.92], wheelDz: 0.60 });
  const cs = cab.sec(nose);
  const GRILLE = [0, 0.82, 0.36, 0.12], LAMP_A = [cs.w0 * 0.76, 0.90, 0.13, 0.055];
  endFace(paint, nose, 1, cab.prof(nose), [GRILLE, LAMP_A], WHITE);
  const gp = pocket(paint, matte, 0, GRILLE[1], nose, GRILLE[2], GRILLE[3], 0.12, 1, { rim: 0.026, rimCol: CHROME });
  for (let i = 0; i < 3; i++) trim.box(0, GRILLE[1] - 0.08 + i * 0.07, gp.z + 0.02, gp.hw * 1.92, 0.020, 0.04, 0, CHROME);
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.08, 1, { rim: 0.018, rimCol: PLASTIC });
    trim.box(sx * LAMP_A[0], LAMP_A[1] - 0.042, nose - 0.026, hp.hw * 1.9, 0.084, 0.022, 0, LAMP);
    trim.box(sx * 0.20, 0.64, nose + 0.012, 0.10, 0.05, 0.02, 0, TAILC);                          // grille strobes
  }
  matte.box(0, 0.40, nose + 0.05, cabW * 1.96, 0.22, 0.16, 0, PLASTIC);
  trim.box(0, 0.44, nose + 0.135, 0.40, 0.12, 0.02, 0, PLATE);
  const RED = [0.70, 0.06, 0.05];
  for (const sx of [-1, 1]) {
    sideGlass(trim, cab, sx, 0.84, 1.86, 1.38, spec.roof - 0.26);
    const g = cab.sec(1.3);
    matte.quad([sx * (g.w0 + 0.005), 1.14, 0.70], [sx * (g.w0 + 0.005), 1.14, 1.56], [sx * (g.w0 + 0.005), 1.26, 1.56],
      [sx * (g.w0 + 0.005), 1.26, 0.70], [sx, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], RED);
    truckMirror(trim, matte, sx, cab.sec(1.9).w0 - 0.02, 1.62, 1.80);
  }

  // --- module ---------------------------------------------------------------------
  const archTopR = wr * 2 + 0.08, archRR = wr + 0.16;
  const liftR = archCut([zR], archRR, archTopR, 3.0);
  const mod = boxShell(paint, {
    z0: tail, z1: modZ1, stations: 22, rr: 0.08, tumble: 0.012, crown: 0.015,
    wAt: () => W, y0At: (z) => Math.max(0.60, liftR(z)), y1At: () => modTop,
  });
  shellArch(matte, mod, zR, wr, archRR, archTopR, 0.60);
  endFace(paint, modZ1, 1, mod.prof(modZ1), [], WHITE);
  const RW = [0.42, 2.12, 0.24, 0.20], TL = [W - 0.15, 1.24, 0.065, 0.17];
  endFace(paint, tail, -1, mod.prof(tail), [RW, TL], WHITE);
  for (const sx of [-1, 1]) {
    const wp = pocket(paint, matte, sx * RW[0], RW[1], tail, RW[2], RW[3], 0.03, -1, { rim: 0.02, rimCol: PLASTIC });
    trim.box(sx * RW[0], RW[1] - wp.hh, tail + 0.012, wp.hw * 2, wp.hh * 2, 0.010, 0, GLASS);
    const tp = pocket(paint, matte, sx * TL[0], TL[1], tail, TL[2], TL[3], 0.04, -1, { rim: 0.016, rimCol: PLASTIC });
    trim.box(sx * TL[0], TL[1] - tp.hh * 0.95, tail + 0.014, tp.hw * 1.9, tp.hh * 1.9, 0.020, 0, TAILC);
    // Red band the length of the module, and the corner beacons.
    matte.quad([sx * (W + 0.005), 1.42, tail + 0.05], [sx * (W + 0.005), 1.42, modZ1 - 0.05], [sx * (W + 0.005), 1.64, modZ1 - 0.05],
      [sx * (W + 0.005), 1.64, tail + 0.05], [sx, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], RED);
    for (const zc of [modZ1 - 0.12, tail + 0.12]) {
      trim.box(sx * (W - 0.12), modTop - 0.16, zc, 0.20, 0.13, 0.09, 0, TAILC);
    }
    trim.box(sx * (W - 0.40), modTop - 0.14, modZ1 - 0.11, 0.20, 0.10, 0.08, 0, LAMP);
  }
  matte.quad([-(W - 0.08), 1.42, tail - 0.005], [W - 0.08, 1.42, tail - 0.005], [W - 0.08, 1.64, tail - 0.005],
    [-(W - 0.08), 1.64, tail - 0.005], [0, 0, -1], [0, 0, 1, 0, 1, 1, 0, 1], RED);
  matte.box(0, 0.62, tail - 0.004, 0.014, modTop - 0.75, 0.012, 0, [0.12, 0.13, 0.14]);          // door split
  matte.box(0, 0.44, tail + 0.05, W * 1.80, 0.16, 0.20, 0, PLASTIC);                                // step bumper
  trim.box(0, 0.70, tail - 0.024, 0.40, 0.12, 0.02, 0, PLATE);
  matte.box(0, 0.62, (0.62 + nose - 1.6) / 2, 0.9, 0.22, 1.2, 0, PLASTIC);                          // chassis under the cab

  const twF = 0.26, twR = 0.36;
  const wxF = cab.sec(zF).w0 - 0.15, wxR = W - 0.22;
  return [[-wxF, wr, zF, wr, twF], [wxF, wr, zF, wr, twF], [-wxR, wr, zR, wr, twR], [wxR, wr, zR, wr, twR]];
}

/**
 * The low-floor city bus. What it replaced was the generic tube at twelve
 * metres with glass boxes standing off its sides and its windscreen mirrors
 * as two slabs sticking out of the roof corners.
 *
 * The lower body is `bodyCore` (squared arches, sill low enough for a kneeling
 * floor), the upper is a `boxShell` with rounded brows front and rear, and the
 * glazing is a band laid flat on the side, broken by pillars. Doors are on the
 * KERB side, which is -x: traffic drives on the right and `laneOffset` puts a
 * vehicle heading +z at -x of the centreline.
 */
function buildBus(spec, paint, trim, matte) {
  const wr = spec.wheelR, roofY = spec.roof;
  const nose = spec.len / 2, tail = -spec.len / 2;
  const zF = 3.45, zR = -2.55;                 // 2.55 m front overhang, 3.45 m rear
  const belt = 1.20;
  const core = bodyCore(spec, paint, matte, {
    halfW: curve([[tail, 0.975], [-5.6, 1.0], [5.6, 1.0], [nose, 0.975]]),
    sillY: curve([[tail, 0.52], [-5.4, 0.42], [5.4, 0.42], [nose, 0.46]]),
    beltY: () => belt, tuckAt: () => 0.97, topAt: () => 0.99, zF, zR,
    archR: 0.66, archGap: 0.06, archPow: 3.2, creaseAt: 0.40, tumble: 0.99, deckDrop: 0.010, lipOut: 0.030,
    endRound: 0.12, endMin: 0.96, stations: 64,
  });
  const { geom, endProf } = core;
  const rk = (z) => 0.95 + 0.05 * Math.sqrt(clamp(Math.min(nose - z, z - tail) / 0.30, 0, 1));
  // The window band and the kerb-side doors, worked out before the shell so
  // it can be built with the openings in it (see boxShell).
  const winY0 = belt + 0.10, winY1 = roofY - 0.52;
  const DOORS = [[4.45, 5.55], [-0.60, 0.60]];
  const spansOf = (sx) => {
    const cuts = sx < 0 ? DOORS : [], spans = [];
    let z = tail + 1.70;
    for (const [a, b] of [...cuts].sort((p, q) => p[0] - q[0])) { spans.push([z, a - 0.05]); z = b + 0.05; }
    spans.push([z, nose - 0.35]);
    return { cuts, spans };
  };
  const windows = [];
  for (const sx of [-1, 1]) {
    const { cuts, spans } = spansOf(sx);
    for (const [a, b] of spans) windows.push({ sx, zA: a, zB: b, yBot: winY0, yTopMax: winY1, cols: 2 });
    for (const [a, b] of cuts) windows.push({ sx, zA: a, zB: b, yBot: belt - 0.03, yTopMax: winY1, cols: 1 });
  }
  const shell = boxShell(paint, {
    z0: tail, z1: nose, stations: 48, rr: 0.22, tumble: 0.04, crown: 0.05,
    wAt: (z) => geom(z).tw * rk(z), y0At: () => belt - 0.03,
    y1At: curve([[tail, roofY - 0.10], [tail + 0.35, roofY], [nose - 0.45, roofY], [nose, roofY - 0.12]]),
    windows,
  });
  const sN = shell.sec(nose);
  const scrTop = sN.side - 0.03;
  endFace(paint, nose, 1, shell.prof(nose), [[0, (sN.y0 + scrTop) / 2 + 0.001, sN.w0 - 0.10, (scrTop - sN.y0) / 2]], WHITE);
  const LAMP_A = [0.90, 0.68, 0.17, 0.075];
  endFace(paint, nose, 1, endProf(nose), [LAMP_A], WHITE);
  for (const sx of [-1, 1]) {
    const hp = pocket(paint, matte, sx * LAMP_A[0], LAMP_A[1], nose, LAMP_A[2], LAMP_A[3], 0.07, 1, { rim: 0.02, rimCol: PLASTIC });
    trim.box(sx * LAMP_A[0], LAMP_A[1] - 0.05, nose - 0.02, hp.hw * 1.9, 0.10, 0.02, 0, LAMP);
  }
  // Windscreen: one tall pane from bumper height to the destination sign.
  const fw = sN.w0 - 0.10, zs = nose + 0.008;
  trim.patch([[[-fw, 0.98, zs], [0, 0.98, zs], [fw, 0.98, zs]],
    [[-fw, sN.side - 0.03, zs], [0, sN.side - 0.03, zs], [fw, sN.side - 0.03, zs]]], GLASS, [0, 0, 1]);
  // Its foot runs down over the lower body's nose, which stays solid: back
  // that strip in the dark of the dash rather than the livery.
  matte.quad([-fw, 0.98, nose + 0.004], [fw, 0.98, nose + 0.004], [fw, sN.y0 + 0.002, nose + 0.004], [-fw, sN.y0 + 0.002, nose + 0.004],
    [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], CAB_DASH);
  busCabin(matte, shell, { belt, nose, tail, roofY });
  matte.box(0, sN.side - 0.02, nose + 0.004, fw * 2 + 0.08, 0.26, 0.03, 0, [0.04, 0.04, 0.045]);      // sign housing
  trim.box(0, sN.side + 0.07, nose + 0.018, 1.30, 0.08, 0.012, 0, [1.0, 0.62, 0.12]);                 // route display
  for (const x of [-0.70, 0.30]) matte.tube([x, 1.02, nose + 0.024], [x + 0.46, 1.36, nose + 0.024], 0.012, 4, PLASTIC, true);
  matte.box(0, 0.26, nose + 0.03, geom(nose).w * 1.92, 0.26, 0.16, 0, PLASTIC);                        // bumper
  trim.box(0, 0.30, nose + 0.115, 0.40, 0.12, 0.02, 0, PLATE);
  // Folded bike rack on the nose -- the detail every Seattle bus carries.
  for (const sx of [-1, 1]) matte.tube([sx * 0.42, 0.40, nose + 0.12], [sx * 0.42, 0.92, nose + 0.12], 0.020, 5, PLASTIC, true);
  matte.tube([-0.42, 0.92, nose + 0.12], [0.42, 0.92, nose + 0.12], 0.020, 5, PLASTIC, true);
  matte.tube([-0.42, 0.66, nose + 0.12], [0.42, 0.66, nose + 0.12], 0.016, 5, PLASTIC, true);
  for (const sx of [-1, 1]) {
    matte.tube([sx * (sN.w0 - 0.05), sN.side - 0.10, nose - 0.20], [sx * (sN.w0 + 0.16), sN.side - 0.02, nose + 0.32], 0.024, 6, PLASTIC, true);
    matte.box(sx * (sN.w0 + 0.16), sN.side - 0.62, nose + 0.32, 0.10, 0.58, 0.16, 0, PLASTIC);
    trim.box(sx * (sN.w0 + 0.16), sN.side - 0.60, nose + 0.235, 0.08, 0.54, 0.012, 0, MIRROR);
  }

  // --- sides: window band, doors on the kerb side ---------------------------------
  const BAND = [0.05, 0.30, 0.24];
  for (const sx of [-1, 1]) {
    const { cuts, spans } = spansOf(sx);
    for (const [a, b] of spans) {
      sideGlass(trim, shell, sx, a, b, winY0, winY1, 0.007, 2);
      const g = shell.sec((a + b) / 2);
      matte.quad([sx * (g.w0 + 0.006), belt - 0.02, a], [sx * (g.w0 + 0.006), belt - 0.02, b], [sx * (g.w0 + 0.006), belt + 0.07, b],
        [sx * (g.w0 + 0.006), belt + 0.07, a], [sx, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], BAND);
      for (let pz = a + 1.25; pz < b - 0.3; pz += 1.25) {
        matte.box(sx * (g.w0 + 0.012), winY0, pz, 0.010, winY1 - winY0, 0.07, 0, [0.07, 0.075, 0.08]);
      }
    }
    for (const [a, b] of cuts) {
      // Glass doors to the kerb, set in the body line with a centre split.
      const w = geom((a + b) / 2).w + 0.008;
      trim.patch([[[sx * w, 0.46, a], [sx * w, 0.46, b]], [[sx * w, winY1, a], [sx * w, winY1, b]]], GLASS, [sx, 0, 0]);
      // Below the shell the door glass is over the lower body's paint: back it
      // with the dark of the stairwell instead.
      matte.quad([sx * (w - 0.004), 0.46, a], [sx * (w - 0.004), 0.46, b], [sx * (w - 0.004), belt, b], [sx * (w - 0.004), belt, a],
        [sx, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], CAB_FLOOR);
      for (const zc of [a, (a + b) / 2, b]) matte.box(sx * (w + 0.004), 0.44, zc, 0.012, winY1 - 0.42, 0.05, 0, [0.07, 0.075, 0.08]);
      matte.box(sx * (w + 0.004), winY1, (a + b) / 2, 0.012, 0.05, b - a, 0, [0.07, 0.075, 0.08]);
    }
    // Engine-bay louvres behind the last window, street side only.
    if (sx > 0) for (let i = 0; i < 5; i++) matte.box(sx * (geom(tail + 0.9).w + 0.006), 0.62 + i * 0.07, tail + 0.90, 0.01, 0.025, 1.10, 0, [0.10, 0.11, 0.12]);
    trim.box(sx * (geom(zF - 0.9).w + 0.004), 0.55, zF - 0.9, 0.012, 0.05, 0.10, 0, AMBER);
  }

  // --- rear -----------------------------------------------------------------------
  const TL = [1.02, 0.86, 0.08, 0.15];
  endFace(paint, tail, -1, endProf(tail), [TL], WHITE);
  const RW = [0, 2.20, 0.90, 0.36];
  endFace(paint, tail, -1, shell.prof(tail), [RW], WHITE);
  const wp = pocket(paint, matte, 0, RW[1], tail, RW[2], RW[3], 0.04, -1, { rim: 0.03, rimCol: PLASTIC });
  trim.box(0, RW[1] - wp.hh, tail + 0.012, wp.hw * 2, wp.hh * 2, 0.010, 0, GLASS);
  for (const sx of [-1, 1]) {
    const tp = pocket(paint, matte, sx * TL[0], TL[1], tail, TL[2], TL[3], 0.04, -1, { rim: 0.018, rimCol: PLASTIC });
    trim.box(sx * TL[0], TL[1] - tp.hh * 0.95, tail + 0.014, tp.hw * 1.9, tp.hh * 1.9, 0.020, 0, TAILC);
  }
  matte.box(0, 0.55, tail - 0.012, 1.40, 0.50, 0.02, 0, [0.10, 0.11, 0.12]);                           // engine grille
  matte.box(0, 0.26, tail - 0.03, geom(tail).w * 1.92, 0.24, 0.16, 0, PLASTIC);
  trim.box(0, 0.42, tail - 0.045, 0.40, 0.12, 0.02, 0, PLATE);

  // --- roof: air-conditioning pod ---------------------------------------------------
  paint.box(0, roofY + 0.02, -3.0, 1.70, 0.24, 2.80, 0, WHITE);
  matte.box(0, roofY + 0.26, -3.0, 1.20, 0.012, 2.00, 0, [0.20, 0.21, 0.22]);
  matte.box(0, roofY + 0.03, 3.9, 0.70, 0.06, 0.70, 0, [0.30, 0.31, 0.32]);                            // escape hatch

  const twF = 0.30, twR = 0.42;
  const wxF = geom(zF).wb - twF / 2 + 0.02, wxR = geom(zR).wb - twR / 2 + 0.02;
  return [[-wxF, wr, zF, wr, twF], [wxF, wr, zF, wr, twF], [-wxR, wr, zR, wr, twR], [wxR, wr, zR, wr, twR]];
}

/**
 * A personal watercraft. y = 0 is the waterline, like the boat's: a V-hull
 * lofted through seven stations, a flat deck with footwells either side of a
 * saddle, the hood over the engine, and the bars. Hull sides take the livery.
 */
function buildJetski(spec, paint, trim, matte) {
  //        z      hb    deckY chineX chineY keelY
  const S = [
    [-1.55, 0.52, 0.40, 0.50, -0.02, -0.12],
    [-1.00, 0.58, 0.44, 0.55, -0.04, -0.16],
    [-0.20, 0.60, 0.48, 0.56, -0.05, -0.18],
    [0.60, 0.55, 0.53, 0.50, -0.03, -0.16],
    [1.10, 0.44, 0.58, 0.38, 0.02, -0.10],
    [1.45, 0.26, 0.62, 0.20, 0.12, 0.02],
    [1.62, 0.05, 0.64, 0.03, 0.30, 0.24],
  ];
  const DARK = [0.10, 0.11, 0.12], SEAT = [0.12, 0.12, 0.14], STRIPE = [0.92, 0.92, 0.9];
  for (const sd of [-1, 1]) {
    // sides: chine to deck edge, in the livery
    paint.patch(S.map(([z, hb, dy, cx, cy]) => [[sd * cx, cy, z], [sd * hb, dy * 0.55 + cy * 0.45, z], [sd * hb, dy, z]]), WHITE, [sd, 0.2, 0]);
    // bottom: keel to chine
    matte.patch(S.map(([z, , , cx, cy, ky]) => [[0, ky, z], [sd * cx * 0.5, (ky + cy) / 2, z], [sd * cx, cy, z]]), DARK, [sd * 0.5, -1, 0]);
    // a white stripe along the upper side
    matte.patch(S.slice(0, 6).map(([z, hb, dy, , cy]) => [[sd * (hb + 0.004), dy * 0.75 + cy * 0.25, z], [sd * (hb + 0.004), dy * 0.62 + cy * 0.38, z]]), STRIPE, [sd, 0, 0]);
  }
  // transom
  {
    const [z, hb, dy, cx, cy, ky] = S[0];
    matte.patch([[[-cx, cy, z], [0, ky, z], [cx, cy, z]], [[-hb, dy, z], [0, dy, z], [hb, dy, z]]], DARK, [0, 0, -1]);
  }
  // deck, in the livery forward of the hood, dark non-slip in the footwells
  paint.patch(S.slice(3).map(([z, hb, dy]) => [[-hb, dy, z], [0, dy + 0.04, z], [hb, dy, z]]), WHITE, [0, 1, 0]);
  matte.patch(S.slice(0, 4).map(([z, hb, dy]) => [[-hb, dy, z], [0, dy, z], [hb, dy, z]]), [0.2, 0.21, 0.22], [0, 1, 0]);
  // saddle: a padded bolster on a narrow pedestal, not a crate
  matte.box(0, 0.40, -0.52, 0.30, 0.26, 1.16, 0, DARK);
  matte.tube([0, 0.70, -1.12], [0, 0.70, 0.02], 0.19, 10, SEAT, true);
  // the hood over the engine, lofted: tall behind the bars, sloping away to
  // the bow deck
  {
    const H = [[0.02, 0.30, 0.52, 0.80], [0.30, 0.31, 0.53, 0.82], [0.60, 0.29, 0.54, 0.74], [0.90, 0.24, 0.56, 0.64], [1.12, 0.14, 0.58, 0.60]];
    paint.patch(H.map(([z, w, dy, top]) => [[-w, dy, z], [-w * 0.72, dy + (top - dy) * 0.8, z], [0, top, z], [w * 0.72, dy + (top - dy) * 0.8, z], [w, dy, z]]), WHITE, [0, 1, 0]);
    const [z0, w0, d0, t0] = H[0];
    paint.patch([[[-w0, d0, z0], [0, d0, z0], [w0, d0, z0]], [[-w0 * 0.72, d0 + (t0 - d0) * 0.8, z0], [0, t0, z0], [w0 * 0.72, d0 + (t0 - d0) * 0.8, z0]]], WHITE, [0, 0, -1]);
  }
  // steering post and bars
  matte.tube([0, 0.78, 0.18], [0, 0.96, 0.22], 0.035, 6, DARK, true);
  matte.tube([-0.36, 0.98, 0.22], [0.36, 0.98, 0.22], 0.022, 6, DARK, true);
  for (const sd of [-1, 1]) matte.tube([sd * 0.26, 0.98, 0.22], [sd * 0.38, 0.98, 0.22], 0.032, 6, [0.05, 0.05, 0.05], true);
  // a small tinted screen on the hood, and the stern's grab handle
  trim.box(0, 0.88, 0.38, 0.34, 0.12, 0.03, 0, [0.12, 0.14, 0.16]);
  matte.tube([-0.2, 0.62, -1.42], [0.2, 0.62, -1.42], 0.018, 6, CHROME, true);
  return [];   // no wheels
}

/** Types with their own authored builder, keyed by `spec.hand`. */
const HAND_BUILT = {
  plane: buildPlane, twin: buildTwin, jet: buildJet, biplane: buildBiplane, heli: buildHeli, fighter: buildFighter,
  sports: buildSports, muscle: buildMuscle,
  sedan: buildSedan, suv: buildSuv, pickup: buildPickup,
  hatch: (s, p, t, m) => buildSmallCar(s, p, t, m, SMALL_LOOKS.hatch),
  compact: (s, p, t, m) => buildSmallCar(s, p, t, m, SMALL_LOOKS.compact),
  ev: buildEv, service: buildServiceSedan, van: buildVan, bus: buildBus, ambulance: buildAmbulance,
  boxtruck: (s, p, t, m) => buildTruck(s, p, t, m, TRUCK_LOOKS.boxtruck),
  garbage: (s, p, t, m) => buildTruck(s, p, t, m, TRUCK_LOOKS.garbage),
  convertible: buildConvertible, cruiser: buildCruiser, sportbike: buildSportbike,
  atv: buildAtv, boat: buildBoat, jetski: buildJetski,
};

/**
 * Mark a trim geometry's glazing and draw it LAST.
 *
 * `glass` is 1 on every vertex whose colour is GLASS, 0 elsewhere; the trim
 * shader reads it (see glassShader). The triangles are reordered so all the
 * opaque trim -- chrome, lenses, rims -- comes first in the index buffer: the
 * trim draw is in the transparent pass with depth writes on, and a pane drawn
 * before the chrome behind it would depth-reject that chrome.
 */
export function tagGlass(geo) {
  const col = geo.attributes.color.array, n = col.length / 3;
  const flag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (Math.abs(col[i * 3] - GLASS[0]) < 1e-4 && Math.abs(col[i * 3 + 1] - GLASS[1]) < 1e-4
      && Math.abs(col[i * 3 + 2] - GLASS[2]) < 1e-4) flag[i] = 1;
    else if (Math.abs(col[i * 3 + 1] - SHADOW_G) < 1e-4 && Math.abs(col[i * 3 + 2] - SHADOW_B) < 1e-4) flag[i] = 2;
  }
  geo.setAttribute('glass', new THREE.BufferAttribute(flag, 1));
  // Solid first, then the contact shadow on the road, then the panes.
  const idx = geo.index.array, solid = [], shade = [], glass = [];
  for (let i = 0; i < idx.length; i += 3) {
    const f = Math.min(flag[idx[i]], flag[idx[i + 1]], flag[idx[i + 2]]);
    (f === 2 ? shade : f === 1 ? glass : solid).push(idx[i], idx[i + 1], idx[i + 2]);
  }
  geo.setIndex(solid.concat(shade, glass));
  return geo;
}

// CONTACT SHADOW. Measured, tyres sit on the drawn road (median 2 cm under
// it while driving), and still a truck read as hovering a few inches up: the
// road between its wheels was lit exactly like open road, and the sun shadow
// lands off to one side. What grounds a real vehicle is the dark ambient
// patch under it, and nothing drew one -- SSAO is gated to occluders 0.7 m+
// above the ground on purpose (see postfx). A soft blob in the trim geometry,
// which is already in the premultiplied transparent pass (glassShader): black
// at alpha = the vertex colour's red, so no extra draw. Its green and blue are
// the marker tagGlass keys on.
const SHADOW_G = 0.123, SHADOW_B = 0.456;
function contactShadow(trim, spec) {
  const hl = spec.len / 2, hw = spec.wid / 2;
  const moto = !!spec.moto;
  // inner patch under the body, feathering to nothing a little past it
  const il = hl * (moto ? 0.7 : 0.82), iw = hw * (moto ? 0.5 : 0.78);
  const ol = hl + (moto ? 0.25 : 0.45), ow = hw + (moto ? 0.2 : 0.4);
  // 8 cm up: tyres ride up to ~9 cm into a cambered road (they average the
  // four contact patches), and a lower blob vanished under it in patches.
  const y = 0.08, A = moto ? 0.5 : 0.7;
  const c = (a) => [a, SHADOW_G, SHADOW_B];
  const P = (x, z) => [x, y, z];
  const up = [0, 1, 0], uv = [0, 0, 1, 0, 1, 1, 0, 1];
  trim.quad(P(-iw, -il), P(iw, -il), P(iw, il), P(-iw, il), up, uv, c(A));
  // four feathered sides and four corners
  const ring = [[-iw, -il, -ow, -ol], [iw, -il, ow, -ol], [iw, il, ow, ol], [-iw, il, -ow, ol]];
  for (let k = 0; k < 4; k++) {
    const [ax, az, oax, oaz] = ring[k], [bx, bz, obx, obz] = ring[(k + 1) % 4];
    // side between corner k and k+1
    const sa = k % 2 === 0 ? P(ax, oaz) : P(oax, az), sb = k % 2 === 0 ? P(bx, obz) : P(obx, bz);
    trim.quad(P(ax, az), P(bx, bz), sb, sa, up, uv, [c(A), c(A), c(0), c(0)]);
    // corner k
    trim.quad(P(ax, az), k % 2 === 0 ? P(ax, oaz) : P(oax, az), P(oax, oaz), k % 2 === 0 ? P(oax, az) : P(ax, oaz), up, uv, [c(A), c(0), c(0), c(0)]);
  }
}

// Face-on, tinted automotive glass lets roughly half the light through; at a
// grazing angle Fresnel takes it to a mirror. GLASS_ALPHA is the face-on
// opacity of the tint layer, which is what decides how much of the cabin reads.
const GLASS_ALPHA = 0.55;
const GLASS_IBL_FROM = 'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );';

/**
 * The trim material's glass. One material still, so still one draw: `glass`
 * switches a fragment from metallic trim to a dielectric pane that
 *
 *  - reflects the SKY, not the ground: the reflected ray is folded into the
 *    upper hemisphere exactly as the towers' curtain wall does (world.js), or
 *    a vertical side window seen level mirrors the IBL's ground half;
 *  - is see-through face-on and a mirror at grazing angles (Schlick on N.V
 *    drives the opacity from GLASS_ALPHA up to 1), so the cabin shows through
 *    a windscreen you look into and a raked rear screen reads as sky;
 *  - is PREMULTIPLIED: the blend is ONE, ONE_MINUS_SRC_ALPHA, so the
 *    reflection is added at full strength while the tint only scales what is
 *    behind it. Straight alpha would dim the reflection by the same factor as
 *    the cabin, which is what makes game glass look like grey film.
 *
 * Opaque trim has alpha 1 and so draws exactly as it did; only its pass moves.
 */
function glassShader(sh) {
  sh.vertexShader = 'attribute float glass;\nvarying float vGlass;\nvarying float vShade;\n' + sh.vertexShader
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlass = glass > 0.5 && glass < 1.5 ? 1.0 : 0.0;\n\tvShade = glass > 1.5 ? 1.0 : 0.0;');
  let fs = 'varying float vGlass;\nvarying float vShade;\n' + sh.fragmentShader;
  if (THREE.ShaderChunk.envmap_physical_pars_fragment.includes(GLASS_IBL_FROM)) {
    fs = fs.replace('#include <envmap_physical_pars_fragment>',
      THREE.ShaderChunk.envmap_physical_pars_fragment.replace(GLASS_IBL_FROM, `${GLASS_IBL_FROM}
			reflectVec = normalize( mix( reflectVec, vec3( reflectVec.x, abs( reflectVec.y ) * 0.85 + 0.12, reflectVec.z ), vGlass ) );`));
  } else {
    console.warn('vehicles: envmap chunk changed, car glass reflects the ground again');
  }
  fs = fs
    .replace('#include <color_fragment>', `#include <color_fragment>
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.018, 0.022, 0.026 ), vGlass );`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
	metalnessFactor = mix( metalnessFactor, 0.0, vGlass );
	roughnessFactor = mix( roughnessFactor, 0.05, vGlass );`)
    .replace('#include <opaque_fragment>', `if ( vGlass > 0.5 ) {
		float gNV = saturate( dot( normal, normalize( vViewPosition ) ) );
		float gA = mix( ${GLASS_ALPHA.toFixed(3)}, 1.0, pow( 1.0 - gNV, 5.0 ) );
		// A laminated screen has two faces, so it reflects about twice what
		// one dielectric surface does face-on; the boost fades out toward
		// grazing, where Schlick has already taken it to a mirror.
		outgoingLight = totalDiffuse * gA + totalSpecular * mix( 2.0, 1.0, pow( 1.0 - gNV, 2.0 ) );
		diffuseColor.a = gA;
	}
	#include <opaque_fragment>`)
    // Fog mixes toward fogColor at full strength, but a premultiplied pane
    // only covers `a` of what is behind it -- and that is fogged already.
    .replace('#include <fog_fragment>', `#include <fog_fragment>
	#ifdef USE_FOG
		gl_FragColor.rgb -= fogColor * fogFactor * ( 1.0 - gl_FragColor.a );
	#endif
	// the contact shadow: darken what is under it, premultiplied, fading with the fog
	if ( vShade > 0.5 ) {
		float sa = vColor.r;
		#ifdef USE_FOG
			sa *= 1.0 - fogFactor;
		#endif
		gl_FragColor = vec4( 0.0, 0.0, 0.0, sa );
	}`);
  sh.fragmentShader = fs;
}

function buildType(spec) {
  const paint = new Builder(false);
  const trim = new Builder(false);
  const matte = new Builder(false);
  // Whoever sits in the car: merged only into the occupied geometries below.
  matte.crew = new Builder(false);
  // Propellers and rotors (spinPart): live for the flown aircraft, baked
  // still into everything else.
  matte.spins = [];
  // Every type has an authored builder now. A missing one is a table error,
  // not something to paper over with a parameterised tube.
  const build = HAND_BUILT[spec.hand];
  if (!build) throw new Error(`vehicle type has no builder: hand '${spec.hand}'`);
  const wheels = build(spec, paint, trim, matte);
  // Not under a hull: a dark blob on the water reads as a hole in it.
  if (!spec.plane && !spec.boat) contactShadow(trim, spec);

  const clone = (base) => {
    const b = new Builder(false);
    b.pos = base.pos.slice(); b.nor = base.nor.slice();
    b.col = base.col.slice(); b.idx = base.idx.slice();
    return b;
  };
  const trimW = clone(trim), matteW = clone(matte);
  const spins = matte.spins.map(({ b, at, axis }) => {
    const base = matteW.pos.length / 3;
    for (let i = 0; i < b.pos.length; i += 3) matteW.pos.push(b.pos[i] + at[0], b.pos[i + 1] + at[1], b.pos[i + 2] + at[2]);
    matteW.nor.push(...b.nor); matteW.col.push(...b.col);
    for (const i of b.idx) matteW.idx.push(i + base);
    return { geo: b.build(), at, axis };
  });
  // A wheel may declare its own outboard side; a bike's are on the centreline,
  // where `Math.sign(ax)` says nothing.
  const outOf = ([ax, , , , , o]) => (o !== undefined ? o : (Math.sign(ax) || 1));
  for (const wl of wheels) addWheel(trimW, matteW, wl[0], wl[1], wl[2], wl[3], wl[4], outOf(wl), !!wl[6]);
  // The detailed build needs a wheel geometry per distinct size AND per side:
  // the spokes and brake disc are only on the outboard face, so the left and
  // right wheels are mirror images and cannot share a buffer. Staggered tyres
  // (a wider rear than front) are what makes that worth indexing rather than
  // building one.
  const geoKey = new Map(), wheelGeos = [];
  const placed = wheels.map((wl) => {
    const [ax, ay, az, r, w] = wl;
    const out = outOf(wl);
    const k = `${r}|${w}|${out}|${!!wl[6]}`;
    let gi = geoKey.get(k);
    if (gi === undefined) {
      const wt = new Builder(false), wm = new Builder(false);
      addWheel(wt, wm, 0, 0, 0, r, w, out, !!wl[6]);
      gi = wheelGeos.length;
      wheelGeos.push({ trim: wt.build(), matte: wm.build() });
      geoKey.set(k, gi);
    }
    return [ax, ay, az, gi];
  });

  for (const wg of wheelGeos) tagGlass(wg.trim);
  // Three matte buffers: the player's car (wheel-less, occupied), traffic
  // (baked wheels, occupied) and parked or abandoned (baked wheels, empty).
  // Vehicle swaps between the last two as its `mode` changes; same draw.
  const crewed = (b) => {
    if (matte.crew.empty) return b;
    const c = clone(b), base = c.pos.length / 3, cr = matte.crew;
    c.pos.push(...cr.pos); c.nor.push(...cr.nor); c.col.push(...cr.col);
    for (const i of cr.idx) c.idx.push(i + base);
    return c;
  };
  const matteGeoWE = matteW.build();
  return {
    paintGeo: paint.build(),
    trimGeo: tagGlass(trim.build()),
    matteGeo: crewed(matte).build(),
    trimGeoW: tagGlass(trimW.build()),
    matteGeoW: matte.crew.empty ? matteGeoWE : crewed(matteW).build(),
    matteGeoWE,
    wheelGeos,
    wheels: placed,
    spins,
    spec,
    wheelR: spec.wheelR,
  };
}

// --- boot cache (bootcache.js via main.js) ----------------------------------
// Building all 21 types is ~1 s of a phone's boot and entirely deterministic,
// so main.js keeps the geometry of a build and hands it back on a later
// launch of the same build. Geometry only: materials, specs and wheels' meshes
// are made as usual. `matteGeoW` is the same object as `matteGeoWE` for a type
// with no crew, and stays so.
const GEO_KEYS = ['paintGeo', 'trimGeo', 'matteGeo', 'trimGeoW', 'matteGeoW', 'matteGeoWE'];
const packGeo = (g) => ({ a: Object.entries(g.attributes).map(([k, at]) => [k, at.array, at.itemSize]), i: g.index.array });
function unpackGeo(p) {
  const g = new THREE.BufferGeometry();
  for (const [k, arr, n] of p.a) g.setAttribute(k, new THREE.BufferAttribute(arr, n));
  g.setIndex(new THREE.BufferAttribute(p.i, 1));
  g.computeBoundingSphere();
  return g;
}
let PRE = null;
export function setVehicleCache(snap) { PRE = snap && snap.types ? snap : null; }
export function vehicleSnapshot() {
  const A = vehicleAssets(), types = {};
  for (const [k, t] of Object.entries(A.types)) {
    const r = { wheels: t.wheels, wheelR: t.wheelR, mwShared: t.matteGeoW === t.matteGeoWE,
      wheelGeos: t.wheelGeos.map((w) => ({ trim: packGeo(w.trim), matte: packGeo(w.matte) })),
      spins: t.spins.map((s) => ({ geo: packGeo(s.geo), at: s.at, axis: s.axis })) };
    for (const g of GEO_KEYS) if (!(g === 'matteGeoW' && r.mwShared)) r[g] = packGeo(t[g]);
    types[k] = r;
  }
  const far = {};
  if (FAR) for (const [k, g] of FAR.geos) far[k] = packGeo(g);
  return { types, far };
}
function restoreType(r, spec) {
  const t = { spec, wheels: r.wheels, wheelR: r.wheelR,
    wheelGeos: r.wheelGeos.map((w) => ({ trim: unpackGeo(w.trim), matte: unpackGeo(w.matte) })),
    spins: (r.spins || []).map((s) => ({ geo: unpackGeo(s.geo), at: s.at, axis: s.axis })) };
  for (const g of GEO_KEYS) if (r[g]) t[g] = unpackGeo(r[g]);
  if (r.mwShared) t.matteGeoW = t.matteGeoWE;
  return t;
}

let CACHE = null;
export function vehicleAssets() {
  if (CACHE) return CACHE;
  const types = {};
  for (const k of Object.keys(TYPES)) types[k] = PRE && PRE.types[k] ? restoreType(PRE.types[k], TYPES[k]) : buildType(TYPES[k]);
  // The trim draw moves to the transparent pass for its glass (see
  // glassShader); depth writes stay on, so its opaque parts behave as before.
  const trimMat = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.88, roughness: 0.16, envMapIntensity: 1.7,
    transparent: true, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  trimMat.onBeforeCompile = glassShader;
  trimMat.customProgramCacheKey = () => 'vehicleGlass';
  CACHE = {
    types,
    trimMat,
    matteMat: new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.05, roughness: 0.86, envMapIntensity: 0.55,
    }),
  };
  return CACHE;
}

export function paintMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color, metalness: 0.5, roughness: 0.26, envMapIntensity: 1.5,
  });
}

// ---------------------------------------------------------------------------
// FAR LOD: one geometry, one material, one draw per TYPE.
//
// A traffic car is 3 draws and ~6-12k triangles, and on a phone most of the
// ones on screen are 60 m+ away, 20-40 px long: at Yesler Terrace 25 of 41
// cars were, which was 75 draws and ~250k triangles of detail nobody could
// see. Past that distance traffic.js draws them through one InstancedMesh per
// type over this geometry instead.
//
// It is the three part geometries merged and VERTEX-CLUSTERED: vertices snap
// to a FAR_CELL grid and merge only within the same part and normal bin, so
// creases and part boundaries survive and a panel's curvature collapses. What
// the three materials did differently rides per vertex (`lodA`: paint mask,
// metalness, roughness, env intensity); the paint colour is the instance
// colour, applied to the paint mask only. Glass is opaque here, sky-folded
// like the near glass, since nobody sees into a cabin at 60 m.
const FAR_CELL = 0.2;
const FAR_PARTS = {
  paint: [1, 0.5, 0.26, 1.5],
  trim: [0, 0.88, 0.16, 1.7],
  matte: [0, 0.05, 0.86, 0.55],
  glass: [0, 0.0, 0.08, 1.4],
};

function clusterFar(parts) {
  const clusters = new Map();
  const P = [], N = [], C = [], A = [], Gl = [], cnt = [];
  const out = [];
  for (const { geo, part } of parts) {
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
    const col = geo.attributes.color ? geo.attributes.color.array : null;
    const gls = geo.attributes.glass ? geo.attributes.glass.array : null;
    const idx = geo.index.array;
    const map = new Int32Array(pos.length / 3);
    for (let v = 0; v < map.length; v++) {
      const k3 = v * 3;
      if (gls && gls[v] > 1.5) { map[v] = -1; continue; }   // contact shadow: not in the far LOD
      const glass = gls && gls[v] > 0.5;
      const pt = glass ? 'glass' : part;
      const nx = nor[k3], ny = nor[k3 + 1], nz = nor[k3 + 2];
      const key = `${pt}|${Math.round(pos[k3] / FAR_CELL)}|${Math.round(pos[k3 + 1] / FAR_CELL)}|${Math.round(pos[k3 + 2] / FAR_CELL)}`
        + `|${Math.round(nx * 1.2)}|${Math.round(ny * 1.2)}|${Math.round(nz * 1.2)}`;
      let c = clusters.get(key);
      if (c === undefined) {
        c = cnt.length;
        clusters.set(key, c);
        P.push(0, 0, 0); N.push(0, 0, 0); C.push(0, 0, 0); cnt.push(0);
        A.push(...FAR_PARTS[pt]); Gl.push(glass ? 1 : 0);
      }
      P[c * 3] += pos[k3]; P[c * 3 + 1] += pos[k3 + 1]; P[c * 3 + 2] += pos[k3 + 2];
      N[c * 3] += nx; N[c * 3 + 1] += ny; N[c * 3 + 2] += nz;
      if (glass) { C[c * 3] += 0.05; C[c * 3 + 1] += 0.06; C[c * 3 + 2] += 0.075; }
      else if (col && part !== 'paint') { C[c * 3] += col[k3]; C[c * 3 + 1] += col[k3 + 1]; C[c * 3 + 2] += col[k3 + 2]; }
      else { C[c * 3] += 1; C[c * 3 + 1] += 1; C[c * 3 + 2] += 1; }
      cnt[c]++;
      map[v] = c;
    }
    for (let i = 0; i < idx.length; i += 3) {
      const a = map[idx[i]], b = map[idx[i + 1]], c = map[idx[i + 2]];
      if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) continue;
      out.push(a, b, c);
    }
  }
  const n = cnt.length;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let c = 0; c < n; c++) {
    const k = cnt[c];
    for (let j = 0; j < 3; j++) { pos[c * 3 + j] = P[c * 3 + j] / k; col[c * 3 + j] = C[c * 3 + j] / k; }
    const l = Math.hypot(N[c * 3], N[c * 3 + 1], N[c * 3 + 2]) || 1;
    for (let j = 0; j < 3; j++) nor[c * 3 + j] = N[c * 3 + j] / l;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('lodA', new THREE.BufferAttribute(new Float32Array(A), 4));
  geo.setAttribute('lodG', new THREE.BufferAttribute(new Float32Array(Gl), 1));
  geo.setIndex(out);
  geo.computeBoundingSphere();
  return geo;
}

function farShader(sh) {
  sh.vertexShader = 'attribute vec4 lodA;\nattribute float lodG;\nvarying vec4 vLodA;\nvarying float vLodG;\n' + sh.vertexShader
    .replace('#include <color_vertex>', `#include <color_vertex>
	vLodA = lodA; vLodG = lodG;
	#ifdef USE_INSTANCING_COLOR
		// paint only: undo the instance tint on trim, matte and glass
		vColor.xyz /= mix( max( instanceColor.xyz, vec3( 1e-3 ) ), vec3( 1.0 ), lodA.x );
	#endif`);
  let fs = 'varying vec4 vLodA;\nvarying float vLodG;\n' + sh.fragmentShader;
  let env = THREE.ShaderChunk.envmap_physical_pars_fragment.split('envMapColor.rgb * envMapIntensity;').join('envMapColor.rgb * envMapIntensity * vLodA.w;');
  if (env.includes(GLASS_IBL_FROM)) {
    env = env.replace(GLASS_IBL_FROM, `${GLASS_IBL_FROM}
			reflectVec = normalize( mix( reflectVec, vec3( reflectVec.x, abs( reflectVec.y ) * 0.85 + 0.12, reflectVec.z ), vLodG ) );`);
  }
  fs = fs.replace('#include <envmap_physical_pars_fragment>', env)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
	metalnessFactor = vLodA.y;
	roughnessFactor = vLodA.z;`);
  sh.fragmentShader = fs;
}

let FAR = null;
/** The far LOD for a type: { geo, mat }, built on first use. */
export function farLod(typeName) {
  if (!FAR) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.5, envMapIntensity: 1 });
    mat.onBeforeCompile = farShader;
    mat.customProgramCacheKey = () => 'vehicleFar';
    FAR = { mat, geos: new Map() };
  }
  let geo = FAR.geos.get(typeName);
  if (!geo && PRE && PRE.far && PRE.far[typeName]) { geo = unpackGeo(PRE.far[typeName]); FAR.geos.set(typeName, geo); }
  if (!geo) {
    const t = vehicleAssets().types[typeName];
    geo = clusterFar([
      { geo: t.paintGeo, part: 'paint' },
      { geo: t.trimGeoW, part: 'trim' },
      { geo: t.matteGeoWE, part: 'matte' },
    ]);
    FAR.geos.set(typeName, geo);
  }
  return { geo, mat: FAR.mat };
}

// ---------------------------------------------------------------------------

export class Vehicle {
  constructor(city, typeName, color, opts = {}) {
    const A = vehicleAssets();
    const t = A.types[typeName];
    this.city = city;
    this.typeName = typeName;
    // Named `assets`, not `t`. It used to be `this.t`, and traffic.js spawning a
    // car did `v.t = t` with its position along the edge -- silently replacing
    // the whole geometry table with a number. Nothing noticed until you tried to
    // get in, because the meshes were already built by then.
    this.assets = t;
    this.spec = t.spec;
    // A livery overrides the kerbside colour: a taxi is yellow whatever the
    // spawner drew for it, or it is a random car with a sign on the roof.
    this.color = t.spec.livery !== undefined ? t.spec.livery : color;
    this.detailedWheels = false;

    this.group = new THREE.Group();
    this.bodyMat = paintMaterial(this.color);
    const paintMesh = new THREE.Mesh(t.paintGeo, this.bodyMat);
    this.trimMesh = new THREE.Mesh(t.trimGeoW, A.trimMat);
    this.matteMesh = new THREE.Mesh(t.matteGeoW, A.matteMat);
    paintMesh.castShadow = this.trimMesh.castShadow = this.matteMesh.castShadow = true;
    this.tilt = new THREE.Group();
    this.tilt.add(paintMesh, this.trimMesh, this.matteMesh);
    this.group.add(this.tilt);
    // Attitude pivot (a helicopter's is at the rotor, not on its skids): the
    // tilt group is raised and its meshes lowered by the same amount, so the
    // model is where it was and only the centre of rotation moves.
    this.pivotY = t.spec.pivotY || 0;
    if (this.pivotY) {
      this.tilt.position.y = this.pivotY;
      paintMesh.position.y = this.trimMesh.position.y = this.matteMesh.position.y = -this.pivotY;
    }
    // Live propellers and rotors, made in setDetailed(true): see spinPart.
    this.spinMeshes = [];
    // A bike carries its rider. He goes in the tilt group, so he leans with it
    // -- parented to `group` instead he would stay bolt upright through every
    // corner while the bike went over underneath him.
    this.rider = this.spec.moto || this.spec.atv || this.spec.jetski ? makeRider(this.spec.hand) : null;
    if (this.rider) this.tilt.add(this.rider.group);
    this.wheelMeshes = [];

    this.x = 0; this.y = 0; this.z = 0;
    this.heading = 0;
    this.vLong = 0; this.vLat = 0;
    this.steer = 0;
    this.pitch = 0; this.roll = 0;
    this.health = 100;
    this.dead = false;
    this.latAcc = 0;       // lateral acceleration, which is what a bike leans to
    // Seconds before this vehicle can take collision damage again. One crash
    // spans many frames -- see damage().
    this.hitCd = 0;
    this.onGround = true;
    this.vy = 0;
    this.wheelSpin = 0;
    this.skid = 0;
    this.lift = 0;
    this.radius = Math.max(t.spec.len, t.spec.wid) * 0.42;
    this.halfLen = t.spec.len / 2;
    this.halfWid = t.spec.wid / 2;
    this.mass = t.spec.mass;
    // EVERY FIELD ANYONE SETS, DECLARED HERE. traffic.js, player.js and main.js
    // used to add these as they went, so vehicles ended up with a dozen
    // different hidden classes and every loop over `traffic.cars` -- the
    // forward scan, car-car collisions, the physics -- ran megamorphic: slower
    // in V8 and JavaScriptCore alike, and allocating as it went. Each default
    // tests the same as the `undefined` it replaces.
    this._mode = null;
    this.edge = -1; this.dirSign = 0; this.laneU = null;
    this.panic = 0; this.stuckT = 0; this.recycle = false;
    this.path = null; this.pathT = 0; this.repath = 0; this.rammed = 0; this.siren = 0;
    this.lightL = null; this.lightR = null; this.extra = null;
    this.slot = null; this.wasParked = false; this.exploded = false;
    this.airborne = false; this.lowDetail = false;
    // Flight state (updatePlane / updateHeli). `yVis` is how far the drawn
    // body sits off `y`: a taildragger rocking back onto its tailwheel pivots
    // about its main wheels, not its middle.
    this.rollA = 0; this.pitchA = 0; this.yVis = 0;
    this.spool = 0; this.yawRate = 0; this.accLong = 0; this.accLeft = 0;
    // stunt ramps: the ramp under the centre (held briefly past the lip), the
    // vertical speed it would launch at, and the flight state while airborne.
    this.rampRef = null; this.rampT = 0; this.rampVy = 0; this.rampAlong = 0;
    this.stunt = false; this.spinRate = 0; this.stuntLaunch = null; this.stuntLanded = false; this.landVy = 0;
    // Wheelies (bikes and quads): the nose-up angle about the rear axle, how
    // long the current one has lasted, and a finished one for the HUD to read.
    this.wheelie = 0; this.wheelieT = 0; this.wheelieDone = 0; this.pullIn = 0;
    this._cast = null; this._farCol = null;
    this._fwd = { x: 0, z: 1 }; this._fwdH = NaN;
    this._acc = 0; this._still = 0;   // traffic.js: half-rate AI time, parked-settle frames
    this._t = 0; this.shoreHit = 0; this._surf = NaN;   // boats: wave clock, last grounding impact, eased surface
    this._bob = (typeName.length * 1.37 + (color & 0xff) * 0.021) % 6.28;
  }

  // `mode` decides whether anyone is at the wheel. Traffic and police are
  // driven; a parked car, or one the player got out of ('free'), is empty.
  // Assigned from traffic.js and player.js, so it is a setter rather than a
  // call they would each have to remember.
  get mode() { return this._mode; }
  set mode(m) {
    this._mode = m;
    // 'apron' is parked too (the airfield's planes, the moored boats and
    // floatplanes, the parks' quads): nobody at the controls.
    const empty = m === 'parked' || m === 'free' || m === 'apron';
    if (this.matteMesh && !this.detailedWheels) {
      this.matteMesh.geometry = empty ? this.assets.matteGeoWE : this.assets.matteGeoW;
    }
    // A quad's rider is there only when someone is riding it. (The bikes
    // keep theirs as they always have: traffic is all they ever are.)
    if (this.rider && (this.spec.atv || this.spec.jetski)) this.rider.group.visible = this.detailedWheels || !empty;
  }

  /** The player's own car gets steerable, spinning wheel meshes; traffic doesn't. */
  setDetailed(on) {
    if (this.detailedWheels === on) return;
    this.detailedWheels = on;
    const A = vehicleAssets();
    this.trimMesh.geometry = on ? this.assets.trimGeo : this.assets.trimGeoW;
    this.matteMesh.geometry = on ? this.assets.matteGeo : this.assets.matteGeoW;
    if (!on) this.mode = this._mode;
    if (this.rider && (this.spec.atv || this.spec.jetski)) this.rider.group.visible = on || this._mode === 'traffic';
    if (on) {
      for (const [wx, wy, wz, gi] of this.assets.wheels) {
        const g = new THREE.Group();
        const a = new THREE.Mesh(this.assets.wheelGeos[gi].trim, A.trimMat);
        const b = new THREE.Mesh(this.assets.wheelGeos[gi].matte, A.matteMat);
        a.castShadow = b.castShadow = true;
        g.add(a, b);
        g.position.set(wx, wy, wz);
        g.userData.front = wz > 0;
        this.tilt.add(g);
        this.wheelMeshes.push(g);
      }
      for (const s of this.assets.spins) {
        const m = new THREE.Mesh(s.geo, A.matteMat);
        m.castShadow = true;
        m.position.set(s.at[0], s.at[1] - this.pivotY, s.at[2]);
        m.userData.axis = s.axis;
        this.tilt.add(m);
        this.spinMeshes.push(m);
      }
    } else {
      for (const m of this.wheelMeshes) this.tilt.remove(m);
      this.wheelMeshes.length = 0;
      for (const m of this.spinMeshes) this.tilt.remove(m);
      this.spinMeshes.length = 0;
    }
  }

  /** Turn the live propellers/rotors: `rate(axis)` in rad/s for each part's axis. */
  spinParts(dt, rateZ, rateY = rateZ, rateX = rateZ) {
    for (const m of this.spinMeshes) {
      const a = m.userData.axis;
      if (a === 'y') m.rotation.y += rateY * dt;
      else if (a === 'x') m.rotation.x += rateX * dt;
      else m.rotation.z += rateZ * dt;
    }
  }

  place(x, z, heading) {
    this.x = x; this.z = z;
    this.heading = heading;
    if (this.spec.boat) {
      // On the water's LOCAL surface, level. The lakebed under it is what
      // groundAt would answer.
      const wl = waterQuery ? waterQuery(x, z) : null;
      this.lift = 0;
      this.y = wl !== null ? wl : this.city.groundAt(x, z, null);
      this._surf = this.y;
      this.pitch = 0; this.roll = 0;
      this.sync();
      return;
    }
    this.lift = this.city.roadLift(x, z);
    this.y = this.city.groundAt(x, z, null, this.lift);
    // Sit on the slope, the same way update() does. A parked car never runs
    // update(), so left at zero pitch it stays level on a hillside street and
    // its downhill end is buried -- the sunken cars on Queen Anne.
    const f = this.forward;
    const rx = f.z, rz = -f.x;
    const at = (dx, dz) => this.city.groundAt(this.x + dx, this.z + dz, this.y + 1.5, this.lift);
    const fh = at(f.x * this.halfLen, f.z * this.halfLen);
    const bh = at(-f.x * this.halfLen, -f.z * this.halfLen);
    // Two contact patches for a bike, four for a car -- see update() for why
    // the cross-car pair is wrong on something with no track at all.
    const two = !!this.spec.moto;
    const lh = two ? 0 : at(rx * this.halfWid, rz * this.halfWid);
    const rh = two ? 0 : at(-rx * this.halfWid, -rz * this.halfWid);
    this.pitch = Math.atan2(bh - fh, this.halfLen * 2);
    // see update(): +X is raised by +rotation.z. A parked bike stands upright.
    this.roll = two ? 0 : Math.atan2(lh - rh, this.halfWid * 2);
    // Rest on the plane through the contact patches, not on the ground under
    // the centre -- otherwise a car parked across a camber sits with one pair
    // of wheels buried and the other pair in the air.
    this.y = two ? (fh + bh) / 2 : (fh + bh + lh + rh) / 4;
    // A taildragger is parked on its tailwheel, not level until its first
    // update (see updatePlane).
    const td = this.spec.taildragger;
    if (td) {
      this.pitchA = td.deg * Math.PI / 180;
      this.pitch -= this.pitchA;
      this.yVis = -td.zMain * Math.sin(this.pitchA);
    }
    this.sync();
  }

  get speed() {
    return Math.hypot(this.vLong, this.vLat);
  }

  // One object per vehicle, refreshed when the heading moves: this is read in
  // every hot loop over the cars, and a fresh object per read was a large
  // share of the frame's garbage. Every caller uses it at once and none holds
  // it across a heading change; keep it that way (copy x/z if you must).
  get forward() {
    const f = this._fwd;
    if (this._fwdH !== this.heading) { this._fwdH = this.heading; f.x = Math.sin(this.heading); f.z = Math.cos(this.heading); }
    return f;
  }

  /**
   * Arcade flight. The bar is the rest of the game's: responsive first,
   * plausible second. Ground roll steers like a taxiing aircraft, rotation
   * happens at VR with the stick back, and in the air the stick banks to
   * turn and pitches to climb -- turn rate follows bank the way a
   * coordinated turn does, but nothing here asks the wings for lift they
   * cannot give except the stall, which mushes rather than spins.
   *
   * Same conventions as everything else: heading is rotation.y, forward is
   * (sin h, cos h), +steer turns LEFT. Pull the stick back (input.pitch > 0)
   * to climb, aviation-style -- the same axis that walks the player backward,
   * which nobody notices because flying replaces walking wholesale.
   */
  updatePlane(dt, input) {
    const spec = this.spec;
    const throttle = input.throttle || 0;
    const brake = input.brake || 0;
    const steerIn = clamp(input.steer || 0, -1, 1);
    const pitchIn = clamp(input.pitch || 0, -1, 1);
    // Each field guarded on ITS OWN. The constructor already defines vy for
    // the falling code, so a single vy-keyed guard never ran and rollA went
    // into damp() undefined -- NaN heading, a plane that climbed straight
    // ahead forever while x and z dissolved.
    if (this.rollA === undefined) this.rollA = 0;
    if (this.pitchA === undefined) this.pitchA = 0;
    if (this.vy === undefined) this.vy = 0;
    if (this.airborne === undefined) this.airborne = false;

    this.lift = this.city.roadLift(this.x, this.z);
    let ground = this.city.groundAt(this.x, this.z, this.y + 1.2, this.lift);
    if (spec.floats && waterQuery) {
      // Pontoons make water a runway: the lake surface IS the ground. Lakes
      // are at their own levels (Lake Union 5.3, Green Lake 50.3), so this
      // must be the local surface, never a constant.
      const wl = waterQuery(this.x, this.z);
      if (wl !== null && wl > ground) ground = wl + 0.12;
    }
    const top = spec.fadeTop;
    const fly = spec.fly || PLANE_FLY;
    const VR = fly.vr;                   // rotation speed, m/s (~100 kph on the trainer)
    const STALL = fly.stall;

    // airspeed along the nose. Diving trades height for speed and climbing
    // pays for it, which is most of what makes flight feel like flight.
    let acc = 0;
    if (throttle > 0) acc += spec.acc * throttle * (1 - clamp(this.vLong / top, 0, 1));
    if (brake > 0) acc -= (this.airborne ? 2.2 : spec.brakeA * 0.6) * brake;
    // 0.45x, not 2.2x: with the heavy drag the measured cruise was 170 kph
    // against a requested 300 -- the arcade bargain applies in the air too.
    acc -= this.vLong * Math.abs(this.vLong) * DRAG * 0.45;
    if (!this.airborne) acc -= this.vLong * ROLL * 1.6;      // rolling on grass/tarmac
    if (this.airborne) acc -= this.vy * 0.55;                // climb bleeds, dive builds
    // Past the airframe's never-exceed speed the air takes it back, softly.
    if (fly.vne && this.vLong > fly.vne) acc -= (this.vLong - fly.vne) * 0.9;
    this.vLong = Math.max(0, this.vLong + acc * dt);

    if (!this.airborne) {
      // ground roll: nosewheel steering, authority falling with speed
      const yawRate = clamp(this.vLong, 0, 14) / 9 * steerIn * 0.55;
      this.heading += yawRate * dt;
      this.rollA = damp(this.rollA, 0, 6, dt);
      // A taildragger sits back on its tailwheel until the tail flies.
      const td = spec.taildragger;
      const rest = td ? (td.deg * Math.PI / 180) * (1 - clamp(this.vLong / td.tailUp, 0, 1)) : 0;
      this.pitchA = damp(this.pitchA, rest, 6, dt);
      this.y = ground;
      this.vy = 0;
      if (this.vLong > VR && pitchIn > 0.25) {
        this.airborne = true;
        this.vy = 3.5;
      }
    } else {
      // banked turn: the bank IS the turn, like a car's steer is its yaw
      this.rollA = damp(this.rollA, -steerIn * fly.bank, 4.5, dt);
      // ~30 deg/s at full bank. 1.6 here was a 67 deg/s snap-turn -- a probe
      // measured 335 degrees in a five-second bank, which is a dogfighter, not
      // a trainer over a city. (`turn` scales it per type: the biplane turns
      // inside the trainer, the jet wide of it.)
      this.heading += -this.rollA * 0.9 * clamp(this.vLong / 34, 0.3, 1.2) * dt * 0.75 * fly.turn;
      // pitch: stick back climbs. Climb rate scales with excess airspeed, and
      // below the stall the nose mushes down no matter what you ask for.
      const excess = clamp((this.vLong - STALL) / (top - STALL), 0, 1);
      let vyT = pitchIn * (4 + fly.climb * excess);
      if (this.vLong < STALL) vyT = Math.min(vyT, -6 * (1 - this.vLong / STALL) * 3);
      // soft ceiling: the air runs out, gently
      if (this.y > 520) vyT = Math.min(vyT, (560 - this.y) * 0.08);
      this.vy = damp(this.vy, vyT, 2.2, dt);
      this.pitchA = damp(this.pitchA, Math.atan2(this.vy, Math.max(this.vLong, 8)), 5, dt);
      this.y += this.vy * dt;

      if (this.y <= ground + 0.05) {
        // touchdown. A sink rate a real trainer's gear takes is fine; past it
        // the airframe pays, scaled like a crash.
        this.y = ground;
        this.airborne = false;
        if (this.vy < -7) this.damage(Math.min(70, (-this.vy - 7) * 9), true);
        else if (this.vy < -3.5) this.damage((-this.vy - 3.5) * 3, true);
        this.vy = 0;
      }
    }

    // integrate position along the nose
    const f = this.forward;
    this.x += f.x * this.vLong * dt;
    this.z += f.z * this.vLong * dt;

    // Nose attitude on the tilt child, like a bike's lean, written to
    // pitch/roll so sync() -- which traffic.js runs on every vehicle after
    // the collision pass -- draws the same attitude. It used to be set on the
    // tilt group directly and sync() levelled every parked plane again; and
    // the flown one was drawn `wheelR + 0.25` up, so it taxied 55 cm off the
    // tarmac while the parked ones sat on it.
    this.pitch = -this.pitchA;
    this.roll = this.rollA;
    // A taildragger rocks about its main wheels (zMain ahead of the middle),
    // so the drawn body drops as the nose comes up.
    const td = spec.taildragger;
    this.yVis = td && !this.airborne ? -td.zMain * Math.sin(Math.max(0, this.pitchA)) : 0;
    this.sync();
    this.spinParts(dt, 2 + this.vLong * 0.5 + throttle * 20);
    this.latAcc = 0;
    this.skid = 0;
  }

  /**
   * The fighter: a full 3D attitude, so it loops, rolls and flies inverted.
   *
   * The other planes fly a heading, a bank that turns it, and a climb rate,
   * which is easy and cannot go over the top. Here the attitude is a
   * quaternion and the stick moves it in the BODY frame: y pitches the nose
   * (back is up, relative to the jet, so a full pull is a loop), x rolls.
   * Velocity runs along the nose (arcade: no sideslip); thrust fights drag
   * and gravity along the nose, so a climb bleeds speed and a dive builds it,
   * and below the stall the nose drops and the jet sinks. Heading, pitch and
   * roll are read back out of the quaternion (YXZ -- the order sync() draws
   * group.rotation.y then tilt x, z in), so everything else sees the usual
   * fields. On the ground it rolls and steers like the other planes.
   */
  updateFighter(dt, input) {
    const spec = this.spec, fly = spec.fly;
    const throttle = input.throttle || 0, brake = input.brake || 0;
    const steerIn = clamp(input.steer || 0, -1, 1), pitchIn = clamp(input.pitch || 0, -1, 1);
    if (!this.q) { this.q = new THREE.Quaternion(); this._fv = new THREE.Vector3(); this._fu = new THREE.Vector3(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); }
    if (this.airborne === undefined) this.airborne = false;
    this.lift = this.city.roadLift(this.x, this.z);
    const ground = this.city.groundAt(this.x, this.z, this.y + 1.2, this.lift);
    const top = spec.topKph / 3.6;
    const F = this._fv, U = this._fu;
    if (!this.airborne) {
      this.q.setFromEuler(this._e.set(0, this.heading, 0, 'YXZ'));
    }
    F.set(0, 0, 1).applyQuaternion(this.q);
    const A = fly.thrust || spec.acc;
    let acc = A * throttle - A * (this.vLong / top) ** 2 * Math.sign(this.vLong);
    if (brake > 0) acc -= (this.airborne ? 9 : spec.brakeA * 0.6) * brake;
    if (this.airborne) acc -= 9.8 * F.y;
    else acc -= this.vLong * ROLL * 1.6;
    // Past vne the air takes it back hard. Without it a full-throttle
    // vertical dive settled near 262 m/s, and the streamer is only proven to
    // ~150 (see "Flying"): vne sits at the level top speed.
    if (fly.vne && this.vLong > fly.vne) acc -= (this.vLong - fly.vne) * 2.5;
    this.vLong = Math.max(0, this.vLong + acc * dt);
    const v = this.vLong;
    if (!this.airborne) {
      const yawRate = clamp(v, 0, 14) / 9 * steerIn * 0.55;
      this.heading += yawRate * dt;
      this.pitch = damp(this.pitch, 0, 6, dt);
      this.roll = 0;
      this.y = ground;
      this.vy = 0;
      const f = this.forward;
      this.x += f.x * v * dt;
      this.z += f.z * v * dt;
      if (v > fly.vr && pitchIn > 0.25) {
        this.airborne = true;
        this.q.setFromEuler(this._e.set(-0.12, this.heading, 0, 'YXZ'));
      }
      this.sync();
      this.latAcc = 0; this.skid = 0;
      return;
    }
    // control authority grows with airspeed; below the stall it fades
    const auth = clamp((v - 20) / (fly.stall), 0.12, 1);
    const pRate = pitchIn * 1.9 * auth, rRate = -steerIn * 3.5 * Math.max(0.35, auth);
    _dq.setFromEuler(this._e.set(-pRate * dt, 0, rRate * dt, 'YXZ'));
    this.q.multiply(_dq);
    // stalled: the nose falls toward the ground, in the world frame
    const st = clamp(1 - v / fly.stall, 0, 1);
    F.set(0, 0, 1).applyQuaternion(this.q);
    if (st > 0 || this.y > 900) {
      const k = st * 1.4 + (this.y > 900 ? (this.y - 900) * 0.01 : 0);
      _tv.copy(F).addScaledVector(_up, -k * dt).normalize();
      _dq.setFromUnitVectors(F, _tv);
      this.q.premultiply(_dq);
      F.copy(_tv);
    }
    this.q.normalize();
    U.set(0, 1, 0).applyQuaternion(this.q);
    const sink = 12 * st;
    const vx = F.x * v, vyy = F.y * v - sink, vz = F.z * v;
    this.x += vx * dt; this.y += vyy * dt; this.z += vz * dt;
    this.vy = vyy;
    this.x = G.clampToMap(this.x); this.z = G.clampToMap(this.z);
    if (this.y <= ground + 0.05) {
      // wheels down, wings level and a gentle sink: a landing; anything
      // else is a crash
      const level = F.y > -0.22 && U.y > 0.85;
      this.y = ground;
      if (level && vyy > -9 && v < 115) {
        this.airborne = false;
        this._e.setFromQuaternion(this.q, 'YXZ');
        this.heading = this._e.y;
        if (vyy < -4.5) this.damage((-vyy - 4.5) * 4, true);
      } else {
        this.damage(Math.min(100, 30 + v * 0.6), true);
        this.airborne = false;
        this.vLong *= 0.2;
      }
    }
    this._e.setFromQuaternion(this.q, 'YXZ');
    this.heading = this._e.y;
    this.pitch = this._e.x;
    this.roll = this._e.z;
    this.yVis = 0;
    this.sync();
    this.latAcc = 0;
    this.skid = 0;
  }

  /**
   * Helicopter. Built to be flown with one thumb and two buttons:
   *
   *   collective  input.lift / input.sink (UP / DOWN): a CLIMB RATE, and with
   *               neither held the aircraft holds its height -- hands off is
   *               a hover, which is the whole trick of making it easy
   *   stick y     forward speed along the nose (back is a slow reverse);
   *               released, it decelerates to a hover over the spot
   *   stick x     yaw -- a pedal turn at the hover, easing to a banked turn
   *               at speed
   *
   * Translation is a world-frame velocity chasing the one the stick asks for
   * at a capped acceleration, so a turn at speed carries its momentum round
   * (drift) instead of pivoting on rails. The attitude is DRAWN from that
   * acceleration -- nose down to speed up, banked into a turn -- which is how
   * a real helicopter looks when it does exactly this. vLong/vLat are kept in
   * the body frame for everything else in the game (collisions write them,
   * the HUD reads them).
   *
   * The rotor spools up over ~1.8 s with someone at the controls and will not
   * lift until it has; abandoned in the air, it settles to the ground.
   */
  updateHeli(dt, input) {
    const spec = this.spec, R = spec.rotor;
    const piloted = !!input.pilot;
    const steerIn = clamp(input.steer || 0, -1, 1);
    const fwdIn = -clamp(input.pitch || 0, -1, 1);   // stick forward is -y
    this.spool = clamp(this.spool + (piloted ? dt / 1.8 : -dt / 5), 0, 1);
    const ready = this.spool > 0.92;

    this.lift = this.city.roadLift(this.x, this.z);
    const ground = this.city.groundAt(this.x, this.z, this.y + 1.2, this.lift);

    // collective -> vertical speed
    let cIn = piloted ? clamp((input.lift || 0) - (input.sink || 0), -1, 1) : -0.5;
    let vyT = cIn > 0 ? cIn * R.climb : cIn * R.sink;
    if (!ready) vyT = Math.min(vyT, this.airborne ? -2 - 7 * (1 - this.spool) : 0);
    // Soft ceiling, like the planes'.
    if (this.y > 560) vyT = Math.min(vyT, (600 - this.y) * 0.1);
    // Cushion the last few metres of a descent so a held DOWN lands it.
    const agl = this.y - ground;
    if (vyT < 0 && agl < 6) vyT = Math.max(vyT, -1.2 - agl * 0.9);

    // world velocity from the body-frame one (collisions edit vLong/vLat)
    const f = this.forward;
    const lx = f.z, lz = -f.x;                        // local +X (port)
    let wx = f.x * this.vLong + lx * this.vLat, wz = f.z * this.vLong + lz * this.vLat;

    const top = spec.topKph / 3.6;
    let vfT = fwdIn >= 0 ? fwdIn * top : fwdIn * R.back;
    if (!this.airborne) vfT = 0;
    // The error split along the nose and across it. Along the nose is the
    // disc tilting to speed up or slow down; stopping is quicker than
    // accelerating, because the stick released has to mean "hover HERE", not
    // a 250 m coast. Across it is the banked disc pulling the aircraft round
    // a turn, with more authority -- one cap for both measured a 44 m/s turn
    // sliding 35 m/s sideways, skating rather than flying.
    const eA = (f.x * vfT - wx) * f.x + (f.z * vfT - wz) * f.z;
    const eL = -(wx * lx + wz * lz);
    const capA = (eA * this.vLong < 0 ? 1.35 : 1) * R.accel;
    const aA = clamp(eA * 1.4, -capA, capA), aLt = clamp(eL * 2.4, -R.grip, R.grip);
    const ax = f.x * aA + lx * aLt, az = f.z * aA + lz * aLt;
    wx += ax * dt; wz += az * dt;

    // yaw: a pedal turn at the hover, easing off with speed
    const sp = Math.hypot(wx, wz);
    const yawMax = lerp(R.yaw, R.yawFast, clamp(sp / top, 0, 1));
    const yawT = this.airborne ? steerIn * yawMax : (ready ? steerIn * yawMax * 0.3 : 0);
    this.yawRate = damp(this.yawRate, yawT, 5, dt);
    this.heading += this.yawRate * dt;

    if (!this.airborne) {
      // on the skids: friction holds it, and it only leaves when told to
      const k = Math.min(1, 4 * dt);
      wx -= wx * k; wz -= wz * k;
      this.y = ground;
      this.vy = 0;
      if (ready && vyT > 0.3) { this.airborne = true; this.vy = 0.8; }
    } else {
      this.vy = damp(this.vy, vyT, 2.6, dt);
      this.y += this.vy * dt;
      if (this.y <= ground) {
        // Touchdown. A firm landing is fine, a hard one hurts, and landing
        // while still moving fast along the ground is a skid-and-roll.
        const hs = Math.hypot(wx, wz);
        if (this.vy < -6.5) this.damage(Math.min(80, (-this.vy - 6.5) * 12), true);
        if (hs > 14) this.damage(Math.min(60, (hs - 14) * 4), true);
        this.y = ground;
        this.airborne = false;
        this.vy = 0;
      }
    }

    this.x += wx * dt;
    this.z += wz * dt;
    const f2 = this.forward, l2x = f2.z, l2z = -f2.x;
    this.vLong = wx * f2.x + wz * f2.z;
    this.vLat = wx * l2x + wz * l2z;
    // Attitude from what the rotor is doing: tilted into the acceleration
    // plus the steady nose-down of forward flight, banked into the turn
    // (yaw rate x speed is the turn's centripetal pull). Positive roll raises
    // local +X, so banking left (+X down) is NEGATIVE -- the bike's sign.
    const aL = ax * f2.x + az * f2.z, aS = ax * l2x + az * l2z;
    this.accLong = aL; this.accLeft = aS;
    const air = this.airborne ? 1 : 0;
    const pitchT = air * clamp(-(aL * 0.032 + (this.vLong / top) * 0.10), -0.36, 0.24);
    const rollT = air * clamp(-aS * 0.05, -0.5, 0.5);
    this.pitchA = damp(this.pitchA, pitchT, 5, dt);
    this.rollA = damp(this.rollA, rollT, 5, dt);
    this.pitch = -this.pitchA;
    this.roll = this.rollA;
    this.yVis = 0;
    this.sync();
    // Main rotor about Y, tail rotor about X. Not real rpm, which would alias
    // into a stationary or backward-turning disc at any frame rate; a rate
    // that reads as fast and still shows the blades.
    this.spinParts(dt, 0, this.spool * 17, this.spool * 44);
    this.latAcc = 0;
    this.skid = 0;
  }

  /**
   * The hull model. Same controls as a car -- throttle, brake-as-reverse,
   * steer -- but nothing touches the ground:
   *
   *  - it floats on the LOCAL surface (waterQuery: Lake Union 5.31, Green
   *    Lake 50.3, the sea 0), eased toward it so a change of level between
   *    two waters is a drop, not a teleport;
   *  - water is where the bed lies at least MIN_DEPTH under that surface.
   *    Anything shallower is shore and stops the bow like a kerb stops a
   *    wheel: the move is refused, tried again along each axis so the boat
   *    slides along a bank, and the impact is left in `shoreHit` for the
   *    player's crash handling. The last metre of depth drags, so running
   *    in slowly beaches softly;
   *  - drag is quadratic, sized so thrust balances it at the declared top
   *    speed, plus a linear term so an idle hull coasts to a stop;
   *  - it turns by thrust, so the rate falls away at rest unless the
   *    throttle is open (prop wash), and it slides: a hull holds its line
   *    far less than a tyre, which is what makes it feel like water;
   *  - it bobs, pitches up onto the plane with speed, squats under power and
   *    banks into a turn.
   *
   * A moored boat ('apron') holds its mooring and only bobs.
   */
  updateBoat(dt, input) {
    const spec = this.spec;
    const MIN_DEPTH = 0.45;
    const throttle = input.throttle || 0;
    const brake = input.brake || 0;
    const steerIn = clamp(input.steer || 0, -1, 1);
    this._t += dt;
    const depthAt = (x, z) => {
      const wl = waterQuery ? waterQuery(x, z) : null;
      return wl === null ? -1 : wl - G.terrainHeight(x, z);
    };
    const moored = this._mode === 'apron';
    const V = spec.topKph / 3.6;
    let acc = 0;
    if (!moored) {
      if (throttle > 0) acc += spec.acc * throttle * (this.vLong < -0.5 ? 1.6 : 1);
      // A pad's resting trigger or a coasting AI's token brake is not a
      // request for astern.
      if (brake > 0.3) acc -= spec.acc * (this.vLong > 0.5 ? 1.0 : 0.45 * (1 - clamp(-this.vLong / 6, 0, 1))) * brake;
    }
    // sized so thrust and both terms balance exactly at V
    acc -= (spec.acc - 0.18 * V) * (this.vLong * Math.abs(this.vLong)) / (V * V) + this.vLong * 0.18;
    // shallows drag: the last metre before the bed is too shallow to run in
    const dHere = depthAt(this.x, this.z);
    const shallow = clamp((1.2 - dHere) / (1.2 - MIN_DEPTH), 0, 1);
    acc -= this.vLong * 2.5 * shallow;
    this.vLong += acc * dt;
    if (moored) { this.vLong = 0; this.vLat = 0; }

    const sp = Math.abs(this.vLong);
    const bite = clamp(sp / 5, 0, 1) * (1 - 0.3 * clamp(sp / V, 0, 1)) + (1 - clamp(sp / 5, 0, 1)) * 0.35 * throttle;
    // a jet ski turns on its pump's thrust: sharp, and it leans hard into it
    const agile = spec.jetski ? 1.75 : 1;
    const yawRate = steerIn * 0.95 * agile * bite * (this.vLong < -0.3 ? -1 : 1);
    this.heading += yawRate * dt;
    this.steer = lerp(this.steer, steerIn * 0.5, 1 - Math.exp(-8 * dt));
    this.vLat += -yawRate * this.vLong * dt * 0.8;
    this.vLat *= Math.exp(-2.4 * dt);
    this.latAcc = yawRate * this.vLong;

    const f = this.forward;
    const rx = f.z, rz = -f.x;
    const dx = (f.x * this.vLong + rx * this.vLat) * dt;
    const dz = (f.z * this.vLong + rz * this.vLat) * dt;
    // The probe leads the hull by its half-length in the direction of travel.
    const lead = this.vLong >= 0 ? this.halfLen * 0.92 : -this.halfLen * 0.92;
    // A jump in the water's own LEVEL is a wall too: the Ballard Locks' gate
    // between the canal at lake level and the Sound 5 m below, which a boat
    // would otherwise sail straight over and drop down. Lake Washington's
    // 22 cm below the canal passes.
    const wlHere = waterQuery ? waterQuery(this.x, this.z) : null;
    const level = (x, z) => {
      if (wlHere === null) return true;
      const w = waterQuery(x, z);
      return w === null || Math.abs(w - wlHere) < 0.5;
    };
    const ok = (x, z) => depthAt(x, z) >= MIN_DEPTH && depthAt(x + f.x * lead, z + f.z * lead) >= MIN_DEPTH
      && level(x + f.x * lead, z + f.z * lead);
    this.shoreHit = 0;
    if (ok(this.x + dx, this.z + dz)) { this.x += dx; this.z += dz; }
    else {
      const impact = sp;
      if (ok(this.x + dx, this.z)) this.x += dx;
      else if (ok(this.x, this.z + dz)) this.z += dz;
      this.vLong *= impact > 4 ? -0.15 : 0.35;
      this.vLat *= 0.3;
      this.shoreHit = impact;
    }
    this.x = G.clampToMap(this.x);
    this.z = G.clampToMap(this.z);

    const wl = waterQuery ? waterQuery(this.x, this.z) : null;
    const surf = wl !== null ? wl : this.y;
    const ph = this._bob, t = this._t;
    const heave = Math.sin(t * 1.7 + ph) * 0.035 + Math.sin(t * 2.9 + ph * 2.1) * 0.015;
    const base = Number.isNaN(this._surf) ? surf : damp(this._surf, surf, 3, dt);
    this._surf = base;
    this.y = base + heave * (1 - 0.6 * clamp(sp / 10, 0, 1));
    this.onGround = true;
    this.vy = 0;
    // Up onto the plane: the bow climbs through the hump near a third of top
    // speed and settles lower once planing. Bow up is NEGATIVE pitch here.
    const r = clamp(this.vLong / V, 0, 1);
    const hump = Math.exp(-(((r - 0.33) / 0.2) ** 2));
    const tgtPitch = -(0.085 * hump + 0.03 * r) - clamp(acc, -8, 8) * 0.004
      + Math.sin(t * 1.3 + ph * 1.7) * 0.012 * (1 - 0.5 * r);
    const tgtRoll = -clamp(yawRate * clamp(sp / 6, 0, 1), -1, 1) * (spec.jetski ? 0.34 : 0.11)
      + Math.sin(t * 1.1 + ph * 0.7) * 0.018;
    this.pitch = lerp(this.pitch, tgtPitch, 1 - Math.exp(-4 * dt));
    this.roll = lerp(this.roll, tgtRoll, 1 - Math.exp(-4 * dt));
    // NO LAKE IN THE COCKPIT. The runabout's cockpit floor is 12 cm over the
    // waterline, and the water is one flat plane: through the hump the bow
    // rises ~0.11 rad, the helm end of the floor drops 25 cm, and the lake
    // drew across the floor between the seats ("water inside the boat"). A
    // hull on the plane rides up out of the water anyway, so it is lifted
    // just enough that the floor's lowest corner, pitched and rolled, stays
    // over the surface. At rest the bob never gets near it (4 cm to spare).
    if (spec.cockpit && wl !== null) {
      const [floor, z0, z1, hw] = spec.cockpit;
      const sp2 = Math.sin(this.pitch), sr = Math.abs(Math.sin(this.roll));
      const low = floor * Math.cos(this.pitch) * Math.cos(this.roll)
        + Math.min(-z0 * sp2, -z1 * sp2) - hw * sr;
      const lift = wl + 0.04 - (this.y + low);
      if (lift > 0) this.y += lift;
    }
    this.skid = 0;
    this.sync();
    return { dx, dz };
  }

  update(dt, input) {
    const spec = this.spec;
    if (this.hitCd > 0) this.hitCd -= dt;
    if (spec.heli) { this.updateHeli(dt, input); return; }
    if (spec.fighter) { this.updateFighter(dt, input); return; }
    if (spec.plane) { this.updatePlane(dt, input); return; }
    if (spec.boat) { this.updateBoat(dt, input); return; }
    const throttle = input.throttle || 0;
    const brake = input.brake || 0;
    const hand = input.handbrake || 0;
    // PULL BACK TO WHEELIE (bikes and quads), as in GTA: the stick's other
    // axis, which cars ignore and planes climb with. With the front wheel in
    // the air there is less to steer with.
    const light = !!(spec.moto || spec.atv);
    const pull = light ? clamp(input.pitch || 0, -1, 1) : 0;
    this.pullIn = pull;
    const steerIn = clamp(input.steer || 0, -1, 1) * (1 - 0.6 * clamp(this.wheelie / 0.3, 0, 1));
    if (this.stunt) { this.stuntAir(dt, steerIn, pull); return STILL; }

    // One paved-surface query per body per frame, reused by all seven ground
    // samples below -- the scan is too expensive to repeat per wheel.
    this.lift = this.city.roadLift(this.x, this.z);
    const sp = Math.abs(this.vLong);
    // Steering authority falls off with speed so the car stays controllable.
    // Steering is a GAME CONTROL here, not a tyre model.
    //
    // It has been through both extremes. First there was no lateral limit at
    // all, and the friction circle added later clawed back 82 % of the input
    // every frame at any real speed, which felt like the car ignoring you.
    // Solving for the angle the tyres could actually hold fixed that, and was
    // still wrong: honest grip at 110 km/h is a 49 m radius, and a city built
    // from real street widths is not drivable at that.
    //
    // So grip no longer limits steering. What is left is a mechanical lock that
    // eases off with speed -- enough that the car is not twitchy at 110, not so
    // much that it stops turning. The resulting cornering is several g and
    // entirely unrealistic, which is the point.
    const wheelbase = spec.wheelbase || spec.len * 0.62;
    // Heavy things still turn worse than light ones -- a bus does not corner
    // like a hatchback -- so the class stays in it through `agility`.
    // The clamp was tight enough at the top that a sportbike's declared grip
    // never reached the steering lock -- it and a muscle car came out the same,
    // which the bench caught as a class-order failure. Wide enough now that the
    // table means something at both ends.
    const agility = clamp(spec.latG / 0.88, 0.70, 1.32);
    // Think in TURN RADIUS, not steering angle.
    //
    // A fixed angle means the yaw it produces scales with 1/wheelbase, and a
    // motorcycle has a 1.36 m one. Measured, the sportbike was pulling 340
    // degrees a second at 60 km/h -- a full circle in about a second. It was
    // not cornering, it was spinning, and the resulting "radius" was worse than
    // the sedan's at every speed above walking pace. That is the bike that
    // leaned hard and would not go round corners.
    //
    // Asking for a radius and solving `atan(L / R)` for the angle gives every
    // vehicle a comparable, controllable turn, and short wheelbases correctly
    // come out slightly tighter rather than uncontrollable.
    //
    // The radius has to come from the grip that EXISTS, not from a curve picked
    // by feel. Lerping 4.5 -> 11 m across the speed range asked a sedan at
    // 122 km/h to hold an 11 m radius, which is 10.7 g of lateral acceleration
    // against the 1.9 g its tyres actually have -- a demand 5.5x over the
    // limit, rising with speed. The block below states that the steering limit
    // IS the grip limit ("the yaw the car achieves IS the lateral
    // acceleration"); with a radius like that the statement was simply untrue,
    // nothing anywhere enforced grip, and the car pivoted on rails at a rate no
    // tyre could produce. That is the wild high-speed steering.
    //
    // r = v^2 / a is the whole of it. STEER_BITE sits just over 1 so a corner
    // taken flat out is at the limit with a little left to provoke, and every
    // class differs by its own latG rather than by a fudge. The low-speed floor
    // is unchanged, so parking-lot lock is exactly as tight as before -- below
    // about 34 km/h the floor is what applies.
    const turnR = Math.max((spec.minTurnR || 4.5) / agility, (sp * sp) / (spec.latA * ARCADE_GRIP * STEER_BITE));
    const lock = Math.min(0.62, Math.atan(wheelbase / turnR))
      * (hand > 0.5 ? 1.25 : 1)
      * (brake > 0 && this.vLong > 0.4 ? 0.92 : 1);
    // How fast the wheel reaches where you asked for it. At 11 the time
    // constant is 91 ms and a step input took 233 ms to reach 90 % of its yaw,
    // which is the "sloppy" -- the car was still winding on lock a fifth of a
    // second after the input. 20 puts it near 115 ms.
    this.steer = lerp(this.steer, steerIn * lock, 1 - Math.exp(-20 * dt));

    const top = spec.fadeTop;
    let acc = 0;
    if (throttle > 0) {
      // A combustion car has to wind up to make power, so its pull fades
      // linearly with speed. An electric motor is at full torque from zero and
      // only tails off near the top, which is the whole character of the
      // thing -- squaring the falloff is what makes it leap off the line and
      // still feel like it runs out of road rather than out of revs.
      const fade = 1 - clamp(this.vLong / top, 0, 1);
      acc += spec.acc * throttle * (spec.ev ? Math.sqrt(fade) : fade);
      if (this.vLong < -0.5) acc += spec.acc * 1.4 * throttle;
    }
    if (brake > 0) {
      // Braking is per-class now. A fixed 16 m/s^2 is 1.63 g -- beyond any road
      // tyre -- and it was applied to the refuse truck and the sports car
      // alike, so every vehicle in the game stopped from 100 km/h in exactly
      // 21.6 m. `brakeA` comes from the declared 100-0 distance.
      if (this.vLong > 0.4) acc -= spec.brakeA * brake;
      else acc -= spec.acc * 0.55 * brake * (1 - clamp(-this.vLong / (top * 0.42), 0, 1));
    }
    // slope. Not for a distant AI car (lowDetail, a phone past 60 m): its
    // driver holds a target speed whatever the grade, so gravity along the
    // road changes nothing anyone can see, and these were two of its ground
    // queries a frame.
    // Off pavement, a road car bogs down; the quad does not.
    let rough = 0;
    if (!this.lowDetail) {
      const fw = this.forward;
      const gy = this.city.groundAt(this.x, this.z, this.y + 0.6, this.lift);
      const ahead = this.city.groundAt(this.x + fw.x * 3, this.z + fw.z * 3, this.y + 2.5, this.lift);
      // Low gearing and four driven knobblies: a quad climbs what stalls a
      // sedan, so it pays half the grade.
      acc -= clamp((ahead - gy) / 3, -0.7, 0.7) * 9.0 * (spec.offroad ? 0.5 : 1);
      // GRASS. Only for a vehicle nobody's AI is driving (the player's, or one
      // coasting after being left): traffic keeps to the roads. "Paved" is a
      // road's lift, a deck or lid (the ground there is not the terrain), or
      // a lot, which the terrain shader paints as tarmac.
      if (this._mode === 'free' && this.lift < 0.02 && Math.abs(gy - G.terrainHeight(this.x, this.z)) < 0.05
        && !G.inLot(this.x, this.z)) {
        rough = clamp(sp / 8, 0, 1);
        // Rolling resistance on turf: a sedan tops out near 110 km/h on a
        // lawn instead of 205, and a quad does not notice.
        if (!spec.offroad) acc -= this.vLong * Math.abs(this.vLong) * 0.0055 + this.vLong * 0.25;
      }
    }

    acc -= this.vLong * Math.abs(this.vLong) * DRAG; // aero
    acc -= this.vLong * ROLL; // rolling resistance
    if (throttle === 0 && brake === 0 && Math.abs(this.vLong) > 0.3) {
      // engine braking, or regen -- which bites noticeably harder
      acc -= Math.sign(this.vLong) * (spec.ev ? 4.6 : 2.4);
    }
    if (hand > 0.5 && this.vLong > 0) acc -= 11;
    this.vLong += acc * dt;
    if (Math.abs(this.vLong) < 0.12 && throttle === 0) this.vLong *= 0.82;

    // Bicycle-model yaw plus lateral slip for arcade drift. `wheelbase` comes
    // from the authored builders' real axle centres -- `len * 0.62` was a guess
    // made before any vehicle had a wheelbase to read, and it put the bus's
    // axles 7.4 m apart against a real 6.
    const yawRate = (this.vLong / wheelbase) * Math.tan(this.steer);
    this.heading += yawRate * dt;

    // The battery floor puts the mass under the axle line, so it holds on
    // rather than leaning; the handbrake still breaks it loose.
    // Lateral damping: how quickly a sideways slide is scrubbed off. Higher is
    // tighter, because the car goes where it is pointed instead of crabbing.
    // Two wheels barely slide until they let go completely, so a bike that
    // crabs like a car reads as vague.
    // Lateral damping. Higher is tighter: the car goes where it is pointed
    // rather than crabbing. With the grip clamp gone the yaw is much larger, so
    // without scrubbing the slip off harder all of that extra rotation would
    // come out as slide.
    const gripBase = spec.moto ? 30 : spec.bus || spec.cargo ? 18 : spec.ev ? 26 : 24;
    const grip = hand > 0.5 ? 1.5 : gripBase;
    this.vLat += -yawRate * this.vLong * dt;
    const before = this.vLat;
    this.vLat *= Math.exp(-grip * dt);

    // Grip is spent in the steering limit above, so there is nothing left to
    // claw back here. What remains is the slide itself: lateral velocity that
    // the tyres are scrubbing off, which is what the handbrake unleashes and
    // what the skid sound and marks read from.
    // What the bike is actually pulling laterally. This used to come out of the
    // friction-circle block that the steering clamp replaced; with steering
    // limited to what grip supports, the yaw the car achieves IS the lateral
    // acceleration, so there is nothing to correct for.
    this.latAcc = yawRate * this.vLong;
    this.skid = clamp(Math.abs(before) * 0.35, 0, 1);

    const f = this.forward;
    const rx = f.z, rz = -f.x;
    let dx = (f.x * this.vLong + rx * this.vLat) * dt;
    let dz = (f.z * this.vLong + rz * this.vLat) * dt;

    this.x += dx;
    this.z += dz;
    this.x = G.clampToMap(this.x);
    this.z = G.clampToMap(this.z);

    // Ground under each contact patch. Sampled BEFORE the vertical follow,
    // because the height the body should sit at is the plane through its four
    // wheels, not the ground under its centre. On a crest the centre reads high
    // and the wheels hang; in a dip it reads low and they sink.
    const f2 = this.forward;
    const rx2 = f2.z, rz2 = -f2.x;
    const gAt = (ox, oz) => this.city.groundAt(this.x + ox, this.z + oz, this.y + 1.5, this.lift);
    // A DISTANT AI car rides its centre sample. traffic.js sets lowDetail on a
    // phone for cars past 60 m, where a level body on a slope is centimetres
    // off at each end -- invisible -- and the four wheel queries were most of
    // what traffic cost there (3.3 ms a frame on an iPhone 17 Pro, 58 cars).
    const low = this.lowDetail;
    const cg = low ? this.city.groundAt(this.x, this.z, this.y + 1.5, this.lift) : 0;
    const fh = low ? cg : gAt(f2.x * this.halfLen, f2.z * this.halfLen);
    const bh = low ? cg : gAt(-f2.x * this.halfLen, -f2.z * this.halfLen);
    // A bike has TWO contact patches, both on the centreline. Sampling out to
    // the half-width and averaging four is right for a car straddling a road's
    // camber; on a bike those two samples are the gutter and the crown of a
    // road it is nowhere near, and the average buries it or floats it by half
    // the camber. Two samples also cost two `groundAt` calls instead of four.
    const two = !!spec.moto;
    const lh = two ? 0 : low ? cg : gAt(rx2 * this.halfWid, rz2 * this.halfWid);
    const rh = two ? 0 : low ? cg : gAt(-rx2 * this.halfWid, -rz2 * this.halfWid);

    // vertical: follow ground, with a little air time over crests
    let target = two ? (fh + bh) / 2 : (fh + bh + lh + rh) / 4;
    // THE FLOOR OF A TUNNEL DOES NOT TELEPORT UPWARD. The four wheel samples
    // are what eject a car from a bore: at a bend seam one wheel's query can
    // escape the deck and read the bank 9-20 m overhead, the average jumps
    // metres in a frame, and the rise launcher below fires the car through
    // the roof -- after which the in-bore rule ratchets and it never comes
    // back. A car genuinely underground (raw ground 4+ m above it) whose
    // floor "rises" 3+ m in one frame is reading the world above, not the
    // road below: hold height and let the deck's widened capture re-acquire
    // next frame. Legitimate driving cannot trip this -- kerbs are
    // centimetres, ramps are grades, and leaving a portal the raw cover
    // shrinks below 4 m well before any real climb.
    // HOLD ONLY THE SPIKE. Three shapes of this guard were measured and two
    // were worse than none: refusing every rise over 2.2 m and rate-limiting
    // all underground rises both destroyed the follow's self-healing -- the
    // exponential snap-back is what recovers a car from one lost-capture
    // frame -- and test rides sank away (below sea level the water drag then
    // compounds it, and nothing comes back from that). Only a JUMP of 3+ m in
    // a single frame is ever the world-above leaking through a wheel sample;
    // everything smaller must pass through untouched at full speed.
    //
    // The underground gate is 2.5 m of raw cover, not 4: the SR-99 tube runs
    // its last few hundred metres under thin cover, and at 4 the guard stood
    // down exactly there -- measured, a +3.28 eject at (-52, 450) under 3.4 m
    // of cover after 1.9 km ridden underground.
    if (target - this.y > 3 && G.terrainRaw(this.x, this.z) - this.y > 2.5) {
      target = this.y;
    }
    // STUNT RAMPS ride on the CENTRE. The four-wheel plane is right for a
    // road, but at a lip the front pair reads the ground beyond it and the
    // average sinks the car into the ramp for the last car-length -- it would
    // leave from half-way up. The centre sample keeps it on the ramp to the
    // lip, followed stiffly (the usual lerp lags ~0.4 m on a 20 deg kicker).
    // Leaving it, the car carries the ramp's vertical speed into the air.
    const onRamp = this.city.rampMask && !low ? this.city.rampHere(this.x, this.z) : null;
    if (onRamp) {
      const ry = this.city.rampY(onRamp, this.x, this.z);
      if (ry > target) target = ry;
      const along = (f2.x * onRamp.dx + f2.z * onRamp.dz) * this.vLong + (rx2 * onRamp.dx + rz2 * onRamp.dz) * this.vLat;
      this.rampRef = onRamp; this.rampT = 0.3;
      this.rampAlong = along;
      this.rampVy = along * this.city.rampSlope(onRamp, this.x, this.z);
    } else if (this.rampRef && (this.rampT -= dt) <= 0) this.rampRef = null;
    if (this.y > target + 0.25 && this.rampRef && !onRamp && this.onGround && this.rampVy > 1.5) {
      // Off the lip: a stunt flight from here (stuntAir) until the wheels
      // find the ground again.
      this.stunt = true;
      this.onGround = false;
      // A bike or a quad POPS off the lip: a rider unloads the suspension into
      // the kicker, and pulling back as you leave it pops harder. Without it a
      // quad (26-33 m/s at the lip against a car's 40-50) cleared the ramps by
      // a metre or two and felt like driving off a kerb.
      this.vy = light ? this.rampVy * 1.15 + 3.5 * clamp(pull, 0, 1) + 1.0 : this.rampVy;
      this.spinRate = 0;
      this.stuntLaunch = this.rampRef;
      this.rampRef = null;
      this.sync();
      return { dx, dz };
    }
    if (onRamp && this.y <= target + 0.25) {
      this.y = target; this.vy = 0; this.onGround = true;
    } else if (this.y > target + 0.25) {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      this.onGround = false;
      if (this.y <= target) { this.y = target; this.vy = 0; this.onGround = true; }
    } else {
      const rise = target - this.y;
      if (rise > 0.6 && sp > 6) { this.vy = Math.min(6, rise * 4); }
      this.y = lerp(this.y, target, 1 - Math.exp(-18 * dt));
      this.onGround = true;
    }

    // body attitude, from the samples taken above
    let tgtPitch = Math.atan2(bh - fh, this.halfLen * 2) - clamp(acc, -12, 12) * 0.0045;
    // Ruts and tussocks. The heightfield is 40 m smooth, so without this a
    // quad on a field glides like a car on a motorway. Deterministic in
    // position, so standing still is still; a road car on grass jolts too.
    let rut = 0;
    if (rough > 0) {
      rut = (Math.sin(this.x * 1.9 + this.z * 0.7) * Math.sin(this.z * 2.3 - this.x * 0.4)) * rough;
      tgtPitch += rut * (spec.offroad ? 0.022 : 0.012);
    }
    // `lh` is sampled along the body's local +X, and a positive rotation.z
    // raises local +X -- so the far side has to be SUBTRACTED, not the near one.
    // Reversed, the car leaned into the slope instead of along it: measured on
    // a 2.4 deg cross-slope, the +X wheels sat 7.2 cm under the road while the
    // other pair floated 7.1 cm above it, which is the two-wheels-in-the-air.
    // A motorcycle leans INTO the corner instead of rolling out of it, at the
    // angle that balances it: tan(lean) = lateral acceleration / g. `rotation.z`
    // raises local +X and a positive yaw rate turns the bike toward +X, so
    // leaning in is a NEGATIVE roll -- the sign that is easiest to get
    // backwards here, and a bike leaning out of its corners is unmissable.
    // Faded out below walking pace so a parked bike stands up straight.
    const tgtRoll = two
      // Lean is now a function of how hard you are STEERING, not of the
      // lateral acceleration that produces.
      //
      // Cornering is several g by design, so the physical balance angle
      // `atan(lat/g)` saturates any sane cap the moment you touch the bars --
      // measured, the bike sat pinned at its 45 deg limit at 30, 60 and 100
      // km/h alike, which is why it looked like it was falling over in every
      // turn regardless of how gentle. Steering as a fraction of available lock
      // gives a lean that is proportional to what the rider asked for, and it
      // still fades out below walking pace so a parked bike stands up.
      ? -0.70 * clamp(this.steer / Math.max(lock, 1e-3), -1, 1) * clamp((sp - 0.8) / 6, 0, 1)
      : Math.atan2(lh - rh, this.halfWid * 2) + clamp(this.vLat, -9, 9) * 0.016
        + (rough > 0 ? Math.sin(this.x * 2.7 - this.z * 1.3) * rough * (spec.offroad ? 0.03 : 0.015) : 0);
    this.pitch = lerp(this.pitch, tgtPitch, 1 - Math.exp(-10 * dt));
    if (light) {
      // Held on the gas with the stick back, the nose comes up to a balance
      // angle in proportion to the pull; let go, or lift off, and it drops.
      const up = this.onGround && sp > 2.5 && this.vLong > 0 && throttle > 0.3 && pull > 0.25;
      const want = up ? (spec.atv ? 0.42 : 0.55) * clamp((pull - 0.25) / 0.6, 0, 1) : 0;
      this.wheelie = lerp(this.wheelie, want, 1 - Math.exp(-(want > this.wheelie ? 3.2 : 6) * dt));
      if (this.wheelie > 0.2) this.wheelieT += dt;
      else if (this.wheelie < 0.08 && this.wheelieT > 0) { if (this.wheelieT > 2) this.wheelieDone = this.wheelieT; this.wheelieT = 0; }
    }
    // A bike's lean IS its steering, visually, so it has to arrive with the
    // turn rather than a tenth of a second behind it -- lagging the yaw is what
    // makes the controls feel like they are wallowing.
    this.roll = lerp(this.roll, tgtRoll, 1 - Math.exp(-(two ? 17 : 10) * dt));

    this.wheelSpin += (this.vLong / (this.assets.wheelR || 0.34)) * dt;
    this.sync();
    return { dx, dz };
  }

  /**
   * Flight off a stunt ramp, until the wheels are back on something.
   *
   * The ground model steers the VELOCITY with the body (yaw from the front
   * wheels, lateral slip scrubbed by grip), which in the air would let you
   * turn a jump in mid-flight. Here the flight path is held in world space and
   * steering only spins the body about it, so a spin is a real rotation you
   * then have to land out of: whatever angle the body is at on touchdown comes
   * back as slide (vLat), which is what a clean landing is judged on. No
   * engine, no brakes, no grip -- only air drag and STUNT_G.
   */
  stuntAir(dt, steerIn, pull = 0) {
    const f = this.forward;
    let wx = f.x * this.vLong + f.z * this.vLat, wz = f.z * this.vLong - f.x * this.vLat;
    const sp = Math.hypot(wx, wz);
    const drag = 1 - Math.min(0.5, sp * DRAG * dt);
    wx *= drag; wz *= drag;
    this.spinRate = damp(this.spinRate, steerIn * STUNT_SPIN, 5, dt);
    this.heading += this.spinRate * dt;
    const g = this.forward;
    this.vLong = wx * g.x + wz * g.z;
    this.vLat = wx * g.z - wz * g.x;
    this.x = G.clampToMap(this.x + wx * dt);
    this.z = G.clampToMap(this.z + wz * dt);
    this.vy -= STUNT_G * dt;
    this.y += this.vy * dt;
    this.lift = this.city.roadLift(this.x, this.z);
    const rx = g.z, rz = -g.x;
    const at = (ox, oz) => this.city.groundAt(this.x + ox, this.z + oz, this.y + 1.5, this.lift);
    const two = !!this.spec.moto;
    const fh = at(g.x * this.halfLen, g.z * this.halfLen);
    const bh = at(-g.x * this.halfLen, -g.z * this.halfLen);
    const lh = two ? 0 : at(rx * this.halfWid, rz * this.halfWid);
    const rh = two ? 0 : at(-rx * this.halfWid, -rz * this.halfWid);
    let target = two ? (fh + bh) / 2 : (fh + bh + lh + rh) / 4;
    const cr = this.city.rampMask ? this.city.rampHere(this.x, this.z) : null;
    if (cr) target = Math.max(target, this.city.rampY(cr, this.x, this.z));
    // A splashdown ends the flight at the surface, not on the lake bed.
    let splash = false;
    if (waterQuery && this.vy < 0 && G.isWater(this.x, this.z)) {
      const wl = waterQuery(this.x, this.z);
      if (wl !== null && wl - 0.8 > target) { target = wl - 0.8; splash = true; }
    }
    // The nose follows the flight path, as a thrown car's does.
    // ...and on a bike or a quad the stick tilts it: back for nose up.
    const tgtPitch = -Math.atan2(this.vy, Math.max(6, sp)) * 0.75 - pull * 0.55;
    this.pitch = lerp(this.pitch, tgtPitch, 1 - Math.exp(-(pull ? 4 : 2.5) * dt));
    this.wheelie = lerp(this.wheelie, 0, 1 - Math.exp(-4 * dt));
    this.roll = lerp(this.roll, 0, 1 - Math.exp(-3 * dt));
    this.latAcc = 0; this.skid = 0;
    this.wheelSpin += (this.vLong / (this.assets.wheelR || 0.34)) * dt;
    if (this.y <= target) {
      // Impact is the speed INTO the ground, along its normal: a car coming
      // down a slope the way it falls lands softly, so a cliff jump onto a
      // hillside is survivable where the same drop onto a flat is not.
      const sf = (fh - bh) / (2 * this.halfLen), sr = two ? 0 : (lh - rh) / (2 * this.halfWid);
      this.landVy = (this.vy - sf * this.vLong - sr * this.vLat) / Math.sqrt(1 + sf * sf + sr * sr);
      this.y = target;
      this.vy = 0;
      this.stunt = false;
      this.onGround = true;
      this.stuntLanded = true;
      this.spinRate = 0;
      // Suspension takes a normal landing; a drop from a big one costs.
      if (splash) this.vLong *= 0.35;
      else if (this.landVy < -20) this.damage(Math.min(40, (-this.landVy - 20) * 2), true);
    }
    this.sync();
  }

  sync() {
    // A wheelie turns the body about the rear axle: nose up, and the centre
    // lifted so the back wheel stays on the ground.
    const wl = this.wheelie ? (this.spec.wheelbase || 1.3) * 0.5 * Math.sin(this.wheelie) : 0;
    this.group.position.set(this.x, this.y + this.yVis + wl, this.z);
    this.group.rotation.y = this.heading;
    this.tilt.rotation.x = this.pitch - this.wheelie;
    this.tilt.rotation.z = this.roll;
    if (this.detailedWheels) {
      for (const m of this.wheelMeshes) {
        // Steer OUTSIDE the spin. Euler order matters here: the default 'XYZ'
        // builds Rx*Ry, i.e. it steers the wheel and then rolls it about the
        // car's X axis rather than the wheel's own axle -- so a turned front
        // wheel tumbles instead of rolling, which is the visible wobble.
        // 'YXZ' gives Ry*Rx: roll on the axle first, then steer the whole thing.
        m.rotation.order = 'YXZ';
        m.rotation.x = this.wheelSpin;
        m.rotation.y = m.userData.front ? this.steer : 0;
      }
    }
  }

  /**
   * Collision damage, debounced.
   *
   * A crash is not one frame. The pair stays overlapping and closing for
   * several, and the caller ran on every one of them: a 20 m/s shunt is 14
   * damage a frame, so 100 health was gone in about an eighth of a second and
   * any real impact detonated the car on contact. `hitCd` makes one collision
   * count once. Gunfire and other scripted damage passes `force` and is never
   * debounced.
   */
  damage(n, force) {
    if (!force) {
      if (this.hitCd > 0) return false;
      this.hitCd = 0.4;
    }
    this.health -= n;
    if (this.health <= 0 && !this.dead) {
      this.health = 0;
      this.dead = true;
      return true;
    }
    return false;
  }

  /** Point on the vehicle's oriented box nearest to (px,pz), in world space. */
  nearest(px, pz) {
    const f = this.forward;
    const rx = f.z, rz = -f.x;
    const dx = px - this.x, dz = pz - this.z;
    let lf = clamp(dx * f.x + dz * f.z, -this.halfLen, this.halfLen);
    let lr = clamp(dx * rx + dz * rz, -this.halfWid, this.halfWid);
    return { x: this.x + f.x * lf + rx * lr, z: this.z + f.z * lf + rz * lr };
  }
}

export function randomCarColor(seed) {
  return CAR_COLORS[Math.floor(hash2(seed, 5) * CAR_COLORS.length) % CAR_COLORS.length];
}
