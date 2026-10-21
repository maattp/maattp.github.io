// Auto KW: the GRT bus job and a KW Eats delivery, end to end, through real keys.
//
//   node tools/kw/jobsprobe.mjs [outdir] [grt,eats]      (AUTO_GPU=1; AUTO_HTTP_PORT / AUTO_CDP_PORT)
//   GRT_ROUTE=57         which section (7, 202, 201, 57)
//   EATS_REST='Pizza Pizza'   the restaurant (a name prefix; the nearest such to the spawn)
//
// Boots like kwshots.mjs (service worker bypassed, __noAutoQuality) and leaves
// the game RUNNING. Everything the player does goes through
// Input.dispatchKeyEvent -- F to get in, W / S / A / D to drive -- decided
// every ~50 ms by a little autopilot reading the game state:
//   - GRT: the player stands by the section's parked bus, presses F, and the
//     run starts at the terminal. The autopilot pursues the route's line in
//     the kerb lane, eases off for anything ahead, brakes to stop the front
//     door at each stop, waits while the doors are open, and drives on. At
//     the end it prints window.__grtLast (score, grade, pay, each stop's
//     schedule delta and kerb gap, the smoothness events).
//   - KW Eats: a sedan is parked on the street by the restaurant; the player
//     gets in (F), drives to the kitchen and stops, waits for the order, then
//     follows the A* street route (taxi.js PathJob) to the door and stops.
//     Prints window.__eatsLast (pay, tip, condition, time against the quote).
// Screenshots of the chase camera at the moments that matter go to outdir.
// Exits 1 on a page exception or a job that did not finish.

import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/jobshots';
const ONLY = (process.argv[3] || 'grt,eats').split(',');
const PHONE = process.env.AUTO_PHONE === '1';
const ROUTE = process.env.GRT_ROUTE || '57';
const REST = process.env.EATS_REST || 'Campus Pizza';

// the autopilot, in the page: where to steer and how fast to go
const AUTO = `
window.__auto = (() => {
  const d = window.__dbg;
  const lineOf = (pts) => { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, cum, len: cum[cum.length - 1] }; };
  const at = (L, s) => { let i = 1; while (i < L.pts.length - 1 && L.cum[i] < s) i++; const a = L.pts[i - 1], b = L.pts[i], l = L.cum[i] - L.cum[i - 1] || 1, t = Math.max(0, Math.min(1, (s - L.cum[i - 1]) / l));
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l }; };
  const proj = (L, x, z, s0) => { let best = null; for (let i = 0; i < L.pts.length - 1; i++) { if (L.cum[i + 1] < s0 - 60 || L.cum[i] > s0 + 400) continue;
    const a = L.pts[i], b = L.pts[i + 1], sx = b[0] - a[0], sz = b[1] - a[1], l2 = sx * sx + sz * sz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * sx + (z - a[1]) * sz) / l2));
    const dd = Math.hypot(a[0] + sx * t - x, a[1] + sz * t - z); if (!best || dd < best.d) best = { d: dd, s: L.cum[i] + t * Math.sqrt(l2) }; } return best; };
  // the game's own road under (x, z): its half width and its centreline point
  // there (OSM's line and the drawn road can be metres apart)
  const roadAt = (x, z) => { let r = null, bd = 1e9; for (const ei of d.city.edgesNear(x, z, 25)) { const e = d.city.edges[ei]; if (e.elev || e.tunnel || e.noTraffic) continue; const a = d.city.nodes[e.a], b = d.city.nodes[e.b];
    const sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * sx + (z - a.z) * sz) / l2)); const cx = a.x + sx * t, cz = a.z + sz * t, dd = Math.hypot(cx - x, cz - z);
    if (dd < bd) { bd = dd; r = { hw: e.hw, cx, cz, d: dd }; } } return r; };
  const st = { L: null, s: 0 };
  return {
    setLine(pts) { st.L = lineOf(pts); st.s = 0; },
    // { steer: -1 (right) .. 1 (left), want m/s, v, ... }: follow st.L, offset to the
    // right by the kerb lane (lane: 'kerb' or a number), stop at stopS
    step(stopS, lane, cruise) {
      const v = d.player.vehicle; if (!v || !st.L) return null;
      const p = proj(st.L, v.x, v.z, st.s); if (p) st.s = p.s;
      const sp = Math.abs(v.vLong);
      const look = 10 + sp * 1.2;
      const q = at(st.L, st.s + look);
      // the travel lane, and the kerb itself for the last 45 m to a stop
      const R = roadAt(q.x, q.z), hw = R ? R.hw : 4, toS = stopS == null ? 1e9 : stopS - st.s;
      const off = lane === 'kerb' ? (toS < 45 && toS > -10 ? Math.max(1.8, hw - 1.9) : Math.max(1.8, Math.min(hw - 1.9, hw * 0.5 + 0.3))) : lane;
      const c = R && R.d < 12 ? { x: R.cx, z: R.cz } : q;
      // after backing off something it was stuck on: swing out to the left for a while
      const bias = window.__autoBias && window.__autoBias.until > performance.now() ? window.__autoBias.off : 0;
      let tx = c.x - q.dz * (off - bias), tz = c.z + q.dx * (off - bias);
      const f = v.forward, lx = f.z, lz = -f.x;
      // pass parked cars on their left, as a driver would
      for (const o of d.traffic.cars) { if (o === v || o.dead || (o.mode !== 'parked' && o.mode !== 'apron')) continue;
        const dx = o.x - v.x, dz = o.z - v.z, al = dx * f.x + dz * f.z; if (al < -2 || al > 40) continue;
        const ot = (tx - o.x) * lx + (tz - o.z) * lz, need = v.halfWid + o.halfWid + 0.8;
        if (Math.abs(ot) < need) { tx += lx * (need - ot); tz += lz * (need - ot); } }
      const rx = tx - v.x, rz = tz - v.z;
      const ang = Math.atan2(rx * lx + rz * lz, rx * f.x + rz * f.z);
      // the speed: cruise, slowed for the bend ahead and to stop at stopS
      let want = cruise;
      let turn = 0;
      for (let k = 10; k < 60; k += 10) { const a = at(st.L, st.s + k), b = at(st.L, st.s + k + 10); turn = Math.max(turn, Math.abs(Math.atan2(a.dx * b.dz - a.dz * b.dx, a.dx * b.dx + a.dz * b.dz))); }
      if (turn > 0.25) want = Math.min(want, 5); else if (turn > 0.12) want = Math.min(want, 7.5);
      const toStop = stopS - st.s;
      if (stopS != null) want = Math.min(want, Math.sqrt(Math.max(0, 2 * 1.6 * (toStop - 1))));
      // anything in the way ahead
      let block = null;
      for (const o of d.traffic.cars) { if (o === v || o.dead || o.leader === v || o.mode === 'parked' || o.mode === 'apron') continue; const dx = o.x - v.x, dz = o.z - v.z, al = dx * f.x + dz * f.z, la = Math.abs(dx * lx + dz * lz);
        if (al > 0 && al < v.halfLen + o.halfLen + 4 + sp * 1.6 && la < v.halfWid + o.halfWid + 0.3) { const w = Math.max(0, (al - v.halfLen - o.halfLen - 3) * 0.4); if (w < want) { want = w; block = [o.spec && o.spec.hand, o.mode, al | 0, la.toFixed(1)]; } } }
      return { ang, want, block, v: v.vLong, s: st.s, toStop, d: p ? p.d : null, len: st.L.len };
    },
  };
})();`;

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-jobs-profile-${PORT}`, width: 1280, height: 720,
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
    const evaluate = async (e) => {
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
    // real keys
    const KEYS = { w: ['KeyW', 'w', 87], s: ['KeyS', 's', 83], a: ['KeyA', 'a', 65], d: ['KeyD', 'd', 68], f: ['KeyF', 'f', 70] };
    const held = new Set();
    const key = async (k, down) => {
      if (down === held.has(k)) return;
      const [code, kk, vk] = KEYS[k];
      await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: kk, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      if (down) held.add(k); else held.delete(k);
    };
    const tap = async (k) => { await key(k, true); await sleep(120); await key(k, false); };
    const release = async () => { for (const k of [...held]) await key(k, false); };

    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    // keep the page "visible and focused" whatever the window does: a hidden
    // page pauses the game (visibilitychange) and stops its frames
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    if (PHONE) {
      await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    let up = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await evaluate('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.grt)')) { up = true; break; }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 5).join('\n'));
    console.log(`booted; exceptions at boot: ${errs.length}`);
    await sleep(3000);
    // past the launch screen, as a tap would
    await evaluate(`(() => { const b = document.querySelector('#startBtn, #playBtn, [data-start]'); if (b) b.click(); document.getElementById('rotate') && (document.getElementById('rotate').style.display = 'none'); })()`);
    await evaluate(AUTO);
    // the launch leaves the pause menu up (and a hidden headless tab can pause it): Resume, as a tap would
    const resume = () => evaluate(`(() => { if (window.__dbg.game.paused) { document.getElementById('resumeBtn').click(); return true; } return false; })()`);
    await resume();
    await sleep(500);
    console.log('state:', JSON.stringify(await evaluate(`({ hidden: document.hidden, paused: window.__dbg.game.paused, held: window.__dbg.game.held, menu: document.getElementById('pauseMenu').className })`)));
    let bad = 0;

    // drive the autopilot until done() is true or `secs` of wall time pass
    const drive = async (opts, secs, onTick) => {
      const t0 = Date.now();
      let cyc = 0, stuck = 0;
      while (Date.now() - t0 < secs * 1000) {
        if (cyc === 0) await resume();
        const g = await evaluate(opts.state);
        if (!g) { await release(); await sleep(100); continue; }
        if (opts.done(g)) { await release(); return g; }
        if (onTick) await onTick(g);
        const a = g.a;
        if (!a || g.hold) { await key('w', false); await key('a', false); await key('d', false); await key('s', Math.abs(g.v || 0) > 0.3 && (g.v || 0) > 0); await sleep(60); continue; }
        // steer: bang-bang with a deadband, pulsed by how far off it is
        cyc = (cyc + 1) % 6;
        const mag = Math.min(1, Math.abs(a.ang) / 0.45);
        const on = Math.abs(a.ang) > 0.035 && cyc < Math.max(1, Math.round(mag * 6));
        await key('a', on && a.ang > 0); await key('d', on && a.ang < 0);
        // stuck against something: back off a few metres
        stuck = a.want > 2 && Math.abs(a.v) < 0.3 ? stuck + 1 : 0;
        if (stuck > 60) {
          // back off with the wheel to the right (the nose swings left), then pass on the left
          await key('w', false); await key('a', false); await key('d', true); await key('s', true); await sleep(2500);
          await key('s', false); await key('d', false); stuck = 0;
          await evaluate('window.__autoBias = { until: performance.now() + 9000, off: 3.2 }');
          continue;
        }
        // speed
        if (a.v < a.want - 0.8) { await key('s', false); await key('w', true); }
        else if (a.v > a.want + 1.2 && a.v > 0.4) { await key('w', false); await key('s', cyc % 3 === 0 || a.v > a.want + 4); }
        else { await key('w', false); await key('s', false); }
        await sleep(50);
      }
      await release();
      return null;
    };

    if (ONLY.includes('grt')) {
      console.log(`GRT ${ROUTE}`);
      const r = await evaluate(`(() => { const d = window.__dbg, g = d.grt, rt = g.routes.find((r) => r.id === '${ROUTE}');
        const v = g.buses[g.routes.indexOf(rt)];
        // stand by the front door
        const f = v.forward; d.player.x = v.x + f.x * 5 - f.z * 2.6; d.player.z = v.z + f.z * 5 + f.x * 2.6;
        d.player.y = d.city.groundAt(d.player.x, d.player.z, null) + 0.2; if (d.player.h) d.player.h.group.position.set(d.player.x, d.player.y, d.player.z);
        __auto.setLine(rt.line);
        return { sign: rt.sign, stops: rt.stops.length, len: Math.round(rt.len), sched: Math.round(rt.sched[rt.sched.length - 1]), bus: [v.x | 0, v.z | 0] }; })()`);
      console.log('  ', JSON.stringify(r));
      await sleep(2500);
      console.log('  before F:', await evaluate('window.__dbg.game.paused'));
      await resume();
      await tap('f');
      await sleep(1500);
      console.log('  after F:', await evaluate('JSON.stringify([window.__dbg.game._menu, [...window.__dbg.game.holds], document.hidden])'), await evaluate('!!window.__dbg.player.vehicle'));
      const started = await evaluate('(() => { const g = window.__dbg.grt; return g.run ? { stage: g.run.stage, plan: g.run.plan } : null; })()');
      console.log('  started:', JSON.stringify(started));
      if (!started) { console.log('  FAIL: the run did not start'); bad++; }
      else {
        await sleep(1200);
        await shot(`grt-${ROUTE}-board`);
        let shotStop = false, shotDrive = false, lastI = -1;
        const res = await drive({
          state: `(() => { const d = window.__dbg, g = d.grt, run = g.run; if (!run) return { done: true };
            const rt = run.rt, ni = run.i + 1, v = run.v;
            const hold = run.stage !== 'drive';
            const stopS = ni < rt.stops.length ? rt.stops[ni].at - 2.5 : null;
            return { stage: run.stage, i: run.i, hold, v: v.vLong, a: hold ? null : __auto.step(stopS, 'kerb', ${process.env.GRT_CRUISE || 13}), clock: run.clock | 0, s: run.s | 0, smooth: run.smooth, stopT: run.stopT || 0, ev: run.events, dbg: [run.t.toFixed(1), (run.dwellT||0).toFixed(1), run.boarding.length, run.alightLeft, v.vLong.toFixed(2), v.x | 0, v.z | 0] }; })()`,
          done: (g) => g.done,
        }, +process.env.GRT_SECS || 1500, async (g) => {
          if (process.env.JOBS_DEBUG && Math.random() < 0.05) console.log('    dbg', g.stage, JSON.stringify(g.dbg), g.a ? JSON.stringify(g.a) : '');
          if (g.i !== lastI) { lastI = g.i; console.log(`   stop ${g.i} · ${g.stage} · clock ${g.clock}s · s ${g.s} m · smooth ${Math.round(g.smooth)} ${JSON.stringify(g.ev)}`); }
          if (!shotDrive && g.stage === 'drive' && g.a && g.a.v > 8) { shotDrive = true; await shot(`grt-${ROUTE}-drive`); }
          if (!shotStop && g.stage === 'dwell' && g.i >= 2) { shotStop = true; await sleep(900); await shot(`grt-${ROUTE}-stop`); }
        });
        const last = await evaluate('window.__grtLast');
        console.log('  result:', JSON.stringify(last));
        if (!res || !last) { console.log('  FAIL: the run did not finish'); bad++; }
        await shot(`grt-${ROUTE}-end`);
      }
      // out of the bus
      await tap('f'); await sleep(1500);
    }

    if (ONLY.includes('eats')) {
      console.log(`KW Eats from ${REST}`);
      const r = await evaluate(`(() => { const d = window.__dbg, E = d.eats;
        const p = d.player.position, cands = E.rest.filter((q) => q.name.startsWith(${JSON.stringify(REST)}));
        cands.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
        const q = cands[0]; if (!q) return null;
        // a car at the kerb ~120 m from the kitchen, and the player beside it
        const sp = d.city.respawnPointNear(q.x + 90, q.z + 60, 400);
        const v = d.traffic.spawnAt(sp.x, sp.z, sp.heading || 0, 'sedan', 0x3060a0, 'apron');
        v.vLong = 0;
        const f = v.forward; d.player.x = v.x - f.z * 2.2; d.player.z = v.z + f.x * 2.2;
        d.player.y = d.city.groundAt(d.player.x, d.player.z, null) + 0.2;
        window.__eatsCar = v; window.__eatsRest = q;
        return { rest: q.name, kind: q.kind, at: [q.x | 0, q.z | 0], car: [v.x | 0, v.z | 0] }; })()`);
      console.log('  ', JSON.stringify(r));
      if (!r) { console.log('  FAIL: no such restaurant'); bad++; }
      else {
        await sleep(2500);
        await resume();
        await tap('f');
        await sleep(1200);
        const inCar = await evaluate('window.__dbg.player.vehicle === window.__eatsCar');
        console.log('  in the car:', inCar);
        // a road route there: A* between the nearest network nodes (taxi.js's)
        const routeTo = async (x, z) => evaluate(`(() => { const d = window.__dbg, T = d.taxi, v = d.player.vehicle;
          const a = T.mainNode(v.x, v.z, 250), b = T.mainNode(${'${x}'}, ${'${z}'}, 120); if (a < 0 || b < 0) return 0;
          const path = a === b ? [a] : T.pathJob(a, b, 6000).finish(); if (!path) return 0;
          // (to the street node nearest the target: the target itself can be inside a car park)
          const pts = [[v.x, v.z], ...path.map((n) => [d.city.nodes[n].x, d.city.nodes[n].z])];
          // then the street point in front of it (respawnPointNear: on a road)
          let k = null, kd = 1e9;
          for (const ei of d.city.edgesNear(${'${x}'}, ${'${z}'}, 80)) { const e = d.city.edges[ei]; if (e.elev || e.tunnel || e.noTraffic) continue; const A = d.city.nodes[e.a], B = d.city.nodes[e.b];
            const sx = B.x - A.x, sz = B.z - A.z, l2 = sx * sx + sz * sz || 1, t = Math.max(0, Math.min(1, ((${'${x}'} - A.x) * sx + (${'${z}'} - A.z) * sz) / l2)), px = A.x + sx * t, pz = A.z + sz * t, dd = Math.hypot(px - ${'${x}'}, pz - ${'${z}'});
            if (dd < kd) { kd = dd; k = { x: px, z: pz }; } }
          if (k && Math.hypot(k.x - pts[pts.length - 1][0], k.z - pts[pts.length - 1][1]) > 2) pts.push([k.x, k.z]);
          __auto.setLine(pts); return pts.length; })()`.replace(/\$\{x\}/g, x).replace(/\$\{z\}/g, z));
        const n1 = await routeTo(r.at[0], r.at[1]);
        console.log('  route to the kitchen:', n1, 'points');
        const toKitchen = await drive({
          state: `(() => { const d = window.__dbg, E = d.eats; const v = d.player.vehicle;
            if (E.run) return { done: true };
            const a = __auto.step(null, 2.2, 12); if (a) { const q = window.__eatsRest; const dd = Math.hypot(q.x - v.x, q.z - v.z); a.toStop = dd; const end = a.len - a.s; a.want = Math.min(a.want, Math.sqrt(Math.max(0, 2 * 1.6 * (Math.min(end, dd - 30))))); if (dd < 36) a.want = 0;
              // the street ends short of it: into the car park, slowly, straight at the door
              else if (end < 4) { const f = v.forward, rx = q.x - v.x, rz = q.z - v.z; a.ang = Math.atan2(rx * f.z - rz * f.x, rx * f.x + rz * f.z); a.want = 3; }
              a.dd = dd | 0; }
            return { a, v: v ? v.vLong : 0 }; })()`,
          done: (g) => g.done,
        }, 400);
        const prep = await evaluate('(() => { const E = window.__dbg.eats; return E.run ? { stage: E.run.stage, kind: E.run.kind, home: E.run.home, quote: E.run.quote } : null; })()');
        console.log('  order:', JSON.stringify(prep));
        if (!toKitchen || !prep) { console.log('  FAIL: never picked up'); bad++; }
        else {
          await shot('eats-kitchen');
          for (let i = 0; i < 60; i++) { if (await evaluate('window.__dbg.eats.run && window.__dbg.eats.run.stage === "go"')) break; await key('s', true); await sleep(200); }
          await key('s', false);
          const n2 = await routeTo(prep.home.x, prep.home.z);
          console.log('  route to the door:', n2, 'points');
          let shotGo = false;
          const res = await drive({
            state: `(() => { const d = window.__dbg, E = d.eats; const v = d.player.vehicle;
              if (!E.run) return { done: true };
              const a = __auto.step(null, 2.2, 14); if (a) { const h = E.run.home, dd = Math.hypot(h.x - v.x, h.z - v.z); const end = a.len - a.s; a.want = Math.min(a.want, Math.sqrt(Math.max(0, 2 * 1.6 * (Math.min(end, dd - 14))))); if (dd < 18) a.want = 0;
                else if (end < 4) { const f = v.forward, rx = h.x - v.x, rz = h.z - v.z; a.ang = Math.atan2(rx * f.z - rz * f.x, rx * f.x + rz * f.z); a.want = dd < 26 ? 0 : 2.5; }
                a.dd = dd | 0; }
              return { a, v: v ? v.vLong : 0, cond: E.run.cond, t: E.run.t | 0 }; })()`,
            done: (g) => g.done,
          }, +process.env.EATS_SECS || 700, async (g) => { if (!shotGo && g.a && g.a.v > 9) { shotGo = true; await sleep(1500); await shot('eats-drive'); } });
          const last = await evaluate('window.__eatsLast');
          console.log('  result:', JSON.stringify(last));
          if (!res || !last) { console.log('  FAIL: not delivered'); bad++; }
          await shot('eats-door');
        }
      }
    }
    console.log(`exceptions: ${errs.length}${errs.length ? '\n  ' + errs.slice(0, 8).join('\n  ') : ''}`);
    if (errs.length || bad) process.exitCode = 1;
  } finally {
    chrome.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
