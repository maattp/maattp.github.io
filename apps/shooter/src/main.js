import * as THREE from 'three';
import { Engine } from './engine.js';
import { World } from './world.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { EnemyManager } from './enemies.js';
import { WeaponSystem } from './weapons.js';
import { HUD } from './hud.js';
import { Pickups } from './pickups.js';
import { WaveDirector } from './waves.js';
import { Shop } from './shop.js';
import { $ } from './utils.js';

class Game {
  constructor(quality) {
    this.quality = quality;
    this.state = 'menu';
    this.powerTimers = { double: 0, insta: 0 };
    this.stats = { score: 0, credits: 0, kills: 0, headshots: 0, shotsFired: 0, shotsHit: 0, combo: 0, comboTimer: 0, bestCombo: 0 };
    this._intentionalUnlock = false;

    this.engine = new Engine(quality);
    this.audio = new AudioEngine(this);
    this.world = new World(this.engine.scene, quality);
    this.effects = new Effects(this);
    this.player = new Player(this);
    this.weapons = new WeaponSystem(this);
    this.enemies = new EnemyManager(this);
    this.waves = new WaveDirector(this);
    this.pickups = new Pickups(this);
    this.hud = new HUD(this);
    this.shop = new Shop(this);
    this.input = new Input(this);
  }

  // ---- score plumbing called by EnemyManager.kill ----
  onKill(e, head) {
    this.stats.kills++; if (head) this.stats.headshots++;
    let mult = this.hud.comboMult();
    if (this.powerTimers.double > 0) mult *= 2;
    this.hud.addScore(Math.round(e.score * mult * (head ? 1.5 : 1)));
    this.hud.addCredits(e.reward);
    this.hud.registerCombo();
    this.pickups.maybeDrop(e.root.position.x, e.feetY, e.root.position.z);
    this.waves.notifyKill();
  }

  reset() {
    this.player.reset(); this.weapons.reset(); this.enemies.reset();
    this.effects.reset(); this.pickups.reset(); this.waves.reset(); this.input.reset();
    this.stats = { score: 0, credits: 500, kills: 0, headshots: 0, shotsFired: 0, shotsHit: 0, combo: 0, comboTimer: 0, bestCombo: 0 };
    this.powerTimers.double = 0; this.powerTimers.insta = 0;
    this.hud.resetDom();
  }

  start() {
    this.audio.init(); this.audio.resume();
    this.reset();
    this.state = 'playing'; this.hud.on(true); this._screen(null);
    this._requestLock(); this.waves.start(1);
  }
  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this._screen('pause'); this.input.mouseDown = false; this.input.adsDown = false;
    $('sensSlider2').value = Math.round(this.player.sensitivity * 60000); $('sensVal2').textContent = (this.player.sensitivity * 1000).toFixed(2); }
  resume() { if (this.state !== 'paused') return; this.state = 'playing'; this._screen(null); this._requestLock(); }
  over() {
    this.state = 'dead'; this.hud.on(false); this.input.mouseDown = false; this.input.adsDown = false;
    this._intentionalUnlock = true; document.exitPointerLock && document.exitPointerLock();
    const s = this.stats;
    $('ovWave').textContent = Math.max(1, this.waves.waveNum); $('ovScore').textContent = s.score.toLocaleString();
    $('ovKills').textContent = s.kills; $('ovHs').textContent = s.headshots;
    $('ovCombo').textContent = 'x' + (1 + Math.min(s.bestCombo * 0.1, 2)).toFixed(1);
    $('ovAcc').textContent = (s.shotsFired ? Math.round(s.shotsHit / s.shotsFired * 100) : 0) + '%';
    this._screen('over'); this.audio.death();
  }
  quit() {
    this.state = 'menu'; this.hud.on(false); this._intentionalUnlock = true;
    document.exitPointerLock && document.exitPointerLock(); this._screen('start'); $('loadMsg').textContent = '';
  }
  openBuy() {
    this.state = 'buy'; this.input.mouseDown = false; this.input.adsDown = false;
    this._intentionalUnlock = true; document.exitPointerLock && document.exitPointerLock();
    this.shop.render(); this._screen('buy');
  }
  closeBuy() { this.state = 'playing'; this._screen(null); this._requestLock(); }

  _screen(id) { for (const s of ['start', 'pause', 'buy', 'over']) $(s).classList.toggle('hidden', s !== id); }
  _requestLock() { try { const p = this.engine.canvas.requestPointerLock && this.engine.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }

  _menuCam(t) {
    const cam = this.engine.camera, r = 60;
    cam.position.set(Math.cos(t * 0.08) * r, 30, Math.sin(t * 0.08) * r);
    cam.lookAt(0, 6, 0);
  }

  frame(dt, t) {
    if (this.state === 'playing') {
      this.player.update(dt); this.weapons.update(dt); this.enemies.update(dt, t);
      this.pickups.update(dt); this.waves.update(dt); this.hud.update(dt);
    } else if (this.state === 'menu') {
      this._menuCam(t);
    }
    this.effects.update(dt);
    if (this.state !== 'dead') this.engine.render(t);
  }
}

// ===================== boot =====================
const desktopOK = ('pointerLockElement' in document) && matchMedia('(pointer: fine)').matches;
if (desktopOK) $('loadMsg').textContent = 'ready · click INITIALIZE';
else {
  $('startBtn').style.display = 'none';
  $('loadMsg').innerHTML = '⌨️ + 🖱️&nbsp; DESKTOP ONLY<br>Neon Siege needs a keyboard &amp; mouse (pointer lock).<br>Open it on a Mac or PC.';
  $('loadMsg').style.color = '#ff7a3c'; $('loadMsg').style.lineHeight = '1.9';
}

let game = null, raf = null, pendingSens = 0.0016;
const clock = new THREE.Clock();
function loop() { raf = requestAnimationFrame(loop); if (game) { let dt = clock.getDelta(); if (dt > 0.05) dt = 0.05; game.frame(dt, clock.elapsedTime); } }

function ensureGame() {
  if (game) return;
  game = new Game($('qualitySel').value);
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') window.__game = game; // debug handle (local only)
  game.player.sensitivity = pendingSens;
  if (!raf) loop();
}

function applySens(v) {
  pendingSens = v / 60000; const s = (pendingSens * 1000).toFixed(2);
  $('sensVal').textContent = s; $('sensVal2').textContent = s; $('sensSlider').value = v; $('sensSlider2').value = v;
  if (game) game.player.sensitivity = pendingSens;
}
$('sensSlider').oninput = e => applySens(+e.target.value);
$('sensSlider2').oninput = e => applySens(+e.target.value);
applySens(95);

$('startBtn').onclick = () => { ensureGame(); game.start(); };
$('retryBtn').onclick = () => { ensureGame(); game.start(); };
$('resumeBtn').onclick = () => game && game.resume();
$('quitBtn').onclick = () => game && game.quit();
$('buyCloseBtn').onclick = () => game && game.closeBuy();

// lightweight fps meter
let fpsC = 0, fpsT = 0, fpsLast = performance.now();
(function fpsTick() {
  requestAnimationFrame(fpsTick);
  fpsC++; const now = performance.now();
  if (now - fpsLast >= 500) { $('fps').textContent = Math.round(fpsC / ((now - fpsLast) / 1000)) + ' fps'; fpsC = 0; fpsLast = now; }
})();
