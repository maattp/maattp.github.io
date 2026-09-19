// In-city crowd shots: the pedestrians the way a player actually sees them.
//
//   node tools/crowdshots.mjs [tag]
//
// charshots.mjs photographs one character on a plain stage, which is the right
// way to judge a model and the wrong way to judge how a crowd reads from the
// pavement -- at street distance a face is twenty pixels and what carries is
// silhouette, garment contrast and hair. This frames the same place beauty.mjs's
// `street` and `shopfront` views do (the densest commercial frontage), resolves
// it to a real pavement, and poses a FIXED set of 12 pedestrians along it: same
// seeds, same spots, same phases every run, posed at dt = 0 so no history or
// streaming order can change what is in frame. A before/after is only honest if
// both sides photograph the same people doing the same thing.
//
// AUTO_HTTP_PORT points it at another checkout (a master worktree) so the
// before shot comes from this harness, not from a different one.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9238;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TAG = process.argv[2] || 'now';
const OUT = `tools/data/crowd/${TAG}`;
const PEOPLE = 12;

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', '--no-first-run',
    `--user-data-dir=/tmp/auto-crowd-profile-${PORT}`, 'about:blank',
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
    const evaluate = async (e, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise });
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

    const site = JSON.parse(await evaluate(`(async () => {
      const d = window.__dbg, city = d.city;
      d.applyQuality('high', true);
      // Including the pause menu: headless pages can fire visibilitychange,
      // which opens the settings card over the shot.
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu','loading'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
      d.player.h.group.visible = false;

      // beauty.mjs's commercial pick, verbatim, so this is the same street.
      const cells = new Map();
      for (const b of city.buildings) {
        if (!((b.style === 'brick' || b.style === 'lowrise' || b.style === 'midrise') && b.w > 18)) continue;
        if (b.h < 12 || b.h > 45) continue;
        const k = Math.round(b.x / 300) * 100000 + Math.round(b.z / 300);
        let c = cells.get(k);
        if (!c) cells.set(k, (c = { n: 0, x: 0, z: 0 }));
        c.n++; c.x += b.x; c.z += b.z;
      }
      let top = null;
      for (const c of cells.values()) if (!top || c.n > top.n) top = c;
      const t = { x: top.x / top.n, z: top.z / top.n };

      // The nearest walkable street at least 45 m long: the pavement the
      // pedestrian system itself would put people on (PedSystem.spawn's rules).
      let best = null;
      for (const ei of city.edgesNear(t.x, t.z, 400)) {
        const e = city.edges[ei];
        if (e.elev || e.cls === 'hwy' || e.cls === 'ramp' || e.tunnel) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 45) continue;
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const dd = (mx - t.x) ** 2 + (mz - t.z) ** 2;
        if (!best || dd < best.dd) best = { ei, dd, len };
      }
      const e = city.edges[best.ei], A = city.nodes[e.a];
      const ux = (city.nodes[e.b].x - A.x) / best.len, uz = (city.nodes[e.b].z - A.z) / best.len;
      const at = (s, off) => ({ x: A.x + ux * s - uz * off, z: A.z + uz * s + ux * off });
      const hdg = Math.atan2(ux, uz);

      // The fixed cast. hash() is local so a master checkout gives the same
      // numbers without needing anything from util.js.
      const hash = (k, j) => { let h = (k * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
      const m = await import('./src/peds.js');
      // One of EACH pooled look. makeHumanoid picks a pooled geometry by
      // floor(hash2(seed, 9) * 12) on both builds, and the first cast here
      // (seeds 1000 + k * 7919) landed on the same look for nearly everyone --
      // a crowd of identical teal shirts that photographed the harness, not the
      // pool. Take the first seed that lands on each look instead.
      const seeds = [];
      for (let v = 0, s = 1; v < ${PEOPLE} && s < 100000; s++) {
        if (Math.floor(hash(s, 9) * 12) % 12 === seeds.length) { seeds.push(s); v++; s = 0; }
      }
      window.__crowd = [];
      for (let k = 0; k < ${PEOPLE}; k++) {
        // Close and spread across the pavement's width, not single file.
        const s = 9 + k * 1.35 + (hash(k, 1) - 0.5) * 1.0;
        const off = e.hw + 0.5 + hash(k, 2) * 2.4;
        const p = at(s, off);
        const h = m.makeHumanoid({ seed: seeds[k] });
        h.mesh.castShadow = true;
        d.scene.add(h.group);
        const y = d.city.groundAt(p.x, p.z, null, d.city.roadLift(p.x, p.z));
        h.group.position.set(p.x, y, p.z);
        h.group.rotation.y = hdg + (k % 3 === 0 ? Math.PI : 0) + (hash(k, 3) - 0.5) * 0.5;
        const speed = k % 5 === 4 ? 0 : 1.2 + hash(k, 4) * 0.35;
        h.phase = hash(k, 5) * Math.PI * 2;
        m.animateWalk(h, Math.min(0.8, speed * 0.2), 0, speed);
        window.__crowd.push(h);
        h.__at = { k, x: p.x, z: p.z, y };
      }
      return JSON.stringify({ A: { x: A.x, z: A.z }, ux, uz, hw: e.hw, cls: e.cls });
    })()`, true));
    console.log(`  street: ${site.cls}, hw ${site.hw.toFixed(1)} m, at (${site.A.x | 0}, ${site.A.z | 0})`);

    // name, camera (along, off, eye), look (along, off, height)
    const VIEWS = [
      // along the pavement from its building side, looking diagonally across
      // the cast so people do not stand behind each other
      // (at along 0 the camera stood on the junction corner, in the road)
      ['street', [4, site.hw + 3.0, 1.7], [22, site.hw + 0.6, 1.0]],
      // from the kerb of the road, across the pavement at the frontage
      ['shopfront', [16.5, site.hw - 3.0, 1.6], [16.5, site.hw + 4.5, 1.1]],
    ];
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    for (const [name, cam, look] of VIEWS) {
      await evaluate(`(() => {
        const d = window.__dbg, s = ${JSON.stringify(site)};
        const at = (a, off) => ({ x: s.A.x + s.ux * a - s.uz * off, z: s.A.z + s.uz * a + s.ux * off });
        const c = at(${cam[0]}, ${cam[1]}), l = at(${look[0]}, ${look[1]});
        // Settle the streamer (beauty.mjs: a paused game never finishes a chunk).
        const pending = () => [...d.world.chunks.values()].filter((q) => q.lod !== q.wantLod).length;
        for (let i = 0; i < 2000 && (i === 0 || pending() > 0); i++) d.world.update(c.x, c.z, 60);
        const gy = (x, z) => d.city.groundAt(x, z, null, d.city.roadLift(x, z));
        d.camera.position.set(c.x, gy(c.x, c.z) + ${cam[2]}, c.z);
        d.camera.lookAt(l.x, gy(l.x, l.z) + ${look[2]}, l.z);
        d.camera.updateMatrixWorld(true);
        // Sun across the view at main.js's elevation, as beauty.mjs does.
        const bear = Math.atan2(l.x - c.x, l.z - c.z), SUN_AZ = bear + 1.75, sr = Math.hypot(215, 150);
        const ax = c.x + (l.x - c.x) * 0.5, az = c.z + (l.z - c.z) * 0.5, ay = gy(ax, az);
        d.sun.position.set(ax - Math.sin(SUN_AZ) * sr, ay + 200, az - Math.cos(SUN_AZ) * sr);
        d.sun.target.position.set(ax, ay, az);
        d.sun.target.updateMatrixWorld();
        const pm = document.getElementById('pauseMenu'); if (pm) pm.style.display = 'none';
        d.scene.updateMatrixWorld(true);
      })()`);
      await sleep(9000);
      await evaluate(`(() => { const pm = document.getElementById('pauseMenu'); if (pm) pm.style.display = 'none'; })()`);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(result.data, 'base64'));
      console.log(`  ${OUT}/${name}.png`);
      // CROWD_PROBE=1: for each person, where they are on screen, the height
      // they were placed at, and what is DRAWN under them (a ray straight
      // down through the settled chunk meshes) -- a sunk figure is a
      // disagreement between the ground query and the geometry.
      if (process.env.CROWD_PROBE) {
        console.log(await evaluate(`(() => {
          const d = window.__dbg, T = d.THREE, rc = new T.Raycaster();
          const meshes = [];
          d.scene.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh && o.visible) meshes.push(o); });
          return window.__crowd.map((h) => {
            const a = h.__at, s = new T.Vector3(a.x, a.y + 1, a.z).project(d.camera);
            const px = ((s.x + 1) / 2 * innerWidth) | 0, py = ((1 - s.y) / 2 * innerHeight) | 0;
            rc.set(new T.Vector3(a.x, a.y + 30, a.z), new T.Vector3(0, -1, 0));
            const hits = rc.intersectObjects(meshes, false).slice(0, 4)
              .map((q) => (q.object.name || q.object.material?.name || q.object.type) + '@' + q.point.y.toFixed(2)).join(' ');
            return 'k' + a.k + ' screen(' + px + ',' + py + ') at(' + a.x.toFixed(1) + ',' + a.z.toFixed(1) + ') placed y ' + a.y.toFixed(2)
              + ' terrain ' + d.G.terrainHeight(a.x, a.z).toFixed(2) + ' lift ' + d.city.roadLift(a.x, a.z).toFixed(2)
              + ' | drawn: ' + hits;
          }).join('\\n');
        })()`));
      }
    }
    const stats = await evaluate('({calls: __dbg.sceneStats.calls, tris: __dbg.sceneStats.tris})');
    console.log(`  scene: ${stats.calls} draws, ${stats.tris} triangles`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('crowdshots failed:', e.message); process.exitCode = 1; });
