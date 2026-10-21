// THE SAUCER: sometimes, a flying saucer is parked in one of Waterloo Region's open
// meadows (an Easter egg). Walk up, ENTER, and fly it (vehicles.js 'saucer':
// the helicopter's hover model with none of its limits).
//
// A nod to June 24, 1947: Kenneth Arnold, flying past Mt Rainier, saw nine
// shining objects skipping in a line "like a saucer if you skip it across
// water" -- the sighting that gave the world the words "flying saucer".
//
// It keeps its own schedule: parked for about five minutes at one of a few
// meadows, then gone for three to eight, then somewhere else. When it lands
// somewhere you are not, a toast says where the lights were reported; while
// it is parked a faint shaft of light stands over it, visible from a long way
// off. The first time you climb in pays once (localStorage 'autokw-saucer').
// Flown and left, it takes off on its own a few minutes later once you are
// out of sight of it.

import * as THREE from './three.js';
import * as G from './geo.js';

// Meadows (lat, lon, name): each is searched at boot for a flat, open, dry
// circle 16 m across, clear of buildings, trees and posts.
const SITES = [
  [43.4900, -80.5650, 'the meadow at Laurel Creek'],
  [43.5085, -80.4960, 'the playfields at RIM Park'],
  [43.4010, -80.4730, 'the meadow at Huron Natural Area'],
  [43.4895, -80.4920, 'the fields at Bechtel Park'],
  [43.4560, -80.4180, 'the lawn at Kiwanis Park'],
  [43.3940, -80.3460, 'the lawn at Riverside Park'],
];
const PARKED_S = [240, 360], GONE_S = [180, 480], FIRST_S = 90;

export class Saucer {
  /** o: { scene, city, traffic, fx, hud (getter), game (getter), audio (getter), player (getter) } */
  constructor(o) {
    this.o = o;
    try { this.found = localStorage.getItem('autokw-saucer') === '1'; } catch (e) { this.found = false; }
    this.sites = [];
    for (const [la, lo, name] of SITES) {
      const [x0, z0] = G.toWorld(la, lo);
      const spot = this._clear(x0, z0);
      if (spot) this.sites.push({ ...spot, name });
    }
    // keep the scatter (trees, benches) off the landing spots: a chunk's trees
    // are planted when it builds, after this, and would grow through it
    const city = o.city;
    if (!city.clearCircles) city.clearCircles = [];
    for (const st of this.sites) city.clearCircles.push([st.x, st.z, 14]);
    this.v = null;          // the vehicle while it exists
    this.site = null;
    this.t = FIRST_S;       // seconds to the next change
    this.state = 'gone';    // 'gone' | 'parked' | 'left' (flown and left somewhere)
    this.last = -1;
    // the shaft of light: an open cylinder, additive, faint, 260 m tall
    const g = new THREE.CylinderGeometry(2.6, 6.5, 260, 20, 1, true);
    g.translate(0, 130, 0);
    this.beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: 0x9fe8ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    }));
    this.beam.name = 'saucer:beam';
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    o.scene.add(this.beam);
    this._fx = this._makeFx();
  }

  // --- the lit parts --------------------------------------------------------
  // Unlit and bright (toneMapped off), so the post chain's bloom takes them:
  // sixteen rim lamps in a chase, a glow under the belly, a ring of energy
  // just under the rim, and -- hovering low and slow -- a cone of light to the
  // ground. They hang from the saucer's tilt group, so they lean with it.
  _makeFx() {
    const tex = (draw, w = 128, h = 128) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const radial = tex((g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(210,255,255,1)'); gr.addColorStop(0.35, 'rgba(120,230,255,0.55)'); gr.addColorStop(1, 'rgba(60,140,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const dashes = tex((g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 24; i++) { g.fillStyle = i % 2 ? 'rgba(120,240,255,0.9)' : 'rgba(255,220,120,0.5)'; g.fillRect((i / 24) * w, 0, w / 48, h); }
    }, 512, 8);
    dashes.wrapS = THREE.RepeatWrapping;
    const fall = tex((g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(190,250,255,0.9)'); gr.addColorStop(0.25, 'rgba(140,220,255,0.35)'); gr.addColorStop(1, 'rgba(120,200,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.06})`; g.fillRect(Math.random() * w, 0, 1 + Math.random() * 2, h); }
    }, 64, 256);
    const add = (opts) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, ...opts });
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.19, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), 16);
    lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(16 * 3), 3);
    const m = new THREE.Matrix4();
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; m.makeTranslation(Math.cos(a) * 5.66, 0, -Math.sin(a) * 5.66); lamps.setMatrixAt(k, m); }
    const glow = new THREE.Mesh(new THREE.CircleGeometry(3.3, 48), add({ map: radial, side: THREE.DoubleSide }));
    glow.rotation.x = Math.PI / 2; glow.position.y = -0.75;
    const ringG = new THREE.RingGeometry(5.0, 6.1, 96, 1);
    // the ring's dashes run round it: u along the circumference
    const uv = ringG.attributes.uv, pos = ringG.attributes.position;
    for (let i = 0; i < uv.count; i++) { const x = pos.getX(i), y = pos.getY(i); uv.setXY(i, (Math.atan2(y, x) / (Math.PI * 2) + 0.5) * 6, Math.hypot(x, y) > 5.5 ? 1 : 0); }
    const ring = new THREE.Mesh(ringG, add({ map: dashes, side: THREE.DoubleSide, opacity: 0.0 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.3;
    const coneG = new THREE.CylinderGeometry(3.0, 7.5, 1, 40, 1, true);
    coneG.translate(0, -0.5, 0);   // top at 0, one unit down
    const cone = new THREE.Mesh(coneG, add({ map: fall, side: THREE.DoubleSide, opacity: 0 }));
    cone.position.y = -0.75;
    // a soft halo round each lamp: the bloom's job on a desktop, faked so a
    // phone (and a headless shot) sees the lamps glow too
    const halos = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 10, 8), add({ map: radial, opacity: 0.4 }), 16);
    halos.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(16 * 3), 3);
    for (let k = 0; k < 16; k++) { lamps.getMatrixAt(k, m); halos.setMatrixAt(k, m); }
    // the dome: clear glass, a glint of sky, the pilot showing through
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.62, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xc8f0ff, metalness: 0.15, roughness: 0.03, transparent: true, opacity: 0.26, envMapIntensity: 2.4, depthWrite: false }));
    dome.scale.y = 0.66 * 1.3; dome.position.y = 1.18;
    const g = new THREE.Group(); g.name = 'saucer:fx';
    g.add(lamps, halos, glow, ring, cone, dome);
    for (const o of g.children) { o.frustumCulled = false; o.renderOrder = 2; }
    lamps.renderOrder = 0; dome.renderOrder = 3;
    return { g, lamps, halos, glow, ring, cone, dome, col: new THREE.Color(), parent: null };
  }

  /** The lit parts on the current saucer: chase, pulse, the beam, the legs. */
  _animate(dt, flying) {
    const v = this.v, F = this._fx;
    if (!v || !v.tilt) { if (F.parent) { F.parent.remove(F.g); F.parent = null; } return; }
    if (F.parent !== v.tilt) {
      if (F.parent) F.parent.remove(F.g);
      v.tilt.add(F.g); F.parent = v.tilt;
      F.g.position.y = 1.25 - (v.pivotY || 0);   // the rim, in the tilt group's frame
    }
    const t = performance.now() / 1000, air = !!v.airborne;
    const sp = Math.hypot(v.vLong || 0, v.vLat || 0);
    const agl = v.y - G.terrainHeight(v.x, v.z);
    // the lamps: two colours chasing round, faster in flight
    const rate = flying ? (air ? 3.2 + sp * 0.02 : 1.6) : 0.5;
    for (let k = 0; k < 16; k++) {
      const ph = ((k / 16) - t * rate / (Math.PI * 2)) % 1;
      const hot = Math.pow(Math.max(0, Math.cos(ph * Math.PI * 2 * 2)), 6);
      const b = (flying ? 0.45 : 0.3) + hot * (flying ? 2.4 : 1.2);
      if (k % 2) F.col.setRGB(1.0 * b, 0.78 * b, 0.3 * b); else F.col.setRGB(0.35 * b, 0.95 * b, 1.0 * b);
      F.lamps.setColorAt(k, F.col);
      F.halos.setColorAt(k, F.col.multiplyScalar(0.55));
    }
    F.lamps.instanceColor.needsUpdate = true; F.halos.instanceColor.needsUpdate = true;
    // the belly's glow breathes; the energy ring wakes in the air
    const pulse = 0.5 + 0.5 * Math.sin(t * (air ? 5 : 1.6));
    F.glow.material.opacity = (air ? 0.75 : flying ? 0.45 : 0.22) + pulse * 0.2;
    F.glow.scale.setScalar(1 + pulse * (air ? 0.12 : 0.04));
    F.ring.material.opacity += ((air ? 0.85 : flying ? 0.25 : 0) - F.ring.material.opacity) * Math.min(1, dt * 3);
    F.ring.visible = F.ring.material.opacity > 0.01;
    F.ring.material.map.offset.x = (F.ring.material.map.offset.x + dt * (air ? 0.6 + sp * 0.004 : 0.15)) % 1;
    // the beam to the ground: hovering low and slow
    const wantBeam = air && agl < 60 && sp < 9 ? 0.55 : 0;
    F.cone.material.opacity += (wantBeam - F.cone.material.opacity) * Math.min(1, dt * 2.5);
    F.cone.visible = F.cone.material.opacity > 0.01;
    if (F.cone.visible) { F.cone.scale.set(1, Math.max(1, agl - 0.5), 1); F.cone.material.map.offset.y = (F.cone.material.map.offset.y - dt * 0.35) % 1; }
    // legs up in the air, down to land (live parts on the flown saucer)
    for (const m of v.spinMeshes || []) {
      if (m.userData.axis !== 'z') continue;
      const want = air && agl > 3 ? 0.02 : 1;
      m.scale.y += (want - m.scale.y) * Math.min(1, dt * 3);
      m.visible = m.scale.y > 0.05;
    }
    // dust thrown up off the ground under a low hover
    const fx = this.o.fx;
    if (fx && air && agl < 14 && Math.random() < dt * 30) {
      const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 4;
      const gx = v.x + Math.cos(a) * r, gz = v.z + Math.sin(a) * r;
      fx.emit(gx, G.terrainHeight(gx, gz) + 0.3, gz, 2, { r: 0.62, g: 0.58, b: 0.5, size: 1.1, grow: 1.5, alpha: 0.8, life: 1.5, spread: 1.5, vx: Math.cos(a) * 4, vz: Math.sin(a) * 4, vy: 0.8, grav: 0.2, drag: 0.93 });
    }
  }

  /** A flat, dry, open spot within 160 m of (x0, z0), or null. */
  _clear(x0, z0) {
    // lawn first (the mask's mown green or open ground), then anything open
    return this._clearPass(x0, z0, true) || this._clearPass(x0, z0, false);
  }

  _clearPass(x0, z0, lawn) {
    const city = this.o.city;
    for (let r = 0; r <= 160; r += 12) {
      for (let k = 0; k < Math.max(1, Math.round(r / 6)); k++) {
        const a = (k / Math.max(1, Math.round(r / 6))) * Math.PI * 2;
        const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
        if (G.isWater(x, z) || G.lotCodeAt(x, z)) continue;
        if (lawn && G.greenKind(x, z) !== G.GREEN_LAWN && G.greenKind(x, z) !== G.GREEN_OPEN) continue;
        if (city.obstacleHit(x, z, 9, undefined)) continue;
        if (city.buildingsNear(x, z, 30).some((b) => Math.hypot(b.x - x, b.z - z) < Math.max(b.w, b.d) / 2 + 10)) continue;
        if (city.onRoadNear && city.onRoadNear(x, z, 10)) continue;
        const h = G.terrainHeight(x, z);
        let flat = true;
        for (let j = 0; j < 6 && flat; j++) {
          const b = (j / 6) * Math.PI * 2;
          if (Math.abs(G.terrainHeight(x + Math.cos(b) * 6, z + Math.sin(b) * 6) - h) > 0.9) flat = false;
        }
        if (!flat) continue;
        return { x, z, y: h };
      }
    }
    return null;
  }

  _arrive(at) {
    if (!this.sites.length) return;
    let i = at != null ? at : Math.floor(Math.random() * this.sites.length);
    if (at == null && i === this.last && this.sites.length > 1) i = (i + 1) % this.sites.length;
    this.last = i;
    const s = this.site = this.sites[i];
    const T = this.o.traffic;
    this.v = T.spawnAt(s.x, s.z, Math.random() * Math.PI * 2, 'saucer', 0xc9ccd2, 'apron');
    if (this.v) { this.v.vLong = 0; this.v.saucerHome = true; }
    this.state = 'parked';
    this.t = PARKED_S[0] + Math.random() * (PARKED_S[1] - PARKED_S[0]);
    const p = this.o.player && this.o.player.position;
    const hud = this.o.hud;
    if (hud && p && Math.hypot(p.x - s.x, p.z - s.z) > 500) hud.showToast(`Strange lights reported over ${s.name}`, 5200);
  }

  _depart() {
    if (this.v) {
      // gone in a moment: up and away (just removed, out of sight)
      this.o.traffic.remove(this.v);
      this.v = null;
    }
    this.site = null;
    this.state = 'gone';
    this.t = GONE_S[0] + Math.random() * (GONE_S[1] - GONE_S[0]);
  }

  update(dt) {
    const pl = this.o.player;
    if (!pl || !(dt > 0)) return;
    const v = this.v;
    const flying = v && pl.vehicle === v;
    if (v && !this.o.traffic.cars.includes(v)) { this.v = null; this.state = 'gone'; this.t = GONE_S[0]; }
    if (flying) {
      if (!this.found) {
        this.found = true;
        try { localStorage.setItem('autokw-saucer', '1'); } catch (e) { /* private mode */ }
        const game = this.o.game, hud = this.o.hud, audio = this.o.audio;
        if (game) game.money += 2500;
        if (hud) hud.showToast('You found the saucer. 1947: Kenneth Arnold saw nine of these skipping past Rainier +$2,500 -- UP to lift off', 7000);
        if (audio && audio.ready) audio.play('cash', { gain: 0.8 });
      }
      this.state = 'left';          // wherever you leave it
      this.t = 180;
    } else {
      this.t -= dt;
      const p = pl.position;
      const far = !v || Math.hypot(p.x - v.x, p.z - v.z) > 220;
      if (this.state === 'gone' && this.t <= 0) this._arrive();
      else if ((this.state === 'parked' || this.state === 'left') && this.t <= 0 && far) this._depart();
    }
    this._animate(dt, flying);
    // the shaft of light while it waits, a slow pulse
    // (it is for finding it from a distance: within 90 m it would be a hazy
    // glass box round the thing itself)
    const pp = pl.position;
    const show = !!this.v && !flying && this.state === 'parked' && Math.hypot(pp.x - this.v.x, pp.z - this.v.z) > 90;
    this.beam.visible = show;
    if (show) {
      this.beam.position.set(this.v.x, this.v.y + 8, this.v.z);
      this.beam.material.opacity = 0.11 + 0.06 * Math.sin(performance.now() / 700);
    }
  }

  /** Test hook: park it now at site i (default: the first). */
  parkNow(i = 0) {
    if (this.v) this._depart();
    this._arrive(i % Math.max(1, this.sites.length));
    return this.v;
  }
}
