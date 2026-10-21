// Auto KW: the freeway traffic fuzz probe (traffic.js "freeway driving").
//
//   VIEW_PROBE_FILE=tools/kw/hwytraffic.js AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     node tools/kw/kwshots.mjs /tmp/x
//   (HWYT_WARM / HWYT_MEASURE seconds per site: set window.__hwyt = {...} in
//   VIEW_BOOT_JS, default 20 / 150)
//
// The game paused, traffic.update is stepped at a FIXED dt of 1/60 s (rAF in a
// headless page runs at whatever pace it likes, which is why speeds measured
// on the running game came out low) with the player out of the picture at
// each site. Spawning is held to freeway edges (and their ramps) so the whole
// population of 26 is freeway traffic. Per site and in total:
//   hits       AI-AI body overlaps (the rectangles, traffic.js boxOverlap's
//              test), one per pair per second -- must be 0
//   crashes    game.onTrafficCrash calls (an impact over 6 m/s)
//   stuck      traffic cars on a freeway edge under 0.5 m/s for 15 s
//   lanes      share of car-time in each lane, counted from the RIGHT, by the
//              carriageway's lane count (n2: [right, left], n3: ...), and the
//              same for semis
//   speed      mean speed / the edge's traffic speed (e.spd) on main
//              carriageways, all cars and free-flowing ones (no leader within
//              120 m), and km/h means
//   stats      traffic.stats: lane changes (left, right, mandatory), merge
//              yield seconds, exits planned / taken / aborted
(async () => {
  const d = window.__dbg, T = d.traffic, c = d.city, p = d.player;
  const cfg = Object.assign({ warm: 20, measure: 150 }, window.__hwyt || {});
  const sites = cfg.sites || [
    { name: '401-hespeler', x: 10950, z: 4250 },
    { name: '401-hwy8', x: 8000, z: 5400 },
    { name: 'pkwy-fairway', x: 2800, z: 2480 },
    { name: 'hwy8-king', x: 5300, z: 3900 },
    { name: 'pkwy-westmount', x: -2500, z: 3300 },
    { name: 'hwy85-bridgeport', x: -1500, z: -2800 },
  ];
  // (an older traffic.js without the freeway layer: the same mask and lanes here)
  if (!T.fwy) {
    const E = c.edges, F = T.fwy = new Uint8Array(E.length), q = [], seen = new Uint8Array(c.nodes.length);
    for (let i = 0; i < E.length; i++) if (E[i].cls === 'hwy') { F[i] = 1; q.push(E[i].a, E[i].b); }
    while (q.length) { const ni = q.pop(); if (seen[ni]) continue; seen[ni] = 1; for (const k of c.nodes[ni].e) if (E[k].cls === 'ramp' && !F[k]) { F[k] = 1; q.push(E[k].a, E[k].b); } }
  }
  if (!T.laneInfo) T.laneInfo = (ei) => { T.laneLatU(ei, 1, 0.5); const L = T.lanes, k = ei * 3; return { lo: L[k], n: L[k + 2], w: (L[k + 1] - L[k]) / L[k + 2] }; };
  // spawns held to freeway edges
  let only = false;
  const en = c.edgesNear.bind(c);
  c.edgesNear = (x, z, r, ...rest) => { const l = en(x, z, r, ...rest); return only ? l.filter((ei) => T.fwy[ei]) : l; };
  const st0 = T.spawnTraffic.bind(T);
  T.spawnTraffic = (...a) => { only = !cfg.all; try { return st0(...a); } finally { only = false; } };
  let crashes = 0;
  const oc = d.game.onTrafficCrash;
  d.game.onTrafficCrash = (...a) => { crashes++; if (oc) return oc.apply(d.game, a); };
  T.updateParked = () => {};
  const box = (a, b) => {
    const fa = a.forward, fb = b.forward, dx = b.x - a.x, dz = b.z - a.z;
    const ax = [fa.x, fa.z, fa.z, -fa.x, fb.x, fb.z, fb.z, -fb.x];
    for (let k = 0; k < 8; k += 2) {
      const ux = ax[k], uz = ax[k + 1];
      const ra = a.halfLen * Math.abs(fa.x * ux + fa.z * uz) + a.halfWid * Math.abs(fa.z * ux - fa.x * uz);
      const rb = b.halfLen * Math.abs(fb.x * ux + fb.z * uz) + b.halfWid * Math.abs(fb.z * ux - fb.x * uz);
      if (ra + rb - Math.abs(dx * ux + dz * uz) <= 0) return false;
    }
    return true;
  };
  const s0 = JSON.parse(JSON.stringify(T.stats));
  const out = { sites: [], total: null };
  const tot = { flat: 0, dbg: [], byType: {}, own: [0, 0], t: 0, hits: 0, crashes: 0, stuck: 0, lanes: {}, semiLanes: {}, spd: [0, 0], free: [0, 0], kmh: [0, 0], hitLog: [] };
  const dt = 1 / 60;
  for (const site of sites) {
    for (const v of [...T.cars]) if (v.mode !== 'apron') T.remove(v);
    p.respawn(site.x, site.z);
    p.onFoot = false; p.vehicle = null;
    d.game.wanted = 0;
    const m = { name: site.name, t: 0, hits: 0, crashes: 0, stuck: 0, lanes: {}, semiLanes: {}, spd: [0, 0], free: [0, 0], kmh: [0, 0], cars: 0 };
    const c0 = crashes, pairs = new Map(), slow = new Map(), stuckSeen = new Set(), seen = new WeakSet();
    let t = 0;
    const steps = (cfg.warm + cfg.measure) * 60;
    for (let i = 0; i < steps; i++) {
      const ang = t * 0.2;
      T.update(dt, site.x, site.z, { x: Math.sin(ang), z: Math.cos(ang) }, p);
      if (i % 10 === 0) d.world.update(site.x, site.z, 2);
      t += dt;
      if (t < cfg.warm) continue;
      m.t += dt;
      const cars = T.cars.filter((v) => v.mode === 'traffic' || v.mode === 'trailer');
      for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
        const A = cars[a], B = cars[b];
        if (A.leader === B || B.leader === A || Math.abs(A.y - B.y) > 3) continue;
        const rr = A.radius + B.radius;
        if ((A.x - B.x) ** 2 + (A.z - B.z) ** 2 > rr * rr || !box(A, B)) continue;
        const key = A.id + ':' + B.id, last = pairs.get(key);
        pairs.set(key, t);
        if (last === undefined || t - last >= 1) {
          m.hits++;
          if (tot.hitLog.length < 12) tot.hitLog.push({ site: site.name, t: +t.toFixed(1), a: A.typeName, b: B.typeName, at: [Math.round(A.x), Math.round(A.z)],
            ea: c.edges[(A.leader || A).edge] && c.edges[(A.leader || A).edge].cls, eb: c.edges[(B.leader || B).edge] && c.edges[(B.leader || B).edge].cls,
            va: +A.vLong.toFixed(1), vb: +B.vLong.toFixed(1), lc: [+(A.lcShift || 0).toFixed(2), +((B.leader || B).lcShift || 0).toFixed(2)],
            rel: (() => { const f = A.forward, dx = B.x - A.x, dz = B.z - A.z; return [+(dx * f.x + dz * f.z).toFixed(1), +(dx * f.z - dz * f.x).toFixed(1)]; })(),
            hd: +(Math.acos(Math.max(-1, Math.min(1, A.forward.x * B.forward.x + A.forward.z * B.forward.z))) * 57.3).toFixed(0),
            mode: [A.mode, B.mode], ex: [(A.leader || A).exitNode, (B.leader || B).exitNode] });
        }
      }
      for (const v of cars) {
        if (v.mode !== 'traffic') continue;
        if (!seen.has(v)) { seen.add(v); m.cars++; }
        const e = c.edges[v.edge];
        if (!e || !T.fwy[v.edge]) continue;
        const sl = Math.abs(v.vLong) < 0.5 ? (slow.get(v.id) || 0) + dt : 0;
        slow.set(v.id, sl);
        if (sl > 15 && !stuckSeen.has(v.id)) { stuckSeen.add(v.id); m.stuck++; }
        if (e.cls !== 'hwy' || !e.oneway || !v.rt) continue;
        const LI = T.laneInfo(v.edge);
        const i = Math.min(LI.n - 1, Math.floor(v.rt[3] * LI.n));
        const fromR = v.dirSign > 0 ? LI.n - 1 - i : i;
        const key = 'n' + LI.n;
        for (const L of [m.lanes, tot.lanes].concat(v.spec.hand === 'semi' ? [m.semiLanes, tot.semiLanes] : [])) {
          if (!L[key]) L[key] = new Array(LI.n).fill(0);
          L[key][fromR] += dt;
        }
        if (e.spd > 0) {
          for (const S of [m, tot]) { S.spd[0] += (v.vLong / e.spd) * dt; S.spd[1] += dt; S.kmh[0] += v.vLong * 3.6 * dt; S.kmh[1] += dt; }
          if (!(v.leadGap < 120)) {
            for (const S of [m, tot]) { S.free[0] += (v.vLong / e.spd) * dt; S.free[1] += dt; }
            // against the driver's OWN wanted speed (its pace x the route's limit)
            let w0 = v.rt[9] * v.drvK;
            if (v.spec.hand === 'semi') w0 = Math.min(w0, 29);
            const ty = tot.byType[v.typeName] || (tot.byType[v.typeName] = [0, 0]);
            ty[0] += (v.vLong / w0) * dt; ty[1] += dt;
            tot.own[0] += (v.vLong / w0) * dt; tot.own[1] += dt;
            if (v.aiIn && v.aiIn.throttle >= 0.99) tot.flat += dt;
            if (tot.dbg.length < 8 && Math.random() < 0.0005) tot.dbg.push({ ty: v.typeName, v: +v.vLong.toFixed(1), w0: +w0.toFixed(1), th: +(v.aiIn ? v.aiIn.throttle : -1).toFixed(2), br: +(v.aiIn ? v.aiIn.brake : -1).toFixed(2), gap: v.leadGap === Infinity ? 'inf' : Math.round(v.leadGap) });
          }
        }
      }
    }
    m.crashes = crashes - c0;
    tot.t += m.t; tot.hits += m.hits; tot.crashes += m.crashes; tot.stuck += m.stuck;
    out.sites.push(m);
  }
  const fmt = (S) => {
    const L = (o) => Object.fromEntries(Object.entries(o).map(([k, a]) => { const s = a.reduce((x, y) => x + y, 0) || 1; return [k, a.map((x) => +(x / s).toFixed(2))]; }));
    return { t: Math.round(S.t), hits: S.hits, crashes: S.crashes, stuck: S.stuck, cars: S.cars, lanes: L(S.lanes), semiLanes: L(S.semiLanes),
      speed: +(S.spd[0] / (S.spd[1] || 1)).toFixed(3), freeSpeed: +(S.free[0] / (S.free[1] || 1)).toFixed(3), kmh: Math.round(S.kmh[0] / (S.kmh[1] || 1)) };
  };
  const st = {};
  for (const k of Object.keys(T.stats)) st[k] = typeof T.stats[k] === 'number' ? +(T.stats[k] - (s0[k] || 0)).toFixed(1) : T.stats[k];
  const byType = Object.fromEntries(Object.entries(tot.byType).filter(([, a]) => a[1] > 5).map(([k, a]) => [k, +(a[0] / a[1]).toFixed(2)]));
  return JSON.stringify({ sites: out.sites.map((S) => Object.assign({ name: S.name }, fmt(S))), total: fmt(tot), freeOfOwn: +(tot.own[0] / (tot.own[1] || 1)).toFixed(3), flatOut: +(tot.flat / (tot.own[1] || 1)).toFixed(3), dbg: tot.dbg, byType, stats: st, hitLog: tot.hitLog }, null, 1);
})()
