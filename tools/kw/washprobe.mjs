// Auto KW: the drive-through tunnel car washes (src/carwash.js), end to end.
//
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 node tools/kw/washprobe.mjs [outdir]
//
// Boots like exportprobe.mjs (service worker bypassed) and leaves the game RUNNING. Checks the three
// washes are found on their real OSM buildings (the box flattened, the tunnel drawn along its long
// axis, both mouths clear, a map place each) and what one costs to draw; shoots the exterior by
// day. Refusals at the entrance (a U-Haul too tall, a school bus, a dirt bike, an ATV, a plane, a
// wreck, too poor, a job running) each toast and charge nothing. A sedan stopped on the conveyor
// is charged $8 after the wait; with W and A HELD the whole ride it is pulled through on the
// tunnel's axis at the conveyor's speed (controls ignored), ENTER does not get you out, the foam
// lands and is washed off, the brushes swing in, and it comes out the far end with health +5,
// steam cleared, a gloss on its paint, the wanted stars it went in with, and "Showroom shine".
// ENTER at the prompt pays at once; the 1-in-20 window-down gag (forced); on foot you are soaked
// for $0; a respawn mid-ride lets go of everything; nothing leaks (holds, autoDrive, camRig, the
// ride mesh). Shots: the tunnel by day, foam mid-ride, the brushes, the exit. Exit 1 on a failure
// or a page exception.
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/washshots';
let closing = false, fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-wash-profile-${PORT}`, width: 1280, height: 720, extra: ['--autoplay-policy=no-user-gesture-required'] });
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
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
        const t = (m.params.args || []).map((a) => a.value || a.description).join(' ');
        if (m.params.type === 'error' || /car wash/.test(t)) errs.push(m.params.type + ': ' + t);
      }
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
      writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(result.data, 'base64'));
      console.log(`  shot ${OUT}/${name}.jpg`);
    };
    const KEYS = { w: ['KeyW', 'w', 87], a: ['KeyA', 'a', 65], e: ['KeyF', 'f', 70] };
    const key = (k, down) => { const [code, kk, vk] = KEYS[k]; return send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: kk, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
    const tap = async (k) => { await key(k, true); await sleep(120); await key(k, false); };
    // the tunnel from outside its entrance, posed (the game paused for the shot)
    const ext = async (i, name) => {
      await ev(`(async () => { const d = window.__dbg, H = window.__h; for (let k = 0; k < 60 && !(H.q(${i}).grp); k++) await new Promise((r) => setTimeout(r, 100));
        d.game.paused = true; const q = H.q(${i}), [cx, cz] = q.W(-13, -15), [tx, tz] = q.W(0, q.s.L * 0.4); H.cam(cx, q.s.hi + 5.5, cz, tx, q.s.hi + 2, tz); })()`);
      await sleep(1500); await shot(name);
      await ev(`window.__dbg.game.paused = false`);
    };
    const until = async (js, secs) => { const t0 = Date.now(); while (Date.now() - t0 < secs * 1000) { if (await ev(js)) return true; await sleep(150); } return false; };

    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    const HSRC = `window.__h = {
      toasts: [],
      q(i) { return window.__dbg.carWash.sites[i]; },
      L(i, lx, lz) { return this.q(i).W(lx, lz); },
      loc(i, x, z) { return window.__dbg.carWash.local(this.q(i), x, z); },
      // a vehicle of 'type' stopped on site i's axis at lz, facing in
      put(i, lz, type, col) {
        const d = window.__dbg, q = this.q(i);
        const [x, z] = this.L(i, 0, lz);
        let v = d.player.vehicle;
        if (v) { d.player.exitVehicle(true); d.traffic.remove(v); v = null; }
        v = d.traffic.spawnAt(x, z, 0, type, col || 0x2255aa, 'free'); d.player.enterVehicle(v);
        v.place(x, z, Math.atan2(q.s.ax, q.s.az));
        v.vLong = 0; v.vy = 0; v.dead = false;
        d.world.update(x, z, 60);
        return v;
      },
      foot(i, lx, lz, tlx, tlz) {
        const d = window.__dbg;
        if (d.player.vehicle) { const v = d.player.vehicle; d.player.exitVehicle(true); d.traffic.remove(v); }
        const [x, z] = this.L(i, lx, lz), [tx, tz] = this.L(i, tlx, tlz);
        d.player.x = x; d.player.z = z; d.player.y = d.city.groundAt(x, z, null) + 0.1;
        d.player.heading = Math.atan2(tx - x, tz - z);
        d.world.update(x, z, 60);
      },
      cam(cx, cy, cz, tx, ty, tz) { const c = window.__dbg.camera; c.position.set(cx, cy, cz); c.lookAt(tx, ty, tz); c.updateMatrixWorld(true); },
      // pause the game the moment the ride's car reaches lz (for a shot)
      stopAt(lz) { const d = window.__dbg; return new Promise((res) => { const iv = setInterval(() => { const R = d.carWash.ride; if (!R || R.lz >= lz) { d.game.paused = true; clearInterval(iv); res(R ? R.lz : -1); } }, 20); }); },
      mark() { this.n0 = this.toasts.length; }, lastToast() { return this.toasts.slice(this.n0 || 0).join(' | '); },
    };
    { const H = window.__dbg.hud, f = H.showToast.bind(H); H.showToast = (t, ms) => { window.__h.toasts.push(String(t)); return f(t, ms); }; }`;
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    let up = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      try { if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.player && window.__dbg.carWash)')) { up = true; break; } } catch { /* navigating */ }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted, or no __dbg.carWash: ' + errs.slice(0, 5).join('\n'));
    await sleep(3000);
    await ev(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); const r = document.getElementById('rotate'); if (r) r.style.display = 'none';
      if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); window.__tod = 'day'; })()`);
    await sleep(800);
    await ev(HSRC);
    console.log(`booted; exceptions at boot: ${errs.length}`);
    const D = (e) => ev(`(async () => { const d = window.__dbg, CW = d.carWash, H = window.__h; ${e} })()`);
    const J = async (e) => JSON.parse(await D(e));

    console.log('--- the sites');
    const sites = await J(`return JSON.stringify(CW.sites.map((q) => { const s = q.s, [cx, cz] = q.W(0, s.L / 2), b = d.city.buildingsNear(cx, cz, 30).filter((b) => b.kw && b.kw.skip && b.h === 0 && Math.hypot(b.x - cx, b.z - cz) < 2);
      return { id: q.g.id, name: q.g.name, L: +s.L.toFixed(1), Wd: +s.Wd.toFixed(1), poi: Math.round(Math.hypot(q.g.x - cx, q.g.z - cz)), flat: b.length, blocked: s.blocked, slope: +(s.hi - s.lo).toFixed(2) }; }))`);
    for (const s of sites) console.log('  ', JSON.stringify(s));
    ok(sites.length === 3, `three washes placed (${sites.map((s) => s.name).join(', ')})`);
    ok(sites.every((s) => s.flat === 1), 'each on its real OSM building, whose box is flattened (drawn here instead)');
    ok(sites.every((s) => s.poi < s.L / 2), 'each OSM amenity=car_wash point is inside its tunnel');
    ok(sites.every((s) => s.L >= 22 && s.L / s.Wd >= 2.2), 'every one a long, narrow tunnel');
    ok(sites.every((s) => s.blocked[0] === 0 && s.blocked[1] === 0), 'both mouths of every tunnel clear for 8 m');
    ok(await D(`return d.hud.places.filter((p) => p.kind === 'wash').length === 3`), 'three map places (kind wash)');
    ok(await D(`return CW.busy && CW.busy.name === 'jobsBusy'`), 'refuses during a job through main.js jobsBusy (the random events\' rule)');

    // the exterior by day, and the draw cost
    await D(`H.foot(0, 0, -14, 0, 10); return 1`);
    ok(await until(`!!window.__dbg.carWash.sites[0].grp && window.__dbg.carWash.sites[0].grp.visible`, 20), 'built lazily and shown when near');
    const cost = await J(`const q = CW.sites[0]; let tris = 0, draws = 0; q.grp.traverse((o) => { if (o.isMesh && o.visible) { draws++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return JSON.stringify({ draws, tris: Math.round(tris), built: CW.sites.filter((s) => s.built).length })`);
    console.log('  cost', JSON.stringify(cost));
    ok(cost.draws === 3 && cost.built === 1, `3 draws (${cost.draws}), ${cost.tris} tris; only the near wash is built (${cost.built})`);
    await ext(0, 'wash-exterior-day');

    console.log('--- refusals');
    await D(`d.game.money = 100; d.game.wanted = 0; CW.rig = 'clean'; return 1`);
    const refuse = async (what, js, re) => {
      await D(`H.mark(); ${js}; window.__m0 = d.game.money; return 1`);
      const told = await until(`window.__h.lastToast().length > 0 && /${re.source}/.test(window.__h.lastToast())`, 25);
      const st = await J(`return JSON.stringify({ t: H.lastToast(), m: d.game.money - window.__m0, ride: !!CW.ride })`);
      ok(told && st.m === 0 && !st.ride, `${what} refused, nothing charged: "${st.t}"`);
    };
    await refuse('a U-Haul (roof 3.35 m)', `H.put(0, 0.5, 'uhaul')`, /Too tall/);
    await refuse('a school bus', `H.put(0, 0.5, 'schoolbus')`, /Too big/);
    await refuse('a dirt bike', `H.put(0, 0.5, 'dirtbike')`, /bikes/);
    await refuse('an ATV', `H.put(0, 0.5, 'atv')`, /ATVs/);
    await refuse('a plane', `H.put(0, 0.5, 'sportplane')`, /Aircraft/);
    await refuse('a wreck', `const v = H.put(0, 0.5, 'sedan'); v.health = 8`, /wrecks/);
    await refuse('too poor', `d.game.money = 3; H.put(0, 0.5, 'sedan')`, /short/);
    await D(`d.game.money = 100; return 1`);
    await refuse('a job running', `CW._busy = CW.busy; CW.busy = () => true; H.put(0, 0.5, 'sedan')`, /job/);
    await D(`CW.busy = CW._busy; return 1`);
    // not lined up (across the conveyor) does nothing at all
    await D(`H.mark(); const q = CW.sites[0], v = H.put(0, 0.5, 'sedan'); v.place(v.x, v.z, Math.atan2(q.s.ax, q.s.az) + 1.3); return 1`);
    await sleep(3500);
    ok(await D(`return !CW.ride && d.game.money === 100 && !CW.sites[0].prompt`), 'a car across the mouth is not taken');

    console.log('--- a sedan through Valet Car Wash, W and A held the whole way');
    const m0 = 100;
    await D(`d.game.money = ${m0}; d.game.wanted = 2; H.mark(); const v = H.put(0, 0.4, 'sedan', 0xb02020); v.health = 70; v.steamT = 5; window.__v = v; window.__r0 = v.bodyMat.roughness; return 1`);
    ok(await until(`!!window.__dbg.carWash.sites[0].prompt`, 25), 'stopped on the conveyor: the prompt');
    ok(/ENTER to pay/.test(await D(`return H.lastToast()`)), 'the pay prompt toasts: ' + await D(`return H.lastToast()`));
    ok(await until(`!!window.__dbg.carWash.ride`, 25), 'waiting pays: the conveyor takes the car');
    await key('w', true); await key('a', true);
    const r0 = await J(`const R = CW.ride, g = CW.rideMesh.mesh.geometry; return JSON.stringify({ tris: g.index.count / 3, verts: g.attributes.position.count, m: d.game.money, T: R.T, D: R.D, lz0: R.lz0, auto: !!d.player.autoDrive, cam: !!R.v.camRig, mesh: CW.rideMesh.mesh.parent === d.scene })`);
    ok(r0.m === m0 - 8, `charged $8 (money ${r0.m})`);
    ok(r0.auto && r0.cam && r0.mesh, `autoDrive, the ride camera and the ride mesh are on (1 draw, ${r0.tris} tris, ${r0.verts} verts rewritten a frame)`);
    ok(r0.T > 16 && r0.T < 26, `the ride is ~20 s (${r0.T.toFixed(1)} s over ${r0.D.toFixed(1)} m)`);
    // samples: the car's lateral offset and progress while the keys are held
    await D(`window.__samp = []; clearInterval(window.__si); window.__si = setInterval(() => { const R = CW.ride; if (!R) return; const l = H.loc(0, R.v.x, R.v.z); window.__samp.push([R.t, l.lx, l.lz, R.v.vLong, d.player.vehicle === R.v, R.v.health, d.police && d.police.n ? d.police.n.cars + d.police.n.foot : -1]); }, 100); return 1`);
    // ENTER on the conveyor does not get you out
    await sleep(1500); await tap('e'); await sleep(600);
    ok(await D(`return !!CW.ride && d.player.vehicle === window.__v && !d.player.onFoot`), 'ENTER on the conveyor does not get you out ("sit tight")');
    // shots: foam on the car, the brushes, the exit (paused for each)
    const st = await J(`return JSON.stringify(CW.sites[0].st)`);
    await D(`return H.stopAt(${st.foam[2] + 1.2})`);
    const fo = await J(`const M = CW.rideMesh; return JSON.stringify({ on: M.f.filter((f) => f.on).length, cols: [0, 1, 2].map((c) => M.f.filter((f) => f.on && f.ci === c).length) })`);
    ok(fo.on > 60 && fo.cols.every((n) => n > 10), `foam in three colours on the car (${fo.on}: pink ${fo.cols[0]}, blue ${fo.cols[1]}, yellow ${fo.cols[2]})`);
    await sleep(1200); await shot('wash-foam'); await D(`d.game.paused = false; return 1`);
    await D(`return H.stopAt(${st.brush + 0.2})`);
    const br = await J(`const R = CW.ride; return JSON.stringify({ x: R.brushX, hw: R.v.halfWid })`);
    ok(br.x < 2.0 && br.x > br.hw, `the side brushes swing in against the car (${br.x.toFixed(2)} m from the axis, the car's side at ${br.hw.toFixed(2)})`);
    await sleep(1200); await shot('wash-brushes'); await D(`d.game.paused = false; return 1`);
    await D(`return H.stopAt(${st.rinse + 2.0})`);
    const rin = await J(`const M = CW.rideMesh; return JSON.stringify({ on: M.f.filter((f) => f.on).length, going: M.f.filter((f) => f.on && f.st === 3).length })`);
    await D(`d.game.paused = false; return 1`);
    await D(`return H.stopAt(${st.blow + 1.0})`);
    const blo = await J(`return JSON.stringify({ on: CW.rideMesh.f.filter((f) => f.on).length })`);
    ok(blo.on < fo.on && blo.on < 10, `the rinse and the blower take the foam off (${fo.on} -> ${rin.on} at the rinse, ${rin.going} going -> ${blo.on} at the blower)`);
    await D(`d.game.paused = false; return 1`);
    const sitesL = sites[0].L;
    await D(`return H.stopAt(${sitesL + 2.6})`);
    await sleep(1200); await shot('wash-exit'); await D(`d.game.paused = false; return 1`);
    ok(await until(`!window.__dbg.carWash.ride`, 60), 'the ride ends');
    await key('w', false); await key('a', false);
    await D(`clearInterval(window.__si); return 1`);
    const samp = await J(`return JSON.stringify(window.__samp)`);
    const after = samp.filter((s) => s[0] > 1.5);
    const maxLx = Math.max(...after.map((s) => Math.abs(s[1])));
    const lzs = samp.map((s) => s[2]);
    const vmax = Math.max(...samp.map((s) => s[3]));
    let mono = true; for (let i = 1; i < lzs.length; i++) if (lzs[i] < lzs[i - 1] - 0.01) mono = false;
    { let h = samp[0][5]; for (const s of samp) { if (Math.abs(s[5] - h) > 0.01) console.log(`    health ${h.toFixed(1)} -> ${s[5].toFixed(1)} at t ${s[0].toFixed(1)} lz ${s[2].toFixed(1)} (police units ${s[6]})`); h = s[5]; } }
    console.log(`  samples ${samp.length}, lz ${lzs[0].toFixed(1)} -> ${lzs[lzs.length - 1].toFixed(1)}, max |lx| after 1.5 s ${maxLx.toFixed(3)}, top speed ${vmax.toFixed(2)} m/s`);
    ok(samp.length > 20 && samp.every((s) => s[4]), 'sampled the whole ride, the player in the car throughout');
    ok(lzs[lzs.length - 1] - lzs[0] > sitesL, `pulled through the whole tunnel (${(lzs[lzs.length - 1] - lzs[0]).toFixed(1)} m along it, the tunnel ${sitesL} m)`);
    ok(maxLx < 0.05 && mono, 'on the axis and always forward with W and A held (the controls are ignored)');
    ok(vmax < 2.6, `at the conveyor's pace, not W's (top ${vmax.toFixed(2)} m/s)`);
    const res = await J(`const v = window.__v; return JSON.stringify({ h: v.health, steam: v.steamT, r: v.bodyMat.roughness, r0: window.__r0, wanted: d.game.wanted, money: d.game.money, last: CW.last, toasts: H.lastToast(),
      auto: d.player.autoDrive, cam: !!v.camRig, mesh: CW.rideMesh.mesh.parent === d.scene, holds: [...d.game.holds], inCar: d.player.vehicle === v, lv: CW.local(CW.sites[0], v.x, v.z) })`);
    ok(res.last && res.last.done, 'the ride ran to its end');
    ok(Math.abs(res.last.h1 - res.last.h0 - 5) < 1e-6 && res.h <= res.last.h1 + 1e-6, `health +5 as it leaves (${res.last.h0.toFixed(1)} -> ${res.last.h1.toFixed(1)}; ${res.h.toFixed(1)} now)`);
    ok(res.steam === 0, 'the radiator\'s steam is cleared');
    ok(res.r < res.r0 * 0.6, `a gloss on the paint (roughness ${res.r0.toFixed(2)} -> ${res.r.toFixed(2)}, easing back)`);
    ok(res.wanted === 2, 'the wanted stars stay (GTA has no wash rule)');
    ok(res.money === m0 - 8, `money -$8 in all (${res.money})`);
    ok(/Showroom shine/.test(res.toasts), '"Showroom shine"');
    ok(res.inCar && res.lv.lz > sitesL + 1, `you are out of the far end, still in the car (lz ${res.lv.lz.toFixed(1)})`);
    ok(res.auto === null && !res.cam && !res.mesh && res.holds.length === 0, 'cleanup: no autoDrive, no camRig, no ride mesh, no holds');
    await D(`d.game.wanted = 0; if (d.police) d.police.clear(); return 1`);

    console.log('--- ENTER pays at once, at GTO Auto Spa; the window-down gag');
    await D(`H.foot(1, 0, -20, 0, 0); return 1`); await sleep(1500);
    await ext(1, 'wash-exterior-gto');
    await D(`CW.rig = 'gag'; d.game.money = 50; H.mark(); window.__v = H.put(1, 0.4, 'compsedan', 0x2a7a3a); return 1`);
    ok(await until(`!!window.__dbg.carWash.sites[1].prompt`, 25), 'the prompt');
    await tap('e');
    ok(await until(`!!window.__dbg.carWash.ride`, 6), 'ENTER pays');
    ok(await D(`return CW.ride && CW.ride.t < 1.0 && d.game.money === 42 && d.player.vehicle === window.__v`), 'at once (before the wait), $8, and you are still in the car');
    ok(await until(`/window down/.test(window.__h.lastToast())`, 40), 'the gag (forced): "' + (await D(`return H.lastToast()`)).split(' | ').filter((t) => /window/.test(t))[0] + '"');

    console.log('--- a respawn mid-ride lets go');
    await D(`d.doRespawn(); return 1`);
    await sleep(800);
    ok(await D(`return !CW.ride && !d.player.autoDrive && !(window.__v && window.__v.camRig) && CW.rideMesh.mesh.parent !== d.scene`), 'respawn: no ride, no autoDrive, no camRig, no ride mesh');
    await D(`CW.rig = null; return 1`);

    console.log('--- on foot, at the Petro-Canada on Weber');
    await D(`H.foot(2, 0, -20, 0, 0); return 1`); await sleep(1500);
    await ext(2, 'wash-exterior-petro');
    await D(`d.game.money = 20; H.mark(); H.foot(2, 0, -3, 0, 6); return 1`);
    await sleep(1000);
    ok(await D(`return CW.footSoaks === undefined || CW.footSoaks === 0`), 'not yet (outside the mouth)');
    await D(`H.foot(2, 0, 4, 0, 10); return 1`);
    ok(await until(`/very clean/.test(window.__h.lastToast())`, 15), 'walk in: "' + (await D(`return H.lastToast()`)) + '"');
    ok(await D(`return d.game.money === 20 && CW.footSoaks === 1 && /\\+\\$0/.test(H.lastToast())`), '+$0, once');
    await D(`H.foot(2, 0, 9, 0, 14); return 1`); await sleep(1500);
    ok(await D(`return CW.footSoaks === 1`), 'not again while still inside');
    await D(`d.game.paused = true; const q = H.q(2), [cx, cz] = q.W(0.6, 4.5), [tx, tz] = q.W(0, 9); H.cam(cx, q.s.hi + 2.2, cz, tx, q.s.hi + 1.2, tz); return 1`);
    await sleep(1200); await shot('wash-foot'); await D(`d.game.paused = false; return 1`);

    console.log('--- cleanup');
    const leak = await J(`return JSON.stringify({ holds: [...d.game.holds], leaks: d.game.leaks ? d.game.leaks.slice() : [], ride: !!CW.ride, auto: !!d.player.autoDrive, mesh: CW.rideMesh.mesh.parent === d.scene, grps: CW.sites.filter((q) => q.grp && q.grp.parent === d.scene).length, gloss: CW.gloss.length })`);
    console.log('  ', JSON.stringify(leak));
    ok(leak.holds.length === 0 && leak.leaks.length === 0, 'no holds and no reaped leaks');
    ok(!leak.ride && !leak.auto && !leak.mesh, 'no ride, no autoDrive, no ride mesh in the scene');
    ok(leak.grps === 3, 'the three buildings (built as you came near) and nothing else');
    const ex = errs.filter((e) => !/favicon/.test(e));
    ok(ex.length === 0, `no page exceptions${ex.length ? ': ' + ex.slice(0, 3).join(' | ') : ''}`);
    closing = true;
  } finally {
    chrome.kill('SIGKILL');
  }
  console.log(fails ? `FAILED ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('washprobe failed:', e.message); process.exit(1); });
