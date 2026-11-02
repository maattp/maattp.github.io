// Auto KW: what scene.updateMatrixWorld does a frame, per top-level group.
//
//   VIEW_PROBE_FILE=tools/kw/matrixcensus.js AUTO_PHONE=1 AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     node tools/kw/kwshots.mjs /tmp/x
//   (VIEW_BOOT_JS='window.__mc = { sites: [{ name, x, z }], top: 30 }')
//
// build.js skipHiddenMatrices skips a HIDDEN scene child; under a visible one
// three r160 walks every descendant: an object with matrixAutoUpdate composes
// its matrix (position/quaternion/scale -> matrix) and, composed or forced by a
// parent that was, re-multiplies its world matrix, hidden or not. Per site
// (the player put there, the streamer settled), per scene child: objects
// visited, matrices composed, world matrices multiplied -- the static ones
// (composing to the same matrix every frame) are what freezeStatic saves.
(async () => {
  const d = window.__dbg, p = d.player, scene = d.scene;
  const cfg = Object.assign({ top: 30 }, window.__mc || {});
  const sites = cfg.sites || [
    { name: 'spawn', x: null },
    { name: 'kitchener', x: -1380, z: 180 },
    { name: 'country', x: -8768, z: -11050 },
    { name: 'mall', x: -4100, z: -5150 },
  ];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pend = () => [...d.world.chunks.values()].filter((q) => q.lod !== q.wantLod).length;
  const out = [];
  const sp0 = { x: p.position.x, z: p.position.z };
  d.game.paused = false;
  for (const s of sites) {
    p.respawn(s.x === null ? sp0.x : s.x, s.x === null ? sp0.z : s.z);
    const t0 = performance.now();
    await wait(3000);
    while (pend() > 2 && performance.now() - t0 < 60000) await wait(300);
    await wait(1500);
    const by = new Map(), tot = { visit: 0, compose: 0, mult: 0 };
    const walk = (o, g, force) => {
      g.visit++; tot.visit++;
      if (o.matrixAutoUpdate) { g.compose++; tot.compose++; force = true; }
      if (o.matrixWorldNeedsUpdate) force = true;
      if (force) { g.mult++; tot.mult++; }
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) if (ch[i].matrixWorldAutoUpdate === true) walk(ch[i], g, force);
    };
    for (const c of scene.children) {
      if (c.matrixWorldAutoUpdate !== true || !c.visible) continue;
      const k = c.name || c.type;
      let g = by.get(k);
      if (!g) by.set(k, (g = { k, n: 0, visit: 0, compose: 0, mult: 0 }));
      g.n++;
      walk(c, g, false);
    }
    const top = [...by.values()].sort((a, b) => b.compose + b.mult - a.compose - a.mult).slice(0, cfg.top);
    out.push(`== ${s.name}: visited ${tot.visit}, composed ${tot.compose}, multiplied ${tot.mult} (scene children ${scene.children.length})\n` +
      top.map((g) => `  ${String(g.compose).padStart(5)} comp ${String(g.mult).padStart(5)} mult ${String(g.visit).padStart(5)} visit  x${g.n}  ${g.k}`).join('\n'));
  }
  return out.join('\n');
})()
