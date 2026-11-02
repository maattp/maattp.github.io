// THE GOOSE 101.9 -- a fictional Waterloo Region radio station, GTA-style.
//
// Entirely generated in the browser (works offline and abroad): the music is
// radiosynth.js's indie voice (audio.js STATIONS entry `goose: true`, synth
// only); the DJ is `speechSynthesis` (an en-CA voice if the device has one),
// a segment every 60-150 s of tuned-in driving, 5-15 s long, the music ducked
// under it. Segments are REACTIVE: wanted level, weather, the hour, the
// golden-egg count, J&J cards, the calendar, the streets you are on.
//
// Laws: untuned, the station costs one compare per frame. It talks only while
// tuned, in a car, un-paused (the menu, a story cutscene and any activity
// hold all read as game.paused) with the tab visible; the moment one fails,
// speechSynthesis.cancel(). `window.__noSpeech` silences the voice; segments
// then pass in silence at a reading pace, so the schedule is unchanged.
// Every business here is invented. No real people.
import { themesFor, calendarDate } from './kwcalendar.js';

export const GOOSE_NAME = 'The Goose 101.9';
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const num = (n) => (n === 1 ? 'one' : String(n));

// --- the lines ---------------------------------------------------------------
// Each entry is (c) => text | [text, ...]; c is the context from main.js.
// A line starting '~' is the ad voice.
const BANK = {
  weather: {
    snow: [
      () => 'Snow squalls coming off Lake Huron, folks. If you can see the car in front of you, you are not close enough to the lake. Yet.',
      () => 'It is snowing. In Waterloo Region. Experts are stunned, and by experts I mean nobody.',
      () => 'Snow on the roads. Remember, the Conestoga Parkway is not a luge track, no matter what your cousin says.',
    ],
    rain: [
      () => 'Rain on the way down. The Grand River is thinking about its options.',
      () => 'Wet out there. Slow down on the bridges, and give the geese the right of way. They already assume it.',
    ],
    drizzle: [() => 'A little drizzle out there. Not enough to cancel anything, just enough to ruin your hair.'],
    fog: [() => 'Fog across the region this hour. If you hear a honk and cannot see its source, that is probably us.'],
    overcast: [() => 'Grey skies over the Tri-Cities. So, a normal day. Whatever day it is.'],
    clear: [
      () => 'Clear skies over Kitchener-Waterloo. Enjoy it, the forecast is already writing a sad letter.',
      () => 'Beautiful out there. Roll the window down. Do not roll it down near the geese.',
    ],
  },
  time: {
    morning: [
      () => 'Good morning, Waterloo Region. It is the morning rush: the Expressway is a parking lot with a speed limit.',
      () => 'Rise and shine. Coffee first, merging second. You know the order.',
    ],
    day: [() => 'Midday on The Goose. Somewhere a Tim Hortons is out of the good donut. We feel it too.'],
    evening: [
      () => 'Evening drive. Traffic is lighter, the geese are heavier. That is just their season.',
      () => 'The sun is going down on the Tri-Cities. Headlights on, folks.',
    ],
    night: [
      () => 'Late-night Goose. If you are out this late, it is either shift work, a good reason, or a bad idea. We support all three.',
      () => 'It is the overnight. Everything is closed except the all-night donut place and that one very bright gas station.',
    ],
  },
  wanted: [
    (c) => `Breaking news: W R P S are chasing a reckless driver near ${c.place}. ${c.wanted >= 3 ? 'Helicopters are up. ' : ''}If you are listening, sir, a polite suggestion: pull over.`,
    (c) => `We are getting reports of a pursuit around ${c.place}. Police advise you stay clear. We advise you stay tuned.`,
    (c) => `Traffic alert near ${c.place}: ${c.wanted} star${c.wanted > 1 ? 's' : ''} of attention from the Region's finest. Drive safe. Or at least drive interestingly.`,
  ],
  eggs: [
    (c) => `Someone has been finding golden eggs around town. That is ${num(c.eggs)} now. Whoever you are, the geese want a word.`,
    (c) => `Golden egg count: ${num(c.eggs)} of ${c.eggTotal}. The Goose is not saying where they are. The Goose does not know where they are. The geese are very upset.`,
  ],
  eggsNone: [
    () => 'Rumour has it there are golden eggs hidden all over Waterloo Region. Nobody has found one. That we know of. Look in the weird spots.',
  ],
  jj: [
    (c) => `J and J Cards and Collectibles on Weber Street says collectors are at ${c.jj} cards of the set. The Goose card is rumoured to be the rare one. Obviously.`,
    () => 'Trading card news: the line outside J and J Cards is long, and mostly adults. No judgement. Okay, a little judgement.',
  ],
  cal: {
    rday: [() => 'Today is Remembrance Day. A moment of silence at eleven, folks, and thank you to the veterans of our region.'],
    remembrance: [() => 'Remembrance week. Poppies out on the lapels across Waterloo Region. Lest we forget.'],
    market: [() => 'The Christmas Market is on in Kitchener. Mulled wine, lights on everything, and parking you will not find.'],
    christmas: [() => 'It is the holiday season in the Tri-Cities. Mind the ice and the in-laws.'],
    halloween: [() => 'Halloween season. If a pumpkin is in the road, it is probably a pumpkin. Probably.'],
    canada: [() => 'Happy Canada Day. Fireworks tonight over the region. The geese are, regrettably, in favour.'],
    oktoberfest: [
      () => 'It is Oktoberfest, the biggest Bavarian festival in Canada and we are the ones who throw it. Ein Prosit, Waterloo Region.',
      () => 'Oktoberfest traffic: expect delays near the festhalles, and one very confident man in lederhosen walking down the middle of the road.',
    ],
  },
  traffic: [
    (c) => `Traffic update: slow going on ${c.a}. ${c.b ? `Same story on ${c.b}.` : ''} Honestly, we have no idea why. We are a radio station.`,
    (c) => `Over to the Goose chopper. We do not have a chopper. We have a guy named Doug with a window. Doug says ${c.a} is moving, kind of.`,
    (c) => `A goose has stopped traffic on ${c.a}. It is not hurt. It is also not moving. It owns the road now.`,
    (c) => `Construction on ${c.a} again. The cones have formed a union.`,
  ],
  ads: [
    () => ['~Gord\'s Garage! University at Bridge in Waterloo. Honest work, honest prices, and a coffee that has been on since Tuesday.', '~Gord\'s Garage. We will look at it. We always look at it.'],
    () => ['~Tired of your mattress? So is your back. Kitchener Mattress Warehouse! Four acres of mattresses and one extremely tired salesman.', '~Kitchener Mattress Warehouse. Lie down on the job.'],
    () => ['~Captain Honk\'s Goose Repellent! Works on geese! Mostly on geese! Do not spray on people. Do not spray on geese you like.', '~Captain Honk\'s. Not responsible for what the geese say about you.'],
    () => ['~Is your basement flooded? Is it somebody else\'s fault? Call Grand River Sump and Pump. We bail. Literally.'],
    () => ['~Schnitzel Haus Express! Fast food, Bavarian style. Our drive-thru has a yodel button. Please do not press the yodel button.'],
    () => ['~Waterloo Region Plumbing and Pickles. Two things you did not know went together. Neither did we. We are pivoting.'],
  ],
  banter: [
    () => 'Fun fact: Waterloo Region has more roundabouts than patience. We are working on the patience.',
    () => 'This is The Goose, one oh one point nine. We play the hits, and also the other songs.',
    () => 'A listener writes in: why is the song so loud. The song is exactly as loud as the song is. Thank you for calling.',
    () => 'The Goose, your home for music, traffic, and the occasional urgent bulletin about a goose.',
    () => 'Shout out to the lady in the minivan on King Street who waved at us. We do not know you. We love you.',
    () => 'If you have ever been stuck behind a horse and buggy near St. Jacobs, you know patience. Be that patient. Be the buggy.',
  ],
};

/** The jingle: a four-note hook and a honk, played into the music bus. */
function ident(audio) {
  try {
    const ctx = audio.ctx, out = audio.musicBus;
    if (!ctx || !out) return;
    const t = audio.now() + 0.05;
    for (const [f, o] of [[392, 0], [494, 0.14], [587, 0.28], [784, 0.42]]) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + o);
      g.gain.exponentialRampToValueAtTime(0.09, t + o + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + o + 0.3);
      osc.connect(g).connect(out);
      osc.start(t + o); osc.stop(t + o + 0.35);
    }
    // the honk: a saw sliding down through a vocal band-pass, with a wobble
    const h = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    h.type = 'sawtooth'; h.frequency.setValueAtTime(520, t + 0.62); h.frequency.exponentialRampToValueAtTime(370, t + 1.0);
    bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 3;
    lfo.frequency.value = 38; lg.gain.value = 0.04; lfo.connect(lg).connect(g.gain);
    g.gain.setValueAtTime(0.0001, t + 0.62);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.68);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    h.connect(bp).connect(g).connect(out);
    h.start(t + 0.62); h.stop(t + 1.1); lfo.start(t + 0.62); lfo.stop(t + 1.1);
  } catch (e) { /* the voice still talks */ }
}

export class GooseFM {
  /**
   * @param audio  the Audio engine
   * @param ctx    () -> { paused, wanted, place, wxState, hour, eggs, eggTotal, jj, jjTotal, streets: [names], date? }
   */
  constructor(audio, ctx) {
    this.audio = audio; this.getCtx = ctx;
    this.on = false;            // tuned, in a car, un-paused: allowed to talk
    this.nextAt = 0; this.clock = 0;
    this.queue = []; this.speaking = false;
    this.log = [];              // [{kind, lines, at}] every segment started
    this.recent = [];
    this.seen = { wanted: 0, eggs: -1 };
    this.pending = null;        // a reactive segment kind waiting its turn
    this._voice = null;
    this._sim = 0;              // silent-segment countdown (no voice)
    this._tok = 0;
  }

  _ss() { try { return (typeof window !== 'undefined' && !window.__noSpeech && window.speechSynthesis) || null; } catch (e) { return null; } }

  _voiceFor() {
    if (this._voice) return this._voice;
    const ss = this._ss();
    const vs = (ss && ss.getVoices && ss.getVoices()) || [];
    if (!vs.length) return null;
    this._voice = vs.find((v) => /en[-_]CA/i.test(v.lang)) || vs.find((v) => /^en[-_](US|GB|AU)/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
    return this._voice;
  }

  /** Called every frame (and behind the pause) from main.js. */
  update(dt) {
    const a = this.audio;
    const mine = !!(a.stationIsGoose && a.stationIsGoose());
    if (!mine && !this.on) return;                     // untuned: nothing to do
    const c = mine ? this.getCtx() : null;
    const ok = !!(mine && c && a._inCar && a.musicOn && a.enabled && !c.paused
      && !(typeof document !== 'undefined' && document.hidden));
    if (!ok) { if (this.on) this.stop(); return; }
    if (!this.on) {                                    // just tuned in
      this.on = true; this.clock = 0; this.nextAt = 3.5;   // the ident, then a word
      this.pending = 'ident';
      this.seen.wanted = c.wanted; this.seen.eggs = c.eggs;
    }
    this.clock += dt;
    if (c.wanted > 0 && this.seen.wanted === 0) { this.pending = 'wanted'; this.nextAt = Math.min(this.nextAt, this.clock + 4); }
    if (c.eggs > this.seen.eggs && this.seen.eggs >= 0) { this.pending = this.pending || 'eggs'; this.nextAt = Math.min(this.nextAt, this.clock + 5); }
    this.seen.wanted = c.wanted; this.seen.eggs = c.eggs;
    if (this._sim > 0) { this._sim -= dt; if (this._sim <= 0) this._advance(); }
    if (!this.speaking && this.clock >= this.nextAt) this._segment(c);
  }

  stop() {
    this.on = false; this.speaking = false; this.queue.length = 0; this._sim = 0; this._tok++;
    this.pending = null;
    try { const ss = typeof window !== 'undefined' && window.speechSynthesis; if (ss) ss.cancel(); } catch (e) { /* ok */ }
    this._duck(false);
  }

  _duck(on) {
    try {
      const g = this.audio.musicDuck && this.audio.musicDuck.gain;
      if (!g) return;
      const t = this.audio.now();
      g.cancelScheduledValues(t);
      g.setTargetAtTime(on ? 0.28 : 1, t, on ? 0.12 : 0.5);
    } catch (e) { /* ok */ }
  }

  _calKey(c) {
    const d = c.date || calendarDate(), th = themesFor(d);
    if (d.getMonth() === 9 && d.getDate() >= 3 && d.getDate() <= 15) return 'oktoberfest';
    for (const k of ['rday', 'remembrance', 'market', 'halloween', 'christmas', 'canada']) if (th[k]) return k;
    return '';
  }

  _kind(c) {
    if (this.pending) { const k = this.pending; this.pending = null; return k === 'wanted' && c.wanted <= 0 ? 'banter' : k; }
    const w = { weather: 2, time: 1.4, traffic: c.streets && c.streets.length ? 2 : 0, ad: 3, banter: 1.4, eggs: c.eggs > 0 ? 1.2 : 0.8, jj: 0.8, cal: this._calKey(c) ? 2 : 0, wanted: c.wanted > 0 ? 3 : 0 };
    for (const k of this.recent) w[k] *= 0.15;
    let tot = 0; for (const k in w) tot += w[k];
    let r = Math.random() * tot;
    for (const k in w) { r -= w[k]; if (r <= 0 && w[k] > 0) return k; }
    return 'banter';
  }

  /** The lines of one segment of `kind` (also the probe's entry point). */
  compose(kind, c) {
    switch (kind) {
      case 'ident': return [pick(['This is The Goose, one oh one point nine. Waterloo Region\'s only station. Probably.', 'You are locked in to The Goose, one oh one point nine, the Tri-Cities\' home of the honk.'])];
      case 'weather': return [pick(BANK.weather[c.wxState] || BANK.weather.clear)(c)];
      case 'time': { const h = c.hour; return [pick(BANK.time[h >= 5 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'day' : h >= 17 && h < 22 ? 'evening' : 'night'])(c)]; }
      case 'wanted': return [pick(BANK.wanted)(c)];
      case 'eggs': return [pick(c.eggs > 0 ? BANK.eggs : BANK.eggsNone)(c)];
      case 'jj': return [pick(BANK.jj)(Object.assign({}, c, { jj: c.jj + ' of ' + c.jjTotal }))];
      case 'cal': return [pick(BANK.cal[this._calKey(c) || 'oktoberfest'])(c)];
      case 'traffic': {
        const s = c.streets || [], a = s.length ? pick(s) : 'King Street';
        const o = s.filter((x) => x !== a);
        return [pick(BANK.traffic)({ a, b: o.length ? pick(o) : '' })];
      }
      case 'ad': return [].concat(pick(BANK.ads)());
      default: return [pick(BANK.banter)()];
    }
  }

  _segment(c) {
    const kind = this._kind(c);
    const lines = this.compose(kind, c);
    this.recent.push(kind); if (this.recent.length > 3) this.recent.shift();
    this.log.push({ kind, lines: lines.slice(), at: this.clock });
    this.queue = lines.slice();
    this.speaking = true;
    this.nextAt = this.clock + (kind === 'ident' ? 9 + Math.random() * 8 : 60 + Math.random() * 90);
    if (kind === 'ident' || kind === 'ad') ident(this.audio);
    this._duck(true);
    this._advance();
  }

  _advance() {
    if (!this.on) return;
    const text = this.queue.shift();
    if (text == null) { this.speaking = false; this._sim = 0; this._duck(false); return; }
    const ad = text[0] === '~', body = ad ? text.slice(1) : text;
    const ss = this._ss();
    const tok = ++this._tok;
    if (!ss || typeof SpeechSynthesisUtterance === 'undefined') { this._sim = Math.max(2, body.length * 0.065); return; }
    try {
      const u = new SpeechSynthesisUtterance(body);
      const v = this._voiceFor();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-CA';
      u.rate = ad ? 1.12 : 1.02; u.pitch = ad ? 0.78 : 1.12; u.volume = 1;
      const next = () => { if (tok === this._tok && this.on) this._sim = 0.001; };
      u.onend = next; u.onerror = next;
      this._sim = 0;
      // a stalled engine must not strand the segment
      setTimeout(next, Math.max(6000, body.length * 130));
      ss.speak(u);
    } catch (e) { this._sim = 2; }
  }
}
