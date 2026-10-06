// MEMORY on a phone: what the game can let go of once the GPU has it, and a
// running estimate of what it holds (the flight recorder's `memMB`), because
// Safari reports no JS heap and an iPhone ends the page for memory without a
// word. See apps/auto/CLAUDE.md "Memory".

/**
 * Every texture drawn from a canvas, an image or a bitmap keeps that source
 * after upload -- a canvas's backing store, outside the JS heap in both
 * engines, ~95 MB for this game's textures. On a phone each one is let go as
 * soon as its texture is on the GPU and current: the image becomes a stub with
 * its size, and a canvas no other texture still waits for is cut to 0 x 0,
 * which frees its store even where something else keeps the element.
 *
 * Safe because nothing here redraws a texture after it is made (no runtime
 * `needsUpdate` on a texture; checked when this went in) and nothing clones
 * one (a clone shares its Source). A lost context reloads the page on a phone
 * (main.js), so nothing needs the source again. Textures made later than this
 * call keep theirs.
 *
 * Returns { pending, released, bytes } -- live counts, for the boot log.
 */
export function releaseTextureSources(renderer, scene) {
  const props = renderer.properties;
  const stat = { pending: 0, released: 0, bytes: 0 };
  const texs = new Set();
  const note = (t) => { if (t && t.isTexture && !t.isRenderTargetTexture && !t.isVideoTexture) texs.add(t); };
  scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture) note(v); }
      if (m.uniforms) for (const k in m.uniforms) { const u = m.uniforms[k]; if (u && u.value && u.value.isTexture) note(u.value); }
    }
  });
  if (scene.environment) note(scene.environment);
  if (scene.background && scene.background.isTexture) note(scene.background);
  // a canvas is cut only when every texture drawn from it has gone
  const users = new Map();
  for (const t of texs) { const im = t.image; if (im) users.set(im, (users.get(im) || 0) + 1); }
  const current = (t) => { const p = props.get(t); return p.__webglInit === true && p.__version === t.version; };
  const release = (t) => {
    const im = t.image;
    if (!im || im.__released || !current(t)) return false;
    const w = im.width || 0, h = im.height || 0;
    if (!w || !h) return false;
    const isCanvas = typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement;
    const isBitmap = typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap;
    const isData = !!(im.data && ArrayBuffer.isView(im.data));
    if (!isCanvas && !isBitmap && !isData && !(typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement)) return false;
    stat.bytes += isData ? im.data.byteLength : w * h * 4;
    // the stub three would see if it ever uploaded again: a size, no pixels
    // (a DataTexture's null data allocates a blank texture rather than throw)
    t.image = isData ? { width: w, height: h, depth: im.depth, data: null, __released: true } : { width: w, height: h, __released: true };
    const left = (users.get(im) || 1) - 1;
    users.set(im, left);
    if (left === 0) {
      if (isCanvas) { im.width = 0; im.height = 0; }
      else if (isBitmap && im.close) im.close();
    }
    stat.released++;
    return true;
  };
  for (const t of texs) {
    if (release(t)) continue;
    stat.pending++;
    // not drawn yet: let go right after its first upload (three calls
    // onUpdate at the end of uploadTexture; the release waits a task so the
    // upload and its mipmaps are finished)
    const prev = t.onUpdate;
    t.onUpdate = function (tex) {
      if (prev) prev.call(this, tex);
      setTimeout(() => { if (release(t)) { stat.pending--; t.onUpdate = prev || null; } }, 0);
    };
  }
  return stat;
}
