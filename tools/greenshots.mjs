// How green the city reads, and what the trees cost: framed views of the
// forested parks, leafy neighbourhoods and tree-lined streets, plus a per-view
// breakdown of draws and triangles in the frustum.
//
//   AUTO_HTTP_PORT=8000 AUTO_CDP_PORT=9222 node tools/greenshots.mjs <outdir> [view,view...]
//         [--stats] [--fly] [--noshots]
//
//   AUTO_GPU=1     the Mac's GPU (fast; pair it with AUTO_GPU=1 on the other side)
//   AUTO_PHONE=1   the iPhone's UA and landscape viewport, so every ON_PHONE path
//                  (the phone's tree radii, no flat-mesh shadows) is the one shot
//   --stats        per view: the scene pass's own draws and triangles (sceneStats,
//                  after real frames), a frustum breakdown by category, the tree
//                  system's counts (world.trees.stats) and the GPU ledger
//   --fly          pose as an aircraft at the view's height: world.playerAlt and
//                  playerFlying set, so the streamer's flying LOD (3 x 3 detail)
//                  is what is drawn, as it is from a real plane
//   --noshots      stats only
//
// Same boot recipe as verify.mjs: service worker bypassed, __noAutoQuality,
// quality pinned to `high`, the streamer settled at every view, the HUD hidden,
// the game paused (the loop keeps drawing) and the sun placed by the game's own
// placeSun. Views are world coordinates -- a look-at point and a camera point --
// so two checkouts photograph the same thing. `street` views are found from the
// loaded city instead: the edge of the asked class nearest `near` with the most
// houses (or buildings) beside it, shot from its pavement along its length.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome, assertRenderer } from './chrome.mjs';

const PORT = +process.env.AUTO_CDP_PORT || 9222;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PHONE = process.env.AUTO_PHONE === '1';
const STATS = process.argv.includes('--stats');
const FLY = process.argv.includes('--fly');
const NOSHOTS = process.argv.includes('--noshots');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = args[0] || 'tools/data/green/now';
const ONLY = args[1] ? args[1].split(',') : null;

// t: look-at [x, z, height over ITS ground]; c: camera [x, z, height over ITS
// ground], or `cy` metres over the target's ground. fov defaults to the game's.
const VIEWS = [
  { name: 'capitol-air', t: [1180, -1552, 0], c: [1300, -1350, 0], cy: 140 },
  { name: 'magnolia-air', t: [-4631, -3142, 0], c: [-4400, -3000, 0], cy: 140 },
  { name: 'discovery-air', t: [-5834, -5521, 0], c: [-5600, -5300, 0], cy: 200 },
  { name: 'greenlake-air', t: [707, -7600, 0], c: [900, -7350, 0], cy: 160 },
  { name: 'arboretum-air', t: [3225, -3109, 0], c: [3350, -2900, 0], cy: 140 },
  { name: 'seward-air', t: [6496, 6008, 0], c: [6350, 6200, 0], cy: 140 },
  { name: 'alki-air', t: [-5383, 3418, 0], c: [-5150, 3500, 0], cy: 130 },
  { name: 'wseattle-air', t: [-3661, 5430, 0], c: [-3500, 5600, 0], cy: 140 },
  { name: 'discovery-ground', t: [-5834, -5521, 2], c: [-5780, -5470, 1.7] },
  { name: 'greenlake-shore', t: [500, -7600, 1], c: [640, -7560, 1.7] },
  { name: 'residential-street', t: [1180, -1400, 3], c: [1200, -1450, 1.7] },
  { name: 'id-street', t: [1083, 1483, 6], c: [1020, 1540, 1.7] },
  // found from the city: a house-lined residential street on Capitol Hill,
  // one in Wallingford, and a downtown arterial, each shot along its length
  { name: 'house-street', street: 'res', near: [1500, -2300] },
  { name: 'wallingford-street', street: 'res', near: [-200, -5600] },
  { name: 'arterial-street', street: 'art', near: [300, 250] },
  // perfcpu's two standing spots (foot-dt, foot-yt), at eye level
  { name: 'dt-foot', t: [380, -330, 3], c: [305, -278, 1.7] },
  { name: 'yt-foot', t: [1330, 1060, 3], c: [1409, 1120, 1.7] },
];

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-green-${PORT}`, width: 1280, height: 720 });
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map(); const errs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception');
    });
    const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
    const evaluate = async (e, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    if (PHONE) {
      await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__noAutoQuality = true; try { localStorage.setItem('auto-quality', 'high'); } catch (e) {}` });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
    for (let i = 0; i < 900; i++) {
      await sleep(500);
      try { if (await evaluate('!!window.__dbg')) break; } catch { /* navigating */ }
    }
    for (let i = 0; i < 240; i++) {
      try { if (await evaluate('window.__dbg.sceneStats.calls > 0')) break; } catch { /* */ }
      await sleep(500);
    }
    await assertRenderer(evaluate);
    const build = await evaluate(`(document.getElementById('build') || {}).textContent`);
    console.log(`  build ${build}${PHONE ? ' [phone profile]' : ''}${FLY ? ' [flying LOD]' : ''}`);
    await evaluate(`(() => {
      const d = window.__dbg;
      d.applyQuality('high', true);
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','minimap'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
    })()`);

    // GREEN_PROBE='<expr>' / GREEN_PROBE_FILE: a one-off diagnostic on this
    // boot (awaited, `d = window.__dbg` in scope if the expression asks for it);
    // prints its value and exits without shooting.
    const PROBE = process.env.GREEN_PROBE || (process.env.GREEN_PROBE_FILE && readFileSync(process.env.GREEN_PROBE_FILE, 'utf8'));
    if (PROBE) {
      const v = await evaluate(PROBE, true);
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
      // GREEN_PROBE_SHOT=<file.png>: then a screenshot of what the probe posed
      if (process.env.GREEN_PROBE_SHOT) {
        await evaluate(`new Promise((r) => { let n = 0; const f = () => (++n >= 8 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })`, true);
        await sleep(1000);
        const { result } = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(process.env.GREEN_PROBE_SHOT, Buffer.from(result.data, 'base64'));
      }
      console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
      return;
    }

    if (!NOSHOTS) mkdirSync(OUT, { recursive: true });
    const report = {};
    for (const V of VIEWS) {
      if (ONLY && !ONLY.includes(V.name)) continue;
      const res = await evaluate(`(() => {
        const d = window.__dbg, city = d.city, G = d.G, world = d.world;
        const V = ${JSON.stringify(V)};
        let tx, tz, th, cx, cz, ch, cyAbs = null;
        if (V.street) {
          // the edge of class V.street nearest V.near with the most buildings
          // within 40 m (houses count double on a residential street)
          let best = null, bs = -Infinity;
          for (const e of city.edges) {
            if (e.cls !== V.street || e.elev || e.tunnel || e.len < 25) continue;
            const a = city.nodes[e.a], b = city.nodes[e.b];
            const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
            const dn = Math.hypot(mx - V.near[0], mz - V.near[1]);
            if (dn > 1500) continue;
            let s = 0;
            for (const bd of city.buildingsNear(mx, mz, 45)) s += bd.style === 'house' ? (V.street === 'res' ? 2 : 0.5) : (V.street === 'res' ? 0.2 : 1);
            s -= dn / 60;
            if (s > bs) { bs = s; best = e; }
          }
          if (!best) return JSON.stringify({ err: 'no ' + V.street + ' street near ' + V.near });
          const a = city.nodes[best.a], b = city.nodes[best.b];
          // a chase camera's view: in the near lane 4 m in from one end, 2.6 m
          // up, looking down the street
          const ux = (b.x - a.x) / best.len, uz = (b.z - a.z) / best.len;
          const off = best.hw * 0.4;
          cx = a.x + ux * 4 - uz * off; cz = a.z + uz * 4 + ux * off; ch = 2.6;
          tx = a.x + ux * 140 - uz * off * 0.5; tz = a.z + uz * 140 + ux * off * 0.5; th = 3;
        } else {
          [tx, tz, th] = V.t; [cx, cz, ch] = V.c;
        }
        if (${FLY} && V.cy) { world.playerAlt = V.cy; world.playerFlying = true; }
        else { world.playerAlt = 0; world.playerFlying = false; world.flyLod = false; }
        const pending = () => [...world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
        world.update(cx, cz, 60);
        for (let i = 0; i < 4000 && pending() > 0; i++) world.update(cx, cz, 60);
        const gy = (x, z) => Math.max(0, city.groundAt(x, z, null));
        const ty = gy(tx, tz);
        const cy = V.cy !== undefined ? ty + V.cy : gy(cx, cz) + ch;
        d.camera.fov = V.fov || 62;
        d.camera.updateProjectionMatrix();
        d.camera.position.set(cx, cy, cz);
        d.camera.lookAt(tx, ty + th, tz);
        d.camera.updateMatrixWorld(true);
        // the game's own sun, its shadow box on what the view is about
        if (V.cy !== undefined) d.placeSun(tx, ty, tz); else d.placeSun(cx, cy, cz);
        const dir = new d.THREE.Vector3(tx - cx, 0, tz - cz).normalize();
        d.traffic.updateParked(cx, cz);
        for (let i = 0; i < 12; i++) d.traffic.spawnTraffic(cx, cz, dir);
        if (d.peds && d.peds.spawn) for (let i = 0; i < 16; i++) d.peds.spawn(cx, cz);
        for (let i = 0; i < 4; i++) {
          d.traffic.update(0.016, cx, cz, dir, d.player);
          d.peds.update(0.016, cx, cz, d.player, d.traffic);
        }
        if (d.shadowCache) d.shadowCache.invalidate();
        return JSON.stringify({ cam: [Math.round(cx), Math.round(cy), Math.round(cz)], look: [Math.round(tx), Math.round(tz)] });
      })()`);
      // real frames: the instanced tiers refresh on the frame's own camera
      await evaluate(`new Promise((r) => { let n = 0; const f = () => (++n >= 12 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })`, true);
      await sleep(+process.env.GREEN_WAIT || 1500);
      const r = JSON.parse(res);
      if (r.err) { console.log(`  ${V.name}: ${r.err}`); continue; }
      let line = `  ${V.name.padEnd(20)} cam ${r.cam.join(',')} -> ${r.look.join(',')}`;
      if (!NOSHOTS) {
        const { result } = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${OUT}/${V.name}.png`, Buffer.from(result.data, 'base64'));
      }
      if (STATS) {
        const s = JSON.parse(await evaluate(STATS_EXPR));
        report[V.name] = s;
        line += `\n      scene ${s.scene.calls} draws ${Math.round(s.scene.tris / 1000)}k tris | frustum ${s.total.calls} meshes ${Math.round(s.total.tris / 1000)}k tris | gpu ${s.gpu ? s.gpu.gpuMB + ' MB (bufs ' + s.gpu.bufMB + ')' : '-'} | heap ${s.heapMB} MB`;
        if (s.trees) line += `\n      trees ${JSON.stringify(s.trees)}`;
        for (const c of s.top.slice(0, 12)) line += `\n      ${String(c.trisK).padStart(6)}k ${String(c.calls).padStart(4)} draws  ${c.k}`;
      }
      console.log(line);
    }
    if (STATS) writeFileSync(`${OUT}${NOSHOTS ? '-' : '/'}stats.json`, JSON.stringify(report, null, 1));
    console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

// The frustum by category, as the scene pass would draw it: the chunk groups
// split by LOD and material, the tree tiers by name, everything else by its
// top-level object. Instanced meshes count instances x triangles.
const STATS_EXPR = `(() => {
  const d = window.__dbg, THREE = d.THREE, cam = d.camera, scene = d.scene;
  scene.updateMatrixWorld(true); cam.updateMatrixWorld(true);
  const fr = new THREE.Frustum();
  fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const sph = new THREE.Sphere();
  const chunkLod = new Map();
  for (const c of d.world.chunks.values()) if (c.group) chunkLod.set(c.group, c.lod);
  const rows = {}, total = { calls: 0, tris: 0 };
  const top = (o) => { let t = o; while (t.parent && t.parent !== scene) t = t.parent; return t; };
  scene.traverseVisible((o) => {
    if (!o.isMesh) return;
    const g = o.geometry; if (!g) return;
    if (o.frustumCulled !== false) {
      if (!g.boundingSphere) g.computeBoundingSphere();
      sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
      if (!fr.intersectsSphere(sph)) return;
    }
    let tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (g.drawRange && g.drawRange.count !== Infinity) tris = Math.min(tris, g.drawRange.count / 3);
    if (o.isInstancedMesh) tris *= o.count;
    let k;
    let ch = null; for (let p = o.parent; p; p = p.parent) if (chunkLod.has(p)) { ch = p; break; }
    const mats = d.world.mats || {};
    const mname = Object.keys(mats).find((n) => mats[n] === o.material) || '';
    if (ch) k = 'chunk lod' + chunkLod.get(ch) + ' ' + (mname || o.material.type);
    else if (top(o) === d.world.terrainGroup) k = 'terrain';
    else k = (o.name || top(o).name || top(o).type) + (o.isInstancedMesh ? ' [inst ' + o.count + ']' : '');
    const r = rows[k] || (rows[k] = { calls: 0, tris: 0 });
    r.calls++; r.tris += tris; total.calls++; total.tris += tris;
  });
  const topRows = Object.entries(rows).map(([k, r]) => ({ k, calls: r.calls, trisK: Math.round(r.tris / 1000) })).sort((a, b) => b.trisK - a.trisK);
  const gpu = d.gpuLedger ? d.gpuLedger.read() : null;
  const heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  const trees = d.world.trees && d.world.trees.stats ? d.world.trees.stats() : null;
  if (trees) { trees.planted = d.cityStats.treesByKind; trees.rejects = d.cityStats.treeRejects; }
  return JSON.stringify({ scene: { calls: d.sceneStats.calls, tris: d.sceneStats.tris }, total, top: topRows, gpu, heapMB, trees });
})()`;

main().catch((e) => { console.error('greenshots failed:', e.message); process.exitCode = 1; });
