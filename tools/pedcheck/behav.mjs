// Live traffic and pedestrians together for 120 sim-s at three sites, the
// player on foot among them. Counts the pedestrians AI cars knocked down
// (game.onPedHit with the player's vehicle absent), the pedestrians that
// walked a crossing, and the cars that sat still for over 15 s (traffic cars
// whose restT passed 15: a car held by a person in the road for a whole
// crossing is ~10 s, a queue behind a wedge is longer) -- the A/B for "the cars
// stop for people but never jam the street".
// baseline (master, v193, 40 sim-s): AI knockdowns 5 / 1 / 3 at the three sites.
export default async ({ evaluate }) => {
  const SECS = +process.env.SECS || 120;
  const out = {};
  out.traffic = await evaluate(`(() => { const d = window.__dbg, P = d.player, city = d.city;
    d.game.paused = true;
    const res = [];
    for (const [sx, sz] of [[0, 0], [300, -100], [1500, -200]]) {
      let best = null, bd = 1e12;
      for (const e of city.edgesNear(sx, sz, 400)) { const E = city.edges[e]; if (E.elev || E.cls === 'hwy' || E.cls === 'ramp') continue; const n = city.nodes[E.a]; const dd = (n.x - sx) ** 2 + (n.z - sz) ** 2; if (dd < bd) { bd = dd; best = n; } }
      for (const p of [...d.peds.peds]) d.peds.remove(p);
      P.vehicle = null; P.onFoot = true; P.x = best.x + 3; P.z = best.z + 3; P.y = city.groundAt(P.x, P.z, null);
      let hit = 0, byAI = 0; const orig = d.game.onPedHit; d.game.onPedHit = (b, p) => { hit++; if (!b) byAI++; };
      const crossed = new Set(), still = new Set(); let crossSteps = 0, maxCross = 0;
      for (let i = 0; i < 20 * ${SECS}; i++) {
        d.traffic.update(1 / 20, P.x, P.z, { x: 0, z: -1 }, P); d.peds.update(1 / 20, P.x, P.z, P, d.traffic);
        let c = 0; for (const p of d.peds.peds) if (p.cross) { crossed.add(p); c++; }
        crossSteps += c; maxCross = Math.max(maxCross, c);
        if (i % 20 === 0) for (const v of d.traffic.cars) if (v.mode === 'traffic' && v.restT > 15) still.add(v);
      }
      d.game.onPedHit = orig;
      res.push({ site: [sx, sz], ai_cars: d.traffic.cars.filter((c) => c.mode !== 'parked').length, knockdowns: hit, byAI, peds: d.peds.peds.length,
        crossedPeds: crossed.size, crossSecs: +(crossSteps / 20).toFixed(0), maxAtOnce: maxCross, carsStill15s: still.size, pass: byAI === 0 });
    }
    return res; })()`);
  return out;
};
