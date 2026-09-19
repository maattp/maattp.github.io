// Space Needle views, for judging the landmark model at every distance the
// player sees it from.
//
//   AUTO_HTTP_PORT=8017 AUTO_CDP_PORT=9371 node tools/needleshots.mjs <outdir>
//
// Same boot recipe as beauty.mjs (service worker bypassed, __noAutoQuality,
// streamer settled, HUD hidden, the sun placed ACROSS the view at the game's
// 38 deg elevation), with the views framed from the landmark's own position so
// two checkouts photograph the same thing. It also prints what the Needle
// costs: draw calls and triangles of every mesh named 'spaceNeedle', plus the
// whole landmark group, so a before/after on an older build still has a number.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9371;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2] || 'tools/data/needle/now';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;

// Each view: camera and look-at relative to the Needle's base (nx, ny, nz), or
// resolved by a picker. eye/look heights are metres above the local ground,
// except `ly`, which is metres above the Needle's base.
const VIEWS = [
  // On the plaza 60 m out: the feet, the pavilion and the SkyLine.
  { name: 'plaza', dist: 60, bear: 0.8, eye: 1.7, ly: 22 },
  // Standing on the plaza 85 m out, looking up the legs at the top house.
  { name: 'base', dist: 85, bear: 0.8, eye: 1.7, ly: 80 },
  // Nearly underneath, looking up: the halo, the sunburst and the leg forks.
  { name: 'under', dist: 34, bear: 0.4, eye: 1.7, ly: 150 },
  // From a car on a street ~500 m away that points at it.
  { name: 'street', pick: 'street', eye: 1.4, ly: 95 },
  // The top house at mid-distance, level with the observation deck.
  { name: 'tophouse', dist: 150, bear: 3.6, eye: 0, ey: 150, ly: 152 },
  // Kerry Park at the game's field of view, and at a postcard's.
  { name: 'kerry', pick: 'kerry', eye: 1.7, ly: 60 },
  { name: 'kerrytele', pick: 'kerry', eye: 1.7, ly: 95, fov: 16 },
  // An aerial, the way the plane sees it.
  { name: 'aerial', dist: 420, bear: 1.2, eye: 0, ey: 300, ly: 90 },
  // 4 km out toward Beacon Hill, 80 m up (the ridge's height over the
  // Needle's plaza), at a telephoto: the skyline read.
  { name: 'far', pick: 'far', eye: 80, ly: 110, fov: 20 },
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', '--no-first-run',
    `--user-data-dir=/tmp/auto-needle-profile-${PORT}`, 'about:blank',
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
    let id = 0; const pend = new Map(); const errs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception');
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
    await sleep(3000);
    await evaluate(`(() => {
      const d = window.__dbg;
      d.applyQuality('high', true);
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
    })()`);

    // Cost of the Needle, and of the whole landmark group.
    const cost = await evaluate(`(() => {
      const d = window.__dbg;
      const lm = d.scene.children.find((o) => o.name === 'landmarks');
      const tri = (m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      let all = { draws: 0, tris: 0 }, needle = { draws: 0, tris: 0, mats: [] };
      d.scene.traverse((o) => {
        if (!o.isMesh) return;
        let p = o, inLm = false;
        while (p) { if (p === lm) inLm = true; p = p.parent; }
        if (inLm) { all.draws++; all.tris += tri(o); }
        if (o.name === 'spaceNeedle') {
          needle.draws++; needle.tris += tri(o);
          needle.mats.push(o.material.type + ':' + (o.material.name || '') + ':' + tri(o));
        }
      });
      return JSON.stringify({ all, needle });
    })()`);
    console.log('  cost: ' + cost);

    mkdirSync(OUT, { recursive: true });
    const picks = JSON.parse(await evaluate(`(() => {
      const d = window.__dbg, city = d.city, G = d.G;
      const L = G.LANDMARKS.find((l) => l.kind === 'spaceNeedle');
      const nx = L.x, nz = L.z, ny = G.terrainHeight(nx, nz);
      const out = { needle: { x: nx, y: ny, z: nz } };
      // A surface street 420-620 m out whose direction points at the Needle,
      // camera on its centreline at the far end.
      let best = null;
      for (const e of city.edges) {
        if (e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp') continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        if (!a || !b) continue;
        for (const [p, q] of [[a, b], [b, a]]) {
          const dist = Math.hypot(p.x - nx, p.z - nz);
          if (dist < 420 || dist > 620) continue;
          const ux = (q.x - p.x), uz = (q.z - p.z), ul = Math.hypot(ux, uz);
          const align = (ux * (nx - p.x) + uz * (nz - p.z)) / (ul * dist);
          if (align < 0.95 || ul < 25) continue;
          const score = align + ul / 2000;
          if (!best || score > best.score) best = { score, cx: p.x, cz: p.z, dist, cls: e.cls };
        }
      }
      out.street = best || { cx: nx + 500, cz: nz };
      const K = G.LANDMARKS.find((l) => l.kind === 'kerry');
      // Kerry Park's viewpoint is the south edge of the park, looking SE.
      out.kerry = { cx: K.x + 8, cz: K.z + 10 };
      const B = G.PLACES.find((p) => p.n === 'Beacon Hill');
      const bl = Math.hypot(B.x - nx, B.z - nz);
      out.far = { cx: nx + (B.x - nx) / bl * 4000, cz: nz + (B.z - nz) / bl * 4000 };
      return JSON.stringify(out);
    })()`));
    const N = picks.needle;
    console.log(`  needle at (${N.x.toFixed(1)}, ${N.y.toFixed(1)}, ${N.z.toFixed(1)})  street cam ${JSON.stringify(picks.street)}`);

    for (const V of VIEWS) {
      if (ONLY && !ONLY.includes(V.name)) continue;
      let cx, cz;
      if (V.pick) { cx = picks[V.pick].cx; cz = picks[V.pick].cz; }
      else { cx = N.x - Math.sin(V.bear) * V.dist; cz = N.z - Math.cos(V.bear) * V.dist; }
      const res = await evaluate(`(() => {
        const d = window.__dbg;
        const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
        d.world.update(${cx}, ${cz}, 60);
        for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(${cx}, ${cz}, 60);
        const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
        const cy = ${V.ey !== undefined ? `${N.y} + ${V.ey}` : `gy(${cx}, ${cz}) + ${V.eye}`};
        const lx = ${N.x}, lz = ${N.z}, ly = ${N.y} + ${V.ly};
        d.camera.fov = ${V.fov || 62};
        d.camera.updateProjectionMatrix();
        d.camera.position.set(${cx}, cy, ${cz});
        d.camera.lookAt(lx, ly, lz);
        d.camera.updateMatrixWorld(true);
        // Sun: the game's elevation and distance, rotated 100 deg off the view
        // bearing like beauty.mjs, anchored on the Needle so its own shadows
        // (and the shadow it throws) are inside the box.
        const bear = Math.atan2(lx - ${cx}, lz - ${cz});
        const SUN_AZ = bear + 1.75, sr = Math.hypot(215, 150);
        d.sun.position.set(lx - Math.sin(SUN_AZ) * sr, ${N.y} + 200, lz - Math.cos(SUN_AZ) * sr);
        d.sun.target.position.set(lx, ${N.y}, lz);
        d.sun.target.updateMatrixWorld();
        const dir = new d.THREE.Vector3(lx - ${cx}, 0, lz - ${cz}).normalize();
        d.traffic.updateParked(${cx}, ${cz});
        for (let i = 0; i < 16; i++) d.traffic.spawnTraffic(${cx}, ${cz}, dir);
        if (d.peds && d.peds.spawn) for (let i = 0; i < 24; i++) d.peds.spawn(${cx}, ${cz});
        for (let i = 0; i < 4; i++) {
          d.traffic.update(0.016, ${cx}, ${cz}, dir, d.player);
          d.peds.update(0.016, ${cx}, ${cz}, d.player, d.traffic);
        }
        return JSON.stringify({ cy, dist: Math.hypot(lx - ${cx}, lz - ${cz}) });
      })()`);
      await sleep(9000);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${V.name}.png`, Buffer.from(result.data, 'base64'));
      const r = JSON.parse(res);
      console.log(`  ${OUT}/${V.name}.png  camera ${r.dist.toFixed(0)} m out, y ${r.cy.toFixed(1)}`);
    }
    const stats = await evaluate('({calls: __dbg.sceneStats.calls, tris: __dbg.sceneStats.tris})');
    console.log(`  last frame: ${stats.calls} draws, ${stats.tris} triangles`);
    console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('needleshots failed:', e.message); process.exitCode = 1; });
