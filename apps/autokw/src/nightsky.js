// THE NIGHT SKY'S SURPRISES (`window.__noSky`): the northern lights, shooting
// stars, and the moon's real phase (the phase itself is drawn by the sky
// dome's own shader, world.js SKY_FN -- this file only computes it).
//
// Two small additive draws, both at the far plane (vertex shader z = w, so
// buildings and hills occlude them like the dome), no textures, no render
// targets, 8-bit. Neither is drawn -- `visible = false`, no draw call, no
// uniform work -- by day, under cloud, or when its roll says no.
//
// AURORA: ~1 in 6 clear nights (a hash of the real local night: the date of
// 12 h ago, so a night is one night across midnight). ONE mesh, a 24 x 2
// sphere-segment grid around the camera 150 deg wide centred on map NORTH
// (-z: the game's frame is x east, y up, z south), 3..42 deg up. The
// fragment shader makes the curtains: a wandering base edge, slow brightness
// bands, vertical rays, green at the foot to violet above. ~40 ALU ops, no
// loops, no texture reads; roughly a third of the screen when you face north,
// nothing when you face away (clipped). Fades in and out over seconds.
//
// SHOOTING STARS: on clear nights, one every 20-60 s: a ~0.8 s streak, one
// quad rewritten on the CPU (12 floats). Stopped / on foot and looking up,
// sometimes a "make a wish" toast.
//
// Harness: `__dbg.sky.aurora(true|false|null)` (null = the roll), `.shoot()`,
// `.moon(phase|null)` (0 new, .5 full), `?aurora=1`, `window.__noSky`.

import * as THREE from './three.js';

const DEG = Math.PI / 180;
const SYNODIC = 29.530588853;
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);   // a known new moon

/** The moon's phase 0..1 (0 new, 0.5 full, rising = waxing). */
export function moonPhase(date) {
  let p = ((date.getTime() - NEW_MOON_MS) / 864e5 / SYNODIC) % 1;
  if (p < 0) p += 1;
  return p;
}

/** A stable per-night integer: the local date 12 h ago. */
function nightKey(date) {
  const d = new Date(date.getTime() - 12 * 3600e3);
  return d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate();
}
/** Does the real night `date` belongs to have the lights out? (~1 in 6) */
export function auroraNight(date) {
  const h = Math.imul(nightKey(date) ^ 0x5bd1e995, 2654435761) >>> 0;
  return (h >>> 7) % 6 === 0;
}

const AUR_VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = vec4( p.xy, p.w * 0.9999, p.w );
}`;
const AUR_FRAG = `
uniform float uTime, uK;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  float a = atan( d.x, -d.z );                 // 0 = north, + = east
  float t = uTime;
  float base = 0.075 + 0.04 * sin( a * 2.3 + t * 0.11 ) + 0.022 * sin( a * 5.1 - t * 0.17 );
  float h = ( d.y - base ) / 0.36;             // 0 at the curtain's foot
  if ( h < 0.0 || h > 1.3 ) discard;
  // slow bands along the horizon, the whole thing drifting
  float env = smoothstep( -0.35, 0.7, sin( a * 1.9 + t * 0.07 ) + 0.55 * sin( a * 4.3 - t * 0.12 + 1.0 ) );
  // vertical rays, rippling upward
  float r1 = 0.5 + 0.5 * sin( a * 41.0 + sin( a * 7.0 + t * 0.3 ) * 2.2 + h * 2.5 - t * 0.9 );
  float r2 = 0.5 + 0.5 * sin( a * 97.0 - t * 0.55 + sin( a * 13.0 ) * 3.0 + h * 4.0 );
  float rays = 0.35 + 0.65 * ( r1 * 0.65 + r2 * 0.35 );
  float prof = smoothstep( 0.0, 0.07, h ) * exp( - h * 2.4 );
  float edge = 1.0 - smoothstep( 1.0, 1.3, abs( a ) );   // the band's ends melt away
  vec3 col = mix( vec3( 0.12, 1.0, 0.42 ), vec3( 0.55, 0.22, 0.95 ), smoothstep( 0.3, 1.0, h ) );
  col = mix( col, vec3( 0.95, 0.3, 0.5 ), smoothstep( 0.95, 1.3, h ) * 0.5 );
  float I = prof * env * rays * edge * uK * 0.62;
  gl_FragColor = vec4( col * I, 1.0 );
}`;

const STAR_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = vec4( p.xy, p.w * 0.9999, p.w );
}`;
const STAR_FRAG = `
uniform float uI;
varying vec2 vUv;
void main() {
  float along = pow( vUv.x, 2.2 );
  float across = 1.0 - abs( vUv.y * 2.0 - 1.0 );
  float g = along * across * across;
  gl_FragColor = vec4( vec3( 0.9, 0.95, 1.0 ) * g * uI * 1.5, 1.0 );
}`;

export class NightSky {
  constructor(scene) {
    this.scene = scene;
    // the aurora: a 150-degree sphere segment centred on north
    const NX = 24, NY = 2, E0 = 3 * DEG, E1 = 42 * DEG, A0 = -75 * DEG, A1 = 75 * DEG, R = 100;
    const pos = [], idx = [];
    for (let j = 0; j <= NY; j++) {
      for (let i = 0; i <= NX; i++) {
        const a = A0 + (A1 - A0) * i / NX, e = E0 + (E1 - E0) * j / NY;
        pos.push(Math.sin(a) * Math.cos(e) * R, Math.sin(e) * R, -Math.cos(a) * Math.cos(e) * R);
      }
    }
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const o = j * (NX + 1) + i;
        idx.push(o, o + 1, o + NX + 1, o + 1, o + NX + 2, o + NX + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.aurU = { uTime: { value: 0 }, uK: { value: 0 } };
    const common = { transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false, fog: false };
    this.aur = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: AUR_VERT, fragmentShader: AUR_FRAG, uniforms: this.aurU, side: THREE.DoubleSide, ...common }));
    this.aur.frustumCulled = false; this.aur.renderOrder = 3; this.aur.visible = false; this.aur.name = 'aurora';
    scene.add(this.aur);
    // the shooting star: one quad, rewritten while it flies
    this.starPos = new Float32Array(12);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.starPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
    sg.setIndex([0, 1, 2, 0, 2, 3]);
    this.starU = { uI: { value: 0 } };
    this.star = new THREE.Mesh(sg, new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: this.starU, side: THREE.DoubleSide, ...common }));
    this.star.frustumCulled = false; this.star.renderOrder = 3; this.star.visible = false; this.star.name = 'shootingStar';
    scene.add(this.star);

    this.k = 0;                // the aurora's fade 0..1
    this.force = null;         // true / false / null (the roll)
    try { if (/[?&]aurora=1/.test(location.search)) this.force = true; } catch (e) { /* no location */ }
    this.phaseOverride = null;
    this.flying = 0;           // shooting star: seconds left, 0 = none
    this._next = 8 + Math.random() * 20;
    this._last = 0;
    this._S = new THREE.Vector3(); this._T = new THREE.Vector3(); this._P = new THREE.Vector3();
    this._h = new THREE.Vector3(); this._l = new THREE.Vector3(); this._fw = new THREE.Vector3();
    this._wishAt = -1e9;
    this.toastedNight = null;
    this.stars = 0;
  }

  /** Is today's night one of the aurora nights (the roll, or forced)? */
  get auroraTonight() {
    if (this.force !== null) return this.force;
    return auroraNight(new Date());
  }

  /** The moon's phase now (override for shots). */
  get phase() { return this.phaseOverride !== null ? this.phaseOverride : moonPhase(new Date()); }

  aurora(on) { this.force = on === undefined ? true : on; this._snap = !!on; return this.force; }
  moon(p) { this.phaseOverride = p === undefined ? null : p; if (typeof window !== 'undefined') window.__skyMoon = this.phaseOverride === null ? undefined : this.phaseOverride; return this.phase; }

  /** Launch a shooting star now (ahead of the camera). */
  shoot(camera) {
    const cam = camera || this._cam;
    if (!cam) return;
    cam.getWorldDirection(this._fw);
    const S = this._S, T = this._T;
    const az = Math.atan2(this._fw.x, -this._fw.z) + (Math.random() - 0.5) * 1.6;
    const el = (28 + Math.random() * 30) * DEG;
    S.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    // a direction along the sky, mostly sideways and a little down
    T.set(Math.cos(az), -0.35 - Math.random() * 0.3, Math.sin(az));
    if (Math.random() < 0.5) { T.x = -T.x; T.z = -T.z; }
    T.addScaledVector(S, -T.dot(S)).normalize();
    this._P.crossVectors(S, T);
    this.flying = 0.8;
    this.starU.uI.value = 0;
  }

  /**
   * Once per drawn frame, before the scene pass. `c` = { ni (tod night 0..1),
   * clear (bool), calm (stopped / on foot) }, `toast` shows a toast.
   */
  update(camera, tSec, c, toast) {
    this._cam = camera;
    const off = typeof window !== 'undefined' && window.__noSky;
    const dt = Math.min(0.1, Math.max(0, tSec - this._last)); this._last = tSec;
    const dark = !off && c.ni > 0.85 && c.clear;
    if (this.skyU && this.skyU.moonPhase && c.ni > 0.5) this.skyU.moonPhase.value = this.phase;
    // ---- aurora
    const want = dark && this.auroraTonight ? 1 : 0;
    if (this._snap && want) { this.k = 1; this._snap = false; }
    else if (off) this.k = 0;
    else this.k += (want - this.k) * Math.min(1, dt * (want ? 0.5 : 1.2));
    if (want === 0 && this.k < 0.02) this.k = 0;
    if (this.k > 0.01) {
      this.aur.visible = true;
      this.aur.position.copy(camera.position);
      this.aurU.uTime.value = tSec;
      this.aurU.uK.value = this.k;
      if (toast && this.k > 0.3) {
        const key = nightKey(new Date());
        if (this.toastedNight !== key) {
          this.toastedNight = key;
          let seen = null;
          try { seen = localStorage.getItem('autokw-aurora'); } catch (e) { /* private mode */ }
          if (String(key) !== seen) {
            try { localStorage.setItem('autokw-aurora', String(key)); } catch (e) { /* private mode */ }
            toast('The northern lights are out over Waterloo Region.');
          }
        }
      }
    } else this.aur.visible = false;
    // ---- shooting stars
    if (!dark) { this.flying = 0; this.star.visible = false; this.starU.uI.value = 0; return; }
    if (this.flying > 0) {
      if (!this.hold) this.flying -= dt;
      const f = 1 - Math.max(0, this.flying) / 0.8;     // 0..1
      if (f >= 1) { this.flying = 0; this.star.visible = false; this._next = 20 + Math.random() * 40; return; }
      const R = 100, S = this._S, T = this._T, P = this._P, H = this._h, L = this._l;
      const th = f * 0.5, tl = Math.max(0, th - 0.16);
      H.copy(S).multiplyScalar(Math.cos(th)).addScaledVector(T, Math.sin(th));
      L.copy(S).multiplyScalar(Math.cos(tl)).addScaledVector(T, Math.sin(tl));
      const w = 0.0032;                                   // half-width, radians
      const A = this.starPos;
      const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
      const put = (o, v, s) => { A[o] = px + (v.x + P.x * s * w) * R; A[o + 1] = py + (v.y + P.y * s * w) * R; A[o + 2] = pz + (v.z + P.z * s * w) * R; };
      put(0, L, -1); put(3, L, 1); put(6, H, 1); put(9, H, -1);
      this.star.geometry.attributes.position.needsUpdate = true;
      this.starU.uI.value = Math.sin(Math.PI * Math.min(1, f * 1.15));
      this.star.visible = true;
      return;
    }
    this.star.visible = false;
    this._next -= dt;
    if (this._next <= 0 && !(typeof document !== 'undefined' && document.hidden)) {
      this.shoot(camera);
      this.stars++;
      // a wish, when you are standing still and looking up
      if (toast && c.calm && tSec - this._wishAt > 150 && Math.random() < 0.45) {
        camera.getWorldDirection(this._fw);
        if (this._fw.y > 0.22) { this._wishAt = tSec; toast('A shooting star. Make a wish.'); }
      }
    }
  }
}
