// Close-ups of shadows on the ground, as the game draws them.
//
//   python3 -m http.server 8000 &
//   AUTO_GPU=1 node tools/shadowshots.mjs <outdir> [--desktop] [--steps=a,b,c]
//
// Boots as the iPhone (UA and viewport: the 1024 map over a 190 m box, the
// shadow cache, PCF) unless --desktop, walks the player at a fixed 1/60
// through player.update on the spawn's pavement, and at each walk step
// shoots the player's own shadow from the chase camera, a low side camera and
// from above, each with a zoomed crop around the shadow. Then the player in
// the nearest car, driven a second and stopped (`drive-*`), a parked car, and
// two streets each downtown and among houses from chase height (building
// shadows on the road). The sun is the game's (placeSun: the snapped box, the
// fixed offset), not a posed one. Crops are CSS-px clips of the phone's DPR 3
// frame.
//
// SHOTS_EVAL='<js>' runs in the page before the shots (switch an experiment
// on: `d.nearShadow.on = false`); SHOTS_PROBE='<expr>' (or SHOTS_PROBE_FILE)
// prints a value at the first pose; SHOTS_ONLY=a,b shoots only views whose name starts so.
import { launchChrome, assertRenderer } from './chrome.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9468;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith('--')) || 'tools/data/shadowshots';
const DESK = args.includes('--desktop');
const opt = (k, d) => { const a = args.find((s) => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const STEPS = opt('steps', '0,9,18').split(',').map(Number);
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const VIEW = DESK ? { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }
  : { width: 874, height: 402, deviceScaleFactor: 3, mobile: true };
mkdirSync(OUT, { recursive: true });

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-shadowshots-${PORT}`, gpu: process.env.AUTO_GPU === '1', width: VIEW.width, height: VIEW.height });
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
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') errs.push(JSON.stringify(m.params.args).slice(0, 300));
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
    ...(DESK ? {} : { screenOrientation: { type: 'landscapePrimary', angle: 90 } }) });
  if (!DESK) await send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  await assertRenderer(ev, console.log, process.env.AUTO_GPU === '1');
  for (let i = 0; i < 240; i++) { if (await ev('window.__dbg.sceneStats.calls > 0')) break; await sleep(500); }
  await sleep(1500);
  await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true);
    for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu'])
      { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    d.game.paused = true; })()`);
  if (process.env.SHOTS_EVAL) await ev(`(() => { const d = window.__dbg; ${process.env.SHOTS_EVAL} })()`);
  console.log(`  ${await ev(`(() => { const d = window.__dbg, s = d.sun.shadow; return 'map ' + s.mapSize.x + ', box ' + (s.camera.right - s.camera.left) + ' m, texel ' + ((s.camera.right - s.camera.left) / s.mapSize.x).toFixed(3) + ' m, bias ' + s.bias + ', normalBias ' + s.normalBias.toFixed(3) + ', cache ' + !!d.shadowCache + ', type ' + d.renderer.shadowMap.type + ', pr ' + d.renderer.getPixelRatio(); })()`)}`);

  await ev(`(() => {
    const d = window.__dbg, P = d.player, T = d.THREE;
    // the shadow falls away from the sun: placeSun's offset is (-215, 200, -150)
    const sd = new T.Vector3(215, 0, 150).normalize();
    window.__ss = {
      // walk n frames at a fixed 1/60, heading across the sun so the shadow lies beside him
      walk(n) {
        const inp = { x: 0, y: -0.28, sprint: false, attack: false, jump: false };
        for (let i = 0; i < n; i++) { P.update(1 / 60, inp, { x: 0, y: 0 }, d.controls, d.traffic, d.peds); d.world.update(P.x, P.z, 2); }
      },
      // pose the camera and the sun; returns the crop centre in CSS px
      pose(view) {
        P.applyCamera(d.camera);
        const cx = P.x + sd.x * 1.4, cz = P.z + sd.z * 1.4, gy = P.y;
        if (view === 'side') {
          // low, from the shadow's far side, looking back at him
          d.camera.position.set(P.x + sd.x * 4.5 - sd.z * 1.5, gy + 1.1, P.z + sd.z * 4.5 + sd.x * 1.5);
          d.camera.lookAt(cx, gy + 0.3, cz);
        } else if (view === 'top') {
          d.camera.position.set(cx - sd.x * 1.2, gy + 7, cz - sd.z * 1.2);
          d.camera.lookAt(cx, gy, cz);
        }
        d.camera.updateMatrixWorld(true);
        d.placeSun(P.x, P.y, P.z);
        if (d.peds.addContactShadow) { P.h.group.updateMatrixWorld(true); d.peds.clearContactShadows(); d.peds.addContactShadow(P.h, P.x, P.y, P.z, P.heading); }
        const v = new T.Vector3(cx, gy, cz).project(d.camera);
        return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
      },
      at(x, z, view, look) {
        const pend = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
        d.world.update(x, z, 60);
        for (let i = 0; i < 2000 && pend() > 0; i++) d.world.update(x, z, 60);
        const gy = Math.max(0, d.city.groundAt(x, z, null));
        d.camera.position.set(view.x, gy + view.y, view.z);
        d.camera.lookAt(look.x, gy + look.y, look.z);
        d.camera.updateMatrixWorld(true);
        d.placeSun(x, gy, z);
        const v = new T.Vector3(look.x, gy + look.y, look.z).project(d.camera);
        return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
      },
    };
    // face across the sun: the shadow then lies to his side, as when walking down most streets
    P.heading = Math.atan2(-sd.z, sd.x) + Math.PI / 2;
    P.camYaw = P.heading + Math.PI;
    __ss.walk(120);
  })()`);
  const PROBE = process.env.SHOTS_PROBE_FILE ? readFileSync(process.env.SHOTS_PROBE_FILE, 'utf8') : process.env.SHOTS_PROBE;
  if (PROBE) console.log('  probe: ' + JSON.stringify(await ev(`(() => { const d = window.__dbg; return ${PROBE}; })()`)));

  const ONLY = process.env.SHOTS_ONLY ? process.env.SHOTS_ONLY.split(',') : null;
  const shoot = async (name, c, zoom = 3) => {
    if (ONLY && !ONLY.some((p) => name.startsWith(p))) return;
    await sleep(700);
    const full = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(full.result.data, 'base64'));
    const w = VIEW.width / zoom, h = VIEW.height / zoom;
    const x = Math.max(0, Math.min(VIEW.width - w, c.x - w / 2)), y = Math.max(0, Math.min(VIEW.height - h, c.y - h / 2));
    const crop = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: DESK ? zoom : 1 } });
    writeFileSync(`${OUT}/${name}-crop.png`, Buffer.from(crop.result.data, 'base64'));
  };
  let done = 0;
  for (const s of STEPS) {
    await ev(`__ss.walk(${s - done})`); done = s;
    for (const view of ['chase', 'side', 'top']) {
      const c = await ev(`__ss.pose('${view}')`);
      await shoot(`walk${String(s).padStart(2, '0')}-${view}`, c);
    }
  }
  // the player's own car: in it, a few seconds of driving at fixed dt, then
  // the chase camera and a low side view of its shadow
  const drove = await ev(`(() => {
    const d = window.__dbg, P = d.player, T = d.THREE;
    const v = d.traffic.nearestEnterable(P.x, P.z, 80);
    if (!v) return false;
    P.enterVehicle(v);
    const inp = { x: 0, y: 0, gas: true, gasAmt: 0.6, brake: false, brakeAmt: 0, sprint: false, attack: false, jump: false };
    for (let i = 0; i < 90; i++) { P.update(1 / 60, inp, { x: 0, y: 0 }, d.controls, d.traffic, d.peds); d.world.update(P.x, P.z, 2); }
    const stop = { ...inp, gas: false, gasAmt: 0, brake: true, brakeAmt: 1 };
    const dir = new T.Vector3(0, 0, 1);
    for (let i = 0; i < 120; i++) {
      P.update(1 / 60, stop, { x: 0, y: 0 }, d.controls, d.traffic, d.peds);
      // traffic's update is what settles the player's car's LOD and wheels on a phone
      d.traffic.update(1 / 60, P.x, P.z, dir, P);
    }
    window.__ssCar = v;
    return true;
  })()`);
  if (drove) {
    for (const view of ['chase', 'side']) {
      const c = await ev(`(() => {
        const d = window.__dbg, P = d.player, v = window.__ssCar, T = d.THREE;
        const sd = new T.Vector3(215, 0, 150).normalize();
        P.applyCamera(d.camera);
        if ('${view}' === 'side') {
          d.camera.position.set(v.x + sd.x * 7 - sd.z * 3, v.y + 1.3, v.z + sd.z * 7 + sd.x * 3);
          d.camera.lookAt(v.x + sd.x * 1.5, v.y + 0.3, v.z + sd.z * 1.5);
        }
        d.camera.updateMatrixWorld(true);
        d.placeSun(v.x, v.y, v.z);
        const p = new T.Vector3(v.x + sd.x * 1.5, v.y, v.z + sd.z * 1.5).project(d.camera);
        return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
      })()`);
      await shoot(`drive-${view}`, c, 2);
    }
  }
  // a parked car's shadow, and a building's edge across the street
  const extra = JSON.parse(await ev(`(() => {
    const d = window.__dbg, P = d.player, out = {};
    let best = null;
    for (const v of d.traffic.cars) { if (v === P.vehicle || !v.group.visible) continue; const dd = Math.hypot(v.x - P.x, v.z - P.z); if (dd < 80 && (!best || dd < best.dd)) best = { dd, x: v.x, z: v.z }; }
    if (best) out.car = best;
    return JSON.stringify(out);
  })()`));
  if (extra.car) {
    const { x, z } = extra.car;
    const c = await ev(`__ss.at(${x}, ${z}, { x: ${x} - 5, y: 2.2, z: ${z} - 7 }, { x: ${x} + 1.5, y: 0, z: ${z} + 1.0 })`);
    await shoot('car', c);
  }
  // building shadows across streets: downtown's tallest cluster, and a
  // residential street; a chase-height camera on a street node looking down
  // each of two of its streets
  const streets = JSON.parse(await ev(`(() => {
    const d = window.__dbg, city = d.city, out = [];
    const cluster = (want) => {
      const cells = new Map();
      for (const b of city.buildings) { if (!want(b)) continue;
        const k = Math.round(b.x / 300) * 100000 + Math.round(b.z / 300);
        let c = cells.get(k); if (!c) cells.set(k, (c = { n: 0, x: 0, z: 0 })); c.n++; c.x += b.x; c.z += b.z; }
      let best = null; for (const c of cells.values()) if (!best || c.n > best.n) best = c;
      return { x: best.x / best.n, z: best.z / best.n };
    };
    for (const [name, p] of [['downtown', cluster((b) => b.h > 60)], ['houses', cluster((b) => b.style === 'house')]]) {
      const ni = city.nearestNode(p.x, p.z, 400);
      if (ni < 0) continue;
      const n = city.nodes[ni];
      let k = 0;
      for (const ei of n.e) {
        const e = city.edges[ei];
        if (e.elev || e.tunnel) continue;
        const o = city.nodes[e.a === ni ? e.b : e.a];
        const L = Math.hypot(o.x - n.x, o.z - n.z), ux = (o.x - n.x) / L, uz = (o.z - n.z) / L;
        out.push({ name: name + k, x: n.x, z: n.z, ux, uz });
        if (++k === 2) break;
      }
    }
    return JSON.stringify(out);
  })()`));
  for (const s of streets) {
    const c = await ev(`__ss.at(${s.x}, ${s.z}, { x: ${s.x - s.ux * 6}, y: 2.4, z: ${s.z - s.uz * 6} }, { x: ${s.x + s.ux * 14}, y: 0.5, z: ${s.z + s.uz * 14} })`);
    await shoot(s.name, c, 2);
  }
  if (errs.length) { console.log('  console:\n    ' + errs.slice(0, 8).join('\n    ')); }
  console.log(`  shots in ${OUT}`);
} catch (e) {
  console.error(e); code = 1;
} finally {
  chrome.kill();
}
process.exit(code);
