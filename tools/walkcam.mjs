// The player's own walk, as the game shows it.
//
//   node tools/walkcam.mjs <outdir> [walk|run|sprint] [side|chase|both]
//
// Boots the game, walks the player at a fixed 1/60 through player.update (the
// real input path, locks and all) and screenshots every WALK_STEP frames
// (default 5, WALK_N shots, default 10) from the chase camera and/or a side
// camera at hip height 3.2 m out. gait-strip poses a phase with dt = 0 on an
// empty stage; this is the moving body on a real street, which is where the
// crouched walk (v119) was obvious and the strip was not.
import { launchChrome, assertRenderer } from './chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT = +process.env.AUTO_CDP_PORT || 9243;
const OUT = process.argv[2]; const MODE = process.argv[3] || 'walk'; const CAM = process.argv[4] || 'both';
const N = +(process.env.WALK_N || 10), STEP = +(process.env.WALK_STEP || 5);
mkdirSync(OUT, { recursive: true });
const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-walkcam-${PORT}`, width: 1280, height: 720 });
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(300); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
  const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${process.env.AUTO_HTTP_PORT || 8000}/apps/auto/` });
  for (let i = 0; i < 400; i++) { await sleep(500); if (await evaluate('!!window.__dbg')) break; }
  await assertRenderer(evaluate); await sleep(3000);
  await evaluate(`(() => { const d = window.__dbg; d.applyQuality('high', true);
    for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    d.game.paused = true; d.peds.peds.forEach((p) => { p.h.group.visible = false; });
    window.__walk = (n, side) => { const P = d.player, dt = 1 / 60;
      const inp = { x: 0, y: -1, sprint: ${MODE === 'sprint'}, attack: false, jump: false };
      if ('${MODE}' === 'walk') { inp.y = -0.28; }
      for (let i = 0; i < n; i++) { P.update(dt, inp, { x: 0, y: 0 }, d.controls, d.traffic, d.peds); d.world.update(P.x, P.z, 2); }
      P.applyCamera(d.camera);
      if (side) { const h = P.heading, sx = Math.cos(h), sz = -Math.sin(h);
        d.camera.position.set(P.x + sx * 3.2, P.y + 1.0, P.z + sz * 3.2); d.camera.lookAt(P.x, P.y + 0.9, P.z); }
      d.camera.updateMatrixWorld(true);
      d.sun.position.set(P.x - 215, P.y + 200, P.z - 150); d.sun.target.position.set(P.x, P.y, P.z); d.sun.target.updateMatrixWorld();
      return [P.speed.toFixed(2), P.x.toFixed(1), P.z.toFixed(1)]; };
    window.__walk(240, false); })()`);
  for (let k = 0; k < N; k++) {
    for (const side of CAM === 'both' ? [false, true] : [CAM === 'side']) {
      const r = await evaluate(`window.__walk(${(k && (CAM === "side" || !side)) ? STEP : 0}, ${side})`);
      await sleep(900);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${side ? 'side' : 'chase'}${String(k).padStart(2, '0')}.png`, Buffer.from(result.data, 'base64'));
      if (k === 0) console.log('speed/pos', r);
    }
  }
} finally { chrome.kill(); }
process.exit(0);
