// THE CITY'S SHADOWS ARE DRAWN ONCE, NOT EVERY FRAME (phones).
//
// The sun never moves and neither does the city, yet three's shadow pass drew
// every building, tree and landmark in the box into the shadow map every
// frame: on the phone profile 19-25 of the pass's 29-38 draw calls, a sixth of
// the whole frame, repeated sixty times a second to produce the same depths.
// The phone is CPU-bound (every GL call crosses to WebKit's GPU process), so
// those calls are heat.
//
// So the STATIC casters (world.group, the landmarks, the stunt ramps) render
// into a cache map covering the shadow box plus a margin, and each frame:
//
//   1. the cache is copied into the live shadow map, shifted by a whole number
//      of texels -- placeSun already snaps the box to the texel grid in all
//      three axes, so the shift is exact, and the depth shift is a constant;
//   2. three's own shadow pass then draws only the MOVING casters (vehicles,
//      characters, the monorail's trains) over it, with the statics hidden and
//      its clear suppressed, depth-tested against the copied depths.
//
// The cache is re-rendered when the live box leaves it (the box rides 90 m
// ahead of the camera, so about every 2 s at driving speed, and once after a
// look round), when a chunk inside it is built or dropped, and when a
// landmark's range-culled mesh shows or hides. It is installed by wrapping
// shadowMap.render, so anything that calls renderer.render -- the game and
// every harness -- gets the same shadows. Any failure turns it off and three's
// ordinary pass takes over.
import * as THREE from './three.js';

const COPY_VS = `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COPY_FS = `
precision highp float;
precision highp int;
uniform sampler2D cache;
uniform ivec2 off;
uniform ivec2 size;
uniform float dz;
out vec4 fragColor;
#include <packing>
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) + off;
  float d = 1.0;
  if (p.x >= 0 && p.y >= 0 && p.x < size.x && p.y < size.y) {
    d = unpackRGBAToDepth(texelFetch(cache, p, 0));
    // nothing drawn there stays nothing; anything else moves with the box
    if (d < 1.0) d = clamp(d + dz, 0.0, 1.0);
  }
  fragColor = packDepthToRGBA(d);
  gl_FragDepth = d;
}`;

export class ShadowCache {
  /**
   * @param renderer  the WebGLRenderer
   * @param sun       the shadow-casting DirectionalLight
   * @param opts.margin    metres of cache past the live box on every side
   * @param opts.statics   () => [roots] whose meshes are static casters
   * @param opts.keep      () => [objects] under a static root that MOVE (drawn every frame)
   */
  constructor(renderer, sun, opts) {
    this.r = renderer;
    this.sun = sun;
    this.margin = opts.margin;
    this.statics = opts.statics;
    this.keep = opts.keep;
    this.on = true;
    this.valid = false;
    this.dirty = true;
    this.renders = 0;          // cache re-renders, for tools
    this.cacheLight = new THREE.DirectionalLight();
    this.cacheLight.castShadow = true;
    this.cacheLight.shadow.camera = sun.shadow.camera.clone();
    this.cachePos = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._hidden = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.copyMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: COPY_VS,
      fragmentShader: COPY_FS,
      // int vectors upload from arrays (uniform2iv), not from Vector2s
      uniforms: { cache: { value: null }, off: { value: new Int32Array(2) }, size: { value: new Int32Array(2) }, dz: { value: 0 } },
      depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, blending: THREE.NoBlending,
    });
    this.copyMesh = new THREE.Mesh(geo, this.copyMat);
    this.copyMesh.frustumCulled = false;
    this.copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // One ordinary render uploads the triangle and compiles the program, here
    // behind the loading screen: renderBufferDirect below draws only what is
    // already on the GPU.
    const rt = new THREE.WebGLRenderTarget(1, 1);
    const prime = new THREE.Scene();
    prime.add(this.copyMesh);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(prime, this.copyCam);
    renderer.setRenderTarget(prev);
    rt.dispose();
    // A shader that fails to compile does not throw: three logs it and the
    // draw does nothing, which here would be a city with no shadows. Refuse
    // to install unless the program is runnable.
    const prog = renderer.properties.get(this.copyMat).currentProgram;
    if (!prog || (prog.diagnostics && prog.diagnostics.runnable === false)) throw new Error('copy shader did not compile');
    this.fit();
    const sm = renderer.shadowMap;
    this._orig = sm.render.bind(sm);
    sm.render = (lights, scene, camera) => this.render(lights, scene, camera);
  }

  /** Size the cache from the live shadow camera. Call after changing it. */
  fit() {
    const sc = this.sun.shadow.camera, n = this.sun.shadow.mapSize.x;
    this.texel = (sc.right - sc.left) / n;
    const mt = Math.round(this.margin / this.texel);
    this.nc = n + 2 * mt;
    const half = (this.nc * this.texel) / 2;
    const cc = this.cacheLight.shadow.camera;
    cc.left = -half; cc.right = half; cc.top = half; cc.bottom = -half;
    cc.near = sc.near; cc.far = sc.far;
    cc.updateProjectionMatrix();
    this.cacheLight.shadow.mapSize.set(this.nc, this.nc);
    if (this.cacheLight.shadow.map) { this.cacheLight.shadow.map.dispose(); this.cacheLight.shadow.map = null; }
    this.cacheLight.shadow.bias = this.sun.shadow.bias;
    this.valid = false;
  }

  /** Something static inside the cache changed (a chunk, a landmark). */
  invalidate() { this.dirty = true; }

  /** A chunk at (x, z) was built or dropped: stale only if it is near the cache. */
  chunkChanged(x, z, r) {
    if (!this.valid) return;
    // the cache's box, the chunk's half-diagonal, and how far a tall caster's
    // shadow reaches at this sun (38 deg: a 260 m tower throws ~330 m)
    const c = this.cachePos, reach = (this.nc * this.texel) / 2 + r * 0.71 + 340;
    if (Math.abs(x - c.x) < reach && Math.abs(z - c.z) < reach) this.dirty = true;
  }

  render(lights, scene, camera) {
    const sun = this.sun, sh = sun.shadow;
    if (!this.on || lights.length !== 1 || lights[0] !== sun || !sh.map || !this.r.shadowMap.enabled) {
      return this._orig(lights, scene, camera);
    }
    try {
      // the live shadow camera for this frame (three would do this itself)
      sh.updateMatrices(sun);
      let o = this.dirty ? null : this._offset();
      if (!o) {
        this._renderCache(scene, camera);
        this.dirty = false;
        o = this._offset();
      }
      if (!o) return this._orig(lights, scene, camera);
      // 1. the cached statics, shifted into the live map
      const r = this.r;
      const prevTarget = r.getRenderTarget();
      r.setRenderTarget(sh.map);
      r.state.buffers.depth.setTest(true);
      const u = this.copyMat.uniforms;
      u.cache.value = this.cacheLight.shadow.map.texture;
      u.off.value[0] = o.x; u.off.value[1] = o.y;
      u.size.value[0] = this.nc; u.size.value[1] = this.nc;
      u.dz.value = o.dz;
      r.renderBufferDirect(this.copyCam, null, this.copyMesh.geometry, this.copyMat, this.copyMesh, null);
      r.setRenderTarget(prevTarget);
      // 2. the moving casters over them: statics hidden, three's clear skipped
      this._hideStatics(true);
      const clear = r.clear;
      r.clear = () => {};
      try { this._orig(lights, scene, camera); } finally { r.clear = clear; this._hideStatics(false); }
    } catch (e) {
      console.warn('shadow cache off:', e);
      this.on = false;
      this.r.shadowMap.needsUpdate = true;
      return this._orig(lights, scene, camera);
    }
  }

  /** Texel offset of the live map inside the cache, and the depth shift; null if it does not fit. */
  _offset() {
    if (!this.valid) return null;
    const cc = this.cacheLight.shadow.camera, sc = this.sun.shadow.camera;
    // the live camera's origin, seen from the cache camera
    const p = this._v.setFromMatrixPosition(sc.matrixWorld).applyMatrix4(cc.matrixWorldInverse);
    const n = this.sun.shadow.mapSize.x;
    const fx = p.x / this.texel + (this.nc - n) / 2, fy = p.y / this.texel + (this.nc - n) / 2;
    const x = Math.round(fx), y = Math.round(fy);
    // snapped boxes land on whole texels; anything else would smear
    if (Math.abs(fx - x) > 0.02 || Math.abs(fy - y) > 0.02) return null;
    if (x < 0 || y < 0 || x > this.nc - n || y > this.nc - n) return null;
    // depth: a point's distance from the live camera is its distance from the
    // cache camera less how far the live one sits ahead (p.z is minus that)
    const dz = p.z / (sc.far - sc.near);
    if (Math.abs(p.z) > this.margin) return null;
    return { x, y, dz };
  }

  _renderCache(scene, camera) {
    const sun = this.sun, cl = this.cacheLight;
    // same orientation as the sun, centred where the live box is now
    cl.position.copy(sun.position);
    cl.target.position.copy(sun.target.position);
    cl.updateMatrixWorld(true);
    cl.target.updateMatrixWorld(true);
    this.cachePos.copy(sun.target.position);
    const hid = [];
    const roots = new Set(this.statics().filter(Boolean));
    for (const o of scene.children) if (o.visible && !roots.has(o)) { o.visible = false; hid.push(o); }
    for (const o of this.keep()) if (o.visible) { o.visible = false; hid.push(o); }
    const sm = this.r.shadowMap, nu = sm.needsUpdate;
    try {
      sm.needsUpdate = true;
      this._orig([cl], scene, camera);
    } finally {
      for (const o of hid) o.visible = true;
      sm.needsUpdate = nu;
    }
    cl.shadow.camera.updateMatrixWorld(true);
    this.valid = !!cl.shadow.map;
    this.renders++;
  }

  _hideStatics(hide) {
    if (hide) {
      const keep = new Set(this.keep());
      const h = this._hidden;
      h.length = 0;
      for (const root of this.statics()) {
        if (!root || !root.visible) continue;
        // a root holding things that move keeps them: hide its other children
        if ([...keep].some((k) => k.parent === root)) {
          for (const c of root.children) if (c.visible && !keep.has(c)) { c.visible = false; h.push(c); }
        } else { root.visible = false; h.push(root); }
      }
    } else {
      for (const o of this._hidden) o.visible = true;
      this._hidden.length = 0;
    }
  }
}
