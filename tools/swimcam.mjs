// The player's swimming, as the game shows it and as numbers.
//
//   node tools/swimcam.mjs <outdir> [swim|sprint|tread|in|out] [chase,side,above,front]
//   SWIM_PROBE=1 node tools/swimcam.mjs <outdir> swim     (numbers only, no shots)
//
// Boots the game, drops the player into open water in Lake Union and swims
// at a fixed 1/60 through player.update (the real input path), then shoots
// SWIM_N frames (default 8) every SWIM_STEP frames (default 5) from each named
// camera. `tread` stops first and films treading water; `in` films the frames
// after walking off the seaplane float, `out` swimming onto it.
//
// The probe prints, per frame through two stroke cycles, each hand's position
// in the BODY's travel frame -- fwd (along the heading, from the shoulders'
// midpoint), up (from the water surface) and out (away from the midline on
// its own side) -- and its fore-aft speed relative to the body. A front crawl
// pulls UNDER the water with the hand moving BACKWARD and recovers OVER it
// moving forward; the table states which it is.
import { launchChrome, assertRenderer } from './chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT = +process.env.AUTO_CDP_PORT || 9244;
const OUT = process.argv[2]; const MODE = process.argv[3] || 'swim';
const CAMS = (process.argv[4] || 'chase,side,above').split(',');
const N = +(process.env.SWIM_N || 8), STEP = +(process.env.SWIM_STEP || 5);
const PROBE = process.env.SWIM_PROBE === '1';
mkdirSync(OUT, { recursive: true });
const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-swimcam-${PORT}`, width: 1280, height: 720 });
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(300); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
  const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${process.env.AUTO_HTTP_PORT || 8000}/apps/auto/` });
  for (let i = 0; i < 400; i++) { await sleep(500); if (await evaluate('!!window.__dbg')) break; }
  await assertRenderer(evaluate); await sleep(2000);
  const setup = await evaluate(`(() => { const d = window.__dbg, P = d.player, T = d.traffic;
    d.applyQuality('high', true);
    for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    d.game.paused = true; d.peds.peds.forEach((p) => { p.h.group.visible = false; });
    if (P.vehicle) P.exitVehicle(true);
    const mode = '${MODE}';
    const V = (x, y, z) => ({ x, y, z });
    const stepN = (n, inp) => { for (let i = 0; i < n; i++) { P.update(1 / 60, inp, { x: 0, y: 0 }, d.controls, T, d.peds); d.world.update(P.x, P.z, 2); } };
    window.__inp = { x: 0, y: mode === 'tread' ? 0 : -1, sprint: mode === 'sprint', attack: false, jump: false };
    if (mode === 'in') {
      // running off something into open water, 1.2 m up
      P.x = 300; P.z = -2600; P.y = P.waterAt(300, -2600) + 1.2; P.grounded = false; P.vy = 0; P.fellFrom = P.y;
      P.heading = ${+(process.env.SWIM_HEADING ?? -Math.PI / 2)}; P.speed = 5;
    } else if (mode === 'out') {
      // the seaplane float runs x -102.5..-99.5, z -1986..-1934, the lake to
      // its east: swim at it from 2 m out and haul out over its curb
      P.x = -97.5; P.z = -1960; P.y = 8; P.grounded = false; P.vy = 0; P.fellFrom = 8;
      P.heading = -Math.PI / 2;
    } else {
      P.x = 300; P.z = -2600; P.y = 12; P.grounded = false; P.vy = 0; P.fellFrom = 12;
      P.heading = ${+(process.env.SWIM_HEADING ?? -Math.PI / 2)};
    }
    P.camYaw = P.heading + Math.PI; P.health = 100; d.game.dead = false;
    for (let i = 0; i < 240 && !P.swimming; i++) stepN(1, { x: 0, y: mode === 'in' ? -1 : 0, sprint: false });
    if (mode === 'out') stepN(60, { x: 0, y: 0 });
    if (mode !== 'in') P.camYaw = P.heading + Math.PI;
    if (mode === 'swim' || mode === 'sprint') stepN(150, window.__inp);
    if (mode === 'tread') stepN(150, window.__inp);
    window.__stepN = stepN;
    window.__shot = (n, cam) => {
      stepN(n, window.__inp);
      P.applyCamera(d.camera);
      const h = P.heading, fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
      const wl = P.waterAt(P.x, P.z) ?? P.y;
      const cx = P.x + fx * 0.6, cz = P.z + fz * 0.6;
      if (cam === 'side') { d.camera.position.set(cx - rx * 2.6, wl + 0.5, cz - rz * 2.6); d.camera.lookAt(cx, wl + 0.05, cz); }
      if (cam === 'above') { d.camera.position.set(cx - fx * 1.0, wl + 3.4, cz - fz * 1.0); d.camera.lookAt(cx, wl, cz); }
      if (cam === 'front') { d.camera.position.set(cx + fx * 2.8 - rx * 1.0, wl + 0.6, cz + fz * 2.8 - rz * 1.0); d.camera.lookAt(cx, wl + 0.1, cz); }
      d.camera.updateMatrixWorld(true);
      d.sun.position.set(P.x - 215, P.y + 200, P.z - 150); d.sun.target.position.set(P.x, P.y, P.z); d.sun.target.updateMatrixWorld();
      return [P.swimming, P.speed.toFixed(2), P.x.toFixed(1), P.z.toFixed(1), (P.swimSt ? P.swimSt.u : P.swimPhase || 0).toFixed(2)];
    };
    // the probe: hands in the travel frame, per frame
    window.__probe = (n) => {
      const rows = [], b = P.h.bones, BN = d.BONES || {};
      const v = new d.THREE.Vector3();
      const at = (bone) => { bone.getWorldPosition(v); return [v.x, v.y, v.z]; };
      const strokes = [];
      const g0 = P.game.onSwimStroke; P.game.onSwimStroke = (x, y, z) => { strokes.push([x, y, z, rows.length]); };
      for (let i = 0; i < n; i++) {
        stepN(1, window.__inp);
        P.h.group.updateMatrixWorld(true);
        const h = P.heading, fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
        const wl = P.waterAt(P.x, P.z) ?? 0;
        const sL = at(b[6]), sR = at(b[9]);
        const mx = (sL[0] + sR[0]) / 2, mz = (sL[2] + sR[2]) / 2;
        const rel = (p, side) => [ (p[0] - mx) * fx + (p[2] - mz) * fz, p[1] - wl, side * ((p[0] - mx) * rx + (p[2] - mz) * rz) ];
        // which bone is on the swimmer's right? the one whose shoulder is
        const sideL = ((sL[0] - mx) * rx + (sL[2] - mz) * rz) > 0 ? 1 : -1;
        const hL = rel(at(b[8]), sideL), hR = rel(at(b[11]), -sideL);
        const head = rel(at(b[5]), 1), fL = rel(at(b[14]), sideL), fR = rel(at(b[17]), -sideL), hip = rel(at(b[1]), 1);
        const q = new d.THREE.Quaternion(), pn = (bone, sx) => { bone.getWorldQuaternion(q); const n = new d.THREE.Vector3(sx, 0, 0).applyQuaternion(q); return [n.x * fx + n.z * fz, n.y, n.x * rx + n.z * rz]; };
        const fq = new d.THREE.Quaternion(); b[5].getWorldQuaternion(fq); const fn = new d.THREE.Vector3(0, 0, 1).applyQuaternion(fq);
        rows.push({ face: [fn.x * fx + fn.z * fz, fn.y, fn.x * rx + fn.z * rz], palmL: pn(b[8], 1), palmR: pn(b[11], -1), eL: rel(at(b[7]), sideL), eR: rel(at(b[10]), -sideL), ph: P.swimSt ? P.swimSt.u : P.swimPhase, hL, hR, head, fL, fR, hip, sideL, rx: P.h.group.rotation.x, wristL: rel(at(b[18]), sideL) });
      }
      P.game.onSwimStroke = g0;
      return { rows, strokes, wl: P.waterAt(P.x, P.z) };
    };
    return [P.swimming, P.x.toFixed(1), P.z.toFixed(1), P.y.toFixed(2), P.waterAt(P.x, P.z)];
  })()`);
  console.log('setup', setup);
  if (PROBE) {
    const r = await evaluate(`(() => { const p = window.__probe(${+(process.env.SWIM_PROBE_N || 100)}); return p; })()`);
    const f = (a) => a.map((x) => (x >= 0 ? ' ' : '') + x.toFixed(2)).join(' ');
    console.log(`L is on the swimmer's ${r.rows[0].sideL > 0 ? 'RIGHT' : 'LEFT'}; columns: fwd up out (m), dfwd = hand's fore-aft speed relative to the body (m/s)`);
    console.log(' i   phase |  hand L: fwd   up   out  dfwd |  hand R: fwd   up   out  dfwd | head fwd up | hip up | feet up L R | pitch');
    const rows = r.rows;
    const tally = { L: { pullBack: 0, pullFwd: 0, recBack: 0, recFwd: 0 }, R: { pullBack: 0, pullFwd: 0, recBack: 0, recFwd: 0 } };
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i], p = rows[i - 1];
      const dL = (a.hL[0] - p.hL[0]) * 60, dR = (a.hR[0] - p.hR[0]) * 60;
      for (const [k, hnd, dv] of [['L', a.hL, dL], ['R', a.hR, dR]]) {
        const under = hnd[1] < 0;
        if (Math.abs(dv) > 0.15) tally[k][(under ? 'pull' : 'rec') + (dv < 0 ? 'Back' : 'Fwd')]++;
      }
      if (i % (+process.env.SWIM_EVERY || 2) === 0) console.log(`${String(i).padStart(3)} ${a.ph.toFixed(2).padStart(6)} | ${f(a.hL)} ${(dL >= 0 ? ' ' : '') + dL.toFixed(2)} | ${f(a.hR)} ${(dR >= 0 ? ' ' : '') + dR.toFixed(2)} | ${f(a.head.slice(0, 2))} | ${a.hip[1].toFixed(2)} | ${a.fL[1].toFixed(2)} ${a.fR[1].toFixed(2)} | ${a.rx.toFixed(2)} | elbow up ${a.eL[1].toFixed(2)} ${a.eR[1].toFixed(2)} | palm fwd/up L ${f(a.palmL.slice(0, 2))} R ${f(a.palmR.slice(0, 2))} | face fwd/up/right ${f(a.face)}`);
    }
    // the palm's largest turn in one frame: a twist flip shows here
    for (const k of ['palmL', 'palmR']) {
      let worst = 0, at = 0;
      for (let i = 1; i < rows.length; i++) { const p = rows[i - 1][k], q = rows[i][k]; const c = Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))); if (c > worst) { worst = c; at = i; } }
      console.log(`${k}: largest turn in one frame ${(worst * 180 / Math.PI).toFixed(1)} deg at frame ${at}`);
    }
    console.log('frames moving >0.15 m/s fore-aft relative to the body (under water / above):', JSON.stringify(tally));
    console.log('stroke events (frame: hand positions at that frame):');
    for (const s of r.strokes) { const a = rows[s[3] - 1]; if (a) console.log(`  frame ${s[3]} at body+(${((s[0] - 0)).toFixed(1)},${s[2].toFixed(1)}) handL ${f(a.hL)} handR ${f(a.hR)}`); }
  } else {
    for (let k = 0; k < N; k++) {
      for (const cam of CAMS) {
        const r = await evaluate(`window.__shot(${k && cam === CAMS[0] ? STEP : 0}, '${cam}')`);
        await sleep(700);
        const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
        writeFileSync(`${OUT}/${cam}${String(k).padStart(2, '0')}.jpg`, Buffer.from(result.data, 'base64'));
        if (k === 0 && cam === CAMS[0]) console.log('swimming/speed/pos/phase', r);
      }
    }
  }
} finally { chrome.kill(); }
process.exit(0);
