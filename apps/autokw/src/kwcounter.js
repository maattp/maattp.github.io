// THE COUNTER: ENTER on foot at the door of a main-street food or drink place
// (kwshops.js's biz signs) or one of the region's well-known locals, and you
// order the day's special. No overlay and no hold on the world: a price, a
// bite of health and a line from the till, in a toast -- the cheap sibling of
// KW Eats' menu and Roll Up the Rim.
//
//   - The special changes every calendar day (a hash of the date and the name).
//   - The Princess Cinemas show three silly "now playing" titles a day (the
//     same three all day, new tomorrow): a ticket is $12, the popcorn heals.
//   - A place sells to you once a visit (`cool` s), so a held ENTER is no
//     slot machine.
//
// Harness: `__dbg.counter` (`doors`, `nowPlaying()`, `order(pl)`).

const FILMS = [
  'The Fast and the Fur-ious', 'Honey, I Shrunk the Zamboni', 'Raiders of the Lost Ark Hockey',
  'A Fistful of Poutine', 'Lord of the Rinks', 'Back to the Future Shop', 'Dial M for Maple',
  'The Good, the Bad and the Gaukel', 'Jurassic Spark Plug', 'Die Hard with a Double-Double',
  'Weber Street Story', 'Eh Team', 'Interstellar Lake Superior', 'The Grand River Wild',
  'Apocalypse Snow Day', 'Kitchener Rangers of the Lost Ark', 'The Lion King of Queen St',
  'Mad Max: Fury Road Construction', 'Toy Story 4 Pack', 'Rocky Horror Roll Up the Rim Show',
  'Gone with the Windsor', 'Some Like It Hot Pot', 'The Sound of Music Plus', 'Finding Nemo\'s Pizza',
];
const SPECIALS = {
  cinema: [['a ticket to {film}', 12, 0, 'Popcorn is extra. Sit anywhere.']],
  pub: [['a pint of local lager', 8, 6, 'Cheers, eh.'], ['wings and a pint', 16, 12, 'Hot, medium or "ask the cook".'], ['the pub burger', 17, 14, 'Comes with a pickle the size of your thumb.']],
  bar: [['a pint of local lager', 8, 6, 'Cheers, eh.'], ['nachos for the table', 14, 10, 'Extra jalapeños, no questions.']],
  cafe: [['a double-double', 3, 6, 'Two cream, two sugar, one good morning.'], ['a flat white and a muffin', 8, 10, 'Still warm.'], ['an oat latte', 6, 7, 'Foam art: a maple leaf. Sort of.']],
  fast_food: [['poutine', 9, 14, 'Squeaky curds. Correct.'], ['a slice and a pop', 5, 9, 'Folded, New York style. Kitchener style: also folded.'], ['a big wrap', 10, 12, 'Garlic sauce: yes.']],
  restaurant: [['the lunch special', 14, 14, 'Comes with soup. Soup is always the soup of the day.'], ['the dinner combo', 19, 18, 'Leftovers guaranteed.'], ['tonight\'s special', 17, 16, 'The chef says it is a surprise. It is.']],
  ice_cream: [['a double scoop', 6, 8, 'Maple walnut, naturally.']],
  bakery: [['a butter tart', 3, 7, 'Raisins: a matter for debate.'], ['a fritter', 4, 8, 'Apple. Obviously.']],
};
// the locals everyone names, at OSM's points (the doors the zone modules draw are not data)
const LOCALS = [
  ['Original Princess Cinema', -3916, -1653, 'cinema', 'The Princess: "Waterloo\'s own, since 1985."'],
  ['Princess Twin Cinemas', -3830, -1617, 'cinema', 'The Princess Twin.'],
  ['The Jane Bond', -3914, -1630, 'restaurant', 'The Jane Bond: "shaken, not stirred, from the Princess."'],
  ["Ethel's Lounge", -3899, -1910, 'bar', ''], ["Morty's Pub", -4038, -2854, 'pub', ''],
  ['Kinkaku Izakaya', -1471, 97, 'restaurant', ''], ['Seven Shores', -3739, -1561, 'cafe', ''],
  ["Golf's Steakhouse", -661, -3200, 'restaurant', ''], ['Beertown Public House', -3866, -1328, 'pub', ''],
  ['The Boathouse', -1670, 540, 'restaurant', ''], ['Waterloo Brewing Taphouse', 1893, -2062, 'pub', ''],
];
const FOOD = new Set(['restaurant', 'cafe', 'pub', 'bar', 'fast_food', 'cinema', 'theatre', 'ice_cream', 'bakery']);

function hash(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
const today = () => { const d = new Date(); return d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate(); };

export class Counter {
  /** o: { hud, audio, charge(n) -> bool, heal(n), signs: [[name, x, y, z, nx, nz, kind], ...] } */
  constructor(o) {
    this.o = o;
    this.doors = [];
    for (const s of o.signs || []) {
      const kind = s[6] === 'theatre' ? 'cinema' : s[6];
      if (!SPECIALS[kind] && !FOOD.has(kind)) continue;
      this.doors.push({ name: s[0], x: s[1] + s[4] * 1.8, z: s[3] + s[5] * 1.8, kind, r: 3.6, cool: 0, said: false });
    }
    for (const [name, x, z, kind, tag] of LOCALS) this.doors.push({ name, x, z, kind, r: 10, cool: 0, said: false, tag });
    this.served = 0;
  }
  /** The three titles on today's Princess marquee. */
  nowPlaying() {
    const d = today();
    return [0, 1, 2].map((i) => FILMS[(hash('princess' + d) + i * 7) % FILMS.length]);
  }
  near(pl) {
    let best = null, bd = Infinity;
    for (const d of this.doors) {
      const dx = pl.x - d.x, dz = pl.z - d.z;
      if (dx > d.r || dx < -d.r || dz > d.r || dz < -d.r) continue;   // the box first: hypot only for the few doors close by
      const e = Math.hypot(dx, dz);
      if (e < d.r && e < bd) { bd = e; best = d; }
    }
    return best;
  }
  update(dt, pl) {
    for (const d of this.doors) if (d.cool > 0) d.cool -= dt;
    if (!pl || !pl.onFoot) return;
    const d = this.near(pl);
    if (!d || d.said) return;
    d.said = true;
    if (/Princess/.test(d.name) && d.kind === 'cinema') this.o.hud.showToast(`${d.name}: now playing — ${this.nowPlaying().join(' / ')} (ENTER for a ticket)`, 5200);
    else this.o.hud.showToast(`${d.name} — ENTER to order ${this.today(d)[0].replace('{film}', this.nowPlaying()[0])}`, 3200);
  }
  /** Today's special at a door: [what, price, health, line]. */
  today(d) {
    const l = SPECIALS[d.kind] || SPECIALS.restaurant;
    return l[(hash(d.name) + today()) % l.length];
  }
  /** ENTER on foot: order if a door is within reach. True when it handled the press. */
  order(pl) {
    if (!pl.onFoot) return false;
    const d = this.near(pl);
    if (!d) return false;
    if (this.o.busy && this.o.busy(pl)) return false;   // a car at the kerb is the ENTER, not the till
    if (d.cool > 0) { this.o.hud.showToast(`${d.name}: "One minute — still on your last order."`, 2000); return true; }
    const film = d.kind === 'cinema' ? this.nowPlaying()[hash(d.name + today()) % 3] : '';
    const [what, price, hp, line] = this.today(d);
    const w = what.replace('{film}', film);
    if (!this.o.charge(price)) { this.o.hud.showToast(`${d.name}: ${w} is $${price} — you're short.`, 2800); d.cool = 4; return true; }
    if (hp) this.o.heal(hp);
    d.cool = 20;
    this.served++;
    this.last = { name: d.name, what: w, price, hp };
    if (this.o.audio && this.o.audio.play) this.o.audio.play('slosh', { gain: 0.5, rate: 1.3 });
    this.o.hud.showToast(`${d.name}: ${w}, $${price}. ${line}${hp ? ` (+${hp} health)` : ''}`, 4600);
    return true;
  }
}
