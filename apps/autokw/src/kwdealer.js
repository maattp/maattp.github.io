// BUY A CAR AT A REAL DEALERSHIP. Four of Waterloo Region's real dealers already drawn in the
// game sell you cars: Parkway Ford Lincoln on King St N (kwfun.js draws its showroom), and three
// of kwshops.js's dealer fronts (kind `c`, found by name in `dealerDoors()`): Bustard Chrysler
// Dodge Jeep (the truck dealer, Waterloo), BMW Grand River (luxury, Fairway Rd) and Heffner
// Used Vehicles (the used lot, King St E).
//
//   - WALK UP TO THE SHOWROOM DOOR AND PRESS ENTER (on foot; a car at the kerb beside you is
//     the ENTER, as at J&J). The world holds (`game.hold('dealer')`, in reapHolds' `live`) and a
//     DOM overlay opens in the brand's colours: the stock (6-10 types that dealer would sell, each
//     with a price), a turntable of the real vehicle mesh in the chosen paint, 6-8 swatches, BUY
//     and TEST DRIVE.
//   - BUY: the price is charged and the car is DELIVERED into a free stall of the garage nearest
//     the dealer that has one (kwgarage.js's record shape `{t, c, li}`: it stands there like a car
//     you parked). Every garage full = refused before any money moves. Too poor = BUY greys out
//     and says how much more. Not while wanted (the door says so), not mid-job or mid-chapter
//     (`blocked()`: main.js storyBusy / jobsBusy).
//   - TEST DRIVE: the car is brought round to the lot in front and you are put in it for 60 s
//     (`TEST_S`). Stop by where it was handed over (`BACK_R`) and the showroom opens again; when
//     the time is up, or it is wrecked, it goes back (removed). The demo is nobody's to keep: the
//     garages and the export yard refuse a `v.testDrive` car, and storyBusy names 'test drive' so
//     no job starts on top of one.
//   - Saved: localStorage `autokw-dealer` { v, bought: [{t, c, d, p, g, at}], spent, tests }.
//
// The turntable is drawn by the GAME's renderer: each frame it is open (at most 30 a second) the
// car is rendered into a corner of the default framebuffer and copied straight onto the overlay's
// 2D canvas (in the same task, so no preserveDrawingBuffer and no render target). The preview scene,
// its lights, floor and car are made when the showroom opens and disposed when it closes.
// Phone cost: nothing while closed (no mesh, no draw; one DOM node and a style).
//
// Harness: `__dbg.dealer` (`sites`, `open(i)`, `sel`, `col`, `buy()`, `testDrive()`, `td`, `stats`,
// `deliverTo(site)`), probe tools/kw/dealerprobe.mjs.

import * as THREE from './three.js';
import { Vehicle, TYPES } from './vehicles.js';
import { typeName, DEALER_FIT } from './kwgarage.js';
import { formatMoney } from './util.js';

const KEY = 'autokw-dealer';
const REACH = 3.6;          // how near the door ENTER opens the showroom
const KERB_YIELD = 2.5;     // a car this near (its body) takes the ENTER instead
const TEST_S = 60;          // a test drive, seconds
const BACK_R = 11;          // stop this near the hand-over spot to bring it back
const AWAY_R = 40;          // ...after it has been this far away
const CONFIRM_S = 4;        // BUY twice within this: a car is not bought by one stray tap
const PV_FPS = 30;          // the turntable's frame rate
const FONT = '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';

// what each dealer sells: [type, price, the salesman's line]
// (prices against the game's pay: a story chapter is $500-10,000, a cheap car a few thousand,
// a sports car ~$25-40k, a limo or a classic more)
export const DEALERS = [
  {
    id: 'ford', ford: true, name: 'Parkway Ford Lincoln', short: 'Ford', addr: '455 King St N, Waterloo',
    badge: 'PARKWAY', sub: 'FORD · LINCOLN', tag: 'TRUCKS · SUVS · PERFORMANCE',
    look: { head: '#133a7c', ink: '#ffffff', bg0: '#16346f', bg1: '#081733', stripe: '#ffffff', btn: '#2a6fe0', btnLo: '#123f8c', pick: '#8fc0ff', stage: 0x0c1d40, floor: 0x1b2f5c },
    greet: 'Welcome to Parkway! Everything on the floor is ready to drive home today.',
    paint: [0x1d3f8a, 0xf2f2f0, 0x141518, 0xb8bcc2, 0xb3121a, 0x3d4a57, 0x1f4a2e, 0xe2a500],
    stock: [
      ['pickup', 9800, 'The half-ton. V8, tows the boat up to the cottage.'],
      ['pickupcap', 11500, 'Same truck, a cap on the box: the contractor special.'],
      ['dually', 16900, 'Super-duty, four wheels at the back. Pulls a fifth-wheel up Hwy 7.'],
      ['crossover', 7400, 'Small, thrifty, fits in any plaza spot.'],
      ['suv', 10900, 'Two rows, all-wheel drive, the Costco run.'],
      ['suv3', 14500, 'Three rows: the hockey carpool for the whole team.'],
      ['jeep', 12800, 'Doors-off 4x4. The trails behind Chicopee are calling.'],
      ['muscle', 24500, 'The pony car. Five litres, two doors, no regrets.'],
      ['sports', 38000, 'Mid-engine. 275 km/h, if you can find a road for it.'],
      ['limo', 52000, 'The Lincoln stretch. Prom night, every night.'],
    ],
  },
  {
    id: 'bustard', match: /^Bustard Chrysler/i, name: 'Bustard Chrysler Dodge Jeep', short: 'Jeep', addr: 'Weber St N, Waterloo',
    badge: 'BUSTARD', sub: 'CHRYSLER · DODGE · JEEP · RAM', tag: 'TRUCKS · 4X4 · MUSCLE',
    look: { head: '#17171a', ink: '#ffffff', bg0: '#2a2a2e', bg1: '#0c0c0e', stripe: '#c8102e', btn: '#c8102e', btnLo: '#7a0a1c', pick: '#ff6b6b', stage: 0x151518, floor: 0x2a2a30 },
    greet: 'Trucks, Jeeps and a little horsepower. What are you towing?',
    paint: [0x111214, 0xf0f0ee, 0x9a0f16, 0x2b5a2a, 0xe76f00, 0x1b3f73, 0x5b5f63, 0xd8c79c],
    stock: [
      ['jeep', 11900, 'The Wrangler. Take the roof off, take the long way.'],
      ['lifted', 19500, 'Lifted, 35s, a light bar. You will see over every Civic.'],
      ['pickup', 9400, 'The work truck. Bench seat, big box.'],
      ['pickupcap', 10900, 'With a cap: the dog rides dry.'],
      ['dually', 16200, 'Heavy-duty dually. The horse trailer to the Elmira fair.'],
      ['minivan', 6900, 'Stow-and-go seats. The family car of Waterloo Region.'],
      ['suv3', 12900, 'Three rows and a tow hitch.'],
      ['muscle', 23000, 'A two-door with a big V8 and bigger tires.'],
      ['hellcat', 44000, 'Supercharged. Tiger stripes from the factory. Seven hundred horsepower.'],
    ],
  },
  {
    id: 'bmw', match: /^BMW Grand River/i, name: 'BMW Grand River', short: 'BMW', addr: 'Fairway Rd S, Kitchener',
    badge: 'GRAND RIVER', sub: 'BMW · LUXURY · ELECTRIC', tag: 'LUXURY · ELECTRIC · CONVERTIBLES',
    look: { head: '#f5f6f8', ink: '#121418', bg0: '#eef0f3', bg1: '#c4cad2', stripe: '#1c69d4', btn: '#1c69d4', btnLo: '#0f3f86', pick: '#1c69d4', stage: 0xd6dbe2, floor: 0xb9c0ca, light: true },
    greet: 'Good afternoon. May I offer you an espresso while you look around?',
    paint: [0x0b0c10, 0xe9e9e6, 0x1c4fa0, 0x8c9095, 0x2b2f36, 0x5a0d14, 0x0d3b2e, 0xc8c3b5],
    stock: [
      ['compsedan', 7900, 'The compact executive. Rear-drive, sharp.'],
      ['sedan', 10500, 'The mid-size saloon for the 401 commute.'],
      ['suv', 14900, 'The luxury SUV. Heated everything for January.'],
      ['ev', 27500, 'All-electric sedan. Silent, and quick off the lights.'],
      ['evy', 25500, 'The electric crossover. Charges at Conestoga while you shop.'],
      ['convertible', 31500, 'Top down along the Grand in September.'],
      ['sports', 39000, 'The flagship coupe. 275 km/h, carbon everything.'],
      ['limo', 58000, 'The chauffeur car, stretched. For the Tannery launch party.'],
    ],
  },
  {
    id: 'heffner', match: /^Heffner Used/i, name: 'Heffner Used Vehicles', short: 'Used', addr: 'King St E, Kitchener',
    badge: 'HEFFNER', sub: 'USED VEHICLES', tag: 'PRE-OWNED · CERTIFIED · CLASSICS',
    look: { head: '#ffd23a', ink: '#1a1a1a', bg0: '#3a3f46', bg1: '#1d2025', stripe: '#d0021b', btn: '#d0021b', btnLo: '#7c0010', pick: '#ffd23a', stage: 0x2a2e34, floor: 0x3e434b },
    greet: 'Every one of them safetied and ready. Cash talks, friend!',
    paint: [0x6e1d22, 0xcfcab8, 0x2f4a3a, 0x9a9fa3, 0x1b2e57, 0xd0d2cf, 0x7a5a2a, 0x3a3c40],
    stock: [
      ['smart', 2400, 'Parks sideways on King St. One careful owner.'],
      ['compact', 2900, 'Runs great. Ignore the cassette deck.'],
      ['hatch', 3400, 'Five doors, cheap insurance, a student\'s first car.'],
      ['civic', 4400, 'The UW parking-lot legend. They never die.'],
      ['wagon', 3800, 'An old estate. Room for a canoe on the roof.'],
      ['volvo', 4900, 'The brick. Three hundred thousand km and counting.'],
      ['minivan', 4200, 'Some crumbs in the third row, no charge.'],
      ['bug', 12500, 'An air-cooled classic, restored. They do not make them any more.'],
      ['pickup50', 16000, 'A fifties pickup. Frame-off restoration, a premium for a reason.'],
      ['woodie', 24000, 'The real-wood wagon. Cruise-night royalty.'],
    ],
  },
];

function readStats() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
  s = Object.assign({ v: 1, bought: [], spent: 0, tests: 0 }, s || {});
  if (!Array.isArray(s.bought)) s.bought = [];
  return s;
}

const hexCss = (h) => '#' + (h >>> 0).toString(16).padStart(6, '0');

/**
 * The dealers' doors: Parkway Ford from kwfun.js, the rest by name from kwshops.js's drawn dealer
 * fronts. Returns [{ d, x, z, nx, nz }] (the door point a step out from the showroom glass and the
 * outward normal).
 */
export function findDealerSites(doors, fordDoor) {
  const out = [];
  for (const d of DEALERS) {
    if (d.ford) { if (fordDoor) out.push({ d, x: fordDoor.x, z: fordDoor.z, nx: fordDoor.nx, nz: fordDoor.nz }); continue; }
    const f = (doors || []).find((q) => d.match.test(q.name));
    if (f) out.push({ d, x: f.x, z: f.z, nx: f.nx, nz: f.nz, make: f.make });
  }
  return out;
}

export class Dealers {
  /**
   * o: { renderer, scene (the city's, for its environment map), city, traffic, hud, audio, game,
   *      player: () => player, garages: () => Garages|null, sites: findDealerSites(..), money: () => n,
   *      charge(n) -> bool, blocked: () => reason|null, busy(pl) -> bool, hold(), onEnd() }
   */
  constructor(o) {
    this.o = o;
    this.sites = o.sites || [];
    this.stats = readStats();
    this.mode = 'off';
    this.site = null; this.sel = 0; this.col = 0;
    this.td = null;           // the test drive: { v, site, sel, col, t, spot, t0 }
    this.said = null;         // the door last hinted at
    this.pv = null;           // the preview (made on open)
    this.spin = 0; this.spinV = 0.55; this.drag = null; this.pvAcc = 1;
    for (const d of DEALERS) for (const [t] of d.stock) DEALER_FIT.add(t);   // a car you can buy fits back in a garage
    this._buildDom();
  }

  get active() { return this.mode !== 'off'; }
  get item() { return this.site ? this.site.d.stock[this.sel] : null; }
  get bought() { return this.stats.bought.length; }

  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.stats)); } catch (e) { /* private mode */ } }

  // --- the map, the passport ---------------------------------------------------------

  places() {
    return this.sites.map((s) => ({
      x: s.x + s.nx * 6, z: s.z + s.nz * 6, kind: 'dealer', label: s.d.short, name: s.d.name, near: false, foot: true,
      hello: `${s.d.name}: cars for sale. ENTER at the showroom door (${s.d.stock.length} models, from ${formatMoney(Math.min(...s.d.stock.map((r) => r[1])))})`,
    }));
  }
  passportRow() { return { label: 'Cars bought', text: String(this.bought) }; }

  // --- where -------------------------------------------------------------------------

  /** The dealer whose door you are at (on foot, nothing at the kerb, no test drive on), or null. */
  near(pl) {
    if (!pl || !pl.onFoot || this.active || this.td) return null;
    let best = null, bd = REACH;
    for (const s of this.sites) {
      const d = Math.hypot(pl.x - s.x, pl.z - s.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return null;
    if (this.o.busy && this.o.busy(pl)) return null;   // a car at the kerb is the ENTER
    return best;
  }

  /** Each frame: the door's hint, and the test drive. */
  tick(dt, pl) {
    if (this.td) this._tdTick(dt, pl);
    if (!pl || this.active) return;
    let at = null;
    for (const s of this.sites) {
      const d = Math.hypot(pl.x - s.x, pl.z - s.z);
      if (d < REACH + 1.5 && pl.onFoot) at = s;
      else if (s === this.said && d > 16) this.said = null;
    }
    if (at && at !== this.said && !this.td) {
      this.said = at;
      this.o.hud.showToast(`${at.d.name} — ENTER at the showroom door to buy a car`, 3600);
    }
  }

  // --- the flow ----------------------------------------------------------------------

  /** ENTER at a door: refused while wanted (a toast, nothing held); else the showroom opens. */
  enter(site) {
    if (this.o.game.wanted > 0) {
      this.o.hud.showToast(`${site.d.name}: come back when the police aren't looking`, 3400);
      return false;
    }
    this.o.hold();
    this.open(site);
    return true;
  }

  open(site, sel = 0, col = 0) {
    if (typeof site === 'number') site = this.sites[site];
    if (!site) return false;
    this.site = site; this.sel = sel; this.col = col;
    this.mode = 'shop';
    this.say = this.stats.bought.length ? `Good to see you again! ${site.d.greet}` : site.d.greet;
    this._theme();
    this.el.classList.add('show');
    this._fit();
    this._list(); this._detail();
    try { this._pvMake(); } catch (e) { console.warn('dealer preview: ' + e.message); this._pvDispose(); }
    this._pvCar();
    return true;
  }

  close() {
    if (this.mode === 'off') return;
    this.mode = 'off';
    this.el.classList.remove('show');
    this._pvDispose();
    if (this.o.onEnd) this.o.onEnd();
    this.said = this.site;
  }

  /** Respawn / WASTED: the showroom shuts and a test car goes back. */
  abort() {
    if (this.td) this._tdEnd('abort');
    this.close();
  }

  pick(i) {
    if (!this.site) return;
    const n = this.site.d.stock.length;
    this.sel = ((i % n) + n) % n;
    this.col = 0; this.say = null;
    this._list(); this._detail(); this._pvCar();
    const row = this.ui.list.children[this.sel];
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }
  paint(i) {
    const sw = this.swatches();
    if (!sw.length) return;
    this.col = ((i % sw.length) + sw.length) % sw.length;
    this._detail(); this._pvPaint();
  }

  /** The paint choices for the selected car: the dealer's palette, a livery type's own liveries, or none (a factory finish). */
  swatches(t = this.item && this.item[0]) {
    const s = t && this._spec(t);
    if (!s) return [];
    if (s.finish || s.livery !== undefined) return [];
    if (s.liveries) { const u = []; s.liveries.forEach((c, i) => { if (!u.some((x) => x.c === c)) u.push({ c, li: i }); }); return u.slice(0, 8); }
    return this.site.d.paint.map((c) => ({ c, li: -1 }));
  }
  _spec(t) { return TYPES[t] || null; }

  /** What is in the way of buying now: '' or the reason. */
  refusal(price) {
    const why = this.o.blocked && this.o.blocked();
    if (why) return `Finish the ${why} first`;
    if (this.o.game.wanted > 0) return "Come back when the police aren't looking";
    if (price != null && this.o.money() < price) return `You need ${formatMoney(price - this.o.money())} more`;
    if (!this.deliverTo(this.site)) return 'Make room in a garage first';
    return '';
  }

  /** The garage a car bought here goes to: the nearest to the dealer with a free stall. { i, q, j } or null. */
  deliverTo(site) {
    const gs = this.o.garages && this.o.garages();
    if (!gs || !site) return null;
    const order = gs.sites.map((q, i) => ({ q, i, d: Math.hypot(q.mx - site.x, q.mz - site.z) })).sort((a, b) => a.d - b.d);
    for (const c of order) {
      const j = gs.data[c.q.g.id].findIndex((r) => !r);
      if (j >= 0) return { i: c.i, q: c.q, j };
    }
    return null;
  }

  buy() {
    if (this.mode !== 'shop' || !this.item) return false;
    const [t, price] = this.item;
    const why = this.refusal(price);
    if (why) { this.say = why; this._detail(); this._sfx('no'); return false; }
    // the first press asks, the second (within CONFIRM_S, same car, same paint) signs
    const ck = `${this.site.d.id}:${this.sel}:${this.col}`, now = performance.now();
    if (!this.confirm || this.confirm.k !== ck || now - this.confirm.at > CONFIRM_S * 1000) {
      this.confirm = { k: ck, at: now };
      this.say = `${formatMoney(price)} for the ${typeName(t)}, delivered to your ${this.deliverTo(this.site).q.g.name.toLowerCase()}. Press BUY again to sign.`;
      this._detail(); this._sfx('click');
      return 'confirm';
    }
    this.confirm = null;
    const to = this.deliverTo(this.site);
    const sw = this.swatches(), pick = sw[this.col] || null;
    const s = TYPES[t];
    const c = pick ? pick.c : (s.livery !== undefined ? s.livery : 0xffffff);
    const rec = { t, c, li: pick ? pick.li : -1 };
    if (!this.o.charge(price)) { this.say = `You need ${formatMoney(price - this.o.money())} more`; this._detail(); return false; }
    const gs = this.o.garages();
    const j = gs.store(to.i, rec, to.j);
    if (j < 0) { this.o.game.money += price; this.say = 'Make room in a garage first'; this._detail(); return false; }   // (never: deliverTo found the stall)
    const first = this.stats.bought.length === 0;
    this.stats.bought.push({ t, c, d: this.site.d.id, p: price, g: to.q.g.id, at: Date.now() });
    this.stats.spent += price;
    this._save();
    this._sfx('sold');
    const where = `${to.q.g.name} (${to.q.g.sub.split('·').pop().trim().toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase())})`;
    this.last = { t, price, garage: to.q.g.id, stall: j, c };
    this.say = `Sold! Your ${typeName(t)} is waiting in the ${where}, stall ${j + 1}. Keys are in it.`;
    this._detail(); this._foot();
    this.o.hud.showToast(first ? `Your first car! The ${typeName(t)} is in the ${where} — find it on the map`
      : `${typeName(t)} delivered to the ${where} — ${formatMoney(price)}`, 4600);
    return true;
  }

  // --- the test drive ------------------------------------------------------------------

  testDrive() {
    if (this.mode !== 'shop' || !this.item) return false;
    const why = this.o.blocked && this.o.blocked();
    if (why) { this.say = `Finish the ${why} first`; this._detail(); return false; }
    const site = this.site, sel = this.sel, col = this.col;
    const [t] = this.item;
    const sw = this.swatches(), pick = sw[col] || null;
    const spot = this._kerb(site, TYPES[t]);
    this.close();
    const pl = this.o.player();
    let v = null;
    try { v = this.o.traffic.spawnAt(spot.x, spot.z, spot.h, t, pick ? (pick.li >= 0 ? pick.li : pick.c) : 0xffffff, 'free'); } catch (e) { v = null; }
    if (!v) { this.o.hud.showToast('The demo would not start — sorry about that', 2600); return false; }
    if (pick && pick.li < 0) v.respray(pick.c);
    v.vLong = 0; v.testDrive = true;
    if (pl.vehicle) pl.exitVehicle(true);
    pl.enterVehicle(v);
    const ob = this.o.hud.objective;
    this.td = { v, site, sel, col, t: TEST_S, spot, t0: 0, shown: -1, obj: ob ? ob.textContent : '' };   // (the objective it covers comes back after)
    this.stats.tests++; this._save();
    this.o.hud.showToast(`Test drive: ${TEST_S} seconds in the ${typeName(t)}. Bring it back to the lot to buy`, 3600);
    return true;
  }

  _tdTick(dt, pl) {
    const td = this.td, v = td.v;
    if (this.o.game.paused) return;
    td.t -= dt; td.t0 += dt;
    const sec = Math.max(0, Math.ceil(td.t));
    if (sec !== td.shown) {
      td.shown = sec;
      this.o.hud.setObjective(`TEST DRIVE ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} — bring the ${typeName(v.typeName)} back to ${td.site.d.name}`);
    }
    if (v.dead || this.o.traffic.cars.indexOf(v) < 0) return this._tdEnd('wreck');
    if (td.t <= 0) return this._tdEnd('time');
    const inIt = pl && !pl.onFoot && pl.vehicle === v;
    const d = Math.hypot(v.x - td.spot.x, v.z - td.spot.z);
    if (d > AWAY_R) td.away = true;   // (it has to have gone somewhere to be brought back)
    if (inIt && td.away && d < BACK_R && Math.abs(v.vLong) < 1.0) this._tdEnd('back');
  }

  _tdEnd(why) {
    const td = this.td;
    this.td = null;
    if (!td) return;
    this.o.hud.setObjective(td.obj || '');
    const pl = this.o.player(), v = td.v;
    const inIt = pl && !pl.onFoot && pl.vehicle === v;
    if (inIt) { v.vLong = 0; v.vLat = 0; pl.exitVehicle(true); }
    if (why === 'back' && pl) {
      // on foot at the door, and the showroom again with the same car
      const s = td.site;
      pl.x = s.x + s.nx * 0.8; pl.z = s.z + s.nz * 0.8;
      pl.y = this.o.city.groundAt(pl.x, pl.z, null) + 0.05;
      pl.heading = Math.atan2(-s.nx, -s.nz);
    }
    try { this.o.traffic.remove(v); } catch (e) { /* gone */ }
    if (why === 'back') {
      this.o.hold();
      this.open(td.site, td.sel, td.col);
      this.say = 'Back already? She drives nice, eh? Ready to sign?';
      this._detail();
    } else if (why === 'time') this.o.hud.showToast(`Time's up — the ${typeName(v.typeName)} goes back to ${td.site.d.name}`, 3400);
    else if (why === 'wreck') this.o.hud.showToast(`You wrecked the demo — ${td.site.d.name} will not be lending you another today... well, maybe`, 3400);
  }

  /** Where a test car is handed over: the clear lot in front of the showroom nearest the door. */
  _kerb(site, spec) {
    const city = this.o.city, traffic = this.o.traffic;
    const len = (spec && spec.len) || 5, ax = -site.nz, az = site.nx;
    const hAlong = Math.atan2(ax, az);
    const inB = (x, z) => city.buildingsNear(x, z, 30).some((b) => {
      if (b.h <= 0.5) return false;
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
      return Math.abs(dx * c - dz * s) < b.w / 2 + 1.2 && Math.abs(dx * s + dz * c) < b.d / 2 + 1.2;
    });
    // the hand-over car's footprint (parallel to the front) against every car near: their boxes, sampled
    const wid = (spec && spec.wid) || 2;
    const carHit = (x, z) => {
      const near = traffic.cars.filter((c) => Math.hypot(c.x - x, c.z - z) < len + c.spec.len);
      for (const c of near) {
        for (let i = -2; i <= 2; i++) for (const sd of [-1, 0, 1]) {
          const px = x + ax * i * (len / 4 + 0.15) + site.nx * sd * (wid / 2 + 0.3), pz = z + az * i * (len / 4 + 0.15) + site.nz * sd * (wid / 2 + 0.3);
          const q = c.nearest(px, pz);
          if (Math.hypot(q.x - px, q.z - pz) < 0.3) return true;
        }
      }
      return false;
    };
    const solid = (x, z) => (city.landmarkHit && city.landmarkHit(x, z, 1.2, city.groundAt(x, z, null) + 1, true)) || (city.barrierHit && city.barrierHit(x, z, 1.2, city.groundAt(x, z, null) + 1));
    let road = null;
    for (const o of [4.2, 5.5, 7, 9, 2.4, 1.6, 11, 13, 16, 20]) {   // (Parkway Ford's lot is full to the glass: the strip in front of it)
      for (const t of [0, 4, -4, 8, -8, 12, -12, 16, -16]) {
        const x = site.x + site.nx * o + ax * t, z = site.z + site.nz * o + az * t;
        const ok = (dx, dz) => !inB(x + dx, z + dz) && !solid(x + dx, z + dz);
        const ex = ax * len * 0.45, ez = az * len * 0.45;
        if (!ok(0, 0) || !ok(ex, ez) || !ok(-ex, -ez) || carHit(x, z)) continue;
        if (city.onRoad(x, z, 1.2, false, false)) { if (!road) road = { x, z, h: hAlong }; continue; }
        return { x, z, h: hAlong };
      }
    }
    return road || { x: site.x + site.nx * 6, z: site.z + site.nz * 6, h: hAlong };
  }

  // --- the turntable -------------------------------------------------------------------

  _pvMake() {
    if (this.pv || !this.o.renderer) return;
    const L = this.site.d.look;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(L.stage);
    if (this.o.scene && this.o.scene.environment) scene.environment = this.o.scene.environment;
    const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x404048, L.light ? 1.1 : 0.85);
    const key = new THREE.DirectionalLight(0xfff4e6, 2.3); key.position.set(-6, 9, 7);
    const rim = new THREE.DirectionalLight(0xcfe0ff, 1.0); rim.position.set(7, 4, -8);
    scene.add(hemi, key, rim);
    // the turntable: a disc with a soft pool of light on it, and its edge
    const disc = new THREE.CircleGeometry(4.2, 48);
    const col = [], p = disc.attributes.position, c0 = new THREE.Color(L.floor), c1 = new THREE.Color(L.floor).multiplyScalar(L.light ? 1.12 : 1.9);
    for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getY(i)) / 4.2; const c = c1.clone().lerp(c0, Math.min(1, r * 1.15)); col.push(c.r, c.g, c.b); }
    disc.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    disc.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
    const floor = new THREE.Mesh(disc, floorMat);
    const ringG = new THREE.RingGeometry(4.2, 4.42, 64).rotateX(-Math.PI / 2);
    const ringM = new THREE.MeshBasicMaterial({ color: new THREE.Color(L.stripe) });
    const ring = new THREE.Mesh(ringG, ringM); ring.position.y = 0.005;
    scene.add(floor, ring);
    const cam = new THREE.PerspectiveCamera(30, 1.6, 0.1, 100);
    const cv = this.ui.cv, g = cv.getContext('2d');
    this.pv = { scene, cam, floor, ring, disc, floorMat, ringG, ringM, car: null, cv, g, vp: new THREE.Vector4(), sc: new THREE.Vector4(), sz: new THREE.Vector2(), frames: 0 };
    this.pvAcc = 1;
  }

  _pvCar() {
    const pv = this.pv;
    if (!pv || !this.item) return;
    this._pvDrop();
    const t = this.item[0], sw = this.swatches(), pick = sw[this.col];
    let v = null;
    try { v = new Vehicle(null, t, pick ? (pick.li >= 0 ? pick.li : pick.c) : 0xffffff); } catch (e) { v = null; }
    if (!v) return;
    if (pick && pick.li < 0) v.respray(pick.c);
    v.x = 0; v.y = 0; v.z = 0; v.heading = this.spin;
    v.mode = 'parked';
    // nobody at the wheel on a showroom floor: the parked (empty) cabin
    if (v.assets.matteGeoWE) v.matteMesh.geometry = v.assets.matteGeoWE;
    v.sync();
    pv.scene.add(v.group);
    pv.car = v;
    const L = v.spec.len || 5, H = (v.spec.roof || 1.5);
    pv.dist = Math.max(6.4, L * 1.32 + 1.4); pv.aimY = H * 0.42;
    // the turntable to the car's size
    const k = Math.max(2.7, L * 0.64) / 4.2;
    pv.floor.scale.set(k, 1, k); pv.ring.scale.set(k, 1, k);
    this.pvAcc = 1;
  }
  _pvPaint() {
    const pv = this.pv;
    if (!pv || !pv.car) return;
    const pick = this.swatches()[this.col];
    if (!pick) return;
    if (pick.li >= 0) this._pvCar();   // (a livery is chosen at construction)
    else { pv.car.respray(pick.c); this.pvAcc = 1; }
  }
  _pvDrop() {
    const pv = this.pv;
    if (!pv || !pv.car) return;
    const v = pv.car;
    pv.scene.remove(v.group);
    // its own materials only: the geometry is the type's, shared with every car on the road
    v.bodyMat.dispose();
    if (v.dentTrim) { v.dentTrim.dispose(); v.dentMatte.dispose(); }
    if (v.extra && !v.extra.userData.shared) v.extra.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material && m.material.dispose) m.material.dispose(); });
    pv.car = null;
  }
  _pvDispose() {
    const pv = this.pv;
    if (!pv) return;
    this._pvDrop();
    pv.disc.dispose(); pv.floorMat.dispose(); pv.ringG.dispose(); pv.ringM.dispose();
    pv.scene.environment = null;
    this.pv = null;
  }

  /** The open showroom's frame: turn the car and draw it (at most PV_FPS). */
  update(dt) {
    if (this.mode === 'off') return;
    if (this.confirm && performance.now() - this.confirm.at > CONFIRM_S * 1000) { this.confirm = null; this.say = null; this._detail(); }
    if (!this.drag) this.spin += this.spinV * dt;
    const pv = this.pv;
    if (!pv || !pv.car) return;
    this.pvAcc += dt;
    if (this.pvAcc < 1 / PV_FPS) return;
    this.pvAcc = 0;
    this._pvDraw();
  }

  _pvDraw() {
    const pv = this.pv, R = this.o.renderer, v = pv.car;
    const W = this.cw, H = this.ch;
    if (!W || !H) return;
    v.heading = this.spin; v.sync();
    // the camera: three-quarter, a little above, the whole car in frame
    const asp = W / H;
    pv.cam.aspect = asp; pv.cam.fov = asp < 1.2 ? 38 : 30; pv.cam.updateProjectionMatrix();
    const d = pv.dist * (asp < 1.2 ? 1.25 : 1);
    pv.cam.position.set(0, pv.aimY + d * 0.24, d);
    pv.cam.lookAt(0, pv.aimY - 0.15, 0);
    // into a corner of the default framebuffer, then straight onto the 2D canvas
    R.getDrawingBufferSize(pv.sz);
    const pr = R.getPixelRatio();
    const bw = pv.sz.x / pr, bh = pv.sz.y / pr;
    const k = Math.min(1, bw / W, bh / H);
    const w = Math.max(1, Math.floor(W * k)), h = Math.max(1, Math.floor(H * k));
    const rt = R.getRenderTarget(), ac = R.autoClear, st = R.getScissorTest();
    R.getViewport(pv.vp); R.getScissor(pv.sc);
    R.setRenderTarget(null);
    R.setViewport(0, 0, w, h); R.setScissor(0, 0, w, h); R.setScissorTest(true);
    R.autoClear = true;
    R.render(pv.scene, pv.cam);
    const g = pv.g, cv = pv.cv;
    const sw = Math.round(w * pr), sh = Math.round(h * pr);
    g.drawImage(R.domElement, 0, pv.sz.y - sh, sw, sh, 0, 0, cv.width, cv.height);
    R.setScissorTest(st); R.setScissor(pv.sc); R.setViewport(pv.vp);
    R.autoClear = ac; R.setRenderTarget(rt);
    pv.frames++;
  }

  // --- sounds -----------------------------------------------------------------------

  _sfx(k) {
    const a = this.o.audio;
    if (!a || !a.ready) return;
    try {
      if (k === 'sold') a.play('cash', { gain: 0.8, jitter: false });
      else if (k === 'no') a.play('thunk', { gain: 0.35, jitter: false });
      else a.play('shift', { gain: 0.3, jitter: false });
    } catch (e) { /* a missing cue */ }
  }

  // --- the DOM --------------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'dlUi';
    d.innerHTML = `
      <div class="dlHead"><div class="dlBadge"><b></b><span></span></div><div class="dlName"><b></b><span></span></div><div class="dlMoney"></div></div>
      <button class="dlX" aria-label="Leave">✕</button>
      <div class="dlBody">
        <div class="dlMain">
          <div class="dlStage"><canvas></canvas><div class="dlCap"><b></b><span></span></div><div class="dlSpec"></div></div>
          <div class="dlSw"></div>
          <div class="dlAct"><div class="dlSay"></div><button class="dlBtn dlTest" data-act="test">TEST DRIVE</button><button class="dlBtn dlBuy" data-act="buy">BUY</button></div>
        </div>
        <div class="dlList"></div>
      </div>
      <div class="dlFoot"></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #dlUi { position: absolute; inset: 0; z-index: 40; display: none; flex-direction: column; overflow: hidden; user-select: none; -webkit-user-select: none;
        font: 600 14px ${FONT}; color: var(--ink2); background: linear-gradient(170deg, var(--bg0), var(--bg1)); }
      #dlUi.show { display: flex; }
      #dlUi button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; border: none; color: inherit; font: inherit; cursor: pointer; }
      #dlUi .dlHead { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; background: var(--head); color: var(--ink);
        padding: calc(4px + var(--safe-t, 0px)) calc(58px + var(--safe-r, 0px)) 4px calc(14px + var(--safe-l, 0px)); min-height: 42px;
        border-bottom: 4px solid var(--stripe); box-shadow: 0 6px 18px #0006; }
      #dlUi .dlBadge { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2px 14px; border-radius: 999px;
        background: var(--btn); color: #fff; border: 2px solid var(--ink); box-shadow: inset 0 0 0 2px var(--btn), inset 0 0 0 3px #ffffff55; line-height: 1; }
      #dlUi .dlBadge b { font: italic 900 17px ${FONT}; letter-spacing: .06em; }
      #dlUi .dlBadge span { font: 800 7.5px ${FONT}; letter-spacing: .16em; opacity: .9; margin-top: 1px; }
      #dlUi .dlName { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
      #dlUi .dlName b { font: 800 17px ${FONT}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #dlUi .dlName span { font: 700 10px ${FONT}; letter-spacing: .12em; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #dlUi .dlMoney { margin-left: auto; font: 900 17px ${FONT}; color: var(--money); white-space: nowrap; }
      #dlUi .dlX { position: absolute; top: calc(5px + var(--safe-t, 0px)); right: calc(10px + var(--safe-r, 0px)); width: 36px; height: 36px; border-radius: 50%;
        background: rgba(0,0,0,.25); color: var(--ink); font-size: 16px; z-index: 2; }
      #dlUi .dlBody { flex: 1 1 auto; display: flex; min-height: 0; gap: 10px; padding: 8px calc(10px + var(--safe-r, 0px)) 6px calc(10px + var(--safe-l, 0px)); }
      #dlUi .dlMain { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; gap: 6px; }
      #dlUi .dlStage { flex: 1 1 auto; position: relative; min-height: 0; border-radius: 14px; overflow: hidden; background: var(--stage); touch-action: none;
        box-shadow: inset 0 0 0 1px #ffffff22, 0 6px 20px #0005; }
      #dlUi .dlStage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
      #dlUi .dlCap { position: absolute; left: 12px; top: 8px; display: flex; flex-direction: column; pointer-events: none; color: var(--capInk); text-shadow: 0 1px 3px #0008; }
      #dlUi .dlCap b { font: 900 21px ${FONT}; } #dlUi .dlCap span { font: 900 17px ${FONT}; color: var(--price); }
      #dlUi .dlSpec { position: absolute; right: 10px; top: 9px; display: grid; grid-template-columns: auto 64px; gap: 3px 6px; align-items: center; pointer-events: none;
        font: 800 9px ${FONT}; letter-spacing: .1em; color: var(--capInk); opacity: .9; }
      #dlUi .dlSpec i { display: block; height: 5px; border-radius: 3px; background: #ffffff30; overflow: hidden; }
      #dlUi .dlSpec i > u { display: block; height: 100%; background: var(--pick); }
      #dlUi .dlSw { flex: 0 0 auto; display: flex; gap: 8px; align-items: center; justify-content: center; min-height: 30px; flex-wrap: wrap; }
      #dlUi .dlSw button { width: 28px; height: 28px; border-radius: 50%; box-shadow: inset 0 -3px 6px #0005, 0 0 0 2px #ffffff40; }
      #dlUi .dlSw button.on { box-shadow: inset 0 -3px 6px #0005, 0 0 0 3px var(--pick), 0 0 0 5px #0006; transform: scale(1.12); }
      #dlUi .dlSw em { font: italic 700 12px ${FONT}; opacity: .7; }
      #dlUi .dlAct { flex: 0 0 auto; display: flex; gap: 8px; align-items: center; }
      #dlUi .dlSay { flex: 1 1 auto; min-width: 0; font: italic 600 12.5px/1.3 Georgia, serif; color: var(--ink2); opacity: .92; }
      #dlUi .dlBtn { flex: 0 0 auto; padding: 10px 16px; border-radius: 999px; font: 900 14px ${FONT}; letter-spacing: .04em; background: var(--btn); color: #fff;
        box-shadow: 0 4px 0 var(--btnLo); white-space: nowrap; }
      #dlUi .dlBtn:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--btnLo); }
      #dlUi .dlBtn.dlTest { background: rgba(255,255,255,.14); box-shadow: 0 4px 0 #0005; color: var(--ink2); }
      #dlUi .dlBtn.armed { background: #19a34a; box-shadow: 0 4px 0 #0b5e28; animation: dlPulse .6s ease-in-out infinite alternate; }
      @keyframes dlPulse { to { filter: brightness(1.25); } }
      #dlUi .dlBtn:disabled { opacity: .42; filter: grayscale(.7); }
      #dlUi .dlList { flex: 0 0 min(300px, 38%); overflow-y: auto; -webkit-overflow-scrolling: touch; display: flex; flex-direction: column; gap: 4px;
        padding: 4px; border-radius: 14px; background: rgba(0,0,0,.18); box-shadow: inset 0 0 0 1px #ffffff1a; }
      #dlUi .dlRow { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 10px; background: rgba(255,255,255,.06); text-align: left; color: var(--ink2); }
      #dlUi .dlRow b { flex: 1 1 auto; font: 800 13.5px ${FONT}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #dlUi .dlRow span { font: 800 13px ${FONT}; color: var(--price); white-space: nowrap; }
      #dlUi .dlRow span.poor { opacity: .55; }
      #dlUi .dlRow.on { background: var(--btn); color: #fff; } #dlUi .dlRow.on span { color: #fff; }
      #dlUi .dlRow small { font: 700 9px ${FONT}; letter-spacing: .08em; opacity: .7; }
      #dlUi .dlFoot { flex: 0 0 auto; display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; font-size: 11px; color: var(--ink2); opacity: .85;
        padding: 3px calc(12px + var(--safe-r, 0px)) calc(4px + var(--safe-b, 0px)) calc(12px + var(--safe-l, 0px)); background: rgba(0,0,0,.22); }
      #dlUi .dlFoot b { color: var(--price); }
      @media (max-height: 460px) {
        #dlUi .dlHead { min-height: 34px; } #dlUi .dlName b { font-size: 15px; } #dlUi .dlBadge b { font-size: 14px; }
        #dlUi .dlBody { padding-top: 5px; padding-bottom: 4px; gap: 8px; } #dlUi .dlRow { padding: 5px 9px; } #dlUi .dlRow b { font-size: 12.5px; }
        #dlUi .dlBtn { padding: 8px 13px; font-size: 13px; } #dlUi .dlSw button { width: 24px; height: 24px; } #dlUi .dlSw { min-height: 26px; }
        #dlUi .dlCap b { font-size: 17px; } #dlUi .dlCap span { font-size: 15px; } #dlUi .dlSay { font-size: 11.5px; }
      }
      @media (max-width: 700px) { #dlUi .dlName span { display: none; } }
      @media (orientation: portrait) { #dlUi .dlBody { flex-direction: column; } #dlUi .dlList { flex: 0 0 34%; } }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { list: q('.dlList'), sw: q('.dlSw'), say: q('.dlSay'), buy: q('.dlBuy'), test: q('.dlTest'), cv: q('.dlStage canvas'), stage: q('.dlStage'),
      cap: q('.dlCap b'), price: q('.dlCap span'), spec: q('.dlSpec'), money: q('.dlMoney'), foot: q('.dlFoot'),
      badge: q('.dlBadge b'), badgeSub: q('.dlBadge span'), name: q('.dlName b'), addr: q('.dlName span') };
    q('.dlX').addEventListener('click', () => this.close());
    this.ui.buy.addEventListener('click', () => this.buy());
    this.ui.test.addEventListener('click', () => this.testDrive());
    this.ui.list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { this._sfx('click'); this.pick(+b.dataset.i); } });
    this.ui.sw.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { this._sfx('click'); this.paint(+b.dataset.c); } });
    // drag the turntable round
    const stg = this.ui.stage;
    stg.addEventListener('pointerdown', (e) => { e.preventDefault(); this.drag = { id: e.pointerId, x: e.clientX, t: performance.now() }; try { stg.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ } });
    stg.addEventListener('pointermove', (e) => {
      const dr = this.drag;
      if (!dr || dr.id !== e.pointerId) return;
      const dx = e.clientX - dr.x, now = performance.now();
      this.spin += dx * 0.012;
      this.spinV = Math.max(-4, Math.min(4, (dx * 0.012) / Math.max(0.008, (now - dr.t) / 1000)));
      dr.x = e.clientX; dr.t = now; this.pvAcc = 1;
    });
    const up = (e) => { if (this.drag && this.drag.id === e.pointerId) { this.drag = null; if (Math.abs(this.spinV) < 0.3) this.spinV = 0.55 * Math.sign(this.spinV || 1); } };
    for (const ev of ['pointerup', 'pointercancel']) stg.addEventListener(ev, up);
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      const c = e.code;
      if (c === 'Escape') this.close();
      else if (c === 'ArrowDown' || c === 'KeyS') this.pick(this.sel + 1);
      else if (c === 'ArrowUp' || c === 'KeyW') this.pick(this.sel - 1);
      else if (c === 'ArrowRight' || c === 'KeyD') this.paint(this.col + 1);
      else if (c === 'ArrowLeft' || c === 'KeyA') this.paint(this.col - 1);
      else if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') { if (!e.repeat) this.buy(); }
      else if (c === 'KeyT' || c === 'KeyK') { if (!e.repeat) this.testDrive(); }
      else if (c === 'KeyE' || c === 'KeyF') { /* the game's ENTER: not to be left queued for when this closes */ }
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    window.addEventListener('resize', () => { if (this.active) this._fit(); });
  }

  _theme() {
    const d = this.site.d, L = d.look, s = this.el.style;
    s.setProperty('--head', L.head); s.setProperty('--ink', L.ink); s.setProperty('--bg0', L.bg0); s.setProperty('--bg1', L.bg1);
    s.setProperty('--stripe', L.stripe); s.setProperty('--btn', L.btn); s.setProperty('--btnLo', L.btnLo); s.setProperty('--pick', L.pick);
    s.setProperty('--stage', hexCss(L.stage));
    s.setProperty('--ink2', L.light ? '#1a1d22' : '#f2f4f7');
    s.setProperty('--capInk', L.light ? '#15181d' : '#ffffff');
    s.setProperty('--price', L.light ? '#0f4fae' : '#9ff0b4');
    s.setProperty('--money', L.light ? '#0a7a35' : (L.head === '#ffd23a' ? '#0a6a2a' : '#bff5c8'));
    this.ui.badge.textContent = d.badge; this.ui.badgeSub.textContent = d.sub;
    this.ui.name.textContent = d.name; this.ui.addr.textContent = `${d.addr.toUpperCase()} · ${d.tag}`;
  }

  _fit() {
    const r = this.ui.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = Math.max(1, Math.round(r.width)); this.ch = Math.max(1, Math.round(r.height));
    this.ui.cv.width = Math.round(this.cw * dpr); this.ui.cv.height = Math.round(this.ch * dpr);
    this.pvAcc = 1;
  }

  _list() {
    const d = this.site.d, m = this.o.money();
    this.ui.list.innerHTML = d.stock.map(([t, p], i) => `<button class="dlRow${i === this.sel ? ' on' : ''}" data-i="${i}"><b>${typeName(t)}</b>`
      + `${TYPES[t] && TYPES[t].classic ? '<small>CLASSIC</small>' : ''}<span class="${m < p ? 'poor' : ''}">${formatMoney(p)}</span></button>`).join('');
  }

  _detail() {
    if (!this.site || !this.item) return;
    const [t, price, line] = this.item, s = TYPES[t] || {};
    this.ui.cap.textContent = typeName(t);
    this.ui.price.textContent = formatMoney(price);
    const bar = (k) => `<i><u style="width:${Math.round(Math.max(0.08, Math.min(1, k)) * 100)}%"></u></i>`;
    this.ui.spec.innerHTML = `<span>TOP ${Math.round(s.topKph || 0)} KM/H</span>${bar(((s.topKph || 0) - 100) / 220)}<span>PICK-UP</span>${bar((s.acc || 0) / 9)}<span>GRIP</span>${bar(((s.latG || 0.6) - 0.5) / 0.48)}`;
    const sw = this.swatches();
    this.ui.sw.innerHTML = sw.length ? sw.map((x, i) => `<button data-c="${i}" class="${i === this.col ? 'on' : ''}" style="background:${hexCss(x.c)}" aria-label="paint ${i + 1}"></button>`).join('')
      : '<em>Factory finish — one paint only</em>';
    const why = this.refusal(price);
    const busy = this.o.blocked && this.o.blocked();
    this.ui.buy.disabled = !!why;
    const armed = this.confirm && this.confirm.k === `${this.site.d.id}:${this.sel}:${this.col}` && performance.now() - this.confirm.at < CONFIRM_S * 1000;
    this.ui.buy.textContent = why && /more$/.test(why) ? `NEED ${formatMoney(price - this.o.money())} MORE` : armed ? 'SIGN — BUY IT' : `BUY ${formatMoney(price)}`;
    this.ui.buy.classList.toggle('armed', !!armed);
    this.ui.test.disabled = !!busy;
    this.ui.say.textContent = this.say || (why && !/more$/.test(why) ? why : line);
    this._foot();
  }

  _foot() {
    this.ui.money.textContent = formatMoney(this.o.money());
    const to = this.deliverTo(this.site);
    const gs = this.o.garages && this.o.garages();
    const free = gs ? gs.sites.reduce((n, q) => n + gs.data[q.g.id].filter((r) => !r).length, 0) : 0;
    this.ui.foot.innerHTML = `<span>Delivered to <b>${to ? to.q.g.name : 'no garage — all full'}</b></span><span>Free stalls <b>${free}</b></span>`
      + `<span>Cars bought <b>${this.bought}</b></span><span>Test drive <b>${TEST_S} s</b> · drag the car to turn it</span>`;
  }
}
