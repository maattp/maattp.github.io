// Auto KW: the time of day (src/tod.js), checked end to end. PASS / FAIL per
// line, and a summary.
//
//   VIEW_PROBE_FILE=tools/kw/nightprobe.js AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     AUTO_GPU=1 [AUTO_PHONE=1] node tools/kw/kwshots.mjs /tmp/x
//
// On master (no tod.js) it prints `SNAP <json>`: the lights, fog, sky
// uniforms and shadow state the game boots with. That snapshot is
// tools/kw/nightmaster.json, and on this build:
//   day        Day (the default) is master's snapshot to the bit, the shader
//              branches off (todOn 0), no relight, the shadow pass running,
//              every life factor exactly 1
//   settings   night / dusk / real / an hour each apply (window.__tod), and
//              the pause menu's buttons save autokw-tod
//   real       the real clock follows a mocked Date: 03:00 night, 12:00 day,
//              Waterloo's sunset (~18:20 in late October) dusk, and moves on
//              its own as the mocked clock runs
//   night      lit windows (the fraction lit), lamp pools picked near the
//              view, your headlamps' beam, tail lamps, the shadow pass gone
//              (autoUpdate off), the sky dark with stars
//   draws      the scene pass at night vs day at the same pose: at most +2
//              (the shadow pass is skipped, so usually fewer)
(async () => {
  const d = window.__dbg;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const hex = (c) => c.getHexString();
  const snap = () => {
    const S = d.world.skyUniforms, o = {};
    for (const k of Object.keys(S).sort()) {
      if (k === 'time' || k === 'tCloud' || k.startsWith('tod') || k === 'moonDir') continue;
      const v = S[k].value;
      o['sky.' + k] = v && v.isColor ? [v.r, v.g, v.b] : v && v.isVector3 ? [v.x, v.y, v.z] : v;
    }
    let hemi = null, amb = null;
    d.scene.traverse((x) => { if (x.isHemisphereLight) hemi = x; if (x.isAmbientLight) amb = x; });
    const f = d.scene.fog;
    Object.assign(o, {
      sun: d.sun.intensity, sunCol: hex(d.sun.color), hemi: hemi.intensity, hemiSky: hex(hemi.color), hemiGround: hex(hemi.groundColor),
      amb: amb.intensity, ambCol: hex(amb.color), fog: [f.color.r, f.color.g, f.color.b],
      shadowAuto: d.renderer.shadowMap.autoUpdate, env: d.scene.environment ? d.scene.environment.uuid ? 'set' : 'set' : 'none',
    });
    return o;
  };
  if (!window.__todInfo) { d.game.paused = true; await wait(600); return 'SNAP ' + JSON.stringify(snap()); }

  const T = window.__todInfo, out = [];
  let fails = 0;
  const check = (name, ok, info) => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };
  check('shader block compiled', T.ok);
  d.game.paused = true;
  window.__tod = 'day';
  await wait(600);

  // --- day is master --------------------------------------------------------
  let M = null;
  try { M = await (await fetch('/tools/kw/nightmaster.json', { cache: 'no-store' })).json(); } catch (e) { M = null; }
  if (!M) check('master snapshot', false, 'tools/kw/nightmaster.json missing');
  else {
    const S = snap(), bad = [];
    for (const k of Object.keys(M)) if (JSON.stringify(M[k]) !== JSON.stringify(S[k])) bad.push(k);
    check('day: lights, fog, sky uniforms = master', !bad.length, bad.length ? 'differ: ' + bad.join(', ') : `${Object.keys(M).length} values`);
  }
  const K = T.k;
  check('day: shader branches off, nothing relit', !T.on && K.win === 0 && K.winB === 0 && K.tail === 0 && K.head === 0 && K.basic === 1 && K.road === 0 && T.relights === 0,
    `relights ${T.relights}`);
  check('day: life factors exactly 1', K.peds === 1 && K.traffic === 1);
  check('day: shadow pass runs', d.renderer.shadowMap.autoUpdate === true && !T.shadowsOff);

  // --- the settings -----------------------------------------------------------
  const cam = d.camera;
  const pose = () => { cam.position.set(-3822, d.G.terrainHeight(-3822, -1405) + 2, -1405); cam.lookAt(-3850, d.G.terrainHeight(-3850, -1470) + 2, -1470); cam.updateMatrixWorld(); };
  pose();
  await wait(500);
  const dayCalls = d.sceneStats ? d.sceneStats.calls : 0;
  window.__tod = 'night';
  await wait(1500);
  check('night applies', T.on && T.night === 1 && T.el < -18, `el ${T.el.toFixed(1)} hour ${T.hour}`);
  check('night: windows lit', K && T.k.winB === 1 && T.k.win > 0.25 && T.k.win < 0.65, `lit fraction ${T.k.win.toFixed(2)}`);
  check('night: lamp pools near the view', T.lamps >= 4, `${T.lamps} lamps`);
  check('night: tail lamps, headlamps on', T.k.tail === 1 && T.k.head === 1);
  check('night: shadow pass skipped', T.shadowsOff && d.renderer.shadowMap.autoUpdate === false);
  check('night: fewer walkers, traffic a little thinner', T.k.peds < 1 && T.k.traffic <= 1, `peds x${T.k.peds.toFixed(2)} traffic x${T.k.traffic.toFixed(2)}`);
  check('night: IBL relit', T.relights >= 1, `relights ${T.relights}`);
  const S = d.world.skyUniforms;
  const zl = S.zenith.value.r + S.zenith.value.g + S.zenith.value.b;
  check('night: dark sky with stars', zl < 0.05 && S.todStars.value === 1, `zenith ${zl.toFixed(3)}`);
  const nightCalls = d.sceneStats ? d.sceneStats.calls : 0;
  check('night draws vs day (same pose): at most +2', nightCalls <= dayCalls + 2, `day ${dayCalls} night ${nightCalls}`);
  window.__tod = 'dusk';
  await wait(800);
  check('dusk applies', T.on && T.dusk === 1 && T.night === 0 && !T.shadowsOff, `el ${T.el.toFixed(1)} az ${T.az.toFixed(0)} hour ${T.hour.toFixed(2)}`);
  window.__tod = 2;
  await wait(500);
  check('an hour (2:00) applies', T.mode === 2 && T.night === 1 && T.k.traffic < 1, `traffic x${T.k.traffic.toFixed(2)} win ${T.k.win.toFixed(2)}`);

  // --- the real clock, on a mocked Date ---------------------------------------
  const RealDate = Date;
  let fake = new RealDate(2026, 9, 22, 3, 0, 0).getTime();
  window.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(fake); } static now() { return fake; } };
  const realAt = async (h, m) => { fake = new RealDate(2026, 9, 22, h, m, 0).getTime(); window.__tod = 'day'; await wait(300); window.__tod = 'real'; await wait(500); };
  await realAt(3, 0);
  check('real 03:00 is night', T.mode === 'real' && T.night === 1, `el ${T.el.toFixed(1)}`);
  await realAt(12, 0);
  check('real 12:00 is day (the game\'s day)', !T.on && T.el > 25, `el ${T.el.toFixed(1)}`);
  await realAt(18, 15);
  const e1 = T.el;
  check('real 18:15 is dusk (sunset ~18:20 at Waterloo, Oct 22)', T.on && T.dusk > 0.5 && Math.abs(T.el) < 4, `el ${T.el.toFixed(2)} az ${T.az.toFixed(0)}`);
  // the clock runs on: the sun keeps sinking without touching the setting
  fake += 20 * 60 * 1000;
  d.game.paused = true;
  await wait(11500);
  check('real clock moves on its own', T.el < e1 - 2, `${e1.toFixed(2)} -> ${T.el.toFixed(2)}`);
  window.Date = RealDate;

  // --- the setting ------------------------------------------------------------
  const btn = document.querySelector('[data-tod="dusk"]');
  if (btn) btn.click();
  let saved = null;
  try { saved = localStorage.getItem('autokw-tod'); } catch (e) { /* */ }
  check('menu saves autokw-tod', saved === 'dusk' && btn.classList.contains('on'));
  const b2 = document.querySelector('[data-tod="day"]');
  if (b2) b2.click();
  window.__tod = 'day';
  await wait(600);
  check('back to day: shadow pass runs again', d.renderer.shadowMap.autoUpdate === true && !T.on);
  if (M) {
    const S2 = snap(), bad = [];
    for (const k of Object.keys(M)) if (JSON.stringify(M[k]) !== JSON.stringify(S2[k])) bad.push(k);
    check('back to day: = master again', !bad.length, bad.length ? 'differ: ' + bad.join(', ') : '');
  }
  return out.join('\n') + `\n${fails ? 'FAIL' : 'ALL OK'} (${out.length - fails} ok, ${fails} failed)`;
})()
