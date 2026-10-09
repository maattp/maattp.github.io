// Taxi fares: a reason to drive around, from a taxi's FARE button.
//
// FARE: somebody hails you from a kerb a block or two away (a yellow pillar on
// them and a dot on both maps). Pull up beside them and stop: they walk over
// and get in. Their destination is a real place -- a landmark or a
// neighbourhood -- with the same yellow pillar, and the route on the maps. The
// meter runs; the fare is a flat base + so much a km of the ROUTE (the A*
// over the street graph, so a detour earns nothing and costs time), and the
// tip is the half of it that rides on two things: how soon you get there
// against a par for the route, and how smoothly (a bump or a crash costs it,
// a close pass on a fast road gives a little back). The passenger says so.
// Arrive and stop within the pillar: they get out and walk off, you are paid,
// and the next one hails (a streak of fares without a crash pays a bonus).
//
// It lives in the taxi like a police mission lives in its cruiser: leaving
// it, dying, a respawn, three stars on you, or the fare clock running out
// ends the run and leaves nothing behind (pillar, objective, map marks, the
// passenger). Fares done are saved ('auto-taxi') and read by the Passport.
// See "Taxi fares" in guide/activities.md.

import * as THREE from './three.js';
import * as G from './geo.js';
import { clamp, formatMoney } from './util.js';

const KEY = 'auto-taxi';
const HAIL_MIN = 90, HAIL_MAX = 240;   // the hail: this far off, on a surface street
const BOARD_R = 14;                    // pulled up this close to them, and stopped
const BOARD_T = 0.5;                   // ...for this long
const STOP_V = 1.6;                    // "stopped": under this, m/s
const DROP_R = 15;                     // arrived: within this of the drop-off
const HAIL_GIVE_UP = 150;              // s: they find another cab
const BASE = 70, PER_KM = 210;         // the meter
const TIP_SHARE = 0.5;                 // the best tip, of the fare
const PAR_V = 12, LIMIT_V = 6.5;       // m/s the par and the limit assume
const STREAK_BONUS = 25, STREAK_MAX = 6;
const CRASH_AT = 9, BUMP_AT = 4;       // onCrash impact: a crash / a bump
const LINE_GAP = 3.5;                  // s between the passenger's remarks

// Where people want to go: [what the passenger says, a landmark's mapped name
// (prefix) or a neighbourhood's]. Resolved against the loaded map, so one the
// map lacks is simply never asked for.
const WANT = [
  ['Pike Place Market', 'lm', 'Pike Place Market'], ['the Space Needle', 'lm', 'Space Needle'],
  ['Pioneer Square', 'lm', 'Pioneer Square Pergola'], ['Lumen Field', 'lm', 'Lumen Field'],
  ['T-Mobile Park', 'lm', 'T-Mobile Park'], ['Climate Pledge Arena', 'lm', 'Climate Pledge Arena'],
  ['the Great Wheel', 'lm', 'Seattle Great Wheel'], ['Colman Dock', 'lm', 'Colman Dock'],
  ['Smith Tower', 'lm', 'Smith Tower'], ['the Central Library', 'lm', 'The Seattle Public Library'],
  ['Gas Works Park', 'lm', 'Gas Works Park'], ['the Fremont Troll', 'lm', 'Fremont Troll'],
  ['the Ballard Locks', 'lm', 'Hiram M. Chittenden Locks'], ['Kerry Park', 'lm', 'Kerry Park'],
  ['the UW — Husky Stadium', 'lm', 'Husky Stadium'], ['Alki Beach', 'lm', 'Alki Beach Park'],
  ['Boeing Field', 'lm', 'King County International Airport'], ['Volunteer Park', 'lm', 'Volunteer Park Conservatory'],
  ['MoPOP', 'lm', 'Museum of Pop Culture'], ['the Convention Center', 'lm', 'Convention Center'],
  ['the Aquarium', 'lm', 'Seattle Aquarium'],
  ['Ballard', 'pl', 'Ballard'], ['Capitol Hill', 'pl', 'Capitol Hill'], ['Georgetown', 'pl', 'Georgetown'],
  ['Columbia City', 'pl', 'Columbia City'], ['the U District', 'pl', 'University District'],
  ['Fremont', 'pl', 'Fremont'], ['Wallingford', 'pl', 'Wallingford'], ['Green Lake', 'pl', 'Green Lake'],
  ['Northgate', 'pl', 'Northgate'], ['West Seattle', 'pl', 'West Seattle'], ['Beacon Hill', 'pl', 'Beacon Hill'],
  ['Magnolia', 'pl', 'Magnolia'], ['Chinatown', 'pl', 'Chinatown'], ['Belltown', 'pl', 'Belltown'],
  ['South Lake Union', 'pl', 'South Lake Union'],
];

const SAY = {
  bump: ['Hey, easy!', 'Ow! Watch it!', 'Are you even licensed?'],
  crash: ['Whoa! Are you trying to kill me?!', 'My tip just went out the window!'],
  late: ["I'm late!", "Come on, I'm late!", 'Can we go any faster?'],
  hit: ["Oh my god — you hit someone!"],
  close: ['Nice moves!', 'Ha! That was close.'],
  smooth: ['Smooth ride, thanks.'],
};

/** What a fare of `m` route metres pays and how long it is given: pure, for
 *  the probe. `payM` is the distance PAID for (the route, capped near the crow
 *  flight: see `choose`); the clock is the route's own. */
export function fareFor(m, payM = m) {
  const fare = Math.round(BASE + PER_KM * payM / 1000);
  return { fare, par: m / PAR_V + 20, limit: m / LIMIT_V + 60 };
}

/** The route's flight-to-road allowance: paid distance is at most this x the straight line. */
const PAY_CAP = 1.6;
/** A hail further by road than this x the straight line is not offered. */
const HAIL_DETOUR = 2;
const GIVE_UP = 3;   // fares that cannot be made in a row: the shift ends

export class TaxiFares {
  constructor({ scene, city, game, traffic, peds, hud, audio, root }) {
    this.scene = scene; this.city = city; this.game = game; this.traffic = traffic;
    this.peds = peds; this.hud = hud; this.audio = audio; this.root = root;
    this.run = null;          // the fare in progress
    this.nextT = 0;           // seconds until the next one hails (the shift goes on)
    this.on = false;          // on shift (a fare, or between fares)
    this.streak = 0;
    this.fails = 0;           // hails / routes that came to nothing in a row
    this.veh = null;          // the taxi the shift started in
    this.stats = { fares: 0, earned: 0, bestStreak: 0 };
    try { Object.assign(this.stats, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private mode */ }
    this.leavers = [];        // passengers walking away from a drop-off
    this._objTxt = '';
    this._objCd = 0; this._objStage = null;
    this._dests = null;
    this._btn = typeof document !== 'undefined' ? document.querySelector('[data-btn="taxifare"]') : null;
    this._shown = null;
    // the pillar: the delivery marker's look (main.js), thin over a hailing person
    this.mark = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 26, 18, 1, true), new THREE.MeshBasicMaterial({
      color: 0xffd24a, transparent: true, opacity: 0.32, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false,
    }));
    this.mark.visible = false;
    this.mark.frustumCulled = false;
    scene.add(this.mark);
  }

  /** Stand-in for the warm-up frames (main.js): the pillar's material. */
  warmMeshes() { const m = new THREE.Mesh(this.mark.geometry, this.mark.material); m.frustumCulled = false; return [m]; }

  /** Is the player at the wheel of a taxi? */
  available(player) {
    const v = player.vehicle;
    return !!(v && !player.onFoot && v.spec.taxi && !v.dead);
  }

  /** The FARE button: go on shift, or go off it. */
  toggle(player) {
    if (this.on) { this.end(false, this.run && this.run.stage === 'ride' ? 'Fare cancelled — the passenger gets out' : 'Off shift'); return; }
    if (!this.available(player)) { this.hud.showToast('Fares need a taxi'); return; }
    if (this.game.wanted >= 3) { this.hud.showToast('Lose the police first'); return; }
    this.on = true;
    this.streak = 0;
    this.fails = 0;
    this.veh = player.vehicle;
    this.hail(player);
  }

  /** Persist the count (the passport reads `stats.fares`). */
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.stats)); } catch (e) { /* private mode */ } }

  // --- the hail ------------------------------------------------------------

  hail(player) {
    const p = player.position;
    // somebody the taxi can reach: by road (strict A*, no wrong-way street) under
    // HAIL_DETOUR x the straight line, not just near as the crow flies
    let ped = null;
    for (let k = 0; k < 8 && !ped; k++) {
      const c = this.peds.spawnFare(p.x, p.z, k < 5 ? HAIL_MIN : 40, k < 5 ? HAIL_MAX : 300);
      if (!c) continue;
      if (this.reachable(p, c)) ped = c; else this.peds.remove(c);
    }
    if (!ped) {
      this.noFare(player, 'No fares about — try somewhere busier');
      return;
    }
    this.run = {
      stage: 'hail', ped, t: 0, stopT: 0, walkT: 0,
      place: G.placeNameAt(ped.x, ped.z), dest: null, route: null, m: 0, fare: 0, par: 0, limit: 0,
      ride: 0, smooth: 1, crashes: 0, bumps: 0, near: 0, drove: 0, lastX: p.x, lastZ: p.z,
      sayT: 0, lateSaid: false, nmT: 0, cd: 0, pedCd: 0,
    };
    this.nextT = 0;
    this.hud.fare = { hail: { x: ped.x, z: ped.z }, dest: null, route: null };
    this.placeMark(ped.x, ped.y, ped.z, true);
    this.hud.showToast(`Fare waiting in ${this.run.place} — ${this.dist(Math.hypot(ped.x - p.x, ped.z - p.z))} away`, 3200);
    if (this.audio && this.audio.ready) this.audio.ui('ring');
    this.setBtn(true);
  }

  /** A hail that came to nothing: try again shortly, or after GIVE_UP in a row end the shift. */
  noFare(player, msg) {
    if (++this.fails >= GIVE_UP) { this.end(false, 'No fares can be reached from here — try another neighbourhood'); return true; }
    this.hud.showToast(msg);
    if (this.on && !this.run) { this.nextT = 5; this.setObj('Taxi · looking for a fare…'); }
    return false;
  }

  /** The road network each node is on (an undirected union-find, once): a
   *  private drive is a pocket of a dozen nodes that nothing else reaches. */
  comps() {
    if (this._comp) return this._comp;
    const city = this.city, N = city.nodes.length, par = new Int32Array(N);
    for (let i = 0; i < N; i++) par[i] = i;
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (const e of city.edges) { const a = find(e.a), b = find(e.b); if (a !== b) par[a] = b; }
    const size = new Int32Array(N);
    for (let i = 0; i < N; i++) { par[i] = find(i); size[par[i]]++; }
    return (this._comp = { par, size });
  }

  /** The nearest street node within `r` of (x, z) on a real network (not a
   *  pocket), ground level first. -1 if none. */
  mainNode(x, z, r) {
    const city = this.city, { par, size } = this.comps();
    let best = -1, bd = Infinity;
    for (const ei of city.edgesNear(x, z, r)) {
      const e = city.edges[ei];
      for (const ni of [e.a, e.b]) {
        const n = city.nodes[ni];
        if (size[par[ni]] < 300) continue;
        const d = Math.hypot(n.x - x, n.z - z) + (n.elev ? 400 : 0);
        if (d < bd) { bd = d; best = ni; }
      }
    }
    return bd < r + 400 ? best : -1;
  }

  /** Can the taxi at `p` get to ped `c` by road without a long way round? */
  reachable(p, c) {
    const from = this.mainNode(p.x, p.z, 250), to = this.mainNode(c.x, c.z, 80);
    if (from < 0 || to < 0) return false;
    if (from === to) return true;
    const path = this.traffic.findPath(from, to, 2500, true);
    if (!path) return false;
    const r = this.routeOf(path, p.x, p.z);
    return r.m <= HAIL_DETOUR * Math.hypot(c.x - p.x, c.z - p.z) + 60;
  }

  /** A node path as a polyline from (x, z), and its length. The first node is
   *  dropped when it is behind the start (the car is already past it toward the
   *  next), so the line does not begin with a spur back to it. */
  routeOf(path, x, z) {
    const city = this.city;
    let i0 = 0;
    if (path.length > 1) {
      const a = city.nodes[path[0]], b = city.nodes[path[1]];
      if ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z) > 0) i0 = 1;
    }
    let m = 0;
    const pts = [x, z];
    for (let i = i0; i < path.length; i++) {
      const n = city.nodes[path[i]];
      m += Math.hypot(n.x - pts[pts.length - 2], n.z - pts[pts.length - 1]);
      pts.push(n.x, n.z);
    }
    return { pts, m };
  }

  // --- the destination -----------------------------------------------------

  /** The wants that exist on this map: [{ name, x, z }]. */
  destinations() {
    if (this._dests) return this._dests;
    const out = [];
    for (const [name, kind, key] of WANT) {
      const hit = kind === 'lm' ? G.LANDMARKS.find((l) => l.name === key || l.name.startsWith(key))
        : G.PLACES.find((q) => q.n === key);
      if (hit) out.push({ name, x: hit.x, z: hit.z });
    }
    return (this._dests = out);
  }

  /** Pick where they are going from where the car is: a recognisable place
   *  700-6000 m off whose route the A* finds. Returns the run's route fields. */
  choose(x, z) {
    const city = this.city, T = this.traffic;
    const from = this.mainNode(x, z, 250);
    if (from < 0) return null;
    const { par } = this.comps();
    const cand = this.destinations().filter((d) => { const l = Math.hypot(d.x - x, d.z - z); return l > 700 && l < 6000; });
    // (shuffled; any left over for a nameless corner, by the delivery rule)
    for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
    const tries = cand.slice(0, 5);
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2, r = 900 + Math.random() * 2200;
      tries.push({ name: null, x: x + Math.cos(a) * r, z: z + Math.sin(a) * r });
    }
    for (const c of tries) {
      const sp = city.respawnPointNear(c.x, c.z, 450);
      if (!sp || sp.elev) continue;
      const to = this.mainNode(sp.x, sp.z, 60);
      if (to < 0 || to === from || city.nodes[to].elev || par[to] !== par[from]) continue;
      const path = T.findPath(from, to, 3200, true);
      if (!path || path.length < 3) continue;
      const { pts, m } = this.routeOf(path, x, z);
      if (m < 500) continue;
      const nd = city.nodes[to];
      const straight = Math.hypot(nd.x - x, nd.z - z);
      return {
        dest: { x: nd.x, z: nd.z, y: city.groundAt(nd.x, nd.z, null), name: c.name || G.placeNameAt(nd.x, nd.z) },
        // (a pickup whose way round is wild does not inflate the fare: it is paid
        // on the route capped at PAY_CAP x the crow flight, and costs the time)
        route: Float32Array.from(pts), path, m, payM: Math.min(m, PAY_CAP * straight),
      };
    }
    return null;
  }

  board(player) {
    const run = this.run, v = player.vehicle, ped = run.ped;
    const pick = this.choose(v.x, v.z);
    if (!pick) {
      this.release(ped);
      this.run = null; this.hud.fare = null; this.mark.visible = false;
      this.noFare(player, 'They changed their mind — the fare walks off');
      return;
    }
    this.fails = 0;
    this.peds.remove(ped);
    run.ped = null;
    Object.assign(run, pick, fareFor(pick.m, pick.payM));
    run.stage = 'ride'; run.t = 0; run.ride = 0; run.lastX = v.x; run.lastZ = v.z; run.drove = 0;
    this.hud.fare = { hail: null, dest: pick.dest, route: pick.route };
    this.placeMark(pick.dest.x, pick.dest.y, pick.dest.z, false);
    this.hud.showToast(`Take me to ${pick.dest.name} — ${this.dist(pick.m)}, ${formatMoney(run.fare)} on the meter`, 3600);
    if (this.audio && this.audio.ready) { this.audio.play('door_close', { gain: 0.45 }); this.audio.ui('start'); }
  }

  // --- the end of a fare ---------------------------------------------------

  /** Hand a passenger back to the street (or take them away if they are far). */
  release(ped, away) {
    if (!ped) return;
    ped.fare = 0;
    if (away) { this.peds.remove(ped); return; }
    ped.state = 'walk';
    this.peds.reanchor(ped);
  }

  end(ok, msg) {
    const run = this.run;
    if (run && run.ped) {
      const d = this._pd ? Math.hypot(run.ped.x - this._pd.x, run.ped.z - this._pd.z) : 1e9;
      this.release(run.ped, d > 70);
    }
    for (const l of this.leavers) this.release(l.p, false);
    this.leavers.length = 0;
    this.run = null;
    this.on = false;
    this.nextT = 0;
    this.streak = 0;
    this.mark.visible = false;
    this.hud.fare = null;
    this.setBtn(false);
    // the line goes back only if it is still ours -- and to the delivery that is
    // current NOW (one delivered during the shift has already replaced the one
    // that was up when it began)
    if (this._objTxt === '' || (this.hud.objective && this.hud.objective.textContent === this._objTxt)) {
      const t = this.game.target;
      this.hud.setObjective(t ? `Deliver to ${G.placeNameAt(t.x, t.z)} — ${formatMoney(this.game.deliveryValue)}` : '');
    }
    this._objTxt = '';
    if (msg) this.hud.showToast(msg, 3200);
    if (!ok && run && this.audio && this.audio.ready) this.audio.ui('fail');
  }

  /** The tip so far: the share of the fare that rides on speed and smoothness. */
  tipNow(run) {
    const sp = run.limit > run.par ? clamp((run.limit - run.ride) / (run.limit - run.par), 0, 1) : 1;
    return Math.round(run.fare * TIP_SHARE * sp * clamp(run.smooth, 0, 1));
  }

  arrive(player) {
    const run = this.run, v = player.vehicle;
    const tip = this.tipNow(run);
    this.streak++;
    const bonus = this.streak >= 2 ? STREAK_BONUS * Math.min(this.streak - 1, STREAK_MAX) : 0;
    const pay = run.fare + tip + bonus;
    this.game.money += pay;
    this.stats.fares++; this.stats.earned += pay;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak);
    this.save();
    // out of the door nearer the kerb, and off down the pavement
    const side = this.doorSide(v, run.dest.x, run.dest.z);
    const ex = v.x + side.x * (v.halfWid + 0.7), ez = v.z + side.z * (v.halfWid + 0.7);
    const ped = this.peds.spawnFare(ex, ez, 0, 400);   // (any pavement: placed by hand below)
    if (ped) {
      ped.x = ex; ped.z = ez; ped.y = this.city.groundAt(ex, ez, v.y + 1, this.city.roadLift(ex, ez));
      ped.fare = 2; ped.fx = ex + side.x * 14; ped.fz = ez + side.z * 14;
      ped.h.group.position.set(ped.x, ped.y, ped.z);
      this.leavers.push({ p: ped, t: 0 });
    }
    this.mark.visible = false;
    this.hud.fare = null;
    const tipTxt = tip > 0 ? ` + ${formatMoney(tip)} tip` : ' (no tip)';
    this.hud.showToast(`${run.dest.name} — ${formatMoney(run.fare)}${tipTxt}${bonus ? ` + ${formatMoney(bonus)} shift streak ×${this.streak}` : ''}`, 4200);
    if (this.audio && this.audio.ready) { this.audio.play('door_open', { gain: 0.4 }); this.audio.cash(); }
    this.run = null;
    this.nextT = 5;
    this.setObj(`Taxi · fare ${this.stats.fares} done · ${formatMoney(pay)} · next one hailing…`);
    this.last = { pay, fare: run.fare, tip, bonus, streak: this.streak };
  }

  /** The unit vector from the car toward whichever side of it (x, z) lies on. */
  doorSide(v, x, z) {
    const rx = v.forward.z, rz = -v.forward.x;
    const s = (x - v.x) * rx + (z - v.z) * rz >= 0 ? 1 : -1;
    return { x: rx * s, z: rz * s };
  }

  // --- the passenger -------------------------------------------------------

  say(kind, force) {
    const run = this.run;
    if (!run || (!force && run.sayT > 0)) return;
    const l = SAY[kind];
    run.sayT = LINE_GAP;
    this.hud.showToast(`“${l[Math.floor(Math.random() * l.length)]}”`, 2200);
    if (this.audio && this.audio.ready) this.audio.ui(kind === 'close' || kind === 'smooth' ? 'check' : 'tick');
  }

  /** game.onCrash: a hit while a passenger is aboard costs the tip. */
  onCrash(impact) {
    const run = this.run;
    if (!run || run.stage !== 'ride' || run.cd > 0) return;
    if (impact >= CRASH_AT) {
      run.crashes++; run.smooth -= 0.3; this.streak = 0; run.cd = 1.2;
      this.say('crash', true);
    } else if (impact >= BUMP_AT) {
      run.bumps++; run.smooth -= 0.1; run.cd = 0.8;
      this.say('bump', true);
    }
    run.smooth = Math.max(0, run.smooth);
  }

  /** game.onPedHit: running somebody down is the worst of it. */
  onPedHit(byPlayer) {
    const run = this.run;
    if (!byPlayer || !run || run.stage !== 'ride' || run.pedCd > 0) return;
    run.pedCd = 2;   // (a pile-up is one penalty, not one a pedestrian)
    run.crashes++; run.smooth = Math.max(0, run.smooth - 0.4); this.streak = 0;
    this.say('hit', true);
  }

  // --- per frame -----------------------------------------------------------

  update(dt, player) {
    const taxi = this.available(player);
    // FARE shows in a taxi only
    const want = taxi ? '1' : '';
    if (this._shown !== want && this.root) { this._shown = want; this.root.dataset.taxi = want; }
    this._pd = player.position;
    // passengers walking away from a drop-off join the crowd after a few seconds
    for (let i = this.leavers.length - 1; i >= 0; i--) {
      const l = this.leavers[i];
      l.t += dt;
      if (l.t > 5 || l.p.state === 'down' || !this.peds.peds.includes(l.p)) { this.release(this.peds.peds.includes(l.p) ? l.p : null, false); this.leavers.splice(i, 1); }
    }
    if (!this.on) return;
    const game = this.game;
    if (game.dead) { this.end(false, 'Fare over'); return; }
    if (!taxi) { this.end(false, 'You left the taxi — fare over'); return; }
    if (player.vehicle !== this.veh) { this.end(false, 'You changed cabs — fare over'); return; }
    if (game.wanted >= 3) { this.end(false, 'Police on your tail — the passenger bails'); return; }
    const v = player.vehicle, p = player.position;
    if (!this.run) {
      this.nextT -= dt;
      if (this.nextT <= 0) this.hail(player);
      return;
    }
    const run = this.run;
    run.t += dt;
    run.sayT -= dt; run.cd -= dt; run.pedCd -= dt; this._objCd -= dt;
    if (run.stage === 'hail') this.updateHail(dt, player, v);
    else this.updateRide(dt, player, v);
    if (this.mark.visible) {
      this.mark.rotation.y += dt * 0.7;
      this.mark.material.opacity = 0.22 + Math.sin(performance.now() * 0.004) * 0.1;
    }
  }

  updateHail(dt, player, v) {
    const run = this.run, ped = run.ped;
    if (!ped || !this.peds.peds.includes(ped) || ped.state === 'down') {
      this.run = null; this.hud.fare = null; this.mark.visible = false;
      this.hud.showToast('Your fare got hurt — they are not riding today');
      this.nextT = 6; this.setObj('Taxi · looking for a fare…');
      this.release(ped && this.peds.peds.includes(ped) ? ped : null, false);
      return;
    }
    const d = Math.hypot(ped.x - v.x, ped.z - v.z);
    if (run.stage === 'hail' && !run.walking) {
      if (run.t > HAIL_GIVE_UP) { this.end(false, 'Your fare found another cab'); return; }
      if (d < BOARD_R && Math.abs(v.vLong) < STOP_V) run.stopT += dt; else run.stopT = Math.max(0, run.stopT - dt);
      if (run.stopT > BOARD_T) {
        // they walk to the door nearer them
        const side = this.doorSide(v, ped.x, ped.z);
        ped.fare = 2;
        run.door = { x: v.x + side.x * (v.halfWid + 0.5), z: v.z + side.z * (v.halfWid + 0.5), side };
        ped.fx = run.door.x; ped.fz = run.door.z;
        run.walking = true; run.walkT = 0;
        this.mark.visible = false;
        if (this.audio && this.audio.ready) this.audio.ui('check');
      }
    } else {
      // walking to the door (it follows the car if it creeps); in when there, or after 7 s
      run.walkT += dt;
      const side = this.doorSide(v, ped.x, ped.z);
      run.door.x = v.x + side.x * (v.halfWid + 0.5); run.door.z = v.z + side.z * (v.halfWid + 0.5);
      ped.fx = run.door.x; ped.fz = run.door.z;
      if (Math.hypot(ped.x - run.door.x, ped.z - run.door.z) < 1.3 || run.walkT > 7) { this.board(player); return; }
      if (d > 30) { run.walking = false; ped.fare = 1; ped.fx = ped.x; ped.fz = ped.z; run.stopT = 0; this.placeMark(ped.x, ped.y, ped.z, true); }
    }
    if (run.stage === 'hail') {
      const left = Math.max(0, HAIL_GIVE_UP - run.t);
      if (this.mark.visible) this.placeMark(ped.x, ped.y, ped.z, true, true);
      this.setObjThrottled(`Taxi · fare waiting in ${run.place} · ${this.dist(d)}${run.walking ? ' · boarding…' : ' · pull up and stop'} · ${Math.ceil(left)}s`);
    }
  }

  updateRide(dt, player, v) {
    const run = this.run, d = Math.hypot(run.dest.x - v.x, run.dest.z - v.z);
    run.ride += dt;
    run.drove += Math.hypot(v.x - run.lastX, v.z - run.lastZ);
    run.lastX = v.x; run.lastZ = v.z;
    if (run.ride > run.limit) { this.end(false, `Out of time — the passenger gets out. ${this.stats.fares} fares today`); return; }
    if (run.ride > run.par && !run.lateSaid) { run.lateSaid = true; this.say('late', true); }
    // a close pass at speed (5 Hz): a little of the smoothness back
    run.nmT -= dt;
    if (run.nmT <= 0) { run.nmT = 0.2; this.nearMiss(run, v); }
    // pulled up at the drop-off
    if (d < DROP_R && Math.abs(v.vLong) < STOP_V) { run.stopT += dt; if (run.stopT > 0.4) { this.arrive(player); return; } } else run.stopT = 0;
    this.placeMark(run.dest.x, run.dest.y, run.dest.z, false);
    const m = Math.round(run.fare * clamp(run.drove / run.m, 0, 1));
    const left = Math.max(0, run.limit - run.ride);
    this.setObjThrottled(`Taxi → ${run.dest.name} · ${this.dist(d)} · meter ${formatMoney(m)} · tip ${formatMoney(this.tipNow(run))} · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
  }

  /** A traffic car passing within a metre or so of the taxi's flank, fast. */
  nearMiss(run, a) {
    if (run.cdNear > 0 || Math.abs(a.vLong) < 10 || run.near >= 3) { run.cdNear = (run.cdNear || 0) - 0.2; return; }
    const fx = a.forward.x, fz = a.forward.z, rx = fz, rz = -fx;
    for (const o of this.traffic.cars) {
      if (o === a || o.mode === 'parked' || o.dead || !o.forward) continue;
      const dx = o.x - a.x, dz = o.z - a.z;
      if (dx * dx + dz * dz > 100) continue;
      const lat = Math.abs(dx * rx + dz * rz) - a.halfWid - o.halfWid, lon = Math.abs(dx * fx + dz * fz);
      if (lat < 0.15 || lat > 1.2 || lon > a.halfLen + o.halfLen) continue;
      const rel = Math.hypot(a.forward.x * a.vLong - o.forward.x * o.vLong, a.forward.z * a.vLong - o.forward.z * o.vLong);
      if (rel < 14) continue;
      run.near++; run.smooth = Math.min(1, run.smooth + 0.05); run.cdNear = 3;
      this.say('close');
      return;
    }
  }

  // --- HUD -----------------------------------------------------------------

  placeMark(x, y, z, thin, keepScale) {
    const m = this.mark;
    if (!keepScale) m.scale.set(thin ? 0.22 : 1, thin ? 1.1 : 1, thin ? 0.22 : 1);
    // over a person's head, not round them: a beam they stand in hides them
    m.position.set(x, y + (thin ? 16 : 0), z);
    m.visible = true;
  }

  /** The line on the HUD, at 4 Hz of game time (and only when it changes). */
  setObjThrottled(t) {
    if (this._objCd > 0 && this._objStage === (this.run && this.run.stage)) return;
    this._objCd = 0.25;
    this._objStage = this.run && this.run.stage;
    this.setObj(t);
  }

  setObj(t) {
    if (t === this._objTxt) return;
    this._objTxt = t;
    this.hud.setObjective(t);
  }

  setBtn(on) { if (this._btn) this._btn.classList.toggle('on', on); }

  dist(m) { return m > 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m'; }
}
