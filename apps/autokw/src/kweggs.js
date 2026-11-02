// Auto KW: the Golden Goose Eggs, and the small secrets round them.
//
//   * 40 hidden GOLDEN GOOSE EGGS tucked in real places across the region (the
//     E5 bridge's underside at UW, behind the Aud, the end of a Laurel Trail
//     spur, the island in Columbia Lake, Chicopee's summit, the Spitfire's
//     tank, the Kissing Bridge...). GTA's hidden packages, made Waterloo:
//     walk or drive through one and it chimes. They are NOT on the map. Found
//     eggs are in localStorage `autokw-eggs`; the pause menu's passport shows
//     the count (main.js refreshPassport reads `count` / `total` / `hint`).
//   * Rewards at 10 / 20 / 30 / 40: cash, then the GOLDEN GOOSE GARAGE opens
//     (a lot north of Uptown Waterloo's square) with a gold Hellcat, the
//     Weenie Wagon (the hot-dog van), and at 40 a flying saucer. Cars are `apron` traffic cars
//     spawned when you come near, and never re-spawned while the one that is
//     out there lives.
//   * Three small easter eggs (`SECRETS`): the Engineering pink tie on its
//     pole; a message on a flat roof north of UW that you can only read from the air
//     (hot-air balloon, helicopter); the Kissing Bridge, where hearts rise.
//
// PHONE COST: the eggs are ONE InstancedMesh (10x7 sphere, 120 tris each) and
// ONE glow InstancedMesh (two crossed quads each), only the ones within
// RANGE metres of the camera are written into them, so 2 draws and a few
// hundred triangles however many are near. The tie, the roof message and the
// garage are 1 draw each and the garage does not exist before egg 20.
//
// Spots were snapped by tools/kw/eggprobe.mjs (clear of buildings, roads,
// water, steep ground); the probe re-checks every one and walks the player
// onto each to prove the pickup.
import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';

const KEY = 'autokw-eggs';
const RANGE = 170;           // an egg is drawn (and its glow) within this of the camera
const PICK_FOOT = 1.9;       // m, on foot
const PICK_CAR = 3.6;        // m, in anything with wheels (the egg is a pickup, not a wall)
const PICK_AIR = 6.5;        // m, in a balloon / heli / plane / saucer
const GOLD = [1.0, 0.72, 0.12];

// name: where it is, said on collection; a: the clue for the 20-egg hint
export const EGGS = [
  { id: 'e5', n: 'under the E5 bridge', x: -5276, z: -2236 },
  { id: 'dc', n: 'behind the Davis Centre', x: -5456, z: -2354 },
  { id: 'hagey', n: "Hagey Hall's back lawn", x: -5367, z: -1735 },
  { id: 'rock', n: "UW's rock garden", x: -5555, z: -2159 },
  { id: 'radio', n: 'the radio mast', x: -5807, z: -2016 },
  { id: 'island', n: 'the island in Columbia Lake', x: -6720, z: -2203 },
  { id: 'accel', n: 'behind the Accelerator Centre', x: -6003, z: -2860 },
  { id: 'laurelN', n: 'the Laurel Trail by the LRT', x: -3511, z: -1864 },
  { id: 'laurelW', n: "the Laurel Trail's far end", x: -7944, z: -5160 },
  { id: 'spur', n: 'a Laurel Trail spur', x: -7852, z: -4974 },
  { id: 'laurelS', n: 'the Laurel Trail, south', x: -3207, z: -3142 },
  { id: 'mill', n: "Waterloo Park's grist mill", x: -4130, z: -1500 },
  { id: 'eby', n: "the Eby farmstead's empty paddocks", x: -4480, z: -1700 },
  { id: 'bauer', n: 'the Bauer Lofts', x: -3542, z: -860 },
  { id: 'wci', n: 'behind WCI', x: -4459, z: -3099 },
  { id: 'conmall', n: 'the back of Conestoga Mall', x: -4300, z: -5000 },
  { id: 'pkwy', n: 'under the Conestoga Parkway', x: -4321, z: -4577 },
  { id: 'rim', n: 'RIM Park', x: -2696, z: -6364 },
  { id: 'beech', n: 'Beechwood Towers', x: -6976, z: -60 },
  { id: 'aud', n: 'behind the Aud', x: 660, z: 600 },
  { id: 'citq', n: 'Centre in the Square', x: -727, z: -306 },
  { id: 'vicpark', n: 'Victoria Park', x: -1728, z: 678 },
  { id: 'bing', n: "Bingemans' back lot", x: 1816, z: -2600 },
  { id: 'humane', n: 'the Humane Society', x: 417, z: -2030 },
  { id: 'fairview', n: 'behind Fairview', x: 3068, z: 3480 },
  { id: 'kissing', n: 'the Kissing Bridge', x: -553, z: -14873 },
  { id: 'market', n: "the St. Jacobs Farmers' Market", x: -6529, z: -6658 },
  { id: 'stjmill', n: "the St. Jacobs mill", x: -6393, z: -9852 },
  { id: 'summit', n: "Chicopee's summit", x: 4592, z: 1888 },
  { id: 'tube', n: "Chicopee's tube park", x: 4300, z: 2400 },
  { id: 'tank', n: 'the Spitfire and the tank', x: 149, z: -1073 },
  { id: 'ykf', n: 'the airport', x: 7227, z: -480 },
  { id: 'hespeler', n: 'Hespeler', x: 13462, z: 2202 },
  { id: 'preston', n: 'Preston', x: 10141, z: 7152 },
  { id: 'breslau', n: 'Breslau', x: 4873, z: -2860 },
  { id: 'huron', n: 'the Huron Natural Area', x: 2590, z: 5333 },
  { id: 'doon', n: 'the Doon Pioneer Tower', x: 4506, z: 6588 },
  { id: 'galt', n: 'downtown Galt', x: 13078, z: 10166 },
  { id: 'rare', n: 'the Rare reserve', x: 7689, z: 6333 },
  { id: 'cond', n: 'Conestoga College, Doon', x: 5719, z: 6971 },
];

// The garage: a lot north of Uptown Waterloo's square. Three slots, nose west.
export const HIDEOUT = { x: -3960, z: -1100, heading: Math.PI / 2, name: 'Golden Goose Garage' };
const SLOT = [[-9, 0], [0, 0], [11, 0]];
const REWARDS = [
  { at: 10, cash: 5000, msg: 'TEN EGGS — the Goose pays $5,000' },
  { at: 20, cash: 15000, car: { t: 'hellcat', c: 0xe6b422 }, msg: 'TWENTY EGGS — the Golden Goose Garage is open, north of Uptown Waterloo, and there is a gold Hellcat in it. Faint glints now show in the pause menu' },
  { at: 30, cash: 25000, car: { t: 'wiener', c: 0xffffff }, msg: 'THIRTY EGGS — the garage has a new resident: the Weenie Wagon' },
  { at: 40, cash: 100000, car: { t: 'saucer', c: 0xffd24a }, msg: 'ALL FORTY EGGS — the Goose has landed. A flying saucer is parked at the garage, and $100,000' },
];

// The small secrets: [key, x, z, radius, on foot only, text, cash]
export const SECRETS = {
  tie: { x: -5255, z: -2364, r: 4.5 },
  kiss: { x: -525, z: -14845, r: 22 },
  roof: { x: -5522, z: -3397 },   // the big flat roof of a Research Park building (134 x 176 m), north of campus
};

const lin = (c) => c.map((v) => Math.pow(v, 2.2));

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,236,150,1)');
  gr.addColorStop(0.25, 'rgba(255,196,60,0.55)');
  gr.addColorStop(1, 'rgba(255,170,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Eggs {
  constructor({ scene, city, world, audio, hud, game, traffic = null, fx = null }) {
    this.scene = scene; this.city = city; this.world = world; this.audio = audio; this.hud = hud;
    this.game = game; this.traffic = traffic; this.fx = fx;
    this.total = EGGS.length;
    this.spots = EGGS.map((e) => ({ ...e, y: city.groundAt(e.x, e.z, null) + 0.75, got: false }));
    this.seen = new Set();            // the small secrets already found
    this.slots = [null, null, null];  // the garage's cars
    this.garage = null;
    this.t = 0;
    this.load();

    const geo = new THREE.SphereGeometry(1, 10, 7);
    geo.scale(0.21, 0.29, 0.21);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffc22e, emissive: 0xd68a00, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.28 });
    this.egg = new THREE.InstancedMesh(geo, mat, this.total);
    this.egg.count = 0; this.egg.frustumCulled = false; this.egg.castShadow = false; this.egg.name = 'eggs';
    scene.add(this.egg);

    // the glow: two crossed upright quads, additive
    const S = 1.4;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute([-S, -S, 0, S, -S, 0, S, S, 0, -S, S, 0, 0, -S, -S, 0, -S, S, 0, S, S, 0, S, -S], 3));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2));
    gg.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    const gm = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    this.glow = new THREE.InstancedMesh(gg, gm, this.total);
    this.glow.count = 0; this.glow.frustumCulled = false; this.glow.castShadow = false; this.glow.renderOrder = 6; this.glow.name = 'eggglow';
    scene.add(this.glow);

    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1); this._ax = new THREE.Vector3(0, 1, 0);
    this.buildSecrets();
    if (this.count >= 20) this.buildGarage();
  }

  get count() { let n = 0; for (const s of this.spots) if (s.got) n++; return n; }

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || '{}');
      const got = new Set(d.g || []);
      for (const s of this.spots) s.got = got.has(s.id);
      for (const k of d.s || []) this.seen.add(k);
    } catch (e) { /* private mode / bad JSON: start fresh */ }
  }
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ g: this.spots.filter((s) => s.got).map((s) => s.id), s: [...this.seen] }));
    } catch (e) { /* private mode */ }
  }

  /** Faint clue, from 20 eggs: the nearest uncollected egg's direction and distance. */
  hint(px, pz) {
    if (this.count < 20 || this.count >= this.total) return '';
    let best = null, bd = Infinity;
    for (const s of this.spots) {
      if (s.got) continue;
      const d = Math.hypot(s.x - px, s.z - pz);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return '';
    const ang = Math.atan2(best.x - px, -(best.z - pz));   // 0 = north, clockwise
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dir = dirs[(Math.round(ang / (Math.PI / 4)) + 8) % 8];
    return `A golden glint, ${bd < 1000 ? Math.round(bd / 50) * 50 + ' m' : (bd / 1000).toFixed(1) + ' km'} ${dir}, near ${G.placeNameAt(best.x, best.z)}`;
  }

  // --- collecting ---------------------------------------------------------------

  collect(s, quiet = false) {
    if (s.got) return false;
    s.got = true;
    this.save();
    const n = this.count;
    if (!quiet) {
      if (this.audio && this.audio.ready) { this.audio.play('pickup', { gain: 1, jitter: false }); this.audio.play('cash', { gain: 0.5, jitter: false }); }
      if (this.fx) this.fx.emit(s.x, s.y, s.z, 36, { r: 1, g: 0.78, b: 0.15, size: 0.5, life: 1.1, spread: 5, vy: 2.5, grav: 1.5, jitter: 0.5 });
      if (this.hud) this.hud.showToast(`Golden egg ${n} of ${this.total} — ${s.n}`, 3200);
    }
    for (const r of REWARDS) if (r.at === n) this.reward(r, quiet);
    return true;
  }

  reward(r, quiet = false) {
    if (this.game) this.game.money += r.cash;
    if (r.car) { this.buildGarage(); }
    if (!quiet && this.hud) setTimeout(() => { this.hud.showToast(r.msg, 6500); if (this.audio && this.audio.ready) this.audio.play('cash', { gain: 0.9, jitter: false }); }, 2300);
  }

  /** The cars the player has earned, parked in the garage when it is near. */
  tendGarage(px, pz) {
    if (!this.garage || !this.traffic) return;
    if (Math.hypot(px - HIDEOUT.x, pz - HIDEOUT.z) > 320) return;
    const cars = REWARDS.filter((r) => r.car && this.count >= r.at);
    cars.forEach((r, i) => {
      const cur = this.slots[i];
      if (cur && !cur.dead) return;
      const [sx, sz] = SLOT[i];
      // slots run along the lot (north-south), nose west
      let v = null;
      try { v = this.traffic.spawnAt(HIDEOUT.x + sx * 0.0, HIDEOUT.z + sx, HIDEOUT.heading, r.car.t, r.car.c, 'apron'); } catch (e) { v = null; }
      if (v) {
        v.vLong = 0; this.slots[i] = v;
        // the Hellcat's `livery` overrides the colour passed to spawnAt (a tiger wrap, beige): paint it gold
        // on its own material, the wrap's black strokes stay
        if (r.car.t === 'hellcat' && v.bodyMat && v.bodyMat.color) v.bodyMat.color.setHex(r.car.c);
      }
    });
  }

  // --- the frame ----------------------------------------------------------------

  update(dt, player, camera) {
    this.t += dt;
    const cx = camera.position.x, cz = camera.position.z;
    let n = 0;
    const foot = player.onFoot !== false && !player.vehicle;
    const v = foot ? null : player.vehicle;
    const px = foot ? player.x : (v ? v.x : player.x), pz = foot ? player.z : (v ? v.z : player.z);
    const py = foot ? player.y : (v ? v.y : player.y);
    const air = v && v.spec && (v.spec.heli || v.spec.balloon || v.spec.plane || v.spec.saucer) && v.airborne !== false;
    const pr = foot ? PICK_FOOT : air ? PICK_AIR : PICK_CAR;
    for (const s of this.spots) {
      if (s.got) continue;
      const dx = s.x - cx, dz = s.z - cz;
      if (dx * dx + dz * dz < RANGE * RANGE) {
        const bob = Math.sin(this.t * 2 + s.x) * 0.12;
        this._p.set(s.x, s.y + bob, s.z);
        this._q.setFromAxisAngle(this._ax, this.t * 1.7 + s.z);
        this._s.setScalar(1);
        this._m.compose(this._p, this._q, this._s);
        this.egg.setMatrixAt(n, this._m);
        this._s.setScalar(1 + Math.sin(this.t * 3 + s.z) * 0.12);
        this._m.compose(this._p, this._q, this._s);
        this.glow.setMatrixAt(n, this._m);
        n++;
      }
      const ex = s.x - px, ez = s.z - pz;
      if (ex * ex + ez * ez < pr * pr && Math.abs(s.y - 0.75 - py) < (air ? 7 : 3.2)) this.collect(s);
    }
    this.egg.count = this.glow.count = n;
    this.egg.visible = this.glow.visible = n > 0;
    if (n) { this.egg.instanceMatrix.needsUpdate = true; this.glow.instanceMatrix.needsUpdate = true; }
    this.secrets(dt, player, camera, px, pz, foot);
    this.tendGarage(px, pz);
  }

  // --- the secrets --------------------------------------------------------------

  buildSecrets() {
    const c = this.city;
    // 1. the Engineering pink tie: a pole with a tie for a flag, on E5's lawn
    {
      const S = SECRETS.tie, y = c.groundAt(S.x, S.z, null);
      const B = new Builder(false);
      const POLE = lin([0.55, 0.57, 0.6]), PINK = lin([1, 0.3, 0.6]), DPINK = lin([0.85, 0.18, 0.46]);
      B.box(S.x, y, S.z, 0.14, 7.5, 0.14, 0, POLE);
      B.box(S.x, y + 7.5, S.z, 0.3, 0.3, 0.3, 0, lin(GOLD));
      // the tie: a knot and a long tapering blade, hanging from the top, two-sided
      const ty = y + 7.2, X = S.x + 0.1;
      const q = (a, b, c2, d, col) => { B.quad(a, b, c2, d, [1, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], col); B.quad(d, c2, b, a, [-1, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], col); };
      q([X, ty, S.z - 0.28], [X, ty, S.z + 0.28], [X, ty - 0.55, S.z + 0.2], [X, ty - 0.55, S.z - 0.2], DPINK);
      q([X, ty - 0.55, S.z - 0.2], [X, ty - 0.55, S.z + 0.2], [X, ty - 3.4, S.z + 0.62], [X, ty - 3.4, S.z - 0.62], PINK);
      q([X, ty - 3.4, S.z - 0.62], [X, ty - 3.4, S.z + 0.62], [X, ty - 4.5, S.z], [X, ty - 4.5, S.z], PINK);
      const m = new THREE.Mesh(B.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
      m.name = 'kw-pinktie'; m.castShadow = false;
      this.scene.add(m);
      this.tie = m;
    }
    // 2. the roof message, read only from the air
    {
      const cv = document.createElement('canvas');
      cv.width = 1024; cv.height = 256;
      const g = cv.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 1024, 256);
      g.fillStyle = '#f7d046'; g.font = 'bold 112px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = '#1b1b1b'; g.lineWidth = 14; g.lineJoin = 'round';
      g.strokeText('THE GEESE KNOW', 512, 128); g.fillText('THE GEESE KNOW', 512, 128);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const S = SECRETS.roof;
      const roof = c.roofUnder(S.x, S.z, 400, 0.5);
      const ry = isFinite(roof) ? roof : c.groundAt(S.x, S.z, null);
      this.roofY = ry;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(52, 13), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = 0.2;
      m.position.set(S.x, ry + 0.25, S.z); m.renderOrder = 5; m.visible = false; m.name = 'kw-roofmsg';
      this.scene.add(m);
      this.roof = m;
    }
  }

  secrets(dt, player, camera, px, pz, foot) {
    // the roof reads only from altitude
    if (this.roof) {
      const near = Math.abs(camera.position.x - SECRETS.roof.x) < 900 && Math.abs(camera.position.z - SECRETS.roof.z) < 900;
      this.roof.visible = near && camera.position.y - this.roofY > 70;
    }
    const T = SECRETS.tie;
    if (foot && !this.seen.has('tie') && Math.hypot(px - T.x, pz - T.z) < T.r) {
      this.seen.add('tie'); this.save();
      this.game.money += 250;
      if (this.audio && this.audio.ready) this.audio.play('pickup', { gain: 0.8 });
      if (this.hud) this.hud.showToast('The pink tie: every Waterloo engineer earns one. Tool Night is on you — +$250', 5200);
    }
    const K = SECRETS.kiss;
    const near = Math.hypot(px - K.x, pz - K.z) < K.r;
    if (near) {
      this.kissT = (this.kissT || 0) + dt;
      if (this.fx && Math.random() < dt * 2.2) this.fx.emit(K.x + (Math.random() - 0.5) * 6, this.city.groundAt(K.x, K.z, null) + 1.2, K.z + (Math.random() - 0.5) * 6, 3, { r: 1, g: 0.35, b: 0.55, size: 0.7, life: 2.2, spread: 0.8, vy: 1.4, grav: -0.1, jitter: 0.4 });
      if (this.kissT > 1.2 && !this.kissed) {
        this.kissed = true;
        if (this.hud) this.hud.showToast('The Kissing Bridge, West Montrose, 1881. Tradition says you steal a kiss going through', 5200);
        if (!this.seen.has('kiss')) { this.seen.add('kiss'); this.save(); }
      }
    } else { this.kissT = 0; this.kissed = false; }
  }

  // --- the garage ---------------------------------------------------------------

  buildGarage() {
    if (this.garage) return;
    const H = HIDEOUT, c = this.city;
    // the lot's parked cars keep off the slab (a blue SUV overlapped its corner)
    if (this.traffic && this.traffic.keepClear && !this.traffic.keepClear.some((k) => k[0] === H.x && k[1] === H.z)) this.traffic.keepClear.push([H.x, H.z, 24]);
    // ...and any already parked there (built at egg 20, with the lot already stocked) are towed
    if (this.traffic && this.traffic.cars && this.traffic.remove) {
      for (const v of this.traffic.cars.slice()) if (v.mode === 'parked' && Math.abs(v.x - H.x) < 9 && Math.abs(v.z - H.z) < 18) this.traffic.remove(v);
    }
    const y = c.groundAt(H.x, H.z, null) + 0.04;
    const B = new Builder(false);
    const ASPH = lin([0.16, 0.16, 0.18]), LINE = lin(GOLD), POST = lin([0.12, 0.12, 0.13]);
    // the slab (runs north-south: the cars park nose west, side by side along z)
    B.box(H.x, y, H.z, 12, 0.1, 30, 0, ASPH);
    for (const dz of [-14.5, -4.5, 4.5, 14.5]) B.box(H.x, y + 0.1, H.z + dz, 11, 0.02, 0.18, 0, LINE);
    B.box(H.x - 6.2, y, H.z, 0.3, 4.8, 0.3, 0, POST);
    B.box(H.x - 6.2, y, H.z - 14.8, 0.3, 4.8, 0.3, 0, POST);
    const geo = B.build();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    mesh.name = 'kw-goosegarage'; mesh.receiveShadow = true;
    // the sign
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 192;
    const g = cv.getContext('2d');
    g.fillStyle = '#16161a'; g.fillRect(0, 0, 1024, 192);
    g.strokeStyle = '#f7c531'; g.lineWidth = 10; g.strokeRect(8, 8, 1008, 176);
    g.fillStyle = '#f7c531'; g.font = 'bold 78px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('GOLDEN GOOSE GARAGE', 512, 100);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(14.8, 2.775), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
    sign.rotation.y = Math.PI / 2; sign.position.set(H.x - 6.2, y + 5.4, H.z - 7.4);
    const back = new THREE.Mesh(sign.geometry, sign.material.clone());
    back.material.side = THREE.FrontSide; sign.material.side = THREE.FrontSide;
    back.rotation.y = -Math.PI / 2; back.position.set(H.x - 6.2 - 0.05, y + 5.4, H.z - 7.4);
    sign.position.x += 0.05;
    const grp = new THREE.Group();
    grp.add(mesh, sign, back);
    this.scene.add(grp);
    this.garage = grp;
  }
}
