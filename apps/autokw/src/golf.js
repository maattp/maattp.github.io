// GOLF AT WATERLOO REGION'S COURSES. Real holes from OpenStreetMap
// (data/golf.json, tools/kw/build_golf.py): Rockway in Kitchener and
// Westmount in Waterloo, all eighteen holes of each drawn and playable, three
// at a time -- every third tee (1, 4, 7, ...) starts a round of the next
// three. Each hole is OSM's: its par, the line from the tee to the green
// (doglegs and all), the tee box, the green, the fairways, the bunkers and
// any water, laid on the real ground (the ball runs downhill).
//
// The course's surfaces are OSM's polygons, cut along the terrain mesh's own
// triangles so they lie exactly on it (one draped mesh per course, a single
// draw): fairway and tee mown in stripes, a fringe round each green, the
// green, sand, water where the world draws none, a flagstick per hole.
//
// ENTER on a starting tee plays its three holes. Each shot: aim with the
// stick (or a drag) -- it starts at the pin, or down the hole's line where the
// pin is out of reach -- the club is picked by the distance (CLUB changes
// it), and SWING: the first tap stops the POWER meter, the second the
// ACCURACY needle as it sweeps back through the sweet spot -- early hooks it,
// late slices it, and either costs a little distance. The ball flies on
// ballistics with drag and a breeze (shown by the arrow), comes down, bounces
// and rolls by what it lands on -- green, fringe, fairway, tee, rough, sand
// -- and down the slope. Trunks knock it back. Water is a stroke and a drop
// where it went in; off the course (past its boundary, a road, a building)
// is a stroke and the shot again. On the green the putter comes out: one
// tap for pace, and the cup takes a ball rolling slowly enough over it.
//
// Pays for the three holes against their par: $150 for level, $50 a stroke
// either side, $500 more for a hole-in-one. Best round per course and start
// in localStorage `autokw-golf-<course>`.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { clamp, damp } from './util.js';
import { BONES, animateWalk } from './peds.js';
import { solveArm } from './vehicles.js';

const CUP_R = 0.054, BALL_R = 0.0214, BALL_DRAW = 0.045;
const YD = 1.0936;
const ROUND = 3;                  // holes in a round
// clubs: full carry in still air (m), launch angle, how much it runs out,
// spin: how hard the ball checks when it lands (m/s2 for its first half second)
const CLUBS = [
  { name: 'DRIVER', carry: 215, angle: 14, roll: 1.6, spin: 0.8, tee: true },
  { name: '3 WOOD', carry: 195, angle: 15, roll: 1.4, spin: 1.2 },
  { name: '5 IRON', carry: 165, angle: 18, roll: 1.1, spin: 1.8 },
  { name: '7 IRON', carry: 145, angle: 21, roll: 0.9, spin: 2.2 },
  { name: '9 IRON', carry: 122, angle: 27, roll: 0.7, spin: 3.4 },
  { name: 'P WEDGE', carry: 105, angle: 32, roll: 0.5, spin: 4.4 },
  { name: 'S WEDGE', carry: 80, angle: 40, roll: 0.3, spin: 5.4 },
  { name: 'PUTTER', carry: 0, angle: 0, roll: 1, spin: 0 },
];
const PUTTER = CLUBS.length - 1;
// what the ball meets: bounce, how fast it stops rolling (m/s2), colour (linear)
const SURF = {
  green: { e: 0.22, roll: 0.62, col: [0.1, 0.28, 0.05] },
  fringe: { e: 0.25, roll: 1.1, col: [0.08, 0.2, 0.038] },
  fairway: { e: 0.3, roll: 1.5, col: [0.085, 0.22, 0.04] },
  tee: { e: 0.3, roll: 1.5, col: [0.09, 0.24, 0.045] },
  bunker: { e: 0.02, roll: 9, col: [0.62, 0.52, 0.33] },
  water: { e: 0, roll: 9, col: [0.06, 0.16, 0.2] },
  rough: { e: 0.16, roll: 3.4, col: null },
  out: { e: 0.16, roll: 3.4, col: null },
};
// drawn over the terrain by: the ball rests at the same lift
const LIFT = { fairway: 0.05, fringe: 0.08, tee: 0.1, green: 0.11, bunker: 0.13, water: 0.14, rough: 0, out: 0 };
// which wins where two overlap
const PRI = { rough: 1, fairway: 2, fringe: 3, tee: 4, green: 5, bunker: 6, water: 7 };
const FLAG_COLS = [[0.75, 0.05, 0.03], [0.85, 0.6, 0.02], [0.03, 0.15, 0.7]];
const DRAG = 0.0042;      // quadratic drag, per m (the clubs' launch speeds are bisected against it)
const CELL = 16;          // the surface index's cell
const ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

function pip(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}
function centroid(p) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length], k = x0 * z1 - x1 * z0;
    a += k; cx += (x0 + x1) * k; cz += (z0 + z1) * k;
  }
  return Math.abs(a) < 1e-6 ? p[0] : [cx / (3 * a), cz / (3 * a)];
}
/** The polygon grown outward by d (mitred, capped at 2d). */
function grow(p, d) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  const s = a > 0 ? 1 : -1, n = p.length, out = [];
  for (let i = 0; i < n; i++) {
    const A = p[(i + n - 1) % n], B = p[i], C = p[(i + 1) % n];
    const e1 = [B[0] - A[0], B[1] - A[1]], e2 = [C[0] - B[0], C[1] - B[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    // outward normal of a CCW (in x, z) ring is (dz, -dx) * s
    const n1 = [(e1[1] / l1) * s, (-e1[0] / l1) * s], n2 = [(e2[1] / l2) * s, (-e2[0] / l2) * s];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = Math.min(2, 1 / Math.max(0.5, mx * n1[0] + mz * n1[1]));
    out.push([B[0] + mx * d * k, B[1] + mz * d * k]);
  }
  return out;
}
/** Keep the part of a convex polygon where a x + b z + c >= 0. */
function clipHalf(poly, a, b, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length];
    const fp = a * P[0] + b * P[1] + c, fq = a * Q[0] + b * Q[1] + c;
    if (fp >= 0) out.push(P);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
  }
  return out;
}
const segT = (px, pz, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
  return clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / L2, 0, 1);
};

/** One course from golf.json: its holes, its polygons and an index over them. */
function makeCourse(c, world) {
  const holes = c.holes.map((h) => {
    const line = h.line;
    let L = 0;
    const cum = [0];
    for (let i = 1; i < line.length; i++) { L += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); cum.push(L); }
    const [ux, uz] = (() => { const a = line[0], b = line[1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; })();
    return { n: h.n, par: h.par, line, cum, L, ux, uz, tee: { x: h.tee[0], z: h.tee[1] }, pin: { x: h.pin[0], z: h.pin[1] }, d: h };
  });
  const polys = [];
  const add = (kind, pts, hole) => {
    if (!pts || pts.length < 3) return;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    polys.push({ kind, pts, hole, x0, z0, x1, z1 });
  };
  for (const h of holes) {
    const d = h.d;
    for (const p of d.fairways) add('fairway', p, h);
    for (const p of d.rough) add('rough', p, h);
    add('tee', d.teePoly, h);
    for (const p of d.tees) add('tee', p, h);
    for (const p of [d.green, ...d.greens]) { add('fringe', grow(p, 1.6), h); add('green', p, h); }
    for (const p of d.bunkers) add('bunker', p, h);
    for (const p of d.water) add('water', p, h);
  }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of c.boundary) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (const p of polys) { x0 = Math.min(x0, p.x0); x1 = Math.max(x1, p.x1); z0 = Math.min(z0, p.z0); z1 = Math.max(z1, p.z1); }
  const nx = Math.ceil((x1 - x0) / CELL) + 1, nz = Math.ceil((z1 - z0) / CELL) + 1;
  const grid = new Map();
  for (const p of polys) {
    for (let j = Math.floor((p.z0 - z0) / CELL); j <= Math.floor((p.z1 - z0) / CELL); j++) {
      for (let i = Math.floor((p.x0 - x0) / CELL); i <= Math.floor((p.x1 - x0) / CELL); i++) {
        const k = j * nx + i;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(p);
      }
    }
  }
  // water the world already draws (a pond in its water field) is not drawn again
  for (const p of polys) if (p.kind === 'water') { const [cx, cz] = centroid(p.pts); p.drawn = world && world.waterLevelAt ? world.waterLevelAt(cx, cz) !== null : false; }
  const short = c.name.replace(/ Golf.*$/, '');
  return { id: c.id, name: c.name, short, boundary: c.boundary, holes, polys, grid, x0, z0, x1, z1, nx, nz };
}

/** Which surface is (x, z) on, on course C ('out' past its boundary)? */
function surfaceOf(C, x, z, poly = false) {
  if (x < C.x0 || z < C.z0 || x > C.x1 || z > C.z1) return poly ? null : 'out';
  const l = C.grid.get(Math.floor((z - C.z0) / CELL) * C.nx + Math.floor((x - C.x0) / CELL));
  let best = null;
  if (l) for (const p of l) {
    if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1 || (best && PRI[p.kind] <= PRI[best.kind])) continue;
    if (pip(p.pts, x, z)) best = p;
  }
  if (poly) return best;
  if (best) return best.kind;
  return pip(C.boundary, x, z) ? 'rough' : 'out';
}

export class Golf {
  /** data: golf.json; opts: { scene, city, world, audio, controls, onReward, onEnd } */
  constructor(data, opts) {
    this.o = opts;
    this.state = 'off';          // off | aim | power | accuracy | swing | fly | roll | rest | holed | card
    this.courses = ((data && data.courses) || []).map((c) => makeCourse(c, opts.world));
    this.bests = {};
    for (const C of this.courses) {
      try { this.bests[C.id] = JSON.parse(localStorage.getItem(`autokw-golf-${C.id}`) || '{}') || {}; } catch (e) { this.bests[C.id] = {}; }
    }
    this.C = this.courses[0] || null;
    this._v = new THREE.Vector3();
    if (!this.C) return;
    this._buildCourses();
    this._buildDom();
  }

  get active() { return this.state !== 'off'; }
  /** Fewest strokes of any round recorded (the passport counts > 0 as played). */
  get best() {
    let b = 0;
    for (const id in this.bests) for (const k in this.bests[id]) { const s = this.bests[id][k]; if (s > 0 && (!b || s < b)) b = s; }
    return b;
  }
  /** The tee each course's map marker stands at (its first hole's). */
  get firstTees() { return this.courses.map((C) => ({ x: C.holes[0].tee.x, z: C.holes[0].tee.z, name: C.name, short: C.short, id: C.id })); }

  /** Nothing grows on a tee, fairway, green or bunker, nor within 3 m of one (city.extraClear). */
  keepClear(x, z) {
    for (const C of this.courses) {
      if (x < C.x0 - 3 || z < C.z0 - 3 || x > C.x1 + 3 || z > C.z1 + 3) continue;
      for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
        const p = surfaceOf(C, x + dx, z + dz, true);
        if (p && p.kind !== 'rough') return true;
      }
    }
    return false;
  }

  // --- the courses: one draped mesh each --------------------------------------------

  _buildCourses() {
    const { scene } = this.o;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.courseMesh = new THREE.Group();
    this.courseMesh.name = 'golf';
    this.stats = { tris: 0 };
    for (const C of this.courses) {
      const b = new Builder(false);
      // A polygon drawn ON the terrain: earcut into triangles, each cut along
      // the terrain mesh's own 40 m cells and their diagonals (world.js
      // splits each cell along tx + tz = 1), so every piece is a plane through
      // the ground it lies on; then into mowing stripes along `st`.
      const S = G.HF_STEP, H = G.MAP_HALF;
      const drape = (pts, lift, col, st) => {
        let tris;
        try { tris = THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q[0], q[1])), []); } catch (e) { return; }
        const emit = (poly, c) => {
          if (poly.length < 3) return;
          const P = poly.map(([x, z]) => [x, G.terrainHeight(x, z) + lift, z]);
          // the piece's plane: the ground's normal
          const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], az = P[1][2] - P[0][2];
          let nx = 0, ny = 1, nz = 0;
          for (let k = 2; k < P.length; k++) {
            const bx = P[k][0] - P[0][0], by = P[k][1] - P[0][1], bz = P[k][2] - P[0][2];
            const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx, l = Math.hypot(cx, cy, cz);
            if (l > 1e-4) { const sg = cy < 0 ? -1 : 1; nx = (cx / l) * sg; ny = (cy / l) * sg; nz = (cz / l) * sg; break; }
          }
          for (let k = 1; k < P.length - 1; k++) b.tri(P[0], P[k], P[k + 1], [nx, ny, nz], c);
        };
        for (const [i0, i1, i2] of tris) {
          const T = [pts[i0], pts[i1], pts[i2]];
          const tx0 = Math.min(T[0][0], T[1][0], T[2][0]), tx1 = Math.max(T[0][0], T[1][0], T[2][0]);
          const tz0 = Math.min(T[0][1], T[1][1], T[2][1]), tz1 = Math.max(T[0][1], T[1][1], T[2][1]);
          for (let j = Math.floor((tz0 + H) / S); j <= Math.floor((tz1 + H) / S); j++) {
            for (let i = Math.floor((tx0 + H) / S); i <= Math.floor((tx1 + H) / S); i++) {
              const x0 = -H + i * S, z0 = -H + j * S, dd = x0 + z0 + S;
              const halves = [
                clipHalf(clipHalf(clipHalf(T, 1, 0, -x0), 0, 1, -z0), -1, -1, dd),
                clipHalf(clipHalf(clipHalf(T, -1, 0, x0 + S), 0, -1, z0 + S), 1, 1, -dd),
              ];
              for (const piece of halves) {
                if (piece.length < 3) continue;
                if (!st) { emit(piece, col); continue; }
                let s0 = Infinity, s1 = -Infinity;
                for (const [x, z] of piece) { const s = x * st.ux + z * st.uz; s0 = Math.min(s0, s); s1 = Math.max(s1, s); }
                for (let k = Math.floor(s0 / st.w); k * st.w < s1; k++) {
                  const band = clipHalf(clipHalf(piece, st.ux, st.uz, -k * st.w), -st.ux, -st.uz, (k + 1) * st.w);
                  const m = k % 2 ? 1.1 : 0.9;
                  emit(band, [col[0] * m, col[1] * m, col[2] * m]);
                }
              }
            }
          }
        }
      };
      const dirAt = (h, x, z) => {
        // the hole's direction where (x, z) is: its nearest leg
        let best = Infinity, ux = h.ux, uz = h.uz;
        for (let i = 1; i < h.line.length; i++) {
          const a = h.line[i - 1], c = h.line[i], t = segT(x, z, a, c);
          const d = Math.hypot(x - (a[0] + (c[0] - a[0]) * t), z - (a[1] + (c[1] - a[1]) * t));
          if (d < best) { best = d; const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; ux = (c[0] - a[0]) / l; uz = (c[1] - a[1]) / l; }
        }
        return [ux, uz];
      };
      const order = ['fairway', 'tee', 'fringe', 'green', 'bunker', 'water'];
      for (const kind of order) {
        for (const p of C.polys) {
          if (p.kind !== kind || (kind === 'water' && p.drawn)) continue;
          const [cx, cz] = centroid(p.pts);
          const [ux, uz] = dirAt(p.hole, cx, cz);
          const st = kind === 'fairway' ? { ux, uz, w: 12 } : kind === 'tee' ? { ux, uz, w: 3 } : kind === 'green' ? { ux: uz, uz: -ux, w: 3 } : null;
          drape(p.pts, LIFT[kind], SURF[kind].col, st);
        }
      }
      // the pins: the cup, the flagstick and its flag; the tee markers
      const Y = (x, z) => G.terrainHeight(x, z);
      for (const h of C.holes) {
        const py = Y(h.pin.x, h.pin.z) + LIFT.green + 0.003;
        const cup = [];
        for (let k = 0; k <= 12; k++) { const t = (k / 12) * Math.PI * 2; cup.push([h.pin.x + Math.cos(t) * CUP_R * 1.4, py, h.pin.z + Math.sin(t) * CUP_R * 1.4]); }
        for (let k = 0; k < 12; k++) b.tri([h.pin.x, py, h.pin.z], cup[k], cup[k + 1], [0, 1, 0], [0.01, 0.01, 0.012]);
        b.tube([h.pin.x, py - 0.1, h.pin.z], [h.pin.x, py + 2.3, h.pin.z], 0.014, 5, [0.9, 0.9, 0.86]);
        // the flag, both faces, blowing across the line of play
        const fc = FLAG_COLS[(h.n - 1) % 3], fx = h.uz * 0.55, fz = -h.ux * 0.55;
        const A = [h.pin.x, py + 2.3, h.pin.z], B = [h.pin.x, py + 1.92, h.pin.z], Cc = [h.pin.x + fx, py + 2.12, h.pin.z + fz];
        b.tri(A, B, Cc, [h.ux, 0, h.uz], fc); b.tri(A, Cc, B, [-h.ux, 0, -h.uz], fc);
        const sx = h.uz, sz = -h.ux;
        for (const sd of [-1, 1]) {
          const mx = h.tee.x + sx * sd * 2.4 + h.ux * 1.2, mz = h.tee.z + sz * sd * 2.4 + h.uz * 1.2;
          b.box(mx, Y(mx, mz) + LIFT.tee, mz, 0.16, 0.16, 0.16, 0, h.n % 3 === 1 ? [0.75, 0.05, 0.03] : [0.85, 0.85, 0.82]);
        }
      }
      const m = new THREE.Mesh(b.build(), mat);
      m.receiveShadow = true;
      m.name = `golf:${C.id}`;
      const tris = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
      this.stats.tris += tris; this.stats[C.id] = tris;
      this.courseMesh.add(m);
    }
    scene.add(this.courseMesh);
    // the ball, its trail, the aim marker, and the club
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_DRAW, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf8f8f4, roughness: 0.35 }));
    this.ball.castShadow = true;
    this.ball.visible = false;
    scene.add(this.ball);
    const TR = 64;
    this.trailPos = new Float32Array(TR * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.trail.frustumCulled = false; this.trail.visible = false; this.trailN = 0;
    scene.add(this.trail);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, depthWrite: false }));
    this.marker.visible = false;
    scene.add(this.marker);
    const cb = new Builder(false);
    cb.tube([0, 0, 0], [0, -0.92, 0], 0.007, 6, [0.6, 0.62, 0.66], true);
    cb.tube([0, 0.02, 0], [0, -0.22, 0], 0.013, 6, [0.08, 0.08, 0.09], true);          // grip
    cb.box(0.03, -1.0, 0, 0.1, 0.06, 0.03, 0, [0.7, 0.72, 0.75]);                         // head
    this.club = new THREE.Mesh(cb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 }));
    this.club.visible = false;
    scene.add(this.club);
  }

  // --- the overlay ------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'golfUi';
    d.innerHTML = `<div class="gTop"><span class="gHole"></span><span class="gShot"></span><span class="gDist"></span></div>
      <div class="gWind"><div class="gArrow">➤</div><div class="gWs"></div></div>
      <div class="gClub"><div class="gCn"></div><div class="gCc"></div><div class="gLie"></div></div>
      <div class="gMeter"><div class="gFill"></div><div class="gSweet"></div><div class="gNeedle"></div></div>
      <div class="gMsg"></div>
      <button class="gSwing">SWING</button><button class="gClubBtn">CLUB</button><button class="gQuit">✕</button>
      <div class="gHint">Aim with the stick · SWING: tap for power, tap again in the white</div>
      <div class="gCard"><div class="gCardC"></div><div class="gCardT"></div><table class="gTab"></table><div class="gCardS"></div><button class="gAgain">Play again</button><button class="gDone">Done</button></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #golfUi { position: absolute; inset: 0; z-index: 35; display: none; pointer-events: none; font: 800 14px -apple-system, Helvetica, sans-serif; color: #fff; }
      #golfUi.show { display: block; }
      body.golfOn #hud, body.golfOn #pad, body.golfOn #topBtns { display: none !important; }
      #golfUi .gTop { position: absolute; top: calc(12px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%); display: flex; gap: 16px; white-space: nowrap;
        background: rgba(16,40,24,.66); padding: 8px 16px; border-radius: 999px; letter-spacing: .05em; }
      #golfUi .gWind { position: absolute; top: calc(12px + var(--safe-t, 0px)); left: calc(16px + var(--safe-l, 0px)); width: 64px; text-align: center;
        background: rgba(16,40,24,.66); border-radius: 12px; padding: 6px 0; }
      #golfUi .gArrow { font-size: 24px; display: inline-block; transition: transform .2s; }
      #golfUi .gWs { font-size: 11px; opacity: .85; }
      #golfUi .gClub { position: absolute; left: calc(16px + var(--safe-l, 0px)); bottom: calc(20px + var(--safe-b, 0px)); background: rgba(16,40,24,.66); border-radius: 12px; padding: 8px 12px; }
      #golfUi .gCn { font-size: 16px; } #golfUi .gCc, #golfUi .gLie { font-size: 11px; opacity: .85; margin-top: 2px; }
      #golfUi .gMeter { position: absolute; left: 50%; bottom: calc(26px + var(--safe-b, 0px)); width: 52vw; height: 20px; transform: translateX(-50%);
        background: rgba(10,20,14,.6); border: 2px solid #fff5; border-radius: 10px; overflow: hidden; }
      #golfUi .gFill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: linear-gradient(90deg, #4fd07a, #f7d046 70%, #f06a3a); }
      #golfUi .gSweet { position: absolute; top: 0; bottom: 0; left: 8%; width: 4%; background: #ffffffcc; display: none; }
      #golfUi .gNeedle { position: absolute; top: -3px; bottom: -3px; width: 4px; left: 0; background: #fff; box-shadow: 0 0 6px #fff; display: none; }
      #golfUi .gMsg { position: absolute; top: 24%; width: 100%; text-align: center; font-size: 40px; font-weight: 900; text-shadow: 0 4px 16px #000b; opacity: 0; transition: opacity .15s; }
      #golfUi .gMsg.on { opacity: 1; }
      #golfUi button { pointer-events: auto; -webkit-tap-highlight-color: transparent; touch-action: manipulation; border: none; color: #fff; font: 900 15px -apple-system, Helvetica, sans-serif; }
      #golfUi .gSwing { position: absolute; right: calc(22px + var(--safe-r, 0px)); bottom: calc(34px + var(--safe-b, 0px)); width: 108px; height: 108px; border-radius: 50%;
        background: radial-gradient(circle at 40% 35%, #52b36a, #2c7a42); box-shadow: 0 6px 0 #1a4a28; letter-spacing: .06em; }
      #golfUi .gSwing:active { transform: translateY(4px); box-shadow: 0 2px 0 #1a4a28; }
      #golfUi .gClubBtn { position: absolute; right: calc(142px + var(--safe-r, 0px)); bottom: calc(46px + var(--safe-b, 0px)); width: 64px; height: 64px; border-radius: 50%; background: rgba(16,40,24,.75); }
      #golfUi .gQuit { position: absolute; top: calc(12px + var(--safe-t, 0px)); right: calc(16px + var(--safe-r, 0px)); width: 40px; height: 40px; border-radius: 50%; background: rgba(16,40,24,.66); }
      #golfUi .gHint { position: absolute; left: 0; right: 0; bottom: calc(52px + var(--safe-b, 0px)); text-align: center; font-size: 12px; opacity: .8; text-shadow: 0 1px 6px #000; }
      #golfUi .gCard { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(8,20,12,.6); pointer-events: auto; }
      #golfUi .gCard.on { display: flex; }
      #golfUi .gCardC { font-size: 14px; letter-spacing: .08em; opacity: .85; }
      #golfUi .gCardT { font-size: 32px; font-weight: 900; }
      #golfUi .gTab { border-collapse: collapse; font-size: 15px; } #golfUi .gTab td { padding: 5px 12px; border: 1px solid #fff4; text-align: center; }
      #golfUi .gCardS { font-size: 14px; opacity: .88; margin-bottom: 6px; }
      #golfUi .gAgain, #golfUi .gDone { padding: 11px 30px; border-radius: 999px; background: #2c7a42; }
      #golfUi .gDone { background: rgba(255,255,255,.18); }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { hole: q('.gHole'), shot: q('.gShot'), dist: q('.gDist'), arrow: q('.gArrow'), ws: q('.gWs'), cn: q('.gCn'), cc: q('.gCc'), lie: q('.gLie'),
      meter: q('.gMeter'), fill: q('.gFill'), sweet: q('.gSweet'), needle: q('.gNeedle'), msg: q('.gMsg'), hint: q('.gHint'),
      card: q('.gCard'), cardC: q('.gCardC'), cardT: q('.gCardT'), tab: q('.gTab'), cardS: q('.gCardS'), clubBtn: q('.gClubBtn') };
    q('.gSwing').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.tap(); });
    q('.gClubBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.nextClub(); });
    q('.gQuit').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.close(); });
    q('.gAgain').addEventListener('click', () => this._round());
    q('.gDone').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter') this.tap();
      else if (e.code === 'KeyC') this.nextClub();
      else if (e.code === 'Escape') this.close();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
  }

  _msg(s, col, t = 1.6) {
    this.ui.msg.textContent = s;
    this.ui.msg.style.color = col || '#fff';
    this.ui.msg.classList.toggle('on', !!s);
    this._msgT = t;
  }

  // --- the round ----------------------------------------------------------------------

  /** ENTER on foot on (or by) a starting tee (holes 1, 4, 7, ...)? Remembers which. */
  near(pl) {
    for (const C of this.courses) {
      if (pl.x < C.x0 - 20 || pl.z < C.z0 - 20 || pl.x > C.x1 + 20 || pl.z > C.z1 + 20) continue;
      for (let k = 0; k < C.holes.length; k += ROUND) {
        const t = C.holes[k].tee;
        if (Math.hypot(pl.x - t.x, pl.z - t.z) < 8 && Math.abs(pl.y - G.terrainHeight(t.x, t.z)) < 3) { this._pick = { C, k }; return true; }
      }
    }
    return false;
  }

  start(env) {
    this.env = env;              // { camera, player }
    this.fov0 = env.camera.fov;
    if (this._pick) { this.C = this._pick.C; this.k0 = this._pick.k; } else this.k0 = this.k0 || 0;
    document.body.classList.add('golfOn');
    this.el.classList.add('show');
    this.club.visible = true;
    this._round();
  }

  /** The holes of this round. */
  get holes() { return this.C ? this.C.holes.slice(this.k0 || 0, (this.k0 || 0) + ROUND) : []; }

  _round() {
    this.scores = [];
    this.holeIndex = 0;
    this.aces = 0;
    this.paid = 0;
    this.ui.card.classList.remove('on');
    this._hole(0);
  }

  _hole(i) {
    const h = this.holes[i];
    this.h = h;
    this.holeIndex = i;
    this.strokes = 0;
    this.spin = 0; this.check = 0;
    // a breeze for the hole: 0-6 m/s from anywhere
    const wa = Math.random() * Math.PI * 2, ws = Math.random() * 6;
    this.wind = { x: Math.cos(wa) * ws, z: Math.sin(wa) * ws, s: ws };
    this._placeBall(h.tee.x, h.tee.z);
    this._cam = null;
    this._msg(`HOLE ${h.n} · PAR ${h.par} · ${Math.round(h.L * YD)} YDS`, '#fff', 2.2);
    this._ready();
  }

  _surf(x, z) { return surfaceOf(this.C, x, z); }

  _placeBall(x, z) {
    this.bx = x; this.bz = z;
    this.by = this._ground(x, z) + BALL_R;
    this.ball.position.set(x, this.by + (BALL_DRAW - BALL_R), z);
    this.ball.visible = true;
  }

  _ground(x, z) {
    // what is drawn there: each surface at its lift over the terrain
    return G.terrainHeight(x, z) + LIFT[this._surf(x, z)];
  }

  /** Where to aim from the ball: the pin, or down the hole's line as far as a driver goes. */
  _target() {
    const h = this.h, reach = CLUBS[this.lie === 'tee' ? 0 : 1].carry * 0.97;
    const dPin = Math.hypot(h.pin.x - this.bx, h.pin.z - this.bz);
    if (dPin <= reach * 1.08) return { x: h.pin.x, z: h.pin.z, d: dPin, pin: true };
    // the nearest point on the line, then on along it until a driver's reach away
    let bi = 0, bt = 0, bd = Infinity;
    for (let i = 1; i < h.line.length; i++) {
      const a = h.line[i - 1], c = h.line[i], t = segT(this.bx, this.bz, a, c);
      const d = Math.hypot(this.bx - (a[0] + (c[0] - a[0]) * t), this.bz - (a[1] + (c[1] - a[1]) * t));
      if (d < bd) { bd = d; bi = i; bt = t; }
    }
    let s = h.cum[bi - 1] + (h.cum[bi] - h.cum[bi - 1]) * bt;
    const at = (s0) => {
      let i = 1;
      while (i < h.line.length - 1 && h.cum[i] < s0) i++;
      const a = h.line[i - 1], c = h.line[i], t = clamp((s0 - h.cum[i - 1]) / ((h.cum[i] - h.cum[i - 1]) || 1), 0, 1);
      return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
    };
    for (; s < h.L; s += 2) {
      const [x, z] = at(s);
      if (Math.hypot(x - this.bx, z - this.bz) >= reach) return { x, z, d: Math.hypot(x - this.bx, z - this.bz), pin: false };
    }
    return { x: h.pin.x, z: h.pin.z, d: dPin, pin: true };
  }

  /** Set up for the next stroke: pick the club, face the target. */
  _ready() {
    const h = this.h;
    const dist = Math.hypot(h.pin.x - this.bx, h.pin.z - this.bz);
    this.lie = this._surf(this.bx, this.bz);
    if (this.lie === 'green' || (this.lie === 'fringe' && dist < 15)) {
      this.clubI = PUTTER;
      this.aim = Math.atan2(h.pin.x - this.bx, h.pin.z - this.bz);
    } else {
      const tg = this._target();
      // the longest club that doesn't fly it much past, leaving room for the run;
      // no driver off the deck
      this.clubI = PUTTER - 1;
      for (let k = this.lie === 'tee' ? 0 : 1; k < PUTTER; k++) if (CLUBS[k].carry * 0.93 <= tg.d + 4) { this.clubI = k; break; }
      this.aim = Math.atan2(tg.x - this.bx, tg.z - this.bz);
      this.tgt = tg;
    }
    this.state = 'aim';
    this.power = 0; this.acc = 0; this.t = 0;
    this._hud();
  }

  nextClub() {
    if (this.state !== 'aim') return;
    this.clubI = (this.clubI + 1) % CLUBS.length;
    this._hud();
  }

  _hud() {
    const h = this.h, dist = Math.hypot(h.pin.x - this.bx, h.pin.z - this.bz);
    const c = CLUBS[this.clubI];
    this.ui.hole.textContent = `${this.C.short.toUpperCase()} · HOLE ${h.n} · PAR ${h.par}`;
    this.ui.shot.textContent = `STROKE ${this.strokes + 1}`;
    this.ui.dist.textContent = dist > 30 ? `${Math.round(dist * YD)} YDS` : `${dist.toFixed(1)} M`;
    this.ui.cn.textContent = c.name;
    this.ui.cc.textContent = c.carry ? `${Math.round(c.carry * YD)} yds full` : 'tap for pace';
    this.ui.lie.textContent = `lie: ${this.lie}`;
    // wind: an arrow turned to where it blows, as seen from behind the ball
    const rel = Math.atan2(this.wind.x, this.wind.z) - this.aim;
    this.ui.arrow.style.transform = `rotate(${(-rel * 180 / Math.PI) - 90}deg)`;
    this.ui.ws.textContent = `${Math.round(this.wind.s * 2.237)} MPH`;
  }

  tap() {
    if (this.state === 'aim') { this.state = 'power'; this.t = 0; }
    else if (this.state === 'power') {
      this.power = this._meter();
      if (this.clubI === PUTTER) { this.acc = 0; this._swing(); }
      else { this.state = 'accuracy'; this.t = 0; }
    } else if (this.state === 'accuracy') {
      this.acc = this._needle();
      this._swing();
    } else if (this.state === 'card') this._round();
  }

  /** The power meter: up to full and back down, ~1.5 s round. */
  _meter() { const u = (this.t / 0.75) % 2; return u < 1 ? u : 2 - u; }
  /** The accuracy needle sweeps back from the power mark to the start; the sweet spot is at 10 %. */
  _needle() { return this.power - this.t / 0.7; }

  _swing() {
    this.state = 'swing'; this.t = 0;
    this.strokes++;
    this._hud();
  }

  _launch() {
    const c = CLUBS[this.clubI];
    this.prev = { x: this.bx, z: this.bz };
    this.dry = { x: this.bx, z: this.bz };
    // accuracy: 0.1 is dead on; early (above) hooks left, late (below) slices right
    const err = clamp((this.acc - 0.1) / 0.1, -1.6, 1.6);
    if (this.clubI === PUTTER) {
      // a putt: pace from the meter, straight along the aim
      const sp = 0.5 + this.power * 6.2;
      this.vel = new THREE.Vector3(Math.sin(this.aim) * sp, 0, Math.cos(this.aim) * sp);
      this.spin = 0;
      this.check = 0;
      this.state = 'roll';
      this._sfx('bump', 0.2, 2.2);
      return;
    }
    const lieK = this.lie === 'rough' ? 0.85 : this.lie === 'bunker' ? 0.7 : 1;
    const v0 = this._speedFor(c) * Math.sqrt(clamp(this.power, 0.05, 1)) * lieK * (1 - 0.06 * Math.abs(err));
    const a = c.angle * Math.PI / 180;
    const yaw = this.aim + err * 0.035;
    this.vel = new THREE.Vector3(Math.sin(yaw) * Math.cos(a) * v0, Math.sin(a) * v0, Math.cos(yaw) * Math.cos(a) * v0);
    this.spin = -err * 2.2;           // sidespin: m/s2 of curve, across the flight
    this.state = 'fly'; this.t = 0;
    this.trailN = 0; this.trail.visible = true;
    this._sfx('punch', 0.55, 1.6);
  }

  /** Launch speed that carries a club its full distance in still air (bisected once and kept). */
  _speedFor(c) {
    if (c._v) return c._v;
    let lo = 10, hi = 160;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      if (this._carry(mid, c.angle) < c.carry) lo = mid; else hi = mid;
    }
    return (c._v = (lo + hi) / 2);
  }
  _carry(v0, deg) {
    const a = deg * Math.PI / 180, dt = 1 / 120;
    let x = 0, y = 0, vx = Math.cos(a) * v0, vy = Math.sin(a) * v0;
    for (let i = 0; i < 4000; i++) {
      const v = Math.hypot(vx, vy);
      vx -= DRAG * v * vx * dt; vy -= (9.81 + DRAG * v * vy) * dt;
      x += vx * dt; y += vy * dt;
      if (y < 0 && vy < 0) return x;
    }
    return x;
  }

  _flyStep(dt) {
    const P = this.vel, n = 6, sdt = dt / n;
    for (let k = 0; k < n; k++) {
      // air-relative drag, a breeze that grows with height, the curve
      const lift = clamp((this.by - this._ground(this.bx, this.bz)) / 20, 0.3, 1);
      const rx = P.x - this.wind.x * lift, rz = P.z - this.wind.z * lift, ry = P.y;
      const v = Math.hypot(rx, ry, rz);
      P.x -= DRAG * v * rx * sdt; P.y -= (9.81 + DRAG * v * ry) * sdt; P.z -= DRAG * v * rz * sdt;
      const hv = Math.hypot(P.x, P.z) || 1;
      P.x += (P.z / hv) * this.spin * sdt; P.z -= (P.x / hv) * this.spin * sdt;
      this.bx += P.x * sdt; this.by += P.y * sdt; this.bz += P.z * sdt;
      const kind = this._surf(this.bx, this.bz);
      if (kind !== 'water') this.dry = { x: this.bx, z: this.bz };
      // a trunk in the way knocks it back
      const gy = G.terrainHeight(this.bx, this.bz) + LIFT[kind];
      if (this.by - gy < 5) {
        const hit = this.o.city.obstacleHit && this.o.city.obstacleHit(this.bx, this.bz, 0.05, this.by);
        if (hit && hit.pen > 0) { P.x = hit.nx * Math.abs(P.x) * 0.3; P.z = hit.nz * Math.abs(P.z) * 0.3; P.y *= 0.4; this._sfx('thunk', 0.4, 1.4); }
      }
      if (this.by <= gy + BALL_R && P.y < 0) {
        if (kind === 'water') { this._water(); return; }
        // down: bounce by the surface, then roll
        const s = SURF[kind];
        this.by = gy + BALL_R;
        const c = CLUBS[this.clubI];
        P.y = -P.y * s.e;
        // the first bounce takes most of an iron shot's pace, and its
        // backspin checks it for half a second after (_rollStep)
        const keep = (1 - s.e * 0.5) * (0.22 + 0.3 * c.roll);
        P.x *= keep; P.z *= keep;
        this.check = 0.5;
        this._sfx('bump', 0.15, 2);
        if (Math.abs(P.y) < 1.2) { P.y = 0; this.state = 'roll'; }
      }
    }
    this.ball.position.set(this.bx, this.by + (BALL_DRAW - BALL_R), this.bz);
    // the trail
    if (this.trailN < this.trailPos.length / 3) {
      this.trailPos.set([this.bx, this.by, this.bz], this.trailN * 3);
      this.trailN++;
      this.trail.geometry.setDrawRange(0, this.trailN);
      this.trail.geometry.attributes.position.needsUpdate = true;
    } else {
      this.trailPos.copyWithin(0, 3); this.trailPos.set([this.bx, this.by, this.bz], this.trailPos.length - 3);
      this.trail.geometry.attributes.position.needsUpdate = true;
    }
  }

  /** In the water: a stroke, and a drop where it went in (a little back toward the shot). */
  _water() {
    this.strokes++;
    this._msg('WATER · +1', '#7ac8ff');
    this._sfx('splash', 0.5, 1.4);
    let { x, z } = this.dry;
    const dx = this.prev.x - x, dz = this.prev.z - z, l = Math.hypot(dx, dz) || 1;
    for (let k = 0; k < 40 && this._surf(x, z) === 'water'; k++) { x += (dx / l) * 1; z += (dz / l) * 1; }
    x += (dx / l) * Math.min(2, l); z += (dz / l) * Math.min(2, l);
    this._placeBall(x, z);
    this.vel.set(0, 0, 0);
    this.state = 'rest'; this.t = 0;
  }

  /** Off the course: a stroke, and the shot again from where it was hit. */
  _out() {
    this.strokes++;
    this._msg('OUT OF BOUNDS · +1', '#ff8a6a');
    this._placeBall(this.prev.x, this.prev.z);
    this.vel.set(0, 0, 0);
    this.state = 'rest'; this.t = 0;
  }

  _rollStep(dt) {
    const h = this.h, P = this.vel, n = 4, sdt = dt / n;
    for (let k = 0; k < n; k++) {
      const kind = this._surf(this.bx, this.bz), s = SURF[kind];
      if (kind === 'water') { this._water(); return; }
      this.dry = { x: this.bx, z: this.bz };
      // downhill: the terrain's gradient
      const e = 0.5, g0 = G.terrainHeight(this.bx, this.bz);
      const gx = (G.terrainHeight(this.bx + e, this.bz) - g0) / e, gz = (G.terrainHeight(this.bx, this.bz + e) - g0) / e;
      // (0.4: the course is shaped flatter than the 40 m terrain under it)
      P.x -= 9.81 * gx * 0.4 * sdt; P.z -= 9.81 * gz * 0.4 * sdt;
      const sp = Math.hypot(P.x, P.z);
      const checkDec = this.check > 0 ? CLUBS[this.clubI].spin * (kind === 'rough' ? 0.5 : 1) : 0;
      this.check -= sdt;
      const dec = (s.roll + checkDec) * sdt;
      if (sp <= dec) { P.x = 0; P.z = 0; } else { P.x -= (P.x / sp) * dec; P.z -= (P.z / sp) * dec; }
      const nx = this.bx + P.x * sdt, nz = this.bz + P.z * sdt;
      // the cup: slow enough over it and it drops; faster lips out
      const cx = nx - h.pin.x, cz = nz - h.pin.z, cd = Math.hypot(cx, cz);
      if (cd < CUP_R + BALL_R * 0.6) {
        const spd = Math.hypot(P.x, P.z);
        if (spd < 1.6) { this.bx = h.pin.x; this.bz = h.pin.z; this._holed(); return; }
        // lip out: turned by the rim
        const t = Math.atan2(cz, cx) + Math.PI / 2;
        P.x = Math.cos(t) * spd * 0.7; P.z = Math.sin(t) * spd * 0.7;
      }
      this.bx = nx; this.bz = nz;
      // onto a road or into a building: out of bounds
      if (this.o.city.onRoad(this.bx, this.bz, 0) || (this.o.world.inBuilding && this.o.world.inBuilding(this.bx, this.bz, 0))) { this._out(); return; }
    }
    this.by = this._ground(this.bx, this.bz) + BALL_R;
    this.ball.position.set(this.bx, this.by + (BALL_DRAW - BALL_R), this.bz);
    if (Math.hypot(P.x, P.z) < 0.03) {
      // at rest past the course's boundary: out of bounds
      if (this._surf(this.bx, this.bz) === 'out') { this._out(); return; }
      this.state = 'rest'; this.t = 0;
    }
  }

  _holed() {
    const s = this.strokes, par = this.h.par, rel = s - par;
    this.ball.visible = false;
    this.state = 'holed'; this.t = 0;
    this.scores.push(s);
    const word = s === 1 ? 'HOLE IN ONE!!' : rel <= -3 ? 'ALBATROSS!' : rel === -2 ? 'EAGLE!' : rel === -1 ? 'BIRDIE!' : rel === 0 ? 'PAR'
      : rel === 1 ? 'BOGEY' : rel === 2 ? 'DOUBLE BOGEY' : `${s} STROKES`;
    const col = rel < 0 ? '#7dffa0' : rel === 0 ? '#ffe066' : '#ff9a6a';
    if (s === 1) this.aces++;
    this._msg(word, col, 2.4);
    this._sfx(rel < 0 ? 'pickup' : 'land', 0.5, rel < 0 ? 1 : 1.8);
    if (s === 1) this._sfx('cash', 0.6, 1);
  }

  _card() {
    this.state = 'card';
    const holes = this.holes;
    const PAR = holes.reduce((a, h) => a + h.par, 0);
    const total = this.scores.reduce((a, b) => a + b, 0), rel = total - PAR;
    const pay = Math.max(0, 150 + (PAR - total) * 50) + this.aces * 500;
    const key = String(holes[0].n), B = this.bests[this.C.id] || (this.bests[this.C.id] = {});
    if (!B[key] || total < B[key]) {
      B[key] = total;
      try { localStorage.setItem(`autokw-golf-${this.C.id}`, JSON.stringify(B)); } catch (e) { /* private */ }
    }
    this.ui.cardC.textContent = `${this.C.name.toUpperCase()} · HOLES ${holes[0].n}-${holes[holes.length - 1].n}`;
    this.ui.cardT.textContent = rel < 0 ? `${-rel} under par!` : rel === 0 ? 'Level par' : `${rel} over par`;
    this.ui.tab.innerHTML = `<tr><td>HOLE</td>${holes.map((h) => `<td>${h.n}</td>`).join('')}<td>TOTAL</td></tr>`
      + `<tr><td>PAR</td>${holes.map((h) => `<td>${h.par}</td>`).join('')}<td>${PAR}</td></tr>`
      + `<tr><td>YOU</td>${this.scores.map((s, i) => `<td style="color:${s < holes[i].par ? '#7dffa0' : s > holes[i].par ? '#ff9a6a' : '#fff'}">${s}</td>`).join('')}<td>${total}</td></tr>`;
    this.ui.cardS.textContent = `Paid $${pay} · best here ${B[key]}`;
    this.ui.card.classList.add('on');
    this.paid = pay;
    if (pay > 0 && this.o.onReward) this.o.onReward(pay, this.C);
  }

  close() {
    this.state = 'off';
    this.el.classList.remove('show');
    this.ui.card.classList.remove('on');
    document.body.classList.remove('golfOn');
    this.ball.visible = false; this.marker.visible = false; this.trail.visible = false; this.club.visible = false;
    const env = this.env;
    if (env) {
      const P = env.player;
      if (this.fov0) { env.camera.fov = this.fov0; env.camera.updateProjectionMatrix(); }
      P.camYaw = P.heading + Math.PI; P.camFootY = null;
      P.camPos.set(P.x - Math.sin(P.heading) * 4.6, P.y + 1.6, P.z - Math.cos(P.heading) * 4.6);
    }
    if (this.o.onEnd) this.o.onEnd();
  }

  _sfx(name, gain, rate) {
    const a = this.o.audio;
    if (a && a.play) a.play(name, { gain, rate: rate || 1 });
  }

  // --- the golfer ---------------------------------------------------------------------

  /** Stand the golfer at the ball and pose the swing (u: 0 address .. 1 finish). */
  _pose(u, dt) {
    const P = this.env.player;
    const putt = this.clubI === PUTTER;
    // address: side-on to the aim, the ball in front of the feet
    const fx = Math.sin(this.aim), fz = Math.cos(this.aim), rx = fz, rz = -fx;
    const stand = putt ? 0.55 : 0.78;
    P.x = this.bx + rx * stand; P.z = this.bz + rz * stand;
    P.y = this._ground(P.x, P.z);
    const face = Math.atan2(-rx, -rz);         // facing the ball, side-on to the line
    P.heading = face;
    P.h.group.position.set(P.x, P.y, P.z);
    P.h.group.rotation.y = face;
    animateWalk(P.h, 0, dt, 0);
    // the swing arc: the hands go back and up over the right shoulder, through
    // the ball, and up over the left
    const back = putt ? 0.35 : 1.9, thru = putt ? 0.35 : 2.2;
    let ang;                                    // 0 at address; + back, - through
    if (u <= 0) ang = 0;
    else if (u < 0.45) ang = back * ease(u / 0.45);
    else if (u < 0.6) ang = back - (back + thru * 0.35) * ease((u - 0.45) / 0.15);
    else ang = -thru * 0.35 - thru * 0.65 * ease((u - 0.6) / 0.4);
    const twist = clamp(ang, -2.2, 2) * 0.32;
    // a golfer's bend over the ball, and the turn
    const bones = P.h.bones;
    bones[BONES.spine].rotation.set(putt ? 0.5 : 0.38, twist * 0.5, 0);
    bones[BONES.chest].rotation.set(putt ? 0.15 : 0.1, twist * 0.5, 0);
    bones[BONES.thighL].rotation.x += -0.15; bones[BONES.thighR].rotation.x += -0.15;
    bones[BONES.kneeL].rotation.x += 0.2; bones[BONES.kneeR].rotation.x += 0.2;
    // the grip: a point on a circle round the shoulders in the swing plane
    const r = putt ? 0.72 : 0.78;
    const cy = P.y + (putt ? 1.1 : 1.28);
    const gx = P.x + (this.bx - P.x) * 0.45, gz = P.z + (this.bz - P.z) * 0.45;
    const toBall = new THREE.Vector3(this.bx - P.x, 0, this.bz - P.z).normalize();
    const along = new THREE.Vector3(fx, 0, fz);      // toward the target
    const grip = new THREE.Vector3(gx, cy, gz)
      .addScaledVector(toBall, -0.08 * (1 - Math.cos(ang)))
      .addScaledVector(along, -Math.sin(ang) * r)
      .add(new THREE.Vector3(0, -Math.cos(ang) * r * 0.6 + r * 0.2, 0));
    P.h.group.updateMatrixWorld(true);
    solveArm(bones[BONES.shoulderL], bones[BONES.elbowL], bones[BONES.handL], grip.clone().addScaledVector(along, 0.03), P.h.group, -1);
    solveArm(bones[BONES.shoulderR], bones[BONES.elbowR], bones[BONES.handR], grip.clone().addScaledVector(along, -0.03).addScaledVector(new THREE.Vector3(0, -1, 0), 0.06), P.h.group, 1);
    // the club: from the grip out along the arc's radius, the head to the ball at address
    const head = new THREE.Vector3(this.bx, this.by - 0.01, this.bz)
      .addScaledVector(along, -Math.sin(ang) * 1.6).add(new THREE.Vector3(0, (1 - Math.cos(ang)) * 1.2, 0));
    const dir = head.clone().sub(grip).normalize();
    this.club.position.copy(grip);
    this.club.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  }

  // --- the frame -----------------------------------------------------------------------

  update(dt) {
    if (!this.active || this.frozen) return;     // (frozen: tools holding a pose for a shot)
    const e = this.env, cam = e.camera, h = this.h;
    this.t += dt;
    if ((this._msgT -= dt) <= 0) this.ui.msg.classList.remove('on');
    const input = this.o.controls ? this.o.controls.read() : { x: 0 };
    const look = this.o.controls ? this.o.controls.takeLook() : { x: 0 };
    if (this.state === 'aim') {
      this.aim -= ((input.x || 0) * 0.5 * dt) + (look.x || 0) * 0.5;
      this._hud();
    }
    // meters
    const m = this.ui;
    if (this.state === 'power') { m.fill.style.width = `${this._meter() * 100}%`; }
    if (this.state === 'accuracy') {
      const n = this._needle();
      m.needle.style.display = 'block'; m.sweet.style.display = 'block';
      m.needle.style.left = `calc(${clamp(n, -0.05, 1) * 100}% - 2px)`;
      if (n < -0.05) { this.acc = n; this._swing(); }
    }
    if (this.state === 'aim') { m.fill.style.width = '0'; m.needle.style.display = 'none'; m.sweet.style.display = this.clubI === PUTTER ? 'none' : 'block'; }
    // the golfer
    let u = 0;
    if (this.state === 'swing') {
      u = clamp(this.t / (this.clubI === PUTTER ? 0.8 : 1.1), 0, 1);
      if (u >= 0.52 && !this._hit) { this._hit = true; this._launch(); }
    } else if (this.state === 'fly' || this.state === 'roll') u = 1;
    if (this.state !== 'swing') this._hit = false;
    if (this.state === 'aim' || this.state === 'power' || this.state === 'accuracy' || this.state === 'swing') this._pose(u, dt);
    if (this.state === 'fly') this._flyStep(dt);
    else if (this.state === 'roll') this._rollStep(dt);
    else if (this.state === 'rest' && this.t > 0.9) { this.trail.visible = false; this._ready(); }
    else if (this.state === 'holed' && this.t > 2.4) {
      this.trail.visible = false;
      if (this.holeIndex < this.holes.length - 1) this._hole(this.holeIndex + 1);
      else this._card();
    }
    // the aim marker: where this club carries in still air, on the ground
    const c = CLUBS[this.clubI];
    if (this.state === 'aim' || this.state === 'power' || this.state === 'accuracy') {
      // carry goes as the launch speed squared, and the speed as sqrt(power)
      const pw = this.state === 'aim' ? 1 : this.state === 'power' ? this._meter() : this.power;
      const dist = c.carry ? c.carry * Math.max(0.05, pw) : Math.min(Math.hypot(h.pin.x - this.bx, h.pin.z - this.bz), 30);
      const mx = this.bx + Math.sin(this.aim) * dist, mz = this.bz + Math.cos(this.aim) * dist;
      this.marker.position.set(mx, this._ground(mx, mz) + 0.12, mz);
      this.marker.scale.setScalar(c.carry ? 1 + dist / 40 : 0.35);
      this.marker.visible = true;
    } else this.marker.visible = false;
    this._camera(dt, cam);
  }

  _camera(dt, cam) {
    const fx = Math.sin(this.aim), fz = Math.cos(this.aim);
    let px, py, pz, lx, ly, lz;
    const putt = this.clubI === PUTTER;
    if (this.state === 'fly' || this.state === 'roll' || this.state === 'rest' || this.state === 'holed') {
      // follow the ball from behind and above, looking down the flight; further
      // back the faster it goes, so a drive stays in the frame
      const vx = this.vel ? this.vel.x : fx, vz = this.vel ? this.vel.z : fz, hv = Math.hypot(vx, vz) || 1;
      const bx = this.state === 'fly' ? vx / hv : fx, bz = this.state === 'fly' ? vz / hv : fz;
      const back = this.state === 'fly' ? 7 + Math.min(9, hv * 0.15) : putt ? 4 : 9;
      px = this.bx - bx * back; pz = this.bz - bz * back;
      py = Math.max(this.by, G.terrainHeight(this.bx, this.bz)) + (this.state === 'fly' ? 3 : putt ? 1.8 : 4);
      py = Math.max(py, G.terrainHeight(px, pz) + 1.5);
      lx = this.bx + bx * 8; lz = this.bz + bz * 8; ly = this.by;
    } else {
      // behind the golfer, down the line; a long shot looks further down it
      const look = putt ? 5 : clamp((this.tgt ? this.tgt.d : 60) * 0.35, 25, 80);
      px = this.bx - fx * (putt ? 3.2 : 4.6); pz = this.bz - fz * (putt ? 3.2 : 4.6);
      py = this.by + (putt ? 1.35 : 2.0);
      lx = this.bx + fx * look; lz = this.bz + fz * look;
      ly = G.terrainHeight(lx, lz) + (putt ? 0 : 1.0);
    }
    if (!this._cam || !Number.isFinite(this._cam.x + this._cam.lx)) this._cam = { x: px, y: py, z: pz, lx, ly, lz };
    const k = this.state === 'fly' ? 9 : 6, C = this._cam;
    C.x = damp(C.x, px, k, dt); C.y = damp(C.y, py, k, dt); C.z = damp(C.z, pz, k, dt);
    C.lx = damp(C.lx, lx, k * 1.5, dt); C.ly = damp(C.ly, ly, k * 1.5, dt); C.lz = damp(C.lz, lz, k * 1.5, dt);
    cam.position.set(C.x, C.y, C.z);
    // a 4 cm ball is a pixel from 30 m: keep it visible, not true to scale
    this.ball.scale.setScalar(Math.max(1, cam.position.distanceTo(this.ball.position) / (this.state === 'fly' ? 5 : 10)));
    cam.up.set(0, 1, 0);
    cam.lookAt(C.lx, C.ly, C.lz);
    cam.updateMatrixWorld(true);
  }
}
