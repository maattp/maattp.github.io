// Thunderstorm + road spray probe (storm.js, spray.js, weather.js `storm`). Run:
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/stormprobe.js node tools/kw/kwshots.mjs /tmp/x
// Prints PASS/FAIL per check and ends ALL PASS or FAILED n.
(async () => {
  const d = window.__dbg, S = d.storm, SP = d.spray, W = d.weather, out = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ck = (n, ok, x) => out.push((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? ' ' + JSON.stringify(x) : ''));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ck('storm and spray built', !!S && !!SP);
  if (!S || !SP) return out.join('\n');
  const cam = d.camera;
  cam.position.set(-1100, 360, 400); cam.lookAt(-1000, 320, -400); cam.updateMatrixWorld(true);

  // ---- 1. the state can be forced
  window.__weather = 'storm';
  await sleep(600);
  // (the rain is drawn only near the ground)
  { const gy = d.city.groundAt(-1100, 400, null); cam.position.set(-1100, gy + 2, 400); cam.lookAt(-1000, gy + 2, -400); cam.updateMatrixWorld(true); }
  await sleep(600);
  ck('storm forced: state, storm 1, rain 1, wet', W.state === 'storm' && W.cur.storm === 1 && W.cur.rain === 1 && W.wet === 1, { st: W.state, c: W.cur, wet: W.wet });
  ck('storm is a menu setting', (() => { const b = document.querySelector('[data-weather="storm"]'); return !!b; })());
  ck('rain heavier in a storm (smaller box) and gusting', W.precip && W.precip.box.x < 34 && W.precip.u.uWind.value.x > 1.3, W.precip && [W.precip.box.x, W.precip.u.uWind.value.x]);
  // the month table can pick it: auto picks in July
  {
    const keep = { month: W.month, state: W.state };
    // the auto chain (each pick is a different state from the last): the share of states that are storms
    let n = 0; W.month = 6; W.state = 'clear';
    for (let i = 0; i < 20000; i++) { W.state = W._pick(); if (W.state === 'storm') n++; }
    let nj = 0; W.month = 0; W.state = 'clear';
    for (let i = 0; i < 20000; i++) { W.state = W._pick(); if (W.state === 'storm') nj++; }
    W.month = keep.month; W.state = keep.state;
    ck('auto weather: storms ~1 in 12 July states (4-14 %), none in January', n / 20000 > 0.04 && n / 20000 < 0.14 && nj === 0, { jul: n / 20000, jan: nj });
  }

  // ---- 2. strikes at the expected rate (an hour of storm at a fixed dt; sound off)
  const aud = S.audio; S.audio = null;
  const st0 = { ...S.stats }, log0 = S.log.length;
  S.next = 8;
  const DT = 0.05, HOURS = 3600;
  let maxGap = 0, minGap = 1e9, last = -1;
  const t0 = S.t;
  for (let i = 0; i < HOURS / DT; i++) {
    const before = S.stats.strikes;
    S.tick(DT, cam);
    if (S.stats.strikes > before) {
      if (last >= 0) { const g = S.t - last; maxGap = Math.max(maxGap, g); minGap = Math.min(minGap, g); }
      last = S.t;
    }
  }
  const strikes = S.stats.strikes - st0.strikes, near = S.stats.near - st0.near, cc = S.stats.cc - st0.cc;
  ck('strike rate: 1 per 8-30 s (an hour: 120-450)', strikes >= 120 && strikes <= 450, { strikes, per: (HOURS / strikes).toFixed(1) });
  ck('gaps between strikes within 8-31 s (+ the strike itself)', minGap >= 8 && maxGap <= 31.5, { minGap: +minGap.toFixed(2), maxGap: +maxGap.toFixed(2) });
  ck('cloud-to-cloud ~30 % (15-45 %)', cc / strikes > 0.15 && cc / strikes < 0.45, cc / strikes);
  ck('near strikes rare (~1 in 40: 0-8 %)', near / strikes < 0.08, { near, of: strikes });
  // ---- 3. the thunder's delay = distance / 343 m/s
  const L = S.log.slice(-60);
  let worst = 0, heard = 0;
  for (const r of L) {
    if (r.heardAt < 0) continue;
    heard++;
    worst = Math.max(worst, Math.abs((r.heardAt - r.t) - r.d / 343));
  }
  ck('thunder heard after every strike, delay = d / 343 (within one tick)', heard >= L.length - 3 && worst <= DT + 1e-6, { heard, of: L.length, worst: +worst.toFixed(4) });
  const near1 = S.strike({ kind: 'near', d: 250 }, cam);
  const far1 = S.strike({ kind: 'bolt', d: 5000 }, cam);
  ck('a 5 km strike queues thunder 14.6 s later, a near one 0.7 s', Math.abs(far1.thunderAt - far1.t - 5000 / 343) < 1e-6 && Math.abs(near1.thunderAt - near1.t - 250 / 343) < 1e-6, [far1.thunderAt - far1.t, near1.thunderAt - near1.t]);
  ck('strike distances: far 1-6 km, near 150-400 m', S.log.slice(-60).every((r) => r.kind === 'near' ? r.d >= 150 && r.d <= 400 : (r.d >= 1000 && r.d <= 6000) || r === near1 || r === far1));
  for (let i = 0; i < 400; i++) S.tick(DT, cam);   // drain the queue
  S.audio = aud;

  // ---- 4. the flash touches values only inside the render call, and puts every one back
  let flashed = 0, restored = 0, bad = 0, frames = 0, boltSeen = 0, maxF = 0;
  for (const kind of ['bolt', 'cc', 'near', 'bolt', 'bolt', 'near']) {
    S.strike({ kind, d: kind === 'near' ? 200 : 2500 }, cam);
    for (let i = 0; i < 40; i++) {
      const before = S.saved();
      S.preRender(cam);
      const mid = S.saved();
      if (S.flash > 0 && !same(before, mid)) flashed++;
      if (S.mesh && S.mesh.visible) boltSeen++;
      maxF = Math.max(maxF, S.flash);
      S.postRender();
      const after = S.saved();
      if (same(before, after)) restored++; else bad++;
      frames++;
      S.tick(1 / 60, cam);
    }
  }
  ck('flash changes the lights / sky / fog during the render', flashed > 20 && maxF > 1, { flashed, maxF: +maxF.toFixed(2) });
  ck('every value restored exactly after every render', bad === 0 && restored === frames, { restored, bad, frames });
  ck('bolt visible during bolt strikes', boltSeen > 6, boltSeen);
  ck('bolt hidden once the strike is over', !S.s.on && (S.preRender(cam), S.postRender(), !S.mesh.visible));
  // the live game: 4 s of real frames with strikes, then compare at rest
  d.game.paused = false;
  await sleep(300);
  S.strike({ kind: 'cc', d: 3000 }, cam);
  await sleep(500);
  const rest0 = S.saved();
  for (let i = 0; i < 6; i++) { S.strike({ kind: i % 2 ? 'near' : 'bolt', d: i % 2 ? 300 : 2000 }, cam); await sleep(450); }
  await sleep(600);
  const rest1 = S.saved();
  ck('live frames: values at rest after 6 strikes = before', same(rest0, rest1), same(rest0, rest1) ? undefined : { rest0, rest1 });
  d.game.paused = true;
  // clear weather: preRender touches nothing at all
  window.__weather = 'clear';
  await sleep(700);
  S.s.on = false;
  const m0 = S.stats.modFrames;
  for (let i = 0; i < 10; i++) { S.preRender(cam); S.postRender(); }
  ck('clear: nothing modulated (no save, no write)', S.stats.modFrames === m0 && W.cur.storm === 0);
  const sc0 = S.stats.strikes;
  for (let i = 0; i < 1200; i++) S.tick(0.05, cam);
  ck('clear: no strikes in 60 s', S.stats.strikes === sc0);

  // ---- 5. spray: only wet and moving, stops when dry, under the caps
  const road = d.traffic.cars.filter((v) => v.spec && v.spec.roadCar && d.city.onRoad(v.x, v.z, 1.5));
  ck('traffic cars on the road to test with', road.length >= 3, road.length);
  const keepV = road.map((v) => v.vLong);
  const onFoot = { onFoot: true };
  const run = (cars, secs, set) => {
    const e0 = SP.emitted; let maxA = 0, maxC = 0;
    for (let i = 0; i < secs / 0.033; i++) {
      if (set != null) for (const v of cars) v.vLong = set;
      cam.position.set(cars[0].x, cars[0].y + 3, cars[0].z + 8);
      SP.update(0.033, onFoot, cars, cam);
      maxA = Math.max(maxA, SP.alive); maxC = Math.max(maxC, SP.cars);
    }
    return { n: SP.emitted - e0, maxA, maxC };
  };
  // dry
  window.__weather = 'clear'; await sleep(300);
  W.wet = 0; W.cover = 0;
  const dry = run(road.slice(0, 1), 2, 22);
  ck('dry road, moving: no spray', dry.n === 0, dry);
  // wet, standing
  window.__weather = 'rain'; await sleep(400);
  ck('rain: the ground is wet', W.wet > 0.9, W.wet);
  const still = run(road.slice(0, 1), 2, 0);
  ck('wet road, standing: no spray', still.n === 0, still);
  SP.light = 1;
  const slow = run(road.slice(0, 1), 2, 6), fast = run(road.slice(0, 1), 2, 28);
  ck('wet road, moving: spray, more with speed', slow.n > 0 && fast.n > slow.n * 1.8, { slow: slow.n, fast: fast.n });
  // a bus throws more than a car (same speed)
  {
    const r0 = road[0], hd = r0.heading;
    const car = d.traffic.spawnAt(r0.x, r0.z, hd, 'civic', 0x3366aa, 'apron');
    const bus = d.traffic.spawnAt(r0.x, r0.z, hd, 'bus', 0xffffff, 'apron');
    const a = run([car], 3, 20), b = run([bus], 3, 20);
    ck('a heavy vehicle throws more (a bus vs a car at 20 m/s)', b.n > a.n * 1.4, { car: a.n, bus: b.n });
    d.traffic.remove(car); d.traffic.remove(bus);
  }
  // the caps: every test car brought to the first one's spot (on its road), all moving
  const keepXZ = road.map((v) => [v.x, v.z]);
  road.forEach((v, i) => { v.x = road[0].x + (i % 4) * 0.3; v.z = road[0].z + Math.floor(i / 4) * 0.3; });
  const many = run(road, 3, 25);
  road.forEach((v, i) => { v.x = keepXZ[i][0]; v.z = keepXZ[i][1]; });
  ck('caps: ' + road.length + ' cars in range -> ' + SP.maxCars + ' throw spray, particles <= ' + SP.cap,
    many.maxC === Math.min(road.length, SP.maxCars) && many.maxA <= SP.cap, many);
  ck('the pool fills to the cap and never past it', SP.stats.maxAlive <= SP.cap && (road.length < SP.maxCars || SP.stats.maxAlive >= SP.cap * 0.9), SP.stats);
  // dries: emission stops; the pool empties and the draw goes away
  window.__weather = 'clear'; await sleep(300);
  W.wet = 0; W.cover = 0;
  const dried = run(road.slice(0, 1), 2, 25);
  ck('dried out: spray stops, pool empty, no draw', dried.n === 0 && SP.alive === 0 && SP.points.visible === false, { ...dried, alive: SP.alive });
  // slush in snow
  window.__weather = 'snow'; await sleep(400);
  const sl = run(road.slice(0, 1), 2, 22);
  let grey = true, nl = 0;
  for (let i = 0; i < SP.cap; i++) if (SP.P[i * 16 + 6] > 0) { nl++; if (SP.P[i * 16 + 13] >= 1.0) grey = false; }   // slush (<= 0.9) is greyer than rain (>= 1.13)
  ck('snow lying: grey slush thrown', sl.n > 0 && nl > 0 && grey && W.cover > 0.9, { n: sl.n, cover: W.cover });
  road.forEach((v, i) => { v.vLong = keepV[i]; });
  // __noSpray
  window.__noSpray = true;
  const off = run(road.slice(0, 1), 1, 22);
  ck('__noSpray: nothing', off.n === 0);
  window.__noSpray = false;
  window.__weather = 'clear';
  await sleep(300);
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  out.push(fails ? 'FAILED ' + fails : 'ALL PASS');
  return out.join('\n');
})()
