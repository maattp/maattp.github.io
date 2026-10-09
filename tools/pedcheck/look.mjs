// Stand the player on a street, run 30 sim-s of cars and people, and shoot two views: a street-level
// one from behind the player looking toward the most people (the way he would turn his head), and one
// from 45 m up. Shots go to tools/data/pedshots/. Look at them: the count says nothing about whether
// the figures stand on the pavement and not in the road.
export default async ({ evaluate, shot }) => {
  const sites = process.env.SITES ? JSON.parse(process.env.SITES) : { pikeplace: [-346, 182], westlake: [68, 4], pioneer: [278, 1094], pier66: [-788, 92, 1] };
  for (const [name, [sx, sz, exact]] of Object.entries(sites)) {
    const r = await evaluate(`(() => { const d = window.__dbg, P = d.player, city = d.city;
      d.applyQuality('high', true);
      for (const id of ['hud', 'pad', 'stickZone', 'lookZone', 'objective', 'toast', 'rotate', 'topBtns', 'pauseMenu']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
      let best = null, bd = 1e12;
      for (const e of city.edgesNear(${sx}, ${sz}, 400)) { const E = city.edges[e]; if (E.elev || E.cls === 'hwy' || E.cls === 'ramp') continue; const n = city.nodes[E.a]; const dd = (n.x - ${sx}) ** 2 + (n.z - ${sz}) ** 2; if (dd < bd) { bd = dd; best = n; } }
      for (const p of [...d.peds.peds]) d.peds.remove(p);
      P.vehicle = null; P.onFoot = true; P.h.group.visible = true;
      P.x = ${exact ? sx : 'best.x + 3'}; P.z = ${exact ? sz : 'best.z + 3'}; P.y = city.groundAt(P.x, P.z, null);
      d.world.update(P.x, P.z, 2);
      for (let i = 0; i < 600; i++) { d.traffic.update(1 / 20, P.x, P.z, { x: 0, z: -1 }, P); d.peds.update(1 / 20, P.x, P.z, P, d.traffic); }
      d.world.update(P.x, P.z, 2);
      const ps = d.peds.peds.filter((p) => !p.cop && Math.hypot(p.x - P.x, p.z - P.z) < 45);
      let mx = 0, mz = 0; for (const p of ps) { mx += p.x - P.x; mz += p.z - P.z; }
      const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
      d.camera.position.set(P.x - mx * 7, P.y + 2.6, P.z - mz * 7); d.camera.lookAt(P.x + mx * 25, P.y + 1.2, P.z + mz * 25); d.camera.updateMatrixWorld(true);
      d.peds.update(0.001, P.x, P.z, P, d.traffic);
      const dists = d.peds.peds.map((p) => Math.hypot(p.x - P.x, p.z - P.z)).sort((a, b) => a - b);
      return { n: d.peds.peds.length, within40: dists.filter((x) => x < 40).length, nearest: dists.slice(0, 5).map((x) => +x.toFixed(0)), cars: d.traffic.cars.length, look: [mx, mz], P: [P.x, P.z, P.y] }; })()`);
    console.log(name, JSON.stringify(r));
    await shot(name + '_street');
    await evaluate(`(() => { const d = window.__dbg, P = d.player; d.camera.position.set(P.x + 20, P.y + 45, P.z + 38); d.camera.lookAt(P.x, P.y, P.z); d.camera.updateMatrixWorld(true); })()`);
    await shot(name + '_aerial');
  }
};
