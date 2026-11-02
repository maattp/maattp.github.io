// Auto KW: THE ICE CREAM TRUCK -- a GTA-style vending job (and the Weenie Wagon's hot dogs).
//
// An ice cream truck (vehicles.js `icecream`) stands at the kerb outside two real ice cream
// shops (OSM, tools/data/kw/raw_pois.json): Scoop Du Jour on Erb St E in Uptown Waterloo and
// Four All Ice Cream on King St W in downtown Kitchener (placed by firecalls.js placeStations,
// the paramedics' and the plow yard's placer). Any `icecream` works, the rare one in traffic
// too. Climb in and press MISSION (M, the pad's D-pad down, the touch button beside the pad):
// the shift starts and the jingle plays FROM THE TRUCK on a loop (audio.js `ic_jingle`, our own
// looped BufferSource on the world bus: positional, ducked while you serve, and its playbackRate
// follows your speed -- a slow, wobbly tape when you crawl).
//
//   - CUSTOMERS. Crawl a RESIDENTIAL street (citygen `cls 'res'`) under 25 km/h and people come
//     out of the houses and off the kerb, 10-40 m away, and walk (kids run) to the truck: pooled
//     crowd pedestrians (peds.js spawnTrail -- the crowd's own cap, a full crowd gives up its
//     farthest walker), steered here through `p.trail`. Kids are scaled 0.58-0.72 like
//     schoolbus.js's. At most CAP at once (6 on a phone).
//   - SALES. Stop (under 1 m/s): whoever is within 6 m of the serving hatch (the kerb side)
//     queues along the truck and is served one at a time, 1.2 s each: a coin, +$3-6 a cone, a
//     floating "+$4" over the hatch, and they walk off holding a cone (one tiny merged mesh on
//     the hand bone) before the crowd takes them back.
//   - DRIVE OFF with a queue and they are gone (and the streak with them); now and then a kid
//     runs down the street after you -- stop and he buys, with a tip. Hit anyone: shift over.
//   - THE STREAK: the first sale on each new street adds one (x2, x3 ... +$2 a step); a street
//     dries up after DRY sales ("all ice-creamed out"), and 90 s without a new street resets it.
//   - THE SEASON (kwcalendar.js calendarDate, so ?date= works): June-August more customers,
//     November and winter fewer, falling snow fewer still ("Ice cream in a snowstorm. Bold.").
//   - The shift ends on MISSION again or after 5 minutes: a summary toast, the best in
//     localStorage `autokw-icecream`.
//
// HOT DOGS (the stretch): the same job in the Weenie Wagon (vehicles.js `wiener`, the 30-egg
// prize and a rare traffic spawn). Adults only, no jingle (the Wagon's own horn tune, rate by
// speed), and the customers are the late crowd: any street (not freeways) within the Uptown
// Waterloo and downtown Kitchener bar districts (BAR_ZONES, from the OSM bars), residential
// streets elsewhere; many more at night, few by day; snow does not put anyone off a hot dog.
//
// Laws: nothing uses `game.hold` (the world runs); joins main.js jobsBusy() and storyBusy(), and
// a shift will not start over another job or a story chapter (`blocked`). No ENTER handling
// (MISSION is its own button), so traffic.nearestEnterable is never contested. CHEATS: a job
// keeps its pay (like the taxi, KW Eats, the paramedics); only stunts and eggs void it.
//
// Phone cost: NOTHING while off (the two parked trucks are traffic's 'apron' vehicles; this
// module reads the controls and checks the depots every 6 s). In a shift: up to CAP pooled
// pedestrians (inside the crowd's own cap, so not one more than a full pavement), a cone mesh
// per customer walking away (<= CAP draws, 72 tris each), one looped audio voice, one DOM float.
//
// Harness: __dbg.icecream (`run`, `depots`, `stats`, `rig`), the probe is tools/kw/icecreamprobe.mjs.

import * as THREE from './three.js';
import * as G from './geo.js';
import { BONES } from './peds.js';
import { calendarDate } from './kwcalendar.js';
import { clamp, formatMoney } from './util.js';

const KEY = 'autokw-icecream';
const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

/** The two shops (OSM amenity=ice_cream): a truck at the kerb outside each. */
export const IC_DEPOTS = [
  { name: 'Scoop Du Jour · Erb St E, Uptown Waterloo', x: -3752.8, z: -1457.8, rigs: ['icecream'] },
  { name: 'Four All Ice Cream · King St W, Kitchener', x: -1295.6, z: 176.0, rigs: ['icecream'] },
];
/** The bar districts (centroids of the OSM bars and pubs): where the hot-dog crowd is. */
export const BAR_ZONES = [
  { name: 'Uptown Waterloo', x: -3872, z: -1618, r: 560 },
  { name: 'Downtown Kitchener', x: -1343, z: 178, r: 520 },
];

export const SHIFT_S = 300;           // a shift: 5 minutes
export const SLOW = 25 / 3.6;         // customers come out below this (m/s)
export const STOP_V = 1.0;            // serving below this
export const NEAR = 40;               // customers come from within this of the truck
export const BUY_R = 6;               // ...and queue within this of the hatch
export const SERVE_T = 1.2;           // s a customer
export const DRY = 4;                 // sales before a street is all ice-creamed out
const CAP = ON_PHONE ? 6 : 8;         // customers at once
const STREAK_T = 90;                  // s without a new street: the streak resets
const STREET_BONUS = 2;               // $ per streak step on a new street

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];

/**
 * How many customers the season sends (a multiplier on the spawn rate) and what the toast says.
 * month 0-11 (the calendar's), snow = falling or lying snow, night = the sun down, zone = in a
 * bar district (hot dogs only).
 */
export function seasonMod(kind, month, snow, night, zone) {
  if (kind === 'dog') {
    let k = zone ? (night ? 2.0 : 0.7) : (night ? 0.9 : 0.45);
    let say = night ? (zone ? 'Last call crowd incoming — hot dogs!' : 'Hot dogs after dark. Head for the bars, Uptown or downtown') : 'Hot dogs by day? The bar crowd comes out after dark';
    if (snow) say = 'Hot dogs in the snow. Now that\'s a business plan';
    return { k, say };
  }
  let k = 1, say = 'Crawl the residential streets with the jingle on — under 25 km/h';
  if (month >= 5 && month <= 7) { k = 1.6; say = 'A scorcher! Every kid on the street wants a cone'; }
  else if (month === 10) { k = 0.5; say = 'Ice cream in November? Only the die-hards will come out'; }
  else if (month === 11 || month <= 1) { k = 0.55; say = 'Ice cream in the dead of winter. Brave'; }
  else if (month === 2 || month === 9) k = 0.8;
  if (snow) { k *= 0.45; say = 'Ice cream in a snowstorm. Bold.'; }
  return { k, say };
}

/** A tiny merged prop for a customer's hand: a cone and a scoop, or a hot dog in a bun. */
function makeTreat(kind) {
  const parts = [];
  const add = (geo, col) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.attributes.position.count, c = new Float32Array(n * 3), L = lin(col);
    for (let i = 0; i < n; i++) { c[i * 3] = L[0]; c[i * 3 + 1] = L[1]; c[i * 3 + 2] = L[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  };
  if (kind === 'dog') {
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.17, 6).rotateZ(Math.PI / 2).scale(1, 1, 1.4).translate(0, 0, 0), [0.86, 0.66, 0.36]);
    add(new THREE.CylinderGeometry(0.017, 0.017, 0.2, 6).rotateZ(Math.PI / 2).translate(0, 0.024, 0), [0.62, 0.20, 0.12]);
    add(new THREE.BoxGeometry(0.15, 0.006, 0.012).translate(0, 0.043, 0), [0.95, 0.80, 0.10]);
  } else {
    add(new THREE.ConeGeometry(0.034, 0.12, 8).rotateX(Math.PI).translate(0, 0.02, 0), [0.80, 0.56, 0.28]);
    add(new THREE.SphereGeometry(0.042, 8, 5).translate(0, 0.095, 0), [0.97, 0.62, 0.74]);
  }
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o); nrm.set(g.attributes.normal.array, o); col.set(g.attributes.color.array, o);
    o += g.attributes.position.count * 3;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export class IceCreamJob {
  /**
   * o: { scene, city, game, hud, audio, traffic, peds, controls, panel, camera, depots,
   *      weather: () => Weather, tod: () => TimeOfDay, blocked: () => string|null }
   */
  constructor(o) {
    this.o = o;
    this.scene = o.scene; this.city = o.city; this.game = o.game; this.hud = o.hud; this.audio = o.audio;
    this.depots = o.depots || [];
    this.run = null;
    this.last = null;
    this.stats = Object.assign({ best: 0, bestStreak: 0, cones: 0, earned: 0, shifts: 0, dogBest: 0, dogs: 0 }, read());
    // harness: { month, snow, night, chase: true|false, kid: true|false }
    this.rig = {};
    this._was = false;
    this._app = null;
    this._obj = '';
    this._depotT = 3;
    this.treatGeo = null; this.treatMat = null;   // built on the first shift
    this.floats = null;
    this._v3 = new THREE.Vector3();
    this.voices = 0;   // live jingle voices (the probe checks it goes back to 0)
  }

  busy() { return !!this.run; }

  /** The vehicle's kind of shift, or null: 'ice' in an ice cream truck, 'dog' in the Weenie Wagon. */
  kindOf(player) {
    const v = player.vehicle;
    if (!v || player.onFoot || v.dead) return null;
    return v.spec.icecream ? 'ice' : v.spec.wiener ? 'dog' : null;
  }

  spawnTrucks() {
    const T = this.o.traffic;
    for (const st of this.depots) {
      st.vs = [];
      for (const sp of st.spots) {
        const v = T.spawnAt(sp.x, sp.z, sp.heading, sp.type, 0xf6efd9, 'apron');
        v.vLong = 0;
        st.vs.push(v);
      }
    }
  }

  /** A depot whose truck is gone (wrecked, or taken and despawned) gets another, out of sight. */
  _checkDepots(player) {
    const T = this.o.traffic, p = player.position;
    for (const st of this.depots) {
      st.spots.forEach((sp, i) => {
        const v = st.vs && st.vs[i];
        if (v && !v.dead && T.cars.includes(v)) return;
        if (Math.hypot(p.x - sp.x, p.z - sp.z) < 250) return;
        const n = T.spawnAt(sp.x, sp.z, sp.heading, sp.type, 0xf6efd9, 'apron');
        n.vLong = 0;
        st.vs[i] = n;
      });
    }
  }

  places() {
    return this.depots.filter((s) => s.spots.length).map((s) => {
      const sp = s.spots[0], shop = s.name.split(' · ')[0];
      return { x: sp.x, z: sp.z, kind: 'icecream', label: true, name: `${shop} (ice cream truck)`, near: false,
        hello: `${shop} — the ice cream truck is at the kerb. Climb in, press MISSION and crawl the residential streets with the jingle on` };
    });
  }

  jobRows() {
    const s = this.stats;
    const rows = [{ name: 'Ice cream truck', sub: 'the trucks at Scoop Du Jour (Uptown) and Four All Ice Cream (downtown)',
      best: s.shifts ? `best shift ${formatMoney(s.best)} · streak x${s.bestStreak} · ${s.cones} cones` : null,
      medal: s.best >= 120 ? 'gold' : s.best >= 60 ? 'silver' : s.best ? 'bronze' : null }];
    if (s.dogs) rows.push({ name: 'Weenie Wagon hot dogs', sub: 'at night, by the Uptown and downtown bars', best: `best shift ${formatMoney(s.dogBest)} · ${s.dogs} hot dogs`, medal: null });
    return rows;
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.stats)); } catch (e) { /* private mode */ } }
  say(t, ms = 3000) { this.hud.showToast(t, ms); }
  setObj(t) { if (t === this._obj) return; this._obj = t; this.hud.setObjective(t); }

  // --- the frame -------------------------------------------------------------------------

  update(dt, player) {
    const c = this.o.controls;
    const kind = this.kindOf(player);
    const app = this._app || (this._app = typeof document !== 'undefined' ? document.getElementById('app') : null);
    const want = !!kind;
    if (app && (app.dataset.icecream === '1') !== want) app.dataset.icecream = want ? '1' : '';
    const down = !!(c && want && (c.btn.icmission || c.key('KeyM') || (c._padHeld && c._padHeld.job)));
    if (down && !this._was) {
      if (this.run) this.end('Shift over', false);
      else {
        const why = this.o.blocked ? this.o.blocked() : null;
        if (why) this.say(`Finish the ${why} first`, 2600);
        else this.begin(player, kind);
      }
    }
    this._was = down;
    if ((this._depotT -= dt) <= 0) { this._depotT = 6; this._checkDepots(player); }
    if (this.run) this.tick(dt, player);
  }

  begin(player, kind) {
    if (this.run) return false;
    if (this.game.wanted > 0) { this.say('Lose your wanted level first', 2400); return false; }
    const v = player.vehicle;
    const month = this.rig.month != null ? this.rig.month : calendarDate().getMonth();
    const W = this.o.weather ? this.o.weather() : null, tod = this.o.tod ? this.o.tod() : null;
    const snow = this.rig.snow != null ? !!this.rig.snow : !!(W && (W.cur.snow > 0.25 || W.cover > 0.4));
    const night = this.rig.night != null ? !!this.rig.night : !!(tod && tod.el < -2);
    const sm = seasonMod(kind, month, snow, night, !!this.zoneAt(v.x, v.z));
    if (!this.treatGeo) {
      this.treatGeo = { ice: makeTreat('ice'), dog: makeTreat('dog') };
      this.treatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
    }
    this.run = {
      kind, v, t: 0, left: SHIFT_S, month, snow, night, mod: sm.k,
      sold: 0, earned: 0, lost: 0, streak: 0, bestStreak: 0, sinceNew: 0,
      streets: new Map(), dryTold: new Set(), cust: [], line: [], serving: null,
      spawnT: 1.0, streetT: 0, onStreet: null, onOk: false, voice: null, voiceT: 0, hornT: 0, chased: 0, zone: null,
      spawned: 0, spawnEdges: [], wasStopped: false,
    };
    this._wasObj = this.hud.objective ? this.hud.objective.textContent : '';
    this.say(`${kind === 'dog' ? 'Hot dog' : 'Ice cream'} shift: 5 minutes. ${sm.say}`, 4200);
    if (this.audio && this.audio.ready) this.audio.ui('start');
    this.setBtn(true);
    return true;
  }

  /** The bar district at (x, z), or null. */
  zoneAt(x, z) {
    for (const Z of BAR_ZONES) if ((x - Z.x) ** 2 + (z - Z.z) ** 2 < Z.r * Z.r) return Z;
    return null;
  }

  /** Can customers come from edge e (and is the truck working one)? */
  edgeOk(R, e, x, z) {
    if (!e || e.elev || e.tunnel || e.noTraffic || e.cls === 'hwy' || e.cls === 'ramp') return false;
    if (e.cls === 'res') return true;
    return R.kind === 'dog' && !!this.zoneAt(x, z);
  }

  /** The serving hatch, kerb side (right of the nose), and the queue's slots back along the body. */
  hatch(v, i = 0) {
    const f = v.forward, rx = -f.z, rz = f.x;
    const hz = v.spec.wiener ? 0.6 : -1.0;
    const out = v.halfWid + 0.85 + Math.max(0, i - 3) * 0.8;
    const back = Math.min(i, 3) * 0.95;
    return { x: v.x + f.x * (hz - back) + rx * out, z: v.z + f.z * (hz - back) + rz * out };
  }

  tick(dt, player) {
    const R = this.run, v = R.v;
    if (this.game.dead) { this.end('Shift over', true); return; }
    if (this.kindOf(player) !== R.kind || player.vehicle !== v) { this.end('You left the truck — shift over', true); return; }
    R.t += dt; R.left -= dt; R.sinceNew += dt;
    if (R.left <= 0) { this.end('Time\'s up', false); return; }
    const speed = Math.abs(v.vLong);
    const stopped = speed < STOP_V;
    // the street the truck is working, four times a second
    if ((R.streetT -= dt) <= 0) {
      R.streetT = 0.25;
      const list = this.city.roadsNear(v.x, v.z, 4, false);
      let best = null, bd = 1e9;
      for (const ei of list) {
        const e = this.city.edges[ei], a = this.city.nodes[e.a];
        const t = clamp((v.x - a.x) * e.dx + (v.z - a.z) * e.dz, 0, e.len);
        const d = Math.hypot(a.x + e.dx * t - v.x, a.z + e.dz * t - v.z) - e.hw;
        if (d < bd) { bd = d; best = e; }
      }
      R.onStreet = best;
      R.onOk = !!best && this.edgeOk(R, best, v.x, v.z);
      R.zone = this.zoneAt(v.x, v.z);
      if (R.kind === 'dog') R.mod = seasonMod('dog', R.month, R.snow, R.night, !!R.zone).k;
    }
    if (R.streak && R.sinceNew > STREAK_T) { R.streak = 0; this.say('The streak cooled off — find a new street', 2400); }
    this.sound(dt, R, v, speed, stopped);
    // customers come out: slow, on a residential street, the jingle on (it is, all shift)
    if (speed < SLOW && R.onOk && R.cust.length < CAP) {
      R.spawnT -= dt * R.mod;
      if (R.spawnT <= 0) { R.spawnT = 1.6 + Math.random() * 1.6; this.spawnOne(R, v); }
    }
    this.customers(dt, R, v, speed, stopped);
    R.wasStopped = stopped;
    this.readout(R, v);
  }

  /** The jingle (a looped voice on the world bus) or the Wagon's horn tune. */
  sound(dt, R, v, speed, stopped) {
    const A = this.audio;
    if (!A || !A.ready || !A.ctx || !A.live) return;
    if (A.enabled === false) { if (R.voice) this.stopVoice(R); return; }   // (sound off in the menu)
    const L = A.L;
    const d = L ? Math.hypot(v.x - L.x, v.z - L.z) : 0;
    // the tape: wobbly and slow at a crawl, up to pitch at speed
    let rate;
    if (speed < 0.6) rate = 0.93 + 0.02 * Math.sin(R.t * 3.1);
    else if (speed < 3) rate = 0.78 + 0.035 * Math.sin(R.t * 6.3) + 0.015 * Math.sin(R.t * 17);
    else if (speed < 8) rate = 0.84 + (speed - 3) * 0.032;
    else rate = Math.min(1.1, 1.0 + (speed - 8) * 0.008);
    R.rate = rate;
    if (R.kind === 'dog') {
      if ((R.hornT -= dt) <= 0 && !(stopped && R.line.length)) {
        R.hornT = 7 + Math.random() * 3;
        A.play('wiener_horn', { gain: 0.8, x: v.x, y: v.y + 1.2, z: v.z, ref: 18, maxD: 300, jitter: false, rate });
      }
      return;
    }
    if (!R.voice) {
      if ((R.voiceT -= dt) > 0) return;
      R.voiceT = 1;
      const buf = A.bank && A.bank.ic_jingle && A.bank.ic_jingle[0];
      if (!buf) return;
      const c = A.ctx, src = c.createBufferSource();
      src.buffer = buf; src.loop = true;
      const g = c.createGain(); g.gain.value = 0;
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      src.connect(g);
      if (pan) g.connect(pan).connect(A.worldBus || A.sfxBus); else g.connect(A.worldBus || A.sfxBus);
      src.start();
      R.voice = { src, g, pan, gain: -1, rate: -1, pv: -9 };
      this.voices++;
    }
    const V = R.voice, t = A.ctx.currentTime;
    const serving = stopped && R.line.length > 0;
    const gain = 0.62 * Math.min(1, 10 / Math.max(10, d)) * (serving ? 0.38 : 1);
    if (Math.abs(gain - V.gain) > 0.01) { V.gain = gain; V.g.gain.setTargetAtTime(gain, t, 0.25); }
    if (Math.abs(rate - V.rate) > 0.004) { V.rate = rate; V.src.playbackRate.setTargetAtTime(rate, t, 0.12); }
    if (V.pan && L && d > 2) {
      const pv = clamp(((v.x - L.x) * -L.fz + (v.z - L.z) * L.fx) / d * 0.85, -0.85, 0.85);
      if (Math.abs(pv - V.pv) > 0.03) { V.pv = pv; V.pan.pan.setTargetAtTime(pv, t, 0.1); }
    }
  }

  stopVoice(R) {
    const V = R && R.voice;
    if (!V) return;
    R.voice = null;
    this.voices--;
    try {
      const t = this.audio.ctx.currentTime;
      V.g.gain.cancelScheduledValues(t); V.g.gain.setTargetAtTime(0, t, 0.08);
      V.src.stop(t + 0.5);
    } catch (e) { /* gone */ }
    setTimeout(() => { try { V.g.disconnect(); if (V.pan) V.pan.disconnect(); } catch (e) { /* gone */ } }, 800);
  }

  /** One customer out of a house or off the kerb of a nearby residential street. */
  spawnOne(R, v) {
    const city = this.city, peds = this.o.peds;
    if (!peds) return null;
    const list = city.roadsNear(v.x, v.z, NEAR, false);
    const cands = [];
    for (const ei of list) {
      const e = city.edges[ei];
      if (e.len < 10) continue;
      const a = city.nodes[e.a];
      if (!this.edgeOk(R, e, a.x + e.dx * e.len / 2, a.z + e.dz * e.len / 2)) continue;
      const key = e.name || `#${ei}`;
      const n = R.streets.get(key) || 0;
      if (n >= DRY) {
        if (!R.dryTold.has(key) && R.onStreet && (R.onStreet.name || '') === e.name) { R.dryTold.add(key); this.say(`${e.name || 'This street'} is all ice-creamed out — try another street`, 2800); }
        continue;
      }
      // a street with sales behind it sends fewer
      if (Math.random() > 1 - n / DRY * 0.6) continue;
      cands.push(ei);
    }
    for (let k = 0; k < 12 && cands.length; k++) {
      const ei = cands[Math.floor(Math.random() * cands.length)], e = city.edges[ei], a = city.nodes[e.a];
      const t0 = clamp((v.x - a.x) * e.dx + (v.z - a.z) * e.dz, 0, e.len);
      const t = clamp(t0 + (Math.random() * 2 - 1) * 32, 1.5, e.len - 1.5);
      const side = Math.random() < 0.5 ? 1 : -1;
      // the pavement, or a few metres up a front walk
      const off = e.hw + 2.0 + (Math.random() < 0.55 ? Math.random() * 6 : 0);
      const x = a.x + e.dx * t - e.dz * off * side, z = a.z + e.dz * t + e.dx * off * side;
      const d = Math.hypot(x - v.x, z - v.z);
      if (d < 10 || d > NEAR) continue;
      if (!G.isBuildable(x, z)) continue;
      const y = city.groundAt(x, z, (a.y || 0) + 2, city.roadLift(x, z));
      if (Math.abs(y - v.y) > 4) continue;
      if (city.insideBuilding(x, z, y, 0.6) || city.obstacleHit(x, z, 0.5, y)) continue;
      if (city.onRoad(x, z, 0, false, false)) continue;
      const p = peds.spawnTrail(x, z, y + 1, Math.atan2(v.x - x, v.z - z), v.x, v.z);
      if (!p) return null;
      const kid = this.rig.kid != null ? !!this.rig.kid : R.kind === 'ice' && Math.random() < 0.62;
      if (kid) {
        const sc = 0.58 + 0.14 * Math.random();
        p.h.group.scale.setScalar(sc); p.h.scale = sc; p.h.height = 1.75 * sc;
        p.kid = true;
      }
      p.trail.speed = kid ? 2.7 : 1.5;
      p.icecream = true;
      const C = { p, st: 'come', key: e.name || `#${ei}`, name: e.name || 'an unnamed street', cls: e.cls, kid, t: 0, hx: x, hz: z, tip: 0, treat: null };
      R.cust.push(C);
      R.spawned++;
      R.spawnEdges.push(e.cls);
      if (R.spawnEdges.length > 64) R.spawnEdges.shift();
      return C;
    }
    return null;
  }

  /**
   * Steer a customer to (x, z) beside the truck. Standing, the truck is solid (peds.js _place) and
   * the crowd's own way round a car stalls at a corner when the target is across it, so anyone not
   * already on the kerb side goes round the TAIL: back along his own side, then across behind it.
   */
  goTo(C, v, x, z, pace, speed) {
    const p = C.p, f = v.forward, rx = -f.z, rz = f.x;
    const dx = p.x - v.x, dz = p.z - v.z;
    const pa = dx * f.x + dz * f.z, pl = dx * rx + dz * rz;
    const hl = v.halfLen, hw = v.halfWid;
    let tx = x, tz = z;
    if (speed < 2 && pl < hw + 0.3 && Math.hypot(dx, dz) < hl + 9) {
      const ta = -hl - 1.4, tl = pa > -hl - 0.8 && pl < 0 ? -hw - 0.9 : hw + 1.1;
      tx = v.x + f.x * ta + rx * tl; tz = v.z + f.z * ta + rz * tl;
    }
    p.trail.x = tx; p.trail.z = tz; p.trail.speed = pace;
  }

  customers(dt, R, v, speed, stopped) {
    // one kid chases a truck at a time (a slow pull-away loses the queue over several frames)
    let droveOff = 0, kidLost = null, chasing = R.cust.some((c) => c.st === 'chase');
    // the line, nearest the hatch first (twice a second, so two at the same distance don't swap
    // places every frame); whoever is being served stays at the front
    if ((R.sortT = (R.sortT || 0) - dt) <= 0 && R.line.length > 1) {
      R.sortT = 0.5;
      const A = this.hatch(v, 0), d = (c) => (c === R.serving ? -1 : Math.hypot(c.p.x - A.x, c.p.z - A.z));
      R.line.sort((a, b) => d(a) - d(b));
    }
    for (let i = R.cust.length - 1; i >= 0; i--) {
      const C = R.cust[i], p = C.p;
      C.t += dt;
      if (!p.h.group.parent || p.state === 'down') { this.drop(R, C, false); continue; }
      if (p.state === 'flee') { this.drop(R, C, true); continue; }   // scared off (a shot, a crash)
      const dT = Math.hypot(p.x - v.x, p.z - v.z);
      if (C.st === 'come') {
        const H = this.hatch(v, R.line.length);
        this.goTo(C, v, H.x, H.z, C.kid ? 2.7 : 1.5, speed);
        const dH = Math.hypot(p.x - H.x, p.z - H.z);
        if (dH < BUY_R && stopped) { C.st = 'queue'; R.line.push(C); }
        else if (dT > NEAR + 10 || C.t > 40) { R.lost++; this.drop(R, C, true); }
      } else if (C.st === 'queue' || C.st === 'buy') {
        if (speed > 3 && dT > 9) { droveOff++; R.lost++; if (C.kid && !kidLost && !chasing) kidLost = C; else this.drop(R, C, true); continue; }
        const qi = R.line.indexOf(C), H = this.hatch(v, qi);
        const dH = Math.hypot(p.x - H.x, p.z - H.z);
        if (dH < 0.4) {
          // in his place: face the truck
          const f = v.forward;
          p.trail.x = H.x + f.z * 2; p.trail.z = H.z - f.x * 2;
          p.trail.speed = 0;
        } else this.goTo(C, v, H.x, H.z, 1.3, speed);
        if (C.st === 'queue' && qi === 0 && stopped && !R.serving && dH < 1.8) { C.st = 'buy'; C.t = 0; R.serving = C; }
        if (C.st === 'buy') {
          if (!stopped) { C.st = 'queue'; R.serving = null; }
          else if (C.t >= SERVE_T) this.sell(R, C, v);
        }
      } else if (C.st === 'leave') {
        p.trail.x = C.hx; p.trail.z = C.hz; p.trail.speed = C.kid ? 1.9 : 1.25;
        if (C.t > 7 || dT > 24 || Math.hypot(p.x - C.hx, p.z - C.hz) < 0.8) this.drop(R, C, true);
      } else if (C.st === 'chase') {
        // the kid running down the street after the truck
        const H = this.hatch(v, 0);
        this.goTo(C, v, H.x, H.z, 4.4, speed);
        if (stopped && Math.hypot(p.x - H.x, p.z - H.z) < BUY_R) {
          C.st = 'queue'; C.tip = 2; R.line.push(C); p.trail.speed = 1.3;
          this.say('The kid caught up! He\'s all out of breath — serve him', 2600);
        } else if (C.t > 10 || dT > 75) {
          this.drop(R, C, true);
          this.say('The kid gave up and walked home. Cold.', 2400);
        }
      }
    }
    if (droveOff) {
      const had = R.streak;
      R.streak = 0;
      this.say(`You drove off with ${droveOff} in the queue — they're gone${had > 1 ? ', and the streak with them' : ''}`, 3000);
      if (this.audio && this.audio.ready) this.audio.ui('fail');
      if (kidLost) {
        const chase = this.rig.chase != null ? !!this.rig.chase : Math.random() < 0.4;
        if (chase) {
          const li = R.line.indexOf(kidLost);
          if (li >= 0) R.line.splice(li, 1);
          if (R.serving === kidLost) R.serving = null;
          kidLost.st = 'chase'; kidLost.t = 0; R.chased++;
          setTimeout(() => { if (this.run === R && kidLost.st === 'chase') this.say('A kid is chasing the truck down the street! Stop!', 2600); }, 3100);
        } else this.drop(R, kidLost, true);
      }
    }
  }

  sell(R, C, v) {
    const p = C.p;
    const base = R.kind === 'dog' ? 4 + Math.floor(Math.random() * 4) : C.kid ? 3 + Math.floor(Math.random() * 2) : 4 + Math.floor(Math.random() * 3);
    const n = R.streets.get(C.key) || 0;
    let bonus = 0, fresh = false;
    if (n === 0) {
      fresh = true;
      R.streak++; R.sinceNew = 0;
      R.bestStreak = Math.max(R.bestStreak, R.streak);
      bonus = STREET_BONUS * (R.streak - 1);
    }
    R.streets.set(C.key, n + 1);
    const pay = base + bonus + C.tip;
    this.game.money += pay;
    R.sold++; R.earned += pay;
    R.serving = null;
    const li = R.line.indexOf(C);
    if (li >= 0) R.line.splice(li, 1);
    C.st = 'leave'; C.t = 0;
    // the treat in his right hand
    const m = new THREE.Mesh(this.treatGeo[R.kind], this.treatMat);
    // (the bind pose's hand frame is the world's, arm hanging: the cone upright, held in front of the fist)
    m.position.set(0, -0.07, 0.05);
    m.frustumCulled = false;
    m.userData.icecream = 1;
    p.h.bones[BONES.handR].add(m);
    C.treat = m;
    if (this.audio && this.audio.ready) this.audio.play('cash', { gain: 0.42, send: 0.03, jitter: false });
    const H = this.hatch(v, 0);
    this.float(`+$${pay}`, H.x, v.y + 2.4, H.z);
    const what = R.kind === 'dog' ? 'Hot dog' : C.kid ? 'Cone' : 'Sundae';
    let line = `${what}! +$${pay}${C.tip ? ' (tip)' : ''} · ${R.sold} sold`;
    if (fresh && R.streak > 1) line += ` · new street, streak x${R.streak}${bonus ? ` +$${bonus}` : ''}`;
    if (n + 1 === DRY) line += ` · ${C.name} is all ice-creamed out`;
    this.say(line, 2000);
    this.last = { pay, base, bonus, streak: R.streak, key: C.key };
  }

  /** Let a customer go: hand him back to the crowd (or take him out of it), treat and all. */
  drop(R, C, handBack) {
    const i = R.cust.indexOf(C);
    if (i >= 0) R.cust.splice(i, 1);
    const li = R.line.indexOf(C);
    if (li >= 0) R.line.splice(li, 1);
    if (R.serving === C) R.serving = null;
    const p = C.p;
    if (C.treat) { if (C.treat.parent) C.treat.parent.remove(C.treat); C.treat = null; }
    p.icecream = false;
    const peds = this.o.peds;
    if (!peds || !peds.peds.includes(p)) return;
    if (handBack && p.state !== 'down') { p.trail = null; if (p.state !== 'flee') p.state = 'walk'; peds.reanchor(p); }
    else if (!handBack) p.trail = null;
  }

  float(text, x, y, z) {
    const cam = this.o.camera;
    if (!cam || typeof document === 'undefined') return;
    if (!this.floats) {
      const host = document.getElementById('hud') || document.body;
      this.floats = [];
      for (let i = 0; i < 4; i++) {
        const el = document.createElement('div');
        el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:7;font:800 22px/1 system-ui,sans-serif;color:#7dff8a;'
          + 'text-shadow:0 2px 0 #0b3d12,0 0 8px rgba(0,0,0,0.6);opacity:0;will-change:transform,opacity;white-space:nowrap';
        host.appendChild(el);
        this.floats.push(el);
      }
      this._fi = 0;
    }
    const q = this._v3.set(x, y, z).project(cam);
    if (q.z > 1 || Math.abs(q.x) > 1.1 || Math.abs(q.y) > 1.1) return;
    const W = window.innerWidth, Hh = window.innerHeight;
    const sx = (q.x + 1) / 2 * W, sy = (1 - q.y) / 2 * Hh;
    const el = this.floats[this._fi++ % this.floats.length];
    el.textContent = text;
    el.style.transition = 'none';
    el.style.opacity = '1';
    el.style.transform = `translate(${sx | 0}px,${sy | 0}px) translate(-50%,-50%)`;
    void el.offsetWidth;
    el.style.transition = 'transform 1.2s ease-out, opacity 1.2s ease-in';
    el.style.transform = `translate(${sx | 0}px,${(sy - 70) | 0}px) translate(-50%,-50%)`;
    el.style.opacity = '0';
  }

  readout(R, v) {
    const want = R.kind === 'dog' ? 'hot dogs' : 'ice cream';
    const where = R.onOk ? (R.onStreet && R.onStreet.name ? R.onStreet.name : 'here')
      : R.kind === 'dog' ? 'find the bars (Uptown, downtown) or a residential street' : 'find a residential street';
    const bar = '[' + '#'.repeat(Math.min(R.streak, 8)) + '.'.repeat(Math.max(0, 6 - Math.min(R.streak, 6))) + ']';
    const q = R.line.length ? ` · queue ${R.line.length}` : '';
    this.setObj(`${R.kind === 'dog' ? 'Hot dogs' : 'Ice cream'}: ${R.sold} sold, ${formatMoney(R.earned)} · ${clock(R.left)}`);
    if (this.o.panel) this.o.panel.show(`${R.kind === 'dog' ? 'WEENIE WAGON' : 'ICE CREAM'} · ${clock(R.left)} · ${formatMoney(R.earned)}`,
      `${R.onOk ? '♪ ' : ''}${where}${q}`, `STREAK x${R.streak} ${bar} · ${R.sold} ${want === 'ice cream' ? 'cones' : 'hot dogs'}`, R.kind === 'dog' ? '#e8a020' : '#f06aa0');
  }

  setBtn(on) {
    if (typeof document === 'undefined') return;
    const b = document.querySelector('[data-btn="icmission"]');
    if (b) b.classList.toggle('on', on);
  }

  /** A pedestrian was hit (main.js game.onPedHit): by the player, the shift is over. */
  onPedHit(byPlayer, ped, veh) {
    if (this.run && byPlayer) this._lastHit = { cust: !!(ped && this.run.cust.some((C) => C.p === ped)), st: (ped && this.run.cust.find((C) => C.p === ped) || {}).st || null, v: veh ? +Math.abs(veh.vLong || 0).toFixed(2) : null, crowd: !!(ped && ped.icecream) };
    // pulling away from the hatch brushes the queue (they stand within the
    // knock-down's 0.8 m of the body): one of THIS shift's own customers
    // touched at a walking pace knocks them over, but it is not "hitting a
    // pedestrian" -- driving off already costs the queue
    // (and one who walks into the truck's side or back -- the queue drifting
    // after a truck pulling away -- is theirs: only one in front of the nose
    // with the truck over 4 m/s is run down)
    if (this.run && byPlayer && ped && veh && this.run.cust.some((C) => C.p === ped)) {
      const f = veh.forward, ahead = (ped.x - veh.x) * f.x + (ped.z - veh.z) * f.z;
      const front = ahead * Math.sign(veh.vLong || 1) > (veh.halfLen || 2.5) - 0.6;
      if (!(front && Math.abs(veh.vLong || 0) >= 4)) return;
    }
    if (this.run && byPlayer) this.end('You hit a pedestrian! The shift is over', true);
  }

  end(msg, fail) {
    const R = this.run;
    if (!R) return;
    this.run = null;
    this.stopVoice(R);
    // everyone still about goes back to the crowd (treats taken off first)
    for (const C of [...R.cust]) this.drop(R, C, true);
    R.cust.length = 0; R.line.length = 0;
    const s = this.stats, dog = R.kind === 'dog';
    let rec = false;
    if (R.sold) {
      if (dog) { s.dogs += R.sold; if (R.earned > s.dogBest) { s.dogBest = R.earned; rec = true; } }
      else { s.cones += R.sold; if (R.earned > s.best) { s.best = R.earned; rec = true; } s.bestStreak = Math.max(s.bestStreak, R.bestStreak); }
      s.earned += R.earned;
    }
    s.shifts++;
    this.save();
    this.last = Object.assign(this.last || {}, { sold: R.sold, earned: R.earned, streets: R.streets.size, bestStreak: R.bestStreak, lost: R.lost, record: rec, msg });
    if (this.o.panel) this.o.panel.hide();
    this.setBtn(false);
    if (this.hud.objective && this.hud.objective.textContent === this._obj) this.hud.setObjective(this._wasObj || '');
    this._obj = '';
    const what = dog ? 'hot dogs' : 'cones';
    this.say(R.sold ? `${msg} — ${R.sold} ${what} on ${R.streets.size} street${R.streets.size === 1 ? '' : 's'}, ${formatMoney(R.earned)}${R.bestStreak > 1 ? `, best streak x${R.bestStreak}` : ''}${rec ? ' · NEW BEST' : ''}`
      : `${msg} — nothing sold`, 5200);
    if (this.audio && this.audio.ready) { if (fail) this.audio.ui('fail'); else if (R.sold) this.audio.cash(); }
  }
}
