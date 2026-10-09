// Walking peds for 90 sim-s at 10 random sites; counts those still on a junction path after 20 s (stalled: an unreachable
// waypoint, e.g. a dead end against a wall) and those of them in the road. Accept: stallCross 0.
export default async ({ evaluate }) => {
  const N = +process.env.NSITES || 10, T = +process.env.SECS || 90;
  return await evaluate(`(() => { const d = window.__dbg, P = d.player, city = d.city;
    d.game.paused = true;
    let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const out = { sites: 0, pedSecs: 0, stallPeds: 0, stallCross: 0, ex: [] };
    const centers = [];
    while (centers.length < ${N}) { const n = city.nodes[Math.floor(rnd() * city.nodes.length)]; if (Math.abs(n.x) > 5500 || Math.abs(n.z) > 5500) continue; if (n.e.length < 2) continue; centers.push(n); }
    for (const n of centers) {
      for (const p of [...d.peds.peds]) d.peds.remove(p);
      for (const v of [...d.traffic.cars]) if (v.mode !== 'apron') d.traffic.remove(v);
      P.vehicle = null; P.onFoot = false; P.x = n.x + 3; P.z = n.z + 3; P.y = city.groundAt(P.x, P.z, null);
      d.world.update(P.x, P.z, 2);
      const seen = new Set();
      for (let i = 0; i < 20 * ${T}; i++) {
        d.traffic.update(1 / 20, P.x, P.z, { x: 0, z: -1 }, P); d.peds.update(1 / 20, P.x, P.z, P, d.traffic);
        if (i % 10) continue;
        for (const p of d.peds.peds) {
          if (p.cop) continue; out.pedSecs += 0.5;
          if (p.pn > 0 && p.pt > 20 && !seen.has(p)) { seen.add(p); out.stallPeds++; if (p.cross) out.stallCross++; if (out.ex.length < 12) out.ex.push([Math.round(p.x), Math.round(p.z), +p.pt.toFixed(0), p.cross, p.pn, p.pi]); }
        }
      }
      out.sites++;
    }
    return out; })()`);
};
