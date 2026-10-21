// REGION OF WATERLOO INTERNATIONAL AIRPORT (YKF), Breslau.
//
// From OSM's aeroways (kw.json `aero`, tools/kw/extract_aero.py): runway
// 08/26 (2,134 m) and 14/32 (1,250 m), the taxiways, the aprons and the
// terminal's stands. The field under them is graded at the import
// (tools/kw/build_raster.py grade_ykf); here
//   - the pavement is drawn over it: asphalt runways with their edge and
//     centre lines, threshold bars, aiming points and designators; taxiways
//     with yellow centrelines; concrete aprons;
//   - `surface(x, z)` is the pavement's top for city.slabQuery, so wheels,
//     feet and parked aircraft stand on what is drawn;
//   - `inField(x, z)` keeps the trees off the airfield;
//   - `stands()` is where the aircraft wait; `runway(id)` a runway from the
//     end it is used from (airtraffic.js);
//   - the control tower (prepTower / buildTower), FINAL APPROACH's door.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';

const LIFT = 0.07;                  // pavement over the graded field
const CELL = 8;                     // the pavement raster's spacing
const U0 = [0, 0, 0, 0, 0, 0, 0, 0];
const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
const ASPHALT = lin([0.24, 0.24, 0.25]), TAXI = lin([0.30, 0.30, 0.31]), APRON = lin([0.56, 0.56, 0.54]);
const WHITE = lin([0.93, 0.93, 0.92]), YELLOW = lin([0.92, 0.74, 0.12]);
// the control tower: its centre, its axes (A along the runway, B toward New
// Germany Lane, where the door is) and the base's half-width
const TOWER = { x: 7946.8, z: -877.4, ax: 0.909, az: -0.417, bx: 0.417, bz: 0.909, half: 6.5 };

function pointInPoly(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}
function segDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2));
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}

export class YKF {
  constructor(aero) {
    this.a = aero && aero.runways && aero.runways.length ? aero : null;
    if (!this.a) return;
    // the field's box, and the pavement raster over it
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const grow = (p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); };
    for (const r of this.a.runways) r.p.forEach(grow);
    for (const t of this.a.taxiways) t.p.forEach(grow);
    for (const ap of this.a.aprons) ap.p.forEach(grow);
    this.x0 = x0 - 200; this.z0 = z0 - 200; this.x1 = x1 + 200; this.z1 = z1 + 200;
    this.nx = Math.ceil((this.x1 - this.x0) / CELL); this.nz = Math.ceil((this.z1 - this.z0) / CELL);
    const pave = new Uint8Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      const z = this.z0 + (j + 0.5) * CELL;
      for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + (i + 0.5) * CELL;
        let on = 0;
        for (const r of this.a.runways) if (segDist(x, z, r.p[0], r.p[1]) < r.w / 2 + 3) on = 1;
        if (!on) for (const t of this.a.taxiways) {
          for (let k = 1; k < t.p.length && !on; k++) if (segDist(x, z, t.p[k - 1], t.p[k]) < 10.5) on = 1;
          if (on) break;
        }
        if (!on) for (const ap of this.a.aprons) if (pointInPoly(ap.p, x, z)) { on = 1; break; }
        pave[j * this.nx + i] = on;
      }
    }
    this.pave = pave;
  }

  _cell(x, z) {
    if (x < this.x0 || z < this.z0 || x >= this.x1 || z >= this.z1) return -1;
    return Math.floor((z - this.z0) / CELL) * this.nx + Math.floor((x - this.x0) / CELL);
  }

  /** The pavement's top at (x, z), or null off it (city.slabQuery). */
  surface(x, z) {
    if (!this.a) return null;
    const k = this._cell(x, z);
    return k >= 0 && this.pave[k] ? G.terrainHeight(x, z) + LIFT : null;
  }

  /** On the airfield, pavement and its grass margins: no trees. */
  inField(x, z) {
    if (!this.a) return false;
    if (x < this.x0 || z < this.z0 || x >= this.x1 || z >= this.z1) return false;
    for (const r of this.a.runways) if (segDist(x, z, r.p[0], r.p[1]) < r.w / 2 + 90) return true;
    const k = this._cell(x, z);
    if (k >= 0 && this.pave[k]) return true;
    for (const t of this.a.taxiways) for (let i = 1; i < t.p.length; i++) if (segDist(x, z, t.p[i - 1], t.p[i]) < 35) return true;
    return false;
  }

  /** landmarks.js extra: the pavement and its markings. */
  build(ctx) {
    if (!this.a) return;
    const T = (x, z) => G.terrainHeight(x, z) + LIFT;
    const B = new Builder(false);
    const strip = (a, b, hw, col, lift = 0, step = 16, o = 0) => {
      // a ribbon from a to b, hw either side of the line offset `o`, draped
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.1) return;
      const ux = dx / L, uz = dz / L, px = -uz, pz = ux;
      const n = Math.max(1, Math.ceil(L / step));
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * L, t1 = ((i + 1) / n) * L;
        const P = (t, s) => { const x = a[0] + ux * t + px * (o + s), z = a[1] + uz * t + pz * (o + s); return [x, T(x, z) + lift, z]; };
        B.quad(P(t0, -hw), P(t1, -hw), P(t1, hw), P(t0, hw), [0, 1, 0], U0, col);
      }
    };
    // taxiways first (the runways and aprons lie over them)
    for (const t of this.a.taxiways) {
      for (let i = 1; i < t.p.length; i++) {
        strip(t.p[i - 1], t.p[i], 10.5, TAXI, -0.005, 12);
        strip(t.p[i - 1], t.p[i], 0.16, YELLOW, 0.01, 12);
      }
    }
    // aprons: triangulated, at the levelled field
    for (const ap of this.a.aprons) {
      let tris = [];
      try { tris = THREE.ShapeUtils.triangulateShape(ap.p.map((q) => new THREE.Vector2(q[0], q[1])), []); } catch (e) { tris = []; }
      for (const [i, j, k] of tris) {
        const P = (q) => [q[0], T(q[0], q[1]) + 0.004, q[1]];
        B.tri(P(ap.p[i]), P(ap.p[j]), P(ap.p[k]), [0, 1, 0], APRON);
      }
    }
    // stands: a yellow lead-in line and a stop bar
    for (const s of this.a.stands) {
      strip(s.p[0], s.p[1], 0.14, YELLOW, 0.012, 8);
    }
    // the runways
    const atlas = ctx.atlas;
    const nums = new THREE.Group();
    for (const r of this.a.runways) {
      const [a, b] = r.p, dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      const ux = dx / L, uz = dz / L, hw = r.w / 2;
      strip(a, b, hw, ASPHALT, 0.008, 20);
      // edge lines
      strip(a, b, 0.45, WHITE, 0.016, 20, hw - 1.2);
      strip(a, b, 0.45, WHITE, 0.016, 20, -(hw - 1.2));
      const at = (t) => [a[0] + ux * t, a[1] + uz * t];
      // centreline: 36 m dashes, 24 m gaps, clear of the thresholds' marks
      for (let t = 110; t + 36 < L - 110; t += 60) strip(at(t), at(t + 36), 0.45, WHITE, 0.016, 36);
      // threshold bars at both ends: 8 a side, 30 m long
      for (const [t0, dir] of [[6, 1], [L - 6, -1]]) {
        for (let k = 0; k < 8; k++) {
          const off = (k - 3.5) * 2 * ((hw - 4) / 8) * (k < 4 ? 1.02 : 1.02);
          const s = [a[0] + ux * t0, a[1] + uz * t0];
          const e = [s[0] + ux * 30 * dir, s[1] + uz * 30 * dir];
          strip(s, e, 0.9, WHITE, 0.016, 30, off + (k < 4 ? -2.5 : 2.5));
        }
        // the aiming point: two blocks 300 m in
        const s = [a[0] + ux * (t0 + 300 * dir), a[1] + uz * (t0 + 300 * dir)];
        const e = [s[0] + ux * 45 * dir, s[1] + uz * 45 * dir];
        for (const o of [-7, 7]) strip(s, e, 3, WHITE, 0.016, 45, o);
      }
      // designators, from each end facing the approach: "08" at the west end reads landing east
      const [d0, d1] = r.ref.split('/');
      for (const [t0, label, dir] of [[52, d0, 1], [L - 52, d1, -1]]) {
        const p = atlas.panel(9, 16, 10, (g, W, H) => {
          g.clearRect(0, 0, W, H);
          g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.font = `700 ${H * 0.62}px Helvetica, Arial, sans-serif`;
          g.fillText(label, W / 2, H / 2, W * 0.98);
        });
        const cx = a[0] + ux * t0, cz = a[1] + uz * t0;
        p.position.set(cx, T(cx, cz) + 0.03, cz);
        // lying flat, its top toward the far end of the runway
        p.rotation.order = 'YXZ';
        p.rotation.set(-Math.PI / 2, Math.atan2(ux * dir, uz * dir) + Math.PI, 0);
        nums.add(p);
      }
    }
    const mesh = new THREE.Mesh(B.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    mesh.receiveShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    g.add(nums);
    ctx.addTo('ykf', g);
  }

  /** The stands: [x, z, heading] at each parking position's start, nose along its line. */
  stands() {
    if (!this.a) return [];
    return this.a.stands.map((s) => {
      const [a, b] = s.p;
      return [b[0], b[1], Math.atan2(a[0] - b[0], a[1] - b[1]), s.ref];
    });
  }

  /**
   * A runway by its ref ('08/26') or either end's designator ('26'): the end
   * it is used FROM (`t` the threshold, `u` the landing direction, `h` that
   * as a heading), its far end, length, width and the pavement's height.
   */
  runway(id) {
    if (!this.a) return null;
    const r = this.a.runways.find((q) => q.ref === id || q.ref.split('/').includes(id));
    if (!r) return null;
    const [d0, d1] = r.ref.split('/');
    const rev = id === d1;
    const [a, b] = rev ? [r.p[1], r.p[0]] : r.p;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const y = this.surface((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    return { ref: r.ref, id: rev ? d1 : d0, t: a, e: b, ux, uz, L, w: r.w, h: Math.atan2(ux, uz),
      y: y !== null ? y : G.terrainHeight((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) };
  }

  // --- the control tower -------------------------------------------------------------
  // NAV CANADA's 2017 tower, 19.4 m to its roof, built more central than the
  // 1969 one after 08/26 grew east. Placed on the stepped OSM footprint beside
  // New Germany Lane, by the Airport Operations Centre (an estimate: OSM does
  // not tag it): a two-storey base, a square shaft, an eight-sided glass cab
  // leaning out, the roof and a mast. Its door faces the lane.

  /** Before anything is meshed: the footprint's box goes flat (the tower is drawn here). */
  prepTower(city, boxAt) {
    const T = TOWER;
    this.tower = null;
    if (!this.a) return;
    const b = boxAt(city, T.x, T.z, 3);
    if (b && b.w * b.d < 600) { b.h = 0; if (!b.kw) b.kw = {}; b.kw.skip = true; }
    const y = G.terrainHeight(T.x, T.z);
    const dx = T.x + T.bx * (T.half + 1.6), dz = T.z + T.bz * (T.half + 1.6);
    this.tower = { x: dx, y: G.terrainHeight(dx, dz), z: dz, shaft: [T.x, T.z], cabY: y + 17.5, ground: y };
  }

  /** landmarks.js extra: the tower. */
  buildTower(ctx) {
    if (!this.tower) return;
    const T = TOWER, y0 = this.tower.ground - 0.3, rot = Math.atan2(T.az, T.ax);
    const B = new Builder(false), Gl = new Builder(false);
    const CLAD = lin([0.80, 0.81, 0.82]), SHAFT = lin([0.90, 0.90, 0.88]), TRIM = lin([0.42, 0.44, 0.47]);
    const DARK = lin([0.10, 0.12, 0.15]), GLASSC = lin([0.20, 0.28, 0.34]), RED = lin([0.95, 0.12, 0.08]);
    const at = (a, b) => [T.x + T.ax * a + T.bx * b, T.z + T.az * a + T.bz * b];
    const box = (bld, a, b, y, w, h, d, col, r = rot) => { const [x, z] = at(a, b); bld.box(x, y0 + y, z, w, h, d, r, col); };
    const S = T.half * 2;
    // the base: two storeys, a band of windows round each, a parapet
    box(B, 0, 0, 0, S, 6.8, S, CLAD);
    box(B, 0, 0, 6.8, S + 0.3, 0.45, S + 0.3, TRIM);
    for (const [y, h] of [[1.2, 1.3], [4.3, 1.3]]) {
      box(Gl, 0, 0, y, S + 0.08, h, S - 1.2, GLASSC);
      box(Gl, 0, 0, y, S - 1.2, h, S + 0.08, GLASSC);
    }
    // the door, its glass and a canopy over it
    box(Gl, 0, T.half + 0.02, 0.3, 2.0, 2.4, 0.08, DARK);
    box(B, 0, T.half + 0.9, 2.9, 3.2, 0.18, 1.8, TRIM);
    // the shaft, with a stair slot up its face
    box(B, 0, 0, 7.2, 5.4, 8.6, 5.4, SHAFT);
    box(Gl, 0, 2.72, 8, 0.9, 7.2, 0.06, DARK);
    // the cab's floor and lower wall: an octagon of two boxes
    for (const r of [rot, rot + Math.PI / 4]) box(B, 0, 0, 15.8, 7.9, 0.9, 7.9, TRIM, r);
    // the glass, leaning out: eight panes from radius 4.15 at 16.7 to 4.75 at 19.6
    const [cx, cz] = at(0, 0);
    const ring = (r, y) => Array.from({ length: 8 }, (_, k) => {
      const q = rot + (k + 0.5) * Math.PI / 4;
      return [cx + Math.cos(q) * r, y0 + y, cz + Math.sin(q) * r];
    });
    const lo = ring(4.15, 16.7), hi = ring(4.75, 19.6);
    for (let k = 0; k < 8; k++) {
      const k2 = (k + 1) % 8, q = rot + (k + 1) * Math.PI / 4;
      Gl.quad(lo[k], lo[k2], hi[k2], hi[k], [Math.cos(q), 0.2, Math.sin(q)], U0, GLASSC);
      B.tube(lo[k], hi[k], 0.09, 4, DARK);
    }
    // the roof: a broad octagon over the glass, a drum, the mast and its light
    for (const r of [rot, rot + Math.PI / 4]) box(B, 0, 0, 19.6, 10.2, 0.55, 10.2, TRIM, r);
    box(B, 0, 0, 20.15, 3.2, 1.0, 3.2, SHAFT);
    B.tube([cx + 0.8, y0 + 21, cz], [cx + 0.8, y0 + 26.5, cz], 0.07, 5, DARK);
    B.box(cx + 0.8, y0 + 26.5, cz, 0.3, 0.3, 0.3, 0, RED);
    const g = new THREE.Group();
    const opaque = new THREE.Mesh(B.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }));
    const glass = new THREE.Mesh(Gl.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.65, envMapIntensity: 1.4 }));
    opaque.castShadow = opaque.receiveShadow = true;
    g.add(opaque, glass);
    ctx.addTo('ykf', g);
    const [bx, bz] = at(0, 0);
    ctx.solids.push({ x: bx, z: bz, hw: T.half, hd: T.half, rot, y0: y0 - 1, y1: y0 + 21 });
  }

  /** Where a plane waits for take-off on 08: short of the threshold. */
  runwayEnd(ref = '08/26') {
    const r = this.a && this.a.runways.find((q) => q.ref === ref);
    if (!r) return null;
    const [a, b] = r.p, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    return { x: a[0] + ux * 60, z: a[1] + uz * 60, heading: Math.atan2(ux, uz), L };
  }
}
