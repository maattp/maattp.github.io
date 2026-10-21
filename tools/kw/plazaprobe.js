// Every plaza in data/shops.json, audited on the booted world: for kwshots.mjs VIEW_PROBE_FILE.
//
//   VIEW_PROBE_FILE=tools/kw/plazaprobe.js AUTO_GPU=1 node tools/kw/kwshots.mjs /tmp/x
//
// One line a plaza: the buildings inside its outline by how they are drawn
// (strip = kwshops' arcade, big = a big box, unit = a stand-alone LCBO/Beer
// Store, poly = kw.js's polygon, fam = a kw.js look, kws = another kw skip,
// PLAIN = world.js's default box: the "white box" to look for), the share of
// its open ground that is painted car park (G.lotAt), and its stores drawn /
// listed. window.__ppOnly = 'Sunrise' narrows it to plazas whose name matches.
(async () => {
  const d = window.__dbg, city = d.city, G = d.G;
  const S = await (await fetch('data/shops.json')).json();
  const built = (window.__kwShops && window.__kwShops.built) || [];
  const inPoly = (p, x, z) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    }
    return c;
  };
  const out = [];
  S.plazas.forEach((P, pi) => {
    if (window.__ppOnly && !new RegExp(window.__ppOnly, 'i').test(P.n)) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of P.o) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    const cnt = { strip: 0, big: 0, unit: 0, poly: 0, fam: 0, kws: 0, PLAIN: 0 };
    const plain = [];
    for (const b of city.buildingsNear((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 20)) {
      const k = b.kw || {};
      if (!inPoly(P.o, b.x, b.z) || (b.h <= 0 && !k.poly)) continue;
      if (k.shop && k.shop.fmt === 'strip') cnt.strip++;
      else if (k.shop && k.shop.fmt === 'bigbox') cnt.big++;
      else if (k.shop && k.shop.fmt === 'unit') cnt.unit++;
      else if (k.poly) cnt.poly++;
      else if (k.fam) cnt.fam++;
      else if (k.skip) cnt.kws++;
      else { cnt.PLAIN++; plain.push(`${Math.round(b.w)}x${Math.round(b.d)}x${Math.round(b.h)}${k.strip ? 's' : ''}@${Math.round(b.x)},${Math.round(b.z)}`); }
    }
    let open = 0, lot = 0;
    for (let x = x0 + 4; x < x1; x += 8) for (let z = z0 + 4; z < z1; z += 8) {
      if (!inPoly(P.o, x, z) || city.onRoad(x, z, 0, false)) continue;
      if (city.buildingsNear(x, z, 1).some((b) => b.h > 0 && Math.abs((x - b.x) * Math.cos(b.rot) + (z - b.z) * Math.sin(b.rot)) < b.w / 2 && Math.abs(-(x - b.x) * Math.sin(b.rot) + (z - b.z) * Math.cos(b.rot)) < b.d / 2)) continue;
      open++;
      if (G.lotAt(x, z) >= 0) lot++;
    }
    const st = built.filter((s) => s.plaza === pi);
    out.push(`${pi} ${P.n} @${Math.round(P.x)},${Math.round(P.z)} | ${Object.entries(cnt).filter(([, v]) => v).map(([k, v]) => k + ' ' + v).join(', ')}` +
      ` | lot ${open ? Math.round((100 * lot) / open) : 0}% | stores ${st.filter((s) => s.drawn).length}/${st.length} ${st.filter((s) => !s.drawn).map((s) => '!' + s.k).join(' ')}` +
      (plain.length ? ` | plain: ${plain.slice(0, 6).join(' ')}` : ''));
  });
  const loose = built.filter((s) => s.plaza < 0 && !s.drawn).map((s) => `${s.k}@${Math.round(s.x)},${Math.round(s.z)}`);
  return out.join('\n') + `\nundrawn outside plazas (${loose.length}): ${loose.join(' ')}\natlas ${JSON.stringify(window.__kwShops && window.__kwShops.stats.atlas)} tenants ${window.__kwShops && window.__kwShops.stats.tenants} independents ${JSON.stringify(window.__kwShops && window.__kwShops.stats.independents)} tris ${window.__kwShops && window.__kwShops.stats.tris}`;
})()
