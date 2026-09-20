// Aircraft contact sheet: every flyable type on a plain stage, on the Boeing
// Field apron where the game parks it, and the helicopter in flight under the
// game's own chase camera.
//
//   node tools/aircraftshots.mjs [outdir] [type,type,...] [--stage] [--field] [--flight]
//
// With no mode flag all three run. `outdir` defaults to tools/data/aircraft.
// Stage views are framed by the aircraft's SPAN as well as its length (a
// wing is most of what an aircraft is), with the sun posed beside the camera
// the way vehshots.mjs does. Field views stream the real city round the
// apron first. The flight run steps the sim at a fixed 1/60 with the game
// paused, exactly as flycam.mjs does, feeding the same inputs a thumb would
// (collective buttons and the stick), and photographs frames of it.
//
// AUTO_GPU=1 (tools/chrome.mjs) makes this a minute instead of ten.
import { launchChrome, assertRenderer } from './chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9351;
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = ARGS[0] || 'tools/data/aircraft';
const ONLY = ARGS[1] ? ARGS[1].split(',') : null;
const flag = (f) => process.argv.includes(f);
const ALL = !flag('--stage') && !flag('--field') && !flag('--flight');
const DO_STAGE = ALL || flag('--stage'), DO_FIELD = ALL || flag('--field'), DO_FLIGHT = ALL || flag('--flight');
const WAIT = +(process.env.AIR_WAIT_MS || 2500);

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-airshots-${PORT}`, width: 1280, height: 720 });
let closing = false;
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  if (!page || page.url !== 'about:blank') throw new Error(`CDP port ${PORT} is not this run's Chrome -- pick a free AUTO_CDP_PORT`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  ws.addEventListener('close', () => { if (!closing) { console.error('aircraftshots: DevTools socket closed'); process.exit(2); } });
  let id = 0; const pend = new Map(); const errs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result?.result?.value;
  };
  const shot = async (name) => {
    await sleep(WAIT);
    const { result } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(result.data, 'base64'));
    console.log(`  ${OUT}/${name}.png`);
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 400; i++) { await sleep(500); if (await ev('!!window.__dbg')) break; }
  await assertRenderer(ev);
  mkdirSync(OUT, { recursive: true });

  const types = (await ev(`Object.keys(__dbg.TYPES).filter((k) => __dbg.TYPES[k].plane)`))
    .filter((t) => !ONLY || ONLY.includes(t));
  await ev(`(() => {
    const d = window.__dbg;
    d.applyQuality('high', true);
    for (const k of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu','minimap'])
      { const e = document.getElementById(k); if (e) e.style.display = 'none'; }
    d.game.paused = true;
    // Frame math shared by every mode: span is drawn, not declared on every
    // spec, so read it off the geometry.
    window.__span = (v) => { v.group.updateMatrixWorld(true); const b = new d.THREE.Box3().setFromObject(v.tilt); return Math.max(b.max.x - b.min.x, 2); };
  })()`);

  if (DO_FIELD) {
    // The real apron, streamed. Park the camera, let chunks build round it.
    for (const name of types) {
      const ok = await ev(`(async () => {
        const d = window.__dbg, W = d.world;
        const v = d.traffic.cars.find((k) => k.typeName === '${name}' && k.mode === 'apron');
        if (!v) return false;
        for (let i = 0; i < 400; i++) { W.update(v.x, v.z, 2); if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0)); }
        const span = window.__span(v), s = v.spec;
        const r = Math.max(s.len, span) * 0.95 + 4;
        // front three-quarter from the runway side (the aircraft's port):
        // the apron's west edge has hangars right behind the row
        const az = v.heading + 0.85;
        d.camera.position.set(v.x + Math.sin(az) * r, v.y + 1.7 + r * 0.12, v.z + Math.cos(az) * r);
        d.camera.lookAt(v.x, v.y + s.roof * 0.5, v.z);
        d.camera.updateMatrixWorld(true);
        d.placeSun(v.x, v.y, v.z);
        window.__fieldV = v;
        return true;
      })()`);
      if (!ok) { console.log(`  (no apron ${name})`); continue; }
      await shot(`${name}-field`);
    }
  }

  if (DO_STAGE) {
    await ev(`(() => {
      const d = window.__dbg;
      d.world.group.visible = false;
      d.world.terrainGroup.visible = false;
      if (d.world.skyline) d.world.skyline.visible = false;
      if (d.world.water) d.world.water.visible = false;
      for (const l of (d.world.lakes || [])) l.visible = false;
      for (const c of d.traffic.cars) c.group.visible = false;
      d.player.h.group.visible = false;
      const g = new d.THREE.Mesh(new d.THREE.PlaneGeometry(400, 400),
        new d.THREE.MeshStandardMaterial({ color: 0x6e7276, roughness: 0.95 }));
      g.rotation.x = -Math.PI / 2; g.position.set(0, 0.001, 0); g.receiveShadow = true;
      d.scene.add(g);
      d.city.groundAt = () => 0; d.city.roadLift = () => 0;
    })()`);
    // name, azimuth (0 = at the nose), elevation, distance (x the larger of
    // length and span), look point along the fuselage (x length). `close`
    // is the cockpit through its glass.
    const VIEWS = [['front', 0.72, 0.22, 0.95, 0], ['rear', Math.PI - 0.62, 0.30, 0.95, 0], ['side', Math.PI / 2, 0.05, 0.95, 0],
      ['high', 0.35, 0.9, 0.95, 0], ['close', 0.95, 0.10, 0.36, 0.30]];
    for (const name of types) {
      await ev(`(() => {
        const d = window.__dbg;
        if (window.__veh) d.traffic.remove(window.__veh);
        const v = d.traffic.spawnAt(0, 0, 0, '${name}', ${'0x' + 'd8dde2'}, 'free');
        v.y = 0; v.x = 0; v.z = 0;
        v.setDetailed(true);
        // settle: a taildragger rocks back onto its tailwheel over ~0.5 s
        for (let i = 0; i < 90; i++) v.update(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: 0 });
        window.__veh = v;
      })()`);
      for (const [view, az, elev, rf, lz] of VIEWS) {
        await ev(`(() => {
          const d = window.__dbg, v = window.__veh, s = v.spec;
          const span = window.__span(v);
          const r = Math.max(s.len, span) * ${rf}, oz = s.len * ${lz};
          const cx = Math.sin(${az}) * r, cz = Math.cos(${az}) * r + oz;
          const cy = s.roof * 0.5 + r * ${elev};
          d.camera.position.set(cx, cy, cz);
          d.camera.lookAt(0, s.roof * (${lz} ? 0.6 : 0.42), oz);
          d.camera.updateMatrixWorld(true);
          d.sun.position.set(cx * 0.5 - r, r * 2.2, cz * 0.5 - r * 0.7);
          d.sun.target.position.set(0, 0, 0); d.sun.target.updateMatrixWorld();
          d.scene.updateMatrixWorld(true);
        })()`);
        await shot(`${name}-${view}`);
        // AIR_PROBE='side:640,375;front:x,y' raycasts pixels back to the part
        // and the point in the aircraft's own frame (see "raycast the pixel").
        for (const pr of (process.env.AIR_PROBE || '').split(';').filter(Boolean)) {
          const [pv, xy] = pr.split(':');
          if (pv !== view) continue;
          const [px, py] = xy.split(',').map(Number);
          console.log(`    probe ${pr}:`, JSON.stringify(await ev(`(() => {
            const d = window.__dbg, v = window.__veh, T = d.THREE;
            d.scene.updateMatrixWorld(true);
            const rc = new T.Raycaster();
            rc.setFromCamera(new T.Vector2(${px} / 640 - 1, 1 - ${py} / 360), d.camera);
            const hits = rc.intersectObject(v.group, true).slice(0, 3);
            return hits.map((h) => {
              const m = h.object, part = m.geometry === v.assets.paintGeo ? 'paint' : m.material === v.bodyMat ? 'paint' : m === v.trimMesh ? 'trim' : m === v.matteMesh ? 'matte' : 'spin/other';
              const lp = v.tilt.worldToLocal(h.point.clone());
              const c = m.geometry.attributes.color ? [0, 1, 2].map((j) => +m.geometry.attributes.color.array[h.face.a * 3 + j].toFixed(3)) : null;
              return { part, local: [lp.x, lp.y, lp.z].map((n) => +n.toFixed(2)), col: c };
            });
          })()`)));
        }
      }
    }
  }

  if (DO_FLIGHT) {
    const helis = (await ev(`Object.keys(__dbg.TYPES).filter((k) => __dbg.TYPES[k].heli)`)).filter((t) => !ONLY || ONLY.includes(t));
    for (const name of helis) {
      await ev(`location.reload()`).catch(() => {});
      await sleep(1500);
      for (let i = 0; i < 400; i++) { await sleep(500); if (await ev('!!window.__dbg && !!__dbg.traffic')) break; }
      const log = await ev(`(async () => {
        const d = window.__dbg, p = d.player, W = d.world, G = d.G;
        d.applyQuality('high', true);
        for (const k of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu','minimap'])
          { const e = document.getElementById(k); if (e) e.style.display = 'none'; }
        d.game.paused = true;
        const v = d.traffic.cars.find((k) => k.typeName === '${name}' && k.mode === 'apron');
        p.enterVehicle(v);
        p.camYaw = v.heading + Math.PI; p.camPitch = 0.1; p.camFloor = null;
        p.camPos.set(v.x - Math.sin(v.heading) * 13, v.y + 4, v.z - Math.cos(v.heading) * 13);
        p.camLook.set(v.x, v.y + 1.5, v.z);
        const rows = [];
        window.__hstep = async (n, inp) => {
          for (let i = 0; i < n; i++) {
            const input = Object.assign({ x: 0, y: 0, gas: false, gasAmt: 0, brake: false, brakeAmt: 0, hand: false, liftAmt: 0, sinkAmt: 0 }, inp);
            p.updateDrive(1 / 60, input, d.traffic, d.peds);
            p.updateCamera(1 / 60, input);
            W.playerAlt = Math.max(0, v.y - G.terrainHeight(v.x, v.z));
            W.playerFlying = !!v.airborne;
            if (i % 4 === 0) W.update(v.x, v.z, 2);
            if (i % 60 === 59) await new Promise((r) => setTimeout(r, 0));
          }
          p.applyCamera(d.camera); d.camera.updateMatrixWorld(true);
          d.placeSun(v.x, v.y, v.z);
          const g = G.terrainHeight(v.x, v.z);
          const r = { y: +v.y.toFixed(2), agl: +(v.y - d.city.groundAt(v.x, v.z, v.y + 1)).toFixed(2), sp: +v.speed.toFixed(1), vLong: +v.vLong.toFixed(1), air: v.airborne, pitch: +v.tilt.rotation.x.toFixed(3), roll: +v.tilt.rotation.z.toFixed(3), hp: v.health };
          rows.push(r);
          return r;
        };
        window.__hrows = rows;
        return true;
      })()`);
      const step = async (label, n, inp, snap) => {
        const r = await ev(`window.__hstep(${n}, ${JSON.stringify(inp)})`);
        console.log(`  ${label.padEnd(12)} ${JSON.stringify(r)}`);
        if (snap) await shot(`${name}-${snap}`);
      };
      await step('spool', 150, {}, 'spool');
      await step('lift', 240, { liftAmt: 1, gas: true, gasAmt: 1 }, null);
      await step('hover', 180, {}, 'hover');
      await step('yaw', 90, { x: -1 }, 'yaw');
      await step('forward', 300, { y: -1 }, 'forward');
      await step('turn', 120, { y: -1, x: 0.8 }, 'turn');
      await step('stop', 360, {}, 'stop');
      await step('descend', 600, { sinkAmt: 1, brake: true, brakeAmt: 1 }, 'landed');
    }
  }
  if (flag('--takeoff')) {
    // Fixed-wing handling, measured: from the runway's south end, full
    // throttle, stick back past VR, climb to 120 m and hold it, then a
    // full-stick bank. Reports ground roll, rotation speed, level speed and
    // turn rate per type, and a chase frame in the climb.
    const fixed = (await ev(`Object.keys(__dbg.TYPES).filter((k) => __dbg.TYPES[k].plane && !__dbg.TYPES[k].heli && !__dbg.TYPES[k].floats)`))
      .filter((t) => !ONLY || ONLY.includes(t));
    for (const name of fixed) {
      await ev(`location.reload()`).catch(() => {});
      await sleep(1500);
      for (let i = 0; i < 400; i++) { await sleep(500); if (await ev('!!window.__dbg && !!__dbg.traffic')) break; }
      const r = await ev(`(async () => {
        const d = window.__dbg, p = d.player, W = d.world, G = d.G, c = d.city;
        d.applyQuality('high', true);
        for (const k of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu','minimap'])
          { const e = document.getElementById(k); if (e) e.style.display = 'none'; }
        d.game.paused = true;
        const ap = G.LANDMARKS.find((l) => l.kind === 'airport');
        const AL = [Math.sin(0.52), Math.cos(0.52)];
        const rx = ap.x + 1400 * AL[0], rz = ap.z + 1400 * AL[1];
        const v = d.traffic.cars.find((k) => k.typeName === '${name}');
        v.x = rx; v.z = rz; v.heading = 0.52 + Math.PI; v.vLong = 0; v.airborne = false; v.y = c.groundAt(rx, rz, null);
        p.enterVehicle(v);
        p.camYaw = v.heading + Math.PI; p.camPitch = 0.1; p.camFloor = null;
        p.camPos.set(v.x - Math.sin(v.heading) * 15, v.y + 4.6, v.z - Math.cos(v.heading) * 15);
        p.camLook.set(v.x, v.y + 2, v.z);
        const x0 = v.x, z0 = v.z, y0 = v.y;
        const out = { name: '${name}' };
        let hd0 = 0;
        for (let f = 0; f < 60 * 50; f++) {
          const fl = v.spec.fly || { vr: 27 };
          let pitch = 0, steer = 0;
          if (!v.airborne) pitch = v.vLong > fl.vr + 1 ? 1 : 0;
          else pitch = Math.max(-1, Math.min(1, (y0 + 120 - v.y) / 25));
          if (f >= 60 * 40) { if (f === 60 * 40) hd0 = v.heading; steer = 1; }
          const input = { x: -steer, y: pitch, gas: true, gasAmt: 1, brake: false, brakeAmt: 0, hand: false };
          p.updateDrive(1 / 60, input, d.traffic, d.peds);
          p.updateCamera(1 / 60, input);
          W.playerAlt = Math.max(0, v.y - G.terrainHeight(v.x, v.z)); W.playerFlying = !!v.airborne;
          W.playerFwdX = v.forward.x; W.playerFwdZ = v.forward.z;
          if (f % 4 === 0) W.update(v.x, v.z, 2);
          if (v.airborne && out.roll === undefined) { out.roll = Math.round(Math.hypot(v.x - x0, v.z - z0)); out.vr = +(v.vLong * 3.6).toFixed(0); }
          if (f === 60 * 12) { p.applyCamera(d.camera); d.camera.updateMatrixWorld(true); d.placeSun(v.x, v.y, v.z); out.climbKph = +(v.vLong * 3.6).toFixed(0); out.climbY = +(v.y - y0).toFixed(0); break; }
          if (f % 120 === 119) await new Promise((res) => setTimeout(res, 0));
        }
        window.__to = { v, y0, hd0, p, out };
        return out;
      })()`);
      await shot(`${name}-climb`);
      const r2 = await ev(`(async () => {
        const d = window.__dbg, W = d.world, G = d.G, { v, y0, p, out } = window.__to;
        let hd0 = 0;
        for (let f = 60 * 12; f < 60 * 44; f++) {
          let steer = 0;
          const pitch = Math.max(-1, Math.min(1, (y0 + 120 - v.y) / 25));
          if (f === 60 * 38) { out.levelKph = +(v.vLong * 3.6).toFixed(0); hd0 = v.heading; }
          if (f >= 60 * 38) steer = 1;
          const input = { x: -steer, y: pitch, gas: true, gasAmt: 1, brake: false, brakeAmt: 0, hand: false };
          p.updateDrive(1 / 60, input, d.traffic, d.peds);
          p.updateCamera(1 / 60, input);
          W.playerAlt = Math.max(0, v.y - G.terrainHeight(v.x, v.z)); W.playerFlying = !!v.airborne;
          W.playerFwdX = v.forward.x; W.playerFwdZ = v.forward.z;
          if (f % 4 === 0) W.update(v.x, v.z, 2);
          if (f % 120 === 119) await new Promise((res) => setTimeout(res, 0));
        }
        out.turnDegS = +(Math.abs(v.heading - hd0) * 180 / Math.PI / 6).toFixed(1);
        out.hp = v.health;
        p.applyCamera(d.camera); d.camera.updateMatrixWorld(true); d.placeSun(v.x, v.y, v.z);
        return out;
      })()`);
      console.log('  ' + JSON.stringify(r2));
      await shot(`${name}-bank`);
    }
  }
  if (errs.length) { console.log('EXCEPTIONS:'); for (const e of errs) console.log('  ' + e.slice(0, 400)); }
} finally {
  closing = true;
  chrome.kill();
}
