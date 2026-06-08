import * as THREE from 'three';
import { PLAYER } from './config.js';
import { clamp, lerp, damp } from './utils.js';
import { BASE_FOV } from './engine.js';

// First-person controller. pos = FEET position; the camera rides at eye height.
// Vertical movement samples the walkable surface under the player each frame
// (ramps, platforms, ledges) with a step-up tolerance, and falls via gravity.
export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3(0, 0, 20);
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.airborne = false;
    this.yaw = 0; this.pitch = 0;
    this.hp = PLAYER.maxHp; this.armor = 0;
    this.sensitivity = 0.0016;
    this.crouch = 0;
    this.camPos = new THREE.Vector3();
    this.camYaw = 0;
    this.shake = 0;
    this.bobT = 0; this.stepDist = 0;
    this.bobX = 0; this.bobY = 0;
  }

  reset() {
    this.pos.set(0, 0, 20); this.vel.set(0, 0, 0); this.vy = 0; this.airborne = false;
    this.yaw = 0; this.pitch = 0; this.hp = PLAYER.maxHp; this.armor = 0; this.shake = 0; this.crouch = 0;
  }

  look(dx, dy) {
    const m = 1 - this.game.weapons.adsAmt * 0.55;
    this.yaw -= dx * this.sensitivity * m;
    this.pitch -= dy * this.sensitivity * m;
    this.pitch = clamp(this.pitch, -1.5, 1.5);
  }

  addShake(a) { this.shake = Math.min(1.3, this.shake + a); }
  jump() { if (!this.airborne) { this.vy = PLAYER.jump; this.airborne = true; } }

  update(dt) {
    const k = this.game.input.keys, w = this.game.world, weap = this.game.weapons;
    const fwd = (k['w'] ? 1 : 0) - (k['s'] ? 1 : 0);
    const strafe = (k['d'] ? 1 : 0) - (k['a'] ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let dx = (-sin) * fwd + cos * strafe, dz = (-cos) * fwd + (-sin) * strafe;
    const len = Math.hypot(dx, dz); if (len > 0) { dx /= len; dz /= len; }

    const crouching = !!(k['control'] || k['c']);
    this.crouch = damp(this.crouch, crouching ? 1 : 0, 12, dt);
    const sprint = k['shift'] && fwd > 0 && weap.adsAmt < 0.2 && this.crouch < 0.3 && !this.airborne;
    let spd = sprint ? PLAYER.sprint : PLAYER.walk;
    if (crouching) spd = PLAYER.crouchSpeed;
    if (weap.adsDown) spd *= 0.62;

    this.vel.x = damp(this.vel.x, dx * spd, PLAYER.accel, dt);
    this.vel.z = damp(this.vel.z, dz * spd, PLAYER.accel, dt);

    const step = PLAYER.stepUp, r = PLAYER.radius;
    let nx = this.pos.x + this.vel.x * dt;
    if (!w.blocked(nx, this.pos.z, this.pos.y, r, step)) this.pos.x = nx; else this.vel.x = 0;
    let nz = this.pos.z + this.vel.z * dt;
    if (!w.blocked(this.pos.x, nz, this.pos.y, r, step)) this.pos.z = nz; else this.vel.z = 0;

    // vertical
    if (!this.airborne) {
      const gy = w.sampleFloor(this.pos.x, this.pos.z, this.pos.y + step + 0.1);
      if (gy !== null && gy <= this.pos.y + step) {
        if (gy >= this.pos.y - PLAYER.stepDown) { this.pos.y = gy; this.vy = 0; }
        else { this.airborne = true; this.vy = 0; }
      } else if (gy === null) { this.airborne = true; this.vy = 0; }
    }
    if (this.airborne) {
      this.vy -= PLAYER.gravity * dt; this.pos.y += this.vy * dt;
      const land = w.sampleFloor(this.pos.x, this.pos.z, this.pos.y + step + 0.1);
      if (land !== null && this.vy <= 0 && this.pos.y <= land) { this.pos.y = land; this.vy = 0; this.airborne = false; }
      if (this.pos.y < -28) { this.pos.set(0, 3, 0); this.vy = 0; this.takeDamage(12, 0, 0, true); }
    }

    // camera rig
    const moving = len > 0 && !this.airborne;
    const moveSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (moving) this.bobT += dt * (sprint ? 15 : 11);
    else this.bobT = damp(this.bobT, Math.round(this.bobT / Math.PI) * Math.PI, 8, dt);
    const ads = weap.adsAmt, bobAmp = 1 - ads * 0.7;
    this.bobX = Math.cos(this.bobT) * 0.02 * (moving ? 1 : 0) * bobAmp;
    this.bobY = Math.abs(Math.sin(this.bobT)) * 0.03 * (moving ? 1 : 0) * bobAmp;

    if (moving) {
      this.stepDist += moveSpeed * dt;
      const stride = sprint ? 2.0 : 2.6;
      if (this.stepDist > stride) { this.stepDist = 0; this.game.audio.pStep(0.9 + Math.random() * 0.2); }
    } else this.stepDist = 0;

    const eye = PLAYER.eye - this.crouch * 0.5;
    this.shake = Math.max(0, this.shake - dt * 2.6);
    const sx = (Math.random() - 0.5) * this.shake * 0.1, sy = (Math.random() - 0.5) * this.shake * 0.1;
    const cam = this.game.engine.camera;
    cam.position.set(this.pos.x + sx, this.pos.y + eye + this.bobY * 0.4 + sy, this.pos.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + weap.recoil.yaw;
    cam.rotation.x = this.pitch + weap.recoil.pitch + (Math.random() - 0.5) * this.shake * 0.018;
    cam.rotation.z = 0;
    cam.fov = lerp(BASE_FOV, weap.current.adsFov, ads);
    cam.updateProjectionMatrix();
    cam.getWorldPosition(this.camPos); this.camYaw = this.yaw;
  }

  takeDamage(amount, sx, sz, silent) {
    if (this.game.state !== 'playing') return;
    amount = Math.round(amount);
    if (this.armor > 0) { const ab = Math.min(this.armor, amount * 0.6); this.armor -= ab; amount -= ab; }
    this.hp -= amount;
    if (!silent) this.game.audio.hurt();
    this.addShake(0.5);
    this.game.hud.damageFlash(amount);
    this.game.hud.damageDir(sx, sz);
    this.game.hud.vitals();
    if (this.hp <= 0) { this.hp = 0; this.game.hud.vitals(); this.game.over(); }
  }
}
