// Auto KW: golf on the real courses (src/golf.js, data/golf.json), end to end.
//
//   node tools/kw/golfcheck.mjs [outdir] [course,...]      (AUTO_GPU=1, AUTO_PHONE=1)
//
// Boots like kwshots.mjs (service worker bypassed, __noAutoQuality, HUD
// hidden), then per course:
//   - aerials over the first holes and a tee-height view, with the scene
//     pass's draws and triangles (and the same with the course hidden);
//   - a round of three from the first tee, started through game.tryInteract
//     (ENTER) and played through the SWING button's own pointerdown: each
//     stroke stops the power meter where the shot needs it and the needle in
//     the sweet spot, at a fixed 1/60 s step (golf.frozen holds the game's
//     own clock off it). Prints every stroke, the card and the pay, and shoots
//     the tee, the swing meters, a drive in the air, a putt and the card.
// GOLF_WATER=1 also hits one into the water and one out of bounds.

import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/golfshots';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const PHONE = process.env.AUTO_PHONE === '1';

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-golf-profile-${PORT}`, width: 1280, height: 720,
    extra: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map(); const errs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception');
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + (m.params.args || []).map((a) => a.value || a.description).join(' '));
    });
    const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
    const evaluate = async (e, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    };
    const shot = async (name) => {
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
      writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(result.data, 'base64'));
      console.log(`  ${OUT}/${name}.jpg`);
    };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    if (PHONE) {
      await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    let up = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await evaluate('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality)')) { up = true; break; }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
    console.log(`booted${PHONE ? ' (phone)' : ''}; exceptions at boot: ${errs.length}${errs.length ? '\n  ' + errs.slice(0, 5).join('\n  ') : ''}`);
    await sleep(3000);
    if (!PHONE) await evaluate(`window.__dbg.applyQuality('high', true)`);
    await evaluate(`(() => { for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns'])
      { const e = document.getElementById(id); if (e) e.style.display = 'none'; } window.__dbg.game.paused = true; })()`);
    const info = await evaluate(`(() => { const g = window.__dbg.golf; if (!g) return null;
      return { courses: g.courses.map((C) => ({ id: C.id, name: C.name, holes: C.holes.length, polys: C.polys.length, tris: g.stats[C.id] })), tris: g.stats.tris,
        clear: g.courses.map((C) => { const h = C.holes[0]; return [h.pin.x, h.pin.z, g.keepClear(h.pin.x, h.pin.z), window.__dbg.city.jumpClear(h.pin.x, h.pin.z)]; }) }; })()`);
    console.log('golf:', JSON.stringify(info));
    if (!info) throw new Error('no golf in __dbg');
    mkdirSync(OUT, { recursive: true });
    const tag = PHONE ? 'phone-' : '';

    for (const C of info.courses) {
      if (ONLY && !ONLY.includes(C.id)) continue;
      // --- views: an aerial over the first holes and an eye-level one down hole 1
      const view = async (name, js) => {
        await evaluate(`(() => { const d = window.__dbg, g = d.golf, C = g.courses.find((c) => c.id === '${C.id}'), h = C.holes[0];
          const cam = d.camera, G = d.G; let cx, cy, cz, tx, ty, tz; ${js}
          const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
          d.player.teleport ? d.player.teleport(cx, cz) : null;
          d.world.update(cx, cz, 60); for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(cx, cz, 60);
          cam.fov = 60; cam.updateProjectionMatrix(); cam.position.set(cx, cy, cz); cam.lookAt(tx, ty, tz); cam.updateMatrixWorld(true);
          d.sun.position.set(cx - 215, cy + 200, cz - 150); d.sun.target.position.set(cx, cy - 50, cz); d.sun.target.updateMatrixWorld(); })()`);
        await sleep(+process.env.VIEW_WAIT || 5000);
        const on = await evaluate('({ calls: window.__dbg.sceneStats.calls, tris: window.__dbg.sceneStats.tris })');
        await shot(`${tag}${C.id}-${name}`);
        await evaluate('window.__dbg.golf.courseMesh.visible = false');
        await sleep(2500);
        const off = await evaluate('({ calls: window.__dbg.sceneStats.calls, tris: window.__dbg.sceneStats.tris })');
        await evaluate('window.__dbg.golf.courseMesh.visible = true');
        console.log(`  ${name}: ${on.calls} draws ${(on.tris / 1000).toFixed(0)}k tris; course hidden ${off.calls} draws ${(off.tris / 1000).toFixed(0)}k tris`);
      };
      await view('aerial', `const p = h.line[0], q = C.holes[1].pin; const mx = (p[0] + q.x) / 2, mz = (p[1] + q.z) / 2;
        const dx = q.x - p[0], dz = q.z - p[1], l = Math.hypot(dx, dz) || 1;
        cx = mx + dz / l * 260; cz = mz - dx / l * 260; cy = G.terrainHeight(mx, mz) + 190; tx = mx; tz = mz; ty = G.terrainHeight(mx, mz);`);
      await view('teebox', `cx = h.tee.x - h.ux * 6; cz = h.tee.z - h.uz * 6; cy = G.terrainHeight(cx, cz) + 1.8;
        tx = h.tee.x + h.ux * 120; tz = h.tee.z + h.uz * 120; ty = G.terrainHeight(tx, tz) + 2;`);

      // --- a round of three from the first tee, through ENTER and the SWING button
      const start = await evaluate(`(() => { const d = window.__dbg, g = d.golf, C = g.courses.find((c) => c.id === '${C.id}'), t = C.holes[0].tee;
        d.game.paused = false;
        d.player.teleport ? d.player.teleport(t.x + 2, t.z + 1) : null;
        d.player.x = t.x + 2; d.player.z = t.z + 1; d.player.y = d.G.terrainHeight(d.player.x, d.player.z);
        const ok = d.game.tryInteract(d.player);
        g.frozen = true;
        return { ok, active: g.active, course: g.C.id, k0: g.k0, state: g.state, money: d.game.money }; })()`);
      console.log('  start:', JSON.stringify(start));
      if (!start.active) { console.log('  FAIL: the round did not start'); process.exitCode = 1; continue; }
      await evaluate(`window.__golfStep = (n) => { const g = window.__dbg.golf; for (let i = 0; i < n; i++) { g.frozen = false; g.update(1 / 60); g.frozen = true; if (g.state === 'off') break; } return g.state; };
        window.__golfTap = () => { document.querySelector('#golfUi .gSwing').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })); };`);
      await evaluate('__golfStep(30)');
      await sleep(2500);
      await shot(`${tag}${C.id}-tee`);
      const money0 = start.money;
      let shotsTaken = 0, flightShot = false, puttShot = false, waterDone = !process.env.GOLF_WATER;
      // a shot that comes back to where it was hit (out of bounds, a trunk
      // right in front) is played again shorter and a little to one side, as a
      // player would -- the same shot again loops for ever
      let lastAt = null, retry = 0;
      for (let s = 0; s < 40; s++) {
        const st = await evaluate('window.__dbg.golf.state');
        if (st === 'card' || st === 'off') break;
        if (st !== 'aim') { await evaluate('__golfStep(20)'); continue; }
        // the power this stroke needs: a full club's carry goes as power,
        // a putt's roll as its pace squared
        const plan = await evaluate(`(() => { const g = window.__dbg.golf, h = g.h;
          const dPin = Math.hypot(h.pin.x - g.bx, h.pin.z - g.bz), putt = g.clubI === ${7};
          const d = putt ? dPin : (g.tgt ? g.tgt.d : dPin);
          const carry = [215, 195, 165, 145, 122, 105, 80][g.clubI] || 80;
          let p = putt ? (Math.sqrt(2 * (g.lie === 'green' ? 0.62 : 1.1) * dPin) * 1.04 - 0.5) / 6.2 : Math.min(1, (g.tgt && g.tgt.pin ? d * 0.88 : d) / carry);
          return { scores: g.scores.length, hole: h.lab || h.n, par: h.par, stroke: g.strokes + 1, lie: g.lie, club: ['DRIVER','3 WOOD','5 IRON','7 IRON','9 IRON','P WEDGE','S WEDGE','PUTTER'][g.clubI], dPin: +dPin.toFixed(1), d: +d.toFixed(1), p: +Math.max(0.03, Math.min(1, p)).toFixed(3), putt, at: [+g.bx.toFixed(1), +g.bz.toFixed(1)] }; })()`);
        if (!waterDone && plan.hole === 1 && plan.stroke === 1) {
          // a ball dropped into the water hazard nearest the tee and one off the course
          const r = await evaluate(`(() => { const g = window.__dbg.golf, C = g.C;
            const w = C.polys.find((p) => p.kind === 'water'); const out = { water: null, oob: null };
            if (w) { const [x, z] = [w.pts.reduce((a, q) => a + q[0], 0) / w.pts.length, w.pts.reduce((a, q) => a + q[1], 0) / w.pts.length];
              const s0 = g.strokes; g.prev = { x: g.bx, z: g.bz }; g.dry = { x: g.bx, z: g.bz }; g.bx = x; g.bz = z; g.vel = new window.__dbg.THREE.Vector3(0, -5, 0); g.spin = 0; g.state = 'fly';
              g.by = window.__dbg.G.terrainHeight(x, z) + 1; __golfStep(30);
              out.water = { strokes: g.strokes - s0, surf: g._surf(x, z), ball: [+g.bx.toFixed(1), +g.bz.toFixed(1)], dropSurf: g._surf(g.bx, g.bz), state: g.state }; __golfStep(80); }
            const s1 = g.strokes; const t = C.holes[0].tee; g.prev = { x: t.x, z: t.z };
            const bx = C.boundary[0][0] + (C.boundary[0][0] - (C.x0 + C.x1) / 2) * 0.05, bz = C.boundary[0][1] + (C.boundary[0][1] - (C.z0 + C.z1) / 2) * 0.05;
            g.bx = bx; g.bz = bz; g.vel = new window.__dbg.THREE.Vector3(0.01, 0, 0); g.state = 'roll'; __golfStep(4);
            out.oob = { strokes: g.strokes - s1, surf: g._surf(bx, bz), back: [+g.bx.toFixed(1), +g.bz.toFixed(1)], tee: [t.x, t.z] };
            g.strokes = 0; g._placeBall(t.x, t.z); __golfStep(80); return out; })()`);
          console.log('  penalties:', JSON.stringify(r));
          waterDone = true;
          continue;
        }
        if (lastAt && Math.hypot(plan.at[0] - lastAt[0], plan.at[1] - lastAt[1]) < 6 && !plan.putt) retry++; else retry = 0;
        lastAt = plan.at;
        if (retry) {
          plan.p = +(plan.p * Math.pow(0.78, retry)).toFixed(3);
          const turn = (retry % 2 ? 1 : -1) * 0.3 * Math.ceil(retry / 2);
          await evaluate(`(() => { const g = window.__dbg.golf; g.aim += ${turn}; g._hud && g._hud(); })()`);
          console.log(`  (the last shot came back: power ${plan.p}, aim ${turn > 0 ? '+' : ''}${turn} rad)`);
        }
        await evaluate('__golfTap()');                 // aim -> power
        // run the meter up to the power wanted
        await evaluate(`(() => { const g = window.__dbg.golf; for (let i = 0; i < 200 && g._meter() < ${plan.p} - 0.008; i++) __golfStep(1); })()`);
        if (!plan.putt && !flightShot) { await evaluate('__golfStep(0)'); }
        await evaluate('__golfTap()');                 // stop power (a putt goes)
        if (!plan.putt) {
          await evaluate(`(() => { const g = window.__dbg.golf; for (let i = 0; i < 200 && g._needle() > 0.1 + 0.006; i++) __golfStep(1); })()`);
          if (!flightShot) { await sleep(1500); await shot(`${tag}${C.id}-swing`); }
          await evaluate('__golfTap()');               // stop the needle in the white
        } else if (!puttShot) {
          await evaluate('__golfStep(30)'); await sleep(1500); await shot(`${tag}${C.id}-putt`); puttShot = true;
        }
        shotsTaken++;
        // the flight: shoot the first drive mid-air
        let r;
        for (let i = 0; i < 400; i++) {
          r = await evaluate(`(() => { const g = window.__dbg.golf; const st = __golfStep(10);
            return { st, t: g.t, x: g.bx, y: g.by, z: g.bz }; })()`);
          if (!flightShot && r.st === 'fly' && r.t > 1.4) { await sleep(1500); await shot(`${tag}${C.id}-flight`); flightShot = true; }
          if (r.st === 'aim' || r.st === 'holed' || r.st === 'card' || r.st === 'off') break;
        }
        const after = await evaluate(`(() => { const g = window.__dbg.golf, h = g.h;
          return { state: g.state, dPin: +Math.hypot(h.pin.x - g.bx, h.pin.z - g.bz).toFixed(1), lie: g.state === 'aim' ? g.lie : g._surf(g.bx, g.bz), strokes: g.strokes, scores: g.scores.slice() }; })()`);
        const holed = after.state === 'holed' || after.state === 'card' || after.scores.length > plan.scores;
        console.log(`  hole ${plan.hole} (par ${plan.par}) stroke ${plan.stroke}: ${plan.club} from ${plan.lie} ${plan.dPin} m out, power ${plan.p} -> ${holed ? 'HOLED' : after.lie + ' ' + after.dPin + ' m'}`);
        if (after.state === 'holed') await evaluate('__golfStep(200)');
      }
      const card = await evaluate(`(() => { const d = window.__dbg, g = d.golf; return { state: g.state, scores: g.scores, pars: g.holes.map((h) => h.par), paid: g.paid,
        card: document.querySelector('#golfUi .gCardT').textContent, best: g.best, store: localStorage.getItem('autokw-golf-' + g.C.id), money: d.game.money }; })()`);
      console.log('  card:', JSON.stringify(card), `wallet +${card.money - money0}`);
      if (card.state !== 'card') { console.log('  FAIL: the round never reached the card'); process.exitCode = 1; }
      await sleep(1500);
      await shot(`${tag}${C.id}-card`);
      await evaluate(`(() => { const d = window.__dbg, g = d.golf; g.frozen = false; document.querySelector('#golfUi .gDone').click(); d.game.paused = true;
        return g.state; })()`);
      const holds = await evaluate('[...window.__dbg.game.holds]');
      console.log(`  closed; holds left: ${JSON.stringify(holds)}`);
    }
    console.log(`exceptions: ${errs.length}${errs.length ? '\n  ' + errs.slice(0, 8).join('\n  ') : ''}`);
    if (errs.length) process.exitCode = 1;
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('golfcheck failed:', e.message); process.exitCode = 1; });
