// Shots and numbers for the lot layer: car parks, plazas, yards.
//
//   AUTO_HTTP_PORT=8023 AUTO_CDP_PORT=9411 node tools/lotshots.mjs <outdir> [--probe]
//
// Fixed world targets (a real Belltown surface lot, SoDo, South Lake Union,
// Westlake Park, Occidental Square, U Village), posed identically on every run
// so a base checkout served on another port gives a true before/after. Street
// views stand on the pavement of the road edge nearest the lot, looking at it.
//
// --probe also prints the grass share: of all LAND in a region, the fraction
// whose ground renders as lawn -- not under a building, not road or pavement,
// and (on a build with the lot layer) not on a lot. Before the lot layer every
// such sample was lawn; that is the number this layer exists to move.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9411;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2] || 'tools/data/lotshots';
const PROBE = process.argv.includes('--probe');

// street: camera on the nearest pavement to (x,z), looking at it.
// orbit: camera `back` m from (x,z) on bearing `bear`, `eye` m up.
const VIEWS = [
  { name: 'lot-belltown', street: true, x: -795, z: -1261, eye: 1.7, look: 1.0 },
  { name: 'lot-pioneer', street: true, x: 730, z: 519, eye: 1.7, look: 1.0 },
  { name: 'sodo-street', street: true, x: 260, z: 3300, eye: 1.7, look: 1.5 },
  { name: 'lot-low', x: 485, z: 1566, eye: 45, look: 0, back: 90, bear: 0.9 },
  { name: 'westlake', x: 52, z: 60, eye: 4, look: 1.5, back: 45, bear: 2.4 },
  { name: 'occidental', x: 338, z: 1227, eye: 4, look: 1.5, back: 50, bear: 0.9 },
  { name: 'sodo-aerial', x: 218, z: 3484, eye: 260, look: 0, back: 520, bear: 0.9 },
  { name: 'slu-aerial', x: 67, z: -1518, eye: 220, look: 0, back: 450, bear: 0.9 },
  { name: 'uvillage', x: 2887, z: -5721, eye: 150, look: 0, back: 300, bear: 0.9 },
  { name: 'downtown-top', x: 305, z: -278, eye: 900, look: 0, back: 60, bear: 0.9 },
];

// Regions for the grass share. `r` is a disc radius about (x,z).
const REGIONS = [
  { name: 'downtown', x: 305, z: -278, r: 1200 },
  { name: 'belltown-slu', x: -300, z: -1400, r: 700 },
  { name: 'sodo', x: 218, z: 3484, r: 900 },
  { name: 'u-village', x: 2887, z: -5721, r: 400 },
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', '--no-first-run',
    `--user-data-dir=/tmp/auto-lots-profile-${PORT}`, 'about:blank',
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
    const errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
      }
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
    })()`);

    if (PROBE) {
      const res = await evaluate(`(() => {
        const d = window.__dbg, G = d.G, city = d.city, w = d.world;
        const hasLots = typeof G.inLot === 'function' && !!(G.lotCodes && G.lotCodes());
        const out = {};
        for (const R of ${JSON.stringify(REGIONS)}) {
          let land = 0, grass = 0, lot = 0, bld = 0, road = 0;
          const S = 5;
          for (let x = R.x - R.r; x <= R.x + R.r; x += S) {
            for (let z = R.z - R.r; z <= R.z + R.r; z += S) {
              if ((x - R.x) ** 2 + (z - R.z) ** 2 > R.r * R.r) continue;
              if (G.isWater(x, z)) continue;
              land++;
              if (w.inBuilding(x, z, 0)) { bld++; continue; }
              // Carriageway plus the pavement strip either side (~3 m).
              if (city.onRoad(x, z, 3, false)) { road++; continue; }
              if (hasLots && G.inLot(x, z)) { lot++; continue; }
              grass++;
            }
          }
          out[R.name] = { land, grassPct: +(100 * grass / land).toFixed(1),
            lotPct: +(100 * lot / land).toFixed(1), bldPct: +(100 * bld / land).toFixed(1),
            roadPct: +(100 * road / land).toFixed(1) };
        }
        return JSON.stringify({ hasLots, out });
      })()`);
      console.log('grass share: ' + res);
    }

    mkdirSync(OUT, { recursive: true });
    for (const V of VIEWS) {
      const info = await evaluate(`(() => {
        const d = window.__dbg, city = d.city;
        const V = ${JSON.stringify(V)};
        let cx, cz, lx = V.x, lz = V.z;
        if (V.street) {
          // Nearest at-grade street edge to the lot; stand on its pavement
          // on the lot's side, look at the lot.
          let best = null;
          for (const e of city.edges) {
            if (e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp') continue;
            const a = city.nodes[e.a], b = city.nodes[e.b];
            const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez;
            if (L2 < 1) continue;
            const t = Math.max(0.1, Math.min(0.9, ((V.x - a.x) * ex + (V.z - a.z) * ez) / L2));
            const px = a.x + ex * t, pz = a.z + ez * t;
            const dd = Math.hypot(px - V.x, pz - V.z);
            if (!best || dd < best.dd) best = { dd, px, pz, e };
          }
          const e = best.e;
          // pavement side facing the lot
          let nx = -e.dz, nz = e.dx;
          if ((V.x - best.px) * nx + (V.z - best.pz) * nz < 0) { nx = -nx; nz = -nz; }
          cx = best.px + nx * (e.hw + 2.0) - e.dx * 25;
          cz = best.pz + nz * (e.hw + 2.0) - e.dz * 25;
        } else {
          cx = V.x - Math.sin(V.bear) * V.back;
          cz = V.z - Math.cos(V.bear) * V.back;
          // A low view needs a clear sightline: walk the bearing round until
          // neither the camera nor the line to the target is inside a building.
          // Deterministic, so both builds pick the same pose.
          if (V.eye < 20) {
            const clear = (x0, z0) => {
              if (d.world.inBuilding(x0, z0, 2)) return false;
              const L = Math.hypot(V.x - x0, V.z - z0);
              for (let s = 3; s < L - 6; s += 3) {
                const t = s / L;
                if (d.world.inBuilding(x0 + (V.x - x0) * t, z0 + (V.z - z0) * t, 0.5)) return false;
              }
              return true;
            };
            let found = false;
            for (const k of [1, 0.7, 0.45]) {
              for (let i = 0; i < 18 && !found; i++) {
                const b = V.bear + i * 0.35;
                const x0 = V.x - Math.sin(b) * V.back * k, z0 = V.z - Math.cos(b) * V.back * k;
                if (clear(x0, z0)) { cx = x0; cz = z0; found = true; }
              }
              if (found) break;
            }
          }
        }
        const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
        d.world.update(cx, cz, 60);
        for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(cx, cz, 60);
        const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
        d.camera.position.set(cx, gy(cx, cz) + V.eye, cz);
        d.camera.lookAt(lx, gy(lx, lz) + V.look, lz);
        d.camera.updateMatrixWorld(true);
        const ax = cx + (lx - cx) * 0.25, az = cz + (lz - cz) * 0.25, ay = gy(ax, az);
        const bear = V.street ? Math.atan2(lx - cx, lz - cz) : V.bear;
        const SUN_AZ = bear + 1.75, sr = Math.hypot(215, 150);
        d.sun.position.set(ax - Math.sin(SUN_AZ) * sr, ay + 200, az - Math.cos(SUN_AZ) * sr);
        d.sun.target.position.set(ax, ay, az);
        d.sun.target.updateMatrixWorld();
        const dir = new d.THREE.Vector3(lx - cx, 0, lz - cz).normalize();
        d.traffic.updateParked(cx, cz);
        for (let i = 0; i < 26; i++) d.traffic.spawnTraffic(cx, cz, dir);
        if (d.peds && d.peds.spawn) for (let i = 0; i < 40; i++) d.peds.spawn(cx, cz);
        for (let i = 0; i < 4; i++) {
          d.traffic.update(0.016, cx, cz, dir, d.player);
          d.peds.update(0.016, cx, cz, d.player, d.traffic);
        }
        return JSON.stringify({ cx: cx | 0, cz: cz | 0 });
      })()`);
      await sleep(9000);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${V.name}.png`, Buffer.from(result.data, 'base64'));
      const st = await evaluate('JSON.stringify({calls: __dbg.sceneStats.calls, tris: __dbg.sceneStats.tris})');
      console.log(`  ${OUT}/${V.name}.png  cam ${info}  ${st}`);
    }
    console.log(`  errors: ${errors.length}${errors.length ? '\n    ' + errors.slice(0, 5).join('\n    ') : ''}`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('lotshots failed:', e.message); process.exitCode = 1; });
