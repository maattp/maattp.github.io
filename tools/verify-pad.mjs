// Gamepad verification for apps/auto.
//
// A pad cannot be plugged into headless Chrome, so navigator.getGamepads is
// replaced before boot with one driven from a global the test writes. That
// exercises everything downstream of the poll -- the mapping table, the edge
// detection, the menu cursor and the analogue triggers -- which is where the
// bugs actually are. What it cannot check is that iOS reports `standard`
// mapping for a given pad; that needs a real device.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9224;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_BASE = process.env.AUTO_URL || 'http://localhost:8000/apps/auto/';

const SHIM = `
window.__noAutoQuality = true;
window.__pad = { axes: [0,0,0,0], buttons: new Array(17).fill(0), connected: true };
navigator.getGamepads = () => [{
  index: 0, id: 'test pad', mapping: 'standard', connected: window.__pad.connected,
  axes: window.__pad.axes,
  buttons: window.__pad.buttons.map(v => ({ pressed: v > 0.5, touched: v > 0, value: v })),
}];
`;

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--window-size=1280,720', '--no-first-run',
    '--user-data-dir=/tmp/auto-pad-profile', 'about:blank',
  ], { stdio: 'ignore' });
}

class S {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.p = new Map(); this.logs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.p.has(m.id)) { this.p.get(m.id)(m); this.p.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') {
        this.logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description
          || m.params.exceptionDetails.text));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r) => this.p.set(id, r));
  }
  async eval(expr, aw = false) {
    const r = await this.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: aw });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description
        || r.result.exceptionDetails.text);
    }
    return r.result?.result?.value;
  }
}

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

async function main() {
  const chrome = launch();
  try {
    let page;
    for (let i = 0; i < 80 && !page; i++) {
      try {
        page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
          .find((t) => t.type === 'page');
      } catch { /* not up */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const s = new S(ws);
    await s.send('Runtime.enable');
    await s.send('Page.enable');
    await s.send('Network.enable');
    await s.send('Network.setBypassServiceWorker', { bypass: true });
    // Bypassing the service worker is not enough: Chrome's own disk cache will
    // still hand back the previous build's modules, which reads exactly like a
    // change that didn't land.
    await s.send('Network.setCacheDisabled', { cacheDisabled: true });
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: SHIM });
    await s.send('Page.navigate', { url: URL_BASE });

    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await s.eval('!!window.__dbg')) break;
    }
    if (!await s.eval('!!window.__dbg')) throw new Error('never booted');
    console.log('booted with a synthetic pad\n');

    // Helpers: set pad state, then let a few frames run so poll() sees it.
    const set = async (js) => { await s.eval(`(() => { ${js} })()`); await sleep(450); };
    const clear = () => set('window.__pad.buttons.fill(0); window.__pad.axes=[0,0,0,0];');

    // --- touch controls come off screen -----------------------------------
    await set('window.__pad.buttons[9]=1;');
    await clear();
    check('pad presence hides the thumb controls',
      await s.eval('document.getElementById("app").dataset.pad === "1"'));

    // that Start press should have opened the pause menu
    check('Start opens the pause menu', await s.eval('__dbg.game.paused === true'));
    check('pause menu shows a controller cursor',
      await s.eval('!!document.querySelector("#pauseCard .padfocus")'),
      await s.eval('(document.querySelector("#pauseCard .padfocus")||{}).id || "(row)"'));

    // --- menu navigation ---------------------------------------------------
    const first = await s.eval('(document.querySelector("#pauseCard .padfocus")||{}).id || "rowQuality"');
    await set('window.__pad.buttons[13]=1;');   // dpad down
    await clear();
    const second = await s.eval('(document.querySelector("#pauseCard .padfocus")||{}).id || "(row)"');
    check('d-pad moves the cursor', first !== second, `${first} -> ${second}`);

    // A on a toggle row must actually toggle it
    const before = await s.eval('__dbg.game.settings.shadows');
    await set('window.__pad.buttons[0]=1;');
    await clear();
    const after = await s.eval('__dbg.game.settings.shadows');
    check('A activates the focused row', before !== after, `shadows ${before} -> ${after}`);

    // B closes the menu
    await set('window.__pad.buttons[1]=1;');
    await clear();
    check('B resumes', await s.eval('__dbg.game.paused === false'));

    // --- gameplay ----------------------------------------------------------
    await s.eval('__dbg.player.respawn(__dbg.G.SPAWN.x, __dbg.G.SPAWN.z)');
    await sleep(600);

    // left stick moves; right stick looks
    const yaw0 = await s.eval('__dbg.player.camYaw');
    await set('window.__pad.axes=[0,0,1,0];');
    await clear();
    const yaw1 = await s.eval('__dbg.player.camYaw');
    check('right stick turns the camera', Math.abs(yaw1 - yaw0) > 0.05,
      `yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);

    const p0 = await s.eval('({x:__dbg.player.position.x, z:__dbg.player.position.z})');
    await set('window.__pad.axes=[0,-1,0,0];');
    await sleep(1800);
    await clear();
    const p1 = await s.eval('({x:__dbg.player.position.x, z:__dbg.player.position.z})');
    const walked = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    check('left stick walks', walked > 1.0, `${walked.toFixed(1)} m`);

    // Y enters a vehicle
    await s.eval(`(() => { const d = window.__dbg, p = d.player.position;
      const v = d.traffic.nearestEnterable(p.x, p.z, 500);
      if (v) { d.player.x = v.x - 2; d.player.z = v.z; d.player.position.x = v.x - 2;
               d.player.position.z = v.z; } })()`);
    await sleep(400);
    await set('window.__pad.buttons[3]=1;');
    await clear();
    const inCar = await s.eval('!__dbg.player.onFoot');
    check('Y enters a vehicle', inCar);

    if (inCar) {
      // RT is analogue: half a trigger must give roughly half the throttle
      await set('window.__pad.buttons[7]=0.5;');
      const half = await s.eval('__dbg.controls.read().gasAmt');
      await set('window.__pad.buttons[7]=1;');
      const full = await s.eval('__dbg.controls.read().gasAmt');
      check('RT throttle is analogue, not on/off',
        half > 0.4 && half < 0.6 && full > 0.95, `half=${half} full=${full}`);

      const v0 = await s.eval('({x:__dbg.player.position.x, z:__dbg.player.position.z})');
      await sleep(2500);
      const v1 = await s.eval('({x:__dbg.player.position.x, z:__dbg.player.position.z})');
      const drove = Math.hypot(v1.x - v0.x, v1.z - v0.z);
      check('RT drives the car', drove > 1.0, `${drove.toFixed(1)} m`);

      // A is the handbrake in a car and must NOT be jump
      const st = await s.eval('({hand:__dbg.controls.read().hand, jump:__dbg.controls.read().jump})');
      await set('window.__pad.buttons[0]=1;');
      const st2 = await s.eval('({hand:__dbg.controls.read().hand, jump:__dbg.controls.read().jump})');
      check('A is handbrake while driving, not jump', st2.hand && !st2.jump,
        JSON.stringify(st2));
      // L3 is the horn in a car, sprint on foot
      await clear();
      await set('window.__pad.buttons[10]=1;');
      check('L3 is the horn while driving',
        await s.eval('__dbg.controls.read().horn === true'));
      await clear();

      await set('window.__pad.buttons[3]=1;');
      await clear();
      check('Y exits the vehicle', await s.eval('__dbg.player.onFoot === true'));
    }

    // on foot, L3 is sprint and A is jump
    await set('window.__pad.buttons[10]=1;');
    check('L3 sprints on foot', await s.eval('__dbg.controls.read().sprint === true'));
    await clear();
    await set('window.__pad.buttons[0]=1;');
    check('A jumps on foot', await s.eval('__dbg.controls.read().jump === true'));
    await clear();

    // Back opens the map, and closes it again
    await set('window.__pad.buttons[8]=1;');
    await clear();
    const mapOpen = await s.eval('__dbg.game.mapOpen === true');
    await set('window.__pad.buttons[1]=1;');
    await clear();
    check('Back opens the map, B closes it',
      mapOpen && await s.eval('__dbg.game.mapOpen === false'));

    // --- map warp ----------------------------------------------------------
    await set('window.__pad.buttons[8]=1;');   // Back -> open map
    await clear();
    await set('window.__pad.buttons[2]=1;');   // X -> arm the spawn picker
    await clear();
    check('X arms the spawn picker',
      await s.eval('!!__dbg.hud.warp && document.getElementById("warpBtn").classList.contains("on")'));

    const c0 = await s.eval('({x:__dbg.hud.warp.x, z:__dbg.hud.warp.z})');
    await set('window.__pad.axes=[1,0,0,0];');
    await sleep(1200);
    await clear();
    const c1 = await s.eval('({x:__dbg.hud.warp.x, z:__dbg.hud.warp.z})');
    check('stick moves the crosshair', Math.abs(c1.x - c0.x) > 100,
      `${c0.x.toFixed(0)} -> ${c1.x.toFixed(0)}`);

    // the crosshair must resolve to a road, and A must drop the player onto it
    const snap = await s.eval('__dbg.hud.warp.snap');
    check('crosshair resolves to a road', !!snap,
      snap ? `${snap.dist.toFixed(0)} m away` : 'none');
    await set('window.__pad.buttons[0]=1;');   // A -> confirm
    await clear();
    const after2 = await s.eval(`(() => { const p = __dbg.player.position;
      const n = __dbg.city.respawnPointNear(p.x, p.z, 40);
      return { x: p.x, z: p.z, onRoad: !!n && n.dist < 6, mapOpen: __dbg.game.mapOpen,
               onFoot: __dbg.player.onFoot }; })()`);
    check('A drops the player, on a road, and closes the map',
      after2.onRoad && !after2.mapOpen && after2.onFoot, JSON.stringify(after2));

    // a point far out in Puget Sound has no road and must be refused
    const refused = await s.eval(`(() => {
      const before = { x: __dbg.player.position.x, z: __dbg.player.position.z };
      const n = __dbg.city.respawnPointNear(-7200, -1200, 1200);
      return { snapped: n, ok: n === null || Math.hypot(n.x + 7200, n.z + 1200) > 0 };
    })()`);
    check('open water finds no nearby road', refused.snapped === null,
      refused.snapped ? `snapped ${refused.snapped.dist.toFixed(0)} m` : 'refused');

    // unplugging must not leave anything held
    await set('window.__pad.buttons[7]=1;');
    await set('window.__pad.connected=false;');
    await clear();
    check('unplugging releases every held input',
      await s.eval('__dbg.controls.read().gasAmt === 0 && !__dbg.controls.hasPad'));

    const ex = s.logs.filter((l) => /EXCEPTION/.test(l));
    if (ex.length) console.log('\n' + ex.slice(0, 6).join('\n'));
    const bad = results.filter((r) => !r.pass).length + ex.length;
    console.log(`\n${bad ? 'FAIL' : 'OK'}: ${results.length - results.filter(r => !r.pass).length}`
      + `/${results.length} checks, ${ex.length} exceptions`);
    process.exitCode = bad ? 1 : 0;
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('verify-pad failed:', e.message); process.exitCode = 1; });
