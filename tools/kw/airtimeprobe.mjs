// Auto KW: the free-form stunt bonus (src/airtime.js), end to end.
//
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 [AUTO_PHONE=1] node tools/kw/airtimeprobe.mjs [outdir] [noshots]
//
// Boots the game (service worker bypassed), pauses it, and drives the PLAYER'S OWN car at a fixed
// dt through player.update with traffic, world, stunts.update and airtime.update stepping alongside
// -- tools/kw/kwstunts.mjs's loop (tools/stuntjumps-page.js, whose __sj also drives the real ramp).
// The synthetic launches are on the YKF fence-line jump's kept-clear landing corridor (open, flat
// grass): the car is given a speed along the corridor and a vertical speed, with `onGround = false`
// (the vertical follow's own airborne state, vehicles.js) or `stunt = true` (Vehicle.stuntAir, the
// ramp flight, where steering spins the body); a flip is a roll rate written over the body each
// frame. Asserts:
//   - a short hop (< 0.8 s) scores nothing, pays nothing, shows nothing
//   - one jump built for each tier: STUNT BONUS (0 criteria), DOUBLE (distance), TRIPLE (+ height),
//     QUADRUPLE (+ a real in-air spin through stuntAir's steering), WATERLOO WARRIOR (+ a flip)
//   - pay = $10/m + the tier's bonus, added to the wallet; a bicycle and a quad count too
//   - a roof landing fails ("STUNT FAILED", no pay); a splashdown in Laurel Creek Reservoir fails
//   - the cheat rule: CHEAT.on shows the jump, pays nothing, saves nothing
//   - a real unique ramp jump (Fairview lot, driven by __sj) is paid by stunts.js once and stays
//     silent here (no readout, no pay), but its stats count toward the bests
//   - eligibility: aircraft, boats, the balloon are out; cars, bikes, quads, bicycles in
//   - the save (localStorage autokw-airtime), a fresh instance loading it, the passport row
//     "Best stunt: 2.4 s, 61 m, 1 flip" in the pause menu
//   - 0 page exceptions
// Shots: the live readout mid-air and the big readout on landing (and a fail), plus the passport.
// Exit 1 on a failure. Non-vacuous: without main.js's `airtime.update` the live-loop check fails;
// with the fast path reading `v.stunt` alone (no vehicles.js onGround) every follow-mode tier fails.
import { launchChrome, assertRenderer } from '../chrome.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9558;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PHONE = process.env.AUTO_PHONE === '1';
const OUT = process.argv[2] || 'tools/data/kw/airshots';
const SHOTS = !process.argv.includes('noshots');
const SJ = readFileSync(new URL('../stuntjumps-page.js', import.meta.url), 'utf8');
let fails = 0, closing = false;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-air-profile-${PORT}`, width: 1280, height: 720 });
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
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') {
      const t = (m.params.args || []).map((a) => a.value || a.description).join(' ');
      if (/airtime/.test(t)) errs.push('warning: ' + t);
    }
  });
  const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 1500));
    return r.result?.result?.value;
  };
  const J = async (e) => JSON.parse(await ev(e));
  mkdirSync(OUT, { recursive: true });
  const tag = PHONE ? 'phone-' : '';
  const shot = async (name) => {
    if (!SHOTS) return;
    await ev('window.__at.settle()');
    await sleep(1200);
    const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    writeFileSync(`${OUT}/${tag}${name}.jpg`, Buffer.from(result.data, 'base64'));
    console.log(`  shot ${OUT}/${tag}${name}.jpg`);
  };

  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (PHONE) {
    await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true; try { localStorage.removeItem("autokw-airtime"); sessionStorage.removeItem("autokw-cheated"); } catch (e) {}' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
  let up = false;
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    try { if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.stunts && window.__dbg.airtime)')) { up = true; break; } } catch { /* navigating */ }
    if (errs.length && i > 6) break;
  }
  if (!up) throw new Error('never booted, or no __dbg.airtime: ' + errs.slice(0, 5).join('\n'));
  await assertRenderer(ev);
  await sleep(2500);
  await ev(`(() => { const r = document.getElementById('rotate'); if (r) r.style.display = 'none'; window.__tod = 'day'; return 1; })()`);
  console.log(`booted${PHONE ? ' (phone)' : ''}; exceptions at boot: ${errs.length}`);
  await ev('window.__dbg.game.paused = true; window.__dbg.stunts.ignorePause = true; 1');
  await ev(SJ);
  await ev('window.__sj.load()');
  // the probe's own helpers
  await ev(`(() => {
    const d = window.__dbg, c = d.city, p = d.player, A = d.airtime;
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const T = window.__at = { cars: {} };
    T.toasts = [];
    { const H = d.hud, f = H.showToast.bind(H); H.showToast = (t, ms) => { T.toasts.push(String(t)); return f(t, ms); }; }
    /** the player in a fresh car of 'type' at (x, z) heading h, standing on the ground */
    T.put = (type, x, z, h) => {
      if (d.game.dead) { d.game.dead = false; d.game.deathT = 0; document.getElementById('wasted').classList.remove('show'); }
      p.health = 100; p.dead = false; d.game.wanted = 0;
      let v = p.vehicle;
      if (v) { p.exitVehicle(true); d.traffic.remove(v); }
      v = d.traffic.spawnAt(x, z, 0, type, 0xd0402f, 'free');
      p.enterVehicle(v);
      v.health = 100; v.dead = false; v.stunt = false; v.stuntLaunch = null; v.stuntLanded = false; v.rampRef = null;
      v.x = x; v.z = z; v.heading = h; v.y = c.groundAt(x, z, null); v.vy = 0; v.vLong = 0; v.vLat = 0;
      v.pitch = 0; v.roll = 0; v.onGround = true;
      p.camYaw = h + Math.PI; p.camFloor = null;
      d.stunts.run = null; d.stunts.last = null; A.cancel(); A.last = null;
      d.world.update(x, z, 60);
      return v;
    };
    /** one fixed-dt frame of the game's own update order for the player */
    T.frame = (dt, steer, gas) => {
      const input = d.controls.read();
      input.y = 0; input.hand = false; input.attack = false;
      input.x = steer || 0; input.gas = !!gas; input.gasAmt = gas ? 1 : 0; input.brake = false; input.brakeAmt = 0;
      p.update(dt, input, { x: 0, y: 0 }, d.controls, d.traffic, d.peds);
      const pos = p.position, cd = { x: pos.x - p.camPos.x, z: pos.z - p.camPos.z }, cl = Math.hypot(cd.x, cd.z) || 1;
      cd.x /= cl; cd.z /= cl;
      if (d.link && !d.link._fr) d.link._fr = 1;
      d.traffic.update(dt, pos.x, pos.z, cd, p);
      d.world.update(pos.x, pos.z, 2);
    };
    /**
     * Launch: o = { type, x, z, h, speed, vy, mode: 'follow' | 'flight', steer, flip (rad/s of roll),
     * roof (land on the roof), }.
     * Steps until the airtime judgement (or 12 s); returns what happened.
     */
    T.jump = (o) => {
      const v = T.put(o.type || 'sedan', o.x, o.z, o.h);
      for (let i = 0; i < 4; i++) T.frame(1 / 60, 0, false);   // settle on the ground
      const money0 = d.game.money, fwd = v.forward;
      v.vLong = o.speed; v.vLat = 0;
      v.y += 0.4; v.vy = o.vy;
      if (o.mode === 'flight') { v.stunt = true; v.spinRate = 0; }
      v.onGround = false;
      T.st = { o, money0, t: 0, air: 0, phi: 0, maxLive: 0, live: false, done: false, v };
      return T.cont();
    };
    T.cont = (until) => {
      const S = T.st, o = S.o, v = S.v, dt = 1 / 60;
      for (let i = 0; i < 12 * 60 && !S.done; i++) {
        const aloft = v.stunt || v.onGround === false;
        T.frame(dt, aloft ? (o.steer || 0) : 0, false);
        const aloftNow = v.stunt || v.onGround === false;
        if (aloftNow && o.flip) { S.phi += o.flip * dt; v.roll = S.phi; }
        if (o.roof && aloftNow) v.roll = Math.PI;
        if (!aloftNow && o.flip) { v.roll = 0; }
        d.stunts.update(dt, p);
        A.update(dt, p);
        S.t += dt; if (aloftNow) S.air += dt;
        const el = document.getElementById('airLive');
        if (el && el.classList.contains('show')) { S.live = true; S.maxLive = Math.max(S.maxLive, +el.querySelector('b').textContent); }
        if (A.last) S.done = true;
        else if (!A.j && S.t > 0.5 && !aloftNow) S.done = true;   // nothing in progress: a hop that did not count
        if (until && until(S)) break;
      }
      p.applyCamera(d.camera);
      d.placeSun(p.position.x, p.position.y, p.position.z);
      const big = document.getElementById('airBig');
      return JSON.stringify({ last: A.last, paid: d.game.money - S.money0, t: +S.t.toFixed(2), air: +S.air.toFixed(2), live: S.live, maxLive: S.maxLive,
        big: big && big.classList.contains('show') ? big.innerText.replace(/\\n+/g, ' | ') : '', done: S.done,
        save: JSON.parse(localStorage.getItem('autokw-airtime') || 'null') });
    };
    T.hideBig = () => { const b = document.getElementById('airBig'); if (b) b.classList.remove('show'); A.bigT = 0; return 1; };
    T.settle = () => { const v = p.vehicle || p; for (let i = 0; i < 300; i++) if (!d.world.update(v.x, v.z, 60)) break; d.renderer && 1; return 1; };
    return 1;
  })()`);

  // the YKF fence-line jump's kept-clear landing corridor: open, level grass
  const C = await J(`(() => { const j = window.__dbg.stunts.list.find((q) => q.id === 'ykf'), r = j.ramp;
    const x = r.x0 + r.dx * (r.L + 6), z = r.z0 + r.dz * (r.L + 6);
    return JSON.stringify({ x, z, h: Math.atan2(r.dx, r.dz), prof: window.__sj.check('ykf').prof }); })()`);
  console.log(`corridor at (${Math.round(C.x)}, ${Math.round(C.z)}), ground past the lip every 10 m: ${C.prof.join(' ')}`);
  const at = (o) => JSON.stringify({ x: C.x, z: C.z, h: C.h, ...o });
  const jump = async (label, o) => {
    const r = await J(`window.__at.jump(${at(o)})`);
    const L = r.last;
    console.log(`  ${label}: air ${r.air} s` + (L ? ` -> ${L.name} ${L.air} s ${L.dist} m ${L.height} m high, ${L.flips} flips ${L.spins} spins, clean ${L.clean}${L.why ? ' (' + L.why + ')' : ''}, pay $${L.pay}, paid $${r.paid}` : ' -> nothing') + (r.big ? `  [${r.big}]` : ''));
    return r;
  };

  console.log('--- eligibility');
  ok(await ev(`(async () => { const { eligible } = await import(new URL('src/airtime.js', location.href).href); const T = window.__dbg.TYPES;
    const k = (t) => eligible({ spec: T[t] }); return ['sedan', 'bicycle', 'atv', 'kart'].filter((t) => T[t]).every(k) && !['heli', 'balloon', 'boat', 'jetski', 'kayak', 'airliner', 'saucer'].filter((t) => T[t]).some(k); })()`),
    'cars, bicycles, quads, karts count; helicopters, the balloon, boats, jet skis, kayaks, airliners and the saucer do not');

  console.log('--- a short hop');
  const hop = await jump('hop', { speed: 18, vy: 5 });
  ok(!hop.last && hop.paid === 0 && !hop.big && !hop.live, `a ${hop.air} s hop scores nothing, pays nothing, shows nothing`);
  ok(hop.air > 0.2, 'the hop really left the ground (vehicles.js onGround = false)');

  console.log('--- the tiers');
  const t0 = await jump('stunt', { speed: 14, vy: 10 });
  ok(t0.last && t0.last.name === 'STUNT BONUS' && t0.last.clean && t0.last.air >= 0.8 && t0.last.dist < 30 && t0.last.height < 4, 'a 0.9 s jump with no criteria: STUNT BONUS');
  ok(t0.last && t0.paid === t0.last.pay && t0.last.pay === Math.round((t0.last.dist * 10 + 50) / 10) * 10, `paid $10/m + $50 into the wallet ($${t0.paid})`);
  ok(t0.live && t0.maxLive >= 0.8, `the live AIRTIME readout came up after 0.8 s (read ${t0.maxLive} s)`);
  ok(/STUNT BONUS/.test(t0.big) && /\+\$/.test(t0.big), `the big readout on landing: "${t0.big}"`);
  const t1 = await jump('double', { speed: 46, vy: 10.5 });
  ok(t1.last && t1.last.name === 'DOUBLE STUNT' && t1.last.dist >= 30 && t1.last.height < 4, 'distance >= 30 m: DOUBLE STUNT');
  ok(t1.last && t1.paid === Math.round((t1.last.dist * 10 + 150) / 10) * 10, `paid $10/m + $150 ($${t1.paid})`);
  const t2 = await jump('triple', { speed: 34, vy: 14 });
  ok(t2.last && t2.last.name === 'TRIPLE STUNT' && t2.last.height >= 4 && t2.last.dist >= 30, 'distance and height >= 4 m: TRIPLE STUNT');
  const t3 = await jump('quadruple', { speed: 30, vy: 22, mode: 'flight', steer: -1 });
  ok(t3.last && t3.last.name === 'QUADRUPLE STUNT' && t3.last.spins >= 1 && t3.last.flips === 0, 'a real in-air spin (stuntAir\'s steering) on top: QUADRUPLE STUNT');
  ok(t3.last && t3.paid === Math.round((t3.last.dist * 10 + 800) / 10) * 10, `paid $10/m + $800 ($${t3.paid})`);
  const t4 = await jump('warrior', { speed: 30, vy: 22, mode: 'flight', steer: -1, flip: 2 * Math.PI / 2.2 });
  ok(t4.last && t4.last.name === 'WATERLOO WARRIOR' && t4.last.flips >= 1 && t4.last.spins >= 1 && t4.last.clean, 'and a full roll: WATERLOO WARRIOR');
  // (information: how much the follow path's own steering spins a car in the air off a crest)
  await jump('follow, full steer (info)', { speed: 30, vy: 16, steer: -1 });
  const bike = await jump('bicycle', { type: 'bicycle', speed: 12, vy: 10 });
  ok(bike.last && bike.last.clean && bike.paid > 0, `a bicycle counts (${bike.last && bike.last.name}, $${bike.paid})`);
  const quad = await jump('quad', { type: 'atv', speed: 32, vy: 11 });
  ok(quad.last && quad.last.clean && quad.last.name === 'DOUBLE STUNT', `a quad counts (${quad.last && quad.last.name})`);

  console.log('--- failed landings');
  const roof = await jump('roof', { speed: 30, vy: 12, roof: true });
  ok(roof.last && !roof.last.clean && roof.last.why === 'landed on the roof' && roof.paid === 0, 'a roof landing fails and pays nothing');
  ok(/STUNT FAILED/.test(roof.big), `"${roof.big}"`);
  if (SHOTS) await shot('fail');
  const wet = await J(`(() => { const j = window.__dbg.stunts.list.find((q) => q.id === 'dam'), r = j.ramp;
    return window.__at.jump({ x: r.x0 + r.dx * r.L, z: r.z0 + r.dz * r.L, h: Math.atan2(r.dx, r.dz), speed: 18, vy: 10 }); })()`);
  console.log(`  splash: ${JSON.stringify(wet.last)}`);
  ok(wet.last && !wet.last.clean && wet.last.why === 'splashdown' && wet.paid === 0, 'a jump into Laurel Creek Reservoir fails (splashdown) and pays nothing');

  console.log('--- the cheat rule');
  const save0 = JSON.stringify((await J(`window.__at.jump(${at({ speed: 14, vy: 10 })})`)).save);
  await ev(`(async () => { (await import(new URL('src/cheats.js', location.href).href)).CHEAT.on = true; return 1; })()`);
  const ch = await jump('cheated', { speed: 40, vy: 15 });
  await ev(`(async () => { (await import(new URL('src/cheats.js', location.href).href)).CHEAT.on = false; return 1; })()`);
  ok(ch.last && ch.last.clean && ch.last.cheated && ch.paid === 0, 'with CHEAT.on the jump is shown and pays nothing');
  ok(JSON.stringify(ch.save) === save0, 'and saves nothing');
  ok(/not counted/.test(ch.big), `"${ch.big}"`);

  console.log('--- a unique ramp jump (stunts.js) is not printed twice');
  const ramp = await J(`(() => { const d = window.__dbg, A = d.airtime; A.last = null; window.__at.hideBig();
    const m0 = d.game.money, n0 = window.__at.toasts.length;
    // __sj steps stunts.update but not airtime: wrap it so both run, in main.js's order
    const su = d.stunts.update.bind(d.stunts);
    d.stunts.update = (dt, pl) => { su(dt, pl); A.update(dt, pl); };
    let st;
    try {
      window.__sj.begin('fairview', { cap: 32 });
      for (let k = 0; k < 400 && (window.__sj.R.phase === 'run' || window.__sj.R.phase === 'air'); k++) window.__sj.step(30);
      st = window.__sj.status();
      // the settle window after touchdown (__sj stops stepping once it has landed)
      for (let k = 0; k < 90 && !A.last; k++) { window.__at.frame(1 / 60, 0, false); su(1 / 60, d.player); A.update(1 / 60, d.player); }
    } finally { d.stunts.update = su; }
    const big = document.getElementById('airBig');
    return JSON.stringify({ sj: st.res, at: A.last, paid: d.game.money - m0, toasts: window.__at.toasts.slice(n0),
      big: !!(big && big.classList.contains('show')), live: !!(document.getElementById('airLive') || {}).classList?.contains('show'),
      save: JSON.parse(localStorage.getItem('autokw-airtime') || 'null') }); })()`);
  console.log(`  stunts.js: ${JSON.stringify(ramp.sj && { dist: ramp.sj.dist, air: ramp.sj.air, pay: ramp.sj.pay, clean: ramp.sj.clean })}  airtime: ${JSON.stringify(ramp.at)}`);
  console.log(`  toasts: ${ramp.toasts.join(' | ')}`);
  ok(ramp.sj && ramp.sj.dist > 20, 'the Fairview ramp launched and stunts.js scored it');
  ok(ramp.at && ramp.at.ramp && !ramp.at.shown && ramp.at.pay === 0, 'airtime.js saw the flight as stunts.js\'s: silent, no pay');
  ok(ramp.paid === ramp.sj.pay, `the wallet moved by stunts.js's pay alone ($${ramp.paid} = $${ramp.sj.pay})`);
  ok(!ramp.big, 'no airtime readout over stunts.js\'s toast');
  ok(ramp.toasts.filter((t) => /STUNT JUMP \d/.test(t)).length === 1, 'exactly one stunt message (stunts.js\'s toast)');
  ok(!ramp.at || !ramp.at.clean || (ramp.save && ramp.save.n >= 1), 'its stats still count toward the bests');

  console.log('--- the live game loop (main.js calls airtime.update)');
  await ev(`(() => { const T = window.__at, d = window.__dbg, o = ${at({})}; T.hideBig(); const v = T.put('sedan', o.x, o.z, o.h);
    for (let i = 0; i < 4; i++) T.frame(1 / 60, 0, false);
    window.__liveM0 = d.game.money; d.game.paused = false; v.vLong = 14; v.y += 0.4; v.vy = 10; v.onGround = false; return 1; })()`);
  let liveRes = null;
  for (let i = 0; i < 80 && !liveRes; i++) { await sleep(250); liveRes = await J(`JSON.stringify(window.__dbg.airtime.last)`); }
  await ev('window.__dbg.game.paused = true; 1');
  ok(liveRes && liveRes.clean && liveRes.pay > 0, `a jump in the running game is judged by main.js's own loop (${liveRes && liveRes.name}, $${liveRes && liveRes.pay})`);

  console.log('--- the save and the passport');
  const sv = await J(`JSON.stringify(JSON.parse(localStorage.getItem('autokw-airtime')))`);
  console.log(`  autokw-airtime: ${JSON.stringify(sv)}`);
  ok(sv && sv.flips >= 1 && sv.spins >= 1 && sv.tier === 4 && sv.dist >= 30 && sv.height >= 4 && sv.air > 2, 'bests saved (longest, highest, most flips, best tier)');
  const fresh = await J(`(async () => { const { Airtime } = await import(new URL('src/airtime.js', location.href).href); const d = window.__dbg;
    return JSON.stringify(new Airtime({ game: d.game, hud: d.hud, audio: d.audio, stunts: d.stunts }).passportRows()); })()`);
  ok(fresh[0].label === 'Best stunt' && /^\d+\.\d s, \d+ m, \d+ flips?$/.test(fresh[0].text) && fresh[1].text === 'WATERLOO WARRIOR', `a fresh instance loads it: "${fresh[0].label}: ${fresh[0].text}", "${fresh[1].label}: ${fresh[1].text}"`);
  await ev(`(() => { const d = window.__dbg; d.game.paused = false; document.getElementById('pauseBtn').click(); return 1; })()`);
  await sleep(500);
  const pp = await ev(`[...document.querySelectorAll('#ppGrid .ppRow')].map((r) => r.innerText.replace(/\\s+/g, ' ')).filter((t) => /stunt/i.test(t)).join(' / ')`);
  ok(/Best stunt \d+\.\d s, \d+ m, \d+ flip/.test(pp), `the pause menu's passport: ${pp}`);
  if (SHOTS) { const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }); writeFileSync(`${OUT}/${tag}passport.jpg`, Buffer.from(result.data, 'base64')); console.log(`  shot ${OUT}/${tag}passport.jpg`); }
  await ev(`(() => { const b = document.getElementById('resumeBtn'); if (b) b.click(); window.__dbg.game.paused = true; return 1; })()`);

  if (SHOTS) {
    console.log('--- shots');
    await ev(`(() => { for (const id of ['toast']) { const e = document.getElementById(id); if (e) e.style.opacity = 0; } return 1; })()`);
    // mid-air with the live readout up (a spinning flight stopped at 1.15 s of air), then its landing
    await J(`(() => { const T = window.__at; T.hideBig(); const o = ${at({ speed: 26, vy: 16, mode: 'flight', steer: -0.6 })};
      const v = T.put(o.type || 'sedan', o.x, o.z, o.h); for (let i = 0; i < 4; i++) T.frame(1 / 60, 0, false);
      v.vLong = o.speed; v.y += 0.4; v.vy = o.vy; v.stunt = true; v.onGround = false;
      T.st = { o, money0: window.__dbg.game.money, t: 0, air: 0, phi: 0, maxLive: 0, live: false, done: false, v };
      return T.cont((S) => S.air > 1.15); })()`);
    await shot('midair');
    await J(`window.__at.cont()`);
    await shot('landed');
  }

  console.log(`\nexceptions: ${errs.length}${errs.length ? '\n  ' + errs.slice(0, 5).join('\n  ') : ''}`);
  ok(errs.length === 0, '0 page exceptions');
  console.log(fails ? `FAIL ${fails}` : 'PASS');
} catch (err) {
  console.log('ERROR', err.stack || err.message);
  fails++;
} finally { closing = true; chrome.kill(); }
process.exit(fails ? 1 : 0);
