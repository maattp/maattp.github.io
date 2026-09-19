// Where does the phone's frame go? GPU-only cost bisection for apps/auto.
//
//   python3 -m http.server 8000 &
//   node tools/perfbisect.mjs [--frames=90] [--spots=downtown,cross,i5,center,fly]
//        [--toggles=ssao,glass,...|none] [--live] [--desktop] [--json=FILE] [--label=X]
//
// Always runs on the Mac's GPU (tools/chrome.mjs, gpu: true, vsync and the
// frame-rate limit off) and refuses to run on SwiftShader. By default it
// emulates an iPhone 17 Pro held landscape -- 874 x 402 CSS px, DPR 3,
// mobile, an iPhone user agent -- so the game's ON_PHONE is true and every
// phone-tier cap (pixel ratio 1.45 at high, 8 SSAO taps, 1024 shadow map,
// PCF, peds casting no shadow) applies. `--desktop` measures the desktop tier
// at 1280 x 720 instead.
//
// At each spot the camera is FROZEN (game paused, streaming settled by hand,
// shadow box placed) so every build and every toggle draws the same frame.
// GPU time comes from EXT_disjoint_timer_query_webgl2, split into three
// back-to-back queries per frame: shadow map, scene pass, post chain. The
// medians over --frames frames are reported with draws, triangles and the
// render resolution. Toggles each flip one suspect, re-measure and restore;
// the base is measured before AND after the toggles so drift shows.
//
// `--live` also runs the real game loop at the four ground spots with the
// player standing there (traffic and pedestrians spawning and moving) and
// reports CPU ms per frame by system, from main.js's `perfSys` (older builds
// without it report the whole rAF callback only).
//
// **This is an M-series GPU, not a phone.** The absolute milliseconds are not
// the phone's; the RANKING of the suspects and the ratio between builds are
// what carry over (Apple's phone and Mac GPUs are the same tile-based family,
// so blending, overdraw and bandwidth costs rank the same way). Compare
// builds by serving each checkout on its own AUTO_HTTP_PORT with this same
// harness; never compare a GPU number with a SwiftShader one.

import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome, assertRenderer } from './chrome.mjs';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9491;
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const FRAMES = +arg('frames', 90);
const SPOTS = arg('spots', 'downtown,cross,i5,center,fly').split(',');
const TOGGLES = arg('toggles', 'ssao,glass,lots,terrain3,lmshadow,chars,far,shadows,aoquarter,bloom,postoff,pr12');
const LIVE = process.argv.includes('--live');
const DESKTOP = process.argv.includes('--desktop');
const JSON_OUT = arg('json', '');
const LABEL = arg('label', `:${HTTP_PORT}`);
const QUALITY = arg('quality', 'high');

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const VIEW = DESKTOP
  ? { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }
  : { width: 874, height: 402, deviceScaleFactor: 3, mobile: true };

// ---- page side ------------------------------------------------------------
// Installed once after boot. Everything is guarded so the same harness runs
// against older builds that lack a feature (the toggle then reports n/a).
function pageInstall() {
  const d = window.__dbg, r = d.renderer, gl = r.getContext(), THREE = d.THREE;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const S = window.__pb = { syncOn: true, ext: !!ext, on: false, frames: [], pending: [], raf: [], cpu: [] };

  // --- GPU timer queries: shadow | scene | post, back to back -------------
  let cur = null, open = false;
  const begin = (k) => {
    if (!cur) return;
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    cur.q.push([k, q]); open = true;
  };
  const end = () => { if (open) { gl.endQuery(ext.TIME_ELAPSED_EXT); open = false; } };
  const R0 = r.render.bind(r);
  r.render = function (scene, cam) {
    if (scene === d.scene && S.on && ext) {
      end();
      cur = { q: [], calls: 0, tris: 0 };
      begin('shadow');
      R0(scene, cam);
      end();
      cur.calls = r.info.render.calls; cur.tris = r.info.render.triangles;
      if (r.getRenderTarget() === null) { S.pending.push(cur); cur = null; return; }
      begin('post');
      return;
    }
    R0(scene, cam);
    if (cur && r.getRenderTarget() === null) { end(); S.pending.push(cur); cur = null; }
  };
  const SM = r.shadowMap, SM0 = SM.render.bind(SM);
  SM.render = function (...a) {
    SM0(...a);
    if (cur && open) { end(); begin('scene'); }
  };
  S.poll = () => {
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    const keep = [];
    for (const f of S.pending) {
      const last = f.q[f.q.length - 1][1];
      if (!gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) { keep.push(f); continue; }
      const o = { shadow: 0, scene: 0, post: 0, calls: f.calls, tris: f.tris };
      for (const [k, q] of f.q) {
        o[k] += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(q);
      }
      o.total = o.shadow + o.scene + o.post;
      if (!disjoint) S.frames.push(o);
    }
    S.pending = keep;
  };

  // --- CPU: every rAF callback, timed; and the rAF interval ----------------
  const RAF0 = window.requestAnimationFrame.bind(window);
  let lastTs = 0;
  window.requestAnimationFrame = (cb) => RAF0((ts) => {
    const t0 = performance.now();
    cb(ts);
    const t1 = performance.now();
    if (S.on) {
      S.cpu.push(t1 - t0);
      if (lastTs) S.raf.push(ts - lastTs);
    }
    lastTs = ts;
    if (ext) S.poll();
  });
  S.nextFrames = (n) => new Promise((res) => {
    let k = 0;
    const f = () => { if (++k >= n) res(); else RAF0(f); };
    RAF0(f);
  });

  // --- measurement ---------------------------------------------------------
  const med = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const p90 = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)]; };
  S.measure = async (n) => {
    S.frames = []; S.cpu = []; S.raf = []; S.pending = [];
    if (d.perfSys) { d.perfSys.ms = {}; d.perfSys.frames = 0; }
    S.on = true;
    const t0 = performance.now();
    for (let i = 0; i < 400 && S.frames.length < n; i++) await S.nextFrames(4);
    S.on = false;
    const wall = performance.now() - t0;
    await S.nextFrames(6);
    const F = S.frames;
    const sync = S.syncOn ? S.sync(n) : null;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const out = {
      n: F.length,
      gpu: +med(F.map((f) => f.total)).toFixed(3),
      gpu90: +p90(F.map((f) => f.total)).toFixed(3),
      shadow: +med(F.map((f) => f.shadow)).toFixed(3),
      scene: +med(F.map((f) => f.scene)).toFixed(3),
      post: +med(F.map((f) => f.post)).toFixed(3),
      cpu: +med(S.cpu).toFixed(3),
      raf: +med(S.raf).toFixed(3),
      calls: F.length ? F[F.length - 1].calls : d.sceneStats.calls,
      tris: F.length ? F[F.length - 1].tris : d.sceneStats.tris,
      res: `${size.x}x${size.y}`, pr: +r.getPixelRatio().toFixed(3),
      fps: +(1000 * S.cpu.length / wall).toFixed(1),
    };
    if (sync) out.sync = sync;
    if (d.perfSys && d.perfSys.frames) {
      out.sys = {};
      for (const [k, v] of Object.entries(d.perfSys.ms)) out.sys[k] = +(v / d.perfSys.frames).toFixed(3);
    }
    return out;
  };

  // --- synchronous frames: the robust number ------------------------------
  // ANGLE's Metal timer queries attribute work to command-buffer boundaries,
  // so their per-phase split is unreliable. Drawing the frozen frame in a
  // tight loop with a gl.finish() after each phase is not: the wall time of
  // each phase is CPU submission plus the GPU executing it, nothing hidden.
  const flush = () => { gl.finish(); };
  S.sync = (n) => {
    const P = d.postfx, cam = d.camera;
    const runs = { shadow: [], scene: [], post: [], total: [] };
    let tS = 0;
    const SM1 = SM.render;
    SM.render = function (...a) { SM0(...a); flush(); tS = performance.now(); };
    try {
      for (let i = 0; i < n + 8; i++) {
        const t0 = performance.now();
        r.setRenderTarget(P.target);
        R0(d.scene, cam);
        flush();
        const t1 = performance.now();
        if (P.target) P.render(i / 60, cam);
        r.setRenderTarget(null);
        flush();
        const t2 = performance.now();
        if (i < 8) continue;
        runs.shadow.push(tS - t0); runs.scene.push(t1 - tS); runs.post.push(t2 - t1); runs.total.push(t2 - t0);
      }
    } finally { SM.render = SM1; }
    const o = {};
    for (const k in runs) o[k] = +med(runs[k]).toFixed(3);
    o.p90 = +p90(runs.total).toFixed(3);
    return o;
  };

  // --- spots -----------------------------------------------------------------
  const c = d.city, G = d.G;
  const gy = (x, z) => Math.max(0, c.groundAt(x, z, null));
  const nearNode = (x, z, test) => {
    let best = null, bd = 1e18;
    for (const ei of c.edgesNear(x, z, 500)) {
      const e = c.edges[ei];
      if (!test(e)) continue;
      for (const ni of [e.a, e.b]) {
        const a = c.nodes[ni];
        const dd = (a.x - x) ** 2 + (a.z - z) ** 2;
        if (dd < bd) { bd = dd; best = { x: a.x, z: a.z, e }; }
      }
    }
    return best || { x, z };
  };
  const i5 = () => {
    // Open (untunnelled, unlidded) I-5 mainline south of downtown.
    let best = null, bd = 1e18;
    for (const e of c.edges) {
      if (e.cls !== 'hwy' || e.tunnel || !/(^|\D)5(\D|$)|I-5|Interstate 5/.test(e.name || '')) continue;
      const a = c.nodes[e.a], b = c.nodes[e.b];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const dd = (mx - 1050) ** 2 + (mz - 1500) ** 2;
      if (dd < bd && Math.hypot(b.x - a.x, b.z - a.z) > 40) { bd = dd; best = { a, b }; }
    }
    if (!best) return { x: 1050, z: 1500, h: 0 };
    const { a, b } = best, L = Math.hypot(b.x - a.x, b.z - a.z);
    return { x: a.x, z: a.z, ux: (b.x - a.x) / L, uz: (b.z - a.z) / L };
  };
  const needle = () => G.LANDMARKS.find((l) => /Space Needle/.test(l.name));
  S.spots = {
    downtown: () => { const x = 305, z = -278, y = gy(x, z); return { stand: [x, z], cam: [x, y + 3, z + 40], look: [x, y + 2, z] }; },
    cross: () => {
      const n = nearNode(0, 0, (e) => e.oneway && e.cls !== 'res');
      const y = gy(n.x, n.z);
      return { stand: [n.x, n.z], busy: true, cam: [n.x - 22, y + 4.5, n.z + 22], look: [n.x + 10, y + 1, n.z - 10] };
    },
    i5: () => {
      const q = i5();
      const y = gy(q.x, q.z);
      return { stand: [q.x - q.uz * 12, q.z + q.ux * 12], cam: [q.x, y + 3.5, q.z], look: [q.x + q.ux * 80, y + 1.5, q.z + q.uz * 80] };
    },
    center: () => {
      const l = needle();
      const x = l.x, z = l.z + 160, y = gy(x, z);
      return { stand: [x, z], cam: [x, y + 3, z], look: [l.x, y + 55, l.z] };
    },
    fly: () => { const x = 305, z = -278, y = gy(x, z); return { fly: true, cam: [x - 150, y + 260, z + 750], look: [x, y, z - 150] }; },
  };

  const settle = (x, z) => {
    const W = d.world;
    const pend = () => [...W.chunks.values()].filter((k) => k.lod !== k.wantLod).length;
    for (let i = 0; i < 1500; i++) { W.update(x, z, 3); if (i > 3 && pend() === 0) break; }
  };
  // Freeze on a pose. Streaming, far layers and the shadow box are all put
  // where the running game would have them for a camera standing there.
  S.freeze = async (name) => {
    const P = S.spots[name]();
    const W = d.world, cam = d.camera;
    d.game.paused = true;
    const alt = P.fly ? P.cam[1] - G.terrainHeight(P.cam[0], P.cam[2]) : 0;
    W.playerAlt = alt; W.playerFlying = !!P.fly; W.playerFwdX = 0; W.playerFwdZ = 0;
    cam.position.set(...P.cam);
    cam.lookAt(...P.look);
    cam.updateMatrixWorld(true);
    settle(P.cam[0], P.cam[2]);
    if (P.fly) {
      // The far layers build in slices and fade in over 1.5 s of real time.
      for (let i = 0; i < 240; i++) { W.update(P.cam[0], P.cam[2], 3); await S.nextFrames(1); if (W.farU && W.farU.farFade.value >= 1 && i > 30) break; }
    }
    if (d.placeSun) d.placeSun(P.cam[0], P.cam[1], P.cam[2]);
    d.scene.updateMatrixWorld(true);
    await S.nextFrames(20);
    return { alt: +alt.toFixed(0), cam: P.cam.map((v) => +v.toFixed(0)) };
  };
  // Stand the player at the spot and let the real loop run: traffic and
  // pedestrians spawn and move, streaming runs, the camera follows.
  S.live = async (name, n) => {
    const P = S.spots[name]();
    if (!P.stand) return null;
    d.game.paused = false;
    if (!d.player.onFoot && d.player.exitVehicle) d.player.exitVehicle();
    d.player.respawn(P.stand[0], P.stand[1]);
    d.player.camYaw = Math.atan2(P.stand[0] - P.look[0], P.stand[1] - P.look[2]);
    d.world.update(P.stand[0], P.stand[1], 40);
    if (P.busy && d.traffic.spawnTraffic) {
      const dir = { x: P.look[0] - P.stand[0], z: P.look[2] - P.stand[1] };
      const L = Math.hypot(dir.x, dir.z) || 1; dir.x /= L; dir.z /= L;
      for (let i = 0; i < 12; i++) d.traffic.spawnTraffic(P.stand[0], P.stand[1], dir);
      if (d.peds.spawn) for (let i = 0; i < 20; i++) d.peds.spawn(P.stand[0], P.stand[1]);
    }
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) await S.nextFrames(10);
    if (d.perfSys) d.perfSys.harness = true;
    await S.nextFrames(3);
    S.syncOn = false;
    const m = await S.measure(n);
    S.syncOn = true;
    if (d.perfSys) d.perfSys.harness = false;
    m.cars = d.traffic.cars.length; m.peds = d.peds.peds.length;
    return m;
  };

  // --- toggles: [apply, restore]; apply returns false when not applicable --
  const mats = new Map();
  const terrainMat = () => d.world.terrainGroup && d.world.terrainGroup.children[0] && d.world.terrainGroup.children[0].material;
  const patchTerrain = (tag, fn) => {
    const m = terrainMat();
    if (!m || !m.onBeforeCompile) return false;
    const ob = m.onBeforeCompile, key = m.customProgramCacheKey;
    mats.set(tag, [ob, key]);
    m.onBeforeCompile = (sh, rr) => { ob.call(m, sh, rr); sh.fragmentShader = fn(sh.fragmentShader); };
    m.customProgramCacheKey = () => (key ? key.call(m) : '') + '-' + tag;
    m.needsUpdate = true;
    return true;
  };
  const unpatchTerrain = (tag) => {
    const m = terrainMat(), s = mats.get(tag);
    if (!m || !s) return;
    m.onBeforeCompile = s[0]; m.customProgramCacheKey = s[1]; m.needsUpdate = true;
  };
  const saved = [];
  const setAll = (pred, key, val) => {
    d.scene.traverse((o) => { if (pred(o)) { saved.push([o, key, o[key]]); o[key] = val; } });
  };
  const restoreAll = () => { while (saved.length) { const [o, k, v] = saved.pop(); o[k] = v; } };
  const setPR = (pr) => {
    const el = r.domElement;
    r.setPixelRatio(pr);
    r.setSize(el.clientWidth, el.clientHeight, false);
    d.postfx.setSize(el.clientWidth, el.clientHeight, r.getPixelRatio());
  };
  let prWas = 1, aoWas = null, trimMat = null;
  const aoRes = (div) => {
    const P = d.postfx, W = P._w, H = P._h;
    const aw = Math.max(2, Math.floor(W / div)), ah = Math.max(2, Math.floor(H / div));
    P.aoA.setSize(aw, ah); P.aoB.setSize(aw, ah);
    P.ssao.material.uniforms.aoTexel.value.set(1 / aw, 1 / ah);
    P._aw = aw; P._ah = ah;
  };
  S.toggles = {
    ssao: [() => { if (!d.postfx.ssaoOn || !d.postfx.fx.ssao) return false; d.postfx.setFx('ssao', false); }, () => d.postfx.setFx('ssao', true)],
    glass: [async () => {
      const V = await import(new URL('src/vehicles.js', location.href).href);
      trimMat = V.vehicleAssets().trimMat;
      if (!trimMat.transparent) return false;
      trimMat.transparent = false; trimMat.blending = THREE.NormalBlending; trimMat.needsUpdate = true;
    }, () => { trimMat.transparent = true; trimMat.blending = THREE.CustomBlending; trimMat.needsUpdate = true; }],
    lots: [() => {
      if (!/terrain3scale-lots/.test((terrainMat() || {}).customProgramCacheKey?.() || '')) return false;
      return patchTerrain('nolots', (fs) => fs.replace(/float lotCover = 0\.0;[\s\S]*?(roughnessFactor = mix\( roughnessFactor, 0\.8, lotCover \);)/, 'float lotCover = 0.0;\n$1'));
    }, () => unpatchTerrain('nolots')],
    terrain3: [() => {
      if (!/terrain3scale/.test((terrainMat() || {}).customProgramCacheKey?.() || '')) return false;
      return patchTerrain('one', (fs) => fs
        .replace(/vec3 macroT = texture2D\([^;]*;/, 'vec3 macroT = vec3( 1.0 );')
        .replace(/vec3 detailT = texture2D\([^;]*;/, 'vec3 detailT = vec3( 1.0 );'));
    }, () => unpatchTerrain('one')],
    lmshadow: [() => {
      const root = d.scene.getObjectByName('landmarks');
      if (!root) return false;
      setAll((o) => o.isMesh && o.castShadow && !!o.parent && (() => { let p = o; while (p && p !== root) p = p.parent; return p === root; })(), 'castShadow', false);
    }, restoreAll],
    chars: [() => setAll((o) => o.isSkinnedMesh && o.visible, 'visible', false), restoreAll],
    far: [() => {
      const L = [...(d.world.farMass || []), ...(d.world.farRoads || [])].filter((m) => m.visible);
      if (!L.length) return false;
      for (const m of L) { saved.push([m, 'visible', true]); m.visible = false; }
    }, restoreAll],
    shadows: [() => { r.shadowMap.enabled = false; d.sun.castShadow = false; }, () => { r.shadowMap.enabled = true; d.sun.castShadow = true; }],
    aoquarter: [() => { if (!d.postfx.ssaoOn || !d.postfx.fx.ssao) return false; aoWas = 2; aoRes(4); }, () => aoRes(aoWas)],
    bloom: [() => d.postfx.setFx('bloom', false), () => d.postfx.setFx('bloom', true)],
    postoff: [() => { d.postfx.enabled = false; }, () => { d.postfx.enabled = true; }],
    pr12: [() => { prWas = r.getPixelRatio(); if (prWas <= 1.2) return false; setPR(1.2); }, () => setPR(prWas)],
  };
  S.toggle = async (name, n) => {
    const t = S.toggles[name];
    if (!t) return { na: 'unknown toggle' };
    let ok;
    try { ok = await t[0](); } catch (e) { return { na: String(e.message || e).slice(0, 80) }; }
    if (ok === false) return { na: 'n/a' };
    await S.nextFrames(30);
    const m = await S.measure(n);
    await t[1]();
    await S.nextFrames(30);
    return m;
  };
  return { ext: S.ext, phone: /iPhone/.test(navigator.userAgent), dpr: devicePixelRatio, perfSys: !!d.perfSys };
}

// ---- node side ------------------------------------------------------------
const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-perfbisect-${PORT}`, gpu: true, headed: false,
  width: VIEW.width, height: VIEW.height, vsyncOff: true });
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__noAutoQuality = true;
    try { localStorage.setItem('auto-quality', ${JSON.stringify(QUALITY)}); } catch (e) {}` });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  const rend = await assertRenderer(ev, console.log, true);
  for (let i = 0; i < 240; i++) {
    if (await ev('window.__dbg.sceneStats.calls > 0 && window.__dbg.traffic.cars.length > 0')) break;
    await sleep(500);
  }
  await ev(`(() => { const d = window.__dbg; d.applyQuality(${JSON.stringify(QUALITY)}, true);
    for (const k of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','minimap'])
      { const e = document.getElementById(k); if (e) e.style.display = 'none'; } })()`);
  await sleep(1500);
  const info = await ev(`(${pageInstall.toString()})()`);
  const build = (/id="build">([^<]*)</.exec(await (await fetch(`http://localhost:${HTTP_PORT}/apps/auto/index.html`)).text()) || [])[1];
  console.log(`perfbisect ${LABEL} build ${build}  ${DESKTOP ? 'desktop' : 'iPhone 17 Pro landscape'}  quality ${QUALITY}`
    + `  timer-query ${info.ext}  ON_PHONE-UA ${info.phone}  dpr ${info.dpr}  frames ${FRAMES}`);
  if (!info.ext) throw new Error('EXT_disjoint_timer_query_webgl2 is not available');
  const out = { label: LABEL, build, renderer: rend, view: VIEW, quality: QUALITY, spots: {} };
  const f2 = (v) => (v === undefined || Number.isNaN(v) ? '  -  ' : v.toFixed(2).padStart(5));
  const fmt = (m) => m.na ? `  ${m.na}` : (m.sync
    ? `sync ${f2(m.sync.total)} (sh ${f2(m.sync.shadow)} sc ${f2(m.sync.scene)} pp ${f2(m.sync.post)}) p90 ${f2(m.sync.p90)}  | tq ${f2(m.gpu)}`
    : `tq ${f2(m.gpu)} (sh ${f2(m.shadow)} sc ${f2(m.scene)} pp ${f2(m.post)})`)
    + `  raf ${f2(m.raf)}  cpu ${f2(m.cpu)}  ${m.calls} draws ${(m.tris / 1000).toFixed(0)}k tris  ${m.res}`;
  const key = (m) => (m.sync ? m.sync.total : m.gpu);

  const toggles = TOGGLES === 'none' ? [] : TOGGLES.split(',');
  for (const spot of SPOTS) {
    const S = { toggles: {} };
    out.spots[spot] = S;
    if (LIVE) {
      const L = await ev(`window.__pb.live(${JSON.stringify(spot)}, ${FRAMES})`);
      if (L) {
        S.live = L;
        const sys = L.sys ? Object.entries(L.sys).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ') : '(no perfSys)';
        console.log(`\n[${spot}] LIVE  ${fmt(L)}  ${L.cars} cars ${L.peds} peds  fps ${L.fps}\n    cpu/system: ${sys}`);
      }
    }
    const fz = await ev(`window.__pb.freeze(${JSON.stringify(spot)})`);
    S.pose = fz;
    S.base = await ev(`window.__pb.measure(${FRAMES})`);
    console.log(`\n[${spot}] frozen at ${fz.cam.join(',')} (alt ${fz.alt})\n  base      ${fmt(S.base)}`);
    for (const t of toggles) {
      const m = await ev(`window.__pb.toggle(${JSON.stringify(t)}, ${FRAMES})`);
      S.toggles[t] = m;
      const dl = m.na ? '' : `  delta ${(key(m) - key(S.base)).toFixed(2)} ms (${((key(m) / key(S.base) - 1) * 100).toFixed(0)}%)`;
      console.log(`  ${t.padEnd(9)} ${fmt(m)}${dl}`);
    }
    if (toggles.length) {
      S.base2 = await ev(`window.__pb.measure(${FRAMES})`);
      console.log(`  base again ${fmt(S.base2)}`);
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
