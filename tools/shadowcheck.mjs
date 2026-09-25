// Does the phone's shadow cache draw the same shadows as three's own pass?
//
//   python3 -m http.server 8000 &
//   node tools/shadowcheck.mjs
//
// Boots on the iPhone profile (the cache is phone-only; see src/shadowcache.js)
// and, at a series of sun boxes -- the start, small moves that shift the cache
// by whole texels, a move past its margin that re-renders it, a turn of the
// camera, a distant site -- renders the scene twice, once through the cache
// and once with it off, reads the live shadow map back each time and compares
// the depths texel by texel. It also counts the shadow pass's draw calls both
// ways. Fails if more than 0.5 % of the occupied texels differ by over ~10 cm
// of depth (edge texels may: see below), or the cache never saves a draw.
import { launchChrome, assertRenderer } from './chrome.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9257;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const VIEW = { width: 874, height: 402, deviceScaleFactor: 3, mobile: true };

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-shadowcheck-${PORT}`, gpu: true, width: VIEW.width, height: VIEW.height });
let code = 0;
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map(); const errs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && /shadow cache/.test(JSON.stringify(m.params.args))) errs.push(JSON.stringify(m.params.args).slice(0, 300));
  });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, screenWidth: VIEW.width, screenHeight: VIEW.height,
    screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  await assertRenderer(ev, console.log, true);
  for (let i = 0; i < 240; i++) { if (await ev('window.__dbg.sceneStats.calls > 0')) break; await sleep(500); }
  await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true); d.game.paused = true; })()`);
  if (!(await ev('!!window.__dbg.shadowCache'))) throw new Error('no shadow cache on the phone profile');

  // [name, dx, dz from the player, camera yaw]
  const POSES = [['start', 0, 0, 0], ['+3 m', 3, 0, 0], ['+11 m', 8, 3, 0], ['+40 m', 40, 20, 0],
    ['+95 m (past the margin)', 95, 40, 0], ['camera turned', 95, 40, 2.4], ['back at the start', 0, 0, 1]];
  const out = await ev(`(async () => {
    const d = window.__dbg, r = d.renderer, sun = d.sun, T = d.THREE, sc = d.shadowCache;
    const P = d.player, x0 = P.x, z0 = P.z;
    const settle = (x, z) => { const pend = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
      for (let i = 0; i < 900 && pend() > 0; i++) d.world.update(x, z, 2); };
    const read = () => { const m = sun.shadow.map, n = m.width, b = new Uint8Array(n * n * 4);
      r.readRenderTargetPixels(m, 0, 0, n, n, b); return b; };
    const depth = (b, i) => (b[i] / 255) / (256 * 256 * 256) + (b[i + 1] / 255) / (256 * 256) + (b[i + 2] / 255) / 256 + (b[i + 3] / 255);
    const shot = () => { const sm = r.shadowMap, o = sm.render; let calls = 0;
      sm.render = function (...a) { const c0 = r.info.render.calls; o.apply(this, a); calls += r.info.render.calls - c0; };
      r.info.autoReset = false; r.info.reset();
      r.setRenderTarget(d.postfx.target); r.render(d.scene, d.camera); r.setRenderTarget(null);
      r.info.autoReset = true; sm.render = o; return calls; };
    const res = [];
    for (const [name, dx, dz, yaw] of ${JSON.stringify(POSES)}) {
      const x = x0 + dx, z = z0 + dz;
      settle(x, z);
      const gy = d.city.groundAt(x, z, null);
      d.camera.position.set(x - Math.sin(yaw) * 12, gy + 5, z - Math.cos(yaw) * 12);
      d.camera.lookAt(x, gy + 1.5, z);
      d.camera.updateMatrixWorld(true);
      d.placeSun(x, gy, z);
      const before = sc.renders;
      sc.on = true; const cCache = shot(); const a = read();
      const rendered = sc.renders - before;
      sc.on = false; const cPlain = shot(); const b = read();
      sc.on = true;
      // an empty texel is three's clear colour (1.0039) or a packed 1.0: both
      // mean "nothing here", so compare them as 1
      let diff = 0, worst = 0, lit = 0; const at = [];
      const n = sun.shadow.map.width;
      for (let i = 0; i < a.length; i += 4) {
        const da = Math.min(1, depth(a, i)), db = Math.min(1, depth(b, i));
        if (db < 1) lit++;
        const e = Math.abs(da - db);
        if (e > worst) worst = e;
        if (e > 1e-4) { diff++; if (at.length < 6) at.push([(i / 4) % n, Math.floor(i / 4 / n), +da.toFixed(4), +db.toFixed(4)]); }
      }
      res.push({ name, drawsCache: cCache, drawsPlain: cPlain, cacheRedrawn: rendered, texelsOff: diff, worst: +worst.toExponential(2), occupied: lit, at });
    }
    return res;
  })()`);
  for (const r of out) {
    console.log(`  ${r.name.padEnd(26)} shadow draws ${String(r.drawsCache).padStart(3)} cached / ${String(r.drawsPlain).padStart(3)} plain`
      + `  cache redrawn ${r.cacheRedrawn}  texels off ${r.texelsOff} of ${r.occupied} occupied (worst ${r.worst})`
      + (r.texelsOff ? `  e.g. ${JSON.stringify(r.at)}` : ''));
  }
  if (errs.length) { console.log('  errors:\n    ' + errs.join('\n    ')); code = 1; }
  // A static caster rasterised in the cache's frame and in the live one can
  // disagree about a texel its edge just touches (float transforms of ~1 km
  // coordinates), and that is all a texel more than 1e-4 (~10 cm) off may be.
  const bad = out.filter((r) => r.texelsOff > r.occupied * 0.005);
  const saved = out.some((r) => r.cacheRedrawn === 0 && r.drawsCache < r.drawsPlain);
  if (bad.length) { console.log(`FAIL: the cached shadow map differs at ${bad.map((r) => r.name).join(', ')}`); code = 1; }
  if (!saved) { console.log('FAIL: the cache never saved a draw'); code = 1; }
  if (!code) console.log('OK: the cached shadow map matches three\'s own (edge texels aside)');
} catch (e) {
  console.error(e); code = 1;
} finally {
  chrome.kill();
}
process.exit(code);
