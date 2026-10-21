// Auto KW: how YOUR car feels on the real ground, in the running game (the
// live loop, real frames): roadfeel.js's joints / rails / rumble strips, the
// suspension's heave over them and over crests, the engine profile per type
// (and the semi's jake brake), the chase camera per type (boom, speed FOV),
// a phone finger holding the look zone, and a crash's crumple and steam.
//
//   node tools/kw/feelprobe.mjs [outdir] [phases]
//     phases  comma list of rumble,rail,deck,gravel,engines,jake,camera,look,crash,dentshot
//             (default all); shots go to outdir (default /tmp/feelprobe)
//     AUTO_HTTP_PORT / AUTO_CDP_PORT / AUTO_GPU as every harness
//
// Prints one block per phase; 0 page exceptions is required.

import { launchChrome } from '../chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9413;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const OUT = process.argv[2] || '/tmp/feelprobe';
const PHASES = (process.argv[3] || 'rumble,rail,deck,gravel,engines,jake,camera,look,crash,dentshot').split(',');
mkdirSync(OUT, { recursive: true });

// --- page side: helpers installed once -------------------------------------
const HELPERS = `(() => {
  const d = __dbg, P = d.player, T = d.traffic, city = d.city;
  const H = window.__fp = {};
  H.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  H.clearNear = (x, z, r) => { for (const c of [...T.cars]) if (c !== P.vehicle && !c.leader && Math.hypot(c.x - x, c.z - z) < r) T.remove(c); };
  // put the player in a fresh vehicle of type at (x, z) facing h at v m/s
  H.drive = (type, x, z, h, v) => {
    if (P.vehicle) { const o = P.vehicle; P.exitVehicle && P.exitVehicle(); if (o !== P.vehicle) T.remove(o); }
    H.clearNear(x, z, 60);
    const car = T.spawnAt(x, z, h, type, 0x8a2a20, 'free');
    P.enterVehicle(car);
    car.vLong = v;
    P.camYaw = h + Math.PI;
    d.game.paused = false;
    return car;
  };
  // hold the speed with the pedals (a cruise loop), steering to keep the heading (or a lane line)
  H.cruise = async (kmh, secs, lane) => {
    const c = d.controls, t0 = performance.now(), v = P.vehicle;
    const samp = { hMin: 1e9, hMax: -1e9, frames: 0, fa: 0 };
    while (performance.now() - t0 < secs * 1000) {
      const e = kmh / 3.6 - v.vLong;
      c.btn.gas = e > 0.3; c.btn.brake = e < -1.5;
      if (lane) {
        // steer onto the line: lateral error + heading error -> the A/D keys
        const lx = (v.x - lane.x) * lane.px + (v.z - lane.z) * lane.pz - lane.off;
        const hErr = Math.atan2(Math.sin(v.heading - lane.h), Math.cos(v.heading - lane.h));
        const want = -lx * 0.08 - hErr * 1.6;
        v.heading += Math.max(-0.01, Math.min(0.01, want * 0.02));
      }
      samp.hMin = Math.min(samp.hMin, v.susHeave || 0); samp.hMax = Math.max(samp.hMax, v.susHeave || 0);
      samp.fa = Math.max(samp.fa, Math.abs(v.susFa || 0));
      samp.frames++;
      await H.wait(16);
    }
    c.btn.gas = false; c.btn.brake = false;
    return samp;
  };
  // a route along a chain of edges that pass \`ok\`: from edge e's a end, onward
  // through the straightest continuation, up to n edges; points every ~2 m
  H.route = (e0, ok, n) => {
    if (!H.adj) { H.adj = new Map(); city.edges.forEach((e, i) => { for (const k of [e.a, e.b]) { if (!H.adj.has(k)) H.adj.set(k, []); H.adj.get(k).push(i); } }); }
    const pts = []; let e = e0, from = e0.a, used = new Set();
    for (let q = 0; q < n && e; q++) {
      used.add(e);
      const A = city.nodes[from], to = from === e.a ? e.b : e.a, B = city.nodes[to];
      const L = Math.hypot(B.x - A.x, B.z - A.z), k = Math.max(1, Math.round(L / 2));
      for (let i = 0; i < k; i++) pts.push([A.x + (B.x - A.x) * i / k, A.z + (B.z - A.z) * i / k]);
      const dx = (B.x - A.x) / L, dz = (B.z - A.z) / L;
      let best = null, bc = Math.cos(35 * Math.PI / 180);
      for (const fi of H.adj.get(to) || []) {
        const f = city.edges[fi];
        if (used.has(f) || !ok(f)) continue;
        const C = city.nodes[f.a === to ? f.b : f.a], l = Math.hypot(C.x - B.x, C.z - B.z) || 1;
        const c = ((C.x - B.x) * dx + (C.z - B.z) * dz) / l;
        if (c > bc) { bc = c; best = f; }
      }
      from = to; e = best;
    }
    return pts;
  };
  // drive a route at a held speed, steered by pure pursuit straight onto the heading
  H.follow = async (pts, kmh) => {
    const c = d.controls, v = P.vehicle, samp = { hMin: 1e9, hMax: -1e9, rMax: 0, fa: 0, frames: 0, dist: 0 };
    let i = 0, lx = v.x, lz = v.z;
    const t0 = performance.now();
    while (i < pts.length - 6 && performance.now() - t0 < 40000) {
      while (i < pts.length - 6 && Math.hypot(pts[i][0] - v.x, pts[i][1] - v.z) < 9) i++;
      const [tx, tz] = pts[Math.min(pts.length - 1, i)];
      const want = Math.atan2(tx - v.x, tz - v.z), err = Math.atan2(Math.sin(want - v.heading), Math.cos(want - v.heading));
      v.heading += err * 0.12;
      const e = kmh / 3.6 - v.vLong;
      c.btn.gas = e > 0.3; c.btn.brake = e < -1.5;
      samp.hMin = Math.min(samp.hMin, v.susHeave || 0); samp.hMax = Math.max(samp.hMax, v.susHeave || 0);
      samp.rMax = Math.max(samp.rMax, Math.abs(v.susRoll || 0));
      samp.fa = Math.max(samp.fa, Math.abs(v.susFa || 0));
      samp.dist += Math.hypot(v.x - lx, v.z - lz); lx = v.x; lz = v.z;
      samp.frames++;
      await H.wait(16);
    }
    c.btn.gas = false; c.btn.brake = false;
    return samp;
  };
  H.stats = () => JSON.parse(JSON.stringify(d.roadFeel ? d.roadFeel.stats : {}));
  H.resetStats = () => { if (d.roadFeel) for (const k in d.roadFeel.stats) d.roadFeel.stats[k] = 0; };
  return 'ok';
})()`;

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/autokw-feel-profile-${PORT}`, width: 1000, height: 600, extra: ['--autoplay-policy=no-user-gesture-required'] });
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
    const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
    const evaluate = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
      return r.result?.result?.value;
    };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
      writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(r.result.data, 'base64'));
    };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/autokw/` });
    let up = false;
    for (let i = 0; i < 400 && !up; i++) {
      await sleep(500);
      up = await evaluate('!!(window.__dbg && window.__dbg.traffic && window.__dbg.game && window.__hwy)');
    }
    if (!up) throw new Error('never booted: ' + errs.slice(0, 3).join(' | '));
    await sleep(2000);
    // a gesture for the audio
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 300, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 300, button: 'left', clickCount: 1 });
    await evaluate(HELPERS);
    await sleep(500);
    const out = {};
    if (process.env.FEEL_EVAL) console.log('eval', JSON.stringify(await evaluate(process.env.FEEL_EVAL)));

    if (PHASES.includes('rumble')) {
      // a sedan on the 401 / Hwy 8, its right wheels on the strip
      out.rumble = await evaluate(`(async () => {
        const H = __fp, R = __hwy.rumbleRuns || [], hw = __hwy;
        if (!R.length) return 'no rumble runs';
        const r = R[0];
        // find the strip's offset by scanning right of the run's start
        let off = null;
        for (let L = 0; L < 14 && off === null; L += 0.05) if (hw.rumbleAt(r.x + r.px * L, r.z + r.pz * L, __dbg.city.groundAt(r.x, r.z, null))) off = L + 0.18;
        if (off === null) return 'strip not found at its run';
        const h = Math.atan2(r.dx, r.dz);
        const v = H.drive('sedan', r.x + r.px * (off - 0.85), r.z + r.pz * (off - 0.85), h, 26);
        H.resetStats();
        const lane = { x: r.x, z: r.z, px: r.px, pz: r.pz, off: off - 0.85, h };
        const s = await H.cruise(95, 3, lane);
        const st = H.stats(), a = __dbg.audio;
        return { at: [r.x | 0, r.z | 0], stripOff: +off.toFixed(2), rumbleT: +st.rumbleT.toFixed(2), heave: [+s.hMin.toFixed(3), +s.hMax.toFixed(3)],
          loopOn: !!(a.loops && a.loops.rumble && a.loops.rumble.on), feelRumble: __dbg.roadFeel.rumble, kmh: Math.round(v.vLong * 3.6) };
      })()`);
      await shot('rumble');
      console.log('rumble', JSON.stringify(out.rumble));
    }

    if (PHASES.includes('rail')) {
      out.rail = await evaluate(`(async () => {
        const H = __fp, L = __dbg.link;
        if (!L || !L.crossings || !L.crossings.length) return 'no crossings';
        const res = [];
        for (const c of L.crossings.slice(0, 3)) {
          const e = c.road, a = __dbg.city.nodes[e.a];
          // along the road through the crossing, 45 m before it, right-hand lane
          const t = ((c.x - a.x) * e.dx + (c.z - a.z) * e.dz);
          const sx = a.x + e.dx * (t - 45) + e.dz * 1.8, sz = a.z + e.dz * (t - 45) - e.dx * 1.8;
          const h = Math.atan2(e.dx, e.dz);
          L.update && L.update(0.016, { position: { x: sx, y: 0, z: sz } });
          const v = H.drive('compsedan', sx, sz, h, 13);
          H.resetStats();
          const s = await H.cruise(50, 6, { x: sx, z: sz, px: e.dz, pz: -e.dx, off: 0, h });
          res.push({ at: [c.x | 0, c.z | 0], rails: H.stats().rails, heave: [+s.hMin.toFixed(3), +s.hMax.toFixed(3)], past: Math.round(((v.x - c.x) * e.dx + (v.z - c.z) * e.dz)) });
        }
        return res;
      })()`);
      await shot('rail');
      console.log('rail', JSON.stringify(out.rail));
    }

    if (PHASES.includes('deck')) {
      out.deck = await evaluate(`(async () => {
        const H = __fp, city = __dbg.city;
        // the longest straight deck: a freeway or river bridge
        let best = null;
        // (decks are cut into <= 50 m edges: the first long one that is a river or freeway bridge's)
        for (const e of city.edges) if (e.elev && !e.tunnel && e.len > 45 && (e.cls === 'hwy' || e.cls === 'art') && (!best || e.len > best.len)) best = e;
        if (!best) return 'no deck';
        const a = city.nodes[best.a], dir = best.onewayRev ? -1 : 1;
        const h = Math.atan2(best.dx * dir, best.dz * dir);
        const sx = dir > 0 ? a.x - best.dx * 40 : a.x + best.dx * (best.len + 40), sz = dir > 0 ? a.z - best.dz * 40 : a.z + best.dz * (best.len + 40);
        const v = H.drive('pickup', sx, sz, h, 22);
        v.y = city.groundAt(sx, sz, null);
        H.resetStats();
        const s = await H.cruise(80, 7, { x: a.x, z: a.z, px: best.dz * dir, pz: -best.dx * dir, off: 0, h });
        const st = H.stats();
        return { deckLen: Math.round(best.len), name: best.name, joints: st.joints, slabs: st.slabs, bottoms: st.bottoms, heave: [+s.hMin.toFixed(3), +s.hMax.toFixed(3)], floorAccMax: +s.fa.toFixed(1) };
      })()`);
      await shot('deck');
      console.log('deck', JSON.stringify(out.deck));
    }

    if (PHASES.includes('gravel')) {
      // ~1 km of a gravel concession road (crowned, rolling: the body over
      // its crests and dips) and ~1 km of a hilly paved country road, per type
      out.gravel = {};
      for (const type of ['sedan', 'civic', 'jeep', 'pickup', 'uhaul', 'semi']) {
        out.gravel[type] = await evaluate(`(async () => {
          const H = __fp, city = __dbg.city, G = __dbg.G;
          const res = {};
          for (const [name, ok, kmh] of [['gravel', (e) => e.gravel && !e.elev, 70], ['hills', (e) => !e.gravel && !e.elev && (e.cls === 'art' || e.cls === 'st') && !e.tunnel, 80]]) {
            // the start: the edge whose 1 km route climbs and falls the most (sampled)
            if (!H['r_' + name]) {
              let best = null, bs = -1, k = 0;
              for (const e of city.edges) {
                if (!ok(e) || e.len < 25 || (k++ % 23)) continue;
                const pts = H.route(e, ok, 30);
                if (pts.length < 300) continue;
                let s = 0; for (let i = 10; i < pts.length - 10; i += 10) { const h0 = G.terrainHeight(...pts[i - 10]), h1 = G.terrainHeight(...pts[i]), h2 = G.terrainHeight(...pts[i + 10]); s += Math.abs(h2 - 2 * h1 + h0); }
                if (s > bs) { bs = s; best = pts; }
              }
              H['r_' + name] = best;
            }
            const pts = H['r_' + name];
            if (!pts) { res[name] = 'no route'; continue; }
            const h = Math.atan2(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]);
            const v = H.drive(${JSON.stringify(type)}, pts[0][0], pts[0][1], h, kmh / 3.6 * 0.8);
            v.y = city.groundAt(pts[0][0], pts[0][1], null);
            await H.wait(200); H.resetStats();
            const s = await H.follow(pts, Math.min(kmh, v.spec.topKph * 0.9));
            res[name] = { at: pts[0].map((q) => q | 0), m: Math.round(s.dist), heave: [+s.hMin.toFixed(3), +s.hMax.toFixed(3)], rollMax: +(s.rMax * 57.3).toFixed(1), floorAccMax: +s.fa.toFixed(1), bottoms: H.stats().bottoms, rails: H.stats().rails };
          }
          return res;
        })()`);
        console.log('  gravel/hills', type, JSON.stringify(out.gravel[type]));
      }
      await shot('gravel');
    }

    if (PHASES.includes('engines')) {
      out.engines = await evaluate(`(() => {
        const r = {};
        for (const t of ['crossover', 'compsedan', 'wagon', 'civic', 'minivan', 'suv3', 'jeep', 'pickup', 'pickupcap', 'dually', 'uhaul', 'semi', 'ev', 'evy', 'opp']) {
          const spec = __dbg.TYPES[t];
          const name = __dbg.selectEngine(spec);
          r[t] = name;
        }
        return r;
      })()`);
      console.log('engines', JSON.stringify(out.engines));
    }

    if (PHASES.includes('jake')) {
      out.jake = await evaluate(`(async () => {
        const H = __fp, R = __hwy.rumbleRuns || [];
        const r = R[0];
        const h = Math.atan2(r.dx, r.dz);
        const lane = { x: r.x, z: r.z, px: r.px, pz: r.pz, off: -4.5, h };
        const v = H.drive('semi', r.x - r.px * 4.5, r.z - r.pz * 4.5, h, 25);
        await H.cruise(92, 2.5, lane);
        const m = __dbg.audio.engModel;
        const v0 = v.vLong, t0 = performance.now();
        let jk = 0, n = 0;
        while (performance.now() - t0 < 1500) { jk += m.jake; n++; await H.wait(16); }
        const dec = (v0 - v.vLong) / ((performance.now() - t0) / 1000);
        return { gear: v.gbox ? v.gbox.gear + 1 : null, audioGear: m.gear + 1, rpm: Math.round(m.rpm), jakeMean: +(jk / n).toFixed(2), decel: +dec.toFixed(2), kmh: Math.round(v.vLong * 3.6), profile: __dbg.audio.eng.profile };
      })()`);
      console.log('jake', JSON.stringify(out.jake));
    }

    if (PHASES.includes('camera')) {
      out.camera = {};
      for (const type of ['civic', 'sedan', 'suv3', 'uhaul', 'semi']) {
        out.camera[type] = await evaluate(`(async () => {
          const H = __fp, R = __hwy.rumbleRuns || [], r = R[1] || R[0];
          const h = Math.atan2(r.dx, r.dz);
          const lane = { x: r.x, z: r.z, px: r.px, pz: r.pz, off: -4.5, h };
          const v = H.drive(${JSON.stringify(type)}, r.x - r.px * 4.5, r.z - r.pz * 4.5, h, 15);
          await H.cruise(50, 2.5, lane);
          const P = __dbg.player, c = __dbg.camera;
          const rel = { back: Math.hypot(P.camPos.x - v.x, P.camPos.z - v.z), up: P.camPos.y - v.y, fov: c.fov };
          return { back: +rel.back.toFixed(1), up: +rel.up.toFixed(1), fov: +rel.fov.toFixed(1) };
        })()`);
        await shot(`cam-${type}`);
      }
      out.camera.fast = await evaluate(`(async () => {
        const H = __fp, R = __hwy.rumbleRuns || [], r = R[1] || R[0];
        const h = Math.atan2(r.dx, r.dz);
        const v = H.drive('sports', r.x - r.px * 4.5, r.z - r.pz * 4.5, h, 45);
        await H.cruise(170, 2.5, { x: r.x, z: r.z, px: r.px, pz: r.pz, off: -4.5, h });
        return { kmh: Math.round(v.vLong * 3.6), fov: +__dbg.camera.fov.toFixed(1) };
      })()`);
      await shot('cam-fast');
      console.log('camera', JSON.stringify(out.camera));
    }

    if (PHASES.includes('look')) {
      // a finger drags the look zone right while driving, holds still 1.5 s, lets go
      await evaluate(`(async () => { const H = __fp, R = __hwy.rumbleRuns || [], r = R[1] || R[0];
        const h = Math.atan2(r.dx, r.dz); H.drive('sedan', r.x - r.px * 4.5, r.z - r.pz * 4.5, h, 15); window.__fpLane = { x: r.x, z: r.z, px: r.px, pz: r.pz, off: -4.5, h }; })()`);
      const off = `(() => { const P = __dbg.player, v = P.vehicle; return +Math.atan2(Math.sin(P.camYaw - v.heading - Math.PI), Math.cos(P.camYaw - v.heading - Math.PI)).toFixed(3); })()`;
      const z = await evaluate(`(() => { const r = document.getElementById('lookZone').getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + r.height * 0.5]; })()`);
      const cruise = evaluate(`__fp.cruise(55, 6, window.__fpLane)`);
      await sleep(800);
      const pe = (type, x, y) => evaluate(`document.getElementById('lookZone').dispatchEvent(new PointerEvent('${type}', { pointerId: 7, clientX: ${x}, clientY: ${y}, bubbles: true, pointerType: 'touch' }))`);
      await pe('pointerdown', z[0], z[1]);
      for (let i = 1; i <= 10; i++) { await pe('pointermove', z[0] + i * 16, z[1]); await sleep(30); }
      const a0 = await evaluate(off);
      await sleep(1500);
      const a1 = await evaluate(off);
      await pe('pointerup', z[0] + 160, z[1]);
      await sleep(500);
      const a2 = await evaluate(off);
      await sleep(2500);
      const a3 = await evaluate(off);
      await cruise;
      out.look = { afterDrag: a0, heldStill1500ms: a1, released500ms: a2, released3s: a3 };
      console.log('look', JSON.stringify(out.look));
    }

    if (PHASES.includes('crash')) {
      out.crash = await evaluate(`(async () => {
        const H = __fp, city = __dbg.city;
        // a big building near the spawn: drive at its middle at 60 km/h from 45 m out
        const sp = __dbg.player.vehicle || __dbg.player;
        const px = sp.x !== undefined ? sp.x : __dbg.player.x, pz = sp.z !== undefined ? sp.z : __dbg.player.z;
        let best = null;
        for (const b of city.buildingsNear(px, pz, 400)) if (b.h > 6 && b.w > 14 && b.d > 14 && (!best || Math.hypot(b.x - px, b.z - pz) < Math.hypot(best.x - px, best.z - pz))) best = b;
        if (!best) return 'no building';
        // approach along the box's local x from outside
        const ux = Math.cos(best.rot), uz = Math.sin(best.rot);
        let sx = best.x + ux * (best.w / 2 + 45), sz = best.z + uz * (best.w / 2 + 45);
        const h = Math.atan2(-ux, -uz);
        const v = H.drive('sedan', sx, sz, h, 17);
        v.y = city.groundAt(sx, sz, null);
        const t0 = performance.now();
        let hit = null;
        while (performance.now() - t0 < 6000 && !(v.dents > 0)) { __dbg.controls.btn.gas = true; await H.wait(16); }
        __dbg.controls.btn.gas = false;
        const kmh = Math.round(v.vLong * 3.6);
        await H.wait(400);
        // look at the nose from ahead-left
        __dbg.game.paused = true;
        const f = v.forward;
        return { dents: v.dents, steamT: +v.steamT.toFixed(1), health: Math.round(v.health), at: [v.x | 0, v.z | 0], kmhAfter: kmh,
          cam: { x: v.x + f.x * 4.2 + f.z * 3.2, z: v.z + f.z * 4.2 - f.x * 3.2, y: v.y + 1.6, tx: v.x + f.x * 1.5, tz: v.z + f.z * 1.5, ty: v.y + 0.8 } };
      })()`);
      console.log('crash', JSON.stringify(out.crash));
      if (out.crash && out.crash.cam) {
        const c = out.crash.cam;
        await evaluate(`(() => { const C = __dbg.camera; __dbg.player.applyCamera = () => {}; C.position.set(${c.x}, ${c.y}, ${c.z}); C.lookAt(${c.tx}, ${c.ty}, ${c.tz}); return 1; })()`);
        await sleep(1200);
        await shot('crash-dent');
      }
    }

    if (PHASES.includes('dentshot')) {
      // the crumple close up, in good light: a sedan stood still, shot before
      // and after a front-corner hit (twice) and a side hit, the camera ahead-left
      const setup = await evaluate(`(async () => {
        const H = __fp, R = __hwy.rumbleRuns || [], r = R[1] || R[0];
        const h = Math.atan2(r.dx, r.dz);
        const v = H.drive('sedan', r.x - r.px * 8, r.z - r.pz * 8, h, 0);
        await H.wait(800);
        __dbg.game.paused = true;
        __dbg.player.applyCamera = () => {};
        const f = v.forward, rx = f.z, rz = -f.x, C = __dbg.camera;
        C.position.set(v.x + f.x * 3.9 - rx * 2.6, v.y + 1.35, v.z + f.z * 3.9 - rz * 2.6);
        C.lookAt(v.x + f.x * 0.8, v.y + 0.7, v.z + f.z * 0.8);
        window.__fpCar = v;
        return 1;
      })()`);
      await sleep(1500);
      await shot('dent-before');
      out.dent = await evaluate(`(() => {
        const v = window.__fpCar, f = v.forward, rx = f.z, rz = -f.x;
        // front-left corner (local -X is the camera's side), then the left door
        const fx = v.x + f.x * v.halfLen - rx * v.halfWid * 0.55, fz = v.z + f.z * v.halfLen - rz * v.halfWid * 0.55;
        const d1 = v.dent(fx, fz, 22), d2 = v.dent(fx, fz, 20);
        const d3 = v.dent(v.x - rx * v.halfWid + f.x * 0.3, v.z - rz * v.halfWid + f.z * 0.3, 16);
        return { d1: +d1.toFixed(3), d2: +d2.toFixed(3), d3: +d3.toFixed(3), dents: v.dents, steamT: +v.steamT.toFixed(1) };
      })()`);
      await sleep(400);
      await shot('dent-after');
      console.log('dent', JSON.stringify(out.dent));
    }

    writeFileSync(`${OUT}/feel.json`, JSON.stringify(out, null, 1));
    console.log(`\n  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('feelprobe failed:', e.message); process.exitCode = 1; });
