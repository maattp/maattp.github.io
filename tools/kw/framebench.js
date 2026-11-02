// Auto KW: microbenchmarks of per-frame paths, for an A/B of a CPU pass
// (v112's frame-budget pass): ms per call of each, at the spawn, the game paused.
//   VIEW_PROBE_FILE=tools/kw/framebench.js VIEW_THROTTLE=8 AUTO_PHONE=1 AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. \
//     node tools/kw/kwshots.mjs /tmp/x
//   (AUTO_APP='../m/apps/autokw' serves another build from the same port: the URL is /apps/$AUTO_APP/)
// The full-frame numbers of perfaudit move +-15 % with the Mac's load; these
// loops time one path each, so a 0.1 ms saving shows above the noise.
(async () => {
  const d = window.__dbg;
  d.game.paused = true;
  await new Promise((r) => setTimeout(r, 1500));
  const t = (n, f) => { f(); const t0 = performance.now(); for (let i = 0; i < n; i++) f(i); return (performance.now() - t0) / n; };
  const out = {};
  // 1. cropAt: one tile's worth of cells (192) through town and country
  let k = 0;
  out.cropAt192 = t(200, () => { for (let i = 0; i < 192; i++, k++) d.world.cropAt(-9000 + (k * 7.3) % 7000, -1500 + (k * 3.1) % 600); });
  // 2. the HUD, with the minimap drawn every call (dt = the 30 Hz tick)
  out.hud = t(300, () => d.hud.update(1 / 30, d.game, d.player, d.traffic));
  // 3. the GPU ledger's wrapper: one bindVertexArray (x ~160 a frame)
  const gl = d.renderer.getContext();
  out.bindVAO_us = t(20000, () => gl.bindVertexArray(null)) * 1000;
  // 4. the drive-thrus' update (none in range at the spawn)
  if (d.dthru) { const p = d.player.position; out.dthru = t(2000, () => d.dthru.update(1 / 60, p.x, p.z, d.player)); }
  // 5. the scene's matrix update
  out.matrices = t(300, () => d.scene.updateMatrixWorld());
  for (const kk in out) out[kk] = +out[kk].toFixed(4);
  return JSON.stringify(out);
})()
