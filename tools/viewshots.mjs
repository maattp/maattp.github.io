// World-framed screenshots of fixed camera views, for judging anything the sky
// or the horizon does (the mountains: see "Mountains on the horizon" in
// apps/auto/guide/rendering.md).
//
//   AUTO_HTTP_PORT=8112 AUTO_CDP_PORT=9412 node tools/viewshots.mjs <outdir> [name,name...]
//   VIEWS=file.json     replaces the built-in views
//   VIEW_WAIT=ms        settle time before each shot (default 4000)
//   VIEW_PROBE='<js>'   evaluate once on the booted page and print it, no shots
//
// Boot recipe as verify.mjs / landmarkshots.mjs: service worker bypassed,
// __noAutoQuality, streamer settled, HUD hidden, game paused. Two ways to
// frame a view:
//   { name, at: [x, z, h], bearing, pitch, fov }   camera h m over the ground at
//       (x, z) -- or `alt` absolute -- looking along a compass bearing (deg,
//       0 = north, 90 = east) and pitch (deg up)
//   { name, t: [x, z, h], c: [x, z, h], cy, fov }   look-at a point from a point
// `calls` in the output is the scene pass's draw count.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const OUT = args[0] || 'tools/data/viewshots';
const ONLY = args[1] ? args[1].split(',') : null;

// Alki (-4600, 2800) looks west; Kerry Park (-1650, -2010) and Lake Washington
// (6000, 2500) look SSE at Rainier.
const VIEWS = process.env.VIEWS ? JSON.parse(readFileSync(process.env.VIEWS, 'utf8')) : [
  { name: 'mt-west-scout', t: [-14000, 2800, 400], c: [-4600, 2800, 0], cy: 60, fov: 70 },
  { name: 'mt-west', at: [-4600, 2800, 2], bearing: 275, pitch: 3, fov: 70 },
  { name: 'mt-west-tele', at: [-4600, 2800, 2], bearing: 278, pitch: 1.2, fov: 28 },
  { name: 'mt-rainier-tele', at: [-1650, -2010, 90], bearing: 153, pitch: 2.6, fov: 14 },
  { name: 'mt-rainier-close', at: [-1650, -2010, 90], bearing: 152.5, pitch: 2.3, fov: 7 },
  { name: 'mt-rainier-alki', at: [-5200, 2700, 60], bearing: 135, pitch: 2.4, fov: 55 },
  { name: 'mt-air-si', at: [0, 0, 0], alt: 1500, bearing: 105, pitch: -2, fov: 45 },
  { name: 'mt-air-pilchuck', at: [0, 0, 0], alt: 1500, bearing: 40, pitch: -2, fov: 45 },
  { name: 'mt-east-tele', at: [3000, -300, 80], bearing: 95, pitch: 1.5, fov: 30 },
  { name: 'mt-west-wide', at: [-4600, 2800, 2], bearing: 285, pitch: 4, fov: 90 },
  { name: 'mt-rainier-lake', at: [6000, 2500, 2], bearing: 152, pitch: 4, fov: 62 },
  { name: 'mt-rainier-kerry', at: [-1650, -2010, 90], bearing: 150, pitch: 4, fov: 50 },
  { name: 'mt-east', at: [3000, -300, 80], bearing: 95, pitch: 3, fov: 70 },
  { name: 'mt-north', at: [-1650, -2010, 90], bearing: 20, pitch: 3, fov: 70 },
  { name: 'mt-air-west', at: [-4600, 2800, 0], alt: 1500, bearing: 275, pitch: -2, fov: 70 },
  { name: 'mt-air-rainier', at: [0, 0, 0], alt: 1500, bearing: 152, pitch: -2, fov: 62 },
  { name: 'mt-air2k-east', at: [3000, 0, 0], alt: 2000, bearing: 95, pitch: -3, fov: 70 },
  { name: 'street-downtown', at: [60, 80, 1.7], bearing: 200, pitch: 2, fov: 62 },
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', '--no-first-run',
    `--user-data-dir=/tmp/auto-viewshots-profile-${PORT}`, 'about:blank',
  ], { stdio: 'ignore' });
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
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await evaluate('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality)')) break;
    }
    await sleep(3000);
    await evaluate(`(() => {
      const d = window.__dbg;
      d.applyQuality(${JSON.stringify(process.env.VIEW_QUALITY || 'high')}, true);
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
    })()`);

    if (process.env.VIEW_PROBE) {
      const v = await evaluate(process.env.VIEW_PROBE, true);
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
      console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
      return;
    }

    mkdirSync(OUT, { recursive: true });
    for (const V of VIEWS) {
      if (ONLY && !ONLY.some((o) => V.name.startsWith(o))) continue;
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
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${V.name}.png`, Buffer.from(result.data, 'base64'));
      const r = JSON.parse(res);
      console.log(`  ${OUT}/${V.name}.png  eye y ${r.cy.toFixed(1)}  calls ${calls}`);
    }
    console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('viewshots failed:', e.message); process.exitCode = 1; });
