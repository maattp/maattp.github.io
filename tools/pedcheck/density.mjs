// Is the street you stand on alive? Stand on a street at Pike Place, Westlake and
// Pioneer Square (and a quiet suburb as a control), run 30 sim-s of traffic and
// pedestrians, and count the civilians within 15 / 30 / 40 / 60 m. Accept: >= 6
// within 40 m at the three busy sites, the total never above the cap (24).
// baseline (master, v193): Pike Place 1, Westlake 2, Pioneer Sq 0 within 40 m.
export default async ({ evaluate }) => {
  const sites = { pikeplace: [-346, 182], westlake: [68, 4], pioneer: [278, 1094], downtown: [0, 0], pike_st: [300, -100], suburb: [4500, 3000] };
  const res = {};
  for (const [name, [sx, sz]] of Object.entries(sites)) {
    res[name] = await evaluate(`(() => { const d = window.__dbg, P = d.player, city = d.city;
      d.game.paused = true;
      let best = null, bd = 1e12;
      for (const e of city.edgesNear(${sx}, ${sz}, 400)) { const E = city.edges[e]; if (E.elev || E.cls === 'hwy' || E.cls === 'ramp') continue; const n = city.nodes[E.a]; const dd = (n.x - ${sx}) ** 2 + (n.z - ${sz}) ** 2; if (dd < bd) { bd = dd; best = n; } }
      for (const p of [...d.peds.peds]) d.peds.remove(p);
      P.vehicle = null; P.onFoot = true; P.x = best.x + 3; P.z = best.z + 3; P.y = city.groundAt(P.x, P.z, null);
      d.world.update(P.x, P.z, 2);
      let maxTotal = 0;
      for (let i = 0; i < 600; i++) { d.traffic.update(1 / 20, P.x, P.z, { x: 0, z: -1 }, P); d.peds.update(1 / 20, P.x, P.z, P, d.traffic); maxTotal = Math.max(maxTotal, d.peds.peds.filter((p) => !p.cop).length); }
      const ps = d.peds.peds.filter((p) => !p.cop);
      const dist = ps.map((p) => Math.hypot(p.x - P.x, p.z - P.z)).sort((a, b) => a - b);
      const within = (r) => dist.filter((x) => x < r).length;
      return { total: ps.length, maxTotal, w15_30_40_60: [within(15), within(30), within(40), within(60)], nearest: dist.slice(0, 4).map((x) => +x.toFixed(0)), open: ps.filter((p) => p.edge < 0).length, idle: ps.filter((p) => p.speed < 0.2).length, cars: d.traffic.cars.length }; })()`);
    const r = res[name];
    r.pass = r.maxTotal <= 24 && (name === 'suburb' || name === 'downtown' || name === 'pike_st' || r.w15_30_40_60[2] >= 6);
  }
  return res;
};
