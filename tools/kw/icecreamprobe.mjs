// Auto KW: the ice cream truck job (src/icecream.js), end to end in the running game.
//
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 node tools/kw/icecreamprobe.mjs [outdir]
//
// Boots like winterprobe.mjs (service worker bypassed, __noAutoQuality) and leaves the game
// RUNNING: the truck is put on a street and given a speed, the real frame loop does the rest.
// Asserts (exit 1 on a failure or a page exception):
//   - a truck is parked at a shop (an 'apron' icecream in traffic, a map place with a hello) and
//     a real E press beside it gets you in (traffic.nearestEnterable);
//   - a real M press starts the shift; the MISSION button shows; the jingle voice runs and its
//     playbackRate follows speed (slow wobbly tape at a crawl);
//   - customers come out only when slow, only on residential streets (every spawn edge 'res';
//     none at 40 km/h, none crawling an arterial);
//   - stopped, a customer is served and the money goes up by the sale;
//   - a queue is lost by driving off (and a kid gives chase when rigged to);
//   - a street dries up: none come from streets that have had DRY sales;
//   - jobsBusy() / storyBusy() include the shift, and a shift will not start over another job;
//   - the season: November + snow cuts the rate and says "Ice cream in a snowstorm. Bold.",
//     summer raises it; with no rig the real calendar's month is used;
//   - M again ends it, the best is saved in autokw-icecream; hitting a pedestrian ends it;
//   - cleanup: no customers, no treats, no jingle voice left; the Weenie Wagon runs a hot-dog
//     shift with adults only; 0 page exceptions.
// Shots: the truck at its shop, kids round the truck on a residential street, the hot dog shift.

import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/icecreamshots';
let closing = false, fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-icecream-profile-${PORT}`, width: 1280, height: 720, extra: ['--autoplay-policy=no-user-gesture-required'] });
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
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') {
        const t = (m.params.args || []).map((a) => a.value || a.description).join(' ');
        if (/icecream/.test(t)) errs.push('warn: ' + t);
      }
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
    const KEYS = { m: ['KeyM', 'm', 77], e: ['KeyE', 'e', 69] };
    const key = (k, down) => { const [code, kk, vk] = KEYS[k]; return send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: kk, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
    const tap = async (k) => { await key(k, true); await sleep(250); await key(k, false); await sleep(250); };
    // a close shot: the world held for a moment, the camera set beside the truck's hatch (kerb) side
    const close = async (name, side = 7.5, back = -3.5, up = 2.4, aim = 1.0) => {
      await ev(`(() => { const d = window.__dbg, v = d.player.vehicle, f = v.forward, rx = -f.z, rz = f.x;
        d.game.paused = true;
        const cx = v.x + rx * ${side} + f.x * ${back}, cz = v.z + rz * ${side} + f.z * ${back};
        d.camera.position.set(cx, v.y + ${up}, cz); d.camera.lookAt(v.x + rx * 2.2 - f.x * 1.2, v.y + ${aim}, v.z + rz * 2.2 - f.z * 1.2); d.camera.updateMatrixWorld(true); })()`);
      await sleep(1500);
      await shot(name);
      await ev('window.__dbg.game.paused = false');
    };
    const until = async (js, secs) => { const t0 = Date.now(); while (Date.now() - t0 < secs * 1000) { if (await ev(js)) return true; await sleep(150); } return false; };

    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true; try { localStorage.removeItem("autokw-icecream"); } catch (e) {}' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    let up = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.icecream)')) { up = true; break; }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
    console.log(`booted; exceptions at boot: ${errs.length}`);
    await sleep(3000);
    await ev(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); const r = document.getElementById('rotate'); if (r) r.style.display = 'none';
      if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); })()`);
    await sleep(800);
    await ev(`window.__dbg.game.paused = false; window.__dbg.game.setWanted(0); window.__dbg.game.money = 100; window.__dbg.audio.init && window.__dbg.audio.init(); window.__dbg.audio.resume && window.__dbg.audio.resume();
      window.__dbg.weather.set('clear', true); window.__dbg.events && (window.__dbg.events.enabled = false);`);
    const J = (e) => ev(`(() => { const d = window.__dbg, J = d.icecream, R = J.run; ${e} })()`);

    // the helpers: a residential street (and an arterial) near a shop, the truck put on one
    await ev(`window.__h = {
      street(cls, x0, z0, minLen) {
        const c = window.__dbg.city;
        const list = c.roadsNear(x0, z0, 900, false).map((ei) => [ei, c.edges[ei]]).filter(([ei, e]) => e.cls === cls && !e.elev && !e.tunnel && !e.noTraffic && e.len >= minLen && e.name);
        const score = ([ei, e]) => { const a = c.nodes[e.a]; return Math.hypot(a.x - x0, a.z - z0); };
        list.sort((p, q) => score(p) - score(q));
        // 'res': a street in a residential neighbourhood (everything within 60 m residential);
        // anything else: one with no residential street within 6 m of its middle
        for (const [ei, e] of list) {
          const a = c.nodes[e.a], mx = a.x + e.dx * e.len / 2, mz = a.z + e.dz * e.len / 2;
          const nb = c.roadsNear(mx, mz, cls === 'res' ? 60 : 6, false).map((j) => c.edges[j]);
          if (cls === 'res' ? nb.some((q) => q.cls !== 'res') : nb.some((q) => q.cls === 'res')) continue;
          return ei;
        }
        return -1;
      },
      put(ei, t, speed) {
        const d = window.__dbg, c = d.city, e = c.edges[ei], a = c.nodes[e.a], v = d.player.vehicle;
        const tt = Math.max(4, Math.min(e.len - 4, t));
        const x = a.x + e.dx * tt - e.dz * 1.8, z = a.z + e.dz * tt + e.dx * 1.8;   // the right-hand lane: the hatch at the kerb
        v.place(x, z, Math.atan2(e.dx, e.dz)); v.vLong = speed; v.vLat = 0; d.world.update(x, z, 60);
        return [x, z];
      },
      ours() { return window.__dbg.peds.peds.filter((p) => p.icecream).length; },
      treats() { let n = 0; window.__dbg.scene.traverse((o) => { if (o.userData && o.userData.icecream) n++; }); return n; },
    }`);

    // ---------------------------------------------------------------- the truck at its shop
    console.log('--- the trucks');
    const D = JSON.parse(await J(`return JSON.stringify(J.depots.map((s) => ({ name: s.name, spots: s.spots.map((p) => [p.x | 0, p.z | 0, +p.heading.toFixed(2)]), v: s.vs && s.vs[0] ? [s.vs[0].typeName, s.vs[0].mode] : null })))`));
    console.log('  depots', JSON.stringify(D));
    ok(D.some((s) => s.spots.length && s.v && s.v[0] === 'icecream' && s.v[1] === 'apron'), 'an ice cream truck is parked at a shop');
    const places = JSON.parse(await J(`return JSON.stringify(d.hud.places.filter((p) => p.kind === 'icecream').map((p) => [p.name, !!p.hello]))`));
    ok(places.length >= 1 && places.every((p) => p[1]), `map place(s) with a hello: ${places.map((p) => p[0]).join(', ')}`);
    // on foot beside the first truck, looking at it: a shot, then a real E press gets in
    await J(`const s = J.depots.find((q) => q.spots.length), v = s.vs[0], f = v.forward;
      if (d.player.vehicle) d.player.exitVehicle(true);
      const x = v.x - f.z * (v.halfWid + 1.6) + f.x * 1.2, z = v.z + f.x * (v.halfWid + 1.6) + f.z * 1.2;
      d.world.update(x, z, 60); d.player.x = x; d.player.z = z; d.player.y = d.city.groundAt(x, z, null) + 0.1; d.player.heading = Math.atan2(v.x - x, v.z - z) + Math.PI;`);
    await sleep(2500);
    ok(await J(`const s = J.depots.find((q) => q.spots.length); return d.traffic.nearestEnterable(d.player.x, d.player.z, 5.0) === s.vs[0]`), 'traffic.nearestEnterable finds the parked truck');
    // the depot shot: from the street, a few metres off
    await J(`const s = J.depots.find((q) => q.spots.length), v = s.vs[0], f = v.forward; const x = v.x + f.z * 9 + f.x * 7, z = v.z - f.x * 9 + f.z * 7;
      d.player.x = x; d.player.z = z; d.player.y = d.city.groundAt(x, z, null) + 0.1; d.player.heading = Math.atan2(x - v.x, z - v.z);`);
    await sleep(2500);
    await shot('truck-at-shop');
    await J(`const s = J.depots.find((q) => q.spots.length), v = s.vs[0], f = v.forward;
      const x = v.x - f.z * (v.halfWid + 1.4), z = v.z + f.x * (v.halfWid + 1.4);
      d.player.x = x; d.player.z = z; d.player.y = d.city.groundAt(x, z, null) + 0.1;`);
    await sleep(600);
    await tap('e');
    ok(await until(`!!(window.__dbg.player.vehicle && window.__dbg.player.vehicle.spec.icecream)`, 6), 'a real E press: in the truck');
    ok(await until(`document.getElementById('app').dataset.icecream === '1'`, 4), 'the MISSION button shows in the truck');

    // ---------------------------------------------------------------- busy guard
    console.log('--- jobs busy');
    const blocked = JSON.parse(await J(`d.taxi.on = true; d.controls.btn.icmission = true; J.update(0.016, d.player); const r = !!J.run, t = document.getElementById('toast').textContent;
      d.taxi.on = false; d.controls.btn.icmission = false; J.update(0.016, d.player); return JSON.stringify({ r, t })`));
    ok(!blocked.r && /Finish the taxi shift/.test(blocked.t), `another job running: no shift ("${blocked.t}")`);

    // ---------------------------------------------------------------- the season
    console.log('--- season');
    const S = JSON.parse(await J(`const out = {};
      J.rig = { month: 10, snow: true }; J.begin(d.player, 'ice'); out.nov = J.run.mod; out.novSay = document.getElementById('toast').textContent; J.end('', false);
      J.rig = { month: 6, snow: false }; J.begin(d.player, 'ice'); out.jul = J.run.mod; J.end('', false);
      J.rig = { month: 3, snow: false }; J.begin(d.player, 'ice'); out.apr = J.run.mod; J.end('', false);
      J.rig = {}; J.begin(d.player, 'ice'); out.real = J.run.month; out.realMod = J.run.mod; J.end('', false);
      out.now = new Date().getMonth(); J.stats.shifts = 0; J.stats.best = 0; J.save(); return JSON.stringify(out)`));
    console.log('  ', JSON.stringify(S));
    ok(S.nov < S.apr * 0.3 && /snowstorm\. Bold/.test(S.novSay), `November + snow: rate x${S.nov.toFixed(2)} and "${S.novSay.slice(0, 60)}"`);
    ok(S.jul > S.apr * 1.4, `July: rate x${S.jul} vs April x${S.apr}`);
    ok(S.real === S.now, `no rig: the real calendar month (${S.real}) is used, rate x${S.realMod}`);

    // ---------------------------------------------------------------- a shift by M
    console.log('--- the shift');
    const res = await ev(`window.__h.street('res', ${D[0].spots[0] ? D[0].spots[0][0] : -3752}, ${D[0].spots[0] ? D[0].spots[0][1] : -1458}, 34)`);
    const art = await ev(`window.__h.street('art', ${D[0].spots[0] ? D[0].spots[0][0] : -3752}, ${D[0].spots[0] ? D[0].spots[0][1] : -1458}, 36)`);
    console.log('  res street', await J(`const e = d.city.edges[${res}]; return e.name + ' ' + Math.round(e.len) + ' m'`), '| arterial', await J(`const e = d.city.edges[${art}]; return e ? e.name + ' ' + Math.round(e.len) + ' m' : 'none'`));
    ok(res >= 0, 'a residential street near the shop');
    await J(`J.rig = { month: 6, snow: false, kid: true }`);
    await ev(`window.__h.put(${res}, 20, 0)`);
    await sleep(800);
    await tap('m');
    ok(await until(`!!window.__dbg.icecream.run`, 6), 'a real M press starts the shift');
    ok(await J(`return document.querySelector('[data-btn="icmission"]').classList.contains('on')`), 'the button lights');
    ok(await J(`return d.carWash.busy() === true`), 'jobsBusy() includes the shift');
    ok(await J(`return J.o.blocked() === 'ice cream shift'`), 'storyBusy() names it');
    ok(await until(`window.__dbg.icecream.voices === 1`, 6), 'the jingle voice is playing (one looped voice)');
    // fast first: no customers at 40 km/h on the residential street
    await J(`R.mod = 8`);
    // (held at speed at the start of the street: a car that runs into the next junction slows)
    for (let i = 0; i < 16; i++) { await ev(`window.__h.put(${res}, 6, 11.1)`); await sleep(200); }
    const fast = JSON.parse(await J(`return JSON.stringify({ n: R.spawned, rate: R.rate, t: R.t })`));
    ok(fast.n === 0, `at 40 km/h nobody comes out (${fast.n} in ${fast.t.toFixed(1)} s game time)`);
    ok(fast.rate > 1.0, `the tape runs fast at speed (rate ${fast.rate.toFixed(3)})`);
    // a crawl on an arterial: nobody
    if (art >= 0) {
      await ev(`window.__h.put(${art}, 18, 2)`);
      const t0 = +(await J(`return R.t`));
      for (let i = 0; i < 16; i++) { await ev(`window.__dbg.player.vehicle.vLong = 2`); await sleep(200); }
      const a = JSON.parse(await J(`return JSON.stringify({ n: R.spawned, ok: R.onOk, cls: R.onStreet && R.onStreet.cls, t: R.t - ${t0} })`));
      ok(a.n === 0 && !a.ok, `crawling ${a.cls} for ${a.t.toFixed(1)} s: nobody (${a.n})`);
    }
    // the module's own time per frame, from here on (wrapped round the instance main.js calls)
    await J(`const u = J.update.bind(J); J._ms = 0; J._n = 0; J._max = 0; J.update = (dt, p) => { const t = performance.now(); u(dt, p); const e = performance.now() - t; J._ms += e; J._n++; J._max = Math.max(J._max, e); };`);
    // the crawl on the residential street: customers, all from residential streets
    await ev(`window.__h.put(${res}, 20, 2)`);
    const rates = [];
    for (let i = 0; i < 40; i++) {
      await ev(`window.__dbg.player.vehicle.vLong = 2.0`);
      rates.push(+(await J(`return R.rate`)));
      await sleep(200);
      if (await J(`return R.spawned >= 4`)) break;
    }
    const crawl = JSON.parse(await J(`return JSON.stringify({ n: R.spawned, edges: R.spawnEdges, cust: R.cust.length, ours: window.__h.ours(), kids: R.cust.filter((c) => c.kid && c.p.h.scale < 0.75).length, onOk: R.onOk })`));
    console.log('  crawl', JSON.stringify(crawl), 'rates', rates.map((r) => r.toFixed(3)).join(' '));
    ok(crawl.n >= 2, `crawling a residential street under 25 km/h: ${crawl.n} customers came out`);
    ok(crawl.edges.length && crawl.edges.every((c) => c === 'res'), 'every one from a residential street');
    ok(crawl.kids >= 1, `kids among them (scaled), ${crawl.kids}`);
    ok(rates.some((r) => r < 0.84), `a slow, wobbly tape at a crawl (rates ${Math.min(...rates).toFixed(3)}-${Math.max(...rates).toFixed(3)})`);
    // stop: they queue and buy
    await J(`R.mod = 0.0001`);
    const money0 = +(await J(`return d.game.money`));
    let sold = false;
    for (let i = 0; i < 120 && !sold; i++) {
      await ev(`window.__dbg.player.vehicle.vLong = 0`);
      await sleep(200);
      sold = await J(`return R.sold >= 1`);
      if (i === 25) await shot('kids-round-the-truck');
    }
    const sale = JSON.parse(await J(`return JSON.stringify({ sold: R.sold, earned: R.earned, money: d.game.money, last: J.last, line: R.line.length, treats: window.__h.treats(), toast: document.getElementById('toast').textContent, gain: R.voice && R.voice.gain })`));
    console.log('  sale', JSON.stringify(sale));
    ok(sold, `stopped: a customer bought (${sale.sold} sold)`);
    ok(sale.money - money0 === sale.earned && sale.last && sale.last.base >= 3 && sale.last.base <= 7, `money up by the sale (+$${sale.money - money0})`);
    ok(sale.treats >= 1, 'the customer walks off holding a treat');
    await close('kids-at-the-hatch');
    // the treat in the hand, close up
    await ev(`(() => { const d = window.__dbg, R = d.icecream.run, C = R.cust.find((c) => c.st === 'leave'); if (!C) return; d.game.paused = true;
      const p = C.p, hb = p.h.bones[11].getWorldPosition(new d.THREE.Vector3()), fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      d.camera.position.set(hb.x + fx * 1.6 - fz * 0.9, hb.y + 0.35, hb.z + fz * 1.6 + fx * 0.9); d.camera.lookAt(hb.x, hb.y, hb.z); d.camera.updateMatrixWorld(true); })()`);
    await sleep(1500); await shot('cone-closeup'); await ev('window.__dbg.game.paused = false');
    // a couple more seconds for the queue shot with cones
    for (let i = 0; i < 10; i++) { await ev(`window.__dbg.player.vehicle.vLong = 0`); await sleep(200); }
    await shot('kids-with-cones');
    // ---------------------------------------------------------------- drive off with a queue
    console.log('--- drive off');
    // more customers, stopped: wait for a queue of two or more
    await J(`R.mod = 8`);
    let q = false;
    for (let i = 0; i < 120 && !q; i++) {
      await ev(`window.__dbg.player.vehicle.vLong = 0`);
      await sleep(200);
      q = await J(`return R.line.filter((c) => c.st === 'queue' && c.kid).length >= 1 && R.line.length >= 2`);
      // roll at once (2 m/s: over the hatch's 1, under the queue's brush limit) or the hatch serves the whole queue first
      if (q) await J(`R.mod = 0.0001; d.player.vehicle.vLong = 2;`);
    }
    ok(q, 'a queue formed at the hatch');
    const lost0 = +(await J(`return R.lost`));
    // (nobody still walking up from in front: driving off into a customer ends the shift, as it should)
    await J(`J.rig.chase = true; R.streak = 3; R.mod = 0.0001; for (const C of [...R.cust]) if (C.st === 'come' || C.st === 'leave') J.drop(R, C, true);
      const v = d.player.vehicle, f = v.forward;
      for (const p of [...d.peds.peds]) { if (p.icecream) continue; const dx = p.x - v.x, dz = p.z - v.z, a = dx * f.x + dz * f.z, l = Math.abs(dx * f.z - dz * f.x); if (a > -2 && a < 45 && l < 4.5) d.peds.remove(p); }`);
    const [ox, oz] = JSON.parse(await J(`return JSON.stringify([d.player.vehicle.x, d.player.vehicle.z])`));
    for (let i = 0; i < 40; i++) {
      // pulling away as a player does (from 2 m/s: under 1 the hatch still serves): it brushes the queue at a walking pace
      // (teleporting to 8 m/s hit the customer mid-purchase at 7.9 m/s -- not something a truck can do)
      await J(`const v = d.player.vehicle; v.vLong = ${Math.min(8, 2 + i * 0.7).toFixed(2)};`);
      await sleep(200);
      if (await J(`return !R || R.lost > ${lost0}`)) break;
    }
    if (await J(`return !R`)) console.log('  the shift ended:', await J(`return J.last && J.last.msg`), await J(`return JSON.stringify(J._lastHit)`));
    const off = JSON.parse(await J(`return JSON.stringify({ lost: R.lost - ${lost0}, streak: R.streak, line: R.line.length, chase: R.cust.filter((c) => c.st === 'chase').length, toast: document.getElementById('toast').textContent, moved: Math.hypot(d.player.vehicle.x - ${ox}, d.player.vehicle.z - ${oz}) })`));
    console.log('  off', JSON.stringify(off));
    ok(off.lost >= 1 && /drove off/.test(off.toast), `driving off loses the queue (${off.lost} lost: "${off.toast.slice(0, 70)}")`);
    ok(off.streak === 0, 'and the streak');
    ok(off.chase === 1, 'a kid chases the truck down the street');
    // stop and let him catch up
    const sold0 = +(await J(`return R.sold`));
    let caught = false;
    for (let i = 0; i < 80 && !caught; i++) {
      await ev(`window.__dbg.player.vehicle.vLong = 0`);
      await sleep(200);
      caught = await J(`return R.sold > ${sold0} && J.last.pay - J.last.base - J.last.bonus === 2`);
    }
    ok(caught, 'stopped, the chasing kid catches up and buys, with a tip');

    // ---------------------------------------------------------------- the street dries up
    console.log('--- dry streets');
    const dry = JSON.parse(await J(`const v = d.player.vehicle, keys = new Set();
      for (const ei of d.city.roadsNear(v.x, v.z, 60, false)) { const e = d.city.edges[ei]; const k = e.name || ('#' + ei); keys.add(k); R.streets.set(k, 4); }
      R.mod = 8; R.dryTold.clear(); return JSON.stringify({ keys: [...keys], n0: R.spawned })`));
    for (let i = 0; i < 25; i++) { await ev(`window.__dbg.player.vehicle.vLong = 2`); await sleep(200); }
    const dry2 = JSON.parse(await J(`return JSON.stringify({ n: R.spawned, toast: document.getElementById('toast').textContent })`));
    ok(dry2.n === dry.n0, `streets with ${4} sales send nobody (${dry2.n - dry.n0} new on ${dry.keys.join(', ')})`);
    ok(/ice-creamed out/.test(dry2.toast), `"${dry2.toast.slice(0, 70)}"`);

    const cost = JSON.parse(await J(`const tg = J.treatGeo; return JSON.stringify({ ms: J._ms / Math.max(1, J._n), max: J._max, n: J._n, tris: { ice: tg.ice.attributes.position.count / 3, dog: tg.dog.attributes.position.count / 3 }, scene: d.sceneStats ? [d.sceneStats.calls, d.sceneStats.tris] : null, cap: R.cust.length })`));
    console.log('  cost', JSON.stringify(cost));
    ok(cost.ms < 0.2, `update ${cost.ms.toFixed(3)} ms a frame on average (max ${cost.max.toFixed(2)} ms over ${cost.n} frames)`);
    // ---------------------------------------------------------------- M ends it, the best is saved
    console.log('--- end');
    const earned = +(await J(`return R.earned`));
    await tap('m');
    ok(await until(`!window.__dbg.icecream.run`, 6), 'M again ends the shift');
    await sleep(400);
    const end = JSON.parse(await J(`return JSON.stringify({ toast: document.getElementById('toast').textContent, ls: JSON.parse(localStorage.getItem('autokw-icecream') || '{}'), ours: window.__h.ours(), treats: window.__h.treats(), voices: J.voices, busy: d.carWash.busy(), btn: document.querySelector('[data-btn="icmission"]').classList.contains('on') })`));
    console.log('  end', JSON.stringify(end));
    ok(/cones on \d+ street/.test(end.toast), `summary toast: "${end.toast}"`);
    ok(end.ls.best === earned && earned > 0, `best saved in autokw-icecream ($${end.ls.best})`);
    ok(end.ours === 0 && end.treats === 0 && end.voices === 0, `cleanup: ${end.ours} customers, ${end.treats} treats, ${end.voices} voices left`);
    ok(!end.busy && !end.btn, 'jobsBusy() false again, button off');

    // ---------------------------------------------------------------- hitting a pedestrian ends it
    console.log('--- ped hit');
    await J(`J.rig = { month: 6, kid: true }`);
    await tap('m');
    ok(await until(`!!window.__dbg.icecream.run`, 6), 'a new shift');
    await J(`R.mod = 8`);
    await until(`window.__dbg.icecream.run && window.__dbg.icecream.run.cust.length >= 1`, 30);
    // pulling away brushes the queue: your own customer touched at a walking pace is not a hit
    const brush = JSON.parse(await J(`const p = R.cust[0].p, v = d.player.vehicle, v0 = v.vLong; v.vLong = 1.5; d.game.onPedHit(true, p); v.vLong = v0; return JSON.stringify({ run: !!J.run })`));
    ok(brush.run, 'brushing your own customer at a walking pace does not end the shift');
    await until(`window.__dbg.icecream.run && window.__dbg.icecream.run.cust.length >= 1`, 30);
    const hit = JSON.parse(await J(`const p = R.cust[0].p, v = d.player.vehicle; v.vLong = 9; p.x = v.x + v.forward.x * (v.halfLen + 0.3); p.z = v.z + v.forward.z * (v.halfLen + 0.3); d.game.onPedHit(true, p); v.vLong = 0; return JSON.stringify({ run: !!J.run, toast: document.getElementById('toast').textContent })`));
    const hitMsg = await J(`return (J.last && J.last.msg) || ''`);
    ok(!hit.run && /hit a pedestrian/.test(hitMsg), `hitting a pedestrian ends the shift ("${hitMsg.slice(0, 60)}")`);
    await sleep(600);
    ok(await J(`return window.__h.ours() === 0 && J.voices === 0`), 'and cleans up');
    // (setWanted only ever raises it: clear it as the UNWANTED cheat does -- two hits above are ~2 stars)
    await J(`d.game.wanted = 0; d.game.points = 0; d.game.cool = 0; if (d.police && d.police.clear) d.police.clear();`);

    // ---------------------------------------------------------------- the Weenie Wagon
    console.log('--- hot dogs');
    await J(`const v0 = d.player.vehicle; d.player.exitVehicle(true); const v = d.traffic.spawnAt(v0.x + 12, v0.z, v0.heading, 'wiener', 0xffffff, 'apron'); d.player.enterVehicle(v);
      J.rig = { night: true, month: 6 };`);
    // at night, in Uptown: a street inside the bar zone
    const dogSt = await ev(`window.__h.street('st', -3872, -1618, 30)`);
    await ev(`window.__h.put(${dogSt >= 0 ? dogSt : res}, 20, 0)`);
    await J(`d.tod && d.tod.choose && d.tod.choose('night')`);
    await sleep(1500);
    await tap('m');
    ok(await until(`!!(window.__dbg.icecream.run && window.__dbg.icecream.run.kind === 'dog')`, 6), 'M in the Weenie Wagon: a hot-dog shift');
    await J(`R.mod = 8`);
    let dogs = false;
    for (let i = 0; i < 150 && !dogs; i++) {
      await ev(`window.__dbg.player.vehicle.vLong = ${i < 10 ? 2 : 0}`);
      await sleep(200);
      dogs = await J(`return R.sold >= 1`);
      if (i === 40) await shot('hotdogs-uptown-night');
    }
    const dog = JSON.parse(await J(`return JSON.stringify({ sold: R.sold, spawned: R.spawned, kids: R.cust.filter((c) => c.kid).length, zone: R.zone && R.zone.name, onOk: R.onOk, cls: R.onStreet && R.onStreet.cls, edges: R.spawnEdges })`));
    console.log('  dog', JSON.stringify(dog));
    ok(dog.spawned >= 1 && dog.kids === 0, `adults came for hot dogs in ${dog.zone || 'no zone'} (${dog.spawned}, kids ${dog.kids})`);
    ok(dogs, 'and bought one');
    for (let i = 0; i < 4; i++) { await ev(`window.__dbg.player.vehicle.vLong = 0`); await sleep(200); }
    await close('hotdogs-at-the-wagon', 7, -1, 2.2, 1.2);
    await tap('m');
    ok(await until(`!window.__dbg.icecream.run`, 6), 'M ends it');
    const ls = JSON.parse(await ev(`localStorage.getItem('autokw-icecream')`));
    ok(ls.dogs >= 1 && ls.dogBest > 0, `hot dogs saved too (${ls.dogs}, best $${ls.dogBest})`);

    const perf = JSON.parse(await ev(`JSON.stringify(window.__dbg.renderer.info.render)`));
    console.log('  render', JSON.stringify(perf));
    ok(errs.length === 0, `no page exceptions${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
    closing = true;
  } finally {
    chrome.kill('SIGKILL');
  }
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('icecreamprobe failed:', e.message); process.exit(1); });
