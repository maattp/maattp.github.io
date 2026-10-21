// Auto KW: the cars in the driveways.
//
// A Kitchener-Waterloo street from the driver's seat is a car in nearly every
// driveway -- the street itself mostly empty, since Kitchener and Waterloo ban
// overnight street parking -- and the game's driveways were bare asphalt.
// world.js's house code (the garage in the footprint and the driveway out to
// the kerb) leaves a record per parked car in its chunk (`userData.dcars`:
// x, y, z, heading, type, colour seed); this keeps the ones within R of the
// camera and hands them to traffic.decor each frame, which draws them through
// the far LOD's InstancedMeshes as drivethru.js's lines are drawn: one draw
// per car type for every scenery car and far car in view, none of their own.
// Nothing here touches traffic's cars, its random numbers or its hash.
// Solid for the car you drive and for you on foot (pushed back out, as the
// drive-thru lines' bumpers are).
//
// Harness: __dbg.dcars (`shown`, `chunks`).

import * as THREE from './three.js';
import { vehicleAssets, farLod, randomCarColor } from './vehicles.js';

const ON_PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// the household fleet: crossovers and SUVs most, then sedans and minivans
// (the drive-thru lines' two types first, so a street and a Tims share draws)
export const DCAR_TYPES = ['crossover', 'suv', 'sedan', 'minivan'];
export const DCAR_REC = 6;

export class DrivewayCars {
  constructor() {
    this.traffic = null;
    this.R = ON_PHONE ? 90 : 140;
    this.STEP = 8;
    this.chunks = new Map();
    this.last = { x: 1e9, z: 1e9 };
    this.dirty = true;
    this.sel = [];              // the records in range: [recs, offset]
    this.pool = [];
    this.shown = 0;
    this.base = 0;              // traffic.decor's length before ours went in
  }

  /** The far LODs, once the vehicle assets exist (the first update). */
  _init(traffic) {
    this.traffic = traffic;
    const types = vehicleAssets().types;
    // a phone draws the drive-thru lines' two types only (sedans as
    // crossovers, minivans as SUVs): at most two draws, both shared with the
    // lines and the far traffic; the sedan and minivan cost two more
    const use = ON_PHONE ? ['crossover', 'suv', 'crossover', 'suv'] : DCAR_TYPES;
    this.types = use.map((t) => (types[t] ? t : null));
    for (const t of this.types) if (t) farLod(t);
    this.pivot = this.types.map((t) => (t ? types[t].spec.pivotY || 0 : 0));
    this.half = this.types.map((t) => (t ? [types[t].spec.len / 2, types[t].spec.wid / 2] : [2.3, 0.9]));
  }

  setChunk(key, recs) {
    if (!recs || !recs.length) { if (this.chunks.delete(key)) this.dirty = true; return; }
    this.chunks.set(key, recs);
    this.dirty = true;
  }

  dropChunk(key) {
    if (this.chunks.delete(key)) this.dirty = true;
  }

  _choose(px, pz) {
    const R = this.R + this.STEP, Rq = R * R;
    let n = 0;
    for (const recs of this.chunks.values()) {
      for (let o = 0; o < recs.length; o += DCAR_REC) {
        const dx = recs[o] - px, dz = recs[o + 2] - pz;
        if (dx * dx + dz * dz > Rq || !this.types[recs[o + 4]]) continue;
        let c = this.pool[n];
        if (!c) {
          c = this.pool[n] = { type: '', x: 0, y: 0, z: 0, h: 0, pivotY: 0, col: new THREE.Color(), k: -1, half: null };
        }
        const k = recs[o + 4];
        c.type = this.types[k]; c.x = recs[o]; c.y = recs[o + 1]; c.z = recs[o + 2]; c.h = recs[o + 3];
        c.pivotY = this.pivot[k]; c.half = this.half[k];
        if (c.k !== recs[o + 5]) { c.k = recs[o + 5]; c.col.set(randomCarColor(c.k | 0)); }
        n++;
      }
    }
    this.sel.length = n;
    for (let i = 0; i < n; i++) this.sel[i] = this.pool[i];
    this.shown = n;
  }

  /** Each frame, after the drive-throughs and before traffic draws. `own`: nobody else fills traffic.decor. */
  update(traffic, px, pz, player, own) {
    if (!this.traffic) this._init(traffic);
    const decor = this.traffic.decor;
    if (own) decor.length = 0;
    this.base = decor.length;
    const L = this.last;
    if (this.dirty || (px - L.x) ** 2 + (pz - L.z) ** 2 > this.STEP * this.STEP) {
      L.x = px; L.z = pz; this.dirty = false;
      this._choose(px, pz);
    }
    for (const c of this.sel) decor.push(c);
    if (player) this.keepOut(player);
  }

  /**
   * A posed view (the game paused, the camera moved: harness shots, the
   * photo mode): the cars round the CAMERA, drawn now. Ours from the last
   * update are taken out first; the drive-through lines' stay as they were.
   */
  posed(traffic, camera, player) {
    if (!this.traffic) this._init(traffic);
    const decor = this.traffic.decor;
    decor.length = Math.min(decor.length, this.base);
    const x = camera.position.x, z = camera.position.z;
    if (this.dirty || (x - this.last.x) ** 2 + (z - this.last.z) ** 2 > this.STEP * this.STEP) {
      this.last.x = x; this.last.z = z; this.dirty = false;
      this._choose(x, z);
    }
    for (const c of this.sel) decor.push(c);
    const p = player && (player.onFoot ? player : player.vehicle);
    // the far LOD culls against the frustum traffic.update keeps, stale while paused
    const cam = traffic.camera;
    if (cam && traffic._farFr) {
      cam.updateMatrixWorld();
      traffic._farM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      traffic._farFr.setFromProjectionMatrix(traffic._farM);
    }
    traffic.updateFarLod(p ? p.x : x, p ? p.z : z, player);
  }

  /** The player (in a road vehicle or on foot) pushed back out of any parked car it ran into. */
  keepOut(player) {
    const v = player.onFoot ? null : player.vehicle;
    if (v && (v.dead || (v.spec && (v.spec.plane || v.spec.boat || v.spec.rail || v.spec.balloon || v.spec.heli)))) return;
    const x = v ? v.x : player.x, z = v ? v.z : player.z;
    if (x === undefined) return;
    const fx = v ? Math.sin(v.heading) : 1, fz = v ? Math.cos(v.heading) : 0;
    const hl0 = v ? v.halfLen : 0.3, hw0 = v ? v.halfWid : 0.3;
    for (const c of this.sel) {
      const dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz > 100) continue;
      if (v && Math.abs((v.y || 0) - c.y) > 3) continue;
      const [hl, hw] = c.half, gx = Math.sin(c.h), gz = Math.cos(c.h);
      let best = Infinity, nx = 0, nz = 0;
      for (const [ux, uz] of [[fx, fz], [fz, -fx], [gx, gz], [gz, -gx]]) {
        const ra = hl0 * Math.abs(fx * ux + fz * uz) + hw0 * Math.abs(fz * ux - fx * uz);
        const rb = hl * Math.abs(gx * ux + gz * uz) + hw * Math.abs(gz * ux - gx * uz);
        const dd = dx * ux + dz * uz, o = ra + rb - Math.abs(dd);
        if (o <= 0) { best = -1; break; }
        if (o < best) { best = o; nx = dd < 0 ? -ux : ux; nz = dd < 0 ? -uz : uz; }
      }
      if (best <= 0) continue;
      if (!v) { player.x -= nx * best; player.z -= nz * best; continue; }
      v.x -= nx * best; v.z -= nz * best;
      const wx = fx * v.vLong + fz * v.vLat, wz = fz * v.vLong - fx * v.vLat;
      const into = wx * nx + wz * nz;
      if (into > 0) {
        const ax = wx - nx * into * 1.2, az = wz - nz * into * 1.2;
        v.vLong = ax * fx + az * fz; v.vLat = ax * fz - az * fx;
      }
    }
  }
}
