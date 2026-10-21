// Auto KW: the visual sweep's camera picker. Picks ~60 road points across the
// map (a seeded draw stratified by road class, plus fixed spots: Uptown,
// downtown Kitchener, Galt, St. Jacobs, the campuses, plazas, Conestoga Doon)
// and prints a kwshots VIEWS list: from each point, the driver's eye (1.3 m
// over the road, 1.8 m right of its centreline) looking along the road both
// ways and across it both ways -- four shots a point.
//
//   VIEW_PROBE_FILE=tools/kw/sweeppick.js node tools/kw/kwshots.mjs /tmp/x \
//     | sed -n '/^\[/,/^\]/p' > /tmp/sweep.json
//   VIEWS=/tmp/sweep.json VIEW_WAIT=2500 node tools/kw/kwshots.mjs <dir>
//   (window.__sweep = { n: 60, seed: 7 } in VIEW_BOOT_JS for another draw)
//
// Then LOOK at every shot: floating or sunk things, z-fighting, holes in the
// road or the ground, signs facing away, things standing in the road, trees
// in buildings.
(() => {
  const d = window.__dbg, c = d.city;
  const cfg = Object.assign({ n: 60, seed: 7 }, window.__sweep || {});
  let s = cfg.seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const fixed = [
    ['uptown', -2928, -560], ['dtk', -1644, -157], ['galt', 12000, 8800], ['stjacobs', -6200, -9500],
    ['uw', -5300, -2240], ['wlu', -3720, -1660], ['conestoga', 5560, 6985], ['fairview', 1850, 2150],
    ['boardwalk', -7600, 1000], ['sunrise', -900, 2900], ['hespeler', 11800, 2600], ['preston', 8600, 5600],
  ];
  const quota = { hwy: 8, ramp: 5, art: 12, st: 10, res: 13 };
  const byCls = {};
  c.edges.forEach((e, i) => {
    if (e.tunnel || e.len < 25) return;
    const k = quota[e.cls] ? e.cls : 'other';
    (byCls[k] = byCls[k] || []).push(i);
  });
  const picks = [];
  const used = [];
  const farEnough = (x, z) => used.every(([a, b]) => (a - x) ** 2 + (b - z) ** 2 > 600 * 600);
  const add = (name, ei, t) => {
    const e = c.edges[ei], a = c.nodes[e.a], b = c.nodes[e.b];
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    used.push([x, z]);
    picks.push({ name, x, z, ux: e.dx, uz: e.dz, hw: e.hw, cls: e.cls, ei });
  };
  for (const [name, x, z] of fixed) {
    // the nearest drivable edge to the spot
    let best = -1, bd = 1e12;
    for (const ei of c.edgesNear(x, z, 120)) {
      const e = c.edges[ei];
      if (e.tunnel || e.cls === 'hwy') continue;
      const a = c.nodes[e.a];
      const t = Math.max(0, Math.min(1, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len));
      const dd = (a.x + e.dx * e.len * t - x) ** 2 + (a.z + e.dz * e.len * t - z) ** 2;
      if (dd < bd) { bd = dd; best = ei; }
    }
    if (best >= 0) {
      const e = c.edges[best], a = c.nodes[e.a];
      add(name, best, Math.max(0.1, Math.min(0.9, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len)));
    }
  }
  for (const [k, q] of Object.entries(quota)) {
    const L = byCls[k] || [];
    let got = 0;
    for (let tries = 0; got < q && tries < 4000; tries++) {
      const ei = L[Math.floor(rnd() * L.length)];
      const e = c.edges[ei], a = c.nodes[e.a];
      const t = 0.2 + rnd() * 0.6;
      if (!farEnough(a.x + e.dx * e.len * t, a.z + e.dz * e.len * t)) continue;
      add(`${k}${got}`, ei, t);
      got++;
    }
  }
  const views = [];
  const dirs = [['f', 1, 0], ['b', -1, 0], ['r', 0, 1], ['l', 0, -1]];
  picks.slice(0, cfg.n).forEach((P, i) => {
    const rx = -P.uz, rz = P.ux, o = Math.min(P.hw - 1.5, 1.8);
    const cx = P.x + rx * o, cz = P.z + rz * o;
    for (const [tag, fu, fr] of dirs) {
      const dx = P.ux * fu + rx * fr, dz = P.uz * fu + rz * fr;
      views.push({ name: `sw${String(i).padStart(2, '0')}-${P.name}-${tag}`, c: [+cx.toFixed(1), +cz.toFixed(1), 1.3],
        t: [+(cx + dx * 60).toFixed(1), +(cz + dz * 60).toFixed(1), 1.6], fov: 62, cy: undefined });
    }
  });
  return JSON.stringify(views.map((v) => { delete v.cy; return v; }), null, 0).replace(/\},\{/g, '},\n{');
})()
