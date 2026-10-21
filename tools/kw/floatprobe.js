// Geometry floating in the air, for kwshots.mjs VIEW_PROBE_FILE: every small
// piece of the landmark clusters (and the streamed chunks round the box) whose
// bottom is well over the ground with nothing under it to stand on.
//
//   VIEW_PROBE_FILE=tools/kw/floatprobe.js node tools/kw/kwshots.mjs /tmp/x
//   (VIEW_BOOT_JS='window.__flBox = [x0, z0, x1, z1]' sets the box; the default
//   is 600 m round 561 Hespeler Rd)
//
// A piece is a run of triangles sharing vertices (one quad, one box). It is
// reported when it is under 6 m across, its lowest point is over 3 m above the
// terrain, and no building box (city.buildingsNear) under it reaches within
// 2 m of that point -- with its world position, size, height over the ground,
// colour (vertex colour, linear) and the mesh's name/material.
(async () => {
  const d = window.__dbg, city = d.city, G = d.G;
  const [x0, z0, x1, z1] = window.__flBox || [11800, 5100, 12400, 5700];
  for (let i = 0; i < 400; i++) { d.world.update((x0 + x1) / 2, (z0 + z1) / 2, 2); if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0)); }
  const out = [];
  const v = new d.THREE.Vector3();
  const roots = [d.lmRoot, d.scene];
  const seen = new Set();
  const visit = (m) => {
    if (seen.has(m) || !m.isMesh || m.isInstancedMesh || !m.geometry || !m.geometry.attributes.position) return;
    seen.add(m);
    m.updateMatrixWorld(true);
    const g = m.geometry, P = g.attributes.position, C = g.attributes.color, I = g.index;
    if (!I || P.count > 400000) return;
    // a cheap reject: the mesh's world bounds against the box
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox.clone().applyMatrix4(m.matrixWorld);
    if (bb.max.x < x0 || bb.min.x > x1 || bb.max.z < z0 || bb.min.z > z1) return;
    // union-find over vertices by triangle
    const n = P.count, par = new Int32Array(n);
    for (let i = 0; i < n; i++) par[i] = i;
    const f = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const ix = I.array;
    for (let t = 0; t < ix.length; t += 3) { const a = f(ix[t]), b = f(ix[t + 1]), c = f(ix[t + 2]); par[b] = a; par[c] = a; }
    const W = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z; }
    const pcs = new Map();
    for (let i = 0; i < n; i++) {
      const r = f(i);
      let p = pcs.get(r);
      if (!p) pcs.set(r, (p = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity, i }));
      const x = W[i * 3], y = W[i * 3 + 1], z = W[i * 3 + 2];
      if (x < p.x0) p.x0 = x; if (x > p.x1) p.x1 = x; if (y < p.y0) p.y0 = y; if (y > p.y1) p.y1 = y; if (z < p.z0) p.z0 = z; if (z > p.z1) p.z1 = z;
    }
    for (const p of pcs.values()) {
      const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      if (cx < x0 || cx > x1 || cz < z0 || cz > z1) continue;
      if (p.x1 - p.x0 > 6 || p.z1 - p.z0 > 6) continue;
      const gy = G.terrainHeight(cx, cz), up = p.y0 - gy;
      if (up < 3) continue;
      let held = false;
      for (const b of city.buildingsNear(cx, cz, 160)) {
        const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = cx - b.x, dz = cz - b.z;
        const lx = dx * c + dz * s, lz = -dx * s + dz * c;
        if (Math.abs(lx) < b.w / 2 + 2 && Math.abs(lz) < b.d / 2 + 2 && b.y + b.h + 2.5 >= p.y0) { held = true; break; }
        if (b.kw && b.kw.poly && b.kw.poly.pts) {
          const pts = b.kw.poly.pts; let inn = false;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i][1] > cz) !== (pts[j][1] > cz) && cx < ((pts[j][0] - pts[i][0]) * (cz - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) inn = !inn;
          if (inn) { held = true; break; }
        }
      }
      if (held) continue;
      const col = C ? [C.getX(p.i), C.getY(p.i), C.getZ(p.i)].map((q) => +q.toFixed(2)) : null;
      out.push(`${m.name || m.parent && m.parent.name || '?'} ${m.material && m.material.type} @${cx.toFixed(1)},${cz.toFixed(1)} ${(p.x1 - p.x0).toFixed(1)}x${(p.y1 - p.y0).toFixed(1)}x${(p.z1 - p.z0).toFixed(1)} ${up.toFixed(1)} m up col ${JSON.stringify(col)}`);
    }
  };
  for (const r of roots) r.traverse(visit);
  return out.length + ' floating pieces\n' + out.slice(0, 80).join('\n');
})()
