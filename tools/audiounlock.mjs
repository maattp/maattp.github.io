// Does the sound start on the FIRST touch, the way an iPhone decides it?
//
//   AUTO_HTTP_PORT=8000 [AUTO_GPU=1] node tools/audiounlock.mjs [--bench]
//
// --bench first times the sound bank (whole, and each sound alone) on a paused
// game. Use AUTO_GPU=1: on SwiftShader a frame takes ~0.5 s and every render
// batch waits for one, which measures the harness, not the audio.
//
// Launches Chrome with the autoplay policy a phone enforces (a context may
// only start inside user activation, and a touch's pointerdown / touchstart is
// NOT activation -- only its touchend / pointerup / click are), boots the game
// on the phone profile, then drives the joystick with real CDP touch events:
// press, hold, release. Prints the AudioContext's state and whether the sound
// bank is ready after each step. The bug this pins: the unlock listened for
// pointerdown only and removed itself, so walking with the stick never
// started the audio; it started later, all at once, on some unrelated tap.
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome } from './chrome.mjs';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9471;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-unlock-${PORT}`, width: 874, height: 402,
  extra: ['--autoplay-policy=document-user-activation-required'] });
let code = 0;
try {
  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl);
    } catch (e) { /* not up yet */ }
  }
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
  await send('Page.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 400; i++) { await sleep(250); if (await ev('!!(window.__dbg && window.__dbg.sceneStats && window.__dbg.sceneStats.calls > 0)')) break; }
  await sleep(1500);
  const state = (label) => ev(`(() => { const a = window.__dbg.audio; return JSON.stringify({ step: ${JSON.stringify(label)},
    ctx: a.ctx ? a.ctx.state : 'none', bank: a.bank ? Object.keys(a.bank).length : 0 }); })()`);
  if (process.argv.includes('--bench')) {
    // what the bank really costs: paused game, a GPU page, each sound alone
    console.log(await ev(`(async () => { const m = await import('./src/audio.js'); window.__dbg.game.paused = true;
      await window.__dbg.audio.bankReady; await new Promise((r) => setTimeout(r, 500));
      let t = performance.now(); await new Promise((r) => setTimeout(r, 0)); const t0 = performance.now() - t;
      t = performance.now(); const b = await m.renderBank(48000); const whole = performance.now() - t;
      const per = [];
      for (const n of Object.keys(b)) { const q = performance.now(); await m.renderBank(48000, [n]); per.push([n, Math.round(performance.now() - q)]); }
      per.sort((a, c) => c[1] - a[1]);
      return JSON.stringify({ setTimeout0: +t0.toFixed(1), wholeBankMs: Math.round(whole), slowest: per.slice(0, 10), sumMs: per.reduce((a, p) => a + p[1], 0) }); })()`));
  }
  const rows = [];
  rows.push(await state('booted, untouched'));
  // the stick zone: bottom-left quarter of the screen
  const x = 874 * 0.18, y = 402 * 0.72;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(300);
  rows.push(await state('stick pressed (touchstart / pointerdown)'));
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 40, y: y - 30, id: 1 }] });
  await sleep(600);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
  rows.push(await state('stick released (touchend / pointerup)'));
  // how long until the bank exists, from the release
  const tb = Date.now();
  for (let i = 0; i < 120 && !(await ev('!!(window.__dbg.audio.bank && Object.keys(window.__dbg.audio.bank).length)')); i++) await sleep(250);
  rows.push(await state(`bank wait ${((Date.now() - tb) / 1000).toFixed(1)} s after release`));
  rows[rows.length - 1] = rows[rows.length - 1].replace('}', `,"steps":${await ev('!!window.__dbg.audio.bank.step_hard')}}`);
  rows.push(await ev(`JSON.stringify({ step: 'bank', ms: window.__dbg.audio.bankMs })`));
  for (const r of rows) console.log('  ' + r);
  const atRelease = JSON.parse(rows[2]), last = JSON.parse(rows[3]);
  const ok = atRelease.ctx === 'running' && last.bank > 0;
  console.log(ok ? 'OK: running the moment the first touch lifts, bank ready' : 'FAIL: audio not running when the first touch lifts');
  if (!ok) code = 1;
  // iOS stops a running context behind the page's back (the home screen, a
  // call, Siri) and reports it as 'interrupted', a state Chrome never uses.
  // resume() only ever acted on 'suspended', so on the iPhone the game stayed
  // silent from then on. Suspend it and make it SAY 'interrupted', the way iOS
  // would, then tap once more: it must come back.
  await ev(`(async () => { const c = window.__dbg.audio.ctx; await c.suspend();
    Object.defineProperty(c, 'state', { configurable: true, get() { return 'interrupted'; } });
    const r = c.resume.bind(c);
    c.resume = () => { delete c.state; return r(); };
    return 1; })()`);
  await sleep(300);
  const stopped = JSON.parse(await state('context interrupted, as iOS reports it'));
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 2 }] });
  await sleep(150);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
  const back = JSON.parse(await state('tapped again'));
  console.log('  ' + JSON.stringify(stopped) + '\n  ' + JSON.stringify(back));
  const ok2 = stopped.ctx !== 'running' && back.ctx === 'running';
  console.log(ok2 ? 'OK: a later tap restarts a context the system stopped' : 'FAIL: a stopped context stays stopped after a tap');
  if (!ok2) code = 1;
} catch (e) {
  console.error(e); code = 1;
} finally {
  chrome.kill();
}
process.exit(code);
