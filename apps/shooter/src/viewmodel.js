import * as THREE from 'three';
import { lerp, damp } from './utils.js';

// First-person viewmodel: a detailed weapon held by two arms/hands.
// Everything renders on top (depthTest off) so it never clips the world.
export class ViewModel {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.engine.camera.add(this.group);
    this.rest = new THREE.Vector3(0.14, -0.16, -0.46);
    this.ads = new THREE.Vector3(0, -0.075, -0.34);
    this.group.position.copy(this.rest);
    this.group.scale.setScalar(1.12);
    this.muzzle = new THREE.Object3D(); this.group.add(this.muzzle);
    this.eject = new THREE.Object3D(); this.group.add(this.eject);
    this._meshes = [];
    this.slide = null; this.mag = null; this.flash = null; this.magBaseY = 0; this.slideBaseZ = 0;
    this.kick = 0;

    this.matMetal = new THREE.MeshStandardMaterial({ color: 0x404a5e, metalness: 0.85, roughness: 0.33, depthTest: false, fog: false });
    this.matDark = new THREE.MeshStandardMaterial({ color: 0x262b38, metalness: 0.7, roughness: 0.5, depthTest: false, fog: false });
    this.matSkin = new THREE.MeshStandardMaterial({ color: 0xe6ad80, emissive: 0xe6ad80, emissiveIntensity: 0.12, roughness: 0.7, metalness: 0.05, depthTest: false, fog: false });
    this.matSleeve = new THREE.MeshStandardMaterial({ color: 0x2c3650, metalness: 0.4, roughness: 0.6, depthTest: false, fog: false });

    // dedicated fill light so the weapon/hands read in the dark scene
    this.fill = new THREE.PointLight(0x9fb4dc, 1.1, 2.6);
    this.fill.position.set(0.18, 0.05, -0.25);
    game.engine.camera.add(this.fill);
  }

  _add(geo, mat, x, y, z, parent) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.renderOrder = 998;
    (parent || this.group).add(m); this._meshes.push(m); return m;
  }
  _glow(color) { return new THREE.MeshBasicMaterial({ color, toneMapped: false, depthTest: false, fog: false }); }

  // a gloved hand gripping a point, with a short forearm stubbing off toward
  // the bottom of the frame. gx/gy/gz = grip point; the anchor is derived below.
  _arm(gx, gy, gz, side) {
    // anchor: just down-and-back from the grip so the forearm exits the frame
    const ax = gx + side * 0.05, ay = gy - 0.24, az = gz + 0.16;
    const dir = new THREE.Vector3(gx - ax, gy - ay, gz - az); const L = dir.length(); dir.normalize();
    const fore = this._add(new THREE.CapsuleGeometry(0.03, Math.max(0.05, L - 0.06), 4, 6), this.matSleeve, (gx + ax) / 2, (gy + ay) / 2, (gz + az) / 2);
    fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const hand = new THREE.Group(); hand.position.set(gx, gy, gz); this.group.add(hand); this._meshes.push(hand);
    hand.rotation.set(0.2, 0, side * 0.2);
    this._add(new THREE.BoxGeometry(0.065, 0.05, 0.085), this.matSkin, 0, 0, 0, hand);        // palm
    this._add(new THREE.BoxGeometry(0.07, 0.028, 0.055), this.matSkin, 0, -0.035, -0.035, hand); // curled fingers over front
    this._add(new THREE.BoxGeometry(0.022, 0.05, 0.04), this.matSkin, -side * 0.04, 0.005, 0.01, hand); // thumb
    return { fore, hand };
  }

  build(w) {
    for (const m of this._meshes) this.group.remove(m);
    this._meshes = []; this.slide = this.mag = this.flash = null;
    const glow = this._glow(w.color);

    if (w.frame === 'pistol') {
      this._add(new THREE.BoxGeometry(0.07, 0.12, 0.34), this.matMetal, 0, 0, -0.04);
      this.slide = this._add(new THREE.BoxGeometry(0.08, 0.06, 0.36), this.matDark, 0, 0.08, -0.05);
      this._add(new THREE.BoxGeometry(0.07, 0.17, 0.09), this.matMetal, 0, -0.13, 0.05);
      this.mag = this._add(new THREE.BoxGeometry(0.055, 0.12, 0.07), glow, 0, -0.16, 0.05);
      this._add(new THREE.BoxGeometry(0.02, 0.02, 0.34), glow, 0.0, 0.12, -0.05);
      this.muzzle.position.set(0, 0.02, -0.24); this.eject.position.set(0.06, 0.09, -0.06);
      this._armsFor(0.0, -0.05, 0.06, -0.02, -0.03, -0.14);
    } else if (w.frame === 'smg') {
      this._add(new THREE.BoxGeometry(0.08, 0.1, 0.46), this.matMetal, 0, 0.01, -0.1);
      this.slide = this._add(new THREE.BoxGeometry(0.06, 0.05, 0.34), this.matDark, 0, 0.08, -0.08);
      this._add(new THREE.BoxGeometry(0.07, 0.16, 0.08), this.matMetal, 0, -0.12, 0.06);
      this.mag = this._add(new THREE.BoxGeometry(0.05, 0.22, 0.07), glow, 0, -0.2, -0.06);
      this._add(new THREE.BoxGeometry(0.03, 0.03, 0.5), glow, 0.045, 0.05, -0.12);
      this._add(new THREE.BoxGeometry(0.05, 0.07, 0.16), this.matDark, 0, -0.04, -0.28); // handguard
      this.muzzle.position.set(0, 0.03, -0.38); this.eject.position.set(0.06, 0.1, -0.1);
      this._armsFor(0.0, -0.04, 0.07, -0.02, -0.02, -0.28);
    } else if (w.frame === 'shotgun') {
      this._add(new THREE.BoxGeometry(0.09, 0.11, 0.6), this.matMetal, 0, 0.01, -0.18);
      this.slide = this._add(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8), this.matDark, 0, -0.07, -0.22);
      this.slide.rotation.x = Math.PI / 2;
      this._add(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 8), this.matMetal, 0, 0.04, -0.2).rotation.x = Math.PI / 2;
      this._add(new THREE.BoxGeometry(0.07, 0.17, 0.09), this.matMetal, 0, -0.13, 0.12);
      this._add(new THREE.BoxGeometry(0.05, 0.05, 0.66), glow, 0.0, 0.09, -0.2);
      this.muzzle.position.set(0, 0.04, -0.5); this.eject.position.set(0.07, 0.07, -0.1);
      this._armsFor(0.0, -0.06, 0.12, -0.02, -0.05, -0.32);
    } else { // rail
      this._add(new THREE.BoxGeometry(0.08, 0.1, 0.78), this.matMetal, 0, 0.02, -0.26);
      this._add(new THREE.TorusGeometry(0.1, 0.022, 6, 16), glow, 0, 0.02, -0.5).rotation.y = Math.PI / 2;
      this._add(new THREE.TorusGeometry(0.08, 0.02, 6, 16), glow, 0, 0.02, -0.18).rotation.y = Math.PI / 2;
      this.slide = this._add(new THREE.BoxGeometry(0.04, 0.2, 0.42), glow, 0, 0.12, -0.18);
      this._add(new THREE.BoxGeometry(0.07, 0.17, 0.1), this.matMetal, 0, -0.13, 0.12);
      this.mag = this._add(new THREE.BoxGeometry(0.07, 0.14, 0.1), glow, 0, -0.16, 0.12);
      this.muzzle.position.set(0, 0.02, -0.7); this.eject.position.set(0.06, 0.1, -0.1);
      this._armsFor(0.0, -0.06, 0.12, -0.02, -0.04, -0.4);
    }

    // optic / top sight
    this._add(new THREE.BoxGeometry(0.018, 0.03, 0.12), glow, 0, 0.13, -0.06);

    this.flash = this._add(new THREE.PlaneGeometry(0.55, 0.55),
      new THREE.MeshBasicMaterial({ color: w.color, toneMapped: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, fog: false, side: THREE.DoubleSide }));
    this.flash.position.copy(this.muzzle.position); this.flash.renderOrder = 1000;
    this.slideBaseZ = this.slide ? this.slide.position.z : 0;
    this.magBaseY = this.mag ? this.mag.position.y : 0;
  }

  _armsFor(rgx, rgy, rgz, lgx, lgy, lgz) {
    this._arm(rgx, rgy, rgz, 1);    // right hand at grip
    this._arm(lgx, lgy, lgz, -1);   // left hand at foregrip
  }

  fireKick() { this.kick = 1; if (this.flash) { this.flash.material.opacity = 1; this.flash.rotation.z = Math.random() * Math.PI; this.flash.scale.setScalar(0.7 + Math.random() * 0.6); } }

  update(dt, p) {
    // p: { adsAmt, bobX, bobY, recoilZ, reloading, reloadProg, sway }
    this.kick = damp(this.kick, 0, 18, dt);
    const tgt = this.rest.clone().lerp(this.ads, p.adsAmt);
    tgt.x += p.bobX * (1 - p.adsAmt * 0.7); tgt.y += p.bobY * (1 - p.adsAmt * 0.7);
    let reloadDip = 0, reloadRoll = 0;
    if (p.reloading) {
      const rp = p.reloadProg;
      reloadDip = Math.sin(rp * Math.PI) * 0.2; reloadRoll = Math.sin(rp * Math.PI) * 0.5;
      if (this.mag) { const drop = rp < 0.5 ? lerp(0, -0.4, rp / 0.5) : lerp(-0.4, 0, (rp - 0.5) / 0.5); this.mag.position.y = this.magBaseY + drop; }
    } else if (this.mag) this.mag.position.y = this.magBaseY;
    tgt.y -= reloadDip; tgt.z += this.kick * 0.06;
    this.group.position.x = damp(this.group.position.x, tgt.x, 18, dt);
    this.group.position.y = damp(this.group.position.y, tgt.y, 18, dt);
    this.group.position.z = damp(this.group.position.z, tgt.z, 22, dt);
    this.group.rotation.x = damp(this.group.rotation.x, this.kick * 0.25 + reloadRoll, 18, dt);
    this.group.rotation.z = damp(this.group.rotation.z, p.sway, 10, dt);
    if (this.slide) this.slide.position.z = this.slideBaseZ + this.kick * 0.1;
    if (this.flash && this.flash.material.opacity > 0) this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 14);
  }

  muzzleWorld(v) { return this.muzzle.getWorldPosition(v); }
  ejectWorld(v) { return this.eject.getWorldPosition(v); }
}
