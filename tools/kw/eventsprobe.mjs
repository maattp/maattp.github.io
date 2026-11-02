// Auto KW random events (src/kwevents.js): force each event near the player,
// step it at a fixed dt to completion (including the player-interaction path),
// assert full teardown, and shoot it mid-way.
//
//   AUTO_HTTP_PORT=8204 AUTO_CDP_PORT=9504 AUTO_GPU=1 node tools/kw/eventsprobe.mjs <outdir> [geese,snatcher,...]
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9504;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8204;
const OUT = process.argv[2] || 'tools/data/kw/eventshots';
const ALL = ['geese', 'snatcher', 'breakdown', 'chase', 'hockey', 'raccoon', 'wedding', 'fireworks'];
const ONLY = process.argv[3] ? process.argv[3].split(',') : ALL;
const [W, H] = [1280, 720];
const ANCHOR = [-3828, -1438];   // King St N, Uptown Waterloo

// The in-page driver: window.__evh. Fixed dt, game paused.
const PAGE = `(() => {
const d = window.__dbg, DT = 0.05;
const stepAll = (n, hook) => {
  const p = d.player;
  for (let i = 0; i < n && d.events.cur; i++) {
    if (hook) hook(i, d.events.cur);
    const pos = p.position;
    d.traffic.update(DT, pos.x, pos.z, { x: 0, z: 1 }, p);
    d.events.update(DT, p, d.camera); d.fx.update(DT);
  }
};
const drive = (x, z, h) => {
  const p = d.player; if (!p.onFoot && p.exitVehicle) p.exitVehicle();
  const v = d.traffic.spawnAt(x, z, h, 'sedan', 0xb02020, 'free');
  p.enterVehicle(v); return v;
};
const foot = (x, z) => { const p = d.player; if (!p.onFoot && p.exitVehicle) p.exitVehicle(); p.respawn(x, z); };
const carOf = () => d.player.vehicle;
const base = () => ({ tex: d.renderer.info.memory.textures, geo: d.renderer.info.memory.geometries });
const stray = () => { let n = 0; d.scene.traverse((o) => { if (o.name && o.name.startsWith('kwev:')) n++; }); return n; };
window.__evh = { d, stepAll, drive, foot, carOf, base, stray };
return true; })()`;

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
    const shot = async (name) => {
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
      writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(result.data, 'base64'));
      console.log(`    shot ${OUT}/${name}.jpg`);
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    for (let i = 0; i < 400; i++) { if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality)').catch(() => false)) break; await sleep(500); }
    console.log('  booted; exceptions so far:', errs.length);
    await sleep(3000);
    await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true); const g = document.getElementById('startBtn') || document.getElementById('play'); if (g) g.click(); })()`);
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });
    await ev(PAGE);
    check(await ev('!!window.__dbg.events'), 'the director exists (__dbg.events)');
    await ev('(() => { __evh.d.events.timer = 1e9; })()');

    // camera on the event's centre, game paused
    const look = async (name, dist = 16, up = 4.5, ang = 0.6, dy = 0) => {
      await ev(`(() => { const h = __evh, d = h.d, e = d.events.cur; if (!e) return;
        const cx = e.cx, cz = e.cz, y = d.G.terrainHeight(cx, cz);
        // the nearest-to-asked camera spot with a clear line to the action (no building in the way)
        let best = null;
        for (const k of [1, 1.5, 2.2]) for (let a = 0; a < 16 && !best; a++) {
          const an = ${ang} + (a % 2 ? 1 : -1) * Math.ceil(a / 2) * 0.39, x = cx + Math.sin(an) * ${dist} * k, z = cz + Math.cos(an) * ${dist} * k;
          let ok = !d.city.insideBuilding(x, z, y + ${up}, 0.5) && !d.city.insideBuilding(x, z, y + 1, 0.5);
          for (let t = 0.1; t < 1 && ok; t += 0.1) { const px = x + (cx - x) * t, pz = z + (cz - z) * t; if (d.city.insideBuilding(px, pz, y + 1.6, 0.3)) ok = false; }
          if (ok) best = [x, z];
        }
        if (!best) best = [cx + Math.sin(${ang}) * ${dist}, cz + Math.cos(${ang}) * ${dist}];
        d.camera.position.set(best[0], y + ${up}, best[1]);
        d.camera.lookAt(cx, y + 1.4 + ${dy}, cz); d.camera.updateMatrixWorld(); d.game.paused = true; })()`);
      await sleep(900);
      await shot(name);
    };
    const begin = (name, start, opts) => ev(`(() => { const h = __evh, d = h.d; d.game.paused = true; d.game.money = 0; d.game.wanted = 0; ${start}
        h.b = h.base();
        const ok = d.events.start(${JSON.stringify(name)}, ${opts});
        const e = d.events.cur;
        return { ok, cars: e ? e.cars.length : 0, people: e ? e.people.length : 0, objs: e ? e.objs.length : 0, cx: e && e.cx, cz: e && e.cz }; })()`);
    const finish = async (name) => {
      const r = await ev(`(() => { const h = __evh, d = h.d;
        const e = d.events.cur; const ended = !e; const mine = e ? e.cars.slice() : [];
        if (e) d.events.stop();
        const left = mine.filter((v) => d.traffic.cars.includes(v)).length;
        return { ended, left, stray: h.stray(), leaks: d.game.leaks.length, holds: d.game.holds.size, tex: d.renderer.info.memory.textures - h.b.tex, geo: d.renderer.info.memory.geometries - h.b.geo, cur: !!d.events.cur }; })()`);
      check(!r.cur && r.left === 0 && r.stray === 0 && r.leaks === 0 && r.holds === 0, `${name}: torn down (cars left ${r.left}, stray meshes ${r.stray}, leaks ${r.leaks}, holds ${r.holds}); textures ${r.tex}, geometries ${r.geo}; ended by itself: ${r.ended}`);
      return r;
    };

    for (const name of ONLY) {
      console.log(name.toUpperCase());
      await ev(`(() => { __evh.d.tod.choose(${name === 'fireworks' ? "'night'" : "'day'"}); })()`);
      await sleep(600);
      const b = await begin(name, `h.foot(${ANCHOR[0]}, ${ANCHOR[1]});`, name === 'fireworks' ? '{ anywhere: true, shots: 8 }' : '{ range: [60, 110] }');
      check(b.ok, `${name} starts near the player`);
      if (!b.ok) continue;
      console.log('    ', JSON.stringify(b));
      if (name !== 'fireworks') check(b.cars + b.people + b.objs > 0, `${name} has actors in the world (${b.cars} cars, ${b.people} people, ${b.objs} meshes)`);
      let r;
      if (name === 'geese') {
        await ev(`__evh.stepAll(220)`); await look('geese', 14, 3.2, 0.9);
        await ev(`(() => { const h = __evh, e = h.d.events.cur; h.drive(e.cx - e.f[0] * 30, e.cz - e.f[1] * 30, Math.atan2(e.f[0], e.f[1])); })()`);
        await ev(`__evh.stepAll(700)`);
        r = await ev(`({ money: __evh.d.game.money })`);
        check(r.money === 60, `waiting for the goslings pays $60 (got ${r.money})`);
        await ev(`__evh.stepAll(2000)`);
      } else if (name === 'snatcher') {
        await ev(`__evh.stepAll(55)`); await look('snatcher', 12, 3, 0.9);
        await ev(`__evh.stepAll(3000, (i, e) => { const p = __evh.d.player; if (e.state !== 'run') return; const t = e.thief; const dx = t.x - p.x, dz = t.z - p.z, l = Math.hypot(dx, dz) || 1; const s = Math.min(l, 7.2 * 0.05); p.x += dx / l * s; p.z += dz / l * s; p.speed = 7; })`);
        r = await ev(`({ money: __evh.d.game.money })`);
        check(r.money >= 120, `tackling the snatcher pays (got $${r.money})`);
      } else if (name === 'breakdown') {
        await ev(`__evh.stepAll(30)`); await look('breakdown', 11, 2.6, 0.9);
        await ev(`(() => { const h = __evh, e = h.d.events.cur; h.drive(e.v.x - Math.sin(e.v.heading) * 8, e.v.z - Math.cos(e.v.heading) * 8, e.v.heading); })()`);
        await ev(`__evh.stepAll(400)`);
        r = await ev(`({ money: __evh.d.game.money, state: __evh.d.events.cur && __evh.d.events.cur.state })`);
        check(r.money >= 60 && r.state === 'go', `stopping to help pays a tip (got $${r.money}, ${r.state})`);
        await ev(`__evh.stepAll(60)`); await look('breakdown-go', 16, 3.5, 0.9);
        await ev(`__evh.stepAll(3000)`);
      } else if (name === 'chase') {
        await ev(`__evh.stepAll(60)`); await look('chase', 22, 4.5, 0.8);
        await ev(`(() => { const h = __evh, e = h.d.events.cur; h.drive(e.sus.v.x, e.sus.v.z, e.sus.v.heading); })()`);
        await ev(`__evh.stepAll(1500, (i, e) => { const v = __evh.carOf(), s = e.sus.v; if (e.state !== 'chase') return; const f = s.forward; v.x = s.x - f.x * 4.4; v.z = s.z - f.z * 4.4; v.heading = s.heading; v.vLong = 18; })`);
        r = await ev(`({ money: __evh.d.game.money })`);
        check(r.money === 400, `ramming the suspect twice pays the $400 bounty (got $${r.money})`);
        await look('chase-stopped', 18, 4, 0.7);
        await ev(`__evh.stepAll(3000)`);
      } else if (name === 'hockey') {
        await ev(`__evh.stepAll(60)`); await look('hockey', 15, 3.8, 0.7);
        await ev(`(() => { const h = __evh, e = h.d.events.cur; h.drive(e.cx - e.f[0] * 70, e.cz - e.f[1] * 70, Math.atan2(e.f[0], e.f[1])); })()`);
        await ev(`__evh.stepAll(140, (i, e) => { const v = __evh.carOf(); v.x += e.f[0] * 6 * 0.05; v.z += e.f[1] * 6 * 0.05; v.vLong = 6; })`);
        r = await ev(`({ clear: __evh.d.events.cur.clear })`);
        check(r.clear, 'the kids clear the nets for a car ("CAR!")');
        await look('hockey-car', 14, 3.2, 0.7);
        await ev(`__evh.stepAll(200, (i, e) => { const v = __evh.carOf(); v.x += e.f[0] * 6 * 0.05; v.z += e.f[1] * 6 * 0.05; v.vLong = 6; })`);
        r = await ev(`({ money: __evh.d.game.money })`);
        check(r.money === 15, `a slow pass earns the kids' thanks ($${r.money})`);
        await ev(`__evh.stepAll(3000)`);
      } else if (name === 'raccoon') {
        await ev(`__evh.stepAll(55)`); await look('raccoon', 6, 2.2, 0.9, -0.5);
        await ev(`(() => { const h = __evh, e = h.d.events.cur; h.foot(e.rx - 12, e.rz); })()`);
        await ev(`__evh.stepAll(400, (i, e) => { const p = __evh.d.player; if (e.state === 'eat') { p.x += 0.12; p.speed = 2.4; } })`);
        r = await ev(`({ st: __evh.d.events.cur ? __evh.d.events.cur.state : 'ended' })`);
        check(r.st === 'run' || r.st === 'ended', `the raccoon bolts when you walk up (${r.st})`);
        await ev(`__evh.stepAll(3000)`);
      } else if (name === 'wedding') {
        await ev(`__evh.stepAll(60)`); await look('wedding', 24, 4.5, 0.9);
        await ev(`(() => { const h = __evh, e = h.d.events.cur, last = e.cv[e.cv.length - 1].v; h.drive(last.x, last.z, last.heading); })()`);
        await ev(`__evh.stepAll(1200, (i, e) => { const v = __evh.carOf(), l = e.cv[e.cv.length - 1].v, f = l.forward; v.x = l.x - f.x * 9; v.z = l.z - f.z * 9; v.heading = l.heading; v.vLong = 9; })`);
        r = await ev(`({ money: __evh.d.game.money })`);
        check(r.money === 75, `tagging on to the convoy earns cake ($${r.money})`);
        await look('wedding-join', 20, 4, 0.5);
        await ev(`__evh.stepAll(5000)`);
      } else if (name === 'fireworks') {
        await ev(`__evh.stepAll(55)`);
        await ev(`(() => { const e = __evh.d.events.cur, d = __evh.d; d.camera.position.set(e.cx - 130, d.G.terrainHeight(e.cx, e.cz) + 30, e.cz - 130); d.camera.lookAt(e.cx, d.G.terrainHeight(e.cx, e.cz) + 120, e.cz); d.camera.updateMatrixWorld(); })()`);
        await sleep(700); await shot('fireworks');
        await ev(`__evh.stepAll(6000)`);
      }
      await finish(name);
      await ev(`(() => { __evh.d.game.paused = false; })()`);
    }
    const dir = await ev(`(() => { const d = __evh.d, E = d.events; d.events.stop(); E.setEnabled(false); const off = E.canStart(d.player); E.setEnabled(true); E.last = 'geese'; const picks = new Set(); for (let i = 0; i < 200; i++) picks.add(E.pickName()); return { off, hasGeese: picks.has('geese'), n: picks.size }; })()`);
    check(dir.off === false && !dir.hasGeese, `director: off means off; never the same event back to back (${dir.n} kinds picked)`);
    console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 6).join('\n    ') : ''}`);
    if (errs.length) fails++;
    console.log(fails ? `FAILED ${fails}` : 'ALL OK');
    process.exitCode = fails ? 1 : 0;
  } finally { chrome.kill('SIGKILL'); }
}
main().catch((e) => { console.error('eventsprobe failed:', e.message); process.exitCode = 1; });
