// Page side of tools/kw/storyprobe.mjs (KW Stories, apps/autokw/src/story.js):
// evaluated in the booted, paused game. Defines window.__sp.
//
// The world is stepped at a FIXED dt (1/60) by this file, the way
// tools/stuntjumps-page.js does: player.update with an autopilot's input,
// traffic, the world's streaming, police (and the wanted cool-down main.js
// does), the body shops, KW Stories. The main loop keeps running behind it
// paused, which only draws (and runs anything that holds the world in real
// time: a cutscene, a respray), so the node side waits out a hold.
//
// The autopilot drives real input (steer / gas / brake) through the player's
// own vehicle model:
//   - 'line': pure pursuit of a street route (story.routeNow, the game's A*),
//     kept 1.8 m right of the centreline, slowing for turns, stopping at its end;
//   - 'chase': along the target's own trail, ramming it once within 35 m;
//   - 'tail': along the target's trail, holding ~60 m back.
// It cannot overtake, so AI 'traffic' cars stopped in its lane ahead are
// removed (only those; never a story car, a unit or a parked car). Teleports,
// each named in the log: a transit leg with no mechanic (to the start of the
// next one; the 'go' arrival itself is still driven from ~150 m out), getting
// into the float (ENTER's path is tested elsewhere), the escape from the
// wanted level (2 km out of sight: the police's own cool-down then does it),
// and the fail paths' rivals moved near their finish.
(() => {
  const d = window.__dbg, p = d.player, S = d.story, T = d.traffic, c = d.city, game = d.game;
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const SP = window.__sp = { dt: 1 / 60, log: [], car: null, ap: null, t: 0, shots: {}, want: [] };
  const note = (s) => { SP.log.push(`[${SP.t.toFixed(1)}] ${s}`); };
  // the story's own cars, as it spawns them (Story.spawnCar), for the leak check
  SP.spawned = new Set();
  if (!S.__spWrapped) { S.__spWrapped = true; const f = S.spawnCar.bind(S); S.spawnCar = (...a) => { const v = f(...a); window.__sp.spawned.add(v); return v; }; }
  SP.note = note;

  // --- lines ------------------------------------------------------------------
  const mk = (pts) => { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, cum, len: cum[cum.length - 1], k: 0 }; };
  const fromStory = (L) => { const a = []; for (let i = 0; i < L.n; i++) a.push([L.pts[i * 2], L.pts[i * 2 + 1]]); return a; };
  const offset = (P, off) => P.map((q, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; return [q[0] - tz * off, q[1] + tx * off]; });
  const at = (L, s) => { s = Math.max(0, Math.min(L.len, s)); let i = 1; while (i < L.pts.length - 1 && L.cum[i] < s) i++; const a = L.pts[i - 1], b = L.pts[i], l = L.cum[i] - L.cum[i - 1] || 1, t = (s - L.cum[i - 1]) / l; return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l }; };
  const proj = (L, x, z) => { let best = null; for (let i = Math.max(0, L.k - 4); i < Math.min(L.pts.length - 1, L.k + 30); i++) { const a = L.pts[i], b = L.pts[i + 1], sx = b[0] - a[0], sz = b[1] - a[1], l2 = sx * sx + sz * sz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * sx + (z - a[1]) * sz) / l2)); const dd = Math.hypot(a[0] + sx * t - x, a[1] + sz * t - z); if (!best || dd < best.d) best = { d: dd, s: L.cum[i] + t * Math.sqrt(l2), k: i }; } if (best) L.k = best.k; return best; };
  SP.route = (tx, tz, extra) => {
    const pos = p.position, L = S.routeNow(pos.x, pos.z, tx, tz);
    let pts = offset(fromStory(L), 1.8);
    if (extra) pts = pts.concat(extra);   // (exact points: a bay's mouth)
    return mk(pts);
  };

  // --- the car ------------------------------------------------------------------
  SP.give = (x, z, h, type = 'sports') => {
    if (p.vehicle) p.exitVehicle(true);
    if (SP.car && T.cars.includes(SP.car) && !SP.car.story) T.remove(SP.car);
    const v = T.spawnAt(x, z, h, type, 0x2f6fd0, 'free');
    p.enterVehicle(v);
    v.health = v.spec.hp || 100;
    SP.car = v;
    p.camYaw = h + Math.PI; p.camFloor = null;
    d.world.update(x, z, 2);
    return v;
  };
  /** Teleport the player's vehicle (a transit leg): onto the road ~back m short of (tx, tz) along its route. */
  SP.hop = (tx, tz, back = 150, why = 'transit') => {
    const L = SP.route(tx, tz);
    const q = at(L, Math.max(0, L.len - back)), r = c.respawnPointNear(q.x, q.z, 60) || q;
    const h = Math.atan2(q.dx, q.dz);
    const v = p.vehicle || SP.give(r.x, r.z, h);
    v.place(r.x, r.z, h); v.vLong = 0; v.vLat = 0; v.vy = 0; v.spin = 0;
    p.camYaw = h + Math.PI; p.camFloor = null;
    d.world.update(r.x, r.z, 2);
    note(`teleport (${why}) to ${Math.round(r.x)},${Math.round(r.z)}, ${Math.round(Math.hypot(tx - r.x, tz - r.z))} m from the target`);
  };

  /** Line up 9 m outside a bay's mouth facing in (as tools/kw/medprobe.mjs does: the turn
   *  into a bay is respray.js's, tested there) and drive in on real input from there. */
  SP.lineUp = (sh, why) => {
    const s = sh.s, cr = Math.cos(s.rot), sr = Math.sin(s.rot), lz = -9;
    const x = s.ox - lz * sr, z = s.oz + lz * cr;
    const v = p.vehicle || SP.give(x, z, 0);
    v.place(x, z, Math.atan2(s.nx, s.nz)); v.vLong = 0; v.vLat = 0; v.vy = 0; v.spin = 0;
    p.camYaw = v.heading + Math.PI; p.camFloor = null;
    d.world.update(x, z, 2);
    note(`teleport (${why}) to 9 m outside ${sh.shop.name}'s bay, facing in`);
    return { mode: 'line', L: mk([[x, z], [s.ox, s.oz], [sh.mx, sh.mz], [sh.mx + s.nx * 5, sh.mz + s.nz * 5]]), stop: true, top: 6 };
  };

  // --- the autopilot ------------------------------------------------------------
  const inp = () => { const i = d.controls.read(); i.x = 0; i.y = 0; i.gas = false; i.gasAmt = 0; i.brake = false; i.brakeAmt = 0; i.hand = false; i.attack = false; return i; };
  SP.drive = (dt) => {
    const i = inp(), v = p.vehicle, A = SP.ap;
    // idle: brake to a stop, then the hand brake (the brake held at a standstill is REVERSE)
    if (!v || p.onFoot || !A || A.mode === 'idle') { if (v) { if (v.vLong > 0.4) { i.brake = true; i.brakeAmt = 1; } else if (v.vLong < -0.4) { i.gas = true; i.gasAmt = 1; } else i.hand = true; } return i; }
    const sp = v.vLong;
    let tx, tz, tv = A.top || 22;
    if (A.mode === 'line' || A.mode === 'chase' || A.mode === 'tail') {
      let L = A.L;
      if (A.mode !== 'line') {
        // the street route to where the target is now, found again every 1.5 s
        const tg = A.target, D = tg.storyDrive;
        A.rt = (A.rt || 0) - dt;
        if (D && D.L) {
          // a car on a route (the tail's SUV, the limo): the same streets it takes
          if (!A.L) { const P = []; for (let i = 0; i < D.L.n; i++) P.push([D.L.pts[i * 2], D.L.pts[i * 2 + 1]]); A.L = mk(P); }
        } else if (!A.L || A.rt <= 0) { A.rt = 1.5; A.L = SP.route(tg.x, tg.z); }
        L = A.L;
      }
      const pr = proj(L, v.x, v.z);
      A.L0k = L.k;
      const look = 6 + Math.abs(sp) * 0.7;
      const q = at(L, (pr ? pr.s : 0) + look), q2 = at(L, (pr ? pr.s : 0) + look + 25);
      tx = q.x; tz = q.z;
      // a car left standing in the lane: pull out a lane to the left and pass it (as a driver would)
      if (!(A.passT > 0)) {
        const f = v.forward;
        for (const o of T.cars) {
          if (o === v || o === A.target || o.mode === 'traffic' || o.mode === 'police' || Math.abs(o.vLong) > 1) continue;
          const dx = o.x - v.x, dz = o.z - v.z, al = dx * f.x + dz * f.z;
          if (al > 3 && al < 16 && Math.abs(dx * f.z - dz * f.x) < 2.4) { A.passT = 2.6; A.passes = (A.passes || 0) + 1; break; }
        }
      }
      if (A.passT > 0) { A.passT -= dt; tx += q.dz * 3.4; tz -= q.dx * 3.4; }
      const turn = Math.abs(wrap(Math.atan2(q2.dx, q2.dz) - Math.atan2(q.dx, q.dz)));
      tv = Math.min(tv, 8 + (1 - Math.min(1, turn / 1.3)) * (tv - 8));
      const left = L.len - (pr ? pr.s : 0);
      if (A.mode === 'line' && A.stop) tv = Math.min(tv, Math.max(0, (left - 4) * 0.45));
      if (A.slowEnd && left < A.slowEnd) tv = Math.min(tv, 4.5);   // (a tight way in: a bay's mouth)
      if (A.mode === 'chase') {
        const tg = A.target, dd = Math.hypot(tg.x - v.x, tg.z - v.z);
        if (dd < 35) { tx = tg.x + tg.forward.x * 3; tz = tg.z + tg.forward.z * 3; tv = Math.max(Math.abs(tg.vLong) + 9, 14); }
        else tv = Math.max(tv, Math.min(40, Math.abs(tg.vLong) + 12));
      }
      if (A.mode === 'tail') {
        const tg = A.target, dd = Math.hypot(tg.x - v.x, tg.z - v.z);
        tv = Math.max(0, Math.min(A.top || 24, Math.abs(tg.vLong) + (dd - A.gap) * 0.25));
      }
    }
    let err = wrap(Math.atan2(tx - v.x, tz - v.z) - v.heading);
    if (Math.abs(err) > 0.6) tv = Math.min(tv, 8);
    // wedged: back out
    if (A.rev > 0) { A.rev -= dt; i.brake = true; i.brakeAmt = 1; i.x = Math.max(-1, Math.min(1, err * 3)); return i; }
    if (Math.abs(sp) < 0.8 && tv > 3) A.stuck = (A.stuck || 0) + dt; else A.stuck = 0;
    if (A.stuck > 2.2) { A.stuck = 0; A.rev = 1.6; A.revs = (A.revs || 0) + 1; }
    i.x = Math.max(-1, Math.min(1, -err * 2.6));
    if (SP.traceOn && (SP.trT = (SP.trT || 0) + dt) > 0.5) { SP.trT = 0; (SP.trace || (SP.trace = [])).push([+SP.t.toFixed(1), Math.round(v.x), Math.round(v.z), +sp.toFixed(1), +tv.toFixed(1), +err.toFixed(2), A.L ? Math.round(A.L.len) : 0]); }
    if (sp < tv - 0.5) { i.gas = true; i.gasAmt = Math.min(1, (tv - sp) * 0.3 + 0.2); }
    else if (sp > tv + 1.5) { i.brake = true; i.brakeAmt = Math.min(1, (sp - tv) * 0.25); }
    if (tv < 0.3 && Math.abs(sp) < 0.6) { i.gas = false; i.brake = false; i.hand = true; }
    return i;
  };
  /** AI traffic stopped in the autopilot's lane ahead (it cannot overtake): removed, counted. */
  SP.clearAhead = () => {
    const v = p.vehicle; if (!v) return;
    const f = v.forward;
    for (const o of [...T.cars]) {
      if (o === v || o.story || o.mode !== 'traffic' || o.unit) continue;
      const dx = o.x - v.x, dz = o.z - v.z, al = dx * f.x + dz * f.z, la = Math.abs(dx * f.z - dz * f.x);
      if (al > 2 && al < 40 && la < 3.2) { T.remove(o); SP.cleared = (SP.cleared || 0) + 1; }
    }
  };

  // --- one fixed step of the world ------------------------------------------------
  const STAR = [0, 1, 2, 3, 4, 5];
  SP.world = (dt) => {
    const input = SP.drive(dt);
    p.update(dt, input, { x: 0, y: 0 }, d.controls, T, d.peds);
    const pos = p.position;
    const cd = { x: pos.x - p.camPos.x, z: pos.z - p.camPos.z }, cl = Math.hypot(cd.x, cd.z) || 1; cd.x /= cl; cd.z /= cl;
    if (d.link && !d.link._fr) d.link._fr = 1;
    T.update(dt, pos.x, pos.z, cd, p);
    if ((SP.n = (SP.n || 0) + 1) % 8 === 0) d.world.update(pos.x, pos.z, 2);
    if (SP.n % 20 === 0 && SP.ap && SP.ap.mode !== 'idle' && SP.ap.mode !== 'chase') SP.clearAhead();
    d.police.update(dt, p, false);
    // main.js's wanted cool-down (the paused loop does not run it)
    if (game.wanted > 0 && d.police.unseenT > 6 + game.wanted * 3) { d.police.unseenT = 0; game.cool = 0; game.wanted = Math.max(0, game.wanted - 1); game.points = STAR[game.wanted] ? game.points * 0.5 : 0; if (!game.wanted) d.police.clear(); }
    if (d.respray && !d.respray.active) d.respray.tick(dt, p);
    S.update(dt, p);
    SP.t += dt;
  };

  // --- the plan for each step (the autopilot's mode, and its teleports) -------------
  const TRANSIT = { 'goose.0': 1, 'goose.2': 1, 'tail.0': 1, 'float.0': 1, 'card.0': 1, 'card.3': 1, 'race.0': 1, 'prost.0': 1, 'prost.2': 1 };
  SP.plan = () => {
    const run = S.run, st = run.st, key = `${run.ch.id}.${run.k}`, P = st.p;
    SP.stepT = 0;
    note(`step ${key} ${P.k}${SP.failMode ? ' (fail run: ' + SP.failMode + ')' : ''}`);
    if (SP.failMode && SP.failPlan && SP.failPlan(st, key)) return;
    if (P.k === 'go') {
      if (TRANSIT[key]) SP.hop(P.at[0], P.at[1], P.r > 100 ? 40 : 150);
      SP.ap = { mode: 'line', L: SP.route(P.at[0], P.at[1]), stop: true, top: P.cargo ? 17 : 22 };
    } else if (P.k === 'chase') SP.ap = { mode: 'idle' };
    else if (P.k === 'tail') SP.ap = { mode: 'idle' };
    else if (P.k === 'flee') SP.ap = { mode: 'idle' };
    else if (P.k === 'race') SP.ap = { mode: 'idle' };
    else if (P.k === 'board') {
      const fv = st.v;
      p.exitVehicle(true);
      p.enterVehicle(fv);
      note('teleport (into the float: ENTER is tested elsewhere)');
      SP.ap = { mode: 'idle' };
    } else if (P.k === 'parade') SP.ap = { mode: 'idle' };
    else if (P.k === 'heat') {
      SP.ap = { mode: 'idle' };
    } else if (P.k === 'respray') {
      // (the escape's respray already counts for this step: nothing to do)
      SP.ap = d.respray.stats.n > (S.run.spray0 || 0) ? { mode: 'idle' } : SP.lineUp(st.shop, 'to the body shop: a transit leg');
    }
  };
  /** Each frame of a step: the autopilot's targets once the step's car is out. */
  SP.during = () => {
    const st = S.run && S.run.st; if (!st) return;
    const P = st.p, A = SP.ap;
    SP.stepT += SP.dt;
    if (SP.failMode && SP.failTick && SP.failTick(st)) return;
    if ((P.k === 'chase' || P.k === 'flee') && st.v && A.mode === 'idle') SP.ap = { mode: 'chase', target: st.v, top: 40 };
    if (P.k === 'tail' && st.v && A.mode === 'idle') SP.ap = { mode: 'tail', target: st.v, gap: 60, top: 24 };
    if (P.k === 'race' && st.v && st.go && A.mode === 'idle') SP.ap = { mode: 'line', L: mk(offset(fromStory(st.L), 1.8)), stop: true, top: 40 };
    if (P.k === 'parade' && st.cps && A.mode === 'idle') { const e = st.cps[st.cps.length - 1]; SP.ap = { mode: 'line', L: SP.route(e.x, e.z), stop: true, top: 12 }; }
    if (P.k === 'heat' && !SP.bay && game.wanted > 0 && SP.stepT > 1.5 && (!SP.fled || (!d.police.searching && SP.stepT - SP.hopT > 9 && SP.fled < 5))) {
      // Losing them, GTA's way: out of sight, then a respray no unit sees you go into
      // (respray.js clears the stars; the chapter's respray step counts that same spray).
      // The getaway driving is police.js's own (tools/wantedcheck.mjs drives it); the probe
      // stands in for it: the car is moved 2-3 km on, out of every unit's sight, and again
      // every 9 s until police.js says they are SEARCHING (a crime is dispatched for 15 s,
      // a sighting tracked for 2.5) -- it drives on away between moves.
      SP.fled = (SP.fled || 0) + 1; SP.hopT = SP.stepT;
      const pos = p.position, a = SP.fled * 2.1, r = c.respawnPointNear(pos.x + Math.cos(a) * 2600, pos.z + Math.sin(a) * 2600, 500);
      p.vehicle.place(r.x, r.z, p.vehicle.heading); p.vehicle.vLong = 0;
      d.world.update(r.x, r.z, 2);
      note(`teleport (the getaway, ${SP.fled}: out of every unit's sight) to ${Math.round(r.x)},${Math.round(r.z)}; stars ${game.wanted}, searching ${d.police.searching}`);
      SP.ap = { mode: 'line', L: SP.route(r.x + Math.cos(a) * 2500, r.z + Math.sin(a) * 2500), stop: true, top: 24 };
      SP.bay = 0;
    }
    if (P.k === 'heat' && SP.fled && !SP.bay && d.police.searching && game.wanted > 0) {
      // ... then to the nearest body shop's mouth (out of sight) and in.
      SP.bay = 1;
      const pos = p.position, R = d.respray;
      let sh = null, bd = Infinity;
      for (const q of R.sites) { const dd = Math.hypot(q.mx - pos.x, q.mz - pos.z); if (dd < bd) { bd = dd; sh = q; } }
      SP.ap = SP.lineUp(sh, 'they are searching: to the nearest body shop, unseen');
    }
    if (P.k === 'heat' && SP.bay === 1 && game.wanted > 0 && d.respray.stats.n > (S.run.spray0 || 0) && !d.respray.active) {
      // a unit saw the car go in: the stars stayed. Away again, and round once more.
      SP.bay = 0;
      const pos = p.position;
      SP.ap = { mode: 'line', L: SP.route(pos.x - 2500, pos.z + 2000), stop: true, top: 24 };
      S.run.spray0 = d.respray.stats.n;
      note('seen going in: away again');
    }
  };

  // --- running a chapter ------------------------------------------------------------
  SP.start = (i, o = {}) => {
    SP.failMode = o.fail || null; SP.failPlan = o.failPlan || null; SP.failTick = o.failTick || null;
    SP.fled = 0; SP.fled2 = false; SP.hopT = 0; SP.bay = 0; SP.lastKey = null; SP.ap = { mode: 'idle' }; SP.cleared = 0; SP.result = null;
    SP.money0 = game.money;
    // every chapter in the probe's own sports car (not the float chapter 4 leaves you in)
    { const v = p.vehicle, pos = p.position; if (!v || v.isFloat || v.dead || v !== SP.car) { const r = c.respawnPointNear(pos.x, pos.z, 200); SP.give(r.x, r.z, v ? v.heading : 0); } }
    if (o.viaTrigger) {
      // drive into Gord's beam: the real trigger
      const g = d.story.constructor && window.__dbg.story;
      SP.ap = { mode: 'line', L: SP.route(o.gx, o.gz), stop: true, top: 10 };
      return 'driving to the beam';
    }
    const ok = S.start(i, { skipIntro: o.skipIntro !== false });
    note(`start chapter ${i + 1} -> ${ok}`);
    return ok;
  };
  /** n fixed steps; stops early at a cutscene, a death, a step change or the end. */
  SP.tick = (n) => {
    const out = { steps: 0 };
    for (let k = 0; k < n; k++) {
      if (S.active || game.holds.size) { out.held = [...game.holds]; break; }
      if (!S.run) { out.idle = true; break; }
      const key = `${S.run.ch.id}.${S.run.k}`;
      if (key !== SP.lastKey) { SP.lastKey = key; SP.plan(); }
      SP.during();
      SP.world(SP.dt);
      out.steps++;
      if (game.dead) { out.dead = game.busted ? 'BUSTED' : 'WASTED'; break; }
      if (!S.run) break;
    }
    p.applyCamera(d.camera);
    const pos = p.position;
    d.placeSun(pos.x, pos.y, pos.z);
    // the HUD (minimap, money, toasts' clocks) runs in the loop's unpaused half: once a chunk
    if (out.steps) d.hud.update(out.steps * SP.dt, game, p, T);
    const st = S.run && S.run.st;
    Object.assign(out, { t: +SP.t.toFixed(1), run: S.run ? `${S.run.ch.id}.${S.run.k}:${st && st.kind}` : null, x: Math.round(pos.x), z: Math.round(pos.z),
      v: p.vehicle ? +(p.vehicle.vLong * 3.6).toFixed(0) : null, money: game.money, wanted: game.wanted, cut: S.active,
      led: (document.getElementById('jobLed') || {}).textContent || '', last: S.log[S.log.length - 1] });
    return JSON.stringify(out);
  };

  /** What a chapter left behind (should be nothing). */
  SP.leaks = () => {
    const bad = [];
    if (S.run) bad.push('run still set');
    if (game.story) bad.push('game.story still ' + game.story);
    if (game.holds.size) bad.push('holds: ' + [...game.holds].join(','));
    if (game.leaks.length) bad.push('game.leaks: ' + game.leaks.join(','));
    // every car the story spawned (recorded by the wrapper below) is gone, but the one you sit in
    const ours = T.cars.filter((v) => v.story || v.storyDrive || (SP.spawned.has(v) && v !== p.vehicle));
    if (ours.length) bad.push(`${ours.length} story cars in traffic`);
    const floats = T.cars.filter((v) => v.isFloat && v !== S.prize && v !== p.vehicle);
    if (floats.length) bad.push(`${floats.length} floats left in traffic`);
    if (S.beam.visible && S.complete) bad.push('beam visible');
    if (S.arrow.visible) bad.push('arrow visible');
    if (d.hud.fare) bad.push('hud.fare set');
    if (d.hud.suspects) bad.push('hud.suspects set');
    const led = document.getElementById('jobLed');
    if (led && led.style.display !== 'none') bad.push('LED panel shown');
    if (S._routeQ.length) bad.push('route jobs queued');
    // story meshes still in the scene: only the garage's (sign, Gord, the beam), the prize, the float you sit in
    const storyMeshes = [];
    d.scene.traverse((o) => { if (/^story/.test(o.name || '') && o.visible) storyMeshes.push(o.name); });
    const pv = p.vehicle;
    for (const n of storyMeshes) if (n === 'storyFloat' && !(pv && pv.isFloat) && !S.prize) bad.push('a float mesh with no owner');
    return { bad, storyMeshes, cars: T.cars.length, children: d.scene.children.length };
  };
  SP.cleanSlate = () => {
    if (game.dead) d.doRespawn();
    game.wanted = 0; game.points = 0; d.police.clear();
    p.health = 100;
    return 1;
  };
  return 'storyprobe page ready';
})();
