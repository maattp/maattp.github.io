// The graphics pass's probe (apps/autokw/src/gfx.js), for kwshots.mjs:
//   AUTO_PHONE=1 AUTO_GPU=1 [VIEW_THROTTLE=8] VIEW_PROBE_FILE=tools/kw/gfxprobe.js node tools/kw/kwshots.mjs /tmp/x
// Checks, printing OK / FAIL per line:
//  - every switch reaches its uniform (gfxLacq, gfxWater, gfxFogSun.w, the glow's visibility)
//  - the lacquer and the water terms are IN the compiled programs (non-vacuous:
//    the paint / water program source carries gfxLacq / gfxWater)
//  - Day: the dusk fog is off (w 0, density factor 1) and the glow draws nothing
//  - Dusk: w > 0, the fog colours are the dome's (toward brighter than away)
//  - Night on King St: lamp sprites chosen, cars' lamps, and the draw is one
//  - the per-frame CPU of the glow (update x 200) and of gfxFog, in ms
//  - the glow program's compile time (renderer.compile on its own scene)
(async () => {
  const d = window.__dbg, r = d.renderer, out = [];
  const ok = (c, m) => out.push((c ? 'OK   ' : 'FAIL ') + m);
  const RAF0 = window.requestAnimationFrame.bind(window);
  const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : RAF0(f)); RAF0(f); });
  const progs = () => r.info.programs || [];
  const srcHas = (s) => progs().some((p) => { try { const gl = r.getContext(); return (gl.getShaderSource(p.fragmentShader) || '').includes(s); } catch (e) { return false; } });
  d.game.paused = true;
  // a pose on King St, the player's sedan in the lane (nightseat's helper inlined)
  const pose = (cx, cz, h, tx, tz) => {
    const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
    for (let i = 0; i < 2000; i++) { d.world.update(cx, cz, 60); if (![...d.world.chunks.values()].some((c) => c.lod !== c.wantLod)) break; }
    d.camera.position.set(cx, gy(cx, cz) + h, cz); d.camera.lookAt(tx, gy(tx, tz) + 2, tz); d.camera.updateMatrixWorld(true);
  };
  pose(-3822, -1405, 12, -3600, -1100);
  const { GFX, GFXU } = await import('/apps/autokw/src/gfx.js');
  window.__tod = 'day'; window.__noGfx = false;
  await frames(4);
  ok(GFXU.gfxLacq.value === 1 && GFXU.gfxWater.value === 1, `day, all on: gfxLacq ${GFXU.gfxLacq.value} gfxWater ${GFXU.gfxWater.value}`);
  ok(GFXU.gfxFogSun.value.w === 0, `day: dusk fog off (w ${GFXU.gfxFogSun.value.w})`);
  const LG = window.__lampGlow;
  ok(LG && !LG.mesh.visible, `day: lamp glow not drawn (visible ${LG && LG.mesh.visible})`);
  ok(srcHas('gfxLacq'), 'a compiled program carries the lacquer (gfxLacq)');
  ok(srcHas('gfxWater'), 'a compiled program carries the water terms (gfxWater)');
  ok(srcHas('gfxFogSun'), 'fogged programs carry the dusk fog (gfxFogSun)');
  for (const [k, u] of [['__noCarCoat', 'gfxLacq'], ['__noWaterFx', 'gfxWater']]) {
    window[k] = true; await frames(2);
    ok(GFXU[u].value === 0, `${k} -> ${u} ${GFXU[u].value}`);
    window[k] = false; await frames(2);
  }
  window.__tod = 'dusk'; await frames(4);
  const w = GFXU.gfxFogSun.value.w, T = GFXU.gfxFogT.value, A = GFXU.gfxFogA.value;
  ok(w > 0.5, `dusk: fog w ${w.toFixed(2)}`);
  ok(T.r > A.r && T.r > T.b, `dusk: toward-sun fog warm and brighter than away (T ${T.r.toFixed(2)},${T.g.toFixed(2)},${T.b.toFixed(2)} A ${A.r.toFixed(2)},${A.g.toFixed(2)},${A.b.toFixed(2)})`);
  const den0 = d.scene.fog.density;
  window.__noDuskHaze = true; await frames(2);
  ok(GFXU.gfxFogSun.value.w === 0 && d.scene.fog.density < den0, `__noDuskHaze -> w 0, density ${den0.toExponential(2)} -> ${d.scene.fog.density.toExponential(2)}`);
  window.__noDuskHaze = false;
  window.__tod = 'night'; await frames(6);
  ok(LG.mesh.visible && LG.count > 10, `night King St: glow drawn, ${LG.count} sprites (${LG.nLamps} lamps)`);
  d.game.paused = false; await frames(90); d.game.paused = true; await frames(2);
  const cars = LG.count - LG.nLamps;
  out.push(`info night: ${LG.count} sprites, ${LG.nLamps} lamps, ${cars} car-lamp sprites; scene draws ${d.sceneStats.calls}`);
  window.__noLampGlow = true; await frames(3);
  const draws0 = d.sceneStats.calls;
  ok(!LG.mesh.visible, `__noLampGlow -> not drawn (scene draws ${draws0})`);
  window.__noLampGlow = false; await frames(3);
  out.push(`info: glow on -> scene draws ${d.sceneStats.calls} (off ${draws0})`);
  // CPU: the glow's update and the fog's colours, per call
  const tr = d.traffic.cars, TK = { head: 1 };
  let t0 = performance.now();
  for (let i = 0; i < 200; i++) { LG._t = -1e9; LG.update(d.camera, d.world, tr, 1, 1, 0.0003, i, null); }
  const tChoose = (performance.now() - t0) / 200;
  t0 = performance.now();
  for (let i = 0; i < 200; i++) LG.update(d.camera, d.world, tr, 1, 1, 0.0003, 1e6, null);
  const tFrame = (performance.now() - t0) / 200;
  const { gfxFog } = await import('/apps/autokw/src/gfx.js');
  window.__tod = 'dusk'; await frames(3);
  t0 = performance.now();
  for (let i = 0; i < 200; i++) gfxFog(d.world.skyUniforms, 1, 0, 0);
  const tFog = (performance.now() - t0) / 200;
  out.push(`cpu: glow update (cars only) ${tFrame.toFixed(3)} ms/frame, with the lamp re-choice (every 0.25 s) ${tChoose.toFixed(3)} ms; dusk fog colours ${tFog.toFixed(4)} ms/frame`);
  // the glow program's compile, alone
  const sc = new d.THREE.Scene(); const m2 = LG.mesh.clone(); m2.material = LG.mat.clone(); m2.material.defines = { GFX_PROBE: performance.now() | 0 }; m2.visible = true; sc.add(m2);
  t0 = performance.now(); r.compile(sc, d.camera); const gl = r.getContext(); gl.finish();
  out.push(`compile: the glow program ${(performance.now() - t0).toFixed(1)} ms (desktop Chrome, 8x CPU; a fresh program)`);
  m2.material.dispose();
  window.__tod = 'day';
  return out.join('\n');
})()
