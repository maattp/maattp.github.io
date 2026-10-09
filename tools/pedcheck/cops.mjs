// Foot officers: seconds until BUSTED at five sites (STARS=, SECS=), minD, and samples where an officer walked but did not move.
// Officers now respect walls and slide along them, so a bust takes longer where a building lies between them and you
// (master 18-27 s at Pike St / Pioneer Sq against about twice that before the slide); watch stuckSamples.
export default async ({ evaluate }) => {
  const SECS = +process.env.SECS || 70, STARS = +process.env.STARS || 1;
  return await evaluate(`(() => { const d = window.__dbg, P = d.player, city = d.city, g = d.game;
    g.paused = true;
    const res = [];
    for (const [sx, sz] of [[0, 0], [300, -100], [1500, -200], [-346, 182], [278, 1094]]) {
      let best = null, bd = 1e12;
      for (const e of city.edgesNear(sx, sz, 400)) { const E = city.edges[e]; if (E.elev || E.cls === 'hwy' || E.cls === 'ramp') continue; const n = city.nodes[E.a]; const dd = (n.x - sx) ** 2 + (n.z - sz) ** 2; if (dd < bd) { bd = dd; best = n; } }
      for (const p of [...d.peds.peds]) d.peds.remove(p);
      for (const v of [...d.traffic.cars]) if (v.mode !== 'apron') d.traffic.remove(v);
      g.dead = false; g.points = 0; g.wanted = 0; g.cool = 0; if (g.police) g.police.clear();
      P.vehicle = null; P.onFoot = true;
      const E = city.edges[best.e.find((k) => { const q = city.edges[k]; return !q.elev && q.cls !== 'hwy' && q.cls !== 'ramp' && q.len > 22; }) ?? best.e[0]]; const atA = city.nodes[E.a] === best; const ux = atA ? E.dx : -E.dx, uz = atA ? E.dz : -E.dz;
      P.x = best.x + ux * 18 - uz * (E.hw + 1.4); P.z = best.z + uz * 18 + ux * (E.hw + 1.4); P.y = city.groundAt(P.x, P.z, null);
      d.world.update(P.x, P.z, 2);
      for (let i = 0; i < 60; i++) { d.traffic.update(1 / 20, P.x, P.z, { x: 0, z: -1 }, P); d.peds.update(1 / 20, P.x, P.z, P, d.traffic); }
      g.setWanted(${STARS});
      let bustAt = null, maxCops = 0, wl = g.wanted; const orig = g.onBusted; g.onBusted = () => { if (bustAt === null) bustAt = t / 20; };
      let t = 0; let minD = 1e9; const cops = new Set(); let stuckSamples = 0, copSamples = 0;
      const lastPos = new Map();
      for (; t < 20 * ${SECS}; t++) {
        d.traffic.update(1 / 20, P.x, P.z, { x: 0, z: -1 }, P); d.peds.update(1 / 20, P.x, P.z, P, d.traffic);
        g.police.update(1 / 20, P, false);
        if (bustAt !== null || g.dead) break;
        let c = 0; for (const p of d.peds.peds) if (p.cop) { c++; cops.add(p); const dd = Math.hypot(p.x - P.x, p.z - P.z); if (dd < minD) minD = dd;
          if (t % 20 === 0) { const lp = lastPos.get(p); if (lp && dd > 3 && Math.hypot(p.x - lp[0], p.z - lp[1]) < 1.0 && p.speed > 0.5 && !g.police.searching) stuckSamples++; if (dd > 3) copSamples++; lastPos.set(p, [p.x, p.z]); } }
        if (c > maxCops) maxCops = c;
      }
      g.onBusted = orig;
      res.push({ site: [sx, sz], wanted: wl, dead: g.dead, bustAtS: bustAt, totalCops: cops.size, maxCops, minD: +minD.toFixed(1), stuckSamples, copSamples });
    }
    return res; })()`);
};
