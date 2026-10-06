// An expression (boottime.mjs BOOT_PROBE via $(cat), memprobe MEM_PROBE_FILE)
// that hashes every Link and freight chunk mesh's arrays, by mesh name: the
// lazy chunks (build.js LazyChunks) must make the arrays the eager pass made.
// Run on the desktop profile (a phone drops arrays once drawn). Builds every
// lazy chunk first where the build has them.
(() => {
  const d = window.__dbg;
  for (const s of [d.link, d.freight]) if (s.buildAllChunks) s.buildAllChunks();
  const meshes = [];
  for (const g of [d.link.group, d.link.tunGroup, d.freight.group, d.freight.tunGroup]) {
    for (const m of g.children) if (m.isMesh && /^(link|freight):/.test(m.name) && !/train|yard/.test(m.name)) meshes.push(m);
  }
  meshes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let h = 2166136261, bytes = 0, missing = 0;
  const mixU32 = (u) => { h ^= u; h = Math.imul(h, 16777619) >>> 0; };
  for (const m of meshes) {
    for (let i = 0; i < m.name.length; i++) mixU32(m.name.charCodeAt(i));
    const g = m.geometry;
    for (const k of ['position', 'normal', 'color', 'uv']) {
      const a = g.attributes[k];
      if (!a) { mixU32(7); continue; }
      if (!a.array) { missing++; continue; }
      const u = new Uint32Array(a.array.buffer, a.array.byteOffset, a.array.byteLength >> 2);
      for (let i = 0; i < u.length; i++) mixU32(u[i]);
      bytes += a.array.byteLength;
    }
    const I = g.index ? g.index.array : null;
    if (I) { for (let i = 0; i < I.length; i++) mixU32(I[i]); bytes += I.byteLength; }
  }
  return `rail meshes ${meshes.length}, ${(bytes / 1e6).toFixed(1)} MB, missing arrays ${missing}, hash ${h.toString(16)}`;
})()
