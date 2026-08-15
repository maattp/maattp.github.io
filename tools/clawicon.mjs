// Renders apps/claw/gen-icon.html in headless Chrome and writes the three
// Home Screen PNGs. Re-run after editing gen-icon.html.
//   python3 -m http.server 8000 &  node tools/clawicon.mjs
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9335;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run',
  '--user-data-dir=/tmp/claw-icon-profile', 'about:blank',
], { stdio: 'ignore' });

try {
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const send = (method, params = {}) => {
    const i = ++id; ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise(r => pending.set(i, r));
  };
  const evaluate = async expr =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8000/apps/claw/gen-icon.html' });
  for (let i = 0; i < 40; i++) { await sleep(250); if (await evaluate('!!window.iconsReady')) break; }
  if (!await evaluate('!!window.iconsReady')) throw new Error('gen-icon.html never finished');

  for (const [name, key] of [['icon-512', 'icon512'], ['icon-192', 'icon192'], ['icon-180', 'icon180']]) {
    const url = await evaluate('window.' + key);
    writeFileSync(`apps/claw/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote apps/claw/' + name + '.png');
  }
} finally { chrome.kill(); }
