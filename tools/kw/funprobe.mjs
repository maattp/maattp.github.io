// Auto KW: the KW fun things, played end to end through real input (CDP key
// and mouse events, as a thumb or keyboard would): the Rangers at the Aud
// (audrink.js + hockey.js), a festhalle's stein-holding contest and the
// Thanksgiving Day parade (oktoberfest.js), and Big Splash's slide
// (bigsplash.js: walk up the tower, ride, splash).
//
//   node tools/kw/funprobe.mjs <outdir> [aud,fest,parade,splash]
//   AUTO_HTTP_PORT / AUTO_CDP_PORT / AUTO_GPU=1 / AUTO_PHONE=1 as kwshots.mjs
//
// Prints each step, the draws/triangles inside each interior, the city's
// draws while it is closed again (the phone-cost check), and the page's
// exceptions (must be 0). Shots land in <outdir>.

import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/funshots';
const ONLY = process.argv[3] ? process.argv[3].split(',') : ['aud', 'fest', 'parade', 'splash'];
const PHONE = process.env.AUTO_PHONE === '1';
const [W, H] = PHONE ? [874, 402] : [1280, 720];

const KEYS = {
  KeyW: ['w', 87], KeyA: ['a', 65], KeyS: ['s', 83], KeyD: ['d', 68], KeyE: ['e', 69], KeyF: ['f', 70], KeyJ: ['j', 74], KeyK: ['k', 75],
  ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
  Space: [' ', 32], Enter: ['Enter', 13], Escape: ['Escape', 27], ShiftLeft: ['Shift', 16], KeyC: ['c', 67],
};

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-shots-profile-${PORT}`, width: W, height: H,
    extra: ['--autoplay-policy=no-user-gesture-required'] });
  let fails = 0;
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
    const ev = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
      return r.result?.result?.value;
    };
    const key = async (code, type) => {
      const [k, vk] = KEYS[code];
      await send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: type === 'keyDown' && k.length === 1 ? k : undefined });
    };
    const down = (c) => key(c, 'keyDown'), up = (c) => key(c, 'keyUp');
    const tap = async (c, ms = 90) => { await down(c); await sleep(ms); await up(c); };
    const hold = async (codes, ms) => { for (const c of codes) await down(c); await sleep(ms); for (const c of codes) await up(c); };
    const click = async (sel) => {
      const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
      if (!r) throw new Error('no ' + sel);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 });
    };
    const shot = async (name) => {
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
      writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(result.data, 'base64'));
      console.log(`    shot ${OUT}/${name}.jpg`);
    };
    const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
    const until = async (expr, ms, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(step); } return false; };
    const cityCalls = () => ev(`(() => { const d = window.__dbg; return d.sceneStats.calls + ' draws, ' + Math.round(d.sceneStats.tris / 1000) + 'k tris'; })()`);
    // stand the player at (x, z) facing a heading, on foot, and let the world settle
    const standAt = async (x, z, yaw) => {
      await ev(`(() => { const d = window.__dbg, p = d.player;
        if (!p.onFoot && p.exitVehicle) p.exitVehicle();
        p.respawn(${x}, ${z});
        ${yaw !== undefined ? `p.heading = ${yaw}; p.camYaw = ${yaw} + Math.PI;` : ''}
        d.world.update(${x}, ${z}, 60); })()`);
      await sleep(1500);
    };

    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    if (PHONE) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    if (!(await until('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality)', 200000, 500))) throw new Error('never booted: ' + errs.slice(0, 3).join(' | '));
    console.log('  booted; exceptions so far:', errs.length);
    await sleep(3000);
    await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true);
      for (const id of ['rotate']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      // dismiss the launch screen if it waits for a tap
      const g = document.getElementById('startBtn') || document.getElementById('play'); if (g) g.click(); })()`);
    await sleep(1000);
    mkdirSync(OUT, { recursive: true });

    // ---------------------------------------------------------------- the Rangers at the Aud
    if (ONLY.includes('aud')) {
      console.log('THE AUD');
      const sp = await ev('(() => { const h = window.__dbg.hockey; return [h.door.x, h.door.z]; })()');
      await standAt(sp[0], sp[1]);
      console.log('  outside, the city:', await cityCalls());
      await tap('KeyE');
      check(await until('window.__dbg.hockey.active', 4000), 'ENTER at the Aud opens the game');
      check(await ev('window.__dbg.hockey.view.built'), 'the bowl is built on entry');
      await sleep(1600); await shot('aud-walkin');
      await sleep(2600);
      console.log('  inside:', await ev(`(() => { const v = window.__dbg.hockey.view; return v.lastCalls + ' draws, ' + Math.round(v.lastTris / 1000) + 'k tris, ' + JSON.stringify(window.__aud); })()`));
      await shot('aud-faceoff');
      // play: take the draw, skate up ice with the puck, shoot; then let the sim run fast with the keys still doing the work
      await sleep(900); await tap('KeyJ');
      for (let i = 0; i < 10; i++) {
        await hold([i % 2 ? 'KeyD' : 'ArrowRight', i % 3 ? 'KeyW' : 'KeyS'], 500);
        if (i % 3 === 2) await tap('KeyJ', 120);
        if (i % 4 === 1) await tap('KeyK');
      }
      await shot('aud-play');
      const g0 = await ev('(() => { const g = window.__dbg.hockey.game; return { t: +g.t.toFixed(1), shots: g.shots, score: g.score, state: g.state }; })()');
      console.log('  after 7 s of keys:', JSON.stringify(g0));
      check(g0.t > 3, 'the game clock runs');
      await ev('window.__dbg.hockey.speed = 14');
      let fin = false;
      for (let i = 0; i < 200 && !fin; i++) {
        await hold([['KeyD', 'KeyW'], ['KeyD', 'KeyS'], ['KeyA', 'KeyW'], ['KeyD']][i % 4], 300);
        if (i % 2) await tap('KeyJ', i % 6 === 1 ? 500 : 80);
        fin = await ev("window.__dbg.hockey.mode === 'final'");
        if (i === 30) await shot('aud-midgame');
      }
      check(fin, 'the game reaches its final');
      const res = await ev(`(() => { const h = window.__dbg.hockey, g = h.game; return { result: g.result, score: g.score, shots: g.shots, period: g.period, panel: h.ui.panel.textContent.replace(/\\s+/g, ' ').trim() }; })()`);
      console.log('  final:', JSON.stringify(res));
      await shot('aud-final');
      await click('#hockeyUi .hPanel .back');
      await sleep(800);
      check(!(await ev('window.__dbg.hockey.active')), 'LEAVE THE ARENA closes it');
      check(!(await ev('window.__dbg.hockey.view.built')), 'the bowl is freed on the way out');
      check((await ev('window.__dbg.game.holds.size')) === 0, 'no hold left behind');
      await sleep(1500);
      console.log('  outside again, the city:', await cityCalls());
    }

    // ---------------------------------------------------------------- Oktoberfest: the festhalle
    if (ONLY.includes('fest')) {
      console.log('OKTOBERFEST: A FESTHALLE');
      const ok = await ev('!!window.__dbg.fest');
      check(ok, 'oktoberfest.js is up');
      if (ok) {
        const d = await ev('(() => { const h = window.__dbg.fest.halls[0]; return [h.door.x, h.door.z, h.name]; })()');
        await standAt(d[0], d[1]);
        await tap('KeyE');
        check(await until('window.__dbg.fest.inside', 4000), `ENTER at ${d[2]}'s door goes in`);
        await sleep(2500); await shot('fest-hall');
        console.log('  inside:', await ev(`(() => { const f = window.__dbg.fest; return f.lastCalls + ' draws, ' + Math.round(f.lastTris / 1000) + 'k tris, ' + JSON.stringify(window.__fest); })()`));
        // the stein contest: start it, then hold the stein level with the arrows against the wobble
        check(await until("window.__dbg.fest.mode === 'menu'", 8000), 'walked in down the aisle and up onto the stage');
        await tap('Enter');
        check(await until("window.__dbg.fest.mode === 'hold'", 6000), 'the stein contest starts');
        await sleep(1500); await shot('fest-stein');
        let out = false, t0 = Date.now(), lastHeld = 0;
        while (!out && Date.now() - t0 < 120000) {
          // a player's correction: read the stein and push back (the same keys a player holds)
          const s = await ev('(() => { const c = window.__dbg.fest.contest; return c ? [c.roll, c.arm, c.t, window.__dbg.fest.mode] : null; })()');
          if (!s || s[3] !== 'hold') { out = true; break; }
          lastHeld = s[2];
          const codes = [];
          if (s[0] > 3) codes.push('ArrowLeft'); else if (s[0] < -3) codes.push('ArrowRight');
          if (s[1] < 0.75) codes.push('ArrowUp');
          await hold(codes, 110);
        }
        const r = await ev(`(() => { const f = window.__dbg.fest; return { mode: f.mode, result: f.result, held: f.contest && +f.contest.t.toFixed(1), panel: f.ui.panel.textContent.replace(/\\s+/g, ' ').trim().slice(0, 200) }; })()`);
        console.log('  contest:', JSON.stringify(r));
        check(r.mode === 'result' && r.held > 8, 'the contest ends with a result after holding a while');
        await shot('fest-result');
        await tap('Escape');
        check(await until('!window.__dbg.fest.inside', 3000), 'Escape walks back out');
        check(!(await ev('window.__dbg.fest.built')), 'the hall is freed on the way out');
        check((await ev('window.__dbg.game.holds.size')) === 0, 'no hold left behind');
      }
    }

    // ---------------------------------------------------------------- the Thanksgiving Day parade
    if (ONLY.includes('parade')) {
      console.log('OKTOBERFEST: THE PARADE');
      const s = await ev('(() => { const p = window.__dbg.fest.parade; return [p.start.x, p.start.z, p.route.length]; })()');
      console.log('  route points:', s[2]);
      await standAt(s[0], s[1]);
      console.log('  before, at Weber & Frederick:', await cityCalls());
      await tap('KeyE');
      check(await until('window.__dbg.fest.parade.active', 4000), 'ENTER at the parade marker starts the parade');
      await sleep(4000);
      const cam = await ev(`(() => { const d = window.__dbg, p = d.fest.parade; const v = p.viewFrom(); d.player.respawn(v.x, v.z); d.player.heading = v.h; d.player.camYaw = v.h + Math.PI; return v; })()`);
      void cam;
      await sleep(3500);
      await shot('parade-street');
      // and from a second-storey window over the kerb, looking down Weber at the column
      await ev(`(() => { const d = window.__dbg, p = d.fest.parade, h = p.at(p.head - 34), a = p.at(p.head + 16);
        const lx = Math.cos(a.h), lz = -Math.sin(a.h), cx = a.x + lx * 2.5, cz = a.z + lz * 2.5;
        d.game.paused = true; d.camera.position.set(cx, d.city.groundAt(cx, cz, null) + 6.5, cz);
        d.camera.lookAt(h.x, d.city.groundAt(h.x, h.z, null) + 1.5, h.z); d.camera.updateMatrixWorld(true); })()`);
      await sleep(2500);
      await shot('parade-column');
      await ev('window.__dbg.game.paused = false');
      console.log('  parade on:', await cityCalls(), JSON.stringify(await ev('window.__dbg.fest.parade.stats')));
      await ev('window.__dbg.fest.parade.speedUp = 40');
      check(await until('!window.__dbg.fest.parade.active', 90000, 500), 'the parade finishes its route and goes');
      check(!(await ev('window.__dbg.fest.parade.group')), 'its floats, band and crowd are freed');
      await ev('window.__dbg.fest.parade.speedUp = 1');
      await sleep(1500);
      console.log('  after:', await cityCalls());
    }

    // ---------------------------------------------------------------- Big Splash
    if (ONLY.includes('splash')) {
      console.log('BIG SPLASH');
      const ok = await ev('!!(window.__dbg.splash && window.__dbg.splash.ok)');
      check(ok, 'bigsplash.js is up');
      if (ok) {
        const st = await ev('window.__dbg.splash.stairPlan()');
        await standAt(st.foot.x, st.foot.z, st.legs[0].h);
        console.log('  at the foot:', await cityCalls());
        // walk up: each flight on its own heading, W held, the camera turned to it as a player would
        for (const leg of st.legs) {
          await ev(`(() => { const p = window.__dbg.player; p.camYaw = ${leg.h} + Math.PI; })()`);
          await hold(['KeyW'], leg.ms);
        }
        const top = await ev('(() => { const p = window.__dbg.player, s = window.__dbg.splash; return { y: +p.position.y.toFixed(2), top: +s.topY.toFixed(2), on: s.onTop(p) }; })()');
        console.log('  climbed:', JSON.stringify(top));
        if (!top.on) { await ev('(() => { const s = window.__dbg.splash, p = window.__dbg.player; p.respawn(s.tower.x, s.tower.z); })()'); await sleep(800); console.log('  (placed on the platform to go on)'); }
        check(top.on, 'walked up the stairs to the top platform');
        await shot('splash-top');
        await tap('KeyE');
        check(await until('window.__dbg.splash.riding', 3000), 'ENTER at the top sets off down a slide');
        await sleep(1800); await shot('splash-ride');
        const mid = await ev('(() => { const s = window.__dbg.splash; return { v: +s.ride.v.toFixed(1), s: +s.ride.s.toFixed(1), L: +s.ride.L.toFixed(1), bank: +s.ride.bank.toFixed(2) }; })()');
        console.log('  mid-ride:', JSON.stringify(mid));
        check(mid.v > 3, 'sliding at speed');
        check(await until('window.__dbg.splash.ride && window.__dbg.splash.ride.phase === "splash"', 30000, 100), 'splashes into the pool');
        await sleep(300); await shot('splash-splash');
        check(await until('!window.__dbg.splash.riding', 8000), 'out of the pool on foot');
        const end = await ev('(() => { const s = window.__dbg.splash; return { best: s.best, last: s.last }; })()');
        console.log('  run:', JSON.stringify(end));
        check((await ev('window.__dbg.game.holds.size')) === 0, 'no hold left behind');
      }
    }
    console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 6).join('\n    ') : ''}`);
    if (errs.length) fails++;
    console.log(fails ? `FAILED ${fails}` : 'ALL OK');
    process.exitCode = fails ? 1 : 0;
  } finally {
    chrome.kill('SIGKILL');
  }
}
main().catch((e) => { console.error('funprobe failed:', e.message); process.exitCode = 1; });
