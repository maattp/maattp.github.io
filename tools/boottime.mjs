// Where does the loading bar's time go? Every loading message, with how long
// it was on screen, on the phone profile.
//
//   AUTO_HTTP_PORT=8000 node tools/boottime.mjs [--throttle=8] [--desktop] [--prof]
//
// --throttle slows the CPU from BEFORE navigation (unlike perfcpu, which boots
// fast and throttles after), so the whole boot runs at the phone stand-in's
// speed. Service worker bypassed and cache disabled, so every run downloads
// the map data like a first launch on a cold cache -- from localhost, so the
// network part is near zero; on a phone it is not (see the Downloading line).
// --prof adds a CPU profile of the boot (it runs no rAF loop to hang on).
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome, assertRenderer } from './chrome.mjs';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9499;
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const THROTTLE = +arg('throttle', 1);
const DESKTOP = process.argv.includes('--desktop');
const PROF = process.argv.includes('--prof');
// --twice: boot, then reload in the same profile and time the SECOND launch
// (what bootcache.js makes faster). The first boot's report is skipped.
const TWICE = process.argv.includes('--twice');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-boottime-${PORT}`, gpu: true, width: 874, height: 402, vsyncOff: true });
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
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (!DESKTOP) {
    await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  }
  // Log every change of the loading message, from the first byte of the page.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__noAutoQuality = true;
    window.__boot = [];
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.getElementById('loadMsg'); if (!el) return;
      const rec = () => window.__boot.push([performance.now(), el.textContent]);
      rec(); new MutationObserver(rec).observe(el, { childList: true, characterData: true, subtree: true });
    });` });
  // BOOT_WAIT=<ms>: wait that long after each launch before BOOT_PROBE runs
  // (to let a BOOT_INJECT recorder see the first frames of play).
  // BOOT_INJECT='<js>': run before the page's own scripts on every load (to
  // simulate a platform failure -- a decode that never resolves, a dead IDB).
  if (process.env.BOOT_INJECT) await send('Page.addScriptToEvaluateOnNewDocument', { source: process.env.BOOT_INJECT });
  if (THROTTLE > 1) await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  if (PROF) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 500 }); await send('Profiler.start'); }
  if (TWICE) {
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
    for (let i = 0; i < 1200; i++) { await sleep(250); if (await ev('window.__dbg && window.__dbg.sceneStats && window.__dbg.sceneStats.calls > 0')) break; }
    console.log('  first launch done (cached for the next): gradeCached=' + await ev('window.__dbg.cityStats.gradeCached'));
    if (process.env.BOOT_WAIT) await sleep(+process.env.BOOT_WAIT);
    if (process.env.BOOT_PROBE) console.log('  probe 1: ' + await ev(`(() => { const d = window.__dbg; return String(${process.env.BOOT_PROBE}); })()`));
  }
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  let done = 0;
  for (let i = 0; i < 1200; i++) {
    await sleep(250);
    done = await ev('window.__dbg && window.__dbg.sceneStats && window.__dbg.sceneStats.calls > 0 ? performance.now() : 0');
    if (done) break;
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
    const show = (m, lbl) => { console.log(`  ${lbl}:`); for (const [k, us] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`    ${(us / 1000).toFixed(0).padStart(6)} ms ${(us / total * 100).toFixed(1).padStart(5)}%  ${k}`); };
    show(self, 'self time'); show(incl, 'inclusive');
  }
  if (TWICE) console.log('  second launch gradeCached=' + await ev('window.__dbg.cityStats.gradeCached'));
  if (process.env.BOOT_WAIT) await sleep(+process.env.BOOT_WAIT);
  if (process.env.BOOT_PROBE) console.log('  probe 2: ' + await ev(`(() => { const d = window.__dbg; return String(${process.env.BOOT_PROBE}); })()`));
  const log = await ev('JSON.stringify(window.__boot)');
  const rows = JSON.parse(log || '[]');
  const build = (/id="build">([^<]*)</.exec(await (await fetch(`http://localhost:${HTTP_PORT}/apps/auto/index.html`)).text()) || [])[1];
  console.log(`boot ${build} ${DESKTOP ? 'desktop' : 'phone'} throttle ${THROTTLE}x: first frame at ${(done / 1000).toFixed(1)} s`);
  // Collapse consecutive repeats; print each message with its time on screen.
  const phases = [];
  for (const [t, m] of rows) {
    if (phases.length && phases[phases.length - 1].m === m) continue;
    phases.push({ t, m });
  }
  const agg = new Map();
  for (let i = 0; i < phases.length; i++) {
    const end = i + 1 < phases.length ? phases[i + 1].t : done;
    const k = phases[i].m.replace(/[0-9.]+ ?(MB|%|of \d+)/g, '#');
    agg.set(k, (agg.get(k) || 0) + (end - phases[i].t));
  }
  for (const [m, ms] of [...agg.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${(ms / 1000).toFixed(2).padStart(7)} s  ${m}`);
} finally {
  chrome.kill('SIGKILL');
}
