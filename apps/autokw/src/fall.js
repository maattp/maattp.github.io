// FALL IN SEATTLE: the pumpkins on the front steps and the leaves coming down.
//
// The season's colour is elsewhere -- the turned crowns in trees.js
// (`fallAlbedo`), the leaf litter in the terrain shader (world.js), the mums,
// hay bales and leaf piles merged into each near chunk's flat mesh
// (world.js `fallHouse` / `fallShop`). This module draws the two things that
// want more than a box:
//
//   pumpkins  ribbed, stemmed, some carved into jack-o'-lanterns whose faces
//             glow. Planted as RECORDS by the near chunk build (world.js) and
//             drawn as ONE InstancedMesh, only within R of the camera: a
//             pumpkin is a few pixels past that, and a city's worth merged
//             into the chunks would be ~170 triangles times every house.
//   leaves    a pool of single leaves drifting down out of the broadleaf
//             crowns near the camera (the near tier's instances, trees.js),
//             fluttering, landing, lying a while and going. One draw.
//
// `FALL` (util.js) is the switch; with `?season=summer` neither is built.
import * as THREE from './three.js';
import { hash2, clamp } from './util.js';

const ON_PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// One pumpkin record: x, y (its base), z, radius, yaw, colour (0..1), carved (0/1).
export const PREC = 7;

// Pumpkin colours (linear albedo), weighted: the orange field pumpkin most of
// all, then the white "ghost", the tan Cinderella and a dark green heirloom.
const PUMPKIN_PAL = [
  [0.52, [0.80, 0.20, 0.012]],
  [0.18, [0.66, 0.13, 0.008]],
  [0.12, [0.82, 0.33, 0.05]],
  [0.08, [0.74, 0.71, 0.60]],
  [0.06, [0.66, 0.36, 0.11]],
  [0.04, [0.20, 0.26, 0.10]],
];
export function pumpkinColour(u, out) {
  let acc = 0;
  for (const [w, c] of PUMPKIN_PAL) { acc += w; if (u < acc) { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out; } }
  const c = PUMPKIN_PAL[0][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}

/**
 * The pumpkin at radius 1, its base at y = 0: an oblate lathe of eight lobes
 * (sixteen sides, the grooves pulled in and darkened), dimpled at the top,
 * with a bent five-sided stem. `body` is 1 on the skin (it takes the instance
 * colour) and 0 on the stem; `face` is 1 on the carved face, which glows and
 * which collapses to nothing on an uncarved pumpkin.
 */
function pumpkinGeometry() {
  const P = [], N = [], C = [], B = [], F = [], I = [];
  const v = (x, y, z, nx, ny, nz, c, body, face) => {
    const l = Math.hypot(nx, ny, nz) || 1;
    P.push(x, y, z); N.push(nx / l, ny / l, nz / l); C.push(c[0], c[1], c[2]); B.push(body); F.push(face);
    return P.length / 3 - 1;
  };
  const S = 16, HY = 0.7;   // sides, half-height (radius 1)
  // latitudes from the bottom (it sits on it: no cap) to the shoulder round
  // the top dimple
  const LAT = [-0.42, -0.25, -0.06, 0.12, 0.28, 0.42].map((t) => t * Math.PI);
  const rows = [];
  for (let r = 0; r < LAT.length; r++) {
    const ph = LAT[r], cl = Math.cos(ph), sl = Math.sin(ph);
    const row = [];
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2, groove = i % 2 === 1;
      const k = groove ? 0.88 : 1.0;
      const rr = cl * k;
      const y = HY + sl * HY;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const sh = groove ? 0.72 : 1.0;
      const ao = 0.62 + 0.38 * clamp((sl + 1) / 1.6, 0, 1);
      const c = [sh * ao, sh * ao, sh * ao];
      row.push(v(x, y, z, Math.cos(a) * cl, sl / HY * 0.7, Math.sin(a) * cl, c, 1, 0));
    }
    rows.push(row);
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      const a = rows[r][i], b = rows[r][j], c = rows[r + 1][j], d = rows[r + 1][i];
      I.push(a, c, b, a, d, c);
    }
  }
  // top cap: a fan down into the dimple, under the shoulder ring
  const topY = HY * 2 - 0.09;
  const ct = v(0, topY, 0, 0, 1, 0, [0.55, 0.55, 0.55], 1, 0);
  const tr = rows[rows.length - 1];
  for (let i = 0; i < S; i++) I.push(ct, tr[(i + 1) % S], tr[i]);
  // the stem: five sides, tapering, leaning off the axis
  const SC = [0.30, 0.26, 0.14], SC2 = [0.22, 0.2, 0.11];
  const s0 = [], s1 = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    s0.push(v(c * 0.1, topY - 0.04, s * 0.1, c, 0, s, SC2, 0, 0));
    s1.push(v(0.07 + c * 0.065, topY + 0.3, s * 0.065, c, 0.2, s, SC, 0, 0));
  }
  for (let i = 0; i < 5; i++) { const j = (i + 1) % 5; I.push(s0[i], s1[j], s0[j], s0[i], s1[i], s1[j]); }
  const sct = v(0.07, topY + 0.3, 0, 0, 1, 0, [0.42, 0.38, 0.24], 0, 0);
  for (let i = 0; i < 5; i++) I.push(sct, s1[(i + 1) % 5], s1[i]);
  // The face, toward +z: two triangle eyes, a nose and a toothed grin, each
  // vertex put on the skin (an ellipsoid of radius 1, half-height HY) along
  // its own direction and 2 cm proud of it.
  const onSkin = (x, y) => {
    const yy = (y - HY) / HY;
    const z = Math.sqrt(Math.max(0.02, 1 - x * x - yy * yy)) * 0.995 + 0.02;
    return [x, y, z];
  };
  const fc = [1, 1, 1];
  const ftri = (p, q, r) => {
    const a = onSkin(...p), b = onSkin(...q), c = onSkin(...r);
    const ia = v(...a, a[0], (a[1] - HY) / HY, a[2], fc, 1, 1);
    const ib = v(...b, b[0], (b[1] - HY) / HY, b[2], fc, 1, 1);
    const ic = v(...c, c[0], (c[1] - HY) / HY, c[2], fc, 1, 1);
    // facing +z: wound counter-clockwise seen from the front
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - a[0], vy = c[1] - a[1];
    if (ux * vy - uy * vx >= 0) I.push(ia, ib, ic); else I.push(ia, ic, ib);
  };
  ftri([-0.48, 0.88], [-0.16, 0.88], [-0.3, 1.1]);     // eyes
  ftri([0.16, 0.88], [0.48, 0.88], [0.3, 1.1]);
  ftri([-0.08, 0.72], [0.08, 0.72], [0, 0.84]);        // nose
  // the grin: a band with two teeth notched out of it
  const M = [[-0.52, 0.6], [-0.3, 0.46], [0, 0.42], [0.3, 0.46], [0.52, 0.6]];
  const Mb = [[-0.52, 0.6], [-0.3, 0.32], [0, 0.26], [0.3, 0.32], [0.52, 0.6]];
  for (let i = 0; i < 4; i++) {
    if (i === 1 || i === 2) {
      // a tooth hangs down from the top edge here: the band is its lower half
      const m0 = [M[i][0], (M[i][1] + Mb[i][1]) / 2], m1 = [M[i + 1][0], (M[i + 1][1] + Mb[i + 1][1]) / 2];
      ftri(m0, m1, Mb[i + 1]); ftri(m0, Mb[i + 1], Mb[i]);
      ftri(M[i], [(M[i][0] + M[i + 1][0]) / 2 - 0.04, (M[i][1] + M[i + 1][1]) / 2], m0);
    } else {
      ftri(M[i], M[i + 1], Mb[i + 1]); ftri(M[i], Mb[i + 1], Mb[i]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('body', new THREE.Float32BufferAttribute(B, 1));
  g.setAttribute('face', new THREE.Float32BufferAttribute(F, 1));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

function pumpkinMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float body;\nattribute float face;\nattribute float carve;\nvarying float vFace;')
      // an uncarved pumpkin's face collapses to a point: no area, nothing drawn
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nif ( face > 0.5 && carve < 0.5 ) transformed = vec3( 0.0 );\nvFace = face;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor = color * mix( vec3( 1.0 ), instanceColor, body );
        #endif`);
    // The carved face is the candle-lit inside: dark rind round a glow.
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFace;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if ( vFace > 0.5 ) { diffuseColor.rgb = vec3( 0.05, 0.02, 0.0 ); totalEmissiveRadiance = vec3( 1.6, 0.78, 0.16 ); }`);
  };
  m.customProgramCacheKey = () => 'fallPumpkin';
  return m;
}

/** A leaf: a pointed oval of six triangles, 1 unit long, in its own xz plane. */
function leafGeometry() {
  const P = [0, 0, -0.5, 0.22, 0, -0.2, 0.28, 0, 0.12, 0, 0, 0.5, -0.28, 0, 0.12, -0.22, 0, -0.2, 0, 0.02, 0];
  const I = [6, 0, 1, 6, 1, 2, 6, 2, 3, 6, 3, 4, 6, 4, 5, 6, 5, 0];
  const N = [], C = [];
  for (let i = 0; i < 7; i++) { N.push(0, 1, 0); const s = i === 6 ? 0.82 : 1; C.push(s, s, s); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  return g;
}

export class FallDecor {
  constructor(scene) {
    this.R = ON_PHONE ? 80 : 120;         // pumpkins drawn within this
    this.STEP = 8;
    this.chunks = new Map();
    this.last = { x: 1e9, z: 1e9 };
    this.dirty = true;
    this.group = new THREE.Group();
    this.group.name = 'fall';
    scene.add(this.group);

    const CAP = ON_PHONE ? 700 : 1400;
    const pg = pumpkinGeometry();
    this.carve = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
    this.carve.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('carve', this.carve);
    this.pumpkins = new THREE.InstancedMesh(pg, pumpkinMaterial(), CAP);
    this.pumpkins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pumpkins.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.pumpkins.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.pumpkins.frustumCulled = false;   // the set is chosen by distance
    this.pumpkins.receiveShadow = true;
    this.pumpkins.castShadow = false;
    this.pumpkins.count = 0;
    this.pumpkins.visible = false;
    this.pumpkins.name = 'fall:pumpkins';
    this.group.add(this.pumpkins);
    this.trisPumpkin = pg.index.count / 3;

    // the leaves coming down
    this.NL = ON_PHONE ? 140 : 260;
    const lm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.4 });
    this.leaves = new THREE.InstancedMesh(leafGeometry(), lm, this.NL);
    this.leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.NL * 3), 3);
    this.leaves.frustumCulled = false;
    this.leaves.count = 0;
    this.leaves.visible = false;
    this.leaves.name = 'fall:leaves';
    this.group.add(this.leaves);
    // per leaf: x, y, z, vy, ground, phase, spin, size, rest timer, alive
    this.L = new Float32Array(this.NL * 10);
    this.spawnAcc = 0;
    this.t = 0;
    this.trees = null;   // the TreeSystem, for the near broadleaf crowns
    this.warm = false;
  }

  setChunk(key, recs) {
    if (!recs || !recs.length) { if (this.chunks.delete(key)) this.dirty = true; return; }
    this.chunks.set(key, recs);
    this.dirty = true;
  }

  dropChunk(key) {
    if (this.chunks.delete(key)) this.dirty = true;
  }

  /** Before the scene pass: the pumpkins within R, refreshed every STEP metres. */
  update(camera, dt) {
    const px = camera.position.x, pz = camera.position.z;
    const L = this.last;
    if (this.dirty || this.warm || (px - L.x) ** 2 + (pz - L.z) ** 2 > this.STEP * this.STEP) {
      L.x = px; L.z = pz; this.dirty = false;
      this._choose(px, pz);
    }
    this._leaves(camera, dt);
  }

  _choose(px, pz) {
    const M = this.pumpkins, m = M.instanceMatrix.array, ca = M.instanceColor.array, cv = this.carve.array;
    const cap = cv.length, R = this.R + this.STEP, Rq = R * R;
    let n = 0;
    const c3 = [0, 0, 0];
    for (const recs of this.chunks.values()) {
      // records are in chunk order; a whole chunk well out of range is skipped
      // by its first record's distance only when the chunk is small, so test each
      for (let o = 0; o < recs.length && n < cap; o += PREC) {
        const x = recs[o], z = recs[o + 2];
        const dx = x - px, dz = z - pz;
        if (dx * dx + dz * dz > Rq) continue;
        const r = recs[o + 3], yaw = recs[o + 4], cs = Math.cos(yaw), sn = Math.sin(yaw);
        const q = n * 16;
        m[q] = cs * r; m[q + 1] = 0; m[q + 2] = -sn * r; m[q + 3] = 0;
        m[q + 4] = 0; m[q + 5] = r; m[q + 6] = 0; m[q + 7] = 0;
        m[q + 8] = sn * r; m[q + 9] = 0; m[q + 10] = cs * r; m[q + 11] = 0;
        m[q + 12] = x; m[q + 13] = recs[o + 1]; m[q + 14] = z; m[q + 15] = 1;
        pumpkinColour(recs[o + 5], c3);
        ca[n * 3] = c3[0]; ca[n * 3 + 1] = c3[1]; ca[n * 3 + 2] = c3[2];
        cv[n] = recs[o + 6];
        n++;
      }
    }
    // behind the loading screen, one degenerate instance so the program
    // compiles there (main.js warm-up)
    if (this.warm && n === 0) { m.fill(0, 0, 16); n = 1; }
    M.count = n;
    M.visible = n > 0;
    M.instanceMatrix.clearUpdateRanges(); M.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16); M.instanceMatrix.needsUpdate = true;
    M.instanceColor.clearUpdateRanges(); M.instanceColor.addUpdateRange(0, Math.max(1, n) * 3); M.instanceColor.needsUpdate = true;
    this.carve.clearUpdateRanges(); this.carve.addUpdateRange(0, Math.max(1, n)); this.carve.needsUpdate = true;
    this.shown = n;
  }

  /**
   * Leaves come down out of the near broadleaf crowns (the TreeSystem's near
   * tier: its instance matrices say where each crown is and how big, its
   * colours what it has turned). Each falls at ~1 m/s, swinging side to side
   * and turning as it goes, drifts with the breeze, lands, lies a few seconds
   * and shrinks away. Spawned only from crowns within ~32 m of the camera:
   * past that a leaf is a pixel. (Drawn a little larger than life, or one
   * coming down across a street is not seen at all.)
   */
  _leaves(camera, dt) {
    const near = this.trees && this.trees.near && this.trees.near[1];
    const LV = this.L, NL = this.NL, M = this.leaves, m = M.instanceMatrix.array, ca = M.instanceColor.array;
    this.t += dt;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const ce = camera.matrixWorld.elements, fl = Math.hypot(ce[8], ce[10]) || 1;
    const fwx = -ce[8] / fl, fwz = -ce[10] / fl;
    // spawn
    if (near && near.count > 0 && dt > 0) {
      this.spawnAcc += dt * (ON_PHONE ? 16 : 30);
      const tm = near.instanceMatrix.array, tc = near.instanceColor.array;
      let tries = 0;
      while (this.spawnAcc >= 1 && tries++ < 60) {
        const k = Math.floor(Math.random() * near.count), q = k * 16;
        const tx = tm[q + 12], ty = tm[q + 13], tz = tm[q + 14];
        const dx = tx - cx, dz = tz - cz, d2 = dx * dx + dz * dz;
        if (d2 > 32 * 32 || Math.abs(ty - cy) > 50) continue;
        // crowns in front of the camera, where a leaf can be seen coming down
        // (the near ones beside and over it too)
        if (d2 > 64 && dx * fwx + dz * fwz < 0.35 * Math.sqrt(d2)) continue;
        // a free slot
        let s = -1;
        for (let i = 0; i < NL; i++) if (LV[i * 10 + 9] === 0) { s = i; break; }
        if (s < 0) { this.spawnAcc = 0; break; }
        this.spawnAcc -= 1;
        const sx = Math.hypot(tm[q], tm[q + 2]), sy = tm[q + 5];
        const crR = 4.5 * sx * 0.8, crY = 12 * sy * 0.55, crH = 12 * sy * 0.4;
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * crR;
        const o = s * 10;
        LV[o] = tx + Math.cos(a) * rr; LV[o + 1] = ty + crY + (Math.random() - 0.6) * crH; LV[o + 2] = tz + Math.sin(a) * rr;
        LV[o + 3] = 0.7 + Math.random() * 0.6;   // fall speed
        LV[o + 4] = ty + 0.03;                   // the ground under the tree
        LV[o + 5] = Math.random() * 6.28;
        LV[o + 6] = (Math.random() - 0.5) * 6;
        LV[o + 7] = 0.22 + Math.random() * 0.12;
        LV[o + 8] = 0;
        LV[o + 9] = 1;
        // the tree's own colour, a leaf a little brighter or browner than it
        const k3 = k * 3, v = 0.85 + Math.random() * 0.4, br = Math.random() < 0.2 ? 0.6 : 1;
        ca[s * 3] = tc[k3] * v; ca[s * 3 + 1] = tc[k3 + 1] * v * br; ca[s * 3 + 2] = tc[k3 + 2] * v * br;
      }
      if (this.spawnAcc > 4) this.spawnAcc = 4;
    }
    // move and write
    const wx = 0.45, wz = 0.25;   // the breeze
    let n = 0;
    for (let i = 0; i < NL; i++) {
      const o = i * 10;
      if (LV[o + 9] === 0) continue;
      let scale = LV[o + 7];
      let rx, rz, yaw;
      if (LV[o + 8] === 0) {
        // falling: a pendulum swing across the drift, and a tumble
        const ph = LV[o + 5] + this.t * 2.2;
        LV[o] += (wx + Math.cos(ph) * 0.9) * dt;
        LV[o + 2] += (wz + Math.sin(ph * 0.7) * 0.5) * dt;
        LV[o + 1] -= LV[o + 3] * (0.75 + 0.5 * Math.abs(Math.sin(ph))) * dt;
        rx = Math.sin(ph) * 0.9; rz = Math.cos(ph * 1.3) * 0.6;
        yaw = LV[o + 5] + this.t * LV[o + 6];
        if (LV[o + 1] <= LV[o + 4]) { LV[o + 1] = LV[o + 4]; LV[o + 8] = 0.001; LV[o + 6] = yaw; }
      } else {
        // on the ground: lie flat a while, then shrink away
        LV[o + 8] += dt;
        rx = 0; rz = 0; yaw = LV[o + 6];
        const life = LV[o + 8];
        if (life > 2.5) scale *= Math.max(0, 1 - (life - 2.5) / 1.2);
        if (life > 3.7) { LV[o + 9] = 0; continue; }
      }
      // too far from the camera to see: retire it
      if ((LV[o] - cx) ** 2 + (LV[o + 2] - cz) ** 2 > 70 * 70) { LV[o + 9] = 0; continue; }
      // rotation: yaw about y, then tilt about x and z
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), cxr = Math.cos(rx), sxr = Math.sin(rx), czr = Math.cos(rz), szr = Math.sin(rz);
      // R = Ry * Rx * Rz
      const r00 = cyw * czr + syw * sxr * szr, r01 = -cyw * szr + syw * sxr * czr, r02 = syw * cxr;
      const r10 = cxr * szr, r11 = cxr * czr, r12 = -sxr;
      const r20 = -syw * czr + cyw * sxr * szr, r21 = syw * szr + cyw * sxr * czr, r22 = cyw * cxr;
      const q = n * 16;
      m[q] = r00 * scale; m[q + 1] = r10 * scale; m[q + 2] = r20 * scale; m[q + 3] = 0;
      m[q + 4] = r01 * scale; m[q + 5] = r11 * scale; m[q + 6] = r21 * scale; m[q + 7] = 0;
      m[q + 8] = r02 * scale; m[q + 9] = r12 * scale; m[q + 10] = r22 * scale; m[q + 11] = 0;
      m[q + 12] = LV[o]; m[q + 13] = LV[o + 1]; m[q + 14] = LV[o + 2]; m[q + 15] = 1;
      // keep the colour with the slot it was written to
      if (n !== i) {
        ca[n * 3] = ca[i * 3]; ca[n * 3 + 1] = ca[i * 3 + 1]; ca[n * 3 + 2] = ca[i * 3 + 2];
        // compact the state too, so slot n keeps this leaf
        for (let k = 0; k < 10; k++) LV[n * 10 + k] = LV[o + k];
        LV[o + 9] = 0;
      }
      n++;
    }
    if (this.warm && n === 0) { m.fill(0, 0, 16); n = 1; }
    M.count = n;
    M.visible = n > 0;
    M.instanceMatrix.needsUpdate = true;
    M.instanceColor.needsUpdate = true;
  }
}

/** A deterministic 0..1 for a pumpkin's colour from where it is. */
export const pumpkinSeed = (x, z, k) => hash2(Math.round(x * 13) + k * 31, Math.round(z * 13) - k * 17);
