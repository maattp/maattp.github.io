// ROAD SPRAY: in rain or a storm on a wet road every moving car near the
// camera -- yours and the nearest AI traffic within RANGE (60 m), at most
// CARS of them (phone 6, desktop 12) -- throws a mist and a rooster tail of
// droplets off its rear wheels, scaled by speed and by how wet the road is;
// big vehicles (mass >= 2.5: buses, rigs, the plows) throw more and wider.
// With snow lying (`weather.cover`) it is grey-brown slush: heavier lumps, less
// and greyer mist. The sprites are unlit: main.js sets `light` by the time of day.
//
// ONE Points draw of its own, sharing effects.js's particle MATERIAL (the soft
// round sprite, per-particle size and RGBA: the same program -- no new shader),
// so the shared fx ring (420, sparks / smoke / explosions) is never crowded
// out. A fixed pool (phone 150, desktop 300) of typed arrays: no per-frame
// allocation, the oldest overwritten when it is full, nothing uploaded and no
// draw (`visible` false) while none is alive.
//
// Dry roads, standing cars and anything off the carriageway emit nothing.
// `window.__noSpray = true` turns it off. Harness: `__dbg.spray` (`alive`,
// `cap`, `cars` this frame's emitters, `emitted`, `stats`).

import * as THREE from './three.js';

const RANGE = 60;
const MIN_SPEED = 3;   // m/s

export class RoadSpray {
  /** @param o.scene, o.fx (effects.js: its points' material), o.city (onRoad), o.weather, o.phone */
  constructor(o) {
    this.scene = o.scene; this.city = o.city; this.weather = o.weather;
    this.phone = !!o.phone;
    this.cap = this.phone ? 240 : 480;
    this.maxCars = this.phone ? 6 : 12;
    const N = this.cap;
    // per particle: x y z vx vy vz life max size grow alpha grav drag r g b
    this.P = new Float32Array(N * 16);
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 4);
    this.size = new Float32Array(N);
    for (let i = 0; i < N; i++) this.pos[i * 3 + 1] = -9999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.points = new THREE.Points(g, o.fx.points.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 5;
    this.points.name = 'roadSpray';
    this.scene.add(this.points);
    this.head = 0;
    this.alive = 0;
    this.cars = 0;
    this.emitted = 0;
    this.stats = { maxAlive: 0, maxCars: 0, frames: 0 };
    // this frame's chosen cars (fixed arrays)
    this._sel = new Array(this.maxCars).fill(null);
    this.light = 1;   // the sprites' brightness (main.js: by the time of day)
    this._selD = new Float32Array(this.maxCars);
  }

  _emit(x, y, z, vx, vy, vz, life, size, grow, alpha, grav, drag, r, g, b) {
    const P = this.P, o = this.head * 16;
    this.head = (this.head + 1) % this.cap;
    P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = vx; P[o + 4] = vy; P[o + 5] = vz;
    P[o + 6] = life; P[o + 7] = life; P[o + 8] = size; P[o + 9] = grow; P[o + 10] = alpha;
    P[o + 11] = grav; P[o + 12] = drag; P[o + 13] = r; P[o + 14] = g; P[o + 15] = b;
    this.emitted++;
  }

  /** How wet / slushy the roads are: { wet 0..1, slush 0..1 } from the weather. */
  _surface() {
    const W = this.weather;
    if (!W) return 0;
    const slush = W.cover > 0.3 ? Math.min(1, (W.cover - 0.3) / 0.5) : 0;
    const wet = W.wet > 0.2 ? Math.min(1, (W.wet - 0.2) / 0.6) : 0;
    this._slush = slush;
    return Math.max(wet, slush);
  }

  /** A road car's speed along its heading; a towed trailer (a semi's, an artic's rear) goes at its leader's. */
  _sp(v) { return v.spec.trailer && v.leader ? v.leader.vLong || 0 : v.vLong || 0; }

  _ok(v) {
    const s = v && v.spec;
    if (!s || !(s.roadCar || (s.trailer && v.leader)) || v.dead || v.airborne || v.onGround === false) return false;
    if (v.group && v.group.visible === false) return false;
    return Math.abs(this._sp(v)) > MIN_SPEED;
  }

  /** Each unpaused frame: choose the cars, throw the spray, age the pool. */
  update(dt, player, cars, camera) {
    if (!(dt > 0)) return;
    const off = typeof window !== 'undefined' && window.__noSpray;
    const k = off ? 0 : this._surface();
    this.cars = 0;
    if (k > 0 && camera) {
      // the player's car first, then the nearest moving AI cars within RANGE
      const sel = this._sel, sd = this._selD, M = this.maxCars;
      let n = 0;
      const pv = player && !player.onFoot ? player.vehicle : null;
      if (this._ok(pv)) { sel[n] = pv; sd[n] = -1; n++; }
      const cx = camera.position.x, cz = camera.position.z, R2 = RANGE * RANGE;
      if (cars) {
        for (let i = 0; i < cars.length; i++) {
          const v = cars[i];
          if (v === pv) continue;
          const dx = v.x - cx, dz = v.z - cz, d2 = dx * dx + dz * dz;
          if (d2 > R2) continue;
          if (n === M && d2 >= sd[M - 1]) continue;
          if (!this._ok(v)) continue;
          // insertion into the sorted short list
          let j = n < M ? n++ : M - 1;
          while (j > 0 && sd[j - 1] > d2) { sel[j] = sel[j - 1]; sd[j] = sd[j - 1]; j--; }
          sel[j] = v; sd[j] = d2;
        }
      }
      for (let i = 0; i < n; i++) {
        const v = sel[i];
        sel[i] = null;
        if (!this.city || this.city.onRoad(v.x, v.z, 1.5)) this._car(v, dt, k);
      }
      this.cars = n;
      if (n > this.stats.maxCars) this.stats.maxCars = n;
    }
    this._age(dt);
  }

  /** One car's spray this frame. */
  _car(v, dt, k) {
    const s = v.spec, f = v.forward, vl = this._sp(v), sp = Math.abs(vl);
    const big = (s.mass || 1) >= 2.5 || s.bus;
    const slush = this._slush > 0.5;
    const sK = Math.min(1, (sp - MIN_SPEED) / 22);
    // rates per second, the whole car
    const phoneK = this.phone ? 0.6 : 1;
    const mistR = (slush ? 24 : 56) * sK * k * (big ? 2.2 : 1) * phoneK;
    const dropR = (slush ? 50 : 96) * sK * k * (big ? 1.8 : 1) * phoneK;
    // (spread over the ground covered this frame: no clumps at speed)
    const step = sp * dt;
    const dir = vl >= 0 ? 1 : -1;
    // the rear axle (the front one in reverse), both wheel tracks
    const wb = s.wheelbase || v.halfLen * 1.2;
    const back = Math.min(v.halfLen, wb * 0.5 + (s.wheelR || 0.35) * 0.8) * dir;
    const ax = v.x - f.x * back, az = v.z - f.z * back;
    const rx = f.z, rz = -f.x, hw = v.halfWid * 0.78;
    const y0 = (v.y || 0) + 0.18;
    // unlit sprites: as bright as the daylight (main.js sets `light`: 1 by day, ~0.35 at night)
    const L = 1.35 * this.light;
    const vx = f.x * vl, vz = f.z * vl;
    let nm = Math.floor(mistR * dt + Math.random()), nd = Math.floor(dropR * dt + Math.random());
    while (nm-- > 0) {
      const side = Math.random() < 0.5 ? -1 : 1, j = Math.random(), b = -step * dir * Math.random();
      const x = ax + f.x * b + rx * hw * side + (Math.random() - 0.5) * 0.5, z = az + f.z * b + rz * hw * side + (Math.random() - 0.5) * 0.5;
      // the mist keeps some of the car's speed and hangs behind it, spreading
      const ks = 0.35 + 0.25 * j;
      this._emit(x, y0 + 0.25, z, vx * ks + rx * side * 1.0, 0.4 + Math.random() * 0.8, vz * ks + rz * side * 1.0,
        0.9 + Math.random() * 0.6, (big ? 2.3 : 1.5) * (0.8 + 0.4 * j), 1.5, 0.26 + 0.2 * sK, 0.25, 0.92,
        (slush ? 0.66 : 0.84) * L, (slush ? 0.66 : 0.87) * L, (slush ? 0.67 : 0.9) * L);
    }
    while (nd-- > 0) {
      const side = Math.random() < 0.5 ? -1 : 1, j = Math.random(), b = -step * dir * Math.random();
      const x = ax + f.x * b + rx * hw * side, z = az + f.z * b + rz * hw * side;
      // the rooster tail: thrown up and back off the tread, falling
      const up = (slush ? 1.4 : 0.8) + Math.random() * (slush ? 1.6 : 2.2) * (0.5 + sK);
      const ks = slush ? 0.62 + 0.25 * j : 0.76 + 0.2 * j;
      const c = (slush ? 0.5 + 0.12 * j : 0.86) * L;
      this._emit(x, y0, z, vx * ks + rx * side * (0.5 + Math.random()), up, vz * ks + rz * side * (0.5 + Math.random()),
        0.3 + Math.random() * 0.3, slush ? 0.42 : 0.4 * (big ? 1.4 : 1), 0, slush ? 0.9 : 0.55, -7, 0.95,
        c, c * (slush ? 0.97 : 1.02), c * (slush ? 0.93 : 1.06));
    }
  }

  _age(dt) {
    const P = this.P, pos = this.pos, col = this.col, size = this.size, N = this.cap;
    let alive = 0;
    for (let i = 0; i < N; i++) {
      const o = i * 16;
      if (P[o + 6] <= 0) {
        if (size[i] !== 0) { size[i] = 0; pos[i * 3 + 1] = -9999; col[i * 4 + 3] = 0; }
        continue;
      }
      P[o + 6] -= dt;
      if (P[o + 6] <= 0) { size[i] = 0; pos[i * 3 + 1] = -9999; col[i * 4 + 3] = 0; continue; }
      alive++;
      P[o + 4] += P[o + 11] * dt;
      const dr = Math.pow(P[o + 12], dt * 60);
      P[o + 3] *= dr; P[o + 5] *= dr;
      P[o] += P[o + 3] * dt; P[o + 1] += P[o + 4] * dt; P[o + 2] += P[o + 5] * dt;
      const t = P[o + 6] / P[o + 7], age = 1 - t;
      pos[i * 3] = P[o]; pos[i * 3 + 1] = P[o + 1]; pos[i * 3 + 2] = P[o + 2];
      col[i * 4] = P[o + 13]; col[i * 4 + 1] = P[o + 14]; col[i * 4 + 2] = P[o + 15];
      if (P[o + 9] > 0) {
        col[i * 4 + 3] = P[o + 10] * Math.min(1, age * 10) * t * t;
        size[i] = P[o + 8] * (1 + P[o + 9] * Math.sqrt(age));
      } else {
        col[i * 4 + 3] = P[o + 10] * t;
        size[i] = P[o + 8] * (0.6 + 0.4 * t);
      }
    }
    const was = this.alive;
    this.alive = alive;
    if (alive > this.stats.maxAlive) this.stats.maxAlive = alive;
    this.stats.frames++;
    this.points.visible = alive > 0;
    // (one last upload when the last one dies, so nothing lingers on screen)
    if (alive > 0 || was > 0) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
      this.geo.attributes.psize.needsUpdate = true;
    }
  }
}
