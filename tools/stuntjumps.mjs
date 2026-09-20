// Drive every stunt jump the way a player does, and judge it.
//
// Boots the game, then for each jump in apps/auto/src/stunts.js JUMPS: puts the
// player's own car at the run-up start pointed at the lip, and drives it at a
// FIXED dt through player.update with the input the stick produces (full
// throttle, steering held on the ramp's centreline, a speed cap per run), the
// traffic, world and scoring stepping alongside -- the same loop as
// tools/tunnelride.mjs. Slow motion is honoured (dt is scaled the way main.js
// scales it). Each run reports the speed at the lip, distance, airtime,
// landing damage and what the scorer paid, and a static check of the corridor:
// buildings, water, roads and trunks on the run-up, the ramp and the landing.
//
// A jump FAILS if it never launches, never lands, or a run at the middle cap
// (32 m/s, ~115 km/h) wrecks the car.
//
// Usage:  python3 -m http.server 8000; node tools/stuntjumps.mjs [ids,...]
//         [--caps 24,32,99] [--shots DIR]   (DIR: a ramp close-up and a mid-air
//         chase frame per jump, e.g. docs/jumps)
// Env:    AUTO_HTTP_PORT, AUTO_CDP_PORT as every harness.
import { launchChrome, assertRenderer } from './chrome.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const ONLY = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--caps' && args[args.indexOf(a) - 1] !== '--shots');
const CAPS = (argVal('--caps') || '24,32,99').split(',').map(Number);
const SHOTS = argVal('--shots');
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9245;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PAGE = readFileSync(new URL('./stuntjumps-page.js', import.meta.url), 'utf8');

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-stunts-${PORT}`, width: 1100, height: 620 });
let exitCode = 0;
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map(); const exceptions = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails || r.result?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails || r.result.exceptionDetails).slice(0, 1500));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 900; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  await assertRenderer(ev);
  await ev('window.__dbg.game.paused = true');
  console.log(await ev(PAGE));
  await ev('window.__sj.load()');
  const ids = JSON.parse(await ev('JSON.stringify(window.__dbg.stunts.list.map((j) => j.id))'))
    .filter((q) => !ONLY || ONLY.split(',').includes(q));
  console.log(`jumps: ${ids.length}  caps: ${CAPS.join(',')} m/s`);

  const hideHud = () => ev(`(() => { for (const id of ['hud', 'pad', 'stickZone', 'lookZone', 'objective', 'toast', 'rotate', 'topBtns', 'racePanel'])
    { const e = document.getElementById(id); if (e) e.style.display = 'none'; } return 1; })()`);
  const shot = async (name) => {
    await ev('window.__sj.settle(600)');
    await sleep(1800);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(s.result.data, 'base64'));
    console.log(`  shot ${SHOTS}/${name}.png`);
  };

  const fails = [];
  for (const jid of ids) {
    const ck = JSON.parse(await ev(`JSON.stringify(window.__sj.check(${JSON.stringify(jid)}))`));
    const tags = (k) => ck[k].map(([a, b, t]) => `${t}@${a}${b !== a ? '..' + b : ''}`).join(' ') || '-';
    console.log(`\n${jid}  ramp L ${ck.L} m, lip at ${ck.lipY} m;  closed to traffic: ${ck.closed.join(', ') || 'none'}${ck.bad.length ? '  ON: ' + ck.bad.join(', ') : ''}`);
    console.log(`  run-up: ${tags('run')}\n  ramp:   ${tags('ramp')}\n  land:   ${tags('land')}\n  ground past the lip (every 10 m): ${ck.prof.join(' ')}`);
    for (const cap of CAPS) {
      const st = JSON.parse(await ev(`window.__sj.drive(${JSON.stringify(jid)}, { cap: ${cap} })`));
      const r = st.res && typeof st.res === 'object' ? st.res : null;
      const line = r && r.dist !== undefined
        ? `lip ${r.speed} m/s  ${r.dist} m  ${r.air} s  up ${r.maxUp} m  hurt ${r.hurt}  ${r.clean ? 'CLEAN' : r.wet ? 'wet' : 'not clean'}  $${r.pay}  at (${r.x}, ${r.z})`
        : `${st.phase}: ${JSON.stringify(st.res)}`;
      console.log(`  cap ${String(cap).padStart(2)}: ${line}`);
      if (!r || r.dist === undefined) fails.push(`${jid}@${cap}: ${st.phase} ${JSON.stringify(st.res)}`);
      else if (cap >= 30 && cap <= 34 && (r.hurt >= 40 || st.res.dead)) fails.push(`${jid}@${cap}: wrecked`);
    }
    if (SHOTS) {
      await hideHud();
      // the ramp, from beside its toe
      await ev(`(() => { const j = window.__dbg.stunts.list.find((q) => q.id === ${JSON.stringify(jid)}), r = j.ramp, d = window.__dbg;
        window.__sj.begin(j.id, { from: 14 }); window.__sj.step(1);
        const cx = r.x0 - r.dx * 9 + r.px * 9, cz = r.z0 - r.dz * 9 + r.pz * 9;
        d.camera.position.set(cx, r.y0 + 3.2, cz); d.camera.lookAt(r.x0 + r.dx * r.L * 0.7, r.y0 + r.H * 0.5, r.z0 + r.dz * r.L * 0.7);
        d.placeSun(r.x0, r.y0, r.z0); return 1; })()`);
      await shot(`${jid}-ramp`);   // the paused loop draws with whatever camera is set
      // mid-air, chase camera, at the middle cap
      await ev(`window.__sj.begin(${JSON.stringify(jid)}, { cap: 32 })`);
      for (let k = 0; k < 200; k++) {
        const st = JSON.parse(await ev('window.__sj.step(6)'));
        if (st.phase === 'air' && st.tAir > 0.55) break;
        if (st.phase !== 'run' && st.phase !== 'air') break;
      }
      await shot(`${jid}-air`);
    }
  }
  console.log(`\nexceptions: ${exceptions.length}${exceptions.length ? '\n  ' + exceptions.slice(0, 5).join('\n  ') : ''}`);
  console.log(fails.length ? `FAIL ${fails.length}\n  ${fails.join('\n  ')}` : `PASS ${ids.length} jumps`);
  if (fails.length || exceptions.length) exitCode = 1;
} catch (err) {
  console.log('ERROR', err.message);
  exitCode = 2;
} finally { chrome.kill(); }
process.exit(exitCode);
