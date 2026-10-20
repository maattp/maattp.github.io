// Fighting on foot (player.js): the punch combo and the pistol's two-handed
// aim, drawn as an overlay on the walk. See CLAUDE.md, "Fighting on foot".
//
// animateWalk poses the whole body first; this then turns the trunk and puts
// each wrist on a hand path with swim.js's two-bone armIK, slerped over the
// walk's arm by a weight that rises in ~0.06 s and falls in ~0.2 s. The legs
// keep walking underneath. The walk's own pose is saved before the overlay
// goes on and put back before the next walk (`restore`), so the walk never
// sees it -- and with nothing to show the overlay does not run at all, so the
// walk is exactly what it was (tools/gait.mjs).
//
// Sides: the L bones are at -x, which is the character's RIGHT. The lead hand
// (an orthodox stance: jab and hook) is the R bone, the rear hand (the cross)
// and the gun hand are the L bone.

import * as THREE from './three.js';
import { BONES as B } from './peds.js';
import { armIK } from './swim.js';
import { clamp, lerp, smooth } from './util.js';

const LEAD = 1, REAR = -1;
// [sx, shoulder, elbow, hand, finger, fingertip]
const ARM = {
  [REAR]: [REAR, B.shoulderL, B.elbowL, B.handL, B.fingL, B.tipL],
  [LEAD]: [LEAD, B.shoulderR, B.elbowR, B.handR, B.fingR, B.tipR],
};

// A hand path key: [u, out, up, fwd, pron, poleOut, poleUp, poleFwd]
//   u      share of the punch's duration
//   out    metres out from the midline on that arm's own side
//   up     height over the soles (character units: the shoulder is at 1.42,
//          the chin 1.52)
//   fwd    metres ahead of the body's centre
//   pron   the fist's turn about the forearm: 0 thumb up .. 1.3 palm down
//   pole   where the elbow points, (out, up, fwd) in the body's frame
// Fists at the chin, a hand's width in front of it, elbows down and in.
const GUARD = [0, 0.11, 1.46, 0.24, 0.25, 0.45, -1, -0.15];
const g2 = (u) => [u, ...GUARD.slice(1)];

/**
 * The combo: a jab with the lead hand, a cross with the rear (more hip and
 * trunk in it), a lead hook on the third quick press. `hit` is the frame the
 * fist arrives (s), the damage is dealt THEN; `next` is when another press
 * can cut into the recovery. `twist` keys are [u, twist, lean]: twist brings
 * the punching shoulder forward (rad of trunk yaw), lean pitches the trunk in.
 */
const PUNCHES = [
  {
    name: 'jab', arm: LEAD, dur: 0.28, hit: 0.11, next: 0.19, dmg: 14,
    path: [g2(0),
      [0.15, 0.13, 1.43, 0.19, 0.30, 0.55, -1, -0.25],      // a small chamber
      [0.39, 0.03, 1.47, 0.62, 1.20, 0.35, -1, 0.0],        // HIT: out at full stretch
      [0.53, 0.03, 1.47, 0.60, 1.20, 0.35, -1, 0.0],
      g2(1)],
    twist: [[0, 0, 0], [0.15, -0.05, 0], [0.39, 0.24, 0.05], [0.53, 0.22, 0.05], [1, 0, 0]],
  },
  {
    name: 'cross', arm: REAR, dur: 0.32, hit: 0.14, next: 0.23, dmg: 18,
    path: [g2(0),
      [0.18, 0.13, 1.42, 0.16, 0.30, 0.60, -1, -0.30],
      [0.44, -0.02, 1.47, 0.64, 1.25, 0.30, -1, 0.0],       // HIT: across to the midline
      [0.58, -0.02, 1.47, 0.62, 1.25, 0.30, -1, 0.0],
      g2(1)],
    twist: [[0, 0, 0], [0.18, -0.12, 0], [0.44, 0.58, 0.12], [0.58, 0.52, 0.10], [1, 0, 0]],
  },
  {
    name: 'hook', arm: LEAD, dur: 0.38, hit: 0.18, next: 0.40, dmg: 26,
    path: [g2(0),
      [0.22, 0.27, 1.43, 0.15, 0.45, 1, 0.10, -0.40],       // elbow out, loaded
      [0.47, -0.06, 1.50, 0.40, 0.60, 1, 0.45, -0.10],      // HIT: round to the jaw, elbow up
      [0.60, -0.04, 1.50, 0.39, 0.60, 1, 0.45, -0.10],
      g2(1)],
    twist: [[0, 0, 0], [0.22, -0.24, 0.02], [0.47, 0.52, 0.08], [0.60, 0.46, 0.06], [1, 0, 0]],
  },
];
// The third key of every path is the hit: it lands on the hit frame.
for (const P of PUNCHES) P.path[2][0] = P.twist[2][0] = P.hit / P.dur;
export const PUNCH_NAMES = PUNCHES.map((p) => p.name);

// The strike segment (the one ending on the hit key) accelerates into the
// target: a smoothstep on t^1.6 peaks late and still arrives at rest, the
// snap of a punch rather than a reach.
const strike = (t) => smooth(Math.pow(t, 1.6));

function sampleKeys(keys, u, out) {
  let i = keys.length - 2;
  for (let k = 0; k < keys.length - 1; k++) if (u < keys[k + 1][0]) { i = k; break; }
  const a = keys[i], b = keys[i + 1];
  const t = clamp((u - a[0]) / ((b[0] - a[0]) || 1), 0, 1);
  const e = i === 1 ? strike(t) : smooth(t);
  for (let j = 1; j < a.length; j++) out[j - 1] = lerp(a[j], b[j], e);
  return out;
}

// The pistol, in the gun hand's bone frame: -y runs out along the fingers
// (the barrel's way with the wrist straight), +z is the thumb's side (the
// slide's top), +x is the palm's side for the L (right) hand. A handful of
// boxes in one geometry with vertex colours: one draw.
const MUZZLE = new THREE.Vector3(0.012, -0.215, 0.050);
function pistolGeometry() {
  const steel = [0.09, 0.09, 0.10], black = [0.035, 0.035, 0.04];
  // [w (x), l (y), h (z), cx, cy, cz, colour]
  const parts = [
    [0.026, 0.190, 0.032, 0.012, -0.118, 0.050, steel],   // slide
    [0.022, 0.135, 0.016, 0.012, -0.128, 0.027, black],   // frame / dust cover
    [0.025, 0.036, 0.098, 0.012, -0.050, -0.012, black],  // grip, through the fist
    [0.006, 0.030, 0.004, 0.012, -0.085, 0.004, black],   // trigger guard
    [0.008, 0.012, 0.010, 0.012, -0.210, 0.069, steel],   // front sight
  ];
  const pos = [], nor = [], col = [];
  for (const [w, l, hgt, cx, cy, cz, c] of parts) {
    const g = new THREE.BoxGeometry(w, l, hgt).toNonIndexed();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i] + cx, p[i + 1] + cy, p[i + 2] + cz);
      nor.push(n[i], n[i + 1], n[i + 2]);
      col.push(c[0], c[1], c[2]);
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

const _T = new THREE.Vector3(), _P = new THREE.Vector3(), _W = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _key = [0, 0, 0, 0, 0, 0, 0], _key2 = [0, 0, 0, 0, 0, 0, 0], _tw = [0, 0];

export class Fighter {
  constructor(h) {
    this.h = h;
    this.cur = null;      // the punch being thrown
    this.t = 0;           // its clock
    this.combo = -1;      // index of the last punch thrown
    this.comboT = 0;      // seconds left to chain the next one
    this.guardT = 0;      // seconds the guard is held after the last punch
    this.w = 0;           // the punch overlay's weight
    this.hitDue = false;  // the hit frame passed this frame: player resolves it
    this.hitPunch = null; // ...and which punch it was
    this.target = null;   // soft-locked pedestrian
    this.aimT = 0;        // seconds the aim is held after a shot
    this.aimW = 0;
    this.aimYaw = 0;      // world yaw the gun points along
    this.recoil = 0;
    this.live = false;    // an overlay was applied last frame (restore it)
    this.saved = h.bones.map(() => new THREE.Quaternion());
    // The pistol: hidden until the player is armed and on foot.
    this.gunMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
    this.gun = new THREE.Mesh(pistolGeometry(), this.gunMat);
    this.gun.name = 'pistol';
    this.gun.visible = false;
    this.gun.castShadow = false;
    this.gun.frustumCulled = false;
    h.bones[B.handL].add(this.gun);
  }

  /** Any pose to put over the walk this frame? */
  get posing() { return !!this.cur || this.w > 0 || this.aimW > 0 || this.gun.visible; }

  reset() {
    this.cur = null; this.t = 0; this.combo = -1; this.comboT = 0; this.guardT = 0;
    this.w = 0; this.hitDue = false; this.target = null;
    this.aimT = 0; this.aimW = 0; this.recoil = 0; this.live = false;
  }

  /** Throw the next punch of the combo. Returns the cooldown before another. */
  punch(target) {
    const k = this.comboT > 0 || this.cur ? (this.combo + 1) % PUNCHES.length : 0;
    this.combo = k;
    this.cur = PUNCHES[k];
    this.t = 0;
    this.hitDue = false;
    this.target = target;
    return this.cur.next;
  }

  /** A shot: raise the aim (held a second) and kick. */
  fire(aimYaw) {
    this.aimYaw = aimYaw;
    this.aimT = 1.0;
    this.recoil = 1;
  }

  /** Before animateWalk: put back the walk's own pose from last frame. */
  restore() {
    if (!this.live) return;
    const b = this.h.bones;
    for (let i = 0; i < b.length; i++) b[i].quaternion.copy(this.saved[i]);
    this.live = false;
  }

  /** The muzzle in world space (the pose must be current). */
  muzzle(out) {
    this.gun.updateWorldMatrix(true, false);
    return this.gun.localToWorld(out.copy(MUZZLE));
  }

  /** The barrel's world direction (the pose must be current). */
  barrel(out) {
    this.gun.getWorldQuaternion(_q);
    return out.set(0, -1, 0).applyQuaternion(_q);
  }

  /**
   * Advance and pose, after animateWalk. `speed` keeps the hips out of it at
   * a walk (their yaw would swing the planted feet), `heading` is the body's.
   */
  apply(dt, speed, heading) {
    const h = this.h, b = h.bones, g = h.group;
    // timers
    this.hitDue = false;
    if (this.cur) {
      const t0 = this.t;
      this.t += dt;
      if (t0 < this.cur.hit && this.t >= this.cur.hit) { this.hitDue = true; this.hitPunch = this.cur; }
      if (this.t >= this.cur.dur) { this.cur = null; this.comboT = 0.30; this.guardT = 0.35; }
    } else {
      this.comboT = Math.max(0, this.comboT - dt);
      this.guardT = Math.max(0, this.guardT - dt);
    }
    if (this.cur || this.guardT > 0) this.w = Math.min(1, this.w + dt / 0.06);
    else this.w = Math.max(0, this.w - dt / 0.22);
    this.aimT = Math.max(0, this.aimT - dt);
    if (this.aimT > 0) this.aimW = Math.min(1, this.aimW + dt / 0.09);
    else this.aimW = Math.max(0, this.aimW - dt / 0.25);
    this.recoil *= Math.exp(-16 * dt);
    if (this.recoil < 1e-3) this.recoil = 0;
    if (!this.posing) return;

    // the walk's pose, kept for restore()
    for (let i = 0; i < b.length; i++) this.saved[i].copy(b[i].quaternion);
    this.live = true;

    const standW = 1 - clamp(speed / 1.5, 0, 1);
    const hipX = b[B.hips].position.x, hipDy = b[B.hips].position.y - 0.927;
    const s = g.scale.x;
    const L1 = b[B.elbowR].position.length() * s, L2 = b[B.handR].position.length() * s;

    // --- the trunk -------------------------------------------------------
    let yaw = 0, lean = 0;           // trunk yaw (+ = toward +x), forward lean
    const P = this.cur, w = this.w;
    let u = 0;
    if (P) {
      u = clamp(this.t / P.dur, 0, 1);
      sampleKeys(P.twist, u, _tw);
      // + brings the punching shoulder forward: the R (+x) shoulder comes
      // forward on a NEGATIVE yaw
      yaw += -P.arm * _tw[0] * w;
      lean += _tw[1] * w;
    }
    // aiming: the trunk turns to the gun's line, the rest is in the arms
    const aimRel = Math.atan2(Math.sin(this.aimYaw - heading), Math.cos(this.aimYaw - heading));
    const aw = this.aimW;
    // (+0.12: the gun shoulder a little forward, the arm straighter)
    if (aw > 0) yaw += clamp(aimRel, -1.1, 1.1) * aw * 0.85 + 0.12 * aw;
    if (yaw !== 0 || lean !== 0 || aw > 0) {
      b[B.hips].rotation.y += yaw * 0.30 * standW;
      b[B.spine].rotation.y += yaw * 0.30;
      b[B.chest].rotation.y += yaw * 0.40;
      b[B.spine].rotation.x += lean * 0.45 - this.recoil * 0.02 * aw;
      b[B.chest].rotation.x += lean * 0.35 - this.recoil * 0.03 * aw;
      // eyes on the target (ahead) or down the gun's line
      const turned = yaw * (0.70 + 0.30 * standW);
      b[B.head].rotation.y += clamp(aimRel * aw - turned, -1, 1) * 0.85;
      b[B.neck].rotation.x -= lean * 0.6;
    }
    g.updateMatrixWorld(true);

    // --- the arms --------------------------------------------------------
    const gunOn = this.gun.visible;
    for (const sx of [REAR, LEAD]) {
      const [, sh, el, hand, fing, tip] = ARM[sx];
      // which pose drives this arm, and how much
      let k = 0, rel = 0;
      if (aw > 0) {
        // two hands on the gun: the R hand on the grip at the midline, the L
        // cupping it from below; the line is the aim's
        k = smooth(aw); rel = aimRel;
        const r = this.recoil;
        if (sx === REAR) { _key[0] = 0.02; _key[1] = 1.41 + 0.05 * r; _key[2] = 0.54 - 0.07 * r; _key[3] = 0; _key[4] = 0.55; _key[5] = -1; _key[6] = -0.25; }
        else { _key[0] = -0.035; _key[1] = 1.375 + 0.05 * r; _key[2] = 0.50 - 0.07 * r; _key[3] = 0.15; _key[4] = 0.9; _key[5] = -1; _key[6] = -0.25; }
      } else if (w > 0) {
        k = smooth(w);
        if (P && P.arm === sx) sampleKeys(P.path, u, _key);
        else {
          for (let j = 0; j < 7; j++) _key[j] = GUARD[j + 1];
          // the other fist comes back to the chin as the punch goes out
          if (P) { const e = Math.sin(Math.PI * clamp(u / 0.6, 0, 1)); _key[1] += 0.02 * e; _key[2] -= 0.04 * e; }
        }
      }
      if (k <= 0) {
        if (gunOn && sx === REAR) { b[fing].rotation.z = 1.25; b[tip].rotation.z = 1.10; }
        continue;
      }
      // body frame -> world: out on this arm's side, turned by rel
      const c = Math.cos(rel), sn = Math.sin(rel);
      const lx = sx * _key[0] + hipX, lz = _key[2];
      _T.set(lx * c + lz * sn, _key[1] + hipDy, -lx * sn + lz * c);
      g.localToWorld(_T);
      const px = sx * _key[4], pz = _key[6];
      _P.set(px * c + pz * sn, _key[5], -px * sn + pz * c).applyQuaternion(g.quaternion);
      _q.copy(b[sh].quaternion); _q2.copy(b[el].quaternion);
      armIK(b[sh], b[el], _T, _P, L1, L2, _W);
      if (k < 1) {
        // (slerp from the walk's; slerpQuaternions into its own argument
        // would copy the walk's over the IK first)
        b[sh].quaternion.copy(_q.slerp(b[sh].quaternion, k));
        b[el].quaternion.copy(_q2.slerp(b[el].quaternion, k));
      }
      // the fist: closed, the wrist straight, turned palm-down as it lands
      // (the curl is +z on the L bones, -z on the R: sign -sx)
      const curl = gunOn && sx === REAR ? 1.25 : 1.40;
      if (gunOn && sx === REAR && aw > 0) {
        // The gun hand is turned so the barrel lies along the aim, level,
        // the slide up -- whatever angle the forearm comes up at (it rises
        // from an elbow below the shoulder, and the barrel rode it 25 deg
        // high). The recoil tips the muzzle up.
        const p = 0.5 * this.recoil, ax = Math.sin(this.aimYaw), az = Math.cos(this.aimYaw);
        _Y.set(-ax * Math.cos(p), -Math.sin(p), -az * Math.cos(p));
        _Z.set(0, 1, 0).addScaledVector(_Y, -_Y.y).normalize();
        _X.crossVectors(_Y, _Z);
        _m.makeBasis(_X, _Y, _Z);
        _q.setFromRotationMatrix(_m);
        b[hand].parent.getWorldQuaternion(_q2).invert();
        _q2.multiply(_q);
        b[hand].quaternion.slerp(_q2, k);
      } else {
        const pron = -sx * _key[3];
        b[hand].rotation.set(lerp(b[hand].rotation.x, 0, k), lerp(b[hand].rotation.y, pron, k), lerp(b[hand].rotation.z, 0, k));
      }
      b[fing].rotation.z = lerp(b[fing].rotation.z, -sx * curl, gunOn && sx === REAR ? 1 : k);
      b[tip].rotation.z = lerp(b[tip].rotation.z, -sx * curl * 0.9, gunOn && sx === REAR ? 1 : k);
    }
  }
}
