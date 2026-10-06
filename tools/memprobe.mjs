// Where does the memory go? JS heap and GPU allocations, on the PHONE profile
// (iPhone UA, so every ON_PHONE path -- arrays dropped after upload, far LODs,
// the shadow cache -- is the one measured), at boot and through the two
// flights that ended the page on the iPhone: a fast low pass over Fremont and
// Green Lake in the floatplane, and a skydive from altitude.
//
//   AUTO_HTTP_PORT=8000 node tools/memprobe.mjs [--twice] [--fly=S] [--sky]
//        [--census] [--throttle=N] [--snapshot=FILE]
//
//   --twice     boot, then reload in the same profile: the CACHED launch (the
//               boot cache's IndexedDB entries) is measured too
//   --fly=S     after boot, S seconds of real-time flight at ~90 m/s and
//               ~70 m over the ground, Fremont -> Green Lake -> Northgate ->
//               Lake City -> the U District -> Ballard -> Magnolia, far
//               layers on (default 0 = no flight)
//   --sky       after the flight (or boot), a skydive: the plane at 1500 m over
//               downtown for 10 s, then out of the door, to the ground
//   --census    after each phase, the JS copies of geometry still held, by the
//               scene's top-level groups (what a phone keeps after upload)
//   --snapshot=FILE  a heap snapshot at the end (DevTools opens it); with
//               MEM_SNAP_TOP=N the top constructors by self size are printed
//
// Heap figures: `gc` is Runtime.getHeapUsage after two forced collections
// (what is reachable); `raw` is the same without collecting (what the process
// is holding at that moment, garbage included -- which is what an OS memory
// limit sees). GPU figures come from wrapping the WebGL2 context's allocation
// calls before the page runs (bufferData, tex[Sub]Image2D/3D, texStorage*,
// renderbufferStorage*, generateMipmap, delete*): bytes as the driver was
// asked for them, not what it rounds them to, plus the drawing buffer.
//
// The CPU is unthrottled by default (the flight is real time, so a throttled
// run streams less city per second than a phone does while the GPU work is
// the same). Service worker bypassed; fresh profile every run.
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, createWriteStream, readFileSync } from 'node:fs';
import { launchChrome, assertRenderer } from './chrome.mjs';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9461;
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const TWICE = process.argv.includes('--twice');
const FLY = +arg('fly', 0);
const SKY = process.argv.includes('--sky');
const CENSUS = process.argv.includes('--census');
const THROTTLE = +arg('throttle', 1);
const SNAP = arg('snapshot', '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

// Injected before the page: a ledger of every GPU allocation the context asks for.
const GL_LEDGER = `(() => {
  const P = WebGL2RenderingContext.prototype;
  const L = window.__glMem = { buf: 0, tex: 0, rb: 0, nBuf: 0, nTex: 0, peak: 0, bufs: new Map(), texs: new Map(), rbs: new Map(), uploads: 0, uploadBytes: 0, up: new WeakSet() };
  const bound = new Map(), texBound = new Map(); let unit = 0, rbBound = null;
  const BPP = { 0x8058: 4, 0x8051: 3, 0x1908: 4, 0x1907: 3, 0x881A: 8, 0x8815: 6, 0x8814: 16, 0x822D: 2, 0x822E: 4, 0x822B: 2, 0x8229: 1, 0x1909: 1, 0x190A: 2, 0x1903: 1,
    0x88F0: 4, 0x81A6: 4, 0x81A5: 2, 0x8CAC: 4, 0x8CAD: 8, 0x8C43: 4, 0x8C41: 3, 0x8C3A: 4, 0x8D62: 2, 0x8056: 2, 0x8057: 2, 0x8F97: 4, 0x8230: 8, 0x822F: 4 };
  const bpp = (f) => BPP[f] || 4;
  const peak = () => { const t = L.buf + L.tex + L.rb; if (t > L.peak) L.peak = t; };
  const ob = P.bindBuffer; P.bindBuffer = function (t, b) { bound.set(t, b); return ob.call(this, t, b); };
  const bd = P.bufferData; P.bufferData = function (t, d, u, off, len) {
    const b = bound.get(t);
    let n = typeof d === 'number' ? d : d ? (len ? len * (d.BYTES_PER_ELEMENT || 1) : d.byteLength - (off || 0) * (d.BYTES_PER_ELEMENT || 1)) : 0;
    if (b) { L.buf += n - (L.bufs.get(b) || 0); if (!L.bufs.has(b)) L.nBuf++; L.bufs.set(b, n); }
    if (d && typeof d === 'object') L.up.add(d);
    L.uploads++; L.uploadBytes += n; peak();
    return bd.apply(this, arguments);
  };
  const db = P.deleteBuffer; P.deleteBuffer = function (b) { if (L.bufs.has(b)) { L.buf -= L.bufs.get(b); L.bufs.delete(b); L.nBuf--; } return db.call(this, b); };
  const at = P.activeTexture; P.activeTexture = function (u) { unit = u; return at.call(this, u); };
  const bt = P.bindTexture; P.bindTexture = function (t, x) { texBound.set(unit * 16 + (t & 15), x); return bt.call(this, t, x); };
  const cur = (t) => { const base = (t >= 0x8515 && t <= 0x851A) ? 0x8513 : t; return texBound.get(unit * 16 + (base & 15)); };
  const setLvl = (x, key, n, desc) => {
    if (!x) return;
    if (desc) (L.desc || (L.desc = new Map())).set(x, desc);
    let m = L.texs.get(x); if (!m) { m = new Map(); L.texs.set(x, m); L.nTex++; }
    L.tex += n - (m.get(key) || 0); m.set(key, n); peak();
  };
  const ti = P.texImage2D; P.texImage2D = function (t, lvl, ifmt) {
    let w, h;
    if (arguments.length >= 8) { w = arguments[3]; h = arguments[4]; if (lvl === 0) (L.desc || (L.desc = new Map())).set(cur(t), w + 'x' + h + ' fmt 0x' + ifmt.toString(16) + (arguments[8] ? '' : ' (no data)')); }
    else { const s = arguments[5]; w = s.videoWidth || s.naturalWidth || s.width; h = s.videoHeight || s.naturalHeight || s.height; }
    setLvl(cur(t), t + ':' + lvl, w * h * bpp(ifmt));
    L.uploads++; L.uploadBytes += w * h * bpp(ifmt);
    return ti.apply(this, arguments);
  };
  const ts = P.texStorage2D; P.texStorage2D = function (t, levels, ifmt, w, h) {
    let n = 0; for (let i = 0; i < levels; i++) n += Math.max(1, w >> i) * Math.max(1, h >> i) * bpp(ifmt) * (t === 0x8513 ? 6 : 1);
    setLvl(cur(t), 'storage', n, w + 'x' + h + ' fmt 0x' + ifmt.toString(16) + ' x' + levels + (t === 0x8513 ? ' cube' : ''));
    return ts.apply(this, arguments);
  };
  const t3 = P.texImage3D; P.texImage3D = function (t, lvl, ifmt, w, h, d) { setLvl(cur(t), t + ':' + lvl, w * h * d * bpp(ifmt)); return t3.apply(this, arguments); };
  const s3 = P.texStorage3D; P.texStorage3D = function (t, levels, ifmt, w, h, d) {
    let n = 0; for (let i = 0; i < levels; i++) n += Math.max(1, w >> i) * Math.max(1, h >> i) * d * bpp(ifmt);
    setLvl(cur(t), 'storage', n); return s3.apply(this, arguments);
  };
  const ci = P.compressedTexImage2D; P.compressedTexImage2D = function (t, lvl, ifmt, w, h, b, data) { setLvl(cur(t), t + ':' + lvl, data ? data.byteLength : w * h); return ci.apply(this, arguments); };
  const gm = P.generateMipmap; P.generateMipmap = function (t) {
    const x = cur(t); const m = x && L.texs.get(x);
    if (m) { let base = 0; for (const [k, v] of m) if (k.endsWith(':0')) base += v; setLvl(x, 'mips', Math.round(base / 3)); }
    return gm.call(this, t);
  };
  const dt = P.deleteTexture; P.deleteTexture = function (x) { const m = L.texs.get(x); if (m) { for (const v of m.values()) L.tex -= v; L.texs.delete(x); L.nTex--; } return dt.call(this, x); };
  const br = P.bindRenderbuffer; P.bindRenderbuffer = function (t, r) { rbBound = r; return br.call(this, t, r); };
  const rs = P.renderbufferStorage; P.renderbufferStorage = function (t, f, w, h) { if (rbBound) { L.rb += w * h * bpp(f) - (L.rbs.get(rbBound) || 0); L.rbs.set(rbBound, w * h * bpp(f)); peak(); } return rs.apply(this, arguments); };
  const rm = P.renderbufferStorageMultisample; P.renderbufferStorageMultisample = function (t, s, f, w, h) { if (rbBound) { const n = w * h * bpp(f) * Math.max(1, s); L.rb += n - (L.rbs.get(rbBound) || 0); L.rbs.set(rbBound, n); peak(); } return rm.apply(this, arguments); };
  const dr = P.deleteRenderbuffer; P.deleteRenderbuffer = function (r) { if (L.rbs.has(r)) { L.rb -= L.rbs.get(r); L.rbs.delete(r); } return dr.call(this, r); };
  L.read = () => {
    const c = document.getElementById('gl');
    const fb = c ? c.width * c.height * 4 * 3 : 0;   // colour x2 (swap) + depth
    return { bufMB: +(L.buf / 1e6).toFixed(1), texMB: +(L.tex / 1e6).toFixed(1), rbMB: +(L.rb / 1e6).toFixed(1), fbMB: +(fb / 1e6).toFixed(1),
      totalMB: +((L.buf + L.tex + L.rb + fb) / 1e6).toFixed(1), peakMB: +((L.peak + fb) / 1e6).toFixed(1), nBuf: L.nBuf, nTex: L.nTex,
      uploadedMB: +(L.uploadBytes / 1e6).toFixed(0) };
  };
})();`;

// The JS copies of geometry the scene still holds, by top-level group.
const CENSUS_EXPR = `(() => {
  const d = window.__dbg, seen = new Set(), by = new Map();
  let jsTot = 0, gpuTot = 0, bothTot = 0, nGeo = 0;
  const W = d.world, known = new Map([[W.group, 'world.chunks'], [W.terrainGroup, 'world.terrain'], [W.skyline, 'world.skyline'], [d.lmRoot, 'landmarks']]);
  const label = (o) => {
    let t = o; const path = [];
    while (t && t !== d.scene) { if (known.has(t)) { path.unshift(known.get(t)); break; } if (t.name) path.unshift(t.name); t = t.parent; }
    if (!path.length) path.push(o.type + ':' + (o.material && o.material.type || ''));
    return path.slice(0, 2).join('/');
  };
  d.scene.traverse((o) => {
    const g = o.geometry; if (!g || seen.has(g)) return; seen.add(g); nGeo++;
    let js = 0, gpu = 0, both = 0;
    const one = (a) => {
      if (!a) return;
      const arr = a.array || (a.data && a.data.array);
      const n = arr ? arr.byteLength : a.count * a.itemSize * 4;
      if (!arr || window.__glMem.up.has(arr)) gpu += n;
      if (arr && !seen.has(arr)) { seen.add(arr); js += arr.byteLength; if (window.__glMem.up.has(arr)) both += arr.byteLength; }
    };
    for (const k in g.attributes) one(g.attributes[k]);
    one(g.index);
    const k = label(o), top = k.split('/')[0].split(':')[0];
    for (const kk of [k, '*' + top]) { const r = by.get(kk) || { js: 0, gpu: 0, both: 0, n: 0 }; r.js += js; r.gpu += gpu; r.both += both; r.n++; by.set(kk, r); }
    jsTot += js; gpuTot += gpu; bothTot += both;
  });
  const fmt = ([k, r]) => k.slice(0, 40).padEnd(40) + ' js ' + (r.js / 1e6).toFixed(1).padStart(7) + ' MB  on gpu ' + (r.gpu / 1e6).toFixed(1).padStart(7) + ' MB  both ' + (r.both / 1e6).toFixed(1).padStart(6) + ' MB  geo ' + String(r.n).padStart(5);
  const all = [...by.entries()].sort((a, b) => b[1].js - a[1].js);
  const rows = [...all.filter(([k]) => k[0] === '*').slice(0, 16).map(fmt), '--', ...all.filter(([k]) => k[0] !== '*').slice(0, 12).map(fmt)];
  return 'geometries ' + nGeo + ', JS copies ' + (jsTot / 1e6).toFixed(1) + ' MB, uploaded ' + (gpuTot / 1e6).toFixed(1) + ' MB, held in JS AND uploaded ' + (bothTot / 1e6).toFixed(1) + ' MB\\n    ' + rows.join('\\n    ');
})()`;

// The GPU's textures, largest first, named by the material slot that uses them.
const TEX_EXPR = `(() => {
  const d = window.__dbg, L = window.__glMem, props = d.renderer.properties, names = new Map();
  const note = (t, n) => { if (t && t.isTexture && !names.has(t)) names.set(t, n); };
  d.scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      for (const k in m) if (m[k] && m[k].isTexture) note(m[k], (o.name || o.parent && o.parent.name || o.type) + '.' + k);
      if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) note(v, 'u.' + k); }
    }
  });
  const byGl = new Map();
  for (const [t, n] of names) { const p = props.get(t); if (p && p.__webglTexture) byGl.set(p.__webglTexture, n + ' ' + (t.image ? (t.image.width + 'x' + t.image.height) : '')); }
  const rows = [];
  for (const [x, m] of L.texs) { let n = 0; for (const v of m.values()) n += v; rows.push([n, byGl.get(x) || '(unnamed ' + ((L.desc && L.desc.get(x)) || '') + ')']); }
  // CPU-side sources still held by three textures (canvas backing stores and
  // decoded bitmaps live outside the JS heap in both engines)
  let src = 0; const kinds = {};
  for (const t of names.keys()) { const im = t.image; if (!im || !im.width || im.__released) continue; const k = im.constructor ? im.constructor.name : '?'; const b = im.width * im.height * 4 * (im.depth || 1); src += b; kinds[k] = (kinds[k] || 0) + b; }
  rows.srcLine = ('texture sources held: ' + (src / 1e6).toFixed(1) + ' MB ' + JSON.stringify(Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, +(v / 1e6).toFixed(1)]))));
  rows.sort((a, b) => b[0] - a[0]);
  let unnamed = 0; for (const r of rows) if (r[1][0] === '(') unnamed += r[0];
  return rows.srcLine + '\\n  textures: ' + rows.length + ', unnamed (targets, internal) ' + (unnamed / 1e6).toFixed(1) + ' MB\\n    ' + rows.slice(0, 30).map((r) => (r[0] / 1e6).toFixed(1).padStart(6) + ' MB  ' + r[1]).join('\\n    ');
})()`;

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-memprobe-${PORT}`, gpu: true, width: 874, height: 402,
  extra: ['--enable-precise-memory-info'] });
let closing = false;
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  if (!page || page.url !== 'about:blank') throw new Error(`CDP port ${PORT} is not this run's Chrome`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  ws.addEventListener('close', () => { if (!closing) { console.error('memprobe: DevTools socket closed'); process.exit(2); } });
  let id = 0; const pend = new Map(); const errs = []; let snapOut = null;
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'HeapProfiler.addHeapSnapshotChunk' && snapOut) snapOut.write(m.params.chunk);
    else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  let lastBacking = 0;
  const heap = async (gc) => {
    if (gc) { await send('HeapProfiler.collectGarbage'); await send('HeapProfiler.collectGarbage'); }
    const u = (await send('Runtime.getHeapUsage')).result;
    if (process.env.MEM_USAGE) console.log('  getHeapUsage', JSON.stringify(u));
    // objects + ArrayBuffer backing stores (typed arrays live outside the V8
    // heap; JavaScriptCore counts both, and so does the OS)
    lastBacking = +((u.backingStorageSize || 0) / 1e6).toFixed(1);
    return +((u.usedSize + (u.backingStorageSize || 0)) / 1e6).toFixed(1);
  };
  const report = async (label) => {
    const raw = await heap(false), gc = await heap(true), backing = lastBacking;
    const gpu = await ev('JSON.stringify(window.__glMem.read())');
    const info = await ev('JSON.stringify({ geo: __dbg.renderer.info.memory.geometries, tex: __dbg.renderer.info.memory.textures, chunks: __dbg.world.chunks.size })');
    console.log(`${label}: heap gc ${gc} MB (of which array buffers ${backing}; raw ${raw}), gpu ${gpu}, ${info}`);
    if (CENSUS) console.log('  ' + await ev(CENSUS_EXPR));
    if (process.argv.includes('--tex')) console.log('  ' + await ev(TEX_EXPR));
    // MEM_PROBE_FILE=<file>: an expression evaluated after each measurement
    // (tools/cityqueryhash.js: the city's query answers, hashed)
    if (process.env.MEM_PROBE_FILE) console.log('  probe: ' + await ev(readFileSync(process.env.MEM_PROBE_FILE, 'utf8')));
    return { raw, gc, backing, gpu: JSON.parse(gpu) };
  };

  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('HeapProfiler.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' + GL_LEDGER });
  if (THROTTLE > 1) await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  const snapshot = async (file) => {
    await send('HeapProfiler.collectGarbage');
    snapOut = createWriteStream(file);
    await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
    await new Promise((r) => snapOut.end(r));
    snapOut = null;
    console.log(`snapshot -> ${file}`);
  };
  const boot = async () => {
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
    const t0 = Date.now();
    for (let i = 0; i < 2400; i++) {
      await sleep(250);
      if (await ev('!!(window.__dbg && window.__dbg.sceneStats && window.__dbg.sceneStats.calls > 0)')) break;
    }
    // the first frames of play, and the cache write on a first launch
    await sleep(5000);
    return ((Date.now() - t0) / 1000).toFixed(1);
  };
  const out = {};
  let s = await boot();
  await assertRenderer(ev);
  out.boot1 = await report(`first launch (${s} s)`);
  // --snapshot-boot=FILE: a snapshot of the first launch as well (to diff
  // against the end one: heapsnap.mjs --diff=BOOT)
  const SNAP_BOOT = arg('snapshot-boot', '');
  if (SNAP_BOOT) await snapshot(SNAP_BOOT);
  if (TWICE) {
    s = await boot();
    out.boot2 = await report(`cached launch (${s} s)`);
  }

  // Close the start screen, high quality (the user's setting), and fly.
  const flyPrep = `(() => {
    const d = window.__dbg, G = d.G, p = d.player, c = d.city;
    d.applyQuality('high', true);
    const st = document.getElementById('start'); if (st) st.click();
    d.game.paused = false; d.game.started = true;
    for (const k of ['pauseMenu', 'start']) { const e = document.getElementById(k); if (e) e.classList.remove('show'); }
    return true;
  })()`;
  // A scripted stick: steer for the next waypoint, hold the height, keep 90 m/s.
  const autopilot = (route, agl, speed) => `(() => {
    const d = window.__dbg, G = d.G, p = d.player, c = d.city;
    const R = ${JSON.stringify(route)};
    const A = window.__ap = { wi: 0, R, agl: ${agl}, speed: ${speed}, maxRaw: 0, samples: [] };
    if (!d.controls.__read) d.controls.__read = d.controls.read;
    d.controls.read = function () {
      const v = p.vehicle;
      const r = this.__read();
      if (!v || !A.R) return r;
      const w = A.R[A.wi];
      if (Math.hypot(w.x - v.x, w.z - v.z) < 300) A.wi = (A.wi + 1) % A.R.length;
      let e = Math.atan2(w.x - v.x, w.z - v.z) - v.heading; e = Math.atan2(Math.sin(e), Math.cos(e));
      const ahead = G.terrainHeight(v.x + v.forward.x * 400, v.z + v.forward.z * 400);
      const floorY = Math.max(G.terrainHeight(v.x, v.z), ahead) + A.agl;
      const pitch = v.airborne ? Math.max(-1, Math.min(1, (floorY - v.y) / 35)) : (v.vLong > 28 ? 1 : 0);
      if (v.airborne && v.vLong < A.speed) v.vLong = A.speed;
      return Object.assign(r, { x: v.airborne ? -Math.max(-1, Math.min(1, e * 2.2)) : 0, y: pitch, gas: true, gasAmt: 1 });
    };
    return true;
  })()`;
  const sample = async (secs, label) => {
    let maxRaw = 0, maxGpu = 0, maxGpuPeak = 0; const t0 = Date.now(); const rows = [];
    while (Date.now() - t0 < secs * 1000) {
      await sleep(2000);
      const raw = await heap(false);
      const g = JSON.parse(await ev('JSON.stringify(window.__glMem.read())'));
      const st = JSON.parse(await ev(`JSON.stringify((() => { const d = window.__dbg, o = d.player.vehicle || d.player; return { x: Math.round(o.x), z: Math.round(o.z), agl: Math.round(o.y - d.G.terrainHeight(o.x, o.z)), v: Math.round(d.player.vehicle ? d.player.vehicle.vLong : 0), sky: d.player.sky ? d.player.sky.state : '', far: !!d.world.farMass, chunks: d.world.chunks.size }; })())`));
      maxRaw = Math.max(maxRaw, raw); maxGpu = Math.max(maxGpu, g.totalMB); maxGpuPeak = Math.max(maxGpuPeak, g.peakMB);
      rows.push(raw);
      if (process.env.MEM_TRACE) console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s raw ${raw} gpu ${g.totalMB}`, JSON.stringify(st));
    }
    console.log(`${label}: raw heap max ${maxRaw} MB (mean ${(rows.reduce((a, b) => a + b, 0) / rows.length).toFixed(0)}), gpu max ${maxGpu} MB (ledger peak ${maxGpuPeak})`);
    return { maxRaw, maxGpu };
  };

  // --views=DIR: phone-profile screenshots at fixed places (a Link station,
  // an elevated stretch of Link, Balmer Yard, the ferry terminal, the spawn),
  // standing there long enough for everything to stream in -- for comparing
  // builds by eye where arrays and texture sources are let go.
  const VIEWS = arg('views', '');
  if (VIEWS) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(VIEWS, { recursive: true });
    await ev(flyPrep);
    const places = JSON.parse(await ev(`JSON.stringify((() => {
      const d = window.__dbg, L = d.link, F = d.freight, st = (n) => L.stations.find((q) => q.name.includes(n));
      // beside a track: the middle of its longest run of a kind, 30 m off to
      // the side, looking at it (a camera looks along camYaw + PI)
      const beside = (tr, kind, side) => {
        let best = null, run = null;
        for (let i = 0; i < tr.n; i++) {
          if (tr.KD[i] === kind) { if (!run) run = [i, i]; else run[1] = i; }
          else if (run) { if (!best || run[1] - run[0] > best[1] - best[0]) best = run; run = null; }
        }
        const i = best ? (best[0] + best[1]) >> 1 : tr.n >> 1;
        const dx = tr.X[Math.min(tr.n - 1, i + 5)] - tr.X[i], dz = tr.Z[Math.min(tr.n - 1, i + 5)] - tr.Z[i], l = Math.hypot(dx, dz) || 1;
        const px = -dz / l * side, pz = dx / l * side;
        return [{ x: tr.X[i] + px * 30, z: tr.Z[i] + pz * 30 }, Math.atan2(-px, -pz) + Math.PI];
      };
      const [ld, ly] = beside(L.tracks.sb, 3, 1), [lf, lfy] = beside(L.tracks.sb, 4, 1), [fd, fy] = beside(F.tracks.sb, 4, 1);
      return [
        ['westlake', st('Westlake') || L.stations[0], 0.6],
        ['linkdeck', ld, ly],
        ['linkfill', lf, lfy],
        ['freight', fd, fy],
        ['yard', { x: F.yard.x + 60, z: F.yard.z + 30 }, 4.4],
      ].map(([n, p, yaw]) => ({ n, x: p.x, z: p.z, yaw }));
    })())`));
    for (const v of places) {
      await ev(`(() => { const d = window.__dbg, p = d.player, G = d.G;
        if (!p.onFoot && p.exitVehicle) p.exitVehicle(true);
        p.x = ${v.x}; p.z = ${v.z}; p.y = d.city.groundAt(p.x, p.z, null); p.camYaw = ${v.yaw}; p.camPitch = 0.12;
        d.game.paused = false; return true; })()`);
      await sleep(6000);
      await ev('window.__dbg.game.paused = true; true');
      await sleep(600);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${VIEWS}/${v.n}.png`, Buffer.from(shot.result.data, 'base64'));
      console.log(`view ${v.n} at ${Math.round(v.x)},${Math.round(v.z)}`);
    }
    await ev('window.__dbg.game.paused = false; true');
  }
  if (FLY > 0 || SKY) await ev(flyPrep);
  if (FLY > 0) {
    // Fremont, in the floatplane at 70 m, nose north for Green Lake.
    await ev(`(() => {
      const d = window.__dbg, G = d.G, p = d.player;
      const v = d.traffic.cars.find((k) => k.type === 'floatplane') || d.traffic.cars.find((k) => k.spec.plane && !k.spec.heli && !k.spec.balloon);
      v.x = -700; v.z = -4300; v.y = G.terrainHeight(v.x, v.z) + 70; v.heading = Math.PI; v.vLong = 90; v.airborne = true; v.mode = 'free';
      p.enterVehicle(v);
      p.camYaw = v.heading + Math.PI;
      p.camPos.set(v.x, v.y + 4.6, v.z + 17);
      return v.type;
    })()`);
    await ev(autopilot([{ x: 600, z: -7400 }, { x: 900, z: -10500 }, { x: 4000, z: -11500 }, { x: 2500, z: -5500 }, { x: -3500, z: -5800 }, { x: -4500, z: -3000 }, { x: -700, z: -4300 }], 70, 90));
    // --alloc: where the flight's allocations come from (sampling heap
    // profiler, collected objects included): what makes the garbage
    const ALLOC = process.argv.includes('--alloc');
    if (ALLOC) await send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    out.fly = await sample(FLY, `flight ${FLY} s`);
    if (ALLOC) {
      const prof = (await send('HeapProfiler.stopSampling')).result.profile;
      const self = new Map(); let tot = 0;
      const walk = (n, stack) => {
        const cf = n.callFrame, k = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/apps\/auto\//, '')}:${cf.lineNumber + 1}`;
        if (n.selfSize) { self.set(k, (self.get(k) || 0) + n.selfSize); tot += n.selfSize; }
        for (const c of n.children || []) walk(c, stack);
      };
      walk(prof.head, []);
      console.log(`allocated in flight (sampled): ${(tot / 1e6).toFixed(0)} MB, ${(tot / 1e6 / FLY).toFixed(1)} MB/s; top sites:`);
      for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, +(process.env.MEM_ALLOC_TOP || 30))) console.log(`  ${(v / 1e6).toFixed(1).padStart(8)} MB  ${k}`);
    }
    out.flyEnd = await report('after the flight');
  }
  if (SKY) {
    await ev(`(() => {
      const d = window.__dbg, G = d.G, p = d.player;
      let v = p.vehicle;
      if (!v) { v = d.traffic.cars.find((k) => k.type === 'jumbo') || d.traffic.cars.find((k) => k.spec.plane && !k.spec.heli && !k.spec.balloon); v.mode = 'free'; p.enterVehicle(v); }
      v.x = 300; v.z = 1500; v.y = 1500; v.heading = Math.PI; v.vLong = 90; v.airborne = true;
      p.camPos.set(v.x, v.y + 4.6, v.z + 17);
      return true;
    })()`);
    await ev(autopilot([{ x: 300, z: -3000 }], 1430, 90));
    const a = await sample(10, 'climb at 1500 m');
    await ev(`(() => { const d = window.__dbg; window.__ap.R = null; return d.player.exitVehicle(); })()`);
    const b = await sample(+(process.env.MEM_SKY_S || 50), 'skydive');
    out.sky = { maxRaw: Math.max(a.maxRaw, b.maxRaw), maxGpu: Math.max(a.maxGpu, b.maxGpu) };
    out.skyEnd = await report('after the skydive');
  }
  if (SNAP) await snapshot(SNAP);
  console.log(`exceptions: ${errs.length}${errs.length ? '\n  ' + errs.slice(0, 5).join('\n  ') : ''}`);
  console.log('MEMPROBE ' + JSON.stringify(out));
} finally { closing = true; chrome.kill('SIGKILL'); }
