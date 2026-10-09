// Police missions: GTA's "vigilante", from a police vehicle's MISSION button.
//
// A suspect vehicle is reported fleeing a few blocks away. Chase it (a red
// marker over it, and on the minimap) and take it down: ram it until it is
// wrecked, or until it stops and you pull up beside it; or get out and shoot
// it. Each one cleared pays and starts the next, harder: from level 2 a time
// limit, from 3 the driver shoots back, from 4 two cars at once, and every
// level a faster, tougher car. MISSION again, or leaving the vehicle, ends
// the run. See "Police missions" in CLAUDE.md.

import * as THREE from './three.js';
import * as G from './geo.js';
import { clamp, formatMoney } from './util.js';
import { getaway, getawayState } from './getaway.js';
import { WEAPONS } from './police.js';

const ESCAPE_R = 650;      // this far ahead of you for ESCAPE_T s: it got away
const ESCAPE_T = 12;
const STOP_R = 22;         // stopped this close to you: pulled over
const STOP_T = 2.2;
const KEY = 'auto-vigilante-best';
const IDLE = { throttle: 0, brake: 1, steer: 0, handbrake: 0 };

/** What level n asks of you. */
export function missionSpec(n) {
  const L = Math.max(1, n | 0);
  return {
    level: L,
    count: L >= 4 ? 2 : 1,
    shoots: L >= 3,
    time: L >= 2 ? (L >= 4 ? 200 : 160) : 0,
    // flight speed (m/s) and how much ramming it takes
    speed: Math.min(34, 19 + L * 2.5),
    // a ram does 0.7 x the closing speed (traffic.js): ~10 for a hard one
    hp: Math.min(110, 30 + L * 8),
    types: L <= 1 ? ['sedan', 'hatch', 'compact'] : L <= 3 ? ['sedan', 'suv', 'muscle', 'pickup'] : ['muscle', 'sports', 'suv', 'ev'],
    pay: 350 + L * 250,
  };
}

export class PoliceMissions {
  constructor({ scene, city, game, traffic, police, hud, audio }) {
    this.scene = scene; this.city = city; this.game = game; this.traffic = traffic;
    this.police = police; this.hud = hud; this.audio = audio;
    this.level = 1;
    this.best = 0;
    try { this.best = +localStorage.getItem(KEY) || 0; } catch (e) { /* private mode */ }
    this.run = null;          // the mission in progress
    this.nextT = 0;           // seconds until the next one is dispatched
    this._objTxt = '';
    this.stats = { started: 0, cleared: 0, failed: 0 };
    // the marker over a suspect: a red arrowhead pointing down at it, shared
    const g = new THREE.ConeGeometry(0.7, 1.4, 4, 1);
    g.rotateX(Math.PI);
    this.markGeo = g;
    this.markMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    traffic.suspectDriver = (v, dt, px, pz) => this.drive(v, dt, px, pz);
  }

  /** Stand-ins for the warm-up frames (main.js): the marker's material. */
  warmMeshes() { const m = new THREE.Mesh(this.markGeo, this.markMat); m.frustumCulled = false; return [m]; }

  /** Is the player at the wheel of something that can run missions? */
  available(player) {
    const v = player.vehicle;
    return !!(v && !player.onFoot && v.spec.police);
  }

  /** MISSION: start one, or quit the one running. */
  toggle(player) {
    if (this.run || this.nextT > 0) { this.end(false, 'Police mission cancelled'); return; }
    if (!this.available(player)) { this.hud.showToast('Police missions need a police vehicle'); return; }
    if (this.game.wanted > 0) { this.hud.showToast('Lose your wanted level first'); return; }
    this.level = 1;
    this.start(player);
  }

  start(player) {
    const S = missionSpec(this.level);
    const p = player.position;
    const city = this.city, T = this.traffic;
    // the report: a street 260-480 m off, not a freeway, ramp, deck, bore or
    // residential street
    let spot = null;
    const pool = city.edgesNear(p.x, p.z, 520);
    for (let i = 0; i < 160 && !spot; i++) {
      const ei = pool[Math.floor(Math.random() * pool.length)];
      const e = city.edges[ei];
      // (a residential street only where there is nothing else: the first 80 tries)
      if (!e || e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp' || (e.cls === 'res' && i < 80) || e.noTraffic) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < 260 || d > 480) continue;
      if (T.wet && T.wet(x, z)) continue;
      // away from you, along the street
      const sg = Math.hypot(b.x - p.x, b.z - p.z) > Math.hypot(a.x - p.x, a.z - p.z) ? 1 : -1;
      // ...toward a junction, not a dead end (a suspect started into a cul-de-sac
      // spent its first seconds turning round)
      const far = city.nodes[sg > 0 ? e.b : e.a];
      if (!far || far.e.length < 3) continue;
      spot = { x, z, h: Math.atan2(e.dx * sg, e.dz * sg), node: sg > 0 ? e.b : e.a, prev: sg > 0 ? e.a : e.b, ei };
    }
    if (!spot) {
      const msg = 'No suspects nearby — try somewhere with more streets';
      if (this._objWas !== undefined) this.end(false, msg); else this.hud.showToast(msg);
      return;
    }
    const suspects = [];
    for (let k = 0; k < S.count; k++) {
      const type = S.types[Math.floor(Math.random() * S.types.length)];
      const back = k * 9;
      const x = spot.x - Math.sin(spot.h) * back, z = spot.z - Math.cos(spot.h) * back;
      const v = T.spawnAt(x, z, spot.h, type, [0x8a1d1d, 0x1f1f22, 0xc9c2b4, 0x23395b][k % 4], 'suspect');
      v.health = S.hp;
      v.vLong = 12;
      // the getaway driver's state, and the mission's own: shooting back,
      // how long it has been out of reach, taken down, its marker
      v.suspect = Object.assign(getawayState(spot.node, spot.prev, S.speed * (1 - k * 0.04), S.hp * 0.4), {
        shoots: S.shoots, farT: 0, down: false, mark: null, bob: Math.random() * 6,
      });
      const m = new THREE.Mesh(this.markGeo, this.markMat);
      m.frustumCulled = false;
      this.scene.add(m);
      v.suspect.mark = m;
      suspects.push(v);
    }
    this.run = { S, suspects, t: 0, left: S.time, place: G.placeNameAt(spot.x, spot.z) };
    this.stats.started++;
    if (this._objWas === undefined) this._objWas = this.hud.objective ? this.hud.objective.textContent : '';
    this.hud.showToast(`${S.count > 1 ? 'Two suspects' : 'Suspect'} fleeing near ${this.run.place} — ram ${S.count > 1 ? 'them' : 'it'} off the road`, 3600);
    if (this.audio) this.audio.ui('start');
    // (the run turns the siren on only if it was off, and turns it off again at the end)
    const sv = player.vehicle;
    if (sv && !sv.sirenOn && !this._sirenV) this._sirenV = sv;
    this.setSiren(player, true);
    this.setBtn(true);
  }

  /** Lights and siren on the player's own unit for the run (main.js's
   *  SIREN switch: `sirenOn`, traffic.policeLights, and traffic ahead yields). */
  setSiren(player, on) {
    const v = player.vehicle;
    if (!v) return;
    if (this.game.setSiren) this.game.setSiren(v, on);
    else if ('sirenOn' in v) v.sirenOn = on;
  }

  end(ok, msg) {
    const run = this.run;
    if (run) {
      for (const v of run.suspects) {
        if (v.suspect && v.suspect.mark) { this.scene.remove(v.suspect.mark); v.suspect.mark = null; }
        // a suspect left behind is just a car now (a wreck stays a wreck)
        if (this.traffic.cars.includes(v) && v.mode === 'suspect') v.mode = 'free';
        v.suspect = null;
      }
    }
    this.run = null;
    this.nextT = 0;
    this.setBtn(false);
    this.hud.suspects = null;
    const sv = this._sirenV;
    this._sirenV = null;
    if (sv && sv.sirenOn) { if (this.game.setSiren) this.game.setSiren(sv, false); else sv.sirenOn = false; }
    // the line goes back only if it is still ours (a delivery may have written its own since)
    if (this._objTxt === undefined || this._objTxt === '' || (this.hud.objective && this.hud.objective.textContent === this._objTxt)) this.hud.setObjective(this._objWas || '');
    this._objWas = undefined;
    this._objTxt = '';
    if (msg) this.hud.showToast(msg, 3200);
    if (!ok && run) { this.stats.failed++; if (this.audio) this.audio.ui('fail'); }
  }

  update(dt, player) {
    if (!this.run && this.nextT <= 0) return;
    const game = this.game;
    if (game.dead) { this.end(false, `Police mission failed — level ${this.level}`); return; }
    if (!this.available(player)) { this.end(false, 'You left the police vehicle — mission over'); return; }
    if (this.nextT > 0) {
      // between levels: the next call comes in
      this.nextT -= dt;
      this.setObj(`Police missions · level ${this.level} — stand by for the next call`);
      if (this.nextT <= 0) this.start(player);
      return;
    }
    const run = this.run, S = run.S, p = player.position;
    run.t += dt;
    if (S.time) {
      run.left -= dt;
      if (run.left <= 0) { this.end(false, `Out of time — the suspect got away. Reached level ${this.level}`); return; }
    }
    let alive = 0, nearest = Infinity;
    for (const v of run.suspects) {
      const s = v.suspect;
      if (!s) continue;
      if (!s.down) {
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        // taken down: wrecked, removed, or stopped with you on it
        const gone = !this.traffic.cars.includes(v);
        if (v.dead || gone) s.down = true;
        else {
          if (Math.abs(v.vLong) < 1.2 && d < STOP_R) s.stopT += dt; else s.stopT = Math.max(0, s.stopT - dt);
          if (s.stopT > STOP_T) s.down = true;
          if (d > ESCAPE_R) s.farT += dt; else s.farT = 0;
          if (s.farT > ESCAPE_T) { this.end(false, `The suspect got away. Reached level ${this.level}`); return; }
        }
        if (s.down) {
          if (this.audio) this.audio.ui('check');
          this.hud.showToast(v.dead ? 'Suspect vehicle destroyed' : 'Suspect apprehended', 1800);
          if (!v.dead && !gone) { v.mode = 'free'; v.vLong *= 0.5; }
          if (s.mark) { this.scene.remove(s.mark); s.mark = null; }
          continue;
        }
        alive++;
        nearest = Math.min(nearest, d);
        // shooting back, out of the window, from level 3
        if (s.shoots && d < WEAPONS.suspect.range && this.police) {
          this.police.tickGun(v, WEAPONS.suspect, dt, v.x, v.y + 1.3, v.z, true);
        }
        if (s.mark) {
          s.bob += dt * 3;
          s.mark.position.set(v.x, v.y + v.spec.roof + 2.4 + Math.sin(s.bob) * 0.3, v.z);
          s.mark.rotation.y += dt * 2;
          const k = clamp(d / 60, 1, 6);   // reads from a block away
          s.mark.scale.setScalar(k);
        }
      }
    }
    this.hud.suspects = run.suspects.filter((v) => v.suspect && !v.suspect.down);
    if (!alive) {
      // cleared: pay, a time bonus, and the next level
      const bonus = S.time ? Math.round(S.pay * 0.3 * clamp(run.left / S.time, 0, 1)) : 0;
      const pay = S.pay + bonus;
      game.money += pay;
      this.stats.cleared++;
      if (this.level > this.best) { this.best = this.level; try { localStorage.setItem(KEY, String(this.best)); } catch (e) { /* private */ } }
      if (this.audio) this.audio.cash();
      this.hud.showToast(`Level ${this.level} cleared — ${formatMoney(pay)}${bonus ? ` (time bonus ${formatMoney(bonus)})` : ''}`, 3600);
      for (const v of run.suspects) v.suspect = null;
      this.run = null;
      this.hud.suspects = null;
      this.level++;
      this.nextT = 4;
      return;
    }
    const tm = S.time ? ` · ${Math.floor(run.left / 60)}:${String(Math.floor(run.left % 60)).padStart(2, '0')}` : '';
    const dm = nearest < Infinity ? ` · ${nearest > 1000 ? (nearest / 1000).toFixed(1) + ' km' : Math.round(nearest / 10) * 10 + ' m'}` : '';
    this.setObj(`Police L${this.level}: take down ${alive > 1 ? `${alive} suspects` : 'the suspect'}${tm}${dm}`);
  }

  /** MISSION lit red while a run is on (the press then quits it). */
  setBtn(on) {
    if (typeof document === 'undefined') return;
    const b = document.querySelector('[data-btn="policemission"]');
    if (b) b.classList.toggle('on', on);
  }

  setObj(t) {
    if (t === this._objTxt) return;
    this._objTxt = t;
    this.hud.setObjective(t);
  }

  /** The suspect's driving (traffic.js calls this for mode 'suspect'): the
   *  getaway driver (getaway.js), fleeing you. */
  drive(v, dt, px, pz) {
    return v.suspect ? getaway(this.city, this.traffic, v, v.suspect, dt, px, pz) : IDLE;
  }
}
