// All sound is synthesised with the Web Audio API -- no audio files to ship.

import { clamp, lerp } from './util.js';

function noiseBuffer(ctx, seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

const SCALE = [0, 3, 5, 7, 10];
const STATIONS = [
  { name: 'KEXP 90.3', root: 55, tempo: 104, wave: 'sawtooth', mood: 0.6 },
  { name: 'Rain City FM', root: 49, tempo: 86, wave: 'triangle', mood: 0.3 },
  { name: 'Pike St Radio', root: 62, tempo: 124, wave: 'square', mood: 0.85 },
];

export class Audio {
  constructor() {
    this.ready = false;
    this.enabled = true;
    this.musicOn = true;
    this.station = 0;
    this.volume = 0.8;
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.22;
    this.musicBus.connect(this.master);

    this.noise = noiseBuffer(ctx);

    // engine
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 900;
    this.engGain.connect(this.engFilter).connect(this.sfxBus);
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc1.connect(this.engGain);
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.osc2.connect(g2).connect(this.engGain);
    this.osc1.start();
    this.osc2.start();

    // tyre skid
    this.skidSrc = ctx.createBufferSource();
    this.skidSrc.buffer = this.noise;
    this.skidSrc.loop = true;
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 1800;
    this.skidFilter.Q.value = 3;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.skidSrc.connect(this.skidFilter).connect(this.skidGain).connect(this.sfxBus);
    this.skidSrc.start();

    // siren
    this.sirGain = ctx.createGain();
    this.sirGain.gain.value = 0;
    this.sirOsc = ctx.createOscillator();
    this.sirOsc.type = 'square';
    this.sirOsc.frequency.value = 700;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 900;
    sf.Q.value = 1.5;
    this.sirOsc.connect(sf).connect(this.sirGain).connect(this.sfxBus);
    this.sirOsc.start();
    this.sirT = 0;

    // wind
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = this.noise;
    this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.sfxBus);
    this.windSrc.start();

    this.nextBeat = ctx.currentTime + 0.3;
    this.beat = 0;
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  blip(freq, dur, type = 'square', vol = 0.25) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(this.sfxBus);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  burst(dur, freq, q, vol) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start();
    s.stop(ctx.currentTime + dur + 0.05);
  }

  crash(force) {
    const v = clamp(force / 22, 0.15, 1);
    this.burst(0.35, 220 + Math.random() * 200, 0.7, v * 0.7);
    this.blip(70 + Math.random() * 30, 0.22, 'square', v * 0.35);
  }

  gunshot() {
    this.burst(0.13, 1400, 0.6, 0.5);
    this.blip(140, 0.08, 'square', 0.3);
  }

  punch() {
    this.burst(0.09, 500, 1.2, 0.35);
  }

  horn() {
    this.blip(392, 0.35, 'square', 0.2);
    this.blip(311, 0.35, 'sawtooth', 0.16);
  }

  pickup() {
    this.blip(660, 0.09, 'square', 0.22);
    setTimeout(() => this.blip(990, 0.14, 'square', 0.2), 90);
  }

  wanted() {
    this.blip(220, 0.18, 'sawtooth', 0.25);
    setTimeout(() => this.blip(180, 0.3, 'sawtooth', 0.22), 170);
  }

  cash() {
    this.blip(880, 0.07, 'triangle', 0.24);
    setTimeout(() => this.blip(1320, 0.12, 'triangle', 0.2), 70);
  }

  update(dt, state) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (!this.enabled) {
      this.engGain.gain.value = 0;
      this.skidGain.gain.value = 0;
      this.sirGain.gain.value = 0;
      this.windGain.gain.value = 0;
      return;
    }
    // engine
    const rpm = state.inCar ? clamp(0.16 + state.speed / 34 + state.throttle * 0.22, 0, 1.5) : 0;
    const targetGain = state.inCar ? 0.055 + state.throttle * 0.05 : 0;
    this.engGain.gain.setTargetAtTime(targetGain, t, 0.08);
    const f = 48 + rpm * 130;
    this.osc1.frequency.setTargetAtTime(f, t, 0.06);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    this.engFilter.frequency.setTargetAtTime(500 + rpm * 1600, t, 0.1);

    this.skidGain.gain.setTargetAtTime(state.skid * 0.16, t, 0.05);
    this.windGain.gain.setTargetAtTime(clamp(state.speed / 60, 0, 1) * 0.05, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(300 + state.speed * 12, t, 0.2);

    // siren
    if (state.siren > 0) {
      this.sirT += dt;
      const two = Math.sin(this.sirT * 2.4) > 0 ? 660 : 880;
      this.sirOsc.frequency.setTargetAtTime(two, t, 0.02);
      this.sirGain.gain.setTargetAtTime(clamp(state.siren, 0, 1) * 0.05, t, 0.12);
    } else {
      this.sirGain.gain.setTargetAtTime(0, t, 0.25);
    }

    if (this.musicOn) this.scheduleMusic();
    else this.musicBus.gain.setTargetAtTime(0, t, 0.3);
  }

  scheduleMusic() {
    const ctx = this.ctx;
    const st = STATIONS[this.station];
    const spb = 60 / st.tempo;
    this.musicBus.gain.setTargetAtTime(0.2, ctx.currentTime, 0.4);
    while (this.nextBeat < ctx.currentTime + 0.4) {
      const t = Math.max(this.nextBeat, ctx.currentTime + 0.02);
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
    return STATIONS[this.station].name;
  }

  stationName() {
    return STATIONS[this.station].name;
  }
}
