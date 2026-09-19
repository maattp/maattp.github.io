// CPU cost of render SUBMISSION (three's scene walk, culling, sorting, uniform
// uploads and GL calls -- not GPU time), bisected by hiding parts of the scene.
//
//   AUTO_HTTP_PORT=8000 node tools/rendercpu.mjs [--x=305 --z=-278] [--frames=120]
//
// Runs on the Mac's GPU at the iPhone 17 Pro viewport (tools/chrome.mjs), game
// paused and streaming settled, and times renderer.render(scene, camera) into
// postfx's target directly, so every configuration draws the same frame. Each
// row hides one class of object and reports the median ms saved. A phone's JS
// is ~2-4x slower than an M-series Mac's: read ratios, not absolutes.
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome, assertRenderer } from './chrome.mjs';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9496;
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const X = +arg('x', 305), Z = +arg('z', -278), FRAMES = +arg('frames', 120);
const BUILDS = process.argv.includes('--builds');
const PROF = process.argv.includes('--prof');
const SPIKES = process.argv.includes('--spikes');
const STREAM = process.argv.includes('--stream');
const RING = +arg('ring', 2);   // --builds: 4 = the whole 9x9 streaming ring (mid chunks at lod 0)
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-rendercpu-${PORT}`, gpu: true, width: 874, height: 402, vsyncOff: true, extra: ['--js-flags=--expose-gc'] });
let code = 0;
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  if (!page || page.url !== 'about:blank') throw new Error(`CDP port ${PORT} is not this run's Chrome`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === 'Runtime.consoleAPICalled' && process.env.RCPU_LOG) console.log('PAGE', m.params.args.map((a) => a.value).join(' ')); });
  ws.addEventListener('close', () => process.exit(3));
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__noAutoQuality = true; try { localStorage.setItem('auto-quality', 'high'); } catch (e) {}` });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  await assertRenderer(ev, console.log, true);
  for (let i = 0; i < 240; i++) { if (await ev('window.__dbg.sceneStats.calls > 0 && window.__dbg.traffic.cars.length > 0')) break; await sleep(500); }
  const build = (/id="build">([^<]*)</.exec(await (await fetch(`http://localhost:${HTTP_PORT}/apps/auto/index.html`)).text()) || [])[1];
  if (STREAM) {
    // Arrive the way a player does (respawn / fast travel) and time the streamer
    // in the live loop until the ring settles: the frames it takes and the CPU.
    const r = JSON.parse(await ev(`(async () => {
      const d = window.__dbg, w = d.world;
      const orig = w.update.bind(w); let ms = 0, n = 0, maxMs = 0;
      w.update = function (...a) { const t0 = performance.now(); const res = orig(...a); const dt = performance.now() - t0; ms += dt; n++; maxMs = Math.max(maxMs, dt); return res; };
      const bcs = w.buildChunkStep.bind(w); let chunks = 0, near = 0;
      w.buildChunkStep = function (cx, cz, lod) { chunks++; if (lod === 1) near++; return bcs(cx, cz, lod); };
      d.player.respawn(${X}, ${Z});
      const pend = () => [...w.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
      const t0 = performance.now(); let f = 0;
      for (; f < 20000; f++) { await new Promise((res) => requestAnimationFrame(res)); if (f > 5 && pend() === 0) break; }
      const wall = performance.now() - t0;
      w.update = orig; w.buildChunkStep = bcs;
      return JSON.stringify({ frames: f, n, ms, maxMs, wall, chunks, near });
    })()`));
    console.log(`stream :${HTTP_PORT} build ${build} respawn at (${X}, ${Z}): settled in ${r.frames} frames (${(r.wall / 1000).toFixed(1)} s wall)`);
    console.log(`  world.update total ${r.ms.toFixed(0)} ms over ${r.n} calls (mean ${(r.ms / r.n).toFixed(2)}, max ${r.maxMs.toFixed(1)});  builds started ${r.chunks} (${r.near} near)`);
    throw { done: true };
  }
  // Put the player at the spot, let traffic and crowds fill in for real, then freeze.
  await ev(`(async () => { const d = window.__dbg; d.player.respawn(${X}, ${Z});
    const t0 = performance.now(); while (performance.now() - t0 < 8000) await new Promise((r) => requestAnimationFrame(r));
    d.game.paused = true;
    const pend = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
    for (let i = 0; i < 3000 && pend() > 0; i++) d.world.update(${X}, ${Z}, 60);
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r)); })()`);
  if (SPIKES) {
    // Live loop, standing still: which render call spikes, and what changed.
    const r = JSON.parse(await ev(`(async () => {
      const d = window.__dbg, R = d.renderer;
      d.game.paused = false;
      for (let i = 0; i < 60; i++) await new Promise((res) => requestAnimationFrame(res));
      const orig = R.render.bind(R);
      let calls = [];
      R.render = (sc, cam) => { const t0 = performance.now(); orig(sc, cam); calls.push([sc === d.scene ? 'scene' : 'post', performance.now() - t0]); };
      const rows = [];
      let prev = { g: R.info.memory.geometries, t: R.info.memory.textures, p: R.info.programs.length };
      for (let f = 0; f < 600; f++) {
        calls = [];
        await new Promise((res) => requestAnimationFrame(res));
        const m = { g: R.info.memory.geometries, t: R.info.memory.textures, p: R.info.programs.length };
        const tot = calls.reduce((a, c) => a + c[1], 0);
        rows.push({ f, tot, calls: calls.map((c) => c[0][0] + c[1].toFixed(1)).join(' '), dg: m.g - prev.g, dt: m.t - prev.t, dp: m.p - prev.p,
          cars: d.traffic.cars.length, peds: d.peds.peds.length });
        prev = m;
      }
      R.render = orig;
      const sorted = [...rows].sort((a, b) => b.tot - a.tot);
      const med = [...rows].map((k) => k.tot).sort((a, b) => a - b)[300];
      return JSON.stringify({ med, top: sorted.slice(0, 20), spikes: rows.filter((k) => k.tot > med * 3).length,
        withGeo: rows.filter((k) => k.tot > med * 3 && k.dg !== 0).length, withProg: rows.filter((k) => k.tot > med * 3 && k.dp !== 0).length,
        period: rows.filter((k) => k.tot > med * 3).map((k) => k.f).slice(0, 40).join(',') });
    })()`));
    console.log(`spikes :${HTTP_PORT} build ${build}: median render ${r.med.toFixed(2)} ms, ${r.spikes}/600 frames over 3x, ${r.withGeo} with geometry count change, ${r.withProg} with new programs`);
    console.log(`  spike frames: ${r.period}`);
    for (const k of r.top) console.log(`  f${k.f} ${k.tot.toFixed(1)} ms  [${k.calls}]  dgeo ${k.dg} dtex ${k.dt} dprog ${k.dp}  cars ${k.cars} peds ${k.peds}`);
    throw { done: true };
  }
  if (BUILDS) {
    // Time a full rebuild of each chunk in the 5x5 near ring, driving the same
    // generator world.update slices (buildChunkStep) to completion in one go.
    if (PROF) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 }); await send('Profiler.start'); }
    // --throttle=N: CPU N-fold slower for the measured part (the phone stand-in;
    // it also takes the Mac's GPU out of the timing, which it otherwise sets).
    const THR = +arg('throttle', 1);
    if (THR > 1) await send('Emulation.setCPUThrottlingRate', { rate: THR });
    // RCPU_PRE='<js>': an experiment run first (stub a function, time the rest).
    if (process.env.RCPU_PRE) await ev(`(() => { const d = window.__dbg, w = d.world, city = d.city, G = d.G; ${process.env.RCPU_PRE} })()`);
    // RCPU_LOOP='<js>' (with --builds [--prof]): run that body RCPU_N times
    // instead of the chunk builds -- profile the renderer, traffic.update, ...
    const LOOP = process.env.RCPU_LOOP;
    // RCPU_HEAP=1: sampling heap profile of the loop -- who allocates per frame.
    const HEAP = !!process.env.RCPU_HEAP;
    if (HEAP) { await send('HeapProfiler.enable'); await send('HeapProfiler.collectGarbage'); await send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
    const b = LOOP ? JSON.parse(await ev(`(() => { const d = window.__dbg, w = d.world, city = d.city, G = d.G;
      const t0 = performance.now(); for (let it = 0; it < ${+process.env.RCPU_N || 200}; it++) { ${LOOP} }
      const ms = performance.now() - t0; return JSON.stringify({ loop: true, ms, per: ms / ${+process.env.RCPU_N || 200} }); })()`))
    : JSON.parse(await ev(`(() => {
      const d = window.__dbg, w = d.world;
      const cx0 = Math.floor(${X} / 400), cz0 = Math.floor(${Z} / 400);
      const t = [];
      for (let dz = -${RING}; dz <= ${RING}; dz++) for (let dx = -${RING}; dx <= ${RING}; dx++) {
        const lod = Math.max(Math.abs(dx), Math.abs(dz)) <= 2 ? 1 : 0;
        const t0 = performance.now();
        const gen = w.buildChunkStep(cx0 + dx, cz0 + dz, lod);
        let st, steps = 0, smax = 0;
        do { const s0 = performance.now(); st = gen.next(); const sd = performance.now() - s0; if (sd > smax) smax = sd; steps++; } while (!st.done);
        window.__smax = Math.max(window.__smax || 0, smax); (window.__steps = window.__steps || []).push(smax);
        const ms = performance.now() - t0;
        let verts = 0, sum = 0;
        if (st.value) st.value.traverse((o) => {
          if (!o.geometry) return;
          const pa = o.geometry.attributes.position;
          if (pa) { verts += pa.count; const A = pa.array; for (let q = 0; q < A.length; q += 7) sum += A[q] * ((q % 13) + 1); }
          for (const nm of ['normal', 'color', 'uv']) { const at = o.geometry.attributes[nm]; if (at) { const A = at.array; for (let q = 0; q < A.length; q += 5) sum += A[q] * ((q % 11) + 1) * 0.01; } }
          if (o.geometry.index) { const A = o.geometry.index.array; for (let q = 0; q < A.length; q += 3) sum += (A[q] % 997) * 1e-4 * (A.BYTES_PER_ELEMENT); }
          o.geometry.dispose();
        });
        t.push({ ms, steps, verts, sum, lod });
      }
      const ms = t.map((k) => k.ms).sort((a, b) => a - b);
      const verts = t.reduce((a, k) => a + k.verts, 0), sum = t.reduce((a, k) => a + k.sum, 0);
      const sm = window.__steps.sort((a, b) => a - b); console.log(JSON.stringify(window.__sd));
      const tot = (l) => t.filter((k) => k.lod === l).reduce((a, k) => a + k.ms, 0);
      return JSON.stringify({ nearMs: tot(1), midMs: tot(0), midN: t.filter((k) => !k.lod).length, stepMax: window.__smax, stepMed: sm[sm.length >> 1], steps: t.reduce((a, k) => a + k.steps, 0) / t.length, verts, sum: sum.toFixed(1), n: ms.length, median: ms[ms.length >> 1], mean: ms.reduce((a, b) => a + b, 0) / ms.length, max: ms[ms.length - 1], total: ms.reduce((a, b) => a + b, 0) });
    })()`));
    if (process.env.RCPU_POST) {
      // A post that returns 'shots:' + JSON [dataURL, ...] (window.__shot() makes
      // one) writes them to RCPU_SHOT-0.png, -1.png ... instead of printing.
      await ev(`window.__shot = () => { const d = window.__dbg; d.renderer.setRenderTarget(d.postfx.target); d.renderer.render(d.scene, d.camera); d.postfx.render(performance.now() / 1000, d.camera); d.renderer.setRenderTarget(null); return d.renderer.domElement.toDataURL('image/png'); }`);
      const out = await ev(`(() => { const d = window.__dbg, w = d.world, city = d.city; return (async () => String(await (${process.env.RCPU_POST})))(); })()`);
      if (out && out.startsWith('shots:')) {
        const fs = await import('node:fs');
        JSON.parse(out.slice(6)).forEach((u, i) => fs.writeFileSync(`${process.env.RCPU_SHOT || '/tmp/rcpu'}-${i}.png`, Buffer.from(u.split(',')[1], 'base64')));
        console.log('post: wrote', JSON.parse(out.slice(6)).length, 'shots');
      } else console.log('post:', out);
    }
    // RCPU_SHOT=file.png: after RCPU_POST, draw one frame and save the canvas.
    if (process.env.RCPU_SHOT) {
      const url = await ev(`(async () => { const d = window.__dbg; await new Promise((r) => requestAnimationFrame(r));
        d.renderer.setRenderTarget(d.postfx.target); d.renderer.render(d.scene, d.camera); d.postfx.render(performance.now() / 1000, d.camera); d.renderer.setRenderTarget(null);
        return d.renderer.domElement.toDataURL('image/png'); })()`);
      (await import('node:fs')).writeFileSync(process.env.RCPU_SHOT, Buffer.from(url.split(',')[1], 'base64'));
    }
    if (PROF) {
      const prof = (await send('Profiler.stop')).result.profile;
      const byId = new Map(prof.nodes.map((n) => [n.id, n]));
      const parent = new Map(); for (const n of prof.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
      const self = new Map(), incl = new Map(); let total = 0;
      for (let i = 0; i < prof.samples.length; i++) {
        const us = prof.timeDeltas[i + 1] !== undefined ? prof.timeDeltas[i + 1] : 0;
        const leaf = prof.samples[i]; const lf = byId.get(leaf).callFrame;
        if (lf.functionName === '(idle)' || lf.functionName === '(program)') continue;
        total += us;
        const key = (n) => { const cf = n.callFrame; return `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/apps\/auto\//, '')}:${cf.lineNumber + 1}`; };
        self.set(key(byId.get(leaf)), (self.get(key(byId.get(leaf))) || 0) + us);
        const seen = new Set();
        for (let nid = leaf; nid !== undefined; nid = parent.get(nid)) { const k = key(byId.get(nid)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + us); } }
      }
      const show = (m, lbl) => { console.log(`  ${lbl}:`); for (const [k, us] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28)) console.log(`    ${(us / 1000).toFixed(0).padStart(6)} ms ${(us / total * 100).toFixed(1).padStart(5)}%  ${k}`); };
      show(self, 'self time'); show(incl, 'inclusive');
      // RCPU_FN=meshNode: that function's hottest source lines (positionTicks).
      if (process.env.RCPU_FN) {
        const lines = new Map(); let n = 0;
        for (const nd of prof.nodes) {
          if (nd.callFrame.functionName !== process.env.RCPU_FN || !nd.positionTicks) continue;
          for (const pt of nd.positionTicks) { lines.set(pt.line, (lines.get(pt.line) || 0) + pt.ticks); n += pt.ticks; }
        }
        console.log(`  ${process.env.RCPU_FN} by line (${n} ticks):`);
        for (const [ln, t] of [...lines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`    line ${ln}: ${t} (${(t / n * 100).toFixed(1)}%)`);
      }
    }
    if (b.loop && HEAP) {
      const hp = (await send('HeapProfiler.stopSampling')).result.profile;
      const self = new Map(); let tot = 0;
      const walk = (n, stack) => {
        const cf = n.callFrame; const k = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/apps\/auto\//, '')}:${cf.lineNumber + 1}`;
        if (n.selfSize) { self.set(k, (self.get(k) || 0) + n.selfSize); tot += n.selfSize; }
        for (const c of n.children || []) walk(c);
      };
      walk(hp.head);
      console.log(`  allocated (sampled) ${(tot / 1e6).toFixed(1)} MB over the loop; top by self:`);
      for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`    ${(v / 1e3).toFixed(0).padStart(7)} kB ${(v / tot * 100).toFixed(1).padStart(5)}%  ${k}`);
    }
    if (b.loop) { console.log(`loop: ${b.ms.toFixed(0)} ms total, ${b.per.toFixed(3)} ms per iteration`); throw { done: true }; }
    console.log(`chunk builds :${HTTP_PORT} build ${build} near (${X}, ${Z}): ${b.n} chunks  median ${b.median.toFixed(1)} ms  mean ${b.mean.toFixed(1)}  max ${b.max.toFixed(1)}  total ${b.total.toFixed(0)} ms   geometry ${b.verts} verts, checksum ${b.sum}   steps/chunk ${b.steps.toFixed(0)}, near ${b.nearMs.toFixed(0)} ms / mid ${b.midMs.toFixed(0)} ms over ${b.midN}, longest step per chunk: median ${b.stepMed.toFixed(1)} ms, worst ${b.stepMax.toFixed(1)} ms`);
    process.exitCode = 0;
    throw { done: true };
  }
  const out = JSON.parse(await ev(`(() => {
    const d = window.__dbg, r = d.renderer, sc = d.scene, cam = d.camera;
    const time = () => {
      const t = [];
      for (let i = 0; i < ${FRAMES}; i++) {
        r.setRenderTarget(d.postfx.target);
        const t0 = performance.now(); r.render(sc, cam); t.push(performance.now() - t0);
        r.setRenderTarget(null);
      }
      t.sort((a, b) => a - b); return t[t.length >> 1];
    };
    const vis = (pred) => { const hit = []; sc.traverse((o) => { if (o.visible && pred(o)) { o.visible = false; hit.push(o); } }); return () => hit.forEach((o) => { o.visible = true; }); };
    const cars = new Set(d.traffic.cars.map((v) => v.group)), peds = new Set(d.peds.peds.map((p) => p.h ? p.h.group : p.group).filter(Boolean));
    const under = (set) => (o) => { for (let p = o; p; p = p.parent) if (set.has(p)) return true; return false; };
    const chunkSet = new Set([...d.world.chunks.values()].map((c) => c.group).filter(Boolean));
    const rows = [];
    const base = time();
    r.info.autoReset = false; r.info.reset(); r.setRenderTarget(d.postfx.target); r.render(sc, cam); r.setRenderTarget(null);
    const baseCalls = r.info.render.calls; r.info.autoReset = true;
    rows.push(['base (' + baseCalls + ' calls incl. shadow pass)', base, 0]);
    const cfg = [
      ['traffic+parked cars', under(cars)],
      ['pedestrians', under(peds)],
      ['world chunks', under(chunkSet)],
      ['landmarks', (o) => /landmark|spaceNeedle/i.test(o.name || '') ],
      ['skinned meshes', (o) => o.isSkinnedMesh],
      ['transparent materials', (o) => o.isMesh && o.material && (Array.isArray(o.material) ? o.material.some((m) => m.transparent) : o.material.transparent)],
      ['shadow casting off', null],
      ['parked cars', (o) => { for (const v of d.traffic.cars) if (v.mode === 'parked' && v.group === o) return true; return false; }],
      ['moving traffic', (o) => { for (const v of d.traffic.cars) if (v.mode !== 'parked' && v.group === o) return true; return false; }],
      ['far massing/roads/skyline', (o) => /far|skyline/i.test(o.name || '')],
    ];
    for (const [name, pred] of cfg) {
      let undo;
      if (!pred) { const was = r.shadowMap.enabled; r.shadowMap.enabled = false; undo = () => { r.shadowMap.enabled = was; }; }
      else undo = vis(pred);
      const t = time();
      r.info.autoReset = false; r.info.reset(); r.setRenderTarget(d.postfx.target); r.render(sc, cam); r.setRenderTarget(null);
      const calls = r.info.render.calls; r.info.autoReset = true;
      undo(); rows.push([name + ' (' + calls + ' calls)', t, base - t]);
    }
    rows.push(['base again', time(), 0]);
    let objs = 0, meshes = 0, skinned = 0, transp = 0, cb = 0;
    sc.traverse((o) => { objs++; if (o.isMesh) meshes++; if (o.isSkinnedMesh) skinned++;
      if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.transparent) transp++;
      if (o.onBeforeRender && o.onBeforeRender.toString().length > 20) cb++; });
    return JSON.stringify({ rows, objs, meshes, skinned, transp, cb, draws: d.sceneStats.calls, cars: d.traffic.cars.length, peds: d.peds.peds.length });
  })()`));
  console.log(`rendercpu :${HTTP_PORT} build ${build} at (${X}, ${Z})  ${out.draws} draws  ${out.cars} cars ${out.peds} peds`);
  console.log(`  scene: ${out.objs} objects, ${out.meshes} meshes, ${out.skinned} skinned, ${out.transp} transparent, ${out.cb} onBeforeRender`);
  for (const [n, t, dlt] of out.rows) console.log(`  ${n.padEnd(24)} ${t.toFixed(2).padStart(6)} ms${dlt ? `   saves ${dlt.toFixed(2)}` : ''}`);
} catch (e) { if (!(e && e.done)) { console.log('ERROR', e.message); code = 2; } } finally { chrome.kill(); }
process.exit(code);
