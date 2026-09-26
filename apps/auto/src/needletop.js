// UP THE SPACE NEEDLE: the elevator, the observation deck, the binoculars.
//
// ENTER at the Needle's core rides the glass elevator on the face between the
// first two leg pairs (needle.js ELEVATOR_A) 520 ft to the top: the city keeps
// running while the camera rises with the car, looking out between the legs,
// and a counter in the car reads the height in feet as the real one does. At
// the top you step out onto the open-air deck (520 ft), which is a ring of
// city platforms between the indoor level's glass and the leaning barriers
// (needle.js needleDecks / needleSolids), and can walk all the way round.
// Six coin-op viewers stand at the rail; ENTER at one looks through it: drag
// or the stick to pan, + / - (or the wheel, Q / Z) to zoom from 2x to 16x,
// and the eyepiece names what is in the middle of the view -- a landmark if
// one is there, else the neighbourhood the view falls on -- with its distance
// and compass bearing. ENTER at the elevator door rides back down.
//
// Real: 41 s at 10 mph. Here 15 s, eased at both ends.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { clamp } from './util.js';
import { DECK, ELEVATOR_A, ELEVATOR_R, NEEDLE } from './needle.js';

const RIDE_S = 15;
const CAB_TOP = 145.2;          // the car's floor at the top, just under the saucer
const CAB_BASE = 0.35;          // and at the plaza, inside the pavilion
const FOV_MIN = 2.2, FOV_MAX = 24, FOV_START = 9;
const VIEW_N = 6;
const ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

export class NeedleTop {
  /** opts: { scene, city, world, player, camera, audio, hud, at: {x, y, z, t} } */
  constructor(opts) {
    this.o = opts;
    const { x, y, z, t } = opts.at;
    this.X = x; this.Y = y; this.Z = z; this.T = t;
    this.mode = null;           // null | 'ride' | 'view'
    this.deckY = y + DECK.y;
    const hE = this.outHeading(ELEVATOR_A);
    // the door on the deck, and where you step out of it
    this.door = { ...this.pt(ELEVATOR_A, DECK.rIn + 0.4), h: hE };
    this.arrive = { ...this.pt(ELEVATOR_A, DECK.rIn + 1.2), h: hE };
    // the six viewers, between the door and round the ring
    this.views = [];
    for (let k = 0; k < VIEW_N; k++) {
      const a = ELEVATOR_A + Math.PI / VIEW_N + (k / VIEW_N) * Math.PI * 2;
      const p = this.pt(a, DECK.rOut - 1.15);
      this.views.push({ ...p, a, h: this.outHeading(a), stand: this.pt(a, DECK.rOut - 0.45) });
    }
    this._buildProps();
    this._buildCab();
    this._buildDom();
    this._v = new THREE.Vector3();
    this._label = 0;
  }

  get busy() { return this.mode !== null; }

  /** Model angle a, radius r -> world point. */
  pt(a, r) {
    const lx = Math.cos(a) * r, lz = Math.sin(a) * r, c = Math.cos(this.T), s = Math.sin(this.T);
    return { x: this.X + lx * c + lz * s, z: this.Z - lx * s + lz * c };
  }
  /** Heading (rotation.y) facing out from the axis at model angle a. */
  outHeading(a) {
    const p = this.pt(a, 1);
    return Math.atan2(p.x - this.X, p.z - this.Z);
  }

  /** On the deck, or its floor at least? */
  onDeck(p) {
    return p.y > this.deckY - 3 && Math.hypot(p.x - this.X, p.z - this.Z) < DECK.rOut + 1;
  }

  // --- props ----------------------------------------------------------------

  _buildProps() {
    const b = new Builder(false);
    const Y = this.deckY;
    for (const v of this.views) {
      const { x, z } = v.stand, h = v.h, fx = Math.sin(h), fz = Math.cos(h), rx = fz, rz = -fx;
      const post = [0.16, 0.3, 0.27], head = [0.1, 0.36, 0.3], dark = [0.05, 0.05, 0.06];
      b.box(x, Y, z, 0.46, 0.06, 0.46, h, [0.35, 0.36, 0.37]);
      b.prism(x, Y, z, 0.075, 1.02, 10, post);
      b.box(x - fx * 0.12, Y + 0.62, z - fz * 0.12, 0.16, 0.22, 0.08, h, [0.74, 0.62, 0.2]);   // the coin box
      b.box(x, Y + 0.98, z, 0.3, 0.08, 0.16, h, post);
      b.box(x, Y + 1.05, z, 0.48, 0.3, 0.34, h, head);
      for (const s of [-1, 1]) {
        const ox = x + rx * 0.11 * s, oz = z + rz * 0.11 * s;
        b.tube([ox + fx * 0.16, Y + 1.2, oz + fz * 0.16], [ox + fx * 0.36, Y + 1.22, oz + fz * 0.36], 0.075, 12, head, true);
        b.tube([ox + fx * 0.34, Y + 1.22, oz + fz * 0.34], [ox + fx * 0.37, Y + 1.22, oz + fz * 0.37], 0.066, 12, [0.2, 0.28, 0.34], true);
        b.tube([ox - fx * 0.16, Y + 1.24, oz - fz * 0.16], [ox - fx * 0.27, Y + 1.24, oz - fz * 0.27], 0.036, 10, dark, true);
      }
    }
    // the elevator door in the indoor level's glass: frame, two leaves, the
    // lamp over it
    {
      const h = this.door.h, p = this.pt(ELEVATOR_A, DECK.rIn - 0.1), fx = Math.sin(h), fz = Math.cos(h), rx = fz, rz = -fx;
      b.box(p.x, this.deckY, p.z, 1.7, 2.6, 0.12, h, [0.93, 0.93, 0.9]);
      for (const s of [-1, 1]) b.box(p.x + rx * 0.37 * s + fx * 0.07, this.deckY + 0.02, p.z + rz * 0.37 * s + fz * 0.07, 0.7, 2.35, 0.04, h, [0.44, 0.46, 0.48]);
      b.box(p.x + fx * 0.08, this.deckY + 2.42, p.z + fz * 0.08, 0.5, 0.12, 0.04, h, [1.0, 0.72, 0.25]);
    }
    // no shadow casting: from 158 m it would land far out on the ground, and
    // on a phone every caster outside the cached statics is drawn each frame
    const m = new THREE.Mesh(b.build(), this.o.world.mats.flat);
    m.receiveShadow = true;
    m.name = 'needleTop';
    this.o.scene.add(m);
    this.props = m;
  }

  _buildCab() {
    // in the car's own frame: +z out through the open front, floor at y 0
    const b = new Builder(false);
    const W = 2.0, D = 1.7, H = 2.55, wall = [0.9, 0.9, 0.87], inner = [0.62, 0.6, 0.56], floor = [0.18, 0.18, 0.2];
    b.box(0, -0.14, 0, W, 0.14, D, 0, floor);
    b.box(0, H, 0, W, 0.14, D, 0, wall);
    b.box(0, 0, -D / 2 + 0.04, W, H, 0.06, 0, inner);
    for (const s of [-1, 1]) {
      b.box(s * (W / 2 - 0.03), 0, 0, 0.06, 1.0, D, 0, inner);                  // the side's lower half
      b.box(s * (W / 2 - 0.05), 0, D / 2 - 0.05, 0.1, H, 0.1, 0, wall);          // front posts
    }
    b.box(0, 0.98, D / 2 - 0.03, W, 0.06, 0.06, 0, [0.7, 0.7, 0.68]);            // the rail at the window
    b.box(0, H - 0.3, D / 2 - 0.05, W, 0.3, 0.1, 0, wall);                       // header
    b.box(0, H - 0.26, D / 2 - 0.12, 0.44, 0.14, 0.02, 0, [0.05, 0.05, 0.05]);   // the height display
    const m = new THREE.Mesh(b.build(), this.o.world.mats.flat);
    m.name = 'needleCab';
    this.cab = new THREE.Group();
    this.cab.add(m);
    const p = this.pt(ELEVATOR_A, ELEVATOR_R + D / 2 - 0.2);
    this.cab.position.set(p.x, this.Y + CAB_BASE, p.z);
    this.cab.rotation.y = this.outHeading(ELEVATOR_A);
    this.o.scene.add(this.cab);
  }

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'needleUi';
    d.innerHTML = `
      <div class="nFade"></div>
      <svg class="nMask" viewBox="0 0 100 100" preserveAspectRatio="none"><defs>
        <filter id="nSoft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="0.9"/></filter>
        <mask id="nHoles"><rect width="100" height="100" fill="#fff"/><g filter="url(#nSoft)"></g></mask></defs>
        <rect width="100" height="100" fill="#000" mask="url(#nHoles)"/></svg>
      <div class="nRide"><span class="nFt">0</span><span class="nUnit">FT</span><div class="nArrow">▲</div></div>
      <div class="nLabel"><div class="nName"></div><div class="nSub"></div></div>
      <div class="nZoom"><button class="nIn">+</button><div class="nMag">4×</div><button class="nOut">−</button></div>
      <button class="nQuit">✕</button><button class="nSkip">Skip ›</button>`;
    const st = document.createElement('style');
    st.textContent = `
      #needleUi { position: absolute; inset: 0; z-index: 34; display: none; pointer-events: none; font: 800 14px -apple-system, Helvetica, sans-serif; color: #fff; }
      #needleUi.show { display: block; }
      body.needleOn #hud, body.needleOn #pad, body.needleOn #topBtns { display: none !important; }
      #needleUi .nFade { position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity .35s; }
      #needleUi .nMask { position: absolute; inset: 0; width: 100%; height: 100%; display: none; }
      #needleUi.view .nMask { display: block; }
      #needleUi .nRide { position: absolute; top: calc(18px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%); display: none;
        background: #0b0b0c; border: 2px solid #333; border-radius: 8px; padding: 4px 14px; font: 700 26px ui-monospace, Menlo, monospace; color: #ff9b3a;
        text-shadow: 0 0 8px #ff7a1a88; letter-spacing: .08em; }
      #needleUi.ride .nRide { display: flex; align-items: baseline; gap: 6px; }
      #needleUi .nUnit { font-size: 13px; opacity: .8; } #needleUi .nArrow { font-size: 14px; margin-left: 4px; }
      #needleUi .nLabel { position: absolute; left: 0; right: 0; bottom: calc(18px + var(--safe-b, 0px)); text-align: center; display: none; text-shadow: 0 2px 8px #000; }
      #needleUi.view .nLabel { display: block; }
      #needleUi .nName { font-size: 20px; letter-spacing: .02em; } #needleUi .nSub { font-size: 12px; opacity: .8; margin-top: 3px; letter-spacing: .08em; }
      #needleUi button { pointer-events: auto; -webkit-tap-highlight-color: transparent; touch-action: manipulation; border: none; color: #fff;
        font: 900 22px -apple-system, Helvetica, sans-serif; background: rgba(40,44,50,.75); }
      #needleUi .nZoom { position: absolute; right: calc(18px + var(--safe-r, 0px)); top: 50%; transform: translateY(-50%); display: none; flex-direction: column; align-items: center; gap: 8px; }
      #needleUi.view .nZoom { display: flex; }
      #needleUi .nZoom button { width: 54px; height: 54px; border-radius: 50%; }
      #needleUi .nMag { font-size: 13px; opacity: .85; }
      #needleUi .nQuit { position: absolute; top: calc(12px + var(--safe-t, 0px)); right: calc(16px + var(--safe-r, 0px)); width: 42px; height: 42px; border-radius: 50%; font-size: 17px; display: none; }
      #needleUi.view .nQuit { display: block; }
      #needleUi .nSkip { position: absolute; bottom: calc(20px + var(--safe-b, 0px)); right: calc(20px + var(--safe-r, 0px)); padding: 10px 18px; border-radius: 999px; font-size: 15px; display: none; }
      #needleUi.ride .nSkip { display: block; }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { fade: q('.nFade'), ft: q('.nFt'), arrow: q('.nArrow'), name: q('.nName'), sub: q('.nSub'), mag: q('.nMag'), holes: q('#nHoles'), svg: q('.nMask') };
    this.zoomIn = false; this.zoomOut = false;
    const hold = (sel, key) => {
      const b = q(sel);
      const on = (e) => { e.preventDefault(); e.stopPropagation(); this[key] = true; };
      const off = () => { this[key] = false; };
      b.addEventListener('pointerdown', on);
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) b.addEventListener(ev, off);
    };
    hold('.nIn', 'zoomIn'); hold('.nOut', 'zoomOut');
    q('.nQuit').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.endView(); });
    q('.nSkip').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (this.mode === 'ride') this.t = Math.max(this.t, RIDE_S - 0.45); });
    window.addEventListener('wheel', (e) => { if (this.mode === 'view') this.fov = clamp(this.fov * Math.exp(e.deltaY * 0.0015), FOV_MIN, FOV_MAX); }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (!this.mode || e.repeat) return;
      if (e.code === 'Escape' || e.code === 'Enter') {
        if (this.mode === 'view') this.endView();
        else this.t = Math.max(this.t, RIDE_S - 0.45);
      } else if (e.code === 'KeyQ' || e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomIn = true;
      else if (e.code === 'KeyZ' || e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoomOut = true;
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyQ' || e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomIn = false;
      if (e.code === 'KeyZ' || e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoomOut = false;
    });
    this._layoutMask();
    window.addEventListener('resize', () => this._layoutMask());
  }

  /** Two overlapping round fields, their edges soft, sized to the short side. */
  _layoutMask() {
    const w = window.innerWidth || 1, h = window.innerHeight || 1;
    const r = Math.min(w * 0.3, h * 0.47), off = r * 0.62;
    const ns = 'http://www.w3.org/2000/svg';
    // solid black lenses in one blurred group: their union, with a soft rim
    const m = this.ui.holes.querySelector('g');
    while (m.firstChild) m.removeChild(m.firstChild);
    for (const s of [-1, 1]) {
      const e = document.createElementNS(ns, 'ellipse');
      e.setAttribute('cx', String(50 + (s * off / w) * 100));
      e.setAttribute('cy', '50');
      e.setAttribute('rx', String((r / w) * 100));
      e.setAttribute('ry', String((r / h) * 100));
      e.setAttribute('fill', '#000');
      m.appendChild(e);
    }
  }

  _fade(on, instant) {
    const f = this.ui.fade;
    if (instant) { f.style.transition = 'none'; f.style.opacity = on ? '1' : '0'; void f.offsetWidth; f.style.transition = ''; }
    else f.style.opacity = on ? '1' : '0';
  }

  // --- what ENTER finds ---------------------------------------------------------

  /** ENTER on foot: the elevator at the base or the deck door, or a viewer. */
  tryInteract(pl) {
    if (this.mode) return false;
    const r = Math.hypot(pl.x - this.X, pl.z - this.Z);
    if (Math.abs(pl.y - this.Y) < 3 && r < 7.5) { this.ride(1); return true; }
    if (!this.onDeck(pl)) return false;
    if (Math.hypot(pl.x - this.door.x, pl.z - this.door.z) < 2.2) { this.ride(-1); return true; }
    for (const v of this.views) {
      if (Math.hypot(pl.x - v.x, pl.z - v.z) < 1.6 || Math.hypot(pl.x - v.stand.x, pl.z - v.stand.z) < 1.2) { this.view(v); return true; }
    }
    return false;
  }

  // --- the elevator ---------------------------------------------------------------

  ride(dir) {
    const P = this.o.player;
    this.mode = 'ride';
    this.dir = dir;
    this.t = 0;
    this.done = false;
    P.h.group.visible = false;
    P.vy = 0; P.speed = 0;
    document.body.classList.add('needleOn');
    this.el.classList.add('show', 'ride');
    this.el.classList.remove('view');
    this.ui.arrow.textContent = dir > 0 ? '▲' : '▼';
    this._fade(true, true);
    this._fade(false);
    if (this.o.audio) this.o.audio.ui('tick');
  }

  _rideStep(dt) {
    const P = this.o.player, cam = this.o.camera;
    this.t += dt;
    const u = ease(this.t / RIDE_S);
    const fy = this.dir > 0 ? CAB_BASE + (CAB_TOP - CAB_BASE) * u : CAB_TOP + (CAB_BASE - CAB_TOP) * u;
    this.cab.position.y = this.Y + fy;
    this.cab.updateMatrixWorld(true);
    // the passenger stands at the window
    const h = this.cab.rotation.y, fx = Math.sin(h), fz = Math.cos(h);
    const ex = this.cab.position.x + fx * 0.25, ez = this.cab.position.z + fz * 0.25, ey = this.cab.position.y + 1.62;
    P.x = ex; P.z = ez; P.y = this.cab.position.y;
    // looking out between the legs, a slow glance each way and down at the plaza
    const yaw = h + Math.sin(this.t * 0.42) * 0.38, pitch = -0.2 - 0.12 * Math.sin(this.t * 0.27);
    cam.position.set(ex, ey, ez);
    cam.up.set(0, 1, 0);
    cam.lookAt(ex + Math.sin(yaw) * Math.cos(pitch), ey + Math.sin(pitch), ez + Math.cos(yaw) * Math.cos(pitch));
    cam.updateMatrixWorld(true);
    // the car's display: feet, as the real one reads (the deck is 520)
    this.ui.ft.textContent = String(Math.round((this.dir > 0 ? u : 1 - u) * 520));
    // through the SkyLine level's floor and banquet room (100 ft): a shaft
    const sky = (ey - this.Y) - NEEDLE.skyline;
    if (!this.done) this.ui.fade.style.opacity = sky > -4.2 && sky < 3.2 ? '0.93' : '0';
    if (this.t > RIDE_S - 0.4 && !this.done) { this.done = true; this._fade(true); }
    if (this.t >= RIDE_S) this._arrive();
  }

  _arrive() {
    const P = this.o.player;
    this.mode = null;
    this.el.classList.remove('show', 'ride');
    document.body.classList.remove('needleOn');
    let x, z, h;
    if (this.dir > 0) { ({ x, z, h } = this.arrive); P.y = this.deckY; }
    else {
      const p = this.pt(ELEVATOR_A, 5.6);
      x = p.x; z = p.z; h = this.outHeading(ELEVATOR_A);
      P.y = this.o.city ? this.o.city.groundAt(x, z, this.Y + 1) : this.Y;
    }
    P.x = x; P.z = z; P.heading = h;
    P.h.group.visible = true;
    this._snapCam(h);
    this.el.classList.add('show');
    this._fade(true, true);
    this._fade(false);
    setTimeout(() => { if (!this.mode) this.el.classList.remove('show'); }, 400);
    if (this.o.audio) this.o.audio.ui('check');
    if (this.o.hud) {
      this.o.hud.showToast(this.dir > 0
        ? 'The observation deck, 520 ft. Walk round to a viewer and press ENTER to look'
        : 'Back on the ground', 4200);
    }
  }

  _snapCam(h) {
    const P = this.o.player;
    P.camYaw = h + Math.PI;
    P.camFootY = null;
    P.camPos.set(P.x - Math.sin(h) * 2.6, P.y + 1.6, P.z - Math.cos(h) * 2.6);
  }

  // --- the viewers ----------------------------------------------------------------

  view(v) {
    const P = this.o.player, cam = this.o.camera;
    this.mode = 'view';
    this.viewer = v;
    this.yaw = 0; this.pitch = -0.04;
    this.fov0 = cam.fov;
    this.fov = FOV_START;
    P.x = v.x; P.z = v.z; P.y = this.deckY; P.heading = v.h; P.vy = 0; P.speed = 0;
    P.h.group.visible = false;
    this.props.visible = false;   // you are looking through its head
    document.body.classList.add('needleOn');
    this.el.classList.add('show', 'view');
    this.el.classList.remove('ride');
    this._fade(true, true);
    this._fade(false);
    this._label = 0;
    if (this.o.audio) this.o.audio.ui('tick');
  }

  endView() {
    if (this.mode !== 'view') return;
    const P = this.o.player, cam = this.o.camera;
    this.mode = null;
    cam.fov = this.fov0; cam.updateProjectionMatrix();
    P.h.group.visible = true;
    this.props.visible = true;
    this._snapCam(this.viewer.h);
    this.el.classList.remove('show', 'view');
    document.body.classList.remove('needleOn');
    this.zoomIn = this.zoomOut = false;
  }

  _viewStep(dt, input, look) {
    const cam = this.o.camera, v = this.viewer;
    // pan: a drag moves the view as far as it would the scene, so slower zoomed in
    const k = this.fov / 55;
    this.yaw -= (look.x || 0) * k;
    this.pitch -= (look.y || 0) * k;
    this.yaw -= (input.x || 0) * dt * 0.9 * k;
    this.pitch -= (input.y || 0) * dt * 0.6 * k;
    this.yaw = clamp(this.yaw, -1.45, 1.45);
    this.pitch = clamp(this.pitch, -0.95, 0.35);
    if (this.zoomIn) this.fov = clamp(this.fov * Math.exp(-dt * 1.4), FOV_MIN, FOV_MAX);
    if (this.zoomOut) this.fov = clamp(this.fov * Math.exp(dt * 1.4), FOV_MIN, FOV_MAX);
    if (cam.fov !== this.fov) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    const h = v.h + this.yaw, fx = Math.sin(v.h), fz = Math.cos(v.h);
    const ex = v.stand.x - fx * 0.2, ez = v.stand.z - fz * 0.2, ey = this.deckY + 1.24;
    cam.position.set(ex, ey, ez);
    cam.up.set(0, 1, 0);
    const cp = Math.cos(this.pitch);
    cam.lookAt(ex + Math.sin(h) * cp, ey + Math.sin(this.pitch), ez + Math.cos(h) * cp);
    cam.updateMatrixWorld(true);
    this.ui.mag.textContent = `${Math.round(36 / this.fov)}×`;
    if ((this._label -= dt) <= 0) { this._label = 0.2; this._name(ex, ey, ez, h, this.pitch); }
  }

  /** What is in the middle of the view: a landmark near the crosshair, else the ground the ray meets. */
  _name(ex, ey, ez, h, pitch) {
    const dx = Math.sin(h) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(h) * Math.cos(pitch);
    // a landmark: within a sliver of the view's bearing, and the view's
    // elevation somewhere between its foot and 120 m up it
    let best = null, ba = Math.max(0.01, (this.fov * Math.PI / 180) * 0.16);
    for (const l of G.LANDMARKS) {
      if (l.kind === 'spaceNeedle' || !l.name) continue;
      const lx = l.p ? l.p[0] : l.x, lz = l.p ? l.p[1] : l.z;
      const tx = lx - ex, tz = lz - ez, hd = Math.hypot(tx, tz);
      if (hd < 60) continue;
      const a = Math.abs(Math.atan2(Math.sin(Math.atan2(tx, tz) - h), Math.cos(Math.atan2(tx, tz) - h)));
      if (a >= ba) continue;
      const foot = G.terrainHeight(lx, lz) - ey, el = pitch;
      if (el < Math.atan2(foot - 20, hd) || el > Math.atan2(foot + 120, hd)) continue;
      ba = a; best = { name: l.name, d: hd };
    }
    if (!best && dy < 0) {
      // march the ray to the ground
      for (let s = 30; s < 16000; s += s < 2000 ? 20 : 60) {
        const x = ex + dx * s, y = ey + dy * s, z = ez + dz * s;
        if (Math.abs(x) > G.MAP_HALF || Math.abs(z) > G.MAP_HALF) break;
        if (y < G.terrainHeight(x, z) || (G.isWater(x, z) && y < 0.5)) { best = { name: G.placeNameAt(x, z), d: Math.hypot(x - ex, z - ez) }; break; }
      }
    }
    // compass bearing: north is -z, clockwise
    const brg = ((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360;
    const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(brg / 45) % 8];
    this.ui.name.textContent = best ? best.name : dy >= 0 ? 'Sky' : '';
    const km = best ? (best.d >= 1000 ? `${(best.d / 1000).toFixed(1)} km · ` : `${Math.round(best.d / 10) * 10} m · `) : '';
    this.ui.sub.textContent = `${km}${pts} ${Math.round(brg)}°`;
  }

  // --- the frame -------------------------------------------------------------------

  /** Called in place of player.update while busy. */
  update(dt, input, look) {
    if (this.mode === 'ride') this._rideStep(dt);
    else if (this.mode === 'view') this._viewStep(dt, input, look);
  }
}
