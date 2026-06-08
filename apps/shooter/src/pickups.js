import * as THREE from 'three';
import { PLAYER } from './config.js';

const PU = { health: 0x33ff77, ammo: 0x46f9ff, credits: 0xffd23f, nuke: 0xff3b3b, maxammo: 0x46f9ff, double: 0xff4ddb, insta: 0xffffff };

export class Pickups {
  constructor(game) { this.game = game; this.scene = game.engine.scene; this.list = []; }

  spawn(type, x, y, z) {
    const col = PU[type], g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55),
      new THREE.MeshBasicMaterial({ color: col, toneMapped: false, transparent: true, opacity: 0.9 }));
    g.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 18), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
    ring.rotation.x = Math.PI / 2; g.add(ring);
    g.position.set(x, y + 0.6, z); this.scene.add(g);
    this.list.push({ type, group: g, core, t: 0, life: 22, baseY: y + 0.6 });
  }
  maybeDrop(x, y, z) {
    const r = Math.random();
    if (r < 0.012) this.spawn(['nuke', 'maxammo', 'double', 'insta'][(Math.random() * 4) | 0], x, y, z);
    else if (r < 0.1) this.spawn('health', x, y, z);
    else if (r < 0.18) this.spawn('ammo', x, y, z);
    else if (r < 0.3) this.spawn('credits', x, y, z);
  }
  update(dt) {
    const p = this.game.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const k = this.list[i]; k.t += dt; k.life -= dt;
      k.group.position.y = k.baseY + Math.sin(k.t * 3) * 0.2; k.group.rotation.y += dt * 2;
      k.core.material.opacity = 0.6 + Math.sin(k.t * 8) * 0.3;
      if (k.life < 6) k.group.visible = Math.sin(k.t * 12) > -0.2;
      const dx = k.group.position.x - p.pos.x, dz = k.group.position.z - p.pos.z, dy = k.group.position.y - (p.pos.y + 0.8);
      if (dx * dx + dz * dz < 2.4 && Math.abs(dy) < 1.8) { this.collect(k); this.scene.remove(k.group); this.list.splice(i, 1); continue; }
      if (k.life <= 0) { this.scene.remove(k.group); this.list.splice(i, 1); }
    }
  }
  collect(k) {
    const g = this.game; g.audio.power();
    g.effects.burst(k.group.position.x, k.group.position.y, k.group.position.z, 16, PU[k.type], 7, 0.5, 0.2);
    switch (k.type) {
      case 'health': g.player.hp = Math.min(PLAYER.maxHp, g.player.hp + 35); g.hud.vitals(); g.hud.feed('+35 INTEGRITY', '#33ff77'); break;
      case 'ammo': g.weapons.refillReserve(g.weapons.current); g.hud.feed('AMMO RESTOCKED', '#46f9ff'); break;
      case 'credits': g.hud.addCredits(120); g.hud.feed('+120 CREDITS', '#ffd23f'); break;
      case 'maxammo': g.weapons.weapons.forEach(w => { if (w.owned) { w.ammo = w.mag; w.reserve = w.reserveMax; } }); g.hud.ammo(); g.hud.banner('MAX AMMO', '', '#46f9ff'); break;
      case 'nuke': this.nukeAll(); g.hud.banner('NUKE', '', '#ff3b3b'); break;
      case 'double': g.powerTimers.double = 20; g.hud.banner('DOUBLE POINTS', '', '#ff4ddb'); break;
      case 'insta': g.powerTimers.insta = 20; g.hud.banner('INSTA-KILL', '', '#ffffff'); break;
    }
  }
  nukeAll() {
    const g = this.game; g.player.addShake(1.2); g.audio.bruteDie(g.player.pos.x, g.player.pos.z);
    const list = g.enemies.list;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].state === 'active') g.enemies.kill(list[i], false);
  }
  reset() { for (const k of this.list) this.scene.remove(k.group); this.list.length = 0; }
}
