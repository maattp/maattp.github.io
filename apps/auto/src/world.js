// Scene construction: sky + image-based lighting, terrain, water, streamed city
// chunks, distant skyline and the hand-built landmarks.

import * as THREE from './three.js';
import * as G from './geo.js';
import { CHUNK, ROAD_LIFT, NODE_LIFT, WALK_LIFT } from './citygen.js';
import { Builder } from './build.js';
import { hash2, clamp, lerp, distToSeg } from './util.js';

const ROAD_Y = ROAD_LIFT;
const NODE_Y = NODE_LIFT;
const WALK_Y = WALK_LIFT;

const NEAR_R = 2; // chunks of full detail around the player
const MID_R = 4; // chunks that keep roads only

// Ground tints, and the taps used to soften a district's edge into them.
const GRASS = [0.42, 0.62, 0.28];
const SUBURB = [0.48, 0.6, 0.37];
const URBAN = [0.56, 0.56, 0.55];
const BLEND_TAPS = [[0, 0], [-85, 55], [70, -75]];

/**
 * Smooth value noise on a 210 m lattice, in [0,1].
 *
 * Only used to push the district lookup off its own straight edges, so it wants
 * to be continuous and cheap rather than good: `hash2` alone is per-cell random
 * and turns a boundary into static instead of a curve.
 */
function vnoise(x, z) {
  const S = 210;
  const fx = x / S, fz = z / S;
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const tx = fx - i0, tz = fz - j0;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash2(i0, j0), b = hash2(i0 + 1, j0);
  const c = hash2(i0, j0 + 1), d = hash2(i0 + 1, j0 + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

/**
 * Does this GPU actually put colour into a half-float target?
 *
 * The failure we're guarding is silent: iOS reports the extension, allocates
 * the target, renders, and hands back black. So don't feature-detect -- draw a
 * known white pixel and read it back.
 *
 * Anything that stops us reading the result is treated as a pass, so the only
 * thing that trips the fallback is a definite black. That keeps hardware which
 * simply can't be probed on the path it already renders correctly today. The
 * readback is gated on the same extensions WebGLRenderer checks before its own
 * readPixels, so an unsupported device skips it instead of logging an error.
 */
function halfFloatRenders(renderer) {
  if (!renderer) return true;
  const SENTINEL = 0xffff; // NaN as a half -- never a real render result
  let rt = null, quad = null;
  try {
    const ext = renderer.extensions, caps = renderer.capabilities;
    const readable = ext.has('EXT_color_buffer_half_float')
      || (caps.isWebGL2 && ext.has('EXT_color_buffer_float'));
    if (!readable) return true;

    rt = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
    );
    const probe = new THREE.Scene();
    probe.add(quad);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cam.position.z = 1;

    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(probe, cam);
    renderer.setRenderTarget(prev);

    const buf = new Uint16Array(4).fill(SENTINEL);
    renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, buf);
    // untouched buffer means the read never ran -- inconclusive, so pass
    if (buf[0] === SENTINEL && buf[1] === SENTINEL && buf[2] === SENTINEL) return true;
    return buf[0] !== 0 || buf[1] !== 0 || buf[2] !== 0;
  } catch (e) {
    return true;
  } finally {
    if (quad) { quad.geometry.dispose(); quad.material.dispose(); }
    if (rt) rt.dispose();
  }
}

function tint(seed, base, spread) {
  const r = hash2(seed, 1), g = hash2(seed, 2), b = hash2(seed, 3);
  return [
    clamp(base[0] + (r - 0.5) * spread, 0.15, 1.4),
    clamp(base[1] + (g - 0.5) * spread, 0.15, 1.4),
    clamp(base[2] + (b - 0.5) * spread, 0.15, 1.4),
  ];
}

const DARK = [0.26, 0.27, 0.29];
const TRIM = [0.55, 0.55, 0.56];
const AWNING = [
  [0.55, 0.12, 0.12], [0.12, 0.28, 0.5], [0.14, 0.34, 0.22],
  [0.42, 0.34, 0.16], [0.2, 0.2, 0.24], [0.5, 0.42, 0.3],
];

// ---------------------------------------------------------------------------

export class World {
  constructor(scene, city, tx, opts = {}) {
    this.scene = scene;
    this.city = city;
    this.tx = tx;
    this.renderer = opts.renderer;
    this.shadows = opts.shadows !== false;
    this.chunks = new Map();

    const surf = (s, o = {}) => {
      const m = new THREE.MeshStandardMaterial({
        map: s.map,
        normalMap: s.normalMap || null,
        roughnessMap: s.roughnessMap || null,
        vertexColors: true,
        roughness: o.roughness != null ? o.roughness : 1,
        metalness: o.metalness != null ? o.metalness : 0,
        envMapIntensity: o.env != null ? o.env : 1,
      });
      if (s.emissiveMap) {
        m.emissiveMap = s.emissiveMap;
        m.emissive = new THREE.Color(0xffffff);
        m.emissiveIntensity = o.emissive != null ? o.emissive : 0.45;
      }
      if (m.normalMap) m.normalScale = new THREE.Vector2(o.ns || 1, o.ns || 1);
      return m;
    };

    this.mats = {
      road: surf(tx.road, { env: 0.9, ns: 0.7 }),
      walk: surf(tx.sidewalk, { env: 0.85, ns: 0.8 }),
      glass: surf(tx.glass, { env: 1.5, metalness: 0.18, ns: 1.1, emissive: 0.12 }),
      masonry: surf(tx.masonry, { env: 1.05, ns: 1.0, emissive: 0.1 }),
      industrial: surf(tx.industrial, { env: 1.0, metalness: 0.25, ns: 1.0 }),
      house: surf(tx.house, { env: 0.95, ns: 1.0, emissive: 0.1 }),
      flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04, envMapIntensity: 1.0 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      far: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, envMapIntensity: 0.95 }),
    };
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  // --- static scenery -------------------------------------------------------

  /** Sky doubles as the background and as the diffuse+specular IBL source. */
  buildSky() {
    this.scene.background = this.tx.sky;
    // PMREMGenerator allocates HalfFloatType targets internally, hard-coded,
    // with no capability check -- and half-float is the one thing this renderer
    // can't take on trust (silent black on iOS, which is why postfx.js is 8-bit
    // throughout). Since the analytic lights are only a key and a fill, a dead
    // environment map means a dead scene, so probe before relying on it.
    if (halfFloatRenders(this.renderer)) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      this.envRT = pmrem.fromEquirectangular(this.tx.sky);
      this.scene.environment = this.envRT.texture;
      this.envPrefiltered = true;
      pmrem.dispose();
    } else {
      // Raw equirect as the env map: no prefiltered roughness mips, so rough
      // surfaces reflect too sharply, but the city stays lit.
      this.scene.environment = this.tx.sky;
      this.envPrefiltered = false;
    }
  }

  *buildTerrain() {
    const hf = G.heightfield();
    const N = G.HF_N, S = G.HF_STEP, H = G.MAP_HALF;
    const TILES = 8;
    const per = Math.ceil((N - 1) / TILES);
    const mat = new THREE.MeshStandardMaterial({
      map: this.tx.ground.map, normalMap: this.tx.ground.normalMap,
      vertexColors: true, roughness: 0.94, metalness: 0, envMapIntensity: 1.0,
      normalScale: new THREE.Vector2(0.3, 0.3),
    });
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
            // District polygons are literally rect() calls, so colouring the
            // ground by a straight districtAt() test drew the city from the air
            // as grey rectangles on grass -- hard axis-aligned edges with a
            // 40 m staircase on them, because that is the heightfield spacing.
            // The query point is pushed around by smooth noise so the boundary
            // wanders, and three offset samples give a coverage fraction to
            // blend across rather than a switch to flip.
            let c;
            if (y < 1.2) c = [0.94, 0.86, 0.66];
            else if (G.inPark(x, z)) c = [0.42, 0.66, 0.3];
            else {
              const jx = (vnoise(x, z) - 0.5) * 190;
              const jz = (vnoise(x + 3137, z - 2711) - 0.5) * 190;
              let urban = 0, house = 0;
              for (const [ox, oz] of BLEND_TAPS) {
                const d2 = G.districtAt(x + jx + ox, z + jz + oz);
                if (!d2) continue;
                if (d2.style === 'house') house++; else urban++;
              }
              const cover = (urban + house) / BLEND_TAPS.length;
              const built = cover > 0 ? (urban >= house ? URBAN : SUBURB) : URBAN;
              const t = cover * cover * (3 - 2 * cover);
              c = [
                GRASS[0] + (built[0] - GRASS[0]) * t,
                GRASS[1] + (built[1] - GRASS[1]) * t,
                GRASS[2] + (built[2] - GRASS[2]) * t,
              ];
            }
            const n = hash2(gi, gj) * 0.14 + 0.93;
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
    const n = this.tx.water.normalMap;
    n.repeat.set(520, 520);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2c4d63, normalMap: n, roughness: 0.09, metalness: 0.25,
      envMapIntensity: 1.6, normalScale: new THREE.Vector2(0.55, 0.55),
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0;
    m.renderOrder = -5;
    this.scene.add(m);
    this.water = m;
    this.waterNormal = n;
  }

  /** Every tall building in the city as one cheap silhouette mesh. */
  buildSkyline() {
    const b = new Builder(false);
    for (const bd of this.city.buildings) {
      if (bd.h < 30) continue;
      const v = 0.86 + hash2(bd.seed, 17) * 0.26;
      const col = bd.style === 'tower'
        ? [0.5 * v, 0.54 * v, 0.58 * v]
        : [0.56 * v, 0.52 * v, 0.46 * v];
      const s = 0.985;
      b.box(bd.x, bd.y - 2, bd.z, bd.w * s, bd.h + 2, bd.d * s, bd.rot, col, { top: true, ao: 0.3 });
    }
    const m = new THREE.Mesh(b.build(), this.mats.far);
    m.frustumCulled = false;
    this.scene.add(m);
    this.skyline = m;
  }

  animate(dt, t) {
    if (this.waterNormal) {
      this.waterNormal.offset.x = (t * 0.004) % 1;
      this.waterNormal.offset.y = (t * 0.0026) % 1;
    }
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
    const glow = new Builder(false);
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
      this.meshRoad(road, walk, flat, e, a, b, lod, ei);
      for (const ni of [e.a, e.b]) {
        if (nodesDone.has(ni)) continue;
        const n = city.nodes[ni];
        if (!own(n.x, n.z)) continue;
        nodesDone.add(ni);
        this.meshNode(road, flat, ni, n, lod, walk);
      }
    }

    if (lod === 1) {
      for (const bi of ch.buildings) this.meshBuilding(bl, flat, glow, city.buildings[bi]);
      this.meshProps(flat, glow, ch, cx, cz);
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
    add(glow, this.mats.glow, false, false);
    add(bl.glass, this.mats.glass, true, true);
    add(bl.masonry, this.mats.masonry, true, true);
    add(bl.industrial, this.mats.industrial, true, true);
    add(bl.house, this.mats.house, true, true);
    return grp.children.length ? grp : null;
  }

  // --- road surfaces --------------------------------------------------------

  /**
   * Where a deck edge passes at a node, mitred into the next span.
   *
   * Offsetting each span by its own perpendicular leaves two spans meeting a
   * bend at different points and different angles, so their guardrails end up
   * splayed and never touch. Mitreing runs both spans' edges through one shared
   * point, which is what makes the rail continuous around a curve.
   */
  deckEdgePoint(ni, e, sg, w) {
    const city = this.city;
    const n = city.nodes[ni];
    let ox = -e.dz * sg, oz = e.dx * sg;
    let dist = w;
    let other = null, count = 0;
    for (const oi of n.e) {
      const o = city.edges[oi];
      if (!o.elev || o === e) continue;
      other = o; count++;
    }
    // Only a simple two-span joint can be mitred; a ramp merge has no single
    // continuation to aim at, so it keeps the square end.
    if (count === 1 && Math.abs(other.hw - e.hw) < 0.01) {
      let qx = -other.dz * sg, qz = other.dx * sg;
      if (qx * ox + qz * oz < 0) { qx = -qx; qz = -qz; }
      let mx = ox + qx, mz = oz + qz;
      const ml = Math.hypot(mx, mz);
      if (ml > 1e-3) {
        mx /= ml; mz /= ml;
        const cos = mx * ox + mz * oz;
        // A hairpin would send the mitre off to infinity; keep the square end.
        if (cos > 0.5) { ox = mx; oz = mz; dist = w / cos; }
      }
    }
    return [n.x + ox * dist, n.z + oz * dist];
  }

  /**
   * An elevated span: deck, edge beam, parapets and piers.
   *
   * Everything is built off the same two mitred edge lines, so the deck, its
   * beam and the rail on top of it stay registered with each other and with the
   * neighbouring span. Barriers used to be independent boxes centred on segment
   * midpoints, which is why they didn't line up end to end.
   */
  meshViaduct(road, flat, e, a, b) {
    const GIRDER = 1.35;  // structural depth below the running surface
    const PARAPET = 0.55; // parapet wall thickness, inboard of the deck edge
    const RAIL = 0.95;    // parapet height above the running surface
    const conc = [0.68, 0.68, 0.66], concLo = [0.5, 0.5, 0.49];
    const soffit = [0.42, 0.42, 0.41];
    const ay = a.y + 0.06, by = b.y + 0.06;
    const hw = e.hw;
    const along = Math.atan2(e.dx, e.dz);

    // Two mitred offset lines per side: the running-surface edge, where the
    // parapet stands, and the deck edge outboard of it. Keeping the carriageway
    // at the full `hw` means a viaduct is as wide to drive as the street it
    // continues, instead of losing a metre to its own walls.
    const run = {}, deck = {};
    for (const sg of [-1, 1]) {
      const [rsx, rsz] = this.deckEdgePoint(e.a, e, sg, hw);
      const [rex, rez] = this.deckEdgePoint(e.b, e, sg, hw);
      run[sg] = { sx: rsx, sz: rsz, ex: rex, ez: rez };
      const [dsx, dsz] = this.deckEdgePoint(e.a, e, sg, hw + PARAPET);
      const [dex, dez] = this.deckEdgePoint(e.b, e, sg, hw + PARAPET);
      deck[sg] = { sx: dsx, sz: dsz, ex: dex, ez: dez };
    }

    // Running surface, corner to corner off the mitred edges. One quad for the
    // whole span: it is planar, so it can't stair-step the way the old
    // per-segment boxes did.
    const L = run[1], R = run[-1];
    const vLen = e.len / (hw * 2);
    road.quad(
      [L.sx, ay, L.sz], [R.sx, ay, R.sz], [R.ex, by, R.ez], [L.ex, by, L.ez],
      [0, 1, 0], [0, 0, 1, 0, 1, vLen, 0, vLen],
      e.cls === 'hwy' ? [0.92, 0.92, 0.92] : [1, 1, 1]);

    // Soffit, so the deck reads as a box girder rather than a sheet of paper.
    const DL = deck[1], DR = deck[-1];
    flat.quad(
      [DR.sx, ay - GIRDER, DR.sz], [DL.sx, ay - GIRDER, DL.sz],
      [DL.ex, by - GIRDER, DL.ez], [DR.ex, by - GIRDER, DR.ez],
      [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], soffit);

    for (const sg of [-1, 1]) {
      const r = run[sg], d = deck[sg];
      const ox = -e.dz * sg, oz = e.dx * sg;       // outward across the deck
      // Fascia: girder and parapet in one plane, running the full length of the
      // span between the mitred corners. Because both ends are the mitre point
      // its neighbour also uses, consecutive spans meet edge to edge instead of
      // each being splayed off its own perpendicular.
      flat.quad(
        [d.sx, ay - GIRDER, d.sz], [d.ex, by - GIRDER, d.ez],
        [d.ex, by + RAIL, d.ez], [d.sx, ay + RAIL, d.sz],
        [ox, 0, oz], [0, 0, 1, 0, 1, 1, 0, 1], [concLo, concLo, conc, conc]);
      // Capping over the wall.
      flat.quad(
        [d.sx, ay + RAIL, d.sz], [d.ex, by + RAIL, d.ez],
        [r.ex, by + RAIL, r.ez], [r.sx, ay + RAIL, r.sz],
        [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], conc);
      // Inner face, facing the traffic.
      flat.quad(
        [r.sx, ay, r.sz], [r.ex, by, r.ez],
        [r.ex, by + RAIL, r.ez], [r.sx, ay + RAIL, r.sz],
        [-ox, 0, -oz], [0, 0, 1, 0, 1, 1, 0, 1], [concLo, concLo, conc, conc]);
    }

    // Piers on a realistic bay. One slender post per span, whatever the span's
    // length, read as scaffolding under a 30 m deck; a bent is a plinth, a
    // stout column and a cap spanning the full deck width.
    const bays = Math.max(1, Math.round(e.len / 52));
    for (let p = 0; p < bays; p++) {
      const t = (p + 0.5) / bays;
      const cx = lerp(a.x, b.x, t), cz = lerp(a.z, b.z, t), cy = lerp(ay, by, t);
      const capTop = cy - GIRDER;
      let base = G.terrainHeight(cx, cz);
      if (capTop - base <= 4) continue;
      if (G.isWater(cx, cz)) {
        // A column rising straight out of the lake looks unfounded. Break the
        // surface with a pile cap and start the shaft on top of it.
        flat.prism(cx, base, cz, 4.2, 1.4 - base, 8, concLo);
        flat.box(cx, 1.4, cz, 9.4, 0.55, 9.4, along, conc);
        base = 1.95;
      } else {
        flat.prism(cx, base - 1.2, cz, 3.2, 1.7, 8, concLo);   // plinth
        base += 0.3;
      }
      flat.prism(cx, base, cz, 2.4, capTop - 1.8 - base, 8, conc);            // shaft
      flat.box(cx, capTop - 1.8, cz, (hw + PARAPET) * 1.9, 1.8, 3.6, along, concLo); // cap
    }
  }

  meshRoad(road, walk, flat, e, a, b, lod, ei) {
    if (e.elev) { this.meshViaduct(road, flat, e, a, b); return; }
    const hw = e.hw;
    const px = -e.dz, pz = e.dx;
    const steps = Math.max(1, Math.round(e.len / 16));
    const col = e.cls === 'hwy' ? [0.92, 0.92, 0.92] : [1, 1, 1];
    let v = 0;
    const yAt = (x, z) => G.terrainHeight(x, z) + ROAD_Y;
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
      // Don't pave over a road that outranks this one. Where two carriageways
      // overlap, both used to draw and the depth buffer chose per pixel, which
      // is what made the centre line flicker between one stripe and two.
      if (ei != null
        && this.city.roadCoveredAt((x0 + x1) / 2, (z0 + z1) / 2, ei)) continue;
      road.quad(
        [l0x, yAt(l0x, l0z), l0z],
        [r0x, yAt(r0x, r0z), r0z],
        [r1x, yAt(r1x, r1z), r1z],
        [l1x, yAt(l1x, l1z), l1z],
        [0, 1, 0], [0, v0, 1, v0, 1, v1, 0, v1], col
      );
    }
    if (lod === 1 && (e.cls === 'st' || e.cls === 'art' || e.cls === 'res')) {
      const sw = e.cls === 'art' ? 3.2 : 2.6;
      // Stop short of each intersection: a strip run end to end would march
      // straight across the cross street. The corner is filled by meshNode.
      const ta = this.nodeRadius(e.a) / e.len;
      const tb = 1 - this.nodeRadius(e.b) / e.len;
      if (tb - ta < 0.06) return;
      const span = tb - ta;
      for (const sg of [-1, 1]) {
        const ox = px * sg, oz = pz * sg;
        const wsteps = Math.max(1, Math.round((e.len * span) / 24));
        let vv = 0;
        for (let s = 0; s < wsteps; s++) {
          const t0 = ta + (s / wsteps) * span, t1 = ta + ((s + 1) / wsteps) * span;
          const x0 = lerp(a.x, b.x, t0), z0 = lerp(a.z, b.z, t0);
          const x1 = lerp(a.x, b.x, t1), z1 = lerp(a.z, b.z, t1);
          const i0x = x0 + ox * hw, i0z = z0 + oz * hw;
          const o0x = x0 + ox * (hw + sw), o0z = z0 + oz * (hw + sw);
          const i1x = x1 + ox * hw, i1z = z1 + oz * hw;
          const o1x = x1 + ox * (hw + sw), o1z = z1 + oz * (hw + sw);
          if (!G.isBuildable(o0x, o0z) && !G.isBuildable(o1x, o1z)) continue;
          const y = (x, z) => G.terrainHeight(x, z) + WALK_Y;
          const seg = (e.len * span) / wsteps;
          const v0 = vv, v1 = vv + seg / sw;
          vv = v1;
          const q = sg > 0
            ? [[i0x, y(i0x, i0z), i0z], [o0x, y(o0x, o0z), o0z], [o1x, y(o1x, o1z), o1z], [i1x, y(i1x, i1z), i1z]]
            : [[o0x, y(o0x, o0z), o0z], [i0x, y(i0x, i0z), i0z], [i1x, y(i1x, i1z), i1z], [o1x, y(o1x, o1z), o1z]];
          walk.quad(q[0], q[1], q[2], q[3], [0, 1, 0], [0, v0, 1, v0, 1, v1, 0, v1], [1, 1, 1]);
          const cy0 = G.terrainHeight(i0x, i0z), cy1 = G.terrainHeight(i1x, i1z);
          const cc = [0.72, 0.72, 0.7];
          const ccLo = [0.4, 0.4, 0.39];
          if (sg > 0) {
            flat.quad([i0x, cy0 + ROAD_Y, i0z], [i1x, cy1 + ROAD_Y, i1z],
              [i1x, cy1 + WALK_Y, i1z], [i0x, cy0 + WALK_Y, i0z], [-ox, 0, -oz],
              [0, 0, 1, 0, 1, 1, 0, 1], [ccLo, ccLo, cc, cc]);
          } else {
            flat.quad([i1x, cy1 + ROAD_Y, i1z], [i0x, cy0 + ROAD_Y, i0z],
              [i0x, cy0 + WALK_Y, i0z], [i1x, cy1 + WALK_Y, i1z], [-ox, 0, -oz],
              [0, 0, 1, 0, 1, 1, 0, 1], [ccLo, ccLo, cc, cc]);
          }
        }
      }
    }
  }

  /** Half-size of the paved square drawn at an intersection. */
  nodeRadius(ni) {
    const n = this.city.nodes[ni];
    let hw = 0;
    for (const ei of n.e) {
      const e = this.city.edges[ei];
      if (e.hw > hw) hw = e.hw;
    }
    return hw;
  }

  meshNode(road, flat, ni, n, lod, walk) {
    const city = this.city;
    // A dead end is not a junction. Paving a crossing square and a kerbed
    // pavement ring at one leaves a slab of road furniture sitting on bare
    // ground with a single street running into it -- the "road to nowhere".
    // citygen.nodeSurface() skips these too; the two have to agree.
    if (n.e.length < 2) return;
    // Two elevated spans meeting head to head are already mitred into one
    // another by meshViaduct, so a crossing square here is a horizontal patch
    // laid across a sloping deck -- it pokes through on the uphill side and
    // hangs in the air on the downhill one. A ramp merge keeps its square:
    // there the spans are square-ended and the square is what closes the gap.
    if (n.elev && n.e.length === 2) {
      const e0 = city.edges[n.e[0]], e1 = city.edges[n.e[1]];
      if (e0.elev && e1.elev && Math.abs(e0.hw - e1.hw) < 0.01
        && Math.abs(e0.dx * e1.dx + e0.dz * e1.dz) > 0.5) return;
    }
    let hw = 0;
    let rot = 0;
    let sw = 0;
    for (const ei of n.e) {
      const e = city.edges[ei];
      if (e.hw > hw) { hw = e.hw; rot = Math.atan2(e.dx, -e.dz); }
      if (e.cls === 'st' || e.cls === 'art' || e.cls === 'res') {
        sw = Math.max(sw, e.cls === 'art' ? 3.2 : 2.6);
      }
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

    if (lod !== 1 || sw <= 0 || n.elev || !walk) return;
    // Square ring of pavement around the junction; its inner edge lines up with
    // the crossing square and its outer edge meets the trimmed street strips.
    const P = (lx, lz) => [n.x + lx * c - lz * s, n.z + lx * s + lz * c];
    const wy = (x, z) => G.terrainHeight(x, z) + WALK_Y;
    const ry = (x, z) => G.terrainHeight(x, z) + ROAD_Y;
    const cc = [0.72, 0.72, 0.7], ccLo = [0.4, 0.4, 0.39];
    // Pavement must not cross a carriageway. Each side of the ring is cut into
    // pieces and the pieces covering an approach road are dropped, which leaves
    // pavement on the corners only -- drawn whole, the ring laid a footpath
    // straight over all four approaches, the same defect the trimmed strips
    // were meant to have fixed.
    const onRoad = (x, z) => {
      for (const ei of n.e) {
        const e = city.edges[ei];
        if (e.elev) continue;
        const ea = city.nodes[e.a], eb = city.nodes[e.b];
        if (distToSeg(x, z, ea.x, ea.z, eb.x, eb.z).d <= e.hw + 0.35) return true;
      }
      return false;
    };
    const SEG = 16;
    const side = (ax, az, bx, bz, nx, nz) => {
      const wn = [-(nx * c - nz * s), 0, -(nx * s + nz * c)];
      for (let k = 0; k < SEG; k++) {
        const t0 = k / SEG, t1 = (k + 1) / SEG;
        const sax = ax + (bx - ax) * t0, saz = az + (bz - az) * t0;
        const sbx = ax + (bx - ax) * t1, sbz = az + (bz - az) * t1;
        const [i0x, i0z] = P(sax, saz), [i1x, i1z] = P(sbx, sbz);
        const [o0x, o0z] = P(sax + nx * sw, saz + nz * sw);
        const [o1x, o1z] = P(sbx + nx * sw, sbz + nz * sw);
        if (!G.isBuildable(o0x, o0z) && !G.isBuildable(o1x, o1z)) continue;
        if (onRoad((i0x + o1x) / 2, (i0z + o1z) / 2)) continue;
        walk.quad(
          [i0x, wy(i0x, i0z), i0z], [o0x, wy(o0x, o0z), o0z],
          [o1x, wy(o1x, o1z), o1z], [i1x, wy(i1x, i1z), i1z],
          [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], [1, 1, 1]);
        flat.quad(
          [i0x, ry(i0x, i0z), i0z], [i1x, ry(i1x, i1z), i1z],
          [i1x, wy(i1x, i1z), i1z], [i0x, wy(i0x, i0z), i0z],
          wn, [0, 0, 1, 0, 1, 1, 0, 1], [ccLo, ccLo, cc, cc]);
      }
    };
    const R = hw;
    side(-R, R, R, R, 0, 1);
    side(R, -R, -R, -R, 0, -1);
    side(R, R, R, -R, 1, 0);
    side(-R, -R, -R, R, -1, 0);
  }

  // --- buildings ------------------------------------------------------------

  meshBuilding(bl, flat, glow, bd) {
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
        if (hash2(seed, 11) > 0.62) { target = bl.glass; col = tint(seed, [0.88, 0.94, 1.0], 0.3); }
        else { target = bl.masonry; col = tint(seed, [0.92, 0.86, 0.76], 0.36); }
        break;
      case 'industrial':
        target = bl.industrial; col = tint(seed, [0.84, 0.86, 0.86], 0.3); uS = 16; vS = 16;
        break;
      default:
        target = bl.house; col = tint(seed, [0.94, 0.92, 0.88], 0.36); uS = 0; vS = 0;
    }

    if (bd.kind) return this.meshLandmarkTower(bl, flat, bd, col);

    const base = bd.y - 2;
    const cs = Math.cos(bd.rot), sn = Math.sin(bd.rot);
    const off = (lx, lz) => [bd.x + lx * cs - lz * sn, bd.z + lx * sn + lz * cs];

    if (bd.style === 'house') {
      const wallH = bd.h * 0.72;
      target.box(bd.x, base, bd.z, bd.w, wallH + 2, bd.d, bd.rot, col, { top: false, uScale: 0, vScale: 0, ao: 0.3 });
      const rc = tint(seed, [0.36, 0.31, 0.29], 0.14);
      flat.box(bd.x, base + wallH + 2, bd.z, bd.w + 0.7, 0.26, bd.d + 0.7, bd.rot, rc);
      flat.cone(bd.x, base + wallH + 2.26, bd.z, Math.max(bd.w, bd.d) * 0.74, bd.h * 0.42, 4, rc);
      if (hash2(seed, 21) > 0.7) {
        const [px, pz] = off(bd.w * 0.26, 0);
        flat.box(px, base + wallH + 2, pz, 1.0, bd.h * 0.5, 1.0, bd.rot, [0.4, 0.29, 0.25]);
      }
      const [sx, sz] = off(0, bd.d / 2 + 0.5);
      flat.box(sx, base + 1.6, sz, 2.0, 0.22, 1.2, bd.rot, [0.62, 0.6, 0.57]);
      return;
    }

    const dense = bd.style !== 'industrial';
    const plinthH = dense ? Math.min(5.2, bd.h * 0.3) : 0;
    let y = base;
    let remaining = bd.h + 2;

    if (plinthH > 2) {
      // ground-floor storefront: darker glazing under a cornice
      const sc = [col[0] * 0.5, col[1] * 0.54, col[2] * 0.6];
      bl.glass.box(bd.x, y, bd.z, bd.w + 0.3, plinthH, bd.d + 0.3, bd.rot, sc,
        { uScale: 9, vScale: 9, top: false, ao: 0.5 });
      flat.box(bd.x, y + plinthH, bd.z, bd.w + 1.0, 0.5, bd.d + 1.0, bd.rot, TRIM);
      if (hash2(seed, 41) > 0.55) {
        const ac = AWNING[Math.floor(hash2(seed, 42) * AWNING.length)];
        const [ax, az] = off(0, bd.d / 2 + 0.9);
        flat.box(ax, y + plinthH - 1.4, az, bd.w * 0.62, 0.22, 1.8, bd.rot, ac);
      }
      y += plinthH + 0.5;
      remaining -= plinthH + 0.5;
    }

    let w = bd.w, d = bd.d;
    const tiers = bd.h > 100 ? 3 : bd.h > 55 ? 2 : 1;
    for (let t = 0; t < tiers; t++) {
      const frac = t === tiers - 1 ? 1 : t === 0 ? 0.62 : 0.6;
      const hh = remaining * frac;
      target.box(bd.x, y, bd.z, w, hh, d, bd.rot, col,
        { uScale: uS, vScale: vS, top: false, vOff: (y - base) / (vS || 1), ao: t === 0 ? 0.22 : 0 });
      y += hh;
      remaining -= hh;
      if (t < tiers - 1) {
        flat.box(bd.x, y, bd.z, w + 0.8, 0.55, d + 0.8, bd.rot, TRIM);
        y += 0.55;
        w *= 0.78; d *= 0.78;
      }
    }

    // cornice, roof deck, then a parapet wall standing above it
    flat.box(bd.x, y, bd.z, w + 1.1, 0.55, d + 1.1, bd.rot, TRIM);
    flat.box(bd.x, y + 0.55, bd.z, w + 0.5, 0.28, d + 0.5, bd.rot, [0.33, 0.34, 0.35]);
    flat.box(bd.x, y + 0.55, bd.z, w + 0.55, 1.15, d + 0.55, bd.rot, DARK, { top: false });
    y += 0.83;

    const rc = [0.4, 0.41, 0.42];
    const n = 1 + Math.floor(hash2(seed, 31) * 3);
    for (let i = 0; i < n; i++) {
      const ox = (hash2(seed, 40 + i) - 0.5) * w * 0.55;
      const oz = (hash2(seed, 50 + i) - 0.5) * d * 0.55;
      const [rx, rz] = off(ox, oz);
      flat.box(rx, y, rz, 1.6 + hash2(seed, 60 + i) * 3, 1.2 + hash2(seed, 70 + i) * 2.6,
        1.6 + hash2(seed, 80 + i) * 3, bd.rot, rc);
    }
    if (bd.h > 26 && hash2(seed, 85) > 0.55) {
      const [bx, bz] = off(w * 0.22, -d * 0.2);
      flat.box(bx, y, bz, Math.min(6, w * 0.3), 3.2, Math.min(5, d * 0.28), bd.rot, [0.46, 0.46, 0.47]);
    }
    if (bd.h > 70 && hash2(seed, 91) > 0.45) {
      const mastH = 8 + hash2(seed, 92) * 16;
      flat.prism(bd.x, y, bd.z, 0.28, mastH, 4, [0.32, 0.33, 0.35]);
      glow.box(bd.x, y + mastH, bd.z, 0.5, 0.5, 0.5, 0, [1.0, 0.22, 0.15]);
    }
  }

  meshLandmarkTower(bl, flat, bd, col) {
    const base = bd.y - 2;
    if (bd.kind === 'columbia') {
      const dark = [0.24, 0.26, 0.3];
      const c = Math.cos(bd.rot), s = Math.sin(bd.rot);
      const lobes = [[0, 0, 1.0, 1.0], [-14, 10, 0.72, 0.86], [14, -10, 0.6, 0.7]];
      for (const [ox, oz, sc, hf] of lobes) {
        const x = bd.x + ox * c - oz * s, z = bd.z + ox * s + oz * c;
        bl.glass.box(x, base, z, bd.w * sc, (bd.h + 2) * hf, bd.d * sc, bd.rot, dark,
          { uScale: 13, vScale: 13, top: false, ao: 0.3 });
        flat.box(x, base + (bd.h + 2) * hf, z, bd.w * sc + 0.9, 1.3, bd.d * sc + 0.9, bd.rot, [0.18, 0.19, 0.22]);
      }
      flat.prism(bd.x, base + bd.h + 3, bd.z, 0.4, 22, 4, [0.3, 0.3, 0.32]);
      return;
    }
    if (bd.kind === 'smith') {
      const white = [1.05, 1.02, 0.96];
      bl.masonry.box(bd.x, base, bd.z, bd.w * 1.5, 22, bd.d * 1.5, bd.rot, white, { uScale: 12, vScale: 12, top: false, ao: 0.35 });
      flat.box(bd.x, base + 22, bd.z, bd.w * 1.5 + 1.2, 1.1, bd.d * 1.5 + 1.2, bd.rot, [0.78, 0.77, 0.73]);
      bl.masonry.box(bd.x, base + 23.1, bd.z, bd.w, bd.h - 45, bd.d, bd.rot, white, { uScale: 11, vScale: 11, top: false });
      flat.box(bd.x, base + bd.h - 22, bd.z, bd.w + 1.6, 1.5, bd.d + 1.6, bd.rot, [0.78, 0.77, 0.73]);
      flat.cone(bd.x, base + bd.h - 20.5, bd.z, bd.w * 0.72, 20, 4, [0.5, 0.56, 0.55]);
      flat.prism(bd.x, base + bd.h - 2, bd.z, 0.3, 12, 4, [0.4, 0.42, 0.44]);
      return;
    }
    if (bd.kind === 'wamu') {
      const c2 = [0.74, 0.68, 0.6];
      let y = base, w = bd.w, d = bd.d, h = bd.h + 2;
      for (let t = 0; t < 4; t++) {
        const hh = h * (t === 3 ? 1 : 0.34);
        bl.masonry.box(bd.x, y, bd.z, w, hh, d, bd.rot, c2, { uScale: 12, vScale: 12, top: false, ao: t === 0 ? 0.28 : 0 });
        flat.box(bd.x, y + hh, bd.z, w + 0.8, 0.7, d + 0.8, bd.rot, TRIM);
        y += hh + 0.7; h -= hh; w *= 0.84; d *= 0.84;
        if (h < 6) break;
      }
      flat.prism(bd.x, y, bd.z, 0.35, 16, 4, [0.4, 0.4, 0.42]);
      return;
    }
    const target = bd.kind === 'stone' ? bl.masonry : bl.glass;
    let y = base, h = bd.h + 2, w = bd.w, d = bd.d;
    for (let t = 0; t < 3; t++) {
      const hh = t === 2 ? h : h * 0.5;
      target.box(bd.x, y, bd.z, w, hh, d, bd.rot, col, { uScale: 13, vScale: 13, top: false, ao: t === 0 ? 0.28 : 0 });
      flat.box(bd.x, y + hh, bd.z, w + 0.8, 0.6, d + 0.8, bd.rot, TRIM);
      y += hh + 0.6; h -= hh; w *= 0.86; d *= 0.86;
      if (h < 8) break;
    }
    flat.box(bd.x, y, bd.z, w + 0.5, 1.1, d + 0.5, bd.rot, DARK, { top: false });
    flat.prism(bd.x, y, bd.z, 0.3, 10, 4, [0.4, 0.4, 0.42]);
  }

  // --- street furniture -----------------------------------------------------

  meshProps(flat, glow, ch, cx, cz) {
    const city = this.city;
    const own = (x, z) => Math.floor(x / CHUNK) === cx && Math.floor(z / CHUNK) === cz;
    const poleCol = [0.28, 0.3, 0.32];
    const lampCol = [1.0, 0.94, 0.76];
    const trunk = [0.32, 0.25, 0.18];

    for (const ei of ch.edges) {
      const e = city.edges[ei];
      if (e.elev || e.cls === 'hwy') continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (!own(mx, mz)) continue;
      const px = -e.dz, pz = e.dx;
      const spacing = e.cls === 'res' ? 34 : 30;
      const count = Math.floor(e.len / spacing);
      const along = Math.atan2(e.dx, e.dz);
      for (let i = 1; i <= count; i++) {
        const t = i / (count + 1);
        const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
        const h = hash2(Math.round(x), Math.round(z));
        const sg = i % 2 === 0 ? 1 : -1;
        const ox = x + px * sg * (e.hw + 1.4);
        const oz = z + pz * sg * (e.hw + 1.4);
        if (!G.isBuildable(ox, oz)) continue;
        const gy = G.terrainHeight(ox, oz) + WALK_Y;
        const armRot = Math.atan2(-px * sg, -pz * sg);
        if (h < 0.42) {
          // street light: base, tapered mast, cranked arm, lit lens
          flat.box(ox, gy, oz, 0.42, 0.22, 0.42, armRot, [0.24, 0.25, 0.27]);
          flat.prism(ox, gy + 0.2, oz, 0.115, 6.4, 8, poleCol);
          flat.prism(ox - px * sg * 0.28, gy + 6.6, oz - pz * sg * 0.28, 0.1, 0.9, 6, poleCol);
          flat.box(ox - px * sg * 1.0, gy + 7.4, oz - pz * sg * 1.0, 1.9, 0.16, 0.16, armRot, poleCol);
          flat.box(ox - px * sg * 1.85, gy + 7.15, oz - pz * sg * 1.85, 0.85, 0.26, 0.42, armRot, [0.3, 0.31, 0.33]);
          glow.box(ox - px * sg * 1.85, gy + 7.06, oz - pz * sg * 1.85, 0.7, 0.1, 0.34, armRot, lampCol);
        } else if (h < 0.84) {
          // street tree in a grate, three canopy layers
          const th = 4.5 + h * 5;
          flat.box(ox, gy - 0.02, oz, 1.5, 0.06, 1.5, armRot, [0.3, 0.3, 0.31]);
          flat.prism(ox, gy, oz, 0.26 + h * 0.1, th * 0.5, 6, trunk);
          flat.prism(ox, gy + th * 0.42, oz, 0.16, th * 0.28, 5, trunk);
          const g = [0.2 + h * 0.16, 0.4 + h * 0.2, 0.16 + h * 0.12];
          const gd = [g[0] * 0.72, g[1] * 0.72, g[2] * 0.72];
          flat.cone(ox, gy + th * 0.4, oz, 1.7 + h * 1.4, th * 0.42, 7, gd);
          flat.cone(ox, gy + th * 0.62, oz, 1.5 + h * 1.2, th * 0.42, 7, g);
          flat.cone(ox, gy + th * 0.84, oz, 1.0 + h * 0.9, th * 0.38, 6, g);
        } else if (h < 0.88) {
          flat.prism(ox, gy, oz, 0.2, 0.55, 8, [0.72, 0.16, 0.12]);
          flat.prism(ox, gy + 0.55, oz, 0.15, 0.24, 8, [0.72, 0.16, 0.12]);
          flat.box(ox, gy + 0.3, oz, 0.62, 0.14, 0.2, armRot, [0.72, 0.16, 0.12]);
        } else if (h < 0.92) {
          flat.prism(ox, gy, oz, 0.34, 0.95, 8, [0.24, 0.28, 0.26]);
          flat.prism(ox, gy + 0.95, oz, 0.37, 0.1, 8, [0.16, 0.18, 0.17]);
        } else if (h < 0.955 && e.cls !== 'res') {
          flat.box(ox, gy, oz, 1.9, 0.1, 0.55, along, [0.34, 0.24, 0.16]);
          flat.box(ox, gy + 0.1, oz, 1.9, 0.32, 0.5, along, [0.38, 0.27, 0.18]);
          for (const s2 of [-0.8, 0.8]) {
            flat.box(ox + Math.sin(along) * s2, gy, oz + Math.cos(along) * s2, 0.1, 0.42, 0.5, along, [0.25, 0.26, 0.27]);
          }
        } else if (e.cls === 'art') {
          flat.box(ox, gy, oz, 3.4, 0.1, 1.5, along, [0.4, 0.42, 0.45]);
          flat.box(ox - px * sg * 0.62, gy, oz - pz * sg * 0.62, 3.4, 2.5, 0.08, along, [0.62, 0.74, 0.8]);
          flat.box(ox, gy + 2.5, oz, 3.7, 0.16, 1.8, along, [0.3, 0.32, 0.35]);
          glow.box(ox + px * sg * 0.5, gy + 1.7, oz + pz * sg * 0.5, 0.9, 1.2, 0.06, along, [0.8, 0.86, 0.95]);
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
          flat.box(ox, gy, oz, 0.5, 0.25, 0.5, along, [0.24, 0.25, 0.27]);
          flat.prism(ox, gy + 0.22, oz, 0.13, 5.9, 8, poleCol);
          flat.box(ox + e.dx * 2.2, gy + 5.75, oz + e.dz * 2.2, 0.28, 0.28, 4.6, along, poleCol);
          const hx = ox + e.dx * 4.3, hz = oz + e.dz * 4.3;
          flat.box(hx, gy + 4.3, hz, 0.52, 1.5, 0.42, along, [0.16, 0.18, 0.2]);
          const lens = (yy, c) => {
            flat.box(hx + e.dx * 0.16, gy + yy + 0.16, hz + e.dz * 0.16, 0.5, 0.06, 0.44, along, [0.1, 0.11, 0.12]);
            glow.box(hx + e.dx * 0.24, gy + yy, hz + e.dz * 0.24, 0.3, 0.3, 0.1, along, c);
          };
          lens(5.4, [1.0, 0.14, 0.1]);
          lens(5.0, [0.85, 0.68, 0.12]);
          lens(4.6, [0.16, 0.9, 0.32]);
        }
      }
    }

    // Park trees. The count is candidates over the whole chunk, of which only
    // the ones landing in a park survive -- at 46 a chunk-sized park got one
    // tree per 60 m and read as an empty green rectangle, which is most of why
    // the parks looked unfinished.
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (let i = 0; i < 230; i++) {
      const hx = hash2(cx * 71 + i, cz * 131 + 7);
      const hz = hash2(cx * 37 + i, cz * 53 + 13);
      const x = x0 + hx * CHUNK, z = z0 + hz * CHUNK;
      if (!G.inPark(x, z)) continue;
      const h = hash2(Math.round(x), Math.round(z));
      const gy = G.terrainHeight(x, z);
      const th = 7 + h * 7;
      flat.prism(x, gy, z, 0.34 + h * 0.2, th * 0.46, 6, trunk);
      flat.prism(x, gy + th * 0.4, z, 0.2, th * 0.3, 5, trunk);
      const g = [0.17 + h * 0.15, 0.38 + h * 0.22, 0.14 + h * 0.12];
      const gd = [g[0] * 0.7, g[1] * 0.7, g[2] * 0.7];
      flat.cone(x, gy + th * 0.34, z, 2.4 + h * 2, th * 0.42, 7, gd);
      flat.cone(x, gy + th * 0.58, z, 2.1 + h * 1.7, th * 0.44, 7, g);
      flat.cone(x, gy + th * 0.82, z, 1.4 + h * 1.2, th * 0.4, 6, g);
    }
  }
}
