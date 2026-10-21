// Auto KW: the country roads (src/rural.js) checked against what is drawn.
// Evaluated in the booted page by kwshots (VIEW_PROBE_FILE=tools/kw/ruralprobe.js):
//
//   AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/ruralprobe.js node tools/kw/kwshots.mjs /tmp/x
//
// 1. lift vs mesh: at points across rural roads near a few sites -- the
//    carriageway, shoulder, ditch, berm, crossings -- a ray straight down
//    against the chunk meshes, against terrain + city.roadLift (what a car,
//    a walker, a parked anything stands on). Reports the share within 4 cm and
//    the worst, by zone.
// 2. ride: groundAt along each sampled chain's right lane every 0.5 m; the
//    largest second difference (a kink a car feels) and the largest step.
// 3. stats: rural km, chains, pass-through nodes, lanes, field entrances.
(() => {
  const d = window.__dbg, city = d.city, G = d.G, THREE = d.THREE, W = d.world;
  const RU = city.rural;
  const sites = [[-9600, -8046], [-12229, -7663], [-12223, -3152], [6242, -13567], [-13500, -9000]];
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const out = { stats: RU.stats, zones: {}, ride: [] };
  const zone = (k, diff) => {
    const z = out.zones[k] || (out.zones[k] = { n: 0, ok: 0, worst: 0, at: null });
    z.n++;
    if (Math.abs(diff) < 0.04) z.ok++;
    return z;
  };
  for (const [sx, sz] of sites) {
    W.update(sx, sz, 60);
    for (let i = 0; i < 3000 && [...W.chunks.values()].some((c) => c.lod !== c.wantLod); i++) W.update(sx, sz, 60);
    const groups = [...W.chunks.values()].filter((c) => c.group && c.lod === 1).map((c) => c.group);
    // rural edges within 300 m
    const eds = city.edgesNear(sx, sz, 300).filter((ei) => city.edges[ei].rural);
    for (let q = 0; q < Math.min(60, eds.length); q++) {
      const ei = eds[Math.floor((q * 7919) % eds.length)], e = city.edges[ei], a = city.nodes[e.a];
      const s = e.len * (0.1 + 0.8 * ((q * 0.618) % 1));
      for (let m = -e.hw - 7.4; m <= e.hw + 7.4; m += 0.37) {
        const x = a.x + e.dx * s - e.dz * m, z = a.z + e.dz * s + e.dx * m;
        if (city.onRoad(x, z, 0, false) && Math.abs(m) > e.hw) continue;   // another road
        const want = G.terrainHeight(x, z) + city.roadLift(x, z);
        ray.set(new THREE.Vector3(x, want + 4, z), down);
        ray.far = 8;
        const hit = ray.intersectObjects(groups, true).find((h) => !h.object.isInstancedMesh && h.object.visible);
        if (!hit) continue;
        const am = Math.abs(m);
        const k = am <= e.hw ? 'carriageway' : am <= e.hw + 1.3 ? 'shoulder' : am <= e.hw + 3.9 ? 'ditch' : 'berm';
        const diff = hit.point.y - want;
        // something standing there (a pole, a post, a sign) is not the ground
        if (diff > 0.25) continue;
        const Z = zone(k, diff);
        if (Math.abs(diff) > Math.abs(Z.worst)) { Z.worst = +diff.toFixed(3); Z.at = [Math.round(x), Math.round(z), ei, +m.toFixed(1)]; }
        if (Math.abs(diff) >= 0.04 && window.__RURAL_FAILS) {
          const n = city.nodes;
          window.__RURAL_FAILS.push([k, +diff.toFixed(2), Math.round(x), Math.round(z), ei, +m.toFixed(1), +(s / e.len).toFixed(2),
            n[e.a].rpass ? 1 : 0, n[e.b].rpass ? 1 : 0, hit.object.material && hit.object.material.type, city.ruralRaise(e, s).toFixed(2)]);
        }
      }
    }
    // ride a chain from the site: the right lane, every 0.5 m
    const e0 = city.edges[eds[0]];
    if (!e0) continue;
    const C = city.ruralChain(e0);
    let prev = null, prev2 = null, worstK = 0, worstStep = 0, at = null;
    const P = (c) => {
      let lo = 0; while (lo + 1 < C.edges.length && C.cum[lo + 1] <= c) lo++;
      const ei = C.edges[lo], e = city.edges[ei], dir = C.dir[lo];
      const s = dir > 0 ? c - C.cum[lo] : e.len - (c - C.cum[lo]);
      const A = city.nodes[e.a];
      const off = e.hw * 0.48;
      return [A.x + e.dx * s - e.dz * dir * off, A.z + e.dz * s + e.dx * dir * off];
    };
    for (let c = 1; c < Math.min(C.len - 1, 1500); c += 0.5) {
      const [x, z] = P(c);
      const y = city.groundAt(x, z, prev === null ? null : prev + 0.5, city.roadLift(x, z));
      if (prev !== null) {
        if (Math.abs(y - prev) > worstStep) worstStep = Math.abs(y - prev);
        if (prev2 !== null) { const k = Math.abs(y - 2 * prev + prev2); if (k > worstK) { worstK = k; at = [Math.round(x), Math.round(z), +c.toFixed(1)]; } }
      }
      prev2 = prev; prev = y;
    }
    out.ride.push({ site: [sx, sz], chain: C.id, len: Math.round(C.len), gravel: C.gravel, worstKink: +worstK.toFixed(4), worstStep: +worstStep.toFixed(3), at });
  }
  for (const k in out.zones) { const z = out.zones[k]; z.okPct = +((100 * z.ok) / z.n).toFixed(1); }
  return out;
})()
