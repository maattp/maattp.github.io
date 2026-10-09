// Taxi fares (apps/auto/src/taxi.js): the acceptance probe.
//
//   node tools/taxicheck.mjs [--desktop] [--shots DIR]
//
// Boots the game headlessly (the iPhone landscape profile unless --desktop),
// puts the player in a taxi on a street in Belltown and drives the whole job
// through `__dbg.taxi` at fixed dt with the game paused (the real loop
// idles; this steps traffic, pedestrians and the taxi by hand, so nothing
// depends on SwiftShader's frame rate):
//   FARE shows in a taxi and not in a sedan; pressing it hails a pedestrian
//   within 300 m, with a pillar and a map mark; pulling up and stopping beside
//   them boards them (they leave the crowd); the destination is a named place
//   with a route >= 500 m, and the fare is base + per-km of that route; the
//   drop-off pays fare + tip (money rises by >= the fare, the count goes up
//   and survives a reload); a crash mid-fare cuts the tip; leaving the taxi,
//   dying, three stars and the fare clock each end it with no payout and
//   nothing left behind (pillar, objective, map marks, passenger).
// With --shots it also writes a street-level frame of the hail and of the
// drop-off. Needs `python3 -m http.server $AUTO_HTTP_PORT` from the repo root.
import { launchChrome } from './chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9222;
const URL_BASE = process.env.AUTO_URL || `http://localhost:${HTTP_PORT}/apps/auto/`;
const DESKTOP = process.argv.includes('--desktop');
const si = process.argv.indexOf('--shots');
const SHOTS = si > 0 ? process.argv[si + 1] : null;

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-taxi-profile-${PORT}`, width: 1280, height: 720 });
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
    for (let i = 0; i < (+process.env.TAXI_BOOT_S || 300) * 2; i++) {
      await sleep(500);
      if (await ev('!!(window.__dbg && window.__dbg.taxi && window.__dbg.career)', false)) return;
    }
    throw new Error('never booted: ' + logs.slice(-5).join(' | '));
  };
  const shot = async (name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64'));
  };

  await boot();
  await ev('window.scrollTo(0, 0), true', false);

  // The harness inside the page: fixed-dt stepping of everything a fare touches.
  await ev(`(() => {
    const d = __dbg, P = d.player, T = d.traffic, X = d.taxi, game = d.game;
    const H = window.__tx = {};
    game.paused = true;
    H.step = (n, dt = 1 / 30) => {
      for (let i = 0; i < n; i++) {
        const p = P.position;
        T.update(dt, p.x, p.z, { x: Math.sin(P.camYaw + Math.PI), z: Math.cos(P.camYaw + Math.PI) }, P);
        d.peds.update(dt, p.x, p.z, P, T);
        X.update(dt, P);
      }
    };
    // a taxi stopped in the middle of the street nearest (x, z), facing along it
    H.taxiAt = (x, z, type = 'taxi') => {
      if (P.vehicle) P.exitVehicle(true);
      const ni = d.city.nearestNode(x, z, 400), n = d.city.nodes[ni];
      let e = null;
      for (const ei of n.e) { const c = d.city.edges[ei]; if (!c.elev && !c.tunnel && c.cls !== 'hwy' && c.cls !== 'ramp') { e = c; break; } }
      const h = Math.atan2(e.dx, e.dz);
      const v = T.spawnAt(n.x, n.z, h, type, 0xf0b40c, 'free');
      v.vLong = 0;
      P.respawn(n.x, n.z);
      for (let i = 0; i < 12; i++) d.world.update(n.x, n.z, 2);
      P.enterVehicle(v);
      return v;
    };
    H.place = (v, x, z, h) => { v.x = x; v.z = z; if (h !== undefined) v.heading = h; v.vLong = 0; v.vLat = 0; v.y = d.city.groundAt(x, z, v.y); v.sync(); P.x = x; P.z = z; for (let i = 0; i < 4; i++) d.world.update(x, z, 2); if (h !== undefined) P.camYaw = h + Math.PI; for (let i = 0; i < 90; i++) P.updateCamera(1 / 30, null); };
    H.leftovers = () => ({
      fareFlag: d.peds.peds.filter((p) => p.fare).length,
      mark: X.mark.visible, hudFare: !!d.hud.fare, run: !!X.run, on: X.on,
      obj: d.hud.objective ? d.hud.objective.textContent : '',
    });
    return true;
  })()`, false);

  const BELLTOWN = [-560, -210];
  const startTaxi = (x = BELLTOWN[0], z = BELLTOWN[1]) => ev(`(() => { const v = __tx.taxiAt(${x}, ${z}); __tx.step(2); return { x: v.x, z: v.z }; })()`, false);

  // ---- FARE shows in a taxi, not in a sedan -------------------------------
  await ev(`(__tx.taxiAt(${BELLTOWN[0]}, ${BELLTOWN[1]}, 'sedan'), __tx.step(2), true)`, false);
  const btnSedan = await ev(`getComputedStyle(document.querySelector('[data-btn="taxifare"]')).display`, false);
  check(btnSedan === 'none', `FARE is hidden in a sedan (display ${btnSedan})`);
  await ev(`(__dbg.taxi.toggle(__dbg.player), true)`, false);
  check(!(await ev('__dbg.taxi.on', false)), 'FARE does nothing in a sedan');
  await startTaxi();
  const btnTaxi = await ev(`getComputedStyle(document.querySelector('[data-btn="taxifare"]')).display`, false);
  check(btnTaxi !== 'none', `FARE shows in a taxi (display ${btnTaxi})`);
  const cop = await ev(`getComputedStyle(document.querySelector('[data-btn="policemission"]')).display`, false);
  check(cop === 'none', 'the police MISSION button stays hidden in a taxi');

  // ---- press FARE: a ped hails within 300 m --------------------------------
  const money0 = await ev('__dbg.game.money', false);
  const fares0 = await ev('__dbg.taxi.stats.fares', false);
  let objBefore = await ev('__dbg.hud.objective.textContent', false);
  await ev(`(__dbg.taxi.toggle(__dbg.player), __tx.step(3), true)`, false);
  const h = await ev(`(() => {
    const X = __dbg.taxi, r = X.run, v = __dbg.player.vehicle;
    const ped = r && r.ped;
    return { stage: r && r.stage, d: ped ? Math.hypot(ped.x - v.x, ped.z - v.z) : -1, flag: ped ? ped.fare : -1,
      inList: ped ? __dbg.peds.peds.includes(ped) : false, mark: X.mark.visible, hud: __dbg.hud.fare && !!__dbg.hud.fare.hail,
      obj: __dbg.hud.objective.textContent, btn: document.querySelector('[data-btn="taxifare"]').classList.contains('on') };
  })()`, false);
  check(h.stage === 'hail' && h.inList && h.flag === 1, `FARE hails a pedestrian (stage ${h.stage}, fare flag ${h.flag})`);
  check(h.d > 0 && h.d <= 300, `the hail is ${Math.round(h.d)} m away (<= 300)`);
  check(h.mark && h.hud, 'a pillar and a map mark are on the hailing ped');
  check(/fare waiting/i.test(h.obj), `the objective says so: "${h.obj}"`);
  check(h.btn, 'FARE lights while on shift');
  await ev(`(() => { const r = __dbg.taxi.run, p = r.ped, e = __dbg.city.edges[p.edge]; const v = __dbg.player.vehicle;
    // 24 m short of them down the street, so the shot has the road ahead and the person in it
    __tx.place(v, p.fx - e.dx * 13 * Math.sign((p.fx - v.x) * e.dx + (p.fz - v.z) * e.dz || 1), p.fz - e.dz * 13 * Math.sign((p.fx - v.x) * e.dx + (p.fz - v.z) * e.dz || 1), Math.atan2(e.dx, e.dz) + (((p.fx - v.x) * e.dx + (p.fz - v.z) * e.dz) < 0 ? Math.PI : 0));
    return true; })()`, false);
  if (SHOTS) {
    await ev(`(() => { __dbg.game.paused = false; return true; })()`, false);
    await sleep(2500);
    await ev(`(() => { __dbg.game.paused = true; __tx.step(1); return true; })()`, false);
    await sleep(800);
    await shot('hail');
  }

  // ---- pull up beside them and stop: they board ---------------------------
  await ev(`(() => { const r = __dbg.taxi.run, p = r.ped, e = __dbg.city.edges[p.edge], v = __dbg.player.vehicle;
    __tx.place(v, p.fx, p.fz, Math.atan2(e.dx, e.dz)); return true; })()`, false);
  await ev('__tx.step(24)', false);
  const mid = await ev('__dbg.taxi.run && __dbg.taxi.run.walking', false);
  check(mid === true, 'stopped beside them: they start to walk to the car');
  await ev('__tx.step(300)', false);
  const b = await ev(`(() => { const X = __dbg.taxi, r = X.run; return r ? { stage: r.stage, dest: r.dest && r.dest.name, m: r.m, fare: r.fare, par: r.par, limit: r.limit,
    ped: r.ped, flags: __dbg.peds.peds.filter((p) => p.fare).length, route: __dbg.hud.fare && __dbg.hud.fare.route && __dbg.hud.fare.route.length / 2,
    payM: r.payM, dx: r.dest.x - __dbg.player.vehicle.x, dz: r.dest.z - __dbg.player.vehicle.z, destPin: !!(__dbg.hud.fare && __dbg.hud.fare.dest), mark: X.mark.visible, obj: __dbg.hud.objective.textContent, named: r.dest && /\\w{3}/.test(r.dest.name) } : null; })()`, false);
  check(b && b.stage === 'ride' && b.ped === null && b.flags === 0, `they boarded (stage ${b && b.stage}) and left the crowd (${b && b.flags} fare peds)`);
  check(b && b.m >= 500 && b.route >= 4, `the destination "${b && b.dest}" is ${Math.round(b && b.m)} m of route (${b && b.route} nodes)`);
  const exp = await ev(`(async () => { const T = await import('/apps/auto/src/taxi.js'); return T.fareFor(${b ? b.m : 0}, ${b ? b.payM : 0}); })()`);
  check(b && b.fare === exp.fare && b.fare >= 70 + 210 * b.payM / 1000 - 1 && b.payM <= 1.6 * Math.hypot(b.dx, b.dz) + 1, `the fare is base + per-km of the route: $${b && b.fare} (par ${Math.round(b && b.par)} s, limit ${Math.round(b && b.limit)} s)`);
  check(b && b.destPin && b.mark, 'the destination has a pillar and a map pin, and the route is drawn');
  check(b && /Taxi/.test(b.obj), `the objective follows the ride: "${b && b.obj}"`);

  if (SHOTS) {
    // the route on the minimap (the car 40 m along it), then on the full map
    await ev(`(() => { const r = __dbg.taxi.run, v = __dbg.player.vehicle; const q = r.route; const k = Math.min(q.length / 2 - 1, 6) * 2; __tx.place(v, q[k], q[k + 1], v.heading); __dbg.game.paused = false; return true; })()`, false);
    await sleep(2500);
    await ev(`(() => { __dbg.game.paused = true; return true; })()`, false);
    await shot('ride-minimap');
    await ev(`(() => { document.getElementById('mapOverlay').classList.add('show'); __dbg.game.mapOpen = true; __dbg.hud.drawBigMap(__dbg.player, __dbg.game); return true; })()`, false);
    await sleep(600);
    await shot('ride-bigmap');
    await ev(`(() => { document.getElementById('mapOverlay').classList.remove('show'); __dbg.game.mapOpen = false; return true; })()`, false);
  }

  // ---- a clean ride pays fare + tip -----------------------------------------
  const pickTip = await ev('__dbg.taxi.tipNow(__dbg.taxi.run)', false);
  await ev(`(() => { const r = __dbg.taxi.run, v = __dbg.player.vehicle; __tx.place(v, r.dest.x - 40, r.dest.z, v.heading); return true; })()`, false);
  await ev('__tx.step(8)', false);
  check(await ev('!!__dbg.taxi.run && __dbg.taxi.run.stage === "ride"', false), 'driving up to the drop-off does not end the fare early');
  await ev(`(() => { const r = __dbg.taxi.run, v = __dbg.player.vehicle; __tx.place(v, r.dest.x + 3, r.dest.z + 3, v.heading); return true; })()`, false);
  if (SHOTS) {
    await ev(`(() => { __dbg.game.paused = false; return true; })()`, false);
    await sleep(500);
    await ev(`(() => { __dbg.game.paused = true; return true; })()`, false);
  }
  const m1 = await ev('__dbg.game.money', false);
  await ev('__tx.step(30)', false);
  const a = await ev(`(() => { const X = __dbg.taxi; return { money: __dbg.game.money, fares: X.stats.fares, last: X.last, run: !!X.run, mark: X.mark.visible, hudFare: !!__dbg.hud.fare,
    leavers: X.leavers.length, leaverFlag: X.leavers[0] ? X.leavers[0].p.fare : -1, saved: JSON.parse(localStorage.getItem('auto-taxi') || '{}').fares }; })()`, false);
  check(a.last && a.money - m1 >= a.last.fare && a.last.fare >= 70, `drop-off pays: money +$${a.money - m1} (fare $${a.last && a.last.fare}, tip $${a.last && a.last.tip}, bonus $${a.last && a.last.bonus})`);
  check(a.fares === fares0 + 1 && a.saved === fares0 + 1, `fare count ${fares0} -> ${a.fares}, saved ${a.saved}`);
  check(!a.run && !a.mark && !a.hudFare, 'the pillar and map marks are gone after the drop-off');
  check(a.leavers === 1 && a.leaverFlag === 2, 'the passenger got out and is walking off');
  const tipClean = a.last ? a.last.tip : 0;
  check(tipClean > 0 && tipClean <= 0.5 * a.last.fare + 1, `a clean, quick ride tips $${tipClean} (<= half the fare)`);
  if (SHOTS) {
    await ev(`(() => { __dbg.game.paused = false; return true; })()`, false);
    await sleep(1500);
    await ev(`(() => { __dbg.game.paused = true; return true; })()`, false);
    await sleep(600);
    await shot('dropoff');
  }
  await ev('(window.__leaver = __dbg.taxi.leavers[0] && __dbg.taxi.leavers[0].p, true)', false);
  await ev('__tx.step(240)', false);
  const l2 = await ev('({ had: !!window.__leaver, fare: window.__leaver ? window.__leaver.fare : -1, inList: window.__leaver ? __dbg.peds.peds.includes(window.__leaver) : false, left: __dbg.taxi.leavers.length })', false);
  check(l2.had && l2.left === 0 && (!l2.inList || l2.fare === 0), `the very passenger who got out was let go into the crowd (claim ${l2.fare}, still in list ${l2.inList}, leavers left ${l2.left})`);

  // ---- the shift goes on: the next fare hails; a crash cuts its tip -------------
  const nx = await ev('(__tx.step(1), __dbg.taxi.run && __dbg.taxi.run.stage)', false);
  check(nx === 'hail', `the next fare hails by itself (stage ${nx})`);
  await ev(`(() => { const r = __dbg.taxi.run, p = r.ped, e = __dbg.city.edges[p.edge], v = __dbg.player.vehicle; __tx.place(v, p.fx, p.fz, Math.atan2(e.dx, e.dz)); return true; })()`, false);
  await ev('__tx.step(330)', false);
  const st2 = await ev('__dbg.taxi.run && __dbg.taxi.run.stage', false);
  check(st2 === 'ride', 'second fare boarded');
  const t0 = await ev('__dbg.taxi.tipNow(__dbg.taxi.run)', false);
  await ev('(__dbg.game.onCrash(14, false), __tx.step(2), true)', false);
  const t1 = await ev('__dbg.taxi.tipNow(__dbg.taxi.run)', false);
  check(t1 < t0, `a crash cuts the tip: $${t0} -> $${t1}`);
  await ev('(__tx.step(40), __dbg.game.onCrash(5, false), __tx.step(2), true)', false);
  const t2 = await ev('__dbg.taxi.tipNow(__dbg.taxi.run)', false);
  check(t2 < t1, `a hard bump cuts it again: $${t1} -> $${t2}`);
  const sk = await ev('__dbg.taxi.streak', false);
  check(sk === 0, 'a crash ends the shift streak');
  await ev(`(() => { const r = __dbg.taxi.run, v = __dbg.player.vehicle; __tx.place(v, r.dest.x + 2, r.dest.z + 2, v.heading); return true; })()`, false);
  await ev('__tx.step(30)', false);
  const a2 = await ev('__dbg.taxi.last', false);
  check(a2.tip / a2.fare < tipClean / a.last.fare, `the crashed ride's tip is ${(100 * a2.tip / a2.fare).toFixed(0)}% of its fare, the clean ride's ${(100 * tipClean / a.last.fare).toFixed(0)}%`);

  // ---- persistence across a reload ------------------------------------------
  const faresNow = await ev('__dbg.taxi.stats.fares', false);
  await boot();
  const faresBack = await ev('__dbg.taxi.stats.fares', false);
  check(faresBack === faresNow, `fares done survive a reload (${faresNow} -> ${faresBack})`);
  const pp = await ev('__dbg.career.passport().extra.join(" | ")', false);
  check(/Taxi fares \d+/.test(pp), `the Passport lists them: "${pp}"`);
  await ev(`(() => { const d = __dbg; window.__tx = null; return true; })()`, false);
  // rebuild the page-side harness after the reload
  await ev(`(() => {
    const d = __dbg, P = d.player, T = d.traffic, X = d.taxi, game = d.game;
    const H = window.__tx = {};
    game.paused = true;
    H.step = (n, dt = 1 / 30) => { for (let i = 0; i < n; i++) { const p = P.position; T.update(dt, p.x, p.z, { x: Math.sin(P.camYaw + Math.PI), z: Math.cos(P.camYaw + Math.PI) }, P); d.peds.update(dt, p.x, p.z, P, T); X.update(dt, P); } };
    H.taxiAt = (x, z) => { if (P.vehicle) P.exitVehicle(true); const ni = d.city.nearestNode(x, z, 400), n = d.city.nodes[ni]; let e = null;
      for (const ei of n.e) { const c = d.city.edges[ei]; if (!c.elev && !c.tunnel && c.cls !== 'hwy' && c.cls !== 'ramp') { e = c; break; } }
      const v = T.spawnAt(n.x, n.z, Math.atan2(e.dx, e.dz), 'taxi', 0xf0b40c, 'free'); v.vLong = 0; P.respawn(n.x, n.z); for (let i = 0; i < 12; i++) d.world.update(n.x, n.z, 2); P.enterVehicle(v); return v; };
    H.place = (v, x, z, h) => { v.x = x; v.z = z; if (h !== undefined) v.heading = h; v.vLong = 0; v.vLat = 0; v.y = d.city.groundAt(x, z, v.y); v.sync(); P.x = x; P.z = z; for (let i = 0; i < 4; i++) d.world.update(x, z, 2); if (h !== undefined) P.camYaw = h + Math.PI; for (let i = 0; i < 90; i++) P.updateCamera(1 / 30, null); };
    H.leftovers = () => ({ fareFlag: d.peds.peds.filter((p) => p.fare).length, mark: X.mark.visible, hudFare: !!d.hud.fare, run: !!X.run, on: X.on, obj: d.hud.objective ? d.hud.objective.textContent : '' });
    return true; })()`, false);

  // ---- endings: nothing left behind --------------------------------------------
  const boardNow = async () => {
    await ev(`(() => { const r = __dbg.taxi.run, p = r.ped, e = __dbg.city.edges[p.edge], v = __dbg.player.vehicle; __tx.place(v, p.fx, p.fz, Math.atan2(e.dx, e.dz)); return true; })()`, false);
    await ev('__tx.step(330)', false);
    return ev('__dbg.taxi.run && __dbg.taxi.run.stage', false);
  };
  const clean = async (what, expectToast) => {
    const L = await ev('__tx.leftovers()', false);
    check(!L.run && !L.on && !L.mark && !L.hudFare && L.fareFlag === 0 && L.obj === objBefore,
      `${what}: nothing left (run ${L.run}, on ${L.on}, pillar ${L.mark}, map ${L.hudFare}, fare peds ${L.fareFlag}, objective "${L.obj}")`);
  };
  const begin = async () => {
    await startTaxi();
    objBefore = await ev('__dbg.hud.objective.textContent', false);
    await ev(`(__dbg.game.money = 1000, __dbg.game.dead = false, __dbg.game.wanted = 0, __dbg.taxi.toggle(__dbg.player), __tx.step(3), true)`, false);
  };

  // leaving the taxi mid-fare
  await begin();
  check((await boardNow()) === 'ride', 'boarded (ending: leave the taxi)');
  await ev('(__dbg.player.exitVehicle(true), __tx.step(3), true)', false);
  await clean('leaving the taxi mid-fare');
  check((await ev('__dbg.game.money', false)) === 1000, 'leaving mid-fare pays nothing');

  // leaving while still hailing
  await begin();
  await ev('(__dbg.player.exitVehicle(true), __tx.step(3), true)', false);
  await clean('leaving the taxi while a fare is hailing');

  // dying
  await begin();
  check((await boardNow()) === 'ride', 'boarded (ending: dying)');
  await ev('(__dbg.game.dead = true, __tx.step(3), __dbg.game.dead = false, true)', false);
  await clean('dying (WASTED)');
  check((await ev('__dbg.game.money', false)) === 1000, 'dying mid-fare pays nothing');

  // a respawn (the vehicle is gone)
  await begin();
  check((await boardNow()) === 'ride', 'boarded (ending: respawn)');
  await ev('(__dbg.doRespawn(), __tx.step(3), true)', false);
  await clean('respawn');

  // three stars
  await begin();
  check((await boardNow()) === 'ride', 'boarded (ending: three stars)');
  await ev('(__dbg.game.wanted = 3, __tx.step(3), __dbg.game.wanted = 0, true)', false);
  await clean('three stars');

  // the fare clock
  await begin();
  check((await boardNow()) === 'ride', 'boarded (ending: timeout)');
  await ev('(__dbg.taxi.run.ride = __dbg.taxi.run.limit - 0.02, __tx.step(3), true)', false);
  await clean('the fare clock running out');
  check((await ev('__dbg.game.money', false)) === 1000, 'timing out pays nothing');

  // FARE again hands the shift in
  await begin();
  check((await boardNow()) === 'ride', 'boarded (ending: FARE pressed again)');
  await ev('(__dbg.taxi.toggle(__dbg.player), __tx.step(3), true)', false);
  await clean('pressing FARE again');

  // a hail nobody pulls up for gives up
  await begin();
  await ev('(__dbg.taxi.run.t = 149.99, __tx.step(3), true)', false);
  await clean('a hail nobody answers');

  // a passenger knocked down while hailing is not a fare
  await begin();
  await ev('(() => { const p = __dbg.taxi.run.ped; __dbg.peds.knockDown(p, { x: 1, z: 0 }, 6); __tx.step(3); return true; })()', false);
  const hurt = await ev('({ run: !!__dbg.taxi.run, on: __dbg.taxi.on })', false);
  check(!hurt.run, 'a hailing person knocked down ends that hail (the shift goes on: ' + hurt.on + ')');
  await ev('(__dbg.taxi.end(false), true)', false);
  await clean('ending the shift after a knocked-down hail');

  // ---- nit fixes: one-way routes, hails by road, the objective, penalties ----------------
  // (1) strict routes never go the wrong way; the pursuit router does, so this is not vacuous
  const ow = await ev(`(() => {
    const d = __dbg, T = d.traffic, C = d.city, X = d.taxi;
    const wrong = (path) => { let n = 0; for (let i = 0; i + 1 < path.length; i++) { const a = path[i], b = path[i + 1];
      const ei = C.nodes[a].e.find((q) => { const e = C.edges[q]; return (e.a === a && e.b === b) || (e.a === b && e.b === a); });
      if (ei === undefined) continue; const e = C.edges[ei]; if (!T.allowed(ei, e.a === a ? 1 : -1)) n++; } return n; };
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sites = [[-560, -210], [1861, -5554], [-3633, -7246], [590, 6939], [-3655, 4493], [1468, -1389], [-36, -1314], [2101, 3753]];
    let strictWrong = 0, looseWrong = 0, routes = 0, chose = 0, chooseWrong = 0, payOver = 0;
    for (let k = 0; k < 40; k++) {
      const [sx, sz] = sites[k % sites.length], a = C.nearestNode(sx + (rnd() - 0.5) * 600, sz + (rnd() - 0.5) * 600, 300);
      const ang = rnd() * 6.28, r = 700 + rnd() * 2500, b = C.nearestNode(sx + Math.cos(ang) * r, sz + Math.sin(ang) * r, 300);
      if (a < 0 || b < 0 || a === b) continue;
      const ps = T.findPath(a, b, 3200, true); if (ps) { routes++; strictWrong += wrong(ps); }
      const pl = T.findPath(a, b, 3200, false); if (pl) looseWrong += wrong(pl) ? 1 : 0;
      if (k % 4 === 0) { const n = C.nodes[a], pick = X.choose(n.x, n.z); if (pick) { chose++; chooseWrong += wrong(pick.path); if (pick.payM > pick.m + 0.5) payOver++; } }
    }
    return { routes, strictWrong, looseRoutesWithWrong: looseWrong, chose, chooseWrong, payOver };
  })()`, false);
  check(ow.routes >= 25 && ow.strictWrong === 0, `strict routes: 0 wrong-way edges over ${ow.routes} routes (the pursuit router had ${ow.looseRoutesWithWrong} routes with one)`);
  check(ow.chose >= 5 && ow.chooseWrong === 0, `chosen fares' routes: 0 wrong-way edges over ${ow.chose}`);
  check(ow.payOver === 0, 'the paid distance never exceeds the route');

  // (2) pay is capped near the crow flight: an engineered wild route pays on 1.6 x straight
  const cap = await ev(`(async () => { const T = await import('/apps/auto/src/taxi.js'); const a = T.fareFor(3600, 1.6 * 846), b = T.fareFor(3600);
    return { capped: a.fare, plain: b.fare, par: a.par === b.par }; })()`);
  check(cap.capped < cap.plain && cap.par, `a 3600 m route for an 846 m flight pays $${cap.capped}, not $${cap.plain}, on the same clock`);

  // (3) hails are by road: every hail the taxi gets is reachable under 2x the flight, over six sites
  const sitesH = [[-560, -210], [1861, -5554], [-3633, -7246], [590, 6939], [-3655, 4493], [2973, -1991]];
  let hOK = 0, hGaveUp = 0;
  for (const [hx, hz] of sitesH) {
    await startTaxi(hx, hz);
    await ev(`(__dbg.game.dead = false, __dbg.game.wanted = 0, __dbg.taxi.toggle(__dbg.player), __tx.step(2), true)`, false);
    const r = await ev(`(() => { const X = __dbg.taxi, r = X.run; return r && r.ped ? { ok: X.reachable(__dbg.player.position, r.ped) } : null; })()`, false);
    if (r && r.ok) hOK++; else if (!r) hGaveUp++;
    await ev('(__dbg.taxi.end(false), true)', false);
  }
  check(hOK + hGaveUp === sitesH.length && hOK >= 4, `hails by road: ${hOK} of ${sitesH.length} sites got a reachable hailer, ${hGaveUp} found none (no unreachable one offered)`);

  // (4) Washington Park: it either makes a fare or ends the shift with a message -- never loops
  await startTaxi(2973, -1991);
  await ev(`(__dbg.game.dead = false, __dbg.game.wanted = 0, __dbg.taxi.toggle(__dbg.player), __tx.step(3), true)`, false);
  const wp = await ev(`(() => { const v = __dbg.player.vehicle, c = __dbg.taxi.choose(v.x, v.z); return { found: !!c, dest: c && c.dest.name, m: c && Math.round(c.m) }; })()`, false);
  console.log(`     (Washington Park: choose() ${wp.found ? 'found ' + wp.dest + ' at ' + wp.m + ' m' : 'finds nothing'})`);
  let wpEnd = null;
  for (let k = 0; k < 6 && !wpEnd; k++) {
    if (await ev('!__dbg.taxi.on', false)) { wpEnd = 'ended'; break; }
    const stg = await ev('__dbg.taxi.run && __dbg.taxi.run.stage', false);
    if (stg === 'hail') { await boardNow(); if (await ev('!!__dbg.taxi.run && __dbg.taxi.run.stage === "ride"', false)) { wpEnd = 'rode'; break; } }
    await ev('__tx.step(200)', false);
  }
  check(wp.found ? wpEnd === 'rode' : wpEnd === 'ended', `Washington Park ${wpEnd === 'rode' ? 'now makes a fare' : 'ends the shift after a few failures'} (${wpEnd})`);
  await ev('(__dbg.taxi.end(false), true)', false);

  // (4b) a shift that cannot make a fare ends after three tries, not every 4 s for ever
  await begin();
  await ev('(__dbg.taxi.choose = () => null, true)', false);
  for (let k = 0; k < 4 && (await ev('__dbg.taxi.on', false)); k++) { if (await ev('__dbg.taxi.run && __dbg.taxi.run.stage === "hail"', false)) await boardNow(); await ev('__tx.step(240)', false); }
  check(!(await ev('__dbg.taxi.on', false)), 'three routeless fares in a row end the shift');
  await ev('(delete __dbg.taxi.choose, true)', false);

  // (5) the pedestrian penalty is one per 2 s, however many you hit at once
  await begin();
  check((await boardNow()) === 'ride', 'boarded (penalty cooldown)');
  const s0 = await ev('__dbg.taxi.run.smooth', false);
  await ev('(__dbg.taxi.onPedHit(true), __dbg.taxi.onPedHit(true), __dbg.taxi.onPedHit(true), true)', false);
  const s1 = await ev('__dbg.taxi.run.smooth', false);
  await ev('(__tx.step(80), __dbg.taxi.onPedHit(true), true)', false);
  const s2 = await ev('__dbg.taxi.run.smooth', false);
  check(Math.abs((s0 - s1) - 0.4) < 1e-6 && s2 < s1, `three pedestrians at once cost one penalty (${s0.toFixed(2)} -> ${s1.toFixed(2)}), the next after 2 s another (${s2.toFixed(2)})`);
  await ev('(__dbg.taxi.end(false), true)', false);

  // (6) a delivery during the shift: the line that comes back is the CURRENT one
  await begin();
  check((await boardNow()) === 'ride', 'boarded (objective)');
  await ev('(__dbg.game.target = { x: 100, z: 200, y: 0 }, __dbg.game.deliveryValue = 777, true)', false);
  await ev('(__dbg.taxi.end(false), true)', false);
  const ob = await ev('__dbg.hud.objective.textContent', false);
  const nm = await ev('__dbg.G.placeNameAt(100, 200)', false);
  check(ob === `Deliver to ${nm} — $777`, `after the shift the objective is the current delivery, not the old one: "${ob}"`);
  await ev('(__dbg.game.target = null, __dbg.hud.setObjective(""), true)', false);

  // (7) taking another cab ends the fare
  await begin();
  check((await boardNow()) === 'ride', 'boarded (cab change)');
  await ev(`(() => { const v = __dbg.player.vehicle, w = __dbg.traffic.spawnAt(v.x + 6, v.z, v.heading, 'taxi', 0xf0b40c, 'free'); __dbg.player.enterVehicle(w); __tx.step(3); return true; })()`, false);
  await clean('carjacking another taxi mid-fare');
  await ev('(__dbg.hud.setObjective(""), true)', false);

  check(logs.length === 0, 'no page exceptions' + (logs.length ? ': ' + logs.slice(0, 3).join(' | ') : ''));
} catch (e) {
  console.log('FAIL probe crashed: ' + (e && e.stack || e));
  fails++;
} finally {
  chrome.kill();
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exitCode = fails ? 1 : 0;
