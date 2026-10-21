// Waterloo Region's freeways furnished as Ontario builds them: the Conestoga
// Parkway (Hwy 7/8, 7 and 85), Hwy 8 to the 401, the 401 itself, Hwy 7/8 west.
//
// What the road graph has is geometry and a class; data/hwy.json
// (tools/kw/build_hwy.py) adds what OSM knows about each carriageway (ref,
// maxspeed, lit) and every exit (junction:ref, destination, destination:ref,
// destination:street). From the two this draws, as one landmarks.js extra:
//
//  - THE TALL WALL: the 1.07 m concrete median barrier between two
//    carriageways running side by side within MEDIAN_MAX m, the median paved
//    between them. Solid (landmark solids, `mono` so lane-following traffic is
//    not shoved by a wall it never reaches). Not on Hwy 85 north of Lancaster
//    St, which is a grass median (the barrier "ends just past Lancaster").
//  - LIGHTING where OSM says lit=yes: twin davit poles on the median wall, or
//    single ones off the right shoulder where there is no wall.
//  - GUIDE SIGNS for every exit: an overhead cantilever 300 m before the
//    diverge, a ground-mounted advance sign at 1 km where the chain is that
//    long, and the EXIT sign in the gore. Green, white border, the King's
//    Highway crown shield for provincial routes and the white flowerpot for
//    Regional Roads, the destinations OSM signs the ramp for, and the exit
//    number tab where the junction has one (the 401's; the Conestoga's exits
//    are unnumbered).
//  - MAXIMUM speed signs (OSM maxspeed: 90 on the Conestoga, 100 on Hwy 8,
//    110 on the 401) and route reassurance shields after each entrance.
//
// It also sets each freeway edge's traffic speed from its maxspeed (+10 km/h,
// how a 400-series highway actually flows): prepHighways, before traffic.

import * as THREE from './three.js';
import * as G from './geo.js';
import { hash2 } from './util.js';
import { Builder } from './build.js';
import { ROAD_LIFT } from './citygen.js';
import { polyMat, plainUV } from './kw.js';

const ckey = (x, z) => `${Math.round(x / 1500)},${Math.round(z / 1500)}`;
// NOT landmark clusters: a cluster draws wherever it is in the frustum, and
// this is in ~60 of them, two draws each -- +76 draws looking down Hwy 8 on a
// phone. Its own 1.5 km cells instead, each drawn only within range of the
// camera (the wall and lights out to FURN_R, the signs to SIGN_R).
const FURN_R = 1200, SIGN_R = 900;
const ROOT = new THREE.Group();
ROOT.name = 'highways';
const RANGE = [];
/** The group to add to the scene (after the landmarks are built). */
export const highwaysRoot = () => ROOT;
/** Each frame: show the cells within range of the camera. */
export function updateHighways(cam) {
  for (const n of RANGE) {
    const c = n.s.center, d = n.r + n.s.radius;
    const dx = cam.x - c.x, dz = cam.z - c.z;
    n.o.visible = dx * dx + dz * dz < d * d;
  }
}
const MEDIAN_MAX = 18;          // inner edge to inner edge: paved + tall wall up to this
const SAMPLE = 10;              // metres between median samples
const KINGS = new Set(['401', '403', '407', '7', '8', '85', '24', '6', '97', '86', '2', '5', '410']);
// Each route's signed direction: the axis its "first" direction points along
// (Ontario signs the 401, 7, 8 EAST/WEST and 85, 24, 6 NORTH/SOUTH; Hwy 7 on
// the Parkway runs north but is 7 EAST, toward Guelph).
const AXIS = {
  '401': [1, 0, 'EAST', 'WEST'], '8': [0.93, 0.37, 'EAST', 'WEST'], '7;8': [1, 0, 'EAST', 'WEST'],
  '7': [-0.29, -0.96, 'EAST', 'WEST'], '85': [0, -1, 'NORTH', 'SOUTH'], '24': [0, -1, 'NORTH', 'SOUTH'],
};

export const STATS = { rail: 0, railPosts: 0, masts: 0, rumble: 0, noise: 0, views: [], why: { near: 0, road: 0, walk: 0, nomain: 0 }, wall: 0, paved: 0, poles: 0, signs: 0, gantries: 0, speed: 0, shields: 0, exits: 0, tris: 0, edgesTimed: 0, atlas: null };

let HW = null;            // hwy.json
let HWY_SOLIDS = [];      // the walls and posts, added after the landmark solids' road test

/** Join the median walls and sign posts to the landmark solids (after buildLandmarks). */
export function addHighwaySolids(city) {
  if (!HWY_SOLIDS.length || !city.setLandmarkSolids) return;
  city.setLandmarkSolids([...(city.landmarkSolids || []), ...HWY_SOLIDS]);
  STATS.solids = HWY_SOLIDS.length;
  HWY_SOLIDS = [];
}
const INFO = new Map();   // edge index -> the hwy.json carriageway it is

const fwdOf = (e) => (e.onewayRev ? -1 : 1);
function sideW(e, t, s) {
  if (!e.tw) return e.hw;
  const i = Math.min(e.pk, Math.max(0, Math.round(t * e.pk)));
  return e.tw[i * 2 + s];
}
/** The drawn surface of edge e at parameter t, `o` m to the right of a -> b. */
function surfY(city, e, t, o, x, z) {
  if (e.prof) {
    const P = city.profAt(e, t);
    return e.elev ? P.h - 0.03 : P.h + P.s * o;
  }
  return G.terrainHeight(x, z) + ROAD_LIFT;
}
const isMain = (e) => e.cls === 'hwy' && e.oneway && !e.tunnel;

// ---------------------------------------------------------------------------
// Which OSM carriageway each freeway edge is: speed, lit, ref.

function wayGrid(ways) {
  const g = new Map();
  ways.forEach((w, wi) => {
    const p = w.p;
    for (let i = 0; i + 1 < p.length; i++) {
      const L = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
      for (let s = 0; s <= L; s += 25) {
        const f = L ? s / L : 0;
        const k = `${Math.floor((p[i][0] + (p[i + 1][0] - p[i][0]) * f) / 50)},${Math.floor((p[i][1] + (p[i + 1][1] - p[i][1]) * f) / 50)}`;
        let l = g.get(k);
        if (!l) g.set(k, (l = new Set()));
        l.add(wi * 4096 + i);
      }
    }
  });
  return g;
}

function nearestWay(grid, ways, x, z, ux, uz) {
  let best = null, bd = 14;
  const cx = Math.floor(x / 50), cz = Math.floor(z / 50);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const l = grid.get(`${cx + a},${cz + b}`);
    if (!l) continue;
    for (const code of l) {
      const w = ways[(code / 4096) | 0], i = code % 4096, p = w.p;
      const ax = p[i][0], az = p[i][1], dx = p[i + 1][0] - ax, dz = p[i + 1][1] - az;
      const L = Math.hypot(dx, dz) || 1;
      if (Math.abs((dx * ux + dz * uz) / L) < 0.8) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (L * L)));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < bd) { bd = d; best = { w, dot: (dx * ux + dz * uz) / L }; }
    }
  }
  return best;
}

/** Match the edges to hwy.json's carriageways; set freeway traffic speeds. */
export function prepHighways(city, hwy) {
  HW = hwy;
  if (!hwy || !hwy.ways) return STATS;
  const grid = wayGrid(hwy.ways);
  city.edges.forEach((e, ei) => {
    if (e.cls !== 'hwy') return;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const m = nearestWay(grid, hwy.ways, (a.x + b.x) / 2, (a.z + b.z) / 2, e.dx, e.dz);
    if (!m) return;
    INFO.set(ei, m.w);
    const sp = parseFloat(m.w.sp);
    // How a 400-series actually flows: about 10 km/h over the posted limit.
    if (sp >= 60 && sp <= 120) { e.spd = (sp + 10) / 3.6; STATS.edgesTimed++; }
  });
  CLEAR_CITY = city;   // the zone is built on first use: after the grading has set e.pbw
  return STATS;
}

// ---------------------------------------------------------------------------
// THE RIGHT-OF-WAY. A 400-series highway (and the Conestoga, and the trunk
// sections) runs through a mown clear zone: grass and ditch, no tree for
// 10-15 m past the shoulder (MTO's Roadside Design Manual clear zone is 9-13 m
// at 100-110 km/h), and the infield of every interchange loop mown too. The
// forest and the street trees grew right to the 401's shoulder. keepClear is
// in city.extraClear, which trees.js and world.js's scatter both ask.
const CLEAR_MAIN = 15, CLEAR_RAMP = 9, CZ = 50;
let CLEAR = null, CLEAR_CITY = null;   // 50 m cell -> Float32Array runs of [ax, az, bx, bz, r]
/** The ramps that are a freeway's: every 'ramp' edge (OSM's *_link, which
 *  includes a town's slip lanes) reachable from a freeway node through ramps. */
function freewayRamps(city) {
  const seen = new Uint8Array(city.edges.length), q = [];
  city.edges.forEach((e) => { if (e.cls === 'hwy') q.push(e.a, e.b); });
  const done = new Uint8Array(city.nodes.length);
  while (q.length) {
    const ni = q.pop();
    if (done[ni]) continue;
    done[ni] = 1;
    for (const k of city.nodes[ni].e) {
      const f = city.edges[k];
      if (f.cls !== 'ramp' || seen[k]) continue;
      seen[k] = 1;
      q.push(f.a, f.b);
    }
  }
  return seen;
}
function buildClearZone(city) {
  const cells = new Map();
  const fr = freewayRamps(city);
  city.edges.forEach((e, ei) => {
    if (e.cls !== 'hwy' && !(e.cls === 'ramp' && fr[ei])) return;
    if (e.tunnel) return;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const r = e.hw + Math.max(e.pbw || 0, e.cls === 'hwy' ? CLEAR_MAIN : CLEAR_RAMP);
    const x0 = Math.floor((Math.min(a.x, b.x) - r) / CZ), x1 = Math.floor((Math.max(a.x, b.x) + r) / CZ);
    const z0 = Math.floor((Math.min(a.z, b.z) - r) / CZ), z1 = Math.floor((Math.max(a.z, b.z) + r) / CZ);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * 100003 + j;
      let l = cells.get(k);
      if (!l) cells.set(k, (l = []));
      l.push(a.x, a.z, b.x, b.z, r);
    }
  });
  CLEAR = new Map();
  for (const [k, l] of cells) CLEAR.set(k, Float32Array.from(l));
  STATS.clearCells = CLEAR.size;
}
/** Inside a freeway's or ramp's mown right-of-way (city.extraClear)? */
export function hwyKeepClear(x, z) {
  if (!CLEAR) { if (!CLEAR_CITY) return false; buildClearZone(CLEAR_CITY); }
  const l = CLEAR.get(Math.floor(x / CZ) * 100003 + Math.floor(z / CZ));
  if (!l) return false;
  for (let q = 0; q < l.length; q += 5) {
    const ax = l[q], az = l[q + 1], sx = l[q + 2] - ax, sz = l[q + 3] - az, r = l[q + 4];
    const l2 = sx * sx + sz * sz;
    let t = l2 > 0 ? ((x - ax) * sx + (z - az) * sz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + sx * t - x, dz = az + sz * t - z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Walking a carriageway chain up- or downstream.

function nextMain(city, ni, ei, ux, uz, upstream) {
  let best = -1, bd = 0.6;
  for (const k of city.nodes[ni].e) {
    if (k === ei) continue;
    const f = city.edges[k];
    if (!isMain(f)) continue;
    const ff = fwdOf(f), from = ff > 0 ? f.a : f.b, to = ff > 0 ? f.b : f.a;
    if (upstream ? to !== ni : from !== ni) continue;
    const d = f.dx * ff * ux + f.dz * ff * uz;
    if (d > bd) { bd = d; best = k; }
  }
  return best;
}

/** The point `d` m along the travel from (ei, t) (negative: upstream), or null. */
function walk(city, ei, t, d) {
  let e = city.edges[ei], ff = fwdOf(e);
  let s = (ff > 0 ? t : 1 - t) * e.len + d;
  for (let g = 0; g < 400; g++) {
    if (s >= 0 && s <= e.len) break;
    const ux = e.dx * ff, uz = e.dz * ff;
    if (s > e.len) {
      const k = nextMain(city, ff > 0 ? e.b : e.a, ei, ux, uz, false);
      if (k < 0) return null;
      s -= e.len; ei = k;
    } else {
      const k = nextMain(city, ff > 0 ? e.a : e.b, ei, ux, uz, true);
      if (k < 0) return null;
      ei = k; s += city.edges[k].len;
    }
    e = city.edges[ei]; ff = fwdOf(e);
  }
  return frame(city, ei, ff > 0 ? s / e.len : 1 - s / e.len);
}

/** Where we are on a carriageway, in the driver's terms. */
function frame(city, ei, t) {
  const e = city.edges[ei], ff = fwdOf(e), a = city.nodes[e.a], b = city.nodes[e.b];
  const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
  const ux = e.dx * ff, uz = e.dz * ff;
  const wr = sideW(e, t, ff > 0 ? 0 : 1), wl = sideW(e, t, ff > 0 ? 1 : 0);
  return {
    ei, e, t, x, z, ux, uz, rx: -uz, rz: ux, wr, wl, ff,
    y: (o) => surfY(city, e, t, ff * o, x - uz * o, z + ux * o),   // o: metres right of travel
  };
}

function nearestMain(city, idx, x, z, ux, uz, rad = 25) {
  let best = null, bd = rad;
  for (const ei of idx.near(x, z)) {
    const e = city.edges[ei], ff = fwdOf(e);
    if (e.dx * ff * ux + e.dz * ff * uz < 0.75) continue;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const t = Math.max(0, Math.min(1, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len));
    const d = Math.hypot(x - a.x - e.dx * e.len * t, z - a.z - e.dz * e.len * t);
    if (d < bd) { bd = d; best = { ei, t }; }
  }
  return best;
}

function edgeIndex(city) {
  const g = new Map();
  const S = 50;
  city.edges.forEach((e, ei) => {
    if (!isMain(e)) return;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const pad = e.hw + 4;
    const x0 = Math.floor((Math.min(a.x, b.x) - pad) / S), x1 = Math.floor((Math.max(a.x, b.x) + pad) / S);
    const z0 = Math.floor((Math.min(a.z, b.z) - pad) / S), z1 = Math.floor((Math.max(a.z, b.z) + pad) / S);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * 100003 + j;
      let l = g.get(k);
      if (!l) g.set(k, (l = []));
      l.push(ei);
    }
  });
  return { near: (x, z) => g.get(Math.floor(x / S) * 100003 + Math.floor(z / S)) || [] };
}

// ---------------------------------------------------------------------------
// One vertex-coloured material, kw.js's (polyMat), so everything here merges
// into the draw each cluster already has for the polygon buildings; the signs'
// faces are the only other draw.

const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
const COL = {
  conc: lin([0.56, 0.555, 0.53]),      // the tall wall: cast concrete, weathered
  concDark: lin([0.46, 0.45, 0.43]),  // its foot, road grime
  asph: lin([0.33, 0.33, 0.34]),      // the paved median
  steel: lin([0.58, 0.60, 0.62]),
  back: lin([0.52, 0.54, 0.56]),
  lamp: lin([0.20, 0.21, 0.22]),
  lens: lin([0.92, 0.90, 0.80]),
  noise: lin([0.60, 0.57, 0.52]),     // a precast noise wall's panels
  noiseCap: lin([0.48, 0.46, 0.43]),
  rail: lin([0.70, 0.72, 0.73]),      // galvanized W-beam, weathered bright
  railPost: lin([0.52, 0.53, 0.54]),
  mast: lin([0.62, 0.63, 0.64]),      // a high mast's galvanized shaft
  rumble: lin([0.22, 0.22, 0.23]),    // a milled groove's shadowed floor
};

/** A builder that paints everything it is handed in one colour. */
class Tint {
  constructor(b, col) { this.b = b; this.col = col; }
  box(cx, by, cz, w, h, d, rot) { this.b.box(cx, by, cz, w, h, d, rot, this.col); }
  quad(a, b, c, d, n, uvs) { this.b.quad(a, b, c, d, n, uvs, this.col); }
  prism(cx, by, cz, r, h, sides) { this.b.prism(cx, by, cz, r, h, sides, this.col); }
}

class Kit {
  constructor() { this.b = new Map(); }
  B(x, z, mat) {
    const k = ckey(x, z), kind = mat === 'sign' ? 'sign' : 'v';
    let m = this.b.get(k);
    if (!m) this.b.set(k, (m = new Map()));
    let b = m.get(kind);
    if (!b) m.set(kind, (b = new Builder(kind === 'sign')));
    return kind === 'sign' ? b : new Tint(b, COL[mat]);
  }
  flush(atlasMat) {
    for (const [key, m] of this.b) {
      for (const [kind, b] of m) {
        if (b.empty) continue;
        STATS.tris += b.idx.length / 3;
        const mesh = new THREE.Mesh(kind === 'sign' ? b.build() : plainUV(b.build()), kind === 'sign' ? atlasMat : polyMat());
        mesh.name = `highways:${key}:${kind}`;
        // no shadow casting: the phone's shadow cache would be redrawn every
        // time a cell comes into range (and a 1 m wall casts little anyway)
        mesh.castShadow = false;
        mesh.receiveShadow = kind !== 'sign';
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        ROOT.add(mesh);
        RANGE.push({ o: mesh, s: mesh.geometry.boundingSphere, r: kind === 'sign' ? SIGN_R : FURN_R });
      }
    }
  }
}
const W1 = [1, 1, 1];
const NOUV = [0, 0, 0, 0, 0, 0, 0, 0];

// ---------------------------------------------------------------------------
// The sign atlas: its own canvas, so it never fills the shared one.

class SignAtlas {
  constructor(w = 2048, h = 1024) {
    this.c = document.createElement('canvas');
    this.c.width = w; this.c.height = h;
    this.g = this.c.getContext('2d');
    this.x = 0; this.y = 0; this.row = 0; this.full = 0;
    this.cache = new Map();
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, toneMapped: false });
    this.mat.userData.noShadow = true;
  }
  /** A panel drawn once per key: returns { uv: [u0, v0, u1, v1], w, h } in metres. */
  get(key, Wpx, Hpx, ppm, draw) {
    let p = this.cache.get(key);
    if (p) return p;
    if (this.x + Wpx > this.c.width) { this.x = 0; this.y += this.row + 2; this.row = 0; }
    if (this.y + Hpx > this.c.height) { this.full++; return null; }
    const x = this.x, y = this.y;
    this.x += Wpx + 2; this.row = Math.max(this.row, Hpx);
    const g = this.g;
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, Wpx, Hpx); g.clip();
    draw(g, Wpx, Hpx);
    g.restore();
    p = { uv: [(x + 0.5) / this.c.width, 1 - (y + Hpx - 0.5) / this.c.height, (x + Wpx - 0.5) / this.c.width, 1 - (y + 0.5) / this.c.height],
      w: Wpx / ppm, h: Hpx / ppm };
    this.cache.set(key, p);
    return p;
  }
}

const GREEN = '#0b6b3a', FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** The King's Highway shield: white, black edge, the crown over the number. */
function kingShield(g, cx, top, H, num) {
  const W = H * 0.86;
  const x0 = cx - W / 2;
  g.save();
  g.beginPath();
  g.moveTo(x0, top + H * 0.2);
  g.lineTo(x0 + W, top + H * 0.2);
  g.lineTo(x0 + W, top + H * 0.62);
  g.quadraticCurveTo(x0 + W, top + H * 0.9, cx, top + H);
  g.quadraticCurveTo(x0, top + H * 0.9, x0, top + H * 0.62);
  g.closePath();
  g.fillStyle = '#ffffff'; g.fill();
  g.lineWidth = Math.max(2, H * 0.045); g.strokeStyle = '#111'; g.stroke();
  // the crown: a band and three points, on top of the shield
  g.fillStyle = '#ffffff';
  g.beginPath();
  const cw = W * 0.62, cy = top + H * 0.2, ch = H * 0.19;
  g.moveTo(cx - cw / 2, cy);
  g.lineTo(cx - cw / 2, cy - ch * 0.55);
  g.lineTo(cx - cw * 0.3, cy - ch * 0.3);
  g.lineTo(cx - cw * 0.17, cy - ch);
  g.lineTo(cx, cy - ch * 0.4);
  g.lineTo(cx + cw * 0.17, cy - ch);
  g.lineTo(cx + cw * 0.3, cy - ch * 0.3);
  g.lineTo(cx + cw / 2, cy - ch * 0.55);
  g.lineTo(cx + cw / 2, cy);
  g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#111';
  const fs = num.length >= 3 ? H * 0.38 : H * 0.48;
  g.font = `bold ${fs}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(num, cx, top + H * 0.56, W * 0.84);
  g.restore();
  return W;
}

/** A Regional Road's flowerpot marker: white, black edge, the number. */
function potShield(g, cx, top, H, num) {
  const W = H * 0.8, x0 = cx - W / 2;
  g.save();
  g.beginPath();
  g.moveTo(x0, top + H * 0.08);
  g.quadraticCurveTo(x0, top, x0 + W * 0.12, top);
  g.lineTo(x0 + W * 0.88, top);
  g.quadraticCurveTo(x0 + W, top, x0 + W, top + H * 0.08);
  g.quadraticCurveTo(x0 + W * 0.92, top + H * 0.22, x0 + W * 0.84, top + H * 0.3);
  g.lineTo(x0 + W * 0.84, top + H * 0.75);
  g.quadraticCurveTo(x0 + W * 0.84, top + H, cx, top + H);
  g.quadraticCurveTo(x0 + W * 0.16, top + H, x0 + W * 0.16, top + H * 0.75);
  g.lineTo(x0 + W * 0.16, top + H * 0.3);
  g.quadraticCurveTo(x0 + W * 0.08, top + H * 0.22, x0, top + H * 0.08);
  g.closePath();
  g.fillStyle = '#ffffff'; g.fill();
  g.lineWidth = Math.max(2, H * 0.04); g.strokeStyle = '#111'; g.stroke();
  g.fillStyle = '#111';
  g.font = `bold ${num.length >= 3 ? H * 0.32 : H * 0.42}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(num, cx, top + H * 0.58, W * 0.66);
  g.restore();
  return W;
}

const ABBR = [[/\bStreet\b/g, 'St'], [/\bRoad\b/g, 'Rd'], [/\bAvenue\b/g, 'Ave'], [/\bBoulevard\b/g, 'Blvd'],
  [/\bDrive\b/g, 'Dr'], [/\bNorth\b/g, 'N'], [/\bSouth\b/g, 'S'], [/\bEast\b/g, 'E'], [/\bWest\b/g, 'W'], [/\bSaint\b/g, 'St.']];
const abbr = (s) => ABBR.reduce((t, [re, r]) => t.replace(re, r), s);

/** What an exit's guide sign says: shield rows and text lines. */
function exitContent(x) {
  const shields = [];
  for (const r of x.dref || []) {
    const m = /^\s*(\d+[A-Z]?)\s*(North|South|East|West)?/i.exec(r);
    if (!m) continue;
    const num = m[1], dir = m[2] ? m[2].toUpperCase() : '';
    if (shields.some((s) => s.num === num)) { if (dir) shields.find((s) => s.num === num).dir ||= dir; continue; }
    shields.push({ num, dir, king: KINGS.has(num) });
  }
  const lines = [];
  const streets = (x.street || []).map((s) => s.split(' - ')[0]).filter((s) => !/^Regional Road|^Highway/.test(s));
  for (const s of streets) if (lines.length < 2 && !lines.includes(abbr(s))) lines.push(abbr(s));
  for (const d of x.dest || []) {
    if (/^Highway/.test(d) || /^(North|South|East|West)$/i.test(d)) continue;
    const t = abbr(d);
    if (lines.length < 3 && !lines.includes(t) && !streets.some((s) => abbr(s) === t)) lines.push(t);
  }
  // a ramp to a highway signed only "North"/"Highway 85 North": the direction
  for (const d of x.dest || []) {
    const m = /(North|South|East|West)\s*$/i.exec(d);
    if (m && shields.length === 1 && !shields[0].dir) shields[0].dir = m[1].toUpperCase();
  }
  // "7 & 8 WEST": a concurrency signed with one direction shares it, and
  // the word is written once, after the last of them
  const dirs = new Set(shields.map((q) => q.dir).filter(Boolean));
  if (dirs.size === 1) { const d = [...dirs][0]; for (const q of shields) q.dir = d; }
  shields.forEach((q, i) => { q.say = q.dir && !(shields[i + 1] && shields[i + 1].dir === q.dir); });
  return { shields, lines };
}

/** The guide sign for an exit, drawn into the atlas. */
function guidePanel(atlas, x, dist) {
  const { shields, lines } = exitContent(x);
  if (!shields.length && !lines.length) return null;
  const PPM = 30;
  const tab = x.ref ? `EXIT ${x.ref}` : null;
  const SH = 46, LH = 26, PAD = 10, TAB = tab ? 28 : 0;
  const mg = document.createElement('canvas').getContext('2d');
  mg.font = `500 ${LH * 0.82}px ${FONT}`;
  let w = 0;
  for (const l of lines) w = Math.max(w, mg.measureText(l).width);
  let sw = 0;
  mg.font = `bold ${SH * 0.42}px ${FONT}`;
  for (const s of shields) sw += SH * 0.86 + (s.say ? mg.measureText(s.dir).width + 10 : 0) + 18;
  w = Math.max(w, sw, dist ? 120 : 0, 150) + PAD * 2;
  const body = PAD * 2 + (shields.length ? SH + 8 : 0) + lines.length * LH + (dist ? LH * 0.9 : 0) - 6;
  const Wpx = Math.ceil(w), Hpx = Math.ceil(body + TAB);
  const key = `g|${tab}|${shields.map((s) => s.num + (s.say ? s.dir : '')).join(',')}|${lines.join(',')}|${dist || ''}`;
  const P = atlas.get(key, Wpx, Hpx, PPM, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    if (tab) {
      g.font = `bold ${TAB * 0.62}px ${FONT}`;
      const tw = g.measureText(tab).width + 20;
      rrect(g, W - tw, 0, tw, TAB + 8, 6); g.fillStyle = GREEN; g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 2.5; rrect(g, W - tw + 3, 3, tw - 6, TAB + 2, 4); g.stroke();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(tab, W - tw / 2, TAB / 2 + 3);
    }
    rrect(g, 0, TAB, W, H - TAB, 8); g.fillStyle = GREEN; g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 3; rrect(g, 4, TAB + 4, W - 8, H - TAB - 8, 6); g.stroke();
    let y = TAB + PAD;
    if (shields.length) {
      g.font = `bold ${SH * 0.42}px ${FONT}`;
      let tot = 0;
      for (const s of shields) tot += SH * 0.86 + (s.say ? g.measureText(s.dir).width + 10 : 0) + 18;
      let cx = (W - tot + 18) / 2;
      for (const s of shields) {
        const sw2 = s.king ? kingShield(g, cx + SH * 0.43, y, SH, s.num) : potShield(g, cx + SH * 0.43, y + 4, SH - 8, s.num);
        cx += sw2 + 10;
        if (s.say) {
          g.fillStyle = '#fff'; g.font = `bold ${SH * 0.42}px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
          g.fillText(s.dir, cx, y + SH * 0.6);
          cx += g.measureText(s.dir).width + 18;
        } else cx += 8;
      }
      y += SH + 8;
    }
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.font = `500 ${LH * 0.82}px ${FONT}`;
    for (const l of lines) { g.fillText(l, W / 2, y, W - PAD * 2); y += LH; }
    if (dist) {
      g.font = `bold ${LH * 0.7}px ${FONT}`; g.textAlign = 'right';
      g.fillText(dist, W - PAD - 4, y - 4);
    }
  });
  if (P) P.tab = TAB / PPM;   // the exit tab's band: no back plate behind its empty part
  return P;
}

function kmPanel(atlas) {
  return atlas.get('km', 72, 30, 44, (g, W, H) => {
    rrect(g, 0, 0, W, H, 4); g.fillStyle = GREEN; g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 2; rrect(g, 2.5, 2.5, W - 5, H - 5, 3); g.stroke();
    g.fillStyle = '#fff'; g.font = `bold 19px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('1 km', W / 2, H / 2 + 1);
  });
}

function goreExit(atlas, ref, left) {
  const key = `gore|${ref || ''}|${left ? 'L' : 'R'}`;
  return atlas.get(key, 96, ref ? 104 : 80, 48, (g, W, H) => {
    rrect(g, 0, 0, W, H, 6); g.fillStyle = GREEN; g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 2.5; rrect(g, 3, 3, W - 6, H - 6, 4); g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.font = `bold 22px ${FONT}`; g.fillText('EXIT', W / 2, 8);
    if (ref) { g.font = `bold 24px ${FONT}`; g.fillText(ref, W / 2, 32); }
    // the arrow up and out, the side the ramp leaves by
    const ay = ref ? 66 : 40, s = left ? -1 : 1;
    g.save(); g.translate(W / 2, ay + 18); g.rotate(s * Math.PI / 4);
    g.fillRect(-3, -6, 6, 22);
    g.beginPath(); g.moveTo(-11, -4); g.lineTo(0, -18); g.lineTo(11, -4); g.closePath(); g.fill();
    g.restore();
  });
}

function speedPanel(atlas, v) {
  return atlas.get(`max|${v}`, 72, 96, 60, (g, W, H) => {
    g.fillStyle = '#fff'; rrect(g, 0, 0, W, H, 5); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 3; rrect(g, 3, 3, W - 6, H - 6, 4); g.stroke();
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 12px ${FONT}`; g.fillText('MAXIMUM', W / 2, 16);
    g.font = `bold 40px ${FONT}`; g.fillText(String(v), W / 2, 50, W - 10);
    g.font = `bold 13px ${FONT}`; g.fillText('km/h', W / 2, 80);
  });
}

function routePanel(atlas, nums, dir) {
  const Wpx = 20 + nums.length * 64;
  return atlas.get(`route|${nums.join('/')}|${dir}`, Wpx, 104, 64, (g, W, H) => {
    g.fillStyle = '#fff'; rrect(g, 0, 0, W, 24, 3); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 2; rrect(g, 1.5, 1.5, W - 3, 21, 3); g.stroke();
    g.fillStyle = '#111'; g.font = `bold 16px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(dir, W / 2, 13);
    nums.forEach((n, i) => kingShield(g, 10 + 32 + i * 64, 28, 74, n));
  });
}

// ---------------------------------------------------------------------------

/** A sign face (both sides textured is wrong: the back gets a plain plate). */
function face(K, f, a, r, yb, P) {
  const B = K.B(f.x, f.z, 'sign');
  const hw = P.w / 2;
  // faces back up the road: its normal is -u
  const cx = f.x + f.ux * a + f.rx * r, cz = f.z + f.uz * a + f.rz * r;
  const L = [cx + f.rx * hw, cz + f.rz * hw], R = [cx - f.rx * hw, cz - f.rz * hw];
  const [u0, v0, u1, v1] = P.uv;
  // seen from upstream, the driver's right is +r: the image's right edge goes there
  B.quad([R[0], yb, R[1]], [L[0], yb, L[1]], [L[0], yb + P.h, L[1]], [R[0], yb + P.h, R[1]],
    [-f.ux, 0, -f.uz], [u0, v0, u1, v0, u1, v1, u0, v1], W1);
  // the aluminium back, a hand's breadth behind
  const Bk = K.B(f.x, f.z, 'back');
  Bk.box(cx + f.ux * 0.06, yb + 0.02, cz + f.uz * 0.06, P.w, P.h - 0.04 - (P.tab || 0), 0.08, Math.atan2(f.rz, f.rx));
  STATS.signs++;
}

function post(K, solids, x, z, y0, h, w = 0.2) {
  K.B(x, z, 'steel').box(x, y0, z, w, h, w, 0, W1);
  solids.push({ x, z, r: Math.max(0.2, w * 0.7), y0, y1: y0 + h });
}

// THE CONESTOGA PARKWAY'S NOISE WALLS. OSM maps two; the Parkway has more
// along its residential stretches. These are read off Esri World Imagery
// (tools/kw/aerial.py: the wall's shadow line along the shoulder, the houses
// behind it) as [x0, z0, x1, z1, side]: the stretch, and the side it stands
// on ('N' / 'S'; the Parkway runs ~WSW-ENE here). Each is laid 3 m past the
// outer carriageway's edge (4.5 m, clear of the signs) on that side, following it, broken where a ramp
// crosses its line.
const PKWY_WALLS = [
  [-3040, 3600, -2510, 3365, 'S'],   // Forest Heights, west of Westmount Rd: south side
  [-2030, 3070, -1770, 2985, 'N'],   // east of Westmount Rd: north side
  [-2040, 3175, -1770, 3055, 'S'],   // ...and the townhouses on the south side
  [-1610, 2880, -1130, 2750, 'N'],   // Ottawa St S to Homer Watson: north side
  [-760, 2590, -280, 2505, 'N'],     // east of Homer Watson, by Kingsdale: north side
];
function parkwayWalls(city, idx, onCw) {
  const out = [];
  for (const [x0, z0, x1, z1, side] of PKWY_WALLS) {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 8);
    const sz = side === 'N' ? -1 : 1;
    let run = [];
    const flush = () => {
      if (run.length > 4) {
        out.push({ h: '4.2', p: run });
        const m = run[run.length >> 1];
        STATS.views.push({ name: `noise${out.length - 1}`, c: [+run[0][0].toFixed(1), +(run[0][1] - sz * 14).toFixed(1), 1.5], t: [+m[0].toFixed(1), +m[1].toFixed(1), 2.5], fov: 55 });
      }
      run = [];
    };
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      // the outermost main carriageway on that side within 60 m
      let best = null;
      for (const ei of idx.near(x, z)) {
        const e = city.edges[ei], a = city.nodes[e.a];
        const t = Math.max(0, Math.min(1, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len));
        const qx = a.x + e.dx * e.len * t, qz = a.z + e.dz * e.len * t;
        if (Math.hypot(qx - x, qz - z) > 60) continue;
        if (!best || qz * sz > best.qz * sz) best = { e, t, qx, qz };
      }
      if (!best) { flush(); continue; }
      const e = best.e, sg = e.dx * sz >= 0 ? 1 : -1;   // +p = (-dz, dx): its z part is dx
      const tw = e.tw ? e.tw[Math.min(e.pk, Math.round(best.t * e.pk)) * 2 + (sg > 0 ? 0 : 1)] : e.hw;
      const off = tw + 4.5;
      const wx = best.qx - e.dz * sg * off, wz = best.qz + e.dx * sg * off;
      if (onCw(wx, wz, 1.5)) { flush(); continue; }
      run.push([wx, wz]);
    }
    flush();
  }
  return out;
}

export function buildHighways(ctx) {
  const city = ctx.city;
  if (!HW || !city || (typeof window !== 'undefined' && window.__noHwy)) return;
  const t0 = performance.now();
  const K = new Kit();
  const solids = (HWY_SOLIDS = []);
  const idx = edgeIndex(city);
  const atlas = new SignAtlas();
  // on a carriageway (not its embankment, which city.onRoad counts)
  const onCw = (x, z, pad) => {
    for (const ei of city.edgesNear(x, z, 0)) {
      const e = city.edges[ei];
      if (e.tunnel) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz;
      let t = l2 > 0 ? ((x - a.x) * sx + (z - a.z) * sz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const r = e.hw + pad;
      if ((a.x + sx * t - x) ** 2 + (a.z + sz * t - z) ** 2 <= r * r) return true;
    }
    return false;
  };

  // ---- the median: tall wall, paving, median lighting --------------------
  const wallAt = [];   // [x, z] samples of the wall, for the lighting test
  const LUM = 50;
  let sinceLight = new Map();
  city.edges.forEach((e, ei) => {
    if (!isMain(e) || e.len < 2) return;
    const info = INFO.get(ei);
    const n = Math.max(1, Math.round(e.len / SAMPLE));
    const S = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const f = frame(city, ei, t);
      // the opposing carriageway on the left
      let best = null;
      for (const oi of idx.near(f.x, f.z)) {
        if (oi === ei) continue;
        const o = city.edges[oi], of = fwdOf(o);
        if (o.dx * of * f.ux + o.dz * of * f.uz > -0.85) continue;
        const a = city.nodes[o.a];
        const ut = ((f.x - a.x) * o.dx + (f.z - a.z) * o.dz) / o.len;
        if (ut < -0.02 || ut > 1.02) continue;
        const u = Math.max(0, Math.min(1, ut));
        const qx = a.x + o.dx * o.len * u, qz = a.z + o.dz * o.len * u;
        const lat = -((qx - f.x) * f.rx + (qz - f.z) * f.rz);      // + = to our left
        if (lat <= 0 || lat > f.wl + o.hw + MEDIAN_MAX + 1) continue;
        if (!best || lat < best.lat) best = { oi, o, u, lat };
      }
      if (!best || best.oi < ei) { S.push(null); continue; }
      const o = best.o, of = fwdOf(o);
      const owl = sideW(o, best.u, of > 0 ? 1 : 0);
      const gap = best.lat - f.wl - owl;
      if (gap < 1.0 || gap > MEDIAN_MAX) { S.push(null); continue; }
      // Hwy 85 north of Lancaster St: a grass median, no barrier
      if (info && info.ref === '85' && f.z < -2150) { S.push(null); continue; }
      const yA = f.y(-f.wl);
      const ox = f.x - f.rx * best.lat, oz = f.z - f.rz * best.lat;  // the other centreline (approx)
      const yB = surfY(city, o, best.u, -of * owl, ox, oz);
      if (Math.abs(yA - yB) > 2.2) { S.push(null); continue; }
      const mid = f.wl + gap / 2;
      S.push({ f, yA, yB, mid, lat: best.lat, owl, lit: info && info.lit === 'yes' });
    }
    let acc = sinceLight.get(ei) || 0;
    for (let i = 0; i < n; i++) {
      const p = S[i], q = S[i + 1];
      if (!p || !q) continue;
      // points across the median at p and q: A edge, wall foot A, wall foot B, B edge
      const pt = (s, off) => [s.f.x - s.f.rx * off, s.f.z - s.f.rz * off];
      const WB = 0.30, WT = 0.12, WH = 1.07;
      const B = K.B(p.f.x, p.f.z, 'asph');
      const pa = pt(p, p.f.wl - 0.05), qa = pt(q, q.f.wl - 0.05);
      const pw = pt(p, p.mid - WB), qw = pt(q, q.mid - WB);
      const pw2 = pt(p, p.mid + WB), qw2 = pt(q, q.mid + WB);
      const pb = pt(p, p.lat - p.owl + 0.05), qb = pt(q, q.lat - q.owl + 0.05);
      const lift = 0.025;
      B.quad([pa[0], p.yA + lift, pa[1]], [qa[0], q.yA + lift, qa[1]], [qw[0], q.yA + lift, qw[1]], [pw[0], p.yA + lift, pw[1]], [0, 1, 0], NOUV, W1);
      B.quad([pw2[0], p.yB + lift, pw2[1]], [qw2[0], q.yB + lift, qw2[1]], [qb[0], q.yB + lift, qb[1]], [pb[0], p.yB + lift, pb[1]], [0, 1, 0], NOUV, W1);
      STATS.paved += Math.hypot(qa[0] - pa[0], qa[1] - pa[1]);
      // the wall: F-shape both faces, a flat top
      const C = K.B(p.f.x, p.f.z, 'conc'), D = K.B(p.f.x, p.f.z, 'concDark');
      const prof = [[WB, 0], [WB, 0.08], [0.19, 0.33], [WT, WH]];
      const base = (s) => Math.min(s.yA, s.yB) + lift - 0.02;
      const top = (s) => Math.max(s.yA, s.yB) + WH;
      for (const sd of [-1, 1]) {
        for (let k = 0; k + 1 < prof.length; k++) {
          const [w0, h0] = prof[k], [w1, h1] = prof[k + 1];
          const Y = (s, h) => (h === WH ? top(s) : h === 0 ? base(s) : (sd < 0 ? s.yA : s.yB) + lift + h);
          const P0 = pt(p, p.mid + sd * w0), Q0 = pt(q, q.mid + sd * w0), P1 = pt(p, p.mid + sd * w1), Q1 = pt(q, q.mid + sd * w1);
          const nx = -p.f.rx * sd, nz = -p.f.rz * sd;
          const ny = (w0 - w1) / Math.max(0.05, h1 - h0);
          (k === 0 ? D : C).quad([P0[0], Y(p, h0), P0[1]], [Q0[0], Y(q, h0), Q0[1]], [Q1[0], Y(q, h1), Q1[1]], [P1[0], Y(p, h1), P1[1]],
            [nx, ny, nz], NOUV, W1);
        }
      }
      const Pt0 = pt(p, p.mid - WT), Qt0 = pt(q, q.mid - WT), Pt1 = pt(p, p.mid + WT), Qt1 = pt(q, q.mid + WT);
      C.quad([Pt0[0], top(p), Pt0[1]], [Qt0[0], top(q), Qt0[1]], [Qt1[0], top(q), Qt1[1]], [Pt1[0], top(p), Pt1[1]], [0, 1, 0], NOUV, W1);
      const mp = pt(p, p.mid), mq = pt(q, q.mid);
      const L = Math.hypot(mq[0] - mp[0], mq[1] - mp[1]);
      STATS.wall += L;
      solids.push({ x: (mp[0] + mq[0]) / 2, z: (mp[1] + mq[1]) / 2, hw: L / 2 + 0.05, hd: 0.15,
        rot: Math.atan2(mq[1] - mp[1], mq[0] - mp[0]), y0: Math.min(base(p), base(q)), y1: Math.max(top(p), top(q)), mono: true });
      // median lighting on the wall where the carriageway is lit
      if (p.lit) {
        acc += L;
        if (acc >= LUM) {
          acc = 0;
          const yb = top(p);
          const M2 = K.B(mp[0], mp[1], 'steel'), Lh = K.B(mp[0], mp[1], 'lamp'), Ln = K.B(mp[0], mp[1], 'lens');
          M2.box(mp[0], yb, mp[1], 0.22, 12.5, 0.22, 0, W1);
          for (const sd of [-1, 1]) {
            // davit arm out over the inside lane, the luminaire at its end
            const ax = mp[0] + p.f.rx * sd * 1.5, az = mp[1] + p.f.rz * sd * 1.5;
            M2.box(ax, yb + 12.25, az, 0.1, 0.1, 3.0, Math.atan2(p.f.rz, p.f.rx) + Math.PI / 2, W1);
            const lx = mp[0] + p.f.rx * sd * 3.0, lz = mp[1] + p.f.rz * sd * 3.0;
            Lh.box(lx, yb + 12.05, lz, 0.38, 0.18, 0.75, Math.atan2(p.f.rz, p.f.rx) + Math.PI / 2, W1);
            Ln.box(lx, yb + 12.0, lz, 0.3, 0.05, 0.6, Math.atan2(p.f.rz, p.f.rx) + Math.PI / 2, W1);
          }
          STATS.poles++;
        }
      }
      wallAt.push(mp);
    }
    sinceLight.set(ei, acc);
  });

  // ---- lighting off the right shoulder where lit and no median wall ------
  const wallGrid = new Set(wallAt.map(([x, z]) => `${Math.floor(x / 40)},${Math.floor(z / 40)}`));
  const nearWall = (x, z) => {
    const cx = Math.floor(x / 40), cz = Math.floor(z / 40);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (wallGrid.has(`${cx + a},${cz + b}`)) return true;
    return false;
  };
  city.edges.forEach((e, ei) => {
    if (!isMain(e)) return;
    const info = INFO.get(ei);
    if (!info || info.lit !== 'yes') return;
    for (let s = 20 + hash2(ei, 3) * 30; s < e.len; s += 60) {
      const f = frame(city, ei, fwdOf(e) > 0 ? s / e.len : 1 - s / e.len);
      if (nearWall(f.x, f.z)) continue;
      const off = f.wr + 2.2;
      const x = f.x + f.rx * off, z = f.z + f.rz * off;
      if (onCw(x, z, 0.6)) continue;
      const yb = Math.min(f.y(f.wr), G.terrainHeight(x, z));
      const top = f.y(f.wr) + 12.5;
      post(K, solids, x, z, yb, top - yb, 0.24);
      const ang = Math.atan2(f.rz, f.rx) + Math.PI / 2;
      K.B(x, z, 'steel').box(x - f.rx * 1.5, top - 0.25, z - f.rz * 1.5, 0.1, 0.1, 3.0, ang, W1);
      K.B(x, z, 'lamp').box(x - f.rx * 3.0, top - 0.45, z - f.rz * 3.0, 0.38, 0.18, 0.75, ang, W1);
      K.B(x, z, 'lens').box(x - f.rx * 3.0, top - 0.5, z - f.rz * 3.0, 0.3, 0.05, 0.6, ang, W1);
      STATS.poles++;
    }
  });

  // ---- noise walls: OSM's wall=noise_barrier lines -----------------------
  // Precast panels between steel H-posts every 4 m, as MTO builds them; the
  // height is OSM's, else 4 m. Each panel is a solid.
  for (const w of [...(HW.noise || []), ...parkwayWalls(city, idx, onCw)]) {
    const H = parseFloat(w.h) || 4.0;
    for (let i = 0; i + 1 < w.p.length; i++) {
      const [ax, az] = w.p[i], [bx, bz] = w.p[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.3) continue;
      const n = Math.max(1, Math.round(L / 4));
      for (let k = 0; k < n; k++) {
        const x0 = ax + ((bx - ax) * k) / n, z0 = az + ((bz - az) * k) / n;
        const x1 = ax + ((bx - ax) * (k + 1)) / n, z1 = az + ((bz - az) * (k + 1)) / n;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, l = L / n;
        const y0 = Math.min(G.terrainHeight(x0, z0), G.terrainHeight(x1, z1)) - 0.3;
        const rot = Math.atan2(z1 - z0, x1 - x0);
        K.B(mx, mz, 'noise').box(mx, y0, mz, l, H + 0.3, 0.2, rot);
        K.B(mx, mz, 'noiseCap').box(mx, y0 + H + 0.3, mz, l, 0.12, 0.26, rot);
        K.B(x0, z0, 'steel').box(x0, y0, z0, 0.22, H + 0.45, 0.3, rot);
        solids.push({ x: mx, z: mz, hw: l / 2, hd: 0.12, rot, y0, y1: y0 + H + 0.3 });
        STATS.noise += l;
      }
    }
  }

  // ---- steel beam guide rail ----------------------------------------------
  // Ontario's W-beam on posts every 1.9 m, its face at the shoulder's outer
  // edge: on a high fill (the batter drops more than RAIL_DROP from the
  // shoulder), on every bridge approach (BRIDGE_RUN m either side of a deck,
  // tied into its parapet) and along the gore of each exit. Not on a left
  // shoulder with the tall wall beyond it. Each 2-post piece is a landmark
  // solid (`mono`: lane-following traffic never reaches it).
  const fr = freewayRamps(city);
  const railEdge = (ei) => { const e = city.edges[ei]; return (isMain(e) || (e.cls === 'ramp' && fr[ei])) && e.prof && !e.elev && !e.tunnel; };
  // how far each node is (along freeway carriageways and ramps) from a deck's end
  const BRIDGE_RUN = 60, RAIL_DROP = 2.6;
  const bd = new Map(), bq = [];
  city.edges.forEach((e, ei) => {
    if (!e.elev || !(e.cls === 'hwy' || e.cls === 'ramp')) return;
    for (const ni of [e.a, e.b]) if (!bd.has(ni) && city.nodes[ni].e.some((k) => railEdge(k))) { bd.set(ni, 0); bq.push(ni); }
  });
  for (let h = 0; h < bq.length; h++) {
    const ni = bq[h], d0 = bd.get(ni);
    for (const k of city.nodes[ni].e) {
      if (!railEdge(k)) continue;
      const f = city.edges[k], o = f.a === ni ? f.b : f.a, d = d0 + f.len;
      if (d < BRIDGE_RUN && (!bd.has(o) || bd.get(o) > d)) { bd.set(o, d); bq.push(o); }
    }
  }
  const wallFine = new Map();
  for (const [x, z] of wallAt) {
    const k = `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
    let l = wallFine.get(k);
    if (!l) wallFine.set(k, (l = []));
    l.push(x, z);
  }
  const wallWithin = (x, z, r) => {
    const cx = Math.floor(x / 10), cz = Math.floor(z / 10);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = wallFine.get(`${cx + a},${cz + b}`);
      if (l) for (let q = 0; q < l.length; q += 2) if ((l[q] - x) ** 2 + (l[q + 1] - z) ** 2 < r * r) return true;
    }
    return false;
  };
  const R_LO = 0.43, R_HI = 0.76, R_OUT = 0.5;
  /** A guide rail along `pts` ([x, z, yRoad, nx, nz]: the road-side face's foot,
   *  the outward normal), posts every ~1.9 m on the slope behind it. */
  const railRun = (pts) => {
    if (pts.length < 2) return;
    // a viewpoint down the first few long runs (hwyshots: 'rail' views)
    if (pts.length > 10 && STATS.views.filter((v) => v.name.startsWith('rail')).length < 6 && hash2(Math.round(pts[0][0]), Math.round(pts[0][1])) < 0.08) {
      const m = pts[pts.length >> 1], p0 = pts[0];
      const ax = m[0] - p0[0], az = m[1] - p0[1], al = Math.hypot(ax, az) || 1;
      STATS.views.push({ name: `rail${STATS.views.filter((v) => v.name.startsWith('rail')).length}`,
        c: [+(p0[0] - m[3] * 5 - (ax / al) * 25).toFixed(1), +(p0[1] - m[4] * 5 - (az / al) * 25).toFixed(1), 1.4],
        t: [+m[0].toFixed(1), +m[1].toFixed(1), 0.6], fov: 55 });
    }
    let since = 0;
    for (let q = 0; q + 1 < pts.length; q++) {
      const [x0, z0, y0, nx0, nz0] = pts[q], [x1, z1, y1, nx1, nz1] = pts[q + 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 0.05 || L > 30) continue;
      const B = K.B(x0, z0, 'rail');
      // the W: two folds facing the road, a lip on top
      const fold = (h0, h1, d0, d1, ny) => B.quad(
        [x0 - nx0 * d0, y0 + h0, z0 - nz0 * d0], [x1 - nx1 * d0, y1 + h0, z1 - nz1 * d0],
        [x1 - nx1 * d1, y1 + h1, z1 - nz1 * d1], [x0 - nx0 * d1, y0 + h1, z0 - nz0 * d1],
        [-(nx0 + nx1) / 2, ny, -(nz0 + nz1) / 2], NOUV);
      const hm = (R_LO + R_HI) / 2;
      fold(R_LO, hm, 0.0, 0.08, -0.35);
      fold(hm, R_HI, 0.08, 0.0, 0.35);
      B.quad([x0, y0 + R_HI, z0], [x1, y1 + R_HI, z1], [x1 + nx1 * 0.12, y1 + R_HI - 0.02, z1 + nz1 * 0.12], [x0 + nx0 * 0.12, y0 + R_HI - 0.02, z0 + nz0 * 0.12], [0, 1, 0], NOUV);
      // posts behind the beam (blockouts), on the batter
      const P = K.B(x0, z0, 'railPost');
      for (since += L; since >= 1.9; since -= 1.9) {
        const f = 1 - (since - 1.9) / L;
        const px = x0 + (x1 - x0) * f + nx0 * 0.22, pz = z0 + (z1 - z0) * f + nz0 * 0.22, py = y0 + (y1 - y0) * f;
        const g = Math.min(py, G.terrainHeight(px, pz));
        P.box(px, g - 0.4, pz, 0.15, py + R_HI - 0.05 - (g - 0.4), 0.15, Math.atan2(nz0, nx0));
        STATS.railPosts++;
      }
      solids.push({ x: (x0 + x1) / 2 + nx0 * 0.1, z: (z0 + z1) / 2 + nz0 * 0.1, hw: L / 2 + 0.05, hd: 0.12,
        rot: Math.atan2(z1 - z0, x1 - x0), y0: Math.min(y0, y1) - 0.2, y1: Math.max(y0, y1) + R_HI, mono: true });
      STATS.rail += L;
    }
  };
  city.edges.forEach((e, ei) => {
    if (!railEdge(ei) || !e.pe || e.len < 2) return;
    const k = e.pk, a = city.nodes[e.a];
    const px = -e.dz, pz = e.dx;
    const dA = bd.has(e.a) ? bd.get(e.a) : Infinity, dB = bd.has(e.b) ? bd.get(e.b) : Infinity;
    for (let s = 0; s < 2; s++) {
      const sg = s === 0 ? 1 : -1;
      // which side of travel this is: a one-way's left shoulder (the median's) is
      // railed only where no tall wall stands beyond it
      const leftSide = fwdOf(e) * sg < 0;
      let run = [];
      const flush = () => { railRun(run); run = []; };
      for (let i = 0; i <= k; i++) {
        const t = i / k;
        const ey = e.pe[i * 6 + s * 3], w = e.pe[i * 6 + s * 3 + 1], ty = e.pe[i * 6 + s * 3 + 2];
        const drop = w > 0 ? ey - ty : 0;
        const nearBridge = Math.min(dA + t * e.len, dB + (1 - t) * e.len) < BRIDGE_RUN;
        const tw = e.tw[i * 2 + s];
        const off = tw + R_OUT;
        const x = a.x + e.dx * e.len * t + px * sg * off, z = a.z + e.dz * e.len * t + pz * sg * off;
        const want = (drop > RAIL_DROP || nearBridge) && tw > e.hw - 0.5
          && !(leftSide && wallWithin(x, z, 12)) && !onCw(x, z, 0.2);
        if (!want) { flush(); continue; }
        run.push([x, z, ey, px * sg, pz * sg]);
      }
      flush();
    }
  });

  // ---- high-mast lighting ---------------------------------------------------
  // The freeway-to-freeway interchanges are lit from 30 m galvanized masts
  // with a ring of luminaires (MTO's high-mast standard), stood in the
  // infields and verges among the ramps: the 401 / Hwy 8 interchange and Hwy 8
  // at the Conestoga. Where: exits whose destination is the other freeway
  // (hwy.json) mark each interchange; masts on a ~150 m lattice over it, each
  // 12-60 m from a carriageway and on none (nor in a building or water).
  const IC = [['401', '8'], ['8', '7'], ['8', '85'], ['7;8', '8'], ['7', '8']];
  const centres = [];
  for (const x of HW.exits || []) {
    const refs = (x.dref || []).map((r) => (/^\s*(\d+)/.exec(r) || [])[1]).filter(Boolean);
    if (!IC.some(([m, d]) => (x.main === m || x.main === `ON ${m}`) && refs.includes(d))) continue;
    let c = centres.find((q) => Math.hypot(q.x - x.x, q.z - x.z) < 1400);
    if (!c) centres.push((c = { x: 0, z: 0, n: 0, pts: [] }));
    c.pts.push([x.x, x.z]); c.n++;
    c.x = c.pts.reduce((s2, p) => s2 + p[0], 0) / c.n; c.z = c.pts.reduce((s2, p) => s2 + p[1], 0) / c.n;
  }
  const masts = [];
  const nearCw = (x, z, r) => {
    let best = Infinity;
    for (const ei of city.edgesNear(x, z, r)) {
      const e = city.edges[ei];
      if (!(e.cls === 'hwy' || (e.cls === 'ramp' && fr[ei]))) continue;
      const A = city.nodes[e.a], Bn = city.nodes[e.b];
      const sx = Bn.x - A.x, sz = Bn.z - A.z, l2 = sx * sx + sz * sz;
      let t = l2 > 0 ? ((x - A.x) * sx + (z - A.z) * sz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(A.x + sx * t - x, A.z + sz * t - z) - e.hw);
    }
    return best;
  };
  for (const c of centres) {
    const R = Math.min(750, 250 + Math.max(...c.pts.map((p) => Math.hypot(p[0] - c.x, p[1] - c.z))));
    const cand = [];
    for (let gx = -R; gx <= R; gx += 25) for (let gz = -R; gz <= R; gz += 25) {
      if (gx * gx + gz * gz > R * R) continue;
      const x = c.x + gx, z = c.z + gz;
      const d = nearCw(x, z, 70);
      if (d < 12 || d > 60) continue;
      if (city.onRoad(x, z, 4) || G.isWater(x, z) || (city.insideBuilding && city.insideBuilding(x, z, G.terrainHeight(x, z), 3))) continue;
      cand.push([x, z, d]);
    }
    // from the interchange's heart outward, ~160 m apart, a dozen at most
    cand.sort((p, q) => Math.hypot(p[0] - c.x, p[1] - c.z) - Math.hypot(q[0] - c.x, q[1] - c.z));
    let n = 0;
    for (const [x, z] of cand) {
      if (n >= 12) break;
      if (masts.some(([mx, mz]) => (mx - x) ** 2 + (mz - z) ** 2 < 160 * 160)) continue;
      masts.push([x, z]); n++;
    }
  }
  for (const [x, z] of masts) {
    const y = G.terrainHeight(x, z) - 0.3, H = 30;
    if (STATS.masts < 3) STATS.views.push({ name: `mast${STATS.masts}`, c: [x + 110, z + 110, 25], t: [x, z, 14], fov: 55 });
    const M = K.B(x, z, 'mast');
    K.B(x, z, 'concDark').box(x, y, z, 1.4, 0.8, 1.4, 0);                  // the footing
    M.prism(x, y + 0.8, z, 0.6, H * 0.4, 8);                                // the shaft, tapering
    M.prism(x, y + 0.8 + H * 0.4, z, 0.45, H * 0.6 - 0.8, 8);
    M.box(x, y + H - 0.25, z, 3.8, 0.35, 3.8, 0);                           // the ring
    for (let q = 0; q < 6; q++) {
      const ang = (q / 6) * Math.PI * 2, lx = x + Math.cos(ang) * 1.8, lz = z + Math.sin(ang) * 1.8;
      K.B(x, z, 'lamp').box(lx, y + H - 0.85, lz, 0.8, 0.6, 1.1, ang);
      K.B(x, z, 'lens').box(lx, y + H - 0.9, lz, 0.65, 0.06, 0.9, ang);
    }
    solids.push({ x, z, r: 0.6, y0: y, y1: y + H });
    STATS.masts++;
  }

  // ---- shoulder rumble strips ------------------------------------------------
  // Milled into the paved right shoulder of the 400-series and the Parkway,
  // just outside the edge line: grooves 0.18 m long and 0.4 m wide every
  // 0.3 m, drawn as one every 0.9 m (the pattern reads the same from a car,
  // for a third of the triangles: ~7k a 1.5 km cell). In the furniture cells.
  for (let ei = 0; ei < city.edges.length; ei++) {
    const e = city.edges[ei];
    if (!isMain(e) || e.elev || !e.prof || e.len < 4) continue;
    const info = INFO.get(ei);
    if (!info || !/^(401|8|7;8|7|85)$/.test(info.ref || '')) continue;
    const a = city.nodes[e.a], px = -e.dz, pz = e.dx;
    const inset = Math.min(0.7, e.hw * 0.06);
    {
      const s = fwdOf(e) > 0 ? 0 : 1, sg = s === 0 ? 1 : -1;   // the right of travel
      for (let d = 0.3; d < e.len - 0.3; d += 0.9) {
        const t = d / e.len;
        const i = Math.min(e.pk, Math.round(t * e.pk));
        const tw = e.tw[i * 2 + s];
        if (tw < e.hw - 0.5) continue;
        const o = tw - inset + 0.28;      // just outside the edge line, on the shoulder
        const cx = a.x + e.dx * d + px * sg * o, cz = a.z + e.dz * d + pz * sg * o;
        if (onCw(cx + px * sg * 0.6, cz + pz * sg * 0.6, -0.4)) continue;
        const P = city.profAt(e, t);
        const y = P.h + P.s * sg * o + 0.045;
        const ux = e.dx * 0.09, uz = e.dz * 0.09, wx = px * sg * 0.2, wz = pz * sg * 0.2;
        K.B(cx, cz, 'rumble').quad([cx - ux - wx, y, cz - uz - wz], [cx + ux - wx, y, cz + uz - wz],
          [cx + ux + wx, y, cz + uz + wz], [cx - ux + wx, y, cz - uz + wz], [0, 1, 0], NOUV);
        STATS.rumble++;
      }
    }
  }

  // ---- signs ---------------------------------------------------------------
  const placed = [];   // [x, z] of every sign standing, to keep them apart
  const clear = (x, z, r) => !placed.some(([a, b]) => (a - x) * (a - x) + (b - z) * (b - z) < r * r);

  /** A ground-mounted sign on the right shoulder (two posts). */
  const ground = (f, P, off, lift = 2.0, under = null, view = null) => {
    if (!P) return false;
    const x = f.x + f.rx * off, z = f.z + f.rz * off;
    if (!clear(x, z, 25)) { STATS.why.near++; return false; }
    if (onCw(x, z, 0.6)) { STATS.why.road++; return false; }
    const yr = f.y(off > 0 ? f.wr : -f.wl);
    const yg = Math.min(yr, G.terrainHeight(x, z));
    let yb = yr + lift;
    // a distance plate under the sign ("1 km"), the sign above it
    if (under) { face(K, f, 0, off + P.w / 2 - under.w / 2, yb, under); yb += under.h + 0.05; }
    face(K, f, 0, off, yb, P);
    for (const s of P.w > 1.4 ? [-1, 1] : [0]) {
      const px = x + f.rx * s * P.w * 0.3 + f.ux * 0.12, pz = z + f.rz * s * P.w * 0.3 + f.uz * 0.12;
      post(K, solids, px, pz, yg - 0.3, yb + P.h - (P.tab || 0) - yg + 0.1, 0.12);
    }
    placed.push([x, z]);
    if (view) {
      const n = STATS.views.filter((v) => v.name.startsWith(view)).length;
      const v = walk(city, f.ei, f.t, -30);
      if (v && n < 4) {
        const o = v.wr - 2.6;
        STATS.views.push({ name: `${view}${n}`, c: [+(v.x + v.rx * o).toFixed(1), +(v.z + v.rz * o).toFixed(1), 1.4],
          t: [+x.toFixed(1), +z.toFixed(1), lift + 1], fov: 50 });
      }
    }
    return true;
  };

  /** An overhead cantilever from the right shoulder, the sign over the right lane(s). */
  const cantilever = (f, P) => {
    if (!P) return false;
    const offPost = f.wr + 1.6;
    const x = f.x + f.rx * offPost, z = f.z + f.rz * offPost;
    if (!clear(x, z, 30)) return false;
    if (onCw(x, z, 0.6)) { STATS.why.road++; return false; }
    const yr = f.y(f.wr);
    const yb = Math.max(yr, f.y(0)) + 5.4;
    const yg = Math.min(yr, G.terrainHeight(x, z));
    const cR = f.wr - 0.8 - Math.max(1.8, P.w / 2 - 0.4);   // the sign's centre, right of the centreline
    face(K, f, 0, cR, yb, P);
    const ang = Math.atan2(f.rz, f.rx);
    const topY = yb + P.h;
    post(K, solids, x, z, yg - 0.3, topY + 0.3 - yg, 0.45);
    // the truss arm: two chords and the sign's own hangers, from the post to past the panel
    const armL = offPost - (cR - P.w / 2) + 0.2;
    const amx = f.x + f.rx * (offPost - armL / 2) + f.ux * 0.35, amz = f.z + f.rz * (offPost - armL / 2) + f.uz * 0.35;
    const S = K.B(x, z, 'steel');
    S.box(amx, topY - 0.15, amz, armL, 0.14, 0.14, ang, W1);
    S.box(amx, yb + 0.15, amz, armL, 0.14, 0.14, ang, W1);
    for (let k = 0; k <= 4; k++) {
      const o = offPost - (k / 4) * armL;
      S.box(f.x + f.rx * o + f.ux * 0.35, yb + 0.15, f.z + f.rz * o + f.uz * 0.35, 0.08, P.h - 0.3, 0.08, ang, W1);
    }
    placed.push([x, z]);
    STATS.gantries++;
    return true;
  };

  // the small panels first, so a full atlas can only ever cost a guide sign
  for (const w of HW.ways) { const v = parseInt(w.sp, 10); if (v >= 60) speedPanel(atlas, v); }
  for (const x of HW.exits || []) {
    const m = nearestMain(city, idx, x.x, x.z, x.u[0], x.u[1], 20);
    if (!m) continue;
    STATS.exits++;
    const left = x.side === 'L';
    // the overhead sign 300 m out (further if another's is there)
    const P = guidePanel(atlas, x, null);
    if (P && !left) {
      for (const d of [300, 380, 220, 450]) {
        const f = walk(city, m.ei, m.t, -d);
        if (f && cantilever(f, P)) {
          // where to stand to see it (kwshots views: window.__hwy.views): 160 m back, in the right lane
          const v = walk(city, f.ei, f.t, -38) || f;
          const o = v.wr - 2.6;
          STATS.views.push({ name: `${x.main}-${x.ref || ''}-${(x.street[0] || x.dest[0] || x.dref[0] || '').replace(/\W+/g, '')}`,
            c: [+(v.x + v.rx * (o - 2)).toFixed(1), +(v.z + v.rz * (o - 2)).toFixed(1), 1.4],
            t: [+(f.x + f.rx * o).toFixed(1), +(f.z + f.rz * o).toFixed(1), 6], fov: 55 });
          break;
        }
      }
      // the advance sign at 1 km, where the carriageway is that long
      const f = walk(city, m.ei, m.t, -1000);
      if (f) ground(f, P, f.wr + 1.6 + P.w / 2, 1.6, kmPanel(atlas), 'adv');
    }
    // the EXIT sign in the gore, on the side the ramp leaves by
    const GP = goreExit(atlas, x.ref, left);
    // (a left exit's gore is on the driver's left; the first spot down the
    // ramp where the gore has opened wide enough to stand a sign in)
    gore: for (let d = 60; d <= 240; d += 15) {
      const f = walk(city, m.ei, m.t, d);
      if (!f) break;
      for (const o of [2.4, 3.4]) if (ground(f, GP, left ? -(f.wl + o) : f.wr + o, 1.6, null, 'gore')) break gore;
    }
  }

  // speed limits and route markers after each entrance
  for (const mg of HW.merges || []) {
    const m = nearestMain(city, idx, mg.x, mg.z, mg.u[0], mg.u[1], 20);
    if (!m) { STATS.why.nomain++; continue; }
    const info = INFO.get(m.ei);
    const sp = info ? parseInt(info.sp, 10) : 0;
    if (sp >= 60) {
      for (const d of [180, 230, 290]) {
        const f = walk(city, m.ei, m.t, d);
        if (f && ground(f, speedPanel(atlas, sp), f.wr + 2.2, 1.7, null, 'spd')) { STATS.speed++; break; }
      }
    }
    const ref = (info && info.ref) || mg.main;
    const ax = AXIS[ref];
    if (ax) {
      const nums = ref.split(';');
      const f0 = walk(city, m.ei, m.t, 420);
      if (f0) {
        const dir = f0.ux * ax[0] + f0.uz * ax[1] >= 0 ? ax[2] : ax[3];
        if (ground(f0, routePanel(atlas, nums, dir), f0.wr + 2.2, 1.8, null, 'route')) STATS.shields++;
      }
    }
  }

  atlas.tex.needsUpdate = true;
  STATS.atlas = { full: atlas.full, rows: atlas.y + atlas.row, panels: atlas.cache.size };
  K.flush(atlas.mat);
  STATS.ms = Math.round(performance.now() - t0);
  STATS.wall = Math.round(STATS.wall); STATS.paved = Math.round(STATS.paved); STATS.rail = Math.round(STATS.rail);
  if (typeof window !== 'undefined') window.__hwy = STATS;
}
