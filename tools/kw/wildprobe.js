// Auto KW wildlife probe (kwwildlife.js). AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/wildprobe.js node tools/kw/kwshots.mjs /tmp/x
// (VIEW_THROTTLE=8 for the phone stand-in timing). Prints a JSON report; every `ok` must be true.
(async () => {
  const d = __dbg, W = d.wildlife, R = { ok: {} };
  const ok = (k, v) => { R.ok[k] = !!v; };
  W.hold = false;
  d.tod.choose('dusk');
  // ---- A. a V that lands on Silver Lake, sits, lifts off
  W.tp(-4372, -1640); d.camera.position.set(-4372, 90, -1640);
  W.formations.length = 0;
  const F = W.spawnV({ n: 14, land: true, alt: 90 });
  R.target = F.target;
  ok('landTarget', !!F.target);
  let sat = 0, t = 0;
  for (; t < 90 && F.mode !== 'sit'; t += 0.1) W.sim(0.1, 0.1);
  R.timeToSit = +t.toFixed(1); R.mode = F.mode;
  ok('landed', F.mode === 'sit' && F.birds.every((b) => b.mode === 'sit'));
  ok('sitDraw', W.sit.visible && W.sit.count === 14);
  ok('rings', W.ringList.length > 0 || (W.rings && W.rings.count > 0));
  const onWater = F.birds.every((b) => W.water(b.x, b.z) !== null);
  ok('onWater', onWater);
  F.sitT = 0.1; W.sim(1, 0.1);
  ok('liftoff', F.mode === 'leave');
  for (let i = 0; i < 400 && W.formations.includes(F); i++) W.sim(0.5, 0.1);
  ok('gone', !W.formations.includes(F));
  // ---- B. a deer crossing a rural road; a car hits it
  let road = null, rfwd = [0, 1];
  for (let i = 0; i < 80000 && !road; i++) {
    const x = -6000 + Math.random() * 12000, z = -9500 + Math.random() * 6500;
    if (!(d.city.onRoad(x, z, 0.5) && d.city.builtAt(x, z) < 0.09)) continue;
    for (let k = 0; k < 32; k++) {
      const a = k * Math.PI / 16, fx = Math.sin(a), fz = Math.cos(a);
      if ([30, 60, 90, 120, 150].every((m) => d.city.onRoad(x + fx * m, z + fz * m, 2.5))) { road = [x, z]; rfwd = [fx, fz]; break; }
    }
  }
  R.road = road;
  let attempts = 0, hitAny = false;
  while (road && attempts < 8 && !hitAny) {
    attempts++;
    const [rx, rz] = road;
    W.tp(rx, rz); W.herds.length = 0; W.crossCd = 0; W.pv = 20; W.fwd = rfwd;
    const veh = { x: rx, y: 0, z: rz, vLong: 20, halfLen: 2.3, halfWid: 0.95, dead: false, hp: 0, damage(n) { this.hp += n; return true; } };
    W.player.vehicle = veh; const wasFoot = W.player.onFoot; W.player.onFoot = false;
    let H = null;
    for (let i = 0; i < 60 && !H; i++) { Math.random = (() => { const r = Math.random; return () => r(); })(); W._tryCross(W.player, veh, { x: rx, z: rz }); H = W.herds.find((h) => h.cross); W.crossCd = 0; }
    R.crosserSpawned = !!H;
    if (H) {
      const dd = H.deer[0];
      R.cross = { st: dd.st, hw: dd.cross.hw };
      const tr = { crossXZ: new Float32Array(48), crossN: 0 };
      // car approaches along +z: put it 50 m short of the crossing
      veh.x = dd.cross.ax - rfwd[0] * 50; veh.z = dd.cross.az - rfwd[1] * 50;
      W.last = [veh.x, veh.z];
      W.herds.forEach((h) => h.deer.forEach((q) => { q.t = 99; }));
      let fed = 0, hit = false;
      for (let i = 0; i < 80; i++) {
        veh.x += rfwd[0] * 1; veh.z += rfwd[1] * 1; W.player.vehicle = veh;
        W.player.x = veh.x; W.player.z = veh.z;
        W.sim(0.05, 0.05);
        tr.crossN = 0; W.feedTraffic(tr); if (tr.crossN > 0) fed++;
        if (dd.st === 'hit') { hit = true; break; }
      }
      R.fed = fed; R.hp = veh.hp; R.hits = W.stats.hits;
      R.trafficSeesDeer = fed > 0;
      if (hit && veh.hp > 5) { hitAny = true; W.sim(2.5, 0.05); ok('bolts', dd.st === 'flee' || !H.deer.includes(dd)); }
    }
    W.player.vehicle = null; W.player.onFoot = true; W.pv = 0;
  }
  ok('crosserSpawned', R.crosserSpawned); ok('trafficSeesDeer', R.trafficSeesDeer); ok('hit', hitAny); R.attempts = attempts;
  // ---- C. squirrels on a lawn
  W.herds.length = 0; W.formations.length = 0;
  W.tp(-4372, -1640); d.camera.position.set(-4372, 3, -1640);
  d.world.update(-4372, -1640, 60);
  for (let i = 0; i < 1500 && [...d.world.chunks.values()].some((c) => c.lod !== c.wantLod); i++) d.world.update(-4372, -1640, 60);
  await new Promise((r) => setTimeout(r, 2500));
  for (let i = 0; i < 120 && W.sq.length < 3; i++) { W.sqT = 0; W.sim(0.5, 0.1); }
  R.squirrels = W.sq.length;
  ok('squirrels', W.sq.length >= 1);
  if (W.sq.length) {
    const s = W.sq[0];
    W.player.x = s.x + 4; W.player.z = s.z; W.last = null;
    W.sim(0.2, 0.05);
    R.sqState = s.st;
    ok('sqDash', s.st === 'dash' || s.st === 'climb');
    W.sim(4, 0.05);
    ok('sqClimbed', !W.sq.includes(s) || s.st === 'hide' || s.st === 'climb');
  }
  // ---- D. cost: everything alive at once, update ms
  W.herds.length = 0; W.formations.length = 0; W.sq.length = 0;
  W.tp(-3829, -1350);
  W.spawnV({ n: 25, land: false }); W.spawnFlock(-3829 + 200, -1350, 'starling');
  for (let i = 0; i < 3; i++) W.spawnDeer(-3829 + i * 30, -1350 - 100, 4, {});
  for (let i = 0; i < 5; i++) W.sq.push({ x: -3829 + i, z: -1340, y: d.G.terrainHeight(-3829, -1340), h: 0, st: 'hop', t: 9, tx: -3829, tz: -1340, th: 8, pitch: 0, hop: 0, ph: 0, dark: i == 0, climb: 0 });
  W.hold = false; W.sim(1, 0.05);
  const N = 300, t0 = performance.now();
  for (let i = 0; i < N; i++) W.update(0.016, W.player, W.camera);
  R.updateMs = +((performance.now() - t0) / N).toFixed(3);
  R.info = W.info();
  R.errors = W.err;
  ok('noErrors', W.err === 0);
  return JSON.stringify(R, null, 1);
})()
