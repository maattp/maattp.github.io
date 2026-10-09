// Landmark views and landmark cost, for judging landmarks.js before and after.
//
//   AUTO_HTTP_PORT=8021 AUTO_CDP_PORT=9401 node tools/landmarkshots.mjs <outdir> [view,view...]
//   ... node tools/landmarkshots.mjs --cost          per-landmark draws / triangles only
//
// Same boot recipe as needleshots.mjs (service worker bypassed, __noAutoQuality,
// streamer settled, HUD hidden, the sun placed across the view at the game's
// elevation). Views are framed in WORLD coordinates -- a target point and a
// camera point -- not from the landmark's origin or its model, so two checkouts
// with different models photograph exactly the same thing.
//
// The cost is measured per landmark by building each one ALONE: G.LANDMARKS is
// swapped for a one-element list and buildLandmarks runs into a throwaway scene
// (no city, so nothing is registered), then the merged meshes are counted. That
// works on any build, which is what makes a before/after number possible when
// the real scene holds every landmark merged into shared meshes.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9401;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const COST_ONLY = process.argv.includes('--cost');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = args[0] || 'tools/data/landmarks/now';
const ONLY = args[1] ? args[1].split(',') : null;

// t: look-at point [x, z] and height above ITS ground; c: camera [x, z] and
// height above ITS ground (or `cy` absolute over the target's ground). fov
// defaults to the game's 62.
const VIEWS = [
  { name: 'market-close', t: [-212, 312, 10], c: [-160, 278, 1.7] },
  { name: 'market-mid', t: [-225, 300, 8], c: [-80, 229, 1.7], fov: 40 },
  { name: 'market-aerial', t: [-215, 300, 4], c: [-70, 190, 0], cy: 110 },
  { name: 'wheel-close', t: [-346, 575, 30], c: [-262, 548, 1.7] },
  { name: 'wheel-mid', t: [-346, 575, 30], c: [-560, 470, 0], cy: 25 },
  // the waterfront's walkable decks (Wheel, Aquarium, Pier 66) and the shore
  { name: 'waterfront-aerial', t: [-400, 480, 0], c: [-230, 520, 0], cy: 130 },
  { name: 'pier66-aerial', t: [-788, 92, 0], c: [-640, 160, 0], cy: 110 },
  // neighbourhoods: is the city's building stock varied? (houses, low-rise)
  { name: 'hood-wallingford-street', t: [300, -5300, 4], c: [230, -5330, 1.7] },
  { name: 'hood-wallingford-air', t: [267, -5350, 0], c: [100, -5150, 0], cy: 120 },
  { name: 'hood-ballard-air', t: [-3633, -7245, 0], c: [-3450, -7050, 0], cy: 110 },
  { name: 'hood-ballard-street', t: [-3600, -7245, 5], c: [-3680, -7270, 1.7] },
  { name: 'hood-queenanne-air', t: [-1717, -3128, 0], c: [-1500, -2950, 0], cy: 150 },
  { name: 'hood-capitol-street', t: [1470, -1330, 6], c: [1440, -1420, 1.7] },
  { name: 'hood-capitol-air', t: [1468, -1388, 0], c: [1650, -1200, 0], cy: 140 },
  { name: 'hood-columbia-air', t: [3961, 5940, 0], c: [4150, 6150, 0], cy: 120 },
  { name: 'hood-beacon-fly', t: [2100, 3200, 0], c: [2100, 4300, 0], cy: 260 },
  // Bellevue Downtown Park: the lawn in its ring canal, the reflecting pond SW
  { name: 'bdp-air', t: [10051, -129, 0], c: [10200, 60, 0], cy: 130 },
  { name: 'bdp-top', t: [10051, -129, 0], c: [10052, -128, 0], cy: 330, fov: 60 },
  { name: 'bdp-lawn', t: [10000, -80, 1], c: [10090, -170, 1.7] },
  { name: 'bdp-fall', t: [10022, -68, 1], c: [9982, -50, 2.5] },
  { name: 'bdp-canal', t: [10051, -30, 0.5], c: [10130, -60, 1.7] },
  // marinas (landmarks.js MARINAS): from the bank, looking out along the pier
  { name: 'marina-shilshole', t: [-5075, -7721, 1], c: [-5030, -7681, 0], cy: 9 },
  { name: 'marina-renton', t: [9037, 12320, 1], c: [9060, 12390, 0], cy: 12 },
  { name: 'marina-leschi', t: [3960, 1205, 1], c: [3915, 1220, 0], cy: 7 },
  { name: 'marina-seaplanes', t: [770, -2242, 1], c: [815, -2230, 0], cy: 8 },
  { name: 'marina-kirkland', t: [9681, -7115, 0.5], c: [9670, -7175, 0], cy: 6 },
  // a Tech Tour badge (activities.js TECH), from down the street
  { name: 'tech-starbucks', t: [90, 3419, 6], c: [60, 3470, 1.7] },
  { name: 'wheel-walk', t: [-330, 575, 2], c: [-292, 590, 1.7] },
  { name: 'pier66-walk', t: [-770, 60, 2], c: [-738, 40, 1.7] },
  { name: 'arena-close', t: [-1214, -1197, 18], c: [-1318, -1066, 1.7] },
  { name: 'arena-mid', t: [-1214, -1197, 10], c: [-1480, -1420, 0], cy: 160 },
  { name: 'mopop-close', t: [-778, -1127, 14], c: [-726, -1190, 1.7] },
  { name: 'mopop-mid', t: [-778, -1127, 10], c: [-620, -1320, 0], cy: 120 },
  { name: 'spheres-close', t: [-118, -479, 14], c: [-60, -420, 1.7] },
  { name: 'spheres-mid', t: [-118, -479, 10], c: [-230, -600, 0], cy: 150 },
  { name: 'lumen-close', t: [482, 1812, 22], c: [470, 1600, 1.7] },
  { name: 'lumen-mid', t: [482, 1812, 10], c: [330, 1330, 0], cy: 220 },
  { name: 'tmobile-close', t: [354, 2225, 30], c: [230, 2080, 1.7] },
  { name: 'tmobile-mid', t: [380, 2225, 10], c: [120, 2600, 0], cy: 230 },
  { name: 'smith-close', t: [463, 1035, 60], c: [400, 1085, 1.7] },
  { name: 'smith-mid', t: [463, 1035, 75], c: [276, 1068, 1.7], fov: 50 },
  { name: 'husky-mid', t: [2705, -4349, 10], c: [3050, -4600, 0], cy: 180 },
  { name: 'needle-base', t: [-857.5, -1019, 20], c: [-900, -1075, 1.7] },
  { name: 'gasworks-mid', t: [237, -3817, 8], c: [330, -3700, 0], cy: 40 },
  // the downtown landmarks rebuilt from their OSM plans (WO-10): air + street
  { name: 'conv-air', t: [503, -21, 0], c: [420, 100, 0], cy: 110 },
  { name: 'conv-top', t: [470, -50, 0], c: [470, -49, 0], cy: 330, fov: 50 },
  { name: 'conv-west', t: [480, -30, 20], c: [350, 20, 0], cy: 110 },
  { name: 'conv-east', t: [490, -40, 10], c: [640, 40, 0], cy: 70 },
  { name: 'conv-close', t: [503, -21, 10], c: [420, 40, 1.7] },
  { name: 'conv-nw', t: [440, -70, 14], c: [330, -190, 0], cy: 75 },
  { name: 'lib-air', t: [390, 518, 0], c: [300, 640, 0], cy: 120 },
  { name: 'lib-close', t: [395, 515, 24], c: [333, 548, 1.7] },
  { name: 'lib-east', t: [390, 518, 25], c: [490, 450, 1.7] },
  { name: 'lib-north', t: [390, 518, 25], c: [420, 440, 1.7] },
  { name: 'lib-mid', t: [390, 518, 28], c: [250, 650, 40], cy: 40 },
  { name: 'aq-air', t: [-415, 398, 0], c: [-300, 330, 0], cy: 90 },
  { name: 'aq-close', t: [-415, 398, 6], c: [-330, 440, 1.7] },
  { name: 'aq-sea', t: [-390, 385, 4], c: [-480, 420, 5] },
  { name: 'aq-north', t: [-380, 370, 4], c: [-300, 300, 1.7] },
  { name: 'ferry-air', t: [10, 962, 0], c: [-120, 900, 0], cy: 100 },
  { name: 'ferry-close', t: [10, 962, 8], c: [-60, 1030, 1.7] },
  { name: 'ferry-top', t: [-20, 955, 0], c: [-20, 956, 0], cy: 170, fov: 50 },
  { name: 'ferry-east', t: [-5, 955, 6], c: [80, 930, 1.7] },
  { name: 'kerry-air', t: [-1656, -2008, 0], c: [-1600, -1950, 0], cy: 40 },
  { name: 'kerry-street', t: [-1656, -2006, 1.5], c: [-1672, -2036, 1.7] },
  { name: 'kerry-south', t: [-1656, -2006, 1.5], c: [-1640, -1965, 1.7] },
  // from the park's centre at eye height, over the parapet: skyline + Needle
  { name: 'kerry-view', t: [-857, -1019, 60], c: [-1656, -2009, 1.7], fov: 50 },
  { name: 'locks-air', t: [-4417, -6105, 0], c: [-4300, -6000, 0], cy: 120 },
  { name: 'locks-close', t: [-4417, -6040, 4], c: [-4400, -6120, 1.7] },
  { name: 'locks-walk', t: [-4320, -6048, 3], c: [-4460, -6050, 1.7] },
  { name: 'locks-gate', t: [-4410, -6034, 2], c: [-4388, -6012, 1.7] },
  { name: 'locks-dam', t: [-4468, -6040, 3], c: [-4468, -5990, 1.7] },
  { name: 'locks-side', t: [-4417, -6040, 2], c: [-4417, -5900, 30], cy: 30 },
  // Terrain, not the highest deck: the Troll is under the Aurora Bridge.
  { name: 'troll-close', t: [-700, -4414, 3], c: [-694, -4396, 1.7], terrain: true },
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', '--no-first-run',
    `--user-data-dir=/tmp/auto-landmarks-profile-${PORT}`, 'about:blank',
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
    await sleep(3000);
    await evaluate(`(() => {
      const d = window.__dbg;
      d.applyQuality('high', true);
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
    })()`);

    // --- one-off diagnostic: LM_PROBE='<expr>' prints its value and exits --
    const PROBE = process.env.LM_PROBE || (process.env.LM_PROBE_FILE && readFileSync(process.env.LM_PROBE_FILE, 'utf8'));
    if (PROBE) {
      const v = await evaluate(PROBE, true);
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
      console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
      return;
    }

    // --- Kerry Park: --kerry stands at the park's centre at eye height (1.7 m
    // over what groundAt answers, the terrace if there is one) and casts rays at
    // the Needle (base to top) and along a fan of the skyline. A ray is clear if
    // nothing is hit before its target (or, for the fan, within 400 m); the eye
    // must also not be inside anything (six short rays out of it).
    if (process.argv.includes('--kerry')) {
      const r = await evaluate(`(() => {
        const d = window.__dbg, c = d.city, G = d.G, T = d.THREE;
        const L = G.LANDMARKS.find((l) => l.kind === 'kerry');
        const pending = () => [...d.world.chunks.values()].filter((k) => k.lod !== k.wantLod).length;
        d.world.update(L.x, L.z, 60);
        for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(L.x, L.z, 60);
        const needle = G.LANDMARKS.find((l) => l.kind === 'spaceNeedle');
        const ground = c.groundAt(L.x, L.z, null);
        const eye = new T.Vector3(L.x, ground + 1.7, L.z);
        d.scene.updateMatrixWorld(true);
        const rc = new T.Raycaster(); rc.camera = d.camera;
        const what = (h) => (h.object.name || h.object.parent?.name || h.object.type) + ' @' + h.distance.toFixed(1) + ' m y ' + h.point.y.toFixed(1);
        const cast = (dir, far) => {
          rc.set(eye, dir.clone().normalize()); rc.near = 0.05; rc.far = far;
          const hit = rc.intersectObject(d.scene, true).find((h) => !h.object.isSprite && !h.object.isLine && !h.object.isPoints && h.object.visible && h.object.material && !h.object.material.transparent);
          return hit ? what(hit) : null;
        };
        const out = { terrain: +G.terrainHeight(L.x, L.z).toFixed(1), ground: +ground.toFixed(1), eye: +eye.y.toFixed(1), needle: [], fan: [], inside: [] };
        const ny0 = G.terrainHeight(needle.x, needle.z);
        for (const h of [5, 40, 100, 150, 184]) {
          const t = new T.Vector3(needle.x, ny0 + h, needle.z), dist = t.distanceTo(eye);
          out.needle.push({ h, dist: +dist.toFixed(0), hit: cast(t.clone().sub(eye), dist - 8) });
        }
        const bear = Math.atan2(needle.x - L.x, needle.z - L.z);
        for (let a = -30; a <= 30; a += 6) {
          const az = bear + a * Math.PI / 180;
          out.fan.push({ a, hit: cast(new T.Vector3(Math.sin(az), 0, Math.cos(az)), 400) });
        }
        for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
          const h = cast(new T.Vector3(x, y, z), 0.35);
          if (h) out.inside.push(h);
        }
        // (a ray that ends on the Needle's own mesh reached it; the base is hidden by buildings 300 m out, as it should be)
        const ok = (hit) => !hit || hit.startsWith('spaceNeedle');
        const clear = out.needle.filter((n) => ok(n.hit)).length, fanClear = out.fan.filter((f) => !f.hit).length;
        const top = out.needle[out.needle.length - 1];
        out.verdict = { needleClear: clear + '/' + out.needle.length, needleTopClear: ok(top.hit), fanClear: fanClear + '/' + out.fan.length, eyeInsideSomething: out.inside.length > 0 };
        // the other stations on the terrace (centre-line, near the parapet, either end), and what the parapet
        // stands against the eye: the top of whatever is 7.8 m south of the centre, straight down
        out.stations = [];
        for (const [dx, dz] of [[-22, -9], [22, -9], [-22, 5], [22, 5], [0, 6.5]]) {
          const g = c.groundAt(L.x + dx, L.z + dz, null), e = new T.Vector3(L.x + dx, g + 1.7, L.z + dz);
          const row = [];
          for (const h of [100, 184]) {
            const t = new T.Vector3(needle.x, ny0 + h, needle.z);
            rc.set(e, t.clone().sub(e).normalize()); rc.near = 0.05; rc.far = e.distanceTo(t) - 8;
            const hit = rc.intersectObject(d.scene, true).find((q) => !q.object.isSprite && !q.object.isLine && !q.object.isPoints && q.object.visible && q.object.material && !q.object.material.transparent);
            row.push(!hit || (hit.object.name || '').startsWith('spaceNeedle') ? 'clear' : what(hit));
          }
          out.stations.push({ at: [dx, dz], eye: +e.y.toFixed(1), needle: row });
        }
        rc.set(new T.Vector3(L.x, eye.y + 20, L.z + 7.8), new T.Vector3(0, -1, 0)); rc.near = 0.05; rc.far = 60;
        const pt = rc.intersectObject(d.scene, true).find((q) => q.object.visible && q.object.material && !q.object.material.transparent && !q.object.isSprite);
        out.parapetTop = pt ? +pt.point.y.toFixed(2) : null;
        out.eyeAboveParapet = pt ? +(eye.y - pt.point.y).toFixed(2) : null;
        out.pass = ok(top.hit) && clear >= 3 && fanClear >= 9 && !out.inside.length && out.stations.every((q) => q.needle[1] === 'clear');
        return JSON.stringify(out, null, 1);
      })()`);
      console.log(r);
      console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
      return;
    }

    // --- collision: --collide drives and walks into landmark solids --------
    // Fixed dt (1/60) through player.update, the path a player's input takes,
    // so the stop measured is the one a player gets.
    if (process.argv.includes('--collide')) {
      const r = await evaluate(`(() => {
        const d = window.__dbg, p = d.player, c = d.city, G = d.G;
        const out = { solids: (c.landmarkSolids || []).length };
        const settle = (x, z) => {
          const pending = () => [...d.world.chunks.values()].filter((k) => k.lod !== k.wantLod).length;
          d.world.update(x, z, 60);
          for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(x, z, 60);
        };
        const look = { x: 0, y: 0 }, ctl = { takeTap: () => null };
        const drive = (name, x0, z0, h, tx, tz, frames = 360) => {
          settle(x0, z0);
          if (!p.onFoot) p.exitVehicle();
          const car = d.traffic.spawnAt(x0, z0, h, 'sedan', 0x3366aa, 'free');
          p.enterVehicle(car);
          car.x = x0; car.z = z0; car.heading = h; car.y = c.groundAt(x0, z0, null);
          car.vLong = 0; car.vLat = 0; car.vy = 0;
          const input = { x: 0, y: 0, gas: true, gasAmt: 1, brake: false, brakeAmt: 0, hand: false, attack: false };
          const fx = Math.sin(h), fz = Math.cos(h);
          let minD = 1e9, vmax = 0, vAtHit = null, hitAt = null;
          for (let f = 0; f < frames; f++) {
            const before = Math.abs(car.vLong);
            p.update(1 / 60, input, look, ctl, d.traffic, d.peds);
            const v = p.vehicle || car;
            const dd = Math.hypot(v.x - tx, v.z - tz);
            minD = Math.min(minD, dd);
            vmax = Math.max(vmax, Math.abs(v.vLong));
            if (hitAt === null && Math.abs(v.vLong) < before - 2) {
              hitAt = f; vAtHit = before;
              const rr = v.radius * 0.7;
              var what = c.landmarkHit(v.x, v.z, rr + 0.3, v.y) ? 'landmark solid' : c.obstacleHit(v.x, v.z, rr + 0.3, v.y) ? 'street obstacle' : 'building/other';
            }
          }
          const v = p.vehicle || car;
          const along = (v.x - tx) * fx + (v.z - tz) * fz;
          out[name] = { hit: typeof what === 'undefined' ? null : what, impactKmh: vAtHit === null ? null : +(vAtHit * 3.6).toFixed(0), hitFrame: hitAt,
            minDist: +minD.toFixed(2), finalAlong: +along.toFixed(2), passedThrough: along > 0, speedAfter: +Math.abs(v.vLong).toFixed(2) };
          p.exitVehicle();
          d.traffic.remove && d.traffic.remove(car);
        };
        const walk = (name, x0, z0, h, tx, tz, frames = 600) => {
          settle(x0, z0);
          if (!p.onFoot) p.exitVehicle();
          p.x = x0; p.z = z0; p.y = c.groundAt(x0, z0, null); p.heading = h; p.speed = 0;
          p.camYaw = h - Math.PI;
          const input = { x: 0, y: -1, sprint: false, gas: false, brake: false, hand: false, attack: false };
          let minD = 1e9;
          for (let f = 0; f < frames; f++) {
            p.camYaw = h - Math.PI;
            p.update(1 / 60, input, look, ctl, d.traffic, d.peds);
            minD = Math.min(minD, Math.hypot(p.x - tx, p.z - tz));
          }
          out[name] = { minDist: +minD.toFixed(2), end: [+p.x.toFixed(1), +p.z.toFixed(1)] };
        };
        const L = (k) => G.LANDMARKS.find((l) => l.kind === k);
        // Needle: a leg foot, the nearest solid box to its base.
        const N = L('spaceNeedle');
        const legs = c.landmarkSolids.filter((s) => s.hw === 1.8 && Math.hypot(s.x - N.x, s.z - N.z) < 20);
        out.needleLegs = legs.length;
        const leg = legs[0];
        const ra = Math.atan2(leg.x - N.x, leg.z - N.z);            // heading from centre to the leg
        drive('carIntoNeedleLeg', leg.x + Math.sin(ra) * 40, leg.z + Math.cos(ra) * 40, ra + Math.PI, leg.x, leg.z);
        // Walk in between two leg pairs to the core: must get under the tower.
        const between = ra + Math.PI / 3;
        walk('walkUnderNeedle', N.x + Math.sin(between) * 45, N.z + Math.cos(between) * 45, between + Math.PI, N.x, N.z);
        walk('walkIntoNeedleLeg', leg.x + Math.sin(ra) * 20, leg.z + Math.cos(ra) * 20, ra + Math.PI, leg.x, leg.z);
        // Stadium: T-Mobile's south wall, driven into from Edgar Martinez Dr.
        const T = L('stadiumB');
        drive('carIntoTMobileSouthWall', T.x + 40, T.z + 140, Math.PI, T.x + 40, T.z + 97);
        // Lumen's east wall, from the east.
        const F = L('stadiumF');
        drive('carIntoLumenEastWall', F.x + 170, F.z + 20, -Math.PI / 2, F.x + 100, F.z + 20);
        // Arena, from the west lawn.
        const A = L('arena');
        drive('carIntoArenaWest', A.x - 90, A.z - 28, Math.PI / 2, A.x - 50.5, A.z - 28);
        // The downtown landmarks rebuilt from OSM plans (lmdowntown.js): a car into
        // each one's wall from the street, in the landmark's own frame
        // (rot t: local x -> (cos t, -sin t), local z -> (sin t, cos t)).
        const loc = (l, t, lx, lz) => [l.x + lx * Math.cos(t) + lz * Math.sin(t), l.z - lx * Math.sin(t) + lz * Math.cos(t)];
        const into = (name, kind, t, from, to, how = 'drive') => {
          const l = L(kind), a = loc(l, t, from[0], from[1]), b = loc(l, t, to[0], to[1]);
          const h = Math.atan2(b[0] - a[0], b[1] - a[1]);
          (how === 'walk' ? walk : drive)(name, a[0], a[1], h, b[0], b[1], how === 'walk' ? 1500 : 360);
        };
        into('carIntoLibraryEast', 'library', -1.017, [62, 0], [30, 0]);
        into('carIntoConventionFront', 'convention', 0.558, [-7, -91], [-7, -60]);
        into('carIntoColmanTerminal', 'ferry', 0.553, [34, -20], [0, -20]);
        into('walkIntoAquariumSouth', 'aquarium', 0, [17, 40], [17, 24], 'walk');
        into('walkIntoKerryParapet', 'kerry', 0, [0, -8], [0, 9], 'walk');
        into('walkOntoLocksNorthWall', 'locks', 0, [-50, 20], [-50, 42], 'walk');
        // The Locks end to end on foot: bank, ramp, the small lock's north wall, its gate's footbridge, the centre
        // wall, the large lock's intermediate gate, the south wall, the dam to its south end. Waypoints in the
        // landmark's frame; reached is how many it got to.
        {
          const l = L('locks'), pts = [[-50, 14], [-50, 34], [-28.5, 34], [-28.5, 55], [8.5, 55], [8.5, 90], [-50.6, 90], [-50.6, 150]];
          settle(l.x - 50, l.z + 14);
          if (!p.onFoot) p.exitVehicle();
          p.x = l.x + pts[0][0]; p.z = l.z + pts[0][1]; p.y = c.groundAt(p.x, p.z, null); p.speed = 0;
          const input = { x: 0, y: -1, sprint: true, gas: false, brake: false, hand: false, attack: false };
          let k = 1, f = 0, minY = 1e9;
          for (; f < 6000 && k < pts.length; f++) {
            const tx = l.x + pts[k][0], tz = l.z + pts[k][1];
            const h = Math.atan2(tx - p.x, tz - p.z);
            p.heading = h; p.camYaw = h - Math.PI;
            p.update(1 / 60, input, look, ctl, d.traffic, d.peds);
            minY = Math.min(minY, p.y);
            if (Math.hypot(p.x - tx, p.z - tz) < 1.6) k++;
          }
          out.walkTheLocks = { reached: k - 1, of: pts.length - 1, frames: f, end: [+(p.x - l.x).toFixed(1), +(p.z - l.z).toFixed(1)], lowestY: +minY.toFixed(1), deckY: +(c.groundAt(l.x, l.z + 55, null)).toFixed(1) };
        }
        out.dropped = d.scene.children.find((o) => o.name === 'landmarks').userData.solidsDropped;
        return JSON.stringify(out, null, 1);
      })()`);
      console.log(r);
      console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
      return;
    }

    // --- per-landmark cost -------------------------------------------------
    const cost = await evaluate(`(async () => {
      const d = window.__dbg, G = d.G;
      const mod = await import('./src/landmarks.js');
      const saved = G.LANDMARKS.slice();
      const count = (list) => {
        G.LANDMARKS.length = 0; G.LANDMARKS.push(...list);
        const sc = new d.THREE.Scene();
        mod.buildLandmarks(sc);
        let draws = 0, tris = 0;
        sc.traverse((o) => {
          if (!o.isMesh) return;
          draws++;
          tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
        });
        return { draws, tris };
      };
      const out = {};
      try {
        const empty = count([]);
        out._fixtures = empty;
        for (const l of saved) {
          const c = count([l]);
          out[l.kind] = { draws: c.draws - empty.draws, tris: c.tris - empty.tris };
        }
        out._all = count(saved);
      } finally {
        G.LANDMARKS.length = 0; G.LANDMARKS.push(...saved);
      }
      return JSON.stringify(out);
    })()`, true);
    const C = JSON.parse(cost);
    console.log('--- landmark cost (each built alone; draws are after merge) ---');
    for (const [k, v] of Object.entries(C)) console.log(`  ${k.padEnd(16)} ${String(v.draws).padStart(4)} draws ${String(Math.round(v.tris)).padStart(8)} tris`);
    if (COST_ONLY) return;

    mkdirSync(OUT, { recursive: true });
    for (const V of VIEWS) {
      if (ONLY && !ONLY.some((o) => V.name.startsWith(o))) continue;
      const res = await evaluate(`(() => {
        const d = window.__dbg;
        const [tx, tz, th] = ${JSON.stringify(V.t)};
        let [cx, cz, ch] = ${JSON.stringify(V.c)};
        const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
        d.world.update(cx, cz, 60);
        for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(cx, cz, 60);
        const gy = ${V.terrain ? '(x, z) => d.G.terrainHeight(x, z)' : '(x, z) => Math.max(0, d.city.groundAt(x, z, null))'};
        const ty = gy(tx, tz);
        const cy = ${V.cy !== undefined ? `ty + ${V.cy}` : 'gy(cx, cz) + ch'};
        const ly = ty + th;
        d.camera.fov = ${V.fov || 62};
        d.camera.updateProjectionMatrix();
        d.camera.position.set(cx, cy, cz);
        d.camera.lookAt(tx, ly, tz);
        d.camera.updateMatrixWorld(true);
        const bear = Math.atan2(tx - cx, tz - cz);
        const SUN_AZ = bear + 1.75, sr = Math.hypot(215, 150);
        d.sun.position.set(tx - Math.sin(SUN_AZ) * sr, ty + 200, tz - Math.cos(SUN_AZ) * sr);
        d.sun.target.position.set(tx, ty, tz);
        d.sun.target.updateMatrixWorld();
        const dir = new d.THREE.Vector3(tx - cx, 0, tz - cz).normalize();
        d.traffic.updateParked(cx, cz);
        for (let i = 0; i < 12; i++) d.traffic.spawnTraffic(cx, cz, dir);
        if (d.peds && d.peds.spawn) for (let i = 0; i < 16; i++) d.peds.spawn(cx, cz);
        for (let i = 0; i < 4; i++) {
          d.traffic.update(0.016, cx, cz, dir, d.player);
          d.peds.update(0.016, cx, cz, d.player, d.traffic);
        }
        return JSON.stringify({ cy, dist: Math.hypot(tx - cx, tz - cz) });
      })()`);
      await sleep(8000);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${V.name}.png`, Buffer.from(result.data, 'base64'));
      const r = JSON.parse(res);
      console.log(`  ${OUT}/${V.name}.png  ${r.dist.toFixed(0)} m, eye y ${r.cy.toFixed(1)}`);
    }
    console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('landmarkshots failed:', e.message); process.exitCode = 1; });
