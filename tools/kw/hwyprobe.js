// Auto KW: the highway mix. Puts you in a car on the 401's longest edge (or
// HWY_RE's), unpauses 30 s with the chase camera, and reports what traffic
// spawned there: the type mix, how many semis (with their trailers) and OPP
// cruisers, any rig whose trailer lost its tractor, the scene's draws and
// triangles. Highway-only types are traffic.js HWY_SEMI_P / HWY_OPP_P.
//   VIEW_PROBE_FILE=tools/kw/hwyprobe.js node tools/kw/kwshots.mjs <dir>
(async () => {
  const d = window.__dbg, T = d.traffic, C = d.city;
  const re = new RegExp(window.HWY_RE || '401');
  let best = -1, bl = 0;
  C.edges.forEach((e, i) => { if (e.cls === 'hwy' && re.test(e.name || '') && T.inComponent(i) && e.len > bl) { bl = e.len; best = i; } });
  const e = C.edges[best], a = C.nodes[e.a], b = C.nodes[e.b];
  const L = Math.hypot(b.x - a.x, b.z - a.z), fx = (b.x - a.x) / L, fz = (b.z - a.z) / L;
  const off = T.laneLat(best, 1, { laneU: 0.5 });
  const v = T.spawnAt(a.x + fx * L * 0.5 - fz * off, a.z + fz * L * 0.5 + fx * off, Math.atan2(fx, fz), 'sedan', 0x6e7276, 'parked');
  d.player.enterVehicle(v);
  d.game.paused = false;
  const seen = new Map(), samples = [], before = new Set(T.cars);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    for (const c of T.cars) if (!seen.has(c) && !before.has(c) && c !== v) seen.set(c, c.typeName);
    if (i >= 10 && d.sceneStats) samples.push([d.sceneStats.calls, d.sceneStats.tris]);
  }
  d.game.paused = true;
  const types = {};
  for (const tn of seen.values()) types[tn] = (types[tn] || 0) + 1;
  const orphans = T.cars.filter((c) => c._mode === 'trailer' && !c.leader).length;
  const mean = (k) => Math.round(samples.reduce((s, x) => s + x[k], 0) / Math.max(1, samples.length));
  return { edge: e.name, at: [Math.round(v.x), Math.round(v.z)], px: Math.round(d.player.position.x), pz: Math.round(d.player.position.z), draws: mean(0), tris: Math.round(mean(1) / 1000) + 'k', spawned: seen.size,
    semis: types.semi || 0, trailers: types.semiTrailer || 0, opp: types.opp || 0, orphans,
    types: Object.entries(types).sort((p, q) => q[1] - p[1]).map(([k, n]) => `${k} ${n}`).join(', ') };
})()
