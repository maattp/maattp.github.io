// Cost A/B of the thunderstorm and the road spray: draws / tris and frames drawn in 5 s, three
// rounds, the game running, on foot on the Conestoga Parkway's shoulder looking across it:
//   clear | rain with spray off (the rain as master had it) | storm (no strike) | storm with a
//   bolt held | storm with six posed cars (the phone's cap) driving past at 25 m/s, spraying |
//   the same six in rain with spray off.
//   AUTO_PHONE=1 VIEW_THROTTLE=8 AUTO_GPU=1 AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     VIEW_PROBE_FILE=tools/kw/stormcost.js node tools/kw/kwshots.mjs /tmp/x
// (headless is SwiftShader: a stand-in for CPU cost and fill, not the phone's GPU)
(async () => {
  const d = window.__dbg, S = d.storm, SP = d.spray;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const c = d.city;
  let best = null;
  for (const ei of c.edgesNear(1214, 1555, 500)) { const e = c.edges[ei]; if (e.cls === 'hwy' && !e.tunnel && !e.elev && (!best || e.len > best.len)) best = e; }
  const a = c.nodes[best.a], h = Math.atan2(best.dx, best.dz), mid = best.len * 0.5;
  const at = (s, lat) => [a.x + best.dx * s - best.dz * lat, a.z + best.dz * s + best.dx * lat];
  {
    const [x, z] = at(mid, best.hw + 4);
    d.player.x = x; d.player.z = z; d.player.y = c.groundAt(x, z, null) + 0.1; d.player.vy = 0;
    d.player.heading = h - Math.PI / 2;   // facing the road
  }
  d.game.paused = false;
  await sleep(12000);
  // six posed cars (the phone's cap) along the near carriageway at 25 m/s, looping
  const cars = [];
  let drive = false, lastT = 0;
  for (let i = 0; i < 6; i++) {
    const lat = (i % 2 ? 0.4 : -0.4) * best.hw, s0 = mid - 40 + i * 9;
    const [x, z] = at(s0, lat);
    const v = d.traffic.spawnAt(x, z, h, i === 2 ? 'bus' : 'civic', 0x888888, 'apron');
    v.group.visible = false;
    cars.push({ v, s0, s1: s0, lat });
  }
  const step = (t) => {
    const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0; lastT = t;
    for (const o of cars) {
      const v = o.v;
      if (!drive) { v.vLong = 0; v.group.visible = false; continue; }
      v.group.visible = true;
      o.s1 += 25 * dt;
      if (o.s1 > o.s0 + 80) o.s1 = o.s0;
      const [x, z] = at(o.s1, o.lat);
      v.place(x, z, h);
      v.vLong = 25; v.onGround = true;
    }
    if (cars.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // CPU time of this feature's own per-frame calls (performance.now around each)
  const T = { ms: 0 };
  for (const [o, k] of [[SP, 'update'], [S, 'tick'], [S, 'preRender'], [S, 'postRender']]) {
    const f0 = o[k].bind(o);
    o[k] = (...args) => { const t0 = performance.now(); try { return f0(...args); } finally { T.ms += performance.now() - t0; } };
  }
  const frames = async (ms) => {
    let n = 0, go = true, calls = 0, tris = 0, alive = 0, nc = 0;
    T.ms = 0;
    const f = () => { n++; calls += d.sceneStats.calls; tris += d.sceneStats.tris; alive += SP.alive; nc += SP.cars; if (go) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    await sleep(ms); go = false;
    return { fps: n / (ms / 1000), calls: calls / n, tris: tris / n, alive: alive / n, cars: nc / n, cpu: T.ms / n };
  };
  const res = [];
  const conds = ['clear', 'rain-nospray', 'storm', 'storm+bolt', 'storm+6cars', 'rain+6cars-nospray'];
  const acc = {};
  for (let round = 0; round < 3; round++) {
    for (const k of conds) {
      window.__weather = k.startsWith('storm') ? 'storm' : k.startsWith('rain') ? 'rain' : k;
      window.__noSpray = k.endsWith('nospray');
      drive = k.includes('6cars');
      S.hold = false; S.s.on = false; S.next = 1e9;   // no random strikes inside a window
      await sleep(1500);
      if (k === 'storm+bolt') { S.hold = true; S.strike({ kind: 'bolt', d: 2500, az: 0 }, d.camera); }
      const r = await frames(5000);
      (acc[k] = acc[k] || []).push(r);
      res.push(`${k.padEnd(19)} ${r.fps.toFixed(2)} fps  calls ${r.calls.toFixed(1)}  tris ${(r.tris / 1000).toFixed(0)}k  spray ${r.alive.toFixed(0)} particles / ${r.cars.toFixed(1)} cars  own cpu ${r.cpu.toFixed(3)} ms/frame`);
    }
  }
  S.hold = false; S.s.on = false; S.next = 10; drive = false;
  for (const o of cars) d.traffic.remove(o.v);
  cars.length = 0;
  window.__weather = 'clear'; window.__noSpray = false;
  res.push('-- means');
  for (const k of conds) {
    const A = acc[k], m = (q) => A.reduce((s, r) => s + r[q], 0) / A.length;
    res.push(`${k.padEnd(19)} ${m('fps').toFixed(2)} fps  calls ${m('calls').toFixed(1)}  tris ${(m('tris') / 1000).toFixed(0)}k  spray ${m('alive').toFixed(0)} / ${m('cars').toFixed(1)} cars  own cpu ${m('cpu').toFixed(3)} ms/frame`);
  }
  return res.join('\n');
})()
