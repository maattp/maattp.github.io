// Distances from each save garage to the respray bays, counter doors, Tims doors and J&J (interaction QA).
(() => { const d = window.__dbg, o = [];
  const G = d.garages.sites.map((q) => ({ x: q.s.ox, z: q.s.oz }));
  const R = d.respray.sites.map((q) => ({ n: q.shop.name, x: q.s.ox, z: q.s.oz }));
  for (const g of G) {
    for (const r of R) o.push(`${r.n}: ${Math.hypot(g.x - r.x, g.z - r.z).toFixed(0)} m`);
    for (const c of d.counter.doors) { const e = Math.hypot(g.x - c.x, g.z - c.z); if (e < 25) o.push(`counter ${c.name} ${e.toFixed(0)}`); }
    for (const s of d.rollup.stores()) { const e = Math.hypot(g.x - (s.door ? s.door.x : s.x), g.z - (s.door ? s.door.z : s.z)); if (e < 25) o.push('tims ' + e.toFixed(0)); }
    if (d.jj.door) o.push('jj ' + Math.hypot(g.x - d.jj.door[0], g.z - d.jj.door[1]).toFixed(0));
    o.push('--');
  }
  return o.join('\n'); })()
