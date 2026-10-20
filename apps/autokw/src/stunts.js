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
const UV0 = [0, 0, 0, 0, 0, 0, 0, 0];   // Builder(false) ignores them, quad() still reads them

/**
 * The jumps. `sx, sz` is where the run-up starts, `x, z` the centre of the
 * lip; the ramp points from one to the other. `land` is how much ground past
 * the lip is kept clear. Chosen from the map and drive-tested with
 * tools/stuntjumps.mjs -- change one, re-run it.
 */
export const JUMPS = [
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
  try { const s = JSON.parse(localStorage.getItem('autokw-stunts') || '{}'); return { done: s.done || [], best: s.best || {} }; } catch (e) { return { done: [], best: {} }; }
}

export class StuntJumps {
  constructor(city, game, hud, audio) {
    this.city = city; this.game = game; this.hud = hud; this.audio = audio;
    this.list = JUMPS.filter((j) => j.ramp);
    this.save = loadSave();
    this.done = new Set(this.save.done);
    for (const j of this.list) j.done = this.done.has(j.id);
    this.run = null;
    this.timeScale = 1;
    this.camK = 0;
    this.last = null;        // the last jump's result, for tools
    hud.jumps = this.list;
  }

  get busy() { return this.run !== null; }
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
            health0: v.health, maxUp: 0, pred, speed: sp };
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
        else if (run.pred > 1.5) {
          const ph = run.t / run.pred;
          k = smooth(0.12, 0.3, ph) * (1 - smooth(0.58, 0.8, ph));
        }
      }
    }
    // eased either way so neither the camera nor the clock steps
    this.camK += (k - this.camK) * Math.min(1, dt * 6);
    this.timeScale = 1 - 0.45 * this.camK;
    player.stuntCam = this.camK;
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
    if (first) txt += ` · UNIQUE ${this.completed}/${this.list.length}`;
    else if (record && prev) txt += ' · NEW BEST';
    this.hud.showToast(txt, 4200);
    if (this.audio) this.audio.cash();
    this.last = { id: j.id, dist: +dist.toFixed(1), air: +air.toFixed(2), spin: Math.round(spin), clean, pay,
      first, slip: Math.round(slip), hurt: Math.round(hurt), speed: +run.speed.toFixed(1), maxUp: +run.maxUp.toFixed(1),
      x: Math.round(v.x), z: Math.round(v.z), wet, text: txt };
  }
}
