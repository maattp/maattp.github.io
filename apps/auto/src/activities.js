// Things to do: races, flying courses, jobs, challenges -- and a scoring layer
// that runs the whole time you are simply driving.
//
// The world was a sandbox with one delivery objective in it. This file is the
// content layer.
//
// WHAT A DESIGN REVIEW CHANGED, because the reasons outlived the review:
//
// - The first plan was eleven kinds of authored icon. Authored content does not
//   scale to a 26 km map -- you can drive two minutes and meet nothing. So the
//   substrate is AMBIENT SCORING: airtime, drifts, near misses, top speed. It
//   pays you for driving well anywhere, needs no authoring, and fills the space
//   between the authored peaks.
// - Money had no sink. Activities paying into an economy that buys nothing is a
//   scoreboard. main.js now has a vehicle delivery service to spend it on.
// - Speed traps and rooftop "vantage points" were cut. A gate you hit at speed
//   is a notification, not an activity; and on-foot here is a state machine for
//   getting in and out of cars, not a climbing system.
// - Collectibles went 50-scattered to 20 AT NAMED PLACES. Fifty hidden objects
//   across 26 km is a search problem with no search tool -- and it would be
//   built on localStorage, which WebKit evicts.
// - Time trials stopped being a separate icon and became what they always were:
//   a race against your own ghost.
//
// THE CHECKPOINT TRAP, which this codebase has paid for before: a checkpoint on
// an elevated or tunnel node lands under a viaduct or inside a hill. Route
// generation rejects both, and triggers carry a vertical band so passing over a
// bore cannot complete a checkpoint inside it.

import * as THREE from './three.js';
import * as G from './geo.js';
import { clamp, rng, dist2 } from './util.js';

const CP_R = 16;              // ground checkpoint radius, widened for approach speed
const CP_BAND = 12;           // vertical band -- a checkpoint belongs to ONE layer
const RING_R = 34;            // air ring: you arrive at 300 kph
const START_R = 13;
const COUNTDOWN = 3;

const PRIZE = { gold: 1600, silver: 900, bronze: 450, none: 150 };

function loadSave() {
  try { return JSON.parse(localStorage.getItem('auto-activity-bests') || '{}'); } catch (e) { return {}; }
}
function writeSave(b) {
  try { localStorage.setItem('auto-activity-bests', JSON.stringify(b)); } catch (e) { /* private mode */ }
}

export function fmtTime(s) {
  if (s == null || !isFinite(s)) return '--:--';
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

/**
 * Medal times from the route's own length and a class pace.
 *
 * Hand-authored times rot the moment the generator changes, and these routes
 * come from the live graph. Deriving them from geometry means a longer course
 * is proportionally harder, always -- and a re-import that moves a street
 * cannot silently make a gold impossible.
 */
function medalsFor(metres, pace) {
  const base = metres / pace;
  return { gold: base, silver: base * 1.16, bronze: base * 1.4 };
}
function medalFor(t, m) {
  return t <= m.gold ? 'gold' : t <= m.silver ? 'silver' : t <= m.bronze ? 'bronze' : 'none';
}

/**
 * A route of waypoints walked over the real road graph.
 *
 * Greedy DIRECTED walk, not shortest path. A* gives the boring answer -- it
 * optimises for arrival, so it runs arterials in a straight line -- and a
 * random walk in a dense grid doubles back constantly, which is the classic
 * procedural-race failure: you cannot anticipate the next checkpoint and it
 * reads as noise at speed. Persisting the bearing is what makes a route feel
 * like a route.
 */
function routeFrom(city, startNode, count, spacing, R, opts = {}) {
  const { turnBias = 0.85, wantBig = 0.35 } = opts;
  const pts = [];
  let ni = startNode;
  let n = city.nodes[ni];
  let dirX = 1, dirZ = 0;
  for (const ei of n.e) {
    const e = city.edges[ei];
    const o = city.nodes[e.a === ni ? e.b : e.a];
    const L = Math.hypot(o.x - n.x, o.z - n.z) || 1;
    dirX = (o.x - n.x) / L; dirZ = (o.z - n.z) / L;
    break;
  }
  let since = 0;
  const seen = new Set([ni]);
  for (let step = 0; step < 1200 && pts.length < count; step++) {
    let best = null, bestScore = -Infinity;
    for (const ei of n.e) {
      const e = city.edges[ei];
      const oi = e.a === ni ? e.b : e.a;
      const o = city.nodes[oi];
      const dx = o.x - n.x, dz = o.z - n.z;
      const L = Math.hypot(dx, dz) || 1;
      const dot = (dx / L) * dirX + (dz / L) * dirZ;
      const cls = e.cls === 'hwy' ? wantBig * 1.4 : e.cls === 'art' ? wantBig : e.cls === 'st' ? wantBig * 0.5 : 0;
      const score = dot * turnBias + cls + (seen.has(oi) ? -0.6 : 0) + R() * 0.05;
      if (score > bestScore) { bestScore = score; best = { oi, o, L, dx, dz }; }
    }
    if (!best) break;
    since += best.L;
    dirX = best.dx / best.L; dirZ = best.dz / best.L;
    ni = best.oi; n = best.o; seen.add(ni);
    // THE CHECKPOINT TRAP: never drop one on an elevated or tunnel node -- it
    // would sit under the viaduct or inside the hill, and be uncompletable.
    if (since >= spacing && !n.elev && !n.tunnel) {
      since = 0;
      pts.push({ x: n.x, z: n.z, y: n.y });
    }
  }
  return pts;
}

function routeLength(pts, sx, sz) {
  let m = 0, px = sx, pz = sz;
  for (const p of pts) { m += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; }
  return m;
}

// ---------------------------------------------------------------------------

export class Activities {
  constructor(scene, city, world, game, hud, audio, traffic) {
    this.scene = scene; this.city = city; this.world = world;
    this.game = game; this.hud = hud; this.audio = audio; this.traffic = traffic;

    this.list = [];
    this.active = null;
    this.save = loadSave();
    this.found = new Set(this.save.__found || []);
    this.score = this.save.__score || 0;
    this.amb = { air: 0, airBest: 0, drift: 0, topKph: 0, combo: 0, comboT: 0, lastNear: 0 };

    this.group = new THREE.Group();
    scene.add(this.group);
    this.t = 0;

    this.geo = {
      pillar: new THREE.CylinderGeometry(2.4, 2.4, 30, 8, 1, true),
      cp: new THREE.CylinderGeometry(CP_R, CP_R, 18, 16, 1, true),
      ring: new THREE.TorusGeometry(RING_R, 1.8, 6, 20),
      coin: new THREE.OctahedronGeometry(1.7, 0),
    };
    const bm = (c, o) => new THREE.MeshBasicMaterial({
      color: c, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false,
    });
    this.mat = {
      start: bm(0x4fd0ff, 0.30), cp: bm(0xffd24a, 0.26), cpNext: bm(0x7ee0a4, 0.42),
      ring: bm(0xffd24a, 0.5), ringNext: bm(0x7ee0a4, 0.8), ghost: bm(0xff8ad8, 0.5),
      coin: new THREE.MeshBasicMaterial({ color: 0xf4c542 }),
    };
    this.build();
  }

  build() {
    const city = this.city;
    const R = rng(20260801).f;   // rng() returns an object; .f is the raw fn
    const add = (a) => { a.best = this.save[a.id] || null; this.list.push(a); };
    const L = (kind) => (G.LANDMARKS || []).find((l) => l.kind === kind);

    // ---- street races ------------------------------------------------------
    const RACES = [
      ['Waterfront Sprint', -700, 300, 8, 250],
      ['Ballard Run', -4200, -3100, 8, 270],
      ['Queen Anne Climb', -1500, -1500, 7, 240],
      ['Rainier Dash', 2600, 3600, 8, 290],
      ['SoDo Industrial', 500, 2200, 8, 290],
      ['University Loop', 1500, -2600, 8, 260],
      ['West Seattle Coast', -3800, 3000, 8, 300],
      ['Bellevue Circuit', 9800, -300, 8, 300],
    ];
    for (const [name, x, z, cps, spacing] of RACES) {
      const s = city.nearestNode(x, z, 700);
      if (s == null) continue;
      const sn = city.nodes[s];
      if (sn.elev || sn.tunnel) continue;
      const pts = routeFrom(city, s, cps, spacing, R);
      if (pts.length < 5) continue;
      const metres = routeLength(pts, sn.x, sn.z);
      add({
        id: `race-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'race',
        name, sub: 'Street race', x: sn.x, z: sn.z, y: sn.y,
        need: 'car', pts, metres, medals: medalsFor(metres, 18),
      });
    }

    // ---- highway runs: same kind, open-road pace ----------------------------
    const RUNS = [
      ['I-5 North Run', 700, -1200, 9, 500],
      ['I-90 Crossing', 3200, 2200, 8, 540],
      ['I-405 Eastside', 10400, 1200, 8, 540],
    ];
    for (const [name, x, z, cps, spacing] of RUNS) {
      const s = city.nearestNode(x, z, 900);
      if (s == null) continue;
      const sn = city.nodes[s];
      if (sn.elev || sn.tunnel) continue;
      const pts = routeFrom(city, s, cps, spacing, R, { turnBias: 1.2, wantBig: 0.8 });
      if (pts.length < 5) continue;
      const metres = routeLength(pts, sn.x, sn.z);
      add({
        id: `run-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'race',
        name, sub: 'Highway run', x: sn.x, z: sn.z, y: sn.y,
        need: 'car', pts, metres, medals: medalsFor(metres, 28),
      });
    }

    // ---- flying ring courses ----------------------------------------------
    const needle = L('spaceNeedle'), gas = L('gasworks'), husky = L('stadiumH');
    const lumen = L('stadiumF'), locks = L('locks'), airport = L('airport');
    const COURSES = [];
    if (needle && gas) COURSES.push(['Downtown Skyline', 'Thread the towers', [
      [needle.x + 300, 210, needle.z + 260], [needle.x - 130, 195, needle.z - 90],
      [400, 230, -300], [900, 250, 500], [200, 205, 1200],
      [-500, 185, 700], [gas.x + 200, 175, gas.z + 400],
    ]]);
    if (locks && husky) COURSES.push(['Ship Canal Bridge Limbo', 'Under every span, in order', [
      [locks.x + 320, 52, locks.z + 90], [-2400, 46, -2500], [-1400, 42, -2650],
      [-400, 40, -2750], [600, 43, -2800], [1400, 48, -2700],
      [husky.x - 220, 58, husky.z + 200],
    ]]);
    if (airport && lumen) COURSES.push(['Duwamish Run', 'The industrial south, low and fast', [
      [lumen.x + 200, 120, lumen.z + 400], [900, 100, 3200], [1400, 92, 4400],
      [2000, 86, 5600], [2500, 90, 6800], [airport.x - 200, 82, airport.z - 900],
    ]]);
    COURSES.push(['Lake Washington Circuit', 'Long and fast over open water', [
      [4200, 160, 1200], [6200, 172, 500], [8000, 182, -900],
      [7200, 170, -2800], [5000, 158, -2200], [3800, 150, -400],
    ]]);
    COURSES.push(['Eastside Express', 'Bellevue and back', [
      [7000, 200, -1200], [9200, 222, -800], [10600, 232, 400],
      [9400, 212, 1600], [7400, 190, 900],
    ]]);
    for (const [name, sub, rings] of COURSES) {
      // Lift any ring that ended up too close to the ground. The courses are
      // authored at absolute heights over a REAL heightfield, so a hill can
      // put a ring in the dirt -- six of thirty-one were under 18 m of
      // clearance, which at 300 kph is a ring you cannot take. The terrain is
      // the authority; the authored height is the intent.
      for (const r of rings) {
        const g = G.terrainHeight(r[0], r[2]);
        if (r[1] - g < 25) r[1] = g + 25;
      }
      let metres = 0;
      for (let i = 1; i < rings.length; i++) {
        metres += Math.hypot(rings[i][0] - rings[i - 1][0], rings[i][2] - rings[i - 1][2]);
      }
      add({
        id: `rings-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'rings',
        name, sub, x: rings[0][0], z: rings[0][2], y: rings[0][1],
        need: 'plane', rings, metres, medals: medalsFor(metres, 80),
      });
    }

    // ---- getaways ----------------------------------------------------------
    // The review's best idea: give the tunnels a FUNCTION. Underground the
    // helicopter loses you, so a bore becomes a tactical option rather than
    // geometry you happen to drive through. main.js enforces it.
    const GETAWAY = [
      ['Downtown Heat', -300, 200, 3, 70],
      ['Eastside Heat', 9600, 200, 3, 75],
      ['South End Heat', 1800, 5200, 4, 85],
    ];
    for (const [name, x, z, stars, secs] of GETAWAY) {
      const s = city.nearestNode(x, z, 900);
      if (s == null) continue;
      const sn = city.nodes[s];
      add({
        id: `getaway-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'getaway',
        name, sub: `Survive ${secs}s at ${stars} stars`, x: sn.x, z: sn.z, y: sn.y,
        need: 'car', stars, secs,
      });
    }

    // ---- aircraft challenges -----------------------------------------------
    if (airport) {
      const AL = [Math.sin(0.52), Math.cos(0.52)], AC = [Math.cos(0.52), -Math.sin(0.52)];
      const off = (dx, dz) => [airport.x + dx * AC[0] + dz * AL[0], airport.z + dx * AC[1] + dz * AL[1]];
      const [tx, tz] = off(0, 300);
      add({
        id: 'landing-bfi', kind: 'landing', name: 'Boeing Field Spot Landing',
        sub: 'Put it on the numbers', x: tx, z: tz, y: 5.2,
        need: 'plane', target: { x: tx, z: tz, r: 50 },
      });
    }
    add({
      id: 'landing-union', kind: 'landing', name: 'Lake Union Splashdown',
      sub: 'Floatplane, on the mark', x: 500, z: -2900, y: 5.31,
      need: 'floatplane', target: { x: 500, z: -2900, r: 60 },
    });

    // ---- collectibles at named places --------------------------------------
    this.coins = [];
    const seen = new Set();
    for (const l of (G.LANDMARKS || [])) {
      if (this.coins.length >= 20) break;
      const ni = city.nearestNode(l.x, l.z, 300);
      if (ni == null) continue;
      const n = city.nodes[ni];
      if (n.elev || n.tunnel) continue;
      const k = `${Math.round(n.x / 300)},${Math.round(n.z / 300)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      this.coins.push({ i: this.coins.length, name: l.name || 'Landmark', x: n.x, z: n.z, y: n.y + 1.8 });
    }
    this.buildMeshes();
  }

  buildMeshes() {
    for (const a of this.list) {
      const m = new THREE.Mesh(this.geo.pillar, this.mat.start);
      m.position.set(a.x, (a.y || 0) + 15, a.z);
      m.visible = false;
      this.group.add(m);
      a.mesh = m;
    }
    this.coinMeshes = this.coins.map((c) => {
      const m = new THREE.Mesh(this.geo.coin, this.mat.coin);
      m.position.set(c.x, c.y, c.z);
      m.visible = false;
      this.group.add(m);
      return m;
    });
    // Pooled: the budget is ~300 draws, so live markers are a fixed handful
    // reused by whatever is running -- never one mesh per checkpoint.
    this.cpMeshes = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(this.geo.cp, this.mat.cpNext);
      m.visible = false; this.group.add(m); this.cpMeshes.push(m);
    }
    this.ringMeshes = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(this.geo.ring, this.mat.ringNext);
      m.visible = false; this.group.add(m); this.ringMeshes.push(m);
    }
    this.ghostMesh = new THREE.Mesh(this.geo.cp, this.mat.ghost);
    this.ghostMesh.scale.setScalar(0.34);
    this.ghostMesh.visible = false;
    this.group.add(this.ghostMesh);
  }

  vehicleKind(player) {
    if (player.onFoot || !player.vehicle) return 'foot';
    const s = player.vehicle.spec;
    if (s.floats) return 'floatplane';
    if (s.plane) return 'plane';
    return 'car';
  }
  canStart(a, k) {
    if (a.need === 'any') return k !== 'foot';
    if (a.need === 'car') return k === 'car';
    if (a.need === 'plane') return k === 'plane' || k === 'floatplane';
    if (a.need === 'floatplane') return k === 'floatplane';
    return true;
  }
  needText(a) {
    return a.need === 'car' ? 'needs a car' : a.need === 'floatplane' ? 'needs a floatplane'
      : a.need === 'plane' ? 'needs a plane' : 'needs a vehicle';
  }
  persist() {
    this.save.__found = [...this.found];
    this.save.__score = Math.round(this.score);
    writeSave(this.save);
  }

  start(a) {
    this.active = { a, phase: 'countdown', t: COUNTDOWN, elapsed: 0, idx: 0, trail: [] };
    if (a.kind === 'getaway') this.game.addHeat(a.stars * 130);
    this.hud.showToast(`${a.name} — get ready`);
    if (this.audio) this.audio.blip(520, 0.12, 'square', 0.25);
  }

  /** One tap, never behind a menu: a lost run on a phone ends the session. */
  restart(player) {
    const run = this.active;
    if (!run) return;
    const a = run.a;
    this.finishSilently();
    const v = player.vehicle;
    if (v) {
      v.x = a.x; v.z = a.z; v.vLong = 0; v.vLat = 0;
      if (a.kind === 'rings') { v.y = a.y; v.airborne = true; v.vy = 0; }
      else { v.y = this.city.groundAt(a.x, a.z, null); if (v.spec.plane) v.airborne = false; }
    }
    this.start(a);
  }

  finishSilently() {
    this.active = null;
    for (const m of this.cpMeshes) m.visible = false;
    for (const m of this.ringMeshes) m.visible = false;
    this.ghostMesh.visible = false;
    this.hud.setObjective('');
    this.hud.race = null;
  }

  finish(ok, note) {
    const run = this.active;
    if (!run) return;
    const a = run.a, t = run.elapsed, trail = run.trail;
    this.finishSilently();
    if (!ok) {
      this.hud.showToast(`${a.name} — ${note || 'failed'}`);
      if (this.audio) this.audio.blip(150, 0.3, 'sawtooth', 0.22);
      return;
    }
    let medal = 'gold';
    if (a.medals) medal = medalFor(t, a.medals);
    else if (a.kind === 'landing') medal = run.medal || 'bronze';
    const prize = PRIZE[medal];
    this.game.money += prize;
    this.score += prize;
    const prev = this.save[a.id];
    const better = a.medals ? (!prev || t < prev.t) : (!prev || (prev.medal !== 'gold' && medal === 'gold'));
    if (better) {
      this.save[a.id] = { t, medal, trail: a.medals ? trail.slice(0, 400) : undefined };
      a.best = this.save[a.id];
    }
    this.persist();
    const time = a.medals ? ` — ${fmtTime(t)}` : '';
    this.hud.showToast(`${a.name}${time} · ${medal.toUpperCase()} · $${prize}${better ? ' · NEW BEST' : ''}`, 4200);
    if (this.audio) this.audio.cash();
  }

  summary() {
    const order = { race: 0, rings: 1, getaway: 2, landing: 3 };
    const rows = [...this.list]
      .sort((p, q) => (order[p.kind] - order[q.kind]) || p.name.localeCompare(q.name))
      .map((a) => ({
        name: a.name, sub: a.sub,
        best: a.best ? (a.medals ? fmtTime(a.best.t) : 'done') : null,
        medal: a.best ? a.best.medal : null,
      }));
    return {
      rows,
      golds: rows.filter((r) => r.medal === 'gold').length,
      done: rows.filter((r) => r.medal && r.medal !== 'none').length,
      total: rows.length,
      found: this.found.size, findTotal: this.coins.length,
      score: Math.round(this.score),
    };
  }

  // --- ambient scoring -----------------------------------------------------

  award(n, label) {
    this.score += n;
    this.game.money += n;
    this.amb.combo++;
    this.amb.comboT = 2.6;
    const c = this.amb.combo > 1 ? ` x${this.amb.combo}` : '';
    this.hud.showToast(`${label} +$${n}${c}`, 1500);
    this.persist();
  }

  ambient(dt, player) {
    const a = this.amb;
    const v = player.vehicle;
    a.comboT -= dt;
    if (a.comboT <= 0) a.combo = 0;
    if (!v || player.onFoot) { a.air = 0; a.drift = 0; return; }
    const kph = Math.abs(v.vLong) * 3.6;

    if (kph > a.topKph + 25 && kph > 120) {
      a.topKph = kph;
      this.award(Math.round(kph), `TOP SPEED ${Math.round(kph)} km/h`);
    }
    if (v.spec.plane) { a.air = 0; a.drift = 0; return; }

    // AIRTIME
    const g = this.city.groundAt(v.x, v.z, v.y + 1.2, v.lift || 0);
    if (v.y - g > 1.1 && kph > 25) a.air += dt;
    else {
      if (a.air > 0.55) {
        this.award(Math.round(a.air * 220), `AIRTIME ${a.air.toFixed(1)}s`);
        if (a.air > a.airBest) a.airBest = a.air;
      }
      a.air = 0;
    }
    // DRIFT
    if (Math.abs(v.vLat || 0) > 2.6 && kph > 45) a.drift += dt;
    else {
      if (a.drift > 1.0) this.award(Math.round(a.drift * 140), `DRIFT ${a.drift.toFixed(1)}s`);
      a.drift = 0;
    }
    // NEAR MISS
    if (kph > 60 && this.traffic && this.t - a.lastNear > 0.8) {
      for (const o of this.traffic.cars) {
        if (o === v || o.mode === 'parked') continue;
        const d2 = dist2(o.x, o.z, v.x, v.z);
        if (d2 < 16 && d2 > 5.2 && Math.abs(o.y - v.y) < 3) {
          a.lastNear = this.t;
          this.award(60, 'NEAR MISS');
          break;
        }
      }
    }
  }

  // --- frame ---------------------------------------------------------------

  update(dt, player) {
    this.t += dt;
    const p = player.position;
    const kind = this.vehicleKind(player);
    this.ambient(dt, player);

    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i], m = this.coinMeshes[i];
      if (this.found.has(c.i)) { m.visible = false; continue; }
      const d2 = dist2(c.x, c.z, p.x, p.z);
      m.visible = d2 < 300 * 300;
      if (m.visible) {
        m.rotation.y = this.t * 1.5;
        m.position.y = c.y + Math.sin(this.t * 2.2 + i) * 0.4;
      }
      if (d2 < 6 * 6 && Math.abs(p.y - c.y) < 7) {
        this.found.add(c.i);
        m.visible = false;
        this.game.money += 400; this.score += 400;
        this.persist();
        this.hud.showToast(`${c.name} found — ${this.found.size}/${this.coins.length} · $400`, 3000);
        if (this.audio) this.audio.cash();
      }
    }

    for (const a of this.list) {
      const near = dist2(a.x, a.z, p.x, p.z) < 800 * 800;
      a.mesh.visible = near && !this.active;
      if (a.mesh.visible) a.mesh.rotation.y = this.t * 0.5;
    }
    // Map icons come from here, not from world meshes -- see the draw budget.
    this.hud.activities = this.list;
    this.hud.finds = this.coins.filter((c) => !this.found.has(c.i));

    if (this.active) { this.tickRun(dt, player, kind); return; }

    let near = null, nd = START_R * START_R;
    for (const a of this.list) {
      const d = dist2(a.x, a.z, p.x, p.z);
      if (d < nd) { nd = d; near = a; }
    }
    if (near) {
      if (this.canStart(near, kind)) this.start(near);
      else if (this.armed !== near.id) {
        this.armed = near.id;
        this.hud.showToast(`${near.name} — ${this.needText(near)}`);
      }
    } else this.armed = null;
  }

  tickRun(dt, player, kind) {
    const run = this.active, a = run.a, p = player.position;

    if (run.phase === 'countdown') {
      const was = Math.ceil(run.t);
      run.t -= dt;
      const now = Math.ceil(run.t);
      if (now !== was && now > 0) {
        this.hud.showToast(String(now), 700);
        if (this.audio) this.audio.blip(440, 0.1, 'square', 0.22);
      }
      if (run.t <= 0) {
        run.phase = 'run';
        this.hud.showToast('GO', 900);
        if (this.audio) this.audio.blip(760, 0.18, 'square', 0.3);
      }
      return;
    }

    run.elapsed += dt;
    if (a.medals && (!run.trail.length || run.elapsed - run.trail[run.trail.length - 1][0] > 0.5)) {
      run.trail.push([+run.elapsed.toFixed(2), Math.round(p.x), Math.round(p.y), Math.round(p.z)]);
    }
    if (a.kind !== 'getaway' && !this.canStart(a, kind)) { this.finish(false, 'left the vehicle'); return; }

    // GHOST: where your best run was at this instant. A checkpoint timer with
    // no opponent is a spreadsheet; this is the cheapest opponent in games.
    if (a.best && a.best.trail && a.best.trail.length > 1) {
      const tr = a.best.trail;
      let k = 0;
      while (k < tr.length - 1 && tr[k + 1][0] < run.elapsed) k++;
      const g0 = tr[k], g1 = tr[Math.min(k + 1, tr.length - 1)];
      const span = Math.max(0.01, g1[0] - g0[0]);
      const f = clamp((run.elapsed - g0[0]) / span, 0, 1);
      this.ghostMesh.visible = true;
      this.ghostMesh.position.set(
        g0[1] + (g1[1] - g0[1]) * f,
        g0[2] + (g1[2] - g0[2]) * f + 2,
        g0[3] + (g1[3] - g0[3]) * f);
    }

    if (a.kind === 'race') return this.tickRace(dt, player, run, a);
    if (a.kind === 'rings') return this.tickRings(dt, player, run, a);
    if (a.kind === 'getaway') return this.tickGetaway(dt, player, run, a);
    if (a.kind === 'landing') return this.tickLanding(dt, player, run, a);
  }

  /** HUD payload. TOP of the screen, because thumbs cover the bottom. */
  setRaceHud(a, run, leftLabel) {
    let delta = null;
    if (a.best && a.best.trail && a.best.trail.length) {
      const bt = a.best.trail;
      const idx = Math.min(run.idx, bt.length - 1);
      if (bt[idx]) delta = run.elapsed - bt[idx][0];
    }
    this.hud.race = {
      name: a.name, time: fmtTime(run.elapsed), left: leftLabel,
      best: a.best ? fmtTime(a.best.t) : null,
      delta: delta == null ? null : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`,
      ahead: delta != null && delta < 0,
      target: run.targetPos || null,
    };
  }

  tickRace(dt, player, run, a) {
    const p = player.position;
    for (let k = 0; k < this.cpMeshes.length; k++) {
      const cp = a.pts[run.idx + k], m = this.cpMeshes[k];
      if (!cp) { m.visible = false; continue; }
      m.visible = true;
      m.material = k === 0 ? this.mat.cpNext : this.mat.cp;
      m.position.set(cp.x, cp.y + 9, cp.z);
    }
    const cp = a.pts[run.idx];
    if (cp) {
      run.targetPos = { x: cp.x, z: cp.z };
      // The vertical band is the tunnel guard: passing OVER a bore must not
      // complete a checkpoint sitting inside it.
      if (dist2(cp.x, cp.z, p.x, p.z) < CP_R * CP_R && Math.abs(p.y - cp.y) < CP_BAND) {
        run.idx++;
        if (this.audio) this.audio.blip(660, 0.09, 'square', 0.2);
        if (run.idx >= a.pts.length) { this.finish(true); return; }
      }
    }
    this.setRaceHud(a, run, `${a.pts.length - run.idx} left`);
  }

  tickRings(dt, player, run, a) {
    const p = player.position;
    for (let k = 0; k < this.ringMeshes.length; k++) {
      const r = a.rings[run.idx + k], m = this.ringMeshes[k];
      if (!r) { m.visible = false; continue; }
      m.visible = true;
      m.material = k === 0 ? this.mat.ringNext : this.mat.ring;
      m.position.set(r[0], r[1], r[2]);
      const nxt = a.rings[run.idx + k + 1] || a.rings[run.idx + k - 1] || r;
      m.lookAt(nxt[0], nxt[1], nxt[2]);
    }
    const r = a.rings[run.idx];
    if (r) {
      run.targetPos = { x: r[0], z: r[2], y: r[1] };
      if (Math.hypot(r[0] - p.x, r[2] - p.z) < RING_R && Math.abs(r[1] - p.y) < RING_R) {
        run.idx++;
        if (this.audio) this.audio.blip(720, 0.09, 'square', 0.22);
        if (run.idx >= a.rings.length) { this.finish(true); return; }
      }
    }
    this.setRaceHud(a, run, `${a.rings.length - run.idx} rings`);
  }

  tickGetaway(dt, player, run, a) {
    if (this.game.wanted === 0) { this.finish(true); return; }
    if (this.game.dead) { this.finish(false, 'busted'); return; }
    const left = Math.max(0, a.secs - run.elapsed);
    if (left <= 0) { this.finish(true); return; }
    this.hud.race = {
      name: a.name, time: `${left.toFixed(0)}s`, left: `${this.game.wanted} stars`,
      best: null, delta: null, ahead: false, target: null,
    };
  }

  tickLanding(dt, player, run, a) {
    const v = player.vehicle;
    if (!v || !v.spec.plane) { this.finish(false, 'left the aircraft'); return; }
    const d = Math.hypot(a.target.x - v.x, a.target.z - v.z);
    run.targetPos = { x: a.target.x, z: a.target.z };
    if (!v.airborne && run.elapsed > 1.5) {
      if (d > a.target.r * 2.4) { this.finish(false, `landed ${Math.round(d)} m off`); return; }
      run.medal = d < a.target.r * 0.45 ? 'gold' : d < a.target.r ? 'silver' : 'bronze';
      this.hud.showToast(`Touchdown ${Math.round(d)} m from the mark`);
      this.finish(true);
      return;
    }
    if (run.elapsed > 200) { this.finish(false, 'out of time'); return; }
    this.hud.race = {
      name: a.name, time: `${Math.round(d)} m`, left: `${Math.round(v.y)} m up`,
      best: null, delta: null, ahead: false, target: run.targetPos,
    };
  }
}
