// Auto KW: the weather (src/weather.js), checked end to end. PASS / FAIL per
// line, and a summary.
//
//   VIEW_PROBE_FILE=tools/kw/weatherprobe.js AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     AUTO_GPU=1 [AUTO_PHONE=1] node tools/kw/kwshots.mjs /tmp/x
//
//   states      each of clear / overcast / rain / drizzle / snow / fog, snapped
//               by `window.__weather`, reaches its mix; clear is exactly the
//               dry city (every factor 1, no precipitation draw, shaders off);
//               rain and snow draw ONE precipitation mesh from the street and
//               none from 400 m up
//   transition  the menu's change (choose: smooth) runs with the game
//               unpaused and settles -- clear -> rain -> snow -> clear, each
//               inside 30 s of game time
//   grip        a sedan's 100-0 (drivetest.mjs's flat bench): longer in rain,
//               much longer in snow; the AI's pace and the walkers' cap fall
//   setting     the pause menu's buttons save autokw-weather and light the
//               chosen one (restored to Auto at the end)
//   draws       the scene pass's draw count clear vs rain (+1 at most)
(async () => {
  const d = window.__dbg, W = window.__wx;
  const out = [];
  let fails = 0;
  const check = (name, ok, info) => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  if (!W) return 'FAIL  no window.__wx (weather.js not booted)';
  check('shader block compiled', W.ok);

  // --- states ---------------------------------------------------------------
  const T = {
    clear: { over: 0, rain: 0, snow: 0, fog: 0 }, overcast: { over: 1, rain: 0, snow: 0 },
    rain: { over: 1, rain: 1, snow: 0 }, drizzle: { rain: 0.35 }, snow: { over: 1, snow: 1, rain: 0 }, fog: { fog: 1 },
  };
  d.game.paused = true;
  for (const s of Object.keys(T)) {
    window.__weather = s;
    await wait(400);
    const c = W.cur, bad = Object.keys(T[s]).filter((k) => !near(c[k], T[s][k]));
    check(`state ${s}`, W.state === s && !bad.length, bad.length ? 'off: ' + bad.join(',') : `fogK ${W.k.fogK.toFixed(2)} head ${W.k.head.toFixed(2)}`);
    if (s === 'clear') {
      const k = W.k;
      check('clear is the dry city', k.mu === 1 && k.ai === 1 && k.aiLat === 1 && k.peds === 1 && k.fogK === 1 && k.head === 0 && W.draws === 0 && c.wet === 0 && c.cover === 0,
        JSON.stringify(k));
    }
    if (s === 'rain' || s === 'snow') {
      check(`${s}: one precipitation draw at street level`, W.draws === 1, `draws ${W.draws}`);
      check(`${s}: ground ${s === 'rain' ? 'wet' : 'white'}`, s === 'rain' ? c.wet === 1 : c.cover === 1, `wet ${c.wet} cover ${c.cover}`);
    }
  }
  // the scene's draws, clear vs rain, at the same pose
  window.__weather = 'clear'; await wait(500);
  const dClear = d.sceneStats.calls;
  window.__weather = 'rain'; await wait(500);
  const dRain = d.sceneStats.calls;
  check('rain adds at most one draw', dRain - dClear <= 1 && dRain - dClear >= 0, `clear ${dClear} rain ${dRain}`);
  // from the air the precipitation goes
  {
    const cam = d.camera, p = cam.position.clone();
    const gy = d.G.terrainHeight(p.x, p.z);
    // the frame's own camera code is paused: pose it, draw, look
    cam.position.y = gy + 400; cam.updateMatrixWorld(true);
    await wait(300);
    check('no precipitation from 400 m up', W.draws === 0, `draws ${W.draws}`);
    cam.position.copy(p); cam.updateMatrixWorld(true);
  }

  // --- transitions (the game running) ------------------------------------------
  window.__weather = 'clear'; await wait(300);
  const ride = async (to, maxS) => {
    W.choose(to);
    const t0 = performance.now();
    while (!W.done && performance.now() - t0 < maxS * 1000) await wait(250);
    return (performance.now() - t0) / 1000;
  };
  d.game.paused = false;
  for (const [to, chk] of [['rain', () => W.cur.rain === 1 && W.cur.wet === 1], ['snow', () => W.cur.snow === 1 && W.cur.cover === 1 && W.cur.rain === 0], ['clear', () => W.cur.over === 0 && W.cur.cover === 0 && W.cur.wet === 0]]) {
    // (headless rAF is slow: allow 4x the game time)
    const s = await ride(to, 120);
    check(`transition to ${to} settles`, W.done && chk(), `${s.toFixed(1)} s wall  ${JSON.stringify(W.cur)}`);
  }
  d.game.paused = true;

  // --- grip -----------------------------------------------------------------------
  {
    const city = d.city, DT = 1 / 60, KMH = 3.6;
    const ga = city.groundAt, rl = city.roadLift, rm = city.rampMask;
    city.groundAt = () => 0; city.roadLift = () => 0; city.rampMask = null;
    const stop = () => {
      const v = d.traffic.spawnAt(0, 0, 0, 'sedan', 0x808080, 'free');
      v.setDetailed(true); v.y = 0;
      for (let i = 0; i < 3; i++) v.update(DT, { throttle: 0, brake: 0, steer: 0 });
      v.vLong = 100 / KMH; v.vLat = 0; v.yawRate = 0;
      let dist = 0;
      for (let i = 0; i < 60 * 30 && v.vLong > 0.05; i++) {
        const b = v.vLong;
        v.update(DT, { throttle: 0, brake: 1, steer: 0 });
        dist += ((b + Math.max(v.vLong, 0)) / 2) * DT;
      }
      const mu = v.mu;
      d.traffic.remove(v);
      return { dist, mu };
    };
    const res = {};
    try {
      for (const s of ['clear', 'rain', 'snow']) {
        window.__weather = s; await wait(300);
        res[s] = { ...stop(), k: W.k };
      }
    } finally { city.groundAt = ga; city.roadLift = rl; city.rampMask = rm; }
    const f = (r) => `${r.dist.toFixed(1)} m (mu ${r.mu.toFixed(2)})`;
    check('grip: rain stops longer than dry', res.rain.dist > res.clear.dist * 1.08, `${f(res.clear)} -> ${f(res.rain)}`);
    check('grip: snow stops much longer', res.snow.dist > res.clear.dist * 1.4, `${f(res.clear)} -> ${f(res.snow)}`);
    check('AI slows in rain and more in snow', res.rain.k.ai < 1 && res.snow.k.ai < res.rain.k.ai && res.snow.k.aiLat < res.rain.k.aiLat,
      `ai ${res.rain.k.ai.toFixed(2)} / ${res.snow.k.ai.toFixed(2)}, corners ${res.rain.k.aiLat.toFixed(2)} / ${res.snow.k.aiLat.toFixed(2)}`);
    check('fewer walkers in the rain', res.rain.k.peds < 0.6 && res.snow.k.peds < 1, `peds x${res.rain.k.peds.toFixed(2)} rain, x${res.snow.k.peds.toFixed(2)} snow`);
    check('headlights on in rain and snow', res.rain.k.head === 1 && res.snow.k.head === 1 && res.clear.k.head === 0);
  }

  // --- the setting --------------------------------------------------------------
  {
    const btn = (v) => document.querySelector(`[data-weather="${v}"]`);
    let saved = null;
    btn('snow').click();
    try { saved = localStorage.getItem('autokw-weather'); } catch (e) { saved = 'unreadable'; }
    check('setting saves (Snow)', saved === 'snow' && btn('snow').classList.contains('on') && W.setting === 'snow', `autokw-weather = ${saved}`);
    btn('auto').click();
    try { saved = localStorage.getItem('autokw-weather'); } catch (e) { saved = 'unreadable'; }
    check('setting saves (Auto, restored)', saved === 'auto' && W.setting === 'auto', `autokw-weather = ${saved}`);
  }
  window.__weather = 'clear';
  await wait(300);
  out.push(fails ? `${fails} FAILED` : 'ALL PASS');
  return out.join('\n');
})()
