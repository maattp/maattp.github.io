// Page side of tools/stuntjumps.mjs: evaluated in the booted game. Defines
// window.__sj. Kept in its own file so a REPL can load the same helpers.
(() => {
  const d = window.__dbg, c = d.city, G = d.G, p = d.player;
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const inBld = (x, z, pad) => {
    for (const b of c.buildingsNear(x, z, pad + 2)) {
      const cc = Math.cos(-b.rot), ss = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
      const lx = dx * cc - dz * ss, lz = dx * ss + dz * cc;
      if (Math.abs(lx) < b.w / 2 + pad && Math.abs(lz) < b.d / 2 + pad) return true;
    }
    return false;
  };
  const S = window.__sj = { mod: null, R: null };
  S.load = async () => { S.mod = await import(new URL('src/stunts.js', location.href).href); return S.mod.JUMPS.length; };
  /** Re-install ramps from defs (default: the shipped JUMPS) and redraw them. */
  S.install = (defs) => {
    const m = S.mod;
    const list = defs || m.JUMPS;
    const ramps = m.installRamps(c, list);
    const old = d.scene.getObjectByName('stuntRamps');
    if (old) { d.scene.remove(old); old.geometry.dispose(); }
    const mesh = m.buildRampMesh(c, ramps, d.world.mats.flat);
    if (mesh) d.scene.add(mesh);
    d.stunts.list = list.filter((j) => j.ramp);
    d.hud.jumps = d.stunts.list;
    return ramps.length;
  };
  /** Trees and posts already planted in a corridor (a boot plants none there; a re-install must clear them). */
  S.clearObstacles = () => {
    let n = 0;
    for (const l of c.obstacles.values()) for (let i = 0; i < l.length; i += 3) if (c.jumpClear(l[i], l[i + 1])) { l[i] = 1e7; l[i + 1] = 1e7; n++; }
    return n;
  };
  const find = (id) => d.stunts.list.find((j) => j.id === id) || S.mod.JUMPS.find((j) => j.id === id);
  /** Static checks on a jump's corridor: what is in the way of the run-up and the landing. */
  S.check = (id) => {
    const j = find(id), r = j.ramp, cl = j.clear;
    const out = { id, L: +r.L.toFixed(1), lipY: +(r.y1 + r.H).toFixed(1), y0: +r.y0.toFixed(1), run: [], land: [], ramp: [],
      closed: r.edges.map((ei) => c.edges[ei].name || c.edges[ei].cls),
      bad: r.bad.map((ei) => `${c.edges[ei].cls}:${c.edges[ei].name || ''}${c.edges[ei].elev ? ':elev' : ''}${c.edges[ei].tunnel ? ':tunnel' : ''}`) };
    const at = (u, v) => [r.x0 + r.dx * u + r.px * v, r.z0 + r.dz * u + r.pz * v];
    const tag = (x, z, list, u) => {
      const t = [];
      if (inBld(x, z, 1)) t.push('bld');
      if (G.isWater(x, z)) t.push('water');
      if (c.onRoad(x, z, 0, true)) t.push('road');
      if (c.lidAt && c.lidAt(x, z) !== null) t.push('lid');
      // a trunk or post (the ramps' own walls are barriers, and are expected)
      if (c.obstacleHit(x, z, 1.2) && !c.barrierHit(x, z, 1.2)) t.push(c.landmarkHit(x, z, 1.2) ? 'landmark' : 'tree');
      if (t.length) list.push([Math.round(u), t.join('+')]);
    };
    for (let u = cl.u0; u < 0; u += 3) for (const v of [-r.W / 2, 0, r.W / 2]) { const [x, z] = at(u, v); tag(x, z, out.run, u); }
    for (let u = 0; u <= r.L; u += 2) for (const v of [-r.W / 2 - 1.5, 0, r.W / 2 + 1.5]) { const [x, z] = at(u, v); tag(x, z, out.ramp, u); }
    for (let u = r.L + 2; u <= cl.u1; u += 3) for (const v of [-r.W / 2, 0, r.W / 2]) { const [x, z] = at(u, v); tag(x, z, out.land, u); }
    // ground profile relative to the lip base, every 10 m past the lip
    out.prof = [];
    for (let u = r.L; u <= cl.u1; u += 10) { const [x, z] = at(u, 0); out.prof.push(+(c.groundAt(x, z, null) - r.y1).toFixed(1)); }
    // compress runs of the same tag
    for (const k of ['run', 'land', 'ramp']) {
      const a = out[k], o = [];
      for (const [u, t] of a) { const q = o[o.length - 1]; if (q && q[2] === t && u - q[1] <= 3) q[1] = u; else o.push([u, u, t]); }
      out[k] = o;
    }
    return out;
  };
  /**
   * Put the player in a car at the run-up start, pointed at the lip. `from`
   * starts that many metres before the toe instead, at `speed0`.
   */
  S.begin = (id, o = {}) => {
    const j = find(id), r = j.ramp;
    const back = o.from != null ? o.from : Math.min(Math.hypot(j.x - j.sx, j.z - j.sz) - r.L, o.maxRun || 1e9);
    const sx = r.x0 - r.dx * back, sz = r.z0 - r.dz * back;
    if (p.vehicle && p.vehicle !== S.car) { /* leave it */ }
    if (!S.car || S.car.dead || !d.traffic.cars.includes(S.car)) {
      S.car = d.traffic.spawnAt(sx, sz, 0, o.type || 'sedan', 0x2f6fd0, 'free');
    }
    const v = S.car;
    if (p.vehicle !== v) p.enterVehicle(v);
    v.health = 100; v.dead = false;
    v.stunt = false; v.stuntLaunch = null; v.stuntLanded = false; v.rampRef = null;
    v.x = sx; v.z = sz; v.heading = Math.atan2(r.dx, r.dz);
    v.y = c.groundAt(sx, sz, null); v.vy = 0; v.vLong = o.speed0 || 0; v.vLat = 0;
    p.camYaw = v.heading + Math.PI; p.camFloor = null;
    d.stunts.run = null; d.stunts.last = null;
    S.R = { j, r, t: 0, phase: 'run', lipSpeed: null, maxUp: 0, tAir: 0, spin: o.spin || 0, cap: o.cap || 1e9,
      startY: v.y, tele: [], res: null, slow: 0, launchT: null };
    return JSON.stringify({ id, sx: Math.round(sx), sz: Math.round(sz), back: Math.round(back) });
  };
  S.status = () => {
    const R = S.R, v = S.car;
    return { phase: R.phase, t: +R.t.toFixed(2), x: +v.x.toFixed(1), z: +v.z.toFixed(1), y: +v.y.toFixed(2),
      spd: +v.vLong.toFixed(1), lip: R.lipSpeed, tAir: +R.tAir.toFixed(2), maxUp: +R.maxUp.toFixed(1),
      ts: +d.stunts.timeScale.toFixed(2), res: R.res };
  };
  S.step = (n) => {
    const R = S.R, v = S.car, r = R.r;
    for (let i = 0; i < n && (R.phase === 'run' || R.phase === 'air'); i++) {
      const dt = (1 / 60) * d.stunts.timeScale;
      const input = d.controls.read();
      input.y = 0; input.hand = false; input.attack = false;
      // hold the ramp's centreline
      const u = (v.x - r.x0) * r.dx + (v.z - r.z0) * r.dz;
      const tx = r.x0 + r.dx * (u + 14), tz = r.z0 + r.dz * (u + 14);
      const dh = wrap(Math.atan2(tx - v.x, tz - v.z) - v.heading);
      input.x = R.phase === 'air' ? -R.spin : Math.max(-1, Math.min(1, -dh * 3));
      const want = v.vLong < R.cap;
      input.gas = want; input.gasAmt = want ? 1 : 0; input.brake = false; input.brakeAmt = 0;
      p.update(dt, input, { x: 0, y: 0 }, d.controls, d.traffic, d.peds);
      const pos = p.position;
      const cd = { x: pos.x - p.camPos.x, z: pos.z - p.camPos.z };
      const cl = Math.hypot(cd.x, cd.z) || 1; cd.x /= cl; cd.z /= cl;
      d.traffic.update(dt, pos.x, pos.z, cd, p);
      d.world.update(pos.x, pos.z, 2);
      d.stunts.update(dt, p);
      d.acts.update(dt, p);
      R.t += dt;
      if (d.stunts.timeScale < 0.99) R.slow += dt;
      if (R.phase === 'run') {
        if (v.stunt) { R.phase = 'air'; R.lipSpeed = +v.rampAlong.toFixed(1); R.launchT = R.t; R.launchY = v.y; }
        else if (R.t > 40) { R.phase = 'fail'; R.res = 'never launched'; }
        else if (u > r.L + 3) { R.phase = 'fail'; R.res = 'passed the lip without launching'; }
      } else {
        R.tAir += dt;
        R.maxUp = Math.max(R.maxUp, v.y - R.launchY);
        if (!v.stunt) { R.phase = 'landed'; R.res = d.stunts.last || { note: 'landed, not scored', lip: R.lipSpeed }; }
      }
      if (i % 6 === 0) R.tele.push([+R.t.toFixed(2), +v.x.toFixed(1), +v.y.toFixed(2), +v.z.toFixed(1), +v.vLong.toFixed(1)]);
    }
    p.applyCamera(d.camera);
    const pos = p.position;
    d.placeSun(pos.x, pos.y, pos.z);
    return JSON.stringify(S.status());
  };
  /** Drive a jump end to end; returns the result. */
  S.drive = (id, o = {}) => {
    S.begin(id, o);
    for (let k = 0; k < 400 && (S.R.phase === 'run' || S.R.phase === 'air'); k++) S.step(30);
    // roll on a little so a bad landing shows as a crash
    const st = S.status();
    return JSON.stringify(st);
  };
  S.settle = (n = 400) => {
    const v = p.vehicle || p;
    for (let i = 0; i < n; i++) if (!d.world.update(v.x, v.z, 60)) break;
  };
  return 'sj ready';
})();
