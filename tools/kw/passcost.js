// What each part of a frame costs the GPU, for kwshots.mjs VIEW_PROBE_FILE:
// at frozen poses, each part drawn K times in a row then one pixel read back
// (the GPU's queue drained), the best of T trials, per draw. A whole frame on
// the Mac's GPU is a few ms and its timing noisy (tools/kw/gpuframe.js);
// repeating one part K times makes its own cost stand out. The shares are
// what carry over to a phone, not the milliseconds.
//
//   AUTO_PHONE=1 AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/passcost.js node tools/kw/kwshots.mjs /tmp/x
//
// window.__pcPoses: [{ name, c: [x, z, h], t: [x, z, h] }] instead of the defaults.
(async () => {
  const d = window.__dbg, r = d.renderer, gl = r.getContext(), W = d.world, cam = d.camera, P = d.postfx;
  const K = +(window.__pcK || 20), T = +(window.__pcT || 5);
  const RAF0 = window.requestAnimationFrame.bind(window);
  const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : RAF0(f)); RAF0(f); });
  const R0 = r.render.bind(r);
  const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
  const POSES = window.__pcPoses || [
    { name: 'spawn', c: [-3842, -1352, 1.7], t: [-3870, -1380, 3] },
    { name: 'king-dtk', c: [-1138.7, 238.2, 1.6], t: [-1177, 256, 10] },
    { name: 'suburb', c: [-5600, -900, 1.6], t: [-5650, -950, 2] },
    { name: 'arterial', c: [-2400, -900, 1.6], t: [-2500, -850, 2] },
  ];
  const settle = (x, z) => {
    const pend = () => [...W.chunks.values()].filter((k) => k.lod !== k.wantLod).length;
    for (let i = 0; i < 1500; i++) { W.update(x, z, 3); if (i > 3 && pend() === 0) break; }
  };
  const px = new Uint8Array(4);
  const time = (fn) => {
    let best = Infinity;
    for (let t = 0; t < T; t++) {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let k = 0; k < K; k++) fn(k);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      best = Math.min(best, (performance.now() - t0) / K);
    }
    return best;
  };
  d.game.paused = true;
  const out = [];
  for (const Q of POSES) {
    const y0 = gy(Q.c[0], Q.c[1]);
    cam.position.set(Q.c[0], y0 + Q.c[2], Q.c[1]);
    cam.lookAt(Q.t[0], gy(Q.t[0], Q.t[1]) + Q.t[2], Q.t[1]);
    cam.updateMatrixWorld(true);
    settle(Q.c[0], Q.c[1]);
    if (d.placeSun) d.placeSun(cam.position.x, cam.position.y, cam.position.z);
    await frames(30);
    const scene = () => { r.setRenderTarget(P.target); R0(d.scene, cam); };
    const sm = r.shadowMap, au = sm.autoUpdate;
    const full = time(scene);
    sm.autoUpdate = false;
    const noShadow = time(scene);
    sm.autoUpdate = au;
    scene();
    const ss = P.ssaoOn, bl = P.fx.bloom, bp = P.bloomPasses;
    const post = time((k) => P.render(k / 60, cam));
    P.ssaoOn = false; const postNoAO = time((k) => P.render(k / 60, cam)); P.ssaoOn = ss;
    P.fx.bloom = false; const postNoBloom = time((k) => P.render(k / 60, cam)); P.fx.bloom = bl;
    P.bloomPasses = 1; const post1 = time((k) => P.render(k / 60, cam)); P.bloomPasses = bp;
    r.setRenderTarget(null);
    out.push(`${Q.name.padEnd(9)} scene ${full.toFixed(2)} (shadow pass ${(full - noShadow).toFixed(2)})  post ${post.toFixed(2)}: ssao ${(post - postNoAO).toFixed(2)}, bloom ${(post - postNoBloom).toFixed(2)} (2nd pass ${(post - post1).toFixed(2)}), rest ${(postNoAO - (post - postNoBloom)).toFixed(2)}  draws ${d.sceneStats.calls} tris ${(d.sceneStats.tris / 1000).toFixed(0)}k`);
  }
  const size = r.getDrawingBufferSize(new d.THREE.Vector2());
  out.push(`  ms per draw of each part; buffer ${size.x}x${size.y} pr ${r.getPixelRatio().toFixed(2)}, quality ${d.game.settings.quality}`);
  return out.join('\n');
})()
