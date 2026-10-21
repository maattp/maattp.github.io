// VIEW_PROBE_FILE for kwshots.mjs (with VIEW_PRE_FILE=tools/kw/streetsignpre.js):
// what the street-name signs found at a few corners, and the module's counts.
(() => {
  const d = window.__dbg, city = d.city;
  const out = {};
  const corners = window.__ssCorners || [['Sandhills', 'Erb', -16115, 2675], ['Snyder', 'Sandhills', -14207, 5054],
    ['King Street', 'Erb Street', -3834, -1465], ['King Street East', 'Cedar', -685, 517],
    ['White Elm', 'Butternut', -9217, -1473], ['Main Street', 'Ainslie', 13064, 10343]];
  for (const [a, b, x, z] of corners) {
    const s = window.__ssFind(a, b, x, z);
    const ni = city.nearestNode(x, z, 60);
    const n = ni >= 0 ? city.nodes[ni] : null;
    out[a + '/' + b] = s
      ? { names: s.names, style: s.style, posts: s.posts.map((p) => ({ k: p.kind, b: p.blades.length, sh: p.shields.length })), over: (s.over || []).length, faces: s.faces.map((f) => f.spec.key) }
      : { none: true, node: n && { e: n.e.map((ei) => [city.edges[ei].name, city.edges[ei].cls, !!city.edges[ei].rural, Math.round(city.edges[ei].len)]), elev: n.elev, d: Math.round(Math.hypot(n.x - x, n.z - z)) } };
  }
  out.stats = window.__streetSigns;
  return out;
})()
