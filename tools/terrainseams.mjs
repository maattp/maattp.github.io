// Terrain LOD: is the composed mesh watertight where blocks of different
// strides meet? For a set of camera positions (a ring of spots over the map at
// several altitudes, so every pairing of levels and every tile border turns
// up), every visible tile's index is composed and the edges of the whole
// terrain are collected by position. An edge used by one triangle only is a
// boundary; two boundary edges that overlap on one line (a long edge and the
// shorter ones that cover it) are a T-junction, i.e. a crack. Edges under 40 m
// are the cut cells' own 4 m lattice and are not judged (they meet the 40 m
// grid that way at every level, by design).
//
//   AUTO_HTTP_PORT=8000 AUTO_CDP_PORT=9461 node tools/terrainseams.mjs
//
// SEAMS_BREAK=1 turns stitching off, to show the check fails when it should.
// Runs with the JS arrays kept (`__keepArrays`) so the positions can be read.
import { launchChrome } from './chrome.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9461;
const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-terrainseams-${PORT}`, gpu: false, width: 640, height: 360, vsyncOff: true });
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true; window.__keepArrays = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 900; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  const out = JSON.parse(await ev(`(() => {
    const d = window.__dbg, L = d.world.terrainLod;
    const results = [];
    if (${JSON.stringify(!!process.env.SEAMS_BREAK)}) L.ratio = () => 1;   // negative control: no stitching
    const spots = [];
    for (const alt of [60, 400, 1500, 4000]) for (const [x, z] of [[305, -278], [-4650, 2794], [1038, -7651], [6000, 4000], [-9000, -3000], [2000, 9000], [-12000, 12000], [11000, -11000]]) spots.push([x, alt, z]);
    // a few offsets so block boundaries fall in different places
    for (let k = 0; k < 12; k++) spots.push([305 + k * 173, 200 + k * 90, -278 + k * 211]);
    let total = 0, cracks = 0;
    for (const [x, y, z] of spots) {
      L.off = false; L.started = false; L.cx = NaN;
      d.world.updateTerrainLod({ x, y, z });
      const vid = new Map(), edges = new Map();
      const vkey = (px, pz) => (Math.round(px) + 20000) * 50000 + (Math.round(pz) + 20000);
      let tris = 0;
      for (const T of L.tiles) {
        if (!T.mesh.visible) continue;
        d.world._composeTerrain(T);
        const idx = T.wide ? L.s32 : L.s16, n = T.geo.drawRange.count, P = T.geo.attributes.position.array;
        const ids = new Int32Array(P.length / 3).fill(-1);
        const vi = (i) => { let v = ids[i]; if (v >= 0) return v; const k = vkey(P[i * 3], P[i * 3 + 2]); v = vid.get(k); if (v === undefined) { v = vid.size; vid.set(k, v); } ids[i] = v; return v; };
        for (let t = 0; t < n; t += 3) {
          const a = vi(idx[t]), b = vi(idx[t + 1]), c = vi(idx[t + 2]);
          for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = Math.min(p, q) * 2097152 + Math.max(p, q); edges.set(k, (edges.get(k) || 0) + 1); }
        }
        tris += n / 3;
      }
      const pt = new Array(vid.size);
      for (const [k, v] of vid) pt[v] = [Math.floor(k / 50000) - 20000, (k % 50000) - 20000];
      const H = new Map(), V = new Map();   // line -> [[lo, hi]]
      for (const [k, c] of edges) {
        if (c !== 1) continue;
        const p = pt[Math.floor(k / 2097152)], q = pt[k % 2097152];
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 39.5) continue;
        if (p[1] === q[1]) { const l = H.get(p[1]) || []; l.push([Math.min(p[0], q[0]), Math.max(p[0], q[0])]); H.set(p[1], l); }
        else if (p[0] === q[0]) { const l = V.get(p[0]) || []; l.push([Math.min(p[1], q[1]), Math.max(p[1], q[1])]); V.set(p[0], l); }
      }
      let bad = 0; const where = [];
      for (const [name, M] of [['z', H], ['x', V]]) {
        for (const [line, segs] of M) {
          segs.sort((a, b) => a[0] - b[0]);
          let end = -Infinity;
          for (let i = 0; i < segs.length; i++) {
            if (segs[i][0] < end - 0.5) { bad++; if (where.length < 3) where.push(name + '=' + line + ' ' + segs[i][0] + '..' + end); }
            if (segs[i][1] > end) end = segs[i][1];
          }
        }
      }
      total++; cracks += bad;
      results.push({ at: [x, y, z].join(','), tris, bad, where: bad ? where : undefined, lv: Array.from(L.stats) });
    }
    return JSON.stringify({ spots: total, cracks, bad: results.filter((r) => r.bad), sample: results.slice(0, 3) });
  })()`));
  console.log(JSON.stringify(out, null, 1));
  console.log(out.cracks === 0 ? `PASS: ${out.spots} camera spots, no T-junctions` : `FAIL: ${out.cracks} T-junctions`);
  if (out.cracks) process.exitCode = 1;
} catch (e) { console.log('ERR', e); process.exitCode = 1; } finally { chrome.kill('SIGKILL'); }
