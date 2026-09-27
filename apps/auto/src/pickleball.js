// PICKLEBALL on Bainbridge Island, where the game was invented in 1965: a
// regulation court on open ground near Rockaway Beach (fenced, the kitchen
// in green, a sign saying so), and ENTER on it plays a singles game against
// the island's resident champion (pickleballgame.js has the rules).
//
// The overlay draws the court from behind your baseline in perspective. Drag
// on the left half of the screen (or the stick keys: WASD / arrows) to move;
// DINK, DRIVE and LOB swing the paddle (J, K, L), and serve. When you swing
// matters: a ball in the middle of your reach is struck clean, one at the
// edge of it is a mishit. The ball goes where you are moving across the
// court. A win pays $150 and $10 a point (localStorage 'auto-pickle-best').

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { Beeper } from './arcade.js';
import { Pickleball, COURT, REACH } from './pickleballgame.js';

const STEP = 1 / 60;
// Rockaway Beach Road, Bainbridge's east shore (the site searched round it)
const SITE = { x: -12420, z: 2640 };
const CW = 9.2, CL = 18.3;                   // the paved surround, the court centred in it

class PickleSound extends Beeper {
  play(name) {
    if (!this.c) return;
    const now = this.c.currentTime;
    if (this.last[name] && now - this.last[name] < 0.03) return;
    this.last[name] = now;
    const T = this.tone.bind(this), N = this.noise.bind(this);
    switch (name) {
      case 'pop': T('triangle', 880, 0.05, 0.7, 520); N(0.03, 0.4, 3000); break;
      case 'drive': T('triangle', 760, 0.06, 0.85, 380); N(0.04, 0.55, 3500); break;
      case 'bounce': T('sine', 330, 0.05, 0.4, 200); break;
      case 'net': N(0.12, 0.5, 700); break;
      case 'whiff': N(0.08, 0.2, 1800); break;
      case 'out': case 'fault': T('square', 196, 0.25, 0.3, 150); break;
      case 'win': T('square', 660, 0.08, 0.3); T('square', 880, 0.12, 0.3, 0, 0.09); break;
      case 'lose': T('triangle', 262, 0.3, 0.4, 196); break;
      case 'over': T('square', 523, 0.15, 0.3); T('square', 659, 0.15, 0.3, 0, 0.15); T('square', 784, 0.3, 0.3, 0, 0.3); break;
      default: break;
    }
  }
}

export class PickleballCourt {
  /** opts: { scene, city, world, audio, onReward(n), onEnd } */
  constructor(opts) {
    this.o = opts;
    this.mode = 'off';
    this.best = 0;
    try { this.best = +(localStorage.getItem('auto-pickle-best') || 0); } catch (e) { /* private mode */ }
    this.court = this._site();
    if (this.court) this._build();
    this._buildDom();
    this.keys = {};
    this.stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
  }
  get active() { return this.mode !== 'off'; }

  /** Open, dry, level ground for the court nearest the site: off the roads,
   *  out of the buildings, under 0.8 m of fall across it. */
  _site() {
    const city = this.o.city;
    const inBld = (x, z) => city.buildingsNear(x, z, 30).some((b) => {
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
      return Math.abs(dx * c - dz * s) < b.w / 2 + 2 && Math.abs(dx * s + dz * c) < b.d / 2 + 2;
    });
    let best = null, bd = Infinity;
    for (let r = 0; r <= 360; r += 12) {
      for (let k = 0; k < Math.max(1, Math.round(r / 6)); k++) {
        const a = (k / Math.max(1, Math.round(r / 6))) * Math.PI * 2;
        const x = SITE.x + Math.cos(a) * r, z = SITE.z + Math.sin(a) * r;
        if (Math.abs(x) > 12900) continue;
        for (const h of [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4]) {
          const fx = Math.sin(h), fz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
          let lo = Infinity, hi = -Infinity, ok = true;
          for (let u = -1; u <= 1 && ok; u += 0.5) for (let v = -1; v <= 1 && ok; v += 0.5) {
            const px = x + lx * u * (CW / 2 + 1) + fx * v * (CL / 2 + 1), pz = z + lz * u * (CW / 2 + 1) + fz * v * (CL / 2 + 1);
            if (G.isWater(px, pz) || city.onRoad(px, pz, 2) || inBld(px, pz)) { ok = false; break; }
            const y = G.terrainHeight(px, pz); lo = Math.min(lo, y); hi = Math.max(hi, y);
          }
          if (!ok || hi - lo > 0.8) continue;
          if (r < bd) { bd = r; best = { x, z, h, y: hi + 0.08 }; }
        }
      }
      if (best) break;
    }
    return best;
  }

  _build() {
    const { x, z, h, y } = this.court, b = new Builder(false);
    const fx = Math.sin(h), fz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
    const P = (u, v, yy = y) => [x + lx * u + fx * v, yy, z + lz * u + fz * v];
    const up = [0, 1, 0], uv = [0, 0, 1, 0, 1, 1, 0, 1];
    const rect = (u0, v0, u1, v1, col, dy = 0) => b.quad(P(u0, v0, y + dy), P(u1, v0, y + dy), P(u1, v1, y + dy), P(u0, v1, y + dy), up, uv, col);
    // the slab and its skirts down to the ground
    rect(-CW / 2, -CL / 2, CW / 2, CL / 2, [0.16, 0.34, 0.3]);
    for (const [u0, v0, u1, v1] of [[-CW / 2, -CL / 2, CW / 2, -CL / 2], [CW / 2, -CL / 2, CW / 2, CL / 2], [CW / 2, CL / 2, -CW / 2, CL / 2], [-CW / 2, CL / 2, -CW / 2, -CL / 2]]) {
      const a = P(u0, v0), c = P(u1, v1);
      b.quad(a, c, [c[0], G.terrainHeight(c[0], c[2]) - 0.3, c[2]], [a[0], G.terrainHeight(a[0], a[2]) - 0.3, a[2]], [a[0] - x, 0, a[2] - z], uv, [0.5, 0.5, 0.48]);
    }
    // the court in blue, the kitchen in green, the lines in white
    rect(-COURT.hw, -COURT.hl, COURT.hw, COURT.hl, [0.12, 0.3, 0.55], 0.004);
    rect(-COURT.hw, -COURT.kitchen, COURT.hw, COURT.kitchen, [0.14, 0.44, 0.26], 0.006);
    const L = 0.025, W = [0.95, 0.95, 0.93];
    for (const v of [-COURT.hl, -COURT.kitchen, COURT.kitchen, COURT.hl]) rect(-COURT.hw, v - L, COURT.hw, v + L, W, 0.009);
    for (const u of [-COURT.hw, COURT.hw]) rect(u - L, -COURT.hl, u + L, COURT.hl, W, 0.009);
    for (const s of [-1, 1]) rect(-L, s * COURT.kitchen, L, s * COURT.hl, W, 0.009);
    // the net: posts, the mesh, the white tape
    for (const u of [-COURT.hw - 0.3, COURT.hw + 0.3]) b.tube(P(u, 0), P(u, 0, y + 0.92), 0.04, 8, [0.2, 0.2, 0.22], true);
    for (let k = 0; k < 8; k++) {
      const yy = y + 0.12 + k * 0.1;
      b.tube(P(-COURT.hw - 0.3, 0, yy), P(COURT.hw + 0.3, 0, yy), 0.006, 3, [0.08, 0.08, 0.09], false);
    }
    for (let u = -COURT.hw; u <= COURT.hw; u += 0.2) b.tube(P(u, 0, y + 0.1), P(u, 0, y + 0.86 + Math.abs(u) / COURT.hw * 0.05), 0.005, 3, [0.08, 0.08, 0.09], false);
    b.tube(P(-COURT.hw - 0.3, 0, y + 0.91), P(0, 0, y + 0.87), 0.025, 6, W, false);
    b.tube(P(0, 0, y + 0.87), P(COURT.hw + 0.3, 0, y + 0.91), 0.025, 6, W, false);
    // the fence: posts and a top rail round the surround
    const corners = [[-CW / 2, -CL / 2], [CW / 2, -CL / 2], [CW / 2, CL / 2], [-CW / 2, CL / 2]];
    for (let i = 0; i < 4; i++) {
      const [u0, v0] = corners[i], [u1, v1] = corners[(i + 1) % 4];
      const n = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 3);
      for (let k = 0; k <= n; k++) {
        const u = u0 + (u1 - u0) * k / n, v = v0 + (v1 - v0) * k / n;
        if (i === 0 && Math.abs(u) < 0.8) continue;       // the gate
        b.tube(P(u, v), P(u, v, y + 3), 0.03, 6, [0.25, 0.27, 0.28], true);
      }
      b.tube(P(u0, v0, y + 3), P(u1, v1, y + 3), 0.025, 6, [0.25, 0.27, 0.28], false);
      b.tube(P(u0, v0, y + 1.2), P(u1, v1, y + 1.2), 0.015, 5, [0.25, 0.27, 0.28], false);
    }
    // a bench by the gate with two paddles on it
    const bu = -CW / 2 + 0.6, bv = -CL / 2 + 2;
    b.box(...P(bu, bv), 0.5, 0.45, 1.8, -h, [0.45, 0.3, 0.18]);
    for (const dv of [-0.3, 0.3]) b.box(...P(bu, bv + dv, y + 0.46), 0.2, 0.02, 0.38, -h, [0.9, 0.3, 0.2]);
    this.mesh = new THREE.Mesh(b.build(), this.o.world.mats.flat);
    this.mesh.name = 'pickleball';
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.o.scene.add(this.mesh);
    // the sign on the fence by the gate
    {
      const c = document.createElement('canvas'); c.width = 512; c.height = 160;
      const g = c.getContext('2d');
      g.fillStyle = '#1f5a3a'; g.fillRect(0, 0, 512, 160);
      g.strokeStyle = '#f2e6b0'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 144);
      g.fillStyle = '#f2e6b0'; g.textAlign = 'center';
      g.font = '900 44px Georgia, serif'; g.fillText('PICKLEBALL', 256, 62);
      g.font = '700 21px Georgia, serif'; g.fillText('Invented on Bainbridge Island, 1965', 256, 100);
      g.font = '700 18px Georgia, serif'; g.fillText('Walk on and press ENTER to play', 256, 132);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.6), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      const [sx, sy, sz] = P(1.6, -CL / 2 - 0.03, y + 1.7);
      m.position.set(sx, sy, sz); m.rotation.y = h + Math.PI;
      m.name = 'pickleball:sign';
      this.o.scene.add(m);
      this.sign = m;
    }
    // walkable: the slab is a platform
    const city = this.o.city;
    if (city.setPlatforms) city.setPlatforms([...(city.platforms || []), { x, z, hw: CW / 2, hd: CL / 2, rot: -h, y0: y, y1: y }]);
  }

  /** On the court (or in its gate). */
  near(pl) {
    if (!this.court) return false;
    const { x, z, h, y } = this.court;
    const dx = pl.x - x, dz = pl.z - z;
    const u = dx * Math.cos(h) - dz * Math.sin(h), v = dx * Math.sin(h) + dz * Math.cos(h);
    return Math.abs(u) < CW / 2 + 1 && Math.abs(v) < CL / 2 + 2 && Math.abs(pl.y - y) < 2.5;
  }

  update(dt) {
    if (this.mesh) {
      const p = this.o.player ? this.o.player.position : null;
      const vis = !p || Math.hypot(p.x - this.court.x, p.z - this.court.z) < 700;
      this.mesh.visible = vis; if (this.sign) this.sign.visible = vis;
    }
    if (this.mode === 'off') return;
    const gm = this.game;
    if (this.mode === 'play' && gm && !this.frozen) {
      this.acc = Math.min(this.acc + dt, 0.2);
      while (this.acc >= STEP) {
        this.acc -= STEP;
        gm.step(STEP, this._input());
        this.shot = null;
        for (const e of gm.takeEvents()) this.snd.play(e);
        if (gm.state === 'over') { this._over(); break; }
      }
    }
    this._draw();
  }

  _input() {
    const k = this.keys, st = this.stick;
    let mx = st.x, my = st.y;
    if (k.KeyA || k.ArrowLeft) mx = -1; if (k.KeyD || k.ArrowRight) mx = 1;
    if (k.KeyW || k.ArrowUp) my = 1; if (k.KeyS || k.ArrowDown) my = -1;
    const P = this.game.p[0];
    // the ball goes where you are moving across the court, else back to the middle
    const aimX = Math.max(-1, Math.min(1, mx * 0.9 - P.x / COURT.hw * 0.4));
    return { mx, my, shot: this.shot, aimX };
  }

  // --- the overlay ---------------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'pickleUi';
    d.innerHTML = `<canvas class="pScene"></canvas>
      <div class="pHud"></div>
      <div class="pBtns"><button data-s="lob">LOB<i>L</i></button><button data-s="dink">DINK<i>J</i></button><button data-s="drive">DRIVE<i>K</i></button></div>
      <button class="pMenu">II</button>
      <div class="pPanel"></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #pickleUi { position: absolute; inset: 0; z-index: 40; display: none; background: #2c5a36; user-select: none; -webkit-user-select: none; touch-action: none;
        font: 800 13px -apple-system, Helvetica, sans-serif; color: #fff; }
      #pickleUi.show { display: block; }
      #pickleUi .pScene { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
      #pickleUi .pHud { position: absolute; top: calc(8px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%); pointer-events: none;
        font: 900 20px -apple-system, Helvetica, sans-serif; text-shadow: 0 2px 0 #0008; white-space: nowrap; }
      #pickleUi .pBtns { position: absolute; right: calc(14px + var(--safe-r, 0px)); bottom: calc(14px + var(--safe-b, 0px)); display: flex; gap: 10px; align-items: flex-end; }
      #pickleUi .pBtns button { position: relative; width: 78px; height: 78px; border-radius: 50%; border: 3px solid #fff8; color: #fff; font: 900 14px -apple-system, sans-serif;
        background: #c8a21a; box-shadow: 0 4px 0 #7a5e08; -webkit-tap-highlight-color: transparent; touch-action: none; }
      #pickleUi .pBtns button[data-s="drive"] { background: #d0482a; box-shadow: 0 4px 0 #7a2410; width: 92px; height: 92px; }
      #pickleUi .pBtns button[data-s="lob"] { background: #3a7ac8; box-shadow: 0 4px 0 #1a4478; width: 64px; height: 64px; }
      #pickleUi .pBtns button:active { transform: translateY(3px); box-shadow: none; }
      #pickleUi .pBtns i { position: absolute; top: 6px; right: 12px; font: 700 9px sans-serif; opacity: .5; font-style: normal; }
      @media (pointer: coarse) { #pickleUi .pBtns i { display: none; } }
      #pickleUi .pMenu { position: absolute; top: calc(8px + var(--safe-t, 0px)); right: calc(12px + var(--safe-r, 0px)); width: 38px; height: 38px; border-radius: 50%; border: none; color: #fff;
        background: rgba(0,0,0,.35); font: 900 14px -apple-system, sans-serif; }
      #pickleUi .pPanel { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: #0d2414dd; text-align: center; padding: 0 24px; }
      #pickleUi .pPanel.on { display: flex; }
      #pickleUi .pPanel .big { font: 900 32px Georgia, serif; color: #f2e6b0; }
      #pickleUi .pPanel .sm { font-size: 14px; line-height: 1.6; max-width: 620px; }
      #pickleUi .pPanel button { padding: 10px 28px; border-radius: 999px; border: none; color: #fff; font: 900 15px -apple-system, sans-serif; background: #c8a21a; }
      #pickleUi .pPanel button.back { background: rgba(255,255,255,.18); }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { cv: q('.pScene'), hud: q('.pHud'), panel: q('.pPanel') };
    this.g = this.ui.cv.getContext('2d');
    q('.pBtns').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button[data-s]');
      if (!b || this.mode !== 'play') return;
      e.preventDefault(); e.stopPropagation();
      this.shot = b.dataset.s;
    });
    q('.pMenu').addEventListener('pointerdown', (e) => { e.preventDefault(); this._pause(); });
    // drag anywhere else: a floating stick where the finger went down
    const cv = this.ui.cv, st2 = this.stick;
    cv.addEventListener('pointerdown', (e) => { if (this.mode !== 'play') return; e.preventDefault(); st2.id = e.pointerId; st2.ox = e.clientX; st2.oy = e.clientY; st2.x = st2.y = 0; });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerId !== st2.id) return;
      const dx = (e.clientX - st2.ox) / 50, dy = (e.clientY - st2.oy) / 50, l = Math.max(1, Math.hypot(dx, dy));
      st2.x = dx / l; st2.y = -dy / l;
    });
    const end = (e) => { if (e.pointerId === st2.id) { st2.id = null; st2.x = st2.y = 0; } };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) cv.addEventListener(ev, end);
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      if (e.code === 'Escape') { if (this.mode === 'paused') this._resume(); else if (this.mode === 'play') this._pause(); else this.close(); }
      else if (this.mode === 'play' && ['KeyJ', 'KeyK', 'KeyL', 'Space'].includes(e.code)) { if (!e.repeat) this.shot = e.code === 'KeyJ' ? 'dink' : e.code === 'KeyL' ? 'lob' : 'drive'; }
      else if (this.mode === 'play' && /^(Key[WASD]|Arrow)/.test(e.code)) this.keys[e.code] = true;
      else if ((e.code === 'Enter' || e.code === 'Space') && (this.mode === 'brief' || this.mode === 'over')) this._newGame();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; }, true);
    window.addEventListener('resize', () => { if (this.active) this._fit(); });
  }

  _fit() {
    const dpr = Math.min(devicePixelRatio || 1, 2.5), cv = this.ui.cv;
    cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
    this.W = innerWidth; this.H = innerHeight; this.dpr = dpr;
  }

  _panel(html, go, back) {
    const p = this.ui.panel;
    p.innerHTML = html; p.classList.add('on');
    const a = p.querySelector('.go'), b = p.querySelector('.back');
    if (a) a.addEventListener('click', go);
    if (b) b.addEventListener('click', back);
  }

  start() {
    this.el.classList.add('show');
    this.snd = this.snd || new PickleSound(this.o.audio && this.o.audio.ctx, this.o.audio && this.o.audio.master);
    this._fit();
    this.game = new Pickleball({ level: 0.5 });
    this.mode = 'brief';
    this._panel(`<div class="big">PICKLEBALL</div>
      <div class="sm">Invented on this island in 1965. Singles against Bainbridge's resident champion, rally scoring to 11, win by 2.<br>
      Drag to move. <b>DINK</b> drops it soft into the kitchen, <b>DRIVE</b> hits it hard and deep, <b>LOB</b> goes over their head. Swing when the ball is in the middle of your reach; the ball goes the way you are moving.<br>
      The rules that make it pickleball: serve underhand, cross-court, past the kitchen. The return of serve and the shot after it must bounce (the two-bounce rule). Never volley standing in the kitchen, the green zone by the net.</div>
      <div class="sm">${this.best ? `Best: ${this.best} points in a win.` : ''}</div>
      <button class="go">PLAY</button><button class="back">LEAVE</button>`, () => this._newGame(), () => this.close());
    this._draw();
  }

  _newGame() {
    this.game = new Pickleball({ level: 0.5 });
    this.mode = 'play'; this.acc = 0; this.shot = null;
    this.ui.panel.classList.remove('on');
  }
  _pause() {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    const [a, c] = this.game.score;
    this._panel(`<div class="big">TIME OUT</div><div class="sm">${a} – ${c}</div><button class="go">PLAY ON</button><button class="back">LEAVE THE COURT</button>`, () => this._resume(), () => this.close());
  }
  _resume() { this.mode = 'play'; this.ui.panel.classList.remove('on'); }
  _over() {
    const gm = this.game, [a, c] = gm.score, won = gm.winner === 0;
    const pay = won ? 150 + 10 * a : 10 * a;
    if (won && a > this.best) { this.best = a; try { localStorage.setItem('auto-pickle-best', String(a)); } catch (e) { /* private mode */ } }
    this.mode = 'over';
    this._panel(`<div class="big">${won ? 'YOU WIN' : 'GAME, CHAMPION'}</div><div class="sm">${a} – ${c}${pay ? ` · +$${pay}` : ''}</div>
      <button class="go">AGAIN</button><button class="back">LEAVE THE COURT</button>`, () => this._newGame(), () => this.close());
    if (pay && this.o.onReward) this.o.onReward(pay);
  }
  close() {
    this.mode = 'off';
    this.el.classList.remove('show');
    this.ui.panel.classList.remove('on');
    if (this.o.onEnd) this.o.onEnd();
  }

  // --- drawing ------------------------------------------------------------------------------

  /** Camera behind and above your baseline, looking up the court. */
  _proj(x, y, h) {
    const W = this.W, H = this.H;
    const cy = -COURT.hl - 5.2, ch = 4.6, th = 0.36;
    const dy = y - cy, dh = h - ch;
    const depth = dy * Math.cos(th) - dh * Math.sin(th), up = dy * Math.sin(th) + dh * Math.cos(th);
    const F = Math.min(W * 0.95, H * 1.55);
    return [W / 2 + x * F / depth, H * 0.42 - up * F / depth, F / depth];
  }

  _draw() {
    const g = this.g, W = this.W, H = this.H, gm = this.game;
    if (!W) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // sky, the island's trees, the grass
    const sky = g.createLinearGradient(0, 0, 0, H * 0.3);
    sky.addColorStop(0, '#6aa6d8'); sky.addColorStop(1, '#bcd8ea');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const [, hy] = this._proj(0, 60, 0);
    g.fillStyle = '#23462c';
    for (let i = 0; i < 26; i++) {
      const x = (i / 25) * W, r = 22 + ((i * 37) % 17);
      g.beginPath(); g.moveTo(x - r * 0.7, hy); g.lineTo(x, hy - r * 2.4 - ((i * 53) % 30)); g.lineTo(x + r * 0.7, hy); g.fill();
    }
    g.fillStyle = '#3f7a3c'; g.fillRect(0, hy, W, H - hy);
    const poly = (pts, fill) => { g.beginPath(); pts.forEach(([x, y, h], i) => { const [sx, sy] = this._proj(x, y, h || 0); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); }); g.closePath(); g.fillStyle = fill; g.fill(); };
    const line = (a, b, col, w) => { const [ax, ay, as] = this._proj(...a), [bx, by] = this._proj(...b); g.strokeStyle = col; g.lineWidth = Math.max(1, w * as); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); };
    const hw = COURT.hw, hl = COURT.hl, kz = COURT.kitchen;
    poly([[-hw - 1.6, -hl - 2.5], [hw + 1.6, -hl - 2.5], [hw + 1.6, hl + 2.5], [-hw - 1.6, hl + 2.5]], '#2a5a4a');
    poly([[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]], '#2a5c9a');
    poly([[-hw, -kz], [hw, -kz], [hw, kz], [-hw, kz]], '#2f8a4c');
    for (const v of [-hl, -kz, kz, hl]) line([-hw, v, 0], [hw, v, 0], '#f4f4f0', 0.05);
    for (const u of [-hw, hw]) line([u, -hl, 0], [u, hl, 0], '#f4f4f0', 0.05);
    for (const s of [-1, 1]) line([0, s * kz, 0], [0, s * hl, 0], '#f4f4f0', 0.05);
    const drawPlayer = (q, col, k) => {
      const [sx, sy, s] = this._proj(q.x, q.y, 0);
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(sx, sy, 0.45 * s, 0.14 * s, 0, 0, Math.PI * 2); g.fill();
      const [, hy2] = this._proj(q.x, q.y, 1.75);
      const bh = sy - hy2;
      g.fillStyle = '#1e2430'; g.fillRect(sx - 0.14 * s, sy - bh * 0.48, 0.12 * s, bh * 0.48); g.fillRect(sx + 0.02 * s, sy - bh * 0.48, 0.12 * s, bh * 0.48);
      g.fillStyle = col; g.fillRect(sx - 0.2 * s, sy - bh * 0.86, 0.4 * s, bh * 0.4);
      g.fillStyle = '#e8c4a0'; g.beginPath(); g.arc(sx, sy - bh * 0.93, 0.13 * s, 0, Math.PI * 2); g.fill();
      // the paddle, swung through
      const sw = q.swing > 0 ? q.swing / 0.3 : 0, side = k === 0 ? 1 : -1;
      const px = sx + side * (0.32 + 0.3 * Math.sin(sw * Math.PI)) * s, py = sy - bh * 0.58;
      g.fillStyle = k === 0 ? '#d8402a' : '#2a64c8'; g.beginPath(); g.ellipse(px, py, 0.12 * s, 0.16 * s, 0, 0, Math.PI * 2); g.fill();
      if (k === 0) { g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(sx, sy, REACH * s, REACH * s * 0.32, 0, 0, Math.PI * 2); g.stroke(); }
    };
    const b = gm && gm.ball;
    // far player, the net, then the ball on its side of it, near player
    if (gm) drawPlayer(gm.p[1], '#f2f2f2', 1);
    const ballDraw = () => {
      if (!b) return;
      const [sx, sy, s] = this._proj(b.x, b.y, 0);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(sx, sy, 0.1 * s, 0.035 * s, 0, 0, Math.PI * 2); g.fill();
      const [bx, by, bs] = this._proj(b.x, b.y, b.h);
      g.fillStyle = '#e8f04a'; g.beginPath(); g.arc(bx, by, Math.max(2.5, 0.07 * bs), 0, Math.PI * 2); g.fill();
    };
    if (b && b.y > 0) ballDraw();
    poly([[-hw - 0.3, 0, 0], [hw + 0.3, 0, 0], [hw + 0.3, 0, 0.91], [0, 0, 0.86], [-hw - 0.3, 0, 0.91]], 'rgba(20,20,24,.45)');
    line([-hw - 0.3, 0, 0.91], [0, 0, 0.86], '#f4f4f0', 0.05); line([0, 0, 0.86], [hw + 0.3, 0, 0.91], '#f4f4f0', 0.05);
    for (const u of [-hw - 0.3, hw + 0.3]) line([u, 0, 0], [u, 0, 0.92], '#333', 0.06);
    if (b && b.y <= 0) ballDraw();
    if (gm) drawPlayer(gm.p[0], '#d8402a', 0);
    // the score and what happened
    if (gm) {
      const [a, c] = gm.score;
      const t = `YOU ${a} · ${c} CHAMPION${gm.state === 'serve' ? (gm.server === 0 ? ' · YOUR SERVE — tap a shot' : ' · their serve') : ''}`;
      if (this.ui.hud.textContent !== t) this.ui.hud.textContent = t;
      if (gm.state === 'point' && gm.msg) {
        g.font = '900 26px -apple-system, Helvetica, sans-serif'; g.textAlign = 'center';
        g.fillStyle = '#0008'; g.fillText(gm.msg, W / 2 + 2, H * 0.3 + 2);
        g.fillStyle = gm.lastLoser === 0 ? '#ffd0c0' : '#fff6a0'; g.fillText(gm.msg, W / 2, H * 0.3);
      }
    }
  }
}
