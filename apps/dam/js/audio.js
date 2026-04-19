// Web Audio ambient loop (filtered noise ocean/stream bed) + short procedural SFX.
// No external samples — everything generated from AudioBuffers.

export class Audio {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.ambientGain = null;
        this.sfxGain = null;
        this.ambientStarted = false;
        this.muted = false;
        this._lastSfxTime = 0;
    }

    unlock() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            return;
        }
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
        this.ambientGain = this.ctx.createGain();
        this.ambientGain.gain.value = 0;
        this.ambientGain.connect(this.master);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.9;
        this.sfxGain.connect(this.master);
        this._startAmbient();
    }

    setMuted(m) {
        this.muted = m;
        if (this.master) {
            this.master.gain.linearRampToValueAtTime(
                m ? 0 : 0.6,
                this.ctx.currentTime + 0.1,
            );
        }
    }

    _startAmbient() {
        if (this.ambientStarted) return;
        this.ambientStarted = true;
        const ctx = this.ctx;

        // Pink-ish noise through a lowpass for distant surf
        const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) {
            const white = Math.random() * 2 - 1;
            last = 0.98 * last + 0.02 * white;
            data[i] = last * 1.5;
        }
        const surf = ctx.createBufferSource();
        surf.buffer = noiseBuffer;
        surf.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 360;
        lp.Q.value = 0.3;
        const surfGain = ctx.createGain();
        surfGain.gain.value = 0.35;
        surf.connect(lp).connect(surfGain).connect(this.ambientGain);
        surf.start();

        // Higher-frequency "stream trickle" layer
        const trickle = ctx.createBufferSource();
        trickle.buffer = noiseBuffer;
        trickle.loop = true;
        trickle.detune.value = 600;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2800;
        bp.Q.value = 0.6;
        const trickleGain = ctx.createGain();
        trickleGain.gain.value = 0.15;
        trickle.connect(bp).connect(trickleGain).connect(this.ambientGain);
        trickle.start();

        // Slow LFO modulates lowpass for "waves" feel
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.11;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 140;
        lfo.connect(lfoGain).connect(lp.frequency);
        lfo.start();

        // Fade in
        this.ambientGain.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 2.5);
    }

    playPlace(kind) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        if (now - this._lastSfxTime < 0.03) return; // throttle
        this._lastSfxTime = now;
        if (kind === 'sand' || kind === 'dig') {
            this._playNoiseBurst(0.08, 800, 3200, 0.18);
        } else if (kind === 'rock') {
            this._playThunk(120, 0.22, 0.35);
        } else if (kind === 'stick') {
            this._playThunk(260, 0.15, 0.22);
        }
    }

    playBreak(kind, xPan = 0) {
        if (!this.ctx) return;
        if (kind === 'rock') {
            this._playRumble(0.9, 0.5);
        } else {
            this._playNoiseBurst(0.25, 400, 2400, 0.3);
        }
    }

    _playNoiseBurst(duration, freqFrom, freqTo, gain) {
        const ctx = this.ctx;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) {
            d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(freqFrom, ctx.currentTime);
        f.frequency.exponentialRampToValueAtTime(freqTo, ctx.currentTime + duration);
        f.Q.value = 1.1;
        const g = ctx.createGain();
        g.gain.value = gain;
        g.gain.setValueAtTime(gain, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
        src.connect(f).connect(g).connect(this.sfxGain);
        src.start();
        src.stop(ctx.currentTime + duration + 0.02);
    }

    _playThunk(freq, duration, gain) {
        const ctx = this.ctx;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 1.4, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.6, ctx.currentTime + duration);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(g).connect(this.sfxGain);
        osc.start();
        osc.stop(ctx.currentTime + duration + 0.02);
    }

    _playRumble(duration, gain) {
        const ctx = this.ctx;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
        const d = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < d.length; i++) {
            last = 0.97 * last + 0.03 * (Math.random() * 2 - 1);
            d[i] = last * 2.2 * (1 - i / d.length);
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 220;
        const g = ctx.createGain();
        g.gain.value = gain;
        src.connect(lp).connect(g).connect(this.sfxGain);
        src.start();
        src.stop(ctx.currentTime + duration + 0.05);
    }
}
