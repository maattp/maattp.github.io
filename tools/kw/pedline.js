// Auto KW: where pedestrians walk across a residential street, against the
// sidewalk OSM maps on that side (citygen `swk`; peds.js walkOff).
//
//   VIEW_PROBE_FILE=tools/kw/pedline.js node tools/kw/kwshots.mjs /tmp/x
//
// At each site the streamer is settled, the crowd stepped at a fixed 1/30 s
// for `steps` frames with a stand-in player there (game paused, as kwshots
// leaves it), and every walker on a street edge sampled every 10 frames:
// his distance past the kerb line on his side, binned by that side's
// sidewalk. Prints per kind the share of samples ON THE LAWN (past the kerb
// and not on the walk band, or on the strip where none is mapped) and IN
// THE ROAD further in than 1 m (a walker in the lanes). `window.__plSites`
// replaces the sites; runs on master too (same sampling).
(async () => {
  const d = window.__dbg, c = d.city, P = d.peds, T = d.traffic;
  const SITES = window.__plSites || [[-3640, 190], [-2600, 440], [-1530, -775], [3600, 8555], [-2790, 4480], [13400, 9670], [-6485, -1448], [-9900, -2200]];
  const steps = window.__plSteps || 1500;
  const K = ['none', 'kerb', 'boulevard', 'unknown'];
  const S = K.map(() => ({ n: 0, lawn: 0, road: 0, walk: 0, sum: 0 }));
  const stand = { x: 0, z: 0, onFoot: false, vehicle: null, h: null, heading: 0 };
  for (const [x, z] of SITES) {
    for (let i = 0; i < 3000 && (i < 2 || [...d.world.chunks.values()].some((q) => q.lod !== q.wantLod)); i++) d.world.update(x, z, 60);
    stand.x = x; stand.z = z;
    for (const p of [...P.peds]) P.remove(p);
    for (let f = 0; f < steps; f++) {
      P.update(1 / 30, x, z, stand, T);
      if (f < 300 || f % 10) continue;
      for (const p of P.peds) {
        if (p.edge < 0 || p.pn > 0 || p.cop || p.fare || p.trail || p.state !== 'walk') continue;
        const e = c.edges[p.edge];
        if (!e || e.cls !== 'res' || e.swk === undefined) continue;
        const a = c.nodes[e.a];
        const t = ((p.x - a.x) * e.dx + (p.z - a.z) * e.dz);
        if (t < 8 || t > e.len - 8) continue;
        const qx = p.x - (a.x + e.dx * t), qz = p.z - (a.z + e.dz * t);
        const lat = qx * -e.dz + qz * e.dx, sg = lat >= 0 ? 1 : -1;
        const k = sg > 0 ? e.swk & 3 : (e.swk >> 2) & 3;
        const o = Math.abs(lat) - e.hw;
        const R = S[k];
        R.n++; R.sum += o;
        const onWalk = k === 1 ? o > 0 && o < 1.5 : k === 2 ? o > 1.1 && o < 2.6 : k === 3 ? o > 0 && o < 2.6 : false;
        if (onWalk) R.walk++;
        else if (o > 0) R.lawn++;
        else if (o < -1) R.road++;
      }
    }
  }
  return K.map((k, i) => {
    const R = S[i];
    return `${k.padEnd(10)} samples ${R.n}  mean ${(R.sum / (R.n || 1)).toFixed(2)} m past the kerb  on the walk ${(100 * R.walk / (R.n || 1)).toFixed(0)}%  lawn ${(100 * R.lawn / (R.n || 1)).toFixed(0)}%  >1 m into the road ${(100 * R.road / (R.n || 1)).toFixed(0)}%`;
  }).join('\n');
})()
