// Auto KW: PARAMEDIC CALLS -- Region of Waterloo Paramedic Services, GTA's Paramedic.
//
// An ambulance (white, the Region's yellow-green and navy Battenburg band, PARAMEDIC
// on the module, vehicles.js `ambulance`) stands on the apron by the ER at Grand
// River (WRHN @ Midtown), St. Mary's (WRHN @ Queen's Blvd) and Cambridge Memorial,
// and at the Paramedic Services North HQ (OSM positions; the ER bays are where
// kwlandmarks2.js paints them). Climb in and press MISSION (M, the pad's D-pad
// down, or the touch button beside the pad): the siren goes on and level 1 calls
// one patient, lying on the grass at a real address (data/eats.json's addressed
// homes, 0.5-1.7 km off). Stop within 16 m and they are loaded (two stretchers).
// Drive to the nearest emergency entrance -- a beam marks it -- and stop in the
// bay. Level n calls n patients (to four), a clock to match.
//
//   - PATIENTS have health. They lose a little waiting and in the back, and a lot
//     to rough driving (the same lateral / braking g as the KW Eats bag, grtbus.js
//     Feel) and crashes (onCrash). At 0 you lose them; lose them all and the shift
//     ends. Pay is $90 + $35 a level per patient scaled by how they arrived, plus a
//     time bonus for clearing the call. Best level in localStorage `autokw-paramedic`.
//   - MISSION again, or leaving the ambulance, stands the crew down.
//
// Phone cost: nothing but the parked ambulances (traffic's, 'apron') until a call;
// then per patient one pooled humanoid + one beam, and one beam at the hospital.
//
// Harness: __dbg.paramedic (`call`, `stations`, `begin()`, `stats`), the probe is
// tools/kw/medprobe.mjs.

import * as THREE from './three.js';
import * as G from './geo.js';
import { makeHumanoid, sprawl } from './peds.js';
import { Feel } from './grtbus.js';
import { clamp, formatMoney } from './util.js';

const KEY = 'autokw-paramedic';
const LOAD_R = 16, LOAD_T = 1.8, STOP_V = 2.0;
const DROP_R = 22;
const CAPACITY = 2;
const DIST_MIN = 450, DIST_MAX = 1700;

// Real places (OSM, tools/data/kw/raw_pois.json); ER bays = the EMERGENCY doors of kwlandmarks2.js, ~10 m out.
export const MED_STATIONS = [
  { name: 'Grand River Hospital · WRHN @ Midtown', x: -3134, z: -470, rigs: ['ambulance'] },
  { name: "St. Mary's General · WRHN @ Queen's Blvd", x: -2138, z: 1615, rigs: ['ambulance'] },
  { name: 'Cambridge Memorial Hospital', x: 11989, z: 8259, rigs: ['ambulance'] },
  { name: 'Region of Waterloo Paramedic Services · North HQ', x: -8944.7, z: 1375.5, rigs: ['ambulance'] },
];
export const ER_BAYS = [
  { name: 'Grand River ER', x: -3134, z: -470 },
  { name: "St. Mary's ER", x: -2138, z: 1615 },
  { name: 'Cambridge Memorial ER', x: 11989, z: 8259 },
];

function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
const fmt = (d) => (d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m');

export function callSpec(L) {
  return { level: L, count: Math.min(4, L), pay: 90 + 35 * L };
}

export class Paramedics {
  /** o: { scene, city, game, hud, audio, traffic, controls, panel, homes: () => [{x,z,addr}], stations } */
  constructor(o) {
    this.o = o;
    this.scene = o.scene; this.city = o.city; this.game = o.game; this.hud = o.hud; this.audio = o.audio;
    this.stations = o.stations || [];
    this.level = 1;
    this.call = null;
    this.nextT = 0;
    this.stats = Object.assign({ best: 0, delivered: 0, lost: 0, earned: 0 }, read());
    this._was = false;
    this._sirenV = null;
    this._obj = '';
    this.dest = null;
    this.beamGeo = new THREE.CylinderGeometry(2.4, 2.4, 40, 14, 1, true).translate(0, 20, 0);
    this.redMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.3, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false });
    this.blueMat = new THREE.MeshBasicMaterial({ color: 0x2ea8ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false });
    this.erBeam = new THREE.Mesh(this.beamGeo, this.blueMat);
    this.erBeam.visible = false; this.erBeam.frustumCulled = false;
    this.scene.add(this.erBeam);
  }

  spawnRigs() {
    const T = this.o.traffic;
    for (const st of this.stations) {
      st.rigVs = [];
      for (const sp of st.spots) {
        const v = T.spawnAt(sp.x, sp.z, sp.heading, 'ambulance', 0xf4f4f0, 'apron');
        v.vLong = 0;
        st.rigVs.push(v);
      }
    }
  }

  places() {
    return this.stations.filter((s) => s.spots.length).map((s) => {
      const sp = s.spots[0];
      return { x: sp.x, z: sp.z, kind: 'medic', label: true, name: s.name.replace(' · ', ' — '), near: false,
        hello: `${s.name.split(' · ')[0]} — an ambulance on the apron. Climb in and press MISSION for a paramedic call` };
    });
  }

  warmMeshes() {
    const m = new THREE.Mesh(this.beamGeo, this.redMat); m.frustumCulled = false;
    const n = new THREE.Mesh(this.beamGeo, this.blueMat); n.frustumCulled = false;
    return [m, n];
  }

  inAmb(player) {
    const v = player.vehicle;
    return !!(v && !player.onFoot && v.spec.paramedic && !v.dead);
  }

  save() {
    const s = this.stats;
    if (this.level - 1 > s.best) s.best = this.level - 1;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
  }

  jobRows() {
    const s = this.stats;
    return [{ name: 'Paramedic calls', sub: 'an ambulance at Grand River, St. Mary\'s or Cambridge Memorial', best: s.best ? `level ${s.best} · ${s.delivered} patients · ${formatMoney(s.earned)}` : null,
      medal: s.best >= 5 ? 'gold' : s.best >= 3 ? 'silver' : s.best ? 'bronze' : null }];
  }

  setSiren(player, on) {
    const v = player.vehicle;
    if (!v || !this.game.setSiren) return;
    this.game.setSiren(v, on);
  }

  /** Pick the call's patients: real addressed homes, spread along a chain from the ambulance. */
  pickPatients(S, p) {
    const homes = this.o.homes ? this.o.homes() : [];
    const out = [];
    let ax = p.x, az = p.z;
    for (let k = 0; k < S.count; k++) {
      let got = null;
      for (let i = 0; i < 120 && homes.length && !got; i++) {
        const h = homes[Math.floor(Math.random() * homes.length)];
        const d = Math.hypot(h.x - ax, h.z - az);
        if (d < (k ? 200 : DIST_MIN) || d > (k ? 1100 : DIST_MAX)) continue;
        const sp = this.city.respawnPointNear(h.x, h.z, 70);
        if (!sp || sp.elev) continue;
        // lying on the lawn between the door and the kerb, on the kerb side of the house
        let x = h.x + (sp.x - h.x) * 0.7, z = h.z + (sp.z - h.z) * 0.7;
        const y = this.city.groundAt(x, z, null);
        if (this.city.insideBuilding(x, z, y, 0.8)) { x = sp.x; z = sp.z; }
        if (G.isWater(x, z) || out.some((q) => Math.hypot(q.x - x, q.z - z) < 60)) continue;
        got = { x, z, addr: h.addr || 'a nearby address', kx: sp.x, kz: sp.z };
      }
      if (!got) break;
      out.push(got);
      ax = got.x; az = got.z;
    }
    return out;
  }

  makePatient(q, seed) {
    const h = makeHumanoid({ seed });
    const g = h.group;
    g.rotation.x = -Math.PI / 2 * 0.97;
    g.rotation.y = Math.random() * Math.PI * 2;
    const y = this.city.groundAt(q.x, q.z, null);
    g.position.set(q.x, y + 0.12, q.z);
    sprawl(h, 1);
    this.scene.add(g);
    const b = new THREE.Mesh(this.beamGeo, this.redMat);
    b.position.set(q.x, y, q.z); b.frustumCulled = false;
    this.scene.add(b);
    return { ...q, y, h, beam: b, health: 100, state: 'wait', load: 0 };
  }

  begin(player) {
    const S = callSpec(this.level);
    const p = player.position;
    const list = this.pickPatients(S, p);
    if (!list.length) { this.hud.showToast('No calls right now — try the ambulance from a busier part of town', 3200); return false; }
    const pts = list.map((q, i) => this.makePatient(q, 4100 + i * 17 + this.level));
    // the clock: the chain of drives, a minute of margin and a half a minute a stretcher
    let route = 0, ax = p.x, az = p.z;
    for (const q of pts) { route += Math.hypot(q.x - ax, q.z - az); ax = q.x; az = q.z; }
    const er = this.nearestER(ax, az);
    route += Math.hypot(er.x - ax, er.z - az);
    const T = Math.round((route * 1.45) / 10 + 60 + 25 * pts.length) * (1 - Math.min(0.2, 0.03 * this.level));
    this.call = { S, pts, T, left: T, t: 0, loaded: [], paid: 0, delivered: 0, feel: new Feel(), air: 0, cd: 0, er: null };
    this._wasObj = this.hud.objective ? this.hud.objective.textContent : '';
    const sv = player.vehicle;
    if (sv && !sv.sirenOn) { this._sirenV = sv; this.setSiren(player, true); }
    this.hud.showToast(`Paramedic call, level ${this.level}: ${pts.length} patient${pts.length > 1 ? 's' : ''} — first at ${pts[0].addr}`, 3800);
    if (this.audio && this.audio.ready) this.audio.ui('start');
    this.setBtn(true);
    return true;
  }

  nearestER(x, z) {
    let best = ER_BAYS[0], bd = Infinity;
    for (const e of ER_BAYS) { const d = Math.hypot(e.x - x, e.z - z); if (d < bd) { bd = d; best = e; } }
    return best;
  }

  end(msg, fail, player) {
    const C = this.call;
    if (C) for (const q of C.pts) this.dropPatient(q);
    this.call = null; this.nextT = 0;
    this.erBeam.visible = false;
    this.hud.fare = null;
    if (this.o.panel) this.o.panel.hide();
    this.setBtn(false);
    const sv = this._sirenV; this._sirenV = null;
    if (sv && sv.sirenOn && this.game.setSiren) this.game.setSiren(sv, false);
    if (this.hud.objective && this.hud.objective.textContent === this._obj) this.hud.setObjective(this._wasObj || '');
    this._obj = '';
    if (msg) this.hud.showToast(msg, 3600);
    if (fail && this.audio && this.audio.ready) this.audio.ui('fail');
  }

  dropPatient(q) {
    if (q.h) {
      this.scene.remove(q.h.group);
      q.h.dispose();
      q.h = null;
    }
    if (q.beam) { this.scene.remove(q.beam); q.beam = null; }
  }

  /** A crash (main.js game.onCrash): the stretchers feel it. */
  onCrash(impact) {
    const C = this.call;
    if (!C || !C.loaded.length || C.cd > 0 || impact < 4) return;
    C.cd = 0.8;
    this.hurt(C.loaded, Math.min(40, impact * 1.6));
  }

  hurt(list, n) {
    for (const q of list) {
      if (q.state !== 'loaded') continue;
      q.health -= n;
      if (q.health <= 0) this.lose(q);
    }
  }

  lose(q) {
    const C = this.call;
    q.health = 0; q.state = 'lost';
    this.stats.lost++;
    const i = C.loaded.indexOf(q);
    if (i >= 0) C.loaded.splice(i, 1);
    this.dropPatient(q);
    this.hud.showToast(`You lost the patient from ${q.addr}`, 3000);
    if (this.audio && this.audio.ready) this.audio.ui('fail');
  }

  update(dt, player) {
    const c = this.o.controls, app = this._app || (this._app = document.getElementById('app'));
    const inA = this.inAmb(player);
    if (app && (app.dataset.medic === '1') !== inA) app.dataset.medic = inA ? '1' : '';
    const down = !!(c && inA && (c.btn.medmission || c.key('KeyM') || (c._padHeld && c._padHeld.job)));
    if (down && !this._was) this.toggle(player);
    this._was = down;
    if (!this.call && this.nextT <= 0) return;
    if (this.game.dead) { this.end('Shift over', true, player); return; }
    if (!inA) { this.end('You left the ambulance — crew stood down', true, player); return; }
    if (this.nextT > 0) {
      this.nextT -= dt;
      this.setObj(`Paramedic L${this.level} — stand by for the next call`);
      if (this.nextT <= 0) { this.nextT = 0; if (!this.begin(player)) this.end('', false, player); }
      return;
    }
    this.run(dt, player);
  }

  toggle(player) {
    if (this.call || this.nextT > 0) { this.end('Crew stood down', false, player); return; }
    if (!this.inAmb(player)) return;
    if (this.game.wanted > 0) { this.hud.showToast('Lose your wanted level first', 2400); return; }
    this.level = 1;
    this.begin(player);
  }

  run(dt, player) {
    const C = this.call, v = player.vehicle, p = player.position, game = this.game;
    C.t += dt; C.left -= dt; C.cd -= dt;
    if (C.left <= 0) { this.stats.best = Math.max(this.stats.best, this.level - 1); this.save(); this.end(`Out of time — the call is lost. You reached level ${this.level}`, true, player); return; }
    // the patients' health
    const { along, lat } = C.feel.step(dt, v);
    for (const q of C.pts) {
      if (q.state === 'wait') { q.health -= 0.12 * dt; if (q.health <= 0) this.lose(q); }
    }
    if (C.loaded.length) {
      let loss = 0.07 * dt;
      if (Math.abs(v.vLong) > 3) {
        if (lat > 5) loss += (lat - 5) * 0.8 * dt;
        const dec = -along * Math.sign(v.vLong);
        if (dec > 7) loss += (dec - 7) * 0.7 * dt;
      }
      if (v.airborne) C.air += dt; else { if (C.air > 0.35) loss += 8 + C.air * 12; C.air = 0; }
      this.hurt([...C.loaded], loss);
      C.rough = (C.rough || 0) + loss;
    }
    // load: stopped by a stretcher
    const slow = Math.abs(v.vLong) < STOP_V;
    for (const q of C.pts) {
      if (q.state !== 'wait') continue;
      q.beam.rotation.y += dt * 0.7;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < LOAD_R && slow && C.loaded.length < CAPACITY) {
        q.load += dt;
        if (q.load >= LOAD_T) {
          q.state = 'loaded'; C.loaded.push(q);
          this.dropPatient(q);
          if (this.audio && this.audio.ready) { this.audio.play('door_close', { gain: 0.5 }); this.audio.ui('check'); }
          this.hud.showToast(`Patient loaded at ${q.addr} — ${C.loaded.length} aboard`, 2200);
          if (!C.er) C.er = this.nearestER(p.x, p.z);
        }
      } else q.load = Math.max(0, q.load - dt);
    }
    // deliver
    if (C.loaded.length && C.er) {
      const d = Math.hypot(C.er.x - p.x, C.er.z - p.z);
      if (d < DROP_R && slow) { this.deliver(player); if (!this.call) return; }
    }
    // what is left to do
    const waiting = C.pts.filter((q) => q.state === 'wait');
    if (!waiting.length && !C.loaded.length) {
      if (!C.delivered) { this.end(`All patients lost — level ${this.level}`, true, player); return; }
      const bonus = Math.round(C.S.pay * 0.25 * clamp(C.left / C.T, 0, 1));
      game.money += bonus;
      this.stats.earned += bonus;
      this.hud.showToast(`Call cleared — ${formatMoney(C.paid + bonus)} (time bonus ${formatMoney(bonus)})`, 3600);
      if (this.audio && this.audio.ready) this.audio.cash();
      this.level++;
      this.save();
      this.dropAll();
      this.nextT = 4;
      return;
    }
    // map + beams + panel
    const tgt = C.loaded.length && (C.loaded.length >= CAPACITY || !waiting.length) ? 'er' : waiting.length ? 'pt' : 'er';
    let hail = null, dest = null, line;
    const hp = Math.round(C.loaded.reduce((a, q) => a + q.health, 0) / (C.loaded.length || 1));
    if (tgt === 'er' && C.er) {
      dest = { x: C.er.x, z: C.er.z };
      const d = Math.hypot(C.er.x - p.x, C.er.z - p.z);
      line = `Take ${C.loaded.length} to ${C.er.name} · ${fmt(d)}`;
    } else {
      let near = waiting[0], bd = Infinity;
      for (const q of waiting) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; near = q; } }
      hail = { x: near.x, z: near.z };
      line = `Patient at ${near.addr} · ${fmt(bd)}`;
    }
    if (C.er && C.loaded.length) {
      this.erBeam.position.set(C.er.x, this.city.groundAt(C.er.x, C.er.z, null), C.er.z);
      this.erBeam.visible = true;
      if (!dest) { dest = { x: C.er.x, z: C.er.z }; }
    } else this.erBeam.visible = false;
    for (const q of C.pts) if (q.beam) q.beam.position.y = q.y;
    this.hud.fare = { hail, dest, route: null };
    const tl = `${Math.floor(C.left / 60)}:${String(Math.floor(C.left % 60)).padStart(2, '0')}`;
    const stat = C.loaded.length ? ` · aboard ${hp}%` : '';
    this.setObj(`Paramedic L${this.level}: ${line} · ${tl}`);
    if (this.o.panel) this.o.panel.show(`PARAMEDIC · LEVEL ${this.level}`, line, `${tl} · ${C.delivered}/${C.pts.length} delivered${stat}`, '#0d9f6a');
  }

  dropAll() {
    const C = this.call;
    if (C) for (const q of C.pts) this.dropPatient(q);
    this.call = null;
    this.erBeam.visible = false;
    this.hud.fare = null;
    if (this.o.panel) this.o.panel.hide();
  }

  deliver(player) {
    const C = this.call, game = this.game;
    let pay = 0;
    for (const q of C.loaded) {
      const p = Math.round(C.S.pay * (0.4 + 0.6 * clamp(q.health / 100, 0, 1)));
      pay += p;
      C.delivered++;
      this.stats.delivered++;
      q.state = 'done';
    }
    const n = C.loaded.length;
    C.loaded.length = 0;
    C.er = null;
    C.paid += pay;
    game.money += pay;
    this.stats.earned += pay;
    this.save();
    this.last = { pay, n, level: this.level, left: Math.round(C.left) };
    window.__medLast = this.last;
    this.hud.showToast(`${n} patient${n > 1 ? 's' : ''} handed over — ${formatMoney(pay)}`, 3200);
    if (this.audio && this.audio.ready) this.audio.cash();
  }

  setBtn(on) {
    if (typeof document === 'undefined') return;
    const b = document.querySelector('[data-btn="medmission"]');
    if (b) b.classList.toggle('on', on);
  }

  setObj(t) {
    if (t === this._obj) return;
    this._obj = t;
    this.hud.setObjective(t);
  }
}
