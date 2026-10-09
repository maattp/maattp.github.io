// Officers on foot walk through buildings too, on master: police.js footOrders steers them straight at the
// player and nothing between them tests a wall. Wanted level on, 10 officers walked in from 20-150 m round
// the player at each site for 40 sim-s (the car and the helicopters not simulated: only the walk), counting
// the officers seen inside a building footprint and how many reached the player.
// Accept: none inside a building.
export default async ({ evaluate }) => {
  return await evaluate(`(() => { const d = window.__dbg, P = d.player, city = d.city;
    d.game.paused = true;
    const res = [];
    const inB = (p) => { for (const b of city.buildingsNear(p.x, p.z, 6)) { const c = Math.cos(-b.rot), s = Math.sin(-b.rot); const dx = p.x - b.x, dz = p.z - b.z; const lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) < b.w / 2 && Math.abs(lz) < b.d / 2 && p.y < b.y + b.h - 0.5) return true; } return false; };
    for (const [sx, sz] of [[0, 0], [300, -100], [1500, -200], [-2601, -4885], [3993, 3378]]) {
      let best = null, bd = 1e12;
      for (const e of city.edgesNear(sx, sz, 400)) { const E = city.edges[e]; if (E.elev || E.cls === 'hwy' || E.cls === 'ramp') continue; const n = city.nodes[E.a]; const dd = (n.x - sx) ** 2 + (n.z - sz) ** 2; if (dd < bd) { bd = dd; best = n; } }
      for (const p of [...d.peds.peds]) d.peds.remove(p);
      P.vehicle = null; P.onFoot = true; P.x = best.x + 3; P.z = best.z + 3; P.y = city.groundAt(P.x, P.z, null);
      d.game.addHeat(400);
      const cops = []; for (let i = 0; i < 10; i++) { const c = d.peds.spawn(P.x, P.z, true); if (c) cops.push(c); }
      const ever = new Set(); let near = 0;
      for (let i = 0; i < 20 * 40; i++) {
        d.peds.update(1 / 20, P.x, P.z, P, d.traffic);
        for (const c of cops) if (inB(c)) ever.add(c);
      }
      for (const c of cops) if (d.peds.peds.includes(c) && Math.hypot(c.x - P.x, c.z - P.z) < 6) near++;
      res.push({ site: [sx, sz], cops: cops.length, insideABuilding: ever.size, reachedPlayer: near });
      d.game.wanted = 0; for (const c of cops) if (d.peds.peds.includes(c)) d.peds.remove(c);
    }
    return res; })()`);
};
