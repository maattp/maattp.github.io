// Find somebody crossing a street at a junction and shoot him: from the kerb he left, 4 m up, and the
// wider junction from 22 m up. Also prints how he got there (the path planNode made). Shots go to
// tools/data/pedshots/crossing_*.png.
export default async ({ evaluate, shot }) => {
  const info = await evaluate(`(() => { const d = window.__dbg, P = d.player, city = d.city;
    d.applyQuality('high', true);
    for (const id of ['hud', 'pad', 'stickZone', 'lookZone', 'objective', 'toast', 'rotate', 'topBtns', 'pauseMenu']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    d.game.paused = true;
    const sx = 0, sz = 0;
    let best = null, bd = 1e12;
    for (const e of city.edgesNear(sx, sz, 400)) { const E = city.edges[e]; if (E.elev || E.cls === 'hwy' || E.cls === 'ramp') continue; const n = city.nodes[E.a]; const dd = (n.x - sx) ** 2 + (n.z - sz) ** 2; if (dd < bd) { bd = dd; best = n; } }
    for (const p of [...d.peds.peds]) d.peds.remove(p);
    P.vehicle = null; P.onFoot = true; P.x = best.x + 3; P.z = best.z + 3; P.y = city.groundAt(P.x, P.z, null);
    d.world.update(P.x, P.z, 2);
    let who = null;
    for (let i = 0; i < 3000 && !who; i++) {
      d.traffic.update(1 / 20, P.x, P.z, { x: 0, z: -1 }, P); d.peds.update(1 / 20, P.x, P.z, P, d.traffic);
      for (const p of d.peds.peds) if (p.cross && Math.hypot(p.x - P.x, p.z - P.z) < 50 && p.state === 'walk') { who = p; break; }
    }
    if (!who) return { err: 'nobody crossed' };
    // let him get half way
    for (let i = 0; i < 12; i++) { d.traffic.update(1 / 20, P.x, P.z, { x: 0, z: -1 }, P); d.peds.update(1 / 20, P.x, P.z, P, d.traffic); }
    d.world.update(who.x, who.z, 2);
    d.peds.update(0.001, P.x, P.z, P, d.traffic);
    const fx = Math.sin(who.heading), fz = Math.cos(who.heading);
    d.camera.position.set(who.x - fz * 9 - fx * 5, who.y + 4, who.z + fx * 9 - fz * 5);
    d.camera.lookAt(who.x, who.y + 1, who.z); d.camera.updateMatrixWorld(true);
    window.__who = who;
    return { at: [Math.round(who.x), Math.round(who.z)], path: Array.from(who.path.slice(0, who.pn * 2)).map((x) => Math.round(x)), pcr: who.pcr, pi: who.pi, speed: +who.speed.toFixed(2), cars: d.traffic.cars.filter((c) => Math.hypot(c.x - who.x, c.z - who.z) < 40 && c.mode !== 'parked').length }; })()`);
  console.log(JSON.stringify(info));
  if (info.err) return;
  await shot('crossing_close');
  await evaluate(`(() => { const d = window.__dbg, w = window.__who; d.camera.position.set(w.x + 8, w.y + 22, w.z + 14); d.camera.lookAt(w.x, w.y, w.z); d.camera.updateMatrixWorld(true); })()`);
  await shot('crossing_wide');
};
