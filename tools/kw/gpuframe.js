// What a frozen frame costs the GPU, for kwshots.mjs VIEW_PROBE_FILE. The
// game paused on fixed camera poses (streaming settled, the sun's box placed),
// then the frame drawn in a tight loop -- renderer.render (shadow pass
// included) into postfx's target and the post chain, a pixel read back after
// each -- so each frame's wall time is CPU submission + the GPU executing it. (The
// game's rAF in this Chrome is paced by the display, so timing its callbacks
// measures vsync; gl.finish() returns before the GPU is done; ANGLE/Metal
// timer queries split frames at command-buffer boundaries.) Median and p90 ms per pose, with
// the scene pass's draws and triangles.
//
//   AUTO_PHONE=1 AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/gpuframe.js node tools/kw/kwshots.mjs /tmp/x
//
// window.__gfAB = '<js>' (VIEW_BOOT_JS or VIEW_PRE): evaluated after the base
// measurement, then every pose measured again -- an A/B inside one boot.
// window.__gfN frames per pose (default 120).
(async () => {
  const d = window.__dbg, r = d.renderer, gl = r.getContext(), W = d.world, cam = d.camera, G = d.G;
  const N = +(window.__gfN || 120);
  const RAF0 = window.requestAnimationFrame.bind(window);
  const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : RAF0(f)); RAF0(f); });
  const R0 = r.render.bind(r);
  const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
  const POSES = [
    // the opening frame's ground: the square looking south-west
    { name: 'spawn', c: [-3842, -1352, 1.7], t: [-3870, -1380, 3] },
    { name: 'king-uptown', c: [-3828, -1438, 1.6], t: [-3858, -1585, 6] },
    { name: 'king-dtk', c: [-1138.7, 238.2, 1.6], t: [-1177, 256, 10] },
    { name: 'suburb', c: [-5600, -900, 1.6], t: [-5650, -950, 2] },
    { name: 'air-uptown', c: [-3200, -1000, 450], t: [-3600, -800, 0] },
  ];
  const settle = (x, z) => {
    const pend = () => [...W.chunks.values()].filter((k) => k.lod !== k.wantLod).length;
    for (let i = 0; i < 1500; i++) { W.update(x, z, 3); if (i > 3 && pend() === 0) break; }
  };
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)]; };
  d.game.paused = true;
  const run = async (tag) => {
    const out = [];
    for (const P of POSES) {
      const y0 = gy(P.c[0], P.c[1]);
      const alt = P.c[2] > 50;
      W.playerAlt = alt ? P.c[2] : 0; W.playerFlying = alt; W.playerFwdX = 0; W.playerFwdZ = 0;
      cam.position.set(P.c[0], (alt ? 0 : y0) + P.c[2], P.c[1]);
      cam.lookAt(P.t[0], gy(P.t[0], P.t[1]) + P.t[2], P.t[1]);
      cam.updateMatrixWorld(true);
      settle(P.c[0], P.c[1]);
      if (d.placeSun) d.placeSun(cam.position.x, cam.position.y, cam.position.z);
      for (const n of (d.lmRoot.userData.near || [])) n.o.visible = Math.hypot(n.o.position.x - P.c[0], n.o.position.z - P.c[1]) < 600 || n.o.visible;
      await frames(30);
      // the frame drawn in a tight loop, each phase finished: the game's own
      // render (shadow pass included) into postfx's target, then the post
      // chain (rAF intervals are vsync-paced in this Chrome: useless here)
      const P2 = d.postfx, T = [], px = new Uint8Array(4);
      for (let i = 0; i < N + 10; i++) {
        const t0 = performance.now();
        r.setRenderTarget(P2.enabled ? P2.target : null);
        R0(d.scene, cam);
        if (P2.enabled) { r.setRenderTarget(null); P2.render(i / 60, cam); }
        // (gl.finish returns at once here: the GPU process runs on; reading
        // a pixel back waits for the frame)
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (i >= 10) T.push(performance.now() - t0);
      }
      out.push(`${tag.padEnd(5)} ${P.name.padEnd(12)} med ${med(T).toFixed(2)} ms  p90 ${p90(T).toFixed(2)}  draws ${d.sceneStats.calls}  tris ${(d.sceneStats.tris / 1000).toFixed(0)}k`);
    }
    return out;
  };
  const rows = await run('base');
  if (window.__gfAB) { eval(window.__gfAB); await frames(60); rows.push(...await run('ab')); }
  const size = r.getDrawingBufferSize(new d.THREE.Vector2());
  rows.push(`  buffer ${size.x}x${size.y} pr ${r.getPixelRatio().toFixed(2)}`);
  return rows.join('\n');
})()
