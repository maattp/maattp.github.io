// Auto KW: stop bars that land inside a junction (junctions.js Painter.stopBar).
//
//   VIEW_PROBE_FILE=tools/kw/stopbars.js node tools/kw/kwshots.mjs /tmp/x
//
// For every signal / stop / yield approach, the bar it paints (its centre and
// its two ends, across the approach's lanes at A.back from the node) is
// tested against the junction polygons of the controller's OTHER nodes (a
// divided road's crossing is 2-4 nodes) and against every other carriageway
// that crosses it (not parallel, not the approach's own edge). A bar inside
// another node's polygon, or across another street's lanes, is a stray: it
// is painted in the middle of the intersection. Prints counts by kind and
// the first examples (with a camera for kwshots), so a before/after is
// `stray` on master against this.
(() => {
  const d = window.__dbg, c = d.city, jc = c.jc;
  if (!jc) return 'no junctions';
  const inPoly = (poly, x, z) => {
    let ins = false;
    for (let i = 0, j = poly.length / 2 - 1; i < poly.length / 2; j = i++) {
      const xi = poly[2 * i], zi = poly[2 * i + 1], xj = poly[2 * j], zj = poly[2 * j + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
    }
    return ins;
  };
  const onOther = (x, z, A) => {
    for (const ei of c.edgesNear(x, z, 25)) {
      if (ei === A.ei) continue;
      const e = c.edges[ei];
      if (e.elev || e.tunnel) continue;
      if (Math.abs(e.dx * A.ux + e.dz * A.uz) > 0.7) continue;      // (a parallel lane of the same road)
      const a = c.nodes[e.a];
      const t = (x - a.x) * e.dx + (z - a.z) * e.dz;
      if (t < 1 || t > e.len - 1) continue;                          // (its mouth: the junction's)
      const off = Math.abs((x - a.x) * -e.dz + (z - a.z) * e.dx);
      if (off < e.hw - 0.3) return ei;
    }
    return -1;
  };
  const out = { approaches: 0, stray: 0, inPoly: 0, onOther: 0, byKind: {}, ex: [] };
  for (const C of jc.list) {
    if (!C.appr) continue;
    for (const A of C.appr.values()) {
      if (A.kind === 'go' && C.k !== 1) continue;
      out.approaches++;
      const n = c.nodes[A.ni], back = A.back;
      const cx = n.x - A.ux * (back - 0.25), cz = n.z - A.uz * (back - 0.25);
      let why = null;
      for (const nj of C.nodes || []) {
        if (nj === A.ni) continue;
        const J = c.junction ? c.junction(nj) : null;
        if (J && J.poly && J.poly.length >= 6 && inPoly(J.poly, cx, cz)) { why = 'poly'; break; }
      }
      const oe = why ? -1 : onOther(cx, cz, A);
      if (!why && oe >= 0) why = 'street';
      if (!why) continue;
      out.stray++;
      out[why === 'poly' ? 'inPoly' : 'onOther']++;
      const k = ['', 'sig', 'stop', 'rb', 'mini'][C.k] || C.k;
      out.byKind[k] = (out.byKind[k] || 0) + 1;
      if (out.ex.length < 12) out.ex.push({ C: C.id, k, why, A: A.id, ei: A.ei, ni: A.ni, back: +back.toFixed(1), at: [+cx.toFixed(1), +cz.toFixed(1)], other: oe,
        view: { name: `bar-${C.id}-${A.id}`, c: [+(cx - A.ux * 22 - A.uz * 2).toFixed(1), +(cz - A.uz * 22 + A.ux * 2).toFixed(1), 6], t: [+(cx + A.ux * 6).toFixed(1), +(cz + A.uz * 6).toFixed(1), 0], fov: 55 } });
    }
  }
  return JSON.stringify(out, null, 1);
})()
