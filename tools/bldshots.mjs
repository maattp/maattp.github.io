// Buildings, judged systematically: a numeric outlier scan over every box the
// city ships, and close-up contact sheets of samples from each style, size
// class, neighbourhood and outlier category.
//
//   AUTO_HTTP_PORT=8104 AUTO_CDP_PORT=9631 node tools/bldshots.mjs <outdir> [--scan] [--shots=a,b] [--n=6]
//
//   --scan        print the catalogue (counts per category) and write scan.json
//   --shots=LIST  categories to photograph (default: every sample group);
//                 each sample gets an eye-level view of its long face and an
//                 aerial three-quarter view, written as <group>-<k>-{eye,air}.png
//   --n=N         samples per group (default 6)
//   --from=FILE   re-shoot the buildings of another run's index.json (matched
//                 by position), for a before/after on identical framing
//   BLD_PROBE='<expr>'  evaluate an expression after boot and exit
//
// Samples are picked deterministically from the loaded city (sorted by seed
// inside each group), so a base checkout served on another port photographs
// the same buildings. Views are framed from the building itself: the camera
// stands off the long face, far enough that the face fills the frame, and the
// bearing is walked round until nothing else stands in the sightline.
//
// Runs on the Mac's GPU (tools/chrome.mjs, gpu: true) -- SwiftShader at ~5 fps
// makes 100+ settled views take an hour. Before/after pairs use the same mode.
// Contact sheets: tools/.venv/bin/python tools/bldsheet.py <outdir>.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome, assertRenderer } from './chrome.mjs';

const PORT = +process.env.AUTO_CDP_PORT || 9631;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith('--')) || 'tools/data/bldshots';
const SCAN = args.includes('--scan');
const arg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const SHOTS = arg('shots', SCAN ? '' : 'all');
const N = +arg('n', 6);
const FROM = arg('from', '');   // another run's index.json: re-shoot those buildings

// Neighbourhood discs for the per-area groups.
const HOODS = {
  downtown: [305, -278, 700], capitol: [1468, -1389, 600], sodo: [218, 3484, 900],
  uw: [2361, -4936, 600], ballard: [-3200, -6900, 900], waterfront: [-330, 350, 350],
  wallingford: [267, -5350, 700], georgetown: [590, 6939, 800], slu: [-36, -1314, 500],
};

// The whole scan, run in the page. Returns { counts, groups: {name: [bi...]} }.
const SCAN_JS = `(() => {
  const d = window.__dbg, city = d.city, G = d.G, w = d.world;
  const B = city.buildings;
  const HOODS = ${JSON.stringify(HOODS)};
  const T = (x, z) => G.terrainHeight(x, z);
  const cnt = {}, grp = {};
  const add = (k, bi) => { cnt[k] = (cnt[k] || 0) + 1; if (bi != null) (grp[k] || (grp[k] = [])).push(bi); };
  const famStyles = { tower: 1, midrise: 1, brick: 1, lowrise: 1 };
  const byStyle = {};
  for (let bi = 0; bi < B.length; bi++) {
    const bd = B[bi];
    if (bd.kind) continue;
    const L = Math.max(bd.w, bd.d), S = Math.min(bd.w, bd.d), A = bd.w * bd.d;
    const st = bd.style;
    byStyle[st] = (byStyle[st] || 0) + 1;
    add('style:' + st + (bd.h > 60 ? ':tall' : bd.h > 22 ? ':mid' : bd.h > 11 ? ':low' : ':short') + (A > 3000 ? ':big' : A > 600 ? ':med' : ':small'), bi);
    const cs = Math.cos(bd.rot), sn = Math.sin(bd.rot);
    let tmin = 1e9, tmax = -1e9;
    for (const [fx, fz] of [[-1,-1],[1,-1],[1,1],[-1,1],[0,-1],[0,1],[-1,0],[1,0]]) {
      const lx = fx * bd.w / 2, lz = fz * bd.d / 2;
      const t = T(bd.x + lx * cs - lz * sn, bd.z + lx * sn + lz * cs);
      if (t < tmin) tmin = t; if (t > tmax) tmax = t;
    }
    const base = bd.y - 2;
    const gap = base - tmin;
    if (G.isWater(bd.x, bd.z)) add('onWater', bi);
    if (gap > 0.3) add('float>0.3', bi);
    if (gap > 1.5) add('float>1.5', bi);
    if (gap > 4) add('float>4', bi);
    if (gap > 0.3) add('float>0.3:' + st);
    if (st === 'house') {
      const wallTop = base + bd.h * 0.72 + 2;
      if (tmax > wallTop - 1) add('houseBuried', bi);
    } else if (st !== 'industrial') {
      const plinthH = Math.min(5.2, bd.h * 0.3);
      if (plinthH > 2 && tmax - base > plinthH + 0.5) add('storefrontBuried', bi);
    }
    if (st === 'campus') { add('campus', bi); if (L > 30) add('campusBig', bi); }
    if (st === 'house' && L > 16) add('houseLong', bi);
    if (st === 'industrial' && L > 80) add('industrialLong', bi);
    if (st === 'industrial' && A < 110 && Math.abs(bd.h - 8.5) < 0.01) add('shedTall', bi);
    if (st === 'industrial' && A < 110) add('industrialSmall', bi);
    if (famStyles[st]) {
      const vS = bd.h / Math.max(1, Math.round(bd.h / 13));
      const storey = vS / 4;
      if (storey < 2.5) add('storeySquashed', bi);
      if (storey > 4.2) add('storeyStretched', bi);
    }
    if (S < 6 && bd.h > 18) add('needle', bi);
    if (S < 4.5) add('sliver<4.5');
    if (L / S > 8) add('aspect>8', bi);
    if (L / S > 5 && st !== 'house') add('aspect>5', bi);
    if (A > 6000 && bd.h < 10) add('pancake', bi);
    if (A > 20000) add('giant', bi);
    if (bd.h > 55 && S < 16) add('thinTower', bi);
    for (const [hn, [hx, hz, hr]] of Object.entries(HOODS)) {
      if ((bd.x - hx) ** 2 + (bd.z - hz) ** 2 < hr * hr) add('hood:' + hn, bi);
    }
  }
  // Overlaps: SAT between neighbouring oriented boxes.
  const axes = (b) => { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [[c, s], [-s, c]]; };
  const proj = (b, ax) => {
    const [u, v] = axes(b);
    const c = b.x * ax[0] + b.z * ax[1];
    const r = Math.abs(u[0] * ax[0] + u[1] * ax[1]) * b.w / 2 + Math.abs(v[0] * ax[0] + v[1] * ax[1]) * b.d / 2;
    return [c - r, c + r];
  };
  const idx = new Map(B.map((b, i) => [b, i]));
  let pairs = 0, deep = 0, sameH = 0;
  for (let i = 0; i < B.length; i++) {
    const a = B[i];
    if (a.kind) continue;
    for (const b of city.buildingsNear(a.x, a.z, Math.hypot(a.w, a.d) / 2 + 2)) {
      const j = idx.get(b);
      if (j <= i || b.kind) continue;
      let pen = 1e9;
      for (const ax of [...axes(a), ...axes(b)]) {
        const [a0, a1] = proj(a, ax), [b0, b1] = proj(b, ax);
        pen = Math.min(pen, Math.min(a1, b1) - Math.max(a0, b0));
        if (pen <= 0) break;
      }
      if (pen <= 0.3) continue;
      pairs++;
      if (pen > 3) { deep++; add('overlapDeep', i); }
      if (pen > 1 && Math.abs(a.h - b.h) < 0.6 && Math.abs(a.y - b.y) < 0.6) { sameH++; add('overlapSameRoof', i); }
    }
  }
  cnt['overlap>0.3'] = pairs; cnt['overlap>3m'] = deep; cnt['overlapSameRoof'] = sameH;
  // Deterministic samples: sort each group by seed.
  const groups = {};
  for (const [k, l] of Object.entries(grp)) {
    groups[k] = l.slice().sort((p, q) => (B[p].seed - B[q].seed) || (p - q));
  }
  return JSON.stringify({ total: B.length, byStyle, counts: cnt, groups });
})()`;

// Frame and capture building `bi` in the page: eye-level off its long face,
// then an aerial three-quarter. Returns camera info.
const POSE_JS = (bi, view) => `(() => {
  const d = window.__dbg, city = d.city, G = d.G, bd = city.buildings[${bi}];
  const L = Math.max(bd.w, bd.d), S = Math.min(bd.w, bd.d);
  const cs = Math.cos(bd.rot), sn = Math.sin(bd.rot);
  // Local +z is the normal of the face that runs along local x (width w).
  const faceAlongX = bd.w >= bd.d;
  const nLocal = faceAlongX ? [0, 1] : [1, 0];
  const n0 = [nLocal[0] * cs - nLocal[1] * sn, nLocal[0] * sn + nLocal[1] * cs];
  const halfDepth = faceAlongX ? bd.d / 2 : bd.w / 2;
  const fovH = 2 * Math.atan(Math.tan((d.camera.fov * Math.PI / 180) / 2) * d.camera.aspect);
  const fovV = d.camera.fov * Math.PI / 180;
  // Stand on the water where it is wet: Lake Union is at 5.3 m over a bed
  // near 0, and a camera on the bed is under the lake (which is then not
  // drawn), photographing the sea plane instead.
  const gy = (x, z) => {
    const t = G.terrainHeight(x, z);
    return G.isWater(x, z) ? Math.max(t, d.world.waterLevelAt(x, z) || 0) : Math.max(0, t);
  };
  const others = city.buildingsNear(bd.x, bd.z, 400).filter((b) => b !== bd);
  const inBox = (b, x, z, pad) => {
    const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
    return Math.abs(dx * c - dz * s) < b.w / 2 + pad && Math.abs(dx * s + dz * c) < b.d / 2 + pad;
  };
  let cx, cy, cz, tx, ty, tz;
  if (${JSON.stringify(view)} === 'eye') {
    const Dw = (L / 2) / Math.tan(fovH / 2) * 1.05;
    const Dh = Math.min(bd.h, 60) / Math.tan(fovV / 2) * 0.55;
    const D = Math.min(160, Math.max(12, Dw, Dh));
    const clear = (x0, z0, tx0, tz0) => {
      if (G.isWater(x0, z0)) return false;
      for (const b of others) if (inBox(b, x0, z0, 3)) return false;
      const Ls = Math.hypot(tx0 - x0, tz0 - z0);
      for (let s = 2; s < Ls; s += 2) {
        const x = x0 + (tx0 - x0) * s / Ls, z = z0 + (tz0 - z0) * s / Ls;
        if (inBox(bd, x, z, 0)) break;
        for (const b of others) if (b.h > 2.5 && inBox(b, x, z, 0)) return false;
      }
      return true;
    };
    let best = null;
    // The DOWNHILL face first: a slope shows what a base does there.
    const tp = G.terrainHeight(bd.x + n0[0] * (halfDepth + 3), bd.z + n0[1] * (halfDepth + 3));
    const tm = G.terrainHeight(bd.x - n0[0] * (halfDepth + 3), bd.z - n0[1] * (halfDepth + 3));
    const sgns = tp <= tm + 0.25 ? [1, -1] : [-1, 1];
    outer: for (const k of [1, 0.75, 0.5, 0.33]) {
      for (const sgn of sgns) {
        for (const da of [0, 0.35, -0.35, 0.7, -0.7, 1.0, -1.0]) {
          const ca = Math.cos(da), sa = Math.sin(da);
          const nx = (n0[0] * ca - n0[1] * sa) * sgn, nz = (n0[0] * sa + n0[1] * ca) * sgn;
          const x0 = bd.x + nx * (halfDepth + D * k), z0 = bd.z + nz * (halfDepth + D * k);
          if (clear(x0, z0, bd.x, bd.z)) { best = [x0, z0, k, da]; break outer; }
        }
      }
    }
    if (!best) best = [bd.x + n0[0] * (halfDepth + D), bd.z + n0[1] * (halfDepth + D), 1, 0];
    cx = best[0]; cz = best[1];
    cy = gy(cx, cz) + 1.7;
    tx = bd.x; tz = bd.z;
    ty = Math.max(gy(cx, cz) + 1.7, bd.y + Math.min(bd.h * 0.42, Math.tan(fovV * 0.4) * Math.hypot(cx - tx, cz - tz)));
  } else {
    const R = Math.max(L * 1.15, bd.h * 1.3, 30) + 15;
    const bear = Math.atan2(n0[0], n0[1]) + 0.75;
    cx = bd.x + Math.sin(bear) * R * 0.75; cz = bd.z + Math.cos(bear) * R * 0.75;
    cy = bd.y + bd.h + R * 0.62;
    tx = bd.x; tz = bd.z; ty = bd.y + bd.h * 0.35;
  }
  const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
  d.world.update(cx, cz, 60);
  for (let i = 0; i < 3000 && pending() > 0; i++) d.world.update(cx, cz, 60);
  d.camera.position.set(cx, cy, cz);
  d.camera.lookAt(tx, ty, tz);
  d.camera.updateMatrixWorld(true);
  d.placeSun(cx, cy, cz);
  return JSON.stringify({ cx: +cx.toFixed(1), cz: +cz.toFixed(1), style: bd.style, w: +bd.w.toFixed(1), d: +bd.d.toFixed(1), h: +bd.h.toFixed(1), x: +bd.x.toFixed(0), z: +bd.z.toFixed(0) });
})()`;

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-bldshots-${PORT}`, gpu: process.env.AUTO_GPU !== '0', width: 1280, height: 720 });
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
    if (!page) await sleep(300);
  }
  if (!page || page.url !== 'about:blank') throw new Error(`CDP port ${PORT} is not this run's Chrome`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map(); const errs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception');
  });
  const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
  const evaluate = async (e, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__noAutoQuality = true; try { localStorage.setItem('auto-quality', 'high'); } catch (e) {}` });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await evaluate('!!window.__dbg')) break; } catch { /* loading */ } }
  await assertRenderer(evaluate);
  for (let i = 0; i < 240; i++) { if (await evaluate('window.__dbg.sceneStats.calls > 0')) break; await sleep(500); }
  await evaluate(`(() => { const d = window.__dbg; d.applyQuality('high', true);
    for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','debugStats'])
      { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    d.game.paused = true;
    const pz = document.getElementById('pause'); if (pz) pz.style.display = 'none'; })()`);

  if (process.env.BLD_PROBE) {
    const v = await evaluate(process.env.BLD_PROBE, true);
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
    throw { done: true };
  }
  mkdirSync(OUT, { recursive: true });
  const scan = JSON.parse(await evaluate(SCAN_JS));
  writeFileSync(`${OUT}/scan.json`, JSON.stringify({ total: scan.total, byStyle: scan.byStyle, counts: scan.counts }, null, 1));
  if (SCAN) {
    console.log(`buildings: ${scan.total}  by style ${JSON.stringify(scan.byStyle)}`);
    const keys = Object.keys(scan.counts).sort();
    for (const k of keys) console.log(`  ${k.padEnd(34)} ${scan.counts[k]}`);
  }
  if (FROM) {
    // Re-shoot another run's buildings, found by position (a fix may change a
    // building's size or style, and drops shift every index after them).
    const prev = JSON.parse(readFileSync(FROM, 'utf8'));
    const only = SHOTS && SHOTS !== 'all' ? new Set(SHOTS.split(',')) : null;
    const index = [];
    for (const r of prev) {
      if (only && !only.has(r.group)) continue;
      const bi = await evaluate(`(() => { const c = window.__dbg.city; let best = -1, bd = 1e9;
        for (const b of c.buildingsNear(${r.x}, ${r.z}, 20)) { const dd = Math.hypot(b.x - ${r.x}, b.z - ${r.z}); if (dd < bd) { bd = dd; best = c.buildings.indexOf(b); } }
        return bd < 1.5 ? best : -1; })()`);
      if (bi < 0) { console.log(`  ${r.group}-${r.k}: building at (${r.x}, ${r.z}) is gone`); continue; }
      const info = JSON.parse(await evaluate(POSE_JS(bi, r.view)));
      await evaluate('new Promise((r) => { let n = 0; const f = () => (++n > 6 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })', true);
      const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
      writeFileSync(`${OUT}/${r.file}`, Buffer.from(result.data, 'base64'));
      index.push({ ...r, bi, ...info, x: r.x, z: r.z });
      process.stdout.write('.');
    }
    writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1));
    console.log(`\n  ${index.length} shots in ${OUT}`);
  } else if (SHOTS) {
    const want = SHOTS === 'all' ? Object.keys(scan.groups).filter((k) => !k.startsWith('style:') || true) : SHOTS.split(',');
    const index = [];
    for (const g of want) {
      const l = scan.groups[g];
      if (!l) { console.log(`  (no group ${g})`); continue; }
      // spread picks across the seed-sorted list rather than the first N
      const picks = [];
      for (let k = 0; k < Math.min(N, l.length); k++) picks.push(l[Math.floor((k + 0.5) * l.length / Math.min(N, l.length))]);
      for (let k = 0; k < picks.length; k++) {
        for (const view of ['eye', 'air']) {
          const info = JSON.parse(await evaluate(POSE_JS(picks[k], view)));
          await evaluate('new Promise((r) => { let n = 0; const f = () => (++n > 6 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })', true);
          const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
          const f = `${g.replace(/[:>]/g, '_')}-${k}-${view}.jpg`;
          writeFileSync(`${OUT}/${f}`, Buffer.from(result.data, 'base64'));
          index.push({ group: g, k, view, file: f, bi: picks[k], ...info });
        }
        process.stdout.write('.');
      }
    }
    writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1));
    console.log(`\n  ${index.length} shots in ${OUT}`);
  }
  console.log(`  exceptions: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
} catch (e) {
  if (!e || !e.done) { console.error('bldshots failed:', e && e.message ? e.message : e); process.exitCode = 1; }
} finally {
  chrome.kill('SIGKILL');
}
