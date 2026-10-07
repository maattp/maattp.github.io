// Fighting on foot, as the game shows it and as numbers.
//
//   node tools/meleecam.mjs <outdir> [combo|walkcombo|aim|walkaim] [side,chase,front]
//   MELEE_PROBE=1 node tools/meleecam.mjs <outdir> combo     (numbers only)
//
// Boots the game, clears the pedestrians, and stands one (MELEE_HP, default
// 40: the jab and the cross stagger them, the hook floors them) MELEE_DIST
// metres away (default 1.3) at MELEE_SIDE radians off the player's heading
// (default 0, straight ahead; + is to the left). The camera looks along the
// heading. Then, at a fixed 1/60 through player.update and peds.update (the
// real input path): ATTACK pressed on frames 0, 14 and 30 -- a jab, a cross
// and a hook -- or, armed (aim / walkaim), three shots on the same frames.
// `walk*` walks forward at a stroll throughout.
//
// Shots: every MELEE_STEP frames (default 3) for MELEE_N frames (default 60)
// from each named camera. The probe prints, per frame, each wrist in the
// BODY's frame -- fwd (along the heading, from the shoulders' midpoint), up
// (over the soles), out (from the midline, + on its own side) -- the punch,
// its clock, the overlay weight, the heading, and what each hit frame did.
// For the aim it prints the gun hand against the aim line and the barrel's
// direction.
import { launchChrome, assertRenderer } from './chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT = +process.env.AUTO_CDP_PORT || 9245;
const OUT = process.argv[2]; const MODE = process.argv[3] || 'combo';
const CAMS = (process.argv[4] || 'side,chase').split(',');
const N = +(process.env.MELEE_N || 60), STEP = +(process.env.MELEE_STEP || 3);
const PROBE = process.env.MELEE_PROBE === '1';
const PATH = process.env.MELEE_PATH || '/apps/auto/';
mkdirSync(OUT, { recursive: true });
const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-meleecam-${PORT}`, width: 1280, height: 720 });
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
  await send('Page.navigate', { url: `http://localhost:${process.env.AUTO_HTTP_PORT || 8000}${PATH}` });
  for (let i = 0; i < 400; i++) { await sleep(500); if (await evaluate('!!window.__dbg')) break; }
  await assertRenderer(evaluate); await sleep(2500);
  const setup = await evaluate(`(() => { const d = window.__dbg, P = d.player, T = d.traffic, PS = d.peds;
    d.applyQuality('high', true);
    for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    d.game.paused = true;
    if (P.vehicle) P.exitVehicle(true);
    const mode = '${MODE}', armed = mode.includes('aim'), walking = mode.startsWith('walk');
    for (const p of PS.peds.slice()) PS.remove(p);
    PS.timer = 1e9;
    d.game.wanted = 1;          // the sparring partner is flagged a cop: it stands and faces you
    d.game.onCopShot = () => {};
    P.armed = armed; P.ammo = armed ? 45 : 0;
    const stepN = (n, inp) => { for (let i = 0; i < n; i++) {
      P.update(1 / 60, inp, { x: 0, y: 0 }, d.controls, T, PS);
      PS.update(1 / 60, P.x, P.z, P, T);
      d.fx.update(1 / 60);
      d.world.update(P.x, P.z, 2);
    } };
    // settle on the spawn's pavement
    P.camYaw = P.heading + Math.PI;
    stepN(30, { x: 0, y: 0 });
    let tp = null;
    for (let k = 0; k < 60 && !tp; k++) tp = PS.spawn(P.x, P.z, false);
    if (!tp) return 'no ped';
    const side = ${+(process.env.MELEE_SIDE || 0)}, dist = ${+(process.env.MELEE_DIST || 1.3)};
    const lead = walking ? 0.9 : 0;    // a walker closes on them
    const a = P.heading + side;
    tp.x = P.x + Math.sin(a) * dist + Math.sin(P.heading) * lead; tp.z = P.z + Math.cos(a) * dist + Math.cos(P.heading) * lead;
    tp.y = d.city.groundAt(tp.x, tp.z, P.y + 1);
    tp.cop = true; tp.shootCd = 1e9; tp.hp = ${+(process.env.MELEE_HP || 40)};
    tp.heading = Math.atan2(P.x - tp.x, P.z - tp.z); tp.speed = 0;
    window.__tp = tp;
    window.__f = 0;
    window.__events = [];
    const g0 = P.game.onPunch;
    P.game.onPunch = (hit, x, y, z) => { window.__events.push({ f: window.__f, punch: P.lastPunch && P.lastPunch.name, hit: !!hit, hp: tp.hp, state: tp.state }); if (g0) g0.call(P.game, hit, x, y, z); };
    const PRESS = [0, 14, 30];
    window.__frame = () => {
      const inp = { x: 0, y: walking ? -0.28 : 0, sprint: false, attack: PRESS.includes(window.__f), jump: false };
      // the camera stays put for the whole test (the soft lock is judged against it)
      stepN(1, inp);
      window.__f++;
    };
    const v = new d.THREE.Vector3(), b = P.h.bones;
    const at = (i) => { b[i].getWorldPosition(v); return [v.x, v.y, v.z]; };
    window.__probe = () => {
      P.h.group.updateMatrixWorld(true);
      const h = P.heading, fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);   // rx: the body's +x
      const sL = at(6), sR = at(9), mx = (sL[0] + sR[0]) / 2, mz = (sL[2] + sR[2]) / 2;
      const rel = (p, sx) => [(p[0] - mx) * fx + (p[2] - mz) * fz, p[1] - P.y, sx * ((p[0] - mx) * rx + (p[2] - mz) * rz)];
      const F = P.fighter;
      const row = { f: window.__f, punch: F && F.cur ? F.cur.name : '-', t: F ? F.t : 0, w: F ? F.w : 0, aimW: F ? F.aimW : 0, h: P.heading,
        hL: rel(at(8), -1), hR: rel(at(11), 1), sh: (sL[1] + sR[1]) / 2 - P.y, tp: [window.__tp.x, window.__tp.z, window.__tp.state, window.__tp.hp, window.__tp.stag] };
      if (F && F.gun) {
        row.gun = F.gun.visible;
        const m = F.muzzle(new d.THREE.Vector3()), bd = F.barrel(new d.THREE.Vector3());
        const ay = F.aimYaw, ax = Math.sin(ay), az = Math.cos(ay);
        row.muz = [(m.x - mx) * ax + (m.z - mz) * az, m.y - P.y, (m.x - mx) * Math.cos(ay) - (m.z - mz) * Math.sin(ay)];
        row.barrel = [bd.x * ax + bd.z * az, bd.y];
      }
      return row;
    };
    window.__shot = (cam) => {
      P.applyCamera(d.camera);
      const h0 = window.__h0, fx = Math.sin(h0), fz = Math.cos(h0), rx = Math.cos(h0), rz = -Math.sin(h0);
      // framed on the pair, or on the player when the target is far (a shot)
      const far = Math.hypot(window.__tp.x - P.x, window.__tp.z - P.z) > 3;
      const cx = far ? P.x + fx * 0.3 : (P.x + window.__tp.x) / 2, cz = far ? P.z + fz * 0.3 : (P.z + window.__tp.z) / 2;
      const r = far ? 2.6 : 3.4;
      if (cam === 'side') { d.camera.position.set(cx - rx * r, P.y + 1.25, cz - rz * r); d.camera.lookAt(cx, P.y + 1.0, cz); }
      if (cam === 'front') { d.camera.position.set(P.x + fx * 2.4 - rx * 1.0, P.y + 1.5, P.z + fz * 2.4 - rz * 1.0); d.camera.lookAt(P.x, P.y + 1.2, P.z); }
      d.camera.updateMatrixWorld(true);
      if (d.peds.addContactShadow) { P.h.group.updateMatrixWorld(true); }
      d.sun.position.set(P.x - 215, P.y + 200, P.z - 150); d.sun.target.position.set(P.x, P.y, P.z); d.sun.target.updateMatrixWorld();
      return window.__f;
    };
    window.__h0 = P.heading;
    return [P.x.toFixed(1), P.z.toFixed(1), P.heading.toFixed(2), tp.x.toFixed(1), tp.z.toFixed(1)];
  })()`);
  console.log('setup', setup);
  if (PROBE) {
    const rows = [];
    for (let i = 0; i < N; i++) { rows.push(await evaluate('window.__probe()')); await evaluate('window.__frame()'); }
    rows.push(await evaluate('window.__probe()'));
    const f = (a) => a.map((x) => (x >= 0 ? ' ' : '') + x.toFixed(2)).join(' ');
    console.log('wrists in the body frame (m): fwd up out (out + on its own side); L = the right hand, R = the left');
    console.log('  f  punch    t     w   aim | L (rear/gun): fwd   up   out | R (lead):  fwd   up   out | shoulders up | heading | target hp/state');
    for (const r of rows) {
      console.log(`${String(r.f).padStart(3)} ${r.punch.padEnd(6)} ${r.t.toFixed(2)} ${r.w.toFixed(2)} ${r.aimW.toFixed(2)} | ${f(r.hL)} | ${f(r.hR)} | ${r.sh.toFixed(2)} | ${r.h.toFixed(2)} | ${r.tp[3]} ${r.tp[2]}${r.tp[4] > 0 ? ' stag' : ''}${r.muz ? ` | muzzle fwd/up/side ${f(r.muz)} barrel fwd ${r.barrel[0].toFixed(2)} up ${r.barrel[1].toFixed(2)}` : ''}`);
    }
    console.log('hit frames:', JSON.stringify(await evaluate('window.__events')));
  } else {
    for (let k = 0; k * STEP <= N; k++) {
      for (const cam of CAMS) {
        await evaluate(`window.__shot('${cam}')`);
        await sleep(500);
        const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
        writeFileSync(`${OUT}/${cam}${String(k * STEP).padStart(3, '0')}.jpg`, Buffer.from(result.data, 'base64'));
      }
      for (let s = 0; s < STEP; s++) await evaluate('window.__frame()');
    }
    console.log('hit frames:', JSON.stringify(await evaluate('window.__events')));
  }
} finally { chrome.kill(); }
process.exit(0);
