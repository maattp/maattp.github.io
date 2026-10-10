// The orca pod's acceptance probe (orcas.js), run on the booted page:
//   AUTO_HTTP_PORT=8000 AUTO_CDP_PORT=9300 VIEW_PROBE="$(cat tools/orcaprobe.js)" node tools/viewshots.mjs /tmp/x
// 5 sim-minutes with the camera beside the pod: every route point open water,
// blows and dives happen, a forced breach happens, nothing surfaces on land,
// the sighting pays once. Prints { ok, ... }.
(() => {
  const d = window.__dbg, O = d.orcas, G = d.G, cam = d.camera;
  const out = { loop: Math.round(O.loop), route: O.route.map(([x, z]) => [Math.round(x), Math.round(z), G.isWater(x, z), O._open(x, z)]), wp: O.wp.map(Math.round) };
  try { localStorage.removeItem('auto-orcas'); } catch (e) {}
  O.seen = false;
  // camera on the bluff at West Point, looking out at the pod
  const c = O._at(O.s);
  cam.position.set(O.wp[0], 25, O.wp[1]);
  let onLand = 0, maxY = -99, visFrames = 0;
  const m0 = d.game.money;
  for (let f = 0; f < 30 * 300; f++) {   // 5 sim minutes at 30 Hz
    const cc = O._at(O.s);
    cam.position.set(cc.x + 250, 20, cc.z + 250); cam.lookAt(cc.x, 0, cc.z); cam.updateMatrixWorld(true);
    if (f === 30 * 60) O.breachNow();
    O.update(1 / 30);
    for (const w of O.whales) {
      if (w.mode !== 'under' && !G.isWater(w.x, w.z)) onLand++;
      maxY = Math.max(maxY, w.y);
    }
    if (O.front.visible) visFrames++;
  }
  // away for a minute and back: everyone back on station, in the water
  cam.position.set(0, 20, 0); cam.updateMatrixWorld(true);
  for (let f = 0; f < 1800; f++) O.update(1 / 30);
  const back = O._at(O.s); cam.position.set(back.x + 250, 20, back.z + 250); cam.lookAt(back.x, 0, back.z); cam.updateMatrixWorld(true);
  O.update(1 / 30);
  out.reentry = O.whales.map((w) => Math.round(Math.hypot(w.x - back.x, w.z - back.z)));
  const reOk = O.whales.every((w) => G.isWater(w.x, w.z) && Math.hypot(w.x - back.x, w.z - back.z) < 60);
  out.dry = O.dry;
  out.ok = reOk && O.dry === 0 && out.route.every((r) => r[2] && r[3]) && O.stats.blows > 20 && O.stats.breaches >= 1 && O.stats.dives > 5 && onLand === 0 && O.seen && d.game.money - m0 === 1000 && O.whales.every((w) => Number.isFinite(w.x + w.z + w.y + w.h));
  Object.assign(out, { stats: O.stats, onLand, maxY: +maxY.toFixed(1), visFrames, seen: O.seen, paid: d.game.money - m0,
    modes: O.whales.map((w) => w.mode), finite: O.whales.every((w) => Number.isFinite(w.x + w.z + w.y + w.h)) });
  return out;
})()
