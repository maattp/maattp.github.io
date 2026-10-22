// Auto KW: a school bus stop staged with traffic both ways (schoolbus.js).
//
//   VIEW_PROBE_FILE=tools/kw/schoolbusprobe.js AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     node tools/kw/kwshots.mjs /tmp/x            -> PASS / FAIL and the numbers
//   VIEW_BOOT_JS='window.__sbPre=1' VIEW_PRE_FILE=tools/kw/schoolbusprobe.js \
//     VIEWS=tools/kw/schoolbusviews.json AUTO_GPU=1 node tools/kw/kwshots.mjs <dir>
//                                                  -> the docs' stills (__sbStage)
//   (window.__sbp = { site: { x, z }, r, median: true, you: true, kids, behind, opposite })
//
// The game paused, as trafficbench.js does it: the population cleared, the
// streamer settled round the site, every random source pinned, a fixed
// culling camera, spawning off, traffic.update stepped at 1/60 s with a
// stand-in player at the site. The site is the longest two-way street of one
// lane a side (residential or collector, nearest the site) -- or, `median`,
// a divided road's carriageway with the other one beside it. On it: a school
// bus, cars following it, and cars coming the other way (released a few
// seconds later, so they meet it with its reds on). window.__sbGap = 0 makes
// it stop as soon as it is rolling; __sbHour pins school hours.
//
// PASS when: the bus ran amber -> red -> arm in -> away, children stepped
// off, at least one car stopped behind it and (two-way) one coming the other
// way, every car that stopped for it stood HOLD_BACK (20 m) or more short of
// it -- nose to its rear, or to its front --, nobody passed it while its reds
// flashed, and (median) nobody on the other carriageway stopped for it;
// `you`: your stand-in car driven past it was called an offence exactly once.
(() => {
  const d = window.__dbg, T = d.traffic, c = d.city;
  const cfg = Object.assign({ behind: [32, 58, 84], opposite: [80, 115, 150], oppDelay: 4, median: false }, window.__sbp || {});
  const mk = (seed) => { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const E = c.edges, N = c.nodes;
  const dt = 1 / 60;

  // THE STREET: a CHAIN of edges through nodes of two ways only (edges are
  // a few tens of metres: the importer splits a way at every bend), one lane
  // a way, residential or collector -- or, `median`, a divided road's one-way
  // carriageway with the other one beside it. A chain is [{ ei, sign, len }]
  // in the direction of travel.
  const okE = (ei, oneway) => {
    const e = E[ei];
    if (!e || !(e.cls === 'res' || e.cls === 'st') || e.elev || e.tunnel || e.noTraffic || !T.inComponent(ei)) return false;
    if (oneway) return T.flow[ei] !== 0 && T.laneInfo(ei).n === 1;
    return T.flow[ei] === 0 && T.laneLatU(ei, 1, 0.5) === T.laneLatU(ei, 1, 0.9);
  };
  function chainFrom(ei, sign, oneway) {
    const out = [{ ei, sign, len: E[ei].len }];
    const seen = new Set([ei]);
    // forward from the end node, then backward from the start node
    for (const fwd of [true, false]) {
      let cur = ei, sg = sign;
      for (let guard = 0; guard < 80; guard++) {
        const e = E[cur], ni = (fwd ? sg > 0 : sg < 0) ? e.b : e.a, nd = N[ni];
        if (nd.e.length !== 2 || (c.jc && c.jc.ctl[ni] >= 0)) break;
        const nx = nd.e[0] === cur ? nd.e[1] : nd.e[0];
        if (seen.has(nx) || !okE(nx, oneway)) break;
        const f = E[nx];
        // the way on: leaving ni (forward) / arriving at ni (backward)
        const ns = fwd ? (f.a === ni ? 1 : -1) : (f.b === ni ? 1 : -1);
        if (oneway && T.flow[nx] !== ns) break;
        // straight enough to stage on
        const d0x = e.dx * sg, d0z = e.dz * sg, d1x = f.dx * ns, d1z = f.dz * ns;
        if (d0x * d1x + d0z * d1z < 0.9) break;
        seen.add(nx);
        const it = { ei: nx, sign: ns, len: f.len };
        if (fwd) out.push(it); else out.unshift(it);
        cur = nx; sg = ns;
      }
    }
    out.L = out.reduce((q, o) => q + o.len, 0);
    return out;
  }
  function chainPoint(ch, s) {
    for (const o of ch) { if (s <= o.len) return { ei: o.ei, sign: o.sign, s: Math.max(0.5, s) }; s -= o.len; }
    const o = ch[ch.length - 1];
    return { ei: o.ei, sign: o.sign, s: o.len - 0.5 };
  }
  function chainNearest(ch, x, z) {
    let acc = 0, best = Infinity, bs = 0;
    for (const o of ch) {
      const e = E[o.ei], a = N[o.sign > 0 ? e.a : e.b], ux = e.dx * o.sign, uz = e.dz * o.sign;
      const t = Math.max(0, Math.min(o.len, (x - a.x) * ux + (z - a.z) * uz));
      const d2 = (a.x + ux * t - x) ** 2 + (a.z + uz * t - z) ** 2;
      if (d2 < best) { best = d2; bs = acc + t; }
      acc += o.len;
    }
    return { s: bs, d: Math.sqrt(best) };
  }
  function findChain(site) {
    let best = null, bs = -Infinity;
    const done = new Set();
    for (const ei of c.edgesNear(site.x, site.z, cfg.r || 2500)) {
      if (done.has(ei) || !okE(ei, cfg.median)) continue;
      const ch = chainFrom(ei, cfg.median ? T.flow[ei] : 1, cfg.median);
      for (const o of ch) done.add(o.ei);
      if (ch.L < 280) continue;
      let tw = null;
      if (cfg.median) { tw = twin(ch); if (!tw) continue; }
      const e = E[ei], a = N[e.a];
      const sc = Math.min(ch.L, 500) - 0.15 * Math.hypot(a.x - site.x, a.z - site.z);
      if (sc > bs) { bs = sc; best = ch; best.twin = tw; }
    }
    return best;
  }
  // a divided road's other carriageway: a one-way chain alongside, the other way
  function twin(ch) {
    const mid = chainPoint(ch, ch.L / 2), e = E[mid.ei], a = N[e.a];
    const mx = a.x + e.dx * (mid.sign > 0 ? mid.s : e.len - mid.s), mz = a.z + e.dz * (mid.sign > 0 ? mid.s : e.len - mid.s);
    for (const k of c.edgesNear(mx, mz, 40)) {
      if (!okE(k, true)) continue;
      const f = E[k], cos = (f.dx * e.dx * T.flow[k] + f.dz * e.dz * T.flow[k]) * mid.sign;
      if (cos > -0.95) continue;
      const fa = N[f.a], lat = Math.abs((fa.x - mx) * e.dz - (fa.z - mz) * e.dx);
      if (lat < 6 || lat > 35) continue;
      const tc = chainFrom(k, T.flow[k], true);
      if (tc.L > 250) return tc;
    }
    return null;
  }
  function place(ch, s, tn, laneU = 0.5) {
    const { ei, sign, s: se } = chainPoint(ch, s);
    const e = E[ei], a = N[e.a], b = N[e.b];
    const t = sign > 0 ? se / e.len : 1 - se / e.len;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const off = T.laneLat(ei, sign, { laneU });
    const v = T.spawnAt(x - e.dz * sign * off, z + e.dx * sign * off, Math.atan2(e.dx * sign, e.dz * sign), tn, 0x9fa4a9, 'traffic');
    v.edge = ei; v.dirSign = sign; v.laneU = laneU; v.vLong = 7; v.panic = 0; v.drvK = 1;
    v.prio = ++T._prio;
    T.routeInit(v);
    return v;
  }
  const reverse = (ch) => { const r = ch.slice().reverse().map((o) => ({ ei: o.ei, sign: -o.sign, len: o.len })); r.L = ch.L; return r; };
  function settle(site) {
    for (const v of [...T.cars]) if (v.mode !== 'apron') T.remove(v);
    T.parkedSlots.clear();
    T.updateParked = () => {};
    T.updateLotParked = () => {};
    T.link = null; T.freight = null; T.streetcars = null;
    d.game.wanted = 0;
    const pend = () => [...d.world.chunks.values()].filter((q) => q.lod !== q.wantLod).length;
    for (let i = 0; i < 20000 && (i < 6 || pend() > 0); i++) d.world.update(site.x, site.z, 2);
    for (let i = 0; i < 300; i++) d.world.update(site.x, site.z, 2);
    for (const v of [...T.cars]) if (v.mode === 'parked') T.remove(v);
    T._kerb = null; T._lotKey = null;
    const f = mk(99);
    T.R = { f, n: () => f(), range: (a, b) => a + (b - a) * f(), int: (a, b) => Math.min(b, a + Math.floor(f() * (b - a + 1))), pick: (arr) => arr[Math.min(arr.length - 1, Math.floor(f() * arr.length))], chance: (p) => f() < p, sign: () => (f() < 0.5 ? -1 : 1) };
    Math.random = mk(12345);
    if (c.jc) c.jc.t = 0;
    T.spawnTimer = 0; T._tick = 0; T.copTimer = 0; T.crossN = 0;
    T._prio = 300000;
    T.spawnTraffic = () => null;   // only the staged cars
    const cam = new d.THREE.PerspectiveCamera(62, 874 / 402, 0.5, 4000);
    const gy = d.G.terrainHeight(site.x, site.z);
    cam.position.set(site.x - 40, gy + 25, site.z - 40);
    cam.lookAt(site.x + 60, gy, site.z + 60);
    cam.updateMatrixWorld(true);
    T.camera = cam;
  }

  // Stage it: returns the run's state, stepped by `step()`
  function stage() {
    window.__sbGap = 0; window.__sbHour = 10; window.__sbKids = cfg.kids != null ? cfg.kids : 4;
    const site = cfg.site || { x: -3020, z: -2350 };
    settle(site);
    const ch = findChain(site);
    if (!ch) return { err: 'no street' };
    const ei = ch[0].ei, e = E[ei];
    const s0 = 95;
    const bus = place(ch, s0, 'schoolbus');
    bus.vLong = 6;
    const behind = cfg.behind.map((g, i) => place(ch, s0 - g, ['sedan', 'suv', 'minivan', 'pickup'][i % 4]));
    const oppCh = cfg.median ? ch.twin : reverse(ch);
    const mid = chainPoint(ch, ch.L / 2), me = E[mid.ei];
    const P = { vehicle: null, onFoot: false, x: N[me.a].x, y: 0, z: N[me.a].z, speed: 0, heading: 0 };
    return { site, ei, e, ch, oppCh, bus, behind, opp: [], P, t: 0, i: 0, redAt: -1, phases: [], prev: new Map(), passes: [], stops: new Map(), wentOn: false, kids0: T.sb.stats.kids, endAt: -1 };
  }
  function step(R) {
    const { bus } = R;
    // the oncoming cars, a little after the bus starts to stop
    if (!R.opp.length && R.t >= cfg.oppDelay && R.oppCh) {
      // positions along the opposing way, from where the bus is on it
      const bs = chainNearest(R.oppCh, bus.x, bus.z).s;
      for (const [i, g] of cfg.opposite.entries()) {
        const sa = bs - g;
        if (sa > 5) R.opp.push(place(R.oppCh, sa, ['hatch', 'crossover', 'sedan', 'van'][i % 4]));
      }
    }
    // YOU (cfg.you): a stand-in car driven by hand past the bus 1.5 s into
    // its reds -- 45 m behind it, a lane to its left, at 10 m/s -- which
    // must be called an offence once (traffic.onSchoolBusPass)
    if (cfg.you && R.redAt >= 0 && !R.P.vehicle && R.t > R.redAt + 1.5) {
      const f = bus.forward, L = { x: f.z, z: -f.x };
      R.P.vehicle = { x: bus.x - f.x * 45 + L.x * 3.4, z: bus.z - f.z * 45 + L.z * 3.4, y: bus.y, forward: { x: f.x, z: f.z }, vLong: 10, halfLen: 2.3, halfWid: 0.9 };
    }
    if (R.P.vehicle) { const y = R.P.vehicle; y.x += y.forward.x * y.vLong * dt; y.z += y.forward.z * y.vLong * dt; }
    T.update(dt, R.P.x, R.P.z, { x: 0, z: 1 }, R.P);
    R.t += dt; R.i++;
    const S = bus.sb, ph = S ? S.phase : 0;
    if (R.phases[R.phases.length - 1] !== ph) R.phases.push(ph);
    if (ph >= 2 && R.redAt < 0) R.redAt = R.t;
    if (R.redAt >= 0 && ph === 0 && R.endAt < 0) R.endAt = R.t;
    const f = bus.forward;
    for (const v of [...R.behind, ...R.opp]) {
      if (!T.cars.includes(v)) continue;
      const rx = v.x - bus.x, rz = v.z - bus.z, lon = rx * f.x + rz * f.z, lat = rx * f.z - rz * f.x;
      const same = v.forward.x * f.x + v.forward.z * f.z > 0;
      const side = lon > bus.halfLen ? 1 : lon < -bus.halfLen ? -1 : 0;
      const pr = R.prev.get(v);
      if (ph >= 2 && pr != null && pr !== 0 && side !== pr && Math.abs(lat) < 14) R.passes.push({ type: v.typeName, same, t: +R.t.toFixed(2), lat: +lat.toFixed(1) });
      R.prev.set(v, side);
      if (ph >= 2 && Math.abs(v.vLong) < 0.3) {
        // the gap: its nose to the bus's rear (behind), or to its front (coming the other way)
        const g = same ? -lon - bus.halfLen - v.halfLen : lon - bus.halfLen - v.halfLen;
        if (Math.abs(lat) < 14 && g > -2 && g < 120) {
          const o = R.stops.get(v) || { type: v.typeName, same, lane: Math.abs(lat) < 2 ? 'own' : 'other', min: Infinity };
          o.min = Math.min(o.min, g); o.lat = +lat.toFixed(1);
          R.stops.set(v, o);
        }
      }
    }
    if (R.endAt >= 0 && R.t > R.endAt + 6 && bus.vLong > 2) R.wentOn = true;
  }
  window.__sbStage = function (opts = {}) {
    Object.assign(cfg, opts);
    const R = stage();
    if (R.err) return null;
    // to the reds, the arm out and `kidsOff` children off, then the crowd's
    // own pedestrians stepped so they walk away
    const want = opts.kidsOff != null ? opts.kidsOff : 3;
    for (let i = 0; i < 60 * 60; i++) {
      step(R);
      if (R.redAt >= 0 && T.sb.stats.kids - R.kids0 >= want && R.t > R.redAt + (opts.after || 0)) break;
    }
    for (let i = 0; i < (opts.walk || 50); i++) { d.peds.update(dt, R.P.x, R.P.z, d.player, T); step(R); }
    T._lampT = Math.floor(T._lampT / 0.4) * 0.4 + 0.05;   // a lit half for the side nearest the camera
    T.updateLamps(0, R.P.x, R.P.z, R.P);
    const b = R.bus, f = b.forward, gy = b.y;
    const V = opts.view || 'arm';
    // the arm's side (the bus's left), up and ahead; or the kerb side, ahead
    const L = { x: f.z, z: -f.x };
    window.__sbInfo = { edge: R.ei, cls: R.e.cls, bus: [+b.x.toFixed(1), +b.z.toFixed(1)], phase: b.sb.phase, k: b.sb.k, bits: b.lampBits,
      kids: T.sb.stats.kids - R.kids0, stops: [...R.stops.values()].map((o) => ({ ...o, min: +o.min.toFixed(1) })) };
    if (V === 'arm') return { c: [b.x + f.x * 17 + L.x * 3.2, b.z + f.z * 17 + L.z * 3.2, 2.1], t: [b.x + f.x * 2 + L.x * 0.6, b.z + f.z * 2 + L.z * 0.6, 1.7], fov: 50 };
    if (V === 'kerb') return { c: [b.x + f.x * 13 - L.x * 4.2, b.z + f.z * 13 - L.z * 4.2, 1.8], t: [b.x + f.x * 1 - L.x * 3.0, b.z + f.z * 1 - L.z * 3.0, 1.1], fov: 55 };
    if (V === 'high') return { c: [b.x + L.x * 34 + f.x * 4, b.z + L.z * 34 + f.z * 4, 24], t: [b.x + f.x * 4, b.z + f.z * 4, 0], fov: 80 };
    void gy;
    return { c: [b.x - f.x * 52 - L.x * 1.5, b.z - f.z * 52 - L.z * 1.5, 3.0], t: [b.x + L.x * 0.5, b.z + L.z * 0.5, 1.4], fov: 45 };
  };
  if (window.__sbPre) return 'schoolbus stage defined';

  const R = stage();
  if (R.err) return 'FAIL: ' + R.err;
  const calls = [], onPass0 = T.onSchoolBusPass;
  if (cfg.you) T.onSchoolBusPass = (seen) => calls.push({ t: +R.t.toFixed(2), seen });
  for (let i = 0; i < 60 * 70 && !(R.wentOn && R.t > R.endAt + 8); i++) step(R);
  const stops = [...R.stops.values()].map((o) => ({ ...o, min: +o.min.toFixed(1) }));
  const behindStopped = stops.filter((o) => o.same), oppStopped = stops.filter((o) => !o.same);
  const near = stops.filter((o) => o.min < 19.5);
  const seq = R.phases.join('>');
  const fails = [];
  if (!/1>2>3>0/.test(seq)) fails.push('sequence ' + seq);
  if (T.sb.stats.kids - R.kids0 < 1) fails.push('no children');
  if (!behindStopped.length) fails.push('nobody stopped behind');
  if (!cfg.median && !oppStopped.length) fails.push('nobody stopped coming the other way');
  if (cfg.median && oppStopped.length) fails.push('the other carriageway stopped');
  if (near.length) fails.push(near.length + ' stopped under 20 m');
  // (with a median the other carriageway drives on, as it should)
  const passed = R.passes.filter((q) => !cfg.median || q.same);
  if (passed.length) fails.push(passed.length + ' passed it');
  if (!R.wentOn) fails.push('the bus did not go on');
  if (cfg.you) { T.onSchoolBusPass = onPass0; R.P.vehicle = null; if (calls.length !== 1) fails.push(`your pass called ${calls.length} times`); }
  return JSON.stringify({ result: fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS', edge: R.ei, cls: R.e.cls, street: Math.round(R.ch.L), at: [Math.round(R.bus.x), Math.round(R.bus.z)], median: !!cfg.median,
    sequence: seq, redAt: +R.redAt.toFixed(1), redFor: R.endAt > 0 ? +(R.endAt - R.redAt).toFixed(1) : null, kids: T.sb.stats.kids - R.kids0,
    stops, passes: passed, otherWayDroveOn: cfg.median ? R.passes.length - passed.length : undefined, sbHolds: +(T.stats.sbHolds || 0).toFixed(1), opp: R.opp.length, you: cfg.you ? calls : undefined }, null, 1);
})()
