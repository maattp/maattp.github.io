// Auto KW: import/export, the wanted list (src/exportyard.js), end to end.
//
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 node tools/kw/exportprobe.mjs [outdir]
//
// Boots like garageprobe.mjs (service worker bypassed), leaves the game RUNNING. Checks the yard is
// placed on Parkway Auto Recyclers' frontage (Manitou Dr) with a map place; shoots it by day; a type
// NOT on the list is refused ("Not on the list") and so are a wreck, a car with the law on you and a
// car still parked in your garage; a WANTED type driven onto the bay on a real W press is bought (pay
// scaled by health, list ticked, saved, player put on foot, the crane lifts it, slews, the ram
// crushes it, the car leaves traffic); the last one on the list pays the bonus and leaves the gold
// DeLorean by the gate (which the yard will not buy back); the passport lists the twelve with ticks;
// a RELOAD keeps the state and the gift car; nothing leaks (holds, 'path' cars, sequences, scene
// groups). Exit 1 on a failure or a page exception.
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/exportshots';
let closing = false, fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-export-profile-${PORT}`, width: 1280, height: 720, extra: ['--autoplay-policy=no-user-gesture-required'] });
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
        if (m.params.type === 'error' || /export yard/.test(t)) errs.push(m.params.type + ': ' + t);
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
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
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
    const HSRC = `window.__h = {
      toasts: [],
      L(lx, lz) { const s = window.__dbg.exportYard.sites[0].s, cr = Math.cos(s.rot), sr = Math.sin(s.rot); return [s.ox + lx * cr - lz * sr, s.oz + lx * sr + lz * cr]; },
      loc(x, z) { const Y = window.__dbg.exportYard; return Y.local(Y.sites[0], x, z); },
      put(lx, lz, type, col) {
        const d = window.__dbg, s = d.exportYard.sites[0].s;
        const [x, z] = this.L(lx, lz);
        let v = d.player.vehicle;
        if (v) { d.player.exitVehicle(true); d.traffic.remove(v); v = null; }
        v = d.traffic.spawnAt(x, z, 0, type, col || 0x2255aa, 'free'); d.player.enterVehicle(v);
        v.place(x, z, Math.atan2(s.nx, s.nz));
        v.vLong = 0; v.vy = 0; v.dead = false;
        d.world.update(x, z, 60);
        return v;
      },
      foot(lx, lz, tlx, tlz) {
        const d = window.__dbg;
        if (d.player.vehicle) { const v = d.player.vehicle; d.player.exitVehicle(true); d.traffic.remove(v); }
        const [x, z] = this.L(lx, lz), [tx, tz] = this.L(tlx, tlz);
        d.player.x = x; d.player.z = z; d.player.y = d.city.groundAt(x, z, null) + 0.1;
        d.player.heading = Math.atan2(tx - x, tz - z);
        d.world.update(x, z, 60);
      },
      notOn() { const Y = window.__dbg.exportYard; const on = new Set(Y.st.list.map((r) => r.t)); return ['crossover','suv','sedan','minivan','pickup','compsedan','hatch','wagon','ev','van','civic','suv3'].find((t) => !on.has(t)); },
      mark() { this.n0 = this.toasts.length; }, lastToast() { return this.toasts.slice(this.n0 || 0).join(' | '); },
    };
    { const H = window.__dbg.hud, f = H.showToast.bind(H); H.showToast = (t, ms) => { window.__h.toasts.push(String(t)); return f(t, ms); }; }`;
    const boot = async () => {
      await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
      let up = false;
      for (let i = 0; i < 400; i++) {
        await sleep(500);
        try { if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.player && window.__dbg.exportYard)')) { up = true; break; } } catch { /* navigating */ }
        if (errs.length > 0 && i > 6) break;
      }
      if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
      await sleep(3000);
      await ev(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); const r = document.getElementById('rotate'); if (r) r.style.display = 'none';
        if (window.__dbg.game.paused) document.getElementById('resumeBtn').click(); })()`);
      await sleep(800);
      await ev(HSRC);
    };
    await boot();
    console.log(`booted; exceptions at boot: ${errs.length}`);
    const D = (e) => ev(`(() => { const d = window.__dbg, Y = d.exportYard, H = window.__h; ${e} })()`);

    console.log('--- the yard');
    const site = JSON.parse(await D(`const q = Y.sites[0]; return JSON.stringify(q ? { ox: q.s.ox, oz: q.s.oz, dist: Math.round(q.s.dist), slope: +q.s.slope.toFixed(2), street: q.s.street } : null)`));
    console.log('  ', JSON.stringify(site));
    ok(!!site, 'the yard was placed');
    ok(site && site.street === 'Manitou Drive' && site.dist < 120, `on Manitou Drive, ${site && site.dist} m from Parkway Auto Recyclers' frontage point`);
    const inPoly = (await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => { const m = await import('/apps/autokw/src/exportyard.js'); const q = window.__dbg.exportYard.sites[0], P = m.YARD.poly;
      const [x, z] = window.__h.L(0, 9); let inside = false, dmin = 1e9;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [xi, zi] = P[i], [xj, zj] = P[j];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
        const ex = xj - xi, ez = zj - zi, t = Math.max(0, Math.min(1, ((x - xi) * ex + (z - zi) * ez) / (ex * ex + ez * ez)));
        dmin = Math.min(dmin, Math.hypot(x - xi - ex * t, z - zi - ez * t));
      }
      const n = window.__dbg.city.clearCircles.length, t0 = performance.now(); m.placeYard(window.__dbg.city, null); const ms = performance.now() - t0; window.__dbg.city.clearCircles.length = n;
      return JSON.stringify({ inside, d: Math.round(dmin), ms: Math.round(ms) }); })()` })).result?.result?.value;
    console.log('  polygon / search', inPoly);
    { const r = JSON.parse(inPoly || '{}'); ok(r.inside || r.d < 40, `the yard is on Parkway Auto Recyclers' OSM lot (${r.inside ? 'inside' : r.d + ' m from'} the polygon); boot search ${r.ms} ms`); }
    ok(await D(`return d.hud.places.filter((p) => p.kind === 'export').length === 1 && /Parkway/.test(d.hud.places.find((p) => p.kind === 'export').hello())`), 'a map place (kind export) with a hello');
    await D(`localStorage.removeItem('autokw-export'); Y.load(); Y.save(); d.game.money = 1000; d.game.wanted = 0;`);
    const list = JSON.parse(await D(`return JSON.stringify(Y.list())`));
    console.log('  list', list.map((r) => `${r.t}:${r.p}`).join(' '));
    ok(list.length === 12 && new Set(list.map((r) => r.t)).size === 12, 'a list of 12 distinct types');
    ok(list.filter((r) => r.tier === 'rare').length === 2 && list.filter((r) => r.tier === 'common').length === 6, 'six common, four uncommon, two rare');
    ok(await D(`return Y.st.list.every((r) => !!d.TYPES[r.t] && d.TYPES[r.t].roadCar)`), 'every type exists and is a road car');
    ok(await D(`return Y.st.list.every((r) => !/^[a-z]/.test(r.name || '')) && Y.list().every((r) => r.name && r.name[0] === r.name[0].toUpperCase())`), 'every type has a readable name: ' + list.map((r) => r.name).join(', '));
    const lens = JSON.parse(await D(`const o = {}; for (const k of ['common','uncommon','rare']) for (const t of []) o[t]=1; for (const r of Y.st.list) o[r.t] = d.TYPES[r.t].len; return JSON.stringify(o)`));
    ok(Object.values(lens).every((l) => l <= 8.6), 'every listed type fits the bay (len <= 8.6): ' + JSON.stringify(lens));

    await D(`H.foot(-3, -24, 2, 8)`);
    await sleep(4000);
    ok(await D(`return !!Y.sites[0].grp && Y.sites[0].grp.visible`), 'built lazily and shown when near');
    const cost = JSON.parse(await D(`const q = Y.sites[0]; let tris = 0, draws = 0; q.grp.traverse((o) => { if (o.isMesh && o.visible) { draws++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return JSON.stringify({ draws, tris: Math.round(tris), rigVerts: q.rig.pos.count })`));
    console.log('  cost', JSON.stringify(cost));
    ok(cost.draws === 3, `3 draws (${cost.draws}), ${cost.tris} tris, the rig ${cost.rigVerts} verts`);
    await shot('yard-day');
    await D(`H.foot(16, -5, 0, 10)`); await sleep(2500); await shot('yard-day-side');

    console.log('--- refusals');
    const notOn = await D(`return H.notOn()`);
    await D(`H.mark(); H.put(0, 6, '${notOn}')`); await sleep(2600);
    ok(/Not on the list/.test(await D(`return H.lastToast()`)) && await D(`return !Y.seq && !!d.player.vehicle`), `a ${notOn} (not on the list) is refused: "${await D(`return H.lastToast()`)}"`);
    const want = list.find((r) => r.tier === 'common').t;
    await D(`H.mark(); const v = H.put(0, 6, '${want}'); v.health = 8;`); await sleep(2600);
    ok(/wreck/.test(await D(`return H.lastToast()`)) && await D(`return !Y.seq && Y.count === 0`), `a wanted ${want} at 8 health is refused as a wreck: "${await D(`return H.lastToast()`)}"`);
    await D(`H.mark(); H.put(0, 6, '${want}'); d.game.wanted = 2;`); await sleep(2600);
    ok(/cops/.test(await D(`return H.lastToast()`)) && await D(`return !Y.seq && Y.count === 0`), 'refused with the law on you');
    await D(`H.mark(); d.game.wanted = 0; if (d.police) d.police.clear(); const v = H.put(0, 6, '${want}'); v.garage = ['home', 0];`); await sleep(2600);
    ok(/garage/.test(await D(`return H.lastToast()`)) && await D(`return !Y.seq && Y.count === 0`), 'refused while still a garage car');

    console.log('--- a delivery, driven in on W');
    const m0 = await D(`return d.game.money`);
    await D(`d.game.wanted = 0; const v = H.put(0, -10, '${want}', 0xc0392b); v.health = (v.spec.hp || 100) * 0.75; window.__v = v;`);
    await sleep(800);
    await shot('approach');
    await key('w', true);
    const inBay = await until(`(() => { const v = window.__v, l = window.__h.loc(v.x, v.z); return l.lz > 0.5; })()`, 40);
    await key('w', false);
    await key('s', true);
    await until(`Math.abs(window.__v.vLong) < 0.6 || !!window.__dbg.exportYard.seq`, 15);
    await key('s', false);
    ok(inBay, 'drove onto the bay on a real W press');
    ok(await until(`!!window.__dbg.exportYard.seq`, 20), 'stopping on the bay starts the sequence');
    const st = JSON.parse(await D(`return JSON.stringify({ got: Y.st.got, money: d.game.money, ls: JSON.parse(localStorage.getItem('autokw-export')), foot: d.player.onFoot && !d.player.vehicle, mode: window.__v.mode, dead: window.__v.dead, last: Y.last, holds: [...d.game.holds] })`));
    const item = list.find((r) => r.t === want);
    ok(st.got.length === 1 && st.got[0] === want && st.ls.got[0] === want, 'the list is ticked and saved');
    ok(st.money - m0 === st.last.pay && st.last.pay === Math.round(item.p * (0.4 + 0.6 * 0.75) / 5) * 5, `paid ${st.last.pay} for a ${item.p} car at 75 % (scaled by health)`);
    ok(st.foot, 'the player is put on foot');
    ok(st.mode === 'path' && st.dead, 'the car is handed to the crane (mode path, not enterable)');
    ok(st.holds.length === 0, 'nothing is held');
    await shot('handover');
    await until(`window.__dbg.exportYard.seq && window.__dbg.exportYard.seq.t > 2.4`, 40); await shot('crane-lift');
    const lifted = JSON.parse(await D(`const v = window.__v; return JSON.stringify({ up: v.y - Y.seq.y0 })`));
    ok(lifted.up > 2, `the car is lifted (${lifted.up.toFixed(1)} m)`);
    await until(`window.__dbg.exportYard.seq && window.__dbg.exportYard.seq.t > 3.9`, 40); await shot('crane-slew');
    await D(`H.foot(-2.5, 4, 8, 13.5)`);
    await until(`window.__dbg.exportYard.seq && window.__dbg.exportYard.seq.t > 6.3`, 40); await shot('crusher-ram');
    await until(`window.__dbg.exportYard.seq && window.__dbg.exportYard.seq.t > 7.05`, 40); await shot('crusher-dust');
    const sq = await D(`return Y.seq ? Y.seq.minK : 1`);
    ok(sq < 0.45, `crushed under the ram (squashed to ${(+sq).toFixed(2)} of its height)`);
    ok(await until(`!window.__dbg.exportYard.seq`, 40), 'the sequence ends');
    ok(await D(`return d.traffic.cars.indexOf(window.__v) < 0`), 'the car has left traffic');
    ok(await D(`return /Crushed/.test(H.toasts.join('|'))`), 'a pay toast');

    console.log('--- already have one');
    await D(`H.mark(); H.put(0, 6, '${want}')`); await sleep(2600);
    ok(/already have/.test(await D(`return H.lastToast()`)) && await D(`return !Y.seq`), 'a second of the same type is refused');

    console.log('--- completing the list');
    const lastT = list.find((r) => r.tier === 'rare').t;
    await D(`for (const r of Y.st.list) if (r.t !== '${lastT}' && !Y.st.got.includes(r.t)) Y.st.got.push(r.t); Y.save(); d.game.money = 0;`);
    const roll0 = await D(`return Y.st.roll`);
    await D(`const v = H.put(0, 6, '${lastT}'); window.__v = v;`);
    ok(await until(`!!window.__dbg.exportYard.seq`, 20), `the last one (a ${lastT}) is bought`);
    const done = JSON.parse(await D(`return JSON.stringify({ money: d.game.money, last: Y.last, un: Y.st.unlocked, ls: JSON.parse(localStorage.getItem('autokw-export')) })`));
    ok(done.last.complete && done.money === done.last.pay + 3000, `bonus $3000 paid on completion (money ${done.money})`);
    ok(done.un && done.ls.unlocked && done.ls.done === 1, 'the gift is unlocked and saved');
    ok(await until(`!window.__dbg.exportYard.seq`, 60), 'its sequence ends');
    const nl = JSON.parse(await D(`return JSON.stringify({ roll: Y.st.roll, got: Y.st.got.length, n: Y.st.list.length })`));
    ok(nl.roll === roll0 + 1 && nl.got === 0 && nl.n === 12, 'a new list is posted');
    ok(/LIST COMPLETE/.test(await D(`return H.toasts.join('|')`)), 'a completion toast');
    await D(`H.foot(4, -9, 8.6, 1.7)`);
    ok(await until(`!!window.__dbg.exportYard.prize`, 10), 'the gold DeLorean stands by the gate');
    const pz = JSON.parse(await D(`const v = Y.prize, l = H.loc(v.x, v.z); return JSON.stringify({ t: v.typeName, c: v.bodyMat.color.getHex(), m: v.mode, lx: l.lx, lz: l.lz })`));
    ok(pz.t === 'delorean' && pz.c === 0xd9a82e && pz.m === 'apron', 'gold, a DeLorean, parked (apron): ' + JSON.stringify(pz));
    await sleep(1500); await shot('gift-delorean');
    await D(`H.mark(); const v = Y.prize; d.player.enterVehicle(v); const [x, z] = H.L(0, 6); v.place(x, z, Math.atan2(Y.sites[0].s.nx, Y.sites[0].s.nz)); v.vLong = 0; if (!Y.st.list.some((r) => r.t === 'delorean')) Y.st.list[11].t = 'delorean';`);
    await sleep(2600);
    ok(/gift/.test(await D(`return H.lastToast()`)) && await D(`return !Y.seq`), 'the yard will not buy its gift back');

    console.log('--- pause menu');
    await D(`H.foot(-1.5, -20, 2, 9); Y.st.got.push(Y.st.list[0].t, Y.st.list[3].t); Y.save();`); await sleep(500);
    await ev(`document.getElementById('pauseBtn').click()`); await sleep(1500);
    const rows = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#ppGrid .ppExport .ppRow')].map((r) => r.textContent))`));
    console.log('  rows', JSON.stringify(rows));
    ok(rows.length === 12 && rows.filter((r) => /✓/.test(r)).length === 2 && rows.filter((r) => /☐/.test(r)).length === 10, 'the passport lists the twelve, two ticked');
    ok(await ev(`[...document.querySelectorAll('#ppGrid .ppRow')].some((r) => /Export list/.test(r.textContent))`), 'and an "Export list" count row');
    await ev(`(() => { const e = document.querySelector('#ppGrid .ppExport'); if (e) e.scrollIntoView({ block: 'center' }); })()`); await sleep(500);
    await shot('passport-list');
    await ev(`document.getElementById('resumeBtn').click()`); await sleep(500);

    console.log('--- reload');
    const before = await D(`return JSON.stringify({ wk: Y.st.wk, roll: Y.st.roll, list: Y.st.list.map((r) => r.t), got: Y.st.got, un: Y.st.unlocked })`);
    await boot();
    const after = await D(`return JSON.stringify({ wk: Y.st.wk, roll: Y.st.roll, list: Y.st.list.map((r) => r.t), got: Y.st.got, un: Y.st.unlocked })`);
    ok(before === after, 'the list, ticks and unlock survive a reload');
    await D(`H.foot(4, -9, 8.6, 1.7)`);
    ok(await until(`!!window.__dbg.exportYard.prize && window.__dbg.exportYard.prize.exportPrize`, 15), 'and the gift car is back by the gate');
    await sleep(1500); await shot('yard-after-reload');

    console.log('--- cleanup');
    const leak = JSON.parse(await D(`return JSON.stringify({ holds: [...d.game.holds], leaks: d.game.leaks ? d.game.leaks.slice() : [], path: d.traffic.cars.filter((c) => c.mode === 'path' && c.dead).length, seq: !!Y.seq, grps: Y.sites.filter((q) => q.grp && q.grp.parent === d.scene).length })`));
    ok(leak.holds.length === 0 && leak.leaks.length === 0, 'no holds and no reaped leaks');
    ok(leak.path === 0 && !leak.seq, 'no crane cars left in traffic, no sequence running');
    ok(leak.grps === 1, 'one yard group in the scene');
    // walk away: the gift car goes past RELEASE_R
    await D(`H.foot(0, -700, 0, -800)`); await sleep(2500);
    ok(await D(`return !Y.prize && !d.traffic.cars.some((c) => c.exportPrize)`), 'leaving the yard removes the gift car (it comes back next time)');
    const ex = errs.filter((e) => !/favicon/.test(e));
    ok(ex.length === 0, `no page exceptions${ex.length ? ': ' + ex.slice(0, 3).join(' | ') : ''}`);
    closing = true;
  } finally {
    chrome.kill('SIGKILL');
  }
  console.log(fails ? `FAILED ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('exportprobe failed:', e.message); process.exit(1); });
