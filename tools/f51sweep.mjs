// Drive-through sweep: autopilots the player around every map, screenshotting
// every ~2.5 s of sim, then tiles the frames into one contact sheet per map
// (tools/data/f51shots/sweep/<map>.png) for a visual slop hunt.
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT = 9225, URL = 'http://localhost:8000/apps/fable51kart/?dbg=1';
const OUT = 'tools/data/f51shots/sweep'; mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=960,540', '--no-first-run', '--user-data-dir=/tmp/f51-sweep-profile', 'about:blank'], { stdio: 'ignore' });
async function target() { for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) return p; } catch {} await sleep(300); } throw new Error('no CDP'); }
let id = 0; const pending = new Map(); let ws;
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: `(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms)); ${e} })()`, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
try {
  const t = await target(); ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '&v=' + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('return !!window.__f51')) break; }
  await ev("window.__skipIntro = true; window.__hold = true; for (const id of ['startScreen','resultScreen']) document.getElementById(id).classList.add('hidden'); return 1;");
  const n = await ev('return __f51.TRACKS.length');
  const routes = [[0.9, 0.1], [0.9, 0.1], [0.9, 0.1], [0.95, 0.45, 0.05]];
  for (let ti = 0; ti < n; ti++) {
    const name = await ev(`return __f51.TRACKS[${ti}].id`);
    const files = [];
    for (let r = 0; r < routes[ti].length; r++) {
      await ev(`__f51.loadTrack(${ti}); __f51.buildKarts(); __f51.resetRace(); __f51.setLaps(1); __f51.startGame(); __f51.state = 'racing'; document.getElementById('countdown').classList.remove('on'); document.getElementById('hud').classList.add('on');
        const p = __f51.player; p.ai = { skill: 1.0, aggr: 0.6, drift: 0.8, driftHold: 1.5, phase: 0, laneBias: 0, daring: ${routes[ti][r]}, errT: 6, errOff: 0, rival: false }; p.controller = __f51.aiController; return 1;`);
      for (let f = 0; f < 18; f++) {
        await ev('for (let i = 0; i < 150; i++) __f51.simTick(1/60); return 1;');
        await sleep(280);
        await ev("for (const id of ['startScreen','resultScreen']) document.getElementById(id).classList.add('hidden'); return 1;");
        if (await ev('return __f51.player.finished')) break;
        const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
        const fn = `${OUT}/${name}-r${r}-${String(f).padStart(2, '0')}.jpg`; writeFileSync(fn, Buffer.from(shot.data, 'base64')); files.push(fn);
        if (await ev('return __f51.player.finished')) break;
      }
      await ev('__f51.quitToMenu(); return 1;'); await sleep(200);
    }
    execSync(`python3 - <<'PY'\nfrom PIL import Image\nfiles = ${JSON.stringify(files)}\ncols = 5; w, h = 384, 216\nrows = (len(files) + cols - 1) // cols\nsheet = Image.new('RGB', (cols * w, rows * h), (10, 10, 20))\nfor i, f in enumerate(files):\n    im = Image.open(f).resize((w, h)); sheet.paste(im, ((i % cols) * w, (i // cols) * h))\nsheet.save('${OUT}/${name}.png')\nPY`);
    console.log('sheet', `${OUT}/${name}.png`, files.length, 'frames');
  }
} catch (e) { console.log('ERR', e); } finally { chrome.kill(); }
