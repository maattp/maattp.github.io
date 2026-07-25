// Scene construction: sky, terrain, water, streamed city chunks, distant
// skyline and the hand-built landmarks.

import * as THREE from './three.js';
import * as G from './geo.js';
import { CHUNK } from './citygen.js';
import { Builder } from './build.js';
import { hash2, clamp, lerp, distToSeg } from './util.js';

const ROAD_Y = 0.22;
const NODE_Y = 0.3;
const WALK_Y = 0.44;

const NEAR_R = 2; // chunks of full detail around the player
const MID_R = 4; // chunks that keep roads only

function tint(seed, base, spread) {
  const r = hash2(seed, 1), g = hash2(seed, 2), b = hash2(seed, 3);
  return [
    clamp(base[0] + (r - 0.5) * spread, 0.15, 1.4),
    clamp(base[1] + (g - 0.5) * spread, 0.15, 1.4),
    clamp(base[2] + (b - 0.5) * spread, 0.15, 1.4),
  ];
}

const GREY = [0.62, 0.62, 0.62];
const DARK = [0.3, 0.31, 0.33];

// ---------------------------------------------------------------------------

export class World {
  constructor(scene, city, tx, opts = {}) {
    this.scene = scene;
    this.city = city;
    this.tx = tx;
    this.shadows = opts.shadows !== false;
    this.chunks = new Map();
    this.pending = [];
    this.mats = {
      road: new THREE.MeshLambertMaterial({ map: tx.road, vertexColors: true }),
      walk: new THREE.MeshLambertMaterial({ map: tx.sidewalk, vertexColors: true }),
      glass: new THREE.MeshLambertMaterial({ map: tx.glass, vertexColors: true }),
      masonry: new THREE.MeshLambertMaterial({ map: tx.masonry, vertexColors: true }),
      industrial: new THREE.MeshLambertMaterial({ map: tx.industrial, vertexColors: true }),
      house: new THREE.MeshLambertMaterial({ map: tx.house, vertexColors: true }),
      flat: new THREE.MeshLambertMaterial({ vertexColors: true }),
      far: new THREE.MeshLambertMaterial({ vertexColors: true }),
    };
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  // --- static scenery -------------------------------------------------------

  buildSky() {
    const geo = new THREE.SphereGeometry(7200, 32, 20);
    const mat = new THREE.MeshBasicMaterial({ map: this.tx.sky, side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -1000;
    this.scene.add(sky);
    this.sky = sky;
  }

  *buildTerrain() {
    const hf = G.heightfield();
    const N = G.HF_N, S = G.HF_STEP, H = G.MAP_HALF;
    const TILES = 8;
    const per = Math.ceil((N - 1) / TILES);
    const mat = new THREE.MeshLambertMaterial({ map: this.tx.ground, vertexColors: true });
    this.terrainGroup = new THREE.Group();
    this.scene.add(this.terrainGroup);
    for (let tz = 0; tz < TILES; tz++) {
      for (let tx = 0; tx < TILES; tx++) {
        const i0 = tx * per, j0 = tz * per;
        const i1 = Math.min(N - 1, i0 + per), j1 = Math.min(N - 1, j0 + per);
        if (i1 <= i0 || j1 <= j0) continue;
        const w = i1 - i0 + 1, d = j1 - j0 + 1;
        const pos = new Float32Array(w * d * 3);
        const col = new Float32Array(w * d * 3);
        const uv = new Float32Array(w * d * 2);
        for (let j = 0; j < d; j++) {
          for (let i = 0; i < w; i++) {
            const gi = i0 + i, gj = j0 + j;
            const x = -H + gi * S, z = -H + gj * S;
            const y = hf[gj * N + gi];
            const k = (j * w + i) * 3;
            pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
            uv[(j * w + i) * 2] = x / 13;
            uv[(j * w + i) * 2 + 1] = z / 13;
            let c;
            const d = G.districtAt(x, z);
            if (y < 1.2) c = [1.0, 0.9, 0.66];
            else if (G.inPark(x, z)) c = [0.5, 0.78, 0.36];
            else if (d) c = d.style === 'house' ? [0.55, 0.68, 0.42] : [0.56, 0.56, 0.54];
            else c = [0.5, 0.72, 0.34];
            const n = hash2(gi, gj) * 0.12 + 0.94;
            col[k] = c[0] * n; col[k + 1] = c[1] * n; col[k + 2] = c[2] * n;
          }
        }
        const idx = [];
        for (let j = 0; j < d - 1; j++) {
          for (let i = 0; i < w - 1; i++) {
            const a = j * w + i, b = a + 1, c2 = a + w, e = c2 + 1;
            idx.push(a, c2, b, b, c2, e);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, mat);
        m.receiveShadow = this.shadows;
        this.terrainGroup.add(m);
      }
      yield (tz + 1) / TILES;
    }
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(G.MAP_HALF * 2.6, G.MAP_HALF * 2.6, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const t = this.tx.water;
    t.repeat.set(220, 220);
    const mat = new THREE.MeshPhongMaterial({
      map: t, color: 0x8fb6cc, specular: 0xcfe6f2, shininess: 90,
      transparent: true, opacity: 0.94,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0;
    m.renderOrder = -5;
    this.scene.add(m);
    this.water = m;
  }

  /** Every tall building in the city as one cheap silhouette mesh. */
  buildSkyline() {
    const b = new Builder(false);
    for (const bd of this.city.buildings) {
      if (bd.h < 30) continue;
      const v = 0.86 + hash2(bd.seed, 17) * 0.26;
      const col = bd.style === 'tower'
        ? [0.6 * v, 0.63 * v, 0.67 * v]
        : [0.66 * v, 0.62 * v, 0.55 * v];
      const s = 0.985;
      b.box(bd.x, bd.y - 2, bd.z, bd.w * s, bd.h + 2, bd.d * s, bd.rot, col, { top: true });
    }
    const m = new THREE.Mesh(b.build(), this.mats.far);
    m.frustumCulled = false;
    this.scene.add(m);
    this.skyline = m;
  }

  // --- chunk streaming ------------------------------------------------------

  update(px, pz, budget = 2) {
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    const want = new Set();
    for (let dz = -MID_R; dz <= MID_R; dz++) {
      for (let dx = -MID_R; dx <= MID_R; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        const r = Math.max(Math.abs(dx), Math.abs(dz));
        const key = this.city.chunkKey(cx, cz);
        want.add(key);
        const have = this.chunks.get(key);
        const lod = r <= NEAR_R ? 1 : 0;
        if (have && have.lod === lod) continue;
        if (!have) this.chunks.set(key, { key, cx, cz, lod: -1, group: null, dist: dx * dx + dz * dz });
        const c = this.chunks.get(key);
        c.dist = dx * dx + dz * dz;
        c.wantLod = lod;
      }
    }
    for (const [key, c] of this.chunks) {
      if (!want.has(key)) {
        if (c.group) this.disposeChunk(c);
        this.chunks.delete(key);
      }
    }
    // Build the nearest out-of-date chunks first.
    const todo = [];
    for (const c of this.chunks.values()) if (c.lod !== c.wantLod) todo.push(c);
    todo.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < Math.min(budget, todo.length); i++) {
      const c = todo[i];
      if (c.group) this.disposeChunk(c);
      c.group = this.buildChunk(c.cx, c.cz, c.wantLod);
      c.lod = c.wantLod;
      if (c.group) this.group.add(c.group);
    }
    return todo.length;
  }

  disposeChunk(c) {
    if (!c.group) return;
    c.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.group.remove(c.group);
    c.group = null;
    c.lod = -1;
  }

  buildChunk(cx, cz, lod) {
    const city = this.city;
    const ch = city.chunks.get(city.chunkKey(cx, cz));
    if (!ch) return null;
    const road = new Builder(true);
    const walk = new Builder(true);
    const flat = new Builder(false);
    const bl = {
      glass: new Builder(true), masonry: new Builder(true),
      industrial: new Builder(true), house: new Builder(true),
    };

    const own = (x, z) => Math.floor(x / CHUNK) === cx && Math.floor(z / CHUNK) === cz;
    const nodesDone = new Set();

    for (const ei of ch.edges) {
      const e = city.edges[ei];
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (!own(mx, mz)) continue;
      this.meshRoad(road, walk, flat, e, a, b, lod);
      for (const ni of [e.a, e.b]) {
        if (nodesDone.has(ni)) continue;
        const n = city.nodes[ni];
        if (!own(n.x, n.z)) continue;
        nodesDone.add(ni);
        this.meshNode(road, flat, ni, n, lod);
      }
    }

    if (lod === 1) {
      for (const bi of ch.buildings) this.meshBuilding(bl, flat, city.buildings[bi]);
      this.meshProps(flat, ch, cx, cz);
    }

    const grp = new THREE.Group();
    const add = (bld, mat, cast, recv) => {
      if (bld.empty) return;
      const m = new THREE.Mesh(bld.build(), mat);
      m.castShadow = cast && this.shadows;
      m.receiveShadow = recv && this.shadows;
      grp.add(m);
    };
    add(road, this.mats.road, false, true);
    add(walk, this.mats.walk, false, true);
    add(flat, this.mats.flat, true, true);
    add(bl.glass, this.mats.glass, true, true);
    add(bl.masonry, this.mats.masonry, true, true);
    add(bl.industrial, this.mats.industrial, true, true);
    add(bl.house, this.mats.house, true, true);
    return grp.children.length ? grp : null;
  }

  // --- road surfaces --------------------------------------------------------

  meshRoad(road, walk, flat, e, a, b, lod) {
    const hw = e.hw;
    const px = -e.dz, pz = e.dx;
    const steps = e.elev ? 1 : Math.max(1, Math.round(e.len / 16));
    const col = e.cls === 'hwy' ? [0.92, 0.92, 0.92] : [1, 1, 1];
    let v = 0;
    const yAt = (x, z, t) => (e.elev ? lerp(a.y, b.y, t) + 0.06 : G.terrainHeight(x, z) + ROAD_Y);
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const x0 = lerp(a.x, b.x, t0), z0 = lerp(a.z, b.z, t0);
      const x1 = lerp(a.x, b.x, t1), z1 = lerp(a.z, b.z, t1);
      const seg = e.len / steps;
      const v0 = v, v1 = v + seg / (hw * 2);
      v = v1;
      const l0x = x0 + px * hw, l0z = z0 + pz * hw;
      const r0x = x0 - px * hw, r0z = z0 - pz * hw;
      const l1x = x1 + px * hw, l1z = z1 + pz * hw;
      const r1x = x1 - px * hw, r1z = z1 - pz * hw;
      road.quad(
        [l0x, yAt(l0x, l0z, t0), l0z],
        [r0x, yAt(r0x, r0z, t0), r0z],
        [r1x, yAt(r1x, r1z, t1), r1z],
        [l1x, yAt(l1x, l1z, t1), l1z],
        [0, 1, 0], [0, v0, 1, v0, 1, v1, 0, v1], col
      );
    }
    if (e.elev) {
      // deck edge beams + pillars
      const bcol = [0.66, 0.66, 0.64];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t), y = lerp(a.y, b.y, t);
        for (const sg of [-1, 1]) {
          flat.box(x + px * hw * sg, y - 0.1, z + pz * hw * sg, 0.6, 1.0, e.len / steps + 0.5,
            Math.atan2(e.dx, e.dz), bcol);
        }
      }
      const gy = G.terrainHeight((a.x + b.x) / 2, (a.z + b.z) / 2);
      const my = (a.y + b.y) / 2;
      if (my - gy > 5) {
        flat.prism((a.x + b.x) / 2, gy - 1, (a.z + b.z) / 2, 1.6, my - gy - 0.6, 6, [0.6, 0.6, 0.58]);
      }
    } else if (lod === 1 && (e.cls === 'st' || e.cls === 'art' || e.cls === 'res')) {
      const sw = e.cls === 'art' ? 3.2 : 2.6;
      for (const sg of [-1, 1]) {
        const ox = px * sg, oz = pz * sg;
        const wsteps = Math.max(1, Math.round(e.len / 24));
        let vv = 0;
        for (let s = 0; s < wsteps; s++) {
          const t0 = s / wsteps, t1 = (s + 1) / wsteps;
          const x0 = lerp(a.x, b.x, t0), z0 = lerp(a.z, b.z, t0);
          const x1 = lerp(a.x, b.x, t1), z1 = lerp(a.z, b.z, t1);
          const i0x = x0 + ox * hw, i0z = z0 + oz * hw;
          const o0x = x0 + ox * (hw + sw), o0z = z0 + oz * (hw + sw);
          const i1x = x1 + ox * hw, i1z = z1 + oz * hw;
          const o1x = x1 + ox * (hw + sw), o1z = z1 + oz * (hw + sw);
          if (!G.isBuildable(o0x, o0z) && !G.isBuildable(o1x, o1z)) continue;
          const y = (x, z) => G.terrainHeight(x, z) + WALK_Y;
          const seg = e.len / wsteps;
          const v0 = vv, v1 = vv + seg / sw;
          vv = v1;
          const q = sg > 0
            ? [[i0x, y(i0x, i0z), i0z], [o0x, y(o0x, o0z), o0z], [o1x, y(o1x, o1z), o1z], [i1x, y(i1x, i1z), i1z]]
            : [[o0x, y(o0x, o0z), o0z], [i0x, y(i0x, i0z), i0z], [i1x, y(i1x, i1z), i1z], [o1x, y(o1x, o1z), o1z]];
          walk.quad(q[0], q[1], q[2], q[3], [0, 1, 0], [0, v0, 1, v0, 1, v1, 0, v1], [1, 1, 1]);
          // curb face
          const cy0 = G.terrainHeight(i0x, i0z), cy1 = G.terrainHeight(i1x, i1z);
          const cc = [0.78, 0.78, 0.76];
          if (sg > 0) {
            flat.quad([i0x, cy0 + ROAD_Y, i0z], [i1x, cy1 + ROAD_Y, i1z],
              [i1x, cy1 + WALK_Y, i1z], [i0x, cy0 + WALK_Y, i0z], [-ox, 0, -oz], [0, 0, 1, 0, 1, 1, 0, 1], cc);
          } else {
            flat.quad([i1x, cy1 + ROAD_Y, i1z], [i0x, cy0 + ROAD_Y, i0z],
              [i0x, cy0 + WALK_Y, i0z], [i1x, cy1 + WALK_Y, i1z], [-ox, 0, -oz], [0, 0, 1, 0, 1, 1, 0, 1], cc);
          }
        }
      }
    }
  }

  meshNode(road, flat, ni, n, lod) {
    const city = this.city;
    let hw = 0;
    let rot = 0;
    for (const ei of n.e) {
      const e = city.edges[ei];
      if (e.hw > hw) { hw = e.hw; rot = Math.atan2(e.dx, -e.dz); }
    }
    if (hw <= 0) return;
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [];
    const ys = [];
    const corners = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
    for (const [lx, lz] of corners) {
      const x = n.x + lx * c - lz * s;
      const z = n.z + lx * s + lz * c;
      pts.push(x, z);
      ys.push(n.elev ? n.y + 0.07 : G.terrainHeight(x, z) + NODE_Y);
    }
    road.flat(pts, ys, [1, 1, 1], [0.18, 0.62, 0.34, 0.62, 0.34, 0.76, 0.18, 0.76]);
  }

  // --- buildings ------------------------------------------------------------

  meshBuilding(bl, flat, bd) {
    const seed = bd.seed;
    let target, col, uS = 14, vS = 13.6;
    switch (bd.style) {
      case 'tower':
        if (hash2(seed, 11) > 0.55) { target = bl.glass; col = tint(seed, [0.92, 0.97, 1.0], 0.28); }
        else { target = bl.masonry; col = tint(seed, [0.9, 0.85, 0.78], 0.3); }
        break;
      case 'midrise':
        if (hash2(seed, 11) > 0.62) { target = bl.glass; col = tint(seed, [0.9, 0.95, 1.0], 0.3); }
        else { target = bl.masonry; col = tint(seed, [0.92, 0.84, 0.72], 0.34); }
        break;
      case 'brick':
        target = bl.masonry; col = tint(seed, [0.82, 0.55, 0.44], 0.34); uS = 12; vS = 12;
        break;
      case 'lowrise':
        if (hash2(seed, 11) > 0.62) { target = bl.glass; col = tint(seed, [0.84, 0.9, 0.94], 0.3); }
        else { target = bl.masonry; col = tint(seed, [0.9, 0.84, 0.74], 0.36); }
        break;
      case 'industrial':
        target = bl.industrial; col = tint(seed, [0.82, 0.84, 0.84], 0.3); uS = 16; vS = 16;
        break;
      default:
        target = bl.house; col = tint(seed, [0.92, 0.9, 0.86], 0.36); uS = 0; vS = 0;
    }

    if (bd.kind) return this.meshLandmarkTower(bl, flat, bd, col);

    const base = bd.y - 2;
    if (bd.style === 'house') {
      const wallH = bd.h * 0.72;
      target.box(bd.x, base, bd.z, bd.w, wallH + 2, bd.d, bd.rot, col, { top: false, uScale: 0, vScale: 0 });
      const rc = tint(seed, [0.42, 0.36, 0.34], 0.16);
      flat.cone(bd.x, base + wallH + 2, bd.z, Math.max(bd.w, bd.d) * 0.72, bd.h * 0.42, 4, rc);
      if (hash2(seed, 21) > 0.75) flat.box(bd.x + bd.w * 0.25, base + wallH + 2, bd.z, 1.1, bd.h * 0.5, 1.1, 0, rc);
      return;
    }

    // Stack up to three masses with setbacks so towers get a silhouette.
    let y = base;
    let remaining = bd.h + 2;
    let w = bd.w, d = bd.d;
    const tiers = bd.h > 100 ? 3 : bd.h > 55 ? 2 : 1;
    for (let t = 0; t < tiers; t++) {
      const frac = t === tiers - 1 ? 1 : t === 0 ? 0.62 : 0.6;
      const hh = remaining * frac;
      target.box(bd.x, y, bd.z, w, hh, d, bd.rot, col, { uScale: uS, vScale: vS, top: false, vOff: (y - base) / (vS || 1) });
      // roof slab
      flat.box(bd.x, y + hh, bd.z, w + 0.6, 0.7, d + 0.6, bd.rot, DARK);
      y += hh;
      remaining -= hh;
      w *= 0.78; d *= 0.78;
    }
    // rooftop clutter
    const rc = [0.45, 0.46, 0.47];
    const n = 1 + Math.floor(hash2(seed, 31) * 3);
    for (let i = 0; i < n; i++) {
      const ox = (hash2(seed, 40 + i) - 0.5) * w * 0.6;
      const oz = (hash2(seed, 50 + i) - 0.5) * d * 0.6;
      const c = Math.cos(bd.rot), s = Math.sin(bd.rot);
      flat.box(bd.x + ox * c - oz * s, y + 0.7, bd.z + ox * s + oz * c,
        1.6 + hash2(seed, 60 + i) * 3, 1.2 + hash2(seed, 70 + i) * 2.6, 1.6 + hash2(seed, 80 + i) * 3, bd.rot, rc);
    }
    if (bd.h > 70 && hash2(seed, 91) > 0.5) {
      flat.prism(bd.x, y + 0.7, bd.z, 0.35, 6 + hash2(seed, 92) * 14, 4, [0.35, 0.36, 0.38]);
    }
  }

  meshLandmarkTower(bl, flat, bd, col) {
    const base = bd.y - 2;
    if (bd.kind === 'columbia') {
      const dark = [0.26, 0.28, 0.32];
      const c = Math.cos(bd.rot), s = Math.sin(bd.rot);
      const lobes = [[0, 0, 1.0, 1.0], [-14, 10, 0.72, 0.86], [14, -10, 0.6, 0.7]];
      for (const [ox, oz, sc, hf] of lobes) {
        bl.glass.box(bd.x + ox * c - oz * s, base, bd.z + ox * s + oz * c,
          bd.w * sc, (bd.h + 2) * hf, bd.d * sc, bd.rot, dark, { uScale: 13, vScale: 13, top: false });
        flat.box(bd.x + ox * c - oz * s, base + (bd.h + 2) * hf, bd.z + ox * s + oz * c,
          bd.w * sc + 0.8, 1.2, bd.d * sc + 0.8, bd.rot, [0.2, 0.21, 0.24]);
      }
      flat.prism(bd.x, base + bd.h + 2, bd.z, 0.4, 22, 4, [0.3, 0.3, 0.32]);
      return;
    }
    if (bd.kind === 'smith') {
      const white = [1.05, 1.02, 0.96];
      bl.masonry.box(bd.x, base, bd.z, bd.w * 1.5, 22, bd.d * 1.5, bd.rot, white, { uScale: 12, vScale: 12, top: false });
      flat.box(bd.x, base + 22, bd.z, bd.w * 1.5 + 1, 1, bd.d * 1.5 + 1, bd.rot, [0.8, 0.79, 0.75]);
      bl.masonry.box(bd.x, base + 23, bd.z, bd.w, bd.h - 45, bd.d, bd.rot, white, { uScale: 11, vScale: 11, top: false });
      flat.box(bd.x, base + bd.h - 22, bd.z, bd.w + 1.4, 1.4, bd.d + 1.4, bd.rot, [0.8, 0.79, 0.75]);
      flat.cone(bd.x, base + bd.h - 21, bd.z, bd.w * 0.72, 20, 4, [0.55, 0.6, 0.58]);
      flat.prism(bd.x, base + bd.h - 2, bd.z, 0.3, 12, 4, [0.4, 0.42, 0.44]);
      return;
    }
    if (bd.kind === 'wamu') {
      const c2 = [0.72, 0.66, 0.58];
      let y = base, w = bd.w, d = bd.d, h = bd.h + 2;
      for (let t = 0; t < 4; t++) {
        const hh = h * (t === 3 ? 1 : 0.34);
        bl.masonry.box(bd.x, y, bd.z, w, hh, d, bd.rot, c2, { uScale: 12, vScale: 12, top: false });
        flat.box(bd.x, y + hh, bd.z, w + 0.5, 0.8, d + 0.5, bd.rot, DARK);
        y += hh; h -= hh; w *= 0.84; d *= 0.84;
        if (h < 6) break;
      }
      flat.prism(bd.x, y, bd.z, 0.35, 16, 4, [0.4, 0.4, 0.42]);
      return;
    }
    // generic hand-placed tower
    const target = bd.kind === 'stone' ? bl.masonry : bl.glass;
    let y = base, h = bd.h + 2, w = bd.w, d = bd.d;
    for (let t = 0; t < 3; t++) {
      const hh = t === 2 ? h : h * 0.5;
      target.box(bd.x, y, bd.z, w, hh, d, bd.rot, col, { uScale: 13, vScale: 13, top: false });
      flat.box(bd.x, y + hh, bd.z, w + 0.6, 0.9, d + 0.6, bd.rot, DARK);
      y += hh; h -= hh; w *= 0.86; d *= 0.86;
      if (h < 8) break;
    }
    flat.prism(bd.x, y, bd.z, 0.3, 10, 4, [0.4, 0.4, 0.42]);
  }

  // --- street furniture -----------------------------------------------------

  meshProps(flat, ch, cx, cz) {
    const city = this.city;
    const own = (x, z) => Math.floor(x / CHUNK) === cx && Math.floor(z / CHUNK) === cz;
    const poleCol = [0.36, 0.38, 0.4];
    const lampCol = [0.9, 0.88, 0.72];
    const trunk = [0.36, 0.28, 0.2];

    for (const ei of ch.edges) {
      const e = city.edges[ei];
      if (e.elev || e.cls === 'hwy') continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (!own(mx, mz)) continue;
      const px = -e.dz, pz = e.dx;
      const spacing = e.cls === 'res' ? 34 : 30;
      const count = Math.floor(e.len / spacing);
      for (let i = 1; i <= count; i++) {
        const t = i / (count + 1);
        const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
        const h = hash2(Math.round(x), Math.round(z));
        const sg = i % 2 === 0 ? 1 : -1;
        const ox = x + px * sg * (e.hw + 1.4);
        const oz = z + pz * sg * (e.hw + 1.4);
        if (!G.isBuildable(ox, oz)) continue;
        const gy = G.terrainHeight(ox, oz) + WALK_Y;
        if (h < 0.5) {
          // street light
          flat.prism(ox, gy, oz, 0.13, 7.4, 5, poleCol);
          const ax = -px * sg * 1.6, az = -pz * sg * 1.6;
          flat.box(ox + ax / 2, gy + 7.2, oz + az / 2, 1.9, 0.24, 0.24, Math.atan2(-px * sg, -pz * sg), poleCol);
          flat.box(ox + ax, gy + 6.95, oz + az, 0.8, 0.32, 0.5, Math.atan2(-px * sg, -pz * sg), lampCol);
        } else if (h < 0.86) {
          // street tree
          const th = 4 + h * 5;
          flat.prism(ox, gy, oz, 0.22 + h * 0.1, th * 0.55, 5, trunk);
          const g = [0.24 + h * 0.2, 0.44 + h * 0.22, 0.2 + h * 0.14];
          flat.cone(ox, gy + th * 0.45, oz, 1.5 + h * 1.4, th * 0.5, 6, g);
          flat.cone(ox, gy + th * 0.75, oz, 1.1 + h * 1.1, th * 0.45, 6, g);
        } else if (h < 0.9) {
          flat.prism(ox, gy, oz, 0.22, 0.85, 6, [0.8, 0.2, 0.16]); // hydrant
          flat.box(ox, gy + 0.85, oz, 0.5, 0.2, 0.5, 0, [0.8, 0.2, 0.16]);
        } else if (h < 0.94 && e.cls === 'art') {
          // bus shelter
          const rot = Math.atan2(e.dx, e.dz);
          flat.box(ox, gy, oz, 3.4, 0.12, 1.5, rot, [0.5, 0.52, 0.55]);
          flat.box(ox - px * sg * 0.6, gy, oz - pz * sg * 0.6, 3.4, 2.5, 0.12, rot, [0.72, 0.82, 0.88]);
          flat.box(ox, gy + 2.5, oz, 3.6, 0.14, 1.7, rot, [0.4, 0.42, 0.45]);
        }
      }
      // traffic signals at busy corners
      if (e.cls === 'art' && e.len > 40) {
        for (const nid of [e.a, e.b]) {
          const n = city.nodes[nid];
          if (!own(n.x, n.z) || n.e.length < 3) continue;
          const ox = n.x + px * (e.hw + 1.6) - e.dx * (e.hw + 1.4);
          const oz = n.z + pz * (e.hw + 1.6) - e.dz * (e.hw + 1.4);
          if (!G.isBuildable(ox, oz)) continue;
          const gy = G.terrainHeight(ox, oz) + WALK_Y;
          flat.prism(ox, gy, oz, 0.14, 6, 5, poleCol);
          const rot = Math.atan2(e.dx, e.dz);
          flat.box(ox + e.dx * 2.2, gy + 5.7, oz + e.dz * 2.2, 0.35, 0.35, 4.6, rot, poleCol);
          const hx = ox + e.dx * 4.2, hz = oz + e.dz * 4.2;
          flat.box(hx, gy + 4.4, hz, 0.5, 1.35, 0.4, rot, [0.2, 0.22, 0.24]);
          flat.box(hx, gy + 5.35, hz, 0.56, 0.3, 0.44, rot, [0.9, 0.16, 0.12]);
          flat.box(hx, gy + 4.95, hz, 0.56, 0.3, 0.44, rot, [0.85, 0.7, 0.14]);
          flat.box(hx, gy + 4.55, hz, 0.56, 0.3, 0.44, rot, [0.16, 0.8, 0.3]);
        }
      }
    }

    // park trees
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (let i = 0; i < 46; i++) {
      const hx = hash2(cx * 71 + i, cz * 131 + 7);
      const hz = hash2(cx * 37 + i, cz * 53 + 13);
      const x = x0 + hx * CHUNK, z = z0 + hz * CHUNK;
      const p = G.inPark(x, z);
      if (!p) continue;
      const h = hash2(Math.round(x), Math.round(z));
      const gy = G.terrainHeight(x, z);
      const th = 6 + h * 7;
      flat.prism(x, gy, z, 0.3 + h * 0.2, th * 0.5, 5, trunk);
      const g = [0.2 + h * 0.18, 0.42 + h * 0.24, 0.18 + h * 0.14];
      flat.cone(x, gy + th * 0.4, z, 2.2 + h * 2, th * 0.55, 7, g);
      flat.cone(x, gy + th * 0.75, z, 1.7 + h * 1.6, th * 0.5, 7, g);
    }
  }
}
