// Auto KW: the KW fun things, played end to end through real input (CDP key
// and mouse events, as a thumb or keyboard would): the Rangers at the Aud
// (audrink.js + hockey.js), a festhalle's stein-holding contest and the
// Thanksgiving Day parade (oktoberfest.js), Big Splash's slide
// (bigsplash.js: walk up the tower, ride, splash), skating on Waterloo Public
// Square's rink (skating.js: lace up, stride, glide, hockey stop, spin, the
// boards, the skaters) and the Panthers' home run derby at Jack Couch Park
// (ballpark.js: ENTER at the gate, ten pitches swung at by the timing) and
// the drive-throughs (drivethru.js: the lunch line in a lane, its bumper,
// ordering at a window, a Tims window's Roll Up the Rim, the morning line).
//
//   node tools/kw/funprobe.mjs <outdir> [aud,fest,parade,splash,skate,derby,dthru]
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
const ONLY = process.argv[3] ? process.argv[3].split(',') : ['aud', 'fest', 'parade', 'splash', 'skate', 'derby', 'dthru'];
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
    // FUN_THROTTLE=4: the CPU slowed, to prove the checks hold on a loaded machine
    if (process.env.FUN_THROTTLE) await send('Emulation.setCPUThrottlingRate', { rate: +process.env.FUN_THROTTLE });
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
        // the tower and its stairs, from the slides' side (a posed camera)
        await ev(`(() => { const d = window.__dbg, s = d.splash, T = s.tower, a = s.D.down + 0.9;
          d.game.paused = true; d.camera.position.set(T.x + Math.cos(a) * 26, T.top + 1, T.z + Math.sin(a) * 26);
          d.camera.lookAt(T.x, T.top - 5, T.z); d.camera.updateMatrixWorld(true); })()`);
        await sleep(2500); await shot('splash-tower');
        await ev('window.__dbg.game.paused = false');
        await standAt(st.foot.x, st.foot.z, st.legs[0].h);
        // walk up: toward each waypoint (landings, the deck) with W held, the camera turned to it as a
        // player would; closed loop -- each leg re-aims from where you actually are
        // Closed loop on the player's real position, not on time: W is held, the camera re-aimed at the
        // waypoint every poll, and W let go on arrival (or when the distance starts to grow). A held key
        // covers as much ground as the frame rate allows, so a loaded or throttled machine walks slower,
        // and timing the hold from 5 m/s (the first version) stopped short of the landings there.
        const aim = (wx, wz) => ev(`(() => { const p = window.__dbg.player, dx = ${wx} - p.x, dz = ${wz} - p.z;
          p.camYaw = Math.atan2(dx, dz) + Math.PI; return [Math.hypot(dx, dz), +p.y.toFixed(2)]; })()`);
        for (const [wx, wz] of st.pts) {
          for (let k = 0; k < 4; k++) {
            let r = await aim(wx, wz);
            if (process.env.FUN_TRACE) console.log('    leg to', Math.round(wx), Math.round(wz), 'dist', r[0].toFixed(2), 'y', r[1]);
            if (r[0] < 0.45) break;
            let best = r[0];
            await down('KeyW');
            const t0 = Date.now();
            while (Date.now() - t0 < 20000) {
              await sleep(30);
              r = await aim(wx, wz);
              if (r[0] < 0.45 || r[0] > best + 0.3) break;
              best = Math.min(best, r[0]);
            }
            await up('KeyW');
            await sleep(300);
          }
        }
        const top = await ev('(() => { const p = window.__dbg.player, s = window.__dbg.splash; return { y: +p.position.y.toFixed(2), top: +s.topY.toFixed(2), on: s.onTop(p) }; })()');
        console.log('  climbed:', JSON.stringify(top));
        if (!top.on) { await ev('(() => { const s = window.__dbg.splash, p = window.__dbg.player; p.respawn(s.tower.x, s.tower.z); })()'); await sleep(800); console.log('  (placed on the platform to go on)'); }
        check(top.on, 'walked up the stairs to the top platform');
        await shot('splash-top');
        // turn to face the green slide's mouth, as a player would before ENTER (W held until faced)
        const g = await ev('(() => { const s = window.__dbg.splash, p = s.paths.find((q) => q.sl.name === "green") || s.paths[0]; return p.F[0].p; })()');
        await down('KeyW');
        for (let i = 0; i < 40; i++) {
          const dh = await ev(`(() => { const p = window.__dbg.player, h = Math.atan2(${g[0]} - p.x, ${g[2]} - p.z); p.camYaw = h + Math.PI;
            return Math.abs(Math.atan2(Math.sin(h - p.heading), Math.cos(h - p.heading))); })()`);
          if (dh < 0.15) break;
          await sleep(25);
        }
        await up('KeyW');
        await sleep(400);
        await tap('KeyE');
        check(await until('window.__dbg.splash.riding', 3000), 'ENTER at the top sets off down a slide');
        // by distance down the flume, not wall-clock: a slow frame rate slides in slow motion
        await until('window.__dbg.splash.ride && window.__dbg.splash.ride.s > 9', 60000, 50);
        await shot('splash-ride');
        const mid = await ev('(() => { const s = window.__dbg.splash; return { v: +s.ride.v.toFixed(1), s: +s.ride.s.toFixed(1), L: +s.ride.pa.L.toFixed(1), slide: s.ride.pa.sl.name, bank: +s.ride.bank.toFixed(2) }; })()');
        console.log('  mid-ride:', JSON.stringify(mid));
        check(mid.v > 3, 'sliding at speed');
        check(await until('window.__dbg.splash.ride && window.__dbg.splash.ride.phase === "splash"', 120000, 100), 'splashes into the pool');
        await sleep(300); await shot('splash-splash');
        check(await until('!window.__dbg.splash.riding', 30000), 'out of the pool on foot');
        const end = await ev('(() => { const s = window.__dbg.splash; return { best: s.best, last: s.last, splash: s.lastSplash }; })()');
        console.log('  run:', JSON.stringify(end));
        check((await ev('window.__dbg.game.holds.size')) === 0, 'no hold left behind');
      }
    }
    // ---------------------------------------------------------------- skating at Waterloo Public Square
    if (ONLY.includes('skate')) {
      console.log('SKATING');
      const ok = await ev('!!window.__dbg.skating');
      check(ok, 'skating.js is up');
      if (ok) {
        const R = await ev('(() => { const R = window.__dbg.skating.R; return { c: R.c, u: R.u, hl: R.hl, hw: R.hw, y: R.y }; })()');
        const at = (u, v) => [R.c[0] + R.u[0] * u - R.u[1] * v, R.c[1] + R.u[1] * u + R.u[0] * v];
        const yawU = Math.atan2(R.u[0], R.u[1]);
        // the square from the north, with the skaters out (a posed camera)
        const [sx, sz] = at(-11, 0);
        await standAt(sx, sz, yawU);
        check(await until('window.__dbg.skating.skaters.length >= 3', 20000), 'skaters come out onto the ice');
        const sk0 = await ev(`(() => { const s = window.__dbg.skating; return s.skaters.map((q) => [q.p.x, q.p.z, q.p.y, s.onIce(q.p.x, q.p.z)]); })()`);
        await sleep(2000);
        const sk1 = await ev(`(() => { const s = window.__dbg.skating; return s.skaters.map((q) => [q.p.x, q.p.z, q.p.y, s.onIce(q.p.x, q.p.z)]); })()`);
        const moved = sk1.filter((q, i) => sk0[i] && Math.hypot(q[0] - sk0[i][0], q[1] - sk0[i][1]) > 0.5).length;
        console.log('  skaters:', sk1.length, 'on the ice:', sk1.filter((q) => q[3]).length, 'moving:', moved, 'peds:', await ev('window.__dbg.peds.peds.length'));
        check(sk1.every((q) => q[3]) && moved >= Math.min(3, sk1.length), 'every skater is on the ice, skating');
        await ev(`(() => { const d = window.__dbg, c = d.camera; d.game.paused = true;
          const [x, z] = [${at(4, 21).join(',')}]; c.position.set(x, ${R.y} + 5.5, z); c.lookAt(${R.c[0]}, ${R.y}, ${R.c[1]}); c.updateMatrixWorld(true); })()`);
        await sleep(2500); await shot('skate-rink');
        console.log('  the square with skaters:', await cityCalls());
        await ev('window.__dbg.game.paused = false');
        await standAt(sx, sz, yawU);
        check(await ev(`window.__dbg.skating.onIce(window.__dbg.player.x, window.__dbg.player.z, window.__dbg.player.y)`), 'standing on the ice');
        await tap('KeyE');
        check(await until('window.__dbg.skating.skating', 3000), 'ENTER on the ice laces up');
        // stride down the rink: W held, the camera behind, until going well or near the far end
        const st = () => ev(`(() => { const s = window.__dbg.skating, p = window.__dbg.player, m = s.me; if (!m) return null;
          const [u, v] = s._uv(p.x, p.z); return { v: +Math.hypot(m.vx, m.vz).toFixed(2), u: +u.toFixed(1), w: +v.toFixed(1), hd: +m.hd.toFixed(2), spin: m.spin, y: +p.y.toFixed(2), d: +s._sdf(u, v).d.toFixed(2) }; })()`);
        await ev(`window.__dbg.player.camYaw = ${yawU} + Math.PI`);
        await down('KeyW');
        let s1 = null;
        for (let i = 0; i < 400; i++) { await sleep(30); s1 = await st(); if (!s1 || s1.v > 4.5 || s1.u > 6) break; }
        await shot('skate-stride');
        await up('KeyW');
        console.log('  striding:', JSON.stringify(s1));
        check(s1 && s1.v > 3, 'striding gets you going (> 3 m/s)');
        // glide: no input; the speed holds (ice), measured over distance not time
        const g0 = await st();
        let g1 = g0;
        for (let i = 0; i < 200; i++) { await sleep(30); g1 = await st(); if (Math.hypot(g1.u - g0.u, g1.w - g0.w) > 3 || g1.d > -0.6) break; }
        console.log('  glide:', JSON.stringify(g0), '->', JSON.stringify(g1));
        check(g1.v > g0.v * 0.85, 'gliding 3 m keeps the speed (blades on ice)');
        // the hockey stop: J held until stopped
        const a0 = await st();
        await down('KeyJ');
        let a1 = a0, sprayShot = false;
        for (let i = 0; i < 200; i++) { await sleep(30); a1 = await st(); if (!sprayShot && a1.v < a0.v * 0.6) { await shot('skate-stop'); sprayShot = true; } if (a1.v < 0.2) break; }
        await up('KeyJ');
        const stopM = Math.hypot(a1.u - a0.u, a1.w - a0.w);
        console.log('  hockey stop from', a0.v, 'm/s in', stopM.toFixed(2), 'm');
        check(a1.v < 0.3 && stopM < 4, 'PUNCH is a hockey stop: stopped in under 4 m');
        // a spin from standing
        await tap('Space');
        check(await until('window.__dbg.skating.me && window.__dbg.skating.me.spin > 0', 2000, 50), 'JUMP spins');
        await until('window.__dbg.skating.me.spinA > 6', 8000, 50);
        await shot('skate-spin');
        check(await until('window.__dbg.skating.me && window.__dbg.skating.me.spin === 0', 15000), 'the spin winds down');
        console.log('  spin:', JSON.stringify(await ev('({ best: window.__dbg.skating.best, stats: window.__dbg.skating.stats })')));
        check((await ev('window.__dbg.skating.best.spin')) > 1.5, 'more than one and a half turns');
        // into the boards: W across the rink at the side curb until it bounces
        await ev(`window.__dbg.player.camYaw = ${yawU} + Math.PI / 2 + Math.PI`);
        const b0 = await ev('window.__dbg.skating.stats.bounces');
        await down('KeyW');
        let worst = -9;
        for (let i = 0; i < 300; i++) { await sleep(30); const q = await st(); worst = Math.max(worst, q.d); if ((await ev('window.__dbg.skating.stats.bounces')) > b0 && i > 20) break; }
        await up('KeyW');
        console.log('  the boards: deepest', worst.toFixed(2), 'm past the curb line; bounces', (await ev('window.__dbg.skating.stats.bounces')) - b0);
        check(worst < -0.2, 'the curb keeps you on the ice');
        // skates off
        await tap('KeyE');
        check(await until('!window.__dbg.skating.skating && !window.__dbg.player.skate', 3000), 'ENTER takes the skates off');
        const w0 = await ev('[window.__dbg.player.x, window.__dbg.player.z]');
        await hold(['KeyW'], 900);
        const w1 = await ev('[window.__dbg.player.x, window.__dbg.player.z, window.__dbg.player.speed]');
        check(Math.hypot(w1[0] - w0[0], w1[1] - w0[1]) > 0.3, 'walking again afterwards');
        // gone far: the skaters are handed back to the crowd
        await standAt(R.c[0] + 400, R.c[1], yawU);
        check(await until('window.__dbg.skating.skaters.length === 0', 8000), 'the skaters are given back when you leave');
        check((await ev('window.__dbg.game.holds.size')) === 0, 'no hold left behind');
      }
    }

    // ---------------------------------------------------------------- the Panthers' home run derby at Jack Couch Park
    if (ONLY.includes('derby')) {
      console.log('JACK COUCH PARK: THE HOME RUN DERBY');
      const ok = await ev('!!window.__dbg.derby');
      check(ok, 'ballpark.js is up');
      if (ok) {
        const park = await ev('(() => { const d = window.__dbg.derby; return { gate: d.gate, home: [d.F.W(0, 0)[0], d.F.W(0, 0)[1]], d: d.F.d, p: d.F.p, stats: window.__ballpark }; })()');
        console.log('  park:', JSON.stringify(park.stats));
        check(park.stats && park.stats.lights >= 4 && park.stats.ft && park.stats.ft.length === 3, 'the park is drawn (fence, lights, distances)');
        // the park: from the stands behind the plate, and from the air over centre field (posed cameras)
        const pose = async (name, c, t) => {
          await ev(`(() => { const d = window.__dbg, G = d.G, cam = d.camera; d.game.paused = true;
            d.world.update(${c[0]}, ${c[1]}, 60); for (let i = 0; i < 400; i++) d.world.update(${c[0]}, ${c[1]}, 60);
            cam.fov = 60; cam.updateProjectionMatrix();
            cam.position.set(${c[0]}, G.terrainHeight(${c[0]}, ${c[1]}) + ${c[2]}, ${c[1]}); cam.lookAt(${t[0]}, G.terrainHeight(${t[0]}, ${t[1]}) + ${t[2]}, ${t[1]}); cam.updateMatrixWorld(true); })()`);
          await sleep(3500); await shot(name);
          console.log(`  ${name}:`, await cityCalls());
        };
        const H = park.home, D = park.d, P = park.p;
        const at = (al, ac) => [H[0] + D[0] * al + P[0] * ac, H[1] + D[1] * al + P[1] * ac];
        await standAt(park.gate[0], park.gate[1]);
        await pose('derby-park-stands', [...at(-14, 16), 5.5], [...at(70, -8), 2]);
        await pose('derby-park-air', [...at(165, 30), 70], [...at(45, 0), 0]);
        await pose('derby-park-outfield', [...at(92, 8), 1.7], [...at(-5, 0), 4]);
        await ev('window.__dbg.game.paused = false');
        await standAt(park.gate[0], park.gate[1]);
        console.log('  at the gate:', await cityCalls());
        await tap('KeyE');
        check(await until('window.__dbg.derby.active && !!window.__dbg.derby.g', 4000), 'ENTER at the gate starts the derby (built on entry)');
        check(await ev('window.__dbg.game.holds.has("derby")'), 'the world is held');
        await sleep(1800); await shot('derby-intro');
        // twelve swings: watch each pitch and SWING (Space) by the ball's own clock -- the first is taken, the second swung early
        const t0 = Date.now();
        let pitches = 0, shotPitch = false, shotFly = false, shotHr = false;
        while (Date.now() - t0 < 300000) {
          const st = await ev("window.__dbg.derby.state");
          if (st === 'card' || st === 'off') break;
          if (st !== 'pitch') {
            if (st === 'windup' && !shotPitch && pitches === 2) { await sleep(500); await shot('derby-windup'); shotPitch = true; }
            if (st === 'fly' && !shotFly) { await sleep(250); await shot('derby-flight'); shotFly = true; }
            if (st === 'fly' && !shotHr && (await ev('!!(window.__dbg.derby.fly && window.__dbg.derby.fly.hr)'))) { await sleep(400); await shot('derby-homerun'); shotHr = true; }
            await sleep(30); continue;
          }
          const n = await ev('window.__dbg.derby.pitchN');
          if (n === pitches) { await sleep(10); continue; }
          pitches = n;
          if (n === 1) { console.log('  pitch 1: taken'); await until("window.__dbg.derby.state !== 'pitch'", 5000, 20); continue; }
          // the lead: SWING_T before the ball reaches the contact plane (less the poll's own latency)
          const lead = n === 2 ? 0.30 : 0.18 + 0.012;
          for (let i = 0; i < 400; i++) {
            const r = await ev('(() => { const d = window.__dbg.derby; return d.state === "pitch" ? d.pb.tc - d.pb.t : -1; })()');
            if (r < 0 || r <= lead) break;
            await sleep(r - lead > 0.06 ? 15 : 2);
          }
          await tap('Space', 40);
          await until("window.__dbg.derby.state !== 'pitch'", 5000, 20);
        }
        const res = await ev('(() => { const d = window.__dbg.derby; return { state: d.state, hr: d.hr, swings: d.swings, long: d.long, paid: d.paid, best: d.best, log: d.log }; })()');
        console.log('  derby:', JSON.stringify({ ...res, log: undefined }));
        for (const l of res.log) console.log('   ', JSON.stringify(l));
        check(res.state === 'card' && res.swings === 12, 'twelve swings and the card');
        check(res.log.some((l) => l.kind === 'TAKE'), 'a pitch taken costs no out');
        check(res.log.filter((l) => l.kind && l.kind !== 'TAKE').length === 12, 'every swing is recorded');
        check(res.hr >= 1 && res.long > 300, 'timed swings hit home runs over the fence');
        check(res.paid === res.hr * 25 + (res.hr >= 5 ? 100 : 0), 'paid by the home runs');
        await sleep(600); await shot('derby-card');
        await click('#derbyUi .card .leave');
        check(await until('!window.__dbg.derby.active', 3000), 'LEAVE ends it');
        check(await ev('!window.__dbg.derby.g && !document.getElementById("derbyUi")'), 'the batter\'s things and the overlay are freed');
        check((await ev('window.__dbg.game.holds.size')) === 0, 'no hold left behind');
        const pl = await ev('(() => { const p = window.__dbg.player; return [p.onFoot, Math.hypot(p.x - window.__dbg.derby.gate[0], p.z - window.__dbg.derby.gate[1])]; })()');
        check(pl[0] && pl[1] < 3, 'back on foot at the gate');
        await sleep(1500);
        console.log('  after, at the gate:', await cityCalls());
      }
    }

    // ---------------------------------------------------------------- the drive-throughs
    if (ONLY.includes('dthru')) {
      console.log('THE DRIVE-THROUGHS');
      const info = await ev(`(() => { const D = window.__dbg.dthru; if (!D) return null;
        const pick = (f) => D.list.find((d) => f(d) && d.sM !== null && d.sW > 30);
        const a = pick((d) => !d.tims && d.k), t = pick((d) => d.tims);
        return { n: D.list.length, tims: D.list.filter((d) => d.tims).length, a: a && a.i, ak: a && a.k, t: t && t.i }; })()`);
      console.log('  lanes:', JSON.stringify(info));
      check(info && info.n > 40 && info.tims > 20, 'OSM drive-through lanes drawn at the pads (Tims among them)');
      if (info && info.a !== null && info.t !== null) {
        // a lane's line at lunch, from the window's side
        const pose = (i, s, hour) => ev(`(() => { const d = window.__dbg, D = d.dthru, L = D.list[${i}];
          D.hour = ${hour}; d.game.paused = false;
          const [x, z, h] = D.at(L, ${s});
          const p = d.player; if (!p.onFoot && p.exitVehicle) p.exitVehicle();
          p.respawn(x, z); d.world.update(x, z, 60);
          const v = d.traffic.spawnAt(x, z, h, 'compsedan', 0x3060a0, 'free');
          p.enterVehicle(v); v.vLong = 0; v.vLat = 0;
          return [x, z, h]; })()`);
        await pose(info.a, 2, 12);
        await sleep(2500);
        const q = await ev(`(() => { const d = window.__dbg, D = d.dthru, L = D.list[${info.a}];
          const mine = d.traffic.decor.filter((c) => c.lane === L);
          return { you: L.you, n: mine.length, ahead: mine.filter((c) => D.project(L, c.x, c.z, 4) && D.project(L, c.x, c.z, 4).s > L.you).length }; })()`);
        console.log('  in the lane at lunch:', JSON.stringify(q));
        check(q.you !== null && q.n >= 2 && q.ahead === q.n, 'a line ahead of you in the lane at lunch, nobody behind');
        await shot('dthru-line');
        // drive into the back of the line: held off its bumper. Posed with the world held (the line
        // creeps away from you in real time): nose 0.5 m into the last car's tail at 6 m/s, one update
        const bump = await ev(`(() => { const d = window.__dbg, D = d.dthru, L = D.list[${info.a}], v = d.player.vehicle;
          d.game.paused = true;
          D.update(0, v.x, v.z, d.player);
          const mine = d.traffic.decor.filter((c) => c.lane === L).map((c) => ({ c, s: D.project(L, c.x, c.z, 4).s })).sort((a, b) => a.s - b.s);
          const back = mine[0], type = back.c.type, need = v.halfLen + D.half[type][0];
          const [x, z, h] = D.at(L, back.s - (need - 0.5));
          v.x = x; v.z = z; v.heading = h; v.vLong = 6; v.vLat = 0;
          D.update(0, v.x, v.z, d.player);
          // (the line's car objects are a pool, reused update to update: the nearest one now)
          let dd = Infinity;
          for (const c of d.traffic.decor) { const e = Math.hypot(v.x - c.x, v.z - c.z); if (c.lane === L && e < dd) dd = e; }
          d.game.paused = false;
          return { gap: +dd.toFixed(2), vLong: +v.vLong.toFixed(2), need: +need.toFixed(2) }; })()`);
        console.log('  into the car ahead:', JSON.stringify(bump));
        check(bump.gap >= bump.need - 0.35 && bump.vLong < 3, 'the car ahead is solid: stopped against its bumper');
        // at the window with no line (3 am): ENTER orders, ENTER again gets out
        await pose(info.a, (await ev(`window.__dbg.dthru.list[${info.a}].sW`)), 3);
        await ev(`(() => { const d = window.__dbg; d.game.money = 50; d.player.health = 60; })()`);
        await sleep(800);
        await tap('KeyE');
        await sleep(600);
        const o = await ev(`(() => { const d = window.__dbg; return { money: d.game.money, health: d.player.health, onFoot: d.player.onFoot, last: d.dthru.last, served: d.dthru.served }; })()`);
        console.log('  ordered:', JSON.stringify(o));
        check(o.served === 1 && !o.onFoot && o.last && o.money === 50 - o.last.price && o.health === 60 + o.last.health, `ENTER at the ${info.ak} window buys ${o.last && o.last.item} and heals`);
        await shot('dthru-window');
        await tap('KeyE');
        check(await until('window.__dbg.player.onFoot', 3000), 'ENTER again at the window gets you out');
        // a Tims window: Roll Up the Rim's drive-thru
        await pose(info.t, (await ev(`window.__dbg.dthru.list[${info.t}].sW`)), 8);
        await sleep(800);
        await tap('KeyE');
        check(await until('window.__dbg.rollup.active && window.__dbg.rollup.drive', 4000), "ENTER at a Tims window opens Roll Up the Rim's drive-thru");
        await sleep(800); await shot('dthru-tims');
        await click('#rollupUi .ruX');
        check(await until('!window.__dbg.rollup.active', 3000), 'leaving the counter closes it');
        await sleep(300);
        check((await ev('window.__dbg.game.holds.size')) === 0, 'no hold left behind');
        // the morning line at the Tims, from the air
        await ev(`(() => { const d = window.__dbg, p = d.player; if (!p.onFoot) p.exitVehicle(); })()`);
        const mq = await ev(`(() => { const d = window.__dbg, D = d.dthru, L = D.list[${info.t}]; D.hour = 8; D.update(0.016, L.x, L.z, null);
          return d.traffic.decor.filter((c) => c.lane === L).length; })()`);
        console.log('  the Tims line at 8 am:', mq);
        check(mq >= 3, 'a morning line at the Tims');
        await ev('window.__dbg.dthru.hour = null');
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
