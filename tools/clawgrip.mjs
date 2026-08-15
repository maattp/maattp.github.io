// Grip sweep for apps/claw. Boots the machine once, then plays many scripted
// grabs per candidate (STRONG_K, WEAK_K, yBot) triple and reports the win rate
// for each. The grip constants in index.html came out of this table — a claw at
// real scale carries ~1 N of prize on ~0.1 N·m of motor torque, so the usable
// band is narrow and guessing at it does not work.
//
//   python3 -m http.server 8000 &
//   node tools/clawgrip.mjs [--n 8]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9334;
const URL_BASE = process.env.CLAW_URL || 'http://localhost:8000/apps/claw/?dbg=1';
const ni = process.argv.indexOf('--n');
const N = ni > 0 ? +process.argv[ni + 1] : 8;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// candidates: [strongK, weakK, fadeK, clawFloorY]
const CANDIDATES = [
  [1.50, 0.45, 0.06, 0.178],
  [3.00, 0.45, 0.06, 0.178],
  [6.00, 0.45, 0.06, 0.178],
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu-sandbox',
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--window-size=520,900',
    '--no-first-run', '--user-data-dir=/tmp/claw-grip-profile', 'about:blank',
  ], { stdio: 'ignore', detached: false });
}
async function cdpTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page'); if (p) return p;
    } catch {}
    await sleep(300);
  }
  throw new Error('no CDP target');
}
class S {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); this.logs = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.p.has(m.id)) { const { r, j } = this.p.get(m.id); this.p.delete(m.id);
        m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
      else if (m.method === 'Runtime.exceptionThrown')
        this.logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || ''));
    }); }
  send(method, params = {}) { const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r, j) => this.p.set(id, { r, j })); }
  async eval(e, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value; }
}
async function waitPhase(s, want, ms = 120000) {
  const t0 = Date.now();
  let last = '?';
  while (Date.now() - t0 < ms) {
    const st = await s.eval('({p: __claw.phase, w: document.getElementById("win").classList.contains("show")})');
    if (st.w) { await s.eval('document.getElementById("winOk").click()'); continue; }
    last = st.p;
    if (want.includes(st.p)) return st.p;
    await sleep(110);
  }
  throw new Error('phase timeout, stuck in ' + last + ' waiting for ' + want.join('/'));
}

async function main() {
  const chrome = launch();
  try {
    const t = await cdpTarget();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const s = new S(ws);
    await s.send('Runtime.enable'); await s.send('Page.enable'); await s.send('Network.enable');
    await s.send('Network.setBypassServiceWorker', { bypass: true });
    await s.send('Network.setCacheDisabled', { cacheDisabled: true });
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.clear()}catch(e){}' });
    await s.send('Page.navigate', { url: URL_BASE });
    for (let i = 0; i < 120; i++) { await sleep(500); if (await s.eval('!!window.__claw')) break; }
    if (!await s.eval('!!window.__claw')) throw new Error('never booted');
    await s.eval('__claw.speed(40)');
    await s.eval('__claw.start()');
    await waitPhase(s, ['aim']);

    const grab = async strong => {
      await waitPhase(s, ['aim']);
      await s.eval(`__claw.strong(${strong})`);
      const n = await s.eval('__claw.nearest()');
      await s.eval(`__claw.aimAt(${n.x}, ${n.z})`);
      await sleep(200);
      const before = await s.eval('__claw.save.wins');
      await s.eval('__claw.drop()');
      await waitPhase(s, ['judge', 'idle']);
      for (let k = 0; k < 16; k++) {
        await sleep(140);
        if (await s.eval('document.getElementById("win").classList.contains("show")'))
          await s.eval('document.getElementById("winOk").click()');
      }
      return (await s.eval('__claw.save.wins')) > before;
    };

    console.log('strongK weakK  fadeK  yBot   strong-wins  weak-wins');
    const tally = CANDIDATES.map(() => ({ sw: 0, ww: 0 }));
    for (let i = 0; i < N; i++) {
      for (let c = 0; c < CANDIDATES.length; c++) {
        const [sk, wk, fk, yb] = CANDIDATES[c];
        await s.eval(`__claw.tune({grip:{STRONG_K:${sk},WEAK_K:${wk},FADE_K:${fk}}, yBot:${yb}})`);
        if (await grab(true)) tally[c].sw++;
        if (await grab(false)) tally[c].ww++;
      }
      console.log(`round ${i + 1}/${N}: ` + tally.map((t, c) =>
        `${CANDIDATES[c][0]}→${t.sw}s/${t.ww}w`).join('  '));
    }
    for (let c = 0; c < CANDIDATES.length; c++) {
      const [sk, wk, fk, yb] = CANDIDATES[c];
      console.log(`${String(sk).padEnd(8)}${String(wk).padEnd(7)}${String(fk).padEnd(7)}${String(yb).padEnd(7)}${tally[c].sw}/${N}`.padEnd(52) + `${tally[c].ww}/${N}`);
    }
    const errs = s.logs.filter(l => /EXCEPTION/.test(l));
    if (errs.length) console.log('\nexceptions:\n' + errs.slice(0, 5).join('\n'));
  } finally { chrome.kill(); }
}
main().catch(e => { console.error(e); process.exit(1); });
