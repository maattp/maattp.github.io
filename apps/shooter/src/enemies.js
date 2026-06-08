import * as THREE from 'three';
import { ENEMY_TYPES } from './config.js';
import { buildHumanoid, animateHumanoid } from './humanoid.js';
import { clamp, damp, rand, lerp } from './utils.js';

function shadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class EnemyManager {
  constructor(game) {
    this.game = game; this.scene = game.engine.scene;
    this.list = []; this.bodyMeshes = [];
    this.pools = { thug: [], runner: [], brute: [], gunner: [] };
    this.aliveCount = 0;
    this.flow = null; this.playerNode = -1;
    this._shadowTex = shadowTexture();
    this._shadowMat = new THREE.MeshBasicMaterial({ map: this._shadowTex, transparent: true, depthWrite: false, color: 0x000000 });
    this._sep = new THREE.Vector3();

    // enemy projectiles (gunner shots)
    this.proj = [];
    const pg = new THREE.SphereGeometry(0.22, 8, 8);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0x7dff8a, toneMapped: false }));
      m.visible = false; this.scene.add(m);
      this.proj.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, dmg: 0 });
    }
    this.pcursor = 0;
  }

  createEnemy(type) {
    const def = ENEMY_TYPES[type];
    const rig = buildHumanoid(def);
    rig.root.visible = false; this.scene.add(rig.root);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._shadowMat);
    shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1; shadow.visible = false; this.scene.add(shadow);
    const e = {
      type, def, rig, root: rig.root, shadow,
      hit: [rig.hit.head, rig.hit.torso],
      state: 'idle', hp: 1, maxHp: 1, speed: 1, dmg: 1, reward: 1, score: 1,
      cd: 0, flinch: 0, phase: Math.random() * 6, feetY: 0, vy: 0, node: 0,
      attack: false, aimPitch: 0, _flashT: 0, spawnT: 0, deathT: 0, stepFlag: false,
    };
    rig.hit.head.userData.enemyRef = e;
    rig.hit.torso.userData.enemyRef = e;
    return e;
  }
  obtain(type) { return this.pools[type].pop() || this.createEnemy(type); }

  spawn(type, hpScale, speedScale) {
    const e = this.obtain(type), def = e.def, w = this.game.world;
    e.maxHp = def.hp * hpScale; e.hp = e.maxHp;
    e.speed = def.speed * speedScale;
    e.dmg = def.dmg * (1 + (this.game.waves.waveNum - 1) * 0.04);
    e.reward = def.reward; e.score = def.score;
    e.cd = 0; e.flinch = 0; e.vy = 0; e.attack = false; e._flashT = 0;
    e.state = 'spawning'; e.spawnT = 0; e.deathT = 0;
    // ground spawn point far from player
    const px = this.game.player.pos.x, pz = this.game.player.pos.z;
    let best = null, bd = -1;
    for (let k = 0; k < 6; k++) {
      const sp = w.spawnPoints[(Math.random() * w.spawnPoints.length) | 0];
      const d = (sp.x - px) ** 2 + (sp.z - pz) ** 2;
      if (d > bd) { bd = d; best = sp; }
    }
    e.feetY = best.y; e.root.position.set(best.x, best.y, best.z);
    e.root.rotation.set(0, 0, 0); e.root.scale.setScalar(0.01);
    e.rig.setOpacity(1); e.rig.setEmissive(2.5);
    e.root.visible = true; e.node = w.nearestNode(best.x, best.y, best.z);
    this.list.push(e);
    for (const m of e.hit) this.bodyMeshes.push(m);
    this.aliveCount++;
    this.game.audio.spawn(best.x, best.z);
    this.game.effects.burst(best.x, best.y + 0.3, best.z, 18, def.accent, 7, 0.5, 0.3);
  }

  despawn(e) {
    e.root.visible = false; e.shadow.visible = false; e.state = 'idle';
    for (const m of e.hit) { const j = this.bodyMeshes.indexOf(m); if (j >= 0) this.bodyMeshes.splice(j, 1); }
    const i = this.list.indexOf(e); if (i >= 0) this.list.splice(i, 1);
    this.pools[e.type].push(e);
  }
  _untarget(e) { for (const m of e.hit) { const j = this.bodyMeshes.indexOf(m); if (j >= 0) this.bodyMeshes.splice(j, 1); } }

  // Called by the weapon system. Returns true if this hit killed.
  damage(e, dmg, point, head) {
    if (e.state !== 'active') return false;
    e.hp -= dmg; e._flashT = 0.14; e.flinch = Math.max(e.flinch, 0.16);
    const fx = this.game.effects;
    fx.blood(point.x, point.y, point.z, 0, 0, head ? 10 : 6, head ? 0xffffff : e.def.accent);
    fx.damageNumber(point, Math.min(Math.round(dmg), 999), head);
    this.game.audio.impactE(point.x, point.z);
    if (e.hp <= 0) { this.kill(e, head); return true; }
    return false;
  }

  kill(e, head) {
    const r = e.root.position, def = e.def, fx = this.game.effects;
    fx.burst(r.x, r.y + 1, r.z, e.type === 'brute' ? 30 : 16, def.accent, e.type === 'brute' ? 10 : 7, 0.6);
    fx.blood(r.x, r.y + 1, r.z, 0, 0, 14, 0xaa1133);
    if (head) fx.burst(r.x, r.y + 1.5, r.z, 10, 0xffffff, 6, 0.4, 0.3);
    if (e.type === 'brute') this.game.audio.bruteDie(r.x, r.z); else this.game.audio.kill(r.x, r.z);
    this._untarget(e); this.aliveCount--;
    e.state = 'dying'; e.deathT = 0; e.vy = 1.6;
    e._fall = (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random() * 0.4);
    this.game.onKill(e, head); // after aliveCount-- so the wave-end check is correct
  }

  shootProjectile(e) {
    const p = this.proj[this.pcursor]; this.pcursor = (this.pcursor + 1) % this.proj.length;
    const r = e.root.position, pl = this.game.player.pos;
    const ox = r.x, oy = r.y + 1.3, oz = r.z;
    const dx = pl.x - ox, dy = (pl.y + 0.8) - oy, dz = pl.z - oz, d = Math.hypot(dx, dy, dz) || 1, spd = 34;
    p.vx = dx / d * spd; p.vy = dy / d * spd; p.vz = dz / d * spd; p.life = 3; p.dmg = e.dmg;
    p.mesh.position.set(ox, oy, oz); p.mesh.visible = true;
    this.game.audio.eShoot(r.x, r.z);
    this.game.effects.burst(ox, oy, oz, 5, e.def.accent, 4, 0.2, 0.2);
  }
  _updateProj(dt) {
    const pl = this.game.player;
    for (const p of this.proj) {
      if (p.life <= 0) continue; p.life -= dt;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      const m = p.mesh.position;
      const dx = m.x - pl.pos.x, dy = m.y - (pl.pos.y + 0.9), dz = m.z - pl.pos.z;
      if (dx * dx + dy * dy + dz * dz < 1.1) { pl.takeDamage(p.dmg, m.x, m.z); this.game.effects.burst(m.x, m.y, m.z, 10, 0x7dff8a, 6, 0.4); p.life = 0; p.mesh.visible = false; continue; }
      if (m.y < 0.2 || p.life <= 0 || Math.abs(m.x) > 56 || Math.abs(m.z) > 56) { this.game.effects.burst(m.x, Math.max(0.2, m.y), m.z, 6, 0x7dff8a, 4, 0.3); p.life = 0; p.mesh.visible = false; }
    }
  }

  // Dijkstra flow field from the player's nav node: next[i] = hop toward player.
  _computeFlow(target) {
    const nodes = this.game.world.navNodes, n = nodes.length;
    const dist = new Float32Array(n).fill(Infinity), done = new Uint8Array(n);
    const next = new Int16Array(n).fill(-1);
    dist[target] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0) break; done[u] = 1;
      for (const { to, cost } of nodes[u].edges) {
        if (dist[u] + cost < dist[to]) { dist[to] = dist[u] + cost; next[to] = u; }
      }
    }
    this.flow = next;
  }

  update(dt, t) {
    const w = this.game.world, pl = this.game.player;
    // recompute flow when the player changes nav node
    const pn = w.nearestNode(pl.pos.x, pl.pos.y, pl.pos.z);
    if (pn !== this.playerNode) { this.playerNode = pn; this._computeFlow(pn); }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i], r = e.root.position;

      if (e.state === 'spawning') {
        e.spawnT += dt; const k = Math.min(1, e.spawnT / 0.5);
        r.y = e.feetY; e.root.scale.setScalar(k); e.rig.setEmissive(1.5 + (1 - k) * 3);
        this._animate(e, dt, false, 0);
        this._shadow(e);
        if (k >= 1) { e.state = 'active'; e.rig.setEmissive(1.5); this.game.audio.vox(e.type, r.x, r.z); }
        continue;
      }
      if (e.state === 'dying') {
        e.deathT += dt; const k = Math.min(1, e.deathT / 0.95);
        e.root.rotation.x = lerp(0, e._fall, Math.min(1, k * 1.4));
        e.vy -= 10 * dt; e.feetY += e.vy * dt;
        const fy = w.sampleFloor(r.x, r.z, e.feetY + 0.7);
        if (fy !== null && e.feetY < fy) e.feetY = fy;
        r.y = e.feetY;
        e.rig.setOpacity(Math.max(0, 1 - k)); e.rig.setEmissive(1.5 + Math.sin(t * 40) * 0.6 * (1 - k));
        e.shadow.material.opacity = Math.max(0, (1 - k) * 0.5);
        if (k >= 1) this.despawn(e);
        continue;
      }

      // ---- active AI ----
      e.flinch = Math.max(0, e.flinch - dt);
      const dyToP = pl.pos.y - e.feetY;
      const ex = r.x, ez = r.z;
      const toPX = pl.pos.x - ex, toPZ = pl.pos.z - ez;
      const horiz = Math.hypot(toPX, toPZ) || 0.001;

      // choose steering target: beeline if same level / same node, else nav waypoint
      e.node = w.nearestNode(ex, e.feetY, ez);
      let tx = pl.pos.x, tz = pl.pos.z;
      const beeline = Math.abs(dyToP) < 1.7 || e.node === this.playerNode;
      if (!beeline && this.flow && this.flow[e.node] >= 0) {
        const wp = w.navNodes[this.flow[e.node]]; tx = wp.x; tz = wp.z;
      }
      let dirX = tx - ex, dirZ = tz - ez; const dl = Math.hypot(dirX, dirZ) || 1; dirX /= dl; dirZ /= dl;

      // separation from nearby enemies
      this._sep.set(0, 0, 0);
      for (let j = 0; j < this.list.length; j++) {
        const o = this.list[j]; if (o === e || o.state !== 'active') continue;
        const ddx = ex - o.root.position.x, ddz = ez - o.root.position.z; const dd = ddx * ddx + ddz * ddz;
        if (dd < 2.2 && dd > 0.0001) { const inv = 1 / Math.sqrt(dd); this._sep.x += ddx * inv; this._sep.z += ddz * inv; }
      }
      dirX += this._sep.x * 0.5; dirZ += this._sep.z * 0.5;
      const nl = Math.hypot(dirX, dirZ) || 1; dirX /= nl; dirZ /= nl;

      const slow = e.flinch > 0 ? 0.4 : 1;
      let moveX = dirX, moveZ = dirZ, moving = true;
      e.attack = false;

      if (e.def.ranged) {
        const keep = e.def.keep;
        if (beeline) {
          if (horiz > keep + 2) { /* approach */ }
          else if (horiz < keep - 3) { moveX = -dirX; moveZ = -dirZ; }
          else { moveX = -dirZ * 0.6; moveZ = dirX * 0.6; } // strafe
          e.cd -= dt; e.aimPitch = clamp((pl.pos.y + 0.8 - (e.feetY + 1.3)) / horiz, -0.6, 0.6);
          if (e.cd <= 0 && horiz < keep + 12 && Math.abs(dyToP) < 6) { this.shootProjectile(e); e.cd = rand(1.5, 2.5); }
        }
      } else {
        const reach = e.def.build + 1.2;
        if (horiz < reach && Math.abs(dyToP) < 1.5) {
          e.attack = true; moving = horiz > reach * 0.7;
          e.cd -= dt;
          if (e.cd <= 0) { pl.takeDamage(e.dmg, ex, ez); e.cd = e.type === 'runner' ? 0.65 : 0.95; this.game.audio.vox(e.type, ex, ez); }
        }
      }

      const step = e.speed * slow * dt, rad = e.def.build * 0.45 + 0.3;
      let nx = ex + moveX * step; if (!w.blocked(nx, ez, e.feetY, rad, 0.65)) r.x = nx;
      let nz = ez + moveZ * step; if (!w.blocked(r.x, nz, e.feetY, rad, 0.65)) r.z = nz;
      r.x = clamp(r.x, -49, 49); r.z = clamp(r.z, -49, 49);

      // vertical: follow walkable surface (climb ramps), fall over gaps
      const fy = w.sampleFloor(r.x, r.z, e.feetY + 0.75);
      if (fy !== null) { e.feetY = damp(e.feetY, fy, 14, dt); e.vy = 0; }
      else { e.vy -= 18 * dt; e.feetY += e.vy * dt; if (e.feetY < -28) { e.feetY = 0; r.set(this.game.world.spawnPoints[0].x, 0, this.game.world.spawnPoints[0].z); } }
      r.y = e.feetY;

      // face movement / player
      const faceYaw = Math.atan2(e.attack || e.def.ranged ? toPX : moveX, e.attack || e.def.ranged ? toPZ : moveZ);
      e.root.rotation.y = damp(e.root.rotation.y, faceYaw, 11, dt);

      this._animate(e, dt, moving, e.speed);
      this._shadow(e);

      if (e._flashT > 0) { e._flashT -= dt; e.rig.setEmissive(1.5 + Math.max(0, e._flashT) * 10); }
      if (Math.random() < dt * 0.07 && horiz < 30) this.game.audio.vox(e.type, r.x, r.z);
    }

    this._updateProj(dt);
  }

  _animate(e, dt, moving, speed) {
    const gait = e.def.gait;
    const rate = gait === 'run' ? 16 : gait === 'heavy' ? 7 : 11;
    e.phase += dt * rate * (moving ? 1 : 0.15);
    const amp = gait === 'run' ? 1.15 : gait === 'heavy' ? 0.7 : 0.85;
    const lean = gait === 'run' ? 0.28 : gait === 'heavy' ? 0.12 : 0.08;
    // footstep audio + brute ground shake
    if (moving) {
      const ph = e.phase % (Math.PI * 2), down = ph > Math.PI * 0.9 && ph < Math.PI * 1.1;
      const hd = Math.hypot(e.root.position.x - this.game.player.pos.x, e.root.position.z - this.game.player.pos.z);
      if (down && !e.stepFlag && hd < 26) { this.game.audio.step(e.root.position.x, e.root.position.z, e.type === 'brute' ? 0.6 : 1); if (e.type === 'brute' && hd < 11) this.game.player.addShake(0.1); e.stepFlag = true; }
      if (!down) e.stepFlag = false;
    }
    animateHumanoid(e.rig, {
      moving, speed, gaitAmp: amp, lean, phase: e.phase, flinch: e.flinch,
      attack: e.attack, ranged: e.def.ranged, aimPitch: e.aimPitch,
    }, dt);
  }

  _shadow(e) {
    const r = e.root.position;
    const fy = this.game.world.sampleFloor(r.x, r.z, e.feetY + 0.75);
    const gy = fy !== null ? fy : e.feetY;
    e.shadow.visible = true;
    e.shadow.position.set(r.x, gy + 0.03, r.z);
    const s = e.def.build * 1.5;
    e.shadow.scale.set(s, s, s);
    e.shadow.material.opacity = clamp(0.5 - (e.feetY - gy) * 0.25, 0, 0.5);
  }

  reset() {
    for (let i = this.list.length - 1; i >= 0; i--) this.despawn(this.list[i]);
    this.list.length = 0; this.bodyMeshes.length = 0; this.aliveCount = 0;
    this.flow = null; this.playerNode = -1;
    for (const p of this.proj) { p.life = 0; p.mesh.visible = false; }
  }
}
