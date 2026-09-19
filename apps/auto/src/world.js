// Scene construction: sky + image-based lighting, terrain, water, streamed city
// chunks, distant skyline and the hand-built landmarks.

import * as THREE from './three.js';
import * as G from './geo.js';

// Kept in step with main.js. Shadow-caster policy differs by platform, and the
// difference is worth roughly 40 draw calls a frame.
const ON_PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
import { CHUNK, ROAD_LIFT, NODE_LIFT, WALK_LIFT, TUNNEL_H, cityStats } from './citygen.js';
import { Builder } from './build.js';
import { hash2, clamp, lerp, distToSeg } from './util.js';

// The bore's cross-section, shared by the mesher and by the trench that has to
// be cut out of the ground to make room for it.
const TUN_WALL = TUNNEL_H, TUN_DECK = 0.3;
// How far past the carriageway the trench is cut. The retaining wall stands on
// this line, so it is also the width of the hole in the terrain.
const CUT_SH = 1.2;
// How far PAST the wall line the trench keeps its full depth before the bank
// starts. THIS MUST BE AT LEAST ONE TERRAIN PATCH QUAD (patchCell's 4 m): the
// patch samples terrainHeight on a fixed grid, so a quad that reaches from in
// front of the wall plane onto the bank draws a diagonal earth face jutting
// into the trench, in front of the concrete. With the bank starting ON the
// wall line those faces stood up to 2.9 m proud -- measured sand ridges
// running the length of every cutting, which is most of what "raw earth at
// the mouth" was. At 2.0 (half a quad) they still stood 0.5-2.2 m proud at 94
// of 3260 lattice points: partway is not enough, because a quad crossing the
// wall can still have its back corner partway up the bank. At one full quad,
// any quad crossing the wall plane has BOTH corners on the floor, so the
// whole rise happens behind concrete -- by construction, not by tuning.
const CUT_OVER = 4.0;
// How far the bank takes to climb from the trench floor back to true ground.
// Steep enough to read as an excavation, wide enough that the 5 m patch can
// actually resolve the slope.
// A FINISHED CUTTING, NOT AN EXCAVATION. Wide earth banks read as a building
// site: a real portal approach is walled. The bank is only the thin bevel
// between the top of the retaining wall and the pavement above it -- the wall
// does the work of holding the ground back.
const CUT_BANK = 2.4;
// How much ground must lie over the roof before the bore counts as buried and
// the trench ends. At 0.4 m the headwall stood in a cut barely deeper than the
// bore is tall, so the portal was a metre of concrete 60 m away and read as
// nothing. 3.5 m of cover puts the face at the bottom of a ~9 m cutting, which
// is what makes it a portal rather than a kerb.
const CUT_COVER = 3.5;
// How far in front of a portal the approach ramp runs. Long enough that the
// descent is gentle at the drop citygen applies, short enough that it does not
// swallow the junction behind it.
const APPROACH = 70;

const ROAD_Y = ROAD_LIFT;
// Metres per road-texture repeat. Fixed, so the asphalt's grain is the same
// size on an alley and on a freeway.
/**
 * The tiers a tall building steps back through.
 *
 * Shared by the near chunk mesh and the far skyline mesh, because they were
 * modelling the same building differently and each poked through the other. The
 * near mesh stepped back at 62 % of the height; the far mesh at 80-90 %. Between
 * those the far version was WIDER, so it stood proud of the textured geometry
 * all the way round -- and the far mesh has no map, so every tall building in
 * downtown wore a blank pale slab across its upper third. Measured by raycast,
 * the far mesh was the frontmost surface at 235-353 m, well inside the 800 m
 * near radius where it has no business being visible at all.
 *
 * One profile, two consumers. They cannot drift again.
 */
function* buildingTiers(bd, baseY, totalH) {
  const n = bd.h > 100 ? 3 : bd.h > 55 ? 2 : 1;
  let y = baseY, remaining = totalH, w = bd.w, d = bd.d;
  for (let t = 0; t < n; t++) {
    const frac = t === n - 1 ? 1 : t === 0 ? 0.62 : 0.6;
    const h = remaining * frac;
    yield { t, last: t === n - 1, y, h, w, d };
    y += h;
    remaining -= h;
    if (t < n - 1) { y += 0.55; w *= 0.78; d *= 0.78; }
  }
}

const ROAD_TILE = 9;
// Metres per repeat of the paving texture, which carries four slabs -- so a
// slab is a metre, everywhere.
//
// The pavement used to tile at its OWN WIDTH: 2.6 m on a residential street and
// 3.2 m on an arterial, so slabs were 65 cm on one and 80 cm on the other and
// the size visibly changed wherever the two met. The junction ring was worse --
// it emitted a full 0..1 tile per piece regardless of how big the piece was, so
// corner slabs were whatever size that corner happened to be. The asphalt was
// given a fixed tile long ago for exactly this reason; the pavement never was.
const WALK_TILE = 4;

// Massing-box wall tints by building style; see the massing branch in
// buildChunkStep. Module scope alongside the other style tables.
const MASS_TINT = {
  house: [0.66, 0.61, 0.54], brick: [0.55, 0.42, 0.36],
  lowrise: [0.58, 0.58, 0.60], midrise: [0.56, 0.57, 0.60],
  industrial: [0.50, 0.52, 0.55], campus: [0.58, 0.55, 0.50],
  tower: [0.52, 0.55, 0.60],
};
// Paint sits just proud of the asphalt; any less and it z-fights at distance.
const MARK_Y = ROAD_LIFT + 0.012;
const LOT_PLAZA = G.LOT_KINDS.indexOf('plaza');
// `flat` has no map, but Builder.quad indexes the uv array unconditionally.
const ZERO_UV = [0, 0, 0, 0, 0, 0, 0, 0];
const NODE_Y = NODE_LIFT;
const WALK_Y = WALK_LIFT;

const NEAR_R = 2; // chunks of full detail around the player
const MID_R = 4; // chunks that keep roads only
// Far massing supertiles are built and drawn inside this radius of the player.
// Past ~5 km the haze has taken them (83 % fog at 4 km, 94 % at 5 km from
// 200 m up); the extra is half a supertile's diagonal, since it tests centres.
// A 6 km cap cost ~300k more triangles a flying frame, drawn nearly in fog colour.
const FAR_R = 5000 + 1150;

// Ground tints, and the taps used to soften a district's edge into them.
const GRASS = [0.42, 0.62, 0.28];
// SUBURB used to be [0.48, 0.60, 0.37], which is the same colour as GRASS to
// within a rounding error -- so ground that had blended all the way to "fully
// developed" still rendered as a bright meadow, and the I-5 trench through
// Chinatown looked like a lawn. Developed ground is lawn AND roof AND tarmac
// mixed together, so it has to be visibly more muted than grass or the blend
// has nothing to say.
// ...and [0.52, 0.53, 0.41] then overshot into khaki: after ACES and the
// grade's saturation payback it rendered as a dirt lot under every street-level
// shot. Developed ground is worn lawn more than bare earth, so it keeps GRASS's
// hue at a much lower chroma -- still clearly not a meadow.
const SUBURB = [0.47, 0.53, 0.38];
const URBAN = [0.56, 0.56, 0.55];
const BLEND_TAPS = [[0, 0], [-85, 55], [70, -75]];

/**
 * Smooth value noise on a 210 m lattice, in [0,1].
 *
 * Only used to push the district lookup off its own straight edges, so it wants
 * to be continuous and cheap rather than good: `hash2` alone is per-cell random
 * and turns a boundary into static instead of a curve.
 */
/** Unsigned area of a plan polygon [[x, z], ...] (shoelace). */
function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const A = p[i], B = p[(i + 1) % p.length];
    s += A[0] * B[1] - B[0] * A[1];
  }
  return Math.abs(s) / 2;
}

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

/**
 * The one wall material.
 *
 * Each family's old parameters are already folded into the atlas, so what is
 * left here is the maxima they were folded against: `roughness` and `metalness`
 * multiply their own channels, `normalScale` multiplies the pre-scaled xy, and
 * `envMapIntensity` is recovered per-texel through the AO channel -- three's AO
 * term attenuates the image-based light, which is the only thing env drove.
 * `aoMap.channel` is pinned to 0 because AO is the one slot three historically
 * read from a SECOND uv set, and there isn't one here: a wall sampling AO at a
 * missing uv1 comes back uniformly dark over the whole city.
 */
function facadeMat(f) {
  const m = new THREE.MeshStandardMaterial({
    map: f.map,
    normalMap: f.normalMap,
    roughnessMap: f.packed,
    metalnessMap: f.packed,
    aoMap: f.packed,
    emissiveMap: f.emissiveMap,
    vertexColors: true,
    roughness: 1,
    metalness: f.metalMax,
    envMapIntensity: f.envMax,
  });
  f.packed.channel = 0;
  m.emissive = new THREE.Color(0xffffff);
  m.emissiveIntensity = f.emiMax;
  m.normalScale = new THREE.Vector2(f.nsMax, f.nsMax);
  // Per-window variety, in the shader, for the stone and brick cells.
  //
  // The atlas cell carries sixteen windows, so every masonry facade in the
  // city repeated the same sixteen: the same blind half-down in the same spot
  // every four storeys on every building, which is what made a block read as
  // wallpaper from across the street. Each window now picks its own state
  // from a hash of its column, its row (V spans the whole wall, so every
  // storey is different) and the building's tint: a dark room, drawn blinds,
  // or a colder reflective pane.
  //
  // The window mask is the packed map's roughness channel -- glazing is the
  // only thing in those cells under ~0.3 -- so no second map is needed. One
  // extra tap per facade fragment; plain uniforms, no new render targets.
  const [u0, du] = f.cells.masonry;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.facU0 = { value: u0 };
    sh.uniforms.facDu = { value: du };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float facU0;\nuniform float facDu;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // Cell index: 0 = masonry, 1 = brick. CELL_W / FS = 528 / 512.
          float facU = vMapUv.x - facU0;
          float facCell = floor(facU / (facDu * 1.03125) + 0.02);
          float facGlass = 1.0 - smoothstep(0.16, 0.36, texture2D(roughnessMap, vRoughnessMapUv).g);
          if (facCell < 1.5 && facGlass > 0.01) {
            vec2 wid = vec2(floor(facU / (facDu * 0.25)), floor(vMapUv.y * 4.0));
            // Per-building seed from the tint's channel RATIOS, not its value.
            // Box's baked AO scales the tint toward the ground, so the value
            // changes continuously up the wall -- hashing it through sin()
            // re-rolled every window per pixel into blue static. A uniform
            // scale leaves the ratios constant under interpolation.
            float bseed = floor(vColor.r / max(vColor.g, 0.01) * 64.0)
              + floor(vColor.b / max(vColor.g, 0.01) * 64.0) * 7.0;
            float hsh = fract(sin(dot(wid, vec2(12.9898, 78.233)) + bseed * 3.17) * 43758.5453);
            vec3 winMul = hsh < 0.24 ? vec3(0.38, 0.41, 0.46)
              : hsh < 0.36 ? vec3(1.22, 1.16, 1.02)
              : hsh < 0.54 ? vec3(0.78, 0.9, 1.1)
              : vec3(1.0);
            // A NEUTRAL pane. A metal's F0 is its albedo, so the building tint
            // mirrored the sky in red on brick, and the pane's own baked blue
            // doubled the sky's blue into saturated static. Grey glass
            // reflecting a blue sky is what reads as glass.
            float paneL = dot(diffuseColor.rgb / max(vColor.rgb, vec3(0.2)), vec3(0.299, 0.587, 0.114));
            vec3 pane = mix(vec3(paneL), vec3(0.46, 0.49, 0.53), 0.55);
            diffuseColor.rgb = mix(diffuseColor.rgb, pane * winMul, facGlass);
          }
        }`)
      // ...and a FLAT one. The cell's height noise is fine for masonry grain,
      // but reflected through a mirror it scattered the sky into glitter.
      // roughnessFactor is the packed G channel by now, so no extra tap.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float facCellN = floor((vMapUv.x - facU0) / (facDu * 1.03125) + 0.02);
          float facGlassN = facCellN < 1.5 ? 1.0 - smoothstep(0.16, 0.36, roughnessFactor) : 0.0;
          normal = normalize(mix(normal, normalize(vNormal), facGlassN));
        }`);
  };
  m.customProgramCacheKey = () => 'facadeWindows';
  return m;
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

// Ground at or below this reads as wet even where the water mask says dry:
// the 40 m DEM blends land into sea at the shoreline, so the two rasters
// disagree by about a metre there. Exported so tools/jank.mjs can select the
// same candidate set -- the constant is shared, the VERDICT is not, which is
// what keeps the check from being a tautology.
export const WET_FLOOR = 0.35;

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
      // Glass was the one material already sitting at clamp. env 1.9 on a
      // 0.9-albedo curtain wall survived the old ambient floor and saturates
      // through ACES once the scene moves up the curve -- hard-edged white
      // polygon faces that read as a missing texture, not as sunlight. Pulling
      // it down is what makes the exposure headroom available.
      // Curtain wall reads by what it REFLECTS. With the IBL now drawn from
      // the same sky as the dome, glass takes more of its look from the
      // environment and less from its own blue albedo: metalness up and env up.
      glass: surf(tx.glass, { env: 1.15, metalness: 0.58, roughness: 0.22, ns: 1.1, emissive: 0.02 }),
      // Stone, brick, corrugated industrial, lap-sided house and shop signage,
      // in one material. They were five, and five merged meshes per chunk was
      // 115 draw calls downtown for 25k triangles. Everything that used to
      // differ between them now rides in the maps -- see `facadeAtlas` in
      // textures.js -- so the surfaces themselves are untouched: brick still
      // has its own running bond, not a tint of the ashlar.
      facade: facadeMat(tx.facade),
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
    // Curtain wall is not one mirror. Each pane sits a fraction of a degree off
    // its neighbours, which is why a real glass tower reflects the sky as a
    // patchwork rather than as one smooth gradient. A per-pane hash tilts the
    // normal by up to ~2 deg; the glass tile is eight panes each way, so
    // floor(uv * 8) is the pane. Arithmetic only, no extra taps.
    //
    // And a curtain wall reflects the SKY. A vertical mirror seen from above
    // or level reflects downward, into the IBL's ground half, so every glass
    // tower in the aerial read as dark blue paint. Folding the reflected ray
    // into the upper hemisphere is the standard open-world cheat for towers:
    // they show sky and cloud, which is most of what reads as "glass" at any
    // distance. Glass material only; three's own chunk, one line added.
    const IBL_FROM = 'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );';
    this.mats.glass.onBeforeCompile = (sh) => {
      if (THREE.ShaderChunk.envmap_physical_pars_fragment.includes(IBL_FROM)) {
        sh.fragmentShader = sh.fragmentShader.replace('#include <envmap_physical_pars_fragment>',
          THREE.ShaderChunk.envmap_physical_pars_fragment.replace(IBL_FROM,
            `${IBL_FROM}\n\t\t\treflectVec = normalize( vec3( reflectVec.x, abs( reflectVec.y ) * 0.85 + 0.12, reflectVec.z ) );`));
      }
      // Neutral panes, for the same reason as the masonry windows: metal F0 is
      // the albedo, and a blue pane reflecting a blue sky is saturated paint.
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        {
          float paneA = 1.0 - smoothstep(0.1, 0.3, texture2D(roughnessMap, vRoughnessMapUv).g);
          float lumA = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lumA) * vec3(0.94, 1.0, 1.07), paneA * 0.7);
        }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // flat pane (roughnessFactor = 0.22 x map: panes ~0.015, mullions ~0.16)
          normal = normalize(mix(normal, normalize(vNormal), 1.0 - smoothstep(0.03, 0.08, roughnessFactor)));
          vec2 paneId = floor(vMapUv * 8.0);
          float pr1 = fract(sin(dot(paneId, vec2(12.9898, 78.233))) * 43758.5453);
          float pr2 = fract(sin(dot(paneId, vec2(39.3468, 11.135))) * 24634.6345);
          normal = normalize(normal + vec3(pr1 - 0.5, pr2 - 0.5, 0.0) * 0.07);
        }`);
    };
    this.mats.glass.customProgramCacheKey = () => 'glassPanes';
    // [u0, du] per wall family in the facade atlas, passed to Builder.box.
    this.cells = tx.facade.cells;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  // --- static scenery -------------------------------------------------------

  /** Sky doubles as the background and as the diffuse+specular IBL source. */
  buildSky(sunDir) {
    // The equirect stays as the IBL source below; what you LOOK at is a dome.
    //
    // As a background the equirect is 2048 px for 360 deg, so a 62 deg view
    // magnifies it 3.6x: painted cloud ellipses smeared into brush strokes and
    // the sky never looked sharper than a thumbnail. The dome computes the
    // gradient and sun per pixel and projects a tiling cloud field onto a flat
    // layer, so clouds foreshorten toward the horizon and stay crisp overhead.
    // It replaces the background's own draw -- one call either way -- and
    // costs three texture taps per sky pixel.
    //
    // NOT tone-mapped, to match what it replaces: three leaves an sRGB
    // background texture out of the ACES pass, so the old sky's authored
    // colours ARE the screen colours, and the fog colour was tuned against
    // them. The stops below are those same colours.
    this.scene.background = null;
    const lin = (hex) => new THREE.Color(hex);
    const sd = (sunDir || new THREE.Vector3(-215, 200, -150)).clone().normalize();
    const uniforms = {
      tCloud: { value: this.tx.clouds },
      sunDir: { value: sd },
      zenith: { value: lin(0x2d5e97) },
      mid: { value: lin(0x6793c0) },
      horizon: { value: lin(0xb9cbd9) },
      haze: { value: lin(0xb9c3cf) },
      sunCol: { value: lin(0xfff2dc) },
      cloudLit: { value: lin(0xf7f5ee) },
      cloudDark: { value: lin(0x8e9aa8) },
      // Below the horizon the IBL sees the city, not haze: the old equirect's
      // lower half ran #8b979f to #5a6469, and every material's shaded side
      // was tuned against that bounce. The dome itself never draws it.
      groundHi: { value: lin(0x8b979f) },
      groundLo: { value: lin(0x5a6469) },
      // The painted equirect carried an ~80 % white cloud wash over its whole
      // upper half, and every shaded value in the city was tuned against that
      // brighter dome. Rendering the IBL from the clear blue sky dropped the
      // beauty set's shadowed quartile by ~25 % (values.py: street 0.035 ->
      // 0.023). The IBL pass alone is lifted to put that ambient back; what you
      // see in the sky is untouched.
      iblGain: { value: 1.35 },
      time: { value: 0 },
    };
    // ONE sky function for what you see and for what things reflect.
    //
    // The IBL used to be the painted equirect while the background became this
    // dome, so glass and water reflected smeared ellipse clouds and a sun in a
    // different place from the sky above them. The same code now renders both.
    const SKY_FN = `
        uniform sampler2D tCloud;
        uniform vec3 sunDir, zenith, mid, horizon, haze, sunCol, cloudLit, cloudDark, groundHi, groundLo;
        uniform float time, iblGain;
        vec3 skyColor(vec3 d, float forIbl) {
          float h = d.y;
          float e = max(h, 0.0);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.28, e));
          col = mix(col, zenith, smoothstep(0.25, 1.0, e));
          float mu = max(dot(d, sunDir), 0.0);
          // Forward-scattering glow around the sun, then the disc.
          col += sunCol * (pow(mu, 6.0) * 0.16 + pow(mu, 60.0) * 0.35);
          col = mix(col, vec3(1.0, 0.99, 0.95) * 1.4, smoothstep(0.9993, 0.9997, mu));

          // Cloud layer: a flat plane overhead, so the tile foreshortens
          // toward the horizon. +0.08 keeps the projection finite at h = 0.
          if (h > 0.0) {
            vec2 uv = d.xz / (h + 0.08) * 0.19 + vec2(time * 0.0009, time * 0.0004);
            float big = texture2D(tCloud, uv).r;
            float fine = texture2D(tCloud, uv * 3.1 + 0.37).r;
            float dens = big * 0.78 + fine * 0.22;
            float cover = smoothstep(0.50, 0.74, dens);
            // Denser toward the sun means more cloud in front of the light:
            // the far side of a bank is the lit one.
            float toward = texture2D(tCloud, uv + sunDir.xz * 0.012).r * 0.78 + fine * 0.22;
            float lit = clamp(0.62 + (dens - toward) * 7.0 - (dens - 0.62) * 0.9, 0.0, 1.0);
            vec3 cc = mix(cloudDark, cloudLit, lit);
            cc += sunCol * pow(mu, 12.0) * 0.25 * (1.0 - cover);
            // Thin toward the horizon, where the layer is seen through haze.
            cover *= smoothstep(0.015, 0.22, h);
            col = mix(col, cc, cover * 0.92);
          }
          // Horizon haze band, matched to scene.fog so distance resolves into
          // the sky instead of meeting it at a seam; below the horizon it is
          // the fog colour outright.
          col = mix(col, haze, (1.0 - smoothstep(0.0, 0.07, abs(h))) * 0.55);
          if (h < 0.0) {
            col = mix(col, haze, smoothstep(0.0, 0.05, -h));
            vec3 ground = mix(groundHi, groundLo, smoothstep(0.0, 0.6, -h));
            col = mix(col, ground, forIbl * smoothstep(0.0, 0.08, -h));
          }
          return col;
        }`;
    const skyMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          // Rotation only: the dome is infinitely far, wherever the camera is.
          vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
          gl_Position = vec4(p.xy, p.w, p.w);
        }`,
      fragmentShader: `${SKY_FN}
        varying vec3 vDir;
        void main() {
          gl_FragColor = vec4(skyColor(normalize(vDir), 0.0), 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat);
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    this.scene.add(dome);
    this.skyDome = dome;

    // Render the same sky into an 8-bit equirect for the IBL.
    //
    // 8-bit sRGB target, like every target here: the half-float rule holds,
    // and the sRGB encoding keeps the dark ground half from banding. Inverse of
    // three's equirectUv(): u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5.
    // The disc (1.4) clips at 1.0 here, as the painted one did.
    const envTarget = new THREE.WebGLRenderTarget(2048, 1024, {
      type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    envTarget.texture.colorSpace = THREE.SRGBColorSpace;
    envTarget.texture.generateMipmaps = false;
    envTarget.texture.mapping = THREE.EquirectangularReflectionMapping;
    if (this.renderer) {
      const eqMat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `${SKY_FN}
          varying vec2 vUv;
          void main() {
            float lon = (vUv.x - 0.5) * 6.28318531;
            float lat = (vUv.y - 0.5) * 3.14159265;
            vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
            vec3 c = skyColor(d, 1.0);
            // Lift the sky half only; the ground ramp is the old bounce as-is.
            gl_FragColor = vec4(c * (d.y > 0.0 ? iblGain : 1.0), 1.0);
          }`,
        depthTest: false, depthWrite: false, toneMapped: false,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), eqMat);
      quad.frustumCulled = false;
      const eqScene = new THREE.Scene();
      eqScene.add(quad);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(envTarget);
      this.renderer.render(eqScene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
      this.renderer.setRenderTarget(prev);
      quad.geometry.dispose();
      eqMat.dispose();
    }
    this.envEquirect = envTarget;

    // PMREMGenerator allocates HalfFloatType targets internally, hard-coded,
    // with no capability check -- and half-float is the one thing this renderer
    // can't take on trust (silent black on iOS, which is why postfx.js is 8-bit
    // throughout). Since the analytic lights are only a key and a fill, a dead
    // environment map means a dead scene, so probe before relying on it.
    if (halfFloatRenders(this.renderer)) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      this.envRT = pmrem.fromEquirectangular(envTarget.texture);
      this.scene.environment = this.envRT.texture;
      this.envPrefiltered = true;
      pmrem.dispose();
    } else {
      // Raw equirect as the env map: no prefiltered roughness mips, so rough
      // surfaces reflect too sharply, but the city stays lit.
      this.scene.environment = envTarget.texture;
      this.envPrefiltered = false;
    }
  }

  *buildTerrain() {
    // Before a single terrain vertex is generated: the portal trenches become
    // part of the height surface, so this mesh and every road drawn on it
    // describe the same ground.
    // Underpass cuts (citygen's refused overpasses) share the one carve, so the
    // dipped street, its pavement and everything standing on it all see them.
    G.setCarve((x, z) => Math.max(this.cutDepth(x, z),
      this.city.underpassDepth ? this.city.underpassDepth(x, z) : 0));
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
    // The ground map at THREE scales, not one.
    //
    // One 13 m tile is both the detail you stand on and the only variation you
    // see from a car, so the whole city floor was the same soft blotch pattern
    // printed on a grid -- underfoot it was blurry, and from above the repeat
    // showed as a regular weave. A 75 m copy multiplied over it breaks the
    // grid into patches, and a 3 m copy puts crisp grain under the camera.
    // Both are normalised by the map's own mean (~0.44 linear) so the average
    // value, which values.py and the terrain tints were tuned against, does
    // not move. Two extra taps on terrain pixels only.
    // THE LOT LAYER IS DRAWN BY THE TERRAIN, not on top of it.
    //
    // Car parks, plazas and yards (data/lots.png, see tools/build_lots.py) are
    // painted into this shader from a 14.4 m coverage + code texture, so they
    // cost no draw call and no triangle, and -- the reason it is here rather
    // than in the chunk build -- they ARE the terrain surface: nothing standing
    // on a lot needs a lift, `groundAt` is already right, and there is no
    // second coplanar surface to z-fight with the ground at range. Asphalt
    // kinds sample the road's own albedo and paving kinds the pavement's, in
    // the lot's own frame, so a lot matches the street beside it.
    const lotTex = this.lotTexture();
    const LN = G.LOT_N.toFixed(1), LH = G.MAP_HALF.toFixed(1), LS = G.LOT_STEP.toFixed(4);
    const LA = G.LOT_ANG.toFixed(1);
    mat.onBeforeCompile = (sh) => {
      if (lotTex) {
        sh.uniforms.lotTex = { value: lotTex };
        sh.uniforms.lotRoad = { value: this.tx.road.map };
        sh.uniforms.lotWalk = { value: this.tx.sidewalk.map };
        sh.uniforms.lotNoise = { value: this.tx.clouds };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vLotXZ;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLotXZ = position.xz;');
      }
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          vec3 macroT = texture2D( map, vMapUv * 0.173 + vec2( 0.31, 0.57 ) ).rgb / 0.44;
          vec3 detailT = texture2D( map, vMapUv * 4.3 + vec2( 0.13, 0.71 ) ).rgb / 0.44;
          sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), macroT, 0.55 ) * mix( vec3( 1.0 ), detailT, 0.4 );
          diffuseColor *= sampledDiffuseColor;
        #endif`);
      if (!lotTex) return;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D lotTex;
          uniform sampler2D lotRoad;
          uniform sampler2D lotWalk;
          uniform sampler2D lotNoise;
          varying vec2 vLotXZ;
          // NEAREST texel fetch by construction (texel centres, no mips): G is
          // a code, and filtering two codes together invents a third. R is the
          // share of the sample's own cell that has its code, less a half.
          vec2 lotTap( vec2 ij ) {
            vec2 t = texture2D( lotTex, ( ij + 0.5 ) / ${LN} ).rg;
            return vec2( t.r - 0.5, floor( t.g * 255.0 + 0.5 ) );
          }
          float lotSd( float c, vec2 t0, vec2 t1, vec2 t2, vec2 t3, vec4 w ) {
            return w.x * ( abs( t0.y - c ) < 0.5 ? t0.x : -t0.x )
                 + w.y * ( abs( t1.y - c ) < 0.5 ? t1.x : -t1.x )
                 + w.z * ( abs( t2.y - c ) < 0.5 ? t2.x : -t2.x )
                 + w.w * ( abs( t3.y - c ) < 0.5 ? t3.x : -t3.x );
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float lotCover = 0.0;
          {
            // THE EDGE IS RECONSTRUCTED, NOT SNAPPED. Each candidate code gets
            // a signed field from its four neighbours -- +(a - 0.5) where a tap
            // has that code, -(a - 0.5) where it doesn't -- and the bilinear
            // half-contour of box-filtered coverage is a straight line where
            // the polygon edge was straight. Nearest-code bilinear drew the
            // 10 m raster's staircase along every lot boundary.
            vec2 lf = ( vLotXZ + ${LH} ) / ${LS};
            vec2 li = floor( lf ), lt = lf - li;
            vec2 t0 = lotTap( li ), t1 = lotTap( li + vec2( 1.0, 0.0 ) );
            vec2 t2 = lotTap( li + vec2( 0.0, 1.0 ) ), t3 = lotTap( li + vec2( 1.0, 1.0 ) );
            vec4 w = vec4( ( 1.0 - lt.x ) * ( 1.0 - lt.y ), lt.x * ( 1.0 - lt.y ),
                           ( 1.0 - lt.x ) * lt.y, lt.x * lt.y );
            float code = 0.0, sd = -1.0;
            if ( t0.y > 0.5 ) { float s = lotSd( t0.y, t0, t1, t2, t3, w ); if ( s > sd ) { sd = s; code = t0.y; } }
            if ( t1.y > 0.5 ) { float s = lotSd( t1.y, t0, t1, t2, t3, w ); if ( s > sd ) { sd = s; code = t1.y; } }
            if ( t2.y > 0.5 ) { float s = lotSd( t2.y, t0, t1, t2, t3, w ); if ( s > sd ) { sd = s; code = t2.y; } }
            if ( t3.y > 0.5 ) { float s = lotSd( t3.y, t0, t1, t2, t3, w ); if ( s > sd ) { sd = s; code = t3.y; } }
            // Coverage ramps 0 -> 1 across one cell, so sd * cell is ~metres.
            // A ragged edge of about a metre, not a drawn one: real lot edges
            // are kerbs, verges and broken tarmac. Antialiased over a pixel.
            float sdm = sd * ${LS} + ( detailT.g - 1.0 ) * 1.4 + ( macroT.r - 1.0 ) * 1.6;
            float aw = max( 0.35, length( fwidth( vLotXZ ) ) * 0.7 );
            if ( code > 0.5 && sdm > -aw ) {
              float kind = floor( ( code - 1.0 ) / ${LA} );
              float ang = mod( code - 1.0, ${LA} ) / ${LA} * PI;
              vec2 ax = vec2( cos( ang ), sin( ang ) );
              // p.x along the lot's long side, p.y across it.
              vec2 p = vec2( dot( vLotXZ, ax ), dot( vLotXZ, vec2( -ax.y, ax.x ) ) );
              float cov = smoothstep( -aw, aw, sdm );
              // 50-400 m tone: periodic fBm, which survives the mips from the air
              // where the texture grain averages flat.
              float nBig = texture2D( lotNoise, vLotXZ / 1400.0 + vec2( 0.37, 0.11 ) ).r;
              float nMid = texture2D( lotNoise, vLotXZ / 310.0 + vec2( 0.81, 0.53 ) ).r;
              vec3 pav;
              if ( kind < 1.5 ) {
                pav = texture2D( lotRoad, p / 9.0 ).rgb;
                // Lots are older, patchier tarmac than a street: hundreds of
                // metres of one flat grey is what a lot looked like from the
                // air. Broad tone drift, paler resurfaced patches, oil-dark runs.
                pav *= mix( vec3( 1.0 ), macroT, 0.35 ) * ( kind < 0.5 ? 1.06 : 1.0 );
                // (the fBm sits mostly in 0.35..0.65, so the thresholds are
                // set to catch roughly a sixth of the lot each)
                pav *= 0.78 + nBig * 0.44;
                pav *= 1.0 + smoothstep( 0.57, 0.66, nMid ) * 0.17 - smoothstep( 0.43, 0.34, nMid ) * 0.22;
                if ( kind < 0.5 ) {
                  // Bays: 2.6 m wide, 5.4 m deep, rows back to back across
                  // a 7.2 m aisle -- an 18 m module across the lot.
                  float v = mod( p.y, 18.0 );
                  float fu = max( fwidth( p.x ), 1e-4 ), fv = max( fwidth( p.y ), 1e-4 );
                  float su = abs( fract( p.x / 2.6 + 0.5 ) - 0.5 ) * 2.6;
                  float sep = 1.0 - smoothstep( 0.06 - fu, 0.06 + fu, su );
                  float row = smoothstep( 5.4 + fv, 5.4 - fv, v ) + smoothstep( 12.6 - fv, 12.6 + fv, v );
                  float bv = abs( fract( p.y / 18.0 + 0.5 ) - 0.5 ) * 18.0;
                  float back = 1.0 - smoothstep( 0.06 - fv, 0.06 + fv, bv );
                  // Under a pixel's footprint the lines average out rather
                  // than alias: each set fades to its own mean coverage as
                  // its own axis's footprint grows past the line width.
                  float fa = clamp( 1.0 - ( fu - 0.05 ) / 0.2, 0.0, 1.0 );
                  float fb = clamp( 1.0 - ( fv - 0.05 ) / 0.2, 0.0, 1.0 );
                  sep = sep * fa + ( 1.0 - fa ) * 0.046;
                  back = back * fb + ( 1.0 - fb ) * 0.007;
                  float paint = max( sep * row, back );
                  // Worn paint, and the oil-dark middle of each bay.
                  paint *= 0.55 + 0.45 * detailT.r;
                  float mid = row * smoothstep( 0.4, 1.25, su ) * 0.10;
                  pav *= 1.0 - mid;
                  pav = mix( pav, vec3( 0.66, 0.66, 0.62 ), paint * 0.8 );
                }
              } else if ( kind < 2.5 ) {
                // Plaza paving: the pavement's slabs at 3 m a tile, warmer.
                pav = texture2D( lotWalk, p / 3.0 ).rgb * vec3( 1.04, 0.99, 0.93 );
                pav *= mix( vec3( 1.0 ), macroT, 0.25 );
              } else if ( kind < 3.5 ) {
                // Hardstanding: poured concrete, 5 m slabs, weathered. The
                // pavement map at full contrast tiled into a checkerboard from
                // the air, so it is mostly a flat mean with the slabs faint.
                vec3 wt = texture2D( lotWalk, p / 20.0 ).rgb;
                pav = mix( vec3( 0.32, 0.32, 0.31 ), wt * vec3( 0.86, 0.86, 0.84 ), 0.4 );
                pav *= mix( vec3( 1.0 ), macroT, 0.65 );
              } else {
                // Rail yard: dark ballast, track every 4.8 m along the yard's
                // long side -- two steel rails on dark sleepers.
                //
                // The WHOLE track pattern fades with distance, not just its
                // lines. The 4.8 m bed banding stayed at full contrast to the
                // horizon, moired, and a SoDo yard read as a beige corduroy
                // sheet. Each scale fades to its own mean as a pixel's footprint
                // passes it, like the parking bays.
                vec3 ballast = vec3( 0.150, 0.145, 0.138 ) * mix( vec3( 1.0 ), detailT, 0.5 )
                  * mix( vec3( 1.0 ), macroT, 0.4 ) * ( 0.85 + nBig * 0.3 );
                float fu = max( fwidth( p.x ), 1e-4 ), fv = max( fwidth( p.y ), 1e-4 );
                float ty = abs( fract( p.y / 4.8 + 0.5 ) - 0.5 ) * 4.8;   // from track centre
                float bed = 1.0 - smoothstep( 1.3 - fv, 1.3 + fv, ty );
                float sx = abs( fract( p.x / 0.62 + 0.5 ) - 0.5 ) * 0.62;
                float sleeper = bed * ( 1.0 - smoothstep( 0.12 - fu, 0.12 + fu, sx ) );
                float rail = 1.0 - smoothstep( 0.05 - fv, 0.05 + fv, abs( ty - 0.72 ) );
                float fs = clamp( 1.0 - ( fu - 0.04 ) / 0.12, 0.0, 1.0 );   // sleepers, 0.24 m
                float fr = clamp( 1.0 - ( fv - 0.03 ) / 0.08, 0.0, 1.0 );   // rails, 0.1 m
                float fb = clamp( 1.0 - ( fv - 0.25 ) / 0.6, 0.0, 1.0 );    // the 4.8 m beds
                sleeper = sleeper * fs + ( 1.0 - fs ) * bed * 0.39;
                rail = rail * fr + ( 1.0 - fr ) * 0.042;   // both rails: |ty| folds them
                vec3 track = ballast * ( 1.0 - bed * 0.10 );
                track = mix( track, vec3( 0.085, 0.072, 0.062 ), sleeper * 0.8 );
                track = mix( track, vec3( 0.34, 0.34, 0.35 ), rail * 0.5 );
                // mean of the above over a whole 4.8 m period
                // (beds 54 % of the width, sleepers 39 % of a bed, mixed at 0.8)
                vec3 far = ballast * 0.946 * 0.832 + vec3( 0.085, 0.072, 0.062 ) * 0.168;
                pav = mix( far, track, fb );
              }
              diffuseColor.rgb = mix( diffuseColor.rgb, pav, cov );
              lotCover = cov;
            }
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix( roughnessFactor, 0.8, lotCover );`);
    };
    mat.customProgramCacheKey = () => (lotTex ? 'terrain3scale-lots' : 'terrain3scale');
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
        // CELLS OVER A PORTAL TRENCH ARE NOT DRAWN AT 40 M. The heightfield's
        // vertex spacing is 40 m and a road cut is 14 m wide, so the hole
        // cannot be expressed on this grid at all -- which is exactly why
        // every earlier attempt at an open cut failed. Such a cell is dropped
        // here and re-tessellated at ~4 m in `patchCell`, with the sub-quads
        // over the corridor left out. Only cells near a portal pay for it.
        const idx = [];
        const patch = [];
        for (let j = 0; j < d - 1; j++) {
          for (let i = 0; i < w - 1; i++) {
            const a = j * w + i, b = a + 1, c2 = a + w, e = c2 + 1;
            const cx = -H + (i0 + i) * S, cz = -H + (j0 + j) * S;
            if (this.cellCut(cx, cz, S)) { patch.push([cx, cz, a]); continue; }
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
        if (patch.length) {
          const pb = new Builder();
          for (const [cx, cz, a] of patch) {
            this.patchCell(pb, cx, cz, S, [col[a * 3], col[a * 3 + 1], col[a * 3 + 2]]);
          }
          const pm = new THREE.Mesh(pb.build(), mat);
          pm.receiveShadow = this.shadows;
          this.terrainGroup.add(pm);
        }
      }
      yield (tz + 1) / TILES;
    }
  }

  /**
   * The lot layer as an RG8 texture: 1801^2 x (coverage, code), 6.5 MB of GPU
   * memory -- under the 6.8 MB the 10 m R8 code texture it replaced took. No
   * mips (a code can't be averaged). Null if the data carries no lot layer.
   */
  lotTexture() {
    const lot = G.lotCodes();
    if (!lot) return null;
    const t = new THREE.DataTexture(lot, G.LOT_N, G.LOT_N, THREE.RGFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.unpackAlignment = 1;   // a 1801 x 2-byte row is not a multiple of 4
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }

  /** Does this 40 m terrain cell touch a portal trench? */
  cellCut(cx, cz, S) {
    // An underpass cut (citygen) is 10-20 m wide too, so its cells need the
    // same re-tessellation as a portal trench or the 40 m grid hides the dip.
    if (this.city.underpassCell && this.city.underpassCell(cx, cz, S)) return true;
    if (!this.portalCuts().length) return false;
    for (let j = 0; j <= 2; j++) {
      for (let i = 0; i <= 2; i++) {
        if (this.cutFloor(cx + (i * S) / 2, cz + (j * S) / 2)) return true;
      }
    }
    return false;
  }

  /**
   * One dropped terrain cell, redrawn at SUB x SUB with the trench left out.
   *
   * Heights come from `G.terrainHeight`, which interpolates the way the terrain
   * mesh is triangulated -- so the patch meets the surrounding 40 m grid along
   * its edges by construction rather than by luck.
   */
  patchCell(b, cx, cz, S, colour) {
    // The quad size is bound to the carve profile: CUT_OVER must be at least
    // one of these quads, so that any quad crossing the wall plane has both
    // corners on the trench floor and every earth face the bank draws stands
    // behind the concrete. Change one and you must change the other. 2 m quads
    // were used before CUT_OVER existed -- the bank started ON the wall line
    // then, so every straddling quad poked into the trench -- and at 2 m the
    // patches were a fifth of the frame's triangles once the carve reached its
    // full width.
    const SUB = 10, q = S / SUB;
    // Heights come straight from terrainHeight, which already carries the cut.
    // The patch exists only to RESOLVE it: a 40 m cell cannot show a 14 m
    // trench however correct the height function is.
    const y = (x, z) => G.terrainHeight(x, z);
    // No excavation tint. The cutting is faced in concrete by the retaining
    // walls; the ground above it is the same ground as everywhere else.
    const tint = () => colour;
    for (let j = 0; j < SUB; j++) {
      for (let i = 0; i < SUB; i++) {
        const x = cx + i * q, z = cz + j * q;
        b.quad(
          [x, y(x, z), z],
          [x, y(x, z + q), z + q],
          [x + q, y(x + q, z + q), z + q],
          [x + q, y(x + q, z), z],
          [0, 1, 0], [x / 13, z / 13, x / 13, (z + q) / 13,
            (x + q) / 13, (z + q) / 13, (x + q) / 13, z / 13],
          tint());
      }
    }
  }

  /**
   * The corridor each portal needs cut out of the ground.
   *
   * A bore is 5.4 m tall, so between a mouth at grade and the point where the
   * roof is finally under the hill, the terrain surface crosses the tunnel
   * INTERIOR -- in at floor level, out at roof level. No grade removes that and
   * no slab hides it: the ground is simply drawn where the tunnel is. Every
   * portal shape tried before this one failed on it.
   *
   * So the ground gets cut. Walk the graph inward from each portal along the
   * widest tunnel edge, collecting the real node heights, and stop where the
   * roof is genuinely buried. That polyline is the trench.
   */
  portalCuts() {
    if (this._pcuts) return this._pcuts;
    const city = this.city, cuts = [];
    const seen = new Set();
    for (const [, grp] of this.portalGroups()) {
      for (const m of grp.members) {
        if (seen.has(m.ni)) continue;
        seen.add(m.ni);
        // THE RAMP IN FRONT OF THE MOUTH. citygen drops the portal node below
        // grade; this carves the ground from true terrain down to it along the
        // surface approach, so the road you are driving descends into the
        // cutting instead of meeting it as a wall at the horizon. These points
        // come FIRST, so the corridor starts out on the street.
        const P0 = city.nodes[m.ni];
        const app = [];
        {
          let cur = m.ni, prev = -1, d = 0;
          while (d < APPROACH) {
            const n = city.nodes[cur];
            let best = null;
            for (const k of n.e) {
              const e = city.edges[k];
              if (e.tunnel || e.elev || k === prev) continue;
              if (best === null || e.hw > city.edges[best].hw) best = k;
            }
            if (best === null) break;
            const e = city.edges[best];
            const nx = e.a === cur ? e.b : e.a;
            const nn = city.nodes[nx];
            d += e.len; prev = best; cur = nx;
            const t = Math.min(1, d / APPROACH);
            app.push({
              x: nn.x, z: nn.z, hw: Math.max(m.hw, e.hw),
              // ramp from the dropped portal up to untouched ground
              y: P0.y + (G.terrainRaw(nn.x, nn.z) - P0.y) * (t * t * (3 - 2 * t)),
            });
          }
        }
        app.reverse();
        // WALK EVERY BRANCH, not just the widest. Taking one edge per node
        // leaves ramps and side bores uncarved, and a shallow uncarved bore has
        // the terrain surface passing through its interior -- earth lying
        // across the carriageway with an unlined hole in it. portalcheck
        // measured 22 of them, worst 4.7 m into the bore. Each branch gets its
        // own corridor, sharing this portal's approach ramp.
        const seenE = new Set();
        const branches = [];
        const stack = [{ ni: m.ni, pts: [{ x: P0.x, z: P0.z, y: P0.y, hw: m.hw }], dist: 0 }];
        while (stack.length) {
          const br = stack.pop();
          let cur = br.ni, dist = br.dist;
          const pts2 = br.pts;
          for (;;) {
            const n = city.nodes[cur];
            const outs = n.e.filter((k) => {
              const e = city.edges[k];
              return e.tunnel && !e.elev && !seenE.has(k);
            });
            if (!outs.length || dist > 240) break;
            outs.sort((k1, k2) => city.edges[k2].hw - city.edges[k1].hw);
            // spawn the side branches from here, continue along the widest
            for (const k of outs.slice(1)) {
              const e2 = city.edges[k];
              seenE.add(k);
              const nx2 = e2.a === cur ? e2.b : e2.a;
              const nn2 = city.nodes[nx2];
              stack.push({ ni: nx2, dist: dist + e2.len,
                pts: [...pts2, { x: nn2.x, z: nn2.z, y: nn2.y, hw: e2.hw }] });
            }
            const k0 = outs[0];
            const e = city.edges[k0];
            seenE.add(k0);
            const nx = e.a === cur ? e.b : e.a;
            const nn = city.nodes[nx];
            dist += e.len; cur = nx;
            pts2.push({ x: nn.x, z: nn.z, y: nn.y, hw: e.hw });
            if (G.terrainRaw(nn.x, nn.z) - (nn.y + TUN_DECK + TUN_WALL) > CUT_COVER) break;
          }
          if (pts2.length > 1) branches.push(pts2);
        }
        for (const bp of branches) {
          const pts = [...app, ...bp];
        if (pts.length > 1) {
          const q = pts[pts.length - 1], r = pts[pts.length - 2];
          const L = Math.hypot(q.x - r.x, q.z - r.z) || 1;
          pts.push({
            x: q.x + ((q.x - r.x) / L) * 14, z: q.z + ((q.z - r.z) / L) * 14,
            y: q.y + TUN_WALL + 1.6, hw: q.hw, cap: true,
          });
        }
        if (pts.length > 1) {
          let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
          for (const q of pts) {
            const r = q.hw + CUT_SH + CUT_OVER + CUT_BANK + 2;
            x0 = Math.min(x0, q.x - r); x1 = Math.max(x1, q.x + r);
            z0 = Math.min(z0, q.z - r); z1 = Math.max(z1, q.z + r);
          }
          cuts.push({ ni: m.ni, pts, apron: app.length, x0, x1, z0, z1 });
          }
        }
      }
    }
    this._pcuts = cuts;

    // THE WALLS ARE SOLID, from the same polylines that draw them. Segments
    // along each side of every corridor at the wall line, gated on there being
    // a genuine drop to retain -- the apron start, where trench and street
    // meet at grade, gets none, which is also what lets you drive in. Installed
    // into the city's analytic barrier store: position-indexed, so no chunk
    // build or dispose can lose them, which is how two obstacle-based attempts
    // at this died. Side walls run the corridor's full length; the closed
    // middle of the far end is real ground, so no cap is needed there and none
    // may exist -- a cap across the carriageway would seal the bore.
    const bsegs = [];
    for (const c of cuts) {
      for (let i = 0; i < c.pts.length - 1; i++) {
        const a = c.pts[i], b = c.pts[i + 1];
        if (a.cap || b.cap) continue;
        const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const qx = -(b.z - a.z) / L, qz = (b.x - a.x) / L;
        const floorY = (a.y + b.y) / 2;
        // THERE IS DELIBERATELY NO FENCE ALONG THE CUTTING RIM.
        //
        // Five schemes were built and measured, and every one was net-negative:
        // wall-line pieces let cars ride the 73-degree bank down and wedge in
        // the CUT_OVER ledge; own-rim pieces stood on the neighbouring
        // excavation at the mouth; road-skipped pieces left a gap with a
        // run-up; independently-pulled pieces zigzagged with seams; and the
        // connected polyline blocked the SR-99 entrance itself, stalling the
        // drive-in test at the same station on three consecutive builds while
        // STILL not keeping the side-approach test out (it drives down the
        // bank, 2 m per frame, under any step threshold, and then cannot get
        // back out of the outer ledge -- measured stuck, not recovered).
        //
        // So the honest state ships: you CAN drive off the rim into an open
        // cutting, exactly as v66 shipped it. Fixing that for real means
        // reshaping the CUT_OVER ledge so a fallen car can drive out along it,
        // which is corridor geometry work, not fence work -- do not add a
        // sixth fence.
      }
    }
    // THE BORE'S OWN WALLS ARE SOLID TOO -- "once you are in you are in."
    // They were visual only: steer into one and the car crossed the tube's
    // half-width, groundAt found no tunnel surface there and answered with
    // the street 25 m overhead, and the car popped out of the tunnel onto the
    // surface. Every tunnel edge now carries a barrier at each wall line,
    // banded from a little under its deck to its roof, so the same wall that
    // is drawn is the wall that is hit -- and a car on the street above, or a
    // plane over the cutting, is outside the band and never feels it.
    for (let ei = 0; ei < this.city.edges.length; ei++) {
      const e = this.city.edges[ei];
      if (!e.tunnel || e.elev) continue;
      const a = this.city.nodes[e.a], b = this.city.nodes[e.b];
      const qx = -e.dz, qz = e.dx;
      const w = e.hw + 0.4;
      // In ~12 m pieces, each banded against the CARVED ground above its own
      // midpoint. One band per edge leaked in both directions: where the
      // profile runs shallow the roof pokes past the surface, and where a
      // cross street is draped down into an excavation the street descends
      // INTO the band -- 127 street-level samples sat inside one, which is a
      // car on an ordinary road clipping an invisible tunnel wall, taking the
      // impact effect and the pushout jolt: the reported "little explosion
      // while driving". Where the local drawn ground is at deck level the
      // piece dies (nothing to be inside of); where the tube is buried,
      // carved equals raw and the wall stands -- so "once you are in you are
      // in" holds exactly where being IN is a fact.
      const segN = Math.max(1, Math.ceil(e.len / 12));
      for (let k = 0; k < segN; k++) {
        const t0 = k / segN, t1 = (k + 1) / segN, tm = (t0 + t1) / 2;
        const mx = a.x + (b.x - a.x) * tm, mz = a.z + (b.z - a.z) * tm;
        const deck0 = a.y + (b.y - a.y) * t0, deck1 = a.y + (b.y - a.y) * t1;
        const y0 = Math.min(deck0, deck1) - 1.5;
        // min of three ground samples, because a piece straddling a dip's
        // lip keeps a midpoint-only band top while its end hangs into the dip
        // -- the last 5 of the 127 leaks were exactly that.
        const g0x = a.x + (b.x - a.x) * t0, g0z = a.z + (b.z - a.z) * t0;
        const g1x = a.x + (b.x - a.x) * t1, g1z = a.z + (b.z - a.z) * t1;
        const y1 = Math.min(
          Math.max(deck0, deck1) + TUNNEL_H - 0.5,
          Math.min(G.terrainHeight(mx, mz),
            G.terrainHeight(g0x, g0z), G.terrainHeight(g1x, g1z)) - 0.4);
        if (y1 - y0 < 1.0) continue;
        // In ~3 m sub-pieces, each dropped where it stands in another bore's
        // lane (see inOtherBore): the twin tubes and ramp forks converge and
        // part gradually, so a whole 12 m piece is too coarse either to open
        // the shared stretch or to close the wall again where they separate.
        const subN = Math.max(1, Math.ceil(e.len / segN / 3));
        for (const sd of [1, -1]) {
          for (let j = 0; j < subN; j++) {
            const s0 = t0 + ((t1 - t0) * j) / subN, s1 = t0 + ((t1 - t0) * (j + 1)) / subN;
            const sm = (s0 + s1) / 2;
            if (this.inOtherBore(a.x + (b.x - a.x) * sm + qx * w * sd,
              a.z + (b.z - a.z) * sm + qz * w * sd, a.y + (b.y - a.y) * sm, ei)) continue;
            bsegs.push(
              a.x + (b.x - a.x) * s0 + qx * w * sd, a.z + (b.z - a.z) * s0 + qz * w * sd,
              a.x + (b.x - a.x) * s1 + qx * w * sd, a.z + (b.z - a.z) * s1 + qz * w * sd,
              y0, y1);
          }
        }
      }
    }
    this.buildLids(cuts, bsegs);
    this.city.setBarriers(bsegs);

    // DRY TUNNELS. A corridor that dips below sea level intersects the water
    // plane, and the plane knows nothing about bores: the SR-99 tube rendered
    // as a canal. Each low pair of corridor points gets an invisible quad just
    // above sea level that writes DEPTH ONLY (renderOrder 3, before the water
    // at 4): the deck below it is already drawn and keeps its pixels, and the
    // sea behind it fails the depth test and never draws inside the tube.
    if (!this.tunnelWaterMask) {
      // Over the tunnel EDGES, not the carved corridors: a corridor ends
      // ~140 m in where the ground closes, and the first mask followed it --
      // so the first 140 m of SR-99 were dry and the remaining 3 km, all of it
      // below sea level, still rendered flooded. The graph is the authority on
      // where the bore runs; the profile on its nodes is the authority on how
      // deep.
      const wb = new Builder(false);
      // The mask's job is the view FROM ABOVE -- a cutting whose floor is under
      // sea level, seen from the street -- so it sits just over the sea. From
      // INSIDE a bore no mask height works: measured at SB bore +1500 and
      // +2033 with the camera posed, water filled half the frame for a camera
      // 0.5-1 m over sea level whatever height the mask was at (0.02 to
      // 1.2 m), and 1.2 m -- tried first -- flooded every camera below it. The
      // interior is handled by not drawing water to an underground camera at
      // all (buildWater). Quads over real water are skipped: from above, a
      // depth-only quad there is a hole in the sea (2 of 117 masked edges, at
      // the Pioneer Square shoreline).
      const MASK_Y = 0.02;
      for (const e of this.city.edges) {
        if (!e.tunnel || e.elev) continue;
        const a = this.city.nodes[e.a], b = this.city.nodes[e.b];
        if (Math.min(a.y, b.y) > 1.2) continue;
        const w = e.hw + 2;
        const qx = -e.dz, qz = e.dx;
        let wet = false;
        for (const t of [0, 0.5, 1]) for (const o of [-w, 0, w]) {
          if (G.isWater(a.x + (b.x - a.x) * t + qx * o, a.z + (b.z - a.z) * t + qz * o)) wet = true;
        }
        if (wet) continue;
        wb.quad(
          [a.x + qx * w, MASK_Y, a.z + qz * w], [a.x - qx * w, MASK_Y, a.z - qz * w],
          [b.x - qx * w, MASK_Y, b.z - qz * w], [b.x + qx * w, MASK_Y, b.z + qz * w],
          [0, 1, 0], ZERO_UV, [1, 1, 1]);
      }
      // ...AND OVER THE OPEN CUTTINGS. The mask followed the tunnel edges, so
      // a cutting whose floor dips under the sea on its SURFACE approach --
      // the NB entry cutting at SODO, beside the SR-99 surface on its lids --
      // showed the sea plane lying in the trench as a canal, from the road
      // beside it. Each non-cap corridor segment whose floor is under 0.3 m
      // gets the same depth-only quad across the whole dug floor.
      for (const c of cuts) {
        for (let i = 0; i < c.pts.length - 1; i++) {
          const a = c.pts[i], b = c.pts[i + 1];
          if (a.cap || b.cap || Math.min(a.y, b.y) - 0.7 > 0.3) continue;
          const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
          const qx = -(b.z - a.z) / L, qz = (b.x - a.x) / L;
          const w = a.hw + CUT_SH + CUT_OVER;
          let wet = false;
          for (const t of [0, 0.5, 1]) for (const o of [-w, 0, w]) {
            if (G.isWater(a.x + (b.x - a.x) * t + qx * o, a.z + (b.z - a.z) * t + qz * o)) wet = true;
          }
          if (wet) continue;
          wb.quad(
            [a.x + qx * w, MASK_Y, a.z + qz * w], [a.x - qx * w, MASK_Y, a.z - qz * w],
            [b.x - qx * w, MASK_Y, b.z - qz * w], [b.x + qx * w, MASK_Y, b.z + qz * w],
            [0, 1, 0], ZERO_UV, [1, 1, 1]);
        }
      }
      if (!wb.empty) {
        // DOUBLE-SIDED. These quads wind (A+q, A-q, B-q, B+q), which faces
        // DOWN, so under three's default front-side culling the mask existed
        // only for a camera below it. That went unseen while every sub-sea
        // deck sat on the old -11.9 m plateau with the camera under the sea
        // plane too; once the profile ran smoothly through sea level under
        // downtown, a chase camera above 0 looked down on a flooded tube -- as
        // it always had at the south cutting, where the deck is -0.5.
        const mm = new THREE.Mesh(wb.build(),
          new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
        mm.renderOrder = 3;
        this.scene.add(mm);
      }
      this.tunnelWaterMask = true;
    }

    // A node now yields ONE CUT PER BRANCH, so this cannot be a 1:1 map --
    // keyed by node it kept only the last branch, and every other branch's
    // corridor ended with no wall at its head. That is a bore mouth packed
    // with terrain, which portalcheck counts as a sliced bore once the
    // exclusion around real walls is tightened.
    this._pcutBy = new Map();
    for (const c of cuts) {
      if (!this._pcutBy.has(c.ni)) this._pcutBy.set(c.ni, []);
      this._pcutBy.get(c.ni).push(c);
    }
    return cuts;
  }

  /**
   * The trench floor at (x,z), and how far out of the trench that point is.
   *
   * THE GROUND IS DEFORMED, NOT REMOVED. Cutting a hole was tried first and is
   * a trap: a hole is an open boundary, and every open boundary needs another
   * piece of geometry to close it. Each one that got missed showed through --
   * carriageway at grade bridging the cut, pavement bridging it, and finally
   * the map-wide water plane visible at the bottom of a 40 m pit. That is an
   * unbounded list of fixes.
   *
   * Pushing the vertices down instead keeps the terrain a single closed
   * surface: there is no gap for anything to show through, the banks are real
   * triangles, and the edges of the patch still meet the surrounding 40 m grid
   * because the blend reaches true terrain before it gets there.
   *
   * Returns null outside the trench and its banks.
   */
  /**
   * How deep the ground is dug at (x,z), in metres. Installed into geo as the
   * carve, so terrainHeight() -- and therefore roads, pavement, scatter and
   * every ground query -- all see the trench.
   *
   * Reads terrainRaw, never terrainHeight: the carve is an input to that
   * function and calling it here recurses.
   */
  cutDepth(x, z) {
    const c = this.cutFloor(x, z);
    if (!c) return 0;
    const raw = G.terrainRaw(x, z);
    // full depth over the carriageway, tapering to nothing at the top of the
    // bank, and never a raised mound where the ground is already lower
    return Math.max(0, (raw - c.y) * (1 - c.t));
  }

  cutFloor(x, z) {
    // THE DEEPEST TRENCH WINS. Taking the first corridor that matches is wrong
    // wherever two overlap -- and at a divided mouth three bores share the
    // ground. Measured down the north SR-99 corridor, the neighbouring
    // carriageway's shallower profile answered first and left the floor 1.9 m
    // ABOVE the road it was supposed to expose, so the trench was dug and the
    // carriageway still buried in it.
    let best = null;
    for (const c of this.portalCuts()) {
      if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) continue;
      for (let i = 0; i < c.pts.length - 1; i++) {
        const a = c.pts[i], b = c.pts[i + 1];
        const r = distToSeg(x, z, a.x, a.z, b.x, b.z);
        const w = a.hw + CUT_SH + CUT_OVER;
        if (r.d > w + CUT_BANK) continue;
        // The closing (cap) segment starts at the cutting's deepest point and
        // runs on over the bore; behind its start, the segment before it owns
        // the ground. Clamped there, it dug a bowl at the last point's depth
        // ~12 m back along a deck that is still climbing -- at SR-99's SB exit
        // a metre deeper than the trench, straight through the roof of the
        // lower deck running underneath (portalcheck's sliced bore). Only
        // there: elsewhere the bowl is what the cutting's end has always had
        // (without it the I-5 Express bore under a ramp's cut at (513, 77)
        // came out sliced instead).
        // (raw ground here: terrainHeight is what this is computing)
        if (b.cap && r.t <= 0 && this._roofUnder(x, z, a.y, false) > a.y - 1.2) continue;
        const deck = a.y + (b.y - a.y) * r.t;
        const t = clamp((r.d - w) / CUT_BANK, 0, 1);
        const cand = { y: deck - 0.7, t: t * t * (3 - 2 * t), c };
        // compare at the point itself, banks included
        const yHere = (q) => q.y + (1e4 - q.y) * q.t;
        if (!best || yHere(cand) < yHere(best)) best = cand;
      }
    }
    return best;
  }

  /**
   * Is (x,z) on the carriageway of some tunnel edge OTHER than `ei`, whose
   * deck there is within `dy` of y?
   *
   * THE TWO SR-99 TUBES ARE ONE HOLE. OSM maps the real double-deck bore as
   * two ways, and drawn side by side at hw 7 each their centrelines are only
   * 7.5-11 m apart with decks within 0.3 m: measured, the carriageways overlap
   * over 2,830 of the northbound tube's 3,617 m and 2,796 of the southbound's
   * 3,059 m, and each tube's wall line stands inside the other's lane for
   * ~920 m. Every edge walled itself independently, so a player driving in on
   * the centre of either tube met the OTHER tube's wall 78 m (from Aurora) and
   * 101 m (from SODO) past the mouth and stopped dead. A wall only belongs
   * where it bounds the UNION of the bores -- the same rule a fork between a
   * ramp and the main line needs -- so both the barrier and the drawn wall ask
   * this before they stand.
   */
  _tunIndex() {
    if (!this._tunIdx) {
      const idx = [];
      for (let k = 0; k < this.city.edges.length; k++) {
        const e = this.city.edges[k];
        if (!e.tunnel || e.elev) continue;
        const a = this.city.nodes[e.a], b = this.city.nodes[e.b];
        const r = e.hw + 1;
        const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        idx.push({ k, a, b, hw: e.hw, L, ux: (b.x - a.x) / L, uz: (b.z - a.z) / L,
          x0: Math.min(a.x, b.x) - r, x1: Math.max(a.x, b.x) + r,
          z0: Math.min(a.z, b.z) - r, z1: Math.max(a.z, b.z) + r });
      }
      this._tunIdx = idx;
      this._tunByK = new Map(idx.map((q) => [q.k, q]));
    }
    return this._tunIdx;
  }

  /**
   * The parts of convex plan polygon `poly` ([[x, z], ...]) that lie OUTSIDE
   * tunnel rectangle q, as disjoint convex pieces: peeled off one side line
   * at a time (Sutherland-Hodgman against each half-plane).
   */
  _outsideRect(poly, q) {
    const al = (p) => (p[0] - q.a.x) * q.ux + (p[1] - q.a.z) * q.uz;
    const lt = (p) => (p[0] - q.a.x) * -q.uz + (p[1] - q.a.z) * q.ux;
    const fs = [(p) => -al(p), (p) => al(p) - q.L, (p) => lt(p) - q.hw, (p) => -lt(p) - q.hw];
    const clip = (pp, f, sg) => {
      const out = [];
      for (let i = 0; i < pp.length; i++) {
        const A = pp[i], B = pp[(i + 1) % pp.length];
        const fa = sg * f(A), fb = sg * f(B);
        if (fa >= 0) out.push(A);
        if ((fa >= 0) !== (fb >= 0)) {
          const t = fa / (fa - fb);
          out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
        }
      }
      return out;
    };
    const out = [];
    let rem = poly;
    for (const f of fs) {
      if (rem.length < 3) break;
      const o = clip(rem, f, 1);
      if (o.length >= 3) out.push(o);
      rem = clip(rem, f, -1);
    }
    return out;
  }

  /**
   * The lowest-numbered tunnel edge below `ei` whose drawn deck RECTANGLE
   * contains (x,z) -- unclamped along its length, within its half-width --
   * at a deck within 0.25 m of y; or -1. With `only` >= 0, just that edge is
   * tested. meshTunnel drops a deck/ceiling cell when one edge owns all four
   * corners, so exactly one tube draws each patch of a shared floor.
   */
  twinOwner(x, z, y, ei, only, skip) {
    let best = -1;
    for (const q of this._tunIndex()) {
      if (q.k >= ei || (only >= 0 && q.k !== only)) continue;
      if (skip && skip.includes(q.k)) continue;
      if (x < q.x0 || x > q.x1 || z < q.z0 || z > q.z1) continue;
      const rx = x - q.a.x, rz = z - q.a.z;
      const al = rx * q.ux + rz * q.uz;
      // 5 cm of slack: a point ON a shared node projects to al = -1e-13 and
      // was being refused by both edges that meet there.
      if (al < -0.05 || al > q.L + 0.05) continue;
      if (Math.abs(rx * -q.uz + rz * q.ux) > q.hw) continue;
      if (Math.abs(q.a.y + (q.b.y - q.a.y) * (al / q.L) - y) >= 0.25) continue;
      if (best < 0 || q.k < best) best = q.k;
    }
    return best;
  }

  /**
   * Highest tunnel deck (node height) whose carriageway, padded, holds (x,z);
   * or null. HIGHEST: a slab's headroom is over the deck nearest under it,
   * and under SR-99's stack that is the upper deck, DECK_SEP over the lower.
   * (It was the lowest, which only ever mattered while the twins were side by
   * side at one level.)
   */
  _tunDeckUnder(x, z, pad) {
    let best = null;
    for (const q of this._tunIndex()) {
      if (x < q.x0 - pad || x > q.x1 + pad || z < q.z0 - pad || z > q.z1 + pad) continue;
      const rx = x - q.a.x, rz = z - q.a.z;
      const al = rx * q.ux + rz * q.uz;
      if (al < -pad || al > q.L + pad) continue;
      if (Math.abs(rx * -q.uz + rz * q.ux) > q.hw + pad) continue;
      const y = q.a.y + (q.b.y - q.a.y) * clamp(al / q.L, 0, 1);
      if (best === null || y > best) best = y;
    }
    return best;
  }

  /**
   * The highest ROOF of a bore running under (x,z) whose deck is more than
   * 2 m below y, or -Infinity. A structure standing on the upper SR-99 deck --
   * the SB exit's headwall piers and mouth card, dug 1.5 m below its own deck
   * to swallow the terrain face -- must stop above it, or it hangs through the
   * lower deck's ceiling.
   */
  _roofUnder(x, z, y, buried = true, pad = 1.5) {
    let best = -Infinity;
    for (const q of this._tunIndex()) {
      if (x < q.x0 - pad || x > q.x1 + pad || z < q.z0 - pad || z > q.z1 + pad) continue;
      const rx = x - q.a.x, rz = z - q.a.z;
      const al = rx * q.ux + rz * q.uz;
      if (al < -pad || al > q.L + pad) continue;
      if (Math.abs(rx * -q.uz + rz * q.ux) > q.hw + pad) continue;
      const dk = q.a.y + (q.b.y - q.a.y) * clamp(al / q.L, 0, 1);
      if (dk > y - 2) continue;
      // only a BURIED roof: over a lower bore's own open cutting the ground is
      // below its roof, and a pier there has always stood on that ground
      // (raising it floated the piers at the I-90 and I-405 interchanges)
      const roof = dk + TUN_DECK + TUN_WALL;
      if (buried && G.terrainHeight(x, z) < roof - 0.1) continue;
      best = Math.max(best, roof);
    }
    return best;
  }

  inOtherBore(x, z, y, ei, pad = 0.2, dy = 1.6) {
    for (const q of this._tunIndex()) {
      if (q.k === ei || x < q.x0 || x > q.x1 || z < q.z0 || z > q.z1) continue;
      const r = distToSeg(x, z, q.a.x, q.a.z, q.b.x, q.b.z);
      if (r.d > q.hw + pad) continue;
      if (Math.abs(q.a.y + (q.b.y - q.a.y) * r.t - y) < dy) return true;
    }
    return false;
  }

  /**
   * CUT-AND-COVER LIDS: a surface road that passes over somebody else's
   * portal cutting rides a slab at its own grade instead of dropping into the
   * trench.
   *
   * The carve digs everything within hw + 7.6 m of a corridor, and it cannot
   * know which surface roads cross that footprint. 423 carriageways that are
   * NOT the cutting's own approach are dug more than a metre by one. The one a
   * player meets first: continuing south on the SR-99 surface out of the
   * southbound tube, the road runs 9-12 m beside the northbound entry cutting
   * with carriageways that overlap (hw 7 each) and dropped 11-12 m into it at
   * z ~1909. And three viaduct approaches on Mercer Island start in an I-90
   * lid's cutting 9-11 m below the deck they are meant to climb onto, which is
   * verify's "3 of 851 approaches failed to climb".
   *
   * The terrain cannot express a road over a trench -- ground is one value per
   * point and a 4 m patch cannot hold a vertical step -- so the lid is drawn
   * geometry with its own height query (city.lidAt), exactly like a deck:
   *
   *  - near-parallel roads (SR-99's surface beside its own portal) split the
   *    ground at the Voronoi line between the two centrelines: the surface
   *    road keeps its half on a slab, the cutting keeps its half, and a
   *    retaining wall with a parapet and a barrier stands on the line.
   *  - crossing roads bridge the trench, where there is headroom for traffic
   *    below (4.6 m under the slab); where there is not, the crossing is at
   *    grade in life too and is left as it was.
   *  - a road that is some cutting's OWN approach is never lidded: it is
   *    supposed to descend.
   *  - only roads the cut actually hurts (1.5 m+ deep somewhere along them).
   */
  buildLids(cuts, bsegs) {
    const city = this.city;
    const LID_TOP = ROAD_LIFT + 0.04;
    const key = (x, z) => Math.round(x) + ':' + Math.round(z);
    const keysOf = cuts.map((c) => new Set(c.pts.map((p) => key(p.x, p.z))));
    // Is (x,z) inside cut c's dug footprint at all?
    const inFoot = (c, x, z) => {
      if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return false;
      for (let k = 0; k < c.pts.length - 1; k++) {
        const p0 = c.pts[k], p1 = c.pts[k + 1];
        if (distToSeg(x, z, p0.x, p0.z, p1.x, p1.z).d <= p0.hw + CUT_SH + CUT_OVER + CUT_BANK) return true;
      }
      return false;
    };
    // Carve depth, and the cut doing it, in one call (terrainHeight would call
    // cutFloor again).
    const carveAt = (x, z) => {
      const cf = this.cutFloor(x, z);
      if (!cf) return null;
      const raw = G.terrainRaw(x, z);
      return { d: Math.max(0, (raw - cf.y) * (1 - cf.t)), c: cf.c, raw };
    };
    const quads = [], pending = [];
    this._lidByEdge = new Map();
    this._lidVeto = new Map();          // ei -> why a dug road got no slab
    this._lidBarrier0 = bsegs.length;   // barriers from here on are lid sides
    const stats = { edges: 0, quads: 0, walls: 0, crossingsSkipped: 0 };
    for (let ei = 0; ei < city.edges.length; ei++) {
      const e = city.edges[ei];
      if (e.tunnel || e.elev) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      // The cuts this road is an APPROACH of (either end on the corridor):
      // wherever one of those digs, the road is supposed to go down with it.
      // Both-ends-only was not enough -- at a divided mouth the twin
      // carriageways descend side by side, each dug deepest by the OTHER's
      // cut, and lidding one put a wall 2 m from the other's centreline.
      const kA = key(a.x, a.z), kB = key(b.x, b.z);
      const ownCuts = cuts.filter((c, ci) => keysOf[ci].has(kA) || keysOf[ci].has(kB));
      const r = e.hw + 1;
      const ex0 = Math.min(a.x, b.x) - r, ex1 = Math.max(a.x, b.x) + r;
      const ez0 = Math.min(a.z, b.z) - r, ez1 = Math.max(a.z, b.z) + r;
      if (!cuts.some((c) => !(ex1 < c.x0 || ex0 > c.x1 || ez1 < c.z0 || ez0 > c.z1))) continue;
      // Any road the cut digs at all (0.3 m+). A higher bar -- 1.5 m was the
      // first -- ends a slab at the node where the next edge's dig falls
      // under it, and that end is a drop the barrier then walls off across
      // the carriageway: measured at (148, 2039), the next edge dug 1.4 m.
      let worst = 0;
      for (let s = 0; s <= e.len; s += 3) {
        const t = s / e.len;
        const q = carveAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        if (q && q.d > worst) worst = q.d;
      }
      if (worst < 0.3) continue;
      const px = -e.dz, pz = e.dx;
      // Stations every 0.5 m: the slab has to start where the dig does. At
      // 2 m the first slab row landed on the bank already a metre or more
      // down, and its end was walled off across the carriageway.
      const ns = Math.max(1, Math.ceil(e.len / 0.5)), nl = Math.max(2, Math.ceil(e.hw * 2));
      const S = (i) => i / ns, U = (j) => e.hw - (2 * e.hw * j) / nl;
      const pt = (s, u) => [a.x + (b.x - a.x) * s + px * u, a.z + (b.z - a.z) * s + pz * u];
      // Is (x,z), u across this road, lid? Crossings that lack headroom veto
      // the whole road: half a bridge is a wall across the carriageway.
      // here() answers 0 (no slab), 1 (slab beside a cutting: its exposed
      // side is a retaining wall to the trench floor) or 2 (slab bridging a
      // trench: traffic passes UNDER its sides, so they are parapets only).
      let veto = false, vetoWhy = '';
      // -1 marks "no slab only because the dig is too shallow here", which
      // the dilation below may still claim.
      const here = (x, z, u, s) => {
        const q = carveAt(x, z);
        if (!q || q.d < 0.08) return -1;
        for (const c2 of ownCuts) if (inFoot(c2, x, z)) return 0;
        // OVER A TUNNEL CARRIAGEWAY a slab can only be a bridge: its sides
        // are parapets, traffic passes under them. Measured riding NB, a lid
        // median standing in a twin tube's lane under Alaskan Way stopped the
        // car 348 m in. Too little headroom there -- no slab at this point.
        // Too little headroom there vetoes the whole road -- but only where the
        // slab would otherwise stand: a hole in mid-slab gets walled round,
        // and the citywide sweep counted 184 runs hitting such walls against
        // 7 on master. A road with no slab keeps master's dip instead.
        const td = this._tunDeckUnder(x, z, 0.6);
        const lowHead = td !== null && q.raw + LID_TOP - 0.5 - (td + 0.3) < 4.0;
        const bridgeOnly = td !== null && !lowHead;
        let dOwn = 1e9, sa = null, sb = null, tt = 0, dAll = 1e9;
        for (let k = 0; k < q.c.pts.length - 1; k++) {
          const p0 = q.c.pts[k], p1 = q.c.pts[k + 1];
          const rr = distToSeg(x, z, p0.x, p0.z, p1.x, p1.z);
          // The Voronoi line counts the closing (cap) segment too -- it runs
          // on down the bore -- or near a cutting's end the median slid to 2 m
          // off the NB centreline (bore +65) because the nearest counted
          // segment had already ended.
          if (rr.d < dAll) dAll = rr.d;
          if (p1.cap) continue;
          if (rr.d < dOwn) { dOwn = rr.d; sa = p0; sb = p1; tt = rr.t; }
        }
        if (!sa) return 0;
        const kindOf = (kd) => {
          if (kd > 0 && lowHead) { veto = true; vetoWhy = 'low headroom over a tunnel'; return 0; }
          return kd > 0 && bridgeOnly ? 2 : kd;
        };
        const L = Math.hypot(sb.x - sa.x, sb.z - sa.z) || 1;
        const cosA = Math.abs(((sb.x - sa.x) * e.dx + (sb.z - sa.z) * e.dz) / L);
        if (cosA > 0.87) {
          // The Voronoi line has to leave the cutting's carriageway most of
          // its width: closer than 0.62 hw (the median wall inside the lane
          // a car's width from the centre) the two roads are one corridor,
          // and no slab can separate them.
          const [cx, cz] = pt(s, 0);
          if (distToSeg(cx, cz, sa.x, sa.z, sb.x, sb.z).d < 1.24 * sa.hw) {
            // ...unless the cutting is deep enough to roof: then the road runs
            // OVER it on a bridge slab, which is what cut-and-cover is. This
            // is the 80th Ave SE ramp on Mercer Island, 9-11 m down in the I-90
            // lid's cutting with ~8 m of headroom over the I-90 deck -- the
            // last two of verify's stranded viaduct approaches.
            const deck = sa.y + (sb.y - sa.y) * tt;
            if (q.raw + LID_TOP - 0.5 - deck >= 4.6) return kindOf(2);
            veto = true; vetoWhy = 'parallel, one corridor'; return 0;
          }
          if (Math.abs(u) < Math.min(dOwn, dAll)) return kindOf(1);
          // PAST THE VORONOI LINE, over the cutting itself: roof it where it is
          // deep enough, so the road keeps its full width on the slab. Split
          // there, a road drifting out of the corridor (the 80th Ave SE ramp
          // 113900) kept only its near half, the far half was a drop, and its
          // side barrier stood in its own lane. Only where the trench is too
          // shallow to roof does the split, and its retaining wall, stand.
          const deck2 = sa.y + (sb.y - sa.y) * tt;
          if (q.raw + LID_TOP - 0.5 - deck2 >= 4.6) return kindOf(2);
          return 0;
        }
        if (dOwn > sa.hw + CUT_SH) return kindOf(1);
        const deck = sa.y + (sb.y - sa.y) * tt;
        if (q.raw + LID_TOP - 0.5 - deck >= 4.6) return kindOf(2);
        veto = true; vetoWhy = 'crossing without headroom';
        return 0;
      };
      const raw0 = [];
      let any = false;
      for (let i = 0; i <= ns; i++) {
        const row = new Int8Array(nl + 1);
        for (let j = 0; j <= nl; j++) {
          const [x, z] = pt(S(i), U(j));
          row[j] = here(x, z, U(j), S(i));
          if (row[j] > 0) any = true;
        }
        raw0.push(row);
      }
      // DILATE ONE SAMPLE INTO THE FADE. The bank goes from nothing to full
      // depth over 2.4 m, so between a 1 m-spaced sample that is barely dug
      // and the next the ground can already be a metre down -- measured
      // 0.9 m at the SB surface's outer edge (z 1981). A slab stopping on the
      // last dug sample left that strip as a step, and its corner a barrier
      // within reach of a car on the centreline. A shallow sample next to
      // slab joins it; its top sits 4 cm over the undug road, as the rest do.
      const lid = raw0.map((row) => Uint8Array.from(row, (v) => (v > 0 ? v : 0)));
      for (let i = 0; i <= ns; i++) {
        for (let j = 0; j <= nl; j++) {
          if (raw0[i][j] !== -1) continue;
          let kk = 0;
          for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
            const r1 = raw0[i + di];
            if (r1 && r1[j + dj] > kk) kk = r1[j + dj];
          }
          lid[i][j] = kk;
        }
      }
      if (veto) { stats.crossingsSkipped++; this._lidVeto.set(ei, vetoWhy); continue; }
      if (!any) continue;
      const topY = (x, z) => G.terrainRaw(x, z) + LID_TOP;
      const col = e.cls === 'hwy' ? [0.92, 0.92, 0.92] : [1, 1, 1];
      // An exposed side of the slab: if the ground just outside it is more
      // than a metre down, it gets a fascia to the ground, a parapet, and a
      // barrier banded from below the trench floor to above the slab, so
      // neither the car on the slab nor the one in the trench can cross it.
      // A bridge side (kind 2) stands over the trench with traffic under it:
      // it is a 0.7 m slab edge and a parapet, banded to the slab only, or it
      // would be a wall across the carriageway below -- measured, the first
      // version stopped the SB car 14 m inside its own mouth.
      // PASS 1: the slab tops. Lateral runs per station pair, merged along the
      // road while the run is unchanged, up to 4 m -- the top follows raw
      // ground at its corners, and a chord longer than that sags off a 40 m
      // heightfield.
      const runs = [];
      let open = new Map();
      for (let i = 0; i < ns; i++) {
        const next = new Map();
        const ok = (jj) => lid[i][jj] && lid[i + 1][jj] && lid[i][jj + 1] && lid[i + 1][jj + 1];
        let j = 0;
        while (j < nl) {
          if (!ok(j)) { j++; continue; }
          let j1 = j, kind = 0;
          while (j1 + 1 < nl && ok(j1 + 1)) j1++;
          for (let jj = j; jj <= j1 + 1; jj++) kind = Math.max(kind, lid[i][jj], lid[i + 1][jj]);
          const k = j + ':' + j1;
          const prev = open.get(k);
          if (prev && (S(i + 1) - prev.s0) * e.len <= 4.0 && prev.kind === kind) {
            prev.s1 = S(i + 1);
            next.set(k, prev);
          } else {
            const r0 = { s0: S(i), s1: S(i + 1), uA: U(j), uB: U(j1 + 1), kind };
            runs.push(r0);
            next.set(k, r0);
          }
          j = j1 + 1;
        }
        open = next;
      }
      const tops = [], c4s = [];
      for (const q of runs) {
        const c4 = [pt(q.s0, q.uA), pt(q.s0, q.uB), pt(q.s1, q.uB), pt(q.s1, q.uA)];
        const v = c4.map(([x, z]) => [x, topY(x, z), z]);
        const uvs = [];
        for (const [s, u] of [[q.s0, q.uA], [q.s0, q.uB], [q.s1, q.uB], [q.s1, q.uA]]) uvs.push((e.hw - u) / ROAD_TILE, (s * e.len) / ROAD_TILE);
        tops.push({ v, uvs });
        c4s.push(c4);
      }
      if (!tops.length) continue;
      // kept for tools: the per-sample slab mask (0 none, 1 beside, 2 bridge)
      (this._lidMask || (this._lidMask = new Map())).set(ei, { lid, raw0, ns, nl });
      pending.push({ ei, e, pt, runs, tops, col, topY, c4s });
    }
    // SLABS COME IN NETWORKS. A slabbed road meeting, at a junction the cut
    // has dug more than a metre, a road that got no slab (vetoed, or some
    // cutting's own approach) put that road's driver against the slab's side
    // -- a barrier, or a step with none: the sweep's remaining wall hits were
    // almost all this (Roy St, Hubbell Pl, Lake City Way ...). Such a slab is
    // withdrawn, and again for whatever it was holding up, until stable; the
    // roads involved keep master's continuous dip.
    // AND NO SLAB MAY STOP INSIDE ITS OWN LANE. Where the slab covers only
    // part of a road's width -- a Voronoi half on one stretch, a bridge on
    // the next -- the uncovered part is a drop, and its side barrier stood
    // 0.3-2.2 m off the centreline: every one of the sweep's 24 wall hits
    // after the bridge rule was a road running into its own slab's side. A
    // partial slab is worse than master's dip, so it is withdrawn, and the
    // junction rule re-run, until nothing changes.
    {
      const lidSet = new Set(pending.map((q) => q.ei));
      const junction = () => {
        let changed = true;
        while (changed) {
          changed = false;
          for (const q of pending) {
            if (!lidSet.has(q.ei)) continue;
            for (const ni of [q.e.a, q.e.b]) {
              const n = city.nodes[ni];
              if (G.terrainRaw(n.x, n.z) - G.terrainHeight(n.x, n.z) <= 1.0) continue;
              const orphan = n.e.some((k) => {
                if (k === q.ei) return false;
                const f = city.edges[k];
                return !f.tunnel && !f.elev && !lidSet.has(k);
              });
              if (orphan) { lidSet.delete(q.ei); this._lidVeto.set(q.ei, 'junction with an unslabbed dug road'); changed = true; break; }
            }
          }
        }
      };
      const inLane = (q) => {
        for (const r0 of q.runs) {
          for (const [u, ou] of [[r0.uA, 0.8], [r0.uB, -0.8]]) {
            // 2.6 m: a sedan's barrier reach from its centre (0.7 x radius +
            // the barrier's 0.8 m). At 2.8 this withdrew the 80th Ave SE ramp
            // chain on Mercer Island for a boundary at 2.76 m no car touches.
            if (Math.abs(u) >= 2.6 || Math.abs(u) >= q.e.hw - 0.05) continue;
            const nL = Math.max(1, Math.ceil(((r0.s1 - r0.s0) * q.e.len) / 1.0));
            for (let k = 0; k < nL; k++) {
              const sm = r0.s0 + ((r0.s1 - r0.s0) * (k + 0.5)) / nL;
              const [ox, oz] = q.pt(sm, u + ou);
              if (city.lidAt(ox, oz) !== null) continue;
              // the dig outside, as side() judges it (not the hillside's fall);
              // under 2 m side() leaves it an unfenced step, which is master's
              // dip -- withdrawing for it collapsed the whole 80th Ave SE / I-405
              // ramp chain from a 1.5 m fade-out at its far end (125107)
              if (G.terrainRaw(ox, oz) - G.terrainHeight(ox, oz) + (LID_TOP - ROAD_LIFT) >= 2.0) return true;
            }
          }
        }
        return false;
      };
      for (;;) {
        junction();
        this.city.setLids(pending.filter((q) => lidSet.has(q.ei)).flatMap((q) => q.c4s));
        let removed = 0;
        for (const q of pending) {
          if (lidSet.has(q.ei) && inLane(q)) {
            lidSet.delete(q.ei); this._lidVeto.set(q.ei, 'partial slab, barrier in lane'); removed++;
          }
        }
        if (!removed) break;
      }
      for (let k = pending.length - 1; k >= 0; k--) if (!lidSet.has(pending[k].ei)) pending.splice(k, 1);
      stats.junctionWithdrawn = [...this._lidVeto.values()].filter((v) => v.startsWith('junction')).length;
      stats.partialWithdrawn = [...this._lidVeto.values()].filter((v) => v.startsWith('partial')).length;
    }
    for (const q of pending) quads.push(...q.c4s);
    this.city.setLids(quads);

    // THE TRENCH IS WALLED WHERE A SLAB ROOFS ITS LEDGE. The cutting's
    // retaining wall is drawn at hw + CUT_SH but was never solid -- the rim is
    // deliberately unfenced (see portalCuts) -- so under a bridge slab a car
    // in the trench drove straight through the wall into the CUT_OVER ledge
    // behind it: a dark slot under the other road's slab with no way on.
    // Under a slab nothing can fall into the ledge from above, so the reason
    // for leaving it open does not apply there: wherever the ground just
    // behind the wall line is roofed by a lid, the wall line is a barrier,
    // banded from under the trench floor to the slab's soffit, so the road on
    // the slab and anyone on the street never meet it. Not where the ledge is
    // another cutting's carriageway (a divided mouth descends side by side).
    {
      const n0 = bsegs.length;
      this._ledgeBarrier0 = n0;           // for tools: ledge walls start here
      const onOtherRoad = (c, x, z) => cuts.some((c2) => {
        if (c2 === c || x < c2.x0 || x > c2.x1 || z < c2.z0 || z > c2.z1) return false;
        for (let k = 0; k < c2.pts.length - 1; k++) {
          const p0 = c2.pts[k], p1 = c2.pts[k + 1];
          if (p1.cap) continue;
          if (distToSeg(x, z, p0.x, p0.z, p1.x, p1.z).d < p0.hw + 0.5) return true;
        }
        return false;
      });
      const lidEdges = new Set(pending.map((q) => q.ei));
      const inLaneAt = (x, z) => {
        for (const k of city.edgesNear(x, z, 25)) {
          const e = city.edges[k];
          if (e.tunnel || e.elev || lidEdges.has(k)) continue;
          const a = city.nodes[e.a], b = city.nodes[e.b];
          if (distToSeg(x, z, a.x, a.z, b.x, b.z).d <= e.hw + 0.3) return true;
        }
        return false;
      };
      for (const c of cuts) {
        for (let i = 0; i < c.pts.length - 1; i++) {
          const a = c.pts[i], b = c.pts[i + 1];
          if (a.cap || b.cap) continue;
          const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
          const qx = -(b.z - a.z) / L, qz = (b.x - a.x) / L;
          const n = Math.max(1, Math.ceil(L / 1.5));
          for (const sd of [1, -1]) {
            for (let k = 0; k < n; k++) {
              const t0 = k / n, t1 = (k + 1) / n, tm = (t0 + t1) / 2;
              const w = a.hw + CUT_SH;
              const mx = a.x + (b.x - a.x) * tm, mz = a.z + (b.z - a.z) * tm;
              // the ledge behind the wall, and the wall line itself
              const lx = mx + qx * sd * (w + 1.5), lz = mz + qz * sd * (w + 1.5);
              const top = this.city.lidAt(lx, lz);
              if (top === null) continue;
              if (onOtherRoad(c, lx, lz) || onOtherRoad(c, mx + qx * sd * w, mz + qz * sd * w)) continue;
              // ...nor where the wall line itself is some road's carriageway: a
              // surface street dug by the cut can run along the ledge (Bellevue,
              // (8281, -2736)), and a wall there is one in its lane
              // (unslabbed surface roads only: the slab road bridging the
              // trench passes over the wall line, and is the reason it is here)
              if (inLaneAt(mx + qx * sd * w, mz + qz * sd * w)) continue;
              const floor = a.y + (b.y - a.y) * tm - 0.7;
              const y1 = top + LID_TOP - 0.8;
              if (y1 - floor < 2.0) continue;
              bsegs.push(
                a.x + (b.x - a.x) * t0 + qx * sd * w, a.z + (b.z - a.z) * t0 + qz * sd * w,
                a.x + (b.x - a.x) * t1 + qx * sd * w, a.z + (b.z - a.z) * t1 + qz * sd * w,
                floor - 1.5, y1);
            }
          }
        }
      }
      this._ledgeBarrier1 = bsegs.length;
      stats.ledgeWalls = (bsegs.length - n0) / 6;
      cityStats.lidLedgeWalls = stats.ledgeWalls;
    }

    // PASS 2: the exposed sides, now that every lid in the city is known. A
    // side is exposed only if the ground just outside it is NOT another slab
    // -- the next edge's lid, a neighbouring ramp's -- and is more than a
    // metre down. Judged per road, the end of each edge's slab met the next
    // edge's at a node and was walled across the carriageway there: the SB
    // surface ride stopped at three consecutive nodes before this.
    for (const P2 of pending) {
      const { ei, e, pt, runs, tops, col, topY } = P2;
      const walls = [];
      // A slab END (across the road, `trans`) gets a fascia but no parapet
      // and no barrier: a car running off the end drops into the dip the road
      // had on master, which is recoverable, where a barrier across the
      // carriageway is a dead stop. Only the sides along the road -- the
      // median over a trench, a kerb over a drop -- are barriers.
      const side = (s0, u0, s1, u1, os, ou, kind, trans) => {
        const [x0, z0] = pt(s0, u0), [x1, z1] = pt(s1, u1);
        const [ox, oz] = pt((s0 + s1) / 2 + os, (u0 + u1) / 2 + ou);
        if (city.lidAt(ox, oz) !== null) return;
        const t0 = topY(x0, z0), t1 = topY(x1, z1);
        let g = G.terrainHeight(ox, oz);
        // The DROP is the dig outside, not the fall of the hillside: compared
        // with absolute ground, a slab on a cross-sloping street counted the
        // street's own camber toward the metre and walled it.
        const drop = G.terrainRaw(ox, oz) - g + (LID_TOP - ROAD_LIFT);
        if (drop < 1.0) return;
        // A side INSIDE the lane (within a car's reach of the centreline)
        // over a step under 2 m gets no barrier: that step is the dip the road
        // had on master anyway, and a barrier there is a wall in the lane.
        // (A deeper in-lane step withdraws the whole slab -- see inLane.)
        const um = (u0 + u1) / 2;
        if (!trans && Math.abs(um) < 2.6 && Math.abs(um) < e.hw - 0.05 && drop < 2.0) trans = true;
        const bridge = kind === 2;
        if (bridge) g = Math.min(t0, t1) - 0.7 + 0.3;   // fascia bottom = slab soffit
        walls.push({ x0, z0, x1, z1, t0, t1, g, trans, nx: ox - (x0 + x1) / 2, nz: oz - (z0 + z1) / 2 });
        if (!trans) bsegs.push(x0, z0, x1, z1, bridge ? Math.min(t0, t1) - 0.8 : g - 1.5, Math.max(t0, t1) + 1.8);
      };
      const ds = 0.8 / e.len;
      for (const r0 of runs) {
        // lateral sides in ~1 m pieces
        const nL = Math.max(1, Math.ceil(((r0.s1 - r0.s0) * e.len) / 1.0));
        for (let k = 0; k < nL; k++) {
          const a0 = r0.s0 + ((r0.s1 - r0.s0) * k) / nL, a1 = r0.s0 + ((r0.s1 - r0.s0) * (k + 1)) / nL;
          side(a0, r0.uA, a1, r0.uA, 0, 0.8, r0.kind);
          side(a0, r0.uB, a1, r0.uB, 0, -0.8, r0.kind);
        }
        // ends in ~1 m pieces
        const nW = Math.max(1, Math.ceil((r0.uA - r0.uB) / 1.0));
        for (let k = 0; k < nW; k++) {
          const b0 = r0.uA - ((r0.uA - r0.uB) * k) / nW, b1 = r0.uA - ((r0.uA - r0.uB) * (k + 1)) / nW;
          side(r0.s0, b0, r0.s0, b1, -ds, 0, r0.kind, true);
          side(r0.s1, b0, r0.s1, b1, ds, 0, r0.kind, true);
        }
      }
      this._lidByEdge.set(ei, { tops, walls, col });
      stats.edges++; stats.quads += tops.length; stats.walls += walls.length;
    }
    cityStats.lidEdges = stats.edges;
    cityStats.lidQuads = stats.quads;
    cityStats.lidWalls = stats.walls;
    cityStats.lidCrossingsSkipped = stats.crossingsSkipped;
    cityStats.lidJunctionWithdrawn = stats.junctionWithdrawn;
    cityStats.lidPartialWithdrawn = stats.partialWithdrawn;
  }

  /** The slab, fascia and parapet of one road's lids (see buildLids). */
  meshLid(road, flat, ei) {
    const L = this._lidByEdge && this._lidByEdge.get(ei);
    if (!L) return;
    for (const q of L.tops) road.quad(q.v[0], q.v[1], q.v[2], q.v[3], [0, 1, 0], q.uvs, L.col);
    const conc = [0.46, 0.47, 0.48];
    for (const w of L.walls) {
      const n = Math.hypot(w.nx, w.nz) || 1, nx = w.nx / n, nz = w.nz / n;
      // fascia down to the ground outside, facing the drop
      const ph = w.trans ? 0 : 0.9;     // an end has no parapet
      flat.quad([w.x0, w.g - 0.3, w.z0], [w.x1, w.g - 0.3, w.z1], [w.x1, w.t1 + ph, w.z1], [w.x0, w.t0 + ph, w.z0],
        [nx, 0, nz], ZERO_UV, conc);
      if (w.trans) continue;
      // parapet's inner face and cap
      const ix = -nx * 0.3, iz = -nz * 0.3;
      flat.quad([w.x0 + ix, w.t0, w.z0 + iz], [w.x1 + ix, w.t1, w.z1 + iz],
        [w.x1 + ix, w.t1 + 0.9, w.z1 + iz], [w.x0 + ix, w.t0 + 0.9, w.z0 + iz], [-nx, 0, -nz], ZERO_UV, conc);
      flat.quad([w.x0, w.t0 + 0.9, w.z0], [w.x1, w.t1 + 0.9, w.z1],
        [w.x1 + ix, w.t1 + 0.9, w.z1 + iz], [w.x0 + ix, w.t0 + 0.9, w.z0 + iz], [0, 1, 0], ZERO_UV, [0.55, 0.56, 0.57]);
    }
  }

  /**
   * Is (x,z) over the floor of a portal trench (not its banks)? With `y`, a
   * deck height, a trench whose own road runs above this deck's roof does
   * not count: that deck is buried under the other's cut. SR-99's lower deck runs under
   * the upper deck's south cutting, DECK_SEP below the road in it, and asked
   * without a height it came back "open" -- no roof, no walls, no lamps, and
   * daylight down the NB bore for 100 m.
   */
  inCut(x, z, y) {
    for (const c of this.portalCuts()) {
      if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) continue;
      for (let i = 0; i < c.pts.length - 1; i++) {
        const a = c.pts[i], b = c.pts[i + 1];
        // distToSeg returns {d, t, x, z}, NOT a number. Comparing the object
        // to a radius is always false, so the trench was computed for all 155
        // corridors and cut for none of them -- the hole silently did not
        // exist, and every portal shape was judged against ground that had
        // never been removed.
        // The closing segment shapes the GROUND over the bore; it is not open
        // cut. Counting it as such drew road, retaining walls and a lit deck
        // underneath ground that had just been raised over them -- an earth
        // mound sitting on the carriageway.
        if (b.cap) continue;
        const r = distToSeg(x, z, a.x, a.z, b.x, b.z);
        if (r.d >= a.hw + CUT_SH) continue;
        // only a trench whose FLOOR clears this deck's roof and slab (a
        // stacked deck, DECK_SEP up) leaves it buried; anything lower is this
        // deck's open cut too, as it always was -- the I-5 Express bore under
        // a ramp cutting 6.0 m above it keeps its old treatment
        if (y != null && a.y + (b.y - a.y) * r.t - y > TUNNEL_H + 1.0) continue;
        return true;
      }
    }
    return false;
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
    // Two scales of swell from the one normal map.
    //
    // At a 520x repeat the tile is ~16 m, and from any height the same wavelet
    // pattern printed edge to edge across Elliott Bay reads as a woven carpet,
    // the scrolling offset only slides the weave. A second tap at -0.29x scale
    // (so it drifts the OTHER way, at a different speed, from the same offset)
    // adds long swell and breaks the grid. Blending in tangent space before
    // three perturbs the normal, so everything downstream is untouched.
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\n'
        + '\tvec3 mapN2 = texture2D( normalMap, vNormalMapUv * -0.29 + vec2( 0.37, 0.11 ) ).xyz * 2.0 - 1.0;\n'
        + '\tmapN = normalize( vec3( mapN.xy * 0.62 + mapN2.xy * 0.9, mapN.z ) );');
    };
    mat.customProgramCacheKey = () => 'water2scale';
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0;
    // AFTER the opaque scene, not before it (was -5). A bore below sea level
    // -- SR-99 bottoms out around -16 m, like the real one -- has nothing
    // between its interior and the sea plane, so the tunnel rendered flooded.
    // The fix is a depth-only mask over those corridors (see portalCuts), and
    // a mask can only shield water that draws AFTER it. Opaque water is
    // order-independent under the depth buffer, so moving it costs nothing.
    m.renderOrder = 4;
    this.scene.add(m);
    this.water = m;
    this.waterNormal = n;
    // NO WATER TO AN UNDERGROUND CAMERA. A bore is closed, so nothing seen
    // from inside one can be water -- but the sea plane at y = 0 runs straight
    // through every sub-sea stretch of SR-99, and no depth mask can shield a
    // camera from a plane passing between it and its own walls (see the mask
    // in portalCuts). Decided per draw from the camera actually rendering, in
    // each water mesh's onBeforeRender, which runs before three applies the
    // material's state; the lakes share the material, so each sets the flags
    // for itself and they cannot leak between meshes.
    const underground = (cam) => G.terrainRaw(cam.position.x, cam.position.z) - cam.position.y > 1.5;
    const gate = (r, s, cam, g2, mt) => { const u = underground(cam); mt.colorWrite = !u; mt.depthWrite = !u; };
    m.onBeforeRender = gate;

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
      lm.renderOrder = 5;   // after the sea, as before -- see note above
      lm.onBeforeRender = gate;
      this.scene.add(lm);
      this.lakes.push(lm);
    }
  }

  /** Every tall building in the city as one cheap silhouette mesh. */
  buildSkyline() {
    const b = new Builder(false);
    for (const bd of this.city.buildings) {
      // Height OR footprint. The gate was pure height at 30 m, so a 10 m
      // Boeing shed the size of a city block popped in at the 800 m ring while
      // a skinny 32 m tower never did -- from a plane, footprint is what you
      // see. 4032 buildings pass; the sub-30 additions take the plain-box path
      // (plant and crown are height-gated) at ~12 triangles each.
      if (bd.h < 16 && bd.w * bd.d < 1400) continue;
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
      // Same tiers the near mesh draws, inset and stopped 2 m short, so the far
      // version is strictly INSIDE the textured geometry wherever both exist.
      const plant = bd.h > 45 ? Math.min(4.5, bd.h * 0.05) : 0;
      const totalH = bd.h + 2 - plant;
      const dk = [col[0] * 0.86, col[1] * 0.88, col[2] * 0.92];
      let topY = bd.y - 2, topW = bd.w * s, topD = bd.d * s;
      for (const tier of buildingTiers(bd, bd.y - 2, totalH)) {
        b.box(bd.x, tier.y, bd.z, tier.w * s, tier.h, tier.d * s, bd.rot,
          tier.t % 2 ? dk : col, { top: true, ao: tier.t === 0 ? 0.3 : 0 });
        topY = tier.y + tier.h; topW = tier.w * s; topD = tier.d * s;
      }
      // Mechanical penthouse, within the top tier's footprint and within the
      // building's own height -- so it cannot stand proud of the near mesh.
      if (plant > 0) {
        b.box(bd.x, topY, bd.z, topW * 0.6, plant, topD * 0.6, bd.rot, dk, { top: true });
        topY += plant;
      }
      // A mast is the one thing that legitimately rises above a parapet, and it
      // is thin enough to read as an antenna rather than as a slab.
      if (bd.h > 80 && hash2(bd.seed, 37) > 0.45) {
        const mh = 8 + hash2(bd.seed, 41) * 22;
        b.box(bd.x, topY, bd.z, 0.9, mh, 0.9, bd.rot, dk, { top: true });
      }
    }
    const m = new THREE.Mesh(b.build(), this.mats.far);
    m.frustumCulled = false;
    this.scene.add(m);
    this.skyline = m;
  }

  /**
   * Every building the skyline skips, as massing for the whole city -- built
   * lazily, the first time the player is off the ground.
   *
   * From a plane the streaming rings were a visible edge: houses, shops and
   * low offices only existed inside the 9x9 mid ring, so everything past
   * ~1.6 km was bare hillside with the tall skyline standing in it, and the
   * housing stock materialised a row of chunks at a time as you flew -- the
   * trace on the Boeing Field route counted 50k buildings popping into view.
   * This is the "static supertile impostor layer" rather than wider rings:
   * one draw per 4x4-chunk supertile.
   *
   * INSIDE THE RING IT HIDES ITSELF, per chunk, in the vertex shader. Every
   * box knows its chunk, and `farBuilt` is a 9x9 mask of ring chunks that have
   * geometry; those boxes collapse to a point. So the layer keeps drawing a
   * chunk until the streamer has actually delivered it -- no hole while it
   * builds, and no double-drawn box once it has.
   *
   * MEMORY IS THE CONSTRAINT, not triangles. The first version stored every
   * box as its own 8 vertices plus 30 indices for all 255,041 small buildings:
   * 47.7 MB of buffers, twice that resident with three's JS copies, built at
   * boot for players who never fly. Three changes took that to a few MB:
   *
   *   - INSTANCED. One shared unit box; each box is a 17-byte instance record
   *     (centre and base in Int16 decimetres off the supertile origin, size in
   *     Uint16 dm, rotation + in-tile chunk index in 2 Uint8, tint in 3). The
   *     supertile's chunk origin comes from the model matrix, so there is no
   *     per-mesh uniform to keep in step.
   *   - HOUSES MERGED per 50 m cell (50 divides a chunk, so a cell never
   *     straddles one): 231k houses and small sheds become 81k boxes, each
   *     covering the cell's real footprint area at its mean roof line. From
   *     1.6 km a house is 3-4 px, so a block reads the same either way. The
   *     23.6k larger low buildings keep their own box.
   *   - JS ARRAYS DROPPED ON UPLOAD. Nothing CPU-side reads them (raycast is
   *     off, the bounding sphere is computed first), and a lost context
   *     rebuilds the layer rather than re-uploading -- see resetFarMass.
   *
   * Flat shading takes each face's normal from screen derivatives, so the
   * unit box needs no normal attribute.
   */
  *farMassSteps() {
    const city = this.city;
    const TILE = CHUNK * 4, CELL = 50;
    // Bin once, in slices: the city's building list is 259k long.
    if (!this._farBins) {
      const bins = new Map();
      const B = city.buildings;
      for (let i = 0; i < B.length; i++) {
        const bd = B[i];
        if (bd.h < 16 && bd.w * bd.d < 1400) {   // the skyline draws the rest
          const tx = Math.floor(bd.x / TILE), tz = Math.floor(bd.z / TILE);
          const k = tx * 1000 + tz;
          let t = bins.get(k);
          if (!t) bins.set(k, (t = { tx, tz, list: [], built: false }));
          t.list.push(bd);
        }
        if (i % 8000 === 7999) yield 'work';
      }
      this._farBins = bins;
    }
    for (;;) {
      // Nearest unbuilt supertile inside the haze radius, biased toward the
      // nose -- chosen fresh each time, because the plane has moved on.
      const px = this._farPx, pz = this._farPz, fx = this.playerFwdX || 0, fz = this.playerFwdZ || 0;
      let best = null, bestS = Infinity;
      for (const t of this._farBins.values()) {
        if (t.built) continue;
        const dx = (t.tx + 0.5) * TILE - px, dz = (t.tz + 0.5) * TILE - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 > FAR_R * FAR_R) continue;
        const s = Math.sqrt(d2) - 0.6 * (dx * fx + dz * fz);
        if (s < bestS) { bestS = s; best = t; }
      }
      if (!best) { yield 'idle'; continue; }
      const t0 = performance.now();
      this.buildFarTile(best, TILE, CELL);
      this.farMassMs = (this.farMassMs || 0) + performance.now() - t0;
      yield 'work';
    }
  }

  /** One supertile's instance records, merged and quantised. */
  buildFarTile(t, TILE, CELL) {
    t.built = true;
    const ox = t.tx * TILE, oz = t.tz * TILE;
    const boxes = [];   // [x, y, z, w, h, d, rot, r, g, b, chunk]
    const cells = new Map();
    for (const bd of t.list) {
      if (bd.style === 'house' || (bd.h < 10 && bd.w * bd.d < 400)) {
        const k = Math.floor(bd.x / CELL) * 100000 + Math.floor(bd.z / CELL);
        let l = cells.get(k);
        if (!l) cells.set(k, (l = []));
        l.push(bd);
      } else boxes.push(this.farBox([bd], ox, oz));
    }
    for (const l of cells.values()) boxes.push(this.farBox(l, ox, oz));
    const n = boxes.length;
    const C = new Int16Array(n * 3), S = new Uint16Array(n * 3), R = new Uint8Array(n * 2), T = new Uint8Array(n * 3);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const b = boxes[i];
      C[i * 3] = Math.round((b[0] - ox) * 10);
      C[i * 3 + 1] = Math.round(b[1] * 10);
      C[i * 3 + 2] = Math.round((b[2] - oz) * 10);
      S[i * 3] = Math.min(65535, Math.round(b[3] * 10));
      S[i * 3 + 1] = Math.min(65535, Math.round(b[4] * 10));
      S[i * 3 + 2] = Math.min(65535, Math.round(b[5] * 10));
      // A box is symmetric under a half turn, so [0, PI) covers every
      // orientation in a byte -- 0.7 deg steps.
      const r = ((b[6] % Math.PI) + Math.PI) % Math.PI;
      R[i * 2] = Math.round(r / Math.PI * 256) % 256;
      R[i * 2 + 1] = b[10];
      T[i * 3] = b[7]; T[i * 3 + 1] = b[8]; T[i * 3 + 2] = b[9];
      const e = Math.hypot(b[3], b[5]) / 2;
      minX = Math.min(minX, b[0] - e); maxX = Math.max(maxX, b[0] + e);
      minZ = Math.min(minZ, b[2] - e); maxZ = Math.max(maxZ, b[2] + e);
      minY = Math.min(minY, b[1]); maxY = Math.max(maxY, b[1] + b[4]);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', this._farUnit.pos);
    geo.setIndex(this._farUnit.idx);
    const attr = (arr, size, norm) => {
      const a = new THREE.InstancedBufferAttribute(arr, size, norm);
      // Nothing CPU-side reads these again; see the note on farMassSteps.
      a.onUpload(function drop() { this.array = null; });
      return a;
    };
    geo.setAttribute('farC', attr(C, 3, false));
    geo.setAttribute('farS', attr(S, 3, false));
    geo.setAttribute('farRI', attr(R, 2, false));
    geo.setAttribute('farTint', attr(T, 3, true));
    geo.instanceCount = n;
    // The unit box's own sphere would be a metre wide; frustum culling needs
    // the tile's, in the mesh's local frame.
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((minX + maxX) / 2 - ox, (minY + maxY) / 2, (minZ + maxZ) / 2 - oz),
      Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
    const fm = new THREE.Mesh(geo, this._farMat);
    fm.position.set(ox, 0, oz);
    // Inside the ring these boxes are collapsed on the GPU only, so a CPU
    // raycast would hit buildings nobody can see -- and every "raycast the
    // pixel" diagnostic in this repo would start blaming them.
    fm.raycast = () => {};
    fm.visible = false;
    fm.userData.cx = ox + TILE / 2;
    fm.userData.cz = oz + TILE / 2;
    this.scene.add(fm);
    this.farMass.push(fm);
    this.farMassCount = (this.farMassCount || 0) + n;
    this.farMassBytes = (this.farMassBytes || 0) + C.byteLength + S.byteLength + R.byteLength + T.byteLength;
  }

  /**
   * One box standing for a list of buildings in the same cell: the rotation
   * of the largest, the extent of all of them in that frame shrunk to their
   * real footprint area, and the area-weighted roof line. A list of one is
   * that building's own box.
   */
  farBox(l, ox, oz) {
    let big = l[0], A = 0, top = 0, tr = 0, tg = 0, tb = 0, base = Infinity;
    for (const bd of l) {
      const a = bd.w * bd.d;
      if (a > big.w * big.d) big = bd;
      A += a;
      top += (bd.y + bd.h) * a;
      base = Math.min(base, bd.y);
      const c = MASS_TINT[bd.style] || MASS_TINT.lowrise;
      const t = (0.86 + hash2(bd.seed, 3) * 0.28) * a;
      tr += c[0] * t; tg += c[1] * t; tb += c[2] * t;
    }
    const cr = Math.cos(big.rot), sr = Math.sin(big.rot);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const bd of l) {
      const bc = Math.cos(bd.rot - big.rot), bs = Math.sin(bd.rot - big.rot);
      // Centre in the big one's frame: the inverse of Builder.box's rotation.
      const dx = bd.x - big.x, dz = bd.z - big.z;
      const lx = dx * cr + dz * sr, lz = -dx * sr + dz * cr;
      const ex = Math.abs(bd.w / 2 * bc) + Math.abs(bd.d / 2 * bs);
      const ez = Math.abs(bd.w / 2 * bs) + Math.abs(bd.d / 2 * bc);
      x0 = Math.min(x0, lx - ex); x1 = Math.max(x1, lx + ex);
      z0 = Math.min(z0, lz - ez); z1 = Math.max(z1, lz + ez);
    }
    const s = Math.min(1, Math.sqrt(A / Math.max(1, (x1 - x0) * (z1 - z0))));
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const cx = big.x + mx * cr - mz * sr, cz = big.z + mx * sr + mz * cr;
    // The chunk the streamer files this under is the one its centroid's chunk
    // is -- for a merged cell every member shares it, because 50 divides 400.
    const lcx = clamp(Math.floor(big.x / CHUNK) - ox / CHUNK, 0, 3);
    const lcz = clamp(Math.floor(big.z / CHUNK) - oz / CHUNK, 0, 3);
    const k = 255 / A;
    return [cx, base - 0.5, cz, (x1 - x0) * s, top / A - base + 0.5, (z1 - z0) * s, big.rot,
      Math.min(255, Math.round(tr * k)), Math.min(255, Math.round(tg * k)), Math.min(255, Math.round(tb * k)),
      lcx + lcz * 4];
  }

  /** Shared state for the far massing, created on first use. */
  initFarMass() {
    const SPAN = 2 * MID_R + 1;
    const U = this.farU = {
      farRing: { value: new THREE.Vector2(-9999, -9999) },
      farBuilt: { value: new Float32Array(SPAN * SPAN) },
      farFade: { value: 0 },
    };
    // Unit box: bottom ring then top ring, the corner order Builder.box uses,
    // walls and roof, no floor. Shared by every supertile.
    const pos = new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
      -0.5, 1, -0.5, 0.5, 1, -0.5, 0.5, 1, 0.5, -0.5, 1, 0.5]);
    const idx = [];
    for (let j = 0; j < 4; j++) {
      const b0 = j, b1 = (j + 1) % 4, t0 = b0 + 4, t1 = b1 + 4;
      idx.push(b0, t0, t1, b0, t1, b1);
    }
    idx.push(4, 7, 6, 4, 6, 5);
    this._farUnit = { pos: new THREE.BufferAttribute(pos, 3), idx: new THREE.BufferAttribute(new Uint16Array(idx), 1) };
    // Same response as `flat`, which is what the mid-ring massing is drawn in.
    const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.82, metalness: 0.04, envMapIntensity: 0.45 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec3 farC;
attribute vec3 farS;
attribute vec2 farRI;
attribute vec3 farTint;
uniform vec2 farRing;
uniform float farBuilt[${SPAN * SPAN}];
varying vec3 vFarTint;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float a = farRI.x * (PI / 256.0);
  float cr = cos(a), sr = sin(a);
  vec3 s = position * farS * 0.1;
  transformed = vec3(farC.x * 0.1 + s.x * cr - s.z * sr, farC.y * 0.1 + s.y, farC.z * 0.1 + s.x * sr + s.z * cr);
  // Builder.box's ao 0.35 on the bottom edge
  vFarTint = farTint * mix(0.65, 1.0, position.y);
  vec2 tile = floor(modelMatrix[3].xz / ${CHUNK}.0 + 0.5);
  vec2 rc = tile + vec2(mod(farRI.y, 4.0), floor(farRI.y / 4.0)) - farRing;
  if (rc.x > -0.5 && rc.y > -0.5 && rc.x < ${SPAN}.0 - 0.5 && rc.y < ${SPAN}.0 - 0.5
      && farBuilt[int(rc.x + 0.5) + int(rc.y + 0.5) * ${SPAN}] > 0.5) transformed = vec3(0.0);
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float farFade;\nvarying vec3 vFarTint;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vFarTint;')
        // The massing's roof slab is 0.45x the wall; with a shared unit box the
        // roof has to be told apart by its facing instead.
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  if (dot(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz) > 0.7) diffuseColor.rgb *= 0.45;`)
        // Fade in THROUGH the haze rather than switching on: climbing past the
        // gate, the distant city emerges from the fog colour over ~1.5 s.
        .replace('#include <fog_fragment>', `#include <fog_fragment>
#ifdef USE_FOG
  gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, farFade);
#endif`);
    };
    this._farMat = mat;
    this.farMass = [];
    // The upload callbacks free the JS arrays, so a restored context has
    // nothing to re-upload from: throw the meshes away and let the lazy
    // builder make them again.
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.addEventListener('webglcontextlost', () => this.resetFarMass());
    }
  }

  resetFarMass() {
    if (!this.farMass) return;
    for (const m of this.farMass) { m.geometry.dispose(); this.scene.remove(m); }
    this.farMass = [];
    this.farMassCount = 0;
    this.farMassBytes = 0;
    if (this._farBins) for (const t of this._farBins.values()) t.built = false;
    this._farGen = null;
    this._farReady = false;
    this.farU.farFade.value = 0;
  }

  /** Mask the far massing under the ring's delivered chunks; build and fade it with altitude. */
  updateFarMass(ccx, ccz, px, pz, budget) {
    // Off the ground only. 45 up / 25 down so a hilltop road does not flicker
    // it; an airborne plane keeps it however low it skims. Until the first
    // time this is true nothing is allocated at all -- on foot and driving
    // the layer costs 0 bytes.
    const alt = this.playerAlt || 0;
    if (!this.farOn && alt > 45) this.farOn = true;
    else if (this.farOn && alt < 25 && !this.playerFlying) this.farOn = false;
    if (!this.farMass) {
      if (!this.farOn) return;
      this.initFarMass();
    }
    this._farPx = px; this._farPz = pz;
    // Build in slices, like the chunks. The slice is only checked between
    // supertiles, so the real spike is the slice plus one tile.
    if (this.farOn) {
      if (!this._farGen) this._farGen = this.farMassSteps();
      const t0 = performance.now(), ms = budget < 2 ? 1.5 : 3;
      let idle = false;
      while (performance.now() - t0 < ms) {
        if (this._farGen.next().value === 'idle') { idle = true; break; }
      }
      if (!this._farReady) this.farMassFrames = (this.farMassFrames || 0) + 1;
      if (idle) this._farReady = true;
    }
    const U = this.farU, SPAN = 2 * MID_R + 1;
    U.farRing.value.set(ccx - MID_R, ccz - MID_R);
    const built = U.farBuilt.value;
    for (let dz = 0; dz < SPAN; dz++) {
      for (let dx = 0; dx < SPAN; dx++) {
        const c = this.chunks.get(this.city.chunkKey(ccx - MID_R + dx, ccz - MID_R + dz));
        built[dx + dz * SPAN] = c && c.lod >= 0 ? 1 : 0;
      }
    }
    const now = performance.now();
    const fdt = this._farT === undefined ? 0 : Math.min(0.1, (now - this._farT) / 1000);
    this._farT = now;
    // Hold the first fade-in until every supertile in range has been built, so
    // the first appearance is the city emerging, not tiles arriving one by one.
    const rising = this.farOn && this._farReady;
    const f = clamp(U.farFade.value + (rising ? fdt : -fdt) / 1.5, 0, 1);
    U.farFade.value = f;
    for (const m of this.farMass) {
      const dx = m.userData.cx - px, dz = m.userData.cz - pz;
      m.visible = f > 0 && dx * dx + dz * dz < FAR_R * FAR_R;
    }
  }

  /** For harnesses: is the far massing currently drawing what this chunk holds? */
  farMassCovers(ch) {
    if (!this.farU || this.farU.farFade.value <= 0.5 || !this._farBins) return false;
    const T = CHUNK * 4;
    const t = this._farBins.get(Math.floor(ch.cx * CHUNK / T) * 1000 + Math.floor(ch.cz * CHUNK / T));
    return !!(t && t.built);
  }

  animate(dt, t) {
    if (this.skyDome) this.skyDome.material.uniforms.time.value = t % 100000;
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
    // FLYING LOD. At 400 km/h a full-detail chunk build (~50-100 ms, sliced)
    // cannot keep pace with a 400 m grid -- the maths is simply against it,
    // and the city materialised directly under the plane. From 100 m up you
    // cannot read facades anyway, so the near ring builds MASSING-ONLY while
    // high: box chunks build in a few milliseconds and the streamer stays
    // ahead at any speed the plane can reach. Hysteresis (100 up / 60 down)
    // so skimming rooftops does not flap the whole ring between LODs.
    if (this.flyLod === undefined) this.flyLod = false;
    const alt = this.playerAlt || 0;
    // Altitude is measured over the terrain directly underneath, and a level
    // plane crossing Beacon Hill or Queen Anne sees that fall from 140 m to
    // 40 m and back in seconds -- the 100/60 band flipped the whole near ring
    // between LODs 5 times on one route, each flip a 5x5 detail rebuild the
    // streamer cannot hold at flying speed anyway. While AIRBORNE the ring
    // only drops back to detail on a real approach (under 25 m).
    const floor = this.playerFlying ? 25 : 60;
    if (!this.flyLod && alt > 100) this.flyLod = true;
    else if (this.flyLod && alt < floor) this.flyLod = false;
    for (let dz = -MID_R; dz <= MID_R; dz++) {
      for (let dx = -MID_R; dx <= MID_R; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        const r = Math.max(Math.abs(dx), Math.abs(dz));
        const key = this.city.chunkKey(cx, cz);
        want.add(key);
        const have = this.chunks.get(key);
        // The 3x3 directly under the player stays FULL DETAIL even in the
        // flying LOD: v58 boxed the whole near ring and the closest buildings
        // became the crudest thing on screen. Three detailed chunks per row
        // crossed is a build rate the streamer holds at 400 km/h -- it was
        // the full 5x5 it could not.
        const lod = (r <= NEAR_R && (!this.flyLod || r <= 1)) ? 1 : 0;
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
    // Build AHEAD of the nose first. Sorted by distance alone, the chunk you
    // are about to overfly ranks equal with the one you just left; at speed
    // that is exactly backwards.
    const fx = this.playerFwdX || 0, fz = this.playerFwdZ || 0;
    todo.sort((a, b) =>
      (a.dist - 2.5 * (((a.cx + 0.5) * CHUNK - px) / CHUNK * fx + ((a.cz + 0.5) * CHUNK - pz) / CHUNK * fz))
      - (b.dist - 2.5 * (((b.cx + 0.5) * CHUNK - px) / CHUNK * fx + ((b.cz + 0.5) * CHUNK - pz) / CHUNK * fz)));

    // Spend a fixed slice of the frame on geometry, however much of a chunk
    // that turns out to buy. `budget` used to be a COUNT of whole chunks, which
    // is a number of unknown cost: two near chunks is about 100 ms of blocking
    // JavaScript, and the frame it lands on is simply lost.
    //
    // One build is carried across frames at a time. If the player has moved far
    // enough that the chunk in progress is no longer wanted, it is dropped --
    // nothing was added to the scene, so there is nothing to undo.
    // A phone's JavaScript is slower than the machine this was tuned on, and
    // the slice can only be checked BETWEEN yields -- so the real spike is the
    // slice plus one step. Keep both small.
    //
    // Spend more when a long way behind. During normal driving only a chunk or
    // two changes at a time and a small slice keeps up easily -- at 4 ms a
    // chunk lands in about a fifth of a second, against the thirteen seconds it
    // takes to cross one at speed. After a respawn or a fast run across the map
    // there can be dozens outstanding, and creeping through those at 4 ms a
    // frame means watching the city assemble around you.
    const behind = todo.length;
    const sliceMs = budget < 2 ? 2 : behind > 30 ? 14 : behind > 12 ? 9 : 4;
    const t0 = performance.now();
    while (performance.now() - t0 < sliceMs) {
      if (!this._build) {
        const c = todo.find((k) => k.lod !== k.wantLod && k !== this._buildFor);
        if (!c) break;
        this._buildFor = c;
        this._buildLod = c.wantLod;
        this._build = this.buildChunkStep(c.cx, c.cz, c.wantLod);
      }
      const c = this._buildFor;
      // The chunk stopped being wanted, or wants a different detail level than
      // the one being built. Start again rather than finish work nobody needs.
      if (c.wantLod !== this._buildLod) { this._build = null; this._buildFor = null; continue; }
      const step = this._build.next();
      if (!step.done) continue;
      // **Swap, never dispose-then-build.**
      //
      // The old geometry has to stay on screen until its replacement is ready.
      // Disposing first was fine when a build finished inside the same frame;
      // now that it is spread over a dozen or more, it leaves a 400 m square of
      // bare terrain where the chunk used to be -- a hard straight edge across
      // the road, with the ground showing through beyond it, for a fifth of a
      // second or longer. Chunk borders are axis-aligned, which is exactly what
      // makes the seam look like a rendering fault rather than a missing chunk.
      const old = c.group;
      c.group = step.value || null;
      c.lod = this._buildLod;
      if (c.group) this.group.add(c.group);
      if (old) {
        old.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        this.group.remove(old);
      }
      this._build = null;
      this._buildFor = null;
    }
    this.updateFarMass(ccx, ccz, px, pz, budget);
    return todo.length;
  }

  disposeChunk(c) {
    // An in-flight build for this chunk is now stale.
    if (this._buildFor === c) { this._build = null; this._buildFor = null; }
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

  /**
   * Build a chunk a piece at a time.
   *
   * This used to be one synchronous call and the streamer ran TWO of them per
   * frame. Measured, a near chunk takes a median 48.7 ms and up to 137 ms, so
   * any frame that crossed into new territory spent about 100 ms -- and at
   * worst 274 ms -- inside this function, against a 16.7 ms budget. That is the
   * dropped frames and stalls while driving: not the renderer at all, but the
   * geometry being generated in the middle of a frame.
   *
   * Yielding lets the caller stop partway and come back next frame, so the cost
   * per frame is bounded by a clock rather than by how much happens to be in
   * this particular 400 m square. Same shape as `cityGenerator`, which already
   * does this for the initial load.
   *
   * Nothing is added to the scene until the last yield, so an abandoned build
   * leaves nothing half-drawn.
   */
  *buildChunkStep(cx, cz, lod) {
    const city = this.city;
    const ck = city.chunkKey(cx, cz);
    const ch = city.chunks.get(ck);
    if (!ch) return null;
    this._ck = ck;
    const road = new Builder(true);
    const walk = new Builder(true);
    const flat = new Builder(false);
    const glow = new Builder(false);
    const bl = { glass: new Builder(true), facade: new Builder(true) };
    // Road structure -- walls, parapets, fascia -- is textured concrete from the
    // facade atlas, so it draws into this chunk's facade mesh: no new material
    // and no new draw where the chunk has buildings anyway.
    this._facade = bl.facade;

    const own = (x, z) => Math.floor(x / CHUNK) === cx && Math.floor(z / CHUNK) === cz;
    const nodesDone = new Set();
    // Solid objects are registered as the geometry is generated, so the old
    // set is dropped here rather than at the top: a build now spans many frames,
    // and clearing first would leave the trees still on screen with no collision
    // until it finished.
    city.clearObstacles(ck);

    // Yield every so many items rather than every one: the check itself costs
    // something, and a handful of roads or buildings is well under a frame.
    let since = 0;
    for (const ei of ch.edges) {
      const e = city.edges[ei];
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (!own(mx, mz)) continue;
      this.meshRoad(road, walk, flat, glow, e, a, b, lod, ei);
      this.meshLid(road, flat, ei);   // a slab over a portal cutting, if any
      for (const ni of [e.a, e.b]) {
        if (nodesDone.has(ni)) continue;
        const n = city.nodes[ni];
        if (!own(n.x, n.z)) continue;
        nodesDone.add(ni);
        this.meshNode(road, flat, ni, n, lod, walk);
      }
      if (++since >= 3) { since = 0; yield; }
    }

    if (lod === 1) {
      since = 0;
      for (const bi of ch.buildings) {
        this.meshBuilding(bl, flat, glow, city.buildings[bi]);
        if (++since >= 10) { since = 0; yield; }
      }
      yield;
      this.meshProps(flat, glow, ch, cx, cz);
      yield;
    } else {
      // Mid-ring massing: every building the far skyline skips, as one merged
      // box mesh per chunk. From the air the old mid ring was bare ground, so
      // the whole housing stock materialised at the 800 m detail ring -- the
      // pop-in. A box at 800-1600 m is indistinguishable from the real
      // building at that size; when the chunk promotes, the swap reads as
      // detail arriving, not a city appearing. ~18 triangles a building
      // (walls plus the roof slab), one draw a chunk.
      since = 0;
      // Tinted by STYLE with a darker roof slab, because one pale beige for
      // every box read as a city of white blocks -- from the air, wall tone
      // and a roof line are most of what says "building".
      //
      // Builder.box anchors y at the BASE (by..by+h) -- review caught that
      // these walls had been passed a CENTRE y since v56, floating half their
      // height with the new roof slab buried inside them. The wall now starts
      // half a metre into the ground -- deliberately LESS than the real
      // mesher's 2 m embed: a massing box lives 800 m away where a slope gap
      // under a corner is invisible, and the shallower skirt is cheaper.
      for (const bi of ch.buildings) {
        const bd = city.buildings[bi];
        if (bd.h >= 16 || bd.w * bd.d >= 1400) continue;   // skyline draws these
        const base = MASS_TINT[bd.style] || MASS_TINT.lowrise;
        const t = 0.86 + hash2(bd.seed, 3) * 0.28;
        const wall = [base[0] * t, base[1] * t, base[2] * t];
        flat.box(bd.x, bd.y - 0.5, bd.z, bd.w, bd.h + 0.5, bd.d, bd.rot, wall, { ao: 0.35, top: false });
        flat.box(bd.x, bd.y + bd.h, bd.z, bd.w * 0.96, 0.24, bd.d * 0.96, bd.rot,
          [wall[0] * 0.45, wall[1] * 0.45, wall[2] * 0.47]);
        if (++since >= 40) { since = 0; yield; }
      }
      yield;
    }

    const grp = new THREE.Group();
    const add = (bld, mat, cast, recv) => {
      if (bld.empty) return;
      const m = new THREE.Mesh(bld.build(), mat);
      // Not everything that can cast a shadow earns one.
      //
      // The shadow pass re-renders every caster, so each one costs a second
      // draw call and a second pass over its geometry. Measured downtown, the
      // props/trees/roof-kit mesh alone was 10 draws and 122k triangles of
      // shadow -- 13 % of the frame's geometry -- for shadows that at street
      // level fall mostly on surfaces already in shade. On a phone that is not
      // where the budget goes; on a desktop it is worth having.
      m.castShadow = cast && this.shadows && !(ON_PHONE && mat === this.mats.flat);
      m.receiveShadow = recv && this.shadows;
      grp.add(m);
    };
    add(road, this.mats.road, false, true);
    add(walk, this.mats.walk, false, true);
    add(flat, this.mats.flat, true, true);
    add(glow, this.mats.glow, false, false);
    add(bl.glass, this.mats.glass, true, true);
    add(bl.facade, this.mats.facade, true, true);
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
  /**
   * The two graded edges at a node that carry straight on through it, or null.
   *
   * Chosen once per node and MUTUALLY: the pair whose directions line up best.
   * If each edge picked its own best partner, a main line could pick the ramp
   * while the ramp picked the main line's other half, and the three would
   * mitre onto three different points -- the splayed joint all over again.
   * Same class is preferred, so a diverge keeps the freeway continuous and the
   * ramp square-ended inside it.
   */
  continuation(ni) {
    const city = this.city, n = city.nodes[ni];
    let pa = -1, pb = -1, best = 0.5;
    for (let p = 0; p < n.e.length; p++) {
      const ea = city.edges[n.e[p]];
      if (!ea.prof) continue;
      const ax = ni === ea.b ? ea.dx : -ea.dx, az = ni === ea.b ? ea.dz : -ea.dz;
      for (let q = p + 1; q < n.e.length; q++) {
        const eb = city.edges[n.e[q]];
        if (!eb.prof) continue;
        const bx = ni === eb.a ? eb.dx : -eb.dx, bz = ni === eb.a ? eb.dz : -eb.dz;
        const c = ax * bx + az * bz - (ea.cls === eb.cls ? 0 : 0.1);
        if (c > best) { best = c; pa = n.e[p]; pb = n.e[q]; }
      }
    }
    return pa < 0 ? null : [pa, pb];
  }

  deckEdgePoint(ni, e, sg, w) {
    const city = this.city;
    const n = city.nodes[ni];
    let ox = -e.dz * sg, oz = e.dx * sg;
    let dist = w;
    // Mitre into the continuation, whatever else meets here. This used to
    // mitre only a node with exactly one other deck of the same width, so
    // every merge, every lane-count change and every bridge touchdown onto
    // ground freeway was square-ended -- and a square end at a bend is a
    // wedge of missing tarmac outside it and an overlap inside.
    const pair = this.continuation(ni);
    let other = null;
    if (pair) {
      const e0 = city.edges[pair[0]], e1 = city.edges[pair[1]];
      if (e0 === e) other = e1; else if (e1 === e) other = e0;
    }
    if (other) {
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
  /**
   * An elevated span on its graded profile: deck, girder, parapets, piers.
   *
   * The old span was ONE quad from node height to node height, so it could
   * only ever be a straight ramp, and an overpass that has to clear the road
   * under it in the middle could not be drawn at all. Lofting along the
   * profile samples draws whatever gradeRoads decided, and the mitred edge
   * lines still keep deck, girder and rail registered with the next span.
   *
   * A parapet is not built where it would stand on another carriageway. Each
   * span offsets its rails by its own perpendicular, so at a merge the main
   * line's rail walled the ramp off and the ramp's inner rail ran straight
   * across the main line's lanes -- the white walls standing in the middle of
   * I-5 downtown. Where a rail piece is inside another road's carriageway at
   * the same level it is left out and the girder face stops at deck level.
   */
  meshGradedDeck(road, flat, e, a, b, ei) {
    const GIRDER = 1.35, PARAPET = 0.55, RAIL = 0.95;
    // One concrete family with the retaining walls and the tunnel: mid-grey,
    // near the tarmac rather than the sky. The rails were [0.68, 0.68, 0.66]
    // -- near-white under the tone curve, and the brightest thing in frame.
    const conc = [0.5, 0.5, 0.49], concLo = [0.4, 0.4, 0.39];
    // Fascia and the rail's traffic face are the big vertical areas, so they
    // take the facade atlas's cast-concrete cell (joints, ties, staining).
    const face = this._facade || flat;
    const ccell = this._facade ? this.cells.concrete : null;
    const CU = (fr) => (ccell ? ccell[0] + fr * ccell[1] : fr);
    const faceCol = [0.8, 0.8, 0.79];
    const hw = e.hw, k = e.pk;
    const along = Math.atan2(e.dx, e.dz);
    const run = {}, deck = {};
    for (const sg of [-1, 1]) {
      const [rsx, rsz] = this.deckEdgePoint(e.a, e, sg, hw);
      const [rex, rez] = this.deckEdgePoint(e.b, e, sg, hw);
      run[sg] = { sx: rsx, sz: rsz, ex: rex, ez: rez, sg };
      const [dsx, dsz] = this.deckEdgePoint(e.a, e, sg, hw + PARAPET);
      const [dex, dez] = this.deckEdgePoint(e.b, e, sg, hw + PARAPET);
      deck[sg] = { sx: dsx, sz: dsz, ex: dex, ez: dez, sg };
    }
    // A point on an edge line at t, pulled in where that side was trimmed off
    // a lower neighbour (citygen's split levels), so deck, soffit, fascia and
    // rail all follow the trimmed edge together.
    const at = (c, t) => {
      const i = Math.min(k, Math.max(0, Math.round(t * k)));
      const cut = hw - e.tw[i * 2 + (c.sg > 0 ? 0 : 1)];
      return [c.sx + (c.ex - c.sx) * t + e.dz * c.sg * cut, c.sz + (c.ez - c.sz) * t - e.dx * c.sg * cut];
    };
    // Drawn 3 cm under the standing height, as the old deck was (y + 0.06
    // drawn against y + 0.09 stood on).
    const Y = (i) => e.ph[i] - 0.03;
    const col = e.cls === 'hwy' ? [0.92, 0.92, 0.92] : [1, 1, 1];
    const seg = e.len / k, U = (2 * hw) / ROAD_TILE;
    const wasOpen = { 1: null, '-1': null };
    for (let i = 0; i < k; i++) {
      const t0 = i / k, t1 = (i + 1) / k, y0 = Y(i), y1 = Y(i + 1);
      const [l0x, l0z] = at(run[1], t0), [l1x, l1z] = at(run[1], t1);
      const [r0x, r0z] = at(run[-1], t0), [r1x, r1z] = at(run[-1], t1);
      const v0 = (i * seg) / ROAD_TILE, v1 = ((i + 1) * seg) / ROAD_TILE;
      road.quad([l0x, y0, l0z], [r0x, y0, r0z], [r1x, y1, r1z], [l1x, y1, l1z],
        [0, 1, 0], [0, v0, U, v0, U, v1, 0, v1], col);
      const [p0x, p0z] = at(deck[1], t0), [p1x, p1z] = at(deck[1], t1);
      const [q0x, q0z] = at(deck[-1], t0), [q1x, q1z] = at(deck[-1], t1);
      flat.quad([q0x, y0 - GIRDER, q0z], [p0x, y0 - GIRDER, p0z],
        [p1x, y1 - GIRDER, p1z], [q1x, y1 - GIRDER, q1z],
        [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], conc);
      for (const sg of [-1, 1]) {
        const R0 = at(run[sg], t0), R1 = at(run[sg], t1);
        const D0 = at(deck[sg], t0), D1 = at(deck[sg], t1);
        const ox = -e.dz * sg, oz = e.dx * sg;
        const mx = (R0[0] + R1[0] + D0[0] + D1[0]) / 4, mz = (R0[1] + R1[1] + D0[1] + D1[1]) / 4;
        const my = (y0 + y1) / 2 + 0.03;
        let open = !!this.city.carriagewayAt(mx, mz, my, ei);
        // Two decks side by side each built a parapet on the shared side --
        // two walls back to back down the middle of the freeway, with a slot
        // of daylight between them. Where another carriageway at this level
        // starts within 3 m outboard, the pair gets ONE low median barrier,
        // drawn by whichever edge has the lower index.
        let median = false;
        if (!open) {
          const px3 = mx + ox * 3.0, pz3 = mz + oz * 3.0;
          const nb = this.city.carriagewayAt(px3, pz3, my, ei, 0.9);
          if (nb) {
            if (nb - 1 > ei) median = true; else open = true;
          } else if (this.city.carriagewayAt(px3, pz3, my + 2.2, ei, 1.3)) {
            // The neighbour is up to 3.5 m HIGHER. Its own girder face is the
            // wall on this side; a rail here was the second, lower wall of the
            // staggered pair between I-5's express lanes and the main line --
            // the decks there sit 0.6-3 m apart and 1.6-2.8 m out of level,
            // just past the same-level test. A LOWER neighbour keeps this
            // rail: that is a drop, and a drop wants a parapet.
            open = true;
          }
        }
        const top = open ? 0 : median ? 0.8 : RAIL;
        // Fascia: girder and rail in one cast-concrete face.
        face.quad([D0[0], y0 - GIRDER, D0[1]], [D1[0], y1 - GIRDER, D1[1]],
          [D1[0], y1 + top, D1[1]], [D0[0], y0 + top, D0[1]],
          [ox, 0, oz], [CU(0), 0, CU(1), 0, CU(1), 1, CU(0), 1], faceCol);
        // Capping over the wall, or over the bare deck edge where it is open.
        flat.quad([D0[0], y0 + top, D0[1]], [D1[0], y1 + top, D1[1]],
          [R1[0], y1 + top, R1[1]], [R0[0], y0 + top, R0[1]],
          [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], open ? concLo : conc);
        if (!open) {
          // the rail's traffic face: the lower 40 % of the tile, so its base
          // carries the texture's grime band where spray collects
          face.quad([R0[0], y0, R0[1]], [R1[0], y1, R1[1]],
            [R1[0], y1 + RAIL, R1[1]], [R0[0], y0 + RAIL, R0[1]],
            [-ox, 0, -oz], [CU(0), 0, CU(1), 0, CU(1), 0.4, CU(0), 0.4], faceCol);
        }
        // A rail that stops needs an end, or you see into a hollow wall.
        if (wasOpen[sg] !== null && wasOpen[sg] !== open) {
          flat.quad([R0[0], y0, R0[1]], [D0[0], y0, D0[1]],
            [D0[0], y0 + RAIL, D0[1]], [R0[0], y0 + RAIL, R0[1]],
            [e.dx * (open ? 1 : -1), 0, e.dz * (open ? 1 : -1)], [0, 0, 1, 0, 1, 1, 0, 1], conc);
        }
        wasOpen[sg] = open;
      }
    }
    // A trimmed side stands over a lower road. Where that road is below the
    // girder, finish the drop with a wall rather than leave the lower lanes
    // looking up into a hollow slot under the deck edge.
    for (const sg of [1, -1]) {
      const s = sg > 0 ? 0 : 1;
      let runPts = [];
      const flush = () => {
        if (runPts.length > 1) this.meshWall(flat, runPts, -e.dz * sg, e.dx * sg, ei * 2 + s + 13);
        runPts = [];
      };
      for (let i = 0; i <= k; i++) {
        const lo = e.tlo[i * 2 + s];
        const bottom = e.ph[i] - 0.03 - GIRDER;
        if (Number.isNaN(lo) || lo - 0.3 >= bottom - 0.15) { flush(); continue; }
        const [x, z] = at(deck[sg], i / k);
        runPts.push([x, z, bottom, lo - 0.3]);
      }
      flush();
    }

    // Piers on a realistic bay, standing on the profile.
    const bays = Math.max(1, Math.round(e.len / 52));
    for (let p = 0; p < bays; p++) {
      const t = (p + 0.5) / bays;
      const cx = lerp(a.x, b.x, t), cz = lerp(a.z, b.z, t);
      const capTop = this.city.profAt(e, t).h - 0.03 - GIRDER;
      let base = G.terrainHeight(cx, cz);
      if (capTop - base <= 4) continue;
      if (G.isWater(cx, cz)) {
        flat.prism(cx, base, cz, 4.2, 1.4 - base, 8, concLo);
        flat.box(cx, 1.4, cz, 9.4, 0.55, 9.4, along, conc);
        base = 1.95;
      } else {
        flat.prism(cx, base - 1.2, cz, 3.2, 1.7, 8, concLo);
        base += 0.3;
      }
      flat.prism(cx, base, cz, 2.4, capTop - 1.8 - base, 8, conc);
      flat.box(cx, capTop - 1.8, cz, (hw + PARAPET) * 1.9, 1.8, 3.6, along, concLo);
    }
    this.meshRoadMarks(flat, e, a, b, ei);
  }

  meshViaduct(road, flat, e, a, b, ei) {
    if (e.prof) { this.meshGradedDeck(road, flat, e, a, b, ei); return; }
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
      [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], conc);

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
        [ox, 0, oz], [0, 0, 1, 0, 1, 1, 0, 1], conc);
      // Capping over the wall.
      flat.quad(
        [d.sx, ay + RAIL, d.sz], [d.ex, by + RAIL, d.ez],
        [r.ex, by + RAIL, r.ez], [r.sx, ay + RAIL, r.sz],
        [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], conc);
      // Inner face, facing the traffic.
      flat.quad(
        [r.sx, ay, r.sz], [r.ex, by, r.ez],
        [r.ex, by + RAIL, r.ez], [r.sx, ay + RAIL, r.sz],
        [-ox, 0, -oz], [0, 0, 1, 0, 1, 1, 0, 1], conc);
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
    // A graded road paints on its profile. Decks draw 3 cm under the standing
    // height and carry no bias; ground graded strips draw at it plus bias.
    // PAINT RIDES THE LID. A road carried over a portal cutting on a slab
    // (buildLids) is drawn at raw ground + LID_TOP, and its draped markings
    // were left on the carved ground under it -- a slab with no lines on it.
    // Where this road has a slab, paint sits MARK_Y - ROAD_LIFT over the slab
    // top instead, and the stripes are cut short enough to follow the slab's
    // edge down into the dip where it ends.
    const lidded = ei != null && this._lidByEdge && this._lidByEdge.has(ei);
    const LID_TOP = ROAD_LIFT + 0.04;
    const yAt = e.prof
      ? (x, z, t, o) => {
        const P = this.city.profAt(e, t);
        return e.elev ? P.h - 0.03 + 0.012 : P.h + P.s * o + bias + 0.012;
      }
      : lidded
        ? (x, z) => {
          const l = this.city.lidAt(x, z);
          return l !== null ? l + LID_TOP + (MARK_Y - ROAD_LIFT) + bias : G.terrainHeight(x, z) + MARK_Y + bias;
        }
        : (x, z) => G.terrainHeight(x, z) + MARK_Y + bias;
    const W = 0.06;                             // half-width of a painted line
    const WHITE = [0.94, 0.93, 0.88];
    const YELLOW = [0.88, 0.72, 0.2];

    const stripe = (off, from, to, col) => {
      if (to <= from) return;
      const t0 = from / e.len, t1 = to / e.len;
      const cx0 = lerp(a.x, b.x, t0) + px * off, cz0 = lerp(a.z, b.z, t0) + pz * off;
      const cx1 = lerp(a.x, b.x, t1) + px * off, cz1 = lerp(a.z, b.z, t1) + pz * off;
      const mx = (cx0 + cx1) / 2, mz = (cz0 + cz1) / 2;
      if (ei != null && this.city.roadCoveredAt(mx, mz, ei)) return;
      // Paint does not cross another carriageway. A ramp's edge line used to
      // run on across the main line's lanes at a merge, and the main line's
      // across the ramp: lines crossing at a shallow angle in the gore.
      if (e.prof && this.city.carriagewayAt(mx, mz, yAt(mx, mz, (t0 + t1) / 2, off), ei)) return;
      const l0x = cx0 + px * W, l0z = cz0 + pz * W, r0x = cx0 - px * W, r0z = cz0 - pz * W;
      const l1x = cx1 + px * W, l1z = cz1 + pz * W, r1x = cx1 - px * W, r1z = cz1 - pz * W;
      flat.quad(
        [l0x, yAt(l0x, l0z, t0, off + W), l0z],
        [r0x, yAt(r0x, r0z, t0, off - W), r0z],
        [r1x, yAt(r1x, r1z, t1, off - W), r1z],
        [l1x, yAt(l1x, l1z, t1, off + W), l1z],
        [0, 1, 0], ZERO_UV, col
      );
    };

    // Paint stops short of a junction, the same way the pavement strips do.
    // Run end to end and each road lays its edge lines straight across every
    // cross street it meets -- white lines cutting the carriageway diagonally
    // and centre dashes doubling back on themselves. The crossing itself is
    // bare tarmac, which is what a real junction mostly is.
    //
    // A graded node that is not an at-grade junction is not a crossing at all:
    // it is where one ~40 m piece of freeway hands over to the next. Trimming
    // there took nodeRadius -- the freeway's whole half-width -- off both ends
    // of every piece, so only 60 % of 225 km of freeway carried any lines and
    // I-5's edge lines were dashes with 14 m gaps. Crossing paint on those is
    // stopped by the carriageway test above instead.
    const trim = (ni) => {
      const n = this.city.nodes[ni];
      return n.prof && !n.anchor ? 0 : this.nodeRadius(ni);
    };
    const from = trim(e.a);
    const till = e.len - trim(e.b);
    if (till <= from) return;

    // Edge lines, set in from the kerb by about a shoulder's width -- the
    // TRIMMED kerb on a graded road stood off a lower neighbour, or the line
    // runs out over the wall.
    const inset = Math.min(0.7, hw * 0.06);
    const sideW = (m, s) => {
      if (!e.tw) return hw;
      const i = Math.min(e.pk, Math.max(0, Math.round((m / e.len) * e.pk)));
      return e.tw[i * 2 + s];
    };
    // subdivide so a line follows the terrain rather than spanning it (and a
    // slab's end, 0.5 m stations, rather than bridging off it)
    const step = lidded ? 1 : 8;
    for (let s = from; s < till; s += step) {
      const to = Math.min(till, s + step);
      stripe(sideW((s + to) / 2, 0) - inset, s, to, WHITE);
      stripe(-(sideW((s + to) / 2, 1) - inset), s, to, WHITE);
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

  /**
   * One tunnel edge: deck, two walls, ceiling, lamp strip, and -- where an end
   * node also carries a surface edge -- a portal frame. Heights come straight
   * from the nodes' profiled y, the same numbers groundAt serves, so a car's
   * ride height and the drawn deck agree by construction.
   */
  meshTunnel(road, flat, glow, e, a, b, ei) {
    const hw = e.hw;
    const px = -e.dz, pz = e.dx;
    const WALL = 5.4, DECK = 0.3;
    const ay = a.y + DECK, by = b.y + DECK;
    // MITRED JOINTS. Each edge was a rectangle ending square at its nodes, so
    // at every bend two consecutive pieces of the same tube overlapped in a
    // wedge on the inside -- two coplanar decks and roofs, z-fighting -- and
    // left a wedge gap on the outside. Measured with downward rays at the
    // start node of every SR-99 edge, 16.9 % doubled on master. The ends are
    // sheared onto the bisector with the most collinear tunnel neighbour
    // (within 60 deg), as meshViaduct mitres its decks, so the pieces meet.
    const city = this.city;
    const partners = [];
    const mitreK = (ni, atB) => {
      const n = city.nodes[ni];
      let best = null, bd = 0.5, bk = -1;
      for (const k of n.e) {
        if (k === ei) continue;
        const f = city.edges[k];
        if (!f.tunnel || f.elev) continue;
        const o = city.nodes[f.a === ni ? f.b : f.a];
        const L = Math.hypot(o.x - n.x, o.z - n.z) || 1;
        // the neighbour's direction continuing THROUGH the node
        const wx = atB ? (o.x - n.x) / L : (n.x - o.x) / L;
        const wz = atB ? (o.z - n.z) / L : (n.z - o.z) / L;
        const dt = wx * e.dx + wz * e.dz;
        if (dt > bd) { bd = dt; best = [wx, wz]; bk = k; }
      }
      if (!best) return 0;
      partners.push(bk);
      let mx = px - best[1], mz = pz + best[0];            // bisector of the perpendiculars
      const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      const den = e.dx * mz - e.dz * mx;
      if (Math.abs(den) < 1e-6) return 0;
      return clamp(-(px * mz - pz * mx) / den, -1, 1);
    };
    const kA = mitreK(e.a, false), kB = mitreK(e.b, true);
    const E = (t, o) => t + (o * (kA * (1 - t) + kB * t)) / e.len;
    const P = (t, o) => { const te = E(t, o); return [lerp(a.x, b.x, te) + px * o, lerp(a.z, b.z, te) + pz * o]; };
    const Y = (t) => lerp(ay, by, t);
    // Height and along-position of any plan point, by projection -- the same
    // number groundAt's deck query gives there.
    const tl = (x, z) => ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len;
    const Yl = (x, z) => lerp(ay, by, tl(x, z));
    const conc = [0.42, 0.43, 0.45];

    // THE TERRAIN IS NEVER EXCAVATED, SO THERE IS NO SUCH THING AS AN OPEN CUT.
    //
    // The obvious way to draw a portal is a descending trench with retaining
    // walls, and it cannot work here: the heightfield is one surface every
    // consumer shares ("The one height surface"), nothing cuts a slot in it,
    // and a deck that descends below it is simply *inside the hill*. Measured
    // at the north SR-99 mouth, a ray dropped on the carriageway hit terrain at
    // 26.3 / 26.8 / 27.1 m while the deck ran 26.1 / 23.4 / 20.7 -- the trench
    // was drawn, and buried. That is why the entrance read as nothing at all.
    //
    // So the bore is always a closed tube, and the portal is a STRUCTURE
    // standing at grade: you drive in at ground level and the tube dives away
    // behind the headwall. Where the tube is still above ground it gets an
    // earth berm over it, which is what a portal approach in flat ground looks
    // like in life -- a concrete face in a landscaped mound, not a lidded
    // culvert lying on a lawn, which is what the free-standing slabs were.
    const seg = Math.max(2, Math.ceil(e.len / 9));
    const BERM = [0.30, 0.32, 0.24];
    // Against the RAW ground: terrainHeight now carries the trench, so asking
    // it whether the bore is covered inside its own cut always answers "no".
    const exposed = (t) => {
      const [cx, cz] = P(t, 0);
      return (Y(t) + WALL + CUT_COVER) - G.terrainRaw(cx, cz);
    };

    const pool = (t) => 0.72 + 0.28 * Math.cos((lerp(0, e.len, t) / 18) * Math.PI * 2);
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg, t1 = (i + 1) / seg;
      const tm = (t0 + t1) / 2;
      // OPEN WHERE THE GROUND IS CUT AWAY, a bore where it is not. This is the
      // distinction the branch could not express until the terrain gained a
      // hole: with ground drawn over the corridor there was nothing an open cut
      // could be open TO, so the roof had to stay on the whole way and the
      // mouth had nothing to read as an entrance.
      // A BORE IS OPEN EXACTLY WHERE THE GROUND WAS DUG, and nowhere else.
      // Deciding it from cover instead -- "less than CUT_COVER over the roof,
      // therefore open" -- is true of every shallow tunnel in the city, not
      // just the approaches, so retaining walls were raised along buried
      // stretches that have no trench and they blanketed the ground for
      // hundreds of metres either side of the mouth. inCut is the same test
      // that decided whether to dig, so the two cannot disagree.
      const [mx, mz] = P(tm, 0);
      const bur = !this.inCut(mx, mz, Y(tm) - DECK);
      // A MOUTH IS A BLACK HOLE. The lamp pools start at full strength right
      // behind the headwall, so the bore was a pale grey box and the opening
      // read as a recess in a wall rather than as somewhere the road goes.
      // Eyes adapted to daylight see nothing for the first stretch inside a
      // real portal; this darkens the same way, recovering over ~30 m of cover.
      const dark = (t) => 0.16 + 0.84 * clamp(-exposed(t) / 30, 0, 1);
      const l0 = pool(t0) * dark(t0), l1 = pool(t1) * dark(t1);
      const [a0x, a0z] = P(t0, hw), [a1x, a1z] = P(t0, -hw);
      const [b0x, b0z] = P(t1, hw), [b1x, b1z] = P(t1, -hw);

      // Deck, walls and ceiling are all UNLIT: a bore sits in the shadow map's
      // darkness, so sun-lit materials render near-black in it. The light is
      // baked into the vertex colours instead -- lamp pools every 18 m.
      // ONE DECK WHERE THE TWINS SHARE A HOLE. The two SR-99 tubes are profiled
      // to a common floor where they overlap (citygen's twin blend), so their
      // decks lie within a few cm of each other across ~2.8 km -- and two
      // surfaces that close z-fight, which is the patchy, flickering floor.
      // Measured by casting down at the drawn geometry. The deck is drawn in
      // ~3 x 1.75 m cells, each owned-tested at its corners and centre
      // against LOWER-numbered tubes whose rectangle holds it at a deck within
      // 0.25 m (twinOwner). A cell wholly inside one is dropped; a cell partly
      // covered is CLIPPED against each owner's rectangle and only the part
      // outside is drawn, so every patch of a shared floor is drawn by exactly
      // one tube. Two cruder versions were measured and discarded: dropping
      // whole cells left slivers along the overlap that doubled 17 % of
      // downward rays (master: 6.9 %), and a 2 x 4 re-split still 13.6 %.
      // The mitre partners are exempt -- they meet this edge on the bisector
      // and no longer overlap it.
      const cells = (t0c, t1c, draw) => {
        const na = Math.max(1, Math.ceil(((t1c - t0c) * e.len) / 3));
        const nb = Math.max(1, Math.ceil((hw * 2) / 1.75));
        for (let ia = 0; ia < na; ia++) {
          const sa = t0c + ((t1c - t0c) * ia) / na, sb = t0c + ((t1c - t0c) * (ia + 1)) / na;
          for (let ib = 0; ib < nb; ib++) {
            const oa = hw - (hw * 2 * ib) / nb, ob = hw - (hw * 2 * (ib + 1)) / nb;
            const poly = [P(sa, oa), P(sa, ob), P(sb, ob), P(sb, oa)];
            const cx = (poly[0][0] + poly[2][0]) / 2, cz = (poly[0][1] + poly[2][1]) / 2;
            const ks = new Set();
            let all = true;
            for (const [x, z] of [...poly, [cx, cz]]) {
              const k = this.twinOwner(x, z, Yl(x, z) - DECK, ei, -1, partners);
              if (k < 0) all = false; else ks.add(k);
            }
            if (!ks.size) { draw(poly); continue; }
            if (all && ks.size === 1) continue;
            let pieces = [poly];
            for (const k of ks) {
              const q = this._tunByK.get(k);
              pieces = pieces.flatMap((pp) => this._outsideRect(pp, q));
            }
            for (const pp of pieces) if (pp.length >= 3 && polyArea(pp) > 0.02) draw(pp);
          }
        }
      };
      // A convex plan polygon as a fan of (degenerate-fourth-corner) quads, so
      // both builders' UV and per-corner colour paths serve it.
      const fan = (bld, poly, vy, nrm, uvOf, colOf) => {
        const v = poly.map(([x, z]) => [x, vy(x, z), z]);
        for (let k = 1; k + 1 < v.length; k++) {
          const ids = [0, k, k + 1, k + 1];
          const uv = [];
          for (const id of ids) { const u2 = uvOf ? uvOf(poly[id]) : [0, 0]; uv.push(u2[0], u2[1]); }
          bld.quad(v[0], v[k], v[k + 1], v[k + 1], nrm, uv, ids.map((id) => colOf(poly[id])));
        }
      };
      const lAt = (t) => pool(t) * dark(t);
      if (bur) {
        cells(t0, t1, (poly) => fan(glow, poly, Yl, [0, 1, 0], null, ([x, z]) => {
          const l = lAt(tl(x, z)); return [0.34 * l, 0.34 * l, 0.36 * l];
        }));
      } else {
        // In the cut the sun reaches the road, so it is ordinary asphalt rather
        // than the unlit interior material a bore needs.
        // Match the tint ordinary asphalt is drawn with. At [1,1,1] the
        // approach ramps came out markedly paler than every road around them
        // and read as poured concrete slabs fanning out of the mouth -- the
        // "pale ramps going nowhere" that survived five rounds of elimination
        // precisely because they ARE road, just the wrong shade of it.
        const ac = [0.74, 0.74, 0.75], ae = [0.62, 0.62, 0.63];
        // UVs from the plan point, so a clipped piece keeps the texture
        // registered with its neighbours; the same ae -> ac gradient along
        // the segment the single quad had.
        cells(t0, t1, (poly) => fan(road, poly, Yl, [0, 1, 0],
          ([x, z]) => [(hw - ((x - a.x) * px + (z - a.z) * pz)) / ROAD_TILE, (tl(x, z) * e.len) / ROAD_TILE],
          ([x, z]) => {
            const f = clamp((tl(x, z) - t0) / (t1 - t0), 0, 1);
            return [lerp(ae[0], ac[0], f), lerp(ae[1], ac[1], f), lerp(ae[2], ac[2], f)];
          }));
      }
      if (i % 2 === 0
        && this.twinOwner(...P(tm, 0), Y(tm) - DECK, ei, -1, partners) < 0) {
        const [c0x, c0z] = P(t0, 0.10), [c1x, c1z] = P(t0 + (t1 - t0) * 0.55, 0.10);
        const [q0x, q0z] = P(t0, -0.10), [q1x, q1z] = P(t0 + (t1 - t0) * 0.55, -0.10);
        glow.quad([c0x, Y(t0) + 0.02, c0z], [q0x, Y(t0) + 0.02, q0z],
          [q1x, Y(t1) + 0.02, q1z], [c1x, Y(t1) + 0.02, c1z],
          [0, 1, 0], ZERO_UV, [0.85, 0.8, 0.55]);
      }
      for (const sd of [1, -1]) {
        const [w0x, w0z] = P(t0, hw * sd), [w1x, w1z] = P(t1, hw * sd);
        if (bur) {
          // NO WALL IN A TWIN'S LANE. The barrier drops the pieces that stand
          // inside another bore's carriageway (inOtherBore), and the drawing
          // has to agree -- a wall you can see is a wall you believe in, and
          // driving through one is the same bug from the other side. Tested on
          // the barrier's own line (hw + 0.4) in the same ~3 m pieces, so the
          // drawn opening and the collision opening coincide.
          const subN = Math.max(1, Math.ceil(((t1 - t0) * e.len) / 3));
          for (let j = 0; j < subN; j++) {
            const s0 = t0 + ((t1 - t0) * j) / subN, s1 = t0 + ((t1 - t0) * (j + 1)) / subN;
            const [mwx, mwz] = P((s0 + s1) / 2, (hw + 0.4) * sd);
            if (this.inOtherBore(mwx, mwz, lerp(a.y, b.y, (s0 + s1) / 2), ei)) continue;
            const [v0x, v0z] = P(s0, hw * sd), [v1x, v1z] = P(s1, hw * sd);
            const m0 = pool(s0) * dark(s0), m1 = pool(s1) * dark(s1);
            const c0 = [0.42 * m0, 0.43 * m0, 0.45 * m0], c1 = [0.42 * m1, 0.43 * m1, 0.45 * m1];
            // heights at the mitred points, so the wall foot meets the deck
            const y0 = Yl(v0x, v0z), y1 = Yl(v1x, v1z);
            glow.quad([v0x, y0, v0z], [v1x, y1, v1z],
              [v1x, y1 + WALL, v1z], [v0x, y0 + WALL, v0z],
              [-px * sd, 0, -pz * sd], ZERO_UV, [c0, c1, c1, c0]);
          }
        } else if (false) {
          // Superseded: the cutting is faced in one pass off portalCuts, so
          // that the walls cannot stop where this function's idea of "open"
          // does. Kept as a marker of why it moved.
          const [r0x, r0z] = P(t0, (hw + CUT_SH) * sd), [r1x, r1z] = P(t1, (hw + CUT_SH) * sd);
          // terrainRaw: the wall's job is to hold back the ground that WAS
          // there. Against the carved surface it stops at the trench floor it
          // is standing in and retains nothing.
          // A MINIMUM HEIGHT, so the channel exists from the first metre. Left
          // to follow the ground the wall tapers to nothing at the mouth,
          // where the deck is still near grade -- and a 0.5 m wall seen from a
          // driver's eye is a pale ribbon lying on the ground, not a wall. A
          // real cutting carries its parapet the whole way out. 3.2 m is above
          // the windows of a car, which is what makes the road read as being
          // IN something.
          // 3.2 m was tried and is too much HERE, because a mouth is rarely
          // one bore: at SR-99 north three carriageways fan out, each with two
          // walls, and at car-window height they merge into a fence of slabs
          // across the whole approach -- the exact shape of the original
          // complaint. 1.8 m reads as a channel from a driver's eye and still
          // lets you see the portal you are aiming at.
          const MINW = 1.8;
          const g0 = Math.max(G.terrainRaw(r0x, r0z) + 0.35, Y(t0) + MINW);
          const g1 = Math.max(G.terrainRaw(r1x, r1z) + 0.35, Y(t1) + MINW);
          flat.quad([w0x, Y(t0) - 0.5, w0z], [w1x, Y(t1) - 0.5, w1z],
            [w1x, g1, w1z], [w0x, g0, w0z],
            [-px * sd, 0, -pz * sd], ZERO_UV, conc);
          flat.quad([w0x, g0, w0z], [w1x, g1, w1z], [r1x, g1, r1z], [r0x, g0, r0z],
            [0, 1, 0], ZERO_UV, conc);
          // Verge: the hole is cut CUT_SH wider than the carriageway, so
          // without this strip the floor of the trench has a gap at each edge
          // and the map-wide water plane shows through it as a blue sliver.
          flat.quad([w0x, Y(t0), w0z], [w1x, Y(t1), w1z],
            [r1x, Y(t1), r1z], [r0x, Y(t0), r0z],
            [0, 1, 0], ZERO_UV, [0.44, 0.45, 0.42]);
        }
      }
      if (bur) {
        // The ceiling follows the deck's ownership rule: two roofs within a
        // few cm fight exactly as two floors do.
        cells(t0, t1, (poly) => fan(glow, poly, (x, z) => Yl(x, z) + WALL, [0, -1, 0], null, ([x, z]) => {
          const l = lAt(tl(x, z)); return [0.20 * l, 0.20 * l, 0.22 * l];
        }));
        // LAMPS, NOT A LIGHT SLOT. The strip used to run the full length of
        // the bore, 1 m wide, at [1, 0.95, 0.8] -- and the chase camera's
        // ceiling clamp holds it about 0.8 m under the roof, where a 1 m strip
        // fills a third of the frame as one pale wedge converging on the
        // vanishing point. Raycast at SB bore +200 (camera 12.58, strip 13.4):
        // every bright pixel in the top of the frame was that quad. It read as
        // a hole to the sky. Discrete 1.4 x 0.35 m fixtures every 6 m are what a
        // tunnel's lighting is, and at that size the camera sees a line of
        // lamps instead of a slot.
        const s0 = t0 * e.len, s1 = t1 * e.len;
        for (let sl = Math.ceil(s0 / 6) * 6; sl + 1.4 <= s1 + 1e-6; sl += 6) {
          const ta = sl / e.len, tb = (sl + 1.4) / e.len;
          if (this.twinOwner(...P((ta + tb) / 2, 0), Y((ta + tb) / 2) - DECK, ei, -1, partners) >= 0) continue;
          const [f0x, f0z] = P(ta, 0), [f1x, f1z] = P(tb, 0);
          glow.quad(
            [f0x - px * 0.175, Y(ta) + WALL - 0.06, f0z - pz * 0.175],
            [f0x + px * 0.175, Y(ta) + WALL - 0.06, f0z + pz * 0.175],
            [f1x + px * 0.175, Y(tb) + WALL - 0.06, f1z + pz * 0.175],
            [f1x - px * 0.175, Y(tb) + WALL - 0.06, f1z - pz * 0.175],
            [0, -1, 0], ZERO_UV, [0.92, 0.88, 0.74]);
        }
      }

      // NO EXTERIOR SHELL ON THE BORE ITSELF.
      //
      // Three versions of one were tried -- an earth berm, a sloped bank, and
      // a crown-plus-side-wall box -- and every one of them fails the same way
      // for the same reason: a shell over a tube that is only sometimes above
      // ground has to END somewhere, and wherever it ends it is a slab
      // cantilevered into open air. Head-on that is invisible, which is how
      // all three got signed off; from an oblique camera it is a lid hanging
      // in the sky, and it scored 2/10 on connected geometry.
      //
      // The mouth is enclosed by the headwall and the throat, both of which are
      // bounded structures with every edge landing on something. Past them the
      // bore is underground and needs no outside at all. What the terrain does
      // in between is a heightfield problem -- see the note in citygen -- and
      // not something another slab can paper over.
    }

    // THE PORTAL FACE is ONE HEADWALL FOR THE WHOLE MOUTH, drawn by
    // meshPortalWall below. Every bore that surfaces here shares it. This edge
    // only decides whether it is the one that owns the drawing.
    for (const ndi of [e.a, e.b]) {
      const grp = this.portalGroups().get(ndi);
      if (!grp || grp.owner.ni !== ndi || grp.owner.ei !== ei) continue;
      this.meshPortalWall(flat, grp, WALL, DECK, conc);
    }
  }

  /**
   * Portal nodes grouped into MOUTHS, computed once and cached.
   *
   * A portal node is a tunnel node that also carries a surface edge. A divided
   * road has one per carriageway, a few metres apart and a few metres offset
   * along the road, and drawing a frame per node is what produced the reported
   * mess: two goalposts at different stations and different heights, the gap
   * between them reading as a third opening, and four jambs that reach nothing.
   *
   * Nodes within 60 m whose bores run near-parallel (either sense -- one
   * carriageway goes in as the other comes out) are one mouth. The member with
   * the lowest tunnel-edge index owns it, so every chunk makes the same
   * decision without sharing any state.
   */
  portalGroups() {
    if (this._pgroups) return this._pgroups;
    const city = this.city;
    const ports = [];
    for (let ni = 0; ni < city.nodes.length; ni++) {
      const n = city.nodes[ni];
      const tun = n.e.filter((k) => city.edges[k].tunnel && !city.edges[k].elev);
      if (!tun.length || !n.e.some((k) => !city.edges[k].tunnel)) continue;
      let be = city.edges[tun[0]];
      for (const k of tun) if (city.edges[k].hw > be.hw) be = city.edges[k];
      const o = city.nodes[be.a === ni ? be.b : be.a];
      const L = Math.hypot(o.x - n.x, o.z - n.z) || 1;
      ports.push({
        ni, x: n.x, y: n.y, z: n.z, hw: be.hw,
        dx: (o.x - n.x) / L, dz: (o.z - n.z) / L,
        ei: Math.min(...tun),
      });
    }
    const groups = [];
    for (const p of ports) {
      let g = null;
      for (const q of groups) {
        const h = q.members[0];
        if (Math.hypot(h.x - p.x, h.z - p.z) > 60) continue;
        if (Math.abs(h.dx * p.dx + h.dz * p.dz) < 0.87) continue;   // within ~30 deg
        // Bores staggered along the road are still ONE mouth -- a divided
        // highway's two carriageways routinely enter 20-30 m apart. Splitting
        // on station instead produced three walls at three depths, which from
        // the road is a slab standing in front of the holes. They are joined
        // by a throat below rather than separated here.
        if (Math.abs((p.x - h.x) * h.dx + (p.z - h.z) * h.dz) > 50) continue;
        g = q; break;
      }
      if (!g) groups.push((g = { members: [] }));
      g.members.push(p);
    }
    const byNode = new Map();
    for (const g of groups) {
      g.owner = g.members.reduce((x, y) => (y.ei < x.ei ? y : x));
      for (const m of g.members) byNode.set(m.ni, g);
    }
    this._pgroups = byNode;
    return byNode;
  }

  /**
   * One slab across the whole mouth with a hole per bore.
   *
   * Everything is built in the OWNER's frame and at ONE height, which is the
   * point: the lintel is a single box with a single top and a single soffit,
   * and the piers are whatever is left of the wall between the holes. Nothing
   * can end in mid-air, because nothing is placed independently -- the piers
   * are defined by the gaps, not positioned.
   */
  meshPortalWall(flat, grp, WALL, DECK, conc) {
    // THE WALL STANDS WHERE THE GROUND CLOSES OVER THE ROAD, not at the kerb.
    // With the corridor cut out of the terrain the approach is an open trench,
    // and a headwall at the near end has that trench behind it: you look
    // straight through the opening and out the far side, which reads as a
    // gantry over the road. The portal is the FAR end of the cut -- drive down
    // the trench, then under the hill.
    this.portalCuts();
    const endsOf = (m) => (this._pcutBy.get(m.ni) || []).map((c) => endOfCut(c, m));
    const endOfCut = (c, m) => {
      if (!c || c.pts.length < 2) return { x: m.x, y: m.y, z: m.z, hw: m.hw, ni: m.ni };
      // STAND CLEAR OF THE CLIFF. The carve stops at the last corridor point
      // and tapers over CUT_BANK, so the ground drops ~14 m across 2.4 m
      // there -- a cliff, which the 5 m terrain patch resolves into a stack of
      // blocky sand faces. A wall on that exact station has the blocks poking
      // out around it, which is the sand that judges kept reading AS the
      // headwall. Pulled back a few metres, the wall hides the whole thing.
      // The last point is the CAP -- the raised closure that brings the ground
      // over the bore. The wall belongs at the last real corridor point, where
      // the cutting actually ends; anchored on the cap it climbs 7 m and walks
      // 14 m down the tunnel, leaving an earth mound facing the driver.
      let li = c.pts.length - 1;
      while (li > 0 && c.pts[li].cap) li--;
      const p = c.pts[li];
      const q = c.pts[li - 1] || p;
      const L = Math.hypot(p.x - q.x, p.z - q.z) || 1;
      const bx = (p.x - q.x) / L, bz = (p.z - q.z) / L;
      const BACK = 1.5;
      return { x: p.x - bx * BACK, y: p.y + (p.y - q.y) * (-BACK / L),
               z: p.z - bz * BACK, hw: p.hw, ni: m.ni };
    };
    // every branch end is a mouth in its own right
    const all0 = [];
    for (const m of grp.members) {
      const es = endsOf(m);
      if (!es.length) all0.push({ x: m.x, y: m.y, z: m.z, hw: m.hw, ni: m.ni });
      else all0.push(...es);
    }
    // The owner's bearing comes from its widest branch -- the one the clusters
    // are laid out against.
    const ocs = this._pcutBy.get(grp.owner.ni) || [];
    const oc = ocs.reduce((x, y) => (!x || y.pts.length > x.pts.length ? y : x), null);
    const O = { ...(all0.find((e) => e.ni === grp.owner.ni) || grp.owner) };
    if (oc && oc.pts.length >= 2) {
      const q = oc.pts[oc.pts.length - 1], r = oc.pts[oc.pts.length - 2];
      const L = Math.hypot(q.x - r.x, q.z - r.z) || 1;
      O.dx = (q.x - r.x) / L; O.dz = (q.z - r.z) / L;
    } else { O.dx = grp.owner.dx; O.dz = grp.owner.dz; }
    const px = -O.dz, pz = O.dx;
    const rot = Math.atan2(O.dx, O.dz);
    // The shoulder has to reach past the CUTTING, not just past the bore: the
    // trench is dug CUT_SH wider than the carriageway on each side, so a wall
    // sized to the bore alone leaves a strip of raw earth face showing beyond
    // each end of it.
    // Deep, so the box swallows the blocky terrain face instead of sitting on
    // it like a sheet. A 5 m depth was tried once BEFORE every crossing bore
    // got a hole, and it planted a solid pier in a driving lane -- that was the
    // missing hole, not the depth.
    // The shoulder reaches past the whole cut cross-section -- shelf, overcut
    // and bank -- so the terminal earth face where the cutting dead-ends into
    // the hill is behind concrete for its full width. At CUT_SH + 2.6 the wall
    // stopped 1.8 m short of the bank top and a full-height strip of dirt
    // showed beyond each end of the headwall.
    const DEPTH = 6.0, SHOULDER = CUT_SH + CUT_OVER + CUT_BANK + 0.6;

    // Lateral extent of each bore, in the owner's cross-road axis, merged so
    // two overlapping carriageways cannot leave a sliver of pier between them.
    // THE WALL GOES AHEAD OF EVERY BORE, AND EVERY BORE IS THEN CONNECTED TO
    // IT. Either half alone is a defect that shipped: the wall at the owner's
    // station leaves a bore further out poking through it, and the wall pushed
    // forward without the throat leaves it standing free ahead of the holes
    // with daylight behind -- the floating pillar. The throat is what makes
    // the wall part of the tunnel instead of a screen near it.
    // ONE WALL PER STATION CLUSTER, AND THE WINDOW IS TIGHT.
    //
    // A wall has one job: to stand at the face of earth where the cutting ends
    // and carry the openings through it. The wall goes on the FIRST member of
    // its cluster, so the window is also how far short of that face the wall
    // may land -- at 25 m it landed 26 m short and 3 m low, and the player
    // drove down a correct cutting into solid ground with the portal stranded
    // behind them. 6 m merges only ends that genuinely coincide.
    //
    // The window still has to exist: without it a single wall served every
    // bore of a mouth and threw a throat forward to reach the stragglers,
    // which portalcheck measured at 165, 207 and 274 m of invented tube.
    const all = all0;
    const key = (m) => (m.x - O.x) * O.dx + (m.z - O.z) * O.dz;
    all.sort((a, b) => key(a) - key(b));
    const clusters = [];
    for (const m of all) {
      const last = clusters[clusters.length - 1];
      if (last && key(m) - key(last[0]) <= 6) last.push(m);
      else clusters.push([m]);
    }
    // ONE SOFFIT FOR THE WHOLE MOUTH. Each cluster sized its opening from its
    // own bore, so where three carriageways surface together at slightly
    // different depths the three black openings stepped to three different
    // heights and merged into a jagged staircase -- read by a judge as "an
    // unlit black wall, not a bore mouth". Real portals at one site share a
    // soffit line. p2, which is a single bore, was already scoring 8/10 with
    // the same code; this is what the multi-bore sites were missing.
    const soffit = Math.max(...all.map((m) => m.y)) + DECK + WALL;
    for (const M of clusters) this._portalWall(flat, O, M, all, soffit, WALL, DECK, conc);
    // FACE THE APPROACH RAMP TOO. The bore's own stretch is walled; the ramp in
    // front of it was left as raw earth batters, so the last thing you see
    // before the portal is a dirt trench -- the "construction scene" again, at
    // exactly the point the player is looking. The walls run from the floor of
    // the cut up to untouched ground, on the same line the ground was carved
    // to, so the batter is faced the whole way in.
    for (const m of grp.members) {
      const c = this._pcutBy.get(m.ni);
      if (!c || !c.apron) continue;
      // THE WHOLE CORRIDOR, not just the ramp. The walls used to come from two
      // places -- this loop for the approach and meshTunnel for the open-cut
      // segments -- and neither covered the stretch right at the mouth, where
      // meshTunnel has already flipped to drawing a bore. That is where the
      // bank was left bare, and it is the sand that filled the opening in
      // every close shot.
      for (let i = 0; i < c.pts.length - 1; i++) {
        const a = c.pts[i], b = c.pts[i + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
        const qx = -uz, qz = ux;
        const steps = Math.max(1, Math.ceil(L / 8));
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps, t1 = (k + 1) / steps;
          const p0 = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0, y: a.y + (b.y - a.y) * t0 };
          const p1 = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1, y: a.y + (b.y - a.y) * t1 };
          for (const sd of [1, -1]) {
            const w = (a.hw + CUT_SH) * sd;
            const w0x = p0.x + qx * w, w0z = p0.z + qz * w;
            const w1x = p1.x + qx * w, w1z = p1.z + qz * w;
            // THE WALL RETAINS THE UNION, NOT THIS CORRIDOR. At a divided mouth
            // the carriageways enter staggered, and each corridor's excavation
            // overlaps its neighbour's. Topping every wall at terrainRaw built
            // a 13 m slab wherever a wall line ran through a neighbour's pit --
            // freestanding concrete fins criss-crossing the shared cutting, one
            // of them standing in the neighbour's driving lane. What a wall has
            // to hold back is whatever the ground BEHIND it actually is after
            // every corridor has dug, which is terrainHeight past this
            // corridor's own bank: untouched ground gives the full-height wall
            // exactly as before, a shallower neighbouring pit gives a terraced
            // step up to its floor, and a deeper one gives nothing to retain,
            // so the fin is simply not built. Bounded -- one carved sample per
            // wall quad end, no marching.
            const wb = (a.hw + CUT_SH + CUT_OVER + CUT_BANK + 0.5) * sd;
            const g0 = G.terrainHeight(p0.x + qx * wb, p0.z + qz * wb) + 0.35;
            const g1 = G.terrainHeight(p1.x + qx * wb, p1.z + qz * wb) + 0.35;
            if (g0 - p0.y < 0.6 && g1 - p1.y < 0.6) continue;   // nothing to retain
            flat.quad([w0x, p0.y - 0.5, w0z], [w1x, p1.y - 0.5, w1z],
              [w1x, Math.max(g1, p1.y - 0.45), w1z], [w0x, Math.max(g0, p0.y - 0.45), w0z],
              [-qx * sd, 0, -qz * sd], ZERO_UV, conc);
          }
        }
      }
    }
  }

  _portalWall(flat, Oin, M, allEnds, soffit, WALL, DECK, conc) {
    const O = { ...Oin, x: M[0].x, y: M[0].y, z: M[0].z };
    const px = -O.dz, pz = O.dx;
    const rot = Math.atan2(O.dx, O.dz);
    // The shoulder has to reach past the CUTTING, not just past the bore: the
    // trench is dug CUT_SH wider than the carriageway on each side, so a wall
    // sized to the bore alone leaves a strip of raw earth face showing beyond
    // each end of it.
    // Deep, so the box swallows the blocky terrain face instead of sitting on
    // it like a sheet. A 5 m depth was tried once BEFORE every crossing bore
    // got a hole, and it planted a solid pier in a driving lane -- that was the
    // missing hole, not the depth.
    // The shoulder reaches past the whole cut cross-section -- shelf, overcut
    // and bank -- so the terminal earth face where the cutting dead-ends into
    // the hill is behind concrete for its full width. At CUT_SH + 2.6 the wall
    // stopped 1.8 m short of the bank top and a full-height strip of dirt
    // showed beyond each end of the headwall.
    const DEPTH = 6.0, SHOULDER = CUT_SH + CUT_OVER + CUT_BANK + 0.6;
    // The wall plane sits on the FIRST bore of the cluster, so no member is
    // ever in front of it and every throat is short by construction.
    const along = (m) => (m.x - O.x) * O.dx + (m.z - O.z) * O.dz;
    const ox = O.x, oz = O.z;
    // The throat: bore cross-section carried forward from each mouth to the
    // wall plane, so there is no gap between the two.
    for (const m of M) {
      const L = along(m);
      if (L < 0.5) continue;
      m.__throat = true;
      const q0x = m.x - O.dx * L, q0z = m.z - O.dz * L;
      const dy = m.y + DECK, ry = m.y + DECK + WALL;
      const e0 = [q0x + px * m.hw, q0z + pz * m.hw], e1 = [q0x - px * m.hw, q0z - pz * m.hw];
      const f0 = [m.x + px * m.hw, m.z + pz * m.hw], f1 = [m.x - px * m.hw, m.z - pz * m.hw];
      this._throat(flat, e0, e1, f0, f1, dy, ry, px, pz, conc);
    }

    // Lateral extent of each bore in the cross-road axis, merged so two
    // overlapping carriageways cannot leave a sliver of pier between them.
    // EVERY BORE THAT CROSSES THIS WALL GETS A HOLE, not only the ones in this
    // cluster. The wall spans its own members plus shoulders, and at a mouth
    // where carriageways sit a few metres apart that span reaches over a
    // neighbouring bore belonging to a different cluster -- where the wall was
    // solid, so a pier stood square in a driving lane.
    const holes = allEnds
      .map((m) => {
        const u = (m.x - ox) * px + (m.z - oz) * pz;
        return [u - m.hw, u + m.hw];
      })
      .sort((h, k) => h[0] - k[0]);
    const merged = [holes[0].slice()];
    for (const h of holes.slice(1)) {
      const last = merged[merged.length - 1];
      // MERGE ONLY WHAT ACTUALLY OVERLAPS. A 1.6 m tolerance swallowed the
      // pier between adjacent carriageways, so three bores became one black
      // band as wide as the cutting -- read as a missing wall rather than an
      // entrance. Real portals put a pier between barrels; leaving the gap
      // means one gets built, because the piers ARE the gaps.
      if (h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
      else merged.push(h.slice());
    }
    // ONE Y for the whole wall, from the bore it stands on. min/max across the
    // cluster looks safer and is not: one member on higher ground drags the
    // lintel metres above every roof it caps.
    const deckY = O.y + DECK;
    const roofY = soffit;
    let capY = Math.max(roofY, G.terrainRaw(ox, oz)) + 2.4;
    const uMin = merged[0][0] - SHOULDER;
    const uMax = merged[merged.length - 1][1] + SHOULDER;
    const at = (u) => [ox + px * u, oz + pz * u];
    // A ROAD ON A LID PASSES OVER THIS HEADWALL. The lintel stands 2.4 m
    // proud of the ground, and where buildLids carries a surface road across
    // the cutting -- the SR-99 surface over the northbound mouth -- that is a
    // concrete block across the carriageway (visual only; the chase camera sat
    // looking down onto it). Capped just under the slab there: the face still
    // reads full height from the trench, and from the road it is not there.
    for (let k = 0; k <= 8; k++) {
      const [sx, sz] = at(uMin + ((uMax - uMin) * k) / 8);
      if (this.city.lidAt(sx, sz) !== null) {
        capY = Math.min(capY, Math.max(roofY + 0.3, G.terrainRaw(sx, sz) + ROAD_LIFT - 0.05));
      }
    }

    // THE MOUTH CARD. A heightfield cannot express a tunnel entrance: ground is
    // one value per point, so where the cutting ends it must step from road
    // level to above the roof, and that step is a vertical column filling
    // exactly the bore's cross-section -- the face of earth seen through every
    // opening on this branch. It is not a placement bug; the wall is measurably
    // where it belongs.
    //
    // So the opening shows the TUNNEL rather than what is behind it: an unlit
    // near-black quad across each hole, set just inside the wall plane, facing
    // out. From the road it is the dark mouth the whole portal exists to
    // present. From inside the bore it is backfacing and therefore not there at
    // all, so you drive straight through it.
    for (const [h0, h1] of merged) {
      const [m0x, m0z] = at(h0), [m1x, m1z] = at(h1);
      // Inset behind the face, so the headwall shows a reveal on all four
      // sides of the opening instead of the black sitting flush with it.
      // Flush, it reads as a hole in a sheet; recessed, as a portal.
      const bx = O.dx * (DEPTH / 2 - 0.9), bz = O.dz * (DEPTH / 2 - 0.9);
      // THE SILL GOES UNDER THE TARMAC. The bore's deck and the drawn road are
      // not the same height: the road is laid on the carved ground plus
      // ROAD_LIFT, which sits about 0.4 m below the deck the bore is profiled
      // from. Starting the card at deck level left a strip of daylight along
      // the bottom with the carriageway and its centreline running visibly
      // underneath -- the mouth read as a panel hung above the road rather
      // than a hole in the end of it.
      const sill = Math.max(Math.min(deckY, G.terrainHeight(m0x, m0z), G.terrainHeight(m1x, m1z)) - 0.6,
        this._roofUnder((m0x + m1x) / 2 + bx, (m0z + m1z) / 2 + bz, deckY) + 0.05);
      flat.quad(
        [m0x + bx, sill, m0z + bz], [m1x + bx, sill, m1z + bz],
        [m1x + bx, roofY, m1z + bz], [m0x + bx, roofY, m0z + bz],
        [-O.dx, 0, -O.dz], ZERO_UV, [0.035, 0.035, 0.045]);
    }

    const parts = [];
    const [lx, lz] = at((uMin + uMax) / 2);
    flat.box(lx, roofY, lz, uMax - uMin, capY - roofY, DEPTH, rot, conc);
    parts.push({ kind: 'lintel', x: lx, z: lz, base: roofY, top: capY, w: uMax - uMin });

    // The piers ARE the gaps: outer shoulders and whatever lies between two
    // bores. Defined by subtraction, so none of them can float.
    const piers = [[uMin, merged[0][0]]];
    for (let i = 0; i < merged.length - 1; i++) piers.push([merged[i][1], merged[i + 1][0]]);
    piers.push([merged[merged.length - 1][1], uMax]);
    for (const [p0, p1] of piers) {
      if (p1 - p0 < 0.4) continue;
      const [cx, cz] = at((p0 + p1) / 2);
      // ...but never down through the roof of a deck running underneath
      let foot = Math.min(deckY, G.terrainHeight(cx, cz)) - 1.5;
      for (const f of [-0.5, 0, 0.5]) {
        for (const u of [p0 + 0.05, (p0 + p1) / 2, p1 - 0.05]) {
          const [ux, uz] = at(u);
          foot = Math.max(foot, this._roofUnder(ux + O.dx * DEPTH * f, uz + O.dz * DEPTH * f, deckY) + 0.05);
        }
      }
      flat.box(cx, foot, cz, p1 - p0, roofY - foot, DEPTH, rot, conc);
      parts.push({ kind: 'pier', x: cx, z: cz, base: foot, top: roofY, w: p1 - p0 });
    }
    // Kept so a check can ask what was actually built rather than look at a
    // picture of it: every part's foot against the ground under it, and every
    // mouth's station against the wall's. Both defects that shipped -- a pier
    // hanging in the air and a wall detached in front of the holes -- are one
    // subtraction each from this, and neither is visible in a front-on render.
    (this.portalParts || (this.portalParts = [])).push({
      x: ox, z: oz, dx: O.dx, dz: O.dz, roofY, deckY, uMin, uMax, parts,
      mouths: M.map((m) => ({
        x: m.x, y: m.y, z: m.z, hw: m.hw, throat: !!m.__throat,
        along: (m.x - ox) * O.dx + (m.z - oz) * O.dz,
      })),
    });
  }

  /** Deck, two walls and a ceiling between two cross-sections of a bore. */
  _throat(flat, e0, e1, f0, f1, dy, ry, px, pz, conc) {
    flat.quad([e0[0], dy, e0[1]], [e1[0], dy, e1[1]], [f1[0], dy, f1[1]], [f0[0], dy, f0[1]],
      [0, 1, 0], ZERO_UV, [0.30, 0.30, 0.32]);
    flat.quad([e0[0], ry, e0[1]], [f0[0], ry, f0[1]], [f1[0], ry, f1[1]], [e1[0], ry, e1[1]],
      [0, -1, 0], ZERO_UV, [0.22, 0.22, 0.24]);
    flat.quad([e0[0], dy, e0[1]], [f0[0], dy, f0[1]], [f0[0], ry, f0[1]], [e0[0], ry, e0[1]],
      [-px, 0, -pz], ZERO_UV, conc);
    flat.quad([e1[0], dy, e1[1]], [f1[0], dy, f1[1]], [f1[0], ry, f1[1]], [e1[0], ry, e1[1]],
      [px, 0, pz], ZERO_UV, conc);
  }

  /**
   * A graded ground freeway or ramp: tarmac on its profile rather than on the
   * terrain, cambered with the hill, with an embankment down to the ground.
   *
   * Everything reads `e.ph` / `e.pg` / `e.pe`, the same arrays groundAt's
   * per-sample decks and roadLift's batter are built from, so the drawn surface
   * and the one you stand on agree by construction. The edge lines are the
   * mitred ones decks use, so consecutive pieces meet edge to edge instead of
   * each being square-ended with a junction square laid over the joint -- 8913
   * of those squares sat on ground freeway, one every ~40 m of I-5.
   */
  /**
   * A finished retaining or median wall along one side of a graded road, from
   * its edge down to the road or ground below.
   *
   * The first retaining wall was one flat untextured quad, and beside I-5's
   * express lanes it read as a giant blank slab -- worse than the batter it
   * replaced. Concrete walls read as walls from their joints and their edges:
   * cast panels every ~4 m with a slightly different tone each, a darker
   * footing where grime collects, a pale coping on top. `pts` is a list of
   * [x, z, top, bottom] along the wall; `out` is its outward normal.
   */
  meshWall(flat, pts, ox, oz, seed) {
    // Mid-grey weathered concrete, the same family as the tunnel's walls and
    // the deck fascia, textured from the facade atlas's `concrete` cell. The
    // first pass was a near-white vertex colour: at Mercer and beside I-5's
    // express lanes the walls were the brightest, flattest thing in frame and
    // read as the same "weird guardrails" they replaced.
    const face = this._facade || flat;
    const cell = this._facade ? this.cells.concrete : null;
    const U = (fr) => (cell ? cell[0] + fr * cell[1] : fr);
    const COPE = 0.18;
    const tone = [0.8, 0.8, 0.79], cope = [0.47, 0.47, 0.46];
    // Under ~1.2 m of drop a full wall is wrong: a lane edge that high is
    // guarded by a Jersey barrier, and the drop below it is just a kerb face.
    let maxDrop = 0;
    for (const p of pts) maxDrop = Math.max(maxDrop, p[2] - p[3]);
    const jersey = maxDrop < 1.2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0, t0, b0] = pts[i], [x1, z1, t1, b1] = pts[i + 1];
      if (t0 - b0 < 0.15 && t1 - b1 < 0.15 && !jersey) continue;
      // one cast panel per piece, a tonal step each
      const k = 0.92 + hash2((seed | 0) + i * 7, 31) * 0.14;
      const col = [tone[0] * k, tone[1] * k, tone[2] * k];
      face.quad([x0, b0, z0], [x1, b1, z1], [x1, t1, z1], [x0, t0, z0],
        [ox, 0, oz], [U(0), 0, U(1), 0, U(1), 1, U(0), 1], [col, col, col, col]);
      if (jersey) {
        // The profile, inward from the edge (-o), up from the deck: a 0.81 m
        // safety shape -- vertical back on the edge, 0.15 m top, the two
        // sloped faces toward the traffic.
        const prof = [[0, 0.81], [0.15, 0.81], [0.22, 0.33], [0.6, 0.08], [0.6, 0]];
        const P = (x, z, t, o, h) => [x - ox * o, t + h, z - oz * o];
        face.quad(P(x0, z0, t0, 0, 0), P(x1, z1, t1, 0, 0), P(x1, z1, t1, 0, 0.81), P(x0, z0, t0, 0, 0.81),
          [ox, 0, oz], [U(0), 0, U(1), 0, U(1), 0.3, U(0), 0.3], [col, col, col, col]);
        for (let q = 0; q < prof.length - 1; q++) {
          const [oa, ha] = prof[q], [ob, hb] = prof[q + 1];
          const nx = -(hb - ha), ny = (ob - oa);   // outward normal in (inward, up) plane
          const nl = Math.hypot(nx, ny) || 1;
          const n = [-ox * (nx / nl), ny / nl, -oz * (nx / nl)];
          const flatTop = q === 0;
          (flatTop ? flat : face).quad(P(x0, z0, t0, oa, ha), P(x1, z1, t1, oa, ha), P(x1, z1, t1, ob, hb), P(x0, z0, t0, ob, hb),
            n, [U(0), 0.3 + 0.1 * q, U(1), 0.3 + 0.1 * q, U(1), 0.4 + 0.1 * q, U(0), 0.4 + 0.1 * q],
            flatTop ? cope : [col, col, col, col]);
        }
        continue;
      }
      // coping over the top, a lip proud of the face
      flat.quad([x0 + ox * COPE, t0 + 0.1, z0 + oz * COPE], [x1 + ox * COPE, t1 + 0.1, z1 + oz * COPE],
        [x1 - ox * 0.05, t1 + 0.1, z1 - oz * 0.05], [x0 - ox * 0.05, t0 + 0.1, z0 - oz * 0.05],
        [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], cope);
      flat.quad([x0 + ox * COPE, t0 - 0.02, z0 + oz * COPE], [x1 + ox * COPE, t1 - 0.02, z1 + oz * COPE],
        [x1 + ox * COPE, t1 + 0.1, z1 + oz * COPE], [x0 + ox * COPE, t0 + 0.1, z0 + oz * COPE],
        [ox, 0, oz], [0, 0, 1, 0, 1, 1, 0, 1], cope);
    }
  }

  /**
   * Walls down both sides of an underpass cut, where this road runs through one.
   *
   * The cut's corridor is the carriageway plus its pavement plus 0.3 m
   * (citygen's underpass hw), so the wall stands just outside the footway. It
   * runs from the uncarved ground beyond the 1.5 m bank down to the carved road
   * edge, and only where the dip there is over 0.4 m -- the ramps out of the cut
   * shrink it to nothing rather than leaving a kerb-high wall along the street.
   */
  meshTrenchWalls(flat, e, a, b, ei) {
    if (!this.city.underpassDepth) return;
    const sw = e.cls === 'art' ? 3.2 : e.cls === 'st' || e.cls === 'res' ? 2.6 : 0;
    const w = e.hw + sw + 0.3;
    const px = -e.dz, pz = e.dx;
    const n = Math.max(2, Math.round(e.len / 4));
    // quick reject: no dip anywhere along the centre
    let any = false;
    for (let i = 0; i <= n && !any; i++) {
      const t = i / n;
      if (this.city.underpassDepth(lerp(a.x, b.x, t), lerp(a.z, b.z, t)) > 0.4) any = true;
    }
    if (!any) return;
    for (const sg of [1, -1]) {
      let run = [];
      const flush = () => {
        if (run.length > 1) this.meshWall(flat, run, -px * sg, -pz * sg, ei * 2 + (sg > 0 ? 0 : 1) + 29);
        run = [];
      };
      for (let i = 0; i <= n; i++) {
        const t = i / n, cx = lerp(a.x, b.x, t), cz = lerp(a.z, b.z, t);
        const x = cx + px * sg * w, z = cz + pz * sg * w;
        const dip = this.city.underpassDepth(x, z);
        if (dip <= 0.4) { flush(); continue; }
        const top = G.terrainHeight(x + px * sg * 1.7, z + pz * sg * 1.7);
        run.push([x, z, top, G.terrainHeight(x, z) - 0.3]);
      }
      flush();
    }
  }

  meshGraded(road, flat, e, a, b, ei) {
    const hw = e.hw, k = e.pk;
    const px = -e.dz, pz = e.dx;
    const bias = hash2(ei | 0, 7) * 0.03;
    const col = e.cls === 'hwy' ? [0.92, 0.92, 0.92] : [1, 1, 1];
    const Ls = this.deckEdgePoint(e.a, e, 1, hw), Le = this.deckEdgePoint(e.b, e, 1, hw);
    const Rs = this.deckEdgePoint(e.a, e, -1, hw), Re = this.deckEdgePoint(e.b, e, -1, hw);
    // The edge lines at sample i: the mitred full-width lines, pulled in where
    // citygen trimmed that side off a lower neighbour (`e.tw`).
    const Wl = (i) => e.tw[i * 2], Wr = (i) => e.tw[i * 2 + 1];
    const edgeL = (i) => {
      const t = i / k, x = Ls[0] + (Le[0] - Ls[0]) * t, z = Ls[1] + (Le[1] - Ls[1]) * t;
      return [x - px * (hw - Wl(i)), z - pz * (hw - Wl(i))];
    };
    const edgeR = (i) => {
      const t = i / k, x = Rs[0] + (Re[0] - Rs[0]) * t, z = Rs[1] + (Re[1] - Rs[1]) * t;
      return [x + px * (hw - Wr(i)), z + pz * (hw - Wr(i))];
    };
    // fr = 0 is the right-hand edge line, 1 the left, at sample i.
    const P = (i, fr) => {
      const [rx, rz] = edgeR(i), [lx, lz] = edgeL(i);
      return [rx + (lx - rx) * fr, rz + (lz - rz) * fr];
    };
    const O = (i, fr) => -Wr(i) + (Wl(i) + Wr(i)) * fr;
    const Y = (i, o) => e.ph[i] + e.pg[i] * o + bias;
    const wear = (o) => {
      const f = Math.min(1, Math.abs(o) / Math.max(hw, 0.01));
      const kk = (1 + 0.12 * (1 - f * f)) * (1 - 0.30 * Math.max(0, f - 0.55) / 0.45);
      return [col[0] * kk, col[1] * kk, col[2] * kk];
    };
    const seg = e.len / k;
    for (let i = 0; i < k; i++) {
      const t0 = i / k, t1 = (i + 1) / k;
      const v0 = (i * seg) / ROAD_TILE, v1 = ((i + 1) * seg) / ROAD_TILE;
      const mx = lerp(a.x, b.x, (t0 + t1) / 2), mz = lerp(a.z, b.z, (t0 + t1) / 2);
      if (this.city.roadCoveredAt(mx, mz, ei)) continue;
      const wide = Math.max(Wl(i) + Wr(i), Wl(i + 1) + Wr(i + 1));
      const across = Math.max(wide > 9 ? 3 : 1, Math.round(wide / 8));
      for (let c = 0; c < across; c++) {
        const f0 = c / across, f1 = (c + 1) / across;
        const [ax, az] = P(i, f0), [bx, bz] = P(i, f1);
        const [cx, cz] = P(i + 1, f1), [dx, dz] = P(i + 1, f0);
        const oa0 = O(i, f0), oa1 = O(i, f1), ob0 = O(i + 1, f0), ob1 = O(i + 1, f1);
        road.quad(
          [ax, Y(i, oa0), az], [bx, Y(i, oa1), bz], [cx, Y(i + 1, ob1), cz], [dx, Y(i + 1, ob0), dz],
          [0, 1, 0], [(oa0 + hw) / ROAD_TILE, v0, (oa1 + hw) / ROAD_TILE, v0,
            (ob1 + hw) / ROAD_TILE, v1, (ob0 + hw) / ROAD_TILE, v1],
          [wear(oa0), wear(oa1), wear(ob1), wear(ob0)]
        );
      }
    }
    // A trimmed side stands over a lower road: finish it with a wall down to it.
    for (let s = 0; s < 2; s++) {
      const sg = s === 0 ? 1 : -1;
      let run = [];
      const flush = () => {
        if (run.length > 1) this.meshWall(flat, run, px * sg, pz * sg, ei * 2 + s);
        run = [];
      };
      for (let i = 0; i <= k; i++) {
        const lo = e.tlo[i * 2 + s];
        if (Number.isNaN(lo)) { flush(); continue; }
        const [x, z] = s === 0 ? edgeL(i) : edgeR(i);
        const w = s === 0 ? Wl(i) : Wr(i);
        run.push([x, z, Y(i, sg * w) - 0.02, lo - 0.3]);
      }
      flush();
    }
    // Embankment. A draped road needed none -- it was the ground -- but a
    // graded one stands proud of it wherever the envelope filled a dip or the
    // camber lifted the low edge, and with nothing under that edge you see
    // straight through to the terrain below. A batter at BERM, in verge
    // colours, is what a real fill looks like from a car.
    // Verge colours. The first pick read as sand under the tone curve, the
    // second as a painted lime stripe down every median: developed ground here
    // is the terrain's SUBURB/URBAN tint, not park lawn. Toned toward that,
    // with only a lean to green.
    const grass = [0.43, 0.46, 0.34], dirt = [0.4, 0.39, 0.32];
    for (let s = 0; s < 2; s++) {
      const sg = s === 0 ? 1 : -1;
      const edgeAt = s === 0 ? edgeL : edgeR;
      let wallRun = [];
      const flushWall = () => {
        if (wallRun.length > 1) this.meshWall(flat, wallRun, px * sg, pz * sg, ei * 2 + s + 7);
        wallRun = [];
      };
      for (let i = 0; i < k; i++) {
        const o0 = i * 6 + s * 3, o1 = o0 + 6;
        const w0 = e.pe[o0 + 1], w1 = e.pe[o1 + 1];
        const walled = e.pwall && (e.pwall[i * 2 + s] || e.pwall[(i + 1) * 2 + s]);
        if (!walled && w0 <= 0 && w1 <= 0) { flushWall(); continue; }
        const [e0x, e0z] = edgeAt(i), [e1x, e1z] = edgeAt(i + 1);
        const ox = px * sg, oz = pz * sg;
        // citygen decided what stands on this side (see gradeRoads' berms), and
        // roadLift reports exactly that, so the mesher asks nothing of its own:
        // a berm where the batter has room, a finished retaining wall where it
        // would sweep over a lower carriageway, nothing where a neighbour's
        // tarmac is already there. Deciding it here with a separate query was
        // how a batter came to be reported where none was drawn.
        const wall0 = e.pwall && e.pwall[i * 2 + s], wall1 = e.pwall && e.pwall[(i + 1) * 2 + s];
        if (wall0 || wall1) {
          if (!wallRun.length) wallRun.push([e0x, e0z, e.pe[o0] + bias - 0.02, G.terrainHeight(e0x, e0z) - 0.3]);
          wallRun.push([e1x, e1z, e.pe[o1] + bias - 0.02, G.terrainHeight(e1x, e1z) - 0.3]);
          continue;
        }
        flushWall();
        flat.quad(
          [e0x, e.pe[o0] + bias - 0.02, e0z], [e1x, e.pe[o1] + bias - 0.02, e1z],
          [e1x + ox * w1, e.pe[o1 + 2], e1z + oz * w1], [e0x + ox * w0, e.pe[o0 + 2], e0z + oz * w0],
          [ox * 0.55, 0.83, oz * 0.55], [0, 0, 1, 0, 1, 1, 0, 1], [dirt, dirt, grass, grass]
        );
      }
      flushWall();
    }
    this.meshTrenchWalls(flat, e, a, b, ei);
    this.meshRoadMarks(flat, e, a, b, ei);
  }

  meshRoad(road, walk, flat, glow, e, a, b, lod, ei) {
    // Every deck and every freeway outside a portal is graded (citygen's
    // gradeRoads). Decks keep their own mesher for the structure under them.
    if (e.prof) {
      if (e.elev) this.meshViaduct(road, flat, e, a, b, ei);
      else this.meshGraded(road, flat, e, a, b, ei);
      return;
    }
    if (e.elev) { this.meshViaduct(road, flat, e, a, b, ei); return; }
    // A bore is not a carriageway on the surface -- it is a carriageway in a
    // BOX. citygen gives tunnel nodes a real underground profile and registers
    // the deck with groundAt; this draws what you see driving it: deck, walls,
    // ceiling, a lamp strip, and a portal frame at each end. Everything hangs
    // off the same two node heights the physics uses, so the drawn bore and
    // the driven bore cannot disagree.
    if (e.tunnel) { this.meshTunnel(road, flat, glow, e, a, b, ei); return; }
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
    this.meshTrenchWalls(flat, e, a, b, ei);
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
          const v0 = vv, v1 = vv + seg / WALK_TILE;
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
          const wu = sw / WALK_TILE;
          // A FOOTWAY DOES NOT FOLLOW A ROAD INTO A TUNNEL. The carriageway
          // descends into the cutting and should; pavement drawn from the same
          // carved surface swept down after it as a pair of ramps flanking the
          // mouth, which is what made the approach look like a building site.
          // It stops at the retaining wall instead.
          if (this.inCut((q[0][0] + q[2][0]) / 2, (q[0][2] + q[2][2]) / 2)) continue;
          walk.quad(q[0], q[1], q[2], q[3], [0, 1, 0], [0, v0, wu, v0, wu, v1, 0, v1], wc);
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
      if (e.tunnel) continue;   // draws nothing, so it sizes nothing
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
    // Normals are written in the HOUSE's frame, so they turn with it, exactly as
    // P turns the corners. They used to go in unrotated, and Builder.quad/tri
    // wind every face to agree with the normal it is given: on a house turned
    // past ~90 deg the local "-z" normal pointed into the roof, so that slope was
    // wound inward and backface-culled, and the gable ends went the same way.
    // What was left from the street was one bare slope per house, a lean-to
    // slab over an open end, on most of the houses in the city.
    const N = (lx, y, lz) => [lx * cs - lz * sn, y, lx * sn + lz * cs];
    // Ridge endpoints, pulled in a little so the gable ends are not knife-edged.
    const rl = alongX ? hw : hd;
    const A = alongX ? P(-rl, 0, y1) : P(0, -rl, y1);
    const Bp = alongX ? P(rl, 0, y1) : P(0, rl, y1);
    // Eaves corners
    const c00 = P(-hw, -hd, y0), c10 = P(hw, -hd, y0);
    const c11 = P(hw, hd, y0), c01 = P(-hw, hd, y0);
    const dark = [col[0] * 0.62, col[1] * 0.62, col[2] * 0.66];
    if (alongX) {
      flat.quad(c00, c10, Bp, A, N(0, 0.72, -0.7), ZERO_UV, col);      // slope -z
      flat.quad(c11, c01, A, Bp, N(0, 0.72, 0.7), ZERO_UV, dark);      // slope +z
      flat.tri(c00, A, c01, N(-1, 0.25, 0), col);                      // gable -x
      flat.tri(c10, c11, Bp, N(1, 0.25, 0), col);                      // gable +x
    } else {
      flat.quad(c00, A, Bp, c01, N(-0.7, 0.72, 0), ZERO_UV, col);      // slope -x
      flat.quad(c10, c11, Bp, A, N(0.7, 0.72, 0), ZERO_UV, dark);      // slope +x
      flat.tri(c00, c10, A, N(0, 0.25, -1), col);                      // gable -z
      flat.tri(c01, Bp, c11, N(0, 0.25, 1), col);                      // gable +z
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
    // Rotated with the corners, for the reason meshGable's normals are.
    const N = (lx, y, lz) => [lx * cs - lz * sn, y, lx * sn + lz * cs];
    const nrm = [N(0, 0.4, -1), N(1, 0.4, 0), N(0, 0.4, 1), N(-1, 0.4, 0)];
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
    // A JUNCTION IS NOT BUILT INSIDE A CUTTING, and testing only its centre is
    // not enough: a node standing just clear of the trench still paves a square
    // whose far corners reach into it, and drawn from the carved surface those
    // corners dive. That is the pale plate fanning out of the mouth -- apex at
    // the headwall, a straight unclosed edge over the bank, and full-white
    // vertex colour making it read as poured concrete rather than tarmac.
    // The strips cover the tarmac here on their own.
    {
      let rr = 0;
      for (const ei of n.e) { const e = city.edges[ei]; if (!e.tunnel && e.hw > rr) rr = e.hw; }
      // Generous: the square, its kerbed ring and the ring's diagonal corners
      // all reach past the node, and cutFloor covers the banks as well as the
      // floor. A junction anywhere near a cutting is simply not drawn -- the
      // approach strips pave it on their own, and a crossing does not belong
      // in the mouth of a tunnel anyway.
      const rq = rr + 8;
      for (const [ox, oz] of [[0, 0], [rq, 0], [-rq, 0], [0, rq], [0, -rq],
        [rq, rq], [rq, -rq], [-rq, rq], [-rq, -rq]]) {
        if (this.cutFloor(n.x + ox, n.z + oz)) return;
      }
    }
    // A graded node that is not an at-grade junction gets no square. Its
    // strips are mitred into their continuation (deckEdgePoint), and a
    // horizontal square laid over a sloping, cambered profile pokes through on
    // the uphill side and hangs in the air on the downhill one. That used to
    // be decks only; ground freeway carried one every node -- 8913 squares,
    // each 3 cm proud of the lanes and cutting the paint at both ends. A ramp
    // at a merge ends inside the main line's carriageway, so nothing needs
    // closing. citygen.nodeSurface() skips the same nodes.
    if (n.prof && !n.anchor) return;
    let hw = 0;
    let rot = 0;
    let sw = 0;
    for (const ei of n.e) {
      const e = city.edges[ei];
      // A bore paves nothing on the surface, so it cannot size a crossing
      // either. Skipping the edge in meshRoad but not here left a junction
      // square sitting on the ground over the tunnel -- a patch of carriageway
      // in somebody's garden, and 638 centreline samples still reporting a
      // paved lift with no road drawn. nodeSurface() does the same, because the
      // drawn surface and the lift query have to agree.
      if (e.tunnel) continue;
      if (e.hw > hw) { hw = e.hw; rot = Math.atan2(e.dx, -e.dz); }
      if (e.cls === 'st' || e.cls === 'art' || e.cls === 'res') {
        sw = Math.max(sw, e.cls === 'art' ? 3.2 : 2.6);
      }
    }
    if (hw <= 0) return;
    const c = Math.cos(rot), s = Math.sin(rot);
    // UVs in METRES, at the same ROAD_TILE the strips use.
    //
    // This was a hardcoded 0.16 x 0.14 slice of the asphalt texture stretched
    // across the whole junction -- which at a 20 m crossing is a repeat every
    // 130 m against the strips' 9 m. Roughly a hundred times less UV density,
    // so the junction magnified mip 0 while the road beside it sampled real
    // detail, and the two met at a hard line with sharp tarmac on one side and
    // a smear on the other. It reads as a rendering fault and was mistaken in
    // turn for post-processing, a shadow and a missing chunk.
    //
    // Aligned to world axes rather than to the junction's rotation, so the two
    // triangles of a crossing cannot disagree about which way the grain runs.
    // Subdivide the square, for the same reason meshRoad subdivides a strip.
    //
    // Drawn as ONE quad it interpolates linearly between its four corners,
    // while groundAt samples the heightfield at the exact point -- and those
    // are different surfaces as soon as the ground is not planar. Measured at a
    // 9.2 m residential crossing whose corners spread 2.4 m, the drawn square
    // stood 0.67 m above the height you were standing at: you sank into your
    // own junction. The corner samples were never the problem; the middle was.
    //
    // ~4 m cells, and only where the ground actually moves. The heightfield is
    // 40 m, so finer buys nothing, and subdividing every junction cost 5.6 % of
    // the scene's triangles to fix a defect most of them do not have.
    //
    // Gate on BOW, not on spread. A junction on a uniform grade has a large
    // corner spread and is still exactly representable by one quad -- a plane
    // is a plane. What one quad cannot follow is curvature, which is the
    // centre's deviation from the plane of the corners. Gating on spread
    // subdivided nearly every junction downtown, Seattle being hilly, and saved
    // almost nothing: 432814 triangles against 432214. Bow costs +2.7 % and
    // passes tools/perfguard.mjs --check.
    const cy = (x, z) => (n.elev ? n.y + 0.07 : G.terrainHeight(x, z) + NODE_Y);
    const at = (lx, lz) => cy(n.x + lx * c - lz * s, n.z + lx * s + lz * c);
    const bow = Math.abs(
      at(0, 0) - (at(-hw, -hw) + at(hw, -hw) + at(hw, hw) + at(-hw, hw)) / 4
    );
    const sub = bow < 0.08 ? 1 : Math.max(2, Math.min(6, Math.round((hw * 2) / 4)));
    for (let iz = 0; iz < sub; iz++) {
      for (let ix = 0; ix < sub; ix++) {
        const qp = [], qy = [], qu = [];
        for (const [fx, fz] of [[ix, iz], [ix + 1, iz], [ix + 1, iz + 1], [ix, iz + 1]]) {
          const lx = -hw + (fx / sub) * hw * 2, lz = -hw + (fz / sub) * hw * 2;
          const x = n.x + lx * c - lz * s;
          const z = n.z + lx * s + lz * c;
          qp.push(x, z);
          qy.push(cy(x, z));
          qu.push(x / ROAD_TILE, z / ROAD_TILE);
        }
        road.flat(qp, qy, [1, 1, 1], qu);
      }
    }

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
        // A ring piece belonging to a node just OUTSIDE a cutting can still
        // reach into it, and drawn from the carved surface it dives after the
        // road as a pale ramp beside the mouth. Skipping the node is not
        // enough; the pieces have to be tested too.
        if (this.inCut((i0x + o1x) / 2, (i0z + o1z) / 2)) continue;
        // Size the ring's UVs from the piece's real dimensions, or its slabs
        // come out as whatever shape the corner happens to be.
        const ru = Math.hypot(o0x - i0x, o0z - i0z) / WALK_TILE;
        const rv = Math.hypot(i1x - i0x, i1z - i0z) / WALK_TILE;
        walk.quad(
          [i0x, wy(i0x, i0z), i0z], [o0x, wy(o0x, o0z), o0z],
          [o1x, wy(o1x, o1z), o1z], [i1x, wy(i1x, i1z), i1z],
          [0, 1, 0], [0, 0, ru, 0, ru, rv, 0, rv], [1, 1, 1]);
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
      { m: 'glass', c: [0.55, 0.60, 0.66], u: 14, v: 13.6 },     // curtain wall
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
    const C = this.cells;
    let target, col, cell = null, uS = 14, vS = 13.6;
    const fam = (bd.style === 'tower' || bd.style === 'midrise'
      || bd.style === 'brick' || bd.style === 'lowrise')
      ? this.buildingFamily(bd) : null;
    if (fam) {
      // Glass keeps its own material: it is the one facade whose look is mostly
      // indirect SPECULAR, and that is the part of envMapIntensity the AO
      // channel can only approximate. Everything else joins the atlas.
      const glassy = fam.m === 'glass';
      target = glassy ? bl.glass : bl.facade;
      if (!glassy) cell = C[fam.m];
      // Jitter stays INSIDE the family, so a brick street varies in weathering
      // rather than becoming a different material every other lot.
      col = tint(seed, fam.c, 0.26);
      uS = fam.u;
      // Snap the vertical repeat so a whole number of tiles spans the wall.
      // Each tile is four window rows; at an arbitrary vScale the top row is
      // sliced through by the parapet on every building in the city.
      vS = bd.h / Math.max(1, Math.round(bd.h / fam.v));
    } else if (bd.style === 'industrial') {
      target = bl.facade; cell = C.industrial;
      col = tint(seed, [0.84, 0.86, 0.86], 0.3); uS = 16; vS = 16;
    } else {
      target = bl.facade; cell = C.house;
      col = tint(seed, [0.94, 0.92, 0.88], 0.36); uS = 0; vS = 0;
    }

    if (bd.kind) return this.meshLandmarkTower(bl, flat, bd, col);

    const base = bd.y - 2;
    const cs = Math.cos(bd.rot), sn = Math.sin(bd.rot);
    const off = (lx, lz) => [bd.x + lx * cs - lz * sn, bd.z + lx * sn + lz * cs];

    if (bd.style === 'house') {
      const wallH = bd.h * 0.72;
      target.box(bd.x, base, bd.z, bd.w, wallH + 2, bd.d, bd.rot, col,
        { top: false, uScale: 0, vScale: 0, ao: 0.3, cell });
      // Roofs were a flat near-black polygon that can fill a third of a frame
      // with no material at all. Route them through the industrial cell so
      // they take a texture, and lift them off black.
      const rc = tint(seed, [0.46, 0.43, 0.41], 0.16);
      bl.facade.box(bd.x, base + wallH + 2, bd.z, bd.w + 0.7, 0.26, bd.d + 0.7, bd.rot, rc,
        { uScale: 5, vScale: 5, cell: C.industrial });
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
      // Every house, however elongated. A guard was once added here to skip the
      // gable above 4.5:1, on the theory that a roof sized off the longer side
      // hangs past the walls on the narrow axis. It does not: meshGable sizes
      // its eaves from the actual w and d with a fixed 0.45 m overhang, so a
      // terrace gets a long ridge and a low pitch, which is what a terrace has.
      // Measured, the drawn roof reached 0.4 m past the narrow wall; the metres
      // that looked like overhang were the NEIGHBOURING terrace's roof, which
      // touches this one. The guard was suppressing three correct roofs.
      this.meshGable(flat, bd, base + wallH + 2.26, rc, seed);
      const [sx, sz] = off(0, bd.d / 2 + 0.5);
      flat.box(sx, base + 1.6, sz, 2.0, 0.22, 1.2, bd.rot, [0.62, 0.6, 0.57]);
      return;
    }

    // Roof clutter. The top face is the most-seen surface of a low building
    // from any elevated view, and a bare extrusion cap is the loudest tell that
    // this is untextured programmer geometry. A handful of boxes per roof is
    // within budget because they merge into the chunk's existing flat mesh.
    let lidded = false;
    if (bd.h < 70 && bd.w > 9 && bd.d > 9) {
      lidded = true;
      const rt = base + bd.h + 2;
      // Roofs vary per building. One flat grey across a whole downtown reads
      // as untextured cap geometry from every elevated view, which is the
      // angle roofs are actually seen from.
      // Tar-and-gravel is about 0.22 albedo, not 0.05, and a roof is the
      // largest surface in any elevated view. At the old values the whole
      // near-field went near-black from above while the fogged far skyline
      // stayed bright, so the city read inside-out: the closest thing in the
      // frame was the darkest. Roofs are a light-to-mid grey with real spread.
      const rv = 0.32 + hash2(seed, 91) * 0.14;
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
      // The parapet does not get a top face, because the lid goes on top of it.
      //
      // It used to: `box` defaults to `top: true`, so the surface you actually
      // saw when you looked at a roof was the parapet's lid at rt + 0.85, on
      // `flat` -- which has no map and no normal map. The textured lid was
      // underneath it at rt - 0.12, contributing a 12 cm band nobody could see.
      // Roofs are roughly 40 % of the pixels in the skyline shot and every one
      // of them was a flat colour.
      flat.box(bd.x, rt, bd.z, bd.w + 0.5, 0.85, bd.d + 0.5, bd.rot,
        [rv * 1.2, rv * 1.2, rv * 1.17], { top: false });
      // The lid, capping the parapet flush. `box` draws no bottom face, so
      // there is nothing to see through where the two meet.
      //
      // Its own ROOF cell now, not the industrial one. Corrugated siding at a
      // 4 m tile read as a ribbed grey lid from every elevated view, the same
      // on every building. A membrane with seams, ponding stains, patches and
      // drains reads as a roof at 10 m a tile. The tint is lifted by 1.5x to
      // land at a tar-and-gravel ~0.2 albedo over the roof cell's lighter base.
      bl.facade.box(bd.x, rt + 0.71, bd.z, bd.w + 0.5, 0.14, bd.d + 0.5, bd.rot,
        [rv * 1.38, rv * 1.40, rv * 1.44], { uScale: 10, vScale: 10, cell: C.roof });
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
      this.meshSigns(bl.facade, flat, bd, y + plinthH, plinthH, seed, off);
      y += plinthH + 0.5;
      remaining -= plinthH + 0.5;
    }

    let w = bd.w, d = bd.d;
    for (const tier of buildingTiers(bd, y, remaining)) {
      target.box(bd.x, tier.y, bd.z, tier.w, tier.h, tier.d, bd.rot, col,
        { uScale: uS, vScale: vS, top: false, vOff: (tier.y - base) / (vS || 1),
          ao: tier.t === 0 ? 0.22 : 0, cell });
      y = tier.y + tier.h;
      w = tier.w; d = tier.d;
      if (!tier.last) flat.box(bd.x, y, bd.z, tier.w + 0.8, 0.55, tier.d + 0.8, bd.rot, TRIM);
    }

    // cornice, roof deck, then a parapet wall standing above it
    //
    // A bed moulding under the cornice, so the roofline is a stepped profile
    // that catches a shadow line, not one slab laid on the wall.
    flat.box(bd.x, y - 0.42, bd.z, w + 0.5, 0.42, d + 0.5, bd.rot,
      [TRIM[0] * 0.8, TRIM[1] * 0.8, TRIM[2] * 0.82], { top: false });
    flat.box(bd.x, y, bd.z, w + 1.1, 0.55, d + 1.1, bd.rot, TRIM);
    // The deck only where the roof kit above has not already put a lid on.
    //
    // It used to be drawn under every lid as well: deck top at rt + 0.83, lid
    // top at rt + 0.85 -- two centimetres apart, which at a few hundred metres
    // is inside one step of the depth buffer, so every low roof in an aerial
    // view z-fought between flat grey and the textured lid as the camera moved.
    if (!lidded) {
      bl.facade.box(bd.x, y + 0.55, bd.z, w + 0.5, 0.28, d + 0.5, bd.rot, [0.62, 0.62, 0.64],
        { uScale: 10, vScale: 10, cell: C.roof });
    }
    // 12 cm outside the kit's own parapet (w + 0.5), not 2.5 cm: the two walls
    // overlap vertically and at 2.5 cm they fought at distance the same way.
    flat.box(bd.x, y + 0.55, bd.z, w + 0.75, 1.15, d + 0.75, bd.rot, DARK, { top: false });
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
    const stone = this.cells.masonry;
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
      bl.facade.box(bd.x, base, bd.z, bd.w * 1.5, 22, bd.d * 1.5, bd.rot, white,
        { uScale: 12, vScale: 12, top: false, ao: 0.35, cell: stone });
      flat.box(bd.x, base + 22, bd.z, bd.w * 1.5 + 1.2, 1.1, bd.d * 1.5 + 1.2, bd.rot, [0.78, 0.77, 0.73]);
      bl.facade.box(bd.x, base + 23.1, bd.z, bd.w, bd.h - 45, bd.d, bd.rot, white,
        { uScale: 11, vScale: 11, top: false, cell: stone });
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
        bl.facade.box(bd.x, y, bd.z, w, hh, d, bd.rot, c2,
          { uScale: 12, vScale: 12, top: false, ao: t === 0 ? 0.28 : 0, cell: stone });
        flat.box(bd.x, y + hh, bd.z, w + 0.8, 0.7, d + 0.8, bd.rot, TRIM);
        y += hh + 0.7; h -= hh; w *= 0.84; d *= 0.84;
        if (h < 6) break;
      }
      flat.prism(bd.x, y, bd.z, 0.35, 16, 4, [0.4, 0.4, 0.42]);
      return;
    }
    const isStone = bd.kind === 'stone';
    const target = isStone ? bl.facade : bl.glass;
    let y = base, h = bd.h + 2, w = bd.w, d = bd.d;
    for (let t = 0; t < 3; t++) {
      const hh = t === 2 ? h : h * 0.5;
      target.box(bd.x, y, bd.z, w, hh, d, bd.rot, col,
        { uScale: 13, vScale: 13, top: false, ao: t === 0 ? 0.28 : 0, cell: isStone ? stone : null });
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
    // The 4 x 4 plate grid now sits inside the facade atlas's signage cell, so
    // every U goes through `su`. V is untouched -- these UVs are already inside
    // 0..1 and the atlas is exactly one tile tall.
    const [su0, sdu] = this.cells.signs;
    const su = (u) => su0 + u * sdu;
    const plate = (k) => {
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
      const [u0, v0] = plate(201 + f * 7);
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
        nrm, [su(u0), v0, su(u0 + C), v0, su(u0 + C), v0 + C, su(u0), v0 + C], [1, 1, 1]);

      // Projecting blade sign: hung near one end and read from ALONG the
      // street rather than across it, which is the whole point of a blade.
      if (hash2(seed, 210 + f) > 0.62) {
        const [bu, bv] = plate(220 + f * 3);
        const bt = halfW * (hash2(seed, 230 + f) > 0.5 ? 0.72 : -0.72);
        const bladeN = dirOf(fc.along[0], fc.along[1]);
        const byTop = yTop + 0.4, byBot = byTop - 1.5;
        const q = (proj, yy) => {
          const [wx, wz] = off(fc.out[0] * (fc.half + proj) + fc.along[0] * bt,
            fc.out[1] * (fc.half + proj) + fc.along[1] * bt);
          return [wx, yy, wz];
        };
        sg.quad(q(0.05, byBot), q(1.0, byBot), q(1.0, byTop), q(0.05, byTop),
          bladeN, [su(bu), bv, su(bu + C), bv, su(bu + C), bv + C, su(bu), bv + C], [1, 1, 1]);
      }
    }

    // Rooftop billboard, on low and mid buildings only: on a tower it sits
    // 150 m up where nobody reads it, and on a house it is absurd.
    if (bd.h > 10 && bd.h < 42 && bd.w > 14 && hash2(seed, 240) > 0.72) {
      const [bu, bv] = plate(241);
      const bw = Math.min(bd.w * 0.7, 16), bh = bw * 0.42;
      const yb = bd.y - 2 + bd.h + 3.4;
      const p0 = off(-bw / 2, bd.d * 0.2), p1 = off(bw / 2, bd.d * 0.2);
      const nrm = dirOf(0, 1);
      sg.quad([p0[0], yb, p0[1]], [p1[0], yb, p1[1]],
        [p1[0], yb + bh, p1[1]], [p0[0], yb + bh, p0[1]],
        nrm, [su(bu), bv, su(bu + C), bv, su(bu + C), bv + C, su(bu), bv + C], [1, 1, 1]);
      // Legs, so it stands on the roof instead of floating over it.
      for (const lt of [-bw * 0.34, bw * 0.34]) {
        const [lx, lz] = off(lt, bd.d * 0.2);
        flat.box(lx, yb - 3.4, lz, 0.22, 3.4, 0.22, bd.rot, [0.25, 0.26, 0.28]);
      }
    }
  }

  /**
   * Height of the water surface covering a point, or null if it is dry.
   *
   * The sea is at y=0 and every labelled lake gets its own plane at its own
   * level -- Green Lake really is at 50 m -- so "is this under water" is not a
   * comparison against zero, and anything measuring clearance over water has to
   * ask for the LOCAL surface. A fixed 5.5 m bridge floor put decks under the
   * lakes they crossed by assuming otherwise.
   */
  /**
   * Inside the airfield's movement area? Boeing Field's ground is grass in
   * the green mask, so the tree scatter plants a forest through the runway
   * the landmark lays on top of it. One rotated rectangle over the
   * runway/taxiway/apron, sized to the landmark's own layout constants.
   */
  inAirfield(x, z) {
    if (this._airfield === undefined) {
      const ap = (G.LANDMARKS || []).find((l) => l.kind === 'airport');
      // explicit runway axes (bearing 150): along (0.497, 0.868), across
      // (0.868, -0.497) -- see the landmark for why no trig shorthand
      this._airfield = ap ? { x: ap.x, z: ap.z } : null;
    }
    const a = this._airfield;
    if (!a) return false;
    const dx = x - a.x, dz = z - a.z;
    const lx = dx * 0.868 - dz * 0.497, lz = dx * 0.497 + dz * 0.868;
    return Math.abs(lx) < 520 && Math.abs(lz) < 1680;
  }

  waterLevelAt(x, z) {
    for (const l of (this.lakeSpecs || [])) {
      if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) return l.level;
    }
    return G.isWater(x, z) ? 0 : null;
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
    // NOTHING IS PLANTED IN A PORTAL PIT. The carve digs hw + 7.6 m either
    // side of a cutting, and a road carried over it on a lid keeps its grade
    // while its kerbside does not: street trees, lamp posts and clutter set at
    // terrainHeight beside a lidded road stood at the bottom of the trench,
    // their crowns level with the slab. Anything whose ground is dug 0.3 m or
    // more by a portal cut is not planted (it would also be a solid post down
    // in the cutting). cityStats.propsInPit counts them.
    if (cityStats.propsInPit === undefined) cityStats.propsInPit = 0;
    const inPit = (x, z) => {
      if (this.cutDepth(x, z) <= 0.3) return false;
      // where, for tools (bounded)
      const pp = this._pitProps || (this._pitProps = []);
      if (pp.length < 400) pp.push([Math.round(x), Math.round(z)]);
      return true;
    };

    for (const ei of ch.edges) {
      const e = city.edges[ei];
      // A graded ramp's kerbside is its embankment, and furniture planted at
      // terrain height there is buried to the lamp head or floats off the
      // batter. Freeway ramps carry no street furniture anyway.
      if (e.elev || e.prof || e.cls === 'hwy') continue;
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
        if (inPit(ox, oz)) { cityStats.propsInPit++; continue; }
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
          const vw = 0.72 + h * 0.44;
          const g = [0.165 * vw, 0.315 * vw, 0.14 * vw];
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
          if (inPit(ox, oz)) { cityStats.propsInPit++; continue; }
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
          if (!G.isBuildable(ox, oz) || inPit(ox, oz)) continue;
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
      if (this.inAirfield(x, z)) { treeSkip++; continue; }
      // ...nor on a car park or court. The lot layer may pave over the park
      // mask (a park's own car park is real tarmac), and the terrain draws it
      // paved, so a tree there stands in the middle of the bays. A paved
      // SQUARE keeps a third of its trees: Occidental is paving under planes.
      const lk = G.lotAt(x, z);
      if (lk >= 0 && (lk !== LOT_PLAZA || hash2(cx * 17 + i, cz * 29 + 3) > 0.33)) { treeSkip++; continue; }
      // ...nor inside a building. Parks and footprints come from two different
      // OSM layers and they overlap: greenspace is mapped right up to and over
      // the museum, pavilion or house standing in it, so `inPark` happily says
      // yes in the middle of a building. Measured, 9.3 % of surviving park
      // candidates stood inside a footprint -- trees growing through roofs.
      if (this.inBuilding(x, z, 0.8)) { treeSkip++; continue; }
      // ...nor in the water. The green mask and the water mask are separate
      // rasters and their shorelines do not agree to the metre, so inPark says
      // yes on cells that are under Puget Sound or below the tide line. 63
      // trunks across the map were standing in the sea -- counted off the trees
      // that actually get planted, not off the raster candidates, which is a
      // number that cannot move and reported 16 either way.
      //
      // The water mask is the authority on what is wet; WET_FLOOR only catches
      // the shoreline band where the two rasters disagree.
      //
      // Do NOT reach for waterLevelAt here. It answers over a lake's
      // axis-aligned BOUNDING BOX, so it reports "Green Lake, 50.3 m" for the
      // whole park ringing it -- and testing terrain against that level deleted
      // 105 of Green Lake's 717 trees and 251 around Lake Union. Measured, both
      // times, which is the only reason it did not ship.
      if (G.isWater(x, z) || G.terrainHeight(x, z) < WET_FLOOR) { treeSkip++; continue; }
      if (inPit(x, z)) { cityStats.propsInPit++; continue; }
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
      // Canopies were pulled toward grey back when the emerald cone was the
      // most out-of-gamut thing in every frame -- but that was tuned with no
      // tone curve in front of it. With ACES running and its saturation paid
      // back, the same values leave a tree paler than the lawn it stands on.
      // Foliage carries more chroma than grass and sits darker, which is also
      // what a conifer against a mown park actually looks like.
      const warm = (h2 - 0.5) * 0.06;
      const v = 0.70 + h * 0.48;
      const g = [(0.155 + warm) * v, (0.305 + h * 0.05) * v, (0.13 - warm * 0.5) * v];
      // A conifer is not a green tree, it is a DARK one.
      //
      // Sharing one foliage colour across all three silhouettes left the
      // Douglas firs the same value as the lawn they stand on, which is the
      // one thing a Pacific Northwest park never looks like. Deep forest green
      // is darker and cooler than broadleaf, not merely a shade of it -- so
      // red comes down hardest and blue is held up.
      if (kind === 0) {
        g[0] *= 0.60; g[1] *= 0.76; g[2] *= 0.82;
      }
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
    // Sunlit foliage is a different COLOUR from shaded foliage, not just a
    // darker shade: the lit outer leaves go yellow-green. Baking that into the
    // lobes on the sun's side, and the dark into the lobes underneath, is what
    // makes a crown read as a volume of leaves rather than one tinted ball --
    // the key light alone cannot do it, because every lobe faces every way.
    const lit = [g[0] * 1.3, g[1] * 1.2, g[2] * 1.02];
    // Toward the sun: main.js SUN_OFFSET (-215, 200, -150), normalised in xz.
    const SX = -0.82, SZ = -0.57;
    const wob = (k) => hash2(Math.round(x * 5) + k * 17, Math.round(z * 5) + k * 29);
    if (kind === 0) {
      // Conifer: five narrowing skirts instead of three cones. The pitch
      // between tiers is under a skirt's own height, so each one overlaps the
      // next and the silhouette steps in like a fir, and the tiers brighten
      // toward the leader, where the light actually lands. 8 triangles a tier.
      const TIERS = 5;
      const r0 = 2.0 + h * 1.7;
      const y0 = gy + th * 0.2, span = th * 0.62;
      for (let i = 0; i < TIERS; i++) {
        const t = i / (TIERS - 1);
        const col = t < 0.5
          ? [gd[0] + (g[0] - gd[0]) * t * 2, gd[1] + (g[1] - gd[1]) * t * 2, gd[2] + (g[2] - gd[2]) * t * 2]
          : [g[0] + (lit[0] - g[0]) * (t - 0.5), g[1] + (lit[1] - g[1]) * (t - 0.5), g[2] + (lit[2] - g[2]) * (t - 0.5)];
        const r = r0 * (1 - t * 0.8) * (0.92 + wob(i) * 0.16);
        flat.cone(x, y0 + span * t, z, r, th * (0.30 - t * 0.06), 8, col);
      }
    } else if (kind === 1) {
      // Broadleaf: a dark core with four lobes clustered around and over it.
      // The lobes on the sun side and on top take the lit colour, the ones
      // away from the sun keep the mid, so the crown has a bright shoulder and
      // a shaded underside at any heading. Per-tree rotation and size jitter
      // keep a street of them from being stamped.
      const cr = 2.0 + h * 1.7;
      const cy = gy + th * 0.64;
      flat.spheroid(x, cy, z, cr * 0.9, 7, 3, gd, 0.78, 0.3);
      const rot0 = wob(1) * Math.PI * 2;
      for (let k = 0; k < 4; k++) {
        const a = rot0 + (k * Math.PI) / 2 + (wob(k + 2) - 0.5) * 0.7;
        const ox = Math.cos(a), oz = Math.sin(a);
        const sunward = ox * SX + oz * SZ;
        const lr = cr * (0.56 + wob(k + 6) * 0.16);
        const col = sunward > 0.2 ? lit : g;
        flat.spheroid(x + ox * cr * 0.55, cy + cr * (0.08 + wob(k + 10) * 0.25), z + oz * cr * 0.55,
          lr, 6, 3, col, 0.82, 0.32);
      }
      // crown, nudged toward the light
      flat.spheroid(x + SX * cr * 0.18, cy + cr * 0.52, z + SZ * cr * 0.18, cr * 0.58, 6, 3, lit, 0.85, 0.3);
    } else {
      // Scrub: low and wide, two lobes, the sunward one lit.
      const cr = 1.5 + h * 1.1;
      flat.spheroid(x, gy + th * 0.34, z, cr, 6, 3, gd, 0.7, 0.34);
      flat.spheroid(x + SX * cr * 0.35, gy + th * 0.34 + cr * 0.3, z + SZ * cr * 0.35, cr * 0.62, 6, 3, lit, 0.8, 0.3);
    }
  }
}
