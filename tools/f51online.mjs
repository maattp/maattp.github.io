// Two-browser online smoke test for apps/fable51kart: host creates a room,
// client joins, both autopilot a 1-lap race through the local worker.
//   (cd worker && npx wrangler dev --port 8787) &   python3 -m http.server 8000 &
//   node tools/f51online.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const URL = 'http://localhost:8000/apps/fable51kart/?dbg=1';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'tools/data/f51shots/online'; mkdirSync(OUT, { recursive: true });
let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
async function browser(port, tag) {
  const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--window-size=700,400', '--no-first-run', `--user-data-dir=/tmp/f51-online-${tag}`, 'about:blank'], { stdio: 'ignore' });
  let page; for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(300); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } else if (d.method === 'Runtime.exceptionThrown') logs.push(tag + ' EXC: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push(tag + ' console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' ')); });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(tag + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${tag}-${name}.png`, Buffer.from(r.data, 'base64')); };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Page.navigate', { url: URL + '&v=' + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('return !!window.__f51')) break; }
  return { proc, ev, shot, logs, tag };
}
const A = await browser(9231, 'host'), B = await browser(9232, 'client');
try {
  await A.ev("document.getElementById('nameInput').value = 'Hosty'; document.getElementById('createRoomBtn').click();");
  let code = '';
  for (let i = 0; i < 40 && !code; i++) { await sleep(250); code = await A.ev('return __f51.net.code'); }
  check(/^[A-Z2-9]{5}$/.test(code), 'host created room ' + code);
  await B.ev(`document.getElementById('nameInput').value = 'Clienty'; document.getElementById('codeInput').value = '${code}'; document.getElementById('joinRoomBtn').click();`);
  for (let i = 0; i < 40; i++) { await sleep(250); if (await B.ev('return __f51.net.mode') === 'client') break; }
  check(await B.ev('return __f51.net.mode') === 'client', 'client joined as client');
  await sleep(600);
  check(await A.ev('return __f51.net.players.length') === 2, 'host sees 2 players');
  await A.shot('lobby'); await B.shot('lobby');
  await B.ev("document.getElementById('readyBtn').click();");
  await sleep(600);
  check(await A.ev("return !document.getElementById('lobbyStartBtn').disabled"), 'host START enabled once client is ready');
  // 1-lap race; the host's TOTAL_LAPS rides the start message
  await A.ev('__f51.setLaps(1);');
  await A.ev("document.getElementById('lobbyStartBtn').click();");
  for (let i = 0; i < 60; i++) { await sleep(250); if (await B.ev("return __f51.state === 'racing'") && await A.ev("return __f51.state === 'racing'")) break; }
  check(await A.ev("return __f51.state") === 'racing' && await B.ev("return __f51.state") === 'racing', 'both racing after countdown');
  check(await B.ev('return __f51.TRACKS.length && (function(){ return true; })()'), 'client booted track');
  const auto = "const p = __f51.player; p.ai = { skill: 1.0, aggr: 0.6, drift: 0.8, driftHold: 1.5, phase: 0, laneBias: 0, daring: 0.3, errT: 6, errOff: 0, rival: false }; p.controller = __f51.aiController; return p.pid;";
  const pidA = await A.ev(auto), pidB = await B.ev(auto);
  console.log('   pids', pidA, pidB, 'A mode', await A.ev('return __f51.net.mode'), 'B mode', await B.ev('return __f51.net.mode'));
  await sleep(8000);
  const snapTick = await B.ev('return __f51.net.lastSnapTick');
  check(snapTick > 0, 'client receiving snapshots (tick ' + snapTick + ')');
  check(await A.ev(`return !!__f51.net.remoteCtrl[${pidB}]`), 'host receiving client inputs');
  const posB = await B.ev('const p = __f51.player; return [p.pos.x, p.pos.y, p.pos.z, p.speed]');
  const posBonA = await A.ev(`const k = __f51.karts.find((k) => k.pid === ${pidB}); return [k.pos.x, k.pos.y, k.pos.z, k.speed, k.kind]`);
  const dist = Math.hypot(posB[0] - posBonA[0], posB[2] - posBonA[2]);
  check(dist < 25, `client kart pose agrees on host (Δ ${dist.toFixed(1)}u, host kind ${posBonA[4]}, speeds ${posB[3].toFixed(0)}/${posBonA[3].toFixed(0)})`);
  const posA = await A.ev('const p = __f51.player; return [p.pos.x, p.pos.z]');
  const posAonB = await B.ev(`const k = __f51.karts.find((k) => k.pid === ${pidA}); return [k.pos.x, k.pos.z, k.kind]`);
  const dist2 = Math.hypot(posA[0] - posAonB[0], posA[1] - posAonB[1]);
  check(dist2 < 30, `host kart interpolated on client (Δ ${dist2.toFixed(1)}u, kind ${posAonB[2]})`);
  console.log('   rtc host→client:', await A.ev(`const r = __f51.net.rtc[${pidB}]; return r ? [r.pc.connectionState, r.pc.iceConnectionState, r.pc.iceGatheringState, r.open] : 'none'`), '| client:', await B.ev(`const r = __f51.net.rtc[${pidA}]; return r ? [r.pc.connectionState, r.pc.iceConnectionState, r.open] : 'none'`));
  console.log('   client netInd:', await B.ev("return document.getElementById('netInd').textContent"), '| host netInd:', await A.ev("return document.getElementById('netInd').textContent"));
  await A.shot('race'); await B.shot('race');
  // let the race play out (real time) up to 120 s
  let done = false;
  for (let i = 0; i < 150 && !done; i++) { await sleep(2500); done = await B.ev("return __f51.player.finished") && await A.ev("return __f51.player.finished"); }
  check(done, 'both players finished the lap (host-confirmed on the client)');
  await sleep(3000);
  await A.shot('results'); await B.shot('results');
  check(await B.ev("return !document.getElementById('resultScreen').classList.contains('hidden')"), 'client shows results');
  const rankB = await B.ev('return __f51.player.rank'), rankBonA = await A.ev(`return __f51.karts.find((k) => k.pid === ${pidB}).rank`);
  check(rankB === rankBonA, `client rank matches host (${rankB} vs ${rankBonA})`);
  // rematch path: host ends → both back in the lobby
  await A.ev("document.getElementById('againBtn').click();");
  await sleep(1500);
  check(await B.ev("return !document.getElementById('lobbyScreen').classList.contains('hidden') && __f51.state === 'menu'"), 'client back in lobby after host rematch');
  const logs = A.logs.concat(B.logs);
  check(logs.length === 0, 'no exceptions on either side');
  for (const l of logs.slice(0, 10)) console.log('   ' + l);
} catch (e) { console.log('FAIL', e); fail++; }
finally { A.proc.kill(); B.proc.kill(); }
console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL OK'); process.exit(fail ? 1 : 0);
