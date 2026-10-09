// Where do pedestrians walk? 60 one-second snapshots at each of 7 sites, with the
// cars driving (traffic.update every step). A sample is "in a carriageway" when
// it is within an edge's half-width (less 0.3 m) of that edge's centreline;
// samples of a pedestrian that is crossing on purpose (p.cross, set while he walks
// a crossing leg of his junction path) are counted apart. Accept: < 8 % not crossing.
// baseline (master, v193): 37.4 % in a carriageway (29.2 % at junctions, 8.2 % mid-block)
export default async ({ evaluate }) => {
  const r = await evaluate(`(() => { const d = window.__dbg, P = d.player, city = d.city;
    d.game.paused = true;
    const tally = { samples: 0, inRoad: 0, crossing: 0, crossInRoad: 0, midBlock: 0, atNode: 0, waiting: 0 }; let ex = null;
    for (const [sx, sz] of [[0, 0], [300, -100], [1500, -200], [-2601, -4885], [3993, 3378], [-346, 182], [278, 1094]]) {
      let best = null, bd = 1e12;
      for (const e of city.edgesNear(sx, sz, 400)) { const E = city.edges[e]; if (E.elev || E.cls === 'hwy' || E.cls === 'ramp') continue; const n = city.nodes[E.a]; const dd = (n.x - sx) ** 2 + (n.z - sz) ** 2; if (dd < bd) { bd = dd; best = n; } }
      for (const p of [...d.peds.peds]) d.peds.remove(p);
      P.vehicle = null; P.onFoot = true; P.x = best.x + 3; P.z = best.z + 3; P.y = city.groundAt(P.x, P.z, null);
      const step = () => { d.traffic.update(1 / 20, P.x, P.z, { x: 0, z: -1 }, P); d.peds.update(1 / 20, P.x, P.z, P, d.traffic); };
      for (let i = 0; i < 100; i++) step();
      for (let k = 0; k < 60; k++) {   // 60 snapshots, 1 s apart
        for (let i = 0; i < 20; i++) step();
        for (const p of d.peds.peds) {
          if (p.cop || p.state === 'down') continue;
          tally.samples++;
          let inside = false, nearNode = false, midLane = false;
          for (const ei of city.edgesNear(p.x, p.z, 40)) { const E = city.edges[ei]; if (E.elev) continue; const a = city.nodes[E.a], b = city.nodes[E.b]; const vx = b.x - a.x, vz = b.z - a.z; const L2 = vx * vx + vz * vz || 1; let t = ((p.x - a.x) * vx + (p.z - a.z) * vz) / L2; const tc = Math.max(0, Math.min(1, t)); const dd = Math.hypot(a.x + vx * tc - p.x, a.z + vz * tc - p.z);
            if (dd < E.hw - 0.3) { inside = true; const L = Math.sqrt(L2); if (t * L < E.hw + 3 || (1 - t) * L < E.hw + 3) nearNode = true; else midLane = true; } }
          if (p.cross) { tally.crossing++; if (inside) tally.crossInRoad++; continue; }
          if (inside) { tally.inRoad++; if (nearNode) tally.atNode++; else if (midLane) tally.midBlock++; if (!ex && midLane && !nearNode) ex = [p.x, p.z, P.x, P.z, p.state, p.edge, p.pn]; }
        }
      }
    }
    const pct = (n) => +(100 * n / tally.samples).toFixed(1);
    return { tally, pctInRoad: pct(tally.inRoad), pctAtNode: pct(tally.atNode), pctMidBlock: pct(tally.midBlock), pctCrossing: pct(tally.crossing), pass: pct(tally.inRoad) < 8, ex }; })()`);
  return r;
};
