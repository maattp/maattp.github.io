// Every storefront outside the plazas (shops.json `fronts`), map-wide, by what draws it --
// the count of stores still drawn as world.js's plain boxes, and of stores with a sign.
// For kwshots.mjs VIEW_PROBE_FILE (runs on master too):
//
//   VIEW_PROBE_FILE=tools/kw/storeprobe.js AUTO_PHONE=1 node tools/kw/kwshots.mjs /tmp/x
//
// PLAIN: the box is world.js's generic building (brick / lowrise / industrial: a 9 m office
// or a white tilt-up box) and nothing else draws it or signs it. HOUSE / FARM: a store in a
// house or a farm building, drawn as that (FARM signed: kwshops `kw.sign`). KWSHOPS: kwshops
// draws it (RURAL: in its own range-culled 'kwr:' cluster, MARKET: as a farm market). Then
// the signs: stores whose name is lettered, and the 'kwr:' clusters (meshes, triangles).
// window.__spList = true lists the PLAIN ones.
(async () => {
  const d = window.__dbg, city = d.city;
  const S = await (await fetch('data/shops.json')).json();
  const boxAt = (x, z, pad) => {
    let best = null, ba = Infinity;
    for (const b of city.buildingsNear(x, z, 60)) {
      const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.x, dz = z - b.z;
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(lz) <= b.d / 2 + pad && b.w * b.d < ba) { best = b; ba = b.w * b.d; }
    }
    return best;
  };
  const tot = {}, list = [];
  const add = (k) => { tot[k] = (tot[k] || 0) + 1; };
  S.fronts.forEach((F, fi) => {
    const [bx, bz, kind, sh, who] = F;
    const b = boxAt(bx, bz, 1);
    const k = (b && b.kw) || {};
    let c;
    if (!b) c = 'nobox';
    else if (k.shop && k.shop.front === fi) c = k.shop.market ? 'KWSHOPS-MARKET' : k.shop.rk ? 'KWSHOPS-RURAL' : 'KWSHOPS';
    else if (k.sign && k.sign.front === fi) c = 'FARM-signed';
    else if (k.shop || k.poly || k.skip || k.fam) c = 'other-drawer';
    else if (/barn|shed|silo|farmhouse|church/.test(b.style)) c = 'FARM';
    else if (b.style === 'house') c = 'HOUSE';
    else if (/brick|lowrise|industrial/.test(b.style)) { c = 'PLAIN'; list.push(`${fi} ${kind} @${Math.round(bx)},${Math.round(bz)} ${Math.round(b.w)}x${Math.round(b.d)}x${b.h.toFixed(1)} ${b.style} ${who || ''} | ${sh.map((q) => q[0]).join(', ')}`); }
    else c = 'style:' + b.style;
    add(c);
  });
  const st = (window.__kwShops && window.__kwShops.stats) || {};
  let meshes = 0, tris = 0;
  for (const n of (d.lmRoot && d.lmRoot.userData.near) || []) {
    if (!/kwr:/.test(n.o.name)) continue;
    meshes++;
    const g = n.o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  const plain = tot.PLAIN || 0;
  return `fronts ${S.fronts.length} ${JSON.stringify(tot)}\nPLAIN boxes ${plain}\n` +
    `signed: independents ${JSON.stringify(st.independents && st.independents.signed)} of ${st.independents && st.independents.of}, farm signs ${st.farmSigns || 0}, boards ${st.boards || 0}, markets ${st.markets || 0}, rural fronts ${st.rural || 0}\n` +
    `kwr clusters: ${meshes} meshes, ${Math.round(tris)} tris; kwshops tris ${st.tris}\n` +
    (window.__spList ? list.join('\n') : '');
})()
