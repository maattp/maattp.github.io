// Auto KW: the street's poles and lights against the lanes and the driveways.
//
//   VIEW_BOOT_JS='window.__logSolids=[]' VIEW_PROBE_FILE=tools/kw/poleprobe.js \
//     AUTO_PHONE=1 node tools/kw/kwshots.mjs /tmp/x
//
// world.js logs every hydro pole, era street light (`lamp1`..`lamp3`) and
// driveway apron it plants into window.__logSolids (kind, x, z, r) when that
// array exists before boot; trees.js logs its trees. The streamer is settled
// round each site in turn (the near chunks are where props are planted), then
// every pole and light is checked: IN A LANE (city.onRoad with no pad, any
// carriageway, its own or a cross street's), ON A DRIVEWAY (inside a logged
// apron's circle: the driveway's half-width, from any chunk), and A TRUNK ON
// IT (a tree within 0.8 m). Prints the counts, the share of each kind by
// where it stands past its street's kerb, and the first few offenders.
// `window.__ppSites` replaces the site list.
(async () => {
  const d = window.__dbg, c = d.city, L = window.__logSolids;
  if (!L) return 'set VIEW_BOOT_JS=window.__logSolids=[] (before boot)';
  const SITES = window.__ppSites || [
    [-3640, 190], [-2600, 440], [-1530, -775], [-921, -749], [-9900, -2200], [-8788, -637], [3600, 8555],
    [-400, 7850], [-2790, 4480], [13400, 9670], [12820, 11330], [12490, 3000], [-6485, -1448], [-4028, 3473],
    [-4613, -2463], [-3721, 1374], [2379, 646], [-6585, -4598],
  ];
  for (const [x, z] of SITES) {
    for (let i = 0; i < 3000 && (i < 2 || [...d.world.chunks.values()].some((q) => q.lod !== q.wantLod)); i++) d.world.update(x, z, 60);
  }
  const aprons = [], trees = [], items = [];
  for (let i = 0; i < L.length; i += 4) {
    const k = L[i];
    if (k === 'apron') aprons.push(L[i + 1], L[i + 2], L[i + 3]);
    else if (k.startsWith('tree')) trees.push(L[i + 1], L[i + 2], k);
    else items.push([k, L[i + 1], L[i + 2], L[i + 3]]);
  }
  // one record per spot (a chunk rebuilt logs again)
  const seen = new Set(), uniq = [];
  for (const it of items) { const key = it[0] + Math.round(it[1] * 10) + ',' + Math.round(it[2] * 10); if (!seen.has(key)) { seen.add(key); uniq.push(it); } }
  const res = {}, bad = [];
  const offOf = (x, z) => {
    let bd = 1e9, hw = 0;
    for (const ei of c.roadsNear(x, z, 25, false)) {
      const e = c.edges[ei], a = c.nodes[e.a], b = c.nodes[e.b], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
      const dd = Math.hypot(a.x + vx * t - x, a.z + vz * t - z) - e.hw;
      if (dd < bd) { bd = dd; hw = e.hw; }
    }
    return bd;
  };
  for (const [k, x, z, r] of uniq) {
    const R = res[k] || (res[k] = { n: 0, lane: 0, drive: 0, trunk: 0, off: [0, 0, 0, 0, 0] });
    R.n++;
    const o = offOf(x, z);
    R.off[o < 0 ? 0 : o < 1 ? 1 : o < 2 ? 2 : o < 3 ? 3 : 4]++;
    let why = '';
    if (c.onRoad(x, z, 0, false)) { R.lane++; why = 'lane'; }
    for (let i = 0; i < aprons.length; i += 3) {
      if (Math.hypot(aprons[i] - x, aprons[i + 1] - z) < aprons[i + 2] + r) { R.drive++; why += ' drive'; break; }
    }
    for (let i = 0; i < trees.length; i += 3) {
      if (Math.hypot(trees[i] - x, trees[i + 1] - z) < 0.8) { R.trunk++; why += ' ' + trees[i + 2]; break; }
    }
    if (why && bad.length < 12) bad.push(`${k} (${x.toFixed(1)}, ${z.toFixed(1)}) ${why} off ${o.toFixed(2)}`);
  }
  const lines = ['poles and lights (off = metres past the nearest kerb line: <0 / 0-1 / 1-2 / 2-3 / 3+):'];
  for (const k of Object.keys(res).sort()) {
    const R = res[k];
    lines.push(`  ${k.padEnd(6)} ${String(R.n).padStart(5)}  in a lane ${R.lane}  on a driveway ${R.drive}  trunk on it ${R.trunk}  off ${R.off.join('/')}`);
  }
  lines.push(`  aprons ${aprons.length / 3}, trees ${trees.length / 3}, boulevard trees ${d.cityStats.boulevardTrees || 0}`);
  return lines.concat(bad.map((b) => '    ' + b)).join('\n');
})()
