// Auto KW: the body shops (respray.js) and the paramedic calls (paramedic.js), end to end.
//
//   node tools/kw/medprobe.mjs [outdir] [respray,medic]    (AUTO_GPU=1; AUTO_HTTP_PORT / AUTO_CDP_PORT)
//
// Boots like jobsprobe.mjs (service worker bypassed, __noAutoQuality), leaves the game RUNNING and
// plays it: cars are placed at the doors / patients and the real frame loop does the rest, with the
// ambulance's call started by a real KeyM press and the first respray reached by driving in on real
// W presses. Asserts (exit 1 on a failure or a page exception):
//   respray: the colour changes on THIS car only (a twin's bodyMat is another object and unchanged),
//     health back to full and the dents gone, money charged by price(), the first one free, a poor
//     player does not trigger it, wanted cleared when police.seen is false and NOT when it is true.
//   medic: M starts a call, the patients stand on open ground (not in a building or water) with a
//     street within 70 m, stopping beside one loads it, driving it to an ER pays and the pay matches
//     health, a crash costs the loaded patient health, the clock ends a call, a cleared call
//     raises the level.
// Shots: shop, door closing, the black screen, ambulance, pickup, drop-off.

import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/medshots';
const ONLY = (process.argv[3] || 'respray,medic').split(',');
let closing = false, fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-med-profile-${PORT}`, width: 1280, height: 720, extra: ['--autoplay-policy=no-user-gesture-required'] });
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
    mkdirSync(OUT, { recursive: true });
    const shot = async (name) => {
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
      writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(result.data, 'base64'));
      console.log(`  shot ${OUT}/${name}.jpg`);
    };
    const KEYS = { w: ['KeyW', 'w', 87], m: ['KeyM', 'm', 77] };
    const key = (k, down) => { const [code, kk, vk] = KEYS[k]; return send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: kk, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
    const until = async (js, secs) => { const t0 = Date.now(); while (Date.now() - t0 < secs * 1000) { if (await ev(js)) return true; await sleep(150); } return false; };

    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    let up = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.respray && window.__dbg.paramedic)')) { up = true; break; }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
    console.log(`booted; exceptions at boot: ${errs.length}`);
    await sleep(3000);
    await ev(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); const r = document.getElementById('rotate'); if (r) r.style.display = 'none';
      if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); })()`);
    await sleep(800);

    // helpers in the page
    await ev(`window.__h = {
      // a car at bay-local (lx, lz) facing into the bay (+) or out (-), the player in it
      put(i, lx, lz, dir, type, speed) {
        const d = window.__dbg, q = d.respray.sites[i], s = q.s, cr = Math.cos(s.rot), sr = Math.sin(s.rot);
        const x = s.ox + lx * cr - lz * sr, z = s.oz + lx * sr + lz * cr;
        let v = d.player.vehicle;
        if (!v || v.typeName !== type) { v = d.traffic.spawnAt(x, z, 0, type, 0x2255aa, 'free'); d.player.enterVehicle(v); }
        v.place(x, z, Math.atan2(dir * s.nx, dir * s.nz));
        v.vLong = speed || 0; v.spin = 0; v.slide = 0; v.vy = 0; v.dead = false;
        d.world.update(x, z, 60);
        return v;
      },
      deskew(v) { v.health = 40; v.dent(v.x + v.forward.x * 2, v.z + v.forward.z * 2, 22); v.dent(v.x - v.forward.z * 1, v.z + v.forward.x * 1, 16); },
    }`);

    if (ONLY.includes('respray')) {
      console.log('--- respray');
      const info = await ev(`JSON.stringify(window.__dbg.respray.sites.map((q) => [q.shop.name, q.s.slope]))`);
      console.log('  sites', info);
      const R = (e) => ev(`(() => { const d = window.__dbg, R = d.respray; ${e} })()`);
      // 1: drive in on real keys. Wanted 3, nobody sees; first one is free (stats.n = 0).
      await R(`R.stats.n = 0; d.game.money = 300; d.game.setWanted(3); d.police.clear(); Object.defineProperty(d.police, 'seen', { get: () => false, set() {}, configurable: true }); d.game.paused = false;
        const v = window.__h.put(0, 0, -9, 1, 'sedan', 0); window.__h.deskew(v);
        window.__twin = d.traffic.spawnAt(v.x + 40, v.z + 40, 0, 'sedan', 0x2255aa, 'parked');
        window.__t = { col0: v.color, hp0: v.health, dents0: v.dents };
        window.__t.twinCol = window.__twin.bodyMat.color.getHex(); window.__t.matSame = window.__twin.bodyMat === v.bodyMat;`);
      await sleep(600);
      await shot('shop-front');
      await key('w', true);
      const entered = await until(`window.__dbg.respray.active`, 40);
      await key('w', false);
      ok(entered, 'driving in on W started the sequence');
      ok(await ev(`window.__dbg.game.held`), 'the world is held during it');
      await until(`window.__dbg.respray.seq && window.__dbg.respray.seq.t > 0.5`, 20);
      await shot('door-closing');
      await until(`window.__dbg.respray.seq && window.__dbg.respray.seq.t > 2.0`, 30);
      await shot('spray-black');
      await until(`!window.__dbg.respray.active`, 60);
      const a = await R(`const v = d.player.vehicle, t = window.__t; return JSON.stringify({ col: v.color, bodyCol: v.bodyMat.getHex ? 0 : v.bodyMat.color.getHex(), hp: v.health, dents: v.dents, wanted: d.game.wanted, money: d.game.money, last: R.last, twinCol: window.__twin.bodyMat.color.getHex(), held: d.game.held, lz: R.local(R.sites[0], v.x, v.z).lz });`);
      const A = JSON.parse(a); const t0 = JSON.parse(await ev('JSON.stringify(window.__t)'));
      ok(A.col !== t0.col0 && A.bodyCol === A.col, `colour changed 0x${t0.col0.toString(16)} -> 0x${A.col.toString(16)} on this car`);
      ok(A.twinCol === t0.twinCol && !t0.matSame, 'a twin car keeps its own paint (separate material, unchanged)');
      ok(A.hp === 100 && A.dents === 0 && t0.dents0 > 0 && t0.hp0 < 100, `damage repaired (health ${t0.hp0} -> ${A.hp}, dents ${t0.dents0} -> ${A.dents})`);
      ok(A.money === 300, 'the first respray is free');
      ok(A.wanted === 0, 'nobody saw: wanted level cleared');
      ok(!A.held, 'the hold is released'); ok(A.lz < 4.5, `the car is turned out and parked near the mouth (lz ${A.lz.toFixed(1)})`);
      await sleep(300); await shot('after-respray');
      console.log('  state', await R(`return JSON.stringify({ veh: !!d.player.vehicle, foot: d.player.onFoot, dead: d.game.dead, hp: d.player.hp, wanted: d.game.wanted })`));
      // 2: charged, and seen: the stars stay (the lock lifts when you drive away)
      await R(`window.__h.put(0, 0, -30, -1, 'sedan', 0)`); await sleep(1200);
      await R(`d.game.money = 300; d.game.setWanted(3); d.player.vehicle.health = 55;
        Object.defineProperty(d.police, 'seen', { get: () => true, set() {}, configurable: true });
        window.__t.price = R.price(d.player.vehicle); const v = window.__h.put(0, 0, 6.2, 1, 'sedan', 3);`);
      await until(`window.__dbg.respray.active`, 30);
      await until(`!window.__dbg.respray.active`, 60);
      const b = JSON.parse(await R(`return JSON.stringify({ money: d.game.money, wanted: d.game.wanted, price: window.__t.price, n: R.stats.n, hp: d.player.vehicle.health })`));
      ok(b.price > 0 && b.money === 300 - b.price, `second respray charged ${b.price}`);
      ok(b.wanted >= 3, 'a cop saw you in: the stars stay');
      ok(b.hp === 100, 'repaired again');
      await R(`delete d.police.seen; d.police.seen = false; d.game.wanted = 0; d.game.points = 0; d.police.clear(); d.game.dead = false;`);
      // 3: too poor
      await R(`window.__h.put(0, 0, -30, -1, 'sedan', 0)`); await sleep(1200);
      await R(`d.game.money = 5; window.__h.put(0, 0, 6.2, 1, 'sedan', 2);`);
      await sleep(2500);
      ok(!(await ev('window.__dbg.respray.active')), 'a poor player does not trigger it');
      // 4: too big (a bus): the roller door is down and a solid
      await R(`d.game.money = 500; const v = window.__h.put(0, 0, -8, 1, 'bus', 0);`);
      await sleep(2500);
      const dk = JSON.parse(await R(`const q = R.sites[0]; return JSON.stringify({ k: q.k, solid: q.door.y1 > q.s.y, active: R.active })`));
      ok(dk.k > 0.9 && dk.solid && !dk.active, 'a bus finds the door shut and is not taken in');
      await R(`d.player.vehicle.dead = true; d.player.exitVehicle(true);`);
      // one more shop, the exterior of each
      for (let i = 1; i < 4; i++) {
        await R(`window.__h.put(${i}, 0, -8, 1, 'sedan', 0); d.player.vehicle.dead = false;`);
        await sleep(1500); await shot(`shop-${i}`);
      }
    }

    if (ONLY.includes('medic')) {
      console.log('--- medic');
      const M = (e) => ev(`(() => { const d = window.__dbg, P = d.paramedic; ${e} })()`);
      await M(`d.game.setWanted(0); d.game.money = 100; d.game.paused = false;
        const st = P.stations[0], v = st.rigVs[0]; if (d.player.vehicle) d.player.exitVehicle(true); d.player.enterVehicle(v); window.__a = v;`);
      await sleep(4000);
      ok(await ev(`window.__dbg.paramedic.stations.every((s) => s.rigVs.length === 1 && s.rigVs[0].typeName === 'ambulance')`), 'an ambulance on the apron at each of the four stations');
      ok(await ev(`document.getElementById('app').dataset.medic === '1'`), 'the MISSION button shows in the ambulance');
      await shot('ambulance');
      await key('m', true); await sleep(150); await key('m', false);
      ok(await until(`!!window.__dbg.paramedic.call`, 10), 'M starts a call');
      const C = JSON.parse(await M(`const C = P.call; return JSON.stringify({ n: C.pts.length, T: C.T, siren: window.__a.sirenOn, pts: C.pts.map((q) => ({ x: q.x, z: q.z, addr: q.addr, bld: d.city.insideBuilding(q.x, q.z, d.city.groundAt(q.x, q.z, null), 0.3), wet: d.G.isWater(q.x, q.z), road: !!d.city.respawnPointNear(q.x, q.z, 70) })) });`));
      console.log('  call', JSON.stringify(C).slice(0, 300));
      ok(C.n === 1 && C.siren, 'level 1 is one patient, siren on');
      ok(C.pts.every((q) => !q.bld && !q.wet && q.road), 'the patient is on open ground with a street within 70 m');
      // drive to the patient: placed 40 m off, then the ambulance stops beside
      await M(`const q = P.call.pts[0], v = window.__a; v.place(q.x - 7, q.z, Math.atan2(1, 0)); v.vLong = 0; d.world.update(q.x, q.z, 60);`);
      await sleep(1200); await shot('patient-pickup');
      ok(await until(`window.__dbg.paramedic.call && window.__dbg.paramedic.call.loaded.length === 1`, 40), 'stopped beside the patient: loaded');
      // rough driving hurts: a crash
      const h0 = +(await M(`return P.call.loaded[0].health`));
      await M(`P.onCrash(20)`);
      const h1 = +(await M(`return P.call.loaded[0].health`));
      ok(h1 < h0 - 20, `a crash costs the patient health (${h0.toFixed(0)} -> ${h1.toFixed(0)})`);
      // to the ER
      const money0 = +(await M(`return d.game.money`));
      await M(`const e = P.call.er, v = window.__a; v.place(e.x + 8, e.z, Math.atan2(-1, 0)); v.vLong = 0; d.world.update(e.x, e.z, 60);`);
      await sleep(1000); await shot('hospital-dropoff');
      ok(await until(`window.__medLast && window.__medLast.n === 1`, 40), 'delivered to the emergency entrance');
      const D = JSON.parse(await M(`return JSON.stringify({ money: d.game.money, last: window.__medLast, call: !!P.call, nextT: P.nextT, level: P.level })`));
      const exp = Math.round(125 * (0.4 + 0.6 * h1 / 100));
      ok(D.money - money0 >= D.last.pay && Math.abs(D.last.pay - exp) <= 3, `paid ${D.last.pay} for a patient at ${h1.toFixed(0)}% (expect ~${exp})`);
      ok(D.level === 2 && D.nextT > 0, 'the cleared call raises the level (and dispatches the next)');
      ok(D.last.left > 0, 'the clock was still running when delivered');
      // level 2: two patients; then the clock
      await M(`P.nextT = 0.05;`);
      ok(await until(`window.__dbg.paramedic.call && window.__dbg.paramedic.call.pts.length === 2`, 15), 'level 2 calls two patients');
      await M(`P.call.left = 0.2;`);
      ok(await until(`!window.__dbg.paramedic.call && window.__dbg.paramedic.nextT === 0`, 10), 'the clock running out ends the shift');
      ok(await M(`return JSON.parse(localStorage.getItem('autokw-paramedic')).best >= 1`), 'best level saved in autokw-paramedic');
    }

    ok(errs.length === 0, `no page exceptions${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
    closing = true;
  } finally {
    chrome.kill('SIGKILL');
  }
  console.log(fails ? `FAILED ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('medprobe failed:', e.message); process.exit(1); });
