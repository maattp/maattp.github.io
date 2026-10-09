// Seattle Fire: the stations' rigs, the water cannon, and fire calls.
//
// A pumper or a tiller stands on the apron of a dozen real Seattle Fire
// stations (OSM amenity=fire_station), taken like any parked vehicle. In one,
// WATER (V, pad RB) runs the deck gun where the camera looks, and MISSION (M)
// starts a fire call: a real building a few hundred metres to a kilometre and
// a half away bursts into flames, its smoke and a beacon show the way, and
// putting every flame out before the clock runs down pays and dispatches the
// next one, harder. MISSION again stands the crew down.
//
// Everything drawn here is pooled and made at boot: the water, the flames and
// the smoke are one Points draw each (only while anything is alive), the
// beacon one, the flashing lights one. `warmMeshes()` hands them to main.js's
// warm-up so nothing compiles mid-play (CLAUDE.md "Hitches").

import * as THREE from './three.js';
import * as G from './geo.js';
import { FIRE_MONITOR } from './vehicles.js';
import { clamp, dist2, formatMoney } from './util.js';

// Real stations (OSM positions, tools/data/raw_pois.json) and what stands on
// each apron. Fireboats (Station 5's) are out of scope: it gets an engine.
export const FIRE_STATIONS = [
  { name: 'Station 2 · Belltown', x: -508.3, z: -534.3, rigs: ['tiller', 'fireengine'] },
  { name: 'Station 5 · Waterfront', x: -65.7, z: 852.8, rigs: ['fireengine'] },
  { name: 'Station 10 · Pioneer Square', x: 702.3, z: 1125.2, rigs: ['tiller', 'fireengine'] },
  { name: 'Station 25 · Capitol Hill', x: 1708.4, z: -475.7, rigs: ['tiller', 'fireengine'] },
  { name: 'Station 8 · Queen Anne', x: -1288.9, z: -2203.3, rigs: ['fireengine'] },
  { name: 'Station 22 · Roanoke', x: 1265.3, z: -3518.8, rigs: ['fireengine'] },
  { name: 'Station 17 · University District', x: 1596.1, z: -5997.7, rigs: ['tiller', 'fireengine'] },
  { name: 'Station 18 · Ballard', x: -2968.6, z: -6342.9, rigs: ['tiller', 'fireengine'] },
  { name: 'Station 20 · Interbay', x: -2851.7, z: -3748.7, rigs: ['fireengine'] },
  { name: 'Station 6 · Central District', x: 3014.0, z: 1375.9, rigs: ['fireengine'] },
  { name: 'Station 14 · SoDo', x: 703.1, z: 4081.1, rigs: ['tiller', 'fireengine'] },
  { name: 'Station 32 · West Seattle', x: -3142.5, z: 5620.2, rigs: ['fireengine'] },
];
export const FIRE_RED = 0xb3121b;

// A rig's footprint about its (tractor's) centre: metres ahead, behind, half-width.
const RIG = {
  fireengine: { front: 5.0, back: 5.0, hw: 1.25 },
  // the tiller straight: tractor nose to the ladder's tip over the tail
  tiller: { front: 3.45, back: 1.75 + 5.55 + 6.5 + 0.75, hw: 1.25 },
};

/**
 * Where each rig stands: on the station's apron, between the street and the
 * station, OFF the carriageway, out of every building, dry, clear of ramps,
 * tracks and landmarks, on ground no steeper than a rig parks on. Nose-out
 * (backed into the bay, facing the street) where the setback is deep enough;
 * otherwise parallel along the front, on the pavement. Each spot is pushed as
 * a clear circle, so no tree, post or kerbside car is ever set in it.
 */
export function placeStations(city, world, waterAt) {
  const out = [];
  const wet = (x, z) => {
    if (G.isWater(x, z)) return true;
    if (!waterAt) return false;
    const w = waterAt(x, z);
    return w !== null && w > G.terrainHeight(x, z) + 0.05;
  };
  for (const st of FIRE_STATIONS) {
    const bl = city.buildingsNear(st.x, st.z, 140);
    const inB = (x, z, pad) => {
      for (const b of bl) {
        const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
        if (Math.abs(dx * c - dz * s) < b.w / 2 + pad && Math.abs(dx * s + dz * c) < b.d / 2 + pad) return true;
      }
      return false;
    };
    const eds = city.edgesNear(st.x, st.z, 90).map((ei) => {
      const e = city.edges[ei];
      if (e.elev || e.tunnel || e.noTraffic || e.cls === 'hwy' || e.cls === 'ramp') return null;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const t = clamp((st.x - a.x) * e.dx + (st.z - a.z) * e.dz, 0, e.len);
      const px = a.x + e.dx * t, pz = a.z + e.dz * t;
      let nx = -e.dz, nz = e.dx;
      if ((st.x - px) * nx + (st.z - pz) * nz < 0) { nx = -nx; nz = -nz; }
      return { e, a, b, t, px, pz, nx, nz, d: Math.hypot(st.x - px, st.z - pz) };
    }).filter(Boolean).sort((p, q) => p.d - q.d).slice(0, 4);
    const taken = [];
    const spots = [];
    for (const type of st.rigs) {
      const R = RIG[type];
      const clear = (x, z, h) => {
        const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
        let lo = Infinity, hi = -Infinity;
        for (let u = -R.back - 0.4; u <= R.front + 0.41; u += 1.4) {
          for (const v of [-R.hw - 0.35, 0, R.hw + 0.35]) {
            const px = x + fx * u + rx * v, pz = z + fz * u + rz * v;
            for (const t of taken) {
              const ox = px - t.x, oz = pz - t.z, tu = ox * Math.sin(t.h) + oz * Math.cos(t.h), tv = ox * Math.cos(t.h) - oz * Math.sin(t.h);
              if (tu > -t.back - 1 && tu < t.front + 1 && Math.abs(tv) < t.hw + 1) return false;
            }
            if (city.onRoad(px, pz, 0.3, true, false)) return false;
            if (inB(px, pz, 0.45)) return false;
            if (city.jumpClear(px, pz) || wet(px, pz)) return false;
            if (city.landmarkHit && city.landmarkHit(px, pz, 0.6, G.terrainHeight(px, pz) + 1, true)) return false;
            if (city.barrierHit && city.barrierHit(px, pz, 0.6, G.terrainHeight(px, pz) + 1)) return false;
            const y = G.terrainHeight(px, pz);
            lo = Math.min(lo, y); hi = Math.max(hi, y);
          }
        }
        return hi - lo < (R.back > 8 ? 2.6 : 1.8);
      };
      let best = null;
      for (const c of eds) {
        const e = c.e;
        for (let along = -18; along <= 18; along += 3) {
          const t = c.t + along;
          if (t < 0 || t > e.len) continue;
          const qx = c.a.x + e.dx * t, qz = c.a.z + e.dz * t;
          const poses = [];
          // nose-out: backed into the bay, facing the street, the nose clear of the kerb
          const off = e.hw + 1.4 + R.front;
          poses.push({ x: qx + c.nx * off, z: qz + c.nz * off, h: Math.atan2(-c.nx, -c.nz), pen: 0 });
          // parallel along the front, either way round
          const offP = e.hw + 0.7 + R.hw;
          for (const sg of [1, -1]) {
            // (centred so the whole rig, not its tractor, is opposite the spot)
            const mid = (R.front - R.back) / 2;
            poses.push({ x: qx + c.nx * offP - e.dx * sg * mid, z: qz + c.nz * offP - e.dz * sg * mid, h: Math.atan2(e.dx * sg, e.dz * sg), pen: 6 + (sg < 0 ? 0.5 : 0) });
          }
          for (const p of poses) {
            const score = Math.hypot(p.x - st.x, p.z - st.z) + p.pen + c.d * 0.2;
            if (best && score >= best.score) continue;
            if (!clear(p.x, p.z, p.h)) continue;
            best = { ...p, score };
          }
        }
      }
      if (!best) continue;
      taken.push({ x: best.x, z: best.z, h: best.h, ...R });
      spots.push({ type, x: best.x, z: best.z, heading: best.h });
    }
    for (const t of taken) {
      // the clear circle: the rig's own length round its middle
      const mid = (t.front - t.back) / 2;
      const cx = t.x + Math.sin(t.h) * mid, cz = t.z + Math.cos(t.h) * mid;
      if (!city.clearCircles) city.clearCircles = [];
      city.clearCircles.push([cx, cz, (t.front + t.back) / 2 + 1.5]);
    }
    out.push({ ...st, spots });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Particles: one Points draw per pool, size and alpha per particle.
// ---------------------------------------------------------------------------
const P_VERT = `
attribute vec4 rgba;
attribute float size;
uniform float uScale;
varying vec4 vC;
void main() {
  vC = rgba;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_PointSize = min( size * uScale / max( 0.5, -mv.z ), 380.0 );
  gl_Position = projectionMatrix * mv;
}`;
const P_FRAG = `
uniform sampler2D map;
uniform float uAdd;
varying vec4 vC;
void main() {
  float a = texture2D( map, gl_PointCoord ).a * vC.a;
  if ( a < 0.004 ) discard;
  gl_FragColor = uAdd > 0.5 ? vec4( vC.rgb * a, a ) : vec4( vC.rgb, a );
}`;

class Pool {
  constructor(n, tex, additive) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('rgba', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uScale: { value: 400 }, uAdd: { value: additive ? 1 : 0 } },
      vertexShader: P_VERT, fragmentShader: P_FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = additive ? 8 : 7;
    // per particle: x y z vx vy vz life max s0 s1 r g b a0 a1 grav (drag is per pool: update())
    this.S = 16;
    this.d = new Float32Array(n * this.S);
    this.head = 0;
    this.alive = 0;
    this.fresh = false;   // emitted since the last update
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a0, a1, grav) {
    const k = this.head * this.S, d = this.d;
    this.head = (this.head + 1) % this.n;
    this.fresh = true;
    d[k] = x; d[k + 1] = y; d[k + 2] = z; d[k + 3] = vx; d[k + 4] = vy; d[k + 5] = vz;
    d[k + 6] = life; d[k + 7] = life; d[k + 8] = s0; d[k + 9] = s1;
    d[k + 10] = r; d[k + 11] = g; d[k + 12] = b; d[k + 13] = a0; d[k + 14] = a1; d[k + 15] = grav;
  }
  update(dt, drag = 0) {
    // nothing alive and nothing new: nothing to step (and no upload)
    if (!this.alive && !this.fresh && !this._was) return;
    this.fresh = false;
    const d = this.d, S = this.S, pos = this.pos, col = this.col, size = this.size;
    let alive = 0;
    const damp = drag ? Math.exp(-drag * dt) : 1;
    for (let i = 0; i < this.n; i++) {
      const k = i * S;
      if (d[k + 6] <= 0) { size[i] = 0; col[i * 4 + 3] = 0; continue; }
      d[k + 6] -= dt;
      d[k + 4] += d[k + 15] * dt;
      d[k + 3] *= damp; d[k + 5] *= damp;
      d[k] += d[k + 3] * dt; d[k + 1] += d[k + 4] * dt; d[k + 2] += d[k + 5] * dt;
      const t = 1 - Math.max(0, d[k + 6]) / d[k + 7];
      pos[i * 3] = d[k]; pos[i * 3 + 1] = d[k + 1]; pos[i * 3 + 2] = d[k + 2];
      size[i] = d[k + 8] + (d[k + 9] - d[k + 8]) * t;
      col[i * 4] = d[k + 10]; col[i * 4 + 1] = d[k + 11]; col[i * 4 + 2] = d[k + 12];
      // fade in over the first tenth, then to a1
      col[i * 4 + 3] = (d[k + 13] + (d[k + 14] - d[k + 13]) * t) * Math.min(1, t * 10);
      if (d[k + 6] > 0) alive++;
    }
    this.alive = alive;
    this.mesh.visible = alive > 0;
    if (alive || this._was) {
      const g = this.mesh.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.rgba.needsUpdate = true;
      g.attributes.size.needsUpdate = true;
    }
    this._was = alive > 0;
  }
}

// The flashing heads on a rig's light bar while its siren runs: two boxes,
// shown alternately (one draw). Shared geometry and material.
let LIGHTS = null;
function lightsKit() {
  if (LIGHTS) return LIGHTS;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
  const mk = (x) => {
    const g = new THREE.BoxGeometry(0.62, 0.15, 0.30);
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = 3.2; c[i + 1] = 0.25; c[i + 2] = 0.2; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.translate(x, 0, 0);
    return g;
  };
  LIGHTS = { mat, gL: mk(-0.55), gR: mk(0.55) };
  return LIGHTS;
}

const V0 = 32;         // the deck gun's muzzle speed, m/s (about 100 m of reach)
const GRAV = 9.81;
const ASSIST = 0.32;   // radians off the camera's aim within which it locks onto a flame

export class FireService {
  /**
   * o: { scene, city, world, traffic, peds, game, hud, audio, fx, controls, tex,
   *      player (getter), camera (getter) }
   */
  constructor(o) {
    this.o = o;
    const { scene, tex } = o;
    this.water = new Pool(o.phone ? 220 : 340, tex, false);
    this.flame = new Pool(o.phone ? 300 : 520, tex, true);
    this.smoke = new Pool(o.phone ? 180 : 300, tex, false);
    scene.add(this.water.mesh, this.flame.mesh, this.smoke.mesh);
    // the beacon over a burning building, seen from across the city
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 160, 16, 1, true).translate(0, 80, 0),
      new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true }));
    this.beacon.visible = false;
    this.beacon.frustumCulled = false;
    scene.add(this.beacon);
    this.stations = [];
    this.fires = [];          // the call's buildings: { b, flames: [{x, y, z, hp, nx, nz}] }
    this.call = null;         // { k, t, T, reward, at: {x, z}, name }
    this.level = 0;
    this.spraying = false;
    this.sprayT = 0;          // emission accumulator
    this.forceSpray = false;  // harnesses
    this.aimOverride = null;  // harnesses: { yaw, pitch }
    this.aim = { yaw: 0, pitch: 0.2, x: 0, y: 0, z: 0, hit: null, lock: null };
    this._wasMission = false;
    this._hudT = 0;
    this._objBefore = '';
    this._nextT = 0;
    this._refillT = 3;
    this._soaked = new Set();
    this.lit = null;          // the rig whose lights are flashing
    this.stats = { sprayed: 0, flamesOut: 0, calls: 0, paid: 0 };
  }

  /** Spawn every station's rigs ('apron', never despawned) and list the map places. */
  spawnRigs(stations) {
    this.stations = stations;
    const T = this.o.traffic;
    for (const st of stations) {
      st.rigVs = [];
      for (const sp of st.spots) {
        const v = T.spawnAt(sp.x, sp.z, sp.heading, sp.type, FIRE_RED, 'apron');
        v.vLong = 0;
        st.rigVs.push(v);
      }
    }
  }

  places() {
    return this.stations.filter((s) => s.spots.length).map((s) => {
      const sp = s.spots[0];
      return { x: sp.x, z: sp.z, kind: 'fire', name: s.name.replace(' · ', ' — '), near: false,
        hello: `Seattle Fire ${s.name.split(' · ')[0]} — ${s.spots.some((q) => q.type === 'tiller') ? 'an engine and a tiller ladder truck' : 'an engine'} on the apron. Climb in and press MISSION for a fire call` };
    });
  }

  /** The particle pools, the beacon and the lights, for main.js's warm-up frames. */
  warmMeshes(at) {
    const k = lightsKit();
    const l = new THREE.Mesh(k.gL, k.mat);
    l.position.set(0, 1.5, 3);   // (in the warm group, which stands at the player)
    const list = [this.water.mesh, this.flame.mesh, this.smoke.mesh, this.beacon];
    const was = list.map((m) => m.visible);
    for (const p of [this.water, this.flame, this.smoke]) {
      p.pos[0] = at.x; p.pos[1] = at.y + 1; p.pos[2] = at.z; p.size[0] = 1; p.col[3] = 0.01;
      const ga = p.mesh.geometry.attributes;
      ga.position.needsUpdate = ga.rgba.needsUpdate = ga.size.needsUpdate = true;
    }
    for (const m of list) m.visible = true;
    return { meshes: [l], restore: () => { list.forEach((m, i) => { m.visible = was[i]; }); } };
  }

  // --- helpers --------------------------------------------------------------

  rigOf(v) {
    if (!v) return null;
    if (v.spec.fire && v.leader) return v.leader;
    return v.spec.fire ? v : null;
  }

  /** The deck gun's muzzle in the world: the engine's, or the waterway at a tiller's aerial heel. */
  muzzle(v, out) {
    const src = v.spec.towed && v.trailer ? v.trailer : v;
    const m = FIRE_MONITOR[src.typeName] || [0, src.spec.roof + 0.3, 0];
    const c = Math.cos(src.heading), s = Math.sin(src.heading);
    out.x = src.x + m[0] * c + m[2] * s;
    out.z = src.z - m[0] * s + m[2] * c;
    out.y = src.y + m[1];
    return out;
  }

  /** The launch pitch that lands a V0 stream on (dx, dy) -- the low arc -- or null out of reach. */
  static solvePitch(dh, dy, high = false) {
    const v2 = V0 * V0, disc = v2 * v2 - GRAV * (GRAV * dh * dh + 2 * dy * v2);
    if (disc < 0 || dh < 0.5) return null;
    return Math.atan2(v2 + (high ? 1 : -1) * Math.sqrt(disc), GRAV * dh);
  }

  /**
   * March a stream launched at (vx, vy, vz) from `m` until it meets the ground
   * or a building wall: fills `this._arc` (x, y, z triples) and `this._imp`.
   */
  march(m, vx, vy, vz) {
    const city = this.o.city, step = 0.05, arc = this._arc || (this._arc = []);
    const I = this._imp || (this._imp = { t: 0, x: 0, y: 0, z: 0, kind: 'air' });
    arc.length = 0;
    I.t = 3.2; I.kind = 'air';
    for (let t = step; t <= 3.2; t += step) {
      const x = m.x + vx * t, y = m.y + vy * t - 0.5 * GRAV * t * t, z = m.z + vz * t;
      arc.push(x, y, z);
      const gy = G.terrainHeight(x, z) + 0.1;
      if (y < gy) { I.t = t; I.x = x; I.y = gy; I.z = z; I.kind = 'ground'; return I; }
      if ((arc.length / 3) % 2 === 0) {
        for (const b of city.buildingsNear(x, z, 1)) {
          const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
          if (Math.abs(dx * c - dz * s) < b.w / 2 && Math.abs(dx * s + dz * c) < b.d / 2 && y < b.y + b.h && y > b.y - 1) {
            I.t = t; I.x = x; I.y = y; I.z = z; I.kind = 'wall'; return I;
          }
        }
      }
    }
    const n = arc.length;
    I.x = arc[n - 3]; I.y = arc[n - 2]; I.z = arc[n - 1];
    return I;
  }

  // --- the frame --------------------------------------------------------------

  update(dt) {
    const o = this.o, player = o.player, v = player.vehicle, rig = this.rigOf(v);
    const c = o.controls;
    // the buttons: shown in a rig only
    const app = this._app || (this._app = document.getElementById('app'));
    const inRig = !!rig && !player.onFoot;
    if (app && (app.dataset.fire === '1') !== inRig) app.dataset.fire = inRig ? '1' : '';
    const missionDown = !!(c && (c.btn.mission || c.key('KeyM')));
    if (missionDown && !this._wasMission && inRig) {
      if (this.call || this._nextT > 0) this.standDown('Stood down');
      else this.dispatch();
    }
    this._wasMission = missionDown;
    const pad = c && c._padHeld ? c._padHeld : {};
    const want = inRig && (this.forceSpray || !!(c && (c.btn.water || c.key('KeyV') || pad.sprintAlt)));
    this.spraying = want;
    this.cannon(dt, rig);
    this.burn(dt);
    this.mission(dt, rig, inRig);
    this.siren(dt, rig, inRig);
    this.refill(dt);
    // particle scale: pixels per metre at 1 m
    const cam = o.camera;
    if (cam) {
      const h = o.renderer ? o.renderer.getDrawingBufferSize(this._sz || (this._sz = new THREE.Vector2())).y : 720;
      const sc = h / (2 * Math.tan((cam.fov * Math.PI) / 360));
      this.water.mat.uniforms.uScale.value = sc;
      this.flame.mat.uniforms.uScale.value = sc;
      this.smoke.mat.uniforms.uScale.value = sc;
    }
    this.water.update(dt, 0.25);
    this.flame.update(dt, 1.2);
    this.smoke.update(dt, 0.35);
    if (o.audio && o.audio.ready && o.audio.fireSound) {
      // the spray at the gun; the fire's roar by distance to the nearest flame
      let near = Infinity;
      const p = player.position;
      for (const f of this.fires) for (const fl of f.flames) if (fl.hp > 0) near = Math.min(near, Math.hypot(fl.x - p.x, fl.z - p.z));
      o.audio.fireSound(this.spraying ? 1 : 0, near < 140 ? clamp(1 - near / 140, 0, 1) : 0);
    }
  }

  /** The water cannon: aim, the stream's arc and what it hits, and its spray. */
  cannon(dt, rig) {
    const A = this.aim;
    if (!this.spraying || !rig) { A.hit = null; return; }
    const o = this.o, player = o.player;
    const mz = this.muzzle(rig, this._mz || (this._mz = { x: 0, y: 0, z: 0 }));
    // where the camera looks: camYaw + PI is its heading; a higher camera aims lower
    let yaw = player.camYaw + Math.PI;
    let pitch = clamp(0.22 - (player.camPitch - 0.1) * 0.55, -0.12, 0.85);
    A.lock = null;
    if (this.aimOverride) { yaw = this.aimOverride.yaw; pitch = this.aimOverride.pitch; }
    else {
      // aim assist: a burning flame within reach and near the aim takes the stream
      let best = null;
      for (const f of this.fires) for (const fl of f.flames) {
        if (fl.hp <= 0) continue;
        const dx = fl.x - mz.x, dz = fl.z - mz.z, dh = Math.hypot(dx, dz);
        if (dh > 95) continue;
        const dyaw = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw), Math.cos(Math.atan2(dx, dz) - yaw)));
        if (dyaw > ASSIST) continue;
        const pt = FireService.solvePitch(dh, fl.y - mz.y);
        if (pt === null) continue;
        if (!best || dyaw < best.dyaw) best = { dyaw, yaw: Math.atan2(dx, dz), pitch: pt, fl, dh };
      }
      if (best) {
        yaw = best.yaw; pitch = best.pitch; A.lock = best.fl;
        // the low arc blocked short of it (a kerb, a parapet, a roof edge)? lob it
        // (the same test flameSpots placed the flame by)
        if (!this.reaches(mz, best.fl, false)) {
          const hp = FireService.solvePitch(best.dh, best.fl.y - mz.y, true);
          if (hp !== null && hp < 1.35) pitch = hp;
        }
      }
    }
    A.yaw = yaw; A.pitch = pitch;
    const cp = Math.cos(pitch), dirx = Math.sin(yaw) * cp, dirz = Math.cos(yaw) * cp, diry = Math.sin(pitch);
    const f = rig.forward, carVx = f.x * rig.vLong, carVz = f.z * rig.vLong;
    const vx = dirx * V0 + carVx, vy = diry * V0, vz = dirz * V0 + carVz;
    const I = this.march(mz, vx, vy, vz), arc = this._arc;
    const tHit = I.t, hx = I.x, hy = I.y, hz = I.z, hitKind = I.kind;
    A.x = hx; A.y = hy; A.z = hz; A.hit = hitKind;
    // the stream itself, and the spray and mist where it lands
    const W = this.water, rate = o.phone ? 70 : 110;
    this.sprayT += dt * rate;
    while (this.sprayT >= 1) {
      this.sprayT -= 1;
      const j = 0.9 + Math.random() * 0.2, sp = 0.6;
      W.emit(mz.x + dirx * 0.5, mz.y + diry * 0.5, mz.z + dirz * 0.5,
        vx * j + (Math.random() - 0.5) * sp, vy * j + (Math.random() - 0.5) * sp, vz * j + (Math.random() - 0.5) * sp,
        Math.max(0.15, tHit * (0.92 + Math.random() * 0.1)), 0.32, 1.25, 0.82, 0.9, 1.0, 0.8, 0.35, -GRAV);
      if (hitKind !== 'air' && Math.random() < 0.45) {
        W.emit(hx, hy + 0.2, hz, (Math.random() - 0.5) * 4, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 4,
          0.7 + Math.random() * 0.5, 0.8, 2.6, 0.9, 0.94, 0.98, 0.55, 0, -6);
      }
    }
    this.stats.sprayed += dt;
    // what it hits: flames along the arc and round the splash
    const rad2 = 3.4 * 3.4;
    for (const fire of this.fires) {
      for (const fl of fire.flames) {
        if (fl.hp <= 0) continue;
        let hit = dist2(fl.x, fl.z, hx, hz) < 4.5 * 4.5 && Math.abs(fl.y - hy) < 5;
        for (let i = 0; i < arc.length && !hit; i += 6) {
          const dx = arc[i] - fl.x, dy = arc[i + 1] - fl.y, dz = arc[i + 2] - fl.z;
          if (dx * dx + dy * dy + dz * dz < rad2) hit = true;
        }
        if (hit) fl.wet = 0.25;
      }
    }
    // people knocked off their feet, light cars shoved, near where it lands
    if (hitKind !== 'air') {
      const peds = o.peds;
      if (peds && peds.peds) {
        for (const p of peds.peds) {
          if (p.state === 'down' || dist2(p.x, p.z, hx, hz) > 2.6 * 2.6 || Math.abs(p.y - hy) > 3) continue;
          const l = Math.hypot(dirx, dirz) || 1;
          peds.knockDown(p, { x: dirx / l, z: dirz / l }, 9);
          peds.scare(hx, hz, 20);
          if (!this._soaked.has(p)) { this._soaked.add(p); if (o.game && o.game.addHeat) o.game.addHeat(3); }
        }
      }
      for (const car of o.traffic.cars) {
        if (car === rig || car.leader === rig || car.dead || car.mass > 2.6 || car.spec.plane || car.spec.boat) continue;
        if (dist2(car.x, car.z, hx, hz) > (car.halfLen + 1.5) ** 2) continue;
        const l = Math.hypot(dirx, dirz) || 1, push = (5 / car.mass) * dt;
        const cf = car.forward;
        car.vLong += ((dirx * cf.x + dirz * cf.z) / l) * push;
        car.vLat += ((dirx * cf.z - dirz * cf.x) / l) * push * 0.6;
        if (car.mode === 'parked') car.mode = 'free';
      }
    }
  }

  // --- fires -------------------------------------------------------------------

  /**
   * Where `n` flames can burn on building `b`'s face toward the street point
   * (rx, rz): up the facade and over the roof of a low one -- and only where
   * the deck gun can put them out from that street point.
   *
   * A flame used to go wherever the face's box put it, and building boxes
   * abut and overlap along a block: a neighbour set forward of the facade
   * swallowed the flame, every stream hit the neighbour's wall first, and the
   * call could not be won (2 buildings in 60 swept; verify's call ran out its
   * 120 s with the aim locked throughout). Now each spot is tested: not inside
   * any other building, and a 32 m/s stream from a muzzle over the street
   * point and 6 m either way along it (`ei`) -- low arc, or the high one --
   * reaches it. Fallback spots across the
   * face and up it fill in for refused ones; `null` if fewer than
   * min(n, 3) are reachable, and pickBuilding passes such a building over.
   */
  flameSpots(b, rx, rz, n, ei = -1) {
    const city = this.o.city;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const dx = rx - b.x, dz = rz - b.z;
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    const alongX = Math.abs(lx) / (b.w / 2) > Math.abs(lz) / (b.d / 2);
    const sg = alongX ? Math.sign(lx) || 1 : Math.sign(lz) || 1;
    const half = alongX ? b.d / 2 : b.w / 2;
    const toW = (ax, az) => [b.x + ax * c - az * s, b.z + ax * s + az * c];
    const [nx, nz] = alongX ? [sg * c, sg * s] : [-sg * s, sg * c];
    const top = b.y + b.h;
    const at = (u, roof, lvl) => {
      const y = roof ? top + 0.6 : Math.min(top - 1.2, b.y + 2.2 + lvl * 2.6);
      const out = roof ? -1.2 : 0.6;
      const [x, z] = alongX ? toW(sg * (b.w / 2 + out), u) : toW(u, sg * (b.d / 2 + out));
      return { x, y, z, roof };
    };
    // the authored spread first, then the rest of the face, low to high
    const cand = [];
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? (-0.75 + (1.5 * i) / (n - 1)) * half : 0;
      cand.push(at(u, i % 3 === 2 && b.h < 22, (i * 7) % 4));
    }
    for (let lvl = 0; lvl < 4; lvl++) for (let j = 0; j <= 8; j++) cand.push(at((-0.85 + (1.7 * j) / 8) * half, false, lvl));
    // from the street point and 6 m either way along the street: a rig is
    // never parked on the exact spot, and its gun is a metre off its centre
    const e = ei >= 0 ? city.edges[ei] : null;
    const froms = (e ? [0, -6, 6] : [0]).map((t) => {
      const x = rx + (e ? e.dx * t : 0), z = rz + (e ? e.dz * t : 0), gy = city.groundAt(x, z, null);
      return { x, y: (gy === gy ? gy : G.terrainHeight(x, z)) + 3.3, z };
    });
    const spots = [];
    for (const q of cand) {
      if (spots.length >= n) break;
      if (spots.some((p) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 3)) continue;
      if (q.y < G.terrainHeight(q.x, q.z) + 0.8) continue;
      let buried = false;
      for (const o of city.buildingsNear(q.x, q.z, 2)) {
        if (o === b) continue;
        const oc = Math.cos(-o.rot), os = Math.sin(-o.rot), ex = q.x - o.x, ez = q.z - o.z;
        if (Math.abs(ex * oc - ez * os) < o.w / 2 + 0.4 && Math.abs(ex * os + ez * oc) < o.d / 2 + 0.4 && q.y < o.y + o.h + 1) { buried = true; break; }
      }
      if (buried || froms.some((m) => !this.reaches(m, q))) continue;
      spots.push(q);
    }
    if (spots.length < Math.min(n, 3)) return null;
    return spots.map((q) => ({ x: q.x, y: q.y, z: q.z, nx, nz }));
  }

  /**
   * Can a stream from `m` put out a flame at `q`? The wetting test cannon()
   * applies, on the low arc then the high one (`only`: just that one).
   */
  reaches(m, q, only = null) {
    const dh = Math.hypot(q.x - m.x, q.z - m.z), yaw = Math.atan2(q.x - m.x, q.z - m.z);
    if (dh > 90) return false;
    for (const high of only === null ? [false, true] : [only]) {
      const pt = FireService.solvePitch(dh, q.y - m.y, high);
      if (pt === null || pt > 1.35) continue;
      const cp = Math.cos(pt);
      const I = this.march(m, Math.sin(yaw) * cp * V0, Math.sin(pt) * V0, Math.cos(yaw) * cp * V0), arc = this._arc;
      if (Math.hypot(I.x - q.x, I.z - q.z) < 4.5 && Math.abs(I.y - q.y) < 5) return true;
      for (let i = 0; i < arc.length; i += 6) {
        const ex = arc[i] - q.x, ey = arc[i + 1] - q.y, ez = arc[i + 2] - q.z;
        if (ex * ex + ey * ey + ez * ez < 3.4 * 3.4) return true;
      }
    }
    return false;
  }

  /** Set building `b` alight toward the street point (rx, rz): see flameSpots. Null if it can't be. */
  ignite(b, rx, rz, n, spots = null, ei = -1) {
    const S = spots || this.flameSpots(b, rx, rz, n, ei);
    if (!S) return null;
    const flames = S.map((q) => ({ x: q.x, y: q.y, z: q.z, nx: q.nx, nz: q.nz, hp: 1, wet: 0, et: Math.random() }));
    const fire = { b, flames, out: false };
    this.fires.push(fire);
    return fire;
  }

  burn(dt) {
    const F = this.flame, S = this.smoke, phone = this.o.phone;
    for (const fire of this.fires) {
      let lit = 0;
      for (const fl of fire.flames) {
        if (fl.hp <= 0) {
          // a dead flame steams for a while
          if (fl.steam > 0) {
            fl.steam -= dt;
            if (Math.random() < dt * 6) S.emit(fl.x, fl.y, fl.z, fl.nx, 1.6, fl.nz, 2.6, 1.6, 6, 0.86, 0.87, 0.88, 0.5, 0, 0.6);
          }
          continue;
        }
        if (fl.wet > 0) {
          fl.wet -= dt;
          fl.hp -= dt * 0.42;
          if (Math.random() < dt * 10) S.emit(fl.x, fl.y + 0.5, fl.z, fl.nx, 1.8, fl.nz, 1.6, 1.4, 4.5, 0.88, 0.89, 0.9, 0.55, 0, 0.8);
          if (fl.hp <= 0) { fl.hp = 0; fl.steam = 3; this.stats.flamesOut++; continue; }
        } else fl.hp = Math.min(1, fl.hp + dt * 0.035);
        lit++;
        const k = fl.hp;
        // flames: tongues licking up out of the window, a hot yellow core
        // going orange, and a big dim glow behind them that lights the wall
        fl.et += dt * (phone ? 20 : 34) * (0.4 + 0.6 * k);
        while (fl.et >= 1) {
          fl.et -= 1;
          const hot = Math.random(), glow = Math.random() < 0.16;
          const sp = glow ? 1.2 : 2.6;
          F.emit(fl.x + (Math.random() - 0.5) * sp, fl.y + (Math.random() - 0.4) * 1.4, fl.z + (Math.random() - 0.5) * sp,
            fl.nx * 0.9 + (Math.random() - 0.5) * 1.0, (glow ? 0.8 : 3.2) + Math.random() * 2.8, fl.nz * 0.9 + (Math.random() - 0.5) * 1.0,
            glow ? 0.9 : 0.6 + Math.random() * 0.55,
            (glow ? 7.5 : 3.0 + Math.random() * 1.8) * (0.55 + 0.45 * k), glow ? 8 : 0.9,
            1.0, glow ? 0.38 : 0.42 + hot * 0.42, glow ? 0.08 : 0.10 + hot * 0.16, glow ? 0.28 : 1.0, 0.0, glow ? 0.4 : 2.2);
        }
        // smoke: thick, dark and rising high -- it is the beacon from across town
        if (Math.random() < dt * (phone ? 3.2 : 5) * k) {
          const g = 0.07 + Math.random() * 0.10;
          S.emit(fl.x + fl.nx * 1.2, fl.y + 2.2, fl.z + fl.nz * 1.2, fl.nx * 0.8 + (Math.random() - 0.5) * 1.4, 4.0 + Math.random() * 2.0, fl.nz * 0.8 + (Math.random() - 0.5) * 1.4,
            7 + Math.random() * 5, 3.5, 17, g, g, g * 1.05, 0.78, 0, 0.3);
        }
      }
      fire.lit = lit;
      fire.out = lit === 0;
    }
  }

  // --- fire calls ------------------------------------------------------------------

  /** Pick a building to burn: 300-1500 m off, mid-rise, beside a street traffic can reach. */
  pickBuilding(px, pz, minD = 300, maxD = 1500, n = 4, rnd = Math.random) {
    const o = this.o, city = o.city, T = o.traffic;
    for (let tries = 0; tries < 400; tries++) {
      const a = rnd() * Math.PI * 2, r = minD + rnd() * (maxD - minD);
      const x = px + Math.sin(a) * r, z = pz + Math.cos(a) * r;
      const bl = city.buildingsNear(x, z, 60);
      if (!bl.length) continue;
      const b = bl[Math.floor(rnd() * bl.length)];
      if (b.h < 6 || b.h > 45 || b.w * b.d < 120 || b.w * b.d > 4000) continue;
      if (G.isWater(b.x, b.z) || (city.platformAt && city.platformAt(b.x, b.z) !== null)) continue;
      // the street in front
      let best = null;
      for (const ei of city.edgesNear(b.x, b.z, Math.max(b.w, b.d) / 2 + 30)) {
        const e = city.edges[ei];
        if (e.elev || e.tunnel || e.noTraffic || e.cls === 'hwy' || e.cls === 'ramp' || (T.inComponent && !T.inComponent(ei))) continue;
        const n0 = city.nodes[e.a];
        const t = clamp((b.x - n0.x) * e.dx + (b.z - n0.z) * e.dz, 0, e.len);
        const qx = n0.x + e.dx * t, qz = n0.z + e.dz * t, d = Math.hypot(qx - b.x, qz - b.z);
        if (!best || d < best.d) best = { d, x: qx, z: qz, ei };
      }
      if (!best || best.d > Math.max(b.w, b.d) / 2 + 22) continue;
      const d = Math.hypot(b.x - px, b.z - pz);
      if (d < minD || d > maxD) continue;
      // a fire the deck gun can reach from that street (flameSpots)
      const spots = this.flameSpots(b, best.x, best.z, n, best.ei);
      if (!spots) continue;
      return { b, road: best, spots };
    }
    return null;
  }

  dispatch(forced = null) {
    const o = this.o, p = o.player.position;
    const k = this.level + 1;
    const nb = k >= 5 ? 3 : k >= 3 ? 2 : 1;
    const flamesPer = Math.min(3 + k, 7);
    const first = forced || this.pickBuilding(p.x, p.z, 300, 1500, flamesPer);
    if (!first) { o.hud.showToast('No calls right now'); return false; }
    this.clearFires();
    if (!this.ignite(first.b, first.road.x, first.road.z, flamesPer, first.spots && first.spots.length >= Math.min(flamesPer, 3) ? first.spots : null, first.road.ei)) {
      o.hud.showToast('No calls right now');
      return false;
    }
    // the next buildings along: the fire has spread down the block
    for (let i = 1, tries = 0; i < nb && tries < 8; tries++) {
      const near = o.city.buildingsNear(first.b.x, first.b.z, 70).filter((b) => b !== first.b && !this.fires.some((f) => f.b === b)
        && b.h >= 5 && b.h <= 45 && Math.hypot(b.x - first.b.x, b.z - first.b.z) > 12);
      if (!near.length) break;
      const b = near[Math.floor(Math.random() * near.length)];
      // (only one the crew can fight from the same street)
      if (this.ignite(b, first.road.x, first.road.z, Math.max(3, flamesPer - 2), null, first.road.ei)) i++;
    }
    const nFl = this.fires.reduce((s, f) => s + f.flames.length, 0);
    const dist = Math.hypot(first.b.x - p.x, first.b.z - p.z);
    const T = Math.round((50 + dist / 10 + nFl * 11) * Math.max(0.62, 1 - 0.07 * (k - 1)));
    const name = G.placeNameAt ? G.placeNameAt(first.b.x, first.b.z) : 'the city';
    this.call = { k, t: T, T, at: { x: first.b.x, z: first.b.z }, name, nFl, reward: 250 + 125 * k + nFl * 30 };
    this.level = k;
    this._nextT = 0;
    // rolling to a call: lights and siren on (SIREN still switches them)
    const rig = this.rigOf(o.player.vehicle);
    if (rig && !rig.sirenOn) { this.setSiren(rig, true); this._callSiren = rig; }
    o.game.fireTarget = this.call.at;
    this.beacon.position.set(first.b.x, first.b.y, first.b.z);
    this.beacon.visible = true;
    if (!this._objSaved) { this._objBefore = o.hud.objective ? o.hud.objective.textContent : ''; this._objSaved = true; this._objTxt = null; }
    o.hud.showToast(`FIRE CALL ${k}: ${nb > 1 ? `${nb} buildings` : 'a building'} alight in ${name} — ${Math.round(dist)} m`, 3600);
    if (o.audio && o.audio.ready) o.audio.ui('start');
    this.stats.calls++;
    return true;
  }

  clearFires() {
    this.fires.length = 0;
  }

  standDown(msg) {
    const o = this.o;
    // the siren the call switched on goes off with it
    if (this._callSiren) { this.setSiren(this._callSiren, false); this._callSiren = null; }
    this.call = null;
    this._nextT = 0;
    this.level = 0;
    this.clearFires();
    o.game.fireTarget = null;
    this.beacon.visible = false;
    // (only if the line is still ours: a delivery, a police run or a tour may
    // have written its own since, and restoring over it would bring back a
    // dead objective)
    if (this._objSaved) {
      if (!this._objTxt || (o.hud.objective && o.hud.objective.textContent === this._objTxt)) o.hud.setObjective(this._objBefore || '');
      this._objSaved = false;
    }
    if (msg) o.hud.showToast(msg);
  }

  /** The call's line on the HUD, remembering what it wrote (see standDown). */
  setObj(t) {
    this._objTxt = t;
    this.o.hud.setObjective(t);
  }

  mission(dt, rig, inRig) {
    const o = this.o, C = this.call;
    // a call lives in the rig, like a police mission in its cruiser: dying,
    // respawning or climbing out ends it (flames, beacon, target, objective)
    if (C || this._nextT > 0) {
      if (o.game.dead) { this.standDown(); return; }
      if (!inRig) { this.standDown('You left the rig — fire call over'); return; }
    }
    if (this._nextT > 0) {
      this._nextT -= dt;
      if (this._nextT <= 0) {
        this._nextT = 0;
        if (inRig) this.dispatch();
        else this.standDown('No crew in the rig: the next call went to another company');
      }
      return;
    }
    if (!C) return;
    C.t -= dt;
    const lit = this.fires.reduce((s, f) => s + f.lit, 0);
    const p = o.player.position, d = Math.hypot(C.at.x - p.x, C.at.z - p.z);
    this.beacon.visible = d > 90;
    if (this.beacon.visible) this.beacon.material.opacity = 0.14 + 0.08 * Math.sin(performance.now() * 0.004);
    if ((this._hudT -= dt) <= 0) {
      this._hudT = 0.25;
      const mm = Math.floor(Math.max(0, C.t) / 60), ss = Math.floor(Math.max(0, C.t) % 60);
      this.setObj(`FIRE CALL ${C.k} · ${C.name} · ${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'} · ${lit} of ${C.nFl} burning · ${mm}:${String(ss).padStart(2, '0')}`);
    }
    if (lit === 0) {
      const pay = C.reward + Math.round(Math.max(0, C.t));
      o.game.money += pay;
      this.stats.paid += pay;
      if (o.audio && o.audio.ready) o.audio.cash();
      o.hud.showToast(`Fire out — ${formatMoney(pay)}. Next call coming in...`, 3200);
      this.setObj(`FIRE CALL ${C.k} · out · ${formatMoney(pay)} · stand by for the next call (MISSION to stand down)`);
      this.call = null;
      o.game.fireTarget = null;
      this.beacon.visible = false;
      this._nextT = 5;
      return;
    }
    if (C.t <= 0) {
      if (o.audio && o.audio.ready) o.audio.ui('fail');
      this.standDown(`Too late — the fire in ${C.name} got away. Calls ended at ${C.k}`);
    }
  }

  /**
   * The rig's flashing heads follow its siren (`sirenOn`): main.js's SIREN
   * toggle (button, G, pad R3) switches it, as in a police car, and a fire
   * call switches it on (dispatch). Two boxes shown alternately, one draw.
   */
  siren(dt, rig, inRig) {
    const want = inRig && rig && rig.sirenOn ? rig : null;
    if (this.lit && this.lit !== want) {
      if (this.lit._fireLights) { this.lit.tilt.remove(this.lit._fireLights); this.lit._fireLights = null; }
      this.lit = null;
    }
    if (!want) return;
    if (!want._fireLights) {
      const k = lightsKit(), g = new THREE.Group();
      const a = new THREE.Mesh(k.gL, k.mat), b = new THREE.Mesh(k.gR, k.mat);
      g.add(a, b);
      g.position.set(0, want.spec.roof + 0.17, want.spec.len / 2 - 0.55);
      want.tilt.add(g);
      want._fireLights = g;
      this.lit = want;
    }
    this._blink = (this._blink || 0) + dt;
    const on = Math.sin(this._blink * 12) > 0;
    const [a, b] = want._fireLights.children;
    a.visible = on; b.visible = !on;
  }

  /** Switch a rig's siren through main.js's setSiren (the button's state too), or directly. */
  setSiren(v, on) {
    if (!v || !!v.sirenOn === on) return;
    if (this.o.setSiren) this.o.setSiren(v, on); else v.sirenOn = on;
  }

  /** A rig taken from its station is replaced once the player is well away from it. */
  refill(dt) {
    if ((this._refillT -= dt) > 0) return;
    this._refillT = 6;
    const o = this.o, p = o.player.position, T = o.traffic;
    for (const st of this.stations) {
      if (!st.rigVs) continue;
      st.spots.forEach((sp, i) => {
        const v = st.rigVs[i];
        const home = v && !v.dead && T.cars.includes(v) && Math.hypot(v.x - sp.x, v.z - sp.z) < 3;
        if (home) return;
        if (v && v === o.player.vehicle) return;
        if (dist2(p.x, p.z, sp.x, sp.z) < 350 * 350) return;
        // whatever is left of the old one is the street's now (free: it despawns when far)
        if (v && T.cars.includes(v) && v.mode === 'apron') v.mode = 'free';
        const nv = T.spawnAt(sp.x, sp.z, sp.heading, sp.type, FIRE_RED, 'apron');
        nv.vLong = 0;
        st.rigVs[i] = nv;
      });
    }
  }
}
