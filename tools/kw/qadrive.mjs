// Auto KW: drive UNFORCED for a while with real key events, at a time of day, collecting exceptions
// and screenshots. A route comes from the taxi's A* (`taxi.pathJob`); a pursuit controller presses
// W / A / D / S through CDP Input.dispatchKeyEvent. Nothing is teleported mid-leg.
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 [TOD=dusk|night|real] [LEG_MS=90000] [PHONE=1] node tools/kw/qadrive.mjs <outdir>
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9527;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8227;
const OUT = process.argv[2] || '/tmp/qadrive';
const TOD = process.env.TOD || 'dusk';
const LEG_MS = +process.env.LEG_MS || 90000;
const PHONE = process.env.PHONE === '1';
const [W, H] = PHONE ? [874, 402] : [1280, 720];
const LEGS = [
  [[-3858, -1585], [-4205, -1345]],   // Uptown -> the UW end
  [[-4205, -1345], [-4492, -2962]],   // UW -> WCI
  [[-1138, 238], [-948, 357]],        // King St Kitchener
];
const KEYS = { KeyW: ['w', 87], KeyA: ['a', 65], KeyD: ['d', 68], KeyS: ['s', 83] };

const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-shots-profile-${PORT}`, width: W, height: H, extra: ['--autoplay-policy=no-user-gesture-required'] });
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* */ }
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map(); const errs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception');
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errs.push(m.params.type + ': ' + (m.params.args || []).map((a) => a.value || a.description).join(' ').slice(0, 300));
  });
  const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.result?.value;
  };
  const held = new Set();
  const setKey = async (code, on) => {
    if (on === held.has(code)) return;
    on ? held.add(code) : held.delete(code);
    const [k, vk] = KEYS[code];
    await send('Input.dispatchKeyEvent', { type: on ? 'keyDown' : 'keyUp', code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  const tapKey = async (code, vk, key) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(80);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  mkdirSync(OUT, { recursive: true });
  const shot = async (name) => {
    const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    writeFileSync(`${OUT}/${TOD}-${name}.jpg`, Buffer.from(result.data, 'base64'));
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (PHONE) await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true, screenWidth: W, screenHeight: H, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
  for (let i = 0; i < 400; i++) { if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality)').catch(() => false)) break; await sleep(500); }
  console.log('booted; exceptions:', errs.length);
  await sleep(3000);
  await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true); d.tod.choose(${JSON.stringify(TOD)});
    const g = document.getElementById('startBtn') || document.getElementById('play'); if (g) g.click(); })()`);
  await sleep(1500);
  // the game boots into its pause menu: press Resume as a player would
  await ev(`(() => { if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); })()`);
  await sleep(1000);
  console.log('paused after resume:', await ev('window.__dbg.game.paused'));
  let leg = 0;
  for (const [a, b] of LEGS) {
    leg++;
    // put the player in a road car at the start, then let go
    const ok = await ev(`(() => { const d = window.__dbg; const p = d.player; if (!p.onFoot && p.exitVehicle) p.exitVehicle();
      p.respawn(${a[0]}, ${a[1]}); d.world.update(${a[0]}, ${a[1]}, 60); if (d.game.paused) document.getElementById('resumeBtn').click(); return true; })()`);
    await sleep(2500);
    // enter the nearest car (ENTER)
    for (let k = 0; k < 4; k++) { if (await ev('!window.__dbg.player.onFoot')) break; await tapKey('KeyF', 70, 'f'); await sleep(900); }
    if (await ev('window.__dbg.player.onFoot')) {
      await ev(`(() => { const d = window.__dbg, t = d.traffic, p = d.player; const v = t.spawnAt(p.x + 3, p.z + 3, 0, 'sedan', 0x2255cc, 'player'); p.enterVehicle(v); })()`);
      await sleep(800);
    }
    const route = await ev(`(() => { const d = window.__dbg, t = d.taxi, p = d.player; const from = t.mainNode(p.x, p.z, 250), to = t.mainNode(${b[0]}, ${b[1]}, 250);
      if (from < 0 || to < 0) return null; const job = t.pathJob(from, to, 8000); const path = job === true ? [from] : job.finish(); if (!path) return null;
      return t.routeOf(path, p.x, p.z).pts; })()`);
    console.log(`leg ${leg}: route`, route ? `${route.length / 2} pts` : 'NONE');
    if (!route) continue;
    // stand the car on the road, nose along the route (the route's first leg)
    if (route.length >= 6) await ev(`(() => { const d = window.__dbg, v = d.player.vehicle; if (!v) return; const r = ${JSON.stringify(route)};
      const dx = r[4] - r[2], dz = r[5] - r[3]; v.place(r[2], r[3], Math.atan2(dx, dz)); v.vLong = 0; })()`);
    const t0 = Date.now(); let wi = 2, lastShot = 0, stuck = 0, lastPos = null, lastChk = 0;
    while (Date.now() - t0 < LEG_MS) {
      const s = await ev(`(() => { const p = window.__dbg.player, v = p.vehicle; return v ? [v.x, v.z, v.forward.x, v.forward.z, v.vLong, window.__dbg.game.wanted|0, window.__dbg.game.dead?1:0] : null; })()`);
      if (!s) { await setKey('KeyW', false); await sleep(500); continue; }
      const [x, z, fx, fz, vl, wanted, dead] = s;
      if (dead) { console.log('  dead'); break; }
      while (wi < route.length / 2 && Math.hypot(route[wi * 2] - x, route[wi * 2 + 1] - z) < 14) wi++;
      if (wi >= route.length / 2) { console.log('  reached the end'); break; }
      // aim a little ahead along the route
      const tj = Math.min(wi + 1, route.length / 2 - 1);
      const tx = route[tj * 2] - x, tz = route[tj * 2 + 1] - z, tl = Math.hypot(tx, tz) || 1;
      const cross = (tx / tl) * fz - (tz / tl) * fx;   // >0: target is to the right? (right = (fz, -fx))
      const right = ((tx / tl) * fz + (tz / tl) * -fx) * (process.env.FLIP ? -1 : 1);
      const dot = (tx / tl) * fx + (tz / tl) * fz;
      await setKey('KeyD', right > 0.12); await setKey('KeyA', right < -0.12);
      await setKey('KeyW', dot > 0.3 || Math.abs(vl) < 3); await setKey('KeyS', dot < -0.5 && vl > 2);
      if (Date.now() - lastChk > 6000) { // stuck check
        if (lastPos && Math.hypot(x - lastPos[0], z - lastPos[1]) < 3) { stuck++; await tapKey('KeyH', 72, 'h'); } else stuck = 0;
        lastPos = [x, z]; lastChk = Date.now();
        if (stuck >= 3) { console.log('  stuck, leg abandoned at', x | 0, z | 0); break; }
      }
      if (Date.now() - lastShot > 15000) { lastShot = Date.now(); await shot(`leg${leg}-${Math.round((Date.now() - t0) / 1000)}s`); }
      await sleep(160);
    }
    for (const c of [...held]) await setKey(c, false);
    await shot(`leg${leg}-end`);
    console.log(`leg ${leg} done; exceptions so far ${errs.length}`);
  }
  console.log('wanted/health:', await ev('JSON.stringify([window.__dbg.game.wanted, window.__dbg.game.money])'));
  console.log(`exceptions/console errors: ${errs.length}`);
  for (const e of [...new Set(errs)].slice(0, 15)) console.log('   ', e);
} finally {
  try { chrome.kill && chrome.kill(); } catch { /* */ }
  process.exit(0);
}
