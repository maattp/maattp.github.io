export default async ({ evaluate, shot }) => {
  const sites = process.env.SITES ? JSON.parse(process.env.SITES) : { downtown: [0, 0], pike: [300, -100], capitolhill: [1500, -200], ballard: [-2500, -5000], suburb: [4500, 3000] };
  const res = {};
  for (const [name, [sx, sz]] of Object.entries(sites)) {
    res[name] = await evaluate(`(() => { const d = window.__dbg, P = d.player, city = d.city, G = d.G;
      d.game.paused = true;
      // find nearest street node
      let best = null, bd = 1e12;
      for (const e of city.edgesNear(${sx}, ${sz}, 400)) { const E = city.edges[e]; if (E.elev || E.cls === 'hwy' || E.cls === 'ramp') continue; const n = city.nodes[E.a]; const dd = (n.x - ${sx}) ** 2 + (n.z - ${sz}) ** 2; if (dd < bd) { bd = dd; best = n; } }
      if (!best) return { err: 'no edge' };
      for (const p of [...d.peds.peds]) d.peds.remove(p);
      P.vehicle = null; P.onFoot = true; P.h.group.visible = true;
      P.x = best.x + 3; P.z = best.z + 3; P.y = city.groundAt(P.x, P.z, null);
      let fr = 0;
      for (let i = 0; i < 600; i++) { d.peds.update(1 / 20, P.x, P.z, P, d.traffic); }
      const ps = d.peds.peds.filter((p) => !p.cop);
      const within = (r) => ps.filter((p) => Math.hypot(p.x - P.x, p.z - P.z) < r).length;
      let inB = 0, inWater = 0, inRoad = 0, obst = 0, idle = 0;
      const detail = [];
      for (const p of ps) {
        if (p.speed < 0.3) idle++;
        const near = city.buildingsNear(p.x, p.z, 6);
        let hit = false;
        for (const b of near) { const c = Math.cos(-b.rot), s = Math.sin(-b.rot); const dx = p.x - b.x, dz = p.z - b.z; const lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) < b.w / 2 && Math.abs(lz) < b.d / 2 && p.y < b.y + b.h - 0.5) hit = true; }
        if (hit) inB++;
        const wl = d.world.waterLevelAt(p.x, p.z); if (wl !== null && p.y < wl - 0.2) inWater++;
        if (city.obstacleHit(p.x, p.z, 0.3, p.y)) obst++;
        let mind = 1e9, hw = 0;
        for (const ei of city.edgesNear(p.x, p.z, 30)) { const E = city.edges[ei]; if (E.elev) continue; const a = city.nodes[E.a], b = city.nodes[E.b]; const vx = b.x - a.x, vz = b.z - a.z; const L2 = vx * vx + vz * vz || 1; let t = ((p.x - a.x) * vx + (p.z - a.z) * vz) / L2; t = Math.max(0, Math.min(1, t)); const dd = Math.hypot(a.x + vx * t - p.x, a.z + vz * t - p.z) - E.hw; if (dd < mind) { mind = dd; } }
        if (mind < -0.2) inRoad++;
        detail.push([+(p.x - P.x).toFixed(0), +(p.z - P.z).toFixed(0), +p.speed.toFixed(2), +mind.toFixed(1), hit ? 'B' : '', p.state].join(','));
      }
      let pairs = 0; for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z) < 0.5) pairs++;
      return { at: [Math.round(P.x), Math.round(P.z)], total: ps.length, w15_30_50_100: [within(15), within(30), within(50), within(100)], idle, inB, inWater, inRoad, obst, pairs, detail: detail.slice(0, 6) }; })()`);
  }
  return res;
};
