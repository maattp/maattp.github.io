(async () => {
  const d = __dbg, G = d.G, P = d.player, W = d.world;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const frames = async (n) => { for (let i = 0; i < n; i++) await raf(); };
  const key = (t, code) => window.dispatchEvent(new KeyboardEvent(t, { code, key: code, bubbles: true }));
  const out = [];
  const m = d.lmRoot.userData.marinas.find((m) => m.name.includes('Victoria'));
  const skis = d.traffic.cars.filter((v) => v.spec.jetski && Math.hypot(v.x - m.x, v.z - m.z) < 60);
  out.push(`skis at the boathouse: ${skis.length} ${skis.map((v) => `(${v.x.toFixed(1)},${v.z.toFixed(1)} y${v.y.toFixed(2)} wl${W.waterLevelAt(v.x, v.z)})`).join(' ')}`);
  const s0 = skis[0];
  const px = -m.n[1], pz = m.n[0];
  P.respawn(s0.x + px * 2.5, s0.z + pz * 2.5);
  P.y = d.city.groundAt(P.x, P.z, m.level + 1);
  d.game.paused = false;
  await frames(20);
  out.push(`on foot at ${P.x.toFixed(1)},${P.z.toFixed(1)} y ${P.y.toFixed(2)} (float deck)`);
  key('keydown', 'KeyF'); await frames(3); key('keyup', 'KeyF'); await frames(20);
  const v = P.vehicle;
  out.push(`entered: ${v ? v.spec.hand : 'NOTHING'}`);
  if (!v) return out.join('\n');
  const route = [[-1905, 572], [-1930, 615], [-1975, 622], [-2015, 624], [-2058, 643], [-2100, 668], [-2150, 700], [-2205, 735], [-2215, 745],
    [-2150, 705], [-2100, 668], [-2058, 643], [-2015, 624], [-1950, 624], [-1915, 600], [-1932, 575], [-1938, 560]];
  let wi = 0, held = new Set(), t0 = performance.now(), dist = 0, lx = v.x, lz = v.z, vmax = 0, onLand = 0, n = 0, dyMax = 0, minDep = 9, stuck = 0;
  const hold = (c, on) => { if (on && !held.has(c)) { held.add(c); key('keydown', c); } if (!on && held.has(c)) { held.delete(c); key('keyup', c); } };
  const log = [];
  while (wi < route.length && performance.now() - t0 < 240000) {
    await raf();
    const [tx, tz] = route[wi];
    const dx = tx - v.x, dz = tz - v.z, dd = Math.hypot(dx, dz);
    if (dd < (wi === route.length - 1 ? 6 : 12)) { log.push(`wp${wi} reached at ${((performance.now() - t0) / 1000).toFixed(0)} s`); wi++; continue; }
    let err = Math.atan2(dx, dz) - v.heading; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
    const sp = Math.abs(v.vLong || 0);
    const vcap = Math.abs(err) > 0.6 ? 5 : 13;
    hold('KeyA', err > 0.08); hold('KeyD', err < -0.08);
    hold('KeyW', sp < vcap);
    const wl = W.waterLevelAt(v.x, v.z), gr = G.terrainHeight(v.x, v.z);
    dist += Math.hypot(v.x - lx, v.z - lz); lx = v.x; lz = v.z; vmax = Math.max(vmax, sp); n++;
    if (wl === null || gr > wl) onLand++;
    else { dyMax = Math.max(dyMax, Math.abs(v.y - wl)); minDep = Math.min(minDep, wl - gr); }
    if (sp < 1.0 && held.has('KeyW')) stuck++; else stuck = 0;
    if (n % 30 === 0) log.push(`  ${v.x.toFixed(1)},${v.z.toFixed(1)} y ${v.y.toFixed(2)} wl ${wl === null ? 'null' : wl.toFixed(2)} bed ${gr.toFixed(2)} ${(sp * 3.6).toFixed(0)} km/h wp${wi}`);
    if (stuck > 240) { log.push(`STOPPED (throttle held, < 1 km/h) at wp${wi}: ${v.x.toFixed(1)},${v.z.toFixed(1)} bed ${gr.toFixed(2)} wl ${wl}`); break; }
  }
  for (const c of [...held]) hold(c, false);
  await frames(90);
  out.push(...log);
  out.push(`lap: ${wi}/${route.length} waypoints, ${dist.toFixed(0)} m, top ${(vmax * 3.6).toFixed(0)} km/h, ${((performance.now() - t0) / 1000).toFixed(0)} s wall, frames ${n}, hull over dry ground ${onLand}, max |y - water| ${dyMax.toFixed(3)} m, shallowest ${minDep.toFixed(2)} m`);
  out.push(`stopped at ${v.x.toFixed(1)},${v.z.toFixed(1)} afloat ${!!v.afloat}`);
  key('keydown', 'KeyF'); await frames(3); key('keyup', 'KeyF'); await frames(20);
  const wl = W.waterLevelAt(P.x, P.z);
  out.push(`exit: onFoot ${P.onFoot} swimming ${!!P.swimming} at ${P.x.toFixed(1)},${P.z.toFixed(1)} y ${P.y.toFixed(2)} ground ${G.terrainHeight(P.x, P.z).toFixed(2)} wl ${wl}`);
  window.__rideSki = v;
  d.game.paused = true;
  return out.join('\n');
})()
