// Auto KW: how YOUR car drives, measured. The player's road vehicles, stepped
// at a fixed 60 Hz through Vehicle.update with the player's detailed model on
// (setDetailed(true): the tyre model, the suspension, the PLAYER_BITE lock),
// on flat ground (city.groundAt / roadLift stubbed, restored afterwards).
//
//   node tools/kw/drivetest.mjs [types] [--json out.json] [--compare before.json]
//     types        comma list (default sedan,sports,pickup,compact,bus)
//     AUTO_HTTP_PORT / AUTO_CDP_PORT as every harness; AUTO_GPU=1 boots faster
//
// What it reports, per type (all at fixed dt, wall clock is irrelevant):
//   0-100       s from rest at full throttle (0-80 for a vehicle topping out
//               under 110, 0-50 under 70), the input a touch GAS button gives
//   top         km/h after 100 s flat out
//   100-0       m, full BRAKE from 100 km/h; `dev` the sideways drift (m)
//   dive/squat  the body's pitch (deg) under that stop / the launch
//   lat@N       steady-state lateral g with FULL digital lock held at N km/h
//               (speed held by a cruise loop on the pedals), radius in m, the
//               body roll (deg) and the drift angle (deg)
//   circle      turning circle at 8 km/h, kerb-to-kerb DIAMETER (m)
//   step        a full-lock step at 80 km/h (what a touch stick or a key does):
//               yaw-rate rise time to 90 % of its settled value (ms), overshoot (%)
//   half        half lock at 100 km/h: lateral g (an analogue stick's middle)
//   hand        handbrake + full lock for 1 s at 60 km/h: degrees turned, speed after
//   lift        at the limit at 90 km/h, throttle off for 1 s: drift angle change (deg)
//   grass / gravel   the same car with `surfForce` set: top, 100-0, lat@60
//
// The real-world bands the numbers are compared with are in REAL below (spec
// sheets / road tests of the class); the game's own scaling (ARCADE_PUNCH etc.)
// is applied to them where it applies, and printed.

import { launchChrome } from '../chrome.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9413;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const TYPES = (argv[0] && !argv[0].startsWith('--') ? argv[0] : 'sedan,sports,pickup,compact,bus').split(',');

// Real road-test figures for each class (0-100 s, top km/h, 100-0 m, skidpad g,
// turning circle m kerb to kerb). Sources: manufacturers' and Car and Driver /
// Motor Trend test sheets for a typical example: a V6 mid-size RWD sedan, a
// 911-class coupe, a half-ton pickup, a city car, a 40 ft transit bus (0-80;
// 80-0 doubled for 100-0 is meaningless, so its brake is its 80-0 x 1.56).
const REAL = {
  sedan: { acc: [6.5, 8.5], top: [200, 240], brake: [36, 41], lat: [0.85, 0.92], circle: [11.2, 12.2] },
  sports: { acc: [3.5, 4.5], top: [280, 310], brake: [31, 34], lat: [1.0, 1.1], circle: [10.6, 11.4] },
  pickup: { acc: [6.0, 8.0], top: [170, 180], brake: [40, 46], lat: [0.72, 0.80], circle: [13.0, 15.0] },
  compact: { acc: [10, 14], top: [155, 175], brake: [39, 44], lat: [0.78, 0.84], circle: [9.0, 10.0] },
  bus: { acc: [20, 30], top: [90, 105], brake: [55, 70], lat: [0.40, 0.50], circle: [23, 25] },
};

function bench(types, trace) {
  const d = window.__dbg, city = d.city;
  const DT = 1 / 60, KMH = 3.6;
  const groundAt = city.groundAt, roadLift = city.roadLift, rampMask = city.rampMask;
  city.groundAt = () => 0;
  city.roadLift = () => 0;
  city.rampMask = null;
  const deg = (r) => r * 180 / Math.PI;
  const out = {};
  const X0 = 0, Z0 = 0;
  try {
    if (trace && trace.startsWith('launch:')) {
      // DRIVE_TRACE=launch:type[,surface]: from rest, full throttle for 4 s
      // with the stick held at each deflection (a touch GAS and a thumb on
      // the stick): how far the car turned, its worst drift, and the speed
      // (launch:type,surface,steer: that one, every 10th frame)
      const [name, surf, one] = trace.slice(7).split(',');
      const rows = ['steer  turned_deg  drift_max_deg  yaw_max  kmh  spin_max'];
      for (const st of one !== undefined ? [+one] : [0, 0.1, 0.2, 0.35, 0.5, 0.75, 1]) {
        const v = d.traffic.spawnAt(X0, Z0, 0, name, 0x808080, 'free');
        v.setDetailed(true); v.y = 0; v.vLong = 0; v.surfForce = surf && surf !== 'asphalt' ? surf : undefined;
        const h0 = v.heading; let dm = 0, ym = 0, sm = 0;
        for (let i = 0; i < 240; i++) {
          v.update(DT, { throttle: 1, brake: 0, steer: st });
          if (one !== undefined && i % 10 === 0) rows.push(['  ', i, (v.vLong * KMH).toFixed(1), 'drift', deg(v.slipAngle || 0).toFixed(1), 'yaw', (v.yawRate || 0).toFixed(2),
            'lat', ((v.latAcc || 0) / 9.81).toFixed(2), 'drv', (v._drvDemand || 0).toFixed(2), 'steer', deg(v.steer).toFixed(1), 'gear', v.gbox ? v.gbox.gear : '-'].join(' '));
          dm = Math.max(dm, Math.abs(deg(v.slipAngle || 0))); ym = Math.max(ym, Math.abs(v.yawRate || 0)); sm = Math.max(sm, v.wheelspin || 0);
        }
        rows.push([st, deg(v.heading - h0).toFixed(0), dm.toFixed(1), ym.toFixed(2), (v.vLong * KMH).toFixed(0), sm.toFixed(2)].join('  '));
        d.traffic.remove(v);
      }
      return JSON.stringify({ trace: rows });
    }
    if (trace) {
      // DRIVE_TRACE=type,surface,kmh[,steer]: one full-lock hold, every 10th frame
      const [name, surf, kmh, st] = trace.split(',');
      const v = d.traffic.spawnAt(X0, Z0, 0, name, 0x808080, 'free');
      v.setDetailed(true); v.y = 0; v.vLong = +kmh / KMH; v.surfForce = surf === 'asphalt' ? undefined : surf;
      const rows = [];
      for (let i = 0; i < 60 * 6; i++) {
        const e = +kmh / KMH - v.vLong;
        const p = e > 0 ? { throttle: Math.min(1, e * 0.8 + 0.25), brake: 0 } : { throttle: 0, brake: Math.min(1, -e * 0.3) };
        v.update(DT, { throttle: p.throttle, brake: p.brake, steer: st !== undefined ? +st : 1 });
        if (i % 10 === 0) rows.push([i, (v.vLong * KMH).toFixed(1), v.vLat.toFixed(2), p.throttle.toFixed(2), p.brake.toFixed(2),
          deg(v.steer).toFixed(1), deg(v.slipAngle || 0).toFixed(1), (v.yawRate || 0).toFixed(2), ((v.latAcc || 0) / 9.81).toFixed(2),
          (v._drvDemand || 0).toFixed(2), v.wheelspin.toFixed(2), v.surf, v.gbox ? v.gbox.gear : '-'].join(' '));
      }
      d.traffic.remove(v);
      return JSON.stringify({ trace: ['i kmh vLat thr brk steer drift yaw latg drv spin surf gear', ...rows] });
    }
    for (const name of types) {
      const spec = d.TYPES[name];
      const fresh = (kmh = 0, surf) => {
        const v = d.traffic.spawnAt(X0, Z0, 0, name, 0x808080, 'free');
        v.setDetailed(true);
        v.y = 0; v.vLong = kmh / KMH; v.vLat = 0; v.spin = 0; v.slide = 0;
        v.surfForce = surf;
        for (let i = 0; i < 3; i++) v.update(DT, { throttle: 0, brake: 0, steer: 0 });
        v.vLong = kmh / KMH; v.vLat = 0; v.dynW = undefined; v.yawRate = 0;
        return v;
      };
      const done = (v) => d.traffic.remove(v);
      // hold a speed with the pedals (a cruise loop), as a driver would
      const cruise = (v, kmh) => {
        const e = kmh / KMH - v.vLong;
        return e > 0 ? { throttle: Math.min(1, e * 0.8 + 0.25), brake: 0 } : { throttle: 0, brake: Math.min(1, -e * 0.3) };
      };
      const run = (surf) => {
        const r = {};
        const mark = spec.topKph < 70 ? 50 : spec.topKph < 110 ? 80 : 100;
        r.mark = mark;
        // standing start
        let v = fresh(0, surf), t = 0, pmin = 0;
        r.acc = null; r.acc50 = null; r.pass = null;
        let t80 = null;
        for (let i = 0; i < 60 * 120 && r.acc === null; i++) {
          v.update(DT, { throttle: 1, brake: 0, steer: 0 });
          t += DT;
          pmin = Math.max(pmin, -(v.susPitch || 0));
          if (r.acc50 === null && v.vLong * KMH >= 50) r.acc50 = +t.toFixed(2);
          if (v.vLong * KMH >= mark) r.acc = +t.toFixed(2);
        }
        // the pull at speed: 80-120 (a pass), floored on from a steady 80
        if (spec.topKph > 135 && !surf) {
          const w = fresh(80);
          for (let i = 0; i < 90; i++) { const p = cruise(w, 80); w.update(DT, { throttle: p.throttle * 0.6, brake: p.brake, steer: 0 }); }
          let tt = 0;
          for (let i = 0; i < 60 * 60 && w.vLong * KMH < 120; i++) { w.update(DT, { throttle: 1, brake: 0, steer: 0 }); tt += DT; }
          r.pass = +tt.toFixed(2);
          done(w);
        }
        r.squat = +deg(pmin).toFixed(2);
        for (let i = 0; i < 60 * 100; i++) v.update(DT, { throttle: 1, brake: 0, steer: 0 });
        r.top = +(v.vLong * KMH).toFixed(1);
        done(v);
        // 100-0
        v = fresh(100, surf);
        let dist = 0, dive = 0;
        const x0 = v.x, z0 = v.z;
        for (let i = 0; i < 60 * 30 && v.vLong > 0.05; i++) {
          const b = v.vLong;
          v.update(DT, { throttle: 0, brake: 1, steer: 0 });
          dist += ((b + Math.max(v.vLong, 0)) / 2) * DT;
          dive = Math.max(dive, v.susPitch || 0);
        }
        r.brake = +dist.toFixed(1);
        r.dive = +deg(dive).toFixed(2);
        // sideways drift: the start heading was 0, forward +z, right -x
        r.dev = +Math.abs(v.x - x0).toFixed(2);
        done(v);
        // steady state at full lock
        r.lat = {};
        for (const kmh of surf ? [40] : [30, 60, 90, 120]) {
          if (kmh > spec.topKph * 0.9) continue;
          v = fresh(kmh, surf);
          let yaw = 0, sp = 0, roll = 0, slip = 0, n = 0, smax = 0;
          for (let i = 0; i < 60 * 6; i++) {
            const p = cruise(v, kmh);
            v.update(DT, { throttle: p.throttle, brake: p.brake, steer: 1 });
            smax = Math.max(smax, Math.abs(v.slipAngle || 0));
            if (i >= 60 * 5) { yaw += v.yawRate; sp += Math.hypot(v.vLong, v.vLat); roll += v.susRoll || v.roll || 0; slip += v.slipAngle || 0; n++; }
          }
          yaw /= n; sp /= n; roll /= n; slip /= n;
          r.lat[kmh] = { g: +(Math.abs(yaw) * sp / 9.81).toFixed(2), R: +(sp / Math.max(1e-3, Math.abs(yaw))).toFixed(1),
            kmh: +(sp * KMH).toFixed(0), roll: +deg(roll).toFixed(2), slip: +deg(slip).toFixed(1), smax: +deg(smax).toFixed(0) };
          done(v);
        }
        return r;
      };
      const r = run(undefined);
      // turning circle at 8 km/h
      let v = fresh(8);
      let yaw = 0, n = 0;
      for (let i = 0; i < 60 * 5; i++) {
        const p = cruise(v, 8);
        v.update(DT, { throttle: p.throttle, brake: p.brake, steer: 1 });
        if (i > 60 * 3) { yaw += v.yawRate; n++; }
      }
      const Rc = (8 / KMH) / Math.max(1e-3, Math.abs(yaw / n));
      // kerb to kerb: the outer front corner's circle
      const L = spec.wheelbase, hw = spec.wid / 2, ov = spec.len / 2 - L / 2;
      r.circle = +(2 * Math.hypot(Rc + hw, L / 2 + ov)).toFixed(1);
      r.Rc = +Rc.toFixed(2);
      done(v);
      // step steer at 80 km/h
      if (spec.topKph > 95) {
        v = fresh(80);
        for (let i = 0; i < 60; i++) { const p = cruise(v, 80); v.update(DT, { throttle: p.throttle, brake: p.brake, steer: 0 }); }
        const trace = [];
        for (let i = 0; i < 60 * 4; i++) {
          const p = cruise(v, 80);
          v.update(DT, { throttle: p.throttle, brake: p.brake, steer: 1 });
          trace.push(Math.abs(v.yawRate));
        }
        const fin = trace.slice(-60).reduce((a, b) => a + b, 0) / 60;
        const t90 = trace.findIndex((y) => y >= 0.9 * fin);
        const peak = Math.max(...trace);
        r.step = { t90: Math.round(t90 * DT * 1000), over: +((peak / fin - 1) * 100).toFixed(0), yaw: +deg(fin).toFixed(1) };
        done(v);
        // half lock at 100
        v = fresh(100);
        let y2 = 0, s2 = 0; n = 0;
        for (let i = 0; i < 60 * 5; i++) {
          const p = cruise(v, 100);
          v.update(DT, { throttle: p.throttle, brake: p.brake, steer: 0.5 });
          if (i > 60 * 4) { y2 += v.yawRate; s2 += Math.hypot(v.vLong, v.vLat); n++; }
        }
        r.half = +(Math.abs(y2 / n) * (s2 / n) / 9.81).toFixed(2);
        done(v);
        // handbrake turn at 60
        v = fresh(60);
        const h0 = v.heading;
        for (let i = 0; i < 30; i++) v.update(DT, { throttle: 0, brake: 0, steer: 1, handbrake: 1 });
        for (let i = 0; i < 60; i++) v.update(DT, { throttle: 0, brake: 0, steer: 0 });
        r.hand = { deg: +deg(v.heading - h0).toFixed(0), kmh: +(Math.hypot(v.vLong, v.vLat) * KMH).toFixed(0) };
        done(v);
        // full lock held at 100 with the pedals off: what the understeer scrubs
        v = fresh(100);
        for (let i = 0; i < 120; i++) v.update(DT, { throttle: 0, brake: 0, steer: 1 });
        const vs = v.vLong;
        done(v);
        v = fresh(100);
        for (let i = 0; i < 120; i++) v.update(DT, { throttle: 0, brake: 0, steer: 0 });
        r.scrub = +((v.vLong - vs) * KMH).toFixed(1);
        done(v);
        // lift-off at the limit at 90
        v = fresh(90);
        for (let i = 0; i < 60 * 4; i++) { const p = cruise(v, 90); v.update(DT, { throttle: p.throttle, brake: p.brake, steer: 1 }); }
        const s0 = v.slipAngle || 0, w0 = v.yawRate;
        let smax = s0;
        for (let i = 0; i < 60; i++) { v.update(DT, { throttle: 0, brake: 0, steer: 1 }); if (Math.abs(v.slipAngle || 0) > Math.abs(smax)) smax = v.slipAngle; }
        r.lift = { slip0: +deg(s0).toFixed(1), slipMax: +deg(smax).toFixed(1), yawGain: +((v.yawRate / (w0 || 1e-3) - 1) * 100).toFixed(0) };
        done(v);
      }
      // A RIG (spec.towed: the semi and its trailer): the trailer is placed by
      // its kinematics (traffic.js runs Vehicle.follow after the tractor's
      // update; here likewise) -- the articulation (deg, tractor to trailer)
      // in a lane change at 90, held full lock at 30 / 60 / 90, a hard stop
      // in a bend at 90, and reversing with a little lock (where a trailer
      // really does fold: it is unstable backwards)
      if (spec.towed) {
        const art = (v) => Math.abs(deg(Math.atan2(Math.sin(v.trailer.heading - v.heading), Math.cos(v.trailer.heading - v.heading))));
        const rig = (kmh) => { const v = fresh(kmh); if (v.trailer) for (let i = 0; i < 30; i++) v.trailer.follow(v); return v; };
        r.rig = {};
        let v = rig(90), m = 0;
        for (let i = 0; i < 60 * 6; i++) {
          const p = cruise(v, 90), st = i < 60 ? 0.5 : i < 120 ? -0.5 : 0;
          v.update(DT, { throttle: p.throttle, brake: p.brake, steer: st }); v.trailer.follow(v); m = Math.max(m, art(v));
        }
        r.rig.lane90 = +m.toFixed(1); done(v);
        for (const kmh of [30, 60, 90]) {
          v = rig(kmh); m = 0; let last = 0;
          for (let i = 0; i < 60 * 8; i++) { const p = cruise(v, kmh); v.update(DT, { throttle: p.throttle, brake: p.brake, steer: 1 }); v.trailer.follow(v); m = Math.max(m, art(v)); last = art(v); }
          r.rig['lock' + kmh] = { max: +m.toFixed(1), held: +last.toFixed(1), R: +(Math.abs(v.vLong) / Math.max(1e-3, Math.abs(v.yawRate))).toFixed(1) };
          done(v);
        }
        v = rig(90); m = 0;
        for (let i = 0; i < 60; i++) { const p = cruise(v, 90); v.update(DT, { throttle: p.throttle, brake: p.brake, steer: 0.6 }); v.trailer.follow(v); }
        let dist = 0;
        for (let i = 0; i < 60 * 20 && v.vLong > 0.05; i++) { const b = v.vLong; v.update(DT, { throttle: 0, brake: 1, steer: 0.6 }); v.trailer.follow(v); dist += (b + Math.max(0, v.vLong)) / 2 * DT; m = Math.max(m, art(v)); }
        r.rig.stopBend90 = { max: +m.toFixed(1), m: +dist.toFixed(1) }; done(v);
        v = rig(0); m = 0;
        for (let i = 0; i < 60 * 8; i++) { const e = -5 / KMH - v.vLong; v.update(DT, { throttle: 0, brake: e < 0 ? Math.min(1, -e * 0.6 + 0.2) : 0, steer: 0.25 }); v.trailer.follow(v); m = Math.max(m, art(v)); }
        r.rig.reverse = +m.toFixed(1); done(v);
      }
      r.grass = run('grass');
      r.gravel = run('gravel');
      out[name] = r;
    }
  } finally {
    city.groundAt = groundAt; city.roadLift = roadLift; city.rampMask = rampMask;
  }
  return JSON.stringify(out);
}

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-drive-profile-${PORT}`, width: 900, height: 600 });
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
    });
    const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
    const evaluate = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
      return r.result?.result?.value;
    };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    let up = false;
    for (let i = 0; i < 400 && !up; i++) {
      await sleep(500);
      up = await evaluate('!!(window.__dbg && window.__dbg.traffic && window.__dbg.TYPES && window.__dbg.game)');
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 3).join(' | '));
    await sleep(1500);
    if (argv.includes('--live')) {
      // THE REAL LOOP: the game unpaused, GAS held through the controls, the
      // stick by real key events (D = right), on a gravel concession road
      // north of Wellesley (gravel.json's longest): gear, audio's gear, surface.
      await evaluate(`(() => { const d = __dbg;
        // (the kerbside cars along it would only be driven into)
        for (const c of [...d.traffic.cars]) if (Math.hypot(c.x - 9800, c.z + 4720) < 500 && c !== d.player.vehicle) d.traffic.remove(c);
        const v = d.traffic.spawnAt(9790, -4743, 0.47, "sedan", 0x8a2a20, 'free');
        d.player.enterVehicle(v); d.game.paused = false; d.controls.btn.gas = true; })()`);
      const key = (type, code) => send('Input.dispatchKeyEvent', { type, code, key: code === 'KeyD' ? 'd' : 'a', windowsVirtualKeyCode: code === 'KeyD' ? 68 : 65 });
      const rows = [];
      const sample = async (tag) => rows.push(tag + ' ' + await evaluate(`(() => { const d = __dbg, v = d.player.vehicle, a = d.audio, m = a && a.engModel;
        return [(v.vLong * 3.6).toFixed(0) + ' km/h', 'gear ' + (v.gbox ? v.gbox.gear + 1 : '-'), 'audio gear ' + (m ? m.gear + 1 : '-') + (a && a.ready ? '' : ' (audio not ready)'),
          'rpm ' + (v.gbox ? Math.round(v.gbox.rpm) : '-'), 'surf ' + v.surf, 'mu ' + v.mu, 'skid ' + (v.skid || 0).toFixed(2), 'roll ' + ((v.susRoll || 0) * 57.3).toFixed(1),
          'pitch ' + ((v.susPitch || 0) * 57.3).toFixed(1)].join('  '); })()`));
      for (let i = 0; i < 16; i++) { await sleep(500); await sample('gas  '); }
      await key('keyDown', 'KeyD');
      for (let i = 0; i < 6; i++) { await sleep(400); await sample('right'); }
      await key('keyUp', 'KeyD');
      await evaluate('__dbg.controls.btn.gas = false; __dbg.controls.btn.brake = true');
      for (let i = 0; i < 6; i++) { await sleep(400); await sample('brake'); }
      console.log(rows.join('\n'));
      console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
      return;
    }
    await evaluate('window.__dbg.game.paused = true');
    const res = JSON.parse(await evaluate(`(${bench.toString()})(${JSON.stringify(TYPES)}, ${JSON.stringify(process.env.DRIVE_TRACE || '')})`));
    if (res.trace) { console.log(res.trace.join('\n')); return; }
    if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(res, null, 1));
    const before = opt('--compare') ? JSON.parse(readFileSync(opt('--compare'), 'utf8')) : null;
    const f = (x) => (x === null || x === undefined ? '--' : String(x));
    for (const [name, r] of Object.entries(res)) {
      const b = before && before[name];
      const R = REAL[name] || {};
      const pair = (k, get) => `${f(get(r))}${b ? ` (was ${f(get(b))})` : ''}`;
      console.log(`\n== ${name}`);
      console.log(`  0-${r.mark}      ${pair('acc', (x) => x.acc)} s      real ${R.acc ? R.acc.join('-') : '?'} (game x${2.4} punch)`);
      console.log(`  top        ${pair('top', (x) => x.top)} km/h  real ${R.top ? R.top.join('-') : '?'}`);
      console.log(`  0-50       ${pair('', (x) => x.acc50)} s   80-120 floored ${pair('', (x) => x.pass)} s`);
      if (r.rig) console.log(`  rig        articulation deg: lane change @90 ${r.rig.lane90}, full lock @30/60/90 ${[30, 60, 90].map((k) => r.rig['lock' + k].held + ' (R ' + r.rig['lock' + k].R + ')').join(' / ')}, hard stop in a bend @90 ${r.rig.stopBend90.max} (${r.rig.stopBend90.m} m), reversing ${r.rig.reverse}`);
      console.log(`  100-0      ${pair('brake', (x) => x.brake)} m  dev ${r.dev}  dive ${r.dive} deg  squat ${r.squat} deg  real ${R.brake ? R.brake.join('-') : '?'}`);
      for (const k of Object.keys(r.lat)) {
        console.log(`  lat@${k.padEnd(4)}  ${pair('', (x) => x.lat[k] && x.lat[k].g)} g  R ${pair('', (x) => x.lat[k] && x.lat[k].R)} m  roll ${r.lat[k].roll} deg  drift ${r.lat[k].slip} deg (max ${r.lat[k].smax})  held ${r.lat[k].kmh} km/h`);
      }
      console.log(`  circle     ${pair('', (x) => x.circle)} m   real ${R.circle ? R.circle.join('-') : '?'}   real skidpad ${R.lat ? R.lat.join('-') : '?'} g`);
      if (r.step) {
        console.log(`  step@80    t90 ${pair('', (x) => x.step && x.step.t90)} ms  overshoot ${pair('', (x) => x.step && x.step.over)} %  yaw ${r.step.yaw} deg/s`);
        console.log(`  half@100   ${pair('', (x) => x.half)} g`);
        console.log(`  handbrake  0.5 s at 60: ${pair('', (x) => x.hand && x.hand.deg)} deg, ${pair('', (x) => x.hand && x.hand.kmh)} km/h 1 s later`);
        console.log(`  scrub      full lock 2 s from 100, pedals off: ${pair('', (x) => x.scrub)} km/h more lost than straight`);
        console.log(`  lift-off   drift ${r.lift.slip0} -> ${pair('', (x) => x.lift && x.lift.slipMax)} deg  yaw ${r.lift.yawGain} %`);
      }
      for (const s of ['grass', 'gravel']) {
        const q = r[s], qb = b && b[s];
        console.log(`  ${s.padEnd(7)}  top ${q.top}${qb ? ` (was ${qb.top})` : ''}  100-0 ${q.brake}${qb ? ` (was ${qb.brake})` : ''}  lat@40 ${q.lat[40] ? q.lat[40].g + ' (drift max ' + q.lat[40].smax + ')' : '--'}${qb && qb.lat[40] ? ` (was ${qb.lat[40].g})` : ''} g  0-${q.mark} ${q.acc}${qb ? ` (was ${qb.acc})` : ''}`);
      }
    }
    console.log(`\n  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('drivetest failed:', e.message); process.exitCode = 1; });
