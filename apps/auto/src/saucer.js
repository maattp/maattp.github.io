// THE SAUCER: sometimes, a flying saucer is parked in one of Seattle's open
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
// off. The first time you climb in pays once (localStorage 'auto-saucer').
// Flown and left, it takes off on its own a few minutes later once you are
// out of sight of it.

import * as THREE from './three.js';
import * as G from './geo.js';

// Meadows (lat, lon, name): each is searched at boot for a flat, open, dry
// circle 16 m across, clear of buildings, trees and posts.
const SITES = [
  [47.6588, -122.4092, 'the meadow at Discovery Park'],
  [47.6820, -122.2595, 'the playfields at Magnuson Park'],
  [47.5312, -122.3955, 'the meadow at Lincoln Park'],
  [47.6935, -122.4000, 'the meadow above Golden Gardens'],
  [47.5515, -122.2560, 'the lawn at Seward Park'],
  [47.6300, -122.3150, 'the lawn at Volunteer Park'],
];
const PARKED_S = [240, 360], GONE_S = [180, 480], FIRST_S = 90;

export class Saucer {
  /** o: { scene, city, traffic, hud (getter), game (getter), audio (getter), player (getter) } */
  constructor(o) {
    this.o = o;
    try { this.found = localStorage.getItem('auto-saucer') === '1'; } catch (e) { this.found = false; }
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
        try { localStorage.setItem('auto-saucer', '1'); } catch (e) { /* private mode */ }
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
