// Stunt jumps: ramps at real places in the city, and the scoring that pays for
// flying off them.
//
// A RAMP IS GEOMETRY WITH ITS OWN HEIGHT QUERY, like a lid (see "Cut-and-cover
// lids"): this file draws it and city.setRamps / city.rampY answer for it, from
// the same numbers, so what you see is what you drive on. The profile is a
// kicker -- H * (A s + (1 - A) s^2) over the ramp's length -- so the toe is a
// gentle 5-6 deg and the lip leaves at the jump's authored angle. Sides and the
// back of the lip are walls in the barrier store, banded so that they stop a
// car on the ground beside the ramp and never one driving up it.
//
// Every ramp stands OFF the carriageways traffic uses (at the end of a dead
// end, in a park, a lot or on a pier), so AI cars never meet one; a kept-clear
// corridor over run-up, ramp and landing keeps trees, posts and parked cars out
// of the way (city.jumpClear, asked by world.js's scatter and lot parking).
//
// SCORING. vehicles.js launches the car (Vehicle.stuntAir) and leaves
// `stuntLaunch` / `stuntLanded` on it; this file only watches the player's own
// vehicle, so it costs nothing per AI car. A jump counts from STUNT_MIN_SPEED at
// the lip; distance is lip to touchdown, flat; rotation is the body's yaw spin
// (steering spins the car in the air -- the flight path is held). A clean
// landing is upright, wheels-first within 25 deg of the direction of travel,
// out of the water and not badly damaged, and only a clean landing ticks off
// the jump's unique completion (persisted in localStorage 'autokw-stunts').

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { RAMP_A } from './citygen.js';
import { clamp, angleWrap } from './util.js';

export const STUNT_MIN_SPEED = 13;   // m/s along the ramp at the lip (~47 km/h)
const STUNT_G = 15;                   // matches vehicles.js
const DEF_DEG = 19;                   // lip angle
const DEF_H = 2.2, DEF_W = 7, DEF_LAND = 90;
const CINE_MIN_AIR = 0.85;   // predicted airtime (s) that earns the slow-motion cinematic
const CINE_SLOW = 0.65;      // time scale 0.35 at the middle of the flight
const UV0 = [0, 0, 0, 0, 0, 0, 0, 0];   // Builder(false) ignores them, quad() still reads them

/**
 * The jumps. `sx, sz` is where the run-up starts, `x, z` the centre of the
 * lip; the ramp points from one to the other. `land` is how much ground past
 * the lip is kept clear. Chosen from the map and drive-tested with
 * tools/stuntjumps.mjs -- change one, re-run it.
 */
export const JUMPS = [
  { id: 'chicopee', name: 'Chicopee Ski Hill', over: 'down the groomed slope from the top of Chicopee, toward the ponds',
    sx: 4318, sz: 2048, x: 4480, z: 1930, H: 3, deg: 24, land: 130 },
  { id: 'ykf', name: 'YKF Runway', over: 'a kicker on the Region of Waterloo International Airport\'s main runway',
    sx: 7281, sz: -745, x: 7521, z: -564, H: 2.4, deg: 20, land: 160 },
  { id: 'freeport', name: 'Freeport Leap', over: 'the Grand River at Freeport, bank to bank, below WRHN @ Chicopee',
    sx: 5100, sz: 3220, x: 5164, z: 3284, H: 3, deg: 26, land: 90 },
  { id: 'doon', name: 'Doon Gorge', over: 'the Grand River channel at Doon, beside the golf course',
    sx: 4589, sz: 4718, x: 4654, z: 4718, H: 3, deg: 26, land: 90 },
  { id: 'laurelres', name: 'Laurel Creek Reservoir', over: 'across the inlet at the Laurel Creek Conservation Area',
    sx: -8628, sz: -2770, x: -8538, z: -2770, H: 3.2, deg: 30, land: 90 },
  { id: 'dam', name: 'Laurel Dam Splash', over: 'off the grass by Laurel Dam, into the reservoir',
    sx: -7751, sz: -3605, x: -7805, z: -3595, H: 3, deg: 26, land: 70, water: true },
  { id: 'ionpark', name: 'ION at Waterloo Park', over: 'across the ION tracks through Waterloo Park',
    sx: -4609, sz: -1821, x: -4669, z: -1769, H: 3, deg: 26, land: 90 },
  { id: 'ionnorth', name: 'ION at Northfield', over: 'across the ION tracks in the north end, by Northfield Dr',
    sx: -5280, sz: -4535, x: -5360, z: -4541, H: 3, deg: 26, land: 90 },
  { id: 'ionblock', name: 'ION at Block Line', over: 'across the ION tracks in the Doon-side fields by Block Line Rd',
    sx: 2035, sz: 3412, x: 2045, z: 3441, H: 3, deg: 26, land: 90 },
  { id: 'tobog', name: 'Toboggan Hill', over: 'off the top of Toboggan Hill in Kitchener\'s Laurentian Hills',
    sx: -1384, sz: 3553, x: -1313, z: 3482, H: 3, deg: 26, land: 90 },
  { id: 'boardwalk', name: 'The Boardwalk Berm', over: 'down the field west of The Boardwalk\'s lots',
    sx: -7221, sz: 1899, x: -7150, z: 1970, H: 3, deg: 26, land: 90 },
  { id: 'rim', name: 'RIM Park', over: 'across the fields beside RIM Park\'s ball diamonds',
    sx: -2150, sz: -7380, x: -2250, z: -7380, H: 3, deg: 26, land: 90 },
  { id: 'vicpark', name: 'Victoria Park Neck', over: 'across the lake\'s narrow neck in Victoria Park',
    sx: -1875, sz: 680, x: -1862, z: 632, H: 3.2, deg: 28, land: 90 },
  { id: 'kartpit', name: 'Erbsville Pit', over: 'across the pond in the sand pit behind the Kartway',
    sx: -9895, sz: -3093, x: -9810, z: -3093, H: 3.4, deg: 30, land: 90 },
  { id: 'uwring', name: 'UW Ring Road', over: 'across the open lawn off the University of Waterloo\'s Ring Road',
    sx: -5320, sz: -1833, x: -5357, z: -1926, H: 3, deg: 26, land: 90 },
  { id: 'fairview', name: 'Fairview Park Lot', over: 'the long, empty lot west of CF Fairview Park',
    sx: 2660, sz: 3177, x: 2731, z: 3106, H: 3, deg: 26, land: 90 },
  { id: 'recomplex', name: 'Grand River Rec Complex', over: 'across the sports fields by the Grand River Rec Complex',
    sx: 3088, sz: -429, x: 3188, z: -429, H: 3, deg: 26, land: 90 },
  { id: 'museum', name: 'Region Museum Meadow', over: 'the meadow beside the Waterloo Region Museum',
    sx: 2829, sz: 5513, x: 2900, z: 5584, H: 3, deg: 26, land: 90 },
  { id: 'breslau', name: 'Breslau Barn Hop', over: 'a farm lane and the fields past it, near Breslau',
    sx: 5437, sz: -3143, x: 5508, z: -3072, H: 3, deg: 26, land: 90 },
  { id: 'conest', name: 'Conestoga Mall West Lot', over: 'the open ground west of Conestoga Mall',
    sx: -4367, sz: -5018, x: -4404, z: -5111, H: 3, deg: 26, land: 90 },
  { id: 'hesplot', name: 'Hespeler Mill Lot', over: 'the big flat lots on Hespeler\'s west side',
    sx: 12450, sz: 2150, x: 12550, z: 2150, H: 3, deg: 26, land: 90 },
];

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * Surface under the ramp's footprint before it is built: the highest one
 * there -- terrain plus paved lift, or a pier deck the ramp stands on.
 * installRamps takes the existing ramps out of the query while it asks.
 */
function baseAt(city, x, z) {
  return city.groundAt(x, z, null);
}

/** Turn authored jumps into ramp records and install them on the city. */
export function installRamps(city, defs = JUMPS) {
  const ramps = [], clear = [], segs = [];
  // a re-install (tools) hands the previous ramps' blocks back to traffic
  if (city.ramps) for (const r of city.ramps) for (const ei of r.edges) city.edges[ei].noTraffic = false;
  city.rampMask = null;
  for (const j of defs) {
    const H = j.H || DEF_H, W = j.W || DEF_W, deg = j.deg || DEF_DEG, land = j.land || DEF_LAND;
    const L = (2 - RAMP_A) * H / Math.tan(deg * Math.PI / 180);
    let dx = j.x - j.sx, dz = j.z - j.sz;
    const run = Math.hypot(dx, dz);
    dx /= run; dz /= run;
    const px = -dz, pz = dx;          // left of travel
    const x0 = j.x - dx * L, z0 = j.z - dz * L;
    const across = (u) => {
      let m = -1e9;
      for (const v of [-W / 2, -W / 4, 0, W / 4, W / 2]) m = Math.max(m, baseAt(city, x0 + dx * u + px * v, z0 + dz * u + pz * v));
      return m;
    };
    // The deck continues the APPROACH's grade, not the ground under the lip:
    // at a cliff edge the ground falls away under the lip, and a base line
    // following it tilts the whole kicker down and leaves it launching flat.
    const y0 = across(0) + 0.02;
    const grade = clamp((y0 - across(-8) - 0.02) / 8, -0.12, 0.12);
    const r = { jump: j, x0, z0, dx, dz, px, pz, L, W, H, y0, y1: y0 + grade * L };
    // The base line is a chord; where the ground bulges over it (a crest under
    // the ramp) lift the whole ramp so no terrain shows through the deck.
    let lift = 0;
    for (let u = 0; u <= L; u += 1) {
      const s = u / L;
      const top = r.y0 + (r.y1 - r.y0) * s + H * (RAMP_A * s + (1 - RAMP_A) * s * s);
      lift = Math.max(lift, across(u) + 0.03 - top);
    }
    r.y0 += lift; r.y1 += lift;
    // A ramp at the end of a dead-end street stands on that street's last
    // block: traffic is kept off every edge under it (traffic.js skips
    // `noTraffic` in its graph, spawns, routing and kerbside parking), so no
    // AI car ever meets it. A freeway or deck under a ramp is a siting error,
    // reported to tools/stuntjumps.mjs rather than silently closed.
    r.edges = [];
    r.bad = [];
    for (let u = -4; u <= L + 4; u += 2) {
      for (let v = -W / 2 - 2; v <= W / 2 + 2; v += 2) {
        const x = x0 + dx * u + px * v, z = z0 + dz * u + pz * v;
        for (const ei of city.roadsNear(x, z, 0)) {
          const e = city.edges[ei];
          const a = city.nodes[e.a], bn = city.nodes[e.b];
          const ex = bn.x - a.x, ez = bn.z - a.z, l2 = ex * ex + ez * ez || 1;
          const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / l2, 0, 1);
          if (Math.hypot(x - a.x - ex * t, z - a.z - ez * t) > e.hw + 2.5) continue;
          if (e.cls === 'hwy' || e.cls === 'ramp' || e.tunnel) { if (!r.bad.includes(ei)) r.bad.push(ei); continue; }
          if (!e.noTraffic) { e.noTraffic = true; r.edges.push(ei); }
        }
      }
    }
    ramps.push(r);
    j.ramp = r;
    const top = (u) => { const s = clamp(u / L, 0, 1); return r.y0 + (r.y1 - r.y0) * s + H * (RAMP_A * s + (1 - RAMP_A) * s * s); };
    // Walls. A car's collision circle reaches ~2.4 m, so a band top of "the
    // deck 3 m further back, less 0.2" is under every car on the ramp near
    // that wall and over every car on the ground beside it.
    const pushSeg = (ax, az, bx, bz, y0, y1) => { if (y1 > y0 + 0.3) segs.push(ax, az, bx, bz, y0, y1); };
    for (let u = 0; u < L - 0.01; u += 1.5) {
      const ub = Math.min(L, u + 1.5);
      const yb = top(u - 3) - 0.2;
      const gy = baseAt(city, x0 + dx * u, z0 + dz * u);
      if (yb < gy + 0.35) continue;
      for (const sd of [-1, 1]) {
        const ox = px * sd * W / 2, oz = pz * sd * W / 2;
        pushSeg(x0 + dx * u + ox, z0 + dz * u + oz, x0 + dx * ub + ox, z0 + dz * ub + oz, gy - 2.5, yb);
      }
    }
    {
      const yb = top(L - 3) - 0.2, gy = r.y1;
      const lx = j.x, lz = j.z;
      pushSeg(lx - px * W / 2, lz - pz * W / 2, lx + px * W / 2, lz + pz * W / 2, gy - 2.5, yb);
    }
    // Run-up and landing kept clear, and a little either side.
    const back = Math.max(0, run - L);
    clear.push({ x: x0, z: z0, dx, dz, px, pz, u0: -back - 4, u1: L + land, hw: W / 2 + 4, reach: back + L + land + W + 10 });
    j.clear = clear[clear.length - 1];
  }
  city.rampSegs = segs;
  city.setRamps(ramps, clear);
  return ramps;
}

/** One merged mesh for every ramp: a single draw, whatever the count. */
export function buildRampMesh(city, ramps, material) {
  const b = new Builder(false);
  // the walls reach down to what the ramp stands on, not to the ramp itself
  const mask = city.rampMask;
  city.rampMask = null;
  const STEEL = [0.16, 0.165, 0.17], STEEL2 = [0.12, 0.125, 0.13];
  const YEL = [0.78, 0.55, 0.04], BLK = [0.035, 0.035, 0.035];
  const RED = [0.55, 0.06, 0.05], WHITE = [0.78, 0.78, 0.74];
  const ORANGE = [0.95, 0.32, 0.03];
  for (const r of ramps) {
    const { x0, z0, dx, dz, px, pz, L, W, H } = r;
    const P = (u, v, y) => [x0 + dx * u + px * v, y, z0 + dz * u + pz * v];
    const top = (u) => { const s = clamp(u / L, 0, 1); return r.y0 + (r.y1 - r.y0) * s + H * (RAMP_A * s + (1 - RAMP_A) * s * s); };
    const ground = (u, v) => baseAt(city, x0 + dx * u + px * v, z0 + dz * u + pz * v) - 0.25;
    const nTop = (u) => {
      const sl = city.rampSlope(r, x0 + dx * u, z0 + dz * u);
      const k = 1 / Math.hypot(1, sl);
      return [-dx * sl * k, k, -dz * sl * k];
    };
    const N = Math.max(6, Math.ceil(L / 1.2));
    // deck: two strips across, plank tone alternating along the length
    for (let i = 0; i < N; i++) {
      const ua = (i / N) * L, ub = ((i + 1) / N) * L;
      const col = i % 2 ? STEEL : STEEL2;
      for (const [va, vb] of [[-W / 2, 0], [0, W / 2]]) {
        b.quad(P(ua, va, top(ua)), P(ub, va, top(ub)), P(ub, vb, top(ub)), P(ua, vb, top(ua)),
          [nTop(ua), nTop(ub), nTop(ub), nTop(ua)], UV0, col);
      }
    }
    // chevrons pointing up the ramp, painted 2 cm proud
    const paint = (u, v, cu, cv, col) => {
      // parallelogram from (u, v) along (cu, cv) with 0.45 m of thickness along u
      const t = 0.45;
      const y = (uu) => top(uu) + 0.02;
      b.quad(P(u, v, y(u)), P(u + cu, v + cv, y(u + cu)), P(u + cu + t, v + cv, y(u + cu + t)), P(u + t, v, y(u + t)),
        nTop(u), UV0, col);
    };
    for (const s of [0.22, 0.47, 0.72]) {
      const u = s * L, span = W * 0.36;
      paint(u, -span, span * 0.55, span, YEL);
      paint(u, span, span * 0.55, -span, YEL);
    }
    // hazard band at the lip
    const nb = 6;
    for (let k = 0; k < nb; k++) {
      const va = -W / 2 + (k / nb) * W, vb = -W / 2 + ((k + 1) / nb) * W, ua = L - 0.7;
      b.quad(P(ua, va, top(ua) + 0.02), P(L, va, top(L) + 0.02), P(L, vb, top(L) + 0.02), P(ua, vb, top(ua) + 0.02),
        nTop(L), UV0, k % 2 ? BLK : YEL);
    }
    // kerb-striped sides, down to the ground
    for (const sd of [-1, 1]) {
      const v = sd * W / 2;
      const n = [px * sd, 0, pz * sd];
      for (let i = 0; i < N; i++) {
        const ua = (i / N) * L, ub = ((i + 1) / N) * L;
        b.quad(P(ua, v, ground(ua, v)), P(ub, v, ground(ub, v)), P(ub, v, top(ub)), P(ua, v, top(ua)), n, UV0, i % 2 ? RED : WHITE);
      }
    }
    // the back of the lip: black and yellow
    for (let k = 0; k < nb; k++) {
      const va = -W / 2 + (k / nb) * W, vb = -W / 2 + ((k + 1) / nb) * W;
      b.quad(P(L, va, ground(L, va)), P(L, vb, ground(L, vb)), P(L, vb, top(L)), P(L, va, top(L)), [dx, 0, dz], UV0, k % 2 ? YEL : BLK);
    }
    // marker posts with pennants at the lip corners: the world marker
    for (const sd of [-1, 1]) {
      const [mx, , mz] = P(L - 0.3, sd * (W / 2 + 0.35), 0);
      const gy = baseAt(city, mx, mz) - 0.1, hTop = top(L) + 3.2 - gy;
      b.prism(mx, gy, mz, 0.09, hTop * 0.5, 6, ORANGE);
      b.prism(mx, gy + hTop * 0.5, mz, 0.09, hTop * 0.25, 6, WHITE);
      b.prism(mx, gy + hTop * 0.75, mz, 0.09, hTop * 0.25, 6, ORANGE);
      const fy = gy + hTop;
      const fa = [mx, fy, mz], fb = [mx, fy - 0.7, mz], fc = [mx - dx * 1.1, fy - 0.35, mz - dz * 1.1];
      b.tri(fa, fb, fc, [px, 0, pz], ORANGE);
      b.tri(fa, fc, fb, [-px, 0, -pz], ORANGE);
    }
  }
  city.rampMask = mask;
  if (b.empty) return null;
  const mesh = new THREE.Mesh(b.build(), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.name = 'stuntRamps';
  return mesh;
}

function loadSave() {
  try { const s = JSON.parse(localStorage.getItem('autokw-stunts') || '{}'); return { done: s.done || [], best: s.best || {}, found: s.found || [] }; } catch (e) { return { done: [], best: {}, found: [] }; }
}

export class StuntJumps {
  constructor(city, game, hud, audio) {
    this.city = city; this.game = game; this.hud = hud; this.audio = audio;
    this.list = JUMPS.filter((j) => j.ramp);
    this.save = loadSave();
    this.done = new Set(this.save.done);
    for (const j of this.list) { j.done = this.done.has(j.id); j.found = j.done || this.save.found.includes(j.id); }
    this.side = 1.25;
    this.run = null;
    this.timeScale = 1;
    this.camK = 0;
    this.last = null;        // the last jump's result, for tools
    hud.jumps = this.list;
  }

  get busy() { return this.run !== null; }
  get found() { return this.list.filter((j) => j.found).length; }
  get completed() { return this.list.filter((j) => j.done).length; }

  persist() {
    this.save.done = [...this.done];
    try { localStorage.setItem('autokw-stunts', JSON.stringify(this.save)); } catch (e) { /* private mode */ }
  }

  update(dt, player) {
    const v = player.onFoot ? null : player.vehicle;
    let k = 0;
    if (!this.run) {
      if (v && v.stuntLaunch) {
        const r = v.stuntLaunch;
        v.stuntLaunch = null;
        v.stuntLanded = false;
        const sp = v.rampAlong;
        if (sp >= STUNT_MIN_SPEED && r.jump) {
          // Airtime over level ground, for pacing the slow motion only.
          const pred = (2 * v.vy) / STUNT_G;
          this.run = { v, jump: r.jump, x0: v.x, z0: v.z, y0: v.y, t: 0, yaw: 0, lastH: v.heading,
            health0: v.health, maxUp: 0, pred, speed: sp, wall: performance.now(), noCine: false };
          // the cinematic's side: the player's own side of the flight path,
          // alternating so a jump's replays do not all frame from one side
          this.side = ((this.flips = (this.flips || 0) + 1) % 2 ? 1 : -1) * 1.25;
          if (!r.jump.found) { r.jump.found = true; this.save.found = this.list.filter((q) => q.found).map((q) => q.id); }
        }
      }
    } else {
      const run = this.run;
      if (v !== run.v) { this.run = null; }
      else {
        run.t += dt;
        run.yaw += angleWrap(v.heading - run.lastH);
        run.lastH = v.heading;
        run.maxUp = Math.max(run.maxUp, v.y - run.y0);
        if (v.stuntLanded || !v.stunt) { v.stuntLanded = false; this.finish(run, v); }
        else if (run.t > 15) this.run = null;
        // Big jumps only, and only through the middle of the flight: slow
        // motion that is still on at touchdown takes the landing out of your
        // hands, which on a phone is the disorienting part.
        else if (run.pred > CINE_MIN_AIR) {
          const ph = run.t / run.pred;
          k = smooth(0.1, 0.24, ph) * (1 - smooth(0.58, 0.78, ph));
          // HARD TIMEOUT, in wall-clock time (game dt is the thing being
          // slowed): whatever else goes wrong, 4.5 s after launch the clock
          // is back at full speed for good.
          if (performance.now() - run.wall > 4500) { run.noCine = true; }
          if (run.noCine) k = 0;
        }
      }
    }
    // The clock must never stay slow: a death, the pause menu, getting out or
    // a hidden tab all drop the cinematic at once (not eased).
    if (this.game.dead || (this.game.paused && !this.ignorePause) || player.onFoot || player.dead || !v || v.dead) {
      if (this.run && (this.game.dead || player.dead || !v || v.dead)) this.run = null;
      k = 0; this.camK = 0;
    }
    // eased either way so neither the camera nor the clock steps
    this.camK += (k - this.camK) * Math.min(1, dt * 6 / Math.max(0.35, this.timeScale));
    if (this.camK < 0.002 && k === 0) this.camK = 0;
    this.timeScale = 1 - CINE_SLOW * this.camK;
    player.stuntCam = this.camK;
    player.stuntSide = this.side;
    this.discover(dt, player);
  }

  /** Drop the cinematic and the slow motion now (respawn, exit, tools). */
  cancel() {
    this.run = null; this.camK = 0; this.timeScale = 1;
  }

  /** A jump is FOUND the first time you come within 110 m of its ramp, in anything; it then shows on the map. */
  discover(dt, player) {
    this.scanT = (this.scanT || 0) - dt;
    if (this.scanT > 0) return;
    this.scanT = 0.5;
    const px = player.position.x, pz = player.position.z;
    for (const j of this.list) {
      if (j.found) continue;
      if (Math.hypot(px - j.x, pz - j.z) > 110) continue;
      j.found = true;
      this.save.found = this.list.filter((q) => q.found).map((q) => q.id);
      this.persist();
      this.hud.showToast(`UNIQUE STUNT JUMP FOUND -- ${j.name} · ${this.found}/${this.list.length}`, 4200);
      if (this.audio && this.audio.pickup) this.audio.pickup();
    }
  }

  finish(run, v) {
    this.run = null;
    const j = run.jump;
    const dist = Math.hypot(v.x - run.x0, v.z - run.z0);
    const air = run.t;
    const spin = Math.abs(run.yaw) * 180 / Math.PI;
    const slip = Math.atan2(Math.abs(v.vLat), Math.max(0.01, v.vLong)) * 180 / Math.PI;
    const wet = G.isWater(v.x, v.z);
    const hurt = run.health0 - v.health;
    // A water jump (j.water) is aimed at the bay: there, the splash is the landing.
    const clean = j.water ? wet && !v.dead : !v.dead && !wet && v.vLong > 2 && slip < 25 && hurt < 20;
    const turns = Math.round(spin / 180) * 180;
    let pay = 40 + dist * 6 + air * 60 + (turns >= 180 ? turns / 180 * 150 : 0);
    if (clean) pay *= 1.5;
    pay = Math.round(pay / 10) * 10;
    const first = clean && !this.done.has(j.id);
    if (first) { this.done.add(j.id); j.done = true; pay += 500; }
    const prev = this.save.best[j.id] || 0;
    const record = clean && dist > prev + 0.5;
    if (record) this.save.best[j.id] = Math.round(dist * 10) / 10;
    this.game.money += pay;
    this.persist();
    let txt = `STUNT JUMP ${Math.round(dist)} m · ${air.toFixed(1)} s air`;
    if (turns >= 180) txt += ` · ${turns}° SPIN`;
    txt += ` · +$${pay}`;
    txt += wet ? ' · SPLASHDOWN' : clean ? ' · CLEAN' : v.dead ? ' · WRECKED' : ' · SLOPPY LANDING';
    if (first) txt = `UNIQUE STUNT BONUS! ${j.name} · ${this.completed}/${this.list.length} · +$500 · ` + txt;
    else if (record && prev) txt += ' · NEW BEST';
    this.hud.showToast(txt, 4200);
    if (this.audio) this.audio.cash();
    this.last = { id: j.id, dist: +dist.toFixed(1), air: +air.toFixed(2), spin: Math.round(spin), clean, pay,
      first, slip: Math.round(slip), hurt: Math.round(hurt), speed: +run.speed.toFixed(1), maxUp: +run.maxUp.toFixed(1),
      x: Math.round(v.x), z: Math.round(v.z), wet, text: txt };
  }
}
