// Auto KW: in-air control (vehicles.js freeAir), end to end, with REAL held keys.
//
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 node tools/kw/aircontrolprobe.mjs [outdir] [noshots]
//
// Boots the game (service worker bypassed), pauses it, and drives YOUR vehicle at a fixed 1/60 s
// through player.update with traffic, world, stunts.update and airtime.update alongside
// (tools/kw/aircontrol-page.js). The keys are put in controls.keys and read by controls.read(),
// the input main.js builds: W is the gas AND stick-forward, A / D steer, S brakes. Nothing is
// written over the body: every rotation comes from the keys.
//
// One real take-off: the brow of the Grand River's bank behind Zeller Dr (Lackner Woods, north-east
// Kitchener), off the grass at 28 m/s: a dirt bike flies ~1.3 s / ~43 m, a Jeep ~1.3 s / ~41 m and
// lands across a dip. KW's terrain is flat: a scan of the whole map (every 20 m, 16 headings, then
// the real vehicles driven off the best 100) found nothing longer that lands dry -- the long
// natural flights all end in a river. See apps/autokw/CLAUDE.md, "In-air control".
// Asserts:
//   - no input: A and B land flat and CLEAN (the self-righting spring), no flip, no spin
//   - GAS HELD FROM THE RUN-UP does not flip anything (the pedal must come up once in the air)
//   - a full-lock spin (A held, D to stop it) scores a spin; a re-pressed-gas flip scores a flip
//   - QUADRUPLE STUNT (distance + flip + spin) off A, clean and paid
//   - over-rotated landings fail and pay nothing: W held all the way on the bike (a crash landing),
//     and the Jeep flipped onto its roof -- CAPSIZED, then rocked back with the stick and driven off
//   - a bike flips faster than a car (mean pitch rate under the same key)
//   - the Jeep's body spins too (in-air steering turns the body, not the path)
//   - non-vacuous: with freeAir switched off (Vehicle.airCapable -> false) the spin and flip score 0
//   - invariance, in-page: AI-driven Vehicle.update (no `pilot`) never enters freeAir; a real-keys
//     street drive hashes identically with freeAir on and off; three stunts.js ramps (Chicopee,
//     YKF, Fairview, cap 32, the gas held in the air as kwstunts.mjs does) give identical results
//     on and off -- their flights are stuntAir's, never freeAir's
//   - 0 page exceptions
// The full invariance runs are separate: tools/kw/drivetest.mjs, tools/kw/kwstunts.mjs and
// tools/kw/trafficbench.js (CLAUDE.md "In-air control" has the numbers).
// Shots: mid-flip and mid-spin (beside the flight path), the QUADRUPLE readout, the Jeep on its roof.
import { launchChrome, assertRenderer } from '../chrome.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9559;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] && process.argv[2] !== 'noshots' ? process.argv[2] : 'tools/data/kw/aircontrol';
const SHOTS = !process.argv.includes('noshots');
const AC = readFileSync(new URL('./aircontrol-page.js', import.meta.url), 'utf8');
const SJ = readFileSync(new URL('../stuntjumps-page.js', import.meta.url), 'utf8');
let fails = 0, closing = false;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-aircontrol-${PORT}`, width: 1280, height: 720 });
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map(); const errs = [];
  ws.addEventListener('close', () => { if (closing) return; console.log('FAIL: DevTools socket closed'); process.exit(1); });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  });
  const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 1500));
    return r.result?.result?.value;
  };
  const J = async (e) => JSON.parse(await ev(e));
  mkdirSync(OUT, { recursive: true });
  const shot = async (name) => {
    if (!SHOTS) return;
    await ev('window.__ac.settle()');
    await sleep(1400);
    const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(result.data, 'base64'));
    console.log(`  shot ${OUT}/${name}.jpg`);
  };

  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true; try { localStorage.removeItem("autokw-airtime"); sessionStorage.removeItem("autokw-cheated"); } catch (e) {}' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
  let up = false;
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    try { if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.stunts && window.__dbg.airtime)')) { up = true; break; } } catch { /* navigating */ }
    if (errs.length && i > 6) break;
  }
  if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
  await assertRenderer(ev);
  await sleep(2500);
  await ev(`(() => { for (const id of ['rotate', 'toast', 'stickZone', 'lookZone', 'pad', 'topBtns', 'objective']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    window.__tod = 'day'; return 1; })()`);
  console.log(`booted; exceptions at boot: ${errs.length}`);
  await ev('window.__dbg.game.paused = true; window.__dbg.stunts.ignorePause = true; 1');
  await ev(SJ);
  await ev('window.__sj.load()');
  console.log(await ev(AC));

  // the take-off (x, z: the brow; h: heading; the run-up starts `back` m before it, rolling at `speed`)
  const A = { type: 'dirtbike', x: 5239.63, z: -420.15, h: 1.963, speed: 28, back: 40 };
  const B = { ...A, type: 'jeep' };
  // the air's controllers: (S, v) -> keys. S.pa / S.ya are the body's accumulated pitch / heading (rad)
  const C = {
    none: 'function () { return []; }',
    holdW: 'function () { return ["KeyW"]; }',                                       // gas held from the run-up, never let up
    allW: 'function (S) { return S.air < 0.05 ? [] : ["KeyW"]; }',                   // up at the lip, then held to the ground
    flip: 'function (S) { if (S.air < 0.05) return []; return S.pa < 5.5 ? ["KeyW"] : []; }',
    spin: 'function (S, v) { const F = v.airFly; if (Math.abs(S.ya) < 6.1) return ["KeyA"]; return F && F.wy > 0.3 ? ["KeyD"] : []; }',
    quad: 'function (S, v) { const F = v.airFly, k = []; if (S.air >= 0.05 && S.pa < 5.5) k.push("KeyW");'
      + ' if (Math.abs(S.ya) < 6.1) k.push("KeyA"); else if (F && F.wy > 0.3) k.push("KeyD"); return k; }',
    steer: 'function () { return ["KeyA"]; }',
  };
  const run = async (label, site, ctl, extra = {}) => {
    const r = await J(`window.__ac.run(${JSON.stringify({ ...site, ctl: C[ctl], ...extra })})`);
    const L = r.last, l = r.landed || {}, al = l.airLand || {};
    console.log(`  ${label}: ${r.phase} lip ${r.lip && r.lip.sp} m/s, air ${l.air} s ${l.dist} m; body ${r.pa} deg pitch, ${r.ya} deg yaw, ${r.ra} deg roll`
      + ` (keys ${r.ctlAir} s); touchdown tilt ${al.tilt} slip ${al.slip}${al.why ? ' ' + al.why : ''}${l.capsized ? ' CAPSIZED' : ''}`
      + (L ? ` -> ${L.name} ${L.flips} flips ${L.spins} spins, clean ${L.clean}${L.why ? ' (' + L.why + ')' : ''}, paid $${r.paid}` : ' -> nothing'));
    return r;
  };

  console.log('--- a dirt bike off the Grand River bank behind Zeller Dr (28 m/s)');
  const aN = await run('no input', A, 'none');
  ok(aN.last && aN.last.clean && aN.last.flips === 0 && aN.last.spins === 0 && aN.landed.air >= 1.2 && aN.landed.dist >= 30, 'no input: a real >1.2 s, >30 m flight lands flat and clean, no flip, no spin');
  ok(aN.landed && aN.landed.airLand && aN.landed.airLand.upright && aN.landed.airLand.tilt < 15, `the self-righting spring: touchdown ${aN.landed && aN.landed.airLand && aN.landed.airLand.tilt} deg off the ground's upright`);
  const aH = await run('gas held from the run-up', A, 'holdW');
  ok(aH.last && aH.last.clean && aH.last.flips === 0 && Math.abs(aH.pa - aN.pa) < 10, 'gas held over the lip and never let up does NOT flip it (the pedal must come up once)');
  const aS = await run('full-lock spin', A, 'spin');
  ok(aS.last && aS.last.spins >= 1 && aS.last.clean && aS.paid > 0, `a full-lock 360 scores a spin, clean, paid ($${aS.paid})`);
  const aF = await run('gas flip', A, 'flip');
  ok(aF.last && aF.last.flips >= 1 && aF.last.clean && aF.paid > 0, `the gas, up at the lip and pressed again, flips it: a flip, clean, paid ($${aF.paid})`);
  const aQ = await run('flip + spin', A, 'quad');
  ok(aQ.last && aQ.last.name === 'QUADRUPLE STUNT' && aQ.last.clean && aQ.last.dist >= 30 && aQ.last.flips >= 1 && aQ.last.spins >= 1,
    'QUADRUPLE STUNT in free play: distance, a flip and a spin off a real bank, clean');
  ok(aQ.last && aQ.paid === Math.round((aQ.last.dist * 10 + 800) / 10) * 10, `paid $10/m + $800 ($${aQ.paid})`);
  ok(/QUADRUPLE STUNT/.test(aQ.big), `the big readout: "${aQ.big}"`);
  if (SHOTS) { await ev(`(() => { const h = document.getElementById('hud'); if (h) h.style.display = ''; window.__dbg.player.applyCamera(window.__dbg.camera); return 1; })()`); await shot('quadruple'); }
  const aO = await run('W held all the way (over-rotated)', A, 'allW');
  ok(aO.last && !aO.last.clean && aO.paid === 0 && /crash landing|roof/.test(aO.last.why) && aO.pa > 400, `an over-rotated landing fails and pays nothing (${aO.pa} deg: ${aO.last && aO.last.why})`);
  ok(/STUNT FAILED/.test(aO.big), `"${aO.big}"`);

  console.log('--- a Jeep off the same bank');
  const bN = await run('no input', B, 'none');
  ok(bN.last && bN.last.clean && bN.last.flips === 0 && bN.landed.airLand && bN.landed.airLand.tilt < 15, 'a car: no input lands flat and clean');
  const bS = await run('full-lock spin', B, 'spin');
  ok(bS.last && bS.last.spins >= 1 && Math.abs(bS.ya) >= 330, `a car spins too: ${bS.ya} deg of body in ${bS.landed && bS.landed.air} s scores a spin (steering in the air turns the car, not its path)`);
  const bF = await run('W up at the lip, then held', B, 'allW');
  ok(bF.landed && bF.landed.capsized && bF.last && !bF.last.clean && bF.last.why === 'landed on the roof' && bF.paid === 0, 'over-rotated onto its roof: CAPSIZED, "landed on the roof", nothing paid');
  const rock = await J(`(() => { const T = window.__ac, v = T.S.v, r = {};
    T.keys([]); for (let i = 0; i < 150; i++) T.frame(1 / 60);
    r.rest = !!v.capsized; r.roll = Math.round(v.roll * 57.3);
    T.keys(['KeyW']); for (let i = 0; i < 60; i++) T.frame(1 / 60);
    r.stuck = !!v.capsized;
    T.keys(['KeyA']); let t = 0; for (let i = 0; i < 240 && v.capsized; i++) { T.frame(1 / 60); t += 1 / 60; }
    r.t = +t.toFixed(2); r.back = !v.capsized; r.roll2 = Math.round(v.roll * 57.3);
    const x0 = v.x, z0 = v.z; T.keys(['KeyW']); for (let i = 0; i < 120; i++) T.frame(1 / 60); T.keys([]);
    r.drove = +Math.hypot(v.x - x0, v.z - z0).toFixed(1);
    return JSON.stringify(r); })()`);
  console.log(`  capsized: ${JSON.stringify(rock)}`);
  ok(rock.rest && Math.abs(rock.roll) > 170 && rock.stuck, 'it comes to rest on its roof and the gas does nothing there');
  ok(rock.back && rock.t < 3 && rock.drove > 5, `the stick held rocks it back onto its wheels (${rock.t} s) and it drives off (${rock.drove} m)`);
  if (SHOTS) {
    await J(`window.__ac.run(${JSON.stringify({ ...B, ctl: C.allW })})`);
    await ev(`(() => { const T = window.__ac; T.keys([]); for (let i = 0; i < 60; i++) T.frame(1 / 60); window.__dbg.player.applyCamera(window.__dbg.camera); return 1; })()`);
    await shot('roof');
  }
  if (SHOTS) {
    // mid-air, from beside the flight path: the bike half way round a flip, the Jeep a third of a spin
    await ev('window.__ac.hideBig()');
    await J(`window.__ac.run(${JSON.stringify({ ...A, ctl: C.flip, stopAir: 0.62 })})`);
    await ev('window.__ac.side(1, 6, 0.6)');
    await shot('midflip');
    await J(`window.__ac.run(${JSON.stringify({ ...B, ctl: C.spin, stopAir: 0.55 })})`);
    await ev('window.__ac.side(-1, 9, 1.5)');
    await shot('midspin');
  }
  // the body's pitch 0.6 s into the same keys (W up at the lip, then held), both still in the air
  const bikeM = await J(`window.__ac.run(${JSON.stringify({ ...A, ctl: C.allW, stopAir: 0.6 })})`);
  const carM = await J(`window.__ac.run(${JSON.stringify({ ...B, ctl: C.allW, stopAir: 0.6 })})`);
  ok(bikeM.mid && carM.mid && bikeM.pa > carM.pa * 1.3 && carM.pa > 90, `a bike flips faster than a car: ${bikeM.pa} vs ${carM.pa} deg of pitch 0.6 s into the air`);

  console.log('--- non-vacuous: freeAir switched off (Vehicle.airCapable -> false), the old follow flying it');
  const A30 = A;
  const nS = await run('full-lock spin, on', A30, 'spin');
  await ev(`(() => { const P = Object.getPrototypeOf(window.__ac.S.v); window.__airCap = P.airCapable; P.airCapable = () => false; return 1; })()`);
  const xS = await run('full-lock spin, off', A30, 'spin');
  const xF = await run('gas flip, off', A30, 'flip');
  await ev(`(() => { const P = Object.getPrototypeOf(window.__ac.S.v); P.airCapable = window.__airCap; return 1; })()`);
  ok(xS.landed && xS.landed.air >= 0.6 && xF.landed && xF.landed.air >= 0.6, `the old follow flies the same take-off too (${xS.landed && xS.landed.air} s, ${xF.landed && xF.landed.air} s)`);
  ok(xS.last && xS.last.spins === 0 && Math.abs(xS.ya) < 120 && xF.last && xF.last.flips === 0 && Math.abs(xF.pa) < 60 && Math.abs(nS.ya) > 300,
    `without in-air control the same keys score no spin and no flip (body ${xS.ya} deg yaw / ${xF.pa} deg pitch, against ${nS.ya} deg yaw with it)`);

  console.log('--- invariance (in-page)');
  const ai = await J(`(() => { const d = window.__dbg, v = d.traffic.spawnAt(4000, -3000, 0, 'sedan', 0xffffff, 'free');
    v.y += 3; v.onGround = false; v.vLong = 20; let fly = 0;
    for (let i = 0; i < 40; i++) { v.update(1 / 60, { throttle: 1, steer: 1, brake: 0 }); if (v.airFly) fly++; }
    d.traffic.remove(v); return JSON.stringify({ fly, landed: v.onGround }); })()`);
  ok(ai.fly === 0, 'Vehicle.update without `pilot` (AI cars, the benches) never enters freeAir');
  const drive = await J(`(() => { const T = window.__ac, d = window.__dbg, P = Object.getPrototypeOf(T.S.v), on = P.airCapable;
    const go = () => { const v = T.put('sedan', -2928, -560, 0.3, 0); let h = 0, air = 0;
      for (let i = 0; i < 480; i++) { T.keys(i < 300 ? (i % 120 < 50 ? ['KeyW', 'KeyA'] : ['KeyW', 'KeyD']) : ['KeyS']); T.frame(1 / 60);
        h = (h * 31 + Math.round(v.x * 1e4) + Math.round(v.z * 1e4) * 7 + Math.round(v.heading * 1e6) + Math.round(v.y * 1e4) * 3) % 2147483647; if (v.onGround === false) air++; }
      T.keys([]); return { h, air, x: +v.x.toFixed(3), z: +v.z.toFixed(3) }; };
    const a = go(); P.airCapable = () => false; const b = go(); P.airCapable = on;
    return JSON.stringify({ a, b }); })()`);
  console.log(`  street drive: on ${JSON.stringify(drive.a)}  off ${JSON.stringify(drive.b)}`);
  ok(drive.a.h === drive.b.h && drive.a.x === drive.b.x, 'a real-keys street drive (gas, steering both ways, brake) is identical with freeAir on and off');
  const ramps = await J(`(() => { const P = Object.getPrototypeOf(window.__ac.S.v), on = P.airCapable, fa = P.freeAir, out = { fly: 0 };
    const go = () => ['chicopee', 'ykf', 'fairview'].map((j) => { const r = JSON.parse(window.__sj.drive(j, { cap: 32 })).res;
      return r && r.dist !== undefined ? [r.dist, r.air, r.clean, r.speed, r.maxUp, r.spin] : r; });
    go();   // (a first run differs from the next on any build: a jump's first completion, the streamer)
    P.freeAir = function (dt, input) { out.fly++; return fa.call(this, dt, input); };
    out.on = go(); P.freeAir = fa; P.airCapable = () => false; out.off = go(); P.airCapable = on;
    return JSON.stringify(out); })()`);
  console.log(`  ramps (dist, air, clean, lip, up, spin): on ${JSON.stringify(ramps.on)}  off ${JSON.stringify(ramps.off)}; freeAir frames ${ramps.fly}`);
  ok(ramps.fly === 0 && JSON.stringify(ramps.on) === JSON.stringify(ramps.off) && ramps.on.every((r) => Array.isArray(r) && r[2] === true),
    'three stunts.js ramps (gas held in the air, as kwstunts.mjs drives) land CLEAN, identically with freeAir on and off, and never enter it'); 

  console.log(`\nexceptions: ${errs.length}${errs.length ? '\n  ' + errs.slice(0, 5).join('\n  ') : ''}`);
  ok(errs.length === 0, '0 page exceptions');
  console.log(fails ? `FAIL ${fails}` : 'PASS');
} catch (err) {
  console.log('ERROR', err.stack || err.message);
  fails++;
} finally { closing = true; chrome.kill(); }
process.exit(fails ? 1 : 0);
