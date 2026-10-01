// FERRY: Washington State Ferries' Seattle-Bainbridge run, to scale.
//
// Two Jumbo Mark II boats (M/V Wenatchee and M/V Tacoma) sail between Colman
// Dock's slip 3 and Winslow's slip 2 on OSM's route (tools/build_ferry.py ->
// data/ferry.json), in real time: ~35 minutes a crossing, 15 at each dock.
// Drive onto the car deck while one is loading and it takes you across; get
// out and walk up to the passenger cabin and the sun deck; or press ARRIVE
// (F) and you are at the other side, docked, ready to drive off.
//
// The vessel, from WSF's vessel data (Jumbo Mark II class, Todd Pacific,
// 1997-99): 460 ft 2 in (140.3 m) long, 90 ft (27.4 m) beam, 17 ft 3 in
// (5.26 m) draft, 18 knots, 202 vehicles, 2,499 passengers, double-ended --
// it never turns round: the Seattle end leads out of Winslow and the
// Bainbridge end out of Seattle. Deck heights (car deck 3.6 m over the
// water, 5.4 m to the passenger deck, the sun deck on the cabin roof) are
// est., from photographs against the published beam.
//
// A boat is its own frame: local +z points along the route toward Bainbridge,
// +x to starboard of that, y up from the waterline. Its decks are rectangles
// in that frame (SURF), answered to city.groundAt as a moving surface
// (deckAt, by the nearest-surface rule every deck follows), and whatever
// stands on one is carried with it each frame (update: world -> local with
// last frame's pose, local -> world with this one's). Bounds (constrain)
// keep a car on the car deck and a walker on the walkable decks.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { F_TUNNEL, F_ELEV } from './mapdata.js';

const KN = 0.514444;
export const JUMBO = {
  len: 140.3, beam: 27.4, draft: 5.26,
  cruise: 18 * KN,          // 18 knots, service speed
  deck: 3.6,                // car deck over the waterline (est.)
  pax: 3.6 + 5.4,           // passenger deck floor
  sun: 3.6 + 5.4 + 3.3,     // sun deck (the cabin roof)
};
const HL = JUMBO.len / 2, HB = JUMBO.beam / 2;
const DECK = JUMBO.deck, PAX = JUMBO.pax, SUN = JUMBO.sun;
const DWELL = 15 * 60;       // at the dock between sailings
const ACC = 0.05, BRAKE = 0.045;
const KEEP_OUT = 60;          // m to starboard of the route mid-Sound
const NAMES = ['Wenatchee', 'Tacoma'];
// Colman Dock's deck (see fixTerminals): the box round the dock, its height,
// and the x past which it eases down to Alaskan Way's own ground
const FILL = { seattle: { x0: -112, x1: 15, z0: 918, z1: 1090, y: 4.2, ease: -5 } };

// The decks, in the boat's frame. y0 at z0, y1 at z1 (stairs slope along z).
// `car`: cars drive here; every rect is walkable.
// The cabin fills the passenger deck nearly from side to side, as a Jumbo
// Mark II's does (its windows stand straight over the car deck's openings);
// open deck at each end, round the crew block under each pilothouse; the sun
// deck on the cabin roof, reached by an outside stair at each end.
// (the sun deck runs 0.3 m past the cabin's end walls, so its stairs land
// outside the cabin and clear the wall's top)
const CAB_X = 12.8, CAB_Z = 46, SUN_Z = 46.3;
const SURF = [
  { x0: -12.3, x1: 12.3, z0: -HL, z1: HL, y0: DECK, y1: DECK, car: true, lvl: 'car' },
  // four stairs from the car deck's side walkways up into the cabin
  ...[1, -1].flatMap((sx) => [1, -1].map((sz) => ({
    x0: sx > 0 ? 11.2 : -12.6, x1: sx > 0 ? 12.6 : -11.2,
    z0: sz > 0 ? 30 : -44, z1: sz > 0 ? 44 : -30,
    y0: sz > 0 ? DECK : PAX, y1: sz > 0 ? PAX : DECK, lvl: 'stair' }))),
  // the passenger deck -- in pieces, with the four stairwells LEFT OUT. One
  // rectangle over the whole deck covered the openings the car-deck stairs
  // come up through, so you walked over them on an invisible floor, and
  // climbing a stair the deck above came within the 0.9 m reach before the
  // top step and snatched you up to it: the hop.
  { x0: -11.2, x1: 11.2, z0: -57.5, z1: 57.5, y0: PAX, y1: PAX, lvl: 'pax' },
  ...[1, -1].flatMap((sx) => [[-57.5, -44], [-30, 30], [44, 57.5]].map(([z0, z1]) => ({
    x0: sx > 0 ? 11.2 : -13.1, x1: sx > 0 ? 13.1 : -11.2, z0, z1, y0: PAX, y1: PAX, lvl: 'pax' }))),
  // the sun deck's stairs, outside on the end decks: starboard at the
  // Bainbridge end, port at the Seattle end
  { x0: 11.4, x1: 12.9, z0: SUN_Z, z1: 55, y0: SUN, y1: PAX, lvl: 'stair' },
  { x0: -12.9, x1: -11.4, z0: -55, z1: -SUN_Z, y0: PAX, y1: SUN, lvl: 'stair' },
  { x0: -12.6, x1: 12.6, z0: -SUN_Z, z1: SUN_Z, y0: SUN, y1: SUN, lvl: 'sun' },
];
// Solid in the frame, [x0, x1, z0, z1, y0, y1]: the engine casing down the
// car deck's middle, the cabin's walls (its end doors left open), the crew
// blocks and the stacks.
const WALLS = [
  [-2.4, 2.4, -26, 26, DECK - 1, PAX],
];
for (const sx of [-1, 1]) WALLS.push([sx * CAB_X - 0.15, sx * CAB_X + 0.15, -CAB_Z, CAB_Z, PAX - 0.5, SUN - 0.4]);
// the cabin's end walls: a door each side of the crew block
const DOORS = [[-11.0, -9.4], [9.4, 11.0]];
for (const sz of [-1, 1]) {
  const z = sz * CAB_Z;
  let x = -CAB_X;
  for (const [d0, d1] of [...DOORS, [CAB_X, CAB_X]]) {
    WALLS.push([x, d0, z - 0.15, z + 0.15, PAX - 0.5, SUN - 0.4]);
    x = d1;
  }
}
// the crew block under each pilothouse, on the passenger deck
for (const sz of [-1, 1]) WALLS.push([-8.8, 8.8, sz > 0 ? 46.2 : -54, sz > 0 ? 54 : -46.2, PAX - 0.5, SUN - 0.4]);
// the stacks, on the sun deck
for (const sx of [-1, 1]) WALLS.push([sx * 5.5 - 1.7, sx * 5.5 + 1.7, -2.8, 2.8, SUN - 0.5, SUN + 12]);
// the windbreaks down the sun deck's middle
for (const sz of [-1, 1]) WALLS.push([-0.1, 0.1, sz * 20 - 7, sz * 20 + 7, SUN - 0.5, SUN + 1.6]);
// the car lanes: a car's CENTRE stays inside, less its half-width
const CAR = { x: 10.2, z: HL - 0.6 };

// -----------------------------------------------------------------------------
// before the city: the terminals' roads
// -----------------------------------------------------------------------------

/**
 * The slips' roads, fixed in the road data before citygen reads it.
 *
 * - A BUILDING PASSAGE IS NOT A TUNNEL. Colman Dock's road through the
 *   terminal building is `tunnel=building_passage`: imported as a bore, it
 *   dug a portal cutting across the dock (the road 5 m under the pier). Every
 *   road wholly on the dock is a surface road (below). Only the dock's: a
 *   radius round the slip took in four pieces of SR-99's bore under Alaskan
 *   Way and made them surface roads.
 * - THE TRESTLE COMES DOWN TO THE BOAT. Each slip's elevated road is re-seated
 *   from its land end down to the car deck's height at the slip end (node y
 *   is the surface less 0.09, the convention every deck node follows), so
 *   the grading makes a gentle ramp and the car rolls level onto the boat.
 */
export function fixTerminals(md) {
  const data = md.ferry, R = md.roads;
  if (!data || !R) return null;
  const out = { reseated: 0, dockRoads: 0, fillCells: 0, lock: new Set() };
  const slips = Object.values(data.slips);
  // COLMAN DOCK'S DECK (Pier 52). The water mask has most of the dock as dry
  // land (OSM's coastline takes it in), the DEM has it at 0-0.5 m, and its roads were
  // imported as bridges at 9.5 m over that: a 7 m cliff at the terminal
  // building. The dock's dry ground comes up to its real deck height, eased
  // out toward Alaskan Way (which already stands at ~4 m), and the roads on
  // it are ground roads.
  const DOCK = FILL.seattle;
  const inBox = (x, z) => x > DOCK.x0 && x < DOCK.x1 && z > DOCK.z0 && z < DOCK.z1;
  const fillAt = (x, z) => {
    // the whole pier, over water or not: its south apron's road stands on
    // piles over the water, as the dock does
    if (!inBox(x, z)) return -Infinity;
    return DOCK.y - Math.max(0, x - DOCK.ease) * 0.05;
  };
  const cells = new Set();
  const key = (x, z) => Math.floor((x + G.MAP_HALF) / G.HF_STEP) * 100003 + Math.floor((z + G.MAP_HALF) / G.HF_STEP);
  // (before the fill is installed: terrainRaw here is still the DEM)
  for (let x = DOCK.x0; x <= DOCK.x1; x += 5) for (let z = DOCK.z0; z <= DOCK.z1; z += 5) {
    if (fillAt(x, z) <= G.terrainRaw(x, z)) continue;
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) cells.add(key(x + ox * G.HF_STEP, z + oz * G.HF_STEP));
  }
  out.fillCells = cells.size;
  G.setFill(fillAt, (cx, cz) => cells.has(key(cx + 1, cz + 1)));
  for (let e = 0; e < R.edgeCount; e++) {
    const a = R.ea[e], b = R.eb[e];
    if (fillAt(R.nx[a], R.nz[a]) === -Infinity || fillAt(R.nx[b], R.nz[b]) === -Infinity) continue;
    if (R.eflags[e] & (F_ELEV | F_TUNNEL)) { R.eflags[e] &= ~(F_ELEV | F_TUNNEL); out.dockRoads++; }
  }
  // THE TRESTLES COME DOWN TO THE BOAT. Round each slip, every node on an
  // elevated road (the trestle, the holding lanes on their piers) is
  // re-seated on a ramp: the car deck's height at the slip's end, rising to
  // the height of the nearest real land (ground over 3 m) by distance from
  // the slip. The importer had them anywhere from 1.6 to 12.1 m -- Winslow's
  // terminal is a network of piers -- and the grading kept the highest.
  const elevAt = new Uint8Array(R.nodeCount);
  for (let e = 0; e < R.edgeCount; e++) if (R.eflags[e] & F_ELEV) { elevAt[R.ea[e]] = 1; elevAt[R.eb[e]] = 1; }
  for (const s of slips) {
    let land = null, ld = Infinity, end = -1, ed = 3;
    for (let n = 0; n < R.nodeCount; n++) {
      const d = Math.hypot(R.nx[n] - s.x, R.nz[n] - s.z);
      if (d < ed) { ed = d; end = n; }
      if (d > 320) continue;
      const t = G.terrainRaw(R.nx[n], R.nz[n]);
      if (t > 3 && d < ld) { ld = d; land = t; }
    }
    if (end < 0 || land === null) continue;
    s.node = end;
    const yLand = Math.max(DECK, land + 0.3) - 0.09, yEnd = DECK - 0.09;
    for (let n = 0; n < R.nodeCount; n++) {
      if (!elevAt[n]) continue;
      const d = Math.hypot(R.nx[n] - s.x, R.nz[n] - s.z);
      if (d > Math.max(ld, 40) + 20 || d > 260) continue;
      const t = Math.min(1, d / Math.max(ld, 1)), e = t * t * (3 - 2 * t);
      R.ny[n] = yEnd + (yLand - yEnd) * e;
      out.lock.add(n);
      out.reseated++;
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// the route
// -----------------------------------------------------------------------------

class Route {
  constructor(path) {
    const n = path.length;
    this.X = new Float64Array(n); this.Z = new Float64Array(n); this.S = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.X[i] = path[i][0]; this.Z[i] = path[i][1];
      if (i) this.S[i] = this.S[i - 1] + Math.hypot(this.X[i] - this.X[i - 1], this.Z[i] - this.Z[i - 1]);
    }
    this.len = this.S[n - 1];
  }
  _i(s) {
    const S = this.S;
    let lo = 0, hi = S.length - 1;
    s = Math.max(0, Math.min(this.len, s));
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    return [lo, (s - S[lo]) / ((S[hi] - S[lo]) || 1)];
  }
  x(s) { const [i, t] = this._i(s); return this.X[i] + (this.X[i + 1] - this.X[i]) * t; }
  z(s) { const [i, t] = this._i(s); return this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t; }
  /** rotation.y of local +z along the route (toward Bainbridge) */
  h(s) {
    const [i] = this._i(s);
    const dx = this.X[i + 1] - this.X[i], dz = this.Z[i + 1] - this.Z[i];
    return Math.atan2(dx, dz);
  }
}

// -----------------------------------------------------------------------------
// the boats
// -----------------------------------------------------------------------------

class Boat {
  constructor(name, route, at) {
    this.name = name;
    this.route = route;
    this.at = at;                 // 'sea' | 'bi' docked, or where it sails from
    this.state = 'dock';
    this.t = DWELL;               // dock: until departure
    this.s = at === 'sea' ? 0 : route.len;
    this.v = 0;                   // m/s along the route, + toward Bainbridge
    this.hornOn = false; this.hornT = 0;
    this.x = 0; this.z = 0; this.h = 0; this.y = 0;
    this.px = 0; this.pz = 0; this.ph = 0; this.py = 0;
    this.c = 1; this.sn = 0;
    this.group = null;
    this.held = 0;
    this.pose();
    this.px = this.x; this.pz = this.z; this.ph = this.h; this.py = this.y;
  }
  get to() { return this.at === 'sea' ? 'bi' : 'sea'; }
  /** + toward Bainbridge when sailing */
  get dir() { return this.at === 'sea' ? 1 : -1; }
  // KEEP TO STARBOARD. Both boats run one route, so mid-Sound they would
  // meet head on: each keeps KEEP_OUT to its own starboard, easing in over
  // the harbour ends (none within 700 m of a slip, all of it past 1.6 km),
  // and they pass port to port. Starboard is local +x sailing toward
  // Bainbridge and -x sailing back. The heading is the offset path's own, or
  // the boat would crab across each ease.
  _at(s) {
    const r = this.route, h = r.h(s);
    let x = r.x(s), z = r.z(s);
    if (this.state !== 'dock') {
      const e = Math.min(s, r.len - s);
      const t = Math.max(0, Math.min(1, (e - 700) / 900)), f = t * t * (3 - 2 * t);
      const off = this.dir * KEEP_OUT * f;
      x += off * Math.cos(h); z -= off * Math.sin(h);
    }
    return [x, z];
  }
  pose() {
    const r = this.route;
    const [x, z] = this._at(this.s);
    const a = this._at(Math.max(0, this.s - 3)), b = this._at(Math.min(r.len, this.s + 3));
    this.x = x; this.z = z;
    this.h = Math.atan2(b[0] - a[0], b[1] - a[1]);
    this.c = Math.cos(this.h); this.sn = Math.sin(this.h);
  }
  /** world -> this boat's frame, with its CURRENT pose */
  local(x, z) {
    const dx = x - this.x, dz = z - this.z;
    return [dx * this.c - dz * this.sn, dx * this.sn + dz * this.c];
  }
  world(lx, lz) {
    return [this.x + lx * this.c + lz * this.sn, this.z - lx * this.sn + lz * this.c];
  }
  /** Is the end facing `side`'s slip open (docked there)? -z faces Seattle. */
  gateOpen(end) { return this.state === 'dock' && ((end < 0 && this.at === 'sea') || (end > 0 && this.at === 'bi')); }
  /** seconds to the other side at the planned speeds (rough) */
  eta() {
    const left = this.at === 'sea' ? this.route.len - this.s : this.s;
    return this.state === 'dock' ? null : left / Math.max(2.5, Math.min(JUMBO.cruise, (Math.abs(this.v) + JUMBO.cruise) / 2)) + 60;
  }
  /** the speed limit here: slow out of Colman Dock and all through Eagle Harbor */
  vmax(sFromStart, sToEnd, route) {
    let v = JUMBO.cruise;
    // the harbour ends of the run, measured from each slip
    const sea = this.at === 'sea' ? sFromStart : sToEnd, bi = this.at === 'sea' ? sToEnd : sFromStart;
    if (sea < 700) v = Math.min(v, 2.6 + sea / 700 * 4.5);
    if (bi < 2600) v = Math.min(v, 3.4 + Math.max(0, bi - 400) / 2200 * 0.9);   // Eagle Harbor, ~7 knots
    if (bi < 400) v = Math.min(v, 1.2 + bi / 400 * 2.2);
    return v;
  }
  step(dt) {
    if (this.hornT > 0) { this.hornT -= dt; this.hornOn = this.hornT > 0; }
    if (this.state === 'dock') { this.t -= dt; return; }
    const L = this.route.len;
    const along = this.at === 'sea' ? this.s : L - this.s, left = L - along;
    const vm = Math.min(this.vmax(along, left), Math.sqrt(2 * BRAKE * Math.max(0, left - 0.3)) + 0.05);
    let sp = Math.abs(this.v);
    sp = sp < vm ? Math.min(vm, sp + ACC * dt) : Math.max(vm, sp - BRAKE * 1.6 * dt);
    this.v = sp * this.dir;
    this.s += this.v * dt;
    const done = this.at === 'sea' ? this.s >= L - 0.02 : this.s <= 0.02;
    if (done) this.arrive();
  }
  depart() {
    this.state = 'sail';
    this.hornT = 5.5; this.hornOn = true;   // one prolonged blast leaving the slip
    this.held = 0;
  }
  arrive() {
    this.s = this.at === 'sea' ? this.route.len : 0;
    this.at = this.to;
    this.state = 'dock';
    this.v = 0;
    this.t = DWELL;
  }
}

// -----------------------------------------------------------------------------
// the service
// -----------------------------------------------------------------------------

export class Ferry {
  constructor(data, { scene, city, world, renderer = null, hud = null }) {
    this.data = data;
    this.city = city;
    this.world = world;
    this.hud = hud;
    this.route = new Route(data.path);
    this.slips = data.slips;
    this.boats = [new Boat(NAMES[0], this.route, 'sea'), new Boat(NAMES[1], this.route, 'bi')];
    // stagger them a little so the two departures are not the same instant
    this.boats[1].t = DWELL - 40;
    this.group = new THREE.Group();
    this.group.name = 'ferry';
    const decal = decalTexture();
    this.mats = { body: world.mats.flat, glass: new THREE.MeshStandardMaterial({ color: 0x2a3d4a, roughness: 0.08, metalness: 0.3, envMapIntensity: 1.2,
        transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true }),
      decal: new THREE.MeshStandardMaterial({ map: decal.tex, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }) };
    for (const b of this.boats) {
      b.group = buildVessel(this.mats, decal.cells, b.name);
      b.group.name = `ferry:${b.name}`;
      this.group.add(b.group);
      this._place(b);
    }
    this.terminals = new THREE.Group();
    this.terminals.name = 'ferry:terminals';
    // one mesh a slip, each drawn only within TERM_R (update)
    this.termMeshes = Object.values(this.slips).map((sl) => {
      const m = buildTerminal(sl, (data.dolphins || []).filter(([x, z]) => Math.hypot(x - sl.x, z - sl.z) < 120), world.mats.flat);
      m.userData.at = [sl.x, sl.z];
      this.terminals.add(m);
      return m;
    });
    scene.add(this.group);
    scene.add(this.terminals);
    // the moving surface
    if (city) city.movers = [...(city.movers || []), this];
    this.aboard = null;       // { boat, lx, lz, ly, lh } for the player, last frame
    this.carried = new Map(); // vehicle -> same, for cars left on a deck
    this._prev = null;
    this._callT = 0;
    this._objWas = null;
    this.stats = { calls: 0, skips: 0, crossings: 0 };
    this._button(renderer);
  }

  /** where the ferries dock, for the maps and hellos */
  places() {
    return Object.entries(this.slips).map(([k, s]) => {
      const other = this.slips[k === 'sea' ? 'bi' : 'sea'];
      return { x: s.x - s.dx * 60, z: s.z - s.dz * 60, key: k, name: `Ferry · ${s.name}`,
        hello: `${k === 'sea' ? 'Colman Dock' : 'Winslow'} — the ${other.short} ferry loads here. Drive aboard; on board, ARRIVE (F) takes you straight across` };
    });
  }

  _place(b) {
    b.pose();
    const g = b.group;
    g.position.set(b.x, b.y, b.z);
    g.rotation.y = b.h;
    g.updateMatrixWorld(true);
  }

  // --- the surface ------------------------------------------------------------

  /** The deck under (x, z) nearest to curY within reach, of any boat, or null. */
  deckAt(x, z, curY, reach = 0.9) {
    let best = null, bestD = Infinity;
    for (const b of this.boats) {
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz > 76 * 76) continue;
      const lx = dx * b.c - dz * b.sn, lz = dx * b.sn + dz * b.c;
      if (Math.abs(lx) > HB || Math.abs(lz) > HL + 0.7) continue;
      for (const r of SURF) {
        let z0 = r.z0, z1 = r.z1;
        // the car deck's apron runs to the slip where that end is open
        if (r.car) { if (b.gateOpen(-1)) z0 -= 0.7; if (b.gateOpen(1)) z1 += 0.7; }
        if (lx < r.x0 || lx > r.x1 || lz < z0 || lz > z1) continue;
        if (r.car && Math.abs(lx) > breadth(lz) - 0.45 && Math.abs(lz) <= HL) continue;
        const y = b.y + r.y0 + (r.y1 - r.y0) * Math.max(0, Math.min(1, (lz - r.z0) / (r.z1 - r.z0)));
        if (curY == null) { if (best === null || y > best) best = y; continue; }
        if (y > curY + reach) continue;
        const d = Math.abs(y - curY);
        if (d < bestD) { bestD = d; best = y; }
      }
    }
    return best;
  }

  /** The boat whose hull (x, y, z) is in or on, or null. */
  boatAt(x, y, z) {
    for (const b of this.boats) {
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz > 75 * 75) continue;
      const [lx, lz] = b.local(x, z);
      if (Math.abs(lx) <= HB && Math.abs(lz) <= HL + 0.4 && y > b.y + DECK - 1.6 && y < b.y + SUN + 5) return b;
    }
    return null;
  }

  // --- each frame ---------------------------------------------------------------

  /**
   * Before the player moves: sail the boats, and carry whatever stood on one
   * last frame -- you, your car, a car left on the deck -- by exactly how far
   * its boat moved.
   */
  update(dt, player, traffic, camera) {
    this.traffic = traffic;
    const ents = [];
    const add = (o, isPlayer) => {
      const b = this.boatAt(o.x, o.y, o.z);
      if (!b) return;
      const [lx, lz] = b.local(o.x, o.z);
      ents.push({ o, b, lx, lz, ly: o.y - b.y, isPlayer });
    };
    const pv = player.vehicle;
    if (player.onFoot) add(player, true);
    if (pv) add(pv, false);
    if (traffic) for (const v of traffic.cars) if (v !== pv && (v.mode === 'free' || v.mode === 'parked') && v.y > 0) add(v, false);
    // the chase camera rides along too, or it trails a moving deck by metres
    const camE = [];
    if (player && player.camPos) {
      const b = this.boatAt(player.x, player.y, player.z);
      if (b) { const [lx, lz] = b.local(player.camPos.x, player.camPos.z); camE.push({ b, lx, lz }); }
    }
    const hs = new Map(this.boats.map((b) => [b, b.h]));
    for (const b of this.boats) {
      this._service(b, dt, player);
      b.step(dt);
      this._place(b);
    }
    for (const e of ents) {
      const [x, z] = e.b.world(e.lx, e.lz);
      const dh = e.b.h - hs.get(e.b);
      e.o.x = x; e.o.z = z;
      if (e.isPlayer) {
        if (player.heading !== undefined) player.heading += dh;
        if (player.camYaw !== undefined) player.camYaw += dh;
      } else {
        e.o.heading += dh;
        if (e.o.sync) e.o.sync();
      }
    }
    for (const e of camE) {
      const [x, z] = e.b.world(e.lx, e.lz);
      player.camPos.x = x; player.camPos.z = z;
    }
    // drawn within range only: a boat 10 km out is in the haze anyway
    if (camera && (this._rt = (this._rt || 0) + 1) % 15 === 0) {
      const cx = camera.position.x, cz = camera.position.z;
      for (const b of this.boats) b.group.visible = Math.hypot(b.x - cx, b.z - cz) < 7000;
      for (const m of this.termMeshes) m.visible = Math.hypot(m.userData.at[0] - cx, m.userData.at[1] - cz) < 2500;
    }
    this._hud(player);
  }

  /** Timetable, holding for you, calling a boat to you. */
  _service(b, dt, player) {
    if (b.state !== 'dock') return;
    const slip = this.slips[b.at];
    const px = player.x, pz = player.z;
    const onBoard = !!this.boatAt(px, player.y, pz) && this.boatAt(px, player.y, pz) === b;
    const approaching = !onBoard && Math.hypot(px - slip.x, pz - slip.z) < 90 && player.vehicle;
    if (b.t <= 0) {
      // hold for someone driving down the trestle, two minutes at most
      if (approaching && b.held < 120) { b.held += dt; return; }
      b.depart();
      this.stats.crossings++;
    }
  }

  /**
   * After the player moves: a car stays on the car deck and a walker on the
   * walkable decks; the camera stays inside the car deck and the cabin.
   */
  constrain(player, camera, prev) {
    const v = player.vehicle;
    const o = v || (player.onFoot ? player : null);
    if (!o) return;
    const b = this.boatAt(o.x, o.y, o.z) || (prev && prev.b);
    if (!b) return;
    let [lx, lz] = b.local(o.x, o.z);
    const ly = o.y - b.y;
    if (Math.abs(lx) > HB + 3 || Math.abs(lz) > HL + 3) return;
    if (v) {
      if (v.spec && (v.spec.boat || v.spec.plane) && !v.onDeck) {
        // your own boat against the hull: shoved clear of it
        if (ly < DECK - 0.5 && Math.abs(lz) < HL) {
          const need = HB + (v.halfWid || 1);
          if (Math.abs(lx) < need) { lx = Math.sign(lx || 1) * need; const [x, z] = b.world(lx, lz); v.x = x; v.z = z; v.vLong *= 0.5; }
        }
        return;
      }
      if (ly < DECK - 1.2 || ly > DECK + 2.5) return;
      // the lanes narrow with the hull toward each end (it rounds in to 7.2 m)
      const hzF = CAR.z - (v.halfLen || 2.4);
      // (at the car's outer end, so its corner cannot reach into the hull)
      const hx = Math.min(CAR.x, breadth(Math.min(HL, Math.abs(lz) + (v.halfLen || 2.4))) - 1.4) - (v.halfWid || 1);
      const openLo = b.gateOpen(-1), openHi = b.gateOpen(1);
      let cx = Math.max(-hx, Math.min(hx, lx)), cz = lz;
      if (!openLo && cz < -hzF) cz = -hzF;
      if (!openHi && cz > hzF) cz = hzF;
      // the engine casing down the middle
      if (Math.abs(cz) < 26 + (v.halfLen || 2.4) && Math.abs(cx) < 2.4 + (v.halfWid || 1)) cx = Math.sign(cx || 1) * (2.4 + (v.halfWid || 1));
      if (cx !== lx || cz !== lz) {
        const [x, z] = b.world(cx, cz);
        v.x = x; v.z = z;
        if (cz !== lz) v.vLong *= 0.2; else v.vLong *= 0.97;
      }
    } else {
      // a walker: on some deck at this level, and not in a wall
      const onDeck = (x, z, y) => {
        for (const r of SURF) {
          let z0 = r.z0, z1 = r.z1;
          if (r.car) { if (b.gateOpen(-1)) z0 -= 3; if (b.gateOpen(1)) z1 += 3; }
          if (x < r.x0 || x > r.x1 || z < z0 || z > z1) continue;
          if (r.car && Math.abs(z) <= HL && Math.abs(x) > breadth(z) - 0.9) continue;
          const ry = r.y0 + (r.y1 - r.y0) * Math.max(0, Math.min(1, (z - r.z0) / (r.z1 - r.z0)));
          if (Math.abs(ry - y) < 1.3) return true;
        }
        return false;
      };
      const inWall = (x, z, y) => WALLS.some((w) => x > w[0] - 0.3 && x < w[1] + 0.3 && z > w[2] - 0.3 && z < w[3] + 0.3 && y > w[4] && y < w[5]);
      const offEnd = (b.gateOpen(-1) && lz < -HL - 0.5) || (b.gateOpen(1) && lz > HL + 0.5);
      if (offEnd) return;
      if (!onDeck(lx, lz, ly) || inWall(lx, lz, ly)) {
        if (prev && prev.b === b && onDeck(prev.lx, prev.lz, prev.ly) && !inWall(prev.lx, prev.lz, prev.ly)) {
          const [x, z] = b.world(prev.lx, prev.lz);
          player.x = x; player.z = z;
        } else {
          // clamp onto the widest deck at this level
          const [x, z] = b.world(Math.max(-12.2, Math.min(12.2, lx)), Math.max(-HL + 0.5, Math.min(HL - 0.5, lz)));
          player.x = x; player.z = z;
        }
      }
    }
  }

  /** After main.js has placed the camera: under the passenger deck and in the
   *  cabin it stays inside. (Clamped earlier, applyCamera put it back.) */
  clampCamera(player, camera) {
    const b = this.riding(player);
    if (b) this._camera(player, camera, b);
  }

  /** Where the player stood in the boat's frame after this frame (for constrain). */
  snapshot(player) {
    const o = player.vehicle || player;
    const b = this.boatAt(o.x, o.y, o.z);
    if (!b) return null;
    const [lx, lz] = b.local(o.x, o.z);
    return { b, lx, lz, ly: o.y - b.y };
  }

  /** Under the passenger deck and inside the cabin, the camera stays in. */
  _camera(player, camera, b) {
    if (!camera) return;
    const t = player.vehicle || player;
    const [tx, tz] = b.local(t.x, t.z);
    const ty = t.y - b.y;
    const [cx, cz] = b.local(camera.position.x, camera.position.z);
    let cy = camera.position.y - b.y;
    let X = cx, Z = cz, Y = cy;
    if (ty < PAX - 1 && Math.abs(tz) < 57) {
      const bw = breadth(Math.min(HL, Math.abs(Z))) - 0.7;
      X = Math.max(-bw, Math.min(bw, X));
      if (Math.abs(Z) < 57.5) Y = Math.min(Y, PAX - 0.75);
      Y = Math.max(Y, DECK + 0.6);
    } else if (ty > PAX - 0.5 && ty < SUN - 0.5 && Math.abs(tx) < 10.9 && Math.abs(tz) < 45.9) {
      X = Math.max(-10.6, Math.min(10.6, X)); Z = Math.max(-45.6, Math.min(45.6, Z));
      Y = Math.min(Y, PAX + 2.7);
    } else if (ty > PAX - 0.5 && ty < SUN - 0.5 && Math.abs(X) < 11.2 && Math.abs(Z) < 46.2 && Y < SUN) {
      // on the promenade, outside: the camera stays outside the cabin too
      // (inside, it looked at you through its walls)
      if (Math.abs(tx) >= 10.9) X = Math.sign(tx) * 11.35;
      else Z = Math.sign(tz) * 46.35;
    } else return;
    if (X === cx && Z === cz && Y === cy) return;
    const [x, z] = b.world(X, Z);
    camera.position.set(x, Y + b.y, z);
    if (player.camLook) camera.lookAt(player.camLook); else camera.lookAt(t.x, t.y + (player.vehicle ? 1.2 : 1.5), t.z);
    camera.updateMatrixWorld();
  }

  // --- you and the boats --------------------------------------------------------

  /** The boat you are on, if any. */
  riding(player) {
    const o = player.vehicle || player;
    return this.boatAt(o.x, o.y, o.z);
  }

  /** ARRIVE: sailing, you are docked at the other side; at the dock, it sails. */
  skip(player) {
    const b = this.riding(player);
    if (!b) return false;
    if (b.state === 'dock') {
      // aboard at the slip you would leave from: sail now (an arrival's
      // dock is where you drive off, not a departure)
      if (b.t > 3) b.t = 3;
      return true;
    }
    // EVERYTHING ON THIS BOAT goes with it: you, the car you are in, and any
    // car left on its deck. Only you used to: get out to walk the decks,
    // press ARRIVE, and your car was left in mid-Sound with no deck under it.
    const snap = [];
    const take = (e, isPlayer) => {
      if (snap.some((q) => q.e === e)) return;
      const [lx, lz] = b.local(e.x, e.z);
      snap.push({ e, lx, lz, ly: e.y - b.y, isPlayer });
    };
    if (this.boatAt(player.x, player.y, player.z) === b) take(player, true);
    if (player.vehicle) take(player.vehicle, false);
    const traffic = this.traffic;
    if (traffic) for (const v of traffic.cars) if (v !== player.vehicle && this.boatAt(v.x, v.y, v.z) === b) take(v, false);
    const h0 = b.h;
    b.s = b.at === 'sea' ? b.route.len : 0;
    b.arrive();
    b.t = DWELL;
    this._place(b);
    const dh = b.h - h0;
    for (const q of snap) {
      const [x, z] = b.world(q.lx, q.lz);
      q.e.x = x; q.e.z = z; q.e.y = b.y + q.ly;
      if (q.isPlayer) { if (player.heading !== undefined) player.heading += dh; if (player.camYaw !== undefined) player.camYaw += dh; }
      else { q.e.heading += dh; if (q.e.sync) q.e.sync(); }
    }
    const o = player.vehicle || player;
    if (player.camPos) { player.camPos.x = o.x - Math.sin(player.camYaw || 0) * 4; player.camPos.z = o.z - Math.cos(player.camYaw || 0) * 4; }
    this.stats.skips++;
    this.say(`${b.name} — ${this.slips[b.at].name}. Drive off at the ${b.at === 'sea' ? 'Seattle' : 'Bainbridge'} end`, 4200);
    return true;
  }

  /** Waiting at a terminal with no boat coming soon: one is called in. */
  _call(player, dt) {
    const pv = player.vehicle || player;
    let at = null;
    for (const [k, s] of Object.entries(this.slips)) if (Math.hypot(pv.x - s.x, pv.z - s.z) < 320) at = k;
    if (!at || this.riding(player)) { this._callT = 0; return; }
    if (this.boats.some((b) => b.state === 'dock' && b.at === at)) { this._callT = 0; return; }
    this._callT += dt;
    if (this._callT < 6) return;
    this._callT = -1e9;   // once per visit
    // the boat that would reach you soonest, moved up the route to ~2 km out
    const L = this.route.len, OUT = 2000;
    let best = null, bestS = Infinity;
    for (const b of this.boats) {
      const toward = b.state === 'sail' && b.to === at;
      const left = toward ? (at === 'bi' ? L - b.s : b.s) : Infinity;
      const cost = toward ? left : b.state === 'dock' ? L + b.t * JUMBO.cruise : Infinity;
      if (cost < bestS) { bestS = cost; best = b; }
    }
    if (!best) return;
    if (best.state === 'dock') best.depart();
    const want = at === 'bi' ? L - OUT : OUT;
    const left = at === 'bi' ? L - best.s : best.s;
    if (left > OUT) { best.s = want; best.v = best.dir * JUMBO.cruise * 0.6; }
    this._place(best);
    this.stats.calls++;
    const min = Math.max(1, Math.round(((at === 'bi' ? L - best.s : best.s)) / 3.4 / 60));
    this.say(`The ${best.name} is on its way to ${this.slips[at].short} — about ${min} min`, 4500);
  }

  say(txt, ms) { if (this.hud) this.hud.showToast(txt, ms); }

  // --- the readout and the button -------------------------------------------------

  _hud(player) {
    this._call(player, 1 / 60);
    const b = this.riding(player);
    let txt = null, btn = null;
    const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    if (b) {
      const dest = this.slips[b.state === 'dock' ? (b.t > DWELL - 20 ? b.at : b.to) : b.to];
      if (b.state === 'dock') {
        const arrived = b.t > DWELL - 40;
        txt = arrived ? `M/V ${b.name} · ${this.slips[b.at].name} — drive off` : `M/V ${b.name} to ${this.slips[b.to].name} · departs in ${mmss(Math.max(0, b.t))}`;
        btn = arrived ? null : 'SAIL ▸';
      } else {
        const e = b.eta();
        txt = `M/V ${b.name} to ${dest.name} · about ${Math.max(1, Math.round(e / 60))} min`;
        btn = 'ARRIVE ▸';
      }
    } else {
      const o = player.vehicle || player;
      for (const [k, s] of Object.entries(this.slips)) {
        if (Math.hypot(o.x - s.x, o.z - s.z) > 320) continue;
        const docked = this.boats.find((q) => q.state === 'dock' && q.at === k);
        const other = this.slips[k === 'sea' ? 'bi' : 'sea'];
        if (docked) txt = `Ferry to ${other.name} · M/V ${docked.name} departs in ${mmss(Math.max(0, docked.t))} — drive aboard`;
        else {
          const c = this.boats.find((q) => q.state === 'sail' && q.to === k);
          txt = c ? `Ferry to ${other.name} · M/V ${c.name} arriving in about ${Math.max(1, Math.round(c.eta() / 60))} min` : `Ferry to ${other.name}`;
        }
      }
    }
    if (this.hud) {
      if (txt !== null) {
        if (this._objWas === null) this._objWas = this.hud.objective ? this.hud.objective.textContent : '';
        if (txt !== this._objTxt) { this.hud.setObjective(txt); this._objTxt = txt; }
      } else if (this._objWas !== null) {
        this.hud.setObjective(this._objWas || '');
        this._objWas = null; this._objTxt = null;
      }
    }
    if (this.btn) {
      if (btn) { this.btn.textContent = btn; this.btn.style.display = ''; } else this.btn.style.display = 'none';
    }
  }

  /**
   * ARRIVE / SAIL: a pill of its own on the right edge, between the money
   * and speed readout and the driving pad. It used to sit in the top button
   * bar, which runs into the objective line at the top centre -- where this
   * same ferry writes its timetable -- and covered the text it went with.
   */
  _button(renderer) {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('hud') || document.body;
    const el = document.createElement('button');
    el.id = 'ferryBtn';
    el.style.cssText = 'position:absolute;right:calc(16px + var(--safe-r, 0px));top:40%;z-index:7;display:none;'
      + 'height:46px;padding:0 20px;border-radius:23px;border:1px solid rgba(255,255,255,0.35);'
      + 'background:rgba(11,94,58,0.88);color:#fff;font:800 15px/1 system-ui,-apple-system,sans-serif;letter-spacing:0.06em;'
      + 'box-shadow:0 4px 14px rgba(0,0,0,0.35);pointer-events:auto;-webkit-tap-highlight-color:transparent';
    el.textContent = 'ARRIVE ▸';
    el.addEventListener('pointerup', (e) => { e.stopPropagation(); if (this.player) this.skip(this.player); });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    host.appendChild(el);
    this.btn = el;
    window.addEventListener('keydown', (e) => { if ((e.key === 'f' || e.key === 'F') && this.player && this.riding(this.player)) this.skip(this.player); });
    void renderer;
  }

  /** For the maps: the route and where each boat is. */
  mapPoints(step = 50) {
    if (!this._mp) {
      const r = this.route, n = Math.floor(r.len / step) + 1, P = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { P[i * 2] = r.x(i * step); P[i * 2 + 1] = r.z(i * step); }
      this._mp = P;
    }
    return this._mp;
  }
}

// -----------------------------------------------------------------------------
// the vessel
// -----------------------------------------------------------------------------

// linear vertex colours
const C = {
  white: [0.78, 0.8, 0.8], whiteD: [0.62, 0.64, 0.64], green: [0.012, 0.15, 0.07], black: [0.018, 0.018, 0.02],
  red: [0.24, 0.035, 0.03], deck: [0.16, 0.165, 0.17], deckL: [0.62, 0.6, 0.5], ceil: [0.5, 0.52, 0.52],
  glass: [0.03, 0.05, 0.07], seat: [0.05, 0.12, 0.3], wood: [0.3, 0.2, 0.12], steel: [0.3, 0.32, 0.34],
  orange: [0.8, 0.25, 0.02], yellow: [0.8, 0.6, 0.05], stackBlack: [0.02, 0.02, 0.022],
};

/** The hull's half-breadth at the deck edge, z along the boat. Full for the
 *  middle 84 m, rounding in to 7.2 m at each end: a double-ender's spoon. */
function breadth(z) {
  const e = Math.abs(z);
  if (e <= 42) return HB;
  const t = Math.min(1, (e - 42) / (HL - 42));
  return HB * Math.sqrt(1 - 0.72 * t * t);
}
/** ...and at the waterline: finer toward the ends. */
function waterBreadth(z) {
  const e = Math.abs(z);
  if (e <= 38) return HB - 0.3;
  const t = Math.min(1, (e - 38) / (HL - 38));
  return (HB - 0.3) * (1 - 0.78 * Math.pow(t, 1.6));
}
/** The bottom: flat keel, rising at the ends (the overhang under each spoon). */
function keel(z) {
  const e = Math.abs(z);
  if (e <= 52) return -JUMBO.draft;
  const t = Math.min(1, (e - 52) / (HL - 52));
  return -JUMBO.draft + (JUMBO.draft + 1.2) * t * t;
}

function buildVessel(mats, cells, name) {
  const g = new THREE.Group();
  const b = new Builder(false);       // the body, flat vertex colour
  const gl = new Builder(false);      // glazing
  const up = [0, 1, 0];
  const Q = (a, bb, c, d, n, col, B = b) => B.quad(a, bb, c, d, n, [0, 0, 1, 0, 1, 1, 0, 1], col);
  const hullTop = DECK + 1.1;
  // --- the hull, lofted through stations along z -------------------------------
  const ZS = [];
  for (let z = -HL; z <= HL + 1e-6; z += 2.5) ZS.push(Math.min(z, HL));
  // the colour bands up the side: antifouling, boot-top, white, WSF green, white
  const bands = [[-99, -0.35, C.red], [-0.35, 0.45, C.black], [0.45, 1.5, C.white], [1.5, 2.1, C.green], [2.1, 99, C.white]];
  const sideAt = (z, y) => {
    const yb = keel(z), yt = hullTop;
    const wb = waterBreadth(z) * (Math.abs(z) > 52 ? 0.9 : 1), wt = breadth(z);
    if (y <= 0) {
      const t = Math.max(0, (y - yb) / (0 - yb));
      return wb * (0.72 + 0.28 * Math.sqrt(t));
    }
    const t = y / yt;
    return wb + (wt - wb) * Math.pow(t, 0.8);
  };
  const ys = [keel(0), -2.6, -0.35, 0.45, 1.5, 2.1, hullTop];
  for (let i = 0; i < ZS.length - 1; i++) {
    const z0 = ZS[i], z1 = ZS[i + 1];
    for (let k = 0; k < ys.length - 1; k++) {
      const ya0 = Math.max(ys[k], keel(z0)), ya1 = Math.max(ys[k + 1], keel(z0));
      const yb0 = Math.max(ys[k], keel(z1)), yb1 = Math.max(ys[k + 1], keel(z1));
      if (ya1 - ya0 < 0.01 && yb1 - yb0 < 0.01) continue;
      const band = bands.find((q) => (ys[k] + ys[k + 1]) / 2 >= q[0] && (ys[k] + ys[k + 1]) / 2 < q[1]);
      for (const sx of [-1, 1]) {
        Q([sx * sideAt(z0, ya0), ya0, z0], [sx * sideAt(z1, yb0), yb0, z1], [sx * sideAt(z1, yb1), yb1, z1], [sx * sideAt(z0, ya1), ya1, z0], [sx, 0, 0], band[2]);
      }
    }
    // the bottom
    const kb0 = keel(z0), kb1 = keel(z1);
    Q([-sideAt(z0, kb0), kb0, z0], [sideAt(z0, kb0), kb0, z0], [sideAt(z1, kb1), kb1, z1], [-sideAt(z1, kb1), kb1, z1], [0, -1, 0], C.red);
  }
  // the ends: a face across each spoon, from the keel's end up to the deck
  for (const sz of [-1, 1]) {
    const z = sz * HL, yb = keel(z);
    const pts = [yb, 0, 0.45, 1.5, 2.1, hullTop];
    for (let k = 0; k < pts.length - 1; k++) {
      const y0 = pts[k], y1 = pts[k + 1];
      const band = bands.find((q) => (y0 + y1) / 2 >= q[0] && (y0 + y1) / 2 < q[1]);
      Q([-sideAt(z, y0), y0, z], [sideAt(z, y0), y0, z], [sideAt(z, y1), y1, z], [-sideAt(z, y1), y1, z], [0, 0, sz], band[2]);
    }
  }
  // --- the car deck ------------------------------------------------------------
  // the plate, following the hull, with its lanes painted
  for (let i = 0; i < ZS.length - 1; i++) {
    const z0 = ZS[i], z1 = ZS[i + 1];
    const w0 = breadth(z0) - 0.4, w1 = breadth(z1) - 0.4;
    Q([-w0, DECK, z0], [w0, DECK, z0], [w1, DECK, z1], [-w1, DECK, z1], up, C.deck);
    // the deck edge's top: the bulwark's cap
    for (const sx of [-1, 1]) {
      Q([sx * (breadth(z0) - 0.4), hullTop, z0], [sx * breadth(z0), hullTop, z0], [sx * breadth(z1), hullTop, z1], [sx * (breadth(z1) - 0.4), hullTop, z1], up, C.white);
      Q([sx * (breadth(z0) - 0.4), DECK, z0], [sx * (breadth(z1) - 0.4), DECK, z1], [sx * (breadth(z1) - 0.4), hullTop, z1], [sx * (breadth(z0) - 0.4), hullTop, z0], [-sx, 0, 0], C.whiteD);
    }
  }
  for (const lx of [-9.9, -6.6, -3.3, 3.3, 6.6, 9.9]) {
    for (let z = -HL + 6; z < HL - 6; z += 6) {
      if (Math.abs(lx) < 4 && Math.abs(z) < 27) continue;
      Q([lx - 0.06, DECK + 0.012, z], [lx + 0.06, DECK + 0.012, z], [lx + 0.06, DECK + 0.012, z + 3], [lx - 0.06, DECK + 0.012, z + 3], up, C.deckL);
    }
  }
  // the engine casing down the middle: stair doors, vents, a mural of the flag
  b.box(0, DECK, 0, 4.8, PAX - 0.4 - DECK, 52, 0, C.whiteD);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) b.box(sx * 2.45, DECK, sz * 22, 0.05, 2.1, 1.2, 0, C.green);
  // the enclosure: side walls with their openings, from the bulwark to the passenger deck
  const wallTop = PAX - 0.4;
  for (let i = 0; i < ZS.length - 1; i++) {
    const z0 = ZS[i], z1 = ZS[i + 1];
    if (Math.abs(z0) > 58 || Math.abs(z1) > 58) continue;
    const zm = (z0 + z1) / 2;
    // a long row of openings between posts, as a Jumbo Mark II's car deck has
    const open = Math.abs(zm) < 55 && i % 3 !== 0;
    for (const sx of [-1, 1]) {
      const x0 = sx * breadth(z0), x1 = sx * breadth(z1);
      if (open) {
        Q([x0, hullTop, z0], [x1, hullTop, z1], [x1, hullTop + 0.6, z1], [x0, hullTop + 0.6, z0], [sx, 0, 0], C.white);
        Q([x0, wallTop - 0.9, z0], [x1, wallTop - 0.9, z1], [x1, wallTop, z1], [x0, wallTop, z0], [sx, 0, 0], C.white);
      } else {
        Q([x0, hullTop, z0], [x1, hullTop, z1], [x1, wallTop, z1], [x0, wallTop, z0], [sx, 0, 0], C.white);
      }
      // and its inside face (an opening's jambs are the wall's thickness)
      const ix0 = x0 - sx * 0.5, ix1 = x1 - sx * 0.5;
      if (open) {
        Q([ix0, DECK, z0], [ix1, DECK, z1], [ix1, hullTop + 0.6, z1], [ix0, hullTop + 0.6, z0], [-sx, 0, 0], C.ceil);
        Q([ix0, wallTop - 0.9, z0], [ix1, wallTop - 0.9, z1], [ix1, wallTop, z1], [ix0, wallTop, z0], [-sx, 0, 0], C.ceil);
        Q([x0, hullTop + 0.6, z0], [x1, hullTop + 0.6, z1], [ix1, hullTop + 0.6, z1], [ix0, hullTop + 0.6, z0], up, C.white);
        Q([ix0, wallTop - 0.9, z0], [ix1, wallTop - 0.9, z1], [x1, wallTop - 0.9, z1], [x0, wallTop - 0.9, z0], [0, -1, 0], C.white);
      } else Q([ix0, DECK, z0], [ix1, DECK, z1], [ix1, wallTop, z1], [ix0, wallTop, z0], [-sx, 0, 0], C.ceil);
    }
  }
  // --- the passenger deck: slab (the car deck's ceiling), promenade, cabin ----
  const slab = (x0, x1, z0, z1) => {
    b.quad([x0, PAX, z0], [x1, PAX, z0], [x1, PAX, z1], [x0, PAX, z1], up, [0, 0, 1, 0, 1, 1, 0, 1], C.deck);
    b.quad([x0, wallTop, z0], [x0, wallTop, z1], [x1, wallTop, z1], [x1, wallTop, z0], [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], C.ceil);
  };
  // the ceiling is left open over the four stairs
  for (const [z0, z1] of [[-57.5, -44], [-44, -30], [-30, 30], [30, 44], [44, 57.5]]) {
    const stair = Math.abs(z0) >= 30 && Math.abs(z1) >= 30 && Math.abs(z0) <= 44 && Math.abs(z1) <= 44;
    if (stair) { slab(-11.2, 11.2, z0, z1); } else slab(-13.2, 13.2, z0, z1);
  }
  // the slab's edge, the deck's outer face
  for (const sz of [-1, 1]) Q([-13.2, wallTop, sz * 57.5], [13.2, wallTop, sz * 57.5], [13.2, PAX, sz * 57.5], [-13.2, PAX, sz * 57.5], [0, 0, sz], C.white);
  for (const sx of [-1, 1]) Q([sx * 13.2, wallTop, -57.5], [sx * 13.2, wallTop, 57.5], [sx * 13.2, PAX, 57.5], [sx * 13.2, PAX, -57.5], [sx, 0, 0], C.white);
  // railings round the open end decks
  const rail = (x0, z0, x1, z1, y, B = b) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 1.6));
    const nx = (z1 - z0) / L, nz = -(x1 - x0) / L;
    B.quad([x0, y + 1.05, z0], [x1, y + 1.05, z1], [x1, y + 0.98, z1], [x0, y + 0.98, z0], [nx, 0, nz], [0, 0, 1, 0, 1, 1, 0, 1], C.white);
    B.quad([x0, y + 0.55, z0], [x1, y + 0.55, z1], [x1, y + 0.5, z1], [x0, y + 0.5, z0], [nx, 0, nz], [0, 0, 1, 0, 1, 1, 0, 1], C.white);
    for (let k = 0; k <= n; k++) { const t = k / n; B.box(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, 0.06, 1.05, 0.06, 0, C.white); }
  };
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) rail(sx * 13.1, sz * CAB_Z, sx * 13.1, sz * 57.4, PAX);
    rail(-13.1, sz * 57.4, 13.1, sz * 57.4, PAX);
  }
  // the cabin: nearly full width, a deep band of windows over a white
  // spandrel with the green line, the sun deck's overhang above
  const cabH = SUN - 0.3 - PAX, wLo = PAX + 0.85, wHi = PAX + 2.55;
  for (const sx of [-1, 1]) {
    const x = sx * CAB_X;
    Q([x, PAX, -CAB_Z], [x, PAX, CAB_Z], [x, wLo, CAB_Z], [x, wLo, -CAB_Z], [sx, 0, 0], C.white);
    Q([x, wHi, -CAB_Z], [x, wHi, CAB_Z], [x, PAX + cabH, CAB_Z], [x, PAX + cabH, -CAB_Z], [sx, 0, 0], C.white);
    Q([x + sx * 0.012, PAX + 0.42, -CAB_Z], [x + sx * 0.012, PAX + 0.42, CAB_Z], [x + sx * 0.012, PAX + 0.6, CAB_Z], [x + sx * 0.012, PAX + 0.6, -CAB_Z], [sx, 0, 0], C.green);
    Q([x + sx * 0.01, wLo, -CAB_Z], [x + sx * 0.01, wLo, CAB_Z], [x + sx * 0.01, wHi, CAB_Z], [x + sx * 0.01, wHi, -CAB_Z], [sx, 0, 0], C.glass, gl);
    for (let z = -CAB_Z; z <= CAB_Z + 1e-6; z += 1.84) b.box(x + sx * 0.03, wLo, z, 0.1, wHi - wLo, 0.16, 0, C.whiteD);
    // inside faces
    const xi = sx * (CAB_X - 0.03);
    Q([xi, PAX, -CAB_Z], [xi, PAX, CAB_Z], [xi, wLo, CAB_Z], [xi, wLo, -CAB_Z], [-sx, 0, 0], C.ceil);
    Q([xi, wHi, -CAB_Z], [xi, wHi, CAB_Z], [xi, PAX + cabH, CAB_Z], [xi, PAX + cabH, -CAB_Z], [-sx, 0, 0], C.ceil);
  }
  // the end walls, with their two doorways open
  for (const sz of [-1, 1]) {
    const z = sz * CAB_Z;
    let x = -CAB_X;
    for (const [d0, d1] of [...DOORS, [CAB_X, CAB_X]]) {
      if (d0 - x > 0.05) {
        for (const [zz, nz, col, B] of [[z, sz, C.white, b], [z - sz * 0.03, -sz, C.ceil, b]]) {
          Q([x, PAX, zz], [d0, PAX, zz], [d0, wLo, zz], [x, wLo, zz], [0, 0, nz], col, B);
          Q([x, wHi, zz], [d0, wHi, zz], [d0, PAX + cabH, zz], [x, PAX + cabH, zz], [0, 0, nz], col, B);
        }
        Q([x, wLo, z + sz * 0.01], [d0, wLo, z + sz * 0.01], [d0, wHi, z + sz * 0.01], [x, wHi, z + sz * 0.01], [0, 0, sz], C.glass, gl);
      }
      if (d1 < CAB_X) {
        // the doorway's head and frame
        Q([d0, PAX + 2.2, z], [d1, PAX + 2.2, z], [d1, PAX + cabH, z], [d0, PAX + cabH, z], [0, 0, sz], C.white);
        for (const xx of [d0, d1]) b.box(xx, PAX, z, 0.14, 2.2, 0.24, 0, C.green);
      }
      x = d1;
    }
  }
  // inside: booths down both sides and across the middle, a galley counter
  for (let z = -43; z <= 43; z += 3.2) {
    if (Math.abs(z) < 3) continue;
    for (const x of [-9.6, -5.6, 5.6, 9.6]) {
      if (Math.abs(x) > 9 && Math.abs(z) > 28 && Math.abs(z) < 46) continue;   // clear of the stairwells
      b.box(x, PAX, z, 1.9, 0.45, 1.1, 0, C.seat);
      b.box(x, PAX, z - 0.5, 1.9, 1.05, 0.2, 0, C.seat);
      b.box(x, PAX, z + 0.9, 1.1, 0.72, 0.7, 0, C.wood);
    }
  }
  b.box(0, PAX, 0, 6, 1.05, 2.2, 0, C.wood);
  // the stairwells' balustrades, inside the cabin
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 11.15;
    b.box(x, PAX, sz * 37, 0.08, 1.0, 14, 0, C.green);
  }
  // the ceiling, seen from inside
  b.quad([-CAB_X, PAX + cabH - 0.02, -CAB_Z], [-CAB_X, PAX + cabH - 0.02, CAB_Z], [CAB_X, PAX + cabH - 0.02, CAB_Z], [CAB_X, PAX + cabH - 0.02, -CAB_Z], [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], C.ceil);
  // the cabin roof, and the sun deck on it
  b.box(0, SUN - 0.3, 0, 2 * CAB_X + 0.6, 0.3, 2 * SUN_Z, 0, C.whiteD);
  b.quad([-12.6, SUN + 0.005, -SUN_Z], [12.6, SUN + 0.005, -SUN_Z], [12.6, SUN + 0.005, SUN_Z], [-12.6, SUN + 0.005, SUN_Z], up, [0, 0, 1, 0, 1, 1, 0, 1], [0.3, 0.32, 0.31]);
  for (const sx of [-1, 1]) rail(sx * 12.75, -SUN_Z, sx * 12.75, SUN_Z, SUN);
  // the ends, open at each stair's head
  rail(-12.75, SUN_Z, 11.3, SUN_Z, SUN);
  rail(-11.3, -SUN_Z, 12.75, -SUN_Z, SUN);
  // benches, life-raft canisters, and the windbreak panels down the middle
  for (let z = -40; z <= 40; z += 8) for (const sx of [-1, 1]) b.box(sx * 9.4, SUN, z, 0.7, 0.45, 3.2, 0, C.wood);
  for (let z = -43; z <= 43; z += 2.4) for (const sx of [-1, 1]) {
    if (Math.abs(z) < 5) continue;
    b.box(sx * 12.0, SUN, z, 0.95, 0.6, 1.8, 0, C.white);
    b.box(sx * 12.0, SUN + 0.25, z, 0.97, 0.08, 1.82, 0, C.orange);
  }
  // (glazed in a white frame: a solid dark board read as a slab from the deck)
  for (const sz of [-1, 1]) {
    const z0 = sz * 20 - 7, z1 = sz * 20 + 7;
    b.box(0, SUN, sz * 20, 0.14, 0.3, 14, 0, C.white);
    b.box(0, SUN + 1.52, sz * 20, 0.14, 0.08, 14, 0, C.white);
    for (let z = z0; z <= z1 + 1e-6; z += 3.5) b.box(0, SUN, z, 0.14, 1.6, 0.1, 0, C.white);
    for (const sx of [-1, 1]) Q([sx * 0.02, SUN + 0.3, z0], [sx * 0.02, SUN + 0.3, z1], [sx * 0.02, SUN + 1.52, z1], [sx * 0.02, SUN + 1.52, z0], [sx, 0, 0], C.glass, gl);
  }
  // the stairs: stringers and treads
  const stair = (x0, x1, z0, z1, y0, y1) => {
    const n = Math.max(4, Math.round(Math.abs(y1 - y0) / 0.19));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const za = z0 + (z1 - z0) * t0, zb = z0 + (z1 - z0) * t1, ya = y0 + (y1 - y0) * t0;
      b.box((x0 + x1) / 2, ya, (za + zb) / 2, x1 - x0, (y1 - y0) / n, Math.abs(zb - za), 0, C.steel);
    }
  };
  for (const r of SURF) if (r.lvl === 'stair') stair(r.x0 + 0.05, r.x1 - 0.05, r.z0, r.z1, r.y0, r.y1);
  // --- the pilothouses at each end --------------------------------------------------
  for (const sz of [-1, 1]) {
    const zc = sz * 50;
    // the crew block it stands on, windows along its sides and end
    b.box(0, PAX, sz * 50.1, 17.6, SUN - 0.3 - PAX, 7.8, 0, C.white);
    for (const sx of [-1, 1]) Q([sx * 8.81, PAX + 1.1, sz * 46.5], [sx * 8.81, PAX + 1.1, sz * 53.7], [sx * 8.81, PAX + 2.2, sz * 53.7], [sx * 8.81, PAX + 2.2, sz * 46.5], [sx, 0, 0], C.glass, gl);
    Q([-7.5, PAX + 1.1, sz * 54.01], [7.5, PAX + 1.1, sz * 54.01], [7.5, PAX + 2.2, sz * 54.01], [-7.5, PAX + 2.2, sz * 54.01], [0, 0, sz], C.glass, gl);
    b.box(0, SUN - 0.3, zc, 16, 0.3, 10, 0, C.white);     // its deck
    b.box(0, SUN, zc, 14, 0.9, 7, 0, C.white);
    // windows all round, over the dash
    for (const [x0, z0, x1, z1] of [[-7, zc + sz * 3.5, 7, zc + sz * 3.5], [-7, zc - sz * 3.5, 7, zc - sz * 3.5], [-7, zc - 3.5, -7, zc + 3.5], [7, zc - 3.5, 7, zc + 3.5]]) {
      const nx = z1 - z0 !== 0 ? Math.sign(x0 || 1) : 0, nz = z1 - z0 !== 0 ? 0 : Math.sign(z0 - zc);
      Q([x0, SUN + 0.9, z0], [x1, SUN + 0.9, z1], [x1, SUN + 2.3, z1], [x0, SUN + 2.3, z0], [nx, 0, nz], C.glass, gl);
    }
    b.box(0, SUN + 2.3, zc, 14.4, 0.7, 7.4, 0, C.white);
    b.box(0, SUN + 3.0, zc, 15, 0.12, 8, 0, C.stackBlack);
    // bridge wings out to the side, and the mast with its lights
    b.box(0, SUN + 0.8, zc, 27.2, 0.12, 2.2, 0, C.white);
    for (const sx of [-1, 1]) b.box(sx * 13.2, SUN + 0.9, zc, 0.12, 1.0, 2.2, 0, C.white);
    b.box(0, SUN + 3.1, zc - sz * 1.5, 0.3, 5.5, 0.3, 0, C.white);
    b.box(-13.3, SUN + 1.5, zc, 0.2, 0.3, 0.4, 0, [0.9, 0.05, 0.03]);
    b.box(13.3, SUN + 1.5, zc, 0.2, 0.3, 0.4, 0, [0.03, 0.8, 0.1]);
    // the end of the car deck's overhead: a beam with the boat's name
    b.box(0, wallTop - 1.0, sz * 57.4, 26.4, 1.0, 0.3, 0, C.white);
  }
  // --- the stacks ---------------------------------------------------------------------
  for (const sx of [-1, 1]) {
    const x = sx * 5.5;
    b.box(x, SUN, 0, 3.4, 7.2, 5.6, 0, C.white);
    b.box(x, SUN + 7.2, 0, 3.5, 1.2, 5.7, 0, C.green);
    b.box(x, SUN + 8.4, 0, 3.4, 0.9, 5.6, 0, C.stackBlack);
  }
  const body = new THREE.Mesh(b.build(), mats.body);
  body.castShadow = true; body.receiveShadow = true;
  const glass = new THREE.Mesh(gl.build(), mats.glass);
  g.add(body, glass);
  // --- lettering ----------------------------------------------------------------------
  const d = new Builder(true);
  const decal = (cell, cx, cy, cz, w, h, nx, nz) => {
    const [u0, v0, u1, v1] = cell;
    const px = nz, pz = -nx;          // along the face, reading left to right from outside
    const a = [cx - px * w / 2, cy - h / 2, cz - pz * w / 2], b2 = [cx + px * w / 2, cy - h / 2, cz + pz * w / 2];
    const c = [cx + px * w / 2, cy + h / 2, cz + pz * w / 2], e = [cx - px * w / 2, cy + h / 2, cz - pz * w / 2];
    d.quad(a, b2, c, e, [nx, 0, nz], [u0, v1, u1, v1, u1, v0, u0, v0], [1, 1, 1]);
  };
  for (const sx of [-1, 1]) {
    decal(cells.wsf, sx * (11.03), PAX + cabH - 0.25, 0, 22, 1.1, sx, 0);
    decal(cells.wsf, sx * (breadth(0) + 0.02), hullTop + 1.6, 0, 30, 1.5, sx, 0);
    decal(cells[name], sx * (breadth(30) + 0.02), 2.9, sx * 30, 12, 1.2, sx, 0);
  }
  for (const sz of [-1, 1]) {
    decal(cells[name], 0, wallTop - 0.5, sz * 57.58, 12, 0.8, 0, sz);
    decal(cells[name], 0, SUN + 2.65, sz * 53.72, 8, 0.55, 0, sz);
  }
  g.add(new THREE.Mesh(d.build(), mats.decal));
  for (const m of g.children) m.matrixAutoUpdate = false;
  return g;
}

/** "WASHINGTON STATE FERRIES" and the boats' names, WSF green on clear. */
function decalTexture() {
  if (typeof document === 'undefined') return { tex: null, cells: { wsf: [0, 0, 1, 0.25], Wenatchee: [0, 0.25, 1, 0.5], Tacoma: [0, 0.5, 1, 0.75] } };
  const W = 2048, H = 512, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const rows = [['wsf', 'WASHINGTON STATE FERRIES'], ['Wenatchee', 'WENATCHEE'], ['Tacoma', 'TACOMA']];
  const cells = {};
  rows.forEach(([k, txt], i) => {
    const y0 = i * 128;
    x.font = `bold ${i ? 96 : 84}px "Helvetica Neue", Arial, sans-serif`;
    x.fillStyle = '#0b5a37';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(txt, W / 2, y0 + 64, W - 40);
    cells[k] = [0, i * 0.25, 1, (i + 1) * 0.25];
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.flipY = false;
  return { tex, cells };
}

// -----------------------------------------------------------------------------
// the terminals: what the slips are built of
// -----------------------------------------------------------------------------

function buildTerminal(s, dolphins, mat) {
  const b = new Builder(false);
  {
    // the slip's frame: +u out along the axis (where the boat lies), +v across
    const ux = s.dx, uz = s.dz, vx = -uz, vz = ux;
    const P = (u, v, y) => [s.x + ux * u + vx * v, y, s.z + uz * u + vz * v];
    const rot = -Math.atan2(uz, ux);
    // the transfer span's towers either side of its end, and the beam across
    for (const sv of [-1, 1]) {
      const [x, , z] = P(-2, sv * 8.5, 0);
      b.box(x, -1, z, 1.2, DECK + 12, 1.2, rot, C.steel);
      b.box(x, DECK + 6, z, 2.4, 3, 2.4, rot, C.green);
    }
    {
      const [x, , z] = P(-2, 0, 0);
      b.box(x, DECK + 10.5, z, 1.0, 1.2, 18.2, rot, C.steel);
    }
    // the wingwalls: timber fenders either side of the berth, 40 m out
    for (const sv of [-1, 1]) {
      const v = sv * (HB + 0.9);
      for (let u = 1; u < 42; u += 4) { const [x, , z] = P(u, v, 0); b.box(x, -2, z, 0.5, DECK + 3, 0.5, rot, C.wood); }
      for (const y of [0.4, 2.2, 4.0]) {
        const a = P(0.5, v, y), c = P(42, v, y);
        b.box((a[0] + c[0]) / 2, y, (a[2] + c[2]) / 2, 41.5, 0.45, 0.35, rot, C.wood);
      }
    }
  }
  // dolphins, where OSM maps them: a cluster of piles under a cap
  for (const [x, z] of dolphins) {
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      b.box(x + Math.cos(a) * 1.4, -2, z + Math.sin(a) * 1.4, 0.55, DECK + 4.2, 0.55, 0, C.wood);
    }
    b.box(x, DECK + 2.2, z, 3.6, 0.5, 3.6, 0, C.black);
  }
  const m = new THREE.Mesh(b.build(), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
