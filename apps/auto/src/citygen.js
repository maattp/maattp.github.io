// Procedural build of the Seattle road graph and every building footprint.
// Runs once at load as a coroutine so the loading screen can animate.

import * as G from './geo.js';
import { rng, dirDeg, distToSeg, clamp, hash2, DEG } from './util.js';

export const CHUNK = 400;

const CLASS_HW = { hwy: 15, art: 9.5, st: 6.5, res: 5.5, ramp: 5.5 };
const CLASS_SPEED = { hwy: 30, art: 17, st: 12, res: 9, ramp: 14 };

// ---------------------------------------------------------------------------

class Graph {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this.cell = 45;
    this.grid = new Map();
  }
  _key(cx, cz) {
    return cx * 100003 + cz;
  }
  addNode(x, z, y, elev) {
    const cx = Math.floor(x / this.cell),
      cz = Math.floor(z / this.cell);
    const tol = elev ? 26 : 20;
    for (let ax = cx - 1; ax <= cx + 1; ax++) {
      for (let az = cz - 1; az <= cz + 1; az++) {
        const list = this.grid.get(this._key(ax, az));
        if (!list) continue;
        for (const ni of list) {
          const n = this.nodes[ni];
          if (!!n.elev !== !!elev) continue;
          if (elev && Math.abs(n.y - y) > 9) continue;
          const dx = n.x - x,
            dz = n.z - z;
          if (dx * dx + dz * dz < tol * tol) return ni;
        }
      }
    }
    const id = this.nodes.length;
    this.nodes.push({ x, z, y: y != null ? y : G.terrainHeight(x, z), elev: !!elev, e: [] });
    const k = this._key(cx, cz);
    let l = this.grid.get(k);
    if (!l) this.grid.set(k, (l = []));
    l.push(id);
    return id;
  }
  addEdge(a, b, cls, name) {
    if (a === b) return -1;
    const na = this.nodes[a],
      nb = this.nodes[b];
    for (const ei of na.e) {
      const e = this.edges[ei];
      if (e.a === b || e.b === b) return ei;
    }
    const dx = nb.x - na.x,
      dz = nb.z - na.z;
    const len = Math.hypot(dx, dz);
    if (len < 4) return -1;
    const id = this.edges.length;
    this.edges.push({
      a, b, cls, name,
      hw: CLASS_HW[cls] || 6.5,
      spd: CLASS_SPEED[cls] || 12,
      len,
      dx: dx / len,
      dz: dz / len,
      elev: na.elev || nb.elev,
    });
    na.e.push(id);
    nb.e.push(id);
    return id;
  }
}

// ---------------------------------------------------------------------------

function basis(rot) {
  return {
    ux: Math.sin(rot), uz: -Math.cos(rot),
    vx: Math.cos(rot), vz: Math.sin(rot),
  };
}

function polyRangeAlong(poly, ox, oz, ax, az) {
  let lo = Infinity, hi = -Infinity;
  for (const p of poly) {
    const t = (p[0] - ox) * ax + (p[1] - oz) * az;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return { lo, hi };
}

// ---------------------------------------------------------------------------

export function* cityGenerator() {
  const g = new Graph();
  const buildings = [];
  const reserved = [];
  const R = rng(20260725);

  yield { p: 0.02, msg: 'Surveying Puget Sound' };

  // --- 1. District street grids -------------------------------------------
  const districtNodes = [];
  let di = 0;
  for (const d of G.DISTRICTS) {
    const b = basis(d.rot);
    const ru = polyRangeAlong(d.poly, d.ox, d.oz, b.ux, b.uz);
    const rv = polyRangeAlong(d.poly, d.ox, d.oz, b.vx, b.vz);
    const i0 = Math.floor(ru.lo / d.spA), i1 = Math.ceil(ru.hi / d.spA);
    const j0 = Math.floor(rv.lo / d.spB), j1 = Math.ceil(rv.hi / d.spB);
    const nw = i1 - i0 + 1, nh = j1 - j0 + 1;
    const ids = new Int32Array(nw * nh).fill(-1);
    const pos = (i, j) => [
      d.ox + b.ux * (i * d.spA) + b.vx * (j * d.spB),
      d.oz + b.uz * (i * d.spA) + b.vz * (j * d.spB),
    ];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const [x, z] = pos(i, j);
        if (!G.pointInPolyCached(x, z, d)) continue;
        if (!G.isBuildable(x, z)) continue;
        ids[(i - i0) * nh + (j - j0)] = g.addNode(x, z, null, false);
      }
    }
    const isArt = (n) => d.arterial > 0 && ((n % d.arterial) + d.arterial) % d.arterial === 0;
    const link = (i, j, i2, j2, cls) => {
      const a = ids[(i - i0) * nh + (j - j0)];
      const c = ids[(i2 - i0) * nh + (j2 - j0)];
      if (a < 0 || c < 0) return;
      const [x1, z1] = pos(i, j), [x2, z2] = pos(i2, j2);
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
      if (!G.isBuildable(mx, mz)) return;
      g.addEdge(a, c, cls, d.name);
    };
    const streetCls = d.style === 'house' ? 'res' : 'st';
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j < j1; j++) link(i, j, i, j + 1, isArt(j) ? 'art' : streetCls);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i < i1; i++) link(i, j, i + 1, j, isArt(i) ? 'art' : streetCls);
    districtNodes.push({ d, b, i0, j0, i1, j1, nh, ids, pos });
    di++;
    if (di % 4 === 0) yield { p: 0.02 + 0.3 * (di / G.DISTRICTS.length), msg: 'Laying out ' + d.name };
  }

  yield { p: 0.34, msg: 'Pouring the freeways' };

  // --- 2. Arterials, highways, bridges, ramps ------------------------------
  const chain = (pts, cls, name) => {
    let prev = -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const steps = Math.max(1, Math.round(len / 55));
      for (let s = 0; s <= steps; s++) {
        if (i > 0 && s === 0) continue;
        const t = s / steps;
        const x = p[0] + (q[0] - p[0]) * t;
        const z = p[1] + (q[1] - p[1]) * t;
        const hasY = p[2] != null || q[2] != null;
        let y = null;
        if (hasY) {
          const y0 = p[2] != null ? p[2] : G.terrainHeight(p[0], p[1]);
          const y1 = q[2] != null ? q[2] : G.terrainHeight(q[0], q[1]);
          y = y0 + (y1 - y0) * t;
        }
        const ground = G.terrainHeight(x, z);
        const elev = hasY && y - ground > 3.5;
        const id = g.addNode(x, z, elev ? y : null, elev);
        if (prev >= 0) g.addEdge(prev, id, cls, name);
        prev = id;
      }
    }
  };

  for (const h of G.HIGHWAYS) chain(h.pts, h.cls, h.name);
  yield { p: 0.4, msg: 'Painting the arterials' };
  for (const a of G.ARTERIALS) chain(a.pts, 'art', a.name);
  for (const r of G.RAMPS) chain(r.pts, 'ramp', r.name);

  // Stitch elevated ramp ends into their decks and grounded ends into streets.
  yield { p: 0.46, msg: 'Welding the interchanges' };

  // --- 3. Segment index for building rejection ----------------------------
  const segCell = 90;
  const segGrid = new Map();
  const skey = (cx, cz) => cx * 100003 + cz;
  for (let ei = 0; ei < g.edges.length; ei++) {
    const e = g.edges[ei];
    const a = g.nodes[e.a], b = g.nodes[e.b];
    const x0 = Math.floor(Math.min(a.x, b.x) / segCell), x1 = Math.floor(Math.max(a.x, b.x) / segCell);
    const z0 = Math.floor(Math.min(a.z, b.z) / segCell), z1 = Math.floor(Math.max(a.z, b.z) / segCell);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const k = skey(cx, cz);
        let l = segGrid.get(k);
        if (!l) segGrid.set(k, (l = []));
        l.push(ei);
      }
  }
  const clearOfRoads = (x, z, pad) => {
    const cx = Math.floor(x / segCell), cz = Math.floor(z / segCell);
    for (let ax = cx - 1; ax <= cx + 1; ax++)
      for (let az = cz - 1; az <= cz + 1; az++) {
        const l = segGrid.get(skey(ax, az));
        if (!l) continue;
        for (const ei of l) {
          const e = g.edges[ei];
          if (e.elev) continue;
          const a = g.nodes[e.a], b = g.nodes[e.b];
          const r = distToSeg(x, z, a.x, a.z, b.x, b.z);
          if (r.d < e.hw + pad) return false;
        }
      }
    return true;
  };

  // --- 4. Reserved footprints (hand-placed towers + landmarks) -------------
  for (const t of G.TOWERS) reserved.push({ x: t.p[0], z: t.p[1], hw: t.w * 0.75, hd: t.d * 0.75, rot: G.DT_ROT });
  for (const l of G.LANDMARKS) {
    const x = l.p ? l.p[0] : l.x, z = l.p ? l.p[1] : l.z;
    reserved.push({ x, z, hw: 80, hd: 80, rot: 0 });
  }
  const isReserved = (x, z) => {
    for (const r of reserved) {
      const dx = x - r.x, dz = z - r.z;
      if (dx * dx + dz * dz > 40000) continue;
      const c = Math.cos(-r.rot), s = Math.sin(-r.rot);
      if (Math.abs(dx * c - dz * s) <= r.hw && Math.abs(dx * s + dz * c) <= r.hd) return true;
    }
    return false;
  };

  yield { p: 0.5, msg: 'Raising the skyline' };

  // --- 5. Buildings --------------------------------------------------------
  const LOTS = {
    tower: [[2, 2, 0.42], [2, 1, 0.28], [1, 1, 0.2], [3, 2, 0.1]],
    midrise: [[2, 2, 0.44], [2, 1, 0.3], [3, 2, 0.16], [1, 1, 0.1]],
    brick: [[2, 2, 0.44], [3, 2, 0.36], [2, 1, 0.2]],
    lowrise: [[2, 2, 0.55], [3, 2, 0.25], [2, 1, 0.2]],
    house: [[3, 2, 0.5], [3, 3, 0.3], [2, 2, 0.2]],
    industrial: [[1, 1, 0.5], [2, 1, 0.35], [2, 2, 0.15]],
    campus: [[1, 1, 1]],
  };
  const pickLot = (style) => {
    const t = LOTS[style] || LOTS.lowrise;
    let r = R.n();
    for (const o of t) {
      r -= o[2];
      if (r <= 0) return o;
    }
    return t[0];
  };

  let dn = 0;
  for (const dd of districtNodes) {
    const { d, b, i0, j0, i1, j1, pos } = dd;
    const hwRoad = (d.style === 'house' ? CLASS_HW.res : CLASS_HW.st) + 4.5;
    const halfU = d.spA / 2 - hwRoad;
    const halfV = d.spB / 2 - hwRoad;
    if (halfU < 6 || halfV < 6) continue;
    for (let i = i0; i < i1; i++) {
      for (let j = j0; j < j1; j++) {
        const [cx, cz] = pos(i + 0.5, j + 0.5);
        if (!G.pointInPolyCached(cx, cz, d)) continue;
        if (!G.isBuildable(cx, cz)) continue;
        const [nu, nv] = pickLot(d.style);
        const lu = (halfU * 2) / nu, lv = (halfV * 2) / nv;
        for (let a = 0; a < nu; a++) {
          for (let c = 0; c < nv; c++) {
            const offU = -halfU + lu * (a + 0.5);
            const offV = -halfV + lv * (c + 0.5);
            const bx = cx + b.ux * offU + b.vx * offV;
            const bz = cz + b.uz * offU + b.vz * offV;
            if (!G.isBuildable(bx, bz)) continue;
            if (G.inPark(bx, bz)) continue;
            if (isReserved(bx, bz)) continue;
            const margin = d.style === 'house' ? 3.5 : 1.6;
            let w = lu - margin * 2, dp = lv - margin * 2;
            if (w < 6 || dp < 6) continue;
            const hs = hash2(Math.round(bx), Math.round(bz));
            if (hs > d.cover) continue;
            if (!clearOfRoads(bx, bz, 3 + Math.max(w, dp) * 0.28)) continue;
            // Height: taller near the core, with a long tail.
            const coreD = Math.hypot(bx - 180, bz - 320);
            const coreBoost = clamp(1.35 - coreD / 1800, 0.6, 1.35);
            const t = Math.pow(R.n(), 2.1);
            let h = (d.minH + (d.maxH - d.minH) * t) * (d.style === 'house' ? 1 : coreBoost);
            h = Math.max(d.minH * 0.9, h);
            if (d.style === 'house') {
              w = Math.min(w, 16);
              dp = Math.min(dp, 15);
            }
            buildings.push({
              x: bx, z: bz, w, d: dp, rot: d.rot, h,
              y: G.terrainHeight(bx, bz),
              style: d.style,
              seed: (hs * 65536) | 0,
              kind: null,
            });
          }
        }
      }
    }
    dn++;
    if (dn % 3 === 0) yield { p: 0.5 + 0.34 * (dn / districtNodes.length), msg: 'Building ' + d.name };
  }

  // Hand-placed towers on top.
  for (const t of G.TOWERS) {
    buildings.push({
      x: t.p[0], z: t.p[1], w: t.w, d: t.d, rot: G.DT_ROT, h: t.h,
      y: G.terrainHeight(t.p[0], t.p[1]),
      style: 'tower', seed: (t.h * 977) | 0, kind: t.kind, name: t.name,
    });
  }

  yield { p: 0.88, msg: 'Indexing the city' };

  // --- 6. Chunk index ------------------------------------------------------
  const chunks = new Map();
  const ck = (cx, cz) => cx * 100003 + cz;
  const getChunk = (cx, cz) => {
    const k = ck(cx, cz);
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { cx, cz, edges: [], buildings: [] }));
    return c;
  };
  for (let ei = 0; ei < g.edges.length; ei++) {
    const e = g.edges[ei];
    const a = g.nodes[e.a], b = g.nodes[e.b];
    const x0 = Math.floor(Math.min(a.x, b.x) / CHUNK), x1 = Math.floor(Math.max(a.x, b.x) / CHUNK);
    const z0 = Math.floor(Math.min(a.z, b.z) / CHUNK), z1 = Math.floor(Math.max(a.z, b.z) / CHUNK);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) getChunk(cx, cz).edges.push(ei);
  }
  for (let bi = 0; bi < buildings.length; bi++) {
    const bd = buildings[bi];
    getChunk(Math.floor(bd.x / CHUNK), Math.floor(bd.z / CHUNK)).buildings.push(bi);
  }

  // --- 7. Elevated deck surfaces for vehicle physics -----------------------
  const surfaces = [];
  for (const e of g.edges) {
    if (!e.elev) continue;
    const a = g.nodes[e.a], b = g.nodes[e.b];
    surfaces.push({ ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, hw: e.hw + 1.5 });
  }
  const surfCell = 120;
  const surfGrid = new Map();
  for (let si = 0; si < surfaces.length; si++) {
    const s = surfaces[si];
    const x0 = Math.floor((Math.min(s.ax, s.bx) - s.hw) / surfCell), x1 = Math.floor((Math.max(s.ax, s.bx) + s.hw) / surfCell);
    const z0 = Math.floor((Math.min(s.az, s.bz) - s.hw) / surfCell), z1 = Math.floor((Math.max(s.az, s.bz) + s.hw) / surfCell);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const k = skey(cx, cz);
        let l = surfGrid.get(k);
        if (!l) surfGrid.set(k, (l = []));
        l.push(si);
      }
  }

  // --- 8. Building collision index ----------------------------------------
  const bCell = 60;
  const bGrid = new Map();
  for (let bi = 0; bi < buildings.length; bi++) {
    const bd = buildings[bi];
    const r = Math.max(bd.w, bd.d) * 0.75;
    const x0 = Math.floor((bd.x - r) / bCell), x1 = Math.floor((bd.x + r) / bCell);
    const z0 = Math.floor((bd.z - r) / bCell), z1 = Math.floor((bd.z + r) / bCell);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const k = skey(cx, cz);
        let l = bGrid.get(k);
        if (!l) bGrid.set(k, (l = []));
        l.push(bi);
      }
  }

  // --- 9. Node spatial index for AI ---------------------------------------
  const nCell = 150;
  const nGrid = new Map();
  for (let ni = 0; ni < g.nodes.length; ni++) {
    const n = g.nodes[ni];
    const k = skey(Math.floor(n.x / nCell), Math.floor(n.z / nCell));
    let l = nGrid.get(k);
    if (!l) nGrid.set(k, (l = []));
    l.push(ni);
  }

  const drivable = [];
  for (let ei = 0; ei < g.edges.length; ei++) if (g.edges[ei].len > 15) drivable.push(ei);

  yield { p: 0.96, msg: 'Opening the streets' };

  return {
    nodes: g.nodes,
    edges: g.edges,
    buildings,
    chunks,
    chunkKey: ck,
    drivable,
    surfaces,

    /** Ground height accounting for bridge decks under the given Y. */
    groundAt(x, z, curY) {
      const terr = G.terrainHeight(x, z);
      let best = terr;
      const l = surfGrid.get(skey(Math.floor(x / surfCell), Math.floor(z / surfCell)));
      if (l) {
        for (const si of l) {
          const s = surfaces[si];
          const r = distToSeg(x, z, s.ax, s.az, s.bx, s.bz);
          if (r.d > s.hw) continue;
          const y = s.ay + (s.by - s.ay) * r.t;
          if (curY == null || y <= curY + 2.6) {
            if (y > best) best = y;
          }
        }
      }
      return best;
    },

    buildingsNear(x, z, rad) {
      const out = [];
      const c0 = Math.floor((x - rad) / bCell), c1 = Math.floor((x + rad) / bCell);
      const d0 = Math.floor((z - rad) / bCell), d1 = Math.floor((z + rad) / bCell);
      const seen = new Set();
      for (let cx = c0; cx <= c1; cx++)
        for (let cz = d0; cz <= d1; cz++) {
          const l = bGrid.get(skey(cx, cz));
          if (!l) continue;
          for (const bi of l) {
            if (seen.has(bi)) continue;
            seen.add(bi);
            out.push(buildings[bi]);
          }
        }
      return out;
    },

    nearestNode(x, z, maxR = 260) {
      let best = -1, bd = maxR * maxR;
      const c0 = Math.floor((x - maxR) / nCell), c1 = Math.floor((x + maxR) / nCell);
      const d0 = Math.floor((z - maxR) / nCell), d1 = Math.floor((z + maxR) / nCell);
      for (let cx = c0; cx <= c1; cx++)
        for (let cz = d0; cz <= d1; cz++) {
          const l = nGrid.get(skey(cx, cz));
          if (!l) continue;
          for (const ni of l) {
            const n = g.nodes[ni];
            const dd = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
            if (dd < bd) { bd = dd; best = ni; }
          }
        }
      return best;
    },

    /** Edges whose centre lies within `rad` of (x,z). */
    edgesNear(x, z, rad) {
      const out = [];
      const c0 = Math.floor((x - rad) / CHUNK), c1 = Math.floor((x + rad) / CHUNK);
      const d0 = Math.floor((z - rad) / CHUNK), d1 = Math.floor((z + rad) / CHUNK);
      for (let cx = c0; cx <= c1; cx++)
        for (let cz = d0; cz <= d1; cz++) {
          const c = chunks.get(ck(cx, cz));
          if (!c) continue;
          for (const ei of c.edges) out.push(ei);
        }
      return out;
    },
  };
}
