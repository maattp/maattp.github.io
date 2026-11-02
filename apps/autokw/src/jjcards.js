// RIP PACKS AT J&J: ENTER on foot at the red door of J&J Cards & Collectibles
// (230 Weber St N, Waterloo -- kwlandmarks2.js jjCastle exports `jjDoor`) and
// the world holds (game.hold('jj'), as Roll Up the Rim does) while a DOM overlay
// opens: the shop counter in the castle's blue, red and gold.
//
//   - A pack is $5 and six cards of WATERLOO REGION LEGENDS, SERIES 1 (jjart.js:
//     60 invented locals, none real; common 30, uncommon 14, rare 9, holo foil 6,
//     and one Golden Goose, 1 pack in 500). Slot odds are in `SLOTS`.
//   - Tear the wrapper (drag across its top, tap it, or ENTER), then flip the
//     cards one by one, the best last. Rares and up stay face-down and glow until
//     you tap; holo foil and the Goose shimmer with the light, which follows the
//     pointer (or drifts on its own).
//   - The binder pages through the set; a card you do not have is a silhouette.
//     Spares sell for $1 (common) up to $250 (Goose). 15/30/45 different cards
//     and the full set pay a bonus; the full set also hangs a framed Golden
//     Goose in J&J's window (the only thing this ever adds to the 3D scene, 2
//     meshes, built on completion).
//   - Saved in localStorage `autokw-jjcards`. Sounds are synthesised on the
//     game's AudioContext. While the overlay is up main.js draws no city.
//
// Harness: `__dbg.jj` (`stats`, `rig` (ids of the next pack), `rnd`, `openPack()`,
// `odds(n, seed)`, `door`, `near(pl)`, `mode`).

import { SET, SET_SIZE, RARITY, BY_RARITY, drawCardBase, drawCardBack, drawSilhouette, drawPack, sheen, CARD_W, CARD_H } from './jjart.js';

const KEY = 'autokw-jjcards';
const PRICE = 5;
const GOOSE_ODDS = 1 / 500;
const MILESTONES = [[15, 25], [30, 75], [45, 200]];
const COMPLETE_BONUS = 1000;
const REACH = 4.0;
const RANK = ['c', 'u', 'r', 'h', 'g'];
// per slot: [common, uncommon, rare, holo] weights. The sixth is the "hit" slot.
const SLOTS = [
  [78, 22, 0, 0], [78, 22, 0, 0], [78, 22, 0, 0], [78, 22, 0, 0],
  [30, 50, 20, 0],
  [35, 30, 22, 13],
];
const SERIF = 'Georgia, "Times New Roman", serif';
const BLOCK = '"Arial Black", "Helvetica Neue", Impact, Arial, sans-serif';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** One pack: 6 card ids, best last. `rnd` () -> [0,1). */
export function rollPack(rnd = Math.random) {
  const ids = [];
  for (let s = 0; s < 6; s++) {
    let r = 'c';
    if (s === 5 && rnd() < GOOSE_ODDS) r = 'g';
    else {
      const w = SLOTS[s];
      let x = rnd() * (w[0] + w[1] + w[2] + w[3]);
      for (let i = 0; i < 4; i++) { if (x < w[i]) { r = RANK[i]; break; } x -= w[i]; }
    }
    const pool = BY_RARITY[r];
    ids.push(pool[Math.floor(rnd() * pool.length) % pool.length]);
  }
  return ids.sort((a, b) => RARITY[SET[a - 1].r].rank - RARITY[SET[b - 1].r].rank);
}

class Synth {
  constructor(audio) {
    const c = audio && audio.ctx;
    this.c = c;
    if (!c) return;
    this.out = c.createGain(); this.out.gain.value = 0.34;
    this.out.connect(audio.master || c.destination);
    const n = c.sampleRate; this.nb = c.createBuffer(1, n, n);
    const d = this.nb.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.lastTear = 0;
  }
  tone(type, f, at, dur, vol, slide) {
    const c = this.c, t = c.currentTime + 0.01 + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.03);
  }
  noise(at, dur, vol, f, q = 1.2, type = 'bandpass') {
    const c = this.c, t = c.currentTime + 0.005 + at, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.nb; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.out); s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.02);
  }
  /** Foil ripping: a burst of ragged noise, higher as the tear goes on. */
  tear(k) {
    if (!this.c) return;
    const now = this.c.currentTime; if (now - this.lastTear < 0.035) return; this.lastTear = now;
    for (let i = 0; i < 3; i++) this.noise(i * 0.009, 0.02 + Math.random() * 0.02, 0.3 + Math.random() * 0.3, 2400 + k * 3000 + Math.random() * 2500, 2.2);
    this.noise(0, 0.07, 0.18, 6200, 0.7, 'highpass');
  }
  rip() { if (this.c) { this.noise(0, 0.28, 0.5, 3200, 0.6, 'highpass'); this.noise(0.02, 0.18, 0.4, 1400, 1.2); this.tone('square', 220, 0, 0.12, 0.05, 90); } }
  flip(rank) {
    if (!this.c) return;
    this.noise(0, 0.07, 0.25, 4200, 0.8, 'highpass'); this.tone('triangle', 660 + rank * 90, 0.03, 0.08, 0.1, 440);
  }
  slide() { if (this.c) this.noise(0, 0.09, 0.14, 1800, 0.6); }
  till() { if (!this.c) return; this.noise(0, 0.05, 0.5, 1800, 1.5); this.tone('sine', 2093, 0.05, 0.5, 0.25); this.tone('sine', 2637, 0.12, 0.6, 0.22); }
  click() { if (this.c) this.tone('square', 1400, 0, 0.04, 0.06); }
  /** Sparkle: a rising run of bells, more of them for a better card. */
  sparkle(rank) {
    if (!this.c) return;
    const n = 4 + rank * 3, base = [880, 988, 1175, 1319, 1568][Math.min(4, rank)];
    for (let i = 0; i < n; i++) { const f = base * Math.pow(1.122, i * 2) * (i % 2 ? 1.5 : 1); this.tone('sine', Math.min(f, 6000), i * 0.06, 0.45, 0.13); this.tone('triangle', Math.min(f * 2, 7000), i * 0.06 + 0.02, 0.3, 0.04); }
    if (rank >= 3) for (let i = 0; i < 6; i++) this.tone('sine', 2200 + i * 380, 0.5 + i * 0.05, 0.5, 0.05);
  }
  fanfare() {
    if (!this.c) return;
    [523, 659, 784, 1047, 784, 1047, 1319, 1568, 2093].forEach((f, i) => { this.tone('triangle', f, i * 0.12, 0.4, 0.3); this.tone('sine', f * 2, i * 0.12, 0.6, 0.08); });
  }
  coins() { if (this.c) for (let i = 0; i < 4; i++) { this.tone('sine', 1760 + i * 220, i * 0.07, 0.25, 0.12); this.noise(i * 0.07, 0.03, 0.2, 5200, 2); } }
}

export class JJCards {
  /**
   * o: { audio, door: () => [x, z] | null, win: () => [x, y, z, nx, nz] | null, scene, THREE,
   *      money: () => n, charge(n) -> bool, onReward(n, why), onToast(text), onEnd(), busy(pl) }
   */
  constructor(o) {
    this.o = o;
    this.mode = 'off';           // off | shop | tear | reveal | summary | binder | zoom
    this.rig = null;             // the next pack's ids (harness)
    this.rnd = Math.random;
    this.t = 0;
    this.tilt = [0, 0]; this.tiltTo = [0, 0]; this.pointer = false;
    this.stats = this._load();
    this.said = false;
    this.cache = new Map(); this.thumbs = new Map(); this.back = null;
    this.page = 0; this.cells = [];
    this.fx = [];
    this._buildDom();
    if (this.stats.done) this._trophy();
  }

  get active() { return this.mode !== 'off'; }
  get door() { return this.o.door ? this.o.door() : null; }
  get owned() { return this.stats.owned; }
  get distinct() { return Object.keys(this.stats.owned).filter((k) => this.stats.owned[k] > 0).length; }

  // --- where ----------------------------------------------------------------------------

  near(pl) {
    const d = this.door;
    if (!d || !pl || !pl.onFoot || this.active) return false;
    if (Math.hypot(pl.x - d[0], pl.z - d[1]) > REACH) return false;
    if (this.o.busy && this.o.busy(pl)) return false;   // a car at the kerb is the ENTER
    return true;
  }
  /** Walking up: say what the door does, once a visit. */
  hint(dt, pl) {
    const d = this.door;
    if (!d || !pl) return;
    const e = Math.hypot(pl.x - d[0], pl.z - d[1]);
    if (e > 14) { this.said = false; return; }
    if (this.said || e > REACH + 1 || !pl.onFoot) return;
    this.said = true;
    if (this.o.onToast) this.o.onToast(`J&J Cards & Collectibles — ENTER to rip a pack ($${PRICE}, ${this.distinct}/${SET_SIZE} cards)`);
  }

  // --- stats ----------------------------------------------------------------------------

  _load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    s = Object.assign({ owned: {}, packs: 0, spent: 0, earned: 0, sold: 0, done: false, ms: [] }, s || {});
    if (!s.owned || typeof s.owned !== 'object') s.owned = {};
    if (!Array.isArray(s.ms)) s.ms = [];
    return s;
  }
  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.stats)); } catch (e) { /* private mode */ } }
  card(id) { return SET[id - 1]; }
  count(id) { return this.stats.owned[id] || 0; }
  /** Spares: [{ id, extra, value }] and their total. */
  spares() {
    const out = [];
    for (const k of Object.keys(this.stats.owned)) {
      const n = this.stats.owned[k], c = this.card(+k);
      if (c && n > 1) out.push({ id: +k, extra: n - 1, value: (n - 1) * RARITY[c.r].sell });
    }
    return out;
  }
  spareValue() { return this.spares().reduce((s, x) => s + x.value, 0); }
  spareCount() { return this.spares().reduce((s, x) => s + x.extra, 0); }

  // --- flow -----------------------------------------------------------------------------

  start() {
    this.mode = 'shop';
    this.sfx = this.sfx || new Synth(this.o.audio);
    this.el.classList.add('show');
    this.say = this.stats.packs ? 'Welcome back! New stock came in this morning.' : 'Welcome to J&J! Series 1 just landed — six cards a pack.';
    this.rv = null; this.pk = null;
    this._fit(); this._side(); this._foot();
  }
  close() {
    if (this.mode === 'off') return;
    // paid for means yours: leaving mid-tear or mid-reveal still banks the pack
    if (this.mode === 'tear' && this.pk) {
      this._reveal(); this.rv.i = 5;
    }
    if (this.mode === 'reveal' && this.rv) this._summary();
    this.mode = 'off';
    this.el.classList.remove('show');
    if (this.o.onEnd) this.o.onEnd();
    this.said = true;
  }
  _back() {
    if (this.mode === 'zoom') { this.mode = this.zoomFrom || 'binder'; this._side(); }
    else if (this.mode === 'binder') { this.mode = this.rv && this.rvDone ? 'summary' : 'shop'; this._side(); }
    else this.close();
  }

  buy() {
    if (this.mode !== 'shop' && this.mode !== 'summary') return false;
    if (!this.o.charge(PRICE)) {
      this.say = `That's $${PRICE}.00, friend. <span style="opacity:.6">(you are $${(PRICE - this.o.money()).toFixed(0)} short — spares sell for cash)</span>`;
      if (this.mode === 'shop') this._side();
      else { this.mode = 'shop'; this._side(); }
      return false;
    }
    this.sfx.till();
    this.stats.spent += PRICE; this.stats.packs++;
    const ids = (this.rig && this.rig.length === 6) ? this.rig.slice() : rollPack(this.rnd);
    this.rig = null;
    this.pk = { ids, tear: 0, t: 0, drag: 0, state: 'wrap', rip: 0 };
    this.mode = 'tear';
    this._save(); this._side(); this._foot();
    return true;
  }
  /** Add p to the tear; at 1 the pack opens. */
  _tear(p) {
    if (this.mode !== 'tear') return;
    const k = this.pk;
    const before = k.tear;
    k.tear = clamp(k.tear + p, 0, 1);
    if (k.tear > before) this.sfx.tear(k.tear);
    if (k.tear >= 1 && k.state === 'wrap') { k.state = 'opening'; k.rip = 0; this.sfx.rip(); }
  }
  /** The wrapper is off: the cards are ours. Counted once, now, so a closed overlay keeps them. */
  _reveal() {
    const ids = this.pk.ids;
    this.rv = { ids, i: 0, flip: 0, flipping: false, enter: 0, out: 0, news: [], t: 0, fired: false, autoAt: 0 };
    this.rvDone = false;
    const fresh = [];
    for (const id of ids) { if (!this.count(id)) fresh.push(id); this.stats.owned[id] = this.count(id) + 1; }
    this.rv.fresh = fresh.slice();
    this.rv.seenBefore = {};     // dupes shown as "x2" on the card
    const tmp = {};
    for (const id of ids) { tmp[id] = (tmp[id] || 0) + 1; }
    this.rv.nthOf = ids.map((id, n) => ids.slice(0, n + 1).filter((x) => x === id).length);
    this._save();
    this.mode = 'reveal';
    this._arm(0);
    this._side();
  }
  _arm(i) {
    const r = this.rv; r.i = i; r.flip = 0; r.flipping = false; r.fired = false; r.enter = 0; r.out = 0;
    const c = this.card(r.ids[i]);
    r.auto = RARITY[c.r].rank <= 1 ? 0.25 : -1;   // commons flip themselves; rares wait for the tap
    r.wait = 0;
    this.sfx.slide();
  }
  /** Tap / ENTER in the reveal. */
  advance() {
    const r = this.rv;
    if (this.mode === 'summary') { return; }
    if (this.mode !== 'reveal' || !r) return;
    if (r.out > 0) return;
    if (!r.flipping && r.flip < 1) { if (r.enter >= 1) { r.flipping = true; r.auto = -1; } return; }
    if (r.flip < 1) return;
    // send it off, bring the next
    r.out = 0.001;
  }
  _flipped() {
    const r = this.rv, id = r.ids[r.i], c = this.card(id), rk = RARITY[c.r].rank;
    this.sfx.flip(rk);
    if (rk >= 2) { this.sfx.sparkle(rk); this._burst(rk); }
    if (rk === 4 && this.o.onToast) { /* the screen says it */ }
    r.fired = true;
  }
  _burst(rk) {
    const W = this.cw || 400, H = this.ch || 300, n = 14 + rk * 16;
    const col = rk >= 4 ? ['#fff2a8', '#f2c230', '#fff'] : rk === 3 ? ['#ffb0f0', '#8ad8ff', '#fff6a0', '#b0ffb8'] : ['#9ad0ff', '#fff'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 260;
      this.fx.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.9 + Math.random() * 0.9, t: 0, c: col[i % col.length], r: 2 + Math.random() * 3.5 });
    }
  }
  _summary() {
    const r = this.rv;
    this.mode = 'summary'; this.rvDone = true;
    // milestones and the set
    const d = this.distinct, notes = [];
    for (const [n, cash] of MILESTONES) if (d >= n && !this.stats.ms.includes(n)) {
      this.stats.ms.push(n); this.stats.earned += cash;
      this.o.onReward(cash, `${n} different cards`); notes.push(`${n} different cards: +$${cash}`);
    }
    if (d >= SET_SIZE && !this.stats.done) {
      this.stats.done = true; this.stats.earned += COMPLETE_BONUS;
      this.o.onReward(COMPLETE_BONUS, 'THE FULL SET'); notes.push(`THE FULL SET! +$${COMPLETE_BONUS} and a framed Golden Goose in J&J's window`);
      this._trophy(); this.sfx.fanfare();
    }
    r.notes = notes;
    if (notes.length) this.sfx.coins();
    this._save();
    this._side(); this._foot();
  }

  sell(id) {
    const c = this.card(id), n = this.count(id);
    if (!c || n < 2) return 0;
    const v = RARITY[c.r].sell;
    this.stats.owned[id] = n - 1; this.stats.sold++; this.stats.earned += v;
    this.o.onReward(v, `sold ${c.name}`); this.sfx.coins(); this._save();
    return v;
  }
  sellAll() {
    let tot = 0;
    for (const s of this.spares()) { for (let i = 0; i < s.extra; i++) tot += this.sell(s.id); }
    if (tot) this.say = `Sold! That's $${tot}. Pleasure doing business.`;
    return tot;
  }

  // --- the world: the framed Golden Goose -----------------------------------------------

  _trophy() {
    if (this.trophy || !this.o.scene || !this.o.THREE) return;
    try {
      const w = this.o.win && this.o.win();
      if (!w) return;
      const T = this.o.THREE, cv = document.createElement('canvas');
      cv.width = 300; cv.height = 420;
      drawCardBase(cv.getContext('2d'), SET[SET_SIZE - 1]);
      const tex = new T.CanvasTexture(cv);
      const grp = new T.Group();
      const frame = new T.Mesh(new T.PlaneGeometry(0.64, 0.88), new T.MeshBasicMaterial({ color: 0xf2c230 }));
      const card = new T.Mesh(new T.PlaneGeometry(0.56, 0.784), new T.MeshBasicMaterial({ map: tex }));
      card.position.z = 0.004;
      grp.add(frame, card);
      grp.position.set(w[0], w[1], w[2]);
      grp.rotation.y = Math.atan2(w[3], w[4]);
      grp.name = 'jj-trophy';
      this.o.scene.add(grp);
      this.trophy = grp;
    } catch (e) { /* no window to hang it in */ }
  }

  // --- the overlay ----------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'jjUi';
    d.innerHTML = `
      <div class="jjHead"><div class="jjSign"><b>J&amp;J</b><span>Cards &amp; Collectibles</span></div><div class="jjTag">WATERLOO REGION LEGENDS · SERIES 1</div><div class="jjMoney"></div></div>
      <button class="jjX" aria-label="Leave">✕</button>
      <div class="jjBody">
        <div class="jjStage"><canvas></canvas><div class="jjHint"></div></div>
        <div class="jjSide"></div>
      </div>
      <div class="jjFoot"></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #jjUi { position: absolute; inset: 0; z-index: 40; display: none; flex-direction: column; color: #fff; overflow: hidden;
        font: 600 14px -apple-system, Helvetica, Arial, sans-serif; user-select: none; -webkit-user-select: none;
        background: radial-gradient(ellipse at 40% 30%, #1d4a9a 0%, #12295c 55%, #0a1634 100%), #0f2150; }
      #jjUi.show { display: flex; }
      #jjUi button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; border: none; color: inherit; font: inherit; cursor: pointer; }
      #jjUi .jjHead { flex: 0 0 auto; display: flex; align-items: center; gap: 14px; background: #1d5ec6;
        padding: calc(4px + var(--safe-t, 0px)) calc(58px + var(--safe-r, 0px)) 4px calc(16px + var(--safe-l, 0px));
        border-bottom: 4px solid #a3191c; box-shadow: 0 3px 0 #e2b23d, 0 7px 18px #0008; min-height: 40px;
        background-image: linear-gradient(90deg, #ffffff10 0 50%, transparent 50% 100%); background-size: 22px 100%; }
      #jjUi .jjSign { display: flex; align-items: baseline; gap: 8px; background: #fbfbf7; border: 3px solid #1a1a1a; border-radius: 6px; padding: 0 10px; box-shadow: 0 2px 0 #0006; }
      #jjUi .jjSign b { font: italic 800 25px ${SERIF}; color: #c4161c; }
      #jjUi .jjSign span { font: italic 700 13px ${SERIF}; color: #111; white-space: nowrap; }
      #jjUi .jjTag { font: 900 11px ${BLOCK}; letter-spacing: .12em; color: #ffe08a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #jjUi .jjMoney { margin-left: auto; font: 900 17px ${BLOCK}; color: #bff5c8; text-shadow: 0 1px 2px #000; }
      #jjUi .jjX { position: absolute; top: calc(4px + var(--safe-t, 0px)); right: calc(10px + var(--safe-r, 0px)); width: 38px; height: 38px;
        border-radius: 50%; background: rgba(0,0,0,.3); font-size: 17px; z-index: 2; }
      #jjUi .jjBody { flex: 1 1 auto; display: flex; min-height: 0; padding: 0 var(--safe-r, 0px) 0 var(--safe-l, 0px); }
      #jjUi .jjStage { flex: 1 1 auto; position: relative; min-width: 0; min-height: 0; touch-action: none; }
      #jjUi .jjStage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
      #jjUi .jjHint { position: absolute; left: 0; right: 0; bottom: 6px; text-align: center; font: 800 13px -apple-system, Helvetica, sans-serif;
        letter-spacing: .04em; color: #ffe08a; text-shadow: 0 1px 3px #000; pointer-events: none; }
      #jjUi .jjSide { flex: 0 0 min(300px, 40%); display: flex; flex-direction: column; justify-content: center; gap: 8px;
        margin: 8px 12px 8px 4px; padding: 11px; overflow-y: auto; -webkit-overflow-scrolling: touch;
        background: linear-gradient(#142a5e, #0c1a3e); border: 2px solid #e2b23d; border-radius: 16px; box-shadow: 0 8px 24px #0007, inset 0 1px 0 #ffffff18; }
      #jjUi .jjSay { background: #fff8ec; color: #1a2a4a; border-radius: 12px 12px 12px 3px; padding: 7px 10px; font: 600 13px/1.3 ${SERIF}; font-style: italic; box-shadow: 0 2px 0 #0004; }
      #jjUi .jjBtn { padding: 10px 12px; border-radius: 999px; background: #c4161c; font: 900 14px ${BLOCK}; letter-spacing: .03em; box-shadow: 0 4px 0 #7a0a10; }
      #jjUi .jjBtn:active { transform: translateY(3px); box-shadow: 0 1px 0 #7a0a10; }
      #jjUi .jjBtn.gold { background: #e2b23d; color: #2a1a00; box-shadow: 0 4px 0 #8a6a10; }
      #jjUi .jjBtn.alt { background: rgba(255,255,255,.14); box-shadow: 0 4px 0 #0005; font: 800 13px -apple-system, Helvetica, sans-serif; }
      #jjUi .jjBtn:disabled { opacity: .4; }
      #jjUi .jjRow { display: flex; gap: 8px; } #jjUi .jjRow > * { flex: 1; }
      #jjUi .jjBig { font: 900 18px ${BLOCK}; line-height: 1.15; }
      #jjUi .jjSm { font-size: 12px; opacity: .85; line-height: 1.35; }
      #jjUi .jjNote { background: linear-gradient(#ffe9a0, #ffd23a); color: #3a2a00; border-radius: 10px; padding: 6px 9px; font: 800 12px/1.3 -apple-system, sans-serif; }
      #jjUi .jjFoot { flex: 0 0 auto; display: flex; justify-content: center; gap: 18px; flex-wrap: wrap; font-size: 11px; padding: 4px calc(12px + var(--safe-r, 0px)) calc(4px + var(--safe-b, 0px)) calc(12px + var(--safe-l, 0px)); background: rgba(0,0,0,.4); color: #d8e4ff; }
      #jjUi .jjFoot b { color: #ffe08a; }
      @media (max-height: 460px) {
        #jjUi .jjSign b { font-size: 21px; } #jjUi .jjHead { min-height: 34px; }
        #jjUi .jjSide { gap: 6px; margin: 6px 8px 6px 2px; padding: 8px; } #jjUi .jjBtn { padding: 8px 10px; }
        #jjUi .jjSay { padding: 5px 8px; font-size: 12px; }
      }
      @media (max-width: 640px) { #jjUi .jjTag { display: none; } }
      @media (orientation: portrait) { #jjUi .jjBody { flex-direction: column; } #jjUi .jjSide { flex: 0 0 auto; margin: 0 12px 10px; } #jjUi .jjStage { min-height: 45%; } #jjUi .jjTag { display: none; } }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { side: q('.jjSide'), foot: q('.jjFoot'), stage: q('.jjStage'), cv: q('.jjStage canvas'), hint: q('.jjHint'), money: q('.jjMoney') };
    this.g = this.ui.cv.getContext('2d');
    q('.jjX').addEventListener('click', () => this.close());
    this.ui.side.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) this._act(b.dataset.act, b.dataset.id); });

    const cv = this.ui.stage;
    let id = null, sx = 0, sy = 0, lx = 0, moved = 0, t0 = 0;
    const tiltFrom = (e) => {
      const r = cv.getBoundingClientRect();
      this.tiltTo = [clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1), clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1, 1)];
      this.pointer = true;
    };
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId; sx = lx = e.clientX; sy = e.clientY; moved = 0; t0 = performance.now();
      try { cv.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ }
      tiltFrom(e);
      this.down = { x: e.clientX, y: e.clientY };
    });
    cv.addEventListener('pointermove', (e) => {
      tiltFrom(e);
      if (e.pointerId !== id) return;
      const dx = e.clientX - lx; lx = e.clientX; moved += Math.abs(dx) + 0;
      if (this.mode === 'tear' && this.pk && this.pk.state === 'wrap' && this.pkRect) {
        // any sideways drag along the top of the pack tears it
        const near = e.clientY - cv.getBoundingClientRect().top < this.pkRect.y + this.pkRect.h * 0.55;
        if (near || moved > 40) this._tear(Math.abs(dx) / (this.pkRect.w * 0.85));
      }
      if (this.mode === 'binder' && Math.abs(e.clientX - sx) > 80 && this.swipeOk !== false) { this._page(e.clientX < sx ? 1 : -1); sx = e.clientX; this.swipeOk = false; }
    });
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null; this.down = null; this.swipeOk = true;
      const tap = moved < 12 && Math.abs(e.clientY - sy) < 12 && performance.now() - t0 < 700;
      if (e.type === 'pointerup' && tap) this._tap(e);
      if (e.pointerType !== 'mouse') this.pointer = false;
    };
    for (const ev of ['pointerup', 'pointercancel']) cv.addEventListener(ev, up);
    cv.addEventListener('pointerleave', () => { this.pointer = false; });

    window.addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      const c = e.code, m = this.mode;
      if (c === 'Escape') this._back();
      else if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') { if (!e.repeat) this._primary(); }
      else if (c === 'ArrowRight' || c === 'KeyD') { if (m === 'binder') this._page(1); else if (m === 'tear') this._tear(0.34); else if (m === 'reveal') this.advance(); }
      else if (c === 'ArrowLeft' || c === 'KeyA') { if (m === 'binder') this._page(-1); }
      else if (c === 'KeyB') { if (m === 'shop' || m === 'summary') this._act('binder'); }
      else if (c === 'KeyS') { if (m === 'shop' || m === 'summary') this._act('sell'); }
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('resize', () => { if (this.active) this._fit(); });
  }

  _primary() {
    const m = this.mode;
    if (m === 'shop' || m === 'summary') this.buy();
    else if (m === 'tear') this._tear(0.5);
    else if (m === 'reveal') this.advance();
    else if (m === 'binder' || m === 'zoom') this._back();
  }
  _tap(e) {
    const m = this.mode, r = this.ui.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (m === 'shop') { if (this.pkRect && x > this.pkRect.x && x < this.pkRect.x + this.pkRect.w && y > this.pkRect.y && y < this.pkRect.y + this.pkRect.h) this.buy(); }
    else if (m === 'tear') this._tear(0.3);
    else if (m === 'reveal') this.advance();
    else if (m === 'summary' || m === 'binder') {
      for (const c of this.cells) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        if (this.count(c.id) > 0) { this.zoom = c.id; this.zoomFrom = m; this.mode = 'zoom'; this._side(); this.sfx.click(); }
        break;
      }
    } else if (m === 'zoom') this._back();
  }
  _page(d) {
    const pages = Math.ceil(SET_SIZE / this.perPage);
    this.page = clamp(this.page + d, 0, pages - 1);
    this.sfx.slide(); this._side();
  }
  _act(a, id) {
    this.sfx.click();
    if (a === 'buy') this.buy();
    else if (a === 'leave') this.close();
    else if (a === 'binder') { this.zoomFrom = null; this.mode = 'binder'; this._side(); }
    else if (a === 'back') this._back();
    else if (a === 'prev') this._page(-1);
    else if (a === 'next') this._page(1);
    else if (a === 'tear') this._tear(0.5);
    else if (a === 'advance') this.advance();
    else if (a === 'skip') { if (this.mode === 'reveal') this._skipAll(); }
    else if (a === 'sell') {
      const v = this.sellAll();
      if (!v) this.say = 'No spares to sell — every card you have is one of a kind.';
      if (this.mode === 'summary') { /* stays */ }
      this._side(); this._foot();
    } else if (a === 'sell1') { this.sell(+id); this._side(); this._foot(); }
  }
  _skipAll() {
    this.mode = 'summary'; this._summary();
  }

  // --- layout / DOM text ----------------------------------------------------------------

  _fit() {
    const r = this.ui.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = Math.max(1, r.width); this.ch = Math.max(1, r.height); this.dpr = dpr;
    this.ui.cv.width = Math.round(this.cw * dpr); this.ui.cv.height = Math.round(this.ch * dpr);
    const small = this.ch < 330;
    this.perPage = this.cw / this.ch > 1.15 ? 10 : 9;
    this.cols = this.perPage === 10 ? 5 : 3;
    this.rows = 2 + (this.perPage === 9 ? 1 : 0);
    this.small = small;
  }
  _foot() {
    this.ui.money.textContent = '$' + Math.round(this.o.money()).toLocaleString();
    this.ui.foot.innerHTML = `<span>Collected <b>${this.distinct}/${SET_SIZE}</b></span><span>Packs opened <b>${this.stats.packs}</b></span><span>Spares <b>${this.spareCount()}</b></span><span>Pack <b>$${PRICE}</b> · 1 Golden Goose in 500</span>`;
  }
  _side() {
    const m = this.mode, S = this.ui.side, h = [];
    const sp = this.spareValue(), spn = this.spareCount();
    const sellBtn = `<button class="jjBtn alt" data-act="sell" ${spn ? '' : 'disabled'}>SELL ${spn} SPARE${spn === 1 ? '' : 'S'}${spn ? ' +$' + sp : ''}</button>`;
    this.ui.hint.textContent = '';
    if (m === 'shop') {
      h.push(`<div class="jjSay">${this.say}</div>`,
        `<button class="jjBtn" data-act="buy">BUY A PACK · $${PRICE}</button>`,
        `<div class="jjRow"><button class="jjBtn gold" data-act="binder">BINDER ${this.distinct}/${SET_SIZE}</button></div>`, sellBtn,
        `<button class="jjBtn alt" data-act="leave">LEAVE</button>`);
      this.ui.hint.textContent = 'Tap the pack to buy it';
    } else if (m === 'tear') {
      h.push(`<div class="jjSay">Go on — rip it open!</div>`, `<button class="jjBtn" data-act="tear">TEAR IT OPEN</button>`, `<div class="jjSm">Drag across the top of the wrapper, tap it, or press ENTER.</div>`);
      this.ui.hint.textContent = 'Swipe across the top to tear';
    } else if (m === 'reveal') {
      const r = this.rv, c = this.card(r.ids[r.i]), R = RARITY[c.r];
      h.push(`<div class="jjBig">Card ${r.i + 1} of 6</div>`,
        `<div class="jjSm"><b style="color:${R.col}">${r.flip >= 1 ? R.name : '???'}</b></div>`,
        `<button class="jjBtn" data-act="advance">${r.flip >= 1 ? (r.i === 5 ? 'FINISH' : 'NEXT CARD') : 'FLIP IT'}</button>`,
        `<button class="jjBtn alt" data-act="skip">SKIP TO THE END</button>`);
      this.ui.hint.textContent = r.flip >= 1 ? 'Tap for the next card' : 'Tap to flip';
    } else if (m === 'summary') {
      const r = this.rv, fresh = r.fresh.length, dup = 6 - fresh;
      const best = r.ids.map((id) => this.card(id)).sort((a, b) => RARITY[b.r].rank - RARITY[a.r].rank)[0];
      h.push(`<div class="jjBig">${fresh} new, ${dup} spare${dup === 1 ? '' : 's'}</div>`,
        `<div class="jjSm">Best pull: <b style="color:${RARITY[best.r].col}">${best.name}</b> (${RARITY[best.r].name}). Tap a card to look.</div>`);
      for (const n of r.notes || []) h.push(`<div class="jjNote">${n}</div>`);
      h.push(`<button class="jjBtn" data-act="buy">ANOTHER PACK · $${PRICE}</button>`, `<div class="jjRow"><button class="jjBtn gold" data-act="binder">BINDER</button>${''}</div>`, sellBtn, `<button class="jjBtn alt" data-act="leave">LEAVE</button>`);
    } else if (m === 'binder') {
      const pages = Math.ceil(SET_SIZE / this.perPage);
      h.push(`<div class="jjBig">Binder</div>`, `<div class="jjSm">Page ${this.page + 1} of ${pages} · ${this.distinct}/${SET_SIZE} collected${this.stats.done ? ' · SET COMPLETE' : ''}. Tap a card to look at it; swipe or use the arrows to turn the page.</div>`,
        `<div class="jjRow"><button class="jjBtn alt" data-act="prev">◀ PREV</button><button class="jjBtn alt" data-act="next">NEXT ▶</button></div>`, sellBtn,
        `<button class="jjBtn gold" data-act="back">BACK TO THE COUNTER</button>`);
    } else if (m === 'zoom') {
      const c = this.card(this.zoom), R = RARITY[c.r], n = this.count(c.id);
      h.push(`<div class="jjBig" style="color:${R.col}">${R.name}</div>`, `<div class="jjSm">${c.name} — you have ${n}${n > 1 ? ` (${n - 1} spare)` : ''}.</div>`);
      if (n > 1) h.push(`<button class="jjBtn alt" data-act="sell1" data-id="${c.id}">SELL A SPARE +$${R.sell}</button>`);
      h.push(`<button class="jjBtn gold" data-act="back">BACK</button>`);
      this.ui.hint.textContent = 'Move your finger over the card to catch the light';
    }
    S.innerHTML = h.join('');
  }

  // --- drawing --------------------------------------------------------------------------

  _cardCanvas(id, big) {
    const m = big ? this.cache : this.thumbs, key = id;
    let c = m.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const w = big ? 360 : 110, h = big ? 504 : 154;
    c.width = w; c.height = h;
    drawCardBase(c.getContext('2d'), this.card(id), w, h);
    m.set(key, c);
    if (big && m.size > 10) m.delete(m.keys().next().value);
    return c;
  }
  _backCanvas() {
    if (!this.back) { const c = document.createElement('canvas'); c.width = 300; c.height = 420; drawCardBack(c.getContext('2d')); this.back = c; }
    return this.back;
  }
  _silh(id) {
    this.sil = this.sil || new Map();
    let c = this.sil.get(id);
    if (!c) { c = document.createElement('canvas'); c.width = 110; c.height = 154; drawSilhouette(c.getContext('2d'), this.card(id), 110, 154); this.sil.set(id, c); }
    return c;
  }
  /** A face-up card with its sheen; flip 0..1 (squeeze), lift. */
  _drawCard(id, cx, cy, h, sx, o = {}) {
    const g = this.g, w = h * CARD_W / CARD_H, c = this.card(id);
    const tx = this.tilt[0], ty = this.tilt[1];
    g.save();
    g.translate(cx, cy);
    g.rotate(tx * 0.045 * (o.tiltK === undefined ? 1 : o.tiltK));
    g.scale(sx * (1 - Math.abs(tx) * 0.035), 1);
    if (o.shadow !== false) { g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(0, h * 0.5 + 8, w * 0.42, 10, 0, 0, Math.PI * 2); g.fill(); }
    if (o.back) g.drawImage(this._backCanvas(), -w / 2, -h / 2, w, h);
    else {
      g.drawImage(this._cardCanvas(id, h > 130), -w / 2, -h / 2, w, h);
      if (c.r !== 'c' || o.glare) sheen(g, c, -w / 2, -h / 2, w, h, tx, ty, this.t);
    }
    g.restore();
  }

  update(dt) {
    if (this.mode === 'off') return;
    this.t += dt;
    // the light: follows the pointer, else drifts
    if (!this.pointer) this.tiltTo = [Math.sin(this.t * 0.9) * 0.55, Math.cos(this.t * 0.7) * 0.4];
    const k = 1 - Math.exp(-dt * 9);
    this.tilt[0] += (this.tiltTo[0] - this.tilt[0]) * k; this.tilt[1] += (this.tiltTo[1] - this.tilt[1]) * k;
    const m = this.mode;
    if (m === 'tear') {
      const p = this.pk;
      p.t += dt;
      if (p.state === 'opening') {
        p.rip += dt * 2.6;
        if (p.rip >= 1) { p.state = 'open'; this._reveal(); }
      }
    } else if (m === 'reveal') {
      const r = this.rv;
      r.t += dt;
      if (r.enter < 1) r.enter = Math.min(1, r.enter + dt * 3.4);
      else if (r.out === 0) {
        if (r.flipping && r.flip < 1) {
          r.flip = Math.min(1, r.flip + dt / (RARITY[this.card(r.ids[r.i]).r].rank >= 2 ? 0.7 : 0.38));
          if (!r.fired && r.flip >= 0.5) this._flipped();
          if (r.flip >= 1) this._side();
        } else if (!r.flipping && r.auto >= 0) { r.wait += dt; if (r.wait >= r.auto) { r.flipping = true; } }
      } else if (r.out > 0) {
        r.out += dt * 3.6;
        if (r.out >= 1) { if (r.i >= 5) this._summary(); else { this._arm(r.i + 1); this._side(); } }
      }
    }
    for (const f of this.fx) { f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 260 * dt; }
    this.fx = this.fx.filter((f) => f.t < f.life);
    this._draw();
  }

  _draw() {
    const g = this.g, dpr = this.dpr, W = this.cw, H = this.ch;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const m = this.mode;
    if (m === 'shop') this._drawShop(W, H);
    else if (m === 'tear') this._drawTear(W, H);
    else if (m === 'reveal') this._drawReveal(W, H);
    else if (m === 'summary') this._drawGrid(W, H, this.rv.ids, true);
    else if (m === 'binder') this._drawBinder(W, H);
    else if (m === 'zoom') {
      const h = Math.min(H * 0.92, W * 1.38);
      this._drawCard(this.zoom, W / 2, H / 2, h, 1, { glare: true });
    }
    for (const f of this.fx) {
      g.globalAlpha = Math.max(0, 1 - f.t / f.life); g.fillStyle = f.c;
      g.beginPath(); g.arc(f.x, f.y, f.r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }

  _drawShop(W, H) {
    const g = this.g, t = this.t;
    // brick wall and a counter
    g.fillStyle = '#17306a'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let y = 0, j = 0; y < H * 0.7; y += 22, j++) for (let x = -((j & 1) * 22); x < W; x += 44) g.fillRect(x + 1, y + 1, 42, 20);
    // shelves of boxes
    for (let s = 0; s < 2; s++) {
      const y = H * (0.14 + s * 0.2);
      g.fillStyle = '#0a1634'; g.fillRect(W * 0.04, y + H * 0.1, W * 0.92, 5);
      for (let i = 0; i < 9; i++) {
        const bw = W * 0.07, x = W * 0.06 + i * (W * 0.1), cols = ['#c4161c', '#e2b23d', '#2a8ad8', '#fbfbf7', '#2a9a5a'];
        g.fillStyle = cols[(i + s * 2) % 5]; g.fillRect(x, y + H * 0.1 - bw * 0.9, bw, bw * 0.9);
        g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x, y + H * 0.1 - bw * 0.25, bw, bw * 0.25);
      }
    }
    // the counter
    const cy = H * 0.72;
    const gr = g.createLinearGradient(0, cy, 0, H); gr.addColorStop(0, '#2a74e0'); gr.addColorStop(1, '#14409a');
    g.fillStyle = gr; g.fillRect(0, cy, W, H - cy);
    g.fillStyle = '#e2b23d'; g.fillRect(0, cy - 5, W, 8); g.fillStyle = '#a3191c'; g.fillRect(0, cy + 3, W, 4);
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, cy + 7, W, 3);
    // castle crenellations
    g.fillStyle = '#1d5ec6'; for (let x = 6; x < W; x += 34) g.fillRect(x, 0, 18, 8);
    // the pack, bobbing
    const ph = Math.min(H * 0.72, W * 0.78), pw = ph * 0.58, px = W / 2, py = H * 0.46 + Math.sin(t * 1.6) * 4;
    this.pkRect = { x: px - pw / 2, y: py - ph / 2, w: pw, h: ph };
    g.save(); g.translate(px, py); g.rotate(Math.sin(t * 1.1) * 0.03); g.translate(-px, -py);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(px, py + ph / 2 + 4, pw * 0.5, 9, 0, 0, Math.PI * 2); g.fill();
    drawPack(g, px, py, pw, ph, 0, t);
    g.restore();
    // price tag
    g.save(); g.translate(px + pw * 0.5, py + ph * 0.2); g.rotate(0.2);
    g.fillStyle = '#e2b23d'; g.beginPath(); g.moveTo(-34, -14); g.lineTo(26, -14); g.lineTo(36, 0); g.lineTo(26, 14); g.lineTo(-34, 14); g.closePath(); g.fill();
    g.fillStyle = '#2a1a00'; g.font = `900 17px ${BLOCK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$' + PRICE, -2, 1);
    g.restore();
    // a few of the owned cards leaning on the counter
    const mine = Object.keys(this.stats.owned).map(Number).filter((id) => this.count(id) > 0).sort((a, b) => RARITY[this.card(b).r].rank - RARITY[this.card(a).r].rank || a - b).slice(0, 3);
    mine.forEach((id, i) => {
      const hh = Math.min(H * 0.28, 130), x = i === 0 ? W * 0.14 : i === 1 ? W * 0.86 : W * 0.24;
      if (i === 2 && W < 480) return;
      g.save(); g.translate(x, cy - hh * 0.02); g.rotate((i === 1 ? 0.12 : -0.1) + (i === 2 ? 0.06 : 0));
      g.drawImage(this._cardCanvas(id, hh > 130), -hh * 0.35, -hh, hh * 0.714, hh); g.restore();
    });
  }

  _drawTear(W, H) {
    const g = this.g, p = this.pk, t = p.t;
    const ph = Math.min(H * 0.8, W * 0.9), pw = ph * 0.58, px = W / 2, py = H * 0.5;
    this.pkRect = { x: px - pw / 2, y: py - ph / 2, w: pw, h: ph };
    const open = p.state === 'opening' || p.state === 'open';
    const rip = open ? Math.min(1, p.rip) : 0;
    // light behind the mouth as it tears
    if (p.tear > 0.05) {
      const gl = g.createRadialGradient(px, py - ph / 2 + 10, 0, px, py - ph / 2 + 10, pw * (0.6 + p.tear));
      gl.addColorStop(0, `rgba(255,240,170,${0.45 * p.tear + 0.2 * rip})`); gl.addColorStop(1, 'rgba(255,240,170,0)');
      g.fillStyle = gl; g.fillRect(0, 0, W, H);
    }
    g.save();
    const shake = open ? 0 : Math.sin(t * 40) * p.tear * 1.2;
    g.translate(shake, 0);
    // the cards rising out of the mouth
    if (rip > 0) {
      const lift = rip * ph * 0.55, bh = pw * 0.9 * 1.4;
      for (let i = 2; i >= 0; i--) { g.save(); g.translate(px + (i - 1) * 4, py - ph * 0.4 - lift + i * 3); g.rotate((i - 1) * 0.04); g.drawImage(this._backCanvas(), -pw * 0.44, -bh * 0.1, pw * 0.88, pw * 0.88 * 1.4); g.restore(); }
    }
    g.globalAlpha = open ? 1 - rip * rip : 1;
    drawPack(g, px, py + rip * ph * 0.08, pw, ph, open ? 1 : p.tear, t);
    g.restore();
    g.globalAlpha = 1;
  }

  _drawReveal(W, H) {
    const g = this.g, r = this.rv;
    const ch = Math.min(H * 0.74, W * 1.3), cw = ch * CARD_W / CARD_H;
    // progress dots
    for (let i = 0; i < 6; i++) {
      const done = i < r.i || (i === r.i && r.flip >= 1), c = this.card(r.ids[i]);
      g.fillStyle = done ? RARITY[c.r].col : 'rgba(255,255,255,.22)';
      g.beginPath(); g.arc(W / 2 + (i - 2.5) * 20, 14, i === r.i ? 6 : 4.5, 0, Math.PI * 2); g.fill();
    }
    const id = r.ids[r.i], c = this.card(id), rk = RARITY[c.r].rank;
    let cx = W / 2, cy = H / 2 - 12, sx = 1, ang = 0;
    if (r.enter < 1) { const e = 1 - Math.pow(1 - r.enter, 3); cx = W / 2 + (1 - e) * W * 0.6; }
    if (r.out > 0) { const e = r.out * r.out; cx = W / 2 - e * W * 0.7; cy -= e * 40; ang = -e * 0.4; }
    // the aura on the back of a rare+: it glows before you turn it
    if (r.flip < 1 && rk >= 2) {
      const a = 0.35 + 0.2 * Math.sin(r.t * 5), col = rk === 4 ? '255,220,90' : rk === 3 ? '200,120,255' : '90,160,255';
      const gl = g.createRadialGradient(cx, cy, ch * 0.15, cx, cy, ch * 0.75);
      gl.addColorStop(0, `rgba(${col},${a})`); gl.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gl; g.fillRect(0, 0, W, H);
    }
    if (r.flip >= 1 && rk >= 2) {
      const col = rk === 4 ? '255,220,90' : rk === 3 ? '200,120,255' : '90,160,255';
      const gl = g.createRadialGradient(cx, cy, ch * 0.2, cx, cy, ch * 0.85);
      gl.addColorStop(0, `rgba(${col},.3)`); gl.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gl; g.fillRect(0, 0, W, H);
    }
    // the squeeze of the flip, a little hop in the middle
    const f = r.flip, face = f >= 0.5;
    sx = Math.max(0.02, Math.abs(Math.cos(Math.PI * f)));
    const hop = Math.sin(Math.PI * f) * 14;
    g.save(); g.translate(0, -hop); g.translate(cx, cy); g.rotate(ang); g.translate(-cx, -cy);
    this._drawCard(id, cx, cy, ch, sx, { back: !face, tiltK: face ? 1 : 0.3 });
    g.restore();
    // badges on a turned card
    if (r.flip >= 1 && r.out === 0) {
      const isNew = r.fresh.includes(id) && r.nthOf[r.i] === 1;
      const lab = isNew ? 'NEW!' : `x${this.count(id)}`;
      g.save(); g.translate(cx - cw / 2 + cw * 0.1, cy - ch / 2 + ch * 0.3); g.rotate(-0.2);
      g.fillStyle = isNew ? '#c4161c' : '#445'; g.fillRect(-4, -14, 66, 24);
      g.fillStyle = '#fff'; g.font = `900 15px ${BLOCK}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(lab, 4, -1);
      g.restore();
      if (rk >= 2) {
        g.save(); g.textAlign = 'center'; g.font = `900 ${Math.round(Math.min(26, W * 0.04))}px ${BLOCK}`;
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.7)'; g.fillStyle = RARITY[c.r].col;
        const msg = rk === 4 ? 'THE GOLDEN GOOSE!!!' : rk === 3 ? 'HOLO FOIL!' : 'RARE!';
        g.strokeText(msg, W / 2, H - 26 - Math.sin(r.t * 6) * 2); g.fillText(msg, W / 2, H - 26 - Math.sin(r.t * 6) * 2); g.restore();
      }
    }
  }

  _gridRects(W, H, n, cols, rows, top = 8) {
    const gap = 8, availW = W - 16, availH = H - top - 8;
    let ch = Math.min((availH - gap * (rows - 1)) / rows, ((availW - gap * (cols - 1)) / cols) * CARD_H / CARD_W);
    const cw = ch * CARD_W / CARD_H;
    const totalW = cols * cw + (cols - 1) * gap, x0 = (W - totalW) / 2;
    const totalH = rows * ch + (rows - 1) * gap, y0 = top + (availH - totalH) / 2;
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: x0 + (i % cols) * (cw + gap), y: y0 + Math.floor(i / cols) * (ch + gap), w: cw, h: ch });
    return out;
  }
  _drawGrid(W, H, ids, pack) {
    const g = this.g, n = ids.length, cols = W > H * 1.2 ? 3 : 2, rows = Math.ceil(n / cols);
    const rects = this._gridRects(W, H, n, n <= 3 ? n : cols, n <= 3 ? 1 : rows);
    this.cells = [];
    ids.forEach((id, i) => {
      const r = rects[i];
      this.cells.push({ id, x: r.x, y: r.y, w: r.w, h: r.h });
      this._drawCard(id, r.x + r.w / 2, r.y + r.h / 2, r.h, 1, { shadow: false, tiltK: 0.5 });
      if (pack && this.rv.fresh.includes(id) && this.rv.ids.indexOf(id) === i) {
        g.fillStyle = '#c4161c'; g.fillRect(r.x + r.w * 0.08, r.y + r.h * 0.3, 34, 15); g.fillStyle = '#fff'; g.font = `900 11px ${BLOCK}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('NEW', r.x + r.w * 0.08 + 4, r.y + r.h * 0.3 + 8);
      }
    });
  }
  _drawBinder(W, H) {
    const g = this.g, per = this.perPage, ids = [];
    for (let i = this.page * per; i < Math.min(SET_SIZE, (this.page + 1) * per); i++) ids.push(i + 1);
    const rects = this._gridRects(W, H - 16, ids.length, this.cols, this.rows, 4);
    // the page
    g.fillStyle = '#0b1a40'; g.fillRect(4, 0, W - 8, H - 18);
    this.cells = [];
    ids.forEach((id, i) => {
      const r = rects[i], own = this.count(id) > 0;
      this.cells.push({ id, x: r.x, y: r.y, w: r.w, h: r.h });
      g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
      if (own) {
        this._drawCard(id, r.x + r.w / 2, r.y + r.h / 2, r.h, 1, { shadow: false, tiltK: 0.4 });
        const n = this.count(id);
        if (n > 1) { g.fillStyle = '#e2b23d'; g.beginPath(); g.arc(r.x + r.w - 9, r.y + 9, 9, 0, Math.PI * 2); g.fill(); g.fillStyle = '#2a1a00'; g.font = `900 10px ${BLOCK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('x' + n, r.x + r.w - 9, r.y + 9.5); }
      } else g.drawImage(this._silh(id), r.x, r.y, r.w, r.h);
    });
    g.fillStyle = '#9ab; '; g.fillStyle = 'rgba(255,255,255,.5)'; g.font = `800 11px -apple-system, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${this.page + 1} / ${Math.ceil(SET_SIZE / per)}`, W / 2, H - 9);
  }

  // --- harness --------------------------------------------------------------------------

  /** Roll `n` packs with a seeded rng (no money, no state): counts by rarity and the goose. */
  odds(n, rnd) {
    const out = { packs: n, cards: 0, c: 0, u: 0, r: 0, h: 0, g: 0, gPacks: 0, perCard: {} };
    for (let i = 0; i < n; i++) {
      let goose = false;
      for (const id of rollPack(rnd)) { const c = this.card(id); out[c.r]++; out.cards++; out.perCard[id] = (out.perCard[id] || 0) + 1; if (c.r === 'g') goose = true; }
      if (goose) out.gPacks++;
    }
    return out;
  }
}

export { SET, SET_SIZE, RARITY, PRICE, MILESTONES, COMPLETE_BONUS };
