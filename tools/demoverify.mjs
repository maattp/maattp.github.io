// Headless verification for apps/demo. Boots the demo in Chrome over CDP,
// seeks to every part (and a few key moments), and writes screenshots to
// tools/data/demoshots/ for desktop, phone-landscape and phone-portrait.
//
//   python3 -m http.server 8000 &
//   node tools/demoverify.mjs            # SwiftShader (slow, but anywhere)
//   AUTO_GPU=1 node tools/demoverify.mjs # the Mac's GPU, real frame times
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome, assertRenderer } from './chrome.mjs';

const PORT = 9231, URL = process.env.DEMO_URL || 'http://localhost:8000/apps/demo/';
const OUT = 'tools/data/demoshots'; mkdirSync(OUT, { recursive: true });
const chrome = launchChrome({ port: PORT, profile: '/tmp/demo-verify-profile', extra: ['--autoplay-policy=no-user-gesture-required'] });

async function target() {
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) return p; } catch {}
    await sleep(300);
  }
  throw new Error('no CDP target');
}
let id = 0; const pending = new Map(); const logs = [];
let ws;
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); };

// [label, bar + beat offset] — one per part plus the moments that matter
const MOMENTS = (process.env.DEMO_BARS ? process.env.DEMO_BARS.split(',').map((b) => [`bar${b}`, +b]) : [
  ['01-intro-logo', 2.5], ['02-intro-socks', 6.5], ['03-tunnel', 10], ['04-glenz', 18], ['05-balls', 27],
  ['06-outrun', 34], ['07-galaxy', 42], ['08-menger', 50], ['09-plasma', 58], ['10-blobs', 66],
  ['11-field', 74], ['12-cuts', 82], ['13-kaleido', 89], ['14-glitch', 93], ['15-outro', 98],
]);
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
try {
  const t = await target();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });

  const views = process.env.DEMO_VIEWS ? process.env.DEMO_VIEWS.split(',') : ['desktop', 'phone', 'portrait'];
  const VIEW = { desktop: [1280, 720, 1, false], phone: [874, 402, 3, true], portrait: [402, 874, 3, true] };
  for (const label of views) {
    const [w, h, dpr, mobile] = VIEW[label];
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
    await send('Page.navigate', { url: URL + '?nosw&v=' + Date.now() });
    for (let i = 0; i < 120 && !(await ev("!!document.querySelector('#go.ready')").catch(() => false)); i++) await sleep(500);
    check(await ev("!!document.querySelector('#go.ready')"), `${label}: precalc finished`);
    if (label === views[0]) await assertRenderer(ev);
    await sleep(800); await shot(`${label}-00-start`);
    await ev("document.getElementById('go').click()");
    await sleep(600);
    check(await ev('__demo.Music.ok'), `${label}: audio context up (${await ev('__demo.Music.ctx && __demo.Music.ctx.state')})`);
    const cw = await ev('[innerWidth, innerHeight, document.getElementById("c").getBoundingClientRect().width, document.getElementById("c").getBoundingClientRect().height]');
    check(cw[0] === cw[2] && cw[1] === cw[3], `${label}: canvas fills the viewport ${cw.join('x')}`);
    for (const [name, bar] of MOMENTS) {
      // land on `bar` at the moment of the screenshot: seek back by the wait
      const wait = +process.env.DEMO_WAIT || 1800;
      await ev(`__demo.seek(${Math.floor(bar)}); __demo.Music.anchorSong += ${(bar % 1) * 4} * 60 / 138 - ${wait / 1000}`);
      await sleep(wait);
      const q = await ev('__demo.q');
      await shot(`${label}-${name}`);
      if (process.env.DEMO_PERF) {
        const ms = await ev(`new Promise((r) => { const d = []; let l = 0; const f = (n) => { if (l) d.push(n - l); l = n; d.length < 90 ? requestAnimationFrame(f) : r(d); }; requestAnimationFrame(f); })`, true);
        ms.sort((a, b) => a - b);
        console.log(`      ${name}: median ${ms[45].toFixed(1)} ms, p90 ${ms[81].toFixed(1)} ms`);
      }
      const lvl = await ev('__demo.Music.level');
      if (bar >= 9 && bar < 40 || bar >= 48 && bar < 96) check(lvl > 0.05, `${label} ${name}: music is playing (level ${lvl.toFixed(2)})`);
      console.log(`      ${label} ${name}  q=${q.map((x) => x.toFixed(2)).join('/')}`);
    }
  }
  check(logs.length === 0, 'no exceptions / console errors');
  logs.slice(0, 20).forEach((l) => console.log('  ' + l));
} catch (e) { console.error(e); fail++; }
finally { chrome.kill(); }
process.exit(fail ? 1 : 0);
