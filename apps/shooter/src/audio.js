import { clamp } from './utils.js';

// Procedural, spatialized (stereo-panned + distance) WebAudio engine.
export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null; this.master = null; this.ready = false; this.noiseBuf = null; this._lastVox = 0;
  }
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.ctx;
      this.master = ctx.createGain(); this.master.gain.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp); comp.connect(ctx.destination);
      this.noiseBuf = ctx.createBuffer(1, (ctx.sampleRate * 2) | 0, ctx.sampleRate);
      const nb = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < nb.length; i++) nb[i] = Math.random() * 2 - 1;
      // ambient pad
      const pad = ctx.createGain(); pad.gain.value = 0.04; pad.connect(this.master);
      [55, 82.5, 110, 164].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.value = 0.34 / (i + 1);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.02;
        const lfg = ctx.createGain(); lfg.gain.value = 40; lfo.connect(lfg); lfg.connect(lp.frequency); lfo.start();
        o.connect(g); g.connect(lp); lp.connect(pad); o.start();
      });
      this.ready = true;
    } catch (e) { /* audio unavailable */ }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _route(node, x, z) {
    const ctx = this.ctx;
    if (x === undefined) { node.connect(this.master); return; }
    const cam = this.game.player.camPos, yaw = this.game.player.camYaw;
    const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
    const g = ctx.createGain(); g.gain.value = clamp(1.6 / (1 + d * 0.1), 0, 1);
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / (d || 1), -1, 1);
    node.connect(pan); pan.connect(g); g.connect(this.master);
  }
  tone({ freq = 440, freq2, type = 'sine', dur = 0.1, vol = 0.3, delay = 0, x, z }) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(g); this._route(g, x, z); o.start(t); o.stop(t + dur + 0.02);
  }
  noise({ dur = 0.2, vol = 0.3, type = 'lowpass', freq = 1200, q = 1, delay = 0, x, z }) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const off = Math.random() * (this.noiseBuf.duration - dur);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f); f.connect(g); this._route(g, x, z); src.start(t, Math.max(0, off), dur);
  }

  shoot(w) {
    if (w.id === 'pulse') { this.tone({ freq: 1300, freq2: 240, type: 'sawtooth', dur: 0.09, vol: 0.22 }); this.tone({ freq: 520, freq2: 120, type: 'square', dur: 0.07, vol: 0.14 }); this.noise({ dur: 0.06, vol: 0.12, type: 'highpass', freq: 2400 }); }
    else if (w.id === 'smg') { this.tone({ freq: 980, freq2: 300, type: 'square', dur: 0.05, vol: 0.16 }); this.noise({ dur: 0.04, vol: 0.1, type: 'highpass', freq: 3000 }); }
    else if (w.id === 'shotgun') { this.noise({ dur: 0.22, vol: 0.42, type: 'lowpass', freq: 1700, q: 0.7 }); this.tone({ freq: 170, freq2: 46, type: 'square', dur: 0.2, vol: 0.2 }); this.tone({ freq: 900, freq2: 200, type: 'sawtooth', dur: 0.1, vol: 0.14 }); }
    else { this.tone({ freq: 90, freq2: 60, type: 'sine', dur: 0.05, vol: 0.2 }); this.tone({ freq: 1600, freq2: 140, type: 'sawtooth', dur: 0.5, vol: 0.28 }); this.noise({ dur: 0.4, vol: 0.2, type: 'bandpass', freq: 700, q: 2 }); }
  }
  impactE(x, z) { this.tone({ freq: 1800, freq2: 1000, type: 'square', dur: 0.04, vol: 0.13, x, z }); }
  impactW(x, z) { this.noise({ dur: 0.08, vol: 0.13, type: 'bandpass', freq: 2200, q: 1.5, x, z }); this.tone({ freq: 300, freq2: 120, type: 'square', dur: 0.05, vol: 0.06, x, z }); }
  kill(x, z) { this.tone({ freq: 320, freq2: 80, type: 'square', dur: 0.18, vol: 0.18, x, z }); this.noise({ dur: 0.25, vol: 0.18, freq: 1100, x, z }); }
  bruteDie(x, z) { this.noise({ dur: 0.6, vol: 0.4, type: 'lowpass', freq: 600, x, z }); this.tone({ freq: 140, freq2: 40, type: 'square', dur: 0.5, vol: 0.26, x, z }); }
  hurt() { this.tone({ freq: 200, freq2: 70, type: 'sawtooth', dur: 0.25, vol: 0.28 }); this.noise({ dur: 0.16, vol: 0.16, freq: 500 }); }
  spawn(x, z) { this.tone({ freq: 160, freq2: 500, type: 'sawtooth', dur: 0.35, vol: 0.14, x, z }); }
  vox(type, x, z) {
    if (!this.ready) return; const now = this.ctx.currentTime; if (now - this._lastVox < 0.16) return; this._lastVox = now;
    if (type === 'brute') this.tone({ freq: 84, freq2: 56, type: 'sawtooth', dur: 0.4, vol: 0.16, x, z });
    else if (type === 'runner') this.tone({ freq: 620, freq2: 1180, type: 'square', dur: 0.12, vol: 0.1, x, z });
    else if (type === 'gunner') this.tone({ freq: 440, freq2: 330, type: 'triangle', dur: 0.2, vol: 0.08, x, z });
    else this.tone({ freq: 300, freq2: 170, type: 'sawtooth', dur: 0.18, vol: 0.1, x, z });
  }
  eShoot(x, z) { this.tone({ freq: 760, freq2: 300, type: 'sawtooth', dur: 0.14, vol: 0.13, x, z }); }
  step(x, z, pitch = 1) { this.noise({ dur: 0.05, vol: 0.09, type: 'lowpass', freq: 380 * pitch, x, z }); }
  pStep(pitch = 1) { this.noise({ dur: 0.05, vol: 0.06, type: 'lowpass', freq: 300 * pitch }); }
  round() { [0, 0.12, 0.24].forEach((d, i) => this.tone({ freq: 440 * (i + 1), type: 'triangle', dur: 0.22, vol: 0.2, delay: d })); }
  buy() { this.tone({ freq: 660, freq2: 1320, type: 'triangle', dur: 0.12, vol: 0.2 }); }
  empty() { this.tone({ freq: 220, type: 'square', dur: 0.05, vol: 0.1 }); this.noise({ dur: 0.03, vol: 0.06, freq: 3000, type: 'highpass' }); }
  power() { [0, 0.1, 0.2, 0.3].forEach((d, i) => this.tone({ freq: 523 * Math.pow(1.26, i), type: 'triangle', dur: 0.18, vol: 0.18, delay: d })); }
  reloadOut() { this.tone({ freq: 260, freq2: 160, type: 'square', dur: 0.08, vol: 0.12 }); this.noise({ dur: 0.05, vol: 0.08, freq: 900 }); }
  reloadIn() { this.tone({ freq: 200, freq2: 420, type: 'square', dur: 0.08, vol: 0.12 }); }
  charge() { this.tone({ freq: 300, freq2: 900, type: 'sawtooth', dur: 0.18, vol: 0.1 }); }
  ads() { this.tone({ freq: 900, type: 'sine', dur: 0.04, vol: 0.05 }); }
  switchW() { this.tone({ freq: 500, freq2: 800, type: 'square', dur: 0.08, vol: 0.1 }); }
  death() { this.tone({ freq: 300, freq2: 50, type: 'sawtooth', dur: 1.2, vol: 0.3 }); this.noise({ dur: 1.0, vol: 0.2, freq: 400 }); }
}
