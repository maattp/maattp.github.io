// Headless verification for apps/fishing. Boots it in Chrome over CDP, starts a
// round, drives the hook with synthetic pointer events, forces a catch, a jelly
// zap and a game over, and writes screenshots to tools/data/fishshots/.
//
//   python3 -m http.server 8000 &
//   node tools/fishverify.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9224, URL = process.env.FISH_URL || 'http://localhost:8000/apps/fishing/';
const OUT = 'tools/data/fishshots'; mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,720', '--no-first-run', '--user-data-dir=/tmp/fish-verify-profile', 'about:blank'], { stdio: 'ignore' });

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
// headless rAF is throttled, so wait on the game's own clock rather than wall time
const waitGame = async (sec) => { const t0 = await ev('G.t'); for (let i = 0; i < 200; i++) { await sleep(50); if ((await ev('G.t')) >= t0 + sec) return; } throw new Error('game clock stalled'); };
const pointer = async (type, x, y) => { const r = await ev(`(() => { const b = G.hook.state + '/' + G.state + '/' + ptr.id; document.getElementById('c').dispatchEvent(new PointerEvent('${type}', {pointerId: 1, clientX: ${x}, clientY: ${y}, bubbles: true, pointerType: 'touch'})); return b + ' -> ' + G.hook.state + '/' + ptr.id + '/' + G.hook.stun.toFixed(2); })()`); if (process.env.DBG) console.log('   ', type, r); };

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

  for (const [label, w, h, mobile] of [['desktop', 1280, 720, false], ['phone', 844, 390, true]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 3 : 1, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
    await send('Page.navigate', { url: URL + '?v=' + Date.now() });
    await sleep(1500);
    check(await ev("getComputedStyle(document.getElementById('rot')).display === 'none'"), `${label}: rotate gate hidden in landscape`);
    await shot(`${label}-title`);
    await ev("document.getElementById('start').click()");
    await sleep(600);
    check(await ev("G.state === 'play'"), `${label}: round started`);
    check(await ev("Audio.ready"), `${label}: audio context created`);
    // hold to drop, slide the boat, screenshot mid-drop
    await pointer('pointerdown', w / 2, h / 2); await waitGame(0.1);
    await pointer('pointermove', w / 2 + 80, h / 2); await waitGame(0.5);
    check(await ev("G.hook.state === 'drop' && G.hook.y > SURF + 40"), `${label}: hook lowering while held`);
    check(await ev("G.boat.tx > W / 2 + 60"), `${label}: boat slid right with the finger`);
    await shot(`${label}-drop`);
    await pointer('pointerup', w / 2 + 80, h / 2); await waitGame(0.1);
    check(await ev("['reel','idle'].includes(G.hook.state)"), `${label}: released → reeling`);
    await waitGame(1.5);
    check(await ev("G.hook.state === 'idle'"), `${label}: empty hook back at the rod`);
    // plant a fish under the hook and reel it home
    await ev("(() => { const f = spawn('bass'); f.x = G.hook.x; f.y = SURF + 170; f.speed = 0; G.things.push(f); })()");
    await pointer('pointerdown', w / 2, h / 2); await waitGame(0.85);
    check(await ev("!!G.hook.holding"), `${label}: fish hooked`);
    await shot(`${label}-hooked`);
    await pointer('pointerup', w / 2, h / 2);
    await pointer('pointerdown', w / 2, h / 2); await pointer('pointerup', w / 2, h / 2); // tap boost
    await waitGame(2.5);
    check(await ev("G.score >= 50 && G.roundScore === G.score"), `${label}: bass landed for 50 (score=${await ev('G.score')})`);
    await shot(`${label}-caught`);
    // jelly zap costs time and snaps the line
    const before = await ev('G.time');
    await ev("(() => { const j = spawn('jelly'); j.x = G.hook.x; j.y = SURF + 70; j.speed = 0; G.things.push(j); })()");
    await pointer('pointerdown', w / 2, h / 2); await waitGame(0.8); await pointer('pointerup', w / 2, h / 2);
    check((await ev('G.time')) < before - 4, `${label}: jelly zap took 5s`);
    check(await ev("G.things.some((t) => t.kind === 'jelly' && !t.dead)"), `${label}: jelly survives the zap`);
    await waitGame(1.5);
    // quota → round clear
    await ev("G.things = G.things.filter((t) => t.kind !== 'jelly'); G.roundScore = G.quota - 1; G.score = G.roundScore; (() => { const f = spawn('minnow'); f.x = G.hook.x; f.y = SURF + 70; f.speed = 0; G.things.push(f); })()");
    await pointer('pointerdown', w / 2, h / 2); await waitGame(0.8); await pointer('pointerup', w / 2, h / 2); await waitGame(2);
    check(await ev("G.state === 'clear'"), `${label}: quota met → round clear`);
    await sleep(1200);
    await shot(`${label}-clear`);
    await ev("document.getElementById('next').click()"); await waitGame(0.2);
    check(await ev("G.round === 2 && G.state === 'play'"), `${label}: round 2 started`);
    // run the clock out → game over
    await ev('G.time = 0.3'); await waitGame(0.5); await sleep(1500);
    check(await ev("G.state === 'over'"), `${label}: time out → game over`);
    await shot(`${label}-over`);
    check(await ev("+localStorage.getItem('fishing.best') > 0"), `${label}: best score persisted`);
  }
  // portrait shows the rotate gate and pauses
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await sleep(600);
  check(await ev("getComputedStyle(document.getElementById('rot')).display === 'flex'"), 'portrait: rotate gate shown');
  check(await ev('paused === true'), 'portrait: game paused');
  await shot('portrait-gate');
  check(!/vibrate/.test(await ev('document.documentElement.outerHTML')), 'no vibration API used');
} catch (e) { console.log('FAIL ' + e.message); fail++; }
for (const l of logs) console.log('LOG  ' + l);
check(logs.length === 0, 'no runtime exceptions or console errors');
chrome.kill();
console.log(fail ? `\n${fail} failure(s)` : '\nall good');
process.exit(fail ? 1 : 0);
