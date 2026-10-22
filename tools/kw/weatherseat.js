// Seats for tools/kw/weatherviews.json, after artseat.js (kwshots takes one
// VIEW_PRE_FILE, so put the two in one file first):
//   cat tools/kw/artseat.js tools/kw/weatherseat.js > /tmp/wxpre.js
//   VIEW_PRE_FILE=/tmp/wxpre.js VIEWS=tools/kw/weatherviews.json AUTO_GPU=1 node tools/kw/kwshots.mjs <dir>
// __resSeat(x, z, ahead): the named residential street (25 m or longer)
// nearest (x, z), from 1.25 m up in its lane, looking `ahead` m along it.
window.__resSeat = (px, pz, ahead = 60) => {
  const c = window.__dbg.city;
  let best = null, bd = 1e9;
  for (const ei of c.roadsNear(px, pz, 300, false)) {
    const e = c.edges[ei];
    const a = c.nodes[e.a], b = c.nodes[e.b];
    if (e.cls !== 'res' || !e.name || Math.hypot(b.x - a.x, b.z - a.z) < 25) continue;
    const d = Math.hypot((a.x + b.x) / 2 - px, (a.z + b.z) / 2 - pz);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return null;
  const a = c.nodes[best.a], b = c.nodes[best.b];
  return window.__seat(best.name, (a.x + b.x) / 2, (a.z + b.z) / 2, 0.6, ahead);
};
