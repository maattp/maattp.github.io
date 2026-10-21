// Auto KW: world-framed screenshots of fixed camera views (a copy of
// tools/viewshots.mjs pointed at apps/autokw/), and the boot check.
//
//   node tools/kw/kwshots.mjs <outdir> [name,name...]     (AUTO_GPU=1 for the Mac's GPU)
//   VIEWS=file.json     replaces the built-in views
//   VIEW_WAIT=ms        settle time before each shot (default 4000)
//   VIEW_PROBE='<js>'   evaluate once on the booted page and print it, no shots
//   VIEW_PRE='<js>'     evaluate once before the shots (e.g. hide a layer to see what draws what)
//   VIEW_SIZE=874x402   window size (default 1280x720; 874x402 is the phone's landscape)
//
// Boot recipe as verify.mjs / landmarkshots.mjs: service worker bypassed,
// __noAutoQuality, streamer settled, HUD hidden, game paused. Two ways to
// frame a view:
//   { name, at: [x, z, h], bearing, pitch, fov }   camera h m over the ground at
//       (x, z) -- or `alt` absolute -- looking along a compass bearing (deg,
//       0 = north, 90 = east) and pitch (deg up)
//   { name, t: [x, z, h], c: [x, z, h], cy, fov }   look-at a point from a point
// `calls` in the output is the scene pass's draw count.

import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const args = process.argv.slice(2);
const OUT = args[0] || 'tools/data/kw/shots';
const ONLY = args[1] ? args[1].split(',') : null;

// Alki (-4600, 2800) looks west; Kerry Park (-1650, -2010) and Lake Washington
// (6000, 2500) look SSE at Rainier.
const VIEWS = process.env.VIEWS ? JSON.parse(readFileSync(process.env.VIEWS, 'utf8')) : [
  { name: 'spawn', player: true },
  { name: 'air-uptown', at: [-3200, -1000, 0], alt: 450, bearing: 300, pitch: -18, fov: 60 },
  { name: 'air-river', at: [2500, -1000, 0], alt: 600, bearing: 330, pitch: -20, fov: 60 },
  { name: 'air-galt', at: [12000, 8800, 0], alt: 500, bearing: 160, pitch: -20, fov: 60 },
  { name: 'air-region', at: [0, 9000, 0], alt: 2500, bearing: 0, pitch: -22, fov: 70 },
];
function launch() {
  return launchChrome({ port: PORT, profile: `/tmp/autokw-shots-profile-${PORT}`,
    width: +(process.env.VIEW_SIZE || '1280x720').split('x')[0], height: +(process.env.VIEW_SIZE || '1280x720').split('x')[1],
    extra: ['--autoplay-policy=no-user-gesture-required'] });
}

async function main() {
  const chrome = launch();
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try {
        page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
          .find((t) => t.type === 'page');
      } catch { /* not up */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map(); const errs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception');
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + (m.params.args || []).map((a) => a.value || a.description).join(' '));
    });
    const send = (method, params = {}) => new Promise((res) => {
      ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res);
    });
    const evaluate = async (e, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    if (process.env.AUTO_PHONE === '1') {
      await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/${process.env.AUTO_APP || 'autokw'}/` });
    let up = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await evaluate('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality)')) { up = true; break; }
      if (errs.length || i % 20 === 19) console.log('  ...', await evaluate('(document.getElementById("loadMsg")||{}).textContent'), errs.slice(0, 3).join(' | '));
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) {
      console.log(await evaluate('(document.getElementById("bootLog")||{}).textContent'));
      throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
    }
    console.log('  booted; exceptions so far:', errs.length, errs.slice(0, 3).join(' | '));
    await sleep(3000);
    await evaluate(`(() => {
      const d = window.__dbg;
      d.applyQuality(${JSON.stringify(process.env.VIEW_QUALITY || 'high')}, true);
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
    })()`);

    if (process.env.VIEW_PRE) await evaluate(process.env.VIEW_PRE);
    if (process.env.VIEW_PROBE_FILE) process.env.VIEW_PROBE = readFileSync(process.env.VIEW_PROBE_FILE, 'utf8');
    if (process.env.VIEW_PROBE) {
      const v = await evaluate(process.env.VIEW_PROBE, true);
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
      console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
      return;
    }

    mkdirSync(OUT, { recursive: true });
    for (const V of VIEWS) {
      if (ONLY && !ONLY.some((o) => V.name.startsWith(o))) continue;
      if (V.player) {
        // the game's own chase camera: unpaused, optionally teleported
        await evaluate(`(() => { const d = window.__dbg, V = ${JSON.stringify(V)};
          if (V.tp) { const [x, z, h] = V.tp; d.player.teleport ? d.player.teleport(x, z) : null; }
          if (V.eval) eval(V.eval);
          d.game.paused = false; d.camera.fov = 62; d.camera.updateProjectionMatrix(); })()`);
        await sleep(+process.env.VIEW_WAIT || 6000);
        const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
        writeFileSync(`${OUT}/${V.name}.jpg`, Buffer.from(result.data, 'base64'));
        await evaluate('window.__dbg.game.paused = true');
        console.log(`  ${OUT}/${V.name}.jpg  (player view)`);
        continue;
      }
      const res = await evaluate(`(() => {
        const d = window.__dbg, V = ${JSON.stringify(V)};
        let cx, cz, cy, tx, ty, tz;
        if (V.at) {
          [cx, cz] = V.at;
          const b = V.bearing * Math.PI / 180, p = (V.pitch || 0) * Math.PI / 180;
          tx = cx + Math.sin(b) * Math.cos(p) * 1000; tz = cz - Math.cos(b) * Math.cos(p) * 1000;
        } else { [cx, cz] = V.c; [tx, tz] = V.t; }
        const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
        d.world.update(cx, cz, 60);
        for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(cx, cz, 60);
        const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
        // camera height: alt absolute, cy over the target ground, else over its own
        cy = V.alt !== undefined ? V.alt : V.cy !== undefined ? gy(tx, tz) + V.cy
          : gy(cx, cz) + (V.at ? V.at[2] : V.c[2]);
        if (V.at) ty = cy + Math.sin((V.pitch || 0) * Math.PI / 180) * 1000;
        else ty = gy(tx, tz) + V.t[2];
        d.camera.fov = V.fov || 62;
        d.camera.updateProjectionMatrix();
        d.camera.position.set(cx, cy, cz);
        d.camera.lookAt(tx, ty, tz);
        d.camera.updateMatrixWorld(true);
        // the game's own sun (-215, 200, -150), relative to the camera
        d.sun.position.set(cx - 215, cy + 200, cz - 150);
        d.sun.target.position.set(cx, gy(cx, cz), cz);
        d.sun.target.updateMatrixWorld();
        return JSON.stringify({ cy });
      })()`);
      await sleep(+process.env.VIEW_WAIT || 4000);
      const calls = await evaluate(`(() => {
        const d = window.__dbg, m = d.world.mountains;
        const a = d.sceneStats ? d.sceneStats.calls : -1;
        return a;
      })()`);
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
      writeFileSync(`${OUT}/${V.name}.jpg`, Buffer.from(result.data, 'base64'));
      const r = JSON.parse(res);
      console.log(`  ${OUT}/${V.name}.jpg  eye y ${r.cy.toFixed(1)}  calls ${calls}`);
    }
    console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('viewshots failed:', e.message); process.exitCode = 1; });
