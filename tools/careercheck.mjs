// The wallet that survives and the Seattle Passport (apps/auto/src/career.js).
//
//   node tools/careercheck.mjs [--desktop] [--shots DIR]
//
// Boots the game headlessly (the iPhone landscape profile unless --desktop),
// sets some progress and $5000, flushes, RELOADS, and checks that the wallet
// came back; then compares every passport number against counts taken
// straight from the source sets/lists, checks the rank against the table,
// provokes a rank-up toast, and measures that the passport sits inside the
// pause card above the OpenStreetMap credit (a licence condition) rather than
// over it. Needs `python3 -m http.server $AUTO_HTTP_PORT` from the repo root.
import { launchChrome } from './chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9222;
const URL_BASE = process.env.AUTO_URL || `http://localhost:${HTTP_PORT}/apps/auto/`;
const DESKTOP = process.argv.includes('--desktop');
const si = process.argv.indexOf('--shots');
const SHOTS = si > 0 ? process.argv[si + 1] : 'tools/data/careershots';

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-career-profile-${PORT}`, width: 1280, height: 720 });
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('no CDP target');
}

try {
  const ws = new WebSocket((await target()).webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, aw = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: aw });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (!DESKTOP) {
    await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });

  const boot = async () => {
    await send('Page.navigate', { url: URL_BASE });
    for (let i = 0; i < 600; i++) {
      await sleep(500);
      if (await ev('!!(window.__dbg && window.__dbg.career)', false)) return;
    }
    throw new Error('never booted: ' + logs.slice(-5).join(' | '));
  };

  // ---- launch 1: a fresh profile starts at $250; set progress and $5000 ----
  await boot();
  check((await ev('__dbg.game.money', false)) === 250, 'a fresh profile starts with $250');
  await ev(`(() => {
    const d = __dbg;
    d.acts.found.add(0); d.acts.found.add(1); d.acts.found.add(2);
    d.acts.techFound.add(d.acts.tech[0].id);
    d.stunts.done.add(d.stunts.list[0].id); d.stunts.list[0].done = true;
    d.islands.found.add('sasquatch');
    d.arcade.hi.paddle = 12;
    d.game.money = 5000;
    d.career.flush();
    return true;
  })()`, false);
  check((await ev(`JSON.parse(localStorage.getItem('auto-career')).money`, false)) === 5000, 'flush wrote $5000 to auto-career');

  // ---- launch 2: the wallet is back ----
  await boot();
  check((await ev('__dbg.game.money', false)) === 5000, 'after a reload game.money === 5000');

  // pagehide flush (iOS kills a backgrounded PWA without an unload)
  await ev(`(__dbg.game.money = 4321, window.dispatchEvent(new Event('pagehide')), true)`, false);
  check((await ev(`JSON.parse(localStorage.getItem('auto-career')).money`, false)) === 4321, 'pagehide flushes the wallet');
  // the 1 Hz poll saves a change nobody flushed
  await ev(`(__dbg.game.money = 4400, true)`, false);
  await sleep(1600);
  check((await ev(`JSON.parse(localStorage.getItem('auto-career')).money`, false)) === 4400, 'the 1 Hz poll saves a change on its own');

  // ---- the passport against counts taken straight off the sources ----
  const r = await ev(`(async () => {
    const d = __dbg, C = await import('/apps/auto/src/career.js'), I = await import('/apps/auto/src/islands.js'), A = await import('/apps/auto/src/arcadegames.js');
    d.acts.found.add(0); d.acts.found.add(1); d.acts.found.add(2); d.acts.techFound.add(d.acts.tech[0].id);
    d.stunts.done.add(d.stunts.list[0].id); d.stunts.list[0].done = true;
    d.islands.found.add('sasquatch'); d.arcade.hi.paddle = 12;
    const p = d.career.passport();
    const row = (id) => p.rows.find((x) => x.id === id);
    const direct = {
      coins: [d.acts.found.size, d.acts.coins.length],
      tech: [d.acts.techFound.size, d.acts.tech.length],
      stunts: [d.stunts.list.filter((j) => j.done).length, d.stunts.list.length],
      islands: [I.EGGS.filter((k) => d.islands.found.has(k)).length, I.EGGS.length],
      arcade: [A.GAMES.filter((g) => d.arcade.hi[g.id] > 0).length, A.GAMES.length],
    };
    const s = d.acts.summary();
    direct.jobs = [s.done, s.total]; direct.golds = [s.golds, s.total];
    // every island key a reward can be paid under is in EGGS (read off the source text)
    const src = await (await fetch('/apps/auto/src/islands.js')).text();
    const keys = [...src.matchAll(/this\\._reward\\('(\\w+)'/g)].map((m) => m[1]);
    const mean = p.rows.reduce((a, x) => a + x.done / x.total, 0) / p.rows.length;
    let idx = 0; C.RANKS.forEach((k, i) => { if (mean >= k.at) idx = i; });
    // the DOM, as the pause menu shows it
    document.getElementById('pauseBtn').click();
    await new Promise((r) => setTimeout(r, 400));
    const dom = {};
    for (const el of document.querySelectorAll('#ppGrid .ppRow')) dom[el.querySelector('span').textContent] = el.querySelector('b').textContent;
    return { p, direct, keys, eggs: I.EGGS, mean, idx, ranks: C.RANKS.map((k) => k.name), dom,
      rankText: document.getElementById('ppRank').textContent, hasOsm: /OpenStreetMap/.test(document.getElementById('pauseCard').textContent) };
  })()`);
  for (const [id, [done, total]] of Object.entries(r.direct)) {
    const row = r.p.rows.find((x) => x.id === id);
    check(row && row.done === done && row.total === total, `passport ${id} ${row && row.done}/${row && row.total} === direct ${done}/${total}`);
    check(row && r.dom[row.label] === `${done}/${total}`, `  menu shows ${row && r.dom[row.label]} for ${id}`);
  }
  const games = r.p.rows.find((x) => x.id === 'games');
  check(!!games && games.total === 8, `mini-games row present (${games && games.done}/${games && games.total})`);
  check(r.keys.length === r.eggs.length && r.keys.every((k) => r.eggs.includes(k)), `EGGS ${r.eggs.join(',')} covers every _reward key ${r.keys.join(',')}`);
  check(Math.abs(r.p.frac - r.mean) < 1e-9 && r.p.rankIdx === r.idx && r.p.rank === r.ranks[r.idx], `rank ${r.p.rank} (${r.p.pct}%) agrees with the table`);
  check(r.rankText.startsWith(r.p.rank.toUpperCase()), `menu rank text "${r.rankText}"`);
  check(r.hasOsm, 'the OpenStreetMap credit is still in the pause card');

  // ---- layout: inside the card, clear of the credit, fits the viewport ----
  const lay = await ev(`(() => {
    const card = document.getElementById('pauseCard'), pp = document.getElementById('passport'), help = card.querySelector('p.help');
    const c = card.getBoundingClientRect(), a = pp.getBoundingClientRect(), h = help.getBoundingClientRect();
    return { vw: innerWidth, vh: innerHeight, card: [c.left, c.top, c.right, c.bottom], pp: [a.left, a.top, a.right, a.bottom], ppH: a.height, helpTop: h.top + card.scrollTop,
      ppBottom: a.bottom + card.scrollTop, ppTop: a.top + card.scrollTop, scrollH: card.scrollHeight, clientH: card.clientHeight,
      overflowX: pp.scrollWidth > pp.clientWidth + 1 };
  })()`, false);
  console.log('  layout', JSON.stringify(lay));
  check(lay.pp[0] >= lay.card[0] && lay.pp[2] <= lay.card[2] && !lay.overflowX, 'the passport is within the card horizontally');
  check(lay.ppBottom <= lay.helpTop, 'the passport sits above the credit paragraph, not over it');
  check(lay.ppH < lay.vh * 0.45, `the passport is compact (${Math.round(lay.ppH)} of ${lay.vh} px)`);
  mkdirSync(SHOTS, { recursive: true });
  const shot = async (name) => writeFileSync(`${SHOTS}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await ev(`(document.getElementById('pauseCard').scrollTop = 0, true)`, false);
  await sleep(300); await shot('pause-top');
  await ev(`(document.getElementById('pauseCard').scrollTop = 1e6, true)`, false);
  await sleep(300); await shot('pause-bottom');

  // ---- a rank-up toast ----
  const t = await ev(`(async () => {
    const d = __dbg;
    d.career.rank = 0; d.career.armed = true;
    for (let i = 0; i < d.acts.coins.length; i++) d.acts.found.add(i);
    for (const c of d.acts.tech) d.acts.techFound.add(c.id);
    for (const j of d.stunts.list) { d.stunts.done.add(j.id); j.done = true; }
    d.hud.toast.classList.remove('show'); d.hud.toast.textContent = '';
    d.career.tick();
    const toast = d.hud.toast.textContent, p = d.career.passport();
    d.career.tick();
    return { toast, rank: d.career.rank, want: p.rankIdx, again: d.hud.toast.textContent };
  })()`);
  check(t.rank === t.want && t.want > 0 && /Seattle Passport/.test(t.toast), `rank-up toast: "${t.toast}"`);
  await shot('toast');

  const bad = logs.filter((l) => /EXCEPTION/.test(l));
  check(bad.length === 0, `no console exceptions${bad.length ? ': ' + bad[0] : ''}`);
} finally {
  chrome.kill('SIGKILL');
}
console.log(fails ? `\nFAIL: ${fails}` : '\nOK');
process.exitCode = fails ? 1 : 0;
