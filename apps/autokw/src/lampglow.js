// THE CITY'S LIGHTS, SEEN (the graphics pass, gfx.js; `window.__noLampGlow`).
//
// tod.js lights the ground under the 8-12 nearest street lamps and throws the
// nearest cars' beams, but nothing showed the LIGHTS themselves: a lamp head
// at night was a dark box over its own pool, a street 200 m on was a row of
// nothing, and traffic was invisible but for its tail-lamp faces. This is the
// sources: a soft glow sprite on every street-lamp head the near chunks
// record (world.js userData.lamps, tod.js STATIC_LAMPS) within GLOW_R ahead
// of the view, and on the headlamps (white) and tail lamps (red) of the
// moving cars nearest the view -- so a dusk street recedes as a row of warm
// points and the 401 reads as a river of headlights.
//
// ONE DRAW: an instanced camera-facing quad (InstancedBufferGeometry, MAX
// instances, vec4 position + intensity and a colour index per instance),
// additive, depth-tested (a lamp behind a building is hidden), no depth
// write. The list is re-chosen every 0.25 s or 8 m (lamps) and every frame
// for the cars (their few dozen corners), into preallocated typed arrays:
// no per-frame allocation. Fogged by hand (the fog's own density and
// colour's brightness, so a far glow sinks into the haze). Invisible --
// no draw at all -- by day: only while tod.js's lamps are on (lampK > 0).

import * as THREE from './three.js';
import { STATIC_LAMPS } from './tod.js';
import { GFX } from './gfx.js';

const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
const MAX = ON_PHONE ? 160 : 256;     // sprites
const MAX_CARS = ON_PHONE ? 22 : 36;  // cars whose lamps glow (4 sprites each)
const GLOW_R = ON_PHONE ? 420 : 560;  // street lamps this far ahead
const CAR_R = 380;
const LAMP_MAX = MAX - Math.min(MAX_CARS * 4, 64);   // the rest are the cars'

const VERT = `
attribute vec4 aGlow;     // xyz world, w intensity
attribute float aKind;    // 0 street lamp, 1 headlamp, 2 tail lamp
uniform float uFogD;
varying vec2 vC;
varying float vI;
varying float vK;
void main() {
  vC = position.xy;
  vK = aKind;
  vec4 mv = viewMatrix * vec4( aGlow.xyz, 1.0 );
  float d = -mv.z;
  // world size: a lamp's halo ~1.6 m, a car lamp's ~0.8; grows with distance
  // so it stays a few pixels across instead of vanishing (a light is seen
  // further than its fixture)
  float s = ( aKind < 0.5 ? 1.5 : aKind < 1.5 ? 0.55 : 0.32 ) * ( 1.0 + d * ( aKind < 0.5 ? 0.0065 : 0.012 ) );
  // pulled toward the camera so the fixture's own faces never clip it
  mv.xyz += normalize( - mv.xyz ) * min( 1.2, d * 0.2 );
  mv.xy += position.xy * s;
  // the haze: as the fog (exp2) eats it
  float f = uFogD * d;
  vI = aGlow.w * exp( - f * f ) * ( d < 0.8 ? 0.0 : 1.0 );
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform vec3 uLamp;
varying vec2 vC;
varying float vI;
varying float vK;
void main() {
  float r2 = dot( vC, vC );
  if ( r2 > 1.0 ) discard;
  // a hot core and a wide soft halo
  float g = exp( - r2 * 18.0 ) * 1.3 + exp( - r2 * 4.0 ) * 0.32;
  g *= 1.0 - r2;
  vec3 c = vK < 0.5 ? uLamp : vK < 1.5 ? vec3( 1.0, 0.96, 0.88 ) : vec3( 1.0, 0.12, 0.06 );
  gl_FragColor = vec4( c * g * vI, 1.0 );
}`;

export class LampGlow {
  constructor(scene) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(MAX * 4);
    this.kind = new Float32Array(MAX);
    this.aGlow = new THREE.InstancedBufferAttribute(this.pos, 4).setUsage(THREE.DynamicDrawUsage);
    this.aKind = new THREE.InstancedBufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', this.aGlow);
    geo.setAttribute('aKind', this.aKind);
    geo.instanceCount = 0;
    this.uniforms = { uFogD: { value: 0 }, uLamp: { value: new THREE.Color(1.0, 0.72, 0.42) } };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;    // after the water (4/5)
    this.mesh.visible = false;
    this.mesh.name = 'lampGlow';
    scene.add(this.mesh);
    this.geo = geo;
    // the street lamps chosen (x, y, z, d2) -- re-chosen every 0.25 s / 8 m
    this.lamps = new Float32Array(LAMP_MAX * 4);
    this.nLamps = 0;
    this._t = -1e9; this._at = new THREE.Vector3(1e9, 0, 0);
    this._fw = new THREE.Vector3();
    this._cand = [];
    this.count = 0;
  }

  /**
   * Before the scene pass. `k` the lamps' on-ness (tod.js lampK, 0 by day),
   * `head` the cars' (TODK.head), `fogD` the scene fog's density now.
   */
  update(camera, world, cars, k, head, fogD, tSec, playerCar) {
    const on = GFX.lampGlow && k > 0.01;
    if (!on) { this.mesh.visible = false; this.count = 0; return; }
    this.mesh.visible = true;
    this.uniforms.uFogD.value = fogD;
    const p = camera.position, fw = this._fw;
    camera.getWorldDirection(fw);
    const fl = Math.hypot(fw.x, fw.z) || 1, fx = fw.x / fl, fz = fw.z / fl;
    if (tSec - this._t > 0.25 || Math.hypot(p.x - this._at.x, p.z - this._at.z) > 8) {
      this._t = tSec; this._at.copy(p);
      this._chooseLamps(world, p, fx, fz);
    }
    const P = this.pos, K = this.kind;
    let n = 0;
    const L = this.lamps, I = 1.6 * k;
    for (let i = 0; i < this.nLamps && n < LAMP_MAX; i++) {
      const o = i * 4;
      P[n * 4] = L[o]; P[n * 4 + 1] = L[o + 1] - 0.15; P[n * 4 + 2] = L[o + 2];
      // the set's far edge fades, so a lamp joining it does not pop
      P[n * 4 + 3] = I * (1 - Math.max(0, (Math.sqrt(L[o + 3]) - GLOW_R * 0.8) / (GLOW_R * 0.2)));
      K[n] = 0;
      n++;
    }
    if (head > 0.01 && cars) n = this._cars(cars, p, fx, fz, head, n, playerCar);
    this.count = n;
    this.geo.instanceCount = n;
    if (n > 0) {
      this.aGlow.needsUpdate = true;
      this.aKind.needsUpdate = true;
    }
  }

  _chooseLamps(world, p, fx, fz) {
    // every recorded head in range and not behind, the nearest LAMP_MAX of
    // them: two linear passes (a histogram of distance picks the cut), no
    // per-lamp sorting -- a dense downtown records thousands of heads
    const R2 = GLOW_R * GLOW_R, H = this._hist || (this._hist = new Int32Array(64));
    H.fill(0);
    let cnt = 0;
    const chunks = world && world.chunks;
    const lists = this._lists || (this._lists = []);
    lists.length = 0;
    if (chunks) for (const c of chunks.values()) { const A = c.group && c.group.userData.lamps; if (A && A.length) lists.push(A); }
    for (const A of STATIC_LAMPS) if (A.length) lists.push(A);
    for (const A of lists) {
      for (let i = 0; i < A.length; i += 3) {
        const dx = A[i] - p.x, dz = A[i + 2] - p.z, d2 = dx * dx + dz * dz;
        if (d2 > R2 || dx * fx + dz * fz < -12) continue;
        H[Math.min(63, (d2 / R2 * 64) | 0)]++;
        cnt++;
      }
    }
    let cut = 64, acc = 0;
    if (cnt > LAMP_MAX) { for (cut = 0; cut < 64; cut++) { if (acc + H[cut] > LAMP_MAX) break; acc += H[cut]; } }
    // bins under `cut` all fit; the cut bin fills what is left
    let room = LAMP_MAX - acc, n = 0;
    const L = this.lamps;
    for (const A of lists) {
      for (let i = 0; i < A.length && n < LAMP_MAX; i += 3) {
        const dx = A[i] - p.x, dz = A[i + 2] - p.z, d2 = dx * dx + dz * dz;
        if (d2 > R2 || dx * fx + dz * fz < -12) continue;
        const b = Math.min(63, (d2 / R2 * 64) | 0);
        if (b > cut) continue;
        if (b === cut) { if (room <= 0) continue; room--; }
        const o = n * 4;
        L[o] = A[i]; L[o + 1] = A[i + 1]; L[o + 2] = A[i + 2]; L[o + 3] = d2;
        n++;
      }
    }
    this.nLamps = n;
  }

  _cars(cars, p, fx, fz, head, n, playerCar) {
    const cand = this._cand;
    let m = 0;
    for (const v of cars) {
      if (!v || !v.spec || v.spec.plane || v.spec.boat || v.spec.heli || v.spec.balloon || v.spec.freight) continue;
      if (v.mode === 'parked' && v !== playerCar) continue;
      const dx = v.x - p.x, dz = v.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 > CAR_R * CAR_R || dx * fx + dz * fz < -8) continue;
      if (m < cand.length) { cand[m].d = d2; cand[m].v = v; } else cand.push({ d: d2, v });
      m++;
    }
    // nearest MAX_CARS (partial selection; m is small)
    const lim = Math.min(m, MAX_CARS);
    for (let i = 0; i < lim; i++) {
      let b = i;
      for (let j = i + 1; j < m; j++) if (cand[j].d < cand[b].d) b = j;
      if (b !== i) { const t = cand[i]; cand[i] = cand[b]; cand[b] = t; }
      const v = cand[i].v;
      if (n + 4 > MAX) break;
      const f = v.forward, sx = f.z, sz = -f.x;     // right of travel
      const hl = (v.spec.len || 4.6) / 2, hw = (v.spec.wid || 1.8) / 2 - 0.22;
      const y = (v.y || 0) + 0.72;
      const I = head * (v === playerCar ? 0.5 : 1.0);
      // a headlamp is seen from in front, a tail lamp from behind
      const tx = p.x - v.x, tz = p.z - v.z, tl = Math.hypot(tx, tz) || 1;
      const fd = (tx * f.x + tz * f.z) / tl;
      const Ih = I * Math.max(0, Math.min(1, (fd + 0.15) / 0.45));
      const It = I * 0.8 * Math.max(0, Math.min(1, (0.15 - fd) / 0.45));
      const P = this.pos, K = this.kind;
      for (let s = -1; s <= 1; s += 2) {
        let o = n * 4;
        P[o] = v.x + f.x * (hl + 0.05) + sx * hw * s; P[o + 1] = y; P[o + 2] = v.z + f.z * (hl + 0.05) + sz * hw * s; P[o + 3] = Ih;
        K[n++] = 1;
        o = n * 4;
        P[o] = v.x - f.x * (hl + 0.05) + sx * hw * s; P[o + 1] = y + 0.08; P[o + 2] = v.z - f.z * (hl + 0.05) + sz * hw * s; P[o + 3] = It;
        K[n++] = 2;
      }
    }
    return n;
  }
}
