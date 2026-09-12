// Headless verification for apps/fable51kart. Boots the game in Chrome over
// CDP (SwiftShader GL), and for every track: screenshots the menu + an
// overhead view, autopilots the player through a 1-lap race stepped
// synchronously (fast), forcing AI onto every fork route, and reports laps,
// finishes, respawns and exceptions. Shots land in tools/data/f51shots/.
//
//   python3 -m http.server 8000 &
//   node tools/f51verify.mjs [trackIdx]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9223, URL = process.env.F51_URL || 'http://localhost:8000/apps/fable51kart/?dbg=1';
const ONLY = process.argv[2] != null ? +process.argv[2] : null;
const OUT = 'tools/data/f51shots'; mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--window-size=1280,720', '--no-first-run',
  '--user-data-dir=/tmp/f51-verify-profile', 'about:blank'], { stdio: 'ignore' });

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '&v=' + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('!!window.__f51')) break; }
  check(await ev('!!window.__f51'), 'game booted (debug hook present)');
  check(await ev("document.getElementById('err').style.display !== 'block'"), 'no boot error overlay: ' + await ev("document.getElementById('err').textContent"));
  const nTracks = await ev('__f51.TRACKS.length');
  for (let ti = 0; ti < nTracks; ti++) {
    if (ONLY != null && ti !== ONLY) continue;
    const name = await ev(`__f51.TRACKS[${ti}].id`);
    await ev(`__f51.loadTrack(${ti}); __f51.buildKarts(); __f51.resetRace(); window.__freeCam = null;`);
    await sleep(700); await shot(`${name}-menu`);
    await ev("for (const id of ['startScreen','resultScreen','lobbyScreen']) document.getElementById(id).classList.add('hidden')");
    // overhead
    const b = await ev(`(() => { let mn=[1e9,1e9], mx=[-1e9,-1e9]; for (const e of __f51.TRACK.edges) for (const s of e.samples) { mn[0]=Math.min(mn[0],s.x); mn[1]=Math.min(mn[1],s.z); mx[0]=Math.max(mx[0],s.x); mx[1]=Math.max(mx[1],s.z);} return {mn,mx}; })()`);
    const cx = (b.mn[0] + b.mx[0]) / 2, cz = (b.mn[1] + b.mx[1]) / 2, span = Math.max(b.mx[0] - b.mn[0], b.mx[1] - b.mn[1]);
    await ev(`window.__freeCam = { x: ${cx}, y: ${span * 1.15 + 80}, z: ${cz + 1}, tx: ${cx}, ty: 0, tz: ${cz}, fov: 60 }`);
    await sleep(500); await shot(`${name}-overhead`);
    await ev(`window.__freeCam = { x: ${cx + span * 0.7}, y: ${span * 0.55}, z: ${cz + span * 0.7}, tx: ${cx}, ty: 20, tz: ${cz}, fov: 55 }`);
    await sleep(400); await shot(`${name}-iso`);
    await ev("window.__freeCam = null; document.getElementById('startScreen').classList.remove('hidden')");
    // race: 1 lap, autopilot, AI spread across routes
    await ev(`(() => { __f51.setLaps(1); __f51.startGame(); __f51.state = "racing";
      const p = __f51.player; p.ai = { skill: 1.0, aggr: 0.6, drift: 0.8, driftHold: 1.5, phase: 0, laneBias: 0, daring: 0.9, errT: 6, errOff: 0, rival: false }; p.controller = __f51.aiController;
      __f51.karts.forEach((k, i) => { if (k.ai) k.ai.daring = [0.05, 0.4, 0.95, 0.2, 0.7, 0.99, 0.5, 0.85][i]; }); })()`);
    const lapRef = await ev('__f51.TRACK.lapRef');
    console.log(`--- ${name}: lapRef ${lapRef.toFixed(0)}u, edges ${await ev('__f51.TRACK.edges.map(e=>e.id+":"+e.len.toFixed(0)).join(" ")')}`);
    let allDone = false, simT = 0;
    const shotsAt = [8, 25, 45];
    let shotI = 0;
    for (let chunk = 0; chunk < 40 && !allDone; chunk++) {
      await ev('for (let i = 0; i < 300; i++) __f51.simTick(1/60);');
      simT += 5;
      if (shotI < shotsAt.length && simT >= shotsAt[shotI]) { await sleep(150); await shot(`${name}-race-${simT}s`); shotI++; }
      allDone = await ev('__f51.karts.every(k => k.finished)');
    }
    const rep = await ev(`__f51.karts.map(k => ({ n: k.char.name, fin: k.finished, t: +k.finishTime.toFixed(1), laps: k.laps, resp: k.respawns, edge: __f51.TRACK.edges[k.edge].id, prog: +(k.progress/__f51.TRACK.lapRef).toFixed(2), rank: k.rank }))`);
    for (const r of rep) console.log(`   ${r.rank}. ${r.n.padEnd(6)} ${r.fin ? 'FIN ' + r.t + 's' : 'DNF @' + r.edge + ' ' + r.prog} respawns=${r.resp}`);
    check(rep.filter((r) => r.fin).length >= 7, `${name}: at least 7/8 finished a lap (${rep.filter((r) => r.fin).length})`);
    check(rep.reduce((a, r) => a + r.resp, 0) <= 6, `${name}: total respawns ${rep.reduce((a, r) => a + r.resp, 0)} (≤6)`);
    const winner = rep.find((r) => r.rank === 1);
    check(winner && winner.t > 24 && winner.t < 110, `${name}: winner lap time ${winner && winner.t}s in 30–110s`);
    await sleep(300); await shot(`${name}-finish`);
    await ev('__f51.quitToMenu()');
    await sleep(2800);   // finishRace reveals the results overlay 2.4s later — let it pass
    await ev("document.getElementById('resultScreen').classList.add('hidden')");
  }
  // phone viewport: menu + HUD framing
  await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await ev('window.dispatchEvent(new Event("resize"))'); await sleep(600);
  await shot('phone-menu');
  await ev("(() => { __f51.setLaps(3); __f51.startGame(); __f51.state = 'racing'; const p = __f51.player; p.ai = { skill: 1.0, aggr: 0.6, drift: 0.8, driftHold: 1.5, phase: 0, laneBias: 0, daring: 0.5, errT: 6, errOff: 0, rival: false }; p.controller = __f51.aiController; })()");
  await ev('for (let i = 0; i < 600; i++) __f51.simTick(1/60);'); await sleep(300);
  await shot('phone-race');
  check(logs.length === 0, 'no exceptions / console errors');
  for (const l of logs.slice(0, 12)) console.log('   ' + l);
} catch (e) { console.log('FAIL', e); fail++; }
finally { chrome.kill(); }
console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL OK'); process.exit(fail ? 1 : 0);
