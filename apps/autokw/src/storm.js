// THUNDERSTORMS (weather.js's `storm` state: `weather.set('storm')`, the pause
// menu's Storm, ~1-6 % of the auto picks May-September). weather.js already
// does the heavy rain (the same drops in a smaller box), the gusting slant
// (the precipitation's uWind) and the grey deck; this file adds
//
// - LIGHTNING every 8-30 s (of game time, scaled by the storm's strength):
//   ~30 % cloud-to-cloud (a flash, no bolt), the rest a branching bolt 1-6 km
//   out in the camera's general view (+-55 deg), and 1 in 40 a NEAR strike
//   150-400 m off: blinding, the crack at once, sparks, a toast.
//   The bolt is ONE additive mesh (MeshBasic, vertex colours, no texture): a
//   fixed buffer of MAXN nodes, each a 5-vertex cross-section facing the
//   camera, rewritten once per strike (a midpoint-displaced trunk and 3-5
//   branches), drawn only while it flickers (~0.2-0.35 s, 2-3 pulses).
// - THE FLASH and the storm's darker deck, by modulating EXISTING values for
//   the scene pass ONLY: preRender() saves the hemisphere / ambient
//   intensities and colours, the sky dome's overcast colours and haze and
//   the fog colour, scales and lerps them, and postRender() (main.js draw,
//   in the render call's `finally`) copies every one back. Nothing the
//   flash touches outlives the render call: no new shader program, no
//   render target, no value left changed (the probe compares them).
//   With no storm and no flash preRender returns at once and saves nothing.
// - THUNDER, delayed by distance / 343 m/s (game time: a pause holds it),
//   synthesised on audio.js's graph (worldBus, so the pause mutes it, plus a
//   reverb send): a low-passed rolling rumble whose pitch and level fall
//   with distance; a near strike adds a white-noise crack and a sub boom.
//
// Harness: `__dbg.storm` -- `strike({ d, az, kind: 'bolt'|'cc'|'near', hold })`
// (az radians from the camera's heading; `hold` freezes the bolt at its
// peak for a shot), `log` (the last 64 strikes: t, d, kind, thunderAt,
// heardAt), `stats`, `saved()` (the values preRender would touch, as plain
// numbers), `hold`.

import * as THREE from './three.js';

const MAXN = 112;           // bolt nodes (trunk 33 + up to 5 branches of 9 + slack)
const COLS = 5;             // vertices across a node: edge, halo, core, halo, edge
const ACROSS = [-1, -0.22, 0, 0.22, 1];
const SOUND = 343;          // m/s
const FLASH_C = new THREE.Color(0.78, 0.82, 1.0);   // linear: the cold white of a flash
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Storm {
  /**
   * @param o.scene, o.weather (weather.js), o.hemi, o.amb, o.world (skyUniforms),
   *        o.audio, o.toast(msg), o.fx (sparks), o.ground(x, z), o.phone
   */
  constructor(o) {
    this.scene = o.scene;
    this.weather = o.weather;
    this.hemi = o.hemi; this.amb = o.amb;
    this.world = o.world;
    this.audio = o.audio;
    this.toast = o.toast;
    this.fx = o.fx;
    this.ground = o.ground;
    this.phone = !!o.phone;
    this.t = 0;                       // game clock (tick)
    this.next = 6 + Math.random() * 10;
    this.hold = false;                // freeze the current strike at its peak (shots)
    this.mesh = null;                 // the bolt: built on the first strike
    // the strike in progress
    this.s = { on: false, t: 0, dur: 0, amp: 0, bolt: false, kind: '', d: 0, x: 0, z: 0, n: 0 };
    this.pulses = new Float32Array(9);  // up to 3 pulses: start, length, peak
    this.np = 0;
    this.flash = 0;                   // this frame's flash 0..~1.6
    this.env = 0;                     // this frame's bolt brightness 0..1
    // thunder waiting to arrive (fixed slots)
    this.q = [];
    for (let i = 0; i < 8; i++) this.q.push({ at: -1, d: 0, near: false, id: 0 });
    this.log = [];
    this.stats = { strikes: 0, bolts: 0, cc: 0, near: 0, thunders: 0, modFrames: 0 };
    this._id = 0;
    // what preRender saves (restored by postRender)
    this._mod = false;
    this._S = {
      hemi: 0, amb: 0, hemiC: new THREE.Color(), hemiG: new THREE.Color(), ambC: new THREE.Color(),
      ovHor: new THREE.Color(), ovZen: new THREE.Color(), ovCloudLit: new THREE.Color(), ovCloudDark: new THREE.Color(),
      haze: new THREE.Color(), fog: new THREE.Color(),
    };
    this._fw = new THREE.Vector3();
    // scratch for the bolt's polyline (a flat array of x y z, reused)
    this._pts = new Float32Array(MAXN * 3);
    this._tmp = new Float32Array(40 * 3);
  }

  get k() { return this.weather && this.weather.cur ? this.weather.cur.storm || 0 : 0; }

  _build() {
    const NV = MAXN * COLS;
    const g = new THREE.BufferGeometry();
    this.bpos = new Float32Array(NV * 3);
    this.bcol = new Float32Array(NV * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.bpos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.bcol, 3).setUsage(THREE.DynamicDrawUsage));
    this.bidx = new Uint16Array((MAXN - 1) * (COLS - 1) * 6);
    g.setIndex(new THREE.BufferAttribute(this.bidx, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.mesh.name = 'stormBolt';
    this.scene.add(this.mesh);
  }

  /**
   * Fire a strike now. o.kind 'bolt' | 'cc' | 'near' (else rolled), o.d its
   * distance (m), o.az its bearing off the camera's heading (rad).
   */
  strike(o = {}, camera = this._cam) {
    if (!camera) return null;
    const kind = o.kind || (Math.random() < 1 / 40 ? 'near' : Math.random() < 0.3 ? 'cc' : 'bolt');
    const d = o.d != null ? o.d : kind === 'near' ? 150 + Math.random() * 250 : 1000 + Math.random() * 5000;
    camera.getWorldDirection(this._fw);
    const yaw = Math.atan2(this._fw.x, this._fw.z);
    const az = yaw + (o.az != null ? o.az : (Math.random() - 0.5) * (kind === 'near' ? 1.4 : 1.9));
    const S = this.s;
    S.on = true; S.t = 0; S.kind = kind; S.d = d;
    S.x = camera.position.x + Math.sin(az) * d; S.z = camera.position.z + Math.cos(az) * d;
    S.bolt = kind !== 'cc';
    // the flash: near is blinding; a far bolt lights the deck, cloud-to-cloud less
    S.amp = kind === 'near' ? 1.6 : kind === 'cc' ? 0.22 + 0.2 * Math.random() : clamp(1.05 * 1400 / (d + 400), 0.24, 0.85);
    // 2-3 pulses: the return strokes
    const P = this.pulses;
    this.np = kind === 'cc' ? 2 : 2 + (Math.random() < 0.6 ? 1 : 0);
    let t0 = 0;
    for (let i = 0; i < this.np; i++) {
      const len = 0.035 + Math.random() * 0.05;
      P[i * 3] = t0; P[i * 3 + 1] = len; P[i * 3 + 2] = i === 0 ? 1 : 0.45 + Math.random() * 0.5;
      t0 += len + 0.02 + Math.random() * 0.06;
    }
    S.dur = t0 + 0.12;   // the afterglow
    if (S.bolt) this._bolt(camera, S);
    else if (this.mesh) this.mesh.visible = false;
    // thunder: queued by distance (the near crack is at once)
    const id = ++this._id;
    const slot = this.q.find((e) => e.at < 0) || this.q[0];
    slot.at = this.t + d / SOUND; slot.d = d; slot.near = kind === 'near'; slot.id = id;
    const rec = { id, t: this.t, d, kind, thunderAt: slot.at, heardAt: -1 };
    this.log.push(rec); if (this.log.length > 64) this.log.shift();
    this.stats.strikes++;
    this.stats[kind === 'bolt' ? 'bolts' : kind]++;
    if (kind === 'near') {
      if (this.toast) this.toast(`Lightning! That one hit ${Math.round(d / 10) * 10} m away.`);
      if (this.fx && d < 260) this.fx.sparks(S.x, (this.ground ? this.ground(S.x, S.z) : 0) + 1, S.z, 24);
    }
    return rec;
  }

  /** The branching bolt, from the deck to the ground at the strike point. */
  _bolt(camera, S) {
    if (!this.mesh) this._build();
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const gy = this.ground ? this.ground(S.x, S.z) : 0;
    const top = Math.max(cy, gy) + 650 + Math.random() * 350;
    const H = top - gy;
    // the trunk: 33 nodes by midpoint displacement, its top drifted off the foot
    const pts = this._pts;
    const N = 33;
    const tx = S.x + (Math.random() - 0.5) * H * 0.5, tz = S.z + (Math.random() - 0.5) * H * 0.5;
    pts[0] = tx; pts[1] = top; pts[2] = tz;
    pts[(N - 1) * 3] = S.x; pts[(N - 1) * 3 + 1] = gy - 2; pts[(N - 1) * 3 + 2] = S.z;
    displace(pts, 0, N - 1, H * 0.16);
    const lines = [[0, N]];   // [first node, count] (a few small arrays per strike, not per frame)
    let used = N;
    const nb = 3 + Math.floor(Math.random() * 3);
    for (let b = 0; b < nb && used + 9 <= MAXN; b++) {
      const at = 2 + Math.floor(Math.random() * (N * 0.7));
      const ax = pts[at * 3], ay = pts[at * 3 + 1], az = pts[at * 3 + 2];
      const L = H * (0.12 + Math.random() * 0.22);
      const ang = Math.random() * Math.PI * 2, drop = 0.5 + Math.random() * 0.45;
      const o = used;
      pts[o * 3] = ax; pts[o * 3 + 1] = ay; pts[o * 3 + 2] = az;
      const e = (o + 8) * 3;
      pts[e] = ax + Math.cos(ang) * L * (1 - drop); pts[e + 1] = ay - L * drop; pts[e + 2] = az + Math.sin(ang) * L * (1 - drop);
      displace(pts, o, o + 8, L * 0.18);
      lines.push([o, 9]);
      used += 9;
    }
    // the cross-sections: facing the camera, the width growing with distance
    const pos = this.bpos, col = this.bcol, idx = this.bidx;
    let ii = 0;
    for (let li = 0; li < lines.length; li++) {
      const [o, n] = lines[li];
      const main = li === 0;
      for (let k = 0; k < n; k++) {
        const i = o + k;
        const pa = Math.max(o, i - 1), pb = Math.min(o + n - 1, i + 1);
        let dx = pts[pb * 3] - pts[pa * 3], dy = pts[pb * 3 + 1] - pts[pa * 3 + 1], dz = pts[pb * 3 + 2] - pts[pa * 3 + 2];
        const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
        const vx = x - cx, vy = y - cy, vz = z - cz;
        const dist = Math.hypot(vx, vy, vz) || 1;
        // side = dir x view
        let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        // ~3 px either side at 720p, 0.8 m at the least; branches thinner, tapering
        const taper = main ? 1 : 1 - 0.6 * (k / (n - 1));
        const w = Math.max(0.8, dist * 0.0042) * (main ? 1 : 0.62) * taper;
        sx *= w / sl; sy *= w / sl; sz *= w / sl;
        const br = (main ? 1 : 0.55) * taper * (0.85 + 0.15 * Math.random());
        for (let c = 0; c < COLS; c++) {
          const v = (i * COLS + c) * 3, a = ACROSS[c];
          pos[v] = x + sx * a; pos[v + 1] = y + sy * a; pos[v + 2] = z + sz * a;
          // the core white, a violet-blue halo, black (adds nothing) at the edge
          const q = c === 2 ? 1 : c === 0 || c === 4 ? 0 : 0.42;
          col[v] = br * q * (c === 2 ? 1.0 : 0.62); col[v + 1] = br * q * (c === 2 ? 1.0 : 0.66); col[v + 2] = br * q * 1.0;
        }
        if (k < n - 1) {
          for (let c = 0; c < COLS - 1; c++) {
            const a = i * COLS + c, b2 = a + 1, cc = a + COLS, dd = cc + 1;
            idx[ii++] = a; idx[ii++] = cc; idx[ii++] = b2;
            idx[ii++] = b2; idx[ii++] = cc; idx[ii++] = dd;
          }
        }
      }
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, ii);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.index.needsUpdate = true;
    S.n = used;
  }

  /** The strike's brightness at time t (0..1): its pulses, each a fast rise and a decay. */
  _envAt(t) {
    const P = this.pulses;
    let e = 0;
    for (let i = 0; i < this.np; i++) {
      const s = P[i * 3], len = P[i * 3 + 1], pk = P[i * 3 + 2];
      const u = t - s;
      if (u < 0) continue;
      const v = u < 0.006 ? u / 0.006 : u < len ? 1 : Math.exp(-(u - len) / 0.03);
      if (v * pk > e) e = v * pk;
    }
    return e;
  }

  /** Unpaused frames: the clock, the next strike, the strike's flicker, thunder arriving. */
  tick(dt, camera) {
    if (camera) this._cam = camera;
    if (!(dt > 0)) return;
    this.t += dt;
    const k = this.k;
    const S = this.s;
    if (S.on && !this.hold) {
      S.t += dt;
      if (S.t >= S.dur) S.on = false;
    }
    // strikes come only with a storm well set in (the rate scales with it)
    if (k > 0.5 && !S.on) {
      this.next -= dt * k;
      if (this.next <= 0 && camera) {
        this.next = 8 + Math.random() * 22;
        this.strike({}, camera);
      }
    }
    // thunder: whatever is due, played now
    for (const e of this.q) {
      if (e.at >= 0 && this.t >= e.at) {
        this._thunder(e.d, e.near);
        const r = this.log.find((l) => l.id === e.id);
        if (r) r.heardAt = this.t;
        e.at = -1;
        this.stats.thunders++;
      }
    }
  }

  /** The scene pass is about to draw: the deck darkened, the flash, saved first. */
  preRender(camera) {
    this._mod = false;
    if (camera) this._cam = camera;
    const S = this.s;
    const k = this.k;
    const env = S.on ? (this.hold ? 1 : this._envAt(S.t)) : 0;
    // the afterglow: the deck stays faintly lit a moment after the strokes
    const F = S.on ? S.amp * Math.max(env, this.hold ? 0 : 0.2 * Math.exp(-S.t / 0.18)) : 0;
    this.env = env; this.flash = F;
    if (this.mesh) {
      this.mesh.visible = S.on && S.bolt && env > 0.02;
      if (this.mesh.visible) this.mesh.material.opacity = Math.min(1, env * (S.kind === 'near' ? 1 : clamp(1.25 - S.d / 9000, 0.55, 1)));
    }
    if (!(k > 0) && !(F > 0)) return;
    const sky = this.world && this.world.skyUniforms;
    const fog = this.scene.fog;
    const V = this._S;
    // save
    V.hemi = this.hemi.intensity; V.amb = this.amb.intensity;
    V.hemiC.copy(this.hemi.color); V.hemiG.copy(this.hemi.groundColor); V.ambC.copy(this.amb.color);
    if (sky && sky.ovHor) {
      V.ovHor.copy(sky.ovHor.value); V.ovZen.copy(sky.ovZen.value);
      V.ovCloudLit.copy(sky.ovCloudLit.value); V.ovCloudDark.copy(sky.ovCloudDark.value);
      V.haze.copy(sky.haze.value);
    }
    if (fog) V.fog.copy(fog.color);
    this._mod = true;
    this.stats.modFrames++;
    // the storm's own gloom: a darker, heavier deck and less fill
    this.hemi.intensity *= 1 - 0.3 * k;
    this.amb.intensity *= 1 - 0.28 * k;
    if (sky && sky.ovHor) {
      sky.ovHor.value.multiplyScalar(1 - 0.34 * k);
      sky.ovZen.value.multiplyScalar(1 - 0.46 * k);
      sky.ovCloudLit.value.multiplyScalar(1 - 0.42 * k);
      sky.ovCloudDark.value.multiplyScalar(1 - 0.55 * k);
      sky.haze.value.multiplyScalar(1 - 0.26 * k);
    }
    if (fog) fog.color.multiplyScalar(1 - 0.26 * k);
    if (!(F > 0)) return;
    // the flash: fill up, the deck and the haze lit from inside
    this.hemi.intensity += F * (V.hemi * 1.1 + 0.3);
    this.amb.intensity += F * (V.amb * 0.8 + 0.08);
    const f1 = Math.min(1, F * 0.5);
    this.hemi.color.lerp(FLASH_C, f1); this.hemi.groundColor.lerp(FLASH_C, f1 * 0.5); this.amb.color.lerp(FLASH_C, f1);
    if (sky && sky.ovHor) {
      const lit = (c, w, b) => { c.lerp(FLASH_C, Math.min(1, F * w)); c.multiplyScalar(1 + F * b); };
      lit(sky.ovCloudLit.value, 0.55, 0.35);
      lit(sky.ovCloudDark.value, 0.5, 0.3);
      lit(sky.ovZen.value, 0.42, 0.2);
      lit(sky.ovHor.value, 0.32, 0.15);
      lit(sky.haze.value, 0.22, 0.1);
    }
    if (fog) fog.color.lerp(FLASH_C, Math.min(0.85, F * 0.2));
  }

  /** The scene pass is done: every value preRender touched, exactly back. */
  postRender() {
    if (!this._mod) return;
    this._mod = false;
    const V = this._S;
    const sky = this.world && this.world.skyUniforms;
    this.hemi.intensity = V.hemi; this.amb.intensity = V.amb;
    this.hemi.color.copy(V.hemiC); this.hemi.groundColor.copy(V.hemiG); this.amb.color.copy(V.ambC);
    if (sky && sky.ovHor) {
      sky.ovHor.value.copy(V.ovHor); sky.ovZen.value.copy(V.ovZen);
      sky.ovCloudLit.value.copy(V.ovCloudLit); sky.ovCloudDark.value.copy(V.ovCloudDark);
      sky.haze.value.copy(V.haze);
    }
    if (this.scene.fog) this.scene.fog.color.copy(V.fog);
  }

  /** The values the flash touches, as numbers (the probe's before / after). */
  saved() {
    const sky = this.world && this.world.skyUniforms;
    const c = (x) => [x.r, x.g, x.b];
    const o = { hemi: this.hemi.intensity, amb: this.amb.intensity, hemiC: c(this.hemi.color), hemiG: c(this.hemi.groundColor), ambC: c(this.amb.color) };
    if (sky && sky.ovHor) for (const k of ['ovHor', 'ovZen', 'ovCloudLit', 'ovCloudDark', 'haze']) o[k] = c(sky[k].value);
    if (this.scene.fog) o.fog = c(this.scene.fog.color);
    return o;
  }

  /** Thunder at distance d (m): a rolling rumble; near, a crack and a boom first. */
  _thunder(d, near) {
    const A = this.audio;
    if (!A || !A.ready || A.enabled === false || !A.ctx || !A.worldBus || !A.pinkNoise) return;
    try {
      const c = A.ctx, t = A.now();
      const vol = clamp(1.0 * Math.pow(700 / (d + 350), 0.85), 0.05, 1.05);
      const dur = 2.6 + Math.min(5, d / 1000) + Math.random() * 1.5;
      const src = c.createBufferSource();
      src.buffer = A.pinkNoise; src.loop = true;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = clamp(650 * Math.exp(-d / 2200), 85, 650); lp.Q.value = 0.6;
      const lp2 = c.createBiquadFilter(); lp2.type = 'lowpass';
      lp2.frequency.value = lp.frequency.value * 1.6; lp2.Q.value = 0.5;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      // the roll: a few swells, the first the loudest, rolling off
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const ti = t + 0.06 + (i / n) * dur * 0.72 + Math.random() * 0.15;
        const pk = vol * (i === 0 ? 1 : 0.4 + Math.random() * 0.5) * (1 - 0.45 * i / n);
        g.gain.linearRampToValueAtTime(pk, ti + 0.12 + Math.random() * 0.2);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, pk * 0.3), ti + 0.5 + Math.random() * 0.4);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(lp).connect(lp2).connect(g).connect(A.worldBus);
      if (A.verbIn) { const s = c.createGain(); s.gain.value = 0.35; g.connect(s).connect(A.verbIn); }
      src.start(t, Math.random() * 1.5);
      src.stop(t + dur + 0.1);
      if (near && A.noise) {
        // the crack: a hard white-noise transient, then its sizzle
        const cs = c.createBufferSource(); cs.buffer = A.noise;
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
        const cg = c.createGain();
        cg.gain.setValueAtTime(0.0001, t);
        cg.gain.linearRampToValueAtTime(1.0, t + 0.004);
        cg.gain.exponentialRampToValueAtTime(0.25, t + 0.06);
        cg.gain.linearRampToValueAtTime(0.5, t + 0.09);
        cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        cs.connect(hp).connect(cg).connect(A.worldBus);
        if (A.verbIn) { const s = c.createGain(); s.gain.value = 0.5; cg.connect(s).connect(A.verbIn); }
        cs.start(t, Math.random()); cs.stop(t + 0.6);
        // ...and the boom under it
        const o = c.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(26, t + 0.9);
        const og = c.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.linearRampToValueAtTime(0.9, t + 0.01);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
        o.connect(og).connect(A.worldBus);
        o.start(t); o.stop(t + 1.5);
        if (A.duckEngine) A.duckEngine(0.5, 0.6);
      }
    } catch (e) { /* the sound is never worth an exception */ }
  }
}

/** Midpoint displacement of pts[a..b] (node indices) between its two ends, in place. */
function displace(pts, a, b, amp) {
  if (b - a < 2) return;
  const m = (a + b) >> 1;
  const ax = pts[a * 3], ay = pts[a * 3 + 1], az = pts[a * 3 + 2];
  const bx = pts[b * 3], by = pts[b * 3 + 1], bz = pts[b * 3 + 2];
  pts[m * 3] = (ax + bx) / 2 + (Math.random() - 0.5) * 2 * amp;
  pts[m * 3 + 1] = (ay + by) / 2 + (Math.random() - 0.5) * 0.5 * amp;
  pts[m * 3 + 2] = (az + bz) / 2 + (Math.random() - 0.5) * 2 * amp;
  displace(pts, a, m, amp * 0.55);
  displace(pts, m, b, amp * 0.55);
}
