// The storefronts outside the plazas (shops.json `fronts`), audited on the booted world:
// for kwshots.mjs VIEW_PROBE_FILE.
//
//   VIEW_PROBE_FILE=tools/kw/frontprobe.js AUTO_PHONE=1 node tools/kw/kwshots.mjs /tmp/x
//   (VIEW_BOOT_JS='window.__fpBox = [x0, z0, x1, z1]' narrows it to a box; the default
//   is Hespeler Rd, Highway 401 to Dundas St)
//
// One line a front: its kind (s strip, f food pad, b bank, a auto service,
// k gas kiosk, c dealer), DRAWN (kwshops draws it), else why not -- `out`
// (no footprint cluster there to merge into: prepShops' extents), `poly` /
// `fam` / `skip` / `shop` (another drawer has the box), `style` (a house or
// a tower), `size` -- and its tenants. Then the totals, the lettering and
// the two atlases' sizes.
(async () => {
  const d = window.__dbg, city = d.city;
  const S = await (await fetch('data/shops.json')).json();
  const [x0, z0, x1, z1] = window.__fpBox || [11600, 4100, 12900, 8800];
  const boxAt = (x, z, pad) => {
    let best = null, ba = Infinity;
    for (const b of city.buildingsNear(x, z, 60)) {
      const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.x, dz = z - b.z;
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(lz) <= b.d / 2 + pad && b.w * b.d < ba) { best = b; ba = b.w * b.d; }
    }
    return best;
  };
  const lines = [], tot = {};
  S.fronts.forEach((F, fi) => {
    const [bx, bz, kind, sh, who] = F;
    if (bx < x0 || bx > x1 || bz < z0 || bz > z1) return;
    const b = boxAt(bx, bz, 1);
    const k = (b && b.kw) || {};
    let why = 'DRAWN';
    if (!b) why = 'nobox';
    else if (!(k.shop && k.shop.front === fi)) {
      why = k.poly ? 'poly' : k.fam ? 'fam' : k.shop ? 'shop:' + k.shop.fmt : k.skip ? 'skip' : (b.h > 12.5 || b.h < 2.5) ? `h${b.h.toFixed(0)}` : /brick|lowrise|industrial|house/.test(b.style) ? 'out' : 'style:' + b.style;
    }
    tot[why] = (tot[why] || 0) + 1;
    lines.push(`${String(fi).padStart(4)} ${kind} ${why.padEnd(6)} @${Math.round(bx)},${Math.round(bz)} ${b ? `${Math.round(b.w)}x${Math.round(b.d)}x${b.h.toFixed(1)} ${b.style}` : ''} ${who || ''} | ${sh.map((q) => q[0]).join(', ')}`);
  });
  const st = window.__kwShops && window.__kwShops.stats;
  return lines.join('\n') + `\n${JSON.stringify(tot)}\nfronts drawn map-wide ${JSON.stringify(st && st.fronts)} lettering ${JSON.stringify(st && st.independents)}\natlas ${JSON.stringify(st && st.atlas)}`;
})()
