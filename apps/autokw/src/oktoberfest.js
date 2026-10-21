// Auto KW: OKTOBERFEST. Kitchener-Waterloo's (since 1969) is the biggest
// Bavarian festival outside Germany; this is its two things a visitor
// remembers:
//
// - THE FESTHALLEN. Concordia Club (Ottawa St S), Bingemans' Marshall Hall
//   and the Schwaben Club are on the map with a door; ENTER there walks you in
//   (the camera down the aisle between the long tables, past the crowd
//   schunkeling to the oom-pah band, up onto the stage) -- a hall drawn in its
//   own scene, built on entry and freed on the way out, the city not drawn
//   under it. On the stage: MASSKRUGSTEMMEN, the stein-holding contest -- a
//   full litre Mass held out at arm's length, level, for as long as you can,
//   against four others. Left / right (A / D, or a drag) keeps it level
//   against a wobble that grows; Up (W, Space, or dragging up) holds the arm
//   up against a sag that grows faster than your lift: spill past 24 deg, or
//   let the arm hang under the judge's line for a second, and you are out.
//   Onkel Hans, the festival's mascot (green hat, feather, moustache,
//   lederhosen), stands by the band.
// - THE THANKSGIVING DAY PARADE. The real one starts at Weber St and
//   Frederick St in downtown Kitchener on Thanksgiving Monday at 9:30 and goes
//   up Weber St to Bridgeport Rd in Waterloo (oktoberfest.ca, 2025 and 2026).
//   ENTER at the marker there starts it on demand: Onkel Hans' float, a
//   marching band, the barrel, Miss Oktoberfest, the pretzel and a Bavarian
//   house float roll up Weber at a walking pace with the crowd three deep on
//   the kerbs (cheering as the floats pass), Weber closed to traffic. It
//   exists only while it runs: built on start, every geometry freed and the
//   street reopened when the last float has gone ~1.5 km up the route.
//
// Music is the band's own: an original oom-pah waltz synthesised note by
// note (tuba, brass, clarinet, a bass drum), not a recording.

import * as THREE from './three.js';
import { Builder } from './build.js';
import { boxAt } from './kw.js';
import { setInterior } from './interior.js';

const lin = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const SKIN = ['#f0c8a0', '#d8a880', '#a8764e', '#7a4e30', '#e8b890'].map(lin);
const HALLS = [
  { name: 'Concordia Club', short: 'Concordia', x: -208.6, z: 2426.4, sub: 'Festhalle · since 1873',
    hello: 'Concordia Club, 429 Ottawa St S — an Oktoberfest festhalle. Press ENTER at the door: the band is on and the stein-holding contest is about to start' },
  { name: "Bingemans' Marshall Hall", short: 'Marshall Hall', x: 1816.2, z: -2536.4, sub: "Bingemans' Festhalle",
    hello: "Bingemans' Marshall Hall — Oktoberfest's biggest festhalle. Press ENTER at the door for the band and the stein-holding contest" },
  { name: 'Schwaben Club', short: 'Schwaben Club', x: 4529.7, z: -3068.9, sub: 'Festhalle · Kitchener',
    hello: 'The Schwaben Club — an Oktoberfest festhalle. Press ENTER at the door for the band and the stein-holding contest' },
];
const RIVALS = ['Brubacher', 'Schmidt', 'Weber', 'Martin', 'Bauman', 'Hoffmann', 'Krueger', 'Schneider'];

// --- shared pieces -------------------------------------------------------------------------------

/** A material for crowds: an InstancedMesh whose instance colour tints only the vertices flagged aTint,
 *  swaying (schunkeln) with uSway and bobbing on uJump. Seated crowds sway, standing ones bob. */
function crowdMat(U) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uJump = U.uJump; sh.uniforms.uSway = U.uSway;
    sh.uniforms.uS0 = U.uS0; sh.uniforms.uS1 = U.uS1;
    sh.vertexShader = 'attribute float aTint;\nattribute float aS;\nuniform float uTime, uJump, uSway, uS0, uS1;\n' + sh.vertexShader
      .replace('#include <color_vertex>', `vColor = vec3(1.0);
        #ifdef USE_COLOR
        vColor *= color;
        #endif
        #ifdef USE_INSTANCING_COLOR
        vColor = mix(vColor, vColor * instanceColor.rgb, aTint);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
        // a cheer where the parade is passing (aS: the instance's place along the route)
        float near = (aS > uS0 && aS < uS1) ? 1.0 : 0.0;
        float j = max(0.0, sin(uTime * 11.0 + ph * 6.283)) * (uJump + near * 0.6) * 0.22;
        transformed.y += j;
        transformed.x += sin(uTime * 2.6 + float(gl_InstanceID / 6) * 3.1416) * uSway * 0.09 * position.y;`);
  };
  return m;
}
function setAttr(geo, name, n, v) { geo.setAttribute(name, new THREE.Float32BufferAttribute(new Float32Array(n).fill(v), 1)); }
/** One person as merged boxes; local +z is where they face. tint = the shirt/jacket takes the instance colour. */
function personGeo(seated) {
  const parts = [];
  const add = (B, tint) => { const g = B.build(); setAttr(g, 'aTint', g.attributes.position.count, tint); parts.push(g); };
  let B = new Builder(false);
  if (!seated) { B.box(0, 0, 0, 0.36, 0.86, 0.22, 0, [0.16, 0.17, 0.2]); }
  add(B, 0);
  B = new Builder(false);
  const y0 = seated ? 0 : 0.84;
  B.box(0, y0, 0, 0.44, 0.6, 0.26, 0, [1, 1, 1]);
  add(B, 1);
  B = new Builder(false);
  B.box(0, y0 + 0.6, 0.01, 0.19, 0.24, 0.21, 0, [0.85, 0.66, 0.5]);
  B.box(0, y0 + 0.82, -0.01, 0.21, 0.06, 0.23, 0, [0.12, 0.09, 0.07]);
  add(B, 0);
  const g = mergeGeos(parts);
  setAttr(g, 'aS', g.attributes.position.count, -1);
  return g;
}
function mergeGeos(list) {
  const out = new THREE.BufferGeometry();
  const names = Object.keys(list[0].attributes);
  for (const nm of names) {
    const sz = list[0].attributes[nm].itemSize;
    const arr = [];
    for (const g of list) arr.push(...g.attributes[nm].array);
    out.setAttribute(nm, new THREE.Float32BufferAttribute(arr, sz));
  }
  const idx = []; let base = 0;
  for (const g of list) { for (const i of g.index.array) idx.push(i + base); base += g.attributes.position.count; }
  out.setIndex(idx);
  out.computeBoundingSphere();
  for (const g of list) g.dispose();
  return out;
}
/** Onkel Hans: the festival's mascot, `k` times life size, facing +z, feet at y0. */
function onkelHans(B, x, y0, z, k = 1, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (lx, ly, lz) => [x + lx * c + lz * s, y0 + ly * k, z - lx * s + lz * c];
  const box = (lx, ly, lz, w, h, d, col) => { const p = P(lx * k, 0, lz * k); B.box(p[0], y0 + ly * k, p[2], w * k, h * k, d * k, -rot, col); };
  const LED = lin('#5a3a1e'), SHIRT = lin('#f4f2ea'), GREEN = lin('#2e5a2a'), SOCK = lin('#e8e2d0'), FACE = lin('#f0c09a');
  for (const sd of [-1, 1]) { box(sd * 0.12, 0, 0.03, 0.14, 0.08, 0.26, [0.08, 0.06, 0.05]); box(sd * 0.12, 0.08, 0, 0.13, 0.38, 0.13, SOCK); }
  box(0, 0.46, 0, 0.44, 0.34, 0.3, LED);                         // the lederhosen
  box(0, 0.78, 0, 0.5, 0.52, 0.36, SHIRT);                       // the belly and shirt
  for (const sd of [-1, 1]) { box(sd * 0.12, 0.8, 0.185, 0.05, 0.5, 0.02, LED); box(sd * 0.3, 0.9, 0.05, 0.12, 0.42, 0.12, SHIRT); }
  box(0, 1.08, 0.19, 0.24, 0.05, 0.02, GREEN);                   // the brustlatz's bar
  // the big head: a round face, red cheeks, the moustache, the green hat with its brim and feather
  const h = P(0, 0, 0.02);
  B.spheroid(h[0], y0 + 1.58 * k, h[2], 0.34 * k, 10, 7, FACE, 1.05);
  for (const sd of [-1, 1]) { const q = P(sd * 0.15 * k, 0, 0.28 * k); B.spheroid(q[0], y0 + 1.52 * k, q[2], 0.07 * k, 6, 4, lin('#e07a6a'), 0.8); }
  const m = P(0, 0, 0.32 * k); B.spheroid(m[0], y0 + 1.47 * k, m[2], 0.13 * k, 8, 4, lin('#4a2a14'), 0.45);
  for (const sd of [-1, 1]) { const e = P(sd * 0.1 * k, 0, 0.31 * k); B.box(e[0], y0 + 1.63 * k, e[2], 0.05 * k, 0.05 * k, 0.03 * k, -rot, [0.05, 0.05, 0.05]); }
  B.prism(h[0], y0 + 1.84 * k, h[2], 0.42 * k, 0.05 * k, 12, GREEN);
  B.cone(h[0], y0 + 1.86 * k, h[2], 0.27 * k, 0.32 * k, 10, GREEN);
  const f = P(0.16 * k, 0, -0.05 * k); B.tube([f[0], y0 + 1.9 * k, f[2]], [f[0] - s * 0.08 * k, y0 + 2.3 * k, f[2] - c * 0.12 * k], 0.025 * k, 4, lin('#e8e0c8'));
}
/** A canvas of lettering panels: [{ key, w, h, draw(g, W, H) }] -> { tex, uv: key -> [u0, v0, u1, v1] }. */
function labelAtlas(list, W = 1024) {
  let x = 0, y = 0, row = 0;
  const pos = [];
  for (const p of list) { if (x + p.w > W) { x = 0; y += row; row = 0; } pos.push([x, y]); x += p.w; row = Math.max(row, p.h); }
  const H = THREE.MathUtils.ceilPowerOfTwo(y + row);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const uv = {};
  list.forEach((p, i) => {
    const [px, py] = pos[i];
    g.save(); g.translate(px, py); g.beginPath(); g.rect(0, 0, p.w, p.h); g.clip(); p.draw(g, p.w, p.h); g.restore();
    uv[p.key] = [px / W, 1 - (py + p.h) / H, (px + p.w) / W, 1 - py / H];
  });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { tex, uv };
}
function fitText(g, s, x, y, w, font) {
  g.font = font; const m = g.measureText(s).width;
  g.save(); g.translate(x, y); if (m > w) g.scale(w / m, 1); g.fillText(s, 0, 0); g.restore();
}
/** Bavaria's white and blue lozenges. */
function rauten(g, W, H, n = 8) {
  const d = W / n;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1d6fd0';
  for (let yy = -1; yy * d / 2 < H + d; yy++) for (let xx = -1; xx <= n + 1; xx++) {
    if ((xx + yy) % 2) continue;
    const cx = xx * d + (yy % 2 ? d / 2 : 0), cy = yy * d * 0.55;
    g.beginPath(); g.moveTo(cx, cy - d * 0.55); g.lineTo(cx + d / 2, cy); g.lineTo(cx, cy + d * 0.55); g.lineTo(cx - d / 2, cy); g.closePath(); g.fill();
  }
}
/** A textured quad list -> one mesh. quads: [[a, b, c, d (corners, ccw from bottom-left)], uvRect] */
function quadsMesh(quads, mat) {
  const pos = [], uvs = [], idx = [];
  quads.forEach(([P, r], i) => {
    for (const p of P) pos.push(p[0], p[1], p[2]);
    uvs.push(r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]);
    const k = i * 4; idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}
function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}

// --- the band's music ------------------------------------------------------------------------------

/** An original oom-pah waltz in B-flat, 3/4 at 168 bpm, synthesised and scheduled ahead. */
class Band {
  constructor(ctx, dest) {
    this.c = ctx;
    if (!ctx) return;
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(dest || ctx.destination);
    this.next = 0; this.bar = 0; this.on = false;
    const n = ctx.sampleRate * 0.3;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  level(v) { if (this.c) this.out.gain.setTargetAtTime(v, this.c.currentTime, 0.25); }
  start() { if (!this.c || this.on) return; this.on = true; this.next = this.c.currentTime + 0.1; this.bar = 0; }
  stop() { this.on = false; if (this.c) this.out.gain.setTargetAtTime(0, this.c.currentTime, 0.2); }
  _note(type, f, t, d, v, lp = 2400) {
    const o = this.c.createOscillator(), g = this.c.createGain(), fl = this.c.createBiquadFilter();
    o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = lp;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.025); g.gain.setValueAtTime(v * 0.8, t + d * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(fl).connect(g).connect(this.out); o.start(t); o.stop(t + d + 0.02);
  }
  _drum(t, v) {
    const s = this.c.createBufferSource(), g = this.c.createGain(), f = this.c.createBiquadFilter();
    s.buffer = this.noise; f.type = 'lowpass'; f.frequency.value = 180;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    s.connect(f).connect(g).connect(this.out); s.start(t);
    this._note('sine', 62, t, 0.2, v * 0.8, 400);
  }
  /** Keep ~0.6 s of music scheduled. */
  update() {
    if (!this.c || !this.on) return;
    const beat = 60 / 168, mid = (n) => 440 * Math.pow(2, (n - 69) / 12);
    // chords (root, third, fifth as MIDI) per bar, 16 bars: Bb Bb F F F F Bb Bb Eb Eb Bb Bb F F Bb Bb
    const B = [58, 62, 65], F7 = [53, 57, 60, 63], E = [51, 55, 58];
    const prog = [B, B, F7, F7, F7, F7, B, B, E, E, B, B, F7, F7, B, B];
    // the tune: one note a beat, 0 = rest, a dotted note held as -1
    const mel = [70, 74, 77, 77, -1, 75, 74, 72, 72, -1, 0, 72, 69, 72, 75, 75, -1, 74, 72, 70, 70, -1, -1, 0,
      70, 72, 74, 75, -1, 77, 79, 77, 75, 74, -1, 70, 72, 74, 72, 69, 70, 72, 70, -1, -1, 0, 0, 0];
    while (this.next < this.c.currentTime + 0.6) {
      const t = this.next, b = this.bar % 16, ch = prog[b];
      // oom: the tuba on the root (alternating to the fifth), the drum
      this._note('triangle', mid(ch[0] - 24 + (this.bar % 2 ? 7 : 0)), t, beat * 0.9, 0.5, 900);
      this._note('sine', mid(ch[0] - 24 + (this.bar % 2 ? 7 : 0)), t, beat * 0.9, 0.3, 600);
      this._drum(t, 0.5);
      // pah-pah: the brass chord on 2 and 3
      for (const k of [1, 2]) for (const n of ch.slice(1)) this._note('sawtooth', mid(n), t + k * beat, beat * 0.45, 0.07, 1800);
      // the tune (clarinet and trumpet in octaves), 3 beats from the 48-beat line
      for (let k = 0; k < 3; k++) {
        const i = (this.bar * 3 + k) % mel.length, n = mel[i];
        if (n > 0) {
          let len = 1; while (mel[(i + len) % mel.length] === -1 && len < 3) len++;
          this._note('square', mid(n), t + k * beat, beat * len * 0.92, 0.07, 2600);
          this._note('sawtooth', mid(n - 12), t + k * beat, beat * len * 0.9, 0.05, 1500);
        }
      }
      this.next += beat * 3; this.bar++;
    }
  }
}

// --- the festhalle -----------------------------------------------------------------------------------

const HX = 24, HZ = 12, WALL = 7.2, RIDGE = 11.5, STAGE_X = 17, STAGE_Y = 1.0;
const ME_X = STAGE_X + 3.4, ME_Z = -3.05;     // where you stand for the contest: the end of the line

export class Oktoberfest {
  /** opts: { scene, city, traffic, audio, renderer, phone, camera, hud (getter obj), onReward(n, why), onEnd } */
  constructor(opts) {
    this.o = opts;
    this.mode = 'off';           // off | walk | menu | hold | result
    this.halls = [];
    for (const h of HALLS) { const d = this._door(h); if (d) this.halls.push({ ...h, door: d }); }
    this.parade = new Parade(opts);
    this.keys = {};
    this.drag = null;
    this.best = 0;
    try { this.best = +(localStorage.getItem('autokw-stein') || 0); } catch (e) { this.best = 0; }
    this._dom();
  }

  get inside() { return this.mode !== 'off'; }
  get active() { return this.inside; }
  get built() { return !!this.scene; }

  /** The door: from the building's middle toward its nearest street, just outside its box. */
  _door(h) {
    const city = this.o.city;
    const b = boxAt(city, h.x, h.z, 6);
    let best = null;
    for (const ei of city.edgesNear(h.x, h.z, 260)) {
      const e = city.edges[ei];
      if (e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp') continue;
      const a = city.nodes[e.a], t = Math.max(0, Math.min(e.len, (h.x - a.x) * e.dx + (h.z - a.z) * e.dz));
      const qx = a.x + e.dx * t, qz = a.z + e.dz * t, d = Math.hypot(qx - h.x, qz - h.z);
      if (!best || d < best.d) best = { qx, qz, d };
    }
    if (!best) return null;
    const ux = (best.qx - h.x) / best.d, uz = (best.qz - h.z) / best.d;
    let s = 0;
    for (; s < best.d; s += 1) {
      const px = h.x + ux * s, pz = h.z + uz * s;
      const bb = boxAt(city, px, pz, 0);
      if (!bb || (b && bb !== b)) break;
    }
    const x = h.x + ux * (s + 1.5), z = h.z + uz * (s + 1.5);
    return { x, z, yaw: Math.atan2(-ux, -uz) };
  }

  places() {
    const out = this.halls.map((h) => ({ x: h.door.x, z: h.door.z, kind: 'okt', name: h.name, label: h.short, near: false, hello: h.hello }));
    if (this.parade.ok) out.push({ x: this.parade.start.x, z: this.parade.start.z, kind: 'okt', name: 'Thanksgiving Day Parade', label: 'Parade', near: false,
      hello: 'Weber St at Frederick St — where the Oktoberfest Thanksgiving Day Parade sets off up Weber to Waterloo (Thanksgiving Monday, 9:30). Press ENTER to start it' });
    return out;
  }

  /** ENTER on foot: a festhalle's door (the hall) or the parade's start (the parade). */
  near(pl) {
    if (pl.onFoot === false) return null;
    for (const h of this.halls) if (Math.hypot(pl.x - h.door.x, pl.z - h.door.z) < 9) return h;
    if (this.parade.ok && !this.parade.active && Math.hypot(pl.x - this.parade.start.x, pl.z - this.parade.start.z) < 22) return 'parade';
    return null;
  }

  // --- in and out ----------------------------------------------------------------------------------

  enter(hall) {
    this.hall = hall;
    this._build(hall);
    this.mode = 'walk'; this.walkT = 0; this.t = 0;
    this.el.classList.add('show');
    this.ui.panel.classList.remove('on');
    setInterior(true);
    const a = this.o.audio;
    if (!this.band) this.band = new Band(a && a.ctx, a && a.master);
    this.band.start(); this.band.level(0.32);
  }

  leave() {
    if (this.mode === 'off') return;
    this.mode = 'off';
    this.el.classList.remove('show');
    this.ui.panel.classList.remove('on');
    this.ui.hud.classList.remove('on');
    setInterior(false);
    if (this.band) this.band.stop();
    if (this.scene) { disposeTree(this.scene); this.scene = null; }
    this.contest = null; this.keys = {};
    if (this.o.onEnd) this.o.onEnd();
  }

  // --- the hall ------------------------------------------------------------------------------------

  _build(hall) {
    const t0 = performance.now();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a1e14);
    this.scene = scene;
    this.cam = new THREE.PerspectiveCamera(62, 2, 0.05, 120);
    scene.add(this.cam);
    scene.add(new THREE.HemisphereLight(0xfff0d8, 0x5a4030, 2.4));
    const key = new THREE.DirectionalLight(0xffe8c8, 1.6); key.position.set(-6, 20, 8); scene.add(key);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    let tris = 0;
    const add = (B, m = mat) => { const g = B.build(); tris += g.index.count / 3; const me = new THREE.Mesh(g, m); scene.add(me); return me; };
    const B = new Builder(false);
    const Q = (a, b, c, d, n, col) => B.quad(a, b, c, d, n, [0, 0, 0, 0, 0, 0, 0, 0], col);
    // the floor: boards along the hall
    for (let z = -HZ, i = 0; z < HZ; z += 0.6, i++) Q([-HX, 0, z], [HX, 0, z], [HX, 0, z + 0.6], [-HX, 0, z + 0.6], [0, 1, 0], i % 3 === 0 ? lin('#7a5230') : i % 3 === 1 ? lin('#86603a') : lin('#704a2a'));
    // walls: a wood wainscot, cream plaster, a dark beam on top
    const WOOD = lin('#5a3a20'), PLASTER = lin('#efe4cc'), BEAM = lin('#3a2614');
    const wall = (ax, az, bx, bz, nx, nz) => {
      Q([ax, 0, az], [bx, 0, bz], [bx, 1.3, bz], [ax, 1.3, az], [nx, 0, nz], WOOD);
      Q([ax, 1.3, az], [bx, 1.3, bz], [bx, WALL - 0.4, bz], [ax, WALL - 0.4, az], [nx, 0, nz], PLASTER);
      Q([ax, WALL - 0.4, az], [bx, WALL - 0.4, bz], [bx, WALL, bz], [ax, WALL, az], [nx, 0, nz], BEAM);
    };
    wall(-HX, -HZ, HX, -HZ, 0, 1); wall(-HX, HZ, HX, HZ, 0, -1); wall(-HX, -HZ, -HX, HZ, 1, 0); wall(HX, -HZ, HX, HZ, -1, 0);
    // the gable ends and the roof boards, the trusses
    for (const sx of [-1, 1]) B.tri([sx * HX, WALL, -HZ], [sx * HX, WALL, HZ], [sx * HX, RIDGE, 0], [-sx, 0, 0], PLASTER);
    for (const sz of [-1, 1]) Q([-HX, WALL, sz * HZ], [HX, WALL, sz * HZ], [HX, RIDGE, 0], [-HX, RIDGE, 0], [0, -0.8, -sz * 0.4], lin('#6a4a2c'));
    for (let x = -HX + 3; x < HX; x += 4) {
      B.box(x, WALL - 0.3, 0, 0.3, 0.3, HZ * 2, 0, BEAM);                     // tie beam
      for (const sz of [-1, 1]) B.tube([x, WALL, sz * HZ], [x, RIDGE - 0.1, 0], 0.15, 4, BEAM);
      B.tube([x, WALL - 0.15, 0], [x, RIDGE - 0.1, 0], 0.12, 4, BEAM);
      // a wagon-wheel chandelier with its lamps
      B.prism(x, WALL - 2.4, 0, 1.0, 0.1, 10, BEAM);
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; B.box(x + Math.cos(a) * 1.0, WALL - 2.3, Math.sin(a) * 1.0, 0.16, 0.22, 0.16, 0, [5, 4.2, 3]); }
      B.tube([x, WALL - 2.3, 0], [x, WALL - 0.3, 0], 0.02, 3, BEAM);
    }
    // the stage: a platform across the end, steps down to the floor, the band's riser
    B.box(STAGE_X + (HX - STAGE_X) / 2, 0, 0, HX - STAGE_X, STAGE_Y, HZ * 2 - 0.2, 0, lin('#4a3018'));
    B.box(STAGE_X - 0.6, 0, -6, 1.2, 0.5, 2.4, 0, lin('#4a3018'));
    B.box(STAGE_X + 4.5, STAGE_Y, 3, 3, 0.4, 9, 0, lin('#5a3a20'));
    // the long tables and benches in three rows, aisles between
    const TAB = lin('#b88a52'), BEN = lin('#9a7044');
    this.seats = [];
    for (const tz of [-7.2, 0, 7.2]) {
      for (let x0 = -21; x0 < 12; x0 += 3.3) {
        B.box(x0 + 1.5, 0.74, tz, 3.0, 0.05, 0.75, 0, TAB);
        for (const lx of [0.2, 2.8]) B.box(x0 + lx, 0, tz, 0.08, 0.74, 0.6, 0, BEN);
        for (const sd of [-1, 1]) {
          B.box(x0 + 1.5, 0.43, tz + sd * 0.7, 3.0, 0.04, 0.3, 0, BEN);
          for (let k = 0; k < 5; k++) this.seats.push([x0 + 0.3 + k * 0.6, 0.45, tz + sd * 0.72, sd]);
        }
      }
    }
    // the band: six in lederhosen and green hats with their instruments, on the riser
    const BRASS = lin('#d8b040'), SHIRT = lin('#f4f2ea'), LED = lin('#5a3a1e'), HAT = lin('#2e5a2a');
    const musicians = [[-1.2, 'tuba'], [0.2, 'trombone'], [1.6, 'trumpet'], [3.0, 'accordion'], [4.4, 'clarinet'], [5.8, 'drum']];
    for (const [mz, ins] of musicians) {
      const x = STAGE_X + 4.2, y = STAGE_Y + 0.4, z = mz;
      B.box(x, y, z, 0.3, 0.5, 0.36, 0, LED); B.box(x, y + 0.5, z, 0.3, 0.55, 0.42, 0, SHIRT);
      B.box(x - 0.01, y + 1.05, z, 0.22, 0.25, 0.2, 0, SKIN[(mz * 7 & 3)]);
      B.prism(x, y + 1.28, z, 0.24, 0.03, 8, HAT); B.cone(x, y + 1.3, z, 0.15, 0.18, 8, HAT);
      if (ins === 'tuba') { B.prism(x - 0.25, y + 0.6, z, 0.22, 0.6, 10, BRASS); B.cone(x - 0.25, y + 1.2, z, 0.34, 0.25, 10, BRASS); }
      else if (ins === 'drum') { B.prism(x - 0.4, y, z, 0.35, 0.7, 12, lin('#c8102e')); B.prism(x - 0.4, y + 0.7, z, 0.33, 0.02, 12, [0.9, 0.9, 0.85]); }
      else if (ins === 'accordion') B.box(x - 0.3, y + 0.55, z, 0.3, 0.4, 0.5, 0, lin('#b81c24'));
      else B.tube([x - 0.15, y + 1.0, z], [x - 0.75, y + (ins === 'trombone' ? 0.8 : 0.95), z], ins === 'trombone' ? 0.05 : 0.035, 6, BRASS);
    }
    // Onkel Hans by the band, waving at the room
    onkelHans(B, STAGE_X + 2.6, STAGE_Y, 8.2, 1.15, -Math.PI / 2);
    // waitresses in dirndls with steins, in the aisles
    for (const [wx, wz] of [[-12, -3.6], [-2, 3.6], [6, -3.6]]) {
      B.box(wx, 0, wz, 0.5, 0.95, 0.5, 0, lin('#1d4fa0')); B.box(wx, 0.5, wz, 0.52, 0.42, 0.52, 0, [0.95, 0.95, 0.95]);
      B.box(wx, 0.95, wz, 0.36, 0.5, 0.26, 0, lin('#1a1a1a')); B.box(wx, 1.2, wz, 0.38, 0.22, 0.28, 0, [0.95, 0.95, 0.95]);
      B.box(wx, 1.45, wz, 0.2, 0.24, 0.21, 0, SKIN[0]); B.box(wx, 1.62, wz, 0.23, 0.1, 0.24, 0, lin('#c89a40'));
      for (const sd of [-1, 1]) B.prism(wx - 0.32, 1.1, wz + sd * 0.2, 0.06, 0.18, 6, lin('#e8a828'));
    }
    add(B);
    // the contestants on the stage's front edge, arms out with their steins (the player at the right end)
    this.rivals = [];
    const names = RIVALS.slice().sort(() => Math.random() - 0.5).slice(0, 4);
    for (let i = 0; i < 4; i++) {
      const x = ME_X - 0.7 * (i + 1.6), z = ME_Z + 1.25 * (i + 1.6), y = STAGE_Y;
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = -Math.PI / 2;     // facing -x, into the hall
      const P = new Builder(false), sh = lin(['#2a5a9a', '#9a2a2a', '#3a6a3a', '#d8c8a0'][i]);
      P.box(0, 0, 0, 0.36, 0.86, 0.22, 0, lin('#4a3018')); P.box(0, 0.84, 0, 0.46, 0.62, 0.28, 0, sh);
      P.box(0, 1.46, 0.01, 0.2, 0.25, 0.22, 0, SKIN[i]); P.box(0, 1.69, -0.01, 0.22, 0.06, 0.24, 0, [0.15, 0.1, 0.08]);
      P.box(-0.3, 0.9, 0, 0.12, 0.5, 0.12, 0, sh);
      const body = new THREE.Mesh(P.build(), mat); g.add(body);
      const arm = new THREE.Group(); arm.position.set(0.27, 1.38, 0); g.add(arm);
      const A = new Builder(false);
      A.box(0, -0.06, 0.3, 0.11, 0.11, 0.6, 0, sh); A.box(0, -0.08, 0.64, 0.1, 0.1, 0.1, 0, SKIN[i]);
      A.prism(0.02, -0.17, 0.72, 0.07, 0.2, 10, lin('#e8a828')); A.prism(0.02, 0.03, 0.72, 0.071, 0.04, 10, [1, 1, 0.95]);
      arm.add(new THREE.Mesh(A.build(), mat));
      scene.add(g);
      this.rivals.push({ name: names[i], g, arm, out: false, dropT: 0, z });
    }
    // the crowd at the tables (swaying) and standing at the back (bobbing)
    const U = { uTime: { value: 0 }, uJump: { value: 0 }, uSway: { value: 1 }, uS0: { value: -1 }, uS1: { value: -1 } };
    this.U = U;
    const cols = ['#c8102e', '#1d6fd0', '#2e7a3a', '#f2f2ee', '#3a3a40', '#d8b040', '#7a4a8a', '#e87a20', '#5a3a20', '#8ab4e8'].map((h) => new THREE.Color(h));
    const seat = personGeo(true);
    const fill = this.o.phone ? 0.8 : 0.95;
    const sp = this.seats.filter(() => Math.random() < fill);
    const im = new THREE.InstancedMesh(seat, crowdMat(U), sp.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s1 = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    sp.forEach(([x, y, z, sd], i) => { e.set(0, sd > 0 ? Math.PI : 0, 0); q.setFromEuler(e); p.set(x, y, z); m4.compose(p, q, s1); im.setMatrixAt(i, m4); im.setColorAt(i, cols[(i * 7 + (i >> 3)) % cols.length]); });
    im.frustumCulled = false; scene.add(im); tris += sp.length * seat.index.count / 3;
    const stand = personGeo(false);
    const st = [];
    for (let x = -22.5; x < -16; x += 0.75) for (let z = -11; z < 11; z += 0.8) if (Math.random() < 0.55 && Math.abs(Math.abs(z) - 3.6) > 1.1) st.push([x + Math.random() * 0.3, z]);
    const im2 = new THREE.InstancedMesh(stand, crowdMat({ ...U, uSway: { value: 0 } }), st.length);
    st.forEach(([x, z], i) => { e.set(0, Math.PI / 2 + (Math.random() - 0.5), 0); q.setFromEuler(e); p.set(x, 0, z); m4.compose(p, q, s1); im2.setMatrixAt(i, m4); im2.setColorAt(i, cols[(i * 3) % cols.length]); });
    im2.frustumCulled = false; scene.add(im2); tris += st.length * stand.index.count / 3;
    // steins on the tables
    const SB = new Builder(false);
    SB.prism(0, 0, 0, 0.06, 0.17, 8, lin('#e8a828')); SB.prism(0, 0.17, 0, 0.061, 0.035, 8, [1, 1, 0.95]);
    const sg = SB.build(), stn = [];
    for (const [x, y, z, sd] of this.seats) if (Math.random() < 0.6) stn.push([x + (Math.random() - 0.5) * 0.3, z - sd * 0.42]);
    const im3 = new THREE.InstancedMesh(sg, mat, stn.length);
    stn.forEach(([x, z], i) => { m4.makeTranslation(x, 0.79, z); im3.setMatrixAt(i, m4); });
    scene.add(im3); tris += stn.length * sg.index.count / 3;
    // lettering, banners, bunting: one atlas
    const A = labelAtlas([
      { key: 'okt', w: 1024, h: 200, draw: (g, W, H) => { g.fillStyle = '#1d4fa0'; g.fillRect(0, 0, W, H); g.fillStyle = '#ffffff'; g.fillRect(0, 12, W, 6); g.fillRect(0, H - 18, W, 6); g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'WILLKOMMEN ZUM OKTOBERFEST', W / 2, H * 0.42, W - 60, '900 92px Georgia, serif'); g.fillStyle = '#ffd23a'; fitText(g, `${hall.name.toUpperCase()} · ${hall.sub.toUpperCase()}`, W / 2, H * 0.8, W - 80, '800 36px Helvetica, Arial, sans-serif'); } },
      { key: 'kwo', w: 512, h: 200, draw: (g, W, H) => { rauten(g, W, H, 10); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(30, 40, W - 60, H - 80); g.fillStyle = '#1d4fa0'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'KITCHENER-WATERLOO', W / 2, 78, W - 90, '900 40px Helvetica, Arial, sans-serif'); fitText(g, 'OKTOBERFEST', W / 2, 128, W - 90, '900 54px Georgia, serif'); } },
      { key: 'prosit', w: 512, h: 200, draw: (g, W, H) => { g.fillStyle = '#2e5a2a'; g.fillRect(0, 0, W, H); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'Ein Prosit!', W / 2, H / 2, W - 50, 'italic 900 88px Georgia, serif'); } },
      { key: 'rauten', w: 128, h: 512, draw: (g, W, H) => rauten(g, W, H, 3) },
      { key: 'contest', w: 512, h: 128, draw: (g, W, H) => { g.fillStyle = '#7a1a14'; g.fillRect(0, 0, W, H); g.fillStyle = '#ffd23a'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'MASSKRUGSTEMMEN', W / 2, H * 0.42, W - 40, '900 58px Helvetica, Arial, sans-serif'); g.fillStyle = '#ffffff'; fitText(g, 'STEIN HOLDING CONTEST', W / 2, H * 0.8, W - 60, '700 26px Helvetica, Arial, sans-serif'); } },
    ]);
    const lm = new THREE.MeshLambertMaterial({ map: A.tex, side: THREE.DoubleSide, emissive: 0x302820 });
    const quads = [];
    const ex = HX - 0.05;
    quads.push([[[ex, 4.0, -7], [ex, 4.0, 7], [ex, 6.6, 7], [ex, 6.6, -7]], A.uv.okt]);
    quads.push([[[ex, 1.6 + STAGE_Y, 7.6], [ex, 1.6 + STAGE_Y, 10.6], [ex, 2.8 + STAGE_Y, 10.6], [ex, 2.8 + STAGE_Y, 7.6]], A.uv.prosit]);
    quads.push([[[STAGE_X + 0.01, 0.15, 3.5], [STAGE_X + 0.01, 0.15, -3.5], [STAGE_X + 0.01, 0.95, -3.5], [STAGE_X + 0.01, 0.95, 3.5]], A.uv.contest].map((v, i) => (i === 0 ? v.map((c) => [STAGE_X - 0.01, c[1], c[2]]) : v)));
    quads.push([[[-HX + 0.05, 3.2, 4], [-HX + 0.05, 3.2, -4], [-HX + 0.05, 6.4, -4], [-HX + 0.05, 6.4, 4]], A.uv.kwo]);
    for (let x = -HX + 5; x < HX - 4; x += 8) for (const sz of [-1, 1]) {
      const z = sz * (HZ - 0.05);
      quads.push([[[x - 0.6, 2.2, z], [x + 0.6, 2.2, z], [x + 0.6, 6.6, z], [x - 0.6, 6.6, z]], A.uv.rauten]);
    }
    const lab = quadsMesh(quads, lm); scene.add(lab);
    // bunting: strings of blue and white pennants across the hall
    const BU = new Builder(false);
    for (let x = -HX + 3; x < HX - 2; x += 4) {
      const sag = (t) => WALL - 0.8 - Math.sin(t * Math.PI) * 1.4;
      for (let k = 0; k < 24; k++) {
        const t0 = k / 24, t1 = (k + 0.7) / 24, za = -HZ + t0 * 2 * HZ, zb = -HZ + t1 * 2 * HZ;
        const ya = sag(t0), yb = sag(t1), zm = (za + zb) / 2;
        BU.tri([x + 2, ya, za], [x + 2, yb, zb], [x + 2, (ya + yb) / 2 - 0.45, zm], [1, 0, 0], k % 2 ? [0.95, 0.95, 0.95] : lin('#1d6fd0'));
      }
    }
    add(BU, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    // the player's own arm and stein, fixed to the camera
    const arm = new THREE.Group();
    const AB = new Builder(false);
    AB.box(0, -0.055, 0, 0.11, 0.11, 1, 0, lin('#d8d0c0'));          // a sleeve, unit long along +z (scaled each frame)
    const sleeve = new THREE.Mesh(AB.build(), mat); arm.add(sleeve);
    const stein = new THREE.Group();
    const S = new Builder(false);
    S.prism(0, -0.11, 0, 0.068, 0.2, 14, lin('#e8a020'));            // the beer
    S.prism(0, 0.09, 0, 0.07, 0.045, 14, [1, 1, 0.96]);                // the head
    S.box(0.085, -0.06, 0, 0.03, 0.15, 0.025, 0, [0.85, 0.88, 0.9]);  // the handle
    S.box(0.1, -0.06, 0.0, 0.06, 0.07, 0.07, 0, SKIN[0]);             // the fist round it
    stein.add(new THREE.Mesh(S.build(), mat));
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.25, 16, 1, true), new THREE.MeshLambertMaterial({ color: 0xd8e8f0, transparent: true, opacity: 0.28, depthWrite: false }));
    glass.position.y = -0.005; stein.add(glass);
    arm.add(stein);
    arm.visible = false;
    this.cam.add(arm);
    this.arm = { g: arm, sleeve, stein };
    // the beer it spills
    const spill = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 1, 6), new THREE.MeshLambertMaterial({ color: 0xe8a020, transparent: true, opacity: 0.8 }));
    spill.visible = false; this.cam.add(spill); this.spill = spill;
    this.stats = { tris: Math.round(tris), ms: Math.round(performance.now() - t0), crowd: sp.length + st.length };
    if (typeof window !== 'undefined') window.__fest = this.stats;
  }

  // --- the contest -----------------------------------------------------------------------------------

  _startContest() {
    const R = Math.random;
    this.mode = 'hold';
    this.ui.panel.classList.remove('on');
    this.ui.hud.classList.add('on');
    const ph = [R() * 6, R() * 6, R() * 6];
    // the others' endurance: spread so the last one standing needs 40-70 s to beat
    const ends = [10 + R() * 14, 20 + R() * 18, 30 + R() * 24, 40 + R() * 30].sort(() => R() - 0.5);
    this.rivals.forEach((r, i) => { r.out = false; r.dropT = 0; r.end = ends[i]; r.arm.rotation.set(0, 0, 0); });
    this.contest = { t: 0, roll: 0, w: 0, arm: 1, low: 0, ph, kickT: 2 + R() * 3, over: null, spillT: 0 };
    this.o.audio && this.o.audio.ctx && this._sfx('roll');
  }

  _input() {
    const k = this.keys, d = this.drag;
    let x = (k.r ? 1 : 0) - (k.l ? 1 : 0), up = k.u ? 1 : 0;
    if (d) { x += Math.max(-1, Math.min(1, d.dx / 70)); up = Math.max(up, Math.max(0, Math.min(1, -d.dy / 60))); }
    return { x: Math.max(-1, Math.min(1, x)), up };
  }

  _stepContest(dt) {
    const c = this.contest, t = c.t, inp = this._input();
    c.t += dt;
    // the wobble: three slow sines that grow, a kick now and then, and the stein's own unstable lean
    const A = 18 + 1.0 * t;
    const wob = A * (0.6 * Math.sin(1.7 * t + c.ph[0]) + 0.5 * Math.sin(3.1 * t + c.ph[1]) + 0.4 * Math.sin(0.7 * t + c.ph[2]));
    c.kickT -= dt;
    if (c.kickT <= 0) { c.kickT = 2.5 + Math.random() * 3.5; c.w += (Math.random() < 0.5 ? -1 : 1) * (8 + t * 0.3); }
    c.w += (wob + 1.2 * c.roll - 1.5 * c.w + inp.x * 95) * dt;
    c.roll += c.w * dt;
    // the arm: a sag that grows, a lift that tires
    const sag = 0.03 + 0.004 * t, lift = Math.max(0, 0.42 - 0.003 * t);
    c.arm = Math.max(0.3, Math.min(1.08, c.arm + (-sag + inp.up * lift + Math.sin(t * 9) * 0.01 * Math.min(3, t / 20)) * dt));
    c.low = c.arm < 0.55 ? c.low + dt : 0;
    // the others
    for (const r of this.rivals) {
      if (!r.out && c.t >= r.end) { r.out = true; r.dropT = 0; this.U.uJump.value = 1; this._sfx('drop'); }
      if (r.out) { r.dropT += dt; r.arm.rotation.x = Math.min(1.35, r.dropT * 3); }
      else { const tr = Math.min(1, c.t / r.end); r.arm.rotation.x = Math.sin(c.t * (7 + r.z)) * 0.03 * tr + tr * 0.12; r.arm.rotation.z = Math.sin(c.t * 2.3 + r.z) * 0.08 * tr; }
    }
    const left = this.rivals.filter((r) => !r.out).length;
    if (Math.abs(c.roll) > 24) this._end('SPILLED!', left);
    else if (c.low > 1.0) this._end('ARM DOWN', left);
  }

  _end(why, left) {
    const c = this.contest;
    c.over = why; c.spillT = why === 'SPILLED!' ? 1.2 : 0;
    this.mode = 'result';
    this.U.uJump.value = 1;
    const place = left + 1, won = left === 0;
    const beat = 4 - left, pay = beat * 20 + (won ? 100 : 0);
    const best = c.t > this.best;
    if (best) { this.best = c.t; try { localStorage.setItem('autokw-stein', String(c.t.toFixed(1))); } catch (e) { /* private mode */ } }
    this.result = { why, held: +c.t.toFixed(1), place, won, pay, best };
    if (pay && this.o.onReward) this.o.onReward(pay, won ? 'Stein-holding champion' : `Stein holding: ${place}${['st', 'nd', 'rd', 'th', 'th'][place - 1]} of 5`);
    this._sfx(won ? 'win' : 'drop');
    this.ui.hud.classList.remove('on');
    setTimeout(() => {
      if (this.mode !== 'result') return;
      this._panel(`<div class="big">${won ? 'PROSIT! YOU WIN' : why}</div>
        <div class="sm">You held the Mass out for <b>${c.t.toFixed(1)} s</b> — ${won ? 'the last one standing' : `${place}${['st', 'nd', 'rd', 'th', 'th'][place - 1]} of 5`}${best ? ' · a new best' : ` · best ${this.best.toFixed(1)} s`}<br>
        ${pay ? `The hall pays $${pay}` : 'Nothing for that — try again'}</div>
        <button class="go">AGAIN</button><button class="back">LEAVE THE HALL</button>`, () => this._startContest(), () => this.leave());
    }, 1300);
  }

  _sfx(name) {
    const a = this.o.audio, ctx = a && a.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01, out = ctx.createGain(); out.gain.value = 0.3; out.connect(a.master || ctx.destination);
    const noise = (d, v, f) => {
      const n = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * d), ctx.sampleRate), ch = n.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      const s = ctx.createBufferSource(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
      s.buffer = n; fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = 0.7;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + d * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      s.connect(fl).connect(g).connect(out); s.start(t);
    };
    if (name === 'roll') noise(1.6, 0.6, 300);            // a drum roll as the steins go up
    else if (name === 'drop') noise(1.0, 0.8, 800);       // the room's "ohhh"
    else if (name === 'win') noise(2.4, 1.0, 1100);       // the cheer
  }

  // --- the DOM: panels, the contest's gauges, the input ------------------------------------------------

  _dom() {
    const d = document.createElement('div');
    d.id = 'festUi';
    d.innerHTML = `<div class="fHud"><div class="fT">0.0</div><div class="fLevel"><div class="fBub"></div></div><div class="fArm"><div class="fLine"></div><div class="fHand"></div></div><div class="fWho"></div>
      <div class="fHelp">◀ ▶ keep it level · ▲ hold the arm up (or drag)</div></div>
      <div class="fPanel"></div><button class="fMenu">✕</button>`;
    const st = document.createElement('style');
    st.textContent = `
      #festUi { position: absolute; inset: 0; z-index: 40; display: none; user-select: none; -webkit-user-select: none; touch-action: none; font: 800 14px -apple-system, Helvetica, sans-serif; color: #fff; }
      #festUi.show { display: block; }
      #festUi .fMenu { position: absolute; top: calc(8px + var(--safe-t, 0px)); right: calc(14px + var(--safe-r, 0px)); width: 38px; height: 38px; border-radius: 50%; border: none; color: #fff; background: rgba(0,0,0,.35); font-size: 16px; }
      #festUi .fPanel { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: #0008; text-align: center; padding: 0 24px; }
      #festUi .fPanel.on { display: flex; }
      #festUi .fPanel .big { font: 900 32px Georgia, serif; color: #ffd23a; text-shadow: 0 2px 0 #1d4fa0; }
      #festUi .fPanel .sm { font-size: 14px; line-height: 1.6; max-width: 560px; }
      #festUi .fPanel button { padding: 10px 26px; border-radius: 999px; border: none; color: #fff; font: 900 14px -apple-system, Helvetica, sans-serif; background: #1d6fd0; }
      #festUi .fPanel button.back { background: rgba(255,255,255,.2); }
      #festUi .fHud { display: none; } #festUi .fHud.on { display: block; }
      #festUi .fT { position: absolute; top: calc(10px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%); font: 900 34px Georgia, serif; color: #ffd23a; text-shadow: 0 2px 0 #000; }
      #festUi .fLevel { position: absolute; bottom: calc(22px + var(--safe-b, 0px)); left: 50%; width: 260px; margin-left: -130px; height: 22px; border-radius: 11px; background: #fff3; border: 2px solid #fff8; }
      #festUi .fLevel::after { content: ''; position: absolute; left: 50%; top: -4px; bottom: -4px; width: 2px; background: #fff; }
      #festUi .fBub { position: absolute; top: 2px; width: 16px; height: 14px; margin-left: -8px; left: 50%; border-radius: 8px; background: #9fe870; }
      #festUi .fArm { position: absolute; right: calc(24px + var(--safe-r, 0px)); top: 30%; width: 18px; height: 40%; border-radius: 9px; background: #fff3; border: 2px solid #fff8; }
      #festUi .fLine { position: absolute; left: -6px; right: -6px; height: 2px; background: #ff5a3a; top: 55%; }
      #festUi .fHand { position: absolute; left: 1px; width: 12px; height: 12px; margin-top: -6px; border-radius: 6px; background: #ffd23a; }
      #festUi .fWho { position: absolute; top: calc(56px + var(--safe-t, 0px)); left: calc(16px + var(--safe-l, 0px)); font-size: 13px; line-height: 1.5; text-shadow: 0 1px 2px #000; }
      #festUi .fHelp { position: absolute; bottom: calc(52px + var(--safe-b, 0px)); left: 0; right: 0; text-align: center; font-size: 12px; opacity: .8; text-shadow: 0 1px 2px #000; }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { panel: q('.fPanel'), hud: q('.fHud'), t: q('.fT'), bub: q('.fBub'), hand: q('.fHand'), who: q('.fWho') };
    q('.fMenu').addEventListener('click', (e) => { e.stopPropagation(); this.leave(); });
    const map = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', Space: 'u' };
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      if (e.code === 'Escape') this.leave();
      else if (map[e.code]) this.keys[map[e.code]] = true;
      else if ((e.code === 'Enter' || e.code === 'KeyE' || e.code === 'KeyF') && (this.mode === 'menu' || this.mode === 'result')) this._startContest();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('keyup', (e) => { const k = map[e.code]; if (k) this.keys[k] = false; });
    d.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'hold' || e.target.closest('button')) return;
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
      try { d.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    });
    d.addEventListener('pointermove', (e) => { const g = this.drag; if (!g || g.id !== e.pointerId) return; g.dx = e.clientX - g.x0; g.dy = e.clientY - g.y0; });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) d.addEventListener(ev, (e) => { if (this.drag && this.drag.id === e.pointerId) this.drag = null; });
  }

  _panel(html, go, back) {
    const p = this.ui.panel;
    p.innerHTML = html; p.classList.add('on');
    const a = p.querySelector('.go'), b = p.querySelector('.back');
    if (a) a.addEventListener('click', go);
    if (b) b.addEventListener('click', back);
  }

  // --- the frame ---------------------------------------------------------------------------------------

  update(dt, paused = false) {
    if (!paused) this.parade.update(dt);
    if (this.mode === 'off' || !this.scene) return;
    this.t += dt;
    if (this.band) this.band.update();
    const U = this.U;
    U.uTime.value = this.t; U.uJump.value = Math.max(0, U.uJump.value - dt * 0.6);
    const cam = this.cam;
    const eye = new THREE.Vector3(ME_X, STAGE_Y + 1.62, ME_Z);
    const look = new THREE.Vector3(ME_X - 10, STAGE_Y + 0.2, ME_Z + 5.2);
    if (this.mode === 'walk') {
      // in at the door, down the aisle, up onto the stage
      this.walkT += dt;
      const k = Math.min(1, this.walkT / 4.5), e = k * k * (3 - 2 * k);
      const path = [[-HX + 1, 1.65, -3.6], [-6, 1.65, -3.6], [STAGE_X - 1.6, 1.65, -3.6], [eye.x, eye.y, eye.z]];
      const f = e * 3, i = Math.min(2, Math.floor(f)), u = f - i, a = path[i], b = path[i + 1];
      cam.position.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + Math.abs(Math.sin(this.walkT * 7)) * 0.03, a[2] + (b[2] - a[2]) * u);
      const tl = new THREE.Vector3(HX, 2.6, 0).lerp(look, Math.max(0, (e - 0.75) / 0.25));
      cam.lookAt(tl);
      if (k >= 1) {
        this.mode = 'menu';
        this._panel(`<div class="big">${this.hall.name}</div><div class="sm"><b>Masskrugstemmen</b> — the stein-holding contest. Hold a full one-litre Mass out at arm's length, level, for as long as you can, against four others.<br>
          ◀ ▶ (A / D, or drag) keep it level against the wobble; ▲ (W / Space, or drag up) holds your arm over the judge's line. Spill it, or let it hang for a second, and you're out.${this.best ? `<br>Your best: ${this.best.toFixed(1)} s` : ''}</div>
          <button class="go">STEP UP</button><button class="back">LEAVE THE HALL</button>`, () => this._startContest(), () => this.leave());
      }
    } else {
      cam.position.copy(eye); cam.lookAt(look);
    }
    // the contest: your arm and the stein in front of you
    const c = this.contest;
    if ((this.mode === 'hold' || this.mode === 'result') && c) {
      if (this.mode === 'hold') this._stepContest(Math.min(dt, 0.05));
      const A = this.arm; A.g.visible = true;
      const hy = -0.1 - (1 - c.arm) * 0.5, hx = 0.3, hz = -0.78 + (1 - c.arm) * 0.12;
      const sh = new THREE.Vector3(0.36, -0.42, -0.02), hand = new THREE.Vector3(hx, hy, hz);
      const dv = hand.clone().sub(sh), L = dv.length();
      A.sleeve.position.copy(sh); A.sleeve.scale.set(1, 1, L); A.sleeve.lookAt(hand);
      A.stein.position.set(hx - 0.1, hy + 0.04, hz - 0.03);
      A.stein.rotation.set(0, 0, -c.roll * Math.PI / 180);
      // spilled: the beer pours out of the tilted stein
      if (c.over === 'SPILLED!' && c.spillT > 0) {
        c.spillT -= dt;
        this.spill.visible = true; this.spill.position.set(hx - 0.1 - Math.sign(c.roll) * 0.1, hy - 0.4, hz - 0.03); this.spill.scale.set(1, 0.7, 1);
      } else this.spill.visible = false;
      if (this.mode === 'hold') {
        this.ui.t.textContent = c.t.toFixed(1);
        this.ui.bub.style.left = `${50 + Math.max(-48, Math.min(48, c.roll / 24 * 48))}%`;
        this.ui.bub.style.background = Math.abs(c.roll) > 16 ? '#ff5a3a' : Math.abs(c.roll) > 9 ? '#ffd23a' : '#9fe870';
        this.ui.hand.style.top = `${(1 - (c.arm - 0.3) / 0.8) * 100}%`;
        this.ui.who.innerHTML = this.rivals.map((r) => `${r.out ? '✕' : '●'} ${r.name}`).join('<br>');
      }
    } else if (this.arm) this.arm.g.visible = false;
    const r = this.o.renderer;
    const W = r.domElement.clientWidth || 800, H = r.domElement.clientHeight || 400;
    cam.aspect = W / H; cam.fov = W / H < 1.4 ? 74 : 62; cam.updateProjectionMatrix();
    r.setRenderTarget(null);
    r.render(this.scene, cam);
    this.lastCalls = r.info.render.calls; this.lastTris = r.info.render.triangles;
  }
}

// --- the parade --------------------------------------------------------------------------------------

const PARADE_V = 1.8;                     // m/s: a marching band's pace, a little brisk
const ROUTE_L = 1500;                     // m of Weber St from Frederick St toward Waterloo

class Parade {
  constructor(o) {
    this.o = o;
    this.active = false;
    this.group = null;
    this.speedUp = 1;
    this.ok = false;
    try { this._route(); } catch (e) { console.warn('parade route: ' + e.message); }
  }

  /** Weber St from its junction with Frederick St, toward Uptown Waterloo, ~1.5 km. */
  _route() {
    const city = this.o.city;
    const weber = (e) => e && /^Weber Street/.test(e.name || '') && !e.elev && !e.tunnel;
    let start = null;
    for (let i = 0; i < city.nodes.length && !start; i++) {
      const n = city.nodes[i];
      if (!n || !n.e) continue;
      let w = false, f = false;
      for (const ei of n.e) { const e = city.edges[ei]; if (weber(e)) w = true; if (e && /^Frederick Street/.test(e.name || '')) f = true; }
      if (w && f) start = i;
    }
    if (start === null) return;
    // toward Uptown: the spawn is on Waterloo Public Square
    const n0 = city.nodes[start];
    const tx = -985 - n0.x, tz = -807 - n0.z, tl = Math.hypot(tx, tz);
    let dir = [tx / tl, tz / tl], node = start, from = -1, L = 0;
    const pts = [[n0.x, n0.z]], edges = [], hws = [];
    while (L < ROUTE_L + 40) {
      const n = city.nodes[node];
      let best = null, bs = -Infinity;
      for (const ei of n.e) {
        if (ei === from) continue;
        const e = city.edges[ei];
        if (!weber(e)) continue;
        const sg = e.a === node ? 1 : -1, sc = e.dx * sg * dir[0] + e.dz * sg * dir[1];
        if (sc > bs) { bs = sc; best = { ei, sg }; }
      }
      if (!best || bs < 0.3) break;
      const e = city.edges[best.ei], nx = best.sg > 0 ? e.b : e.a, nn = city.nodes[nx];
      pts.push([nn.x, nn.z]); edges.push(best.ei); hws.push(e.hw);
      L += e.len; dir = [e.dx * best.sg, e.dz * best.sg]; from = best.ei; node = nx;
    }
    if (L < 300) return;
    // resample every 2 m, with the street's half-width at each point
    const R = [];
    let acc = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], sl = Math.hypot(bx - ax, bz - az);
      for (let s = (R.length ? (2 - (acc % 2)) % 2 : 0); s < sl; s += 2) R.push({ x: ax + (bx - ax) * s / sl, z: az + (bz - az) * s / sl, hw: hws[i] });
      acc += sl;
    }
    // smooth the corners a little
    for (let pass = 0; pass < 3; pass++) for (let i = 1; i + 1 < R.length; i++) { R[i].x = (R[i - 1].x + R[i].x * 2 + R[i + 1].x) / 4; R[i].z = (R[i - 1].z + R[i].z * 2 + R[i + 1].z) / 4; }
    this.route = R; this.L = (R.length - 1) * 2; this.edges = edges;
    this.start = { x: n0.x, z: n0.z };
    this.ok = true;
  }

  /** Position and heading at s metres along the route. */
  at(s) {
    const R = this.route, f = Math.max(0, Math.min(R.length - 1.001, s / 2)), i = Math.floor(f), u = f - i;
    const a = R[i], b = R[i + 1];
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, h: Math.atan2(b.x - a.x, b.z - a.z), hw: a.hw };
  }

  /** Where to stand to watch it come: on the kerb ~70 m ahead of the head, looking back down Weber. */
  viewFrom() {
    const p = this.at(Math.min(this.L - 10, this.head + 70));
    const lx = Math.cos(p.h), lz = -Math.sin(p.h);
    return { x: p.x + lx * (p.hw + 3.6), z: p.z + lz * (p.hw + 3.6), h: p.h + Math.PI - 0.35, hx: p.x, hz: p.z };
  }

  /** Set it off (ENTER at the marker). `start` is where: the junction of Weber and Frederick. */
  begin() {
    if (!this.ok || this.active) return false;
    const t0 = performance.now();
    const city = this.o.city, phone = this.o.phone;
    const g = new THREE.Group(); g.name = 'parade';
    this.group = g;
    this.o.scene.add(g);
    // close Weber: no traffic routes onto it, cars on it are taken off (out of sight), no kerbside parking
    this.closed = [];
    for (const ei of this.edges) { const e = city.edges[ei]; if (!e.noTraffic) { e.noTraffic = true; this.closed.push(ei); } }
    // ...and its kerbside slots held empty while it runs, or updateParked parks them again
    const T = this.o.traffic;
    this.held = [];
    if (T && T.kerbSlots && T.reservedSlots) for (const ei of this.edges) for (const k of T.kerbSlots(ei)) if (!T.reservedSlots.has(k.key)) { T.reservedSlots.add(k.key); this.held.push(k.key); }
    this._clearTraffic(true);
    // the crowd on the kerbs, three deep at most, cheering where the floats are
    const U = { uTime: { value: 0 }, uJump: { value: 0 }, uSway: { value: 0 }, uS0: { value: 0 }, uS1: { value: 0 } };
    this.U = U;
    const spots = [], step = phone ? 1.6 : 0.95;
    for (let s = 6; s < this.L; s += step) {
      const p = this.at(s), lx = Math.cos(p.h), lz = -Math.sin(p.h);
      for (const sd of [-1, 1]) {
        const rows = 1 + Math.floor(Math.random() * (phone ? 2 : 3));
        for (let r = 0; r < rows; r++) {
          const off = p.hw + 1.0 + r * 0.75 + Math.random() * 0.3, j = (Math.random() - 0.5) * step * 0.6;
          const x = p.x + lx * off * sd + Math.sin(p.h) * j, z = p.z + lz * off * sd + Math.cos(p.h) * j;
          if (city.onRoad(x, z, 0.2) || boxAt(city, x, z, 0.3)) continue;
          spots.push([x, city.groundAt(x, z, null), z, p.h + (sd > 0 ? -Math.PI / 2 : Math.PI / 2) + (Math.random() - 0.5) * 0.8, s]);
        }
      }
    }
    const geo = personGeo(false);
    const N = spots.length, n0 = geo.attributes.position.count;
    // per-instance route position for the cheer: an instanced attribute
    const aS = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    geo.deleteAttribute('aS'); geo.setAttribute('aS', aS);
    void n0;
    const jackets = ['#c8102e', '#1d6fd0', '#2e5a2a', '#3a3a40', '#8a6a4a', '#f2f2ee', '#d8b040', '#5a2a5a', '#e87a20', '#2a4a6a', '#7a1a1a', '#4a6a8a'].map((h) => new THREE.Color(h));
    const crowd = new THREE.InstancedMesh(geo, crowdMat(U), N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    spots.forEach(([x, y, z, h, s], i) => { e.set(0, h, 0); q.setFromEuler(e); p.set(x, y, z); sc.set(1, 0.92 + Math.random() * 0.16, 1); m4.compose(p, q, sc); crowd.setMatrixAt(i, m4); crowd.setColorAt(i, jackets[Math.floor(Math.random() * jackets.length)]); aS.setX(i, s); });
    crowd.frustumCulled = false;
    g.add(crowd);
    // the column: floats, the band
    const A = labelAtlas([
      { key: 'hans', w: 512, h: 96, draw: (c, W, H) => { c.fillStyle = '#2e5a2a'; c.fillRect(0, 0, W, H); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, 'ONKEL HANS', W / 2, H / 2, W - 30, '900 62px Georgia, serif'); } },
      { key: 'kwo', w: 512, h: 96, draw: (c, W, H) => { c.fillStyle = '#1d4fa0'; c.fillRect(0, 0, W, H); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, 'K-W OKTOBERFEST', W / 2, H / 2, W - 30, '900 60px Helvetica, Arial, sans-serif'); } },
      { key: 'miss', w: 512, h: 96, draw: (c, W, H) => { c.fillStyle = '#c8102e'; c.fillRect(0, 0, W, H); c.fillStyle = '#ffd23a'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, 'MISS OKTOBERFEST', W / 2, H / 2, W - 30, 'italic 900 58px Georgia, serif'); } },
      { key: 'band', w: 512, h: 96, draw: (c, W, H) => { c.fillStyle = '#f2f2ee'; c.fillRect(0, 0, W, H); c.fillStyle = '#1d4fa0'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, 'KW OOM-PAH BAND', W / 2, H / 2, W - 30, '900 56px Helvetica, Arial, sans-serif'); } },
      { key: 'brez', w: 512, h: 96, draw: (c, W, H) => { c.fillStyle = '#7a4a1e'; c.fillRect(0, 0, W, H); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, 'WILLKOMMEN!', W / 2, H / 2, W - 30, '900 62px Georgia, serif'); } },
      { key: 'haus', w: 512, h: 96, draw: (c, W, H) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H); c.fillStyle = '#2e5a2a'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, 'GEMÜTLICHKEIT', W / 2, H / 2, W - 30, '900 60px Georgia, serif'); } },
      { key: 'rauten', w: 256, h: 64, draw: (c, W, H) => rauten(c, W, H, 8) },
    ]);
    const vmat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const lmat = new THREE.MeshLambertMaterial({ map: A.tex, side: THREE.DoubleSide });
    this.units = [];
    const float = (kind, gap) => {
      const B = new Builder(false), quads = [];
      // the truck under it, hidden by a skirt of Bavarian blue
      B.box(0, 0.25, 0, 2.5, 0.85, 7.2, 0, lin('#f2f2ee'));
      B.box(0, 0.08, 0, 2.52, 0.5, 7.22, 0, lin('#1d6fd0'));
      B.box(0, 0.2, 4.4, 2.3, 1.7, 1.8, 0, lin('#c8c8c8'));            // the cab ahead
      B.box(0, 1.2, 5.0, 2.0, 0.6, 0.06, 0, [0.15, 0.2, 0.25]);
      const side = (key, y) => { for (const sd of [-1, 1]) { const x = sd * 1.27; quads.push([[[x, y, sd > 0 ? 3.2 : -3.2], [x, y, sd > 0 ? -3.2 : 3.2], [x, y + 0.75, sd > 0 ? -3.2 : 3.2], [x, y + 0.75, sd > 0 ? 3.2 : -3.2]], A.uv[key]]); } };
      side('rauten', 0.15);
      if (kind === 'hans') { onkelHans(B, 0, 1.1, -0.6, 2.2, 0); side('hans', 1.1); }
      else if (kind === 'barrel') {
        // a giant beer barrel on its side, its hoops, a tap
        for (let k = 0; k < 9; k++) { const z = -2.4 + k * 0.6, r = 1.25 + Math.sin(k / 8 * Math.PI) * 0.2; B.tube([0, 1.1 + 1.35, z], [0, 1.1 + 1.35, z + 0.6], r, 14, k % 4 === 1 ? lin('#3a3a3a') : lin('#9a6a3a')); }
        B.prism(0, 1.1, 2.9, 0.05, 1.0, 6, lin('#d8b040'));
        side('kwo', 1.1);
      } else if (kind === 'miss') {
        // the throne under an arch of flowers, Miss Oktoberfest in a dirndl
        B.box(0, 1.1, -1.5, 1.2, 1.4, 1.0, 0, lin('#d8b040')); B.box(0, 2.5, -1.95, 1.2, 1.0, 0.15, 0, lin('#c8102e'));
        B.box(0, 1.6, -1.2, 0.6, 0.9, 0.6, 0, lin('#1d4fa0')); B.box(0, 2.5, -1.2, 0.4, 0.5, 0.3, 0, [0.95, 0.95, 0.95]); B.box(0, 3.0, -1.2, 0.22, 0.26, 0.22, 0, SKIN[0]); B.box(0, 3.26, -1.22, 0.25, 0.12, 0.25, 0, lin('#d8b040'));
        for (let k = 0; k <= 12; k++) { const a = k / 12 * Math.PI; B.spheroid(Math.cos(a) * 1.2, 1.1 + 0.2 + Math.sin(a) * 2.6, -2.2, 0.22, 6, 4, k % 3 ? lin('#e84a6a') : lin('#f2e84a')); }
        side('miss', 1.1);
      } else if (kind === 'brez') {
        // a giant pretzel standing up: a knot of tubes, salted
        const P = [];
        for (let k = 0; k <= 40; k++) { const t = k / 40 * Math.PI * 2; P.push([Math.sin(t) * 1.15 * (1 - 0.15 * Math.cos(t)), 1.1 + 1.9 + Math.cos(t) * 1.05 - Math.sin(t * 2) * 0.35]); }
        for (let k = 0; k < 40; k++) B.tube([P[k][0], P[k][1], 0], [P[k + 1][0], P[k + 1][1], 0], 0.26, 8, lin('#8a4a1a'));
        B.tube([-0.5, 2.1, 0.1], [0.5, 3.2, 0.1], 0.24, 8, lin('#7a3e14')); B.tube([0.5, 2.1, 0.12], [-0.5, 3.2, 0.12], 0.24, 8, lin('#7a3e14'));
        side('brez', 1.1);
      } else if (kind === 'haus') {
        // a Bavarian house front: white render, dark half-timbering, a balcony of geraniums
        B.box(0, 1.1, -0.5, 2.3, 2.6, 4.2, 0, lin('#f4f0e4'));
        for (const z of [-2.5, -1.2, 0.2, 1.5]) B.box(1.17, 1.1, z, 0.04, 2.6, 0.16, 0, lin('#3a2614'));
        B.box(1.17, 2.2, -0.5, 0.04, 0.16, 4.2, 0, lin('#3a2614'));
        for (const sd of [-1, 1]) B.quad([sd * 1.3, 3.7, -2.7], [sd * 1.3, 3.7, 1.7], [0, 4.9, 1.7], [0, 4.9, -2.7], [sd * 0.7, 0.7, 0], [0, 0, 0, 0, 0, 0, 0, 0], lin('#8a2a1a'));
        for (const sd of [-1, 1]) B.tri([0, 3.7, sd * 2.2 - 0.5], [1.2, 3.7, sd * 2.2 - 0.5], [0, 4.9, sd * 2.2 - 0.5], [0, 0, sd], lin('#f4f0e4'));
        B.box(1.35, 2.3, -0.5, 0.3, 0.3, 3.0, 0, lin('#c8202a'));
        side('haus', 1.1);
      }
      const m = new THREE.Group();
      m.add(new THREE.Mesh(B.build(), vmat));
      m.add(quadsMesh(quads, lmat));
      g.add(m);
      this.units.push({ kind, gap, m });
    };
    // the band: 4 x 4 marchers in white and blue, brass, a big drum
    const band = () => {
      const B = new Builder(false);
      B.box(0, 0, 0, 0.36, 0.86, 0.22, 0, lin('#1a1a2a')); B.box(0, 0.84, 0, 0.44, 0.6, 0.26, 0, lin('#f4f4f4'));
      B.box(0, 0.86, 0, 0.46, 0.36, 0.27, 0, lin('#1d4fa0'));
      B.box(0, 1.44, 0.01, 0.19, 0.24, 0.21, 0, SKIN[1]); B.prism(0, 1.66, 0, 0.17, 0.2, 8, lin('#1d4fa0')); B.prism(0, 1.86, 0, 0.05, 0.12, 6, [1, 1, 1]);
      B.tube([0.12, 1.15, 0.3], [0.12, 1.25, 0.75], 0.04, 6, lin('#e8c040')); B.cone(0.12, 1.25, 0.75, 0.09, 0.1, 8, lin('#e8c040'));
      const geo2 = B.build();
      const im = new THREE.InstancedMesh(geo2, vmat, 16);
      im.frustumCulled = false;
      g.add(im);
      const lead = new THREE.Group();
      const LB = new Builder(false);
      LB.box(0, 0, 0, 2.2, 0.06, 0.06, 0, [0.3, 0.3, 0.3]);
      lead.add(new THREE.Mesh(LB.build(), vmat));
      lead.add(quadsMesh([[[[-1.6, 1.0, 0], [1.6, 1.0, 0], [1.6, 1.6, 0], [-1.6, 1.6, 0]], A.uv.band]], lmat));
      g.add(lead);
      this.units.push({ kind: 'band', gap: 18, im, lead });
    };
    float('hans', 0); band(); float('barrel', 26); float('miss', 24); float('brez', 24); float('haus', 24);
    let off = 0;
    for (const u of this.units) { off += u.gap; u.off = off; }
    this.colLen = off;
    this.head = off + 4;                    // the whole column on Weber from the start
    this.t = 0;
    this.active = true;
    this.clearT = 1;
    const a = this.o.audio;
    if (!this.bandSnd) this.bandSnd = new Band(a && a.ctx, a && a.master);
    this.bandSnd.start();
    this.stats = { crowd: N, units: this.units.length, ms: Math.round(performance.now() - t0) };
    this._place();
    const hud = this.o.hud && this.o.hud.hud;
    if (hud) hud.showToast('The Thanksgiving Day Parade is setting off up Weber St — Weber is closed to traffic', 4200);
    return true;
  }

  _clearTraffic(all) {
    const T = this.o.traffic, cam = this.o.camera, closed = new Set(this.closed);
    if (!T) return;
    for (const v of T.cars.slice()) {
      if (v.mode !== 'traffic' && v.mode !== 'parked') continue;
      if (!closed.has(v.edge) && !(v.mode === 'parked' && this._onRoute(v.x, v.z))) continue;
      if (!all && cam && Math.hypot(v.x - cam.position.x, v.z - cam.position.z) < 60) continue;
      T.remove(v);
    }
  }
  _onRoute(x, z) {
    for (const ei of this.closed) {
      const e = this.o.city.edges[ei], a = this.o.city.nodes[e.a];
      const t = Math.max(0, Math.min(e.len, (x - a.x) * e.dx + (z - a.z) * e.dz));
      if (Math.hypot(a.x + e.dx * t - x, a.z + e.dz * t - z) < e.hw + 1) return true;
    }
    return false;
  }

  _place() {
    const city = this.o.city, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (const u of this.units) {
      const s = this.head - u.off;
      const at = this.at(Math.max(0, s));
      const y = city.groundAt(at.x, at.z, null);
      if (u.m) { u.m.position.set(at.x, y, at.z); u.m.rotation.y = at.h; u.m.visible = s > -2 && s < this.L; }
      if (u.im) {
        // four ranks of four, stepping in time
        for (let i = 0; i < 16; i++) {
          const rank = Math.floor(i / 4), file = i % 4, ss = s - 3 - rank * 1.6;
          const b = this.at(Math.max(0, ss)), lx = Math.cos(b.h), lz = -Math.sin(b.h), lat = (file - 1.5) * 1.3;
          const bx = b.x + lx * lat, bz = b.z + lz * lat, step = Math.abs(Math.sin(this.t * 5.6 + (i % 2) * Math.PI)) * 0.06;
          e.set(0, b.h, 0); q.setFromEuler(e); p.set(bx, city.groundAt(bx, bz, null) + step, bz);
          m4.compose(p, q, sc); u.im.setMatrixAt(i, m4);
        }
        u.im.instanceMatrix.needsUpdate = true;
        const lb = this.at(Math.max(0, s));
        u.lead.position.set(lb.x, city.groundAt(lb.x, lb.z, null), lb.z); u.lead.rotation.y = lb.h;
      }
    }
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    this.head += PARADE_V * dt * this.speedUp;
    this._place();
    this.U.uTime.value = this.t;
    this.U.uS0.value = this.head - this.colLen - 12; this.U.uS1.value = this.head + 10;
    // the band's music by distance from the camera to the band
    const cam = this.o.camera, b = this.units.find((u) => u.kind === 'band');
    if (cam && b && this.bandSnd) {
      const bp = this.at(Math.max(0, this.head - b.off));
      const d = Math.hypot(cam.position.x - bp.x, cam.position.z - bp.z);
      this.bandSnd.level(Math.max(0, 1 - d / 220) ** 2 * 0.5);
      this.bandSnd.update();
    }
    this.clearT -= dt;
    if (this.clearT <= 0) { this.clearT = 1; this._clearTraffic(false); }
    if (this.head - this.colLen > this.L) this.end();
  }

  end() {
    if (!this.active) return;
    this.active = false;
    if (this.group) { this.o.scene.remove(this.group); disposeTree(this.group); this.group = null; }
    for (const ei of this.closed || []) this.o.city.edges[ei].noTraffic = false;
    const T = this.o.traffic;
    if (T && T.reservedSlots) for (const k of this.held || []) T.reservedSlots.delete(k);
    this.held = [];
    this.closed = [];
    this.units = [];
    if (this.bandSnd) this.bandSnd.stop();
    const hud = this.o.hud && this.o.hud.hud;
    if (hud) hud.showToast('The parade has gone by — Weber St is open again', 3000);
  }

  get statsNow() { return this.stats; }
}
