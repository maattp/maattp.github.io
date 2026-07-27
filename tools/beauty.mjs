// Beauty shots for judging visual quality.
//
//   node tools/beauty.mjs [tag]
//
// A fixed set of framed views, captured identically every time so two runs can
// be compared honestly. The HUD is hidden and the quality tier is locked to
// `high` -- SwiftShader's ~4 fps otherwise trips the adaptive downgrade and
// every shot silently comes back at the low-quality settings.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9228;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TAG = process.argv[2] || 'now';
const OUT = `tools/data/beauty/${TAG}`;

// name, [camera x, HEIGHT ABOVE GROUND, z], [look-at x, height above ground, z].
//
// Heights are relative to the ground at that point, not absolute. Absolute
// heights put the Green Lake camera at y=30 under a lake whose surface is at
// 50 m, so the shot came back as the underside of the water plane with the
// neighbourhood apparently floating over a void -- which reads exactly like a
// broken renderer and is entirely the harness's fault.
const VIEWS = [
  ['street',      [250, 2.4, 780],    [250, 1.6, 300]],
  ['downtown',    [520, 80, 1250],    [420, 20, 500]],
  ['skyline',     [-1900, 150, 1900], [200, 30, 700]],
  ['waterfront',  [-900, 14, 640],    [-200, 2, 900]],
  ['residential', [-3400, 6, -6180],  [-3500, 2, -6600]],
  ['park',        [-700, 8, -4700],   [-350, 2, -5100]],
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', '--no-first-run',
    '--user-data-dir=/tmp/auto-beauty-profile', 'about:blank',
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
    let id = 0; const pend = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise((res) => {
      ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res);
    });
    const evaluate = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: 'http://localhost:8000/apps/auto/' });
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await evaluate('!!window.__dbg')) break;
    }
    await evaluate(`(() => {
      const d = window.__dbg;
      d.applyQuality('high', true);
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
    })()`);

    mkdirSync(OUT, { recursive: true });
    for (const [name, pos, look] of VIEWS) {
      await evaluate(`(() => {
        const d = window.__dbg;
        d.world.update(${pos[0]}, ${pos[2]}, 60);
        const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
        const cy = gy(${pos[0]}, ${pos[2]}) + ${pos[1]};
        const ly = gy(${look[0]}, ${look[2]}) + ${look[1]};
        d.camera.position.set(${pos[0]}, cy, ${pos[2]});
        d.camera.lookAt(${look[0]}, ly, ${look[2]});
        d.camera.updateMatrixWorld(true);
        d.sun.position.set(${pos[0]} - 160, cy + 240, ${pos[2]} - 110);
        d.sun.target.position.set(${look[0]}, ly, ${look[2]});
        d.sun.target.updateMatrixWorld();
      })()`);
      await sleep(9000);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(result.data, 'base64'));
      console.log(`  ${OUT}/${name}.png`);
    }
    const stats = await evaluate('({calls: __dbg.sceneStats.calls, tris: __dbg.sceneStats.tris})');
    console.log(`  scene: ${stats.calls} draws, ${stats.tris} triangles`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('beauty failed:', e.message); process.exitCode = 1; });
