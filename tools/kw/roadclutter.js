// Auto KW: things standing in the road. Builds the world round a list of
// sites and counts every collision obstacle (city.addObstacle: poles,
// hydrants, trunks, signs...) whose centre is on a carriageway -- each one is
// a post a traffic car can wedge itself against, back out of at speed and
// crash into the car behind (the signal at -324,430: two of its poles stood
// in the lanes, 4 crashes in 20 minutes of traffic). Grouped by radius (the
// kind of thing), with examples.
//
//   VIEW_PROBE_FILE=tools/kw/roadclutter.js node tools/kw/kwshots.mjs /tmp/x
//   (window.__rcl = { sites: [[x, z], ...], r: 600 } in VIEW_BOOT_JS)
(() => {
  const d = __dbg, c = d.city;
  const cfg = Object.assign({ r: 500, sites: [[-2928, -560], [-1644, -157], [-6728, -2057], [-324, 430], [12000, 8800],
    [1850, 2150], [-5300, -2240], [8600, 5600], [11800, 2600], [-6200, -9500], [-7600, 1000], [5560, 6985]] }, window.__rcl || {});
  const pending = () => [...d.world.chunks.values()].filter((ch) => ch.lod !== ch.wantLod).length;
  const seen = new Set(), byR = {}, ex = {};
  let total = 0, onRoad = 0;
  for (const [x, z] of cfg.sites) {
    d.world.update(x, z, 60);
    for (let i = 0; i < 3000 && pending() > 0; i++) d.world.update(x, z, 60);
    for (const [key, l] of c.obstacles) {
      for (let i = 0; i < l.length; i += 3) {
        const ox = l[i], oz = l[i + 1], r = l[i + 2];
        if (Math.hypot(ox - x, oz - z) > cfg.r) continue;
        const k = Math.round(ox * 10) + ',' + Math.round(oz * 10);
        if (seen.has(k)) continue;
        seen.add(k); total++;
        if (!c.onRoad(ox, oz, 0, false, false)) continue;
        onRoad++;
        const rk = r.toFixed(2);
        byR[rk] = (byR[rk] || 0) + 1;
        (ex[rk] = ex[rk] || []).length < 4 && ex[rk].push([Math.round(ox * 10) / 10, Math.round(oz * 10) / 10]);
      }
    }
  }
  return JSON.stringify({ total, onRoad, byRadius: byR, examples: ex });
})()
