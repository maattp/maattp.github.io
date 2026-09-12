// Space Flight headless verify: loads apps/spaceflight/?dbg=1 in Chrome (SwiftShader),
// autopilots the player through a race by stepping __sf.simTick, checks that every
// machine finishes, reports deaths / energy / wall time, and screenshots the race.
//   python3 -m http.server 8000 &  node tools/sfverify.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT = 9240, CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:8000/apps/spaceflight/?dbg=1';
mkdirSync('tools/data/sfshots', { recursive: true });
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--use-gl=angle', '--use-angle=swiftshader', '--user-data-dir=/tmp/sf-verify-profile', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
try {
  let page;
  for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(300); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR ' + m.params.args.map((a) => a.value || a.description).join(' '));
  });
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((r) => pending.set(i, r)); };
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`tools/data/sfshots/${name}.png`, Buffer.from(r.data, 'base64')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '&v=' + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('return !!window.__sf')) break; }
  ok(await ev('return !!window.__sf'), 'game booted');
  await sleep(600); await shot('menu');
  for (const ti of [0, 1, 2]) {
  console.log('--- track', ti);
  // start, skip countdown, give the player an AI brain, race 3 laps in a stepped loop
  const res = await ev(`
    __sf.loadTrack(${ti}); window.__hold = true; __sf.startGame(); __sf.state = 'racing'; document.getElementById('countdown').classList.remove('on');
    const p = __sf.player; p.ai = { lane: 0, skill: 0.95, aggr: 0.6, phase: 0, jitter: 0 };
    const orig = p.isPlayer; p.isPlayer = false; __sf.freeBoost = false;
    let ticks = 0, shots = 0, wallTicks = 0, minE = 100, maxSpd = 0, boosts = 0, lastBoostT = 0;
    const lapT = [];
    while (ticks < 60 * 240) {
      __sf.simTick(1/60); ticks++;
      if (p.wallT > 0) wallTicks++; minE = Math.min(minE, p.energy); maxSpd = Math.max(maxSpd, p.speed);
      if (p.boostT > lastBoostT + 0.5) boosts++; lastBoostT = p.boostT;
      if (p.lapTimes.length > lapT.length) lapT.push(p.lapTimes[p.lapTimes.length - 1]);
      
      if (__sf.machines.every((m) => m.finished || m.out)) break;
    }
    p.isPlayer = orig;
    return { ticks, secs: ticks / 60, wallTicks, minE, maxSpd, boosts, lapT, deaths: p.deaths || 0,
      finished: __sf.machines.filter((m) => m.finished).length, out: __sf.machines.filter((m) => m.out).length,
      ranks: __sf.machines.map((m) => [m.name, m.rank, m.finished ? m.finishTime.toFixed(1) : 'DNF', (m.deaths || 0)]) };
  `);
  console.log('   ', JSON.stringify(res.ranks));
  ok(res.finished === 8, `all 8 machines finished (${res.finished}, ${res.out} out) in ${res.secs.toFixed(0)}s of sim`);
  ok(res.lapT.length === 3 && res.lapT[0] > 25 && res.lapT[0] < 90, `player lap times ${res.lapT.map((t) => t.toFixed(1)).join(' / ')} (first lap 25–90s)`);
  ok(res.maxSpd > 140, `top speed ${res.maxSpd.toFixed(0)} u/s`);
  ok(res.wallTicks < res.ticks * 0.06, `wall contact ${(100 * res.wallTicks / res.ticks).toFixed(1)}% of ticks (<6%)`);
  console.log(`    min energy ${res.minE.toFixed(0)}, boosts ${res.boosts}, deaths ${res.deaths}`);
  }
  // screenshots: replay a fresh race for a few seconds in real time-ish for the camera
  for (const ti of [0, 1, 2]) {
  await ev(`__sf.loadTrack(${ti}); window.__hold = true; __sf.startGame(); __sf.state = 'racing'; document.getElementById('countdown').classList.remove('on'); const p = __sf.player; p.ai = { lane: 0, skill: 0.95, aggr: 0.6, phase: 0, jitter: 0 }; p.isPlayer = false; for (let i = 0; i < 60 * 6; i++) __sf.simTick(1/60); p.isPlayer = true; __sf.updateCamera(true, 1/60); return 1;`);
  await sleep(500); await shot(`t${ti}-race1`);
  await ev(`const p = __sf.player; p.isPlayer = false; for (let i = 0; i < 60 * 9; i++) __sf.simTick(1/60); p.isPlayer = true; p.boostT = 1.2; __sf.updateCamera(true, 1/60); return 1;`);
  await sleep(500); await shot(`t${ti}-race2`);
  await ev(`const p = __sf.player; p.isPlayer = false; for (let i = 0; i < 60 * 10; i++) __sf.simTick(1/60); p.isPlayer = true; __sf.updateCamera(true, 1/60); return 1;`);
  await sleep(500); await shot(`t${ti}-race3`);
  await ev(`const p = __sf.player; p.isPlayer = false; for (let i = 0; i < 60 * 8; i++) __sf.simTick(1/60); p.isPlayer = true; __sf.updateCamera(true, 1/60); return 1;`);
  await sleep(500); await shot(`t${ti}-race4`);
  await ev(`window.__freeCam = { x: 0, y: 1400, z: 300, tx: 0, ty: 0, tz: 301, fov: 60 }; __sf.updateCamera(true, 1/60); return 1;`);
  await sleep(500); await shot(`t${ti}-overview`); await ev('window.__freeCam = null; return 1;');
  }
  ok(logs.length === 0, 'no exceptions / console errors');
  for (const l of logs.slice(0, 10)) console.log('   ' + l);
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
} catch (e) { console.log('ERR', e); fails++; } finally { chrome.kill(); }
process.exit(fails ? 1 : 0);
