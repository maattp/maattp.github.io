// Shared harness for the 75 Hard headless-Chrome drills (see README.md).
// Launches/attaches to Chrome via CDP, gives eval/screenshot/report helpers.
import { execSync, spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const WebSocket = (await import(join(here, '../../../worker/node_modules/ws/index.js'))).default;

export const APP_URL = process.env.HARD75_APP_URL || 'http://localhost:8000/apps/75hard/';
export const API_URL = process.env.HARD75_API_URL || 'http://localhost:8787';
export const OUT_DIR = process.env.HARD75_TEST_OUT || join(tmpdir(), 'hard75-drills');
const PORT = Number(process.env.HARD75_CDP_PORT || 9333);
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function connect() {
  mkdirSync(OUT_DIR, { recursive: true });
  try {
    execSync(`curl -s http://localhost:${PORT}/json/version`, { stdio: 'pipe' });
  } catch {
    spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${join(tmpdir(), 'hard75-chrome-profile')}`,
      '--no-first-run', '--window-size=390,844', 'about:blank',
    ], { detached: true, stdio: 'ignore' }).unref();
    await sleep(2500);
  }
  const target = JSON.parse(execSync(`curl -s -X PUT "http://localhost:${PORT}/json/new?about:blank"`).toString());
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  let id = 0;
  const pending = new Map();
  const errors = [];
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg.error); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('[EXC] ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text || '').slice(0, 300));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('[console.error] ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });

  const evl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return 'EVAL-ERR: ' + (r.exceptionDetails.exception?.description || '').slice(0, 250);
    return r.result?.value;
  };
  const shot = async (name) => {
    const png = await send('Page.captureScreenshot', { format: 'png' });
    const path = join(OUT_DIR, name);
    writeFileSync(path, Buffer.from(png.data, 'base64'));
    return path;
  };
  const bootAs = async (sessionToken, email) => {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: APP_URL });
    await sleep(1500);
    await evl(`localStorage.setItem('hard75_api', ${JSON.stringify(API_URL)});
      localStorage.setItem('hard75_session', ${JSON.stringify(sessionToken)});
      localStorage.setItem('hard75_email', ${JSON.stringify(email)});
      localStorage.setItem('hard75_debug', '1'); 'ok'`);
    await send('Page.navigate', { url: APP_URL });
    await sleep(3000);
  };
  const close = async () => {
    try { await send('Page.close'); } catch { /* target already gone */ }
    try { ws.close(); } catch { /* already closed */ }
  };
  return { send, evl, shot, bootAs, errors, close };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function report(name, results, errors) {
  console.log(JSON.stringify(results, null, 1));
  const failed = Object.entries(results).filter(([, v]) => v === false || String(v).startsWith('EVAL-ERR'));
  for (const e of errors) console.log(e);
  if (failed.length || errors.length) {
    console.log(`${name}: FAILED (${failed.map(([k]) => k).join(', ') || 'page errors'})`);
    process.exit(1);
  }
  console.log(`${name}: OK`);
}
