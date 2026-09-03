// Headless verification for apps/solar: boots in Chrome over CDP (SwiftShader),
// exercises the physics via window.__dbg, and screenshots to tools/data/solarshots/.
//   python3 -m http.server 8000 &
//   node tools/solarverify.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9224, URL = process.env.SOLAR_URL || 'http://localhost:8000/apps/solar/';
const OUT = 'tools/data/solarshots'; mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720', '--no-first-run', '--user-data-dir=/tmp/solar-verify-profile', 'about:blank'], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) return p; } catch {}
    await sleep(300);
  }
  throw new Error('no CDP target');
}
let id = 0; const pending = new Map(); const logs = []; let ws;
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); };
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
const D = 'window.__dbg';
try {
  const t = await target();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });

  for (const [label, w, h, mobile] of [['phone', 402, 874, true], ['desktop', 1280, 720, false]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 3 : 1, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
    await send('Page.navigate', { url: URL + '?v=' + Date.now() });
    await sleep(2500);
    await ev("localStorage.removeItem('solar.v1')");
    check(await ev(`typeof ${D} === 'object'`), `${label}: booted`);
    check(await ev("document.getElementById('err').style.display !== 'block'"), `${label}: no boot error`);
    await shot(`${label}-launch`);
    await ev("document.getElementById('go').click()"); await sleep(800);
    check(await ev("document.getElementById('hud').classList.contains('on')"), `${label}: HUD on`);
    const el0 = await ev(`(()=>{const e=${D}.ship.el;return {e:e.e, rp:e.rp, ra:e.ra, T:e.T, soi:${D}.ship.soi.name}})()`);
    check(el0.soi === 'Earth' && el0.e < 0.01, `${label}: starts in circular Earth orbit (e=${el0.e.toFixed(4)}, T=${(el0.T / 3600).toFixed(1)} h)`);
    await shot(`${label}-orbit`);
    // look from the sunlit side: camera between the sun and the ship
    await ev(`(()=>{const d=${D}.sun.absNow.clone().sub(${D}.ship.abs).normalize(); ${D}.cam.yaw=Math.atan2(d.x,d.z); ${D}.cam.pitch=Math.asin(d.y)+0.15; ${D}.cam.dist=6;})()`); await sleep(400);
    await shot(`${label}-orbit-lit`);
    // coast one orbit at warp and confirm the orbit is conserved
    await ev(`${D}.setWarp(4)`); await sleep(1500);
    const el1 = await ev(`(()=>{const e=${D}.ship.el;return {e:e.e, rp:e.rp, ra:e.ra}})()`);
    check(Math.abs(el1.rp - el0.rp) < 1e-4 && Math.abs(el1.ra - el0.ra) < 1e-4, `${label}: coasting conserves the orbit (rp ${el0.rp.toFixed(5)}→${el1.rp.toFixed(5)})`);
    await ev(`${D}.setWarp(0)`);
    // target the Moon, burn prograde until escape
    await ev(`${D}.setTarget(${D}.byName.Moon); ${D}.setMode('pro'); ${D}.startBurn()`);
    await sleep(2500);
    await ev(`${D}.stopBurn()`); await sleep(200);
    const el2 = await ev(`(()=>{const e=${D}.ship.el;return {e:e.e, ra:e.ra, dv:${D}.ship.dv, segs:${D}.pred.segs.length, ca:${D}.pred.ca && ${D}.pred.ca.d}})()`);
    check(el2.e > el0.e + 0.05, `${label}: prograde burn raised eccentricity to ${el2.e.toFixed(3)} (dv left ${el2.dv.toExponential(2)})`);
    check(el2.ca != null, `${label}: closest approach to Moon computed: ${el2.ca && el2.ca.toFixed(2)} u, ${el2.segs} segment(s)`);
    await shot(`${label}-burn`);
    await ev(`${D}.toggleMap()`); await sleep(400); await shot(`${label}-map`);
    // fly to the Moon: place ship just inside Moon SOI at capture speed and check SOI transition + stable orbit mission
    await ev(`(()=>{const m=${D}.byName.Moon; ${D}.ship.soi=${D}.byName.Earth; const p=new ${D}.THREE.Vector3(), v=new ${D}.THREE.Vector3(); m.relAt(${D}.simT,p,v); const off=new ${D}.THREE.Vector3(m.R*1.5,0,0); ${D}.ship.r.copy(p).add(off); const vc=Math.sqrt(m.GM/off.length()); ${D}.ship.v.copy(v).add(new ${D}.THREE.Vector3(0,0,-vc)); ${D}.setWarp(0);})()`);
    await sleep(600);
    const s3 = await ev(`(()=>({soi:${D}.ship.soi.name, e:${D}.ship.el.e, done:[...${D}.done]}))()`);
    check(s3.soi === 'Moon', `${label}: switched into Moon SOI (e=${s3.e.toFixed(3)})`);
    check(s3.done.includes('moon-soi') && s3.done.includes('moon'), `${label}: missions Cislunar + Moonshot complete (${s3.done.join(',')})`);
    await ev(`${D}.cam.dist = 3`); await sleep(400); await shot(`${label}-moon`);
    // interplanetary: put ship on a heliocentric path near Mars and check the predictor finds an encounter
    await ev(`(()=>{const m=${D}.byName.Mars; ${D}.setTarget(m); ${D}.ship.soi=${D}.sun; const p=new ${D}.THREE.Vector3(), v=new ${D}.THREE.Vector3(); m.relAt(${D}.simT,p,v); const off=new ${D}.THREE.Vector3(0,0,-m.soi*1.6); ${D}.ship.r.copy(p).add(off); ${D}.ship.v.copy(v).add(new ${D}.THREE.Vector3(m.R*0.4/1e6,0,3e-5)); ${D}.pred.dirty=true;})()`);
    await sleep(600);
    const s4 = await ev(`(()=>({soi:${D}.ship.soi.name, segs:${D}.pred.segs.map(s=>s.body.name), enc:!!${D}.pred.encounter, ca:${D}.pred.ca&&${D}.pred.ca.d}))()`);
    check(s4.soi === 'Sun' && s4.segs.includes('Mars'), `${label}: predictor finds Mars encounter (${s4.segs.join('→')}, ca ${s4.ca && s4.ca.toFixed(1)})`);
    await ev(`${D}.cam.dist = 120`); await sleep(400); await shot(`${label}-mars-approach`);
    // saturn close-up for the rings
    await ev(`${D}.placeInOrbit(${D}.byName.Saturn, 1.6); ${D}.setTarget(${D}.byName.Titan); ${D}.cam.dist = 60; ${D}.pred.dirty=true; (()=>{const d=${D}.sun.absNow.clone().sub(${D}.ship.abs).normalize(); ${D}.cam.yaw=Math.atan2(d.x,d.z)+0.6; ${D}.cam.pitch=0.5;})()`); await sleep(600);
    await shot(`${label}-saturn`);
    // high warp far from anything: many years pass, no NaNs
    await ev(`${D}.placeInOrbit(${D}.sun, 40); ${D}.setWarp(10)`); await sleep(1500);
    const s5 = await ev(`(()=>({t:${D}.simT, ok: isFinite(${D}.ship.r.x) && isFinite(${D}.ship.v.x), warp:${D}.ship.warpIdx, date:document.getElementById('date').textContent}))()`);
    check(s5.ok, `${label}: max warp stable (${s5.date}, warp idx ${s5.warp})`);
    await ev(`${D}.setWarp(0); ${D}.cam.dist = 60000`); await sleep(400); await shot(`${label}-system`);
    // impact
    await ev(`${D}.placeInOrbit(${D}.byName.Mars, 0.3); ${D}.ship.v.multiplyScalar(0.2); ${D}.setWarp(6)`); await sleep(3000);
    check(await ev("document.getElementById('impact').classList.contains('show')"), `${label}: impact screen after de-orbit`);
    await shot(`${label}-impact`);
    await ev("document.getElementById('respawn').click()"); await sleep(300);
    check(await ev(`${D}.ship.alive && ${D}.ship.soi.name === 'Mars'`), `${label}: respawned in Mars orbit`);
  }
  check(logs.length === 0, 'no exceptions / console errors');
  for (const l of logs) console.log('   ' + l);
} catch (e) { console.error('HARNESS ERROR', e); fail++; }
finally { chrome.kill(); process.exit(fail ? 1 : 0); }
