// Auto KW: BINGEMANS BIG SPLASH, ridden. kwsights.js draws the waterpark --
// the tower, six open flumes fanning down the hill, the run-out pools -- and
// the stairs: three quarters of a square spiral round the tower, every flight
// and landing a city platform, so you walk up them yourself. On the tower's
// deck, ENTER sets you off down the slide you are facing (the nearest, by
// your heading): you sit in the trough's bottom and gravity, the water's
// little friction and the air do the rest; in a bend you ride up the outside
// wall as far as the speed asks (the bank is atan(v^2 k / g)), and at the end
// you shoot out into the run-out pool with a splash. C swaps the rider's-eye
// camera for one behind. Nothing here exists until the ride: the rider and
// the splash are built on ENTER and freed when you climb out.

import * as THREE from './three.js';
import { Builder } from './build.js';
import { splashRide } from './kwsights.js';

const G = 9.81, MU = 0.035, DRAG = 0.0045, STEP = 0.25;

export class BigSplash {
  /** opts: { scene, city, camera, player, audio, hud (getter obj), onEnd } */
  constructor(opts) {
    this.o = opts;
    this.D = splashRide();
    this.ride = null;
    this.best = 0;
    try { this.best = +(localStorage.getItem('autokw-splash') || 0); } catch (e) { this.best = 0; }
    this.fp = true;
    this.told = false;
    if (this.D) {
      this.tower = this.D.tower;
      this.topY = this.D.tower.top;
      this.paths = this.D.slides.map((s) => this._path(s));
    }
    window.addEventListener('keydown', (e) => { if (this.ride && e.code === 'KeyC') { this.fp = !this.fp; e.preventDefault(); } });
  }

  get ok() { return !!this.D; }
  get riding() { return !!this.ride; }
  get active() { return this.riding; }

  places() {
    if (!this.D) return [];
    const s = this.D.stair[0];
    return [{ x: s.ax, z: s.az, kind: 'splash', name: 'Bingemans Big Splash', label: 'Big Splash', near: false,
      hello: 'Bingemans Big Splash — walk up the tower stairs, face a slide and press ENTER at the top to ride it into the pool' }];
  }

  /** For the probe: the stair's walking line, foot to deck. */
  stairPlan() {
    const st = this.D.stair, T = this.tower;
    const a = st[0], dx = a.bx - a.ax, dz = a.bz - a.az, L = Math.hypot(dx, dz);
    const foot = { x: a.ax - dx / L * 1.5, z: a.az - dz / L * 1.5 };
    const pts = [[a.ax, a.az]];
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (i < st.length - 1) { const n = st[i + 1]; pts.push([(s.bx + n.ax) / 2, (s.bz + n.az) / 2]); }
      else pts.push([s.bx, s.bz]);
    }
    pts.push([T.x, T.z]);
    return { foot, pts, legs: pts.slice(1).map((p, i) => { const q = pts[i]; return { h: Math.atan2(p[0] - q[0], p[1] - q[1]), ms: Math.hypot(p[0] - q[0], p[1] - q[1]) / 5 * 1000 }; }) };
  }

  /** On the tower's deck? */
  onTop(pl) {
    if (!this.D || pl.onFoot === false) return false;
    return Math.abs(pl.x - this.tower.x) < 2.8 && Math.abs(pl.z - this.tower.z) < 2.8 && (pl.y || 0) > this.topY - 1.2;
  }

  /** A slide's riding line: its centre-line through a Catmull-Rom, every STEP m, with the frame at each point. */
  _path(sl) {
    const P = sl.pts, out = [];
    const cr = (a, b, c, d, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); };
    const dense = [];
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(P.length - 1, i + 2)];
      for (let k = 0; k < 8; k++) { const t = k / 8; dense.push([0, 1, 2].map((j) => cr(a[j], b[j], c[j], d[j], t))); }
    }
    dense.push(P[P.length - 1]);
    // resample by arc length
    let acc = 0, want = 0;
    out.push(dense[0]);
    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1], b = dense[i], l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      while (want + STEP <= acc + l) { want += STEP; const t = (want - acc) / l; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      acc += l;
    }
    // frames: tangent, horizontal side, the trough's up; centripetal along the side
    const F = out.map((p, i) => {
      const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
      let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const tl = Math.hypot(...t) || 1; t = t.map((v) => v / tl);
      let s = [-t[2], 0, t[0]]; const sl2 = Math.hypot(s[0], s[2]) || 1; s = [s[0] / sl2, 0, s[2] / sl2];
      const u = [-s[2] * t[1], s[2] * t[0] - s[0] * t[2], s[0] * t[1]];
      return { p, t, s, u };
    });
    for (let i = 0; i < F.length; i++) {
      const a = F[Math.max(0, i - 2)], b = F[Math.min(F.length - 1, i + 2)], ds = STEP * (Math.min(F.length - 1, i + 2) - Math.max(0, i - 2)) || 1;
      const k = [(b.t[0] - a.t[0]) / ds, (b.t[1] - a.t[1]) / ds, (b.t[2] - a.t[2]) / ds];
      F[i].kS = k[0] * F[i].s[0] + k[2] * F[i].s[2];     // curvature toward +side
    }
    return { sl, F, L: (F.length - 1) * STEP };
  }

  /** ENTER on the deck: off down the slide you face. */
  start(pl) {
    if (!this.D || this.ride) return false;
    const fx = Math.sin(pl.heading || 0), fz = Math.cos(pl.heading || 0);
    let best = 0, bs = -Infinity;
    this.paths.forEach((pa, i) => {
      const p0 = pa.F[0].p, dx = p0[0] - this.tower.x, dz = p0[2] - this.tower.z, d = Math.hypot(dx, dz) || 1;
      const sc = (dx * fx + dz * fz) / d;
      if (sc > bs) { bs = sc; best = i; }
    });
    const pa = this.paths[best];
    this.ride = { pa, s: 0, v: 1.6, bank: 0, phase: 'slide', t: 0, vmax: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), splashT: 0 };
    this._build(pa.sl);
    const p = this.o.player;
    this.wasVisible = p.h.group.visible;
    p.h.group.visible = false;
    this._snd(true);
    const hud = this.o.hud && this.o.hud.hud;
    if (hud) hud.showToast(`The ${pa.sl.name} slide — C swaps the camera`, 2200);
    return true;
  }

  _build(sl) {
    const g = new THREE.Group(); g.name = 'splashRide';
    const B = new Builder(false);
    const SUIT = [0.85, 0.12, 0.10], SKIN = [0.72, 0.48, 0.32];
    // a rider lying back, feet first along +z
    B.box(0, 0.05, -0.1, 0.36, 0.22, 0.6, 0, SUIT);
    B.box(0, 0.06, -0.55, 0.3, 0.2, 0.36, 0, SKIN);
    B.spheroid(0, 0.2, -0.86, 0.13, 8, 6, SKIN);
    for (const sd of [-1, 1]) { B.box(sd * 0.1, 0.03, 0.45, 0.13, 0.13, 0.7, 0, SKIN); B.box(sd * 0.24, 0.12, -0.35, 0.09, 0.09, 0.5, 0, SKIN); }
    const rider = new THREE.Mesh(B.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    g.add(rider);
    // the splash: a burst of droplets, and a ring of foam
    const N = 160, pos = new Float32Array(N * 3);
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const drops = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xeaf6ff, size: 0.3, transparent: true, opacity: 0.9, depthWrite: false }));
    drops.visible = false; drops.frustumCulled = false;
    g.add(drops);
    const foam = new THREE.Mesh(new THREE.RingGeometry(0.3, 1.0, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    foam.rotation.x = -Math.PI / 2; foam.visible = false; g.add(foam);
    this.o.scene.add(g);
    this.R = { g, rider, drops, foam, vel: new Float32Array(N * 3), N };
  }

  _snd(on) {
    const a = this.o.audio, ctx = a && a.ctx;
    if (!ctx) return;
    if (on && !this.rush) {
      // the rush of water under you: looped noise through a band-pass that opens with speed
      const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = n.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = n; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 0.8;
      const gn = ctx.createGain(); gn.gain.value = 0;
      src.connect(f).connect(gn).connect(a.master || ctx.destination); src.start();
      this.rush = { src, f, gn };
    } else if (!on && this.rush) {
      const r = this.rush; this.rush = null;
      r.gn.gain.setTargetAtTime(0, ctx.currentTime, 0.1); setTimeout(() => { try { r.src.stop(); } catch (e) { /* gone */ } }, 600);
    }
  }
  _splashSnd() {
    const a = this.o.audio, ctx = a && a.ctx;
    if (!ctx) return;
    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.25));
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = n; f.type = 'lowpass'; f.frequency.value = 2200; g.gain.value = 0.9;
    s.connect(f).connect(g).connect(a.master || ctx.destination); s.start();
  }

  /** The frame: the ride's physics and its camera (the world is held while you ride). */
  update(dt) {
    const r = this.ride;
    if (!r) {
      // a word on reaching the top, once a visit
      const p = this.o.player;
      if (this.D && this.onTop(p)) { if (!this.told) { this.told = true; const hud = this.o.hud && this.o.hud.hud; if (hud) hud.showToast('Top of Big Splash — face a slide and press ENTER', 3000); } }
      else if (this.D && Math.hypot(p.x - this.tower.x, p.z - this.tower.z) > 30) this.told = false;
      return;
    }
    dt = Math.min(dt, 0.05);
    r.t += dt;
    const cam = this.o.camera, R = this.R, pa = r.pa, F = pa.F;
    if (r.phase === 'slide') {
      const f = r.s / STEP, i = Math.min(F.length - 2, Math.floor(f)), u = f - i, A = F[i], Bf = F[i + 1];
      const lerp = (a, b) => a.map((v, j) => v + (b[j] - v) * u);
      const t = lerp(A.t, Bf.t), s = lerp(A.s, Bf.s), up = lerp(A.u, Bf.u), c = lerp(A.p, Bf.p), kS = A.kS + (Bf.kS - A.kS) * u;
      // gravity down the slope, the water's friction, the air
      r.v += (-G * t[1] - MU * G * Math.sqrt(Math.max(0, 1 - t[1] * t[1])) - DRAG * r.v * r.v) * dt;
      r.v = Math.max(1.2, r.v);
      r.vmax = Math.max(r.vmax, r.v);
      r.s += r.v * dt;
      // up the outside wall in a bend
      const want = Math.max(-1.25, Math.min(1.25, Math.atan(r.v * r.v * kS / G)));
      r.bank += (want - r.bank) * Math.min(1, dt * 7);
      const rr = pa.sl.r * 0.86, sb = Math.sin(r.bank), cb = Math.cos(r.bank);
      const off = [0, 1, 2].map((j) => rr * (-sb * s[j] - cb * up[j]));
      r.pos.set(c[0] + off[0], c[1] + off[1], c[2] + off[2]);
      // the rider's own up: toward the trough's axis
      const rUp = new THREE.Vector3(-off[0], -off[1], -off[2]).normalize();
      const fwd = new THREE.Vector3(t[0], t[1], t[2]);
      this._pose(r.pos, fwd, rUp);
      if (this.rush) { this.rush.gn.gain.setTargetAtTime(Math.min(0.5, 0.05 + r.v * 0.03), this.rush.gn.context.currentTime, 0.05); this.rush.f.frequency.value = 400 + r.v * 90; }
      // the camera
      if (this.fp) {
        cam.position.copy(r.pos).addScaledVector(rUp, 0.95).addScaledVector(fwd, -1.1);
        const ahead = this._at(Math.min(pa.L, r.s + 6 + r.v * 0.4));
        cam.up.copy(rUp);
        cam.lookAt(ahead.x, ahead.y + 0.1, ahead.z);
      } else {
        cam.up.set(0, 1, 0);
        cam.position.copy(r.pos).addScaledVector(fwd, -4.5).add(new THREE.Vector3(0, 2.4, 0));
        cam.lookAt(r.pos.x + fwd.x * 2, r.pos.y + 0.4, r.pos.z + fwd.z * 2);
      }
      // the run-out: the last stretch is near level and the water piles up, so you leave it at ~55 %
      if (r.s >= pa.L) { r.phase = 'fly'; const k = 0.55; r.vel.set(t[0] * r.v * k, Math.max(0, t[1]) * r.v * k + 0.8, t[2] * r.v * k); }
    } else if (r.phase === 'fly') {
      // shot out of the end, into the pool
      r.vel.y -= G * dt;
      r.pos.addScaledVector(r.vel, dt);
      const fwd = r.vel.clone().setY(0).normalize();
      this._pose(r.pos, fwd, new THREE.Vector3(0, 1, 0));
      this._camFollow(cam, r.pos, fwd);
      if (r.pos.y <= pa.sl.pool.y) { r.phase = 'splash'; r.splashT = 0; this._splash(r.pos, r.vel); }
    } else if (r.phase === 'splash') {
      r.splashT += dt;
      r.vel.multiplyScalar(Math.max(0, 1 - dt * 3));
      r.pos.x += r.vel.x * dt; r.pos.z += r.vel.z * dt;
      r.pos.y = pa.sl.pool.y - 0.3 + Math.min(0.22, r.splashT * 0.3);
      const fwd = new THREE.Vector3(pa.sl.pool.ex, 0, pa.sl.pool.ez);
      this._pose(r.pos, fwd, new THREE.Vector3(0, 1, 0));
      // a camera on the pool's side, set where the splash happened
      cam.up.set(0, 1, 0);
      cam.position.copy(this.splashCam);
      cam.lookAt(r.pos.x, r.pos.y + 0.8, r.pos.z);
      // the droplets
      const P = R.drops.geometry.attributes.position, V = R.vel;
      for (let i = 0; i < R.N; i++) {
        V[i * 3 + 1] -= G * dt;
        P.array[i * 3] += V[i * 3] * dt; P.array[i * 3 + 1] += V[i * 3 + 1] * dt; P.array[i * 3 + 2] += V[i * 3 + 2] * dt;
        if (P.array[i * 3 + 1] < pa.sl.pool.y) { P.array[i * 3 + 1] = pa.sl.pool.y; V[i * 3] *= 0.5; V[i * 3 + 2] *= 0.5; V[i * 3 + 1] = 0; }
      }
      P.needsUpdate = true;
      R.foam.scale.setScalar(1 + r.splashT * 2.2);
      R.foam.material.opacity = Math.max(0, 0.8 - r.splashT * 0.45);
      R.drops.material.opacity = Math.max(0, 0.9 - r.splashT * 0.4);
      if (r.splashT > 2.0) this._finish();
    }
  }

  _at(s) {
    const F = this.ride.pa.F, f = Math.max(0, s / STEP), i = Math.min(F.length - 2, Math.floor(f)), u = Math.min(1, f - i), a = F[i].p, b = F[i + 1].p, up = F[i].u, r = this.ride.pa.sl.r * 0.86;
    return { x: a[0] + (b[0] - a[0]) * u - up[0] * r, y: a[1] + (b[1] - a[1]) * u - up[1] * r, z: a[2] + (b[2] - a[2]) * u - up[2] * r };
  }

  _pose(pos, fwd, up) {
    const m = this.R.rider;
    m.position.copy(pos);
    const z = fwd.clone().normalize(), x = new THREE.Vector3().crossVectors(up, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    m.visible = !this.fp || this.ride.phase !== 'slide';
  }

  _camFollow(cam, pos, fwd, settle = false) {
    cam.up.set(0, 1, 0);
    const want = pos.clone().addScaledVector(fwd, settle ? -5.5 : -4).add(new THREE.Vector3(0, settle ? 2.6 : 2.0, 0));
    if (!this._camPrev) this._camPrev = cam.position.clone();
    cam.position.lerp(want, 0.15);
    cam.lookAt(pos.x, pos.y + 0.3, pos.z);
  }

  _splash(pos, vel) {
    const R = this.R, P = R.drops.geometry.attributes.position, V = R.vel, sp = Math.hypot(vel.x, vel.z);
    for (let i = 0; i < R.N; i++) {
      const a = Math.random() * Math.PI * 2, u = 1 + Math.random() * 3;
      P.array[i * 3] = pos.x; P.array[i * 3 + 1] = pos.y + 0.1; P.array[i * 3 + 2] = pos.z;
      V[i * 3] = Math.cos(a) * u + vel.x * 0.3; V[i * 3 + 1] = 3 + Math.random() * (3 + sp * 0.5); V[i * 3 + 2] = Math.sin(a) * u + vel.z * 0.3;
    }
    P.needsUpdate = true;
    R.drops.visible = true;
    const fx = vel.x / (sp || 1), fz = vel.z / (sp || 1);
    this.splashCam = new THREE.Vector3(pos.x - fx * 5.5 - fz * 3.2, this.ride.pa.sl.pool.y + 2.4, pos.z - fz * 5.5 + fx * 3.2);
    this.lastSplash = { at: [pos.x, pos.y, pos.z].map((v) => +v.toFixed(1)), pool: this.ride.pa.sl.pool, cam: this.splashCam.toArray().map((v) => +v.toFixed(1)), end: this.ride.pa.F[this.ride.pa.F.length - 1].p.map((v) => +v.toFixed(1)) };
    R.foam.visible = true; R.foam.position.set(pos.x, this.ride.pa.sl.pool.y + 0.03, pos.z);
    this._snd(false);
    this._splashSnd();
  }

  _finish() {
    const r = this.ride, pa = r.pa, pool = pa.sl.pool, p = this.o.player;
    this.last = { slide: pa.sl.name, secs: +r.t.toFixed(1), topKmh: Math.round(r.vmax * 3.6), metres: Math.round(pa.L) };
    const best = this.last.topKmh > this.best;
    if (best) { this.best = this.last.topKmh; try { localStorage.setItem('autokw-splash', String(this.best)); } catch (e) { /* private mode */ } }
    // out of the pool on the deck beside it
    const sx = pool.x - pool.ez * 3.2, sz = pool.z + pool.ex * 3.2;
    this.ride = null;
    this.o.camera.up.set(0, 1, 0);
    if (this.R) {
      this.o.scene.remove(this.R.g);
      this.R.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.R = null;
    }
    p.respawn(sx, sz);
    p.h.group.visible = true;
    p.heading = Math.atan2(this.tower.x - sx, this.tower.z - sz);
    p.camYaw = p.heading + Math.PI;
    const hud = this.o.hud && this.o.hud.hud;
    if (hud) hud.showToast(`The ${this.last.slide} slide: ${this.last.metres} m in ${this.last.secs} s, ${this.last.topKmh} km/h${best ? ' — your fastest' : ''}`, 4200);
    if (this.o.onEnd) this.o.onEnd();
  }
}
