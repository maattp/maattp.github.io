// Which draws can be seen? For kwshots.mjs VIEW_PROBE_FILE: settles the
// PLAYER view (the spawn; window.__dpEval poses something else first),
// pauses, then hides each scene-pass draw in turn (layers, so the shadow pass
// loses it too) and counts the screen pixels that change against the frame
// with everything drawn. A draw that changes 0 pixels is invisible here: a
// range cull that drops it costs nothing in this view. The A/A line is the
// noise floor (two frames, nothing hidden: water, clouds, flags).
//
//   VIEW_BOOT_FILE=tools/kw/seedrandom.js VIEW_PROBE_FILE=tools/kw/drawpixels.js \
//     AUTO_PHONE=1 AUTO_GPU=1 node tools/kw/kwshots.mjs /tmp/x
(async () => {
  const d = window.__dbg, R = d.renderer, gl = R.getContext();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (window.__dpEval) eval(window.__dpEval);
  d.game.paused = false; d.camera.fov = 62; d.camera.updateProjectionMatrix();
  await sleep(+(window.__dpWait || 6000));
  d.game.paused = true;
  // what still moves while paused: the sky and water (world.animate) and the
  // trees' sway (real time) -- frozen, a paused frame repeats to the pixel
  d.world.animate = () => {};
  Object.defineProperty(d.world.trees.timeU, 'value', { get() { return 1234; }, set() {} });
  await sleep(1000);
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  // the composited frame, read straight after the post chain draws it
  const pf = d.postfx, prender = pf.render;
  let want = null;
  // the scene pass's own target, read before the post chain (whose grain and
  // dither move every frame); window.__dpPost = true reads the screen instead
  const T = pf.target;
  pf.render = function (...a) {
    if (want && !window.__dpPost) { const px = new Uint8Array(T.width * T.height * 4); R.readRenderTargetPixels(T, 0, 0, T.width, T.height, px); const w = want; want = null; w(px); }
    const r = prender.apply(this, a);
    if (want) { const px = new Uint8Array(W * H * 4); R.setRenderTarget(null); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); const w = want; want = null; w(px); }
    return r;
  };
  const grab = async () => { await new Promise((r) => requestAnimationFrame(r)); return new Promise((res) => { want = res; }); };
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
  const diff3 = (a, c, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] === c[i] && a[i + 1] === c[i + 1] && a[i + 2] === c[i + 2] && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])) n++; return n; };
  // this frame's scene-pass draws
  const objs = new Map();
  const orig = R.renderBufferDirect; let on = false;
  R.renderBufferDirect = function (camera, scene, geometry, material, object) { if (on && camera === d.camera && !objs.has(object)) objs.set(object, material); return orig.apply(this, arguments); };
  await new Promise((res) => requestAnimationFrame(() => { on = true; requestAnimationFrame(() => { on = false; res(); }); }));
  R.renderBufferDirect = orig;
  const A = await grab(), A2 = await grab();
  const out = [`${W}x${H}, ${objs.size} scene-pass objects; A/A noise ${diff(A, A2)} px`];
  const rows = [];
  for (const [o, m] of objs) {
    const L = o.layers.mask;
    // a pixel counts when the frames either side (drawn) agree on it and the
    // hidden frame does not: water and clouds move even while paused
    const R1 = await grab();
    o.layers.set(31);
    const B = await grab();
    o.layers.mask = L;
    const R2 = await grab();
    const n = diff3(R1, R2, B);
    const p = []; for (let q = o; q && q !== d.scene; q = q.parent) if (q.name) { p.push(q.name); break; }
    const pos = new d.THREE.Vector3(); o.getWorldPosition(pos);
    let dist = -1;
    if (o.geometry && !o.isInstancedMesh && !o.isSkinnedMesh) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); dist = Math.max(0, s.center.distanceTo(d.camera.position) - s.radius); }
    rows.push([n, `${String(n).padStart(6)} px  ${(p[0] || o.type)}  ${m.type}  near ${dist.toFixed(0)} m`]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  for (const r of rows) out.push(r[1]);
  out.push(`invisible draws (0 px): ${rows.filter((r) => r[0] === 0).length}`);
  pf.render = prender;
  return out.join('\n');
})()
