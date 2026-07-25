// Pedestrians: civilians wandering the sidewalks and cops on foot.

import * as THREE from './three.js';
import { Builder } from './build.js';
import { clamp, lerp, angleWrap, hash2, rng, dist2 } from './util.js';
import * as G from './geo.js';

const SKINS = [[0.95, 0.79, 0.65], [0.82, 0.62, 0.46], [0.55, 0.38, 0.27], [0.36, 0.24, 0.17], [0.99, 0.86, 0.74]];
const SHIRTS = [
  [0.85, 0.25, 0.22], [0.2, 0.35, 0.65], [0.15, 0.5, 0.35], [0.9, 0.85, 0.8],
  [0.25, 0.25, 0.3], [0.85, 0.6, 0.15], [0.6, 0.3, 0.6], [0.2, 0.55, 0.6],
  [0.95, 0.95, 0.95], [0.4, 0.42, 0.45],
];
const PANTS = [[0.18, 0.22, 0.34], [0.2, 0.2, 0.22], [0.35, 0.3, 0.25], [0.45, 0.45, 0.48], [0.12, 0.14, 0.18]];
const HAIR = [[0.12, 0.09, 0.07], [0.35, 0.22, 0.1], [0.6, 0.5, 0.32], [0.75, 0.75, 0.75], [0.5, 0.15, 0.1]];

const pedMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.87, metalness: 0.0, envMapIntensity: 0.7,
});

// Skeleton layout. Characters are skinned meshes: one draw call each, but with
// real elbows, knees and a spine, which is the difference between a walk cycle
// and a pair of swinging planks.
const B = {
  root: 0, hips: 1, spine: 2, chest: 3, neck: 4, head: 5,
  shoulderL: 6, elbowL: 7, handL: 8,
  shoulderR: 9, elbowR: 10, handR: 11,
  thighL: 12, kneeL: 13, footL: 14,
  thighR: 15, kneeR: 16, footR: 17,
};
const BONE_COUNT = 18;

// Joint heights in character space, taken from adult anthropometry as
// fractions of a 1.75 m stature (eye 0.936H, chin 0.870H, acromion 0.812H,
// elbow 0.630H, wrist 0.485H, hip 0.530H, knee 0.285H, ankle 0.039H).
const J = {
  hip: 0.927, spine: 1.06, chest: 1.26, neck: 1.47, head: 1.56,
  shoulder: 1.421, elbow: 1.103, wrist: 0.849,
  knee: 0.499, ankle: 0.068,
  chin: 1.522, eye: 1.638, crown: 1.750,
};
const SHOULDER_X = 0.150;   // glenohumeral centre; the deltoid takes it to 0.21
const HIP_X = 0.085;

function makeSkeletonBones() {
  const bones = [];
  for (let i = 0; i < BONE_COUNT; i++) bones.push(new THREE.Bone());
  const set = (b, x, y, z) => bones[b].position.set(x, y, z);
  const link = (parent, child) => bones[parent].add(bones[child]);

  set(B.root, 0, 0, 0);
  set(B.hips, 0, J.hip, 0);
  set(B.spine, 0, J.spine - J.hip, 0);
  set(B.chest, 0, J.chest - J.spine, 0);
  set(B.neck, 0, J.neck - J.chest, 0);
  set(B.head, 0, J.head - J.neck, 0);
  set(B.shoulderL, -SHOULDER_X, J.shoulder - J.chest, 0);
  set(B.elbowL, 0, J.elbow - J.shoulder, 0);
  set(B.handL, 0, J.wrist - J.elbow, 0);
  set(B.shoulderR, SHOULDER_X, J.shoulder - J.chest, 0);
  set(B.elbowR, 0, J.elbow - J.shoulder, 0);
  set(B.handR, 0, J.wrist - J.elbow, 0);
  set(B.thighL, -HIP_X, 0, 0);
  set(B.kneeL, 0, J.knee - J.hip, 0);
  set(B.footL, 0, J.ankle - J.knee, 0);
  set(B.thighR, HIP_X, 0, 0);
  set(B.kneeR, 0, J.knee - J.hip, 0);
  set(B.footR, 0, J.ankle - J.knee, 0);

  link(B.root, B.hips);
  link(B.hips, B.spine); link(B.spine, B.chest);
  link(B.chest, B.neck); link(B.neck, B.head);
  link(B.chest, B.shoulderL); link(B.shoulderL, B.elbowL); link(B.elbowL, B.handL);
  link(B.chest, B.shoulderR); link(B.shoulderR, B.elbowR); link(B.elbowR, B.handR);
  link(B.hips, B.thighL); link(B.thighL, B.kneeL); link(B.kneeL, B.footL);
  link(B.hips, B.thighR); link(B.thighR, B.kneeR); link(B.kneeR, B.footR);
  return bones;
}

/** Elliptical cross-section in the XZ plane. */
function oval(rx, rz, n = 10, ox = 0, oz = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([ox + Math.cos(a) * rx, oz + Math.sin(a) * rz]);
  }
  return pts;
}

const smoothT = (v) => v * v * (3 - 2 * v);

/**
 * Accumulates parts into one skinned geometry. Each part supplies a weight
 * function so vertices near a joint blend between two bones instead of
 * creasing.
 */
class SkinAcc {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.idx = [];
    this.si = []; this.sw = [];
  }
  add(builder, weightFn) {
    const base = this.pos.length / 3;
    for (let i = 0; i < builder.pos.length; i += 3) {
      const x = builder.pos[i], y = builder.pos[i + 1], z = builder.pos[i + 2];
      this.pos.push(x, y, z);
      this.nor.push(builder.nor[i], builder.nor[i + 1], builder.nor[i + 2]);
      this.col.push(builder.col[i], builder.col[i + 1], builder.col[i + 2]);
      const w = weightFn(x, y, z);
      this.si.push(w[0], w[2] != null ? w[2] : 0, 0, 0);
      this.sw.push(w[1], w[3] != null ? w[3] : 0, 0, 0);
    }
    for (const ix of builder.idx) this.idx.push(base + ix);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Blend between two bones across a joint at height `jy`. */
const across = (jy, span, above, below) => (x, y) => {
  const t = smoothT(clamp((y - (jy - span)) / (span * 2), 0, 1));
  return [above, t, below, 1 - t];
};
const solid = (b) => () => [b, 1, 0, 0];

/**
 * Builds one character variant: a skinned geometry in the rest pose. Callers
 * pair it with a fresh skeleton per instance.
 */
export function buildCharacter(opts = {}) {
  const seed = opts.seed != null ? opts.seed : 0;
  const skin = opts.skin || SKINS[Math.floor(hash2(seed, 1) * SKINS.length)];
  const shirt = opts.shirt || SHIRTS[Math.floor(hash2(seed, 2) * SHIRTS.length)];
  const pants = opts.pants || PANTS[Math.floor(hash2(seed, 3) * PANTS.length)];
  const hair = opts.hair || HAIR[Math.floor(hash2(seed, 4) * HAIR.length)];
  const build = 0.92 + hash2(seed, 6) * 0.16;
  const jacket = opts.vest ? true : hash2(seed, 7) > 0.5;
  const shortSleeve = !jacket && hash2(seed, 8) > 0.55;
  const shoeCol = [0.11, 0.11, 0.12];
  const coat = jacket ? [shirt[0] * 0.66, shirt[1] * 0.66, shirt[2] * 0.7] : shirt;

  const acc = new SkinAcc();
  // half-breadths: hip 0.167, waist 0.131, chest 0.152, shoulder 0.140
  const bw = 0.167 * build, bd = 0.115 * build;
  const ww = 0.131 * build, wd = 0.100 * build;
  const cw = 0.152 * build, cd = 0.118 * build;
  const sw = 0.140 * build, sd = 0.104 * build;
  const outer = jacket ? 1.05 : 1.0;

  // --- pelvis + torso ------------------------------------------------------
  const pelvis = new Builder(false);
  pelvis.loftY([
    { y: J.hip - 0.15, pts: oval(bw * 0.88, bd * 0.92, 10) },
    { y: J.hip - 0.06, pts: oval(bw, bd, 10, 0, -0.008) },
    { y: J.hip + 0.04, pts: oval(bw * 0.94, bd * 0.94, 10) },
    { y: J.hip + 0.10, pts: oval(bw * 0.86, bd * 0.9, 10) },
  ], pants, { capStart: true });
  acc.add(pelvis, across(J.spine - 0.06, 0.09, B.spine, B.hips));

  const torso = new Builder(false);
  torso.loftY([
    { y: J.hip + 0.08, pts: oval(bw * 0.86 * outer, bd * 0.9 * outer, 10) },
    { y: 1.085, pts: oval(ww * outer, wd * outer, 10) },
    { y: J.chest, pts: oval(cw * outer, cd * outer, 10, 0, 0.006) },
    { y: 1.34, pts: oval(cw * 1.02 * outer, cd * 0.98 * outer, 10) },
    { y: J.shoulder - 0.02, pts: oval(sw * 1.08 * outer, sd * outer, 10) },
    { y: J.shoulder + 0.012, pts: oval(sw * 0.92 * outer, sd * 0.92 * outer, 10) },
    // trapezius sloping in to the neck, set back so the throat stays visible
    { y: J.shoulder + 0.046, pts: oval(sw * 0.5 * outer, sd * 0.56 * outer, 10, 0, -0.014) },
  ], coat, {});
  if (jacket) {
    torso.box(0, J.hip + 0.07, bd * 0.92 * outer, 0.04, J.chest - J.hip + 0.18, 0.02, 0,
      [coat[0] * 0.6, coat[1] * 0.6, coat[2] * 0.64]);
  }
  if (opts.vest) {
    torso.loftY([
      { y: J.hip + 0.12, pts: oval(bw * 1.03 * outer, bd * 1.05 * outer, 10) },
      { y: J.chest + 0.06, pts: oval(cw * 1.03 * outer, cd * 1.05 * outer, 10) },
      { y: J.shoulder - 0.04, pts: oval(sw * 0.98 * outer, sd * 1.02 * outer, 10) },
    ], opts.vest, {});
  }
  acc.add(torso, (x, y) => {
    if (y < J.spine) return across(J.spine - 0.05, 0.1, B.spine, B.hips)(x, y);
    return across(J.chest - 0.06, 0.12, B.chest, B.spine)(x, y);
  });

  // --- neck + head ---------------------------------------------------------
  // Head width is 0.086H (half 0.075) and depth 0.115H (half 0.101). The old
  // head was 25% too wide, which is most of what made these look wrong.
  const head = new Builder(false);
  head.loftY([
    { y: J.chest + 0.09, pts: oval(0.062, 0.060, 8) },
    { y: J.shoulder + 0.01, pts: oval(0.057, 0.055, 8, 0, -0.004) },
    { y: J.chin - 0.01, pts: oval(0.052, 0.050, 8, 0, -0.006) },
  ], skin, {});
  head.loftY([
    { y: J.chin - 0.012, pts: oval(0.040, 0.055, 10, 0, 0.020) },
    { y: J.chin + 0.023, pts: oval(0.062, 0.082, 10, 0, 0.010) },
    { y: J.chin + 0.063, pts: oval(0.073, 0.096, 10, 0, 0.004) },
    { y: J.eye, pts: oval(0.075, 0.100, 10, 0, 0) },
    { y: J.eye + 0.050, pts: oval(0.070, 0.092, 10, 0, -0.004) },
    { y: J.crown - 0.025, pts: oval(0.055, 0.070, 10, 0, -0.010) },
    { y: J.crown, pts: oval(0.022, 0.028, 10, 0, -0.014) },
  ], skin, { capStart: true, capEnd: true });

  // hair: starts at the hairline so the forehead is not swallowed
  head.loftY([
    { y: J.chin + 0.038, pts: oval(0.070, 0.078, 10, 0, -0.030) },
    { y: J.eye - 0.018, pts: oval(0.080, 0.094, 10, 0, -0.022) },
    { y: J.eye + 0.050, pts: oval(0.077, 0.097, 10, 0, -0.012) },
    { y: J.crown - 0.030, pts: oval(0.059, 0.074, 10, 0, -0.012) },
    { y: J.crown + 0.003, pts: oval(0.024, 0.031, 10, 0, -0.014) },
  ], hair, { capEnd: true });

  // face: brow, eyes set into their sockets, a nose with a bridge, mouth, ears
  const brow = [hair[0] * 0.75 + skin[0] * 0.2, hair[1] * 0.75 + skin[1] * 0.2, hair[2] * 0.75 + skin[2] * 0.2];
  for (const sx of [-1, 1]) {
    head.box(sx * 0.032, J.eye + 0.021, 0.088, 0.036, 0.011, 0.02, 0, brow);
    head.box(sx * 0.031, J.eye, 0.090, 0.026, 0.013, 0.014, 0, [0.94, 0.93, 0.9]);
    head.box(sx * 0.031, J.eye, 0.095, 0.012, 0.012, 0.008, 0, [0.16, 0.13, 0.11]);
    head.box(sx * 0.077, J.eye - 0.014, 0.008, 0.014, 0.042, 0.028, 0, skin);
  }
  head.box(0, J.eye - 0.004, 0.098, 0.019, 0.052, 0.016, 0, skin);
  head.box(0, J.eye - 0.034, 0.104, 0.026, 0.018, 0.018, 0, skin);
  head.box(0, J.chin + 0.040, 0.092, 0.044, 0.009, 0.014, 0,
    [skin[0] * 0.62, skin[1] * 0.42, skin[2] * 0.42]);

  if (opts.hat) {
    head.loftY([
      { y: J.eye + 0.014, pts: oval(0.085, 0.110, 10, 0, -0.006) },
      { y: J.eye + 0.070, pts: oval(0.081, 0.104, 10, 0, -0.008) },
      { y: J.crown - 0.006, pts: oval(0.056, 0.072, 10, 0, -0.01) },
    ], opts.hat, { capEnd: true });
    head.box(0, J.eye + 0.012, 0.086, 0.166, 0.018, 0.11, 0, opts.hat);
  }
  acc.add(head, (x, y) => {
    if (y < J.neck) return across(J.neck - 0.06, 0.09, B.neck, B.chest)(x, y);
    return across(J.head - 0.03, 0.04, B.head, B.neck)(x, y);
  });

  // --- arms ----------------------------------------------------------------
  for (const side of [-1, 1]) {
    const X = side * SHOULDER_X;
    const arm = new Builder(false);
    arm.loftY([
      // deltoid widest just BELOW the shoulder line, and capped under the
      // trapezius -- capping it above turns the shoulders into puffed sleeves
      { y: J.shoulder - 0.014, pts: oval(0.044, 0.042, 8, X, 0) },
      { y: J.shoulder - 0.042, pts: oval(0.059, 0.056, 8, X, 0) },
      { y: J.shoulder - 0.080, pts: oval(0.061, 0.058, 8, X, 0) },
      { y: J.shoulder - 0.14, pts: oval(0.051, 0.050, 8, X, 0) },
      { y: J.elbow + 0.03, pts: oval(0.045, 0.044, 8, X, 0) },
      { y: J.elbow - 0.02, pts: oval(0.044, 0.043, 8, X, 0) },
      { y: J.wrist + 0.05, pts: oval(0.031, 0.030, 8, X, 0) },
      { y: J.wrist, pts: oval(0.028, 0.026, 8, X, 0) },
    ], shortSleeve
      ? [coat, coat, coat, coat, skin, skin, skin, skin]
      : coat, { capStart: true, capEnd: true });
    acc.add(arm, (x, y) => {
      if (y > J.elbow) return across(J.elbow + 0.05, 0.09, side < 0 ? B.shoulderL : B.shoulderR, side < 0 ? B.elbowL : B.elbowR)(x, y);
      return [side < 0 ? B.elbowL : B.elbowR, 1, 0, 0];
    });
    const hand = new Builder(false);
    // hand length is 0.108H = 0.189 m from wrist to fingertip
    hand.loftY([
      { y: J.wrist + 0.005, pts: oval(0.030, 0.028, 8, X, 0) },
      { y: J.wrist - 0.045, pts: oval(0.038, 0.026, 8, X, 0.004) },
      { y: J.wrist - 0.115, pts: oval(0.036, 0.023, 8, X, 0.006) },
      { y: J.wrist - 0.189, pts: oval(0.022, 0.015, 8, X, 0.006) },
    ], skin, { capStart: true, capEnd: true });
    acc.add(hand, solid(side < 0 ? B.handL : B.handR));
  }

  // --- legs ----------------------------------------------------------------
  for (const side of [-1, 1]) {
    const X = side * HIP_X;
    const leg = new Builder(false);
    leg.loftY([
      { y: J.hip + 0.04, pts: oval(0.094, 0.092, 8, X, 0) },
      { y: J.hip - 0.09, pts: oval(0.088, 0.087, 8, X, 0) },
      { y: J.knee + 0.10, pts: oval(0.064, 0.064, 8, X, 0) },
      { y: J.knee + 0.02, pts: oval(0.059, 0.060, 8, X, 0) },
      { y: J.knee - 0.04, pts: oval(0.059, 0.062, 8, X, 0.005) },
      { y: J.knee - 0.15, pts: oval(0.057, 0.060, 8, X, 0.002) },
      { y: J.ankle + 0.10, pts: oval(0.037, 0.040, 8, X, 0) },
    ], pants, { capStart: true, capEnd: true });
    acc.add(leg, (x, y) => across(J.knee + 0.04, 0.1,
      side < 0 ? B.thighL : B.thighR, side < 0 ? B.kneeL : B.kneeR)(x, y));

    const foot = new Builder(false);
    // foot length is 0.152H = 0.266 m; the old shoe was barely 0.16 m
    foot.loftY([
      { y: J.ankle + 0.10, pts: oval(0.036, 0.039, 8, X, 0) },
      { y: J.ankle + 0.02, pts: oval(0.043, 0.056, 8, X, 0.018) },
      { y: J.ankle - 0.030, pts: oval(0.050, 0.105, 8, X, 0.052) },
      { y: J.ankle - 0.062, pts: oval(0.046, 0.112, 8, X, 0.060) },
    ], shoeCol, { capStart: true, capEnd: true });
    acc.add(foot, solid(side < 0 ? B.footL : B.footR));
  }

  return acc.build();
}

// A small pool of pre-built looks, shared by every pedestrian. Per-instance
// variety comes from the skeleton, scale and gait rather than new geometry.
let VARIANTS = null;
function variants() {
  if (!VARIANTS) {
    VARIANTS = [];
    for (let i = 0; i < 12; i++) VARIANTS.push(buildCharacter({ seed: i * 7919 + 13 }));
  }
  return VARIANTS;
}

export function makeHumanoid(opts = {}) {
  const seed = opts.seed != null ? opts.seed : 0;
  const pooled = !opts.geometry && !opts.unique;
  const geo = opts.geometry
    || (opts.unique ? buildCharacter(opts) : variants()[Math.floor(hash2(seed, 9) * 12) % 12]);
  const bones = makeSkeletonBones();
  const mesh = new THREE.SkinnedMesh(geo, pedMat);
  mesh.add(bones[B.root]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  const g = new THREE.Group();
  g.add(mesh);
  const scale = opts.scale || (0.94 + hash2(seed, 5) * 0.14);
  g.scale.setScalar(scale);
  return {
    group: g, mesh, bones, height: 1.75 * scale, bob: 0,
    // Pooled variants are shared by every pedestrian using that look, so only a
    // uniquely-built character may dispose its own geometry.
    dispose() { if (!pooled) geo.dispose(); },
    gait: 0.85 + hash2(seed, 11) * 0.3,
    lean: hash2(seed, 12) * 0.06,
    swing: 0.8 + hash2(seed, 13) * 0.45,
    t: hash2(seed, 14) * 10,
  };
}

/**
 * Procedural walk/idle cycle. Hips bob and sway, knees and elbows actually
 * bend, the chest counter-rotates against the pelvis and the head stays level.
 */
export function animateWalk(h, phase, amp, dt, speed) {
  const b = h.bones;
  h.t += dt || 0;
  const A = amp * h.gait;
  const s = Math.sin(phase), c = Math.cos(phase);
  const spd = speed != null ? speed : amp * 4;
  const run = clamp(spd / 6, 0, 1);

  // legs: hip swing with a knee that flexes through the swing phase
  const kneeFor = (ph) => 0.12 + (0.55 + 0.5 * run) * A * Math.max(0, 1 - Math.cos(ph + 0.5)) * 0.5;
  const stride = A * 0.95;
  b[B.thighL].rotation.x = -stride * s;
  b[B.thighR].rotation.x = stride * s;
  b[B.kneeL].rotation.x = kneeFor(phase + Math.PI);
  b[B.kneeR].rotation.x = kneeFor(phase);
  b[B.footL].rotation.x = -0.35 * b[B.kneeL].rotation.x + A * 0.35 * s + 0.06;
  b[B.footR].rotation.x = -0.35 * b[B.kneeR].rotation.x - A * 0.35 * s + 0.06;

  // arms: opposite phase, elbows carried bent and tightening on the forward swing
  const armA = A * 0.8 * h.swing;
  b[B.shoulderL].rotation.x = armA * 1.1 * s;
  b[B.shoulderR].rotation.x = -armA * 1.1 * s;
  // Abduction keeps the hands clear of the thighs. Positive Z swings a limb
  // toward +X, so the LEFT arm (at -X) needs a negative angle to move outward.
  b[B.shoulderL].rotation.z = -(0.12 + A * 0.07);
  b[B.shoulderR].rotation.z = 0.12 + A * 0.07;
  b[B.elbowL].rotation.x = -(0.20 + 0.5 * run) - Math.max(0, armA * 1.4 * s);
  b[B.elbowR].rotation.x = -(0.20 + 0.5 * run) - Math.max(0, -armA * 1.4 * s);

  // Pelvis: the hips have to DROP as the legs scissor, or the planted foot
  // slides under the ground and the whole figure looks like it is floating.
  const legLen = J.hip - J.ankle;
  const scissor = legLen * (1 - Math.cos(stride * Math.abs(s)));
  b[B.hips].position.y = J.hip - scissor - Math.abs(s) * A * 0.03;
  b[B.hips].position.x = s * A * 0.035;
  b[B.hips].rotation.z = -s * A * 0.11;
  b[B.hips].rotation.y = -s * A * 0.30;
  b[B.spine].rotation.y = s * A * 0.16;
  b[B.chest].rotation.y = s * A * 0.30;
  b[B.chest].rotation.x = h.lean + A * 0.10 + run * 0.10;
  b[B.chest].rotation.z = -c * A * 0.05;

  // head stays level and pointed where the body is going
  b[B.neck].rotation.x = -h.lean * 0.6 - A * 0.06 - run * 0.08;
  b[B.head].rotation.y = -s * A * 0.22 + Math.sin(h.t * 0.6) * 0.12 * (1 - run);
  b[B.head].rotation.x = -A * 0.08 + Math.sin(h.t * 0.9) * 0.03;

  // idle: breathing and a slow weight shift so nobody stands like a statue
  if (A < 0.05) {
    const br = Math.sin(h.t * 1.5);
    b[B.chest].rotation.x = h.lean + br * 0.02;
    b[B.hips].position.x = Math.sin(h.t * 0.5) * 0.012;
    b[B.hips].rotation.z = Math.sin(h.t * 0.5) * 0.03;
    b[B.shoulderL].rotation.x = br * 0.03;
    b[B.shoulderR].rotation.x = -br * 0.03;
    b[B.elbowL].rotation.x = -0.16 + br * 0.02;
    b[B.elbowR].rotation.x = -0.16 - br * 0.02;
  }
  h.bob = 0;
}

// ---------------------------------------------------------------------------

const MAX_PEDS = 26;
const PED_RADIUS = 150;

export class PedSystem {
  constructor(scene, city, game) {
    this.scene = scene;
    this.city = city;
    this.game = game;
    this.peds = [];
    this.R = rng(4242);
    this.timer = 0;
  }

  spawn(px, pz, cop) {
    const city = this.city;
    for (let attempt = 0; attempt < 12; attempt++) {
      const eids = city.edgesNear(px, pz, PED_RADIUS);
      if (!eids.length) return null;
      const ei = eids[Math.floor(this.R.n() * eids.length)];
      const e = city.edges[ei];
      if (e.elev || e.cls === 'hwy' || e.cls === 'ramp') continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const t = 0.15 + this.R.n() * 0.7;
      const side = this.R.n() < 0.5 ? 1 : -1;
      const off = e.hw + 1.4;
      const x = lerp(a.x, b.x, t) - e.dz * off * side;
      const z = lerp(a.z, b.z, t) + e.dx * off * side;
      const d = Math.hypot(x - px, z - pz);
      if (d < (cop ? 22 : 26) || d > PED_RADIUS) continue;
      if (!G.isBuildable(x, z)) continue;
      const seed = (this.R.n() * 1e6) | 0;
      const h = cop
        ? makeHumanoid({ seed, shirt: [0.12, 0.16, 0.3], pants: [0.1, 0.12, 0.2], hat: [0.08, 0.1, 0.18], vest: [0.16, 0.2, 0.36] })
        : makeHumanoid({ seed });
      const p = {
        h, x, z, y: city.groundAt(x, z, null), lift: 0, heading: this.R.n() * Math.PI * 2,
        edge: ei, side, t, dirSign: this.R.n() < 0.5 ? 1 : -1,
        speed: 0, phase: this.R.n() * 6.28, state: 'walk', timer: 0,
        cop: !!cop, shootCd: 1 + this.R.n(), down: 0, hp: cop ? 60 : 30,
      };
      this.scene.add(h.group);
      this.peds.push(p);
      return p;
    }
    return null;
  }

  remove(p) {
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
    this.scene.remove(p.h.group);
    p.h.dispose();
  }

  scare(x, z, radius) {
    for (const p of this.peds) {
      if (p.cop || p.state === 'down') continue;
      if (dist2(p.x, p.z, x, z) < radius * radius) {
        p.state = 'flee';
        p.timer = 4 + this.R.n() * 3;
        p.fleeX = p.x - x;
        p.fleeZ = p.z - z;
      }
    }
  }

  update(dt, px, pz, player, traffic) {
    const city = this.city;
    const game = this.game;
    this.timer -= dt;
    const wantCops = game.wanted >= 3 ? Math.min(6, (game.wanted - 2) * 2) : 0;
    let copCount = 0;
    for (const p of this.peds) if (p.cop) copCount++;

    if (this.timer <= 0) {
      this.timer = 0.2;
      if (this.peds.length - copCount < MAX_PEDS) this.spawn(px, pz, false);
      if (copCount < wantCops) this.spawn(px, pz, true);
    }

    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const d2p = dist2(p.x, p.z, px, pz);
      if (d2p > (PED_RADIUS + 90) * (PED_RADIUS + 90)) { this.remove(p); continue; }
      if (p.cop && game.wanted === 0) { this.remove(p); continue; }

      if (p.state === 'down') {
        p.down += dt;
        p.h.group.rotation.z = lerp(p.h.group.rotation.z, Math.PI / 2 * p.fallDir, 1 - Math.exp(-8 * dt));
        p.h.group.position.set(p.x, p.y, p.z);
        if (p.down > 9) this.remove(p);
        continue;
      }

      let targetSpeed = 1.35;
      let desired = p.heading;

      if (p.cop) {
        const d = Math.sqrt(d2p);
        desired = Math.atan2(px - p.x, pz - p.z);
        targetSpeed = d > 9 ? 4.6 : 0;
        p.shootCd -= dt;
        if (d < 34 && p.shootCd <= 0) {
          p.shootCd = 1.1 + this.R.n() * 0.9;
          game.onCopShot(p);
        }
      } else if (p.state === 'flee') {
        p.timer -= dt;
        const l = Math.hypot(p.fleeX, p.fleeZ) || 1;
        desired = Math.atan2(p.fleeX / l, p.fleeZ / l);
        targetSpeed = 5.2;
        if (p.timer <= 0) p.state = 'walk';
      } else {
        // walk the sidewalk
        const e = city.edges[p.edge];
        if (!e) { this.remove(p); continue; }
        const a = city.nodes[p.dirSign > 0 ? e.a : e.b];
        const b = city.nodes[p.dirSign > 0 ? e.b : e.a];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const fx = dx / len, fz = dz / len;
        const prog = (p.x - a.x) * fx + (p.z - a.z) * fz;
        if (prog > len - 3) {
          const nodeId = p.dirSign > 0 ? e.b : e.a;
          const node = city.nodes[nodeId];
          const opts = node.e.filter((ei) => {
            const ne = city.edges[ei];
            return !ne.elev && ne.cls !== 'hwy' && ne.cls !== 'ramp';
          });
          if (opts.length) {
            const nei = opts[Math.floor(this.R.n() * opts.length)];
            p.edge = nei;
            p.dirSign = city.edges[nei].a === nodeId ? 1 : -1;
            p.side = this.R.n() < 0.5 ? 1 : -1;
          } else p.dirSign = -p.dirSign;
        } else {
          const off = e.hw + 1.4;
          const ap = clamp(prog + 4, 0, len);
          const tx = a.x + fx * ap - fz * off * p.side;
          const tz = a.z + fz * ap + fx * off * p.side;
          desired = Math.atan2(tx - p.x, tz - p.z);
        }
        targetSpeed = 1.25 + hash2(i, 3) * 0.5;
      }

      p.heading += clamp(angleWrap(desired - p.heading), -7 * dt, 7 * dt);
      p.speed = lerp(p.speed, targetSpeed, 1 - Math.exp(-7 * dt));
      p.x += Math.sin(p.heading) * p.speed * dt;
      p.z += Math.cos(p.heading) * p.speed * dt;
      p.x = G.clampToMap(p.x);
      p.z = G.clampToMap(p.z);
      p.lift = city.roadLift(p.x, p.z);
      p.y = city.groundAt(p.x, p.z, p.y + 1, p.lift);

      p.phase += (0.9 + p.speed * 2.2) * dt;
      animateWalk(p.h, p.phase, clamp(p.speed * 0.20, 0, 0.8), dt, p.speed);
      p.h.group.position.set(p.x, p.y, p.z);
      p.h.group.rotation.y = p.heading;
      p.h.group.rotation.z = 0;

      // knocked over by traffic
      for (const v of traffic.cars) {
        if (v.mode === 'parked') continue;
        const sp = Math.abs(v.vLong);
        if (sp < 2.2) continue;
        const n = v.nearest(p.x, p.z);
        if (dist2(n.x, n.z, p.x, p.z) < 0.65) {
          this.knockDown(p, v.forward, sp);
          game.onPedHit(v === player.vehicle, p);
          break;
        }
      }
    }
  }

  knockDown(p, dir, force) {
    p.state = 'down';
    p.down = 0;
    p.fallDir = Math.random() < 0.5 ? 1 : -1;
    p.x += dir.x * clamp(force * 0.12, 0.4, 3);
    p.z += dir.z * clamp(force * 0.12, 0.4, 3);
    p.y = this.city.groundAt(p.x, p.z, p.y + 1, this.city.roadLift(p.x, p.z));
    p.h.group.position.set(p.x, p.y + 0.3, p.z);
  }

  hitAt(x, z, radius, damage, isPlayer) {
    let hit = null;
    for (const p of this.peds) {
      if (p.state === 'down') continue;
      if (dist2(p.x, p.z, x, z) < radius * radius) {
        p.hp -= damage;
        if (p.hp <= 0) {
          this.knockDown(p, { x: 0, z: 0 }, 0);
          this.game.onPedKilled(p, isPlayer);
        } else {
          p.state = 'flee';
          p.timer = 5;
          p.fleeX = p.x - x;
          p.fleeZ = p.z - z;
        }
        hit = p;
        break;
      }
    }
    return hit;
  }
}
