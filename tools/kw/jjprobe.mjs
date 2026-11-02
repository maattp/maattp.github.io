// Auto KW: rip packs at J&J (src/jjcards.js, src/jjart.js). Walks to the shop's
// door, presses ENTER, buys and tears and flips packs through the real DOM and
// key events, checks the odds over 100k seeded packs, persistence, selling, the
// set-complete reward and trophy, and that ENTER beside a parked car at the
// door still enters the car. Screenshots every stage.
//
//   AUTO_HTTP_PORT=8207 AUTO_CDP_PORT=9507 AUTO_GPU=1 node tools/kw/jjprobe.mjs <outdir>
//   PHONE=1  874x402 landscape (default 1280x720; run both)
//   SHEET=1  also write a contact sheet of all 60 cards (<outdir>/sheet-N.png)
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9507;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8207;
const OUT = process.argv[2] || 'tools/data/kw/jjshots';
const PHONE = process.env.PHONE === '1';
const [W, H] = PHONE ? [874, 402] : [1280, 720];
const TAG = PHONE ? 'phone' : 'desk';

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-shots-profile-${PORT}`, width: W, height: H, extra: ['--autoplay-policy=no-user-gesture-required'] });
  let fails = 0;
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map(); const errs = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception');
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + (m.params.args || []).map((a) => a.value || a.description).join(' '));
    });
    const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
    const ev = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
      return r.result?.result?.value;
    };
    const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
    mkdirSync(OUT, { recursive: true });
    const shot = async (name) => {
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
      writeFileSync(`${OUT}/jj-${TAG}-${name}.jpg`, Buffer.from(result.data, 'base64'));
      console.log(`    shot ${OUT}/jj-${TAG}-${name}.jpg`);
    };
    const until = async (js, ms = 20000, step = 150) => { for (let t = 0; t < ms; t += step) { if (await ev(js)) return true; await sleep(step); } return false; };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    if (PHONE) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true, screenWidth: W, screenHeight: H, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true; try { localStorage.removeItem("autokw-jjcards"); } catch (e) {}' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    for (let i = 0; i < 400; i++) { if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality)').catch(() => false)) break; await sleep(500); }
    console.log('  booted; exceptions so far:', errs.length);
    await sleep(2500);
    await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true); const g = document.getElementById('startBtn') || document.getElementById('play'); if (g) g.click(); })()`);
    await sleep(1500);

    check(await ev('!!window.__dbg.jj'), 'the module exists (__dbg.jj)');
    const door = await ev('window.__dbg.jj.door');
    check(Array.isArray(door) && door.every(Number.isFinite), `J&J's door is exported by the landmark build (${JSON.stringify(door)})`);
    const lm = await ev('window.__kwLm2.jjFront');
    console.log('    front', JSON.stringify(lm));
    check(Math.hypot(door[0] - lm[0], door[1] - lm[1]) < 12, 'the door is on the front edge (within 12 m of its middle)');
    check(await ev('window.__dbg.jj.stats.packs === 0 && window.__dbg.jj.distinct === 0'), 'starts with an empty binder');

    if (process.env.SHEET) {
      const sheets = await ev(`(async () => {
        const m = await import('/apps/autokw/src/jjart.js'); const out = [];
        for (let s = 0; s < 3; s++) {
          const cv = document.createElement('canvas'); cv.width = 10 * 150; cv.height = 2 * 210; const g = cv.getContext('2d');
          for (let i = 0; i < 20; i++) { const id = s * 20 + i; g.save(); g.translate((i % 10) * 150, Math.floor(i / 10) * 210); m.drawCardBase(g, m.SET[id], 150, 210); g.restore(); }
          out.push(cv.toDataURL('image/png'));
        }
        return out; })()`);
      sheets.forEach((d, i) => writeFileSync(`${OUT}/sheet-${i}.png`, Buffer.from(d.split(',')[1], 'base64')));
      console.log('    contact sheets written');
    }

    // ---- ENTER at the door, with a car at the kerb: the car wins
    const foot = (x, z) => `(() => { const d = window.__dbg, p = d.player; if (!p.onFoot && p.exitVehicle) p.exitVehicle(); p.respawn(${x}, ${z}); d.game.money = 100; })()`;
    const key = (code) => ev(`(() => { for (const t of ['keydown','keyup']) window.dispatchEvent(new KeyboardEvent(t, { code: '${code}', key: '${code}', bubbles: true })); })()`);
    await ev(foot(door[0] + 0, door[1] + 0));
    await sleep(1200);
    await ev(`(() => { const d = window.__dbg; d.game.wanted = 0; const p = d.player; d.__car = d.traffic.spawnAt(p.x + 2.2, p.z, 0, 'sedan', 0x2060b0, 'free'); })()`);
    await sleep(800);
    await key('KeyE');
    await sleep(1500);
    let st = await ev('({ on: window.__dbg.player.onFoot, jj: window.__dbg.jj.active, holds: [...window.__dbg.game.holds] })');
    check(!st.on && !st.jj, `ENTER by a parked car at J&J's door enters the car (onFoot ${st.on}, shop open ${st.jj})`);
    await ev(`(() => { const d = window.__dbg, p = d.player; if (!p.onFoot && p.exitVehicle) p.exitVehicle(); })()`);
    await sleep(600);
    await ev(`(() => { const d = window.__dbg; if (d.__car) { const i = d.traffic.cars.indexOf(d.__car); if (i >= 0) d.traffic.cars.splice(i, 1); if (d.__car.group) d.__car.group.visible = false; d.__car.x = 99999; d.__car.z = 99999; } })()`);

    // ---- ENTER with no car: the shop opens and holds the world
    await ev(foot(door[0], door[1]));
    await sleep(1200);
    await key('KeyE');
    check(await until('window.__dbg.jj.active', 8000), 'ENTER at the door with no car opens the shop');
    st = await ev('({ holds: [...window.__dbg.game.holds], mode: window.__dbg.jj.mode, money: window.__dbg.game.money })');
    check(st.holds.includes('jj') && st.mode === 'shop', `the world is held ('jj') and the counter is up (${JSON.stringify(st)})`);
    await sleep(600);
    await shot('1-shop');

    // ---- buy: a rigged pack with a holo, a rare, and the Goose
    const clickAct = (a) => ev(`(() => { const b = document.querySelector('#jjUi [data-act="${a}"]'); if (!b) return false; b.click(); return true; })()`);
    const stage = (type, x, y, extra = '') => ev(`(() => { const cv = document.querySelector('#jjUi .jjStage canvas'), r = cv.getBoundingClientRect();
      cv.dispatchEvent(new PointerEvent('${type}', { pointerId: 7, pointerType: 'touch', bubbles: true, clientX: r.left + ${x}, clientY: r.top + ${y}${extra} })); })()`);
    await ev('window.__dbg.jj.rig = [12, 3, 31, 47, 56, 60]');
    check(await clickAct('buy'), 'the BUY button is there');
    await sleep(300);
    st = await ev('({ money: window.__dbg.game.money, mode: window.__dbg.jj.mode, packs: window.__dbg.jj.stats.packs })');
    check(st.money === 95 && st.mode === 'tear' && st.packs === 1, `a pack costs $5 and goes to the wrapper (${JSON.stringify(st)})`);
    await sleep(500);
    await shot('2-wrapper');
    // tear by dragging across the top
    const geo = await ev('(() => { const r = window.__dbg.jj.pkRect; return r; })()');
    const ty = geo.y + geo.h * 0.1;
    await stage('pointerdown', geo.x + 4, ty);
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      await stage('pointermove', geo.x + 4 + (geo.w - 8) * i / steps * 0.95, ty);
      if (i === 6) { await sleep(500); await shot('3-tearing'); }
    }
    await stage('pointerup', geo.x + geo.w - 4, ty);
    check(await until('window.__dbg.jj.mode === "reveal"', 15000), 'the swipe tears the wrapper and the cards come out');
    await sleep(900);
    await shot('4-first-card');
    // flip through with taps
    let sawHolo = false, sawGoose = false;
    for (let n = 0; n < 40; n++) {
      const s2 = await ev('({ mode: window.__dbg.jj.mode, i: window.__dbg.jj.rv && window.__dbg.jj.rv.i, flip: window.__dbg.jj.rv && window.__dbg.jj.rv.flip, out: window.__dbg.jj.rv && window.__dbg.jj.rv.out, enter: window.__dbg.jj.rv && window.__dbg.jj.rv.enter })');
      if (s2.mode !== 'reveal') break;
      if (s2.i === 4 && s2.flip >= 1 && !sawHolo) { sawHolo = true; await sleep(400); await shot('5-holo'); }
      if (s2.i === 5 && s2.flip >= 1 && !sawGoose) { sawGoose = true; await sleep(400); await shot('6-golden-goose'); }
      if (s2.i === 5 && s2.flip < 1 && s2.enter >= 1 && !s2.face) { await sleep(200); await shot('5b-goose-facedown'); }
      await stage('pointerdown', 50, 50); await stage('pointerup', 50, 50);
      await sleep(350);
    }
    check(await until('window.__dbg.jj.mode === "summary"', 15000), 'tapping through all six cards reaches the summary');
    await sleep(600);
    await shot('7-summary');
    st = await ev('({ owned: window.__dbg.jj.stats.owned, d: window.__dbg.jj.distinct, ls: localStorage.getItem("autokw-jjcards") })');
    check(st.d === 6 && [12, 3, 31, 47, 56, 60].every((i) => st.owned[i] === 1), `the six cards are in the binder (${st.d} different)`);
    check(!!st.ls && JSON.parse(st.ls).owned[60] === 1, 'saved in localStorage autokw-jjcards');

    // ---- binder, zoom
    await clickAct('binder');
    await sleep(700);
    await shot('8-binder');
    await ev('window.__dbg.jj._page(1)'); await sleep(400);
    const cell = await ev('(() => { const j = window.__dbg.jj; const c = j.cells.find((x) => j.count(x.id) > 0); return c ? { x: c.x + c.w / 2, y: c.y + c.h / 2 } : null; })()');
    await ev('window.__dbg.jj.page = 0; window.__dbg.jj._side()'); await sleep(300);
    const c3 = await ev('(() => { const j = window.__dbg.jj; const c = j.cells.find((x) => x.id === 3); return { x: c.x + c.w / 2, y: c.y + c.h / 2 }; })()');
    await stage('pointerdown', c3.x, c3.y); await stage('pointerup', c3.x, c3.y);
    await sleep(500);
    st = await ev('window.__dbg.jj.mode');
    check(st === 'zoom', `tapping an owned card zooms it (${st})`);
    await stage('pointermove', 400, 100);
    await sleep(700);
    await shot('9-zoom');
    await key('Escape'); await sleep(300);
    check((await ev('window.__dbg.jj.mode')) === 'binder', 'Escape backs out of the zoom to the binder');
    await ev('window.__dbg.jj.page = 5; window.__dbg.jj._side()'); await sleep(500);
    await shot('10-binder-last-page');

    // ---- selling: two spares -> $
    await ev('window.__dbg.jj.stats.owned[12] = 3; window.__dbg.jj.stats.owned[56] = 2; window.__dbg.jj._side()');
    const before = await ev('window.__dbg.game.money');
    await clickAct('sell');
    await sleep(300);
    const after = await ev('window.__dbg.game.money');
    // 2 spares of #12 (common, $1) + 1 spare of #56 (holo, $20)
    check(after - before === 22, `selling spares pays by rarity: 2 commons + 1 holo = $22 (got $${after - before})`);
    check((await ev('window.__dbg.jj.spareCount()')) === 0, 'no spares left');

    // ---- persistence: a fresh instance reads the same save
    const pers = await ev(`(async () => { const m = await import('/apps/autokw/src/jjcards.js'); const j = new m.JJCards({ audio: null, money: () => 0, charge: () => false, onReward() {}, onToast() {}, onEnd() {} });
      return { d: j.distinct, packs: j.stats.packs, goose: j.count(60) }; })()`);
    check(pers.d === 6 && pers.packs === 1 && pers.goose === 1, `a new instance loads the saved binder (${JSON.stringify(pers)})`);

    // ---- leave; the hold is released
    await key('Escape'); await sleep(200);
    await key('Escape'); await sleep(500);
    st = await ev('({ a: window.__dbg.jj.active, holds: window.__dbg.game.holds.size, leaks: window.__dbg.game.leaks.length })');
    check(!st.a && st.holds === 0 && st.leaks === 0, `leaving releases the hold (${JSON.stringify(st)})`);

    // ---- odds: 100k seeded packs
    const odds = await ev(`(() => { const j = window.__dbg.jj; let a = 12345; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const o = j.odds(100000, rnd); delete o.perCard; return o; })()`);
    console.log('    odds', JSON.stringify(odds));
    const gp = odds.gPacks / odds.packs;
    check(Math.abs(gp - 1 / 500) < 0.00085, `Golden Goose is ~1 pack in 500 (${odds.gPacks} in ${odds.packs} = 1 in ${(1 / gp).toFixed(0)})`);
    const frac = (r) => odds[r] / odds.cards;
    check(frac('c') > 0.6 && frac('c') < 0.76 && frac('u') > 0.17 && frac('r') > 0.04 && frac('h') > 0.01 && frac('h') < 0.04, `rarity mix is sane (c ${frac('c').toFixed(3)} u ${frac('u').toFixed(3)} r ${frac('r').toFixed(3)} h ${frac('h').toFixed(4)} g ${frac('g').toFixed(5)})`);
    const setCk = await ev(`(async () => { const m = await import('/apps/autokw/src/jjart.js'); const c = {}; for (const x of m.SET) c[x.r] = (c[x.r] || 0) + 1; return { n: m.SET.length, c }; })()`);
    check(setCk.n === 60 && setCk.c.c === 30 && setCk.c.u === 14 && setCk.c.r === 9 && setCk.c.h === 6 && setCk.c.g === 1, `the set is 60: ${JSON.stringify(setCk.c)}`);

    // ---- not enough money
    await ev(foot(door[0], door[1]));
    await ev('window.__dbg.game.money = 3');
    await sleep(1500); await key('KeyE');
    await until('window.__dbg.jj.active', 8000);
    await clickAct('buy'); await sleep(300);
    st = await ev('({ mode: window.__dbg.jj.mode, money: window.__dbg.game.money, say: document.querySelector("#jjUi .jjSay").textContent })');
    check(st.mode === 'shop' && st.money === 3, `too poor: nothing is charged and you stay at the counter ("${st.say.slice(0, 60)}")`);
    await sleep(300); await shot('11-too-poor');

    // ---- the full set: the 59 + the Goose in one pack pays the bonus and hangs the trophy
    await key('Escape'); await sleep(300);
    await ev(`(() => { const j = window.__dbg.jj; for (let i = 1; i <= 59; i++) j.stats.owned[i] = 1; delete j.stats.owned[60]; j.stats.ms = [15, 30, 45]; window.__dbg.game.money = 100; })()`);
    await ev(foot(door[0], door[1]));
    await sleep(1500); await key('KeyE');
    await until('window.__dbg.jj.active', 8000);
    check(!(await ev('!!window.__dbg.scene.getObjectByName("jj-trophy")')), 'no trophy in the window before the set is complete');
    await ev('window.__dbg.jj.rig = [1, 2, 3, 4, 5, 60]');
    await clickAct('buy'); await sleep(300);
    const g2 = await ev('window.__dbg.jj.pkRect');
    await ev('window.__dbg.jj._tear(1)');
    check(await until('window.__dbg.jj.mode === "reveal"', 15000), 'the rigged pack opens');
    await ev('window.__dbg.jj._skipAll()'); await sleep(900);
    st = await ev('({ done: window.__dbg.jj.stats.done, money: window.__dbg.game.money, trophy: !!window.__dbg.scene.getObjectByName("jj-trophy"), d: window.__dbg.jj.distinct })');
    check(st.done && st.d === 60 && st.money === 100 - 5 + 1000 && st.trophy, `the full set pays $1000 and hangs a framed Golden Goose (${JSON.stringify(st)})`);
    await shot('12-set-complete');
    await key('Escape'); await sleep(200); await key('Escape'); await sleep(400);
    // the window, from the street
    const w = await ev('window.__kwLm2 && window.__dbg.jj.o.win()');
    if (w) {
      await ev(`(() => { const d = window.__dbg, w = ${JSON.stringify(w)}; d.game.paused = true; d.camera.position.set(w[0] + w[3] * 3.2 + w[4] * 0.8, w[1] - 0.3, w[2] + w[4] * 3.2 - w[3] * 0.8); d.camera.lookAt(w[0], w[1] - 0.1, w[2]); d.camera.updateMatrixWorld(); })()`);
      await sleep(1500); await shot('13-window-trophy');
    }
    // cost of the closed shop: nothing in the scene
    console.log('    draws', await ev('window.__dbg.renderer.info.render.calls'));

    check(errs.length === 0, `no exceptions (${errs.length}${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''})`);
  } finally {
    try { chrome.kill(); } catch { /* */ }
  }
  console.log(fails ? `FAILED ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
