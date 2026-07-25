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

const pedMat = new THREE.MeshLambertMaterial({ vertexColors: true });

/**
 * Builds a blocky humanoid. Returns the group plus the limb meshes so callers
 * can animate a walk cycle.
 */
export function makeHumanoid(opts = {}) {
  const seed = opts.seed != null ? opts.seed : 0;
  const skin = opts.skin || SKINS[Math.floor(hash2(seed, 1) * SKINS.length)];
  const shirt = opts.shirt || SHIRTS[Math.floor(hash2(seed, 2) * SHIRTS.length)];
  const pants = opts.pants || PANTS[Math.floor(hash2(seed, 3) * PANTS.length)];
  const hair = opts.hair || HAIR[Math.floor(hash2(seed, 4) * HAIR.length)];
  const scale = opts.scale || (0.92 + hash2(seed, 5) * 0.18);

  const torso = new Builder(false);
  // hips -> shoulders
  torso.box(0, 0, 0, 0.42, 0.52, 0.24, 0, shirt);
  torso.box(0, 0.52, 0, 0.2, 0.12, 0.2, 0, skin); // neck
  torso.box(0, 0.64, 0, 0.27, 0.28, 0.26, 0, skin); // head
  torso.box(0, 0.85, 0, 0.29, 0.09, 0.28, 0, hair);
  torso.box(0, 0.78, -0.02, 0.30, 0.09, 0.30, 0, hair);
  if (opts.hat) torso.box(0, 0.9, 0, 0.34, 0.08, 0.36, 0, opts.hat);
  if (opts.vest) torso.box(0, 0.06, 0, 0.45, 0.4, 0.27, 0, opts.vest);

  const armB = () => {
    const b = new Builder(false);
    b.box(0, -0.44, 0, 0.13, 0.36, 0.14, 0, shirt);
    b.box(0, -0.62, 0, 0.12, 0.2, 0.13, 0, skin);
    return b.build();
  };
  // Crowd extras bake their arms into the torso: 3 draw calls per body instead
  // of 5, which matters once there are two dozen of them on screen.
  if (!opts.animateArms) {
    for (const sx of [-0.28, 0.28]) {
      torso.box(sx, -0.02, 0, 0.13, 0.36, 0.14, 0, shirt);
      torso.box(sx, -0.20, 0, 0.12, 0.2, 0.13, 0, skin);
    }
  }
  const legB = () => {
    const b = new Builder(false);
    b.box(0, -0.44, 0, 0.16, 0.46, 0.16, 0, pants);
    b.box(0, -0.52, 0.03, 0.17, 0.09, 0.26, 0, [0.14, 0.13, 0.13]);
    return b.build();
  };

  const g = new THREE.Group();
  const body = new THREE.Mesh(torso.build(), pedMat);
  body.position.y = 0.86;
  g.add(body);

  const mkLimb = (geo, x, y) => {
    const m = new THREE.Mesh(geo, pedMat);
    m.position.set(x, y, 0);
    g.add(m);
    return m;
  };
  const legGeo = legB();
  let armL = null, armR = null;
  if (opts.animateArms) {
    const armGeo = armB();
    armL = mkLimb(armGeo, -0.28, 1.32);
    armR = mkLimb(armGeo, 0.28, 1.32);
  }
  const legL = mkLimb(legGeo, -0.11, 0.88);
  const legR = mkLimb(legGeo, 0.11, 0.88);
  g.scale.setScalar(scale);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, body, armL, armR, legL, legR, height: 1.75 * scale };
}

export function animateWalk(h, phase, amp, dt) {
  const s = Math.sin(phase) * amp;
  const c = Math.sin(phase + Math.PI) * amp;
  h.legL.rotation.x = s;
  h.legR.rotation.x = c;
  if (h.armL) { h.armL.rotation.x = c * 0.8; h.armR.rotation.x = s * 0.8; }
  h.body.rotation.z = Math.sin(phase * 2) * amp * 0.05;
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
        h, x, z, y: city.groundAt(x, z, null), heading: this.R.n() * Math.PI * 2,
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
    p.h.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
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
      p.y = city.groundAt(p.x, p.z, p.y + 1);

      p.phase += p.speed * 2.6 * dt;
      animateWalk(p.h, p.phase, clamp(p.speed * 0.22, 0, 0.85), dt);
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
    p.y = this.city.groundAt(p.x, p.z, p.y + 1);
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
