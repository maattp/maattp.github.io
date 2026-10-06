// The swimmer's body (player.js updateSwim): a front crawl, treading water,
// and the blend between those poses and the walk.
//
// The crawl is driven by the HAND, not by spinning the shoulder. Each wrist
// follows a closed path fixed to the water (CRAWL below: in front of the head
// at the surface, down and back under the body to the thigh, out, and forward
// low over the water), and a two-bone IK puts the arm on it with the elbow
// toward a pole -- up and out, which is the high elbow of both the catch and
// the recovery. The upper arm's twist is taken from the plane of the arm, so
// the elbow is always a pure hinge and the palm faces back through the pull.
// See CLAUDE.md, "Swimming".

import * as THREE from './three.js';
import { BONES as B } from './peds.js';
import { clamp, lerp, smooth } from './util.js';

const TAU = Math.PI * 2;
// The body's pitch: lying along the surface, head a touch high (7 deg), and
// upright treading water.
export const PRONE = 1.47, UPRIGHT = 0.10;

// The wrist's path through one stroke, in the water's frame: [u, fwd, up,
// lat] -- u the share of the cycle, fwd metres ahead of the shoulders, up
// metres above the surface, lat metres out from the midline. Entry at u = 0;
// the hand is under the water from there to the exit at ~0.67 and moves
// BACKWARD past the body all through the pull (catch 0.22 -> finish 0.60,
// 0.93 m), and recovers forward over the water with the elbow leading.
const CRAWL = [
  [0.00, 0.40, 0.00, 0.17],   // entry, in front of the head, shoulder-wide
  [0.10, 0.55, -0.10, 0.17],  // reach
  [0.22, 0.46, -0.27, 0.15],  // catch: the hand drops below a high elbow
  [0.36, 0.14, -0.44, 0.07],  // pull, under the chest toward the midline
  [0.50, -0.24, -0.36, 0.10], // push
  [0.60, -0.47, -0.17, 0.18], // finish, by the thigh
  [0.67, -0.50, 0.02, 0.21],  // exit
  [0.76, -0.30, 0.12, 0.40],  // recovery: the elbow out first and high
  [0.86, 0.10, 0.15, 0.50],
  [0.94, 0.36, 0.09, 0.33],
];
// Each key's slope (the cycle is periodic), for a C1 Hermite through them.
const CRAWL_M = CRAWL.map((k, i) => {
  const n = CRAWL.length, p = CRAWL[(i + n - 1) % n], q = CRAWL[(i + 1) % n];
  const du = (q[0] - p[0] + 1) % 1 || 1;
  return [1, 2, 3].map((j) => (q[j] - p[j]) / du);
});

const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _T = new THREE.Vector3(), _W = new THREE.Vector3();
const _P = new THREE.Vector3(), _d = new THREE.Vector3(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3();
const _M = new THREE.Vector3(), _F = new THREE.Vector3(), _O = new THREE.Vector3();
const _pole = new THREE.Vector3(), _tread = new THREE.Vector3(), _tPole = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _key = [0, 0, 0];
// [side, bones...]: side is the bone's x sign (the L bones are at -x, which
// is the character's RIGHT); the L arm runs half a cycle behind the R.
const LEGS = [[-1, B.thighL, B.kneeL, B.footL], [1, B.thighR, B.kneeR, B.footR]];
const ARMS = [[-1, B.shoulderL, B.elbowL, B.handL, B.fingL, B.tipL, 0.5], [1, B.shoulderR, B.elbowR, B.handR, B.fingR, B.tipR, 0]];

/** The wrist's path at stroke phase u (0..1): writes [fwd, up, lat] into out. */
export function crawlPath(u, out = _key) {
  u -= Math.floor(u);
  const n = CRAWL.length;
  let i = n - 1;
  for (let k = 0; k < n - 1; k++) if (u < CRAWL[k + 1][0]) { i = k; break; }
  const a = CRAWL[i], b = CRAWL[(i + 1) % n];
  const h = ((b[0] - a[0] + 1) % 1) || 1, t = (u - a[0]) / h;
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  const ma = CRAWL_M[i], mb = CRAWL_M[(i + 1) % n];
  for (let j = 0; j < 3; j++) out[j] = h00 * a[j + 1] + h10 * h * ma[j] + h01 * b[j + 1] + h11 * h * mb[j];
  return out;
}

/**
 * Two-bone arm IK onto the world point `target`, the elbow toward the world
 * direction `pole`. Sets the upper arm's FULL orientation -- its x axis (the
 * elbow's hinge) is the normal of the shoulder-elbow-wrist plane -- and the
 * elbow as a pure hinge, so the forearm never twists off the bend and an arm
 * straight overhead is not a degenerate case. Writes the wrist into `wrist`.
 * Lengths are world (the group's scale applied); allocation-free.
 */
function armIK(sh, el, target, pole, L1, L2, wrist) {
  sh.getWorldPosition(_S);
  _d.subVectors(target, _S);
  let d = _d.length();
  if (d < 1e-6) _d.set(0, -1, 0);
  _d.normalize();
  d = clamp(d, L1 - L2 + 1e-3, L1 + L2 - 1e-3);
  _P.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_P.lengthSq() < 1e-8) _P.set(0, 1, 0).addScaledVector(_d, -_d.y);
  _P.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), hg = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _E.copy(_S).addScaledVector(_d, a).addScaledVector(_P, hg);
  wrist.copy(_S).addScaledVector(_d, d);
  _d1.subVectors(_E, _S).divideScalar(L1);
  // the bone's -y runs down the upper arm; +z points to the forearm's side of
  // it (the elbow bends toward +z), so +x is the hinge
  _Y.copy(_d1).negate();
  _Z.copy(_d).multiplyScalar(hg).addScaledVector(_P, -a).normalize();
  _X.crossVectors(_Y, _Z);
  _m.makeBasis(_X, _Y, _Z);
  _q.setFromRotationMatrix(_m);
  sh.parent.getWorldQuaternion(_pq).invert();
  sh.quaternion.multiplyQuaternions(_pq, _q);
  _d2.subVectors(wrist, _E).divideScalar(L2);
  el.rotation.set(-Math.acos(clamp(_d1.dot(_d2), -1, 1)), 0, 0);
}

// A raised-cosine bump of half-width w centred on c, on the unit circle.
function bump(u, c, w) {
  let x = u - c; x -= Math.round(x);
  return Math.abs(x) < w ? 0.5 + 0.5 * Math.cos(Math.PI * x / w) : 0;
}

/**
 * Pose the swimmer for this frame. `st` is the player's swim state
 * ({ u, tu, w, hipY }); the group must already be placed and pitched (rotation
 * order YXZ, so the pitch is about the body's own axis whatever the heading).
 * `w` is 0 treading water .. 1 at the crawl. Calls onEntry(x, z) where a hand
 * goes into the water.
 */
export function poseSwim(h, st, dt, wl, speed, onEntry) {
  const b = h.bones, g = h.group, s = g.scale.x, w = st.w;
  // the stroke: 0.8 cycles a second at 1.8 m/s, 1.05 sprinting (each hand
  // then slips ~0.1 and ~0.3 m/s against the water through the pull)
  const u0 = st.u;
  st.u += dt * (0.35 + 0.25 * speed);
  st.tu += dt * 1.1;                     // sculling, treading water
  const u = st.u, tu = st.tu * TAU;
  // the roll: the shoulders 34 deg toward whichever arm is recovering, the
  // hips a little over half that; positive raises the +x (R bone) side
  const roll = 0.6 * w * Math.cos(TAU * (u - 0.72));
  // breathing every stroke cycle to the R side, as that arm recovers
  const turn = 0.95 * w * bump(u, 0.70, 0.27);

  b[B.hips].position.set(0, st.hipY, 0);
  b[B.hips].rotation.set(0, roll * 0.55, 0);
  b[B.spine].rotation.set(0.06 * (1 - w), roll * 0.25, 0);
  b[B.chest].rotation.set(0.04 * (1 - w), roll * 0.2, 0);
  // face down, looking a little ahead (prone, the face's neutral IS down);
  // treading, chin up and looking about
  const look = (1 - w) * Math.sin(st.tu * 0.45) * 0.25;
  b[B.neck].rotation.set(-0.10 * w, turn * 0.3 + look * 0.4, 0);
  b[B.head].rotation.set(-0.12 * w - 0.15 * (1 - w), turn * 0.7 + look * 0.6, -turn * 0.15);

  // legs: a flutter kick from the hips, six beats a cycle, toes pointed; or,
  // treading, an eggbeater -- thighs forward and out, the shins circling
  const kick = TAU * 3 * u;
  for (let i = 0; i < 2; i++) {
    const L = LEGS[i], sx = L[0], th = L[1], kn = L[2], ft = L[3];
    const k = kick + (sx > 0 ? Math.PI : 0), e = tu + (sx > 0 ? Math.PI : 0);
    b[th].rotation.set(
      lerp(-1.0 + 0.12 * Math.sin(e), -0.18 + 0.13 * Math.sin(k), w),
      lerp(0.25 * sx * Math.sin(e), 0, w),
      lerp(sx * (0.42 + 0.10 * Math.cos(e)), -sx * 0.035, w));
    b[kn].rotation.set(lerp(1.35 + 0.35 * Math.sin(e + 1.2), 0.08 + 0.22 * Math.max(0, Math.sin(k - 0.5)), w), 0, 0);
    b[ft].rotation.set(lerp(-0.3, 0.85 + 0.12 * Math.sin(k - 1.0), w), 0, 0);
  }

  // arms: place the torso first, then each wrist on its path
  g.updateMatrixWorld(true);
  const shY = st.hipY + b[B.spine].position.y + b[B.chest].position.y + b[B.shoulderR].position.y;
  const SX = Math.abs(b[B.shoulderR].position.x);
  _M.set(0, shY, 0); g.localToWorld(_M);                 // between the shoulders, unrolled
  const hd = g.rotation.y;
  _F.set(Math.sin(hd), 0, Math.cos(hd));
  const L1 = b[B.elbowR].position.length() * s, L2 = b[B.handR].position.length() * s;
  for (let i = 0; i < 2; i++) {
    const A = ARMS[i], sx = A[0], sh = A[1], el = A[2], hand = A[3], fing = A[4], tip = A[5], off = A[6];
    _O.set(Math.cos(hd) * sx, 0, -Math.sin(hd) * sx);   // out, on this arm's side
    const ua = u + off;
    crawlPath(ua);
    _T.copy(_M).addScaledVector(_F, _key[0]).addScaledVector(_O, _key[2]);
    _T.y = wl + _key[1];
    // the elbow: up and out over the catch and pull; forward as the hand
    // leaves the water (the elbow leads it out), then up -- and never near
    // the line to the wrist, which spins the arm's twist (a pole straight up
    // flipped the palm 79 deg in one frame at mid-recovery)
    const rec = bump(ua, 0.84, 0.22), lead = bump(ua, 0.70, 0.16);
    _pole.copy(_O).multiplyScalar(0.75 - 0.25 * rec).addScaledVector(_F, -0.15 + 0.8 * lead - 0.1 * rec); _pole.y += 0.65 + 0.15 * rec;
    if (w < 1) {
      // sculling: the hands just under the surface in front of the chest,
      // sweeping out and in together, the elbows out and back (deeper, in
      // the opaque water a treading swimmer was a man standing still)
      const sw = Math.sin(tu);
      _tread.copy(_M).addScaledVector(_O, SX * s + 0.16 + 0.15 * sw).addScaledVector(_F, 0.28 + 0.05 * Math.cos(tu));
      _tread.y = wl - 0.06 + 0.03 * Math.sin(2 * tu);
      _T.lerpVectors(_tread, _T, w);
      _tPole.copy(_O).multiplyScalar(0.75).addScaledVector(_F, -0.55); _tPole.y -= 0.35;
      _pole.lerpVectors(_tPole, _pole, w);
    }
    armIK(b[sh], b[el], _T, _pole, L1, L2, _W);
    // the wrist: straight through the stroke, the palm down and tilting with
    // the sweep when sculling; fingers together and nearly flat
    b[hand].rotation.set(0.15 * w, lerp(-sx * 0.9 * Math.cos(tu) * 0.5 - sx * 0.6, 0, w), 0);
    b[fing].rotation.set(0, 0, sx * 0.12 * w);
    b[tip].rotation.set(0, 0, sx * 0.1 * w);
    // a splash where the hand goes in
    if (w > 0.5 && onEntry && Math.floor(u0 + off) !== Math.floor(ua)) onEntry(_W.x + _F.x * 0.12, _W.z + _F.z * 0.12);
  }
}

/**
 * A short cross-fade between whole poses (into the water, out of it): the
 * bones' local rotations are slerped from a snapshot toward whatever the
 * active animation wrote this frame. The walk reads some of its own last
 * pose back, so the pure walk pose is kept aside and restored before it runs
 * (`restore`); the swim writes every bone and needs no restore.
 */
export class PoseBlend {
  constructor(n) {
    this.from = []; this.pure = [];
    for (let i = 0; i < n; i++) { this.from.push(new THREE.Quaternion()); this.pure.push(new THREE.Quaternion()); }
    this.hipFrom = new THREE.Vector3(); this.hipPure = new THREE.Vector3();
    this.pitchFrom = 0; this.t = 0; this.dur = 1; this.live = false;
  }
  /** Start a blend of `dur` seconds from the current pose. */
  snap(h, dur) {
    const b = h.bones;
    for (let i = 0; i < b.length; i++) this.from[i].copy(b[i].quaternion);
    this.hipFrom.copy(b[B.hips].position);
    this.pitchFrom = h.group.rotation.x;
    this.t = 0; this.dur = dur; this.live = false;
  }
  get active() { return this.t < this.dur; }
  /** Before an animation that reads its last pose: put the unblended one back. */
  restore(h) {
    if (!this.live) return;
    const b = h.bones;
    for (let i = 0; i < b.length; i++) b[i].quaternion.copy(this.pure[i]);
    b[B.hips].position.copy(this.hipPure);
  }
  /** After the animation has posed this frame: blend and advance. */
  apply(h, dt, pitchTo) {
    if (!this.active) { this.live = false; return; }
    this.t += dt;
    const k = smooth(clamp(this.t / this.dur, 0, 1)), b = h.bones;
    for (let i = 0; i < b.length; i++) {
      this.pure[i].copy(b[i].quaternion);
      b[i].quaternion.slerpQuaternions(this.from[i], this.pure[i], k);
    }
    this.hipPure.copy(b[B.hips].position);
    b[B.hips].position.lerpVectors(this.hipFrom, this.hipPure, k);
    h.group.rotation.x = lerp(this.pitchFrom, pitchTo, k);
    this.live = this.active;
  }
}
