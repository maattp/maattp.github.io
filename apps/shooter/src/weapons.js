import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { ViewModel } from './viewmodel.js';
import { clamp, lerp, damp, rand } from './utils.js';

export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.weapons = WEAPONS;
    this.idx = 0;
    this.vm = new ViewModel(game);
    this.adsAmt = 0;
    this.recoil = { pitch: 0, yaw: 0 };
    this.bloom = 0;
    this.shootTimer = 0;
    this.reloading = false; this.reloadTimer = 0; this.reloadDur = 1;
    this.raycaster = new THREE.Raycaster();
    this._camPos = new THREE.Vector3(); this._camDir = new THREE.Vector3();
    this._right = new THREE.Vector3(); this._upv = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
    this._muzzle = new THREE.Vector3(); this._end = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._dmgSet = new Set();
    // ejected energy cells
    this.cells = []; const cg = new THREE.BoxGeometry(0.05, 0.05, 0.1);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0x46f9ff, toneMapped: false, transparent: true }));
      m.visible = false; game.engine.scene.add(m);
      this.cells.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, spin: 0 });
    }
    this.ccursor = 0; this._ej = new THREE.Vector3();
    this.vm.build(this.current);
  }

  get current() { return this.weapons[this.idx]; }
  get adsDown() { return this.game.input.adsDown && this.game.state === 'playing'; }

  effectiveSpread(w) {
    let s = w.spread + this.bloom;
    const p = this.game.player, ms = Math.hypot(p.vel.x, p.vel.z);
    s += ms * 0.0016; if (p.airborne) s += 0.02; s *= (1 - this.adsAmt * 0.75);
    return s;
  }

  fire() {
    const w = this.current;
    if (this.reloading || this.shootTimer > 0 || this.game.state !== 'playing') return;
    if (w.ammo <= 0) { this.game.audio.empty(); this.game.hud.reloadHint(true); this.game.input.mouseDown = false; if (w.reserve > 0) this.startReload(); return; }
    w.ammo--; this.shootTimer = w.rof; this.game.stats.shotsFired++;
    const cam = this.game.engine.camera;
    cam.getWorldPosition(this._camPos); cam.getWorldDirection(this._camDir);
    this._right.crossVectors(this._camDir, this._up).normalize();
    this._upv.crossVectors(this._right, this._camDir).normalize();
    this.vm.muzzleWorld(this._muzzle);
    const sp = this.effectiveSpread(w);
    for (let p = 0; p < w.pellets; p++) this._ray(w, sp);
    this.recoil.pitch += w.recoilV * (1 - this.adsAmt * 0.3);
    this.recoil.yaw += rand(-w.recoilH, w.recoilH) * (1 - this.adsAmt * 0.3);
    this.bloom = Math.min(w.bloomMax, this.bloom + w.bloomShot);
    this.vm.fireKick();
    const ml = this.game.engine.muzzle; ml.color.setHex(w.color); ml.intensity = 2.8; ml.position.copy(this._muzzle);
    this._ejectCell(w.color); this.game.player.addShake(w.kick * 0.5);
    this.game.audio.shoot(w); if (w.id === 'rail') this.game.audio.charge();
    this.game.hud.ammo();
    if (w.ammo <= 0) { this.game.hud.reloadHint(true); this.game.input.mouseDown = false; if (w.reserve > 0) this.startReload(); }
  }

  _ray(w, sp) {
    this._d.copy(this._camDir);
    if (sp > 0) this._d.addScaledVector(this._right, rand(-1, 1) * sp).addScaledVector(this._upv, rand(-1, 1) * sp).normalize();
    this.raycaster.set(this._camPos, this._d); this.raycaster.far = w.range;
    const eHits = this.raycaster.intersectObjects(this.game.enemies.bodyMeshes, false);
    const wHits = this.raycaster.intersectObjects(this.game.world.walkables, false);
    const wallDist = wHits.length ? wHits[0].distance : Infinity;
    let pierce = w.pierce, hitAny = false, endpoint = null; this._dmgSet.clear();
    for (const h of eHits) {
      if (pierce <= 0) break; if (h.distance > wallDist) break;
      const e = h.object.userData.enemyRef; if (!e || e.state !== 'active') continue;
      if (this._dmgSet.has(e)) { endpoint = h.point; continue; }
      this._dmgSet.add(e);
      const head = !!h.object.userData.head;
      let dmg = this._dmg(w); if (head) dmg *= 1.8; if (this.game.powerTimers.insta > 0) dmg = 999999;
      const killed = this.game.enemies.damage(e, dmg, h.point, head);
      this.game.hud.hitmarker(killed ? (head ? 'head' : 'kill') : (head ? 'head' : false));
      hitAny = true; pierce--; endpoint = h.point;
    }
    let impactFn = null;
    if (!hitAny && wallDist !== Infinity) {
      const wp = wHits[0], n = wp.face ? wp.face.normal : this._upv, ex = wp.point.x, ey = wp.point.y, ez = wp.point.z;
      endpoint = wp.point.clone();
      impactFn = () => { this.game.effects.spark(ex, ey, ez, n.x, Math.abs(n.y) + 0.3, n.z, 7, w.color); this.game.audio.impactW(ex, ez); };
    } else if (hitAny) { const ep = endpoint.clone(); impactFn = () => this.game.audio.impactE(ep.x, ep.z); }
    if (!endpoint) { this._end.copy(this._camPos).addScaledVector(this._d, w.range); endpoint = this._end.clone(); }
    this.game.effects.tracer(this._muzzle, endpoint, w.color, impactFn);
    if (hitAny) this.game.stats.shotsHit++;
  }
  _dmg(w) { return w.dmg * (1 + w.dmgLvl * 0.3); }

  _ejectCell(color) {
    const c = this.cells[this.ccursor]; this.ccursor = (this.ccursor + 1) % this.cells.length;
    this.vm.ejectWorld(this._ej);
    c.mesh.position.copy(this._ej); c.mesh.material.color.setHex(color); c.mesh.material.opacity = 1;
    const yaw = this.game.player.camYaw, rx = Math.cos(yaw), rz = -Math.sin(yaw);
    c.vx = rx * rand(2, 3.5) + rand(-0.5, 0.5); c.vz = rz * rand(2, 3.5) + rand(-0.5, 0.5); c.vy = rand(1.5, 3);
    c.life = 1; c.spin = rand(-20, 20); c.mesh.visible = true;
  }
  _updateCells(dt) {
    for (const c of this.cells) {
      if (c.life <= 0) continue; c.life -= dt; c.vy -= 14 * dt;
      c.mesh.position.x += c.vx * dt; c.mesh.position.y += c.vy * dt; c.mesh.position.z += c.vz * dt;
      c.mesh.rotation.x += c.spin * dt; c.mesh.rotation.z += c.spin * dt;
      c.mesh.material.opacity = Math.max(0, c.life);
      if (c.mesh.position.y < 0.05) { c.mesh.position.y = 0.05; c.vy *= -0.3; c.vx *= 0.6; c.vz *= 0.6; }
      if (c.life <= 0) c.mesh.visible = false;
    }
  }

  startReload() {
    const w = this.current;
    if (this.reloading || w.ammo >= w.mag || w.reserve <= 0 || this.game.state !== 'playing') return;
    this.reloading = true; this.reloadDur = w.reloadT; this.reloadTimer = w.reloadT;
    this.game.audio.reloadOut(); this.game.hud.reloadHint(false);
  }
  finishReload() {
    const w = this.current, need = w.mag - w.ammo, take = Math.min(need, w.reserve);
    w.ammo += take; w.reserve -= take; this.reloading = false; this.game.audio.reloadIn(); this.game.hud.ammo();
  }
  switchTo(i) {
    if (i < 0 || i >= this.weapons.length || !this.weapons[i].owned || i === this.idx) return;
    this.idx = i; this.reloading = false; this.bloom = 0; this.vm.build(this.current); this.game.hud.ammo(); this.game.audio.switchW();
  }
  cycle(d) {
    const owned = this.weapons.map((w, i) => w.owned ? i : -1).filter(i => i >= 0);
    const pos = owned.indexOf(this.idx); this.switchTo(owned[(pos + d + owned.length) % owned.length]);
  }
  refillReserve(w) { w.reserve = w.reserveMax; this.game.hud.ammo(); }

  update(dt) {
    if (this.shootTimer > 0) this.shootTimer -= dt;
    if (this.reloading) { this.reloadTimer -= dt; if (this.reloadTimer <= 0) this.finishReload(); }
    this.adsAmt = damp(this.adsAmt, this.adsDown ? 1 : 0, 16, dt);
    if (this.game.input.mouseDown && this.current.auto) this.fire();
    this.recoil.pitch = damp(this.recoil.pitch, 0, 9, dt);
    this.recoil.yaw = damp(this.recoil.yaw, 0, 9, dt);
    this.bloom = damp(this.bloom, 0, 6, dt);
    const p = this.game.player;
    const strafe = (this.game.input.keys['d'] ? 1 : 0) - (this.game.input.keys['a'] ? 1 : 0);
    this.vm.update(dt, {
      adsAmt: this.adsAmt, bobX: p.bobX, bobY: p.bobY, reloading: this.reloading,
      reloadProg: this.reloading ? 1 - this.reloadTimer / this.reloadDur : 0, sway: -strafe * 0.05 * (1 - this.adsAmt),
    });
    this._updateCells(dt);
    const ml = this.game.engine.muzzle; if (ml.intensity > 0) ml.intensity = Math.max(0, ml.intensity - dt * 40);
    this.game.hud.crosshair(this.effectiveSpread(this.current), this.adsAmt, this.current);
  }

  reset() {
    this.weapons.forEach((w, i) => { w.owned = (i === 0); w.dmgLvl = 0; w.ammo = w.mag; });
    this.weapons[0].reserve = 90; this.weapons[1].reserve = 180; this.weapons[2].reserve = 35; this.weapons[3].reserve = 25;
    this.idx = 0; this.reloading = false; this.shootTimer = 0; this.bloom = 0;
    this.recoil.pitch = 0; this.recoil.yaw = 0; this.adsAmt = 0;
    for (const c of this.cells) { c.life = 0; c.mesh.visible = false; }
    this.vm.build(this.current);
  }
}
