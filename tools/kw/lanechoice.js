// Auto KW: which lane city traffic turns from (traffic.js cityLaneDecide,
// bayRule; CLAUDE.md "Lane choice and left-turn bays"). Wraps
// traffic.routeAdvance to see every turn as it is made, then runs the
// junction fuzz probe (tools/kw/jcttraffic.js, fetched from the served tree,
// so its options -- VIEW_BOOT_JS='window.__jct = {...}' -- apply) and adds:
//
//   turns     left / right turns made at a junction from an approach of two
//             or more lanes its way (or with a left-turn bay)
//   wrong     ...from a lane that cannot make them: a left not from the
//             leftmost lane (from the bay, where the approach has one), a
//             right not from the kerb lane -- a turn across another lane
//   fromBay   lefts made from a left-turn bay
//   stats     traffic.stats: cityLaneChanges, turnsMissed, bayPlans,
//             courtesy (s), slipYields (s)
//
//   VIEW_BOOT_JS='window.__jct={seed:true}' VIEW_PROBE_FILE=tools/kw/lanechoice.js \
//     AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. node tools/kw/kwshots.mjs /tmp/x
//
// Runs on master too (no bays there: a left from the inner lane is right).
(async () => {
  const d = window.__dbg, T = d.traffic, c = d.city;
  const RT_F = 23, R_EI = 0, R_SG = 1, R_U = 3, R_UX = 6, R_UZ = 7;
  const lc = { turns: { L: 0, R: 0 }, wrong: { L: 0, R: 0 }, fromBay: 0, single: 0, log: [] };
  const lane = (ei, sign, u) => {
    const e = c.edges[ei];
    if (T.flow[ei] === 0) {
      T.laneLatU(ei, sign, 0.5);
      const L = e._tw2;
      if (!L) return [0, 1, false];
      const n = sign > 0 ? L.nP : L.nM, bay = !!(sign > 0 ? L.yP : L.yM);
      return [u < 0 ? (bay ? -1 : 0) : Math.min(n - 1, Math.floor(u * n)), n, bay];
    }
    T.laneLatU(ei, sign, 0.5);
    const n = T.lanes[ei * 3 + 2], iab = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
    return [sign > 0 ? iab : n - 1 - iab, n, false];
  };
  const jc = c.jc;
  const inBox = (e) => jc && jc.ctl[e.a] >= 0 && jc.ctl[e.a] === jc.ctl[e.b];
  const adv0 = T.routeAdvance.bind(T);
  T.routeAdvance = (v) => {
    const rt = v.rt;
    if (v.mode === 'traffic' && !v.unit && v.rtN >= 2 && !T.fwy[rt[R_EI]]) {
      const e = c.edges[rt[R_EI]], q = RT_F;
      const ni = rt[R_SG] > 0 ? e.b : e.a;
      // the turn: to the first entry out of a signal's box
      let k = 1;
      const ci = jc ? jc.ctl[ni] : -1, C = ci >= 0 ? jc.list[ci] : null;
      if (C && C.set) while (k < v.rtN && C.set.has(c.edges[rt[k * RT_F + R_EI]].a) && C.set.has(c.edges[rt[k * RT_F + R_EI]].b)) k++;
      if (k < v.rtN && !inBox(e) && c.nodes[ni].e.length >= 3) {
        const ux = rt[R_UX], uz = rt[R_UZ], nx = rt[k * RT_F + R_UX], nz = rt[k * RT_F + R_UZ];
        const cos = ux * nx + uz * nz;
        // (the straightest legal way on where the street bends at a junction
        // is the street: traffic.js turnAt)
        let straightest = false;
        if (cos > 0.25 && k === 1) {
          let best = -2;
          for (const k2 of c.nodes[ni].e) {
            if (k2 === rt[R_EI]) continue;
            const e2 = c.edges[k2], sg = e2.a === ni ? 1 : -1;
            if (!(T.flow[k2] === 0 || T.flow[k2] === sg) || e2.noTraffic) continue;
            best = Math.max(best, e2.dx * sg * ux + e2.dz * sg * uz);
          }
          straightest = cos >= best - 1e-6;
        }
        if (cos < 0.7 && !straightest) {
          const mv = ux * nz - uz * nx > 0 ? 'R' : 'L';
          const [i, n, bay] = lane(rt[R_EI], rt[R_SG], rt[R_U]);
          if (n >= 2 || bay) {
            lc.turns[mv]++;
            const ok = mv === 'R' ? i === n - 1 : bay ? i === -1 : i <= 0;
            if (mv === 'L' && i === -1) lc.fromBay++;
            if (!ok) {
              lc.wrong[mv]++;
              if (lc.log.length < 12) lc.log.push({ mv, lane: i, n, bay, at: [Math.round(v.x), Math.round(v.z)], ei: rt[R_EI] });
            }
          } else lc.single++;
        }
      }
    }
    return adv0(v);
  };
  const s0 = JSON.parse(JSON.stringify(T.stats));
  const src = await (await fetch('/tools/kw/jcttraffic.js')).text();
  const res = JSON.parse(await eval(src));
  const st = {};
  for (const k of ['cityLaneChanges', 'turnsMissed', 'bayPlans', 'courtesy', 'slipYields', 'cityMerges', 'leftYields', 'sigHolds']) st[k] = +((T.stats[k] || 0) - (s0[k] || 0)).toFixed(1);
  const jst = window.__junctions || {};
  return JSON.stringify({ lanes: lc, stats: st, bays: { approaches: jst.bayApproaches, edges: jst.bayEdges, km: jst.bayKm },
    sites: res.sites.map((s) => ({ name: s.name, hits: s.hits, crashes: s.crashes, stuck: s.stuck, recycled: s.recycled, kmh: s.kmh })),
    total: res.total, hitLog: res.hitLog, crashLog: res.crashLog }, null, 1);
})()
