// THE PINBALL MUSEUM in the Chinatown-International District: a storefront
// on Maynard Ave S, and inside, EMERALD CITY, a pinball table with real
// flipper physics (pinballtable.js has the physics and the rules).
//
// The storefront is a glowing panel on the street face of a real building
// (arcade.js's streetFace), one draw. ENTER at its door pauses the city and
// opens the machine; the overlay is opaque, so the city is not drawn behind
// it. A game is $1, three balls. Tap the left or right half of the screen for
// the flippers; with a ball in the shooter lane, hold the right half to draw
// the plunger back and let go to fire. NUDGE shoves the table (three shoves
// in quick succession is a TILT). Keyboard: Z / left Shift / Left for the
// left flipper, M / right Shift / Right for the right, Space / Enter / Down
// for the plunger, Up / N to nudge, Esc to leave.
//
// The table is drawn top-down on a 2D canvas: the static playfield once into
// an offscreen canvas at the screen's scale, then every frame the lamps,
// bumpers, targets, spinner, flippers, balls and the ramp over it. The view
// scrolls to follow the lowest ball (with a lead toward where it is going),
// or shows the whole table where the screen is tall enough. The score is on
// a dot-matrix display beside it. A game pays $1 per 100,000 points, and a
// new high score $50 more (localStorage 'auto-pinball-hi').

import * as THREE from './three.js';
import * as G from './geo.js';
import { Beeper, streetFace, storefrontSpot } from './arcade.js';
import {
  Table, W, H, R, TOP_PTS, BUMPERS, LANES, LANE_GUIDES, LANE_Y0, LANE_Y1, SAUCER, DROPS, DROP_X,
  ORBIT_X, ORBIT_Y0, ORBIT_Y1, SPINNER_Y, RAMP_X0, RAMP_X1, RAMP_PATH, SHOOTER, SLINGS, GUIDES,
  FLIP_LEN, FLIP_R0, FLIP_R1, rampAt,
} from './pinballtable.js';

const AT = G.toWorld(47.59857, -122.32556);      // 508 Maynard Ave S
const STEP = 1 / 60;
const VIEW_H = 500;                              // table units on screen when it has to scroll

/** The machine's sounds: solenoids, rubber, lamps, fanfares. */
class PinBeeper extends Beeper {
  play(name) {
    if (!this.c) return;
    const now = this.c.currentTime;
    if (this.last[name] && now - this.last[name] < 0.035) return;
    this.last[name] = now;
    const T = this.tone.bind(this), N = this.noise.bind(this);
    const arp = (fs, d, v, type = 'square', gap = d * 0.8) => fs.forEach((f, i) => T(type, f, d, v, 0, i * gap));
    switch (name) {
      case 'coin': T('square', 988, 0.07, 0.35); T('square', 1319, 0.25, 0.35, 0, 0.07); break;
      case 'flip': N(0.05, 0.55, 700); T('square', 70, 0.05, 0.25); break;
      case 'flipDown': N(0.03, 0.18, 420); break;
      case 'flipHit': N(0.035, 0.45, 2600); break;
      case 'bumper': N(0.06, 0.6, 1800); T('square', 196, 0.12, 0.3, 98); break;
      case 'sling': N(0.05, 0.5, 2200); T('square', 330, 0.08, 0.25, 160); break;
      case 'rubber': T('triangle', 620, 0.035, 0.14); break;
      case 'thud': N(0.04, 0.22, 420); break;
      case 'clack': N(0.03, 0.3, 3200); break;
      case 'drop': N(0.08, 0.5, 900); T('square', 180, 0.1, 0.25); break;
      case 'reset': N(0.16, 0.55, 600); T('square', 120, 0.15, 0.25); break;
      case 'lane': T('square', 880, 0.06, 0.18); T('square', 1320, 0.08, 0.18, 0, 0.06); break;
      case 'laneSet': arp([523, 659, 784, 1047], 0.09, 0.22); break;
      case 'spin': T('square', 1700, 0.012, 0.1); break;
      case 'orbit': T('sawtooth', 330, 0.3, 0.14, 990); break;
      case 'ramp': arp([392, 494, 587, 784], 0.08, 0.22); break;
      case 'rampOut': N(0.25, 0.18, 1400); break;
      case 'saucer': N(0.22, 0.5, 300); T('square', 110, 0.15, 0.3, 70); break;
      case 'kickout': N(0.1, 0.6, 800); T('square', 100, 0.1, 0.35); break;
      case 'lit': T('square', 1047, 0.08, 0.2); T('square', 1568, 0.14, 0.2, 0, 0.08); break;
      case 'lock': arp([392, 523, 659, 784, 659, 784], 0.1, 0.24); break;
      case 'multiball': arp([262, 330, 392, 523, 392, 523, 659, 784, 1047], 0.11, 0.26, 'square', 0.1); break;
      case 'jackpot': for (let r = 0; r < 4; r++) [523, 659, 784, 1047].forEach((f, i) => T('square', f * (r === 3 ? 2 : 1), 0.07, 0.26, 0, r * 0.28 + i * 0.06)); break;
      case 'skill': arp([784, 988, 1175, 1568, 1175, 1568], 0.09, 0.24); break;
      case 'extraBall': arp([523, 659, 784, 1047, 784, 1047, 1319], 0.1, 0.24); break;
      case 'plunge': case 'autoplunge': N(0.14, 0.55, 1200); T('square', 140, 0.1, 0.28); break;
      case 'kickback': N(0.12, 0.6, 1000); T('square', 90, 0.15, 0.35); break;
      case 'saved': arp([659, 784, 988], 0.08, 0.2); break;
      case 'drain': T('triangle', 330, 0.55, 0.45, 82); break;
      case 'drainSoft': T('triangle', 220, 0.18, 0.3, 110); break;
      case 'outlane': T('square', 440, 0.22, 0.14, 180); break;
      case 'count': T('square', 1000, 0.03, 0.13); break;
      case 'over': arp([392, 330, 262, 196], 0.22, 0.45, 'triangle', 0.18); break;
      case 'hiscore': arp([523, 659, 784, 1047, 1319, 1568], 0.12, 0.3, 'square', 0.09); break;
      case 'nudge': N(0.12, 0.55, 200); break;
      case 'danger': T('square', 110, 0.3, 0.35); break;
      case 'tilt': T('square', 80, 0.9, 0.45); T('square', 82, 0.9, 0.3); break;
      default: break;
    }
  }
}

export class Pinball {
  /** opts: { scene, city, world, audio, money: () => n, charge(n) -> bool, onReward(n), onEnd } */
  constructor(opts) {
    this.o = opts;
    this.mode = 'off';          // off | lobby | play | over
    this.hi = 0;
    try { this.hi = +(localStorage.getItem('auto-pinball-hi') || 0) || 0; } catch (e) { this.hi = 0; }
    this._storefront();
    this._buildDom();
    this.ptrs = new Map();
    this.keys = {};
    this.acc = 0;
    this.camY = H;
    this.dmdT = 0;
  }

  get active() { return this.mode !== 'off'; }

  // --- the storefront ---------------------------------------------------------------

  _storefront() {
    const { city, scene } = this.o;
    const best = streetFace(city, AT);
    this.face = best;
    const gy = city.groundAt(best.fx + best.nx * 1.5, best.fz + best.nz * 1.5, null);
    this.door = { x: best.fx + best.nx * 1.6, z: best.fz + best.nz * 1.6, y: gy };
    const cv = document.createElement('canvas'); cv.width = 768; cv.height = 512;
    const g = cv.getContext('2d');
    // painted brick
    g.fillStyle = '#23303a'; g.fillRect(0, 0, 768, 512);
    for (let y = 0; y < 512; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < 768; x += 32) { const v = 40 + Math.random() * 14; g.fillStyle = `rgb(${v},${v + 12},${v + 22})`; g.fillRect(x + 1, y + 1, 30, 14); }
    // the window: a row of machines, their backglasses lit
    g.fillStyle = '#070a10'; g.fillRect(36, 176, 480, 306);
    const bg = ['#ff5a3a', '#3ad8ff', '#ffd23a', '#b04aff', '#3aff8a'];
    for (let i = 0; i < 5; i++) {
      const x = 56 + i * 92;
      g.fillStyle = bg[i]; g.globalAlpha = 0.85; g.fillRect(x, 200, 72, 58); g.globalAlpha = 1;
      g.fillStyle = '#0008'; g.fillRect(x + 8, 244, 56, 9);
      g.fillStyle = '#fff'; g.globalAlpha = 0.3; g.fillRect(x, 200, 72, 4); g.globalAlpha = 1;
      // the cabinet and the playfield glass sloping toward you
      g.fillStyle = '#1a1422'; g.fillRect(x - 2, 258, 76, 18);
      g.fillStyle = '#12303a'; g.beginPath(); g.moveTo(x - 6, 276); g.lineTo(x + 78, 276); g.lineTo(x + 84, 330); g.lineTo(x - 12, 330); g.closePath(); g.fill();
      g.fillStyle = bg[(i + 2) % 5]; g.globalAlpha = 0.5; g.fillRect(x + 20, 290, 8, 8); g.fillRect(x + 44, 300, 8, 8); g.globalAlpha = 1;
      g.fillStyle = '#1a1422'; g.fillRect(x - 12, 330, 96, 12); g.fillRect(x - 8, 342, 8, 110); g.fillRect(x + 72, 342, 8, 110);
    }
    g.strokeStyle = '#b8c4cc'; g.lineWidth = 8; g.strokeRect(36, 176, 480, 306);
    g.fillStyle = '#ffffff1c'; g.fillRect(40, 180, 180, 298);
    // the door
    g.fillStyle = '#10161e'; g.fillRect(560, 200, 150, 300);
    g.strokeStyle = '#b8c4cc'; g.lineWidth = 8; g.strokeRect(560, 200, 150, 300);
    g.fillStyle = '#ffd23a'; g.font = '900 28px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('OPEN', 635, 262);
    g.fillStyle = '#cfd8de'; g.font = '700 16px Helvetica, Arial, sans-serif'; g.fillText('FREE PLAY', 635, 290); g.fillText('ALL AGES', 635, 312);
    // the neon
    g.shadowColor = '#ff5a3a'; g.shadowBlur = 24; g.fillStyle = '#ff8a6a';
    g.font = '900 92px Helvetica, Arial, sans-serif'; g.fillText('PINBALL', 384, 112);
    g.shadowColor = '#3ad8ff'; g.fillStyle = '#9aeeff'; g.font = '800 32px Helvetica, Arial, sans-serif';
    g.fillText('M U S E U M', 384, 156);
    g.shadowBlur = 0;
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.7 }));
    const at = storefrontSpot(city, best);
    m.position.set(at.x, at.y + 3.0, at.z);
    m.rotation.y = Math.atan2(best.nx, best.nz);
    m.name = 'pinballFront';
    scene.add(m);
    this.front = m;
    this.spot = { x: this.door.x, z: this.door.z };
  }

  near(pl) { return Math.hypot(pl.x - this.door.x, pl.z - this.door.z) < 4.5 && Math.abs(pl.y - this.door.y) < 2.5; }

  // --- the overlay ------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'pinUi';
    d.innerHTML = `
      <canvas class="pTable"></canvas>
      <div class="pSide"><canvas class="pDmd"></canvas><div class="pInfo"></div></div>
      <button class="pNudge">NUDGE</button><button class="pBack">✕</button>
      <div class="pHint"><span>◀ TAP · LEFT FLIPPER</span><span>RIGHT FLIPPER · TAP ▶<br>HOLD TO PULL THE PLUNGER</span></div>
      <div class="pPanel"></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #pinUi { position: absolute; inset: 0; z-index: 40; display: none; background: radial-gradient(ellipse at 50% 30%, #1a2230 0%, #07090e 70%), #07090e;
        font: 800 14px -apple-system, Helvetica, sans-serif; color: #fff; user-select: none; -webkit-user-select: none; touch-action: none; }
      #pinUi.show { display: block; }
      #pinUi .pTable { position: absolute; top: 0; left: 50%; transform: translateX(-50%); display: block; box-shadow: 0 0 0 4px #2a2f38, 0 0 0 7px #6a7280, 0 0 40px #000; }
      #pinUi .pSide { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 10px; pointer-events: none; }
      #pinUi .pDmd { display: block; background: #0c0602; border: 4px solid #1c1c1c; border-radius: 4px; box-shadow: 0 0 18px #ff6a0020; }
      #pinUi .pInfo { font-size: 11px; line-height: 1.5; opacity: .75; text-align: center; }
      #pinUi button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; border: none; color: #fff; font: 900 15px -apple-system, Helvetica, sans-serif; }
      #pinUi .pNudge { position: absolute; bottom: calc(14px + var(--safe-b, 0px)); right: calc(16px + var(--safe-r, 0px)); padding: 12px 18px; border-radius: 12px;
        background: #3a4250; box-shadow: 0 4px 0 #1a1e26; letter-spacing: .06em; }
      #pinUi .pNudge:active { transform: translateY(3px); box-shadow: none; }
      #pinUi .pBack { position: absolute; top: calc(8px + var(--safe-t, 0px)); right: calc(14px + var(--safe-r, 0px)); width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,.14); }
      #pinUi .pHint { position: absolute; left: 0; right: 0; bottom: calc(10px + var(--safe-b, 0px)); display: flex; justify-content: space-between; padding: 0 calc(16px + var(--safe-l, 0px));
        font-size: 10px; opacity: .45; pointer-events: none; }
      #pinUi .pHint span:last-child { text-align: right; margin-right: 96px; }
      #pinUi .pPanel { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: #000b; text-align: center; }
      #pinUi .pPanel.on { display: flex; }
      #pinUi .pPanel .big { font: 900 34px Helvetica, Arial, sans-serif; color: #ff8a6a; text-shadow: 0 0 14px #ff5a3a; letter-spacing: .06em; }
      #pinUi .pPanel .sub { font: 800 15px Helvetica, Arial, sans-serif; color: #9aeeff; letter-spacing: .3em; }
      #pinUi .pPanel .sm { font-size: 13px; opacity: .9; line-height: 1.5; }
      #pinUi .pPanel button { padding: 10px 26px; border-radius: 999px; background: #ff5a3a; } #pinUi .pPanel button.back { background: rgba(255,255,255,.18); }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { cv: q('.pTable'), side: q('.pSide'), dmd: q('.pDmd'), info: q('.pInfo'), panel: q('.pPanel'), nudge: q('.pNudge') };
    this.g = this.ui.cv.getContext('2d');
    this.dg = this.ui.dmd.getContext('2d');
    q('.pBack').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.close(); });
    this.ui.nudge.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this._nudgeReq = true; });
    // the flippers: each half of the screen, every finger tracked on its own
    const down = (e) => {
      if (this.mode !== 'play' || e.target.closest('button') || e.target.closest('.pPanel.on')) return;
      e.preventDefault();
      const side = e.clientX < window.innerWidth / 2 ? 'L' : 'R';
      const plunger = side === 'R' && this.table && !!this.table._waiting();
      this.ptrs.set(e.pointerId, { side, plunger });
      try { d.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    };
    const up = (e) => { this.ptrs.delete(e.pointerId); };
    d.addEventListener('pointerdown', down);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) d.addEventListener(ev, up);
    const map = { KeyZ: 'L', ShiftLeft: 'L', ArrowLeft: 'L', KeyM: 'R', ShiftRight: 'R', ArrowRight: 'R', Slash: 'R',
      Space: 'P', Enter: 'P', ArrowDown: 'P', ArrowUp: 'N', KeyN: 'N' };
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      if (e.code === 'Escape') this.close();
      else if (map[e.code]) {
        if (map[e.code] === 'N') { if (!e.repeat) this._nudgeReq = true; }
        else if ((this.mode === 'lobby' || this.mode === 'over') && map[e.code] === 'P' && !e.repeat) this._insert();
        else this.keys[map[e.code]] = true;
      } else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('keyup', (e) => { if (map[e.code]) this.keys[map[e.code]] = false; });
    window.addEventListener('resize', () => { if (this.active) this._fit(); });
  }

  // --- flow -----------------------------------------------------------------------------

  start() {
    this.mode = 'lobby';
    this.el.classList.add('show');
    this.beeper = this.beeper || new PinBeeper(this.o.audio && this.o.audio.ctx, this.o.audio && this.o.audio.master);
    if (!this.table) this.table = new Table();      // attract: a table standing idle
    this._fit();
    this._draw(0);
    this._panel(`<div class="big">EMERALD CITY</div><div class="sub">PINBALL MUSEUM</div>
      <div class="sm">Your cash $${this.o.money()} · $1 a game · three balls<br>${this.hi ? `High score ${this.hi.toLocaleString('en-US')}` : 'No high score yet'} · pays $1 per 100,000</div>
      <button class="go">PLAY $1</button><button class="back">LEAVE</button>`);
  }

  _panel(html) {
    const p = this.ui.panel;
    p.innerHTML = html;
    p.classList.add('on');
    const go = p.querySelector('.go'), back = p.querySelector('.back');
    if (go) go.addEventListener('click', () => this._insert());
    if (back) back.addEventListener('click', () => this.close());
  }

  _insert() {
    if (!this.o.charge(1)) { this.ui.panel.querySelector('.sm').textContent = 'Not enough cash for a game.'; return; }
    this.beeper.play('coin');
    this.table = new Table();
    this.mode = 'play';
    this.ui.panel.classList.remove('on');
    this.ptrs.clear();
    this.acc = 0;
    this.camY = H;
    this.overT = 0;
  }

  close() {
    this.mode = 'off';
    this.ptrs.clear();
    this.keys = {};
    this.el.classList.remove('show');
    this.ui.panel.classList.remove('on');
    if (this.o.onEnd) this.o.onEnd();
  }

  _gameOver() {
    const sc = this.table.score, prev = this.hi;
    const beat = sc > prev;
    const pay = Math.floor(sc / 100000) + (beat && prev > 0 ? 50 : 0);
    if (beat) { this.hi = sc; try { localStorage.setItem('auto-pinball-hi', String(sc)); } catch (e) { /* private */ } this.beeper.play('hiscore'); }
    if (pay > 0 && this.o.onReward) this.o.onReward(pay);
    this.mode = 'over';
    this.lastPay = pay;
    this._panel(`<div class="big">GAME OVER</div><div class="sm">SCORE ${sc.toLocaleString('en-US')}<br>${beat ? (prev > 0 ? 'NEW HIGH SCORE! +$50' : 'FIRST HIGH SCORE ON THIS MACHINE') : `HIGH SCORE ${prev.toLocaleString('en-US')}`}<br>${pay > 0 ? `The museum pays $${pay}` : ''}</div>
      <button class="go">PLAY AGAIN $1</button><button class="back">LEAVE</button>`);
  }

  // --- layout -----------------------------------------------------------------------------

  _fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const availH = vh - 12;
    let s = Math.min(availH / VIEW_H, (vw * 0.46) / W);
    let viewH = availH / s;
    if (viewH >= H) { s = Math.min(availH / H, (vw * 0.46) / W); viewH = Math.min(H, availH / s); }
    this.s = s; this.viewH = viewH; this.dpr = dpr;
    const cw = Math.round(W * s), ch = Math.round(viewH * s);
    const cv = this.ui.cv;
    cv.style.width = `${cw}px`; cv.style.height = `${ch}px`; cv.style.top = `${Math.round((vh - ch) / 2)}px`;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    // the display: beside the table where there is room, over its top otherwise
    const side = (vw - cw) / 2;
    const dw = Math.max(140, Math.min(side - 28, 300)), dh = Math.round(dw / 4);
    const dm = this.ui.dmd;
    dm.style.width = `${dw}px`; dm.style.height = `${dh}px`;
    dm.width = Math.round(dw * dpr); dm.height = Math.round(dh * dpr);
    const sd = this.ui.side;
    if (side > 160) { sd.style.left = `${Math.round((side - dw) / 2)}px`; sd.style.top = `${Math.round(vh / 2 - dh / 2 - 20)}px`; sd.style.width = `${dw}px`; }
    else { sd.style.left = `${Math.round(vw / 2 - dw / 2)}px`; sd.style.top = '6px'; sd.style.width = `${dw}px`; }
    this._staticLayer();
    this._dmdCache = null;
  }

  // --- the frame ------------------------------------------------------------------------

  _input() {
    let L = !!this.keys.L, Rr = !!this.keys.R, P = !!this.keys.P;
    for (const p of this.ptrs.values()) {
      if (p.side === 'L') L = true;
      else if (p.plunger) P = true;
      else Rr = true;
    }
    const nudge = !!this._nudgeReq;
    this._nudgeReq = false;
    return { left: L, right: Rr, plunge: P, nudge };
  }

  update(dt) {
    if (this.mode === 'off') return;
    const t = this.table;
    if (this.mode === 'play' && t && !this.frozen) {
      this.acc = Math.min(this.acc + dt, 0.1);
      while (this.acc >= STEP) {
        this.acc -= STEP;
        t.step(STEP, this._input());
        for (const e of t.takeEvents()) this.beeper.play(e);
      }
      if (t.over) { this.overT += dt; if (this.overT > 1.2) this._gameOver(); }
    }
    // the camera: the lowest ball, led toward where it is going
    let fy = t ? t.focusY() : H, low = null;
    if (t) for (const b of t.balls) if (!b.ramp && !b.held && (!low || b.y > low.y)) low = b;
    if (low && low.y >= fy - 1) fy = low.y + Math.max(-80, Math.min(160, low.vy * 0.12));
    const want = Math.max(0, Math.min(H - this.viewH, fy - this.viewH * 0.32));
    this.camY += (want - this.camY) * Math.min(1, dt * 7);
    this._draw(dt);
  }

  // --- drawing ----------------------------------------------------------------------------

  /** The playfield that never changes, at the screen's scale. */
  _staticLayer() {
    const k = this.s * this.dpr;
    const cv = this.stat || (this.stat = document.createElement('canvas'));
    cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    const g = cv.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    // the wood under the art, and the art: an emerald night over the Sound
    const bgGrad = g.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#08322a'); bgGrad.addColorStop(0.5, '#0d5040'); bgGrad.addColorStop(1, '#062a22');
    g.fillStyle = bgGrad; g.fillRect(0, 0, W, H);
    // rain streaks
    g.strokeStyle = '#ffffff10'; g.lineWidth = 1;
    let sd = 7;
    const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 160; i++) { const x = rnd() * W, y = rnd() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 4, y + 14); g.stroke(); }
    // Rainier behind the bumpers
    g.fillStyle = '#ffffff14';
    g.beginPath(); g.moveTo(90, 330); g.lineTo(170, 250); g.lineTo(196, 236); g.lineTo(222, 250); g.lineTo(310, 330); g.closePath(); g.fill();
    g.fillStyle = '#ffffff22';
    g.beginPath(); g.moveTo(170, 250); g.lineTo(196, 236); g.lineTo(222, 250); g.lineTo(208, 262); g.lineTo(196, 252); g.lineTo(184, 264); g.closePath(); g.fill();
    // the skyline and the Needle, gold on green
    g.fillStyle = '#e8c35a26';
    const sky = [[70, 520], [70, 470], [92, 470], [92, 440], [110, 440], [110, 490], [128, 490], [128, 420], [150, 410], [150, 500], [236, 500], [236, 430], [256, 430], [256, 460], [276, 460], [276, 410], [296, 420], [296, 520]];
    g.beginPath(); g.moveTo(sky[0][0], sky[0][1]); for (const p of sky) g.lineTo(p[0], p[1]); g.closePath(); g.fill();
    g.fillStyle = '#e8c35a40';
    g.beginPath(); g.moveTo(180, 520); g.lineTo(190, 430); g.lineTo(184, 400); g.lineTo(208, 400); g.lineTo(202, 430); g.lineTo(212, 520); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(196, 396, 30, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(194, 370, 4, 22);
    // the title across the middle
    g.save(); g.translate(196, 548);
    g.font = '900 22px Georgia, "Times New Roman", serif'; g.textAlign = 'center';
    g.fillStyle = '#00000060'; g.fillText('EMERALD CITY', 2, 2);
    const tg = g.createLinearGradient(0, -20, 0, 4); tg.addColorStop(0, '#fff6c8'); tg.addColorStop(1, '#e0a830');
    g.fillStyle = tg; g.fillText('EMERALD CITY', 0, 0);
    g.restore();
    // the shooter lane's floor
    g.fillStyle = '#041a14'; g.fillRect(SHOOTER.x0, 240, SHOOTER.x1 - SHOOTER.x0, H - 240);
    // the saucer
    g.fillStyle = '#000'; g.beginPath(); g.arc(SAUCER.x, SAUCER.y, SAUCER.r + 2, 0, Math.PI * 2); g.fill();
    const sg = g.createRadialGradient(SAUCER.x - 3, SAUCER.y - 3, 1, SAUCER.x, SAUCER.y, SAUCER.r + 4);
    sg.addColorStop(0, '#000'); sg.addColorStop(0.7, '#111'); sg.addColorStop(1, '#9aa4ae');
    g.strokeStyle = sg; g.lineWidth = 3; g.beginPath(); g.arc(SAUCER.x, SAUCER.y, SAUCER.r + 2, 0, Math.PI * 2); g.stroke();
    // the apron
    const ap = g.createLinearGradient(0, 764, 0, H); ap.addColorStop(0, '#2a2f38'); ap.addColorStop(1, '#14171c');
    g.fillStyle = ap;
    g.beginPath(); g.moveTo(15, H); g.lineTo(15, 770); g.lineTo(45, 770); g.lineTo(106, 770); g.quadraticCurveTo(186, 790, 266, 770); g.lineTo(357, 770); g.lineTo(357, H); g.closePath(); g.fill();
    g.fillStyle = '#e0a830'; g.font = '800 9px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('SEA LANES ADVANCE BONUS X · DROP THE BANK TO LIGHT LOCK', 186, 793);
    // rails: the head, the walls, the guides
    const rail = (pts, w, col, hi) => {
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = '#0008'; g.lineWidth = w + 2; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0] + 1, p[1] + 1.5) : g.moveTo(p[0] + 1, p[1] + 1.5))); g.stroke();
      g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
      if (hi) { g.strokeStyle = hi; g.lineWidth = Math.max(1, w * 0.3); g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0] - w * 0.2, p[1] - w * 0.2) : g.moveTo(p[0] - w * 0.2, p[1] - w * 0.2))); g.stroke(); }
    };
    rail(TOP_PTS, 5, '#9aa4ae', '#e8eef2');
    rail([[SHOOTER.x0, 240], [SHOOTER.x0, H]], 4, '#9aa4ae', '#e8eef2');
    rail([[389, 215], [357, 240]], 2, '#c8d0d6');
    rail([[ORBIT_X, ORBIT_Y1], [ORBIT_X, ORBIT_Y0]], 5, '#8a6a3a', '#c89a5a');
    rail([[RAMP_X0, 450], [RAMP_X0, 332]], 5, '#8a6a3a', '#c89a5a');
    for (const gd of GUIDES) rail(gd, 4, '#9aa4ae', '#e8eef2');
    // the top lanes' posts, rubber-ringed
    for (const x of LANE_GUIDES) {
      rail([[x, LANE_Y0], [x, LANE_Y1]], 6, '#d8d0c0');
      for (const y of [LANE_Y0, LANE_Y1]) { g.fillStyle = '#f4f4f4'; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#c03030'; g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill(); }
    }
    // the lane letters
    g.font = '900 11px Helvetica, Arial, sans-serif'; g.textAlign = 'center';
    for (const l of LANES) { g.fillStyle = '#ffffff50'; g.fillText(l.lbl, l.x, 88); }
    // the slings' plastics
    SLINGS.forEach((sl) => {
      const [a, b, c] = sl.pts;
      g.fillStyle = '#28c89a88'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath(); g.fill();
      g.strokeStyle = '#f4f4f4'; g.lineWidth = 3.5; g.stroke();
    });
    // the ramp's entrance: its floor and flap
    g.fillStyle = '#1a3a6a80'; g.fillRect(RAMP_X0 + 3, 300, RAMP_X1 - RAMP_X0 - 5, 60);
    g.strokeStyle = '#b8c4cc'; g.lineWidth = 3; g.beginPath(); g.moveTo(RAMP_X0, 332); g.lineTo(RAMP_X1, 302); g.stroke();
    // the drop targets' bank plate
    g.fillStyle = '#1a1a1a'; g.fillRect(DROP_X - 2, DROPS[0].y0 - 4, 6, DROPS[2].y1 - DROPS[0].y0 + 8);
  }

  _draw(dt) {
    const g = this.g, t = this.table;
    if (!t || !this.stat) return;
    const k = this.s * this.dpr;
    const cv = this.ui.cv;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    const oy = Math.round(this.camY * k);
    g.drawImage(this.stat, 0, -oy);
    g.setTransform(k, 0, 0, k, 0, -this.camY * k);
    const now = t.t, blink = (hz) => Math.floor(now * hz) % 2 === 0;
    // --- lamps ---
    const lamp = (x, y, r, col, on, txt) => {
      g.fillStyle = on ? col : '#00000070';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      if (on) { g.fillStyle = '#ffffff90'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = on ? '#fff8' : col + '60'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      if (txt) { g.fillStyle = on ? '#200' : '#ffffff70'; g.font = '800 6px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.fillText(txt, x, y + 2.2); }
    };
    const arrow = (x, y, ang, col, on, txt) => {
      g.save(); g.translate(x, y); g.rotate(ang);
      g.fillStyle = on ? col : '#00000070'; g.strokeStyle = on ? '#fffa' : col + '70'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(0, -16); g.lineTo(11, 0); g.lineTo(5, 0); g.lineTo(5, 12); g.lineTo(-5, 12); g.lineTo(-5, 0); g.lineTo(-11, 0); g.closePath(); g.fill(); g.stroke();
      g.restore();
      if (txt) { g.fillStyle = on ? '#fff' : '#ffffff60'; g.font = '800 7px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.fillText(txt, x, y + 24); }
    };
    // top lanes (and the skill shot)
    for (let i = 0; i < 3; i++) {
      const skill = t.state === 'plunge' && t.skillLane === i;
      lamp(LANES[i].x, 132, 7, '#ffd23a', t.lanes[i] || (skill && blink(6)) || (t.laneFlash > 0 && blink(12)), LANES[i].lbl);
    }
    // bonus X
    for (let i = 2; i <= 6; i++) lamp(126 + (i - 2) * 30, 578, 7, '#ff7a3a', t.bonusX >= i, `${i}X`);
    // lock, extra ball
    arrow(SAUCER.x, SAUCER.y + 44, 0, '#3ad8ff', t.lockLit && blink(3), t.multiball ? 'MULTIBALL' : t.lockLit ? 'LOCK' : `LOCKED ${t.locked}`);
    lamp(SAUCER.x - 30, SAUCER.y + 26, 6, '#b04aff', t.ebLit && blink(2), 'EB');
    lamp(SAUCER.x + 30, SAUCER.y + 26, 6, '#3ad8ff', t.locked >= 1 || t.multiball, 'L1');
    // the ramp: RAMP / JACKPOT
    arrow(RAMP_X0 + 28, 420, 0, t.jackpot ? '#ff3a5a' : '#3a8aff', t.jackpot ? blink(5) : (t.t < (t._comboEnd || 0) ? blink(4) : true), t.jackpot ? 'JACKPOT' : 'NEEDLE');
    // the orbit
    arrow(ORBIT_X - 21, 452, 0, '#7aff5a', t.t < (t._comboEnd || 0) ? blink(4) : false, '');
    // kickback, shoot again
    lamp(30, 640, 6, '#ff3a3a', t.kickback, 'KB');
    lamp(186, 752, 8, '#ff3a3a', t.extra > 0 || (t.save > 0 && t.state === 'play' && blink(3)), 'AGAIN');
    // --- the drop targets ---
    DROPS.forEach((dr, i) => {
      if (t.drops[i]) { g.fillStyle = '#00000080'; g.fillRect(DROP_X - 1, dr.y0, 4, dr.y1 - dr.y0); return; }
      g.fillStyle = '#ffd23a'; g.fillRect(DROP_X - 3, dr.y0, 8, dr.y1 - dr.y0);
      g.fillStyle = '#6a4a00'; g.font = '900 7px Helvetica, Arial, sans-serif'; g.textAlign = 'center';
      g.fillText('PNW'[i], DROP_X + 1, (dr.y0 + dr.y1) / 2 + 2.5);
    });
    // --- the spinner ---
    const sw = Math.abs(Math.cos(t.spin.a * Math.PI * 2));
    g.fillStyle = '#c8d0d6'; g.fillRect(17, SPINNER_Y - 3 * sw, ORBIT_X - 19, Math.max(1, 6 * sw));
    g.fillStyle = '#222'; g.fillRect(15, SPINNER_Y - 1, ORBIT_X - 15, 2);
    // --- the bumpers ---
    BUMPERS.forEach((m, i) => {
      const f = t.bumpFlash[i] > 0;
      g.fillStyle = '#0006'; g.beginPath(); g.arc(m.x + 2, m.y + 3, m.r + 1, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8e8e8'; g.beginPath(); g.arc(m.x, m.y, m.r, 0, Math.PI * 2); g.fill();
      g.fillStyle = f ? '#fff6a0' : '#c02838'; g.beginPath(); g.arc(m.x, m.y, m.r - 3, 0, Math.PI * 2); g.fill();
      const cg = g.createRadialGradient(m.x - 5, m.y - 6, 2, m.x, m.y, m.r - 5);
      cg.addColorStop(0, f ? '#ffffff' : '#ffe8a0'); cg.addColorStop(1, f ? '#ffd23a' : '#e0a830');
      g.fillStyle = cg; g.beginPath(); g.arc(m.x, m.y, m.r - 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = f ? '#c02838' : '#7a4a10'; g.font = '900 8px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('RAIN', m.x, m.y + 3);
    });
    // --- the slings' kickers ---
    SLINGS.forEach((sl, i) => {
      if (t.slingFlash[i] <= 0) return;
      g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.beginPath(); g.moveTo(sl.kick[0][0], sl.kick[0][1]); g.lineTo(sl.kick[1][0], sl.kick[1][1]); g.stroke();
    });
    // --- the plunger ---
    const pull = t.plunge * 26;
    g.fillStyle = '#c8d0d6'; g.fillRect(SHOOTER.x - 4, SHOOTER.plunger + pull, 8, 30);
    g.fillStyle = '#e03030'; g.fillRect(SHOOTER.x - 9, SHOOTER.plunger + pull, 18, 5);
    g.strokeStyle = '#8a9298'; g.lineWidth = 1.5; g.beginPath();
    for (let i = 0; i <= 8; i++) g.lineTo(SHOOTER.x + (i % 2 ? 6 : -6), SHOOTER.plunger + 6 + pull + i * (22 - pull * 0.6) / 8);
    g.stroke();
    // --- the flippers ---
    for (const f of t.flips) {
      const ex = Math.cos(f.a), ey = Math.sin(f.a), tx = f.x + ex * FLIP_LEN, ty = f.y + ey * FLIP_LEN;
      const nx = -ey, ny = ex;
      const shape = (r0, r1, dx, dy) => {
        g.beginPath();
        g.moveTo(f.x + nx * r0 + dx, f.y + ny * r0 + dy); g.lineTo(tx + nx * r1 + dx, ty + ny * r1 + dy);
        g.arc(tx + dx, ty + dy, r1, f.a + Math.PI / 2, f.a - Math.PI / 2, true);
        g.lineTo(f.x - nx * r0 + dx, f.y - ny * r0 + dy);
        g.arc(f.x + dx, f.y + dy, r0, f.a - Math.PI / 2, f.a + Math.PI / 2, true);
        g.closePath();
      };
      g.fillStyle = '#0007'; shape(FLIP_R0, FLIP_R1, 2, 3); g.fill();
      g.fillStyle = '#c02838'; shape(FLIP_R0, FLIP_R1, 0, 0); g.fill();
      g.fillStyle = '#f6f6f2'; shape(FLIP_R0 - 2.2, FLIP_R1 - 2.2, 0, 0); g.fill();
      g.fillStyle = '#c8c8c0'; g.beginPath(); g.arc(f.x, f.y, 3, 0, Math.PI * 2); g.fill();
    }
    // --- balls on the playfield, then the ramp over them, then balls on the ramp ---
    const ball = (x, y, big) => {
      const r = R * (big ? 1.18 : 1);
      g.fillStyle = '#0008'; g.beginPath(); g.arc(x + (big ? 6 : 2.5), y + (big ? 8 : 3.5), r, 0, Math.PI * 2); g.fill();
      const bg2 = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      bg2.addColorStop(0, '#ffffff'); bg2.addColorStop(0.35, '#d6dde2'); bg2.addColorStop(0.8, '#6a747c'); bg2.addColorStop(1, '#3a4248');
      g.fillStyle = bg2; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8c35a55'; g.beginPath(); g.arc(x + r * 0.3, y + r * 0.45, r * 0.3, 0, Math.PI * 2); g.fill();
    };
    for (const b of t.balls) if (!b.ramp) ball(b.x, b.y, false);
    this._drawRamp(g);
    for (const b of t.balls) if (b.ramp) { const q = rampAt(b.ramp.s); ball(q.x, q.y, true); }
    this._dmd(dt);
  }

  _drawRamp(g) {
    const p = RAMP_PATH.p;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const path = () => { g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); };
    g.strokeStyle = '#0005'; g.lineWidth = 30; g.save(); g.translate(5, 7); path(); g.stroke(); g.restore();
    g.strokeStyle = '#3a8affa0'; g.lineWidth = 28; path(); g.stroke();
    g.strokeStyle = '#9ad0ff60'; g.lineWidth = 20; path(); g.stroke();
    // the chrome wire edges
    for (const side of [-1, 1]) {
      g.strokeStyle = '#e8eef2'; g.lineWidth = 1.6; g.beginPath();
      for (let i = 0; i < p.length; i++) {
        const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        const x = p[i][0] - dy / L * 14 * side, y = p[i][1] + dx / L * 14 * side;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    // a decal on the ramp's crown
    g.save(); g.translate(202, 30); g.fillStyle = '#fff'; g.font = '900 11px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('THE NEEDLE', 0, 0); g.restore();
  }

  // --- the dot-matrix display ---------------------------------------------------------------

  _dmd(dt) {
    this.dmdT += dt;
    const t = this.table;
    if (this.dmdT < 1 / 20 && this._dmdCache) return;
    this.dmdT = 0;
    const m = t.msgs.length ? t.msgs[t.msgs.length - 1] : null;
    let a, b;
    if (this.mode === 'lobby') { a = this.hi ? this.hi.toLocaleString('en-US') : 'EMERALD CITY'; b = this.hi ? 'HIGH SCORE' : 'INSERT $1'; }
    else if (t.state === 'bonus') { a = (t.bonusShown || 0).toLocaleString('en-US'); b = m && m.b ? `${m.a} ${m.b}` : 'BONUS'; }
    else if (m && Math.floor(t.t * 4) % 6 !== 5) { a = m.a; b = m.b || t.score.toLocaleString('en-US'); }
    else { a = t.score.toLocaleString('en-US'); b = `BALL ${t.ball}${t.extra ? ' · SHOOT AGAIN' : ''}${t.tilted ? ' · TILT' : ''}`; }
    const key = `${a}|${b}`;
    if (key === this._dmdCache) return;
    this._dmdCache = key;
    // render the text at the display's own resolution, then read it back as dots
    const DW = 128, DH = 32;
    const src = this._dmdSrc || (this._dmdSrc = document.createElement('canvas'));
    src.width = DW; src.height = DH;
    const sg = src.getContext('2d', { willReadFrequently: true });
    sg.clearRect(0, 0, DW, DH);
    sg.fillStyle = '#fff'; sg.textAlign = 'center'; sg.textBaseline = 'alphabetic';
    let fs = 18;
    sg.font = `900 ${fs}px Helvetica, Arial, sans-serif`;
    while (sg.measureText(a).width > DW - 4 && fs > 9) { fs--; sg.font = `900 ${fs}px Helvetica, Arial, sans-serif`; }
    sg.fillText(a, DW / 2, 19);
    sg.font = '700 8px Helvetica, Arial, sans-serif';
    sg.fillText(b, DW / 2, 30);
    const data = sg.getImageData(0, 0, DW, DH).data;
    const g = this.dg, cw = this.ui.dmd.width, ch = this.ui.dmd.height;
    const px = cw / DW, py = ch / DH, r = Math.min(px, py) * 0.42;
    g.fillStyle = '#0c0602'; g.fillRect(0, 0, cw, ch);
    const lv = ['#2a1206', '#7a3408', '#c85a10', '#ff8a2a'];
    for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
      const al = data[(y * DW + x) * 4 + 3];
      const l = al > 200 ? 3 : al > 110 ? 2 : al > 40 ? 1 : 0;
      g.fillStyle = lv[l];
      g.fillRect(x * px + (px - 2 * r) / 2, y * py + (py - 2 * r) / 2, 2 * r, 2 * r);
    }
    const info = this.ui.info;
    const txt = this.mode === 'play' ? `BALL ${t.ball} OF 3 · BONUS ${t.bonusX}X${t.locked ? ` · ${t.locked} LOCKED` : ''}` : '';
    if (info.textContent !== txt) info.textContent = txt;
  }
}
