// Auto KW: a hash of what world.cropAt says stands, and of the crop tiles
// crops.js builds from it, over a band that runs from Uptown out into the
// fields (town, the edge of town and the township parcels). For a speed-up
// of cropAt / _tile that must not change a plant: two builds that print the
// same hashes stand the same crop in every cell.
//   VIEW_PROBE_FILE=tools/kw/cropprobe.js AUTO_PHONE=1 AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     node tools/kw/kwshots.mjs /tmp/x
(() => {
  const d = window.__dbg, W = d.world, C = d.crops;
  let h1 = 0, n1 = [0, 0, 0], k = 1;
  // 1. cropAt on a 9 m lattice across 12 km x 1.2 km, west of Uptown into the country
  for (let z = -1800; z < -600; z += 9.1) {
    for (let x = -14000; x < -2000; x += 9.3) {
      const c = W.cropAt(x, z);
      n1[c]++;
      h1 = (h1 + c * k) % 1e9; k = (k * 31 + 7) % 1000003;
    }
  }
  // 2. the tiles themselves (the cut record and the land tests too), a 40 x 8 block of them
  let h2 = 0, cells = 0;
  if (C) {
    const saved = C.tiles; C.tiles = new Map();
    try {
      const K = C.constructor, keys = new Map();
      for (let x = -14000; x < -2000; x += 150) for (let z = -1500; z < -900; z += 40) {
        const [iu, iw] = K.cellOf(x, z), ti = Math.floor(iu / 16), tj = Math.floor(iw / 12);
        keys.set(ti * 100000 + tj, [ti, tj]);
      }
      for (const [ti, tj] of keys.values()) {
        const t = C._tile(ti, tj);
        cells += t.n;
        for (let i = 0; i < t.type.length; i++) h2 = (h2 * 3 + t.type[i] * 7 + t.cut[i] + Math.round(t.y[i] * 100)) % 1000000007;
      }
    } finally { C.tiles = saved; C.dirty = true; }
  }
  return `cropAt: ${n1[0]} none / ${n1[1]} corn / ${n1[2]} soy, hash ${h1}; tiles: ${cells} standing cells, hash ${h2}`;
})()
