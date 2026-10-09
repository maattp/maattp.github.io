// Regression probes for the WO-6 bug bundle (activities freezing the world,
// dying mid-ride, fire calls, the Seafair DNF, the pistol, small leaks).
//
//   python3 -m http.server 8000      (from the repo root)
//   node tools/bugrepro/wo6.mjs [probe ...]      (probe names below; default all)
//
// One Chrome, one boot; each probe drives the real game through __dbg and
// asserts. Every check was seen to FAIL on v193 and passes after the fix. Env:
// AUTO_HTTP_PORT (8000), AUTO_CDP_PORT (9222), AUTO_PHONE=1 (phone viewport).
import { launchChrome } from '../chrome.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const HTTP = process.env.AUTO_HTTP_PORT || 8000, PORT = +process.env.AUTO_CDP_PORT || 9222;
const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-wo6-profile-${PORT}`, width: 1280, height: 720, extra: ['--autoplay-policy=no-user-gesture-required'] });
const die = (code) => { try { chrome.kill('SIGKILL'); } catch (e) { /* gone */ } process.exit(code); };
process.on('SIGINT', () => die(130));

async function target() {
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) return p; } catch (e) { /* not up */ }
    await sleep(300);
  }
  throw new Error('no target');
}
const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((a, b) => { ws.addEventListener('open', a); ws.addEventListener('error', b); });
let id = 0; const pend = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
});
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pend.set(i, { resolve, reject })); };
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
if (process.env.AUTO_BIG !== '1') await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
if (process.env.AUTO_PHONE === '1') {
  await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
}
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
await send('Page.navigate', { url: `http://localhost:${HTTP}/apps/auto/` });
for (let i = 0; i < 400; i++) { await sleep(500); if (await ev('!!window.__dbg')) break; }
for (let i = 0; i < 120; i++) { if (await ev('window.__dbg.sceneStats.calls > 0 && window.__dbg.traffic.cars.length > 0')) break; await sleep(500); }

// in-page helpers
await ev(`(() => { const d = __dbg, p = d.player;
  window.W = {
    leaked: [],
    sl: (ms) => new Promise((r) => setTimeout(r, ms)),
    // wait for cond() up to ms
    until: async (cond, ms = 20000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (cond()) return true; await W.sl(150); } return false; },
    reset: async () => {
      if (d.wheelRide.mode) d.wheelRide.abort ? d.wheelRide.abort() : d.wheelRide._alight();
      if (d.game.dead) await W.until(() => !d.game.dead, 30000);
      // a hold left over from the last probe is a leak: note it, THEN clear it
      W.leaked.push(...(d.game.holds ? d.game.holds : []), ...(d.game.leaks || []));
      if (d.game.holds) d.game.holds.clear();
      if (d.game.leaks) d.game.leaks.length = 0;
      d.game.paused = false; d.game.wanted = 0; d.police.clear();
      if (p.vehicle) p.exitVehicle(true);
      await W.sl(300);
    },
    die: async () => { d.game.damagePlayer(999, 'x'); await W.until(() => d.game.dead, 5000); await W.until(() => !d.game.dead, 300000); await W.sl(1500); },
    spawn: (type) => { const P = p.position; const f = { x: Math.sin(p.camYaw + Math.PI), z: Math.cos(p.camYaw + Math.PI) }; const dx = P.x + f.x * 8, dz = P.z + f.z * 8;
      const v = d.traffic.spawnAt(dx, dz, p.camYaw + Math.PI, type, 0xdfe3e6, 'free'); v.y = d.city.groundAt(dx, dz, null); v.sync(); return v; },
    hidden: (h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); },
  };
  return 1; })()`);

const PROBES = {
  // 1. backgrounding inside an activity must not un-freeze the world
  async hold() {
    return ev(`(async () => { const d = __dbg, p = d.player, o = {}; await W.reset();
      const sp = d.fishSpots[0];
      p.respawn(sp.rx, sp.rz); p.y = sp.y; await W.sl(600);
      d.game.tryInteract(p);
      o['fishing holds the world'] = d.fishing.active && d.game.paused;
      const menu = document.getElementById('pauseMenu');
      W.hidden(true); W.hidden(false); await W.sl(300);
      o['backgrounding opens no pause menu over the activity'] = !menu.classList.contains('show');
      document.getElementById('resumeBtn').click(); await W.sl(300);
      o['Resume cannot end the activity freeze'] = d.game.paused === true && d.fishing.active;
      document.getElementById('pauseBtn').click(); await W.sl(300);
      o['the pause button opens no menu over it either'] = !menu.classList.contains('show') && d.game.paused;
      const c = d.traffic.cars.find((c) => c.mode === 'traffic'); const x0 = c && c.x, z0 = c && c.z;
      await W.sl(2500);
      o['traffic frozen behind it'] = !c || (c.x === x0 && c.z === z0);
      d.fishing.close(); await W.sl(500);
      o['closing releases the world'] = !d.game.paused;
      // the menu itself still works on foot
      W.hidden(true); W.hidden(false); await W.sl(300);
      o['backgrounding in the open still pauses with the menu'] = d.game.paused && menu.classList.contains('show');
      document.getElementById('resumeBtn').click(); await W.sl(300);
      o['and Resume resumes'] = !d.game.paused;
      return o; })()`);
  },

  // 2. dying (or Respawn) mid Great Wheel / Needle ride
  async ride() {
    return ev(`(async () => { const d = __dbg, p = d.player, o = {}; await W.reset();
      const Wh = d.wheelRide, N = d.needleTop, cls = () => document.body.className;
      p.respawn(Wh.hub.x + 1, Wh.hub.z); p.y = Wh.deckY; o['boarded'] = Wh.tryInteract(p);
      await W.until(() => Wh.mode === 'ride', 150000);
      o['on the wheel'] = Wh.mode === 'ride';
      await W.die();
      o['wheel: mode cleared after death'] = Wh.mode === null && !Wh.busy;
      o['wheel: body class cleared'] = !/wheelOn/.test(cls());
      o['wheel: body shown, gondola gone'] = p.h.group.visible && !Wh.ridden;
      const x0 = p.x, z0 = p.z; await W.sl(2000);
      o['wheel: not dragged back'] = Math.hypot(p.x - x0, p.z - z0) < 1 && Math.hypot(p.x - Wh.hub.x, p.z - Wh.hub.z) > 40;
      p.respawn(N.X + 3, N.Z); p.y = N.Y; N.tryInteract(p);
      await W.sl(1500);
      o['in the needle lift'] = N.mode === 'ride';
      await W.die();
      o['needle: mode cleared after death'] = N.mode === null && !N.busy;
      o['needle: body class cleared'] = !/needleOn/.test(cls());
      o['needle: body shown'] = p.h.group.visible;
      return o; })()`);
  },

  // 3. fire calls end with the rig, the crew and the player
  async fire() {
    return ev(`(async () => { const d = __dbg, p = d.player, F = d.fire, o = {}; await W.reset();
      const v = W.spawn('fireengine'); p.enterVehicle(v); await W.sl(500);
      F.dispatch(); await W.sl(1200);
      o['a call is up'] = !!F.call && F.fires.length > 0 && !!d.game.fireTarget;
      await W.die();
      o['death ends the call'] = !F.call && F.fires.length === 0 && !d.game.fireTarget && !F.beacon.visible;
      const v2 = W.spawn('fireengine'); p.enterVehicle(v2); await W.sl(500);
      F.standDown(); F.dispatch(); await W.sl(1200);
      o['a second call is up'] = !!F.call;
      p.exitVehicle(true); await W.sl(1200);
      o['climbing out ends the call'] = !F.call && F.fires.length === 0 && !d.game.fireTarget && !F.beacon.visible;
      // the objective line: a newer one (a delivery) is not overwritten by the stale restore
      d.hud.setObjective('OLD OBJECTIVE');
      const v3 = W.spawn('fireengine'); p.enterVehicle(v3); await W.sl(500);
      F.standDown(); F.dispatch(); await W.sl(800);
      d.hud.setObjective('Deliver to Elsewhere');
      F.standDown();
      o['stand down leaves a newer objective alone'] = d.hud.objective.textContent === 'Deliver to Elsewhere';
      return o; })()`);
  },

  // 4. a Seafair race ended by death: no modal, no teleport to the pits
  async race() {
    return ev(`(async () => { const d = __dbg, p = d.player, sf = d.seafair, o = {}; await W.reset();
      sf._startRace({ id: 'heat', name: 'Heat 1', laps: 2 }); await W.sl(1500);
      o['racing'] = sf.state === 'staging' && sf.boats.length > 0;
      const boat0 = p.vehicle;
      await W.die();
      const panel = sf.ui.panel;
      // wait out the 8 s "left the boat" DNF timer (v193 ended the race with its panel here)
      await W.until(() => sf.state === 'done' || sf.state === 'idle', 240000); await W.sl(1500);
      o['no DID NOT FINISH modal'] = !panel.classList.contains('on') && !/NOT FINISH/.test(panel.textContent);
      o['the world is not frozen'] = !d.game.paused;
      o['not teleported to the pits'] = Math.hypot(p.x - sf.door.x, p.z - sf.door.z) > 30;
      o['the race is over'] = sf.state === 'idle' && sf.boats.length === 0;
      o['the boat is not left on the lake'] = !!boat0 && !d.traffic.cars.includes(boat0);
      return o; })()`);
  },

  // 5. the pistol does not shoot through walls or floors
  async pistol() {
    return ev(`(async () => { const d = __dbg, p = d.player, o = {}; await W.reset();
      await W.until(() => d.peds.peds.some((q) => q.state !== 'down'), 60000);
      // a big box with open ground round it
      let pick = null;
      for (const q of [[-2000, 800], [1500, -2500], [3000, 2000], [-4000, -1500], [800, 5000], [-800, -3500]]) {
        for (const b of d.city.buildingsNear(q[0], q[1], 900)) {
          if (b.w < 10 || b.d < 10 || b.h < 8 || b.w > 60 || b.d > 60) continue;
          const c = Math.cos(b.rot), s = Math.sin(b.rot);
          // local +x axis in the world, and the open ground 8 m / 22 m out each side
          const ax = c, az = -s;
          const A = { x: b.x + ax * (b.w / 2 + 8), z: b.z + az * (b.w / 2 + 8) }, B = { x: b.x - ax * (b.w / 2 + 8), z: b.z - az * (b.w / 2 + 8) };
          const free = (x, z) => d.city.buildingsNear(x, z, 4).every((q) => q === b || Math.hypot(q.x - x, q.z - z) > 12) && !d.city.onRoad(x, z, 0);
          if (free(A.x, A.z) && free(B.x, B.z)) { pick = { b, A, B, ax, az }; break; }
        }
        if (pick) break;
      }
      if (!pick) return { 'found a building': false };
      o['found a building'] = true;
      const { b, A, B } = pick;
      d.game.paused = true;                                  // freeze: the shots are posed
      const ped = d.peds.peds.find((q) => q.state !== 'down');
      const place = (q, x, z, y) => { q.x = x; q.z = z; q.y = y; q.hp = 30; q.state = 'walk'; q.h.group.position.set(x, y, z); };
      const shoot = (from, toward, pedAt, pedY) => {
        p.x = from.x; p.z = from.z; p.y = d.city.groundAt(from.x, from.z, null); p.vehicle = null; p.onFoot = true;
        const yaw = Math.atan2(toward.x - from.x, toward.z - from.z);
        p.camYaw = yaw - Math.PI; p.heading = yaw;
        p.armed = true; p.ammo = 50; p.attackCd = 0;
        place(ped, pedAt.x, pedAt.z, pedY === undefined ? d.city.groundAt(pedAt.x, pedAt.z, null) : pedY);
        p.attack(d.traffic, d.peds);
        return ped.hp < 30 || ped.state === 'down';
      };
      // far side of the building, same height: behind the wall
      o['a ped behind a building is not hit'] = shoot(A, B, B) === false;
      // in the open, the other way: hit
      const open = { x: A.x + (A.x - b.x) * 0.5, z: A.z + (A.z - b.z) * 0.5 };
      o['a ped in the open is hit'] = shoot(A, open, open) === true;
      // on a floor ten metres up, same line: not hit
      o['a ped ten metres above the line is not hit'] = shoot(A, open, open, d.city.groundAt(open.x, open.z, null) + 10) === false;
      // slopes: the ground, not the level of the barrel, is what a ped stands on
      // (v193's first fix missed at 6 % at 10 m, and at 8-18 % at 10-40 m)
      const G = d.G, ter = (x, z) => G.terrainHeight(x, z);
      const clear = (S, T, D) => {
        if (G.isWater(S.x, S.z) || G.isWater(T.x, T.z)) return false;
        for (let t = 0; t <= D; t += 1.5) {   // no landmark solid on the line either
          const x = S.x + (T.x - S.x) * t / D, z = S.z + (T.z - S.z) * t / D;
          if (d.city.landmarkHit && d.city.landmarkHit(x, z, 0.5, ter(x, z) + 1.45)) return false;
        }
        const mx = (S.x + T.x) / 2, mz = (S.z + T.z) / 2;
        for (const q of d.city.buildingsNear(mx, mz, D / 2 + 8)) {
          const dx = T.x - S.x, dz = T.z - S.z, t = Math.max(0, Math.min(1, ((q.x - S.x) * dx + (q.z - S.z) * dz) / (D * D)));
          if (Math.hypot(q.x - (S.x + dx * t), q.z - (S.z + dz * t)) < Math.hypot(q.w, q.d) / 2 + 3) return false;
        }
        return true;
      };
      const [cx0, cz0] = G.toWorld(47.6253, -122.3205);          // Capitol Hill
      const centres = [[cx0, cz0], [cx0 - 1500, cz0 - 1000], [cx0 + 1200, cz0 + 1500], [-2000, 800], [1500, -2500]];
      const findSlope = (grade, D) => {
        for (const [cx, cz] of centres) for (let x = cx - 1400; x <= cx + 1400; x += 20) for (let z = cz - 1400; z <= cz + 1400; z += 20) {
          const h0 = ter(x, z);
          for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4, T = { x: x + Math.sin(a) * D, z: z + Math.cos(a) * D };
            if (Math.abs((ter(T.x, T.z) - h0) / D - grade) < 0.012 && clear({ x, z }, T, D)) return { S: { x, z }, T };
          }
        }
        return null;
      };
      for (const grade of [-0.18, -0.11, -0.06, 0.06, 0.11, 0.18]) for (const D of [10, 25, 40]) {
        const c = findSlope(grade, D), name = 'slope ' + Math.round(grade * 100) + '% at ' + D + ' m';
        if (!c) { o[name + ': a site was found'] = false; continue; }
        o[name + ': a ped is hit'] = shoot(c.S, c.T, c.T) === true;
        if (!o[name + ': a ped is hit']) {   // say why: where, how far the wall is, how far off the height was
          const m = { x: c.S.x + Math.sin(p.heading) * 0.75, y: p.y + 1.45, z: c.S.z + Math.cos(p.heading) * 0.75 };
          o[name + ' (diagnosis)'] = JSON.stringify({ S: c.S, T: c.T, wall: p.wallDist(m, { x: Math.sin(p.heading), z: Math.cos(p.heading) }, 60), pedY: ped.y, groundT: d.city.groundAt(c.T.x, c.T.z, m.y) });
        }
      }
      // a car on a slope, and on the flat
      const carShot = (from, at) => {
        const v = d.traffic.spawnAt(at.x, at.z, 0, 'sedan', 0xdfe3e6, 'free');
        v.y = d.city.groundAt(at.x, at.z, null); v.sync(); v.mode = 'parked';
        p.x = from.x; p.z = from.z; p.y = d.city.groundAt(from.x, from.z, null); p.vehicle = null; p.onFoot = true;
        const yaw = Math.atan2(at.x - from.x, at.z - from.z);
        p.camYaw = yaw - Math.PI; p.heading = yaw; p.armed = true; p.ammo = 50; p.attackCd = 0;
        const h0 = v.health; p.attack(d.traffic, d.peds);
        const hit = v.health < h0;
        d.traffic.remove(v);
        return hit;
      };
      o['a car in the open is hit'] = carShot(A, open) === true;
      const cs = findSlope(0.11, 25), cd = findSlope(-0.11, 25);
      o['a car 11 % uphill at 25 m is hit'] = !!cs && carShot(cs.S, cs.T) === true;
      o['a car 11 % downhill at 25 m is hit'] = !!cd && carShot(cd.S, cd.T) === true;
      d.game.paused = false;
      return o; })()`);
  },

  // 6. small ones
  async small() {
    return ev(`(async () => { const d = __dbg, p = d.player, o = {}; await W.reset();
      // siren: a mission that turned it on turns it off
      const v = W.spawn('police'); p.enterVehicle(v); await W.sl(600);
      o['cruiser starts with the siren off'] = !v.sirenOn;
      d.hud.setObjective('OLD OBJECTIVE');
      d.missions.toggle(p); await W.sl(1200);
      o['the mission is on, siren on'] = !!d.missions.run && v.sirenOn;
      d.hud.setObjective('Deliver to Elsewhere');   // a delivery written meanwhile
      d.missions.toggle(p); await W.sl(300);        // cancel it
      o['cancelling turns the siren off again'] = !v.sirenOn;
      o['cancelling leaves a newer objective alone'] = d.hud.objective.textContent === 'Deliver to Elsewhere';
      p.exitVehicle(true); await W.sl(300);
      // parachuting, then taking a vehicle
      const { Skydive } = await import('./src/parachute.js');
      const car = W.spawn('sedan');
      p.onFoot = true; p.vehicle = null; p.h.group.visible = true;
      p.sky = new Skydive(p, { forward: { x: 0, z: 1 }, vLong: 0, heading: 0 }, p.h.group.parent);
      p.enterVehicle(car); await W.sl(500);
      o['taking a vehicle clears the jump'] = p.sky === null && !p.onFoot;
      p.exitVehicle(true);
      // ENTER under a canopy high over a road car does not seat you in it
      const car2 = W.spawn('sedan');
      p.onFoot = true; p.vehicle = null; p.h.group.visible = true;
      p.x = car2.x + 1; p.z = car2.z; p.y = car2.y + 40; p.vy = 0;
      p.sky = new Skydive(p, { forward: { x: 0, z: 1 }, vLong: 0, heading: 0 }, p.h.group.parent);
      d.controls.tapped = 'enter'; await W.sl(4000);
      o['ENTER 40 m over a car does not seat you'] = p.vehicle === null;
      p.endSky(); p.y = car2.y + 3; p.sky = new Skydive(p, { forward: { x: 0, z: 1 }, vLong: 0, heading: 0 }, p.h.group.parent);
      d.controls.tapped = 'enter'; await W.sl(4000);
      o['ENTER 3 m over it does'] = p.vehicle === car2;
      p.exitVehicle(true);
      return o; })()`);
  },

  // 4. an insurance policy: a hold with no activity behind it is let go
  async reap() {
    return ev(`(async () => { const d = __dbg, o = {}; await W.reset();
      d.game.hold('arcade');                    // as if arcade.start() had thrown
      o['an orphan hold freezes the world'] = d.game.paused === true;
      await W.until(() => !d.game.paused, 60000);
      o['the reaper lets it go'] = !d.game.paused && d.game.holds.size === 0;
      o['and records the leak'] = d.game.leaks.includes('arcade');
      d.game.leaks.length = 0;                  // (expected here; keeps the leak check meaningful)
      // a live activity's hold is left alone
      const sp = d.fishSpots[0]; d.player.respawn(sp.rx, sp.rz); d.player.y = sp.y; d.game.tryInteract(d.player);
      await W.sl(3000);
      o['a live activity keeps its hold'] = d.fishing.active && d.game.held;
      d.fishing.close(); await W.sl(500);
      o['and releases it itself'] = !d.game.held && d.game.leaks.length === 0;
      return o; })()`);
  },
};

const want = process.argv.slice(2).filter((a) => PROBES[a]);
const names = want.length ? want : Object.keys(PROBES);
let bad = 0;
for (const n of names) {
  console.log('\n== ' + n);
  let res;
  try { res = await PROBES[n](); } catch (e) { console.log('  ERROR', e.message.slice(0, 400)); bad++; continue; }
  // no activity hold may outlive its probe (the reaper and doRespawn would mask one)
  res['no leaked holds'] = await ev(`(() => { const g = __dbg.game; return g.holds.size === 0 && g.leaks.length === 0 && W.leaked.length === 0; })()`);
  for (const [k, v] of Object.entries(res)) { console.log(`  ${v === true ? 'PASS' : v === false ? 'FAIL' : 'INFO'}  ${k}${typeof v === 'boolean' ? '' : ' = ' + v}`); if (v === false) bad++; }
}
if (logs.length) console.log('\npage exceptions:\n' + logs.slice(0, 8).join('\n'));
console.log(bad ? `\n${bad} FAILED` : '\nall passed');
die(bad ? 1 : 0);
