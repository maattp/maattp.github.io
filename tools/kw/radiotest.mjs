// Auto KW: does every radio station REALLY play, and at a proper level?
//
//   node tools/kw/radiotest.mjs [--secs 50] [--only 0,3,7] [--no-content] [--no-game]
//   (python3 -m http.server $AUTO_HTTP_PORT from the repo root; AUTO_GPU=1 boots faster)
//   RADIO_PY=<python with numpy [+ faster-whisper]>   default tools/.venv/bin/python
//
// "The element's currentTime advanced" is not enough, and it is what an
// earlier check tested: a stream that plays a looping "this stream is not
// available in your area", or silence, or zeros through Web Audio, passes it.
// So, for every station in audio.js STATIONS:
//
// CONTENT (tools/kw/radioprobe.py): the stream's HTTP status and CORS as a
//   page on polkiewicz.com would see them, then ~50 s of it through ffmpeg --
//   integrated loudness (LUFS), % silent, a loop score, and a whisper
//   transcript of the start and end (if faster-whisper is installed) checked
//   for "not available" / "only available within Canada" and the like.
// GAME: the real game in headless Chrome (autoplay allowed), the player put in
//   a car and the station tuned through audio.setStation, then 8 s of what the
//   radio actually puts out: an AnalyserNode on audio.musicDuck (stream on the
//   'wa' route and the synth alike), scaled by the pre and master gains it
//   still passes, so `out` is dBFS RMS at the speakers. A station on the
//   'direct' route (no Web Audio) is measured by a probe element on the same
//   URL times the element's volume, and says so.
//
// A station PASSES when: status 200, CORS ok, >= 80 % of the capture arrived,
// LUFS > -30, < 20 % silent, loop < 0.95 or a transcript without a "not
// available" message, and in the game it reached 'playing' (synth stations:
// their synth voice), never fell back to the synth, and its output RMS is
// within -30..-12 dBFS with < 25 % of 100 ms windows silent.
// Exit code 1 if any station fails.

import { launchChrome } from '../chrome.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SECS = +opt('--secs', 50);
const ONLY = opt('--only', null)?.split(',').map(Number);
const DO_CONTENT = !argv.includes('--no-content');
const DO_GAME = !argv.includes('--no-game');
const ORIGIN = 'https://polkiewicz.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const BLOCKED = /not available|only available|unavailable|outside (of )?canada|your (area|location|region|country)|stream you are trying|distribution rights/i;

// --- the station list, read from audio.js's source ------------------------------
function stations() {
  const src = readFileSync(path.join(ROOT, 'apps/autokw/src/audio.js'), 'utf8');
  const block = src.slice(src.indexOf('const STATIONS = ['), src.indexOf('];', src.indexOf('const STATIONS = [')));
  const out = [];
  for (const m of block.matchAll(/\{ name: '([^']+)'([^}]*)\}/g)) {
    const body = m[2];
    out.push({
      i: out.length, name: m[1],
      stream: (body.match(/stream: '([^']+)'/) || [])[1] || null,
      lufs: +((body.match(/lufs: (-?[\d.]+)/) || [])[1] ?? NaN),
      hls: /hls: true/.test(body),
    });
  }
  return out;
}

// --- HTTP: status and CORS as the browser sees them --------------------------------
async function head(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { Origin: ORIGIN, 'User-Agent': UA }, redirect: 'follow', signal: ac.signal });
    const acao = r.headers.get('access-control-allow-origin');
    // a duplicated header arrives joined ("*, *"), which a browser rejects
    const cors = acao === '*' || acao === ORIGIN ? 'ok' : acao ? `bad (${acao})` : 'none';
    const type = (r.headers.get('content-type') || '').split(';')[0];
    try { ac.abort(); } catch { /* done */ }
    return { status: r.status, cors, type };
  } catch (e) {
    return { status: 0, cors: '-', type: String(e.name) };
  } finally { clearTimeout(t); }
}

// --- CONTENT: radioprobe.py ----------------------------------------------------------
function content(urls) {
  const py = process.env.RADIO_PY
    || [path.join(ROOT, 'tools/.venv/bin/python'), '/Users/matt/dev/maattp.github.io/tools/.venv/bin/python'].find(existsSync)
    || 'python3';
  return new Promise((res) => {
    const p = spawn(py, [path.join(HERE, 'radioprobe.py'), String(SECS), ...urls], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      const m = new Map();
      for (const l of out.split('\n')) { try { const d = JSON.parse(l); m.set(d.url, d); } catch { /* not json */ } }
      if (!m.size) console.log('  radioprobe produced nothing:', err.slice(-400));
      res(m);
    });
  });
}

// --- GAME ------------------------------------------------------------------------------
async function game(list) {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-radio-profile-${PORT}`,
    extra: ['--autoplay-policy=no-user-gesture-required'] });
  const res = new Map();
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
    const send = (method, params = {}) => new Promise((r) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, r); });
    const evaluate = async (e, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise });
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
      up = await evaluate('!!(window.__dbg && window.__dbg.world && window.__dbg.audio && window.__dbg.traffic)');
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 3).join(' | '));
    await sleep(3000);
    // into a car, sound on
    const car = await evaluate(`(() => {
      const d = window.__dbg, a = d.audio;
      a.init(); a.resume(); a.primeLive();
      a.enabled = true; a.musicOn = true;
      const v = d.traffic.nearestEnterable(d.player.x, d.player.z, 400);
      if (!v) return 'no car';
      d.player.enterVehicle(v);
      return v.type || 'car';
    })()`);
    console.log(`  booted; in a ${car}; exceptions ${errs.length}`);
    await sleep(2000);
    // the meter: musicDuck's output (stream on the 'wa' route, or the synth)
    await evaluate(`(() => {
      const a = window.__dbg.audio, c = a.ctx;
      window.__rt = { tap: c.createAnalyser() };
      window.__rt.tap.fftSize = 2048;
      a.musicDuck.connect(window.__rt.tap);
    })()`);
    for (const st of list) {
      if (ONLY && !ONLY.includes(st.i)) continue;
      const t0 = Date.now();
      await evaluate(`window.__dbg.audio.setStation(${st.i}); window.__dbg.audio.log.length = 0;`);
      let state = 'idle';
      for (let k = 0; k < 60; k++) {
        await sleep(500);
        state = await evaluate('window.__dbg.audio._liveState + (window.__dbg.audio._liveFailed ? "/failed" : "")');
        if (!st.stream || state === 'playing' || state.endsWith('failed')) break;
      }
      const startS = (Date.now() - t0) / 1000;
      await sleep(2500);
      const m = await evaluate(`(async () => {
        const a = window.__dbg.audio, c = a.ctx, el = a._live, tap = window.__rt.tap;
        const st = ${JSON.stringify(st)};
        const live = !!st.stream && a.liveOn;
        const route = st.stream ? (live ? a._liveRoute : 'synth (fallback)') : 'synth';
        let an = tap, scale = 0.9 * a.master.gain.value, probe = null;
        if (live && route === 'direct') {
          // the element is not in Web Audio: a probe on the same URL, times its volume
          probe = new window.Audio(); probe.crossOrigin = 'anonymous'; probe.src = el.currentSrc || el.src;
          an = c.createAnalyser(); an.fftSize = 2048;
          c.createMediaElementSource(probe).connect(an);
          await probe.play().catch(() => {});
          await new Promise((r) => setTimeout(r, 4000));
          scale = el.volume;
        }
        const ct0 = el ? el.currentTime : 0;
        const buf = new Float32Array(an.fftSize);
        const win = [];
        for (let i = 0; i < 80; i++) {
          await new Promise((r) => setTimeout(r, 100));
          an.getFloatTimeDomainData(buf);
          let s = 0; for (const v of buf) s += v * v;
          win.push(s / buf.length);
        }
        if (probe) { probe.pause(); probe.src = ''; }
        const db = (p) => 10 * Math.log10(p * scale * scale + 1e-12);
        const mean = win.reduce((x, y) => x + y, 0) / win.length;
        return {
          route, state: a._liveState, failed: a._liveFailed,
          // a probe that hears zeros: the stream has no usable CORS, so its level is unknowable here
          out: probe && mean === 0 ? null : +db(mean).toFixed(1),
          silent: Math.round(100 * win.filter((p) => db(p) < -50).length / win.length),
          adv: el && live ? +(el.currentTime - ct0).toFixed(1) : null,
          gain: route === 'wa' ? +a.radioGain.gain.value.toFixed(2) : route === 'direct' ? +el.volume.toFixed(2) : +a.musicBus.gain.value.toFixed(2),
          log: a.log.filter((l) => /radio/.test(l)).slice(-3),
        };
      })()`, true);
      m.start = +startS.toFixed(1);
      res.set(st.i, m);
      console.log(`  [game] ${st.name.padEnd(30)} ${m.route.padEnd(16)} out ${m.out} dBFS  silent ${m.silent}%  start ${m.start}s  ${m.log.join(' / ')}`);
    }
    console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
    res.exceptions = errs.length;
  } finally {
    chrome.kill('SIGKILL');
  }
  return res;
}

// --- the table ------------------------------------------------------------------------
async function main() {
  const list = stations();
  const live = list.filter((s) => s.stream && (!ONLY || ONLY.includes(s.i)));
  console.log(`${list.length} stations, ${live.length} streams to test`);
  const heads = new Map(await Promise.all(live.map(async (s) => [s.i, await head(s.stream)])));
  const contentP = DO_CONTENT ? content(live.map((s) => s.stream)) : Promise.resolve(new Map());
  const gameR = DO_GAME ? await game(list) : new Map();
  const cont = await contentP;
  const rows = [];
  let bad = 0;
  for (const st of list) {
    if (ONLY && !ONLY.includes(st.i)) continue;
    const h = heads.get(st.i) || {};
    const c = st.stream ? cont.get(st.stream) : null;
    const g = gameR.get(st.i);
    const why = [];
    if (st.stream) {
      if (h.status !== 200) why.push(`http ${h.status}`);
      if (h.cors !== 'ok') why.push(`cors ${h.cors}`);
      if (DO_CONTENT) {
        if (!c || c.secs < 0.8 * SECS) why.push(`only ${c ? c.secs : 0} s arrived`);
        else {
          if (c.lufs < -30) why.push(`LUFS ${c.lufs}`);
          if (c.silent > 20) why.push(`${c.silent}% silent`);
          if (c.text && BLOCKED.test(c.text)) why.push('says not available');
          if (c.repeat >= 0.95 && !(c.text && c.text.length > 40 && !BLOCKED.test(c.text))) why.push('loops');
        }
      }
    }
    if (DO_GAME) {
      if (!g) why.push('not tuned');
      else {
        if (st.stream && (g.state !== 'playing' || g.failed)) why.push(`game: ${g.route}`);
        if (g.out === null) why.push('direct route, level unmeasurable');
        else {
          if (g.out < -30 || g.out > -12) why.push(`out ${g.out} dBFS`);
          if (g.silent > 25) why.push(`game ${g.silent}% silent`);
        }
      }
    }
    if (why.length) bad++;
    rows.push({ st, h, c, g, why });
  }
  const pad = (s, n) => String(s ?? '-').slice(0, n).padEnd(n);
  console.log('\n| # | station | URL | http | CORS | LUFS (set) | silent | loop | transcript | route | gain | out dBFS | game silent | ok |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const { st, h, c, g, why } of rows) {
    const url = st.stream ? st.stream.replace(/^https:\/\//, '').slice(0, 48) : '(synth)';
    const text = c && c.text ? c.text.replace(/\|/g, '/').slice(0, 60) : '-';
    console.log(`| ${st.i} | ${st.name} | ${url} | ${st.stream ? h.status : '-'} | ${st.stream ? h.cors : '-'} | ${c ? c.lufs : '-'} (${isNaN(st.lufs) ? '-' : st.lufs}) | ${c ? c.silent + '%' : '-'} | ${c ? c.repeat : '-'} | ${text} | ${g ? g.route : '-'} | ${g ? g.gain : '-'} | ${g ? g.out : '-'} | ${g ? g.silent + '%' : '-'} | ${why.length ? 'FAIL: ' + why.join(', ') : 'pass'} |`);
  }
  const outs = rows.filter((r) => r.g && r.g.state === 'playing' && r.st.stream).map((r) => r.g.out);
  if (outs.length) console.log(`\nstreams' game output spread: ${Math.min(...outs)} .. ${Math.max(...outs)} dBFS`);
  // a stream whose measured loudness has drifted from its `lufs` by > 4 dB
  for (const { st, c } of rows) {
    if (c && c.lufs != null && !isNaN(st.lufs) && Math.abs(c.lufs - st.lufs) > 4) console.log(`  note: ${st.name} measured ${c.lufs} LUFS, audio.js says ${st.lufs}`);
  }
  console.log(bad ? `\n${bad} station(s) FAIL` : '\nevery station passes');
  if (bad || gameR.exceptions) process.exitCode = 1;
}

main().catch((e) => { console.error('radiotest failed:', e.message); process.exitCode = 1; });
