// How well does the AI DRIVE? A fixed-dt, paused-game observation probe.
//
// trafficcheck.mjs asks whether traffic goes the right way and stays out of
// trouble; this one watches each AI car the way you would from the chase
// camera and scores the driving itself. Same method: the game is paused, the
// harness calls traffic.update at dt = 1/60 in batches with the player parked
// (out of the picture) at each site; traffic is cleared, refilled for WARM
// seconds and measured for MEASURE seconds. Deterministic, so two builds
// compare like for like.
//
// Per moving traffic car, every frame:
//   laneRms/laneP95  lateral error from its own lane centre (laneLat), m,
//                    sampled mid-edge only (8 m clear of both nodes, edges of
//                    25 m+, no dodge): lane keeping on the straight
//   weave            steering reversals per car-minute: the yaw rate swinging
//                    past +-0.04 rad/s one way then the other (hysteresis)
//                    while above 4 m/s -- a car hunting round its lane
//   yawJerk          RMS of d(yaw rate)/dt, rad/s^2: twitchy steering
//   hardBrake        share of car-frames decelerating harder than 4.5 m/s^2
//   accP99           99th percentile |dv/dt|, m/s^2
//   pedalFlips       brake <-> throttle switches per car-minute: on/off
//                    following, the "pumping" of a car behind another
//   latP95/latOver   95th percentile lateral acceleration, m/s^2, and the
//                    share of frames over 4 m/s^2 (~0.4 g, past which a
//                    passenger is thrown about)
//   turnSpd          mean speed through nodes where the route turns 50+ deg,
//                    m/s (with the count), and turnLat: the mean of the worst
//                    lateral acceleration within 1.5 s of those nodes
//   offRoad          share of samples with the car's centre off every
//                    carriageway (corner cutting over the pavement, running
//                    wide at a turn)
//   leftOfC          on a two-way street, share of samples with the centre
//                    left of the centreline (cutting across oncoming lanes)
//   tailgate         share of samples at 5+ m/s with a car ahead in the same
//                    lane under 0.8 s of headway (bumper to bumper)
//   contacts/hits    car-to-car contact events per minute: `contacts` by
//                    trafficcheck's circle rule (which counts two cars
//                    passing on a narrow two-way street), `hits` the bodies'
//                    rectangles actually touching (hitKind: same / opp /
//                    cross; hitLog: the first few); `obst`: AI car-frames in
//                    contact with a street object or wall, per minute, with
//                    `obstAt` the 20 m cells and `wedged` the cars held there
//   stuck            cars under 0.5 m/s for 20 s straight
//
// Usage:  python3 -m http.server 8000; node tools/aidrive.mjs [--sites a,b]
//         [--warm S] [--measure S] [--json FILE]
// Prints one line per site and a summary line starting "AIDRIVE".
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
function argVal(k) { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; }
const WARM = +(argVal('--warm') || 20);
const MEASURE = +(argVal('--measure') || 90);
const ONLY = argVal('--sites');
const JSON_OUT = argVal('--json');
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9246;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ---- page side --------------------------------------------------------------
function pageInit() {
  const d = window.__dbg, c = d.city, p = d.player, T = d.traffic;
  const H = window.__ad = { sites: [] };
  const wrap = (a) => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);
  // What the AI asked for this frame (driveTraffic's return), per car.
  if (!T.__adWrapped) {
    T.__adWrapped = true;
    const dt0 = T.driveTraffic.bind(T);
    T.driveTraffic = (v, ...r) => { const inp = dt0(v, ...r); v.__in = inp; H.curCar = v; return inp; };
    const oh = c.obstacleHit.bind(c);
    const bh = c.barrierHit.bind(c);
    c.barrierHit = (x, z, rad, y) => { const h = bh(x, z, rad, y); if (h) H.lastBarrier = h; return h; };
    c.obstacleHit = (x, z, rad, y, ai) => {
      H.lastBarrier = null;
      const h = oh(x, z, rad, y, ai);
      if (h && ai && H.inUpdate) {
        H.obstN++;
        // where, and which kind: a cutting/lid wall (barrierHit) or a post
        const k = (h === H.lastBarrier ? 'wall ' : 'post ') + Math.round(x / 20) * 20 + ',' + Math.round(z / 20) * 20;
        H.obstAt[k] = (H.obstAt[k] || 0) + 1;
        const v = H.curCar;
        if (v && Math.abs(v.x - x) < 0.01 && Math.abs(v.z - z) < 0.01) {
          v.__wallT = (v.__wallT || 0) + 1;
          if (v.__wallT === 60 && H.wedged.length < 8) {
            const e = c.edges[v.edge], na = c.nodes[v.dirSign > 0 ? e.a : e.b];
            const fx = e.dx * v.dirSign, fz = e.dz * v.dirSign;
            H.wedged.push({ kind: h === H.lastBarrier ? 'wall' : 'post', x: Math.round(x), z: Math.round(z), cls: e.cls, flow: T.flow[v.edge], hw: e.hw,
              al: Math.round((v.x - na.x) * fx + (v.z - na.z) * fz), len: Math.round(e.len), lat: +((v.x - na.x) * -fz + (v.z - na.z) * fx).toFixed(2),
              lane: +T.laneLat(v.edge, v.dirSign, v).toFixed(2), spd: +v.vLong.toFixed(1), hdg: +(v.heading - Math.atan2(fx, fz)).toFixed(2), type: v.typeName, rad: +(v.radius * 0.7).toFixed(2), tw: !!e.tw, bar: !!e.barW });
          }
        }
      }
      return h;
    };
  }
  H.pickSites = () => {
    const near = (x, z, test) => {
      let best = null, bd = 1e18;
      for (const ei of c.edgesNear(x, z, 600)) {
        const e = c.edges[ei];
        if (!test(e) || e.tunnel || e.elev) continue;
        const a = c.nodes[e.a];
        const dd = (a.x - x) ** 2 + (a.z - z) ** 2;
        if (dd < bd) { bd = dd; best = a; }
      }
      return best ? { x: best.x, z: best.z } : { x, z };
    };
    return [
      { name: 'downtown', ...near(0, 0, (e) => e.oneway && e.cls !== 'res') },
      { name: 'arterial', ...near(1300, 1300, (e) => e.cls === 'art' && !e.oneway) },
      { name: 'i5', ...near(620, -60, (e) => e.cls === 'hwy') },
      { name: 'queenanne', ...near(-1200, -2600, (e) => e.cls === 'res') },
      { name: 'capitol', ...near(1700, -300, () => true) },
    ];
  };
  // 2D SAT on the two bodies' rectangles (traffic.js boxOverlap)
  const box = (a, b) => {
    const fa = a.forward, fb = b.forward, dx = b.x - a.x, dz = b.z - a.z;
    const ax = [fa.x, fa.z, fa.z, -fa.x, fb.x, fb.z, fb.z, -fb.x];
    for (let k = 0; k < 8; k += 2) {
      const ux = ax[k], uz = ax[k + 1];
      const ra = a.halfLen * Math.abs(fa.x * ux + fa.z * uz) + a.halfWid * Math.abs(fa.z * ux - fa.x * uz);
      const rb = b.halfLen * Math.abs(fb.x * ux + fb.z * uz) + b.halfWid * Math.abs(fb.z * ux - fb.x * uz);
      if (ra + rb - Math.abs(dx * ux + dz * uz) <= 0) return false;
    }
    return true;
  };
  const pct = (arr, q) => { if (!arr.length) return 0; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  H.begin = (site) => {
    for (const v of [...T.cars]) if (v.mode !== 'apron') T.remove(v);
    p.respawn(site.x, site.z);
    p.onFoot = false; p.vehicle = null;
    d.game.wanted = 0;
    H.site = site; H.t = 0; H.frames = 0; H.obstN = 0; H.obstAt = {}; H.wedged = [];
    H.m = { carT: 0, mt: 0, lane: [], weave: 0, yawJ2: 0, yawJn: 0, hard: 0, frames: 0, acc: [], flips: 0, lat: [], latOver: 0,
      turnN: 0, turnSpd: 0, turnLat: 0, samples: 0, off: 0, twoWay: 0, left: 0, follow: 0, tail: 0, contacts: 0, hits: 0, hitKind: {}, stuck: 0, obst: 0 };
    H.boxPairs = new Map(); H.hitLog = [];
    H.st = new Map(); H.pairs = new Map(); H.stuckSeen = new Set(); H.turns = [];
    return JSON.stringify({ site: site.name, x: Math.round(site.x), z: Math.round(site.z), place: d.G.placeNameAt(site.x, site.z) });
  };
  H.stepN = (n, measure) => {
    const dt = 1 / 60, site = H.site, m = H.m;
    for (let i = 0; i < n; i++) {
      const ang = H.t * 0.2;
      H.inUpdate = measure; H.obstN = 0;
      T.update(dt, site.x, site.z, { x: Math.sin(ang), z: Math.cos(ang) }, p);
      H.inUpdate = false;
      H.t += dt; H.frames++;
      if (H.frames % 10 === 0) d.world.update(site.x, site.z, 2);
      if (!measure) { H.st.clear(); continue; }
      m.mt += dt; m.obst += H.obstN;
      const cars = T.cars.filter((v) => v.mode === 'traffic');
      for (const v of cars) {
        let s = H.st.get(v.id);
        if (!s) { H.st.set(v.id, s = { h: v.heading, v: v.vLong, yr: NaN, sgn: 0, ped: 0, edge: v.edge, slow: 0, peakLat: 0, pending: null, age: 0 }); continue; }
        s.age += dt;
        const yr = wrap(v.heading - s.h) / dt, a = (v.vLong - s.v) / dt;
        const moving = v.vLong > 4;
        if (s.age > 0.5) {
          m.carT += dt; m.frames++;
          if (moving) {
            if (!Number.isNaN(s.yr)) { const j = (yr - s.yr) / dt; m.yawJ2 += j * j; m.yawJn++; }
            const sg = yr > 0.04 ? 1 : yr < -0.04 ? -1 : 0;
            if (sg && s.sgn && sg !== s.sgn) m.weave++;
            if (sg) s.sgn = sg;
          }
          if (Math.abs(v.vLong) > 1) { m.acc.push(Math.abs(a)); if (a < -4.5) m.hard++; }
          const la = Math.abs(v.latAcc || 0);
          if (v.vLong > 2) { m.lat.push(la); if (la > 4) m.latOver++; }
          const inp = v.__in;
          if (inp) {
            const ped = inp.brake > 0.05 ? -1 : inp.throttle > 0.05 ? 1 : 0;
            if (ped && s.ped && ped !== s.ped) m.flips++;
            if (ped) s.ped = ped;
          }
          // lane keeping mid-edge
          const e = c.edges[v.edge];
          if (e && e.len >= 25 && moving && !(v.dodgeT > 0)) {
            const na = c.nodes[v.dirSign > 0 ? e.a : e.b];
            const fx = e.dx * v.dirSign, fz = e.dz * v.dirSign;
            const along = (v.x - na.x) * fx + (v.z - na.z) * fz;
            if (along > 8 && along < e.len - 8) {
              const lat = (v.x - na.x) * -fz + (v.z - na.z) * fx;
              // the lane the car means to hold: its route's (a build with a
              // planned route), else laneLat with the bore clamp
              let off;
              if (v.rt && v.rtN) off = v.rt[2];
              else {
                off = T.laneLat(v.edge, v.dirSign, v);
                if (e.tunnel && !e.elev) { const lim = Math.max(0, e.hw + 0.4 - (v.radius * 0.7 + 1.1)); off = Math.max(-lim, Math.min(lim, off)); }
              }
              m.lane.push(Math.abs(lat - off));
            }
          }
          // turns: a node transition onto an edge 50+ deg off the last one
          if (v.edge !== s.edge && c.edges[s.edge] && e) {
            const o = c.edges[s.edge];
            const ofx = o.dx * (s.dir || v.dirSign), ofz = o.dz * (s.dir || v.dirSign);
            const nfx = e.dx * v.dirSign, nfz = e.dz * v.dirSign;
            const turn = Math.acos(Math.max(-1, Math.min(1, ofx * nfx + ofz * nfz)));
            if (turn > 50 * Math.PI / 180 && turn < 2.4) H.turns.push({ id: v.id, t: H.t, spd: v.vLong, peak: 0, start: H.t - 1.5, hist: s.latHist ? s.latHist.slice() : [] });
          }
        }
        s.dir = v.dirSign;
        // recent lateral accel, for turns (1.5 s back)
        if (!s.latHist) s.latHist = [];
        s.latHist.push(Math.abs(v.latAcc || 0)); if (s.latHist.length > 90) s.latHist.shift();
        s.h = v.heading; s.v = v.vLong; s.yr = yr; s.edge = v.edge;
        // stuck
        s.slow = Math.abs(v.vLong) < 0.5 ? s.slow + dt : 0;
        if (s.slow > 20 && !H.stuckSeen.has(v.id)) { H.stuckSeen.add(v.id); m.stuck++; }
      }
      // close out turns 1.5 s after the node
      for (let k = H.turns.length - 1; k >= 0; k--) {
        const tr = H.turns[k];
        const v = cars.find((q) => q.id === tr.id);
        if (v) tr.peak = Math.max(tr.peak, Math.abs(v.latAcc || 0));
        if (H.t - tr.t > 1.5 || !v) {
          const pk = Math.max(tr.peak, ...tr.hist);
          m.turnN++; m.turnSpd += tr.spd; m.turnLat += pk;
          H.turns.splice(k, 1);
        }
      }
      // contacts (trafficcheck's rule: circles, one event per pair per 1 s clear)
      for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
        const A = cars[a], B = cars[b];
        if (Math.abs(A.y - B.y) > 3) continue;
        const rr = A.radius + B.radius;
        if ((A.x - B.x) ** 2 + (A.z - B.z) ** 2 > rr * rr) continue;
        const key = A.id + ':' + B.id, last = H.pairs.get(key);
        H.pairs.set(key, H.t);
        if (last === undefined || H.t - last >= 1) m.contacts++;
        // ...and whether the BODIES touch (what resolveCarCollisions answers):
        // two cars passing on a narrow two-way street touch circles, not boxes
        if (box(A, B)) {
          const lb = H.boxPairs.get(key);
          H.boxPairs.set(key, H.t);
          if (lb === undefined || H.t - lb >= 1) {
            m.hits++;
            const fa = A.forward, fb = B.forward, dd = fa.x * fb.x + fa.z * fb.z;
            const k = dd > 0.7 ? 'same' : dd < -0.7 ? 'opp' : 'cross';
            m.hitKind[k] = (m.hitKind[k] || 0) + 1;
            if (H.hitLog.length < 6) H.hitLog.push({ k, x: Math.round(A.x), z: Math.round(A.z), va: +A.vLong.toFixed(1), vb: +B.vLong.toFixed(1),
              ca: c.edges[A.edge]?.cls, cb: c.edges[B.edge]?.cls, sameEdge: A.edge === B.edge, ta: A.typeName, tb: B.typeName });
          }
        }
      }
      if (H.frames % 15) continue;
      // every quarter second: off road, left of centre, headway
      for (const v of cars) {
        if (v.vLong < 1) continue;
        m.samples++;
        const f = v.forward;
        let on = false, tw = false, left = false;
        for (const ei of c.edgesNear(v.x, v.z, 30)) {
          const e = c.edges[ei], a = c.nodes[e.a], b = c.nodes[e.b];
          const t = Math.max(0, Math.min(1, ((v.x - a.x) * e.dx + (v.z - a.z) * e.dz) / e.len));
          const qx = a.x + e.dx * e.len * t, qz = a.z + e.dz * e.len * t;
          const dd = Math.hypot(v.x - qx, v.z - qz);
          if (dd > e.hw + 0.3) continue;
          const ey = a.y + (b.y - a.y) * t;
          if (!e.tunnel && Math.abs(v.y - ey) > 3) continue;
          on = true;
          if (T.flow[ei] !== 0) continue;
          const dot = e.dx * f.x + e.dz * f.z;
          if (Math.abs(dot) < 0.85 || t <= 0 || t >= 1) continue;
          tw = true;
          const sg = dot > 0 ? 1 : -1;
          const lat = ((v.x - a.x) * -e.dz + (v.z - a.z) * e.dx) * sg; // + right of travel
          if (lat < -0.3) left = true;
        }
        if (!on) m.off++;
        if (tw) { m.twoWay++; if (left) m.left++; }
        if (v.vLong > 5) {
          m.follow++;
          let gap = Infinity;
          for (const o of T.cars) {
            if (o === v || Math.abs(o.y - v.y) > 3) continue;
            const rx = o.x - v.x, rz = o.z - v.z;
            const fw = rx * f.x + rz * f.z;
            if (fw <= 0 || fw > 60) continue;
            if (Math.abs(rx * f.z - rz * f.x) > 1.5) continue;
            const g = fw - v.halfLen - o.halfLen;
            if (g < gap) gap = g;
          }
          if (gap / v.vLong < 0.8) m.tail++;
        }
      }
    }
    return H.t;
  };
  H.finish = () => {
    const m = H.m, cmin = Math.max(1e-6, m.carT / 60), mins = m.mt / 60;
    const r = { site: H.site.name, simS: Math.round(m.mt), cars: +(m.carT / Math.max(1, m.mt)).toFixed(1),
      laneRms: +Math.sqrt(m.lane.reduce((a, x) => a + x * x, 0) / Math.max(1, m.lane.length)).toFixed(3),
      laneP95: +pct(m.lane, 0.95).toFixed(2),
      weave: +(m.weave / cmin).toFixed(2), yawJerk: +Math.sqrt(m.yawJ2 / Math.max(1, m.yawJn)).toFixed(2),
      hardBrake: +(m.hard / Math.max(1, m.frames)).toFixed(4), accP99: +pct(m.acc, 0.99).toFixed(2),
      pedalFlips: +(m.flips / cmin).toFixed(2),
      latP95: +pct(m.lat, 0.95).toFixed(2), latOver: +(m.latOver / Math.max(1, m.lat.length)).toFixed(4),
      turnN: m.turnN, turnSpd: +(m.turnSpd / Math.max(1, m.turnN)).toFixed(2), turnLat: +(m.turnLat / Math.max(1, m.turnN)).toFixed(2),
      offRoad: +(m.off / Math.max(1, m.samples)).toFixed(4), leftOfC: +(m.left / Math.max(1, m.twoWay)).toFixed(4),
      tailgate: +(m.tail / Math.max(1, m.follow)).toFixed(4),
      contacts: +(m.contacts / mins).toFixed(2), hits: +(m.hits / mins).toFixed(2), hitKind: m.hitKind, hitLog: H.hitLog, obst: +(m.obst / mins).toFixed(2), stuck: m.stuck,
      wedged: H.wedged, obstAt: Object.entries(H.obstAt).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => k + ':' + n) };
    H.sites.push({ ...r, raw: { carT: m.carT, mt: m.mt, lane: m.lane.length } });
    return JSON.stringify(r);
  };
  return JSON.stringify(H.pickSites().map((s) => s.name));
}

// ---- node side ----------------------------------------------------------------
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new',
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1100,650',
  '--no-first-run', `--user-data-dir=/tmp/auto-aidrive-${PORT}`, 'about:blank'], { stdio: 'ignore' });
let exitCode = 0;
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails || r.result?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails || r.result.exceptionDetails).slice(0, 1500));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  await ev(`window.__dbg.applyQuality('low', true)`);
  await ev('window.__dbg.game.paused = true');
  await ev(`(() => { let n = 0; const T = window.__dbg.traffic, add = T.add.bind(T);
    T.add = (v, mode) => { v.id = ++n; return add(v, mode); }; for (const v of T.cars) v.id = ++n; return 1; })()`);
  const sites = JSON.parse(await ev(`(${pageInit.toString()})()`));
  console.log('sites', sites.join(' '));
  const t0 = Date.now();
  for (let si = 0; si < sites.length; si++) {
    if (ONLY && !ONLY.split(',').includes(sites[si])) continue;
    console.log('begin', await ev(`window.__ad.begin(window.__ad.pickSites()[${si}])`));
    for (let t = 0; t < WARM * 60; t += 600) await ev(`window.__ad.stepN(600, false)`);
    for (let t = 0; t < MEASURE * 60; t += 600) await ev(`window.__ad.stepN(600, true)`);
    console.log('SITE', await ev('window.__ad.finish()'), Math.round((Date.now() - t0) / 1000) + 's');
    // AD_PROBE='<expr>' (or AD_PROBE_FILE=path): a one-off diagnostic, run
    // after each site with window.__ad (H.st: per-car state by id) in scope
    const probe = process.env.AD_PROBE || (process.env.AD_PROBE_FILE && readFileSync(process.env.AD_PROBE_FILE, 'utf8'));
    if (probe) console.log('PROBE', await ev(probe));
  }
  const tot = JSON.parse(await ev(`(() => {
    const S = window.__ad.sites, w = (k) => S.reduce((a, s) => a + s[k] * s.raw.carT, 0) / Math.max(1, S.reduce((a, s) => a + s.raw.carT, 0));
    const out = {};
    for (const k of ['laneRms', 'laneP95', 'weave', 'yawJerk', 'hardBrake', 'accP99', 'pedalFlips', 'latP95', 'latOver', 'turnSpd', 'turnLat', 'offRoad', 'leftOfC', 'tailgate']) out[k] = +w(k).toFixed(4);
    out.turnN = S.reduce((a, s) => a + s.turnN, 0);
    const mins = S.reduce((a, s) => a + s.raw.mt, 0) / 60;
    out.contacts = +(S.reduce((a, s) => a + s.contacts * s.raw.mt / 60, 0) / mins).toFixed(2);
    out.hits = +(S.reduce((a, s) => a + s.hits * s.raw.mt / 60, 0) / mins).toFixed(2);
    out.obst = +(S.reduce((a, s) => a + s.obst * s.raw.mt / 60, 0) / mins).toFixed(2);
    out.stuck = S.reduce((a, s) => a + s.stuck, 0);
    return JSON.stringify(out); })()`));
  console.log('AIDRIVE', JSON.stringify(tot));
  if (JSON_OUT) writeFileSync(JSON_OUT, await ev('JSON.stringify(window.__ad.sites)'));
} catch (err) {
  console.log('ERROR', err.message);
  exitCode = 2;
} finally { chrome.kill(); }
process.exit(exitCode);
