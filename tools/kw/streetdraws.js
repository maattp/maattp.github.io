// The scene pass's draws at street level in a few residential neighbourhoods,
// grouped by what draws them: for kwshots.mjs VIEW_PROBE_FILE.
//
//   VIEW_PROBE_FILE=tools/kw/streetdraws.js AUTO_PHONE=1 AUTO_GPU=1 node tools/kw/kwshots.mjs /tmp/x
//
// Each site is a driver's-seat camera on the named street at the point given
// (snapped to its nearest edge, 1.8 m right of the centreline, looking 60 m
// along it), posed with the game paused as kwshots poses a view. Prints, per
// site, calls / triangles and the groups that differ most: compare builds
// one after the other (CLAUDE.md "Verifying"). `window.__sdSites` replaces
// the list.
(async () => {
  const d = window.__dbg, R = d.renderer, c = d.city;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SITES = window.__sdSites || [
    ['westmount', 'Dunbar', -3640, 190], ['mthope', 'Ahrens', -1530, -775], ['breithaupt', 'Breithaupt', -921.5, -749.4],
    ['doonsouth', 'Thomas Slee', 3600, 8555], ['activa', 'Activa', -2790, 4480], ['galt', 'Wellington', 13400, 9670],
  ];
  const label = (o) => {
    for (let p = o; p; p = p.parent) if (p.name) return p.name.split(':')[0] + (p === o ? '' : '/' + (o.type || ''));
    return o.type;
  };
  const out = [];
  for (const [name, street, px, pz] of SITES) {
    let best = -1, bd = 1e9;
    for (const ei of c.roadsNear(px, pz, 80, false)) {
      const e = c.edges[ei]; if (!e.name || !e.name.includes(street)) continue;
      const a = c.nodes[e.a], b = c.nodes[e.b], vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz;
      const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / L2));
      const dd = Math.hypot(a.x + vx * t - px, a.z + vz * t - pz);
      if (dd < bd) { bd = dd; best = ei; }
    }
    if (best < 0) { out.push(name + ': no street'); continue; }
    const e = c.edges[best], a = c.nodes[e.a], b = c.nodes[e.b];
    const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz, L = Math.sqrt(L2), dx = vx / L, dz = vz / L;
    const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / L2));
    const cx = a.x + vx * t - dz * 1.8, cz = a.z + vz * t + dx * 1.8;
    d.world.update(cx, cz, 60);
    for (let i = 0; i < 3000 && [...d.world.chunks.values()].some((q) => q.lod !== q.wantLod); i++) d.world.update(cx, cz, 60);
    const gy = (x, z) => Math.max(0, c.groundAt(x, z, null));
    d.camera.fov = 62; d.camera.updateProjectionMatrix();
    d.camera.position.set(cx, gy(cx, cz) + 1.25, cz);
    d.camera.lookAt(cx + dx * 60, gy(cx + dx * 60, cz + dz * 60) + 1.4, cz + dz * 60);
    d.camera.updateMatrixWorld(true);
    await sleep(2500);
    const groups = new Map();
    let calls = 0, tris = 0, on = false;
    const orig = R.renderBufferDirect;
    R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      if (on && camera === d.camera) {
        const idx = geometry.index, n = idx ? idx.count : geometry.attributes.position.count;
        const tr = Math.round((group ? group.count : Math.min(n, geometry.drawRange.count)) / 3) * (object.isInstancedMesh ? object.count : 1);
        const k = label(object);
        const g = groups.get(k) || { n: 0, tri: 0 };
        g.n++; g.tri += tr; groups.set(k, g);
        calls++; tris += tr;
      }
      return orig.apply(this, arguments);
    };
    await new Promise((r) => requestAnimationFrame(() => { on = true; requestAnimationFrame(() => { on = false; r(); }); }));
    R.renderBufferDirect = orig;
    const top = [...groups.entries()].sort((p, q) => q[1].n - p[1].n).slice(0, 14).map(([k, g]) => `${k} ${g.n}`).join(', ');
    out.push(`${name}: calls ${calls} tris ${Math.round(tris / 1000)}k | ${top}`);
  }
  return out.join('\n');
})()
