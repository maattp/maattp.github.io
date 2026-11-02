// Helpers for the storm / spray shots (tools/kw/stormviews.json):
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 VIEW_PRE_FILE=tools/kw/stormpre.js VIEWS=tools/kw/stormviews.json \
//     node tools/kw/kwshots.mjs <dir>
// `__ss.hwy(x, z, r)` the longest highway edge near a point; `__ss.drive(cars, secs, camFn)`
// moves posed cars along their headings at fixed dt, feeding spray.js, while the game is paused
// (the spray is only updated by unpaused frames otherwise); `__ss.clear()` removes the posed cars.
window.__ss = {
  cars: [],
  hwy(x, z, r = 400, cls = 'hwy') {
    const c = __dbg.city;
    let best = null;
    for (const ei of c.edgesNear(x, z, r)) {
      const e = c.edges[ei];
      if (e.cls !== cls || e.tunnel) continue;
      const a = c.nodes[e.a];
      const mx = a.x + e.dx * e.len / 2, mz = a.z + e.dz * e.len / 2;
      const d = Math.hypot(mx - x, mz - z);
      if (!best || e.len - d * 0.2 > best.score) best = { e, a, score: e.len - d * 0.2, h: Math.atan2(e.dx, e.dz), mx, mz };
    }
    return best;
  },
  spawn(x, z, h, type, col) {
    const v = __dbg.traffic.spawnAt(x, z, h, type, col, 'apron');
    this.cars.push(v);
    if (v.trailer) this.cars.push(v.trailer);
    return v;
  },
  // cars: [{ v, sp }]; camFn(dt) poses the camera each step
  drive(list, secs, camFn) {
    const dt = 1 / 30, S = __dbg.spray;
    for (let i = 0; i < secs / dt; i++) {
      for (const o of list) {
        const v = o.v, f = v.forward;
        v.place(v.x + f.x * o.sp * dt, v.z + f.z * o.sp * dt, v.heading);
        if (v.trailer) { const t = v.trailer, ft = t.forward; t.place(t.x + ft.x * o.sp * dt, t.z + ft.z * o.sp * dt, t.heading); }
        v.vLong = o.sp; v.onGround = true;
      }
      if (camFn) camFn(dt);
      __dbg.camera.updateMatrixWorld(true);
      const vs = [];
      for (const o of list) { vs.push(o.v); if (o.v.trailer) vs.push(o.v.trailer); }
      S.update(dt, { onFoot: true }, vs, __dbg.camera);
    }
  },
  // pose the camera at c [x, z, h over ground] looking at t [x, z, h over ground]; returns the view's { c, t }
  look(c, t) {
    const d = __dbg, gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
    d.camera.position.set(c[0], gy(c[0], c[1]) + c[2], c[1]);
    d.camera.lookAt(t[0], gy(t[0], t[1]) + t[2], t[1]);
    d.camera.updateMatrixWorld(true);
    return { c, t };
  },
  clear() { for (const v of this.cars) { try { __dbg.traffic.remove(v); } catch (e) { /* gone */ } } this.cars = []; },
};
