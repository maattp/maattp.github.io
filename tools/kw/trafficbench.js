// Auto KW: traffic.update's cost, and a hash of what it did, at fixed sites.
//
//   VIEW_PROBE_FILE=tools/kw/trafficbench.js AUTO_PHONE=1 AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     node tools/kw/kwshots.mjs /tmp/x
//   (options: VIEW_BOOT_JS='window.__tb = { warm: 300, steps: 1200, sites: [{ name, x, z }] }';
//   noApron / noParked: without the apron vehicles / the parked cars, to see
//   what they cost; trace / dump: see below)
//
// For a speed-up that must not change behaviour. The game paused; at each
// site the population is cleared (apron vehicles stay), the streamer is
// SETTLED round it (chunk builds are time-sliced, and a chunk registers the
// street furniture cars hit), traffic's kerb-slot cache is cleared, and every
// source of run-to-run difference is pinned: Math.random, traffic's own rng,
// the signals' clock, its spawn counter (`_prio`, hashed into a freeway
// spawn's type), the camera it culls by (a fixed one, not the chase camera),
// and the trains, streetcars and pedestrian crossings are off. Then
// traffic.update is stepped `warm` times at a fixed 1/60 s with a stand-in
// player (not on foot, no car) at the site, and `steps` more, timed. Parked
// and lot cars run too (the fuzz probes switch those off). Per site: ms per
// update and a HASH of every vehicle's position, heading and speed -- two
// builds that hash the same at every site drove the same cars the same way,
// to the last bit (master hashes the same run after run). AUTO_PHONE=1 runs
// the phone's paths (far LOD, half-rate AI). With kwshots' VIEW_THROTTLE=8
// the ms are the phone stand-in's, and VIEW_PROFILE=f.cpuprofile profiles it
// (tools/kw/profsub.mjs f.cpuprofile 'update src/traffic.js' --frames=9000).
// The machine's load moves the ms by +-20 %: compare builds one after
// another, and believe the profile's split more than the total.
(async () => {
  const d = window.__dbg, T = d.traffic, c = d.city;
  const cfg = Object.assign({ warm: 300, steps: 1200 }, window.__tb || {});
  const sites = cfg.sites || [
    { name: 'uptown-king', x: -2928, z: -560 },
    { name: 'sig-1644', x: -1644, z: -157 },
    { name: 'pkwy-fairway', x: 2800, z: 2480 },
    { name: '401-hespeler', x: 10950, z: 4250 },
    { name: 'allway-28', x: -28, z: 399 },
    { name: 'rb-3lane', x: -594, z: 2796 },
  ];
  const mk = (seed) => { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const seed = (k) => {
    const f = mk(99 + k);
    T.R = { f, n: () => f(), range: (a, b) => a + (b - a) * f(), int: (a, b) => Math.min(b, a + Math.floor(f() * (b - a + 1))), pick: (arr) => arr[Math.min(arr.length - 1, Math.floor(f() * arr.length))], chance: (p) => f() < p, sign: () => (f() < 0.5 ? -1 : 1) };
    Math.random = mk(12345 + k);
    if (c.jc) c.jc.t = 0;
    T.spawnTimer = 0; T._tick = 0; T.copTimer = 0; T.crossN = 0;
    T._prio = 100000 * (k + 1);   // (the spawn counter: hashed into a freeway spawn's type)
  };
  T.link = null; T.freight = null; T.streetcars = null;
  d.game.wanted = 0;
  const dt = 1 / 60;
  const hash = () => {
    let h = 0, k = 1;
    for (const v of T.cars) {
      h += k * (v.x * 1.31 + v.z * 0.77 + v.heading * 5.3 + v.vLong * 2.1 + (v.y || 0) * 0.13);
      k = (k * 1.618) % 7.1 + 0.3;
    }
    return h.toFixed(6) + ' n' + T.cars.length;
  };
  const out = [], cam0 = T.camera;
  for (const site of sites) {
    for (const v of [...T.cars]) if (v.mode !== 'apron' || cfg.noApron) T.remove(v);
    if (cfg.noParked) T.updateParked = () => {};
    T.parkedSlots.clear();
    const P = { vehicle: null, onFoot: false, x: site.x, y: 0, z: site.z, speed: 0, heading: 0 };
    // the streamer SETTLED round the site: chunk builds are time-sliced, and
    // a chunk's street furniture is what cars hit (city.obstacles), so a
    // half-built ring made two runs of one build differ
    const pend = () => [...d.world.chunks.values()].filter((q) => q.lod !== q.wantLod).length;
    for (let i = 0; i < 20000 && (i < 6 || pend() > 0); i++) {
      d.world.update(site.x, site.z, 2);
      if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0));
    }
    // (then the idle work: a mid chunk's trees are planted once nothing waits)
    for (let i = 0; i < 300; i++) {
      d.world.update(site.x, site.z, 2);
      if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0));
    }
    // ...and traffic's per-edge kerb slots and the lot scan worked out again
    // after it: both read what the chunks have registered (jumpClear, decks)
    T._kerb = null; T._lotKey = null;
    // and every random source seeded again HERE: the page's own frames ran
    // while the streamer settled (the yields), drawing on Math.random as
    // many times as the wall clock allowed
    seed(out.length);
    // a FIXED camera (traffic culls the far LOD and halves the off-screen
    // AI's rate against last frame's camera, and the game's chase camera
    // settles a little differently every boot): 25 m up, looking north-east
    const cam = new d.THREE.PerspectiveCamera(62, 874 / 402, 0.5, 4000);
    const gy = d.G.terrainHeight(site.x, site.z);
    cam.position.set(site.x - 40, gy + 25, site.z - 40);
    cam.lookAt(site.x + 60, gy, site.z + 60);
    cam.updateMatrixWorld(true);
    T.camera = cam;
    const step = (i) => { const ang = i * dt * 0.2; T.update(dt, site.x, site.z, { x: Math.sin(ang), z: Math.cos(ang) }, P); };
    // (cfg.trace: the hash every 10 updates, to find where two runs part;
    // cfg.dump = n: every car's state after update n)
    const trace = cfg.trace ? [] : null;
    const dump = (i) => { if (cfg.dump === i) out.dump = T.cars.map((v) => [v.typeName, v.mode, v.x, v.z, v.heading, v.vLong, v._still, v.edge]); };
    for (let i = 0; i < cfg.warm; i++) { step(i); dump(i); if (trace && i % 10 === 0) trace.push(hash()); }
    const t0 = performance.now();
    if (!trace) for (let i = 0; i < cfg.steps; i++) step(cfg.warm + i);
    else { for (let i = cfg.warm; i < cfg.warm + cfg.steps; i++) { step(i); dump(i); if (i % 10 === 0) trace.push(hash()); } out.trace = trace; }
    const ms = (performance.now() - t0) / cfg.steps;
    const byMode = {};
    for (const v of T.cars) byMode[v.mode] = (byMode[v.mode] || 0) + 1;
    out.push({ name: site.name, ms: +ms.toFixed(3), hash: hash(), byMode });
  }
  T.camera = cam0;
  return JSON.stringify({ sites: out, stats: T.stats, trace: out.trace, dump: out.dump }, null, 1);
})()
