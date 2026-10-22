// Auto KW: the landmark root's meshes, counted per 1200 m cell and material.
//
//   VIEW_PROBE_FILE=tools/kw/lmcount.js AUTO_PHONE=1 node tools/kw/kwshots.mjs /tmp/x
//
// A landmarks pass that must add no draws (kwlandmarks2.js's LmKit) is checked
// by running this with the pass off and on (`VIEW_BOOT_JS='window.__noLm4=true'`)
// and diffing the two: `n` the meshes in all, `out` per "cx,cz:material" key.
// Identical counts mean every new shell and letter went into a cluster that
// already had a mesh in that material.
(() => {
  const r = window.__dbg.lmRoot, out = {};
  let n = 0;
  r.traverse((o) => {
    if (!o.isMesh) return;
    n++;
    const s = o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere);
    const p = s.center.clone().applyMatrix4(o.matrixWorld);
    const k = Math.round(p.x / 1200) + ',' + Math.round(p.z / 1200) + ':' + (o.material.name || o.material.type) + (o.material.map ? '+map' : '') + (o.material.vertexColors ? '+vc' : '');
    out[k] = (out[k] || 0) + 1;
  });
  return JSON.stringify({ n, out });
})()
