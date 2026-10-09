// The Queen Anne Counterbalance (apps/auto/src/counterbalance.js), probed.
//
//   node tools/cbprobe.mjs [--phone] [--only line,service,drive,slip,ride,traffic,exit,shots] [--shots DIR]
//
// Boots the game headlessly (SwiftShader unless AUTO_GPU=1), then, at fixed
// dt with the game paused (the loop only draws):
//   line     the route is on the road graph: thirteen stops in order, the
//            line's length, the counterbalance between Roy and Lee (length,
//            grade, rise), the rails on the road surface
//   service  twenty minutes of the timetable: every car keeps making stops,
//            every hill passage is made hooked to a counterweight, no car on
//            the cable without one, no two cars overlap, the limits held
//   drive    you board a car on foot below Roy, drive it to the mark, hook
//            on, power up the counterbalance, stop on the mark at Lee, unhook
//            and step off: the car advances, you stay aboard, it comes back
//            into service and nothing is left behind (button, labels, readout)
//   slip     the same car with no counterweight cannot climb the hill
//   ride     RIDE: the crew drives you through two stops
//   traffic  an AI car put behind a streetcar standing at its stop never
//            drives into it, and queues
//   exit     death aboard, WASTED and the respawn leave no state behind
//   robust   what a player does to it: two cars nose to nose on one pair of
//            rails on the hill (the one off the cable backs off, the climber
//            gets to the top); a car abandoned unhooked mid-hill (it does not
//            stop the line); POWER downhill at Lee with no weight (the stop
//            block); BRAKE alone holding at the Roy mark; hooking on 0.8 m
//            short (no jump, no unhook); ENTER at a stop's post; and every
//            car making stops again after all of it
//   fuzz     CB_FUZZ_SEEDS seeds (40) x CB_FUZZ_MIN sim minutes (15): every car
//            put at a random interesting state -- each mark both ways, each
//            crossover, mid-hill hooked and not, each stop, each stub end, the
//            weights anywhere -- and you either away, or boarding a car,
//            pressing random POWER / BRAKE / reverse and leaving it (standing
//            by), or staying aboard. The invariant: no two cars ever overlap;
//            with you out of it every AI car makes a stop or a hill trip
//            within the run; staying aboard, your car can always be moved one
//            way or the other. CB_FUZZ_FROM=n starts at seed n.
//   shots    the foot of the hill looking up, mid-climb from the car, the top
//            of the hill, the whole route from the air, the car close, the
//            plaque -- LOOK at them
// Needs `python3 -m http.server $AUTO_HTTP_PORT` from the repo root.
import { launchChrome } from './chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9222;
const URL_BASE = process.env.AUTO_URL || `http://localhost:${HTTP_PORT}/apps/auto/`;
const PHONE = process.argv.includes('--phone');
const oi = process.argv.indexOf('--only');
const ONLY = oi > 0 ? process.argv[oi + 1].split(',') : null;
const want = (k) => !ONLY || ONLY.includes(k);
const si = process.argv.indexOf('--shots');
const SHOTS = si > 0 ? process.argv[si + 1] : 'tools/data/cbshots';

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-cb-profile-${PORT}`, width: 1280, height: 720 });
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('no CDP target');
}

// In-page helpers, installed once after boot.
const HELPERS = `(() => {
  const d = __dbg, L = d.counterbal, P = d.player;
  const H = window.__cb = {};
  H.input = (gas, brake) => ({ x: 0, y: 0, gas: gas > 0.5, brake: brake > 0.5, gasAmt: gas, brakeAmt: brake, hand: false, horn: false, liftAmt: 0, sinkAmt: 0 });
  // one fixed step of what the frame loop does for you, your car and the line
  H.step = (dt, gas, brake) => {
    if (P.vehicle) P.updateDrive(dt, H.input(gas, brake), d.traffic, d.peds);
    L.update(dt, d.camera);
  };
  // a car moved to s on a track, with no hill or hitch, running
  H.put = (car, key, s) => {
    if (car.hitch) L.unhitch(car);
    car.track = L.tracks[key]; car.hill = null; car.hitch = null; car._ghost = false;
    car.place(s); car.state = 'run'; car.lastStop = null; car.stop = null; car.timer = 0; car.u = 0;
  };
  // every other car well away from this track's hill and its stops
  H.clearHill = (car) => {
    for (const o of L.cars) {
      if (o === car) continue;
      const tr = o.track;
      if (o.hitch) L.unhitch(o);
      o.hill = null;
      H.put(o, o.track.key, tr.key === 'out' ? Math.min(tr.zIn[0] - 900 - o.id * 60, tr.len - 20) : Math.max(tr.zOut[1] + 400 + o.id * 60, 20));
    }
  };
  // the player standing beside a car, on foot
  H.beside = (car, side = 1) => {
    if (P.vehicle) P.exitVehicle(true);
    const f = car._fwd, rx = -f.z * side, rz = f.x * side;
    P.x = car.cx + rx * 2.4; P.z = car.cz + rz * 2.4; P.y = d.city.groundAt(P.x, P.z, null);
  };
  // stream the city round (x, z) while paused, so a shot has its buildings
  H.stream = (x, z, n = 30) => { let left = 1; for (let i = 0; i < n && left; i++) left = d.world.update(x, z, 40); return left; };
  H.cam = (x, y, z, tx, ty, tz, fov = 60) => {
    const c = d.camera; c.fov = fov; c.updateProjectionMatrix(); c.position.set(x, y, z); c.lookAt(tx, ty, tz); c.updateMatrixWorld(true);
    L.update(0, c);
  };
  return true;
})()`;

try {
  const ws = new WebSocket((await target()).webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') logs.push('WARN: ' + m.params.args.map((a) => a.value).join(' '));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, aw = true) => {
    for (let k = 0; k < 3; k++) {
      try {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: aw });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      } catch (e) {
        if (!/navigated or closed/.test(e.message) || k === 2) throw e;
        await sleep(2000);
      }
    }
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (PHONE) {
    await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true; window.__keepArrays = true;' });
  await send('Page.navigate', { url: URL_BASE });
  let booted = false;
  for (let i = 0; i < 900; i++) {
    await sleep(500);
    if (await ev('!!(window.__dbg && window.__dbg.counterbal && window.__dbg.sceneStats && window.__dbg.sceneStats.calls > 0)', false).catch(() => false)) { booted = true; break; }
  }
  if (!booted) throw new Error('never booted: ' + logs.slice(-5).join(' | '));
  console.log('booted', await ev('document.getElementById("build") && document.getElementById("build").textContent', false));
  await ev(HELPERS, false);
  mkdirSync(SHOTS, { recursive: true });
  const shot = async (name) => {
    await sleep(1800);
    writeFileSync(`${SHOTS}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    console.log(`  shot ${SHOTS}/${name}.png`);
  };

  // CB_PROBE='<expr>': a one-off diagnostic on this boot, before the sections
  if (process.env.CB_PROBE) console.log(JSON.stringify(await ev(process.env.CB_PROBE), null, 1));

  // ---- the line ----
  if (want('line')) {
    const r = await ev(`(() => {
      const d = __dbg, L = d.counterbal, G = d.G, out = {};
      out.ok = L.ok;
      if (!L.ok) return out;
      for (const k of L.keys) {
        const tr = L.tracks[k];
        out[k] = { len: Math.round(tr.len), stops: tr.stops.map((st) => [st.name, Math.round(st.s[k])]), h1: Math.round(tr.h1), h2: Math.round(tr.h2), climbs: tr.climbs };
        // the counterbalance: its length, grade and rise, from the rail heights
        let gMax = 0, gMean = 0, n = 0;
        for (let s = tr.h1; s < tr.h2 - 10; s += 5) {
          const g = Math.abs(tr.y(s + 10) - tr.y(s)) / 10;
          gMax = Math.max(gMax, g); gMean += g; n++;
        }
        out[k].cbLen = Math.round(tr.h2 - tr.h1);
        out[k].gradeMax = +(gMax * 100).toFixed(1); out[k].gradeMean = +(gMean / n * 100).toFixed(1);
        out[k].rise = +Math.abs(tr.y(tr.h2) - tr.y(tr.h1)).toFixed(1);
        // the rails sit on the road: rail head vs groundAt along the line
        let worstUp = 0, worstDown = 0;
        for (let s = 2; s < tr.len - 2; s += 7) {
          const x = tr.x(s), z = tr.z(s), g = d.city.groundAt(x, z, tr.y(s));
          const dy = tr.y(s) + 0.03 - g;
          worstUp = Math.max(worstUp, dy); worstDown = Math.min(worstDown, dy);
        }
        out[k].railVsRoad = [+worstDown.toFixed(2), +worstUp.toFixed(2)];
        // where the hitch points are, as lat/lon
        out[k].bot = G.toLatLon(tr.x(tr.sBot), tr.z(tr.sBot)).map((v) => +v.toFixed(5));
        out[k].top = G.toLatLon(tr.x(tr.sTop), tr.z(tr.sTop)).map((v) => +v.toFixed(5));
      }
      // the route passes the places the 1931 line did
      const pass = (lat, lon) => { const [x, z] = G.toWorld(lat, lon); return L.keys.map((k) => { const q = L.tracks[k].nearest(x, z, 25); return q ? Math.round(Math.abs(q.d)) : null; }); };
      out.passes = {
        firstAndPike: pass(47.60885, -122.34), qaAndRoy: pass(47.62571, -122.35672), qaAndHighland: pass(47.62957, -122.35664),
        galerAnd3rd: pass(47.63232, -122.36103), sixthAndBlaine: pass(47.63474, -122.36502),
      };
      out.chunks = L.chunks.length;
      out.tris = L.chunks.reduce((a, e) => a + (e.mesh ? e.mesh.geometry.index.count / 3 : 0), 0);
      out.carTris = L.cars.length ? L.cars[0].meshes.reduce((a, m) => a + m.geometry.index.count / 3, 0) : 0;
      return out;
    })()`, false);
    console.log(JSON.stringify(r));
    // the sounds are in the bank (rendered at boot, after the first batches)
    let bank = null;
    for (let i = 0; i < 90 && !(bank && bank.bell && bank.clunk && bank.hum); i++) { bank = await ev('(() => { const b = __dbg.audio.bank; return b ? { bell: !!(b.cable_bell && b.cable_bell.length), clunk: !!(b.cb_clunk && b.cb_clunk.length), hum: !!(b.cb_hum && b.cb_hum.length) } : null; })()', false); if (!(bank && bank.bell && bank.clunk && bank.hum)) await sleep(1000); }
    check(bank && bank.bell && bank.clunk && bank.hum, `the gong, the clunk and the cable's hum are in the sound bank (${JSON.stringify(bank)})`);
    check(r.ok, 'the line is laid on the road graph');
    if (r.ok) {
      check(r.out.stops.length === 12 && r.in.stops.length === 12, `12 stops each way (out ${r.out.stops.length}, in ${r.in.stops.length})`);
      const inOrder = (k) => r[k].stops.every((st, i) => i === 0 || st[1] > r[k].stops[i - 1][1]);
      check(inOrder('out') && inOrder('in'), 'stops in order along each track');
      check(r.out.stops[0][0] === 'Madison St' && r.out.stops[r.out.stops.length - 1][0] === 'McGraw St', 'out: from Pioneer Square to McGraw St');
      check(r.out.len > 4800 && r.out.len < 6200 && r.in.len > 4800 && r.in.len < 6200, `route length ${r.out.len} m / ${r.in.len} m`);
      check(r.out.cbLen > 520 && r.out.cbLen < 700, `the counterbalance, Roy St to Lee St: ${r.out.cbLen} m (1940: ~2,150 ft = 655 m)`);
      check(r.out.gradeMax >= 12 && r.out.gradeMax <= 21, `its steepest grade ${r.out.gradeMax}% (published 18.7%; mean ${r.out.gradeMean}%)`);
      check(r.out.rise > 45, `it climbs ${r.out.rise} m`);
      check(r.out.climbs && !r.in.climbs, 'the out track climbs the hill, the in track descends it');
      for (const k of ['out', 'in']) check(r[k].railVsRoad[0] > -0.06 && r[k].railVsRoad[1] < 0.2, `${k}: rail head on the road surface (${r[k].railVsRoad.join(' .. ')} m)`);
      for (const [n, v] of Object.entries(r.passes)) check(v.some((x) => x !== null && x < 4), `the route passes ${n} (${v})`);
    }
  }

  // ---- service ----
  if (want('service')) {
    const r = await ev(`(() => {
      const d = __dbg, L = d.counterbal;
      d.game.paused = true;
      const st = { stops: L.cars.map(() => 0), hills: 0, hillsHooked: 0, cableUnhooked: 0, overlap: 0, over: 0, ends: 0, weightsBad: 0 };
      const was = L.cars.map((c) => ({ s: c.s, track: c.track.key, state: c.state, onCable: false }));
      const dt = 0.1;
      for (let i = 0; i < 12000; i++) {
        L._service(dt);
        L.cars.forEach((c, j) => {
          const w = was[j];
          if (c.state === 'dwell' && w.state !== 'dwell') st.stops[j]++;
          if (c.track.key !== w.track) st.ends++;
          const tr = c.track, on = c.s > tr.h1 + 5 && c.s < tr.h2 - 5;
          if (on && !w.onCable) { st.hills++; if (c.hitch) st.hillsHooked++; }
          if (on && !c.hitch) st.cableUnhooked++;
          if (c.u > tr.LIM[tr.idx(c.s + 6.7)] + 0.8 && c.u > tr.LIM[tr.idx(c.s)] + 0.8) { st.over++; const e = c.u - tr.LIM[tr.idx(c.s)]; if (!st.worst || e > st.worst[0]) st.worst = [+e.toFixed(2), tr.key, Math.round(c.s), +c.u.toFixed(1), +c.grade.toFixed(3), c.hitch]; }
          if (c.state === 'run' && Math.abs(c.u) < 0.05) { w.wait = (w.wait || 0) + dt; if (!st.longest || w.wait > st.longest[0]) st.longest = [Math.round(w.wait), c.number, tr.key, Math.round(c.s), Math.round(tr.zIn[0]), c.nextStop() && c.nextStop().name]; } else w.wait = 0;
          w.s = c.s; w.track = tr.key; w.state = c.state; w.onCable = on;
        });
        for (let a = 0; a < L.cars.length; a++) for (let b = a + 1; b < L.cars.length; b++) {
          const p = L.cars[a], q = L.cars[b];
          const dx = q.cx - p.cx, dz = q.cz - p.cz, al = dx * p._fwd.x + dz * p._fwd.z, la = dx * p._fwd.z - dz * p._fwd.x;
          // the two bodies as oriented boxes (13.4 x 2.54 m), separated on any of their four axes?
          let pen = Infinity;
          for (const ax of [p._fwd, { x: p._fwd.z, z: -p._fwd.x }, q._fwd, { x: q._fwd.z, z: -q._fwd.x }]) {
            const ra = 6.7 * Math.abs(p._fwd.x * ax.x + p._fwd.z * ax.z) + 1.27 * Math.abs(p._fwd.z * ax.x - p._fwd.x * ax.z);
            const rb = 6.7 * Math.abs(q._fwd.x * ax.x + q._fwd.z * ax.z) + 1.27 * Math.abs(q._fwd.z * ax.x - q._fwd.x * ax.z);
            pen = Math.min(pen, ra + rb - Math.abs(dx * ax.x + dz * ax.z));
          }
          if (pen > 0.1) { st.overlap++; if (!st.ov) st.ov = [i, [p.number, p.track.key, Math.round(p.s), p.state, p.hill, +p.u.toFixed(1)], [q.number, q.track.key, Math.round(q.s), q.state, q.hill, +q.u.toFixed(1)], +al.toFixed(1), +la.toFixed(1)]; }
        }
        for (const P of ['E', 'W']) { const w = L.weights[P]; if (w.f < -0.01 || w.f > 1.01) st.weightsBad++; }
      }
      st.final = L.cars.map((c) => [c.number, c.track.key, Math.round(c.s), c.state, c.hill, c.hitch]);
      st.weights = { E: +L.weights.E.f.toFixed(2), W: +L.weights.W.f.toFixed(2) };
      return st;
    })()`, false);
    console.log(JSON.stringify(r));
    check(r.stops.every((n) => n >= 8), `20 min of service: every car keeps making stops (${r.stops.join(', ')})`);
    check(r.hills >= 4, `cars took the hill ${r.hills} times`);
    check(r.hills === r.hillsHooked && r.cableUnhooked === 0, `every passage on the cable hooked to a counterweight (${r.hillsHooked}/${r.hills}, ${r.cableUnhooked} unhooked frames)`);
    check(r.overlap === 0, `no two cars overlap (${r.overlap})`);
    check(r.over === 0, `limits held (${r.over} frames over)`);
    check(r.ends >= 2, `cars change ends at the termini (${r.ends})`);
    check(r.weightsBad === 0, 'weights stay in their tunnels');
  }

  // ---- drive: board below Roy, hook on, up the hill, unhook at Lee, off ----
  if (want('drive')) {
    const r = await ev(`(() => {
      const d = __dbg, L = d.counterbal, P = d.player, H = __cb;
      d.game.paused = true;
      const car = L.cars[0], tr = L.tracks.out;
      H.clearHill(car);
      L.weights.E.f = 1; L.weights.E.car = null; L.weights.W.f = 0; L.weights.W.car = null;
      H.put(car, 'out', tr.zIn[0] - 70);
      L.update(0, d.camera);
      H.beside(car);
      const out = { boardable: L.boardable(P.x, P.y, P.z) === car };
      P.enterVehicle(car);
      out.aboard = P.vehicle === car && car.driver === 'player' && car.mode === 'drive';
      out.bell = (document.querySelector('[data-btn="horn"]') || {}).textContent;
      out.gasLabel = (document.querySelector('[data-btn="gas"]') || {}).textContent;
      out.btn = L.btn && L.btn.style.display;
      const dt = 1 / 30;
      let off = 0, steps = 0;
      const s0 = car.s, y0 = car.cy;
      // to the mark at Roy: a stop the way a motorman makes one
      for (; steps < 6000; steps++) {
        const left = tr.h1 - car.s, vt = Math.min(5, Math.sqrt(2 * 0.7 * Math.max(0, left - 0.2)));
        const gas = car.u < vt - 0.3 ? 1 : 0, brake = car.u > vt + 0.2 || left < 0.3 ? 1 : 0;
        H.step(dt, gas, brake);
        if (P.vehicle !== car) off++;
        if (Math.abs(car.u) < 0.02 && Math.abs(left) < 1.5) break;
      }
      out.atRoy = +(tr.h1 - car.s).toFixed(2);
      out.readoutRoy = L.hud.objective.textContent;
      for (let i = 0; i < 60; i++) H.step(dt, 0, 0);
      out.hooked = car.hitch;
      out.weightBefore = car.hitch ? L.weights[car.hitch].f : null;
      // up the counterbalance, full POWER, to the mark at Lee
      let vMax = 0, t = 0;
      for (; steps < 60000; steps++) {
        const left = tr.h2 - car.s, vt = Math.min(6, Math.sqrt(2 * 0.7 * Math.max(0, left - 0.2)));
        const gas = car.u < vt - 0.3 ? 1 : 0, brake = car.u > vt + 0.2 || left < 0.3 ? 1 : 0;
        H.step(dt, gas, brake);
        t += dt; vMax = Math.max(vMax, car.u);
        if (P.vehicle !== car) off++;
        if (car.s > tr.h1 + 200 && !out.mid) { out.mid = { s: Math.round(car.s - tr.h1), w: +L.weights[car.hitch || 'E'].f.toFixed(2), readout: L.hud.objective.textContent }; }
        if (Math.abs(car.u) < 0.02 && Math.abs(left) < 1.5) break;
      }
      out.climb = { secs: Math.round(t), vMaxMph: +(vMax * 2.237).toFixed(1), rise: +(car.cy - y0).toFixed(1), metres: Math.round(car.s - s0) };
      out.atLee = +(tr.h2 - car.s).toFixed(2);
      out.weightAtTop = out.hooked ? +L.weights[out.hooked].f.toFixed(2) : null;
      for (let i = 0; i < 60; i++) H.step(dt, 0, 0);
      out.unhooked = !car.hitch;
      out.offFrames = off;
      // step off
      const ok = P.exitVehicle();
      out.exit = { ok, onFoot: P.onFoot, driver: car.driver, mode: car.mode, btn: L.btn && L.btn.style.display, gap: +Math.hypot(P.x - car.cx, P.z - car.cz).toFixed(1) };
      // it carries on in service once you walk away (a car waits a minute
      // for anyone standing beside it): past Lee within a minute
      P.x += 120; P.y = d.city.groundAt(P.x, P.z, null);
      const sAt = car.s;
      for (let i = 0; i < 1800; i++) H.step(dt, 0, 0);
      out.resumed = Math.round(car.s - sAt);
      { const st = car.nextStop(); out.after = { s: Math.round(car.s), h2: Math.round(tr.h2), state: car.state, timer: +car.timer.toFixed(1), hill: car.hill, hitch: car.hitch, u: +car.u.toFixed(2), next: st && st.name, backoff: car.backoff, headOnT: +car.headOnT.toFixed(1), allowed: +car.allowed(st ? st.s.out : null, 0.9).toFixed(2), grade: +car.grade.toFixed(3) }; }
      d.game.paused = false;
      return out;
    })()`, false);
    console.log(JSON.stringify(r));
    check(r.boardable && r.aboard, 'on foot beside a car, ENTER boards it as the motorman');
    check(r.bell === 'BELL' && r.gasLabel === 'POWER' && r.btn === 'block', `buttons read POWER / BELL, RIDE shown (${r.gasLabel}, ${r.bell}, ${r.btn})`);
    check(Math.abs(r.atRoy) < 1.5, `stopped on the mark at Roy (${r.atRoy} m)`);
    check(!!r.hooked, `hooked onto a counterweight (${r.hooked}, it stood at ${r.weightBefore})`);
    check(r.climb.metres > 500 && r.climb.rise > 40, `climbed ${r.climb.metres} m and ${r.climb.rise} m up in ${r.climb.secs} s, at most ${r.climb.vMaxMph} mph`);
    check(r.mid && r.mid.w < 0.8, `the weight went down as the car went up (${r.mid && r.mid.w} at ${r.mid && r.mid.s} m)`);
    check(Math.abs(r.atLee) < 1.5 && r.weightAtTop < 0.02, `stopped on the mark at Lee (${r.atLee} m), the weight at the bottom (${r.weightAtTop})`);
    check(r.unhooked, 'unhooked at Lee');
    check(r.offFrames === 0, 'stayed aboard the whole way');
    check(r.exit.ok && r.exit.onFoot && r.exit.driver === null && r.exit.mode === 'service' && r.exit.btn === 'none', `stepped off cleanly (${JSON.stringify(r.exit)})`);
    check(r.resumed > 40, `the car carries on in service (${r.resumed} m in 60 s; ${JSON.stringify(r.after)})`);
    console.log('  readout at Roy:', r.readoutRoy);
    console.log('  readout on the hill:', r.mid && r.mid.readout);
  }

  // ---- slip: no counterweight, no climb ----
  if (want('slip')) {
    const r = await ev(`(() => {
      const d = __dbg, L = d.counterbal, P = d.player, H = __cb;
      d.game.paused = true;
      const car = L.cars[1], tr = L.tracks.out;
      H.clearHill(car);
      H.put(car, 'out', tr.h1 + 120);
      H.beside(car);
      P.enterVehicle(car);
      const s0 = car.s;
      for (let i = 0; i < 600; i++) H.step(1 / 30, 1, 0);
      const out = { moved: +(car.s - s0).toFixed(1), slip: car.slip, readout: L.hud.objective.textContent };
      // on the steepest block (18.6 %) not even full brake holds it: brakes
      // alone, the car's own physics, for 10 s
      let sx = tr.h1, gx = 0;
      for (let q = tr.h1 + 10; q < tr.h2 - 10; q += 2) { const g = (tr.y(q + 3.35) - tr.y(q - 3.35)) / 6.7; if (g > gx) { gx = g; sx = q; } }
      H.put(car, 'out', sx);
      const s1 = car.s;
      for (let i = 0; i < 300; i++) car.step(1 / 30, 0, 1);
      out.held = +(car.s - s1).toFixed(1); out.steepest = +(gx * 100).toFixed(1);
      P.exitVehicle(true);
      H.put(car, 'out', tr.zIn[0] - 200);
      d.game.paused = false;
      return out;
    })()`, false);
    console.log(JSON.stringify(r));
    check(r.moved <= 0.5, `full POWER on the hill with no counterweight goes nowhere (${r.moved} m in 20 s)`);
    check(r.held < -0.5, `nor do the brakes alone hold it on the steepest block, ${r.steepest}% (${r.held} m in 10 s)`);
  }

  // ---- ride: the crew drives ----
  if (want('ride')) {
    const r = await ev(`(() => {
      const d = __dbg, L = d.counterbal, P = d.player, H = __cb;
      d.game.paused = true;
      const car = L.cars[2], tr = L.tracks.in;
      H.clearHill(car);
      H.put(car, 'in', 300);
      H.beside(car);
      P.enterVehicle(car);
      L.toggleRide();
      const out = { mode: car.mode, btn: L.btn.textContent };
      let stops = 0, was = car.state;
      const s0 = car.s;
      for (let i = 0; i < 9000 && stops < 2; i++) { H.step(1 / 30, 0, 0); if (car.state === 'dwell' && was !== 'dwell') stops++; was = car.state; }
      out.stops = stops; out.moved = Math.round(car.s - s0);
      out.aboard = P.vehicle === car;
      out.readout = L.hud.objective.textContent;
      out.rider = P.h.group.visible && Math.hypot(P.h.group.position.x - car.cx, P.h.group.position.z - car.cz) < 7;
      L.toggleRide();
      out.back = car.mode;
      H.step(1 / 30, 0, 0);
      out.riderGone = !P.h.group.visible;
      P.exitVehicle(true);
      d.game.paused = false;
      return out;
    })()`, false);
    console.log(JSON.stringify(r));
    check(r.mode === 'ride' && r.btn === 'DRIVE ▸', 'RIDE hands the car to its crew');
    check(r.stops === 2 && r.aboard, `the crew drove you through two stops (${r.moved} m)`);
    check(r.back === 'drive', 'DRIVE takes the controls back');
    check(r.rider && r.riderGone, 'riding, you stand on the step; driving, you are in the cab');
    console.log('  riding readout:', r.readout);
  }

  // ---- traffic: an AI car behind a streetcar at its stop ----
  if (want('traffic')) {
    const r = await ev(`(async () => {
      const d = __dbg, L = d.counterbal, P = d.player, H = __cb, T = d.traffic;
      d.game.paused = true;
      const car = L.cars[3], tr = L.tracks.out;
      H.clearHill(car);
      // a stop on 1st Ave, the car standing on its mark
      const st = tr.stops.find((q) => q.name === 'Bell St');
      H.put(car, 'out', st.s.out);
      car.state = 'dwell'; car.stop = st; car.timer = 999; car.held = 0;
      L.update(0, d.camera);
      // you, on foot nearby (traffic lives round you)
      P.x = car.cx + 30; P.z = car.cz; P.y = d.city.groundAt(P.x, P.z, null);
      H.stream(car.cx, car.cz);
      // an AI car 45 m behind the streetcar, driving its way, routed on the road
      const f = car._fwd;
      const bx = car.cx - f.x * 45, bz = car.cz - f.z * 45;
      const ai = T.spawnAt(bx, bz, Math.atan2(f.x, f.z), 'sedan', 0x243b6b, 'traffic');
      ai.vLong = 9; ai.panic = 0; ai.drvK = 1; ai.prio = ++T._prio;
      const out = { ai: ai.typeName, routed: T.snapRoute(ai) };
      let minGap = Infinity, inside = 0;
      for (let i = 0; i < 900; i++) {
        T.update(1 / 30, P.x, P.z, { x: 0, z: 1 }, P);
        L.update(1 / 30, d.camera);
        const dx = ai.x - car.cx, dz = ai.z - car.cz, a = dx * f.x + dz * f.z, b = dx * f.z - dz * f.x;
        if (Math.abs(b) < 2.5) minGap = Math.min(minGap, -a - 6.7 - (ai.halfLen || 2.2));
        if (Math.abs(a) < 6.7 + (ai.halfLen || 2.2) - 0.2 && Math.abs(b) < 1.27 + (ai.halfWid || 0.9) - 0.2) inside++;
      }
      out.minGap = +minGap.toFixed(2); out.inside = inside;
      out.aiSpeed = +Math.abs(ai.vLong).toFixed(2);
      out.blocks = L.blocks(car.cx - f.x * 7.5, car.cz - f.z * 7.5, car.cy);
      car.timer = 1;
      d.game.paused = false;
      return out;
    })()`);
    console.log(JSON.stringify(r));
    check(r.blocks, 'traffic sees a streetcar standing at its stop');
    check(r.inside === 0, `the AI car never drives into the streetcar (${r.inside} frames inside; nearest ${r.minGap} m)`);
  }

  // ---- exit paths: death aboard, WASTED, respawn ----
  if (want('exit')) {
    const r = await ev(`(async () => {
      const d = __dbg, L = d.counterbal, P = d.player, H = __cb;
      const car = L.cars[0];
      H.put(car, car.track.key, Math.min(car.track.len - 30, car.track.zIn[0] - 400));
      H.beside(car);
      P.enterVehicle(car);
      d.game.paused = false;
      d.game.damagePlayer(999, 'crash');
      for (let i = 0; i < 80 && d.game.dead; i++) await new Promise((r) => setTimeout(r, 250));
      if (d.game.dead) d.doRespawn();
      await new Promise((r) => setTimeout(r, 600));
      return { onFoot: P.onFoot, vehicle: !!P.vehicle, driver: car.driver, mode: car.mode, btn: L.btn.style.display,
        horn: document.querySelector('[data-btn="horn"]').textContent, objective: L.hud.objective.textContent };
    })()`);
    console.log(JSON.stringify(r));
    check(r.onFoot && !r.vehicle && r.driver === null && r.mode === 'service' && r.btn === 'none', 'WASTED aboard: respawned on foot, the car back in service, RIDE gone');
    check(!/^\d{3} · /.test(r.objective), "the motorman's readout is cleared");
    // a warp off the map (respawn without an exit) leaves nothing either
    const w = await ev(`(async () => {
      const d = __dbg, L = d.counterbal, P = d.player, H = __cb;
      const car = L.cars[0];
      H.beside(car); P.enterVehicle(car);
      P.respawn(P.x + 200, P.z);
      await new Promise((r) => setTimeout(r, 800));
      return { driver: car.driver, btn: L.btn.style.display };
    })()`);
    check(w.driver === null && w.btn === 'none', `a warp from the cab leaves no state (${JSON.stringify(w)})`);
  }

  // ---- robust: what a player does to it ----
  if (want('robust')) {
    const r = await ev(`(() => {
      const d = __dbg, L = d.counterbal, P = d.player, H = __cb, T = L.tracks;
      d.game.paused = true;
      if (P.vehicle) P.exitVehicle(true);
      const out = {};
      const overlap = () => { let n = 0; for (let a = 0; a < L.cars.length; a++) for (let b = a + 1; b < L.cars.length; b++) { const p = L.cars[a], q = L.cars[b]; const dx = q.cx - p.cx, dz = q.cz - p.cz; if (Math.hypot(dx, dz) < 12 && Math.abs(dx * p._fwd.z - dz * p._fwd.x) < 2.2) n++; } return n; };
      // (a) NOSE TO NOSE: A climbing hooked on W (the in track's rails), B
      // standing unhooked on its own W rails 45 m up the hill, facing down
      const A = L.cars[0], B = L.cars[2];
      H.clearHill(A); H.clearHill(B);
      for (const P2 of ['E', 'W']) { L.weights[P2].car = null; }
      H.put(A, 'out', T.out.h1 + 150); A.hill = 'W'; A.hitch = 'W'; L.weights.W.car = A; L.weights.W.f = 1 - 150 / (T.out.h2 - T.out.h1);
      A._point();
      const pt = A.pointAt(A.s + 45 + 13.4, {}), q = T.in.nearest(pt.x, pt.z, 15);
      H.put(B, 'in', q.s); B._point();
      out.headOn = { aS: Math.round(A.s), bS: Math.round(B.s), same: !!L.sameRails(A, B) };
      let maxOv = 0, t = 0, aTop = null;
      for (; t < 400; t += 0.1) { L._service(0.1); maxOv = Math.max(maxOv, overlap()); if (aTop === null && A.s > T.out.h2 - 3) aTop = Math.round(t); }
      out.headOn.aTop = aTop; out.headOn.overlap = maxOv; out.headOn.bNow = Math.round(B.s); out.headOn.bState = B.state; out.headOn.wW = +L.weights.W.f.toFixed(2);
      // (b) ABANDONED unhooked mid-hill, as a player who bails out of a runaway
      const C = L.cars[1];
      H.clearHill(C);
      L.weights.E.car = null; L.weights.W.car = null;
      H.put(C, 'in', T.in.h1 + 260);
      H.beside(C); P.enterVehicle(C); for (let i = 0; i < 30; i++) H.step(1 / 30, 0, 0); P.exitVehicle(true);
      const c0 = C.s, stops = L.cars.map(() => 0), was = L.cars.map((c) => c.state);
      for (let i = 0; i < 3600; i++) { L._service(0.1); L.cars.forEach((c, j) => { if (c.state === 'dwell' && was[j] !== 'dwell') stops[j]++; was[j] = c.state; }); maxOv = Math.max(maxOv, overlap()); }
      out.abandoned = { moved: Math.round(C.s - c0), track: C.track.key, stopsAfter: stops, overlap: maxOv, towed: L.towed || 0 };
      // (c) POWER downhill at Lee with no weight at the bottom
      const D = L.cars[3];
      H.clearHill(D);
      L.weights.E.f = 1; L.weights.W.f = 1; L.weights.E.car = null; L.weights.W.car = null;
      H.put(D, 'in', T.in.h1 - 40);
      H.beside(D); P.enterVehicle(D);
      for (let i = 0; i < 900; i++) H.step(1 / 30, 1, 0);
      out.descent = { past: +(D.s - T.in.h1).toFixed(2), u: +D.u.toFixed(2), hitch: D.hitch, readout: L.hud.objective.textContent };
      P.exitVehicle(true);
      // (d) BRAKE alone, and no pedal at all, at the Roy mark with no weight
      L.weights.E.f = 0; L.weights.W.f = 0;
      H.clearHill(D);
      H.put(D, 'out', T.out.h1);
      H.beside(D); P.enterVehicle(D);
      const s1 = D.s;
      for (let i = 0; i < 390; i++) H.step(1 / 30, 0, 0);
      const free = +(D.s - s1).toFixed(2);
      const g0 = +(D.grade * 100).toFixed(1);
      for (let i = 0; i < 30; i++) H.step(1 / 30, 0, 1);   // (1 s: held BRAKE becomes reverse only at 1.2 s)
      out.hold = { noPedal: free, brakeHeld: +(D.s - s1).toFixed(2), grade: g0 };
      // (e) hooking on 0.8 m short of the mark: no jump, and it stays on
      L.weights.E.f = 1;
      H.put(D, 'out', T.out.h1 - 0.8); D.hill = null;
      const s2 = D.s;
      for (let i = 0; i < 90; i++) H.step(1 / 30, 0, 0);
      const hooked = D.hitch;
      for (let i = 0; i < 90; i++) H.step(1 / 30, 0, 0);
      out.hookShort = { hooked, still: D.hitch, jump: +(D.s - s2).toFixed(2) };
      P.exitVehicle(true);
      // (f) ENTER at a stop's post: the car standing at that stop boards
      const st = L.stops.find((x) => x.name === 'Bell St'), E2 = L.cars[2];
      H.put(E2, st.track, st.s[st.track]); E2.state = 'dwell'; E2.stop = st; E2.timer = 30; E2.u = 0;
      P.x = st.x; P.z = st.z; P.y = d.city.groundAt(st.x, st.z, null);
      out.post = { boards: L.boardable(P.x, P.y, P.z) === E2, gap: +Math.hypot(st.x - E2.cx, st.z - E2.cz).toFixed(1) };
      E2.timer = 1;
      // (h) THE CHECKER'S JAM: you, coming down to Lee, while a crew car
      // climbs to Lee hooked on your cable (W). The signal holds you at the
      // gate; the climber arrives and unhooks.
      {
        const A = L.cars[0], Y = L.cars[1];
        H.clearHill(A); H.clearHill(Y);
        for (const W of ['E', 'W']) L.weights[W].car = null;
        L.weights.E.f = 1;   // (E is at the top: no use to a car going down)
        H.put(A, 'out', T.out.h1 + 300); A.hill = 'W'; A.hitch = 'W'; L.weights.W.car = A; L.weights.W.f = 1 - 300 / (T.out.h2 - T.out.h1); A._point();
        H.put(Y, 'in', T.in.gate - 60);
        H.beside(Y); P.enterVehicle(Y);
        let arrived = null;
        let held = -Infinity;
        for (let i = 0; i < 30 * 200 && arrived === null; i++) { H.step(1 / 30, 1, 0); if (A.hitch) held = Math.max(held, Y.s - T.in.gate); if (!A.hitch && A.s > T.out.h2 - 3) arrived = Math.round(i / 30); }
        out.signal = { held: +held.toFixed(2), arrived, msg: (L._said && Object.keys(L._said).includes('signal')) };
        // now the cable is yours: drive to the mark, hook on, go down
        let hooked = null;
        for (let i = 0; i < 30 * 120 && !Y.hitch; i++) { const left = T.in.h1 - Y.s, vt = Math.min(4, Math.sqrt(2 * 0.6 * Math.max(0, left - 0.2))); H.step(1 / 30, Y.u < vt - 0.3 ? 1 : 0, Y.u > vt + 0.2 || left < 0.3 ? 1 : 0); if (Y.hitch) hooked = Y.hitch; }
        out.signal.hooked = hooked;
        P.exitVehicle(true);
        // and placed ON the Lee mark with the climber coming: hold BRAKE and you back up out of its way
        H.clearHill(A); H.clearHill(Y);
        for (const W of ['E', 'W']) L.weights[W].car = null;
        H.put(A, 'out', T.out.h1 + 450); A.hill = 'W'; A.hitch = 'W'; L.weights.W.car = A; L.weights.W.f = 1 - 450 / (T.out.h2 - T.out.h1); A._point();
        H.put(Y, 'in', T.in.h1); Y.hill = null;
        H.beside(Y); P.enterVehicle(Y);
        for (let i = 0; i < 30 * 8; i++) H.step(1 / 30, 0, 0);
        const said = L.hud.toast.textContent;
        const y0 = Y.s;
        for (let i = 0; i < 30 * 12; i++) H.step(1 / 30, 0, 1);
        out.backUp = { moved: +(Y.s - y0).toFixed(1), said };
        let arr2 = null;
        for (let i = 0; i < 30 * 200 && arr2 === null; i++) { H.step(1 / 30, 0, 0); if (!A.hitch && A.s > T.out.h2 - 3) arr2 = Math.round(i / 30); }
        out.backUp.arrived = arr2;
        P.exitVehicle(true);
      }
      // (g) after all of it, the service: every car makes stops again
      const stops2 = L.cars.map(() => 0), was2 = L.cars.map((c) => c.state);
      for (let i = 0; i < 4800; i++) { L._service(0.1); L.cars.forEach((c, j) => { if (c.state === 'dwell' && was2[j] !== 'dwell') stops2[j]++; was2[j] = c.state; }); maxOv = Math.max(maxOv, overlap()); }
      out.after = { stops: stops2, overlap: maxOv, towed: L.towed || 0, weights: [+L.weights.E.f.toFixed(2), +L.weights.W.f.toFixed(2)] };
      d.game.paused = false;
      return out;
    })()`, false);
    console.log(JSON.stringify(r));
    check(r.headOn.same, 'a car on the other cable is seen on these rails');
    check(r.headOn.aTop !== null && r.headOn.overlap === 0, `nose to nose on the W rails: the car off the cable gives way, the climber reaches Lee in ${r.headOn.aTop} s, never overlapping`);
    check(Math.abs(r.abandoned.moved) > 50 || r.abandoned.track !== 'in', `a car abandoned unhooked mid-hill does not stay there (${JSON.stringify(r.abandoned)})`);
    check(r.abandoned.stopsAfter.filter((n) => n > 0).length >= 3, `the line keeps running after it (${r.abandoned.stopsAfter})`);
    check(r.descent.past <= 1.05 && Math.abs(r.descent.u) < 0.05 && !r.descent.hitch, `POWER downhill toward Lee with no weight: held at the signal or the stop block (${r.descent.past} m from the mark)`);
    console.log('  readout at the block:', r.descent.readout);
    check(Math.abs(r.hold.noPedal) < 0.3 && Math.abs(r.hold.brakeHeld) < 0.3, `at the Roy mark (${r.hold.grade}%), no pedal holds 13 s and BRAKE holds until it means reverse (${r.hold.noPedal} / ${r.hold.brakeHeld} m)`);
    check(!!r.hookShort.hooked && r.hookShort.still && Math.abs(r.hookShort.jump) < 0.1, `hooked on 0.8 m short: no jump (${r.hookShort.jump} m), still hooked 3 s on`);
    check(r.signal.held <= 0.5 && r.signal.arrived !== null, `coming down to Lee while a car climbs your cable: the signal holds you at the gate (${r.signal.held} m), the climber unhooks at Lee after ${r.signal.arrived} s`);
    check(!!r.signal.hooked, `then the cable is yours: hooked on at Lee (${r.signal.hooked})`);
    check(r.backUp.moved < -3 && r.backUp.arrived !== null, `on the Lee mark with the climber coming, BRAKE held backs you up (${r.backUp.moved} m) and it arrives (${r.backUp.arrived} s): "${r.backUp.said}"`);
    check(r.post.boards, `ENTER at the stop's post boards the car at the stop (${r.post.gap} m away)`);
    check(r.after.stops.every((n) => n >= 2) && r.after.overlap === 0, `8 min later every car is making stops (${r.after.stops}), no overlaps, ${r.after.towed} towed`);
  }

  // ---- fuzz: stop finding jams one at a time ----
  if (want('fuzz')) {
    const SEEDS = +(process.env.CB_FUZZ_SEEDS || 40), MIN = +(process.env.CB_FUZZ_MIN || 15), FROM = +(process.env.CB_FUZZ_FROM || 1);
    const fails = [];
    let tried = 0;
    for (let seed = FROM; seed < FROM + SEEDS; seed++) {
      const r = await ev(`(() => {
        const d = __dbg, L = d.counterbal, P = d.player, H = __cb, T = L.tracks, CBn = 13.4;
        let a = ${seed} * 2654435761 >>> 0;
        const rng = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const pick = (arr) => arr[Math.floor(rng() * arr.length)];
        d.game.paused = true;
        if (P.vehicle) P.exitVehicle(true);
        for (const c of L.cars) { if (c.hitch) L.unhitch(c); c.hill = null; c.hitch = null; c.backoff = false; c.headOnT = 0; c.stuckT = 0; c.driver = null; c.mode = 'service'; c.u = 0; c._ghost = false; }
        L.towed = 0;
        for (const W of ['E', 'W']) { L.weights[W].car = null; L.weights[W].f = pick([0, 1, 1, 0, 0.5]); }
        const spots = (tr) => [...tr.stops.map((st) => st.s[tr.key]), tr.h1, tr.h2, tr.h1 - 0.8, tr.h1 + 0.8, tr.zIn[0] - 10, (tr.zIn[0] + tr.zIn[1]) / 2, (tr.zOut[0] + tr.zOut[1]) / 2, (tr.h1 + tr.h2) / 2, tr.h1 + 150, tr.h2 - 60, CBn / 2 + 1, tr.len - CBn / 2 - 1, 20 + rng() * (tr.len - 40)];
        const placed = [];
        for (const c of L.cars) {
          for (let k = 0; k < 40; k++) {
            const tr = T[pick(['out', 'in'])], sp = Math.max(CBn / 2 + 0.6, Math.min(tr.len - CBn / 2 - 0.6, pick(spots(tr)) + (rng() < 0.5 ? (rng() - 0.5) * 6 : 0)));
            c.track = tr; c.hill = null; c.place(sp);
            if (placed.some((o) => Math.hypot(o.cx - c.cx, o.cz - c.cz) < 16)) continue;
            c.state = 'run'; c.lastStop = null; c.stop = null; c.timer = 0;
            const st = c.stopHere();
            if (st && rng() < 0.5) { c.state = 'dwell'; c.stop = st; c.lastStop = st; c.timer = rng() * 10; c.held = 0; }
            if (sp > tr.zIn[0] && sp < tr.zOut[1] && rng() < 0.7) {
              const want = pick([tr.side, tr.side === 'E' ? 'W' : 'E']);
              c.hill = L.free(want, c) || rng() < 0.15 ? want : null;   // (now and then an illegal one, as a stranded car leaves it)
              c._point();
              if (placed.some((o) => Math.hypot(o.cx - c.cx, o.cz - c.cz) < 16)) { c.hill = null; c._point(); }
              const W = c.hill && L.weights[c.hill];
              if (W && !W.car && sp >= tr.h1 - 0.9 && sp <= tr.h2 + 0.9 && rng() < 0.6) { c.hitch = c.hill; W.car = c; W.f = Math.max(0, Math.min(1, 1 - (sp - tr.sBot) / (tr.sTop - tr.sBot))); }
            }
            c._point(); c.pose();
            placed.push(c);
            break;
          }
        }
        // you: away (0), board, fiddle and leave, standing by (1), or board and stay (2)
        const mode = Math.floor(rng() * 3), X = pick(L.cars);
        const inputs = [];
        if (mode === 0) { const S = d.G.SPAWN; P.x = S.x; P.z = S.z; P.y = d.city.groundAt(S.x, S.z, null); }
        else {
          H.beside(X); P.enterVehicle(X);
          for (let k = 0; k < 4; k++) {
            const what = pick(['power', 'brake', 'idle', 'reverse']), n = Math.floor(15 + rng() * 60);
            inputs.push(what);
            for (let i = 0; i < n; i++) H.step(1 / 30, what === 'power' ? 1 : 0, what === 'brake' || what === 'reverse' ? 1 : 0);
          }
          if (mode === 1) { P.exitVehicle(true); const f = X._fwd; P.x = X.cx - f.z * 6; P.z = X.cz + f.x * 6; P.y = d.city.groundAt(P.x, P.z, null); }
        }
        d.camera.position.set(P.x, (P.y || 0) + 3, P.z);
        const start = L.cars.map((c) => ({ id: c.number, track: c.track.key, s: Math.round(c.s), state: c.state, hill: c.hill, hitch: c.hitch }));
        const prog = L.cars.map(() => 0), was = L.cars.map((c) => ({ state: c.state, on: false }));
        let overlap = null;
        const steps = ${MIN} * 600;
        for (let i = 0; i < steps; i++) {
          L.update(0.1, d.camera);
          L.cars.forEach((c, j) => {
            const tr = c.track, on = c.s > tr.h1 + 5 && c.s < tr.h2 - 5;
            if ((c.state === 'dwell' && was[j].state !== 'dwell') || (!on && was[j].on && c.s > tr.h2 - 6)) prog[j]++;
            was[j].state = c.state; was[j].on = on;
            // the longest it stood, and what it stood for
            if (Math.abs(c.u) < 0.05) { was[j].w = (was[j].w || 0) + 0.1; if (!was[j].mx || was[j].w > was[j].mx[0]) { const fc = c.facingCar(); const ah = L.cars.find((o) => o !== c && (() => { const r = L.sameRails(c, o); return r && r.s > c.s && r.s - c.s < 40; })()); was[j].mx = [Math.round(was[j].w), Math.round(i / 10), tr.key, Math.round(c.s), c.state, c.hill, c.hitch, c.backoff, fc && fc.number, ah && ah.number, c._why, +L.weights.E.f.toFixed(2), L.weights.E.car && L.weights.E.car.number, +L.weights.W.f.toFixed(2), L.weights.W.car && L.weights.W.car.number]; } } else was[j].w = 0;
          });
          if (!overlap) for (let x = 0; x < L.cars.length; x++) for (let y = x + 1; y < L.cars.length; y++) {
            const p = L.cars[x], q = L.cars[y], dx = q.cx - p.cx, dz = q.cz - p.cz;
            if (dx * dx + dz * dz > 200) continue;
            let pen = Infinity;
            for (const ax of [p._fwd, { x: p._fwd.z, z: -p._fwd.x }, q._fwd, { x: q._fwd.z, z: -q._fwd.x }]) {
              const ra = 6.7 * Math.abs(p._fwd.x * ax.x + p._fwd.z * ax.z) + 1.27 * Math.abs(p._fwd.z * ax.x - p._fwd.x * ax.z);
              const rb = 6.7 * Math.abs(q._fwd.x * ax.x + q._fwd.z * ax.z) + 1.27 * Math.abs(q._fwd.z * ax.x - q._fwd.x * ax.z);
              pen = Math.min(pen, ra + rb - Math.abs(dx * ax.x + dz * ax.z));
            }
            if (pen > 0.15) overlap = { t: +(i / 10).toFixed(1), a: [p.number, p.track.key, Math.round(p.s), p.state, p.hill, p.hitch, +p.u.toFixed(1)], b: [q.number, q.track.key, Math.round(q.s), q.state, q.hill, q.hitch, +q.u.toFixed(1)], pen: +pen.toFixed(2) };
          }
        }
        const out = { seed: ${seed}, mode, inputs, start, prog, overlap, towed: L.towed || 0 };
        out.end = L.cars.map((c) => [c.number, c.track.key, Math.round(c.s), c.state, c.hill, c.hitch, +c.u.toFixed(1), c.backoff, c.driver]);
        out.weights = [+L.weights.E.f.toFixed(2), +L.weights.W.f.toFixed(2), L.weights.E.car && L.weights.E.car.number, L.weights.W.car && L.weights.W.car.number];
        // the AI cars must have got somewhere (all of them with you out of it)
        out.stuck = L.cars.filter((c, j) => c.driver !== 'player' && prog[j] === 0).map((c) => c.number);
        out.longest = L.cars.map((c, j) => [c.number, ...(was[j].mx || [])]);
        out.detail = L.cars.filter((c, j) => prog[j] === 0).map((c) => { const st = c.nextStop(); return { n: c.number, next: st && st.name, nextS: st && +(st.s[c.track.key] - c.s).toFixed(2), last: c.lastStop && c.lastStop.name, timer: +c.timer.toFixed(1), len: Math.round(c.track.len), mode: c.mode, headOnT: +c.headOnT.toFixed(1), stuckT: Math.round(c.stuckT || 0) }; });
        if (mode === 2) {
          // and you can always get your car moving, one way or the other
          // (from a stand: the idle run left it as it was, rolling or not)
          for (let i = 0; i < 60; i++) H.step(1 / 30, 0, 0);
          const s0 = X.s;
          for (let i = 0; i < 240; i++) H.step(1 / 30, 1, 0);
          const fwd = X.s - s0, s1 = X.s;
          for (let i = 0; i < 60; i++) H.step(1 / 30, 0, 0);
          const s2 = X.s;
          for (let i = 0; i < 300; i++) H.step(1 / 30, 0, 1);
          out.mobile = [+fwd.toFixed(1), +(X.s - s2).toFixed(1)];
          out.mobDbg = { rev: +X._revT.toFixed(1), u: +X.u.toFixed(2), grade: +X.grade.toFixed(3), slip: X.slip, others: L.cars.filter((o) => o !== X).map((o) => { const r = L.sameRails(X, o); return [o.number, r && Math.round(r.s - X.s), r && +r.off.toFixed(2), o.backoff, Math.round(o.s)]; }) };
          P.exitVehicle(true);
        }
        d.game.paused = false;
        return out;
      })()`, false);
      tried++;
      const bad = r.overlap || (r.mode !== 2 && r.stuck.length) || (r.mode === 2 && Math.max(Math.abs(r.mobile[0]), Math.abs(r.mobile[1])) < 2);
      if (bad) { fails.push(r); console.log('  FUZZ', JSON.stringify(r)); }
    }
    check(fails.length === 0, `fuzz: ${tried} seeds from ${FROM}, ${process.env.CB_FUZZ_MIN || 15} sim min each: ${fails.length} found a jam or an overlap${fails.length ? ' (seeds ' + fails.map((f) => f.seed).join(',') + ')' : ''}`);
  }

  // ---- perf: draws and triangles the line adds, far and near ----
  if (want('perf')) {
    const r = await ev(`(async () => {
      const d = __dbg, L = d.counterbal, P = d.player, H = __cb, R = d.renderer;
      if (P.vehicle) P.exitVehicle(true);
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const measure = async () => {
        const on = { calls: 0, tris: 0 };
        for (let k = 0; k < 3; k++) { await frame(); on.calls += d.sceneStats.calls; on.tris += d.sceneStats.tris || 0; }
        return { calls: Math.round(on.calls / 3), tris: Math.round(on.tris / 3) };
      };
      // what of the line is in the view frustum: chunk meshes, car bodies, car trim
      const mine = () => {
        const fr = new d.THREE.Frustum().setFromProjectionMatrix(new d.THREE.Matrix4().multiplyMatrices(d.camera.projectionMatrix, d.camera.matrixWorldInverse));
        const inView = (m) => { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); const sp = m.geometry.boundingSphere.clone().applyMatrix4(m.matrixWorld); return fr.intersectsSphere(sp); };
        const out = { chunks: 0, bodies: 0, trims: 0, tris: 0 };
        for (const e of L.chunks) if (e.mesh.visible && inView(e.mesh)) { out.chunks++; out.tris += e.mesh.geometry.index.count / 3; }
        for (const c of L.cars) if (c.group.visible) c.meshes.forEach((m, i) => { if (m.visible && inView(m)) { out[i ? 'trims' : 'bodies']++; out.tris += m.geometry.index.count / 3; } });
        out.tris = Math.round(out.tris);
        return out;
      };
      const at = async (x, z, tx, tz) => {
        d.game.paused = true;
        P.x = x; P.z = z; P.y = d.city.groundAt(x, z, null);
        H.stream(x, z, 60);
        const y = P.y + 1.7;
        H.cam(x, y, z, tx, y, tz, 60);
        const m = mine();
        const withIt = await measure();
        const vis = [L.group.visible, ...L.cars.map((c) => c.group.visible)];
        L.group.visible = false; for (const c of L.cars) c.group.visible = false;
        const without = await measure();
        L.group.visible = vis[0]; L.cars.forEach((c, i) => { c.group.visible = vis[i + 1]; });
        return { mine: m, calls: withIt.calls - without.calls, tris: withIt.tris - without.tris, total: withIt.calls };
      };
      const S = d.G.SPAWN;
      const out = {};
      out.spawn = await at(S.x, S.z, S.x + Math.sin(d.G.SPAWN_HEADING) * 50, S.z + Math.cos(d.G.SPAWN_HEADING) * 50);
      const tr = L.tracks.in, s = tr.sBot + 40;
      // one car at the foot, in view; the rest far off
      H.clearHill(L.cars[1]);
      H.put(L.cars[1], 'in', tr.sBot - 60);
      out.hill = await at(tr.x(s) + 3, tr.z(s), tr.x(tr.sBot - 200), tr.z(tr.sBot - 200));
      // and from 1st Ave by Pike Place Market, a car at its stop
      const to = L.tracks.out, sp = to.stops.find((q) => q.name === 'Pike Place Market').s.out;
      H.put(L.cars[2], 'out', sp);
      out.pike = await at(to.x(sp - 40) + 4, to.z(sp - 40), to.x(sp + 100), to.z(sp + 100));
      d.game.paused = false;
      return out;
    })()`);
    console.log(JSON.stringify(r));
    check(r.spawn.calls <= 4, `from the spawn (330 m from 1st Ave N): +${r.spawn.calls} draws, +${r.spawn.tris} triangles (${JSON.stringify(r.spawn.mine)})`);
    check(r.hill.calls <= 4, `at the foot of the hill, a car in view: +${r.hill.calls} draws, +${r.hill.tris} triangles (${JSON.stringify(r.hill.mine)})`);
    check(r.pike.calls <= 4, `on 1st Ave at Pike, a car at the stop: +${r.pike.calls} draws, +${r.pike.tris} triangles (${JSON.stringify(r.pike.mine)})`);
  }

  // ---- shots ----
  if (want('shots')) {
    const views = await ev(`(() => {
      const d = __dbg, L = d.counterbal, tr = L.tracks.out, tin = L.tracks.in;
      const pt = (t, s, up = 0) => ({ x: t.x(s), y: t.y(s) + up, z: t.z(s) });
      return {
        foot: { at: pt(tin, tin.sBot + 40, 1.7), look: pt(tin, tin.sBot - 160, 26) },
        top: { at: pt(tin, tin.h1 - 30, 1.7), look: pt(tin, tin.h1 + 220, -8) },
        air: { c: pt(tr, tr.len * 0.55, 0) },
        h1: tr.h1, h2: tr.h2,
      };
    })()`, false);
    const pose = async (v, fov = 60) => ev(`(() => { const H = __cb; H.stream(${v.at.x}, ${v.at.z}); H.cam(${v.at.x}, ${v.at.y}, ${v.at.z}, ${v.look.x}, ${v.look.y}, ${v.look.z}, ${fov}); return true; })()`, false);
    // put a car on the hill and one at the top for the views
    await ev(`(() => {
      const d = __dbg, L = d.counterbal, H = __cb, P = d.player;
      if (P.vehicle) P.exitVehicle(true);
      d.game.paused = true;
      const tr = L.tracks.out, tin = L.tracks.in;
      L.weights.E.f = 1; L.weights.E.car = null; L.weights.W.f = 0; L.weights.W.car = null;
      H.put(L.cars[0], 'out', tr.h1 + 90); L.cars[0].hill = 'E'; L.cars[0].hitch = 'E'; L.weights.E.car = L.cars[0];
      H.put(L.cars[1], 'in', tin.h1 + 60); L.cars[1].hill = 'W'; L.cars[1].hitch = 'W'; L.weights.W.car = L.cars[1];
      P.x = tr.x(tr.h1 - 45) + 6; P.z = tr.z(tr.h1 - 45); P.y = d.city.groundAt(P.x, P.z, null);
      for (const c of L.cars) { c.pose(); c.group.visible = true; }
      return true;
    })()`, false);
    await pose(views.foot, 42);
    await shot('foot-of-the-hill');
    await pose(views.top);
    await shot('top-of-the-hill');
    // mid-climb from the car: boarded, POWER for a while, the chase camera's own rig
    await ev(`(() => {
      const d = __dbg, L = d.counterbal, P = d.player, H = __cb;
      const car = L.cars[0];
      H.beside(car); P.enterVehicle(car);
      for (let i = 0; i < 240; i++) { H.step(1 / 30, 1, 0); P.updateCamera(1 / 30, H.input(1, 0)); }
      for (let i = 0; i < 90; i++) { H.step(1 / 30, 0.6, 0); P.updateCamera(1 / 30, H.input(0.6, 0)); }
      H.stream(car.cx, car.cz);
      P.applyCamera(d.camera);
      d.camera.updateMatrixWorld(true);
      return true;
    })()`, false);
    await shot('mid-climb-from-the-car');
    // riding: the crew drives, and the camera looks back down the hill at the city
    await ev(`(() => {
      const d = __dbg, L = d.counterbal, P = d.player, H = __cb;
      const car = L.cars[0];
      if (car.mode !== 'ride') L.toggleRide();
      P.lookT = 99;
      for (let i = 0; i < 200; i++) { H.step(1 / 30, 0, 0); P.lookT = 99; P.updateCamera(1 / 30, H.input(0, 0)); }
      P.applyCamera(d.camera);
      d.camera.updateMatrixWorld(true);
      window.__cbRig = car._rig;
      return true;
    })()`, false);
    await shot('riding-the-hill-view');
    check(await ev('window.__cbRig', false), 'riding the counterbalance, the camera turns to the view down the hill');
    // a side view of the car on the hill: the grade in its tilt
    await ev(`(() => {
      const d = __dbg, L = d.counterbal, H = __cb, c = L.cars[0];
      const f = c._fwd, rx = -f.z, rz = f.x;
      const x = c.cx - f.x * 17 + rx * 4.5, z = c.cz - f.z * 17 + rz * 4.5;
      H.cam(x, d.city.groundAt(x, z, null) + 2.0, z, c.cx, c.cy + 1.8, c.cz, 50);
      return true;
    })()`, false);
    await shot('car-on-the-hill-side');
    await ev(`(() => { const L = __dbg.counterbal; if (L.cars[0].mode === 'ride') L.toggleRide(); return true; })()`, false);
    // the car close, three-quarter front, at a stop downtown
    await ev(`(() => {
      const d = __dbg, L = d.counterbal, H = __cb, P = d.player;
      if (P.vehicle) P.exitVehicle(true);
      d.game.paused = true;
      const tr = L.tracks.out, st = tr.stops.find((q) => q.name === 'Pike Place Market');
      const c = L.cars[2];
      H.put(c, 'out', st.s.out); c.pose(); c.group.visible = true;
      H.stream(c.cx, c.cz);
      const f = c._fwd, rx = -f.z, rz = f.x;
      H.cam(c.cx + f.x * 11 + rx * 6, c.cy + 2.0, c.cz + f.z * 11 + rz * 6, c.cx, c.cy + 1.7, c.cz, 50);
      return true;
    })()`, false);
    await shot('car-close-pike');
    // the plaque and the attendant's box at Roy
    await ev(`(() => {
      const d = __dbg, L = d.counterbal, H = __cb;
      const q = L.plaqueAt[0], tr = L.tracks.out, h = tr.heading(tr.sBot), rx = -Math.cos(h), rz = Math.sin(h);
      const y = d.city.groundAt(q.x, q.z, null);
      H.cam(q.x - rx * 4.5 - Math.sin(h) * 2, y + 1.7, q.z - rz * 4.5 - Math.cos(h) * 2, q.x, y + 1.5, q.z, 50);
      return true;
    })()`, false);
    await shot('plaque-at-roy');
    // the whole route from the air
    await ev(`(() => {
      const d = __dbg, L = d.counterbal, H = __cb;
      const tr = L.tracks.out;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let s = 0; s < tr.len; s += 20) { x0 = Math.min(x0, tr.x(s)); x1 = Math.max(x1, tr.x(s)); z0 = Math.min(z0, tr.z(s)); z1 = Math.max(z1, tr.z(s)); }
      // a drone over Roy St, looking up the counterbalance to Lee
      const sx = tr.x(tr.h1 - 70), sz = tr.z(tr.h1 - 70), sy = tr.y(tr.h1 - 70);
      H.stream(sx, sz);
      const m = tr.h1 + 260;
      H.cam(sx + 8, sy + 42, sz, tr.x(m), tr.y(m), tr.z(m), 55);
      // every chunk drawn, for the aerial
      for (const e of L.chunks) e.mesh.visible = true;
      return true;
    })()`, false);
    await shot('drone-up-the-counterbalance');
    // and the full map: the line, its stops, the cars
    await ev(`(() => { document.getElementById('minimapWrap').click(); return __dbg.game.mapOpen; })()`, false);
    await shot('full-map');
    await ev('(__dbg.game.paused = false, true)', false);
  }

  const bad = logs.filter((l) => /EXCEPTION/.test(l));
  check(bad.length === 0, `no console exceptions${bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''}`);
  const warns = logs.filter((l) => /counterbalance/.test(l));
  if (warns.length) console.log(warns.join('\n'));
} finally {
  chrome.kill('SIGKILL');
}
console.log(fails ? `\nFAIL: ${fails}` : '\nOK');
process.exitCode = fails ? 1 : 0;
