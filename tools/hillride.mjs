// Hill ride: does a car follow a steep street down without hopping, and does a
// real crest still throw it? Rides the player's own vehicle through
// Vehicle.update at a fixed dt (tools/hillride-page.js) on the steepest streets
// in the city (SW Genesee St -23 %, SW Kenyon Pl -20 %, then -16..-8 %) and on
// the sharpest crests at 32 m/s.
//
//   python3 -m http.server 8000; node tools/hillride.mjs [--types sedan,atv,...]
//                                 [--crest-speed 32] [--trace]   (--trace: the air / over-30 frames of each ride)
//
// Besides the hills and crests it rides three FREEWAY STEP sites (the floor
// data steps 0.5-1 m: I-5, Aurora, SR-99), steps made up on a flat street, and TELEPORTS a car 2 m under /
// over the floor of Genesee St; none of these may launch the car.
//
// Per ride: airFlips (ground -> air transitions), airFrames, acc30 / acc60
// (frames whose vertical acceleration is over 30 / 60 m/s^2), maxAcc,
// maxAbove (highest the body got over the ground under it). Exit 1 (sedan, the
// first type) if a ride down a 12 %+ grade flips to air more than twice or logs
// more than 5 frames over 30 m/s^2; if the pinned 32/-27 % crest at (-434,
// -1467) gives fewer than CREST_MIN air frames (master: 32, v201 first cut:
// 15 -- the 18/-3 % data cliff leaves on any build and proves nothing); if a
// freeway step site is airborne more than 1.5x master + 3 frames, or a made-up
// 0.7 m step UP in a flat street launches the car (> 2 air frames); or a teleport
// launches the car more than 0.5 m. Other types print the crest table only.
import { launchChrome, assertRenderer } from './chrome.mjs';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9246;
const PAGE = readFileSync(new URL('./hillride-page.js', import.meta.url), 'utf8');
const TYPES = (argVal('--types') || argVal('--type') || 'sedan').split(',');
const SECTIONS = argVal('--sections') ? argVal('--sections').split(',') : undefined;   // hills,crests,steps,synth,teleports
const CREST_AT = [-434, -1467], CREST_MIN = 24;
const STEP_SITES = [[720, -660], [1380, 3900], [120, 2100]];
// air frames master gives each (site, fwd / rev) -- these are real data cliffs, not steps up
const STEP_MASTER = [17, 0, 0, 19, 6, 0];
const opts = { crestSpeed: +(argVal('--crest-speed') || 32), trace: args.includes('--trace'), stepSites: STEP_SITES };

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
  const rows = (r) => (r.rec || []).map((q) => '      ' + q.join(' ')).join('\n');
  const row = (r) => `${String(r.label).slice(0, 26).padEnd(26)} ${r.grade !== undefined ? (r.grade * 100).toFixed(0).padStart(4) + '%' : `${(r.gin * 100).toFixed(0)}/${(r.gout * 100).toFixed(0)}%`.padStart(6)}  frames ${String(r.frames).padStart(4)}  air ${String(r.airFrames).padStart(3)} flips ${String(r.airFlips).padStart(2)}  acc>30 ${String(r.acc30).padStart(3)} >60 ${String(r.acc60).padStart(3)}  max ${String(r.maxAcc).padStart(4)}  above ${r.maxAbove} m  @${r.at}`;
  const fails = [];
  const table = [];
  for (const [ti, type] of TYPES.entries()) {
    const first = ti === 0;
    await ev(`window.__HILL = ${JSON.stringify({ ...opts, type, sections: first ? SECTIONS : ['crests'] })}`);
    const res = JSON.parse(await ev(`(async () => { ${PAGE} })()`));
    const pr = (r) => console.log('  ' + (r.err || row(r)) + (rows(r) ? '\n' + rows(r) : ''));
    console.log(`\ntype ${res.type}` + (first ? '\nHILLS (coast down from 14 m/s)' : ''));
    for (const r of res.hills) {
      pr(r);
      if (!r.err && Math.abs(r.grade) >= 0.12 && (r.airFlips > 2 || r.acc30 > 5)) fails.push(`${type} ${r.label}: ${r.airFlips} flips, ${r.acc30} frames over 30`);
    }
    console.log(`CRESTS (${opts.crestSpeed} m/s)`);
    for (const r of res.crests) pr(r);
    const pin = res.crests.find((r) => !r.err && Math.hypot(r.at[0] - CREST_AT[0], r.at[1] - CREST_AT[1]) < 5);
    table.push([type, pin ? pin.airFrames : '-', pin ? pin.maxAbove : '-', res.crests.map((r) => r.airFrames).join(' ')]);
    if (first) {
      if (!pin) fails.push(`${type}: pinned crest at (${CREST_AT}) not found`);
      else if (pin.airFrames < CREST_MIN) fails.push(`${type}: crest at (${CREST_AT}) gave ${pin.airFrames} air frames, wanted >= ${CREST_MIN}`);
      console.log('FREEWAY STEPS (24 m/s, must not launch)');
      for (const [i, r] of res.steps.entries()) {
        pr(r);
        if (r.err || r.airFrames > STEP_MASTER[i] * 1.5 + 3) fails.push(`${type} step ${r.label} @${r.at}: ${r.err || `${r.airFrames} air frames (master ${STEP_MASTER[i]})`}`);
      }
      console.log('MADE-UP FLOOR STEPS on a flat street (24 m/s; up must not launch)');
      for (const r of res.synth) {
        pr(r);
        if (r.err) fails.push(`${type} ${r.label}: ${r.err}`);
        else if (r.h > 0 && (r.airFrames > 2 || r.maxAbove > 0.3)) fails.push(`${type} ${r.label}: ${r.airFrames} air frames, ${r.maxAbove} m`);
      }
      console.log('TELEPORTS (a car dropped 2 m under / over the floor must not be launched)');
      for (const r of res.teleports) {
        pr(r);
        if (r.maxAbove > 0.5 && r.label.includes('-2')) fails.push(`${type} ${r.label}: launched ${r.maxAbove} m`);
      }
    }
  }
  console.log('\ncrest table: type | air frames at (-434,-1467) | height | air frames at every crest');
  for (const t of table) console.log('  ' + t.map((x) => String(x)).join(' | '));
  if (fails.length) { console.log('\nFAIL\n  ' + fails.join('\n  ')); code = 1; } else console.log('\nOK');
} catch (e) { console.log('ERROR', e.message); code = 2; } finally { chrome.kill(); }
process.exit(code);
