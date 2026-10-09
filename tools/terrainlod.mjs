// Terrain LOD, before and after, from the same camera: shots plus the terrain's
// triangle and draw counts. "off" is every block at full detail (the terrain as
// it was drawn before the LOD: same vertices, same cells), "on" is the LOD.
//
//   AUTO_HTTP_PORT=8000 AUTO_CDP_PORT=9461 node tools/terrainlod.mjs [outdir] [--only=a,b]
//
// Views (name: eye -> target): altitude 1.5 / 3 / 6 km over downtown, the
// distances at which blocks change level (2.5 and 5 km, the eye on the ground
// looking along the ground so the band is on screen), street level downtown,
// and Alki looking across Elliott Bay at the city. Phone profile (iPhone UA),
// game paused, HUD hidden; the shots are 1748 x 804.
import { launchChrome, assertRenderer } from './chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9461;
const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'tools/data/terrainlod';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const DT = [305, -278];
const VIEWS = [
  { name: 'alt1500', eye: [DT[0] + 900, 1500, DT[1] + 1500], at: [DT[0], 0, DT[1]] },
  { name: 'alt3000', eye: [DT[0] + 1800, 3000, DT[1] + 3000], at: [DT[0], 0, DT[1]] },
  { name: 'alt6000', eye: [DT[0] + 3600, 6000, DT[1] + 6000], at: [DT[0], 0, DT[1]] },
  // The ground band the levels change at: high enough to see across, looking
  // south along the ground (Beacon Hill, SoDo, the Duwamish, Burien beyond).
  { name: 'edge2500', eye: [DT[0], 220, DT[1]], at: [DT[0] + 300, 40, DT[1] + 4000] },
  { name: 'edge5000', eye: [DT[0], 420, DT[1] - 400], at: [DT[0] + 800, 0, DT[1] + 7000] },
  { name: 'street', eye: [DT[0], 'g+1.8', DT[1]], at: [DT[0] + 60, 'g+10', DT[1] + 300] },
  { name: 'alki', eye: [-5409, 'g+2.5', 3905], at: [DT[0], 60, DT[1]] },
  { name: 'alkihigh', eye: [-5409, 'g+80', 3905], at: [DT[0], 60, DT[1]] },
  // over the seam between two 40 m / 80 m blocks, low and steep
  { name: 'seamlow', eye: [DT[0] + 2100, 'g+40', DT[1]], at: [DT[0] + 2600, 'g+0', DT[1] + 2500] },
];

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-terrainlod-${PORT}`, gpu: true, width: 874, height: 402, vsyncOff: true });
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(300); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 2, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__noAutoQuality = true; try { localStorage.setItem('auto-quality', 'high'); } catch (e) {}` });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  for (let i = 0; i < 240; i++) { if (await ev('window.__dbg.sceneStats.calls > 0')) break; await sleep(500); }
  await assertRenderer(ev);
  await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true);
    for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    d.game.paused = true; })()`);
  mkdirSync(OUT, { recursive: true });
  for (const V of VIEWS) {
    if (ONLY.length && !ONLY.includes(V.name)) continue;
    for (const mode of ['off', 'on']) {
      const r = JSON.parse(await ev(`(async () => {
        const d = window.__dbg, L = d.world.terrainLod, THREE = d.THREE, cam = d.camera;
        L.off = ${mode === 'off'};
        if (L.off) { L.lv.fill(0); for (const T of L.tiles) { T.dirty = true; T.mesh.visible = true; } }
        else { L.started = false; L.cx = NaN; }
        const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
        const P = (a) => [a[0], typeof a[1] === 'string' ? gy(a[0], a[2]) + parseFloat(a[1].slice(2)) : a[1], a[2]];
        const e = P(${JSON.stringify(V.eye)}), t = P(${JSON.stringify(V.at)});
        d.world.update(e[0], e[2], 60);
        cam.position.set(e[0], e[1], e[2]); cam.lookAt(t[0], t[1], t[2]); cam.updateMatrixWorld(true);
        d.world.updateTerrainLod(cam.position);
        await new Promise((r) => setTimeout(r, 2500));
        for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
        const fr = new THREE.Frustum(); fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        const sph = new THREE.Sphere();
        let tris = 0, calls = 0;
        for (const T of L.tiles) { if (!T.mesh.visible) continue; sph.copy(T.geo.boundingSphere); if (!fr.intersectsSphere(sph)) continue; calls++; tris += T.geo.drawRange.count / 3; }
        return JSON.stringify({ terrainTris: Math.round(tris), terrainCalls: calls, lv: Array.from(L.stats), total: d.sceneStats.tris, draws: d.sceneStats.calls });
      })()`));
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${V.name}-${mode}.png`, Buffer.from(result.data, 'base64'));
      console.log(`${V.name.padEnd(9)} ${mode.padEnd(3)} terrain ${String(r.terrainTris).padStart(7)} tris ${r.terrainCalls} draws  blocks L0/L1/L2/hidden ${r.lv.join('/')}  scene ${r.total} tris ${r.draws} draws`);
    }
  }
} catch (e) { console.log('ERR', e); process.exitCode = 1; } finally { chrome.kill('SIGKILL'); }
