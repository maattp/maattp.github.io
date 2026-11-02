// Page side of tools/kw/aircontrolprobe.mjs: drives YOUR car with REAL held
// keys (controls.keys -> controls.read(), the same input object main.js
// builds) at a fixed dt through player.update, with traffic, world,
// stunts.update and airtime.update stepping alongside in main.js's order.
(() => {
  const d = window.__dbg, c = d.city, p = d.player, A = d.airtime, K = d.controls;
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const T = window.__ac = {};
  T.toasts = [];
  /** the player in a fresh car of `type` at (x, z) heading h, on the ground, rolling at `speed` */
  T.put = (type, x, z, h, speed) => {
    if (d.game.dead) { d.game.dead = false; d.game.deathT = 0; document.getElementById('wasted').classList.remove('show'); }
    p.health = 100; p.dead = false; d.game.wanted = 0;
    let v = p.vehicle;
    if (v) { p.exitVehicle(true); d.traffic.remove(v); }
    v = d.traffic.spawnAt(x, z, 0, type, 0xd0402f, 'free');
    p.enterVehicle(v);
    v.health = 100; v.dead = false; v.stunt = false; v.stuntLaunch = null; v.stuntLanded = false; v.rampRef = null;
    v.capsized = null; v.airFly = null;
    v.x = x; v.z = z; v.heading = h; v.y = c.groundAt(x, z, null); v.vy = 0; v.vLong = speed || 0; v.vLat = 0;
    v.pitch = 0; v.roll = 0; v.onGround = true;
    p.camYaw = h + Math.PI; p.camFloor = null;
    d.stunts.run = null; d.stunts.last = null; A.cancel(); A.last = null;
    d.world.update(x, z, 60);
    return v;
  };
  T.keys = (list) => { K.keys.clear(); for (const k of list) K.keys.add(k); };
  /** one fixed-dt frame of the game's own update order, input from the held keys */
  T.frame = (dt) => {
    const input = K.read();
    p.update(dt, input, { x: 0, y: 0 }, K, d.traffic, d.peds);
    const pos = p.position, cd = { x: pos.x - p.camPos.x, z: pos.z - p.camPos.z }, cl = Math.hypot(cd.x, cd.z) || 1;
    cd.x /= cl; cd.z /= cl;
    if (d.link && !d.link._fr) d.link._fr = 1;
    if (!T.fast) d.traffic.update(dt, pos.x, pos.z, cd, p);
    d.world.update(pos.x, pos.z, 2);
    d.stunts.update(dt, p);
    A.update(dt, p);
  };
  /**
   * A run at a site: o = { type, x, z, h (the take-off point and heading), back (m of run-up),
   * speed (m/s rolling start), run: keys on the run-up, ctl: 'function (S, v) { return [keys] }'
   * for the air (S.air s aloft, S.pa / S.ya / S.ra accumulated pitch / heading / roll, rad),
   * stopAir: return mid-air at this many seconds aloft (for a shot; T.cont() resumes) }.
   */
  T.run = (o) => {
    const fx = Math.sin(o.h), fz = Math.cos(o.h), back = o.back == null ? 60 : o.back;
    const v = T.put(o.type || 'sedan', o.x - fx * back, o.z - fz * back, o.h, o.speed == null ? 30 : o.speed);
    T.keys([]);
    for (let i = 0; i < 3; i++) T.frame(1 / 60);
    v.vLong = o.speed == null ? 30 : o.speed;
    const ctl = o.ctl ? (0, eval)('(' + o.ctl + ')') : () => [];
    T.S = { o, v, ctl, phase: 'run', t: 0, air: 0, pa: 0, ya: 0, ra: 0, p0: 0, h0: 0, r0: 0, lip: null, ctlAir: 0,
      money0: d.game.money, maxPitch: 0, landed: null, held: '', trace: [] };
    return T.cont();
  };
  T.cont = () => {
    const S = T.S, v = S.v, o = S.o, dt = 1 / 60;
    for (let i = 0; i < 20 * 60; i++) {
      if (S.phase === 'run') {
        T.keys(o.run || ['KeyW']);
        const along = (v.x - o.x) * Math.sin(o.h) + (v.z - o.z) * Math.cos(o.h);
        if (v.onGround === false && along > -20) {
          S.phase = 'air'; S.lip = { x: v.x, z: v.z, y: v.y, sp: +Math.hypot(v.vLong, v.vLat).toFixed(1) };
          S.p0 = v.pitch; S.h0 = v.heading; S.r0 = v.roll;
        } else if (S.t > 20) { S.phase = 'fail'; break; }
      }
      if (S.phase === 'air') {
        const k = S.ctl(S, v) || [];
        T.keys(k);
        if (k.length) S.ctlAir += dt;
        S.held = k.join('+');
      } else if (S.phase === 'down') T.keys(o.land || []);
      T.frame(dt);
      S.t += dt;
      if (S.phase === 'air') {
        S.pa += wrap(v.pitch - S.p0); S.p0 = v.pitch;
        S.ya += wrap(v.heading - S.h0); S.h0 = v.heading;
        S.ra += wrap(v.roll - S.r0); S.r0 = v.roll;
        if (v.onGround === false || v.airFly) S.air += dt;
        if (i % 3 === 0) S.trace.push([+S.air.toFixed(2), Math.round(S.pa * 57.3), Math.round(S.ya * 57.3), Math.round(S.ra * 57.3), +v.y.toFixed(1), S.held]);
        if (v.onGround !== false && !v.airFly) {
          S.phase = 'down';
          S.landed = { air: +S.air.toFixed(2), pitch: Math.round(v.pitch * 57.3), roll: Math.round(v.roll * 57.3), airLand: v.airLand, capsized: !!v.capsized,
            dist: +Math.hypot(v.x - S.lip.x, v.z - S.lip.z).toFixed(1), health: Math.round(v.health) };
        }
        if (o.stopAir && S.air >= o.stopAir && S.phase === 'air') {
          o.stopAir = 0;
          p.applyCamera(d.camera);
          d.placeSun(p.position.x, p.position.y, p.position.z);
          return JSON.stringify({ mid: true, air: +S.air.toFixed(2), pa: Math.round(S.pa * 57.3), ya: Math.round(S.ya * 57.3), ra: Math.round(S.ra * 57.3) });
        }
      }
      if (S.phase === 'down' && (A.last || S.t > 30)) break;
    }
    p.applyCamera(d.camera);
    d.placeSun(p.position.x, p.position.y, p.position.z);
    const big = document.getElementById('airBig');
    return JSON.stringify({ phase: S.phase, lip: S.lip, landed: S.landed, last: A.last, paid: d.game.money - S.money0,
      pa: Math.round(S.pa * 57.3), ya: Math.round(S.ya * 57.3), ra: Math.round(S.ra * 57.3), ctlAir: +S.ctlAir.toFixed(2),
      capsizedNow: !!v.capsized, big: big && big.classList.contains('show') ? big.innerText.replace(/\n+/g, ' | ') : '',
      trace: o.trace ? S.trace : undefined });
  };
  /** a camera beside the flight path (side: +1 left of it, -1 right), at `dist` m, looking at the vehicle */
  T.side = (side, dist, up) => {
    const v = T.S.v, F = v.airFly, hx = F ? F.wx : Math.sin(v.heading), hz = F ? F.wz : Math.cos(v.heading), l = Math.hypot(hx, hz) || 1;
    const nx = hz / l * side, nz = -hx / l * side;
    d.camera.position.set(v.x + nx * dist - hx / l * 2, v.y + (up || 1.5), v.z + nz * dist - hz / l * 2);
    d.camera.lookAt(v.x, v.y + 0.8, v.z);
    d.placeSun(v.x, v.y, v.z);
    return 1;
  };
  T.hideBig = () => { const b = document.getElementById('airBig'); if (b) b.classList.remove('show'); A.bigT = 0; return 1; };
  T.settle = () => { const v = p.vehicle || p; for (let i = 0; i < 300; i++) if (!d.world.update(v.x, v.z, 60)) break; return 1; };
  return 'ac ready';
})()
