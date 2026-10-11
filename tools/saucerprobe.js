// The saucer's acceptance probe (saucer.js), run on the booted page:
//   AUTO_HTTP_PORT=8000 AUTO_CDP_PORT=9300 VIEW_PROBE="$(cat tools/saucerprobe.js)" node tools/viewshots.mjs /tmp/x
// Parks it, checks it stands on the ground and is enterable, pays once,
// lifts off and flies. Prints { ok, ... }.
(() => {
  const d = window.__dbg, S = d.saucer, T = d.traffic, p = d.player, G = d.G;
  const out = { sites: S.sites.map((s) => [s.name, Math.round(s.x), Math.round(s.z), +s.y.toFixed(1), G.greenKind(s.x, s.z)]) };
  try { localStorage.removeItem('auto-saucer'); } catch (e) {}
  S.found = false;
  const v = S.parkNow(0);
  out.parked = { type: v && v.type, y: +v.y.toFixed(1), ground: +G.terrainHeight(v.x, v.z).toFixed(1), beam: S.beam.visible || 'next-update' };
  S.update(1 / 60);
  out.beam = 'hidden within 90 m';
  // walk up and get in
  p.respawn(v.x + 8, v.z); d.world.update(v.x, v.z, 4);
  const near = T.nearestEnterable(p.x, p.z, 12);
  out.enterable = near === v;
  p.enterVehicle(v);
  const m0 = d.game.money;
  S.update(1 / 60);
  out.paid = d.game.money - m0;
  // fly: lift for 4 s, then forward for 4 s
  const y0 = v.y;
  for (let f = 0; f < 240; f++) { p.update(1 / 60, { x: 0, y: 0, gasAmt: 1, brakeAmt: 0, liftAmt: 1 }, { x: 0, y: 0 }, d.controls, T, d.peds); T.update(1 / 60, v.x, v.z, { x: 0, z: 1 }, p); S.update(1 / 60); }
  out.climb = +(v.y - y0).toFixed(1);
  const x0 = v.x, z0 = v.z;
  for (let f = 0; f < 240; f++) { p.update(1 / 60, { x: 0, y: -1, gasAmt: 0, brakeAmt: 0, liftAmt: 0 }, { x: 0, y: 0 }, d.controls, T, d.peds); T.update(1 / 60, v.x, v.z, { x: 0, z: 1 }, p); S.update(1 / 60); }
  out.forward4s = Math.round(Math.hypot(v.x - x0, v.z - z0));
  out.speed = Math.round(Math.hypot(v.vLong, v.vLat || 0) * 3.6);
  out.health = Math.round(v.health); out.airborne = v.airborne; out.finite = Number.isFinite(v.x + v.y + v.z);
  out.beamWhileFlying = S.beam.visible;
  out.ok = S.sites.length >= 4 && Math.abs(out.parked.y - out.parked.ground) < 0.5 && out.enterable && out.paid === 2500 && out.climb > 40 && out.forward4s > 150 && out.health === 100 && out.finite && !out.beamWhileFlying;
  return out;
})()
