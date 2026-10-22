// Auto KW: the left-turn sweep (junctions.js leftClash, traffic.js's
// gridlock rule; CLAUDE.md "Opposing lefts and the gridlock rule"). City
// traffic at MANY signals, with heavy left-turn demand, looking for two cars
// in one box that meet.
//
//   VIEW_PROBE_FILE=tools/kw/leftsweep.js AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     node tools/kw/kwshots.mjs /tmp/x
//   (options: VIEW_BOOT_JS='window.__ls = { warm: 8, measure: 40, pL: 0.6,
//   offset: 0, limit: 0, every: 1, only: ['sig-558b'], sites: [{ name, x, z }] }'; runs on master
//   too, as a control)
//
// The sites: every signal with an approach that has a left-turn lane or bay
// (A.left), and every SKEWED one (two approaches of one phase group that are
// not head-on: their directions' dot product between -0.3 and -0.94, or the
// two groups' axes more than 25 deg off square). Each is run alone, as
// tools/kw/jcttraffic.js does (game paused, fixed dt 1/60, the site as the
// spawn centre, every random source seeded), with pickNextEdge wrapped so
// that at a signal a traffic car turns LEFT with probability pL (the exit
// nearest 90 deg to its left; inside a divided road's box it goes on toward
// that heading). Reported, per site with anything and in total:
//   hits       AI-AI body overlaps (rectangles), one per pair per second
//   crashes    game.onTrafficCrash calls (over 6 m/s)
//   near       two cars inside one signal's box, from different approaches,
//              their bodies within 0.4 m of each other (a near miss)
//   lefts      left turns committed at the sites (permissive / protected)
//   stuck      traffic under 0.5 m/s for 60 s; recycled: stuckRecycled
//   log        the first hits / near misses: where, what each car was doing
//   recLog     the cars recycled as stuck, and what each waited on
(async () => {
  const d = window.__dbg, T = d.traffic, c = d.city, p = d.player, jc = c.jc;
  const cfg = Object.assign({ warm: 8, measure: 40, pL: 0.6, offset: 0, limit: 0, every: 1 }, window.__ls || {});
  const mk = (s) => { let a = s >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const seedAll = (k) => {
    const f = mk(99 + k);
    T.R = { f, n: () => f(), range: (a, b) => a + (b - a) * f(), int: (a, b) => Math.min(b, a + Math.floor(f() * (b - a + 1))), pick: (arr) => arr[Math.min(arr.length - 1, Math.floor(f() * arr.length))], chance: (q) => f() < q, sign: () => (f() < 0.5 ? -1 : 1) };
    Math.random = mk(12345 + k);
    if (jc) jc.t = 0;
    T.spawnTimer = 0; T._tick = 0; T.copTimer = 0; T.crossN = 0; T._prio = 100000; T.link = null; T.freight = null; T.streetcars = null;
  };
  T.updateParked = () => {};
  // --- the sites ---------------------------------------------------------------
  let sites = cfg.sites;
  if (!sites) {
    sites = [];
    for (const C of jc.list) {
      if (C.k !== 1 || !C.approaches) continue;
      const ap = C.approaches;
      const bay = ap.some((A) => A.left);
      let skew = false;
      for (const A of ap) for (const B of ap) {
        if (A === B) continue;
        const dt = A.ux * B.ux + A.uz * B.uz;
        if (A.grp === B.grp && dt < -0.3 && dt > -0.94) skew = true;
        if (A.grp !== B.grp && Math.abs(dt) > 0.42 && Math.abs(dt) < 0.9) skew = true;
      }
      if (bay || skew) sites.push({ name: 'sig-' + C.id + (bay ? 'b' : '') + (skew ? 's' : ''), x: Math.round(C.x), z: Math.round(C.z), C: C.id });
    }
  }
  const all = sites.length;
  sites.forEach((s, i) => { s.i = i; });   // (its seed: a site runs the same alone as in the sweep)
  sites = sites.filter((s, i) => i >= cfg.offset && (i - cfg.offset) % cfg.every === 0 && (!cfg.only || cfg.only.includes(s.name)));
  if (cfg.limit) sites = sites.slice(0, cfg.limit);
  // --- heavy left demand ---------------------------------------------------------
  let active = false, rnd = mk(7);
  const pick0 = T.pickNextEdge.bind(T);
  T.pickNextEdge = (v, fromEi, fromSign, nodeId) => {
    const r = pick0(v, fromEi, fromSign, nodeId);
    if (!active || v.mode !== 'traffic' || v.unit || !jc) return r;
    const ci = jc.ctl[nodeId];
    if (ci < 0 || jc.list[ci].k !== 1) return r;
    const C = jc.list[ci], fe = c.edges[fromEi];
    const inside = C.set && C.set.has(fe.a) && C.set.has(fe.b);
    let tx, tz;
    if (inside) {
      if (v.__lsC !== C.id) return r;
      tx = v.__lsX; tz = v.__lsZ;
    } else {
      v.__lsC = -1;
      if (rnd() >= cfg.pL) return r;
      const fx = fe.dx * fromSign, fz = fe.dz * fromSign;
      tx = fz; tz = -fx;   // its left (traffic.js moveAt: cross < 0 is 'L')
    }
    const comp = T.comp[nodeId];
    let best = null, bd = 0.3;
    for (const ei of c.nodes[nodeId].e) {
      if (ei === fromEi) continue;
      const ne = c.edges[ei];
      if (ne.noTraffic || T.fwy[ei]) continue;
      const sign = ne.a === nodeId ? 1 : -1;
      if (!T.allowed(ei, sign) || T.comp[sign > 0 ? ne.b : ne.a] !== comp) continue;
      const dd = ne.dx * sign * tx + ne.dz * sign * tz;
      if (dd > bd) { bd = dd; best = { ei, sign }; }
    }
    if (!best) return r;
    v.__lsC = C.id; v.__lsX = tx; v.__lsZ = tz;
    return best;
  };
  // --- measuring -------------------------------------------------------------------
  let crashes = 0, measuring = false;
  const oc = d.game.onTrafficCrash;
  d.game.onTrafficCrash = (...a) => { if (measuring) crashes++; if (oc) return oc.apply(d.game, a); };
  const ids = new WeakMap();
  let nid = 0;
  const idOf = (v) => { let k = ids.get(v); if (k === undefined) { k = ++nid; ids.set(v, k); } return k; };
  const box = (a, b, pad) => {
    const fa = a.forward, fb = b.forward, dx = b.x - a.x, dz = b.z - a.z;
    const ax = [fa.x, fa.z, fa.z, -fa.x, fb.x, fb.z, fb.z, -fb.x];
    for (let k = 0; k < 8; k += 2) {
      const ux = ax[k], uz = ax[k + 1];
      const ra = (a.halfLen + pad) * Math.abs(fa.x * ux + fa.z * uz) + (a.halfWid + pad) * Math.abs(fa.z * ux - fa.x * uz);
      const rb = b.halfLen * Math.abs(fb.x * ux + fb.z * uz) + b.halfWid * Math.abs(fb.z * ux - fb.x * uz);
      if (ra + rb - Math.abs(dx * ux + dz * uz) <= 0) return false;
    }
    return true;
  };
  const apOf = (v) => {
    const C = v.jcC >= 0 ? jc.list[v.jcC] : null;
    if (!C || !(v.jcGo >= 0)) return null;
    for (const A of C.approaches || []) if (A.id === v.jcGo) return A;
    return null;
  };
  // why a car was recycled as stuck (stuckT: wanting to go and not moving;
  // restT: standing) -- a deadlock the gridlock rule did not break shows here
  const recLog = [];
  const rm0 = T.remove.bind(T);
  let siteName = '';
  T.remove = (v) => {
    if (measuring && v.mode === 'traffic' && (v.stuckT > 8 || v.restT > 20) && recLog.length < 30) {
      recLog.push({ site: siteName, at: [Math.round(v.x), Math.round(v.z)], ty: v.typeName, stuckT: +(v.stuckT || 0).toFixed(1), restT: +(v.restT || 0).toFixed(1),
        hold: !!v.ctlHold, jc: v.jcC, go: v.jcGo, mv: v.jcMv, prio: v.prio, lead: v.lead ? [v.lead.prio, v.lead.typeName, Math.round(v.leadGap), +v.lead.vLong.toFixed(1), v.lead.lead ? v.lead.lead.prio : null] : null });
    }
    return rm0(v);
  };
  const desc = (v) => ({ ty: v.typeName, v: +v.vLong.toFixed(1), hd: Math.round(Math.atan2(v.forward.x, -v.forward.z) * 57.3), jc: v.jcC, go: v.jcGo, mv: v.jcMv, prio: v.prio, lead: v.lead ? v.lead.prio : null });
  const dt = 1 / 60;
  const NOBODY = { vehicle: null, onFoot: false, x: 1e6, y: 0, z: 1e6, speed: 0, heading: 0 };
  const tot = { sites: 0, t: 0, hits: 0, crashes: 0, near: 0, stuck: 0, recycled: 0, lefts: { perm: 0, prot: 0 }, leftYields: 0 };
  const bad = [], log = [];
  const st0 = Object.assign({}, T.stats);
  const t0 = performance.now();
  for (let si = 0; si < sites.length; si++) {
    const site = sites[si];
    siteName = site.name;
    for (const v of [...T.cars]) if (v.mode !== 'apron') T.remove(v);
    seedAll(site.i);
    rnd = mk(7 + site.i);
    p.respawn(site.x, site.z);
    d.game.wanted = 0;
    const m = { name: site.name, at: [site.x, site.z], hits: 0, crashes: 0, near: 0, stuck: 0, recycled: 0, lefts: { perm: 0, prot: 0 } };
    const c0 = crashes, r0 = T.stats.stuckRecycled, y0 = T.stats.leftYields || 0;
    const pairs = new Map(), nears = new Map(), slow = new Map(), stuckSeen = new Set(), lastGo = new WeakMap();
    let t = 0;
    active = true;
    const steps = (cfg.warm + cfg.measure) * 60;
    for (let i = 0; i < steps; i++) {
      const ang = t * 0.2;
      T.update(dt, site.x, site.z, { x: Math.sin(ang), z: Math.cos(ang) }, NOBODY);
      if (i % 10 === 0) d.world.update(site.x, site.z, 2);
      t += dt;
      measuring = t >= cfg.warm;
      const cars = T.cars.filter((v) => v.mode === 'traffic' || v.mode === 'trailer');
      for (const v of cars) {
        if (v.mode !== 'traffic') continue;
        const g = v.jcGo != null ? v.jcGo : -1, was = lastGo.has(v) ? lastGo.get(v) : -1;
        if (measuring && g >= 0 && g !== was && v.jcMv === 'L') {
          const C = jc.list[v.jcC], A = apOf(v);
          if (C && A && C.k === 1) m.lefts[jc.light(C, A, 'L').prot ? 'prot' : 'perm']++;
        }
        lastGo.set(v, g);
      }
      if (!measuring) continue;
      for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
        const A = cars[a], B = cars[b];
        if (A.leader === B || B.leader === A || Math.abs(A.y - B.y) > 3) continue;
        const rr = A.radius + B.radius + 0.6;
        if ((A.x - B.x) ** 2 + (A.z - B.z) ** 2 > rr * rr) continue;
        const key = idOf(A) + ':' + idOf(B);
        if (box(A, B, 0)) {
          const last = pairs.get(key);
          pairs.set(key, t);
          if (last === undefined || t - last >= 1) {
            m.hits++;
            if (log.length < 30) log.push({ k: 'hit', site: site.name, t: +t.toFixed(1), at: [Math.round(A.x), Math.round(A.z)], a: desc(A), b: desc(B) });
          }
          continue;
        }
        // a near miss: both committed into one signal's box from different
        // approaches, within 0.4 m of each other
        if (A.jcC !== B.jcC || A.jcC < 0 || !(A.jcGo >= 0) || !(B.jcGo >= 0) || A.jcGo === B.jcGo) continue;
        const C = jc.list[A.jcC];
        if (!C || C.k !== 1) continue;
        const R2 = (C.r + 1) ** 2;
        if ((A.x - C.x) ** 2 + (A.z - C.z) ** 2 > R2 || (B.x - C.x) ** 2 + (B.z - C.z) ** 2 > R2) continue;
        if (!box(A, B, 0.4) || nears.has(key)) continue;
        nears.set(key, t);
        m.near++;
        if (log.length < 30) log.push({ k: 'near', site: site.name, t: +t.toFixed(1), at: [Math.round(A.x), Math.round(A.z)], a: desc(A), b: desc(B) });
      }
      for (const v of cars) {
        if (v.mode !== 'traffic') continue;
        const vid = idOf(v), sl = Math.abs(v.vLong) < 0.5 ? (slow.get(vid) || 0) + dt : 0;
        slow.set(vid, sl);
        if (sl > 60 && !stuckSeen.has(vid)) { stuckSeen.add(vid); m.stuck++; }
      }
    }
    active = false; measuring = false;
    m.crashes = crashes - c0;
    m.recycled = T.stats.stuckRecycled - r0;
    tot.sites++; tot.t += cfg.measure;
    for (const k of ['hits', 'crashes', 'near', 'stuck', 'recycled']) tot[k] += m[k];
    tot.lefts.perm += m.lefts.perm; tot.lefts.prot += m.lefts.prot;
    tot.leftYields += (T.stats.leftYields || 0) - y0;
    if (m.hits || m.crashes || m.near || m.stuck) bad.push(m);
  }
  tot.leftYields = +tot.leftYields.toFixed(1);
  // traffic.stats over the sweep (s): lefts held for another left's way
  // (leftClash), older cars that found a younger one's body in the way
  // under the gridlock rule (gridBlocked), younger ones that made way
  for (const k of ['leftClash', 'gridBlocked', 'gridMadeWay', 'gridBackOut']) tot[k] = +((T.stats[k] || 0) - (st0[k] || 0)).toFixed(1);
  return JSON.stringify({ candidates: all, ran: sites.length, wallS: Math.round((performance.now() - t0) / 1000), total: tot, bad, log, recLog }, null, 1);
})()
