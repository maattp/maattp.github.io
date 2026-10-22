// Auto KW: how each freeway ramp's pavement meets the main line's beside it
// (CLAUDE.md "The freeways, round five"). For every graded one-way ramp edge,
// every profile sample: the ramp's edge on the side toward the nearest
// parallel main-line carriageway at its level, against that carriageway's
// PAVED edge (tw). gap > 0 is ground showing between the two pavements (the
// "slot"), gap < 0 the ramp's band lying over the main line's pavement (the
// gore band across the lanes). Run:
//   VIEW_PROBE_FILE=tools/kw/goreprobe.js node tools/kw/kwshots.mjs /tmp/x
// window.__gp = { list: 20 } before (VIEW_BOOT_JS) for more worst sites.
(() => {
  const d = window.__dbg, city = d.city, E = city.edges, N = city.nodes;
  const opt = window.__gp || {};
  const isMain = (e) => e.cls === 'hwy' && e.oneway && !e.tunnel && e.prof && !e.elev;
  const isRamp = (e) => e.cls === 'ramp' && e.oneway && !e.tunnel && e.prof && !e.elev;
  const C = 40, grid = new Map();
  E.forEach((e, ei) => {
    if (!isMain(e)) return;
    const a = N[e.a], b = N[e.b];
    for (let s = 0; s <= e.len; s += 10) {
      const x = a.x + e.dx * s, z = a.z + e.dz * s;
      const k = `${Math.floor(x / C)},${Math.floor(z / C)}`;
      let l = grid.get(k); if (!l) grid.set(k, (l = new Set())); l.add(ei);
    }
    const k = `${Math.floor(b.x / C)},${Math.floor(b.z / C)}`;
    let l = grid.get(k); if (!l) grid.set(k, (l = new Set())); l.add(ei);
  });
  const near = (x, z) => {
    const out = new Set();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = grid.get(`${Math.floor(x / C) + i},${Math.floor(z / C) + j}`);
      if (l) for (const q of l) out.add(q);
    }
    return out;
  };
  const yAt = (e, t, o) => { const P = city.profAt(e, t); return P.h + P.s * o; };
  let bridgedLen = 0, overlapM2 = 0, overlapLen = 0, slotLen = 0, slotM2 = 0, stepLen = 0, gores = 0, rampsNear = 0;
  const sites = [];
  E.forEach((e, ei) => {
    if (!isRamp(e)) return;
    if (e.gore) gores++;
    const k = e.pk, a = N[e.a], px = -e.dz, pz = e.dx, seg = e.len / k;
    let touched = false;
    for (let i = 0; i <= k; i++) {
      const t = i / k, cx = a.x + e.dx * e.len * t, cz = a.z + e.dz * e.len * t;
      const yc = e.ph[i];
      let best = null;
      for (const oi of near(cx, cz)) {
        const o = E[oi], oa = N[o.a];
        if (Math.abs(o.dx * e.dx + o.dz * e.dz) < 0.8) continue;
        const u = ((cx - oa.x) * o.dx + (cz - oa.z) * o.dz) / o.len;
        if (u < 0 || u > 1) continue;
        const fx = oa.x + o.dx * o.len * u, fz = oa.z + o.dz * o.len * u;
        const lc = (cx - fx) * -o.dz + (cz - fz) * o.dx;   // ramp centre, +p of o
        if (Math.abs(lc) > 30) continue;
        const so = lc >= 0 ? 0 : 1, sg = so === 0 ? 1 : -1;
        const j = Math.min(o.pk, Math.max(0, Math.round(u * o.pk)));
        const mEdge = o.tw[j * 2 + so];
        // the ramp's side toward o's centre line
        const toward = (-sg * -o.dz) * px + (-sg * o.dx) * pz >= 0 ? 0 : 1;   // ramp side whose normal points at o
        const rs = toward === 0 ? 1 : -1;
        const rw = e.tw[i * 2 + toward];
        const ex = cx + px * rs * rw, ez = cz + pz * rs * rw;
        const le = ((ex - fx) * -o.dz + (ez - fz) * o.dx) * sg;   // the ramp's inner edge, out from o's centre
        const yr = yC(e, t, rs * rw), ym = yAt(o, u, sg * mEdge);
        if (Math.abs(yr - ym) > 1.5) continue;
        const gap = le - mEdge;
        const bridged = !!(e.meetG && e.meetG[i * 2 + toward]);
        if (!best || Math.abs(lc) < best.ad) best = { ad: Math.abs(lc), gap, dy: yr - ym, oi, x: ex, z: ez, wide: e.tw[i * 2] + e.tw[i * 2 + 1], bridged, c: Math.abs(o.dx * e.dx + o.dz * e.dz) };
      }
      if (!best) continue;
      touched = true;
      const w = i === 0 || i === k ? seg / 2 : seg;
      if (best.gap < -0.05) { overlapLen += w; overlapM2 += Math.min(-best.gap, best.wide) * w; }
      else if (best.bridged) bridgedLen += w;
      else if (best.gap > 0.05 && best.gap < 2) {
        slotLen += w; slotM2 += best.gap * w;
        if (Math.abs(best.dy) > 0.15) stepLen += w;
      }
      if ((best.gap < -0.3 || (best.gap > 0.05 && best.gap < 2 && !best.bridged)) && i % 4 === 0) sites.push({ ei, i, gore: !!e.gore, x: Math.round(best.x), z: Math.round(best.z), gap: +best.gap.toFixed(2), dy: +best.dy.toFixed(2), cos: +best.c.toFixed(2) });
    }
    if (touched) rampsNear++;
  });
  function yC(e, t, o) { return yAt(e, t, o); }
  sites.sort((p, q) => Math.abs(q.gap) - Math.abs(p.gap));
  return JSON.stringify({
    gores, rampsNear,
    overlap: { m: Math.round(overlapLen), m2: Math.round(overlapM2) },
    slot: { m: Math.round(slotLen), m2: Math.round(slotM2), stepped: Math.round(stepLen) }, bridged: Math.round(bridgedLen),
    worstOverlap: sites.filter((s) => s.gap < 0).slice(0, opt.list || 10),
    worstSlot: sites.filter((s) => s.gap > 0).sort((p, q) => p.gap - q.gap).slice(0, opt.list || 10),
    slotGaps: (() => { const h = {}; for (const s of sites) if (s.gap > 0) { const b = s.gap.toFixed(1); h[b] = (h[b] || 0) + 1; } return h; })(),
    stats: { goreNodesMoved: d.cityStats.goreNodesMoved, rampMeet: d.cityStats.rampMeet },
  }, null, 1);
})()
