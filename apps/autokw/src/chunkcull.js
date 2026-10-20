// THE CITY'S CHUNKS ARE FRUSTUM-CULLED WHOLE, before three culls their meshes.
//
// three tests every visible mesh against the camera every frame (projectObject:
// a bounding sphere moved into world space and six planes), and the streamed
// city is ~81 chunk groups of up to six merged meshes each, most of them behind
// or beside the camera. On the phone profile projectObject was the hottest
// function left in the frame once hidden objects stopped being matrix-updated.
//
// So before the scene pass, each chunk group whose bounds (the union of its
// meshes' spheres, worked out once) are outside the camera's frustum is hidden,
// and shown again straight after. It is exact: a mesh inside a sphere that is
// wholly outside one plane is outside it too, so three would have culled every
// one of them. Chunks holding anything three does not cull by its geometry's
// sphere (frustumCulled off, instanced or skinned meshes, sprites) are left to
// three. The SHADOW pass must still see them -- a building behind you casts
// into view -- so the wrapper on shadowMap.render shows them for its duration
// (it is installed after shadowcache.js's, so the cache's own re-renders see
// them too).
import * as THREE from './three.js';

export function installChunkCull(renderer, root) {
  const fr = new THREE.Frustum(), m = new THREE.Matrix4();
  const bounds = new WeakMap();   // chunk group -> world sphere, or false (never cull)
  const hidden = [];
  const tmp = new THREE.Sphere();

  const boundOf = (g) => {
    let s = bounds.get(g);
    if (s !== undefined) return s;
    // Chunk meshes are built in world coordinates under groups at the origin,
    // but measure from fresh matrices anyway: a group first met here, before
    // any render has updated it, must not have its bounds cached from stale ones.
    g.updateWorldMatrix(true, true);
    let ok = g.children.length > 0, pending = false;
    const sph = new THREE.Sphere();
    let first = true;
    g.traverse((o) => {
      if (!ok || o === g) return;
      if (!o.isMesh) { if (!o.isGroup && o.type !== 'Object3D') ok = false; return; }   // containers only
      if (o.isInstancedMesh || o.isSkinnedMesh || !o.frustumCulled) { ok = false; return; }
      const geo = o.geometry;
      if (!geo || !geo.boundingSphere) { pending = true; return; }
      tmp.copy(geo.boundingSphere).applyMatrix4(o.matrixWorld);
      if (first) { sph.copy(tmp); first = false; } else sph.union(tmp);
    });
    if (!ok || first) s = false;
    else if (pending) return false;   // a geometry three has not sized yet: ask again next frame
    else s = sph;
    bounds.set(g, s);
    return s;
  };

  const sm = renderer.shadowMap, inner = sm.render;
  sm.render = function (...a) {
    if (!hidden.length) return inner.apply(this, a);
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
    try { return inner.apply(this, a); } finally { for (let i = 0; i < hidden.length; i++) hidden[i].visible = false; }
  };

  return {
    /** Hide the chunk groups outside camera's frustum (call restore() after the render). */
    cull(camera) {
      camera.updateMatrixWorld();
      m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      fr.setFromProjectionMatrix(m);
      const ch = root.children;
      for (let i = 0; i < ch.length; i++) {
        const g = ch[i];
        if (!g.visible || !g.isGroup) continue;
        const s = boundOf(g);
        if (s && !fr.intersectsSphere(s)) { g.visible = false; hidden.push(g); }
      }
      return hidden.length;
    },
    restore() {
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
      hidden.length = 0;
    },
  };
}
