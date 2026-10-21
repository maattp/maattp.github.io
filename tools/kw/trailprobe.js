// The trails' walkers and riders, live: for kwshots.mjs VIEW_PROBE_FILE.
// Teleports the player beside a trail (window.__trailAt = [x, z], default the
// Walter Bean at Bridgeport), runs the game 12 s, and reports the walkers
// (peds.js spawnTrail, steered by bikes.js) and cyclists: how many, how far
// each moved, how far each is from its trail, and whether any is on water.
//   VIEW_PROBE_FILE=tools/kw/trailprobe.js node tools/kw/kwshots.mjs /tmp/x
(async () => {
  const d = window.__dbg, G = d.G;
  const [x, z] = window.__trailAt || [4172, -1335];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  d.player.respawn(x, z);
  d.game.paused = false;
  await sleep(6000);
  const cy = d.cyclists, net = d.bikeNet;
  const snap = () => cy.walkers.map((w) => ({ x: w.p.x, z: w.p.z }));
  const a = snap();
  await sleep(6000);
  const b = snap();
  const walkers = cy.walkers.map((w, i) => {
    const n = net.nearest(w.p.x, w.p.z, 30, true);
    return { trail: w.P.name || '(unnamed)', foot: w.P.foot, moved: a[i] ? +Math.hypot(b[i].x - a[i].x, b[i].z - a[i].z).toFixed(1) : null,
      off: n ? +n.d.toFixed(2) : null, water: G.isWater(w.p.x, w.p.z), dist: Math.round(Math.hypot(w.p.x - d.player.position.x, w.p.z - d.player.position.z)) };
  });
  d.game.paused = true;
  return JSON.stringify({ stats: cy.stats, riders: cy.riders.length, walkers, peds: d.peds.peds.length });
})()
