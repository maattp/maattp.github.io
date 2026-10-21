// The synthesised radio: a station's music when its stream is offline, dead
// or not there at all (Grand River FM and King St Radio have none).
//
// It used to be one loop for every station: a sawtooth bass on the root, a
// minor triad stab, a random pentatonic note on any eighth and kick, snare,
// hat -- the same four bars at another tempo in another waveform. Random
// notes on a grid is what made it sound silly: nothing repeated, so nothing
// was a tune.
//
// Now each station plays a STYLE, and every song is written as it starts: a
// key, a tempo, a verse and a chorus progression, a form (intro, verse,
// chorus, verse, chorus, bridge, chorus, outro), and a melody. The melody is
// a two-bar MOTIF -- a rhythm and a contour -- stated, restated over the next
// chords (its strong beats snapped to chord tones), varied, and closed on a
// long note: the way a tune is built, so it can be followed. The voices are
// the ones the genre would use: an overdriven guitar, a Rhodes, a walking
// upright bass and a ride, strings over a harp, a gated snare and a 16th
// arpeggio. They play into a tempo-synced delay and one compressor.
//
// Cost: each note is 2-6 short-lived nodes scheduled ~0.4 s ahead (each step
// is played as the scheduler reaches it, so a retune cuts in at once); the
// buses below are persistent, and connected to the music bus only while the
// radio plays (`quiet`). See guide/sound.md "The synth radio (v221)".

import { mulberry32 } from './util.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const mod7 = (i) => ((i % 7) + 7) % 7;

// The song's sections and their lengths in bars.
const FORM = [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['bridge', 4], ['chorus', 8], ['outro', 4]];
const JAZZ_FORM = [['intro', 4], ['verse', 8], ['verse', 8], ['chorus', 8], ['chorus', 8], ['verse', 8], ['outro', 4]];
const CALM_FORM = [['intro', 4], ['verse', 8], ['chorus', 8], ['bridge', 4], ['verse', 8], ['chorus', 8], ['outro', 4]];

/**
 * A style: tempo range, how often minor, progressions as scale degrees (0 =
 * I) for the verse, the chorus and the bridge, and the parts: drums, bass,
 * comping, lead. `sevenths` stacks a fourth chord tone; `swing` delays the
 * off-beat eighth (jazz) or sixteenth (`swing16`, lo-fi) by that share of a
 * beat. `lead` is the lead voice's register (MIDI of its tonic) and density.
 */
const STYLES = {
  // Radio Waterloo, Indie88, CBC Music: jangly indie rock
  indie: {
    tempo: [112, 132], minor: 0.35, form: FORM,
    maj: { verse: [[0, 4, 5, 3], [0, 3, 0, 4], [5, 3, 0, 4]], chorus: [[3, 0, 4, 5], [0, 4, 5, 3], [3, 4, 0, 0]], bridge: [[5, 3, 4, 4], [3, 4, 5, 4]] },
    min: { verse: [[0, 5, 2, 6], [0, 6, 5, 6]], chorus: [[5, 2, 6, 0], [2, 6, 0, 0]], bridge: [[3, 4, 5, 6]] },
    drums: 'rock', bass: 'eighths', comp: 'jangle', lead: 'clean', leadAt: 67, density: 0.55,
  },
  // RdMix Classic Rock, NRJ Linkin Park: drive, power chords
  rock: {
    tempo: [104, 138], minor: 0.55, form: FORM,
    maj: { verse: [[0, 6, 3, 0], [0, 3, 4, 3], [0, 4, 3, 3]], chorus: [[3, 0, 4, 4], [0, 4, 5, 3]], bridge: [[5, 4, 3, 4]] },
    min: { verse: [[0, 6, 5, 6], [0, 0, 5, 6], [0, 3, 6, 5]], chorus: [[5, 6, 0, 0], [2, 6, 3, 5]], bridge: [[3, 4, 5, 6]] },
    drums: 'rock', bass: 'eighths', comp: 'power', lead: 'drive', leadAt: 64, density: 0.5,
  },
  // BBC Radio 1, Top 100: chart pop
  pop: {
    tempo: [96, 122], minor: 0.3, form: FORM,
    maj: { verse: [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4]], chorus: [[3, 0, 4, 5], [0, 4, 5, 3]], bridge: [[5, 3, 0, 4], [1, 4, 0, 5]] },
    min: { verse: [[0, 5, 2, 6], [0, 3, 5, 4]], chorus: [[5, 2, 6, 0], [5, 6, 0, 0]], bridge: [[3, 4, 2, 5]] },
    drums: 'pop', bass: 'pop', comp: 'keys', lead: 'pluck', leadAt: 72, density: 0.6, sixteenths: true,
  },
  // CIUT, King St Radio: house
  house: {
    tempo: [120, 126], minor: 0.6, form: FORM,
    maj: { verse: [[0, 0, 3, 3], [0, 5, 3, 4]], chorus: [[3, 4, 5, 5], [0, 4, 5, 3]], bridge: [[1, 1, 4, 4]] },
    min: { verse: [[0, 0, 5, 6], [0, 3, 0, 3]], chorus: [[5, 6, 0, 0], [3, 6, 0, 0]], bridge: [[3, 3, 4, 4]] },
    drums: 'house', bass: 'offbeat', comp: 'stab', lead: 'pluck', leadAt: 72, density: 0.45, sixteenths: true,
  },
  // 80s Drive: synthwave
  synthwave: {
    tempo: [92, 112], minor: 0.75, form: FORM,
    maj: { verse: [[0, 5, 3, 4]], chorus: [[3, 4, 0, 5]], bridge: [[5, 3, 4, 4]] },
    min: { verse: [[0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 5, 6]], chorus: [[5, 6, 0, 0], [5, 2, 6, 0]], bridge: [[3, 5, 6, 6]] },
    drums: 'synthwave', bass: 'pulse', comp: 'arp', lead: 'synth', leadAt: 69, density: 0.45,
  },
  // JAZZ.FM91: small-group jazz, swung
  jazz: {
    tempo: [116, 152], minor: 0, form: JAZZ_FORM, sevenths: true, swing: 0.16,
    maj: { verse: [[1, 4, 0, 5], [0, 5, 1, 4], [2, 5, 1, 4]], chorus: [[3, 6, 2, 5], [1, 4, 0, 0]], bridge: [[3, 3, 2, 5]] },
    drums: 'jazz', bass: 'walk', comp: 'rhodes', lead: 'vibes', leadAt: 72, density: 0.6,
  },
  // The New Classical 96.3: strings over a harp
  classical: {
    tempo: [66, 84], minor: 0.4, form: CALM_FORM, harmonic: true,
    maj: { verse: [[0, 3, 4, 0], [0, 5, 1, 4], [0, 4, 5, 3]], chorus: [[3, 4, 0, 5], [5, 1, 4, 0]], bridge: [[5, 2, 3, 4]] },
    min: { verse: [[0, 3, 4, 0], [0, 5, 3, 4]], chorus: [[5, 3, 4, 0], [2, 5, 4, 0]], bridge: [[3, 4, 5, 4]] },
    drums: null, bass: 'cello', comp: 'harp', lead: 'violin', leadAt: 72, density: 0.5,
  },
  // Grand River FM, CKWR, CBC Radio One, 570 News: lo-fi, rainy
  lofi: {
    tempo: [70, 86], minor: 0.5, form: CALM_FORM, sevenths: true, swing16: 0.2, dorian: true,
    maj: { verse: [[0, 2, 5, 3], [3, 2, 1, 4], [0, 5, 1, 4]], chorus: [[3, 4, 2, 5], [1, 4, 0, 5]], bridge: [[3, 3, 2, 2]] },
    min: { verse: [[0, 3, 0, 3], [0, 6, 5, 4]], chorus: [[5, 6, 0, 3], [3, 4, 0, 0]], bridge: [[5, 5, 3, 3]] },
    drums: 'lofi', bass: 'lofi', comp: 'epiano', lead: 'bell', leadAt: 72, density: 0.35,
  },
};

/**
 * Drum patterns: per instrument, the bar's sixteenth steps that hit, and a
 * velocity for each (1 when omitted). `level` 1 is the verse, 2 the chorus;
 * a section at level 0 has no drums. Fills are added in `_barPlan`.
 */
const DRUMS = {
  rock: {
    1: { kick: [0, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
    2: { kick: [0, 3, 8, 10], snare: [4, 12], ohat: [0, 2, 4, 6, 8, 10, 12, 14] },
  },
  pop: {
    1: { kick: [0, 7, 8], clap: [4, 12], hat: [2, 6, 10, 14] },
    2: { kick: [0, 7, 8, 11], clap: [4, 12], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  },
  house: {
    1: { kick: [0, 4, 8, 12], hat: [2, 6, 10, 14] },
    2: { kick: [0, 4, 8, 12], clap: [4, 12], ohat: [2, 6, 10, 14], hat: [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15] },
  },
  synthwave: {
    1: { kick: [0, 8], gsnare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
    2: { kick: [0, 8, 10], gsnare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  },
  jazz: {
    // the ride's "ding, ding-a ding", the hat's foot on 2 and 4
    1: { ride: [0, 4, 6, 8, 12, 14], pedal: [4, 12], kick: [0, 8] },
    2: { ride: [0, 4, 6, 8, 12, 14], pedal: [4, 12], kick: [0, 8], brush: [6, 14] },
  },
  lofi: {
    1: { kick: [0, 10], rim: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
    2: { kick: [0, 7, 10], rim: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], shaker: [1, 3, 5, 7, 9, 11, 13, 15] },
  },
};
// how hard each step of a 16-step bar is played: beats, then eighths, then the rest
const ACCENT = [1, 0.55, 0.75, 0.55, 0.9, 0.55, 0.75, 0.55, 0.95, 0.55, 0.75, 0.55, 0.9, 0.55, 0.75, 0.6];

/**
 * What each section plays: drum level (0 none, 1 verse, 2 chorus), and
 * whether the bass, the comping, a pad and the lead come in.
 */
const ARRANGE = {
  intro: { drums: 1, bass: false, comp: true, pad: false, lead: false },
  verse: { drums: 1, bass: true, comp: true, pad: false, lead: true },
  chorus: { drums: 2, bass: true, comp: true, pad: true, lead: true },
  bridge: { drums: 0, bass: true, comp: false, pad: true, lead: false },
  outro: { drums: 1, bass: true, comp: true, pad: true, lead: false },
};

// ---------------------------------------------------------------------------
// Writing a song
// ---------------------------------------------------------------------------

/** A chord's tones on degree `d`, as scale indices (n = 3, or 4 with the 7th). */
const chordIdx = (d, n) => { const o = []; for (let k = 0; k < n; k++) o.push(d + 2 * k); return o; };

/**
 * A two-bar motif: onsets on the sixteenth grid with lengths, and a contour
 * (a step in scale degrees from the note before). The last few steps rest,
 * so a phrase breathes before the next one.
 */
function makeMotif(R, density, sixteenths, longer) {
  const notes = [];
  const end = 32 - (longer ? 8 : 6);
  for (let s = 0; s < end; s += 2) {
    const strong = s % 4 === 0;
    if (R() < (strong ? density + 0.2 : density - 0.12) || s === 0) {
      notes.push({ s, strong });
      if (sixteenths && !strong && R() < 0.25 && s + 1 < end) notes.push({ s: s + 1, strong: false });
    }
  }
  for (let i = 0; i < notes.length; i++) {
    const nx = i + 1 < notes.length ? notes[i + 1].s : end + 2;
    notes[i].len = Math.max(1, Math.min(nx - notes[i].s, longer ? 8 : 4));
    // stepwise mostly; a leap now and then, usually answered by a step back
    const r = R();
    notes[i].step = i === 0 ? 0 : r < 0.32 ? 1 : r < 0.64 ? -1 : r < 0.76 ? 2 : r < 0.88 ? -2 : r < 0.94 ? 0 : (R() < 0.5 ? 4 : -3);
  }
  return notes;
}

/** Realise a motif over two bars of chords: scale indices, strong beats on chord tones. */
function realise(motif, startIdx, chords, n7, lo, hi) {
  let p = startIdx;
  return motif.map((m) => {
    const d = chords[m.s < 16 ? 0 : 1];
    let q = p + m.step;
    if (q < lo) q += 2; else if (q > hi) q -= 2;
    if (m.strong) {
      // the nearest tone of the chord under it -- that keeps going the way
      // the contour went: snapping to the plain nearest pulled a rising step
      // straight back to the note before, and lines came out "7, 7, 7"
      const dir = Math.sign(m.step);
      let best = q, bd = 99;
      for (const c of chordIdx(d, n7)) {
        for (let o = -14; o <= 14; o += 7) {
          const x = c + o;
          if (x < lo - 1 || x > hi + 1) continue;
          const sc = Math.abs(x - q) + (dir && Math.sign(x - p) !== dir ? 3 : 0);
          if (sc < bd) { bd = sc; best = x; }
        }
      }
      q = best;
    }
    p = q;
    return { s: m.s, len: m.len, idx: q };
  });
}

/** Nearest scale index to `near` that is a tone of the chord on degree d. */
function chordToneNear(d, near, n7) {
  let best = near, bd = 99;
  for (const c of chordIdx(d, n7)) for (let o = -14; o <= 14; o += 7) {
    const x = c + o;
    if (Math.abs(x - near) < bd) { bd = Math.abs(x - near); best = x; }
  }
  return best;
}

/** Write a song in `style` near `root` (a MIDI note: its pitch class is the key centre). */
function writeSong(styleName, root, R) {
  const S = STYLES[styleName];
  const minor = !!S.min && R() < S.minor;
  const scale = minor ? (S.dorian ? DORIAN : MINOR) : MAJOR;
  const P = minor ? S.min : S.maj;
  const pick = (a) => a[Math.floor(R() * a.length)];
  const tonic = ((root % 12) + Math.floor(R() * 5) - 2 + 12) % 12;
  const tempo = Math.round(S.tempo[0] + R() * (S.tempo[1] - S.tempo[0]));
  const prog = { verse: pick(P.verse), chorus: pick(P.chorus), bridge: pick(P.bridge) };
  prog.intro = prog.verse;
  prog.outro = prog.chorus;
  const n7 = S.sevenths ? 4 : 3;
  const motif = {
    verse: makeMotif(R, S.density, !!S.sixteenths, false),
    chorus: makeMotif(R, S.density + 0.12, !!S.sixteenths, true),
  };
  // every bar: its section, chord, position in the section, the lead's notes
  const bars = [];
  for (const [sec, len] of S.form) {
    const pr = prog[sec];
    for (let b = 0; b < len; b++) {
      let d = pr[b % 4];
      if (sec === 'outro' && b >= len - 2) d = 0;      // home
      bars.push({ sec, d, b, len });
    }
  }
  bars[bars.length - 1].last = true;
  // the lead, a section at a time: A, A over the next chords, A varied, then a cadence
  const lo = 3, hi = 12;
  let i = 0;
  for (const [sec, len] of S.form) {
    if (ARRANGE[sec].lead && (sec === 'verse' || sec === 'chorus')) {
      const m = motif[sec];
      const varied = m.map((x) => ({ ...x, step: R() < 0.3 ? x.step + (R() < 0.5 ? 1 : -1) : x.step }));
      let start = sec === 'chorus' ? 9 : 7;
      for (let ph = 0; ph < len; ph += 2) {
        const ch = [bars[i + ph].d, bars[i + ph + 1].d];
        const mm = ph === 4 ? varied : m;
        let notes = realise(mm, chordToneNear(ch[0], start, n7) - mm[0].step, ch, n7, lo, hi);
        if (ph === len - 2) {
          // the phrase's answer: its first bar, then a long chord tone
          notes = notes.filter((n) => n.s < 16);
          const last = notes.length ? notes[notes.length - 1].idx : start;
          notes.push({ s: 16, len: 12, idx: chordToneNear(ch[1], last, 3) });
        }
        for (const n of notes) {
          const bar = bars[i + ph + (n.s >= 16 ? 1 : 0)];
          (bar.lead || (bar.lead = [])).push({ s: n.s % 16, len: n.len, idx: n.idx });
        }
        start = notes.length ? notes[0].idx : start;
      }
    }
    i += len;
  }
  return { style: styleName, S, scale, minor, tonic, tempo, n7, bars, drum: DRUMS[S.drums] || null };
}

// ---------------------------------------------------------------------------
// The radio
// ---------------------------------------------------------------------------

export class SynthRadio {
  /**
   * @param ctx    the AudioContext
   * @param out    where the radio plays (Audio.musicBus)
   * @param noise  a white-noise AudioBuffer (the drums' source)
   */
  constructor(ctx, out, noise) {
    this.ctx = ctx; this.out = out; this.noise = noise;
    const c = ctx;
    // master: everything -> a gentle compressor -> out
    this.master = c.createGain();
    this.master.gain.value = 0.62;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -20; this.comp.knee.value = 12; this.comp.ratio.value = 3;
    this.comp.attack.value = 0.008; this.comp.release.value = 0.22;
    // and a trim after it, to the old radio's level in the mix: rendered
    // offline (audiorender radio-*) the old one read -45 dB RMS over 40 s,
    // ~-42 while it sounded; the styles read -39 to -42
    this.trim = c.createGain();
    this.trim.gain.value = 0.36;
    this.master.connect(this.comp).connect(this.trim);
    this.linked = false;
    // the space: a dotted-eighth feedback delay, darkened on each repeat
    this.dIn = c.createGain();
    this.delay = c.createDelay(2);
    this.dFb = c.createGain(); this.dFb.gain.value = 0.32;
    this.dLp = c.createBiquadFilter(); this.dLp.type = 'lowpass'; this.dLp.frequency.value = 2400;
    this.dOut = c.createGain(); this.dOut.gain.value = 0.5;
    this.dIn.connect(this.delay).connect(this.dLp).connect(this.dFb).connect(this.delay);
    this.dLp.connect(this.dOut).connect(this.master);
    // an overdriven amp (the rock guitar's): a soft clipper, then a speaker cabinet
    this.amp = c.createWaveShaper();
    const N = 1024, curve = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; curve[i] = Math.tanh(x * 6) / Math.tanh(6); }
    this.amp.curve = curve;
    this.ampIn = c.createGain(); this.ampIn.gain.value = 1.6;
    this.cab = c.createBiquadFilter(); this.cab.type = 'lowpass'; this.cab.frequency.value = 3000; this.cab.Q.value = 0.9;
    this.cabHp = c.createBiquadFilter(); this.cabHp.type = 'highpass'; this.cabHp.frequency.value = 110;
    this.ampOut = c.createGain(); this.ampOut.gain.value = 0.16;
    this.ampIn.connect(this.amp).connect(this.cabHp).connect(this.cab).connect(this.ampOut);
    // instrument buses: level, place in the stereo field, delay send
    const bus = (lvl, pan, send) => {
      const g = c.createGain(); g.gain.value = lvl;
      const p = c.createStereoPanner ? c.createStereoPanner() : null;
      if (p) { p.pan.value = pan; g.connect(p).connect(this.master); } else g.connect(this.master);
      if (send) { const s = c.createGain(); s.gain.value = send; g.connect(s).connect(this.dIn); }
      return g;
    };
    this.bus = {
      drums: bus(1, 0, 0.04),
      bass: bus(1, 0, 0),
      comp: bus(1, -0.28, 0.16),
      pad: bus(1, 0.12, 0.22),
      lead: bus(1, 0.1, 0.3),
      arp: bus(1, 0.32, 0.38),
    };
    this.ampOut.connect(this.bus.comp);
    this.station = null;
    this.song = null;
    this.next = 0;
    this.quietAt = null;
  }

  /** Connect the radio to the music bus (it costs the audio thread only while linked). */
  _link(on) {
    if (on === this.linked) return;
    this.linked = on;
    if (on) this.trim.connect(this.out); else this.trim.disconnect();
  }

  /**
   * Schedule what falls in the next 0.4 s. `station` is the STATIONS entry
   * playing; a new one starts a song of its style part-way through, the way
   * tuning in lands mid-song.
   */
  schedule(station, now) {
    this._link(true);
    if (station !== this.station || this.quietAt != null) {
      this.station = station;
      this.quietAt = null;
      this._newSong(now, true);
    }
    // Steps missed while the context was suspended (or nothing scheduled)
    // are SKIPPED, not played at once in a burst.
    if (this.next < now - 0.1) this.next = now + 0.05;
    while (this.next < now + 0.4) {
      const song = this.song;
      if (this.rest > 0) { this.rest--; this.next += song.step; if (!this.rest) this._newSong(this.next, false); continue; }
      const bar = song.bars[this.bar];
      if (this.s === 0) this.plan = this._barPlan(song, this.bar);
      for (const ev of this.plan[this.s]) this._play(ev, this._at(song, this.s, this.next), song);
      this.next += song.step;
      if (++this.s === 16) {
        this.s = 0;
        if (bar.last) { this.rest = 24; this.bar = 0; }     // a breath between songs
        else this.bar++;
      }
    }
  }

  /** The radio has gone quiet (out of the car, a live stream took over): unlink once the tails are gone. */
  quiet(now, keepLinked) {
    if (this.quietAt == null) this.quietAt = now;
    else if (!keepLinked && now - this.quietAt > 4) this._link(false);
  }

  _newSong(t, midway) {
    const st = this.station;
    const R = mulberry32((Math.random() * 4294967296) >>> 0);
    const song = this.song = writeSong(st.style || 'pop', st.root || 57, R);
    song.step = 60 / song.tempo / 4;
    // the delay at a dotted eighth
    this.delay.delayTime.setValueAtTime(Math.min(1.9, song.step * 3), Math.max(0, t));
    this.s = 0;
    this.rest = 0;
    // tuning in: anywhere in the first two thirds, on a section's first bar
    this.bar = 0;
    if (midway) {
      const starts = [];
      song.bars.forEach((b, i) => { if (b.b === 0 && i < song.bars.length * 0.67) starts.push(i); });
      this.bar = starts[Math.floor(Math.random() * starts.length)] || 0;
    }
    this.next = t + 0.05;
  }

  /** When step s of a bar sounds: swung eighths or sixteenths, a few ms of hands. */
  _at(song, s, t) {
    const S = song.S, beat = song.step * 4;
    if (S.swing && s % 4 === 2) t += S.swing * beat;
    if (S.swing16 && s % 2 === 1) t += S.swing16 * song.step;
    return t + (Math.random() - 0.5) * 0.008;
  }

  /** The events of one bar, by step: [{ v: voice, ...args }]. */
  _barPlan(song, bi) {
    const R = Math.random;
    const plan = Array.from({ length: 16 }, () => []);
    const bar = song.bars[bi], A = ARRANGE[bar.sec], S = song.S;
    const next = song.bars[bi + 1] || song.bars[0];
    // pitch class of a scale index under this bar's chord; a pitch class put
    // in the octave from `lo` (so a part keeps its register whatever the key)
    const pcOf = (idx, d = bar.d) => (song.tonic + song.scale[mod7(idx)] + this._raise(song, d, idx)) % 12;
    const inWin = (pc, lo) => lo + (((pc - lo) % 12) + 12) % 12;
    const chord = chordIdx(bar.d, song.n7);
    const fillBar = bar.b === bar.len - 1 && !bar.last;

    // DRUMS
    if (song.drum && A.drums) {
      let lvl = A.drums;
      if (bar.sec === 'outro' && bar.b >= bar.len - 2) lvl = 1;
      const pat = song.drum[lvl];
      for (const k in pat) for (const s of pat[k]) {
        if (fillBar && s >= 12 && (k === 'snare' || k === 'gsnare' || k === 'clap' || k === 'rim')) continue;
        plan[s].push({ v: 'drum', k, vel: ACCENT[s] * (0.9 + R() * 0.15) });
      }
      // a ghost note or two, so a groove is not a metronome
      if (S.drums === 'rock' || S.drums === 'pop' || S.drums === 'lofi') {
        for (const s of [7, 10, 15]) if (R() < 0.25) plan[s].push({ v: 'drum', k: S.drums === 'lofi' ? 'rim' : 'snare', vel: 0.25 });
      }
      if (S.drums === 'jazz') {
        // the snare comps, quietly, wherever it likes
        for (let s = 2; s < 16; s += 4) if (R() < 0.3) plan[s].push({ v: 'drum', k: 'brush', vel: 0.35 + R() * 0.3 });
      }
      if (bar.b === 0 && (bar.sec === 'chorus' || (bar.sec === 'verse' && bi > 4)) && S.drums !== 'lofi') plan[0].push({ v: 'drum', k: S.drums === 'jazz' ? 'ride' : 'crash', vel: 1 });
      if (fillBar && lvl > 0 && S.drums !== 'jazz' && S.drums !== 'lofi') {
        const k = S.drums === 'synthwave' ? 'tom' : 'snare';
        for (let s = 12; s < 16; s++) plan[s].push({ v: 'drum', k, vel: 0.55 + (s - 12) * 0.15, tone: 16 - s });
      }
    }

    // BASS: the root between C2 and B2
    if (A.bass && S.bass) {
      const r = inWin(pcOf(bar.d), 36), f5 = inWin(pcOf(bar.d + 4), r), oct = r + 12;
      const nr = inWin(pcOf(next.d, next.d), r - 5);
      const B = (s, m, len, vel = 1) => plan[s].push({ v: 'bass', kind: S.bass, m, len, vel });
      switch (S.bass) {
        case 'eighths': for (let s = 0; s < 16; s += 2) B(s, s === 14 && R() < 0.4 ? f5 : r, 1.7, ACCENT[s]); break;
        case 'pop': B(0, r, 3); B(3, r, 2, 0.7); B(6, r, 2, 0.8); B(8, r, 3); B(10, oct, 2, 0.7); B(14, R() < 0.5 ? f5 : r, 2, 0.75); break;
        case 'offbeat': for (const s of [2, 6, 10, 14]) B(s, s === 14 && R() < 0.3 ? oct : r, 1.6); break;
        case 'pulse': for (let s = 0; s < 16; s++) B(s, s % 8 === 6 && R() < 0.3 ? oct : r, 0.9, s % 4 === 0 ? 1 : 0.7); break;
        case 'walk': {
          // root, two chord or scale tones, and a chromatic step onto the next root
          const t2 = inWin(pcOf(bar.d + (R() < 0.5 ? 2 : 4)), r), t3 = inWin(pcOf(bar.d + (R() < 0.5 ? 4 : 5)), r);
          const ap = nr + (R() < 0.5 ? 1 : -1);
          B(0, r, 3.6); B(4, t2, 3.6, 0.85); B(8, t3, 3.6, 0.9); B(12, ap, 3.6, 0.85);
          break;
        }
        case 'cello': B(0, r, 7.6); B(8, R() < 0.5 ? f5 : r, 7.6, 0.85); break;
        case 'lofi': B(0, r, 9); B(10, R() < 0.5 ? f5 : oct, 4, 0.7); break;
      }
    }

    // COMPING: the chord in close position inside the octave from `base`,
    // which voice-leads by itself (the next chord's tones land near these)
    const voicing = (base) => chord.map((i) => inWin(pcOf(i), base)).sort((a, b) => a - b);
    if (A.comp && S.comp) {
      const notes = voicing(53);
      const C = (s, len, vel = 1, strum = 0) => plan[s].push({ v: 'comp', kind: S.comp, notes, len, vel, strum });
      switch (S.comp) {
        case 'jangle': for (const s of [0, 3, 6, 8, 11, 14]) C(s, 2.5, ACCENT[s], 0.012); break;
        case 'power': {
          const r = inWin(pcOf(bar.d), 40);
          const pc = [r, r + 7, r + 12];
          if (bar.sec === 'chorus') { plan[0].push({ v: 'comp', kind: 'power', notes: pc, len: 7.5, vel: 1 }); plan[8].push({ v: 'comp', kind: 'power', notes: pc, len: 7.5, vel: 0.9 }); }
          else for (let s = 0; s < 16; s += 2) plan[s].push({ v: 'comp', kind: 'mute', notes: pc, len: 1.2, vel: ACCENT[s] });
          break;
        }
        case 'keys': for (const s of [0, 6, 10]) C(s, s === 0 ? 5.5 : 3.5, s === 0 ? 1 : 0.8); break;
        case 'stab': for (const s of [3, 6, 11, 14]) C(s, 1.2, s === 3 || s === 11 ? 1 : 0.8); break;
        case 'arp': {
          const up = notes.concat(notes.map((m) => m + 12));
          for (let s = 0; s < 16; s++) plan[s].push({ v: 'arp', m: up[s % up.length], len: 0.9, vel: ACCENT[s] });
          break;
        }
        case 'rhodes': {
          // shell voicing (3rd, 7th, 9th), on a Charleston or a push
          const shell = [bar.d + 2, bar.d + 6, bar.d + 8].map((i) => inWin(pcOf(i), 52)).sort((a, b) => a - b);
          const rh = [[0, 6], [2, 10], [0, 10], [6, 14]][Math.floor(R() * 4)];
          for (const s of rh) plan[s].push({ v: 'comp', kind: 'rhodes', notes: shell, len: s === rh[0] ? 3 : 2, vel: 0.9 });
          break;
        }
        case 'harp': {
          // broken chords, low-high-mid-high
          const lo = voicing(48), seq = [lo[0], lo[2], lo[1], lo[2], lo[0] + 12, lo[2], lo[1], lo[2]];
          for (let s = 0; s < 16; s += 2) plan[s].push({ v: 'comp', kind: 'harp', notes: [seq[s / 2]], len: 4, vel: s % 8 === 0 ? 1 : 0.75 });
          break;
        }
        case 'epiano': C(0, 10, 0.9, 0.035); if (R() < 0.5) C(10, 5, 0.6, 0.03); break;
      }
    }
    // PAD: the chord held, a slow swell (chorus, bridge, outro; the strings under a classical piece)
    if ((A.pad || S.comp === 'harp' || S.comp === 'arp') && S.comp !== 'power') {
      plan[0].push({ v: 'pad', notes: voicing(S.comp === 'harp' ? 55 : 57), len: bar.last ? 30 : 16, vel: A.pad ? 1 : 0.6, strings: S.comp === 'harp' });
    }
    // LEAD
    if (A.lead && bar.lead) {
      // the lead's tonic within a fifth of `leadAt`, an octave under it (its notes run idx 3-12)
      const base = S.leadAt - 12 + (song.tonic > 5 ? song.tonic - 12 : song.tonic);
      for (const n of bar.lead) {
        const m = base + Math.floor(n.idx / 7) * 12 + song.scale[mod7(n.idx)] + this._raise(song, bar.d, n.idx);
        plan[n.s].push({ v: 'lead', kind: S.lead, m, len: n.len, vel: n.s % 4 === 0 ? 1 : 0.8 });
      }
    }
    return plan;
  }

  /** Harmonic minor's raised leading tone in a classical V chord. */
  _raise(song, d, idx) {
    return song.S.harmonic && song.minor && mod7(d) === 4 && mod7(idx) === 6 ? 1 : 0;
  }

  // -------------------------------------------------------------------------
  // The voices. Each is a handful of nodes that live for one note.
  // -------------------------------------------------------------------------

  _play(ev, t, song) {
    const step = song.step;
    switch (ev.v) {
      case 'drum': this._drum(ev.k, t, ev.vel, ev.tone); break;
      case 'bass': this._bass(ev.kind, ev.m, t, ev.len * step, ev.vel); break;
      case 'comp': ev.notes.forEach((m, i) => this._comp(ev.kind, m, t + i * (ev.strum || 0), ev.len * step, ev.vel)); break;
      case 'arp': this._pluck(this.bus.arp, ev.m, t, ev.len * step, 0.05 * ev.vel, 'sawtooth', 3200, 500, 0.12); break;
      case 'pad': for (const m of ev.notes) this._pad(m, t, ev.len * step, ev.vel, ev.strings); break;
      case 'lead': this._lead(ev.kind, ev.m, t, ev.len * step, ev.vel); break;
    }
  }

  _osc(type, f, t) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    return o;
  }

  /** gain envelope: attack to `peak`, decay toward `sus` with time-constant `dec`, release at t + dur */
  _env(t, peak, a, dec, sus, dur, rel) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (sus < peak) g.gain.setTargetAtTime(sus, t + a, dec);
    g.gain.setTargetAtTime(0, t + Math.max(a, dur), rel);
    return g;
  }

  _lp(f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = q; return b; }

  _noise(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * Math.max(0, this.noise.duration - dur - 0.05));
    s.stop(t + dur);
    return s;
  }

  _drum(k, t, vel, tone) {
    const c = this.ctx, out = this.bus.drums;
    if (k === 'kick') {
      const soft = this.song.S.drums === 'jazz' ? 0.35 : this.song.S.drums === 'lofi' ? 0.75 : 1;
      const o = this._osc('sine', 155, t);
      o.frequency.exponentialRampToValueAtTime(47, t + 0.09);
      const g = this._env(t, 0.9 * vel * soft, 0.002, 0.11, 0, 0.002, 0.11);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.5);
      return;
    }
    if (k === 'tom') {
      const f = 90 + tone * 22;
      const o = this._osc('sine', f * 1.6, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
      const g = this._env(t, 0.5 * vel, 0.002, 0.14, 0, 0.002, 0.14);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.6);
      return;
    }
    // noise voices: [filter type, frequency, Q, peak, decay time-constant]
    const N = {
      snare: ['bandpass', 1900, 0.6, 0.42, 0.055],
      gsnare: ['bandpass', 1500, 0.5, 0.5, 0.12],        // the big 80s snare
      clap: ['bandpass', 1300, 1.2, 0.45, 0.05],
      rim: ['bandpass', 2600, 2.5, 0.22, 0.025],
      brush: ['bandpass', 3200, 0.5, 0.12, 0.06],
      hat: ['highpass', 7500, 0.7, 0.13, 0.014],
      ohat: ['highpass', 7000, 0.7, 0.12, 0.09],
      pedal: ['highpass', 6500, 0.7, 0.07, 0.02],
      shaker: ['highpass', 6000, 0.7, 0.05, 0.02],
      ride: ['bandpass', 5800, 1.4, 0.1, 0.3],
      crash: ['highpass', 4500, 0.6, 0.2, 0.55],
    }[k];
    if (!N) return;
    const dur = N[4] * 6;
    const src = this._noise(t, dur);
    const f = c.createBiquadFilter(); f.type = N[0]; f.frequency.value = N[1]; f.Q.value = N[2];
    const g = c.createGain();
    if (k === 'clap') {
      // three hands a few ms apart, then the tail
      g.gain.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(N[3] * vel, t + i * 0.011); g.gain.setTargetAtTime(0.05, t + i * 0.011 + 0.002, 0.004); }
      g.gain.setValueAtTime(N[3] * vel * 0.8, t + 0.034);
      g.gain.setTargetAtTime(0, t + 0.034, N[4]);
    } else {
      g.gain.setValueAtTime(N[3] * vel, t);
      g.gain.setTargetAtTime(0, t + 0.001, N[4]);
    }
    src.connect(f).connect(g).connect(out);
    if (k === 'snare' || k === 'gsnare') {
      // the drum's body under the wires
      const o = this._osc('triangle', 190, t);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
      const og = this._env(t, 0.3 * vel, 0.001, 0.035, 0, 0.001, 0.035);
      o.connect(og).connect(out); o.start(t); o.stop(t + 0.25);
    }
  }

  _bass(kind, m, t, dur, vel) {
    const f = hz(m), out = this.bus.bass;
    if (kind === 'walk' || kind === 'cello' || kind === 'lofi') {
      // an upright (round, plucked, fading), a cello section (bowed), a sine under lo-fi keys
      const bowed = kind === 'cello';
      const o = this._osc(bowed ? 'sawtooth' : 'triangle', f, t);
      const s = this._osc('sine', f, t);
      const lp = this._lp(bowed ? 650 : kind === 'lofi' ? 380 : 900);
      const g = this._env(t, (bowed ? 0.16 : 0.3) * vel, bowed ? 0.09 : 0.006, bowed ? 0.6 : 0.35, bowed ? 0.13 * vel : 0.05, dur, bowed ? 0.18 : 0.06);
      o.connect(lp); s.connect(lp); lp.connect(g).connect(out);
      o.start(t); s.start(t); o.stop(t + dur + 1); s.stop(t + dur + 1);
      return;
    }
    // a synth bass: saw through a filter that snaps shut, a sine an octave down for weight
    const o = this._osc('sawtooth', f, t);
    const sub = this._osc('sine', f / 2, t);
    const lp = this._lp(kind === 'pulse' ? 900 : 1200, 4);
    lp.frequency.setValueAtTime(kind === 'pulse' ? 900 : 1300, t);
    lp.frequency.setTargetAtTime(kind === 'pulse' ? 260 : 320, t, 0.06);
    const g = this._env(t, 0.2 * vel, 0.004, 0.2, 0.13 * vel, dur, 0.03);
    const sg = this._env(t, 0.22 * vel, 0.004, 0.3, 0.18 * vel, dur, 0.03);
    o.connect(lp).connect(g).connect(out);
    sub.connect(sg).connect(out);
    o.start(t); sub.start(t); o.stop(t + dur + 0.3); sub.stop(t + dur + 0.3);
  }

  _comp(kind, m, t, dur, vel) {
    const out = this.bus.comp;
    switch (kind) {
      case 'jangle': this._pluck(out, m, t, dur, 0.05 * vel, 'sawtooth', 3600, 900, 0.18); break;
      case 'keys': this._fm(out, m, t, dur, 0.07 * vel, 1, 1.2, 0.5, 1.4); break;
      case 'rhodes': this._fm(out, m, t, dur, 0.065 * vel, 1, 2.2, 0.35, 1.6); break;
      case 'epiano': this._fm(out, m, t, dur, 0.06 * vel, 1, 1.6, 0.6, 2.2); break;
      case 'harp': this._pluck(out, m, t, dur, 0.09 * vel, 'triangle', 2400, 700, 0.5); break;
      case 'stab': this._pluck(out, m, t, dur, 0.06 * vel, 'sawtooth', 2600, 600, 0.09); break;
      case 'power': case 'mute': {
        // into the amp: two slightly detuned saws per string; a palm mute is short and dark
        const mute = kind === 'mute';
        const o = this._osc('sawtooth', hz(m), t), o2 = this._osc('sawtooth', hz(m) * 1.003, t);
        const lp = this._lp(mute ? 900 : 4000);
        const g = this._env(t, 0.22 * vel, 0.003, mute ? 0.06 : 1.2, mute ? 0 : 0.14 * vel, dur, 0.05);
        o.connect(lp); o2.connect(lp); lp.connect(g).connect(this.ampIn);
        o.start(t); o2.start(t); o.stop(t + dur + 0.4); o2.stop(t + dur + 0.4);
        break;
      }
    }
  }

  /** A plucked string or synth pluck: a filter that closes as it rings. */
  _pluck(out, m, t, dur, peak, type, f0, f1, decay) {
    const o = this._osc(type, hz(m), t);
    const lp = this._lp(f0, 1);
    lp.frequency.setValueAtTime(f0, t);
    lp.frequency.setTargetAtTime(f1, t, decay * 0.5);
    const g = this._env(t, peak, 0.003, decay, 0, dur, 0.05);
    o.connect(lp).connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.5);
  }

  /** Two-operator FM: an electric piano (ratio 1), a vibraphone or bell (ratio 4 / 3.5). */
  _fm(out, m, t, dur, peak, ratio, index, idxDecay, decay) {
    const f = hz(m);
    const car = this._osc('sine', f, t), mod = this._osc('sine', f * ratio, t);
    const mi = this.ctx.createGain();
    mi.gain.setValueAtTime(f * index, t);
    mi.gain.setTargetAtTime(f * index * 0.12, t, idxDecay);
    mod.connect(mi).connect(car.frequency);
    const g = this._env(t, peak, 0.004, decay, 0, dur, 0.12);
    car.connect(g).connect(out);
    car.start(t); mod.start(t); car.stop(t + dur + 0.8); mod.stop(t + dur + 0.8);
  }

  _pad(m, t, dur, vel, strings) {
    const f = hz(m);
    const a = this._osc('sawtooth', f, t), b = this._osc('sawtooth', f, t);
    a.detune.setValueAtTime(-7, t); b.detune.setValueAtTime(7, t);
    const lp = this._lp(strings ? 1700 : 1100);
    const g = this._env(t, 0.03 * vel, strings ? 0.35 : 0.5, 1, 0.03 * vel, dur, 0.45);
    a.connect(lp); b.connect(lp); lp.connect(g).connect(this.bus.pad);
    a.start(t); b.start(t); a.stop(t + dur + 2.5); b.stop(t + dur + 2.5);
  }

  _lead(kind, m, t, dur, vel) {
    const out = this.bus.lead;
    switch (kind) {
      case 'clean': this._pluck(out, m, t, dur, 0.09 * vel, 'sawtooth', 3000, 1100, 0.35); return;
      case 'pluck': this._fm(out, m, t, dur, 0.08 * vel, 2, 0.9, 0.2, 0.6); return;
      case 'vibes': this._fm(out, m, t, dur, 0.09 * vel, 4, 0.5, 0.15, 1.1); return;
      case 'bell': this._fm(out, m, t, dur, 0.06 * vel, 3.5, 0.6, 0.25, 1.2); return;
    }
    // sustained voices with vibrato: an overdriven guitar, a synth lead, a violin
    const drive = kind === 'drive', violin = kind === 'violin';
    const f = hz(m);
    const o = this._osc('sawtooth', f, t);
    const o2 = this._osc(violin ? 'sawtooth' : 'square', f, t);
    o2.detune.setValueAtTime(violin ? 6 : -5, t);
    const vib = this._osc('sine', violin ? 5.6 : 5.2, t);
    const vd = this.ctx.createGain();
    vd.gain.setValueAtTime(0, t);
    vd.gain.linearRampToValueAtTime(violin ? 14 : 10, t + Math.min(0.5, dur * 0.6));
    vib.connect(vd); vd.connect(o.detune); vd.connect(o2.detune);
    const lp = this._lp(violin ? 2600 : drive ? 2400 : 2200, violin ? 1.5 : 1);
    const peak = (drive ? 0.12 : violin ? 0.05 : 0.055) * vel;
    const g = this._env(t, peak, violin ? 0.07 : 0.01, 0.4, peak * (violin ? 0.95 : 0.75), dur, violin ? 0.15 : 0.08);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(drive ? this.ampIn : out);
    const end = t + dur + 1;
    o.start(t); o2.start(t); vib.start(t); o.stop(end); o2.stop(end); vib.stop(end);
  }
}

export const RADIO_STYLES = Object.keys(STYLES);
