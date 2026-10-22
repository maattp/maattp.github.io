// Auto KW: the G2 / G road test (g2test.js), driven by a kinematic stand-in.
//
//   VIEW_PROBE_FILE=tools/kw/g2probe.js AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     node tools/kw/kwshots.mjs /tmp/x                  -> PASS / FAIL and the numbers
//   window.__g2p = { only: 'clean,roll,...', seed, kind: 'G2' | 'G' } (VIEW_BOOT_JS) narrows it
//
// The game paused (kwshots), traffic cleared, the test's own update() stepped
// at 1/30 s with a stand-in player in a real Vehicle that this script moves:
// pure pursuit along the lane it means to be in (traffic.laneLatU), corners
// filleted, speed under the posted limit, stopped at stop lines and at red
// lights (the signals' clock is stepped with it), the stalk on before each
// turn, every task done as asked. Then:
//   clean / cleanG  the whole test from the lot and back: must PASS, 0 marks;
//   one scenario per mark and per fail, each a short drive on a street of the
//   right kind round the centre (or the game's own hook, for the school bus,
//   a crash and a pedestrian), which must give exactly that mark (or fail).
(async () => {
  const d = window.__dbg, g2 = d.g2, T = d.traffic, c = d.city, E = c.edges, N = c.nodes, jc = c.jc;
  const cfg = Object.assign({ only: null, seed: 11 }, window.__g2p || {});
  const want = (k) => !cfg.only || cfg.only.split(',').includes(k);
  const dt = 1 / 30;
  const CEN = { x: 3614, z: -418 };
  g2.noSheet = true;
  await g2.loadLimits();
  for (const v of [...T.cars]) if (v.mode !== 'parked') T.remove(v);
  d.game.wanted = 0;
  const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
  const car = T.spawnAt(3592, -446, 0, 'compsedan', 0xe9ecef, 'free');
  const P = { vehicle: car, onFoot: false, sig: 0, sigOn: 0, exitVehicle() {}, enterVehicle() {}, get position() { return { x: car.x, y: car.y, z: car.z }; } };
  const results = [];
  const TRACE = [];
  const DBG = {};
  if (cfg.debug) {
    const am = g2.addMark.bind(g2), ft = g2.failTest.bind(g2);
    const snap = (k) => {
      const s = DBG.line ? nearestOn(DBG.line) : -1;
      TRACE.push(['DBG', k, Math.round(simT), Math.round(car.x), Math.round(car.z), +D.v.toFixed(2), P.sig, +P.sigOn.toFixed(1), g2.run && g2.run.sigLast,
        +s.toFixed(1), (DBG.turns || []).filter((t) => Math.abs(t.s - s) < 120).map((t) => [+t.s.toFixed(0), t.dir]),
        (DBG.ctl || []).filter((q) => Math.abs(q.s - s) < 120).map((q) => [q.kind, +q.s.toFixed(0), q.move, q.node, q.C.phases ? jc.light(q.C, q.A, 'L').s + jc.light(q.C, q.A, 'S').s + jc.light(q.C, q.A, 'R').s : '-', q.done])]);
    };
    g2.addMark = (k, x) => { snap(k); return am(k, x); };
    g2.failTest = (k, x) => { snap('FAIL ' + k); return ft(k, x); };
  }
  let simT = 0;

  // --- the road ------------------------------------------------------------
  const endOf = (ei, sg) => (sg > 0 ? E[ei].b : E[ei].a);
  const startOf = (ei, sg) => (sg > 0 ? E[ei].a : E[ei].b);
  /** Straight on from (ei, sg) for `len` m: [{ ei, sg }] (the straightest allowed way at each node). */
  function chainAhead(ei, sg, len, opt = {}) {
    const out = [{ ei, sg }];
    let run = E[ei].len;
    for (let g = 0; g < 200 && run < len; g++) {
      const n = endOf(ei, sg), ux = E[ei].dx * sg, uz = E[ei].dz * sg;
      let best = -1, bs = 0, bd = opt.minDot !== undefined ? opt.minDot : 0.5;
      for (const k of N[n].e) {
        if (k === ei) continue;
        const f = E[k], s2 = f.a === n ? 1 : -1;
        if (!opt.any && !T.allowed(k, s2)) continue;
        if (f.cls === 'hwy' && !opt.hwy && E[ei].cls !== 'hwy' && E[ei].cls !== 'ramp') continue;
        const dd = f.dx * s2 * ux + f.dz * s2 * uz;
        if (dd > bd) { bd = dd; best = k; bs = s2; }
      }
      if (best < 0) break;
      ei = best; sg = bs; out.push({ ei, sg }); run += E[ei].len;
    }
    return out;
  }
  /** `len` m back up the way into (ei, sg)'s start, straightest: [{ ei, sg }] ending with (ei, sg). */
  function chainBack(ei, sg, len) {
    const out = [{ ei, sg }];
    let run = E[ei].len;
    for (let g = 0; g < 200 && run < len; g++) {
      const n = startOf(ei, sg), ux = E[ei].dx * sg, uz = E[ei].dz * sg;
      let best = -1, bs = 0, bd = 0.95;
      for (const k of N[n].e) {
        if (k === ei) continue;
        const f = E[k], s2 = f.b === n ? 1 : -1;     // arriving at n
        if (!T.allowed(k, s2) || f.elev || f.tunnel) continue;
        const dd = f.dx * s2 * ux + f.dz * s2 * uz;
        if (dd > bd) { bd = dd; best = k; bs = s2; }
      }
      if (best < 0) break;
      ei = best; sg = bs; out.unshift({ ei, sg }); run += E[ei].len;
    }
    return out;
  }
  // (lane 0 / lane n-1 are the two ends; which is the kerb's depends on the way)
  const kerbLane = (ei, sg) => Math.max(T.laneLatU(ei, sg, 0), T.laneLatU(ei, sg, 0.999));
  const innerLane = (ei, sg) => Math.min(T.laneLatU(ei, sg, 0), T.laneLatU(ei, sg, 0.999));

  /** The lane line through `list`, offset by off(ei, sg, k) m right, corners filleted: points { x, z, s, cap, k }. */
  function laneLine(list, off, head) {
    const S = list.map(({ ei, sg }, k) => {
      const e = E[ei], A = N[startOf(ei, sg)], B = N[endOf(ei, sg)], ux = e.dx * sg, uz = e.dz * sg, o = off(ei, sg, k);
      return { ax: A.x - uz * o, az: A.z + ux * o, bx: B.x - uz * o, bz: B.z + ux * o, ux, uz, k, n: endOf(ei, sg), o, ei };
    });
    const raw = [];
    if (head) raw.push({ x: head.x, z: head.z, k: 0 });
    raw.push({ x: S[0].ax, z: S[0].az, k: 0 });
    for (let k = 0; k < S.length - 1; k++) {
      const a = S[k], b = S[k + 1];
      const cr = a.ux * b.uz - a.uz * b.ux;
      let x, z;
      if (Math.abs(cr) < 0.08) { x = (a.bx + b.ax) / 2; z = (a.bz + b.az) / 2; }
      else {
        const t = ((b.ax - a.bx) * b.uz - (b.az - a.bz) * b.ux) / cr;
        x = a.bx + a.ux * t; z = a.bz + a.uz * t;
      }
      raw.push({ x, z, k: k + 1, node: a.n });
    }
    const L = S[S.length - 1];
    raw.push({ x: L.bx, z: L.bz, k: S.length - 1, node: L.n });
    // fillet
    const pts = [raw[0]];
    for (let i = 1; i < raw.length - 1; i++) {
      const p0 = raw[i - 1], p1 = raw[i], p2 = raw[i + 1];
      const l1 = Math.hypot(p1.x - p0.x, p1.z - p0.z), l2 = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      if (l1 < 0.05 || l2 < 0.05) continue;
      const u1 = [(p1.x - p0.x) / l1, (p1.z - p0.z) / l1], u2 = [(p2.x - p1.x) / l2, (p2.z - p1.z) / l2];
      const th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
      if (th < 0.06) { pts.push(p1); continue; }
      // (a right turn hugs its kerb corner tighter: the cut is toward the kerb)
      const rgt = u1[0] * u2[1] - u1[1] * u2[0] > 0;
      let r = th > 0.35 ? (rgt ? 4.5 : 7.5) : 60, cc = r * Math.tan(th / 2);
      const cm = 0.45 * Math.min(l1, l2);
      if (cc > cm) { cc = cm; r = cc / Math.tan(th / 2); }
      const ia = { x: p1.x - u1[0] * cc, z: p1.z - u1[1] * cc }, ob = { x: p1.x + u2[0] * cc, z: p1.z + u2[1] * cc };
      const cap = th > 0.35 ? Math.sqrt(2.4 * Math.max(2, r)) : 0;
      for (let q = 0; q <= 6; q++) {
        const t = q / 6, w0 = (1 - t) * (1 - t), w1 = 2 * t * (1 - t), w2 = t * t;
        pts.push({ x: w0 * ia.x + w1 * p1.x + w2 * ob.x, z: w0 * ia.z + w1 * p1.z + w2 * ob.z, k: t < 0.5 ? Math.max(0, p1.k - 1) : p1.k, cap, node: q === 3 ? p1.node : undefined });
      }
    }
    pts.push(raw[raw.length - 1]);
    let s = 0;
    for (let i = 0; i < pts.length; i++) { if (i) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); pts[i].s = s; }
    pts.list = list; pts.S = S;
    return pts;
  }

  // --- the driver ----------------------------------------------------------
  const D = { line: null, i: 0, v: 0, stopUntil: 0, hold: 0 };
  function place(x, z, h) {
    car.x = x; car.z = z; car.heading = h; car.vLong = 0; car.vLat = 0;
    car.y = c.groundAt(x, z, null);
    D.v = 0; D.i = 0;
  }
  /** The car's arc position on the line: projected onto its segments near the last one. */
  function nearestOn(line) {
    let bi = D.i, bd = Infinity, bs = line[Math.min(D.i, line.length - 1)].s;
    for (let i = Math.max(0, D.i - 5); i < Math.min(line.length - 1, D.i + 60); i++) {
      const a = line[i], b = line[i + 1], sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz || 1e-9;
      const t = Math.max(0, Math.min(1, ((car.x - a.x) * sx + (car.z - a.z) * sz) / l2));
      const dd = (a.x + sx * t - car.x) ** 2 + (a.z + sz * t - car.z) ** 2;
      if (dd < bd) { bd = dd; bi = i; bs = a.s + (b.s - a.s) * t; }
    }
    D.i = bi;
    return bs;
  }
  function pointAt(line, s) {
    let i = D.i;
    while (i < line.length - 1 && line[i + 1].s < s) i++;
    const a = line[i], b = line[Math.min(line.length - 1, i + 1)], l = b.s - a.s || 1, t = Math.max(0, Math.min(1, (s - a.s) / l));
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }
  /** Cap speed for corners ahead on the line, and a stop at `stopS` (or none). */
  function vWant(line, s, vmax, stopS) {
    let w = vmax;
    for (let i = D.i; i < line.length && line[i].s < s + 80; i++) if (line[i].cap) w = Math.min(w, Math.sqrt(line[i].cap ** 2 + 2 * 2.2 * Math.max(0, line[i].s - s)));
    if (stopS !== null && stopS !== undefined) w = Math.min(w, Math.sqrt(2 * 2.6 * Math.max(0, stopS - s)));
    return w;
  }
  /** One step of pure pursuit at speed toward vt (vt < 0: reversing straight back). */
  function drive(line, vt) {
    const a = vt > D.v ? 2.2 : 3.4;
    D.v += Math.max(-a * dt, Math.min(a * dt, vt - D.v));
    if (Math.abs(D.v) < 0.02 && Math.abs(vt) < 0.02) D.v = 0;
    if (line) {
      const s = nearestOn(line), Ld = Math.max(5, Math.abs(D.v) * 1.1);
      const tp = pointAt(line, s + Ld);
      const want = Math.atan2(tp.x - car.x, tp.z - car.z);
      const al = wrap(want - car.heading);
      let k = 2 * Math.sin(al) / Ld;
      k = Math.max(-1 / 4.2, Math.min(1 / 4.2, k));
      car.heading += k * D.v * dt;
    }
    move();
  }
  function move() {
    car.x += Math.sin(car.heading) * D.v * dt;
    car.z += Math.cos(car.heading) * D.v * dt;
    car.vLong = D.v;
    car.y = c.groundAt(car.x, car.z, car.y + 1.2);
  }
  /** The game's frame, for the parts that matter: the signals' clock and the test. */
  function frame() {
    if (jc) jc.update(dt);
    if (P.sig) P.sigOn += dt; else P.sigOn = 0;
    g2.update(dt, P);
    simT += dt;
    if (cfg.traceLc && g2.run && g2.run.task && g2.run.task.k === 'lc' && Math.floor(simT * 2) !== Math.floor((simT - dt) * 2)) {
      const cu = g2.run.cur;
      TRACE.push(['lc', +simT.toFixed(1), g2.run.task.want, cu && +cu.lat.toFixed(2), cu && E[cu.ei].cls, cu && T.laneInfo(cu.ei).n, cu && +T.laneInfo(cu.ei).w.toFixed(2), cu && +kerbLane(cu.ei, cu.sign).toFixed(2), P.sig, +P.sigOn.toFixed(1), cu && +g2.junctionGap(cu).toFixed(0)]);
    }
    if (cfg.trace && g2.run && (!cfg.traceFrom || (simT > cfg.traceFrom && simT < cfg.traceTo)) && Math.floor(simT / cfg.trace) !== Math.floor((simT - dt) / cfg.trace)) {
      const run = g2.run, cu = run.cur;
      TRACE.push([Math.round(simT), Math.round(car.x), Math.round(car.z), +D.v.toFixed(1), +car.heading.toFixed(2), cu && cu.ei, cu && cu.sign, cu && +cu.lat.toFixed(2), cu && +kerbLane(cu.ei, cu.sign).toFixed(2), cu && +E[cu.ei].hw.toFixed(1), run.instr, P.sig]);
    }
  }
  const setSig = (s) => { if (P.sig !== s) { P.sig = s; P.sigOn = 0; } };

  // the junction controls along a line: [{ s (the car's centre at the line, nose 0.6 m short), C, A, move }]
  function controlsOn(line) {
    const out = [];
    const S = line.S;
    let s0 = line[0].s;
    for (const p of line) {
      if (p.node === undefined) continue;
      const k = p.k, seg = S[Math.min(S.length - 1, k)];
      // the segment arriving at this node
      const inSeg = S.find((q) => q.n === p.node) || seg;
      const ci = jc ? jc.ctl[p.node] : -1;
      if (ci < 0) continue;
      const C = jc.list[ci], ei = line.list[inSeg.k].ei;
      const A = C.appr && C.appr.get(ei * 2 + (E[ei].b === p.node ? 1 : 0));
      if (!A) continue;
      const nx = S[inSeg.k + 1];
      let move = 'S';
      if (nx) { const cr = inSeg.ux * nx.uz - inSeg.uz * nx.ux, dd = inSeg.ux * nx.ux + inSeg.uz * nx.uz; if (dd < 0.77) move = cr > 0 ? 'R' : 'L'; }
      // the line's own point, projected onto the lane (arc length on an offset
      // lane is not the centreline's: a bend in the approach moves it metres)
      const Lp = A.at(0);
      let sl = p.s - A.back, bd = Infinity;
      for (let i = 0; i < line.length - 1; i++) {
        const a0 = line[i], b0 = line[i + 1], sx = b0.x - a0.x, sz = b0.z - a0.z, l2 = sx * sx + sz * sz || 1e-9;
        if (a0.s > p.s + 5 || b0.s < p.s - A.back - 60) continue;
        const t = Math.max(0, Math.min(1, ((Lp.x - a0.x) * sx + (Lp.z - a0.z) * sz) / l2));
        const dd = (a0.x + sx * t - Lp.x) ** 2 + (a0.z + sz * t - Lp.z) ** 2;
        if (dd < bd) { bd = dd; sl = a0.s + (b0.s - a0.s) * t; }
      }
      out.push({ s: sl - car.halfLen - 1.2, C, A, move, kind: C.k === 1 ? 'sig' : A.kind, node: p.node, ps: p.s });
    }
    void s0;
    return out;
  }
  // turns along a line (for the stalk): [{ s, dir }]
  function turnsOn(line) {
    const out = [], S = line.S;
    let pi = 0;
    for (let k = 0; k < S.length - 1; k++) {
      const a = S[k], n = a.n;
      if (N[n].e.length < 3) {
        const b1 = S[k + 1];
        if (Math.abs((b1.o || 0) - (a.o || 0)) >= 2.5) {
          while (pi < line.length && line[pi].node !== n) pi++;
          if (line[pi]) out.push({ s: line[pi].s, dir: b1.o > a.o ? 1 : -1, merge: true });
          else pi = 0;
        }
        continue;
      }
      // the way out 20 m on (a junction can be two nodes and a short edge)
      let j = k + 1, run = 0;
      while (j < S.length - 1 && run + E[line.list[j].ei].len < 20 && N[S[j].n].e.length >= 3) { run += E[line.list[j].ei].len; j++; }
      // (whichever turns more: the next edge, or the way 20 m on)
      const b1 = S[k + 1], b2 = S[j];
      const b = a.ux * b1.ux + a.uz * b1.uz < a.ux * b2.ux + a.uz * b2.uz ? b1 : b2;
      const dd = a.ux * b.ux + a.uz * b.uz, cr = a.ux * b.uz - a.uz * b.ux;
      const ea = E[line.list[k].ei], eb = E[line.list[k + 1].ei];
      let dir = 0;
      if (ea.cls === 'hwy' && eb.cls === 'ramp') dir = 1;
      else if (ea.cls === 'ramp' && eb.cls === 'hwy') dir = -1;
      else if (dd < Math.cos(40 * Math.PI / 180) && ea.cls !== 'hwy') dir = cr > 0 ? 1 : -1;
      // (a lane that ends: the lane moves over a lane's width -- signal it as a lane change)
      if (!dir && Math.abs((b1.o || 0) - (a.o || 0)) >= 2.5) dir = b1.o > a.o ? 1 : -1;
      if (!dir) continue;
      // (the next point at this node after the last turn: a route can pass a node twice)
      while (pi < line.length && line[pi].node !== n) pi++;
      const p = line[pi];
      if (p) out.push({ s: p.s, dir, merge: ea.cls === 'ramp' });
      else pi = 0;
    }
    return out;
  }

  /** Drive a line to its end (or `until()`), law-abiding unless told: opts { vmax(s, e), noStop, noSig, ignoreLights, offTask }. */
  function follow(line, opts = {}) {
    const ctl = opts.noCtl ? [] : controlsOn(line), turns = turnsOn(line);
    DBG.ctl = ctl; DBG.turns = turns; DBG.line = line;
    const done = new Set();
    let waitT = 0;
    const end = line[line.length - 1].s;
    for (let it = 0; it < 30 * 400; it++) {
      const s = nearestOn(line);
      if (it > 0 && (s > end - (opts.endPad || 2) || (opts.until && opts.until()))) return true;
      if (it > 0 && it % 3000 === 0 && opts.wallCut && opts.wallCut()) return false;
      // the stalk: on 70 m before a turn, off 12 m after
      if (!opts.noSig) {
        let sg = 0;
        for (const t of turns) if (s > t.s - (t.merge ? 140 : 70) && s < t.s + 12) sg = t.dir;
        const K = g2.run && g2.run.task;
        if (opts.laneTask && K && K.k === 'lc') sg = K.want === 'L' ? -1 : 1;
        if (opts.sig !== undefined) sg = opts.sig;
        setSig(sg);
      }
      // the next control's stop
      let stopS = null;
      for (const q of ctl) {
        if (done.has(q) || s > q.s + 3.6 || (q.kind !== 'stop' && q.kind !== 'sig')) continue;
        if (q.kind === 'stop') {
          if (opts.noStop) break;
          stopS = q.s;
          if (s > q.s - 0.6 && D.v < 0.05) { waitT += dt; if (waitT > 1.2) { done.add(q); waitT = 0; stopS = null; if (cfg.trace) TRACE.push(['stopped', Math.round(simT), +s.toFixed(1), +q.s.toFixed(1), +q.ps.toFixed(1), q.node, Math.round(car.x), Math.round(car.z), +q.A.back.toFixed(1)]); } }
          break;
        }
        if (q.kind === 'sig') {
          if (opts.ignoreLights) break;
          const L = jc.light(q.C, q.A, q.move).s;
          // an amber: on through only if there is no stopping comfortably (the examiner's own rule)
          const brake = D.v * D.v / 6 + D.v * 0.8 + 1 - 1.2;
          // (judged until the nose is over the line: a green can still change)
          if (L === 'Y' && q.yd === undefined) q.yd = q.s - s < brake;   // decided once, at the amber's first sight
          if (L !== 'Y') q.yd = undefined;
          if (L === 'G' || (L === 'Y' && q.yd)) { if (s > q.s + car.halfLen * 0 + 2.4) done.add(q); break; }
          stopS = q.s;
          break;
        }
        break;
      }
      if (cfg.debug) for (const q of ctl) if (q.kind === 'sig' && q._ps !== undefined && q._ps < q.s + 1.2 && s >= q.s + 1.2) TRACE.push(['xsig', +simT.toFixed(1), q.node, q.move, jc.light(q.C, q.A, q.move).s, q.yd, stopS, done.has(q), +s.toFixed(1), +q.s.toFixed(1)]);
      for (const q of ctl) q._ps = s;
      const e = E[line.list[Math.min(line.list.length - 1, line[D.i].k)].ei];
      const lim = (g2.limitOf(line.list[Math.min(line.list.length - 1, line[D.i].k)].ei) || 60) / 3.6;
      let vm = opts.vmax ? opts.vmax(s, e, lim) : lim - 2.2;
      drive(line, vWant(line, s, vm, stopS));
      frame();
      if (opts.each) opts.each(s);
      if (!g2.run) return false;
    }
    return false;
  }

  // --- the clean runs ------------------------------------------------------
  /** The whole test, by the book. */
  function cleanRun(kind, seed) {
    place(3592, -446, Math.atan2(3592 - 3603, -446 + 431));
    g2.begin(kind, { player: P, noCar: true, seed });
    const simT0 = simT;
    const R = g2.run;
    const wps = R.wps.map((w) => ({ task: w.task, x: Math.round(N[w.n].x), z: Math.round(N[w.n].z) }));
    // out of the lot: straight onto the nearest street, its kerb lane
    let best = null, bd = Infinity;
    for (const ei of c.roadsNear(3592, -446, 120)) {
      const e = E[ei];
      if (!(e.cls === 'art' || e.cls === 'st') || e.elev) continue;
      const a = N[e.a], t = Math.max(0, Math.min(1, ((3592 - a.x) * e.dx + (-446 - a.z) * e.dz) / e.len));
      const dd = Math.hypot(a.x + e.dx * e.len * t - 3592, a.z + e.dz * e.len * t + 446);
      if (dd < bd) { bd = dd; best = ei; }
    }
    const sg = T.allowed(best, 1) ? 1 : -1;
    let line = laneLine(chainAhead(best, sg, 250), kerbLane, { x: car.x, z: car.z });
    let built = '', stuck = 0, lastPv = -1;
    let tasks = [];
    const wall = performance.now();
    let cut = null;
    for (let it = 0; it < 30 * 1500 && g2.run; it++) {
      const run = g2.run, K = run.task;
      if (performance.now() - wall > (cfg.wall || 150000) || simT - simT0 > (kind === 'G' ? 2400 : 1500)) {
        cut = { simT: Math.round(simT - simT0), wi: run.wi, task: K && K.k + ':' + K.ph, cur: run.cur && [run.cur.ei, run.cur.sign, Math.round(run.cur.s)], x: Math.round(car.x), z: Math.round(car.z), v: +D.v.toFixed(2), instr: run.instr, pv: run.pv };
        break;
      }
      const key = `${run.pv}:${run.path ? run.path.pe.length : 0}:${K ? K.k + K.ph + (K.want || '') + (P.sigOn > 1.2) + (K.t > 6) : ''}:${run.wi}`;
      const s = nearestOn(line), end = line[line.length - 1].s;
      // the line: the planned path from here (and on), or straight on from where the car is
      if (key !== built || end - s < 60) {
        built = key;
        if (run.wi >= run.wps.length) {
          // home: into the plaza, to the pillar
          line = laneLine([run.cur ? { ei: run.cur.ei, sg: run.cur.sign } : { ei: best, sg }], () => 0, { x: car.x, z: car.z });
          line = [{ x: car.x, z: car.z, s: 0, k: 0 }, { x: 3592, z: -446, s: Math.hypot(3592 - car.x, -446 - car.z), k: 0 }];
          line.S = [{ n: -1, ux: 0, uz: 0, k: 0 }]; line.list = [{ ei: best, sg }];
        } else if (run.path && run.cur) {
          const P0 = run.path, list = [];
          for (let j = run.idx; j < P0.pe.length; j++) list.push({ ei: P0.pe[j], sg: P0.ps[j] });
          const L = list[list.length - 1];
          const more = chainAhead(L.ei, L.sg, 200).slice(1);
          line = laneLine(list.concat(more), lane(run));
        } else if (run.cur) {
          line = laneLine(chainAhead(run.cur.ei, run.cur.sign, 220), lane(run));
        }
        D.i = 0;
        if (cfg.dumpEdge && line.S && line.S.some((q) => q.ei === cfg.dumpEdge)) TRACE.push(['line', Math.round(simT), line.S.map((q) => [q.ei, +q.o.toFixed(2), lanesAt(q.ei, line.list[q.k].sg)])]);
        if (run.pv !== lastPv) { lastPv = run.pv; tasks.push(['path', run.pv, Math.round(simT)]); }
      }
      // tasks
      if (K && K.k === 'pull') { if (!doPull(run, K)) break; continue; }
      if (K && K.k === 'turn') { if (!doTurn(run, K)) break; continue; }
      if (run.wi >= run.wps.length) {
        // the last metres: off the street into the lot, and stop
        const dl = Math.hypot(car.x - 3592, car.z + 446);
        setSig(0);
        drive(line, dl < 8 ? 0 : Math.min(4, dl / 3));
        frame();
        continue;
      }
      if (!follow(line, { endPad: 55, until: () => !g2.run || keyNow() !== built, laneTask: true })) {
        if (!g2.run) break;
      }
      stuck++;
      if (stuck > 3000) break;
    }
    function keyNow() { const r = g2.run, K = r && r.task; return r ? `${r.pv}:${r.path ? r.path.pe.length : 0}:${K ? K.k + K.ph + (K.want || '') + (P.sigOn > 1.2) + (K.t > 6) : ''}:${r.wi}` : ''; }
    // safety: abandon what is left
    const still = !!g2.run;
    const live = still ? { log: g2.run.log.slice(), marks: g2.run.marks.map((m) => [m.k, m.pts, m.where]), pts: -1 } : null;
    if (still) g2.abandon();
    const L = live || g2.last || {};
    return { kind, seed, wps, cut, trace: cfg.trace ? TRACE.splice(0) : undefined, pass: !!L.pass && !still, still, pts: L.pts, marks: L.marks, fail: L.fail, t: L.t, km: L.km, log: (L.log || []).filter((q) => cfg.fullLog || (q[0] !== 'sig' && q[0] !== 'stop')).slice(0, 80) };
  }
  /** Each lane's centre on (ei, sg), right of its line. */
  function lanesAt(ei, sg) {
    const out = new Set();
    for (let u = 0; u < 1; u += 0.124) out.add(+T.laneLatU(ei, sg, u).toFixed(3));
    return [...out];
  }
  /** The lane the driver keeps: the kerb lane after a turn, else the lane it was in
   *  (a lane added on the right is not moved into), or the one a freeway task asks for. */
  function lane(run) {
    const K = run.task;
    let prev = null, pdx = 0, pdz = 0, pcls = '';
    return (ei, sg, k) => {
      const e = E[ei], ux = e.dx * sg, uz = e.dz * sg;
      let o;
      // (the left lane: once signalling a while after the ask; back right a while after it was reached)
      if (K && K.k === 'lc' && e.cls === 'hwy' && (K.want === 'L' ? P.sigOn > 1.2 && K.t > 6 : K.t < 6 || P.sigOn < 1.2)) {
        const L = T.laneInfo(ei);
        o = kerbLane(ei, sg) - (L.n >= 2 ? L.w : 0);
      } else if (k === 0 || prev === null || ux * pdx + uz * pdz < 0.85 || (pcls === 'ramp') !== (e.cls === 'ramp')) o = kerbLane(ei, sg);
      else {
        // the kerb lane, but not into one added on the right: stay in the lane you are in
        o = kerbLane(ei, sg);
        if (o - prev >= 2.5) {
          const ls = lanesAt(ei, sg).filter((q) => q > 0.8 || T.flow[ei] !== 0);
          const nr = ls.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a), o);
          if (Math.abs(nr - prev) < 1.2) o = nr;
        }
      }
      prev = o; pdx = ux; pdz = uz; pcls = e.cls;
      return o;
    };
  }
  function laneOld(run) {
    const K = run.task;
    return (ei, sg) => {
      if (K && K.k === 'lc' && K.want === 'L' && E[ei].cls === 'hwy' && P.sigOn > 1.2) {
        // the lane left of the kerb lane
        const L = T.laneInfo(ei);
        return kerbLane(ei, sg) - (L.n >= 2 ? L.w : 0);
      }
      return kerbLane(ei, sg);
    };
  }
  /** Pull over: the right signal, in to the kerb, stop; then the left signal and out. */
  function doPull(run, K) {
    const cur = run.cur;
    if (!cur) { drive(D.line, 0); frame(); return true; }
    const e = E[cur.ei];
    if (K.ph === 'ask') {
      setSig(1);
      const kerb = e.hw - car.halfWid - 0.45;
      const ln = laneLine(chainAhead(cur.ei, cur.sign, 160), (ei, sg) => (ei === cur.ei || T.flow[ei] === 0 ? Math.min(E[ei].hw - car.halfWid - 0.45, E[ei].hw) : kerbLane(ei, sg)));
      D.i = 0;
      const gap = g2.junctionGap(cur);
      const atKerb = Math.abs(cur.lat - kerb) < 0.35;
      drive(ln, atKerb && gap > 20 && P.sigOn > 1.2 ? 0 : 3.5);
      D.line = ln;
      frame();
      return true;
    }
    if (K.ph === 'wait') { drive(null, 0); frame(); return true; }
    setSig(-1);
    const ln = laneLine(chainAhead(cur.ei, cur.sign, 160), kerbLane);
    D.i = 0;
    drive(ln, P.sigOn > 1.5 ? 6 : 0);
    D.line = ln;
    frame();
    return true;
  }
  /** Would a corner be on the kerb after `ds` m at this lock (side +1 left, -1 right)? */
  function wouldHit(ds, side, R) {
    const h = car.heading + (ds / R) * side, f = { x: Math.sin(h), z: Math.cos(h) };
    const mx = (Math.sin(car.heading) + f.x) / 2, mz = (Math.cos(car.heading) + f.z) / 2;
    const x0 = car.x + mx * ds, z0 = car.z + mz * ds;
    const w = car.halfWid + 0.15, l = car.halfLen + 0.15;
    for (const [a, b] of [[l, w], [l, -w], [-l, w], [-l, -w]]) if (c.roadLift(x0 + f.x * a - f.z * b, z0 + f.z * a + f.x * b) >= 0.45) return true;
    return false;
  }
  /** Pull over, then turn round as a driver watching the kerbs does: forward on
   *  full left lock until the nose is near it, back on full right until the
   *  tail is, forward away (and again if it is not round yet). */
  function doTurn(run, K) {
    if (K.ph === 'ask') return doPull(run, { ph: 'ask' }) || true;
    setSig(0);
    if (!K._s) K._s = { m: 0, h0: car.heading, t: 0, n: 1 };
    const S = K._s;
    if (cfg.trace && S.m !== S.pm) { S.pm = S.m; TRACE.push(['3pt', S.m, Math.round(simT), +wrap(car.heading - S.h0).toFixed(2), Math.round(car.x), Math.round(car.z), run.cur && +run.cur.lat.toFixed(2), run.cur && +E[run.cur.ei].hw.toFixed(2), wouldHit(0.6, 1, 4.6), wouldHit(-0.6, -1, 4.6)]); }
    S.t += dt;
    const R = 4.6;
    const turned = Math.abs(wrap(car.heading - S.h0));
    const go = (v, side) => {
      const a = Math.abs(v) > Math.abs(D.v) ? 1.5 : 3;
      D.v += Math.max(-a * dt, Math.min(a * dt, v - D.v));
      car.heading += (D.v / R) * side * dt;
      move();
    };
    if (S.m === 0) { if (turned > 2.75 || !wouldHit(0.6, 1, R)) go(1.6, turned > 2.75 ? 0 : 1); else { S.m = 1; S.t = 0; } }
    else if (S.m === 1) { go(0, 1); if (Math.abs(D.v) < 0.03 && S.t > 0.4) { S.m = turned > 2.75 ? 4 : 2; S.t = 0; S.n++; } }
    else if (S.m === 2) { if (!wouldHit(-0.6, -1, R) && turned < 2.9) go(-1.4, -1); else { S.m = 3; S.t = 0; } }
    else if (S.m === 3) { go(0, -1); if (Math.abs(D.v) < 0.03 && S.t > 0.4) { S.m = 0; S.t = 0; S.n++; } }
    else go(3, 0);
    frame();
    return true;
  }

  if (want('clean')) results.push(['clean', cleanRun('G2', cfg.seed)]);
  if (want('cleanG')) results.push(['cleanG', cleanRun('G', cfg.seed + 1)]);

  // --- one mark at a time ---------------------------------------------------
  // a scenario: a test begun with the car at the start of `line`, `fn` driving it
  function scenario(name, line, opts, expect) {
    const p0 = line[0], p1 = line[Math.min(line.length - 1, 3)];
    place(p0.x, p0.z, Math.atan2(p1.x - p0.x, p1.z - p0.z));
    g2.begin('G2', { player: P, noCar: true, seed: 3 });
    g2.run.wps = [];     // no route: the examiner only marks
    g2.run.onRoadT = 0;
    D.v = opts.v0 || 0;
    car.vLong = D.v;
    follow(line, opts);
    // a couple of seconds on, for what is judged after the fact
    for (let i = 0; i < 60 && g2.run && !opts.noTail; i++) { drive(line, D.v); frame(); }
    const run = g2.run;
    const marks = run ? run.marks.map((m) => m.k) : (g2.last ? g2.last.marks.map((m) => m[0]) : []);
    const fail = run ? (run.fail && run.fail.k) : g2.last && g2.last.fail;
    const klog = ((run ? run.log : g2.last && g2.last.log) || []).filter((q) => q[0] === 'kerbAt' || q[0] === 'lane' || q[0] === 'nosig');
    if (run) g2.abandon();
    const ok = expect.fail ? fail === expect.fail && (!expect.marks || sameSet(marks, expect.marks)) : !fail && sameSet(marks, expect.marks || []);
    results.push([name, { ok, marks, fail, want: expect, ...(ok ? {} : { klog }) }]);
    return ok;
  }
  const sameSet = (a, b) => a.length === b.length && a.every((x, i) => [...a].sort()[i] === [...b].sort()[i]);

  // sites round the centre
  const near = (n, r) => Math.hypot(N[n].x - CEN.x, N[n].z - CEN.z) < r;
  function findApproach(kind, cls) {
    let best = null, bd = Infinity;
    for (const C of jc.list) {
      if (C.dead || (kind === 'sig' ? C.k !== 1 : C.k !== 2)) continue;
      for (const A of C.appr.values()) {
        if (kind === 'stop' && A.kind !== 'stop') continue;
        const e = E[A.ei];
        if (cls && !cls.includes(e.cls)) continue;
        if (!near(A.ni, 2600)) continue;
        const sg = e.b === A.ni ? 1 : -1;
        const back = chainBack(A.ei, sg, 120);
        let L = 0; for (const q of back) L += E[q.ei].len;
        if (L < 110) continue;
        // no other control on the way in
        if (back.slice(0, -1).some((q) => jc.ctl[endOf(q.ei, q.sg)] >= 0)) continue;
        const on = chainAhead(A.ei, sg, 120, { minDot: 0.85 });
        if (on.length < 2) continue;
        const dd = Math.hypot(N[A.ni].x - CEN.x, N[A.ni].z - CEN.z);
        if (dd < bd) { bd = dd; best = { C, A, list: back.concat(on.slice(1)) }; }
      }
    }
    return best;
  }
  function findStraight(test, minL = 220) {
    let best = null, bd = Infinity;
    for (let ei = 0; ei < E.length; ei++) {
      const e = E[ei];
      if (!test(e, ei) || e.elev || e.tunnel || !T.inComponent(ei)) continue;
      const a = N[e.a];
      const dd = Math.hypot(a.x - CEN.x, a.z - CEN.z);
      if (dd > 3000 || dd > bd) continue;
      const sg = T.allowed(ei, 1) ? 1 : -1;
      const ch = chainAhead(ei, sg, minL, { minDot: 0.96 });
      let L = 0, ok = true;
      for (const q of ch) { L += E[q.ei].len; if (!test(E[q.ei], q.ei)) ok = false; }
      for (const q of ch.slice(0, -1)) if (jc.ctl[endOf(q.ei, q.sg)] >= 0) ok = false;
      if (!ok || L < minL) continue;
      bd = dd; best = ch;
    }
    return best;
  }
  function findTurn(dirWant, onto) {
    // an uncontrolled junction of two-way city streets with a turn that way onto `onto`
    let best = null, bd = Infinity;
    for (let n = 0; n < N.length; n++) {
      const nd = N[n];
      if (nd.e.length < 3 || (jc.ctl[n] >= 0) || !near(n, 2200)) continue;
      for (const ei of nd.e) {
        const e = E[ei];
        if (T.flow[ei] !== 0 || !(e.cls === 'res' || e.cls === 'st') || e.elev) continue;
        const sg = e.b === n ? 1 : -1, ux = e.dx * sg, uz = e.dz * sg;
        for (const k of nd.e) {
          if (k === ei) continue;
          const f = E[k], s2 = f.a === n ? 1 : -1;
          if (!onto(f, k) || !T.allowed(k, s2)) continue;
          const vx = f.dx * s2, vz = f.dz * s2, cr = ux * vz - uz * vx, dd = ux * vx + uz * vz;
          if (Math.abs(dd) > 0.25 || (cr > 0 ? 1 : -1) !== dirWant) continue;
          const back = chainBack(ei, sg, 80), on = chainAhead(k, s2, 70, { minDot: 0.9 });
          let L1 = 0, L2 = 0; for (const q of back) L1 += E[q.ei].len; for (const q of on) L2 += E[q.ei].len;
          if (L1 < 70 || L2 < 60 || back.slice(0, -1).some((q) => jc.ctl[endOf(q.ei, q.sg)] >= 0 || N[endOf(q.ei, q.sg)].e.length >= 3)) continue;
          if (on.slice(0, -1).some((q) => N[endOf(q.ei, q.sg)].e.length >= 3)) continue;
          // (a plain street on: not a court's turning bulb in short pieces)
          if (on.some((q) => E[q.ei].len < 15) || /Court|Crescent|Place/.test(E[k].name || '')) continue;
          const dist = Math.hypot(nd.x - CEN.x, nd.z - CEN.z);
          if (dist < bd) { bd = dist; best = back.concat(on); best.split = back.length; }
        }
      }
    }
    return best;
  }
  const two = (cls) => (e, ei) => cls.includes(e.cls) && T.flow[ei] === 0 && e.hw >= 3.5;

  if (want('marks')) {
    // a clean drive first: the same streets the marks are taken on, driven well -- no marks
    const st = findStraight(two(['res', 'st']), 260);
    const stop = findApproach('stop');
    const sig = findApproach('sig', ['art']);
    const rt = findTurn(1, (f, k) => T.flow[k] === 0 && (f.cls === 'res' || f.cls === 'st'));
    const rtMulti = findTurn(1, (f, k) => T.flow[k] === 0 && (f.cls === 'art' || f.cls === 'st') && Math.abs(T.laneLatU(k, 1, 0.999) - T.laneLatU(k, 1, 0)) > 1.5);
    const fwy = findStraight((e, ei) => e.cls === 'hwy' && T.laneInfo(ei).n >= 2, 400);
    const one = findStraight((e, ei) => T.flow[ei] !== 0 && e.cls !== 'hwy' && e.cls !== 'ramp', 80) || fwy;
    results.push(['sites', { st: !!st, stop: !!stop, sig: !!sig, rt: !!rt, rtMulti: !!rtMulti, fwy: !!fwy, one: !!one,
      at: { st: st && [Math.round(N[E[st[0].ei].a].x), Math.round(N[E[st[0].ei].a].z)], stop: stop && [Math.round(stop.C.x), Math.round(stop.C.z)], sig: sig && [Math.round(sig.C.x), Math.round(sig.C.z)] } }]);
    const kl = (L) => laneLine(L, kerbLane);
    if (st) {
      scenario('ok-street', kl(st), {}, { marks: [] });
      const lim = (s, e, l) => l + 12 / 3.6;
      scenario('speed', kl(st), { vmax: lim, v0: 10 }, { marks: ['speed'] });
      scenario('excess', kl(st), { vmax: (s, e, l) => l + 36 / 3.6, v0: 18 }, { fail: 'excess' });
      scenario('kerb', laneLine(st, (ei) => E[ei].hw - 0.55), { vmax: () => 7, v0: 6, until: () => g2.run && g2.run.marks.length > 0, noTail: true }, { marks: ['kerb'] });
      scenario('centre', laneLine(st, () => -1.7), { vmax: () => 8, v0: 8, until: () => g2.run && g2.run.marks.length > 0, noTail: true }, { marks: ['centre'] });
      scenario('wrongside', laneLine(st, () => -1.7), { vmax: () => 7, v0: 7 }, { fail: 'wrongside', marks: ['centre'] });
      // following too close: a car 0.7 s ahead, matching speed
      {
        const ln = kl(st);
        const lead = T.spawnAt(ln[0].x, ln[0].z, 0, 'sedan', 0x335577, 'free');
        let ls = 14;
        scenario('close', ln, {
          v0: 10, vmax: () => 10,
          each: (s) => { ls = s + 9.6; const p = pointAt(ln, ls), q = pointAt(ln, ls + 2); lead.x = p.x; lead.z = p.z; lead.heading = Math.atan2(q.x - p.x, q.z - p.z); lead.y = car.y; },
        }, { marks: ['close'] });
        T.remove(lead);
      }
    }
    if (stop) {
      scenario('ok-stop', kl(stop.list), {}, { marks: [] });
      scenario('roll', kl(stop.list), { noStop: true, vmax: (s, e, l) => Math.min(l - 2, 2.6) }, { marks: ['roll'] });
      scenario('stopfail', kl(stop.list), { noStop: true, vmax: () => 8.5 }, { fail: 'stop' });
    }
    if (sig) {
      // the light's clock moved so the car meets red, or an amber it could stop for
      const meet = (state, lead) => {
        const C = sig.C, A = sig.A;
        const ln = kl(sig.list), q = controlsOn(ln).find((x) => x.A === A);
        const vmax = Math.min(14, (g2.limitOf(A.ei) || 50) / 3.6 - 1);
        const eta = q.s / vmax;
        // a jc.t where, `eta` s on, the light shows `state` (for amber: just turned)
        const t0 = jc.t;
        for (let k = 0; k < 2000; k++) {
          jc.t = t0 + k * 0.25;
          const okNow = state === 'R' ? jc.light(C, A, 'S').s === 'G' && (() => { const tt = jc.t; jc.t = tt + eta; const r = jc.light(C, A, 'S').s === 'R'; jc.t = tt + eta + 3; const r2 = jc.light(C, A, 'S').s === 'R'; jc.t = tt; return r && r2; })()
            : (() => { const tt = jc.t; jc.t = tt + eta - lead; const a = jc.light(C, A, 'S').s === 'Y'; jc.t = tt + eta - lead - 0.3; const b = jc.light(C, A, 'S').s === 'G'; jc.t = tt + eta; const y2 = jc.light(C, A, 'S').s === 'Y'; jc.t = tt; return a && b && y2; })();
          if (okNow) break;
        }
        return { ln, vmax };
      };
      { const m = meet('R'); scenario('red', m.ln, { ignoreLights: true, v0: m.vmax, vmax: () => m.vmax }, { fail: 'red' }); }
      { const m = meet('Y', 3.7); scenario('amber', m.ln, { ignoreLights: true, v0: m.vmax, vmax: () => m.vmax }, { marks: ['amber'] }); }
      scenario('ok-sig', kl(sig.list), {}, { marks: [] });
    }
    if (rt) {
      scenario('ok-turn', kl(rt), {}, { marks: [] });
      scenario('signal', kl(rt), { sig: 0 }, { marks: ['signal'] });
      scenario('wide', laneLine(rt, (ei, sg, k) => (k >= rt.split ? -1.4 : kerbLane(ei, sg))),
        { vmax: (s, e, l) => Math.min(l - 2, 6), until: () => g2.run && g2.run.marks.length > 0, noTail: true }, { marks: ['wide'] });
    }
    if (rtMulti) scenario('wideMulti', laneLine(rtMulti, (ei, sg, k) => (k >= rtMulti.split ? innerLane(ei, sg) : kerbLane(ei, sg))),
      { vmax: (s, e, l) => Math.min(l - 2, 7), until: () => g2.run && g2.run.marks.length > 0, noTail: true }, { marks: ['wide'] });
    if (fwy) {
      // two lanes over, unsignalled, then signalled
      const n = T.laneInfo(fwy[0].ei).n;
      const half = (s) => s > 160;
      const ln2 = (sig) => {
        const L0 = kl(fwy), lnL = laneLine(fwy, (ei, sg) => kerbLane(ei, sg) - T.laneInfo(ei).w);
        return { L0, lnL, sig };
      };
      const go = (name, sig, expect) => {
        const { L0, lnL } = ln2(sig);
        let moved = false;
        const p0 = L0[0], p1 = L0[3];
        place(p0.x, p0.z, Math.atan2(p1.x - p0.x, p1.z - p0.z));
        g2.begin('G2', { player: P, noCar: true, seed: 3 }); g2.run.wps = [];
        D.v = 25; car.vLong = 25;
        follow(L0, { vmax: () => 25, sig: sig ? -1 : 0, until: () => { if (half(nearestOn(L0))) moved = true; return moved; } });
        const sNow = nearestOn(lnL); void sNow;
        follow(lnL, { vmax: () => 25, sig: sig ? -1 : 0 });
        const run = g2.run, marks = run ? run.marks.map((m) => m.k) : [], fail = run && run.fail && run.fail.k;
        if (run) g2.abandon();
        results.push([name, { ok: !fail && sameSet(marks, expect), marks, fail, want: expect }]);
      };
      go('lane', false, ['lane']);
      go('ok-lane', true, []);
    }
    if (one) {
      const back = one.slice().reverse().map((q) => ({ ei: q.ei, sg: -q.sg }));
      scenario('wrongway', laneLine(back, () => 0), { vmax: () => 7, v0: 7, noCtl: true, noStop: true, ignoreLights: true }, { fail: 'wrongway' });
    }
    // the hooks the game calls: a crash, a pedestrian, a stopped school bus
    for (const [name, fn, f] of [['crash', () => d.game.onCrash(9, false, null), 'crash'], ['bus', () => T.onSchoolBusPass(false), 'bus'],
      ['ped', () => d.game.onPedHit(true, { x: car.x, y: car.y, z: car.z }), 'ped']]) {
      if (!st) break;
      const ln = kl(st);
      place(ln[0].x, ln[0].z, Math.atan2(ln[3].x - ln[0].x, ln[3].z - ln[0].z));
      g2.begin('G2', { player: P, noCar: true, seed: 3 }); g2.run.wps = [];
      for (let i = 0; i < 40; i++) { drive(ln, 6); frame(); }
      fn();
      for (let i = 0; i < 4 && g2.run; i++) frame();
      const L = g2.last || {};
      if (g2.run) g2.abandon();
      results.push([name, { ok: L.fail === f, fail: L.fail, want: { fail: f } }]);
      d.game.wanted = 0; d.game.points = 0;
    }
  }

  d.game.money = d.game.money;   // (the passes paid; harmless)
  const bad = results.filter(([k, r]) => k !== 'sites' && (k.startsWith('clean') ? !r.pass || r.pts !== 0 : !r.ok));
  return `${bad.length ? 'FAIL' : 'PASS'} (${results.length - 1} checks, sim ${Math.round(simT)} s)\n` + results.map(([k, r]) => `  ${k}: ${JSON.stringify(r)}`).join('\n');
})()
