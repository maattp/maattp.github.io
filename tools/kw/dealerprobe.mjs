// Auto KW: buying cars at real dealerships (src/kwdealer.js), end to end.
//
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 [AUTO_PHONE=1] node tools/kw/dealerprobe.mjs [outdir]
//
// Boots the game (service worker bypassed) and, through real key presses and DOM clicks:
//   - the four dealers are found at their real showrooms (Parkway Ford from kwfun.js, the rest by
//     name among kwshops' drawn dealer fronts), each with its map place; Ford's old map entry is gone;
//   - each stock list fits its dealer (6-10 real types), and every type is buyable into a garage;
//   - ENTER on foot at a door with a car parked beside it gets in the car; without one the showroom
//     opens and holds the world ('dealer'); while wanted the door refuses;
//   - the colour picker repaints the turntable's car; a livery type offers its own liveries;
//   - too poor: BUY greys out with how much more; nothing is charged;
//   - buying (BUY twice: ask, sign) charges the price and puts the record in the nearest garage
//     with a free stall; going there spawns it in the stall in its paint; the purchase is saved;
//   - every garage full: refused, nothing charged;
//   - a job (taxi on, jobsBusy) blocks BUY and TEST DRIVE;
//   - test drive: in the car, refused by garages and the export yard, jobs see 'test drive';
//     brought back = the showroom again; time up = the car goes back;
//   - the hold is released on close (the X) and on respawn, the preview disposed; 0 exceptions.
// Shots: each showroom, a bought car in its garage, a test drive. AUTO_PHONE=1: 874x402 landscape.
// Exit 1 on a failure.
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PHONE = process.env.AUTO_PHONE === '1';
const [W, H] = PHONE ? [874, 402] : [1280, 720];
const TAG = PHONE ? 'phone' : 'desk';
const OUT = process.argv[2] || 'tools/data/kw/dealershots';
let closing = false, fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-dealer-profile-${PORT}`, width: W, height: H, extra: ['--autoplay-policy=no-user-gesture-required'] });
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
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    };
    mkdirSync(OUT, { recursive: true });
    const shot = async (name) => {
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
      writeFileSync(`${OUT}/${name}-${TAG}.jpg`, Buffer.from(result.data, 'base64'));
      console.log(`  shot ${OUT}/${name}-${TAG}.jpg`);
    };
    const until = async (js, secs) => { const t0 = Date.now(); while (Date.now() - t0 < secs * 1000) { if (await ev(js)) return true; await sleep(120); } return false; };
    // a real key press (CDP input, so the game's own listeners see it as a player's)
    const KEYS = { enter: ['Enter', 'Enter', 13], e: ['KeyE', 'e', 69], esc: ['Escape', 'Escape', 27], down: ['ArrowDown', 'ArrowDown', 40], right: ['ArrowRight', 'ArrowRight', 39] };
    const press = async (k) => {
      const [code, key, vk] = KEYS[k];
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(k === 'enter' ? { text: '\r' } : {}) });
      await sleep(60);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    };
    const click = (sel) => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`);

    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    if (PHONE) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__noAutoQuality = true; try { localStorage.removeItem('autokw-dealer'); localStorage.removeItem('autokw-garages'); } catch (e) {}" });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    let up = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.garages && ("dealer" in window.__dbg))').catch(() => false)) { up = true; break; }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
    console.log(`booted; exceptions at boot: ${errs.length}`);
    await sleep(3000);
    await ev(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); const r = document.getElementById('rotate'); if (r) r.style.display = 'none';
      if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); })()`);
    await sleep(800);
    const D = (e) => ev(`(() => { const d = window.__dbg, Dl = d.dealer, Gs = d.garages; ${e} })()`);
    await ev(`(() => { const h = window.__dbg.hud, o = h.showToast.bind(h); window.__toasts = []; h.showToast = (t, ms) => { window.__toasts.push(t); return o(t, ms); }; })()`);
    // on foot at site i's door (o metres out from it, t along the front)
    await ev(`window.__h = {
      foot(i, o = 0.4, t = 0) {
        const d = window.__dbg, s = d.dealer.sites[i], p = d.player;
        if (!p.onFoot) { const v = p.vehicle; p.exitVehicle(true); if (v && v.testDrive) d.traffic.remove(v); }
        const x = s.x + s.nx * o - s.nz * t, z = s.z + s.nz * o + s.nx * t;
        p.respawn(x, z); p.heading = Math.atan2(-s.nx, -s.nz);
        d.world.update(x, z, 60);
        d.game.wanted = 0;
      },
      clearCars(i, r) { const d = window.__dbg, s = d.dealer.sites[i];
        for (const v of d.traffic.cars.slice()) if (v !== d.player.vehicle && Math.hypot(v.x - s.x, v.z - s.z) < r && (v.mode === 'parked' || v.mode === 'free' || v.mode === 'traffic')) d.traffic.remove(v); },
    }`);

    // ---------------------------------------------------------------- the sites
    console.log('--- the dealers');
    const sites = JSON.parse(await D(`return JSON.stringify(Dl.sites.map((q) => {
      // the showroom building: the box the door stands in front of (a step back in from the door)
      const bx = q.x - q.nx * 3, bz = q.z - q.nz * 3;
      const inB = d.city.buildingsNear(bx, bz, 60).some((b) => { const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = bx - b.x, dz = bz - b.z;
        return Math.abs(dx * c - dz * s) < b.w / 2 + 0.5 && Math.abs(dx * s + dz * c) < b.d / 2 + 0.5; });
      return { id: q.d.id, name: q.d.name, x: Math.round(q.x), z: Math.round(q.z), inB, stock: q.d.stock.map((r) => r[0]), prices: q.d.stock.map((r) => r[1]),
        types: q.d.stock.every((r) => !!d.TYPES[r[0]]), fit: q.d.stock.every((r) => Gs.fits({ spec: d.TYPES[r[0]], typeName: r[0] })) }; }))`));
    for (const s of sites) console.log(`    ${s.id} ${s.name} @ ${s.x},${s.z}: ${s.stock.join(' ')}`);
    ok(sites.length === 4 && ['ford', 'bustard', 'bmw', 'heffner'].every((k) => sites.some((s) => s.id === k)), 'four dealers found: ' + sites.map((s) => s.id).join(', '));
    ok(sites.every((s) => s.inB), 'each door stands at its showroom (the drawn building is right behind it)');
    ok(sites.every((s) => s.stock.length >= 6 && s.stock.length <= 10 && s.types), 'each sells 6-10 real types');
    ok(sites.every((s) => s.fit), 'every type on sale fits back in a garage');
    const st = Object.fromEntries(sites.map((s) => [s.id, s.stock]));
    ok(['pickup', 'dually', 'jeep', 'crossover', 'sports'].every((t) => st.ford.includes(t)), 'Ford: pickups, the dually, the jeep, a crossover, sports');
    ok(['jeep', 'lifted', 'pickup', 'dually'].every((t) => st.bustard.includes(t)), 'the truck dealer: jeeps, lifted, pickups');
    ok(['sports', 'ev', 'evy', 'convertible', 'limo'].every((t) => st.bmw.includes(t)), 'the luxury dealer: sports, ev, evy, convertible, limo');
    ok(['compact', 'bug', 'woodie', 'pickup50', 'wagon'].every((t) => st.heffner.includes(t)), 'the used lot: compacts, the bug, woodie, pickup50, an old wagon');
    const pr = (id, t) => sites.find((s) => s.id === id).prices[sites.find((s) => s.id === id).stock.indexOf(t)];
    ok(pr('heffner', 'compact') <= 5000 && pr('ford', 'sports') >= 25000 && pr('ford', 'sports') <= 40000 && pr('bmw', 'limo') > pr('bmw', 'sports') && pr('heffner', 'woodie') > pr('heffner', 'civic') * 3,
      'prices: a cheap car under $5k, a sports car $25-40k, the limo and classics more');
    const places = await ev(`JSON.stringify(window.__dbg.hud.places.filter((p) => p.kind === 'dealer' || p.name === 'Parkway Ford Lincoln').map((p) => [p.kind, p.name, typeof p.hello === 'function' ? p.hello() : p.hello]))`);
    console.log('    ' + places);
    const pl = JSON.parse(places);
    ok(pl.length === 4 && pl.every((p) => p[0] === 'dealer') && pl.every((p) => /ENTER at the showroom door/.test(p[2])), 'four dealer map places with the hello; Ford\'s old entry is gone');

    // ---------------------------------------------------------------- ENTER at the door
    console.log('--- ENTER at the door');
    await D(`d.game.money = 2000; window.__h.foot(0); window.__h.clearCars(0, 9);`);
    await sleep(900);
    await D(`const p = d.player, s = Dl.sites[0]; window.__car = d.traffic.spawnAt(p.x - s.nz * 2.4, p.z + s.nx * 2.4, Math.atan2(-s.nz, s.nx), 'sedan', 0x2060b0, 'parked');`);
    await sleep(500);
    await press('e');
    await sleep(1200);
    let r = JSON.parse(await D(`return JSON.stringify({ foot: d.player.onFoot, veh: d.player.vehicle === window.__car, open: Dl.active })`));
    ok(!r.foot && r.veh && !r.open, `ENTER with a car parked beside the door gets in the car (${JSON.stringify(r)})`);
    await D(`d.player.exitVehicle(true); d.traffic.remove(window.__car); window.__h.foot(0);`);
    await sleep(600);
    await D(`d.game.wanted = 2; window.__toasts.length = 0;`);
    await press('e');
    await sleep(900);
    r = JSON.parse(await D(`return JSON.stringify({ open: Dl.active, toast: window.__toasts.find((t) => /police/.test(t)) || window.__toasts.join(' | '), holds: [...d.game.holds] })`));
    ok(!r.open && /police/.test(r.toast) && !r.holds.includes('dealer'), `wanted: the door refuses ("${r.toast}")`);
    await D(`d.game.wanted = 0; d.police && d.police.clear && d.police.clear();`);
    await sleep(600);
    // reap leftover state, then each showroom in turn
    for (let i = 0; i < 4; i++) {
      await D(`window.__h.foot(${i}); window.__h.clearCars(${i}, 4); d.game.money = 2000;`);
      await sleep(900);
      await press('e');
      const opened = await until('window.__dbg.dealer.active', 6);
      r = JSON.parse(await D(`return JSON.stringify({ holds: [...d.game.holds], id: Dl.site && Dl.site.d.id, show: Dl.el.classList.contains('show'), rows: Dl.ui.list.children.length, frames: Dl.pv && Dl.pv.frames })`));
      ok(opened && r.holds.includes('dealer') && r.show && r.id === sites[i].id && r.rows === sites[i].stock.length, `ENTER at ${sites[i].name}'s door opens its showroom and holds the world (${JSON.stringify(r)})`);
      // a car worth showing, a paint picked through the real swatch buttons
      await D(`Dl.pick(${[8, 8, 5, 8][i]});`);
      await click('#dlUi .dlSw button[data-c="2"]');
      await sleep(1600);
      r = JSON.parse(await D(`return JSON.stringify({ frames: Dl.pv.frames, col: Dl.col })`));
      ok(r.frames > 5, `the turntable draws (${r.frames} frames)`);
      await shot(`showroom-${sites[i].id}`);
      await click('#dlUi .dlX');
      await sleep(300);
      r = JSON.parse(await D(`return JSON.stringify({ open: Dl.active, holds: [...d.game.holds], pv: !!Dl.pv })`));
      ok(!r.open && !r.holds.includes('dealer') && !r.pv, `the X closes it, releases the hold and disposes the preview (${JSON.stringify(r)})`);
    }

    // ---------------------------------------------------------------- the colour picker
    console.log('--- the colour picker');
    await D(`window.__h.foot(0); d.game.hold('dealer'); Dl.open(0);`);
    await sleep(500);
    await D(`Dl.pick(${st.ford.indexOf('sports')});`);
    await click('#dlUi .dlSw button[data-c="4"]');
    await sleep(400);
    r = JSON.parse(await D(`return JSON.stringify({ n: Dl.ui.sw.querySelectorAll('button').length, col: Dl.col, on: Dl.ui.sw.querySelector('button.on') && Dl.ui.sw.querySelector('button.on').dataset.c, hex: Dl.pv.car.bodyMat.color.getHex(), want: Dl.site.d.paint[4] })`));
    ok(r.n >= 6 && r.n <= 8 && r.col === 4 && r.on === '4' && r.hex === r.want, `a swatch repaints the turntable car (${r.n} swatches; 0x${r.hex.toString(16)} = 0x${r.want.toString(16)})`);
    await press('right');
    await sleep(200);
    ok(await D(`return Dl.col === 5 && Dl.pv.car.bodyMat.color.getHex() === Dl.site.d.paint[5]`), 'the arrow key steps the paint');
    await D(`Dl.close(); window.__h.foot(3); d.game.hold('dealer'); Dl.open(3); Dl.pick(Dl.site.d.stock.findIndex((r) => r[0] === 'volvo'));`);
    r = JSON.parse(await D(`const sw = Dl.swatches(); return JSON.stringify({ sw: sw.map((x) => x.li), liv: d.TYPES.volvo.liveries.length })`));
    ok(r.sw.length >= 3 && r.sw.every((li) => li >= 0), `a livery type (the Volvo) offers its own liveries (${r.sw.length})`);
    await D(`Dl.close();`);

    // ---------------------------------------------------------------- too poor
    console.log('--- too poor');
    await D(`window.__h.foot(0); d.game.money = 1000; d.game.hold('dealer'); Dl.open(0); Dl.pick(0);`);
    await sleep(300);
    r = JSON.parse(await D(`return JSON.stringify({ dis: Dl.ui.buy.disabled, txt: Dl.ui.buy.textContent, poor: Dl.ui.list.querySelectorAll('span.poor').length })`));
    ok(r.dis && /NEED \$8,800 MORE/.test(r.txt) && r.poor === st.ford.length, `BUY greys out with how much more ("${r.txt}")`);
    await press('enter'); await sleep(150); await press('enter');
    ok(await D(`return d.game.money === 1000 && Dl.stats.bought.length === 0`), 'ENTER at it charges nothing');
    await shot('poor');
    await D(`Dl.close();`);

    // ---------------------------------------------------------------- buying
    console.log('--- buying');
    await D(`for (const k of Object.keys(Gs.data)) Gs.data[k] = [null, null, null]; Gs.save(); d.game.money = 50000; window.__h.foot(0); window.__h.clearCars(0, 4);`);
    await sleep(700);
    await press('e');
    await until('window.__dbg.dealer.active', 6);
    const want = JSON.parse(await D(`Dl.pick(${st.ford.indexOf('sports')}); Dl.paint(4); const to = Dl.deliverTo(Dl.site);
      const near = Gs.sites.map((q) => Math.hypot(q.mx - Dl.site.x, q.mz - Dl.site.z)); return JSON.stringify({ g: to.q.g.id, i: to.i, nearest: near.indexOf(Math.min(...near)), c: Dl.site.d.paint[4] })`));
    ok(want.i === want.nearest, `delivery goes to the nearest garage (${want.g})`);
    await click('#dlUi .dlBuy');
    await sleep(200);
    r = JSON.parse(await D(`return JSON.stringify({ money: d.game.money, txt: Dl.ui.buy.textContent, n: Dl.stats.bought.length })`));
    ok(r.money === 50000 && r.n === 0 && /SIGN/.test(r.txt), `the first BUY asks (button "${r.txt}"), charges nothing`);
    await shot('confirm');
    await click('#dlUi .dlBuy');
    await sleep(300);
    r = JSON.parse(await D(`return JSON.stringify({ money: d.game.money, rec: Gs.data['${want.g}'].find(Boolean), ls: JSON.parse(localStorage.getItem('autokw-dealer')), lsg: JSON.parse(localStorage.getItem('autokw-garages')), say: Dl.ui.say.textContent, toast: window.__toasts.find((t) => /first car/.test(t)) || window.__toasts.slice(-1)[0] })`));
    ok(r.money === 50000 - pr('ford', 'sports'), `the second charges the price ($${50000 - r.money})`);
    ok(r.rec && r.rec.t === 'sports' && r.rec.c === want.c, `the record is in ${want.g}: ${JSON.stringify(r.rec)}`);
    ok(r.ls && r.ls.bought.length === 1 && r.ls.bought[0].t === 'sports' && r.ls.bought[0].d === 'ford' && r.lsg.g[want.g].some((q) => q && q.t === 'sports'), 'saved: autokw-dealer history and autokw-garages');
    ok(/first car/i.test(r.toast) && /Sold!/.test(r.say), `the first-purchase toast ("${r.toast}")`);
    await shot('sold');
    await click('#dlUi .dlX');
    await sleep(300);
    ok(await D(`return Dl.passportRow().label === 'Cars bought' && Dl.passportRow().text === '1'`), 'the passport row: Cars bought 1');
    // go to the garage: the car stands in the stall in its paint
    await D(`const q = Gs.sites[${want.i}], s = q.s; const x = s.ox - s.nx * 12, z = s.oz - s.nz * 12; d.player.respawn(x, z); d.player.heading = Math.atan2(s.nx, s.nz); d.world.update(x, z, 60);`);
    const spawned = await until(`(() => { const q = window.__dbg.garages.sites[${want.i}]; return q.cars.some((c) => c && c.typeName === 'sports'); })()`, 20);
    r = JSON.parse(await D(`const q = Gs.sites[${want.i}], c = q.cars.find((c) => c && c.typeName === 'sports'); return JSON.stringify(c ? { col: c.bodyMat.color.getHex(), mode: c.mode, door: q.k } : null)`));
    ok(spawned && r && r.col === want.c && r.mode === 'apron', `going there, the bought car stands in the stall in its paint (${JSON.stringify(r)})`);
    await sleep(3500);
    await shot('garage-bought');

    // ---------------------------------------------------------------- all garages full
    console.log('--- all garages full');
    await D(`for (const q of Gs.sites) Gs.data[q.g.id] = [0, 1, 2].map(() => ({ t: 'sedan', c: 0x777777, li: -1 })); Gs.save(); d.game.money = 50000;
      window.__h.foot(1); d.game.hold('dealer'); Dl.open(1); Dl.pick(0);`);
    await sleep(300);
    r = JSON.parse(await D(`return JSON.stringify({ dis: Dl.ui.buy.disabled, say: Dl.ui.say.textContent, b: Dl.buy(), money: d.game.money, n: Dl.stats.bought.length })`));
    ok(r.dis && /Make room in a garage first/.test(r.say) && r.b === false && r.money === 50000 && r.n === 1, `garages full: refused before charging ("${r.say}")`);
    await D(`Dl.close(); for (const q of Gs.sites) Gs.data[q.g.id] = [null, null, null]; Gs.save();`);

    // ---------------------------------------------------------------- a job blocks it
    console.log('--- a job in hand');
    await D(`window.__h.foot(2); d.game.hold('dealer'); Dl.open(2); window.__taxiRun = d.taxi.run; d.taxi.on = true; d.taxi.run = d.taxi.run || { fake: 1 }; Dl.pick(1);`);
    r = JSON.parse(await D(`return JSON.stringify({ dis: Dl.ui.buy.disabled, test: Dl.ui.test.disabled, say: Dl.ui.say.textContent, b: Dl.buy(), t: Dl.testDrive(), money: d.game.money })`));
    ok(r.dis && r.test && /Finish the/.test(r.say) && r.b === false && r.t === false && r.money === 50000, `a taxi shift blocks BUY and TEST DRIVE ("${r.say}")`);
    await D(`d.taxi.on = false; d.taxi.run = window.__taxiRun || null; Dl.close();`);

    // ---------------------------------------------------------------- test drive
    console.log('--- test drive');
    await D(`window.__h.foot(0); window.__h.clearCars(0, 4);`);
    await sleep(500);
    await press('e');
    await until('window.__dbg.dealer.active', 6);
    await D(`Dl.pick(${st.ford.indexOf('muscle')}); Dl.paint(4);`);
    await click('#dlUi .dlTest');
    await sleep(400);
    r = JSON.parse(await D(`const v = d.player.vehicle; return JSON.stringify({ open: Dl.active, holds: [...d.game.holds], t: v && v.typeName, td: !!Dl.td, test: v && v.testDrive, fits: v && Gs.fits(v),
      exp: v && d.exportYard ? d.exportYard.refusal(v, d.player) : 'n/a', busy: d.taxi.busy ? d.taxi.busy() : null, obj: document.getElementById('objective').textContent,
      col: v && v.bodyMat.color.getHex(), d: v ? Math.hypot(v.x - Dl.sites[0].x, v.z - Dl.sites[0].z) : -1 })`));
    ok(!r.open && !r.holds.includes('dealer') && r.t === 'muscle' && r.td && r.test && r.d < 30, `TEST DRIVE puts you in the car (${r.t}, ${r.d.toFixed(1)} m from the door) and lets the world go`);
    ok(r.fits === false && /demo/.test(r.exp), `the demo is refused by the garages and the export yard ("${r.exp}")`);
    ok(r.busy === 'test drive' && /TEST DRIVE 1:00|TEST DRIVE 0:5/.test(r.obj), `jobs see the test drive ("${r.busy}"); the timer shows ("${r.obj}")`);
    await sleep(1500);
    await shot('testdrive');
    // away and back: the showroom again
    await D(`const v = d.player.vehicle, s = Dl.td.spot; v.place(s.x + 30, s.z + 30, v.heading); Dl.td.away = false;`);
    await sleep(300);
    await D(`const v = d.player.vehicle; v.place(v.x + 40, v.z, v.heading);`);
    await sleep(400);
    ok(await D(`return !!(Dl.td && Dl.td.away)`), 'driving off the lot counts as away');
    await D(`const v = d.player.vehicle, s = Dl.td.spot; v.place(s.x + 3, s.z, v.heading); v.vLong = 0;`);
    const back = await until('window.__dbg.dealer.active', 6);
    r = JSON.parse(await D(`return JSON.stringify({ open: Dl.active, holds: [...d.game.holds], foot: d.player.onFoot, sel: Dl.item && Dl.item[0], cars: d.traffic.cars.filter((c) => c.testDrive).length, say: Dl.ui.say.textContent })`));
    ok(back && r.foot && r.sel === 'muscle' && r.cars === 0 && r.holds.includes('dealer'), `brought back: on foot, the demo gone, the showroom again on the same car ("${r.say}")`);
    // time up
    await click('#dlUi .dlTest');
    await sleep(400);
    await D(`Dl.td.t = 1.2;`);
    const gone = await until('!window.__dbg.dealer.td', 12);
    r = JSON.parse(await D(`return JSON.stringify({ foot: d.player.onFoot, cars: d.traffic.cars.filter((c) => c.testDrive).length, toast: window.__toasts.find((t) => /Time's up/.test(t)) || window.__toasts.slice(-1)[0], obj: document.getElementById('objective').textContent })`));
    ok(gone && r.foot && r.cars === 0 && /Time's up/.test(r.toast) && !/TEST DRIVE/.test(r.obj), `time up: the car goes back ("${r.toast}"; the objective back to "${r.obj}")`);
    ok(await D(`return Dl.stats.tests === 2`), 'test drives counted');

    // ---------------------------------------------------------------- respawn
    console.log('--- respawn');
    await D(`window.__h.foot(0); d.game.hold('dealer'); Dl.open(0);`);
    await sleep(300);
    await D(`d.doRespawn();`);
    await sleep(500);
    r = JSON.parse(await D(`return JSON.stringify({ open: Dl.active, holds: [...d.game.holds], pv: !!Dl.pv, show: Dl.el.classList.contains('show') })`));
    ok(!r.open && !r.holds.includes('dealer') && !r.pv && !r.show, `respawn shuts the showroom and lets go of the world (${JSON.stringify(r)})`);
    await D(`window.__h.foot(0); d.game.hold('dealer'); Dl.open(0); Dl.testDrive();`);
    await sleep(300);
    await D(`d.doRespawn();`);
    await sleep(500);
    ok(await D(`return !Dl.td && d.traffic.cars.every((c) => !c.testDrive)`), 'respawn mid-test-drive sends the demo back');

    // ---------------------------------------------------------------- cost
    console.log('--- cost');
    r = JSON.parse(await D(`const R = d.renderer; window.__h.foot(0); d.game.hold('dealer'); Dl.open(0); Dl.pick(${st.ford.indexOf('pickup')});
      R.info.autoReset = false; R.info.reset(); Dl._pvDraw(); const c = { calls: R.info.render.calls, tris: R.info.render.triangles }; R.info.autoReset = true; Dl.close();
      return JSON.stringify(c)`));
    console.log(`    one turntable frame: ${r.calls} draws, ${r.tris} tris (only while the showroom is open)`);
    ok(await D(`return d.scene.children.every((o) => !o.userData || !o.userData.dealer) && !Dl.pv`), 'nothing of the dealers is in the city scene while closed');

    console.log(`exceptions: ${errs.length}`);
    for (const e of errs.slice(0, 6)) console.log('   ', e.split('\n')[0]);
    ok(errs.length === 0, 'no page exceptions');
  } finally {
    closing = true;
    chrome.kill();
  }
  console.log(fails ? `FAILED ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); closing = true; process.exit(1); });
