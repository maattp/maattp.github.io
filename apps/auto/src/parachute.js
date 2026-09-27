// PARACHUTES: get out of an aircraft in the air -- a plane, the helicopter,
// the balloon, anything more than 12 m up -- and you jump.
//
// FREE FALL: gravity against quadratic drag (terminal ~55 m/s, belly to
// earth); you leave with the aircraft's speed and the drag takes it off in a
// few seconds. The stick TRACKS you across the sky, camera-relative, at up to
// ~14 m/s. JUMP (Space / A) opens the canopy; so does its automatic opener at
// 60 m over the ground, since nobody wants to find the pavement at 55 m/s.
//
// UNDER THE CANOPY: a nine-cell ram-air wing overhead on its lines. It flies
// forward at ~10 m/s and sinks at ~5; the stick's left and right turn it,
// forward dives it (faster, steeper), back flares it (slow, flat). Touch down
// under canopy and you walk away; into water and a boat fishes you out onto
// the nearest shore. Free fall into the ground is what you would expect.
//
// Player owns `sky` while it is in the air (player.js exitVehicle starts it,
// updateFoot hands the frame to it).

import * as THREE from './three.js';
import * as G from './geo.js';

const G0 = 9.8, TERMINAL = 55, K_FREE = G0 / (TERMINAL * TERMINAL);
const AUTO_OPEN = 60, OPEN_T = 1.3;
const FLY = 10, SINK = 5;

let canopy = null, hud = null;

/** The canopy: nine cells round an arc, and its lines -- two draws, built once. */
function buildCanopy(scene) {
  const g = new THREE.Group();
  const pos = [], col = [], idx = [];
  const cols = [[0.86, 0.16, 0.14], [0.96, 0.96, 0.94], [0.12, 0.32, 0.72]];
  const N = 9, R = 5.2, SPAN = 1.0;
  const box = (cx, cy, cz, ang, w, h, d, c) => {
    const b = pos.length / 3, cs = Math.cos(ang), sn = Math.sin(ang);
    for (const [px, py, pz] of [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) {
      const lx = px * w / 2, ly = py * h / 2;
      pos.push(cx + lx * cs - ly * sn, cy + lx * sn + ly * cs, cz + pz * d / 2);
      const sh = py > 0 ? 1 : 0.7; col.push(c[0] * sh, c[1] * sh, c[2] * sh);
    }
    for (const f of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) idx.push(b + f[0], b + f[1], b + f[2], b + f[0], b + f[2], b + f[3]);
  };
  const lines = [];
  for (let i = 0; i < N; i++) {
    const a = (i - (N - 1) / 2) * SPAN / R;                 // angle round the arc
    const x = Math.sin(a) * R, y = Math.cos(a) * R - R + 6.4;
    box(x, y, 0, -a, SPAN * 1.02, 0.34, 3.1, cols[i % 3]);
    // the ribs' front and back, a line from each to the harness
    for (const z of [1.3, -1.3]) lines.push(x * 0.97, y - 0.2, z, 0, 1.5, z > 0 ? 0.12 : -0.12);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const wing = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }));
  wing.castShadow = true;
  g.add(wing);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x222222 })));
  g.visible = false;
  g.name = 'parachute';
  scene.add(g);
  g.userData.wing = wing;
  return g;
}

function buildHud() {
  const d = document.createElement('div');
  d.id = 'skyHud';
  const st = document.createElement('style');
  st.textContent = `#skyHud { position: absolute; top: 18%; left: 50%; transform: translateX(-50%); z-index: 12; pointer-events: none; text-align: center; display: none;
    font: 900 15px -apple-system, Helvetica, sans-serif; color: #fff; text-shadow: 0 2px 0 #0009; }
    #skyHud.show { display: block; } #skyHud b { font-size: 34px; display: block; } #skyHud i { font-style: normal; opacity: .9; font-size: 13px; }`;
  document.head.appendChild(st);
  document.getElementById('app').appendChild(d);
  return d;
}

export class Skydive {
  /** from: the aircraft left behind (for its velocity). */
  constructor(player, from, scene) {
    if (!canopy) canopy = buildCanopy(scene);
    if (!hud) hud = buildHud();
    const f = from.forward;
    this.vx = f.x * from.vLong + f.z * (from.vLat || 0);
    this.vz = f.z * from.vLong - f.x * (from.vLat || 0);
    this.vy = Math.min(from.vy || 0, 4);
    this.state = 'free';            // free | opening | canopy | water
    this.t = 0;
    this.openT = 0;
    this.heading = from.heading;
    this.prevCam = player.camShort;
    player.camShort = 9;
    hud.classList.add('show');
  }

  /** The frame, while in the air. Returns false once back on the ground (player drops `sky`). */
  update(p, dt, input) {
    this.t += dt;
    const ground = p.city.groundAt(p.x, p.z, p.y + 1);
    const agl = p.y - ground;
    const wl = p.world.waterLevelAt(p.x, p.z);
    const overWater = wl !== null && G.isWater(p.x, p.z) && wl > ground;
    const floor = overWater ? wl : ground;
    if (this.state === 'water') {
      // in the water: wait for the boat, then onto the nearest dry land
      p.y = wl - 0.8;
      if (this.t > 1.6) { this._ashore(p); return this._done(p, 0); }
      this._pose(p, dt);
      return true;
    }
    const jump = !!input.jump;
    if (this.state === 'free' && ((jump && !this._jumpHeld && this.t > 0.4) || p.y - floor < AUTO_OPEN)) { this.state = 'opening'; this.openT = 0; if (p.game.onChute) p.game.onChute(); }
    this._jumpHeld = jump;
    if (this.state === 'free') {
      const v = Math.hypot(this.vx, this.vy, this.vz);
      this.vx -= K_FREE * v * this.vx * dt; this.vz -= K_FREE * v * this.vz * dt;
      this.vy += (-G0 - K_FREE * v * this.vy) * dt;
      // tracking: the stick, camera-relative
      const m = Math.hypot(input.x, input.y);
      if (m > 0.15) {
        const ang = Math.atan2(-input.x, -input.y) + p.camYaw + Math.PI;
        this.vx += Math.sin(ang) * 6 * Math.min(1, m) * dt; this.vz += Math.cos(ang) * 6 * Math.min(1, m) * dt;
        const h = Math.hypot(this.vx, this.vz);
        if (h > 14 && h > Math.hypot(this.vx - Math.sin(ang), this.vz - Math.cos(ang))) { this.vx *= 14 / h; this.vz *= 14 / h; }
        this.heading = ang;
      } else if (Math.hypot(this.vx, this.vz) > 2) this.heading = Math.atan2(this.vx, this.vz);
    } else {
      if (this.state === 'opening') { this.openT += dt; if (this.openT >= OPEN_T) this.state = 'canopy'; }
      // under the wing: steer, dive, flare
      const k = this.state === 'opening' ? this.openT / OPEN_T : 1;
      this.heading -= (input.x || 0) * 1.1 * dt * k;
      const dive = Math.max(0, -(input.y || 0)), flare = Math.max(0, input.y || 0);
      const fwd = FLY * (1 + 0.45 * dive - 0.55 * flare), sink = SINK * (1 + 0.5 * dive - 0.55 * flare);
      const rate = this.state === 'opening' ? 2.4 : 1.6;
      const tx = Math.sin(this.heading) * fwd, tz = Math.cos(this.heading) * fwd;
      this.vx += (tx - this.vx) * Math.min(1, rate * dt); this.vz += (tz - this.vz) * Math.min(1, rate * dt);
      this.vy += (-sink - this.vy) * Math.min(1, rate * 1.4 * dt);
    }
    p.x = G.clampToMap(p.x + this.vx * dt); p.z = G.clampToMap(p.z + this.vz * dt); p.y += this.vy * dt;
    p.heading = this.heading;
    // the ground (or the water)
    if (p.y <= floor) {
      const impact = -this.vy;
      if (overWater) {
        p.y = wl - 0.8; this.state = 'water'; this.t = 0;
        if (p.game.onSplash) p.game.onSplash(p.x, wl, p.z, impact);
        if (impact > 30) p.game.damagePlayer(200, 'water');
        this._pose(p, dt);
        return true;
      }
      p.y = ground;
      return this._done(p, impact);
    }
    this._pose(p, dt, agl);
    return true;
  }

  _pose(p, dt, agl) {
    const g = p.h.group, open = this.state !== 'free' && this.state !== 'water';
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = this.heading;
    // belly to earth in free fall; hanging in the harness under the canopy
    const lean = this.state === 'free' ? Math.PI / 2 * 0.88 : this.state === 'water' ? 0.3 : 0.08;
    g.rotation.x += (lean - g.rotation.x) * Math.min(1, dt * 6);
    canopy.visible = open;
    if (open) {
      const k = this.state === 'opening' ? Math.min(1, 0.15 + this.openT / OPEN_T) : 1;
      canopy.position.set(p.x, p.y, p.z);
      canopy.rotation.y = this.heading;
      canopy.scale.set(k, 0.4 + 0.6 * k, 0.6 + 0.4 * k);
    }
    p.camFootY = p.y;
    if (hud) {
      const alt = agl === undefined ? 0 : Math.max(0, Math.round(agl));
      hud.innerHTML = this.state === 'free' ? `<b>${alt} m</b><i>FREE FALL · ${Math.round(Math.hypot(this.vx, this.vy, this.vz) * 3.6)} km/h · JUMP to open the chute</i>`
        : this.state === 'water' ? '<b>SPLASH</b><i>a boat is on its way</i>'
          : `<b>${alt} m</b><i>UNDER CANOPY · steer with the stick, pull back to flare</i>`;
    }
  }

  _ashore(p) {
    for (let r = 4; r < 600; r += 4) {
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        if (!G.isWater(x, z) && !p.city.onRoad(x, z, 0) && !p.blocked(x, z)) {
          p.x = x; p.z = z; p.y = p.city.groundAt(x, z, null);
          return;
        }
      }
    }
  }

  _done(p, impact) {
    canopy.visible = false;
    if (hud) hud.classList.remove('show');
    p.h.group.rotation.x = 0;
    p.camShort = this.prevCam;
    p.vy = 0; p.grounded = true; p.fellFrom = 0; p.speed = 0;
    if (this.state === 'free' && impact > 12) p.game.damagePlayer(Math.min(200, (impact - 12) ** 1.5 * 2), 'fall');
    else if (impact > 9) p.game.damagePlayer((impact - 9) * 6, 'fall');
    if (p.game.onLand) p.game.onLand(Math.min(6, impact * 0.5));
    return false;
  }
}
