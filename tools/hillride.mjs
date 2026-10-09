// Hill ride: does a car follow a steep street down without hopping, and does a
// real crest still throw it? Rides the player's own vehicle through
// Vehicle.update at a fixed dt (tools/hillride-page.js) on the steepest streets
// in the city (SW Genesee St -23 %, SW Kenyon Pl -20 %, then -16..-8 %) and on
// the sharpest crests at 32 m/s.
//
//   python3 -m http.server 8000; node tools/hillride.mjs [--type sedan|atv|...]
//                                 [--crest-speed 32] [--trace]   (--trace: the air / over-30 frames of each ride)
//
// Per ride: airFlips (ground -> air transitions), airFrames, acc30 / acc60
// (frames whose vertical acceleration is over 30 / 60 m/s^2), maxAcc,
// maxAbove (highest the body got over the ground under it). Exit 1 if a ride
// down a 12 %+ grade flips to air more than twice or logs more than 5 frames
// over 30 m/s^2, or if no crest ride leaves the ground at all.
import { launchChrome, assertRenderer } from './chrome.mjs';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9246;
const PAGE = readFileSync(new URL('./hillride-page.js', import.meta.url), 'utf8');
const opts = { type: argVal('--type') || 'sedan', crestSpeed: +(argVal('--crest-speed') || 32), trace: args.includes('--trace') };

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-hill-${PORT}`, width: 1100, height: 620 });
let code = 0;
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 2000));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 900; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('window.__dbg.sceneStats.calls > 0 && window.__dbg.traffic.cars.length > 0 && window.__dbg.city.edges.length > 1000')) break; } catch {} }
  await assertRenderer(ev);
  await ev('window.__dbg.applyQuality && window.__dbg.applyQuality("low", true)');
  await ev('window.__dbg.game.paused = true');
  await ev(`window.__HILL = ${JSON.stringify(opts)}`);
  const res = JSON.parse(await ev(`(async () => { ${PAGE} })()`));
  const rows = (r) => (r.rec || []).map((q) => '      ' + q.join(' ')).join('\n');
  const row = (r) => `${String(r.label).slice(0, 26).padEnd(26)} ${r.grade !== undefined ? (r.grade * 100).toFixed(0).padStart(4) + '%' : `${(r.gin * 100).toFixed(0)}/${(r.gout * 100).toFixed(0)}%`.padStart(6)}  frames ${String(r.frames).padStart(4)}  air ${String(r.airFrames).padStart(3)} flips ${String(r.airFlips).padStart(2)}  acc>30 ${String(r.acc30).padStart(3)} >60 ${String(r.acc60).padStart(3)}  max ${String(r.maxAcc).padStart(4)}  above ${r.maxAbove} m  @${r.at}`;
  console.log(`type ${res.type}\nHILLS (coast down from 14 m/s)`);
  const fails = [];
  for (const r of res.hills) {
    console.log('  ' + (r.err || row(r)) + (rows(r) ? '\n' + rows(r) : ''));
    if (!r.err && Math.abs(r.grade) >= 0.12 && (r.airFlips > 2 || r.acc30 > 5)) fails.push(`${r.label}: ${r.airFlips} flips, ${r.acc30} frames over 30`);
  }
  console.log(`CRESTS (${opts.crestSpeed} m/s)`);
  for (const r of res.crests) console.log('  ' + (r.err || row(r)) + (rows(r) ? '\n' + rows(r) : ''));
  if (res.crests.length && !res.crests.some((r) => r.airFrames > 0)) fails.push('no crest ride left the ground');
  if (fails.length) { console.log('\nFAIL\n  ' + fails.join('\n  ')); code = 1; } else console.log('\nOK');
} catch (e) { console.log('ERROR', e.message); code = 2; } finally { chrome.kill(); }
process.exit(code);
