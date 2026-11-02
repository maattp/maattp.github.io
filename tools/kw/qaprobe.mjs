// Auto KW: the cross-feature QA probe -- where the overnight features (v100-v118) meet.
//
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 node tools/kw/qaprobe.mjs [outdir] [sections]
//   AUTO_PHONE=1 ... (874 x 402, the phone layout shots)
//
// Each feature's own probe drives it alone; this one drives two at once. Boots like
// icecreamprobe.mjs (service worker bypassed, __noAutoQuality) and calls the systems'
// update(dt) by hand where a check needs a fixed frame. Exit 1 on a failure or a page exception.
// Sections (default all):
//   jobs    one job may not start over another: KW Eats does not log you on in a job vehicle
//           or mid-shift, taxi / police / paramedic / fire refuse over another job, and a car
//           wash ride counts as busy (M in an ice cream truck on the conveyor starts nothing);
//   layout  the HUD with a radio toast + airtime readout + LED panel + objective at once, and
//           the pause menu's passport rows (shots; overlaps are measured, not eyeballed).

import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PHONE = process.env.AUTO_PHONE === '1';
const OUT = process.argv[2] || 'tools/data/kw/qashots';
const ONLY = (process.argv[3] || 'jobs,layout').split(',');
let closing = false, fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

async function main() {
  const W = PHONE ? 874 : 1280, H = PHONE ? 402 : 720;
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-qa-profile-${PORT}`, width: W, height: H, extra: ['--autoplay-policy=no-user-gesture-required'] });
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
    const J = async (body) => JSON.parse(await ev(`(() => { const d = window.__dbg; const out = (() => { ${body} })(); return JSON.stringify(out === undefined ? null : out); })()`));
    mkdirSync(OUT, { recursive: true });
    const shot = async (name) => {
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
      writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(result.data, 'base64'));
      console.log(`  shot ${OUT}/${name}.jpg`);
    };

    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    if (PHONE) await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
    if (PHONE) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    let up = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.icecream && window.__dbg.carWash)')) { up = true; break; }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
    console.log(`booted; exceptions at boot: ${errs.length}`);
    await sleep(3000);
    await ev(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); const r = document.getElementById('rotate'); if (r) r.style.display = 'none';
      if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); })()`);
    await sleep(800);
    await ev(`window.__dbg.game.paused = false; window.__dbg.game.setWanted(0); window.__dbg.game.money = 500;
      window.__dbg.weather.set('clear', true); window.__dbg.events && (window.__dbg.events.enabled = false);`);

    // helpers in the page
    await ev(`window.__q = {
      inVeh(type, x, z, h = 0) {
        const d = window.__dbg;
        if (d.player.vehicle) d.player.exitVehicle(true);
        d.world.update(x, z, 60);
        const v = d.traffic.spawnAt(x, z, h, type, 0x2255aa, 'free'); d.player.enterVehicle(v); v.vLong = 0; v.vLat = 0;
        return v;
      },
      nearestRest(x, z) { const E = window.__dbg.eats; let b = null, bd = 1e9; for (const r of E.rest) { const dd = Math.hypot(r.x - x, r.z - z); if (dd < bd) { bd = dd; b = r; } } return [b, bd]; },
      quiet() { const d = window.__dbg; for (const s of [d.eats]) if (s.on) s.end(''); if (d.taxi.on) d.taxi.end(false, ''); if (d.icecream.run) d.icecream.end('', false);
        if (d.missions.run || d.missions.nextT > 0) d.missions.end(false, ''); if (d.paramedic.call || d.paramedic.nextT > 0) d.paramedic.end('', false, d.player); if (d.carWash.ride) d.carWash.abort(); },
      toast() { return document.getElementById('toast').textContent; },
    }`);

    // ------------------------------------------------------------------ jobs
    if (ONLY.includes('jobs')) {
      console.log('--- job exclusivity');
      // 1. the ice cream truck at its depot: is a KW Eats kitchen in reach?
      const dep = await J(`return d.icecream.depots.filter((s) => s.spots.length).map((s) => { const p = s.spots[0]; const [r, dd] = window.__q.nearestRest(p.x, p.z); return { name: s.name, rest: r && r.name, d: Math.round(dd) }; })`);
      console.log('  depots -> nearest KW Eats kitchen', JSON.stringify(dep));
      // sitting in the depot's own truck, stopped, for a few frames: no KW Eats shift
      const atDepot = await J(`window.__q.quiet(); const s = d.icecream.depots.find((q) => q.spots.length && q.vs && q.vs[0]); const v = s.vs[0];
        if (d.player.vehicle) d.player.exitVehicle(true); d.player.enterVehicle(v); v.vLong = 0;
        const [r] = window.__q.nearestRest(v.x, v.z); const v2 = d.player.vehicle;
        for (let i = 0; i < 5; i++) d.eats.update(0.05, d.player);
        const on = d.eats.on; window.__q.quiet(); return { on, rest: r.name, d: Math.round(Math.hypot(r.x - v.x, r.z - v.z)) }`);
      ok(!atDepot.on, `in the ice cream truck at its depot (${atDepot.rest} ${atDepot.d} m): KW Eats does not log you on`);
      // 2. an ice cream truck stopped by a kitchen mid-shift
      const icShift = await J(`window.__q.quiet(); const r = d.eats.rest[0]; const v = window.__q.inVeh('icecream', r.x + 6, r.z + 6);
        d.icecream.begin(d.player, 'ice'); for (let i = 0; i < 5; i++) d.eats.update(0.05, d.player);
        const out = { ic: !!d.icecream.run, eats: d.eats.on }; window.__q.quiet(); return out`);
      ok(icShift.ic && !icShift.eats, `ice cream shift stopped by a kitchen: KW Eats stays off (ic ${icShift.ic}, eats ${icShift.eats})`);
      // 3. a taxi on shift stopped by a kitchen (waiting for a fare)
      const taxiShift = await J(`window.__q.quiet(); const r = d.eats.rest[0]; window.__q.inVeh('taxi', r.x + 6, r.z + 6);
        d.taxi.toggle(d.player); for (let i = 0; i < 5; i++) d.eats.update(0.05, d.player);
        const out = { taxi: d.taxi.on, eats: d.eats.on }; window.__q.quiet(); return out`);
      ok(taxiShift.taxi && !taxiShift.eats, `taxi on shift stopped by a kitchen: KW Eats stays off (taxi ${taxiShift.taxi}, eats ${taxiShift.eats})`);
      // 4. KW Eats on (an order) in a taxi: T does not start a taxi shift over it
      const eatsTaxi = await J(`window.__q.quiet(); const r = d.eats.rest[0]; window.__q.inVeh('taxi', r.x + 6, r.z + 6);
        d.eats.begin(r, d.player); const e0 = d.eats.on; d.taxi.toggle(d.player);
        const out = { e0, taxi: d.taxi.on, t: window.__q.toast() }; window.__q.quiet(); return out`);
      ok(eatsTaxi.e0 && !eatsTaxi.taxi, `KW Eats order in a taxi: no taxi shift over it ("${eatsTaxi.t}")`);
      // 5. police missions over KW Eats
      const eatsCop = await J(`window.__q.quiet(); const r = d.eats.rest[0]; window.__q.inVeh('police', r.x + 6, r.z + 6);
        d.eats.begin(r, d.player); const e0 = d.eats.on; d.missions.toggle(d.player);
        const out = { e0, m: !!(d.missions.run || d.missions.nextT > 0), t: window.__q.toast() }; window.__q.quiet(); return out`);
      ok(eatsCop.e0 && !eatsCop.m, `KW Eats order in a police car: no police mission over it ("${eatsCop.t}")`);
      // 6. a car wash ride: M in an ice cream truck, P in an ambulance start nothing
      const wash = await J(`window.__q.quiet(); const q = d.carWash.sites[0]; const W0 = q.s;
        const v = window.__q.inVeh('icecream', d.carWash.sites[0].mx || 0, d.carWash.sites[0].mz || 0);
        d.carWash.start(q, v, d.player); const ride = !!d.carWash.ride;
        d.controls.btn.icmission = true; d.icecream.update(0.016, d.player); d.controls.btn.icmission = false; d.icecream.update(0.016, d.player);
        const out = { ride, ic: !!d.icecream.run, t: window.__q.toast() }; window.__q.quiet(); return out`);
      ok(wash.ride && !wash.ic, `on the car wash's conveyor, M in an ice cream truck starts no shift (ride ${wash.ride}, "${wash.t}")`);
      const washMed = await J(`window.__q.quiet(); const q = d.carWash.sites[0];
        const v = window.__q.inVeh('ambulance', q.mx || 0, q.mz || 0);
        d.carWash.start(q, v, d.player); const ride = !!d.carWash.ride;
        d.paramedic.toggle(d.player);
        const out = { ride, med: !!(d.paramedic.call || d.paramedic.nextT > 0), t: window.__q.toast() }; window.__q.quiet(); return out`);
      ok(washMed.ride && !washMed.med, `on the car wash's conveyor, MISSION in an ambulance starts no call (ride ${washMed.ride}, "${washMed.t}")`);
      await ev(`window.__q.quiet(); if (window.__dbg.player.vehicle) window.__dbg.player.exitVehicle(true)`);
      // 7. the cheat rule at the export yard: KWHEELS hands out four of its five rare types
      const ex = JSON.parse((await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
        const m = await import('/apps/autokw/src/cheats.js'); const d = window.__dbg, Y = d.exportYard, sp = d.player.position;
        const it = Y.st.list.find((r) => !Y.st.got.includes(r.t)); const v = window.__q.inVeh(it.t, sp.x, sp.z);
        const was = m.CHEAT.on; m.CHEAT.on = false; const clean = Y.refusal(v, d.player); m.CHEAT.on = true; const cheated = Y.refusal(v, d.player); m.CHEAT.on = was;
        d.player.exitVehicle(true); return JSON.stringify({ t: it.t, clean, cheated }); })()` })).result.result.value);
      ok(ex.clean === '' && /[Cc]heat/.test(ex.cheated), `export yard: a listed ${ex.t} is bought clean ("${ex.clean}"), refused cheated ("${ex.cheated}")`);
    }

    // ------------------------------------------------------------------ layout
    if (ONLY.includes('layout')) {
      console.log('--- the HUD crowded');
      await J(`const sp = d.player.position; const v = window.__q.inVeh('icecream', sp.x, sp.z); d.icecream.begin(d.player, 'ice');
        d.hud.showToast('♪ The Goose 101.9'); return 1`);
      await sleep(400);
      await J(`if (d.airtime && d.airtime._show) d.airtime._show({ tier: 2, name: 'BIG AIR', pay: 60 }, { air: 2.4, dist: 41, height: 6.1, flips: 1, spins: 0 }, 60, false, false); return 1`);
      await sleep(600);
      await shot(`hud-crowded${PHONE ? '-phone' : ''}`);
      const boxes = await J(`const ids = ['toast', 'objective', 'minimapWrap', 'pauseBtn']; const out = {};
        for (const i of ids) { const e = document.getElementById(i); if (e) { const b = e.getBoundingClientRect(); out[i] = [b.left | 0, b.top | 0, b.right | 0, b.bottom | 0, getComputedStyle(e).display]; } }
        const led = document.getElementById('jobLed'); if (led) { const b = led.getBoundingClientRect(); out.led = [b.left | 0, b.top | 0, b.right | 0, b.bottom | 0, getComputedStyle(led).display]; }
        const at = document.getElementById('airBig'); if (at) { const b = at.getBoundingClientRect(); out.air = [b.left | 0, b.top | 0, b.right | 0, b.bottom | 0]; }
        for (const b of document.querySelectorAll('[data-btn]')) { const r = b.getBoundingClientRect(); if (r.width > 0 && getComputedStyle(b).display !== 'none') out['btn:' + b.dataset.btn] = [r.left | 0, r.top | 0, r.right | 0, r.bottom | 0]; }
        return out`);
      console.log('  boxes', JSON.stringify(boxes));
      // the airtime readout drops under a job's LED panel (it sat behind it: v118)
      ok(boxes.led && boxes.air && boxes.air[1] >= boxes.led[3], `airtime readout (top ${boxes.air && boxes.air[1]}) clear of the LED panel (bottom ${boxes.led && boxes.led[3]})`);
      const btns = Object.entries(boxes).filter(([k]) => k.startsWith('btn:'));
      const hit = [];
      for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
        const [a, A] = btns[i], [b, B] = btns[j];
        if (A[0] < B[2] - 2 && B[0] < A[2] - 2 && A[1] < B[3] - 2 && B[1] < A[3] - 2) hit.push(`${a}/${b}`);
      }
      ok(!hit.length, `no two pad buttons overlap (${hit.join(', ') || 'none'})`);
      // every job vehicle's pad: its own buttons (SIREN, WATER, MISSION, FARE...) clear of each other and the stick zone
      await ev(`window.__q.quiet()`);
      for (const ty of ['ambulance', 'police', 'fireengine', 'snowplow', 'zamboni', 'taxi', 'wiener', 'icecream', 'artic']) {
        await J(`const sp = d.player.position; window.__q.inVeh('${ty}', sp.x, sp.z); return 1`);
        await sleep(700);
        const bb = await J(`const out = {}; for (const b of document.querySelectorAll('[data-btn]')) { const r = b.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && getComputedStyle(b).display !== 'none' && getComputedStyle(b).visibility !== 'hidden') out[b.dataset.btn] = [r.left | 0, r.top | 0, r.right | 0, r.bottom | 0]; } return out`);
        const e = Object.entries(bb), over = [], off = [];
        for (let i = 0; i < e.length; i++) {
          const [a, A] = e[i];
          if (A[0] < 0 || A[1] < 0 || A[2] > W || A[3] > H) off.push(a);
          for (let j = i + 1; j < e.length; j++) { const [b, B] = e[j]; if (A[0] < B[2] - 2 && B[0] < A[2] - 2 && A[1] < B[3] - 2 && B[1] < A[3] - 2) over.push(`${a}/${b}`); }
        }
        ok(!over.length && !off.length, `${ty}: ${e.map(([k]) => k).join(' ')} -- ${over.length ? 'OVERLAP ' + over.join(', ') : 'no overlap'}${off.length ? ', OFF-SCREEN ' + off.join(' ') : ''}`);
        if (over.length || off.length) await shot(`pad-${ty}${PHONE ? '-phone' : ''}`);
      }
      // a KW Stories subtitle (bottom centre) in a car with the pad up
      for (const ty of ['sedan', 'fireengine', 'icecream']) {
      await J(`const sp = d.player.position; window.__q.inVeh('${ty}', sp.x, sp.z); return 1`);
      await sleep(700);   // (the job buttons follow the vehicle on the next frames)
      const sub = await J(`const S = d.story;
        if (!S.el) S.ui();
        S.line = null; S.say([['gord', 'Right, listen. The Goose is on the air in ten minutes and the van is still parked behind the Aud with the keys in it.']]); S.subtitles(0.016);
        const el = document.getElementById('storySub'); if (!el) return null; const r = el.getBoundingClientRect();
        const hit = []; for (const b of document.querySelectorAll('[data-btn]')) { const q = b.getBoundingClientRect(); if (q.width > 0 && getComputedStyle(b).display !== 'none' && r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom) hit.push(b.dataset.btn); }
        return { box: [r.left | 0, r.top | 0, r.right | 0, r.bottom | 0], disp: getComputedStyle(el).display, hit }`);
      console.log(`  story subtitle (${ty})`, JSON.stringify(sub));
      await sleep(400);
      await shot(`story-sub-${ty}${PHONE ? '-phone' : ''}`);
      ok(sub && sub.disp !== 'none' && !sub.hit.length, `${ty}: a story subtitle clear of the pad buttons (${sub ? sub.hit.join(' ') || 'none' : 'no element'})`);
      }
      await J(`const S = d.story; S.lines.length = 0; S.line = null; S.subtitles(0.016); return 1`);
      await ev(`if (window.__dbg.player.vehicle) window.__dbg.player.exitVehicle(true)`);
      await ev(`window.__q.quiet()`);
      // the pause menu with every passport row
      await ev(`document.getElementById('pauseBtn').click()`);
      await sleep(1200);
      await shot(`pause${PHONE ? '-phone' : ''}`);
      const pz = await J(`const c = document.getElementById('pauseCard'); if (!c) return null; const b = c.getBoundingClientRect(); return { top: b.top | 0, bottom: b.bottom | 0, h: c.scrollHeight, ch: c.clientHeight, ov: getComputedStyle(c).overflowY, vh: innerHeight }`);
      console.log('  pause card', JSON.stringify(pz));
      ok(pz && pz.top >= 0 && pz.bottom <= pz.vh + 1 && (pz.h <= pz.ch || /auto|scroll/.test(pz.ov)), 'the pause card fits the screen or scrolls');
      // scrolled to the passport's new rows (codes, secrets, garages, export list)
      await ev(`(() => { const p = document.getElementById('passport'); if (p) p.scrollIntoView(); })()`);
      await sleep(500);
      await shot(`passport${PHONE ? '-phone' : ''}`);
      const rows = await J(`const p = document.getElementById('passport'); if (!p) return null; const b = p.getBoundingClientRect(); const t = p.innerText;
        const wide = [...p.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'visible' && e.children.length === 0).map((e) => e.textContent.slice(0, 40));
        return { w: b.width | 0, rows: t.split(String.fromCharCode(10)).length, codes: /Codes found/.test(t), secrets: /Secrets found|Rumour/.test(t), export: /Export list/.test(t), garage: /garage/i.test(t), wide: wide.slice(0, 6) }`);
      console.log('  passport', JSON.stringify(rows));
      ok(rows && rows.codes && rows.export && rows.garage, 'the passport has the codes, garage and export rows');
    }

    console.log(`page exceptions: ${errs.length}`);
    for (const e of errs.slice(0, 8)) console.log('  ', e.slice(0, 300));
    ok(errs.length === 0, '0 page exceptions');
    console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  } finally {
    closing = true;
    try { chrome.kill(); } catch { /* gone */ }
  }
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
