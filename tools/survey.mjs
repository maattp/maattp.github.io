// Street-level survey. Poses the camera on the carriageway at a spread of
// locations and looks ALONG the road, which is the only way to actually see
// what the road surface looks like.
//
//   node tools/survey.mjs [count]
//
// A respawn is no good for this: it faces wherever the camera happened to be.
// Every shot here is deliberately aimed down a chosen edge.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9225;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'tools/data/survey';
const N = parseInt(process.argv[2] || '14', 10);

// Places worth looking at, chosen to hit every road class and the awkward
// geometry: interchanges, bridge touchdowns, junctions, park crossings.
// `elev:true` looks at a DECK. The survey skipped elevated edges entirely at
// first, which meant every viaduct in the city went unlooked-at -- and the
// freeways are exactly where the geometry is hardest.
const SITES = [
  ['fwy-i5-downtown', 900, 700, 'hwy'],
  ['fwy-i5-ship-canal', 1050, -3300, 'hwy'],
  ['fwy-i90-bridge', 3400, 2100, 'elev'],
  ['fwy-520-bridge', 3900, -3100, 'elev'],
  ['fwy-viaduct-99', -500, 1200, 'elev'],
  ['fwy-ws-bridge', -1900, 3050, 'elev'],
  ['fwy-i5-express', 1200, -1500, 'hwy'],
  ['fwy-ramp-mercer', 500, -1300, 'ramp'],
  ['downtown-grid', 300, 500],
  ['downtown-3rd', 120, 700],
  ['i5-express', 1270, 2641],
  ['i5-ship-canal', 1000, -3400],
  ['i5-interchange', 1294, 3982],
  ['aurora-bridge', -880, -4550],
  ['ballard-15th', -3466, -6100],
  ['fremont', -700, -4400],
  ['capitol-hill', 1947, -1296],
  ['west-seattle-bridge', -2100, 3100],
  ['sodo-marginal', 22, 6582],
  ['woodland-park', -676, -4842],
  ['alaskan-way', -400, 500],
  ['queen-anne-hill', -1436, -2853],
  ['ud-45th', 1900, -4400],
  ['rainier-ave', 3200, 4200],
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', '--no-first-run',
    '--user-data-dir=/tmp/auto-survey-profile', 'about:blank',
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
    const evaluate = async (e, aw = false) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw });
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
    console.log('booted\n');
    mkdirSync(OUT, { recursive: true });

    // Hide the HUD -- it covers a third of the frame and none of it is road.
    await evaluate(`(() => { for (const id of ['hud','pad','stickZone','objective'])
      { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      window.__dbg.game.paused = true; })()`);

    if (process.env.SURVEY_MUTATE) await evaluate(process.env.SURVEY_MUTATE);
    const sites = process.env.SURVEY_SITE
      ? SITES.filter((s) => s[0] === process.env.SURVEY_SITE)
      : SITES.slice(0, N);
    for (const [name, x, z, want] of sites) {
      const info = await evaluate(`(() => {
        const d = window.__dbg, c = d.city;
        // Nearest ground-level edge, and a camera posed just above its surface
        // looking along it -- eye height, like a driver.
        const want = ${JSON.stringify(want || 'ground')};
        let best = -1, bd = 1e9;
        for (const ei of c.edgesNear(${x}, ${z}, 700)) {
          const e = c.edges[ei];
          if (want === 'elev' ? !e.elev : e.elev) continue;
          if ((want === 'hwy' || want === 'ramp') && e.cls !== want) continue;
          const a = c.nodes[e.a], b = c.nodes[e.b];
          const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
          const dd = (mx - ${x}) ** 2 + (mz - ${z}) ** 2;
          if (dd < bd) { bd = dd; best = ei; }
        }
        if (best < 0) return null;
        const e = c.edges[best], a = c.nodes[e.a], b = c.nodes[e.b];
        const px = (a.x + b.x) / 2, pz = (a.z + b.z) / 2;
        d.world.update(px, pz, 60);
        const y = (e.elev ? (a.y + b.y) / 2 : c.groundAt(px, pz, null)) + 1.9;
        d.camera.position.set(px - e.dx * 22, y, pz - e.dz * 22);
        d.camera.lookAt(px + e.dx * 60, y - 1.1, pz + e.dz * 60);
        // Move the sun with the camera. The shadow camera is only ~105 m wide
        // and follows the player; posing a camera elsewhere without it leaves a
        // stale shadow map, which paints dark blotches over the asphalt and
        // looks exactly like a road-surface bug.
        d.sun.position.set(px - 150, y + 230, pz - 110);
        d.sun.target.position.set(px, y, pz);
        d.sun.target.updateMatrixWorld();
        d.camera.updateMatrixWorld(true);
        return { cls: e.cls, name: e.name, hw: +e.hw.toFixed(1),
                 x: +px.toFixed(0), z: +pz.toFixed(0), y: +y.toFixed(1) };
      })()`);
      if (!info) { console.log(`  ${name}: no ground edge nearby`); continue; }
      await sleep(6500);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(result.data, 'base64'));
      console.log(`  ${name.padEnd(20)} ${info.cls.padEnd(5)} hw=${String(info.hw).padStart(5)} `
        + `${info.name || ''}`);
    }
    console.log(`\n${N} shots in ${OUT}/`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('survey failed:', e.message); process.exitCode = 1; });
