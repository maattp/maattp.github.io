// Auto KW: your save garages (src/kwgarage.js), end to end.
//
//   node tools/kw/garageprobe.mjs [outdir]    (AUTO_GPU=1; AUTO_HTTP_PORT / AUTO_CDP_PORT)
//
// Boots like medprobe.mjs (service worker bypassed), leaves the game RUNNING. For each of the three
// garages: a sedan (respray'd a known colour) is put ~12 m out in front of the door and driven in on
// a real W press; asserts it is SAVED (autokw-garages, the colour as sprayed), the player is out on
// foot, the car stands inside as an 'apron' vehicle. Then the page is RELOADED (same localStorage) and
// the car must be back, the right type and colour, enterable (a real Enter press) and driving it out
// frees the slot. Also: a full garage refuses a 4th car, a bus is refused with the door shut, and the
// passport rows / map places list the contents. Exit 1 on a failure or a page exception.
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/garageshots';
let closing = false, fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-garage-profile-${PORT}`, width: 1280, height: 720, extra: ['--autoplay-policy=no-user-gesture-required'] });
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
    const KEYS = { w: ['KeyW', 'w', 87], s: ['KeyS', 's', 83], e: ['KeyF', 'f', 70] };
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
      if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.garages)')) { up = true; break; }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
    console.log(`booted; exceptions at boot: ${errs.length}`);
    await sleep(3000);
    await ev(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); const r = document.getElementById('rotate'); if (r) r.style.display = 'none';
      if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); })()`);
    await sleep(800);


    const D = (e) => ev(`(() => { const d = window.__dbg, Gs = d.garages; ${e} })()`);
    const boot = async () => {
      await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
      let up2 = false;
      for (let i = 0; i < 400; i++) {
        await sleep(500);
        try { if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.garages && window.__dbg.player)')) { up2 = true; break; } } catch { /* navigating */ }
      }
      if (!up2) throw new Error('never rebooted');
      await sleep(3000);
      await ev(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); const r = document.getElementById('rotate'); if (r) r.style.display = 'none';
        if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); })()`);
      await sleep(800);
      await ev(HSRC);
    };
    // a car at garage-local (lx, lz), facing in (+) or out (-), the player in it
    const HSRC = `window.__h = {
      put(i, lx, lz, dir, type, speed, col) {
        const d = window.__dbg, q = d.garages.sites[i], s = q.s, cr = Math.cos(s.rot), sr = Math.sin(s.rot);
        const x = s.ox + lx * cr - lz * sr, z = s.oz + lx * sr + lz * cr;
        let v = d.player.vehicle;
        if (v && v.typeName !== type) { d.player.exitVehicle(true); d.traffic.remove(v); v = null; }
        if (!v) { v = d.traffic.spawnAt(x, z, 0, type, col || 0x2255aa, 'free'); d.player.enterVehicle(v); }
        v.place(x, z, Math.atan2(dir * s.nx, dir * s.nz));
        v.vLong = speed || 0; v.vy = 0; v.dead = false;
        d.world.update(x, z, 60);
        return v;
      },
      foot(i, lz, lx) {
        const d = window.__dbg, q = d.garages.sites[i], s = q.s, cr = Math.cos(s.rot), sr = Math.sin(s.rot);
        if (d.player.vehicle) d.player.exitVehicle(true);
        const x = s.ox + (lx || 0) * cr - lz * sr, z = s.oz + (lx || 0) * sr + lz * cr;
        d.player.x = x; d.player.z = z; d.player.y = d.city.groundAt(x, z, null) + 0.1;
        d.player.heading = Math.atan2(s.nx, s.nz);
        d.world.update(x, z, 60);
      },
    }`;
    await ev(HSRC);
    console.log('--- sites');
    const sites = JSON.parse(await D(`return JSON.stringify(Gs.sites.map((q) => ({ id: q.g.id, ox: q.s.ox, oz: q.s.oz, dist: Math.round(q.s.dist), slope: q.s.slope, y: q.s.y })))`));
    console.log('  ', JSON.stringify(sites));
    ok(sites.length === 3, 'three garages were placed');
    ok(sites.every((s) => s.dist < 330), 'each within 330 m of its real place: ' + sites.map((s) => s.dist).join(', '));
    ok(await ev(`window.__dbg.hud.places.filter((p) => p.kind === 'garage').length === 3`), 'three map places (kind garage)');
    await D(`localStorage.removeItem('autokw-garages'); Gs.data.home = [null,null,null]; Gs.data.kitchener = [null,null,null]; Gs.data.galt = [null,null,null]; d.game.paused = false; d.game.wanted = 0;`);

    const COLS = [0xd2308f, 0x22b04a, 0xe8a41c];
    for (let i = 0; i < 3; i++) {
      const id = sites[i].id;
      console.log('--- save into ' + id);
      await D(`const v = window.__h.put(${i}, 0, -12, 1, 'sedan', 0, 0x2255aa); v.respray(${COLS[i]}); window.__v = v;`);
      await sleep(900);
      if (i === 0) await shot('home-street');
      await key('w', true);
      const saved = await until(`window.__dbg.garages.count(window.__dbg.garages.sites[${i}]) === 1`, 60);
      await key('w', false);
      ok(saved, 'driving in on W and stopping saved the car');
      await sleep(700);
      const st = JSON.parse(await D(`const q = Gs.sites[${i}]; return JSON.stringify({ ls: JSON.parse(localStorage.getItem('autokw-garages')), foot: d.player.onFoot, veh: !!d.player.vehicle, door: q.k, cars: q.cars.map((c) => c && { t: c.typeName, m: c.mode, col: c.bodyMat.color.getHex(), dead: c.dead }), old: window.__v.dead || d.traffic.cars.indexOf(window.__v) < 0 })`));
      const rec = st.ls.g[id].find(Boolean);
      ok(rec && rec.t === 'sedan' && rec.c === COLS[i], `saved ${JSON.stringify(rec)} with the sprayed colour 0x${COLS[i].toString(16)}`);
      ok(st.foot && !st.veh, 'the player is on foot, put out');
      const c0 = st.cars.find(Boolean);
      ok(c0 && c0.m === 'apron' && c0.col === COLS[i] && c0.t === 'sedan', 'the saved car stands inside as an apron vehicle in its colour');
      ok(st.old, 'the original vehicle is gone from traffic');
      ok(await D(`return Gs.sites[${i}].cars.filter(Boolean).every((c) => c.trimMesh.scale.x < 1.01 && Math.abs(c.trimMesh.scale.y - 1) < 1e-6)`), 'the stored car\'s trim mesh is not stretched (plate trick scale < 1 %)');
      if (i === 0) { await sleep(2500); await D(`window.__h.foot(0, -9, 0)`); await sleep(1800); await shot('home-door-open-car-inside'); await D(`window.__h.foot(0, -4.5, 3.4)`); await sleep(1500); await shot('home-close'); console.log('  cost', await D(`const q = Gs.sites[0]; let tris = 0, draws = 0; q.grp.traverse((o) => { if (o.isMesh && o.visible) { draws++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return JSON.stringify({ draws, tris: Math.round(tris), sceneDraws: d.renderer.info.render.calls })`)); }
    }
    await D(`window.__h.foot(0, -22, 0)`); await sleep(3500); await shot('home-door-closed');

    const rows = JSON.parse(await D(`return JSON.stringify(Gs.passportRows().concat(Gs.places().map((p) => p.hello())))`));
    console.log('  rows', JSON.stringify(rows));
    ok(rows.slice(0, 3).every((r) => r.done === 1 && /Sedan/.test(r.label)), 'passport rows list the car in each garage');

    console.log('--- reload');
    await boot();
    const cnt = JSON.parse(await D(`return JSON.stringify(Gs.data)`));
    ok(['home', 'kitchener', 'galt'].every((k, j) => cnt[k].find(Boolean) && cnt[k].find(Boolean).c === COLS[j]), 'the records survived the reload');
    for (let i = 0; i < 3; i++) {
      await D(`window.__h.foot(${i}, -14, 0); d.game.paused = false;`);
      await sleep(2500);
      const r = JSON.parse(await D(`const q = Gs.sites[${i}]; const j = q.cars.findIndex(Boolean); const c = q.cars[j]; return JSON.stringify({ j, t: c && c.typeName, m: c && c.mode, col: c && c.bodyMat.color.getHex(), inTraffic: !!c && d.traffic.cars.indexOf(c) >= 0, k: q.k })`));
      ok(r.t === 'sedan' && r.m === 'apron' && r.col === COLS[i] && r.inTraffic, `garage ${i}: the car is back after reload, sedan 0x${(r.col || 0).toString(16)}`);
      ok(r.k < 0.2, `garage ${i}: door open as you walk up`);
      if (i === 0) await shot('after-reload-home');
    }
    await D(`window.__h.foot(0, -14, 0)`); await sleep(2500);
    await D(`const q = Gs.sites[0], c = q.cars.find(Boolean); d.player.x = c.x + c.forward.z * (c.halfWid + 1.2); d.player.z = c.z - c.forward.x * (c.halfWid + 1.2); d.player.y = c.y + 0.2; d.player.heading = c.heading;`);
    await sleep(600);
    await key('e', true); await sleep(120); await key('e', false);
    ok(await until(`!!window.__dbg.player.vehicle && !!window.__dbg.player.vehicle.garage`, 8), 'a real Enter press gets into the stored car');
    ok(await D(`return d.player.vehicle.bodyMat.color.getHex() === ${COLS[0]}`), 'it is the right colour');
    await key('w', true);
    const freed = await until(`window.__dbg.garages.count(window.__dbg.garages.sites[0]) === 0`, 40);
    await key('w', false);
    ok(freed, 'driving it out of the door frees the slot');
    ok(await D(`return JSON.parse(localStorage.getItem('autokw-garages')).g.home.every((r) => !r)`), 'and the saved record is gone');
    await sleep(400);
    await D(`window.__h.put(0, 0, -12, 1, 'taxi', 0)`); await sleep(500);
    await key('w', true);
    ok(await until(`window.__dbg.garages.count(window.__dbg.garages.sites[0]) === 1`, 60), 'another car (a taxi) takes the stall');
    await key('w', false); await sleep(500);
    ok(await D(`return Gs.data.home.find(Boolean).t === 'taxi'`), 'the taxi is what is saved');

    console.log('--- limits');
    await D(`Gs.data.kitchener = [{t:'sedan',c:1,li:-1,h:100},{t:'hellcat',c:0xf7c531,li:-1,h:100},{t:'delorean',c:0xb9bdc1,li:-1,h:100}]; Gs.save();`);
    await D(`window.__h.foot(1, -14, 0)`); await sleep(2500);
    const kc = JSON.parse(await D(`return JSON.stringify(Gs.sites[1].cars.map((c) => c && c.typeName))`));
    ok(kc.join() === 'sedan,hellcat,delorean', 'three stored cars all stand: ' + kc.join());
    await shot('kitchener-three-cars');
    await D(`window.__h.put(1, 0, -12, 1, 'pickup', 0)`); await sleep(400);
    await key('w', true); await sleep(9000); await key('w', false); await sleep(1500);
    ok(await D(`return Gs.count(Gs.sites[1]) === 3 && !!d.player.vehicle && !Gs.sites[1].seq`), 'a fourth car is NOT saved (full), and you keep driving it');
    console.log('--- refusal');
    await D(`window.__h.put(2, 0, -9, 1, 'bus', 0)`); await sleep(2500);
    const b = JSON.parse(await D(`const q = Gs.sites[2]; return JSON.stringify({ k: q.k, solid: q.door.y1 > q.s.y, n: Gs.count(q), veh: d.player.vehicle && d.player.vehicle.typeName, fits: Gs.fits(d.player.vehicle) })`));
    ok(b.k > 0.9 && b.solid && !b.fits && b.n === 1 && b.veh === 'bus', 'a bus finds the door shut and is not taken (' + JSON.stringify(b) + ')');
    const fitsMap = JSON.parse(await D(`const out = {}; for (const t of ['sedan','taxi','police','ambulance','zamboni','hellcat','delorean','bus','airliner','tractor','tank','semi','fireengine','motorbike','heli']) { if (!d.TYPES[t]) { out[t] = 'none'; continue; } const v = d.traffic.spawnAt(0, 0, 0, t, 0, 'parked'); out[t] = Gs.fits(v); d.traffic.remove(v); } return JSON.stringify(out)`));
    console.log('  fits', JSON.stringify(fitsMap));
    ok(fitsMap.sedan && fitsMap.taxi && fitsMap.zamboni && fitsMap.hellcat && fitsMap.delorean && !fitsMap.bus && !fitsMap.airliner && !fitsMap.tank && !fitsMap.semi && !fitsMap.fireengine, 'fits(): road cars yes; bus, plane, tank, semi, fire engine no');

    console.log('--- pause menu');
    await D(`window.__h.foot(0, -14, 0)`); await sleep(500);
    await ev(`document.getElementById('pauseBtn').click()`); await sleep(1500);
    const prow = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#ppGrid .ppRow')].map((r) => r.textContent))`));
    console.log('  rows', JSON.stringify(prow.filter((r) => /garage/i.test(r))));
    ok(prow.filter((r) => /garage/i.test(r)).length === 3, 'the pause menu passport lists the three garages and what is in them');
    await shot('pause-menu-garages');

    const ex = errs.filter((e) => !/favicon/.test(e));
    ok(ex.length === 0, `no page exceptions${ex.length ? ': ' + ex.slice(0, 3).join(' | ') : ''}`);
    closing = true;
  } finally {
    chrome.kill('SIGKILL');
  }
  console.log(fails ? `FAILED ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('garageprobe failed:', e.message); process.exit(1); });
