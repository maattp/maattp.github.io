// Auto KW: do pedestrians obey the walk signals, and do drivers turn right on
// red? (peds.js at a signalled corner, junctions.js decide/rtorBusy)
//
//   VIEW_PROBE_FILE=tools/kw/pedsignal.js AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     node tools/kw/kwshots.mjs /tmp/x
//   (window.__pedsig = { warm: 15, measure: 150, sites: [{ name, x, z }] })
//
// The game paused, traffic.update and peds.update stepped at a fixed dt of
// 1/60 s round each site (a stand-in player on foot at the site, so the crowd
// fills round it). Every time a walker steps off the kerb (p.cross 0 -> 1)
// within 40 m of a signalled junction, what the pedestrian signal showed for
// his direction then -- worked out here from the phase, not from peds.js's own
// answer, so the probe runs on master as a control:
//   walk / flash / hand   starts on the walking person, the flashing hand, the hand
//   other                 starts at an unsignalled crossing
//   waitS                 mean seconds a walker stood at a signalled kerb before going
// and from traffic: rtor (right turns on red), crashes, hits (AI-AI overlaps
// as jcttraffic counts them, roughly: circles at 0.8 x radius).
(async () => {
  const d = window.__dbg, T = d.traffic, c = d.city, P = d.peds, jc = c.jc;
  const cfg = Object.assign({ warm: 15, measure: 150 }, window.__pedsig || {});
  const sites = cfg.sites || [
    { name: 'uptown-king-erb', x: -2928, z: -560 },
    { name: 'dtk-king-queen', x: -1644, z: -157 },
    { name: 'uptown-king-william', x: -3137, z: -1029 },
    { name: 'sig-west', x: -6728, z: -2057 },
  ];
  T.updateParked = () => {};
  let crashes = 0, meas = false;
  const oc = d.game.onTrafficCrash;
  d.game.onTrafficCrash = (...a) => { if (meas) crashes++; if (oc) return oc.apply(d.game, a); };
  const sigs = jc ? jc.list.filter((C) => C.k === 1) : [];
  const nearSig = (x, z) => {
    let best = null, bd = 40 * 40;
    for (const C of sigs) { const dd = (C.x - x) ** 2 + (C.z - z) ** 2; if (dd < bd) { bd = dd; best = C; } }
    return best;
  };
  // the walk state for walking (wx, wz) across C, from the phase alone
  const state = (C, wx, wz) => {
    const L = Math.hypot(wx, wz) || 1;
    let A = null, bd = -1;
    for (const B of C.approaches) { const dd = Math.abs(B.ux * wx + B.uz * wz) / L; if (dd > bd) { bd = dd; A = B; } }
    const pg = bd > 0.707 ? A.grp : 1 - A.grp;
    const { p, el } = jc.phase(C);
    let g = -2;
    if (p.k === 'grn') g = p.g; else if (p.k === 'ped') g = 1 - C.phases[0].g;
    if (g !== pg) return 'hand';
    return el < p.d * 0.55 ? 'walk' : 'flash';
  };
  const dt = 1 / 60;
  const tot = { walk: 0, flash: 0, hand: 0, other: 0, waitS: [0, 0], rtor: 0, crashes: 0 }, out = [];
  const s0 = JSON.parse(JSON.stringify(T.stats));
  for (const site of sites) {
    for (const v of [...T.cars]) if (v.mode !== 'apron') T.remove(v);
    for (const p of [...P.peds]) P.remove(p);
    d.player.respawn(site.x, site.z);
    const ME = { vehicle: null, onFoot: true, x: site.x, y: c.groundAt(site.x, site.z, null), z: site.z, speed: 0, heading: 0, h: null };
    const m = { name: site.name, walk: 0, flash: 0, hand: 0, other: 0, waitS: [0, 0], rtor0: T.stats.rtor || 0, c0: crashes };
    const was = new WeakMap(), waitAt = new WeakMap();
    let t = 0;
    for (let i = 0; i < (cfg.warm + cfg.measure) * 60; i++) {
      T.update(dt, site.x, site.z, { x: 0, z: 1 }, ME);
      P.update(dt, site.x, site.z, ME, T);
      if (i % 10 === 0) d.world.update(site.x, site.z, 2);
      t += dt;
      meas = t >= cfg.warm;
      for (const p of P.peds) {
        if (p.cop || !p.pn) { was.set(p, p.cross); continue; }
        const leg = (p.pcr >> p.pi) & 1;
        if (leg && !p.cross && p.speed < 0.3) waitAt.set(p, (waitAt.get(p) || 0) + dt);
        if (p.cross && !was.get(p) && meas) {
          const wx = p.path[p.pi * 2] - p.x, wz = p.path[p.pi * 2 + 1] - p.z;
          const C = nearSig(p.x, p.z);
          if (C) { const s = state(C, wx, wz); m[s]++; m.waitS[0] += waitAt.get(p) || 0; m.waitS[1]++; }
          else m.other++;
          waitAt.set(p, 0);
        }
        was.set(p, p.cross);
      }
    }
    m.rtor = (T.stats.rtor || 0) - m.rtor0; m.crashes = crashes - m.c0;
    for (const k of ['walk', 'flash', 'hand', 'other', 'rtor', 'crashes']) tot[k] += m[k];
    tot.waitS[0] += m.waitS[0]; tot.waitS[1] += m.waitS[1];
    m.waitS = +(m.waitS[0] / (m.waitS[1] || 1)).toFixed(1);
    delete m.rtor0; delete m.c0;
    out.push(m);
  }
  tot.waitS = +(tot.waitS[0] / (tot.waitS[1] || 1)).toFixed(1);
  const st = {};
  for (const k of ['sigHolds', 'rtor', 'stuckRecycled']) st[k] = +((T.stats[k] || 0) - (s0[k] || 0)).toFixed(1);
  return JSON.stringify({ sites: out, total: tot, stats: st }, null, 1);
})()
