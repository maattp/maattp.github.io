// usage: node tools/pedcheck/harness.mjs <scenario.mjs> ; scenario default-exports async ({evaluate, shot, send, sleep, key})
import { launchChrome, assertRenderer } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
const PORT = +process.env.AUTO_CDP_PORT || 9402;
const scen = (await import(pathToFileURL(process.argv[2]).href)).default;
const OUT = process.env.S2OUT || 'tools/data/pedshots';
mkdirSync(OUT, { recursive: true });
const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-pedcheck-${PORT}`, width: +(process.env.W || 1280), height: +(process.env.H || 720) });
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(300); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
  const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${process.env.AUTO_HTTP_PORT || 8102}/apps/auto/` });
  for (let i = 0; i < 400; i++) { await sleep(500); if (await evaluate('!!window.__dbg')) break; }
  await assertRenderer(evaluate); await sleep(3000);
  const shot = async (name) => { await sleep(700); const { result } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(result.data, 'base64')); console.log('shot', `${OUT}/${name}.png`); };
  const key = async (type, k) => send('Input.dispatchKeyEvent', { type, key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 });
  const out = await scen({ evaluate, shot, send, sleep, key, OUT });
  if (out !== undefined) console.log(JSON.stringify(out, null, 1));
} finally { chrome.kill(); }
process.exit(0);
