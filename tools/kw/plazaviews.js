// Street-level camera views of plazas, for kwshots.mjs VIEWS: run as VIEW_PROBE_FILE,
// it prints a views JSON (save it, then pass it as VIEWS=).
//
//   VIEW_BOOT_JS='window.__pvOnly="Sunrise|Pioneer"' VIEW_PROBE_FILE=tools/kw/plazaviews.js \
//     AUTO_GPU=1 node tools/kw/kwshots.mjs /tmp/x | sed -n '/^\[/p' > views.json
//
// For each plaza (data/shops.json) whose name matches window.__pvOnly (all when unset):
// its longest storefront kwshops draws (a strip's arcade, a big box's front),
// from the car park 28-70 m out at eye height -- "pv-<i>-<name>" -- and an
// oblique from 150 m up -- "pa-<i>-<name>".
(async () => {
  const d = window.__dbg, city = d.city;
  const S = await (await fetch('data/shops.json')).json();
  const inPoly = (p, x, z) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    }
    return c;
  };
  const FN = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const V = [];
  S.plazas.forEach((P, pi) => {
    if (window.__pvOnly && !new RegExp(window.__pvOnly, 'i').test(P.n)) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of P.o) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    let best = null, bf = -1, bl = -1;
    for (const b of city.buildingsNear((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 20)) {
      if (!inPoly(P.o, b.x, b.z) || (b.h <= 0 && !(b.kw && b.kw.poly))) continue;
      const sh = b.kw && b.kw.shop;
      const fi = sh && sh.fmt === 'strip' && b.kw.strip ? b.kw.strip.face : sh && sh.front !== undefined ? sh.front : -1;
      const len = fi < 0 ? 0 : fi < 2 ? b.d : b.w;
      const score = fi < 0 ? b.w * b.d * 1e-4 : len + 1;
      if (score > bl) { bl = score; best = b; bf = fi; }
    }
    // a store kw.js draws from its outline (an L- or U-shaped plaza): its longest wall facing a lot
    let pf = null;
    for (const b of city.buildingsNear((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 20)) {
      const Pp = b.kw && b.kw.poly;
      if (!Pp || !Pp.retail || b.kw.skip || !Pp.pts.some((q) => inPoly(P.o, q[0], q[1]) || Math.hypot(q[0] - P.x, q[1] - P.z) < 150)) continue;
      const pts = Pp.pts;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (L < 10) continue;
        let nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L;
        const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
        if (inPoly(pts, mx + nx * 0.6, mz + nz * 0.6)) { nx = -nx; nz = -nz; }
        if (d.G.lotAt(mx + nx * 12, mz + nz * 12) < 0) continue;
        if (L + 1 > bl && (!pf || L > pf.L)) pf = { L, mx, mz, nx, nz };
      }
    }
    const nm = P.n.replace(/[^A-Za-z]/g, '').slice(0, 16);
    if (pf) {
      const D = Math.max(28, Math.min(70, pf.L * 0.55)), ux = pf.nz, uz = -pf.nx;
      V.push({ name: `pv-${pi}-${nm}`, c: [+(pf.mx + pf.nx * D + ux * D * 0.35).toFixed(1), +(pf.mz + pf.nz * D + uz * D * 0.35).toFixed(1), 2.2],
        t: [+pf.mx.toFixed(1), +pf.mz.toFixed(1), 3.6], fov: 60 });
      V.push({ name: `pa-${pi}-${nm}`, c: [+(P.x + pf.nx * 230).toFixed(1), +(P.z + pf.nz * 230).toFixed(1), 150], t: [P.x, P.z, 0], fov: 55 });
      return;
    }
    if (!best) return;
    const b = best, c = Math.cos(b.rot), s = Math.sin(b.rot);
    const fi = bf < 0 ? 2 : bf;
    const [nx0, nz0] = FN[fi], hl = fi < 2 ? b.w / 2 : b.d / 2, len = fi < 2 ? b.d : b.w;
    const nx = nx0 * c - nz0 * s, nz = nx0 * s + nz0 * c, ux = nz, uz = -nx;
    const D = Math.max(28, Math.min(70, len * 0.55));
    const fx = b.x + nx * hl, fz = b.z + nz * hl;
    V.push({ name: `pv-${pi}-${nm}`, c: [+(fx + nx * D + ux * D * 0.35).toFixed(1), +(fz + nz * D + uz * D * 0.35).toFixed(1), 2.2],
      t: [+fx.toFixed(1), +fz.toFixed(1), 3.6], fov: 60 });
    V.push({ name: `pa-${pi}-${nm}`, c: [+(P.x + nx * 230).toFixed(1), +(P.z + nz * 230).toFixed(1), 150], t: [P.x, P.z, 0], fov: 55 });
  });
  return JSON.stringify(V);
})()
