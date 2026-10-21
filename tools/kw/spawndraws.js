// Every draw call of one frame, attributed: for kwshots.mjs VIEW_PROBE_FILE.
// Hooks renderer.renderBufferDirect (three calls it once per draw, the shadow
// pass included) for one frame of the PLAYER view (the spawn, unless
// window.__sdEval poses something else first) and prints the scene pass and
// the shadow pass grouped by owner: top-level scene child / nearest named
// ancestor, with the zero-instance, zero-count and invisible-material draws
// flagged. Pin Math.random at boot for a repeatable world:
//
//   VIEW_BOOT_JS="$(cat tools/kw/seedrandom.js)" VIEW_PROBE_FILE=tools/kw/spawndraws.js \
//     AUTO_PHONE=1 AUTO_GPU=1 node tools/kw/kwshots.mjs /tmp/x
//
// window.__sdFull = true lists every draw (one line each) after the summary.
(async () => {
  const d = window.__dbg, R = d.renderer;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (window.__sdEval) eval(window.__sdEval);
  d.game.paused = false; d.camera.fov = 62; d.camera.updateProjectionMatrix();
  await sleep(+(window.__sdWait || 6000));
  // owners: every Object3D reachable from __dbg in two property hops
  // (d.world.group, d.traffic.group, d.skating.group, ...) names its subtree
  const owners = new Map();
  const isO = (v) => v && typeof v === 'object' && v.isObject3D;
  for (const k of Object.keys(d)) {
    let v; try { v = d[k]; } catch { continue; }
    if (!v || typeof v !== 'object' || k === 'scene' || k === 'camera' || k === 'THREE') continue;
    if (isO(v) && !owners.has(v)) owners.set(v, k);
    if (Array.isArray(v)) continue;
    for (const p of Object.keys(v)) {
      let w; try { w = v[p]; } catch { continue; }
      if (isO(w) && w !== d.scene && !owners.has(w)) owners.set(w, k + '.' + p);
      else if (w && typeof w === 'object' && !Array.isArray(w) && !isO(w) && p !== 'THREE') {
        for (const q of Object.keys(w).slice(0, 60)) { let x; try { x = w[q]; } catch { continue; } if (isO(x) && x !== d.scene && !owners.has(x)) owners.set(x, k + '.' + p + '.' + q); }
      }
    }
  }
  const label = (o) => {
    const path = [];
    for (let p = o; p && p !== d.scene; p = p.parent) path.push(p);
    const own = path.find((p) => owners.has(p));
    const named = path.find((p) => p.name);
    const top = path[path.length - 1];
    const on = own ? owners.get(own) : '(' + ((top && (top.name || top.type)) || '?') + ')';
    const nn = named ? named.name.split(':')[0] : '';
    return nn && nn !== on ? on + ' / ' + nn : on;
  };
  const rows = [];
  const orig = R.renderBufferDirect;
  let on = false;
  R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (on) {
      const pass = camera === d.camera ? 'scene' : camera.isOrthographicCamera && scene === null ? 'shadow' : 'other';
      const idx = geometry.index, n = idx ? idx.count : geometry.attributes.position ? geometry.attributes.position.count : 0;
      const flags = [];
      if (object.isInstancedMesh && object.count === 0) flags.push('ZERO-INSTANCES');
      if (geometry.drawRange.count === 0 || n === 0) flags.push('ZERO-COUNT');
      if (material.opacity === 0 && material.transparent) flags.push('OPACITY0');
      if (material.colorWrite === false) flags.push('NOCOLOR');
      if (material.visible === false) flags.push('MAT-INVISIBLE');
      rows.push({ pass, k: label(object), name: object.name, type: object.type, inst: object.isInstancedMesh ? object.count : 0,
        mat: material.type + (material.name ? '(' + material.name + ')' : ''), tri: Math.round((group ? group.count : Math.min(n, geometry.drawRange.count)) / 3), flags: flags.join(' '),
        cast: object.castShadow, frustumCulled: object.frustumCulled, uuid: object.id });
    }
    return orig.apply(this, arguments);
  };
  // one whole frame: arm on the next rAF, disarm on the one after
  await new Promise((res) => requestAnimationFrame(() => { on = true; requestAnimationFrame(() => { on = false; res(); }); }));
  R.renderBufferDirect = orig;
  const calls = d.sceneStats.calls;
  const out = [];
  for (const pass of ['scene', 'shadow', 'other']) {
    const rs = rows.filter((r) => r.pass === pass);
    if (!rs.length) continue;
    const by = new Map();
    for (const r of rs) {
      const g = by.get(r.k) || { n: 0, tri: 0, flags: new Set() };
      g.n++; g.tri += r.tri; if (r.flags) g.flags.add(r.flags);
      by.set(r.k, g);
    }
    out.push(`== ${pass}: ${rs.length} draws, ${Math.round(rs.reduce((a, r) => a + r.tri, 0) / 1000)}k tris` + (pass === 'scene' ? `  (sceneStats.calls ${calls}, which includes the shadow pass)` : ''));
    for (const [k, g] of [...by].sort((a, b) => b[1].n - a[1].n)) out.push(`  ${String(g.n).padStart(4)}  ${String(Math.round(g.tri / 1000)).padStart(5)}k  ${k}${g.flags.size ? '  [' + [...g.flags].join(', ') + ']' : ''}`);
  }
  if (window.__sdFull) for (const r of rows) out.push(`${r.pass}\t${r.k}\t${r.name}\t${r.type}\t${r.inst}\t${r.mat}\t${r.tri}\t${r.flags}\tcast=${r.cast}`);
  return out.join('\n');
})()
