// Auto KW: is any freeway furniture solid standing in a lane? Every landmark
// solid within reach of a freeway or ramp carriageway (guide rail pieces,
// crash cushions, sign posts, the tall wall) is tested at its centre and its
// four corners against every graded hwy / ramp edge's LANES (the lane basis,
// `ltw`, less 0.3 m): a corner inside them is a solid traffic can drive into.
//   VIEW_PROBE_FILE=tools/kw/hwysolidprobe.js node tools/kw/kwshots.mjs /tmp/x
(() => {
  const d = window.__dbg, c = d.city, E = c.edges, N = c.nodes;
  const inLane = (x, z, y) => {
    for (const ei of c.edgesNear(x, z, 0)) {
      const e = E[ei];
      if (!(e.cls === 'hwy' || e.cls === 'ramp') || !e.prof || e.tunnel) continue;
      const a = N[e.a];
      const t = ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len;
      if (t < 0 || t > 1) continue;
      const i = Math.round(t * e.pk);
      if (Math.abs(e.ph[i] - y) > 2.5) continue;
      const l = (x - a.x) * -e.dz + (z - a.z) * e.dx, s = l >= 0 ? 0 : 1;
      const w = Math.min((e.ltw || e.tw)[i * 2 + s], e.tw[i * 2 + s]);
      if (e.tw[i * 2] + e.tw[i * 2 + 1] < 1) continue;   // a ramp collapsed onto the main line here
      if (Math.abs(l) < w - 0.3) return ei;
    }
    return -1;
  };
  const S = c.landmarkSolids || [];
  let n = 0, bad = [];
  for (const s of S) {
    if (!(s.hw > 0) || s.hw > 40) continue;
    const near = c.edgesNear(s.x, s.z, 0).some((ei) => E[ei].cls === 'hwy' || E[ei].cls === 'ramp');
    if (!near) continue;
    n++;
    const cr = Math.cos(s.rot || 0), sr = Math.sin(s.rot || 0);
    const pts = [[0, 0], [s.hw, s.hd], [s.hw, -s.hd], [-s.hw, s.hd], [-s.hw, -s.hd]];
    for (const [u, v] of pts) {
      const x = s.x + cr * u - sr * v, z = s.z + sr * u + cr * v;
      const ei = inLane(x, z, (s.y0 + s.y1) / 2);
      if (ei >= 0) { bad.push({ x: +x.toFixed(1), z: +z.toFixed(1), hw: s.hw, hd: s.hd, mono: !!s.mono, ei, cls: E[ei].cls }); break; }
    }
  }
  return JSON.stringify({ solids: n, inLane: bad.length, bad: bad.slice(0, 30) });
})()
