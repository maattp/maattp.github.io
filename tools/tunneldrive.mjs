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
    if (r.exceptionDetails || r.result?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails || r.result.exceptionDetails).slice(0, 1200));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: 'http://localhost:8000/apps/auto/' });
  for (let i = 0; i < 400; i++) { await sleep(500); if (await ev('!!window.__dbg')) break; }

  // ---- Test A: traverse the SR-99 bore under the real sim -----------------
  const setup = await ev(`(() => { try {
    const d = window.__dbg, c = d.city, p = d.player;
    d.applyQuality('low', true);
    let best = null, bd = 1e18;
    for (const e of c.edges) {
      if (!e.tunnel || e.elev) continue;
      for (const ni of [e.a, e.b]) {
        const n = c.nodes[ni];
        if (!n.e.some((k) => !c.edges[k].tunnel)) continue;
        const dd = (n.x + 490) ** 2 + (n.z + 1209) ** 2;
        if (dd < bd) { bd = dd; best = { ni, e }; }
      }
    }
    // waypoints: surface approach start, then the bore graph for 700 m
    const P = c.nodes[best.ni];
    const se = P.e.map((k) => c.edges[k]).find((k) => !k.tunnel);
    const so = se ? c.nodes[se.a === best.ni ? se.b : se.a] : null;
    const wps = [];
    if (so) {
      const L = Math.hypot(so.x - P.x, so.z - P.z) || 1;
      wps.push({ x: P.x + ((so.x - P.x) / L) * 55, z: P.z + ((so.z - P.z) / L) * 55 });
    }
    wps.push({ x: P.x, z: P.z });
    let cur = best.ni, prev = -1, dist = 0;
    while (dist < 700) {
      const n = c.nodes[cur]; let pick = null;
      for (const k of n.e) { const e = c.edges[k];
        if (!e.tunnel || k === prev) continue;
        if (pick === null || e.hw > c.edges[pick].hw) pick = k; }
      if (pick === null) break;
      const e = c.edges[pick]; const nx = e.a === cur ? e.b : e.a;
      wps.push({ x: c.nodes[nx].x, z: c.nodes[nx].z });
      dist += e.len; prev = pick; cur = nx;
    }
    window.__wps = wps; window.__wpi = 0; window.__tele = [];
    p.x = wps[0].x; p.z = wps[0].z;
    p.y = c.groundAt(wps[0].x, wps[0].z, null, 0) + 0.3;
    return JSON.stringify({ wps: wps.length, dist: Math.round(dist) });
  } catch (err) { return 'SETUP-ERR ' + err.message + ' | ' + err.stack.split('\\n')[1]; } })()`);
  console.log('setup', setup);

  // let traffic spawn around the teleported player, then take a car
  let carOk = 'no';
  for (let tries = 0; tries < 20 && carOk === 'no'; tries++) {
    await sleep(1500);
    carOk = await ev(`(() => {
      const d = window.__dbg, p = d.player;
      if (p.vehicle) return 'yes';
      const v = d.traffic.nearestEnterable(p.x, p.z, 300);
      if (!v) return 'no';
      p.enterVehicle(v);
      return p.vehicle ? 'yes' : 'no';
    })()`);
  }
  if (carOk !== 'yes') { console.log('FAIL: never got a car'); process.exit(1); }

  // heading assist + telemetry, driven by the page's own frame loop
  await ev(`(() => {
    const d = window.__dbg, p = d.player;
    d.controls.btn.gas = true;
    window.__assist = setInterval(() => {
      const v = p.vehicle; if (!v) return;
      const wps = window.__wps;
      let i = window.__wpi;
      while (i < wps.length - 1 &&
        Math.hypot(wps[i].x - v.x, wps[i].z - v.z) < 22) i++;
      window.__wpi = i;
      const t = wps[i];
      const want = Math.atan2(t.x - v.x, t.z - v.z);
      let dh = want - v.heading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      v.heading += Math.max(-0.09, Math.min(0.09, dh));
      window.__tele.push([+v.x.toFixed(1), +v.y.toFixed(2), +v.z.toFixed(1),
        +d.G.terrainRaw(v.x, v.z).toFixed(1)]);
      if (window.__tele.length > 4000) window.__tele.shift();
    }, 120);
    return 1;
  })()`);

  // run until the last waypoint or a stall
  let done = null;
  let midShot = false;
  for (let t = 0; t < 360 && !done; t++) {
    await sleep(2000);
    if (!midShot && t > 4) {
      const wpNow = await ev('window.__wpi');
      if (wpNow >= 7) {
        midShot = true;
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync('docs/tun/drive-inside.png', Buffer.from(shot.result.data, 'base64'));
        console.log('mid-drive shot at wp', wpNow);
      }
    }
    done = await ev(`(() => {
      const w = window.__wps, i = window.__wpi, d = window.__dbg;
      const v = d.player.vehicle; if (!v) return 'lost-car';
      const T = window.__tele;
      if (i >= w.length - 1 &&
        Math.hypot(w[w.length - 1].x - v.x, w[w.length - 1].z - v.z) < 30) return 'end';
      if (T.length > 120) {
        const a = T[T.length - 1], b = T[T.length - 100];
        if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 2) return 'stalled@wp' + i;
      }
      return null;
    })()`);
  }
  const A = JSON.parse(await ev(`(() => {
    clearInterval(window.__assist);
    window.__dbg.controls.btn.gas = false;
    const T = window.__tele, w = window.__wps;
    let deepest = 0, worstFall = 0, worstPop = 0, travelled = 0;
    for (let i = 1; i < T.length; i++) {
      const under = T[i][3] - T[i][1];
      if (under > deepest) deepest = under;
      const dy = T[i][1] - T[i - 1][1];
      if (dy < worstFall) worstFall = dy;
      if (dy > worstPop) worstPop = dy;
      travelled += Math.hypot(T[i][0] - T[i - 1][0], T[i][2] - T[i - 1][2]);
    }
    const last = T[T.length - 1] || [];
    return JSON.stringify({ at: last, wp: window.__wpi, of: w.length - 1,
      travelled: Math.round(travelled), deepestUnderground: +deepest.toFixed(1),
      worstFall: +worstFall.toFixed(2), worstPop: +worstPop.toFixed(2) });
  })()`));
  console.log('A traverse:', done, JSON.stringify(A));

  // ---- Test B: the hole -- approach the trench sideways on the surface ----
  const B = JSON.parse(await ev(`(() => { try {
    const d = window.__dbg, c = d.city, p = d.player, v = p.vehicle;
    if (!v) return JSON.stringify({ err: 'no car' });
    const cuts = d.world.portalCuts();
    let cut = null, cd = 1e18;
    for (const q of cuts) {
      const dd = (q.pts[0].x + 490) ** 2 + (q.pts[0].z + 1209) ** 2;
      if (dd < cd) { cd = dd; cut = q; }
    }
    // a station ~2/3 down the corridor, approached from 26 m out to the side
    const i = Math.floor(cut.pts.length * 0.66);
    const a = cut.pts[i], b = cut.pts[Math.min(i + 1, cut.pts.length - 1)];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const qx = -(b.z - a.z) / L, qz = (b.x - a.x) / L;
    const sx = a.x + qx * 26, sz = a.z + qz * 26;
    v.x = sx; v.y = d.G.terrainRaw(sx, sz) + 0.5; v.z = sz;
    v.heading = Math.atan2(-qx, -qz);      // straight at the trench
    v.vLong = 0;
    window.__b0 = { floor: a.y };
    d.controls.btn.gas = true;
    return JSON.stringify({ start: [Math.round(sx), Math.round(sz)],
      raw: +d.G.terrainRaw(sx, sz).toFixed(1), floor: +a.y.toFixed(1) });
  } catch (err) { return JSON.stringify({ err: err.message }); } })()`));
  console.log('B start:', JSON.stringify(B));
  await sleep(35000);
  const Bres = JSON.parse(await ev(`(() => { try {
    const d = window.__dbg, v = d.player.vehicle;
    d.controls.btn.gas = false;
    return JSON.stringify({ y: +v.y.toFixed(1),
      raw: +d.G.terrainRaw(v.x, v.z).toFixed(1),
      fellIn: v.y < d.G.terrainRaw(v.x, v.z) - 2.5 });
  } catch (err) { return JSON.stringify({ err: err.message }); } })()`));
  console.log('B result:', JSON.stringify(Bres));
} finally { chrome.kill(); }
