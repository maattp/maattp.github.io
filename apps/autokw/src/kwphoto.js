// PHOTO MODE (Auto KW): freeze the world, hide the HUD, fly a free camera around the player (or
// the car) and SNAP a picture that is shared through the iOS share sheet (Save Image) or downloaded.
//
//   - PAUSE MENU > Photo mode, or P on a keyboard. The world is held with game.hold('photo')
//     (reapHolds' live list knows `photo`), so traffic, peds and the sim stand still but the
//     frame still draws every frame (the hold is not an "idle" screen) -- the FOV slider, a look
//     and a time-of-day change all show at once.
//   - THE CAMERA orbits a target that starts on the player: one finger / left mouse drags the
//     orbit, two fingers pinch (zoom = orbit radius) and drag (pan the target), mouse wheel zooms,
//     right or shift mouse drag pans, WASD slides the target, Q / E lowers / raises it. It stays
//     within MAX_R (60 m) of the player; it is never under the ground (+1 m) and never in a
//     building (the ray from the target is marched and stops short of a wall).
//   - THE BAR: FOV slider, looks (none, warm, cool, B&W, vintage, punchy) -- a CSS filter on the
//     canvas for the preview, and BAKED into the saved image -- a time-of-day nudge, HIDE ME (the
//     player / vehicle model), SNAP and EXIT.
//   - SNAP renders one frame in the same task (the GL canvas is not preserved), copies it into a 2D
//     canvas with the look applied (ctx.filter, or -- Safari has none -- the same look as a pixel
//     pass), stamps "Auto KW . <place> . <date>", turns it into a JPEG SYNCHRONOUSLY (the tap's
//     user activation is what navigator.share needs; an await can lose it on iOS) and shares it
//     as a file, else downloads it.
//   - EXIT puts back the camera (position, rotation, fov), the HUD, the time of day, the
//     player's model and the hold.
//
// Cost when not in photo mode: nothing (no DOM until the first enter, one idle `active` flag).
// Probe: tools/kw/photoprobe.mjs.

import * as THREE from './three.js';
import * as G from './geo.js';

const MAX_R = 60;        // the camera stays this close to the player
const MIN_D = 1.2, MAX_D = 60;
const PAN_R = 22;       // how far the target may be panned off the player
const FLOOR = 1.0;       // above the ground

/** The looks. CSS filter strings are built from these, and so is the pixel fallback (Safari has no ctx.filter). */
export const LOOKS = [
  { id: 'none', name: 'Natural' },
  { id: 'warm', name: 'Warm', sep: 0.28, sat: 1.25, con: 1.05, bri: 1.04 },
  { id: 'cool', name: 'Cool', hue: -16, sat: 1.1, bri: 1.03 },
  { id: 'bw', name: 'B&W', gray: 1, con: 1.15 },
  { id: 'vintage', name: 'Vintage', sep: 0.55, sat: 0.85, con: 0.92, bri: 1.06 },
  { id: 'punchy', name: 'Punchy', con: 1.3, sat: 1.35 },
];
export function lookCss(l) {
  if (!l || l.id === 'none') return 'none';
  const f = [];
  if (l.bri) f.push(`brightness(${l.bri})`);
  if (l.con) f.push(`contrast(${l.con})`);
  if (l.sat) f.push(`saturate(${l.sat})`);
  if (l.sep) f.push(`sepia(${l.sep})`);
  if (l.gray) f.push(`grayscale(${l.gray})`);
  if (l.hue) f.push(`hue-rotate(${l.hue}deg)`);
  return f.join(' ') || 'none';
}
/** The same look as a pixel pass over ImageData (the CSS filter spec's matrices, in the same order). */
export function applyLookPixels(d, l) {
  if (!l || l.id === 'none') return;
  const bri = l.bri || 1, con = l.con || 1, sat = l.sat || 1, sep = l.sep || 0, gr = l.gray || 0, hue = (l.hue || 0) * Math.PI / 180;
  const sp = 1 - Math.min(1, sep), gp = 1 - Math.min(1, gr);
  const c = Math.cos(hue), s = Math.sin(hue);
  const H = [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072];
  const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * bri, g = d[i + 1] * bri, b = d[i + 2] * bri;
    r = (r - 127.5) * con + 127.5; g = (g - 127.5) * con + 127.5; b = (b - 127.5) * con + 127.5;
    r = cl(r); g = cl(g); b = cl(b);
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat;
    r = cl(r); g = cl(g); b = cl(b);
    if (sep) {
      const R = (0.393 + 0.607 * sp) * r + (0.769 - 0.769 * sp) * g + (0.189 - 0.189 * sp) * b;
      const Gc = (0.349 - 0.349 * sp) * r + (0.686 + 0.314 * sp) * g + (0.168 - 0.168 * sp) * b;
      const B = (0.272 - 0.272 * sp) * r + (0.534 - 0.534 * sp) * g + (0.131 + 0.869 * sp) * b;
      r = cl(R); g = cl(Gc); b = cl(B);
    }
    if (gr) {
      const R = (0.2126 + 0.7874 * gp) * r + (0.7152 - 0.7152 * gp) * g + (0.0722 - 0.0722 * gp) * b;
      const Gc = (0.2126 - 0.2126 * gp) * r + (0.7152 + 0.2848 * gp) * g + (0.0722 - 0.0722 * gp) * b;
      const B = (0.2126 - 0.2126 * gp) * r + (0.7152 - 0.7152 * gp) * g + (0.0722 + 0.9278 * gp) * b;
      r = cl(R); g = cl(Gc); b = cl(B);
    }
    if (hue) {
      const R = H[0] * r + H[1] * g + H[2] * b, Gc = H[3] * r + H[4] * g + H[5] * b, B = H[6] * r + H[7] * g + H[8] * b;
      r = cl(R); g = cl(Gc); b = cl(B);
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
}

const CSS = `
body.photo #hud, body.photo #topBtns, body.photo #pad, body.photo #stickZone, body.photo #lookZone,
body.photo #sigBtns, body.photo #medBtns, body.photo #fireBtns, body.photo #hurt, body.photo #minimapWrap { display: none !important; }
#photoLayer { position: fixed; inset: 0; z-index: 30; display: none; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
#photoLayer.show { display: block; }
#photoFlash { position: fixed; inset: 0; z-index: 33; background: #fff; opacity: 0; pointer-events: none; }
#photoFlash.go { animation: photoFlash .35s ease-out; }
@keyframes photoFlash { 0% { opacity: .9; } 100% { opacity: 0; } }
#photoBar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 32; display: none; align-items: center; gap: 8px; flex-wrap: nowrap;
  padding: 8px calc(env(safe-area-inset-right) + 12px) calc(env(safe-area-inset-bottom) + 8px) calc(env(safe-area-inset-left) + 12px);
  background: linear-gradient(to top, rgba(8,10,16,.82), rgba(8,10,16,.55)); color: #eef; font: 600 12px/1 -apple-system, system-ui, sans-serif; touch-action: manipulation; }
#photoBar.show { display: flex; }
#photoBar button { font: inherit; color: #eef; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.22); border-radius: 8px; padding: 9px 10px; min-height: 36px; white-space: nowrap; }
#photoBar button.on { background: #e8b84a; color: #1a1a2e; border-color: #e8b84a; }
#photoBar #photoSnap { background: #fff; color: #111; font-weight: 800; letter-spacing: .06em; padding: 9px 18px; border-radius: 22px; }
#photoBar #photoExit { margin-left: auto; }
#photoBar .fov { display: flex; align-items: center; gap: 6px; }
#photoBar input[type=range] { width: 92px; }
#photoLooks { display: flex; gap: 5px; overflow-x: auto; -webkit-overflow-scrolling: touch; flex: 1 1 auto; min-width: 0; }
#photoHint { position: fixed; top: calc(env(safe-area-inset-top) + 10px); left: 50%; transform: translateX(-50%); z-index: 32; padding: 7px 12px; border-radius: 14px;
  background: rgba(8,10,16,.6); color: #eef; font: 600 12px -apple-system, system-ui, sans-serif; pointer-events: none; transition: opacity .6s; white-space: nowrap; display: none; }
#photoHint.show { display: block; }
#photoHint.fade { opacity: 0; }
`;

export class PhotoMode {
  /** env: { game, camera, player, city, renderer, hud, audio, getTod, setTod, drawNow }. */
  constructor(env) {
    this.e = env;
    this.active = false;
    this.built = false;
    this.last = null;            // { blob, w, h, name, how, look } of the latest snap (the probe reads it)
    this.fallback = !(typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype);
    this.look = 0;
    this.hidden = false;
    this.ptrs = new Map();
    this.keys = new Set();
    this.T = new THREE.Vector3();    // orbit target
    this.pan = new THREE.Vector3();  // its offset from the player
    this.yaw = 0; this.pitch = 0.3; this.dist = 6;
    this.clamped = '';
    this._saved = null;
  }

  _build() {
    if (this.built) return;
    this.built = true;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    const mk = (tag, id, parent) => { const el = document.createElement(tag); if (id) el.id = id; (parent || document.body).appendChild(el); return el; };
    this.layer = mk('div', 'photoLayer');
    this.flash = mk('div', 'photoFlash');
    this.hint = mk('div', 'photoHint');
    this.hint.textContent = 'Drag to orbit  ·  pinch to zoom  ·  two fingers to pan';
    const bar = this.bar = mk('div', 'photoBar');
    bar.innerHTML = '<div class="fov"><span>FOV</span><input type="range" id="photoFov" min="20" max="100" step="1" value="62" aria-label="Field of view"></div>'
      + '<div id="photoLooks"></div>'
      + '<button id="photoTime">TIME</button><button id="photoHide">HIDE ME</button>'
      + '<button id="photoSnap">SNAP</button><button id="photoExit">EXIT</button>';
    this.fovEl = bar.querySelector('#photoFov');
    this.looksEl = bar.querySelector('#photoLooks');
    this.lookBtns = LOOKS.map((l, i) => {
      const b = document.createElement('button');
      b.textContent = l.name;
      b.dataset.look = l.id;
      b.addEventListener('click', () => this.setLook(i));
      this.looksEl.appendChild(b);
      return b;
    });
    this.fovEl.addEventListener('input', () => { this.e.camera.fov = +this.fovEl.value; this.e.camera.updateProjectionMatrix(); });
    bar.querySelector('#photoTime').addEventListener('click', () => this.cycleTime());
    this.hideBtn = bar.querySelector('#photoHide');
    this.hideBtn.addEventListener('click', () => this.setHidden(!this.hidden));
    bar.querySelector('#photoSnap').addEventListener('click', () => this.snap());
    bar.querySelector('#photoExit').addEventListener('click', () => this.exit());
    // the bar's own taps must not orbit
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());

    const L = this.layer;
    L.addEventListener('pointerdown', (e) => this._down(e));
    L.addEventListener('pointermove', (e) => this._move(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) L.addEventListener(t, (e) => this._up(e));
    L.addEventListener('wheel', (e) => { e.preventDefault(); this.dist *= Math.exp(e.deltaY * 0.0012); }, { passive: false });
    L.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'Escape') { e.preventDefault(); this.exit(); return; }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target && e.target.tagName)) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.ptrs.clear(); });
  }

  // ---- input ------------------------------------------------------------------------------

  _down(e) {
    if (!this.active) return;
    try { this.layer.setPointerCapture(e.pointerId); } catch (err) { /* best-effort */ }
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, btn: e.button, shift: e.shiftKey });
    this._pinch = 0;
    this.hint.classList.add('fade');
  }
  _up(e) {
    this.ptrs.delete(e.pointerId);
    this._pinch = 0;
    if (!this.ptrs.size) this._pinch = 0;
  }
  _move(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p || !this.active) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    const n = this.ptrs.size;
    if (n === 1) {
      if (p.btn === 2 || p.shift) this._panBy(dx, dy);
      else { this.yaw -= dx * 0.0065; this.pitch += dy * 0.005; }
    } else if (n === 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this._pinch > 0 && d > 4) this.dist *= this._pinch / d;
      this._pinch = d;
      // the midpoint's drift pans (each finger moved half of it)
      this._panBy(dx * 0.5, dy * 0.5);
      void px; void py;
    }
  }
  _panBy(dx, dy) {
    const k = this.dist * 0.0022;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);    // screen right on the ground
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);   // screen up = away from the camera
    this.pan.x += -dx * rx * k - dy * fx * k;
    this.pan.z += -dx * rz * k - dy * fz * k;
  }

  // ---- state ------------------------------------------------------------------------------

  _playerPos(out) {
    const p = this.e.player.position;
    return out.set(p.x, p.y + (this.e.player.vehicle ? 1.0 : 1.2), p.z);
  }

  enter() {
    const E = this.e, g = E.game;
    if (this.active || g.dead || g.held || g.mapOpen) return false;
    this._build();
    const cam = E.camera;
    this._saved = {
      pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, aspect: cam.aspect,
      tod: E.getTod ? E.getTod() : null, canvasFilter: E.renderer.domElement.style.filter || '',
    };
    this._playerPos(this.T);
    const c = cam.position;
    const o = new THREE.Vector3().subVectors(c, this.T);
    this.dist = Math.max(MIN_D, Math.min(MAX_D, o.length()));
    this.yaw = Math.atan2(o.x, o.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, o.y / (o.length() || 1))));
    this.pan.set(0, 0, 0);
    this.ptrs.clear(); this.keys.clear(); this._pinch = 0;
    this.look = 0; this.setLook(0);
    this.hidden = false; this.hideBtn.classList.remove('on');
    this.fovEl.value = String(Math.round(cam.fov));
    g.hold('photo');
    this.active = true;
    document.body.classList.add('photo');
    this.layer.classList.add('show');
    this.bar.classList.add('show');
    this.hint.classList.remove('fade');
    this.hint.classList.add('show');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.hint.classList.add('fade'), 3500);
    this.update(0);
    return true;
  }

  exit() {
    if (!this.active) return;
    const E = this.e, s = this._saved;
    this.active = false;
    this.setHidden(false);
    this.ptrs.clear(); this.keys.clear();
    document.body.classList.remove('photo');
    this.layer.classList.remove('show');
    this.bar.classList.remove('show');
    this.hint.classList.remove('show');
    E.renderer.domElement.style.filter = s.canvasFilter;
    if (E.setTod && s.tod && E.getTod && E.getTod() !== s.tod) E.setTod(s.tod);
    const cam = E.camera;
    cam.position.copy(s.pos); cam.quaternion.copy(s.quat);
    cam.fov = s.fov; cam.aspect = s.aspect; cam.updateProjectionMatrix();
    E.game.release('photo');
    this._saved = null;
  }

  setLook(i) {
    this.look = i;
    for (const b of this.lookBtns) b.classList.toggle('on', b.dataset.look === LOOKS[i].id);
    this.e.renderer.domElement.style.filter = lookCss(LOOKS[i]) === 'none' ? '' : lookCss(LOOKS[i]);
  }
  setHidden(v) {
    const E = this.e, pl = E.player;
    this.hidden = v;
    this.hideBtn.classList.toggle('on', v);
    // the model that is the player: the character on foot, else the vehicle's group
    if (v) {
      this._hid = [];
      const hide = (o) => { if (o && o.visible) { this._hid.push(o); o.visible = false; } };
      if (pl.vehicle) hide(pl.vehicle.group); else hide(pl.h && pl.h.group);
    } else if (this._hid) {
      for (const o of this._hid) o.visible = true;
      this._hid = null;
    }
  }
  cycleTime() {
    const E = this.e;
    if (!E.getTod || !E.setTod) return;
    const order = ['day', 'dusk', 'night'];
    const cur = E.getTod();
    E.setTod(order[(order.indexOf(cur) + 1) % order.length]);
  }

  // ---- the camera ---------------------------------------------------------------------------

  /** Each frame while active (before the draw): keys, then the camera from the orbit, clamped. */
  update(dt) {
    if (!this.active) return;
    const E = this.e, cam = E.camera;
    // a hold taken from under us (a respawn clears them all): leave, quietly
    if (!E.game.holds.has('photo')) { this.exit(); return; }
    if (this.keys.size && dt > 0) {
      const k = this.dist * 0.7 * dt + 0.4 * dt;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const K = this.keys;
      if (K.has('KeyW')) { this.pan.x += fx * k; this.pan.z += fz * k; }
      if (K.has('KeyS')) { this.pan.x -= fx * k; this.pan.z -= fz * k; }
      if (K.has('KeyD')) { this.pan.x += rx * k; this.pan.z += rz * k; }
      if (K.has('KeyA')) { this.pan.x -= rx * k; this.pan.z -= rz * k; }
      if (K.has('KeyE')) this.pan.y += 6 * dt;
      if (K.has('KeyQ')) this.pan.y -= 6 * dt;
    }
    // the target: the player plus the pan, the pan kept near
    const h = Math.hypot(this.pan.x, this.pan.z);
    if (h > PAN_R) { this.pan.x *= PAN_R / h; this.pan.z *= PAN_R / h; }
    this.pan.y = Math.max(-4, Math.min(20, this.pan.y));
    this._playerPos(this.T).add(this.pan);
    this.pitch = Math.max(-0.25, Math.min(1.5, this.pitch));
    this.dist = Math.max(MIN_D, Math.min(MAX_D, this.dist));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = cp * Math.sin(this.yaw), dy = sp, dz = cp * Math.cos(this.yaw);
    const T = this.T, pp = E.player.position;
    // march out from the target and stop short of a building
    let d = this.dist;
    // within MAX_R of the player
    for (let i = 0; i < 30; i++) {
      const X = T.x + dx * d - pp.x, Y = T.y + dy * d - pp.y, Z = T.z + dz * d - pp.z;
      if (X * X + Y * Y + Z * Z <= MAX_R * MAX_R) break;
      d *= 0.88;
    }
    this.clamped = d < this.dist - 1e-3 ? 'radius' : '';
    const city = E.city;
    if (city.insideBuilding && !city.insideBuilding(T.x, T.z, T.y, 0.3)) {
      const N = 14;
      let ok = 0;
      for (let s = 1; s <= N; s++) {
        const t = d * s / N, x = T.x + dx * t, z = T.z + dz * t;
        const y = Math.max(T.y + dy * t, city.groundAt(x, z, T.y, 0) + FLOOR);
        if (city.insideBuilding(x, z, y, 0.6)) break;
        ok = t;
      }
      if (ok < d) { d = Math.max(0.6, ok); this.clamped = 'building'; }
    }
    let x = T.x + dx * d, y = T.y + dy * d, z = T.z + dz * d;
    // above the ground (a bridge deck counts, from the target's height), and the water
    const floor = city.groundAt(x, z, T.y, 0) + FLOOR;
    if (y < floor) { y = floor; this.clamped = this.clamped || 'ground'; }
    const wl = E.player.waterAt ? E.player.waterAt(x, z) : null;
    if (wl !== null && wl !== undefined && y < wl + 0.5) y = wl + 0.5;
    cam.position.set(x, y, z);
    cam.lookAt(T);
    this.d = d;
    void G;
  }

  // ---- the picture --------------------------------------------------------------------------

  _shutter() {
    this.flash.classList.remove('go');
    void this.flash.offsetWidth;
    this.flash.classList.add('go');
    try {
      const a = this.e.audio, c = a && a.ctx;
      if (c && c.state === 'running') {
        const n = Math.floor(c.sampleRate * 0.09), buf = c.createBuffer(1, n, c.sampleRate), ch = buf.getChannelData(0);
        for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.012)) * (i < n * 0.45 ? 1 : 0.55);
        const src = c.createBufferSource(), gn = c.createGain(), f = c.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.7;
        src.buffer = buf; gn.gain.value = 0.6;
        src.connect(f); f.connect(gn); gn.connect(c.destination);
        src.start();
      } else if (a && a.ui) a.ui('tick');
    } catch (e) { /* the flash is enough */ }
  }

  _toast(m) {
    this.hint.textContent = m;
    this.hint.classList.remove('fade');
    this.hint.classList.add('show');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.hint.classList.add('fade'), 2200);
  }

  /** Render one frame and make the image. Returns the record (also in this.last). */
  capture() {
    const E = this.e, src = E.renderer.domElement;
    this.update(0);
    E.drawNow();                       // render now: the next toDataURL / drawImage must be in this task
    const W = src.width, H = src.height;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const look = LOOKS[this.look];
    const css = lookCss(look);
    if (css !== 'none' && !this.fallback) ctx.filter = css;
    ctx.drawImage(src, 0, 0, W, H);
    ctx.filter = 'none';
    let how = css === 'none' ? 'plain' : 'ctx.filter';
    if (css !== 'none' && this.fallback) {
      const im = ctx.getImageData(0, 0, W, H);
      applyLookPixels(im.data, look);
      ctx.putImageData(im, 0, 0);
      how = 'pixels';
    }
    // the caption: the HUD's own district label, and the date
    const place = ((E.hud && E.hud.place && E.hud.place.textContent) || '').trim();
    const date = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
    const text = ['Auto KW', place, date].filter(Boolean).join(' · ');
    const fs = Math.max(12, Math.round(H / 30));
    ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = fs * 0.35; ctx.shadowOffsetY = fs * 0.06;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(text, W - fs, H - fs * 0.8);
    ctx.shadowColor = 'transparent';
    // JPEG, synchronously
    const url = cv.toDataURL('image/jpeg', 0.92);
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const name = `autokw-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.jpg`;
    const blob = new Blob([u8], { type: 'image/jpeg' });
    this.last = { blob, w: W, h: H, name, look: look.id, how, text, canvas: cv, how2: null };
    return this.last;
  }

  /** SNAP: shutter, capture, then the share sheet (or a download). Called from a tap. */
  snap() {
    if (!this.active) return null;
    this._shutter();
    let rec;
    try { rec = this.capture(); } catch (e) { console.warn('photo: ' + e.message); this._toast('Snap failed'); return null; }
    const file = (() => { try { return new File([rec.blob], rec.name, { type: 'image/jpeg' }); } catch (e) { return null; } })();
    const nav = navigator;
    let shared = false;
    try {
      if (file && nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
        shared = true;
        rec.how2 = 'share';
        nav.share({ files: [file], title: 'Auto KW' }).then(() => this._toast('Shared'), (err) => {
          if (err && err.name === 'AbortError') this._toast('Cancelled');
          else { this._download(rec); }
        });
      }
    } catch (e) { shared = false; }
    if (!shared) { rec.how2 = 'download'; this._download(rec); }
    return rec;
  }

  _download(rec) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(rec.blob);
      a.download = rec.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 4000);
      this._toast('Saved ' + rec.name);
    } catch (e) { this._toast('Could not save'); }
  }
}
