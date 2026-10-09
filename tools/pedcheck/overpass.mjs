// A person standing in the road UNDER a viaduct must not stop the cars ON it (traffic.js reads his level, crossXZ's third value):
// a fake crosser is published under each of 6 overpasses and the elevated cars within 45 m are timed.
// Accept: pedInRoadBelow longestHeldS no longer than control (17-88 s longer before the level test; site 896,2116 holds 50-64 s in both: a queue of its own).
export default async ({ evaluate }) => {
  return await evaluate(`(() => { const d = window.__dbg, P = d.player, city = d.city, G = d.G;
    d.game.paused = true;
    // find overpasses: an elevated edge's sample point with a ground street under it
    const found = [];
    for (let ei = 0; ei < city.edges.length && found.length < 40; ei++) {
      const e = city.edges[ei]; if (!e.elev || e.cls !== 'hwy' || e.tunnel) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      if (Math.abs(a.x) > 3000 || Math.abs(a.z) > 3000) continue;
      for (const t of [0.25, 0.5, 0.75]) {
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t, th = G.terrainHeight(x, z);
        if (y - th < 5) continue;
        for (const gi of city.edgesNear(x, z, 25)) { const g = city.edges[gi]; if (g.elev || g.tunnel || g.cls === 'hwy' || g.cls === 'ramp') continue;
          const ga = city.nodes[g.a], gb = city.nodes[g.b]; const vx = gb.x - ga.x, vz = gb.z - ga.z; const L2 = vx * vx + vz * vz || 1; const tt = Math.max(0, Math.min(1, ((x - ga.x) * vx + (z - ga.z) * vz) / L2));
          const dd = Math.hypot(ga.x + vx * tt - x, ga.z + vz * tt - z);
          if (dd < 3) { found.push({ x, z, y, th, ei, gi }); break; } }
      }
    }
    if (!found.length) return { err: 'none' };
    const out = [];
    for (const f of found.slice(0, 6)) {
      const res = {};
      for (const ctl of [true, false]) {
        for (const v of [...d.traffic.cars]) if (v.mode !== 'apron') d.traffic.remove(v);
        for (const p of [...d.peds.peds]) d.peds.remove(p);
        P.vehicle = null; P.onFoot = false; P.x = f.x + 60; P.z = f.z; P.y = f.th;
        d.world.update(f.x, f.z, 2);
        const xz = new Float32Array(48); xz[0] = f.x; xz[1] = f.z; xz[2] = f.th;
        let hiSlow = 0, hiN = 0, minHiSpeed = 99, heldHi = 0;
        const slowT = new Map();
        for (let i = 0; i < 20 * 100; i++) {
          d.traffic.update(1 / 20, P.x, P.z, { x: 0, z: -1 }, P);
          d.traffic.crossN = ctl ? 0 : 1; d.traffic.crossXZ = xz;
          if (i < 200 || i % 4) continue;
          for (const v of d.traffic.cars) { if (v.mode === 'parked' || v.mode === 'apron') continue; if (Math.hypot(v.x - f.x, v.z - f.z) > 45 || v.y - f.th < 5) continue;
            hiN++; if (Math.abs(v.vLong) < 2) { hiSlow++; slowT.set(v, (slowT.get(v) || 0) + 0.2); } else slowT.delete(v);
            if ((slowT.get(v) || 0) > 10) heldHi = Math.max(heldHi, slowT.get(v)); }
        }
        res[ctl ? 'control' : 'pedInRoadBelow'] = { elevCarSamplesNearby: hiN, slow: hiSlow, longestHeldS: +heldHi.toFixed(1) };
      }
      out.push({ at: [Math.round(f.x), Math.round(f.z)], deckAbove: +(f.y - f.th).toFixed(1), ...res });
    }
    d.traffic.crossN = 0;
    return out; })()`);
};
