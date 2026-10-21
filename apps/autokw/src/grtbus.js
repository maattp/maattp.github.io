// GRT BUS DRIVER: drive a real section of a Grand River Transit route.
//
// data/grt.json (tools/kw/build_grt.py) holds four sections of OSM's GRT
// route relations -- 7 King, 202 and 201 iXpress, 57 Blair -- each 9-12
// stops from a terminal, with the stops' real names and places, in order,
// and the route's line between them.
//
// A bus waits at each section's first stop (traffic 'apron', so it is never
// recycled). Get in -- or drive any GRT bus up to that stop and stop -- and
// the run begins: the destination sign shows the route (`Sign`, a canvas over
// the bus's own LED sign), the first riders walk to the front door and board,
// and the doors close. Then, stop by stop:
//
//   - "Next stop: King / Columbia" -- the two-tone chime and the stop on the
//     HUD's LED panel; the route on both maps.
//   - Riders wait at the stop (the game's own pedestrians, `fare` 3: standing,
//     facing the road). Pull up with the front door at the stop and stop: the
//     doors open (`bus_doors`), riders get off and walk away, the waiting ones
//     walk to the door and board, the doors close.
//   - Each stop is scored against the SCHEDULE (`sched`: the leg's length at a
//     timetable speed + a dwell a stop): up to 60 s late is on time, and early
//     is fine except at a TIMEPOINT (a station, every third stop), where the
//     doors stay open until 30 s before the timetable -- holding for time, as
//     GRT's drivers do -- and pulling away sooner costs the stop's points.
//     And against the kerb (how far the door stopped from the stop).
//   - Driving past a stop is a missed stop. Hard braking, hard turns, kerb
//     strikes, crashes and running somebody down cost the SMOOTH score.
//
// At the last stop everyone gets off and the run pays into the wallet: a
// base a stop served + the score / 10. Bests per route in localStorage
// `autokw-grt`. Leaving the bus, wrecking it, three stars or driving far off
// the route ends the run and leaves nothing behind.
//
// Harness: `__dbg.grt` (`routes`, `run`, `start(id, v)`, `stats`); the probe
// is tools/kw/grtprobe.mjs (a section driven with real keys).

import * as THREE from './three.js';
import { clamp, formatMoney } from './util.js';

const KEY = 'autokw-grt';
const STOP_V = 0.7;              // m/s: "stopped" at a stop
const START_R = 26;              // a bus stopped this close to a terminal's stop starts the run
const SERVE_AHEAD = 11, SERVE_BEHIND = 5;   // the stop's place, along the bus from its centre (the front door is ~5 m ahead)
const SERVE_LAT = 11;            // ...and off its kerb side
const MISS_PAST = 28;            // m past a stop along the route: missed
const OFF_ROUTE = 70, LOST = 450;
const DWELL_SCHED = 15;          // s the timetable allows a stop
const LEG_V = { local: 8.5, express: 10.5 };   // m/s the timetable assumes between stops
const EARLY_OK = 30, LATE_OK = 60;
const BASE_PAY = 10;
const HARD_BRAKE = 7.5, HARD_LAT = 5.0;       // m/s^2 held for HOLD_T at speed
const HOLD_T = 0.4;
const DOOR_Z = 5.0;              // the front door's centre, from the bus's centre

// GRT's map colours for the route families, for the LED panel's route badge
const BADGE = { local: '#0b4ea2', express: '#f7941d' };

function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }

/** The front destination sign: a canvas laid over the bus's baked LED sign. */
class Sign {
  constructor() {
    this.cv = document.createElement('canvas');
    this.cv.width = 512; this.cv.height = 48;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.16, 0.2), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    // the doorways, open: dark panels over both kerb-side doors
    const g = new THREE.BufferGeometry();
    const P = [];
    for (const [z0, z1] of [[4.47, 5.53], [-0.58, 0.58]]) {
      const x = -1.29, y0 = 0.5, y1 = 2.5;
      P.push(x, y0, z0, x, y0, z1, x, y1, z1, x, y0, z0, x, y1, z1, x, y1, z0);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.computeVertexNormals();
    this.doors = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x15191d, side: THREE.DoubleSide }));
    this.doors.visible = false;
    this.text = null;
  }

  attach(v) {
    this.v = v;
    this.mesh.position.set(0, v.spec.roof - 0.37, v.spec.len / 2 + 0.05);
    v.tilt.add(this.mesh, this.doors);
  }

  detach() {
    if (this.v) { this.v.tilt.remove(this.mesh, this.doors); this.v = null; }
    this.doors.visible = false;
  }

  /** Amber dot-matrix lettering: the route number, then the destination. */
  set(num, dest) {
    const t = `${num}|${dest}`;
    if (t === this.text) return;
    this.text = t;
    const c = this.cv.getContext('2d'), W = this.cv.width, H = this.cv.height;
    c.fillStyle = '#0a0a0b'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#ffb21e';
    c.textBaseline = 'middle';
    c.font = 'bold 40px "Courier New", monospace';
    c.fillText(num, 10, H / 2 + 2);
    const nw = c.measureText(num).width + 26;
    let fs = 34;
    c.font = `bold ${fs}px "Courier New", monospace`;
    while (c.measureText(dest).width > W - nw - 8 && fs > 16) { fs -= 2; c.font = `bold ${fs}px "Courier New", monospace`; }
    c.fillText(dest, nw, H / 2 + 2);
    // the LED pitch: dark lines through the lettering
    c.fillStyle = 'rgba(10,10,11,0.55)';
    for (let x = 0; x < W; x += 4) c.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 1);
    this.tex.needsUpdate = true;
  }
}

/** The on-board "next stop" display, top-centre of the screen (DOM). */
export class LedPanel {
  constructor(root) {
    const el = document.createElement('div');
    el.id = 'jobLed';
    el.style.cssText = 'position:absolute;left:50%;top:calc(88px + env(safe-area-inset-top));transform:translateX(-50%);'
      + 'min-width:220px;max-width:min(92vw,520px);padding:6px 12px 7px;border-radius:7px;background:rgba(8,8,10,0.86);'
      + 'border:1px solid rgba(255,178,30,0.35);font:700 13px/1.25 "Courier New",monospace;color:#ffb21e;text-align:center;'
      + 'pointer-events:none;display:none;z-index:6;text-shadow:0 0 6px rgba(255,160,20,0.45);letter-spacing:0.02em';
    this.top = document.createElement('div');
    this.mid = document.createElement('div');
    this.mid.style.cssText = 'font-size:17px;color:#ffc94a;margin:2px 0';
    this.bot = document.createElement('div');
    this.bot.style.cssText = 'font-size:12px;color:#e8d2a0';
    el.append(this.top, this.mid, this.bot);
    (root.querySelector('#hud') || root).appendChild(el);
    this.el = el;
    this._t = ['', '', ''];
  }

  show(top, mid, bot, badge) {
    this.el.style.display = 'block';
    const set = (i, n, t) => { if (this._t[i] !== t) { this._t[i] = t; n.textContent = t; } };
    set(0, this.top, top || ''); set(1, this.mid, mid || ''); set(2, this.bot, bot || '');
    if (badge && this._badge !== badge) { this._badge = badge; this.el.style.borderColor = badge; }
  }

  hide() { if (this.el.style.display !== 'none') this.el.style.display = 'none'; }
}

/**
 * What a passenger (or a bag of food) feels: the fore-aft acceleration from
 * the speed's change and the sideways one from speed x yaw rate, each
 * smoothed over ~0.2 s. Not the world velocity's derivative: a tyre's slip
 * angle flickering under bang-bang keyboard steering made that read 1-2 m/s^2
 * of sideways "g" on a straight road.
 */
export class Feel {
  constructor() { this.v = null; this.h = 0; this.along = 0; this.lat = 0; }
  step(dt, v) {
    if (this.v !== null && dt > 0) {
      let dh = v.heading - this.h;
      dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI;
      const k = 1 - Math.exp(-dt / 0.2);
      this.along += ((v.vLong - this.v) / dt - this.along) * k;
      this.lat += (Math.abs(v.vLong * dh / dt) - this.lat) * k;
    }
    this.v = v.vLong; this.h = v.heading;
    return this;
  }
}

function fmtDelta(s) {
  const a = Math.abs(Math.round(s));
  const t = `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  return s > LATE_OK ? `${t} late` : s < -EARLY_OK ? `${t} early` : a < 5 ? 'on time' : s > 0 ? `on time (${t} behind)` : `on time (${t} ahead)`;
}

export class GrtBus {
  constructor({ scene, city, game, traffic, peds, hud, audio, data, root, panel }) {
    this.scene = scene; this.city = city; this.game = game; this.traffic = traffic;
    this.peds = peds; this.hud = hud; this.audio = audio;
    this.panel = panel || new LedPanel(root);
    this.sign = new Sign();
    this.run = null;
    this.armed = null;          // a route just finished or abandoned: not again until the bus leaves its start
    this.leavers = [];
    this.best = read();
    this.stats = { runs: 0, stops: 0, earned: 0 };
    if (this.best.__stats) Object.assign(this.stats, this.best.__stats);
    this.buses = [];
    this.routes = ((data && data.routes) || []).map((r) => this._route(r)).filter(Boolean);
  }

  _route(r) {
    const line = r.line;
    if (!line || line.length < 2 || !r.stops || r.stops.length < 3) return null;
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const express = /iXpress/.test(r.sign);
    const V = express ? LEG_V.express : LEG_V.local;
    const at = r.at;
    // the timetable: arrival at each stop, from the departure at the first
    const sched = [0];
    for (let i = 1; i < at.length; i++) sched.push(sched[i - 1] + (at[i] - at[i - 1]) / V + (i > 1 ? DWELL_SCHED : 0));
    const num = r.sign.split(' ')[0];
    const d0x = line[1][0] - line[0][0], d0z = line[1][1] - line[0][1];
    return {
      id: r.id, sign: r.sign, num, name: r.sign.slice(num.length + 1), head: r.head, blurb: r.blurb, express,
      stops: r.stops.map(([name, x, z], i) => ({ name, x, z, at: at[i] })),
      line, cum, len: cum[cum.length - 1], sched,
      start: { x: line[0][0], z: line[0][1], h: Math.atan2(d0x, d0z) },
    };
  }

  /** Where a stop is served from: the kerb-lane point beside it (the route's
   *  line is the road's centreline; the stop's own point is the platform). */
  _kerbPoint(rt, i) {
    const st = rt.stops[i];
    const p = this._pointAt(rt, st.at);
    // to the right of the direction of travel, at the near lane
    const rx = -p.dz, rz = p.dx;
    let hw = 5.2;
    let bd = 1e9;
    for (const ei of this.city.edgesNear(p.x, p.z, 25)) {
      const e = this.city.edges[ei];
      if (e.elev || e.tunnel) continue;
      const a = this.city.nodes[e.a], b = this.city.nodes[e.b];
      const sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz || 1;
      const t = clamp(((p.x - a.x) * sx + (p.z - a.z) * sz) / l2, 0, 1);
      const d = Math.hypot(a.x + sx * t - p.x, a.z + sz * t - p.z);
      if (d < bd) { bd = d; hw = e.hw; }
    }
    const off = Math.max(1.8, hw - 1.7);
    return { x: p.x + rx * off, z: p.z + rz * off, dx: p.dx, dz: p.dz, hw };
  }

  _pointAt(rt, s) {
    const { line, cum } = rt;
    let i = 1;
    while (i < line.length - 1 && cum[i] < s) i++;
    const a = line[i - 1], b = line[i], L = cum[i] - cum[i - 1] || 1;
    const t = clamp((s - cum[i - 1]) / L, 0, 1);
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / L, dz: (b[1] - a[1]) / L };
  }

  /** Arc length along the route nearest (x, z), searched near the last answer. */
  _progress(rt, x, z, run) {
    const { line, cum } = rt;
    const i0 = Math.max(0, run.seg - 4), i1 = Math.min(line.length - 1, run.seg + 30);
    let best = null;
    for (let i = i0; i < i1; i++) {
      const a = line[i], b = line[i + 1];
      const sx = b[0] - a[0], sz = b[1] - a[1], l2 = sx * sx + sz * sz || 1;
      const t = clamp(((x - a[0]) * sx + (z - a[1]) * sz) / l2, 0, 1);
      const d = Math.hypot(a[0] + sx * t - x, a[1] + sz * t - z);
      if (!best || d < best.d) best = { d, s: cum[i] + t * Math.sqrt(l2), i };
    }
    if (best) run.seg = best.i;
    return best;
  }

  /** Park a bus at every section's first stop, nose along the route. */
  spawnBuses() {
    for (const rt of this.routes) {
      const k = this._kerbPoint(rt, 0);
      // a terminal's platform can be off the street (a station loop): then the
      // kerb point beside the route's first metres
      const v = this.traffic.spawnAt(k.x - k.dx * 4, k.z - k.dz * 4, Math.atan2(k.dx, k.dz), rt.express ? 'busx' : 'bus', 0, 'apron');
      v.vLong = 0;
      v.grtRoute = rt.id;
      this.buses.push(v);
      rt.home = { x: k.x, z: k.z };
    }
  }

  /** Map icons: one per terminal, with the tutorial line. */
  places() {
    return this.routes.map((rt) => ({
      x: rt.start.x, z: rt.start.z, kind: 'grt', name: `GRT ${rt.sign}`, near: false, label: rt.num,
      hello: () => `GRT ${rt.sign} — ${rt.stops.length - 1} stops to ${rt.head}. Climb into the bus: stop with the front door at each stop and the doors open; keep to the timetable and drive smooth`,
    }));
  }

  /** The pause menu's Jobs list. */
  jobRows() {
    return this.routes.map((rt) => {
      const b = this.best[rt.id];
      return { name: `GRT ${rt.sign}`, sub: `${rt.stops[0].name} → ${rt.head}`, best: b ? `${b.score} pts ${b.grade}` : null,
        medal: b ? (b.grade === 'A' ? 'gold' : b.grade === 'B' ? 'silver' : 'bronze') : null };
    });
  }

  isBus(v) { return !!(v && v.spec && v.spec.grt && !v.spec.artic && !v.dead); }

  // --- the run ---------------------------------------------------------------

  start(rt, v) {
    const riders = [];
    // riders aboard after each stop: some on at the terminal, some off and on at each stop
    let aboard = 0;
    const plan = rt.stops.map((st, i) => {
      const last = i === rt.stops.length - 1;
      const off = last ? aboard : Math.min(aboard, Math.floor(Math.random() * 3));
      const on = last ? 0 : i === 0 ? 3 + Math.floor(Math.random() * 3) : Math.floor(Math.random() * (/Station|Terminal|University|Square/.test(st.name) ? 5 : 3));
      aboard += on - off;
      return { on, off };
    });
    this.run = {
      rt, v, i: 0, stage: 'board', t: 0, clock: 0, seg: 0, s: 0, plan,
      kerb: rt.stops.map((st, i) => this._kerbPoint(rt, i)),
      waiting: [], boarding: [], alightLeft: 0, alightT: 0, dwellT: 0,
      aboard: 0, served: 0, missed: 0, results: [],
      smooth: 100, events: { brake: 0, turn: 0, kerb: 0, crash: 0, bump: 0, ped: 0, left: 0 },
      holdUntil: -1e9, brakeT: 0, latT: 0, evCd: 0, kerbCd: 0, kerbAcc: 0, offT: 0, sayCd: 0,

    };
    this.sign.attach(v);
    this.sign.set(rt.num, rt.head);
    this.hud.showToast(`GRT ${rt.sign} to ${rt.head} — ${rt.stops.length - 1} stops. Stop with the front door at each stop; the doors open themselves`, 5200);
    if (this.audio && this.audio.ready) this.audio.ui('start');
    this.openDoors();
    this.spawnWaiting(0, true);
    this.run.boarding = this.run.waiting.splice(0);
    for (const p of this.run.boarding) this.walkToDoor(p);
    this.hud.fare = { hail: null, dest: rt.stops[1], route: this.routeFrom(rt, 0) };
    window.__grtLast = null;
  }

  routeFrom(rt, s) {
    const pts = [];
    const p = this._pointAt(rt, s);
    pts.push(p.x, p.z);
    for (let i = 0; i < rt.line.length; i++) if (rt.cum[i] > s) pts.push(rt.line[i][0], rt.line[i][1]);
    return Float32Array.from(pts);
  }

  /** The riders who will board at stop i, standing at it facing the road. */
  spawnWaiting(i, nearBus) {
    const run = this.run, rt = run.rt, n = run.plan[i].on;
    const st = rt.stops[i], k = run.kerb[i];
    // stand on the pavement by the stop: the platform, or beyond the kerb point
    let bx = st.x, bz = st.z;
    const off = Math.hypot(st.x - k.x, st.z - k.z);
    if (nearBus || off > 14) { const rx = -k.dz, rz = k.dx; bx = k.x + rx * 3.2; bz = k.z + rz * 3.2; }
    for (let j = 0; j < n; j++) {
      const a = (j - (n - 1) / 2) * 1.1;
      const x = bx + k.dx * a, z = bz + k.dz * a;
      const p = this.peds.spawnFareAt(x, z, this.city.groundAt(x, z, null) + 1, k.x, k.z);
      p.fare = 3;   // standing, facing the road (peds.js: only 2 walks, only 1 hails)
      run.waiting.push(p);
    }
  }

  doorPoint(v) {
    const f = v.forward, kx = -f.z, kz = f.x;   // kerb side is the bus's -x: (-fz, fx)
    return { x: v.x + f.x * DOOR_Z + kx * (v.halfWid + 0.6), z: v.z + f.z * DOOR_Z + kz * (v.halfWid + 0.6), kx, kz };
  }

  walkToDoor(p) {
    const d = this.doorPoint(this.run.v);
    p.fare = 2; p.fx = d.x; p.fz = d.z; p.walkT = 0;
  }

  openDoors() {
    this.sign.doors.visible = true;
    if (this.audio && this.audio.ready) { this.audio.play('bus_doors', { gain: 0.55 }); this.audio.play('airbrake', { gain: 0.3 }); }
  }

  closeDoors() {
    this.sign.doors.visible = false;
    if (this.audio && this.audio.ready) this.audio.play('bus_doors', { gain: 0.45, rate: 1.08 });
  }

  chime() { if (this.audio && this.audio.ready) this.audio.play('bus_chime', { gain: 0.5 }); }

  release(p, away) {
    if (!p || !this.peds.peds.includes(p)) return;
    p.fare = 0;
    if (away) { this.peds.remove(p); return; }
    p.state = 'walk';
    this.peds.reanchor(p);
  }

  end(ok, msg) {
    const run = this.run;
    if (!run) return;
    for (const p of run.waiting) this.release(p, false);
    for (const p of run.boarding) this.release(p, false);
    this.sign.detach();
    this.run = null;
    this.armed = run.rt.id;
    this.hud.fare = null;
    this.panel.hide();
    this.hud.setObjective('');
    if (msg) this.hud.showToast(msg, 4200);
    if (!ok && this.audio && this.audio.ready) this.audio.ui('fail');
  }

  finish() {
    const run = this.run, rt = run.rt;
    const n = run.results.length;
    const stopPts = run.results.reduce((a, r) => a + r.pts, 0);
    const smooth = Math.max(0, Math.round(run.smooth));
    const score = Math.round(stopPts + smooth * 2);
    const max = (rt.stops.length - 1) * 130 + 200;
    const f = score / max;
    const grade = f > 0.86 ? 'A' : f > 0.72 ? 'B' : f > 0.55 ? 'C' : f > 0.35 ? 'D' : 'F';
    const pay = Math.round(run.served * BASE_PAY + score / 10);
    this.game.money += pay;
    this.stats.runs++; this.stats.stops += run.served; this.stats.earned += pay;
    const prev = this.best[rt.id];
    const better = !prev || score > prev.score;
    if (better) this.best[rt.id] = { score, grade };
    this.best.__stats = this.stats;
    try { localStorage.setItem(KEY, JSON.stringify(this.best)); } catch (e) { /* private mode */ }
    const onTime = run.results.filter((r) => r.d !== null && r.d <= LATE_OK && !r.leftEarly).length;
    const last = { route: rt.id, score, grade, pay, served: run.served, missed: run.missed, onTime, stops: n, smooth, events: { ...run.events }, results: run.results };
    window.__grtLast = last;
    this.last = last;
    this.end(true, `${rt.sign} done — grade ${grade} · ${score} pts · ${onTime}/${n} on time · smooth ${smooth}% · ${formatMoney(pay)}${better ? ' · NEW BEST' : ''}`);
    if (this.audio && this.audio.ready) this.audio.cash();
  }

  say(t, ms = 2400) { const run = this.run; if (run.sayCd > 0) return; run.sayCd = 2.5; this.hud.showToast(t, ms); }

  penalty(kind, n, msg) {
    const run = this.run;
    run.events[kind]++;
    run.smooth -= n;
    if (msg) this.say(msg);
    if (this.audio && this.audio.ready) this.audio.ui('tick');
  }

  onCrash(impact) {
    const run = this.run;
    if (!run || run.evCd > 0) return;
    if (impact >= 9) { run.evCd = 1.2; this.penalty('crash', 15, '“Hey! People are standing back here!”'); } else if (impact >= 4) { run.evCd = 0.8; this.penalty('bump', 5, '“Ow — easy!”'); }
  }

  onPedHit(byPlayer) {
    const run = this.run;
    // (a brush at walking pace by the door is not a hit: the riders walk right up to it)
    if (!run || !byPlayer || run.pedCd > 0 || Math.abs(run.v.vLong) < 2) return;
    run.pedCd = 2;
    this.penalty('ped', 40, 'You hit someone — GRT will hear about this');
  }

  // --- per frame ---------------------------------------------------------------

  update(dt, player) {
    for (let i = this.leavers.length - 1; i >= 0; i--) {
      const l = this.leavers[i];
      l.t += dt;
      if (l.t > 6 || !this.peds.peds.includes(l.p)) { this.release(l.p, false); this.leavers.splice(i, 1); }
    }
    const v = player.onFoot ? null : player.vehicle;
    if (!this.run) {
      if (!this.isBus(v)) { this.armed = null; return; }
      let near = null;
      for (const rt of this.routes) {
        const h = rt.home || rt.start;
        const d = Math.hypot(v.x - h.x, v.z - h.z);
        if (d < START_R) near = rt;
        else if (this.armed === rt.id && d > 80) this.armed = null;
      }
      if (near && this.armed !== near.id && Math.abs(v.vLong) < 2 && !this.game.dead && this.game.wanted < 3) this.start(near, v);
      return;
    }
    const run = this.run, rt = run.rt;
    if (this.game.dead) { this.end(false, 'Run over'); return; }
    if (v !== run.v) { this.end(false, 'You left the bus — the run is abandoned'); return; }
    if (v.dead) { this.end(false, 'The bus is wrecked — out of service'); return; }
    if (this.game.wanted >= 3) { this.end(false, 'Police on your tail — the bus is out of service'); return; }
    run.t += dt; run.evCd -= dt; run.sayCd -= dt; run.kerbCd -= dt; run.pedCd = (run.pedCd || 0) - dt;
    if (run.stage !== 'board') run.clock += dt;
    // where along the route
    const pr = this._progress(rt, v.x, v.z, run);
    if (pr) {
      if (pr.d > OFF_ROUTE) {
        run.offT += dt;
        if (pr.d > LOST || run.offT > 60) { this.end(false, `Off route — ${rt.sign} is out of service`); return; }
        if (run.offT > 1) this.say('Off route — follow the pink line on the map', 2000);
      } else { run.offT = 0; run.s = Math.max(run.s, pr.s - 2); }
    }
    this.ride(dt, v);
    if (run.stage === 'board' || run.stage === 'dwell') this.dwell(dt, v);
    else this.drive(dt, v);
    if (!this.run) return;
    this.hudUpdate(v);
  }

  /** Smoothness: hard braking and hard turns at speed, and kerb strikes. */
  ride(dt, v) {
    const run = this.run;
    const { along, lat } = (run.feel || (run.feel = new Feel())).step(dt, v);
    const sp = Math.abs(v.vLong);
    run.brakeT = (along * Math.sign(v.vLong || 1) < -HARD_BRAKE && sp > 4) ? run.brakeT + dt : 0;
    run.latT = (lat > HARD_LAT && sp > 5) ? run.latT + dt : 0;
    if (run.brakeT > HOLD_T && run.evCd <= 0) { run.evCd = 2.5; this.penalty('brake', 4, '“Whoa!” — standees stumble. Brake earlier'); }
    if (run.latT > HOLD_T && run.evCd <= 0) { run.evCd = 2.5; this.penalty('turn', 2, '“Hold on!” — take the corners gentler'); }
    // kerb strikes: a kerb-side wheel up on the pavement while moving
    run.kerbAcc += dt;
    if (run.kerbAcc > 0.2) {
      run.kerbAcc = 0;
      if (sp > 1.5 && run.kerbCd <= 0) {
        const f = v.forward, kx = -f.z, kz = f.x, w = v.halfWid - 0.15;
        for (const zz of [v.halfLen - 2.6, -v.halfLen + 3.4]) {
          const x = v.x + f.x * zz + kx * w, z = v.z + f.z * zz + kz * w;
          if (this.city.roadLift(x, z) > 0.3 && this.city.roadLift(v.x, v.z) < 0.25) {
            run.kerbCd = 3;
            this.penalty('kerb', 6, 'Kerb strike — watch your tail swing');
            break;
          }
        }
      }
    }
  }

  /** Between stops: the next stop's riders appear, the stop is served or missed. */
  drive(dt, v) {
    const run = this.run, rt = run.rt, i = run.i + 1, st = rt.stops[i], k = run.kerb[i];
    if (!run.spawned && rt.stops[i].at - run.s < 160) { run.spawned = true; this.spawnWaiting(i, false); }
    // served: stopped with the stop beside the front door, on the kerb side
    const f = v.forward, dx = k.x - v.x, dz = k.z - v.z;
    const al = dx * f.x + dz * f.z, lat = dx * -f.z + dz * f.x;   // + = kerb side
    if (Math.abs(v.vLong) < STOP_V && al > -SERVE_BEHIND && al < SERVE_AHEAD && lat > -2.5 && lat < SERVE_LAT) {
      run.stopT = (run.stopT || 0) + dt;
      if (run.stopT > 0.35) { this.arrive(v, al, lat); return; }
    } else run.stopT = 0;
    if (run.s > st.at + MISS_PAST) {
      run.missed++;
      run.results.push({ name: st.name, d: null, pts: 0, gap: null, missed: true });
      for (const p of run.waiting) this.release(p, false);
      run.waiting.length = 0;
      run.smooth -= 4;
      this.hud.showToast(`Missed ${st.name} — riders left at the stop`, 3000);
      if (this.audio && this.audio.ready) this.audio.ui('fail');
      // whoever was getting off there rides on to the next stop
      if (i + 1 < rt.stops.length) run.plan[i + 1].off += run.plan[i].off;
      run.i = i;
      if (i >= rt.stops.length - 1) this.finish(); else this.announce();
    }
  }

  arrive(v, al, lat) {
    const run = this.run, rt = run.rt, i = run.i + 1;
    const d = run.clock - rt.sched[i];
    // early is not scored on arrival: at a TIMEPOINT the bus holds for time
    // instead (the doors stay open), and leaving one early is what costs
    const punct = d > LATE_OK ? Math.max(0, 100 - (d - LATE_OK) * 0.8) : 100;
    const tp = this.timepoint(rt, i);
    run.holdUntil = tp && i < rt.stops.length - 1 ? rt.sched[i] - EARLY_OK : -1e9;
    // the kerb: how far the stop lies beyond the bus's kerb side
    const gap = Math.max(0, lat - v.halfWid);
    const kerb = gap < 3.2 ? 30 : gap < 6 ? 15 : 0;
    run.results.push({ name: rt.stops[i].name, d: Math.round(d), pts: Math.round(punct + kerb), gap: +gap.toFixed(1) });
    run.served++;
    run.i = i;
    run.stage = 'dwell';
    run.dwellT = 0;
    run.spawned = false;
    run.alightLeft = run.plan[i].off;
    run.alightT = 0.6;
    this.openDoors();
    if (!run.waiting.length && i < rt.stops.length - 1) this.spawnWaiting(i, true);
    run.boarding = run.waiting.splice(0);
    for (const p of run.boarding) this.walkToDoor(p);
    const late = d > LATE_OK ? ` — ${fmtDelta(d)}` : d < -EARLY_OK ? (tp ? ` — ${fmtDelta(d)}: timepoint, hold for time` : ` — ${fmtDelta(d)}`) : ' — on time';
    this.hud.showToast(`${rt.stops[i].name}${late}${kerb ? '' : ' · pull in to the kerb'}`, 2600);
  }

  /** Doors open: riders off, riders on, then the doors close and it's the next stop. */
  dwell(dt, v) {
    const run = this.run, rt = run.rt;
    run.dwellT += dt;
    // pulling away with the doors open
    if (Math.abs(v.vLong) > 1.6) {
      const left = run.boarding.length;
      if (run.clock < run.holdUntil - 2) {
        const r = run.results[run.results.length - 1];
        if (r) { r.pts = Math.max(0, r.pts - 40); r.leftEarly = Math.round(run.holdUntil - run.clock); }
        this.hud.showToast(`Left the timepoint ${Math.round(run.holdUntil - run.clock)} s early — riders downstream miss the bus`, 3000);
      }
      if (left) { run.events.left += left; run.smooth -= 5 * left; this.hud.showToast(`You pulled away — ${left} left at the stop`, 2600); }
      for (const p of run.boarding) this.release(p, false);
      run.boarding.length = 0;
      run.alightLeft = 0;
      this.closeDoors();
      this.depart();
      return;
    }
    const door = this.doorPoint(v);
    run.alightT -= dt;
    if (run.alightLeft > 0 && run.alightT <= 0) {
      run.alightLeft--; run.alightT = 0.8; run.lastOff = run.dwellT; run.aboard = Math.max(0, run.aboard - 1);
      const p = this.peds.spawnFareAt(door.x, door.z, v.y + 1, door.x + door.kx * 9 + v.forward.x * (Math.random() * 8 - 4), door.z + door.kz * 9 + v.forward.z * (Math.random() * 8 - 4));
      this.leavers.push({ p, t: 0 });
    }
    for (let j = run.boarding.length - 1; j >= 0; j--) {
      const p = run.boarding[j];
      if (!this.peds.peds.includes(p) || p.state === 'down') { run.boarding.splice(j, 1); continue; }
      p.walkT = (p.walkT || 0) + dt;
      p.fx = door.x; p.fz = door.z;
      if (Math.hypot(p.x - door.x, p.z - door.z) < 1.2 || p.walkT > 9) {
        this.peds.remove(p); run.boarding.splice(j, 1); run.aboard++;
        if (this.audio && this.audio.ready) this.audio.ui('check');
      }
    }
    if (!run.boarding.length && run.alightLeft <= 0 && run.dwellT > 2.5 && run.dwellT - (run.lastOff || -9) > 1.6 && run.clock >= run.holdUntil) {
      if (run.i >= rt.stops.length - 1) { this.closeDoors(); this.finish(); return; }
      this.closeDoors();
      this.depart();
    }
  }

  /** A timepoint: a station or terminal, every third stop, and the last. */
  timepoint(rt, i) { return i === rt.stops.length - 1 || i % 3 === 0 || /Station|Terminal/.test(rt.stops[i].name); }

  depart() {
    const run = this.run;
    run.stage = 'drive';
    run.stopT = 0;
    this.announce();
  }

  /** "Next stop: ..." -- the chime, the toast, the route and pin on the maps. */
  announce() {
    const run = this.run, rt = run.rt, ni = run.i + 1;
    run.spawned = false;
    if (ni >= rt.stops.length) return;
    const st = rt.stops[ni];
    this.hud.fare = { hail: null, dest: st, route: this.routeFrom(rt, run.s) };
    this.chime();
    this.hud.showToast(`Next stop: ${st.name}`, 2600);
  }

  hudUpdate(v) {
    const run = this.run, rt = run.rt;
    run.hudCd = (run.hudCd || 0) - 1;
    if (run.hudCd > 0) return;
    run.hudCd = 8;
    const ni = Math.min(rt.stops.length - 1, run.i + (run.stage === 'drive' ? 1 : 0));
    const st = rt.stops[ni];
    // schedule: where the timetable says the bus should be at this point
    const prevAt = rt.stops[run.i].at, nextAt = rt.stops[Math.min(rt.stops.length - 1, run.i + 1)].at;
    let due;
    if (run.stage === 'drive') {
      const f = clamp((run.s - prevAt) / Math.max(1, nextAt - prevAt), 0, 1);
      due = rt.sched[run.i] + (run.i > 0 ? DWELL_SCHED : 0) + f * (rt.sched[run.i + 1] - rt.sched[run.i] - (run.i > 0 ? DWELL_SCHED : 0));
    } else due = rt.sched[run.i];
    const delta = run.clock - due;
    const dist = Math.max(0, st.at - run.s);
    const top = `${rt.sign} → ${rt.head}`;
    const hold = run.stage === 'dwell' && run.clock < run.holdUntil ? Math.ceil(run.holdUntil - run.clock) : 0;
    const mid = run.stage === 'board' ? 'Boarding — doors open' : hold ? `Holding for time — ${hold} s` : run.stage === 'dwell' ? `${rt.stops[run.i].name} — doors open` : `Next: ${st.name}${this.timepoint(rt, ni) ? ' ⏱' : ''}`;
    const bot = `${run.stage === 'drive' ? `${dist > 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist / 10) * 10 + ' m'} · ` : ''}stop ${Math.min(run.i + 1, rt.stops.length - 1)}/${rt.stops.length - 1} · ${fmtDelta(delta)} · smooth ${Math.max(0, Math.round(run.smooth))}%`;
    this.panel.show(top, mid, bot, rt.express ? BADGE.express : BADGE.local);
    if (run.stage === 'drive' && this.hud.fare) { this.hud.fare.route = this.routeFrom(rt, run.s); this.hud.fare.dest = st; }
  }
}
