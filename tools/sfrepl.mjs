// Quick CDP runner for apps/spaceflight: boots the game headless and evaluates
// each argv expression in order (awaiting promises), printing the results.
//   node tools/sfrepl.mjs "expr1" "expr2" ...   (use `await sleep(ms)` inside)
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT = 9241, URL = process.env.SF_URL || 'http://localhost:8000/apps/spaceflight/?dbg=1';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--window-size=1280,720', '--no-first-run', '--user-data-dir=/tmp/sf-repl-profile', 'about:blank'], { stdio: 'ignore' });
async function target() { for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) return p; } catch {} await sleep(300); } throw new Error('no CDP target'); }
let id = 0; const pending = new Map(); const logs = []; let ws;
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
try {
  const t = await target();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } else if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); else if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description).join(' ')); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '&v=' + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(250); const r = await send('Runtime.evaluate', { expression: '!!window.__sf', returnByValue: true }); if (r.result.value) break; }
  await send('Runtime.evaluate', { expression: 'window.__skipIntro = true' });
  let n = 0;
  for (const expr of process.argv.slice(2)) {
    if (expr.startsWith('shot:')) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(expr.slice(5), Buffer.from(r.data, 'base64')); console.log('wrote', expr.slice(5)); continue; }
    const r = await send('Runtime.evaluate', { expression: `(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms)); ${expr} })()`, returnByValue: true, awaitPromise: true });
    console.log(`[${n++}]`, r.exceptionDetails ? 'EXC ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : JSON.stringify(r.result.value));
  }
  for (const l of logs.slice(0, 20)) console.log('   ' + l);
} catch (e) { console.log('ERR', e); } finally { chrome.kill(); }
