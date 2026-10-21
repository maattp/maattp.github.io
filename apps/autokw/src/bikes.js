// BIKES: Seattle's bike paths, the people riding them, and bike-share docks
// where you can take a bicycle yourself.
//
// The paths are OSM's (data/bikepaths.json, tools/kw/build_bikepaths.py): every
// highway=cycleway and every path signed bicycle=designated in the box, and
// (Auto KW) the named walking trails and boardwalks, ~500 km: the Walter
// Bean, Iron Horse, Spurline, Laurel and Trans Canada trails, the rail
// trails, the Huron Natural Area's and Laurel Creek's paths. Each is drawn
// as a ribbon on the ground in what OSM says it is made of -- asphalt,
// crushed limestone (most of the Walter Bean and the rail trails), bare
// earth, or a raised timber boardwalk -- with no painted lines (KW's trails
// have none), grass creeping in at the edges. Not drawn where one is a
// tunnel or runs on a carriageway; a bridge is drawn here only if
// kwnature.js built its deck (P.deck), otherwise the road import or a place
// module drew it. Trees and props keep off them (citygen's extraClear).
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
import { memoPeek, memoPut } from './bootcache.js';

const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const CELL = 40, CHUNK = 1000;
const HW = 1.5, HW_GRAVEL = 1.3, HW_EARTH = 0.6, HW_WOOD = 0.9, LIFT = 0.05, WOOD_LIFT = 0.4;
const RIDERS = ON_PHONE ? 4 : 8, RANGE = 480;
// people out for a walk on the trails (peds.js spawnTrail): fewer than the
// riders, nearer, and only while you are near a trail
const WALKERS = ON_PHONE ? 3 : 6, WALK_RANGE = 300;
// (linear) asphalt; crushed limestone screenings, pale grey-buff; bare earth;
// weathered timber; the grass the edges fade into
const ASPHALT = [0.17, 0.17, 0.18], GRAVEL = [0.50, 0.46, 0.38], EARTH = [0.22, 0.16, 0.11], WOOD = [0.34, 0.25, 0.16],
  EDGE_GRASS = [0.16, 0.20, 0.08];
/** How wide a path is drawn (half width), by what it is made of. */
const pathHW = (P) => (P.wood ? HW_WOOD : P.earth ? HW_EARTH : P.gravel ? HW_GRAVEL : HW);
const DOCK_COLOR = 0x57b83a;

// Bike-share docks, at trailheads and parks along the paths (snapped to the
// nearest drawn path at boot).
export const DOCK_SITES = [
  { name: 'Waterloo Park', lat: 43.4650, lon: -80.5290 },
  { name: 'Waterloo Public Square', lat: 43.4645, lon: -80.5225 },
  { name: 'Laurel Trail at UW', lat: 43.4700, lon: -80.5420 },
  { name: 'Columbia Lake', lat: 43.4770, lon: -80.5550 },
  { name: 'Victoria Park', lat: 43.4470, lon: -80.4990 },
  { name: 'Iron Horse Trail', lat: 43.4405, lon: -80.4955 },
  { name: 'Kitchener City Hall', lat: 43.4510, lon: -80.4920 },
  { name: 'Bechtel Park', lat: 43.4895, lon: -80.4920 },
  { name: 'Walter Bean Trail', lat: 43.4560, lon: -80.4180 },
  { name: 'Huron Natural Area', lat: 43.4010, lon: -80.4730 },
  { name: 'Riverside Park', lat: 43.3940, lon: -80.3460 },
];

export class BikeNet {
  constructor(data) {
    this.names = data.names;
    this.paths = data.paths.map((q, i) => {
      const p = q.p, cum = [0];
      for (let k = 1; k < p.length; k++) cum.push(cum[k - 1] + Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]));
      return { i, p, cum, len: cum[cum.length - 1], a: q.a, b: q.b, name: data.names[q.n], bridge: !!(q.f & 1), tunnel: !!(q.f & 2),
        earth: !!(q.f & 4), gravel: !!(q.f & 8), wood: !!(q.f & 16), foot: !!(q.f & 32), deck: null, drawn: null };
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
      if ((P.bridge && !P.deck) || P.tunnel) continue;
      const [ax, az] = P.p[l[q + 1]], [bx, bz] = P.p[l[q + 1] + 1];
      if (segD(x, z, ax, az, bx, bz) < pathHW(P) + (P.earth ? 0.5 : 0.9)) return true;
    }
    return false;
  }

  /** The nearest point on a rideable path within maxD: { P, s, d } or null
   *  (`walk`: any walkable path, foot-only trails included). */
  nearest(x, z, maxD = 40, walk = false) {
    let best = null, bd = maxD;
    const c0 = Math.floor((x - maxD) / CELL), c1 = Math.floor((x + maxD) / CELL);
    const d0 = Math.floor((z - maxD) / CELL), d1 = Math.floor((z + maxD) / CELL);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const l = this.grid.get(cx * 100003 + cz);
      if (!l) continue;
      for (let q = 0; q < l.length; q += 2) {
        const P = this.paths[l[q]];
        if (!(walk ? P.walk : P.ride)) continue;
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
    // Which pieces are drawn, path by path, is kept by the boot cache
    // (bootcache.js memo): the water, road and building tests over ~100k
    // pieces were ~0.2 s of a phone's boot.
    let pieces = 0;
    for (const P of this.paths) {
      if (P.bridge || P.tunnel) continue;
      for (let k = 0; k < P.p.length - 1; k++) pieces += Math.max(1, Math.ceil(Math.hypot(P.p[k + 1][0] - P.p[k][0], P.p[k + 1][1] - P.p[k][1]) / 4));
    }
    const kept = memoPeek('bikes:drawn', (v) => v instanceof Uint8Array && v.length === pieces);
    const flags = [];
    let fi = 0;
    for (const P of this.paths) {
      // a bridge is ridden only where its deck is drawn (kwnature.js sets P.deck)
      P.walk = (!P.bridge || !!P.deck) && !P.tunnel && P.len > 4;
      P.ride = P.walk && !P.foot;
      if (P.bridge || P.tunnel) continue;
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
        // (a boardwalk crosses the marsh: it is drawn over water)
        const ok = kept ? kept[fi++] === 1 : (P.wood || !G.isWater(mx, mz)) && !city.onRoad(mx, mz, 0.2, false, false) && !inBld(mx, mz);
        if (!kept) flags.push(ok ? 1 : 0);
        drawn.push(ok);
        if (!ok) continue;
        // drawn when its chunk first comes into range (see _drawSeg)
        chunk(mx, mz).segs.push(pts, L, i, P);
        km += (pts[i + 1][2] - pts[i][2]) / 1000;
      }
      P.drawn = drawn;
    }
    if (!kept) memoPut('bikes:drawn', Uint8Array.from(flags));
    this.km = km;
    this.group = new THREE.Group();
    this.group.name = 'bikepaths';
    // BUILT WHEN FIRST IN RANGE (update), not at boot: ~190 km of ribbons
    // were ~1 s of every phone launch and 33 MB of arrays, almost all of it
    // out of the 1 km (600 m) it is drawn within.
    this.chunks = [];
    // Auto KW: other ground detail drawn into these chunks (kwnature.js
    // groundDetail: the river banks' stone, the trails' benches) -- a chunk
    // with only that is a chunk too
    const ex = this.ground ? this.ground.keys(CHUNK) : null;
    if (ex) for (const k of ex) {
      if (chunks.has(k)) continue;
      const [i, j] = k.split(',').map(Number);
      chunks.set(k, { segs: [], x: (i + 0.5) * CHUNK, z: (j + 0.5) * CHUNK });
    }
    for (const [key, c] of chunks) if (c.segs.length || (ex && ex.has(key))) this.chunks.push({ key, segs: c.segs, m: null, x: c.x, z: c.z, ex: !!(ex && ex.has(key)) });
    scene.add(this.group);
  }

  /** A lost WebGL context: on a phone the meshes' arrays are gone (see
   *  _build), so they go, and are built again when next in range. */
  contextLost() {
    for (const c of this.chunks) if (c.m) { this.group.remove(c.m); c.m.geometry.dispose(); c.m = null; }
  }

  /** One ~4 m piece of path i..i+1: the ribbon, its middle the surface's
   *  colour and its edges going toward the grass (a trail's edges are worn
   *  in and grown over; KW paints no lines on them). A boardwalk is a
   *  raised timber deck with its edge boards, over whatever is under it. */
  _drawSeg(b, pts, L, i, P) {
    const hw = pathHW(P);
    const wood = P.wood;
    const ground = (x, z) => {
      const t = G.terrainHeight(x, z);
      if (!wood) return t + LIFT;
      const w = G.waterLevel(x, z);
      return Math.max(t, w === null ? -1e9 : w) + WOOD_LIFT;
    };
    const V = (i2, o) => {
      const x = pts[i2][0] + L[i2][0] * o, z = pts[i2][1] + L[i2][1] * o;
      return [x, ground(x, z), z];
    };
    const col = wood ? WOOD : P.earth ? EARTH : P.gravel ? GRAVEL : ASPHALT;
    // a little variation along the path, by the piece's place in it
    const k = 0.93 + 0.14 * frac(Math.sin(pts[i][2] * 0.137 + P.i) * 43758.5);
    const mid = [col[0] * k, col[1] * k, col[2] * k];
    const e = wood ? 0.85 : P.earth ? 0.55 : P.gravel ? 0.4 : 0.22;
    const edge = wood ? [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8]
      : [mid[0] + (EDGE_GRASS[0] - mid[0]) * e, mid[1] + (EDGE_GRASS[1] - mid[1]) * e, mid[2] + (EDGE_GRASS[2] - mid[2]) * e];
    const n = [0, 1, 0], uv = [0, 0, 1, 0, 1, 1, 0, 1];
    for (const [o0, o1] of [[-hw, 0], [0, hw]]) {
      const c0 = o0 === 0 ? mid : edge, c1 = o1 === 0 ? mid : edge;
      b.quad(V(i, o0), V(i, o1), V(i + 1, o1), V(i + 1, o0), n, uv, [c0, c1, c1, c0]);
    }
    if (!wood) return;
    // the boardwalk's sides down to the ground, and its edge boards
    for (const sg of [-1, 1]) {
      const a = V(i, sg * hw), c = V(i + 1, sg * hw);
      const nn = [L[i][0] * sg, 0, L[i][1] * sg];
      const dk = [col[0] * 0.55, col[1] * 0.55, col[2] * 0.55];
      b.quad(a, c, [c[0], c[1] - WOOD_LIFT - 0.3, c[2]], [a[0], a[1] - WOOD_LIFT - 0.3, a[2]], nn, uv, dk);
      const a2 = V(i, sg * (hw - 0.12)), c2 = V(i + 1, sg * (hw - 0.12));
      b.quad([a[0], a[1] + 0.12, a[2]], [c[0], c[1] + 0.12, c[2]], [c2[0], c2[1] + 0.12, c2[2]], [a2[0], a2[1] + 0.12, a2[2]], n, uv, edge);
      b.quad(a, c, [c[0], c[1] + 0.12, c[2]], [a[0], a[1] + 0.12, a[2]], nn, uv, edge);
    }
  }

  _build(c) {
    const b = new ChunkBuilder(false, 1024);
    const S = c.segs;
    // (segs are kept -- a few references into each path's points -- so a
    // chunk dropped on a lost context can be built again)
    for (let k = 0; k < S.length; k += 4) this._drawSeg(b, S[k], S[k + 1], S[k + 2], S[k + 3]);
    if (c.ex && this.ground) this.ground.draw(b, c.x - CHUNK / 2, c.z - CHUNK / 2, CHUNK);
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

const frac = (v) => v - Math.floor(v);

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
    this.walkers = [];
    this.peds = null;   // set by main.js: the walkers are its pedestrians
    this.walkT = 0;
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
    if (this.peds) this._walkers(dt, p);
  }

  /** The walkers: spawned 90-260 m out on a walkable trail (foot-only ones
   *  too), steered along it through peds.js `p.trail`, turned round at a dead
   *  end, gone out of range or once the crowd code has taken them (a fall). */
  _walkers(dt, p) {
    const net = this.net, peds = this.peds;
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i], q = w.p;
      if (!q.h.group.parent || q.state === 'down') { q.trail = null; this.walkers.splice(i, 1); continue; }
      if (Math.hypot(q.x - p.x, q.z - p.z) > WALK_RANGE + 60) { peds.remove(q); this.walkers.splice(i, 1); continue; }
      // along the path at the walker's own pace; at its end, onto another
      w.s += w.dir * Math.max(q.speed, 0.2) * dt;
      if (w.s < 0 || w.s > w.P.len) {
        const node = w.s < 0 ? w.P.ka : w.P.kb;
        const opts = (net.nodes.get(node) || []).filter((Q) => Q !== w.P && Q.walk);
        if (opts.length) {
          const Q = opts[Math.floor(Math.random() * opts.length)];
          w.P = Q;
          if (Q.ka === node) { w.dir = 1; w.s = 0; } else { w.dir = -1; w.s = Q.len; }
        } else { w.dir = -w.dir; w.s = clamp(w.s, 0, w.P.len); }
      }
      // the point 2.5 m ahead, kept right of the middle
      const pt = net.at(w.P, w.s + w.dir * 2.5);
      const h = w.dir > 0 ? pt.h : pt.h + Math.PI;
      q.trail.x = pt.x - Math.cos(h) * w.side; q.trail.z = pt.z + Math.sin(h) * w.side;
      q.trail.speed = w.speed;
    }
    this.walkT -= dt;
    if (this.walkT > 0 || this.walkers.length >= WALKERS) return;
    this.walkT = 1.1;
    const a = Math.random() * Math.PI * 2, rr = 90 + Math.random() * 170;
    const n = net.nearest(p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr, 70, true);
    if (!n || n.P.len < 20) return;
    const dir = Math.random() < 0.5 ? 1 : -1, pt = net.at(n.P, n.s);
    const side = 0.35 + Math.random() * 0.3;
    const h = dir > 0 ? pt.h : pt.h + Math.PI;
    const x = pt.x - Math.cos(h) * side, z = pt.z + Math.sin(h) * side;
    if (G.isWater(x, z) && !n.P.wood) return;
    // out for a walk on a trail, not on a street's cycle track (the crowd
    // has the pavements)
    if (/\b(street|avenue|road|drive|boulevard|parkway|way)\b/i.test(n.P.name || '') || this.city.onRoad(x, z, 7)) return;
    const q = peds.spawnTrail(x, z, G.terrainHeight(x, z) + 1, h, p.x, p.z);
    if (!q) return;
    this.walkers.push({ p: q, P: n.P, s: n.s, dir, side, speed: 1.15 + Math.random() * 0.4 });
    this.stats.walkers = (this.stats.walkers || 0) + 1;
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
    // (on a bridge deck kwnature.js drew: the deck, a city platform)
    const deck = r.P.deck ? this.city.platformAt(x, z) : null;
    const y = deck !== null ? deck : G.terrainHeight(x, z) + LIFT;
    const ahead = deck !== null ? deck : G.terrainHeight(x + Math.sin(r.h) * 0.6, z + Math.cos(r.h) * 0.6);
    v.x = x; v.z = z; v.y = y;
    v.heading = r.h;
    v.pitch = deck !== null ? 0 : -Math.atan2(ahead - (y - LIFT), 0.6);
    // lean into the turn, from the rate of turn at this speed
    const rate = dt > 0 ? dh * Math.min(1, dt * 6) / dt : 0;
    v.roll = v.roll + (clamp(-Math.atan(rate * v.vLong / 9.8), -0.35, 0.35) - v.roll) * Math.min(1, dt * 5);
    v.wheelSpin += (v.vLong / 0.345) * dt;
    v.pedaling = v.vLong > 0.5;
    v.sync();
  }
}
