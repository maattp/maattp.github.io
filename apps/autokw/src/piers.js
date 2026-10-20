// PIERS: every pier OpenStreetMap maps in the box (data/piers.json,
// tools/build_piers.py) that nothing else here already builds, as a deck on
// piles you can walk on.
//
// Smith Cove's Piers 90 and 91 were bare sheds standing in Elliott Bay, and
// most of the waterfront's and the lakes' piers were not there at all. A
// closed way is a deck's outline, triangulated; an open way a walkway of its
// `width`. A deck's top is level with the shore it leaves (the ground at its
// landward end), kept between 0.5 and 4 m over the water; its edge has a
// fascia, piles every ~6 m along it and a timber rail on the long piers.
// Walkable: a closed deck is covered in 6 m platform squares, a walkway's
// segments are each a platform (citygen setPlatforms, as the docks' are).
//
// Left out: piers under 150 m2 (or 25 m of walkway) -- hundreds of private
// lake docks, at a draw's worth each for nothing you'd notice -- anything
// mostly on land, anything already built (Pier 66, the Wheel's, the
// Aquarium's, the marinas' floats: a platform there already), and anything a
// road runs onto (Colman Dock's vehicle lanes are roads with their own deck).

import * as THREE from './three.js';
import * as G from './geo.js';
import { ChunkBuilder, dropAfterUpload } from './build.js';
import { memo, memoPeek, memoPut } from './bootcache.js';

const CHUNK = 1000;
// a walkway piece overlaps the next: no gap to fall through at a bend
const OVERLAP = 0.05;
const DECK = [0.42, 0.37, 0.31], DECK_CON = [0.56, 0.55, 0.52], FASCIA = [0.3, 0.26, 0.21], PILE = [0.22, 0.19, 0.16], RAIL = [0.36, 0.3, 0.24];

// a pier's verdict (Piers' `judge`), as kept in the boot cache
const JUDGE = { small: 0, land: 1, dup: 2, road: 3, built: 4 };
const JUDGE_NAME = ['small', 'land', 'dup', 'road'];
const area = (p) => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
function inPoly(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export class Piers {
  /** waterAt(x, z): the drawn water surface or null. Call after the landmarks
   *  (their decks are platforms by then). */
  constructor(data, { scene, city, waterAt, dropArrays = false }) {
    this.city = city;
    // on a phone, mesh arrays go once they are on the GPU (see _build)
    this.dropArrays = dropArrays;
    this.built = [];
    const skipped = { small: 0, land: 0, dup: 0, road: 0 };
    const chunks = new Map();
    const chunk = (x, z) => {
      const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let c = chunks.get(k);
      if (!c) chunks.set(k, (c = { ops: [], x: (Math.floor(x / CHUNK) + 0.5) * CHUNK, z: (Math.floor(z / CHUNK) + 0.5) * CHUNK }));
      return c;
    };
    const plats = [];
    // Which piers are built, and at what height: [verdict, top, wl, cx, cz]
    // per pier (JUDGE), from samples over each through the water, the roads
    // and the platforms already standing. Kept by the boot cache (bootcache.js
    // memo): it was ~0.4 s of a phone's boot.
    const judge = (q) => {
      let p = q.p.slice();
      if (q.closed) p = p.slice(0, -1);
      const len = q.closed ? 0 : p.reduce((a, r, i) => (i ? a + Math.hypot(r[0] - p[i - 1][0], r[1] - p[i - 1][1]) : 0), 0);
      if (q.closed ? area(p) < 150 : len < 25) return [JUDGE.small];
      // sample the pier: points along it (open) or inside it (closed)
      const samples = [];
      if (q.closed) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        const st = Math.max(4, Math.sqrt(area(p) / 60));
        for (let x = x0 + st / 2; x < x1; x += st) for (let z = z0 + st / 2; z < z1; z += st) if (inPoly(x, z, p)) samples.push([x, z]);
        if (!samples.length) samples.push(p[0]);
      } else {
        for (let i = 0; i < p.length - 1; i++) for (let t = 0; t < 1; t += 0.25) samples.push([p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t]);
      }
      let wet = 0, wl = null, road = 0, dup = 0;
      for (const [x, z] of samples) {
        const w = waterAt(x, z);
        if (w !== null && w > G.terrainHeight(x, z)) { wet++; wl = wl === null ? w : Math.max(wl, w); }
        if (city.onRoad(x, z, 0, true, false)) road++;
        if (city.platformAt && city.platformAt(x, z) !== null) dup++;
      }
      if (wet < samples.length * 0.3 || wl === null) return [JUDGE.land];
      if (dup > samples.length * 0.15) return [JUDGE.dup];
      if (road > samples.length * 0.15) return [JUDGE.road];
      // the deck: level with the shore it leaves
      let shore = -Infinity;
      for (const [x, z] of p) { const w = waterAt(x, z); if (w === null || w <= G.terrainHeight(x, z)) shore = Math.max(shore, G.terrainHeight(x, z)); }
      const big = q.closed && area(p) > 2000;
      const top = Math.min(wl + 4, Math.max(wl + (big ? 2.4 : 0.5), shore === -Infinity ? wl + (big ? 2.4 : 0.6) : shore + 0.15));
      const cx = samples.reduce((a, s) => a + s[0], 0) / samples.length, cz = samples.reduce((a, s) => a + s[1], 0) / samples.length;
      return [JUDGE.built, top, wl, cx, cz];
    };
    const NP = data.piers.length;
    // The platforms -- 6 m squares over each deck, tested against its outline,
    // and the sheds' decks -- as [x, z, hw, hd, rot, y] rows, kept likewise.
    const platsKept = memoPeek('piers:plats', (v) => v instanceof Float64Array && v.length % 6 === 0);
    const platRows = [];
    const plat = (x, z, hw, hd, rot, y) => { if (!platsKept) platRows.push(x, z, hw, hd, rot, y); };
    const verdicts = memo('piers', () => {
      const v = new Float64Array(NP * 5);
      data.piers.forEach((q, qi) => v.set(judge(q), qi * 5));
      return v;
    }, (v) => v instanceof Float64Array && v.length === NP * 5);
    for (let qi = 0; qi < NP; qi++) {
      const q = data.piers[qi];
      let p = q.p.slice();
      if (q.closed) p = p.slice(0, -1);
      const verdict = verdicts[qi * 5];
      if (verdict !== JUDGE.built) { skipped[JUDGE_NAME[verdict]]++; continue; }
      const top = verdicts[qi * 5 + 1], wl = verdicts[qi * 5 + 2], cx = verdicts[qi * 5 + 3], cz = verdicts[qi * 5 + 4];
      const big = q.closed && area(p) > 2000;
      const c = chunk(cx, cz);
      const col = big ? DECK_CON : DECK;
      const bottom = wl - 0.3;
      // walkable, now: 6 m squares over a deck, a platform per walkway piece
      if (platsKept) {
        // (kept: see platsKept)
      } else if (q.closed) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        for (let x = x0 + 3; x < x1; x += 6) for (let z = z0 + 3; z < z1; z += 6) if (inPoly(x, z, p)) plat(x, z, 3.05, 3.05, 0, top);
      } else {
        const hw = Math.max(1, Math.min(8, q.w / 2));
        for (let i = 0; i < p.length - 1; i++) {
          const [ax, az] = p[i], [bx, bz] = p[i + 1];
          const L = Math.hypot(bx - ax, bz - az);
          if (L < 0.1) continue;
          const ux = (bx - ax) / L, uz = (bz - az) / L;
          plat(ax + ux * L / 2, az + uz * L / 2, hw, L / 2 + OVERLAP, Math.atan2(ux, -uz), top);   // local x across the walkway
        }
      }
      // the geometry, when its chunk first comes into range (update)
      c.ops.push((b) => {
        if (q.closed) {
          // the top, triangulated
          const V = p.map(([x, z]) => new THREE.Vector2(x, z));
          let tris;
          try { tris = THREE.ShapeUtils.triangulateShape(V, []); } catch (e) { tris = []; }
          for (const [i0, i1, i2] of tris) b.tri([p[i0][0], top, p[i0][1]], [p[i1][0], top, p[i1][1]], [p[i2][0], top, p[i2][1]], [0, 1, 0], col);
          // fascia round the edge, piles along it
          const cw = area(p) > 0 && p.reduce((a, q2, i) => { const r = p[(i + 1) % p.length]; return a + q2[0] * r[1] - r[0] * q2[1]; }, 0) > 0 ? 1 : -1;
          for (let i = 0; i < p.length; i++) {
            const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length];
            const L = Math.hypot(bx - ax, bz - az);
            if (L < 0.1) continue;
            const nx = (bz - az) / L * cw, nz = -(bx - ax) / L * cw;
            b.quad([ax, top, az], [bx, top, bz], [bx, top - 0.6, bz], [ax, top - 0.6, az], [nx, 0, nz], [0, 0, 1, 0, 1, 1, 0, 1], FASCIA);
            for (let t = 0; t < L; t += 6) {
              const px = ax + (bx - ax) * t / L - nx * 0.3, pz = az + (bz - az) * t / L - nz * 0.3;
              if (waterAt(px, pz) === null) continue;
              b.box(px, bottom - 1, pz, 0.36, top - 0.6 - (bottom - 1), 0.36, 0, PILE);
            }
          }
        } else {
          const hw = Math.max(1, Math.min(8, q.w / 2));
          for (let i = 0; i < p.length - 1; i++) {
            const [ax, az] = p[i], [bx, bz] = p[i + 1];
            const L = Math.hypot(bx - ax, bz - az);
            if (L < 0.1) continue;
            const ux = (bx - ax) / L, uz = (bz - az) / L, lx = -uz, lz = ux;
            const e = OVERLAP;
            const P = (t, o, y) => [ax + ux * t + lx * o, y, az + uz * t + lz * o];
            b.quad(P(-e, -hw, top), P(-e, hw, top), P(L + e, hw, top), P(L + e, -hw, top), [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col);
            for (const s of [-1, 1]) {
              b.quad(P(0, s * hw, top), P(L, s * hw, top), P(L, s * hw, top - 0.4), P(0, s * hw, top - 0.4), [lx * s, 0, lz * s], [0, 0, 1, 0, 1, 1, 0, 1], FASCIA);
              for (let t = 0; t <= L; t += 4) {
                const px = ax + ux * t + lx * s * (hw - 0.2), pz = az + uz * t + lz * s * (hw - 0.2);
                if (waterAt(px, pz) === null) continue;
                b.box(px, bottom - 1, pz, 0.26, top - 0.4 - (bottom - 1), 0.26, 0, PILE);
              }
              // a low timber rail on the walkways that stand high over the water
              if (top - wl > 1.5) {
                b.quad(P(0, s * hw, top + 1.0), P(L, s * hw, top + 1.0), P(L, s * hw, top + 0.9), P(0, s * hw, top + 0.9), [lx * s, 0, lz * s], [0, 0, 1, 0, 1, 1, 0, 1], RAIL);
                for (let t = 0; t <= L; t += 2.5) b.box(ax + ux * t + lx * s * (hw - 0.05), top, az + uz * t + lz * s * (hw - 0.05), 0.08, 1.0, 0.08, 0, RAIL);
              }
            }
          }
        }
      });
      this.built.push({ name: q.name, x: cx, z: cz, top, wl, closed: q.closed });
    }
    // SHEDS STANDING IN THE SEA. Some piers are not mapped as piers at all
    // -- Smith Cove's Pier 90 is only its sheds, over open water in both the
    // mask and the terrain -- so a building over salt water (not a lake: a
    // houseboat floats) gets a deck under it, 4 m wider all round, on piles.
    // (which buildings those are is kept with the piers: one water query per
    // big building in the city was most of the rest of this constructor)
    let sheds = 0;
    const bds = city.buildings || [];
    const shedList = memo('piers:sheds', () => {
      const out = [];
      for (let bi = 0; bi < bds.length; bi++) {
        const bd = bds[bi];
        if (bd.w * bd.d < 150) continue;
        const wl = waterAt(bd.x, bd.z);
        if (wl !== 0 || G.terrainHeight(bd.x, bd.z) > -0.3) continue;
        if (city.platformAt && city.platformAt(bd.x, bd.z) !== null) continue;
        out.push(bi);
      }
      return Int32Array.from(out);
    }, (v) => v instanceof Int32Array && v.every((bi) => bi < bds.length));
    for (const bi of shedList) {
      const bd = bds[bi];
      const wl = 0;   // salt water: the test above
      const top = wl + 2.4, hw = bd.w / 2 + 4, hd = bd.d / 2 + 4;
      chunk(bd.x, bd.z).ops.push((b2) => {
        // Builder.box turns the other way from the building's rot (build.js)
        b2.box(bd.x, top - 0.6, bd.z, hw * 2, 0.6, hd * 2, bd.rot, DECK_CON);
        const cr = Math.cos(bd.rot), sr = Math.sin(bd.rot);
        for (let u = -hw + 1; u <= hw - 1; u += 6) for (const v of [-hd + 1, hd - 1]) {
          const px = bd.x + u * cr - v * sr, pz = bd.z + u * sr + v * cr;
          b2.box(px, wl - 1.3, pz, 0.4, top - 0.6 - (wl - 1.3), 0.4, 0, PILE);
        }
      });
      plat(bd.x, bd.z, hw, hd, bd.rot, top);
      sheds++;
    }
    {
      const P = platsKept || memoPut('piers:plats', Float64Array.from(platRows));
      for (let i = 0; i < P.length; i += 6) plats.push({ x: P[i], z: P[i + 1], hw: P[i + 2], hd: P[i + 3], rot: P[i + 4], y0: P[i + 5], y1: P[i + 5] });
    }
    this.sheds = sheds;
    this.skipped = skipped;
    this.group = new THREE.Group();
    this.group.name = 'piers';
    // BUILT WHEN FIRST IN RANGE (update), not at boot: 1288 piers across the
    // map were ~1 s of every phone launch and 43 MB of arrays, nearly all of
    // it kilometres away and never drawn.
    this.chunks = [];
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.5 });
    for (const [key, c] of chunks) if (c.ops.length) this.chunks.push({ key, ops: c.ops, m: null, x: c.x, z: c.z });
    scene.add(this.group);

    // walkable (a platform's local x, its hw, runs along (cos rot, sin rot))
    if (city.setPlatforms && plats.length) city.setPlatforms([...(city.platforms || []), ...plats]);
    this.platformCount = plats.length;
    this.plats = plats;
  }

  /** A chunk's mesh, built from its ops (1 km of piers: a few ms). */
  _build(c) {
    const b = new ChunkBuilder(false, 256);
    for (const op of c.ops) op(b);
    if (b.empty) { c.ops = []; return; }
    const m = new THREE.Mesh(b.build(this.dropArrays), this.mat);
    m.name = `piers:${c.key}`; m.castShadow = true; m.receiveShadow = true;
    if (this.dropArrays) dropAfterUpload(m);
    this.group.add(m);
    c.m = m;
  }

  /** A lost WebGL context: meshes whose arrays were dropped cannot be
   *  re-uploaded, so they go, and are built again when next in range. */
  contextLost() {
    for (const c of this.chunks) if (c.m) { this.group.remove(c.m); c.m.geometry.dispose(); c.m = null; }
  }

  update(camera) {
    const x = camera.position.x, z = camera.position.z, R = 800 + CHUNK * 0.71;
    // first call builds everything in range; after that one chunk a call,
    // every 8th frame
    const first = !this._t;
    if ((this._t = (this._t || 0) + 1) & 7 && !first) return;
    let budget = first ? Infinity : 1;
    for (const c of this.chunks) {
      const near = Math.hypot(c.x - x, c.z - z) < R;
      if (near && !c.m && c.ops.length && budget > 0) { this._build(c); budget--; }
      if (c.m) c.m.visible = near;
    }
  }
}
