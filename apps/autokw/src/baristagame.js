// MORNING RUSH: behind the counter of the first coffee shop at Pike Place,
// in the manner of the dash-style counter games. No DOM: barista.js draws it
// and hands it the taps, and Node can play it.
//
// Customers come to the counter (four at a time, the rest a line out of the
// door) with an order and a patience bar. You build each drink in a cup on
// the counter, one station at a time, and hand it over:
//
//   CUP      small / medium / large (a new cup in a free spot on the counter)
//   SHOT     one espresso shot; two group heads, 1.4 s a pull
//   DRIP     house coffee, poured
//   WATER    hot water (an americano)
//   WHOLE / OAT  milk: steamed in a hot cup (1.2 s), poured cold over ice
//   FOAM     foam on steamed milk (a cappuccino)
//   VANILLA / CARAMEL / MOCHA  a syrup
//   WHIP     whipped cream
//   ICE      ice (an iced drink)
//   BIN      throw the cup away
//
// Shots follow the size: 1, 2, 3 for small, medium, large; "+SHOT" is one
// more. A drink made exactly right pays its price and a tip that grows with
// the patience left; one thing wrong pays the price only; two or more and the
// customer refuses it and waits on, crosser. Customers who run out of patience
// leave. The shift is 150 s and gets busier as it goes.

export const SHIFT = 150;
export const SIZES = ['S', 'M', 'L'];
export const MENU = {
  drip: { name: 'HOUSE COFFEE', price: [2.5, 3, 3.5] },
  americano: { name: 'AMERICANO', price: [3, 3.5, 4] },
  latte: { name: 'LATTE', price: [4, 4.5, 5] },
  cappuccino: { name: 'CAPPUCCINO', price: [4, 4.5, 5] },
  mocha: { name: 'MOCHA', price: [4.5, 5, 5.5] },
  vanilla: { name: 'VANILLA LATTE', price: [4.5, 5, 5.5] },
  caramel: { name: 'CARAMEL LATTE', price: [4.5, 5, 5.5] },
  espresso: { name: 'ESPRESSO', price: [2.5, 3, 3.5] },
};
const DRINKS = Object.keys(MENU);
export const SHOT_T = 1.4, STEAM_T = 1.2, HEADS = 2, SPOTS = 4, COUNTER = 4;

/** What an order needs in the cup. */
export function recipe(o) {
  const r = { size: o.size, ice: !!o.iced, drip: false, shots: 0, water: false, milk: null, foam: false, vanilla: false, caramel: false, mocha: false, whip: false };
  const shots = o.size + 1 + (o.extraShot ? 1 : 0);
  switch (o.drink) {
    case 'drip': r.drip = true; break;
    case 'americano': r.shots = shots; r.water = true; break;
    case 'espresso': r.shots = shots; break;
    case 'latte': r.shots = shots; r.milk = o.milk; break;
    case 'cappuccino': r.shots = shots; r.milk = o.milk; r.foam = true; break;
    case 'mocha': r.shots = shots; r.milk = o.milk; r.mocha = true; r.whip = true; break;
    case 'vanilla': r.shots = shots; r.milk = o.milk; r.vanilla = true; break;
    case 'caramel': r.shots = shots; r.milk = o.milk; r.caramel = true; break;
    default: break;
  }
  return r;
}

/** Order text for the bubble: "M ICED OAT LATTE +SHOT". */
export function orderText(o) {
  const parts = [SIZES[o.size]];
  if (o.iced) parts.push('ICED');
  if (o.milk === 'oat') parts.push('OAT');
  parts.push(MENU[o.drink].name);
  if (o.extraShot) parts.push('+SHOT');
  return parts.join(' ');
}

/** How many things differ between a cup and what the order needs. */
export function mistakes(cup, o) {
  const r = recipe(o);
  let n = 0;
  for (const k of ['size', 'ice', 'drip', 'water', 'milk', 'foam', 'vanilla', 'caramel', 'mocha', 'whip']) if (cup[k] !== r[k]) n++;
  if (cup.shots !== r.shots) n += Math.min(2, Math.abs(cup.shots - r.shots));
  return n;
}

const LOOKS = 12;

export class Barista {
  /** opts: { rng } */
  constructor(opts = {}) {
    this.rng = opts.rng || Math.random;
    this.t = 0;
    this.left = SHIFT;
    this.cups = new Array(SPOTS).fill(null);
    this.sel = -1;
    this.heads = new Array(HEADS).fill(null);     // { spot, t }
    this.steam = null;                            // { spot, t, milk }
    this.counter = new Array(COUNTER).fill(null); // customers at the counter
    this.line = 0;                                // waiting outside
    this.nextIn = 1.2;
    this.id = 0;
    this.earned = 0; this.tips = 0; this.served = 0; this.perfect = 0; this.walked = 0; this.refused = 0;
    this.events = [];
    this.over = false;
  }

  takeEvents() { const e = this.events; this.events = []; return e; }

  // --- the taps --------------------------------------------------------------------------------

  /** A new cup in a free spot. */
  newCup(size) {
    const i = this.cups.indexOf(null);
    if (i < 0) { this.events.push('full'); return -1; }
    this.cups[i] = { size, ice: false, drip: false, shots: 0, water: false, milk: null, foam: false, vanilla: false, caramel: false, mocha: false, whip: false, busy: 0 };
    this.sel = i;
    this.events.push('cup');
    return i;
  }

  select(i) { if (this.cups[i]) { this.sel = i; this.events.push('tick'); } }

  /** A station, applied to the selected cup. Returns false when it can't. */
  apply(station) {
    const c = this.cups[this.sel];
    if (!c) { this.events.push('nope'); return false; }
    switch (station) {
      case 'shot': {
        const h = this.heads.indexOf(null);
        if (h < 0) { this.events.push('nope'); return false; }
        this.heads[h] = { spot: this.sel, t: SHOT_T };
        c.busy++;
        this.events.push('grind');
        return true;
      }
      case 'whole': case 'oat': {
        if (c.milk && c.milk !== station) { this.events.push('nope'); return false; }
        if (c.ice) { c.milk = station; this.events.push('pour'); return true; }
        if (this.steam) { this.events.push('nope'); return false; }
        this.steam = { spot: this.sel, t: STEAM_T, milk: station };
        c.busy++;
        this.events.push('steam');
        return true;
      }
      case 'foam':
        if (!c.milk || c.ice) { this.events.push('nope'); return false; }
        c.foam = true; this.events.push('foam'); return true;
      case 'drip': c.drip = true; this.events.push('pour'); return true;
      case 'water': c.water = true; this.events.push('pour'); return true;
      case 'vanilla': case 'caramel': case 'mocha': c[station] = true; this.events.push('pump'); return true;
      case 'whip': c.whip = true; this.events.push('whip'); return true;
      case 'ice': c.ice = true; this.events.push('ice'); return true;
      case 'bin': this._drop(this.sel); this.events.push('bin'); return true;
      default: return false;
    }
  }

  /** Hand the selected cup to the customer at counter position k. */
  serve(k) {
    const cu = this.counter[k], c = this.cups[this.sel];
    if (!cu || !c || c.busy > 0 || cu.leaving) { this.events.push('nope'); return null; }
    const m = mistakes(c, cu.order);
    const price = MENU[cu.order.drink].price[cu.order.size];
    if (m >= 2) {
      // refused: the cup goes, the customer waits on, crosser
      this._drop(this.sel);
      cu.patience = Math.max(1, cu.patience - 12);
      cu.mood = 'cross'; cu.moodT = 1.6;
      this.refused++;
      this.events.push('refused');
      return { ok: false, m };
    }
    const tip = m === 0 ? Math.round((0.5 + 1.8 * (cu.patience / cu.max)) * 4) / 4 : 0;
    this.earned += price; this.tips += tip; this.served++;
    if (m === 0) this.perfect++;
    this._drop(this.sel);
    cu.leaving = 1.1; cu.mood = m === 0 ? 'happy' : 'meh'; cu.moodT = 1.1; cu.paid = price + tip;
    this.events.push(m === 0 ? 'perfect' : 'served');
    return { ok: true, m, price, tip };
  }

  _drop(i) {
    for (let h = 0; h < HEADS; h++) if (this.heads[h] && this.heads[h].spot === i) this.heads[h] = null;
    if (this.steam && this.steam.spot === i) this.steam = null;
    this.cups[i] = null;
    if (this.sel === i) { const j = this.cups.findIndex(Boolean); this.sel = j; }
  }

  // --- the clock ---------------------------------------------------------------------------------

  step(dt) {
    if (this.over) return;
    this.t += dt;
    this.left -= dt;
    // the machine
    for (let h = 0; h < HEADS; h++) {
      const s = this.heads[h];
      if (!s) continue;
      s.t -= dt;
      if (s.t <= 0) { const c = this.cups[s.spot]; if (c) { c.shots++; c.busy--; } this.heads[h] = null; this.events.push('shot'); }
    }
    if (this.steam) {
      this.steam.t -= dt;
      if (this.steam.t <= 0) { const c = this.cups[this.steam.spot]; if (c) { c.milk = this.steam.milk; c.busy--; } this.steam = null; this.events.push('steamed'); }
    }
    // customers
    for (let k = 0; k < COUNTER; k++) {
      const cu = this.counter[k];
      if (!cu) continue;
      if (cu.moodT > 0) cu.moodT -= dt;
      if (cu.leaving) { cu.leaving -= dt; if (cu.leaving <= 0) this.counter[k] = null; continue; }
      cu.patience -= dt;
      if (cu.patience <= 0) { cu.leaving = 1.2; cu.mood = 'gone'; cu.moodT = 1.2; this.walked++; this.events.push('walkout'); }
    }
    // arrivals: busier as the shift goes on
    if (this.left > 0) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.line++;
        const f = this.t / SHIFT;
        this.nextIn = (6 - 4.2 * f) * (0.75 + this.rng() * 0.5);
      }
    }
    const free = this.counter.indexOf(null);
    if (free >= 0 && this.line > 0) { this.line--; this.counter[free] = this._customer(); this.events.push('bell'); }
    if (this.left <= 0 && this.counter.every((c) => !c)) { this.over = true; this.events.push('close'); }
    if (this.left <= -25) { this.over = true; this.events.push('close'); }
  }

  _customer() {
    const f = this.t / SHIFT, r = this.rng;
    const easy = ['drip', 'americano', 'latte'], mid = ['cappuccino', 'vanilla', 'espresso'], hard = ['mocha', 'caramel'];
    const pool = f < 0.2 ? easy : f < 0.5 ? [...easy, ...mid] : [...easy, ...mid, ...hard];
    const drink = pool[Math.floor(r() * pool.length)];
    const milky = ['latte', 'cappuccino', 'mocha', 'vanilla', 'caramel'].includes(drink);
    const order = {
      drink,
      size: drink === 'espresso' ? (r() < 0.6 ? 0 : 1) : Math.floor(r() * 3),
      iced: f > 0.3 && ['americano', 'latte', 'mocha', 'vanilla', 'caramel'].includes(drink) && r() < 0.35,
      milk: milky ? (f > 0.25 && r() < 0.3 ? 'oat' : 'whole') : null,
      extraShot: f > 0.45 && drink !== 'drip' && drink !== 'espresso' && r() < 0.2,
    };
    const max = 28 + r() * 12 - f * 8;
    return { id: ++this.id, order, patience: max, max, look: Math.floor(r() * LOOKS), leaving: 0, mood: null, moodT: 0 };
  }

  /** The stations that would make cup `c` into order `o`, in a sensible order (for the bot and the verify). */
  static plan(o) {
    const r = recipe(o), steps = [];
    if (r.ice) steps.push('ice');
    if (r.drip) steps.push('drip');
    for (let i = 0; i < r.shots; i++) steps.push('shot');
    if (r.water) steps.push('water');
    for (const s of ['vanilla', 'caramel', 'mocha']) if (r[s]) steps.push(s);
    if (r.milk) steps.push(r.milk);
    if (r.foam) steps.push('foam');
    if (r.whip) steps.push('whip');
    return steps;
  }
}

export { DRINKS };
