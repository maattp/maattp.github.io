// Auto KW: the classics and cruise night (vehicles.js `classic` types, src/kwcruise.js), end to end.
//
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 [AUTO_PHONE=1] node tools/kw/cruiseprobe.mjs <outdir> [noshots]
//
// Boots the game (service worker bypassed, `?cruise=0` so the real clock cannot start a meet), pauses it
// and drives everything by hand at a fixed dt:
//   1. each new type: built (no NaN, wheels on the ground, triangles), its far and far-far LOD, spawned,
//      driven 3 s from rest at full throttle (displacement), the garage's fits(), a Respray that takes;
//   2. the traffic weight: classicOdds() weekday / weekend / country, and a spawnTraffic sample;
//   3. the event OFF builds nothing; forced ON near the lot it builds the meet (>= 12 cars, apron,
//      enterable, the show row's meshes, people, the music car, the map icon on, the arrival toast);
//   4. Best in Show: a finned convertible parked in a show stall for 30 s is judged and paid ONCE
//      (autokw-cruise), a second wait pays nothing, a sedan is never judged;
//   5. teardown when the event ends, when you drive away, and a meet car you took stays yours: no
//      leaked cars, meshes, people or keepClear entries;
//   6. screenshots: each new car 3/4 front at the meet, the lot at dusk; draws / triangles with the
//      meet on and off at the same view (AUTO_PHONE=1 for the phone's numbers).
// Exit 1 on a failure or a page exception.
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/cruiseshots';
const SHOTS = process.argv[3] !== 'noshots';
const PHONE = process.env.AUTO_PHONE === '1';
let fails = 0, closing = false;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const NEW = ['bug', 'pickup50', 'woodie', 'finned'];

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-cruise-profile-${PORT}`, width: 1280, height: 720, extra: ['--autoplay-policy=no-user-gesture-required'] });
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
      writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(result.data, 'base64'));
      console.log(`  shot ${OUT}/${name}.jpg`);
    };

    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    if (PHONE) {
      await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/?cruise=0` });
    let up = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.cruise)')) { up = true; break; }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
    console.log(`booted${PHONE ? ' (phone)' : ''}; exceptions at boot: ${errs.length}`);
    await sleep(3000);
    await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true);
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true; })()`);

    // --- 1. the types --------------------------------------------------------------
    console.log('--- the classic types');
    const T = JSON.parse(await ev(`(async () => {
      const d = window.__dbg, V = await import(new URL('./src/vehicles.js', document.baseURI).href);
      const A = V.vehicleAssets(), out = {};
      const C = d.cruise, site = { x: -4160, z: -4826 };
      for (const t of ${JSON.stringify(NEW)}) {
        const ty = A.types[t];
        if (!ty) { out[t] = null; continue; }
        let nan = 0, tris = 0;
        for (const g of ['paintGeo', 'trimGeoW', 'matteGeoW']) {
          const p = ty[g].attributes.position.array;
          for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) nan++;
          tris += ty[g].index.count / 3;
        }
        const wheelOff = Math.max(...ty.wheels.map((w) => Math.abs(w[1] - ty.spec.wheelR)));
        const far = V.farLod(t).geo.index.count / 3, far2 = V.farLod2(t).geo.index.count / 3;
        // spawn on the open lot, drive 3 s from rest at full throttle, fixed dt
        // (driven as YOUR car: the player in it, so its own handling -- the spec's figures, its springs)
        const v = d.traffic.spawnAt(site.x - 60, site.z - 40, Math.PI / 2, t, V.classicColor(t, 7), 'free');
        d.player.enterVehicle(v);
        const x0 = v.x, z0 = v.z;
        let fin = true, vmax = 0, disp = 0, t60 = null;
        for (let i = 0; i < 900; i++) {
          v.update(1 / 60, { throttle: 1, steer: 0, brake: 0 });
          vmax = Math.max(vmax, Math.abs(v.vLong));
          if (t60 === null && Math.abs(v.vLong) * 3.6 >= 60) t60 = +((i + 1) / 60).toFixed(2);
          if (i === 179) disp = Math.hypot(v.x - x0, v.z - z0);
          if (![v.x, v.y, v.z].every(Number.isFinite)) fin = false;
        }
        d.player.exitVehicle(true);
        const fits = !!(d.garages && d.garages.fits(v));
        const c0 = v.bodyMat.color.getHex(), took = v.respray(0x2a7fd4), c1 = v.bodyMat.color.getHex();
        out[t] = { nan, tris, wheelOff: +wheelOff.toFixed(3), far, far2, disp: +disp.toFixed(1), kph: +(vmax * 3.6).toFixed(0), t60, fin, fits, respray: took && c1 === 0x2a7fd4 && c0 !== c1,
          classic: ty.spec.classic, len: ty.spec.len, colors: (V.CLASSIC_COLORS[t] || []).length };
        d.traffic.remove(v);
      }
      return JSON.stringify(out);
    })()`));
    for (const t of NEW) {
      const r = T[t];
      if (!r) { ok(false, `${t}: no such type`); continue; }
      console.log(`  ${t}: ${r.tris} tris (far ${r.far}, far-far ${r.far2}), 3 s from rest ${r.disp} m, 0-60 ${r.t60} s, ${r.kph} km/h after 15 s, garage fits ${r.fits}, ${r.colors} paints, rarity ${r.classic}`);
      ok(r.nan === 0 && r.wheelOff < 0.01, `${t}: geometry finite, wheels on the ground`);
      ok(r.far > 100 && r.far2 > 50 && r.far2 < r.far, `${t}: far LOD ${r.far} and far-far LOD ${r.far2} tris`);
      ok(r.fin && r.disp > 8 && r.t60 !== null, `${t}: drives as your car (${r.disp} m in 3 s, 0-60 km/h ${r.t60} s)`);
      ok(r.fits, `${t}: fits the garages`);
      ok(r.respray, `${t}: a Respray takes`);
    }
    ok(T.bug && T.finned && T.bug.t60 > T.finned.t60 && T.bug.kph < T.finned.kph, `its own feel: the bug slowest (0-60 ${T.bug && T.bug.t60} s, ${T.bug && T.bug.kph} km/h at 15 s), the finned V8 quicker (${T.finned && T.finned.t60} s, ${T.finned && T.finned.kph} km/h)`);

    // --- 2. traffic weight ----------------------------------------------------------
    console.log('--- traffic weight');
    const W = JSON.parse(await ev(`(async () => {
      const d = window.__dbg, TR = await import(new URL('./src/traffic.js', document.baseURI).href);
      const o = (r, x, z, day) => +TR.classicOdds(r, x, z, day).toFixed(4);
      const res = { town: o(false, -1500, 0, 2), weekend: o(false, -1500, 0, 6), country: o(true, 5000, -9000, 2), stjacobsWeekend: o(false, -6395, -9660, 0) };
      const pick = {}; for (let i = 0; i < 2000; i++) { const t = TR.classicPick(i / 2000, false); pick[t] = (pick[t] || 0) + 1; }
      res.pick = pick;
      // a live sample: spawnTraffic round the meet's lot (the real day)
      let n = 0, cl = 0; const seen = {};
      const px = -4160, pz = -4826;
      for (let i = 0; i < 6000; i++) { const v = d.traffic.spawnTraffic(px, pz, null); if (!v) continue; n++; if (v.spec.classic) { cl++; seen[v.typeName] = (seen[v.typeName] || 0) + 1; } d.traffic.remove(v); }
      res.sample = { n, classics: cl, seen, day: new Date().getDay() };
      return JSON.stringify(res);
    })()`));
    console.log('  ', JSON.stringify(W));
    ok(W.town > 0 && W.town < 0.01, `rare in town on a weekday: ${(W.town * 100).toFixed(2)} % of car draws`);
    ok(W.weekend > W.town * 2 && W.country > W.town * 2 && W.stjacobsWeekend > W.weekend, `more on weekends (${(W.weekend * 100).toFixed(2)} %), in the country (${(W.country * 100).toFixed(2)} %), most round St. Jacobs on a weekend (${(W.stjacobsWeekend * 100).toFixed(2)} %)`);
    ok(W.sample.classics > 0 && W.sample.classics < W.sample.n * 0.05, `spawnTraffic sample: ${W.sample.classics} classics in ${W.sample.n} spawns ${JSON.stringify(W.sample.seen)}`);

    // --- 3. the event --------------------------------------------------------------
    console.log('--- cruise night');
    await ev(`(() => { const d = window.__dbg; window.__toasts = []; const o = d.hud.showToast.bind(d.hud); d.hud.showToast = (t, ms) => { window.__toasts.push(t); return o(t, ms); };
      window.__cr = {
        at(lx, lz) { const d = window.__dbg, p = d.cruise.w(lx, lz); if (d.player.vehicle) { const v = d.player.vehicle; d.player.exitVehicle(true); }
          d.player.x = p.x; d.player.z = p.z; d.player.y = d.city.groundAt(p.x, p.z, null) + 0.1; d.world.update(p.x, p.z, 60); },
        step(secs, dt = 0.1) { const d = window.__dbg; for (let t = 0; t < secs; t += dt) d.cruise.update(dt, d.player); },
        objs() { const d = window.__dbg; let n = 0; d.scene.traverse((o) => { if (o.userData && o.userData.cruise) n++; }); return n; },
      }; })()`);
    const base = JSON.parse(await ev(`(() => { const d = window.__dbg; window.__kids0 = new Set(d.scene.children); return JSON.stringify({ kids: d.scene.children.length, cars: d.traffic.cars.length, keep: (d.traffic.keepClear || []).length }); })()`));
    // OFF: walk right into the lot, nothing comes
    const off = JSON.parse(await ev(`(() => { const d = window.__dbg, C = d.cruise; C.force(false); window.__cr.at(0, -30); window.__cr.step(3);
      return JSON.stringify({ built: C.built, cars: C.cars.length, objs: window.__cr.objs(), icon: d.hud.places.find((p) => p.kind === 'cruise').off }); })()`));
    ok(!off.built && off.cars === 0 && off.objs === 0, 'event OFF: nothing built in the lot');
    ok(off.icon === true, 'event OFF: the map icon is hidden');
    const realDay = JSON.parse(await ev(`(() => { const C = window.__dbg.cruise, save = C.forced; C.forced = null;
      const r = [['2026-11-06T19:30'], ['2026-11-07T22:59'], ['2026-11-07T23:00'], ['2026-11-06T17:59'], ['2026-11-05T20:00']].map(([s]) => { C.clock = () => new Date(s); return C.active(); });
      C.clock = () => new Date(); C.forced = save; return JSON.stringify(r); })()`));
    ok(JSON.stringify(realDay) === '[true,true,false,false,false]', `the real calendar: Fri 19:30 on, Sat 22:59 on, Sat 23:00 off, Fri 17:59 off, Thu 20:00 off ${JSON.stringify(realDay)}`);
    // ON from far away: not built until you come within BUILD_R
    const far = JSON.parse(await ev(`(() => { const C = window.__dbg.cruise; C.force(true); window.__cr.at(0, -900); window.__cr.step(2); return JSON.stringify({ built: C.built, icon: window.__dbg.hud.places.find((p) => p.kind === 'cruise').off }); })()`));
    ok(!far.built && far.icon === false, 'ON but 900 m away: nothing built yet, the map icon shows');
    const on = JSON.parse(await ev(`(() => { const d = window.__dbg, C = d.cruise; window.__toasts.length = 0; window.__cr.at(0, -60); window.__cr.step(1); window.__cr.at(0, -30); window.__cr.step(1);
      return JSON.stringify({ built: C.built, cars: C.cars.length, apron: C.cars.every((v) => v.mode === 'apron' && d.traffic.cars.includes(v)), types: C.cars.map((v) => v.typeName),
        people: C.people.length, hoods: C.hoods.length, objs: window.__cr.objs(), music: !!C.musicCar, toasts: window.__toasts.slice(), keep: (d.traffic.keepClear || []).length,
        enter: (() => { const v = C.cars[0]; const n = d.traffic.nearestEnterable ? d.traffic.nearestEnterable(v.x + 1.5, v.z, 4) : v; return !!n; })() }); })()`));
    console.log(`  meet: ${on.cars} cars (${[...new Set(on.types)].join(', ')}), ${on.people} people, ${on.hoods} hoods up, ${on.objs} show-row meshes`);
    ok(on.built && on.cars >= 12 && on.cars <= 20, `ON at the lot: ${on.cars} cars`);
    ok(on.apron, 'every meet car is apron traffic (never culled, real)');
    ok(on.enter, 'a meet car is enterable');
    ok(on.people > 0 && on.hoods > 0 && on.objs === 3 && on.music, 'people, open hoods, the show row (3 meshes) and a music car');
    ok(on.toasts.some((t) => /Cruise night/.test(t)), 'the arrival toast: ' + on.toasts.join(' | '));
    ok(on.keep === base.keep + 1, 'the lot is kept clear of its own parked cars while it is on');

    // --- 4. Best in Show ------------------------------------------------------------
    console.log('--- Best in Show');
    const bis = JSON.parse(await ev(`(() => { const d = window.__dbg, C = d.cruise; localStorage.removeItem('autokw-cruise'); C.stats = {};
      const s = C.show[2]; const v = d.traffic.spawnAt(s.x, s.z, s.h, 'finned', 0x3fb0b0, 'free'); d.player.enterVehicle(v); v.place(s.x, s.z, s.h); v.vLong = 0;
      window.__bis = v; const m0 = d.game.money; window.__toasts.length = 0;
      window.__cr.step(15); const mid = d.game.money; window.__cr.step(16.5); const m1 = d.game.money;
      const saved = JSON.parse(localStorage.getItem('autokw-cruise') || 'null');
      // a second wait the same night pays nothing
      v.place(s.x + 30, s.z, s.h); window.__cr.step(1); v.place(s.x, s.z, s.h); window.__cr.step(32); const m2 = d.game.money;
      return JSON.stringify({ m0, mid, m1, m2, saved, last: C.lastAward, toasts: window.__toasts.slice() }); })()`));
    console.log('   ', bis.toasts.join(' | '));
    ok(bis.mid === bis.m0, 'nothing paid before the 30 s are up');
    ok(bis.m1 > bis.m0, `judged after 30 s: +$${bis.m1 - bis.m0} (${bis.last && bis.last.ribbon} ribbon, rarity ${bis.last && bis.last.r}, condition ${bis.last && Math.round(bis.last.cond * 100)} %)`);
    ok(bis.saved && bis.saved.night && bis.saved.wins === 1, 'saved in autokw-cruise: ' + JSON.stringify(bis.saved));
    ok(bis.m2 === bis.m1, 'once a night: a second wait pays nothing');
    const sed = JSON.parse(await ev(`(() => { const d = window.__dbg, C = d.cruise; localStorage.removeItem('autokw-cruise'); C.stats = {};
      const v0 = d.player.vehicle; d.player.exitVehicle(true); d.traffic.remove(v0);
      const s = C.show[3]; const v = d.traffic.spawnAt(s.x, s.z, s.h, 'sedan', 0xf2f3f1, 'free'); d.player.enterVehicle(v); v.place(s.x, s.z, s.h); v.vLong = 0;
      const m0 = d.game.money; window.__cr.step(35); const m1 = d.game.money; d.player.exitVehicle(true); d.traffic.remove(v);
      return JSON.stringify({ m0, m1, judge: C.judge }); })()`));
    ok(sed.m1 === sed.m0, 'a modern sedan in the show row is never judged');

    // --- 6 (while it is up). screenshots and the cost ---------------------------------
    if (SHOTS) {
      console.log('--- shots');
      const pose = async (js, name, wait = 3500) => {
        await ev(`(() => { const d = window.__dbg, C = d.cruise, r = (${js})();
          const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
          d.world.update(r.c[0], r.c[1], 60); for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(r.c[0], r.c[1], 60);
          const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
          d.camera.fov = r.fov || 55; d.camera.updateProjectionMatrix();
          d.camera.position.set(r.c[0], gy(r.c[0], r.c[1]) + r.c[2], r.c[1]); d.camera.lookAt(r.t[0], gy(r.t[0], r.t[1]) + r.t[2], r.t[1]); d.camera.updateMatrixWorld(true);
          d.sun.position.set(r.c[0] - 215, gy(r.c[0], r.c[1]) + 200, r.c[1] - 150); d.sun.target.position.set(r.c[0], gy(r.c[0], r.c[1]), r.c[1]); d.sun.target.updateMatrixWorld(); })()`);
        await sleep(wait);
        await shot(name);
        return ev(`(() => { const s = window.__dbg.sceneStats; return s ? { calls: s.calls, tris: Math.round(s.tris / 1000) } : null; })()`);
      };
      // each new type 3/4 front, parked in a show stall
      for (const t of NEW) {
        await ev(`(() => { const d = window.__dbg, C = d.cruise, s = C.show[2]; if (window.__sv) d.traffic.remove(window.__sv);
          window.__sv = d.traffic.spawnAt(s.x, s.z, s.h, '${t}', ${JSON.stringify({ bug: 0x8fb3c9, pickup50: 0x8a1d18, woodie: 0x6b3a22, finned: 0x3fb0b0 })}['${t}'], 'apron'); })()`);
        await pose(`() => { const v = window.__sv, f = { x: Math.sin(v.heading), z: Math.cos(v.heading) }, k = v.spec.len / 4.5;
          return { c: [v.x + (f.x * 5.2 + f.z * 3.6) * k, v.z + (f.z * 5.2 - f.x * 3.6) * k, 1.7], t: [v.x + f.x * 0.3, v.z + f.z * 0.3, 0.75], fov: 50 }; }`, `car-${t}`, 3000);
      }
      await ev(`(() => { const d = window.__dbg; if (window.__sv) d.traffic.remove(window.__sv); window.__sv = null;
        const t = d.tod; if (t) { t.mode = 'dusk'; t._realT = -1e9; t.solve(new Date()); t.apply(true); } })()`);
      const view = `() => { const C = window.__dbg.cruise, a = C.w(-30, -24), b = C.w(0, 4); return { c: [a.x, a.z, 7], t: [b.x, b.z, 1.0], fov: 58 }; }`;
      const costOn = await pose(view, 'lot-dusk', 4500);
      await pose(`() => { const C = window.__dbg.cruise, h = C.hoods[0], v = h.v, f = { x: Math.sin(v.heading), z: Math.cos(v.heading) }; return { c: [v.x + f.x * 6 + f.z * 2.5, v.z + f.z * 6 - f.x * 2.5, 2.0], t: [v.x + f.x * 1.2, v.z + f.z * 1.2, 1.0], fov: 50 }; }`, 'hood-dusk');
      await pose(`() => { const C = window.__dbg.cruise, a = C.w(-2, 6), b = C.w(0, 22); return { c: [a.x, a.z, 2.4], t: [b.x, b.z, 1.6], fov: 55 }; }`, 'show-row-dusk');
      // the same view with the meet off
      await ev(`(() => { const C = window.__dbg.cruise; C.force(false); window.__cr.step(1.2); })()`);
      const costOff = await pose(view, 'lot-dusk-off', 4500);
      console.log(`  cost at the lot view${PHONE ? ' (phone)' : ''}: meet on ${costOn && costOn.calls} draws / ${costOn && costOn.tris}k tris, off ${costOff && costOff.calls} / ${costOff && costOff.tris}k`);
      await ev(`(() => { const C = window.__dbg.cruise; C.force(true); window.__cr.at(0, -30); window.__cr.step(1); })()`);
    }

    // --- 5. teardown -------------------------------------------------------------------
    console.log('--- teardown');
    const td = JSON.parse(await ev(`(() => { const d = window.__dbg, C = d.cruise; if (!C.built) window.__cr.step(1);
      const ids = C.cars.slice(), ppl = C.people.map((p) => p.h.group);
      C.force(false); window.__cr.step(1.5);
      return JSON.stringify({ built: C.built, left: ids.filter((v) => d.traffic.cars.includes(v)).length, cruiseCars: d.traffic.cars.filter((v) => v.cruise).length,
        objs: window.__cr.objs(), people: ppl.filter((g) => g.parent).length, keep: (d.traffic.keepClear || []).length, icon: d.hud.places.find((p) => p.kind === 'cruise').off }); })()`));
    ok(!td.built && td.left === 0 && td.cruiseCars === 0, `the evening ends: every meet car removed (${td.left} left)`);
    ok(td.objs === 0 && td.people === 0, 'no show-row mesh and no person left in the scene');
    ok(td.keep === base.keep, 'keepClear restored');
    ok(td.icon === true, 'the map icon hidden again');
    const away = JSON.parse(await ev(`(() => { const d = window.__dbg, C = d.cruise; C.force(true); window.__cr.at(0, -30); window.__cr.step(1); const b = C.built, n = C.cars.length, ids = C.cars.slice();
      window.__cr.at(0, -800); window.__cr.step(1); return JSON.stringify({ b, n, built: C.built, left: ids.filter((v) => d.traffic.cars.includes(v)).length, objs: window.__cr.objs() }); })()`));
    ok(away.b && !away.built && away.left === 0 && away.objs === 0, `driving 800 m away takes it down (${away.n} cars built, ${away.left} left)`);
    const took = JSON.parse(await ev(`(() => { const d = window.__dbg, C = d.cruise; window.__cr.at(0, -30); window.__cr.step(1);
      const v = C.cars[0]; d.player.enterVehicle(v); v.place(v.x + 12, v.z + 3, v.heading); window.__cr.step(0.3);
      const released = !v.cruise && C.cars.indexOf(v) < 0;
      C.force(false); window.__cr.step(1);
      const kept = d.traffic.cars.includes(v); d.player.exitVehicle(true); d.traffic.remove(v);
      return JSON.stringify({ released, kept, cruiseCars: d.traffic.cars.filter((q) => q.cruise).length, objs: window.__cr.objs() }); })()`));
    ok(took.released && took.kept, 'a meet car you drive off in is yours: left to traffic when the meet goes');
    ok(took.cruiseCars === 0 && took.objs === 0, 'nothing else of the meet left behind');
    // anything new in the scene that is the meet's (a person's group, a vehicle of the meet, a cruise mesh)
    const end = JSON.parse(await ev(`(() => { const d = window.__dbg, nu = d.scene.children.filter((o) => !window.__kids0.has(o));
      const mine = nu.filter((o) => (o.userData && o.userData.cruise) || o.type === 'SkinnedMesh' || (o.isGroup && o.children.some((c) => c.type === 'SkinnedMesh')));
      const vg = new Set(d.traffic.cars.map((v) => v.group));
      return JSON.stringify({ kids: d.scene.children.length, cars: d.traffic.cars.length, mine: mine.length, other: nu.filter((o) => !vg.has(o)).map((o) => o.name || o.type).slice(0, 12) }); })()`));
    console.log(`  scene children ${base.kids} -> ${end.kids} (new, not traffic: ${end.other.join(', ') || 'none'}), traffic ${base.cars} -> ${end.cars}`);
    ok(end.mine === 0, 'no leaked meet object in the scene');

    console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 6).join('\n    ') : ''}`);
    ok(errs.length === 0, '0 page exceptions');
    console.log(fails ? `FAIL (${fails})` : 'PASS');
    if (fails) process.exitCode = 1;
  } finally {
    closing = true;
    chrome.kill('SIGKILL');
  }
}
main().catch((e) => { console.error('cruiseprobe failed:', e.message); process.exitCode = 1; });
