#!/usr/bin/env node
// Headless regression sweep for the swing physics (Node 24+, no deps).
//
// Setup (two terminals, from the repo root):
//   python3 -m http.server 8765
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless=new --use-gl=angle --use-angle=swiftshader \
//     --enable-unsafe-swiftshader --remote-debugging-port=9333 \
//     --user-data-dir=/tmp/sm3d-chrome about:blank
// Then:
//   node apps/spiderman3d/verify.mjs
//
// Loads the game with ?nosw=1&bot=1 (SW bypassed, autopilot on), fast-forwards
// 90 sim-seconds, and asserts:
//   1. no JS errors,
//   2. no rope segment ever crosses a building (the wrapping invariant),
//   3. the bot keeps swinging (mean speed above threshold — catches dead-hang
//      regressions like the V1 pendulum energy bug).
// Exit code 0 = pass. Re-run this after touching any coupled physics constant
// (see the tuning block in index.html) or the wrap/anchor geometry.

const CDP = process.env.CDP_PORT || 9333;
const HTTP = process.env.HTTP_PORT || 8765;
const SIM_SECONDS = 90;

const list = await (await fetch(`http://localhost:${CDP}/json/list`)).json();
const target = list.find(t => t.type === 'page');
if (!target) { console.error('no headless Chrome page target on port ' + CDP); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise(res => {
  const mid = ++id;
  pending.set(mid, res);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const errors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
await new Promise(r => ws.onopen = r);
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: `http://localhost:${HTTP}/apps/spiderman3d/index.html?nosw=1&bot=1` });
await new Promise(r => setTimeout(r, 6000));

const evalJson = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;

const boot = await evalJson('({errs: window.__errs, ok: !!window.__dbg})');
if (!boot?.ok) { console.error('FAIL: __dbg missing; boot errors:', boot?.errs); process.exit(1); }

const sweep = await evalJson(`(() => {
  __dbg.resetWrapStats();
  const speeds = []; let clipViolations = 0;
  for (let i = 0; i < ${SIM_SECONDS}; i++) {
    speeds.push(__dbg.stepN(120).speed);
    for (const s of ['L', 'R']) {
      const r = __dbg.P.ropes[s];
      if (!r) continue;
      for (let j = 0; j < r.pivots.length; j++) {
        const a = j + 1 < r.pivots.length ? r.pivots[j + 1] : __dbg.P.pos;
        if (__dbg.segBlocked(r.pivots[j], a)) clipViolations++;
      }
    }
  }
  return { speeds, clipViolations, wrapStats: __dbg.wrapStats, errs: window.__errs };
})()`);
ws.close();

const mean = sweep.speeds.reduce((a, b) => a + b, 0) / sweep.speeds.length;
console.log(`mean speed ${mean.toFixed(1)} m/s | clipViolations ${sweep.clipViolations} | wrapStats ${JSON.stringify(sweep.wrapStats)} | jsErrors ${sweep.errs.length + errors.length}`);

let fail = false;
if (sweep.errs.length || errors.length) { console.error('FAIL: JS errors', sweep.errs, errors); fail = true; }
if (sweep.clipViolations > 0) { console.error('FAIL: rope crossed a building'); fail = true; }
if (mean < 8) { console.error('FAIL: bot is not swinging (mean speed < 8 m/s — dead-hang regression?)'); fail = true; }
console.log(fail ? 'FAIL' : 'PASS');
process.exit(fail ? 1 : 0);
