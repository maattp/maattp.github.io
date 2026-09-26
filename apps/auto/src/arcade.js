// A BELLTOWN ARCADE: a storefront on 2nd Avenue with a neon sign and a
// window full of cabinets, and inside, six classic games (arcadegames.js).
//
// The storefront is a glowing panel on the street face of a real building
// (found at boot, the face nearest 2nd Ave at Bell St that fronts a road).
// ENTER at its door pauses the city and opens the room: six cabinets, each
// with its attract screen running, its year and its high score. A credit is
// $1. The cabinet: the game at its own resolution, pixel-sharp, scaled into
// the bezel with scanlines; a D-pad and A / B on screen (arrows or WASD,
// Space / J for A, X / K for B on a keyboard). Beating a cabinet's high score
// pays $50. Sounds are square waves and filtered noise on the game's
// AudioContext, one set per game.

import * as THREE from './three.js';
import * as G from './geo.js';
import { GAMES, text } from './arcadegames.js';

const AT = G.toWorld(47.6143, -122.3450);        // 2nd Ave between Bell and Blanchard
const STEP = 1 / 60;

/** Square waves and noise for the cabinets. */
class Beeper {
  constructor(ctx, dest) {
    this.c = ctx;
    if (!ctx) return;
    this.out = ctx.createGain();
    this.out.gain.value = 0.2;
    this.out.connect(dest || ctx.destination);
    const n = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, n, n);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.last = {};
  }
  tone(type, f, dur, vol, slideTo, at = 0) {
    if (!this.c) return;
    const t = this.c.currentTime + 0.005 + at;
    const o = this.c.createOscillator(), g = this.c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol, freq = 1200) {
    if (!this.c) return;
    const t = this.c.currentTime + 0.005;
    const s = this.c.createBufferSource(), f = this.c.createBiquadFilter(), g = this.c.createGain();
    s.buffer = this.noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  play(name) {
    if (!this.c) return;
    // some things fire every frame: no more than one of each per 30 ms
    const now = this.c.currentTime;
    if (this.last[name] && now - this.last[name] < 0.03) return;
    this.last[name] = now;
    const T = this.tone.bind(this), N = this.noise.bind(this);
    switch (name) {
      case 'wall': T('square', 245, 0.04, 0.4); break;
      case 'paddle': T('square', 490, 0.04, 0.4); break;
      case 'point': T('square', 245, 0.3, 0.4); break;
      case 'brick': T('square', 330, 0.05, 0.35); break;
      case 'brickMid': T('square', 392, 0.05, 0.35); break;
      case 'brickHi': T('square', 523, 0.05, 0.35); break;
      case 'lose': T('triangle', 220, 0.6, 0.6, 55); break;
      case 'tick': break;
      case 'eat': T('square', 660, 0.08, 0.35, 990); break;
      case 'fire': T('square', 1300, 0.12, 0.25, 260); break;
      case 'thrust': N(0.09, 0.25, 400); break;
      case 'beatLo': T('triangle', 55, 0.13, 0.9); break;
      case 'beatHi': T('triangle', 62, 0.13, 0.9); break;
      case 'bangL': N(0.7, 0.8, 600); break;
      case 'bangM': N(0.45, 0.6, 900); break;
      case 'bangS': N(0.25, 0.5, 1500); break;
      case 'hyper': T('sine', 300, 0.3, 0.4, 1200); break;
      case 'saucerLo': T('square', 330, 0.1, 0.12, 400); break;
      case 'saucerHi': T('square', 700, 0.08, 0.12, 900); break;
      case 'saucerFire': T('square', 900, 0.1, 0.2, 380); break;
      case 'shoot': T('square', 900, 0.14, 0.25, 180); break;
      case 'invaderHit': N(0.18, 0.5, 2500); break;
      case 'march0': T('square', 98, 0.09, 0.55); break;
      case 'march1': T('square', 87, 0.09, 0.55); break;
      case 'march2': T('square', 78, 0.09, 0.55); break;
      case 'march3': T('square', 73, 0.09, 0.55); break;
      case 'ufo': T('square', 420, 0.09, 0.15, 820); break;
      case 'ufoHit': N(0.4, 0.5, 1800); T('square', 880, 0.3, 0.2, 220); break;
      case 'playerHit': N(0.9, 0.8, 700); break;
      case 'hop': T('square', 520, 0.04, 0.25, 760); break;
      case 'squash': N(0.35, 0.6, 900); T('square', 200, 0.3, 0.3, 60); break;
      case 'home': [523, 659, 784, 1047].forEach((f, i) => T('square', f, 0.09, 0.3, 0, i * 0.07)); break;
      case 'level': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => T('square', f, 0.1, 0.3, 0, i * 0.08)); break;
      case 'coin': T('square', 988, 0.07, 0.35); T('square', 1319, 0.25, 0.35, 0, 0.07); break;
      case 'over': [392, 330, 262, 196].forEach((f, i) => T('triangle', f, 0.22, 0.6, 0, i * 0.18)); break;
      case 'hiscore': [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => T('square', f, 0.12, 0.3, 0, i * 0.09)); break;
      default: break;
    }
  }
}

export class Arcade {
  /** opts: { scene, city, world, audio, money: () => n, charge(n) -> bool, onReward(n), onEnd } */
  constructor(opts) {
    this.o = opts;
    this.mode = 'off';          // off | room | play | over
    this.hi = {};
    try { this.hi = JSON.parse(localStorage.getItem('auto-arcade-hi') || '{}') || {}; } catch (e) { this.hi = {}; }
    this._storefront();
    this._buildDom();
    this.inp = { left: false, right: false, up: false, down: false, a: false, b: false, pressed: {} };
    this._prev = {};
    this._keys = {};
    this.acc = 0;
  }

  get active() { return this.mode !== 'off'; }

  // --- the storefront ---------------------------------------------------------------

  _storefront() {
    const { city, scene } = this.o;
    // the building face nearest the spot that fronts a road
    let best = null;
    for (const b of city.buildingsNear(AT[0], AT[1], 70)) {
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const faces = [[c, s, b.w / 2, b.d], [-c, -s, b.w / 2, b.d], [-s, c, b.d / 2, b.w], [s, -c, b.d / 2, b.w]];
      for (const [nx, nz, off, len] of faces) {
        if (len < 9 || b.h < 6) continue;
        const fx = b.x + nx * off, fz = b.z + nz * off;
        if (!city.onRoad(fx + nx * 7, fz + nz * 7, 0) || city.onRoad(fx + nx * 1.2, fz + nz * 1.2, 0)) continue;
        const d = Math.hypot(fx - AT[0], fz - AT[1]);
        if (!best || d < best.d) best = { d, fx, fz, nx, nz };
      }
    }
    if (!best) { best = { fx: AT[0], fz: AT[1], nx: 0, nz: 1 }; }
    this.face = best;
    const gy = city.groundAt(best.fx + best.nx * 1.5, best.fz + best.nz * 1.5, null);
    this.door = { x: best.fx + best.nx * 1.6, z: best.fz + best.nz * 1.6, y: gy };
    // the panel: brick, a window of glowing cabinets, the door, neon over it
    const cv = document.createElement('canvas'); cv.width = 768; cv.height = 512;
    const g = cv.getContext('2d');
    g.fillStyle = '#3a2420'; g.fillRect(0, 0, 768, 512);
    for (let y = 0; y < 512; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < 768; x += 32) { g.fillStyle = `rgb(${88 + Math.random() * 20},${44 + Math.random() * 10},${36})`; g.fillRect(x + 1, y + 1, 30, 14); }
    // window
    g.fillStyle = '#0a0612'; g.fillRect(40, 180, 470, 300);
    const cols = ['#ff4ad8', '#4ae8ff', '#ffd23a', '#7aff5a', '#ff7a3a'];
    for (let i = 0; i < 5; i++) {
      const x = 62 + i * 88;
      g.fillStyle = '#16101e'; g.fillRect(x, 250, 70, 230);
      g.fillStyle = cols[i]; g.globalAlpha = 0.9; g.fillRect(x + 10, 275, 50, 40); g.globalAlpha = 1;
      g.fillStyle = '#fff'; g.globalAlpha = 0.35; g.fillRect(x + 10, 275, 50, 3); g.globalAlpha = 1;
      g.fillStyle = cols[(i + 2) % 5]; g.fillRect(x + 4, 252, 62, 16);
      g.fillStyle = '#222'; g.fillRect(x + 8, 330, 54, 14);
      g.fillStyle = '#ff3a3a'; g.beginPath(); g.arc(x + 22, 337, 4, 0, 7); g.fill();
      g.fillStyle = '#3a8aff'; g.beginPath(); g.arc(x + 46, 337, 4, 0, 7); g.fill();
    }
    g.strokeStyle = '#c8c0b8'; g.lineWidth = 8; g.strokeRect(40, 180, 470, 300);
    g.fillStyle = '#ffffff22'; g.fillRect(44, 184, 200, 292);
    // door
    g.fillStyle = '#1a1420'; g.fillRect(560, 210, 150, 290);
    g.strokeStyle = '#c8c0b8'; g.lineWidth = 8; g.strokeRect(560, 210, 150, 290);
    g.fillStyle = '#4ae8ff'; g.font = '900 30px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('OPEN', 635, 270);
    // the neon
    g.shadowColor = '#ff4ad8'; g.shadowBlur = 24; g.fillStyle = '#ff7ae8';
    g.font = '900 96px Helvetica, Arial, sans-serif'; g.fillText('ARCADE', 384, 120);
    g.shadowColor = '#4ae8ff'; g.fillStyle = '#9af4ff'; g.font = '800 30px Helvetica, Arial, sans-serif';
    g.fillText('CLASSIC GAMES · $1 A PLAY', 384, 165);
    g.shadowBlur = 0;
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.7 }));
    m.position.set(best.fx + best.nx * 0.06, gy + 3.0, best.fz + best.nz * 0.06);
    m.rotation.y = Math.atan2(best.nx, best.nz);
    m.name = 'arcadeFront';
    scene.add(m);
    this.front = m;
    this.spot = { x: this.door.x, z: this.door.z };
  }

  near(pl) { return Math.hypot(pl.x - this.door.x, pl.z - this.door.z) < 4.5 && Math.abs(pl.y - this.door.y) < 2.5; }

  // --- the overlay ------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'arcadeUi';
    d.innerHTML = `
      <div class="aRoom"><div class="aHead">BELLTOWN ARCADE</div><div class="aSub"></div><div class="aRow"></div><button class="aLeave">Leave</button></div>
      <div class="aCab"><div class="aMarq"></div><div class="aBezel"><canvas class="aScreen"></canvas><div class="aScan"></div><div class="aOver"></div></div>
        <div class="aDpad"><div class="aKnob"></div></div><button class="aB">B</button><button class="aA">A</button><button class="aBack">✕</button><div class="aHelp"></div></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #arcadeUi { position: absolute; inset: 0; z-index: 40; display: none; font: 800 14px -apple-system, Helvetica, sans-serif; color: #fff; user-select: none; -webkit-user-select: none; }
      #arcadeUi.show { display: block; }
      #arcadeUi .aRoom, #arcadeUi .aCab { position: absolute; inset: 0; display: none;
        background: radial-gradient(ellipse at 50% 0%, #2a1040 0%, #0c0614 60%), #0c0614; }
      #arcadeUi.room .aRoom, #arcadeUi.cab .aCab { display: block; }
      #arcadeUi .aHead { text-align: center; margin-top: calc(14px + var(--safe-t, 0px)); font: 900 30px Helvetica, Arial, sans-serif; color: #ff7ae8;
        text-shadow: 0 0 12px #ff4ad8, 0 0 30px #ff4ad8; letter-spacing: .08em; }
      #arcadeUi .aSub { text-align: center; font-size: 12px; color: #9af4ff; opacity: .9; margin-top: 4px; }
      #arcadeUi .aRow { position: absolute; left: 0; right: 0; top: calc(78px + var(--safe-t, 0px)); bottom: calc(56px + var(--safe-b, 0px));
        display: flex; gap: 14px; padding: 0 calc(18px + var(--safe-l, 0px)); overflow-x: auto; -webkit-overflow-scrolling: touch; align-items: center; justify-content: safe center; }
      #arcadeUi .aCard { flex: 0 0 150px; background: linear-gradient(#1c1428, #120c1a); border-radius: 10px 10px 4px 4px; border: 2px solid #3a2a52;
        display: flex; flex-direction: column; align-items: center; padding: 8px; gap: 6px; cursor: pointer; }
      #arcadeUi .aCard canvas { width: 120px; height: 100px; image-rendering: pixelated; background: #000; border: 4px solid #0a0610; border-radius: 6px; }
      #arcadeUi .aCard .t { font: 900 17px Helvetica, Arial, sans-serif; letter-spacing: .06em; }
      #arcadeUi .aCard .y { font-size: 11px; opacity: .7; } #arcadeUi .aCard .h { font-size: 11px; color: #ffd23a; }
      #arcadeUi .aCard .p { margin-top: 6px; background: #ff4ad8; border-radius: 999px; padding: 6px 14px; font-size: 13px; }
      #arcadeUi button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; border: none; color: #fff; font: 900 16px -apple-system, Helvetica, sans-serif; }
      #arcadeUi .aLeave { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(10px + var(--safe-b, 0px)); padding: 9px 28px; border-radius: 999px; background: rgba(255,255,255,.14); }
      #arcadeUi .aMarq { position: absolute; top: calc(6px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%); font: 900 20px Helvetica, Arial, sans-serif; letter-spacing: .12em;
        padding: 3px 22px; border-radius: 6px; background: #120c1a; border: 2px solid #3a2a52; }
      #arcadeUi .aBezel { position: absolute; left: 50%; top: calc(40px + var(--safe-t, 0px)); bottom: calc(10px + var(--safe-b, 0px)); transform: translateX(-50%);
        background: #050308; border: 10px solid #1a1226; border-radius: 16px; box-shadow: 0 0 0 3px #3a2a52, 0 0 40px #0008 inset; overflow: hidden; }
      #arcadeUi .aScreen { width: 100%; height: 100%; image-rendering: pixelated; display: block; filter: saturate(1.15) contrast(1.05); }
      #arcadeUi .aScan { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(0deg, #0000 0 2px, #0003 2px 3px),
        radial-gradient(ellipse at center, #0000 60%, #0007 100%); }
      #arcadeUi .aOver { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: #000a; text-align: center; }
      #arcadeUi .aOver.on { display: flex; }
      #arcadeUi .aOver .big { font: 900 26px Helvetica, Arial, sans-serif; } #arcadeUi .aOver .sm { font-size: 13px; opacity: .9; }
      #arcadeUi .aOver button { padding: 9px 22px; border-radius: 999px; background: #ff4ad8; } #arcadeUi .aOver button.back { background: rgba(255,255,255,.18); }
      #arcadeUi .aDpad { position: absolute; left: calc(22px + var(--safe-l, 0px)); bottom: calc(24px + var(--safe-b, 0px)); width: 128px; height: 128px; border-radius: 50%;
        background: radial-gradient(circle, #2a2036 0 30%, #1a1226 31% 100%); border: 3px solid #3a2a52; touch-action: none; }
      #arcadeUi .aKnob { position: absolute; left: 44px; top: 44px; width: 40px; height: 40px; border-radius: 50%; background: #ff3a3a; box-shadow: 0 3px 0 #7a1a1a; pointer-events: none; }
      #arcadeUi .aA, #arcadeUi .aB { position: absolute; width: 72px; height: 72px; border-radius: 50%; bottom: calc(40px + var(--safe-b, 0px)); }
      #arcadeUi .aA { right: calc(22px + var(--safe-r, 0px)); background: #ff3a3a; box-shadow: 0 5px 0 #7a1a1a; }
      #arcadeUi .aB { right: calc(104px + var(--safe-r, 0px)); bottom: calc(70px + var(--safe-b, 0px)); background: #3a8aff; box-shadow: 0 5px 0 #1a3a7a; }
      #arcadeUi .aA:active, #arcadeUi .aB:active { transform: translateY(4px); box-shadow: none; }
      #arcadeUi .aBack { position: absolute; top: calc(8px + var(--safe-t, 0px)); right: calc(14px + var(--safe-r, 0px)); width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,.14); }
      #arcadeUi .aHelp { position: absolute; top: calc(12px + var(--safe-t, 0px)); left: calc(16px + var(--safe-l, 0px)); font-size: 11px; opacity: .7; max-width: 22vw; }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { row: q('.aRow'), sub: q('.aSub'), marq: q('.aMarq'), bezel: q('.aBezel'), screen: q('.aScreen'), over: q('.aOver'), help: q('.aHelp'), dpad: q('.aDpad'), knob: q('.aKnob') };
    this.g = this.ui.screen.getContext('2d');
    q('.aLeave').addEventListener('click', () => this.close());
    q('.aBack').addEventListener('pointerdown', (e) => { e.preventDefault(); this._toRoom(); });
    // the cards
    this.cards = GAMES.map((gm) => {
      const c = document.createElement('div');
      c.className = 'aCard';
      c.innerHTML = `<canvas></canvas><div class="t" style="color:${gm.color}">${gm.title}</div><div class="y">${gm.year}</div><div class="h"></div><div class="p">PLAY $1</div>`;
      c.addEventListener('click', () => this._insert(gm));
      this.ui.row.appendChild(c);
      const cv = c.querySelector('canvas');
      const game = gm.make();
      cv.width = game.w; cv.height = game.h;
      return { gm, el: c, cv, g: cv.getContext('2d'), game, hEl: c.querySelector('.h') };
    });
    // buttons
    const btn = (sel, key) => {
      const b = q(sel);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.inp[key] = true; });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) b.addEventListener(ev, () => { this.inp[key] = false; });
    };
    btn('.aA', 'a'); btn('.aB', 'b');
    // the D-pad: 8 ways by the pointer's angle from its centre
    const pad = this.ui.dpad;
    let padId = null;
    const setPad = (e) => {
      const r = pad.getBoundingClientRect(), x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      const d2 = Math.hypot(x, y), dead = r.width * 0.12;
      const ax = d2 > dead ? x / d2 : 0, ay = d2 > dead ? y / d2 : 0;
      this.pad = { left: ax < -0.38, right: ax > 0.38, up: ay < -0.38, down: ay > 0.38 };
      const k = Math.min(1, d2 / (r.width * 0.36));
      this.ui.knob.style.transform = `translate(${ax * k * 30}px, ${ay * k * 30}px)`;
    };
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); padId = e.pointerId; pad.setPointerCapture(e.pointerId); setPad(e); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === padId) setPad(e); });
    const off = (e) => { if (e.pointerId !== padId) return; padId = null; this.pad = null; this.ui.knob.style.transform = ''; };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, off);
    // keys
    const map = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
      Space: 'a', KeyJ: 'a', KeyZ: 'a', KeyX: 'b', KeyK: 'b', ShiftLeft: 'b' };
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      if (e.code === 'Escape') { if (this.mode === 'room') this.close(); else this._toRoom(); }
      else if (map[e.code]) this._keys[map[e.code]] = true;
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('keyup', (e) => { if (map[e.code]) this._keys[map[e.code]] = false; });
    window.addEventListener('resize', () => this._fit());
  }

  // --- flow -----------------------------------------------------------------------------

  start() {
    this.mode = 'room';
    this.el.classList.add('show', 'room');
    this.el.classList.remove('cab');
    this.beeper = this.beeper || new Beeper(this.o.audio && this.o.audio.ctx, this.o.audio && this.o.audio.master);
    this._roomHud();
  }

  _roomHud() {
    this.ui.sub.textContent = `YOUR CASH $${this.o.money()} · ONE CREDIT $1 · BEAT A HIGH SCORE FOR $50`;
    for (const c of this.cards) c.hEl.textContent = this.hi[c.gm.id] ? `HIGH ${this.hi[c.gm.id]}` : 'NO HIGH SCORE';
  }

  _insert(gm) {
    if (!this.o.charge(1)) { this.ui.sub.textContent = 'NOT ENOUGH CASH FOR A CREDIT'; return; }
    this.beeper.play('coin');
    this.cur = gm;
    this.game = gm.make();
    this.mode = 'play';
    this.el.classList.remove('room');
    this.el.classList.add('cab');
    this.ui.over.classList.remove('on');
    this.ui.marq.textContent = gm.title;
    this.ui.marq.style.color = gm.color;
    this.ui.help.textContent = gm.help;
    this.ui.screen.width = this.game.w; this.ui.screen.height = this.game.h;
    this._fit();
    this.acc = 0;
  }

  /** The bezel keeps the game's aspect within the space between the controls. */
  _fit() {
    if (!this.game) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const maxW = vw - 2 * 170, maxH = vh - 70;
    const k = Math.min(maxW / this.game.w, maxH / this.game.h);
    this.ui.bezel.style.width = `${Math.floor(this.game.w * k)}px`;
    this.ui.bezel.style.height = `${Math.floor(this.game.h * k)}px`;
    this.ui.bezel.style.bottom = 'auto';
  }

  _toRoom() {
    if (this.mode === 'off') return;
    this.mode = 'room';
    this.game = null;
    this.el.classList.remove('cab');
    this.el.classList.add('room');
    this._roomHud();
  }

  close() {
    this.mode = 'off';
    this.game = null;
    this.el.classList.remove('show', 'room', 'cab');
    if (this.o.onEnd) this.o.onEnd();
  }

  _gameOver() {
    const gm = this.cur, sc = this.game.score, prev = this.hi[gm.id] || 0;
    const beat = sc > prev && sc > 0;
    if (beat) {
      this.hi[gm.id] = sc;
      try { localStorage.setItem('auto-arcade-hi', JSON.stringify(this.hi)); } catch (e) { /* private */ }
      if (prev > 0 && this.o.onReward) this.o.onReward(50);
      this.beeper.play('hiscore');
    } else this.beeper.play('over');
    this.mode = 'over';
    const o = this.ui.over;
    o.innerHTML = `<div class="big">${this.game.result || 'GAME OVER'}</div><div class="sm">SCORE ${sc}<br>${beat ? (prev > 0 ? 'NEW HIGH SCORE! +$50' : 'FIRST HIGH SCORE ON THIS CABINET') : `HIGH SCORE ${prev}`}</div>
      <button class="again">PLAY AGAIN $1</button><button class="back">BACK</button>`;
    o.querySelector('.again').addEventListener('click', () => this._insert(gm));
    o.querySelector('.back').addEventListener('click', () => this._toRoom());
    o.classList.add('on');
  }

  // --- the frame ------------------------------------------------------------------------

  _input() {
    const p = this.pad || {}, k = this._keys, i = this.inp;
    for (const d of ['left', 'right', 'up', 'down']) i[d] = !!(p[d] || k[d]);
    const a = i.a || !!k.a, b = i.b || !!k.b;
    const now = { left: i.left, right: i.right, up: i.up, down: i.down, a, b };
    i.pressed = {};
    for (const key of Object.keys(now)) i.pressed[key] = now[key] && !this._prev[key];
    this._prev = now;
    return { left: i.left, right: i.right, up: i.up, down: i.down, a, b, pressed: i.pressed };
  }

  update(dt) {
    if (this.mode === 'room') {
      // the attract screens: each card's game idles, drawn small
      this._attract = (this._attract || 0) + dt;
      if (this._attract > 1 / 20) {
        this._attract = 0;
        for (const c of this.cards) { try { c.game.draw(c.g); text(c.g, 'INSERT COIN', c.game.w / 2, c.game.h - 24, 2, '#ffd23a', 'center'); } catch (e) { /* a card is decoration */ } }
      }
      return;
    }
    if (this.mode !== 'play' || !this.game) return;
    this.acc = Math.min(this.acc + dt, 0.1);
    const sfx = (n) => this.beeper.play(n);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const inp = this._input();
      this.game.step(STEP, inp, sfx);
      if (this.game.over) { this.game.draw(this.g); this._gameOver(); return; }
    }
    this.game.draw(this.g);
  }
}
