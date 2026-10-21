// Auto KW: the fleet at the spawn, for kwshots VIEW_PROBE_FILE: unpauses the
// game for 12 s with the chase camera, then reports the scene pass's draws and
// triangles, how many vehicles are about, and the type and colour mix.
//   VIEW_PROBE_FILE=tools/kw/carprobe.js node tools/kw/kwshots.mjs <dir>
(async () => {
  const d = window.__dbg;
  d.game.paused = false;
  const samples = [];
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (i >= 6 && d.sceneStats) samples.push([d.sceneStats.calls, d.sceneStats.tris]);
  }
  d.game.paused = true;
  const cars = d.traffic.cars, types = {}, cols = {};
  for (const v of cars) {
    types[v.typeName] = (types[v.typeName] || 0) + 1;
    const c = v.color.toString(16).padStart(6, '0');
    cols[c] = (cols[c] || 0) + 1;
  }
  const mean = (k) => Math.round(samples.reduce((a, s) => a + s[k], 0) / Math.max(1, samples.length));
  return { draws: mean(0), tris: Math.round(mean(1) / 1000) + 'k', samples, vehicles: cars.length,
    types: Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') };
})()
