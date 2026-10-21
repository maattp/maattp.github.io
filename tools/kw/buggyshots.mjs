// Auto KW: the horse and buggy (apps/autokw/src/buggy.js) on a plain stage --
// side, three-quarter, front, rear and close views, and a strip of each gait
// through its stride, posed at dt = 0. Seconds, not a game boot.
//
//   node tools/kw/buggyshots.mjs <outdir> [view,view...]
//   AUTO_HTTP_PORT (a static server at the repo root), AUTO_CDP_PORT, AUTO_GPU=1
//
// Views: side, q34, front, rear, close, top, turn, park, and walk / trot /
// canter (eight phases each, side on, written as <gait>-<k>.png).

import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9431;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/buggyshots';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;

const VIEWS = [
  { name: 'side', pose: { speed: 0 }, cam: { eye: [-11, 1.4, 0.2], at: [0, 1.0, 0.2] } },
  { name: 'q34', pose: { speed: 3.3, ph: 0.15 }, cam: { eye: [-7.5, 2.4, 7.5], at: [0, 1.0, 0.4] } },
  { name: 'front', pose: { speed: 0 }, cam: { eye: [-2.2, 1.6, 9], at: [0, 1.1, 0] } },
  { name: 'rear', pose: { speed: 0 }, cam: { eye: [2.5, 1.7, -10], at: [0, 1.1, -1] } },
  { name: 'close', pose: { speed: 1.4, ph: 0.3 }, cam: { eye: [-3.6, 1.7, 3.0], at: [0, 1.3, 1.6] } },
  { name: 'hside', pose: { speed: 0 }, cam: { eye: [-6.5, 1.2, 1.35], at: [0, 1.05, 1.35] } },
  { name: 'head', pose: { speed: 0 }, cam: { eye: [-1.8, 1.9, 3.6], at: [0, 1.7, 2.6] } },
  { name: 'top', pose: { speed: 0, art: 0.4 }, cam: { eye: [0.01, 14, 0], at: [0, 0, 0] } },
  { name: 'turn', pose: { speed: 3.3, ph: 0.4, art: 0.45, steer: 0.8 }, cam: { eye: [-6, 3.2, -7], at: [0, 1.0, -0.5] } },
  { name: 'park', pose: { speed: 0, mode: 'apron', still: 10 }, cam: { eye: [7, 1.8, 4], at: [0, 1.0, 0.3] } },
  { name: 'chase', pose: { speed: 3.3, ph: 0.2 }, cam: { eye: [0, 3.3, -12], at: [0, 1.2, 1] } },
];
for (const [g, speed] of [['walk', 1.6], ['trot', 3.4], ['canter', 7.5]]) {
  for (let k = 0; k < 8; k++) VIEWS.push({ name: `${g}-${k}`, pose: { speed, ph: k / 8 }, cam: { eye: [-7.5, 1.3, 1.0], at: [0, 0.95, 1.0] }, size: [640, 400] });
}

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-buggy-profile-${PORT}`, width: 1280, height: 720 });
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
      if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'exception');
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errs.push(m.params.type + ': ' + (m.params.args || []).map((a) => a.value || a.description).join(' '));
    });
    const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
    const evaluate = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/tools/kw/buggystage.html` });
    for (let i = 0; i < 100; i++) {
      await sleep(200);
      if (await evaluate('!!(window.stage && window.stage.ready)')) break;
      if (errs.length) break;
    }
    if (errs.length) console.log('  errors:', errs.slice(0, 5).join('\n  '));
    const info = await evaluate(`(() => { const s = window.stage, g = s.v.buggy.mesh.geometry;
      return { horseTris: g.index.count / 3, bones: s.v.buggy.bones.length,
        cart: ['paintMesh','trimMesh','matteMesh'].map((k) => s.v[k].geometry.index.count / 3) }; })()`);
    console.log('  rig:', JSON.stringify(info));
    // contact: the fetlocks' height through each gait's stride (bind 0.275 m);
    // a planted hoof keeps its fetlock there, a lifted one is higher
    const contact = await evaluate(`(() => { const s = window.stage, R = s.v.buggy, p = new s.THREE.Vector3(), out = {};
      for (const [g, speed] of [['stand', 0], ['walk', 1.6], ['trot', 3.4], ['canter', 7.5]]) {
        let lo = 9, hi = 0, low2 = 0;
        for (let k = 0; k < 64; k++) {
          s.pose({ speed, ph: k / 64 }); s.v.group.updateMatrixWorld(true);
          const ys = [7, 10, 13, 16].map((i) => (R.bones[i].getWorldPosition(p), p.y)).sort((a, b) => a - b);
          lo = Math.min(lo, ys[0]); hi = Math.max(hi, ys[0]); low2 += ys[1];
        }
        out[g] = { lowestMin: +lo.toFixed(3), lowestMax: +hi.toFixed(3), secondMean: +(low2 / 64).toFixed(3), trunkBob: +R.bob.toFixed(3) };
      }
      return out; })()`);
    console.log('  fetlocks:', JSON.stringify(contact));
    // the horse's sounds (audio.js bank): rendered offline, peak / RMS / length per variant
    const snd = await evaluate(`(async () => { const A = await import('/apps/autokw/src/audio.js');
      const bank = await A.renderBank(44100, ['hoof', 'hoof_soft', 'snort', 'whinny']), out = {};
      for (const [k, list] of Object.entries(bank)) out[k] = list.map((b) => { const x = b.getChannelData(0); let pk = 0, ss = 0, bad = 0;
        for (const v of x) { if (!Number.isFinite(v)) bad++; pk = Math.max(pk, Math.abs(v)); ss += v * v; }
        return { s: +b.duration.toFixed(2), peak: +pk.toFixed(2), rms: +Math.sqrt(ss / x.length).toFixed(3), bad }; });
      return out; })()`);
    console.log('  sounds:', JSON.stringify(snd));
    mkdirSync(OUT, { recursive: true });
    for (const V of VIEWS) {
      if (ONLY && !ONLY.some((o) => V.name.startsWith(o))) continue;
      const [w, h] = V.size || [1280, 720];
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await evaluate(`(() => { const s = window.stage; s.renderer.setSize(${w}, ${h}); s.camera.aspect = ${w / h};
        s.pose(${JSON.stringify(V.pose)}); s.shoot(${JSON.stringify(V.cam)}); })()`);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${V.name}.png`, Buffer.from(result.data, 'base64'));
      console.log(`  ${OUT}/${V.name}.png`);
    }
    console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
  } finally {
    chrome.kill('SIGKILL');
  }
}
main().catch((e) => { console.error('buggyshots failed:', e.message); process.exitCode = 1; });
