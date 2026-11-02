// Auto KW: GTA-style cheat codes (src/cheats.js), end to end.
//
//   node tools/kw/cheatprobe.mjs [outdir]    (AUTO_GPU=1; AUTO_HTTP_PORT / AUTO_CDP_PORT)
//
// Types every code with REAL key events (CDP Input.dispatchKeyEvent) on foot and in a car and asserts the
// effect AND its cleanup (timed effects are expired by calling cheats.tick with a big dt); W still drives
// with a partial code buffered; random typing fires nothing; the phone path (5 taps on the pause footer,
// the Enter-code box); the GTA rule (eggs refused once cheated). Shots of four cheats. Exit 1 on failure.
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/cheatshots';
let closing = false, fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-cheat-profile-${PORT}`, width: 1280, height: 720, extra: ['--autoplay-policy=no-user-gesture-required'] });
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
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception');
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + (m.params.args || []).map((a) => a.value || a.description).join(' '));
    });
    const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
    const ev = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    };
    const until = async (js, secs = 5) => { const t0 = Date.now(); while (Date.now() - t0 < secs * 1000) { if (await ev(js)) return true; await sleep(150); } return false; };
    mkdirSync(OUT, { recursive: true });
    const shot = async (name) => {
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 78 });
      writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(result.data, 'base64'));
      console.log(`  shot ${OUT}/${name}.jpg`);
    };
    const key1 = (ch, down) => { const up = ch.toUpperCase(); const code = /[0-9]/.test(ch) ? 'Digit' + ch : 'Key' + up; const vk = up.charCodeAt(0);
      return send('Input.dispatchKeyEvent', down ? { type: 'keyDown', code, key: ch.toLowerCase(), text: ch.toLowerCase(), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }
        : { type: 'keyUp', code, key: ch.toLowerCase(), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
    const type = async (s) => { for (const ch of s) { await key1(ch, true); await key1(ch, false); } };

    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    let up = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.cheats)')) { up = true; break; }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
    console.log(`booted; exceptions at boot: ${errs.length}`);
    await sleep(3000);
    await ev(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); const r = document.getElementById('rotate'); if (r) r.style.display = 'none';
      if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); })()`);
    await sleep(800);
    const D = (e) => ev(`(() => { const d = window.__dbg, C = d.cheats, g = d.game; ${e} })()`);
    const STAGE = (car) => D(`const s = d.city.respawnPointNear(-1000, 300); d.player.respawn(s.x, s.z); g.paused = false; g.dead = false;
      if (d.player.vehicle && !d.player.onFoot) { const old = d.player.vehicle; d.player.exitVehicle(true); if (!old.cheatCar) d.traffic.remove(old); }
      ${car ? `const v = d.traffic.spawnAt(s.x, s.z, d.player.heading, 'sedan', 0x2255aa, 'free'); d.player.enterVehicle(v); v.vLong = 0;` : ''}
      d.world.update(s.x, s.z, 60); g.wanted = 0; g.points = 0; C.buf = ''; d.controls.tapped = null; return 1;`);
    const lastIs = (c) => D(`return C.last === '${c}'`);
    await D(`localStorage.removeItem('autokw-cheats'); sessionStorage.removeItem('autokw-cheated'); return 1;`);

    console.log('--- idle, false positives, W still drives');
    await STAGE(true); await sleep(600);
    ok(await D(`return C.fx.length === 0 && !C.timbits.live && C.log.length === 0 && !d.scene.getObjectByName('timbits')`), 'idle: nothing active, no timbit mesh');
    await type('qwrtyuiopzxcvbnm1234567890');
    await type('honktimbitpotholewinteris');   // near misses: TIMBIT, POTHOLE+S... none whole
    await type('hhonk');
    ok(await D(`return C.log.length === 0`), 'random typing and near-misses fire nothing (' + await D(`return C.buf`) + ')');
    // a partial code is buffered ("HONK"); hold W: the car drives
    await STAGE(true); await sleep(300);
    await type('honk');
    const x0 = await D(`return d.player.vehicle.x * 1e6 + d.player.vehicle.z`);
    const p0 = JSON.parse(await D(`return JSON.stringify([d.player.vehicle.x, d.player.vehicle.z])`));
    await key1('w', true); await sleep(5000);
    const p1 = JSON.parse(await D(`return JSON.stringify([d.player.vehicle.x, d.player.vehicle.z, d.player.vehicle.vLong])`));
    await key1('w', false);
    const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    ok(moved > 3, `W drove the car ${moved.toFixed(1)} m with HONK buffered`);
    ok(await D(`return C.log.length === 0 && C.buf.startsWith('HONKW')`), 'W did not clear or swallow the buffer (it sits as HONKW...)');
    await type('honk'); // HONKWHONK is not a code
    ok(await D(`return C.log.length === 0`), 'HONKW + HONK is not HONKHONK');

    // ---- every code, in a car and on foot --------------------------------------------------------
    console.log('--- DOUBLEDOUBLE');
    for (const car of [false, true]) {
      await STAGE(car); await D(`d.player.health = 20; if (!d.player.onFoot) d.player.vehicle.health = 10; return 1`);
      await type('doubledouble');
      ok(await D(`return C.last === 'DOUBLEDOUBLE' && d.player.health === 100`), `health restored (${car ? 'car' : 'foot'})`);
    }
    console.log('--- ROLLUPTHERIM / KWHEELS / BUGGYTIME (spawned cars)');
    await STAGE(false);
    await D(`window.__n0 = d.traffic.cars.length; return 1`);
    await type('uptherim');
    ok(await D(`const v = C.own[C.own.length - 1]; return C.last === 'UPTHERIM' && v && v.rollupPrize && v.mode === 'apron' && d.traffic.cars.includes(v) && Math.hypot(v.x - d.player.x, v.z - d.player.z) < 60 && v.bodyMat.color.getHex() === 0xc8102e`), 'a red Roll Up prize car near the player, in traffic');
    await type('buggytime');
    ok(await D(`const v = C.own[C.own.length - 1]; return C.last === 'BUGGYTIME' && v.typeName === 'buggy' && v.cheatCar && v.mode === 'apron'`), 'a horse and buggy');
    await sleep(500); await shot('buggytime');
    const types = new Set();
    for (let i = 0; i < 8; i++) { await type('kwheels'); types.add(await D(`return C.own[C.own.length - 1].typeName`)); }
    ok(types.size >= 2 && [...types].every((t) => ['delorean', 'zamboni', 'icecream', 'hearse', 'limo'].includes(t)), 'KWHEELS gave ' + [...types].join(', '));
    ok(await D(`return C.own.length <= 4 && C.own.every((v) => d.traffic.cars.includes(v)) && d.traffic.cars.filter((v) => v.cheatCar).length <= 4`), 'eleven spawned cars: at most four owned, the older ones removed from traffic (' + await D(`return C.own.length + ' owned, traffic +' + (d.traffic.cars.length - window.__n0)`) + ')');
    await D(`for (const v of C.own.slice()) C._drop(v); C.own.length = 0; return 1`);
    console.log('--- HONKHONK');
    await STAGE(true);
    await D(`window.__f0 = d.wildlife.formations.length; return 1`);
    await type('honkhonk');
    ok(await D(`return C.last === 'HONKHONK' && d.wildlife.formations.length >= window.__f0 + 2`), 'two V formations spawned');
    await D(`d.wildlife.sim(4); return 1`); await sleep(500); await shot('honkhonk');
    await D(`d.wildlife.sim(60); return 1`);
    console.log('--- TIMBITS');
    await STAGE(true);
    await type('boxoftimbits');
    ok(await D(`return C.last === 'BOXOFTIMBITS' && C.timbits.live && !!d.scene.getObjectByName('timbits') && C.active.includes('BOXOFTIMBITS')`), 'rain started: one InstancedMesh in the scene');
    await sleep(2500); await D(`C.tick(0.5); C.tick(0.5); C.tick(0.5); return 1`); console.log('  timbits live', await D(`return C.timbits.p.filter((q) => q.y > -9e3).length + ' y=' + C.timbits.p.filter((q) => q.y > -9e3).slice(0,3).map((q) => q.y.toFixed(1) + '@' + q.x.toFixed(0)) + ' player y=' + d.player.position.y`)); await sleep(400); await shot('timbits');
    await D(`C.tick(11); for (let i = 0; i < 40; i++) C.timbits.update(0.5, d.player.x, d.player.z, d.player.y); return 1`);
    ok(await D(`return !C.timbits.live && !d.scene.getObjectByName('timbits') && C.fx.length === 0`), 'after 10 s and the last bounce: mesh off the scene, effect gone');
    ok(await D(`return d.scene.children.every((c) => c.name !== 'timbits') && C.timbits.mesh.count === C.timbits.n`), 'one InstancedMesh, fixed count');
    console.log('--- WINTERISCOMING / GOLDENHOUR');
    await STAGE(false);
    await D(`window.__w0 = d.weather ? 1 : 0; return 1`);
    await type('winteriscoming');
    ok(await D(`const w = C.o.sys().weather; return C.last === 'WINTERISCOMING' && w.state === 'snow' && w.hold > 1e8`), 'weather is snow, held');
    await sleep(5000); await shot('winter');
    await D(`C.tick(200); return 1`);
    ok(await D(`const w = C.o.sys().weather; return w.hold < 1e8 && C.fx.length === 0 && w.setting === 'auto'`), 'after 90 s the hold is released: back to auto weather');
    const t0 = await D(`return C.o.sys().tod.mode`);
    await type('amberhour');
    ok(await D(`const t = C.o.sys().tod; return C.last === 'AMBERHOUR' && t.mode === 'dusk'`), 'time of day is dusk (was ' + t0 + ')');
    await sleep(2500); await shot('goldenhour');
    await D(`C.tick(500); return 1`);
    ok(await D(`const t = C.o.sys().tod; return t.mode === t.setting && C.fx.length === 0`), 'restored to the player\'s setting (' + await D(`return C.o.sys().tod.mode`) + ')');
    console.log('--- one-shot action letters are not fired mid-word');
    await STAGE(true);
    await ev(`window.__seen = {}; window.addEventListener('keydown', (e) => { window.__seen[e.code] = (window.__seen[e.code] || 0) + 1; }); 0`);
    await type('bumpyroad');
    ok(await ev(`!window.__seen.KeyP && !window.__seen.KeyR && window.__seen.KeyB && window.__seen.KeyU`), 'P and R inside BUMPYROAD never reached the game; B, U did: ' + await ev(`JSON.stringify(window.__seen)`));
    await ev(`window.__seen = {}; 0`);
    await type('p'); await sleep(400); await type('p'); await sleep(400); await type('e');
    ok(await ev(`window.__seen.KeyP === 2 && window.__seen.KeyE === 1`), 'a lone P and E (no live prefix) pass through untouched');
    await STAGE(true);
    await type('doubledouble');
    ok(await D(`return !d.player.onFoot && C.last === 'DOUBLEDOUBLE'`), 'DOUBLEDOUBLE did not get you out of the car (its E keys were swallowed)');
    console.log('--- POTHOLE / IONSPEED');
    await STAGE(true);
    await D(`const p = d.player; const o = d.traffic.spawnAt(p.x + 25, p.z, 0, 'sedan', 0xaa3322, 'free'); o.vLong = 5; window.__o = o; return 1`);
    await type('bumpyroad');
    await D(`for (let i = 0; i < 20; i++) C.tick(0.1); return 1`);
    ok(await D(`return C.active.includes('BUMPYROAD') && window.__o.yVis > 0 && d.player.vehicle.yVis === 0`), 'a moving AI car bounces (yVis ' + (await D(`return window.__o.yVis.toFixed(2)`)) + '), yours does not');
    await D(`C.tick(60); return 1`);
    ok(await D(`return C.fx.length === 0 && d.traffic.cars.every((v) => !v.yVis)`), 'after 30 s every car is flat again');
    await type('ionspeed');
    ok(await D(`return C.last === 'IONSPEED' && d.link.boostK === 3`), 'ION clock x3');
    await D(`C.tick(100); return 1`);
    ok(await D(`return d.link.boostK === 1 && C.fx.length === 0`), 'after 60 s ION is back to 1x');
    console.log('--- NOFUN / WANTEDLEVEL5 / PINKTIE');
    await STAGE(true);
    await type('wantedlevel5');
    ok(await D(`return g.wanted === 5`), 'wanted level 5');
    await type('unwanted');
    ok(await D(`return g.wanted === 0 && g.points === 0`), 'NOFUN clears it');
    await type('waterloopink');
    ok(await D(`return C.last === 'WATERLOOPINK' && d.player.vehicle.bodyMat.color.getHex() === 0xf0589c`), 'the car is engineering pink');
    await sleep(900); await shot('pinktie');
    const n1 = await D(`return C.log.length`);
    await STAGE(false); await type('waterloopink');
    ok(await D(`return C.log.length === ${n1}`), 'PINKTIE on foot is refused and not counted');

    console.log('--- GTA rule, storage, menu');
    ok(await D(`return sessionStorage.getItem('autokw-cheated') === '1' && JSON.parse(localStorage.getItem('autokw-cheats')).length === 13`), 'session marked; 13/13 found saved');
    ok(await D(`const s = d.eggs.spots[0]; return d.eggs.collect(s) === false && !s.got`), 'a golden egg is refused while cheated');
    ok(await D(`return g.holds.size === 0 && g.leaks.length === 0`), 'no hold taken, none leaked');
    await ev(`document.getElementById('pauseBtn').click()`); await sleep(1500);
    const rows = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#ppGrid .ppRow')].map((r) => r.textContent))`));
    ok(rows.some((r) => /Codes found13\/13/.test(r)) && rows.some((r) => /DOUBLEDOUBLE/.test(r)), 'passport: Codes found 13/13 and the list');
    await shot('pause-codes');

    console.log('--- phone path');
    await ev(`localStorage.removeItem('autokw-cheats'); window.__dbg.cheats.found.clear(); 0`);
    await STAGE(false); await D(`g.wanted = 0; return 1`);
    await ev(`document.getElementById('pauseBtn').click()`); await sleep(800);
    ok(await ev(`document.getElementById('cheatBox').style.display === 'none'`), 'code box hidden at first');
    await ev(`for (let i = 0; i < 4; i++) document.getElementById('cheatFoot').click(); 0`);
    ok(await ev(`document.getElementById('cheatBox').style.display === 'none'`), 'four taps: still hidden');
    await ev(`document.getElementById('cheatFoot').click(); 0`);
    ok(await ev(`document.getElementById('cheatBox').style.display === 'block'`), 'five taps: the Enter-code box opens');
    await ev(`document.getElementById('cheatIn').value = 'xyzzy'; document.getElementById('cheatGo').click(); 0`);
    ok(await ev(`/Nothing/.test(document.getElementById('cheatMsg').textContent) && window.__dbg.cheats.log.length === window.__dbg.cheats.log.length`) && await D(`return !C.found.size`), 'a wrong code does nothing');
    await D(`g.setWanted(3); return 1`);
    await ev(`document.getElementById('cheatIn').value = 'unwanted'; document.getElementById('cheatGo').click(); 0`);
    ok(await until(`window.__dbg.cheats.found.has('UNWANTED')`), 'NOFUN entered in the box fires');
    ok(await D(`return g.wanted === 0 && !g.paused`), 'wanted cleared and the game resumed');

    const ex = errs.filter((e) => !/favicon/.test(e));
    ok(ex.length === 0, `no page exceptions${ex.length ? ': ' + ex.slice(0, 3).join(' | ') : ''}`);
    closing = true;
  } finally {
    chrome.kill('SIGKILL');
  }
  console.log(fails ? `FAILED ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);

}
main().catch((e) => { console.error('cheatprobe failed:', e.message); process.exit(1); });
