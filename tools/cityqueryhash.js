// An expression (memprobe.mjs MEM_PROBE_FILE, boottime.mjs BOOT_PROBE) that
// hashes the city's ground and road queries at 6000 seeded points across the
// map: a change to how the query grids are stored must leave every answer
// identical. Prints the hash and how many answers it covers.
(() => {
  const c = window.__dbg.city, H = window.__dbg.G.MAP_HALF;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let h = 2166136261, n = 0;
  const mix = (v) => {
    const s = typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(4) : String(v)) : JSON.stringify(v);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    n++;
  };
  for (let i = 0; i < 6000; i++) {
    // half downtown-ish (dense), half anywhere
    const x = i % 2 ? (rnd() - 0.5) * 2 * H : (rnd() - 0.5) * 8000;
    const z = i % 2 ? (rnd() - 0.5) * 2 * H : (rnd() - 0.5) * 12000;
    const y = c.groundAt(x, z, null);
    mix(y);
    mix(c.roadLift(x, z));
    mix(c.onRoad(x, z, 1));
    mix(c.onRoad(x, z, 0, false, false));
    const near = c.roadsNear(x, z, 25);
    mix(near.length); mix(near.slice(0, 6));
    mix(c.carriagewayAt(x, z, y, -1));
    mix(c.buildingsNear(x, z, 40).length);
    const nn = c.nearestNode(x, z);
    mix(nn ? [nn.x, nn.z] : null);
    const rp = c.respawnPointNear(x, z, 400);
    mix(rp ? [rp.x, rp.z, rp.elev] : null);
    if (near.length) mix(c.roadCoveredAt(x, z, near[0]));
    const ns = c.nodeSurface(x, z);
    mix(ns && typeof ns === 'object' ? Object.values(ns).filter((v) => typeof v === 'number') : ns);
  }
  return `queries ${n} hash ${h.toString(16)}`;
})()
