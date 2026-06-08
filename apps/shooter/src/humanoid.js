import * as THREE from 'three';
import { SKIN } from './config.js';
import { pick, clamp, lerp } from './utils.js';

// Build a fully-articulated human figure from capsules with proper joints
// (neck, shoulders, elbows, wrists, hips, knees, ankles). Returns a rig whose
// joint Groups are animated each frame by animateHumanoid().

const CAP = (r, len, mat) => {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.02, len - 2 * r), 4, 8);
  const m = new THREE.Mesh(g, mat);
  m.position.y = -len / 2;       // hang down from the joint at y=0
  m.castShadow = true;
  return m;
};
const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

export function buildHumanoid(def) {
  const h = def.height, b = def.build, accent = def.accent;
  const skin = pick(SKIN);

  const matSuit = new THREE.MeshStandardMaterial({ color: 0x303a4e, emissive: accent, emissiveIntensity: 0.16, roughness: 0.55, metalness: 0.5 });
  const matSuit2 = new THREE.MeshStandardMaterial({ color: 0x1d2434, emissive: accent, emissiveIntensity: 0.12, roughness: 0.5, metalness: 0.6 });
  const matSkin = new THREE.MeshStandardMaterial({ color: skin, emissive: skin, emissiveIntensity: 0.14, roughness: 0.7, metalness: 0.04 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: accent, emissiveIntensity: 2.2, roughness: 0.4 });
  const mats = { suit: matSuit, suit2: matSuit2, skin: matSkin, accent: matAccent };

  // proportions
  const thigh = 0.46 * h, shin = 0.44 * h, hipY = thigh + shin;
  const torsoH = 0.58 * h, neckL = 0.10 * h, headR = 0.13 * h;
  const upper = 0.30 * h, fore = 0.27 * h, hand = 0.11 * h;
  const shX = 0.20 * h * b, hipX = 0.11 * h;

  const root = new THREE.Group();
  const hips = joint(root, 0, hipY, 0);

  // pelvis + torso
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.30 * h * b, 0.18 * h, 0.20 * h * b), matSuit2);
  pelvis.castShadow = true; hips.add(pelvis);
  const spine = joint(hips, 0, 0.05 * h, 0);
  const abdomen = new THREE.Mesh(new THREE.CapsuleGeometry(0.15 * h * b, 0.16 * h, 4, 8), matSuit);
  abdomen.position.y = 0.14 * h; abdomen.castShadow = true; spine.add(abdomen);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.19 * h * b, 0.20 * h, 4, 10), matSuit);
  chest.position.y = 0.36 * h; chest.scale.z = 0.7; chest.castShadow = true; spine.add(chest);
  // glowing chest core + spine line
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * h, 0.04 * h, 0.05, 8), matAccent);
  core.rotation.x = Math.PI / 2; core.position.set(0, 0.38 * h, 0.16 * h * b); spine.add(core);
  // waist belt + back spine strip (accent) for silhouette readability
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.33 * h * b, 0.045 * h, 0.23 * h * b), matAccent);
  belt.position.y = 0.04 * h; spine.add(belt);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.03 * h, 0.34 * h, 0.02), matAccent);
  back.position.set(0, 0.3 * h, -0.15 * h * b); spine.add(back);

  const shoulderY = torsoH;
  // neck + head
  const neckJ = joint(spine, 0, shoulderY, 0);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052 * h, 0.06 * h, neckL, 8), matSkin);
  neck.position.y = neckL / 2; neck.castShadow = true; neckJ.add(neck);
  const headJ = joint(neckJ, 0, neckL, 0);
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(headR, headR * 0.7, 4, 10), matSkin);
  head.position.y = headR * 0.85; head.castShadow = true; headJ.add(head);
  // helmet cap
  const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.04, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), matSuit2);
  cap.position.y = headR * 1.05; headJ.add(cap);
  // visor (glowing eyes band)
  const visor = new THREE.Mesh(new THREE.BoxGeometry(headR * 1.5, headR * 0.34, 0.04), matAccent);
  visor.position.set(0, headR * 0.95, headR * 0.9); headJ.add(visor);

  // arms
  const arm = (sgn) => {
    const sh = joint(spine, sgn * shX, shoulderY - 0.03 * h, 0);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.13 * h * b, 0.07 * h, 0.15 * h * b), matAccent);
    pad.position.y = 0.03 * h; sh.add(pad);
    const u = CAP(0.062 * h * b, upper, matSuit); sh.add(u);
    const el = joint(sh, 0, -upper, 0);
    const f = CAP(0.052 * h * b, fore, matSuit); el.add(f);
    const wr = joint(el, 0, -fore, 0);
    const hd = new THREE.Mesh(new THREE.BoxGeometry(0.07 * h, hand, 0.05 * h), matSkin);
    hd.position.y = -hand / 2; hd.castShadow = true; wr.add(hd);
    return { sh, el, wr, hand: hd };
  };
  const armL = arm(-1), armR = arm(1);

  // legs
  const leg = (sgn) => {
    const hp = joint(hips, sgn * hipX, 0, 0);
    const t = CAP(0.10 * h * b, thigh, matSuit2); hp.add(t);
    const kn = joint(hp, 0, -thigh, 0);
    const s = CAP(0.075 * h * b, shin, matSuit2); kn.add(s);
    const ak = joint(kn, 0, -shin, 0);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.10 * h, 0.07 * h, 0.24 * h), matSuit2);
    foot.position.set(0, -0.035 * h, 0.06 * h); foot.castShadow = true; ak.add(foot);
    // knee accent
    const kg = new THREE.Mesh(new THREE.BoxGeometry(0.09 * h, 0.05, 0.02), matAccent);
    kg.position.set(0, 0, 0.075 * h * b); kn.add(kg);
    return { hp, kn, ak };
  };
  const legL = leg(-1), legR = leg(1);

  // hit proxies (used for raycast targeting): big head + torso
  head.userData.head = true;
  const hit = { head, torso: chest };

  const rig = {
    root, mats, accent, headR, hipY, torsoH,
    j: { hips, spine, neckJ, headJ, armL, armR, legL, legR },
    hit,
    setEmissive(v) { matAccent.emissiveIntensity = v; },
    setOpacity(o) {
      for (const m of [matSuit, matSuit2, matSkin, matAccent]) { m.transparent = o < 1; m.opacity = o; }
    },
  };
  return rig;
}

// Procedural gait + pose. p: { moving, speed, gaitAmp, lean, phase, flinch, attack, aimPitch, ranged }
const tmpHeadFix = 0;
export function animateHumanoid(rig, p, dt) {
  const j = rig.j;
  const amp = p.gaitAmp * (p.moving ? 1 : 0.06);
  const ph = p.phase;
  const s = Math.sin(ph), s2 = Math.sin(ph + Math.PI);
  // legs: thigh swings, knee flexes during the lift/back part of the stride
  const kneeL = Math.max(0, -Math.sin(ph)) * 1.5 + 0.12;
  const kneeR = Math.max(0, -Math.sin(ph + Math.PI)) * 1.5 + 0.12;
  j.legL.hp.rotation.x = -s * amp;
  j.legR.hp.rotation.x = -s2 * amp;
  j.legL.kn.rotation.x = kneeL * (p.moving ? 1 : 0.2);
  j.legR.kn.rotation.x = kneeR * (p.moving ? 1 : 0.2);
  j.legL.ak.rotation.x = -j.legL.kn.rotation.x * 0.4 + 0.1;
  j.legR.ak.rotation.x = -j.legR.kn.rotation.x * 0.4 + 0.1;

  // torso lean + counter-rotation
  j.hips.rotation.y = s * 0.06 * (p.moving ? 1 : 0);
  j.spine.rotation.y = -s * 0.08 * (p.moving ? 1 : 0);
  j.spine.rotation.x = lerp(j.spine.rotation.x, p.lean + (p.attack ? -0.25 : 0), 0.2);
  // pelvis bob
  j.hips.position.y = rig.hipY + Math.abs(Math.sin(ph)) * 0.04 * (p.moving ? 1 : 0) - (p.attack ? 0.04 : 0);

  if (p.ranged) {
    // both arms forward holding a weapon, aim with pitch
    const aim = clamp(p.aimPitch, -0.7, 0.7);
    j.armL.sh.rotation.set(-1.35 + aim, 0.25, 0.2);
    j.armR.sh.rotation.set(-1.35 + aim, -0.25, -0.2);
    j.armL.el.rotation.x = -0.5; j.armR.el.rotation.x = -0.5;
  } else {
    const reach = p.attack ? -1.7 : 0;
    j.armL.sh.rotation.set(s2 * amp * 0.7 + reach, 0, 0.06);
    j.armR.sh.rotation.set(s * amp * 0.7 + reach, 0, -0.06);
    j.armL.el.rotation.x = -0.35 - (p.attack ? 0.6 : 0);
    j.armR.el.rotation.x = -0.35 - (p.attack ? 0.6 : 0);
  }
  // flinch jitter on the chest/head
  if (p.flinch > 0) {
    j.spine.rotation.x += Math.sin(p.phase * 40) * 0.1 * p.flinch;
    j.headJ.rotation.z = Math.sin(p.phase * 38) * 0.12 * p.flinch;
  } else j.headJ.rotation.z = lerp(j.headJ.rotation.z, 0, 0.2);
  // head tries to stay level against torso lean, looks slightly at target
  j.headJ.rotation.x = lerp(j.headJ.rotation.x, -p.lean * 0.6 + (p.ranged ? p.aimPitch * 0.5 : 0), 0.2);
}
