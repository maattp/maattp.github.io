// What draws in a view, by mesh name: for kwshots.mjs VIEW_PROBE_FILE.
// Set window.__probeViews = [{ name, c: [x, z, h], t: [x, z, h], fov }] in
// VIEW_PRE (or edit VIEWS below); prints, per view, the scene pass's draws and
// the visible meshes in the frustum grouped by name (up to the first ':').
//
//   VIEW_PRE='window.__probeViews=[{name:"x",c:[..],t:[..]}]' VIEW_PROBE_FILE=tools/kw/drawprobe.js node tools/kw/kwshots.mjs /tmp/x
(async () => {
  const d = window.__dbg, THREE = d.THREE;
  const views = window.__probeViews || [];
  const out = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const V of views) {
    const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
    const [cx, cz] = V.c, [tx, tz] = V.t;
    const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
    d.world.update(cx, cz, 60);
    for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(cx, cz, 60);
    const cy = gy(cx, cz) + V.c[2];
    d.camera.fov = V.fov || 62; d.camera.updateProjectionMatrix();
    d.camera.position.set(cx, cy, cz);
    d.camera.lookAt(tx, gy(tx, tz) + V.t[2], tz);
    d.camera.updateMatrixWorld(true);
    await sleep(4000);
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(d.camera.projectionMatrix, d.camera.matrixWorldInverse));
    const by = {};
    d.scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) return;
      if (o.frustumCulled && o.geometry) {
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld);
        if (!fr.intersectsSphere(s)) return;
      }
      const k = window.__probeFull && (o.name || '').startsWith('landmarks') ? o.name + '|' + (o.material.type || '') + (o.material.map ? '+map' : '') : (o.name || o.parent?.name || '?').split(':')[0];
      by[k] = (by[k] || 0) + (Array.isArray(o.material) ? o.material.length : 1);
    });
    out.push(`${V.name}: calls ${d.sceneStats.calls} tris ${Math.round(d.sceneStats.tris / 1000)}k  ` + Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, window.__probeFull ? 400 : 18).map(([k, v]) => `${k} ${v}`).join(', '));
  }
  return out.join('\n');
})()
