// All sound is synthesised with the Web Audio API -- no audio files to ship.
//
// Three layers, each built for what it has to cost:
//
//   ONE-SHOTS  (crashes, gunshots, doors, footsteps, cash, stings...) are
//              recipes rendered ONCE into AudioBuffers by an OfflineAudioContext
//              when the context is first unlocked (`renderBank`). Playing one
//              is a BufferSource + a gain (+ a panner when it has a position),
//              so a crash costs three nodes however elaborate the recipe was.
//   CONTINUOUS (engines, tyres, wind, sirens, horn, traffic, the police
//              helicopter) are persistent node graphs built once and steered
//              every frame through AudioParams -- nothing is allocated per
//              frame. Idle ones are DISCONNECTED from the mix, which is what
//              stops the audio thread rendering them (see `Tap`).
//   THE RADIO  the live KEXP stream and the synthesised stations, unchanged in
//              behaviour, now under a ducker so a big hit cuts through it.
//
// Everything runs into one limiter before the volume control, so nothing the
// mix can do clips.
//
// Headless Chrome cannot hear and its AudioContext never leaves `suspended`
// without a gesture, so `tools/audiorender.mjs` drives THIS class against an
// OfflineAudioContext (`init(ctx)` + `_simT`) and writes WAVs to docs/audio/.

import { clamp, lerp, mulberry32 } from './util.js';

// Idle voices are disconnected so the audio thread stops rendering them. An
// offline preview schedules the whole script BEFORE it renders, and a graph
// change is not a scheduled event -- the last one would win for the entire
// file -- so previews keep everything linked and let the gains do the work.
let keepLinked = false;

/**
 * setTargetAtTime, skipped when the value has not really moved. A frame steers
 * ~50 params; most hold still (a voice at a steady speed, a siren's level), and
 * every automation call is a trip into the audio engine with a lock, which on
 * the phone is main-thread time. The last target rides on the param itself, so
 * a param must be driven ONLY through here once it is.
 */
function setp(param, v, t, tc) {
  const last = param._lv;
  if (last !== undefined && Math.abs(v - last) <= Math.abs(last) * 0.005 + 1e-5) return;
  param._lv = v;
  param.setTargetAtTime(v, t, tc);
}

// ---------------------------------------------------------------------------
// Small DSP helpers
// ---------------------------------------------------------------------------

function fillNoise(d, kind, seed) {
  const R = mulberry32(seed);
  if (kind === 'white') {
    for (let i = 0; i < d.length; i++) d[i] = R() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's economy pink filter.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = R() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
  } else {
    // brown: integrated white, leaky so it cannot drift.
    let y = 0;
    for (let i = 0; i < d.length; i++) {
      y = y * 0.985 + (R() * 2 - 1) * 0.15;
      d[i] = y * 1.6;
    }
  }
  return d;
}

function noiseBuffer(c, seconds, kind = 'white', seed = 1) {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  fillNoise(b.getChannelData(0), kind, seed);
  return b;
}

let _tanhCurves = {};
function tanhCurve(k) {
  if (_tanhCurves[k]) return _tanhCurves[k];
  const n = 1024, a = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    a[i] = Math.tanh(k * x) / norm;
  }
  return (_tanhCurves[k] = a);
}

/** Street/tunnel reverb: early reflections plus a tail that darkens as it decays. */
function makeImpulse(c, seconds = 1.1, seed = 7) {
  const sr = c.sampleRate, len = Math.floor(sr * seconds);
  const ir = c.createBuffer(2, len, sr);
  const taps = [0.011, 0.017, 0.026, 0.034, 0.047, 0.061, 0.083, 0.104];
  for (let ch = 0; ch < 2; ch++) {
    const R = mulberry32(seed + ch * 101);
    const d = ir.getChannelData(ch);
    const tau = seconds / 6.9;
    let y = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      // one-pole low-pass whose cutoff falls with time: air eats the top first
      const a = 0.85 * Math.exp(-t / (seconds * 0.35)) + 0.08;
      y += a * ((R() * 2 - 1) - y);
      d[i] = y * Math.exp(-t / tau) * (t < 0.02 ? t / 0.02 : 1) * 0.5;
    }
    for (let k = 0; k < taps.length; k++) {
      const i = Math.floor((taps[k] + (ch ? 0.0031 * (k % 3) : 0)) * sr);
      if (i < len) d[i] += (k % 2 ? -1 : 1) * 0.55 * Math.exp(-k * 0.28);
    }
  }
  return ir;
}

/** Linear crossfade of a buffer's tail into its head, so it loops seamlessly. */
function loopify(c, buf, xfade) {
  const sr = buf.sampleRate, n = Math.floor(xfade * sr);
  const src = buf.getChannelData(0);
  const len = src.length - n;
  const out = c.createBuffer(1, len, sr);
  const d = out.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = src[i];
  for (let i = 0; i < n; i++) {
    const w = i / n;
    d[i] = src[i] * w + src[len + i] * (1 - w);
  }
  return out;
}

function normalize(buf, peak) {
  const d = buf.getChannelData(0);
  let m = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
  if (m > 1e-6) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; }
  return buf;
}

// ---------------------------------------------------------------------------
// One-shot recipes. Each builds a node graph in an OfflineAudioContext `c`,
// starting at `t`, into `out`. R is a seeded RNG, so the bank is identical on
// every device and every launch.
// ---------------------------------------------------------------------------

let _kitNoise = null;
class Kit {
  constructor(c) {
    this.c = c;
    // AudioBuffers belong to no context, so every batch shares one set.
    if (!_kitNoise || _kitNoise.sr !== c.sampleRate) {
      _kitNoise = {
        sr: c.sampleRate,
        white: noiseBuffer(c, 2.5, 'white', 11),
        pink: noiseBuffer(c, 2.5, 'pink', 12),
        brown: noiseBuffer(c, 2.5, 'brown', 13),
      };
    }
    this.nz = _kitNoise;
  }
  noise(kind, t, dur, R) {
    const s = this.c.createBufferSource();
    s.buffer = this.nz[kind];
    s.loop = true;
    s.start(t, R ? R() * 2 : 0);
    s.stop(t + dur);
    return s;
  }
  osc(type, f, t, dur) {
    const o = this.c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.start(t);
    o.stop(t + dur);
    return o;
  }
  filt(type, f, q = 0.707, g = 0) {
    const b = this.c.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g;
    return b;
  }
  gain(v = 0) { const g = this.c.createGain(); g.gain.value = v; return g; }
  shaper(k) { const s = this.c.createWaveShaper(); s.curve = tanhCurve(k); return s; }
  /** Instant attack (or `a` seconds), exponential decay with time constant `tau`. */
  hit(param, t, peak, tau, a = 0.0015) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setTargetAtTime(0, t + a, tau);
  }
  /** Noise burst through a filter, enveloped. */
  burst(out, kind, t, ftype, f, q, peak, tau, R, a = 0.0015) {
    const g = this.gain(0);
    this.noise(kind, t, a + tau * 8, R).connect(this.filt(ftype, f, q)).connect(g).connect(out);
    this.hit(g.gain, t, peak, tau, a);
    return g;
  }
  /** Sine that sweeps f0 -> f1 (exponentially) over `sweep`, enveloped. */
  thump(out, t, f0, f1, sweep, peak, tau, type = 'sine') {
    const o = this.osc(type, f0, t, tau * 9 + 0.02);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + sweep);
    const g = this.gain(0);
    o.connect(g).connect(out);
    this.hit(g.gain, t, peak, tau);
    return o;
  }
  /** A single decaying sine partial. */
  ping(out, t, f, peak, tau, a = 0.001) {
    const o = this.osc('sine', f, t, tau * 8 + a + 0.01);
    const g = this.gain(0);
    o.connect(g).connect(out);
    this.hit(g.gain, t, peak, tau, a);
  }
  /**
   * Many tiny spikes on one gain param: crunch, crackle, gravel, rustle.
   * `times` (sorted) and each spike's amplitude/width come from R.
   */
  grains(param, t, dur, n, R, amp = 1, w0 = 0.002, w1 = 0.01, shape = 1.6) {
    const ts = [];
    for (let i = 0; i < n; i++) ts.push(Math.pow(R(), shape) * dur);
    ts.sort((a, b) => a - b);
    param.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const ti = t + ts[i];
      const fade = 1 - (ts[i] / dur) * 0.7;
      const pk = amp * (0.25 + 0.75 * R()) * fade;
      param.setValueAtTime(0, ti);
      param.linearRampToValueAtTime(pk, ti + 0.0008);
      param.setTargetAtTime(0, ti + 0.0008, w0 + (w1 - w0) * R());
    }
  }
  /** A slowly wandering value, as a curve. */
  wander(param, t, dur, center, spread, R, steps = 40) {
    const a = new Float32Array(steps);
    let v = 0;
    for (let i = 0; i < steps; i++) { v = clamp(v + (R() - 0.5) * 0.7, -1, 1); a[i] = center + v * spread; }
    param.setValueCurveAtTime(a, t, dur);
  }
}

// Metal is modal: inharmonic partials decaying at different rates.
const METAL = [1, 1.58, 2.37, 3.11, 4.53, 5.97, 7.8];

const SOUNDS = {
  // --- impacts -------------------------------------------------------------
  crunch: { dur: 1.4, variants: 3, build(k, out, t, R) {
    const bus = k.gain(1);
    // the shaper's grit, then the top taken off: a crash is weight, not hiss
    bus.connect(k.shaper(2.2)).connect(k.filt('lowpass', 6500, 0.6)).connect(out);
    // the body of the car taking it
    k.thump(bus, t, 95 + R() * 25, 36, 0.35, 0.95, 0.09);
    k.burst(bus, 'brown', t, 'lowpass', 420, 0.7, 1.1, 0.06, R);
    // crumpling sheet: dense grains through a bank of resonances
    const cg = k.gain(0);
    const src = k.noise('white', t, 1.2, R);
    for (let i = 0; i < 4; i++) {
      src.connect(k.filt('bandpass', 450 + R() * 3200, 3 + R() * 5)).connect(cg);
    }
    cg.connect(bus);
    k.grains(cg.gain, t, 0.6, 55, R, 2.2, 0.003, 0.02, 1.8);
    // crackle of bending panels, higher and brighter
    const hg = k.gain(0);
    k.noise('white', t, 1, R).connect(k.filt('highpass', 2200, 0.8)).connect(hg).connect(bus);
    k.grains(hg.gain, t, 0.4, 30, R, 0.4, 0.001, 0.006, 2.2);
    // the panel ringing
    const base = 180 + R() * 240;
    for (let i = 0; i < METAL.length; i++) {
      k.ping(bus, t + 0.004, base * METAL[i] * (1 + (R() - 0.5) * 0.04), 0.13 / (1 + i * 0.4), 0.12 + R() * 0.3);
    }
    // debris settling
    const dg = k.gain(0);
    k.noise('white', t, 1.4, R).connect(k.filt('bandpass', 2600, 1.4)).connect(dg).connect(bus);
    k.grains(dg.gain, t + 0.3, 1.0, 14, R, 0.35, 0.002, 0.012, 1.3);
  } },

  bump: { dur: 0.6, variants: 2, build(k, out, t, R) {
    k.thump(out, t, 120 + R() * 30, 55, 0.12, 1, 0.05);
    k.burst(out, 'pink', t, 'lowpass', 900, 0.7, 0.8, 0.03, R);
    k.burst(out, 'white', t + 0.002, 'bandpass', 1700 + R() * 600, 2, 0.5, 0.012, R);
    const rg = k.gain(0);
    k.noise('white', t, 0.5, R).connect(k.filt('bandpass', 2400, 2)).connect(rg).connect(out);
    k.grains(rg.gain, t + 0.02, 0.2, 8, R, 0.25, 0.002, 0.01);
  } },

  glass: { dur: 1.7, variants: 2, build(k, out, t, R) {
    k.burst(out, 'white', t, 'highpass', 3000, 0.7, 1.2, 0.004, R);
    const sg = k.gain(0);
    k.noise('white', t, 0.6, R).connect(k.filt('highpass', 2600, 0.7)).connect(sg).connect(out);
    k.grains(sg.gain, t, 0.28, 34, R, 0.9, 0.002, 0.012, 1.5);
    for (let i = 0; i < 58; i++) {
      const ti = t + 0.005 + Math.pow(R(), 1.9) * 1.25;
      const f = 2400 + R() * 6800;
      k.ping(out, ti, f, 0.22 * (1 - (ti - t) / 1.6), 0.008 + R() * 0.04);
    }
    for (let i = 0; i < 8; i++) k.ping(out, t + 0.2 + R() * 1.1, 1100 + R() * 900, 0.08, 0.03);
  } },

  // Sustained contact. A loop: gain follows how hard you are grinding.
  scrape: { dur: 2.7, loop: 0.35, build(k, out, t, R) {
    const src = k.noise('white', t, 2.7, R);
    const g = k.gain(0);
    const bed = k.gain(0.28);
    for (const [f, q] of [[1100, 8], [2600, 10], [4300, 12], [700, 5]]) {
      const b = k.filt('bandpass', f, q);
      k.wander(b.frequency, t, 2.7, f, f * 0.12, R);
      src.connect(b);
      b.connect(g);
      b.connect(bed);
    }
    g.connect(out); bed.connect(out);
    k.grains(g.gain, t, 2.7, 420, R, 1.4, 0.002, 0.007, 1);
    for (const f of [1650, 2230]) {
      const o = k.osc('sine', f, t, 2.7);
      k.wander(o.frequency, t, 2.7, f, 90, R);
      const og = k.gain(0);
      k.wander(og.gain, t, 2.7, 0.06, 0.06, R, 20);
      o.connect(og).connect(out);
    }
    const rg = k.gain(0.35);
    k.noise('brown', t, 2.7, R).connect(k.filt('lowpass', 220)).connect(rg).connect(out);
  } },

  explosion: { dur: 3.4, build(k, out, t, R) {
    const bus = k.gain(1);
    bus.connect(k.shaper(3)).connect(out);
    k.thump(bus, t, 72, 24, 1.2, 1.1, 0.35);
    const lp = k.filt('lowpass', 1100, 0.9);
    lp.frequency.setValueAtTime(1100, t);
    lp.frequency.exponentialRampToValueAtTime(110, t + 1.6);
    const ng = k.gain(0);
    k.noise('brown', t, 3.4, R).connect(lp).connect(ng).connect(bus);
    k.hit(ng.gain, t, 1.6, 0.55, 0.004);
    k.burst(bus, 'white', t, 'lowpass', 5000, 0.7, 0.9, 0.03, R);
    const cg = k.gain(0);
    k.noise('white', t, 2, R).connect(k.filt('bandpass', 1500, 1)).connect(cg).connect(bus);
    k.grains(cg.gain, t + 0.05, 1.6, 90, R, 0.7, 0.002, 0.01, 1.7);
    for (let i = 0; i < 14; i++) {
      const ti = t + 0.5 + R() * 2.4;
      k.burst(bus, 'white', ti, 'bandpass', 800 + R() * 2600, 3, 0.15 + R() * 0.2, 0.01 + R() * 0.02, R);
    }
  } },

  gun: { dur: 0.55, variants: 3, build(k, out, t, R) {
    const bus = k.gain(1);
    bus.connect(k.shaper(3.5)).connect(out);
    k.burst(bus, 'white', t, 'highpass', 2500, 0.7, 1.4, 0.0025, R, 0.0003);
    k.burst(bus, 'white', t, 'bandpass', 1200 + R() * 500, 0.8, 1.1, 0.018, R, 0.0005);
    k.burst(bus, 'pink', t, 'lowpass', 1300, 0.7, 0.8, 0.045, R, 0.0008);
    k.thump(bus, t, 190 + R() * 30, 55, 0.06, 1.0, 0.03);
    // the slide cycling
    k.burst(out, 'white', t + 0.075 + R() * 0.01, 'bandpass', 3600, 4, 0.18, 0.003, R);
    k.burst(out, 'white', t + 0.1 + R() * 0.01, 'bandpass', 2900, 4, 0.14, 0.004, R);
  } },

  punch: { dur: 0.36, variants: 3, build(k, out, t, R) {
    const wf = k.filt('bandpass', 500, 1.5);
    wf.frequency.setValueAtTime(500, t);
    wf.frequency.exponentialRampToValueAtTime(1900, t + 0.08);
    const wg = k.gain(0);
    k.noise('white', t, 0.1, R).connect(wf).connect(wg).connect(out);
    wg.gain.setValueAtTime(0, t);
    wg.gain.linearRampToValueAtTime(0.22, t + 0.07);
    wg.gain.linearRampToValueAtTime(0, t + 0.088);
    const ti = t + 0.085;
    k.thump(out, ti, 125 + R() * 25, 52, 0.07, 1, 0.032);
    k.burst(out, 'pink', ti, 'lowpass', 650, 0.7, 0.9, 0.022, R);
    k.burst(out, 'white', ti, 'bandpass', 2000 + R() * 800, 1.2, 0.55, 0.006, R);
  } },

  pedhit: { dur: 0.6, build(k, out, t, R) {
    k.thump(out, t, 90, 42, 0.12, 1, 0.06);
    k.burst(out, 'pink', t, 'lowpass', 500, 0.7, 1, 0.05, R);
    k.burst(out, 'white', t + 0.01, 'bandpass', 1800, 1, 0.45, 0.012, R);
    k.burst(out, 'brown', t + 0.18, 'lowpass', 400, 0.7, 0.4, 0.04, R);
  } },

  land: { dur: 0.35, build(k, out, t, R) {
    k.thump(out, t, 95, 45, 0.08, 1, 0.045);
    k.burst(out, 'pink', t, 'lowpass', 520, 0.7, 0.9, 0.035, R);
    const g = k.gain(0);
    k.noise('white', t, 0.3, R).connect(k.filt('bandpass', 2200, 1)).connect(g).connect(out);
    k.grains(g.gain, t, 0.1, 10, R, 0.4, 0.002, 0.006);
  } },

  thunk: { dur: 0.6, build(k, out, t, R) {
    k.thump(out, t, 64, 38, 0.1, 1, 0.08);
    k.burst(out, 'brown', t, 'lowpass', 260, 0.7, 1, 0.06, R);
    const g = k.gain(0);
    k.noise('white', t, 0.5, R).connect(k.filt('bandpass', 1800, 2)).connect(g).connect(out);
    k.grains(g.gain, t + 0.01, 0.3, 16, R, 0.35, 0.002, 0.012);
  } },

  // --- footsteps -------------------------------------------------------------
  step_hard: { dur: 0.2, variants: 4, build(k, out, t, R) {
    k.burst(out, 'white', t, 'bandpass', 2200 + R() * 1400, 1.8, 1, 0.006, R);
    k.burst(out, 'white', t + 0.035 + R() * 0.02, 'bandpass', 1700 + R() * 500, 2, 0.45, 0.004, R);
    k.burst(out, 'pink', t, 'bandpass', 900, 0.8, 0.35, 0.02, R);
    k.thump(out, t, 80, 60, 0.02, 0.35, 0.014);
  } },
  step_grass: { dur: 0.26, variants: 4, build(k, out, t, R) {
    // blades and stems crushed under a sole: soft crunch, no click
    const g = k.gain(0);
    k.noise('white', t, 0.25, R).connect(k.filt('bandpass', 1900 + R() * 700, 0.8)).connect(g).connect(out);
    k.grains(g.gain, t, 0.13, 18, R, 0.9, 0.003, 0.01);
    k.burst(out, 'pink', t, 'lowpass', 480, 0.7, 0.6, 0.03, R);
    k.burst(out, 'pink', t, 'bandpass', 1200, 0.6, 0.25, 0.05, R, 0.01);
  } },
  step_gravel: { dur: 0.26, variants: 4, build(k, out, t, R) {
    const g = k.gain(0);
    k.noise('white', t, 0.25, R).connect(k.filt('bandpass', 2400 + R() * 800, 0.9)).connect(g).connect(out);
    k.grains(g.gain, t, 0.15, 30, R, 1, 0.002, 0.006, 1.4);
    const g2 = k.gain(0);
    k.noise('white', t, 0.25, R).connect(k.filt('bandpass', 900, 1.2)).connect(g2).connect(out);
    k.grains(g2.gain, t, 0.1, 10, R, 0.6, 0.003, 0.01);
    k.thump(out, t, 75, 55, 0.02, 0.3, 0.015);
  } },
  step_water: { dur: 0.42, variants: 3, build(k, out, t, R) {
    k.burst(out, 'pink', t, 'lowpass', 1800, 0.7, 0.8, 0.05, R, 0.004);
    for (let i = 0; i < 4; i++) {
      const ti = t + 0.01 + R() * 0.12, f0 = 300 + R() * 300;
      const o = k.osc('sine', f0, ti, 0.06);
      o.frequency.exponentialRampToValueAtTime(f0 * (2.4 + R()), ti + 0.03 + R() * 0.02);
      const g = k.gain(0);
      o.connect(g).connect(out);
      k.hit(g.gain, ti, 0.25, 0.012, 0.003);
    }
    const dg = k.gain(0);
    k.noise('white', t, 0.4, R).connect(k.filt('highpass', 3500)).connect(dg).connect(out);
    k.grains(dg.gain, t + 0.03, 0.3, 9, R, 0.3, 0.002, 0.008);
  } },

  // --- getting in and out ----------------------------------------------------
  door_open: { dur: 0.7, build(k, out, t, R) {
    k.burst(out, 'white', t, 'bandpass', 3200, 3, 0.55, 0.003, R);
    k.burst(out, 'white', t + 0.055, 'bandpass', 2000, 2, 0.8, 0.006, R);
    k.ping(out, t + 0.055, 430, 0.18, 0.02);
    k.ping(out, t + 0.055, 1130, 0.08, 0.012);
    // the seal letting go
    const g = k.gain(0);
    k.noise('pink', t, 0.6, R).connect(k.filt('lowpass', 520, 0.7)).connect(g).connect(out);
    g.gain.setValueAtTime(0, t + 0.07);
    g.gain.linearRampToValueAtTime(0.4, t + 0.12);
    g.gain.setTargetAtTime(0, t + 0.12, 0.06);
    // hinge
    const o = k.osc('sawtooth', 170, t + 0.1, 0.35);
    o.frequency.linearRampToValueAtTime(215, t + 0.4);
    const hg = k.gain(0);
    o.connect(k.filt('bandpass', 900, 3)).connect(hg).connect(out);
    hg.gain.setValueAtTime(0, t + 0.1);
    hg.gain.linearRampToValueAtTime(0.05, t + 0.2);
    hg.gain.linearRampToValueAtTime(0, t + 0.42);
  } },
  door_close: { dur: 0.8, build(k, out, t, R) {
    const ti = t + 0.02;
    k.thump(out, ti, 78, 46, 0.08, 1, 0.05);
    k.burst(out, 'brown', ti, 'lowpass', 320, 0.7, 1, 0.05, R);
    for (const f of [165, 243, 392]) k.ping(out, ti, f * (1 + (R() - 0.5) * 0.05), 0.22, 0.04 + R() * 0.04);
    k.burst(out, 'white', ti + 0.012, 'bandpass', 1600, 2, 0.7, 0.008, R);
    k.burst(out, 'white', ti + 0.03, 'bandpass', 2800, 3, 0.25, 0.004, R);
    const rg = k.gain(0);
    k.noise('white', ti, 0.5, R).connect(k.filt('bandpass', 1300, 3)).connect(rg).connect(out);
    k.grains(rg.gain, ti + 0.02, 0.15, 6, R, 0.12, 0.003, 0.01);
  } },
  seat: { dur: 0.8, build(k, out, t, R) {
    const g = k.gain(0);
    k.noise('white', t, 0.8, R).connect(k.filt('bandpass', 1400, 0.7)).connect(g).connect(out);
    k.grains(g.gain, t, 0.5, 12, R, 0.45, 0.02, 0.05, 1);
    k.thump(out, t + 0.12, 70, 50, 0.05, 0.45, 0.06);
    const o = k.osc('triangle', 320, t + 0.1, 0.4);
    o.frequency.linearRampToValueAtTime(260, t + 0.45);
    const sg = k.gain(0);
    o.connect(k.filt('bandpass', 700, 4)).connect(sg).connect(out);
    sg.gain.setValueAtTime(0, t + 0.1);
    sg.gain.linearRampToValueAtTime(0.06, t + 0.15);
    sg.gain.linearRampToValueAtTime(0, t + 0.45);
  } },
  starter: { dur: 1.0, build(k, out, t, R) {
    // A starter motor turning a cold engine over: the whine of the motor,
    // loaded down on each compression stroke.
    const o = k.osc('sawtooth', 185, t, 0.9);
    const g = k.gain(0);
    o.connect(k.filt('bandpass', 900, 1.2)).connect(g).connect(out);
    const w = k.osc('sine', 1400, t, 0.9);
    const wg = k.gain(0.06);
    w.connect(wg).connect(out);
    wg.gain.setValueAtTime(0.06, t);
    wg.gain.linearRampToValueAtTime(0, t + 0.85);
    const ng = k.gain(0);
    k.noise('pink', t, 0.9, R).connect(k.filt('bandpass', 600, 1)).connect(ng).connect(out);
    g.gain.setValueAtTime(0, t);
    ng.gain.setValueAtTime(0, t);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const ti = t + 0.03 + i * 0.095;
      g.gain.linearRampToValueAtTime(0.9, ti + 0.02);
      g.gain.linearRampToValueAtTime(0.35, ti + 0.07);
      ng.gain.linearRampToValueAtTime(0.5, ti + 0.02);
      ng.gain.linearRampToValueAtTime(0.15, ti + 0.07);
      o.frequency.linearRampToValueAtTime(150, ti + 0.03);
      o.frequency.linearRampToValueAtTime(190, ti + 0.08);
    }
    g.gain.linearRampToValueAtTime(0, t + 0.86);
    ng.gain.linearRampToValueAtTime(0, t + 0.86);
  } },
  starter_bike: { dur: 0.6, build(k, out, t, R) {
    const o = k.osc('sawtooth', 260, t, 0.5);
    const g = k.gain(0);
    o.connect(k.filt('bandpass', 1300, 1.2)).connect(g).connect(out);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 5; i++) {
      const ti = t + 0.02 + i * 0.08;
      g.gain.linearRampToValueAtTime(0.8, ti + 0.02);
      g.gain.linearRampToValueAtTime(0.3, ti + 0.06);
    }
    g.gain.linearRampToValueAtTime(0, t + 0.45);
  } },
  ev_on: { dur: 1.0, build(k, out, t, R) {
    for (const [dt, f] of [[0, 659], [0.13, 988]]) {
      k.ping(out, t + dt, f, 0.5, 0.18, 0.01);
      k.ping(out, t + dt, f * 2, 0.12, 0.08, 0.01);
    }
    const o = k.osc('sine', 120, t, 0.9);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.6);
    const g = k.gain(0);
    o.connect(g).connect(out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.3);
    g.gain.linearRampToValueAtTime(0, t + 0.8);
  } },
  kickstand: { dur: 0.4, build(k, out, t, R) {
    k.burst(out, 'white', t, 'bandpass', 2600, 3, 0.6, 0.004, R);
    for (let i = 0; i < 4; i++) k.ping(out, t + 0.004, 880 * METAL[i], 0.3 / (1 + i), 0.03 + R() * 0.04);
    k.thump(out, t, 110, 70, 0.03, 0.4, 0.02);
  } },
  airbrake: { dur: 1.1, build(k, out, t, R) {
    k.burst(out, 'white', t, 'bandpass', 2400, 4, 0.4, 0.004, R);
    const g = k.gain(0);
    k.noise('white', t, 1.1, R).connect(k.filt('highpass', 2200)).connect(k.filt('bandpass', 4800, 0.5)).connect(g).connect(out);
    g.gain.setValueAtTime(0, t + 0.01);
    g.gain.linearRampToValueAtTime(1, t + 0.03);
    g.gain.setTargetAtTime(0, t + 0.08, 0.22);
  } },
  backfire: { dur: 0.3, variants: 2, build(k, out, t, R) {
    const bus = k.gain(1);
    bus.connect(k.shaper(2.5)).connect(out);
    k.burst(bus, 'white', t, 'bandpass', 650 + R() * 300, 0.7, 1, 0.012, R, 0.0005);
    k.thump(bus, t, 115, 60, 0.03, 0.8, 0.02);
    const g = k.gain(0);
    k.noise('white', t, 0.25, R).connect(k.filt('highpass', 2000)).connect(g).connect(out);
    k.grains(g.gain, t + 0.02, 0.12, 5, R, 0.3, 0.002, 0.006);
  } },

  // --- water -----------------------------------------------------------------
  splash: { dur: 2.0, build(k, out, t, R) {
    const lp = k.filt('lowpass', 2600, 0.7);
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.5);
    const g = k.gain(0);
    k.noise('pink', t, 1.5, R).connect(lp).connect(g).connect(out);
    k.hit(g.gain, t, 1, 0.14, 0.006);
    k.burst(out, 'brown', t, 'lowpass', 300, 0.7, 0.8, 0.1, R, 0.004);
    for (let i = 0; i < 18; i++) {
      const ti = t + 0.04 + Math.pow(R(), 1.4) * 0.8, f0 = 180 + R() * 520;
      const o = k.osc('sine', f0, ti, 0.1);
      o.frequency.exponentialRampToValueAtTime(f0 * (2.2 + R()), ti + 0.02 + R() * 0.04);
      const bg = k.gain(0);
      o.connect(bg).connect(out);
      k.hit(bg.gain, ti, 0.22, 0.015, 0.003);
    }
    const sg = k.gain(0);
    k.noise('white', t, 1.6, R).connect(k.filt('highpass', 2600)).connect(sg).connect(out);
    k.grains(sg.gain, t + 0.05, 1.2, 60, R, 0.45, 0.002, 0.012, 1.6);
    const tg = k.gain(0);
    k.noise('pink', t, 2, R).connect(k.filt('lowpass', 600)).connect(tg).connect(out);
    k.grains(tg.gain, t + 0.5, 1.3, 6, R, 0.35, 0.05, 0.12, 1);
  } },
  slosh: { dur: 3.6, loop: 0.45, build(k, out, t, R) {
    const lp = k.filt('lowpass', 750, 0.8);
    k.wander(lp.frequency, t, 3.6, 750, 250, R);
    const bed = k.gain(0.22);
    const lumps = k.gain(0);
    const src = k.noise('pink', t, 3.6, R);
    src.connect(lp);
    lp.connect(bed).connect(out);
    lp.connect(lumps).connect(out);
    k.grains(lumps.gain, t, 3.6, 12, R, 1.1, 0.06, 0.2, 1);
    for (let i = 0; i < 9; i++) {
      const ti = t + R() * 3.4, f0 = 250 + R() * 400;
      const o = k.osc('sine', f0, ti, 0.08);
      o.frequency.exponentialRampToValueAtTime(f0 * 2.3, ti + 0.035);
      const bg = k.gain(0);
      o.connect(bg).connect(out);
      k.hit(bg.gain, ti, 0.12, 0.012, 0.003);
    }
    const dg = k.gain(0);
    k.noise('white', t, 3.6, R).connect(k.filt('highpass', 3000)).connect(dg).connect(out);
    k.grains(dg.gain, t, 3.6, 26, R, 0.18, 0.002, 0.008, 1);
  } },

  // --- tyres -----------------------------------------------------------------
  // Tyre squeal is TONAL -- a rubber stick-slip oscillation near 1 kHz with
  // a wobbling pitch -- not the band of hiss the old skid was.
  squeal: { dur: 2.5, loop: 0.3, build(k, out, t, R) {
    const base = 1020;
    for (const [m, a] of [[1, 1], [2.01, 0.32], [2.97, 0.12]]) {
      const o = k.osc('sine', base * m, t, 2.5);
      k.wander(o.frequency, t, 2.5, base * m, 55 * m, R, 60);
      const g = k.gain(0);
      k.wander(g.gain, t, 2.5, a * 0.7, a * 0.3, R, 50);
      o.connect(g).connect(out);
    }
    const ng = k.gain(0);
    k.wander(ng.gain, t, 2.5, 0.25, 0.1, R, 30);
    k.noise('white', t, 2.5, R).connect(k.filt('bandpass', 1300, 3)).connect(ng).connect(out);
  } },
  gravel: { dur: 2.4, loop: 0.3, build(k, out, t, R) {
    const g = k.gain(0);
    k.noise('white', t, 2.4, R).connect(k.filt('bandpass', 1900, 0.8)).connect(g).connect(out);
    k.grains(g.gain, t, 2.4, 360, R, 0.9, 0.002, 0.006, 1);
    const rg = k.gain(0);
    k.wander(rg.gain, t, 2.4, 0.5, 0.2, R, 30);
    k.noise('brown', t, 2.4, R).connect(k.filt('lowpass', 260)).connect(rg).connect(out);
  } },

  // --- pickups, money, stings, UI ----------------------------------------------
  pickup: { dur: 0.75, build(k, out, t, R) {
    const notes = [1318.5, 1661.2, 1975.5, 2637];
    notes.forEach((f, i) => {
      const ti = t + i * 0.055;
      k.ping(out, ti, f, 0.5, 0.14, 0.004);
      k.ping(out, ti, f * 2.76, 0.08, 0.05, 0.002);
    });
    k.burst(out, 'white', t, 'highpass', 5000, 0.7, 0.12, 0.12, R, 0.02);
  } },
  weapon: { dur: 0.5, build(k, out, t, R) {
    for (const dt of [0, 0.16]) {
      k.burst(out, 'white', t + dt, 'bandpass', 3000, 3, 0.8, 0.005, R);
      for (let i = 0; i < 3; i++) k.ping(out, t + dt, 1200 * METAL[i], 0.2 / (1 + i), 0.025);
    }
  } },
  cash: { dur: 1.1, build(k, out, t, R) {
    k.burst(out, 'white', t, 'bandpass', 1600, 3, 0.6, 0.01, R);
    k.ping(out, t, 1250, 0.25, 0.02);
    k.burst(out, 'brown', t + 0.02, 'lowpass', 220, 0.7, 0.5, 0.05, R);
    const ti = t + 0.09;
    const f = 2093;
    k.ping(out, ti, f, 0.55, 0.28, 0.002);
    k.ping(out, ti, f * 2.76, 0.22, 0.12, 0.002);
    k.ping(out, ti, f * 5.4, 0.08, 0.05, 0.002);
    k.ping(out, ti + 0.004, f * 1.5, 0.2, 0.2, 0.002);
    for (let i = 0; i < 14; i++) k.ping(out, ti + 0.02 + R() * 0.5, 3500 + R() * 3500, 0.08, 0.01 + R() * 0.02);
  } },
  wanted: { dur: 1.9, build(k, out, t, R) {
    k.thump(out, t, 115, 52, 0.25, 1, 0.13);
    k.burst(out, 'brown', t, 'lowpass', 320, 0.7, 0.9, 0.08, R);
    // brass stab: a detuned power chord through a lowpass that opens and closes
    const lp = k.filt('lowpass', 300, 1.2);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(2900, t + 0.04);
    lp.frequency.exponentialRampToValueAtTime(650, t + 0.8);
    const g = k.gain(0);
    lp.connect(g).connect(out);
    for (const f of [110, 110.8, 164.8, 220, 219.2, 329.6]) k.osc('sawtooth', f, t, 1.6).connect(lp);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.28, t + 0.025);
    g.gain.setTargetAtTime(0, t + 0.1, 0.38);
    // tension riser
    const o = k.osc('sawtooth', 880, t + 0.2, 1.6);
    o.frequency.exponentialRampToValueAtTime(1760, t + 1.6);
    const rg = k.gain(0);
    o.connect(k.filt('bandpass', 1400, 2)).connect(rg).connect(out);
    rg.gain.setValueAtTime(0, t + 0.2);
    rg.gain.linearRampToValueAtTime(0.06, t + 1.3);
    rg.gain.linearRampToValueAtTime(0, t + 1.7);
  } },
  ui_tick: { dur: 0.14, build(k, out, t, R) {
    k.ping(out, t, 1250, 0.8, 0.018);
    k.ping(out, t, 2710, 0.2, 0.008);
    k.burst(out, 'white', t, 'bandpass', 2400, 2, 0.4, 0.004, R);
  } },
  ui_go: { dur: 0.9, build(k, out, t, R) {
    for (const f of [784, 988, 1175, 1568]) {
      k.ping(out, t, f, 0.35, 0.22, 0.004);
      k.ping(out, t, f * 2, 0.06, 0.1, 0.004);
    }
    k.burst(out, 'white', t, 'bandpass', 3000, 0.8, 0.2, 0.05, R, 0.01);
  } },
  ui_start: { dur: 0.6, build(k, out, t, R) {
    k.ping(out, t, 587, 0.55, 0.1, 0.004);
    k.ping(out, t, 1174, 0.12, 0.05, 0.004);
    k.ping(out, t + 0.11, 880, 0.55, 0.14, 0.004);
    k.ping(out, t + 0.11, 1760, 0.12, 0.07, 0.004);
  } },
  ui_fail: { dur: 1.1, build(k, out, t, R) {
    [392, 311, 262].forEach((f, i) => {
      const ti = t + i * 0.22;
      const o = k.osc('sawtooth', f, ti, 0.35);
      o.frequency.linearRampToValueAtTime(f * 0.97, ti + 0.3);
      const g = k.gain(0);
      o.connect(k.filt('lowpass', 1100, 1)).connect(g).connect(out);
      g.gain.setValueAtTime(0, ti);
      g.gain.linearRampToValueAtTime(0.4, ti + 0.02);
      g.gain.setTargetAtTime(0, ti + 0.12, i === 2 ? 0.12 : 0.05);
    });
  } },
  ui_check: { dur: 0.5, build(k, out, t, R) {
    k.ping(out, t, 1568, 0.5, 0.13, 0.003);
    k.ping(out, t, 2093, 0.35, 0.11, 0.003);
    k.ping(out, t, 3136, 0.1, 0.05, 0.003);
  } },
  ui_ring: { dur: 0.55, build(k, out, t, R) {
    const f = k.filt('bandpass', 600, 1.4);
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.2);
    const g = k.gain(0);
    k.noise('white', t, 0.3, R).connect(f).connect(g).connect(out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.15);
    g.gain.linearRampToValueAtTime(0, t + 0.24);
    k.ping(out, t + 0.14, 1760, 0.45, 0.12, 0.003);
    k.ping(out, t + 0.14, 2637, 0.15, 0.06, 0.003);
  } },
};

/**
 * Render every recipe into AudioBuffers. Batched into a few offline contexts
 * with a yield between them, so building the graphs never blocks the main
 * thread for long; the rendering itself runs off it.
 */
export async function renderBank(sampleRate, onlyNames = null) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) return {};
  const jobs = [];
  for (const [name, s] of Object.entries(SOUNDS)) {
    if (onlyNames && !onlyNames.includes(name)) continue;
    for (let v = 0; v < (s.variants || 1); v++) jobs.push({ name, s, v });
  }
  const bank = {};
  const GAP = 0.05;
  const BATCH = 8;
  for (let j = 0; j < jobs.length; j += BATCH) {
    const batch = jobs.slice(j, j + BATCH);
    let len = 0;
    for (const b of batch) { b.at = len; len += b.s.dur + GAP; }
    const c = new OAC(1, Math.ceil(len * sampleRate), sampleRate);
    const k = new Kit(c);
    for (const b of batch) {
      const out = c.createGain();
      out.connect(c.destination);
      // Seeded per sound and variant, so the bank is the same on every launch.
      const seed = 1000 + b.v * 7919 + [...b.name].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
      b.s.build(k, out, b.at, mulberry32(seed >>> 0), b.v);
    }
    const rendered = await new Promise((res, rej) => {
      c.oncomplete = (e) => res(e.renderedBuffer);
      const p = c.startRendering();
      if (p && p.then) p.then(res, rej);
    });
    const src = rendered.getChannelData(0);
    for (const b of batch) {
      const i0 = Math.floor(b.at * sampleRate);
      const n = Math.floor(b.s.dur * sampleRate);
      let buf = c.createBuffer(1, n, sampleRate);
      buf.getChannelData(0).set(src.subarray(i0, i0 + n));
      if (b.s.loop) buf = loopify(c, buf, b.s.loop);
      normalize(buf, b.s.loop ? 0.7 : 0.9);
      (bank[b.name] = bank[b.name] || []).push(buf);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return bank;
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------
//
// THE ENGINE TABLE. `selectEngine(spec)` picks a profile from the vehicle's
// spec flags, first match wins, so a new vehicle type needs only a flag:
//
//   spec.engine      explicit profile key below -- overrides everything
//   spec.heli        'heli'       rotor blade slap + tail rotor + turbine
//   spec.boat        'outboard'   2-stroke outboard (+ hull slosh by speed)
//   spec.plane       'turboprop' if spec.turboprop or spec.jet, else 'piston'
//   spec.ev          'ev'         motor + inverter whine, no gears
//   spec.moto        'vtwin' if spec.vtwin or hand 'cruiser', else 'sportbike'
//   spec.atv         'single'     buzzy single-cylinder quad
//   spec.bus / spec.cargo / spec.diesel   'diesel' (turbo, clatter, air brake)
//   spec.police / spec.v8 / hand 'muscle' | 'convertible'   'v8'
//   hand 'sports'    'flat6'
//   hand 'suv' | 'pickup' | 'van'   'v6'
//   anything else    'i4'
//
// Each profile is a firing pattern plus filters. The oscillator's fundamental
// is the ENGINE CYCLE (rpm / 120 for a four-stroke, rpm / 60 for a two-stroke
// or a rotor/prop), and its harmonics are the spectrum of one exhaust pulse
// per cylinder at that cylinder's point in the cycle (`fire`, fractions of the
// cycle, with per-cylinder strength `amps`). Even firing puts all the energy
// on the firing harmonics; the cross-plane V8's uneven bank pattern and the
// 45-degree V-twin's 315/405 split put it on the half-orders too, and that is
// the burble -- it falls out of the geometry rather than being dialled in.
//   pw       exhaust pulse width (fraction of cycle): smaller = brighter/rawer
//   gears    top speed of each gear as a fraction of the vehicle's top speed
//   lp       [base, per-rpm, per-load] low-pass cutoff (Hz): load opens it
//   ex       [freq, Q, dB] exhaust/body resonance
//   noise    {ratio (bp centre / cycle freq), q, gain, pulse (AM depth at
//            pulseOrder x cycle)}: intake roar, diesel clatter, rotor swish
//   buzz     {ratio, gain}: a second tone (tail rotor, prop, gear whine)
//   whine    {hz0, hz1 (at redline), gain, load}: turbo, turbine, motor
//   drive    saturation into the tanh shaper, scaled by load
//   rough    cycle-to-cycle variation: random AM on the tone (lope, clatter)
//   jitter   per-frame level wobble on top of it
//   level    output level
const V8_PATTERN = (() => {
  // Cross-plane firing order 1-8-4-3-6-5-7-2, banks L R R L R L L R: each
  // bank's exhaust sees uneven intervals, which is the V8 burble.
  const banks = [0, 1, 1, 0, 1, 0, 0, 1];
  return {
    fire: banks.map((b, i) => i / 8 + (b ? 0.012 : 0)),
    amps: banks.map((b, i) => (b ? 0.72 : 1) * (1 + ((i * 7) % 5 - 2) * 0.03)),
  };
})();

export const ENGINES = {
  i4: { kind: 'car', stroke: 4, fire: [0, 0.25, 0.5, 0.75], amps: [1, 0.9, 1.07, 0.95], pw: 0.032,
    idle: 850, redline: 6600, gears: [0.21, 0.37, 0.54, 0.72, 0.9, 1.1],
    lp: [320, 1700, 1500], ex: [210, 2.5, 5], noise: { ratio: 34, q: 1.1, gain: 0.22, pulse: 0.35, order: 4 },
    whine: null, drive: 1.8, level: 0.8, jitter: 0.05, rough: 0.3 },
  v6: { kind: 'car', stroke: 4, fire: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6], amps: [1, 0.93, 1.04, 0.97, 1.02, 0.9], pw: 0.03,
    idle: 750, redline: 6100, gears: [0.2, 0.35, 0.52, 0.7, 0.88, 1.08],
    lp: [300, 1500, 1500], ex: [150, 2.2, 6], noise: { ratio: 28, q: 1, gain: 0.18, pulse: 0.3, order: 6 },
    whine: null, drive: 1.9, level: 0.72, jitter: 0.05, rough: 0.3 },
  v8: { kind: 'car', stroke: 4, fire: V8_PATTERN.fire, amps: V8_PATTERN.amps, pw: 0.04,
    idle: 720, redline: 6400, gears: [0.24, 0.4, 0.58, 0.76, 0.93, 1.1],
    lp: [260, 1600, 1700], ex: [105, 2.6, 8], noise: { ratio: 24, q: 0.9, gain: 0.22, pulse: 0.5, order: 8 },
    whine: null, drive: 2.4, level: 0.5, jitter: 0.08, rough: 0.4, crackle: true },
  flat6: { kind: 'car', stroke: 4, fire: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6], amps: [1, 0.98, 1.01, 0.99, 1.02, 0.97], pw: 0.018,
    idle: 950, redline: 8400, gears: [0.22, 0.37, 0.52, 0.68, 0.84, 1.02],
    lp: [450, 3400, 2200], ex: [320, 2, 5], noise: { ratio: 40, q: 1.3, gain: 0.22, pulse: 0.4, order: 6 },
    whine: null, drive: 2.0, level: 0.68, jitter: 0.04, rough: 0.2, crackle: true },
  diesel: { kind: 'car', stroke: 4, fire: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6], amps: [1, 0.9, 1.06, 0.92, 1.03, 0.95], pw: 0.05,
    idle: 650, redline: 2600, gears: [0.12, 0.2, 0.3, 0.44, 0.6, 0.78, 1.0],
    lp: [300, 1300, 1100], ex: [95, 2, 7], noise: { ratio: 90, q: 1.8, gain: 0.45, pulse: 0.85, order: 6 },
    whine: { hz0: 1800, hz1: 4200, gain: 0.04, load: 1 }, drive: 1.6, level: 0.62, jitter: 0.06, rough: 0.5, airbrake: true },
  vtwin: { kind: 'car', stroke: 4, fire: [0, 0.4375], amps: [1, 0.88], pw: 0.045,
    idle: 950, redline: 5600, gears: [0.24, 0.4, 0.57, 0.76, 1.0],
    lp: [260, 1500, 1800], ex: [85, 2.4, 8], noise: { ratio: 30, q: 0.9, gain: 0.22, pulse: 0.6, order: 2 },
    whine: null, drive: 2.6, level: 0.6, jitter: 0.1, rough: 0.45, crackle: true },
  sportbike: { kind: 'car', stroke: 4, fire: [0, 0.25, 0.5, 0.75], amps: [1, 0.96, 1.03, 0.98], pw: 0.02,
    idle: 1300, redline: 13500, gears: [0.3, 0.45, 0.6, 0.74, 0.88, 1.02],
    lp: [550, 4200, 2400], ex: [360, 2, 4], noise: { ratio: 20, q: 1.4, gain: 0.3, pulse: 0.4, order: 4 },
    whine: { hz0: 900, hz1: 4200, gain: 0.02, load: 0 }, drive: 2.0, level: 0.72, jitter: 0.04, rough: 0.2, crackle: true },
  single: { kind: 'car', stroke: 4, fire: [0], amps: [1], pw: 0.04,
    idle: 1400, redline: 8800, gears: [0.24, 0.42, 0.6, 0.8, 1.0],
    lp: [420, 2600, 2000], ex: [240, 2.2, 6], noise: { ratio: 26, q: 1, gain: 0.26, pulse: 0.6, order: 1 },
    whine: null, drive: 2.4, level: 0.75, jitter: 0.08, rough: 0.4 },
  ev: { kind: 'ev', stroke: 2, fire: [0], amps: [1], pw: 0.6, harm: [1, 0.12, 0.3, 0.05, 0.08],
    idle: 0, redline: 36000, gears: [1],
    lp: [2500, 5000, 1500], ex: [1800, 1.5, 3], noise: { ratio: 0, q: 1, gain: 0, pulse: 0, order: 1 },
    whine: { hz0: 380, hz1: 7800, gain: 0.05, load: 0.6 }, drive: 1.0, level: 0.3, jitter: 0 },
  piston: { kind: 'plane', stroke: 4, fire: [0, 0.25, 0.5, 0.75], amps: [1, 0.94, 1.05, 0.92], pw: 0.03,
    idle: 750, redline: 2700, gears: [1],
    lp: [500, 1800, 2200], ex: [140, 1.8, 6], noise: { ratio: 30, q: 0.6, gain: 0.4, pulse: 0.55, order: 4 },
    buzz: { ratio: 4, gain: 0.25 }, whine: null, drive: 2.0, level: 0.58, jitter: 0.06, rough: 0.3 },
  turboprop: { kind: 'plane', stroke: 2, fire: [0, 0.25, 0.5, 0.75], amps: [1, 1, 1, 1], pw: 0.06,
    idle: 900, redline: 1700, gears: [1], spool: 0.35,
    lp: [700, 2000, 1800], ex: [200, 1.5, 4], noise: { ratio: 60, q: 0.5, gain: 0.35, pulse: 0.3, order: 4 },
    buzz: { ratio: 8, gain: 0.12 }, whine: { hz0: 2600, hz1: 6400, gain: 0.08, load: 0.3 }, drive: 1.5, level: 0.62, jitter: 0.03 },
  heli: { kind: 'heli', stroke: 2, fire: [0, 0.5], amps: [1, 0.93], pw: 0.012,
    idle: 0, redline: 400, gears: [1], spool: 0.22,
    lp: [260, 900, 1200], ex: [70, 2, 9], noise: { ratio: 70, q: 0.6, gain: 0.8, pulse: 0.95, order: 2 },
    buzz: { ratio: 14, gain: 0.14 }, whine: { hz0: 1800, hz1: 6100, gain: 0.05, load: 0.2 }, drive: 2.2, level: 0.75, jitter: 0.04 },
  outboard: { kind: 'boat', stroke: 2, fire: [0, 0.5], amps: [1, 0.9], pw: 0.028,
    idle: 900, redline: 5800, gears: [1],
    lp: [380, 2300, 1500], ex: [260, 2.5, 5], noise: { ratio: 18, q: 1.2, gain: 0.3, pulse: 0.5, order: 2 },
    whine: null, drive: 2.3, level: 0.72, jitter: 0.06, rough: 0.35 },
};

export function selectEngine(spec) {
  if (!spec) return 'i4';
  if (spec.engine && ENGINES[spec.engine]) return spec.engine;
  if (spec.heli) return 'heli';
  if (spec.boat) return 'outboard';
  if (spec.plane) return spec.turboprop || spec.jet ? 'turboprop' : 'piston';
  if (spec.ev) return 'ev';
  if (spec.moto) return spec.vtwin || spec.hand === 'cruiser' ? 'vtwin' : 'sportbike';
  if (spec.atv) return 'single';
  if (spec.bus || spec.cargo || spec.diesel) return 'diesel';
  if (spec.police || spec.v8 || spec.hand === 'muscle' || spec.hand === 'convertible') return 'v8';
  if (spec.hand === 'sports') return 'flat6';
  if (spec.hand === 'suv' || spec.hand === 'pickup' || spec.hand === 'van') return 'v6';
  return 'i4';
}

/** The PeriodicWave for a profile: one exhaust pulse per cylinder per cycle. */
function engineWave(c, p, N = 200) {
  const re = new Float32Array(N + 1), im = new Float32Array(N + 1);
  if (p.harm) {
    for (let n = 1; n <= p.harm.length; n++) im[n] = p.harm[n - 1];
  } else {
    for (let n = 1; n <= N; n++) {
      const P = 1 / (1 + (n * p.pw) * (n * p.pw));
      let sr = 0, si = 0;
      for (let k = 0; k < p.fire.length; k++) {
        const ph = 2 * Math.PI * n * p.fire[k];
        sr += p.amps[k] * Math.cos(ph);
        si += p.amps[k] * Math.sin(ph);
      }
      re[n] = P * sr;
      im[n] = -P * si;
    }
  }
  return c.createPeriodicWave(re, im);
}

/** A narrow positive pulse, for amplitude-modulating noise at a rate. */
function pulseWave(c, N = 32) {
  const re = new Float32Array(N + 1), im = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) re[n] = Math.exp(-(n * n) / 60);
  return c.createPeriodicWave(re, im);
}

/**
 * The engine as a machine, in plain JS: gearbox, clutch, shift points, rev
 * limiter, spool-up, lift-off crackle. Produces rpm and load; the voice turns
 * them into sound. Pure and allocation-free, so traffic runs it per voice.
 */
export class EngineModel {
  constructor() {
    this.p = ENGINES.i4;
    this.vmax = 55;
    this.rpm = 0;
    this.gear = 0;
    this.load = 0;
    this.shiftT = 0;
    this.on = false;
    this.spin = 0;      // 0..1 spool (turbines), start flare for pistons
    this.flare = 0;
    this.limT = 0;
    this.lastThr = 0;
    this.popT = 0;      // seconds of lift-off crackle left
    this.event = null;  // 'up' | 'down' | 'pop' | null, read once per step
  }
  setProfile(p, spec) {
    this.p = p;
    this.vmax = spec && spec.topKph ? spec.topKph / 3.6 : 55;
    this.gear = 0;
  }
  start(instant) {
    this.on = true;
    if (instant) { this.spin = 1; this.rpm = Math.max(this.rpm, this.p.kind === 'heli' ? this.p.redline : this.p.idle); }
    else this.flare = this.p.kind === 'car' || this.p.kind === 'boat' ? 0.5 : 0;
  }
  stop() { this.on = false; }

  step(dt, speed, throttle, free) {
    const p = this.p;
    this.event = null;
    const v = Math.abs(speed);
    let thr = clamp(throttle, 0, 1);
    let target;
    // spool: turbines and rotors take seconds to come up to speed
    const spoolRate = p.spool || 3;
    this.spin = clamp(this.spin + (this.on ? spoolRate : -spoolRate * 0.6) * dt, 0, 1);
    if (!this.on) {
      target = 0;
      thr = 0;
    } else if (p.kind === 'ev') {
      target = p.redline * clamp(v / this.vmax, 0, 1.05);
    } else if (p.kind === 'heli') {
      target = p.redline * this.spin;          // governed: the rotor holds its speed
    } else if (p.kind === 'plane') {
      const wind = clamp(v / this.vmax, 0, 1) * 0.12;
      target = (p.idle + (p.redline - p.idle) * clamp(Math.pow(thr, 0.8) + wind, 0, 1)) * this.spin;
    } else if (p.kind === 'boat') {
      target = p.idle + (p.redline - p.idle) * clamp(0.72 * thr + 0.28 * clamp(v / this.vmax, 0, 1), 0, 1);
    } else {
      const gears = p.gears;
      const last = gears.length - 1;
      const gTop = this.vmax * gears[this.gear];
      let wheel = p.redline * v / gTop;
      if (this.shiftT > 0) {
        this.shiftT -= dt;
        thr = Math.min(thr, 0.08);
      } else if (!free) {
        const up = p.redline * (0.52 + 0.42 * thr);
        if (wheel > up && this.gear < last && speed >= 0) {
          this.gear++;
          this.shiftT = p.redline < 3000 ? 0.32 : 0.16;
          this.event = 'up';
        } else if (this.gear > 0 && wheel < p.redline * (0.3 + 0.16 * thr)) {
          const lower = p.redline * v / (this.vmax * gears[this.gear - 1]);
          if (lower < p.redline * 0.88) { this.gear--; this.event = 'down'; }
        }
      }
      wheel = p.redline * v / (this.vmax * gears[this.gear]);
      if (free) {
        target = p.idle + (p.redline * 0.96 - p.idle) * thr;
      } else {
        // clutch slip off the line: revs rise with the throttle before the
        // wheels catch up with them
        // Off the line the revs rise with the throttle and HOLD there (clutch
        // slip, a torque converter's stall speed) until the wheels catch up.
        target = this.gear === 0 ? Math.max(wheel, p.idle + thr * (p.redline - p.idle) * 0.38) : wheel;
        target = Math.max(p.idle, target);
      }
      // rev limiter: a hard bounce off the cut, which is what flat-out sounds like
      if (target >= p.redline * 0.985 && thr > 0.8) {
        this.limT -= dt;
        if (this.limT <= 0) { this.limT = 0.07; this.rpm = p.redline * 0.94; }
        target = p.redline * 0.985;
      }
    }
    if (this.flare > 0 && this.on) {
      this.flare -= dt;
      target = Math.max(target, (p.idle || 800) * (1 + 1.2 * Math.max(0, this.flare) / 0.5));
    }
    const rate = !this.on ? (p.kind === 'car' ? 4 : 1.5) : this.shiftT > 0 ? 14 : p.kind === 'car' ? 9 : 3;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-rate * dt));
    this.load += (thr - this.load) * (1 - Math.exp(-10 * dt));
    // lift-off from high revs: the exhaust crackles and pops for a moment
    if (p.crackle && this.lastThr > 0.6 && thr < 0.1 && this.rpm > p.redline * 0.55) this.popT = 0.7;
    this.lastThr = thr;
    if (this.popT > 0) {
      this.popT -= dt;
      if (Math.random() < dt * 9) this.event = 'pop';
    }
    return this;
  }
}

/**
 * The engine as a sound: one persistent node graph, steered per frame.
 *
 *   tone  osc(PeriodicWave @ cycle) -> toneG --\
 *   buzz  osc(saw @ cycle x ratio)  -> buzzG ---+-> pre -> tanh -> lp -> ex -> out
 *   noise src -> bp -> am(<- pulse osc) -> nG -/                              ^
 *   whine osc(sine)                 -> whineG --------------------------------/
 *
 * 19 nodes (with the roughness low-pass on the tone's gain). Works on any BaseAudioContext, so the offline previews run the
 * exact same code.
 */
export class EngineVoice {
  constructor(c, noiseBuf, dest) {
    this.c = c;
    this.dest = dest;
    this.tone = c.createOscillator();
    this.toneG = c.createGain();
    // Combustion is never two cycles alike. Low-passed noise on the tone's
    // gain smears its harmonics into sidebands -- the difference between an
    // engine and an organ pipe.
    this.roughLp = c.createBiquadFilter();
    this.roughLp.type = 'lowpass';
    this.roughLp.frequency.value = 90;
    this.roughG = c.createGain();
    this.roughG.gain.value = 0;
    this.buzz = c.createOscillator();
    this.buzz.type = 'sawtooth';
    this.buzzG = c.createGain();
    this.buzzG.gain.value = 0;
    this.nsrc = c.createBufferSource();
    this.nsrc.buffer = noiseBuf;
    this.nsrc.loop = true;
    this.nbp = c.createBiquadFilter();
    this.nbp.type = 'bandpass';
    this.nam = c.createGain();
    this.pulse = c.createOscillator();
    this.pulse.setPeriodicWave(pulseWave(c));
    this.pdepth = c.createGain();
    this.nG = c.createGain();
    this.pre = c.createGain();
    this.shaper = c.createWaveShaper();
    this.shaper.curve = tanhCurve(2);
    this.shaper.oversample = 'none';
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.9;
    this.ex = c.createBiquadFilter();
    this.ex.type = 'peaking';
    this.whine = c.createOscillator();
    this.whineG = c.createGain();
    this.whineG.gain.value = 0;
    this.out = c.createGain();
    this.out.gain.value = 0;

    this.tone.connect(this.toneG).connect(this.pre);
    this.buzz.connect(this.buzzG).connect(this.pre);
    this.nsrc.connect(this.nbp).connect(this.nam).connect(this.nG).connect(this.pre);
    this.nsrc.connect(this.roughLp).connect(this.roughG).connect(this.toneG.gain);
    this.pulse.connect(this.pdepth).connect(this.nam.gain);
    this.pre.connect(this.shaper).connect(this.lp).connect(this.ex).connect(this.out);
    this.whine.connect(this.whineG).connect(this.out);
    const t = c.currentTime;
    this.tone.start(t); this.buzz.start(t); this.nsrc.start(t); this.pulse.start(t); this.whine.start(t);
    this.connected = false;
    this.idleT = 0;
    this.profile = null;
    this.waves = {};
  }
  setProfile(name) {
    if (this.profile === name) return;
    this.profile = name;
    const p = ENGINES[name];
    this.p = p;
    if (!this.waves[name]) this.waves[name] = engineWave(this.c, p);
    this.tone.setPeriodicWave(this.waves[name]);
    this.ex.frequency.value = p.ex[0];
    this.ex.Q.value = p.ex[1];
    this.ex.gain.value = p.ex[2];
    this.nbp.Q.value = p.noise.q;
    const k = Math.round(p.drive * 2) / 2;
    this.shaper.curve = tanhCurve(k);
  }
  /** Connect to the mix only while audible: a disconnected graph is not rendered. */
  _link(on) {
    if (keepLinked) on = true;
    if (on === this.connected) return;
    this.connected = on;
    if (on) this.out.connect(this.dest); else this.out.disconnect();
  }
  /**
   * @param m     EngineModel after step()
   * @param t     schedule time
   * @param gain  extra level (distance attenuation, start fade)
   * @param dop   doppler pitch factor
   */
  apply(m, t, gain = 1, dop = 1) {
    const p = this.p;
    const rpm = m.rpm;
    const audible = rpm > 25 && gain > 0.002;
    this.idleT = audible ? 0 : this.idleT + 1;
    if (audible) this._link(true);
    else if (this.idleT > 30) { this._link(false); return; }
    const cyc = Math.max(0.5, rpm / 60 / (p.stroke / 2)) * dop;
    const rn = clamp(rpm / p.redline, 0, 1.1);
    const load = m.load;
    const tc = 0.025;
    setp(this.tone.frequency, cyc, t, tc);
    const jit = p.jitter ? 1 + (Math.random() - 0.5) * p.jitter : 1;
    setp(this.toneG.gain, jit, t, 0.012);
    // roughness tracks the firing rate, and is worst lugging under load
    setp(this.roughLp.frequency, clamp(cyc * 2, 20, 400), t, 0.05);
    setp(this.roughG.gain, (p.rough || 0) * 3 * (0.5 + 0.5 * load), t, 0.05);
    if (p.buzz) {
      setp(this.buzz.frequency, cyc * p.buzz.ratio, t, tc);
      setp(this.buzzG.gain, p.buzz.gain * (0.5 + 0.5 * load), t, 0.05);
    } else setp(this.buzzG.gain, 0, t, 0.05);
    const n = p.noise;
    if (n.gain > 0) {
      setp(this.nbp.frequency, clamp(cyc * n.ratio, 60, 7000), t, tc);
      const amp = n.gain * (0.35 + 0.65 * load) * (0.45 + 0.55 * rn);
      setp(this.nG.gain, amp, t, 0.04);
      setp(this.pulse.frequency, cyc * n.order, t, tc);
      setp(this.pdepth.gain, n.pulse, t, 0.05);
      setp(this.nam.gain, 1 - n.pulse * 0.85, t, 0.05);
    } else setp(this.nG.gain, 0, t, 0.05);
    if (p.whine) {
      const w = p.whine;
      const wr = p.kind === 'ev' ? rn : clamp(rn * (1 - w.load) + load * rn * w.load, 0, 1);
      setp(this.whine.frequency, w.hz0 + (w.hz1 - w.hz0) * wr, t, tc);
      setp(this.whineG.gain, w.gain * (p.kind === 'ev' ? (0.4 + 0.6 * load) * clamp(rn * 8, 0, 1) : (1 - w.load + w.load * load) * clamp(rn * 3, 0, 1)), t, 0.06);
    } else setp(this.whineG.gain, 0, t, 0.05);
    setp(this.pre.gain, p.drive * (0.55 + 0.75 * load), t, 0.04);
    setp(this.lp.frequency, clamp(p.lp[0] + p.lp[1] * rn + p.lp[2] * load, 80, 16000), t, 0.04);
    // Off-throttle the note drops and darkens but does not vanish: engine braking.
    const run = p.kind === 'ev' ? clamp(0.25 + rn * 3, 0, 1) : clamp(rpm / Math.max(200, (p.idle || p.redline * 0.3) * 0.6), 0, 1);
    const lvl = p.level * (0.42 + 0.58 * load) * (0.62 + 0.38 * rn) * run * gain;
    setp(this.out.gain, lvl, t, 0.03);
  }
  silence(t) {
    setp(this.out.gain, 0, t, 0.05);
  }
}

// ---------------------------------------------------------------------------
// Radio
// ---------------------------------------------------------------------------

const SCALE = [0, 3, 5, 7, 10];
// Station 0 is the real KEXP when there is a network, and the synthesised
// version of itself when there isn't -- every station keeps its synth voice so
// the radio still works with the aeroplane on, which is the whole point of an
// offline-first PWA.
const STATIONS = [
  { name: 'KEXP 90.3', root: 55, tempo: 104, wave: 'sawtooth', mood: 0.6, live: true },
  { name: 'Rain City FM', root: 49, tempo: 86, wave: 'triangle', mood: 0.3 },
  { name: 'Pike St Radio', root: 62, tempo: 124, wave: 'square', mood: 0.85 },
];

// Same stream and now-playing feed the /apps/radio app uses.
const KEXP = {
  stream: 'https://kexp.streamguys1.com/kexp160.aac',
  nowPlaying: 'https://api.kexp.org/v2/plays/?limit=1&format=json',
};

// ---------------------------------------------------------------------------
// Live helpers
// ---------------------------------------------------------------------------

/** A looping bank buffer with a level, connected only while it is audible. */
class Tap {
  constructor(c, buf, dest, filter) {
    this.src = c.createBufferSource();
    this.src.buffer = buf;
    this.src.loop = true;
    this.g = c.createGain();
    this.g.gain.value = 0;
    if (filter) this.src.connect(filter).connect(this.g); else this.src.connect(this.g);
    this.src.start(c.currentTime, Math.random() * buf.duration);
    this.dest = dest;
    this.on = false;
    this.quiet = 0;
  }
  set(v, t, tc = 0.06, rate = null) {
    if (v > 0.001) {
      this.quiet = 0;
      if (!this.on) { this.on = true; this.g.connect(this.dest); }
    } else if (this.on && ++this.quiet > 45 && !keepLinked) {
      this.on = false;
      this.g.disconnect();
    }
    if (this.on) {
      setp(this.g.gain, v, t, tc);
      if (rate) setp(this.src.playbackRate, rate, t, 0.08);
    }
  }
}

/** Where a sound at (x, y, z) sits for the listener: level, pan, doppler. */
function spatial(L, x, y, z, vx = 0, vz = 0, ref = 6, maxD = 160) {
  const dx = x - L.x, dz = z - L.z, dy = (y || L.y) - L.y;
  const d = Math.sqrt(dx * dx + dz * dz + dy * dy) || 0.001;
  if (d > maxD) return null;
  const fade = d > maxD * 0.7 ? 1 - (d - maxD * 0.7) / (maxD * 0.3) : 1;
  const gain = Math.min(1, ref / Math.max(ref, d)) * fade;
  // right vector of a camera looking along (fx, fz) is (-fz, fx)
  const pan = clamp(((dx * -L.fz + dz * L.fx) / Math.max(d, 1)) * 0.85, -0.85, 0.85);
  // closing speed along the line of sight (positive = approaching)
  const ux = -dx / d, uz = -dz / d;
  const closing = (vx - L.vx) * ux + (vz - L.vz) * uz;
  const dop = clamp(343 / (343 - closing), 0.8, 1.25);
  return { d, gain, pan, dop };
}

const HORNS = {
  car: { f: [415, 523], wave: 'square', bp: 1900, q: 1.4, gain: 0.42 },
  truck: { f: [185, 233, 277], wave: 'sawtooth', bp: 900, q: 1, gain: 0.5 },
  moto: { f: [560], wave: 'square', bp: 2200, q: 1.8, gain: 0.36 },
  none: null,
};
function hornFor(spec) {
  if (!spec) return 'car';
  if (spec.plane || spec.heli) return 'none';
  if (spec.moto || spec.atv) return 'moto';
  if (spec.bus || spec.cargo || spec.diesel || spec.boat) return 'truck';
  return 'car';
}

const TRAFFIC_VOICES = 3;
const SIREN_VOICES = 2;
const MAX_SHOTS = 18;

export class Audio {
  constructor() {
    this.ready = false;
    this.enabled = true;
    this.musicOn = true;
    this.station = 0;
    this.volume = 0.8;
    this.musicVolume = 0.55;
    this.bank = null;       // name -> [AudioBuffer], filled asynchronously
    this._simT = null;      // offline previews drive time explicitly

    // Live radio state. `_liveFailed` latches for the session once the stream
    // has proved unavailable, so a car with no signal doesn't retry every frame.
    this._live = null;
    this._liveState = 'idle';
    this._liveFailed = false;
    this._livePrimed = false;
    this._liveWanted = false;
    this._nowPlaying = null;
    this._nowPlayingAt = 0;
    this._duck = 1;
    this.onTrack = null; // set by main.js to toast the track
    if (typeof window !== 'undefined') {
      // Coming back onto the network earns one more attempt.
      window.addEventListener('online', () => { this._liveFailed = false; });
      window.addEventListener('offline', () => { this.stopLive(); });
    }
  }

  now() { return this._simT != null ? this._simT : this.ctx.currentTime; }

  /** @param ctxOverride an (Offline)AudioContext, for the previews */
  init(ctxOverride) {
    if (this.ready) return;
    let ctx = ctxOverride;
    keepLinked = !!ctxOverride;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    this.ctx = ctx;
    const c = ctx;

    // --- the mix: every bus into one limiter, then the volume control -------
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;
    this.pre = c.createGain();
    this.pre.gain.value = 0.9;
    this.pre.connect(this.limiter).connect(this.master).connect(c.destination);

    this.sfxBus = c.createGain();
    this.sfxBus.connect(this.pre);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = 0.22;
    this.musicDuck = c.createGain();
    this.musicBus.connect(this.musicDuck).connect(this.pre);

    // One reverb for the whole game: gunshots and crashes echo down the
    // street, and in a bore everything does.
    this.verb = c.createConvolver();
    this.verb.buffer = makeImpulse(c);
    this.verbIn = c.createGain();
    this.verbOut = c.createGain();
    this.verbOut.gain.value = 0.55;
    this.verbIn.connect(this.verb).connect(this.verbOut).connect(this.sfxBus);

    this.noise = noiseBuffer(c, 2, 'white', 3);
    this.pinkNoise = noiseBuffer(c, 2, 'pink', 4);

    // --- the player's engine --------------------------------------------------
    this.engBus = c.createGain();
    this.engBus.connect(this.sfxBus);
    this.engSend = c.createGain();
    this.engSend.gain.value = 0;
    this.engBus.connect(this.engSend).connect(this.verbIn);
    this.eng = new EngineVoice(c, this.pinkNoise, this.engBus);
    this.eng.setProfile('i4');
    this.engModel = new EngineModel();
    this._spec = null;
    this._engStartAt = -1;

    // --- tyres, road and wind: one noise source fanned out --------------------
    this.bed = c.createBufferSource();
    this.bed.buffer = this.pinkNoise;
    this.bed.loop = true;
    this.roadLp = c.createBiquadFilter();
    this.roadLp.type = 'lowpass';
    this.roadLp.frequency.value = 300;
    this.roadG = c.createGain();
    this.roadG.gain.value = 0;
    this.windBp = c.createBiquadFilter();
    this.windBp.type = 'bandpass';
    this.windBp.Q.value = 0.5;
    this.windBp.frequency.value = 500;
    this.windG = c.createGain();
    this.windG.gain.value = 0;
    this.bed.connect(this.roadLp).connect(this.roadG).connect(this.sfxBus);
    this.bed.connect(this.windBp).connect(this.windG).connect(this.sfxBus);
    this.bed.start(c.currentTime);

    // --- horn: a voice, so holding the button holds the note ------------------
    this.hornG = c.createGain();
    this.hornG.gain.value = 0;
    this.hornBp = c.createBiquadFilter();
    this.hornBp.type = 'bandpass';
    this.hornShaper = c.createWaveShaper();
    this.hornShaper.curve = tanhCurve(2.5);
    this.hornOsc = [0, 1, 2].map(() => {
      const o = c.createOscillator();
      const g = c.createGain();
      g.gain.value = 0;
      o.connect(g).connect(this.hornShaper);
      o.start(c.currentTime);
      return { o, g };
    });
    this.hornShaper.connect(this.hornBp).connect(this.hornG);
    this.hornOn = false;
    this.hornT = 0;
    this.hornKind = null;

    // --- sirens: carrier + LFO on its frequency, so the sweep is smooth at
    // any frame rate -------------------------------------------------------------
    this.sirens = [];
    const sq = (() => {
      const N = 15, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
      for (let n = 1; n <= N; n += 2) im[n] = 1 / n;
      return c.createPeriodicWave(re, im);
    })();
    for (let i = 0; i < SIREN_VOICES; i++) {
      const o = c.createOscillator();
      o.setPeriodicWave(sq);
      o.frequency.value = 1000;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.24;
      const depth = c.createGain();
      depth.gain.value = 380;
      lfo.connect(depth).connect(o.frequency);
      const sh = c.createWaveShaper();
      sh.curve = tanhCurve(1.5);
      // a siren speaker is a horn: resonant, and nothing much past ~3 kHz
      const bp = c.createBiquadFilter();
      bp.type = 'lowpass';
      bp.frequency.value = 2900;
      bp.Q.value = 3;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 450;
      const g = c.createGain();
      g.gain.value = 0;
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      o.connect(sh).connect(hp).connect(bp).connect(g);
      if (pan) g.connect(pan);
      o.start(c.currentTime);
      lfo.start(c.currentTime);
      this.sirens.push({ o, lfo, depth, g, pan, out: pan || g, on: false, car: null, yelp: null, quiet: 0 });
    }

    // --- traffic: a few nearest engines, panned ---------------------------------
    this.trafficBus = c.createGain();
    this.trafficBus.gain.value = 0.9;
    this.trafficBus.connect(this.sfxBus);
    this.tvoices = [];
    for (let i = 0; i < TRAFFIC_VOICES; i++) {
      const o = c.createOscillator();
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.8;
      const g = c.createGain();
      g.gain.value = 0;
      const nb = c.createBiquadFilter();
      nb.type = 'bandpass';
      nb.frequency.value = 500;
      nb.Q.value = 0.7;
      const ng = c.createGain();
      ng.gain.value = 0;
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      o.connect(lp).connect(g);
      this.bed.connect(nb).connect(ng);
      const out = pan || c.createGain();
      g.connect(out);
      ng.connect(out);
      o.start(c.currentTime);
      this.tvoices.push({ o, lp, g, nb, ng, pan, out, car: null, prof: null, model: new EngineModel(), lastV: 0, on: false, quiet: 0 });
    }

    // --- the police helicopter ---------------------------------------------------
    this.heliPan = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    this.heliPan.connect(this.sfxBus);
    this.heliVoice = null;   // built on first sight: most sessions never see it
    this.heliModel = new EngineModel();
    this._heliPrev = null;

    // --- one-shots -----------------------------------------------------------------
    this.shots = [];
    this._last = {};
    this.loops = null;       // Taps over bank loops, once the bank exists

    this.footWas = [true, true];
    this._wetWas = false;
    this._airT = 0;
    this._groundWas = true;
    this._popCd = 0;
    this._brakeWas = 0;
    this.nextBeat = c.currentTime + 0.3;
    this.beat = 0;
    this.ready = true;

    this.bankReady = renderBank(c.sampleRate).then((b) => {
      this.bank = b;
      const lp = (f) => { const x = c.createBiquadFilter(); x.type = 'lowpass'; x.frequency.value = f; return x; };
      this.loops = {
        squeal: new Tap(c, b.squeal[0], this.sfxBus),
        gravel: new Tap(c, b.gravel[0], this.sfxBus),
        scrape: new Tap(c, b.scrape[0], this.sfxBus),
        slosh: new Tap(c, b.slosh[0], this.sfxBus, lp(2400)),
      };
      return b;
    }).catch((e) => { console.warn('audio bank failed', e); this.bank = {}; });
  }

  // --- live radio -----------------------------------------------------------
  //
  // A real stream, so it is the one part of this app that needs the network.
  // Everything about it is written to fail back to the synthesised station
  // rather than to silence: no network, a blocked autoplay, a dead stream and a
  // stall all end with `_liveFailed` set and `scheduleMusic()` taking over.

  _makeLive() {
    if (this._live || typeof window === 'undefined' || !window.Audio) return this._live;
    // `window.Audio`, not `Audio` -- this module exports a class of that name,
    // so the bare identifier resolves to us, not to the DOM constructor.
    const el = new window.Audio();
    el.preload = 'none';
    el.crossOrigin = 'anonymous';
    // Streams have no duration to seek in, and iOS otherwise offers scrubbing.
    el.loop = false;
    el.volume = 0;
    // THE RADIO PLAYS ONLY WHEN THE GAME WANTS IT. The element can be started
    // by other things than startLive(): primeLive's unlock, iOS's lock-screen
    // and headphone controls, the end of a phone call. It used to take any
    // 'playing' as the radio being on and never heard about the pause, so
    // `liveOn` stayed true on foot -- and resume(), run on every unpause and
    // every return from the home screen, started the stream again while you
    // were walking. Anything the game did not ask for is paused on the spot.
    el.addEventListener('playing', () => {
      if (!this._liveWanted || this._priming) {
        if (!this._priming) { try { el.pause(); } catch (e) { /* gone */ } }
        return;
      }
      this._liveState = 'playing';
      this._liveFailed = false;
      el.muted = false;
      this._pollNowPlaying();
    });
    el.addEventListener('play', () => {
      if (!this._liveWanted && !this._priming) { try { el.pause(); } catch (e) { /* gone */ } }
    });
    el.addEventListener('pause', () => {
      if (this._liveState === 'playing') this._liveState = 'idle';
    });
    // The lock screen's play button asks the page, not the element, when a
    // handler is set: honour it only in a car.
    try {
      if (navigator.mediaSession) {
        navigator.mediaSession.setActionHandler('play', () => { if (this._liveWanted) this.startLive(); });
        navigator.mediaSession.setActionHandler('pause', () => this.stopLive());
      }
    } catch (e) { /* no media session */ }
    for (const ev of ['error', 'stalled', 'ended']) {
      el.addEventListener(ev, () => {
        // Don't thrash a dead network: give up on the live feed for this drive
        // and let the synth station cover, rather than retrying every frame.
        if (this._liveState !== 'idle') this._liveFailed = true;
        this._liveState = 'idle';
      });
    }
    this._live = el;
    return el;
  }

  /**
   * Satisfy iOS autoplay while we still have a user gesture.
   *
   * Getting into a car happens inside the frame loop, one or more rAF ticks
   * after the button was pressed, so a play() there is not a gesture-initiated
   * call and Safari rejects it. Starting (and immediately pausing) the element
   * during the same gesture that boots the AudioContext marks it as unlocked
   * for the rest of the session.
   */
  primeLive() {
    const el = this._makeLive();
    if (!el || this._livePrimed) return;
    this._livePrimed = true;
    // MUTED, not volume 0: iOS ignores `volume` on media elements (it is
    // always 1 there), so the unlock played the stream out loud on the first
    // tap -- on foot. `muted` it does honour.
    this._priming = true;
    const done = () => { this._priming = false; try { el.pause(); } catch (e) { /* gone */ } };
    try {
      el.muted = true;
      el.src = KEXP.stream;
      el.volume = 0;
      const p = el.play();
      if (p && p.then) p.then(done).catch(() => { this._priming = false; /* stays locked; we cope */ });
      else done();
    } catch (e) { this._priming = false; /* no autoplay, no live radio -- the synth still plays */ }
  }

  startLive() {
    if (this._liveFailed || navigator.onLine === false) return;
    const el = this._makeLive();
    if (!el) return;
    if (this._liveState === 'playing' || this._liveState === 'loading') return;
    this._liveState = 'loading';
    try {
      if (el.src !== KEXP.stream) el.src = KEXP.stream;
      // A live stream that has been paused for a while resumes where it left
      // off, i.e. behind. Reloading puts us back at the live edge.
      el.load();
      el.muted = false;
      el.volume = this.musicVolume;
      const p = el.play();
      if (p && p.catch) p.catch((err) => this._liveDown(err));
    } catch (e) {
      this._liveDown(e);
    }
  }

  /**
   * Give up on the live feed -- but only when it is actually broken.
   *
   * A rejected play() has two very different causes. `NotAllowedError` means
   * the browser has not seen a gesture it will accept yet, which is temporary
   * and self-healing: the next time the player gets into a car they will have
   * pressed something. Latching on that would kill the radio for the whole
   * session on the very platform this feature is for. Anything else (no
   * network, dead stream) latches, so a car with no signal is not retrying the
   * stream every frame.
   */
  _liveDown(err) {
    this._liveState = 'idle';
    if (!err || err.name !== 'NotAllowedError') this._liveFailed = true;
  }

  stopLive() {
    this._liveState = 'idle';
    if (this._live) {
      try { this._live.pause(); } catch (e) { /* already gone */ }
    }
  }

  get liveOn() {
    return this._liveState === 'playing';
  }

  async _pollNowPlaying() {
    if (this._nowPlayingAt && Date.now() - this._nowPlayingAt < 20000) return;
    this._nowPlayingAt = Date.now();
    try {
      const r = await fetch(KEXP.nowPlaying, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      const play = d.results && d.results[0];
      if (!play) return;
      // Field names checked against the live API, not copied from /apps/radio:
      // that app tests `play.playtype.name === 'Air break'`, but v2 returns
      // `play_type: 'airbreak'` with artist/song at the top level, so its
      // air-break branch never fires and its `track.*` fallbacks are dead.
      const label = play.play_type === 'airbreak'
        ? null
        : [play.artist, play.song].filter(Boolean).join(' — ');
      if (label && label !== this._nowPlaying) {
        this._nowPlaying = label;
        if (this.onTrack) this.onTrack(label);
      }
    } catch (e) { /* the music keeps playing without a title */ }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
    // iOS pauses media on the way to the background and does not resume it --
    // but only a radio that is wanted (in a car) comes back.
    if (this._liveWanted && this._live) {
      this._liveState = 'idle';
      this.startLive();
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // --- one-shots --------------------------------------------------------------

  /**
   * Play a bank sound. Options: gain, rate, at (seconds from now), send
   * (reverb), x/y/z (positional: attenuated, panned, darkened with distance),
   * duck (how far to pull the radio down), ref/maxD (distance model).
   */
  play(name, o = {}) {
    if (!this.ready || !this.enabled || !this.bank) return null;
    const list = this.bank[name];
    if (!list || !list.length) return null;
    const c = this.ctx;
    const t = this.now() + (o.at || 0);
    let gain = o.gain == null ? 1 : o.gain;
    let rate = o.rate || 1;
    let pan = 0, dist = 0;
    if (o.x != null && this.L) {
      const s = spatial(this.L, o.x, o.y, o.z, 0, 0, o.ref || 8, o.maxD || 260);
      if (!s) return null;
      gain *= s.gain;
      pan = s.pan;
      dist = s.d;
      if (gain < 0.004) return null;
    }
    // never the same variant twice running
    let vi = 0;
    if (list.length > 1) {
      vi = Math.floor(Math.random() * list.length);
      if (vi === this._last[name]) vi = (vi + 1) % list.length;
      this._last[name] = vi;
    }
    const src = c.createBufferSource();
    src.buffer = list[vi];
    src.playbackRate.value = rate * (o.jitter === false ? 1 : 0.96 + Math.random() * 0.08);
    const g = c.createGain();
    g.gain.value = gain;
    let head = src;
    if (dist > 25) {
      // air takes the top off a distant sound
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = clamp(18000 * Math.exp(-dist / 90), 700, 18000);
      head.connect(f);
      head = f;
    }
    head.connect(g);
    let out = g;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(this.sfxBus);
    const send = (o.send == null ? 0.12 : o.send) + (this._enclosed ? 0.25 : 0) + clamp(dist / 200, 0, 0.35);
    if (send > 0.01) {
      const sg = c.createGain();
      sg.gain.value = send;
      out.connect(sg).connect(this.verbIn);
    }
    src.start(t);
    // A hard cap on voices: forget what has finished, then cut the oldest.
    const end = t + src.buffer.duration / src.playbackRate.value;
    if (this.shots.length >= MAX_SHOTS) this.shots = this.shots.filter((s) => s.end > t);
    this.shots.push({ src, end });
    if (this.shots.length > MAX_SHOTS) {
      const old = this.shots.shift();
      try { old.src.stop(t); } catch (e) { /* done */ }
    }
    if (o.duck) this.duck(o.duck, o.duckHold || 0.5);
    return src;
  }

  /** Pull the radio down under a big sound, then let it back up. */
  duck(amount, hold = 0.5) {
    if (!this.ready) return;
    const t = this.now();
    const g = this.musicDuck.gain;
    const to = clamp(1 - amount, 0.15, 1);
    g.cancelScheduledValues(t);
    g.setTargetAtTime(to, t, 0.03);
    g.setTargetAtTime(1, t + hold, 0.7);
    this._duck = to;
    this._duckUntil = t + hold + 1.5;
  }

  // Legacy synth voices, kept for anything that still calls them.
  blip(freq, dur, type = 'square', vol = 0.25) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  burst(dur, freq, q, vol) {
    this.play('bump', { gain: vol });
  }

  crash(force, x, z) {
    const remote = x != null;
    const key = remote ? '_crashR' : '_crashP';
    const t = this.ready ? this.now() : 0;
    if (this[key] && t - this[key] < (remote ? 0.25 : 0.1)) return;
    this[key] = t;
    const f = clamp(force / 24, 0, 1.4);
    const pos = remote ? { x, z, ref: 10 } : {};
    if (force < 7) {
      this.play('bump', { ...pos, gain: 0.45 + f * 0.5, rate: 1.05 });
      return;
    }
    this.play('bump', { ...pos, gain: 0.7, rate: 0.95 });
    this.play('crunch', { ...pos, gain: 0.35 + 0.55 * Math.min(1, f), rate: 1.12 - 0.2 * Math.min(1, f), send: 0.2, duck: remote ? 0 : 0.3 + 0.4 * Math.min(1, f) });
    if (force > 15 && Math.random() < 0.75) this.play('glass', { ...pos, gain: 0.3 + 0.35 * Math.min(1, f), at: 0.01, send: 0.15 });
    if (force > 26) this.play('crunch', { ...pos, gain: 0.6, rate: 0.78, at: 0.03, send: 0.25 });
  }

  explosion(x, z) {
    const pos = x != null ? { x, z, ref: 25, maxD: 900 } : {};
    this.play('explosion', { ...pos, gain: 1, send: 0.45, duck: 0.8, duckHold: 1.6 });
    this.play('glass', { ...pos, gain: 0.35, at: 0.04 });
  }

  gunshot(x, z) {
    if (x != null) this.play('gun', { x, z, ref: 12, maxD: 500, gain: 0.8, send: 0.35 });
    else this.play('gun', { gain: 0.72, send: 0.4, duck: 0.35, duckHold: 0.15 });
  }

  punch() { this.play('punch', { gain: 0.7, send: 0.05 }); }
  pedHit() { this.play('pedhit', { gain: 0.8, send: 0.08 }); }
  land(drop) { this.play('land', { gain: clamp(0.35 + drop * 0.12, 0.35, 0.95), send: 0.05 }); }

  horn() {
    if (!this.ready || !this.enabled) return;
    const kind = hornFor(this._spec);
    if (kind === 'none') return;
    // attack() re-fires every 0.4 s while held; the voice holds the note.
    this.hornT = 0.46;
    if (kind !== this.hornKind) {
      this.hornKind = kind;
      const h = HORNS[kind];
      const t = this.now();
      this.hornBp.frequency.setValueAtTime(h.bp, t);
      this.hornBp.Q.setValueAtTime(h.q, t);
      this.hornOsc.forEach((v, i) => {
        v.o.type = h.wave;
        const f = h.f[i];
        if (f) v.o.frequency.setValueAtTime(f, t);
        v.g.gain.setValueAtTime(f ? 0.5 : 0, t);
      });
    }
  }

  pickup(kind) { this.play(kind === 'gun' ? 'weapon' : 'pickup', { gain: 0.55, send: 0.05 }); }
  cash() { this.play('cash', { gain: 0.6, send: 0.05, duck: 0.3, duckHold: 0.4 }); }
  wanted(level = 1) {
    this.play('wanted', { gain: 0.6, rate: 1 + 0.05 * (level - 1), jitter: false, send: 0.15, duck: 0.55, duckHold: 0.9 });
  }
  /** Mission and menu cues: 'start' | 'tick' | 'go' | 'check' | 'ring' | 'fail'. */
  ui(kind) {
    this.play('ui_' + kind, { gain: kind === 'fail' ? 0.45 : 0.5, send: 0.03, jitter: false, duck: kind === 'go' || kind === 'fail' ? 0.3 : 0 });
  }

  /** Getting in: doors, seat, starter, and the engine catching. */
  enterVehicle(spec, running) {
    if (!this.ready) return;
    this._spec = spec;
    const name = selectEngine(spec);
    this.eng.setProfile(name);
    this.engModel.setProfile(ENGINES[name], spec);
    this.hornKind = null;
    const kind = ENGINES[name].kind;
    const t = this.now();
    const g = { gain: 0.55, send: 0.04 };
    let catchAt = 0.8;
    if (spec && (spec.moto || spec.atv)) {
      this.play('kickstand', { ...g, gain: 0.5 });
      if (!running) this.play('starter_bike', { ...g, at: 0.18, gain: 0.45 });
      catchAt = 0.5;
    } else if (spec && spec.boat) {
      this.play('slosh', { gain: 0.3 });
      if (!running) this.play('starter', { ...g, at: 0.25, rate: 1.3, gain: 0.4 });
      catchAt = 0.7;
    } else {
      if (spec && spec.bus) this.play('airbrake', { gain: 0.4 });
      else this.play('door_open', g);
      this.play('seat', { ...g, at: 0.2, gain: 0.4 });
      this.play('door_close', { ...g, at: 0.42 });
      if (kind === 'ev') this.play('ev_on', { at: 0.6, gain: 0.35, send: 0.02 });
      else if (kind === 'heli') catchAt = 0.7;
      else if (!running) this.play('starter', { ...g, at: 0.52, rate: spec && (spec.bus || spec.cargo) ? 0.78 : spec && spec.plane ? 0.85 : 1, gain: 0.42 });
      catchAt = kind === 'ev' ? 0.6 : running ? 0.45 : 1.25;
    }
    if (running && kind !== 'heli' && kind !== 'plane') this.engModel.start(true);
    else { this.engModel.on = false; this._engStartAt = t + catchAt; }
  }

  exitVehicle(spec, dead) {
    if (!this.ready) return;
    this.engModel.stop();
    this._engStartAt = -1;
    this.hornT = 0;
    this._spec = null;
    if (dead || !spec || spec.moto || spec.atv || spec.boat) return;
    this.play('door_open', { gain: 0.5, send: 0.04, at: 0.05 });
    this.play('door_close', { gain: 0.5, send: 0.06, at: 0.62 });
  }

  // --- the frame -----------------------------------------------------------------

  update(dt, state) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.now();
    if (!this.enabled) {
      setp(this.sfxBus.gain, 0, t, 0.05);
      setp(this.musicBus.gain, 0, t, 0.05);
      if (this._liveWanted) { this._liveWanted = false; this.stopLive(); }
      return;
    }
    setp(this.sfxBus.gain, 1, t, 0.05);
    const L = state.listener || { x: 0, y: 0, z: 0, fx: 0, fz: -1, vx: 0, vz: 0 };
    this.L = L;
    this._enclosed = !!state.enclosed;
    setp(this.verbOut.gain, state.enclosed ? 1.1 : 0.55, t, 0.3);
    setp(this.engSend.gain, state.enclosed ? 0.45 : 0.04, t, 0.3);

    this._updateVehicle(dt, t, state);
    this._updateFoot(state);
    this._updateWorld(dt, t, state, L);

    // Radio. The live stream is a car radio: it runs while you are in a car and
    // stops when you get out, which is also what keeps a background tab quiet.
    const wantLive = !!state.inCar && this.musicOn && this.enabled
      && !!STATIONS[this.station].live;
    if (wantLive !== this._liveWanted) {
      this._liveWanted = wantLive;
      if (wantLive) this.startLive(); else this.stopLive();
    }
    if (this.liveOn) {
      // iOS ignores `volume` on a media element, so there the duck cannot
      // reach the stream; elsewhere it rides the same envelope.
      const dk = this._duckUntil && t < this._duckUntil ? this.musicDuck.gain.value : 1;
      this._live.volume = clamp(this.musicVolume * dk, 0, 1);
      this._pollNowPlaying();
      // The synth station and the real one must never play together.
      setp(this.musicBus.gain, 0, t, 0.3);
    } else if (this.musicOn && state.inCar) {
      // The SYNTH stations are the car radio too. Only the live stream was
      // gated on being in a car, so on foot the synthesised KEXP played on --
      // walking around town scored like a menu screen. One radio, one rule:
      // it plays in a car and stops the moment you step out.
      this.scheduleMusic();
    } else {
      setp(this.musicBus.gain, 0, t, 0.3);
    }
  }

  _updateVehicle(dt, t, s) {
    const m = this.engModel;
    const inCar = !!s.inCar;
    const spec = s.spec || this._spec;
    if (inCar && spec && spec !== this._spec) {
      // spawned or teleported into a vehicle without going through enterVehicle
      this._spec = spec;
      const name = selectEngine(spec);
      this.eng.setProfile(name);
      m.setProfile(ENGINES[name], spec);
      m.start(true);
    }
    // Out of the car by any route -- a respawn never calls exitVehicle -- and
    // the engine is off.
    if (!inCar && (m.on || this._engStartAt >= 0)) {
      m.stop();
      this._engStartAt = -1;
      this._spec = null;
    }
    if (this._engStartAt >= 0 && (t >= this._engStartAt || (s.throttle > 0.2 && t > this._engStartAt - 0.6))) {
      this._engStartAt = -1;
      m.start(false);
    }
    const speed = s.speed || 0;
    const thr = inCar ? s.throttle || 0 : 0;
    const p = m.p;
    // wheels off the ground (a jump, a ford) free-rev; planes and rotors
    // handle "air" themselves
    const free = inCar && p.kind === 'car' && (s.carAirborne || s.wading);
    m.step(dt, speed, thr, free);
    if (m.event === 'pop' && this._popCd <= 0) {
      this._popCd = 0.07;
      this.play('backfire', { gain: 0.25 + Math.random() * 0.25, send: 0.15 });
    }
    this._popCd -= dt;
    if (m.event === 'up' && p.crackle && s.throttle > 0.9) {
      this.play('backfire', { gain: 0.18, send: 0.1 });
    }
    // heavy vehicles hiss when they come to a stop on the brakes
    if (inCar && p.airbrake && s.brake > 0.5 && Math.abs(speed) < 1.2 && this._brakeWas >= 1.2) {
      this.play('airbrake', { gain: 0.45, send: 0.08 });
    }
    this._brakeWas = Math.abs(speed);
    this.eng.apply(m, t, 1, 1);

    // road, tyres and wind
    const sp = Math.abs(speed);
    const onGround = inCar && !s.airborne && !s.carAirborne && p.kind !== 'boat' && p.kind !== 'heli';
    const offroad = s.surface === 'grass' || s.surface === 'gravel';
    const roll = onGround ? clamp(sp / 30, 0, 1) : 0;
    setp(this.roadG.gain, roll * (offroad ? 0.03 : 0.07), t, 0.1);
    setp(this.roadLp.frequency, 220 + sp * 14, t, 0.2);
    const air = inCar ? (p.kind === 'plane' || p.kind === 'heli' ? 1.6 : spec && spec.moto ? 1.5 : 1) : (s.falling ? 1.2 : 0);
    const wsp = inCar ? sp : Math.abs(s.fallSpeed || 0);
    setp(this.windG.gain, clamp(wsp / 55, 0, 1.2) ** 2 * 0.09 * air, t, 0.25);
    setp(this.windBp.frequency, 350 + wsp * 18, t, 0.25);
    if (this.loops) {
      const skid = onGround ? clamp(s.skid || 0, 0, 1) : 0;
      const squeal = offroad ? 0 : skid * clamp(sp / 6, 0, 1);
      this.loops.squeal.set(squeal * 0.22, t, 0.04, 0.85 + clamp(sp / 40, 0, 0.35));
      const grav = offroad && onGround ? clamp(sp / 18, 0, 1) * 0.12 + skid * 0.15 : 0;
      this.loops.gravel.set(grav, t, 0.08, 0.8 + clamp(sp / 30, 0, 0.5));
      const scr = inCar ? clamp(s.scrape || 0, 0, 1) : 0;
      this.loops.scrape.set(scr * 0.3, t, 0.03, 0.8 + clamp(sp / 25, 0, 0.5));
      // water: a boat's hull, a floatplane on the lake, a car in a ford, or
      // you wading
      const boat = inCar && (p.kind === 'boat' || s.onWater);
      const wet = (s.water || 0) > 0;
      const slosh = boat ? 0.08 + clamp(sp / 14, 0, 1) * 0.3
        : wet ? clamp((s.water || 0) * 0.6 + sp * 0.04, 0, 0.35) : 0;
      this.loops.slosh.set(slosh, t, 0.15, 0.8 + clamp(sp / 25, 0, 0.6));
      // falling in
      if (wet && !this._wetWas && !boat) {
        const hard = clamp((s.impactSpeed || sp) / 12, 0.2, 1);
        this.play('splash', { gain: 0.35 + 0.6 * hard, rate: 1.1 - 0.2 * hard, send: 0.1, duck: 0.3 * hard });
      }
      this._wetWas = wet;
    }
    // a car landing off a jump
    const grounded = !(s.carAirborne);
    if (inCar && !grounded) this._airT += dt;
    if (inCar && grounded && !this._groundWas && this._airT > 0.25) {
      this.play('thunk', { gain: clamp(0.35 + this._airT * 0.4, 0.35, 0.9), send: 0.06 });
      if (this._airT > 0.8) this.play('bump', { gain: 0.5 });
    }
    if (grounded) this._airT = 0;
    this._groundWas = grounded;

    // horn
    if (this.hornT > 0) this.hornT -= dt;
    const hornWant = this.hornT > 0 && inCar;
    if (hornWant && !this.hornOn) { this.hornOn = true; this.hornG.connect(this.sfxBus); }
    if (this.hornOn) {
      const h = HORNS[this.hornKind] || HORNS.car;
      setp(this.hornG.gain, hornWant ? h.gain : 0, t, hornWant ? 0.008 : 0.03);
      if (!hornWant && this.hornT < -0.4 && !keepLinked) { this.hornOn = false; this.hornG.disconnect(); }
    }
  }

  _updateFoot(s) {
    if (!s.onFoot) { this.footWas[0] = this.footWas[1] = true; return; }
    const sp = s.footSpeed || 0;
    for (let i = 0; i < 2; i++) {
      const down = i ? s.footR : s.footL;
      if (down && !this.footWas[i] && sp > 0.5) {
        const surf = s.surface || 'hard';
        const name = surf === 'water' ? 'step_water' : surf === 'grass' ? 'step_grass' : surf === 'gravel' ? 'step_gravel' : 'step_hard';
        const run = clamp((sp - 1.4) / 5, 0, 1);
        this.play(name, { gain: (surf === 'grass' ? 0.2 : 0.24) + run * 0.2, rate: 1.04 - run * 0.1, send: 0.04 });
      }
      this.footWas[i] = !!down;
    }
  }

  _updateWorld(dt, t, s, L) {
    // --- traffic engines ---------------------------------------------------------
    const cars = s.cars;
    if (cars) {
      // nearest few moving (or idling) cars within earshot
      const best = this._best || (this._best = []);
      best.length = 0;
      for (const v of cars) {
        if (v === s.vehicle || v.mode === 'parked' || v.mode === 'free' || v.mode === 'apron' || v.dead) continue;
        const dx = v.x - L.x, dz = v.z - L.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 70 * 70) continue;
        best.push(d2, v);
      }
      // keep voices on the cars they already have if those are still near
      const want = [];
      for (let k = 0; k < TRAFFIC_VOICES; k++) {
        let bi = -1, bd = Infinity;
        for (let i = 0; i < best.length; i += 2) {
          if (best[i] < bd && !want.includes(best[i + 1])) { bd = best[i]; bi = i; }
        }
        if (bi < 0) break;
        want.push(best[bi + 1]);
      }
      for (const tv of this.tvoices) if (tv.car && !want.includes(tv.car)) tv.car = null;
      for (const v of want) {
        if (this.tvoices.some((tv) => tv.car === v)) continue;
        const tv = this.tvoices.find((x) => !x.car);
        if (!tv) break;
        tv.car = v;
        const name = selectEngine(v.spec);
        if (tv.prof !== name) {
          tv.prof = name;
          if (!this.eng.waves[name]) this.eng.waves[name] = engineWave(this.ctx, ENGINES[name]);
          tv.o.setPeriodicWave(this.eng.waves[name]);
        }
        tv.model.setProfile(ENGINES[name], v.spec);
        tv.model.start(true);
        tv.model.rpm = ENGINES[name].idle || 600;
        tv.lastV = v.vLong;
      }
      for (const tv of this.tvoices) this._trafficVoice(tv, dt, t, L);
    }

    // --- sirens --------------------------------------------------------------------
    if (cars) {
      const cops = this._cops || (this._cops = []);
      cops.length = 0;
      for (const v of cars) {
        if (v.mode !== 'police' || v.dead) continue;
        const d2 = (v.x - L.x) ** 2 + (v.z - L.z) ** 2;
        if (d2 < 260 * 260) cops.push(d2, v);
      }
      const pick = [];
      for (let k = 0; k < SIREN_VOICES; k++) {
        let bi = -1, bd = Infinity;
        for (let i = 0; i < cops.length; i += 2) if (cops[i] < bd && !pick.includes(cops[i + 1])) { bd = cops[i]; bi = i; }
        if (bi < 0) break;
        pick.push(cops[bi + 1]);
      }
      this.sirens.forEach((sv, i) => this._siren(sv, pick[i] || null, t, L));
    } else if (s.siren > 0) {
      // legacy: a level with no position
      this._siren(this.sirens[0], { x: L.x, y: L.y, z: L.z + 20, vLong: 0, forward: { x: 0, z: 1 }, siren: t, legacy: s.siren }, t, L);
    }

    // --- the police helicopter -----------------------------------------------------
    const h = s.heli;
    if (h || this.heliVoice) {
      if (h && !this.heliVoice) {
        this.heliVoice = new EngineVoice(this.ctx, this.pinkNoise, this.heliPan);
        this.heliVoice.setProfile('heli');
        this.heliModel.setProfile(ENGINES.heli, null);
      }
      const m = this.heliModel;
      if (h) m.start(true); else m.stop();
      let vx = 0, vz = 0;
      if (h && this._heliPrev && dt > 0) { vx = (h.x - this._heliPrev.x) / dt; vz = (h.z - this._heliPrev.z) / dt; }
      this._heliPrev = h ? { x: h.x, z: h.z } : null;
      m.step(dt, 0, 0.6, false);
      const sp = h ? spatial(L, h.x, h.y, h.z, vx, vz, 40, 700) : null;
      if (sp && this.heliPan.pan) setp(this.heliPan.pan, sp.pan, t, 0.1);
      this.heliVoice.apply(m, t, sp ? sp.gain * 0.9 : 0, sp ? sp.dop : 1);
    }
  }

  _trafficVoice(tv, dt, t, L) {
    const v = tv.car;
    const quiet = () => {
      if (!tv.on) return;
      setp(tv.g.gain, 0, t, 0.08);
      setp(tv.ng.gain, 0, t, 0.08);
      if (++tv.quiet > 30 && !keepLinked) { tv.on = false; tv.out.disconnect(); }
    };
    if (!v) { quiet(); return; }
    const f = v.forward;
    const sp = spatial(L, v.x, v.y + 0.6, v.z, f.x * v.vLong, f.z * v.vLong, 7, 75);
    if (!sp) { quiet(); return; }
    if (!tv.on) { tv.on = true; tv.out.connect(this.trafficBus); }
    tv.quiet = 0;
    const acc = dt > 0 ? (v.vLong - tv.lastV) / dt : 0;
    tv.lastV = v.vLong;
    const thr = clamp(acc / 3 + 0.15, 0, 1);
    const m = tv.model.step(dt, v.vLong, thr, false);
    const p = m.p;
    const cyc = Math.max(0.5, m.rpm / 60 / (p.stroke / 2)) * sp.dop;
    setp(tv.o.frequency, cyc, t, 0.04);
    const rn = clamp(m.rpm / p.redline, 0, 1);
    setp(tv.lp.frequency, p.lp[0] * 0.8 + p.lp[1] * 0.5 * rn + p.lp[2] * 0.4 * m.load, t, 0.05);
    const lvl = p.level * 1.1 * (0.45 + 0.55 * m.load) * (0.6 + 0.4 * rn) * sp.gain;
    setp(tv.g.gain, lvl, t, 0.05);
    setp(tv.nb.frequency, 300 + Math.abs(v.vLong) * 18, t, 0.1);
    setp(tv.ng.gain, clamp(Math.abs(v.vLong) / 25, 0, 1) * 0.2 * sp.gain, t, 0.08);
    if (tv.pan) setp(tv.pan.pan, sp.pan, t, 0.05);
  }

  _siren(sv, car, t, L) {
    if (!car) {
      if (sv.on) {
        setp(sv.g.gain, 0, t, 0.15);
        if (++sv.quiet > 40 && !keepLinked) { sv.on = false; sv.out.disconnect(); }
      }
      return;
    }
    const f = car.forward;
    const sp = spatial(L, car.x, car.y + 1.5, car.z, f.x * car.vLong, f.z * car.vLong, 14, 260);
    if (!sp) { this._siren(sv, null, t, L); return; }
    if (!sv.on) { sv.on = true; sv.out.connect(this.sfxBus); }
    sv.quiet = 0;
    // wail at a distance, yelp when it is on top of you
    const yelp = sp.d < 45;
    if (yelp !== sv.yelp) {
      sv.yelp = yelp;
      sv.lfo.type = yelp ? 'triangle' : 'sine';
      setp(sv.lfo.frequency, yelp ? 3.3 : 0.24, t, 0.05);
    }
    const centre = (yelp ? 1050 : 1000) * sp.dop;
    setp(sv.o.frequency, centre, t, 0.05);
    setp(sv.depth.gain, (yelp ? 420 : 380) * sp.dop, t, 0.05);
    const lvl = (car.legacy != null ? car.legacy : 1) * 0.11 * sp.gain;
    setp(sv.g.gain, lvl, t, 0.1);
    if (sv.pan) setp(sv.pan.pan, sp.pan, t, 0.06);
  }

  scheduleMusic() {
    const ctx = this.ctx;
    const st = STATIONS[this.station];
    const spb = 60 / st.tempo;
    const now = this.now();
    setp(this.musicBus.gain, 0.2, now, 0.4);
    while (this.nextBeat < now + 0.4) {
      const t = Math.max(this.nextBeat, now + 0.02);
      const b = this.beat;
      const bar = Math.floor(b / 8) % 4;
      const rootMidi = st.root + [0, 5, 3, 7][bar];
      // bass
      if (b % 2 === 0) this.note(rootMidi, t, spb * 0.9, 'sawtooth', 0.16, 260);
      // chord stab
      if (b % 4 === 2) {
        for (const s of [0, 3, 7]) this.note(rootMidi + 12 + s, t, spb * 0.5, st.wave, 0.05, 1600);
      }
      // lead
      if (Math.random() < st.mood * 0.55) {
        const deg = SCALE[Math.floor(Math.random() * SCALE.length)];
        this.note(rootMidi + 24 + deg, t + spb * 0.25, spb * 0.4, st.wave, 0.04, 2600);
      }
      // drums
      this.hit(t, b % 4 === 0 ? 'kick' : b % 4 === 2 ? 'snare' : 'hat');
      this.nextBeat += spb / 2;
      this.beat++;
    }
  }

  note(midi, t, dur, type, vol, cutoff) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hit(t, kind) {
    const ctx = this.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.2);
      return;
    }
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'snare' ? 'bandpass' : 'highpass';
    f.frequency.value = kind === 'snare' ? 1600 : 7000;
    const g = ctx.createGain();
    const dur = kind === 'snare' ? 0.13 : 0.045;
    g.gain.setValueAtTime(kind === 'snare' ? 0.16 : 0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.musicBus);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  nextStation() {
    this.station = (this.station + 1) % STATIONS.length;
    // Tuning away from KEXP has to actually stop the stream; the update loop
    // only notices a change of intent, and station is not part of that.
    if (!STATIONS[this.station].live) {
      this._liveWanted = false;
      this.stopLive();
    }
    return this.stationName();
  }

  /** True when this station is the real stream rather than its synth stand-in. */
  liveStation() {
    return !!STATIONS[this.station].live && this.liveOn;
  }

  stationName() {
    return STATIONS[this.station].name;
  }
}
