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
    // The last point of a corridor is the CAP -- the raised closure over the
    // bore, 14 m past the mouth and 7 m above it. Framing on it put the
    // "inside" camera BEHIND the headwall, photographing the closure mound from
    // a spot no driver can reach. The mouth is the last real corridor point.
    for (const c of cuts) {
      let li = c.pts.length - 1;
      while (li > 0 && c.pts[li].cap) li--;
      endBy.set(c.ni, c.pts[li]);
    }
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
  const list = JSON.parse(await ev('JSON.stringify(window.__sites.map((s,i)=>({i,x:Math.round(s.x),z:Math.round(s.z),hw:+s.hw.toFixed(1)})))'));
  mkdirSync('docs/tun', { recursive: true });
  const out = [];

  const s = list[0];
  const info = await ev(`(() => {
    const d = window.__dbg, G = d.G, S = window.__sites[${s.i}];
    const c = d.city, p = d.player;
    // walk into the bore from this mouth
    let cur = S.ni, prev = -1, dist = 0; const path = [];
    while (dist < 200) {
      const n = c.nodes[cur]; let pick = null;
      for (const k of n.e) { const e = c.edges[k];
        if (!e.tunnel || k === prev) continue;
        if (pick === null || e.hw > c.edges[pick].hw) pick = k; }
      if (pick === null) break;
      const e = c.edges[pick]; const nx = e.a === cur ? e.b : e.a;
      const a = c.nodes[cur], b = c.nodes[nx];
      for (let t = 0.25; t <= 1; t += 0.25) {
        path.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
                    y: a.y + (b.y - a.y) * t,
                    hx: (b.x - a.x) / e.len, hz: (b.z - a.z) / e.len });
      }
      dist += e.len; prev = pick; cur = nx;
    }
    const pend = () => [...d.world.chunks.values()].filter((q) => q.lod !== q.wantLod).length;
    const rows = [];
    // A stand-in for the car: updateCamera reads only these fields, and a real
    // carjack needs traffic to have spawned one at this spot.
    p.onFoot = false;
    p.vehicle = { x: 0, y: 0, z: 0, vLong: 16, vy: 0, spec: { len: 4.4, roof: 1.4 } };
    for (const st of path) {
      d.world.update(st.x, st.z, 60);
      for (let i = 0; i < 700 && pend() > 0; i++) d.world.update(st.x, st.z, 60);
      const v = p.vehicle;
      v.x = st.x; v.y = st.y + 0.45; v.z = st.z;
      p.x = st.x; p.y = st.y + 0.45; p.z = st.z;
      p.camYaw = Math.atan2(st.hx, st.hz) + Math.PI;
      // Start the boom where a moving car would already have dragged it, then
      // settle. Teleporting the car and leaving camPos where the last station
      // left it measures the rig's lag, not the game's camera.
      p.camFloor = null;
      p.camPos.set(st.x - st.hx * 11, st.y + 4.2, st.z - st.hz * 11);
      for (let i = 0; i < 120; i++) p.updateCamera(1 / 60, { x: 0, y: 0 });
      const deck = st.y + 0.3, roof = deck + 5.4;
      rows.push({ deck: +deck.toFixed(1), roof: +roof.toFixed(1),
                  cam: +p.camPos.y.toFixed(1),
                  over: +(p.camPos.y - roof).toFixed(2) });
    }
    window.__last = path[path.length - 1];
    return JSON.stringify(rows);
  })()`);
  const rows = JSON.parse(info);
  let bad = 0, worst = -99;
  console.log(' deck   roof    camY   over');
  for (const r of rows) {
    if (r.over > 0) { bad++; worst = Math.max(worst, r.over); }
    console.log(String(r.deck).padStart(5), String(r.roof).padStart(7), String(r.cam).padStart(7), String(r.over).padStart(7), r.over > 0 ? ' <-- through the roof' : '');
  }
  console.log(`\n${bad} of ${rows.length} stations put the camera through the roof` + (bad ? `, worst ${worst} m` : ''));
  for (let k = 0; k < 4; k++) { await sleep(400); }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('docs/tun/camera-in-tunnel.png', Buffer.from(shot.result.data, 'base64'));
} finally { chrome.kill(); }
