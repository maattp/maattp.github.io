// Where does the phone's CPU frame go? Per-system JS time on the real loop.
//
//   python3 -m http.server 8000 &
//   node tools/perfcpu.mjs [--runs=drive-i5,drive-dt,foot-dt] [--frames=600]
//        [--profile] [--top=15] [--json=FILE] [--label=X]
//
// Runs on the Mac's GPU (tools/chrome.mjs, gpu: true, vsync off), so the
// renderer is not eating the CPU the way SwiftShader does, at the iPhone 17
// Pro landscape viewport with an iPhone user agent (ON_PHONE true, phone
// tier). Each run puts the player where a player would be and lets the game's
// own frame loop run:
//
//   drive-i5   the player's car on I-5's mainline at ~27 m/s, with traffic
//   drive-dt   the player's car on downtown's street grid at ~14 m/s
//   foot-dt    on foot, standing downtown (traffic and crowds around)
//
// The car is steered by an autopilot hooked in front of player.update (the
// same input a stick produces, as tunnelride.mjs does), along a route walked
// off the road graph, and put back on the route if it stalls or strays.
//
// Every system is timed by wrapping the instance method from OUTSIDE --
// player / traffic / peds / world.update / world.animate / hud / audio and the
// renderer's submit -- so the same numbers come out of any build, including
// ones without main.js's perfSys. A second pass counts the city's ground and
// collision queries per frame (groundAt, roadLift, lidAt, obstacleHit,
// barrierHit) with their mean cost. `--profile` adds a sampling CPU profile
// (CDP Profiler, 100 us) of the same run and prints the top functions by self
// time.
//
// A phone's JS is roughly 2-4x slower than an M-series Mac's; read these as
// ratios between builds and between systems, not as the phone's milliseconds.

import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome, assertRenderer } from './chrome.mjs';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9494;
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const RUNS = arg('runs', 'drive-i5,drive-dt,foot-dt').split(',');
const FRAMES = +arg('frames', 600);
const PROFILE = process.argv.includes('--profile');
const TOP = +arg('top', 15);
const JSON_OUT = arg('json', '');
const LABEL = arg('label', `:${HTTP_PORT}`);
const QUALITY = arg('quality', 'high');
const DESKTOP = process.argv.includes('--desktop');
const VSYNC = process.argv.includes('--vsync');
const WRAP = arg('wrap', '');
// --throttle=N slows the page's CPU N-fold (CDP) AFTER boot: the Mac stand-in
// for the phone. 8 matches the per-system ms an iPhone 17 Pro reports in Debug.
const THROTTLE = +arg('throttle', 1);
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const VIEW = DESKTOP
  ? { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }
  : { width: 874, height: 402, deviceScaleFactor: 3, mobile: true };

function pageInstall() {
  const d = window.__dbg, c = d.city, p = d.player, G = d.G;
  const S = window.__pc = { on: false, sys: {}, frames: [], counts: {}, countOn: false };
  const wrap = (obj, key, name) => {
    const f = obj && obj[key];
    if (typeof f !== 'function') return;
    obj[key] = function (...a) {
      if (!S.on) return f.apply(this, a);
      const t0 = performance.now();
      try { return f.apply(this, a); } finally { S.sys[name] = (S.sys[name] || 0) + performance.now() - t0; }
    };
  };
  // Extra methods to time, e.g. --wrap=traffic.updateParked,world.buildChunkStep
  // (reported per frame as w:<name>, with their worst frame).
  S.wmax = {};
  for (const spec of (window.__pcWrap || '').split(',').filter(Boolean)) {
    const [o, m] = spec.split('.');
    const obj = d[o]; const f = obj && obj[m];
    if (typeof f !== 'function') continue;
    const name = 'w:' + spec;
    obj[m] = function (...a) {
      if (!S.on) return f.apply(this, a);
      const t0 = performance.now();
      try { return f.apply(this, a); } finally { const dt = performance.now() - t0; S.sys[name] = (S.sys[name] || 0) + dt; }
    };
  }
  // Systems. player.update is wrapped INSIDE the autopilot hook (see drive).
  wrap(d.traffic, 'update', 'traffic');
  wrap(d.peds, 'update', 'peds');
  wrap(d.world, 'update', 'world');
  wrap(d.world, 'animate', 'animate');
  wrap(d.hud, 'update', 'hud');
  wrap(d.audio, 'update', 'audio');
  if (d.acts) wrap(d.acts, 'update', 'activities');
  wrap(d.renderer, 'render', 'render');
  // City queries: counted (and timed) only in the counting pass.
  for (const k of ['groundAt', 'roadLift', 'lidAt', 'obstacleHit', 'barrierHit', 'buildingsNear', 'edgesNear', 'onRoad']) {
    const f = c[k];
    if (typeof f !== 'function') continue;
    c[k] = function (...a) {
      if (!S.countOn) return f.apply(this, a);
      const t0 = performance.now();
      try { return f.apply(this, a); } finally {
        const o = S.counts[k] || (S.counts[k] = { n: 0, ms: 0 });
        o.n++; o.ms += performance.now() - t0;
      }
    };
  }
  // Whole rAF callbacks.
  const RAF0 = window.requestAnimationFrame.bind(window);
  let lastTs = 0;
  let lastSys = {};
  window.requestAnimationFrame = (cb) => RAF0((ts) => {
    const t0 = performance.now();
    cb(ts);
    if (S.on || S.countOn) {
      const snap = {};
      for (const [k, v] of Object.entries(S.sys)) { snap[k] = v - (lastSys[k] || 0); }
      lastSys = { ...S.sys };
      S.frames.push([performance.now() - t0, lastTs ? ts - lastTs : 0, snap, d.sceneStats.calls, d.sceneStats.tris]);
    }
    lastTs = ts;
  });
  S.nextFrames = (n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else RAF0(f); }; RAF0(f); });

  // --- routes --------------------------------------------------------------
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const okDir = (e, from) => !e.oneway || ((e.a === from) !== !!e.onewayRev);
  const buildRoute = (x, z, test, len) => {
    let best = null, bd = 1e18;
    for (const ei of c.edgesNear(x, z, 600)) {
      const e = c.edges[ei];
      if (e.tunnel || !test(e) || e.len < 20) continue;
      const a = c.nodes[e.a];
      const dd = (a.x - x) ** 2 + (a.z - z) ** 2;
      if (dd < bd) { bd = dd; best = ei; }
    }
    if (best === null) return null;
    const e0 = c.edges[best];
    let from = okDir(e0, e0.a) ? e0.a : e0.b;
    const nodes = [from];
    let cur = from === e0.a ? e0.b : e0.a, prevE = best, s = e0.len;
    nodes.push(cur);
    let h = Math.atan2(c.nodes[cur].x - c.nodes[from].x, c.nodes[cur].z - c.nodes[from].z);
    const seen = new Set([best]);
    while (s < len) {
      let pick = null, pd = 1e9;
      for (const k of c.nodes[cur].e) {
        if (k === prevE || seen.has(k)) continue;
        const e = c.edges[k];
        if (e.tunnel || !test(e) || !okDir(e, cur)) continue;
        const o = e.a === cur ? e.b : e.a;
        const hh = Math.atan2(c.nodes[o].x - c.nodes[cur].x, c.nodes[o].z - c.nodes[cur].z);
        const dh = Math.abs(wrapA(hh - h));
        if (dh < pd) { pd = dh; pick = k; }
      }
      if (pick === null || pd > 1.2) break;
      const e = c.edges[pick];
      const o = e.a === cur ? e.b : e.a;
      h = Math.atan2(c.nodes[o].x - c.nodes[cur].x, c.nodes[o].z - c.nodes[cur].z);
      seen.add(pick); prevE = pick; s += e.len; cur = o; nodes.push(o);
    }
    const route = [];
    let acc = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = c.nodes[nodes[i]];
      if (i) acc += Math.hypot(n.x - route[i - 1].x, n.z - route[i - 1].z);
      route.push({ x: n.x, z: n.z, y: n.y, s: acc });
    }
    return route;
  };
  const I5 = /(^|\D)5(\D|$)|I-5|Interstate 5/;
  S.runs = {
    'drive-i5': { speed: 27, route: () => buildRoute(1050, 1500, (e) => e.cls === 'hwy' && I5.test(e.name || ''), 6000) },
    'drive-dt': { speed: 14, route: () => buildRoute(0, 0, (e) => e.cls !== 'hwy' && e.cls !== 'ramp' && e.cls !== 'res' && !e.elev, 3000) },
    'foot-dt': { foot: [305, -278] },
    'drive-qa': { speed: 13, route: () => buildRoute(-1717, -3128, (e) => e.cls !== 'hwy' && e.cls !== 'ramp' && !e.elev, 3000) },
    'foot-yt': { foot: [1409, 1120] },
  };

  let R = null;
  const pointAt = (sq) => {
    const rt = R.route, tot = rt[rt.length - 1].s;
    sq = Math.max(0, Math.min(tot, sq));
    let i = R.seg || 0;
    while (i > 0 && rt[i].s > sq) i--;
    while (i < rt.length - 2 && rt[i + 1].s < sq) i++;
    const a = rt[i], b = rt[i + 1], f = (sq - a.s) / ((b.s - a.s) || 1);
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y + (b.y - a.y) * f, h: Math.atan2(b.x - a.x, b.z - a.z) };
  };
  const project = (x, z) => {
    const rt = R.route;
    let best = null;
    for (let i = Math.max(0, R.seg - 3); i < Math.min(rt.length - 1, R.seg + 6); i++) {
      const a = rt[i], b = rt[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      const t = Math.max(0, Math.min(L, (x - a.x) * ux + (z - a.z) * uz));
      const dd = Math.hypot(x - a.x - ux * t, z - a.z - uz * t);
      if (!best || dd < best.d) best = { d: dd, i, s: a.s + t };
    }
    return best;
  };
  const placeCar = (sq, speed) => {
    const v = p.vehicle, q = pointAt(sq);
    v.x = q.x; v.z = q.z; v.heading = q.h;
    v.y = c.groundAt(q.x, q.z, q.y + 1.5);
    v.vy = 0; v.vLong = speed; v.vLat = 0;
    p.camYaw = q.h + Math.PI; p.camFloor = null;
    R.seg = Math.max(0, R.route.findIndex((k) => k.s > sq) - 1);
    R.hist = [];
  };
  const drive = (input, dt) => {
    const v = p.vehicle; if (!v || !R || !R.route) return;
    const pr = project(v.x, v.z);
    const tot = R.route[R.route.length - 1].s;
    R.t = (R.t || 0) + dt;
    if (pr) R.seg = pr.i;
    // back to the start at the end of the route, or when stalled or strayed
    R.hist.push([R.t, pr ? pr.s : 0]);
    while (R.hist.length > 1 && R.hist[1][0] < R.t - 3) R.hist.shift();
    const stalled = R.hist.length > 1 && R.hist[0][0] < R.t - 2.9 && (pr ? pr.s : 0) - R.hist[0][1] < 3;
    if (!pr || pr.d > 18 || pr.s > tot - 60 || stalled || v.dead) {
      R.resets = (R.resets || 0) + 1;
      if (v.dead) { v.dead = false; v.health = 100; }
      placeCar(40, R.speed * 0.8);
      return;
    }
    const sp = Math.abs(v.vLong);
    const look = Math.max(10, Math.min(30, 8 + sp * 0.7));
    const tgt = pointAt(pr.s + look);
    const dh = wrapA(Math.atan2(tgt.x - v.x, tgt.z - v.z) - v.heading);
    input.x = Math.max(-1, Math.min(1, -dh * 3));
    const far = pointAt(pr.s + 50);
    const bend = Math.abs(wrapA(Math.atan2(far.x - v.x, far.z - v.z) - v.heading));
    const vt = R.speed * (bend > 0.5 ? 0.55 : bend > 0.25 ? 0.8 : 1);
    input.gas = sp < vt; input.gasAmt = sp < vt ? 1 : 0;
    input.brake = sp > vt + 4; input.brakeAmt = sp > vt + 4 ? 1 : 0;
    input.y = 0; input.hand = false; input.attack = false;
    if (v.health < 60) v.health = 100;
  };
  const pu = p.update;
  p.update = function (dt, input, ...rest) {
    if (R && R.route && p.vehicle) drive(input, dt);
    if (!S.on) return pu.call(this, dt, input, ...rest);
    const t0 = performance.now();
    try { return pu.call(this, dt, input, ...rest); } finally { S.sys.player = (S.sys.player || 0) + performance.now() - t0; }
  };

  S.setup = async (name) => {
    const cfg = S.runs[name];
    d.game.paused = false;
    if (cfg.foot) {
      R = null;
      if (!p.onFoot && p.exitVehicle) p.exitVehicle();
      p.respawn(cfg.foot[0], cfg.foot[1]);
      d.world.update(cfg.foot[0], cfg.foot[1], 40);
    } else {
      const route = cfg.route();
      if (!route || route.length < 3) return { error: 'no route' };
      R = { route, speed: cfg.speed, seg: 0, hist: [], t: 0, resets: 0 };
      if (!p.onFoot && p.exitVehicle) p.exitVehicle();
      const q0 = pointAt(0);
      p.respawn(q0.x, q0.z);
      const car = d.traffic.spawnAt(q0.x, q0.z, q0.h, 'sedan', 0x3366aa, 'free');
      p.enterVehicle(car);
      placeCar(40, cfg.speed * 0.8);
      d.world.update(q0.x, q0.z, 40);
    }
    // Warm up: streaming bursts after a teleport, traffic and crowds fill in.
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) await S.nextFrames(10);
    // ...and until the streamer has caught up (it can take far longer than 5 s
    // under --throttle), so the run measures steady driving, not the arrival.
    const pend = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
    while (pend() > 2 && performance.now() - t0 < 90000) await S.nextFrames(10);
    S.settleMs = Math.round(performance.now() - t0);
    if (R) R.resets = 0;
    return { route: R ? Math.round(R.route[R.route.length - 1].s) : 0, settle: S.settleMs };
  };
  const q = (a, f) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };
  S.time = async (n) => {
    S.sys = {}; S.frames = []; S.on = true;
    const p0 = p.position, x0 = p0.x, z0 = p0.z;
    let dist = 0, last = [x0, z0];
    while (S.frames.length < n) {
      await S.nextFrames(5);
      const pp = p.position; dist += Math.hypot(pp.x - last[0], pp.z - last[1]); last = [pp.x, pp.z];
    }
    S.on = false;
    const F = S.frames.map((f) => f[0]), I = S.frames.map((f) => f[1]).filter((v) => v > 0);
    // Frame pacing: intervals past one vsync (16.7 ms), and what the worst frames spent their time on.
    const miss = I.filter((v) => v > 20).length, miss2 = I.filter((v) => v > 36).length;
    const worst = S.frames.map((f, i) => ({ i, raf: f[1], cpu: f[0], sys: f[2] })).sort((a, b) => b.raf - a.raf).slice(0, 12)
      .map((w) => `f${w.i} raf ${w.raf.toFixed(1)} cpu ${w.cpu.toFixed(1)} [` + Object.entries(w.sys).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' ') + ']');
    // What the slow quarter of frames spends that the rest don't.
    const byCpu = S.frames.map((f) => f).sort((a, b) => b[0] - a[0]);
    const q4 = byCpu.slice(0, Math.max(1, byCpu.length >> 2)), rest = byCpu.slice(byCpu.length >> 2);
    const avgSys = (fs) => { const o = {}; for (const f of fs) for (const [k, v] of Object.entries(f[2])) o[k] = (o[k] || 0) + v / fs.length; return o; };
    const sq = avgSys(q4), sr = avgSys(rest);
    const slowQ = Object.keys(sq).map((k) => [k, sq[k] - (sr[k] || 0)]).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} +${v.toFixed(2)}`).join('  ') + `  (slow-quarter cpu ${(q4.reduce((a, f) => a + f[0], 0) / q4.length).toFixed(1)} vs ${(rest.reduce((a, f) => a + f[0], 0) / Math.max(1, rest.length)).toFixed(1)})`;
    const out = { slowQ, n: F.length, cpu: +q(F, 0.5).toFixed(3), cpuMean: +(F.reduce((a, b) => a + b, 0) / F.length).toFixed(3),
      cpu90: +q(F, 0.9).toFixed(3), cpu99: +q(F, 0.99).toFixed(3), cpuMax: +Math.max(...F).toFixed(2),
      raf: +q(I, 0.5).toFixed(3), fps: +(1000 * I.length / I.reduce((a, b) => a + b, 0)).toFixed(1), raf90: +q(I, 0.9).toFixed(1), raf99: +q(I, 0.99).toFixed(1), sys: {}, cars: d.traffic.cars.length, peds: d.peds.peds.length,
      moved: Math.round(dist), resets: R ? R.resets : 0, draws: Math.round(S.frames.reduce((a, f) => a + (f[3] || 0), 0) / S.frames.length),
      trisK: Math.round(S.frames.reduce((a, f) => a + (f[4] || 0), 0) / S.frames.length / 1000), miss, miss2, worst };
    let sum = 0;
    for (const [k, v] of Object.entries(S.sys)) { out.sys[k] = +(v / F.length).toFixed(3); sum += v / F.length; }
    out.sys.other = +(out.cpuMean - sum).toFixed(3);
    return out;
  };
  S.count = async (n) => {
    S.counts = {}; S.frames = []; S.countOn = true;
    while (S.frames.length < n) await S.nextFrames(5);
    S.countOn = false;
    const out = {};
    for (const [k, v] of Object.entries(S.counts)) out[k] = { perFrame: +(v.n / S.frames.length).toFixed(1), us: +(v.ms / v.n * 1000).toFixed(2), msFrame: +(v.ms / S.frames.length).toFixed(3) };
    return out;
  };
  S.run = async (n) => { S.frames = []; while (S.frames.length < n) await S.nextFrames(5); return S.frames.length; };
  return { phone: /iPhone/.test(navigator.userAgent) };
}

// ---- node side ------------------------------------------------------------
const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-perfcpu-${PORT}`, gpu: true, headed: false,
  width: VIEW.width, height: VIEW.height, vsyncOff: !VSYNC });
let code = 0;
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  if (!page || page.url !== 'about:blank') throw new Error(`CDP port ${PORT} is not this run's Chrome -- pick a free AUTO_CDP_PORT`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, screenWidth: VIEW.width, screenHeight: VIEW.height,
    screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  if (!DESKTOP) {
    await send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__noAutoQuality = true;${process.argv.includes('--no-shadow-cache') ? ' window.__noShadowCache = true;' : ''}
    try { localStorage.setItem('auto-quality', ${JSON.stringify(QUALITY)}); } catch (e) {}` });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  const rend = await assertRenderer(ev, console.log, true);
  for (let i = 0; i < 240; i++) {
    if (await ev('window.__dbg.sceneStats.calls > 0 && window.__dbg.traffic.cars.length > 0')) break;
    await sleep(500);
  }
  await ev(`(() => { const d = window.__dbg; d.applyQuality(${JSON.stringify(QUALITY)}, true);
    for (const k of ['pad','stickZone','lookZone','rotate'])
      { const e = document.getElementById(k); if (e) e.style.display = 'none'; } })()`);
  await ev(`window.__pcWrap = ${JSON.stringify(WRAP)}; (${pageInstall.toString()})()`);
  const build = (/id="build">([^<]*)</.exec(await (await fetch(`http://localhost:${HTTP_PORT}/apps/auto/index.html`)).text()) || [])[1];
  console.log(`perfcpu ${LABEL} build ${build}  ${DESKTOP ? 'desktop' : 'iPhone 17 Pro landscape'}  quality ${QUALITY}  frames ${FRAMES}`);
  const out = { label: LABEL, build, renderer: rend, runs: {} };
  if (THROTTLE > 1) { await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); console.log(`  CPU throttled ${THROTTLE}x`); }
  if (PROFILE) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: +arg('sample', 500) }); }
  for (const run of RUNS) {
    const st = await ev(`window.__pc.setup(${JSON.stringify(run)})`);
    if (st.error) { console.log(`\n[${run}] ${st.error}`); continue; }
    const T = await ev(`window.__pc.time(${FRAMES})`);
    const C = await ev(`window.__pc.count(${Math.round(FRAMES / 2)})`);
    // The shadow pass on its own: its draw calls and CPU time per frame,
    // against the whole scene pass's calls (which include it).
    const SH = await ev(`new Promise((res) => { const d = window.__dbg, r = d.renderer, sm = r.shadowMap, o = sm.render;
      let n = 0, c = 0, ms = 0, tot = 0, inSh = false; const by = {};
      // which objects the shadow pass draws, by what they are
      const vg = new Set(d.traffic.cars.map((v) => v.group)); if (d.player.vehicle) vg.add(d.player.vehicle.group);
      const kind = (ob) => { for (let q = ob; q; q = q.parent) { if (q.isSkinnedMesh) return 'character'; if (vg.has(q)) return 'vehicle';
        if (q === d.world.group) return 'city';
        if (q.name && /^landmarks|spaceNeedle|monorail/.test(q.name)) return 'landmark'; if (q.parent === d.scene) return q.name || q.type; } return '?'; };
      const orb = r.renderBufferDirect;
      r.renderBufferDirect = function (cam, sc, geo, mat, ob, g) { if (inSh) { const k = kind(ob); by[k] = (by[k] || 0) + 1; } return orb.apply(this, arguments); };
      sm.render = function (...a) { const t = performance.now(), c0 = r.info.render.calls; inSh = true; o.apply(this, a); inSh = false; ms += performance.now() - t; c += r.info.render.calls - c0; };
      const f = () => { n++; tot += d.sceneStats.calls; if (n < 120) requestAnimationFrame(f); else { sm.render = o; r.renderBufferDirect = orb;
        for (const k in by) by[k] = +(by[k] / n).toFixed(1);
        res({ calls: +(c / n).toFixed(1), ms: +(ms / n).toFixed(2), sceneCalls: +(tot / n).toFixed(1), by }); } };
      requestAnimationFrame(f); })`);
    SH.cacheRedraws = await ev('window.__dbg.shadowCache ? window.__dbg.shadowCache.renders : null');
    const O = { setup: st, time: T, counts: C, shadow: SH };
    out.runs[run] = O;
    const sys = Object.entries(T.sys).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ');
    console.log(`\n[${run}] settled in ${(st.settle / 1000).toFixed(0)} s  route ${st.route} m  moved ${T.moved} m  resets ${T.resets}  ${T.cars} cars ${T.peds} peds  ${T.draws} draws (mean)  ${T.trisK}k tris`);
    console.log(`  cpu/frame  median ${T.cpu.toFixed(2)}  mean ${T.cpuMean.toFixed(2)}  p90 ${T.cpu90.toFixed(2)}  p99 ${T.cpu99.toFixed(2)}  max ${T.cpuMax}  (raf ${T.raf.toFixed(2)})`);
    console.log(`  fps ${T.fps}  frame interval median ${T.raf.toFixed(1)}  p90 ${T.raf90}  p99 ${T.raf99}`);
    console.log(`  by system (mean ms/frame): ${sys}`);
    console.log(`  frames over 20 ms: ${T.miss} of ${T.n} (over 36 ms: ${T.miss2})`);
    console.log(`  shadow pass: ${SH.calls} of ${SH.sceneCalls} scene-pass draws, ${SH.ms} ms/frame  (${Object.entries(SH.by).map(([k, v]) => k + ' ' + v).join(', ')})  cache redraws so far ${SH.cacheRedraws}`);
    console.log(`  slow quarter spends extra: ${T.slowQ}`);
    for (const w of T.worst) console.log(`    ${w}`);
    console.log('  queries/frame: ' + Object.entries(C).sort((a, b) => b[1].msFrame - a[1].msFrame)
      .map(([k, v]) => `${k} ${v.perFrame}x ${v.us}us = ${v.msFrame}ms`).join('  '));
    if (PROFILE) {
      await send('Profiler.start');
      await ev(`window.__pc.run(${FRAMES})`);
      const prof = (await send('Profiler.stop')).result.profile;
      // self time per node from the samples, then folded by function+location
      const byId = new Map(prof.nodes.map((n) => [n.id, n]));
      const self = new Map();
      for (let i = 0; i < prof.samples.length; i++) {
        const dtu = prof.timeDeltas[i + 1] !== undefined ? prof.timeDeltas[i + 1] : 0;
        self.set(prof.samples[i], (self.get(prof.samples[i]) || 0) + dtu);
      }
      const fold = new Map();
      let total = 0;
      for (const [nid, us] of self) {
        const n = byId.get(nid), cf = n.callFrame;
        if (/^\((idle|program|garbage collector)\)$/.test(cf.functionName) && cf.url === '') {
          const k = cf.functionName; fold.set(k, (fold.get(k) || 0) + us); if (k !== '(idle)') total += us; continue;
        }
        const k = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/apps\/auto\//, '')}:${cf.lineNumber + 1}`;
        fold.set(k, (fold.get(k) || 0) + us); total += us;
      }
      const top = [...fold.entries()].filter(([k]) => k !== '(idle)').sort((a, b) => b[1] - a[1]).slice(0, TOP);
      const perF = (us) => (us / 1000 / FRAMES).toFixed(3);
      O.profile = top.map(([k, us]) => ({ fn: k, msFrame: +perF(us), pct: +(us / total * 100).toFixed(1) }));
      console.log(`  hottest (self ms/frame, % of busy):`);
      for (const t of O.profile) console.log(`    ${String(t.msFrame).padStart(6)}  ${String(t.pct).padStart(5)}%  ${t.fn}`);
    }
  }
  const ex = logs.filter((l) => /EXCEPTION/.test(l));
  if (ex.length) { console.log(`\n${ex.length} exception(s):\n` + ex.slice(0, 5).join('\n')); code = 1; }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
} catch (e) {
  console.log('ERROR', e.message);
  code = 2;
} finally { chrome.kill(); }
process.exit(code);
