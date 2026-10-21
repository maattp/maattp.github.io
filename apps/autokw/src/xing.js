// LEVEL CROSSINGS, shared by ION (link.js) and the heavy rail (kwrail.js):
// Canada's crossing signal [TC Grade Crossings Standards, 2014] -- a white
// mast, the red-bordered white crossbuck at its head, two red lamps on a black
// backboard, the bell on top, the gate mechanism and its striped arm -- and
// the logic every crossing shares: lights and bell from the moment a train is
// near, the arms down over 7 s after 3 s of flashing, up in 5; the arms and
// the lit lamps of every crossing near you in ONE instanced draw each; and
// the zone an AI car must not enter while they are down (traffic.js asks each
// system's `blocks`, which asks `xingClosed`).
//
// A crossing is { x, z, h (the track's heading), spread (the tracks' width
// across it), road (the carriageway edge it carries), gate (has arms) };
// `buildXingMast` gives it `gates`, `xingStart` its state.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';

const WHITE = [0.85, 0.86, 0.87], BLACK = [0.02, 0.02, 0.025], GREY = [0.32, 0.33, 0.35], CONC = [0.50, 0.49, 0.46];

/** A crossing's runtime state, zeroed. */
export function xingStart(c) {
  c.active = false; c.arm = 0; c.flash = 0; c.bellT = 0; c.lightT = 0;
  return c;
}

/**
 * The two signal masts of crossing `c` (static parts into `flat`, the
 * crossbuck boards into `sign` at UVs `xb` -- one board's [u0,v0,u1,v0,u1,v1,
 * u0,v1], or two for a bilingual pair), and the arms' pivots into `c.gates`.
 * `o.groundAt(x, z)`: the ground there; `o.solids`: where the masts go;
 * `o.onRoad(x, z)`: is that on a carriageway (the mast steps out past it);
 * `o.under(ch, mx, gy, mz, fx, fz, ux, uz)`: anything more on the mast.
 */
export function buildXingMast(c, flat, sign, xb, o) {
  const e = c.road;
  const rdx = e.dx, rdz = e.dz;
  const tdx = Math.sin(c.h), tdz = Math.cos(c.h);
  const sinA = Math.abs(rdx * tdz - rdz * tdx) || 1;
  const clear = (c.spread / 2 + 4.4) / sinA;
  const hw = e.hw;
  const boards = Array.isArray(xb[0]) ? xb : [xb, xb];
  c.gates = [];
  for (const a of [1, -1]) {
    // traffic coming toward the tracks from +a along the road keeps right:
    // its signal stands at its right kerb and its arm reaches the centreline
    const hx = -a * rdx, hz = -a * rdz;
    const rx = -hz, rz = hx;
    // ...OFF EVERY CARRIAGEWAY, not just its own road's: where another road
    // runs alongside (a one-way pair, a slip lane, the next street at a
    // skewed crossing) the mast at hw + 0.9 stood in its lanes, a solid post
    // cars stopped on, backed off and came back to (Kitchener, (-2008,
    // -159): a crash every 8 s). Stepped out to the right until clear.
    let out = hw + 0.9;
    if (o.onRoad) for (let k = 0; k < 10 && o.onRoad(c.x + a * rdx * clear + rx * out, c.z + a * rdz * clear + rz * out); k++) out += 0.75;
    const mx = c.x + a * rdx * clear + rx * out, mz = c.z + a * rdz * clear + rz * out;
    const gy = o.groundAt(mx, mz);
    flat.box(mx, gy, mz, 0.16, 4.4, 0.16, 0, WHITE);
    flat.box(mx, gy, mz, 0.6, 0.3, 0.6, 0, CONC);
    const face = Math.atan2(-hx, -hz);
    const fx = -hx, fz = -hz, ux = Math.cos(face), uz = -Math.sin(face);
    // the lamps' backboard: black with a white edge, a lamp at each end with its hood
    flat.box(mx + fx * 0.1, gy + 2.36, mz + fz * 0.1, 1.2, 0.44, 0.04, -face, WHITE);
    flat.box(mx + fx * 0.12, gy + 2.38, mz + fz * 0.12, 1.14, 0.4, 0.04, -face, BLACK);
    for (const s of [1, -1]) {
      const lx = mx + ux * 0.38 * s + fx * 0.16, lz = mz + uz * 0.38 * s + fz * 0.16;
      flat.box(lx, gy + 2.43, lz, 0.3, 0.3, 0.08, -face, [0.12, 0.02, 0.02]);
      flat.box(lx + fx * 0.12, gy + 2.73, lz + fz * 0.12, 0.32, 0.03, 0.22, -face, BLACK);
    }
    // the bell on the mast's top, the crossbuck under it, facing the traffic
    flat.spheroid(mx, gy + 4.5, mz, 0.16, 8, 4, BLACK, 0.7);
    [0.785, -0.785].forEach((rot, k) => {
      const cx = mx + fx * 0.12, cz = mz + fz * 0.12, cy = gy + 3.75;
      const w = 1.22, h = 0.21, ca = Math.cos(rot), sa = Math.sin(rot);
      const P = (u, v) => [cx + ux * (u * ca - v * sa), cy + (u * sa + v * ca), cz + uz * (u * ca - v * sa)];
      sign.quad(P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2), [fx, 0, fz], boards[k], [1, 1, 1]);
    });
    if (o.under) o.under(mx, gy, mz, fx, fz, ux, uz);
    if (c.gate) {
      flat.box(mx - rx * 0.32, gy, mz - rz * 0.32, 0.5, 1.2, 0.5, 0, GREY);
      if (o.solids) o.solids.push({ x: mx, z: mz, r: 0.35, y0: gy, y1: gy + 4.4 });
      const len = Math.max(3, hw + 0.4) + (out - hw - 0.9);
      c.gates.push({ px: mx - rx * 0.32, py: gy + 0.95, pz: mz - rz * 0.32, dx: -rx, dz: -rz, len, lx: mx + fx * 0.16, ly: gy + 2.43, lz: mz + fz * 0.16, face, ux, uz });
    } else {
      if (o.solids) o.solids.push({ x: mx, z: mz, r: 0.3, y0: gy, y1: gy + 4.4 });
      c.gates.push({ px: null, lx: mx + fx * 0.16, ly: gy + 2.43, lz: mz + fz * 0.16, face, ux, uz });
    }
  }
}

/** Every gate arm and every lit lamp of a system's crossings: one instanced draw each. */
export class XingSignals {
  constructor(scene, mats, crossings, name) {
    const n = crossings.reduce((a, c) => a + (c.gates ? c.gates.length : 0), 0);
    this.n = n;
    if (!n) return;
    // a unit arm along +x: red and white stripes
    const b = new Builder(false);
    const N = 8;
    for (let i = 0; i < N; i++) b.box((i + 0.5) / N, -0.05, 0, 1 / N, 0.1, 0.1, 0, i % 2 ? [0.75, 0.04, 0.04] : [0.86, 0.86, 0.86]);
    b.box(-0.08, -0.14, 0, 0.18, 0.26, 0.24, 0, [0.25, 0.26, 0.28]);
    this.armMesh = new THREE.InstancedMesh(b.build(), mats.flat, n);
    this.armMesh.name = `${name}:gates`;
    this.armMesh.frustumCulled = false;
    this.armMesh.count = 0;
    scene.add(this.armMesh);
    const lb = new Builder(false);
    lb.box(0, -0.13, 0, 0.26, 0.26, 0.04, 0, [1.0, 0.08, 0.04]);
    this.lampMesh = new THREE.InstancedMesh(lb.build(), mats.glow, n * 2);
    this.lampMesh.name = `${name}:xlamps`;
    this.lampMesh.frustumCulled = false;
    this.lampMesh.count = 0;
    scene.add(this.lampMesh);
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YZX');
    this._v = new THREE.Vector3(); this._sc = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
  }

  /**
   * One frame: `activeFn(c)` says whether a train is near crossing c; the
   * lights, arms and bell follow. Posed within `near` m of (cx, cz).
   */
  update(crossings, dt, cx, cz, near, audio, activeFn, bellGain = 0.5) {
    let nArm = 0, nLamp = 0;
    const m = this._m4, q = this._q, e = this._e, v = this._v, scl = this._sc;
    for (const c of crossings) {
      const act = activeFn(c);
      c.active = act;
      c.lightT = act ? c.lightT + dt : 0;
      const want = act && c.lightT > 3 ? 1 : 0;
      c.arm = want ? Math.min(1, c.arm + dt / 7) : Math.max(0, c.arm - dt / 5);
      if (!this.armMesh || !c.gates || Math.hypot(c.x - cx, c.z - cz) > near) continue;
      const flashing = act || c.arm > 0.02;
      c.flash = (c.flash + dt * 1.6) % 2;
      for (const g of c.gates) {
        if (g.px !== null && c.gate) {
          const ang = (1 - c.arm) * 1.48;
          const yaw = Math.atan2(g.dx, g.dz) - Math.PI / 2;
          e.set(0, yaw, ang); q.setFromEuler(e);
          scl.set(g.len, 1, 1); v.set(g.px, g.py, g.pz);
          m.compose(v, q, scl);
          this.armMesh.setMatrixAt(nArm++, m);
        }
        if (flashing) {
          const s = c.flash < 1 ? 1 : -1;
          q.setFromAxisAngle(this._up, g.face);
          scl.set(1, 1, 1);
          v.set(g.lx + g.ux * 0.38 * s + Math.sin(g.face) * 0.05, g.ly + 0.13, g.lz + g.uz * 0.38 * s + Math.cos(g.face) * 0.05);
          m.compose(v, q, scl);
          this.lampMesh.setMatrixAt(nLamp++, m);
        }
      }
      if (flashing && audio && audio.ready) {
        c.bellT -= dt;
        if (c.bellT <= 0) {
          c.bellT = 0.52;
          if (Math.hypot(c.x - cx, c.z - cz) < 170) audio.play('xing_bell', { gain: bellGain, x: c.x, y: G.terrainHeight(c.x, c.z) + 3, z: c.z, ref: 10, maxD: 200, jitter: false });
        }
      }
    }
    if (this.armMesh) {
      this.armMesh.count = nArm; this.armMesh.instanceMatrix.needsUpdate = true;
      this.lampMesh.count = nLamp; this.lampMesh.instanceMatrix.needsUpdate = true;
      this.armMesh.visible = nArm > 0; this.lampMesh.visible = nLamp > 0;
    }
  }
}

/** 50 m cells listing the crossings near them, for `xingClosed`. */
export function xingIndex(crossings, keep = () => true) {
  const cells = new Map();
  crossings.forEach((c, i) => {
    if (!keep(c)) return;
    const cx = Math.floor(c.x / 50), cz = Math.floor(c.z / 50);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const kk = (cx + dx) * 100003 + cz + dz;
      if (!cells.has(kk)) cells.set(kk, []);
      cells.get(kk).push(i);
    }
  });
  return cells;
}

/**
 * THE AI STOP: is (x, z) between a crossing's gates while its lights are on
 * or its arms are not yet up? traffic.js scans ahead of each car with this
 * (through `blocks`) and stops it short of the first point that is -- unless
 * the car (`from`, optional) is already between them.
 */
export function xingClosed(cells, crossings, x, z, pad, from = null) {
  if (!cells) return false;
  const l = cells.get(Math.floor(x / 50) * 100003 + Math.floor(z / 50));
  if (!l) return false;
  for (const i of l) {
    const c = crossings[i];
    if (!c.active && c.arm < 0.05) continue;
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz > 900) continue;
    const perp = Math.abs(dx * Math.cos(c.h) - dz * Math.sin(c.h));
    if (perp >= c.spread / 2 + pad) continue;
    // `from`, the car asking: already between the gates, it drives on clear
    // (stopping there was stopping on the tracks)
    if (from) {
      const fx = from.x - c.x, fz = from.z - c.z;
      if (fx * fx + fz * fz < 900 && Math.abs(fx * Math.cos(c.h) - fz * Math.sin(c.h)) < c.spread / 2 + pad - 0.5) continue;
    }
    return true;
  }
  return false;
}
