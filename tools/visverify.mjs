// Headless verification for apps/visualizer. Boots it in Chrome over CDP with
// a fake microphone, walks every preset (desktop + phone viewport), enters the
// hidden Arwing mode, and writes screenshots to tools/data/visshots/.
//
//   python3 -m http.server 8000 &
//   node tools/visverify.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9223, URL = process.env.VIS_URL || 'http://localhost:8000/apps/visualizer/';
const OUT = 'tools/data/visshots'; mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,720', '--no-first-run', '--user-data-dir=/tmp/vis-verify-profile', 'about:blank'], { stdio: 'ignore' });

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

  for (const [label, w, h, mobile] of [['desktop', 1280, 720, false], ['phone', 390, 844, true]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 3 : 1, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
    await send('Page.navigate', { url: URL + '?v=' + Date.now() });
    await sleep(1200);
    await shot(`${label}-start`);
    await ev("document.getElementById('go').click()");
    await sleep(1500);
    check(await ev('running === true'), `${label}: started`);
    check(await ev("document.getElementById('start') === null"), `${label}: start screen removed`);
    check(await ev('analyser !== null'), `${label}: mic analyser attached`);
    const n = await ev('PRESETS.length');
    for (let i = 0; i < n; i++) {
      await ev(`setPreset(${i})`);
      await sleep(900);
      const name = await ev(`PRESETS[${i}].name`);
      const lvl = await ev('A.level');
      check(lvl > 0.01, `${label}: preset ${i + 1} ${name} (level ${lvl.toFixed(2)})`);
      await shot(`${label}-${i + 1}-${name.replace(/[^a-z]/gi, '').toLowerCase()}`);
    }
    await ev('setPreset(6); gameStart()');
    await sleep(2500);
    check(await ev('G.on && G.ents.length > 0'), `${label}: game running with ${await ev('G.ents.length')} entities`);
    await ev('G.fire = true'); await sleep(1500);
    check(await ev('G.shots.length > 0 || G.score > 0'), `${label}: lasers fire (score ${await ev('G.score')})`);
    await shot(`${label}-game`);
    await ev('gameOver()'); await sleep(300); await shot(`${label}-gameover`);
    await ev('gameEnd()');
    check(await ev('!G.on'), `${label}: game exits`);
  }
  check(logs.length === 0, 'no exceptions / console errors');
  for (const l of logs) console.log('   ' + l);
} catch (e) { console.log('FAIL', e); fail++; }
finally { chrome.kill(); }
console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL OK'); process.exit(fail ? 1 : 0);
