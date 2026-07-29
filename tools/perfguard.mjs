// Performance guard: the numbers a change must not make worse.
//
//   node tools/perfguard.mjs            print the record
//   node tools/perfguard.mjs --save     write it to tools/data/perfguard.json
//   node tools/perfguard.mjs --check    compare against the saved record
//
// Draw calls and triangles are device-independent, and so is the JavaScript
// cost of streaming a chunk -- which means all three can be held to account
// from here even though the target device cannot be profiled. What this cannot
// see is fill rate and shader cost on the actual GPU; for those, the readout in
// the pause menu is the only honest source.
//
// Three separate regressions this session were shipped because "it looks fine
// to me" was the only check: a shadow pass that doubled the frame, a chunk
// streamer that stalled for a quarter of a second, and a rebuild that punched a
// 400 m hole in the world. Each was obvious once counted.

import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9237;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const REC = 'tools/data/perfguard.json';
const SAVE = process.argv.includes('--save');
const CHECK = process.argv.includes('--check');

// How much worse a figure may get before it counts as a regression. Streaming
// times are noisy on a shared machine, so they get more room than draw counts,
// which are exact.
// **Run this on a quiet machine.** The draw and triangle counts are exact and
// repeatable; the streaming times are wall-clock and collapse under contention.
// Measured with two other headless Chrome instances running, updateMax read
// 26 ms against a true 16; with the machine idle it reproduces inside a
// millisecond. A timing "regression" here is worth a second run before it is
// worth an investigation.
const TOLERANCE = {
  drawsSteady: 0.04, trisSteady: 0.05,
  drawsFrame: 0.04, trisFrame: 0.05,
  updateP99: 0.35, updateMax: 0.35,
  holes: 0,
};

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--window-size=1280,720', '--no-first-run',
    '--user-data-dir=/tmp/auto-perfguard', 'about:blank',
  ], { stdio: 'ignore' });
}

const MEASURE = `(() => {
  const d = window.__dbg, r = d.renderer;
  const DOWNTOWN = { x: 305, z: -278 };

  // Settle the streamer first. Chunk geometry is time-sliced, so a figure taken
  // mid-stream describes an unfinished city and reads as an improvement.
  const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
  for (let i = 0; i < 900 && pending() > 0; i++) d.world.update(DOWNTOWN.x, DOWNTOWN.z, 2);

  const gy = Math.max(0, d.city.groundAt(DOWNTOWN.x, DOWNTOWN.z, null));
  d.camera.position.set(DOWNTOWN.x, gy + 3, DOWNTOWN.z + 40);
  d.camera.lookAt(DOWNTOWN.x, gy + 2, DOWNTOWN.z);
  d.camera.updateMatrixWorld(true);
  d.scene.updateMatrixWorld(true);

  // The whole frame, including the shadow pass. postfx.render does NOT
  // re-render the scene, so measuring around it counts the post chain alone.
  r.info.autoReset = false;
  r.info.reset();
  r.setRenderTarget(d.postfx.target);
  r.render(d.scene, d.camera);
  r.setRenderTarget(null);
  const frame = { calls: r.info.render.calls, tris: r.info.render.triangles };
  r.info.autoReset = true;

  // Streaming cost: drive across the map and time every world.update the way a
  // frame would, and watch for chunks that lose their geometry mid-rebuild.
  const times = [];
  const everHad = new Set();
  let holes = 0;
  for (let i = 0; i < 320; i++) {
    const x = -2400 + i * 11, z = -700 + i * 5;
    const t0 = performance.now();
    d.world.update(x, z, 2);
    times.push(performance.now() - t0);
    for (const c of d.world.chunks.values()) {
      if (c.group) everHad.add(c.key);
      else if (everHad.has(c.key)) holes++;
    }
  }
  times.sort((a, b) => a - b);
  const q = (f) => +times[Math.floor(times.length * f)].toFixed(2);

  return JSON.stringify({
    drawsSteady: d.sceneStats.calls, trisSteady: d.sceneStats.tris,
    drawsFrame: frame.calls, trisFrame: frame.tris,
    updateMedian: q(0.5), updateP99: q(0.99), updateMax: +times[times.length - 1].toFixed(2),
    holes,
    vehicles: d.traffic.cars.length, peds: d.peds.peds.length,
  });
})()`;

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
    const now = JSON.parse(await evaluate(MEASURE));

    const row = (k, v) => console.log(`  ${k.padEnd(14)}${String(v).padStart(10)}`);
    console.log('performance guard');
    for (const [k, v] of Object.entries(now)) row(k, v);

    if (SAVE) {
      mkdirSync('tools/data', { recursive: true });
      writeFileSync(REC, JSON.stringify(now, null, 2));
      console.log(`\nsaved to ${REC}`);
      return;
    }
    if (CHECK) {
      if (!existsSync(REC)) { console.error(`no record at ${REC} -- run --save first`); process.exitCode = 1; return; }
      const was = JSON.parse(readFileSync(REC, 'utf8'));
      let bad = 0;
      console.log('\nagainst the saved record:');
      for (const [k, tol] of Object.entries(TOLERANCE)) {
        if (!(k in was) || !(k in now)) continue;
        const limit = was[k] * (1 + tol) + (tol === 0 ? 0 : 0.5);
        const over = now[k] > limit;
        if (over) bad++;
        console.log(`  ${k.padEnd(14)}${String(was[k]).padStart(10)} -> ${String(now[k]).padStart(9)}`
          + `  ${over ? 'REGRESSED' : 'ok'}`);
      }
      console.log(bad ? `\n${bad} figure(s) regressed.` : '\nno regressions.');
      if (bad) process.exitCode = 1;
    }
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('perfguard failed:', e.message); process.exitCode = 1; });
