// Auto KW: vehicles on a plain stage (tools/kw/carstage.html) -- close-ups of
// a livery, a car-show row of the fleet. Seconds, not a game boot.
//
//   node tools/kw/carshots.mjs <outdir> [shots.json] [name,name...]
//   AUTO_HTTP_PORT (a static server at the repo root), AUTO_CDP_PORT, AUTO_GPU=1
//
// shots.json: [{ name, cars: [{ type, color, x, z, heading }], cam: { eye, at, fov }, size: [w, h] }]
// Without one, the built-in shots below: the GRT buses and the KW fleet row.
// Prints each placed vehicle's triangles (paint + trim + matte, occupied) and
// its body's length, width (mirrors and all) and height, to check against the real car's.

import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9433;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/carshots';
const FILE = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : null;
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;

const H = Math.PI / 2;
const BUS = (type, eye, at, fov = 35) => ({ name: `${type}-${eye.join('_')}`, cars: [{ type, heading: 0 }], cam: { eye, at, fov } });
const DEFAULT = [
  { name: 'bus-q34', cars: [{ type: 'bus' }], cam: { eye: [9, 2.6, 13], at: [0, 1.5, 1.2] } },
  { name: 'bus-street', cars: [{ type: 'bus' }], cam: { eye: [15, 2.0, -1], at: [0, 1.4, -0.5] } },
  { name: 'bus-kerb', cars: [{ type: 'bus' }], cam: { eye: [-14, 2.0, 1], at: [0, 1.4, 0.5] } },
  { name: 'bus-front', cars: [{ type: 'bus' }], cam: { eye: [-1.5, 2.4, 11], at: [0, 1.8, 5] } },
  { name: 'bus-rear', cars: [{ type: 'bus' }], cam: { eye: [5, 2.4, -14], at: [0, 1.5, -4] } },
  { name: 'busx-q34', cars: [{ type: 'busx' }], cam: { eye: [9, 2.6, 13], at: [0, 1.5, 1.2] } },
  { name: 'ionbus-q34', cars: [{ type: 'ionbus' }], cam: { eye: [9, 2.6, 13], at: [0, 1.5, 1.2] } },
  { name: 'ionbus-kerb', cars: [{ type: 'ionbus' }], cam: { eye: [-14, 2.0, 1], at: [0, 1.4, 0.5] } },
  { name: 'artic-q34', cars: [{ type: 'artic' }, { type: 'articRear', z: -9.1 }], cam: { eye: [12, 3.0, 12], at: [0, 1.5, -2] } },
];
void BUS; void H;

async function main() {
  const shots = FILE ? JSON.parse(readFileSync(FILE, 'utf8')) : DEFAULT;
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-cars-profile-${PORT}`, width: 1280, height: 720 });
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map(); const errs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'exception');
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('error: ' + (m.params.args || []).map((a) => a.value || a.description).join(' '));
    });
    const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
    const evaluate = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/tools/kw/carstage.html` });
    for (let i = 0; i < 150; i++) {
      await sleep(200);
      if (await evaluate('!!(window.stage && window.stage.ready)')) break;
      if (errs.length) break;
    }
    if (errs.length) console.log('  errors:', errs.slice(0, 5).join('\n  '));
    // LAMP_CLASSES=1: every type's tagged lamp vertices (vehicles.js tagLamps)
    if (process.env.LAMP_CLASSES) {
      const lc = await evaluate('window.stage.lampClasses(Object.keys(window.stage.TYPES))');
      for (const [k, c] of Object.entries(lc)) console.log(`  lamps ${k.padEnd(13)} ${JSON.stringify(c)}`);
    }
    mkdirSync(OUT, { recursive: true });
    const seen = new Set();
    for (const V of shots) {
      if (ONLY && !ONLY.some((o) => V.name.startsWith(o))) continue;
      const [w, h] = V.size || [1280, 720];
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      const info = await evaluate(`(() => { const s = window.stage; s.renderer.setSize(${w}, ${h}); s.camera.aspect = ${w / h};
        const r = s.place(${JSON.stringify(V.cars)}); s.shoot(${JSON.stringify(V.cam)}); return r; })()`);
      for (const c of info) if (!seen.has(c.type)) { seen.add(c.type); console.log(`  ${c.type}: ${c.len} m, ${c.tris} tris, body L x W x H ${c.size.join(' x ')} m`); }
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${V.name}.png`, Buffer.from(result.data, 'base64'));
      console.log(`  ${OUT}/${V.name}.png`);
    }
    console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
  } finally {
    chrome.kill('SIGKILL');
  }
}
main().catch((e) => { console.error('carshots failed:', e.message); process.exitCode = 1; });
