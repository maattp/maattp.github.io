// Contact sheet of every vehicle, from fixed angles.
//
//   node tools/vehshots.mjs [tag] [type,type,...] [--street]
//
// `--street` leaves the city standing and parks a FIXED lineup of the traffic
// types along a real commercial street instead, framed from eye height and
// from a raised three-quarter. The plain stage judges a model; this judges it
// under the game's own lighting and next to its own roads, which is where a
// shape that looked fine on grey turns out to be a toy. Same types, colours
// and placement every run, so it works for a before/after against a master
// checkout (AUTO_HTTP_PORT) where random traffic would not.
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

const PORT = +process.env.AUTO_CDP_PORT || 9232;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const STREET = process.argv.includes('--street');
const TAG = ARGS[0] || 'now';
const OUT = `tools/data/vehicles/${TAG}`;

// name, azimuth (radians, 0 = looking at the nose), elevation factor.
const VIEWS = [
  ['front', 0.72, 0.30],
  ['rear', Math.PI - 0.62, 0.28],
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', STREET ? '--window-size=1280,720' : '--window-size=900,600', '--no-first-run',
    `--user-data-dir=/tmp/auto-vshot-profile-${PORT}`, 'about:blank',
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

    if (STREET) { await street(evaluate, send); return; }

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
    const all = await evaluate(`(() => {
      const d = window.__dbg;
      if (d.TYPES) return Object.keys(d.TYPES);
      return [...new Set(d.traffic.assets ? Object.keys(d.traffic.assets) : [])];
    })()`) || [];
    // Optional comma list of types, so iterating on one model is a minute
    // rather than a five-minute sweep of the whole fleet.
    const only = ARGS[1] ? ARGS[1].split(',') : null;
    const types = only ? all.filter((t) => only.includes(t)) : all;

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

/** The in-city lineup. See `--street` at the top. */
async function street(evaluate, send) {
  const OUTS = `tools/data/vehicles/${TAG}-street`;
  rmSync(OUTS, { recursive: true, force: true });
  mkdirSync(OUTS, { recursive: true });
  // Near lane: what a player passes constantly. Far lane, facing the other
  // way: the big boxes, so they are seen nose-on.
  const NEAR = ['sedan', 'hatch', 'taxi', 'suv', 'compact', 'police', 'pickup', 'ev'];
  const FAR = ['van', 'bus', 'boxtruck', 'ambulance', 'garbage'];
  const COLS = [0x9fa4a9, 0x102b52, 0xe6e8ea, 0x6d0f14, 0x1b1d20, 0xf2f4f6, 0x14472f, 0x7a5a22,
    0x2f3a44, 0xe6e8ea, 0x0d5b66, 0xbcc2c8, 0x7d2418];
  const setup = await evaluate(`(() => {
    const d = window.__dbg, city = d.city;
    d.applyQuality('high', true);
    for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns'])
      { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    d.game.paused = true;
    d.player.h.group.visible = false;
    // Densest commercial cluster, as beauty.mjs picks its street view.
    const cells = new Map();
    for (const b of city.buildings) {
      if (!(b.style === 'brick' || b.style === 'lowrise' || b.style === 'midrise') || b.w <= 18) continue;
      if (b.h < 12 || b.h > 45) continue;
      const k = Math.round(b.x / 300) * 100000 + Math.round(b.z / 300);
      let c = cells.get(k);
      if (!c) cells.set(k, (c = { n: 0, x: 0, z: 0 }));
      c.n++; c.x += b.x; c.z += b.z;
    }
    let best = null;
    for (const c of cells.values()) if (!best || c.n > best.n) best = c;
    const tx = best.x / best.n, tz = best.z / best.n;
    // A long, wide, ground-level street near it.
    // Score by length first: the lineup is ~50 m, and a short block puts half
    // of it in a junction.
    let pick = null, ps = -1e18;
    for (const ei of city.edgesNear(tx, tz, 700)) {
      const e = city.edges[ei];
      if (e.elev || e.cls === 'hwy' || e.cls === 'ramp' || !(e.hw >= 3.5)) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (Math.abs((a.y || 0) - (b.y || 0)) / len > 0.04) continue;
      const dd = Math.hypot((a.x + b.x) / 2 - tx, (a.z + b.z) / 2 - tz);
      const score = Math.min(len, 90) * 10 - dd;
      if (score > ps) { ps = score; pick = ei; }
    }
    const e = city.edges[pick], a = city.nodes[e.a];
    const have = new Set(Object.keys(d.TYPES || d.traffic.assets || {}));
    const NEAR = ${JSON.stringify(NEAR)}.filter((t) => have.has(t));
    const FAR = ${JSON.stringify(FAR)}.filter((t) => have.has(t));
    const COLS = ${JSON.stringify(COLS)};
    const lane = (list, sign, c0) => {
      let s = 14;
      list.forEach((name, i) => {
        const len = d.TYPES ? d.TYPES[name].len : 5;
        s += len / 2;
        const off = e.hw * 0.48 * sign;
        const x = a.x + e.dx * s - e.dz * off, z = a.z + e.dz * s + e.dx * off;
        // 'traffic', so the cars are occupied as driven ones are (the game is
        // paused, so none of them moves).
        const v = d.traffic.spawnAt(x, z, Math.atan2(e.dx * sign, e.dz * sign), name, COLS[(c0 + i) % COLS.length], 'traffic');
        for (let k = 0; k < 3; k++) v.update(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: 0 });
        s += len / 2 + 2.6;
      });
      return s;
    };
    const endNear = lane(NEAR, 1, 0);
    lane(FAR, -1, 8);
    return { ax: a.x, az: a.z, dx: e.dx, dz: e.dz, hw: e.hw, span: endNear };
  })()`);
  const views = [
    // Both from AHEAD of the near lane, so its cars show their faces. Inside
    // the street, where no kerbside bin or house can stand in the way.
    // eye height, three-quarter on the last few cars of the near lane
    { name: 'low', s: setup.span + 4, lat: setup.hw * 0.05, eye: 1.5, ls: setup.span - 16, llat: setup.hw * 0.48, look: 0.9 },
    // from the crown of the road, three-quarter on the middle of the near lane
    { name: 'mid', s: setup.span * 0.62, lat: -setup.hw * 0.10, eye: 2.4, ls: setup.span * 0.36, llat: setup.hw * 0.48, look: 0.8 },
    // raised, looking back down the whole lineup
    { name: 'high', s: setup.span + 14, lat: -setup.hw * 0.25, eye: 8.0, ls: setup.span * 0.45, llat: setup.hw * 0.15, look: 0.5 },
    // the chase camera's view of the first car in the near lane: its rear
    // screen is what a player looks at most
    { name: 'chase', s: 9.2, lat: setup.hw * 0.48, eye: 2.3, ls: 22, llat: setup.hw * 0.48, look: 1.1 },
  ];
  for (const V of views) {
    await evaluate(`(() => {
      const d = window.__dbg, S = ${JSON.stringify(setup)}, V = ${JSON.stringify(V)};
      const at = (s, lat) => [S.ax + S.dx * s - S.dz * lat, S.az + S.dz * s + S.dx * lat];
      const [cx, cz] = at(V.s, V.lat), [lx, lz] = at(V.ls, V.llat);
      const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
      d.world.update(cx, cz, 60);
      for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(cx, cz, 60);
      const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
      d.camera.position.set(cx, gy(cx, cz) + V.eye, cz);
      d.camera.lookAt(lx, gy(lx, lz) + V.look, lz);
      d.camera.updateMatrixWorld(true);
      // Sun across the view, at main.js's elevation -- see beauty.mjs.
      const bear = Math.atan2(lx - cx, lz - cz), SUN_AZ = bear + 1.75, sr = Math.hypot(215, 150);
      const ax = cx + (lx - cx) * 0.5, az = cz + (lz - cz) * 0.5, ay = gy(ax, az);
      d.sun.position.set(ax - Math.sin(SUN_AZ) * sr, ay + 200, az - Math.cos(SUN_AZ) * sr);
      d.sun.target.position.set(ax, ay, az);
      d.sun.target.updateMatrixWorld();
      d.scene.updateMatrixWorld(true);
    })()`);
    await sleep(9000);
    const { result } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUTS}/${V.name}.png`, Buffer.from(result.data, 'base64'));
    console.log(`  ${OUTS}/${V.name}.png`);
  }
}

main().catch((e) => { console.error('vehshots failed:', e.message); process.exitCode = 1; });
