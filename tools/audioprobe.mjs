// Acceptance probe for apps/auto's mix laws (guide/sound.md, "The mix").
// Renders scripted scenes through the game's own audio.js in an
// OfflineAudioContext and measures the mix at audio.master:
//
//   pause    the world bus: driving vs paused vs resumed RMS (radio off),
//            and a UI cue that must stay audible while the world is held
//   tank     the cannon window against the engine window before it
//   sirens   two cars hard-panned left/right; the instantaneous frequency of
//            each channel (zero crossings), cross-correlated -- two voices
//            must not sing in step (wail, yelp), plus fire hi-lo and SWAT rate
//
//   python3 -m http.server 8000 &
//   node tools/audioprobe.mjs [--only pause,tank,sirens]
//
// (AUTO_HTTP_PORT / AUTO_CDP_PORT as for the other harnesses.) Engine DC and
// the tank's cruise level are audiorender's: `node tools/audiorender.mjs
// --only engine-` prints both. Exits non-zero when a criterion fails.

import { launchChrome } from './chrome.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9231;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const ONLY = arg('--only', 'pause,tank,sirens').split(',');
const SR = 44100;

class Session {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.logs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

const PAGE = String.raw`
window.P = (async () => {
  const A = await import('/apps/auto/src/audio.js');
  const V = await import('/apps/auto/src/vehicles.js');
  const SR = ${SR};
  const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  // A scripted run through the live Audio class. The script returns false for a
  // frame main.js would not call audio.update() on (paused / map open).
  async function run(dur, script, opts = {}) {
    const rnd = Math.random;
    Math.random = mulberry(opts.seed || 12345);
    try {
      const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
      const au = new A.Audio();
      au.musicOn = !!opts.music;
      au.station = 1;
      au.init(ctx);
      await au.bankReady;
      const L = { x: 0, y: 1.5, z: 0, fx: 0, fz: -1, vx: 0, vz: 0 };
      const st = { inCar: false, onFoot: true, speed: 0, throttle: 0, brake: 0, skid: 0, listener: L,
        cars: [], surface: 'hard', footL: true, footR: true, footSpeed: 0, water: 0 };
      const dt = 1 / 60;
      for (let t = 0; t < dur - 0.05; t += dt) {
        au._simT = t;
        if (script(t, dt, st, au) !== false) au.update(dt, st);
      }
      const buf = await ctx.startRendering();
      return [buf.getChannelData(0), buf.getChannelData(1)];
    } finally { Math.random = rnd; }
  }
  const at = (t, dt, x) => t <= x && t + dt > x;
  // RMS (dBFS) of the L+R mean over [t0, t1)
  const rmsDb = (ch, t0, t1) => {
    let s = 0, n = 0;
    for (let i = Math.floor(t0 * SR); i < Math.floor(t1 * SR); i++) { const x = (ch[0][i] + ch[1][i]) / 2; s += x * x; n++; }
    return 20 * Math.log10(Math.sqrt(s / n) || 1e-9);
  };
  const peakDb = (ch, t0, t1) => {
    let p = 0;
    for (let i = Math.floor(t0 * SR); i < Math.floor(t1 * SR); i++) p = Math.max(p, Math.abs(ch[0][i]), Math.abs(ch[1][i]));
    return 20 * Math.log10(p || 1e-9);
  };

  function pause() {
    const cop = { x: -70, y: 0, z: -12, vLong: 0, mode: 'police', spec: V.TYPES.police, forward: { x: 1, z: 0 }, dead: false, siren: 0 };
    const tr = { x: 30, y: 0, z: -6, vLong: 10, mode: 'traffic', spec: V.TYPES.sedan, forward: { x: 1, z: 0 }, dead: false };
    return run(11, (t, dt, st, au) => {
      if (t === 0) { st.inCar = true; st.onFoot = false; st.spec = V.TYPES.sedan; au.enterVehicle(V.TYPES.sedan, true); }
      const held = t >= 5 && t < 8;
      au.holdWorld(held);                       // as main.js does, every frame
      if (held) { if (at(t, dt, 7.6)) au.ui('tick'); return false; }
      st.speed = 22; st.throttle = 0.6; st.brake = 0;
      st.amb = { water: 0, green: 0.1, road: 0.4, alt: 0 };
      st.cars = [cop, tr]; tr.x += tr.vLong * dt;
    }).then((ch) => ({
      driving: rmsDb(ch, 3, 5), paused: rmsDb(ch, 5.5, 7.5), uiPeak: peakDb(ch, 7.6, 7.9),
      resume0: rmsDb(ch, 8.0, 8.2), resume1: rmsDb(ch, 8.2, 8.5), after: rmsDb(ch, 9, 11),
    }));
  }

  function tank(tracks = true) {
    return run(7, (t, dt, st, au) => {
      if (t === 0) { st.inCar = true; st.onFoot = false; st.spec = V.TYPES.tank; au.enterVehicle(V.TYPES.tank, true); }
      st.speed = t < 1 ? 0 : Math.min(8, (t - 1) * 3); st.throttle = t < 1 ? 0 : 0.7; st.tracks = tracks ? st.speed : 0;
      if (at(t, dt, 4)) au.cannon();
      if (at(t, dt, 5.9)) au.explosion(20, -10);
    }).then((ch) => ({
      cruise: rmsDb(ch, 2.5, 3.9), before: rmsDb(ch, 3.4, 3.9), cannon: rmsDb(ch, 4.0, 4.4),
      explosion: rmsDb(ch, 5.9, 6.3),   // (the engine ducks under it too; not asserted: the bang dominates)
    }));
  }

  // instantaneous frequency by rising zero crossings per 50 ms
  const track = (x, t0, t1) => {
    const w = Math.floor(0.05 * SR), out = [];
    for (let o = Math.floor(t0 * SR); o + w <= Math.floor(t1 * SR); o += w) {
      let n = 0;
      for (let i = o + 1; i < o + w; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
      out.push(n / 0.05);
    }
    return out;
  };
  const corr = (a, b, lag = 0) => {
    const n = a.length - Math.abs(lag), A0 = lag >= 0 ? 0 : -lag, B0 = lag >= 0 ? lag : 0;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[A0 + i]; mb += b[B0 + i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const p = a[A0 + i] - ma, q = b[B0 + i] - mb; sab += p * q; saa += p * p; sbb += q * q; }
    return sab / Math.sqrt(saa * sbb || 1e-12);
  };
  async function sirens(specA, specB, dist, seed, opts = {}) {
    const mk = (spec, x) => ({ x, y: 0, z: 0, vLong: 0, mode: opts.fire ? 'traffic' : 'police', sirenOn: !!opts.fire,
      spec, forward: { x: 0, z: -1 }, dead: false, siren: 0 });
    const a = mk(specA, -dist), b = mk(specB, dist);
    const ch = await run(12, (t, dt, st) => { st.cars = [a, b]; }, { seed });
    const fa = track(ch[0], 1.5, 11.5), fb = track(ch[1], 1.5, 11.5);
    let best = 0;
    for (let lag = -10; lag <= 10; lag++) best = Math.max(best, Math.abs(corr(fa, fb, lag)));
    const sorted = fa.slice().sort((p, q) => p - q);
    const mean = fa.reduce((p, q) => p + q, 0) / fa.length;
    let flips = 0;
    for (let i = 1; i < fa.length; i++) if ((fa[i - 1] - mean) * (fa[i] - mean) < 0) flips++;
    return { xcorr0: corr(fa, fb, 0), xcorrMax: best, lo: sorted[Math.floor(sorted.length * 0.05)], hi: sorted[Math.floor(sorted.length * 0.95)],
      modHz: flips / 2 / 10 };
  }

  return { pause, tank, sirens, V, A };
})();
`;

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-audioprobe-profile-${PORT}`, width: 400, height: 300,
    extra: ['--autoplay-policy=no-user-gesture-required'] });
  let bad = 0;
  const check = (name, ok, detail) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`); };
  const f = (x) => x.toFixed(1);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
      if (!target) await sleep(300);
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const s = new Session(ws);
    await s.send('Runtime.enable');
    await s.send('Network.enable');
    await s.send('Network.setCacheDisabled', { cacheDisabled: true });
    await s.send('Page.enable');
    await s.send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/src/` });
    await sleep(1500);
    await s.eval(PAGE + '; true');
    const pre = arg('--set', null);   // a one-off tweak before the scenes, e.g. --set "p.A.ENGINES.tank.level=0.4"
    if (pre) await s.eval(`P.then(p => { ${pre}; return true; })`);
    const E = (expr) => s.eval(`P.then(p => ${expr})`);

    if (ONLY.includes('pause')) {
      const r = await E('p.pause()');
      console.log('pause', JSON.stringify(r, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v));
      check('paused RMS >= 25 dB below driving', r.paused <= r.driving - 25, `driving ${f(r.driving)}, paused ${f(r.paused)} dBFS (${f(r.driving - r.paused)} dB down)`);
      check('UI cue audible while paused', r.uiPeak > -45, `peak ${f(r.uiPeak)} dBFS`);
      check('engine back within 0.3 s', r.resume1 >= r.driving - 3, `0.2-0.5 s after resume ${f(r.resume1)} vs driving ${f(r.driving)} (0.0-0.2 s: ${f(r.resume0)})`);
    }
    if (ONLY.includes('tank')) {
      const bare = await E('p.tank(false)');
      console.log('tank, engine only', JSON.stringify(bare, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v));
      const r = await E('p.tank()');
      console.log('tank, with tracks', JSON.stringify(r, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v));
      check('cannon window >= 6 dB over the engine before it', r.cannon - r.before >= 6, `${f(r.before)} -> ${f(r.cannon)} dBFS (+${f(r.cannon - r.before)} dB)`);
    }
    if (ONLY.includes('sirens')) {
      for (const [label, dist] of [['wail', 85], ['yelp', 35]]) {
        let worst = 0, worstMax = 0;
        for (const seed of [12345, 7, 99, 2024, 31337]) {
          const r = await E(`p.sirens(p.V.TYPES.police, p.V.TYPES.police, ${dist}, ${seed})`);
          worst = Math.max(worst, Math.abs(r.xcorr0)); worstMax = Math.max(worstMax, r.xcorrMax);
        }
        check(`two police ${label}s decorrelated (|xcorr| < 0.5)`, worst < 0.5, `worst zero-lag |r| ${worst.toFixed(2)} over 5 seeds (any lag within 0.5 s: ${worstMax.toFixed(2)})`);
      }
      const fire = await E('p.sirens(p.V.TYPES.fireengine, p.V.TYPES.tiller, 60, 12345, { fire: true })');
      check('fire rigs sing hi-lo (two tones, slow)', fire.hi - fire.lo > 150 && fire.modHz > 0.4 && fire.modHz < 1.5,
        `5th-95th percentile ${fire.lo}..${fire.hi} Hz, ${fire.modHz.toFixed(2)} alternations/s`);
      const swat = await E('p.sirens(p.V.TYPES.swat, p.V.TYPES.swat, 85, 12345)');
      check('SWAT yelps fast', swat.modHz > 4, `${swat.modHz.toFixed(2)} sweeps/s, ${swat.lo}..${swat.hi} Hz`);
    }
    for (const l of s.logs) { console.log(l); bad++; }
  } finally {
    chrome.kill('SIGKILL');
  }
  console.log(bad ? `\nFAIL: ${bad} problem(s)` : '\nOK');
  process.exitCode = bad ? 1 : 0;
}

main().catch((e) => { console.error('audioprobe failed:', e.message); process.exitCode = 1; });
