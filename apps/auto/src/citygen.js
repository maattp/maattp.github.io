// Builds the city from the imported OpenStreetMap graph and footprints.
//
// This file used to *generate* Seattle -- district street grids, hand-drawn
// arterials chained into the graph, then a long repair pipeline (planarize,
// stitch, dedupeGrid, districtOwner) to make the result coherent. None of that
// survives, because none of it is needed: OSM ways already form a planar graph
// where every ground-level crossing shares a node, and real footprints are not
// standing in real roads. What is left is decoding, indexing, and the surface
// queries -- roadLift / nodeSurface / groundAt -- which are unchanged, because
// they were never about where the roads came from.

import * as G from './geo.js';
import { CLS_NAME, F_ELEV, F_TUNNEL, F_ONEWAY, F_ONEWAY_REV } from './mapdata.js';
import { distToSeg, clamp, hash2 } from './util.js';

export const CHUNK = 400;

// Road and sidewalk surfaces are drawn slightly proud of the terrain so they
// don't z-fight it. Anything that stands ON them has to be lifted by the same
// amount or it sinks into the asphalt -- these are the single source of truth,
// shared with world.js.
export const ROAD_LIFT = 0.22;
export const NODE_LIFT = 0.25;
export const WALK_LIFT = 0.44;

// Half-widths now come per-edge from the import (real lane counts), so these are
// only the fallback and the bounds a lift query scans within.
const CLASS_HW = { hwy: 15, art: 9.5, st: 6.5, res: 5.5, ramp: 5.5 };
const MAX_HW = 20; // the widest half-width build_roads.py will emit
const MAX_WALK = 3.2;
// How far a paved surface tapers out at its outer edge, so nothing steps off a
// cliff. Note this is the only place the lift is smoothed: the kerb between
// road and pavement is a real 22 cm step and the query has to report it,
// because world.js draws it that way. Smoothing belongs in the character and
// the camera -- soften it here and you sink into the kerb instead.
const RAMP = 0.5;
const CLASS_SPEED = { hwy: 30, art: 17, st: 12, res: 9, ramp: 14 };

const walkWidth = (cls) => (cls === 'st' || cls === 'res' ? 2.6 : cls === 'art' ? 3.2 : 0);

// Building class (tools/build_buildings.py) + height -> facade style.
function styleFor(cls, h) {
  if (cls === 0) return 'house';
  if (cls === 1) return h > 25 ? 'midrise' : 'lowrise';
  if (cls === 3) return 'industrial';
  if (cls === 4) return 'campus';
  return h > 60 ? 'tower' : h > 22 ? 'midrise' : 'brick';
}

// ---------------------------------------------------------------------------

export function* cityGenerator(md) {
  yield { p: 0.02, msg: 'Unpacking the street graph' };

  // --- 1. Road graph ------------------------------------------------------
  const R = md.roads;
  const nodes = new Array(R.nodeCount);
  for (let i = 0; i < R.nodeCount; i++) {
    nodes[i] = { x: R.nx[i], z: R.nz[i], y: R.ny[i], elev: R.nElev[i] !== 0, e: [] };
  }
  const edges = new Array(R.edgeCount);
  for (let i = 0; i < R.edgeCount; i++) {
    const a = R.ea[i], b = R.eb[i];
    const na = nodes[a], nb = nodes[b];
    const dx = nb.x - na.x, dz = nb.z - na.z;
    const len = Math.hypot(dx, dz) || 1;
    const cls = CLS_NAME[R.ecls[i]] || 'res';
    const fl = R.eflags[i];
    const nameId = R.ename[i];
    edges[i] = {
      a, b, cls,
      name: nameId === 0xFFFF ? null : R.names[nameId],
      hw: R.ehw[i] || CLASS_HW[cls],
      spd: CLASS_SPEED[cls] || 12,
      len, dx: dx / len, dz: dz / len,
      elev: (fl & F_ELEV) !== 0,
      tunnel: (fl & F_TUNNEL) !== 0,
      oneway: (fl & F_ONEWAY) !== 0,
      onewayRev: (fl & F_ONEWAY_REV) !== 0,
    };
    na.e.push(i);
    nb.e.push(i);
  }
  const g = { nodes, edges };
  yield { p: 0.3, msg: 'Opening the streets' };

  // --- 2. Buildings -------------------------------------------------------
  // Oriented boxes fitted to real OSM footprints, streamed straight out of the
  // packed file. There is no lot generation, no road-clearance test and no
  // tower placement search: a real footprint is already clear of a real road.
  const B = md.buildings;
  const buildings = [];
  const REC = 12;
  const built = new Float32Array(B.nx * B.nz); // per-chunk cover, for the ground tint
  for (let cj = 0; cj < B.nz; cj++) {
    for (let ci = 0; ci < B.nx; ci++) {
      const k = cj * B.nx + ci;
      const from = B.dir[k], to = B.dir[k + 1];
      const ox = -G.MAP_HALF + ci * CHUNK - 200;
      const oz = -G.MAP_HALF + cj * CHUNK - 200;
      let area = 0;
      for (let o = from; o < to; o += REC) {
        const x = ox + B.blob.getUint16(o, true) / 10;
        const z = oz + B.blob.getUint16(o + 2, true) / 10;
        const w = B.blob.getUint16(o + 4, true) / 20;
        const d = B.blob.getUint16(o + 6, true) / 20;
        const h = B.blob.getUint16(o + 8, true) / 20;
        const rot = (B.blob.getUint8(o + 10) * Math.PI) / 256;
        const cls = B.blob.getUint8(o + 11);
        area += w * d;
        buildings.push({
          x, z, w, d, rot, h,
          y: G.terrainHeight(x, z),
          style: styleFor(cls, h),
          seed: (hash2(Math.round(x), Math.round(z)) * 65536) | 0,
          kind: null,
        });
      }
      built[k] = clamp(area / (CHUNK * CHUNK), 0, 1);
    }
    if (cj % 6 === 0) yield { p: 0.3 + 0.5 * (cj / B.nz), msg: 'Raising the skyline' };
  }

  // Nothing may stand where the player gets put down. Inside a footprint,
  // blocked() refuses every direction and the player is stuck for good, walking
  // on the spot -- and 1.5 m inside a facade there is no visual clue why.
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

  // --- 3. Chunk index ------------------------------------------------------
  const chunks = new Map();
  const ck = (cx, cz) => cx * 100003 + cz;
  const skey = (cx, cz) => cx * 100003 + cz;
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

  // --- 4. Elevated deck surfaces for vehicle physics -----------------------
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

  // --- 5. Building collision index ----------------------------------------
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

  // --- 6. Node spatial index for AI ---------------------------------------
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

  yield { p: 0.96, msg: 'Waking the city' };

  return {
    nodes: g.nodes,
    edges: g.edges,
    buildings,
    chunks,
    chunkKey: ck,
    drivable,
    surfaces,

    /**
     * How built-up the ground is at (x,z), 0..1, from the footprint area packed
     * into each 400 m chunk. world.js blends the terrain tint across it, which
     * is what makes the map read as a city from above -- and unlike the district
     * rectangles it replaces, it follows the actual edge of the built area.
     */
    builtAt(x, z) {
      const ci = Math.floor((x + G.MAP_HALF) / CHUNK);
      const cj = Math.floor((z + G.MAP_HALF) / CHUNK);
      if (ci < 0 || ci >= B.nx || cj < 0 || cj >= B.nz) return 0;
      return built[cj * B.nx + ci];
    },

    /**
     * Is edge `ei`'s carriageway at (x,z) already paved by a road that outranks
     * it?
     *
     * Far rarer than it was -- real carriageways don't overlap the way the
     * hand-drawn arterials overlapped the district grids -- but a motorway and
     * its parallel frontage road still share ground, and two full-width surfaces
     * in the same place each paint their own centre line, so the depth buffer
     * picks a winner per pixel per frame and the markings flicker. Rank is width
     * first then edge order, so the pairing is antisymmetric and exactly one of
     * any overlapping pair draws. Only the surface is dropped -- the edge stays
     * in the graph and traffic still routes over it.
     */
    roadCoveredAt(x, z, ei) {
      const me = g.edges[ei];
      if (!me || me.elev) return false;
      const c0 = Math.floor(x / CHUNK), d0 = Math.floor(z / CHUNK);
      for (let cx = c0 - 1; cx <= c0 + 1; cx++) {
        for (let cz = d0 - 1; cz <= d0 + 1; cz++) {
          const c = chunks.get(ck(cx, cz));
          if (!c) continue;
          for (const oi of c.edges) {
            if (oi === ei) continue;
            const o = g.edges[oi];
            if (o.elev) continue;
            if (o.hw < me.hw || (o.hw === me.hw && oi > ei)) continue;
            const a = g.nodes[o.a], b = g.nodes[o.b];
            if (distToSeg(x, z, a.x, a.z, b.x, b.z).d <= o.hw) return true;
          }
        }
      }
      return false;
    },

    roadLift(x, z) {
      // A junction square is drawn at NODE_LIFT and covers the ends of every
      // strip that meets there, so inside one it IS the surface -- take it
      // outright rather than maxing against the strips the scan below reports.
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
            const outer = e.hw + walkWidth(e.cls);
            if (r.d > outer) continue;
            let l = r.d <= e.hw ? ROAD_LIFT : WALK_LIFT;
            if (r.d > outer - RAMP) l *= (outer - r.d) / RAMP;
            if (l > lift) lift = l;
          }
        }
      }
      // The pavement ring around a junction reaches past the end of every strip
      // -- its diagonal corners especially, which no radiating edge comes near.
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
     * strip scan outright; the ring only fills in where the strips find nothing.
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
            if (n.elev) continue;
            if (n.e.length < 2) continue;
            let hw = 0, rot = 0, sw = 0;
            for (const ei of n.e) {
              const e = g.edges[ei];
              if (e.hw > hw) { hw = e.hw; rot = Math.atan2(e.dx, -e.dz); }
              sw = Math.max(sw, walkWidth(e.cls));
            }
            if (hw <= 0) continue;
            const c = Math.cos(rot), s = Math.sin(rot);
            const ux = x - n.x, uz = z - n.z;
            const lx = Math.abs(ux * c + uz * s), lz = Math.abs(-ux * s + uz * c);
            if (lx <= hw && lz <= hw) return { lift: NODE_LIFT, inSquare: true };
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
