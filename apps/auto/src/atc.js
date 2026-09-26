// BOEING FIELD TOWER: ENTER at the control tower's door and you are in the
// cab, playing FINAL APPROACH (atcgame.js has the rules): draw each arriving
// aircraft's path to its runway with a finger, and keep them apart.
//
// The field is drawn top-down in the bright, clean style of the touch-screen
// original: mown grass, the Duwamish down the west side, two runways with
// their thresholds painted in the colour of the traffic they take, the
// helicopter pad, taxiways, hangars and trees. Aircraft are drawn from paths
// with a shadow that closes in as they come down; a path is a trail of dots
// in the aircraft's colour, bright once it is locked onto a landing. Near
// misses ring red and beep; a collision ends the shift. FF runs the clock at
// double speed. A shift pays $3 an aircraft landed, and a new best $50 more
// (localStorage 'auto-atc-best').

import { Beeper } from './arcade.js';
import { Atc, WW, RUNWAYS, PAD, RIVER, KINDS, zoneOf } from './atcgame.js';

const STEP = 1 / 60;
const COLS = { red: '#e8453a', yellow: '#f2b820', blue: '#2f7fe0', green: '#2eb86a' };

class TowerSound extends Beeper {
  play(name) {
    if (!this.c) return;
    const now = this.c.currentTime;
    if (this.last[name] && now - this.last[name] < 0.05) return;
    this.last[name] = now;
    const T = this.tone.bind(this), N = this.noise.bind(this);
    switch (name) {
      case 'arrive': N(0.12, 0.25, 3500); T('sine', 880, 0.12, 0.18, 0, 0.12); T('sine', 1175, 0.18, 0.18, 0, 0.24); break;
      case 'grab': T('sine', 660, 0.05, 0.15); break;
      case 'locked': T('sine', 784, 0.08, 0.2); T('sine', 1047, 0.14, 0.2, 0, 0.07); break;
      case 'land': [523, 659, 784, 1047].forEach((f, i) => T('triangle', f, 0.14, 0.26, 0, i * 0.07)); break;
      case 'warn': T('square', 1320, 0.07, 0.16); T('square', 1320, 0.07, 0.16, 0, 0.12); break;
      case 'crash': N(1.2, 0.9, 700); T('sawtooth', 110, 0.9, 0.35, 40); break;
      case 'best': [523, 659, 784, 1047, 1319].forEach((f, i) => T('triangle', f, 0.14, 0.26, 0, i * 0.09)); break;
      default: break;
    }
  }
}

export class TowerGame {
  /** opts: { scene, city, world, audio, tower: {x, y, z}, onReward(n), onEnd } */
  constructor(opts) {
    this.o = opts;
    this.mode = 'off';            // off | brief | play | paused | over
    const tw = opts.tower || { x: 2400, y: 5, z: 8900 };
    this.door = { x: tw.x, y: tw.y, z: tw.z };
    this.spot = { x: tw.x, z: tw.z };
    this.best = 0;
    try { this.best = +(localStorage.getItem('auto-atc-best') || 0) || 0; } catch (e) { this.best = 0; }
    this.drag = new Map();        // pointerId -> plane
    this.ff = false;
    this.acc = 0;
    this._buildDom();
  }

  get active() { return this.mode !== 'off'; }

  near(pl) { return Math.hypot(pl.x - this.door.x, pl.z - this.door.z) < 5 && Math.abs(pl.y - this.door.y) < 3; }

  // --- the overlay ---------------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'atcUi';
    d.innerHTML = `
      <canvas class="tScreen"></canvas>
      <div class="tHud"><span class="tLanded">LANDED 0</span><span class="tBest"></span></div>
      <button class="tFf">▶▶</button><button class="tMenu">II</button>
      <div class="tPanel"></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #atcUi { position: absolute; inset: 0; z-index: 40; display: none; background: #5aa84a; user-select: none; -webkit-user-select: none; touch-action: none;
        font: 800 14px -apple-system, Helvetica, sans-serif; color: #fff; }
      #atcUi.show { display: block; }
      #atcUi .tScreen { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
      #atcUi .tHud { position: absolute; top: calc(8px + var(--safe-t, 0px)); left: calc(14px + var(--safe-l, 0px)); display: flex; gap: 12px; pointer-events: none;
        font: 900 18px -apple-system, Helvetica, sans-serif; text-shadow: 0 2px 0 #0006; }
      #atcUi .tBest { opacity: .8; font-size: 14px; align-self: center; }
      #atcUi button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; border: none; color: #fff; font: 900 15px -apple-system, Helvetica, sans-serif; }
      #atcUi .tMenu, #atcUi .tFf { position: absolute; top: calc(8px + var(--safe-t, 0px)); width: 40px; height: 40px; border-radius: 50%; background: rgba(0,0,0,.28); }
      #atcUi .tMenu { right: calc(14px + var(--safe-r, 0px)); }
      #atcUi .tFf { right: calc(62px + var(--safe-r, 0px)); font-size: 12px; }
      #atcUi .tFf.on { background: #f2b820; color: #402a00; }
      #atcUi .tPanel { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: #0a1a10b8; text-align: center; padding: 0 24px; }
      #atcUi .tPanel.on { display: flex; }
      #atcUi .tPanel .big { font: 900 32px -apple-system, Helvetica, sans-serif; letter-spacing: .04em; }
      #atcUi .tPanel .sm { font-size: 14px; line-height: 1.6; max-width: 560px; opacity: .95; }
      #atcUi .tPanel .keys { display: flex; gap: 16px; font-size: 13px; flex-wrap: wrap; justify-content: center; }
      #atcUi .tPanel .keys span { display: inline-flex; align-items: center; gap: 6px; }
      #atcUi .tPanel .keys i { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
      #atcUi .tPanel button { padding: 10px 28px; border-radius: 999px; background: #2f7fe0; } #atcUi .tPanel button.back { background: rgba(255,255,255,.2); }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { cv: q('.tScreen'), landed: q('.tLanded'), best: q('.tBest'), panel: q('.tPanel'), ff: q('.tFf') };
    this.g = this.ui.cv.getContext('2d');
    q('.tMenu').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this._pause(); });
    this.ui.ff.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.ff = !this.ff; this.ui.ff.classList.toggle('on', this.ff); });
    // the finger draws paths: each pointer carries the plane it picked up
    d.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'play' || e.target.closest('button') || !this.game) return;
      const [x, y] = this._toWorld(e.clientX, e.clientY);
      const p = this.game.pick(x, y);
      if (!p) return;
      e.preventDefault();
      for (const [id, q2] of this.drag) if (q2 === p) this.drag.delete(id);
      this.drag.set(e.pointerId, p);
      this.game.beginPath(p);
      try { d.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    });
    d.addEventListener('pointermove', (e) => {
      const p = this.drag.get(e.pointerId);
      if (!p || !this.game) return;
      const [x, y] = this._toWorld(e.clientX, e.clientY);
      if (this.game.extendPath(p, x, y)) this.drag.delete(e.pointerId);
    });
    const up = (e) => { const p = this.drag.get(e.pointerId); if (p && this.game) this.game.endPath(p); this.drag.delete(e.pointerId); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) d.addEventListener(ev, up);
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      if (e.code === 'Escape') { if (this.mode === 'paused') this._resume(); else if (this.mode === 'play') this._pause(); else this.close(); }
      else if (e.code === 'KeyF' && this.mode === 'play') { this.ff = !this.ff; this.ui.ff.classList.toggle('on', this.ff); }
      else if ((e.code === 'Enter' || e.code === 'Space') && (this.mode === 'brief' || this.mode === 'over')) this._newGame();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('resize', () => { if (this.active) this._fit(); });
  }

  _fit() {
    const vw = innerWidth, vh = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2.5);
    const cv = this.ui.cv;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    // the world takes the screen's aspect (atcgame clamps it to 460..700 tall);
    // a game in progress keeps its own height and is fitted
    this.worldH = this.game && this.mode !== 'off' && this.mode !== 'brief' ? this.game.H : Math.max(460, Math.min(700, WW * vh / vw));
    this.k = Math.min(vw / WW, vh / this.worldH);
    this.ox = (vw - WW * this.k) / 2; this.oy = (vh - this.worldH * this.k) / 2;
    this.dpr = dpr;
    this._field();
  }

  _toWorld(cx, cy) { return [(cx - this.ox) / this.k, (cy - this.oy) / this.k]; }

  // --- flow ------------------------------------------------------------------------------------

  start() {
    this.el.classList.add('show');
    this.snd = this.snd || new TowerSound(this.o.audio && this.o.audio.ctx, this.o.audio && this.o.audio.master);
    this._fit();
    this.game = new Atc({ h: this.worldH });
    this.mode = 'brief';
    const key = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;
    this._panel(`<div class="big">BOEING FIELD TOWER</div>
      <div class="sm">You have the field. Draw a path from each aircraft to where it lands, and keep them apart.</div>
      <div class="keys">${key(COLS.red, 'jets: runway 14R')}${key(COLS.yellow, 'props: runway 14L')}${key(COLS.blue, 'helicopters: the pad')}${key(COLS.green, 'seaplanes: the river')}</div>
      <div class="sm">Land on the arrow, heading the way it points.${this.best ? ` Best shift: ${this.best}.` : ''}</div>
      <button class="go">TAKE THE FIELD</button><button class="back">LEAVE</button>`, () => this._newGame(), () => this.close());
  }

  _newGame() {
    this.game = new Atc({ h: Math.max(460, Math.min(700, WW * innerHeight / innerWidth)) });
    this._fit();
    this.mode = 'play';
    this.ui.panel.classList.remove('on');
    this.drag.clear();
    this.ff = false; this.ui.ff.classList.remove('on');
    this.acc = 0;
    this.paid = false;
  }

  _panel(html, go, back) {
    const p = this.ui.panel;
    p.innerHTML = html;
    p.classList.add('on');
    const a = p.querySelector('.go'), b = p.querySelector('.back');
    if (a) a.addEventListener('click', go);
    if (b) b.addEventListener('click', back);
  }

  _pause() {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this._panel(`<div class="big">HOLDING</div><div class="sm">${this.game.landed} landed this shift</div>
      <button class="go">RESUME</button><button class="back">LEAVE THE TOWER</button>`, () => this._resume(), () => this.close());
  }

  _resume() { this.mode = 'play'; this.ui.panel.classList.remove('on'); }

  close() {
    this.mode = 'off';
    this.el.classList.remove('show');
    this.ui.panel.classList.remove('on');
    this.drag.clear();
    if (this.o.onEnd) this.o.onEnd();
  }

  _over() {
    const n = this.game.landed, prev = this.best;
    const beat = n > prev;
    const pay = n * 3 + (beat && prev > 0 ? 50 : 0);
    if (beat) { this.best = n; try { localStorage.setItem('auto-atc-best', String(n)); } catch (e) { /* private */ } }
    if (!this.paid) { this.paid = true; if (pay > 0 && this.o.onReward) this.o.onReward(pay); if (beat && prev > 0) this.snd.play('best'); }
    this.mode = 'over';
    this._panel(`<div class="big">COLLISION</div><div class="sm">You landed ${n} aircraft this shift.<br>${beat ? (prev > 0 ? 'A new best! +$50' : 'Your first shift in the tower.') : `Best shift: ${prev}`}<br>${pay > 0 ? `The tower pays $${pay}` : ''}</div>
      <button class="go">NEXT SHIFT</button><button class="back">LEAVE THE TOWER</button>`, () => this._newGame(), () => this.close());
  }

  // --- the frame ------------------------------------------------------------------------------

  update(dt) {
    if (this.mode === 'off') return;
    const gm = this.game;
    if (this.mode === 'play' && gm && !this.frozen) {
      this.acc = Math.min(this.acc + dt * (this.ff ? 2 : 1), 0.2);
      while (this.acc >= STEP) {
        this.acc -= STEP;
        gm.step(STEP);
        for (const e of gm.takeEvents()) this.snd.play(e);
        if (gm.over) break;
      }
      if (gm.over && gm.t - gm.crash.t > 1.6) this._over();
    }
    const t = `LANDED ${gm ? gm.landed : 0}`;
    if (this.ui.landed.textContent !== t) this.ui.landed.textContent = t;
    const b = this.best ? `BEST ${this.best}` : '';
    if (this.ui.best.textContent !== b) this.ui.best.textContent = b;
    this._draw();
  }

  // --- drawing ----------------------------------------------------------------------------------

  /** The field, once per size: grass, river, runways, pad, taxiways, hangars, trees. */
  _field() {
    const cv = this.fieldCv || (this.fieldCv = document.createElement('canvas'));
    const W = this.ui.cv.width, H = this.ui.cv.height;
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const k = this.k * this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#5aa84a'; g.fillRect(0, 0, W, H);
    g.setTransform(k, 0, 0, k, this.ox * this.dpr, this.oy * this.dpr);
    const X0 = -this.ox / this.k - 10, Y0 = -this.oy / this.k - 10, X1 = WW + this.ox / this.k + 10, Y1 = this.worldH + this.oy / this.k + 10;
    // mowing stripes
    for (let x = Math.floor(X0 / 40) * 40; x < X1; x += 40) { g.fillStyle = (x / 40) % 2 ? '#5fae4e' : '#56a346'; g.fillRect(x, Y0, 20, Y1 - Y0); }
    let sd = 5;
    const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 160; i++) { g.fillStyle = rnd() < 0.5 ? '#4e9a40' : '#68b858'; g.beginPath(); g.ellipse(X0 + rnd() * (X1 - X0), Y0 + rnd() * (Y1 - Y0), 6 + rnd() * 16, 3 + rnd() * 8, rnd() * 3, 0, Math.PI * 2); g.fill(); }
    // the Duwamish
    const river = (w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); RIVER.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); };
    river(RIVER.w + 16, '#7a8a4a'); river(RIVER.w + 6, '#c8b888'); river(RIVER.w, '#3a86b8'); river(RIVER.w * 0.55, '#4a96c8');
    // the landing lane on the river: buoys and an arrow
    const L = RIVER.land;
    for (let i = -3; i <= 3; i++) { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(L.x + Math.cos(L.a) * i * 16 - Math.sin(L.a) * 14, L.y + Math.sin(L.a) * i * 16 + Math.cos(L.a) * 14, 2, 0, 7); g.fill(); g.beginPath(); g.arc(L.x + Math.cos(L.a) * i * 16 + Math.sin(L.a) * 14, L.y + Math.sin(L.a) * i * 16 - Math.cos(L.a) * 14, 2, 0, 7); g.fill(); }
    // taxiways: grey ribbons joining the runways to the apron
    g.strokeStyle = '#8a8e92'; g.lineWidth = 12; g.lineCap = 'round';
    const rw = RUNWAYS.red, ry = RUNWAYS.yellow;
    const AY = Math.min(440, this.worldH - 118);      // the apron keeps to the bottom edge
    const along = (r, t) => [r.x + Math.cos(r.a) * r.len / 2 * t, r.y + Math.sin(r.a) * r.len / 2 * t];
    for (const [a, b] of [[along(rw, 0.6), along(ry, -0.8)], [along(rw, -0.2), along(ry, 0.6)], [along(ry, 0), [860, AY + 30]], [along(rw, 0.95), [860, AY + 30]]]) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    g.strokeStyle = '#f2d24a'; g.lineWidth = 1; g.setLineDash([6, 6]);
    for (const [a, b] of [[along(rw, 0.6), along(ry, -0.8)], [along(rw, -0.2), along(ry, 0.6)], [along(ry, 0), [860, AY + 30]], [along(rw, 0.95), [860, AY + 30]]]) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    g.setLineDash([]);
    // the apron and hangars, bottom right
    g.fillStyle = '#9a9ea2'; g.fillRect(800, AY, 190, 130);
    for (const [hx, hy, hw, hh, c] of [[815, AY + 30, 60, 40, '#d8d0c4'], [885, AY + 22, 70, 48, '#c8ccd0'], [960, AY + 40, 36, 60, '#b89878']]) {
      g.fillStyle = '#0003'; g.fillRect(hx + 4, hy + 5, hw, hh);
      g.fillStyle = c; g.fillRect(hx, hy, hw, hh);
      g.fillStyle = '#0000001a'; for (let i = 0; i < hw; i += 6) g.fillRect(hx + i, hy, 2, hh);
    }
    g.fillStyle = '#ffffffc0'; g.font = '900 13px -apple-system, Helvetica, sans-serif'; g.textAlign = 'center'; g.fillText('BOEING FIELD', 890, AY + 94);
    // runways
    for (const key of ['red', 'yellow']) {
      const r = RUNWAYS[key];
      g.save(); g.translate(r.x, r.y); g.rotate(r.a);
      g.fillStyle = '#0003'; g.fillRect(-r.len / 2 + 3, -r.w / 2 + 4, r.len, r.w);
      g.fillStyle = '#50545a'; g.fillRect(-r.len / 2, -r.w / 2, r.len, r.w);
      g.fillStyle = '#ffffff'; g.fillRect(-r.len / 2, -r.w / 2, r.len, 1.5); g.fillRect(-r.len / 2, r.w / 2 - 1.5, r.len, 1.5);
      for (let x = -r.len / 2 + 60; x < r.len / 2 - 30; x += 22) g.fillRect(x, -0.8, 11, 1.6);
      // the threshold: piano keys and the landing arrow in the traffic's colour
      const tx = -r.len / 2;
      for (let i = -3; i <= 3; i++) g.fillRect(tx + 6, i * r.w / 8 - 1.2, 14, 2.4);
      g.fillStyle = COLS[key === 'red' ? 'red' : 'yellow'];
      g.globalAlpha = 0.85; g.fillRect(tx - 2, -r.w / 2 - 2, 4, r.w + 4); g.globalAlpha = 1;
      g.beginPath(); g.moveTo(tx + 52, 0); g.lineTo(tx + 32, -r.w * 0.36); g.lineTo(tx + 32, -r.w * 0.14); g.lineTo(tx + 22, -r.w * 0.14); g.lineTo(tx + 22, r.w * 0.14); g.lineTo(tx + 32, r.w * 0.14); g.lineTo(tx + 32, r.w * 0.36); g.closePath(); g.fill();
      g.fillStyle = '#ffffff'; g.font = `900 ${Math.round(r.w * 0.42)}px -apple-system, Helvetica, sans-serif`; g.textAlign = 'center';
      g.save(); g.translate(tx + 72, 0); g.rotate(Math.PI / 2); g.fillText(r.name, 0, r.w * 0.15); g.restore();
      g.restore();
    }
    // the pad
    g.fillStyle = '#0003'; g.beginPath(); g.arc(PAD.x + 3, PAD.y + 4, PAD.r, 0, 7); g.fill();
    g.fillStyle = '#50545a'; g.beginPath(); g.arc(PAD.x, PAD.y, PAD.r, 0, 7); g.fill();
    g.strokeStyle = COLS.blue; g.lineWidth = 4; g.beginPath(); g.arc(PAD.x, PAD.y, PAD.r - 4, 0, 7); g.stroke();
    g.fillStyle = '#ffffff'; g.font = '900 24px -apple-system, Helvetica, sans-serif'; g.textAlign = 'center'; g.fillText('H', PAD.x, PAD.y + 8);
    // trees round the edges
    for (let i = 0; i < 70; i++) {
      let x = X0 + rnd() * (X1 - X0), y = Y0 + rnd() * (Y1 - Y0);
      if (x > 60 && x < WW - 60 && y > 50 && y < this.worldH - 50) continue;
      if (Math.hypot(x - 130, y - 300) < 70 || (x > 780 && y > AY - 20)) continue;
      const r = 8 + rnd() * 9;
      g.fillStyle = '#0003'; g.beginPath(); g.arc(x + 3, y + 4, r, 0, 7); g.fill();
      g.fillStyle = rnd() < 0.5 ? '#2f7a36' : '#3a8a3e'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      g.fillStyle = '#ffffff22'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, 7); g.fill();
    }
  }

  _draw() {
    const g = this.g, gm = this.game;
    if (!this.fieldCv) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    let shake = 0;
    if (gm && gm.over && gm.crash) shake = Math.max(0, 0.6 - (gm.t - gm.crash.t)) * 10;
    g.drawImage(this.fieldCv, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    if (!gm) return;
    const k = this.k * this.dpr;
    g.setTransform(k, 0, 0, k, this.ox * this.dpr, this.oy * this.dpr);
    const t = gm.t;
    // landing zones glow for the aircraft being drawn
    const drawing = new Set();
    for (const p of this.drag.values()) drawing.add(KINDS[p.kind].target);
    for (const tg of drawing) {
      const z = zoneOf(tg);
      g.strokeStyle = '#ffffff'; g.globalAlpha = 0.5 + 0.4 * Math.sin(t * 8); g.lineWidth = 2.5;
      g.beginPath(); g.arc(z.x, z.y, z.r, 0, 7); g.stroke(); g.globalAlpha = 1;
    }
    // paths
    for (const p of gm.planes) {
      if (!p.path || p.path.length < 2) continue;
      const col = COLS[KINDS[p.kind].col];
      let acc = 0;
      for (let i = 1; i < p.path.length; i++) {
        const [ax, ay] = p.path[i - 1], [bx, by] = p.path[i];
        acc += Math.hypot(bx - ax, by - ay);
        if (acc < 9) continue;
        acc = 0;
        g.fillStyle = p.land ? '#ffffff' : col;
        g.beginPath(); g.arc(bx, by, p.land ? 2.6 : 2.2, 0, 7); g.fill();
        if (p.land) { g.fillStyle = col; g.beginPath(); g.arc(bx, by, 1.5, 0, 7); g.fill(); }
      }
    }
    // aircraft: landing ones first (on the ground), then the rest
    const order = [...gm.planes].sort((a, b) => (a.landing ? 0 : 1) - (b.landing ? 0 : 1));
    for (const p of order) this._plane(p, t);
    // arrivals: an arrow at the edge where each one is coming in
    for (const p of gm.planes) {
      if (!p.entering) continue;
      const x = Math.max(14, Math.min(WW - 14, p.x)), y = Math.max(14, Math.min(gm.H - 14, p.y));
      if (Math.floor(t * 4) % 2) continue;
      g.save(); g.translate(x, y); g.rotate(p.a);
      g.fillStyle = COLS[KINDS[p.kind].col]; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(10, 0); g.lineTo(-7, -8); g.lineTo(-3, 0); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
    // the crash
    if (gm.over && gm.crash) {
      const c = gm.crash, e = gm.t - c.t;
      for (let i = 0; i < 3; i++) {
        const r = Math.max(0, e * (60 - i * 14));
        g.fillStyle = ['#ffd23a', '#ff8a2a', '#e8453a'][i]; g.globalAlpha = Math.max(0, 0.9 - e * 0.4);
        g.beginPath(); g.arc(c.x, c.y, Math.min(r, 46 - i * 10), 0, 7); g.fill();
      }
      g.globalAlpha = 1;
      g.strokeStyle = '#e8453a'; g.lineWidth = 3; g.beginPath(); g.arc(c.x, c.y, 30 + Math.sin(e * 10) * 4, 0, 7); g.stroke();
    }
  }

  _plane(p, t) {
    const g = this.g, K = KINDS[p.kind], col = COLS[K.col];
    let s = 1, sh = 1;
    if (p.landing) { const f = Math.min(1, p.landing.t / 1.2); s = 1 - 0.22 * f; sh = 1 - f; }
    else if (p.path && p.land && p.path.length < 30) sh = 0.35 + p.path.length / 46;
    const alpha = p.landing ? Math.max(0, 1 - Math.max(0, p.landing.t - 2.2)) : 1;
    // the warning ring
    if (p.warn) {
      g.strokeStyle = '#ff3a2a'; g.lineWidth = 2.5; g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 14);
      g.beginPath(); g.arc(p.x, p.y, K.r * 2.1, 0, 7); g.stroke(); g.globalAlpha = 1;
    }
    g.save();
    g.globalAlpha = alpha;
    // shadow, offset by height
    g.save(); g.translate(p.x + 7 * sh, p.y + 10 * sh); g.rotate(p.a); g.scale(s, s); g.fillStyle = '#00000038'; this._shape(g, p, true, t); g.restore();
    g.translate(p.x, p.y); g.rotate(p.a); g.scale(s, s);
    this._shape(g, p, false, t, col);
    g.restore();
    // a touch ring on the one being drawn
    if (p.drawing) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, K.r + 5, 0, 7); g.stroke(); }
  }

  /** An aircraft drawn nose along +x, in its own frame. */
  _shape(g, p, shadow, t, col) {
    const fill = (c) => { g.fillStyle = shadow ? '#00000038' : c; };
    const el = (x, y, rx, ry) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); };
    const poly = (pts) => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); g.fill(); };
    if (p.kind === 'jet' || p.kind === 'fastjet') {
      const L = p.kind === 'fastjet' ? 0.85 : 1;
      fill('#f4f4f2'); poly([[-4 * L, 0], [-12 * L, -16 * L], [-7 * L, -16 * L], [6 * L, -2], [6 * L, 2], [-7 * L, 16 * L], [-12 * L, 16 * L]]);
      poly([[-15 * L, 0], [-19 * L, -7 * L], [-16 * L, -7 * L], [-12 * L, -1], [-12 * L, 1], [-16 * L, 7 * L], [-19 * L, 7 * L]]);
      fill(col || '#fff'); el(0, 0, 17 * L, 3.2);
      if (!shadow) { g.fillStyle = '#f4f4f2'; el(1, 0, 13 * L, 1.3); g.fillStyle = '#2a3a4a'; el(13 * L, 0, 2.6, 1.6); g.fillStyle = col; poly([[-6 * L, -9 * L], [-8 * L, -12 * L], [-5 * L, -12 * L]]); }
    } else if (p.kind === 'prop' || p.kind === 'seaplane') {
      fill('#f4f4f2'); poly([[2, -15], [6, -15], [6, 15], [2, 15]]);
      poly([[-12, -6], [-10, -6], [-10, 6], [-12, 6]]);
      fill(col || '#fff'); el(0, 0, 12, 2.8);
      if (p.kind === 'seaplane') { fill(shadow ? '#000' : '#e8e8e8'); el(1, -5, 9, 1.4); el(1, 5, 9, 1.4); }
      if (!shadow) {
        g.fillStyle = col; g.fillRect(3, -15, 3, 3); g.fillRect(3, 12, 3, 3);
        g.fillStyle = '#2a3a4a'; el(5, 0, 2.4, 1.6);
        g.strokeStyle = '#ffffffa0'; g.lineWidth = 1; g.beginPath(); g.ellipse(12.5, 0, 1, 7, 0, 0, 7); g.stroke();
        const a = t * 60 + p.id;
        g.strokeStyle = '#303030'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(12.5, Math.cos(a) * 7); g.lineTo(12.5, -Math.cos(a) * 7); g.stroke();
      }
    } else {
      // the helicopter: a pod, a boom, skids, and the rotor disc
      fill(shadow ? '#000' : '#f4f4f2'); g.fillRect(-18, -1.2, 14, 2.4); g.fillRect(-19, -4, 3, 8);
      fill(col || '#fff'); el(0, 0, 8, 5.5);
      if (!shadow) {
        g.fillStyle = '#2a3a4a'; el(5, 0, 2.8, 3.6);
        g.fillStyle = '#e8e8e8'; g.fillRect(-6, -6.5, 12, 1.2); g.fillRect(-6, 5.3, 12, 1.2);
        g.strokeStyle = '#ffffff50'; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, 15, 0, 7); g.stroke();
        const a = t * 22 + p.id;
        g.strokeStyle = '#303030c0'; g.lineWidth = 1.6;
        for (let i = 0; i < 2; i++) { const b = a + i * Math.PI / 2; g.beginPath(); g.moveTo(Math.cos(b) * 15, Math.sin(b) * 15); g.lineTo(-Math.cos(b) * 15, -Math.sin(b) * 15); g.stroke(); }
      } else { g.beginPath(); g.arc(0, 0, 15, 0, 7); g.fill(); }
    }
  }
}

