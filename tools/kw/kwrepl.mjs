// Boot Auto KW once and keep it: a file-driven REPL for probes that would
// otherwise pay a full boot each.
//
//   node tools/kw/kwrepl.mjs <dir>        (AUTO_HTTP_PORT, AUTO_CDP_PORT, AUTO_GPU as every harness)
//
// Write JS to <dir>/cmd.js; it is evaluated in the booted (paused) page, the
// result goes to <dir>/out.txt, then cmd.js is removed. A line `//SHOT name`
// as the first line of cmd.js saves a jpeg of the page to <dir>/name.jpg after
// the evaluation (and a 1.5 s settle). Ctrl-C / `touch <dir>/quit` to stop.
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const DIR = process.argv[2];
mkdirSync(DIR, { recursive: true });
const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-repl-${PORT}`,
  width: +(process.env.VIEW_SIZE || '1100x620').split('x')[0], height: +(process.env.VIEW_SIZE || '1100x620').split('x')[1] });
let page;
for (let i = 0; i < 90 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
  if (!page) await sleep(300);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let id = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception');
});
const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'EXCEPTION ' + (r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
  const v = r.result?.result?.value;
  return typeof v === 'string' ? v : JSON.stringify(v);
};
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setBypassServiceWorker', { bypass: true });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/${process.env.AUTO_APP || 'autokw'}/` });
for (let i = 0; i < 600; i++) {
  await sleep(500);
  if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality)') === 'true') break;
}
await sleep(3000);
await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true);
  for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
  d.game.paused = true; })()`);
writeFileSync(`${DIR}/ready`, 'ready');
while (!existsSync(`${DIR}/quit`)) {
  if (existsSync(`${DIR}/cmd.js`)) {
    const src = readFileSync(`${DIR}/cmd.js`, 'utf8');
    unlinkSync(`${DIR}/cmd.js`);
    const m = src.match(/^\/\/SHOT (\S+)/);
    let out = await ev(src);
    if (m) {
      await sleep(1500);
      const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
      writeFileSync(`${DIR}/${m[1]}.jpg`, Buffer.from(s.result.data, 'base64'));
    }
    writeFileSync(`${DIR}/out.txt`, String(out) + (errs.length ? `\n[exceptions ${errs.length}: ${errs.slice(0, 3).join(' | ')}]` : ''));
  }
  await sleep(150);
}
chrome.kill();
process.exit(0);
