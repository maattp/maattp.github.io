// THE PLAYER'S OWN SHADOW, FROM A MAP OF ITS OWN.
//
// The sun's map covers the city around the view: 190 m either side at 1024 on
// a phone (0.37 m a texel), 260 m at 2048 on the desktop (0.25 m). A person is
// ~0.45 m across and a leg ~0.12 m, so in that map the walking player was one
// or two texels wide: his shadow on the pavement was a stack of blocky
// rectangles, legs coming and going as they crossed texel centres. No filter
// fixes a caster smaller than a texel.
//
// So the player (on foot, or the car he drives) is left out of the sun's map
// and drawn into a second one: the same sun direction, a box a few metres
// across centred on him, 512 texels (~1.6 cm on foot). Every lit material takes the darker of the two
// (lights_fragment_begin, patched by installNearShadowChunk): min, not a
// product, so his shadow falling into a building's adds nothing, as a real one
// would not.
//
// three sees a second shadow-casting DirectionalLight, which is what puts the
// map, its matrix and the shadow coordinate into every lit program. The patch
// makes the directional loop light with index 0 only -- the sun -- and fold
// index 1's shadow into it, so the second light never lights anything (its
// colour is 0 anyway). Light order is the scene's: the near light is added
// after the sun, both cast, neither has a map, and three's sort is stable.
//
// The map is drawn by three's own shadow pass, called with this light alone
// and a stand-in root holding just the casters (1 draw on foot, the car's parts in one; no scene walk). It
// wraps shadowMap.render OUTSIDE shadowcache.js and chunkcull.js, so the rest
// of the pass sees only the sun, exactly as before.
import * as THREE from './three.js';

/**
 * Patch the directional loop: light 0 only, its shadow the min of map 0 and
 * map 1. Must run before any lit material compiles. Returns false (and leaves
 * three alone) if the chunk text is not r160's; the near light must then not
 * be added, or it would light the scene with a black light and the player
 * would cast no shadow at all.
 */
export function installNearShadowChunk() {
  const C = THREE.ShaderChunk;
  if (C.__nearShadow) return true;
  const from = '\t\tdirectionalLight = directionalLights[ i ];\n'
    + '\t\tgetDirectionalLightInfo( directionalLight, directLight );\n'
    + '\t\t#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )\n'
    + '\t\tdirectionalLightShadow = directionalLightShadows[ i ];\n'
    + '\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;\n'
    + '\t\t#endif\n'
    + '\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n';
  if (!C.lights_fragment_begin.includes(from)) {
    console.warn('near shadow: three chunk changed, not patched');
    return false;
  }
  const near = 'getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, '
    + 'directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] )';
  C.lights_fragment_begin = C.lights_fragment_begin.replace(from,
    '\t\t#if UNROLLED_LOOP_INDEX == 0\n'
    + '\t\tdirectionalLight = directionalLights[ i ];\n'
    + '\t\tgetDirectionalLightInfo( directionalLight, directLight );\n'
    + '\t\t#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )\n'
    + '\t\tdirectionalLightShadow = directionalLightShadows[ i ];\n'
    + '\t\t#if NUM_DIR_LIGHT_SHADOWS > 1\n'
    + `\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? min( getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ), ${near} ) : 1.0;\n`
    + '\t\t#else\n'
    + '\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;\n'
    + '\t\t#endif\n'
    + '\t\t#endif\n'
    + '\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n'
    + '\t\t#endif\n');
  C.__nearShadow = true;
  return true;
}

export class NearShadow {
  /**
   * @param renderer   the WebGLRenderer
   * @param scene      the scene the sun is in (the near light is added after it)
   * @param sun        the shadow-casting sun
   * @param opts.half  half-width of the box, metres (a focus may ask for more)
   * @param opts.size  map size, texels
   * @param opts.focus () => null | { x, y, z, half?, roots: [Object3D] } -- who casts, and where
   */
  constructor(renderer, scene, sun, opts) {
    this.r = renderer;
    this.sun = sun;
    this.focus = opts.focus;
    this.on = true;
    this.active = false;     // the map holds casters this frame
    this.draws = 0;          // the near map's draw calls last frame, for tools
    const l = this.light = new THREE.DirectionalLight(0xffffff, 0);
    l.name = 'nearShadow';
    l.castShadow = true;
    const s = l.shadow;
    s.mapSize.set(opts.size, opts.size);
    // The box only has to hold the CASTER: the ray through any shadowed
    // receiver passes through it, so in the light's xy every shadow it throws
    // lies inside the caster's own outline. Its depth runs 40 m up-sun of the
    // focus to 200 m down-sun, so a jump, a fall off a roof or a pier still
    // lands its shadow; a stored depth step is ~6e-5 mm.
    this.dist = 40;
    s.camera.near = 1; s.camera.far = this.dist + 200;
    this._fit(opts.half);
    this.dir = sun.position.clone().sub(sun.target.position).normalize();
    // nothing in it yet: park it far below the world, so every receiver falls
    // outside its box and getShadow skips the taps
    this._park();
    scene.add(l);
    scene.add(l.target);
    // a stand-in root for three's pass: it only walks .children
    this._root = { visible: true, layers: new THREE.Layers(), children: [] };
    this._three = renderer.shadowMap.render.bind(renderer.shadowMap);
  }

  /** Wrap shadowMap.render. Call after shadowcache.js and chunkcull.js have wrapped it. */
  install() {
    const sm = this.r.shadowMap, inner = sm.render;
    sm.render = (lights, scene, camera) => {
      const i = lights.indexOf(this.light);
      // a render of some other scene (a probe, a harness's stage): not ours
      if (i < 0) return inner.call(sm, lights, scene, camera);
      const rest = lights.filter((x) => x !== this.light);
      const f = this.on ? this.focus() : null;
      if (!f || !f.roots.length) {
        inner.call(sm, rest, scene, camera);
        if (this.active || !this.light.shadow.map) this._empty(scene, camera);
        return;
      }
      // the casters leave the sun's map for the frame
      const hid = [];
      for (const o of f.roots) if (o.visible) { o.visible = false; hid.push(o); }
      try { inner.call(sm, rest, scene, camera); } finally { for (const o of hid) o.visible = true; }
      const l = this.light, d = this.dir, D = this.dist;
      this._fit(f.half || this.half);
      l.target.position.set(f.x, f.y, f.z);
      l.position.set(f.x + d.x * D, f.y + d.y * D, f.z + d.z * D);
      l.target.updateMatrixWorld();
      l.updateMatrixWorld();
      this._root.children = hid;
      const c0 = this.r.info.render.calls;
      sm.needsUpdate = true;
      this._three([l], this._root, camera);
      this.draws = this.r.info.render.calls - c0;
      this._root.children = [];
      this.active = true;
    };
  }

  /** Size the box (metres either side) and the biases that go with its texel. */
  _fit(half) {
    if (half === this.half) return;
    this.half = half;
    const s = this.light.shadow, c = s.camera, texel = (half * 2) / s.mapSize.x;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half;
    c.updateProjectionMatrix();
    // ~5 cm along the ray and a texel along the normal: enough that a car's
    // curved panels do not shadow themselves in a 1-4 cm map. A pedestrian's
    // material lifts its own lookup 0.6 m anyway (peds.js), and nothing else
    // in this map is a receiver of its own shadow.
    s.bias = -0.05 / (c.far - c.near);
    s.normalBias = texel;
  }

  _park() {
    const l = this.light;
    l.target.position.set(0, -1e5, 0);
    l.position.set(0, -1e5 + this.dist, 0);
    l.target.updateMatrixWorld();
    l.updateMatrixWorld();
  }

  /** No casters: an empty map parked out of reach (the program still binds it). */
  _empty(scene, camera) {
    this._park();
    this._root.children = [];
    this.r.shadowMap.needsUpdate = true;
    this._three([this.light], this._root, camera);
    this.active = false;
    this.draws = 0;
  }
}
