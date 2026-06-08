import { $, clamp, hex } from './utils.js';
import { PLAYER } from './config.js';

export class HUD {
  constructor(game) {
    this.game = game;
    this.radar = $('radar'); this.rctx = this.radar.getContext('2d');
    this.dd = $('dmgDir'); this.ddctx = this.dd.getContext('2d');
    this.dmgDirs = [];
    this.hitTimer = 0;
    this.sizeDmg();
    addEventListener('resize', () => this.sizeDmg());
  }
  sizeDmg() { this.dd.width = innerWidth; this.dd.height = innerHeight; }
  on(v) { $('hud').classList.toggle('on', v); }

  vitals() {
    const p = this.game.player;
    $('hpFill').style.transform = `scaleX(${clamp(p.hp / PLAYER.maxHp, 0, 1)})`;
    $('arFill').style.transform = `scaleX(${clamp(p.armor / PLAYER.maxArmor, 0, 1)})`;
  }
  ammo() {
    const w = this.game.weapons.current, a = $('ammo');
    a.innerHTML = `${w.ammo}<span class="res">/${w.reserve}</span>`;
    a.classList.toggle('low', w.ammo <= Math.ceil(w.mag * 0.25));
    $('wName').textContent = w.name;
    this.reloadHint(w.ammo <= 0 && w.reserve > 0);
  }
  reloadHint(on) { $('reloadHint').classList.toggle('on', !!on); }

  addScore(n) { this.game.stats.score += n; $('scoreVal').textContent = this.game.stats.score.toLocaleString(); }
  addCredits(n) {
    if (this.game.powerTimers.double > 0) n = Math.round(n * 1.5);
    this.game.stats.credits += n; $('credVal').textContent = this.game.stats.credits.toLocaleString();
  }
  registerCombo() {
    const s = this.game.stats; s.combo++; s.comboTimer = 4; s.bestCombo = Math.max(s.bestCombo, s.combo);
    const t = $('comboTag'); t.textContent = 'x' + this.comboMult().toFixed(s.combo >= 4 ? 1 : 0); t.style.opacity = s.combo > 1 ? 1 : 0;
  }
  comboMult() { return 1 + Math.min(this.game.stats.combo * 0.1, 2); }
  updateCombo(dt) {
    const s = this.game.stats;
    if (s.comboTimer > 0) { s.comboTimer -= dt; if (s.comboTimer <= 0) { s.combo = 0; $('comboTag').style.opacity = 0; } }
  }

  hitmarker(kind) {
    const h = $('hitmark'); h.classList.toggle('kill', kind === 'kill'); h.classList.toggle('head', kind === 'head');
    h.style.opacity = 1; this.hitTimer = kind ? 0.22 : 0.12;
  }
  updateHitmark(dt) { if (this.hitTimer > 0) { this.hitTimer -= dt; if (this.hitTimer <= 0) $('hitmark').style.opacity = 0; } }

  crosshair(spread, ads, w) {
    const px = clamp(spread * 900, 0, 40), scaleN = 1 + px / 14;
    const c = $('cross');
    c.style.transform = `translate(-50%,-50%) scale(${(1 - ads) * scaleN + ads * 0.4})`;
    c.style.opacity = ads > 0.6 && w.id === 'rail' ? 0 : 1;
    $('scope').style.opacity = w.id === 'rail' ? ads : 0;
  }

  feed(text, color) {
    const f = $('feed'), d = document.createElement('div'); d.textContent = text; d.style.color = color || '#bdecff';
    f.prepend(d); while (f.children.length > 5) f.removeChild(f.lastChild);
    setTimeout(() => { if (d.parentNode) { d.style.transition = 'opacity .5s'; d.style.opacity = 0; setTimeout(() => d.remove(), 500); } }, 3000);
  }
  banner(big, small, color) {
    const b = $('banner'); b.querySelector('.big').textContent = big;
    b.querySelector('.big').style.color = color || '#fff';
    b.querySelector('.big').style.textShadow = `0 0 24px ${color || '#ff4ddb'}, 0 0 50px ${(color || '#ff4ddb')}88`;
    b.querySelector('.small').textContent = small || '';
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  damageFlash(amount) {
    $('vignette').style.opacity = Math.min(0.9, 0.3 + amount * 0.02);
    setTimeout(() => { if (this.game.state === 'playing') $('vignette').style.opacity = 0; }, 140);
  }
  damageDir(sx, sz) {
    const p = this.game.player;
    this.dmgDirs.push({ ang: Math.atan2(sx - p.pos.x, -(sz - p.pos.z)), t: 1 });
  }
  drawDamageDir(dt) {
    const cx = this.dd.width / 2, cy = this.dd.height / 2;
    this.ddctx.clearRect(0, 0, this.dd.width, this.dd.height);
    for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
      const d = this.dmgDirs[i]; d.t -= dt * 1.2; if (d.t <= 0) { this.dmgDirs.splice(i, 1); continue; }
      this.ddctx.save(); this.ddctx.translate(cx, cy); this.ddctx.rotate(d.ang - this.game.player.yaw);
      this.ddctx.globalAlpha = d.t * 0.8; this.ddctx.strokeStyle = '#ff2d5b'; this.ddctx.lineWidth = 5;
      this.ddctx.shadowColor = '#ff2d5b'; this.ddctx.shadowBlur = 12;
      this.ddctx.beginPath(); this.ddctx.arc(0, 0, 120, -0.5, 0.5); this.ddctx.stroke(); this.ddctx.restore();
    }
  }
  drawRadar() {
    const ctx = this.rctx, p = this.game.player, RR = 56;
    ctx.clearRect(0, 0, 132, 132); ctx.save(); ctx.translate(66, 66);
    ctx.strokeStyle = '#1c5a7a55'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, 7); ctx.arc(0, 0, 60, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-62, 0); ctx.lineTo(62, 0); ctx.moveTo(0, -62); ctx.lineTo(0, 62); ctx.stroke();
    ctx.rotate(-p.yaw);
    for (const e of this.game.enemies.list) {
      if (e.state === 'dying') continue;
      const dx = e.root.position.x - p.pos.x, dz = e.root.position.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > RR) continue;
      ctx.fillStyle = hex(e.def.accent);
      ctx.beginPath(); ctx.arc(dx / RR * 60, dz / RR * 60, e.type === 'brute' ? 3.6 : 2.4, 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#7affc4'; ctx.beginPath(); ctx.moveTo(66, 58); ctx.lineTo(62, 70); ctx.lineTo(70, 70); ctx.closePath(); ctx.fill();
  }

  updatePowerHUD(dt) {
    const pt = this.game.powerTimers;
    for (const k in pt) if (pt[k] > 0) { pt[k] -= dt; if (pt[k] < 0) pt[k] = 0; }
    const wrap = $('powerups'); wrap.innerHTML = '';
    const map = { double: ['2X POINTS', '#ff4ddb'], insta: ['INSTA-KILL', '#ffffff'] };
    for (const k in map) if (pt[k] > 0) {
      const d = document.createElement('div'); d.className = 'puTag'; d.style.color = map[k][1];
      d.textContent = `${map[k][0]} ${Math.ceil(pt[k])}s`; wrap.appendChild(d);
    }
    const hpRatio = this.game.player.hp / PLAYER.maxHp;
    $('lowhp').style.opacity = hpRatio < 0.35 ? (0.35 + Math.sin(performance.now() / 200) * 0.2) * (1 - hpRatio / 0.35) : 0;
  }

  update(dt) {
    this.updateHitmark(dt); this.updateCombo(dt); this.updatePowerHUD(dt);
    this.drawDamageDir(dt); this.drawRadar();
  }
  resetDom() {
    $('scoreVal').textContent = '0'; $('credVal').textContent = this.game.stats.credits.toLocaleString();
    $('comboTag').style.opacity = 0; $('feed').innerHTML = ''; $('powerups').innerHTML = '';
    $('lowhp').style.opacity = 0; $('vignette').style.opacity = 0;
    this.vitals(); this.ammo();
  }
}
