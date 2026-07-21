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
// Two passes, both with ?nosw=1 (SW bypassed):
//
// Pass 1 (?autostart=1) — targeted regressions from the V3 playtest:
//   1. street start: press R from the street → rope + real height/speed
//      within 5 sim-s (dead-hop ratchet regression),
//   2. grounded wall-running never leaves y=0 (roof-teleport regression),
//   3. right-hand anchors average to the RIGHT of travel (handedness mirror).
//
// Pass 2 (?bot=1) — 90 sim-second autopilot sweep:
//   4. no JS errors,
//   5. no rope segment ever crosses a building (the wrapping invariant),
//   6. the bot keeps swinging (mean speed floor — catches dead-hang
//      regressions like the V1 pendulum energy bug).
//
// Exit code 0 = pass. Re-run this after touching any coupled physics constant
// (see the tuning block in index.html), the wrap/anchor geometry, or anything
// lateral (rightOf consumers).

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
const evalJson = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;
async function load(query) {
  await send('Page.navigate', { url: `http://localhost:${HTTP}/apps/spiderman3d/index.html?nosw=1&${query}` });
  await new Promise(r => setTimeout(r, 6000));
  const boot = await evalJson('({errs: window.__errs, ok: !!window.__dbg})');
  if (!boot?.ok) { console.error('FAIL: __dbg missing; boot errors:', boot?.errs); process.exit(1); }
}

// ---- Pass 1: targeted playtest regressions -------------------------------
await load('autostart=1');
const targeted = await evalJson(`(() => {
  // street start (ratchet): press R, expect airborne rope + height + speed
  __dbg.stepN(60);
  __dbg.press('R');
  let maxY = 0, maxSpeed = 0, gotRope = false;
  for (let i = 0; i < 20; i++) {
    const s = __dbg.stepN(30);
    maxY = Math.max(maxY, s.pos[1]); maxSpeed = Math.max(maxSpeed, s.speed);
    if (s.ropes.R) gotRope = true;
  }
  __dbg.release('R');
  // grounded wall running (teleport): force turning into blocks for 15 sim-s
  __dbg.tilt(0.8);
  let maxGroundedY = 0;
  for (let i = 0; i < 60; i++) {
    const s = __dbg.stepN(30);
    if (s.grounded) maxGroundedY = Math.max(maxGroundedY, s.pos[1]);
  }
  __dbg.clearTilt();
  // handedness: right-hand anchors should average right of travel
  const sides = [];
  for (let t = 0; t < 8; t++) {
    __dbg.press('R'); __dbg.stepN(240);
    const r = __dbg.P.ropes.R;
    if (r) {
      const v = __dbg.P.vel, h = Math.hypot(v.x, v.z) || 1;
      const dx = r.pivots[0].x - __dbg.P.pos.x, dz = r.pivots[0].z - __dbg.P.pos.z;
      sides.push(dx * (-v.z / h) + dz * (v.x / h));   // dot with rightOf(travel)
    }
    __dbg.release('R'); __dbg.stepN(120);
  }
  const meanSide = sides.length ? sides.reduce((a, b) => a + b, 0) / sides.length : 0;
  return { maxY, maxSpeed, gotRope, maxGroundedY, sideSamples: sides.length, meanSide, errs: window.__errs };
})()`);
console.log(`street start: y ${targeted.maxY.toFixed(1)} speed ${targeted.maxSpeed.toFixed(1)} rope ${targeted.gotRope} | wallRun groundedY ${targeted.maxGroundedY.toFixed(2)} | handedness meanSide ${targeted.meanSide.toFixed(1)} (${targeted.sideSamples} samples)`);

// ---- Pass 2: autopilot sweep ---------------------------------------------
await load('bot=1');

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
if (!targeted.gotRope || targeted.maxY < 4 || targeted.maxSpeed < 15) { console.error('FAIL: street start is a dead hop again (ratchet regression)'); fail = true; }
if (targeted.maxGroundedY > 1.5) { console.error('FAIL: grounded runner left the street (roof-teleport regression)'); fail = true; }
if (targeted.sideSamples >= 4 && targeted.meanSide < 0) { console.error('FAIL: right-hand anchors lean left (handedness mirror regression)'); fail = true; }
if (targeted.errs.length || sweep.errs.length || errors.length) { console.error('FAIL: JS errors', targeted.errs, sweep.errs, errors); fail = true; }
if (sweep.clipViolations > 0) { console.error('FAIL: rope crossed a building'); fail = true; }
if (mean < 8) { console.error('FAIL: bot is not swinging (mean speed < 8 m/s — dead-hang regression?)'); fail = true; }
console.log(fail ? 'FAIL' : 'PASS');
process.exit(fail ? 1 : 0);
