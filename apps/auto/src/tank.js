// The tank: where it is kept, its guns, and what it does to the city.
//
// vehicles.js has the model and the driving (buildTank, Vehicle._tankYaw /
// _tankParts); this is the rest. `step()` runs inside player.updateDrive for
// the tank you are in -- after the drive, before the building collision -- so
// it can fell the trunks and posts in its path and flatten the cars under it
// before anything pushes back, and aim and fire. `update()` runs once a frame
// for the shells in flight, the burning hulks, the crosshair and the tank's
// home at Sand Point. See "The tank" in CLAUDE.md.
//
// Nothing here makes a material, a light or a mesh after boot: the muzzle
// flash, the blast and the smoke are the shared particle system (effects.js),
// the shell's streak is its tracer lines, and the crosshair is DOM.

import * as THREE from './three.js';
import { TANK } from './vehicles.js';
import { CHUNK } from './citygen.js';
import { clamp, angleWrap, dist2 } from './util.js';
import * as G from './geo.js';

// Sand Point: the concrete apron in front of the old Naval Air Station's
// hangars in Magnuson Park, open for 60 m every way, nose out to the field.
export const TANK_SITE = { x: 6255, z: -8170, heading: -0.23 };

const RELOAD = 2.0;          // s between main-gun rounds
const SHELL_V = 900;         // m/s: the round's flight, for the delay to the blast
const GUN_RANGE = 1200;
const BLAST_R = 10;          // m: vehicles wrecked or hurt inside it
const PED_R = 12;            // m: people thrown down inside it, killed inside 7
const MG_RATE = 11;          // rounds a second
const MG_RANGE = 220;
const MG_DMG = 7;
const CRUSH_MASS = 8;        // anything lighter than a 747 goes under it
const WRECK_COL = 0x1d1b19;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Vector3(), _d = new THREE.Vector3();

export class TankSystem {
  constructor(o) {
    // { scene, city, world, traffic, peds, fx, audio, hud, game, player, camera, root }
    Object.assign(this, o);
    this.cool = 0;
    this.mgCool = 0;
    this.mgN = 0;
    this.aimN = 0;
    this.aim = { x: 0, y: 0, z: 0, ok: false };
    this.shells = [];
    for (let i = 0; i < 6; i++) this.shells.push({ t: -1, x: 0, y: 0, z: 0, dx: 0, dz: 0, car: null, kind: null });
    this.wrecks = [];        // burning hulks: { v, t }
    this.homeCheck = 3;
    this.stats = { fired: 0, mg: 0, crushed: 0, felled: 0, wrecked: 0 };
    this.makeHud();
    // no lot car parks in the tank's bay
    if (this.traffic.keepClear) this.traffic.keepClear.push([TANK_SITE.x, TANK_SITE.z, 11]);
  }

  // --- the tank's home --------------------------------------------------------

  /** The tank at Sand Point, parked ('apron': it never despawns). */
  spawnHome() {
    const v = this.traffic.spawnAt(TANK_SITE.x, TANK_SITE.z, TANK_SITE.heading, 'tank', 0xb9a27a, 'apron');
    v.vLong = 0;
    return v;
  }

  // --- the HUD ----------------------------------------------------------------

  makeHud() {
    const root = this.root || document.getElementById('app');
    if (!root) { this.el = null; return; }
    const el = document.createElement('div');
    el.id = 'tankHud';
    el.style.cssText = 'position:absolute;left:0;top:0;width:76px;height:76px;margin:-38px 0 0 -38px;pointer-events:none;z-index:5;display:none;will-change:transform;';
    el.innerHTML = '<svg viewBox="-38 -38 76 76" width="76" height="76" style="overflow:visible">'
      + '<circle r="15" fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="4"/>'
      + '<circle r="15" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.6"/>'
      + '<circle class="rl" r="21" fill="none" stroke="#ffb347" stroke-width="3" stroke-linecap="round" transform="rotate(-90)" stroke-dasharray="131.95" stroke-dashoffset="0"/>'
      + '<path d="M-30 0H-19M19 0H30M0 -30V-19M0 19V30" stroke="rgba(0,0,0,0.5)" stroke-width="3.5"/>'
      + '<path d="M-30 0H-19M19 0H30M0 -30V-19M0 19V30" stroke="#fff" stroke-width="1.6"/>'
      + '<circle r="1.8" fill="#fff"/></svg>'
      + '<div class="tl" style="position:absolute;left:50%;top:84px;transform:translateX(-50%);white-space:nowrap;font:700 11px -apple-system,Helvetica,sans-serif;letter-spacing:.06em;color:#ffb347;text-shadow:0 1px 2px #000">LOADING</div>';
    root.appendChild(el);
    this.el = el;
    this.ring = el.querySelector('.rl');
    this.label = el.querySelector('.tl');
    this._hudX = -1; this._hudY = -1; this._hudR = -1; this._hudShow = false; this._hudTxt = '';
    this._rootRect = null;
    window.addEventListener('resize', () => { this._rootRect = null; });
  }

  showHud(on) {
    if (!this.el || this._hudShow === on) return;
    this._hudShow = on;
    this.el.style.display = on ? 'block' : 'none';
  }

  /** The crosshair sits where the gun's line meets something: it is honest. */
  updateHud(v) {
    if (!this.el) return;
    const cam = this.camera;
    if (!this.aim.ok) { this.showHud(false); return; }
    _v.set(this.aim.x, this.aim.y, this.aim.z).project(cam);
    if (_v.z > 1 || _v.z < -1) { this.showHud(false); return; }
    this.showHud(true);
    const r = this._rootRect || (this._rootRect = this.el.parentNode.getBoundingClientRect());
    const w = r.width || window.innerWidth, h = r.height || window.innerHeight;
    const x = Math.round((_v.x * 0.5 + 0.5) * w), y = Math.round((-_v.y * 0.5 + 0.5) * h);
    if (x !== this._hudX || y !== this._hudY) {
      this._hudX = x; this._hudY = y;
      this.el.style.transform = `translate(${x}px,${y}px)`;
    }
    const f = clamp(this.cool / RELOAD, 0, 1);
    const ro = Math.round(f * 132);
    if (ro !== this._hudR) { this._hudR = ro; this.ring.setAttribute('stroke-dashoffset', String(ro)); }
    const txt = f > 0 ? 'LOADING' : 'READY';
    if (txt !== this._hudTxt) { this._hudTxt = txt; this.label.textContent = txt; this.label.style.color = f > 0 ? '#ffb347' : '#7ee0a4'; }
  }

  // --- entering and leaving -----------------------------------------------------

  onEnter(v) {
    const hand = document.querySelector('[data-btn="hand"]'), horn = document.querySelector('[data-btn="horn"]');
    if (v.spec.tank) {
      if (hand) { hand.innerHTML = 'FIRE'; hand.classList.add('b-atk'); }
      if (horn) horn.textContent = 'MG';
      this._rootRect = null;
      this.cool = Math.max(this.cool, 0.6);
      if (this.hud) setTimeout(() => this.hud.showToast('Tank: aim with the camera. FIRE for the main gun, hold MG for the machine gun', 4200), 1200);
    } else this.onExit();
  }

  onExit() {
    const hand = document.querySelector('[data-btn="hand"]'), horn = document.querySelector('[data-btn="horn"]');
    if (hand && hand.classList.contains('b-atk')) { hand.innerHTML = 'HAND<br>BRAKE'; hand.classList.remove('b-atk'); }
    if (horn && horn.textContent === 'MG') horn.textContent = 'HORN';
    this.showHud(false);
  }

  // --- the frame, for the tank you are in ----------------------------------------

  /**
   * After the tank has driven this frame and before buildings push back:
   * aim, clear the street furniture and cars it has driven into, fire.
   */
  step(v, dt, input) {
    const T = v.tank, P = this.player;
    // The turret follows the camera; the gun its pitch (level at the boom's
    // resting pitch), corrected for the hull's own slope so the line stays
    // where the camera put it.
    const yawW = angleWrap(P.camYaw + Math.PI - v.heading);
    const elevWorld = clamp((0.17 - P.camPitch) * 0.7, TANK.elevMin, TANK.elevMax);
    T.yawWant = yawW;
    T.elevWant = clamp(elevWorld + v.pitch * Math.cos(T.yaw) - v.roll * Math.sin(T.yaw), TANK.elevMin, TANK.elevMax);
    T.aimT = 0.3;
    this.fell(v);
    this.crush(v);
    this.cool -= dt;
    this.mgCool -= dt;
    if ((input.hand || input.attack) && this.cool <= 0) this.fireMain(v);
    if ((input.horn || input.mg) && this.mgCool <= 0) this.fireMg(v);
  }

  /**
   * Point the camera so the gun's line passes through (x, y, z): the turret
   * at its bearing, the gun's elevation from its trunnions. For the
   * harnesses (verify.mjs "tank"); a player does this with the look stick.
   */
  aimAt(v, x, y, z) {
    const P = this.player, T = v.tank;
    P.camYaw = Math.atan2(x - v.x, z - v.z) + Math.PI;
    _w.set(v.x, v.y + TANK.turretAt[1] + TANK.gunAt[1], v.z);
    if (T.gun) { v.group.updateMatrixWorld(true); T.gun.getWorldPosition(_w); }
    const E = Math.atan2(y - _w.y, Math.hypot(x - _w.x, z - _w.z));
    P.camPitch = 0.17 - E / 0.7;
  }

  /** Muzzle position and bore direction in the world, into _m / _d. */
  muzzle(v, local = null) {
    const T = v.tank;
    if (!T.gun) return false;
    v.group.updateMatrixWorld(true);
    T.gun.localToWorld(_m.set(local ? local[0] : 0, local ? local[1] : 0, local ? local[2] : TANK.muzzle));
    T.gun.localToWorld(_d.set(local ? local[0] : 0, local ? local[1] : 0, (local ? local[2] : TANK.muzzle) + 1));
    _d.sub(_m).normalize();
    return true;
  }

  // --- trees and posts ----------------------------------------------------------

  /**
   * TRUNKS AND POSTS DO NOT STOP IT. Every street object in the per-chunk
   * store (`city.obstacles`: trunks, lamp posts, benches, play towers) under
   * the hull is taken out of the store -- moved to infinity, so the chunk's
   * spatial index stays valid -- with splinters or sparks and a crunch.
   * Walls, landmarks and buildings are another store and still stop it.
   * The prop goes from the picture too: it is part of its chunk's one merged
   * flat mesh, and world.js records each one's run of triangles there, so
   * its indices are zeroed (`hideRange`). It comes back, with its collision,
   * if the chunk is ever rebuilt.
   */
  fell(v) {
    const city = this.city, f = v.forward, rx = f.z, rz = -f.x;
    const reach = v.bodyR + 2.5;
    const c0 = Math.floor((v.x - reach) / CHUNK), c1 = Math.floor((v.x + reach) / CHUNK);
    const d0 = Math.floor((v.z - reach) / CHUNK), d1 = Math.floor((v.z + reach) / CHUNK);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = d0; cz <= d1; cz++) {
        const ck = city.chunkKey(cx, cz);
        const l = city.obstacles.get(ck);
        if (!l) continue;
        for (let i = 0; i < l.length; i += 3) {
          const ox = l[i], oz = l[i + 1], r = l[i + 2];
          const dx = ox - v.x, dz = oz - v.z;
          if (dx * dx + dz * dz > reach * reach || r > 2.2) continue;
          const lf = dx * f.x + dz * f.z, lr = dx * rx + dz * rz;
          if (Math.abs(lf) > v.halfLen + r + 0.35 || Math.abs(lr) > v.halfWid + r + 0.55) continue;
          // the store's underground rule: a post on the street over a bore
          if (G.terrainHeight(ox, oz) - v.y > 2.5) continue;
          l[i] = 1e9; l[i + 1] = 1e9;
          const ch = this.world.chunks && this.world.chunks.get(ck);
          const F = ch && ch.group && ch.group.userData.fell;
          if (F) {
            for (let k = 0; k < F.list.length; k += 4) {
              if (F.list[k] === ox && F.list[k + 1] === oz) { hideRange(F.mesh.geometry, F.list[k + 2], F.list[k + 3]); break; }
            }
          }
          this.stats.felled++;
          const gy = G.terrainHeight(ox, oz);
          if (r <= 0.4) {
            // a lamp post or a sign: metal
            this.fx.sparks(ox, gy + 1, oz, 14);
            this.fx.emit(ox, gy + 0.6, oz, 6, { r: 0.35, g: 0.36, b: 0.38, size: 0.4, life: 0.9, spread: 4, vy: 3, grav: -12 });
            if (this.audio.ready) this.audio.play('scrape', { x: ox, y: gy, z: oz, gain: 0.7, rate: 1.4 });
          } else {
            // a trunk, a bench: wood and leaves
            this.fx.emit(ox, gy + 1.2, oz, 12, { r: 0.42, g: 0.3, b: 0.18, size: 0.5, life: 1.0, spread: 5, vy: 3.5, grav: -10 });
            this.fx.emit(ox, gy + 4, oz, 14, { r: 0.18, g: 0.32, b: 0.12, size: 0.8, life: 1.6, spread: 4, vy: 1, grav: -3, jitter: 2 });
          }
          if (this.audio.ready) this.audio.play('crunch', { x: ox, y: gy, z: oz, gain: 0.8, rate: 0.75 });
          v.vLong *= r <= 0.4 ? 0.97 : 0.93;
          v.tank.bump = Math.max(v.tank.bump, 0.5);
          if (this.player.vehicle === v) this.player.shake = Math.max(this.player.shake || 0, 0.12);
        }
      }
    }
  }

  // --- cars ---------------------------------------------------------------------------

  /**
   * DRIVE OVER A CAR AND IT IS FLAT. Any road vehicle under the hull while the
   * tank is moving or turning is crushed: squashed to 40 % of its height,
   * dead, out of the collision pairs (traffic.js skips `crushed`), and the
   * tank loses 4 % of its speed and rocks over it. Standing still against a
   * car it pushes like any vehicle (it weighs forty of them).
   */
  crush(v) {
    const moving = Math.abs(v.vLong) > 0.8 || Math.abs(v.yawRate) > 0.25;
    if (!moving) return;
    for (const c of this.traffic.cars) {
      if (c === v || c.crushed || c.spec.tank || c.spec.rail || c.spec.boat || c.spec.balloon || c.mass >= CRUSH_MASS) continue;
      if (Math.abs(c.y - v.y) > 2.2) continue;
      const rr = v.bodyR + c.bodyR;
      if (dist2(c.x, c.z, v.x, v.z) > rr * rr) continue;
      if (!obbOverlap(v, c, 0.25)) continue;
      this.flatten(c, v);
    }
  }

  flatten(c, by) {
    const wasPolice = c.mode === 'police';
    c.crushed = true;
    c.health = 0; c.dead = true; c.exploded = true;
    c.vLong = 0; c.vLat = 0;
    if (c.mode !== 'trailer') c.mode = 'free';
    // flattened and spread, sitting a little askew
    c.tilt.scale.set(1.1, 0.4, 1.04);
    c.roll = (Math.random() - 0.5) * 0.08; c.pitch = (Math.random() - 0.5) * 0.05;
    c.bodyMat.color.multiplyScalar(0.62);
    // an articulated bus goes flat in both halves
    if (c.trailer && !c.trailer.crushed) this.flatten(c.trailer, null);
    if (c.leader && !c.leader.crushed) this.flatten(c.leader, null);
    c.color = c.bodyMat.color.getHex(); c._farCol = null;
    if (c.rider) c.rider.group.visible = false;
    this.stats.crushed++;
    this.fx.sparks(c.x, c.y + 0.6, c.z, 18);
    this.fx.emit(c.x, c.y + 0.4, c.z, 10, { r: 0.75, g: 0.8, b: 0.85, size: 0.25, life: 0.6, spread: 4, vy: 2, grav: -12 });
    if (this.audio.ready) {
      this.audio.play('crunch', { x: c.x, y: c.y, z: c.z, gain: 1, rate: 0.7 });
      this.audio.play('glass', { x: c.x, y: c.y, z: c.z, gain: 0.6, at: 0.05 });
    }
    this.peds.scare(c.x, c.z, 30);
    this.game.addHeat(wasPolice ? 30 : 6);
    if (by) {
      by.vLong *= 0.96;
      by.tank.bump = 1;
      if (this.player.vehicle === by) this.player.shake = Math.max(this.player.shake || 0, 0.25);
    }
  }

  /**
   * A HULK. Burnt black, thrown away from the blast and tumbling, it lands on
   * its wheels or its roof (Vehicle.updateWreck) and burns for a while.
   */
  wreck(c, nx, nz, power) {
    if (c.wreck || c.spec.tank && c === this.player.vehicle) return;
    const wasPolice = c.mode === 'police';
    c.health = 0; c.dead = true; c.exploded = true;
    if (c.mode !== 'trailer') c.mode = 'free';
    c.bodyMat.color.setHex(WRECK_COL);
    c.bodyMat.roughness = 0.92;
    c.color = WRECK_COL; c._farCol = null;
    if (c.rider) c.rider.group.visible = false;
    const flip = !c.trailer && c.mode !== 'trailer' && !c.leader && !c.spec.plane && !c.spec.boat && !c.crushed && c.mass < 6;
    const s = Math.random() < 0.5 ? -1 : 1;
    c.wreck = { t: 0, rest: !flip, rollEnd: c.roll,
      vy: flip ? 4.5 + 5.5 * power : 0, spin: flip ? s * (2.2 + 3.5 * power) : 0,
      vx: flip ? nx * power * 5 : 0, vz: flip ? nz * power * 5 : 0 };
    this.stats.wrecked++;
    this.game.addHeat(wasPolice ? 45 : 12);
    if (this.wrecks.length >= 8) this.wrecks.shift();
    this.wrecks.push({ v: c, t: 0 });
  }

  // --- the guns -----------------------------------------------------------------------

  fireMain(v) {
    if (!this.muzzle(v)) return;
    const T = v.tank;
    this.cool = RELOAD;
    this.stats.fired++;
    const ox = _m.x, oy = _m.y, oz = _m.z, dx = _d.x, dy = _d.y, dz = _d.z;
    const hit = this.cast(ox, oy, oz, dx, dy, dz, GUN_RANGE, v, true);
    const hx = ox + dx * hit.t, hy = oy + dy * hit.t, hz = oz + dz * hit.t;
    // the gun runs back, the hull rocks away from it, the camera takes it
    T.recoil = 0.42; T.rock = 1; T.rockYaw = T.yaw;
    if (this.player.vehicle === v) this.player.shake = Math.max(this.player.shake || 0, 0.55);
    // flash, the smoke ring, the dust the blast lifts off the ground
    const fx = this.fx;
    fx.emit(ox + dx * 0.7, oy + dy * 0.7, oz + dz * 0.7, 24, { r: 1, g: 0.92, b: 0.62, size: 3.2, life: 0.12, spread: 2.2,
      vx: dx * 6, vy: dy * 6, vz: dz * 6, grav: 0, drag: 0.7, jitter: 0.35 });
    fx.emit(ox + dx * 1.8, oy + dy * 1.8, oz + dz * 1.8, 14, { r: 1, g: 0.58, b: 0.18, size: 2.4, life: 0.22, spread: 5,
      vx: dx * 9, vy: dy * 9, vz: dz * 9, grav: 0, drag: 0.8, jitter: 0.8 });
    for (let k = 0; k < 3; k++) fx.smoke(ox + dx * (1 + k * 1.5), oy + dy * (1 + k * 1.5), oz + dz * (1 + k * 1.5), 5);
    const gy = G.terrainHeight(ox, oz);
    fx.emit(ox, gy + 0.3, oz, 18, { r: 0.55, g: 0.5, b: 0.42, size: 2.4, life: 1.6, spread: 7, vy: 0.8, grav: 0.2, drag: 0.9, jitter: 2.5 });
    // the round: a streak to where it lands, the blast when it gets there
    fx.tracer(ox, oy, oz, hx, hy, hz);
    if (this.audio.ready) this.audio.cannon();
    this.peds.scare(v.x, v.z, 90);
    this.game.addHeat(8);
    const sh = this.shells.find((q) => q.t < 0) || this.shells[0];
    sh.t = hit.t / SHELL_V; sh.x = hx; sh.y = hy; sh.z = hz; sh.dx = dx; sh.dz = dz;
    sh.car = hit.car; sh.kind = hit.kind; sh.by = v;
    this.lastShot = { t: hit.t, kind: hit.kind, x: hx, y: hy, z: hz, car: hit.car };
  }

  fireMg(v) {
    if (!this.muzzle(v, TANK.coax)) return;
    this.mgCool = 1 / MG_RATE;
    this.mgN++;
    this.stats.mg++;
    const s = 0.006;
    const dx = _d.x + (Math.random() - 0.5) * s, dy = _d.y + (Math.random() - 0.5) * s, dz = _d.z + (Math.random() - 0.5) * s;
    const ox = _m.x, oy = _m.y, oz = _m.z;
    const hit = this.cast(ox, oy, oz, dx, dy, dz, MG_RANGE, v, false);
    const hx = ox + dx * hit.t, hy = oy + dy * hit.t, hz = oz + dz * hit.t;
    const fx = this.fx;
    fx.emit(ox + dx * 0.3, oy + dy * 0.3, oz + dz * 0.3, 3, { r: 1, g: 0.8, b: 0.4, size: 0.5, life: 0.06, spread: 1, vx: dx * 6, vy: dy * 6, vz: dz * 6, grav: 0, jitter: 0.1 });
    if (this.mgN % 2 === 0) fx.tracer(ox, oy, oz, hx, hy, hz);
    if (this.audio.ready) this.audio.mg();
    if (this.mgN % 5 === 0) { this.peds.scare(v.x, v.z, 60); this.game.addHeat(2); }
    if (hit.kind === 'car') {
      const c = hit.car;
      fx.sparks(hx, hy, hz, 4);
      if (!c.dead) {
        c.damage(MG_DMG, true);
        if (c.mode === 'police') this.game.addHeat(3);
        if (c.mode === 'traffic') c.panic = 4;
        if (c.dead) { this.boom(c.x, c.y + 1, c.z, true); this.wreck(c, dx, dz, 0.5); }
      }
    } else if (hit.kind === 'ped') {
      const p = hit.ped;
      p.hp -= 18;
      this.fx.blood(p.x, p.y + 1.2, p.z);
      if (p.hp <= 0) { this.peds.knockDown(p, { x: dx, z: dz }, 6); this.game.onPedKilled(p, true); }
      else { p.state = 'flee'; p.timer = 5; p.fleeX = p.x - ox; p.fleeZ = p.z - oz; }
    } else if (hit.kind === 'water') {
      fx.droplets(hx, hy + 0.05, hz, 5);
    } else if (hit.kind) {
      fx.sparks(hx, hy, hz, 2);
      fx.emit(hx, hy, hz, 2, { r: 0.5, g: 0.47, b: 0.42, size: 0.6, life: 0.5, spread: 1.5, vy: 1, grav: -2 });
    }
  }

  /** A fuel tank going up: the shared explosion and its sound, no damage. */
  boom(x, y, z, small = false) {
    this.fx.explosion(x, y, z);
    if (!small) this.fx.explosion(x, y + 1.2, z);
    if (this.audio.ready) this.audio.explosion(x, z);
  }

  /**
   * The main gun's round arrives. Within BLAST_R every vehicle is hurt by
   * how close it is (the one it struck, or anything within 1.2 m, is gone)
   * and a dead one becomes a hulk; within PED_R people are thrown down,
   * killed inside 7 m; you on foot are hurt by it, and so is the tank itself
   * a little if it fired at something close (its armour takes most of it).
   */
  blast(sh) {
    const { x, y, z } = sh, fx = this.fx;
    if (sh.kind === 'water') {
      fx.emit(x, y, z, 50, { r: 0.85, g: 0.9, b: 0.95, size: 1.2, life: 1.4, spread: 4, vy: 14, grav: -14, jitter: 1.5 });
      if (this.audio.ready) this.audio.play('splash', { x, y, z, gain: 1, rate: 0.6 });
      return;
    }
    this.boom(x, y + 0.6, z);
    // the fireball, the debris it throws, the black smoke standing over it
    fx.emit(x, y + 1.2, z, 28, { r: 1, g: 0.72, b: 0.28, size: 4.4, life: 0.5, spread: 9, vy: 4, grav: -1, jitter: 1.5 });
    fx.emit(x, y + 0.5, z, 24, { r: 0.32, g: 0.28, b: 0.22, size: 1.3, life: 1.3, spread: 11, vy: 9, grav: -14, jitter: 1 });
    fx.emit(x, y + 2.5, z, 16, { r: 0.16, g: 0.15, b: 0.14, size: 4.8, life: 3.2, spread: 2.5, vy: 3.2, grav: 0.4, drag: 0.93, jitter: 2 });
    fx.sparks(x, y + 0.5, z, 20);
    this.peds.scare(x, z, 70);
    const P = this.player;
    if (P.onFoot === false && P.vehicle && P.vehicle.tank) P.shake = Math.max(P.shake || 0, clamp(0.5 - Math.hypot(x - P.vehicle.x, z - P.vehicle.z) / 200, 0.05, 0.4));
    for (const c of this.traffic.cars) {
      if (c.wreck && c.wreck.t < 0.2) continue;
      if (Math.abs(c.y + 1 - y) > 6) continue;
      const n = c.nearest(x, z);
      const d = Math.hypot(n.x - x, n.z - z);
      if (d > BLAST_R) continue;
      const dmg = c === sh.car || d < 1.2 ? 1000 : 150 * Math.pow(1 - d / BLAST_R, 1.4);
      if (c === P.vehicle) {
        // your own tank, caught by its own round: the armour takes most of it
        c.damage(dmg * 0.5, true);
        this.game.damagePlayer(dmg * 0.04, 'explosion');
        if (c.dead) this.game.onCarDestroyed(c);
        continue;
      }
      if (c.mode === 'traffic') c.panic = 5;
      const wasDead = c.dead;
      c.damage(dmg, true);
      if (c.mode === 'police') this.game.addHeat(20);
      let ax = c.x - x, az = c.z - z;
      const al = Math.hypot(ax, az) || 1;
      ax /= al; az /= al;
      if (c.dead && !c.wreck) {
        if (!wasDead && c !== sh.car) this.boom(c.x, c.y + 1, c.z, true);
        this.wreck(c, ax, az, clamp(1.25 - d / BLAST_R, 0.3, 1.25));
      } else if (!c.dead) {
        // shoved away from it
        const f = c.forward, push = 8 * (1 - d / BLAST_R);
        c.vLong += (ax * f.x + az * f.z) * push;
        c.vLat += (ax * f.z - az * f.x) * push;
      }
    }
    for (const p of this.peds.peds) {
      if (p.state === 'down') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > PED_R || Math.abs(p.y - y) > 6) continue;
      const k = 1 - d / PED_R;
      const dir = { x: (p.x - x) / (d || 1), z: (p.z - z) / (d || 1) };
      if (d < 7 || p.hp <= 120 * k) {
        p.hp = 0;
        this.peds.knockDown(p, dir, 30 * k);
        this.game.onPedKilled(p, true);
      } else {
        p.hp -= 120 * k;
        this.peds.knockDown(p, dir, 12 * k);
        this.game.onPedHit(true, p);
      }
    }
    if (P.onFoot) {
      const d = Math.hypot(P.x - x, P.z - z);
      if (d < BLAST_R + 2 && Math.abs(P.y - y) < 6) this.game.damagePlayer(115 * Math.pow(1 - d / (BLAST_R + 2), 1.3), 'explosion');
    }
  }

  // --- the line of fire ---------------------------------------------------------------

  /**
   * The first thing on the ray o + d t, 0 < t < maxT: a vehicle (its body's
   * box, yawed), a person (a 0.45 m upright cylinder), a building's box, a
   * landmark solid, the water, or the ground (deck or terrain), marched at
   * 2.5 m and bisected. Returns this.hit, reused.
   */
  cast(ox, oy, oz, dx, dy, dz, maxT, ignore, landmarks, step = 2.5) {
    const H = this._hit || (this._hit = { t: 0, kind: null, car: null, ped: null });
    let best = maxT, kind = null, car = null, ped = null;
    for (const c of this.traffic.cars) {
      if (c === ignore || (c.leader && c.leader === ignore) || !c.group.visible && c.mode !== 'trailer') continue;
      const ex = c.x - ox, ez = c.z - oz;
      const along = ex * dx + ez * dz;
      if (along < -c.bodyR || along > best + c.bodyR) continue;
      const t = rayCar(c, ox, oy, oz, dx, dy, dz, best);
      if (t !== null && t < best) { best = t; kind = 'car'; car = c; }
    }
    const hx = dx, hz = dz, h2 = hx * hx + hz * hz;
    if (h2 > 1e-6) {
      for (const p of this.peds.peds) {
        if (p.state === 'down') continue;
        const ex = p.x - ox, ez = p.z - oz;
        const t = (ex * hx + ez * hz) / h2;
        if (t < 0 || t > best) continue;
        const qx = ex - hx * t, qz = ez - hz * t;
        if (qx * qx + qz * qz > 0.45 * 0.45) continue;
        const y = oy + dy * t;
        if (y < p.y - 0.1 || y > p.y + 1.9) continue;
        best = t; kind = 'ped'; ped = p; car = null;
      }
    }
    const under = G.terrainRaw(ox, oz) - oy > 2.5;
    if (!under) {
      // in 80 m pieces from the muzzle out, stopping at the first that is
      // struck: one query 600 m round downtown is thousands of boxes
      for (let s0 = 0; s0 < best; s0 += 80) {
        const s1 = Math.min(best, s0 + 80), sm = (s0 + s1) / 2;
        for (const b of this.city.buildingsNear(ox + dx * sm, oz + dz * sm, (s1 - s0) * 0.5 + 8)) {
          const t = rayBuilding(b, ox, oy, oz, dx, dy, dz, best);
          if (t !== null && t < best) { best = t; kind = 'building'; car = null; ped = null; }
        }
      }
    }
    // the ground, decks, water and landmark solids, marched
    const city = this.city, world = this.world;
    let tPrev = 0;
    for (let t = step; t < best + step; t += step) {
      const tt = Math.min(t, best);
      const x = ox + dx * tt, y = oy + dy * tt, z = oz + dz * tt;
      let g = city.groundAt(x, z, y + 0.6, 0);
      if (!under) g = Math.max(g, G.terrainHeight(x, z) - 0.2);
      let k = null;
      if (y <= g) k = 'ground';
      else if (G.isWater(x, z)) {
        const wl = world.waterLevelAt(x, z);
        if (wl !== null && y <= wl) k = 'water';
      }
      if (!k && landmarks && city.landmarkHit(x, z, 0.15, y)) k = 'building';
      if (k) {
        // bisect the crossing between the last clear sample and this one
        let a = tPrev, b2 = tt;
        if (k !== 'building') {
          for (let i = 0; i < 5; i++) {
            const m = (a + b2) / 2, X = ox + dx * m, Y = oy + dy * m, Z = oz + dz * m;
            let gm = city.groundAt(X, Z, Y + 0.6, 0);
            if (!under) gm = Math.max(gm, G.terrainHeight(X, Z) - 0.2);
            const wl = k === 'water' ? world.waterLevelAt(X, Z) : null;
            if (Y <= gm || (wl !== null && Y <= wl)) b2 = m; else a = m;
          }
        }
        if (b2 < best) { best = b2; kind = k; car = null; ped = null; }
        break;
      }
      tPrev = tt;
      if (tt >= best) break;
    }
    H.t = best; H.kind = kind; H.car = car; H.ped = ped;
    return H;
  }

  // --- per frame ------------------------------------------------------------------------

  update(dt) {
    // rounds in flight
    for (const sh of this.shells) {
      if (sh.t < 0) continue;
      sh.t -= dt;
      if (sh.t < 0) { sh.t = -1; if (sh.kind) this.blast(sh); sh.car = null; sh.by = null; }
    }
    // the hulks burn, then smoulder
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      w.t += dt;
      const v = w.v;
      if (w.t > 25 || !this.traffic.cars.includes(v)) { this.wrecks.splice(i, 1); continue; }
      if (Math.random() < (w.t < 8 ? 0.5 : 0.18)) this.fx.smoke(v.x + (Math.random() - 0.5) * 1.5, v.y + 1.2, v.z + (Math.random() - 0.5) * 1.5, 1);
      if (w.t < 6 && Math.random() < 0.35) {
        this.fx.emit(v.x + (Math.random() - 0.5) * 1.6, v.y + 0.8, v.z + (Math.random() - 0.5) * 1.6, 1,
          { r: 1, g: 0.5, b: 0.12, size: 1.3, life: 0.5, spread: 0.6, vy: 2.2, grav: 1, jitter: 0.6 });
      }
    }
    // The tank at Sand Point is always there: one left somewhere and lost (a
    // wreck, a despawn, or just driven off and abandoned) is replaced, out of
    // sight, when you are far from the apron.
    if ((this.homeCheck -= dt) <= 0) {
      this.homeCheck = 5;
      const p = this.player.position;
      const home = this.traffic.cars.find((c) => c.spec.tank && !c.dead && dist2(c.x, c.z, TANK_SITE.x, TANK_SITE.z) < 60 * 60);
      if (!home && dist2(p.x, p.z, TANK_SITE.x, TANK_SITE.z) > 400 * 400) {
        // the old one, if it is still standing about somewhere, stays where you left it
        this.spawnHome();
      }
    }
    // the crosshair: where the gun's line ends, re-cast every third frame
    const v = this.player.vehicle;
    if (v && v.spec.tank && v.tank.gun && !this.game.paused) {
      if ((this.aimN = (this.aimN + 1) % 3) === 0 && this.muzzle(v)) {
        // (a coarser march: the crosshair is a few pixels, and this is 1 frame in 3)
        const h = this.cast(_m.x, _m.y, _m.z, _d.x, _d.y, _d.z, 400, v, false, 5);
        const t = h.kind ? h.t : 400;
        this.aim.x = _m.x + _d.x * t; this.aim.y = _m.y + _d.y * t; this.aim.z = _m.z + _d.z * t;
        this.aim.ok = true;
      }
      this.updateHud(v);
    } else {
      this.aim.ok = false;
      this.showHud(false);
    }
  }
}

/**
 * Zero a run of a merged mesh's indices, so those triangles collapse to a
 * point. On a phone the index array is gone once uploaded (CLAUDE.md
 * "Memory"): three's update range then reads only [i0, i1) of whatever array
 * it is handed, so it gets a shared, all-zero one, dropped again on upload.
 */
let ZERO = null;
function hideRange(geo, i0, i1) {
  const idx = geo.index;
  if (!idx || i1 <= i0) return;
  if (idx.array) idx.array.fill(0, i0, i1);
  else {
    // (three refuses an array of any other byte length than the buffer's:
    // the view is the whole index's length, of which only [i0, i1) is sent)
    const wide = geo.attributes.position.count > 65535;
    const bytes = idx.count * (wide ? 4 : 2);
    if (!ZERO || ZERO.byteLength < bytes) ZERO = new ArrayBuffer(Math.max(bytes, 1 << 16));
    idx.array = wide ? new Uint32Array(ZERO, 0, idx.count) : new Uint16Array(ZERO, 0, idx.count);
  }
  idx.addUpdateRange(i0, i1 - i0);
  idx.needsUpdate = true;
}

/** Two vehicles' body rectangles overlap (2D SAT); `grow` pads the first's nose. */
function obbOverlap(a, b, grow) {
  const fa = a.forward, fb = b.forward;
  const ax = [fa.x, fa.z], ar = [fa.z, -fa.x], bx = [fb.x, fb.z], br = [fb.z, -fb.x];
  const dx = b.x - a.x, dz = b.z - a.z;
  const ahl = a.halfLen + grow, ahw = a.halfWid, bhl = b.halfLen, bhw = b.halfWid;
  for (const n of [ax, ar, bx, br]) {
    const ra = ahl * Math.abs(ax[0] * n[0] + ax[1] * n[1]) + ahw * Math.abs(ar[0] * n[0] + ar[1] * n[1]);
    const rb = bhl * Math.abs(bx[0] * n[0] + bx[1] * n[1]) + bhw * Math.abs(br[0] * n[0] + br[1] * n[1]);
    if (Math.abs(dx * n[0] + dz * n[1]) > ra + rb) return false;
  }
  return true;
}

/** Slab test of a ray against a vehicle's body box (yawed, on its base). */
// scratch for the slab tests: a cast allocates nothing
const SO = [0, 0, 0], SD = [0, 0, 0], SN = [0, 0, 0], SX = [0, 0, 0];
function rayCar(c, ox, oy, oz, dx, dy, dz, maxT) {
  const f = c.forward, rx = f.z, rz = -f.x;
  const px = ox - c.x, pz = oz - c.z;
  SO[0] = px * rx + pz * rz; SO[1] = oy - c.y; SO[2] = px * f.x + pz * f.z;
  SD[0] = dx * rx + dz * rz; SD[1] = dy; SD[2] = dx * f.x + dz * f.z;
  const h = (c.spec.roof || 1.5) * (c.crushed ? 0.4 : 1), w = c.wreck ? 0.5 : 0;
  SN[0] = -c.halfWid; SN[1] = -w; SN[2] = -c.halfLen;
  SX[0] = c.halfWid; SX[1] = h + w; SX[2] = c.halfLen;
  return slab(SO, SD, SN, SX, maxT);
}

/** Slab test of a ray against a building's box (footprint rotated by b.rot). */
function rayBuilding(b, ox, oy, oz, dx, dy, dz, maxT) {
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
  const px = ox - b.x, pz = oz - b.z;
  SO[0] = px * c - pz * s; SO[1] = oy; SO[2] = px * s + pz * c;
  SD[0] = dx * c - dz * s; SD[1] = dy; SD[2] = dx * s + dz * c;
  SN[0] = -b.w / 2; SN[1] = b.y - 3; SN[2] = -b.d / 2;
  SX[0] = b.w / 2; SX[1] = b.y + b.h; SX[2] = b.d / 2;
  return slab(SO, SD, SN, SX, maxT);
}

function slab(o, d, mn, mx, maxT) {
  let t0 = 0, t1 = maxT;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
      continue;
    }
    let a = (mn[i] - o[i]) / d[i], b = (mx[i] - o[i]) / d[i];
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  return t0;
}
