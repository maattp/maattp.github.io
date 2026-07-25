// The player: on foot, behind the wheel, and the chase camera that follows.

import * as THREE from './three.js';
import { makeHumanoid, animateWalk } from './peds.js';
import { collideWithBuildings } from './traffic.js';
import { clamp, lerp, angleWrap, damp, dist2 } from './util.js';
import * as G from './geo.js';

export class Player {
  constructor(scene, city, game) {
    this.scene = scene;
    this.city = city;
    this.game = game;
    this.h = makeHumanoid({ seed: 1, shirt: [0.15, 0.18, 0.24], pants: [0.12, 0.13, 0.16], hair: [0.1, 0.08, 0.07], scale: 1.02, animateArms: true });
    scene.add(this.h.group);
    this.x = G.SPAWN.x;
    this.z = G.SPAWN.z;
    this.y = city.groundAt(this.x, this.z, null);
    this.heading = 2.58; // pointed down 4th Ave, toward Pioneer Square
    this.vy = 0;
    this.grounded = true;
    this.phase = 0;
    this.speed = 0;
    this.onFoot = true;
    this.vehicle = null;
    this.health = 100;
    this.armed = false;
    this.ammo = 0;
    this.attackCd = 0;
    this.enterCd = 0;
    this.dead = false;

    this.camYaw = this.heading + Math.PI;
    this.camPitch = 0.1;
    this.camDist = 6.5;
    this.camPos = new THREE.Vector3(this.x + Math.sin(this.camYaw) * 4.6, this.y + 1.6, this.z + Math.cos(this.camYaw) * 4.6);
    this.camLook = new THREE.Vector3(this.x, this.y + 1.4, this.z);
  }

  get position() {
    return this.onFoot ? { x: this.x, y: this.y, z: this.z } : { x: this.vehicle.x, y: this.vehicle.y, z: this.vehicle.z };
  }

  enterVehicle(v) {
    if (!v || v.dead) return false;
    this.vehicle = v;
    v.mode = 'free';
    v.setDetailed(true);
    this.onFoot = false;
    this.h.group.visible = false;
    this.game.onEnterVehicle(v);
    return true;
  }

  exitVehicle() {
    const v = this.vehicle;
    if (!v) return;
    const f = v.forward;
    const rx = f.z, rz = -f.x;
    let ox = v.x - rx * (v.halfWid + 1.1);
    let oz = v.z - rz * (v.halfWid + 1.1);
    this.x = G.clampToMap(ox);
    this.z = G.clampToMap(oz);
    this.y = this.city.groundAt(this.x, this.z, v.y + 1.5);
    this.heading = v.heading;
    this.onFoot = true;
    this.h.group.visible = true;
    v.mode = 'free';
    v.setDetailed(false);
    this.vehicle = null;
    this.game.onExitVehicle(v);
  }

  update(dt, input, look, controls, traffic, peds) {
    this.attackCd -= dt;
    this.enterCd -= dt;

    this.camYaw -= look.x;
    this.camPitch = clamp(this.camPitch + look.y, -0.5, 1.15);

    if (this.onFoot) this.updateFoot(dt, input, traffic, peds);
    else this.updateDrive(dt, input, traffic, peds);

    const tap = controls.takeTap();
    if (tap === 'enter' && this.enterCd <= 0) {
      this.enterCd = 0.45;
      if (this.onFoot) {
        const v = traffic.nearestEnterable(this.x, this.z, 5.0);
        if (v) this.enterVehicle(v);
      } else this.exitVehicle();
    }

    if (input.attack && this.attackCd <= 0) this.attack(traffic, peds);
    this.updateCamera(dt, input);
  }

  updateFoot(dt, input, traffic, peds) {
    const mag = Math.hypot(input.x, input.y);
    const run = input.sprint ? 6.4 : 3.3;
    let target = 0;
    if (mag > 0.12) {
      // Stick is camera-relative. Note HEADING_SENSE: heading is three.js
      // rotation.y, so a LARGER heading turns anticlockwise = left on screen.
      // Pushing the stick right therefore has to subtract from the heading.
      const ang = Math.atan2(-input.x, -input.y) + this.camYaw + Math.PI;
      this.heading += clamp(angleWrap(ang - this.heading), -10 * dt, 10 * dt);
      target = run * clamp(mag, 0, 1);
    }
    this.speed = damp(this.speed, target, 9, dt);
    const nx = this.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.z + Math.cos(this.heading) * this.speed * dt;
    if (!this.blocked(nx, nz)) {
      this.x = G.clampToMap(nx);
      this.z = G.clampToMap(nz);
    } else if (!this.blocked(nx, this.z)) this.x = G.clampToMap(nx);
    else if (!this.blocked(this.x, nz)) this.z = G.clampToMap(nz);

    const ground = this.city.groundAt(this.x, this.z, this.y + 1.2);
    if (input.jump && this.grounded) {
      this.vy = 6.2;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.vy -= 20 * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) { this.y = ground; this.vy = 0; this.grounded = true; }
    } else {
      this.y = lerp(this.y, ground, 1 - Math.exp(-16 * dt));
    }

    // drowning
    if (this.y < -0.6 && G.isWater(this.x, this.z)) this.game.onDrown();

    this.phase += this.speed * 2.2 * dt;
    animateWalk(this.h, this.phase, clamp(this.speed * 0.16, 0, 0.9), dt);
    this.h.group.position.set(this.x, this.y, this.z);
    this.h.group.rotation.y = this.heading;

    // run over by a car
    for (const v of traffic.cars) {
      if (v.mode === 'parked' || Math.abs(v.vLong) < 3) continue;
      const n = v.nearest(this.x, this.z);
      if (dist2(n.x, n.z, this.x, this.z) < 0.8) {
        this.game.damagePlayer(Math.abs(v.vLong) * 1.6, 'vehicle');
        this.x -= v.forward.x * 1.4;
        this.z -= v.forward.z * 1.4;
      }
    }
  }

  blocked(x, z) {
    const near = this.city.buildingsNear(x, z, 6);
    for (const b of near) {
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.w / 2 + 0.35 && Math.abs(lz) < b.d / 2 + 0.35 && this.y < b.y + b.h - 0.5) return true;
    }
    return false;
  }

  updateDrive(dt, input, traffic, peds) {
    const v = this.vehicle;
    if (!v) { this.onFoot = true; this.h.group.visible = true; return; }
    const steer = -input.x; // HEADING_SENSE: +steer raises heading, which is a left turn
    const throttle = input.gas ? 1 : 0;
    const brake = input.brake ? 1 : 0;
    v.update(dt, { throttle, brake, steer, handbrake: input.hand ? 1 : 0 });
    const impact = collideWithBuildings(v, this.city, (imp) => this.game.onCrash(imp, false));
    if (impact > 8) this.game.damagePlayer(impact * 0.5, 'crash');
    if (v.y < -1.2 && G.isWater(v.x, v.z)) this.game.onCarSank(v);
    if (v.dead) this.game.onCarDestroyed(v);
  }

  attack(traffic, peds) {
    if (this.onFoot) {
      if (this.armed && this.ammo > 0) {
        this.attackCd = 0.22;
        this.ammo--;
        const dir = { x: -Math.sin(this.camYaw), z: -Math.cos(this.camYaw) };
        this.heading = this.camYaw + Math.PI;
        this.game.onGunshot(this.x, this.y + 1.4, this.z, dir);
        // hitscan against peds and cars
        for (let t = 2; t < 60; t += 1.2) {
          const hx = this.x + dir.x * t, hz = this.z + dir.z * t;
          const p = peds.hitAt(hx, hz, 0.9, 34, true);
          if (p) return;
          for (const v of traffic.cars) {
            if (dist2(v.x, v.z, hx, hz) < v.radius * v.radius) {
              v.damage(9);
              this.game.onShotVehicle(v, hx, hz);
              return;
            }
          }
        }
      } else {
        this.attackCd = 0.5;
        this.game.onPunch();
        const fx = this.x + Math.sin(this.heading) * 1.2;
        const fz = this.z + Math.cos(this.heading) * 1.2;
        peds.hitAt(fx, fz, 1.1, 18, true);
      }
    } else {
      this.attackCd = 0.4;
      this.game.onHorn();
    }
  }

  updateCamera(dt, input) {
    const target = new THREE.Vector3();
    let dist, height, lookH;
    if (this.onFoot) {
      target.set(this.x, this.y, this.z);
      dist = 4.6;
      height = 1.55;
      lookH = 1.45;
    } else {
      const v = this.vehicle;
      target.set(v.x, v.y, v.z);
      const sp = Math.abs(v.vLong);
      dist = 7.6 + v.spec.len * 0.42 + clamp(sp * 0.09, 0, 3.4);
      height = 3.2 + v.spec.bodyH * 0.7;
      lookH = 1.05;
      // ease the camera behind the car when driving forward
      if (v.vLong > 3) {
        const want = v.heading + Math.PI;
        const d = angleWrap(want - this.camYaw);
        this.camYaw += d * clamp(dt * 1.5 * clamp(sp / 12, 0, 1), 0, 0.25);
      }
    }
    const cp = Math.cos(this.camPitch);
    // Pull the camera in if a building sits between it and the player -- without
    // this you spend half of downtown looking at the inside of a wall.
    dist = this.clearCamDist(target, dist * cp, height) / Math.max(cp, 0.15);
    const wanted = new THREE.Vector3(
      target.x + Math.sin(this.camYaw) * dist * cp,
      target.y + height + Math.sin(this.camPitch) * dist,
      target.z + Math.cos(this.camYaw) * dist * cp
    );
    const rate = this.onFoot ? 14 : 9;
    this.camPos.x = damp(this.camPos.x, wanted.x, rate, dt);
    this.camPos.y = damp(this.camPos.y, wanted.y, rate, dt);
    this.camPos.z = damp(this.camPos.z, wanted.z, rate, dt);
    const minY = this.city.groundAt(this.camPos.x, this.camPos.z, null) + 1.1;
    if (this.camPos.y < minY) this.camPos.y = minY;
    this.camLook.set(
      damp(this.camLook.x, target.x, 16, dt),
      damp(this.camLook.y, target.y + lookH, 16, dt),
      damp(this.camLook.z, target.z, 16, dt)
    );
  }

  /** Longest horizontal boom length behind the target that stays out of geometry. */
  clearCamDist(target, want, height) {
    const ux = Math.sin(this.camYaw), uz = Math.cos(this.camYaw);
    const near = this.city.buildingsNear(target.x, target.z, want + 8);
    if (!near.length) return want;
    const camY = target.y + height;
    for (let d = 1.6; d <= want; d += 0.7) {
      const sx = target.x + ux * d, sz = target.z + uz * d;
      for (const b of near) {
        if (camY > b.y + b.h || camY < b.y - 3) continue;
        const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
        const dx = sx - b.x, dz = sz - b.z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) < b.w / 2 + 0.5 && Math.abs(lz) < b.d / 2 + 0.5) {
          return Math.max(1.5, d - 0.9);
        }
      }
    }
    return want;
  }

  applyCamera(camera) {
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
  }

  respawn(x, z) {
    if (this.vehicle) {
      this.vehicle.mode = 'free';
      this.vehicle = null;
    }
    this.onFoot = true;
    this.h.group.visible = true;
    this.x = x;
    this.z = z;
    this.y = this.city.groundAt(x, z, null);
    this.vy = 0;
    this.speed = 0;
    this.health = 100;
    this.dead = false;
    this.camPos.set(x + Math.sin(this.camYaw) * 4.6, this.y + 1.6, z + Math.cos(this.camYaw) * 4.6);
  }
}
