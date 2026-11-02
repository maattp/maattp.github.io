// Auto KW: the six secrets (src/kwsecrets.js), end to end.
//
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 node tools/kw/secretprobe.mjs [outdir] [ghost,ufo,crop,phone,lantern,bigfoot]
//
// The game is paused (posed-shot mode: the frame still draws) and the probe calls
// `secrets.update(dt, player, camera)` itself at a fixed dt with the player and the
// camera placed by hand. Night / dusk / day through window.__tod (as the sky probe),
// weather through weather.set(mode, true). For each secret: its paths / spots are
// checked against the city (no building, solid or water), it is NOT shown by day /
// from too far / to the wrong player, it IS shown in its hours, the trigger pays
// once (money, count, localStorage `autokw-secrets`), a second trigger pays nothing,
// and its draw cost (sceneStats with it visible vs hidden). A shot of each.
// Then the cheat rule, the passport row, and 0 exceptions. Exit 1 on any failure.
// Starts by clearing `autokw-secrets` and leaves it cleared.
import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9412;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || 'tools/data/kw/secretshots';
const ONLY = (process.argv[3] || 'ghost,ufo,crop,phone,lantern,bigfoot,cheat').split(',');
let closing = false, fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-shots-profile-${PORT}`, width: 1280, height: 720, extra: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map(); const errs = [];
    ws.addEventListener('close', () => { if (closing) return; console.log('FAIL: DevTools socket closed'); process.exit(1); });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception');
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
        const t = (m.params.args || []).map((a) => a.value || a.description).join(' ');
        if (/secret/i.test(t) || m.params.type === 'error') errs.push(m.params.type + ': ' + t);
      }
    });
    const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
    const ev = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    };
    mkdirSync(OUT, { recursive: true });
    const shot = async (name) => {
      await sleep(1600);
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
      writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(result.data, 'base64'));
      console.log(`  shot ${OUT}/${name}.jpg`);
    };

    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    let up = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await ev('!!(window.__dbg && window.__dbg.world && window.__dbg.applyQuality && window.__dbg.secrets)')) { up = true; break; }
      if (errs.length > 0 && i > 6) break;
    }
    if (!up) throw new Error('never booted, or no __dbg.secrets: ' + errs.slice(0, 5).join('\n'));
    console.log(`booted; exceptions at boot: ${errs.length}`);
    await sleep(3000);
    await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true);
      for (const id of ['pad','stickZone','lookZone','rotate','topBtns']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true; })()`);

    // the page-side helpers: pose the player and camera, step the secrets, read the state
    await ev(`window.__sp = {
      fake: { x: 0, z: 0, y: 0, vLong: 0, spec: {} },
      // the camera comes along (secrets are built and run by the CAMERA's distance); eye()/cam() re-aim it
      foot(x, z) { const d = window.__dbg, P = d.player; P.onFoot = true; P.vehicle = null; P.x = x; P.z = z; P.y = d.city.groundAt(x, z, null); this.follow(x, P.y, z); },
      car(x, z, v) { const d = window.__dbg, P = d.player, f = this.fake; f.x = x; f.z = z; f.y = d.city.groundAt(x, z, null); f.vLong = v || 0; P.onFoot = false; P.vehicle = f; P.x = x; P.z = z; this.follow(x, f.y, z); },
      follow(x, y, z) { const c = window.__dbg.camera; c.position.set(x, y + 2.5, z + 5); c.lookAt(x, y + 1.5, z); c.updateMatrixWorld(true); },
      cam(cx, cy, cz, tx, ty, tz, fov) { const c = window.__dbg.camera; c.fov = fov || 62; c.updateProjectionMatrix(); c.position.set(cx, cy, cz); c.lookAt(tx, ty, tz); c.updateMatrixWorld(true); },
      eye(tx, ty, tz, back, up, fov) { const d = window.__dbg, P = d.player; const px = P.vehicle ? P.vehicle.x : P.x, pz = P.vehicle ? P.vehicle.z : P.z;
        const dx = tx - px, dz = tz - pz, l = Math.hypot(dx, dz) || 1; const cx = px - dx / l * (back || 0), cz = pz - dz / l * (back || 0);
        this.cam(cx, d.city.groundAt(cx, cz, null) + (up || 1.7), cz, tx, ty, tz, fov); },
      load(x, z) { const d = window.__dbg, w = d.world; const pend = () => [...w.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
        w.update(x, z, 60); for (let i = 0; i < 2000 && pend() > 0; i++) w.update(x, z, 60); },
      step(n, dt, look) { const d = window.__dbg, S = d.secrets; for (let i = 0; i < n; i++) { if (look) look(); S.update(dt || 0.05, d.player, d.camera); } },
      money() { return window.__dbg.game.money; },
      stored() { return JSON.parse(localStorage.getItem('autokw-secrets') || '{}').f || []; },
      toast() { return (document.getElementById('toast') || {}).textContent || ''; },
      clearToast() { const t = document.getElementById('toast'); if (t) t.textContent = ''; },
    }; 1`);
    const D = (e) => ev(`(() => { const d = window.__dbg, S = d.secrets, H = window.__sp; ${e} })()`);
    const J = async (e) => JSON.parse(await D(e));
    const tod = async (m) => { await ev(`window.__tod = ${JSON.stringify(m)}`); await sleep(700); return J(`return JSON.stringify({ on: d.tod.on, ni: +d.tod.ni.toFixed(2), du: +d.tod.du.toFixed(2), hour: d.tod.hour })`); };
    const wx = async (m) => { await D(`d.weather.set(${JSON.stringify(m)}, true); return 1`); await sleep(300); };
    // the draw cost of a secret: the scene's calls with its meshes shown vs hidden (they stay as update left them)
    const cost = async (names) => {
      await sleep(900);
      const on = await J(`return JSON.stringify({ c: d.sceneStats.calls, t: d.sceneStats.tris })`);
      await D(`window.__hid = []; for (const n of ${JSON.stringify(names)}) { const o = d.scene.getObjectByName(n); if (o && o.visible) { o.visible = false; window.__hid.push(o); } } return 1`);
      await sleep(900);
      const off = await J(`return JSON.stringify({ c: d.sceneStats.calls, t: d.sceneStats.tris })`);
      const geo = await J(`let n = 0, t = 0; for (const o of window.__hid) { n++; const g = o.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; } return JSON.stringify({ n, t })`);
      await D(`for (const o of window.__hid) o.visible = true; return 1`);
      return { meshes: geo.n, tris: geo.t, sceneDrawsDelta: on.c - off.c };
    };
    // a polyline's samples clear of buildings, landmark solids and water
    const clearPath = (pts, rad) => D(`const c = d.city, w = d.world, pts = ${JSON.stringify(pts)}; const bad = [];
      for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let s = 0; s <= L; s += 1) { const x = a[0] + (b[0] - a[0]) * s / L, z = a[1] + (b[1] - a[1]) * s / L, g = c.groundAt(x, z, null);
          const wl = w.waterLevelAt(x, z);
          if (c.landmarkHit(x, z, ${rad}, g + 1) || c.insideBuilding(x, z, g + 1, 0.3) || (wl !== null && wl > g - 0.2)) bad.push([Math.round(x), Math.round(z)]); } }
      return JSON.stringify(bad.slice(0, 6)) + ' ' + bad.length`);

    await D(`localStorage.removeItem('autokw-secrets'); sessionStorage.removeItem('autokw-cheated'); S.found.clear(); return 1`);
    await ev(`import('/apps/autokw/src/cheats.js').then((m) => { m.CHEAT.on = false; })`);
    ok(await D(`return S.count === 0 && S.total === 6 && !S.ghost && !S.ufo && !S.crop && !S.lantern && !S.bigfoot`), 'start: nothing found, nothing built but the boot-time payphone solid');
    const fresh = async () => { await wx('clear'); };

    // ---- 1. the gaol ghost ----------------------------------------------------------------------
    if (ONLY.includes('ghost')) {
      console.log('--- the gaol ghost');
      await fresh();
      const yl = await clearPath([[-906, -15], [-902, -21], [-902, -26], [-909, -30], [-914, -31], [-908, -26], [-905, -20], [-906, -15]], 1.2);
      console.log('  yard loop vs the walls (1.2 m):', yl);
      ok(/ 0$/.test(yl), 'the ghost\'s loop stays inside the yard walls');
      const SPOT = [-878, -18];   // the lot east of the yard, ~26 m from its middle
      await D(`H.load(${SPOT}); return 1`);
      console.log('  day', JSON.stringify(await tod('day')));
      await D(`H.foot(${SPOT}); H.eye(-906, 96, -24, 0, 1.7); H.step(80); return 1`);
      ok(await D(`return !S.ghost || !S.ghost.visible`), 'by day on foot at 26 m: no ghost');
      const n = await tod('night'); console.log('  night', JSON.stringify(n));
      ok(n.on && n.ni > 0.55, 'night forced through window.__tod');
      await D(`H.car(${SPOT}, 0); H.step(80); return 1`);
      ok(await D(`return !S.ghost.visible`), 'night, in a car at 26 m: no ghost');
      await D(`H.foot(-906 + 200, -24); H.step(80); return 1`);
      ok(await D(`return !S.ghost.visible`), 'night, on foot 200 m away: no ghost');
      await D(`H.foot(${SPOT}); H.step(80, 0.05, () => H.eye(S.gs.x, S.gs.y + 5.3, S.gs.z, 0, 1.7, 55)); return 1`);
      const g = await J(`return JSON.stringify({ v: S.ghost.visible, fade: S.gs.fade, x: S.gs.x, z: S.gs.z, y: S.ghost.position.y - S.gs.y, d: Math.hypot(d.player.x - S.gs.x, d.player.z - S.gs.z) })`);
      ok(g.v && g.fade > 0.95, `night, on foot at ${g.d.toFixed(1)} m: the ghost is out (fade ${g.fade.toFixed(2)}, ${g.y.toFixed(1)} m over the yard)`);
      ok(await D(`return !S.found.has('ghost')`), 'seeing it is not finding it');
      console.log('  cost', JSON.stringify(await cost(['kw-ghost', 'kw-ghostaura'])));
      await shot('ghost-yard');
      // close-up shot (camera only)
      await D(`H.cam(S.gs.x + 9, S.gs.y + 6.4, S.gs.z + 4.5, S.gs.x, S.gs.y + 6.4, S.gs.z, 50); S.ghost.rotation.y = Math.atan2(9, 4.5); return 1`);
      await shot('ghost-close');
      const m0 = await D(`return H.money()`);
      await D(`const a = Math.atan2(d.player.x - S.gs.x, d.player.z - S.gs.z); H.foot(S.gs.x + Math.sin(a) * 10, S.gs.z + Math.cos(a) * 10); H.step(2); return 1`);
      ok(await D(`return S.gs.vanish >= 0`), 'walked to 10 m: it rises and goes');
      ok(await D(`return S.found.has('ghost') && H.stored().includes('ghost') && S.count === 1`), 'found, counted, saved');
      ok((await D(`return H.money()`)) - m0 === 250, 'paid $250');
      await D(`H.step(6); H.cam(${SPOT[0]}, S.gs.y + 2, ${SPOT[1]}, S.gs.x, S.gs.y + 7.5, S.gs.z, 45); return 1`); await sleep(1200);
      await shot('ghost-vanish');
      await D(`H.step(30); return 1`);
      ok(await D(`return !S.ghost.visible && S.gs.gone > 30`), 'gone, and stays gone a while');
      await D(`S.gs.gone = 0; H.foot(${SPOT}); H.step(80); const a = Math.atan2(d.player.x - S.gs.x, d.player.z - S.gs.z); H.foot(S.gs.x + Math.sin(a) * 10, S.gs.z + Math.cos(a) * 10); H.step(4); return 1`);
      ok(await D(`return S.gs.vanish >= 0 || S.gs.gone > 0`), 'it can be seen again');
      ok((await D(`return H.money()`)) - m0 === 250 && (await D(`return S.count`)) === 1, 'a second sighting pays nothing');
    }

    // ---- 2. the UFO, 3. the crop circle --------------------------------------------------------
    const F = [420, -10080];
    if (ONLY.includes('ufo')) {
      console.log('--- the UFO');
      await fresh();
      const OB = [F[0] + 330, F[1] + 120];
      await D(`H.load(${OB}); return 1`);
      const f = await J(`const c = d.city; const bad = []; for (let r = 0; r <= 50; r += 10) for (let a = 0; a < 16; a++) { const x = ${F[0]} + Math.cos(a / 16 * 6.283) * r, z = ${F[1]} + Math.sin(a / 16 * 6.283) * r;
        if (c.onRoad(x, z, 4) || c.buildingsNear(x, z, 8).length) bad.push([x | 0, z | 0]); }
        let r = 0; while (r < 600 && !c.roadsNear(${F[0]}, ${F[1]}, r).length) r += 5; const near = [...new Set(c.roadsNear(${F[0]}, ${F[1]}, r + 5).map((e) => c.edges[e].name))]; return JSON.stringify({ bad: bad.length, nearest: r, roads: near, place: d.G.placeNameAt(${F[0]}, ${F[1]}) })`);
      console.log('  field', JSON.stringify(f));
      ok(f.bad === 0, 'the field is clear of roads and buildings for 50 m');
      await tod('day');
      await D(`H.foot(${OB}); H.step(60); return 1`);
      ok(await D(`return !S.ufo || !S.ufo.visible`), 'by day: no UFO');
      await tod('night'); await wx('overcast');
      await D(`H.step(60); return 1`);
      ok(await D(`return !S.ufo || !S.ufo.visible`), 'night but overcast: no UFO');
      await wx('clear');
      await D(`H.eye(${F[0]} + 800, 120, ${F[1]}, 0, 1.7, 60); H.step(60, 0.05, () => H.eye(${F[0]} + 900, 100, ${F[1]} - 300, 0, 1.7, 60)); return 1`);
      ok(await D(`return S.ufo.visible && S.us.dart < 0 && S.us.watch === 0`), 'clear night: it hangs over the field (looking elsewhere: not watched)');
      ok(await D(`return S.ufo.beam.visible || S.ufo.beam.material.opacity >= 0`), 'beam built');
      // in a moving car, looking straight at it: nothing
      await D(`H.car(${OB}, 12); H.step(80, 0.05, () => H.eye(S.us.x, S.us.y, S.us.z, 0, 1.6, 60)); return 1`);
      ok(await D(`return S.us.dart < 0 && !S.found.has('ufo')`), 'driving past at 43 km/h staring at it: it stays');
      console.log('  cost', JSON.stringify(await cost(['kw-ufo', 'kw-ufobeam'])));
      await D(`S.t = 0; H.foot(${OB}); H.step(1); const b = 0.5 * Math.PI / 0.6; S.t = b; H.step(1); H.eye(S.us.x, S.us.y - 25, S.us.z, 0, 1.7, 40); return 1`);
      await shot('ufo-field');
      await D(`H.cam(S.us.x + 110, S.us.gy + 3, S.us.z + 60, S.us.x, S.us.y - 18, S.us.z, 45); return 1`);
      await shot('ufo-near');
      const m0 = await D(`return H.money()`);
      await D(`H.step(50, 0.05, () => H.eye(S.us.x, S.us.y, S.us.z, 0, 1.7, 60)); return 1`);
      ok(await D(`return S.us.dart >= 0 && S.found.has('ufo')`), 'standing and staring for 2 s: it darts away, found');
      ok((await D(`return H.money()`)) - m0 === 250 && (await D(`return H.stored().includes('ufo')`)), 'paid and saved');
      await D(`H.step(8); H.eye(S.us.x, S.us.y, S.us.z, 0, 1.7, 60); return 1`);
      await shot('ufo-dart');
      await D(`H.step(80); return 1`);
      ok(await D(`return !S.ufo.visible && S.us.gone > 200`), 'gone for the night (4 min)');
    }
    if (ONLY.includes('crop')) {
      console.log('--- the crop circle');
      await fresh(); await tod('day');
      await D(`H.load(${F}); H.foot(${F[0] + 300}, ${F[1]}); H.cam(${F[0] + 300}, S.city.groundAt(${F[0] + 300}, ${F[1]}, null) + 25, ${F[1]}, ${F[0]}, 80, ${F[1]}); H.step(40); return 1`);
      ok(await D(`return !S.crop || !S.crop.visible`), 'from 25 m up: not drawn');
      const m0 = await D(`return H.money()`);
      await D(`const gy = S.city.groundAt(${F[0]}, ${F[1]}, null); H.cam(${F[0] + 120}, gy + 170, ${F[1]} + 140, ${F[0]}, gy, ${F[1]}, 55); H.step(30); return 1`);
      ok(await D(`return S.crop.visible && S.found.has('crop')`), 'from 170 m up, looking at it for 1.5 s: drawn and found');
      ok((await D(`return H.money()`)) - m0 === 250 && (await D(`return H.stored().includes('crop')`)), 'paid and saved');
      console.log('  cost', JSON.stringify(await cost(['kw-cropcircle'])));
      await shot('crop-air');
      await D(`H.cam(${F[0] + 1500}, 300, ${F[1]}, ${F[0]}, 80, ${F[1]}); H.step(10); H.cam(${F[0] + 120}, S.cs.gy + 170, ${F[1]} + 140, ${F[0]}, S.cs.gy, ${F[1]}, 55); H.step(30); return 1`);
      ok((await D(`return H.money()`)) - m0 === 250, 'seen again: paid once');
    }

    // ---- 4. the payphone ---------------------------------------------------------------------
    if (ONLY.includes('phone')) {
      console.log('--- the payphone');
      await fresh();
      const PH = [11992, 5520.7];
      await D(`H.load(${PH}); return 1`);
      console.log('  around the phone:', await clearPath([[PH[0] - 1, PH[1] - 1.5], [PH[0] + 1, PH[1] - 1.5]], 0.2), '(the standing spot)');
      ok(await D(`return !!d.city.landmarkHit(${PH[0]}, ${PH[1]}, 0.3, S.city.groundAt(${PH[0]}, ${PH[1]}, null) + 1)`), 'the post is solid');
      await tod('day');
      await D(`H.foot(${PH[0]}, ${PH[1] - 1.4}); H.step(40); return 1`);
      ok(await D(`return S.phone && S.phone.visible && !S.ps.ringing`), 'by day: it stands there, silent');
      ok(await D(`return S.tryInteract(d.player) === true && !S.found.has('phone') && /Dial tone/.test(H.toast())`), 'ENTER by day: a dial tone, nothing found');
      await D(`H.eye(${PH[0]}, 1.3 + S.ps.gy - S.city.groundAt(${PH[0]}, ${PH[1] - 6}, null), ${PH[1]}, 4.5, 1.7, 55); H.cam(${PH[0]} + 2.2, S.ps.gy + 1.8, ${PH[1]} - 4.2, ${PH[0]}, S.ps.gy + 1.3, ${PH[1]}, 55); return 1`);
      console.log('  cost', JSON.stringify(await cost(['kw-payphone'])), '+ its sign (a child mesh)');
      await shot('phone-day');
      const t20 = await tod(20.5);
      await D(`H.foot(${PH[0]}, ${PH[1] - 20}); H.step(20); return 1`);
      ok(!(await D(`return S.ps.ringing`)) || !t20.on || t20.ni <= 0.55, `20:30 (ni ${t20.ni}): not ringing yet`);
      await tod('night');
      await D(`H.foot(${PH[0]} + 120, ${PH[1] - 80}); H.step(20); return 1`);
      ok(await D(`return !S.ps.ringing`), 'night, 144 m away: not ringing (out of earshot)');
      await D(`H.clearToast(); H.foot(${PH[0]}, ${PH[1] - 20}); H.step(20); return 1`);
      ok(await D(`return S.ps.ringing && /ringing/.test(H.toast())`), 'night, 20 m: ringing, with a toast');
      await D(`H.clearToast(); H.foot(${PH[0]}, ${PH[1] - 1.4}); H.step(4); return 1`);
      ok(await D(`return /ENTER/.test(H.toast())`), 'at the phone: the ENTER hint');
      const m0 = await D(`return H.money()`);
      await D(`H.cam(${PH[0]} + 2.2, S.ps.gy + 1.8, ${PH[1]} - 4.2, ${PH[0]}, S.ps.gy + 1.3, ${PH[1]}, 55); return 1`);
      // answer it through main.js's own ENTER path (game.tryInteract) as the player's ENTER does
      ok(await D(`return d.game.tryInteract(d.player) === true`), 'ENTER (game.tryInteract) answers it');
      const said = await D(`return H.toast()`);
      console.log('  it says:', said);
      ok(await D(`return S.found.has('phone') && H.stored().includes('phone')`), 'found and saved');
      ok((await D(`return H.money()`)) - m0 === 250, 'paid $250');
      ok(/"[^"]{20,}\."/.test(said), 'a riddle for an unfound secret');
      await shot('phone-night');
      ok(await D(`return d.eggs ? H.money() >= 0 && S.eggHint(${PH[0]}, ${PH[1]}).length > 20 : true`), 'and the way to a golden egg: "' + await D(`return S.eggHint(${PH[0]}, ${PH[1]})`) + '"');
      await D(`H.step(20); return 1`);
      ok(await D(`return !S.ps.ringing && S.tryInteract(d.player) && /hung up/.test(H.toast())`), 'answered: quiet for a while, ENTER again is a dial tone');
      ok((await D(`return H.money()`)) - m0 === 250, 'paid once');
      ok(await D(`H.foot(${PH[0]} + 6, ${PH[1] - 6}); return S.tryInteract(d.player) === false`), 'ENTER 8 m away is not the phone\'s');
    }

    // ---- 5. the Doon lantern ----------------------------------------------------------------
    if (ONLY.includes('lantern')) {
      console.log('--- the Doon lantern');
      await fresh();
      const R = await J(`return JSON.stringify(${'[[2862, 5600], [2856, 5566], [2878, 5540], [2918, 5531], [2957, 5532], [2978, 5530], [2998, 5528], [3021, 5521]]'})`);
      const cp = await clearPath(R, 0.9);
      console.log('  route clear of houses/solids/water:', cp);
      ok(/ 0$/.test(cp), 'the lantern\'s walk is clear of every house');
      await D(`H.load(2940, 5560); return 1`);
      await tod('day');
      await D(`H.foot(2862, 5650); H.step(40); return 1`);
      ok(await D(`return !S.lantern || !S.lantern.visible`), 'by day: no lantern');
      await tod('night');
      await D(`H.foot(2862, 5650); H.step(40); return 1`);
      ok(await D(`return S.lantern.visible && S.ls.st === 'wait'`), 'night, 50 m off: it hangs there, waiting');
      console.log('  cost', JSON.stringify(await cost(['kw-lantern', 'kw-lanternglow'])));
      await D(`H.foot(2862, 5622); H.step(10); return 1`);
      ok(await D(`return S.ls.st === 'walk'`), 'walk up (22 m): it sets off');
      await D(`H.foot(2862, 5680); const s0 = S.ls.s; H.step(60); window.__s0 = s0; return 1`);
      ok(await D(`return S.ls.s - window.__s0 < 0.01`), 'fall 80 m behind: it waits');
      const m0 = await D(`return H.money()`);
      // follow it, 9 m behind on its own path
      let shotTaken = false;
      for (let k = 0; k < 400; k++) {
        const st = await J(`const L = S.ls; const b = Math.max(0, L.s - 9); const keep = { x: L.x, z: L.z }; S._lanternAt(b); const fx = L.x, fz = L.z; L.x = keep.x; L.z = keep.z; S._lanternAt(L.s);
          H.foot(fx, fz); H.step(10); return JSON.stringify({ st: L.st, s: L.s, len: L.len })`);
        if (!shotTaken && st.s > 75) { shotTaken = true; await D(`const L = S.ls; H.eye(L.x, S.lantern.position.y - 0.3, L.z, 3, 1.6, 55); return 1`); await shot('lantern-follow'); }
        if (st.st === 'end' || st.st === 'gone') break;
      }
      await D(`H.step(20); return 1`);
      ok(await D(`return S.found.has('lantern') && H.stored().includes('lantern')`), 'followed to the barn: found, saved');
      ok((await D(`return H.money()`)) - m0 === 250, 'paid $250');
      await D(`H.step(80); return 1`);
      ok(await D(`return S.ls.st === 'gone' && !S.lantern.visible`), 'it goes out, gone a while');
    }

    // ---- 6. Bigfoot ------------------------------------------------------------------------
    if (ONLY.includes('bigfoot')) {
      console.log('--- Bigfoot in Hidden Valley');
      const cp = await clearPath([[4652, 4145], [4664, 4285]], 0.5);
      console.log('  his strip clear:', cp);
      ok(/ 0$/.test(cp), 'the strip of woods he walks is clear of buildings and water');
      ok(await D(`const G = d.G; let w = 0, n = 0; for (let t = 0; t <= 1; t += 0.1) { n++; if (G.greenKind(4652 + 12 * t, 4145 + 140 * t) === 2) w++; } return w >= n * 0.7`), 'and is woodland');
      const OB = [4560, 4215];   // Hidden Valley's houses, ~100 m west
      await D(`H.load(4640, 4215); return 1`);
      await wx('clear'); await tod('day');
      await D(`H.foot(${OB}); H.step(60); return 1`);
      ok(await D(`return !S.bigfoot || !S.bigfoot.visible`), 'clear day: no Bigfoot');
      await tod('night');
      await D(`H.step(60); return 1`);
      ok(await D(`return !S.bigfoot || !S.bigfoot.visible`), 'clear night: no Bigfoot either');
      const dk = await tod('dusk'); console.log('  dusk', JSON.stringify(dk));
      await D(`H.step(60); return 1`);
      ok(await D(`return S.bigfoot && S.bigfoot.visible && S.bs.st === 'walk'`), 'dusk: he walks the trees');
      await tod('day'); await wx('fog');
      await D(`S.bs.fade = 0; H.step(60); return 1`);
      const b = await J(`return JSON.stringify({ v: S.bigfoot.visible, st: S.bs.st, fade: S.bs.fade, d: Math.hypot(d.player.x - S.bs.x, d.player.z - S.bs.z) })`);
      ok(b.v && b.st === 'walk' && b.fade > 0.9, `fog by day, ${b.d.toFixed(0)} m off: he walks the trees`);
      console.log('  cost', JSON.stringify(await cost(['kw-bigfoot'])));
      await D(`const a = Math.atan2(S.bs.x - ${OB[0]}, S.bs.z - ${OB[1]}), cx = S.bs.x - Math.sin(a) * 30, cz = S.bs.z - Math.cos(a) * 30; H.cam(cx, S.city.groundAt(cx, cz, null) + 1.7, cz, S.bs.x, S.city.groundAt(S.bs.x, S.bs.z, null) + 1.4, S.bs.z, 40); S.uPh.value = 1.1; return 1`);
      await shot('bigfoot-fog');
      await D(`H.cam(S.bs.x + 7, S.city.groundAt(S.bs.x, S.bs.z, null) + 1.8, S.bs.z + 4, S.bs.x, S.city.groundAt(S.bs.x, S.bs.z, null) + 1.3, S.bs.z, 45); S.bigfoot.rotation.y = Math.atan2(7, 4); S.uPh.value = 0.9; return 1`);
      await wx('clear'); await shot('bigfoot-close'); await wx('fog');
      const m0 = await D(`return H.money()`);
      await D(`const a = Math.atan2(${OB[0]} - S.bs.x, ${OB[1]} - S.bs.z); H.foot(S.bs.x + Math.sin(a) * 45, S.bs.z + Math.cos(a) * 45); H.step(20); return 1`);
      ok(await D(`return S.bs.st === 'walk'`), 'at 45 m he has not seen you');
      await D(`const a = Math.atan2(${OB[0]} - S.bs.x, ${OB[1]} - S.bs.z); H.foot(S.bs.x + Math.sin(a) * 34, S.bs.z + Math.cos(a) * 34); H.step(2); return 1`);
      ok(await D(`return S.bs.st === 'look'`), 'walk to 34 m: he stops and looks at you');
      await D(`H.step(30); return 1`);
      ok(await D(`return S.bs.st === 'flee' && S.found.has('bigfoot') && H.stored().includes('bigfoot')`), 'then lopes off: found, saved');
      const all = await D(`return S.count === S.total`);
      ok((await D(`return H.money()`)) - m0 === (all ? 2750 : 250), all ? 'paid $250, and the all-six bonus $2,500' : 'paid $250');
      await D(`H.step(120); return 1`);
      ok(await D(`return !S.bigfoot.visible && S.bs.gone > 100`), 'gone into the trees for a while');
      await wx('clear');
    }

    // ---- the cheat rule, the passport -----------------------------------------------------------
    if (ONLY.includes('cheat')) {
      console.log('--- the cheat rule and the passport');
      await ev(`import('/apps/autokw/src/cheats.js').then((m) => { m.CHEAT.on = true; })`);
      const before = await J(`S.found.delete('ghost'); S.save(); return JSON.stringify({ n: S.count, m: H.money() })`);
      ok(await D(`return / not counted/.test(S.credit('ghost')) && !S.found.has('ghost')`), 'cheats on: a secret is not counted');
      ok(await D(`return H.money()`) === before.m && !(await D(`return H.stored().includes('ghost')`)), 'not paid, not saved');
      await ev(`import('/apps/autokw/src/cheats.js').then((m) => { m.CHEAT.on = false; })`);
      const row = await J(`return JSON.stringify(S.passportRow())`);
      ok(row.label === 'Secrets found' && row.total === 6 && row.done === before.n, `passport row "${row.label} ${row.done}/${row.total}"`);
      ok(await D(`const s2 = new S.constructor({ scene: new d.THREE.Scene(), city: Object.assign(Object.create(d.city), { addLandmarkSolids: null }), world: d.world, audio: null, hud: null, game: { money: 0 }, fx: null, tod: d.tod, weather: d.weather });
        return s2.count === S.count`), 'a fresh instance loads the save');
    }
    await D(`localStorage.removeItem('autokw-secrets'); return 1`);
    await ev(`window.__tod = 'day'`);
    console.log(`exceptions: ${errs.length}${errs.length ? '\n  ' + errs.slice(0, 8).join('\n  ') : ''}`);
    ok(errs.length === 0, '0 exceptions');
    console.log(fails ? `FAILED ${fails}` : 'ALL OK');
    if (fails) process.exitCode = 1;
  } finally {
    closing = true;
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('secretprobe failed:', e.message); process.exitCode = 1; closing = true; });
