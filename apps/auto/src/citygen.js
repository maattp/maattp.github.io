// Procedural build of the Seattle road graph and every building footprint.
// Runs once at load as a coroutine so the loading screen can animate.

import * as G from './geo.js';
import { rng, dirDeg, distToSeg, clamp, hash2, DEG } from './util.js';

export const CHUNK = 400;

// Road and sidewalk surfaces are drawn slightly proud of the terrain so they
// don't z-fight it. Anything that stands ON them has to be lifted by the same
// amount or it sinks into the asphalt -- these are the single source of truth,
// shared with world.js.
export const ROAD_LIFT = 0.22;
export const NODE_LIFT = 0.25;
export const WALK_LIFT = 0.44;

const CLASS_HW = { hwy: 15, art: 9.5, st: 6.5, res: 5.5, ramp: 5.5 };
// Widest half-width any junction square can reach, so a lift query knows how
// far to look for one without scanning the whole node grid.
const MAX_HW = Math.max(...Object.values(CLASS_HW));
// Widest pavement a junction ring can carry, for the same reason.
const MAX_WALK = 3.2;
// How far a paved surface tapers out at its outer edge, so nothing steps off a
// cliff. Note this is the only place the lift is smoothed: the kerb between
// road and pavement is a real 22 cm step and the query has to report it,
// because world.js draws it that way. Smoothing belongs in the character and
// the camera -- soften it here and you sink into the kerb instead.
const RAMP = 0.5;
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

function polyArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(a / 2);
}

/**
 * Decide which district owns a patch of ground, so only one street grid is
 * laid on it.
 *
 * The district polygons are hand-drawn and 25 of the 32 overlap something --
 * Belltown is 62% covered by Uptown and South Lake Union. That is survivable
 * where the neighbours share a street angle, and ruinous where they don't:
 * downtown's grid runs 58 deg off true north and its neighbours' run true, so
 * laying both over the same block gives two sets of streets crossing at 58 deg
 * with no junctions. That is what makes the map read as scribble.
 *
 * The smallest polygon covering a point wins, which is the rule that matches
 * how the data is drawn: a small specific neighbourhood sits inside a large
 * sprawling one and should keep its own grid. Equal areas fall back to
 * declaration order, so the result never depends on sort stability.
 */
function districtOwner() {
  const bbox = (p) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of p) {
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      if (q[1] < z0) z0 = q[1];
      if (q[1] > z1) z1 = q[1];
    }
    return { x0, x1, z0, z1 };
  };
  const meta = G.DISTRICTS.map((d, i) => ({ d, i, area: polyArea(d.poly), bb: bbox(d.poly) }));
  // For each district, only the higher-priority districts it could overlap at
  // all -- usually one or two, so this stays a couple of point-in-poly tests.
  const rivals = new Map();
  for (const m of meta) {
    rivals.set(m.d, meta.filter((o) => o !== m
      && (o.area < m.area || (o.area === m.area && o.i < m.i))
      && o.bb.x0 <= m.bb.x1 && o.bb.x1 >= m.bb.x0
      && o.bb.z0 <= m.bb.z1 && o.bb.z1 >= m.bb.z0).map((o) => o.d));
  }
  return (d, x, z) => {
    for (const o of rivals.get(d)) if (G.pointInPolyCached(x, z, o)) return false;
    return true;
  };
}

/**
 * Split every pair of crossing ground-level edges and put a node at the
 * crossing.
 *
 * An arterial drawn straight through a district's street grid otherwise just
 * passes over it -- 896 crossings carried no junction node at all, which is
 * both why the map looked like roads stacked on each other and why traffic
 * could never turn off an arterial. Elevated edges are left alone: a bridge
 * over a street is a crossing that is supposed to have no junction.
 */
function planarize(g) {
  const CELL = 120;
  const gk = (a, b) => a * 100003 + b;
  const grid = new Map();
  for (let ei = 0; ei < g.edges.length; ei++) {
    const e = g.edges[ei];
    if (e.elev) continue;
    const a = g.nodes[e.a], b = g.nodes[e.b];
    const steps = Math.max(1, Math.ceil(e.len / CELL));
    for (let s = 0; s <= steps; s++) {
      const x = a.x + (b.x - a.x) * s / steps, z = a.z + (b.z - a.z) * s / steps;
      const k = gk(Math.floor(x / CELL), Math.floor(z / CELL));
      let l = grid.get(k);
      if (!l) grid.set(k, (l = new Set()));
      l.add(ei);
    }
  }
  const splits = new Map();
  const addSplit = (ei, t, ni) => {
    let l = splits.get(ei);
    if (!l) splits.set(ei, (l = []));
    l.push({ t, ni });
  };
  const seen = new Set();
  for (const list of grid.values()) {
    const arr = [...list];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const ei = arr[i], ej = arr[j];
        const pk = ei < ej ? ei * 100000 + ej : ej * 100000 + ei;
        if (seen.has(pk)) continue;
        seen.add(pk);
        const e1 = g.edges[ei], e2 = g.edges[ej];
        // already meeting at a node is a junction, not a crossing
        if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) continue;
        const p = g.nodes[e1.a], q = g.nodes[e1.b];
        const r = g.nodes[e2.a], s = g.nodes[e2.b];
        const d1x = q.x - p.x, d1z = q.z - p.z;
        const d2x = s.x - r.x, d2z = s.z - r.z;
        const den = d1x * d2z - d1z * d2x;
        if (Math.abs(den) < 1e-9) continue; // parallel
        const t = ((r.x - p.x) * d2z - (r.z - p.z) * d2x) / den;
        const u = ((r.x - p.x) * d1z - (r.z - p.z) * d1x) / den;
        if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
        // addNode snaps to an existing node within its tolerance, so crossings
        // that land on top of one another become a single junction
        const ni = g.addNode(p.x + d1x * t, p.z + d1z * t, null, false);
        addSplit(ei, t, ni);
        addSplit(ej, u, ni);
      }
    }
  }
  if (!splits.size) return 0;
  const specs = [];
  for (let ei = 0; ei < g.edges.length; ei++) {
    const e = g.edges[ei];
    const l = splits.get(ei);
    if (!l) { specs.push([e.a, e.b, e.cls, e.name]); continue; }
    l.sort((m, n) => m.t - n.t);
    let prev = e.a;
    for (const sp of l) {
      if (sp.ni !== prev) specs.push([prev, sp.ni, e.cls, e.name]);
      prev = sp.ni;
    }
    if (prev !== e.b) specs.push([prev, e.b, e.cls, e.name]);
  }
  // addEdge recomputes length/heading and drops the sub-4 m slivers a split can
  // leave behind, so rebuild through it rather than patching the arrays.
  g.edges = [];
  for (const n of g.nodes) n.e = [];
  for (const sp of specs) g.addEdge(sp[0], sp[1], sp[2], sp[3]);
  return splits.size;
}

// ---------------------------------------------------------------------------

export function* cityGenerator() {
  const g = new Graph();
  const buildings = [];
  const reserved = [];
  const R = rng(20260725);

  yield { p: 0.02, msg: 'Surveying Puget Sound' };

  // --- 1. District street grids -------------------------------------------
  const owns = districtOwner();
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
        if (!owns(d, x, z)) continue; // a denser neighbour's grid holds this ground
        if (G.inPark(x, z)) continue; // parks aren't blocks; see the note in link()
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
      if (!owns(d, mx, mz)) return; // don't reach across into a neighbour's grid
      // The block grid does not run through a park. Buildings already skip
      // parks, so paving one left a green rectangle with streets crossing it and
      // nothing on them -- a road to nowhere. The hand-drawn arterials and
      // highways in step 2 still go where they are drawn, which is right:
      // Aurora really does cut through Woodland Park.
      if (G.inPark(mx, mz)) return;
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

  // Every ground-level crossing becomes a real junction. Do this before the
  // segment index below, which reads the final edge list.
  planarize(g);
  yield { p: 0.48, msg: 'Cutting the intersections' };

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
  /**
   * How much a footprint has to shrink to clear every ground-level road --
   * carriageway and pavement both. Returns a scale in (0,1], or 0 if the lot
   * is unsalvageable.
   *
   * Two things this gets right that the old radius test didn't. The lot is
   * measured as the rotated RECTANGLE it actually is: a bounding circle can't
   * work, because one that contains the rectangle rejects most of a block and
   * anything smaller lets the corners stand in the carriageway -- which is what
   * a pad of `3 + max(w,d) * 0.28` did, at only ~60% of the half-diagonal it
   * needed to be. And an oversized lot is SHRUNK rather than dropped: a block
   * that came out as one big lot legitimately overlaps the road, and rejecting
   * it outright empties the whole block instead of putting a smaller building
   * on it.
   */
  const roadFit = (x, z, w, d, rot, margin) => {
    const hw = w / 2 + margin, hd = d / 2 + margin;
    let fit = 1;
    const ux = Math.cos(rot), uz = Math.sin(rot); // lot's local +x in world
    const vx = -Math.sin(rot), vz = Math.cos(rot); // lot's local +z in world
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
          if (r.d < 1e-4) return 0;
          // Buildings front the pavement, so clear that too -- same widths the
          // sidewalk strips and roadLift() use.
          const walk = (e.cls === 'st' || e.cls === 'art' || e.cls === 'res')
            ? (e.cls === 'art' ? 3.2 : 2.6) : 0;
          // How far the rectangle reaches along the line to this road: the
          // support function of a box, |hw*(u.n)| + |hd*(v.n)|.
          const nx = (x - r.x) / r.d, nz = (z - r.z) / r.d;
          const reach = Math.abs(hw * (ux * nx + uz * nz))
            + Math.abs(hd * (vx * nx + vz * nz));
          const room = r.d - e.hw - walk;
          if (room <= 0) return 0; // centre is in the road; nothing to salvage
          if (reach > room) fit = Math.min(fit, room / reach);
        }
      }
    return fit;
  };

  /**
   * Where a hand-placed tower can actually stand.
   *
   * The towers carry real Seattle footprints and real coordinates, but the road
   * grid under them is procedural and is laid out with no knowledge of them --
   * and several of these footprints are simply wider than the block interior
   * they land in (Columbia Center is 62 m across; a downtown block leaves about
   * 60 x 42 m between kerbs). Left alone, 17 of the 22 have a street through
   * them and 5 have their centre in a live carriageway.
   *
   * So: keep the tower, and look for the nearest spot where it fits, growing
   * the search outward so the smallest displacement wins. Whatever still
   * doesn't fit gets shrunk, down to a floor -- past that point a landmark has
   * stopped being recognisable and it's better to leave it slightly proud.
   */
  const placeTower = (x, z, w, d) => {
    const MIN_SCALE = 0.62;
    let best = null;
    for (let ring = 0; ring <= 16; ring++) {
      const rad = ring * 3.5;
      const steps = ring === 0 ? 1 : ring * 8;
      for (let k = 0; k < steps; k++) {
        const th = (k / steps) * Math.PI * 2;
        const cx = x + Math.cos(th) * rad, cz = z + Math.sin(th) * rad;
        if (!G.isBuildable(cx, cz) || G.inPark(cx, cz)) continue;
        // don't solve a road clash by parking a tower on the Space Needle
        if (G.LANDMARKS.some((l) => {
          const lx = l.p ? l.p[0] : l.x, lz = l.p ? l.p[1] : l.z;
          return Math.abs(cx - lx) <= 80 && Math.abs(cz - lz) <= 80;
        })) continue;
        const fit = Math.min(1, roadFit(cx, cz, w, d, G.DT_ROT, 0.6));
        if (fit <= 0) continue;
        const score = fit - rad * 0.0015; // fit first, then stay near home
        if (!best || score > best.score) best = { x: cx, z: cz, fit, rad, score };
      }
      if (best && best.fit >= 1) break; // a perfect spot this close won't be beaten
    }
    if (!best) return { x, z, scale: MIN_SCALE, moved: 0, fitted: false };
    const scale = Math.max(MIN_SCALE, best.fit);
    return { x: best.x, z: best.z, scale, moved: best.rad, fitted: best.fit >= 1 };
  };
  const towerAt = new Map();
  for (const t of G.TOWERS) towerAt.set(t, placeTower(t.p[0], t.p[1], t.w, t.d));

  // --- 4. Reserved footprints (hand-placed towers + landmarks) -------------
  for (const t of G.TOWERS) {
    const p = towerAt.get(t);
    reserved.push({ x: p.x, z: p.z, hw: t.w * p.scale * 0.75, hd: t.d * p.scale * 0.75, rot: G.DT_ROT });
  }
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
        if (!owns(d, cx, cz)) continue; // blocks belong to whoever owns the grid
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
            // Pull the lot back off the road rather than dropping it, then
            // re-check the minimum: a shrunk-to-nothing lot is still no lot.
            const fit = roadFit(bx, bz, w, dp, d.rot, 0.8);
            if (fit <= 0) continue;
            if (fit < 1) { w *= fit; dp *= fit; }
            if (w < 6 || dp < 6) continue;
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

  // Hand-placed towers on top, at the spot placeTower() found for each.
  for (const t of G.TOWERS) {
    const p = towerAt.get(t);
    buildings.push({
      x: p.x, z: p.z, w: t.w * p.scale, d: t.d * p.scale, rot: G.DT_ROT, h: t.h,
      y: G.terrainHeight(p.x, p.z),
      style: 'tower', seed: (t.h * 977) | 0, kind: t.kind, name: t.name,
    });
  }

  // Nothing may stand where the player gets put down. This used to hold by
  // luck -- SPAWN sits on a block edge -- until lots started being shrunk to
  // fit instead of dropped, which put a tower back on 4th & Olive. Inside a
  // footprint, blocked() refuses every direction and the player is stuck for
  // good, walking on the spot.
  const CLEAR = 2.2; // player's collision half-width, plus room to turn around
  for (let bi = buildings.length - 1; bi >= 0; bi--) {
    const bd = buildings[bi];
    const c = Math.cos(-bd.rot), s = Math.sin(-bd.rot);
    for (const p of G.KEEP_CLEAR) {
      const dx = p.x - bd.x, dz = p.z - bd.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < bd.w / 2 + CLEAR && Math.abs(lz) < bd.d / 2 + CLEAR) {
        buildings.splice(bi, 1);
        break;
      }
    }
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

    /**
     * How far the paved surface at (x,z) sits above the raw terrain. Callers
     * that sample the ground many times per frame (vehicles take five) should
     * compute this once for the body centre and pass it in, rather than paying
     * for the edge scan on every sample.
     */
    roadLift(x, z) {
      // A junction square is drawn at NODE_LIFT and covers the ends of every
      // strip that meets there, so inside one it IS the surface -- take it
      // outright rather than maxing against the strips the scan below reports.
      // Without this a car crossing an intersection samples ROAD_LIFT and sits
      // 3 cm inside the asphalt, which is the sinking-car bug in miniature.
      const ns = this.nodeSurface(x, z);
      if (ns && ns.inSquare) return ns.lift;

      let lift = 0;
      const c0 = Math.floor(x / CHUNK), d0 = Math.floor(z / CHUNK);
      for (let cx = c0 - 1; cx <= c0 + 1; cx++) {
        for (let cz = d0 - 1; cz <= d0 + 1; cz++) {
          const c = chunks.get(ck(cx, cz));
          if (!c) continue;
          for (const ei of c.edges) {
            const e = g.edges[ei];
            if (e.elev) continue;
            const a = g.nodes[e.a], b = g.nodes[e.b];
            const r = distToSeg(x, z, a.x, a.z, b.x, b.z);
            const walk = (e.cls === 'st' || e.cls === 'art' || e.cls === 'res')
              ? (e.cls === 'art' ? 3.2 : 2.6) : 0;
            const outer = e.hw + walk;
            if (r.d > outer) continue;
            let l = r.d <= e.hw ? ROAD_LIFT : WALK_LIFT;
            // taper the last half metre so nothing steps off a cliff edge
            if (r.d > outer - RAMP) l *= (outer - r.d) / RAMP;
            if (l > lift) lift = l;
          }
        }
      }
      // The pavement ring around a junction reaches past the end of every strip
      // -- its diagonal corners especially, which no radiating edge comes near.
      // Where the strips find nothing but the ring is drawn, the ring is what
      // you are standing on; without this you sink the full 44 cm at a corner.
      if (ns && lift <= 0) return ns.lift;
      return lift;
    },

    /**
     * What a junction paints at (x,z), or null if it paints nothing there.
     *
     * Mirrors world.meshNode() exactly, because the two have to agree or things
     * standing here sink into it: a square of carriageway at NODE_LIFT, sized
     * and oriented by the widest edge at the node, and a ring of pavement at
     * WALK_LIFT around it. `inSquare` marks the carriageway, which overrides the
     * strip scan outright; the ring only fills in where the strips find nothing,
     * since along a road direction the strips overlap it and know better.
     */
    nodeSurface(x, z) {
      const reach = MAX_HW + MAX_WALK;
      const c0 = Math.floor((x - reach) / nCell), c1 = Math.floor((x + reach) / nCell);
      const d0 = Math.floor((z - reach) / nCell), d1 = Math.floor((z + reach) / nCell);
      let ring = null;
      for (let cx = c0; cx <= c1; cx++) {
        for (let cz = d0; cz <= d1; cz++) {
          const l = nGrid.get(skey(cx, cz));
          if (!l) continue;
          for (const ni of l) {
            const n = g.nodes[ni];
            // elevated junctions ride their deck, not the terrain
            if (n.elev) continue;
            let hw = 0, rot = 0, sw = 0;
            for (const ei of n.e) {
              const e = g.edges[ei];
              if (e.hw > hw) { hw = e.hw; rot = Math.atan2(e.dx, -e.dz); }
              if (e.cls === 'st' || e.cls === 'art' || e.cls === 'res') {
                sw = Math.max(sw, e.cls === 'art' ? 3.2 : 2.6);
              }
            }
            if (hw <= 0) continue;
            // into the square's own frame: the inverse of meshNode's rotation
            const c = Math.cos(rot), s = Math.sin(rot);
            const ux = x - n.x, uz = z - n.z;
            const lx = Math.abs(ux * c + uz * s), lz = Math.abs(-ux * s + uz * c);
            if (lx <= hw && lz <= hw) return { lift: NODE_LIFT, inSquare: true };
            // meshNode only rings a junction that some street actually reaches
            if (sw > 0 && lx <= hw + sw && lz <= hw + sw) ring = { lift: WALK_LIFT, inSquare: false };
          }
        }
      }
      return ring;
    },

    /** Ground height accounting for paved lift and for bridge decks under Y. */
    groundAt(x, z, curY, lift) {
      const terr = G.terrainHeight(x, z) + (lift != null ? lift : this.roadLift(x, z));
      let best = terr;
      const l = surfGrid.get(skey(Math.floor(x / surfCell), Math.floor(z / surfCell)));
      if (l) {
        for (const si of l) {
          const s = surfaces[si];
          const r = distToSeg(x, z, s.ax, s.az, s.bx, s.bz);
          if (r.d > s.hw) continue;
          const y = s.ay + (s.by - s.ay) * r.t + ROAD_LIFT * 0.3;
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
