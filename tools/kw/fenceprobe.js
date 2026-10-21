// Auto KW: rural field-edge fences through tree trunks (world.meshRuralProps
// fences vs trees.js), counted from the collision store both draw into.
//
//   VIEW_PROBE_FILE=tools/kw/fenceprobe.js node tools/kw/kwshots.mjs /tmp/x
//
// At each site the streamer is settled, then every fence post (r 0.12) and
// snake-rail panel (r 0.2) in city.obstacles is checked against every trunk
// (r >= 0.25) near it: closer than the two radii + 0.15 m is a fence through a
// tree. Prints per site and the first examples with a camera (kwshots VIEWS).
(() => {
  const d = window.__dbg, c = d.city, w = d.world;
  const sites = (window.__fence && window.__fence.sites) || [[-9600, -8046], [-12229, -7663], [-12223, -3152], [6242, -13567], [-13500, -9000], [-8823, -9797]];
  const out = { sites: [], total: 0, posts: 0, ex: [] };
  for (const [X, Z] of sites) {
    const pending = () => [...w.chunks.values()].filter((q) => q.lod !== q.wantLod).length;
    w.update(X, Z, 60);
    for (let i = 0; i < 3000 && pending() > 0; i++) w.update(X, Z, 60);
    const posts = [], trees = [];
    for (const l of c.obstacles.values()) for (let i = 0; i < l.length; i += 3) {
      if (Math.abs(l[i] - X) > 450 || Math.abs(l[i + 1] - Z) > 450) continue;
      const r = l[i + 2];
      if (r > 0.11 && r < 0.13) posts.push([l[i], l[i + 1], r]);
      else if (r > 0.19 && r < 0.21) posts.push([l[i], l[i + 1], r]);
      else if (r >= 0.25) trees.push([l[i], l[i + 1], r]);
    }
    const g = new Map();
    for (const t of trees) { const k = Math.floor(t[0] / 8) * 100003 + Math.floor(t[1] / 8); if (!g.has(k)) g.set(k, []); g.get(k).push(t); }
    let n = 0;
    for (const p of posts) {
      const cx = Math.floor(p[0] / 8), cz = Math.floor(p[1] / 8);
      let hit = null;
      for (let dx = -1; dx <= 1 && !hit; dx++) for (let dz = -1; dz <= 1 && !hit; dz++) {
        for (const t of g.get((cx + dx) * 100003 + cz + dz) || []) if (Math.hypot(t[0] - p[0], t[1] - p[1]) < t[2] + p[2] + 0.15) { hit = t; break; }
      }
      if (!hit) continue;
      n++;
      if (out.ex.length < 8) out.ex.push({ at: [+p[0].toFixed(1), +p[1].toFixed(1)], tree: [+hit[0].toFixed(1), +hit[1].toFixed(1), hit[2]],
        view: { name: `fence-${out.ex.length}`, c: [+(p[0] + 6).toFixed(1), +(p[1] + 6).toFixed(1), 1.7], t: [+p[0].toFixed(1), +p[1].toFixed(1), 0.8], fov: 55 } });
    }
    out.sites.push({ at: [X, Z], posts: posts.length, trees: trees.length, through: n });
    out.total += n; out.posts += posts.length;
  }
  return JSON.stringify(out, null, 1);
})()
