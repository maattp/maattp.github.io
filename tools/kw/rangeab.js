// A/B inside one boot, to the pixel: for kwshots.mjs VIEW_PROBE_FILE. In each
// view (the player's spawn first, then window.__abViews: kwshots-style
// { name, c: [x, z, h], t: [x, z, h], fov } or { name, at, alt, bearing,
// pitch }), with everything that moves while paused frozen, the scene pass's
// target is read with the build as it is (A), then with window.__abOld run
// (B: the old behaviour put back), then with window.__abNew run (A again).
// Prints the pixels B changes and the draws each side. Default A/B: the small
// flags' range cull (landmarks.js FLAG_RANGE) against flags drawn everywhere.
//
//   VIEW_BOOT_FILE=tools/kw/seedrandom.js VIEW_PROBE_FILE=tools/kw/rangeab.js \
//     AUTO_PHONE=1 AUTO_GPU=1 node tools/kw/kwshots.mjs /tmp/x
(async () => {
  const d = window.__dbg, R = d.renderer;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const flags = () => d.lmRoot.userData.near.filter((n) => n.o.name.startsWith('landmarks:flags:'));
  const OLD = window.__abOld || (() => { for (const n of flags()) { n.r0 = n.r; n.r = 1e9; } });
  const NEW = window.__abNew || (() => { for (const n of flags()) n.r = n.r0; });
  d.game.paused = false; d.camera.fov = 62; d.camera.updateProjectionMatrix();
  await sleep(6000);
  d.game.paused = true;
  d.world.animate = () => {};
  Object.defineProperty(d.world.trees.timeU, 'value', { get() { return 1234; }, set() {} });
  await sleep(1000);
  const pf = d.postfx, prender = pf.render, T = pf.target;
  let want = null;
  pf.render = function (...a) {
    if (want) { const px = new Uint8Array(T.width * T.height * 4); R.readRenderTargetPixels(T, 0, 0, T.width, T.height, px); const w = want; want = null; w([px, d.sceneStats.calls]); }
    return prender.apply(this, a);
  };
  const grab = async () => { await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => requestAnimationFrame(r)); return new Promise((res) => { want = res; }); };
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
  const pose = (V) => {
    let cx, cz, tx, tz, cy, ty;
    if (V.at) { [cx, cz] = V.at; const b = V.bearing * Math.PI / 180, p = (V.pitch || 0) * Math.PI / 180; tx = cx + Math.sin(b) * Math.cos(p) * 1000; tz = cz - Math.cos(b) * Math.cos(p) * 1000; } else { [cx, cz] = V.c; [tx, tz] = V.t; }
    const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
    d.world.update(cx, cz, 60);
    for (let i = 0; i < 2000 && pending() > 0; i++) d.world.update(cx, cz, 60);
    const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
    cy = V.alt !== undefined ? V.alt : gy(cx, cz) + (V.at ? V.at[2] : V.c[2]);
    ty = V.at ? cy + Math.sin((V.pitch || 0) * Math.PI / 180) * 1000 : gy(tx, tz) + V.t[2];
    d.camera.fov = V.fov || 62; d.camera.updateProjectionMatrix();
    d.camera.position.set(cx, cy, cz); d.camera.lookAt(tx, ty, tz); d.camera.updateMatrixWorld(true);
    d.sun.position.set(cx - 215, cy + 200, cz - 150); d.sun.target.position.set(cx, gy(cx, cz), cz); d.sun.target.updateMatrixWorld();
  };
  const out = [];
  const views = [{ name: 'spawn (player view)' }, ...(window.__abViews || [])];
  for (const V of views) {
    if (V.c || V.at) { pose(V); await sleep(+(window.__abWait || 3000)); }
    const [A, ca] = await grab();
    const [A2] = await grab();
    OLD();
    const [B, cb] = await grab();
    NEW();
    const [A3] = await grab();
    out.push(`${V.name}: draws ${ca} (old ${cb}), pixels changed by the old behaviour ${diff(A, B)}  (A/A ${diff(A, A2)}, after ${diff(A, A3)})`);
  }
  pf.render = prender;
  return out.join('\n');
})()
