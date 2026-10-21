// VIEW_PROBE_FILE for kwshots.mjs: the street-name signs' CPU along King
// Street, Uptown Waterloo to downtown Kitchener (3 km, a gather every 25 m),
// with the world streamed in at each step. VIEW_THROTTLE=8 is the phone
// stand-in. Prints the module's counters (siteMs: working out corners, lazily
// per chunk; gatherMs/gatherMax: rebuilding the lettered quads and drawing new
// names into the atlas).
(async () => {
  const d = window.__dbg, S = d.streetSigns, st = window.__streetSigns;
  if (!S) return 'no street signs';
  const a = [-3834, -1465], b = [-685, 517];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 25);
  const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
  const g0 = st.gatherMs, s0 = st.siteMs, k0 = st.gathers, u0 = st.uploads;
  st.gatherMax = 0;
  let worldMs = 0;
  for (let i = 0; i <= n; i++) {
    const x = a[0] + (b[0] - a[0]) * i / n, z = a[1] + (b[1] - a[1]) * i / n;
    const t0 = performance.now();
    d.world.update(x, z, 60);
    for (let k = 0; k < 400 && pending() > 0; k++) d.world.update(x, z, 60);
    worldMs += performance.now() - t0;
    d.camera.position.set(x, d.city.groundAt(x, z, null) + 1.4, z);
    S.update(d.camera, 0.01);
    for (let k = 0; k < 3 && S._more; k++) S.update(d.camera, 0.01);
  }
  return { drawMs: +st.drawMs.toFixed(1), upMs: +st.upMs.toFixed(1), steps: n, gathers: st.gathers - k0, gatherMs: +(st.gatherMs - g0).toFixed(1), perGather: +((st.gatherMs - g0) / Math.max(1, st.gathers - k0)).toFixed(2),
    gatherMax: +st.gatherMax.toFixed(2), siteMs: +(st.siteMs - s0).toFixed(1), uploads: st.uploads - u0, evicted: st.evicted, keys: st.keys, faces: st.faces,
    worldMs: Math.round(worldMs), sites: st.sites, posts: st.posts, blades: st.blades, overhead: st.overhead, shields: st.shields, noSpot: st.noSpot, err: st.err };
})()
