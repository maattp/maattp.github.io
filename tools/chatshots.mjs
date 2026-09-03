/* Render the chat app against a fixed fake thread and screenshot it.
 *
 * The chat UI has no offline mode you can just open: it wants a session, a
 * /me, and a page of messages before it draws anything. So this stubs fetch
 * and WebSocket in the page, seeds one scripted conversation that exercises
 * every case the layout has to handle (runs, a day boundary, Claude, a ring
 * message, reactions, a long paragraph), and shoots it at phone size in both
 * colour schemes — plus one with the reaction picker open.
 *
 * Usage: node tools/chatshots.mjs [outdir]   (from the repo root)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9231, HTTP_PORT = 8412;
const OUT = process.argv[2] || 'tools/data/chatshots';

const DAY = 86400000;
const now = Date.now();
const t = (dayAgo, h, m) => {
  const d = new Date(now - dayAgo * DAY); d.setHours(h, m, 0, 0); return d.getTime();
};

const MSGS = [
  { id: 'm1', seq: 1, sender: 'tingting', body: 'did you ever fix the chat layout', created_at: t(1, 20, 14) },
  { id: 'm2', seq: 2, sender: 'matt', body: 'reverted it', created_at: t(1, 20, 15) },
  { id: 'm3', seq: 3, sender: 'matt', body: 'starting over on the design tonight', created_at: t(1, 20, 15) },
  { id: 'm4', seq: 4, sender: 'tingting', body: 'good 🙏', created_at: t(1, 20, 16) },
  { id: 'm5', seq: 5, sender: 'claude', body: 'The standalone black bar is still unexplained — worth measuring the box on the device before writing another fix. I can set that up whenever you want.', created_at: t(0, 9, 2) },
  { id: 'm6', seq: 6, sender: 'matt', body: 'later. first make it not ugly', created_at: t(0, 9, 4) },
  { id: 'm7', seq: 7, sender: 'ring', body: 'on my way home', created_at: t(0, 18, 40) },
  { id: 'm8', seq: 8, sender: 'tingting', body: 'The new palette is much warmer than the old blue-black, and the day dividers make it far easier to find where you left off in a long thread.', created_at: t(0, 18, 44) },
  { id: 'm9', seq: 9, sender: 'matt', body: 'agreed', created_at: t(0, 18, 46) },
];
const REACTS = [
  { message_id: 'm2', sender: 'tingting', emoji: '👍', seq: 10 },
  { message_id: 'm5', sender: 'matt', emoji: '🔥', seq: 11 },
  { message_id: 'm5', sender: 'tingting', emoji: '🔥', seq: 12 },
  { message_id: 'm8', sender: 'matt', emoji: '❤️', seq: 13 },
];

const STUB = `
localStorage.setItem('chat_session', 'fake');
localStorage.setItem('chat_thread', 'group');
indexedDB.deleteDatabase('chat');
const MSGS = ${JSON.stringify(MSGS)}, REACTS = ${JSON.stringify(REACTS)};
window.WebSocket = class { constructor() { this.readyState = 0; } close() {} send() {} addEventListener() {} };
window.fetch = async (url) => {
  const u = String(url);
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('/chat/me')) return json({ sender: 'matt', threads: ['dm', 'group'] });
  if (u.includes('/messages')) return json({ messages: MSGS, reactions: REACTS, top: 9, more: false, next: 13 });
  return json({ ok: true });
};
navigator.serviceWorker && Object.defineProperty(navigator, 'serviceWorker', { value: undefined });
`;

const cdp = (ws) => {
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  return (method, params = {}) => new Promise((res) => {
    const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const http = spawn('python3', ['-m', 'http.server', String(HTTP_PORT)], { stdio: 'ignore' });
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run',
    '--hide-scrollbars', '--user-data-dir=/tmp/chatshots-profile', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try {
        page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page');
      } catch { /* not up yet */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const send = cdp(ws);
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 393, height: 852, deviceScaleFactor: 3, mobile: true,
    });

    const shoot = async (name, scheme, after) => {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
      await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/apps/chat/` });
      await sleep(1400);
      if (after) { await send('Runtime.evaluate', { expression: after }); await sleep(500); }
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
      console.log(`${OUT}/${name}.png`);
    };

    await shoot('light', 'light');
    await shoot('dark', 'dark');
    await shoot('picker', 'light', `document.querySelectorAll('.addreact')[6].click()`);
    await shoot('dm', 'light', `switchThread('dm')`);
    // Signed-out: the stub seeds a session, so clear it before this one.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear()` });
    await shoot('login', 'light');
    ws.close();
  } finally {
    chrome.kill(); http.kill();
  }
}
main();
