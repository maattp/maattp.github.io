// KW Stories (apps/autokw/src/story.js), end to end.
//
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 node tools/kw/storyprobe.mjs <shotdir> [pass,fail,cost]
//
// Boots Auto KW (service worker bypassed), pauses the main loop and steps the
// world itself at a fixed dt with an autopilot on the player's own car
// (tools/kw/storyprobe-page.js says what is stepped, how the autopilot drives
// and which teleports it makes and why). Then:
//   pass  -- the trigger: a taxi shift on refuses it, then driving into Gord's
//            beam and stopping starts chapter 1's intro cutscene (the world
//            held: 'story'), a tap on the card moves it on, the hold goes;
//            every chapter's success path in order (pay, the save, the next
//            chapter unlocked, the jobs refusing to start meanwhile), the
//            finale's held party and the float parked at the garage; a
//            screenshot at each chapter's key moment.
//   fail  -- one fail path per mechanic: the coffee goes cold (timer), the van
//            gets away (pursuit), Chad is lost and Chad spots you (tail), the
//            float falls apart driven too fast (cargo destroyed), BUSTED with
//            the card (the police's own arrest), Kayla wins (race), the limo
//            makes YKF (finale); each shows RETRY, and RETRY + quit is checked.
//   cost  -- story.update's time a frame with no chapter running, and the
//            draws its garage meshes add (A/B, paused, same view).
// After every chapter and every fail: no hold, no leak, no story car left in
// traffic, no route or marker or panel left up. Exits 1 on any failure or
// page exception; prints PASS.
import { launchChrome, assertRenderer } from '../chrome.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const OUT = process.argv[2] || 'tools/data/kw/storyshots';
const ONLY = (process.argv[3] || 'pass,fail,cost').split(',');
const CH_ONLY = process.env.STORY_CH ? process.env.STORY_CH.split(',').map(Number) : null;   // chapters (1-7) to play in `pass`; FAILS likewise
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9518;
mkdirSync(OUT, { recursive: true });
const PAGE = readFileSync(new URL('./storyprobe-page.js', import.meta.url), 'utf8');

const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-story-${PORT}`, width: 1100, height: 620 });
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failures++; };
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map(); const exceptions = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails || r.result?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails || r.result.exceptionDetails).slice(0, 1500));
    return r.result?.result?.value;
  };
  const J = async (e) => JSON.parse(await ev(e));
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__noAutoQuality = true; try { localStorage.removeItem('autokw-story'); } catch (e) {}" });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
  for (let i = 0; i < 900; i++) { await sleep(500); try { if (await ev('!!(window.__dbg && window.__dbg.story && window.__dbg.applyQuality)')) break; } catch { /* booting */ } }
  await assertRenderer(ev);
  await sleep(2500);
  await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true); d.game.paused = true;
    for (const id of ['rotate']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } return 1; })()`);
  console.log(await ev(PAGE));
  await ev('window.__dbg.story.save = { done: [], best: {}, n: 0 }; 1');

  const shot = async (name) => {
    await ev('(() => { const d = window.__dbg; d.player.applyCamera ? 0 : 0; return 1; })()');
    await sleep(1600);
    const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(s.result.data, 'base64'));
    console.log(`  shot ${OUT}/${name}.jpg`);
  };
  const leaks = async (what) => {
    const L = await J('JSON.stringify(window.__sp.leaks())');
    ok(!L.bad.length, `${what}: nothing left behind${L.bad.length ? ' -- ' + L.bad.join('; ') : ''} (story meshes in the scene: ${L.storyMeshes.join(',') || 'none'})`);
  };
  /** Step the world until the chapter is over (or `until` says stop); takes the shots `want` asks for. */
  const play = async (label, { until = null, maxT = 1500, shots = {} } = {}) => {
    const taken = new Set();
    let last = null, t0 = null;
    for (let n = 0; n < 4000; n++) {
      const o = await J('window.__sp.tick(240)');
      last = o;
      if (t0 === null) t0 = o.t;
      if (o.held && o.held.length) {
        if (o.held.includes('respray')) { await sleep(1000); continue; }   // the main loop plays it, in real time
        if (o.held.includes('story')) return o;                            // a cutscene: the caller's
      }
      for (const [nm, cond] of Object.entries(shots)) {
        if (taken.has(nm)) continue;
        if (await ev(`(() => { const d = window.__dbg, S = d.story, st = S.run && S.run.st, p = d.player.position; return !!(${cond}); })()`)) { taken.add(nm); await shot(nm); }
      }
      if (until && await ev(`(() => { const d = window.__dbg, S = d.story, st = S.run && S.run.st; return !!(${until}); })()`)) return o;
      if (!o.run && !o.held) return o;
      if (o.t - t0 > maxT) { ok(false, `${label}: still running after ${Math.round(o.t - t0)} s (${o.run}, ${o.led})`); await ev('window.__dbg.story.quit(); 1'); return o; }
    }
    return last;
  };

  const pays = await J('JSON.stringify(window.__dbg.story.chapters.map((c) => [c.id, c.pay]))');

  if (ONLY.includes('pass')) {
    console.log('== the trigger');
    // a taxi shift on: Gord says no
    let r = await J(`(() => { const d = window.__dbg, SP = window.__sp, S = d.story;
      const p0 = d.city.respawnPointNear(-1600, -4215, 80); SP.give(p0.x, p0.z, Math.atan2(-1613 - p0.x, -4199 - p0.z));
      d.taxi.on = true;
      SP.ap = { mode: 'line', L: SP.route(-1613, -4199), stop: true, top: 9 };
      SP.traceOn = true; SP.trace = [];
      let p = d.player.position;
      for (let i = 0; i < 6000 && !S.run; i++) { SP.world(SP.dt); p = d.player.position; if (i > 600 && Math.hypot(p.x + 1613, p.z + 4199) < 6 && Math.abs(d.player.vehicle.vLong) < 0.5) break; }
      SP.traceOn = false;
      const out = { started: !!S.run, d: Math.hypot(p.x + 1613, p.z + 4199), toast: document.getElementById('toast').textContent, from: [Math.round(p0.x), Math.round(p0.z)], len: Math.round(SP.ap.L.len), trace: SP.trace.slice(-6) };
      d.taxi.on = false; S._hinted = false;
      return JSON.stringify(out); })()`);
    ok(!r.started && r.d < 7.5, `on a taxi shift, stopped in the beam (${r.d.toFixed(1)} m): no chapter -- "${r.toast}"`);
    if (r.d >= 7.5) console.log('    ' + JSON.stringify(r));
    r = await J(`(() => { const d = window.__dbg, SP = window.__sp, S = d.story;
      for (let i = 0; i < 120 && !S.run; i++) SP.world(SP.dt);
      return JSON.stringify({ started: !!S.run, held: [...d.game.holds], cut: !!S.cut, id: S.run && S.run.ch.id, story: d.game.story }); })()`);
    ok(r.started && r.cut && r.held.includes('story') && r.id === 'coffee' && r.story === 'coffee', `shift off: chapter 1 starts, intro cutscene, world held ('story') -- ${JSON.stringify(r)}`);
    await shot('story-intro');
    if (!r.cut) throw new Error('no cutscene: stopping');
    const l0 = await ev('window.__dbg.story.cut.i');
    await sleep(400);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 550, y: 300, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 550, y: 300, button: 'left', clickCount: 1 });
    await sleep(300);
    const l1 = await ev('window.__dbg.story.cut ? window.__dbg.story.cut.i : 99');
    ok(l1 > l0, `a tap moves the cutscene on (line ${l0} -> ${l1})`);
    r = await J(`(() => { const d = window.__dbg, S = d.story; S.skipCut(); return JSON.stringify({ held: [...d.game.holds], cut: !!S.cut, k: S.run.k, kind: S.run.st && S.run.st.kind }); })()`);
    ok(!r.held.length && !r.cut && r.kind === 'go', `the cutscene ends: the hold is released, step 1 runs -- ${JSON.stringify(r)}`);
    // the jobs refuse to start meanwhile
    r = await J(`(() => { const d = window.__dbg; const a = d.acts.list[0]; const was = d.missions.run; d.missions.toggle({ vehicle: { spec: { police: true } }, onFoot: false });
      return JSON.stringify({ act: d.acts.canStart(a, 'car'), police: !!d.missions.run || was, busy: d.events.o.busy() }); })()`);
    ok(!r.act && !r.police && r.busy, `during a chapter: an activity cannot start, a police mission refuses, random events stand down -- ${JSON.stringify(r)}`);

    const SHOTS = {
      coffee: { 'story-1-coffee': 'S.run.k === 1 && st.t > 25' },
      goose: { 'story-2-van': "st && st.kind === 'chase' && st.v && Math.hypot(st.v.x - p.x, st.v.z - p.z) < 45" },
      tail: { 'story-3-subtitle': "st && st.kind === 'tail' && S.line && S.line.l[0] === 'priya' && st.v", 'story-3-tail': "st && st.kind === 'tail' && st.v && st.t > 45" },
      float: { 'story-4-float': "st && st.kind === 'parade' && st.cp >= 2" },
      card: { 'story-5-wanted': "st && st.kind === 'heat' && st.t > 0.6", 'story-5-respray': "st && st.kind === 'respray' && st.t > 2" },
      race: { 'story-6-race': "st && st.kind === 'race' && st.go && st.t > 22" },
      prost: { 'story-7-limo': "st && st.kind === 'flee' && st.v && Math.hypot(st.v.x - p.x, st.v.z - p.z) < 30 && st.t > 8" },
    };
    for (let i = 0; i < pays.length; i++) {
      const [cid, pay] = pays[i];
      // STORY_CH=5,6 plays only those (the rest are marked done, so the next one is right)
      if (CH_ONLY && !CH_ONLY.includes(i + 1)) { await ev(`(() => { const S = window.__dbg.story; if (S.run) S.quit(); if (!S.save.done.includes('${cid}')) S.save.done.push('${cid}'); S.persist(); return 1; })()`); continue; }
      console.log(`== chapter ${i + 1}: ${cid}`);
      // A chapter is a game with traffic and police in it: an attempt the autopilot
      // loses (WASTED in a crash, say) is reported and the chapter played again, up to 3.
      let passed = false;
      for (let attempt = 1; attempt <= 3 && !passed; attempt++) {
        if (i > 0 || attempt > 1) {
          const s = await ev(`(() => { const d = window.__dbg, S = d.story; window.__sp.cleanSlate(); window.__sp.log.length = 0;
            if (!d.player.vehicle) { const p = d.player.position, r = d.city.respawnPointNear(p.x, p.z, 200); window.__sp.give(r.x, r.z, 0); }
            return S.next + ':' + window.__sp.start(${i}); })()`);
          ok(s === `${i}:true`, `chapter ${i + 1} is the next one and starts (${s})${attempt > 1 ? ', attempt ' + attempt : ''}`);
        }
        const m0 = await ev('window.__dbg.game.money');
        let o = await play(cid, { shots: SHOTS[cid] || {} });
        if (o.held && o.held.includes('story')) {
          await shot('story-7-party');
          await ev('window.__dbg.story.skipCut(); 1');
          o = await play(cid);
        }
        const r2 = await J(`JSON.stringify({ log: window.__dbg.story.log.slice(-2), done: window.__dbg.story.save.done, money: window.__dbg.game.money, sp: window.__sp.log, cleared: window.__sp.cleared })`);
        for (const l of r2.sp) console.log('    ' + l);
        passed = r2.log[r2.log.length - 1].startsWith(`pass ${cid}`);
        if (!passed && attempt < 3) { console.log(`  (attempt ${attempt} lost: ${r2.log[r2.log.length - 1]} -- again)`); await leaks(`chapter ${i + 1} attempt ${attempt}`); continue; }
        ok(passed, `chapter ${i + 1} passed${attempt > 1 ? ' on attempt ' + attempt : ''} -- ${r2.log.join(' / ')} (traffic cleared from the autopilot's lane: ${r2.cleared})`);
        ok(r2.done.includes(cid), `saved as done (${r2.done.join(',')})`);
        ok(r2.money - m0 >= pay, `paid ${r2.money - m0} (>= ${pay})`);
        await leaks(`chapter ${i + 1}`);
      }
    }
    // the prize, and the save as the menu reads it
    let r3 = await J(`(() => { const d = window.__dbg, S = d.story, SP = window.__sp; const g = d.city.respawnPointNear(-1600, -4215, 80);
      d.player.vehicle.place(g.x, g.z, 0); for (let i = 0; i < 90; i++) SP.world(SP.dt);
      return JSON.stringify({ complete: S.complete, prize: !!(S.prize && d.traffic.cars.includes(S.prize) && S.prize.isFloat), rows: S.rows().map((r) => r.state).join(','), saved: JSON.parse(localStorage.getItem('autokw-story')).done.length }); })()`);
    ok(r3.complete && r3.prize && r3.saved === 7, `the story is complete, saved (7), the float is parked at the garage -- ${JSON.stringify(r3)}`);
    if (r3.prize) {
      await ev(`(() => { const d = window.__dbg, v = window.__dbg.story.prize, c = d.camera; c.position.set(v.x + 9, v.y + 4.5, v.z - 7); c.lookAt(v.x, v.y + 1.4, v.z); return 1; })()`);
      await shot('story-prize');
    }
    // the menu: rows, REPLAY
    await ev(`(() => { window.__dbg.game.paused = false; document.getElementById('pauseBtn').click(); return 1; })()`);   // (the button toggles: the probe holds the game paused without the menu)
    await sleep(500);
    const menu = await J(`JSON.stringify({ rows: [...document.querySelectorAll('#storyList .storyRow')].map((r) => r.textContent), count: document.getElementById('storyCount').textContent })`);
    ok(menu.rows.length === 7 && menu.count === `${r3.saved}/7` && menu.rows.filter((t) => /REPLAY/.test(t)).length === r3.saved, `pause menu: KW STORIES 7/7, a REPLAY a chapter -- ${menu.rows[0]}`);
    await ev(`(() => { const el = document.getElementById('storyBox'); el.scrollIntoView(); return 1; })()`);
    await shot('story-menu');
    r3 = await J(`(() => { const d = window.__dbg, S = d.story; document.querySelector('#storyList [data-replay="2"]').click(); const o = { run: S.run && S.run.ch.id, cut: !!S.cut, paused: d.game.paused };
      S.skipCut(); S.quit(); d.game.paused = true; return JSON.stringify(o); })()`);
    ok(r3.run === 'tail' && r3.cut, `REPLAY chapter 3 from the menu starts it (with its intro) -- ${JSON.stringify(r3)}`);
    await leaks('replay quit');
  }

  if (ONLY.includes('fail')) {
    console.log('== fail paths');
    // each: chapter, what to do, the message expected
    const FAILS = [
      ['coffee', 0, 'timer out: parked in a lot after the pickup', '/cold/', `(st, key) => { if (key === 'coffee.1') { SP.ap = { mode: 'idle' }; const v = d.player.vehicle; v.place(-1622, -4212, v.heading); v.vLong = 0; SP.note('teleport (parked in Gord\\'s lot, off the street, to wait out the clock)'); return true; } }`, null],
      ['goose', 1, 'pursuit: the van gets away', '/got away/', `(st, key) => { if (key === 'goose.1') { SP.ap = { mode: 'idle' }; return true; } }`, `(st) => { if (st.kind === 'chase') { SP.ap = { mode: 'idle' }; return true; } }`],
      ['tail-lost', 2, 'tail: left behind', '/lost Chad/', `(st, key) => { if (key === 'tail.1') { SP.ap = { mode: 'idle' }; return true; } }`, `(st) => { if (st.kind === 'tail') { SP.ap = { mode: 'idle' }; return true; } }`],
      ['tail-spotted', 2, 'tail: right on his bumper', '/spotted/', null, `(st) => { if (st.kind === 'tail' && st.v) { SP.ap = SP.ap.mode === 'tail' ? SP.ap : { mode: 'tail', target: st.v, gap: 8, top: 24 }; SP.ap.gap = 8; return true; } }`],
      ['float', 3, 'cargo destroyed: the float driven at 100 km/h', '/fell apart|wrecked/', null, `(st) => { if (st.kind === 'parade' && st.cps) { if (SP.ap.mode === 'idle') { const e = st.cps[st.cps.length - 1]; SP.ap = { mode: 'line', L: SP.route(e.x, e.z), stop: false, top: 30 }; } return true; } }`],
      ['card', 4, 'BUSTED: parked with two stars', '/BUSTED/', `(st, key) => { if (key === 'card.1') { SP.ap = { mode: 'idle' }; SP.fled = true; return true; } }`, `(st) => { if (st.kind === 'heat') { SP.fled = true; if (SP.stepT > 150 && !SP.forced) { SP.forced = 1; d.game.onBusted(); } return true; } }`],
      ['race', 5, 'race: Kayla gets to Preston first', '/Kayla/', null, `(st) => { if (st.kind === 'race') { SP.ap = { mode: 'idle' }; return true; } }`],
      ['prost', 6, 'finale: the limo makes YKF (followed 300 m back)', '/YKF/', null, `(st) => { if (st.kind === 'flee' && st.v) { if (SP.ap.mode !== 'tail') SP.ap = { mode: 'tail', target: st.v, gap: 300, top: 36 }; return true; } }`],
    ];
    for (const [name, ch, what, re, plan, tick] of FAILS) {
      if (CH_ONLY && !CH_ONLY.includes(ch + 1)) continue;
      console.log(`== fail: ${name} (${what})`);
      await ev(`(() => { const d = window.__dbg, SP = window.__sp; SP.cleanSlate(); SP.log.length = 0; SP.forced = 0;
        if (!d.player.vehicle || d.player.vehicle.isFloat) { const r = d.city.respawnPointNear(-1600, -4215, 80); SP.give(r.x, r.z, 0); }
        return SP.start(${ch}, { fail: '${name}', failPlan: ${plan || 'null'}, failTick: ${tick || 'null'} }); })()`);
      await play(name, { maxT: 1500 });
      const r = await J(`(() => { const d = window.__dbg, S = d.story; const l = S.log[S.log.length - 1]; if (d.game.dead) d.doRespawn();
        return JSON.stringify({ l, retry: document.getElementById('storyRetry').style.display, failed: S.failed && S.failed.i, sp: window.__sp.log, forced: window.__sp.forced }); })()`);
      for (const l of r.sp) console.log('    ' + l);
      // eslint-disable-next-line no-eval
      ok(new RegExp(re.slice(1, -1)).test(r.l) && r.l.startsWith('fail'), `${what}: "${r.l}"${r.forced ? ' (arrest called after 150 s: no unit reached the car)' : ''}`);
      ok(r.retry === 'block' && r.failed === ch, 'RETRY offered');
      await leaks(`fail ${name}`);
      if (name === 'coffee') {
        const rr = await J(`(() => { const d = window.__dbg, S = d.story; const ok = S.retry(); const o = { ok, run: S.run && S.run.ch.id, k: S.run && S.run.k, cut: !!S.cut }; S.quit(); return JSON.stringify(o); })()`);
        ok(rr.ok && rr.run === 'coffee' && !rr.cut, `RETRY restarts the chapter (no intro) -- ${JSON.stringify(rr)}`);
        await leaks('retry quit');
      }
    }
  }

  if (ONLY.includes('cost')) {
    console.log('== phone cost');
    const c = await J(`(async () => { const d = window.__dbg, S = d.story, p = d.player;
      if (S.run) S.quit();
      const g = d.city.respawnPointNear(-1600, -4230, 80);
      if (!p.vehicle) window.__sp.give(g.x, g.z, 0); else p.vehicle.place(g.x, g.z, 0);
      for (let i = 0; i < 30; i++) window.__sp.world(1 / 60);
      // the garage scene from the lot: draws with the story's meshes, then without
      const cam = d.camera; cam.position.set(-1608, d.city.groundAt(-1608, -4232, null) + 3, -4232); cam.lookAt(-1615, 2 + d.city.groundAt(-1615, -4186, null), -4186);
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      await frame(); await frame();
      const on = { calls: d.sceneStats.calls, tris: d.sceneStats.tris };
      const objs = []; d.scene.traverse((o) => { if (/^story/.test(o.name || '') && o.visible) objs.push(o); });
      for (const o of objs) o.visible = false;
      await frame(); await frame();
      const off = { calls: d.sceneStats.calls, tris: d.sceneStats.tris };
      for (const o of objs) o.visible = true;
      // story.update with nothing running, far from the garage and at it
      const t = (x, z) => { p.vehicle.place(x, z, 0); const t0 = performance.now(); for (let i = 0; i < 20000; i++) S.update(1 / 60, p); return (performance.now() - t0) / 20000 * 1000; };
      const far = t(0, 0), near = t(g.x, g.z);
      const floatTris = S.prize && S.prize.extra ? S.prize.extra.geometry.attributes.position.count / 3 : 0;
      return JSON.stringify({ floatTris, on, off, names: objs.map((o) => o.name), farUs: +far.toFixed(2), nearUs: +near.toFixed(2) }); })()`);
    console.log(`  garage view: ${c.on.calls} draws / ${c.on.tris} tris with the story's meshes (${c.names.join(', ')}), ${c.off.calls} / ${c.off.tris} without`);
    console.log(`  the float decoration: ${c.floatTris} triangles, one draw`);
    console.log(`  story.update with no chapter running: ${c.farUs} us a frame away from the garage, ${c.nearUs} us at it`);
    ok(c.farUs < 20, 'story.update costs nothing measurable away from the garage');
    ok(c.on.calls - c.off.calls <= 5, `the garage adds at most 5 draws (${c.on.calls - c.off.calls})`);
  }

  ok(!exceptions.length, `no page exceptions${exceptions.length ? ': ' + exceptions.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  console.log('ERROR ' + (e.stack || e.message));
  failures++;
} finally {
  chrome.kill();
}
console.log(failures ? `FAIL (${failures})` : 'PASS');
process.exit(failures ? 1 : 0);
