// Contact sheet of every vehicle, from fixed angles.
//
//   node tools/vehshots.mjs [tag]
//
// Two views per type -- front three-quarter and rear three-quarter -- framed by
// the vehicle's own length so a bus and a compact fill the frame the same
// amount and can be compared on detail rather than on size. The city is hidden
// and the ground is a plain plane, because the subject is the model.
//
// The camera is posed and the sun moved with it, for the reason survey.mjs
// learned the hard way: the shadow camera follows the player and a stale shadow
// map paints dark blotches that look exactly like the bug being hunted.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9232;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const TAG = process.argv[2] || 'now';
const OUT = `tools/data/vehicles/${TAG}`;

// name, azimuth (radians, 0 = looking at the nose), elevation factor.
const VIEWS = [
  ['front', 0.72, 0.30],
  ['rear', Math.PI - 0.62, 0.28],
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--window-size=900,600', '--no-first-run',
    '--user-data-dir=/tmp/auto-vshot-profile', 'about:blank',
  ], { stdio: 'ignore' });
}

async function main() {
  const chrome = launch();
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try {
        page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
          .find((t) => t.type === 'page');
      } catch { /* not up */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise((res) => {
      ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res);
    });
    const evaluate = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await evaluate('!!window.__dbg')) break;
    }

    await evaluate(`(() => {
      const d = window.__dbg;
      d.applyQuality('high', true);
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
      // The far skyline, the sea and the lakes are added straight to the scene,
      // NOT to world.group, so hiding the group alone still leaves the whole
      // city and Elliott Bay standing behind the subject.
      d.world.group.visible = false;          // buildings, roads, props
      d.world.terrainGroup.visible = false;
      if (d.world.skyline) d.world.skyline.visible = false;
      if (d.world.water) d.world.water.visible = false;
      for (const l of (d.world.lakes || [])) l.visible = false;
      d.player.h.group.visible = false;
      // A plain stage, so the only thing being judged is the model.
      const g = new d.THREE.Mesh(
        new d.THREE.PlaneGeometry(200, 200),
        new d.THREE.MeshStandardMaterial({ color: 0x6e7276, roughness: 0.95 }));
      g.rotation.x = -Math.PI / 2;
      g.position.set(0, 0.001, 0);
      g.receiveShadow = true;
      d.scene.add(g);
      window.__stage = g;
      // Flat ground for the whole session, so a vehicle sits level.
      d.city.groundAt = () => 0;
      d.city.roadLift = () => 0;
    })()`);

    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    // `__dbg.TYPES` only exists on builds that export it. Capturing an older
    // checkout for a before/after comparison has to fall back to asking the
    // traffic system what it can spawn, or the harness can only ever photograph
    // the branch it was written on.
    const types = await evaluate(`(() => {
      const d = window.__dbg;
      if (d.TYPES) return Object.keys(d.TYPES);
      return [...new Set(d.traffic.assets ? Object.keys(d.traffic.assets) : [])];
    })()`) || [];

    for (const name of types) {
      await evaluate(`(() => {
        const d = window.__dbg;
        if (window.__veh) d.traffic.remove(window.__veh);
        const v = d.traffic.spawnAt(0, 0, 0, '${name}', 0x8d3b30, 'free');
        v.y = 0;
        v.update(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: 0 });
        // The player's own car is the detailed build -- articulated wheels
        // rather than wheels baked into the body. Judge that one.
        v.setDetailed(true);
        window.__veh = v;
      })()`);
      for (const [view, az, elev] of VIEWS) {
        await evaluate(`(() => {
          const d = window.__dbg, v = window.__veh, s = d.TYPES['${name}'];
          // Frame by the vehicle's own size so every type fills the frame
          // equally -- otherwise this compares length, not craftsmanship.
          const r = s.len * 0.92;
          const cx = Math.sin(${az}) * r, cz = Math.cos(${az}) * r;
          const cy = s.roof * 0.62 + s.len * ${elev} * 0.55;
          d.camera.position.set(cx, cy, cz);
          d.camera.lookAt(0, s.roof * 0.42, 0);
          d.camera.updateMatrixWorld(true);
          d.sun.position.set(cx * 0.5 - s.len, s.len * 2.2, cz * 0.5 - s.len * 0.7);
          d.sun.target.position.set(0, 0, 0);
          d.sun.target.updateMatrixWorld();
          d.scene.updateMatrixWorld(true);
        })()`);
        await sleep(6000);
        const { result } = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${OUT}/${name}-${view}.png`, Buffer.from(result.data, 'base64'));
      }
      console.log(`  ${name}`);
    }
    console.log(`${types.length} vehicles -> ${OUT}/`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('vehshots failed:', e.message); process.exitCode = 1; });
