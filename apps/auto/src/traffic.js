// Traffic, parked cars and the police response.

import * as THREE from './three.js';
import { Vehicle, CIVILIAN_TYPES, randomCarColor, vehicleAssets } from './vehicles.js';
import { clamp, lerp, angleWrap, hash2, rng, dist2 } from './util.js';
import * as G from './geo.js';

const TRAFFIC_TARGET = 26;
// Parked cars only exist within this radius, and each is 3 draw calls, so this
// is a draw-call dial as much as a distance one.
const PARKED_RADIUS = 105;
const DESPAWN = 520;

export function collideWithBuildings(v, city, onHit) {
  // Street objects first: a tree or a lamp post is closer than the building
  // line and is what you actually hit coming off a kerb. Until this existed
  // the only solid thing in the entire map was a building, so every tree in
  // Seattle was scenery you drove straight through.
  //
  // Softer than a wall: a mast shears and a trunk gives, so the car is pushed
  // out and loses most of its speed rather than stopping dead against it.
  const ob = city.obstacleHit(v.x, v.z, v.radius * 0.7);
  if (ob) {
    v.x += ob.nx * ob.pen;
    v.z += ob.nz * ob.pen;
    const f = v.forward;
    const along = f.x * ob.nx + f.z * ob.nz;
    const impact = Math.abs(v.vLong) * Math.abs(along) * 0.7 + Math.abs(v.vLat) * 0.3;
    v.vLong *= along > 0 ? -0.1 : 0.2;
    v.vLat *= 0.3;
    if (onHit && impact > 3) onHit(impact);
    return impact;
  }
  const near = city.buildingsNear(v.x, v.z, 14);
  for (const b of near) {
    const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
    const dx = v.x - b.x, dz = v.z - b.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const ex = b.w / 2 + v.radius * 0.8, ez = b.d / 2 + v.radius * 0.8;
    if (Math.abs(lx) > ex || Math.abs(lz) > ez) continue;
    if (v.y > b.y + b.h - 1) continue;
    const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
    let nx, nz, pen;
    if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; pen = px; }
    else { nx = 0; nz = Math.sign(lz) || 1; pen = pz; }
    const wx = nx * c + nz * s;
    const wz = -nx * s + nz * c;
    v.x += wx * pen;
    v.z += wz * pen;
    const f = v.forward;
    const along = f.x * wx + f.z * wz;
    const impact = Math.abs(v.vLong) * Math.abs(along) + Math.abs(v.vLat) * 0.4;
    v.vLong *= along > 0 ? -0.18 : 0.28;
    v.vLat *= 0.2;
    if (onHit && impact > 3) onHit(impact);
    return impact;
  }
  return 0;
}

function laneOffset(e, sign) {
  // Drive on the right: offset from centreline by a quarter width.
  const off = e.hw * 0.48;
  return { x: -e.dz * off * sign, z: e.dx * off * sign };
}

export class TrafficSystem {
  constructor(scene, city, game) {
    this.scene = scene;
    this.city = city;
    this.game = game;
    this.cars = [];
    this.parkedSlots = new Set();
    this.R = rng(99);
    this.heli = null;
    this.spawnTimer = 0;
    this.copTimer = 0;
    vehicleAssets();
  }

  add(v, mode) {
    v.mode = mode;
    this.cars.push(v);
    this.scene.add(v.group);
    return v;
  }

  remove(v) {
    const i = this.cars.indexOf(v);
    if (i >= 0) this.cars.splice(i, 1);
    this.scene.remove(v.group);
    if (v.slot != null) this.parkedSlots.delete(v.slot);
    v.bodyMat.dispose();
  }

  spawnAt(x, z, heading, typeName, color, mode) {
    const v = new Vehicle(this.city, typeName, color);
    v.place(x, z, heading);
    return this.add(v, mode);
  }

  // --- parked cars ---------------------------------------------------------

  updateParked(px, pz) {
    const city = this.city;
    const eids = city.edgesNear(px, pz, PARKED_RADIUS);
    const seen = new Set();
    for (const ei of eids) {
      const e = city.edges[ei];
      if (e.elev || e.cls === 'hwy' || e.cls === 'ramp') continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (dist2(mid.x, mid.z, px, pz) > PARKED_RADIUS * PARKED_RADIUS) continue;
      const slots = Math.floor(e.len / 13);
      for (let s = 1; s < slots; s++) {
        const h = hash2(ei * 31 + s, 7);
        // Kerbside occupancy. 0.32 across BOTH sides is about one car in six
        // per kerb, which reads as a street where nobody lives. Parked cars do
        // more for a populated city than any amount of shader work, and they
        // share geometry and two of their three materials across every
        // instance, so the cost is draw calls rather than memory.
        // Kerbside occupancy. Every parked car is 3 draw calls and there are a
        // lot of kerbs in view at once -- measured on device, 67 vehicles were
        // alive at once and the fleet was over half the frame's draw calls.
        // 0.30 still reads as a lived-in street.
        if (h > 0.30) continue;
        const key = ei * 64 + s;
        seen.add(key);
        if (this.parkedSlots.has(key)) continue;
        const t = s / slots;
        const side = h < 0.24 ? 1 : -1;
        const off = e.hw - 1.15;
        const x = lerp(a.x, b.x, t) - e.dz * off * side;
        const z = lerp(a.z, b.z, t) + e.dx * off * side;
        if (dist2(x, z, px, pz) > PARKED_RADIUS * PARKED_RADIUS) continue;
        if (!G.isBuildable(x, z)) continue;
        const heading = Math.atan2(e.dx, e.dz) + (side > 0 ? 0 : Math.PI);
        const tn = CIVILIAN_TYPES[Math.floor(hash2(ei + s * 7, 11) * CIVILIAN_TYPES.length)];
        if (tn === 'bus' || tn === 'garbage') continue;
        const v = this.spawnAt(x, z, heading, tn, randomCarColor(ei * 13 + s), 'parked');
        v.slot = key;
        this.parkedSlots.add(key);
      }
    }
    // despawn parked cars that drifted out of range
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v.mode !== 'parked') continue;
      if (dist2(v.x, v.z, px, pz) > (PARKED_RADIUS + 60) * (PARKED_RADIUS + 60)) this.remove(v);
    }
  }

  // --- traffic -------------------------------------------------------------

  spawnTraffic(px, pz, camDir) {
    const city = this.city;
    // Sample only from edges near the player -- picking uniformly from the whole
    // 10 km map would almost never land in range.
    const pool = city.edgesNear(px, pz, 360);
    if (!pool.length) return null;
    for (let attempt = 0; attempt < 14; attempt++) {
      const ei = pool[Math.floor(this.R.n() * pool.length)];
      const e = city.edges[ei];
      if (e.len < 16) continue;
      if (e.cls === 'res' && this.R.n() < 0.6) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const t = 0.2 + this.R.n() * 0.6;
      const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
      const d = Math.hypot(x - px, z - pz);
      if (d < 90 || d > 330) continue;
      // prefer off-screen spawns
      if (camDir) {
        const dot = ((x - px) * camDir.x + (z - pz) * camDir.z) / d;
        if (dot > 0.4 && d < 190) continue;
      }
      const sign = this.R.n() < 0.5 ? 1 : -1;
      const lo = laneOffset(e, sign);
      const heading = Math.atan2(e.dx * sign, e.dz * sign);
      let tn = CIVILIAN_TYPES[Math.floor(this.R.n() * CIVILIAN_TYPES.length)];
      if (e.cls === 'res' && (tn === 'bus' || tn === 'boxtruck' || tn === 'garbage')) tn = 'sedan';
      const v = this.spawnAt(x + lo.x, z + lo.z, heading, tn, randomCarColor((this.R.n() * 1e6) | 0), 'traffic');
      v.edge = ei;
      v.dirSign = sign;
      v.vLong = 6 + this.R.n() * 6;
      v.panic = 0;
      return v;
    }
    return null;
  }

  // --- police --------------------------------------------------------------

  spawnPolice(px, pz) {
    const city = this.city;
    const pool = city.edgesNear(px, pz, 340);
    if (!pool.length) return null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const ei = pool[Math.floor(this.R.n() * pool.length)];
      const e = city.edges[ei];
      if (e.cls === 'res' || e.elev) continue;
      const a = city.nodes[e.a];
      const d = Math.hypot(a.x - px, a.z - pz);
      if (d < 90 || d > 320) continue;
      const v = this.spawnAt(a.x, a.z, Math.atan2(e.dx, e.dz), 'police', 0xf2f4f6, 'police');
      v.siren = 0;
      v.path = null;
      v.pathT = 0;
      v.repath = 0;
      v.rammed = 0;
      // roof light bar: a dark housing with two strobing lenses
      const bar = new THREE.Group();
      const y = v.spec.roof + 0.09;
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(1.24, 0.1, 0.34),
        new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6, metalness: 0.1 })
      );
      housing.position.set(0, y - 0.03, 0.05);
      bar.add(housing);
      const mkL = (c, x) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.52, 0.15, 0.3),
          new THREE.MeshBasicMaterial({ color: c, toneMapped: false })
        );
        m.position.set(x, y + 0.07, 0.05);
        bar.add(m);
        return m;
      };
      v.lightL = mkL(0x3355ff, -0.31);
      v.lightR = mkL(0xff2a2a, 0.31);
      v.tilt.add(bar);
      return v;
    }
    return null;
  }

  ensureHeli(active, px, pz) {
    if (active && !this.heli) {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: 0x1b2733 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 3.2, 6, 10), mat);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 5.2), mat);
      tail.position.set(0, 0.3, -4);
      g.add(tail);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 1.0), mat);
      fin.position.set(0, 1.1, -6.2);
      g.add(fin);
      const rotor = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 8.5), new THREE.MeshLambertMaterial({ color: 0x2c3a48 }));
        b.rotation.y = (i / 4) * Math.PI * 2;
        rotor.add(b);
      }
      rotor.position.y = 1.6;
      g.add(rotor);
      const tr = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.2), new THREE.MeshLambertMaterial({ color: 0x2c3a48 }));
        b.rotation.z = (i / 3) * Math.PI * 2;
        tr.add(b);
      }
      tr.position.set(0.35, 0.8, -6.2);
      g.add(tr);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
      beacon.position.set(0, -1.2, 1.5);
      g.add(beacon);
      g.position.set(px, 120, pz);
      this.scene.add(g);
      this.heli = { g, rotor, tr, beacon, a: 0, ang: 0 };
    } else if (!active && this.heli) {
      this.scene.remove(this.heli.g);
      this.heli = null;
    }
  }

  // --- pathfinding ---------------------------------------------------------

  findPath(fromNode, toNode, limit = 2500) {
    const city = this.city;
    if (fromNode < 0 || toNode < 0) return null;
    const open = [fromNode];
    const came = new Map([[fromNode, -1]]);
    const gScore = new Map([[fromNode, 0]]);
    const goal = city.nodes[toNode];
    const fScore = new Map([[fromNode, 0]]);
    let count = 0;
    while (open.length && count++ < limit) {
      let bi = 0, bf = Infinity;
      for (let i = 0; i < open.length; i++) {
        const f = fScore.get(open[i]);
        if (f < bf) { bf = f; bi = i; }
      }
      const cur = open.splice(bi, 1)[0];
      if (cur === toNode) {
        const path = [];
        let n = cur;
        while (n !== -1) { path.push(n); n = came.get(n); }
        return path.reverse();
      }
      const node = city.nodes[cur];
      for (const ei of node.e) {
        const e = city.edges[ei];
        const nb = e.a === cur ? e.b : e.a;
        const cost = gScore.get(cur) + e.len * (e.cls === 'res' ? 1.4 : e.cls === 'hwy' ? 0.7 : 1);
        if (gScore.has(nb) && gScore.get(nb) <= cost) continue;
        gScore.set(nb, cost);
        came.set(nb, cur);
        const nn = city.nodes[nb];
        fScore.set(nb, cost + Math.hypot(nn.x - goal.x, nn.z - goal.z));
        if (!open.includes(nb)) open.push(nb);
      }
    }
    return null;
  }

  // --- per-frame -----------------------------------------------------------

  update(dt, px, pz, camDir, player) {
    const city = this.city;
    const game = this.game;

    this.updateParked(px, pz);

    // maintain traffic population
    let trafficCount = 0, policeCount = 0;
    for (const v of this.cars) {
      if (v.mode === 'traffic') trafficCount++;
      else if (v.mode === 'police') policeCount++;
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      if (trafficCount < TRAFFIC_TARGET) this.spawnTraffic(px, pz, camDir);
    }
    const wantPolice = game.wanted === 0 ? 0 : Math.min(9, 1 + game.wanted * 2);
    this.copTimer -= dt;
    if (this.copTimer <= 0 && policeCount < wantPolice) {
      this.copTimer = 1.4;
      this.spawnPolice(px, pz);
    }
    this.ensureHeli(game.wanted >= 4, px, pz);

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v === player.vehicle) continue;
      const d2 = dist2(v.x, v.z, px, pz);
      if (d2 > DESPAWN * DESPAWN && v.mode !== 'parked') { this.remove(v); continue; }
      if (v.mode === 'police' && game.wanted === 0 && d2 > 140 * 140) { this.remove(v); continue; }

      if (v.mode === 'parked') {
        v.group.visible = d2 < 140 * 140;
        continue;
      }
      v.group.visible = true;

      let input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
      if (v.mode === 'traffic') input = this.driveTraffic(v, dt, px, pz, player);
      else if (v.mode === 'police') input = this.drivePolice(v, dt, px, pz, player);
      else input = { throttle: 0, brake: 0.12, steer: 0 }; // shunted or abandoned: coast

      v.update(dt, input);
      collideWithBuildings(v, city);
    }

    this.resolveCarCollisions(dt, player);
    // collision resolution edits transforms directly, so re-sync every body.
    for (const v of this.cars) if (v !== player.vehicle) v.sync();

    if (this.heli) {
      const h = this.heli;
      h.a += dt;
      h.ang += dt * 0.45;
      const r = 70;
      const tx = px + Math.cos(h.ang) * r;
      const tz = pz + Math.sin(h.ang) * r;
      const ty = Math.max(city.groundAt(tx, tz, null) + 95, 110);
      h.g.position.x = lerp(h.g.position.x, tx, 1 - Math.exp(-1.2 * dt));
      h.g.position.z = lerp(h.g.position.z, tz, 1 - Math.exp(-1.2 * dt));
      h.g.position.y = lerp(h.g.position.y, ty, 1 - Math.exp(-1.0 * dt));
      h.g.rotation.y = Math.atan2(px - h.g.position.x, pz - h.g.position.z);
      h.g.rotation.z = -0.18;
      h.rotor.rotation.y += dt * 26;
      h.tr.rotation.x += dt * 34;
      h.beacon.visible = Math.sin(h.a * 9) > 0;
    }
  }

  driveTraffic(v, dt, px, pz, player) {
    const city = this.city;
    let e = city.edges[v.edge];
    if (!e) { v.mode = 'free'; return { throttle: 0, brake: 1, steer: 0 }; }
    const a = city.nodes[v.dirSign > 0 ? e.a : e.b];
    const b = city.nodes[v.dirSign > 0 ? e.b : e.a];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    // progress along the edge
    const proj = ((v.x - a.x) * ux + (v.z - a.z) * uz) / len;
    if (proj > 0.94) {
      const next = this.pickNextEdge(v, e, v.dirSign > 0 ? e.b : e.a);
      if (next) { v.edge = next.ei; v.dirSign = next.sign; }
      else v.dirSign = -v.dirSign;
      e = city.edges[v.edge];
    }
    const ee = city.edges[v.edge];
    const na = city.nodes[v.dirSign > 0 ? ee.a : ee.b];
    const nb = city.nodes[v.dirSign > 0 ? ee.b : ee.a];
    const ndx = nb.x - na.x, ndz = nb.z - na.z;
    const nlen = Math.hypot(ndx, ndz) || 1;
    const fx = ndx / nlen, fz = ndz / nlen;
    const off = ee.hw * 0.48;
    const aimAhead = clamp(6 + Math.abs(v.vLong) * 0.75, 6, 24);
    const p = ((v.x - na.x) * fx + (v.z - na.z) * fz);
    const ap = clamp(p + aimAhead, 0, nlen);
    const tx = na.x + fx * ap - fz * off;
    const tz = na.z + fz * ap + fx * off;

    const desired = Math.atan2(tx - v.x, tz - v.z);
    const err = angleWrap(desired - v.heading);
    const steer = clamp(err * 1.5, -1, 1);

    // obstacle scan
    let brake = 0;
    const f = v.forward;
    const scanLen = 5 + Math.abs(v.vLong) * 1.1;
    for (const o of this.cars) {
      if (o === v) continue;
      const rx = o.x - v.x, rz = o.z - v.z;
      const fwd = rx * f.x + rz * f.z;
      if (fwd < 0.5 || fwd > scanLen) continue;
      const lat = Math.abs(rx * f.z - rz * f.x);
      if (lat > 2.2) continue;
      brake = Math.max(brake, clamp(1.4 - fwd / scanLen, 0.35, 1));
    }
    if (player.onFoot) {
      const rx = player.x - v.x, rz = player.z - v.z;
      const fwd = rx * f.x + rz * f.z;
      const lat = Math.abs(rx * f.z - rz * f.x);
      if (fwd > 0 && fwd < 10 && lat < 2.2) brake = Math.max(brake, 0.8);
    }
    const targetSpeed = Math.min(ee.spd, 8 + ee.spd) * (v.panic > 0 ? 1.5 : 1);
    const throttle = brake > 0.2 ? 0 : clamp((targetSpeed - v.vLong) * 0.4, 0, 1);
    if (v.panic > 0) v.panic -= dt;
    return { throttle, brake, steer, handbrake: 0 };
  }

  pickNextEdge(v, e, nodeId) {
    const city = this.city;
    const node = city.nodes[nodeId];
    if (!node) return null;
    const f = v.forward;
    let best = null, bestScore = -Infinity;
    for (const ei of node.e) {
      if (ei === v.edge) continue;
      const ne = city.edges[ei];
      const sign = ne.a === nodeId ? 1 : -1;
      const dx = ne.dx * sign, dz = ne.dz * sign;
      const dot = dx * f.x + dz * f.z;
      if (dot < -0.5) continue;
      const score = dot * 2 + hash2(ei, (v.x * 3) | 0) * 1.1 + (ne.cls === 'res' ? -0.6 : 0);
      if (score > bestScore) { bestScore = score; best = { ei, sign }; }
    }
    return best;
  }

  drivePolice(v, dt, px, pz, player) {
    const city = this.city;
    v.siren = (v.siren || 0) + dt;
    const blink = Math.sin(v.siren * 11) > 0;
    if (v.lightL) { v.lightL.visible = blink; v.lightR.visible = !blink; }

    const d = Math.hypot(px - v.x, pz - v.z);
    let tx = px, tz = pz;
    v.repath -= dt;
    if (d > 55) {
      if (!v.path || v.repath <= 0) {
        const from = city.nearestNode(v.x, v.z);
        const to = city.nearestNode(px, pz);
        v.path = this.findPath(from, to, 1400);
        v.pathT = 0;
        v.repath = 2.2;
      }
      if (v.path && v.path.length) {
        while (v.pathT < v.path.length) {
          const n = city.nodes[v.path[v.pathT]];
          if (Math.hypot(n.x - v.x, n.z - v.z) < 16) v.pathT++;
          else break;
        }
        const idx = Math.min(v.pathT, v.path.length - 1);
        const n = city.nodes[v.path[idx]];
        tx = n.x; tz = n.z;
      }
    }
    const desired = Math.atan2(tx - v.x, tz - v.z);
    const err = angleWrap(desired - v.heading);
    const steer = clamp(err * 1.7, -1, 1);
    const f = v.forward;

    let brake = 0;
    for (const o of this.cars) {
      if (o === v || o.mode === 'police') continue;
      const rx = o.x - v.x, rz = o.z - v.z;
      const fwd = rx * f.x + rz * f.z;
      if (fwd < 0.5 || fwd > 10) continue;
      if (Math.abs(rx * f.z - rz * f.x) > 2.0) continue;
      brake = 0.7;
    }
    const targetSpeed = d < 18 ? 12 : 34;
    let throttle = brake > 0.2 ? 0 : clamp((targetSpeed - v.vLong) * 0.5, 0, 1);
    if (Math.abs(err) > 1.4 && v.vLong > 10) brake = Math.max(brake, 0.5);
    return { throttle, brake, steer, handbrake: 0 };
  }

  resolveCarCollisions(dt, player) {
    const all = this.cars;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.mode === 'parked' && a !== player.vehicle) {
        // parked cars still get shoved
      }
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const pen = rr - d;
        const ma = a.mass, mb = b.mass;
        const total = ma + mb;
        a.x -= nx * pen * (mb / total);
        a.z -= nz * pen * (mb / total);
        b.x += nx * pen * (ma / total);
        b.z += nz * pen * (ma / total);
        const av = a.forward.x * a.vLong * nx + a.forward.z * a.vLong * nz;
        const bv = b.forward.x * b.vLong * nx + b.forward.z * b.vLong * nz;
        const rel = av - bv;
        if (rel > 0) {
          a.vLong -= rel * 0.55 * (mb / total) * Math.sign(a.vLong || 1);
          b.vLong += rel * 0.5 * (ma / total);
          const impact = Math.abs(rel);
          if (impact > 4) {
            a.damage(impact * 0.7);
            b.damage(impact * 0.7);
            if (b.mode === 'traffic') b.panic = 4;
            if (a.mode === 'traffic') a.panic = 4;
            if (a === player.vehicle || b === player.vehicle) {
              this.game.onCrash(impact, b.mode === 'police' || a.mode === 'police');
            }
          }
        }
        if (a.mode === 'parked') a.mode = 'free';
        if (b.mode === 'parked') b.mode = 'free';
      }
    }
  }

  /** Nearest vehicle the player can climb into. */
  nearestEnterable(x, z, maxD = 4.5) {
    let best = null, bd = maxD * maxD;
    for (const v of this.cars) {
      if (v.dead) continue;
      const p = v.nearest(x, z);
      const d = dist2(p.x, p.z, x, z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
}
