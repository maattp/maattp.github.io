// Auto KW photo mode (src/kwphoto.js), end to end through the real UI.
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 node tools/kw/photoprobe.mjs [outdir]
// Pause menu -> PHOTO button, orbit / pinch / wheel with synthetic pointer events, the camera never under
// the ground, SNAP with navigator.share stubbed (JPEG of the canvas's size, non-uniform, look baked in,
// the pixel fallback agrees), EXIT: no leaked hold, camera back, HUD back. Exit 1 on a failure.
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT = +process.env.AUTO_CDP_PORT || 9528, HTTP = process.env.AUTO_HTTP_PORT || 8228;
const OUT = process.argv[2] || 'tools/data/kw/photoshots';
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-photo-profile-${PORT}`, width: 874, height: 402, extra: ['--autoplay-policy=no-user-gesture-required'] });
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(300); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map(); const errs = [];
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception'); });
  const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
  mkdirSync(OUT, { recursive: true });
  const shot = async (n) => { const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }); writeFileSync(`${OUT}/${n}.jpg`, Buffer.from(result.data, 'base64')); };
  const key = async (code, k, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk }); };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP}/apps/autokw/` });
  let up = false;
  for (let i = 0; i < 400 && !up; i++) { await sleep(500); try { up = await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.photo && window.__dbg.player)'); } catch {} }
  if (!up) throw new Error('never booted ' + errs.slice(0, 3).join('\n'));
  await sleep(3000);
  await ev(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); const r = document.getElementById('rotate'); if (r) r.style.display = 'none'; if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); })()`);
  await sleep(1500);
  const base = await ev(`(() => { const d = __dbg; return { held: d.game.held, paused: d.game.paused, fov: d.camera.fov }; })()`);
  console.log('base', JSON.stringify(base));
  await ev(`document.getElementById('pauseBtn').click()`); await sleep(400);
  ok(await ev(`document.getElementById('pauseMenu').classList.contains('show')`), 'pause menu open');
  await ev(`document.getElementById('photoBtn').click()`);
  await sleep(600);
  ok(await ev(`__dbg.photo.active && __dbg.game.holds.has('photo') && document.body.classList.contains('photo')`), 'photo mode on, hold taken, body.photo');
  ok(await ev(`getComputedStyle(document.getElementById('hud')).display === 'none' && getComputedStyle(document.getElementById('pad')).display === 'none'`), 'HUD and pad hidden');
  ok(await ev(`!document.getElementById('pauseMenu').classList.contains('show')`), 'menu closed');
  const tr = `JSON.stringify(__dbg.traffic.cars.slice(0,5).map(v=>[v.x,v.z]))`;
  const t0 = await ev(tr); await sleep(700);
  ok(t0 === await ev(tr), 'traffic frozen');
  await shot('photo-ui');
  const ptr = (type, idn, x, y) => ev(`document.getElementById('photoLayer').dispatchEvent(new PointerEvent('${type}', { pointerId: ${idn}, clientX: ${x}, clientY: ${y}, bubbles: true, pointerType: 'touch', button: 0 }))`);
  const camPos = () => ev(`__dbg.camera.position.toArray()`);
  const c1 = await camPos();
  await ptr('pointerdown', 1, 400, 200); for (let i = 1; i <= 8; i++) await ptr('pointermove', 1, 400 + i * 25, 200 + i * 6); await ptr('pointerup', 1, 600, 248);
  await sleep(300);
  const c2 = await camPos();
  ok(Math.hypot(c2[0] - c1[0], c2[2] - c1[2]) > 0.5, `one-finger drag orbits (moved ${Math.hypot(c2[0] - c1[0], c2[2] - c1[2]).toFixed(1)} m)`);
  const d1 = await ev(`__dbg.photo.dist`);
  await ptr('pointerdown', 1, 300, 200); await ptr('pointerdown', 2, 500, 200);
  for (let i = 1; i <= 6; i++) { await ptr('pointermove', 1, 300 - i * 20, 200); await ptr('pointermove', 2, 500 + i * 20, 200); }
  await ptr('pointerup', 1, 180, 200); await ptr('pointerup', 2, 620, 200);
  const d2 = await ev(`__dbg.photo.dist`);
  ok(d2 < d1 * 0.8, `pinch out zooms in (${d1.toFixed(1)} -> ${d2.toFixed(1)})`);
  ok(await ev(`__dbg.photo.ptrs.size === 0`), 'no pointer left latched');
  await ptr('pointerdown', 1, 300, 200); await ptr('pointerdown', 2, 400, 200);
  for (let i = 1; i <= 6; i++) { await ptr('pointermove', 1, 300 + i * 20, 200); await ptr('pointermove', 2, 400 + i * 20, 200); }
  await ptr('pointerup', 1, 420, 200); await ptr('pointerup', 2, 520, 200);
  ok(await ev(`Math.hypot(__dbg.photo.pan.x, __dbg.photo.pan.z) > 0.3`), 'two-finger drag pans');
  const dw = await ev(`__dbg.photo.dist`);
  await ev(`document.getElementById('photoLayer').dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }))`);
  ok(await ev(`__dbg.photo.dist`) > dw, 'wheel zooms out');
  let minAbove = 1e9, maxR = 0;
  for (const [yaw, pitch, dist] of [[0, -1, 30], [1.5, -0.25, 60], [3, 0, 2], [4.5, 1.6, 60], [2, 0.05, 60], [5, -5, 9]]) {
    const r = await ev(`(() => { const P = __dbg.photo, d = __dbg; P.yaw = ${yaw}; P.pitch = ${pitch}; P.dist = ${dist}; P.pan.set(30, 30, 30); P.update(0);
      const c = d.camera.position, g = d.city.groundAt(c.x, c.z, P.T.y, 0), p = d.player.position;
      return { above: c.y - g, r: Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) }; })()`);
    minAbove = Math.min(minAbove, r.above); maxR = Math.max(maxR, r.r);
  }
  ok(minAbove >= 0.99, `camera >= 1 m over ground at extremes (min ${minAbove.toFixed(2)})`);
  const low = await ev(`(() => { const P = __dbg.photo, d = __dbg; P.pan.set(0, -4, 0); P.pitch = -0.25; P.dist = 20; P.yaw = 1; P.update(0); const c = d.camera.position; return { above: c.y - d.city.groundAt(c.x, c.z, P.T.y, 0), cl: P.clamped }; })()`);
  ok(low.above >= 0.99 && low.cl !== '', `low camera is lifted (clamp "${low.cl}", ${low.above.toFixed(2)} m over)`);
  const bld = await ev(`(() => { const P = __dbg.photo, d = __dbg; P.pan.set(0, 0, 0); P.pitch = 0.1; P.dist = 55; let inside = 0, clamped = 0;
    for (let k = 0; k < 48; k++) { P.yaw = k / 48 * 6.283; P.update(0); const c = d.camera.position; if (d.city.insideBuilding(c.x, c.z, c.y, 0.3)) inside++; if (P.clamped === 'building') clamped++; } return { inside, clamped }; })()`);
  ok(bld.inside === 0, `camera never inside a building over 48 yaws at 55 m (${bld.clamped} pulled in)`);
  ok(maxR <= 60.5, `camera within 60 m of player (max ${maxR.toFixed(1)})`);
  await ev(`(() => { const P = __dbg.photo; P.pan.set(0, 0, 0); P.yaw = 0.6; P.pitch = 0.25; P.dist = 9; P.update(0); })()`);
  await ev(`(() => { const s = document.getElementById('photoFov'); s.value = 40; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  ok(await ev(`Math.round(__dbg.camera.fov) === 40`), 'FOV slider changes the camera fov');
  await sleep(500);
  await shot('photo-fov40');
  await ev(`window.__shared = []; Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true }); Object.defineProperty(navigator, 'share', { value: (o) => { window.__shared.push(o); return Promise.resolve(); }, configurable: true });`);
  const snapInfo = async (look) => ev(`(async () => { const P = __dbg.photo; P.setLook(${look}); await new Promise(r => setTimeout(r, 400));
      document.getElementById('photoSnap').click(); await new Promise(r => setTimeout(r, 300));
      const L = P.last, bm = await createImageBitmap(L.blob); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
      const px = x.getImageData(0, 0, c.width, c.height).data; const seen = new Set(); let r = 0, g = 0, b = 0, n = 0, dev = 0;
      for (let i = 0; i < px.length; i += 4 * 97) { seen.add((px[i] >> 3) << 10 | (px[i+1] >> 3) << 5 | (px[i+2] >> 3)); r += px[i]; g += px[i+1]; b += px[i+2]; n++; dev += Math.abs(px[i] - px[i+1]) + Math.abs(px[i+1] - px[i+2]); }
      const sh = window.__shared[window.__shared.length - 1];
      return { type: L.blob.type, size: L.blob.size, w: bm.width, h: bm.height, cw: __dbg.renderer.domElement.width, ch: __dbg.renderer.domElement.height, colours: seen.size, mean: [r/n, g/n, b/n], sat: dev / n, how: L.how, how2: L.how2, text: L.text, look: L.look, shared: window.__shared.length, file: sh ? sh.files[0].type : null }; })()`);
  const plain = await snapInfo(0);
  console.log('  plain', JSON.stringify(plain));
  ok(plain.type === 'image/jpeg' && plain.size > 5000, 'JPEG blob of real size');
  ok(plain.w === plain.cw && plain.h === plain.ch, `image is the canvas size ${plain.w}x${plain.h}`);
  ok(plain.colours > 60, `non-uniform pixels (${plain.colours} colour bins)`);
  ok(plain.shared >= 1 && plain.file === 'image/jpeg' && plain.how2 === 'share', 'navigator.share called with a JPEG File');
  ok(/^Auto KW/.test(plain.text) && /\d{4}/.test(plain.text), `caption "${plain.text}"`);
  const bw = await snapInfo(3);
  console.log('  bw', JSON.stringify(bw));
  ok(bw.look === 'bw' && bw.sat < plain.sat * 0.25, `B&W baked in (saturation ${plain.sat.toFixed(1)} -> ${bw.sat.toFixed(1)}) via ${bw.how}`);
  await ev(`__dbg.photo.fallback = true`);
  const bw2 = await snapInfo(3);
  ok(bw2.how === 'pixels' && bw2.sat < plain.sat * 0.25, `pixel fallback bakes B&W too (${bw2.sat.toFixed(1)})`);
  const warm = await snapInfo(1);
  ok(warm.mean[0] - warm.mean[2] > plain.mean[0] - plain.mean[2] + 3, 'warm look shifts red over blue (fallback path)');
  await ev(`__dbg.photo.fallback = !('filter' in CanvasRenderingContext2D.prototype)`);
  await ev(`Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); window.__dl = []; HTMLAnchorElement.prototype.click = function () { window.__dl.push(this.download); };`);
  await ev(`document.getElementById('photoSnap').click()`); await sleep(300);
  ok(await ev(`window.__dl.length === 1 && /^autokw-.*\\.jpg$/.test(window.__dl[0])`), 'no share API -> download link');
  for (const [look, nm] of [[0, 'plain'], [4, 'vintage']]) {
    await ev(`__dbg.photo.setLook(${look}); __dbg.photo.capture();`);
    const b64 = await ev(`new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(__dbg.photo.last.blob); })`);
    writeFileSync(`${OUT}/snap-${nm}.jpg`, Buffer.from(b64, 'base64'));
  }
  await ev(`document.getElementById('photoHide').click()`);
  ok(await ev(`__dbg.photo.hidden && (__dbg.player.vehicle ? !__dbg.player.vehicle.group.visible : !__dbg.player.h.group.visible)`), 'HIDE ME hides the player model');
  const tod0 = await ev(`__dbg.tod.setting`);
  await ev(`document.getElementById('photoTime').click()`);
  ok(await ev(`__dbg.tod.setting`) !== tod0, 'TIME nudges the time of day');
  await sleep(500); await shot('photo-night-hidden');
  await key('Escape', 'Escape', 27);
  await sleep(800);
  const ex = await ev(`(() => { const d = __dbg; return { active: d.photo.active, hold: d.game.holds.size, leaks: d.game.leaks.length, paused: d.game.paused, body: document.body.classList.contains('photo'), hud: getComputedStyle(document.getElementById('hud')).display,
    fov: d.camera.fov, tod: d.tod.setting, vis: d.player.vehicle ? d.player.vehicle.group.visible : d.player.h.group.visible, filter: d.renderer.domElement.style.filter,
    dcam: Math.hypot(d.camera.position.x - d.player.x, d.camera.position.z - d.player.z) }; })()`);
  console.log('  exit', JSON.stringify(ex));
  ok(!ex.active && ex.hold === 0 && ex.leaks === 0 && !ex.paused && !ex.body, 'exit: no hold, no leak, running');
  ok(ex.hud !== 'none' && ex.filter === '' && ex.vis, 'exit: HUD, canvas filter and player model back');
  ok(Math.abs(ex.fov - base.fov) < 8 && ex.tod === tod0, `exit: fov ${ex.fov.toFixed(1)} (was ${base.fov.toFixed(1)}) and time of day restored`);
  ok(ex.dcam < 15, `exit: camera back on the player (${ex.dcam.toFixed(1)} m)`);
  await key('KeyP', 'p', 80); await sleep(300);
  ok(await ev(`__dbg.photo.active`), 'P key enters');
  await key('KeyP', 'p', 80); await sleep(300);
  ok(await ev(`!__dbg.photo.active && __dbg.game.holds.size === 0`), 'P key exits, hold released');
  await ev(`(() => { const d = __dbg; const v = d.traffic.spawnAt(d.player.x + 6, d.player.z, 0, 'sedan', 0xcc2222, 'free'); d.player.enterVehicle(v); })()`);
  await sleep(600);
  await ev(`__dbg.photo.enter()`); await sleep(500);
  await ev(`(() => { const P = __dbg.photo; P.yaw = 0.9; P.pitch = 0.2; P.dist = 8; })()`); await sleep(500);
  await shot('photo-car');
  ok(await ev(`Math.hypot(__dbg.photo.T.x - __dbg.player.vehicle.x, __dbg.photo.T.z - __dbg.player.vehicle.z) < 1`), 'orbits the vehicle');
  await ev(`__dbg.photo.exit()`);
  ok(await ev(`__dbg.game.holds.size === 0 && __dbg.game.leaks.length === 0`), 'no leak after the car session');
  ok(errs.length === 0, 'no page exceptions ' + errs.slice(0, 2).join('|'));
} catch (e) { console.log('ERROR', e.message); fails++; }
finally { try { chrome.kill?.(); } catch {} }
console.log(fails ? `FAIL (${fails})` : 'PASS');
process.exit(fails ? 1 : 0);
