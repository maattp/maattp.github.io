// Auto KW: the junction-control fuzz probe (junctions.js + traffic.js
// junctionStop): city traffic at signals, roundabouts and all-way stops.
//
//   VIEW_PROBE_FILE=tools/kw/jcttraffic.js AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     node tools/kw/kwshots.mjs /tmp/x
//   (options: VIEW_BOOT_JS='window.__jct = { warm: 20, measure: 180, sites:
//   [{ name, x, z }] }'; runs on master too, as a control -- the junction
//   numbers are then empty)
//
// The game paused, traffic.update stepped at a FIXED dt of 1/60 s with the
// player out of the picture (a stand-in far away), at each site in turn with
// the site as the spawn centre, so the population of 26 drives the streets
// round it. Per site and in total:
//   hits      AI-AI body overlaps (the rectangles), one per pair per second
//   crashes   game.onTrafficCrash calls (an impact over 6 m/s)
//   stuck     traffic cars under 0.5 m/s for 60 s (a red is under 45 s)
//   recycled  traffic.stats.stuckRecycled during the site (stuck out of sight)
//   commits   cars going on past a controlled junction's line, by what they
//             saw: signal G / Y / R (R only if it had passed the line when it
//             turned), stop signs after a full stop / without one, roundabout
//             entries clear / busy
//   island    car-frames with a body corner inside a roundabout's island
//   kmh       mean speed of traffic cars within 150 m of the site
//   stats     traffic.stats deltas: sigHolds, leftYields, rbYields, stopWaits
//             (seconds held), fullStops
(async () => {
  const d = window.__dbg, T = d.traffic, c = d.city, p = d.player, jc = c.jc;
  const cfg = Object.assign({ warm: 20, measure: 180 }, window.__jct || {});
  const sites = cfg.sites || [
    { name: 'sig-uptown-king', x: -2928, z: -560 },
    { name: 'sig-1644', x: -1644, z: -157 },
    { name: 'sig-west', x: -6728, z: -2057 },
    { name: 'rb-ira-needles', x: -6293, z: 3219 },
    { name: 'rb-3lane', x: -594, z: 2796 },
    { name: 'rb-5043', x: 5043, z: -4096 },
    { name: 'allway-28', x: -28, z: 399 },
    { name: 'allway-uptown', x: -3137, z: -1029 },
  ];
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
  // the islands: radius inside the truck apron (junctions.js meshIsland)
  const islands = jc ? jc.rings.map((R) => ({ x: R.x, z: R.z, r: R.r - R.hw - (R.cls === 'residential' || R.cls === 'unclassified' ? 2.6 : 3.2) })).filter((I) => I.r > 1.5) : [];
  const s0 = JSON.parse(JSON.stringify(T.stats));
  const dt = 1 / 60;
  const NOBODY = { vehicle: null, onFoot: false, x: 1e6, y: 0, z: 1e6, speed: 0, heading: 0 };
  const zero = () => ({ t: 0, hits: 0, crashes: 0, stuck: 0, recycled: 0, island: 0, cars: 0, kmh: [0, 0],
    commits: { G: 0, Y: 0, R: 0, leftArrow: 0, leftPermissive: 0, stopFull: 0, stopRolled: 0, rbClear: 0, rbBusy: 0, mini: 0 }, hitLog: [] });
  const tot = zero(), out = [];
  for (const site of sites) {
    for (const v of [...T.cars]) if (v.mode !== 'apron') T.remove(v);
    p.respawn(site.x, site.z);
    d.game.wanted = 0;
    const m = zero();
    m.name = site.name;
    const c0 = crashes, r0 = T.stats.stuckRecycled, pairs = new Map(), slow = new Map(), stuckSeen = new Set(), seen = new WeakSet();
    const lastGo = new WeakMap();
    let t = 0;
    const steps = (cfg.warm + cfg.measure) * 60;
    for (let i = 0; i < steps; i++) {
      const ang = t * 0.2;
      T.update(dt, site.x, site.z, { x: Math.sin(ang), z: Math.cos(ang) }, NOBODY);
      if (i % 10 === 0) d.world.update(site.x, site.z, 2);
      t += dt;
      const meas = t >= cfg.warm;
      const cars = T.cars.filter((v) => v.mode === 'traffic' || v.mode === 'trailer');
      for (const v of cars) {
        if (v.mode !== 'traffic') continue;
        // a commit: jcGo set this frame
        const g = v.jcGo != null ? v.jcGo : -1, was = lastGo.has(v) ? lastGo.get(v) : -1;
        if (g >= 0 && g !== was && meas && jc) {
          const C = jc.list[v.jcC];
          let A = null;
          if (C) for (const B of C.appr.values()) if (B.id === g) A = B;
          if (C && A) {
            if (C.k === 1) {
              const L = jc.light(C, A, v.jcMv);
              m.commits[L.s]++;
              if (v.jcMv === 'L') m.commits[L.prot ? 'leftArrow' : 'leftPermissive']++;
            }
            else if (C.k === 3) m.commits[jc.ringBusy(T, v, C, A, NOBODY) ? 'rbBusy' : 'rbClear']++;
            else if (C.k === 4) m.commits.mini++;
            else if (A.kind === 'stop') m.commits[v.jcStop === A.id ? 'stopFull' : 'stopRolled']++;
          }
        }
        lastGo.set(v, g);
      }
      if (!meas) continue;
      m.t += dt;
      for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
        const A = cars[a], B = cars[b];
        if (A.leader === B || B.leader === A || Math.abs(A.y - B.y) > 3) continue;
        const rr = A.radius + B.radius;
        if ((A.x - B.x) ** 2 + (A.z - B.z) ** 2 > rr * rr || !box(A, B)) continue;
        const key = A.id + ':' + B.id, last = pairs.get(key);
        pairs.set(key, t);
        if (last === undefined || t - last >= 1) {
          m.hits++;
          if (tot.hitLog.length < 16) tot.hitLog.push({ site: site.name, t: +t.toFixed(1), a: A.typeName, b: B.typeName, at: [Math.round(A.x), Math.round(A.z)],
            va: +A.vLong.toFixed(1), vb: +B.vLong.toFixed(1), hd: +(Math.acos(Math.max(-1, Math.min(1, A.forward.x * B.forward.x + A.forward.z * B.forward.z))) * 57.3).toFixed(0),
            jc: [A.jcC, B.jcC], ctl: jc ? [A.jcC >= 0 && jc.list[A.jcC] ? jc.list[A.jcC].k : 0, B.jcC >= 0 && jc.list[B.jcC] ? jc.list[B.jcC].k : 0] : null });
        }
      }
      for (const v of cars) {
        if (v.mode !== 'traffic') continue;
        if (!seen.has(v)) { seen.add(v); m.cars++; }
        const sl = Math.abs(v.vLong) < 0.5 ? (slow.get(v.id) || 0) + dt : 0;
        slow.set(v.id, sl);
        if (sl > 60 && !stuckSeen.has(v.id)) { stuckSeen.add(v.id); m.stuck++; }
        if ((v.x - site.x) ** 2 + (v.z - site.z) ** 2 < 150 * 150) { m.kmh[0] += Math.abs(v.vLong) * 3.6 * dt; m.kmh[1] += dt; }
        for (const I of islands) {
          const dx = v.x - I.x, dz = v.z - I.z;
          if (dx * dx + dz * dz > (I.r + 4) ** 2) continue;
          const f = v.forward;
          for (const [sl2, sw] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const qx = v.x + f.x * v.halfLen * sl2 + f.z * v.halfWid * sw, qz = v.z + f.z * v.halfLen * sl2 - f.x * v.halfWid * sw;
            if ((qx - I.x) ** 2 + (qz - I.z) ** 2 < I.r * I.r) { m.island++; break; }
          }
        }
      }
    }
    m.crashes = crashes - c0;
    m.recycled = T.stats.stuckRecycled - r0;
    for (const k of ['t', 'hits', 'crashes', 'stuck', 'recycled', 'island', 'cars']) tot[k] += m[k];
    for (const k of Object.keys(m.commits)) tot.commits[k] += m.commits[k];
    tot.kmh[0] += m.kmh[0]; tot.kmh[1] += m.kmh[1];
    out.push(m);
  }
  const fmt = (S) => ({ name: S.name, t: Math.round(S.t), hits: S.hits, crashes: S.crashes, stuck: S.stuck, recycled: S.recycled, island: S.island, cars: S.cars,
    kmh: Math.round(S.kmh[0] / (S.kmh[1] || 1)), commits: S.commits });
  const st = {};
  for (const k of ['sigHolds', 'leftYields', 'rbYields', 'stopWaits', 'fullStops', 'stuckRecycled', 'yielded']) st[k] = +((T.stats[k] || 0) - (s0[k] || 0)).toFixed(1);
  return JSON.stringify({ sites: out.map(fmt), total: fmt(Object.assign(tot, { name: 'total' })), stats: st, hitLog: tot.hitLog }, null, 1);
})()
