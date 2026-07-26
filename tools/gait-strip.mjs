// Stop-motion contact sheet of the gait, side on.
//
//   node tools/gait-strip.mjs [speed] [frames]
//
// Poses the character at evenly spaced phases across one FULL cycle (left step
// plus right step) and screenshots each, so the walk can be read frame by frame
// instead of guessed at from one pose. The city is hidden and the terrain kept,
// which leaves a ground line to judge foot plant against without the clutter.
//
// animateWalk is called with dt = 0, so it poses at exactly the phase asked for
// rather than advancing the cycle itself.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9227;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SPEED = parseFloat(process.argv[2] || '1.4');
const FRAMES = parseInt(process.argv[3] || '12', 10);
const TAG = process.argv[4] || `s${String(SPEED).replace('.', '_')}`;
const OUT = `tools/data/gait/strip-${TAG}`;

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    // Landscape: a portrait window trips the app's own rotate-your-device
    // overlay and every frame comes back as that message.
    '--window-size=900,640', '--no-first-run',
    '--user-data-dir=/tmp/auto-strip-profile', 'about:blank',
  ], { stdio: 'ignore' });
}

async function main() {
  const chrome = launch();
  try {
    let page;
    for (let i = 0; i < 80 && !page; i++) {
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

    // Stage: hide the HUD and the streamed city, keep the terrain for a ground
    // line, and stand the character side-on facing screen right.
    await evaluate(`(() => {
      const d = window.__dbg;
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
      d.scene.fog = null;
      d.world.group.visible = false;                 // buildings, roads, props
      const p = d.player.position;
      const h = d.player.h;
      h.gait = 1; h.swing = 1; h.lean = 0;
      // heading whose forward is +X, so the character walks to screen right
      h.group.rotation.y = Math.PI / 2;
      d.__strip = { x: p.x, y: p.y, z: p.z };
      d.sun.position.set(p.x - 3, p.y + 12, p.z + 9);
      d.sun.target.position.set(p.x, p.y + 0.9, p.z);
      d.sun.target.updateMatrixWorld();
      d.camera.position.set(p.x, p.y + 0.92, p.z + 3.5);
      d.camera.lookAt(p.x, p.y + 0.86, p.z);
      d.camera.updateMatrixWorld(true);
    })()`);

    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    const amp = Math.max(0, Math.min(0.85, SPEED * 0.16));
    for (let i = 0; i < FRAMES; i++) {
      const ph = (i / FRAMES) * Math.PI * 2;
      await evaluate(`(() => {
        const d = window.__dbg, h = d.player.h;
        h.phase = ${ph};
        d.animateWalk(h, ${amp}, 0, ${SPEED});   // dt = 0: pose, don't advance
        h.group.updateMatrixWorld(true);
      })()`);
      await sleep(2200);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${String(i).padStart(2, '0')}.png`, Buffer.from(result.data, 'base64'));
    }
    console.log(`${FRAMES} frames at ${SPEED} m/s -> ${OUT}/`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('strip failed:', e.message); process.exitCode = 1; });
