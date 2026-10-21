// A frozen frame of the player view, for comparing two builds to the pixel:
// for kwshots.mjs VIEW_PROBE_FILE. Settles the spawn (window.__fsWait ms,
// default 6000), pauses, freezes what moves while paused (sky, water, the
// trees' sway), turns the post chain's grain and dither off, and prints
// `DRAWS n` and `PNG <data url>` lines: the scene pass's target (before post)
// and the final frame. With VIEW_BOOT_FILE=tools/kw/seedrandom.js two builds
// boot the same world; what still differs is what moves (traffic, peds,
// trains), which the first few seconds' frame timing decides.
//
//   VIEW_BOOT_FILE=tools/kw/seedrandom.js VIEW_PROBE_FILE=tools/kw/frameshot.js \
//     AUTO_PHONE=1 AUTO_GPU=1 node tools/kw/kwshots.mjs /tmp/x | grep '^PNG' ...
(async () => {
  const d = window.__dbg, R = d.renderer, gl = R.getContext();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  d.game.paused = false; d.camera.fov = 62; d.camera.updateProjectionMatrix();
  await sleep(+(window.__fsWait || 6000));
  d.game.paused = true;
  d.world.animate = () => {};
  Object.defineProperty(d.world.trees.timeU, 'value', { get() { return 1234; }, set() {} });
  d.postfx.fx.grain = false; d.postfx.fx.dither = false;
  if (d.postfx.applyFx) d.postfx.applyFx();
  await sleep(1000);
  const pf = d.postfx, prender = pf.render, T = pf.target;
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  let want = null;
  pf.render = function (...a) {
    if (!want) return prender.apply(this, a);
    const sc = new Uint8Array(T.width * T.height * 4); R.readRenderTargetPixels(T, 0, 0, T.width, T.height, sc);
    const r = prender.apply(this, a);
    const fin = new Uint8Array(W * H * 4); R.setRenderTarget(null); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, fin);
    const w = want; want = null; w([[sc, T.width, T.height], [fin, W, H]]);
    return r;
  };
  await new Promise((r) => requestAnimationFrame(r));
  const shots = await new Promise((res) => { want = res; });
  pf.render = prender;
  const png = ([a, w, h]) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'), im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) im.data.set(a.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255;
    g.putImageData(im, 0, 0);
    return cv.toDataURL('image/png');
  };
  return `DRAWS ${d.sceneStats.calls}\nPNG ${png(shots[0])}\nPNG ${png(shots[1])}`;
})()
