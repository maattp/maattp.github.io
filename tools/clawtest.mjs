// Headless verification for apps/claw. Boots the machine in Chrome over CDP,
// plays real grabs against the real Rapier pile, and reports whether the grip
// constants actually do what the payout schedule promises.
//
//   python3 -m http.server 8000 &
//   node tools/clawtest.mjs [--shots] [--rounds N]
//
// Two rules, both inherited from tools/verify.mjs the hard way:
//   * bypass the service worker AND the disk cache, or you test a stale build
//   * screenshot at DPR 3 mobile as well as desktop — DPR 1 hides canvas
//     layout bugs completely
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9333;
const URL_BASE = process.env.CLAW_URL || 'http://localhost:8000/apps/claw/?dbg=1';
const SHOTS = process.argv.includes('--shots');
const ri = process.argv.indexOf('--rounds');
const ROUNDS = ri > 0 ? +process.argv[ri + 1] : 6;
const OUT = 'tools/data/clawshots';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu-sandbox',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=520,900',
    '--no-first-run',
    '--user-data-dir=/tmp/claw-verify-profile',
    'about:blank',
  ], { stdio: 'ignore', detached: false });
}

async function cdpTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(300);
  }
  throw new Error('Chrome did not expose a CDP target');
}

class Session {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.logs = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        this.logs.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description
          || m.params.exceptionDetails.text));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async shot(name) {
    if (!SHOTS) return;
    mkdirSync(OUT, { recursive: true });
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(`  shot ${OUT}/${name}.png`);
  }
}

// Wait for one of `want`, dismissing the win card as it appears. Without the
// dismiss this deadlocks: the win screen pauses the simulation, so a prize that
// slides into the bin a beat late freezes the phase machine mid-cycle.
async function waitPhase(s, want, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await s.eval(
      '({p: __claw.phase, win: document.getElementById("win").classList.contains("show")})');
    if (st.win) { await s.eval('document.getElementById("winOk").click()'); continue; }
    if (want.includes(st.p)) return st.p;
    await sleep(120);
  }
  throw new Error('timed out waiting for ' + want.join('/'));
}

async function main() {
  const chrome = launch();
  let fails = 0;
  const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
  let session;
  try {
    const target = await cdpTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    session = new Session(ws);
    await session.send('Runtime.enable');
    await session.send('Page.enable');
    await session.send('Network.enable');
    await session.send('Network.setBypassServiceWorker', { bypass: true });
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'try{localStorage.clear()}catch(e){}',
    });

    console.log(`loading ${URL_BASE}`);
    await session.send('Page.navigate', { url: URL_BASE });

    let ready = false;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      if (await session.eval('!!window.__claw')) { ready = true; break; }
      const boot = await session.eval('(document.getElementById("err")||{}).textContent || ""');
      if (boot) { console.log(boot); break; }
    }
    if (!ready) { console.log(session.logs.slice(-30).join('\n')); throw new Error('never reached __claw'); }
    console.log('booted.\n');

    console.log('scene:');
    const st = await session.eval('({prizes: __claw.prizes, mode: __claw.mode, heights: __claw.heights()})');
    ok(st.prizes === 26, `machine stocked with 26 plush (got ${st.prizes})`);
    const settled = st.heights.filter(h => h > -0.05 && h < 0.45).length;
    ok(settled === st.prizes, `all ${st.prizes} plush settled inside the box (${settled} in range) ${JSON.stringify(st.heights)}`);
    await session.shot('00-title');

    console.log('\nstarting a game:');
    await session.eval('__claw.speed(40)');
    await session.eval('__claw.start()');
    await sleep(600);
    ok(await session.eval('__claw.phase') === 'aim', 'phase is aim after INSERT COIN');
    await session.shot('01-aim');

    // ---- grip trials -----------------------------------------------------
    const trial = async (strong, i) => {
      await waitPhase(session, ['aim']);
      await session.eval(`__claw.strong(${strong})`);
      const n = await session.eval('__claw.nearest()');
      // aim so the claw axis lands on the plush
      await session.eval(`__claw.aimAt(${n.x}, ${n.z})`);
      await sleep(250);
      const winsBefore = await session.eval('__claw.save.wins');
      await session.eval('__claw.drop()');
      let carried = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 40000) {
        const st2 = await session.eval(
          '({p: __claw.phase, h: __claw.held(), w: document.getElementById("win").classList.contains("show")})');
        if (st2.w) { await session.eval('document.getElementById("winOk").click()'); continue; }
        if (st2.p === 'travel' && st2.h) carried = true;
        if (st2.p === 'judge' || st2.p === 'idle') break;
        await sleep(110);
      }
      if (strong && i === 0) await session.shot('02-strong-release');
      // give a late slide into the bin time to register, dismissing as we go
      for (let k = 0; k < 20; k++) {
        await sleep(150);
        if (await session.eval('document.getElementById("win").classList.contains("show")'))
          await session.eval('document.getElementById("winOk").click()');
      }
      const winsAfter = await session.eval('__claw.save.wins');
      return { won: winsAfter > winsBefore, carried, target: n.id };
    };

    console.log(`\nweak grabs (the machine is not paying) — ${ROUNDS} rounds:`);
    let weakWins = 0, weakCarried = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const r = await trial(false, i);
      console.log(`   round ${i + 1}: ${r.target.padEnd(8)} carried=${r.carried ? 'yes' : 'no '} ${r.won ? 'WON (!)' : 'dropped'}`);
      if (r.carried) weakCarried++;
      if (r.won) weakWins++;
    }
    // What matters is the payout, not the carry: a weak grab that survives the
    // lift still has the arrival jolt to get through, and usually doesn't.
    ok(weakWins <= Math.floor(ROUNDS * 0.2),
      `weak grip almost never pays out (${weakWins}/${ROUNDS} won, ${weakCarried} carried)`);

    console.log(`\nstrong grabs (the machine is paying) — ${ROUNDS} rounds:`);
    let strongWins = 0, strongCarried = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const r = await trial(true, i);
      console.log(`   round ${i + 1}: ${r.target.padEnd(8)} carried=${r.carried ? 'yes' : 'no '} ${r.won ? 'WON' : 'dropped'}`);
      if (r.carried) strongCarried++;
      if (r.won) strongWins++;
    }
    ok(strongCarried >= Math.ceil(ROUNDS * 0.7),
      `strong grip carries the plush to the top (${strongCarried}/${ROUNDS} carried, ${strongWins} won)`);
    ok(strongCarried > weakCarried,
      `the payout schedule changes the grip (strong ${strongCarried} vs weak ${weakCarried} carried)`);

    console.log('\nintegrity:');
    ok(await session.eval('__claw.prizes') >= 25, 'machine restocks after wins');
    const esc = await session.eval('__claw.heights().filter(h => h < -0.40).length');
    ok(esc === 0, `no plush escaped the cabinet (${esc} below the bin floor)`);

    // ---- mobile DPR pass (canvas layout) --------------------------------
    console.log('\nmobile canvas layout (iPhone portrait, DPR 3):');
    await session.send('Emulation.setDeviceMetricsOverride',
      { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
    await sleep(900);
    const cv = await session.eval(`(() => {
      const c = document.getElementById('gl'), r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), iw: innerWidth, ih: innerHeight };
    })()`);
    ok(cv.w === cv.iw && cv.h === cv.ih,
      `canvas fills the viewport (${cv.w}x${cv.h} vs ${cv.iw}x${cv.ih})`);
    await session.shot('03-mobile');
    await session.send('Emulation.clearDeviceMetricsOverride');

    console.log('\ncollection:');
    await session.eval('document.getElementById("menuBtn").click()');
    await sleep(200);
    await session.eval('document.getElementById("pauseColl").click()');
    await sleep(1200);
    const cards = await session.eval('document.querySelectorAll("#shelf .card").length');
    ok(cards === 12, `prize shelf renders all 12 species (got ${cards})`);
    const art = await session.eval('(document.querySelector("#shelf .card img")||{}).src?.slice(0,14)');
    ok(art === 'data:image/png', 'shelf thumbnails rendered from the plush builder');
    await session.shot('04-shelf');

    const errors = session.logs.filter(l => /EXCEPTION/.test(l));
    ok(errors.length === 0, `no runtime exceptions (${errors.length})`);
    if (errors.length) console.log(errors.slice(0, 8).join('\n'));

  } finally {
    try { session?.ws.close(); } catch {}
    chrome.kill();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
