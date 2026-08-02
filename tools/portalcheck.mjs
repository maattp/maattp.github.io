// Judge the tunnel portals by LOGIC, not by looking at them.
//
// Every portal defect that shipped in this branch was invisible in the render
// that was used to sign it off: a pier hanging in the air reads as a pier from
// straight on, and a wall standing 20 m in front of the holes reads as a wall.
// Both are one subtraction away from the geometry, so the geometry is what gets
// asked. world.js records what meshPortalWall actually built in
// `world.portalParts`; this walks it.
//
// Usage:  python3 -m http.server 8000  then  node tools/portalcheck.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9243;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new',
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=900,600',
  '--no-first-run', '--user-data-dir=/tmp/auto-pcheck', 'about:blank'], { stdio: 'ignore' });

let bad = 0;
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
    if (r.exceptionDetails || r.result?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails || r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: 'http://localhost:8000/apps/auto/' });
  for (let i = 0; i < 400; i++) { await sleep(500); if (await ev('!!window.__dbg')) break; }

  // Build every chunk that holds a portal, so every wall gets recorded.
  const n = await ev(`(() => {
    const d = window.__dbg;
    d.applyQuality('high', true);
    d.game.paused = true;
    d.world.portalParts = [];
    const seen = new Set();
    const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
    for (const [ni] of d.world.portalGroups()) {
      const nd = d.city.nodes[ni];
      const k = Math.round(nd.x / 400) + ':' + Math.round(nd.z / 400);
      if (seen.has(k)) continue;
      seen.add(k);
      d.world.update(nd.x, nd.z, 60);
      for (let i = 0; i < 2500 && pending() > 0; i++) d.world.update(nd.x, nd.z, 60);
    }
    return d.world.portalParts.length;
  })()`);

  const report = JSON.parse(await ev(`(() => {
    const d = window.__dbg, G = d.G, out = [];
    for (const w of d.world.portalParts) {
      const faults = [];
      // 1. NOTHING MAY FLOAT. Sample the ground across each part's footprint;
      //    a part whose foot clears the highest of those samples is standing in
      //    the air. The lintel is exempt -- it is carried by the piers, which
      //    check 2 proves are there.
      for (const p of w.parts) {
        if (p.kind === 'lintel') continue;
        let g = -1e9;
        for (let s = -0.5; s <= 0.5; s += 0.25) {
          const x = p.x + (-w.dz) * p.w * s, z = p.z + w.dx * p.w * s;
          g = Math.max(g, G.terrainHeight(x, z));
        }
        if (p.base - g > 0.3) faults.push('pier floats ' + (p.base - g).toFixed(2) + ' m above ground');
      }
      // 2. THE LINTEL MUST LAND ON PIERS. Its two ends have to be over a pier,
      //    or the beam ends in mid-air -- which is what three staggered frames
      //    looked like before the mouths were grouped.
      const piers = w.parts.filter((p) => p.kind === 'pier');
      if (!piers.length) faults.push('lintel with no pier under it');
      // 3. NO BORE MAY POKE THROUGH THE WALL, and no bore may be left
      //    unconnected to it. A bore in front of the plane is an open-sided
      //    tube standing in the daylight beside the mouth; a bore behind it
      //    with no throat leaves the wall a free-standing slab with sky behind
      //    -- read from the road as a pillar floating before the holes.
      //    Distance behind is FINE, that is what the throat is for; the test
      //    is sign and connection, not proximity. Testing proximity instead
      //    is what split one divided highway into three staggered walls.
      for (const m of w.mouths) {
        if (m.along < -0.05) faults.push('bore ' + (-m.along).toFixed(1) + ' m in FRONT of the wall');
        else if (m.along > 0.5 && !m.throat) faults.push('bore ' + m.along.toFixed(1) + ' m behind the wall with no throat');
        else if (m.along > 60) faults.push('throat ' + m.along.toFixed(1) + ' m long');
      }
      // 4. THE OPENINGS MUST BE THE BORES. One hole per mouth, no more.
      if (w.mouths.length > 4) faults.push(w.mouths.length + ' bores in one mouth');
      out.push({ x: Math.round(w.x), z: Math.round(w.z), parts: w.parts.length,
                 mouths: w.mouths.length, faults });
    }
    return JSON.stringify(out);
  })()`));

  console.log(`portal walls built: ${n}\\n`);
  for (const w of report) {
    const tag = w.faults.length ? 'FAIL' : 'ok  ';
    console.log(`${tag} (${w.x},${w.z})  ${w.mouths} bore(s), ${w.parts} parts` +
      (w.faults.length ? '\n       ' + w.faults.join('\n       ') : ''));
    if (w.faults.length) bad++;
  }
  console.log(`\n${bad} of ${report.length} portal walls have faults`);
} finally { chrome.kill(); }
process.exit(bad ? 1 : 0);
