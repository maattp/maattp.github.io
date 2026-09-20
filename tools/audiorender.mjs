// Offline listening harness for apps/auto's sound.
//
// Headless Chrome cannot hear, and its AudioContext stays suspended without a
// gesture, so this drives the game's OWN audio.js against OfflineAudioContexts
// in a page and writes WAVs a human can listen to, plus numbers a harness can
// judge: peak and RMS (dBFS), clipped samples, spectral centroid, and the share
// of the file that is silent.
//
//   python3 -m http.server 8000 &
//   node tools/audiorender.mjs [--only name,name] [--out docs/audio]
//
// What it renders:
//   sfx/<name>-<variant>.wav   every one-shot in the bank, raw (peak-normalised)
//   engine-<profile>.wav       get in (doors, starter), idle, full throttle up
//                              through the gears, lift off, brake, get out --
//                              the live Audio class, master chain and all
//   scene-*.wav                traffic pass-by with doppler, siren pass-by,
//                              police helicopter fly-over, crashes over the
//                              radio (ducking + limiter), footsteps on every
//                              surface, horns, water, a tunnel
//
// It exits non-zero when any file clips (|x| >= 0.999) or a file that should
// make noise is silent.

import { launchChrome } from './chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9230;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', 'docs/audio');
const ONLY = arg('--only', null);
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
      } else if (m.method === 'Runtime.consoleAPICalled') {
        this.logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
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

// --- the page side ---------------------------------------------------------------
// Everything below runs in the browser. `R` is the page's toolkit.
const PAGE = String.raw`
window.R = (async () => {
  const A = await import('/apps/auto/src/audio.js');
  const V = await import('/apps/auto/src/vehicles.js');
  const SR = ${SR};
  const pcm = (chans) => {
    // interleaved int16, base64
    const n = chans[0].length, c = chans.length;
    const i16 = new Int16Array(n * c);
    let clip = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) {
      const x = chans[k][i];
      if (Math.abs(x) >= 0.999) clip++;
      i16[i * c + k] = Math.max(-32767, Math.min(32767, Math.round(x * 32767)));
    }
    const u8 = new Uint8Array(i16.buffer);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { b64: btoa(s), channels: c, clip };
  };
  const bank = await A.renderBank(SR);
  const fake = {
    heli: { heli: true, topKph: 260, len: 12 },
    boat: { boat: true, topKph: 75, len: 6 },
    atv: { atv: true, topKph: 95, len: 2 },
    turboprop: { plane: true, turboprop: true, topKph: 520, len: 14 },
  };
  const specOf = (k) => fake[k] || V.TYPES[k];

  // A scripted run through the live Audio class, rendered offline.
  async function scene(dur, script, opts = {}) {
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
    const au = new A.Audio();
    au.musicOn = !!opts.music;
    au.station = 1;                     // a synth station: never the network
    au.init(ctx);
    await au.bankReady;
    const L = { x: 0, y: 1.5, z: 0, fx: 0, fz: -1, vx: 0, vz: 0 };
    const st = { inCar: false, onFoot: true, speed: 0, throttle: 0, brake: 0, skid: 0, listener: L,
      cars: [], surface: 'hard', footL: true, footR: true, footSpeed: 0, water: 0 };
    const dt = 1 / 60;
    for (let t = 0; t < dur - 0.05; t += dt) {
      au._simT = t;
      script(t, dt, st, au);
      au.update(dt, st);
    }
    const buf = await ctx.startRendering();
    return pcm([buf.getChannelData(0), buf.getChannelData(1)]);
  }

  function driveScript(specKey) {
    const spec = specOf(specKey);
    const top = (spec.topKph || 180) / 3.6;
    const kind = A.ENGINES[A.selectEngine(spec)].kind;
    let v = 0, entered = false, exited = false;
    return (t, dt, st, au) => {
      if (!entered) { entered = true; st.inCar = true; st.onFoot = false; st.spec = spec; au.enterVehicle(spec, false); }
      const flying = kind === 'plane' || kind === 'heli';
      let thr = 0, brake = 0;
      if (t < 2.2) thr = 0;
      else if (t < 3.0) thr = 0.35;                     // blip
      else if (t < 3.6) thr = 0;
      else if (t < 11) thr = 1;                         // flat out through the gears
      else if (t < 13) thr = 0;                         // lift: crackle, engine braking
      else if (t < 14.5) { thr = 0; brake = 1; }
      if (kind === 'heli') thr = t < 3.6 ? 0.2 : t < 11 ? 0.9 : 0.4;
      const acc = kind === 'car' || kind === 'ev' ? 7 : 4;
      if (t > 3.6) v += (thr * acc * (1 - v / top) - (brake ? 9 : 0.4) - (thr ? 0 : 1.2)) * dt;
      v = Math.max(0, v);
      st.speed = v; st.throttle = thr; st.brake = brake;
      st.airborne = flying && v > top * 0.28;
      st.onWater = kind === 'boat';
      st.skid = t > 3.6 && t < 4.1 && kind === 'car' ? 0.6 : brake && v > 8 ? 0.4 : 0;
      if (t > 15 && !exited) { exited = true; au.exitVehicle(spec, false); st.inCar = false; st.onFoot = true; st.spec = null; }
    };
  }

  const scenes = {
    'traffic-passby': [9, (() => {
      const car = (spec, x, z, vx) => ({ x, y: 0, z, vLong: Math.abs(vx), mode: 'traffic', spec: V.TYPES[spec],
        forward: { x: Math.sign(vx), z: 0 }, dead: false });
      const a = car('sedan', -90, -6, 22), b = car('bus', 110, -12, -14), c = car('sportbike', -140, -4, 38), d = car('muscle', 150, -8, -30);
      return (t, dt, st) => {
        st.cars = [a, b, c, d];
        for (const k of st.cars) { k.x += k.forward.x * k.vLong * dt; }
      };
    })()],
    'siren-passby': [10, (() => {
      const cop = { x: -160, y: 0, z: -8, vLong: 28, mode: 'police', spec: V.TYPES.police, forward: { x: 1, z: 0 }, dead: false, siren: 0 };
      const cop2 = { x: 220, y: 0, z: 20, vLong: 18, mode: 'police', spec: V.TYPES.police, forward: { x: -1, z: 0 }, dead: false, siren: 0 };
      return (t, dt, st) => { st.cars = [cop, cop2]; cop.x += cop.vLong * dt; cop2.x -= cop2.vLong * dt; };
    })()],
    'heli-flyover': [12, (t, dt, st) => { st.heli = { x: -300 + t * 50, y: 60, z: -30 }; }],
    'crashes-over-radio': [12, (t, dt, st, au) => {
      if (t === 0) { st.inCar = true; st.onFoot = false; st.spec = V.TYPES.sedan; au.enterVehicle(V.TYPES.sedan, true); }
      st.speed = 8; st.throttle = 0.3;
      const at = (x) => t <= x && t + dt > x;
      if (at(1.5)) au.crash(5);
      if (at(3)) au.crash(12);
      if (at(4.8)) au.crash(20);
      if (at(6.6)) au.crash(34);
      st.scrape = t > 7.8 && t < 9.4 ? 0.9 : 0;
      if (at(10)) au.explosion();
    }, { music: true }],
    'footsteps': [14, (() => {
      let ph = 0;
      return (t, dt, st) => {
        const seg = Math.floor(t / 3.5);
        st.surface = ['hard', 'grass', 'gravel', 'water'][Math.min(3, seg)];
        st.water = st.surface === 'water' ? 0.3 : 0;
        const run = (t % 3.5) > 1.8;
        st.footSpeed = run ? 5 : 1.4;
        ph += dt * (run ? 2.9 : 1.75);
        const u = ph % 1;
        st.footL = u < 0.5; st.footR = u >= 0.5;
      };
    })()],
    'horns': [6, (t, dt, st, au) => {
      const spec = t < 2 ? V.TYPES.sedan : t < 4 ? V.TYPES.bus : V.TYPES.cruiser;
      if (spec !== st.spec) { st.inCar = true; st.onFoot = false; st.spec = spec; au._spec = spec; au.hornKind = null; }
      if ((t % 2) < 1.2 && Math.floor(t * 60) % 24 === 0) au.horn();
    }],
    'wading-splash': [8, (t, dt, st, au) => {
      if (t === 0) { st.inCar = true; st.onFoot = false; st.spec = V.TYPES.suv; au.enterVehicle(V.TYPES.suv, true); }
      st.speed = t < 2 ? 12 : Math.max(0, 12 - (t - 2) * 3);
      st.throttle = 0.6;
      st.water = t > 2 ? 0.5 : 0;
      st.wading = t > 2;
      st.impactSpeed = 12;
    }],
    'tunnel': [9, (t, dt, st, au) => {
      if (t === 0) { st.inCar = true; st.onFoot = false; st.spec = V.TYPES.muscle; au.enterVehicle(V.TYPES.muscle, true); }
      st.enclosed = t > 3;
      st.throttle = (t % 3) < 1.6 ? 1 : 0;
      st.speed = 14 + (t % 3) * 4;
      if (Math.abs(t - 6.5) < 0.009) au.gunshot();
    }],
    'stings': [10, (t, dt, st, au) => {
      const at = (x) => t <= x && t + dt > x;
      if (at(0.2)) au.pickup(); if (at(1.2)) au.pickup('gun'); if (at(2.2)) au.cash();
      if (at(3.4)) au.wanted(1); if (at(5.4)) au.wanted(4);
      if (at(7.2)) au.ui('start'); if (at(7.7)) au.ui('tick'); if (at(8.0)) au.ui('go');
      if (at(8.7)) au.ui('check'); if (at(9.0)) au.ui('ring'); if (at(9.3)) au.ui('fail');
    }],
    'shots-far': [5, (t, dt, st, au) => {
      if (Math.abs(t - 0.3) < 0.009) au.gunshot();
      if (Math.abs(t - 1.3) < 0.009) au.gunshot(-30, -40);
      if (Math.abs(t - 2.3) < 0.009) au.gunshot(120, -200);
      if (Math.abs(t - 3.3) < 0.009) au.crash(22, 60, -50);
    }],
  };

  return {
    bankList: Object.entries(bank).map(([k, v]) => [k, v.length]),
    bankClip: (name, i) => pcm([bank[name][i].getChannelData(0)]),
    engines: Object.keys(A.ENGINES),
    engineFor: (profile) => ({ i4: 'hatch', v6: 'suv', v8: 'muscle', flat6: 'sports', diesel: 'bus', vtwin: 'cruiser',
      sportbike: 'sportbike', single: 'atv', ev: 'ev', piston: 'plane', turboprop: 'turboprop', heli: 'heli', outboard: 'boat' })[profile],
    engine: (profile) => scene(17, driveScript(({ i4: 'hatch', v6: 'suv', v8: 'muscle', flat6: 'sports', diesel: 'bus', vtwin: 'cruiser',
      sportbike: 'sportbike', single: 'atv', ev: 'ev', piston: 'plane', turboprop: 'turboprop', heli: 'heli', outboard: 'boat' })[profile])),
    scenes: Object.keys(scenes),
    scene: (k) => scene(scenes[k][0], scenes[k][1], scenes[k][2]),
    select: Object.fromEntries(Object.entries(V.TYPES).map(([k, s]) => [k, A.selectEngine(s)])),
  };
})();
`;

// --- node side: WAV + analysis -------------------------------------------------------

function wav(path, b64, channels) {
  const pcm = Buffer.from(b64, 'base64');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * channels * 2, 28); h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([h, pcm]));
  return pcm;
}

function fftMag(re) {
  const n = re.length, im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const tr = ar * wr - ai * wi, ti = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr; im[i + k] += ti;
      }
    }
  }
  const m = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(re[i], im[i]);
  return m;
}

function analyse(pcm, channels) {
  const n = pcm.length / 2 / channels;
  const mono = new Float64Array(n);
  let peak = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) {
      const x = pcm.readInt16LE((i * channels + c) * 2) / 32767;
      peak = Math.max(peak, Math.abs(x));
      s += x;
    }
    mono[i] = s / channels;
    sq += mono[i] * mono[i];
  }
  const rms = Math.sqrt(sq / n);
  // centroid over 2048-sample frames, energy-weighted; silence = frames under -60 dBFS
  const N = 2048;
  let cw = 0, ce = 0, frames = 0, silent = 0;
  for (let o = 0; o + N <= n; o += N) {
    const f = new Float64Array(N);
    let e = 0;
    for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); f[i] = mono[o + i] * w; e += mono[o + i] ** 2; }
    frames++;
    if (Math.sqrt(e / N) < 0.001) { silent++; continue; }
    const m = fftMag(f);
    let num = 0, den = 0;
    for (let k = 1; k < m.length; k++) { num += k * SR / N * m[k]; den += m[k]; }
    if (den > 0) { cw += (num / den) * e; ce += e; }
  }
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity).toFixed(1);
  return { peak, peakDb: db(peak), rmsDb: db(rms), centroid: ce ? Math.round(cw / ce) : 0, silent: frames ? silent / frames : 1, secs: n / SR };
}

async function main() {
  mkdirSync(`${OUT}/sfx`, { recursive: true });
  const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-audio-profile-${PORT}`, width: 400, height: 300,
    extra: ['--autoplay-policy=no-user-gesture-required'] });
  let bad = 0;
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
    const t0 = Date.now();
    const info = await s.eval('R.then(r => ({ bank: r.bankList, engines: r.engines, scenes: r.scenes, select: r.select }))');
    console.log(`bank rendered in ${((Date.now() - t0) / 1000).toFixed(2)} s (incl. module load): ${info.bank.reduce((a, b) => a + b[1], 0)} buffers`);
    console.log('engine per vehicle type:', JSON.stringify(info.select));
    const want = (n) => !ONLY || ONLY.split(',').some((o) => n.includes(o));
    const rows = [];
    const out = async (file, expr, expectSound = true) => {
      const r = await s.eval(`R.then(r => ${expr})`);
      const pcm = wav(`${OUT}/${file}`, r.b64, r.channels);
      const a = analyse(pcm, r.channels);
      const fail = r.clip > 0 || (expectSound && a.silent > 0.97);
      if (fail) bad++;
      rows.push([file, a.secs.toFixed(2), a.peakDb, a.rmsDb, a.centroid, (a.silent * 100).toFixed(0) + '%', r.clip, fail ? 'FAIL' : '']);
    };
    for (const [name, n] of info.bank) {
      for (let i = 0; i < n; i++) if (want(name)) await out(`sfx/${name}-${i}.wav`, `r.bankClip(${JSON.stringify(name)}, ${i})`);
    }
    for (const e of info.engines) if (want('engine-' + e)) await out(`engine-${e}.wav`, `r.engine(${JSON.stringify(e)})`);
    for (const k of info.scenes) if (want('scene-' + k)) await out(`scene-${k}.wav`, `r.scene(${JSON.stringify(k)})`);
    console.log('\nfile                               secs  peak dB  rms dB  centroid Hz  silent  clipped');
    for (const r of rows) {
      console.log(`${r[0].padEnd(34)} ${r[1].padStart(5)} ${String(r[2]).padStart(8)} ${String(r[3]).padStart(7)} ${String(r[4]).padStart(12)} ${r[5].padStart(7)} ${String(r[6]).padStart(8)} ${r[7]}`);
    }
    const ex = s.logs.filter((l) => /EXCEPTION/.test(l));
    if (ex.length) { console.log(ex.join('\n')); bad++; }
    console.log(`\n${bad ? 'FAIL' : 'OK'}: ${rows.length} files, ${bad} problems -> ${OUT}/`);
    process.exitCode = bad ? 1 : 0;
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('audiorender failed:', e.message); process.exitCode = 1; });
