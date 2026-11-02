// Night-sky probe (nightsky.js). Run:
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/skyprobe.js node tools/kw/kwshots.mjs /tmp/x
// Prints PASS/FAIL per check. The pixel proof is tools/kw/skypix.py over two
// shots (aurora-street with and without __noSky).
(async () => {
  const d = window.__dbg, S = d.sky, out = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ck = (n, ok, x) => out.push((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? ' ' + JSON.stringify(x) : ''));
  d.game.paused = false;
  window.__weather = 'clear';
  // camera north-facing, fixed
  const face = () => { d.camera.position.set(-3828, 80, -1438); d.camera.lookAt(-3828, 130, -1900); d.camera.updateMatrixWorld(true); };
  // day: nothing visible, however it is forced
  window.__tod = 'day'; S.aurora(true); S.flying = 0;
  await sleep(1500);
  ck('day: aurora mesh hidden', S.aur.visible === false);
  ck('day: star mesh hidden', S.star.visible === false);
  // night, clear, forced
  window.__tod = 'night'; S.aurora(true);
  await sleep(2500);
  ck('night/clear/forced: aurora visible', S.aur.visible === true && S.k > 0.5, S.k);
  S.shoot(d.camera); S.flying = 0.8;
  await sleep(120);
  const c1 = d.sceneStats.calls, t1 = d.sceneStats.tris;
  ck('shooting star flying', S.star.visible === true);
  window.__noSky = true;
  await sleep(600);
  const c0 = d.sceneStats.calls, t0 = d.sceneStats.tris;
  ck('__noSky hides both', S.aur.visible === false && S.star.visible === false);
  ck('__noSky removes the draws', c1 - c0 >= 1 && c1 - c0 <= 2, { on: c1, off: c0, tris: t1 - t0 });
  window.__noSky = false;
  await sleep(1500);
  ck('__noSky off again: aurora back', S.aur.visible === true);
  // overcast kills it
  window.__weather = 'overcast';
  await sleep(6000);
  ck('overcast: aurora fades out', S.aur.visible === false, S.k);
  window.__weather = 'clear';
  S.aurora(null);
  // the roll is deterministic per night
  const m = await import('/apps/autokw/src/nightsky.js');
  let n = 0; const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 365; i++) if (m.auroraNight(new Date(base + i * 864e5))) n++;
  ck('aurora nights per year ~1 in 6 (46-76)', n >= 46 && n <= 76, n);
  const nm = m.moonPhase(new Date(Date.UTC(2026, 10, 9, 7, 0)));     // new moon 2026-11-09 ~07:00 UTC
  ck('moon phase: new moon 2026-11-09 (+-0.9 day: the mean synodic phase)', nm < 0.03 || nm > 0.97, nm);
  const fm = m.moonPhase(new Date(Date.UTC(2026, 10, 24, 14, 0)));   // full moon 2026-11-24 ~14:00 UTC
  ck('moon phase: full moon 2026-11-24', Math.abs(fm - 0.5) < 0.02, fm);
  return out.join('\n');
})()
