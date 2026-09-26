// FISHING OFF THE PIERS: an Easter egg.
//
// A rod leans on a stand at the end of a few real piers and floats (Pier 66,
// the Aquarium's Pier 59, Elliott Bay Marina, Leschi). Walk up, press ENTER:
// you cast off the end in the city, the lure splashes down, and the screen
// turns into a Game Boy Color fishing game -- a nod to Funky's Fishing in
// Donkey Kong Country (GBC, 2000), which it borrows the shape of: a side view
// under the water, a hook you move up and down through schools of fish, a
// line that holds a few catches, a reel that banks them for points, matching
// catches that buy time back, and junk that costs it. The fish are Puget
// Sound's: herring, perch, rockfish, salmon, dogfish, a Giant Pacific Octopus
// (time, not points) and Dungeness crabs walking the bottom.
//
// It is all drawn here, at the Game Boy's 160 x 144, in four-colour sprite
// palettes, with its own pixel font and a chiptune loop on the game's
// AudioContext. Touch: drag anywhere on the left to move the hook, A reels,
// B leaves. Keys: up/down (W/S), Space/Enter reels, Esc leaves.

import * as THREE from './three.js';
import { clamp } from './util.js';

const W = 160, H = 144;
const SURF = 30, BED = 131, HX = 92;       // water surface, seabed, hook column
const TIME0 = 60;

// --- palettes and sprites ---------------------------------------------------
// Each sprite is rows of characters; '.' is transparent, 1-3 index its palette.
const SPR = {
  herring: { pal: ['#1c3f7a', '#8ab6e8', '#e8f4ff'], rows: [
    '..1111....',
    '.122221.1.',
    '1223322111',
    '.122221.1.',
    '..1111....'] },
  perch: { pal: ['#6b4b10', '#e8b830', '#fff3a0'], rows: [
    '...1111.....',
    '..121212..1.',
    '.12323232111',
    '12323232211.',
    '.12222221.1.',
    '..111111....'] },
  rockfish: { pal: ['#7a1c10', '#e0502a', '#ffb070'], rows: [
    '..1.1.1.......',
    '.1111111...1..',
    '123332221.11..',
    '1232222222111.',
    '1222222221.11.',
    '.11222221..1..',
    '...11111......'] },
  salmon: { pal: ['#3a4a5a', '#b8c8d8', '#f07a8a'], rows: [
    '....11111........',
    '..112222211...11.',
    '.12222222221.121.',
    '1232322222222221.',
    '.13333333333221..',
    '..1133333311.121.',
    '....111111....11.'] },
  dogfish: { pal: ['#2a2e36', '#6a7686', '#c8d0da'], rows: [
    '.......1...............',
    '......121..............',
    '..111122211111.....11..',
    '.12222222222221111221..',
    '1232222222222222222221.',
    '.13333333333332111121..',
    '..1111.111111111...11..'] },
  octopus: { pal: ['#5a1030', '#c83a5a', '#ffd0c0'], rows: [
    '...1111...',
    '..122221..',
    '.12222221.',
    '.12322321.',
    '.12222221.',
    '..122221..',
    '.1212121..',
    '12.21.121.',
    '1..1..1.1.'] },
  crab: { pal: ['#6a2410', '#d8602a', '#ffc080'], rows: [
    '11.......11',
    '12.......21',
    '.1.11111.1.',
    '..1233321..',
    '.122222221.',
    '1.1.1.1.1.1'] },
  can: { pal: ['#303030', '#9aa0a8', '#e04040'], rows: [
    '.111.',
    '12221',
    '13331',
    '13331',
    '12221',
    '.111.'] },
  bottle: { pal: ['#1a4a20', '#3a9a4a', '#b0f0b0'], rows: [
    '..1..',
    '..1..',
    '.121.',
    '12321',
    '12221',
    '12321',
    '.111.'] },
  boot: { pal: ['#2a1a10', '#6a4a2a', '#9a7a5a'], rows: [
    '.111...',
    '.121...',
    '.121...',
    '.1221..',
    '.122211',
    '1333331'] },
  tire: { pal: ['#101010', '#3a3a3a', '#6a6a6a'], rows: [
    '..1111..',
    '.122221.',
    '12311321',
    '1231.321',
    '12311321',
    '.122221.',
    '..1111..'] },
  angler: { pal: ['#202040', '#e0a070', '#d83030'], rows: [
    '..333...',
    '.3333...',
    '..22....',
    '..22....',
    '.1111...',
    '11111...',
    '.1111...',
    '.1111...',
    '.1..1...',
    '.1..1...'] },
};
// what each is worth, where it swims, how fast
const KINDS = {
  herring: { pts: 50, band: [36, 70], speed: 26, school: 3 },
  perch: { pts: 100, band: [50, 95], speed: 20 },
  rockfish: { pts: 150, band: [90, 124], speed: 14 },
  salmon: { pts: 300, band: [45, 100], speed: 38 },
  dogfish: { pts: 400, band: [95, 122], speed: 44 },
  octopus: { pts: 20, band: [100, 122], speed: 9, time: 6 },
  crab: { pts: 250, band: [124, 124], speed: 10, walk: true },
  can: { junk: true, band: [34, 120], speed: 6, sink: 6 },
  bottle: { junk: true, band: [31, 31], speed: 8, float: true },
  boot: { junk: true, band: [34, 120], speed: 5, sink: 9 },
  tire: { junk: true, band: [124, 124], speed: 6, walk: true },
};
const FISH = ['herring', 'perch', 'rockfish', 'salmon', 'dogfish', 'octopus', 'crab'];
const JUNK = ['can', 'bottle', 'boot', 'tire'];

// A 3x5 pixel font: digits, capitals and a little punctuation.
const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '!': '010010010000010', ':': '000010000010000', '.': '000000000000010', '-': '000000111000000',
  '+': '000010111010000', '$': '011110010011110', ' ': '000000000000000', "'": '010010000000000', '/': '001001010100100',
};

/** A little chiptune loop and the blips, on the game's AudioContext. */
class Chip {
  constructor(ctx, dest) {
    this.c = ctx; this.out = null; this.next = 0; this.step = 0; this.on = false;
    if (!ctx) return;
    this.out = ctx.createGain();
    this.out.gain.value = 0.16;
    this.out.connect(dest || ctx.destination);
  }
  tone(type, f, t, dur, vol, slideTo) {
    if (!this.c) return;
    const o = this.c.createOscillator(), g = this.c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 0.02);
  }
  sfx(name) {
    if (!this.c) return;
    const t = this.c.currentTime + 0.01;
    if (name === 'hook') this.tone('square', 880, t, 0.08, 0.5, 1320);
    else if (name === 'reel') this.tone('square', 220, t, 0.35, 0.3, 880);
    else if (name === 'bank') { [988, 1319, 1568].forEach((f, i) => this.tone('square', f, t + i * 0.06, 0.1, 0.4)); }
    else if (name === 'junk') this.tone('sawtooth', 110, t, 0.3, 0.4, 70);
    else if (name === 'combo') { [784, 988, 1175, 1568].forEach((f, i) => this.tone('square', f, t + i * 0.05, 0.08, 0.4)); }
    else if (name === 'level') { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone('square', f, t + i * 0.09, 0.12, 0.4)); }
    else if (name === 'over') { [784, 659, 523, 392].forEach((f, i) => this.tone('triangle', f, t + i * 0.16, 0.2, 0.6)); }
    else if (name === 'splash') this.tone('triangle', 300, t, 0.25, 0.4, 90);
  }
  /** Schedule the loop a little ahead of the clock. */
  music() {
    if (!this.c || !this.on) return;
    const spb = 60 / 138 / 2;                  // eighth notes at 138 bpm
    const LEAD = [72, 0, 76, 79, 81, 0, 79, 76, 74, 0, 76, 74, 72, 0, 67, 0,
      72, 0, 76, 79, 84, 0, 81, 79, 76, 79, 81, 79, 76, 74, 72, 0];
    const BASS = [48, 48, 55, 55, 53, 53, 55, 55, 48, 48, 55, 55, 53, 53, 43, 43];
    const now = this.c.currentTime;
    if (this.next < now) this.next = now + 0.05;
    while (this.next < now + 0.3) {
      const s = this.step % 32, t = this.next;
      const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
      if (LEAD[s]) this.tone('square', hz(LEAD[s]), t, spb * 0.9, 0.22);
      if (s % 2 === 0) this.tone('triangle', hz(BASS[(s / 2) % 16]), t, spb * 1.8, 0.45);
      if (s % 4 === 2) this.tone('square', 6000, t, 0.02, 0.05);
      this.next += spb; this.step++;
    }
  }
}

export class Fishing {
  /**
   * @param opts.audio   the game's Audio (for its context and output)
   * @param opts.onReward(money)  pays the catch out
   * @param opts.onEnd()          back to the city
   */
  constructor(opts) {
    this.opts = opts;
    this.state = 'off';          // off | cast | title | play | over
    this.best = 0;
    try { this.best = +localStorage.getItem('auto-fish-best') || 0; } catch (e) { /* private mode */ }
    this._buildDom();
    this.keys = new Set();
    window.addEventListener('keydown', (e) => {
      if (this.state === 'off' || this.state === 'cast') return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'Enter') this._press('A');
      if (e.code === 'Escape' || e.code === 'KeyB' || e.code === 'Backspace') this._press('B');
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), true);
  }

  get active() { return this.state !== 'off'; }

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'fishOverlay';
    d.innerHTML = `<div class="fishShell"><canvas width="${W}" height="${H}"></canvas>
      <div class="fishPad"><button data-k="B">B</button><button data-k="A">A</button></div>
      <div class="fishHint">DRAG TO MOVE THE HOOK &nbsp;·&nbsp; A REELS IN &nbsp;·&nbsp; B LEAVES</div></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #fishOverlay { position: absolute; inset: 0; z-index: 40; display: none; align-items: center; justify-content: center;
        background: radial-gradient(circle at 50% 40%, #3a2a6a, #120a24); touch-action: none; }
      #fishOverlay.show { display: flex; }
      #fishOverlay .fishShell { position: relative; padding: 14px 14px 10px; border-radius: 16px 16px 40px 16px;
        background: linear-gradient(160deg, #7a4ad0, #5a2ab0); box-shadow: 0 10px 40px #000a, inset 0 2px 0 #fff3; }
      #fishOverlay canvas { display: block; image-rendering: pixelated; image-rendering: crisp-edges; border-radius: 4px;
        height: min(76vh, 540px); width: auto; aspect-ratio: ${W} / ${H}; background: #000; box-shadow: inset 0 0 0 3px #222; }
      #fishOverlay .fishPad { position: absolute; right: -118px; bottom: 22px; display: flex; gap: 12px; transform: rotate(-20deg); }
      #fishOverlay .fishPad button { width: 54px; height: 54px; border-radius: 50%; border: none; font: 900 18px ui-monospace, monospace;
        color: #fff; background: #b8285a; box-shadow: 0 4px 0 #6a1030; touch-action: none; -webkit-tap-highlight-color: transparent; }
      #fishOverlay .fishPad button:active { transform: translateY(3px); box-shadow: 0 1px 0 #6a1030; }
      #fishOverlay .fishHint { text-align: center; color: #e8dcff; font: 700 10px ui-monospace, monospace; letter-spacing: .08em; margin-top: 8px; opacity: .8; }
      @media (max-height: 460px) { #fishOverlay canvas { height: 72vh; } #fishOverlay .fishPad { right: -124px; } }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    this.cv = d.querySelector('canvas');
    this.g = this.cv.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    for (const b of d.querySelectorAll('.fishPad button')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this._press(b.dataset.k); });
    }
    // drag anywhere else to move the hook: finger height maps to hook depth
    let drag = null;
    d.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.fishPad')) return;
      drag = { id: e.pointerId, y0: e.clientY, h0: this.hookY };
      e.preventDefault();
    });
    d.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id || this.state !== 'play' || this.reeling) return;
      const r = this.cv.getBoundingClientRect();
      this.hookY = clamp(drag.h0 + (e.clientY - drag.y0) * (H / r.height) * 1.3, SURF + 4, BED - 3);
    });
    const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    // sprite canvases, drawn once
    this.spr = {};
    for (const [k, s] of Object.entries(SPR)) {
      const w = s.rows[0].length, h = s.rows.length;
      const mk = (flip) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d');
        s.rows.forEach((row, j) => [...row].forEach((ch, i) => {
          if (ch === '.') return;
          x.fillStyle = s.pal[+ch - 1];
          x.fillRect(flip ? w - 1 - i : i, j, 1, 1);
        }));
        return c;
      };
      this.spr[k] = { r: mk(false), l: mk(true), w, h };
    }
  }

  // --- the cast, in the city ---------------------------------------------------

  /**
   * Cast off a pier: the character turns to the water, raises the rod and
   * throws, the line flies out and the lure splashes, then the retro screen.
   * `spot` = { x, y, z, heading }; the game is paused throughout.
   */
  start(spot, env) {
    if (this.active) return;
    this.env = env;             // { scene, camera, player, bones, audio }
    this.spot = spot;
    this.state = 'cast';
    this.t = 0;
    const P = env.player;
    P.x = spot.x; P.z = spot.z; P.y = spot.y; P.heading = spot.heading;
    P.h.group.position.set(spot.x, spot.y, spot.z);
    P.h.group.rotation.y = spot.heading;
    P.h.group.updateMatrixWorld(true);
    // the rod, in the right hand
    const rod = new THREE.Group();
    const blank = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.014, 2.1, 6), new THREE.MeshStandardMaterial({ color: 0x1c2430, roughness: 0.5, metalness: 0.3 }));
    blank.position.y = 1.0;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 }));
    grip.position.y = -0.05;
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10), new THREE.MeshStandardMaterial({ color: 0xb0b4b8, roughness: 0.3, metalness: 0.8 }));
    reel.rotation.z = Math.PI / 2; reel.position.set(0.03, 0.12, 0);
    rod.add(blank, grip, reel);
    this.rodTip = new THREE.Object3D(); this.rodTip.position.y = 2.05; rod.add(this.rodTip);
    const hand = env.bones.handR;
    rod.rotation.set(0.4, 0, -0.3);
    hand.add(rod);
    this.rod = rod;
    // the line: rod tip to lure
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.8 }));
    this.line.frustumCulled = false;
    env.scene.add(this.line);
    const fx = Math.sin(spot.heading), fz = Math.cos(spot.heading);
    this.lureTo = new THREE.Vector3(spot.x + fx * 14, spot.water, spot.z + fz * 14);
    this.lure = new THREE.Vector3();
    this.splash = null;
    this.chip = this.chip || new Chip(env.audio && env.audio.ctx, env.audio && env.audio.master);
  }

  _castStep(dt) {
    const e = this.env, b = e.bones, P = e.player, sp = this.spot;
    this.t += dt;
    const t = this.t;
    // the arm: rod up and back, then a snap forward, then held out
    const k1 = clamp(t / 0.45, 0, 1), k2 = clamp((t - 0.55) / 0.18, 0, 1);
    const sh = t < 0.55 ? -0.3 - 2.3 * k1 : -2.6 + 1.6 * k2;
    b.shoulderR.rotation.set(sh, 0, 0.15);
    b.elbowR.rotation.set(t < 0.55 ? -0.9 * k1 : -0.9 + 0.7 * k2, 0, 0);
    b.shoulderL.rotation.set(-0.5, 0, -0.2);
    b.elbowL.rotation.set(-1.1, 0, 0);
    P.h.group.updateMatrixWorld(true);
    // the camera, beside and behind, looking out to where the lure lands
    const fx = Math.sin(sp.heading), fz = Math.cos(sp.heading), rx = fz, rz = -fx;
    const cam = e.camera;
    cam.position.set(sp.x - fx * 5.5 + rx * 3.2, sp.y + 2.6, sp.z - fz * 5.5 + rz * 3.2);
    cam.lookAt(sp.x + fx * 7, sp.y + 0.2, sp.z + fz * 7);
    cam.updateMatrixWorld(true);
    // the lure: in the tip until the snap, then an arc out to the water
    const tip = new THREE.Vector3();
    this.rodTip.getWorldPosition(tip);
    const f = clamp((t - 0.62) / 0.75, 0, 1);
    if (f <= 0) this.lure.copy(tip);
    else {
      this.lure.lerpVectors(tip, this.lureTo, f);
      this.lure.y += Math.sin(Math.PI * f) * 4;
    }
    // the line hangs in a slight catenary from the tip to the lure
    const pos = this.line.geometry.attributes.position;
    for (let i = 0; i < 24; i++) {
      const u = i / 23;
      pos.setXYZ(i, tip.x + (this.lure.x - tip.x) * u, tip.y + (this.lure.y - tip.y) * u - Math.sin(Math.PI * u) * (f >= 1 ? 1.2 : 0.3), tip.z + (this.lure.z - tip.z) * u);
    }
    pos.needsUpdate = true;
    if (f >= 1 && !this.splash) {
      // splash: a white ring spreading on the water
      const m = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.35, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.copy(this.lureTo); m.position.y += 0.05;
      e.scene.add(m);
      this.splash = { m, t: 0 };
      this.chip.sfx('splash');
    }
    if (this.splash) {
      this.splash.t += dt;
      const s = 1 + this.splash.t * 5;
      this.splash.m.scale.set(s, s, s);
      this.splash.m.material.opacity = Math.max(0, 0.9 - this.splash.t * 1.1);
    }
    if (t > 1.95) this._open();
  }

  _clear3d() {
    const e = this.env;
    if (this.rod) { this.rod.parent && this.rod.parent.remove(this.rod); this.rod = null; }
    if (this.line) { e.scene.remove(this.line); this.line.geometry.dispose(); this.line = null; }
    if (this.splash) { e.scene.remove(this.splash.m); this.splash = null; }
  }

  // --- the game ----------------------------------------------------------------

  _open() {
    this.el.classList.add('show');
    this.state = 'title';
    this.t = 0;
    this.chip.on = true;
    this.chip.next = 0;
  }

  _reset() {
    this.score = 0; this.level = 1; this.time = TIME0; this.hookY = 60; this.reeling = false;
    this.caught = []; this.ents = []; this.pops = []; this.spawnT = 0; this.junkT = 4; this.banner = null;
    this.frame = 0;
  }

  _press(k) {
    if (this.state === 'title') { if (k === 'A') { this._reset(); this.state = 'play'; this.chip.sfx('bank'); } else if (k === 'B') this.close(); return; }
    if (this.state === 'play') {
      if (k === 'A' && !this.reeling) { this.reeling = true; this.chip.sfx('reel'); }
      if (k === 'B') this._gameOver(true);
      return;
    }
    if (this.state === 'over' && this.t > 0.8) { if (k === 'A') { this._reset(); this.state = 'play'; } else if (k === 'B') this.close(); }
  }

  close() {
    this.el.classList.remove('show');
    if (this.chip) this.chip.on = false;
    this._clear3d();
    this.state = 'off';
    if (this.opts.onEnd) this.opts.onEnd();
  }

  _gameOver(quit) {
    this.state = 'over';
    this.t = 0;
    this.reward = Math.floor(this.score / 20);
    this.newBest = this.score > this.best;
    if (this.newBest) { this.best = this.score; try { localStorage.setItem('auto-fish-best', String(this.best)); } catch (e) { /* private */ } }
    if (this.reward > 0 && this.opts.onReward) this.opts.onReward(this.reward);
    this.chip.sfx(quit ? 'reel' : 'over');
  }

  update(dt) {
    if (this.state === 'off') return;
    if (this.state === 'cast') { this._castStep(dt); return; }
    this.chip.music();
    this.t += dt;
    if (this.state === 'play') this._play(Math.min(dt, 0.05));
    this._draw();
  }

  _spawn(kind, fromLeft) {
    const K = KINDS[kind], s = this.spr[kind];
    const dir = fromLeft ? 1 : -1;
    const y = K.band[0] + Math.random() * (K.band[1] - K.band[0]);
    const sp = K.speed * (1 + 0.12 * (this.level - 1)) * (0.8 + Math.random() * 0.4);
    const n = K.school && Math.random() < 0.6 ? K.school : 1;
    for (let i = 0; i < n; i++) {
      this.ents.push({ kind, x: fromLeft ? -s.w - i * 12 : W + i * 12, y: clamp(y + (i % 2) * 5, SURF + 2, BED - s.h), dir, sp, w: s.w, h: s.h, ph: Math.random() * 6 });
    }
  }

  _play(dt) {
    this.frame++;
    this.time -= dt;
    if (this.time <= 0) { this.time = 0; this._gameOver(false); return; }
    // hook
    const up = this.keys.has('ArrowUp') || this.keys.has('KeyW'), dn = this.keys.has('ArrowDown') || this.keys.has('KeyS');
    if (this.reeling) {
      this.hookY -= 170 * dt;
      if (this.hookY <= SURF + 2) { this.hookY = SURF + 2; this._bank(); }
    } else {
      if (up) this.hookY -= 80 * dt;
      if (dn) this.hookY += 80 * dt;
      this.hookY = clamp(this.hookY, SURF + 4, BED - 3);
    }
    // spawns: a fish every ~0.9 s (faster with level), junk from level 2
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(0.35, 0.95 - this.level * 0.06) * (0.6 + Math.random() * 0.8);
      const r = Math.random();
      const kind = r < 0.3 ? 'herring' : r < 0.52 ? 'perch' : r < 0.68 ? 'rockfish' : r < 0.8 ? 'salmon' : r < 0.87 ? 'dogfish' : r < 0.94 ? 'octopus' : 'crab';
      this._spawn(kind, Math.random() < 0.5);
    }
    if (this.level >= 2) {
      this.junkT -= dt;
      if (this.junkT <= 0) {
        this.junkT = Math.max(1.2, 5 - this.level * 0.5) * (0.6 + Math.random() * 0.8);
        this._spawn(JUNK[Math.floor(Math.random() * JUNK.length)], Math.random() < 0.5);
      }
    }
    // move everything; the hook takes what it touches (up to four)
    const hk = { x: HX - 2, y: this.hookY, w: 5, h: 5 };
    for (const e of this.ents) {
      const K = KINDS[e.kind];
      e.ph += dt * 6;
      e.x += e.dir * e.sp * dt;
      if (K.sink && e.y < BED - e.h) e.y += K.sink * dt;
      if (K.float) e.y = SURF - 2 + Math.sin(e.ph * 0.5);
      if (!K.walk && !K.float && !K.sink) e.y += Math.sin(e.ph) * 6 * dt;
      if (!this.reeling && this.caught.length < 4 && !e.gone && e.x < hk.x + hk.w && e.x + e.w > hk.x && e.y < hk.y + hk.h && e.y + e.h > hk.y) {
        e.gone = true;
        this.caught.push(e.kind);
        this.chip.sfx(K.junk ? 'junk' : 'hook');
        if (K.junk) this._pop('JUNK', HX + 6, this.hookY, '#e84040');
      }
    }
    this.ents = this.ents.filter((e) => !e.gone && e.x > -40 && e.x < W + 40);
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < 1.1);
    if (this.banner && (this.banner.t += dt) > 1.8) this.banner = null;
  }

  _bank() {
    this.reeling = false;
    if (!this.caught.length) { this.hookY = 60; return; }
    let pts = 0, time = 0;
    const count = {};
    for (const k of this.caught) {
      const K = KINDS[k];
      if (K.junk) { time -= 5; continue; }
      pts += K.pts;
      if (K.time) time += K.time;
      count[k] = (count[k] || 0) + 1;
    }
    // COMBO: two or more of one kind on one line buys time; three or more
    // doubles the points, four triples them
    let combo = 0;
    for (const n of Object.values(count)) combo = Math.max(combo, n);
    if (combo >= 2) { time += (combo - 1) * 4; this.chip.sfx('combo'); this._pop(`COMBO X${combo}`, 60, 44, '#ffe060'); }
    if (combo >= 3) pts *= combo - 1;
    this.score += pts * this.level;
    this.time = Math.min(TIME0 + 30, this.time + time);
    if (pts) this._pop(`+${pts * this.level}`, HX + 6, SURF + 6, '#ffffff');
    if (time < 0) this._pop(`${time}S`, HX + 6, SURF + 14, '#ff6060');
    else if (time > 0) this._pop(`+${time}S`, HX + 6, SURF + 14, '#80ff90');
    if (pts) this.chip.sfx('bank');
    this.caught = [];
    this.hookY = 60;
    // levels: every 800 points, then wider
    const next = [0, 800, 2000, 3600, 5600, 8000, 11000, 14500, 18500, 23000];
    while (this.level < next.length && this.score >= next[this.level]) {
      this.level++;
      this.banner = { text: `LEVEL ${this.level}`, t: 0 };
      this.chip.sfx('level');
    }
  }

  _pop(text, x, y, col) { this.pops.push({ text, x, y, col, t: 0 }); }

  // --- drawing -----------------------------------------------------------------

  _text(s, x, y, col, scale = 1) {
    const g = this.g;
    g.fillStyle = col;
    let cx = x;
    for (const ch of String(s).toUpperCase()) {
      const f = FONT[ch] || FONT[' '];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (f[j * 3 + i] === '1') g.fillRect(cx + i * scale, y + j * scale, scale, scale);
      cx += 4 * scale;
    }
    return cx;
  }
  _textShadow(s, x, y, col, scale = 1) { this._text(s, x + scale, y + scale, '#101020', scale); return this._text(s, x, y, col, scale); }
  _center(s, y, col, scale = 1) { this._textShadow(s, Math.round((W - String(s).length * 4 * scale) / 2), y, col, scale); }

  _scene(t) {
    const g = this.g;
    // sky and a cloud, the far shore
    g.fillStyle = '#a8d8f8'; g.fillRect(0, 0, W, SURF);
    g.fillStyle = '#e8f8ff';
    const cx = ((t * 3) % (W + 40)) - 20;
    g.fillRect(cx, 12, 18, 4); g.fillRect(cx + 4, 9, 10, 3);
    g.fillStyle = '#5a8a6a'; g.fillRect(0, SURF - 6, W, 6);
    g.fillStyle = '#3a6a4a';
    for (let i = 0; i < W; i += 7) g.fillRect(i, SURF - 8 - ((i * 7) % 5), 4, 3);
    // the pier: planks and piles, the angler at the end
    g.fillStyle = '#6a4a2a'; g.fillRect(0, SURF - 4, 58, 3);
    g.fillStyle = '#4a3018';
    for (const px of [6, 26, 46]) g.fillRect(px, SURF - 1, 3, 30);
    const a = this.spr.angler;
    g.drawImage(a.r, 46, SURF - 4 - a.h);
    // water, in bands, with a moving surface
    const bands = [['#4aa0d8', SURF, 36], ['#2a78b8', SURF + 36, 38], ['#1a4a88', SURF + 74, BED - SURF - 74]];
    for (const [c, y, h] of bands) { g.fillStyle = c; g.fillRect(0, y, W, h); }
    g.fillStyle = '#c8ecff';
    for (let i = 0; i < W; i += 8) g.fillRect(i + Math.round(Math.sin(t * 2 + i) * 2), SURF, 5, 1);
    // light shafts
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 3; i++) { const x = ((i * 57 + t * 6) % (W + 30)) - 15; g.fillRect(x, SURF, 8, 60); }
    // seabed: sand, rocks, kelp swaying
    g.fillStyle = '#c8a870'; g.fillRect(0, BED, W, H - BED);
    g.fillStyle = '#a88850';
    for (let i = 0; i < W; i += 5) g.fillRect(i, BED + 3 + ((i * 3) % 7), 2, 1);
    g.fillStyle = '#50506a'; g.fillRect(12, BED - 5, 14, 6); g.fillRect(118, BED - 4, 18, 5); g.fillRect(122, BED - 7, 8, 3);
    g.fillStyle = '#2a7a3a';
    for (const kx of [34, 70, 104, 146]) {
      for (let j = 0; j < 30; j++) g.fillRect(kx + Math.round(Math.sin(t * 1.6 + j * 0.3 + kx) * (j / 12)), BED - j * 2, 2, 2);
    }
  }

  _draw() {
    const g = this.g, t = this.t;
    this._scene(t + (this.frame || 0) * 0);
    if (this.state === 'title') {
      g.fillStyle = 'rgba(10,10,40,0.55)'; g.fillRect(0, 34, W, 70);
      this._center('PUGET SOUND', 42, '#ffe060', 2);
      this._center('FISHING', 56, '#ffffff', 2);
      if (Math.floor(t * 2) % 2 === 0) this._center('PRESS A', 78, '#ffffff');
      this._center(`BEST ${this.best}`, 92, '#a8d8f8');
      return;
    }
    // everything in the water
    for (const e of this.ents) {
      const s = this.spr[e.kind];
      const wig = KINDS[e.kind].walk ? Math.round(Math.sin(e.ph * 2)) : 0;
      g.drawImage(e.dir > 0 ? s.l : s.r, Math.round(e.x), Math.round(e.y) + wig);
    }
    // the line: rod tip to the surface to the hook, and what hangs on it
    const hy = Math.round(this.hookY);
    g.strokeStyle = '#f8f8f8'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(58.5, SURF - 15.5); g.lineTo(HX + 0.5, SURF + 0.5); g.lineTo(HX + 0.5, hy + 0.5); g.stroke();
    g.fillStyle = '#e8e8e8';
    g.fillRect(HX, hy, 1, 4); g.fillRect(HX - 2, hy + 3, 3, 1); g.fillRect(HX - 2, hy + 1, 1, 2);
    g.fillStyle = '#e84040'; g.fillRect(HX - 1, hy - 3, 3, 2);           // the bobber-red lure
    let cy = hy + 5;
    for (const k of (this.caught || [])) {
      const s = this.spr[k];
      const wig = Math.round(Math.sin(t * 12 + cy) * 1.5);
      g.save(); g.translate(HX + wig, cy); g.rotate(Math.PI / 2); g.drawImage(s.r, 0, -Math.round(s.h / 2)); g.restore();
      cy += s.w - 2;
    }
    // HUD: score, level, the time bar
    g.fillStyle = 'rgba(16,16,48,0.75)'; g.fillRect(0, 0, W, 9);
    this._text(`SCORE ${String(this.score).padStart(6, '0')}`, 2, 2, '#ffffff');
    this._text(`L${this.level}`, 86, 2, '#ffe060');
    const tb = clamp(this.time / TIME0, 0, 1.5);
    g.fillStyle = '#303050'; g.fillRect(100, 2, 57, 5);
    g.fillStyle = this.time < 10 ? (Math.floor(t * 6) % 2 ? '#ff4040' : '#ff9040') : '#50e070';
    g.fillRect(100, 2, Math.round(57 * Math.min(1, tb)), 5);
    for (const p of (this.pops || [])) this._textShadow(p.text, Math.round(p.x), Math.round(p.y - p.t * 12), p.col);
    if (this.banner) this._center(this.banner.text, 50, '#ffe060', 2);
    if (this.state === 'over') {
      g.fillStyle = 'rgba(10,10,40,0.7)'; g.fillRect(8, 30, W - 16, 84);
      this._center('TIME UP!', 38, '#ffe060', 2);
      this._center(`SCORE ${this.score}`, 60, '#ffffff');
      this._center(this.newBest ? 'NEW BEST!' : `BEST ${this.best}`, 70, this.newBest ? '#80ff90' : '#a8d8f8');
      this._center(`EARNED $${this.reward}`, 82, '#ffe060');
      if (this.t > 0.8) this._center('A AGAIN  B LEAVE', 98, '#ffffff');
    }
  }
}
