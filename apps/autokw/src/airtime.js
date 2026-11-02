// Auto KW: the free-form stunt bonus. Any time the player's road vehicle (a car,
// a bike, a quad, a bicycle) leaves the ground off ANYTHING -- a crest, a ramp,
// a ditch, a barrier, a parking deck, the kart bridge -- the jump is measured
// and, on a clean landing, paid, the way the old GTAs paid for airtime.
//
// THE GROUND TEST IS THE VEHICLE'S OWN. vehicles.js already knows: the vertical
// follow sets `onGround = false` while the body is more than 0.25 m over the
// floor it is following (a crest, a drop, a launch), and a stunt-ramp flight
// sets `stunt` (Vehicle.stuntAir) until the wheels find something. This file
// reads those two flags and nothing else: no second ground query.
//
// MEASURED while airborne: airtime (game seconds, so the stunt cinematic's slow
// motion does not inflate it), horizontal distance from take-off to the final
// touchdown, height (the most metres over the take-off point), flips (the
// body's accumulated pitch or roll, in whole 360s) and spins (accumulated yaw,
// in whole 360s; net, so steering left-right-left is not a spin).
//
// COUNTED from MIN_AIR (0.8 s) only: a crest or kerb hop is nothing. The tier
// is 1 + how many of (distance >= 30 m, height >= 4 m, flips >= 1, spins >= 1)
// you hit; pay is $10 a metre plus the tier's bonus. A touchdown on a qualifying
// jump starts a SETTLE window: lifting off again inside it (a bounce) continues
// the same jump; at its end the landing is judged. CLEAN = upright at
// touchdown (not on the roof or a side), not wrecked, not in water, the player
// still in it. Then the big readout + chime; otherwise "STUNT FAILED".
//
// THE UNIQUE JUMPS (stunts.js) PAY THEIR OWN. A flight stunts.js is scoring
// (`stunts.run` on this vehicle) stays silent here: no live counter, no
// readout, no pay -- its toast already says it -- but its stats still count
// toward the bests. A slow ramp launch stunts.js does not score is scored here.
//
// CHEATS (cheats.js `CHEAT.on`): the jump is shown, nothing is paid or saved.
//
// COST: grounded, one flag test a frame. The DOM (two elements and a style
// sheet) is built on the first jump that passes MIN_AIR; no meshes.

import * as G from './geo.js';
import { angleWrap } from './util.js';
import { CHEAT } from './cheats.js';

export const MIN_AIR = 0.8;        // seconds of air before a jump counts
export const SETTLE = 0.6;         // seconds after touchdown before the landing is judged
export const CRIT = { dist: 30, height: 4, flips: 1, spins: 1 };
const PER_M = 10;                  // $ a metre
// tier = 1 + criteria hit (0..4)
export const TIERS = [
  { name: 'STUNT BONUS', bonus: 50 },
  { name: 'DOUBLE STUNT', bonus: 150 },
  { name: 'TRIPLE STUNT', bonus: 400 },
  { name: 'QUADRUPLE STUNT', bonus: 800 },
  { name: 'WATERLOO WARRIOR', bonus: 2000 },
];
const KEY = 'autokw-airtime';
const TWO_PI = Math.PI * 2;
const TELEPORT = 25;               // m in one frame: a warp, not a flight

/** A vehicle the bonus counts: road vehicles, bikes, quads, bicycles. */
export function eligible(v) {
  if (!v || v.dead || v.wreck) return false;
  const s = v.spec || {};
  return !(s.balloon || s.heli || s.fighter || s.plane || s.saucer || s.kayak || s.hydro || s.boat || s.rail || v.afloat);
}

/** The tier and pay for measured stats (no landing judgement). */
export function score(st) {
  const hits = (st.dist >= CRIT.dist) + (st.height >= CRIT.height) + (st.flips >= CRIT.flips) + (st.spins >= CRIT.spins);
  const tier = TIERS[hits];
  const pay = Math.round((st.dist * PER_M + tier.bonus) / 10) * 10;
  return { hits, tier: hits, name: tier.name, pay };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { air: +s.air || 0, dist: +s.dist || 0, height: +s.height || 0, flips: +s.flips || 0, spins: +s.spins || 0,
      tier: s.tier == null ? -1 : +s.tier, n: +s.n || 0 };
  } catch (e) { return { air: 0, dist: 0, height: 0, flips: 0, spins: 0, tier: -1, n: 0 }; }
}

export class Airtime {
  constructor({ game, hud, audio, stunts }) {
    this.game = game; this.hud = hud; this.audio = audio; this.stunts = stunts;
    this.save = loadSave();
    this.j = null;          // the jump in progress
    this.last = null;       // the last judged jump, for tools
    this.el = null;         // DOM, built on first use
    this.bigT = 0;
  }

  /** Drop a jump in progress (respawn, warp, tools). */
  cancel() { this.j = null; this._live(false); }

  update(dt, player) {
    if (this.bigT > 0 && (this.bigT -= dt) <= 0 && this.el) this.el.big.classList.remove('show');
    const v = player.onFoot ? null : player.vehicle;
    const j = this.j;
    if (!j) {
      // the grounded fast path: one flag test
      if (!v || !(v.stunt || v.onGround === false)) return;
      if (!eligible(v)) return;
      // one record, reused: a bumpy road takes off many times a minute
      const n = this._rec || (this._rec = {});
      n.v = v; n.t = 0; n.x0 = n.px = v.x; n.z0 = n.pz = v.z; n.y0 = v.y; n.maxUp = 0;
      n.h = v.heading; n.p = v.pitch || 0; n.r = v.roll || 0; n.yaw = 0; n.pitchAcc = 0; n.rollAcc = 0;
      n.ramp = false; n.land = -1; n.upright = true; n.dist = null; n.wetLand = false;
      this.j = n;
      this._track(n, v, player);
      return;
    }
    // the jump ends without a verdict: another vehicle, out of it, dead, warped
    if (v !== j.v || player.dead || this.game.dead) { this._end(j, v === j.v ? v : j.v, player); return; }
    const air = v.stunt || v.onGround === false;
    if (Math.hypot(v.x - j.px, v.z - j.pz) > TELEPORT) { this.cancel(); return; }
    if (j.land < 0) {
      j.t += dt;
      // nothing flies for 30 s: a state some other system holds the car in
      if (j.t > 30) { this.cancel(); return; }
      this._track(j, v, player);
      if (!air) {
        // touchdown
        if (j.t < MIN_AIR) { this.cancel(); return; }
        j.land = 0;
        j.dist = Math.hypot(v.x - j.x0, v.z - j.z0);
        j.upright = Math.cos(v.pitch || 0) * Math.cos(v.roll || 0) > 0.5;
        j.wetLand = G.isWater(v.x, v.z) || !!v.afloat;
        if (!j.upright || v.dead) { this._end(j, v, player); return; }
      } else if (!j.ramp && j.t >= MIN_AIR) {
        this._live(true);
        this.el.liveT.textContent = j.t.toFixed(1);
      }
    } else {
      // settling: a bounce continues the same jump
      if (air) { j.land = -1; j.px = v.x; j.pz = v.z; return; }
      j.land += dt;
      j.px = v.x; j.pz = v.z;
      if (v.dead || v.wreck || G.isWater(v.x, v.z) || v.afloat || j.land >= SETTLE) this._end(j, v, player);
    }
  }

  /** One airborne frame's accumulation. */
  _track(j, v, player) {
    j.yaw += angleWrap(v.heading - j.h); j.h = v.heading;
    const p = v.pitch || 0, r = v.roll || 0;
    j.pitchAcc += angleWrap(p - j.p); j.p = p;
    j.rollAcc += angleWrap(r - j.r); j.r = r;
    j.maxUp = Math.max(j.maxUp, v.y - j.y0);
    j.px = v.x; j.pz = v.z;
    const st = this.stunts;
    if (!j.ramp && (v.stunt && st && st.run && st.run.v === v)) j.ramp = true;
  }

  /** Judge a jump that reached MIN_AIR (or bail one that ended mid-air). */
  _end(j, v, player) {
    this.j = null;
    this._live(false);
    if (j.t < MIN_AIR) return;
    const dist = j.dist != null ? j.dist : Math.hypot(v.x - j.x0, v.z - j.z0);
    const stats = {
      air: +j.t.toFixed(2), dist: +dist.toFixed(1), height: +Math.max(0, j.maxUp).toFixed(1),
      flips: Math.floor(Math.max(Math.abs(j.pitchAcc), Math.abs(j.rollAcc)) / TWO_PI + 0.02),
      spins: Math.floor(Math.abs(j.yaw) / TWO_PI + 0.02),
    };
    const sc = score(stats);
    let why = '';
    if (j.land < 0) why = player.vehicle !== v ? 'bailed out' : 'never landed';
    else if (!j.upright) why = 'landed on the roof';
    else if (v.dead || v.wreck) why = 'wrecked';
    else if (j.wetLand || G.isWater(v.x, v.z) || v.afloat) why = 'splashdown';
    else if (player.vehicle !== v || player.onFoot) why = 'bailed out';
    const clean = !why;
    const cheated = CHEAT.on;
    const pay = clean && !j.ramp && !cheated ? sc.pay : 0;
    if (pay) this.game.money += pay;
    let record = false;
    if (clean && !cheated) {
      const s = this.save;
      for (const k of ['air', 'dist', 'height', 'flips', 'spins']) if (stats[k] > s[k]) { s[k] = stats[k]; record = true; }
      if (sc.tier > s.tier) { s.tier = sc.tier; record = true; }
      s.n++;
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
    }
    this.last = { ...stats, tier: sc.tier, name: sc.name, pay, clean, why, ramp: j.ramp, cheated, record,
      shown: !j.ramp && (clean || j.land >= 0) };
    if (j.ramp) return;   // stunts.js printed and paid this one
    if (clean) this._show(sc, stats, pay, cheated, record);
    else if (j.land >= 0 || why === 'bailed out') this._fail(why);
  }

  _show(sc, st, pay, cheated, record) {
    this._dom();
    const e = this.el;
    const bits = [`${st.air.toFixed(1)} s`, `${Math.round(st.dist)} m`];
    if (st.height >= 1) bits.push(`${Math.round(st.height)} m high`);
    if (st.flips) bits.push(plural(st.flips, 'flip'));
    if (st.spins) bits.push(plural(st.spins, 'spin'));
    e.title.textContent = sc.name;
    e.stats.textContent = bits.join(' · ');
    e.cash.textContent = cheated ? 'cheats are on: not counted' : `+$${pay}` + (record ? ' · NEW BEST' : '');
    e.big.className = 'show t' + sc.tier;
    this.bigT = 3.4;
    const a = this.audio;
    if (a && a.play) {
      const notes = [1, 1.26, 1.5, 2, 2.52].slice(0, sc.tier + 1);
      notes.forEach((r, i) => a.play('ui_check', { at: i * 0.085, rate: r, gain: 0.5, send: 0.04, jitter: false }));
      if (!cheated && a.cash) a.cash();
    }
  }

  _fail(why) {
    this._dom();
    const e = this.el;
    e.title.textContent = 'STUNT FAILED';
    e.stats.textContent = why;
    e.cash.textContent = '';
    e.big.className = 'show fail';
    this.bigT = 2.2;
    if (this.audio && this.audio.ui) this.audio.ui('fail');
  }

  _live(on) {
    if (on) this._dom();
    if (!this.el) return;
    this.el.live.classList.toggle('show', on);
  }

  _dom() {
    if (this.el) return;
    const st = document.createElement('style');
    // Centred in the upper middle: under the toast row, over the road, clear of
    // the stick (left third) and the pad (bottom right) in phone landscape.
    st.textContent = `
#airLive{position:absolute;left:50%;top:calc(96px + var(--safe-t,0px));transform:translateX(-50%);opacity:0;transition:opacity .15s;
 font-weight:800;font-size:15px;letter-spacing:.12em;color:#ffe9a8;text-shadow:0 2px 8px rgba(0,0,0,.85);white-space:nowrap;font-variant-numeric:tabular-nums}
#airLive.show{opacity:1}
#airLive b{font-size:22px;color:#fff;margin-left:6px}
#airBig{position:absolute;left:50%;top:calc(92px + var(--safe-t,0px));transform:translateX(-50%) scale(.85);opacity:0;
 transition:opacity .25s,transform .25s;text-align:center;white-space:nowrap;max-width:calc(100vw - 40px)}
#airBig.show{opacity:1;transform:translateX(-50%) scale(1)}
#airBig .h{font-weight:900;font-size:clamp(26px,4.4vw,44px);letter-spacing:.08em;color:#ffd24a;
 text-shadow:0 0 18px rgba(255,170,40,.55),0 4px 0 #6a3a00,0 6px 18px rgba(0,0,0,.8);font-style:italic}
#airBig.t3 .h,#airBig.t4 .h{color:#ff8ad0;text-shadow:0 0 22px rgba(255,90,190,.6),0 4px 0 #5a0a40,0 6px 18px rgba(0,0,0,.8)}
#airBig.fail .h{color:#ff6a5a;font-size:clamp(20px,3.6vw,30px);text-shadow:0 3px 0 #4a0800,0 6px 16px rgba(0,0,0,.8)}
#airBig .s{margin-top:4px;font-weight:700;font-size:14px;letter-spacing:.06em;color:#f2f2f2;text-shadow:0 2px 8px rgba(0,0,0,.9)}
#airBig .c{margin-top:2px;font-weight:800;font-size:20px;color:#8ff0b0;text-shadow:0 2px 8px rgba(0,0,0,.9)}`;
    document.head.appendChild(st);
    const host = document.getElementById('hud') || document.body;
    const live = document.createElement('div');
    live.id = 'airLive';
    live.innerHTML = 'AIRTIME<b>0.0</b> s';
    const big = document.createElement('div');
    big.id = 'airBig';
    big.innerHTML = '<div class="h"></div><div class="s"></div><div class="c"></div>';
    host.appendChild(live); host.appendChild(big);
    this.el = { live, liveT: live.querySelector('b'), big, title: big.querySelector('.h'), stats: big.querySelector('.s'), cash: big.querySelector('.c') };
  }

  /** The pause menu's passport rows. */
  passportRows() {
    const s = this.save;
    if (!s.n) return [{ label: 'Best stunt', text: 'none yet' }];
    const best = `${s.air.toFixed(1)} s, ${Math.round(s.dist)} m, ${plural(s.flips, 'flip')}`;
    return [{ label: 'Best stunt', text: best }, { label: 'Best stunt bonus', text: s.tier >= 0 ? TIERS[s.tier].name : '-', wide: true }];
  }
}
