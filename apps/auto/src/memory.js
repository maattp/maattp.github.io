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
export function releaseTextureSources(renderer, scene, extraMaterials = []) {
  const props = renderer.properties;
  const stat = { pending: 0, released: 0, bytes: 0 };
  const texs = new Set();
  const note = (t) => { if (t && t.isTexture && !t.isRenderTargetTexture && !t.isVideoTexture) texs.add(t); };
  const fromMat = (m) => {
    if (!m) return;
    for (const k in m) { const v = m[k]; if (v && v.isTexture) note(v); }
    if (m.uniforms) for (const k in m.uniforms) { const u = m.uniforms[k]; if (u && u.value && u.value.isTexture) note(u.value); }
  };
  scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) fromMat(m);
  });
  // materials whose meshes are made later (Link's and freight's streamed chunks)
  for (const m of extraMaterials) fromMat(m);
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

/**
 * A running total of what the GPU holds for this page, for the flight
 * recorder: Safari reports no JS heap, and WebKit counts its GPU process's
 * allocations against the page, so this is the figure a crash log can carry.
 * Wraps the context's own allocation calls (instance properties shadowing the
 * prototype's, so a harness's own wrapping still sees every call): a buffer's
 * size at bufferData, a texture level's at tex(Sub)Image/texStorage, a
 * renderbuffer's at renderbufferStorage, each forgotten at its delete. Only
 * allocations go through these, never per-frame updates (three uses
 * bufferSubData for those), so the cost is a Map write per upload. Bytes are
 * what was asked for; drivers round up. `read()` -> MB.
 */
export function installGpuLedger(gl) {
  const L = { buf: 0, tex: 0, rb: 0, peak: 0 };
  const bufs = new Map(), texs = new Map(), rbs = new Map();
  // bytes per texel of the internal formats three asks for (others: 4)
  const BPP = { 0x8229: 1, 0x1909: 1, 0x822B: 2, 0x8D62: 2, 0x822D: 2, 0x81A5: 2, 0x8051: 3, 0x8C41: 3, 0x1907: 3, 0x881A: 8, 0x8814: 16, 0x822F: 4, 0x8230: 8 };
  const bpp = (f) => BPP[f] || 4;
  const total = () => { const t = L.buf + L.tex + L.rb; if (t > L.peak) L.peak = t; };
  // Only allocations and deletes are wrapped -- never the binds, which run
  // hundreds of times a frame: what is bound is asked of the context, whose
  // binding queries WebKit and Chrome answer from their own client-side state.
  const wrap = (name, f) => { const o = gl[name]; if (typeof o !== 'function') return; gl[name] = function () { try { f.apply(null, arguments); } catch (e) { /* the ledger never breaks a call */ } return o.apply(gl, arguments); }; };
  const BIND = { 0x8892: 0x8894, 0x8893: 0x8895, 0x8A11: 0x8A28, 0x88EB: 0x88ED, 0x88EC: 0x88EF, 0x8F36: 0x8F36, 0x8F37: 0x8F37, 0x8C8E: 0x8C8F };
  wrap('bufferData', (t, d, u, off, len) => {
    const b = BIND[t] && BIND[t] !== t ? gl.getParameter(BIND[t]) : null; if (!b) return;
    const n = typeof d === 'number' ? d : d ? (len ? len * (d.BYTES_PER_ELEMENT || 1) : d.byteLength - (off || 0) * (d.BYTES_PER_ELEMENT || 1)) : 0;
    L.buf += n - (bufs.get(b) || 0); bufs.set(b, n); total();
  });
  wrap('deleteBuffer', (b) => { if (bufs.has(b)) { L.buf -= bufs.get(b); bufs.delete(b); } });
  // the texture bound to the active unit for a target (cube faces: the cube)
  const cur = (t) => gl.getParameter(t === 0x0DE1 ? 0x8069 : t === 0x806F ? 0x806A : t === 0x8C1A ? 0x8C1D : 0x8514);
  const lvl = (x, key, n) => {
    if (!x) return;
    let m = texs.get(x); if (!m) texs.set(x, (m = new Map()));
    L.tex += n - (m.get(key) || 0); m.set(key, n); total();
  };
  wrap('texImage2D', function (t, l, f) {
    let w, h;
    if (arguments.length >= 8) { w = arguments[3]; h = arguments[4]; }
    else { const s = arguments[5]; w = s.videoWidth || s.naturalWidth || s.width; h = s.videoHeight || s.naturalHeight || s.height; }
    lvl(cur(t), t + ':' + l, w * h * bpp(f));
  });
  wrap('texStorage2D', (t, levels, f, w, h) => {
    let n = 0; for (let i = 0; i < levels; i++) n += Math.max(1, w >> i) * Math.max(1, h >> i) * bpp(f) * (t === 0x8513 ? 6 : 1);
    lvl(cur(t), 's', n);
  });
  wrap('texImage3D', (t, l, f, w, h, d) => lvl(cur(t), t + ':' + l, w * h * d * bpp(f)));
  wrap('texStorage3D', (t, levels, f, w, h, d) => {
    let n = 0; for (let i = 0; i < levels; i++) n += Math.max(1, w >> i) * Math.max(1, h >> i) * d * bpp(f);
    lvl(cur(t), 's', n);
  });
  wrap('generateMipmap', (t) => {
    const x = cur(t), m = x && texs.get(x); if (!m) return;
    let base = 0; for (const [k, v] of m) if (k.endsWith(':0')) base += v;
    lvl(x, 'mips', Math.round(base / 3));
  });
  wrap('deleteTexture', (x) => { const m = texs.get(x); if (m) { for (const v of m.values()) L.tex -= v; texs.delete(x); } });
  const rbSet = (n) => { const r = gl.getParameter(0x8CA7); if (!r) return; L.rb += n - (rbs.get(r) || 0); rbs.set(r, n); total(); };
  wrap('renderbufferStorage', (t, f, w, h) => rbSet(w * h * bpp(f)));
  wrap('renderbufferStorageMultisample', (t, s, f, w, h) => rbSet(w * h * bpp(f) * Math.max(1, s)));
  wrap('deleteRenderbuffer', (r) => { if (rbs.has(r)) { L.rb -= rbs.get(r); rbs.delete(r); } });
  const MB = (b) => Math.round(b / 1048576);
  L.read = () => {
    const c = gl.canvas, fb = c ? c.width * c.height * 4 * 3 : 0;   // the drawing buffer: two colour + depth
    return { gpuMB: MB(L.buf + L.tex + L.rb + fb), bufMB: MB(L.buf), texMB: MB(L.tex + L.rb), gpuPeakMB: MB(L.peak + fb) };
  };
  return L;
}
