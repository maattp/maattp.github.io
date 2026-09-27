// HOCKEY NIGHT at Climate Pledge Arena: a marquee outside the south atrium on
// Thomas St, and ENTER there drops you straight into a game -- SEATTLE against
// VANCOUVER, three 2:30 periods, the puck dropped as the lights come up. No
// menus. The game is hockeygame.js; this is its screen, pad and sound.
//
// The screen is 16-bit in spirit: a 400 x 225 canvas scaled up pixel-sharp,
// the rink across it (x along the screen, a 3/4 view squashing the width),
// scrolling with the puck, stands of pixel crowd behind the far boards, the
// ads on the dasher, and every skater drawn from rectangles each frame -- a
// stride, a stick, a number on the back, a goalie's pads -- with a marker
// under the one you control. The scoreboard, the clock and the messages use
// the 3x5 pixel font the other games use.
//
// The pad: a thumb stick anywhere on the left half (it centres where you put
// your thumb), SHOOT and PASS on the right. With the puck: tap SHOOT for a
// wrist shot, hold for a slap shot; PASS passes toward the stick. Without it:
// SHOOT checks, PASS switches to the skater nearest the puck; SHOOT while a
// pass is on its way to you is the one-timer. At a faceoff either button
// takes the draw -- on the drop, not before. Keyboard: arrows / WASD, J or
// Space to shoot, K or Shift to pass, Esc to pause.
//
// A win pays $250, a tie $100, a loss $25, and $25 a goal.

import * as THREE from './three.js';
import { text } from './arcadegames.js';
import { Beeper } from './arcade.js';
import { Hockey, RINK, TEAMS, PERIOD_S } from './hockeygame.js';

const VW = 400, VH = 225;
const S = 3;              // pixels per foot along the rink
const K = 0.62;           // the 3/4 view: across the rink is squashed
const ICE_Y = 60;         // screen y of the far boards' foot (y = -42.5) with the camera centred
const STEP = 1 / 60;

/** Crowd, organ, horn, whistle, and the sounds of the ice. */
class RinkSound extends Beeper {
  constructor(ctx, dest) {
    super(ctx, dest);
    if (!ctx) return;
    this.out.gain.value = 0.26;
    // the crowd: looped noise through a band-pass, swelling on chances and goals
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    this.crowd = ctx.createGain(); this.crowd.gain.value = 0;
    src.connect(bp).connect(this.crowd).connect(this.out);
    src.start();
    this.crowdLevel = 0.12;
  }
  setCrowd(v, dt) {
    if (!this.c) return;
    this.crowdLevel += (v - this.crowdLevel) * Math.min(1, dt * 2.5);
    this.crowd.gain.setTargetAtTime(this.crowdLevel, this.c.currentTime, 0.05);
  }
  mute() { if (this.c) { this.crowdLevel = 0; this.crowd.gain.setTargetAtTime(0, this.c.currentTime, 0.1); } }
  organ(notes, d = 0.16, v = 0.16) {
    // a drawbar organ: a sine and its octave, a little square on top
    notes.forEach((f, i) => { if (!f) return; this.tone('sine', f, d * 0.95, v, 0, i * d); this.tone('sine', f * 2, d * 0.9, v * 0.5, 0, i * d); this.tone('square', f, d * 0.8, v * 0.12, 0, i * d); });
  }
  play(name) {
    if (!this.c) return;
    const now = this.c.currentTime;
    if (this.last[name] && now - this.last[name] < 0.04) return;
    this.last[name] = now;
    const T = this.tone.bind(this), N = this.noise.bind(this);
    switch (name) {
      case 'pass': case 'draw': N(0.035, 0.45, 2600); break;
      case 'pickup': N(0.02, 0.18, 2000); break;
      case 'wrist': N(0.05, 0.6, 3000); break;
      case 'slap': N(0.08, 0.9, 2400); T('square', 120, 0.06, 0.3); break;
      case 'onetimer': N(0.09, 1.0, 2600); T('square', 140, 0.06, 0.35); break;
      case 'dump': N(0.05, 0.5, 2200); break;
      case 'save': N(0.07, 0.6, 500); T('triangle', 160, 0.08, 0.3); break;
      case 'post': T('sine', 1900, 0.45, 0.35); T('sine', 2850, 0.3, 0.15); break;
      case 'boards': case 'boardsPuck': N(0.12, 0.5, 260); break;
      case 'check': N(0.18, 0.9, 380); T('square', 70, 0.18, 0.35); break;
      case 'bump': N(0.06, 0.35, 420); break;
      case 'lunge': case 'poke': N(0.04, 0.25, 1500); break;
      case 'stop': N(0.22, 0.22, 5200); break;
      case 'whistle': case 'faceoffSet': {
        if (name === 'faceoffSet') break;
        const t = this.c.currentTime + 0.01, o = this.c.createOscillator(), g = this.c.createGain(), l = this.c.createOscillator(), lg = this.c.createGain();
        o.frequency.value = 2700; l.frequency.value = 38; lg.gain.value = 140;
        l.connect(lg).connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.setValueAtTime(0.25, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.connect(g).connect(this.out); o.start(t); l.start(t); o.stop(t + 0.62); l.stop(t + 0.62);
        break;
      }
      case 'horn': case 'goalHome': {
        // the goal horn: a detuned low chord
        for (const f of [138, 139.5, 207, 276]) T('sawtooth', f, 2.6, 0.13);
        if (name === 'goalHome') this.later(2.2, () => this.organ([392, 523, 659, 784, 0, 659, 784], 0.15, 0.2));
        break;
      }
      case 'goalAway': T('triangle', 220, 0.6, 0.3, 110); break;
      case 'drop': T('square', 1320, 0.03, 0.12); break;
      case 'final': this.organ([523, 392, 330, 262], 0.3, 0.18); break;
      case 'charge': this.organ([392, 523, 659, 784, 0, 659, 784], 0.13, 0.17); break;
      case 'letsgo': this.organ([523, 523, 0, 523, 523, 523, 0, 0], 0.14, 0.15); break;
      default: break;
    }
  }
  later(t, fn) { setTimeout(fn, t * 1000); }
}

export class HockeyNight {
  /** opts: { scene, city, world, audio, arena: {x,y,z}, onReward(n), onEnd } */
  constructor(opts) {
    this.o = opts;
    this.mode = 'off';            // off | intro | play | paused | final
    this._entrance();
    this._buildDom();
    this.keys = {};
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.btn = { shoot: false, pass: false };
    this.acc = 0;
    this.camX = 0;
    this.flash = 0;
  }

  get active() { return this.mode !== 'off'; }

  // --- the marquee outside the south atrium ------------------------------------------------

  _entrance() {
    const { scene, city, arena } = this.o;
    const a = arena || { x: -1213.8, y: 0, z: -1197.3 };
    this.arena = a;
    // the atrium's glass front peaks at local (3.7, 92.4); its solid ends 91.5 m south of the centre
    const x = a.x + 3.7, z = a.z + 95.5;
    const y = city.groundAt(x, z, null);
    this.door = { x, y, z };
    this.spot = { x, z };
    // a marquee on two posts, beside the doors, facing the street
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#05070c'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#0b1a2a'; for (let yy = 4; yy < 256; yy += 6) for (let xx = 4; xx < 512; xx += 6) g.fillRect(xx, yy, 3, 3);
    g.textAlign = 'center';
    g.shadowBlur = 16; g.shadowColor = '#6fd3e8'; g.fillStyle = '#bff4ff';
    g.font = '900 64px Helvetica, Arial, sans-serif'; g.fillText('HOCKEY', 256, 92);
    g.shadowColor = '#ffd23a'; g.fillStyle = '#ffe89a'; g.font = '900 34px Helvetica, Arial, sans-serif'; g.fillText('TONIGHT', 256, 134);
    g.shadowColor = '#ff5a3a'; g.fillStyle = '#ffffff'; g.font = '800 26px Helvetica, Arial, sans-serif'; g.fillText('SEATTLE vs VANCOUVER', 256, 188);
    g.shadowBlur = 0; g.fillStyle = '#8aa'; g.font = '700 18px Helvetica, Arial, sans-serif'; g.fillText('PUCK DROP · PRESS ENTER', 256, 228);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const grp = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.6 }));
    face.position.set(0, 3.6, 0.07);
    grp.add(face);
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.6 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.7, 2.5, 0.12), steel); frame.position.set(0, 3.6, 0); grp.add(frame);
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.16), steel); p.position.set(s * 1.9, 1.25, 0); grp.add(p); }
    // merge into one draw: the posts and frame share the steel, the face its own map -- two meshes
    grp.position.set(x - 20, city.groundAt(x - 20, z + 2, null), z + 2);
    grp.name = 'hockeyMarquee';
    scene.add(grp);
    this.marquee = grp;
    // the posts are solid
    if (city.setLandmarkSolids) {
      const my = grp.position.y;
      const sol = [-1, 1].map((k) => ({ x: grp.position.x + k * 1.9, z: grp.position.z, r: 0.2, y0: my - 1, y1: my + 2.5 }));
      city.setLandmarkSolids([...(city.landmarkSolids || []), ...sol]);
    }
  }

  /**
   * Anywhere round the arena: within ~20 m of its walls on any side (the
   * building is a 110 m square under its roof, landmarks.js ARENA, with the
   * glass atrium out to 92 m south of its centre), on foot at ground level.
   * One ENTER spot at the atrium doors was a secret to be found.
   */
  near(pl) {
    const a = this.arena;
    const dx = pl.x - (a.x + 4.5), dz = pl.z - (a.z + 1);
    const round = Math.max(Math.abs(dx), Math.abs(dz)) < 55 + 22;
    const atrium = Math.abs(pl.x - (a.x + 3.7)) < 60 && dz > 50 && dz < 92 + 22;
    return (round || atrium) && Math.abs(pl.y - this.o.city.groundAt(pl.x, pl.z, pl.y + 1)) < 2.5;
  }

  // --- the overlay ---------------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'hockeyUi';
    d.innerHTML = `
      <canvas class="hScreen" width="${VW}" height="${VH}"></canvas>
      <div class="hStick"><div class="hKnob"></div></div>
      <button class="hPass">PASS</button><button class="hShoot">SHOOT</button>
      <button class="hMenu">II</button>
      <div class="hPanel"></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #hockeyUi { position: absolute; inset: 0; z-index: 40; display: none; background: #000; user-select: none; -webkit-user-select: none; touch-action: none;
        font: 800 14px -apple-system, Helvetica, sans-serif; color: #fff; }
      #hockeyUi.show { display: block; }
      #hockeyUi .hScreen { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); image-rendering: pixelated; image-rendering: crisp-edges; display: block; }
      #hockeyUi button { -webkit-tap-highlight-color: transparent; touch-action: none; border: none; color: #fff; font: 900 14px -apple-system, Helvetica, sans-serif; letter-spacing: .04em; }
      #hockeyUi .hShoot, #hockeyUi .hPass { position: absolute; width: 78px; height: 78px; border-radius: 50%; opacity: .82; }
      #hockeyUi .hShoot { right: calc(18px + var(--safe-r, 0px)); bottom: calc(22px + var(--safe-b, 0px)); background: #d8342c; box-shadow: 0 5px 0 #6a1410; }
      #hockeyUi .hPass { right: calc(106px + var(--safe-r, 0px)); bottom: calc(58px + var(--safe-b, 0px)); background: #2c6ad8; box-shadow: 0 5px 0 #10306a; }
      #hockeyUi .hShoot.on, #hockeyUi .hPass.on { transform: translateY(4px); box-shadow: none; }
      #hockeyUi .hStick { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%; border: 3px solid #ffffff40; background: #ffffff12; display: none; pointer-events: none; }
      #hockeyUi .hStick.on { display: block; }
      #hockeyUi .hKnob { position: absolute; left: 36px; top: 36px; width: 42px; height: 42px; border-radius: 50%; background: #ffffffa0; }
      #hockeyUi .hMenu { position: absolute; top: calc(8px + var(--safe-t, 0px)); right: calc(14px + var(--safe-r, 0px)); width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,.16); }
      #hockeyUi .hPanel { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: #000b; text-align: center; }
      #hockeyUi .hPanel.on { display: flex; }
      #hockeyUi .hPanel .big { font: 900 34px Helvetica, Arial, sans-serif; letter-spacing: .06em; color: #bff4ff; text-shadow: 0 0 14px #6fd3e8; }
      #hockeyUi .hPanel .sm { font-size: 14px; line-height: 1.6; opacity: .92; }
      #hockeyUi .hPanel button { padding: 10px 26px; border-radius: 999px; background: #2c6ad8; } #hockeyUi .hPanel button.back { background: rgba(255,255,255,.18); }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { cv: q('.hScreen'), stick: q('.hStick'), knob: q('.hKnob'), shoot: q('.hShoot'), pass: q('.hPass'), panel: q('.hPanel') };
    this.g = this.ui.cv.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    // buttons: held states, each with its own pointer
    const hold = (el, key) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.btn[key] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => { this.btn[key] = false; el.classList.remove('on'); });
    };
    hold(this.ui.shoot, 'shoot'); hold(this.ui.pass, 'pass');
    q('.hMenu').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this._pause(); });
    // the stick: anywhere on the left half, centred where the thumb lands. Last touch wins.
    d.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'play' || e.target.closest('button') || e.clientX > innerWidth * 0.55) return;
      e.preventDefault();
      const s = this.stick;
      s.id = e.pointerId; s.ox = e.clientX; s.oy = e.clientY; s.x = 0; s.y = 0;
      this.ui.stick.style.left = `${e.clientX}px`; this.ui.stick.style.top = `${e.clientY}px`;
      this.ui.stick.classList.add('on'); this.ui.knob.style.transform = '';
      try { d.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    });
    d.addEventListener('pointermove', (e) => {
      const s = this.stick;
      if (e.pointerId !== s.id) return;
      let dx = (e.clientX - s.ox) / 48, dy = (e.clientY - s.oy) / 48;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      s.x = Math.abs(dx) < 0.12 ? 0 : dx; s.y = Math.abs(dy) < 0.12 ? 0 : dy;
      this.ui.knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
    });
    const off = (e) => { if (e.pointerId !== this.stick.id) return; this.stick.id = null; this.stick.x = 0; this.stick.y = 0; this.ui.stick.classList.remove('on'); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) d.addEventListener(ev, off);
    // keys
    const map = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd',
      KeyJ: 'shoot', Space: 'shoot', KeyK: 'pass', ShiftLeft: 'pass', ShiftRight: 'pass' };
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      if (e.code === 'Escape') { if (this.mode === 'paused') this._resume(); else if (this.mode === 'play' || this.mode === 'intro') this._pause(); }
      else if (map[e.code]) this.keys[map[e.code]] = true;
      else if (e.code === 'Enter' && (this.mode === 'final')) this._newGame();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('keyup', (e) => { if (map[e.code]) this.keys[map[e.code]] = false; });
    window.addEventListener('resize', () => { if (this.active) this._fit(); });
  }

  _fit() {
    const vw = innerWidth, vh = innerHeight;
    // whole-pixel scaling where it fits, fractional where it must
    let k = Math.min(vw / VW, vh / VH);
    if (k >= 2) k = Math.floor(k * 2) / 2;
    const cv = this.ui.cv;
    cv.style.width = `${Math.round(VW * k)}px`; cv.style.height = `${Math.round(VH * k)}px`;
  }

  // --- flow ------------------------------------------------------------------------------------

  start() {
    this.el.classList.add('show');
    this.snd = this.snd || new RinkSound(this.o.audio && this.o.audio.ctx, this.o.audio && this.o.audio.master);
    this._fit();
    if (!this.rink) this._drawRink();
    this._newGame();
  }

  _newGame() {
    this.game = new Hockey({ humanTeam: 0 });
    this.mode = 'intro';
    this.introT = 0;
    this.paid = false;
    this.ui.panel.classList.remove('on');
    this.camX = 0;
    this.snd.play('charge');
  }

  _pause() {
    if (this.mode !== 'play' && this.mode !== 'intro') return;
    this.pausedFrom = this.mode;
    this.mode = 'paused';
    const g = this.game;
    this._panel(`<div class="big">TIME OUT</div><div class="sm">${TEAMS[0].abbr} ${g.score[0]} · ${TEAMS[1].abbr} ${g.score[1]} · period ${Math.min(g.period, 3)}${g.period > 3 ? ' OT' : ''}</div>
      <button class="go">RESUME</button><button class="back">LEAVE THE ARENA</button>`, () => this._resume(), () => this.close());
  }

  _resume() { this.mode = this.pausedFrom || 'play'; this.ui.panel.classList.remove('on'); }

  _panel(html, go, back) {
    const p = this.ui.panel;
    p.innerHTML = html;
    p.classList.add('on');
    const a = p.querySelector('.go'), b = p.querySelector('.back');
    if (a) a.addEventListener('click', go);
    if (b) b.addEventListener('click', back);
  }

  close() {
    this.mode = 'off';
    this.el.classList.remove('show');
    this.ui.panel.classList.remove('on');
    this.keys = {}; this.btn = { shoot: false, pass: false };
    if (this.snd) this.snd.mute();
    if (this.o.onEnd) this.o.onEnd();
  }

  _final() {
    const g = this.game;
    const [a, b] = g.score;
    const pay = (g.result === 'win' ? 250 : g.result === 'tie' ? 100 : 25) + 25 * a;
    if (!this.paid) { this.paid = true; if (this.o.onReward) this.o.onReward(pay); }
    this.mode = 'final';
    const head = g.result === 'win' ? 'SEATTLE WINS!' : g.result === 'tie' ? 'A TIE' : 'VANCOUVER WINS';
    this._panel(`<div class="big">${head}</div><div class="sm">FINAL${g.period > 3 ? ' (OT)' : ''} · ${TEAMS[0].abbr} ${a} – ${b} ${TEAMS[1].abbr}<br>
      SHOTS ${g.shots[0]} – ${g.shots[1]} · ONE-TIMERS ${g.stats.oneTimers[0]} · CHECKS ${g.stats.checks[0]}<br>The arena pays $${pay}</div>
      <button class="go">PLAY AGAIN</button><button class="back">LEAVE THE ARENA</button>`, () => this._newGame(), () => this.close());
  }

  // --- the frame ------------------------------------------------------------------------------

  _input() {
    const k = this.keys, s = this.stick;
    let x = (k.r ? 1 : 0) - (k.l ? 1 : 0) + s.x, y = (k.d ? 1 : 0) - (k.u ? 1 : 0) + s.y;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    // screen down is +y on the rink, but the 3/4 view squashes it: a thumb pushed at 45 deg means 45 deg on the ice
    return { x, y, shoot: this.btn.shoot || !!k.shoot, pass: this.btn.pass || !!k.pass };
  }

  update(dt) {
    if (this.mode === 'off') return;
    const g = this.game;
    if (this.mode === 'intro') {
      this.introT += dt;
      if (this.introT > 2.2) this.mode = 'play';
    } else if (this.mode === 'play' && !this.frozen) {
      this.acc = Math.min(this.acc + dt, 0.1);
      while (this.acc >= STEP) {
        this.acc -= STEP;
        g.step(STEP, this._input());
        for (const e of g.takeEvents()) this._event(e);
        if (g.over) { this._final(); break; }
      }
    }
    // the crowd: louder with the puck near a net, roaring after a goal
    const pk = g.puck;
    const near = Math.max(0, 1 - (RINK.goalX - Math.abs(pk.x)) / 40);
    this.snd.setCrowd(this.mode === 'paused' ? 0.02 : g.state === 'goal' ? 0.5 : 0.08 + near * 0.16, dt);
    this.flash = Math.max(0, this.flash - dt);
    this._labels();
    this._draw(dt);
  }

  _event(e) {
    this.snd.play(e);
    if (e === 'goalHome' || e === 'goalAway') this.flash = 3;
    if (e === 'draw' && this.game.rng() < 0.3) this.snd.play('letsgo');
  }

  _labels() {
    const g = this.game, p = g.ctl;
    const mine = p && g.puck.owner === p;
    const teamHas = g.puck.owner && g.puck.owner.team === 0;
    const s = g.state === 'faceoff' ? 'DRAW' : mine ? 'SHOOT' : (g.puck.pass && g.puck.pass.to === p) ? 'ONE-T' : teamHas ? 'CALL' : 'CHECK';
    const q = g.state === 'faceoff' ? 'DRAW' : mine ? 'PASS' : teamHas ? 'CALL' : 'SWITCH';
    if (this.ui.shoot.textContent !== s) this.ui.shoot.textContent = s;
    if (this.ui.pass.textContent !== q) this.ui.pass.textContent = q;
  }

  // --- drawing -------------------------------------------------------------------------------------

  /** The rink, the boards, the ads and the stands, once, at 1 px per screen pixel. */
  _drawRink() {
    const W = Math.round((2 * RINK.hx + 40) * S), H = VH + 40;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    this.rink = cv;
    this.rinkOx = (RINK.hx + 20) * S;        // world x = 0 in the rink canvas
    const wy = (y) => Math.round(ICE_Y + 20 + (y + RINK.hy) * S * K);
    const wx = (x) => Math.round(this.rinkOx + x * S);
    this.rinkWY = wy; this.rinkWX = wx;
    // the stands: dark, with a crowd of pixel heads
    g.fillStyle = '#10121a'; g.fillRect(0, 0, W, H);
    let sd = 11;
    const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const shirts = ['#10284a', '#6fd3e8', '#e8e8e8', '#10284a', '#c83a3a', '#2a6a4a', '#1f6e46', '#d8d0c0', '#4a4a5a'];
    this.crowd = [];
    for (let y = 4; y < H - 4; y += 5) for (let x = 2; x < W; x += 4) {
      if (rnd() < 0.12) continue;
      this.crowd.push({ x: x + Math.floor(rnd() * 2), y, c: shirts[Math.floor(rnd() * shirts.length)], s: ['#f0c8a0', '#c89870', '#8a5a3a', '#e8b890'][Math.floor(rnd() * 4)], ph: rnd() * 6.28 });
    }
    for (const p of this.crowd) { g.fillStyle = p.c; g.fillRect(p.x, p.y + 2, 3, 3); g.fillStyle = p.s; g.fillRect(p.x + 1, p.y, 2, 2); }
    // the ice: a rounded rectangle, squashed
    const iceTop = wy(-RINK.hy), iceBot = wy(RINK.hy);
    const rr = (inset) => {
      g.beginPath();
      const x0 = wx(-RINK.hx) + inset, x1 = wx(RINK.hx) - inset, y0 = iceTop + inset * K, y1 = iceBot - inset * K;
      const cx = RINK.corner * S - inset, cy = RINK.corner * S * K - inset * K;
      g.moveTo(x0 + cx, y0); g.lineTo(x1 - cx, y0); g.ellipse(x1 - cx, y0 + cy, cx, cy, 0, -Math.PI / 2, 0); g.lineTo(x1, y1 - cy);
      g.ellipse(x1 - cx, y1 - cy, cx, cy, 0, 0, Math.PI / 2); g.lineTo(x0 + cx, y1); g.ellipse(x0 + cx, y1 - cy, cx, cy, 0, Math.PI / 2, Math.PI);
      g.lineTo(x0, y0 + cy); g.ellipse(x0 + cx, y0 + cy, cx, cy, 0, Math.PI, Math.PI * 1.5); g.closePath();
    };
    // the far boards: a white wall with ads, a yellow kick plate, the glass over it
    g.fillStyle = '#a8c0cc'; g.fillRect(wx(-RINK.hx) + RINK.corner * S, iceTop - 16, (2 * RINK.hx - 2 * RINK.corner) * S, 5);
    g.fillStyle = '#f2f2ee'; g.fillRect(wx(-RINK.hx) + RINK.corner * S - 6, iceTop - 11, (2 * RINK.hx - 2 * RINK.corner) * S + 12, 11);
    const ads = [['EMERALD CITY PINBALL', '#c02838'], ['RAIN CITY COFFEE', '#1a5a3a'], ['PIKE PLACE FISH', '#1a3a8a'], ['SOUND FERRIES', '#10284a'], ['MONORAIL', '#c83a3a'], ['SEATTLE', '#10284a'], ['GREAT WHEEL', '#2f6fb0'], ['INTERBAY GOLF', '#2c8a4a']];
    let ax = wx(-RINK.hx) + RINK.corner * S;
    for (let i = 0; ax < wx(RINK.hx) - RINK.corner * S - 40; i++) {
      const [t, c] = ads[i % ads.length];
      const w = t.length * 4 + 8;
      g.fillStyle = c; g.fillRect(ax, iceTop - 10, w, 7);
      text(g, t, ax + 4, iceTop - 9, 1, '#ffffff');
      ax += w + 6;
    }
    g.fillStyle = '#e8c830'; g.fillRect(wx(-RINK.hx) + RINK.corner * S - 6, iceTop - 3, (2 * RINK.hx - 2 * RINK.corner) * S + 12, 2);
    // the ice itself
    rr(0); g.fillStyle = '#f2c830'; g.fill();
    rr(2); g.fillStyle = '#e4eef3'; g.fill();
    g.save(); rr(2); g.clip();
    // scratches
    for (let i = 0; i < 900; i++) { g.fillStyle = rnd() < 0.5 ? '#d8e4ea' : '#eef6fa'; g.fillRect(wx(-RINK.hx) + rnd() * 2 * RINK.hx * S, iceTop + rnd() * (iceBot - iceTop), 2 + rnd() * 4, 1); }
    const vline = (x, col, w) => { g.fillStyle = col; g.fillRect(wx(x) - Math.floor(w / 2), iceTop, w, iceBot - iceTop); };
    vline(0, '#c8202a', 3);
    vline(RINK.blue, '#1a4ab0', 3); vline(-RINK.blue, '#1a4ab0', 3);
    vline(RINK.goalX, '#c8202a', 1); vline(-RINK.goalX, '#c8202a', 1);
    const circ = (x, y, r, col, fill) => {
      g.beginPath(); g.ellipse(wx(x), wy(y), r * S, r * S * K, 0, 0, Math.PI * 2);
      if (fill) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = 1; g.stroke(); }
    };
    circ(0, 0, 15, '#1a4ab0'); circ(0, 0, 0.8, '#1a4ab0', true);
    for (const x of [-69, 69]) for (const y of [-22, 22]) { circ(x, y, 15, '#c8202a'); circ(x, y, 1, '#c8202a', true); }
    for (const x of [-20, 20]) for (const y of [-22, 22]) circ(x, y, 1, '#c8202a', true);
    // centre ice: a Sound-blue logo, the city's initial
    g.globalAlpha = 0.35; circ(0, 0, 9, '#10284a', true); g.globalAlpha = 1;
    text(g, 'SEA', wx(0) - 5, wy(0) - 2, 1, '#e4eef3');
    // the creases
    for (const sd2 of [-1, 1]) {
      g.beginPath(); g.ellipse(wx(sd2 * RINK.goalX), wy(0), 6 * S, 6 * S * K, 0, sd2 > 0 ? Math.PI / 2 : -Math.PI / 2, sd2 > 0 ? Math.PI * 1.5 : Math.PI / 2);
      g.closePath(); g.fillStyle = '#8ab4e8'; g.fill(); g.strokeStyle = '#c8202a'; g.stroke();
    }
    g.restore();
    rr(1); g.strokeStyle = '#d8d8d0'; g.lineWidth = 2; g.stroke();
    this.iceTop = iceTop; this.iceBot = iceBot;
  }

  /** World (feet) to screen pixels. */
  _sx(x) { return Math.round((x - this.camX) * S + VW / 2); }
  _sy(y, z = 0) { return Math.round(ICE_Y + (y + RINK.hy) * S * K - z * S * 0.8); }

  _draw(dt) {
    const g = this.g, gm = this.game;
    if (!gm || !this.rink) return;
    // the camera leads the puck along the rink
    const pk = gm.puck;
    const want = Math.max(-(RINK.hx + 10) + VW / 2 / S, Math.min(RINK.hx + 10 - VW / 2 / S, pk.x + pk.vx * 0.25));
    this.camX += (want - this.camX) * Math.min(1, dt * 4);
    // the rink, the boards, the stands (a goal makes the crowd jump)
    const ox = Math.round(this.rinkOx + this.camX * S - VW / 2);
    g.drawImage(this.rink, ox, 20, VW, VH, 0, 0, VW, VH);
    if (this.flash > 0) {
      for (const p of this.crowd) {
        const sx = p.x - ox;
        if (sx < -4 || sx > VW) continue;
        const j = Math.sin(gm.t * 14 + p.ph) > 0 ? 2 : 0;
        g.fillStyle = '#10121a'; g.fillRect(sx, p.y - 20, 3, 5);
        g.fillStyle = p.c; g.fillRect(sx, p.y - 20 + 2 - j, 3, 3); g.fillStyle = p.s; g.fillRect(sx + 1, p.y - 20 - j, 2, 2);
      }
    }
    // the nets, back halves first
    this._net(-1, false); this._net(1, false);
    // sprays of snow
    for (const s of gm.sprays) {
      const x = this._sx(s.x), y = this._sy(s.y);
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 5; i++) g.fillRect(x + Math.round(Math.cos(s.a + 1.6) * (i + 2) * (1.2 - s.t)), y + Math.round(Math.sin(s.a + 1.6) * (i + 1) * 0.6) - i % 2, 1, 1);
    }
    // shadows, then skaters and the puck, far to near
    const things = gm.players.map((p) => ({ p, y: p.y }));
    things.push({ puck: true, y: pk.y });
    things.sort((a, b) => a.y - b.y);
    for (const t of things) { if (t.puck) this._puck(); else this._player(t.p); }
    // the nets' fronts: posts and crossbar over the skaters behind them
    this._net(-1, true); this._net(1, true);
    // the near boards: a rail
    const nb = this._sy(RINK.hy) + 2;
    g.fillStyle = '#f2c830'; g.fillRect(0, nb, VW, 2);
    g.fillStyle = '#e8eef2'; g.fillRect(0, nb + 2, VW, 5);
    g.fillStyle = '#9ab4c0'; g.fillRect(0, nb + 7, VW, 1);
    g.fillStyle = '#10121a'; g.fillRect(0, nb + 8, VW, VH - nb - 8);
    this._hud();
  }

  _net(sd, front) {
    const g = this.g, gm = this.game;
    const x = this._sx(sd * RINK.goalX), bx = this._sx(sd * (RINK.goalX + RINK.netDepth));
    const y0 = this._sy(-RINK.netHalf), y1 = this._sy(RINK.netHalf);
    const h = Math.round(4 * S * 0.8);
    if (!front) {
      // the mesh: back and sides
      g.fillStyle = '#ffffff55';
      g.fillRect(Math.min(x, bx), y0 - h, Math.abs(bx - x), y1 - y0 + h);
      g.fillStyle = '#ffffff90';
      for (let yy = y0 - h; yy < y1; yy += 2) g.fillRect(Math.min(x, bx), yy, Math.abs(bx - x), 1);
      g.fillStyle = '#c8202a'; g.fillRect(bx - (sd > 0 ? 1 : 0), y0 - h + 2, 1, y1 - y0 + h - 2);
      return;
    }
    g.fillStyle = '#d8242c';
    g.fillRect(x - 1, y0 - h, 2, h + 1);           // far post
    g.fillRect(x - 1, y1 - h, 2, h + 1);           // near post
    g.fillRect(x - 1, y0 - h, 2, y1 - y0 + 1);     // crossbar, seen from above
    void gm;
  }

  _puck() {
    const g = this.g, pk = this.game.puck;
    if (this.game.state === 'faceoff' && this.game.stateT < this.game.fo.drop) {
      // held over the dot by the linesman
      const x = this._sx(pk.x), y = this._sy(pk.y, 3 + Math.sin(this.game.t * 3) * 0.2);
      g.fillStyle = '#000'; g.fillRect(x - 1, y, 3, 2);
      return;
    }
    const x = this._sx(pk.x), y = this._sy(pk.y, pk.z), sy = this._sy(pk.y);
    if (pk.z > 0.3) { g.fillStyle = '#00000040'; g.fillRect(x - 1, sy, 3, 1); }
    g.fillStyle = '#0a0a0a'; g.fillRect(x - 1, y - 1, 3, 2);
    // a streak when it is flying
    const sp = Math.hypot(pk.vx, pk.vy);
    if (sp > 55 && !pk.owner) { g.fillStyle = '#00000030'; g.fillRect(Math.min(x, x - Math.sign(pk.vx) * 5), y - 1, 5, 1); }
  }

  _player(p) {
    const g = this.g, gm = this.game, tm = TEAMS[p.team];
    const x = this._sx(p.x), y = this._sy(p.y);
    if (x < -20 || x > VW + 20) return;
    const R = (px, py, w, h, c) => { g.fillStyle = c; g.fillRect(x + px, y + py, w, h); };
    // the one you control: a marker under him, flashing
    if (p === gm.ctl && gm.human === p.team) {
      const on = Math.floor(gm.t * 6) % 2 === 0 || gm.puck.owner === p;
      g.fillStyle = on ? '#ffe83a' : '#c8a020';
      g.fillRect(x - 4, y + 1, 9, 1); g.fillRect(x - 3, y + 2, 7, 1); g.fillRect(x - 1, y + 3, 3, 1);
    }
    // shadow
    g.fillStyle = '#00000030'; g.fillRect(x - 4, y - 1, 9, 2);
    if (p.down > 0) {
      // flat on the ice
      R(-7, -4, 5, 3, tm.pants); R(-2, -5, 7, 4, tm.jersey); R(0, -5, 5, 1, tm.trim); R(5, -5, 3, 3, tm.helmet);
      R(-9, -2, 3, 2, '#202020');
      g.fillStyle = '#6a4a2a'; g.fillRect(x + 2, y - 1, 8, 1);
      return;
    }
    const f = p.face, fx = Math.cos(f), fy = Math.sin(f);
    const view = fy > 0.45 ? 'front' : fy < -0.45 ? 'back' : 'side';
    const flip = fx < 0 ? -1 : 1;
    const moving = Math.hypot(p.vx, p.vy) > 2;
    const ph = moving ? Math.sin(p.stride * Math.PI * 2) : 0;
    if (p.goalie) { this._goalieSprite(p, x, y, tm, view, flip); return; }
    // skates and legs: a stride
    const s1 = Math.round(ph * 2), s2 = -s1;
    if (view === 'side') {
      R(-2 + s1 * flip, -2, 3, 2, '#1a1a1a'); R(-1 + s2 * flip, -2, 3, 2, '#2a2a2a');
      R(-2 + s1 * flip, -6, 2, 4, tm.pants); R(0 + s2 * flip, -6, 2, 4, tm.pants);
    } else {
      R(-3, -2 + (s1 > 0 ? -1 : 0), 2, 2, '#1a1a1a'); R(2, -2 + (s2 > 0 ? -1 : 0), 2, 2, '#1a1a1a');
      R(-3, -6, 2, 4, tm.pants); R(2, -6, 2, 4, tm.pants);
    }
    // shorts, jersey with its stripe, arms
    R(-3, -8, 7, 2, tm.pants);
    R(-4, -14, 9, 6, tm.jersey);
    R(-4, -10, 9, 1, tm.trim);
    R(-5, -13, 1, 4, tm.jersey); R(5, -13, 1, 4, tm.jersey);
    R(-5, -9, 1, 1, '#2a2a2a'); R(5, -9, 1, 1, '#2a2a2a');
    if (view === 'back') {
      // the number on his back
      text(g, String(p.num), x - (p.num > 9 ? 3 : 1), y - 14, 1, tm.num);
      R(-2, -18, 5, 4, tm.helmet);
    } else {
      R(-2, -18, 5, 2, tm.helmet);
      R(-2, -16, 5, 2, '#f0c8a0');
      if (view === 'front') { R(-1, -16, 1, 1, '#1a1a1a'); R(1, -16, 1, 1, '#1a1a1a'); R(-2, -15, 5, 1, '#c8c8c8'); }
      else R(flip > 0 ? 1 : -2, -16, 1, 1, '#1a1a1a');
    }
    // the stick: from the hands to a blade on the ice ahead of him (raised on a wind-up)
    const hx = x + (view === 'side' ? 3 * flip : 4), hy = y - 9;
    let bxp, byp;
    if (p.windup > 0) {
      const lift = Math.min(1, p.windup / 0.4);
      bxp = hx - fx * 6; byp = hy - 6 - lift * 6;
    } else { bxp = x + Math.round(fx * 7) + (view === 'side' ? 0 : 2); byp = y + Math.round(fy * 7 * K); }
    g.fillStyle = '#7a5a30';
    const n = Math.max(Math.abs(bxp - hx), Math.abs(byp - hy));
    for (let i = 0; i <= n; i++) g.fillRect(Math.round(hx + (bxp - hx) * i / n), Math.round(hy + (byp - hy) * i / n), 1, 1);
    g.fillStyle = '#1a1a1a'; g.fillRect(bxp - (fx < 0 ? 2 : 0), byp, 3, 1);
    // a check: a streak behind
    if (p.check > 0) { g.fillStyle = '#ffffff80'; g.fillRect(x - Math.round(fx * 8) - 1, y - 10, 2, 5); }
  }

  _goalieSprite(p, x, y, tm, view, flip) {
    const g = this.g;
    const R = (px, py, w, h, c) => { g.fillStyle = c; g.fillRect(x + px, y + py, w, h); };
    const save = p.save > 0;
    // the pads (butterfly on a save)
    if (save) { R(-7, -3, 6, 3, '#f2f2ee'); R(2, -3, 6, 3, '#f2f2ee'); R(-7, -2, 6, 1, tm.trim); R(2, -2, 6, 1, tm.trim); }
    else { R(-4, -7, 3, 7, '#f2f2ee'); R(2, -7, 3, 7, '#f2f2ee'); R(-4, -4, 3, 1, tm.trim); R(2, -4, 3, 1, tm.trim); }
    R(-5, save ? -10 : -14, 11, 7, tm.jersey);
    R(-5, save ? -6 : -10, 11, 1, tm.trim);
    // blocker and glove
    R(-8, save ? -10 : -12, 3, 4, '#f2f2ee');
    R(6, save ? -11 : -13, 4, 4, tm.trim);
    // the mask
    R(-2, save ? -14 : -18, 5, 4, '#e8e8e8'); R(-1, save ? -12 : -16, 3, 1, '#606060');
    // the stick along the ice
    g.fillStyle = '#7a5a30'; g.fillRect(x - 5, y - 1, 7, 1);
    void view; void flip;
  }

  _hud() {
    const g = this.g, gm = this.game;
    // the scoreboard
    g.fillStyle = '#000000c0'; g.fillRect(4, 4, 142, 13);
    text(g, TEAMS[0].abbr, 8, 8, 1, '#6fd3e8');
    text(g, String(gm.score[0]), 24, 8, 1, '#ffffff');
    text(g, TEAMS[1].abbr, 36, 8, 1, '#7ae88a');
    text(g, String(gm.score[1]), 52, 8, 1, '#ffffff');
    const per = gm.period > 3 ? 'OT' : ['1ST', '2ND', '3RD'][gm.period - 1];
    const c = Math.max(0, Math.ceil(gm.clock)), mm = Math.floor(c / 60), ss = String(c % 60).padStart(2, '0');
    text(g, per, 66, 8, 1, '#ffd23a');
    text(g, `${mm}:${ss}`, 82, 8, 1, '#ffffff');
    text(g, `SOG ${gm.shots[0]}-${gm.shots[1]}`, 104, 8, 1, '#a0b0c0');
    // who you are
    const p = gm.ctl;
    if (p) {
      const s = `#${p.num} ${p.name} ${p.role}`;
      g.fillStyle = '#000000a0'; g.fillRect(4, VH - 13, s.length * 4 + 6, 10);
      text(g, s, 7, VH - 11, 1, '#ffe83a');
    }
    // messages
    const m = this.mode === 'intro' ? { text: 'HOCKEY NIGHT', sub: 'SEATTLE VS VANCOUVER' } : gm.msg;
    if (m && m.text) {
      const big = m.text === 'GOAL!' ? 5 : 3;
      if (m.text !== 'GOAL!' || Math.floor(gm.t * 5) % 2 === 0) {
        const w = m.text.length * 4 * big;
        g.fillStyle = '#00000090'; g.fillRect(VW / 2 - w / 2 - 6, 70, w + 12, big * 5 + (m.sub ? 16 : 8));
        text(g, m.text, VW / 2, 74, big, m.text === 'GOAL!' ? '#ffd23a' : '#ffffff', 'center');
        if (m.sub) text(g, m.sub, VW / 2, 74 + big * 5 + 4, 1, '#bff4ff', 'center');
      }
    }
    // the faceoff cue
    if (gm.state === 'faceoff' && this.mode === 'play') {
      const dropped = gm.stateT >= gm.fo.drop;
      text(g, dropped ? 'NOW!' : 'WAIT FOR THE DROP', VW / 2, VH - 30, 1, dropped ? '#ffe83a' : '#a0b0c0', 'center');
    }
    void PERIOD_S;
  }
}
