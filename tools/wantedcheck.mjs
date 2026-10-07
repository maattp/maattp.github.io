// The wanted levels, measured: a scripted pursuit at each level at fixed dt.
//
//   python3 -m http.server 8000 &
//   node tools/wantedcheck.mjs [--secs 60] [--levels 1,2,3,4,5] [--runs N] [--shots DIR]
//
// For each level the player's car (a sports car) is driven by the
// getaway driver (getaway.js, which police missions use too), fleeing the nearest
// unit, from the same downtown start, with the level held fixed; the game
// itself is paused and stepped here at 1/30 s (traffic, peds, police, fx).
// Then the same level ON FOOT, standing still (how long until you are busted
// or wasted), and the cool-down: hidden (2 km from any unit), how long each
// star takes to go; and with the helicopter overhead in the open, that it
// does not.
//
// Per level it prints: how long the car survived (or "60 s+"), the car's and
// your health at the end, units spawned by kind, the most active at once
// against the level's cap, the share of the chase the helicopter had you in
// its beam, and shots / hits.
import { launchChrome } from './chrome.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const SECS = +(argVal('--secs') || 60);
const LEVELS = (argVal('--levels') || '1,2,3,4,5').split(',').map(Number);
const SHOTS = argVal('--shots');
const RUNS = +(argVal('--runs') || 1);   // chases per level (the traffic varies)
const CAR = argVal('--car') || 'sports';   // what the getaway is driven in (the tank, the Wedge: armour)
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9250;
const URL_BASE = process.env.AUTO_URL || `http://localhost:${HTTP_PORT}/apps/auto/`;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

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

// ---- page side ----------------------------------------------------------------
function pageInit() {
  const d = window.__dbg, P = d.player, T = d.traffic, pol = d.police, game = d.game;
  const STAR = [0, 30, 90, 190, 340, 560];
  const H = window.__wc = {};
  // a fixed start: the nearest arterial node to a point (downtown, by
  // Westlake, unless a shot moves it)
  H.startAt = (x, z) => {
    let best = null, bd = Infinity;
    for (const ei of d.city.edgesNear(x, z, 400)) {
      const e = d.city.edges[ei];
      if (e.cls === 'res' || e.cls === 'hwy' || e.cls === 'ramp' || e.elev || e.tunnel) continue;
      const a = d.city.nodes[e.a], dd = (a.x - x) ** 2 + (a.z - z) ** 2;
      if (dd < bd) { bd = dd; best = { x: a.x, z: a.z, node: e.a, prev: e.b }; }
    }
    H.start = best;
    return best;
  };
  H.startAt(200, 300);
  H.reset = () => {
    game.paused = true;
    game.dead = false; game.busted = false;
    document.getElementById('wasted').classList.remove('show');
    pol.clear();
    if (P.vehicle) P.exitVehicle(true);
    for (const v of [...T.cars]) if (v.mode === 'police' || v.mode === 'free' || v.unit) T.remove(v);
    game.wanted = 0; game.points = 0; game.cool = 0;
    P.respawn(H.start.x, H.start.z);
    P.health = 100;
    for (const k of Object.keys(pol.stats.spawned)) pol.stats.spawned[k] = 0;
    pol.stats.shots = 0; pol.stats.hits = 0; pol.stats.busts = 0; pol.stats.roadblocks = 0;
    if (pol.stats.wedged) { pol.stats.wedged.car = 0; pol.stats.wedged.swat = 0; }
    for (let i = 0; i < 20; i++) d.world.update(H.start.x, H.start.z, 2);
  };
  H.step = (dt, input) => {
    const p = P.position;
    const cd = { x: Math.sin(P.camYaw + Math.PI), z: Math.cos(P.camYaw + Math.PI) };
    T.update(dt, p.x, p.z, cd, P);
    d.peds.update(dt, p.x, p.z, P, T);
    const buried = d.G.terrainHeight(p.x, p.z) - p.y > 3;
    pol.update(dt, P, buried);
    d.fx.update(dt);
    H.frames = (H.frames || 0) + 1;
    if (H.frames % 15 === 0) d.world.update(p.x, p.z, 2);
  };
  // the chase: a sports car fleeing the nearest unit with the getaway driver
  H.chase = (level, secs, topV = 34, god = false) => {
    H.reset();
    // 12 m short of the start node on the street that leads to it, facing it
    // and rolling: spawned on the node facing north it began with a U-turn
    // into the kerb, and a third of the low-level runs were busted there
    const nA = d.city.nodes[H.start.node], nB = d.city.nodes[H.start.prev];
    const ux = nA.x - nB.x, uz = nA.z - nB.z, ul = Math.hypot(ux, uz) || 1;
    const back = Math.min(12, ul * 0.5);
    const v = T.spawnAt(nA.x - ux / ul * back, nA.z - uz / ul * back, Math.atan2(ux, uz), H.car || 'sports', 0x2255aa, 'free');
    v.vLong = 12;
    P.enterVehicle(v);
    const s = H.getawayState(H.start.node, H.start.prev, topV);
    game.setWanted(level);
    const dt = 1 / 30, out = { level, survived: null, cause: null, peak: 0, cap: 0, heliFrames: 0, seenFrames: 0, frames: 0, dist: 0 };
    const L = pol.level();
    out.cap = L.cars + L.vans + L.foot + L.swat + L.helis + (L.block || 0);
    let lx = v.x, lz = v.z;
    for (let i = 0; i < secs * 30; i++) {
      // hold the level: no escalation, no cooling
      game.wanted = level; game.points = STAR[level]; pol.unseenT = 0;
      if (game.dead) { out.survived = +(i * dt).toFixed(1); out.cause = game.busted ? 'busted' : 'wasted'; break; }
      const car = P.vehicle;
      if (!car) { out.survived = +(i * dt).toFixed(1); out.cause = 'out of the car'; break; }
      // flee the nearest unit (or the start, before any is out)
      let fx = H.start.x, fz = H.start.z, bd = Infinity;
      for (const u of T.cars) if (u.unit && u.mode === 'police') { const dd = (u.x - car.x) ** 2 + (u.z - car.z) ** 2; if (dd < bd) { bd = dd; fx = u.x; fz = u.z; } }
      const inp = H.getaway(d.city, T, car, s, dt, fx, fz);
      car.update(dt, inp);
      d.collideWithBuildings(car, d.city, null, false);
      car.sync();
      H.step(dt);
      out.dist += Math.hypot(car.x - lx, car.z - lz); lx = car.x; lz = car.z;
      const n = pol.n, act = n.cars + n.vans + n.foot + n.swat + n.helis;
      if (god) { car.health = 100; P.health = 100; }
      if (act > out.peak) out.peak = act;
      out.frames++;
      if (pol.helis.length) { out.heliFrames++; if (pol.helis.some((h) => h.sees)) out.seenFrames++; }
    }
    if (out.survived === null) out.survived = secs + '+';
    out.carHealth = P.vehicle ? Math.round(P.vehicle.health) : 0;
    out.health = Math.round(P.health);
    out.spawned = { ...pol.stats.spawned };
    out.shots = pol.stats.shots; out.hits = pol.stats.hits; out.blocks = pol.stats.roadblocks || 0;
    out.wedged = pol.stats.wedged ? { ...pol.stats.wedged } : null;
    out.dist = Math.round(out.dist);
    out.heliSeen = out.heliFrames ? +(out.seenFrames / out.heliFrames).toFixed(2) : null;
    return out;
  };
  // standing still on foot at the level: busted or wasted, and when
  H.stand = (level, secs) => {
    H.reset();
    game.setWanted(level);
    const dt = 1 / 30;
    for (let i = 0; i < secs * 30; i++) {
      game.wanted = level; game.points = STAR[level]; pol.unseenT = 0;
      if (game.dead) return { level, t: +(i * dt).toFixed(1), end: game.busted ? 'BUSTED' : 'WASTED', spawned: { ...pol.stats.spawned }, wedged: pol.stats.wedged ? { ...pol.stats.wedged } : null };
      H.step(dt);
    }
    return { level, t: secs + '+', end: 'free', spawned: { ...pol.stats.spawned }, wedged: pol.stats.wedged ? { ...pol.stats.wedged } : null };
  };
  // hidden: put the player 2 km from everything; when does each star go?
  H.cool = (level, secs, inOpen) => {
    H.reset();
    game.setWanted(level);
    const dt = 1 / 30, drops = [];
    // let the units and the helicopter arrive, chasing a standing target
    for (let i = 0; i < 25 * 30 && !inOpen; i++) { game.wanted = level; game.points = STAR[level]; H.step(dt); if (game.dead) break; }
    if (!inOpen) {
      // vanish: 2.2 km away, out of everything's sight
      const far = d.city.respawnPointNear(H.start.x + 1600, H.start.z - 1500);
      P.respawn(far.x, far.z);
      for (let i = 0; i < 20; i++) d.world.update(far.x, far.z, 2);
      // gone without a trace: where they last saw you is where you were
      pol.unseenT = 0; pol.trackLeft = 0;
    }
    let w = game.wanted, seenT = 0;
    const t0 = performance.now();
    for (let i = 0; i < secs * 30; i++) {
      // the frame loop's decay rule (main.js), the game being paused here
      if (game.wanted > 0 && pol.unseenT > 6 + game.wanted * 3) { pol.unseenT = 0; game.points = STAR[game.wanted - 1]; game.wanted--; }
      if (game.wanted !== w) { drops.push([w, game.wanted, +(i * dt).toFixed(1)]); w = game.wanted; }
      if (game.wanted === 0) break;
      if (inOpen) { P.health = 100; game.dead = false; }
      H.step(dt);
      if (pol.seen) seenT += dt;
    }
    return { level, inOpen: !!inOpen, drops, seenT: +seenT.toFixed(1), end: game.wanted, ms: Math.round(performance.now() - t0) };
  };
}

// ---- screenshots: the SWAT van, the officers, a helicopter chase ------------------
async function shots(S) {
  const snap = async (name, wait = 6000) => {
    await sleep(wait);
    const { data } = await S.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, 'base64'));
    console.log(`  ${SHOTS}/${name}.png`);
  };
  const ONLY = argVal('--only');
  const want = (k) => !ONLY || ONLY.split(',').includes(k);
  await S.eval(`(() => {
    for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns'])
      { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    const d = window.__dbg; d.applyQuality('high', true); return 1; })()`);
  // camera helper: from (cx, cy, cz) at (lx, ly, lz), the sun across the view
  const cam = (c) => S.eval(`(() => {
    const d = window.__dbg, c = ${JSON.stringify(c)};
    for (let i = 0; i < 400; i++) d.world.update(c.cx, c.cz, 60);
    d.camera.position.set(c.cx, c.cy, c.cz);
    d.camera.lookAt(c.lx, c.ly, c.lz);
    d.camera.updateMatrixWorld(true);
    const bear = Math.atan2(c.lx - c.cx, c.lz - c.cz), az = bear + (c.sun || 1.75), sr = Math.hypot(215, 150);
    d.sun.position.set(c.lx - Math.sin(az) * sr, c.ly + 200, c.lz - Math.cos(az) * sr);
    d.sun.target.position.set(c.lx, c.ly, c.lz); d.sun.target.updateMatrixWorld();
    d.scene.updateMatrixWorld(true);
    // the crowd's animation LOD culls against the camera: pose them for this one
    if (c.peds) { const P = d.player.position; d.peds.update(1e-4, P.x, P.z, d.player, d.traffic); d.peds.update(1e-4, P.x, P.z, d.player, d.traffic); }
    return 1; })()`);
  if (want('van')) {
    const v = await S.eval(`(() => {
      const d = window.__dbg, H = window.__wc; H.reset();
      d.player.h.group.visible = false;
      const st = H.start, e = d.city.edges[d.city.nodes[st.node].e[0]];
      const h = Math.atan2(e.dx, e.dz);
      // spawnPolice for its light bar, then parked here
      const v = d.traffic.spawnPolice(st.x, st.z, 'swat');
      v.mode = 'free'; v.place(st.x, st.z, h); v.vLong = 0; v.sync();
      v.lightL.visible = true; v.lightR.visible = false;
      window.__van = v;
      return { x: v.x, y: v.y, z: v.z, fx: Math.sin(h), fz: Math.cos(h) };
    })()`);
    const at = (along, side, up) => ({ x: v.x + v.fx * along + v.fz * side, y: v.y + up, z: v.z + v.fz * along - v.fx * side });
    const f = at(7.5, 5.5, 2.0), r = at(-8, -4.5, 2.2), sd = at(0.3, 9, 1.6);
    await cam({ cx: f.x, cy: f.y, cz: f.z, lx: v.x, ly: v.y + 1.4, lz: v.z });
    await snap('swat-van-front');
    await cam({ cx: r.x, cy: r.y, cz: r.z, lx: v.x, ly: v.y + 1.4, lz: v.z });
    await snap('swat-van-rear');
    await cam({ cx: sd.x, cy: sd.y, cz: sd.z, lx: v.x, ly: v.y + 1.4, lz: v.z, sun: 0.4 });
    await snap('swat-van-side');
    await S.eval(`window.__dbg.traffic.remove(window.__van), 1`);
  }
  if (want('officer')) {
    const o = await S.eval(`(async () => {
      const d = window.__dbg, H = window.__wc; H.reset();
      d.player.h.group.visible = false;
      const pm = await import('./src/peds.js');
      const st = H.start;
      const a = d.peds.spawnOfficer(st.x + 1.6, st.z, 'swat', null);
      const b = d.peds.spawnOfficer(st.x - 0.6, st.z, 'swat', null);
      const c = d.peds.spawnOfficer(st.x - 2.6, st.z, 'cop', null);
      for (const p of [a, b, c]) { p.heading = 0; p.h.group.position.set(p.x, p.y, p.z); p.h.group.rotation.y = 0; p.h.mesh.visible = true; }
      for (let i = 0; i < 30; i++) for (const p of [a, b, c]) pm.animateWalk(p.h, 0, 1 / 30, 0);
      pm.aimPose(a.h, 1, true);
      for (const p of [a, b, c]) { p.h.group.matrixWorldAutoUpdate = true; p.h.mesh.skeleton.frozen = false; p.h.group.updateMatrixWorld(true); }
      window.__offs = [a, b, c];
      return { x: st.x, y: a.y, z: st.z };
    })()`);
    await cam({ cx: o.x + 2.2, cy: o.y + 1.5, cz: o.z + 5.2, lx: o.x - 0.2, ly: o.y + 1.0, lz: o.z });
    await snap('officers');
    await cam({ cx: o.x + 3.4, cy: o.y + 1.6, cz: o.z + 1.6, lx: o.x + 1.6, ly: o.y + 1.2, lz: o.z });
    await snap('officer-aim');
    await S.eval(`(() => { for (const p of window.__offs) window.__dbg.peds.remove(p); return 1; })()`);
  }
  if (want('chase')) {
    // A four-star chase at a crawl, so everything catches up; then the
    // helicopter is put where a chase camera sees it (ahead, up and to the
    // side), its beam refreshed on the car, and two views taken.
    const r = await S.eval(`(() => { const d = window.__dbg, H = window.__wc; d.player.h.group.visible = true;
      // SODO, by the stadiums: low buildings, wide streets, open sky
      const [sx, sz] = d.G.toWorld(47.5905, -122.3290);
      H.startAt(sx, sz);
      const r = H.chase(4, 14, 15, true);
      const P = d.player, v = P.vehicle;
      if (!v) return { r, none: true };
      const h = d.police.helis.find((q) => !q.leaving) || null;
      const f = v.forward, rx = f.z, rz = -f.x;
      if (h) {
        h.x = v.x + f.x * 42 + rx * 18; h.z = v.z + f.z * 42 + rz * 18; h.y = v.y + 38;
        h.vx = 0; h.vz = 0; h.aimX = v.x; h.aimZ = v.z; h.aimY = v.y;
        d.police.searching = false;
        h.update(1e-4, d.police, d.police.level(), P, v);
        h.v.group.updateMatrixWorld(true);
      }
      return { r, x: v.x, y: v.y, z: v.z, fx: f.x, fz: f.z, hx: h ? h.x : v.x, hy: h ? h.y : v.y + 40, hz: h ? h.z : v.z }; })()`);
    console.log('  chase for the shot: ' + JSON.stringify(r.r).slice(0, 220));
    if (!r.none) {
      const bx = r.x - r.fx * 12, bz = r.z - r.fz * 12;
      await cam({ cx: bx, cy: r.y + 3.4, cz: bz, lx: r.x * 0.55 + r.hx * 0.45, ly: r.y * 0.55 + r.hy * 0.45, lz: r.z * 0.55 + r.hz * 0.45 });
      await snap('heli-chase');
      await cam({ cx: r.x - r.fz * 7 + r.fx * 3, cy: r.y + 1.7, cz: r.z + r.fx * 7 + r.fz * 3, lx: r.hx, ly: r.hy - 4, lz: r.hz });
      await snap('heli-beam');
    }
  }
  if (want('deploy')) {
    // standing still at four stars until the SWAT team is out
    const r = await S.eval(`(() => { const d = window.__dbg, H = window.__wc; H.startAt(200, 300); H.reset();
      d.game.setWanted(4);
      let t = 0;
      for (let i = 0; i < 60 * 30; i++) {
        d.game.wanted = 4; d.game.points = 340; d.police.unseenT = 0; d.player.health = 100; d.game.dead = false; d.police.bustT = 0;
        H.step(1 / 30); t = i / 30;
        if (d.peds.peds.filter((p) => p.kind === 'swat').length >= 3 && i > 30 * 8) break;
      }
      const P = d.player, sw = d.peds.peds.filter((p) => p.kind === 'swat');
      const van = d.traffic.cars.find((v) => v.unit === 'swat' && v.crew > 0);
      let ox = 0, oz = 0;
      for (const p of sw) { ox += p.x / sw.length; oz += p.z / sw.length; }
      return { t, x: P.x, y: P.y, z: P.z, swat: sw.length, ox: sw.length ? ox : P.x, oz: sw.length ? oz : P.z, vx: van ? van.x : P.x, vz: van ? van.z : P.z }; })()`);
    console.log('  deploy for the shot: ' + JSON.stringify(r));
    // from beyond the officers, looking back past them at their van
    const dx = r.ox - r.vx, dz = r.oz - r.vz, l = Math.hypot(dx, dz) || 1;
    await cam({ cx: r.ox + dx / l * 9 + dz / l * 4, cy: r.y + 2.6, cz: r.oz + dz / l * 9 - dx / l * 4,
      lx: (r.ox * 2 + r.vx) / 3, ly: r.y + 1.1, lz: (r.oz * 2 + r.vz) / 3, peds: true });
    await snap('swat-deployed');
  }
}

async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-wanted-profile-${PORT}`, width: 1280, height: 720 });
  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); target = (await r.json()).find((t) => t.type === 'page'); } catch { /* not up */ }
      if (!target) await sleep(300);
    }
    if (!target) throw new Error('no CDP target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const S = new Session(ws);
    await S.send('Runtime.enable'); await S.send('Page.enable'); await S.send('Network.enable');
    await S.send('Network.setBypassServiceWorker', { bypass: true });
    await S.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (process.env.AUTO_PHONE === '1') {
      await S.send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
      await S.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
    }
    await S.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await S.send('Page.navigate', { url: URL_BASE });
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await S.eval('!!(window.__dbg && window.__dbg.sceneStats.calls > 0 && window.__dbg.traffic.cars.length > 0)')) break;
    }
    await S.eval(`(${pageInit.toString()})()`);
    await S.eval(`window.__wc.car = ${JSON.stringify(CAR)}; 1`);
    await S.eval(`import('./src/getaway.js').then((m) => { window.__wc.getaway = m.getaway; window.__wc.getawayState = m.getawayState; return 1; })`);
    // Programs compiled from here on are compiled MID-PLAY (Hitches): the
    // game draws every frame while it is stepped, so a unit, an officer, the
    // helicopter, its beam or a tracer that brought a new material shows here.
    await S.eval(`(() => { window.__wc.prog0 = new Set(window.__dbg.renderer.info.programs.map((p) => p.cacheKey)); return 1; })()`);
    console.log(`wanted levels -- a scripted getaway in a ${CAR}, level held, 1/30 s steps`);
    const rows = [];
    for (const L of LEVELS) for (let k = 0; k < RUNS; k++) {
      const r = await S.eval(`window.__wc.chase(${L}, ${SECS})`);
      rows.push(r);
      const sp = r.spawned;
      console.log(`  ${L} star${L > 1 ? 's' : ' '}: car survived ${String(r.survived).padStart(4)} s${r.cause ? ' (' + r.cause + ')' : ''}, ${r.dist} m driven, car ${r.carHealth} / you ${r.health}; `
        + `spawned cars ${sp.car}, vans ${sp.swat}, cops ${sp.cop}, swat ${sp.swatOfficer}, helis ${sp.heli}; peak active ${r.peak} (cap ${r.cap}); `
        + `heli had you ${r.heliSeen === null ? '-' : Math.round(r.heliSeen * 100) + '%'}; shots ${r.shots}, hits ${r.hits}${r.blocks ? `; roadblocks ${r.blocks}` : ''}${r.wedged ? `; backed out of a wedge: cruisers ${r.wedged.car}, vans ${r.wedged.swat}` : ''}`);
      if (SHOTS) {
        // a frame of the chase as it ended
        await S.eval(`(() => { const d = window.__dbg; d.game.paused = true; return 1; })()`);
      }
    }
    {
      const np = await S.eval(`(() => { const s = window.__wc.prog0; return window.__dbg.renderer.info.programs.filter((p) => !s.has(p.cacheKey)).map((p) => p.name || '?'); })()`);
      console.log(`  programs compiled during the chases: ${np.length}${np.length ? ' (' + np.join(', ') + ')' : ''}`);
    }
    console.log('\nstanding still on foot');
    for (const L of LEVELS) {
      const r = await S.eval(`window.__wc.stand(${L}, 45)`);
      console.log(`  ${L} star${L > 1 ? 's' : ' '}: ${r.end} at ${r.t} s (cops ${r.spawned.cop}, swat ${r.spawned.swatOfficer}${r.wedged ? `; backed out: cruisers ${r.wedged.car}, vans ${r.wedged.swat}` : ''})`);
    }
    console.log('\ncooling down');
    for (const L of [2, 4]) {
      const r = await S.eval(`window.__wc.cool(${L}, 80, false)`);
      console.log(`  hidden from ${L} stars: ${r.drops.map(([a, b, t]) => `${a}->${b} at ${t} s`).join(', ')}; ends at ${r.end}`);
    }
    {
      const r = await S.eval(`window.__wc.cool(3, 40, true)`);
      console.log(`  3 stars in the open under the helicopter: seen ${r.seenT} s of 40, drops ${JSON.stringify(r.drops)}, ends at ${r.end}`);
    }
    // WC_PROBE='<expr>' / WC_PROBE_FILE=path: a one-off diagnostic after the runs
    const probe = process.env.WC_PROBE || (process.env.WC_PROBE_FILE && readFileSync(process.env.WC_PROBE_FILE, 'utf8'));
    if (probe) console.log(JSON.stringify(await S.eval(probe), null, 1));
    if (SHOTS) await shots(S);
    if (argVal('--json')) writeFileSync(argVal('--json'), JSON.stringify(rows, null, 1));
    const ex = S.logs.filter((l) => /EXCEPTION/.test(l));
    if (ex.length) { console.log('\nEXCEPTIONS:\n' + ex.slice(0, 8).join('\n')); process.exitCode = 1; }
  } finally {
    chrome.kill('SIGKILL');
  }
}
main().catch((e) => { console.error('wantedcheck failed:', e.message); process.exitCode = 1; });
