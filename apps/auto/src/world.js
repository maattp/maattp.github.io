// Scene construction: sky + image-based lighting, terrain, water, streamed city
// chunks, distant skyline and the hand-built landmarks.

import * as THREE from './three.js';
import * as G from './geo.js';
import { CHUNK, ROAD_LIFT, NODE_LIFT, WALK_LIFT, cityStats } from './citygen.js';
import { Builder } from './build.js';
import { hash2, clamp, lerp, distToSeg } from './util.js';

const ROAD_Y = ROAD_LIFT;
// Metres per road-texture repeat. Fixed, so the asphalt's grain is the same
// size on an alley and on a freeway.
const ROAD_TILE = 9;
// Paint sits just proud of the asphalt; any less and it z-fights at distance.
const MARK_Y = ROAD_LIFT + 0.012;
// `flat` has no map, but Builder.quad indexes the uv array unconditionally.
const ZERO_UV = [0, 0, 0, 0, 0, 0, 0, 0];
const NODE_Y = NODE_LIFT;
const WALK_Y = WALK_LIFT;

const NEAR_R = 2; // chunks of full detail around the player
const MID_R = 4; // chunks that keep roads only

// Ground tints, and the taps used to soften a district's edge into them.
const GRASS = [0.42, 0.62, 0.28];
// SUBURB used to be [0.48, 0.60, 0.37], which is the same colour as GRASS to
// within a rounding error -- so ground that had blended all the way to "fully
// developed" still rendered as a bright meadow, and the I-5 trench through
// Chinatown looked like a lawn. Developed ground is lawn AND roof AND tarmac
// mixed together, so it has to be visibly more muted than grass or the blend
// has nothing to say.
const SUBURB = [0.52, 0.53, 0.41];
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

/**
 * Per-building colour variation.
 *
 * Jittering R, G and B INDEPENDENTLY is what manufactured the candy palette:
 * three uncorrelated offsets push a muted base straight off into saturated
 * primaries, so a street of weathered brick came out fluorescent pink, lime and
 * orange. Real variation between buildings is mostly TONAL -- the same material
 * dirtier or paler -- with only a slight drift in hue. So the brightness jitter
 * is shared across all three channels, the chroma jitter is a fifth of it, and
 * everything is pulled toward its own grey.
 */
const SATURATION = 0.62;
function tint(seed, base, spread) {
  const v = 1 + (hash2(seed, 1) - 0.5) * spread * 0.85;
  const dr = (hash2(seed, 2) - 0.5) * spread * 0.18;
  const db = (hash2(seed, 3) - 0.5) * spread * 0.18;
  const lum = base[0] * 0.2126 + base[1] * 0.7152 + base[2] * 0.0722;
  const mute = (c, d) => clamp((lum + (c - lum) * SATURATION + d) * v, 0.12, 1.35);
  return [mute(base[0], dr), mute(base[1], 0), mute(base[2], db)];
}

const DARK = [0.26, 0.27, 0.29];
const TRIM = [0.55, 0.55, 0.56];
// Accents stay the one place saturated colour is allowed, but pulled back:
// these are awnings and shopfronts, not the whole facade.
const AWNING = [
  [0.42, 0.16, 0.15], [0.15, 0.25, 0.38], [0.16, 0.29, 0.21],
  [0.36, 0.30, 0.18], [0.21, 0.21, 0.24], [0.42, 0.37, 0.29],
];

// ---------------------------------------------------------------------------

export class World {
  constructor(scene, city, tx, opts = {}) {
    this.scene = scene;
    this.city = city;
    this.tx = tx;
    this.renderer = opts.renderer;
    this.shadows = opts.shadows !== false;
    this.lakeSpecs = opts.lakes || [];
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
      road: surf(tx.road, { env: 0.62, ns: 0.9 }),
      walk: surf(tx.sidewalk, { env: 0.52, ns: 0.8 }),
      glass: surf(tx.glass, { env: 1.9, metalness: 0.34, roughness: 0.22, ns: 1.1, emissive: 0.02 }),
      masonry: surf(tx.masonry, { env: 0.66, ns: 1.5, emissive: 0.015 }),
      brick: surf(tx.brick, { env: 0.60, ns: 1.5, emissive: 0.015 }),
      // Signage. Emissive is high because a fifth of the atlas cells are lit
      // plates and the rest have a black emissive, so the intensity only ever
      // applies to the ones meant to glow.
      signs: surf(tx.signs, { env: 0.5, roughness: 0.62, emissive: 1.5 }),
      industrial: surf(tx.industrial, { env: 0.5, metalness: 0.25, ns: 1.7 }),
      house: surf(tx.house, { env: 0.45, ns: 1.8, emissive: 0.015 }),
      flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04, envMapIntensity: 0.45 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      // The far skyline is a silhouette mesh: what matters is that a mass two
      // kilometres out sits at a believable fraction of sky luminance, not
      // that its shaded side has readable detail. At 0.5 its away-from-sun
      // faces fell to about 4 % of the sky and downtown read as a row of black
      // cutouts pasted over the horizon -- which looks like a broken renderer,
      // not like distance.
      far: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02, envMapIntensity: 0.85 }),
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
    // Tile size trades draw calls against wasted triangles, and on a phone the
    // draw calls are what hurt. The map is 16 km across now, so the old 8 x 8
    // would make each tile 2 km wide and the frustum would never cull one; 20
    // x 20 went the other way and put 132 terrain meshes on screen at once,
    // a third of the entire draw budget, for ground that is mostly behind
    // buildings anyway. 12 x 12 is a ~1.3 km tile, which is about what the
    // 10.4 km map used to have.
    const TILES = 12;
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
            // How built-up the ground is comes from the real footprint area in
            // each 400 m chunk, so the edge of the city follows the city rather
            // than a rectangle. The query point is still pushed around by smooth
            // noise and sampled three times, because the chunk grid is 400 m and
            // a straight lookup would draw its staircase on the ground.
            let c;
            if (y < 1.2) c = [0.94, 0.86, 0.66];
            else if (G.inPark(x, z)) c = [0.42, 0.66, 0.3];
            else {
              const jx = (vnoise(x, z) - 0.5) * 190;
              const jz = (vnoise(x + 3137, z - 2711) - 0.5) * 190;
              let dense = 0;
              for (const [ox, oz] of BLEND_TAPS) {
                dense += this.city.builtAt(x + jx + ox, z + jz + oz);
              }
              dense /= BLEND_TAPS.length;
              // `builtAt` is footprint + tarmac area per chunk. Anything with a
              // street grid on it is developed ground, so this saturates early:
              // a normal residential chunk runs ~0.25 and should read as a
              // neighbourhood, not as a meadow with houses dropped on it.
              const cover = clamp(dense / 0.16, 0, 1);
              const built = dense > 0.6 ? URBAN : SUBURB;
              const t = cover * cover * (3 - 2 * cover);
              c = [
                GRASS[0] + (built[0] - GRASS[0]) * t,
                GRASS[1] + (built[1] - GRASS[1]) * t,
                GRASS[2] + (built[2] - GRASS[2]) * t,
              ];
            }
            // Two grass tones, in patches.
            //
            // Per-vertex hash noise alone is high-frequency speckle: at 40 m
            // spacing it varies faster than the eye groups it, so a park read
            // as one flat saturated carpet however much jitter was on it. A
            // smooth low-frequency field on top gives patches you can actually
            // see -- lush against dry, which is what a real park looks like
            // from any distance.
            const patch = vnoise(x * 0.35 + 811, z * 0.35 - 553);
            const dry = (patch - 0.42) * 0.55;
            const n = hash2(gi, gj) * 0.14 + 0.93;
            col[k] = c[0] * n * (1 + dry * 0.34);
            col[k + 1] = c[1] * n * (1 - dry * 0.16);
            col[k + 2] = c[2] * n * (1 - dry * 0.30);
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
      // Roughness up and normal amplitude down: at 0.09 every wavelet past a
      // couple of hundred metres aliased into one blown white specular sheet
      // along the horizon.
      // 0.22 killed the blown horizon sheet but also every highlight, leaving a
      // dead black sheet. 0.15 keeps a sun lobe; the tiling weave is broken by
      // scrolling two copies of the normal map at different rates below.
      // Water is a DIELECTRIC, and its Fresnel is the whole look. At
      // metalness 0.22 the surface was mostly a dark diffuse body colour with
      // a weak reflection on top, so near water sat at about a fifth of the
      // sky's luminance while far water was carried entirely by fog -- the
      // same lake reading 34 close in and 151 out at the horizon. Dropping
      // metalness to near zero gives F0 = 0.04 with a real grazing-angle
      // ramp, which is what puts the sky into the water and produces the
      // shore-to-horizon gradient without a reflection pass.
      color: 0x33556e, normalMap: n, roughness: 0.10, metalness: 0.02,
      envMapIntensity: 1.4, normalScale: new THREE.Vector2(0.36, 0.36),
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0;
    m.renderOrder = -5;
    this.scene.add(m);
    this.water = m;
    this.waterNormal = n;

    // The lakes are not at sea level, and one plane cannot serve both. A
    // bare-earth DEM reports the *surface* of standing water as ground, so
    // Lake Union arrives as a 5 m plateau and Green Lake as a 51 m one; with
    // only the sea plane at y=0 both rendered as solid grass you could drive
    // across. tools/build_raster.py digs a bed under each and reports its
    // level, and each gets its own plane here.
    this.lakes = [];
    for (const l of (this.lakeSpecs || [])) {
      const w = l.x1 - l.x0, d = l.z1 - l.z0;
      const lg = new THREE.PlaneGeometry(w, d, 1, 1);
      lg.rotateX(-Math.PI / 2);
      const lm = new THREE.Mesh(lg, mat);
      lm.position.set((l.x0 + l.x1) / 2, l.level, (l.z0 + l.z1) / 2);
      lm.renderOrder = -4;
      this.scene.add(lm);
      this.lakes.push(lm);
    }
  }

  /** Every tall building in the city as one cheap silhouette mesh. */
  buildSkyline() {
    const b = new Builder(false);
    for (const bd of this.city.buildings) {
      if (bd.h < 30) continue;
      const v = 0.86 + hash2(bd.seed, 17) * 0.26;
      const col = bd.style === 'tower'
        ? [0.54 * v, 0.58 * v, 0.63 * v]
        : [0.60 * v, 0.56 * v, 0.51 * v];
      const s = 0.985;
      // A tower is read almost entirely by its top. Extruded to full height
      // and capped flat, every building in the skyline is the same rectangle
      // with a different length -- the reason the downtown silhouette scored
      // worst of anything in the frame. Anything tall enough to stand out of
      // the mass gets its shaft stopped short and a crown built on top: a
      // setback, a mechanical penthouse, and sometimes a mast.
      //
      // This is the far mesh, so it is silhouette only -- four boxes at most,
      // and only for the few hundred buildings over 45 m.
      const crown = bd.h > 45;
      const shaftH = crown ? bd.h * (0.80 + hash2(bd.seed, 23) * 0.10) : bd.h;
      b.box(bd.x, bd.y - 2, bd.z, bd.w * s, shaftH + 2, bd.d * s, bd.rot, col, { top: true, ao: 0.3 });
      if (!crown) continue;
      const dk = [col[0] * 0.86, col[1] * 0.88, col[2] * 0.92];
      let cy = bd.y - 2 + shaftH + 2;
      let cw = bd.w * s, cd = bd.d * s;
      const style = hash2(bd.seed, 29);
      const setbacks = style < 0.4 ? 1 : style < 0.8 ? 2 : 3;
      const rest = bd.h - shaftH;
      for (let t = 0; t < setbacks; t++) {
        const th = rest / setbacks;
        cw *= 0.78; cd *= 0.78;
        b.box(bd.x, cy, bd.z, cw, th, cd, bd.rot, t % 2 ? col : dk, { top: true, ao: 0 });
        cy += th;
      }
      // Mechanical penthouse: the boxy plant room every real tower carries.
      b.box(bd.x, cy, bd.z, cw * 0.62, 3.5 + hash2(bd.seed, 31) * 3, cd * 0.62, bd.rot, dk, { top: true });
      if (bd.h > 80 && hash2(bd.seed, 37) > 0.45) {
        const mh = 8 + hash2(bd.seed, 41) * 22;
        b.box(bd.x, cy + 3.5, bd.z, 1.1, mh, 1.1, bd.rot, dk, { top: true });
      }
    }
    const m = new THREE.Mesh(b.build(), this.mats.far);
    m.frustumCulled = false;
    this.scene.add(m);
    this.skyline = m;
  }

  animate(dt, t) {
    if (this.waterNormal) {
      // Scroll BOTH axes at incommensurate rates. Scrolling x alone slides the
      // tile along one screen direction and the repeat reads as a fixed diagonal
      // weave across the open water. MeshStandardMaterial takes a single normal
      // map, so two summed layers would need a custom shader; two irrational-ish
      // rates on one map breaks the pattern for nothing.
      this.waterNormal.offset.x = (t * 0.0040) % 1;
      this.waterNormal.offset.y = (t * 0.0017) % 1;
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
    // Solid street objects belong to the chunk that drew them, so they go when
    // it does. Leaving them behind means invisible trees you keep hitting.
    this.city.clearObstacles(this.city.chunkKey(c.cx, c.cz));
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
    const ck = city.chunkKey(cx, cz);
    const ch = city.chunks.get(ck);
    if (!ch) return null;
    city.clearObstacles(ck);
    this._ck = ck;
    const road = new Builder(true);
    const walk = new Builder(true);
    const flat = new Builder(false);
    const glow = new Builder(false);
    const bl = {
      glass: new Builder(true), masonry: new Builder(true), brick: new Builder(true),
      signs: new Builder(true),
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
    add(bl.brick, this.mats.brick, true, true);
    add(bl.signs, this.mats.signs, true, false);
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

  /**
   * Lane markings, as geometry rather than baked into the asphalt texture.
   *
   * Drawn in real metres, so a line is 12 cm wide and a dash is 3 m long with a
   * 6 m gap on every class instead of scaling with the carriageway -- baked into
   * the texture, a 27 m highway got 4.3 m dashes and a residential street got
   * 1.4 m ones. Alleys and the narrowest streets get nothing, which is also
   * what they have in life.
   */
  meshRoadMarks(flat, e, a, b, ei) {
    const hw = e.hw;
    const bias = hash2(ei | 0, 7) * 0.03;
    if (hw < 4.0) return;                       // alleys and lanes are unmarked
    const px = -e.dz, pz = e.dx;
    const yAt = (x, z) => G.terrainHeight(x, z) + MARK_Y + bias;
    const W = 0.06;                             // half-width of a painted line
    const WHITE = [0.94, 0.93, 0.88];
    const YELLOW = [0.88, 0.72, 0.2];

    const stripe = (off, from, to, col) => {
      if (to <= from) return;
      const t0 = from / e.len, t1 = to / e.len;
      const cx0 = lerp(a.x, b.x, t0) + px * off, cz0 = lerp(a.z, b.z, t0) + pz * off;
      const cx1 = lerp(a.x, b.x, t1) + px * off, cz1 = lerp(a.z, b.z, t1) + pz * off;
      if (ei != null && this.city.roadCoveredAt((cx0 + cx1) / 2, (cz0 + cz1) / 2, ei)) return;
      const l0x = cx0 + px * W, l0z = cz0 + pz * W, r0x = cx0 - px * W, r0z = cz0 - pz * W;
      const l1x = cx1 + px * W, l1z = cz1 + pz * W, r1x = cx1 - px * W, r1z = cz1 - pz * W;
      flat.quad(
        [l0x, yAt(l0x, l0z), l0z],
        [r0x, yAt(r0x, r0z), r0z],
        [r1x, yAt(r1x, r1z), r1z],
        [l1x, yAt(l1x, l1z), l1z],
        [0, 1, 0], ZERO_UV, col
      );
    };

    // Paint stops short of a junction, the same way the pavement strips do.
    // Run end to end and each road lays its edge lines straight across every
    // cross street it meets -- white lines cutting the carriageway diagonally
    // and centre dashes doubling back on themselves. The crossing itself is
    // bare tarmac, which is what a real junction mostly is.
    const from = this.nodeRadius(e.a);
    const till = e.len - this.nodeRadius(e.b);
    if (till <= from) return;

    // Edge lines, set in from the kerb by about a shoulder's width.
    const edge = hw - Math.min(0.7, hw * 0.06);
    const step = 8; // subdivide so a line follows the terrain rather than spanning it
    for (let s = from; s < till; s += step) {
      const to = Math.min(till, s + step);
      stripe(edge, s, to, WHITE);
      stripe(-edge, s, to, WHITE);
    }

    // Centre line. A motorway carriageway is one-way and has no centre line;
    // everything else is two-way here, so it gets a broken yellow one.
    if (e.cls === 'hwy' || e.oneway) return;
    const DASH = 3, GAP = 6;
    // Phase the dashes off the edge's own start so they stay evenly spaced
    // rather than restarting at each junction.
    for (let s = from; s < till; s += DASH + GAP) {
      stripe(0, s, Math.min(till, s + DASH), YELLOW);
    }
  }

  meshRoad(road, walk, flat, e, a, b, lod, ei) {
    if (e.elev) { this.meshViaduct(road, flat, e, a, b); return; }
    const hw = e.hw;
    const U1 = (hw * 2) / ROAD_TILE;
    const px = -e.dz, pz = e.dx;
    // Segment length follows the gradient. A flat street is fine in 16 m
    // pieces, but a road quad is a CHORD and its error grows with the square of
    // its length: McGraw Street on Queen Anne drops 5.4 m across one 18 m
    // segment and the chord cut 1.39 m under the crest, which is terrain
    // standing proud of the asphalt -- the grass growing over the road. At 4 m
    // the same crest costs about 7 cm, comfortably under the 22 cm road lift.
    // Only steep roads pay for the extra pieces.
    // Measure the BOW, not the gradient. A street that climbs steadily is a
    // chord's best case; what defeats a chord is curvature, and a road can be
    // level end to end while cresting a rise in the middle -- that is the
    // downtown case a gradient test missed entirely. One extra terrain sample
    // gives the sag at the midpoint, and chord error falls with the square of
    // the piece length, so the length that keeps it under ~6 cm is direct.
    // The two tests fail on different shapes, so take whichever is finer.
    // Gradient alone misses a road that is level end to end but crests in the
    // middle; bow alone misses one whose crest is off-centre or S-shaped, where
    // the midpoint happens to land on the chord -- measured on its own it was
    // worse than the gradient test on Queen Anne (36.7 cm against 11.8 cm).
    const bow = Math.abs(
      G.terrainHeight((a.x + b.x) / 2, (a.z + b.z) / 2) - (a.y + b.y) / 2
    );
    const grade = Math.abs(a.y - b.y) / Math.max(1, e.len);
    const byGrade = grade > 0.08 ? 3 : grade > 0.03 ? 5 : 8;
    const byBow = bow < 0.01 ? 8 : clamp(e.len * Math.sqrt(0.02 / bow), 2.5, 8);
    const segLen = Math.min(byGrade, byBow);
    const steps = Math.max(1, Math.round(e.len / segLen));
    const col = e.cls === 'hwy' ? [0.92, 0.92, 0.92] : [1, 1, 1];
    let v = 0;
    // Deterministic sub-centimetre lift per edge, so two carriageways that
    // genuinely overlap resolve instead of fighting.
    //
    // roadCoveredAt only drops a surface whose WHOLE width is inside another's
    // -- it has to, or every ramp beside a motorway loses its tarmac. What that
    // leaves is partial overlaps, and those used to be drawn coplanar: a
    // raycast over one freeway found a second road surface within half a metre
    // behind 129 of 148 sampled pixels. Coplanar asphalt z-fights, and because
    // the two quads face slightly differently it reads as soft dark blotches
    // smeared over the road rather than as obvious flicker. That is the "messy
    // surface". 3 cm is far below the 22 cm kerb, so roadLift need not know.
    const bias = hash2(ei | 0, 7) * 0.03;
    const yAt = (x, z) => G.terrainHeight(x, z) + ROAD_Y + bias;
    // Subdivide ACROSS the width as well as along the length.
    //
    // The quad used to span the full carriageway with terrain sampled only at
    // its four corners, so the drawn surface was the bilinear of those -- and on
    // a cross-slope the real ground in between bulges straight through it. On
    // Queen Anne that put terrain up to 1.39 m above the asphalt, which is the
    // grass growing over the road. The heightfield is 40 m, so cells of roughly
    // 8 m follow it closely without paying for detail that isn't there.
    //
    // Cells are also what carries the cross-section shading below, and a road
    // shaded from its four corners has no cross-section at all, so anything
    // over about three lanes gets at least three cells. Three is the cheapest
    // count that can put a bright band down the middle and grime at both kerbs;
    // four looked no better and cost 40 % more road triangles.
    const across = Math.max(hw > 4.5 ? 3 : 1, Math.round((hw * 2) / 8));
    /**
     * Traffic polishes the middle of a carriageway and grime collects at its
     * edges. Without it the asphalt is one flat value from kerb to kerb --
     * which is exactly what made the largest surface in every street-level
     * frame read as a hole in the image rather than as a road.
     *
     * `f` is the distance from the centreline as a fraction of the half-width.
     */
    const wear = (o) => {
      const f = Math.min(1, Math.abs(o) / Math.max(hw, 0.01));
      const polish = 1 + 0.12 * (1 - f * f);        // worn smooth down the middle
      const edge = 1 - 0.30 * Math.max(0, f - 0.55) / 0.45;  // grime at the kerb
      const k = polish * edge;
      return [col[0] * k, col[1] * k, col[2] * k];
    };
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const seg = e.len / steps;
      // Fixed metres per texture repeat, in BOTH directions. This used to be
      // `seg / (hw * 2)` with u spanning 0..1 across the road, which tied the
      // asphalt's grain to how wide the road happened to be.
      const v0 = v, v1 = v + seg / ROAD_TILE;
      v = v1;
      // Don't pave over a road that outranks this one. Asked once per segment
      // rather than per cell -- it is a 3x3-chunk scan and the answer cannot
      // meaningfully differ across one carriageway's width.
      const mx = lerp(a.x, b.x, (t0 + t1) / 2), mz = lerp(a.z, b.z, (t0 + t1) / 2);
      if (ei != null && this.city.roadCoveredAt(mx, mz, ei)) continue;
      for (let k = 0; k < across; k++) {
        const o0 = hw - (hw * 2 * k) / across;
        const o1 = hw - (hw * 2 * (k + 1)) / across;
        const u0 = (hw - o0) / ROAD_TILE, u1 = (hw - o1) / ROAD_TILE;
        const P = (t, o) => [lerp(a.x, b.x, t) + px * o, lerp(a.z, b.z, t) + pz * o];
        const [ax, az] = P(t0, o0), [bx, bz] = P(t0, o1);
        const [cx, cz] = P(t1, o1), [dx, dz] = P(t1, o0);
        road.quad(
          [ax, yAt(ax, az), az],
          [bx, yAt(bx, bz), bz],
          [cx, yAt(cx, cz), cz],
          [dx, yAt(dx, dz), dz],
          [0, 1, 0], [u0, v0, u1, v0, u1, v1, u0, v1],
          [wear(o0), wear(o1), wear(o1), wear(o0)]
        );
      }
    }
    this.meshRoadMarks(flat, e, a, b, ei);
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
          // Pavement must not cross a carriageway. Stopping the strip at
          // nodeRadius is not enough on its own: the strip is offset SIDEWAYS
          // by hw + sw, so near a junction its far corner can sit in the cross
          // street even though its centreline has stopped short -- and with
          // real data a road that does not even meet this node can pass close
          // enough to be under it. Test the piece itself against every nearby
          // carriageway instead of trusting the geometry.
          // Sample the piece's MIDDLE, not its inner edge: a pavement's inner
          // edge lies exactly on its own carriageway's boundary by definition,
          // so testing it rejects every piece in the city (95 % of the pavement
          // vanished on the first attempt). The mid-depth line is a full sw/2
          // clear of its own road and still inside any road it truly overlaps.
          // Grid across the piece, at a quarter and three quarters of its
          // depth. Depth 0 is the inner edge, which lies on this pavement's own
          // carriageway boundary and would reject everything; a quarter of the
          // way out is clear of it and still lands inside any road the piece
          // genuinely overlaps. Three samples along caught the head-on cases but
          // missed pieces clipping a junction corner diagonally.
          let hits = false;
          for (const fd of [0.25, 0.75]) {
            for (const fl of [0, 0.5, 1]) {
              const ex = i0x + (i1x - i0x) * fl, ez = i0z + (i1z - i0z) * fl;
              const gx = o0x + (o1x - o0x) * fl, gz = o0z + (o1z - o0z) * fl;
              if (this.city.onRoad(ex + (gx - ex) * fd, ez + (gz - ez) * fd, 0, false)) {
                hits = true; break;
              }
            }
            if (hits) break;
          }
          if (hits) continue;
          const y = (x, z) => G.terrainHeight(x, z) + WALK_Y;
          const seg = (e.len * span) / wsteps;
          const v0 = vv, v1 = vv + seg / sw;
          vv = v1;
          const q = sg > 0
            ? [[i0x, y(i0x, i0z), i0z], [o0x, y(o0x, o0z), o0z], [o1x, y(o1x, o1z), o1z], [i1x, y(i1x, i1z), i1z]]
            : [[o0x, y(o0x, o0z), o0z], [i0x, y(i0x, i0z), i0z], [i1x, y(i1x, i1z), i1z], [o1x, y(o1x, o1z), o1z]];
          // Per-piece value jitter, plus a darker inner edge against the
          // building line. Every slab drawn at exactly 1.0 left a perfect
          // lattice of identical slabs running to the horizon; the texture's
          // own staining can only break the tile, not the repeat of the tile.
          const wj = 0.9 + hash2(Math.round(x0 * 0.7), Math.round(z0 * 0.7)) * 0.2;
          const wIn = [wj, wj, wj];
          const wOut = [wj * 0.9, wj * 0.9, wj * 0.91];
          const wc = sg > 0 ? [wIn, wOut, wOut, wIn] : [wOut, wIn, wIn, wOut];
          walk.quad(q[0], q[1], q[2], q[3], [0, 1, 0], [0, v0, 1, v0, 1, v1, 0, v1], wc);
          const cy0 = G.terrainHeight(i0x, i0z), cy1 = G.terrainHeight(i1x, i1z);
          const cc = [0.72, 0.72, 0.7];
          const ccLo = [0.4, 0.4, 0.39];
          // Gutter. Road met pavement on a mathematically clean seam, which is
          // the single loudest "this is a textured plane, not a street" tell --
          // every real kerb has a strip of accumulated grime against it. Drawn
          // here rather than in the road loop so it stays registered with the
          // kerb face by construction, on the same lift the lane markings use.
          const gW = 0.5;
          const gv0 = (t0 * e.len) / ROAD_TILE, gv1 = (t1 * e.len) / ROAD_TILE;
          const gy0 = cy0 + MARK_Y + bias, gy1 = cy1 + MARK_Y + bias;
          const j0x = i0x - ox * gW, j0z = i0z - oz * gW;
          const j1x = i1x - ox * gW, j1z = i1z - oz * gW;
          const gDark = [0.44, 0.45, 0.46];
          const gLite = [0.92, 0.93, 0.93];
          road.quad(
            [i0x, gy0, i0z], [j0x, G.terrainHeight(j0x, j0z) + MARK_Y + bias, j0z],
            [j1x, G.terrainHeight(j1x, j1z) + MARK_Y + bias, j1z], [i1x, gy1, i1z],
            [0, 1, 0],
            [0, gv0, gW / ROAD_TILE, gv0, gW / ROAD_TILE, gv1, 0, gv1],
            [gDark, gLite, gLite, gDark]
          );
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

  /**
   * Gabled roof fitted to a rectangular footprint.
   *
   * Built in the building's own frame and transformed out by `bd.rot`, so it
   * lands on the walls at any orientation. The ridge runs along the LONGER
   * side, which is what a house does -- run it the short way and a long terrace
   * ends up with an absurdly tall roof and gable ends the width of the street.
   */
  meshGable(flat, bd, y0, col, seed) {
    const cs = Math.cos(bd.rot), sn = Math.sin(bd.rot);
    const OVER = 0.45;                       // eaves overhang, all four sides
    const alongX = bd.w >= bd.d;             // which way the ridge runs
    const hw = bd.w / 2 + OVER, hd = bd.d / 2 + OVER;
    // Pitch from the span it has to cover, capped so a wide house doesn't get a
    // spire and a narrow one still reads as a roof.
    const span = alongX ? hd : hw;
    const rise = clamp(span * 0.62, 1.0, 3.6);
    const y1 = y0 + rise;
    const P = (lx, lz, y) => [bd.x + lx * cs - lz * sn, y, bd.z + lx * sn + lz * cs];
    // Ridge endpoints, pulled in a little so the gable ends are not knife-edged.
    const rl = alongX ? hw : hd;
    const A = alongX ? P(-rl, 0, y1) : P(0, -rl, y1);
    const Bp = alongX ? P(rl, 0, y1) : P(0, rl, y1);
    // Eaves corners
    const c00 = P(-hw, -hd, y0), c10 = P(hw, -hd, y0);
    const c11 = P(hw, hd, y0), c01 = P(-hw, hd, y0);
    const dark = [col[0] * 0.62, col[1] * 0.62, col[2] * 0.66];
    if (alongX) {
      flat.quad(c00, c10, Bp, A, [0, 0.72, -0.7], ZERO_UV, col);      // slope -z
      flat.quad(c11, c01, A, Bp, [0, 0.72, 0.7], ZERO_UV, dark);      // slope +z
      flat.tri(c00, A, c01, [-1, 0.25, 0], col);                      // gable -x
      flat.tri(c10, c11, Bp, [1, 0.25, 0], col);                      // gable +x
    } else {
      flat.quad(c00, A, Bp, c01, [-0.7, 0.72, 0], ZERO_UV, col);      // slope -x
      flat.quad(c10, c11, Bp, A, [0.7, 0.72, 0], ZERO_UV, dark);      // slope +x
      flat.tri(c00, c10, A, [0, 0.25, -1], col);                      // gable -z
      flat.tri(c01, Bp, c11, [0, 0.25, 1], col);                      // gable +z
    }
    // Chimney, on the roof rather than beside it.
    if (hash2(seed, 21) > 0.62) {
      const t = (hash2(seed, 22) - 0.5) * 0.5;
      const [px, , pz] = alongX ? P(rl * t, 0, 0) : P(0, rl * t, 0);
      flat.box(px, y0 + rise * 0.45, pz, 0.72, rise * 0.75 + 0.7, 0.72, bd.rot,
        [0.4, 0.29, 0.25]);
    }
  }

  /** Square-based pyramid that honours the footprint and its rotation. */
  meshPyramid(flat, x, y0, z, hw, hd, h, rot, col) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const P = (lx, lz, yy) => [x + lx * cs - lz * sn, yy, z + lx * sn + lz * cs];
    const apex = [x, y0 + h, z];
    const c = [P(-hw, -hd, y0), P(hw, -hd, y0), P(hw, hd, y0), P(-hw, hd, y0)];
    const nrm = [[0, 0.4, -1], [1, 0.4, 0], [0, 0.4, 1], [-1, 0.4, 0]];
    for (let i = 0; i < 4; i++) {
      flat.tri(c[i], c[(i + 1) % 4], apex, nrm[i], col);
    }
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
    // Every nearby carriageway, not just the ones meeting THIS node. Junctions
    // are close together in real data and a ring can easily reach into a
    // neighbouring one's approach, which the old node-local test could not see.
    const onRoad = (x, z) => city.onRoad(x, z, 0, false);
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
        // Mid-depth at both ends, for the same reason as the strips: the ring's
        // inner edge sits on the junction square's boundary, so testing corners
        // rejects the whole ring.
        let ringHit = false;
        for (const fd of [0.25, 0.75]) {
          for (const fl of [0, 0.5, 1]) {
            const ex = i0x + (i1x - i0x) * fl, ez = i0z + (i1z - i0z) * fl;
            const gx = o0x + (o1x - o0x) * fl, gz = o0z + (o1z - o0z) * fl;
            if (onRoad(ex + (gx - ex) * fd, ez + (gz - ez) * fd)) { ringHit = true; break; }
          }
          if (ringHit) break;
        }
        if (ringHit) continue;
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

  /**
   * Material families.
   *
   * Per-building random jitter around ONE base colour per style gave a downtown
   * that was almost entirely the same beige-orange brick -- the palette fix
   * removed the candy colours but replaced them with monotony. Real cities are a
   * handful of distinct material families (concrete, curtain-wall glass, red
   * brick, painted stucco, dark modern) mixed on one street, with variation
   * INSIDE each family rather than across the whole city.
   */
  buildingFamily(bd) {
    const seed = bd.seed;
    const pick = hash2(seed, 101);
    // Taller and newer skews to glass and dark curtain wall; low and old skews
    // to brick and stucco, which is roughly how a city stratifies by era.
    const modern = clamp((bd.h - 18) / 55, 0, 1);
    // A named palette, not a jitter. Every family carries its own hue AND its
    // own material, so a street reads as a mix of buildings put up in different
    // decades out of different stuff -- which is the thing a tint of one shared
    // texture cannot express however far you push it.
    const FAMS = [
      { m: 'masonry', c: [0.76, 0.75, 0.72], u: 14, v: 13.6 },   // grey concrete
      { m: 'glass', c: [0.78, 0.86, 0.92], u: 14, v: 13.6 },     // curtain wall
      { m: 'brick', c: [0.80, 0.38, 0.28], u: 12, v: 12 },       // red brick
      { m: 'brick', c: [0.86, 0.72, 0.46], u: 12, v: 12 },       // buff brick
      { m: 'masonry', c: [0.92, 0.90, 0.84], u: 13, v: 13 },     // painted white
      { m: 'brick', c: [0.74, 0.44, 0.34], u: 12, v: 12 },       // terracotta
      { m: 'masonry', c: [0.52, 0.62, 0.58], u: 13, v: 13 },     // painted-over green
      { m: 'glass', c: [0.56, 0.60, 0.64], u: 14, v: 13.6 },     // dark modern
    ];
    const wOld = [0.20, 0.04, 0.26, 0.16, 0.16, 0.10, 0.05, 0.03];
    const wNew = [0.22, 0.30, 0.08, 0.06, 0.08, 0.04, 0.02, 0.20];
    let acc = 0;
    for (let i = 0; i < FAMS.length; i++) {
      acc += wOld[i] + (wNew[i] - wOld[i]) * modern;
      if (pick <= acc) return FAMS[i];
    }
    return FAMS[0];
  }

  meshBuilding(bl, flat, glow, bd) {
    const seed = bd.seed;
    let target, col, uS = 14, vS = 13.6;
    const fam = (bd.style === 'tower' || bd.style === 'midrise'
      || bd.style === 'brick' || bd.style === 'lowrise')
      ? this.buildingFamily(bd) : null;
    if (fam) {
      target = fam.m === 'glass' ? bl.glass : fam.m === 'brick' ? bl.brick : bl.masonry;
      // Jitter stays INSIDE the family, so a brick street varies in weathering
      // rather than becoming a different material every other lot.
      col = tint(seed, fam.c, 0.26);
      uS = fam.u;
      // Snap the vertical repeat so a whole number of tiles spans the wall.
      // Each tile is four window rows; at an arbitrary vScale the top row is
      // sliced through by the parapet on every building in the city.
      vS = bd.h / Math.max(1, Math.round(bd.h / fam.v));
    } else if (bd.style === 'industrial') {
      target = bl.industrial; col = tint(seed, [0.84, 0.86, 0.86], 0.3); uS = 16; vS = 16;
    } else {
      target = bl.house; col = tint(seed, [0.94, 0.92, 0.88], 0.36); uS = 0; vS = 0;
    }

    if (bd.kind) return this.meshLandmarkTower(bl, flat, bd, col);

    const base = bd.y - 2;
    const cs = Math.cos(bd.rot), sn = Math.sin(bd.rot);
    const off = (lx, lz) => [bd.x + lx * cs - lz * sn, bd.z + lx * sn + lz * cs];

    if (bd.style === 'house') {
      const wallH = bd.h * 0.72;
      target.box(bd.x, base, bd.z, bd.w, wallH + 2, bd.d, bd.rot, col, { top: false, uScale: 0, vScale: 0, ao: 0.3 });
      // Roofs were a flat near-black polygon that can fill a third of a frame
      // with no material at all. Route them through the industrial builder so
      // they take a texture, and lift them off black.
      const rc = tint(seed, [0.46, 0.43, 0.41], 0.16);
      bl.industrial.box(bd.x, base + wallH + 2, bd.z, bd.w + 0.7, 0.26, bd.d + 0.7, bd.rot, rc,
        { uScale: 5, vScale: 5 });
      // A gable that fits the house it sits on.
      //
      // This used to be `cone(..., max(w, d) * 0.74, ..., 4, ...)` -- a square
      // pyramid sized off the LONGER side, and `cone()` takes no rotation, so
      // it stayed axis-aligned in world space while the house was turned by
      // bd.rot. On a 6 x 14 m house that is a 10 m roof, square, at the wrong
      // angle: the overhang misses the walls entirely on the narrow axis, which
      // is why roofs looked detached and randomly oriented.
      // Gable stays on `flat`: Builder.tri takes no UVs, so a textured builder
      // would sample one texel across the whole slope. Its believability comes
      // from the two slopes shading differently against the key light instead.
      this.meshGable(flat, bd, base + wallH + 2.26, rc, seed);
      const [sx, sz] = off(0, bd.d / 2 + 0.5);
      flat.box(sx, base + 1.6, sz, 2.0, 0.22, 1.2, bd.rot, [0.62, 0.6, 0.57]);
      return;
    }

    // Roof clutter. The top face is the most-seen surface of a low building
    // from any elevated view, and a bare extrusion cap is the loudest tell that
    // this is untextured programmer geometry. A handful of boxes per roof is
    // within budget because they merge into the chunk's existing flat mesh.
    if (bd.h < 70 && bd.w > 9 && bd.d > 9) {
      const rt = base + bd.h + 2;
      // Roofs vary per building. One flat grey across a whole downtown reads
      // as untextured cap geometry from every elevated view, which is the
      // angle roofs are actually seen from.
      // Tar-and-gravel is about 0.22 albedo, not 0.05, and a roof is the
      // largest surface in any elevated view. At the old values the whole
      // near-field went near-black from above while the fogged far skyline
      // stayed bright, so the city read inside-out: the closest thing in the
      // frame was the darkest. Roofs are a light-to-mid grey with real spread.
      const rv = 0.42 + hash2(seed, 91) * 0.16;
      const rc2 = [rv, rv * 1.01, rv * 1.05];
      const n = 1 + Math.floor(hash2(seed, 51) * 3);
      for (let i = 0; i < n; i++) {
        const ux = (hash2(seed, 52 + i) - 0.5) * (bd.w - 6);
        const uz = (hash2(seed, 61 + i) - 0.5) * (bd.d - 6);
        const [gx, gz] = off(ux, uz);
        const bw2 = 1.4 + hash2(seed, 71 + i) * 2.2;
        const bh2 = 0.9 + hash2(seed, 81 + i) * 1.5;
        flat.box(gx, rt, gz, bw2, bh2, bw2 * 0.8, bd.rot, rc2);
      }
      // Roof kit. A correctly-exposed roof is still a blank lid, and roofs are
      // in shot from every elevated view in the game. A stair bulkhead, a vent
      // cluster and a tank are what a real roof carries, and they cost a
      // handful of boxes that merge into the chunk's existing flat mesh.
      const dk = [rv * 0.74, rv * 0.75, rv * 0.78];
      if (bd.w > 13 && bd.d > 13) {
        // stair bulkhead -- the one thing on a roof with a door in it
        const [sx2, sz2] = off(bd.w * 0.24, -bd.d * 0.22);
        flat.box(sx2, rt, sz2, 3.0, 2.6, 2.4, bd.rot, dk);
        flat.box(sx2, rt + 2.6, sz2, 3.3, 0.2, 2.7, bd.rot, rc2);
      }
      // vent stacks
      const vn = 2 + Math.floor(hash2(seed, 93) * 3);
      for (let i = 0; i < vn; i++) {
        const [vx, vz] = off((hash2(seed, 94 + i) - 0.5) * (bd.w - 3),
          (hash2(seed, 97 + i) - 0.5) * (bd.d - 3));
        flat.prism(vx, rt, vz, 0.16, 0.7 + hash2(seed, 99 + i) * 0.8, 6, dk);
      }
      // water tank, on a minority of mid-rises
      if (bd.h > 16 && hash2(seed, 88) > 0.82) {
        const [tx2, tz2] = off(-bd.w * 0.2, bd.d * 0.18);
        for (const lg of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          flat.box(tx2 + lg[0] * 1.1, rt, tz2 + lg[1] * 1.1, 0.18, 1.8, 0.18, bd.rot, dk);
        }
        flat.prism(tx2, rt + 1.8, tz2, 1.5, 2.4, 8, [0.42, 0.34, 0.27]);
        flat.cone(tx2, rt + 4.2, tz2, 1.55, 0.7, 8, [0.36, 0.29, 0.23]);
      }
      // parapet lip, so the roof edge has a silhouette rather than a clean cut
      flat.box(bd.x, rt, bd.z, bd.w + 0.5, 0.85, bd.d + 0.5, bd.rot,
        [rv * 1.2, rv * 1.2, rv * 1.17]);
      // The lid itself, on a textured builder. A roof is seen from every
      // elevated view in the game and it was one flat untextured colour.
      bl.industrial.box(bd.x, rt - 0.12, bd.z, bd.w + 0.2, 0.14, bd.d + 0.2, bd.rot,
        [rv * 0.92, rv * 0.93, rv * 0.96], { uScale: 7, vScale: 7 });
    }

    const dense = bd.style !== 'industrial';
    const plinthH = dense ? Math.min(5.2, bd.h * 0.3) : 0;
    let y = base;
    let remaining = bd.h + 2;

    if (plinthH > 2) {
      // Ground-floor storefront.
      //
      // This is the most-looked-at surface in the game -- it wraps every
      // commercial building at exactly eye level -- and it was the curtain-wall
      // texture at uScale/vScale 9. The glass tile carries eight panes each
      // way, so nine metres per tile made them 1.1 m across and a whole storey
      // tall stack of them fitted in the plinth: every shopfront in the city
      // read as a band of blue fish scales.
      //
      // A shopfront is ONE row of tall panes. Pick the scales so exactly that
      // lands in the plinth: 8 panes over 18 m is a 2.25 m bay, and a vScale of
      // 8x the plinth height puts the plinth on row 0 -- full-height glazing
      // with the spandrel above it, which is what a shopfront is.
      const sc = [col[0] * 0.74, col[1] * 0.78, col[2] * 0.84];
      bl.glass.box(bd.x, y, bd.z, bd.w + 0.3, plinthH, bd.d + 0.3, bd.rot, sc,
        { uScale: 18, vScale: plinthH * 8, top: false, ao: 0.5 });
      flat.box(bd.x, y + plinthH, bd.z, bd.w + 1.0, 0.5, bd.d + 1.0, bd.rot, TRIM);
      if (hash2(seed, 41) > 0.55) {
        const ac = AWNING[Math.floor(hash2(seed, 42) * AWNING.length)];
        const [ax, az] = off(0, bd.d / 2 + 0.9);
        flat.box(ax, y + plinthH - 1.4, az, bd.w * 0.62, 0.22, 1.8, bd.rot, ac);
      }
      this.meshSigns(bl.signs, flat, bd, y + plinthH, plinthH, seed, off);
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
      // cone() places its four vertices on the axes, so a 4-sided one is a
      // DIAMOND in plan -- 45 deg out from the square tower under it, and it
      // takes no rotation either. Smith Tower's cap is a real pyramid.
      this.meshPyramid(flat, bd.x, base + bd.h - 20.5, bd.z, bd.w * 0.52, bd.d * 0.52,
        20, bd.rot, [0.5, 0.56, 0.55]);
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

  /**
   * Shopfront signage.
   *
   * Signs are the largest single thing separating this from an open world of
   * the era -- there was not one anywhere in the city. Everything here hangs
   * off the shopfront band the plinth already establishes, so the fascia lands
   * exactly on top of the glazing on every building without a second set of
   * measurements to keep in sync.
   *
   * UVs index a 4 x 4 atlas cell, so sixteen designs cost one draw call for the
   * whole chunk. Quads rather than boxes: a fascia is seen from the front and
   * from below, and the two faces it would gain are two faces of overdraw on
   * every commercial building in the map.
   */
  meshSigns(sg, flat, bd, topY, plinthH, seed, off) {
    if (bd.w < 6 && bd.d < 6) return;
    const N = 4, C = 1 / N;
    const cell = (k) => {
      const i = Math.floor(hash2(seed, k) * 16);
      return [(i % N) * C, Math.floor(i / N) * C];
    };
    // Everything is expressed in the building's OWN frame and pushed through
    // `off`, which is the one rotation the rest of this function already
    // trusts. Writing the face normals out by hand got the sign of the x term
    // wrong and buried every sign inside its own building on any lot that was
    // not axis-aligned -- which, with real OSM footprints, is nearly all of
    // them.
    const dirOf = (lx, lz) => {
      const [wx, wz] = off(lx, lz);
      return [wx - bd.x, 0, wz - bd.z];
    };
    const fh = Math.min(1.25, plinthH * 0.3);
    const faces = [
      { half: bd.d / 2, span: bd.w, out: [0, 1], along: [1, 0] },
      { half: bd.w / 2, span: bd.d, out: [1, 0], along: [0, 1] },
    ];
    for (let f = 0; f < faces.length; f++) {
      const fc = faces[f];
      // Two faces of a corner lot front a street; one of a mid-block lot does.
      // Signing every face of every building makes the city a retail park.
      if (f === 1 && hash2(seed, 200) > 0.55) continue;
      if (fc.span < 5) continue;
      const [u0, v0] = cell(201 + f * 7);
      const nrm = dirOf(fc.out[0], fc.out[1]);
      const halfW = fc.span * 0.38;
      // Stand a little proud of the plinth, which is itself 0.15 m wider than
      // the wall, so the plate catches its own edge light.
      const d = fc.half + 0.24;
      const pt = (t, yy) => {
        const [wx, wz] = off(fc.out[0] * d + fc.along[0] * t, fc.out[1] * d + fc.along[1] * t);
        return [wx, yy, wz];
      };
      const yTop = topY - 0.18, yBot = yTop - fh;
      sg.quad(pt(-halfW, yBot), pt(halfW, yBot), pt(halfW, yTop), pt(-halfW, yTop),
        nrm, [u0, v0, u0 + C, v0, u0 + C, v0 + C, u0, v0 + C], [1, 1, 1]);

      // Projecting blade sign: hung near one end and read from ALONG the
      // street rather than across it, which is the whole point of a blade.
      if (hash2(seed, 210 + f) > 0.62) {
        const [bu, bv] = cell(220 + f * 3);
        const bt = halfW * (hash2(seed, 230 + f) > 0.5 ? 0.72 : -0.72);
        const bladeN = dirOf(fc.along[0], fc.along[1]);
        const byTop = yTop + 0.4, byBot = byTop - 1.5;
        const q = (proj, yy) => {
          const [wx, wz] = off(fc.out[0] * (fc.half + proj) + fc.along[0] * bt,
            fc.out[1] * (fc.half + proj) + fc.along[1] * bt);
          return [wx, yy, wz];
        };
        sg.quad(q(0.05, byBot), q(1.0, byBot), q(1.0, byTop), q(0.05, byTop),
          bladeN, [bu, bv, bu + C, bv, bu + C, bv + C, bu, bv + C], [1, 1, 1]);
      }
    }

    // Rooftop billboard, on low and mid buildings only: on a tower it sits
    // 150 m up where nobody reads it, and on a house it is absurd.
    if (bd.h > 10 && bd.h < 42 && bd.w > 14 && hash2(seed, 240) > 0.72) {
      const [bu, bv] = cell(241);
      const bw = Math.min(bd.w * 0.7, 16), bh = bw * 0.42;
      const yb = bd.y - 2 + bd.h + 3.4;
      const p0 = off(-bw / 2, bd.d * 0.2), p1 = off(bw / 2, bd.d * 0.2);
      const nrm = dirOf(0, 1);
      sg.quad([p0[0], yb, p0[1]], [p1[0], yb, p1[1]],
        [p1[0], yb + bh, p1[1]], [p0[0], yb + bh, p0[1]],
        nrm, [bu, bv, bu + C, bv, bu + C, bv + C, bu, bv + C], [1, 1, 1]);
      // Legs, so it stands on the roof instead of floating over it.
      for (const lt of [-bw * 0.34, bw * 0.34]) {
        const [lx, lz] = off(lt, bd.d * 0.2);
        flat.box(lx, yb - 3.4, lz, 0.22, 3.4, 0.22, bd.rot, [0.25, 0.26, 0.28]);
      }
    }
  }

  /**
   * Is this point inside a building footprint? Shared by every scatter, since
   * "the data says this is open ground" and "there is nothing standing here"
   * are different questions and only the second one matters to a prop.
   */
  inBuilding(x, z, pad) {
    for (const b of this.city.buildingsNear(x, z, 30)) {
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.w / 2 + pad && Math.abs(lz) < b.d / 2 + pad) return true;
    }
    return false;
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
        // Offsetting sideways off THIS road can land on a different one -- a
        // ramp beside a freeway puts its lamp posts and trees on the freeway,
        // and beneath a viaduct they grow through the deck.
        if (city.onRoad(ox, oz, 0.8)) { cityStats.propsSkipped++; continue; }
        const gy = G.terrainHeight(ox, oz) + WALK_Y;
        const armRot = Math.atan2(-px * sg, -pz * sg);
        if (h < 0.42) {
          // street light: base, tapered mast, cranked arm, lit lens
          flat.box(ox, gy, oz, 0.42, 0.22, 0.42, armRot, [0.24, 0.25, 0.27]);
          flat.prism(ox, gy + 0.2, oz, 0.115, 6.4, 8, poleCol);
          this.city.addObstacle(this._ck, ox, oz, 0.35);
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
          // Same muted range as the park canopies, or a street of trees reads
          // brighter than the buildings behind them.
          const vw = 0.74 + h * 0.46;
          const g = [0.21 * vw, 0.30 * vw, 0.18 * vw];
          const gd = [g[0] * 0.64, g[1] * 0.64, g[2] * 0.70];
          // Street trees are broadleaf: a row of conifers down a city block is
          // the giveaway that one asset is doing all the work.
          this.meshCanopy(flat, ox, gy, oz, th, 1, h, g, gd);
          this.city.addObstacle(this._ck, ox, oz, 0.5);
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
      // --- small clutter ----------------------------------------------------
      //
      // The structural pass above places one item every 30-34 m, ALTERNATING
      // sides, so a given kerb gets a lamp or a tree about every 65 m and
      // nothing in between. That is an empty street: a real block carries a
      // hydrant, a bin, a meter, a mailbox and a sign between every pair of
      // lamps.
      //
      // Kept separate rather than folded into the cascade above because these
      // want a different cadence and a much smaller triangle budget -- they are
      // knee-height objects whose whole job is to interrupt the kerb line, so
      // six-sided prisms and boxes are enough. Both sides, every ~22 m.
      if (e.cls !== 'ramp') {
        const cSpace = 22;
        const cCount = Math.floor(e.len / cSpace);
        for (let i = 1; i <= cCount; i++) {
          const t = (i - 0.5) / (cCount + 1);
          const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
          const hc = hash2(Math.round(x * 7) + 3, Math.round(z * 7) + 11);
          const sg = hc < 0.5 ? 1 : -1;
          // Sit tight against the kerb, where street furniture actually goes.
          const ox = x + px * sg * (e.hw + 0.85);
          const oz = z + pz * sg * (e.hw + 0.85);
          if (!G.isBuildable(ox, oz)) continue;
          if (city.onRoad(ox, oz, 0.4)) { cityStats.propsSkipped++; continue; }
          const gy = G.terrainHeight(ox, oz) + WALK_Y;
          const rot = Math.atan2(-px * sg, -pz * sg);
          const k = hash2(Math.round(x * 13) + 5, Math.round(z * 13) + 29);
          if (k < 0.20) {
            // fire hydrant
            const hy = [0.68, 0.16, 0.12];
            flat.prism(ox, gy, oz, 0.17, 0.6, 6, hy);
            flat.prism(ox, gy + 0.6, oz, 0.12, 0.14, 6, hy);
            flat.box(ox, gy + 0.34, oz, 0.52, 0.14, 0.16, rot, hy);
          } else if (k < 0.40) {
            // litter bin
            const bc = [0.22, 0.26, 0.24];
            flat.prism(ox, gy, oz, 0.34, 0.9, 8, bc);
            flat.prism(ox, gy + 0.9, oz, 0.37, 0.09, 8, [0.14, 0.16, 0.15]);
          } else if (k < 0.58) {
            // parking meter or ticket machine
            flat.prism(ox, gy, oz, 0.06, 1.05, 6, [0.3, 0.32, 0.34]);
            flat.box(ox, gy + 1.05, oz, 0.2, 0.34, 0.16, rot, [0.36, 0.38, 0.4]);
          } else if (k < 0.72) {
            // mailbox / newspaper box
            const mc = k < 0.65 ? [0.16, 0.28, 0.44] : [0.5, 0.14, 0.14];
            flat.box(ox, gy, oz, 0.48, 0.5, 0.4, rot, [0.24, 0.25, 0.26]);
            flat.box(ox, gy + 0.5, oz, 0.56, 0.66, 0.46, rot, mc);
          } else if (k < 0.86) {
            // sign on a post -- the tallest of the clutter, so it breaks the
            // kerb line against the facades behind it
            flat.prism(ox, gy, oz, 0.045, 2.3, 5, [0.4, 0.42, 0.44]);
            flat.box(ox, gy + 2.3, oz, 0.5, 0.42, 0.05, rot, [0.72, 0.74, 0.76]);
          } else {
            // bollards, in a short run
            for (let bIdx = -1; bIdx <= 1; bIdx++) {
              const bx = ox + e.dx * bIdx * 1.4, bz = oz + e.dz * bIdx * 1.4;
              flat.prism(bx, gy, bz, 0.09, 0.85, 6, [0.3, 0.31, 0.33]);
            }
          }
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
    let treeSkip = 0;
    for (let i = 0; i < 230; i++) {
      const hx = hash2(cx * 71 + i, cz * 131 + 7);
      const hz = hash2(cx * 37 + i, cz * 53 + 13);
      const x = x0 + hx * CHUNK, z = z0 + hz * CHUNK;
      if (!G.inPark(x, z)) continue;
      // Parks are a raster of OSM greenspace and real roads run straight
      // through them -- Aurora crosses Woodland Park, Lake Washington Blvd runs
      // the length of its parks. 6.4% of sampled carriageway centres sit inside
      // the green mask, which is exactly where a tree would be planted in the
      // middle of the road. Nothing else filters this: `inPark` knows about
      // grass, not about tarmac.
      if (this.city.onRoad(x, z, 2.5)) { treeSkip++; continue; }
      // ...nor inside a building. Parks and footprints come from two different
      // OSM layers and they overlap: greenspace is mapped right up to and over
      // the museum, pavilion or house standing in it, so `inPark` happily says
      // yes in the middle of a building. Measured, 9.3 % of surviving park
      // candidates stood inside a footprint -- trees growing through roofs.
      if (this.inBuilding(x, z, 0.8)) { treeSkip++; continue; }
      const h = hash2(Math.round(x), Math.round(z));
      const gy = G.terrainHeight(x, z);
      // Foliage that isn't one emerald cone.
      //
      // A single saturated green was the most out-of-gamut thing in every frame
      // -- once the rest of the palette was pulled toward grey it stopped
      // reading as a tree and started reading as a marker. Real canopies are
      // desaturated, vary between individuals, and are darker underneath than
      // on top. Three silhouettes keep a stand from looking stamped.
      const h2 = hash2(Math.round(x * 3), Math.round(z * 3));
      const th = 6 + h * 8;
      const kind = h2 < 0.42 ? 0 : h2 < 0.78 ? 1 : 2;   // conifer, broadleaf, scrub
      flat.prism(x, gy, z, 0.28 + h * 0.18, th * (kind === 1 ? 0.52 : 0.4), 6, trunk);
      // Hue drifts a little yellow-to-blue between individuals; value does most
      // of the work, exactly as with the building palette.
      const warm = (h2 - 0.5) * 0.06;
      const v = 0.72 + h * 0.5;
      const g = [(0.20 + warm) * v, (0.29 + h * 0.05) * v, (0.17 - warm * 0.5) * v];
      const gd = [g[0] * 0.62, g[1] * 0.62, g[2] * 0.68];
      this.meshCanopy(flat, x, gy, z, th, kind, h, g, gd);
      // A tree is solid. Radius is the trunk, not the canopy: you walk and
      // drive under a canopy, and blocking its full spread would make a park
      // impassable.
      this.city.addObstacle(this._ck, x, z, 0.45 + h * 0.25);
    }
    cityStats.treesSkipped += treeSkip;
  }

  /**
   * One tree crown. Shared by park scatter and street trees so the two can't
   * drift apart -- a street of one species beside a park of another was how the
   * old duplicated code read.
   *
   * `prism` is open at both ends: a squashed one seen from eye level is a
   * single band of vertical wall with no top and no bottom, which is why the
   * broadleaf canopy rendered as a flat green slab on a stick. Crowns are
   * closed spheroids now.
   */
  meshCanopy(flat, x, gy, z, th, kind, h, g, gd) {
    if (kind === 0) {
      // Conifer: a stack of narrowing cones, widest and darkest at the bottom.
      flat.cone(x, gy + th * 0.26, z, 1.9 + h * 1.6, th * 0.40, 7, gd);
      flat.cone(x, gy + th * 0.48, z, 1.55 + h * 1.3, th * 0.40, 7, g);
      flat.cone(x, gy + th * 0.70, z, 1.05 + h * 0.95, th * 0.40, 6, g);
    } else if (kind === 1) {
      // Broadleaf: three overlapping lobes, the lower one wider and in shade,
      // so the crown has a lumpy silhouette rather than one clean ball.
      const cr = 2.1 + h * 1.8;
      flat.spheroid(x, gy + th * 0.62, z, cr, 7, 3, gd, 0.74, 0.26);
      flat.spheroid(x + cr * 0.3, gy + th * 0.8, z - cr * 0.2, cr * 0.66, 6, 3, g, 0.88, 0.3);
    } else {
      // Scrub: low, wide and squat.
      const cr = 1.5 + h * 1.1;
      flat.spheroid(x, gy + th * 0.36, z, cr, 6, 3, gd, 0.7, 0.34);
    }
  }
}
