// ROLL UP THE RIM TO WIN, at every Tim Hortons in the region.
//
// Walk up to any Tims door (kw.js buildSigns records one per store, in front
// of its sign) and press ENTER, or stop a car beside one and press ENTER for
// the drive-thru. The city pauses (game.hold) and the counter opens: a medium
// is $2 and one roll, a large $3 and two, a double-double optional (it is
// the default; black gets a look). The cup is drawn on a canvas, a tapered
// paper cup with its lip rolled, the label wrapped round it in slices so it
// turns: English on one side, French on the other. Swipe UP on the rim (or
// hold Up / W / Space) and the lip unrolls left to right, the message printed
// under it coming up letter by letter as the curl passes. Each side unrolls
// on its own; either one finished is the reveal.
//
// The prize is drawn when the cup is poured (as on the real cups), about one
// in five a winner: a free coffee (a fresh cup, another roll), a donut, ten
// Timbits, $5, $20, $100, $1,000, and one cup in 400 a CAR, parked at the
// kerb outside that Tims (traffic.spawnAt(..., 'apron'), never despawned).
// Stats are kept in localStorage `autokw-rollup`. Sounds are synthesised on
// the game's AudioContext: the crinkle of the paper, the till, a jingle.

const KEY = 'autokw-rollup';
const RED = '#c8102e';

/** w: chance in 10000. rank orders "best prize". */
const PRIZES = [
  { id: 'car', w: 25, rank: 8, en: 'WIN A CAR!', fr: 'GAGNEZ UNE AUTO!', title: 'YOU WON A CAR!', sub: 'It is parked at the kerb outside. Keys are in it.' },
  { id: 'c1000', w: 15, rank: 7, cash: 1000, en: 'WIN $1,000', fr: 'GAGNEZ 1 000 $', title: 'YOU WON $1,000!', sub: 'Cash. In your wallet. Tell nobody at the Tims.' },
  { id: 'c100', w: 40, rank: 6, cash: 100, en: 'WIN $100', fr: 'GAGNEZ 100 $', title: 'YOU WON $100!', sub: 'That is fifty mediums.' },
  { id: 'c20', w: 110, rank: 5, cash: 20, en: 'WIN $20', fr: 'GAGNEZ 20 $', title: 'YOU WON $20', sub: 'A green one, with the Queen on it.' },
  { id: 'c5', w: 260, rank: 4, cash: 5, en: 'WIN $5', fr: 'GAGNEZ 5 $', title: 'YOU WON $5', sub: 'Two and a half coffees.' },
  { id: 'timbits', w: 300, rank: 3, en: 'WIN 10 TIMBITS', fr: 'GAGNEZ 10 TIMBITS', title: '10 TIMBITS!', sub: 'Mostly the birthday cake ones. Nobody wants the plain.' },
  { id: 'donut', w: 450, rank: 2, en: 'WIN A DONUT', fr: 'GAGNEZ UN BEIGNE', title: 'A FREE DONUT!', sub: 'Boston cream. The cashier says it is still warm.' },
  { id: 'coffee', w: 900, rank: 1, en: 'WIN A COFFEE', fr: 'GAGNEZ UN CAFÉ', title: 'FREE COFFEE!', sub: 'A fresh cup on the house: another roll.' },
];
const LOSE = [
  [70, 'PLEASE PLAY AGAIN', 'MERCI, REJOUEZ SVP'],
  [8, 'PLEASE PLAY AGAIN, EH', 'MERCI, REJOUEZ SVP'],
  [7, 'SO CLOSE. PLAY AGAIN', 'PRESQUE! REJOUEZ SVP'],
  [6, 'NOT TODAY, BUD', 'PAS AUJOURD’HUI'],
  [5, 'SORRY! PLAY AGAIN', 'DÉSOLÉ! REJOUEZ SVP'],
  [4, 'PLEASE PLAY AGAIN :(', 'MERCI, REJOUEZ SVP :('],
];
const LOSE_SUB = [
  'Like every cup since 1986.', 'The rim giveth, the rim taketh away.', 'Your thumbnail did its best.',
  'There is always the next cup.', 'Statistically, the next one is due. (It is not.)', 'Sorry. So sorry. Very Canadian of it.',
];
const SIZES = { m: { name: 'MEDIUM', price: 2, rolls: 1 }, l: { name: 'LARGE', price: 3, rolls: 2 } };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const WORD_FONT = '"Snell Roundhand", "Brush Script MT", "Segoe Script", "Apple Chancery", Georgia, serif';
const BLOCK_FONT = '"Arial Black", "Helvetica Neue", Impact, Arial, sans-serif';

/** Draw a prize for a freshly poured cup (rig: a prize id or 'lose', for the harness). */
export function drawPrize(rnd = Math.random, rig = null) {
  if (rig) {
    const p = PRIZES.find((q) => q.id === rig);
    if (p) return p;
    return null;
  }
  let r = rnd() * 10000;
  for (const p of PRIZES) { if (r < p.w) return p; r -= p.w; }
  return null;
}
function loseLine(rnd = Math.random) {
  const tot = LOSE.reduce((s, l) => s + l[0], 0);
  let r = rnd() * tot;
  for (const l of LOSE) { if (r < l[0]) return l; r -= l[0]; }
  return LOSE[0];
}

/** The till, the crinkle and the jingle: one-shots on the game's AudioContext. */
class Synth {
  constructor(audio) {
    const c = audio && audio.ctx;
    this.c = c;
    if (!c) return;
    this.out = c.createGain();
    this.out.gain.value = 0.32;
    this.out.connect(audio.master || c.destination);
    const n = c.sampleRate;
    this.nb = c.createBuffer(1, n, n);
    const d = this.nb.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.lastCrinkle = 0;
  }
  tone(type, f, at, dur, vol, slide) {
    const c = this.c, t = c.currentTime + 0.01 + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.03);
  }
  noise(at, dur, vol, f, q = 1.2, type = 'bandpass') {
    const c = this.c, t = c.currentTime + 0.005 + at;
    const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.nb; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.out); s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.02);
  }
  /** Waxed paper giving way: a few dry ticks and a hiss, louder the faster you roll. */
  crinkle(k) {
    if (!this.c) return;
    const now = this.c.currentTime;
    if (now - this.lastCrinkle < 0.045) return;
    this.lastCrinkle = now;
    const v = 0.12 + 0.5 * clamp(k, 0, 1);
    for (let i = 0; i < 3; i++) this.noise(i * 0.011 + Math.random() * 0.008, 0.012 + Math.random() * 0.01, v * (0.6 + Math.random() * 0.6), 2600 + Math.random() * 3800, 2.5);
    this.noise(0, 0.06, v * 0.25, 5200, 0.7, 'highpass');
  }
  till() {
    if (!this.c) return;
    this.noise(0, 0.05, 0.5, 1800, 1.5);
    this.tone('sine', 2093, 0.05, 0.5, 0.25);
    this.tone('sine', 2637, 0.12, 0.6, 0.22);
  }
  win(big) {
    if (!this.c) return;
    const notes = big ? [523, 659, 784, 1047, 784, 1047, 1319, 1568] : [784, 988, 1175, 1568];
    notes.forEach((f, i) => {
      this.tone('triangle', f, i * 0.11, 0.32, 0.32);
      this.tone('sine', f * 2, i * 0.11, 0.5, 0.08);
    });
    if (big) for (let i = 0; i < 6; i++) this.tone('sine', 2093 + i * 300, 1.0 + i * 0.07, 0.4, 0.06);
  }
  lose() {
    if (!this.c) return;
    this.tone('triangle', 392, 0, 0.28, 0.22, 370);
    this.tone('triangle', 311, 0.26, 0.5, 0.22, 262);
  }
  click() { if (this.c) this.tone('square', 1400, 0, 0.04, 0.06); }
}

export class RollUp {
  /** opts: { city, traffic, audio, money: () => n, charge(n) -> bool, onReward(n), onToast(text), onEnd } */
  constructor(opts) {
    this.o = opts;
    this.mode = 'off';            // off | counter | cup | result
    this.rig = null;              // the next cup's prize, forced (harness): a prize id or 'lose'
    this.dd = true;               // double-double
    this.rollsLeft = 0;
    this.cup = null;
    this.store = null;
    this.drive = false;
    this.dtLock = null;           // the store whose drive-thru just closed: the next ENTER there gets you out
    this.t = 0;
    this.keys = {};
    this.fx = [];
    this.stats = this._load();
    this._buildDom();
    this._labels();
  }

  get active() { return this.mode !== 'off'; }
  /** "best" for the passport's convention: the best prize's rank. */
  get best() { return this.stats.bestRank || 0; }

  // --- where -------------------------------------------------------------------------

  stores() { return (this.o.kw && this.o.kw() && this.o.kw().built && this.o.kw().built.tims) || []; }

  /** On foot, at a Tims door (or close to a store that has none). */
  near(pl) {
    let best = null, bd = Infinity;
    for (const s of this.stores()) {
      const d = s.door ? Math.hypot(pl.x - s.door.x, pl.z - s.door.z) : Math.hypot(pl.x - s.x, pl.z - s.z);
      const r = s.door ? 5 : 14;
      if (d < r && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** In a car, stopped by a Tims: the drive-thru. */
  driveThru(pl) {
    const v = pl.vehicle;
    if (pl.onFoot || !v || v.dead) return null;
    const sp = v.spec || {};
    if (sp.plane || sp.boat || sp.floats || sp.rail || sp.balloon || v.afloat || v.airborne) return null;
    if (Math.abs(v.vLong || 0) > 2.5) return null;
    let best = null, bd = 45;
    for (const s of this.stores()) {
      const d = Math.min(Math.hypot(v.x - s.x, v.z - s.z), s.door ? Math.hypot(v.x - s.door.x, v.z - s.door.z) : Infinity);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return null;
    if (this.dtLock === best) { this.dtLock = null; return null; }
    return best;
  }

  // --- stats -------------------------------------------------------------------------

  _load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    s = Object.assign({ rolls: 0, wins: 0, cash: 0, cars: 0, bestRank: 0, best: '', day: '', today: 0, todayWins: 0 }, s || {});
    return s;
  }
  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.stats)); } catch (e) { /* private mode */ } }
  _today() {
    const d = new Date().toDateString(), s = this.stats;
    if (s.day !== d) { s.day = d; s.today = 0; s.todayWins = 0; }
  }

  // --- the overlay -------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'rollupUi';
    d.innerHTML = `
      <div class="ruHead"><div class="ruWord">Tim Hortons</div><div class="ruTag">ROLL UP THE RIM TO WIN</div><div class="ruWhere"></div></div>
      <button class="ruX" aria-label="Leave">✕</button>
      <div class="ruBody">
        <div class="ruStage"><canvas></canvas><div class="ruHint"></div></div>
        <div class="ruSide"></div>
      </div>
      <div class="ruFoot"></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #rollupUi { position: absolute; inset: 0; z-index: 40; display: none; flex-direction: column; color: #fff; overflow: hidden;
        font: 600 14px -apple-system, Helvetica, Arial, sans-serif; user-select: none; -webkit-user-select: none;
        background: radial-gradient(ellipse at 35% 30%, #6a3424 0%, #3a1a10 55%, #1e0d08 100%), #2a140c; }
      #rollupUi.show { display: flex; }
      #rollupUi button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; border: none; color: inherit; font: inherit; cursor: pointer; }
      #rollupUi .ruHead { flex: 0 0 auto; display: flex; align-items: center; gap: 14px; background: ${RED};
        padding: calc(4px + var(--safe-t, 0px)) calc(58px + var(--safe-r, 0px)) 4px calc(16px + var(--safe-l, 0px));
        box-shadow: 0 3px 0 #8e0b20, 0 6px 18px #0008; min-height: 40px; }
      #rollupUi .ruWord { font: italic 700 30px ${WORD_FONT}; line-height: 1.1; white-space: nowrap; text-shadow: 0 1px 0 #7a0a1c; }
      #rollupUi .ruTag { font: 900 12px ${BLOCK_FONT}; letter-spacing: .12em; color: #ffe08a; white-space: nowrap; }
      #rollupUi .ruWhere { margin-left: auto; font-size: 11px; opacity: .85; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
      #rollupUi .ruWhere b { background: #fff; color: ${RED}; border-radius: 4px; padding: 1px 6px; margin-right: 6px; font: 900 10px ${BLOCK_FONT}; letter-spacing: .06em; }
      #rollupUi .ruX { position: absolute; top: calc(4px + var(--safe-t, 0px)); right: calc(10px + var(--safe-r, 0px)); width: 38px; height: 38px;
        border-radius: 50%; background: rgba(0,0,0,.25); font-size: 17px; z-index: 2; }
      #rollupUi .ruBody { flex: 1 1 auto; display: flex; min-height: 0; padding: 0 var(--safe-r, 0px) 0 var(--safe-l, 0px); }
      #rollupUi .ruStage { flex: 1 1 auto; position: relative; min-width: 0; min-height: 0; touch-action: none; }
      #rollupUi .ruStage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
      #rollupUi .ruHint { position: absolute; left: 0; right: 0; bottom: 8px; text-align: center; font: 800 13px -apple-system, Helvetica, sans-serif;
        letter-spacing: .04em; color: #ffe08a; text-shadow: 0 1px 3px #000; pointer-events: none; transition: opacity .3s; }
      #rollupUi .ruSide { flex: 0 0 min(340px, 44%); display: flex; flex-direction: column; justify-content: center; gap: 9px;
        margin: 10px 12px 10px 4px; padding: 12px; overflow-y: auto; -webkit-overflow-scrolling: touch;
        background: linear-gradient(#2a1810, #1c100a); border: 2px solid #4a2c1c; border-radius: 16px; box-shadow: 0 8px 24px #0007, inset 0 1px 0 #ffffff14; }
      #rollupUi .ruSay { background: #fff8ec; color: #3a1a10; border-radius: 12px 12px 12px 3px; padding: 8px 11px; font: 600 13px/1.3 Georgia, serif;
        font-style: italic; box-shadow: 0 2px 0 #0004; }
      #rollupUi .ruSizes { display: flex; gap: 8px; }
      #rollupUi .ruSize { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 9px 4px 8px; border-radius: 12px;
        background: linear-gradient(#fff, #f1e6d6); color: #3a1a10; box-shadow: 0 4px 0 #8e6a4a; }
      #rollupUi .ruSize:active { transform: translateY(3px); box-shadow: 0 1px 0 #8e6a4a; }
      #rollupUi .ruSize b { font: 900 16px ${BLOCK_FONT}; color: ${RED}; letter-spacing: .04em; }
      #rollupUi .ruSize span { font-size: 12px; margin-top: 2px; }
      #rollupUi .ruSize i { font-style: normal; font: 900 22px ${BLOCK_FONT}; }
      #rollupUi .ruDD { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 10px; background: rgba(255,255,255,.08); font-size: 13px; cursor: pointer; }
      #rollupUi .ruDD .bx { width: 22px; height: 22px; border-radius: 6px; background: #fff; color: ${RED}; display: flex; align-items: center; justify-content: center; font: 900 16px sans-serif; flex: 0 0 auto; }
      #rollupUi .ruDD small { display: block; opacity: .7; font-size: 11px; font-weight: 500; }
      #rollupUi .ruBtn { padding: 11px 14px; border-radius: 999px; background: ${RED}; font: 900 15px ${BLOCK_FONT}; letter-spacing: .03em; box-shadow: 0 4px 0 #7a0a1c; }
      #rollupUi .ruBtn:active { transform: translateY(3px); box-shadow: 0 1px 0 #7a0a1c; }
      #rollupUi .ruBtn.alt { background: rgba(255,255,255,.14); box-shadow: 0 4px 0 #0005; font: 800 14px -apple-system, Helvetica, sans-serif; }
      #rollupUi .ruBtn:disabled { opacity: .4; }
      #rollupUi .ruRow { display: flex; gap: 8px; } #rollupUi .ruRow > * { flex: 1; }
      #rollupUi .ruBig { font: 900 19px ${BLOCK_FONT}; letter-spacing: .02em; line-height: 1.15; }
      #rollupUi .ruSm { font-size: 12px; opacity: .8; line-height: 1.35; }
      #rollupUi .ruCups { display: flex; gap: 5px; align-items: center; font-size: 12px; }
      #rollupUi .ruCups .c { width: 14px; height: 18px; background: #fff; clip-path: polygon(0 0, 100% 0, 82% 100%, 18% 100%); border-top: 3px solid ${RED}; }
      #rollupUi .ruCups .c.used { opacity: .25; }
      #rollupUi .ruPrize { border-radius: 14px; padding: 10px 12px; background: #fff8ec; color: #3a1a10; text-align: center; box-shadow: 0 3px 0 #0005; }
      #rollupUi .ruPrize.win { background: linear-gradient(#ffe9a0, #ffd23a); animation: ruPop .45s cubic-bezier(.2,1.6,.4,1); }
      #rollupUi .ruPrize.car { background: linear-gradient(#fff, #ffd23a 40%, #ff9a3a); }
      #rollupUi .ruPrize .h { font: 900 22px ${BLOCK_FONT}; color: ${RED}; line-height: 1.1; }
      #rollupUi .ruPrize.lose .h { color: #5a3a2a; font-size: 18px; }
      #rollupUi .ruPrize .s { font-size: 12px; margin-top: 4px; line-height: 1.3; }
      @keyframes ruPop { 0% { transform: scale(.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      #rollupUi .ruFoot { flex: 0 0 auto; display: flex; justify-content: center; gap: 18px; flex-wrap: wrap; font-size: 11px; letter-spacing: .02em;
        padding: 4px calc(12px + var(--safe-r, 0px)) calc(4px + var(--safe-b, 0px)) calc(12px + var(--safe-l, 0px)); background: rgba(0,0,0,.4); color: #f4e4cc; }
      #rollupUi .ruFoot b { color: #ffe08a; }
      @media (max-height: 460px) {
        #rollupUi .ruWord { font-size: 25px; } #rollupUi .ruHead { min-height: 34px; }
        #rollupUi .ruSide { gap: 6px; margin: 6px 8px 6px 2px; padding: 9px; } #rollupUi .ruBtn { padding: 8px 12px; }
        #rollupUi .ruSay { padding: 6px 9px; font-size: 12px; } #rollupUi .ruSize { padding: 6px 4px; } #rollupUi .ruSize i { font-size: 18px; }
        #rollupUi .ruPrize { padding: 7px 10px; } #rollupUi .ruPrize .h { font-size: 19px; }
      }
      @media (max-width: 620px) { #rollupUi .ruTag { display: none; } }
      @media (orientation: portrait) {
        #rollupUi .ruBody { flex-direction: column; }
        #rollupUi .ruSide { flex: 0 0 auto; margin: 0 12px 10px; }
        #rollupUi .ruStage { min-height: 40%; }
        #rollupUi .ruTag { display: none; }
      }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { where: q('.ruWhere'), side: q('.ruSide'), foot: q('.ruFoot'), stage: q('.ruStage'), cv: q('.ruStage canvas'), hint: q('.ruHint') };
    this.g = this.ui.cv.getContext('2d');
    q('.ruX').addEventListener('click', () => this.close());

    // rolling: any upward drag on the stage (the rim is where the thumb goes,
    // but a near miss still rolls). Never latch: a new press always takes over.
    const cv = this.ui.stage;
    let id = null, lastY = 0, lastT = 0;
    const down = (e) => {
      e.preventDefault();
      id = e.pointerId; lastY = e.clientY; lastT = performance.now();
      try { cv.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ }
      this.dragging = true;
    };
    const move = (e) => {
      if (e.pointerId !== id) return;
      const dy = lastY - e.clientY, now = performance.now();
      lastY = e.clientY;
      if (dy > 0) this._roll(dy / this._need(), dy / Math.max(1, now - lastT));
      lastT = now;
    };
    const up = (e) => { if (e.pointerId === id) { id = null; this.dragging = false; } };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) cv.addEventListener(ev, up);

    window.addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      const c = e.code;
      if (c === 'Escape') this.close();
      else if (c === 'ArrowUp' || c === 'KeyW' || c === 'Space') {
        if (this.mode === 'cup') this.keys.up = true;
        else if (!e.repeat) this._primary();
      } else if (c === 'Enter' || c === 'NumpadEnter' || c === 'Digit1') { if (!e.repeat) this._primary(); }
      else if (c === 'Digit2' || c === 'KeyL') { if (this.mode === 'counter') this._buy('l'); }
      else if (c === 'KeyC' || c === 'KeyD') { if (this.mode === 'counter') { this.dd = !this.dd; this._side(); } }
      else if (c === 'ArrowLeft' || c === 'ArrowRight' || c === 'KeyT' || c === 'KeyK') { if (this.cup) this._turn(); }
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') this.keys.up = false;
    });
    window.addEventListener('resize', () => { if (this.active) this._fit(); });
  }

  /** px of upward drag for one whole side: about three good swipes on a phone. */
  _need() { return Math.max(260, (this.L ? this.L.cupH : 240) * 2.4); }

  _fit() {
    const r = this.ui.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = Math.max(1, r.width); this.ch = Math.max(1, r.height);
    this.ui.cv.width = Math.round(this.cw * dpr); this.ui.cv.height = Math.round(this.ch * dpr);
    this.dpr = dpr;
    const W = this.cw, H = this.ch;
    const cupH = Math.min(H * 0.64, W * 1.05);
    const rT = cupH * 0.35, rB = cupH * 0.25;
    const stripH = cupH * 0.15;
    const topY = Math.round(H * 0.5 - cupH * 0.5 + stripH * 0.55);
    this.L = { W, H, cx: W / 2, cupH, rT, rB, ryT: rT * 0.2, ryB: rB * 0.2, topY, botY: topY + cupH, tb: rT * 0.085, stripH };
  }

  // --- flow ----------------------------------------------------------------------------

  start(store, drive = false) {
    this.store = store;
    this.drive = drive;
    this.mode = 'counter';
    this.cup = null;
    this.rollsLeft = 0;
    this.fx = [];
    this.keys = {};
    this.prizeCar = null;
    this.sfx = this.sfx || new Synth(this.o.audio);
    this.el.classList.add('show');
    const a = store && store.addr ? store.addr : 'Waterloo Region';
    this.ui.where.innerHTML = `${drive ? '<b>DRIVE-THRU</b>' : ''}${a.replace(/[<&]/g, '')}`;
    this.say = drive ? 'Welcome to Tim Hortons, can I take your order? <span style="opacity:.6">(the speaker crackles)</span>'
      : 'Hi, welcome to Tims! What can I get started for you?';
    this._fit();
    this._side();
    this._foot();
  }

  close() {
    if (this.mode === 'off') return;
    this.mode = 'off';
    this.el.classList.remove('show');
    this.keys = {};
    if (this.drive && this.store) this.dtLock = this.store;
    const car = this.prizeCar;
    this.prizeCar = null;
    if (this.o.onEnd) this.o.onEnd();
    if (car && this.o.onToast) this.o.onToast('Your new car is parked at the kerb outside the Tims. Congratulations, eh!');
    else if (this.drive && this.o.onToast) this.o.onToast('Drive-thru done. ENTER again here to park and get out');
  }

  _primary() {
    if (this.mode === 'counter') this._buy('m');
    else if (this.mode === 'result') { if (this.rollsLeft > 0) this._pour(); else this._again(); }
  }

  _again() { this.mode = 'counter'; this.cup = null; this.say = 'Back again? Same as before?'; this._side(); }

  _buy(size) {
    const S = SIZES[size];
    if (!this.o.charge(S.price)) {
      this.say = `That's $${S.price}.00, hon. <span style="opacity:.6">(you are $${(S.price - this.o.money()).toFixed(2)} short)</span>`;
      this._side();
      return;
    }
    this.sfx.till();
    this.size = size;
    this.rollsLeft = S.rolls;
    this.cupsBought = S.rolls;
    this._pour();
  }

  /** A fresh cup on the counter: the prize is decided now, as it is printed. */
  _pour() {
    const prize = drawPrize(Math.random, this.rig);
    this.rig = null;
    const lose = prize ? null : loseLine();
    this.cup = {
      prize, en: prize ? prize.en : lose[1], fr: prize ? prize.fr : lose[2],
      p: [0, 0], rot: 0, rotTo: 0, done: false, wob: 0, revealT: 0, size: this.size, dd: this.dd,
    };
    this._rimLabel();
    this.mode = 'cup';
    this.say = this.dd ? ['One double-double. Two cream, two sugar, zero regrets.', 'Double-double, there you go. Good luck, eh!', 'Here’s your double-double. Roll that rim!'][Math.floor(Math.random() * 3)]
      : ['Black coffee. Bold choice, bud.', 'Black, like a January morning in Kitchener.', 'One black coffee. Respect.'][Math.floor(Math.random() * 3)];
    this._side();
    this._foot();
  }

  _turn() {
    const c = this.cup;
    if (!c) return;
    c.rotTo = c.rotTo ? 0 : Math.PI;
    this.sfx.click();
    this._side();
  }

  /** Which side faces you (0 English, 1 French), or -1 while the cup turns. */
  _face() {
    const c = this.cup;
    if (!c || Math.abs(c.rot - c.rotTo) > 0.06) return -1;
    return c.rotTo ? 1 : 0;
  }

  _roll(dp, speed) {
    const c = this.cup;
    if (!c || this.mode === 'off') return;
    const s = this._face();
    if (s < 0 || c.p[s] >= 1) return;
    c.p[s] = Math.min(1, c.p[s] + dp);
    c.wob = Math.min(1, c.wob + dp * 6);
    this.sfx.crinkle(speed);
    if (c.p[s] >= 1 && !c.done) this._reveal();
  }

  _reveal() {
    const c = this.cup, P = c.prize, st = this.stats;
    c.done = true;
    c.revealT = 0;
    this.rollsLeft = Math.max(0, this.rollsLeft - 1);
    this._today();
    st.rolls++; st.today++;
    if (P) {
      st.wins++; st.todayWins++;
      if (P.rank > (st.bestRank || 0)) { st.bestRank = P.rank; st.best = P.title.replace(/^YOU WON /, '').replace(/!$/, ''); }
      if (P.cash) { st.cash += P.cash; if (this.o.onReward) this.o.onReward(P.cash); }
      if (P.id === 'coffee') { this.rollsLeft++; this.cupsBought++; }
      if (P.id === 'car') { st.cars++; this.prizeCar = this._parkPrize(); }
      this.sfx.win(P.rank >= 6);
      this._confetti(P.rank >= 6 ? 160 : 70);
    } else this.sfx.lose();
    this._save();
    // the result panel after the last letters have landed
    setTimeout(() => {
      if (this.cup !== c || this.mode === 'off') return;
      this.mode = 'result';
      this.loseSub = LOSE_SUB[Math.floor(Math.random() * LOSE_SUB.length)];
      this._side();
      this._foot();
    }, P ? 350 : 550);
  }

  /** The grand prize: a red car at the kerb nearest the store's door. */
  _parkPrize() {
    const { city, traffic } = this.o;
    const s = this.store;
    if (!city || !traffic || !s) return null;
    const o = s.door || s;
    let best = null;
    for (const ei of city.edgesNear(o.x, o.z, 90)) {
      const e = city.edges[ei];
      if (e.elev || e.tunnel || e.prof || e.cls === 'hwy' || e.cls === 'ramp' || e.len < 20) continue;
      const a = city.nodes[e.a];
      const t = clamp((o.x - a.x) * e.dx + (o.z - a.z) * e.dz, 9, e.len - 9);
      const qx = a.x + e.dx * t, qz = a.z + e.dz * t, d = Math.hypot(o.x - qx, o.z - qz);
      if (!best || d < best.d) best = { e, qx, qz, d };
    }
    let x, z, heading;
    if (best) {
      const { e, qx, qz } = best;
      // the kerb on the store's side; a car there faces the way that kerb is on its right
      const sg = (o.x - qx) * -e.dz + (o.z - qz) * e.dx >= 0 ? 1 : -1;
      x = qx - e.dz * sg * (e.hw - 1.15); z = qz + e.dx * sg * (e.hw - 1.15);
      heading = Math.atan2(e.dx * sg, e.dz * sg);
    } else { x = o.x + 6; z = o.z; heading = 0; }
    for (const v of [...traffic.cars]) {
      if (v.mode !== 'parked' || Math.hypot(v.x - x, v.z - z) > 7) continue;
      if (typeof v.slot === 'number' && traffic.reservedSlots) traffic.reservedSlots.add(v.slot);
      traffic.remove(v);
    }
    const type = Math.random() < 0.6 ? 'sports' : 'suv';
    const v = traffic.spawnAt(x, z, heading, type, 0xc8102e, 'apron');
    v.vLong = 0;
    v.rollupPrize = true;
    return v;
  }

  // --- the side panel and the footer ------------------------------------------------

  _side() {
    const el = this.ui.side, m = this.mode;
    const cash = this.o.money();
    let h = '';
    if (m === 'counter') {
      h = `<div class="ruSay">${this.say}</div>
        <div class="ruSizes">
          <button class="ruSize" data-s="m"><b>MEDIUM</b><i>$2</i><span>1 roll</span></button>
          <button class="ruSize" data-s="l"><b>LARGE</b><i>$3</i><span>2 rolls</span></button>
        </div>
        <div class="ruDD" role="checkbox"><div class="bx">${this.dd ? '✓' : ''}</div><div>Make it a double-double<small>${this.dd ? 'Two cream, two sugar. The correct order.' : 'Black. The cashier is judging you a little.'}</small></div></div>
        <div class="ruSm">Your cash: $${cash.toLocaleString()} · about 1 cup in 5 wins</div>`;
    } else if (m === 'cup') {
      const c = this.cup, fr = c.rotTo !== 0;
      h = `<div class="ruSay">${this.say}</div>
        <div class="ruBig">${fr ? 'Glissez vers le haut<br>sur le rebord' : 'Swipe UP on the rim<br>to roll it'}</div>
        <div class="ruSm">${fr ? 'Ou maintenez ↑ / W / Espace.' : 'Or hold ↑ / W / Space.'} One side is enough: English on the front, French on the back.</div>
        ${this._cupsRow()}
        <button class="ruBtn alt ruTurn">↻ ${fr ? 'Turn the cup · English side' : 'Turn the cup · côté français'}</button>`;
    } else if (m === 'result') {
      const P = this.cup.prize;
      const cls = P ? (P.id === 'car' ? 'win car' : 'win') : 'lose';
      const title = P ? P.title : (this.cup.rotTo ? 'MERCI, REJOUEZ SVP' : 'PLEASE PLAY AGAIN');
      const sub = P ? P.sub : this.loseSub;
      const next = this.rollsLeft > 0 ? `<button class="ruBtn ruNext">${P && P.id === 'coffee' ? 'Roll the free cup' : 'Roll the next cup'}</button>`
        : '<button class="ruBtn ruAgain">Another coffee</button>';
      h = `<div class="ruPrize ${cls}"><div class="h">${title}</div><div class="s">${sub}</div></div>
        ${this._cupsRow()}
        <div class="ruRow">${next}<button class="ruBtn alt ruLeave">${this.drive ? 'Drive off' : 'Leave'}</button></div>
        <div class="ruSm">Your cash: $${cash.toLocaleString()}</div>`;
    }
    el.innerHTML = h;
    const on = (sel, f) => { const b = el.querySelector(sel); if (b) b.addEventListener('click', f); };
    for (const b of el.querySelectorAll('.ruSize')) b.addEventListener('click', () => this._buy(b.dataset.s));
    on('.ruDD', () => { this.dd = !this.dd; this.sfx.click(); this._side(); });
    on('.ruTurn', () => this._turn());
    on('.ruNext', () => this._pour());
    on('.ruAgain', () => this._again());
    on('.ruLeave', () => this.close());
    const hint = this.ui.hint;
    hint.textContent = m === 'cup' ? (this.cup.rotTo ? '▲ GLISSEZ VERS LE HAUT ▲' : '▲ SWIPE UP ON THE RIM ▲') : '';
  }

  _cupsRow() {
    if (!this.cupsBought) return '';
    const n = this.cupsBought, used = n - this.rollsLeft;
    let s = '';
    for (let i = 0; i < Math.min(n, 8); i++) s += `<div class="c${i < used ? ' used' : ''}"></div>`;
    const more = this.mode === 'cup' ? this.rollsLeft - 1 : this.rollsLeft;
    const txt = this.mode === 'cup' ? (more ? `${more} more after this one` : n > 1 ? 'your last cup' : 'one cup, one roll')
      : more ? `${more} roll${more === 1 ? '' : 's'} left` : 'all rolled';
    return `<div class="ruCups">${s}<span>&nbsp;${txt}</span></div>`;
  }

  _foot() {
    const s = this.stats;
    this._today();
    this.ui.foot.innerHTML = `<span>Today: <b>${s.today}</b> roll${s.today === 1 ? '' : 's'} · <b>${s.todayWins}</b> win${s.todayWins === 1 ? '' : 's'}</span>`
      + `<span>All time: <b>${s.rolls}</b> roll${s.rolls === 1 ? '' : 's'} · <b>${s.wins}</b> win${s.wins === 1 ? '' : 's'}${s.best ? ` · best: <b>${s.best}</b>` : ''}</span>`;
  }

  // --- the frame -----------------------------------------------------------------------

  update(dt) {
    if (this.mode === 'off') return;
    this.t += dt;
    const c = this.cup;
    if (c) {
      if (this.keys.up && this.mode === 'cup') this._roll(dt * 0.36, 0.5);
      const d = c.rotTo - c.rot;
      c.rot += Math.abs(d) < 0.002 ? d : d * Math.min(1, dt * 7);
      c.wob = Math.max(0, c.wob - dt * 2.5);
      if (c.done) c.revealT += dt;
    }
    for (const f of this.fx) { f.vy += 420 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.r += f.vr * dt; f.life -= dt; }
    this.fx = this.fx.filter((f) => f.life > 0 && f.y < this.ch + 20);
    if (this.ui.hint) this.ui.hint.style.opacity = this.mode === 'cup' && c && Math.max(c.p[0], c.p[1]) < 0.12 ? (0.6 + 0.4 * Math.sin(this.t * 5)) : 0;
    this._draw();
  }

  _confetti(n) {
    const L = this.L;
    const cols = ['#c8102e', '#ffffff', '#ffd23a', '#ff6a3a', '#8a1020'];
    for (let i = 0; i < n; i++) {
      this.fx.push({ x: L.cx + (Math.random() - 0.5) * L.rT * 1.4, y: L.topY - L.stripH, vx: (Math.random() - 0.5) * 520, vy: -260 - Math.random() * 420,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, s: 4 + Math.random() * 6, c: cols[i % cols.length], life: 2.2 + Math.random() * 1.4 });
    }
  }

  // --- the art -------------------------------------------------------------------------

  /** The cup's printed wrap, all the way round: English half, French half (twice over, so a slice never wraps). */
  _labels() {
    const LW = 1080, LH = 520;
    const cv = document.createElement('canvas'); cv.width = LW * 2; cv.height = LH;
    const g = cv.getContext('2d');
    const half = (x0, fr) => {
      const w = LW / 2, cx = x0 + w / 2;
      g.fillStyle = '#fbf8f2'; g.fillRect(x0, 0, w, LH);
      // up arrows under the rim
      g.fillStyle = RED;
      for (let i = 0; i < 7; i++) {
        const ax = x0 + 40 + i * (w - 80) / 6;
        g.beginPath(); g.moveTo(ax, 12); g.lineTo(ax - 11, 30); g.lineTo(ax + 11, 30); g.closePath(); g.fill();
      }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 17px ${BLOCK_FONT}`;
      g.fillText(fr ? 'DÉROULEZ ICI' : 'ROLL UP HERE', cx, 46, w * 0.5);
      // the wordmark
      g.fillStyle = RED; g.font = `italic 700 86px ${WORD_FONT}`;
      g.fillText('Tim Hortons', cx, 112, w * 0.86);
      // a maple leaf either side of it is too busy: one, small, under the wordmark
      leaf(g, cx, 162, 15, RED);
      // the red band
      g.fillStyle = RED; g.fillRect(x0, 188, w, 228);
      g.fillStyle = '#ffffff22'; g.fillRect(x0, 188, w, 5);
      g.fillStyle = '#fff';
      g.font = `900 ${fr ? 62 : 80}px ${BLOCK_FONT}`;
      g.fillText(fr ? 'DÉROULEZ' : 'ROLL UP', cx, 236, w * 0.86);
      g.fillStyle = '#ffd23a';
      g.font = `900 ${fr ? 56 : 66}px ${BLOCK_FONT}`;
      g.fillText(fr ? 'LE REBORD' : 'THE RIM', cx, 306, w * 0.86);
      g.fillStyle = '#fff';
      g.font = `900 ${fr ? 46 : 58}px ${BLOCK_FONT}`;
      g.fillText(fr ? 'POUR GAGNER' : 'TO WIN', cx, 372, w * 0.86);
      // the brown foot band
      g.fillStyle = '#5a3020'; g.fillRect(x0, 432, w, LH - 432);
      g.fillStyle = '#f2e2c6'; g.font = `800 20px ${BLOCK_FONT}`;
      g.fillText(fr ? 'DEPUIS 1964 · CAFÉ FRAIS' : 'SINCE 1964 · ALWAYS FRESH', cx, 470, w * 0.8);
      g.font = '600 14px Helvetica, Arial, sans-serif'; g.globalAlpha = 0.7;
      g.fillText(fr ? 'Attention : le contenu peut être chaud' : 'Careful, the beverage you are about to enjoy is hot', cx, 500, w * 0.84);
      g.globalAlpha = 1;
    };
    for (let k = 0; k < 2; k++) { half(k * LW, false); half(k * LW + LW / 2, true); }
    this.lab = { cv, LW, LH };
  }

  /** The message under the rim: English centred on the front, French on the back. */
  _rimLabel() {
    const RW = 1080, RH = 84;
    const cv = (this.rim && this.rim.cv) || document.createElement('canvas');
    cv.width = RW * 2; cv.height = RH;
    const g = cv.getContext('2d');
    const c = this.cup;
    const P = c.prize;
    for (let k = 0; k < 2; k++) {
      for (let sd = 0; sd < 2; sd++) {
        const x0 = k * RW + sd * RW / 2, w = RW / 2, cx = x0 + w / 2;
        const gr = g.createLinearGradient(0, 0, 0, RH);
        gr.addColorStop(0, '#efe3cb'); gr.addColorStop(0.5, '#f8f0de'); gr.addColorStop(1, '#e2d2b4');
        g.fillStyle = gr; g.fillRect(x0, 0, w, RH);
        g.fillStyle = '#d9c6a2'; g.fillRect(x0, RH - 6, w, 6);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = P ? RED : '#4a2a1c';
        const txt = sd ? c.fr : c.en;
        g.font = `900 ${txt.length > 18 ? 40 : 48}px ${BLOCK_FONT}`;
        g.fillText(txt, cx, RH * 0.47, w * 0.8);
        if (P) { leaf(g, x0 + w * 0.06, RH * 0.47, 10, RED); leaf(g, x0 + w * 0.94, RH * 0.47, 10, RED); }
      }
    }
    this.rim = { cv, RW, RH };
  }

  /** How far the lip is unrolled at screen angle phi (0 = facing you): 0 rolled .. 1 up. */
  _lift(phi) {
    const c = this.cup;
    if (!c) return 0;
    const psi = wrapA(phi + c.rot);
    const s = Math.abs(psi) < Math.PI / 2 ? 0 : 1;
    const loc = s === 0 ? psi : wrapA(psi - Math.PI);
    const q = (loc + Math.PI / 2) / Math.PI;               // 0 left edge .. 1 right edge of that side
    const f = c.p[s] * 1.06;
    if (c.p[s] <= 0) return 0;
    return clamp((f - q) / 0.06, 0, 1);
  }

  _draw() {
    const g = this.g, L = this.L;
    if (!L) return;
    const { W, H, cx, rT, rB, ryT, ryB, topY, botY, tb, stripH, cupH } = L;
    const c = this.cup, t = this.t;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // the counter: a wood top the cup stands on, its front edge below
    const cy0 = botY - ryB * 2.2, cy1 = Math.min(H, botY + cupH * 0.16);
    let gr = g.createLinearGradient(0, cy0, 0, cy1);
    gr.addColorStop(0, '#8a5634'); gr.addColorStop(1, '#a8703f');
    g.fillStyle = gr; g.fillRect(0, cy0, W, cy1 - cy0);
    g.globalAlpha = 0.08; g.fillStyle = '#000';
    for (let i = 0; i < 9; i++) g.fillRect(0, cy0 + (cy1 - cy0) * (i / 9) + Math.sin(i * 3.1) * 2, W, 1);
    g.globalAlpha = 1;
    g.fillStyle = '#e7c9a0'; g.fillRect(0, cy1 - 3, W, 3);
    gr = g.createLinearGradient(0, cy1, 0, H);
    gr.addColorStop(0, RED); gr.addColorStop(1, '#6e0817');
    g.fillStyle = gr; g.fillRect(0, cy1, W, H - cy1);
    // things on the counter: a prize, a napkin
    if (c && c.done && c.prize) this._counterProp(c.prize.id, cx + rT * 1.9, botY + ryB * 0.4, cupH * 0.22);
    // the cup's shadow
    g.fillStyle = 'rgba(30,10,0,.35)';
    g.beginPath(); g.ellipse(cx + rB * 0.25, botY + ryB * 0.4, rB * 1.25, ryB * 1.5, 0, 0, Math.PI * 2); g.fill();

    // the far half of the lip: unrolled paper stands up (its back to us), rolled lip behind the coffee
    const N = 72;
    for (let i = 0; i < N; i++) {
      const a0 = Math.PI / 2 + (i / N) * Math.PI, a1 = Math.PI / 2 + ((i + 1) / N) * Math.PI;
      const am = (a0 + a1) / 2, lift = this._lift(am);
      if (lift <= 0.02) continue;
      const x0 = cx + rT * Math.sin(a0), x1 = cx + rT * Math.sin(a1);
      const y0 = topY + ryT * Math.cos(a0), y1 = topY + ryT * Math.cos(a1);
      const h = stripH * lift;
      g.fillStyle = `rgb(${200 - 30 * Math.abs(Math.sin(am))},${186 - 30 * Math.abs(Math.sin(am))},${160 - 30 * Math.abs(Math.sin(am))})`;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x1, y1 - h); g.lineTo(x0, y0 - h); g.closePath(); g.fill();
    }
    this._tube(Math.PI / 2, Math.PI * 1.5, 0.82);
    // the coffee
    const cr = rT - tb * 0.55, cry = ryT * (cr / rT);
    g.save();
    g.beginPath(); g.ellipse(cx, topY, cr, cry, 0, 0, Math.PI * 2); g.clip();
    const dd = c ? c.dd : this.dd;
    gr = g.createRadialGradient(cx - cr * 0.2, topY + cry * 0.4, cr * 0.05, cx, topY + cry * 0.6, cr * 1.1);
    if (dd) { gr.addColorStop(0, '#c99a6a'); gr.addColorStop(0.7, '#a8744a'); gr.addColorStop(1, '#6a4428'); }
    else { gr.addColorStop(0, '#5a3418'); gr.addColorStop(0.7, '#3a1e0c'); gr.addColorStop(1, '#1e0e04'); }
    g.fillStyle = gr; g.fillRect(cx - cr, topY - cry, cr * 2, cry * 2.4);
    // the inner wall's shadow at the back
    g.fillStyle = 'rgba(250,244,232,.92)';
    g.beginPath(); g.ellipse(cx, topY - cry * 0.62, cr, cry * 0.7, 0, Math.PI, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.beginPath(); g.ellipse(cx - cr * 0.35, topY + cry * 0.15, cr * 0.28, cry * 0.18, -0.2, 0, Math.PI * 2); g.fill();
    g.restore();
    // steam
    g.save();
    g.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const ph = t * 0.9 + k * 2.1, x = cx + (k - 1) * rT * 0.45;
      g.strokeStyle = `rgba(255,255,255,${0.1 + 0.06 * Math.sin(ph)})`; g.lineWidth = rT * 0.12;
      g.beginPath(); g.moveTo(x, topY - stripH * 0.3);
      for (let j = 1; j <= 8; j++) g.lineTo(x + Math.sin(ph + j * 0.8) * rT * 0.12, topY - stripH * 0.3 - j * cupH * 0.05);
      g.stroke();
    }
    g.restore();

    // the body: the wrap in slices round the cone, then the light on it
    const lab = this.lab, rot = c ? c.rot : 0;
    const bodyPath = () => {
      g.beginPath();
      g.moveTo(cx - rT, topY);
      g.lineTo(cx - rB, botY);
      g.ellipse(cx, botY, rB, ryB, 0, Math.PI, 0, true);
      g.lineTo(cx + rT, topY);
      g.ellipse(cx, topY, rT, ryT, 0, 0, Math.PI, false);
      g.closePath();
    };
    g.save();
    bodyPath(); g.clip();
    const NS = 90;
    for (let i = 0; i < NS; i++) {
      const p0 = -Math.PI / 2 + (i / NS) * Math.PI, p1 = -Math.PI / 2 + ((i + 1) / NS) * Math.PI;
      let u = ((p0 + rot + Math.PI / 2) / (2 * Math.PI)) % 1; if (u < 0) u += 1;
      const U0 = u * lab.LW, dU = (p1 - p0) / (2 * Math.PI) * lab.LW;
      const xt0 = cx + rT * Math.sin(p0), xt1 = cx + rT * Math.sin(p1);
      const xb0 = cx + rB * Math.sin(p0), xb1 = cx + rB * Math.sin(p1);
      const yt0 = topY + ryT * Math.cos(p0), yt1 = topY + ryT * Math.cos(p1);
      const yb0 = botY + ryB * Math.cos(p0);
      const a = ((xt1 - xt0) + (xb1 - xb0)) / 2 / dU;
      g.setTransform(this.dpr * a, this.dpr * (yt1 - yt0) / dU, this.dpr * (xb0 - xt0) / lab.LH, this.dpr * (yb0 - yt0) / lab.LH, this.dpr * xt0, this.dpr * yt0);
      g.drawImage(lab.cv, U0, 0, dU, lab.LH, 0, 0, dU + 0.8 / Math.max(0.05, a), lab.LH);
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    gr = g.createLinearGradient(cx - rT, 0, cx + rT, 0);
    gr.addColorStop(0, 'rgba(40,16,4,.55)'); gr.addColorStop(0.12, 'rgba(40,16,4,.18)');
    gr.addColorStop(0.32, 'rgba(255,255,255,.22)'); gr.addColorStop(0.42, 'rgba(255,255,255,0)');
    gr.addColorStop(0.75, 'rgba(40,16,4,.12)'); gr.addColorStop(1, 'rgba(40,16,4,.6)');
    g.fillStyle = gr; g.fillRect(cx - rT, topY - ryT, rT * 2, cupH + ryT * 2);
    g.restore();

    // the near half of the lip: the unrolled paper with the message, the curl, the lip still rolled
    const rim = this.rim;
    let curl = null;
    for (let i = 0; i < N; i++) {
      const p0 = -Math.PI / 2 + (i / N) * Math.PI, p1 = -Math.PI / 2 + ((i + 1) / N) * Math.PI, pm = (p0 + p1) / 2;
      const lift = this._lift(pm);
      if (lift > 0.02 && lift < 0.98 && c && !curl) curl = pm;
      if (lift <= 0.02 || !rim) continue;
      let u = ((p0 + rot + Math.PI / 2) / (2 * Math.PI)) % 1; if (u < 0) u += 1;
      const U0 = u * rim.RW, dU = (p1 - p0) / (2 * Math.PI) * rim.RW;
      const x0 = cx + rT * Math.sin(p0), x1 = cx + rT * Math.sin(p1);
      const y0 = topY + ryT * Math.cos(p0) + tb * 0.2, y1 = topY + ryT * Math.cos(p1) + tb * 0.2;
      const h = stripH * lift, sh = rim.RH * lift;
      g.setTransform(this.dpr * (x1 - x0) / dU, this.dpr * (y1 - y0) / dU, 0, this.dpr * h / sh, this.dpr * x0, this.dpr * (y0 - h));
      g.drawImage(rim.cv, U0, rim.RH - sh, dU, sh, 0, 0, dU + 0.8 * dU / Math.max(0.2, x1 - x0), sh);
      g.fillStyle = `rgba(60,30,10,${0.42 * (1 - Math.cos(pm)) + 0.12 * (1 - lift)})`;
      g.fillRect(0, 0, dU + 0.8 * dU / Math.max(0.2, x1 - x0), sh);
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._tube(-Math.PI / 2, Math.PI / 2, 1);
    if (curl !== null) this._curl(curl);

    // confetti
    for (const f of this.fx) {
      g.save(); g.translate(f.x, f.y); g.rotate(f.r); g.globalAlpha = Math.min(1, f.life);
      g.fillStyle = f.c; g.fillRect(-f.s / 2, -f.s / 4, f.s, f.s / 2); g.restore();
    }
    // a glow round a win
    if (c && c.done && c.prize && c.revealT < 3) {
      const k = Math.max(0, 1 - c.revealT / 3);
      g.save(); g.globalCompositeOperation = 'lighter';
      gr = g.createRadialGradient(cx, topY - stripH * 0.5, 0, cx, topY - stripH * 0.5, rT * 1.6);
      gr.addColorStop(0, `rgba(255,210,58,${0.5 * k})`); gr.addColorStop(1, 'rgba(255,210,58,0)');
      g.fillStyle = gr; g.fillRect(cx - rT * 1.6, topY - stripH * 0.5 - rT * 1.6, rT * 3.2, rT * 3.2);
      g.restore();
    }
  }

  /** The rolled lip along screen angles a0..a1, where it is still rolled. */
  _tube(a0, a1, shade) {
    const g = this.g, { cx, rT, ryT, topY, tb } = this.L;
    const N = 72;
    g.lineCap = 'round';
    const pass = (w, dy, col) => {
      g.strokeStyle = col; g.lineWidth = w;
      let open = false;
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = a0 + (a1 - a0) * (i / N);
        const lift = this._lift(a);
        const x = cx + rT * Math.sin(a), y = topY + ryT * Math.cos(a) + dy;
        if (lift < 0.5) { if (!open) { g.moveTo(x, y); open = true; } else g.lineTo(x, y); } else open = false;
      }
      g.stroke();
    };
    const k = shade;
    pass(tb, 0, `rgb(${Math.round(176 * k)},${Math.round(166 * k)},${Math.round(150 * k)})`);
    pass(tb * 0.72, -tb * 0.1, `rgb(${Math.round(236 * k)},${Math.round(230 * k)},${Math.round(218 * k)})`);
    pass(tb * 0.28, -tb * 0.24, `rgb(${Math.round(255 * k)},${Math.round(255 * k)},${Math.round(252 * k)})`);
    // a red line printed along the lip's edge (front only)
    if (shade >= 1) pass(tb * 0.14, tb * 0.36, 'rgba(200,16,46,.75)');
  }

  /** The curl where the paper is coming off the lip. */
  _curl(phi) {
    const g = this.g, c = this.cup, { cx, rT, ryT, topY, tb, stripH } = this.L;
    const x = cx + rT * Math.sin(phi), y = topY + ryT * Math.cos(phi);
    const fw = Math.max(0.35, Math.cos(phi));
    const wob = c ? c.wob : 0;
    const rx = tb * (1.25 + 0.25 * wob) * fw, ry = stripH * 0.42 + tb * 0.5;
    const cy = y - ry * 0.55 - wob * tb * 0.3;
    g.save();
    g.fillStyle = 'rgba(40,16,4,.25)';
    g.beginPath(); g.ellipse(x + rx * 0.5, y + tb * 0.3, rx * 1.3, tb * 0.5, 0, 0, Math.PI * 2); g.fill();
    const gr = g.createLinearGradient(x - rx, 0, x + rx, 0);
    gr.addColorStop(0, '#d6cbb8'); gr.addColorStop(0.35, '#ffffff'); gr.addColorStop(1, '#a89c88');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(x, cy, rx, ry, 0.08, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(120,100,80,.6)'; g.lineWidth = 1; g.stroke();
    // the spiral end of the roll
    g.strokeStyle = 'rgba(200,16,46,.7)'; g.lineWidth = Math.max(1, tb * 0.12);
    g.beginPath(); g.ellipse(x + rx * 0.15, cy - ry * 0.1, rx * 0.45, ry * 0.5, 0.08, 0.3, 5.2); g.stroke();
    g.restore();
  }

  /** What you won, on the counter beside the cup. */
  _counterProp(id, x, y, s) {
    const g = this.g;
    g.save();
    if (id === 'donut' || id === 'coffee') {
      if (id === 'coffee') { g.restore(); return; }
      g.fillStyle = 'rgba(30,10,0,.3)'; g.beginPath(); g.ellipse(x, y + s * 0.12, s * 0.62, s * 0.18, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d8a060'; g.beginPath(); g.ellipse(x, y, s * 0.55, s * 0.3, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4a2410'; g.beginPath(); g.ellipse(x, y - s * 0.05, s * 0.5, s * 0.24, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#c08048'; g.beginPath(); g.ellipse(x, y - s * 0.04, s * 0.16, s * 0.07, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.ellipse(x - s * 0.2, y - s * 0.12, s * 0.12, s * 0.04, -0.3, 0, Math.PI * 2); g.fill();
    } else if (id === 'timbits') {
      const cols = ['#d8a060', '#4a2410', '#f4d6e0', '#c08048', '#e8c070'];
      for (let i = 0; i < 6; i++) {
        const bx = x + ((i % 3) - 1) * s * 0.32, by = y - Math.floor(i / 3) * s * 0.2 + (i < 3 ? 0 : -s * 0.04);
        g.fillStyle = cols[i % cols.length]; g.beginPath(); g.arc(bx, by, s * 0.15, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.arc(bx - s * 0.05, by - s * 0.05, s * 0.04, 0, Math.PI * 2); g.fill();
      }
    } else if (id === 'car') {
      g.strokeStyle = '#c9ccd0'; g.lineWidth = s * 0.06;
      g.beginPath(); g.arc(x - s * 0.3, y - s * 0.05, s * 0.14, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#222'; g.beginPath(); g.roundRect ? g.roundRect(x - s * 0.18, y - s * 0.16, s * 0.34, s * 0.22, s * 0.06) : g.rect(x - s * 0.18, y - s * 0.16, s * 0.34, s * 0.22); g.fill();
      g.fillStyle = RED; g.beginPath(); g.arc(x - s * 0.01, y - s * 0.05, s * 0.05, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#c9ccd0'; g.fillRect(x + s * 0.16, y - s * 0.08, s * 0.42, s * 0.07);
      g.fillRect(x + s * 0.44, y - s * 0.01, s * 0.06, s * 0.08); g.fillRect(x + s * 0.32, y - s * 0.01, s * 0.05, s * 0.06);
    } else {
      // a banknote: $5 blue, $20 green, $100 brown, $1,000 pink
      const P = PRIZES.find((p) => p.id === id);
      const col = { c5: '#3a6ec8', c20: '#3a9a5a', c100: '#9a6a3a', c1000: '#d86aa0' }[id] || '#3a9a5a';
      const n = id === 'c1000' ? 4 : 1;
      for (let k = n - 1; k >= 0; k--) {
        g.save(); g.translate(x + k * s * 0.08, y - k * s * 0.05); g.rotate(-0.12 + k * 0.06);
        g.fillStyle = 'rgba(30,10,0,.25)'; g.fillRect(-s * 0.55 + 3, -s * 0.22 + 3, s * 1.1, s * 0.44);
        g.fillStyle = col; g.fillRect(-s * 0.55, -s * 0.22, s * 1.1, s * 0.44);
        g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.5; g.strokeRect(-s * 0.5, -s * 0.18, s * 1.0, s * 0.36);
        g.fillStyle = '#fff'; g.font = `900 ${Math.round(s * 0.2)}px ${BLOCK_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(P && P.cash ? String(P.cash) : '', s * 0.22, 0);
        leaf(g, -s * 0.25, 0, s * 0.1, 'rgba(255,255,255,.8)');
        g.restore();
      }
    }
    g.restore();
  }
}

/** A plain eleven-point maple leaf (no one's logo), centred at (x, y), radius r. */
function leaf(g, x, y, r, col) {
  const P = [[0, -1], [0.16, -0.62], [0.36, -0.72], [0.3, -0.3], [0.62, -0.5], [0.56, -0.28], [0.86, -0.22], [0.66, 0.02], [0.76, 0.12],
    [0.34, 0.24], [0.4, 0.46], [0.06, 0.36], [0.06, 0.9], [-0.06, 0.9], [-0.06, 0.36], [-0.4, 0.46], [-0.34, 0.24], [-0.76, 0.12],
    [-0.66, 0.02], [-0.86, -0.22], [-0.56, -0.28], [-0.62, -0.5], [-0.3, -0.3], [-0.36, -0.72], [-0.16, -0.62]];
  g.fillStyle = col;
  g.beginPath();
  P.forEach(([px, py], i) => (i ? g.lineTo(x + px * r, y + py * r) : g.moveTo(x + px * r, y + py * r)));
  g.closePath(); g.fill();
}
