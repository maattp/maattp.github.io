// VIEW_PRE_FILE for kwshots.mjs: window.__ssView(a, b, x, z, opts) frames a
// driver's-eye view of the street-name signs at the corner of streets a and b
// (OSM names; a prefix is enough) nearest (x, z). Used by
// tools/kw/streetsignviews.json:
//   VIEW_PRE_FILE=tools/kw/streetsignpre.js VIEWS=tools/kw/streetsignviews.json \
//     node tools/kw/kwshots.mjs <dir>
// opts: { arm: <name prefix of the street the camera is on>, back: m from the
// centre (default 34), lane: m right of the centreline (2), over: true to look
// at the mast-arm sign instead of a post }
(() => {
  const d = window.__dbg;
  window.__ssFind = (a, b, x, z) => {
    const S = d.streetSigns || d.city.streetSigns;
    let best = null, bd = Infinity;
    const C = 400;
    for (let cx = Math.floor((x - 1200) / C); cx <= Math.floor((x + 1200) / C); cx++) {
      for (let cz = Math.floor((z - 1200) / C); cz <= Math.floor((z + 1200) / C); cz++) {
        for (const s of S.sitesIn(cx, cz)) {
          if (!s.names.some((n) => n.startsWith(a)) || !s.names.some((n) => n.startsWith(b))) continue;
          const dd = (s.x - x) ** 2 + (s.z - z) ** 2;
          if (dd < bd) { bd = dd; best = s; }
        }
      }
    }
    return best;
  };
  window.__ssView = (a, b, x, z, o = {}) => {
    const s = window.__ssFind(a, b, x, z);
    if (!s) return { c: [x, z, 1.4], t: [x + 10, z, 1.4], fov: 55 };
    const onArm = s.arms.find((q) => q.name.startsWith(o.arm || b)) || s.arms[0];
    const back = o.back || 34, lane = o.lane === undefined ? 2 : o.lane;
    // the camera on that street, short of the junction, in the right lane
    const rx = onArm.dz, rz = -onArm.dx;   // right of a driver heading in (-dx, -dz)
    const cx = s.x + onArm.dx * back + rx * lane, cz = s.z + onArm.dz * back + rz * lane;
    let tx = s.x, tz = s.z, th = 2.7;
    if (o.over && s.over && s.over.length) {
      let bo = null, bv = -Infinity;
      for (const q of s.over) { const v = -(q.fx * onArm.dx + q.fz * onArm.dz); if (-v > bv) { bv = -v; bo = q; } }
      tx = bo.x; tz = bo.z; th = 6.1;
    } else if (s.posts.length) {
      let bp = s.posts[0], bv = Infinity;
      for (const p of s.posts) { const v = (p.x - cx) ** 2 + (p.z - cz) ** 2; if (v < bv) { bv = v; bp = p; } }
      tx = bp.x; tz = bp.z; th = bp.blades.length ? bp.blades[0].y - d.city.groundAt(bp.x, bp.z, null) : 2.7;
    }
    if (o.close && s.posts.length) {
      // a close look: from the corner's side of the post, `close` m off, along
      // blade `o.blade`'s face normal (toward the junction's middle)
      const p = s.posts[o.post || 0], b = p.blades[o.blade || 0] || p.blades[0];
      let nx = -b.az, nz = b.ax;
      if ((s.x - p.x) * nx + (s.z - p.z) * nz < 0) { nx = -nx; nz = -nz; }
      const g = d.city.groundAt(p.x, p.z, null);
      window.__ssLast = { names: s.names, style: s.style, posts: s.posts.length };
      return { c: [p.x + nx * o.close + b.ax * 1.5, p.z + nz * o.close + b.az * 1.5, b.y - g - 0.4], t: [p.x, p.z, b.y - g + 0.05], fov: o.fov || 40 };
    }
    window.__ssLast = { names: s.names, style: s.style, posts: s.posts.length, over: (s.over || []).length, x: s.x, z: s.z };
    return { c: [cx, cz, o.h || 1.3], t: [tx, tz, th], fov: o.fov || 50 };
  };
})();
