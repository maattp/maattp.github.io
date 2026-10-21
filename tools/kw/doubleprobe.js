// Auto KW: every building footprint drawn by TWO systems (or twice by one).
//
//   VIEW_PROBE_FILE=tools/kw/doubleprobe.js node tools/kw/kwshots.mjs /tmp/x
//
// A footprint's drawer: 'world' (world.js meshBuilding: a box with height and
// no kw.poly / kw.skip; 'strip' when kw.js markStrips made it a plaza unit),
// 'poly' (kw.js buildPolys: kw.poly, not skipped), 'shop' (kwshops.js: kw.shop).
// Boxes skipped for kwplaces / kwsights / kwfun / uwcampus are left out (they
// draw their own outline and flatten every box under it). Two footprints
// overlapping by more than 15 % of the smaller one are reported: their roofs
// z-fight (two flat tops at one height read as stripes) or one pokes through.
(() => {
  const d = window.__dbg, city = d.city;
  const corners = (b, k = 1) => {
    const c = Math.cos(b.rot), s = Math.sin(b.rot), hw = b.w / 2 * k, hd = b.d / 2 * k;
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [b.x + lx * c - lz * s, b.z + lx * s + lz * c]);
  };
  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return Math.abs(a / 2); };
  const inPoly = (p, x, z) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    }
    return c;
  };
  const drawer = (b) => {
    if (!b.kw) return b.h > 0.5 ? 'world' : null;
    if (b.kw.shop) return 'shop';
    if (b.kw.skip) return null;
    if (b.kw.poly) return 'poly';
    if (b.h <= 0.5) return null;
    return b.kw.strip ? 'strip' : 'world';
  };
  const foot = (b) => (b.kw && b.kw.poly && !b.kw.shop ? b.kw.poly.pts : corners(b));
  // overlap of A and B by sampling A on a grid (~1.5 m, at most 400 samples)
  const overlap = (A, B) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of A) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    const st = Math.max(1, Math.sqrt((x1 - x0) * (z1 - z0) / 400));
    let inA = 0, both = 0;
    for (let x = x0 + st / 2; x < x1; x += st) for (let z = z0 + st / 2; z < z1; z += st) {
      if (!inPoly(A, x, z)) continue;
      inA++;
      if (inPoly(B, x, z)) both++;
    }
    return inA ? both / inA : 0;
  };
  const pairs = {}, ex = {};
  const log = window.__kwDedupe || null;   // what kw.js dedupeFootprints did at boot
  const seen = new Set();
  let n = 0;
  const idx = new Map(city.buildings.map((b, i) => [b, i]));
  for (const b of city.buildings) {
    const da = drawer(b);
    if (!da) continue;
    n++;
    const A = foot(b), aA = area(A);
    const r = Math.sqrt(aA) + 60;
    for (const o of city.buildingsNear(b.x, b.z, r)) {
      if (o === b) continue;
      const db = drawer(o);
      if (!db) continue;
      const ia = idx.get(b), ib = idx.get(o);
      const key = ia < ib ? ia + ',' + ib : ib + ',' + ia;
      if (seen.has(key)) continue;
      const B = foot(o), aB = area(B);
      // sample the smaller one
      const [S, L] = aA <= aB ? [A, B] : [B, A];
      const f = overlap(S, L);
      if (f < 0.15) continue;
      seen.add(key);
      const top = (q, F) => { if (q.kw && q.kw.poly && !q.kw.shop) { let cx = 0, cz = 0; for (const p of F) { cx += p[0]; cz += p[1]; } return d.city.groundAt(cx / F.length, cz / F.length, null) + q.kw.poly.h; } return q.y + q.h; };
      const dt = Math.abs(top(b, A) - top(o, B));
      const k = [da, db].sort().join('+') + (dt < 0.4 ?' SAME-ROOF' : ' step');
      pairs[k] = (pairs[k] || 0) + 1;
      (ex[k] = ex[k] || []);
      const hh = (q) => (q.kw && q.kw.poly ? q.kw.poly.h : q.h).toFixed(1);
      if (ex[k].length < 6) ex[k].push(`${Math.round(b.x)},${Math.round(b.z)} ${Math.round(f * 100)}% a ${Math.round(aA)}/${Math.round(aB)} h ${hh(b)}/${hh(o)} ${(b.kw && b.kw.name) || '-'} | ${(o.kw && o.kw.name) || '-'}`);
    }
  }
  return JSON.stringify({ footprints: n, log, pairs, ex }, null, 1);
})()
