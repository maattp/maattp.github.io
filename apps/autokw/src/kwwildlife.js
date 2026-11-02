// Auto KW: WILDLIFE -- the Region in November, small and cheap.
//
//   * V FORMATIONS. Every minute or two a V of 9-25 Canada geese crosses the
//     sky at 60-150 m heading south-ish, wings beating (the flap is in the
//     vertex shader: ONE InstancedMesh for every bird in the sky, no skinning),
//     honking faintly as they pass (positional). One in three comes down on a
//     pond or the river near you: a long glide, a splash and rings, then they
//     swim (the standing goose mesh) for a minute and lift off again.
//   * WHITE-TAILED DEER. 1-4 grazing in open ground beside a woodlot, more at
//     dawn and dusk (tod.hour; the "day" setting is a fixed 14:00 so there are
//     fewer). Heads up as you come, then they bound off, tails flagged, into
//     the trees. Rarely one steps out onto a rural road ahead of you: cars
//     brake for it like a pedestrian crossing (traffic.crossXZ) and hitting it
//     dents your car and sends it tumbling off (it gets up and bolts).
//   * SQUIRRELS. Grey (some black) ones hopping about the lawns near street
//     and park trees, only within ~40 m of you on foot; they dash up the trunk
//     when you come near. Cap 5.
//   * STARLINGS at dusk -- a murmuration of 200 over open country, computed
//     ENTIRELY in the vertex shader (zero CPU per frame); by day, a loose
//     wheel of 12 crows.
//
// Draws: sky geese 1, sitting geese 1 (only while some sit), rings 1 (only
// while any), deer <= 4 (only the poses in use), squirrels 1, murmuration 1.
// Everything is range-gated around the player and costs nothing when
// nothing of it exists. Spawns are out of view. Debug: `__dbg.wildlife`.
import * as THREE from './three.js';
import * as G from './geo.js';
import { hash2, clamp, angleWrap } from './util.js';
import { Builder } from './build.js';
import { boxAt } from './kw.js';
import { lin, T, gooseGeometry } from './kwplaces.js';

const ON_PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const rnd = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const smooth = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

/** A white-tailed deer, one merged mesh per pose. z forward, y up, hooves at 0. */
export function deerGeometry(pose) {
  const B = new Builder(false);
  const COAT = lin([0.47, 0.35, 0.25]), BELLY = lin([0.78, 0.7, 0.58]), WHITE = lin([0.96, 0.95, 0.92]), DARK = lin([0.2, 0.14, 0.1]), HORN = lin([0.62, 0.55, 0.42]);
  const bound = pose === 'bound';
  const lift = bound ? 0.3 : 0;
  const by = 0.95 + lift;
  B.spheroid(0, by, 0, 0.3, 9, 5, COAT, 0.8);
  B.spheroid(0, by - 0.02, -0.26, 0.27, 9, 5, COAT, 0.8);
  B.spheroid(0, by - 0.06, 0.3, 0.25, 9, 5, COAT, 0.85);
  B.spheroid(0, by - 0.2, 0.05, 0.22, 7, 4, BELLY, 0.55);          // the pale belly
  // neck and head
  let n1, hd;
  if (pose === 'graze') { n1 = [0, 0.5, 0.78]; hd = [0, 0.3, 0.9]; }
  else if (bound) { n1 = [0, by + 0.28, 0.7]; hd = [0, by + 0.36, 0.86]; }
  else { n1 = [0, by + 0.5, 0.58]; hd = [0, by + 0.58, 0.74]; }
  B.tube([0, by + 0.08, 0.42], n1, 0.095, 6, COAT, false);
  B.spheroid(hd[0], hd[1], hd[2], 0.1, 7, 5, COAT, 1.25);
  B.spheroid(hd[0], hd[1] - 0.03, hd[2] + 0.11, 0.05, 6, 4, DARK, 1);   // the nose
  for (const s of [-1, 1]) B.cone(s * 0.075, hd[1] + 0.1, hd[2] - 0.04, 0.035, 0.14, 5, COAT);   // ears
  if (pose === 'buck') {
    for (const s of [-1, 1]) {
      const a = [s * 0.05, hd[1] + 0.12, hd[2] - 0.04], b = [s * 0.15, hd[1] + 0.4, hd[2] - 0.1], c = [s * 0.12, hd[1] + 0.62, hd[2] + 0.06];
      B.tube(a, b, 0.016, 4, HORN, true); B.tube(b, c, 0.013, 4, HORN, true);
      B.tube([b[0], b[1] - 0.05, b[2]], [s * 0.2, b[1] + 0.12, b[2] + 0.17], 0.01, 4, HORN, true);
      B.tube([b[0], b[1] + 0.08, b[2]], [s * 0.09, b[1] + 0.3, b[2] - 0.14], 0.01, 4, HORN, true);
    }
  }
  // the tail: brown over white; flagged (up, all white) when bounding
  if (bound) B.spheroid(0, by + 0.1, -0.5, 0.09, 7, 5, WHITE, 1.7);
  else { B.spheroid(0, by - 0.04, -0.5, 0.07, 6, 4, COAT, 1.6); B.spheroid(0, by - 0.1, -0.5, 0.055, 6, 4, WHITE, 1.2); }
  // legs
  const leg = (x, z, kind) => {
    if (bound) {
      if (kind === 'f') { B.tube([x, by - 0.1, z], [x, by - 0.45, z + 0.32], 0.045, 5, COAT, true); B.tube([x, by - 0.45, z + 0.32], [x, by - 0.82, z + 0.5], 0.03, 5, DARK, true); }
      else { B.tube([x, by - 0.1, z], [x, by - 0.5, z - 0.4], 0.055, 5, COAT, true); B.tube([x, by - 0.5, z - 0.4], [x, by - 0.88, z - 0.62], 0.03, 5, DARK, true); }
    } else {
      B.tube([x, by - 0.1, z], [x, 0.32, z], kind === 'f' ? 0.045 : 0.055, 5, COAT, true);
      B.tube([x, 0.32, z], [x, 0, z + 0.02], 0.028, 5, DARK, true);
    }
  };
  for (const s of [-1, 1]) { leg(s * 0.13, 0.33, 'f'); leg(s * 0.14, -0.33, 'r'); }
  return B.build();
}

/** A grey squirrel, tail up. z forward. */
export function squirrelGeometry() {
  const B = new Builder(false);
  const FUR = lin([0.52, 0.5, 0.47]), BELLY = lin([0.86, 0.84, 0.78]), TAIL = lin([0.6, 0.58, 0.55]), DARK = lin([0.1, 0.09, 0.08]);
  B.spheroid(0, 0.1, -0.03, 0.085, 7, 4, FUR, 0.85);
  B.spheroid(0, 0.115, 0.06, 0.07, 7, 4, FUR, 0.9);
  B.spheroid(0, 0.085, 0.03, 0.055, 6, 3, BELLY, 0.7);
  B.spheroid(0, 0.15, 0.13, 0.05, 6, 4, FUR, 1);
  B.spheroid(0, 0.145, 0.18, 0.02, 5, 3, DARK, 1);
  for (const s of [-1, 1]) B.cone(s * 0.03, 0.18, 0.12, 0.018, 0.04, 4, FUR);
  const tail = [[0, 0.13, -0.13, 0.04], [0, 0.19, -0.19, 0.055], [0, 0.27, -0.2, 0.065], [0, 0.35, -0.17, 0.055], [0, 0.4, -0.1, 0.04]];
  for (const [x, y, z, r] of tail) B.spheroid(x, y, z, r, 6, 4, TAIL, 1.1);
  for (const s of [-1, 1]) { B.spheroid(s * 0.04, 0.025, 0.07, 0.025, 4, 3, FUR, 1); B.spheroid(s * 0.05, 0.03, -0.07, 0.035, 4, 3, FUR, 1); }
  return B.build();
}

/** A bird of the murmuration: a body and two wing triangles, 3 tris. x right, y up, z forward; wings flap in the shader. */
function flockBirdGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.45, -0.08, 0, -0.25, 0.08, 0, -0.25,
    -0.06, 0, 0.12, -0.6, 0.04, -0.06, -0.06, 0, -0.2,
    0.06, 0, 0.12, 0.6, 0.04, -0.06, 0.06, 0, -0.2,
  ], 3));
  return g;
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

/** MeshStandardMaterial whose geometry flaps: x beyond the body lifts with a sine, phased by the instance's place. */
function flapMaterial(uT) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWT = uT;
    sh.vertexShader = 'uniform float uWT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
	{
		float ph = uWT * 15.0 + instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.53;
		float w = max(abs(position.x) - 0.14, 0.0);
		transformed.y += sin(ph) * w * 0.95;
		transformed.z += (sin(ph) * 0.5 - 0.3) * w * 0.12;
	}`);
  };
  m.customProgramCacheKey = () => 'kwwild-flap';
  return m;
}

/** The murmuration: positions computed per bird in the vertex shader from a seed and the time. */
function flockMaterial(U) {
  const m = new THREE.MeshBasicMaterial({ color: 0x101018, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = `attribute vec4 aSeed;
uniform float uMT; uniform vec3 uMC; uniform float uMR; uniform float uSz; uniform float uMF; uniform float uFade; uniform float uSpin;
vec3 mpos(float t) {
	float u = aSeed.x * 6.2831 + t * uSpin * (0.75 + aSeed.w * 0.5);
	float v = acos(2.0 * aSeed.y - 1.0);
	float r = 0.4 + 0.6 * sqrt(aSeed.z);
	vec3 o = vec3(sin(v) * cos(u), cos(v) * 0.5, sin(v) * sin(u)) * r;
	o.x *= 1.0 + 0.6 * sin(t * 0.21);
	o.z *= 1.0 + 0.5 * sin(t * 0.17 + 1.3);
	float tw = 0.7 * sin(t * 0.13) * o.y;
	float c = cos(tw), s = sin(tw);
	o.xz = vec2(c * o.x - s * o.z, s * o.x + c * o.z);
	float wv = dot(o.xz, vec2(0.8, 0.6)) * 4.0 - t * 1.6;
	o.y += 0.22 * sin(wv);
	o.xz += 0.16 * vec2(0.6, -0.8) * sin(wv * 1.3 + t * 0.4);
	o *= 1.0 + 0.25 * sin(atan(o.z, o.x) * 2.0 + t * 0.35);
	return uMC + o * uMR;
}
` + sh.vertexShader.replace('#include <begin_vertex>', `
	vec3 p0 = mpos(uMT);
	vec3 p1 = mpos(uMT + 0.1);
	vec3 f = p1 - p0;
	float fl = length(f);
	f = fl > 1e-4 ? f / fl : vec3(0.0, 0.0, 1.0);
	vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), f));
	vec3 upv = cross(f, rt);
	vec3 lp = position * (uSz * uFade);
	lp.y += sin(uMT * uMF + aSeed.w * 40.0) * abs(lp.x) * 1.1;
	vec3 transformed = p0 + rt * lp.x + upv * lp.y + f * lp.z;
`);
  };
  m.customProgramCacheKey = () => 'kwwild-flock';
  return m;
}

// ---------------------------------------------------------------------------

export class Wildlife {
  constructor({ scene, city, world, traffic, audio, hud, game, fx, tod, player, camera }) {
    Object.assign(this, { scene, city, world, traffic, audio, hud, game, fx, tod, player, camera });
    this.enabled = true;
    this.t = 0;
    this.err = 0;
    this.stats = { v: 0, deer: 0, squirrels: 0, murm: 0, landed: 0, hits: 0 };
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._fw = new THREE.Vector3();
    this.last = null; this.pv = 0; this.fwd = [0, 1];
    this.cam = [0, 0];

    // --- sky geese
    this.uWT = { value: 0 };
    this.formations = [];
    this.vCap = ON_PHONE ? 44 : 60;
    this.sky = this._im(gooseGeometry('fly'), flapMaterial(this.uWT), this.vCap, 'wild:sky');
    this.sit = this._im(gooseGeometry('stand'), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), this.vCap, 'wild:sit');
    this.rings = null;   // built on the first splash
    this.ringList = [];
    this.vT = rnd(30, 55);
    this.honkT = 0;

    // --- deer
    this.deerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.deerMesh = {};
    this.deerCap = 14;
    this.herds = [];
    this.deerT = 4;
    this.crossT = rnd(40, 90);
    this.crossCd = 0;
    this.hitSaid = false;

    // --- squirrels
    this.sqMesh = this._im(squirrelGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), 8, 'wild:squirrel');
    this.sqMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(8 * 3).fill(1), 3);
    this.sq = [];
    this.sqCap = ON_PHONE ? 4 : 5;
    this.sqT = 2;

    // --- the murmuration
    this.U = { uMT: { value: 0 }, uMC: { value: new THREE.Vector3() }, uMR: { value: 40 }, uSz: { value: 2.4 }, uMF: { value: 17 }, uFade: { value: 0 }, uSpin: { value: 0.23 } };
    const N = ON_PHONE ? 160 : 220;
    const geo = flockBirdGeometry();
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) seed[i] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    this.murmMesh = new THREE.InstancedMesh(geo, flockMaterial(this.U), N);
    for (let i = 0; i < N; i++) this.murmMesh.setMatrixAt(i, this._m.identity());
    this.murmMesh.frustumCulled = false; this.murmMesh.count = 0; this.murmMesh.visible = false; this.murmMesh.name = 'wild:murm';
    scene.add(this.murmMesh);
    this.murm = null; this.murmT = rnd(8, 20);
    this.murmN = N;
  }

  _im(geo, mat, cap, name) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0; m.visible = false; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.name = name;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(m);
    return m;
  }

  // --- the world, as the wildlife needs it ----------------------------------------------
  water(x, z) {
    const w = this.world && this.world.waterLevelAt ? this.world.waterLevelAt(x, z) : null;
    return w !== null && w !== undefined && w > T(x, z) + 0.15 ? w : null;
  }
  groundY(x, z) {
    let lf = 0;
    try { lf = this.city.roadLift(x, z) || 0; } catch (e) { lf = 0; }
    return T(x, z) + lf;
  }
  /** Ground an animal may stand on: dry, not inside a building. */
  dry(x, z) {
    if (this.water(x, z) !== null) return false;
    const b = boxAt(this.city, x, z, 1.5);
    return !(b && b.h > 0.3);
  }
  hourWeight() {
    const h = this.tod && typeof this.tod.hour === 'number' ? this.tod.hour : 14;
    if ((h >= 5 && h < 9.5) || (h >= 15.5 && h < 20.5)) return 1;
    if (h >= 9.5 && h < 15.5) return 0.4;
    return 0.2;
  }
  say(msg, ms = 3000) { try { if (this.hud && this.hud.showToast) this.hud.showToast(msg, ms); } catch (e) { /* toast only */ } }
  honk(x, y, z, gain = 0.3) {
    if (!this.audio || !this.audio.play) return;
    try { this.audio.play('goose', { x, y, z, gain, ref: 45, maxD: 520, rate: rnd(0.9, 1.08) }); } catch (e) { /* sound only */ }
  }

  // ---------------------------------------------------------------------------------
  update(dt, player, camera) {
    if (!this.enabled || window.__noWildlife) { this._hideAll(); return; }
    if (!dt || (this.hold && !this._sim)) return;   // `hold`: the harness freezes a staged scene while it shoots
    dt = Math.min(dt, 0.1);
    player = player || this.player; camera = camera || this.camera;
    if (this.err > 3) return;
    try {
      this.t += dt;
      const pp = player.position;
      this.cam[0] = camera.position.x; this.cam[1] = camera.position.z;
      if (this.last) {
        const dx = pp.x - this.last[0], dz = pp.z - this.last[1], d = Math.hypot(dx, dz);
        this.pv = d / dt > 90 ? 0 : d / dt;
        if (d > 0.03 && this.pv > 1.5) { const k = Math.min(1, dt * 4); this.fwd[0] += (dx / d - this.fwd[0]) * k; this.fwd[1] += (dz / d - this.fwd[1]) * k; const l = Math.hypot(this.fwd[0], this.fwd[1]) || 1; this.fwd[0] /= l; this.fwd[1] /= l; }
      }
      this.last = [pp.x, pp.z];
      this.uWT.value = this.t;
      camera.getWorldDirection(this._fw);
      this._skies(dt, pp);
      this._deer(dt, player, pp);
      this._squirrels(dt, player, pp);
      this._murmur(dt, pp);
      this._rings(dt);
    } catch (e) {
      this.err++;
      try { console.error('wildlife: ' + e.message, e.stack); } catch (e2) { /* log only */ }
    }
  }
  _hideAll() {
    for (const m of [this.sky, this.sit, this.sqMesh, this.murmMesh, ...Object.values(this.deerMesh)]) if (m) m.visible = false;
  }

  // ---------------------------------------------------------------------------------
  // V formations
  // ---------------------------------------------------------------------------------

  /** Spawn a formation: it will pass over (ox, oz) (the player by default). land: come down on a pond if there is one. */
  spawnV(o = {}) {
    const pp = this.player.position;
    const cx = o.x !== undefined ? o.x : pp.x, cz = o.z !== undefined ? o.z : pp.z;
    const n = o.n || Math.round(rnd(9, 25));
    let h = o.h !== undefined ? o.h : rnd(-0.6, 0.6) + (Math.random() < 0.5 ? 0 : 0.35);   // south-ish: +z is south
    let target = null;
    if (o.land !== false && (o.land || Math.random() < 0.33)) target = this.pickWater(cx, cz);
    const alt = o.alt || rnd(60, 150);
    // start 560 m back along the line, a little off to one side so it is not always dead overhead
    const side = rnd(-90, 90), run = o.run || 560;
    let ax = cx, az = cz;
    if (target) { ax = target.x; az = target.z; h = Math.atan2(target.x - cx, target.z - cz) + rnd(-0.5, 0.5); }
    const fx = Math.sin(h), fz = Math.cos(h);
    const F = {
      x: ax - fx * run - fz * (target ? 0 : side) * 1, z: az - fz * run + fx * (target ? 0 : side) * 1,
      h, alt, spd: o.spd || 24, mode: 'cruise', target, birds: [], t: 0, age: 0, sitT: 0, honk: 0, n,
    };
    if (target) { F.x = target.x - fx * run; F.z = target.z - fz * run; }
    // V: leader at the point, arms trailing; one arm a bird or two longer
    for (let k = 0; k < n; k++) {
      const rank = Math.ceil(k / 2), sd = k === 0 ? 0 : (k % 2 ? -1 : 1);
      F.birds.push({
        k, ox: sd * rank * 3.3 + rnd(-0.5, 0.5), oz: -rank * 3.9 + rnd(-0.5, 0.5), oy: rnd(-0.6, 0.6) - rank * 0.12,
        wob: Math.random() * TAU, x: 0, y: 0, z: 0, h, mode: 'v', u: 0, tl: 0, p0: [0, 0, 0], s: null, st: 0, roll: 0,
      });
    }
    this._placeV(F, 0);
    this.formations.push(F);
    this.stats.v++;
    return F;
  }
  /** A pond or river reach near (x, z): wide enough for geese. */
  pickWater(x, z) {
    let best = null, bd = Infinity;
    for (let i = 0; i < 600; i++) {
      const a = Math.random() * TAU, r = rnd(150, 780), px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (Math.abs(px) > 15000 || Math.abs(pz) > 15000) continue;
      const w = this.water(px, pz);
      if (w === null) continue;
      let ok = true;
      for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) if (this.water(px + dx, pz + dz) === null) { ok = false; break; }
      if (ok && r < bd) { bd = r; best = { x: px, z: pz, y: w }; }
    }
    return best;
  }
  _placeV(F, dt) {
    const sx = Math.sin(F.h), sz = Math.cos(F.h), rx = sz, rz = -sx;
    const gnd = T(F.x, F.z);
    let ay = gnd + F.alt;
    if (F.target && F.mode === 'cruise') {
      const d = Math.hypot(F.target.x - F.x, F.target.z - F.z);
      const k = smooth(clamp(1 - (d - 25) / 360, 0, 1));
      ay = (F.target.y + 3) * k + (gnd + F.alt) * (1 - k);
      F.ay = ay;
    }
    for (const b of F.birds) {
      if (b.mode !== 'v') continue;
      const w = Math.sin(F.t * 0.9 + b.wob);
      b.x = F.x + rx * (b.ox + w * 0.5) + sx * b.oz; b.z = F.z + rz * (b.ox + w * 0.5) + sz * b.oz;
      b.y = ay + b.oy + Math.sin(F.t * 1.3 + b.wob * 2) * 0.4;
      b.h = F.h; b.roll = Math.sin(F.t * 0.7 + b.wob) * 0.08;
    }
  }
  _skies(dt, pp) {
    // the schedule: a V every minute or two, never while another is up and no sooner than 40 s
    this.vT -= dt;
    if (this.vT <= 0) {
      this.vT = rnd(70, 140);
      if (!this.formations.length) this.spawnV({});
    }
    let n = 0, ns = 0;
    const cx = this.cam[0], cz = this.cam[1];
    for (let fi = this.formations.length - 1; fi >= 0; fi--) {
      const F = this.formations[fi];
      F.t += dt; F.age += dt;
      if (F.mode === 'cruise') {
        F.x += Math.sin(F.h) * F.spd * dt; F.z += Math.cos(F.h) * F.spd * dt;
        F.h += Math.sin(F.age * 0.11) * 0.004 * (F.target ? 0 : 1);
        this._placeV(F, dt);
        if (F.target) {
          const d = Math.hypot(F.target.x - F.x, F.target.z - F.z);
          if (d < 34) this._breakV(F);
        }
      } else if (F.mode === 'sit') {
        F.sitT -= dt;
        const pp2 = this.player.position;
        const near = Math.hypot(F.target.x - pp2.x, F.target.z - pp2.z);
        if (F.sitT <= 0 || (near < 18 && this.pv > 6) || (near < 5)) this._liftV(F);
      }
      // the birds
      let live = 0;
      for (const b of F.birds) {
        if (b.mode === 'v') { /* placed */ }
        else if (b.mode === 'land') this._landing(F, b, dt);
        else if (b.mode === 'sit') this._sitting(F, b, dt);
        else if (b.mode === 'up') this._rising(F, b, dt);
        else continue;
        live++;
        if (b.mode === 'sit') { n += 0; ns++; this._draw(this.sit, ns - 1, b.x, b.y, b.z, b.h, 0, 1.25, 0); }
        else if (n < this.vCap) { this._draw(this.sky, n++, b.x, b.y, b.z, b.h, b.pitch || 0, 1.6, b.roll); }
      }
      // honks as they pass (a quiet one every second or so, from a random bird)
      F.honk -= dt;
      if (F.honk <= 0 && F.mode !== 'sit' && F.birds.length) {
        F.honk = rnd(0.5, 1.5);
        const b = F.birds[Math.floor(Math.random() * F.birds.length)];
        if (Math.hypot(b.x - cx, b.z - cz) < 520) this.honk(b.x, b.y, b.z, 0.26);
      }
      // gone: more than 700 m from the camera and no longer approaching, or too old
      const dc = Math.hypot(F.x - cx, F.z - cz);
      const gone = (F.mode === 'cruise' && F.age > 20 && dc > 760 && this._receding(F, cx, cz))
        || (F.mode === 'leave' && dc > 760) || F.age > 600 || !live;
      if (gone) this.formations.splice(fi, 1);
    }
    this._commit(this.sky, n);
    this._commit(this.sit, ns);
    this.stats.landed = ns;
  }
  _receding(F, cx, cz) { return (cx - F.x) * Math.sin(F.h) + (cz - F.z) * Math.cos(F.h) < 0; }
  _commit(m, n) {
    m.count = n; m.visible = n > 0;
    if (n) m.instanceMatrix.needsUpdate = true;
  }
  _draw(m, i, x, y, z, h, pitch, sc, roll) {
    this._e.set(-pitch, h, roll || 0);
    this._q.setFromEuler(this._e);
    this._m.compose(this._p.set(x, y, z), this._q, this._s.setScalar(sc));
    m.setMatrixAt(i, this._m);
  }
  /** The formation reaches the pond: each bird its own glide to its own spot on the water. */
  _breakV(F) {
    F.mode = 'landing';
    for (const b of F.birds) {
      let sx = F.target.x, sz = F.target.z;
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * TAU, r = 2 + Math.random() * (tries < 6 ? 14 : 5);
        const x = F.target.x + Math.cos(a) * r, z = F.target.z + Math.sin(a) * r;
        if (this.water(x, z) !== null) { sx = x; sz = z; break; }
      }
      b.mode = 'land'; b.p0 = [b.x, b.y, b.z]; b.u = 0; b.tl = rnd(2.6, 4.4);
      b.s = [sx, (this.water(sx, sz) ?? F.target.y) - 0.15, sz];
      b.pitch = 0;
    }
  }
  _landing(F, b, dt) {
    b.u += dt / b.tl;
    const u = Math.min(1, b.u), e = u * (2 - u);   // ease out: fast in, slow at the water
    const px = b.x, pz = b.z;
    b.x = b.p0[0] + (b.s[0] - b.p0[0]) * e;
    b.z = b.p0[2] + (b.s[2] - b.p0[2]) * e;
    b.y = b.p0[1] + (b.s[1] - b.p0[1]) * Math.pow(u, 1.5);
    const mx = b.x - px, mz = b.z - pz;
    if (mx * mx + mz * mz > 1e-5) b.h += angleWrap(Math.atan2(mx, mz) - b.h) * Math.min(1, dt * 5);
    b.pitch = u > 0.8 ? 0.5 * (u - 0.8) / 0.2 : -0.15;    // the flare: nose up, feet down
    b.roll = Math.sin(b.u * 9 + b.wob) * 0.18;
    if (u >= 1) {
      b.mode = 'sit'; b.y = b.s[1]; b.st = rnd(0, 6);
      b.drift = [rnd(-0.12, 0.12), rnd(-0.12, 0.12)];
      this._splash(b.x, b.s[1] + 0.18, b.z);
      if (Math.random() < 0.3) this.honk(b.x, b.y + 0.5, b.z, 0.5);
      if (F.birds.every((q) => q.mode === 'sit')) { F.mode = 'sit'; F.sitT = rnd(40, 75); }
    }
  }
  _sitting(F, b, dt) {
    b.st += dt;
    const nx = b.x + b.drift[0] * dt, nz = b.z + b.drift[1] * dt;
    if (this.water(nx, nz) !== null) { b.x = nx; b.z = nz; } else { b.drift[0] *= -1; b.drift[1] *= -1; }
    b.h += Math.sin(b.st * 0.4 + b.wob) * dt * 0.2;
    if (Math.random() < dt * 0.015) this.honk(b.x, b.y + 0.5, b.z, 0.4);
  }
  /** Lift off: every goose climbs away, a beat apart. */
  _liftV(F) {
    F.mode = 'leave'; F.honk = 0;
    const h = Math.random() * TAU;
    let i = 0;
    for (const b of F.birds) {
      if (b.mode !== 'sit') continue;
      b.mode = 'up'; b.vh = h + rnd(-0.3, 0.3); b.h = b.vh; b.delay = i++ * 0.08 + rnd(0, 0.4); b.vy = 0; b.sp = 0; b.pitch = 0.3;
      this.honk(b.x, b.y + 0.5, b.z, 0.5);
    }
    F.x = F.target.x; F.z = F.target.z;
  }
  _rising(F, b, dt) {
    if (b.delay > 0) { b.delay -= dt; return; }
    b.sp = Math.min(17, b.sp + 9 * dt);
    b.vy = Math.min(6.5, b.vy + 4 * dt);
    b.x += Math.sin(b.vh) * b.sp * dt; b.z += Math.cos(b.vh) * b.sp * dt;
    b.y += b.vy * dt;
    b.pitch = 0.35; b.roll = Math.sin(F.t * 3 + b.wob) * 0.1;
    if (b.y > 90) b.vy = 0;
    F.x = b.x; F.z = b.z;
  }
  _splash(x, y, z) {
    if (this.fx && this.fx.emit) this.fx.emit(x, y, z, 7, { r: 0.9, g: 0.95, b: 1, size: 0.22, life: 0.9, spread: 3, vy: 2.5, grav: -6, drag: 0.5 });
    this.ringList.push({ x, y: y + 0.03, z, age: 0 });
    if (this.ringList.length > 24) this.ringList.shift();
  }
  _rings(dt) {
    if (!this.ringList.length) { if (this.rings) this.rings.visible = false; return; }
    if (!this.rings) {
      const g = new THREE.RingGeometry(0.82, 1, 20); g.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.rings = this._im(g, mat, 24, 'wild:rings');
      this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3).fill(1), 3);
      this.rings.renderOrder = 3;
    }
    let n = 0;
    for (let i = this.ringList.length - 1; i >= 0; i--) {
      const r = this.ringList[i];
      r.age += dt;
      if (r.age > 2.2) { this.ringList.splice(i, 1); continue; }
    }
    for (const r of this.ringList) {
      const s = 0.4 + r.age * 2.2, f = Math.pow(1 - r.age / 2.2, 1.5) * 0.55;
      this._m.compose(this._p.set(r.x, r.y, r.z), this._q.identity(), this._s.set(s, 1, s));
      this.rings.setMatrixAt(n, this._m);
      this.rings.instanceColor.setXYZ(n, f, f, f);
      n++;
    }
    this._commit(this.rings, n);
    if (n) this.rings.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------------
  // deer
  // ---------------------------------------------------------------------------------

  _deerMesh(pose) {
    let m = this.deerMesh[pose];
    if (!m) { m = this.deerMesh[pose] = this._im(deerGeometry(pose), this.deerMat, this.deerCap, 'wild:deer:' + pose); m.castShadow = true; }
    return m;
  }
  /** Can a deer graze here: open ground by a woodlot, nobody's lawn, not a road. */
  deerSpot(x, z) {
    if (Math.abs(x) > 15000 || Math.abs(z) > 15000) return false;
    const gk = G.greenKind(x, z);
    if (gk === G.GREEN_WOOD || gk === G.GREEN_LAWN) return false;
    if (!this.dry(x, z) || this.city.onRoad(x, z, 7)) return false;
    if (this.city.builtAt(x, z) > 0.09) return false;
    const b = boxAt(this.city, x, z, 14);
    if (b) return false;
    // woods within reach in at least one direction
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8 + 0.3;
      for (const r of [28, 52]) if (G.greenKind(x + Math.cos(a) * r, z + Math.sin(a) * r) === G.GREEN_WOOD) return true;
    }
    return false;
  }
  /** Direction (angle) to the nearest cover from (x, z), or null. */
  coverDir(x, z, awayX, awayZ) {
    let best = null, bs = -1e9;
    for (let i = 0; i < 16; i++) {
      const a = i * TAU / 16;
      for (const r of [30, 60, 100]) {
        if (G.greenKind(x + Math.sin(a) * r, z + Math.cos(a) * r) !== G.GREEN_WOOD) continue;
        const dot = Math.sin(a) * awayX + Math.cos(a) * awayZ;
        const sc = dot * 40 - r;
        if (dot > -0.35 && sc > bs) { bs = sc; best = a; }
        break;
      }
    }
    return best;
  }
  /** A herd of n at (x, z). pose: graze. buck: one of them has antlers. */
  spawnDeer(x, z, n = 3, o = {}) {
    const herd = { deer: [], cx: x, cz: z, spooked: false, cross: !!o.cross, id: ++this._hid || (this._hid = 1) };
    for (let i = 0; i < n; i++) {
      let px = x, pz = z;
      for (let k = 0; k < 10; k++) {
        const a = Math.random() * TAU, r = i === 0 && !o.cross ? 0 : rnd(3, 9);
        px = x + Math.cos(a) * r; pz = z + Math.sin(a) * r;
        if (o.cross || this.dry(px, pz) && !this.city.onRoad(px, pz, 3)) break;
      }
      const fawn = i > 0 && n > 1 && Math.random() < 0.3;
      const d = {
        x: px, z: pz, y: this.groundY(px, pz), h: rnd(0, TAU), st: 'graze', t: rnd(1, 5), sc: fawn ? 0.68 : rnd(0.95, 1.08),
        buck: !fawn && i === 0 && Math.random() < 0.4, ph: Math.random() * 6, vx: 0, vz: 0, flee: 0, delay: 0, alert: 0, herd, wob: Math.random() * 6, rollA: 0, vy: 0,
      };
      if (o.pose) d.st = o.pose;
      herd.deer.push(d);
    }
    this.herds.push(herd);
    this.stats.deer += n;
    return herd;
  }
  _deer(dt, player, pp) {
    const onFoot = player.onFoot !== false, veh = !onFoot ? player.vehicle : null;
    const cx = this.cam[0], cz = this.cam[1];
    const flying = veh && veh.spec && (veh.spec.plane || veh.spec.heli || veh.spec.balloon || veh.spec.boat);
    // spawn: field herds by woodlots at dawn and dusk
    this.deerT -= dt; this.crossT -= dt; this.crossCd -= dt;
    const w = this.hourWeight();
    if (this.deerT <= 0) {
      this.deerT = 2.5;
      const fieldHerds = this.herds.filter((h) => !h.cross).length;
      if (!flying && fieldHerds < Math.max(1, Math.round(3 * w)) && Math.random() < 0.35 + 0.5 * w) this._trySpawnField(pp);
    }
    if (this.crossT <= 0 && veh && !flying) {
      this.crossT = rnd(5, 12);
      this._tryCross(player, veh, pp);
    }
    // update
    const cnt = {};
    for (let hi = this.herds.length - 1; hi >= 0; hi--) {
      const H = this.herds[hi];
      let near = 1e9;
      for (let di = H.deer.length - 1; di >= 0; di--) {
        const d = H.deer[di];
        const dist = this._stepDeer(d, H, dt, player, pp, onFoot, veh);
        if (dist < 0) { H.deer.splice(di, 1); continue; }
        near = Math.min(near, dist);
        const pose = this._pose(d);
        const m = this._deerMesh(pose);
        const c = cnt[pose] || 0;
        if (c >= this.deerCap) continue;
        cnt[pose] = c + 1;
        this._drawDeer(m, c, d, pose);
      }
      if (!H.deer.length || near > 330) {
        this.herds.splice(hi, 1);
      }
    }
    for (const k of Object.keys(this.deerMesh)) this._commit(this.deerMesh[k], cnt[k] || 0);
    this.stats.deerLive = this.herds.reduce((a, h) => a + h.deer.length, 0);
  }
  _pose(d) {
    if (d.st === 'graze' || d.st === 'grazewalk') return 'graze';
    if (d.st === 'flee' || d.st === 'hit' || d.st === 'cross') return d.st === 'cross' ? 'bound' : 'bound';
    return d.buck ? 'buck' : 'stand';
  }
  _drawDeer(m, i, d, pose) {
    let bob = 0, roll = 0, pitch = 0;
    if (d.st === 'flee' || (d.st === 'cross' && d.fast)) { bob = Math.abs(Math.sin(d.ph * 1.0)) * 0.55; pitch = Math.cos(d.ph) * 0.12; }
    else if (d.st === 'hit') { roll = d.rollA; pitch = d.pitchA || 0; }
    this._e.set(-pitch, d.h, roll);
    this._q.setFromEuler(this._e);
    this._m.compose(this._p.set(d.x, d.y + bob, d.z), this._q, this._s.setScalar(d.sc));
    m.setMatrixAt(i, this._m);
  }
  _trySpawnField(pp) {
    const cx = this.cam[0], cz = this.cam[1];
    for (let tries = 0; tries < 10; tries++) {
      const a = Math.random() * TAU, r = rnd(110, 260);
      const x = pp.x + Math.cos(a) * r, z = pp.z + Math.sin(a) * r;
      // out of view: behind the camera's look, or beyond a long way
      const vx = x - cx, vz = z - cz, vl = Math.hypot(vx, vz) || 1;
      if ((vx * this._fw.x + vz * this._fw.z) / vl > 0.5 && vl < 240) continue;
      if (!this.deerSpot(x, z)) continue;
      if (this.herds.some((h) => Math.hypot(h.cx - x, h.cz - z) < 120)) continue;
      const n = Math.random() < 0.3 ? 1 : Math.random() < 0.5 ? 2 : Math.random() < 0.6 ? 3 : 4;
      this.spawnDeer(x, z, n);
      return true;
    }
    return false;
  }
  /** A deer steps onto the rural road ahead of a car doing some speed. */
  _tryCross(player, veh, pp) {
    if (this.crossCd > 0 || this.pv < 9 || this.hourWeight() < 0.3 && Math.random() < 0.6) return;
    if (!this.city.onRoad(pp.x, pp.z, 2) || this.city.builtAt(pp.x, pp.z) > 0.09) return;
    if (this.herds.some((h) => h.cross)) return;
    if (Math.random() > 0.45) return;
    const f = this.fwd;
    for (const D of [105, 125, 90]) {
      const ax = pp.x + f[0] * D, az = pp.z + f[1] * D;
      if (!this.city.onRoad(ax, az, 1.5) || this.city.builtAt(ax, az) > 0.09) continue;
      // the road's half width here, along the perpendicular
      const px = -f[1], pz = f[0];
      let hw = 3;
      while (hw < 14 && this.city.onRoad(ax + px * hw, az + pz * hw, 0.5)) hw += 1;
      const side = Math.random() < 0.5 ? 1 : -1;
      const sx = ax + px * side * (hw + 4), sz = az + pz * side * (hw + 4);
      if (!this.dry(sx, sz) || this.city.onRoad(sx, sz, 1.2)) continue;
      const H = this.spawnDeer(sx, sz, Math.random() < 0.4 ? 2 : 1, { cross: true });
      H.deer.forEach((d, i) => {
        d.st = 'wait'; d.cross = { ax, az, px: px * -side, pz: pz * -side, hw, tx: ax + px * -side * (hw + 9) + (i ? f[0] * 5 : 0), tz: az + pz * -side * (hw + 9) + (i ? f[1] * 5 : 0) };
        d.h = Math.atan2(d.cross.px, d.cross.pz); d.t = 0; d.x -= f[0] * i * 3; d.z -= f[1] * i * 3; d.y = this.groundY(d.x, d.z);
      });
      this.crossCd = 50;
      return;
    }
  }
  /** One deer's frame. Returns its distance to the player, or -1 when it is gone. */
  _stepDeer(d, H, dt, player, pp, onFoot, veh) {
    d.ph += dt * (d.st === 'flee' ? 11 : 5);
    d.t -= dt;
    const dx = d.x - pp.x, dz = d.z - pp.z, dist = Math.hypot(dx, dz) || 0.01;
    const sp = this.pv;
    const alertR = veh ? 75 : 42, fleeR = veh ? 34 : 15;
    const threat = dist - sp * 0.9;
    const move = (speed) => {
      const nx = d.x + Math.sin(d.h) * speed * dt, nz = d.z + Math.cos(d.h) * speed * dt;
      if (this.water(nx, nz) === null || speed > 6) { d.x = nx; d.z = nz; return true; }
      d.h += 2.2; return false;
    };
    if (d.st === 'hit') {
      // tumbling off: thrown clear, a roll, a bounce, then up and gone
      d.x += d.vx * dt; d.z += d.vz * dt; d.vy -= 16 * dt;
      d.yy = (d.yy || 0) + d.vy * dt;
      if (d.yy < 0) { d.yy = 0; d.vy = d.vy < -3 ? -d.vy * 0.3 : 0; d.vx *= 0.7; d.vz *= 0.7; }
      d.rollA += dt * 7 * (d.vy !== 0 ? 1 : 0.2); if (d.rollA > 1.6) d.rollA = 1.6;
      d.y = this.groundY(d.x, d.z) + d.yy;
      if (d.t <= 0) { d.st = 'flee'; d.flee = 7; d.rollA = 0; d.yy = 0; d.h = Math.atan2(d.x - pp.x, d.z - pp.z); }
      return dist;
    }
    if (d.st === 'wait') {
      // at the verge, ears up, watching the road; steps out as the car comes
      d.y = this.groundY(d.x, d.z);
      const want = Math.hypot(d.cross.ax - pp.x, d.cross.az - pp.z);
      d.h += angleWrap(Math.atan2(pp.x - d.x, pp.z - d.z) - d.h) * Math.min(1, dt * 3);
      if (want < 48 + sp * 0.5 || d.t < -30) { d.st = 'cross'; d.h = Math.atan2(d.cross.px, d.cross.pz); d.fast = false; }
      if (want > 380) return -1;
      return dist;
    }
    if (d.st === 'cross') {
      // across the carriageway: a walk, then a trot as the lights reach him
      const want = Math.hypot(d.cross.ax - pp.x, d.cross.az - pp.z);
      d.fast = false;
      const tx = d.cross.tx - d.x, tz = d.cross.tz - d.z;
      const tl = Math.hypot(tx, tz);
      const lat0 = Math.abs((d.x - d.cross.ax) * d.cross.px + (d.z - d.cross.az) * d.cross.pz);
      // caught in the headlights: stands stock still in the lane for a beat
      const dl = (d.x - d.cross.ax) * d.cross.px + (d.z - d.cross.az) * d.cross.pz, pl = (pp.x - d.cross.ax) * d.cross.px + (pp.z - d.cross.az) * d.cross.pz;
      if (d.fz === undefined && want < 46 && Math.abs(dl - pl) < 1.4 && lat0 < d.cross.hw + 1) d.fz = 1.5;
      if (d.fz > 0) {
        d.fz -= dt; d.fast = false;
        d.h += angleWrap(Math.atan2(pp.x - d.x, pp.z - d.z) - d.h) * Math.min(1, dt * 6);
        d.y = this.groundY(d.x, d.z);
        if (veh && this._carHit(d, veh, pp)) return dist;
        return dist;
      }
      d.h += angleWrap(Math.atan2(tx, tz) - d.h) * Math.min(1, dt * 4);
      d.fast = d.fz !== undefined || want < 16;
      move(d.fast ? 8 : 2.6);
      d.y = this.groundY(d.x, d.z);
      if (tl < 2.5) { d.st = 'flee'; d.flee = 8; const c = this.coverDir(d.x, d.z, d.cross.px, d.cross.pz); d.h = c !== null ? c : d.h; }
      // the car hits it
      if (veh && this._carHit(d, veh, pp)) return dist;
      return dist;
    }
    if (d.st === 'flee') {
      d.flee -= dt;
      const away = Math.atan2(dx, dz);
      if (d.cover === undefined) d.cover = this.coverDir(d.x, d.z, dx / dist, dz / dist);
      const goal = d.cover !== null && d.cover !== undefined ? d.cover : away;
      d.h += angleWrap(goal + Math.sin(d.ph * 0.35 + d.wob) * 0.25 - d.h) * Math.min(1, dt * 3);
      move(10.5 * (d.sc < 0.8 ? 0.9 : 1));
      d.y = this.groundY(d.x, d.z);
      if (veh && H.cross && this._carHit(d, veh, pp)) return dist;
      // into the trees and gone, or far enough to fade
      if ((dist > 70 && G.greenKind(d.x, d.z) === G.GREEN_WOOD) || dist > 190) return -1;
      if (d.flee <= 0 && dist > 90) return -1;
      return dist;
    }
    // --- grazing / watching
    if (!H.spooked) {
      if (threat < alertR && d.st !== 'alert') { d.st = 'alert'; d.alert = 0; d.h = Math.atan2(-dx, -dz); }
      if (threat < fleeR || (d.st === 'alert' && sp > 14 && dist < 110)) this._spook(H);
    } else if (d.delay > 0) { d.delay -= dt; if (d.delay <= 0) { d.st = 'flee'; d.flee = rnd(6, 9); d.cover = undefined; } }
    if (d.st === 'alert') {
      d.alert += dt;
      d.h += angleWrap(Math.atan2(-dx, -dz) - d.h) * Math.min(1, dt * 3);
      if (d.alert > 5 && threat > alertR) { d.st = 'graze'; d.t = rnd(2, 5); }
      else if (d.alert > 4.5) this._spook(H);
    } else if (d.st === 'graze' || d.st === 'look') {
      if (d.t <= 0) {
        const r = Math.random();
        if (d.st === 'graze') { d.st = 'look'; d.t = rnd(1, 2.5); }
        else if (r < 0.3) { d.st = 'grazewalk'; d.t = rnd(2, 5); d.h = Math.atan2(H.cx - d.x, H.cz - d.z) + rnd(-1.2, 1.2); }
        else { d.st = 'graze'; d.t = rnd(3, 8); if (r < 0.5) d.h += rnd(-1, 1); }
      }
    } else if (d.st === 'grazewalk') {
      move(0.7);
      if (d.t <= 0) { d.st = 'graze'; d.t = rnd(3, 7); }
    }
    d.y = this.groundY(d.x, d.z);
    return dist;
  }
  _spook(H) {
    if (H.spooked) return;
    H.spooked = true;
    let i = 0;
    for (const d of H.deer) {
      if (d.st === 'hit' || d.st === 'cross' || d.st === 'wait') continue;
      d.delay = 0.05 + i++ * rnd(0.12, 0.35);
    }
    for (const d of H.deer) if (d.delay === 0 && !['hit', 'cross', 'wait', 'flee'].includes(d.st)) d.delay = 0.05;
  }
  /** A moving car against a crossing deer: the car's footprint. */
  _carHit(d, veh, pp) {
    if (d.st === 'hit' || !veh || veh.dead) return false;
    const sp = Math.abs(veh.vLong || this.pv);
    if (sp < 3) return false;
    const fx = this.fwd[0], fz = this.fwd[1];
    const rx = d.x - veh.x, rz = d.z - veh.z;
    const along = rx * fx + rz * fz, lat = rx * -fz + rz * fx;
    if (Math.abs(along) > (veh.halfLen || 2.3) + 0.5 || Math.abs(lat) > (veh.halfWid || 0.95) + 0.5) return false;
    d.st = 'hit'; d.t = 1.5; d.vy = 5 + sp * 0.12; d.yy = 0; d.rollA = 0;
    const side = lat >= 0 ? 1 : -1;
    d.vx = fx * sp * 0.55 + -fz * side * 6; d.vz = fz * sp * 0.55 + fx * side * 6;
    d.h = Math.atan2(d.vx, d.vz);
    this.stats.hits++;
    try {
      veh.damage(Math.min(30, 4 + sp * 0.8));
      if (this.game && this.game.onCrash) this.game.onCrash(Math.min(30, sp * 1.1), false);
      if (this.game && this.game.damagePlayer && sp > 15) this.game.damagePlayer(Math.min(20, sp * 0.4), 'crash');
      if (this.audio && this.audio.play) this.audio.play('punch', { gain: 0.9, jitter: true });
    } catch (e) { /* the bump is optional */ }
    if (!this.hitSaid) { this.hitSaid = true; this.say('A deer. It will be fine -- the car, less so.', 3200); }
    this._spook(d.herd);
    for (const o of d.herd.deer) if (o !== d && o.st !== 'hit') { o.st = 'flee'; o.flee = 7; o.cover = undefined; }
    return true;
  }
  /** Deer in the carriageway join the people crossing it: cars stop short. Call after peds.update. */
  feedTraffic(traffic) {
    if (!traffic || !traffic.crossXZ) return;
    for (const H of this.herds) {
      if (!H.cross) continue;
      for (const d of H.deer) {
        if ((d.st !== 'cross' && d.st !== 'wait' && d.st !== 'flee') || traffic.crossN >= 16) continue;
        if (!d.cross) continue;
        // in or at the road (a waiting deer at the verge stops them too, a little early)
        const lat = Math.abs((d.x - d.cross.ax) * d.cross.px + (d.z - d.cross.az) * d.cross.pz);
        if (d.st === 'flee' ? lat > d.cross.hw + 3 : false) continue;
        if (d.st !== 'wait' && d.cross && d.st !== 'cross' && d.st !== 'flee') continue;
        if (d.st === 'wait' && lat > d.cross.hw + 5) { /* at the verge: only once it has been asked to step out */ continue; }
        const o = traffic.crossN * 3;
        traffic.crossXZ[o] = d.x; traffic.crossXZ[o + 1] = d.z; traffic.crossXZ[o + 2] = d.y;
        traffic.crossN++;
      }
    }
  }

  // ---------------------------------------------------------------------------------
  // squirrels
  // ---------------------------------------------------------------------------------

  _squirrels(dt, player, pp) {
    const onFoot = player.onFoot !== false;
    const slow = onFoot || this.pv < 4;
    this.sqT -= dt;
    if (this.sqT <= 0) {
      this.sqT = 1.1;
      if (slow && this.sq.length < this.sqCap && Math.random() < 0.55) this._trySpawnSquirrel(pp);
    }
    let n = 0;
    for (let i = this.sq.length - 1; i >= 0; i--) {
      const s = this.sq[i];
      const dist = this._stepSquirrel(s, dt, pp, onFoot);
      if (dist < 0 || dist > 70 || !slow && dist > 45) { this.sq.splice(i, 1); continue; }
      if (s.st === 'hide') continue;
      let pitch = s.pitch;
      if (n >= 8) continue;
      this._e.set(-pitch, s.h, 0);
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(s.x, s.y + s.hop, s.z), this._q, this._s.setScalar(1.35));
      this.sqMesh.setMatrixAt(n, this._m);
      this.sqMesh.instanceColor.setXYZ(n, s.dark ? 0.32 : 1, s.dark ? 0.32 : 1, s.dark ? 0.34 : 1);
      n++;
    }
    this._commit(this.sqMesh, n);
    if (n) this.sqMesh.instanceColor.needsUpdate = true;
    this.stats.squirrels = this.sq.length;
  }
  _trySpawnSquirrel(pp) {
    const trees = this.world && this.world.trees && this.world.trees.chunks;
    if (!trees) return;
    for (const C of trees.values()) {
      if (Math.abs(C.x0 + 200 - pp.x) > 260 || Math.abs(C.z0 + 200 - pp.z) > 260) continue;
      if (!C.n) continue;
      for (let k = 0; k < 24; k++) {
        const o = Math.floor(Math.random() * C.n) * 9, ord = C.ord;
        const x = ord[o], z = ord[o + 2], th = ord[o + 3], kind = ord[o + 5], tone = ord[o + 7];
        if (th < 5 || kind === 3 || tone > 1) continue;
        const d = Math.hypot(x - pp.x, z - pp.z);
        if (d < 9 || d > 38) continue;
        if (this.sq.some((s) => Math.hypot(s.tx - x, s.tz - z) < 6)) continue;
        // a spot on the lawn near the foot
        const a = Math.random() * TAU, r = rnd(1.6, 5);
        const sx = x + Math.cos(a) * r, sz = z + Math.sin(a) * r;
        if (!this.dry(sx, sz) || this.city.onRoad(sx, sz, 1.5)) continue;
        // not in the camera's eye (no popping into a view)
        const vx = sx - this.cam[0], vz = sz - this.cam[1];
        if ((vx * this._fw.x + vz * this._fw.z) / (Math.hypot(vx, vz) || 1) > 0.55 && Math.hypot(vx, vz) < 22) continue;
        this.sq.push({ x: sx, z: sz, y: this.groundY(sx, sz), h: Math.random() * TAU, st: 'sit', t: rnd(0.4, 2), tx: x, tz: z, th, pitch: 0, hop: 0, ph: 0, dark: Math.random() < 0.22, climb: 0, home: [sx, sz] });
        return;
      }
    }
  }
  _stepSquirrel(s, dt, pp, onFoot) {
    s.t -= dt; s.ph += dt;
    const dx = s.x - pp.x, dz = s.z - pp.z, dist = Math.hypot(dx, dz) || 0.01;
    const scare = (onFoot ? 7.5 : 11) + this.pv * 0.5;
    const hopTo = (speed) => {
      s.hop = Math.abs(Math.sin(s.ph * 12)) * 0.07 * (speed > 3 ? 1.4 : 1);
      s.pitch = 0.1 + Math.sin(s.ph * 12) * 0.25;
      const nx = s.x + Math.sin(s.h) * speed * dt, nz = s.z + Math.cos(s.h) * speed * dt;
      if (this.dry(nx, nz) && !this.city.onRoad(nx, nz, 0.8)) { s.x = nx; s.z = nz; } else s.h += 2;
      s.y = this.groundY(s.x, s.z);
    };
    if (s.st === 'dash') {
      // for the trunk
      const tx = s.tx - s.x, tz = s.tz - s.z, tl = Math.hypot(tx, tz);
      s.h = Math.atan2(tx, tz);
      if (tl < 0.55) { s.st = 'climb'; s.ang = Math.atan2(s.x - s.tx, s.z - s.tz); s.climb = 0; return dist; }
      hopTo(6.2);
      return dist;
    }
    if (s.st === 'climb') {
      s.climb += dt * 4.2;
      const r = 0.34, a = s.ang + s.climb * 0.5;
      s.x = s.tx + Math.sin(a) * r; s.z = s.tz + Math.cos(a) * r;
      s.y = this.groundY(s.tx, s.tz) + s.climb; s.hop = 0; s.pitch = Math.PI / 2 - 0.05;
      s.h = Math.atan2(s.tx - s.x, s.tz - s.z);
      if (s.climb > Math.min(5.5, s.th * 0.55)) { s.st = 'hide'; s.t = rnd(2, 5); }
      return dist;
    }
    if (s.st === 'hide') return s.t <= 0 ? -1 : dist;
    // a person close: for the nearest tree
    if (dist < scare && s.st !== 'dash') { s.st = 'dash'; return dist; }
    if (s.st === 'sit') {
      s.hop = 0; s.pitch = 0.7 + Math.sin(s.ph * 3) * 0.05;   // up on the haunches, nibbling
      if (s.t <= 0) {
        s.st = Math.random() < 0.7 ? 'hop' : 'sit';
        s.t = s.st === 'hop' ? rnd(0.5, 1.6) : rnd(0.6, 2.4);
        if (s.st === 'hop') {
          // wander near its tree
          const hx = s.tx - s.x, hz = s.tz - s.z;
          s.h = Math.hypot(hx, hz) > 7 ? Math.atan2(hx, hz) + rnd(-0.6, 0.6) : rnd(0, TAU);
        }
      }
    } else if (s.st === 'hop') {
      hopTo(2.4);
      if (s.t <= 0) { s.st = 'sit'; s.t = rnd(0.8, 2.6); }
    }
    return dist;
  }

  // ---------------------------------------------------------------------------------
  // the murmuration
  // ---------------------------------------------------------------------------------

  /** A flock over (x, z): n birds, kind 'starling' (tight, many) or 'crow' (few, big). */
  spawnFlock(x, z, kind = 'starling') {
    const star = kind === 'starling';
    const U = this.U;
    this.murm = {
      kind, x, z, y: T(x, z) + rnd(45, 85), h: rnd(0, TAU), age: 0, life: rnd(110, 200), spd: star ? 3.2 : 2.2,
    };
    U.uMR.value = star ? 38 : 70; U.uSz.value = star ? 2.5 : 4.2; U.uMF.value = star ? 19 : 9; U.uSpin.value = star ? 0.26 : 0.1;
    this.murmMesh.count = star ? this.murmN : 12;
    this.stats.murm++;
  }
  _murmur(dt, pp) {
    const U = this.U;
    U.uMT.value = this.t;
    const M = this.murm;
    if (!M) {
      this.murmT -= dt;
      if (this.murmT > 0) { this.murmMesh.visible = false; return; }
      this.murmT = 7;
      const h = this.tod && typeof this.tod.hour === 'number' ? this.tod.hour : 14;
      const dusk = h >= 15.8 && h < 20.2, day = h >= 7 && h < 15.8;
      if (!dusk && !day) return;
      if (!dusk && Math.random() < 0.6) return;
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * TAU, r = rnd(220, 560), x = pp.x + Math.cos(a) * r, z = pp.z + Math.sin(a) * r;
        if (Math.abs(x) > 14500 || Math.abs(z) > 14500) continue;
        if (this.city.builtAt(x, z) > 0.09 || this.water(x, z) !== null || G.greenKind(x, z) === G.GREEN_WOOD) continue;
        this.spawnFlock(x, z, dusk ? 'starling' : 'crow');
        U.uFade.value = 0;
        return;
      }
      return;
    }
    M.age += dt;
    M.x += Math.sin(M.h) * M.spd * dt; M.z += Math.cos(M.h) * M.spd * dt;
    M.h += Math.sin(M.age * 0.05) * 0.01;
    M.y += (T(M.x, M.z) + (M.kind === 'starling' ? 65 : 55) - M.y) * Math.min(1, dt * 0.2);
    U.uMC.value.set(M.x, M.y, M.z);
    const fade = Math.min(1, M.age / 4, Math.max(0, (M.life - M.age) / 5));
    U.uFade.value = fade;
    this.murmMesh.visible = fade > 0.01;
    const dc = Math.hypot(M.x - pp.x, M.z - pp.z);
    const h = this.tod && typeof this.tod.hour === 'number' ? this.tod.hour : 14;
    // starlings go at nightfall; a flock left far behind is gone
    if (M.age > M.life || dc > 1100 || (M.kind === 'starling' && (h >= 20.8 || h < 15)) || (M.kind === 'crow' && (h >= 16 || h < 6.5))) {
      this.murm = null; this.murmMesh.visible = false; this.murmMesh.count = 0; this.murmT = rnd(30, 80);
    }
  }

  // ---------------------------------------------------------------------------------
  // harness
  // ---------------------------------------------------------------------------------

  /** Harness: put the on-foot player at (x, z). */
  tp(x, z) {
    const p = this.player;
    p.x = x; p.z = z; p.y = T(x, z);
    this.last = null; this.pv = 0;
  }
  /** Step the sim `sec` seconds at a fixed dt (for the paused-game shots and probes). */
  sim(sec, dt = 0.05) {
    this._sim = true;
    for (let t = 0; t < sec; t += dt) this.update(dt, this.player, this.camera);
    this._sim = false;
  }
  /** What's alive, drawn, and the draws it costs (count of visible wildlife meshes). */
  info() {
    const ms = [this.sky, this.sit, this.rings, this.sqMesh, this.murmMesh, ...Object.values(this.deerMesh)].filter(Boolean);
    const vis = ms.filter((m) => m.visible && m.count > 0);
    let tris = 0;
    for (const m of vis) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 * m.count;
    return { formations: this.formations.map((f) => ({ mode: f.mode, n: f.birds.length, x: Math.round(f.x), z: Math.round(f.z), alt: Math.round(f.birds[0] ? f.birds[0].y : 0), target: !!f.target })), herds: this.herds.length, deer: this.herds.reduce((a, h) => a + h.deer.length, 0), squirrels: this.sq.length, murm: this.murm ? this.murm.kind : null, draws: vis.length, tris: Math.round(tris), stats: this.stats };
  }
}
