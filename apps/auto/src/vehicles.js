// Vehicle models (built once per type) and the arcade driving model.

import * as THREE from './three.js';
import { Builder } from './build.js';
import { clamp, lerp, angleWrap, hash2 } from './util.js';
import * as G from './geo.js';

const BLACK = [0.06, 0.06, 0.07];
const GLASSC = [0.16, 0.22, 0.28];
const CHROME = [0.72, 0.74, 0.76];
const LIGHT = [1.0, 0.97, 0.82];
const TAIL = [0.85, 0.12, 0.1];
const TRIM = [0.2, 0.21, 0.23];

export const TYPES = {
  sedan: { len: 4.7, wid: 1.86, bodyH: 0.74, cab: [-0.30, 0.20], cabH: 0.60, mass: 1, top: 42, acc: 9.5 },
  hatch: { len: 4.05, wid: 1.76, bodyH: 0.72, cab: [-0.30, 0.14], cabH: 0.58, mass: 0.9, top: 38, acc: 9 },
  compact: { len: 3.7, wid: 1.7, bodyH: 0.70, cab: [-0.26, 0.12], cabH: 0.56, mass: 0.85, top: 36, acc: 8.6 },
  suv: { len: 4.95, wid: 1.98, bodyH: 1.00, cab: [-0.34, 0.26], cabH: 0.62, mass: 1.3, top: 40, acc: 8.8, wheelR: 0.38 },
  sports: { len: 4.45, wid: 1.94, bodyH: 0.56, cab: [-0.22, 0.04], cabH: 0.44, mass: 0.85, top: 62, acc: 15, spoiler: true },
  muscle: { len: 5.05, wid: 2.0, bodyH: 0.72, cab: [-0.20, 0.10], cabH: 0.52, mass: 1.15, top: 55, acc: 13.5 },
  pickup: { len: 5.5, wid: 2.02, bodyH: 0.92, cab: [-0.06, 0.28], cabH: 0.68, bed: true, mass: 1.4, top: 39, acc: 8.6, wheelR: 0.4 },
  van: { len: 5.3, wid: 2.02, bodyH: 1.62, cab: [-0.45, 0.32], cabH: 0.0, boxy: true, mass: 1.5, top: 36, acc: 7.6 },
  taxi: { len: 4.75, wid: 1.88, bodyH: 0.74, cab: [-0.30, 0.20], cabH: 0.60, taxi: true, mass: 1, top: 42, acc: 9.5 },
  police: { len: 4.95, wid: 1.94, bodyH: 0.78, cab: [-0.30, 0.20], cabH: 0.60, police: true, mass: 1.1, top: 56, acc: 14 },
  bus: { len: 12.2, wid: 2.55, bodyH: 3.0, bus: true, mass: 4.5, top: 26, acc: 4.2, wheelR: 0.5 },
  boxtruck: { len: 7.6, wid: 2.4, bodyH: 1.05, cargo: 2.6, cab: [0.16, 0.46], cabH: 1.15, mass: 3, top: 30, acc: 5.2, wheelR: 0.46 },
  ambulance: { len: 6.4, wid: 2.3, bodyH: 1.0, cargo: 2.2, cab: [0.2, 0.46], cabH: 1.0, mass: 2.4, top: 40, acc: 8, wheelR: 0.42, emergency: true },
  garbage: { len: 8.2, wid: 2.5, bodyH: 1.2, cargo: 2.4, cab: [0.22, 0.46], cabH: 1.2, mass: 4, top: 26, acc: 4.4, wheelR: 0.5 },
};

export const CIVILIAN_TYPES = ['sedan', 'sedan', 'hatch', 'compact', 'suv', 'suv', 'sports', 'muscle', 'pickup', 'van', 'taxi', 'boxtruck', 'bus', 'garbage'];

export const CAR_COLORS = [
  0xb8bcc0, 0x2a2d31, 0xe8e9ea, 0x7d0f14, 0x14406e, 0x1d5c3a, 0x8a6a2b,
  0x3d4b57, 0xa8a29a, 0x5c2b6b, 0xd07a10, 0x0f6f7a, 0x6f7175, 0xc9cdd2,
];

// ---------------------------------------------------------------------------

function buildType(spec) {
  const body = new Builder(false);
  const det = new Builder(false);
  const L = spec.len, W = spec.wid;
  const wr = spec.wheelR || 0.34;
  const floor = wr * 0.72;
  const white = [1, 1, 1];

  if (spec.bus) {
    body.box(0, floor, 0, W, spec.bodyH, L, 0, white);
    det.box(0, floor + spec.bodyH, 0, W * 0.95, 0.16, L * 0.96, 0, TRIM);
    // window band
    for (const sx of [-1, 1]) {
      det.box(sx * (W / 2 + 0.01), floor + spec.bodyH * 0.52, 0, 0.06, spec.bodyH * 0.34, L * 0.9, 0, GLASSC);
    }
    det.box(0, floor + spec.bodyH * 0.5, L / 2 + 0.01, W * 0.86, spec.bodyH * 0.36, 0.06, 0, GLASSC);
    det.box(0, floor + spec.bodyH * 0.5, -L / 2 - 0.01, W * 0.86, spec.bodyH * 0.32, 0.06, 0, GLASSC);
    det.box(0, floor + 0.18, L / 2 + 0.02, W * 0.7, 0.22, 0.08, 0, LIGHT);
    det.box(0, floor + 0.18, -L / 2 - 0.02, W * 0.7, 0.22, 0.08, 0, TAIL);
  } else if (spec.cargo) {
    const cabL = (spec.cab[1] - spec.cab[0]) * L;
    const cabC = ((spec.cab[0] + spec.cab[1]) / 2) * L;
    body.box(0, floor, 0, W, spec.bodyH, L, 0, white);
    body.box(0, floor + spec.bodyH, cabC, W, spec.cabH, cabL, 0, white);
    det.box(0, floor + spec.bodyH + spec.cabH * 0.45, cabC + cabL / 2 + 0.01, W * 0.84, spec.cabH * 0.5, 0.06, 0, GLASSC);
    const boxL = L * 0.52;
    det.box(0, floor + spec.bodyH, -L * 0.18, W * 1.01, spec.cargo, boxL, 0, [0.92, 0.92, 0.92]);
    det.box(0, floor + spec.bodyH + spec.cargo, -L * 0.18, W * 1.03, 0.1, boxL + 0.06, 0, TRIM);
    det.box(0, floor + 0.2, L / 2 + 0.02, W * 0.76, 0.24, 0.08, 0, LIGHT);
    det.box(0, floor + 0.2, -L / 2 - 0.02, W * 0.76, 0.24, 0.08, 0, TAIL);
    if (spec.emergency) {
      det.box(0, floor + spec.bodyH + spec.cargo + 0.1, -L * 0.18, 1.1, 0.18, 0.4, 0, [0.9, 0.15, 0.12]);
    }
  } else {
    const cabL = (spec.cab[1] - spec.cab[0]) * L;
    const cabC = ((spec.cab[0] + spec.cab[1]) / 2) * L;
    // lower mass with a slight taper
    body.box(0, floor, 0, W, spec.bodyH * 0.55, L, 0, white);
    body.box(0, floor + spec.bodyH * 0.55, 0, W * 0.99, spec.bodyH * 0.45, L * 0.985, 0, white);
    if (spec.bed) {
      body.box(0, floor + spec.bodyH, -L * 0.22, W * 0.98, 0.44, L * 0.42, 0, white);
      det.box(0, floor + spec.bodyH + 0.02, -L * 0.22, W * 0.8, 0.06, L * 0.36, 0, TRIM);
    }
    if (spec.boxy) {
      det.box(0, floor + spec.bodyH * 0.62, L / 2 + 0.01, W * 0.86, spec.bodyH * 0.3, 0.06, 0, GLASSC);
      for (const sx of [-1, 1]) det.box(sx * (W / 2 + 0.01), floor + spec.bodyH * 0.62, L * 0.16, 0.06, spec.bodyH * 0.26, L * 0.34, 0, GLASSC);
    } else {
      body.box(0, floor + spec.bodyH, cabC, W * 0.9, spec.cabH, cabL, 0, white);
      // glass
      det.box(0, floor + spec.bodyH + spec.cabH * 0.5, cabC + cabL / 2 + 0.005, W * 0.82, spec.cabH * 0.66, 0.06, 0, GLASSC);
      det.box(0, floor + spec.bodyH + spec.cabH * 0.5, cabC - cabL / 2 - 0.005, W * 0.8, spec.cabH * 0.6, 0.06, 0, GLASSC);
      for (const sx of [-1, 1]) {
        det.box(sx * (W * 0.45 + 0.005), floor + spec.bodyH + spec.cabH * 0.52, cabC, 0.05, spec.cabH * 0.56, cabL * 0.86, 0, GLASSC);
        det.box(sx * (W * 0.5 + 0.06), floor + spec.bodyH + spec.cabH * 0.45, cabC + cabL * 0.42, 0.16, 0.11, 0.24, 0, TRIM);
      }
      det.box(0, floor + spec.bodyH + spec.cabH, cabC, W * 0.86, 0.05, cabL * 0.94, 0, TRIM);
    }
    if (spec.spoiler) {
      det.box(0, floor + spec.bodyH + 0.18, -L * 0.46, W * 0.8, 0.06, 0.28, 0, TRIM);
      for (const sx of [-1, 1]) det.box(sx * W * 0.32, floor + spec.bodyH, -L * 0.46, 0.07, 0.2, 0.2, 0, TRIM);
    }
    // bumpers, lights, grille
    det.box(0, floor + 0.12, L / 2 + 0.02, W * 0.96, 0.26, 0.1, 0, TRIM);
    det.box(0, floor + 0.12, -L / 2 - 0.02, W * 0.96, 0.26, 0.1, 0, TRIM);
    for (const sx of [-1, 1]) {
      det.box(sx * W * 0.32, floor + spec.bodyH * 0.62, L / 2 + 0.01, W * 0.26, 0.16, 0.07, 0, LIGHT);
      det.box(sx * W * 0.32, floor + spec.bodyH * 0.62, -L / 2 - 0.01, W * 0.26, 0.16, 0.07, 0, TAIL);
    }
    det.box(0, floor + spec.bodyH * 0.5, L / 2 + 0.01, W * 0.38, 0.2, 0.06, 0, BLACK);
    if (spec.taxi) {
      det.box(0, floor + spec.bodyH + spec.cabH + 0.05, cabC, 0.9, 0.24, 0.34, 0, [1, 0.85, 0.15]);
    }
    if (spec.police) {
      det.box(0, floor + spec.bodyH + spec.cabH + 0.05, cabC + 0.1, 1.15, 0.16, 0.28, 0, TRIM);
      det.box(-0.3, floor + spec.bodyH + spec.cabH + 0.13, cabC + 0.1, 0.5, 0.14, 0.3, 0, [0.15, 0.3, 1.0]);
      det.box(0.3, floor + spec.bodyH + spec.cabH + 0.13, cabC + 0.1, 0.5, 0.14, 0.3, 0, [1.0, 0.15, 0.15]);
    }
  }

  // wheels
  const wheels = [];
  const wx = W / 2 - 0.12;
  const wz = L * (spec.bus || spec.cargo ? 0.33 : 0.31);
  const tyreW = spec.bus || spec.cargo ? 0.34 : 0.26;
  wheels.push([-wx, wr, wz], [wx, wr, wz], [-wx, wr, -wz], [wx, wr, -wz]);
  if (spec.bus || (spec.cargo && spec.len > 7)) wheels.push([-wx, wr, -wz + 1.0], [wx, wr, -wz + 1.0]);

  // Traffic cars bake their wheels into the detail mesh: one extra draw call per
  // car instead of five. Only the player's car gets steerable wheel meshes.
  const detWheels = new Builder(false);
  detWheels.pos = det.pos.slice();
  detWheels.nor = det.nor.slice();
  detWheels.col = det.col.slice();
  detWheels.idx = det.idx.slice();
  detWheels.useUV = false;
  for (const [ox, oy, oz] of wheels) addWheel(detWheels, ox, oy, oz, wr, tyreW);

  const wb = new Builder(false);
  addWheel(wb, 0, 0, 0, wr, tyreW);

  return {
    bodyGeo: body.build(),
    detGeo: det.build(),
    detWheelsGeo: detWheels.build(),
    wheelGeo: wb.build(),
    wheels,
    spec,
    wheelR: wr,
  };
}

function addWheel(b, cx, cy, cz, r, w) {
  const sides = 9;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const y0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r;
    const y1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
    const ny = Math.cos((a0 + a1) / 2), nz = Math.sin((a0 + a1) / 2);
    b.quad([cx - w / 2, cy + y0, cz + z0], [cx + w / 2, cy + y0, cz + z0],
      [cx + w / 2, cy + y1, cz + z1], [cx - w / 2, cy + y1, cz + z1],
      [0, ny, nz], [0, 0, 1, 0, 1, 1, 0, 1], BLACK);
    b.tri([cx + w / 2 + 0.001, cy + y0 * 0.62, cz + z0 * 0.62], [cx + w / 2 + 0.001, cy + y1 * 0.62, cz + z1 * 0.62], [cx + w / 2 + 0.001, cy, cz], [1, 0, 0], CHROME);
    b.tri([cx - w / 2 - 0.001, cy + y1 * 0.62, cz + z1 * 0.62], [cx - w / 2 - 0.001, cy + y0 * 0.62, cz + z0 * 0.62], [cx - w / 2 - 0.001, cy, cz], [-1, 0, 0], CHROME);
  }
}

let CACHE = null;
export function vehicleAssets() {
  if (CACHE) return CACHE;
  const types = {};
  for (const k of Object.keys(TYPES)) types[k] = buildType(TYPES[k]);
  CACHE = {
    types,
    detMat: new THREE.MeshLambertMaterial({ vertexColors: true }),
    wheelMat: new THREE.MeshLambertMaterial({ vertexColors: true }),
  };
  return CACHE;
}

// ---------------------------------------------------------------------------

export class Vehicle {
  constructor(city, typeName, color, opts = {}) {
    const A = vehicleAssets();
    const t = A.types[typeName];
    this.city = city;
    this.typeName = typeName;
    this.t = t;
    this.spec = t.spec;
    this.color = color;
    this.detailedWheels = !!opts.detailedWheels;

    this.group = new THREE.Group();
    this.bodyMat = new THREE.MeshLambertMaterial({ color });
    const bodyMesh = new THREE.Mesh(t.bodyGeo, this.bodyMat);
    const detMesh = new THREE.Mesh(this.detailedWheels ? t.detGeo : t.detWheelsGeo, A.detMat);
    bodyMesh.castShadow = detMesh.castShadow = true;
    this.detMesh = detMesh;
    this.tilt = new THREE.Group();
    this.tilt.add(bodyMesh, detMesh);
    this.group.add(this.tilt);

    this.wheelMeshes = [];
    if (this.detailedWheels) {
      for (const [wx, wy, wz] of t.wheels) {
        const m = new THREE.Mesh(t.wheelGeo, A.wheelMat);
        m.position.set(wx, wy, wz);
        m.castShadow = true;
        m.userData.front = wz > 0;
        this.tilt.add(m);
        this.wheelMeshes.push(m);
      }
    }

    this.x = 0; this.y = 0; this.z = 0;
    this.heading = 0;
    this.vLong = 0; this.vLat = 0;
    this.steer = 0;
    this.pitch = 0; this.roll = 0;
    this.health = 100;
    this.dead = false;
    this.onGround = true;
    this.vy = 0;
    this.wheelSpin = 0;
    this.skid = 0;
    this.radius = Math.max(t.spec.len, t.spec.wid) * 0.42;
    this.halfLen = t.spec.len / 2;
    this.halfWid = t.spec.wid / 2;
    this.mass = t.spec.mass;
  }

  /** The player's own car gets steerable, spinning wheel meshes; traffic doesn't. */
  setDetailed(on) {
    if (this.detailedWheels === on) return;
    this.detailedWheels = on;
    const A = vehicleAssets();
    this.detMesh.geometry = on ? this.t.detGeo : this.t.detWheelsGeo;
    if (on) {
      for (const [wx, wy, wz] of this.t.wheels) {
        const m = new THREE.Mesh(this.t.wheelGeo, A.wheelMat);
        m.position.set(wx, wy, wz);
        m.castShadow = true;
        m.userData.front = wz > 0;
        this.tilt.add(m);
        this.wheelMeshes.push(m);
      }
    } else {
      for (const m of this.wheelMeshes) this.tilt.remove(m);
      this.wheelMeshes.length = 0;
    }
  }

  place(x, z, heading) {
    this.x = x; this.z = z;
    this.heading = heading;
    this.y = this.city.groundAt(x, z, null);
    this.sync();
  }

  get speed() {
    return Math.hypot(this.vLong, this.vLat);
  }

  get forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  update(dt, input) {
    const spec = this.spec;
    const throttle = input.throttle || 0;
    const brake = input.brake || 0;
    const hand = input.handbrake || 0;
    const steerIn = clamp(input.steer || 0, -1, 1);

    const sp = Math.abs(this.vLong);
    // Steering authority falls off with speed so the car stays controllable.
    const maxSteer = lerp(0.62, 0.16, clamp(sp / 34, 0, 1));
    this.steer = lerp(this.steer, steerIn * maxSteer, 1 - Math.exp(-11 * dt));

    const top = spec.top;
    let acc = 0;
    if (throttle > 0) {
      acc += spec.acc * throttle * (1 - clamp(this.vLong / top, 0, 1));
      if (this.vLong < -0.5) acc += spec.acc * 1.4 * throttle;
    }
    if (brake > 0) {
      if (this.vLong > 0.4) acc -= 16 * brake;
      else acc -= spec.acc * 0.55 * brake * (1 - clamp(-this.vLong / (top * 0.42), 0, 1));
    }
    // slope
    const gy = this.city.groundAt(this.x, this.z, this.y + 0.6);
    const ahead = this.city.groundAt(this.x + this.forward.x * 3, this.z + this.forward.z * 3, this.y + 2.5);
    acc -= clamp((ahead - gy) / 3, -0.7, 0.7) * 9.0;

    acc -= this.vLong * Math.abs(this.vLong) * 0.0016; // aero
    acc -= this.vLong * 0.07; // rolling resistance
    if (throttle === 0 && brake === 0 && Math.abs(this.vLong) > 0.3) {
      acc -= Math.sign(this.vLong) * 2.4; // engine braking
    }
    if (hand > 0.5 && this.vLong > 0) acc -= 11;
    this.vLong += acc * dt;
    if (Math.abs(this.vLong) < 0.12 && throttle === 0) this.vLong *= 0.82;

    // Bicycle-model yaw plus lateral slip for arcade drift.
    const wheelbase = spec.len * 0.62;
    const yawRate = (this.vLong / wheelbase) * Math.tan(this.steer);
    this.heading += yawRate * dt;

    const gripBase = spec.bus || spec.cargo ? 7.5 : 9.5;
    const grip = hand > 0.5 ? 1.5 : gripBase;
    this.vLat += -yawRate * this.vLong * dt;
    const before = this.vLat;
    this.vLat *= Math.exp(-grip * dt);
    this.skid = clamp(Math.abs(before) * 0.35, 0, 1);

    const f = this.forward;
    const rx = f.z, rz = -f.x;
    let dx = (f.x * this.vLong + rx * this.vLat) * dt;
    let dz = (f.z * this.vLong + rz * this.vLat) * dt;

    this.x += dx;
    this.z += dz;
    this.x = G.clampToMap(this.x);
    this.z = G.clampToMap(this.z);

    // vertical: follow ground, with a little air time over crests
    const target = this.city.groundAt(this.x, this.z, this.y + 1.2);
    if (this.y > target + 0.25) {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      this.onGround = false;
      if (this.y <= target) { this.y = target; this.vy = 0; this.onGround = true; }
    } else {
      const rise = target - this.y;
      if (rise > 0.6 && sp > 6) { this.vy = Math.min(6, rise * 4); }
      this.y = lerp(this.y, target, 1 - Math.exp(-18 * dt));
      this.onGround = true;
    }

    // body attitude
    const fh = this.city.groundAt(this.x + f.x * this.halfLen, this.z + f.z * this.halfLen, this.y + 1.5);
    const bh = this.city.groundAt(this.x - f.x * this.halfLen, this.z - f.z * this.halfLen, this.y + 1.5);
    const lh = this.city.groundAt(this.x + rx * this.halfWid, this.z + rz * this.halfWid, this.y + 1.5);
    const rh = this.city.groundAt(this.x - rx * this.halfWid, this.z - rz * this.halfWid, this.y + 1.5);
    const tgtPitch = Math.atan2(bh - fh, this.halfLen * 2) - clamp(acc, -12, 12) * 0.0045;
    const tgtRoll = Math.atan2(rh - lh, this.halfWid * 2) + clamp(this.vLat, -9, 9) * 0.016;
    this.pitch = lerp(this.pitch, tgtPitch, 1 - Math.exp(-10 * dt));
    this.roll = lerp(this.roll, tgtRoll, 1 - Math.exp(-10 * dt));

    this.wheelSpin += (this.vLong / (this.t.wheelR || 0.34)) * dt;
    this.sync();
    return { dx, dz };
  }

  sync() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.heading;
    this.tilt.rotation.x = this.pitch;
    this.tilt.rotation.z = this.roll;
    if (this.detailedWheels) {
      for (const m of this.wheelMeshes) {
        m.rotation.x = this.wheelSpin;
        m.rotation.y = m.userData.front ? this.steer : 0;
      }
    }
  }

  damage(n) {
    this.health -= n;
    if (this.health <= 0 && !this.dead) {
      this.health = 0;
      this.dead = true;
      return true;
    }
    return false;
  }

  /** Point on the vehicle's oriented box nearest to (px,pz), in world space. */
  nearest(px, pz) {
    const f = this.forward;
    const rx = f.z, rz = -f.x;
    const dx = px - this.x, dz = pz - this.z;
    let lf = clamp(dx * f.x + dz * f.z, -this.halfLen, this.halfLen);
    let lr = clamp(dx * rx + dz * rz, -this.halfWid, this.halfWid);
    return { x: this.x + f.x * lf + rx * lr, z: this.z + f.z * lf + rz * lr };
  }
}

export function randomCarColor(seed) {
  return CAR_COLORS[Math.floor(hash2(seed, 5) * CAR_COLORS.length) % CAR_COLORS.length];
}
