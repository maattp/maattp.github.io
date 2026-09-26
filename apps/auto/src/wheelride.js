// THE SEATTLE GREAT WHEEL, TURNING, AND A RIDE ON IT.
//
// The wheel's rotating half lives here: the rim (two outer rings and an inner
// one, laced into a triangular truss), the spokes from both hub flanges, and
// the 42 gondolas, which hang from pivots just outside the rim and stay level
// as it turns. landmarks.js keeps the hub, the axle, the A-frames and Pier
// 57's deck. Rim and spokes are one merged mesh turning about the axle; the
// gondolas are two instanced meshes (frame, glass) whose matrices are set
// every frame the wheel is in reach. It turns slowly all day, as it does.
//
// ENTER on the boarding platform: the wheel eases a gondola round to the
// platform and stops, you step in, and it takes you once round -- 90 s, 175
// ft up at the top, out over Elliott Bay (in life, three turns in about 15
// minutes). Inside, the gondola you ride is a detailed one -- glass all round,
// benches, the frame -- and the view is yours: drag (or the stick) to look.
// Its height is on the readout; "Down" brings the wheel round to the platform
// quickly. The gondola sways a little on its pivot as the wheel starts and
// stops.

import * as THREE from './three.js';
import { Builder } from './build.js';
import { clamp, damp } from './util.js';
import { WHEEL } from './landmarks.js';

const RIDE_S = 90;
const OMEGA = (2 * Math.PI) / RIDE_S;         // rad/s, one turn a ride
const UV0 = [0, 0, 0, 0, 0, 0, 0, 0];
const ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

const MATS = {
  steel: new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.38, metalness: 0.55, envMapIntensity: 0.9 }),
  frame: new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.35, metalness: 0.6, envMapIntensity: 0.9 }),
  glassOut: new THREE.MeshStandardMaterial({ color: 0x3a5566, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.2 }),
  glassIn: new THREE.MeshStandardMaterial({ color: 0xcfe2ea, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }),
  inner: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
};

/** The rim, its trusses and the spokes, about the hub centre (the axle is z). */
function rimGeometry() {
  const { R, n, hubZ } = WHEEL;
  const b = new Builder(false);
  const col = [1, 1, 1];
  const P = (r, a, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
  const RING = 84;
  for (const [r, z, t] of [[R, -1.1, 0.32], [R, 1.1, 0.32], [R - 1.9, 0, 0.26]]) {
    for (let k = 0; k < RING; k++) b.tube(P(r, (k / RING) * Math.PI * 2, z), P(r, ((k + 1) / RING) * Math.PI * 2, z), t, 6, col);
  }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, a2 = ((i + 0.5) / n) * Math.PI * 2;
    b.tube(P(R, a, -1.1), P(R - 1.9, a2, 0), 0.12, 4, col);
    b.tube(P(R, a, 1.1), P(R - 1.9, a2, 0), 0.12, 4, col);
    b.tube(P(R, a, -1.1), P(R, a, 1.1), 0.1, 4, col);
    // spokes: tension rods from both hub flanges to the inner ring
    b.tube(P(1.9, a, -hubZ), P(R - 1.9, a, 0), 0.07, 3, col);
    b.tube(P(1.9, a2, hubZ), P(R - 1.9, a2, 0), 0.07, 3, col);
    // the gondola's pivot bracket
    b.tube(P(R, a, 0), P(WHEEL.Rp, a, 0), 0.14, 6, col);
  }
  return b.build();
}

/** A gondola's frame, hanging from its pivot at the origin: hanger, caps, posts. */
function gondolaFrameGeometry() {
  const b = new Builder(false);
  const c = [1, 1, 1];
  b.box(0, -0.9, 0, 0.25, 0.9, 0.25, 0, [0.35, 0.37, 0.4]);                    // hanger
  b.box(0, -1.3, 0, 2.5, 0.35, 2.3, 0, c);                                     // roof cap
  b.box(0, -4.6, 0, 2.5, 0.3, 2.3, 0, c);                                      // floor pan
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 1.17, -4.3, sz * 1.07, 0.1, 3.0, 0.1, 0, c);
  return b.build();
}
function gondolaGlassGeometry() {
  const g = new THREE.BoxGeometry(2.3, 2.95, 2.1);
  g.translate(0, -2.82, 0);
  return g;
}

/** The gondola you ride: see-through, with benches and a floor. */
function riddenGondola() {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(gondolaFrameGeometry(), MATS.frame);
  g.add(frame);
  const glass = new THREE.Mesh(gondolaGlassGeometry(), MATS.glassIn);
  glass.renderOrder = 2;
  g.add(glass);
  const b = new Builder(false);
  const seat = [0.17, 0.21, 0.27], floor = [0.25, 0.27, 0.3], rail = [0.8, 0.82, 0.84];
  b.box(0, -4.3, 0, 2.2, 0.04, 2.0, 0, floor);
  // Benches on the north and south walls, facing each other: the open views
  // from a wheel are out of its plane (along the axle); in the plane are the
  // neighbouring gondolas, the spokes and the A-frames.
  for (const sz of [-1, 1]) {
    b.box(0, -4.26, sz * 0.78, 2.0, 0.4, 0.44, 0, seat);
    b.box(0, -3.86, sz * 0.97, 2.0, 0.3, 0.07, 0, seat);
  }
  b.tube([-1.1, -3.3, -0.6], [-1.1, -3.3, 0.6], 0.02, 6, rail, true);
  b.tube([1.1, -3.3, -0.6], [1.1, -3.3, 0.6], 0.02, 6, rail, true);
  g.add(new THREE.Mesh(b.build(), MATS.inner));
  return g;
}

export class WheelRide {
  /** opts: { scene, city, player, camera, controls, audio, hud, at: {x, y, z} } */
  constructor(opts) {
    this.o = opts;
    const { x, y, z } = opts.at;
    this.hub = new THREE.Vector3(x, y + WHEEL.hub, z);
    this.deckY = y;
    this.theta = 0;
    this.omega = OMEGA;
    this.mode = null;             // null | 'align' | 'ride' | 'down'
    this.sway = 0; this.swayV = 0;
    // rim and spokes, turning about the axle
    this.spin = new THREE.Group();
    this.spin.position.copy(this.hub);
    const rim = new THREE.Mesh(rimGeometry(), MATS.steel);
    rim.castShadow = true;
    rim.name = 'wheelRim';
    this.spin.add(rim);
    opts.scene.add(this.spin);
    // the gondolas
    const n = WHEEL.n;
    this.frames = new THREE.InstancedMesh(gondolaFrameGeometry(), MATS.frame, n);
    this.glass = new THREE.InstancedMesh(gondolaGlassGeometry(), MATS.glassOut, n);
    for (const m of [this.frames, this.glass]) {
      m.frustumCulled = false;
      m.castShadow = m === this.frames;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      opts.scene.add(m);
    }
    this.ridden = null;           // the detailed gondola while riding
    this.seat = -1;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._zAxis = new THREE.Vector3(0, 0, 1);
    this.near = true;
    this._buildDom();
    this._place(0);
  }

  get busy() { return this.mode !== null; }

  /** Gondola i's pivot, in world space, at the wheel's angle now. */
  pivot(i, out = this._p) {
    const a = (i / WHEEL.n) * Math.PI * 2 + this.theta;
    return out.set(this.hub.x + Math.cos(a) * WHEEL.Rp, this.hub.y + Math.sin(a) * WHEEL.Rp, this.hub.z);
  }

  _place(dt) {
    this.spin.rotation.z = this.theta;
    const n = WHEEL.n;
    for (let i = 0; i < n; i++) {
      this.pivot(i);
      // gondolas hang level; the ridden one swings a little on its pivot
      this._q.setFromAxisAngle(this._zAxis, i === this.seat ? this.sway : 0);
      this._s.setScalar(i === this.seat && this.ridden ? 0 : 1);
      this._m.compose(this._p, this._q, this._s);
      this.frames.setMatrixAt(i, this._m);
      this.glass.setMatrixAt(i, this._m);
    }
    this.frames.instanceMatrix.needsUpdate = true;
    this.glass.instanceMatrix.needsUpdate = true;
    if (this.ridden) {
      this.pivot(this.seat);
      this.ridden.position.copy(this._p);
      this.ridden.rotation.set(0, 0, this.sway);
      this.ridden.updateMatrixWorld(true);
    }
    void dt;
  }

  /** The index of the gondola that will next reach the bottom, and how far the wheel must turn. */
  _nextToBottom() {
    const n = WHEEL.n, TAU = Math.PI * 2;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const a = ((i / n) * TAU + this.theta) % TAU;
      // turning positive (anticlockwise seen from +z), the bottom is at -PI/2
      let d = (-Math.PI / 2 - a) % TAU;
      if (d < 0) d += TAU;
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, d: bd };
  }

  // --- the frame --------------------------------------------------------------------

  /** Every frame: turn the wheel (while it is in reach), and run a ride. */
  update(dt, input, look, camX, camZ) {
    const far = Math.hypot(camX - this.hub.x, camZ - this.hub.z);
    const near = far < 1400 || this.mode;
    if (near !== this.near) {
      this.near = near;
      this.spin.visible = this.frames.visible = this.glass.visible = !!near;
    }
    if (!near) return;
    const prevOmega = this.omega;
    if (this.mode === 'align') this._alignStep(dt);
    else if (this.mode === 'ride' || this.mode === 'down') this._rideStep(dt, input, look);
    else {
      this.omega = damp(this.omega, OMEGA, 0.8, dt);
      this.theta += this.omega * dt;
    }
    // the ridden gondola swings back when the wheel speeds up or slows down
    const acc = (this.omega - prevOmega) / Math.max(dt, 1e-3);
    this.swayV += (-this.sway * 6 - this.swayV * 1.6 - acc * 1.2) * dt;
    this.sway += this.swayV * dt;
    this._place(dt);
    if (this.mode === 'ride' || this.mode === 'down' || this.mode === 'align') this._camera(dt, input, look);
  }

  // --- the ride -----------------------------------------------------------------------

  /** ENTER on foot on the boarding platform? */
  tryInteract(pl) {
    if (this.mode) return false;
    const dx = pl.x - this.hub.x, dz = pl.z - this.hub.z;
    if (Math.abs(dx) > 7 || Math.abs(dz) > 6 || Math.abs(pl.y - this.deckY) > 2.5) return false;
    this._board();
    return true;
  }

  _board() {
    const P = this.o.player;
    const { i, d } = this._nextToBottom();
    this.seat = i;
    this.mode = 'align';
    this.alignFrom = this.theta; this.alignTo = this.theta + d;
    this.alignT = 0; this.alignDur = Math.max(2.2, d / OMEGA * 0.6);
    this.turned = 0;
    this.yaw = 0; this.pitch = -0.05;
    this.fov0 = this.o.camera.fov;
    P.h.group.visible = false;
    document.body.classList.add('wheelOn');
    this.el.classList.add('show');
    this.ui.hint.textContent = 'Boarding…';
    this._fade(true, true); this._fade(false);
    if (this.o.audio) this.o.audio.ui('tick');
  }

  _alignStep(dt) {
    this.alignT += dt;
    const u = ease(this.alignT / this.alignDur);
    const th = this.alignFrom + (this.alignTo - this.alignFrom) * u;
    this.omega = (th - this.theta) / Math.max(dt, 1e-3);
    this.theta = th;
    if (this.alignT >= this.alignDur && !this.ridden) {
      // in you get
      this.ridden = riddenGondola();
      this.o.scene.add(this.ridden);
      this.mode = 'ride';
      this.rideT = 0;
      this.ui.hint.textContent = 'Drag to look around';
      if (this.o.audio) this.o.audio.play('thunk', { gain: 0.35, rate: 0.8 });
    }
  }

  _rideStep(dt, input) {
    this.rideT += dt;
    // pull away, turn, and ease into the platform after one full turn
    const left = Math.PI * 2 - this.turned;
    const fast = this.mode === 'down' ? 6 : 1;
    const want = OMEGA * fast * Math.min(1, left / 0.35 + 0.05) * Math.min(1, this.rideT / 3 + 0.05);
    this.omega = damp(this.omega, want, 1.5, dt);
    const step = Math.min(left, this.omega * dt);
    this.theta += step; this.turned += step;
    const P = this.o.player;
    this.pivot(this.seat);
    P.x = this._p.x; P.z = this._p.z; P.y = this._p.y - 4.3;
    const ft = Math.max(0, Math.round((P.y - this.deckY + WHEEL.deck) / 0.3048));
    this.ui.ft.textContent = `${ft} FT`;
    if (left <= 1e-4) this._alight();
    void input;
  }

  down() { if (this.mode === 'ride') { this.mode = 'down'; this.ui.hint.textContent = 'Coming round to the platform'; } }

  _alight() {
    const P = this.o.player;
    this.mode = null;
    this.o.scene.remove(this.ridden);
    this.ridden.traverse((m) => { if (m.geometry) m.geometry.dispose(); });   // materials are shared (MATS)
    this.ridden = null;
    this.seat = -1;
    // out onto the platform, facing the city
    const x = this.hub.x + 4.2, z = this.hub.z;
    P.x = x; P.z = z; P.y = this.o.city.groundAt(x, z, this.deckY + 1.5);
    P.heading = Math.PI / 2;
    P.h.group.visible = true;
    P.camYaw = P.heading + Math.PI; P.camFootY = null;
    P.camPos.set(x - 4.6, P.y + 1.6, z);
    const cam = this.o.camera;
    if (this.fov0) { cam.fov = this.fov0; cam.updateProjectionMatrix(); }
    this.el.classList.remove('show');
    document.body.classList.remove('wheelOn');
    this._fade(true, true); this._fade(false);
    if (this.o.hud) this.o.hud.showToast('Round the Great Wheel — 175 ft over Elliott Bay', 3500);
  }

  _camera(dt, input, look) {
    const cam = this.o.camera;
    // drag or the stick looks round
    this.yaw -= (look && look.x) || 0;
    this.pitch -= (look && look.y) || 0;
    this.yaw -= ((input && input.x) || 0) * dt * 1.4;
    this.pitch -= ((input && input.y) || 0) * dt * 1.0;
    this.pitch = clamp(this.pitch, -1.2, 0.8);
    if (!this.ridden) {
      // boarding: from the platform, watching your gondola come round
      const p = this.pivot(this.seat, new THREE.Vector3());
      cam.position.set(this.hub.x + 9, this.deckY + 1.7, this.hub.z + 9);
      cam.lookAt(p.x, p.y - 2.5, p.z);
    } else {
      // seated on the south bench, looking north: the piers, Belltown, the Needle
      const e = new THREE.Vector3(0, -3.08, 0.72).applyAxisAngle(this._zAxis, this.sway).add(this.ridden.position);
      cam.position.copy(e);
      const h = Math.PI + this.yaw, cp = Math.cos(this.pitch);
      cam.up.set(0, 1, 0);
      cam.lookAt(e.x + Math.sin(h) * cp, e.y + Math.sin(this.pitch), e.z + Math.cos(h) * cp);
      if (cam.fov !== 58) { cam.fov = 58; cam.updateProjectionMatrix(); }
    }
    cam.updateMatrixWorld(true);
    void dt;
  }

  // --- the overlay --------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'wheelUi';
    d.innerHTML = `<div class="wFade"></div><div class="wTop"><span class="wFt">0 FT</span></div>
      <div class="wHint"></div><button class="wDown">Down ↓</button>`;
    const st = document.createElement('style');
    st.textContent = `
      #wheelUi { position: absolute; inset: 0; z-index: 34; display: none; pointer-events: none; font: 800 14px -apple-system, Helvetica, sans-serif; color: #fff; }
      #wheelUi.show { display: block; }
      body.wheelOn #hud, body.wheelOn #pad, body.wheelOn #topBtns { display: none !important; }
      #wheelUi .wFade { position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity .35s; }
      #wheelUi .wTop { position: absolute; top: calc(12px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%);
        background: rgba(12,34,60,.62); padding: 7px 16px; border-radius: 999px; letter-spacing: .08em; }
      #wheelUi .wHint { position: absolute; left: 0; right: 0; bottom: calc(18px + var(--safe-b, 0px)); text-align: center; font-size: 13px; opacity: .85; text-shadow: 0 1px 6px #000; }
      #wheelUi .wDown { position: absolute; top: calc(12px + var(--safe-t, 0px)); right: calc(16px + var(--safe-r, 0px)); pointer-events: auto;
        padding: 9px 16px; border-radius: 999px; border: none; color: #fff; font: 800 14px -apple-system, Helvetica, sans-serif; background: rgba(12,34,60,.7); }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    this.ui = { fade: d.querySelector('.wFade'), ft: d.querySelector('.wFt'), hint: d.querySelector('.wHint') };
    d.querySelector('.wDown').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.down(); });
    window.addEventListener('keydown', (e) => {
      if (this.mode !== 'ride' || e.repeat) return;
      if (e.code === 'Escape' || e.code === 'Enter') { this.down(); e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  _fade(on, instant) {
    const f = this.ui.fade;
    if (instant) { f.style.transition = 'none'; f.style.opacity = on ? '1' : '0'; void f.offsetWidth; f.style.transition = ''; }
    else f.style.opacity = on ? '1' : '0';
  }
}
