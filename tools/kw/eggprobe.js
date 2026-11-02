// Auto KW: the Golden Goose Eggs and the UW geese, checked in the live game.
//   AUTO_HTTP_PORT=8201 AUTO_CDP_PORT=9501 AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/eggprobe.js node tools/kw/kwshots.mjs /tmp/x
// Prints one line per egg (ground height, egg height, reachable?), then:
//   pickup   teleports onto each egg on foot, confirms it is collected, that a
//            player 25 m away does not collect it (so the probe can fail), and that
//            the count / money / localStorage `autokw-eggs` follow;
//   rewards  the 10/20/30/40 cash and the garage (built at 20, three cars at 40);
//   geese    a UW gander hisses then chases a player on foot and bites (health
//            drops, the player is shoved), and the ring road's families stand in
//            the road for traffic (crossN) and scatter when walked up to.
// Ends with PASS / FAIL. Resets `autokw-eggs` first, and leaves it empty.
(async () => {
  const G = await import('/apps/autokw/src/geo.js');
  const d = window.__dbg, c = d.city, w = d.world, P = d.player, E = d.eggs, geese = d.geese;
  const log = [], fails = [];
  const bad = (m) => { fails.push(m); log.push('FAIL ' + m); };
  const info = (x, z) => {
    const wl = w.waterLevelAt(x, z);
    let bld = false;
    for (const b of c.buildingsNear(x, z, 40)) {
      const cs = Math.cos(-b.rot), sn = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx * cs - dz * sn) <= b.w / 2 + 1 && Math.abs(dx * sn + dz * cs) <= b.d / 2 + 1) { bld = true; break; }
    }
    return { g: c.groundAt(x, z, null), wet: wl !== null && wl > G.terrainHeight(x, z) + 0.05, bld, road: !!c.onRoad(x, z, 2) };
  };
  if (!E) return 'FAIL no __dbg.eggs';
  d.game.paused = true;
  localStorage.removeItem('autokw-eggs');
  for (const s of E.spots) s.got = false;
  const stored = () => JSON.parse(localStorage.getItem('autokw-eggs') || '{}');

  // 1. every spot
  log.push('id        x      z    ground  egg_y  wet bld road above');
  for (const s of E.spots) {
    const i = info(s.x, s.z);
    const above = s.y - i.g;
    const ok = !i.wet && !i.bld && !i.road && above > 0.3 && above < 1.6;
    log.push(`${s.id.padEnd(9)} ${String(s.x).padStart(6)} ${String(s.z).padStart(6)} ${i.g.toFixed(1).padStart(7)} ${s.y.toFixed(1).padStart(6)}  ${+i.wet} ${+i.bld} ${+i.road}  ${above.toFixed(2)} ${ok ? 'ok' : 'BAD'}`);
    if (!ok) bad('egg ' + s.id + ' not reachable');
  }
  if (E.spots.length !== 40) bad('expected 40 eggs, have ' + E.spots.length);

  // 2. pickup, one by one (on foot; the garage's cars spawn off tendGarage, fine)
  P.onFoot = true; P.vehicle = null;
  const cam = d.camera;
  let money0 = d.game.money, n = 0;
  for (const s of E.spots) {
    P.x = s.x + 25; P.z = s.z; P.y = c.groundAt(P.x, P.z, null);
    cam.position.set(P.x, P.y + 3, P.z);
    E.update(0.016, P, cam);
    if (s.got) bad('collected from 25 m: ' + s.id);
    P.x = s.x; P.z = s.z; P.y = c.groundAt(s.x, s.z, null);
    E.update(0.016, P, cam);
    if (!s.got) { bad('not collected on top: ' + s.id); continue; }
    n++;
    if (E.count !== n) bad(`count ${E.count} != ${n} after ${s.id}`);
    if (stored().g.length !== n) bad('storage lags at ' + n);
    if (n === 10 && d.game.money - money0 < 5000) bad('no $5000 at 10');
    if (n === 20 && !E.garage) bad('no garage at 20');
    if (n === 40 && d.game.money - money0 < 145000) bad('rewards short at 40: ' + (d.game.money - money0));
    E.update(0.016, P, cam);
    if (E.count !== n) bad('re-collected ' + s.id);
  }
  log.push(`collected ${E.count}/40, money +${d.game.money - money0}, stored ${stored().g.length}, hint at 40: "${E.hint(P.x, P.z)}"`);
  // the garage's cars, with the player at the lot
  P.x = -3960; P.z = -1100;
  for (let i = 0; i < 3; i++) E.update(0.016, P, cam);
  const cars = E.slots.filter(Boolean).map((v) => v.typeName || v.type || '?');
  log.push('garage cars: ' + cars.join(','));
  if (cars.length !== 3) bad('garage has ' + cars.length + ' cars');
  // a 20-egg hint
  for (const s of E.spots.slice(25)) s.got = false;
  log.push('hint at 25: ' + E.hint(-5300, -2200));

  // 3. geese: a chase on foot at UW
  const gl = geese.flocks.find((f) => f.aggro && Math.hypot(f.x + 5690, f.z + 2060) < 5);
  if (!gl) bad('no UW flock'); else {
    const g0 = gl.geese[0];
    P.onFoot = true; P.vehicle = null; P.health = 100;
    P.x = g0.x + 6; P.z = g0.z; P.y = c.groundAt(P.x, P.z, null);
    cam.position.set(P.x, P.y + 3, P.z);
    const seen = new Set(); let hp0 = P.health, moved = 0, minD = 99;
    for (let i = 0; i < 400; i++) {
      geese.update(1 / 30, P, cam);
      seen.add(g0.st);
      minD = Math.min(minD, Math.hypot(g0.x - P.x, g0.z - P.z));
      if (P.health < hp0 - 4) break;
    }
    log.push(`gander states ${[...seen].join('>')}  closest ${minD.toFixed(1)} m  health ${hp0} -> ${P.health}  bites ${geese.bites || 0}`);
    if (!seen.has('hiss') || !seen.has('chase')) bad('gander did not hiss then chase');
    if (P.health >= hp0) bad('gander never bit');
    // the bite shoves
    const x0 = P.x, z0 = P.z;
    for (let i = 0; i < 12; i++) geese.update(1 / 30, P, cam);
    moved = Math.hypot(P.x - x0, P.z - z0);
    log.push('shoved ' + moved.toFixed(2) + ' m');
    // away from them (sprinting in a car's place: just teleport) the chase ends
    P.x = g0.x + 60; P.z = g0.z;
    for (let i = 0; i < 40; i++) geese.update(1 / 30, P, cam);
    if (g0.st === 'chase' || g0.st === 'hiss') bad('gander still chasing 60 m away');
    // not on a Park gander: the old behaviour (stands, honks), no chase
    const pk = geese.flocks.find((f) => !f.aggro && !f.road && Math.hypot(f.x + 4372, f.z + 1640) < 5);
    if (pk) {
      const g1 = pk.geese[0]; P.x = g1.x + 6; P.z = g1.z; P.health = 100; const st = new Set();
      cam.position.set(P.x, P.y + 3, P.z);
      for (let i = 0; i < 120; i++) { geese.update(1 / 30, P, cam); st.add(g1.st); }
      if (st.has('chase')) bad('park gander chased');
      log.push('park gander states ' + [...st].join('>'));
    }
  }
  // 4. the ring road's families block traffic and scatter
  const rf = geese.flocks.find((f) => f.road);
  if (!rf) bad('no road family'); else {
    P.x = rf.x + 40; P.z = rf.z; P.vehicle = null; P.onFoot = true; P.health = 100;
    cam.position.set(P.x, P.y + 3, P.z);
    geese.update(1 / 30, P, cam);
    const fake = { crossN: 0, crossXZ: new Float32Array(48) };
    geese.feedTraffic(fake);
    log.push('road family blocks ' + fake.crossN + ' crossing points; on the road: ' + rf.geese.map((g) => +!!c.onRoad(g.x, g.z, 3)).join(''));
    if (fake.crossN < 3) bad('road family not fed to traffic');
    P.x = rf.x + 2; P.z = rf.z;
    for (let i = 0; i < 10; i++) geese.update(1 / 30, P, cam);
    const left = rf.geese.filter((g) => g.st === 'block').length;
    log.push('after walking up: ' + rf.geese.map((g) => g.st).join(','));
    if (left) bad('road family did not scatter');
  }
  localStorage.removeItem('autokw-eggs');
  log.push(fails.length ? 'FAIL (' + fails.length + ')' : 'PASS');
  return log.join('\n');
})()
