// FIRST CUP COFFEE at 1912 Pike Place: the storefront where the city's
// coffee story started, and behind its counter MORNING RUSH (baristagame.js).
//
// The storefront hangs on the street face nearest the original shop's
// address (arcade.js streetFace / storefrontSpot). ENTER opens the shop; the
// overlay is opaque (the city idles). The top of the screen is the counter:
// the back wall with the menu board, the espresso machine and its two group
// heads, and the customers with their order bubbles and patience rings. Below
// it the cups on the counter, the selected one drawn large with what is in
// it, and the stations as buttons. Tap a cup to select it, a station to add
// to it, a customer to hand it over. Keyboard: Z X C cups, A shot, S drip,
// D water, F whole, G oat, H foam, J vanilla, K caramel, L mocha, ; whip,
// Q ice, Backspace bin, 1-4 serve, arrows pick a cup, Esc pause.
//
// A shift pays what the till took and the tips (localStorage
// 'auto-coffee-best' keeps the best shift).

import * as THREE from './three.js';
import { MARKET_FRAME } from './landmarks.js';
import { Beeper, streetFace, storefrontSpot } from './arcade.js';
import { Barista, MENU, SIZES, SHIFT, COUNTER, SPOTS, HEADS, SHOT_T, STEAM_T, orderText, recipe } from './baristagame.js';

// 1912 Pike Place: on the EAST side of the street, ~150 m up it from Pike St,
// facing the market across it (the street's own frame, as fishtoss.js uses).
const [MAX, MAZ] = MARKET_FRAME.at, [MUX, MUZ] = MARKET_FRAME.u, [MWX, MWZ] = MARKET_FRAME.w;
const AT = [MAX + MUX * 150 - MWX * 12, MAZ + MUZ * 150 - MWZ * 12];
const FACING = [MWX, MWZ];
const STEP = 1 / 60;
const STATIONS = [
  ['S', 'cup0', 'Z'], ['M', 'cup1', 'X'], ['L', 'cup2', 'C'], ['SHOT', 'shot', 'A'], ['DRIP', 'drip', 'S'], ['WATER', 'water', 'D'], ['ICE', 'ice', 'Q'], ['BIN', 'bin', '⌫'],
  ['WHOLE', 'whole', 'F'], ['OAT', 'oat', 'G'], ['FOAM', 'foam', 'H'], ['VANILLA', 'vanilla', 'J'], ['CARAMEL', 'caramel', 'K'], ['MOCHA', 'mocha', 'L'], ['WHIP', 'whip', ';'],
];
const KEYS = { KeyZ: 'cup0', KeyX: 'cup1', KeyC: 'cup2', KeyA: 'shot', KeyS: 'drip', KeyD: 'water', KeyQ: 'ice', Backspace: 'bin', KeyF: 'whole', KeyG: 'oat', KeyH: 'foam', KeyJ: 'vanilla', KeyK: 'caramel', KeyL: 'mocha', Semicolon: 'whip' };
const COL = { shot: '#4a2a18', drip: '#3a2416', water: '#9ab8c8', milk: '#f2e8d6', oat: '#ead8b4', foam: '#fbf6ec', vanilla: '#f4e2a0', caramel: '#c8843a', mocha: '#5a3420', whip: '#ffffff', ice: '#d8f0f8' };

class CafeSound extends Beeper {
  play(name) {
    if (!this.c) return;
    const now = this.c.currentTime;
    if (this.last[name] && now - this.last[name] < 0.04) return;
    this.last[name] = now;
    const T = this.tone.bind(this), N = this.noise.bind(this);
    switch (name) {
      case 'cup': N(0.05, 0.3, 1800); break;
      case 'tick': T('sine', 900, 0.04, 0.12); break;
      case 'grind': N(0.5, 0.35, 900); T('sawtooth', 70, 0.5, 0.08); break;
      case 'shot': T('sine', 1200, 0.06, 0.15); break;
      case 'steam': N(1.2, 0.45, 5200); break;
      case 'steamed': T('sine', 1400, 0.08, 0.15); break;
      case 'pour': N(0.3, 0.25, 700); break;
      case 'pump': N(0.08, 0.3, 1400); break;
      case 'foam': N(0.25, 0.3, 3000); break;
      case 'whip': N(0.22, 0.35, 4200); break;
      case 'ice': for (let i = 0; i < 4; i++) T('triangle', 2400 + Math.random() * 800, 0.05, 0.1, 0, i * 0.05); break;
      case 'bin': N(0.15, 0.35, 400); break;
      case 'bell': T('sine', 2093, 0.5, 0.18); T('sine', 3136, 0.4, 0.08); break;
      case 'perfect': [784, 988, 1319].forEach((f, i) => T('triangle', f, 0.12, 0.22, 0, i * 0.07)); break;
      case 'served': T('triangle', 660, 0.14, 0.2); break;
      case 'refused': T('square', 180, 0.25, 0.2, 120); break;
      case 'walkout': T('triangle', 330, 0.4, 0.25, 160); break;
      case 'nope': T('square', 160, 0.08, 0.12); break;
      case 'close': [523, 659, 784, 1047].forEach((f, i) => T('triangle', f, 0.18, 0.25, 0, i * 0.12)); break;
      default: break;
    }
  }
}

export class CoffeeShop {
  /** opts: { scene, city, world, audio, onReward(n), onEnd } */
  constructor(opts) {
    this.o = opts;
    this.mode = 'off';            // off | brief | play | paused | over
    this.best = 0;
    try { this.best = +(localStorage.getItem('auto-coffee-best') || 0) || 0; } catch (e) { this.best = 0; }
    this._storefront();
    this._buildDom();
    this.acc = 0;
  }

  get active() { return this.mode !== 'off'; }

  _storefront() {
    const { city, scene } = this.o;
    const best = streetFace(city, AT, 80, FACING);
    this.face = best;
    const gy = city.groundAt(best.fx + best.nx * 1.5, best.fz + best.nz * 1.5, null);
    this.door = { x: best.fx + best.nx * 1.6, z: best.fz + best.nz * 1.6, y: gy };
    const cv = document.createElement('canvas'); cv.width = 768; cv.height = 512;
    const g = cv.getContext('2d');
    // dark stained wood, a big window onto the counter, the round badge, the door
    g.fillStyle = '#3a2618'; g.fillRect(0, 0, 768, 512);
    for (let x = 0; x < 768; x += 24) { g.fillStyle = x % 48 ? '#40291a' : '#352214'; g.fillRect(x, 150, 24, 362); }
    g.fillStyle = '#1a120c'; g.fillRect(40, 190, 470, 290);
    // inside: warm light, a counter, the machine, a queue
    const lg = g.createLinearGradient(0, 190, 0, 480); lg.addColorStop(0, '#6a4424'); lg.addColorStop(1, '#2a1a10');
    g.fillStyle = lg; g.fillRect(44, 194, 462, 282);
    g.fillStyle = '#c8b8a0'; g.fillRect(44, 380, 462, 20);
    g.fillStyle = '#b8bcc0'; g.fillRect(90, 320, 110, 60); g.fillStyle = '#6a6e72'; g.fillRect(100, 360, 20, 20); g.fillRect(160, 360, 20, 20);
    for (let i = 0; i < 4; i++) { g.fillStyle = ['#2a3a5a', '#6a2a2a', '#2a5a3a', '#5a4a2a'][i]; g.fillRect(260 + i * 55, 330, 34, 60); g.fillStyle = '#e0b890'; g.beginPath(); g.arc(277 + i * 55, 318, 13, 0, 7); g.fill(); }
    g.strokeStyle = '#c8a878'; g.lineWidth = 8; g.strokeRect(40, 190, 470, 290);
    g.fillStyle = '#ffffff18'; g.fillRect(44, 194, 160, 282);
    // the door
    g.fillStyle = '#20140c'; g.fillRect(560, 200, 150, 300); g.strokeStyle = '#c8a878'; g.lineWidth = 8; g.strokeRect(560, 200, 150, 300);
    g.fillStyle = '#e8d8b8'; g.font = '800 22px Georgia, serif'; g.textAlign = 'center'; g.fillText('OPEN', 635, 250);
    // the badge and the name
    g.fillStyle = '#e8dcc4'; g.beginPath(); g.arc(120, 80, 62, 0, 7); g.fill();
    g.fillStyle = '#5a3a22'; g.beginPath(); g.arc(120, 80, 54, 0, 7); g.fill();
    g.fillStyle = '#e8dcc4'; g.font = '900 22px Georgia, serif'; g.fillText('FIRST', 120, 76); g.font = '900 20px Georgia, serif'; g.fillText('CUP', 120, 100);
    g.fillStyle = '#e8dcc4'; g.textAlign = 'left'; g.font = '900 50px Georgia, "Times New Roman", serif'; g.fillText('FIRST CUP COFFEE', 196, 84);
    g.font = '700 26px Georgia, serif'; g.fillText('PIKE PLACE · EST. 1971', 204, 126);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.7 }));
    const at = storefrontSpot(city, best);
    m.position.set(at.x, at.y + 3.0, at.z);
    m.rotation.y = Math.atan2(best.nx, best.nz);
    m.name = 'coffeeFront';
    scene.add(m);
    this.front = m;
    this.spot = { x: this.door.x, z: this.door.z };
  }

  near(pl) { return Math.hypot(pl.x - this.door.x, pl.z - this.door.z) < 4.5 && Math.abs(pl.y - this.door.y) < 2.5; }

  // --- the overlay ----------------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'coffeeUi';
    d.innerHTML = `
      <canvas class="cScene"></canvas>
      <div class="cHud"><span class="cClock"></span><span class="cTill"></span><span class="cServed"></span></div>
      <div class="cStations">${STATIONS.map(([l, k, key]) => `<button data-st="${k}" class="cb ${k.startsWith('cup') ? 'cup' : ''} ${['vanilla', 'caramel', 'mocha', 'whip'].includes(k) ? 'syr' : ''} ${['whole', 'oat', 'foam'].includes(k) ? 'milk' : ''}">${l}<i>${key}</i></button>`).join('')}</div>
      <button class="cMenu">II</button>
      <div class="cPanel"></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #coffeeUi { position: absolute; inset: 0; z-index: 40; display: none; background: #2a1a10; user-select: none; -webkit-user-select: none; touch-action: manipulation;
        font: 800 13px -apple-system, Helvetica, sans-serif; color: #fff; }
      #coffeeUi.show { display: block; }
      #coffeeUi .cScene { position: absolute; left: 0; top: 0; width: 100%; display: block; }
      #coffeeUi .cHud { position: absolute; top: calc(6px + var(--safe-t, 0px)); left: calc(12px + var(--safe-l, 0px)); display: flex; gap: 14px; pointer-events: none;
        font: 900 15px -apple-system, Helvetica, sans-serif; text-shadow: 0 2px 0 #0008; }
      #coffeeUi .cStations { position: absolute; left: calc(8px + var(--safe-l, 0px)); right: calc(8px + var(--safe-r, 0px)); bottom: calc(6px + var(--safe-b, 0px));
        display: grid; grid-template-columns: repeat(8, 1fr); gap: 5px; }
      #coffeeUi .cb { position: relative; height: 38px; border-radius: 9px; border: none; color: #fff; font: 900 12px -apple-system, Helvetica, sans-serif; letter-spacing: .03em;
        background: #6a4a32; box-shadow: 0 3px 0 #3a2618; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      #coffeeUi .cb:active { transform: translateY(2px); box-shadow: none; }
      #coffeeUi .cb.cup { background: #f2ece0; color: #3a2618; box-shadow: 0 3px 0 #a89880; }
      #coffeeUi .cb.milk { background: #e8dcc0; color: #3a2618; box-shadow: 0 3px 0 #a89878; }
      #coffeeUi .cb.syr { background: #a86a32; box-shadow: 0 3px 0 #5a3418; }
      #coffeeUi .cb[data-st="bin"] { background: #5a5a5a; box-shadow: 0 3px 0 #2a2a2a; }
      #coffeeUi .cb[data-st="ice"] { background: #6ab8d8; box-shadow: 0 3px 0 #2a6a88; }
      #coffeeUi .cb i { position: absolute; right: 4px; top: 2px; font: 700 8px -apple-system, sans-serif; opacity: .45; font-style: normal; }
      @media (pointer: coarse) { #coffeeUi .cb i { display: none; } }
      #coffeeUi .cMenu { position: absolute; top: calc(6px + var(--safe-t, 0px)); right: calc(12px + var(--safe-r, 0px)); width: 36px; height: 36px; border-radius: 50%; border: none; color: #fff;
        background: rgba(0,0,0,.35); font: 900 14px -apple-system, sans-serif; }
      #coffeeUi .cPanel { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: #1a0f08d8; text-align: center; padding: 0 24px; }
      #coffeeUi .cPanel.on { display: flex; }
      #coffeeUi .cPanel .big { font: 900 30px Georgia, "Times New Roman", serif; color: #f2e2c4; letter-spacing: .03em; }
      #coffeeUi .cPanel .sm { font-size: 14px; line-height: 1.6; max-width: 600px; opacity: .95; }
      #coffeeUi .cPanel button { padding: 10px 28px; border-radius: 999px; border: none; color: #fff; font: 900 15px -apple-system, sans-serif; background: #2e7a4a; }
      #coffeeUi .cPanel button.back { background: rgba(255,255,255,.18); }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { cv: q('.cScene'), clock: q('.cClock'), till: q('.cTill'), served: q('.cServed'), panel: q('.cPanel'), st: q('.cStations') };
    this.g = this.ui.cv.getContext('2d');
    this.ui.st.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button[data-st]');
      if (!b || this.mode !== 'play') return;
      e.preventDefault();
      this._station(b.dataset.st);
    });
    q('.cMenu').addEventListener('pointerdown', (e) => { e.preventDefault(); this._pause(); });
    this.ui.cv.addEventListener('pointerdown', (e) => { if (this.mode === 'play') { e.preventDefault(); this._tap(e.clientX, e.clientY); } });
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      const gm = this.game;
      if (e.code === 'Escape') { if (this.mode === 'paused') this._resume(); else if (this.mode === 'play') this._pause(); else this.close(); }
      else if (this.mode === 'play' && KEYS[e.code]) { if (!e.repeat) this._station(KEYS[e.code]); }
      else if (this.mode === 'play' && /^Digit[1-4]$/.test(e.code)) { if (!e.repeat) this._serve(+e.code.slice(5) - 1); }
      else if (this.mode === 'play' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && gm) {
        const dir = e.code === 'ArrowLeft' ? -1 : 1;
        for (let k = 1; k <= SPOTS; k++) { const i = ((gm.sel < 0 ? 0 : gm.sel) + dir * k + SPOTS * 4) % SPOTS; if (gm.cups[i]) { gm.select(i); break; } }
      } else if ((e.code === 'Enter' || e.code === 'Space') && (this.mode === 'brief' || this.mode === 'over')) this._newGame();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('resize', () => { if (this.active) this._fit(); });
  }

  _fit() {
    const vw = innerWidth, vh = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2.5);
    const stH = this.ui.st.getBoundingClientRect().height || 90;
    const h = vh - stH - 14;
    const cv = this.ui.cv;
    cv.style.height = `${h}px`;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(h * dpr);
    this.W = vw; this.H = h; this.dpr = dpr;
  }

  // --- flow --------------------------------------------------------------------------------------

  start() {
    this.el.classList.add('show');
    this.snd = this.snd || new CafeSound(this.o.audio && this.o.audio.ctx, this.o.audio && this.o.audio.master);
    this._fit();
    this.game = new Barista();
    this.mode = 'brief';
    this._panel(`<div class="big">FIRST CUP COFFEE</div>
      <div class="sm">It's the morning rush at Pike Place. Take a cup, build the drink the customer asked for station by station, and tap the customer to hand it over.<br>
      Shots follow the size: 1, 2, 3 for S, M, L (+SHOT is one more). Latte: shots and steamed milk. Cappuccino: add FOAM once the milk is steamed. Mocha: mocha, milk, whip. Americano: shots and water. ICED: ice first, then everything poured cold.</div>
      <div class="sm">Exact drinks get tipped. Two things wrong and it comes back.${this.best ? ` Best shift: $${this.best}.` : ''}</div>
      <button class="go">OPEN THE SHOP</button><button class="back">LEAVE</button>`, () => this._newGame(), () => this.close());
    this._draw(0);
  }

  _newGame() {
    this.game = new Barista();
    this.mode = 'play';
    this.ui.panel.classList.remove('on');
    this.acc = 0; this.paid = false; this.float = [];
    this._fit();
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
    this._panel(`<div class="big">ON A BREAK</div><div class="sm">Till $${(this.game.earned + this.game.tips).toFixed(2)} · ${Math.ceil(this.game.left)} s of the rush left</div>
      <button class="go">BACK TO THE BAR</button><button class="back">LEAVE THE SHOP</button>`, () => this._resume(), () => this.close());
  }

  _resume() { this.mode = 'play'; this.ui.panel.classList.remove('on'); }

  close() {
    this.mode = 'off';
    this.el.classList.remove('show');
    this.ui.panel.classList.remove('on');
    if (this.o.onEnd) this.o.onEnd();
  }

  _over() {
    const gm = this.game, total = Math.round(gm.earned + gm.tips), prev = this.best;
    const beat = total > prev;
    if (beat) { this.best = total; try { localStorage.setItem('auto-coffee-best', String(total)); } catch (e) { /* private */ } }
    if (!this.paid) { this.paid = true; if (total > 0 && this.o.onReward) this.o.onReward(total); }
    this.mode = 'over';
    const stars = Math.max(1, Math.min(5, Math.round(5 * gm.perfect / Math.max(1, gm.served + gm.walked) + (gm.walked === 0 ? 0.5 : 0))));
    this._panel(`<div class="big">CLOSING TIME</div><div class="sm">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}<br>
      Served ${gm.served} (${gm.perfect} perfect) · ${gm.walked} walked out · ${gm.refused} sent back<br>
      Till $${gm.earned.toFixed(2)} + tips $${gm.tips.toFixed(2)} — you take home $${total}${beat && prev > 0 ? ' · a new best shift!' : ''}</div>
      <button class="go">ANOTHER SHIFT</button><button class="back">LEAVE THE SHOP</button>`, () => this._newGame(), () => this.close());
  }

  // --- input -----------------------------------------------------------------------------------------

  _station(k) {
    const gm = this.game;
    if (k.startsWith('cup')) gm.newCup(+k.slice(3));
    else gm.apply(k);
  }

  _serve(k) {
    const r = this.game.serve(k);
    if (r && r.ok) this.float.push({ k, t: 0, text: r.m === 0 ? `+$${(r.price + r.tip).toFixed(2)}` : `+$${r.price.toFixed(2)}`, good: r.m === 0 });
    else if (r) this.float.push({ k, t: 0, text: 'NOT WHAT I ORDERED', good: false });
  }

  _tap(cx, cy) {
    const L = this._layout();
    // a customer?
    for (let k = 0; k < COUNTER; k++) {
      const x = L.custX(k);
      if (Math.abs(cx - x) < L.custW / 2 && cy > L.custTop && cy < L.counterY) { this._serve(k); return; }
    }
    // a cup?
    for (let i = 0; i < SPOTS; i++) {
      const x = L.cupX(i);
      if (Math.abs(cx - x) < L.cupW / 2 && cy > L.counterY - 10 && cy < this.H) { this.game.select(i); return; }
    }
  }

  // --- the frame ------------------------------------------------------------------------------------

  update(dt) {
    if (this.mode === 'off') return;
    const gm = this.game;
    if (this.mode === 'play' && gm && !this.frozen) {
      this.acc = Math.min(this.acc + dt, 0.2);
      while (this.acc >= STEP) {
        this.acc -= STEP;
        gm.step(STEP);
        for (const e of gm.takeEvents()) this.snd.play(e);
        if (gm.over) { this._over(); break; }
      }
    }
    if (gm) {
      const l = Math.max(0, Math.ceil(gm.left));
      const c = gm.left > 0 ? `☕ ${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}` : '☕ LAST ORDERS';
      if (this.ui.clock.textContent !== c) this.ui.clock.textContent = c;
      const t = `$${(gm.earned + gm.tips).toFixed(2)}`;
      if (this.ui.till.textContent !== t) this.ui.till.textContent = t;
      const s = `SERVED ${gm.served}${gm.line ? ` · LINE ${gm.line}` : ''}`;
      if (this.ui.served.textContent !== s) this.ui.served.textContent = s;
    }
    for (const f of this.float || []) f.t += dt;
    if (this.float) this.float = this.float.filter((f) => f.t < 1.4);
    this._draw(dt);
  }

  _layout() {
    const W = this.W, H = this.H;
    const counterY = H * 0.64;
    const custW = Math.min(170, W / 5.2), custTop = H * 0.06;
    const cupW = Math.min(90, W / 11);
    const custX = (k) => W * 0.34 + k * (W * 0.64 / COUNTER) + custW * 0.1;
    const cupX = (i) => W * 0.36 + i * (W * 0.5 / SPOTS) + cupW * 0.6;
    return { W, H, counterY, custW, custTop, cupW, custX, cupX, machX: W * 0.14 };
  }

  _draw() {
    const g = this.g, gm = this.game;
    if (!gm || !this.W) return;
    const L = this._layout(), W = L.W, H = L.H;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // the back wall: subway tile, the menu board, the window onto Pike Place
    g.fillStyle = '#e8dcc8'; g.fillRect(0, 0, W, L.counterY);
    g.strokeStyle = '#d4c6ae'; g.lineWidth = 1;
    for (let y = 0; y < L.counterY; y += 14) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); for (let x = (y / 14) % 2 ? 0 : 14; x < W; x += 28) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 14); g.stroke(); } }
    // menu board
    const mb = { x: W * 0.02, y: H * 0.1, w: W * 0.26, h: H * 0.3 };
    g.fillStyle = '#2a2a26'; g.fillRect(mb.x, mb.y, mb.w, mb.h);
    g.strokeStyle = '#8a6a42'; g.lineWidth = 4; g.strokeRect(mb.x, mb.y, mb.w, mb.h);
    g.fillStyle = '#f2ecd8'; g.font = `700 ${Math.max(9, mb.h / 11)}px Georgia, serif`; g.textAlign = 'left';
    const items = Object.values(MENU);
    items.forEach((m, i) => { const col = i % 2, row = Math.floor(i / 2); g.fillText(m.name, mb.x + 8 + col * mb.w / 2, mb.y + 18 + row * mb.h / 4.4); });
    // the espresso machine on the back bar
    const mx = L.machX, my = L.counterY - H * 0.2;
    g.fillStyle = '#b8bec4'; g.fillRect(mx - W * 0.1, my, W * 0.2, H * 0.2);
    g.fillStyle = '#e8ecf0'; g.fillRect(mx - W * 0.1, my, W * 0.2, 6);
    g.fillStyle = '#8a3a2a'; g.fillRect(mx - W * 0.1, my + 10, W * 0.2, 5);
    for (let h = 0; h < HEADS; h++) {
      const hx = mx - W * 0.05 + h * W * 0.1, s = gm.heads[h];
      g.fillStyle = '#3a3e42'; g.fillRect(hx - 10, my + H * 0.07, 20, 12);
      if (s) {
        const f = 1 - s.t / SHOT_T;
        g.fillStyle = '#5a3018'; g.fillRect(hx - 1.5, my + H * 0.07 + 12, 3, H * 0.06 * f + 4);
        g.strokeStyle = '#ffd23a'; g.lineWidth = 3; g.beginPath(); g.arc(hx, my + H * 0.04, 8, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); g.stroke();
      }
    }
    // the steamer
    const sx = mx + W * 0.11;
    g.fillStyle = '#9aa0a6'; g.fillRect(sx - 2, my + 8, 4, H * 0.12);
    if (gm.steam) {
      const f = 1 - gm.steam.t / STEAM_T;
      g.fillStyle = '#ffffff80'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(sx + Math.sin(gm.t * 7 + i) * 5, my - i * 7, 5 + i, 0, 7); g.fill(); }
      g.strokeStyle = '#ffd23a'; g.lineWidth = 3; g.beginPath(); g.arc(sx, my - 44, 8, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); g.stroke();
    }
    // the customers
    for (let k = 0; k < COUNTER; k++) this._customer(gm.counter[k], k, L);
    // the counter
    g.fillStyle = '#7a5234'; g.fillRect(0, L.counterY - 8, W, 10);
    g.fillStyle = '#c8b494'; g.fillRect(0, L.counterY, W, H - L.counterY);
    g.fillStyle = '#b8a484'; for (let x = 0; x < W; x += 60) g.fillRect(x, L.counterY, 2, H - L.counterY);
    // the cups on the counter
    for (let i = 0; i < SPOTS; i++) {
      const c = gm.cups[i], x = L.cupX(i), by = H - 8;
      g.fillStyle = '#00000018'; g.beginPath(); g.ellipse(x, by, L.cupW * 0.42, 5, 0, 0, 7); g.fill();
      if (!c) { g.strokeStyle = '#a8946e'; g.setLineDash([4, 4]); g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, by - 2, L.cupW * 0.32, 4, 0, 0, 7); g.stroke(); g.setLineDash([]); continue; }
      this._cup(c, x, by, L.cupW * (0.55 + c.size * 0.12), i === gm.sel);
    }
    // the selected cup, read out
    const c = gm.cups[gm.sel];
    if (c) {
      const lines = [SIZES[c.size] + (c.ice ? ' ICED' : '')];
      if (c.drip) lines.push('drip');
      if (c.shots) lines.push(`${c.shots} shot${c.shots > 1 ? 's' : ''}`);
      if (c.water) lines.push('water');
      for (const s of ['vanilla', 'caramel', 'mocha']) if (c[s]) lines.push(s);
      if (c.milk) lines.push(`${c.milk === 'oat' ? 'oat' : 'whole'} milk${c.ice ? '' : ' (steamed)'}`);
      if (c.foam) lines.push('foam');
      if (c.whip) lines.push('whip');
      if (c.busy > 0) lines.push('…');
      g.fillStyle = '#3a2618'; g.font = `800 ${Math.max(10, H * 0.035)}px -apple-system, Helvetica, sans-serif`; g.textAlign = 'left';
      lines.forEach((t, i) => g.fillText(t, W * 0.04, L.counterY + 22 + i * Math.max(12, H * 0.042)));
    }
    // floating till takes over the customers
    for (const f of this.float || []) {
      g.globalAlpha = Math.max(0, 1 - f.t / 1.4);
      g.fillStyle = f.good ? '#2e8a4a' : '#c83a2a'; g.font = `900 ${Math.max(12, H * 0.05)}px -apple-system, Helvetica, sans-serif`; g.textAlign = 'center';
      g.fillText(f.text, L.custX(f.k), L.counterY - H * 0.12 - f.t * 30);
      g.globalAlpha = 1;
    }
  }

  _customer(cu, k, L) {
    const g = this.g, H = L.H;
    if (!cu) return;
    const x = L.custX(k), base = L.counterY - 6;
    const slide = cu.leaving ? Math.min(1, 1.2 - cu.leaving) * 80 : 0;
    g.save(); g.translate(x + slide, 0); g.globalAlpha = cu.leaving ? Math.max(0, cu.leaving) : 1;
    const skins = ['#f0c8a0', '#d8a47a', '#a8744a', '#6a4028', '#e8b890'];
    const shirts = ['#2a4a7a', '#8a2a2a', '#2a6a4a', '#d8b030', '#5a3a7a', '#e8e8e8', '#3a3a3a', '#c86a2a'];
    const hairs = ['#2a1a10', '#6a4a2a', '#c8a050', '#1a1a1a', '#8a3a1a', '#9a9a9a'];
    const L2 = cu.look, sk = skins[L2 % skins.length], sh = shirts[(L2 * 3) % shirts.length], hr = hairs[(L2 * 5) % hairs.length];
    const s = Math.min(1.35, H / 230);
    // body and head
    g.fillStyle = sh; g.beginPath(); g.ellipse(0, base, 34 * s, 44 * s, 0, Math.PI, 0); g.fill();
    g.fillStyle = sk; g.beginPath(); g.arc(0, base - 58 * s, 20 * s, 0, 7); g.fill();
    g.fillStyle = hr;
    if (L2 % 4 === 0) { g.fillRect(-21 * s, base - 82 * s, 42 * s, 10 * s); g.fillRect(-4 * s, base - 76 * s, 30 * s, 5 * s); }            // a cap
    else if (L2 % 4 === 1) { g.beginPath(); g.arc(0, base - 62 * s, 21 * s, Math.PI, 0); g.fill(); g.fillRect(-21 * s, base - 62 * s, 7 * s, 22 * s); g.fillRect(14 * s, base - 62 * s, 7 * s, 22 * s); }   // long
    else { g.beginPath(); g.arc(0, base - 64 * s, 20 * s, Math.PI * 1.05, -0.05); g.fill(); }
    if (L2 % 6 === 3) { g.fillStyle = '#2a8a5a'; g.beginPath(); g.ellipse(0, base - 30 * s, 36 * s, 16 * s, 0, 0, Math.PI); g.fill(); }   // a rain jacket
    // the face: eyes, and a mouth by mood
    const mood = cu.moodT > 0 ? cu.mood : cu.patience / cu.max < 0.3 ? 'cross' : null;
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(-7 * s, base - 60 * s, 2.2 * s, 0, 7); g.arc(7 * s, base - 60 * s, 2.2 * s, 0, 7); g.fill();
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 2 * s; g.beginPath();
    if (mood === 'happy') g.arc(0, base - 52 * s, 7 * s, 0.2, Math.PI - 0.2);
    else if (mood === 'cross' || mood === 'gone') g.arc(0, base - 44 * s, 7 * s, Math.PI + 0.3, -0.3);
    else { g.moveTo(-5 * s, base - 49 * s); g.lineTo(5 * s, base - 49 * s); }
    g.stroke();
    g.restore();
    if (cu.leaving) return;
    // the bubble with the order, and the patience ring
    const text = orderText(cu.order);
    const fs = Math.max(10, Math.min(14, H * 0.045));
    g.font = `900 ${fs}px -apple-system, Helvetica, sans-serif`;
    const words = text.split(' '), lines = [];
    let cur = '';
    for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (g.measureText(t).width > L.custW * 0.9 && cur) { lines.push(cur); cur = w; } else cur = t; }
    lines.push(cur);
    const bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 16, bh = lines.length * (fs + 3) + 10;
    const by = Math.max(4, base - 90 * Math.min(1.35, H / 230) - bh);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#3a2618'; g.lineWidth = 2;
    g.beginPath(); g.roundRect ? g.roundRect(x - bw / 2, by, bw, bh, 8) : g.rect(x - bw / 2, by, bw, bh); g.fill(); g.stroke();
    g.fillStyle = '#3a2618'; g.textAlign = 'center';
    lines.forEach((l, i) => g.fillText(l, x, by + 5 + fs + i * (fs + 3) - 2));
    const f = Math.max(0, cu.patience / cu.max);
    g.strokeStyle = f > 0.5 ? '#2e8a4a' : f > 0.25 ? '#e0a020' : '#c83a2a'; g.lineWidth = 4;
    g.beginPath(); g.arc(x + bw / 2, by, 8, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); g.stroke();
    // the key to serve (desktop)
    if (!matchMedia('(pointer: coarse)').matches) { g.fillStyle = '#3a261880'; g.font = '700 10px -apple-system, sans-serif'; g.fillText(String(k + 1), x - bw / 2 - 8, by + 10); }
  }

  _cup(c, x, by, w, sel) {
    const g = this.g, h = w * 1.35;
    const top = by - h, bw = w * 0.78;
    if (sel) { g.fillStyle = '#ffd23a55'; g.beginPath(); g.ellipse(x, by - h / 2, w * 0.8, h * 0.66, 0, 0, 7); g.fill(); }
    const cupPath = () => { g.beginPath(); g.moveTo(x - w / 2, top); g.lineTo(x + w / 2, top); g.lineTo(x + bw / 2, by); g.lineTo(x - bw / 2, by); g.closePath(); };
    // contents, bottom up
    const layers = [];
    if (c.ice) layers.push(['ice', 0.18]);
    for (const s of ['vanilla', 'caramel', 'mocha']) if (c[s]) layers.push([s, 0.08]);
    if (c.drip) layers.push(['drip', 0.7]);
    if (c.shots) layers.push(['shot', 0.1 * c.shots]);
    if (c.water) layers.push(['water', 0.4]);
    if (c.milk) layers.push([c.milk === 'oat' ? 'oat' : 'milk', 0.42]);
    if (c.foam) layers.push(['foam', 0.14]);
    g.save(); cupPath(); g.clip();
    let y = by;
    for (const [k, f] of layers) { const lh = h * f * 0.9; g.fillStyle = COL[k]; g.fillRect(x - w, y - lh, w * 2, lh); if (k === 'ice') { g.fillStyle = '#ffffffa0'; for (let i = 0; i < 4; i++) g.fillRect(x - w * 0.3 + i * w * 0.14, y - lh * 0.8, w * 0.1, w * 0.1); } y -= lh; }
    g.restore();
    // the cup: paper with a sleeve, or a clear iced cup
    cupPath();
    if (c.ice) { g.strokeStyle = '#9ac8d8'; g.lineWidth = 2; g.stroke(); }
    else {
      g.save(); cupPath(); g.clip();
      g.fillStyle = '#f6f2ea'; g.globalAlpha = layers.length ? 0.55 : 1; g.fillRect(x - w, top, w * 2, h); g.globalAlpha = 1;
      g.fillStyle = '#a8784a'; g.fillRect(x - w, top + h * 0.35, w * 2, h * 0.3);
      g.restore();
      cupPath(); g.strokeStyle = '#8a7a64'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#ffffff'; g.fillRect(x - w * 0.54, top - 5, w * 1.08, 6);
    }
    if (c.whip) { g.fillStyle = '#ffffff'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x - w * 0.2 + i * w * 0.2, top - 2 - (i === 1 ? 6 : 0), w * 0.16, 0, 7); g.fill(); } }
    g.fillStyle = '#3a2618'; g.font = `900 ${Math.max(10, w * 0.24)}px -apple-system, Helvetica, sans-serif`; g.textAlign = 'center';
    g.fillText(SIZES[c.size], x, by - h * 0.5 + 4);
    if (c.busy > 0) { g.strokeStyle = '#ffd23a'; g.lineWidth = 3; g.beginPath(); g.arc(x, top - 16, 7, performance.now() / 150, performance.now() / 150 + 4); g.stroke(); }
  }
}

export { SHIFT, recipe };
