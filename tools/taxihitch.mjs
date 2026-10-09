// Taxi fares: the worst single-call cost of finding a fare (hail + destination).
//
//   node tools/taxihitch.mjs [--throttle N]
//
// Boots the iPhone profile with the CPU throttled (default 8x: the stand-in for
// an iPhone 17 Pro, see guide/performance.md) and, at a dozen sites, times
// every `taxi.toggle()` and `taxi.update()` call from FARE through the
// passenger boarding and the destination being chosen. The METRIC is the worst
// single call: one call is one frame's share of the work. Needs
// `python3 -m http.server $AUTO_HTTP_PORT` from the repo root.
//   // (the rest of this header belongs to taxicheck.mjs, which this was cut from)
//
// Boots the game headlessly (the iPhone landscape profile unless --desktop),
// puts the player in a taxi on a street in Belltown and drives the whole job
// through `__dbg.taxi` at fixed dt with the game paused (the real loop
// idles; this steps traffic, pedestrians and the taxi by hand, so nothing
// depends on SwiftShader's frame rate):
//   FARE shows in a taxi and not in a sedan; pressing it hails a pedestrian
//   within 300 m, with a pillar and a map mark; pulling up and stopping beside
//   them boards them (they leave the crowd); the destination is a named place
//   with a route >= 500 m, and the fare is base + per-km of that route; the
//   drop-off pays fare + tip (money rises by >= the fare, the count goes up
//   and survives a reload); a crash mid-fare cuts the tip; leaving the taxi,
//   dying, three stars and the fare clock each end it with no payout and
//   nothing left behind (pillar, objective, map marks, passenger).
// With --shots it also writes a street-level frame of the hail and of the
// drop-off. Needs `python3 -m http.server $AUTO_HTTP_PORT` from the repo root.
import { launchChrome } from './chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9222;
const URL_BASE = process.env.AUTO_URL || `http://localhost:${HTTP_PORT}/apps/auto/`;
const DESKTOP = process.argv.includes('--desktop');
const si = process.argv.indexOf('--shots');
const SHOTS = si > 0 ? process.argv[si + 1] : null;

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-taxi-profile-${PORT}`, width: 1280, height: 720 });
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('no CDP target');
}

try {
  const ws = new WebSocket((await target()).webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, aw = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: aw });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (!DESKTOP) {
    await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });

  const boot = async () => {
    await send('Page.navigate', { url: URL_BASE });
    for (let i = 0; i < (+process.env.TAXI_BOOT_S || 300) * 2; i++) {
      await sleep(500);
      if (await ev('!!(window.__dbg && window.__dbg.taxi && window.__dbg.career)', false)) return;
    }
    throw new Error('never booted: ' + logs.slice(-5).join(' | '));
  };
  const shot = async (name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64'));
  };

  await boot();
  await ev('window.scrollTo(0, 0), true', false);

  // The harness inside the page: fixed-dt stepping of everything a fare touches.
  await ev(`(() => {
    const d = __dbg, P = d.player, T = d.traffic, X = d.taxi, game = d.game;
    const H = window.__tx = {};
    game.paused = true;
    H.step = (n, dt = 1 / 30) => {
      for (let i = 0; i < n; i++) {
        const p = P.position;
        T.update(dt, p.x, p.z, { x: Math.sin(P.camYaw + Math.PI), z: Math.cos(P.camYaw + Math.PI) }, P);
        d.peds.update(dt, p.x, p.z, P, T);
        X.update(dt, P);
      }
    };
    // a taxi stopped in the middle of the street nearest (x, z), facing along it
    H.taxiAt = (x, z, type = 'taxi') => {
      if (P.vehicle) P.exitVehicle(true);
      const ni = d.city.nearestNode(x, z, 400), n = d.city.nodes[ni];
      let e = null;
      for (const ei of n.e) { const c = d.city.edges[ei]; if (!c.elev && !c.tunnel && c.cls !== 'hwy' && c.cls !== 'ramp') { e = c; break; } }
      const h = Math.atan2(e.dx, e.dz);
      const v = T.spawnAt(n.x, n.z, h, type, 0xf0b40c, 'free');
      v.vLong = 0;
      P.respawn(n.x, n.z);
      for (let i = 0; i < 12; i++) d.world.update(n.x, n.z, 2);
      P.enterVehicle(v);
      return v;
    };
    H.place = (v, x, z, h) => { v.x = x; v.z = z; if (h !== undefined) v.heading = h; v.vLong = 0; v.vLat = 0; v.y = d.city.groundAt(x, z, v.y); v.sync(); P.x = x; P.z = z; for (let i = 0; i < 4; i++) d.world.update(x, z, 2); if (h !== undefined) P.camYaw = h + Math.PI; for (let i = 0; i < 90; i++) P.updateCamera(1 / 30, null); };
    H.leftovers = () => ({
      fareFlag: d.peds.peds.filter((p) => p.fare).length,
      mark: X.mark.visible, hudFare: !!d.hud.fare, run: !!X.run, on: X.on,
      obj: d.hud.objective ? d.hud.objective.textContent : '',
    });
    return true;
  })()`, false);


  const rate = +(process.argv[process.argv.indexOf('--throttle') + 1]) || 8;
  await send('Emulation.setCPUThrottlingRate', { rate: process.argv.includes('--throttle') ? rate : 8 });
  const sites = [[-560, -210], [1861, -5554], [-3633, -7246], [590, 6939], [-3655, 4493], [2973, -1991], [1468, -1389], [-36, -1314], [2101, 3753], [-1718, -3129], [3961, 5940], [1095, -10923]];
  const rows = await ev(`(async () => {
    const d = __dbg, P = d.player, T = d.traffic, X = d.taxi, G = d.game;
    G.paused = true; G.dead = false; G.wanted = 0;
    const out = [];
    const now = () => performance.now();
    // the one-time work (union-find over the nodes, the search's arrays) is done at boot; what it costs
    if (X.warm) { X._comp = null; X._sh = null; const t0 = now(); X.warm(); out.warm = now() - t0; }
    for (const [sx, sz] of ${JSON.stringify(sites)}) {
      if (P.vehicle) P.exitVehicle(true);
      const ni = d.city.nearestNode(sx, sz, 400), n = d.city.nodes[ni];
      let e = null; for (const ei of n.e) { const c = d.city.edges[ei]; if (!c.elev && !c.tunnel && c.cls !== 'hwy' && c.cls !== 'ramp') { e = c; break; } }
      const v = T.spawnAt(n.x, n.z, Math.atan2(e.dx, e.dz), 'taxi', 0xf0b40c, 'free'); v.vLong = 0;
      P.respawn(n.x, n.z); for (let i = 0; i < 8; i++) d.world.update(n.x, n.z, 2); P.enterVehicle(v);
      const calls = [];
      const timed = (f) => { const t0 = now(); f(); calls.push(now() - t0); };
      const tick = () => { const p = P.position; T.update(1 / 30, p.x, p.z, { x: 0, z: 1 }, P); d.peds.update(1 / 30, p.x, p.z, P, T); timed(() => X.update(1 / 30, P)); };
      timed(() => X.toggle(P));
      let n1 = 0; while (n1++ < 60 && X.on && !(X.run && X.run.ped)) tick();
      let board = false;
      if (X.run && X.run.ped) {
        const r = X.run, p = r.ped, ed = d.city.edges[p.edge];
        v.x = p.fx; v.z = p.fz; v.heading = Math.atan2(ed.dx, ed.dz); v.vLong = 0; v.y = d.city.groundAt(v.x, v.z, v.y); v.sync(); P.x = v.x; P.z = v.z;
        let n2 = 0; while (n2++ < 500 && X.on && X.run && X.run.stage !== 'ride') tick();
        board = !!(X.run && X.run.stage === 'ride');
      }
      X.end(false);
      out.push({ site: [sx, sz], calls: calls.length, max: Math.max(...calls), sum: calls.reduce((a, b) => a + b, 0), board });
    }
    return { rows: out, warm: out.warm || 0 };
  })()`);
  const warmMs = rows.warm;
  console.log(`warm() at boot: ${warmMs.toFixed(1)} ms`);
  let worst = 0, worstSum = 0;
  for (const r of rows.rows) { worst = Math.max(worst, r.max); worstSum = Math.max(worstSum, r.sum); console.log(`  ${String(r.site).padEnd(14)} ${String(r.calls).padStart(4)} calls  worst ${r.max.toFixed(1).padStart(7)} ms  total ${r.sum.toFixed(1).padStart(7)} ms  boarded ${r.board}`); }
  const srt = rows.rows.map((r) => r.max).sort((a, b) => a - b);
  console.log(`WORST single call at ${rate}x throttle: ${worst.toFixed(1)} ms (median site ${srt[srt.length >> 1].toFixed(1)} ms); heaviest site's total ${worstSum.toFixed(1)} ms`);
} catch (e) {
  console.log('FAIL: ' + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  chrome.kill();
}
