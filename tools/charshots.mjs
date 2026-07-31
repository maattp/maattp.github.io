// Portrait sheet of the character model, from fixed angles.
//
//   node tools/charshots.mjs [tag] [seed]
//
// Full-length front / three-quarter / side / back, plus a head-and-shoulders
// close-up: the views a character artist turns a model around in, at the two
// distances the player actually sees -- across the street and in the mirror.
// The city is hidden and the ground is a plain plane, because the subject is
// the model. Sun placed with the camera, for the reason survey.mjs learned
// the hard way: a stale shadow map paints blotches that read as the bug
// being hunted.
//
// Same-seed discipline as vehshots: a before/after comparison is only honest
// if both sheets photograph the SAME variant, so the seed is pinned in the
// filename and defaults to 0.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9229;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const TAG = process.argv[2] || 'now';
const SEED = parseInt(process.argv[3] || '0', 10);
const OUT = `tools/data/char/${TAG}`;

// name, azimuth (0 = facing camera), target height, distance, fov
const VIEWS = [
  ['front', 0, 0.90, 3.1, 35],
  ['three-quarter', 0.7, 0.90, 3.1, 35],
  ['side', Math.PI / 2, 0.90, 3.1, 35],
  ['back', Math.PI, 0.90, 3.1, 35],
  ['head', 0.35, 1.50, 0.85, 30],
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--window-size=700,900', '--no-first-run',
    '--user-data-dir=/tmp/auto-charshot-profile', 'about:blank',
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
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await evaluate('!!window.__dbg')) break;
    }

    await evaluate(`(async () => {
      const d = window.__dbg;
      d.applyQuality('high', true);
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu','loading'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
      // Hide EVERYTHING that is not a light: props, landmarks and helicopter
      // groups hang straight off the scene, not off world.group, so hiding the
      // named groups still left a tree floating over the model's shoulder.
      for (const o of d.scene.children) {
        if (o.isLight || o === d.sun.target) continue;
        o.visible = false;
      }
      const g = new d.THREE.Mesh(
        new d.THREE.PlaneGeometry(60, 60),
        new d.THREE.MeshStandardMaterial({ color: 0x6e7276, roughness: 0.95 }));
      g.rotation.x = -Math.PI / 2;
      g.position.set(0, 0.001, 0);
      g.receiveShadow = true;
      d.scene.add(g);
      const m = await import('./src/peds.js');
      const h = m.makeHumanoid({ seed: ${SEED}, scale: 1 });
      h.mesh.castShadow = true;
      d.scene.add(h.group);
      h.group.position.set(0, 0, 0);
      m.animateWalk(h, 0, 0, 0);
      window.__subject = h;
      window.__animate = m.animateWalk;
    })()`);
    for (let i = 0; i < 20; i++) { await sleep(300); if (await evaluate('!!window.__subject')) break; }

    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    for (const [name, az, th, dist, fov] of VIEWS) {
      await evaluate(`(() => {
        const d = window.__dbg, h = window.__subject;
        h.group.position.set(0, 0, 0);
        h.group.rotation.y = ${az};   // turn the subject, keep the light fixed
        if (window.__animate) window.__animate(h, 0, 0, 0);
        const cy = ${th};
        d.camera.fov = ${fov}; d.camera.updateProjectionMatrix();
        d.camera.position.set(0, cy + ${dist} * 0.10, ${dist});
        d.camera.lookAt(0, cy, 0);
        d.camera.updateMatrixWorld(true);
        d.sun.position.set(-6, 9, 8);
        d.sun.target.position.set(0, 1, 0);
        d.sun.target.updateMatrixWorld();
        d.scene.updateMatrixWorld(true);
      })()`);
      await sleep(5000);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(result.data, 'base64'));
      console.log(`  ${name}`);
    }
    console.log(`${VIEWS.length} views (seed ${SEED}) -> ${OUT}/`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('charshots failed:', e.message); process.exitCode = 1; });
