// Vehicle bench: what every type in TYPES actually does, measured.
//
//   node tools/vehicles.mjs [--json]
//
// The driving model is a handful of constants per type (`mass`, `top`, `acc`)
// and nobody had ever checked what they produce. This drives each vehicle at a
// fixed 60 Hz on flat ground and reports 0-100 km/h, top speed, 100-0 braking
// distance and steady-state lateral grip, against the band a real vehicle of
// that class sits in.
//
// Flat ground on purpose: Seattle's real grades are steep enough to swamp a
// 0-100 time, and a bench that moves with the terrain measures the hill rather
// than the car. `groundAt` and `roadLift` are stubbed for the run and restored
// afterwards.
//
// Same lesson as tools/gait.mjs: three attempts at the gait were tuned against
// screenshots and none held up, and the rig found eight defects on its first
// run. Numbers first.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9231;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const JSON_OUT = process.argv.includes('--json');
// Keep in step with apps/auto/src/vehicles.js.
const ARCADE_PUNCH = 2.4;
// Braking is scaled the same way now (vehicles.js ARCADE_BRAKE), so its band
// gets divided by it for the same reason the accel band does. Keep in step.
const ARCADE_BRAKE = 2.2;
const ARCADE_GRIP = 2.2;

// Real-world bands per class, for the types we ship. 0-100 km/h in seconds,
// top speed in km/h, 100-0 braking in metres, lateral grip in g.
//
// These are ranges a competent example of the class actually occupies, not
// targets to hit exactly -- the point is to catch a bus that out-accelerates a
// hatchback, not to argue about a tenth.
//
// ACCELERATION is the exception. The game applies ARCADE_PUNCH to every
// throttle, because a real sedan's 8.6 s to 100 km/h feels broken to drive --
// you spend the whole time waiting. The RATIOS between classes stay real, so
// the accel band is divided by the same constant here and the check still
// catches a van out-dragging a sports car. BRAKING is now scaled the same way
// by ARCADE_BRAKE and its band is divided to match -- it was the one axis left
// at real-world scale, which is precisely why it felt slow next to a throttle
// running at 2.4x. Top speed is compared against the real figures unchanged.
//
// GRIP is no longer checked against a real-world band at all, and pretending
// otherwise would be dishonest. Steering is a game control here: grip does not
// limit it, and a sedan corners at several g on purpose, because honest grip at
// 110 km/h is a 49 m radius and a city built from real street widths is not
// drivable at that.
//
// What still matters is that the CLASSES stay separated -- a bus must not
// corner like a sports car. So the check is that every type's measured lateral
// acceleration is proportional to its declared `latG`, within a tolerance, and
// the absolute figure is reported for information. That catches the regression
// worth catching without asserting something untrue.
const BANDS = {
  sedan: { name: 'mid-size sedan', accel: [7.5, 11], top: [190, 235], brake: [36, 44], lat: [0.82, 0.92] },
  hatch: { name: 'small hatchback', accel: [9, 13], top: [170, 200], brake: [36, 45], lat: [0.80, 0.90] },
  compact: { name: 'city car', accel: [11, 16], top: [150, 180], brake: [38, 47], lat: [0.78, 0.88] },
  suv: { name: 'mid-size SUV', accel: [7.5, 11], top: [180, 215], brake: [38, 46], lat: [0.75, 0.85] },
  sports: { name: 'sports coupe', accel: [4, 5.5], top: [250, 300], brake: [31, 36], lat: [0.95, 1.10] },
  ev: { name: 'performance EV', accel: [3, 4.5], top: [200, 260], brake: [33, 38], lat: [0.90, 1.02] },
  muscle: { name: 'muscle car', accel: [4.2, 6], top: [240, 290], brake: [33, 39], lat: [0.88, 1.00] },
  convertible: { name: 'muscle convertible', accel: [4.5, 6.5], top: [230, 270], brake: [34, 40], lat: [0.85, 0.95] },
  // Motorcycles. Both stop in a LONGER distance than any car here and the
  // cruiser corners below a family sedan: two contact patches, no weight
  // transfer to speak of and a rider who has to stay on it.
  cruiser: { name: 'cruiser motorcycle', accel: [4.5, 6], top: [180, 200], brake: [45, 52], lat: [0.75, 0.85] },
  sportbike: { name: 'sport motorcycle', accel: [3, 3.5], top: [270, 300], brake: [38, 42], lat: [1.00, 1.15] },
  pickup: { name: 'full-size pickup', accel: [6.5, 9], top: [170, 200], brake: [40, 50], lat: [0.72, 0.82] },
  van: { name: 'panel van', accel: [11, 16], top: [140, 170], brake: [42, 52], lat: [0.68, 0.78] },
  taxi: { name: 'taxi (sedan)', accel: [8, 12], top: [180, 220], brake: [36, 45], lat: [0.80, 0.90] },
  police: { name: 'police interceptor', accel: [5.5, 7], top: [210, 250], brake: [34, 40], lat: [0.88, 0.98] },
  bus: { name: 'city bus', accel: [22, 38], top: [80, 105], brake: [45, 60], lat: [0.55, 0.68] },
  boxtruck: { name: 'box truck', accel: [14, 22], top: [110, 140], brake: [45, 58], lat: [0.60, 0.72] },
  ambulance: { name: 'ambulance', accel: [9, 14], top: [140, 170], brake: [42, 54], lat: [0.65, 0.78] },
  garbage: { name: 'refuse truck', accel: [24, 42], top: [80, 100], brake: [48, 62], lat: [0.55, 0.68] },
};

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--window-size=900,640', '--no-first-run',
    '--user-data-dir=/tmp/auto-veh-profile', 'about:blank',
  ], { stdio: 'ignore' });
}

// Runs in the page. Everything is stepped at a fixed dt -- SwiftShader runs at
// about 4 fps and real-time traces exaggerate every per-frame delta by an order
// of magnitude, so wall-clock is useless here.
const BENCH = `(() => {
  const d = window.__dbg, city = d.city;
  const DT = 1 / 60;
  const KMH = 3.6;

  // Flat ground for the duration. A 20 % grade is worth several seconds on a
  // 0-100, and Seattle has plenty of those.
  const groundAt = city.groundAt, roadLift = city.roadLift;
  city.groundAt = () => 0;
  city.roadLift = () => 0;

  const out = {};
  try {
    for (const name of Object.keys(d.TYPES)) {
      const spec = d.TYPES[name];
      const fresh = () => {
        const v = d.traffic.spawnAt(0, 0, 0, name, 0x808080, 'free');
        v.y = 0; v.vLong = 0; v.vLat = 0;
        return v;
      };
      const drive = (v, input, steps) => { for (let i = 0; i < steps; i++) v.update(DT, input); };

      // Standing acceleration. A city bus and a refuse truck top out below
      // 100 km/h in life as well as here, so timing them to 100 measures
      // nothing -- they get the 0-80 the trade press actually quotes for them.
      const mark = spec.topKph < 110 ? 80 : 100;
      let v = fresh();
      let t = 0, accel = null;
      for (let i = 0; i < 60 * 120 && accel === null; i++) {
        v.update(DT, { throttle: 1, brake: 0, steer: 0, handbrake: 0 });
        t += DT;
        if (v.vLong * KMH >= mark) accel = t;
      }
      // Top speed: keep going and take the asymptote.
      drive(v, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, 60 * 120);
      const top = v.vLong * KMH;
      d.traffic.remove(v);

      // 100-0 braking distance.
      v = fresh();
      v.vLong = 100 / KMH;
      let dist = 0;
      for (let i = 0; i < 60 * 30 && v.vLong > 0.05; i++) {
        const before = v.vLong;
        v.update(DT, { throttle: 0, brake: 1, steer: 0, handbrake: 0 });
        dist += ((before + Math.max(v.vLong, 0)) / 2) * DT;
      }
      const brake = dist;
      d.traffic.remove(v);

      // Steady-state lateral grip: hold full lock at a fixed speed, let the
      // yaw settle, then read the radius the car is actually turning on.
      v = fresh();
      v.vLong = 14;
      drive(v, { throttle: 0.42, brake: 0, steer: 1, handbrake: 0 }, 60 * 4);
      const h0 = v.heading, sp = v.vLong;
      drive(v, { throttle: 0.42, brake: 0, steer: 1, handbrake: 0 }, 30);
      const yawRate = Math.abs(((v.heading - h0 + Math.PI) % (2 * Math.PI)) - Math.PI) / (30 * DT);
      const lat = yawRate * sp / 9.81;
      d.traffic.remove(v);

      out[name] = {
        accel: accel === null ? null : +accel.toFixed(2), mark,
        top: +top.toFixed(1),
        brake: +brake.toFixed(1),
        lat: +lat.toFixed(2),
        specTop: spec.top, specAcc: spec.acc, mass: spec.mass, latG: spec.latG, wheelbase: spec.wheelbase,
      };
    }
  } finally {
    city.groundAt = groundAt;
    city.roadLift = roadLift;
  }
  return JSON.stringify(out);
})()`;

const band = (v, [lo, hi]) => (v === null ? 'NONE' : v < lo ? 'LOW' : v > hi ? 'HIGH' : 'ok');

async function main() {
  const chrome = launch();
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try {
        page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
          .find((t) => t.type === 'page');
      } catch { /* not up */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise((res) => {
      ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res);
    });
    const evaluate = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
      if (r.result?.exceptionDetails) {
        throw new Error(r.result.exceptionDetails.exception?.description);
      }
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    // Bypass the service worker or you bench a stale build; disable the disk
    // cache or Chrome serves stale modules despite the bypass.
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await evaluate('!!window.__dbg && !!window.__dbg.TYPES')) break;
    }
    const res = JSON.parse(await evaluate(BENCH));

    if (JSON_OUT) { console.log(JSON.stringify(res, null, 2)); return; }

    console.log('type        class                 0-mark   top    100-0   lat g   (mark km/h)');
    console.log('                                    (s)  (km/h)     (m)        ');
    let bad = 0;
    for (const [name, r] of Object.entries(res)) {
      const b = BANDS[name];
      if (!b) { console.log(`${name}: no band`); continue; }
      const marks = [
        band(r.accel, b.accel.map((v) => v / ARCADE_PUNCH)), band(r.top, b.top),
        band(r.brake, b.brake.map((v) => v / ARCADE_BRAKE)), 'ok',
      ];
      bad += marks.filter((m) => m !== 'ok').length;
      const f = (v, m) => `${v === null ? '  --' : v.toFixed(v < 100 ? 1 : 0).padStart(6)}${m === 'ok' ? ' ' : '!'}`;
      console.log(
        `${name.padEnd(11)} ${b.name.padEnd(20)}`
        + `${f(r.accel, marks[0])}${f(r.top, marks[1])}${f(r.brake, marks[2])}${f(r.lat, marks[3])}`
        + `  ${r.mark}` + `   ${marks.filter((m) => m !== 'ok').length ? marks.map((m, i) => (m === 'ok' ? '' : ['accel', 'top', 'brake', 'grip'][i] + ' ' + m)).filter(Boolean).join(', ') : ''}`
      );
    }
    // Class separation, checked as ORDER rather than as a ratio.
    //
    // Measured cornering depends on wheelbase as well as grip -- a bus has six
    // metres of it and will always turn wider than its `latG` alone suggests --
    // so expecting lateral acceleration to track `latG` by a constant factor
    // produces false failures on exactly the vehicles that are behaving
    // correctly. What must hold is the ORDER: if one type is declared grippier
    // than another by a real margin, it has to out-corner it.
    // Compare within a category only. A motorcycle differs from a car in lean
    // and lateral damping as well as grip, and a heavy differs again, so a
    // cross-category pair is not a grip comparison at all -- it just produces
    // noise on vehicles that are behaving correctly.
    const MOTO = new Set(['cruiser', 'sportbike']);
    const HEAVY = new Set(['bus', 'boxtruck', 'garbage', 'ambulance', 'van']);
    const group = (n) => (MOTO.has(n) ? 'moto' : HEAVY.has(n) ? 'heavy' : 'car');
    const rows = Object.entries(res).filter(([n]) => BANDS[n]);
    const wrong = [];
    for (const [na, ra] of rows) {
      for (const [nb, rb] of rows) {
        if (group(na) !== group(nb)) continue;
        if ((ra.latG || 0) - (rb.latG || 0) < 0.12) continue;
        // Compare lateral acceleration DIRECTLY. This used to multiply by the
        // wheelbase, and had to: the steering lock was a fixed radius curve, so
        // lat came out as v^2 * tan(steer) / L and geometry had to be divided
        // back out before grip was visible. The lock is now solved from the
        // grip itself (r = v^2 / a), which makes lat independent of wheelbase --
        // so multiplying by it no longer removes a bias, it ADDS one, and it
        // reported a short-wheelbase sports car as cornering worse than a
        // pickup that it out-corners by 0.7 g. Normalise for the model you have.
        if (ra.lat < rb.lat) {
          wrong.push(`${na} (latG ${ra.latG}) corners worse than ${nb} (latG ${rb.latG})`);
        }
      }
    }
    const lats = rows.map(([, r]) => r.lat);
    console.log(`\ncornering is arcade, not real: ${Math.min(...lats).toFixed(1)}-${Math.max(...lats).toFixed(1)} g`
      + ` measured, and deliberately so -- honest grip is a 49 m radius at 110 km/h.`);
    console.log(`class order across ${rows.length} types: ${wrong.length ? 'BROKEN' : 'holds'}`);
    for (const w of wrong.slice(0, 5)) console.log(`  ${w}`);
    bad += wrong.length;
    console.log(`\n${bad} figures outside their band, of ${Object.keys(res).length * 3}`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('vehicle bench failed:', e.message); process.exitCode = 1; });
