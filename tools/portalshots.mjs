// Every tunnel portal in the game, same camera on each build.
//
// Portals are found BY POSITION (a tunnel node that also carries a surface
// edge, clustered at 200 m), so a changed graph cannot silently move a shot
// and make a before/after pair incomparable. The camera is a driver's eye on
// the surface approach looking at the mouth -- the view the complaint is about.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const TAG = process.argv[2] || 'now';
const PORT = 9240;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new',
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1100,650',
  '--no-first-run', `--user-data-dir=/tmp/auto-pcmp-${TAG}`, 'about:blank'], { stdio: 'ignore' });
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails || r.result?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails || r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: 'http://localhost:8000/apps/auto/' });
  for (let i = 0; i < 400; i++) { await sleep(500); if (await ev('!!window.__dbg')) break; }

  const n = await ev(`(() => {
    const d = window.__dbg;
    d.applyQuality('high', true);
    for (const k of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu','minimap'])
      { const e = document.getElementById(k); if (e) e.style.display = 'none'; }
    const c = d.city;
    // A portal is a tunnel node that also carries a surface edge. Cluster at
    // 200 m: a divided road has one per carriageway and they are one mouth.
    c.nodes.forEach((n, i) => { n.__i = i; });
    const raw = [];
    for (const e of c.edges) {
      if (!e.tunnel || e.elev) continue;
      for (const ni of [e.a, e.b]) {
        const nd = c.nodes[ni];
        if (!nd.e.some((k) => !c.edges[k].tunnel)) continue;
        const o = c.nodes[e.a === ni ? e.b : e.a];
        const L = Math.hypot(o.x - nd.x, o.z - nd.z) || 1;
        // The camera belongs on the SURFACE approach, which is not always
        // collinear with the bore: at the east I-90 portal the bore's own
        // back-bearing walks off the road and down a hillside, putting the
        // camera 30 m under the deck looking up into the ceiling.
        const se = nd.e.map((k) => c.edges[k]).find((k) => !k.tunnel);
        let ax = -(o.x - nd.x) / L, az = -(o.z - nd.z) / L;
        if (se) {
          const so = c.nodes[se.a === nd.__i ? se.b : se.a];
          const SL = Math.hypot(so.x - nd.x, so.z - nd.z) || 1;
          ax = (so.x - nd.x) / SL; az = (so.z - nd.z) / SL;
        }
        raw.push({ x: nd.x, y: nd.y, z: nd.z, dx: (o.x - nd.x) / L, dz: (o.z - nd.z) / L,
                   ax, az, ni: nd.__i, hw: e.hw });
      }
    }
    // AIM AT THE MOUTH, NOT THE PORTAL NODE. Since the portal node was dropped
    // below grade and the approach ramps into it, that node sits in the MIDDLE
    // of the cutting -- a camera placed off it looks at a bore 90 m away and
    // reports "no tunnel". The mouth is the far end of the carved corridor.
    const cuts = d.world.portalCuts ? d.world.portalCuts() : [];
    const endBy = new Map();
    for (const c of cuts) endBy.set(c.ni, c.pts[c.pts.length - 1]);
    for (const r of raw) {
      const e = endBy.get(r.ni);
      if (!e) continue;
      const L = Math.hypot(e.x - r.x, e.z - r.z);
      if (L < 5) continue;
      r.dx = (e.x - r.x) / L; r.dz = (e.z - r.z) / L;
      r.ax = -r.dx; r.az = -r.dz;
      r.x = e.x; r.z = e.z; r.y = e.y;
    }
    raw.sort((a, b) => b.hw - a.hw);           // widest of a cluster wins
    const sites = [];
    for (const r of raw) {
      if (sites.some((s) => Math.hypot(s.x - r.x, s.z - r.z) < 320)) continue;
      sites.push(r);
    }
    window.__sites = sites;
    return sites.length;
  })()`);
  console.log(`${n} portals`);
  const list = JSON.parse(await ev('JSON.stringify(window.__sites.map((s,i)=>({i,x:Math.round(s.x),z:Math.round(s.z),hw:+s.hw.toFixed(1)})).filter(s=>s.i===14))'));
  mkdirSync('docs/tun', { recursive: true });
  const out = [];

  for (const s of list) {
   for (const [back, side, tag2] of [[46,0,'front46'],[22,0,'front22'],[26,-26,'left'],[26,26,'right'],[9,0,'inside']]) {
    // Settle the streamer at this site before drawing it: chunk geometry is
    // time-sliced, so shooting straight after a warp photographs a half-built
    // city and the difference between builds hides under the gap.
    const info0 = await ev(`(() => {
      const d = window.__dbg, S = window.__sites[${s.i}], G = d.G;
      const back = ${back};
      const cx = S.x + S.ax * back, cz = S.z + S.az * back;
      d.game.paused = true;
      const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
      d.world.update(cx, cz, 60);
      for (let i = 0; i < 3000 && pending() > 0; i++) d.world.update(cx, cz, 60);
      d.camera.fov = 62; d.camera.updateProjectionMatrix();
      const eye = Math.max(G.terrainHeight(cx, cz), d.city.groundAt(cx, cz, null)) + 2.6;
      d.camera.position.set(cx, eye, cz);
      d.camera.lookAt(S.x + S.dx * 26, S.y + 1.0, S.z + S.dz * 26);
      d.camera.updateMatrixWorld(true);
      // depth of cut every 15 m in, so the picture carries a number
      const cut = [];
      for (let m = 0; m <= 150; m += 15) {
        const px = S.x + S.dx * m, pz = S.z + S.dz * m;
        cut.push(Math.round((G.terrainHeight(px, pz) - d.city.groundAt(px, pz, S.y - m * 0.09)) * 10) / 10);
      }
      return JSON.stringify(cut);
    })()`);
    // let the RAF loop draw the posed camera, then hold it (paused, so nothing
    // moves it back) for a few frames before grabbing the composited canvas
    for (let k = 0; k < 4; k++) { await sleep(450); await ev(`(() => { const d = window.__dbg, S = window.__sites[${s.i}], G = d.G;
      const px=-S.az, pz=S.ax; const cx = S.x + S.ax * ${back} + px*${side}, cz = S.z + S.az * ${back} + pz*${side};
      const eye = Math.max(G.terrainHeight(cx, cz), d.city.groundAt(cx, cz, null)) + 2.6;
      d.camera.position.set(cx, eye, cz);
      d.camera.lookAt(S.x + S.dx * 26, S.y + 1.0, S.z + S.dz * 26); })()`); }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`docs/tun/p${s.i}-${TAG}-${tag2}.png`, Buffer.from(shot.result.data, 'base64'));
    console.log(`p${s.i} (${s.x},${s.z}) hw=${s.hw}`);
    }
    out.push({ i: s.i, x: s.x, z: s.z, hw: s.hw });
  }
  writeFileSync(`docs/tun/portals-${TAG}.json`, JSON.stringify(out, null, 1));
} finally { chrome.kill(); }
