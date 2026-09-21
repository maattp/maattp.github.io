// Junction survey: how street intersections are drawn, measured and photographed.
//
//   node tools/junctions.mjs [tag] [--only=cat,cat] [--noshots] [--json]
//
// Picks real junctions FROM THE GRAPH by kind -- the rotated downtown grid's
// 4-ways, skewed junctions where the grids meet, T-junctions, junctions of
// very different widths, arterial x residential, hilly ones on Queen Anne and
// Capitol Hill, and 5+-way junctions -- and for each one:
//
//   * raycasts a 0.5 m grid straight down over the junction and classifies the
//     TOP surface (tarmac / pavement / paint / nothing) against the analytic
//     carriageway (city.onRoad), so the defects come out as numbers:
//       hole      carriageway point with no tarmac drawn over it
//       walkOnCw  pavement drawn as the top surface of a carriageway
//       stack     two tarmac surfaces within 1 cm of each other (z-fight;
//                 the gutter decal is not counted)
//       paintX    paint drawn on a junction's own crossing surface (where
//                 nodeSurface reports inSquare) or across another approach
//                 (inside two approaches' carriageway bands at once)
//       sink      |drawn top - groundAt| > 10 cm on anything paved
//       kerbGap   point beside an approach (within its pavement width) with
//                 nothing drawn at all -- a hole in the pavement (a corner's
//                 kerb radius legitimately puts tarmac there, so tarmac is
//                 not counted)
//   * writes a top-down classification map (PNG) of that grid, and
//   * photographs it from ~22 m up, straight down from 30 m, and from a
//     driver's eye on its widest approach.
//
// Desktop UA (chunk arrays are kept, so raycasts work), GPU renderer by
// default (AUTO_GPU=0 for SwiftShader). Compare before/after with the same one.
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome } from './chrome.mjs';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9621;
const TAG = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'now';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const NOSHOTS = process.argv.includes('--noshots');
const OUT = `tools/data/junctions/${TAG}`;
const GPU = process.env.AUTO_GPU !== '0';

// [category, anchor x, z, how many]. The picker takes the nearest junctions
// to the anchor that match the category's test.
const CATS = [
  ['grid4', 250, 450, 3],        // rotated downtown grid, 4-way
  ['skew', 150, -700, 3],        // where the downtown grid meets the N-S grid (Denny/Belltown)
  ['skew', 1500, -900, 1],       // Capitol Hill / Broadway skew
  ['tee', 200, 300, 2],
  ['tee', -1300, -2600, 1],
  ['widths', 300, 200, 2],       // hw ratio >= 2
  ['artres', 1200, -2000, 2],
  ['hillQA', -1436, -2853, 2],
  ['hillCH', 1947, -1296, 2],
  ['multi', 200, -300, 2],       // 5+ ways
];

const PICK = `(() => {
  const d = window.__dbg, c = d.city, G = d.G;
  const CATS = ${JSON.stringify(CATS)};
  const only = ${JSON.stringify(ONLY)};
  const arms = (ni) => {
    const n = c.nodes[ni], out = [];
    for (const ei of n.e) {
      const e = c.edges[ei];
      if (e.tunnel || e.elev || e.prof) return null;
      const o = c.nodes[e.a === ni ? e.b : e.a];
      const L = Math.hypot(o.x - n.x, o.z - n.z) || 1;
      out.push({ ei, dx: (o.x - n.x) / L, dz: (o.z - n.z) / L, hw: e.hw, cls: e.cls, len: e.len });
    }
    return out;
  };
  const street = (a) => a.cls === 'st' || a.cls === 'art' || a.cls === 'res';
  const test = (cat, ni, A) => {
    const n = c.nodes[ni];
    if (!A || A.length < 3 || A.some((a) => !street(a)) || A.some((a) => a.len < 25)) return false;
    const ang = A.map((a) => Math.atan2(a.dz, a.dx)).sort((p, q) => p - q);
    const gaps = ang.map((t, i) => ((i + 1 < ang.length ? ang[i + 1] : ang[0] + 2 * Math.PI) - t) * 180 / Math.PI);
    const minGap = Math.min(...gaps);
    const hws = A.map((a) => a.hw);
    const ratio = Math.max(...hws) / Math.min(...hws);
    const g = Math.hypot(G.terrainHeight(n.x + 10, n.z) - G.terrainHeight(n.x - 10, n.z),
      G.terrainHeight(n.x, n.z + 10) - G.terrainHeight(n.x, n.z - 10)) / 20;
    const col = () => { for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++)
      if (A[i].dx * A[j].dx + A[i].dz * A[j].dz < -0.985) return true; return false; };
    switch (cat) {
      case 'grid4': return A.length === 4 && minGap > 80 && ratio < 1.5;
      case 'skew': return minGap < 55 && minGap > 15 && A.length <= 4;
      case 'tee': return A.length === 3 && col() && minGap > 75;
      case 'widths': return ratio >= 2 && A.length >= 3;
      case 'artres': return A.some((a) => a.cls === 'art') && A.some((a) => a.cls === 'res') && A.length >= 3;
      case 'hillQA': case 'hillCH': return g > 0.08 && A.length >= 3;
      case 'multi': return A.length >= 5;
    }
    return false;
  };
  const picked = [], used = new Set();
  for (const [cat, ax, az, k] of CATS) {
    if (only && !only.split(',').includes(cat)) continue;
    const cand = [];
    for (let ni = 0; ni < c.nodes.length; ni++) {
      const n = c.nodes[ni];
      const dd = (n.x - ax) ** 2 + (n.z - az) ** 2;
      if (dd > 3000 * 3000 || n.elev || n.prof) continue;
      cand.push([dd, ni]);
    }
    cand.sort((p, q) => p[0] - q[0]);
    let got = 0;
    for (const [, ni] of cand) {
      if (got >= k) break;
      if (used.has(ni)) continue;
      const A = arms(ni);
      if (!test(cat, ni, A)) continue;
      // not right next to another pick
      const n = c.nodes[ni];
      if (picked.some((p) => Math.hypot(p.x - n.x, p.z - n.z) < 120)) continue;
      used.add(ni); got++;
      picked.push({ cat, ni, x: n.x, z: n.z, arms: A.map((a) => ({ ei: a.ei, cls: a.cls, hw: +a.hw.toFixed(1),
        deg: Math.round(Math.atan2(a.dz, a.dx) * 180 / Math.PI) })) });
    }
  }
  return picked;
})()`;

const settleExpr = (x, z) => `(() => {
  const d = window.__dbg, w = d.world;
  const pending = () => [...w.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
  for (let i = 0; i < 20000 && (i === 0 || pending() > 0); i++) w.update(${x}, ${z}, 9);
  d.scene.updateMatrixWorld(true);
  return true;
})()`;

// Grid analysis + classification map for one junction.
const ANALYSE = (J) => `(() => {
  const d = window.__dbg, c = d.city, G = d.G, THREE = d.THREE, w = d.world;
  const J = ${JSON.stringify(J)};
  const n = c.nodes[J.ni];
  let mhw = 0; for (const a of J.arms) mhw = Math.max(mhw, a.hw);
  const R = mhw + 3.2 + 6;
  const STEP = 0.5, N = Math.round((2 * R) / STEP) + 1;
  // Triangle soup of every up-facing paved/paint triangle near the junction,
  // binned on a 2 m grid, so a vertical "ray" is a 2D point-in-triangle test
  // (three's raycaster walks every triangle of a 100k-triangle chunk mesh).
  const tris = [], BIN = 2, NB = Math.ceil((2 * R + 4) / BIN), bins = new Map();
  const x0 = n.x - R - 2, z0 = n.z - R - 2, X1 = x0 + NB * BIN, Z1 = z0 + NB * BIN;
  const v = new THREE.Vector3();
  w.group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const m = o.material;
    const isFlat = m === w.mats.flat || m === w.mats.flatGlow;
    if (!(isFlat || m === w.mats.road || m === w.mats.roadWalk || m === w.mats.walk)) return;
    const g = o.geometry, P = g.attributes.position, I = g.index, C = g.attributes.color, S = g.attributes.surf;
    if (!P) return;
    o.updateMatrixWorld(); const M = o.matrixWorld;
    const cnt = I ? I.count : P.count;
    for (let t = 0; t < cnt; t += 3) {
      const ia = I ? I.getX(t) : t, ib = I ? I.getX(t + 1) : t + 1, ic = I ? I.getX(t + 2) : t + 2;
      v.set(P.getX(ia), P.getY(ia), P.getZ(ia)).applyMatrix4(M); const A = [v.x, v.y, v.z];
      if (A[0] < x0 - 30 || A[0] > X1 + 30 || A[2] < z0 - 30 || A[2] > Z1 + 30) continue;
      v.set(P.getX(ib), P.getY(ib), P.getZ(ib)).applyMatrix4(M); const B = [v.x, v.y, v.z];
      v.set(P.getX(ic), P.getY(ic), P.getZ(ic)).applyMatrix4(M); const Cc = [v.x, v.y, v.z];
      const mnx = Math.min(A[0], B[0], Cc[0]), mxx = Math.max(A[0], B[0], Cc[0]);
      const mnz = Math.min(A[2], B[2], Cc[2]), mxz = Math.max(A[2], B[2], Cc[2]);
      if (mxx < x0 || mnx > X1 || mxz < z0 || mnz > Z1) continue;
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = Cc[0] - A[0], wy = Cc[1] - A[1], wz = Cc[2] - A[2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      if (Math.abs(ny) / nl < 0.95) continue;
      let kind;
      if (isFlat) {
        const r = C.getX(ia), gg = C.getY(ia), bl = C.getZ(ia);
        if ((r > 0.85 && gg > 0.85 && bl > 0.8) || (r > 0.8 && gg > 0.6 && gg < 0.8 && bl < 0.3)) kind = 'paint'; else continue;
      } else if (m === w.mats.walk) kind = 'walk';
      else {
        kind = S && S.getX(ia) > 0.5 ? 'walk' : 'road';
        // the gutter is a grime decal in the road mesh, 1.2 cm over the
        // tarmac on purpose (its colours are the only tinted ones there)
        if (kind === 'road' && C && Math.abs(C.getX(ia) - C.getZ(ia)) > 0.005) kind = 'gutter';
      }
      const k = tris.push({ A, B, C: Cc, kind }) - 1;
      for (let bx = Math.max(0, Math.floor((mnx - x0) / BIN)); bx <= Math.min(NB - 1, Math.floor((mxx - x0) / BIN)); bx++)
        for (let bz = Math.max(0, Math.floor((mnz - z0) / BIN)); bz <= Math.min(NB - 1, Math.floor((mxz - z0) / BIN)); bz++) {
          const key = bx * 1000 + bz; let l = bins.get(key); if (!l) bins.set(key, (l = [])); l.push(k);
        }
    }
  });
  const hitsAt = (x, z) => {
    const l = bins.get(Math.floor((x - x0) / BIN) * 1000 + Math.floor((z - z0) / BIN));
    const out = [];
    if (!l) return out;
    for (const k of l) {
      const t = tris[k], A = t.A, B = t.B, C = t.C;
      const dd = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
      if (Math.abs(dd) < 1e-9) continue;
      const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / dd;
      const l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / dd;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      out.push({ kind: t.kind, y: l1 * A[1] + l2 * B[1] + l3 * C[1] });
    }
    out.sort((p, q) => q.y - p.y);
    return out;
  };
  // pavement expectation: within [hw, hw + sw] of an approach edge's segment interior
  const ed = J.arms.map((a) => { const e = c.edges[a.ei]; return { e, A: c.nodes[e.a], B: c.nodes[e.b],
    sw: e.cls === 'art' ? 3.2 : 2.6 }; });
  const cvs = document.createElement('canvas'); cvs.width = N; cvs.height = N;
  const cx = cvs.getContext('2d'); const img = cx.createImageData(N, N);
  const st = { pts: 0, cw: 0, hole: 0, walkOnCw: 0, stack: 0, sink: 0, paved: 0, paintX: 0, expWalk: 0, kerbGap: 0,
    maxSink: 0, worst: [] };
  const nr = w.nodeRadius(J.ni);
  const sinkPts = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = n.x - R + i * STEP, z = n.z - R + j * STEP;
    const T = G.terrainHeight(x, z);
    const hits = hitsAt(x, z).filter((h) => h.y > T - 0.5 && h.y < T + 1.5);
    let top = null; const roadYs = [];
    for (const h of hits) {
      if (h.kind === 'gutter') { if (!top) top = { kind: 'road', y: h.y }; continue; }
      if (!top) top = h;
      if (h.kind === 'road') roadYs.push(h.y);
    }
    const onCw = c.onRoad(x, z, 0, false);
    st.pts++;
    let col = [60, 130, 60];     // grass/nothing
    if (top) col = top.kind === 'road' ? [70, 70, 75] : top.kind === 'walk' ? [185, 185, 175] : [240, 220, 60];
    if (onCw) {
      st.cw++;
      if (!top || top.kind === 'none') { st.hole++; col = [255, 0, 0]; }
      else if (top.kind === 'walk') { st.walkOnCw++; col = [255, 0, 255]; }
      // paint on the junction's own surface (what nodeSurface calls the
      // crossing: the square before, the polygon now)
      if (top && top.kind === 'paint') {
        const ns = c.nodeSurface(x, z);
        // ...or lying across another carriageway: inside the interior of two
        // approaches' bands at once, which is the crossing
        let bands = 0;
        for (const q of ed) {
          const sx = q.B.x - q.A.x, sz = q.B.z - q.A.z, l2 = sx * sx + sz * sz;
          const t = ((x - q.A.x) * sx + (z - q.A.z) * sz) / l2;
          if (t <= 0 || t >= 1) continue;
          if (Math.hypot(x - (q.A.x + sx * t), z - (q.A.z + sz * t)) < q.e.hw - 0.3) bands++;
        }
        if ((ns && ns.inSquare) || bands >= 2) { st.paintX++; col = [255, 140, 0]; }
      }
    } else {
      // expected pavement: beside an approach
      for (const q of ed) {
        const r = (() => { const sx = q.B.x - q.A.x, sz = q.B.z - q.A.z, l2 = sx * sx + sz * sz;
          let t = ((x - q.A.x) * sx + (z - q.A.z) * sz) / l2; return { t, d: Math.hypot(x - (q.A.x + sx * t), z - (q.A.z + sz * t)) }; })();
        if (r.t > 0.02 && r.t < 0.98 && r.d > q.e.hw + 0.3 && r.d < q.e.hw + q.sw - 0.3) {
          st.expWalk++;
          if (!top) { st.kerbGap++; col = [0, 200, 255]; }
          break;
        }
      }
    }
    if (roadYs.length > 1) {
      roadYs.sort((p, q) => q - p);
      if (roadYs[0] - roadYs[1] < 0.01) { st.stack++; if (onCw && top && top.kind === 'road') col = [40, 40, 255]; }
    }
    if (top && top.kind !== 'paint') {
      st.paved++;
      const lift = c.roadLift(x, z);
      const stand = c.groundAt(x, z, null, lift);
      const gap = top.y - stand;
      if (Math.abs(gap) > 0.1) { st.sink++; sinkPts.push([i, j, gap]); if (Math.abs(gap) > st.maxSink) st.maxSink = +Math.abs(gap).toFixed(2);
        if (st.worst.length < 6) st.worst.push([+x.toFixed(1), +z.toFixed(1), +gap.toFixed(2), top.kind, +lift.toFixed(2)]); }
    }
    const o = ((N - 1 - j) * N + i) * 4;   // north (-z) up: j grows +z (south) -> row from bottom
    const oo = (j * N + i) * 4;
    img.data[oo] = col[0]; img.data[oo + 1] = col[1]; img.data[oo + 2] = col[2]; img.data[oo + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const at = ${JSON.stringify(process.env.JUNC_AT || '')};
  if (at) { const [ax, az] = at.split(',').map(Number); st.at = { hits: hitsAt(ax, az), T: G.terrainHeight(ax, az),
    px: (() => { const k = Math.round((az - (n.z - R)) / STEP) * N + Math.round((ax - (n.x - R)) / STEP); return Array.from(img.data.slice(k * 4, k * 4 + 4)); })() }; }
  // scale up
  const big = document.createElement('canvas'); big.width = N * 4; big.height = N * 4;
  const bx = big.getContext('2d'); bx.imageSmoothingEnabled = false; bx.drawImage(cvs, 0, 0, N * 4, N * 4);
  // node + carriageway centrelines
  bx.strokeStyle = 'rgba(255,255,255,0.5)'; bx.lineWidth = 1;
  for (const q of ed) { const P = (p) => [((p.x - n.x + R) / STEP) * 4, ((p.z - n.z + R) / STEP) * 4];
    const [a0, a1] = P(q.A), [b0, b1] = P(q.B); bx.beginPath(); bx.moveTo(a0, a1); bx.lineTo(b0, b1); bx.stroke(); }
  // sink samples: a white-ringed dot, red where the drawn surface is above
  // where you stand (you sink into it), green where it is below (you float)
  for (const [i, j, gap] of sinkPts) {
    bx.fillStyle = gap > 0 ? 'rgb(255,60,60)' : 'rgb(60,255,120)';
    bx.fillRect(i * 4 + 1, j * 4 + 1, 2, 2);
  }
  return { st, map: big.toDataURL('image/png'), nr: +nr.toFixed(1), R };
})()`;

const POSE = (J, view) => `(() => {
  const d = window.__dbg, c = d.city;
  const J = ${JSON.stringify(J)};
  const n = c.nodes[J.ni];
  const gy = c.groundAt(n.x, n.z, null);
  let best = J.arms[0]; for (const a of J.arms) if (a.hw > best.hw) best = a;
  const e = c.edges[best.ei], o = c.nodes[e.a === J.ni ? e.b : e.a];
  const L = Math.hypot(o.x - n.x, o.z - n.z); const ux = (o.x - n.x) / L, uz = (o.z - n.z) / L;
  const cam = d.camera;
  const view = ${JSON.stringify(view)};
  if (view === 'eye') {
    const back = Math.min(26, L * 0.8), px = n.x + ux * back - uz * best.hw * 0.4, pz = n.z + uz * back + ux * best.hw * 0.4;
    const y = c.groundAt(px, pz, null) + 1.3;
    cam.position.set(px, y, pz); cam.lookAt(n.x - ux * 10, gy + 0.2, n.z - uz * 10);
  } else if (view === 'oblique') {
    // 45 deg off the widest approach, 22 m up, 24 m back
    const k = Math.SQRT1_2, vx = ux * k - uz * k, vz = uz * k + ux * k;
    cam.position.set(n.x + vx * 24, gy + 22, n.z + vz * 24); cam.lookAt(n.x, gy, n.z);
  } else {
    cam.position.set(n.x, gy + 34, n.z + 0.01); cam.up.set(0, 0, -1); cam.lookAt(n.x, gy, n.z); cam.up.set(0, 1, 0);
  }
  d.sun.position.set(n.x - 150, gy + 230, n.z - 110);
  d.sun.target.position.set(n.x, gy, n.z); d.sun.target.updateMatrixWorld();
  cam.updateMatrixWorld(true);
  return true;
})()`;

const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-junctions-${PORT}`, gpu: GPU, width: 1280, height: 720 });
let code = 0;
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__noAutoQuality = true; try { localStorage.setItem('auto-quality', 'high'); } catch (e) {}` });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  for (let i = 0; i < 240; i++) { if (await ev('window.__dbg.sceneStats && window.__dbg.sceneStats.calls > 0')) break; await sleep(500); }
  await ev(`(() => { for (const id of ['hud','pad','stickZone','objective','topBtns'])
    { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    window.__dbg.game.paused = true; })()`);
  // JUNC_PROBE='<expr>': evaluate a one-off diagnostic on this boot and stop.
  if (process.env.JUNC_PROBE) {
    console.log(JSON.stringify(await ev(process.env.JUNC_PROBE), null, 1));
    throw { done: true };
  }
  mkdirSync(OUT, { recursive: true });
  const J = await ev(PICK);
  const tot = { pts: 0, cw: 0, hole: 0, walkOnCw: 0, stack: 0, sink: 0, paved: 0, paintX: 0, expWalk: 0, kerbGap: 0 };
  const rows = [];
  for (let k = 0; k < J.length; k++) {
    const j = J[k];
    const name = `${String(k).padStart(2, '0')}-${j.cat}`;
    await ev(settleExpr(j.x, j.z));
    const r = await ev(ANALYSE(j));
    writeFileSync(`${OUT}/${name}-map.png`, Buffer.from(r.map.split(',')[1], 'base64'));
    for (const key in tot) tot[key] += r.st[key];
    rows.push({ name, ni: j.ni, x: Math.round(j.x), z: Math.round(j.z), arms: j.arms.map((a) => `${a.cls}${a.hw}@${a.deg}`).join(' '), nr: r.nr, ...r.st });
    console.log(`${name.padEnd(12)} n${j.ni} (${Math.round(j.x)},${Math.round(j.z)}) ${j.arms.map((a) => `${a.cls}${a.hw}@${a.deg}`).join(' ')}`);
    const s = r.st;
    if (s.at) console.log('   at', JSON.stringify(s.at));
    console.log(`   cw ${s.cw}  hole ${s.hole}  walkOnCw ${s.walkOnCw}  stack ${s.stack}  paintX ${s.paintX}  kerbGap ${s.kerbGap}/${s.expWalk}  sink ${s.sink}/${s.paved} max ${s.maxSink}${s.worst.length ? ' ' + JSON.stringify(s.worst.slice(0, 3)) : ''}`);
    if (NOSHOTS) continue;
    for (const view of ['oblique', 'top', 'eye']) {
      await ev(POSE(j, view));
      await sleep(GPU ? 900 : 6000);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${name}-${view}.png`, Buffer.from(result.data, 'base64'));
    }
  }
  console.log('\nTOTAL', JSON.stringify(tot));
  console.log(`rates: hole ${(100 * tot.hole / tot.cw).toFixed(2)}% of cw, walkOnCw ${(100 * tot.walkOnCw / tot.cw).toFixed(2)}%, stack ${tot.stack}, paintX ${tot.paintX}, kerbGap ${(100 * tot.kerbGap / tot.expWalk).toFixed(1)}%, sink ${(100 * tot.sink / tot.paved).toFixed(2)}%`);
  writeFileSync(`${OUT}/report.json`, JSON.stringify({ tot, rows }, null, 1));
} catch (e) {
  if (!e || !e.done) { console.error('junctions failed:', e && e.message); code = 1; }
} finally {
  chrome.kill();
  setTimeout(() => process.exit(code), 500);
}
