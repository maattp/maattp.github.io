// Auto KW: the body shops (respray.js) and the paramedic calls (paramedic.js), end to end.
//
//   node tools/kw/winterprobe.mjs [outdir] [plow,zam]    (AUTO_GPU=1; AUTO_HTTP_PORT / AUTO_CDP_PORT)
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
const OUT = process.argv[2] || 'tools/data/kw/wintershots';
const ONLY = (process.argv[3] || 'plow,zam').split(',');
let closing = false, fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-winter-profile-${PORT}`, width: 1280, height: 720, extra: ['--autoplay-policy=no-user-gesture-required'] });
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
      if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.winter)')) { up = true; break; }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
    console.log(`booted; exceptions at boot: ${errs.length}`);
    await sleep(3000);
    await ev(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); const r = document.getElementById('rotate'); if (r) r.style.display = 'none';
      if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); })()`);
    await sleep(800);

    await ev(`window.__h = {
      enter(type, x, z) {
        const d = window.__dbg;
        if (d.player.vehicle) d.player.exitVehicle(true);
        let v = d.traffic.cars.find((c) => c.typeName === type && c.mode === 'apron');
        if (!v) v = d.traffic.spawnAt(x, z, 0, type, 0xe8660c, 'apron');
        if (x != null) { v.place(x, z, 0); d.world.update(x, z, 60); }
        v.vLong = 0; v.dead = false;
        d.player.enterVehicle(v);
        return v;
      },
      mem() { const m = window.__dbg.renderer.info.memory; return [m.geometries, m.textures, window.__dbg.scene.children.length]; },
    }`);
    const W = (e) => ev(`(() => { const d = window.__dbg, J = d.winter; ${e} })()`);
    await ev(`window.__dbg.game.paused = false; window.__dbg.game.setWanted(0); window.__dbg.game.money = 100;`);

    if (ONLY.includes('plow')) {
      console.log('--- plow');
      console.log('  places', await W(`return JSON.stringify(d.hud.places.filter((p) => p.kind === 'winter').map((p) => [p.name, p.x | 0, p.z | 0]))`));
      const nRigs = await W(`return d.traffic.cars.filter((c) => c.typeName === 'snowplow' && c.mode === 'apron').length`);
      ok(nRigs >= 1, `${nRigs} plow(s) parked in the Region's yard`);
      await W(`window.__h.enter('snowplow', 700, 560)`);
      await W(`const p = d.player.position; const r = d.city.respawnPointNear(p.x, p.z, 200); const v = d.player.vehicle; if (r) { v.place(r.x, r.z, 0); d.world.update(r.x, r.z, 60); }`);
      await sleep(1500);
      ok(await ev(`document.getElementById('app').dataset.winter === '1'`), 'the MISSION button shows in the plow');
      // 1: no snow
      await W(`d.weather.set('clear', true)`);
      await sleep(300);
      const m0 = await ev('window.__h.mem()');
      await key('m', true); await sleep(150); await key('m', false); await sleep(400);
      ok(!(await W(`return !!J.plow.run`)), 'no snow on the ground: the plow refuses');
      ok(/No snow/.test(await ev(`document.getElementById('toast').textContent`)), 'with "No snow to clear -- come back in a storm"');
      // 2: snow, at dusk
      await W(`d.weather.set('snow', true); d.tod.mode = 'dusk'; d.tod._realT = -1e9; d.tod.solve(new Date()); d.tod.apply(true);`);
      await sleep(500);
      await key('m', true); await sleep(150); await key('m', false);
      ok(await until(`!!window.__dbg.winter.plow.run`, 8), 'snow on the ground: M starts the route');
      const R = JSON.parse(await W(`const R = J.plow.run; return JSON.stringify({ n: R.segs.length, total: R.total, left: R.left, fare: !!d.hud.fare, line: d.hud.fare && d.hud.fare.route.length, beam: !!J.plow.beam, segs: R.segs.map((s) => [s.name, Math.round(s.len)]) })`));
      console.log('  route', JSON.stringify(R).slice(0, 500));
      ok(R.n >= 5 && R.n <= 20, `route of ${R.n} connected street segments`);
      ok(R.fare && R.line >= 2 * (R.n + 1) - 2 && R.beam, 'minimap route line + pin + beam');
      ok(await W(`const s = J.plow.run.segs; for (let i = 1; i < s.length; i++) if (Math.hypot(s[i].ax - s[i - 1].bx, s[i].az - s[i - 1].bz) > 1) return false; return true`), 'segments are a connected chain');
      const money0 = +(await W(`return d.game.money`));
      for (let k = 0; k < 2; k++) {
        const n = await W(`const s = J.plow.run.segs[${k}]; const v = d.player.vehicle; v.place(s.ax - s.dx * 6, s.az - s.dz * 6, Math.atan2(s.dx, s.dz)); d.world.update(s.ax, s.az, 60); return Math.ceil(s.len / 5) + 3`);
        await sleep(600);
        for (let i = 0; i < n; i++) {
          await W(`const s = J.plow.run.segs[${k}]; const v = d.player.vehicle, t = ${i} * 5 - 2; v.place(s.ax + s.dx * t - s.dx * 3.4, s.az + s.dz * t - s.dz * 3.4, Math.atan2(s.dx, s.dz)); v.vLong = 6;`);
          await sleep(160);
          if (k === 0 && i === 6) await shot('plow-spray');
        }
      }
      await sleep(500);
      const P = JSON.parse(await W(`const R = J.plow.run; return JSON.stringify({ cleared: R.cleared, paid: R.paid, money: d.game.money, samples: R.nSamples, left: R.left, T: R.T, draw: R.strip.geo.drawRange.count })`));
      console.log('  progress', JSON.stringify(P));
      ok(P.cleared >= 2, `two segments cleared (${P.cleared})`);
      ok(P.money - money0 === P.paid && P.paid > 40, `paid $${P.paid} for them`);
      ok(P.samples > 10 && P.draw > 0, `a cleared strip laid (${P.samples} samples, ${P.draw} indices)`);
      ok(P.left < P.T, 'the clock runs');
      await W(`const v = d.player.vehicle, s = J.plow.run.segs[1]; v.place(s.bx - s.dx * 12, s.bz - s.dz * 12, Math.atan2(s.dx, s.dz)); v.vLong = 5;`);
      await sleep(900); await shot('plow-cleared-strip');
      // an aerial of the route (the game paused so the chase camera leaves it alone)
      await W(`const R = J.plow.run, s = R.segs[0], e = R.segs[R.segs.length - 1], mx = (s.ax + e.bx) / 2, mz = (s.az + e.bz) / 2; d.game.paused = true; d.camera.position.set(s.ax - s.dz * 26 - s.dx * 30, d.city.groundAt(s.ax, s.az, null) + 30, s.az + s.dx * 26 - s.dz * 30); d.camera.lookAt(s.ax + s.dx * 60, d.city.groundAt(s.ax, s.az, null), s.az + s.dz * 60);`);
      await sleep(1500); await shot('plow-aerial');
      await W(`d.game.paused = false`);
      await W(`const v = d.player.vehicle, s = J.plow.run.segs[2]; v.place(s.ax + s.dx * 20, s.az + s.dz * 20, Math.atan2(s.dx, s.dz)); v.vLong = 30;`);
      await sleep(400);
      ok(+(await W(`return d.player.vehicle.vLong`)) <= 11.2, 'blade down: governed to 40 km/h');
      await W(`J.plow.run.left = 0.1`);
      ok(await until(`!window.__dbg.winter.plow.run`, 8), 'the clock ends the route');
      ok(await W(`return d.hud.fare === null && !J.plow.beam`), 'map marks and beam cleaned up');
      ok(await W(`return !d.player.vehicle.tilt.children.some((c) => c.material && c.material.color && c.material.color.getHex() === 0xffb000)`), 'beacon lamps removed');
      ok(await W(`return JSON.parse(localStorage.getItem('autokw-snowplow')).segments >= 2`), 'stats saved in autokw-snowplow');
      ok(await W(`return d.game.leaks.length === 0`), 'no leaked holds');
      // finish bonus
      await key('m', true); await sleep(150); await key('m', false);
      await until(`!!window.__dbg.winter.plow.run`, 8);
      await W(`const R = J.plow.run; for (const s of R.segs) { s.bins.fill(1); s.n = s.bins.length; J.plow.clearSeg(R, s); }`);
      ok(await until(`!window.__dbg.winter.plow.run`, 8), 'clearing every street ends the route');
      ok((await W(`return J.plow.last && J.plow.last.bonus`)) >= 150, 'finish bonus paid');
      // leak check: every GPU object the job made is disposed and nothing of it is left in the scene
      await key('m', true); await sleep(150); await key('m', false);
      await until(`!!window.__dbg.winter.plow.run`, 8); await sleep(1000);
      await W(`const R = J.plow.run; window.__disp = []; for (const g of [R.strip.geo, R.snow.geo, R.bacon.geo]) { const o = { n: 0 }; window.__disp.push(o); g.addEventListener('dispose', () => o.n++); } for (const m of [R.strip.mat, R.snow.mat]) { const o = { n: 0 }; window.__disp.push(o); m.addEventListener('dispose', () => o.n++); }`);
      ok(+(await W(`return d.scene.children.filter((c) => c.userData.winter).length`)) === 3, 'strip + snow + beam in the scene while plowing');
      await key('m', true); await sleep(150); await key('m', false); await sleep(500);
      ok(await W(`return window.__disp.every((o) => o.n >= 1)`), 'geometries and materials disposed');
      ok(await W(`return d.scene.children.filter((c) => c.userData.winter).length === 0`), 'nothing of the job left in the scene');
      await W(`d.weather.set('clear', true); d.tod.mode = d.tod.setting; d.tod._realT = -1e9; d.tod.solve(new Date()); d.tod.apply(true);`);
    }

    if (ONLY.includes('zam')) {
      console.log('--- zamboni');
      await W(`const v = d.traffic.cars.find((c) => c.typeName === 'zamboni'); window.__zam = v; if (d.player.vehicle) d.player.exitVehicle(true); v.place(532, 575, -Math.PI / 2); d.world.update(532, 575, 60); d.player.enterVehicle(v);`);
      await sleep(1500);
      await shot('zam-aud');
      await key('m', true); await sleep(150); await key('m', false);
      ok(await until(`!!window.__dbg.winter.zam.run`, 15), 'M in the Zamboni starts the session');
      console.log('  rink', await W(`const R = J.zam.run; return JSON.stringify({ site: [R.cx | 0, R.cz | 0], d: Math.hypot(R.cx - 532, R.cz - 575) | 0, ms: J.zam.siteMs | 0, held: d.game.held.size })`));
      ok(await W(`return d.scene.children.includes(J.zam.run.ice) && d.game.holds.size === 0`), 'a pop-up rink on open ground, nothing held');
      await sleep(1200); await shot('zam-start');
      const cov = () => W(`return J.zam.coverage(J.zam.run)`).then(Number);
      const c0 = await cov();
      for (let pass = 0; pass < 4; pass++) {
        const dir = pass % 2 ? -1 : 1;
        for (let i = 0; i <= 17; i++) {
          await W(`const R = J.zam.run, v = d.player.vehicle; if (!R) return; const x = R.cx + ${dir} * (-17 + ${i} * 2), z = R.cz - 8 + ${pass} * 2.9; v.place(x, z, ${dir > 0 ? 'Math.PI / 2' : '-Math.PI / 2'}); v.vLong = 5;`);
          await sleep(110);
        }
        if (pass === 1) await shot('zam-coverage');
      }
      const c1 = await cov();
      console.log('  coverage', c0.toFixed(3), '->', c1.toFixed(3));
      ok(c1 > c0 + 0.25, `coverage rises when driving (${(c1 * 100).toFixed(0)} %)`);
      const nt = JSON.parse(await W(`const z = J.zam, R = z.run; return JSON.stringify({ neat: z.neatness(R), over: R.over, left: R.left })`));
      ok(nt.neat > 0.5, `neat passes score well (neatness ${(nt.neat * 100).toFixed(0)} %, ${nt.over} overlap cells)`);
      const o0 = nt.over;
      for (let rep = 0; rep < 2; rep++) {
        for (let i = 0; i < 12; i++) { await W(`const R = J.zam.run, v = d.player.vehicle; v.place(R.cx - 17 + ${i} * 2, R.cz - 7.5, Math.PI / 2); v.vLong = 5;`); await sleep(110); }
        await W(`J.zam.run.t += 5`);
      }
      ok(+(await W(`return J.zam.run.over`)) > o0, 're-covering ice later counts as overlap');
      const money1 = +(await W(`return d.game.money`));
      await W(`J.zam.run.left = 0.05`);
      ok(await until(`!window.__dbg.winter.zam.run`, 8), 'the 90 s clock ends the session');
      const L = JSON.parse(await W(`return JSON.stringify({ last: J.zam.last, money: d.game.money, saved: JSON.parse(localStorage.getItem('autokw-zamboni')), pos: [window.__zam.x | 0, window.__zam.z | 0] })`));
      console.log('  result', JSON.stringify(L));
      ok(L.last.score > 0 && L.saved.best === L.last.score, `score ${L.last.score} saved as best in autokw-zamboni`);
      ok(L.money - money1 === L.last.pay, `paid $${L.last.pay}`);
      ok(Math.hypot(L.pos[0] - 532, L.pos[1] - 575) < 5, 'the Zamboni is back on the Aud apron');
      await key('m', true); await sleep(150); await key('m', false);
      await until(`!!window.__dbg.winter.zam.run`, 15); await sleep(1500);
      await W(`const R = J.zam.run; window.__disp = []; for (const g of [...R.geoms, ...R.mats, R.tex]) { const o = { n: 0 }; window.__disp.push(o); g.addEventListener('dispose', () => o.n++); }`);
      ok(+(await W(`return d.scene.children.filter((c) => c.userData.winter).length`)) === 2, 'ice + boards in the scene while playing');
      await key('m', true); await sleep(150); await key('m', false); await sleep(800);
      ok(await W(`return window.__disp.length === 5 && window.__disp.every((o) => o.n >= 1)`), 'ice and boards geometry, materials and the canvas texture all disposed');
      ok(await W(`return d.scene.children.filter((c) => c.userData.winter).length === 0`), 'nothing of the rink left in the scene');
      await key('m', true); await sleep(150); await key('m', false);
      await until(`!!window.__dbg.winter.zam.run`, 15);
      await W(`const z = J.zam, R = z.run; R.started = true; R.cov.fill(1); R.covered = R.cov.length - 3; z.stamp(R, R.cx, R.cz, R.cx + 0.1, R.cz);`);
      ok(await until(`!window.__dbg.winter.zam.run`, 8), '95 % coverage ends it early');
      ok(await W(`return J.zam.last.win === true`), 'flagged a win');
      await key('m', true); await sleep(150); await key('m', false);
      await until(`!!window.__dbg.winter.zam.run`, 15);
      await W(`d.player.exitVehicle(true)`);
      ok(await until(`!window.__dbg.winter.zam.run`, 8), 'leaving the Zamboni ends the session');
    }

    ok(errs.length === 0, `no page exceptions${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
    closing = true;
  } finally {
    chrome.kill('SIGKILL');
  }
  console.log(fails ? `FAILED ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('winterprobe failed:', e.message); process.exit(1); });
