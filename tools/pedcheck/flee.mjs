export default async ({ evaluate }) => {
  const out = {};
  out.flee = await evaluate(`(() => { const d = window.__dbg, P = d.player, city = d.city;
    d.game.paused = true;
    const res = [];
    for (const [sx, sz] of [[0, 0], [300, -100], [1500, -200], [-2601, -4885], [3993, 3378]]) {
      let best = null, bd = 1e12;
      for (const e of city.edgesNear(sx, sz, 400)) { const E = city.edges[e]; if (E.elev || E.cls === 'hwy' || E.cls === 'ramp') continue; const n = city.nodes[E.a]; const dd = (n.x - sx) ** 2 + (n.z - sz) ** 2; if (dd < bd) { bd = dd; best = n; } }
      for (const p of [...d.peds.peds]) d.peds.remove(p);
      P.vehicle = null; P.onFoot = true; P.x = best.x + 3; P.z = best.z + 3; P.y = city.groundAt(P.x, P.z, null);
      for (let i = 0; i < 80; i++) d.peds.spawn(P.x, P.z, false);
      const ps = d.peds.peds.filter((p) => Math.hypot(p.x - P.x, p.z - P.z) < 45);
      d.peds.scare(P.x, P.z, 60);
      const inB = (p) => { for (const b of city.buildingsNear(p.x, p.z, 6)) { const c = Math.cos(-b.rot), s = Math.sin(-b.rot); const dx = p.x - b.x, dz = p.z - b.z; const lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) < b.w / 2 && Math.abs(lz) < b.d / 2 && p.y < b.y + b.h - 0.5) return true; } return false; };
      const inW = (p) => { const wl = d.world.waterLevelAt(p.x, p.z); return wl !== null && p.y < wl - 0.2; };
      const everB = new Set(), everW = new Set(), everO = new Set();
      for (let i = 0; i < 20 * 6; i++) { d.peds.update(1 / 20, P.x, P.z, P, d.traffic); for (const p of ps) { if (inB(p)) everB.add(p); if (inW(p)) everW.add(p); if (city.obstacleHit(p.x, p.z, 0.3, p.y)) everO.add(p); } }
      res.push({ site: [sx, sz], scared: ps.length, throughBuilding: everB.size, inWater: everW.size, inTrunkOrPole: everO.size });
    }
    return res; })()`);
  return out;
};
