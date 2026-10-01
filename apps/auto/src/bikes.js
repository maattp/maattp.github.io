// BIKES: Seattle's bike paths, the people riding them, and bike-share docks
// where you can take a bicycle yourself.
//
// The paths are OSM's (data/bikepaths.json, tools/build_bikepaths.py): every
// highway=cycleway and every path signed bicycle=designated in the box --
// the Burke-Gilman, the Elliott Bay, Alki, I-90 and SR 520 trails, Green
// Lake's loop and the rest, ~260 km. They are drawn as paved ribbons on the
// ground (gravel where OSM says unpaved), with a yellow centre line, except
// where one is a bridge or a tunnel (the road import already draws what it
// crosses over or under) or runs on a carriageway. Trees and props keep off
// them (citygen's extraClear).
//
// The cyclists are ordinary Vehicles of type 'bicycle' in traffic's list, in
// mode 'path': traffic neither drives nor despawns them, this does. They ride
// the network joined at shared OSM end nodes, keep right, ring the bell at a
// walker in their way, and vanish out of range. Take one like any vehicle.
//
// The docks: a row of racks and a kiosk beside the trail at eleven places,
// each holding five bikes ('apron', parked), refilled while you are away.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder, ChunkBuilder, dropAfterUpload } from './build.js';
import { clamp, angleWrap } from './util.js';

const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const CELL = 40, CHUNK = 1000;
const HW = 1.5, HW_GRAVEL = 1.1, LIFT = 0.05;
const RIDERS = ON_PHONE ? 4 : 8, RANGE = 480;
const ASPHALT = [0.19, 0.19, 0.2], GRAVEL = [0.46, 0.42, 0.34], LINE = [0.86, 0.66, 0.12], EDGE = [0.62, 0.62, 0.6];
const DOCK_COLOR = 0x57b83a;

// Bike-share docks, at trailheads and parks along the paths (snapped to the
// nearest drawn path at boot).
export const DOCK_SITES = [
  { name: 'Gas Works Park', lat: 47.6457, lon: -122.3350 },
  { name: 'Fremont', lat: 47.6484, lon: -122.3480 },
  { name: 'Myrtle Edwards Park', lat: 47.6195, lon: -122.3590 },
  { name: 'Alki', lat: 47.5810, lon: -122.4060 },
  { name: 'Green Lake', lat: 47.6795, lon: -122.3265 },
  { name: 'Westlake Park', lat: 47.6108, lon: -122.3372 },
  { name: 'U District', lat: 47.6560, lon: -122.3120 },
  { name: 'Seward Park', lat: 47.5510, lon: -122.2570 },
  { name: 'Magnuson Park', lat: 47.6830, lon: -122.2560 },
  { name: 'Golden Gardens', lat: 47.6905, lon: -122.4020 },
  { name: 'Mount Baker Beach', lat: 47.5880, lon: -122.2860 },
];

export class BikeNet {
  constructor(data) {
    this.names = data.names;
    this.paths = data.paths.map((q, i) => {
      const p = q.p, cum = [0];
      for (let k = 1; k < p.length; k++) cum.push(cum[k - 1] + Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]));
      return { i, p, cum, len: cum[cum.length - 1], a: q.a, b: q.b, name: data.names[q.n], bridge: !!(q.f & 1), tunnel: !!(q.f & 2), gravel: !!(q.f & 4), drawn: null };
    });
    // a grid of segments for the clear test and nearest queries
    this.grid = new Map();
    for (const P of this.paths) {
      for (let k = 0; k < P.p.length - 1; k++) {
        const [ax, az] = P.p[k], [bx, bz] = P.p[k + 1];
        const x0 = Math.floor((Math.min(ax, bx) - 3) / CELL), x1 = Math.floor((Math.max(ax, bx) + 3) / CELL);
        const z0 = Math.floor((Math.min(az, bz) - 3) / CELL), z1 = Math.floor((Math.max(az, bz) + 3) / CELL);
        for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
          const key = cx * 100003 + cz;
          let l = this.grid.get(key);
          if (!l) this.grid.set(key, (l = []));
          l.push(P.i, k);
        }
      }
    }
    // the network: ways joined at their end nodes (OSM ids; a cropped end
    // has none and joins by position)
    this.nodes = new Map();
    const key = (id, pt) => (id ? `n${id}` : `p${Math.round(pt[0] / 3)},${Math.round(pt[1] / 3)}`);
    for (const P of this.paths) {
      P.ka = key(P.a, P.p[0]); P.kb = key(P.b, P.p[P.p.length - 1]);
      for (const k of [P.ka, P.kb]) { if (!this.nodes.has(k)) this.nodes.set(k, []); this.nodes.get(k).push(P); }
    }
  }

  /** On (or right beside) a bike path: no trees, benches or parked cars. */
  keepClear(x, z) {
    const l = this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!l) return false;
    for (let q = 0; q < l.length; q += 2) {
      const P = this.paths[l[q]];
      if (P.bridge || P.tunnel) continue;
      const [ax, az] = P.p[l[q + 1]], [bx, bz] = P.p[l[q + 1] + 1];
      if (segD(x, z, ax, az, bx, bz) < (P.gravel ? HW_GRAVEL : HW) + 0.9) return true;
    }
    return false;
  }

  /** The nearest point on a rideable path within maxD: { P, s, d } or null. */
  nearest(x, z, maxD = 40) {
    let best = null, bd = maxD;
    const c0 = Math.floor((x - maxD) / CELL), c1 = Math.floor((x + maxD) / CELL);
    const d0 = Math.floor((z - maxD) / CELL), d1 = Math.floor((z + maxD) / CELL);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const l = this.grid.get(cx * 100003 + cz);
      if (!l) continue;
      for (let q = 0; q < l.length; q += 2) {
        const P = this.paths[l[q]];
        if (!P.ride) continue;
        const k = l[q + 1], [ax, az] = P.p[k], [bx, bz] = P.p[k + 1];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
        const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
        if (d < bd) { bd = d; best = { P, s: P.cum[k] + t * Math.sqrt(L2), d }; }
      }
    }
    return best;
  }

  /** Point and heading at s along path P. */
  at(P, s) {
    s = clamp(s, 0, P.len);
    let k = 0;
    while (k < P.cum.length - 2 && P.cum[k + 1] < s) k++;
    const [ax, az] = P.p[k], [bx, bz] = P.p[k + 1];
    const L = P.cum[k + 1] - P.cum[k] || 1e-6, t = (s - P.cum[k]) / L;
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, h: Math.atan2(bx - ax, bz - az) };
  }

  /**
   * The ribbons. Each way is cut where it runs on a carriageway, over water
   * or into a building, and not drawn at all as a bridge or a tunnel. Each
   * vertex takes the terrain's own height at its point (and the long pieces
   * are cut to ~4 m), so the ribbon lies on the ground it is drawn over.
   */
  build(scene, city) {
    this.city = city;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.45,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const chunks = new Map();
    const chunk = (x, z) => {
      const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let c = chunks.get(k);
      if (!c) chunks.set(k, (c = { segs: [], x: (Math.floor(x / CHUNK) + 0.5) * CHUNK, z: (Math.floor(z / CHUNK) + 0.5) * CHUNK }));
      return c;
    };
    const inBld = (x, z) => city.buildingsNear(x, z, 12).some((b) => {
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
      return Math.abs(dx * c - dz * s) < b.w / 2 && Math.abs(dx * s + dz * c) < b.d / 2;
    });
    let km = 0;
    for (const P of this.paths) {
      P.ride = !P.bridge && !P.tunnel && P.len > 4;
      if (P.bridge || P.tunnel) continue;
      const hw = P.gravel ? HW_GRAVEL : HW;
      // resample every ~4 m, keeping the corners
      const pts = [];
      for (let k = 0; k < P.p.length - 1; k++) {
        const [ax, az] = P.p[k], [bx, bz] = P.p[k + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
        for (let j = 0; j < n; j++) pts.push([ax + (bx - ax) * j / n, az + (bz - az) * j / n, P.cum[k] + (P.cum[k + 1] - P.cum[k]) * j / n]);
      }
      const e = P.p[P.p.length - 1];
      pts.push([e[0], e[1], P.len]);
      // the left normal at each point, mitred at the corners
      const L = pts.map((q, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        return [dz / l, -dx / l];
      });
      const drawn = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, mz = (pts[i][1] + pts[i + 1][1]) / 2;
        const ok = !G.isWater(mx, mz) && !city.onRoad(mx, mz, 0.2, false, false) && !inBld(mx, mz);
        drawn.push(ok);
        if (!ok) continue;
        // drawn when its chunk first comes into range (see _drawSeg)
        chunk(mx, mz).segs.push(pts, L, i, P);
        km += (pts[i + 1][2] - pts[i][2]) / 1000;
      }
      P.drawn = drawn;
    }
    this.km = km;
    this.group = new THREE.Group();
    this.group.name = 'bikepaths';
    // BUILT WHEN FIRST IN RANGE (update), not at boot: ~190 km of ribbons
    // were ~1 s of every phone launch and 33 MB of arrays, almost all of it
    // out of the 1 km (600 m) it is drawn within.
    this.chunks = [];
    for (const [key, c] of chunks) if (c.segs.length) this.chunks.push({ key, segs: c.segs, m: null, x: c.x, z: c.z });
    scene.add(this.group);
  }

  /** A lost WebGL context: on a phone the meshes' arrays are gone (see
   *  _build), so they go, and are built again when next in range. */
  contextLost() {
    for (const c of this.chunks) if (c.m) { this.group.remove(c.m); c.m.geometry.dispose(); c.m = null; }
  }

  /** One ~4 m piece of path i..i+1: the ribbon, and on paved paths a dashed
   *  centre line and edge lines. */
  _drawSeg(b, pts, L, i, P) {
    const hw = P.gravel ? HW_GRAVEL : HW;
    const V = (i2, o) => {
      const x = pts[i2][0] + L[i2][0] * o, z = pts[i2][1] + L[i2][1] * o;
      return [x, G.terrainHeight(x, z) + LIFT, z];
    };
    const col = P.gravel ? GRAVEL : ASPHALT;
    const n = [0, 1, 0], uv = [0, 0, 1, 0, 1, 1, 0, 1];
    for (const [o0, o1] of [[-hw, 0], [0, hw]]) b.quad(V(i, o0), V(i, o1), V(i + 1, o1), V(i + 1, o0), n, uv, col);
    if (P.gravel) return;
    // a dashed yellow centre line (3 m on, 3 m off) and white edges
    const lift = (p, dy) => [p[0], p[1] + dy, p[2]];
    if (Math.floor(pts[i][2] / 3) % 2 === 0) b.quad(lift(V(i, -0.06), 0.004), lift(V(i, 0.06), 0.004), lift(V(i + 1, 0.06), 0.004), lift(V(i + 1, -0.06), 0.004), n, uv, LINE);
    for (const sg of [-1, 1]) b.quad(lift(V(i, sg * (hw - 0.2)), 0.004), lift(V(i, sg * (hw - 0.1)), 0.004), lift(V(i + 1, sg * (hw - 0.1)), 0.004), lift(V(i + 1, sg * (hw - 0.2)), 0.004), n, uv, EDGE);
  }

  _build(c) {
    const b = new ChunkBuilder(false, 1024);
    const S = c.segs;
    // (segs are kept -- a few references into each path's points -- so a
    // chunk dropped on a lost context can be built again)
    for (let k = 0; k < S.length; k += 4) this._drawSeg(b, S[k], S[k + 1], S[k + 2], S[k + 3]);
    if (b.empty) { c.segs = null; return; }
    const m = new THREE.Mesh(b.build(ON_PHONE), this.mat);
    m.name = `bikepaths:${c.key}`; m.receiveShadow = true;
    if (ON_PHONE) dropAfterUpload(m);
    this.group.add(m);
    c.m = m;
  }

  update(camera) {
    if (!this.chunks) return;
    // a 1 km chunk's visibility changes rarely: look every eighth frame (the
    // first call builds everything in range, later ones one chunk each)
    const first = !this._tick;
    if ((this._tick = (this._tick || 0) + 1) & 7 && !first) return;
    const R = (ON_PHONE ? 600 : 1000) + CHUNK * 0.71, x = camera.position.x, z = camera.position.z;
    let budget = first ? Infinity : 1;
    for (const c of this.chunks) {
      const near = Math.hypot(c.x - x, c.z - z) < R;
      if (near && !c.m && c.segs && budget > 0) { this._build(c); budget--; }
      if (c.m) c.m.visible = near;
    }
  }
}

function segD(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

const RIDER_COLORS = [0x1d3f7a, 0xb52a2a, 0x2c2c30, 0xe0e2e4, 0x2f6f3e, 0xd9a21b, 0x6a2d8a, 0x3a8fc9];

/** The cyclists on the network, and the docks. */
export class Cyclists {
  constructor(net, traffic, city, scene) {
    this.net = net; this.traffic = traffic; this.city = city; this.scene = scene;
    this.riders = [];
    this.docks = [];
    this.spawnT = 0; this.dockT = 0;
    this.seq = 0;
    this.stats = { spawned: 0, junctions: 0, uturns: 0 };
    this._docks();
  }

  /** Each dock beside the nearest drawn path to its site: open, dry, level
   *  ground off the road, the racks along the path. */
  _docks() {
    const net = this.net, city = this.city;
    const b = new Builder(false);
    for (const site of DOCK_SITES) {
      const [sx, sz] = G.toWorld(site.lat, site.lon);
      const q = net.nearest(sx, sz, 400);
      if (!q) continue;
      const inBld = (x, z) => city.buildingsNear(x, z, 16).some((bd) => {
        const c = Math.cos(-bd.rot), s = Math.sin(-bd.rot), dx = x - bd.x, dz = z - bd.z;
        return Math.abs(dx * c - dz * s) < bd.w / 2 + 2 && Math.abs(dx * s + dz * c) < bd.d / 2 + 2;
      });
      let best = null;
      for (const ds of [0, 12, -12, 24, -24, 40, -40, 60, -60, 90, -90, 130, -130]) {
        const pt = net.at(q.P, q.s + ds);
        for (const off of [4.2, 6]) for (const sg of [1, -1]) {
          if (best) break;
          const lx = Math.cos(pt.h) * sg, lz = -Math.sin(pt.h) * sg;
          const x = pt.x + lx * off, z = pt.z + lz * off;
          let ok = true;
          for (const t of [-5, 0, 5]) {
            const px = x + Math.sin(pt.h) * t, pz = z + Math.cos(pt.h) * t;
            ok = ok && !G.isWater(px, pz) && !city.onRoad(px, pz, 1.2) && !inBld(px, pz) && Math.abs(G.terrainHeight(px, pz) - G.terrainHeight(x, z)) < 1;
          }
          if (ok) best = { x, z, h: pt.h, lx, lz };
        }
        if (best) break;
      }
      if (!best) continue;
      const y = G.terrainHeight(best.x, best.z);
      const d = { name: site.name, x: best.x, z: best.z, y, h: best.h, lx: best.lx, lz: best.lz, bikes: [] };
      // the racks: five inverted-U hoops across the row, the kiosk at one
      // end with its map panel, a concrete pad under them
      const fx = Math.sin(best.h), fz = Math.cos(best.h);
      b.box(d.x, y - 0.1, d.z, 2.4, 0.14, 10.5, -best.h, [0.58, 0.57, 0.54]);
      for (let k = 0; k < 5; k++) {
        const t = (k - 2) * 1.8, cx = d.x + fx * t, cz = d.z + fz * t;
        for (const o of [-0.35, 0.35]) b.tube([cx + best.lx * o, y, cz + best.lz * o], [cx + best.lx * o, y + 0.78, cz + best.lz * o], 0.03, 6, [0.25, 0.26, 0.27], true);
        b.tube([cx - best.lx * 0.35, y + 0.78, cz - best.lz * 0.35], [cx + best.lx * 0.35, y + 0.78, cz + best.lz * 0.35], 0.03, 6, [0.25, 0.26, 0.27], true);
      }
      const kx = d.x + fx * 5.0, kz = d.z + fz * 5.0;
      b.box(kx, y, kz, 0.5, 1.9, 0.35, -best.h, [0.2, 0.55, 0.22]);
      b.box(kx, y + 1.25, kz, 0.46, 0.5, 0.37, -best.h, [0.9, 0.9, 0.88]);
      b.box(kx, y + 1.9, kz, 0.62, 0.12, 0.45, -best.h, [0.2, 0.55, 0.22]);
      this.docks.push(d);
    }
    this.dockMesh = null;
    if (!b.empty) {
      this.dockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.6 });
      this.dockMesh = new THREE.Mesh(b.build(), this.dockMat);
      this.dockMesh.name = 'bikedocks';
      this.dockMesh.castShadow = true; this.dockMesh.receiveShadow = true;
      this.scene.add(this.dockMesh);
    }
    for (const d of this.docks) this._fill(d);
  }

  /** Bikes back in a dock's empty slots. */
  _fill(d) {
    const fx = Math.sin(d.h), fz = Math.cos(d.h);
    for (let k = 0; k < 5; k++) {
      const v = d.bikes[k];
      if (v && !v.dead && v.mode === 'apron' && Math.hypot(v.x - d.x, v.z - d.z) < 12) continue;
      const t = (k - 2) * 1.8;
      // standing in the rack, front wheel away from the path
      const nb = this.traffic.spawnAt(d.x + fx * t, d.z + fz * t, Math.atan2(d.lx, d.lz), 'bicycle', DOCK_COLOR, 'apron');
      d.bikes[k] = nb;
    }
  }

  update(dt, player) {
    const net = this.net, p = player.position;
    // docks: refilled while you are well away from them
    this.dockT -= dt;
    if (this.dockT <= 0) {
      this.dockT = 4;
      for (const d of this.docks) if (Math.hypot(d.x - p.x, d.z - p.z) > 260) this._fill(d);
    }
    if (this.dockMesh) this.dockMesh.visible = this.docks.some((d) => Math.hypot(d.x - p.x, d.z - p.z) < 500);
    // riders: drop the ones out of range, taken, or wrecked
    for (let i = this.riders.length - 1; i >= 0; i--) {
      const r = this.riders[i], v = r.v;
      const gone = v.dead || v.mode !== 'path' || Math.hypot(v.x - p.x, v.z - p.z) > RANGE + 80;
      if (gone) {
        if (v.mode === 'path') this.traffic.remove(v);
        this.riders.splice(i, 1);
      }
    }
    // new riders, out of sight-ish: 150-450 m away, on a rideable path
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.riders.length < RIDERS) {
      this.spawnT = 0.7;
      const a = Math.random() * Math.PI * 2, rr = 150 + Math.random() * 300;
      const q = net.nearest(p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr, 90);
      if (q && q.P.len > 30) this.spawn(q.P, q.s, Math.random() < 0.5 ? 1 : -1);
    }
    for (const r of this.riders) this._ride(r, dt, player);
  }

  spawn(P, s, dir, speed) {
    const pt = this.net.at(P, s);
    const h = dir > 0 ? pt.h : pt.h + Math.PI;
    const v = this.traffic.spawnAt(pt.x, pt.z, h, 'bicycle', RIDER_COLORS[this.seq++ % RIDER_COLORS.length], 'path');
    const r = { v, P, s, dir, speed: speed || 4.2 + Math.random() * 2.4, h, bellT: 0 };
    v.pedaling = true;
    this.riders.push(r);
    this.stats.spawned++;
    this._place(r, 0);
    return r;
  }

  /** On along the path; at its end, onto another at the same node. */
  _ride(r, dt, player) {
    const net = this.net, v = r.v;
    // someone in the way (you): slow, and ring the bell
    let want = r.speed;
    const pos = player.position, fx = Math.sin(r.h), fz = Math.cos(r.h);
    const ax = pos.x - v.x, az = pos.z - v.z, ahead = ax * fx + az * fz, lat = Math.abs(ax * fz - az * fx);
    v._ikFar = ax * ax + az * az > 45 * 45;
    // a cyclist is 4 draws (the bike's three and the rider): past a couple of
    // hundred metres it is a few pixels, and nobody misses it
    v.group.visible = ax * ax + az * az < (ON_PHONE ? 120 * 120 : 180 * 180);
    if (ahead > 0 && ahead < 9 && lat < 1.4) {
      want = Math.min(want, Math.max(0, (ahead - 2.2) * 0.8));
      r.bellT -= dt;
      if (r.bellT <= 0 && this.audio && this.audio.ready) { r.bellT = 3; this.audio.play('bike_bell', { gain: 0.9, x: v.x, y: v.y + 1, z: v.z }); }
    }
    r.v.vLong = r.v.vLong + (want - r.v.vLong) * Math.min(1, dt * 1.5);
    r.s += r.dir * r.v.vLong * dt;
    if (r.s < 0 || r.s > r.P.len) {
      const node = r.s < 0 ? r.P.ka : r.P.kb;
      const opts = (net.nodes.get(node) || []).filter((Q) => Q !== r.P && Q.ride);
      if (opts.length) {
        const Q = opts[Math.floor(Math.random() * opts.length)];
        const over = r.s < 0 ? -r.s : r.s - r.P.len;
        r.P = Q;
        if (Q.ka === node) { r.dir = 1; r.s = Math.min(Q.len, over); } else { r.dir = -1; r.s = Math.max(0, Q.len - over); }
        this.stats.junctions++;
      } else {
        // a dead end: turn round
        r.dir = -r.dir; r.s = clamp(r.s, 0, r.P.len);
        this.stats.uturns++;
      }
    }
    this._place(r, dt);
  }

  _place(r, dt) {
    const v = r.v, pt = this.net.at(r.P, r.s);
    const h = r.dir > 0 ? pt.h : pt.h + Math.PI;
    const dh = angleWrap(h - r.h);
    r.h = dt > 0 ? r.h + dh * Math.min(1, dt * 6) : h;
    // keep right
    const rx = -Math.cos(r.h) * 0.75, rz = Math.sin(r.h) * 0.75;
    const x = pt.x + rx, z = pt.z + rz;
    const y = G.terrainHeight(x, z) + LIFT;
    const ahead = G.terrainHeight(x + Math.sin(r.h) * 0.6, z + Math.cos(r.h) * 0.6);
    v.x = x; v.z = z; v.y = y;
    v.heading = r.h;
    v.pitch = -Math.atan2(ahead - (y - LIFT), 0.6);
    // lean into the turn, from the rate of turn at this speed
    const rate = dt > 0 ? dh * Math.min(1, dt * 6) / dt : 0;
    v.roll = v.roll + (clamp(-Math.atan(rate * v.vLong / 9.8), -0.35, 0.35) - v.roll) * Math.min(1, dt * 5);
    v.wheelSpin += (v.vLong / 0.345) * dt;
    v.pedaling = v.vLong > 0.5;
    v.sync();
  }
}
