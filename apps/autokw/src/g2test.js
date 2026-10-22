// THE G2 (AND G) ROAD TEST at DriveTest Kitchener, 1405 Ottawa St N.
//
// Ontario's graduated licence: the G2 road test is the city one, the G test
// adds the freeway. Here both start at the real centre -- OSM's DriveTest node
// in the Ottawa Lackner Centre (Ottawa St N and Lackner Blvd; data/g2.json,
// tools/kw/build_g2.py) -- where a pillar stands in the lot. ENTER there on
// foot (an examiner's car is brought round: you do not bring your own) or
// in a stopped car of your own, pick G2 or G, and the examiner gets in.
//
// THE ROUTE is the real road graph's: a loop of waypoints round the centre
// (a signalled junction, a quiet street to pull over on, a residential
// street to turn round on, a stop sign; the G test swaps the turn-round for
// the Conestoga Parkway) joined by shortest paths (Dijkstra, one-way streets
// obeyed, freeways only on the G's freeway legs), planned from wherever the
// car is: a wrong turn is re-planned, as an examiner does, never marked.
// Directions come as the examiner says them -- "At the lights, turn left",
// "Take the second right", "Take the next exit" -- in a toast when the turn
// is the next of its kind (or the second), and on the clipboard panel.
//
// THE MARKS, as MTO's examiners mark them (the weights are this file's own;
// MTO does not publish its sheet), read from what the game already knows:
// the junction controls (junctions.js: stop lines, the signal's phase for
// each move), the posted limits (g2.json: OSM's maxspeed on every edge within
// 6.5 km, class defaults elsewhere), the lanes (traffic.js laneLatU /
// laneInfo), the turn-signal stalk (player.js `sig`), the kerbs
// (city.roadLift), the cars ahead (traffic.cars) and the school buses
// (traffic.onSchoolBusPass).
//   - rolling a stop sign (not under ~1 km/h with the nose in the last 10 m
//     before the line; never under 15 km/h is running it: a fail);
//   - a red light (a fail; right on red is legal after a full stop, an
//     advance arrow is a green for the left) or an amber you could have
//     stopped for (comfortably: a 0.8 s reaction and 3 m/s^2);
//   - speeding over the limit + 5 (city) / + 10 (freeway) for 2.5 s; 30 / 40
//     over is a fail;
//   - a turn, a lane change, pulling over, pulling out, merging or exiting
//     without the signal on for that way in the seconds before;
//   - a wide turn (finished in the oncoming half, or a right turn not in
//     the kerb lane), the kerb hit, following under 1.2 s behind;
//   - over the centre line (1.5 s; 5 s is driving on the wrong side: a
//     fail), the wrong way down a one-way street (12 m: a fail), passing a
//     school bus whose reds flash, any collision, a pedestrian: fails.
// PASS_MAX marks or fewer and no fail is a pass. The score sheet lists every
// mark with the street it was on; bests in localStorage `autokw-g2`.
//
// Harness: `__dbg.g2` (`begin(kind, opts)`, `run`, `tick`, `stats`); the
// probe is tools/kw/g2probe.js (a kinematic driver: one clean pass, each mark
// once).

import * as THREE from './three.js';
import { K_SIG, K_STOP, K_RB, K_MINI } from './junctions.js';
import { formatMoney } from './util.js';

const KEY = 'autokw-g2';
// OSM's DriveTest node (raw_pois.json, amenity=driving_school, 1405 Ottawa
// Street North): the unit's storefront in the plaza's strip. The door is in
// front of it, the pillar on the lot's aisle in front of that.
export const CENTRE = { x: 3614.0, z: -417.7, name: 'DriveTest Kitchener', addr: '1405 Ottawa St N, Unit 11' };
export const DOOR = { x: 3603, z: -431 };
export const LOT = { x: 3592, z: -446 };
const FOOT_R = 7, CAR_R = 34, STOP_V = 1.2;
const TICK = 1 / 15;
const PASS_MAX = 15;
const FAIL_STOP_V = 15 / 3.6, ROLL_V = 1 / 3.6;
const AMB_REACT = 0.8, AMB_DEC = 3.0;
const SIG_WIN = 6;           // s: the signal must have been on that way within this before the move
const SIG_MIN = 0.4;         // s: ...and on for at least this (a flick is not a signal)
const CLOSE_T = 1.2;         // s behind the car ahead
const CLASS_LIMIT = { res: 40, st: 50, art: 60, hwy: 100 };
const PAY = { G2: [750, 250], G: [1500, 400] };

const MARK = {
  roll: [5, 'Rolling stop at the stop sign'],
  amber: [5, 'Entered on a late amber'],
  rightRed: [5, 'Right on red without stopping first'],
  speed: [3, 'Speeding'],
  signal: [3, 'No signal for the turn'],
  lane: [3, 'Changed lanes without signalling'],
  merge: [3, 'No signal merging onto the highway'],
  exit: [3, 'No signal for the exit'],
  wide: [3, 'Wide turn — finished in the wrong lane'],
  kerb: [2, 'Hit the kerb'],
  close: [3, 'Following too closely'],
  centre: [4, 'Over the centre line'],
  pullSig: [2, 'No signal pulling over'],
  pullOut: [2, 'No signal pulling back into traffic'],
  pullFar: [2, 'Stopped too far from the kerb'],
  pullNo: [3, "Didn't pull over when asked"],
  turnMoves: [2, 'Too many moves turning around'],
  turnNo: [3, "Didn't turn the car around"],
  lcNo: [3, "Didn't change lanes when asked"],
};
const FAIL = {
  red: ['Ran a red light', 'You went through a red light. We\'ll end the test here — I\'ll drive us back.'],
  stop: ['Did not stop at the stop sign', 'That stop sign wasn\'t a suggestion.'],
  bus: ['Passed a stopped school bus', 'Those flashing reds on the school bus mean everyone stops. Both ways.'],
  crash: ['Collision', 'Well. I think we\'ll call it there.'],
  ped: ['Struck a pedestrian', '…We\'re done. Please put it in park.'],
  wrongway: ['Wrong way on a one-way street', 'That was a one-way street. One way, and not this one.'],
  wrongside: ['Drove on the wrong side of the road', 'In Ontario we drive on the right.'],
  excess: ['Excessive speed', 'That\'s not a speed I\'d like to see on the road or on my clipboard.'],
  left: ['Left the vehicle', 'Getting out of the car does end the test, yes.'],
  police: ['Police involvement', 'I don\'t do police chases. Test over.'],
  car: ['Vehicle out of service', 'We can\'t finish the test in this car.'],
  marks: ['Too many marks', 'Too many marks to pass today. Practise those habits and book again.'],
};
const PASS_SAY = [
  [0, 'A clean sheet. Congratulations — that almost never happens.'],
  [6, 'Congratulations, you passed. A couple of things to work on.'],
  [PASS_MAX, 'You passed. Just. Work on those habits before they work on you.'],
];

const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
const kmh = (v) => Math.round(v * 3.6);

export class RoadTest {
  constructor({ scene, city, game, traffic, hud, audio, root }) {
    this.scene = scene; this.city = city; this.game = game; this.traffic = traffic; this.hud = hud; this.audio = audio;
    this.root = root;
    this.run = null;
    this.active = false;       // a DOM sheet (the chooser, the score sheet) is up: the world is held
    this.stats = Object.assign({ tries: 0, passes: 0, G2: null, G: null }, read());
    this.lim = null;           // edge -> km/h, from g2.json (fetched on first use)
    this._limP = null;
    this.mark = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 24, 16, 1, true), new THREE.MeshBasicMaterial({
      color: 0x2fb35a, transparent: true, opacity: 0.3, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false,
    }));
    this.mark.visible = false;
    this.mark.frustumCulled = false;
    scene.add(this.mark);
    this.panel = null;
    this.sheet = null;
    this.hinted = false;
  }

  warmMeshes() { const m = new THREE.Mesh(this.mark.geometry, this.mark.material); m.frustumCulled = false; return [m]; }

  places() {
    return [{ x: DOOR.x, z: DOOR.z, kind: 'g2', name: 'DriveTest Kitchener — G2 and G road tests', near: false,
      hello: 'DriveTest Kitchener, 1405 Ottawa St N — ENTER at the green pillar to take your G2 or G road test' }];
  }

  jobRows() {
    const row = (k, name, sub) => {
      const b = this.stats[k];
      return { name, sub, best: b ? (b.pass ? `PASSED · ${b.marks} mark${b.marks === 1 ? '' : 's'}` : 'not passed yet') : null,
        medal: b && b.pass ? (b.marks === 0 ? 'gold' : b.marks <= 6 ? 'silver' : 'bronze') : null };
    };
    return [row('G2', 'G2 road test', 'DriveTest Kitchener · the city'), row('G', 'G road test', 'DriveTest Kitchener · adds the Conestoga Pkwy')];
  }

  /** The licence the passport shows ('Full G licence', 'G2 licence'), or null. */
  licence() {
    if (this.stats.G && this.stats.G.pass) return 'Full G licence';
    if (this.stats.G2 && this.stats.G2.pass) return 'G2 licence';
    return null;
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.stats)); } catch (e) { /* private mode */ } }

  // --- the posted limits --------------------------------------------------------

  loadLimits() {
    if (this._limP) return this._limP;
    this._limP = fetch(new URL('../data/g2.json', import.meta.url)).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d || !d.e) return;
      const E = this.city.edges;
      let check = 0;
      for (const e of E) check += e.a + e.b;
      if (check % 4294967296 !== d.check) { console.warn('g2.json: roads.bin has changed since; class limits'); return; }
      const m = new Map();
      let ei = 0;
      for (let i = 0; i < d.e.length; i++) { ei += d.e[i]; m.set(ei, d.k[i]); }
      this.lim = m;
    }).catch(() => {});
    return this._limP;
  }

  limitOf(ei) {
    const e = this.city.edges[ei];
    const l = this.lim && this.lim.get(ei);
    if (l) return l;
    if (e.cls === 'ramp') return null;
    if (e.cls === 'hwy' && e.spd > 17) return Math.round(e.spd * 3.6 - 10);   // highways.js: maxspeed + 10
    return CLASS_LIMIT[e.cls] || 50;
  }

  // --- starting ---------------------------------------------------------------------

  /** ENTER on foot by the door? */
  near(pl) {
    if (this.run || this.active) return false;
    return Math.hypot(pl.x - DOOR.x, pl.z - DOOR.z) < FOOT_R || Math.hypot(pl.x - LOT.x, pl.z - LOT.z) < FOOT_R;
  }

  /** ENTER in a stopped car by the pillar? (main.js tryDriveThru) */
  driveUp(pl) {
    if (this.run || this.active || pl.onFoot || !pl.vehicle) return false;
    const v = pl.vehicle;
    if (Math.hypot(v.x - LOT.x, v.z - LOT.z) > CAR_R || Math.abs(v.vLong) > STOP_V) return false;
    if (!this.carOk(v)) { this.hud.showToast('DriveTest tests you in a car — not that', 2600); return true; }
    this.open(pl);
    return true;
  }

  carOk(v) {
    const s = v && v.spec;
    return !!(s && s.roadCar && !s.bus && !s.tank && !s.rail && s.len < 6.5 && !v.dead);
  }

  /** The chooser: G2 or G, a DOM sheet over the held world. */
  open(pl) {
    this.loadLimits();
    const s = this.stats;
    const best = (k) => { const b = s[k]; return b ? (b.pass ? `passed, ${b.marks} marks` : 'not passed yet') : 'not taken'; };
    this.showSheet(`<div class="g2h">DriveTest — Kitchener</div><div class="g2s">${CENTRE.addr} · Ontario's graduated licence</div>
      <button class="g2b" data-k="G2"><b>1 · G2 road test</b><span>City streets round the centre, about ten minutes · ${best('G2')}</span></button>
      <button class="g2b" data-k="G"><b>2 · G road test</b><span>The city and the Conestoga Parkway · ${best('G')}</span></button>
      <button class="g2b g2x" data-k="">Not today</button>
      <div class="g2f">Signal with , and . (or [ ]), LB / RB on a pad, or the ◀ ▶ buttons</div>`,
    (k) => { if (k) this.begin(k, { player: pl }); });
  }

  showSheet(html, onPick) {
    if (!this.sheet) {
      const el = document.createElement('div');
      el.id = 'g2Sheet';
      el.style.cssText = 'position:absolute;inset:0;z-index:30;display:none;align-items:center;justify-content:center;background:rgba(6,10,14,0.55);'
        + 'font:15px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#13202b';
      const st = document.createElement('style');
      st.textContent = '#g2Sheet .g2c{background:#fbfaf6;border-radius:10px;border-top:8px solid #1f8f4a;max-width:min(92vw,560px);max-height:88vh;overflow:auto;'
        + 'padding:16px 18px 14px;box-shadow:0 8px 30px rgba(0,0,0,.45);box-sizing:border-box}'
        + '#g2Sheet .g2h{font-weight:800;font-size:19px;letter-spacing:.01em}#g2Sheet .g2s{color:#5a6670;font-size:12px;margin:2px 0 10px}'
        + '#g2Sheet .g2b{display:block;width:100%;text-align:left;margin:6px 0;padding:9px 12px;border-radius:7px;border:1px solid #c9d3da;background:#fff;font:inherit;color:inherit;cursor:pointer}'
        + '#g2Sheet .g2b span{display:block;font-size:12px;color:#5a6670}#g2Sheet .g2b.sel{border-color:#1f8f4a;box-shadow:0 0 0 2px #1f8f4a inset}'
        + '#g2Sheet .g2x{text-align:center;color:#5a6670}#g2Sheet .g2f{font-size:11px;color:#7a858d;margin-top:8px;text-align:center}'
        + '#g2Sheet .g2r{font-size:30px;font-weight:900;margin:6px 0 2px}#g2Sheet .g2r.pass{color:#1f8f4a}#g2Sheet .g2r.fail{color:#c62828}'
        + '#g2Sheet table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}#g2Sheet td{padding:3px 4px;border-bottom:1px solid #e3e6e8;vertical-align:top}'
        + '#g2Sheet td.p{text-align:right;font-weight:700;white-space:nowrap}#g2Sheet td.f{color:#c62828;font-weight:800}#g2Sheet .g2q{font-style:italic;margin:8px 0;color:#2d3a44}';
      el.appendChild(st);
      const card = document.createElement('div');
      card.className = 'g2c';
      el.appendChild(card);
      (this.root || document.body).appendChild(el);
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        const b = e.target.closest('.g2b');
        if (b) this.pick(b.dataset.k);
      });
      window.addEventListener('keydown', (e) => {
        if (!this.active) return;
        const bs = [...this.sheet.card.querySelectorAll('.g2b')];
        if (e.code === 'Digit1' && bs[0]) this.pick(bs[0].dataset.k);
        else if (e.code === 'Digit2' && bs[1]) this.pick(bs[1].dataset.k);
        else if (e.code === 'Escape') this.pick('');
        else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
          this.sel = (this.sel + (e.code === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length;
          bs.forEach((b, i) => b.classList.toggle('sel', i === this.sel));
        } else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyF') {
          if (bs[this.sel]) this.pick(bs[this.sel].dataset.k);
        } else return;
        e.preventDefault();
        e.stopPropagation();
      }, true);
      this.sheet = { el, card };
    }
    this.sheet.card.innerHTML = html;
    this.sheet.el.style.display = 'flex';
    this._onPick = onPick;
    this.sel = 0;
    const bs = this.sheet.card.querySelectorAll('.g2b');
    if (bs[0]) bs[0].classList.add('sel');
    this.active = true;
    this.game.hold('g2');
  }

  pick(k) {
    if (!this.active) return;
    this.sheet.el.style.display = 'none';
    this.active = false;
    this.game.release('g2');
    const f = this._onPick;
    this._onPick = null;
    if (f) f(k);
  }

  /**
   * Start a test. opts: { player, seed, noCar (the probe's stand-in drives) }.
   * On foot, the examiner's car is brought round to the lot and you get in.
   */
  begin(kind, opts = {}) {
    this.loadLimits();
    const pl = opts.player;
    if (pl && !opts.noCar) {
      if (pl.onFoot || !this.carOk(pl.vehicle)) {
        const h = Math.atan2(DOOR.x - LOT.x, DOOR.z - LOT.z) + Math.PI;   // the nose away from the store
        const v = this.traffic.spawnAt(LOT.x, LOT.z, h, 'compsedan', 0xe9ecef, 'free');
        v.y = this.city.groundAt(LOT.x, LOT.z, null);
        v.sync();
        if (!pl.onFoot && pl.vehicle) pl.exitVehicle(true);
        pl.enterVehicle(v);
      }
    }
    let seed = opts.seed !== undefined ? opts.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    const R = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const wps = this.pickWaypoints(kind, R);
    this.stats.tries++;
    this.save();
    this.run = {
      kind, t: 0, acc: 0, marks: [], fail: null, wps, wi: 0, seed,
      path: null, pv: 0, idx: 0, offD: 0, cur: null, onRoadT: 0, odo: 0, v: pl && pl.vehicle,
      sigLast: { L: -1e9, R: -1e9 }, said: '', sayCd: 0, rerouteCd: 0, instr: '', instrId: '', instrD: 0,
      lh: [], spT: 0, spMarked: false, spLow: 0, exT: 0, closeT: 0, closeCd: 0, kerbCd: 0, wsT: 0, wsMarked: false, ww: 0,
      app: null, pend: null, wide: null, task: null, mergeT: -1e9, endT: 0, h: null, hSum: 0,
      log: [],
    };
    window.__g2Last = null;
    this.say(kind === 'G' ? 'Good morning. This is your G road test: the city, then the highway. When you\'re ready, pull out of the lot and I\'ll give you directions.'
      : 'Good morning. This is your G2 road test. When you\'re ready, pull out of the lot and I\'ll give you directions.', 5200);
    if (this.audio && this.audio.ready) this.audio.ui('start');
    this.showPanel(true);
    return this.run;
  }

  /**
   * The loop: [{ n (node), task, hwy (the leg there may use freeways) }],
   * ending at the plaza's entrance. Bearings from a random start, a quarter
   * turn apart, ~0.8-1.3 km out.
   */
  pickWaypoints(kind, R) {
    const city = this.city, jc = city.jc, T = this.traffic, N = city.nodes, E = city.edges;
    const near = [];
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      if (n.elev || !n.e.length) continue;
      const d = Math.hypot(n.x - CENTRE.x, n.z - CENTRE.z);
      if (d > 250 && d < 1500) near.push(i);
    }
    const ctlK = (i) => (jc && jc.ctl[i] >= 0 ? jc.list[jc.ctl[i]].k : 0);
    const cityEdges = (i) => N[i].e.every((ei) => { const e = E[ei]; return e.cls !== 'hwy' && e.cls !== 'ramp' && !e.elev && !e.tunnel && T.inComponent(ei); });
    const mid = (i, cls) => {
      const n = N[i];
      if (n.e.length !== 2 || ctlK(i)) return false;
      return n.e.every((ei) => { const e = E[ei]; return cls.includes(e.cls) && T.flow[ei] === 0 && e.len >= 22 && !e.elev && !e.tunnel && T.inComponent(ei); });
    };
    const KIND = {
      sig: (i) => ctlK(i) === K_SIG && cityEdges(i),
      stop: (i) => ctlK(i) === K_STOP && cityEdges(i),
      pull: (i) => mid(i, ['st', 'res']),
      turn: (i) => mid(i, ['res']),
    };
    const used = [];
    const pick = (type, bear, r) => {
      let best = -1, bs = Infinity;
      for (const i of near) {
        if (!KIND[type](i)) continue;
        const n = N[i], dx = n.x - CENTRE.x, dz = n.z - CENTRE.z, d = Math.hypot(dx, dz);
        const b = Math.atan2(dx, -dz);
        if (used.some((u) => Math.hypot(N[u].x - n.x, N[u].z - n.z) < 400)) continue;
        const s = Math.abs(d - r) / r + Math.abs(wrap(b - bear)) * 0.9 + R() * 0.15;
        if (s < bs) { bs = s; best = i; }
      }
      if (best >= 0) used.push(best);
      return best;
    };
    // home: the street node nearest the plaza's entrance
    let home = -1, hd = 160;
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      if (n.elev || !n.e.length) continue;
      const d = Math.hypot(n.x - LOT.x, n.z - LOT.z);
      if (d < hd && n.e.some((ei) => (E[ei].cls === 'art' || E[ei].cls === 'st') && T.inComponent(ei))) { hd = d; home = i; }
    }
    const homeIn = home >= 0 ? N[home].e.find((ei) => T.allowed(ei, E[ei].b === home ? 1 : -1)) : undefined;
    const q = Math.PI / 2;
    const build = () => {
      used.length = 0;
      // (the G test's city part on the way to its freeway)
      const fw = kind === 'G' ? this.freewayLeg(R) : null;
      const b0 = fw ? Math.atan2(N[fw[0]].x - CENTRE.x, -(N[fw[0]].z - CENTRE.z)) + (R() - 0.5) * 0.8 : R() * Math.PI * 2, out = [];
      const add = (n, task, hwy) => { if (n >= 0) out.push({ n, task, hwy: !!hwy }); };
      add(pick('sig', b0, 550), null);
      if (kind !== 'G') add(pick('pull', b0 + q, 650), 'pull');
      if (kind === 'G') {
        if (fw) { add(fw[0], 'lc', true); add(fw[1], null, true); }
      } else {
        add(pick('turn', b0 + 2 * q, 600), 'turn');
        add(pick('stop', b0 + 3 * q, 450), null);
      }
      out.push({ n: home, task: 'home', hwy: kind === 'G' });
      return out;
    };
    // THE LENGTH: the legs planned from the plaza round and back, and the loop
    // that comes nearest the test's length (G2 ~4-6 km: ten minutes or so
    // with the lights; G ~7-11) kept
    const legs = (out) => {
      if (homeIn === undefined) return 0;
      let ei = homeIn, sg = E[homeIn].b === home ? 1 : -1, m = 0;
      for (const w of out) {
        const p = this.plan(ei, sg, w.n, w.hwy || kind === 'G');
        if (!p) return Infinity;
        for (let k = 1; k < p.pe.length; k++) m += E[p.pe[k]].len;
        ei = p.pe[p.pe.length - 1]; sg = p.ps[p.ps.length - 1];
      }
      return m;
    };
    const want = kind === 'G' ? [5500, 8000] : [3000, 4500];
    let best = null, bm = Infinity;
    for (let a = 0; a < 8; a++) {
      const out = build(), m = legs(out);
      if (kind === 'G' && !out.some((w) => w.task === 'lc')) continue;   // (a G test without its freeway is no G test)
      const miss = m < want[0] ? want[0] - m : m > want[1] ? m - want[1] : 0;
      if (miss < bm) { bm = miss; best = out; best.m = m; }
      if (!miss) break;
    }
    return best;
  }

  /**
   * The G test's freeway: from a MERGE (a ramp joining a carriageway 1.2-2.8
   * km out) ~2 km on down it to the next EXIT (a ramp leaving it) -- of the
   * nearest merges, the run that ends nearest the centre (the Conestoga curls
   * round Kitchener: on round it, not away), so the way home off it is
   * short. On at a merge, the route to it is the on-ramp, not a detour to the
   * far carriageway.
   */
  freewayLeg(R) {
    const city = this.city, N = city.nodes, E = city.edges, T = this.traffic;
    const cand = [];
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      if (n.e.length < 3 || n.elev && !n.e.some((ei) => E[ei].cls === 'hwy')) continue;
      const hw = n.e.filter((ei) => E[ei].cls === 'hwy' && T.inComponent(ei));
      if (hw.length !== 2) continue;
      // a ramp arriving here
      if (!n.e.some((ei) => E[ei].cls === 'ramp' && T.allowed(ei, E[ei].b === i ? 1 : -1))) continue;
      const d = Math.hypot(n.x - CENTRE.x, n.z - CENTRE.z);
      if (d > 1000 && d < 3600) cand.push([d + R() * 400, i]);
    }
    cand.sort((p, q) => p[0] - q[0]);
    let best = null, bs = Infinity;
    for (const [d0, a] of cand.slice(0, 30)) {
      let ni = a, ei = N[a].e.find((k) => E[k].cls === 'hwy' && T.allowed(k, E[k].a === a ? 1 : -1)), run = 0, end = -1;
      if (ei === undefined) continue;
      for (let g = 0; g < 400 && run < 4500; g++) {
        const e = E[ei], sg = e.a === ni ? 1 : -1, o = sg > 0 ? e.b : e.a;
        run += e.len;
        ni = o;
        // an exit: a ramp leaving here, 1.8 km on or more
        if (run > 1300 && N[o].e.some((k) => E[k].cls === 'ramp' && T.allowed(k, E[k].a === o ? 1 : -1))) { end = o; break; }
        const ux = e.dx * sg, uz = e.dz * sg;
        let nx = -1, nd = -2;
        for (const k of N[o].e) {
          if (k === ei) continue;
          const f = E[k], s2 = f.a === o ? 1 : -1;
          if (f.cls !== 'hwy' || !T.allowed(k, s2)) continue;
          const dd = f.dx * s2 * ux + f.dz * s2 * uz;
          if (dd > nd) { nd = dd; nx = k; }
        }
        if (nx < 0) break;
        ei = nx;
      }
      if (end < 0) continue;
      const sc = Math.hypot(N[end].x - CENTRE.x, N[end].z - CENTRE.z) + 0.5 * d0;
      if (sc < bs) { bs = sc; best = [a, end]; }
    }
    return best;
  }

  // --- the route ----------------------------------------------------------------------

  /** Dijkstra from the end of (ei, sign) to node `goal`: { pe, ps, pn } starting with ei. */
  plan(ei0, sg0, goal, hwy) {
    const city = this.city, N = city.nodes, E = city.edges, T = this.traffic;
    const e0 = E[ei0], start = sg0 > 0 ? e0.b : e0.a;
    if (!this._g || this._g.length < N.length) {
      this._g = new Float64Array(N.length); this._seen = new Uint32Array(N.length); this._done = new Uint32Array(N.length);
      this._came = new Int32Array(N.length); this._gen = 0;
    }
    const g = this._g, seen = this._seen, done = this._done, came = this._came, gen = ++this._gen;
    const hn = [], hf = [];
    const push = (n, f) => {
      let i = hn.length; hn.push(n); hf.push(f);
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hn[i] = hn[p]; hf[i] = hf[p]; i = p; }
      hn[i] = n; hf[i] = f;
    };
    const pop = () => {
      const top = hn[0], n = hn.pop(), f = hf.pop(), len = hn.length;
      if (len) {
        let i = 0;
        for (;;) { let c = 2 * i + 1; if (c >= len) break; if (c + 1 < len && hf[c + 1] < hf[c]) c++; if (hf[c] >= f) break; hn[i] = hn[c]; hf[i] = hf[c]; i = c; }
        hn[i] = n; hf[i] = f;
      }
      return top;
    };
    const G = N[goal];
    seen[start] = gen; g[start] = 0; came[start] = -1;
    push(start, 0);
    const jc = city.jc;
    const onHwy = e0.cls === 'hwy' || e0.cls === 'ramp';
    let count = 0, found = start === goal;
    while (hn.length && !found && count++ < 90000) {
      const cur = pop();
      if (done[cur] === gen) continue;
      done[cur] = gen;
      if (cur === goal) { found = true; break; }
      for (const ei of N[cur].e) {
        if (cur === start && ei === ei0) continue;     // no U-turn where you are
        const e = E[ei];
        if (e.noTraffic) continue;
        const sg = e.a === cur ? 1 : -1;
        if (!T.allowed(ei, sg) || !T.inComponent(ei)) continue;
        // (examiners keep to the through streets: a residential street costs more)
        let mul = e.cls === 'res' ? 1.7 : e.cls === 'art' ? 0.9 : 1.05;
        if (e.cls === 'hwy' || e.cls === 'ramp') { if (!hwy && !onHwy) continue; mul = e.cls === 'hwy' ? 0.55 : 0.9; }
        if (jc && jc.ring[ei]) mul *= 2.5;     // round a roundabout only when it is the way
        const nb = sg > 0 ? e.b : e.a;
        const c = g[cur] + e.len * mul + (N[nb].e.length >= 3 ? 6 : 0);
        if (seen[nb] === gen && g[nb] <= c) continue;
        seen[nb] = gen; g[nb] = c; came[nb] = ei;
        push(nb, c + Math.hypot(N[nb].x - G.x, N[nb].z - G.z) * 0.5);
      }
    }
    if (!found) return null;
    const pe = [], ps = [], pn = [];
    for (let n = goal; n !== start;) {
      const ei = came[n], e = E[ei];
      pe.push(ei); ps.push(e.b === n ? 1 : -1); pn.push(n);
      n = e.b === n ? e.a : e.b;
    }
    pe.push(ei0); ps.push(sg0); pn.push(start);
    pe.reverse(); ps.reverse(); pn.reverse();
    return { pe, ps, pn };
  }

  // --- matching the car to the graph -------------------------------------------------

  /** The edge the car is on: { ei, sign (of travel), s (m from its start), lat (m right of its centreline), len } or null. */
  match(v) {
    const city = this.city, E = city.edges, N = city.nodes, run = this.run;
    const f = v.forward, mv = v.vLong < -0.3 ? -1 : 1, mx = f.x * mv, mz = f.z * mv;
    let best = null, bs = Infinity;
    const path = run && run.path;
    for (const ei of city.roadsNear(v.x, v.z, 0.6)) {
      const e = E[ei], a = N[e.a], b = N[e.b];
      const t = Math.max(0, Math.min(1, ((v.x - a.x) * e.dx + (v.z - a.z) * e.dz) / e.len));
      const ey = a.y + (b.y - a.y) * t;
      if (Math.abs(ey - v.y) > 4) continue;
      const px = a.x + e.dx * e.len * t, pz = a.z + e.dz * e.len * t;
      const d = Math.hypot(v.x - px, v.z - pz);
      const dot = mx * e.dx + mz * e.dz;
      let sc = Math.max(0, d - e.hw) * 3 + (1 - Math.abs(dot)) * 9 + d * 0.15;
      if (run && run.cur && run.cur.ei === ei) sc -= 2;
      if (path && path.pe.indexOf(ei, Math.max(0, run.idx - 1)) >= 0) sc -= 1.5;
      if (sc < bs) { bs = sc; best = { ei, t, dot }; }
    }
    if (!best) return null;
    const e = E[best.ei], a = N[e.a];
    const sign = best.dot >= 0 ? 1 : -1;
    const latAB = (v.x - a.x) * -e.dz + (v.z - a.z) * e.dx;
    return { ei: best.ei, sign, s: sign > 0 ? best.t * e.len : (1 - best.t) * e.len, lat: latAB * sign, len: e.len };
  }

  /** Near the plaza's lot, leaving it or coming home (no kerb or centre-line marks). */
  inLot(v) { const run = this.run; return Math.hypot(v.x - LOT.x, v.z - LOT.z) < (run && run.wi >= run.wps.length ? 150 : 45); }

  endNode(ei, sg) { const e = this.city.edges[ei]; return sg > 0 ? e.b : e.a; }
  startNode(ei, sg) { const e = this.city.edges[ei]; return sg > 0 ? e.a : e.b; }
  dirOf(ei, sg) { const e = this.city.edges[ei]; return [e.dx * sg, e.dz * sg]; }
  /** Metres to the nearest junction node (3+ ways) at either end of the car's edge. */
  junctionGap(c) {
    const N = this.city.nodes;
    let d = 1e9;
    if (N[this.startNode(c.ei, c.sign)].e.length >= 3) d = Math.min(d, c.s);
    if (N[this.endNode(c.ei, c.sign)].e.length >= 3) d = Math.min(d, c.len - c.s);
    return d;
  }
  /** Lanes the car's way has here: { n, w, right (the kerb lane's offset), left (the inner one's) }. */
  lanesOf(c) {
    const T = this.traffic, e = this.city.edges[c.ei];
    // (lane 0 / lane n-1 are each side's ends; which is the kerb's depends on the way)
    const u0 = T.laneLatU(c.ei, c.sign, 0), u1 = T.laneLatU(c.ei, c.sign, 0.999);
    const r = Math.max(u0, u1), l = Math.min(u0, u1);
    if (T.flow[c.ei] !== 0) {
      const L = T.laneInfo(c.ei);
      return { n: L.n, w: L.w, right: r, left: l };
    }
    const n = Math.abs(r - l) > 1.5 ? Math.max(2, Math.round(Math.abs(r - l) / 3.3) + 1) : 1;
    return { n, w: n > 1 ? Math.abs(r - l) / (n - 1) : e.hw, right: r, left: l };
  }
  streetOf(ei) { const e = this.city.edges[ei]; return (e && e.name) || (e && e.cls === 'hwy' ? 'the highway' : e && e.cls === 'ramp' ? 'the ramp' : 'an unnamed street'); }

  // --- marks ---------------------------------------------------------------------------

  sigRecent(dir, win = SIG_WIN) { return this.run.sigLast[dir] >= this.run.t - win; }

  addMark(k, extra) {
    const run = this.run;
    if (!run || run.fail) return;
    const [pts, what] = MARK[k];
    const where = run.cur ? this.streetOf(run.cur.ei) : '';
    const m = { k, pts, what: extra ? `${what} (${extra})` : what, where, t: Math.round(run.t) };
    run.marks.push(m);
    run.log.push(['mark', k, Math.round(run.t * 10) / 10]);
    this.hud.showToast(`✎ The examiner makes a note: ${m.what.toLowerCase()}`, 2600);
  }

  failTest(k, extra) {
    const run = this.run;
    if (!run || run.fail) return;
    run.fail = { k, what: FAIL[k][0] + (extra ? ` (${extra})` : ''), where: run.cur ? this.streetOf(run.cur.ei) : '' };
    run.log.push(['fail', k, Math.round(run.t * 10) / 10]);
    // (the sheet comes up from update(): a check that failed the test is
    // still inside the tick that reads this.run)
  }

  onCrash(impact) { if (this.run && impact > 2) this.failTest('crash'); }
  onPedHit(byPlayer) { if (this.run && byPlayer) this.failTest('ped'); }
  onSchoolBusPass() { if (this.run) this.failTest('bus'); }

  // --- the frame -----------------------------------------------------------------------

  say(t, ms = 3600) { if (this.run) this.run.said = t; this.hud.showToast(`Examiner: “${t}”`, ms); }

  update(dt, player) {
    const p = player.position;
    // the pillar in the lot, when no test is on and you are near
    const show = !this.run && Math.hypot(p.x - LOT.x, p.z - LOT.z) < 320;
    if (show) {
      if (!this.mark.visible) this.mark.position.set(LOT.x, this.city.groundAt(LOT.x, LOT.z, null) + 12, LOT.z);
      this.mark.visible = true;
      this.mark.rotation.y += dt * 0.6;
      this.mark.material.opacity = 0.22 + Math.sin(performance.now() * 0.004) * 0.08;
      if (Math.hypot(p.x - LOT.x, p.z - LOT.z) < 120) this.loadLimits();
      const at = player.onFoot ? this.near(player) : (player.vehicle && Math.hypot(p.x - LOT.x, p.z - LOT.z) < CAR_R);
      if (at && !this.hinted) { this.hinted = true; this.hud.showToast(player.onFoot ? 'DriveTest — press ENTER to book a road test' : 'DriveTest — stop and press ENTER to take your road test in this car', 3000); }
      else if (!at) this.hinted = false;
    } else this.mark.visible = false;
    const run = this.run;
    if (!run) return;
    this._pl = player;
    run.t += dt;
    if (run.fail) { this.finish(); return; }
    if (this.game.dead) this.failTest('car');
    else if (this.game.wanted > 0) this.failTest('police');
    else if (player.onFoot || !player.vehicle || (run.v && player.vehicle !== run.v)) this.failTest('left');
    else if (player.vehicle.dead) this.failTest('car');
    if (run.fail) { this.finish(); return; }
    run.v = player.vehicle;
    // the stalk's history, every frame
    if (player.sig && (player.sigOn || 0) >= SIG_MIN) run.sigLast[player.sig < 0 ? 'L' : 'R'] = run.t;
    run.acc += dt;
    if (run.acc >= TICK) { const d = run.acc; run.acc = 0; this.tick(d, run.v); }
    if (run.fail) { this.finish(); return; }
    if (this.run) this.drawPanel();
  }

  tick(dt, v) {
    const run = this.run, E = this.city.edges, N = this.city.nodes, T = this.traffic;
    const sp = Math.abs(v.vLong);
    run.odo += sp * dt;
    run.rerouteCd -= dt; run.closeCd -= dt; run.kerbCd -= dt;
    // the heading's turn, for the move a car made through a junction and the turn-round
    if (run.h !== null) run.hSum += wrap(v.heading - run.h);
    run.h = v.heading;
    const c = this.match(v), prev = run.cur;
    run.onRoadT = c ? run.onRoadT + dt : 0;
    if (c && prev && c.ei !== prev.ei) this.onEdgeChange(prev, c, v);
    run.cur = c;
    if (c) {
      this.checkWay(dt, v, c, sp);
      this.checkLanes(dt, v, c, sp);
      this.checkSpeed(dt, c, sp);
      this.checkClose(dt, v, c, sp);
      this.checkKerb(v, sp);
      this.checkJunction(dt, v, c, sp);
    }
    this.checkPending(v);
    if (run.fail) return;
    this.guide(dt, v, c, sp);
  }

  /** A new edge: a turn at the node between (signalled?), a merge, an exit. */
  onEdgeChange(a, b, v) {
    const run = this.run, E = this.city.edges, N = this.city.nodes;
    const n0 = this.endNode(a.ei, a.sign), n1 = this.startNode(b.ei, b.sign);
    const nd = n0 === n1 ? n0 : Math.hypot(N[n0].x - N[n1].x, N[n0].z - N[n1].z) < 40 ? n1 : -1;
    // (a lane change's sideways history runs on through a straight joint: a
    // freeway is in pieces of a few tens of metres)
    { const [px, pz] = this.dirOf(a.ei, a.sign), [qx, qz] = this.dirOf(b.ei, b.sign); if (nd < 0 || px * qx + pz * qz < 0.97) run.lh.length = 0; }
    // a turn's lane is judged on the street it turned into: on through its plain nodes
    if (run.wide && nd >= 0 && N[nd].e.length < 3) run.wide.ei = b.ei; else run.wide = null;
    if (nd < 0) return;
    const [ax, az] = this.dirOf(a.ei, a.sign), [bx, bz] = this.dirOf(b.ei, b.sign);
    const dot = ax * bx + az * bz, side = -az * bx + ax * bz;   // side > 0: b is to the right of a
    const ea = E[a.ei], eb = E[b.ei];
    if (run.task && run.task.k === 'turn') return;   // turning round: no junction marks
    if (ea.cls === 'ramp' && eb.cls === 'hwy') {
      run.mergeT = run.t;
      if (!this.sigRecent('L', 10) && !this.sigRecent('R', 10)) this.addMark('merge');
      return;
    }
    if (ea.cls === 'hwy' && eb.cls === 'ramp') {
      if (!this.sigRecent('R', 10)) this.addMark('exit');
      return;
    }
    if (ea.cls === 'hwy' || ea.cls === 'ramp') return;
    if (N[nd].e.length < 3 && (N[n0].e.length < 3)) return;
    if (dot > Math.cos(40 * Math.PI / 180)) return;
    const dir = side > 0 ? 'R' : 'L';
    run.turnOdo = run.odo;
    if (!this.sigRecent(dir)) { this.addMark('signal', dir === 'L' ? 'left' : 'right'); run.log.push(['nosig', nd, a.ei, b.ei, +dot.toFixed(2), Math.round(v.x), Math.round(v.z)]); }
    run.wide = { dir, ei: b.ei, sign: b.sign, odo: run.odo };
  }

  checkWay(dt, v, c, sp) {
    const run = this.run, T = this.traffic, e = this.city.edges[c.ei];
    // the wrong way down a one-way
    if (T.flow[c.ei] !== 0 && !T.allowed(c.ei, c.sign) && sp > 1 && v.vLong > 0) {
      run.ww += sp * dt;
      if (run.ww > 12) this.failTest('wrongway', this.streetOf(c.ei));
    } else run.ww = Math.max(0, run.ww - sp * dt * 0.5);
    // over the centre line of a two-way street (not at a junction, not turning round)
    const turning = (run.task && run.task.k === 'turn') || this.inLot(v) || run.onRoadT < 2;
    if (T.flow[c.ei] === 0 && e.cls !== 'ramp' && e.hw >= 3 && !turning && sp > 3 && this.junctionGap(c) > 20 && c.lat < -0.5) {
      run.wsT += dt;
      if (run.wsT > 1.5 && !run.wsMarked) { run.wsMarked = true; this.addMark('centre'); }
      if (run.wsT > 5) this.failTest('wrongside');
    } else if (c.lat > -0.2 || sp < 1) { run.wsT = 0; run.wsMarked = false; }
  }

  checkLanes(dt, v, c, sp) {
    const run = this.run;
    // (not while settling into the street a turn just went into)
    if (sp < 3 || (run.task && run.task.k === 'turn') || run.onRoadT < 3 || run.odo - (run.turnOdo || -1e9) < 35) { run.lh.length = 0; return; }
    const L = this.lanesOf(c);
    if (L.n < 2 || this.junctionGap(c) < 12 || this.inLot(v)) { run.lh.length = 0; return; }
    const h = run.lh;
    h.push(run.t, c.lat);
    while (h.length > 2 && h[0] < run.t - 5) h.splice(0, 2);
    const d = c.lat - h[1];
    if (Math.abs(d) > Math.max(2.8, 0.85 * L.w)) {
      const dir = d > 0 ? 'R' : 'L';
      h.length = 0;
      run.log.push(['lane', dir, Math.round(run.t), c.ei, +c.lat.toFixed(2), +(c.lat - d).toFixed(2), L.n, +L.w.toFixed(2), Math.round(v.x), Math.round(v.z)]);
      if (run.task && run.task.k === 'lc' && run.task.want === dir) run.task.done = true;
      if (run.t - run.mergeT > 8 && !this.sigRecent(dir)) this.addMark('lane', dir === 'L' ? 'to the left' : 'to the right');
    }
  }

  checkSpeed(dt, c, sp) {
    const run = this.run, e = this.city.edges[c.ei];
    const lim = this.limitOf(c.ei);
    run.limit = lim;
    if (!lim) return;
    const fwy = e.cls === 'hwy' || e.cls === 'ramp';
    const over = sp * 3.6 - lim, tol = fwy ? 10 : 5;
    if (over > (fwy ? 40 : 30)) { run.exT += dt; if (run.exT > 1.5) this.failTest('excess', `${kmh(sp)} in a ${lim}`); } else run.exT = 0;
    if (over > tol) {
      run.spT += dt; run.spLow = 0;
      if (run.spT > 2.5 && !run.spMarked) { run.spMarked = true; this.addMark('speed', `${kmh(sp)} in a ${lim}`); }
    } else {
      run.spT = 0;
      if (over < tol - 2) { run.spLow += dt; if (run.spLow > 3) run.spMarked = false; }
    }
  }

  checkClose(dt, v, c, sp) {
    const run = this.run;
    if (sp < 7) { run.closeT = 0; return; }
    const f = v.forward;
    let gap = Infinity;
    for (const o of this.traffic.cars) {
      if (o === v || o.mode === 'parked' || o.dead) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (dx * dx + dz * dz > 3600) continue;
      const al = dx * f.x + dz * f.z, lt = dx * -f.z + dz * f.x;
      if (al <= 0 || Math.abs(lt) > 1.8 || Math.abs(o.y - v.y) > 3) continue;
      if (Math.sin(o.heading) * f.x + Math.cos(o.heading) * f.z < 0.7) continue;
      gap = Math.min(gap, al - v.halfLen - o.halfLen);
    }
    if (gap / sp < CLOSE_T) {
      run.closeT += dt;
      // (once a spell of it: marked again only after a proper gap for 5 s)
      if (run.closeT > 2.5 && run.closeCd <= 0 && !run.closeOn) { run.closeOn = true; run.closeCd = 20; this.addMark('close', `${(Math.max(0, gap) / sp).toFixed(1)} s behind`); }
      run.closeOk = 0;
    } else { run.closeT = 0; run.closeOk = (run.closeOk || 0) + dt; if (run.closeOk > 5) run.closeOn = false; }
  }

  /** A wheel up the kerb: a corner on the pavement while the car is on the road. */
  checkKerb(v, sp) {
    const run = this.run;
    // (into and out of the plaza is over its kerb: the lot's driveways are not in the game;
    // a freeway has no kerb, and its gores' and ramps' verges overlap the lanes)
    // One mark a strike: riding along the kerb is the same strike until the
    // wheels have been off it 2 s.
    run.kerbOff = (run.kerbOff === undefined ? 9 : run.kerbOff) + TICK;
    if (sp < 1 || run.onRoadT < 1 || this.inLot(v)) return;
    const ce = run.cur && this.city.edges[run.cur.ei];
    if (ce && (ce.cls === 'hwy' || ce.cls === 'ramp')) return;
    const city = this.city;
    if (city.roadLift(v.x, v.z) > KERB_ROAD) return;
    const f = v.forward, w = v.halfWid - 0.1, l = v.halfLen - 0.5;
    for (const [a, b] of [[l, w], [l, -w], [-l, w], [-l, -w]]) {
      const x = v.x + f.x * a - f.z * b, z = v.z + f.z * a + f.x * b;
      // up on the pavement: raised, and outside every carriageway
      if (city.roadLift(x, z) >= KERB_ON && !city.onRoad(x, z, 0, false)) {
        const fresh = run.kerbOff > 2 && run.kerbCd <= 0;
        run.kerbOff = 0;
        if (!fresh) return;
        run.kerbCd = 4; this.addMark('kerb');
        const c = run.cur;
        run.log.push(['kerbAt', Math.round(x), Math.round(z), +city.roadLift(x, z).toFixed(2), c && this.city.edges[c.ei].cls, c && +c.lat.toFixed(2), c && +this.city.edges[c.ei].hw.toFixed(1), a > 0 ? 'f' : 'r', b > 0 ? 'R' : 'L']);
        return;
      }
    }
  }

  /** Stop signs and signals: the approach the car is on, its line, the light. */
  checkJunction(dt, v, c, sp) {
    const run = this.run, city = this.city, jc = city.jc, E = city.edges, N = city.nodes;
    if (!jc) return;
    // walk ahead to the next junction node (through two-way nodes), 90 m at most
    let ei = c.ei, sg = c.sign, d = c.len - c.s, A = null, C = null;
    for (let g = 0; g < 8 && d < 90; g++) {
      const n = this.endNode(ei, sg);
      const ci = jc.ctl[n];
      if (ci >= 0) {
        C = jc.list[ci];
        A = C.appr && C.appr.get(ei * 2 + (E[ei].b === n ? 1 : 0));
        break;
      }
      const nd = N[n];
      if (nd.e.length !== 2) break;
      const nx = nd.e[0] === ei ? nd.e[1] : nd.e[0], f = E[nx];
      sg = f.a === n ? 1 : -1; ei = nx; d += f.len;
    }
    const kind = A && (C.k === K_SIG ? 'sig' : C.k === K_STOP && A.kind === 'stop' ? 'stop' : null);
    if (!kind) { if (run.app && !run.app.crossed) run.app = null; return; }
    const front = d - A.back - v.halfLen;
    let ap = run.app;
    if (!ap || ap.A !== A) {
      if (front < -3) return;     // already past its line (inside the box)
      ap = run.app = { A, C, kind, minV: Infinity, crossed: false, ls: null, canStop: null };
    }
    if (ap.crossed) return;
    if (front < 10) ap.minV = Math.min(ap.minV, sp);
    if (kind === 'sig') {
      const ls = jc.light(C, A, 'S').s;
      if (ls === 'Y' && ap.canStop === null) ap.canStop = front > sp * AMB_REACT + sp * sp / (2 * AMB_DEC) + 1;
      if (ls !== 'Y') ap.canStop = null;
      ap.ls = ls;
    }
    // over the line: a stop sign's is judged with the nose a metre over it
    // (where a stopped car's nose ends up against the drawn bar), a signal's at it
    if (front <= (kind === 'stop' ? -1 : 0) && v.vLong > 0.2) {
      ap.crossed = true;
      if (kind === 'stop') {
        if (ap.minV > FAIL_STOP_V) this.failTest('stop', this.streetOf(c.ei));
        else if (ap.minV > ROLL_V) this.addMark('roll', `${kmh(ap.minV)} km/h`);
        run.log.push(['stop', +(ap.minV * 3.6).toFixed(1), Math.round(v.x), Math.round(v.z), +A.back.toFixed(1), +d.toFixed(1)]);
      } else {
        const L = { L: jc.light(C, A, 'L'), S: jc.light(C, A, 'S'), R: jc.light(C, A, 'R') };
        // the advance arrow's clearance (junctions.js 'clr': the arrow has no
        // amber of its own) is its amber for a left already on its way
        const ph = jc.phase(C).p;
        if (ph.k === 'clr' && ph.g === A.grp && L.L.s === 'R') L.L = { s: 'Y' };
        run.pend = { lights: { L: L.L.s, S: L.S.s, R: L.R.s }, stopped: ap.minV < 0.4, late: L.S.s === 'Y' && ap.canStop === true,
          h0: run.hSum, odo: run.odo, street: this.streetOf(c.ei) };
        run.log.push(['sig', L.L.s + L.S.s + L.R.s, Math.round(run.t), ph.k, C.nodes.length, A.ni, +front.toFixed(1), Math.round(v.x), Math.round(v.z)]);
      }
    }
  }

  /** What the car did after a signal's line (the move decides which light it ran), and a turn's lane. */
  checkPending(v) {
    const run = this.run;
    const P = run.pend;
    if (P) {
      const dh = run.hSum - P.h0;
      if (run.odo - P.odo > 32 || Math.abs(dh) > 1.05) {
        run.pend = null;
        const move = dh > 0.7 ? 'L' : dh < -0.7 ? 'R' : 'S';
        const s = P.lights[move];
        if (s === 'R') {
          if (move === 'R' && P.stopped) { /* right on red, after a stop: legal */ }
          else if (move === 'R') this.addMark('rightRed');
          else this.failTest('red', P.street);
        } else if (s === 'Y' && P.late && move !== 'L') this.addMark('amber');
      }
    }
    const W = run.wide, c = run.cur;
    if (W && c) {
      const gone = run.odo - W.odo;
      if (gone > 40) { run.wide = null; return; }
      if (gone >= 14 && c.ei === W.ei) {
        run.wide = null;
        const two = this.traffic.flow[c.ei] === 0, L = this.lanesOf(c);
        let bad = two && c.lat < -0.6;
        // (a right turn ends in the kerb lane; a left one anywhere on its own side)
        if (!bad && L.n >= 2 && W.dir === 'R') bad = c.lat < L.right - 0.6 * L.w;
        if (bad) this.addMark('wide', W.dir === 'L' ? 'left turn' : 'right turn');
      }
    }
  }

  // --- the examiner's directions --------------------------------------------------------

  guide(dt, v, c, sp) {
    const run = this.run, N = this.city.nodes, E = this.city.edges;
    if (run.task) { this.doTask(dt, v, c, sp); if (!run.task || !run.task.drive) return; }
    const wp = run.wps[run.wi];
    if (!wp) { this.home(dt, v, c, sp); return; }
    if (!c) { run.instr = run.path ? 'Back onto the road, please' : 'Pull out of the lot onto the street'; return; }
    if (!run.path) {
      const hwy = wp.hwy || (run.wi > 0 && run.wps[run.wi - 1].hwy);
      run.path = this.plan(c.ei, c.sign, wp.n, hwy);
      run.pv++; run.idx = 0; run.offD = 0;
      if (!run.path) { run.log.push(['noPath', run.wi]); run.wi++; return; }
      run.path.end = run.path.pe.length - 1;
      run.log.push(['plan', run.wi, run.path.pe.length]);
    }
    const P = run.path;
    // where on it
    let k = -1;
    for (let j = Math.max(0, run.idx - 1); j < Math.min(P.pe.length, run.idx + 8); j++) if (P.pe[j] === c.ei && P.ps[j] === c.sign) { k = j; break; }
    if (k >= 0) { run.idx = k; run.offD = 0; } else {
      run.offD += sp * dt;
      if (run.offD > 22) {
        run.path = null;
        if (run.rerouteCd <= 0) { run.rerouteCd = 25; this.say('That\'s alright — I\'ll take you a different way.', 2800); }
        run.log.push(['reroute', Math.round(run.t)]);
        return;
      }
    }
    // THROUGH A WAYPOINT WITHOUT A TASK the route goes straight on into the
    // next leg, planned before you get there: the turn at it is announced as
    // any other (a waypoint is a junction), never a new route sprung in the box
    const last = P.end;
    const nx = run.wps[run.wi + 1];
    if (!wp.task && nx && !P.ext) {
      let rem = c.len - c.s;
      for (let j = run.idx + 1; j <= last; j++) rem += E[P.pe[j]].len;
      if (rem < 300) {
        const X = this.plan(P.pe[last], P.ps[last], nx.n, nx.hwy || wp.hwy);
        if (X) { for (let j = 1; j < X.pe.length; j++) { P.pe.push(X.pe[j]); P.ps.push(X.ps[j]); P.pn.push(X.pn[j]); } P.next = P.pe.length - 1; }
        P.ext = true;
      }
    }
    if (last === 0 || (run.idx === last && c.s > c.len - 4) || run.idx > last || (k < 0 && run.idx >= last - 1 && Math.hypot(v.x - N[wp.n].x, v.z - N[wp.n].z) < 12)) {
      this.arrive(wp, v, c);
      return;
    }
    // the next thing to say
    const M = this.nextMove(c);
    if (!M) { run.instr = 'Continue straight'; run.instrD = 0; return; }
    run.instrD = M.d;
    const id = `${run.pv}:${M.j}`;
    const near = M.kind === 'exit' || M.kind === 'ramp' ? 650 : Math.max(70, Math.min(230, sp * 8));
    if (M.d < near && M.ord <= 1) {
      if (run.instrId !== id) {
        run.instrId = id; run.instr = M.text; run.instrFar = M.d > 110;
        this.say(M.text, 3400);
        if (this.audio && this.audio.ready) this.audio.ui('check');
      } else if (run.instrFar && M.d < 45) {
        run.instrFar = false;
        this.say(M.short, 2000);
      }
    } else if (run.instrId !== id) run.instr = 'Continue straight';
  }

  /** The next manoeuvre down the path: { j, d, kind, text, short, ord }. */
  nextMove(c) {
    const run = this.run, P = run.path, city = this.city, N = city.nodes, E = city.edges, jc = city.jc, T = this.traffic;
    let d = c.len - c.s;
    const passed = { lights: 0, stop: 0, L: 0, R: 0 };
    for (let j = run.idx; j < P.pe.length - 1; j++) {
      const n = P.pn[j], nd = N[n], ein = E[P.pe[j]], eout = E[P.pe[j + 1]];
      const [ax, az] = this.dirOf(P.pe[j], P.ps[j]), [bx, bz] = this.dirOf(P.pe[j + 1], P.ps[j + 1]);
      const dot = ax * bx + az * bz, side = -az * bx + ax * bz, dir = side > 0 ? 'R' : 'L';
      const word = dir === 'L' ? 'left' : 'right';
      const onto = eout.name && eout.name !== ein.name ? ` onto ${eout.name}` : '';
      let ctl = jc && jc.ctl[n] >= 0 ? jc.list[jc.ctl[n]] : null;
      if (!ctl && jc && j > run.idx && ein.len < 40 && jc.ctl[P.pn[j - 1]] >= 0) ctl = jc.list[jc.ctl[P.pn[j - 1]]];
      const kind = ctl ? (ctl.k === K_SIG ? 'lights' : ctl.k === K_STOP ? 'stop' : ctl.k === K_RB || ctl.k === K_MINI ? 'rb' : null) : null;
      if (eout.cls === 'ramp' && ein.cls !== 'ramp' && ein.cls !== 'hwy') {
        let hn = '';
        for (let q = j + 1; q < Math.min(P.pe.length, j + 30); q++) if (E[P.pe[q]].cls === 'hwy') { hn = E[P.pe[q]].name || ''; break; }
        const t = `Take the ramp on the ${word}${hn ? ` onto ${hn}` : ' onto the highway'}`;
        return { j, d, kind: 'ramp', text: t, short: `The ramp on the ${word}, here`, ord: 0 };
      }
      if (ein.cls === 'hwy' && eout.cls === 'ramp') {
        let sn = '';
        for (let q = j + 1; q < Math.min(P.pe.length, j + 30); q++) if (E[P.pe[q]].cls !== 'ramp' && E[P.pe[q]].cls !== 'hwy') { sn = E[P.pe[q]].name || ''; break; }
        return { j, d, kind: 'exit', text: `Take the next exit${sn ? `, for ${sn}` : ''}`, short: 'This exit, please', ord: 0 };
      }
      if (nd.e.length >= 3 && dot < Math.cos(38 * Math.PI / 180) && ein.cls !== 'hwy') {
        let text, ord;
        if (kind === 'lights') { ord = passed.lights; text = `At ${ord ? 'the second set of' : 'the'} lights, turn ${word}${onto}`; }
        else if (kind === 'stop') { ord = passed.stop; text = `At ${ord ? 'the second' : 'the'} stop sign, turn ${word}${onto}`; }
        else if (kind === 'rb') { ord = 0; text = `At the roundabout, take the exit to the ${word}${onto}`; }
        else { ord = passed[dir]; text = `Take the ${ord ? 'second' : 'next'} ${word}${onto}`; }
        return { j, d, kind: 'turn', text, short: `Turn ${word} here`, ord };
      }
      if (nd.e.length >= 3 && dot < 0.97 && ein.cls !== 'hwy') {
        // a fork: is there a straighter way we are not taking?
        let other = false;
        for (const k of nd.e) {
          if (k === P.pe[j] || k === P.pe[j + 1]) continue;
          const f = E[k], s2 = f.a === n ? 1 : -1;
          if (!T.allowed(k, s2)) continue;
          if (f.dx * s2 * ax + f.dz * s2 * az > dot + 0.02) other = true;
        }
        if (other) return { j, d, kind: 'keep', text: `Keep ${word}${onto}`, short: `Keep ${word}`, ord: 0 };
      }
      // what this node counts as, for "the second ..."
      if (nd.e.length >= 3) {
        if (kind === 'lights' && !(j > run.idx && ein.len < 40 && kindAt(jc, P.pn[j - 1]) === K_SIG)) passed.lights++;
        else if (kind === 'stop') passed.stop++;
        if (!kind || kind === 'stop') {
          for (const k of nd.e) {
            if (k === P.pe[j] || k === P.pe[j + 1]) continue;
            const f = E[k], s2 = f.a === n ? 1 : -1;
            if (!T.allowed(k, s2) || f.cls === 'hwy' || f.cls === 'ramp') continue;
            const ox = f.dx * s2, oz = f.dz * s2;
            if (ox * ax + oz * az > 0.6) continue;
            passed[-az * ox + ax * oz > 0 ? 'R' : 'L']++;
          }
        }
      }
      d += eout.len;
      if (d > 900) break;
    }
    return null;
  }

  /** At a waypoint: its task, or on to the next. */
  arrive(wp, v, c) {
    const run = this.run;
    run.log.push(['wp', run.wi, wp.task, Math.round(run.t)]);
    const P = run.path;
    if (P && P.next !== undefined && !wp.task) { P.end = P.next; P.next = undefined; P.ext = false; } else run.path = null;
    if (wp.task === 'pull') {
      run.task = { k: 'pull', ph: 'ask', t: 0, still: 0 };
      this.say('When it\'s safe, pull over on the right and stop.', 3600);
    } else if (wp.task === 'turn') {
      run.task = { k: 'turn', ph: 'ask', t: 0, still: 0 };
      this.say('Pull over on the right, then turn the car around using a three-point turn. Don\'t use a driveway.', 4400);
    } else if (wp.task === 'lc') {
      // (asked on the way: the route goes on to the next waypoint meanwhile)
      run.task = { k: 'lc', want: 'L', t: 0, drive: true, n: 0 };
      this.say('When it\'s safe, move into the left lane.', 3200);
      run.wi++;
      return;
    } else if (wp.task === 'home') {
      run.wi++;
      this.say('Turn into the plaza on your way and park in front of DriveTest, please.', 3600);
      return;
    }
    if (!run.task) run.wi++;
  }

  doTask(dt, v, c, sp) {
    const run = this.run, K = run.task;
    K.t += dt;
    const done = () => { run.task = null; run.wi++; run.path = null; };
    if (K.k === 'lc') {
      run.instr = K.want === 'L' ? 'Move into the left lane' : 'Move back into the right lane';
      if (K.done) {
        K.done = false;
        if (K.want === 'L') { K.want = 'R'; K.t = 0; this.say('Thank you. Now move back into the right lane when it\'s safe.', 3000); }
        else run.task = null;
        return;
      }
      // (off the freeway before it was done: the request lapses)
      if (K.t > 60) { this.addMark('lcNo'); run.task = null; }
      else if (c && this.city.edges[c.ei].cls !== 'hwy' && K.t > 3) run.task = null;
      return;
    }
    if (K.k === 'pull') {
      if (K.ph === 'ask') {
        run.instr = 'Pull over on the right and stop';
        if (sp < 0.3 && c && this.junctionGap(c) > 15) K.still += dt; else K.still = 0;
        if (K.still > 1.5) {
          const kerb = this.city.edges[c.ei].hw - (c.lat + v.halfWid);
          if (!this.sigRecent('R', 12)) this.addMark('pullSig');
          if (kerb > 1.0) this.addMark('pullFar', `${kerb.toFixed(1)} m`);
          K.ph = 'wait'; K.t = 0;
          run.log.push(['pulled', +kerb.toFixed(2)]);
        } else if (K.t > 75) { this.addMark('pullNo'); done(); }
      } else if (K.ph === 'wait') {
        run.instr = 'Hold here';
        if (K.t > 2.5) { K.ph = 'out'; K.t = 0; this.say('Thank you. When you\'re ready, signal and move back into traffic.', 3200); }
      } else {
        run.instr = 'Signal and move back into traffic';
        if (sp > 2.5) { if (!this.sigRecent('L', 10)) this.addMark('pullOut'); done(); }
        else if (K.t > 60) done();
      }
      return;
    }
    if (K.k === 'turn') {
      if (K.ph === 'ask') {
        run.instr = 'Pull over on the right, then turn around (three-point turn)';
        if (sp < 0.3) K.still += dt; else K.still = 0;
        if (K.still > 1) { K.ph = 'go'; K.h0 = run.hSum; K.moves = 1; K.dir = 1; K.rev = 0; K.t = 0; }
        else if (K.t > 60) { K.ph = 'go'; K.h0 = run.hSum; K.moves = 1; K.dir = 1; K.rev = 0; K.t = 0; }
        return;
      }
      run.instr = 'Turn the car around';
      const dirNow = v.vLong > 0.3 ? 1 : v.vLong < -0.3 ? -1 : 0;
      if (dirNow && dirNow !== K.dir) { K.dir = dirNow; K.moves++; if (dirNow < 0) K.rev++; }
      if (Math.abs(run.hSum - K.h0) > 2.6 && v.vLong > 1.5) {
        run.log.push(['turned', K.moves, K.rev]);
        if (K.moves > 5) this.addMark('turnMoves', `${K.moves} moves`);
        this.say('Thank you.', 1500);
        done();
      } else if (K.t > 100) { this.addMark('turnNo'); done(); }
    }
  }

  /** The way back: into the lot, stopped by the pillar. */
  home(dt, v, c, sp) {
    const run = this.run;
    const d = Math.hypot(v.x - LOT.x, v.z - LOT.z);
    run.instr = 'Park in front of DriveTest';
    run.instrD = d;
    if (d < 70 && sp < 0.4 && (!c || d < 22)) { run.endT += dt; if (run.endT > 1.2) this.finish(); }
    else run.endT = 0;
    if (!run.path && c && d > 160 && run.wps.length) {
      // lost on the way back: home's node again
      const hn = run.wps[run.wps.length - 1].n;
      run.wi = run.wps.length - 1;
      if (hn < 0) run.wi = run.wps.length;
    }
  }

  // --- the end -------------------------------------------------------------------------

  finish() {
    const run = this.run;
    if (!run) return;
    this.run = null;
    this.showPanel(false);
    const pts = run.marks.reduce((a, m) => a + m.pts, 0);
    const fail = run.fail || (pts > PASS_MAX ? { k: 'marks', what: FAIL.marks[0], where: '' } : null);
    const pass = !fail;
    const st = this.stats, prev = st[run.kind];
    const first = pass && !(prev && prev.pass);
    const pay = pass ? PAY[run.kind][first ? 0 : 1] : 0;
    if (pass) { this.game.money += pay; st.passes++; }
    if (!prev || (pass && (!prev.pass || pts < prev.marks)) || (!prev.pass && !pass)) {
      st[run.kind] = { pass: pass || !!(prev && prev.pass), marks: pass ? pts : prev && prev.pass ? prev.marks : pts, date: new Date().toISOString().slice(0, 10) };
    }
    this.save();
    const remark = fail ? FAIL[fail.k][1] : PASS_SAY.find(([m]) => pts <= m)[1];
    this.last = { kind: run.kind, pass, pts, marks: run.marks.map((m) => [m.k, m.pts, m.where]), fail: fail && fail.k, t: Math.round(run.t), km: +(run.odo / 1000).toFixed(2), pay, log: run.log };
    window.__g2Last = this.last;
    if (this.audio && this.audio.ready) { if (pass) this.audio.cash(); else this.audio.ui('fail'); }
    if (this.noSheet) return;
    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const rows = run.marks.map((m) => `<tr><td>${esc(m.what)}<br><small>${esc(m.where)}</small></td><td class="p">${m.pts}</td></tr>`).join('')
      + (run.fail ? `<tr><td class="f">${esc(run.fail.what)}<br><small>${esc(run.fail.where)}</small></td><td class="p f">FAIL</td></tr>` : '');
    const lic = run.kind === 'G' ? 'Full G licence' : 'G2 licence';
    this.showSheet(`<div class="g2h">DriveTest — ${run.kind} road test · Kitchener</div>
      <div class="g2s">${Math.floor(run.t / 60)} min ${Math.round(run.t % 60)} s · ${(run.odo / 1000).toFixed(1)} km driven</div>
      <div class="g2r ${pass ? 'pass' : 'fail'}">${pass ? 'PASS' : 'FAIL'}</div>
      ${rows ? `<table>${rows}<tr><td><b>Marks</b> (${PASS_MAX} or fewer to pass)</td><td class="p">${pts}</td></tr></table>` : '<div class="g2s">No marks on the sheet.</div>'}
      <div class="g2q">Examiner: “${esc(remark)}”</div>
      ${pass ? `<div><b>${lic}</b> · ${formatMoney(pay)}${first ? ' — your first' : ''}</div>` : '<div class="g2s">You can book another test here whenever you\'re ready.</div>'}
      <button class="g2b g2x" data-k="ok">Done</button>`, () => {});
  }

  /** Give up (the pause menu, a respawn): no sheet. */
  abandon() {
    if (!this.run) return;
    this.run = null;
    this.showPanel(false);
  }

  // --- the clipboard panel -------------------------------------------------------------------

  showPanel(on) {
    if (!this.panel) {
      const el = document.createElement('div');
      el.id = 'g2Panel';
      el.style.cssText = 'position:absolute;left:50%;top:calc(86px + env(safe-area-inset-top));transform:translateX(-50%);min-width:240px;max-width:min(92vw,520px);'
        + 'padding:6px 12px 7px;border-radius:7px;background:rgba(250,250,246,0.92);border-left:6px solid #1f8f4a;color:#13202b;'
        + 'font:600 12px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;pointer-events:none;display:none;z-index:6;box-shadow:0 2px 10px rgba(0,0,0,.35)';
      const top = document.createElement('div'); top.style.cssText = 'font-size:10px;letter-spacing:.08em;color:#4c5a64';
      const mid = document.createElement('div'); mid.style.cssText = 'font-size:16px;font-weight:800;margin:2px 0';
      const bot = document.createElement('div'); bot.style.cssText = 'font-size:12px;color:#33414b';
      el.append(top, mid, bot);
      (this.root && this.root.querySelector('#hud') || this.root || document.body).appendChild(el);
      this.panel = { el, top, mid, bot, txt: ['', '', ''] };
    }
    this.panel.el.style.display = on ? 'block' : 'none';
    if (this.root) this.root.dataset.g2 = on ? '1' : '';
  }

  drawPanel() {
    const run = this.run, P = this.panel;
    if (!P || !run.v) return;
    const set = (i, n, t) => { if (P.txt[i] !== t) { P.txt[i] = t; n.textContent = t; } };
    const pts = run.marks.reduce((a, m) => a + m.pts, 0);
    set(0, P.top, `DRIVETEST · ${run.kind} ROAD TEST · ${Math.floor(run.t / 60)}:${String(Math.floor(run.t % 60)).padStart(2, '0')}`);
    const d = run.instrD > 20 && run.instr !== 'Continue straight' ? ` · ${Math.round(run.instrD / 10) * 10} m` : '';
    set(1, P.mid, (run.instr || '') + d);
    const sig = (this._pl && this._pl.sig) || 0;
    set(2, P.bot, `${run.limit ? `Limit ${run.limit} · ` : ''}${kmh(Math.abs(run.v.vLong))} km/h · ${pts} mark${pts === 1 ? '' : 's'}${sig ? (sig < 0 ? ' · ◀ signalling' : ' · signalling ▶') : ''}`);
  }
}

function kindAt(jc, n) { return jc && jc.ctl[n] >= 0 ? jc.list[jc.ctl[n]].k : 0; }

// a corner on the pavement while the centre is on the carriageway (citygen
// ROAD_LIFT 0.30, WALK_LIFT 0.52)
const KERB_ROAD = 0.36, KERB_ON = 0.45;

/**
 * DriveTest's lettering on the plaza's fascia: the Ottawa Lackner Centre's
 * pylon and strip (kwshops.js, data/shops.json) list its tenants from OSM's
 * shops, and DriveTest is an amenity, not a shop. Added to the plaza before
 * the shops are built (main.js), in the strip at OSM's point.
 */
export function addDriveTestSign(shops) {
  const P = shops && (shops.plazas || []).find((p) => p.n === 'Ottawa Lackner Centre');
  if (!P || (P.sh || []).some((r) => r[0] === 'DriveTest')) return false;
  (P.sh || (P.sh = [])).push(['DriveTest', CENTRE.x, CENTRE.z]);
  if (P.ten && !P.ten.includes('DriveTest')) P.ten.splice(Math.min(3, P.ten.length), 0, 'DriveTest');
  return true;
}
