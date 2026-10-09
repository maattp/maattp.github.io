// THE DUCK TOUR: a ticket kiosk at 516 Broad St by Seattle Center, where the
// amphibious tours ran from, two DUKWs parked at it (vehicles.js buildDuck,
// updateDuck), and a tour you captain. ENTER at the kiosk puts you at the wheel
// of the nearest duck with a load of tourists; the guide talks you round:
//
//   Seattle Center -> Westlake and Mercer -> the ramp on Lake Union's west
//   shore (SPLASHDOWN) -> the seaplane lane -> the Eastlake houseboats ->
//   Gas Works Park -> back up the ramp -> Seattle Center
//
// A beacon and a cyan dot on the maps show the next stop; the guide's lines
// run as captions. In a duck the HORN is the passengers' quackers: a chorus
// of quacks, and quacking at people on the pavement earns tips. A tour pays
// $150, $25 for the splashdown, and the tips. Leave the duck for 20 s, or
// wreck it, and the tour is off. You can take a duck off the lot without the
// tour too; it is a truck on land and a boat on the water either way.

import * as THREE from './three.js';
import * as G from './geo.js';

const KIOSK = [-743, -926];
const RAMP = { x: -181, z: -2612, dx: 0.92, dz: -0.38 };      // the shore point, and into the water
const LINES = {
  start: 'Welcome aboard the Duck! I\'m your captain. Grab a quacker -- tap the HORN and let Seattle know we\'re coming.',
  needle: 'On your left, the Space Needle: 605 feet, built for the 1962 World\'s Fair. On a clear day you can see Mount Rainier. On a normal day you can see the Space Needle.',
  monorail: 'That\'s the monorail -- 1962\'s vision of the future. It runs a mile, and it\'s been running that same mile ever since.',
  slu: 'South Lake Union: this was all warehouses and boatyards. Now it\'s cranes and lanyards.',
  ramp: 'Hold on to your hats, folks -- we are about to become a boat. Three, two, one...',
  splash: 'SPLASHDOWN! Welcome to Lake Union. We\'re a boat now. Life jackets are under your seats; the lake is under the boat.',
  seaplanes: 'Seaplanes take off right through here. If you hear one, quack at it. It won\'t help, but it\'s tradition.',
  houseboats: 'The floating homes of Eastlake. One of them was in Sleepless in Seattle. No, you can\'t go in. Yes, they\'ve heard that one.',
  gasworks: 'Gas Works Park: a gas plant from 1906 that the city kept, painted, and put a kite hill beside. Very Seattle.',
  climb: 'Wheels down -- we\'re a truck again. Nobody tell the DMV.',
  home: 'Back at Seattle Center. Thanks for riding the Duck -- tips are appreciated, quacks are free!',
};

export class DuckTour {
  /** opts: { scene, city, world, traffic, player, game, hud, audio, fx, onReward(n) } */
  constructor(opts) {
    this.o = opts;
    const { city } = opts;
    const ky = city.groundAt(KIOSK[0], KIOSK[1], null);
    this.kiosk = { x: KIOSK[0], z: KIOSK[1], y: ky };
    this.spot = { x: KIOSK[0], z: KIOSK[1] };
    this.tour = null;
    this.ducks = [];
    this._buildKiosk();
    this._buildRamp();
    this._stops();
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 30, 18, 1, true), new THREE.MeshBasicMaterial({
      color: 0x4ae8ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false,
    }));
    this.beacon.visible = false;
    opts.scene.add(this.beacon);
    // the guide's captions
    const cap = document.createElement('div');
    cap.id = 'duckCaption';
    const st = document.createElement('style');
    st.textContent = `#duckCaption { position: absolute; left: 50%; bottom: calc(96px + var(--safe-b, 0px)); transform: translateX(-50%); z-index: 12; max-width: min(620px, 70vw);
      background: rgba(10, 20, 30, .72); color: #fff; font: 700 14px/1.4 -apple-system, Helvetica, sans-serif; padding: 8px 14px; border-radius: 10px; border-left: 4px solid #f2c230;
      opacity: 0; transition: opacity .3s; pointer-events: none; text-align: left; }
      #duckCaption.show { opacity: 1; } #duckCaption b { color: #f2c230; }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(cap);
    this.cap = cap;
    this.capT = 0;
  }

  // --- the lot --------------------------------------------------------------------------------

  _buildKiosk() {
    const { scene, city, world } = this.o;
    const { x, z, y } = this.kiosk;
    // face the nearest road
    let best = 0, bd = 1e9;
    for (let a = 0; a < 16; a++) {
      const ang = a / 16 * Math.PI * 2;
      for (let t = 2; t < 16; t += 1) if (city.onRoad(x + Math.sin(ang) * t, z + Math.cos(ang) * t, 0)) { if (t < bd) { bd = t; best = ang; } break; }
    }
    this.face = best;
    const fx = Math.sin(best), fz = Math.cos(best);
    const g = new THREE.Group();
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = '#f2c230'; c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#1a5aa8'; c.fillRect(0, 196, 512, 60);
    c.fillStyle = '#10284a'; c.textAlign = 'center';
    c.font = '900 92px Helvetica, Arial, sans-serif'; c.fillText('DUCK', 256, 96);
    c.font = '900 64px Helvetica, Arial, sans-serif'; c.fillText('TOURS', 256, 168);
    c.fillStyle = '#ffffff'; c.font = '800 30px Helvetica, Arial, sans-serif'; c.fillText('LAND & LAKE · QUACK!', 256, 238);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const signM = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6 });
    const booth = new THREE.MeshStandardMaterial({ color: 0x1a5aa8, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf0eee8, roughness: 0.7 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 2.0), booth); b.position.set(0, 1.2, 0); g.add(b);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 2.6), white); roof.position.set(0, 2.55, 0); g.add(roof);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.5), signM); sign.position.set(0, 3.5, 0.02); g.add(sign);
    const signB = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.5), signM); signB.position.set(0, 3.5, -0.02); signB.rotation.y = Math.PI; g.add(signB);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.2, metalness: 0.3 })); win.position.set(0, 1.5, 1.01); g.add(win);
    g.position.set(x, y, z);
    g.rotation.y = best;
    g.name = 'duckKiosk';
    scene.add(g);
    this.kioskMesh = g;
    if (city.setLandmarkSolids) city.setLandmarkSolids([...(city.landmarkSolids || []), { x, z, hw: 1.3, hd: 1.0, rot: -best, y0: y - 1, y1: y + 2.6 }]);
    // the ENTER spot: in front of the window
    this.door = { x: x + fx * 2.4, z: z + fz * 2.4, y };
    // where the ducks park: on open ground round the kiosk, off the road and
    // clear of buildings, lying along the road (the first spots that fit)
    const sx = Math.cos(best), sz = -Math.sin(best);      // sideways (perpendicular to the facing)
    const h = best + Math.PI / 2, ux = Math.sin(h), uz = Math.cos(h);
    const clear = (cx, cz) => {
      for (const a of [-5.2, -2.6, 0, 2.6, 5.2]) for (const w of [-1.4, 0, 1.4]) {
        const px = cx + ux * a + fx * w, pz = cz + uz * a + fz * w;
        if (city.onRoad(px, pz, 0.3) || world.inBuilding(px, pz, 0.5) || city.obstacleHit(px, pz, 0.3)) return false;
        if (Math.abs(city.groundAt(px, pz, null) - y) > 1.2) return false;
      }
      return true;
    };
    this.lot = [];
    for (const back of [-4, -8, -12, 0, 4]) {
      for (const side of [9, -9, 20, -20, 31, -31]) {
        const cx = x + sx * side + fx * back, cz = z + sz * side + fz * back;
        if (this.lot.length < 2 && clear(cx, cz) && this.lot.every((l) => Math.hypot(l.x - cx, l.z - cz) > 10.5)) this.lot.push({ x: cx, z: cz, h });
      }
    }
    if (this.lot.length < 2) this.lot.push({ x: x - sx * 9, z: z - sz * 9, h }, { x: x + sx * 9, z: z + sz * 9, h });
    void world;
  }

  spawnDucks() {
    const { traffic } = this.o;
    for (const s of this.lot) {
      const v = traffic.spawnAt(s.x, s.z, s.h, 'duck', 0xf2c230, 'apron');
      v.vLong = 0;
      this.ducks.push(v);
    }
  }

  _buildRamp() {
    // A concrete launch ramp from the street down the bank and 26 m into the
    // lake: laid on the ground (a DUKW drives the bank itself), and signed.
    const { scene, world } = this.o;
    const r = RAMP, px = -r.dz, pz = r.dx;
    const pos = [], idx = [], col = [];
    const N = 22;
    for (let i = 0; i <= N; i++) {
      const t = -10 + i * 36 / N;
      for (const s of [-3.4, 3.4]) {
        const x = r.x + r.dx * t + px * s, z = r.z + r.dz * t + pz * s;
        pos.push(x, G.terrainHeight(x, z) + 0.06, z);
        const g = 0.58 + ((i % 3) === 0 ? -0.05 : 0);
        col.push(g, g * 0.98, g * 0.94);
      }
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    m.name = 'duckRamp';
    m.receiveShadow = true;
    scene.add(m);
    this.rampTop = { x: r.x - r.dx * 12, z: r.z - r.dz * 12 };
    this.rampWater = { x: r.x + r.dx * 28, z: r.z + r.dz * 28 };
    void world;
  }

  _stops() {
    const slu = G.toWorld(47.6245, -122.3385);
    this.route = [
      { id: 'slu', name: 'Westlake & Mercer', x: slu[0], z: slu[1], r: 22 },
      { id: 'ramp', name: 'the Lake Union ramp', x: this.rampTop.x, z: this.rampTop.z, r: 14 },
      { id: 'splash', name: 'SPLASHDOWN', x: this.rampWater.x, z: this.rampWater.z, r: 16, water: true },
      { id: 'seaplanes', name: 'the seaplane lane', x: 80, z: -2500, r: 30, water: true },
      { id: 'houseboats', name: 'the Eastlake houseboats', x: 600, z: -2800, r: 30, water: true },
      { id: 'gasworks', name: 'Gas Works Park', x: 300, z: -3600, r: 34, water: true },
      { id: 'climb', name: 'back up the ramp', x: this.rampTop.x, z: this.rampTop.z, r: 14, land: true },
      { id: 'home', name: 'Seattle Center', x: KIOSK[0], z: KIOSK[1], r: 18 },
    ];
  }

  // --- the kiosk -------------------------------------------------------------------------------

  near(pl) { return Math.hypot(pl.x - this.door.x, pl.z - this.door.z) < 4 && Math.abs(pl.y - this.door.y) < 3; }

  /** ENTER at the kiosk: take the nearest duck (a new one if both are gone) and start the tour. */
  start() {
    const { traffic, player, hud } = this.o;
    let v = null, bd = 60;
    for (const d of this.ducks) if (!d.dead && traffic.cars.includes(d)) { const dd = Math.hypot(d.x - this.door.x, d.z - this.door.z); if (dd < bd) { bd = dd; v = d; } }
    if (!v) {
      const s = this.lot[0];
      v = traffic.spawnAt(s.x, s.z, s.h, 'duck', 0xf2c230, 'apron');
      this.ducks.push(v);
    }
    player.enterVehicle(v);
    this.tour = { v, i: 0, t: 0, tips: 0, quacks: 0, off: 0, splashed: false, peds: new Set(), said: new Set() };
    this.prevObjective = hud.objective ? hud.objective.textContent : '';
    this.say('start');
    return true;
  }

  say(id) {
    const t = this.tour;
    if (t) { if (t.said.has(id)) return; t.said.add(id); }
    this.cap.innerHTML = `<b>CAPTAIN:</b> ${LINES[id]}`;
    this.cap.classList.add('show');
    this.capT = Math.max(4.5, LINES[id].length / 16);
  }

  /** The horn, in a duck: the quackers. Called by main.js's onHorn. */
  quack(v) {
    const { audio, game } = this.o;
    const ctx = audio && audio.ctx;
    if (ctx && audio.live) {
      // a chorus: five quackers, each a reedy sawtooth falling through a formant
      const out = audio.master || ctx.destination;
      for (let k = 0; k < 5; k++) {
        const t0 = ctx.currentTime + 0.01 + k * (0.05 + Math.random() * 0.07);
        const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'sawtooth';
        const f0 = 620 + Math.random() * 260;
        o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f0 * 0.68, t0 + 0.2);
        f.type = 'bandpass'; f.frequency.value = 1300 + Math.random() * 400; f.Q.value = 3;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
        o.connect(f).connect(g).connect(out); o.start(t0); o.stop(t0 + 0.26);
      }
    }
    const t = this.tour;
    if (!t || t.v !== v) return;
    t.quacks++;
    // people on the pavement within 30 m tip, once each
    let n = 0;
    const peds = this.o.peds;
    if (peds && peds.peds) {
      for (const p of peds.peds) {
        if (t.peds.has(p) || !p.group || !p.group.visible) continue;
        if (Math.hypot(p.x - v.x, p.z - v.z) < 30) { t.peds.add(p); n++; }
      }
    }
    if (n) {
      const tip = Math.min(n * 2, Math.max(0, 80 - t.tips));
      if (tip > 0) { t.tips += tip; this.o.hud.showToast(`Quack! ${n} ${n === 1 ? 'person waves' : 'people wave'} — +$${tip} in tips`, 1600); }
    }
    void game;
  }

  // --- the frame ------------------------------------------------------------------------------

  update(dt) {
    const { player, hud, game, fx, audio } = this.o;
    const pv = player.vehicle;
    // the splash, for any duck you drive in (tour or not)
    if (pv && pv.spec.amphib && pv.splashed) {
      pv.splashed = false;
      if (fx && fx.droplets) for (let k = 0; k < 6; k++) fx.droplets(pv.x + (Math.random() - 0.5) * 4, pv.y + DUCK_DRAFT, pv.z + (Math.random() - 0.5) * 6, 14);
      if (audio && audio.play) audio.play('splash', { gain: 0.8, rate: 0.7, x: pv.x, y: pv.y, z: pv.z });
      if (this.tour && this.tour.v === pv && !this.tour.splashed) { this.tour.splashed = true; this.say('splash'); hud.showToast('SPLASHDOWN! +$25', 1800); }
    }
    if (this.capT > 0) { this.capT -= dt; if (this.capT <= 0) this.cap.classList.remove('show'); }
    const t = this.tour;
    if (!t) return;
    t.t += dt;
    const v = t.v;
    if (v.dead || pv !== v) {
      t.off += dt;
      if (v.dead || t.off > 20) { this._end(false); return; }
    } else t.off = 0;
    // landmark lines on the way
    const nd = this.o.needle;
    if (nd && Math.hypot(v.x - nd.x, v.z - nd.z) < 260) this.say('needle');
    else if (t.said.has('needle') && t.t > 14) this.say('monorail');
    // the next stop
    const s = this.route[t.i];
    const d = Math.hypot(v.x - s.x, v.z - s.z);
    const ok = d < s.r && (!s.water || v.afloat) && (!s.land || !v.afloat);
    if (ok) {
      this.say(s.id === 'splash' ? 'splash' : s.id);
      if (s.id === 'ramp') this.say('ramp');
      t.i++;
      audio && audio.play && audio.play('pickup', { gain: 0.5 });
      if (t.i >= this.route.length) { this._end(true); return; }
    }
    const n = this.route[t.i];
    game.tourTarget = { x: n.x, z: n.z };
    const gy = n.water ? (this.o.world.waterLevelAt(n.x, n.z) || 0) : this.o.city.groundAt(n.x, n.z, null);
    this.beacon.position.set(n.x, gy + 10, n.z);
    this.beacon.visible = true;
    this.beacon.rotation.y += dt * 0.6;
    const dd = Math.hypot(v.x - n.x, v.z - n.z);
    hud.setObjective(this._objTxt = `Duck Tour ${t.i + 1}/${this.route.length}: ${n.name} — ${dd > 1000 ? (dd / 1000).toFixed(1) + ' km' : Math.round(dd) + ' m'} · tips $${t.tips}`);
  }

  _end(done) {
    const t = this.tour, { hud, game } = this.o;
    this.tour = null;
    this.beacon.visible = false;
    game.tourTarget = null;
    // (only if the line is still ours: a delivery may have written its own since)
    if (!this._objTxt || (hud.objective && hud.objective.textContent === this._objTxt)) hud.setObjective(this.prevObjective || '');
    this._objTxt = '';
    if (done) {
      this.say('home');
      const pay = 150 + (t.splashed ? 25 : 0) + t.tips;
      if (this.o.onReward) this.o.onReward(pay, t);
    } else hud.showToast('The Duck Tour is off — the passengers want their money back', 2600);
  }
}

const DUCK_DRAFT = 1.28;
