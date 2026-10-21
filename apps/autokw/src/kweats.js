// KW EATS: food delivery from real restaurants to real front doors.
//
// data/eats.json (tools/kw/build_eats.py): ~120 restaurants where OSM puts
// them -- the delivery chains (Pizza Pizza, Swiss Chalet, Harvey's, ...) and
// the local ones (Lazeez, Pita Pit, Ennio's, Morty's Pub, Gino's, Campus
// Pizza, Kismet, Mr. Panino's...) -- each with a food KIND; and ~1,600 real
// addressed homes (houses and apartment blocks, one per 170 m cell), each
// door the point of its footprint nearest its own street.
//
// Every restaurant is on the map (`eats`). Stop beside one in a car or on a
// bike (or a motorbike) and you are on shift: the order is bagged
// (`PREP` s), then it is for a real address 0.6-3.2 km off, with a quoted
// time from the distance and what you ride. Deliver by stopping within
// DROP_R of the door, or walk it to the door on foot.
//
// THE ORDER SPOILS as you drive: lateral g past SLOSH_LAT, braking past
// SLOSH_BRAKE, a landing from a jump and every crash take some of its
// condition, times its kind's `sens` (soup and ramen slosh, pizza cheese
// slides, a shawarma survives anything). The customer's tip is up to TIP of
// the order's value, by how soon (full by the quote, none at twice it) and
// by the condition; the base pay is a fee + a rate a km. At 2.5x the quote
// the customer cancels. After a delivery the next order pings from a
// restaurant near you; the shift ends when you ride something else, three
// stars, or no order is picked up for PICKUP_GIVE_UP.
//
// Harness: `__dbg.eats` (`rest`, `homes`, `run`, `begin(rest)`, `stats`);
// the probe is tools/kw/eatsprobe.mjs (one delivery with real keys).

import * as THREE from './three.js';
import { clamp, formatMoney } from './util.js';
import { Feel } from './grtbus.js';

const KEY = 'autokw-eats';
const START_R = 48;           // stopped this close to a restaurant (its point can be deep in a plaza)
const STOP_V = 1.5;
const PREP = 3;               // s the kitchen takes once you are there
const DROP_R = 30;            // stopped this close to the door (a house sits back from the street)
const DROP_R_FLATS = 45;      // ...an apartment block's further, behind its lot
const DOOR_R = 4.5;           // on foot
const DIST_MIN = 600, DIST_MAX = 3200;
const OFFER_R = 1600;         // the next order's restaurant: this near
const PICKUP_GIVE_UP = 240;
const FEE = 5, PER_KM = 1.6, TIP = 0.3;
const SLOSH_LAT = 4.5, SLOSH_BRAKE = 8;

// food kinds: how it spoils, and what the customer says about it
const KINDS = {
  pizza: { sens: 1.0, what: 'pizza', bad: 'The cheese is sliding off the pizza!' },
  shawarma: { sens: 0.55, what: 'shawarma', bad: 'Garlic sauce everywhere in the bag!' },
  pita: { sens: 0.55, what: 'pita', bad: 'The pita is coming apart!' },
  burger: { sens: 0.75, what: 'burger and fries', bad: 'Fries all over the bag!' },
  chicken: { sens: 0.75, what: 'chicken dinner', bad: 'The dipping sauce tipped over!' },
  wings: { sens: 0.7, what: 'wings', bad: 'Wing sauce on the lid!' },
  pasta: { sens: 1.15, what: 'pasta', bad: 'The sauce is leaking!' },
  curry: { sens: 1.35, what: 'curry', bad: 'The curry is leaking out of the lid!' },
  ramen: { sens: 1.6, what: 'ramen', bad: 'The broth is slopping out!' },
  sushi: { sens: 1.25, what: 'sushi', bad: 'The rolls are tumbling out of line!' },
  chinese: { sens: 1.1, what: 'chinese food', bad: 'The soup is sloshing!' },
  bbq: { sens: 0.8, what: 'brisket', bad: 'The coleslaw tipped!' },
  sandwich: { sens: 0.5, what: 'bánh mì', bad: 'The sandwich is squashed!' },
};

function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }

export class KwEats {
  constructor({ scene, city, game, hud, audio, data, panel }) {
    this.scene = scene; this.city = city; this.game = game; this.hud = hud; this.audio = audio; this.panel = panel;
    this.rest = ((data && data.r) || []).map(([name, x, z, kind], i) => ({ i, name, x, z, kind: KINDS[kind] ? kind : 'burger' }));
    const streets = (data && data.s) || [];
    this.homes = ((data && data.h) || []).map(([x, z, num, si, flats]) => ({ x, z, addr: `${num} ${streets[si] || ''}`.trim(), flats: !!flats }));
    this.run = null;          // the order in hand (or being picked up)
    this.on = false;          // on shift
    this.offer = null;        // the restaurant the next order is waiting at
    this.offerT = 0;
    this.hinted = -1; this.noOrder = -1;
    this.stats = { orders: 0, earned: 0, bestTip: 0, perfect: 0 };
    Object.assign(this.stats, read());
    this.mark = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 22, 14, 1, true), new THREE.MeshBasicMaterial({
      color: 0xff6a2a, transparent: true, opacity: 0.3, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false,
    }));
    this.mark.visible = false;
    this.mark.frustumCulled = false;
    scene.add(this.mark);
  }

  warmMeshes() { const m = new THREE.Mesh(this.mark.geometry, this.mark.material); m.frustumCulled = false; return [m]; }

  places() {
    return this.rest.map((r) => ({ x: r.x, z: r.z, kind: 'eats', name: `${r.name} (KW Eats)`, near: false, hello: null }));
  }

  jobRows() {
    const s = this.stats;
    return [{ name: 'KW Eats deliveries', sub: 'any KW Eats kitchen on the map', best: s.orders ? `${s.orders} orders · ${formatMoney(s.earned)}` : null,
      medal: s.perfect >= 10 ? 'gold' : s.perfect >= 3 ? 'silver' : s.orders ? 'bronze' : null }];
  }

  /** In something that delivers: a road car (not a bus or a truck), a bike, a motorbike. */
  canRide(player) {
    const v = player.vehicle;
    if (player.onFoot || !v || v.dead) return false;
    const s = v.spec;
    return !!((s.roadCar && s.len < 7 && !s.bus) || s.bicycle || (s.moto && !s.jetski));
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.stats)); } catch (e) { /* private mode */ } }

  nearestRest(x, z, r) {
    let best = null, bd = r * r;
    for (const q of this.rest) { const d = (q.x - x) ** 2 + (q.z - z) ** 2; if (d < bd) { bd = d; best = q; } }
    return best;
  }

  /** A real door DIST_MIN-DIST_MAX from the restaurant with a street by it. */
  pickHome(rest) {
    for (let k = 0; k < 40; k++) {
      const h = this.homes[Math.floor(Math.random() * this.homes.length)];
      const d = Math.hypot(h.x - rest.x, h.z - rest.z);
      if (d < DIST_MIN || d > DIST_MAX) continue;
      const sp = this.city.respawnPointNear(h.x, h.z, 70);
      if (!sp || sp.elev) continue;
      return { ...h, d, kx: sp.x, kz: sp.z };
    }
    return null;
  }

  /** Start (or continue) a shift with an order from `rest`. */
  begin(rest, player) {
    const v = player.vehicle;
    const home = this.pickHome(rest);
    if (!home) { this.hud.showToast(`${rest.name}: no orders right now — try another kitchen`); return false; }
    const bike = !!(v && v.spec.bicycle);
    const road = home.d * 1.35;
    const quote = Math.round(road / (bike ? 5.5 : 10) + 45);
    const value = Math.round(16 + Math.random() * 38);
    this.on = true;
    this.offer = null;
    this.run = {
      rest, home, kind: rest.kind, K: KINDS[rest.kind], stage: 'prep', t: 0, prep: PREP, quote, value,
      pay: Math.round((FEE + PER_KM * road / 1000) * 100) / 100, cond: 100, warned: 0,
      air: 0, cd: 0, bike, num: 1000 + Math.floor(Math.random() * 9000), slosh: 0,
    };
    this.hud.showToast(`KW Eats #${this.run.num}: ${this.run.K.what} from ${rest.name} — the kitchen is bagging it…`, 3000);
    if (this.audio && this.audio.ready) this.audio.ui('ring');
    return true;
  }

  end(msg, fail) {
    this.run = null; this.on = false; this.offer = null;
    this.mark.visible = false;
    this.hud.fare = null;
    if (this.panel) this.panel.hide();
    if (msg) this.hud.showToast(msg, 3600);
    if (fail && this.audio && this.audio.ready) this.audio.ui('fail');
  }

  onCrash(impact) {
    const run = this.run;
    if (!run || run.stage !== 'go' || run.cd > 0 || impact < 4) return;
    run.cd = 0.8;
    const n = Math.min(45, impact * 2.2);
    if (run.why) run.why.crash += n * run.K.sens;
    this.spoil(n);
  }

  spoil(n) {
    const run = this.run;
    run.cond = Math.max(0, run.cond - n * run.K.sens);
    const lvl = run.cond < 30 ? 3 : run.cond < 55 ? 2 : run.cond < 80 ? 1 : 0;
    if (lvl > run.warned) {
      run.warned = lvl;
      this.hud.showToast(lvl === 3 ? `The ${run.K.what} is a mess — the tip is going…` : run.K.bad, 2400);
      if (this.audio && this.audio.ready) this.audio.play('slosh', { gain: 0.4 });
    }
  }

  tipNow(run) {
    const late = clamp((run.t - run.quote) / run.quote, 0, 1);
    return Math.round(run.value * TIP * (1 - late) * Math.pow(run.cond / 100, 1.5) * 100) / 100;
  }

  deliver() {
    const run = this.run;
    const tip = this.tipNow(run);
    const perfect = run.cond >= 95 && run.t <= run.quote;
    const bonus = perfect ? 3 : 0;
    const pay = Math.round((run.pay + tip + bonus) * 100) / 100;
    this.game.money += pay;
    this.stats.orders++; this.stats.earned = Math.round((this.stats.earned + pay) * 100) / 100;
    this.stats.bestTip = Math.max(this.stats.bestTip, tip);
    if (perfect) this.stats.perfect++;
    this.save();
    const say = run.cond >= 90 ? (run.t <= run.quote ? 'Still hot — thanks!' : 'Took a while, but it looks great') : run.cond >= 60 ? 'Bit of a mess in the bag…' : 'What happened to my food?!';
    this.last = { pay, tip, why: run.why, cond: Math.round(run.cond), t: Math.round(run.t), quote: run.quote, addr: run.home.addr, rest: run.rest.name, perfect };
    window.__eatsLast = this.last;
    this.hud.showToast(`${run.home.addr}: “${say}” — ${formatMoney(run.pay)} + ${formatMoney(tip)} tip${bonus ? ' + $3 perfect' : ''} · ${Math.round(run.cond)}% · ${Math.floor(run.t / 60)}:${String(Math.floor(run.t % 60)).padStart(2, '0')}`, 4600);
    if (this.audio && this.audio.ready) this.audio.cash();
    this.run = null;
    this.offerT = 4;   // the next order pings shortly
  }

  /** The next order, at a restaurant near (x, z) (not the one just done). */
  makeOffer(x, z) {
    const near = this.rest.filter((r) => Math.hypot(r.x - x, r.z - z) < OFFER_R);
    if (!near.length) { this.end('No KW Eats orders around here — shift over', true); return; }
    const r = near[Math.floor(Math.random() * near.length)];
    this.offer = { r, t: 0 };
    this.hud.showToast(`New order — pick up at ${r.name}, ${Math.round(Math.hypot(r.x - x, r.z - z) / 10) * 10} m`, 3200);
    if (this.audio && this.audio.ready) this.audio.ui('ring');
  }

  update(dt, player) {
    const p = player.position, ride = this.canRide(player);
    const v = ride ? player.vehicle : null;
    if (this.mark.visible) { this.mark.rotation.y += dt * 0.7; this.mark.material.opacity = 0.22 + Math.sin(performance.now() * 0.004) * 0.08; }
    if (!this.on) {
      // the marker: the nearest kitchen, while you ride something that delivers
      const near = ride ? this.nearestRest(p.x, p.z, 230) : null;
      if (!near) { this.mark.visible = false; this.hinted = -1; this.noOrder = -1; return; }
      this.place(near.x, near.z);
      const d = Math.hypot(near.x - p.x, near.z - p.z);
      if (d < START_R) {
        if (Math.abs(v.vLong) < STOP_V && this.game.wanted < 3 && !this.game.dead && this.noOrder !== near.i) {
          if (!this.begin(near, player)) this.noOrder = near.i;
        } else if (this.hinted !== near.i) { this.hinted = near.i; this.hud.showToast(`${near.name} — a KW Eats kitchen. Stop here to start delivering`, 3000); }
      } else if (d > 80) { this.hinted = -1; this.noOrder = -1; }
      return;
    }
    if (this.game.dead) { this.end('Shift over'); return; }
    if (this.game.wanted >= 3) { this.end('Police on your tail — KW Eats logs you off', true); return; }
    if (!player.onFoot && !ride) { this.end('KW Eats needs a car or a bike — shift over', true); return; }
    if (!this.run) {
      if (!this.offer) { this.offerT -= dt; if (this.offerT <= 0) this.makeOffer(p.x, p.z); return; }
      const o = this.offer;
      o.t += dt;
      if (o.t > PICKUP_GIVE_UP) { this.end('The order went to another courier — shift over', true); return; }
      this.place(o.r.x, o.r.z);
      this.hud.fare = { hail: { x: o.r.x, z: o.r.z }, dest: null, route: null };
      const d = Math.hypot(o.r.x - p.x, o.r.z - p.z);
      if (this.panel) this.panel.show('KW EATS', `Pick up at ${o.r.name}`, `${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m'} · ${Math.ceil(PICKUP_GIVE_UP - o.t)} s`, '#e8442a');
      if (ride && d < START_R && Math.abs(v.vLong) < STOP_V) this.begin(o.r, player);
      return;
    }
    const run = this.run;
    run.cd -= dt;
    if (run.stage === 'prep') {
      const d = Math.hypot(run.rest.x - p.x, run.rest.z - p.z);
      if (d > START_R + 25) { this.end('Order cancelled — you left without it', true); return; }
      run.prep -= dt;
      this.place(run.rest.x, run.rest.z);
      if (this.panel) this.panel.show(`KW EATS #${run.num}`, `${run.rest.name} is bagging your order…`, `${Math.ceil(run.prep)} s`, '#e8442a');
      if (run.prep <= 0) {
        run.stage = 'go'; run.t = 0;
        this.hud.fare = { hail: null, dest: { x: run.home.x, z: run.home.z }, route: null };
        this.hud.showToast(`Order up! ${run.K.what} for ${run.home.addr}${run.home.flats ? ' (apartments)' : ''} — ${Math.round(run.home.d / 100) / 10} km, ${Math.floor(run.quote / 60)}:${String(run.quote % 60).padStart(2, '0')} quoted. Drive smooth: it slops`, 4200);
        if (this.audio && this.audio.ready) this.audio.ui('check');
      }
      return;
    }
    run.t += dt;
    if (run.t > run.quote * 2.5) { this.end(`${run.home.addr} cancelled the order — too late`, true); return; }
    if (v) this.slosh(dt, v);
    const h = run.home;
    this.place(h.x, h.z);
    const d = Math.hypot(h.x - p.x, h.z - p.z);
    if ((v && d < (h.flats ? DROP_R_FLATS : DROP_R) && Math.abs(v.vLong) < STOP_V) || (player.onFoot && d < DOOR_R)) { this.deliver(); return; }
    const left = run.quote - run.t;
    const tl = `${left < 0 ? '-' : ''}${Math.floor(Math.abs(left) / 60)}:${String(Math.floor(Math.abs(left) % 60)).padStart(2, '0')}`;
    if (this.panel) this.panel.show(`KW EATS #${run.num} · ${run.rest.name}`, `${h.addr}`,
      `${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m'} · ${tl} · ${run.K.what} ${Math.round(run.cond)}% · tip ${formatMoney(this.tipNow(run))}`, '#e8442a');
  }

  /** Lateral and braking g and landings, past their thresholds, spoil the order. */
  slosh(dt, v) {
    const run = this.run;
    const { along, lat } = (run.feel || (run.feel = new Feel())).step(dt, v);
    // what took it, kept for the probe (`why`)
    const W = run.why || (run.why = { lat: 0, brake: 0, land: 0, crash: 0 });
    let lt = 0, br = 0, ld = 0;
    if (Math.abs(v.vLong) > 3) {
      if (lat > SLOSH_LAT) lt = (lat - SLOSH_LAT) * 0.45 * dt;
      const dec = -along * Math.sign(v.vLong);
      if (dec > SLOSH_BRAKE) br = (dec - SLOSH_BRAKE) * 0.4 * dt;
    }
    if (v.airborne) run.air += dt;
    else { if (run.air > 0.35) ld = 6 + run.air * 10; run.air = 0; }
    W.lat += lt * run.K.sens; W.brake += br * run.K.sens; W.land += ld * run.K.sens;
    const loss = lt + br + ld;
    run.slosh += loss;
    if (loss > 0) this.spoil(loss);
  }

  place(x, z) {
    this.mark.position.set(x, this.city.groundAt(x, z, null) + 11, z);
    this.mark.visible = true;
  }
}
