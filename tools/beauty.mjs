// Beauty shots for judging visual quality.
//
//   node tools/beauty.mjs [tag]
//
// A fixed set of framed views, captured identically every time so two runs can
// be compared honestly. The HUD is hidden and the quality tier is locked to
// `high` -- SwiftShader's ~4 fps otherwise trips the adaptive downgrade and
// every shot silently comes back at the low-quality settings.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9228;
// The page port is overridable so a second checkout -- a worktree at master,
// say -- can be captured with THIS harness for an honest before/after. Framing
// has to come from the same code or the two sets are not comparable.
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TAG = process.argv[2] || 'now';
const OUT = `tools/data/beauty/${TAG}`;

// Views are CHOSEN FROM THE MAP, not hardcoded.
//
// Fixed coordinates went stale as soon as the city became real data: the shot
// named `park` contained no park and `residential` framed a four-storey office
// block, so vegetation and housing were never actually being looked at. Each
// entry names a query run against the loaded city; the harness resolves it to a
// camera and a look-at at capture time.
//
// Heights are relative to the ground at that point, not absolute. Absolute
// heights put the Green Lake camera at y=30 under a lake whose surface is at
// 50 m, so the shot came back as the underside of the water plane -- which
// reads exactly like a broken renderer and is entirely the harness's fault.
const VIEWS = [
  { name: 'street', pick: 'commercial', eye: 1.7, look: 1.7, back: 26, ahead: 70 },
  { name: 'shopfront', pick: 'commercial', eye: 1.7, look: 3.0, back: 15, ahead: 0 },
  { name: 'residential', pick: 'houses', eye: 4, look: 1.5, back: 55, ahead: 0 },
  { name: 'park', pick: 'park', eye: 5, look: 2, back: 70, ahead: 0 },
  { name: 'downtown', pick: 'downtown', eye: 70, look: 20, back: 340, ahead: 0 },
  { name: 'skyline', pick: 'downtown', eye: 150, look: 30, back: 2400, ahead: 0 },
  { name: 'waterfront', pick: 'waterfront', eye: 12, look: 2, back: 90, ahead: 0 },
];

// Runs in the page. Returns the world point each view should look AT, chosen by
// querying the city rather than by a coordinate written down months ago.
const PICKERS = `(() => {
  const d = window.__dbg, city = d.city, G = d.G;
  const out = {};

  // Densest cluster of the class we want, on a 300 m grid over the buildings.
  const cluster = (want, minH, maxH) => {
    const cells = new Map();
    for (const b of city.buildings) {
      if (!want(b) || b.h < minH || b.h > maxH) continue;
      const k = Math.round(b.x / 300) * 100000 + Math.round(b.z / 300);
      let c = cells.get(k);
      if (!c) cells.set(k, (c = { n: 0, x: 0, z: 0 }));
      c.n++; c.x += b.x; c.z += b.z;
    }
    let best = null;
    for (const c of cells.values()) if (!best || c.n > best.n) best = c;
    return best ? { x: best.x / best.n, z: best.z / best.n } : { x: 0, z: 0 };
  };

  out.downtown = cluster((b) => b.h > 60, 0, 1e9);
  out.houses = cluster((b) => b.style === 'house', 0, 1e9);
  // A commercial frontage with a shopfront band: that is what carries signage,
  // and it is the thing the street and shopfront shots exist to look at.
  out.commercial = cluster(
    (b) => (b.style === 'brick' || b.style === 'lowrise' || b.style === 'midrise')
      && b.w > 18, 12, 45);

  // Park: a patch of green mask that is fully green over a 240 m window, is
  // inland, and is the closest such patch to downtown -- so the shot is a city
  // park and not the forest in the corner of the map, which is where scanning
  // from one edge and stopping at the first hit used to land it.
  {
    const d0 = out.downtown;
    let best = null;
    for (let x = -5000; x <= 5000; x += 200) {
      for (let z = -5000; z <= 5000; z += 200) {
        let n = 0;
        for (let dx = -120; dx <= 120; dx += 60) {
          for (let dz = -120; dz <= 120; dz += 60) {
            if (G.inPark(x + dx, z + dz)) n++;
          }
        }
        if (n < 25) continue;
        const dd = (x - d0.x) * (x - d0.x) + (z - d0.z) * (z - d0.z);
        if (!best || dd < best.dd) best = { x, z, dd };
      }
    }
    out.park = best || { x: 0, z: 0 };
  }

  // Waterfront: walk west from downtown until the surface mask says water, then
  // stand back on the land side of it.
  {
    const d0 = out.downtown;
    let wx = d0.x, wz = d0.z;
    for (let i = 0; i < 400; i++) {
      if (G.isWater && G.isWater(wx, wz)) break;
      wx -= 20;
    }
    out.waterfront = { x: wx, z: wz };
  }
  return JSON.stringify(out);
})()`;

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', '--no-first-run',
    '--user-data-dir=/tmp/auto-beauty-profile', 'about:blank',
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
      // SSAO ships off, so the harness needs a way to photograph it -- the only
      // reason it stayed broken for so long is that nothing ever framed a road
      // with it enabled.
      if (${JSON.stringify(!!process.env.AUTO_SSAO)}) d.postfx.setFx('ssao', true);
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
    })()`);

    mkdirSync(OUT, { recursive: true });
    const picks = JSON.parse(await evaluate(PICKERS));
    console.log('  targets: ' + Object.entries(picks)
      .map(([k, v]) => `${k}(${v.x | 0},${v.z | 0})`).join(' '));

    for (const V of VIEWS) {
      const t = picks[V.pick];
      // Stand back along a fixed bearing so two runs frame the same thing, and
      // push the look-at past the subject for the street shot so the frame has
      // a receding street in it rather than a wall.
      const bear = 0.9;
      const cx = t.x - Math.sin(bear) * V.back;
      const cz = t.z - Math.cos(bear) * V.back;
      const lx = t.x + Math.sin(bear) * V.ahead;
      const lz = t.z + Math.cos(bear) * V.ahead;
      const counts = await evaluate(`(() => {
        const d = window.__dbg;
        // Settle the streamer. Chunk geometry is time-sliced across frames now,
        // and this harness pauses the game -- so a single update builds a few
        // milliseconds of geometry and nothing ever continues it. Every shot
        // taken since that change was a photograph of bare terrain with cars
        // standing on dirt, which is the third time a harness has quietly
        // invalidated the thing it was built to measure.
        const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
        d.world.update(${cx}, ${cz}, 60);
        for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(${cx}, ${cz}, 60);
        const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
        const cy = gy(${cx}, ${cz}) + ${V.eye};
        const ly = gy(${lx}, ${lz}) + ${V.look};
        d.camera.position.set(${cx}, cy, ${cz});
        d.camera.lookAt(${lx}, ly, ${lz});
        d.camera.updateMatrixWorld(true);
        // The sun is a DIRECTION, and it has to be the game's direction.
        //
        // Aiming it from the camera at the look-at point works by accident for
        // a close shot and is badly wrong for a far one: on the 2400 m skyline
        // view the light ended up 240 m above a target 2400 m away, which is a
        // sun 5.7 deg above the horizon. Every up-facing surface in the aerial
        // was getting a tenth of the key, and the whole mid-ground rendered as
        // a black band -- read for four passes as an albedo problem, then as a
        // missing ambient term, and it was neither.
        //
        // main.js uses an offset of (-215, 200, -150) from the point of
        // interest, about 38 deg. Reproduce it exactly, anchored partway into
        // the shot so the shadow box covers what is in frame.
        const ax = ${cx} + (${lx} - ${cx}) * 0.25, az = ${cz} + (${lz} - ${cz}) * 0.25;
        const ay = gy(ax, az);
        // Put the sun ACROSS the view, not behind it.
        //
        // main.js's fixed (-215, 200, -150) offset throws shadows toward xz
        // (0.82, 0.57). Every view here is framed on a bearing of 0.9, which
        // looks toward (0.78, 0.62) -- 4.5 degrees apart. So in every shot the
        // sun was almost directly behind the camera and every shadow fell away
        // from it, hidden behind its own caster. That is why the park shot measured a
        // 1.3:1 lit-to-shadow ratio and looked unlit: the numbers were reading
        // bounce and baked AO, not the key light at all.
        //
        // Same elevation (38 deg) and the same distance, rotated 100 degrees off
        // the view bearing so shadows cross the frame and can be seen.
        const SUN_AZ = 0.9 + 1.75;
        const sr = Math.hypot(215, 150);
        d.sun.position.set(ax - Math.sin(SUN_AZ) * sr, ay + 200, az - Math.cos(SUN_AZ) * sr);
        d.sun.target.position.set(ax, ay, az);
        d.sun.target.updateMatrixWorld();
        // Populate the shot. The game is paused so the camera can be flown, and
        // traffic only spawns from its own update -- so every shot used to come
        // back with an empty city and the world-density read was the harness's,
        // not the game's. Seed around the VIEW, not the player.
        const dir = new d.THREE.Vector3(${lx} - ${cx}, 0, ${lz} - ${cz}).normalize();
        d.traffic.updateParked(${cx}, ${cz});
        for (let i = 0; i < 26; i++) d.traffic.spawnTraffic(${cx}, ${cz}, dir);
        if (d.peds && d.peds.spawn) for (let i = 0; i < 40; i++) d.peds.spawn(${cx}, ${cz});
        // Spawning sets logical positions; the MESHES are only moved by each
        // system's update, which the pause stops from ever running. Without
        // these steps the shot counted a dozen cars in frame and rendered
        // none of them -- the counts were right and the picture was empty.
        for (let i = 0; i < 4; i++) {
          d.traffic.update(0.016, ${cx}, ${cz}, dir, d.player);
          d.peds.update(0.016, ${cx}, ${cz}, d.player, d.traffic);
        }
        // Count what is actually IN FRAME, so a density claim is a number and
        // not an impression. Anything else is scoring the harness.
        d.scene.updateMatrixWorld(true);
        const fr = new d.THREE.Frustum().setFromProjectionMatrix(
          new d.THREE.Matrix4().multiplyMatrices(
            d.camera.projectionMatrix, d.camera.matrixWorldInverse));
        const v = new d.THREE.Vector3();
        const inView = (x, y, z) => fr.containsPoint(v.set(x, y, z));
        let cars = 0, people = 0;
        for (const c of d.traffic.cars) if (inView(c.x, c.y + 1, c.z)) cars++;
        for (const p of d.peds.peds) if (inView(p.x, p.y + 1, p.z)) people++;
        return JSON.stringify({ cars, people });
      })()`);
      await sleep(9000);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${V.name}.png`, Buffer.from(result.data, 'base64'));
      const c = JSON.parse(counts);
      console.log(`  ${OUT}/${V.name}.png  in frame: ${c.cars} vehicles, ${c.people} pedestrians`);
    }
    const stats = await evaluate('({calls: __dbg.sceneStats.calls, tris: __dbg.sceneStats.tris})');
    console.log(`  scene: ${stats.calls} draws, ${stats.tris} triangles`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('beauty failed:', e.message); process.exitCode = 1; });
