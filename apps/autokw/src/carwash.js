// Auto KW: the drive-through tunnel car wash, at three REAL car washes whose
// OSM building is a long, narrow tunnel (amenity=car_wash in
// tools/data/kw/raw_pois.json):
//
//   - Valet Car Wash, 1520 Victoria St N, Kitchener (39 x 9 m)
//   - GTO Auto Spa, 567 King St N, Waterloo (44 x 11 m)
//   - the Petro-Canada car wash on Weber St E, Kitchener (29 x 10 m)
//
// The real building's box is flattened at boot (`kw.skip`, h 0: world.js draws
// nothing and nothing collides with it) and the tunnel is drawn in its place,
// along its long axis: two thick side blocks with the equipment rooms' windows,
// a roof, a ceiling, a coloured fascia with the wash's real name over each
// mouth, and inside the coloured arches (pre-soak, three foam curtains, the
// brush gantries, rinse, the blower) over a conveyor. The ENTRANCE is the mouth
// nearer a street (both mouths must be clear to drive through).
//
//   - DRIVE IN: stop a road car on the conveyor at the entrance (its centre
//     within ENTRY of the mouth, lined up with the tunnel). A toast asks $8:
//     ENTER pays at once, or just wait PROMPT_T s. Refused (a toast, nothing
//     else): a job or story chapter running (main.js jobsBusy), an aircraft, a
//     boat, a bike / ATV / buggy, a bus or anything too long, wide or TALL for
//     the tunnel (spec.roof > MAX_ROOF: a U-Haul's box), a wreck, too poor.
//     Wanted? GTA has no rule against it: you are washed, the stars stay.
//   - THE RIDE: the conveyor takes over -- `player.autoDrive` gives the car a
//     neutral input (the controls are ignored) and every frame the car is set
//     on the tunnel's axis at the conveyor's position (a trapezoid profile at
//     SPEED, ~20 s); ENTER is swallowed ("sit tight"). A camera rig of its own
//     (`v.camRig`, as link.js's in a bore) sits low behind the car inside the
//     tunnel, under the ceiling. In order: the pre-soak arch's spray, foam in
//     pink, blue and yellow (blobs that land where the curtain is over the car
//     and slide off the roof and down the sides), the wrap-around brushes that
//     swing in against the sides and the top brush that rides the roof line,
//     the rinse (it washes the foam off where it passes), the blower (air roar,
//     the last foam blown away), and the green EXIT light.
//   - THE RESULT, as the car leaves: `steamT` cleared, health +5 (capped), the
//     paint's roughness pulled down for a gloss that fades over GLOSS_T s (a
//     uniform value on THIS car's bodyMat: no new program), "Showroom shine".
//     1 in 20 (or `rig = 'gag'`): you left the window down.
//   - ON FOOT: walk into the tunnel and you are soaked: "You walk through the
//     car wash. You are now very clean. +$0".
//
// NOTHING is held (`game.hold` unused): the world runs. All sound is
// synthesised here (WebAudio noise through filters on the world bus).
//
// Phone cost: nothing until BUILD_R; then 3 draws (the tunnel as one
// vertex-coloured mesh, the two name signs as one canvas, the two lights),
// shown within SHOW_R; + 1 draw only during a ride (the brushes and the foam,
// ONE dynamic mesh). Per frame: a distance check per site.
//
// Harness: __dbg.carWash (`sites`, `ride`, `refusal(v)`, `start(q, v)`,
// `rig`, `local(q, x, z)`, `W(q, lx, lz)`), probe tools/kw/washprobe.mjs.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { boxAt } from './kw.js';
import { clamp, formatMoney } from './util.js';

const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
export const PRICE = 8;
const BUILD_R = 520, SHOW_R = 500;
const IW = 2.45;           // the tunnel's inner half-width
const CLEAR = 3.9;         // the ceiling over the floor
const TOP = 5.2;           // the roof
export const MAX_ROOF = 2.8, MAX_LEN = 6.45;
const SPEED = 2.0;         // the conveyor, m/s (a brisk walk)
const ACC_T = 1.0;         // its start and stop ramps, s
const PROMPT_T = 1.5;      // waiting this long pays
const DWELL = 0.35;        // stopped this long at the mouth: the prompt
const ENTRY = [-2.6, 3.0]; // the car's centre between these (lz) at the mouth
const GLOSS_T = 30;
// the stations, as fractions of the tunnel's length
const ST = { soak: 0.12, foam: [0.25, 0.32, 0.39], brush: 0.52, top: 0.62, rinse: 0.74, blow: 0.87 };
const FOAM_COL = [[1.0, 0.42, 0.66], [0.36, 0.62, 1.0], [1.0, 0.86, 0.22]];   // pink, blue, yellow (linear-ish)

// The real places (world metres: the POI of each amenity=car_wash, tools/kw/proj.py).
export const SITES = [
  { id: 'valet', name: 'Valet Car Wash', title: 'VALET CAR WASH', sub: 'SOFT-TOUCH TUNNEL', street: 'Victoria Street North', x: 2936.3, z: -2372.1, brand: '#1d5fb4', band: 0x1d5fb4, trim: 0xf2c014 },
  { id: 'gto', name: 'GTO Auto Spa', title: 'GTO AUTO SPA', sub: 'TUNNEL WASH', street: 'King Street North', x: -4763.1, z: -5349.7, brand: '#b8161e', band: 0xb8161e, trim: 0x202024 },
  { id: 'petro', name: 'Petro-Canada Car Wash', title: 'PETRO-CANADA', sub: 'CAR WASH', street: 'Weber Street East', x: 2463.2, z: 2094.3, brand: '#d71920', band: 0xd71920, trim: 0xf2f2f2 },
];

const ZERO_UV = [0, 0, 0, 0, 0, 0, 0, 0];
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wrapA = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

let prepped = [];

/**
 * Before anything is meshed (main.js, beside prepFun): find each wash's building box, check it is a
 * tunnel's shape, and flatten it (drawn here instead). Returns how many.
 */
export function prepWash(city) {
  prepped = [];
  for (const g of SITES) {
    const b = boxAt(city, g.x, g.z, 1.5);
    if (!b) continue;
    const L = Math.max(b.w, b.d), Wd = Math.min(b.w, b.d);
    if (L < 22 || L > 60 || Wd < 6.5 || Wd > 14 || L / Wd < 2.2) continue;
    const ax = b.w >= b.d ? Math.cos(b.rot) : -Math.sin(b.rot), az = b.w >= b.d ? Math.sin(b.rot) : Math.cos(b.rot);
    prepped.push({ g, box: b, cx: b.x, cz: b.z, L, Wd, ax, az, h0: b.h });
    b.h = 0;
    if (!b.kw) b.kw = {};
    b.kw.skip = true;   // world.js and the signs draw nothing for it; nothing collides with it
  }
  return { sites: prepped.length };
}

/**
 * At boot, after the landmarks (main.js, beside placeYard): which mouth is the entrance (the one
 * nearer a street; both must be clear for 8 m), the floor heights, and the clear circles that keep
 * trees and parked cars out of the tunnel and off its aprons. Returns the sites.
 */
export function placeWashes(city, waterAt) {
  const out = [];
  for (const p of prepped) {
    const wet = (x, z) => { if (G.isWater(x, z)) return true; const w = waterAt ? waterAt(x, z) : null; return w !== null && w > G.terrainHeight(x, z) + 0.05; };
    const others = city.buildingsNear(p.cx, p.cz, 90).filter((b) => b !== p.box && b.h > 0.5);
    const inB = (x, z, pad) => {
      for (const b of others) {
        const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
        if (Math.abs(dx * c - dz * s) < b.w / 2 + pad && Math.abs(dx * s + dz * c) < b.d / 2 + pad) return true;
      }
      return false;
    };
    const roadD = (x, z) => {
      let best = 1e9;
      for (const ei of city.edgesNear(x, z, 220)) {
        const e = city.edges[ei];
        if (e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp') continue;
        const a = city.nodes[e.a], t = clamp((x - a.x) * e.dx + (z - a.z) * e.dz, 0, e.len);
        best = Math.min(best, Math.hypot(x - a.x - e.dx * t, z - a.z - e.dz * t) - e.hw);
      }
      return best;
    };
    // a mouth's apron: 8 m out, the conveyor's width and a bit
    const apronBad = (mx, mz, ox, oz) => {
      let bad = 0;
      for (let d = 0.6; d <= 8; d += 1.2) for (const k of [-2.2, -1.1, 0, 1.1, 2.2]) {
        const x = mx + ox * d - oz * k, z = mz + oz * d + ox * k;
        const y = G.terrainHeight(x, z);
        if (inB(x, z, 0.3) || wet(x, z) || (city.landmarkHit && city.landmarkHit(x, z, 0.4, y + 1, true)) || (city.barrierHit && city.barrierHit(x, z, 0.4, y + 1))) bad++;
      }
      return bad;
    };
    const e0 = [p.cx - p.ax * p.L / 2, p.cz - p.az * p.L / 2], e1 = [p.cx + p.ax * p.L / 2, p.cz + p.az * p.L / 2];
    const b0 = apronBad(e0[0], e0[1], -p.ax, -p.az), b1 = apronBad(e1[0], e1[1], p.ax, p.az);
    let flip = roadD(e1[0], e1[1]) < roadD(e0[0], e0[1]);   // enter at the mouth nearer a street
    if (!flip && b0 > 0 && b1 === 0) flip = true;
    else if (flip && b1 > 0 && b0 === 0) flip = false;
    const ax = flip ? -p.ax : p.ax, az = flip ? -p.az : p.az;
    const [ox, oz] = flip ? e1 : e0;
    const rot = Math.atan2(-ax, az);
    const s = { g: p.g, L: p.L, Wd: p.Wd, ox, oz, ax, az, rot, cr: Math.cos(rot), sr: Math.sin(rot), h0: p.h0,
      blocked: flip ? [b1, b0] : [b0, b1] };
    // the floor: the ground along the axis (the car rides the terrain; the floor is draped on it)
    let lo = Infinity, hi = -Infinity;
    for (let lz = -6; lz <= p.L + 6; lz += 2) for (const lx of [-p.Wd / 2, 0, p.Wd / 2]) {
      const y = G.terrainHeight(ox + lx * s.cr - lz * s.sr, oz + lx * s.sr + lz * s.cr);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    s.lo = lo; s.hi = hi;
    if (!city.clearCircles) city.clearCircles = [];
    for (let lz = -8; lz <= p.L + 8; lz += 4) city.clearCircles.push([ox + ax * lz, oz + az * lz, 4.5]);
    out.push(s);
  }
  return out;
}

// --- the sign: one canvas, the entrance's on its top half, the exit's below -------------

function drawSign(g, site) {
  const W = 1024, H = 256, h = H / 2;
  const S = site.g;
  for (const [y0, exit] of [[0, false], [h, true]]) {
    g.fillStyle = S.brand; g.fillRect(0, y0, W, h);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, y0 + h - 16, W, 6);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (!exit) {
      g.fillStyle = '#ffffff'; g.font = '900 66px system-ui, sans-serif';
      g.fillText(S.title, W / 2, y0 + 50, W - 60);
      g.font = '700 28px system-ui, sans-serif'; g.fillStyle = '#ffe9a8';
      g.fillText(`${S.sub}  ·  $${PRICE}  ·  DRIVE ON  ▸`, W / 2, y0 + 100, W - 80);
    } else {
      g.fillStyle = '#ffffff'; g.font = '900 72px system-ui, sans-serif';
      g.fillText('EXIT', W / 2, y0 + 50);
      g.font = '700 28px system-ui, sans-serif'; g.fillStyle = '#ffe9a8';
      g.fillText(`THANK YOU FOR CHOOSING ${S.title}`, W / 2, y0 + 100, W - 80);
    }
    // bubbles in the corners
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (const [bx, by, r] of [[40, 30, 14], [70, 70, 9], [30, 96, 7], [W - 44, 34, 13], [W - 76, 76, 8], [W - 30, 98, 6]]) { g.beginPath(); g.arc(bx, y0 + by, r, 0, Math.PI * 2); g.fill(); }
  }
}

// --- the ride's mesh: three brushes and the foam, ONE dynamic geometry ------------------

const SEG = 20, RINGS = 4, NBR = 3, NFOAM = 180, FOAM_N = 52;
const BR_R = 0.5, BR_H = 2.1;          // a brush's radius (to the bristles' tips) and a side brush's length
// a foam blob: an icosahedron (12 vertices, smooth normals) squashed a little
const ICO = (() => { const t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  return v.map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; }); })();
const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
const NV_B = ICO.length;

class RideMesh {
  constructor(mat) {
    // a brush: SEG cloth strips round the drum, each its own two vertices a ring (a crisp colour, flat-shaded)
    const nvB = NBR * SEG * RINGS * 2, nv = nvB + NFOAM * NV_B;
    this.nvB = nvB;
    const idx = [];
    const bv = (b, j, i, e) => ((b * RINGS + j) * SEG + i) * 2 + e;
    for (let b = 0; b < NBR; b++) for (let j = 0; j < RINGS - 1; j++) for (let i = 0; i < SEG; i++) {
      const a = bv(b, j, i, 0), c = bv(b, j, i, 1), d = bv(b, j + 1, i, 0), e = bv(b, j + 1, i, 1);
      idx.push(a, d, c, c, d, e, a, c, d, c, e, d);   // both faces: a strip is cloth, seen from either side
    }
    for (let f = 0; f < NFOAM; f++) for (const [a, b, c] of ICO_F) idx.push(nvB + f * NV_B + a, nvB + f * NV_B + b, nvB + f * NV_B + c);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.nor = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos); geo.setAttribute('normal', this.nor); geo.setAttribute('color', this.col);
    geo.setIndex(idx);
    // the brushes' colours: cloth strips, blue / red / yellow round the drum
    const C = this.col.array, cols = [lin(0x2a6fd6), lin(0xd8302c), lin(0x2a6fd6), lin(0xf2c419)];
    for (let b = 0; b < NBR; b++) for (let j = 0; j < RINGS; j++) for (let i = 0; i < SEG; i++) for (let e = 0; e < 2; e++) {
      const k = bv(b, j, i, e) * 3, c = cols[i % 4], dim = e ? 1 : 0.62;
      C[k] = c[0] * dim; C[k + 1] = c[1] * dim; C[k + 2] = c[2] * dim;
    }
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;   // it follows the car about a 45 m tunnel: one sphere would do, but it moves
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    // the foam pool, in the CAR's frame: lx across (+ the car's right), y up from v.y, lz along
    this.f = [];
    for (let i = 0; i < NFOAM; i++) this.f.push({ on: 0, lx: 0, y: 0, lz: 0, r: 0.2, s: 0, st: 0, vx: 0, ci: 0, k: 0 });
    this.free = NFOAM;
  }

  /** Brush b: a drum about an axis. c = [x, y, z] its centre (world), ax its axis (world unit), rotation phi. */
  brush(b, cx, cy, cz, ax, ay, az, len, phi, t) {
    // two vectors across the axis
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(ay) > 0.9) { ux = 1; uy = 0; uz = 0; }
    // v = ax x u, u = v x ax
    let vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    let l = Math.hypot(vx, vy, vz); vx /= l; vy /= l; vz /= l;
    ux = vy * az - vz * ay; uy = vz * ax - vx * az; uz = vx * ay - vy * ax;
    const P = this.pos.array, N = this.nor.array;
    for (let j = 0; j < RINGS; j++) {
      const h = (j / (RINGS - 1) - 0.5) * len;
      for (let i = 0; i < SEG; i++) {
        // a strip: from the drum's core (0.55 R) at its root edge out to its tip (R), a sawtooth round the drum,
        // flung out and wobbling as it spins
        const fl = 1 + 0.08 * Math.sin(t * 6 + j * 1.7 + i * 0.9);
        const am = phi + ((i + 0.5) / SEG) * Math.PI * 2, nmx = ux * Math.cos(am) + vx * Math.sin(am), nmy = uy * Math.cos(am) + vy * Math.sin(am), nmz = uz * Math.cos(am) + vz * Math.sin(am);
        for (let e = 0; e < 2; e++) {
          const a = phi + ((i + e) / SEG) * Math.PI * 2, r = BR_R * (e ? fl : 0.55);
          const ca = Math.cos(a), sa = Math.sin(a);
          const nx = ux * ca + vx * sa, ny = uy * ca + vy * sa, nz = uz * ca + vz * sa;
          const k = (((b * RINGS + j) * SEG + i) * 2 + e) * 3;
          P[k] = cx + ax * h + nx * r; P[k + 1] = cy + ay * h + ny * r; P[k + 2] = cz + az * h + nz * r;
          N[k] = nmx; N[k + 1] = nmy; N[k + 2] = nmz;
        }
      }
    }
  }

  /** A foam blob arrives on the car (car-frame lx, top y, lz) in colour ci. */
  spawn(lx, y, lz, ci) {
    if (this.free <= 0) return;
    let f = null;
    for (const q of this.f) if (!q.on) { f = q; break; }
    if (!f) return;
    this.free--;
    f.on = 1; f.lx = lx; f.y = y; f.lz = lz; f.ci = ci; f.s = 0.25; f.st = 1; f.k = 0;
    f.r = 0.16 + Math.random() * 0.18; f.vx = (lx >= 0 ? 1 : -1) * (0.08 + Math.random() * 0.16);
    const C = this.col.array, c = FOAM_COL[ci], i0 = this.nvB + this.f.indexOf(f) * NV_B;
    const w = 0.85 + Math.random() * 0.15;
    for (let k = 0; k < NV_B; k++) { C[(i0 + k) * 3] = c[0] * w; C[(i0 + k) * 3 + 1] = c[1] * w; C[(i0 + k) * 3 + 2] = c[2] * w; }
    this.col.needsUpdate = true;
  }

  /** Slide the foam (off the roof, down the sides), shrink what is washed off, and write it round car v. */
  foam(dt, v, hw, sill) {
    const P = this.pos.array, N = this.nor.array;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading), rx = -fz, rz = fx;   // forward, and the car's right
    let n = 0;
    for (let i = 0; i < NFOAM; i++) {
      const f = this.f[i], i0 = (this.nvB + i * NV_B) * 3;
      if (f.on) {
        if (f.st === 3) { f.s -= dt * 2.6; if (f.s <= 0) { f.on = 0; f.s = 0; this.free++; } }
        else {
          f.s = Math.min(1, f.s + dt * 3);
          if (f.st === 1) {   // on top: creeping to the edge
            f.lx += f.vx * dt;
            if (Math.abs(f.lx) > hw - 0.08) { f.st = 2; f.lx = Math.sign(f.lx) * (hw + 0.03); }
          } else if (f.st === 2 && f.y > sill + 0.18) f.y -= dt * (0.22 + f.r);   // down the side
        }
      }
      const r = f.on ? f.r * f.s : 0;
      const wx = v.x + rx * f.lx + fx * f.lz, wy = v.y + f.y, wz = v.z + rz * f.lx + fz * f.lz;
      for (let k = 0; k < NV_B; k++) {
        const o = ICO[k], q = i0 + k * 3;
        P[q] = wx + o[0] * r; P[q + 1] = wy + o[1] * r * 0.72; P[q + 2] = wz + o[2] * r;
        N[q] = o[0]; N[q + 1] = o[1]; N[q + 2] = o[2];
      }
      if (f.on) n++;
    }
    this.pos.needsUpdate = true; this.nor.needsUpdate = true;
    return n;
  }

  dispose() { this.mesh.geometry.dispose(); }
}

// --- the sound: one noise graph per ride, on the world bus ------------------------------------

class WashSound {
  constructor(a) {
    const c = a.ctx;
    this.a = a; this.c = c;
    const src = (buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 1.5); return s; };
    const filt = (type, f, q) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const gain = (v) => { const g = c.createGain(); g.gain.value = v; return g; };
    this.out = gain(0); this.out.connect(a.worldBus || a.sfxBus);
    this.white = src(a.noise); this.pink = src(a.pinkNoise);
    // spray: a high hiss; foam: a softer, lower one; brushes: a low swish pulsed by the drums;
    // the blower: a roar plus its air hiss and a fan whine
    this.gS = gain(0); this.white.connect(filt('bandpass', 3400, 0.7)).connect(this.gS).connect(this.out);
    this.gF = gain(0); this.pink.connect(filt('bandpass', 1100, 1.1)).connect(this.gF).connect(this.out);
    this.gB = gain(0); this.pink.connect(filt('lowpass', 520, 0.8)).connect(this.gB).connect(this.out);
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 3.2; this.lfoG = gain(0);
    this.lfo.connect(this.lfoG).connect(this.gB.gain); this.lfo.start();
    this.gR = gain(0); this.pink.connect(filt('lowpass', 380, 0.7)).connect(this.gR).connect(this.out);
    this.white.connect(filt('bandpass', 1500, 0.5)).connect(this.gR);
    this.whine = c.createOscillator(); this.whine.type = 'sawtooth'; this.whine.frequency.value = 160; this.gW = gain(0);
    this.whine.connect(filt('lowpass', 900, 1)).connect(this.gW).connect(this.out); this.whine.start();
    // the conveyor's hum
    this.hum = c.createOscillator(); this.hum.frequency.value = 52; this.gH = gain(0.05);
    this.hum.connect(this.gH).connect(this.out); this.hum.start();
    this.last = { s: -1, f: -1, b: -1, r: -1 };
    const t = c.currentTime;
    this.out.gain.setValueAtTime(0, t); this.out.gain.setTargetAtTime(0.9, t, 0.3);
  }

  set(spray, foam, brush, roar) {
    const t = this.c.currentTime, L = this.last;
    const put = (key, param, v, tc = 0.12) => { if (Math.abs(L[key] - v) > 0.02) { L[key] = v; param.setTargetAtTime(v, t, tc); } };
    put('s', this.gS.gain, spray * 0.32);
    put('f', this.gF.gain, foam * 0.22);
    if (Math.abs(L.b - brush) > 0.02) { L.b = brush; this.gB.gain.setTargetAtTime(brush * 0.5, t, 0.15); this.lfoG.gain.setTargetAtTime(brush * 0.4, t, 0.15); }
    if (Math.abs(L.r - roar) > 0.02) {
      L.r = roar;
      this.gR.gain.setTargetAtTime(roar * 0.75, t, 0.35); this.gW.gain.setTargetAtTime(roar * 0.035, t, 0.4);
      this.whine.frequency.setTargetAtTime(160 + roar * 90, t, 0.6);
    }
  }

  stop() {
    const t = this.c.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.15);
    for (const n of [this.white, this.pink, this.lfo, this.whine, this.hum]) { try { n.stop(t + 0.8); } catch (e) { /* stopped */ } }
    setTimeout(() => { try { this.out.disconnect(); } catch (e) { /* gone */ } }, 1000);
  }
}

/** A two-note chime (the EXIT light), and a short spray burst (on foot). */
function chime(a) {
  if (!a || !a.ready || !a.ctx) return;
  const c = a.ctx, t = c.currentTime;
  for (const [f, at] of [[880, 0], [1318.5, 0.16]]) {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = f; g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(0.16, t + at + 0.01); g.gain.setTargetAtTime(0, t + at + 0.02, 0.25);
    o.connect(g).connect(a.sfxBus); o.start(t + at); o.stop(t + at + 1.6);
  }
}
function sprayBurst(a, dur = 1.8) {
  if (!a || !a.ready || !a.ctx || !a.noise) return;
  const c = a.ctx, t = c.currentTime;
  const s = c.createBufferSource(); s.buffer = a.noise; s.loop = true;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 0.7;
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.28, t + 0.08); g.gain.setTargetAtTime(0, t + dur - 0.4, 0.2);
  s.connect(f).connect(g).connect(a.sfxBus); s.start(t); s.stop(t + dur + 0.6);
}

// --- the washes --------------------------------------------------------------------------------

export class CarWash {
  /** o: { scene, city, game, hud, audio, fx, player, busy: () => bool, sites: placeWashes(...) } */
  constructor(o) {
    this.scene = o.scene; this.city = o.city; this.game = o.game; this.hud = o.hud; this.audio = o.audio; this.fx = o.fx;
    this.busy = o.busy || (() => false);
    this.sites = [];
    this.ride = null;
    this.rig = null;          // harness: 'gag' forces the window-down gag, 'clean' forbids it
    this.gloss = [];
    this.rideMesh = null;
    this.washes = 0;
    for (const s of o.sites || []) {
      const W = (lx, lz) => [s.ox + lx * s.cr - lz * s.sr, s.oz + lx * s.sr + lz * s.cr];
      // the side blocks are solid (the mouths and the tunnel are open)
      const OW = Math.max(s.Wd / 2, IW + 0.5);
      const solids = [];
      for (const sx of [-1, 1]) {
        const [x, z] = W(sx * (IW + OW) / 2, s.L / 2);
        solids.push({ x, z, hw: (OW - IW) / 2, hd: s.L / 2, rot: s.rot, y0: s.lo - 1, y1: s.hi + TOP });
      }
      if (this.city.addLandmarkSolids) this.city.addLandmarkSolids(solids);
      const [mx, mz] = W(0, s.L / 2);
      const st = {};
      for (const k in ST) st[k] = Array.isArray(ST[k]) ? ST[k].map((f) => f * s.L) : ST[k] * s.L;
      this.sites.push({ g: s.g, s, W, mx, mz, OW, st, built: false, grp: null, lights: null, light: '', dwell: 0, told: '', toldV: null,
        prompt: null, footIn: false, footOut: 99 });
    }
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 });
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this._neutral = () => NEUTRAL;
  }

  places() {
    return this.sites.map((q) => ({
      x: q.mx, z: q.mz, kind: 'wash', label: true, name: `${q.g.name} (car wash)`, near: false,
      hello: () => `${q.g.name} — a drive-through tunnel wash, $${PRICE}. Stop on the conveyor at the entrance and let it take you through`,
    }));
  }

  W(q, lx, lz) { return q.W(lx, lz); }
  local(q, x, z) {
    const s = q.s, dx = x - s.ox, dz = z - s.oz;
    return { lx: dx * s.cr + dz * s.sr, lz: -dx * s.sr + dz * s.cr };
  }

  // --- the building, made when you come near -------------------------------------------------

  build(q) {
    q.built = true;
    const s = q.s, L = s.L, OW = q.OW;
    const B = new Builder(false);
    const W = q.W;
    const gy = (lx, lz) => { const [x, z] = W(lx, lz); return G.terrainHeight(x, z); };
    // the highest / lowest ground under a footprint
    const under = (lx, lz, w, d) => { let hi = -Infinity, lo = Infinity; for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) { const y = gy(lx + (i - 1) * w / 2, lz + (j - 1) * d / 2); hi = Math.max(hi, y); lo = Math.min(lo, y); } return { hi, lo }; };
    // a box standing on its ground (from below the lowest, so a slope never shows a gap), with its underside
    const bx = (lx, lz, w, d, y0, h, col, base = null) => {
      const g = base || under(lx, lz, w, d);
      const [x, z] = W(lx, lz);
      B.box(x, g.hi + y0, z, w, h, d, s.rot, col);
      if (y0 > 0.3) {   // seen from below (beams, ducts): close it
        const c = (a, b) => { const [px, pz] = W(lx + a * w / 2, lz + b * d / 2); return [px, g.hi + y0, pz]; };
        B.quad(c(-1, -1), c(1, -1), c(1, 1), c(-1, 1), [0, -1, 0], ZERO_UV, col);
      }
    };
    const drape = (lx0, lx1, lz0, lz1, lift, col, cell = 2.5) => {
      const nx = Math.max(1, Math.ceil((lx1 - lx0) / cell)), nz = Math.max(1, Math.ceil((lz1 - lz0) / cell));
      const pt = (i, j) => { const lx = lx0 + (lx1 - lx0) * i / nx, lz = lz0 + (lz1 - lz0) * j / nz; const [x, z] = W(lx, lz); return [x, G.terrainHeight(x, z) + lift, z]; };
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) B.quad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1), [0, 1, 0], ZERO_UV, col);
    };
    // a post from the ground under it (the floor follows the terrain) up to `top` over the site's floor
    const post = (lx, lz, w, d, top, col) => { const u = under(lx, lz, w, d); bx(lx, lz, w, d, 0, s.hi + top - u.lo, col, { hi: u.lo, lo: u.lo }); };
    const wall = lin(0xe9e6df), wallDk = lin(0xcfccc4), band = lin(s.g.band), trim = lin(s.g.trim), conc = [0.50, 0.50, 0.49], dark = [0.06, 0.06, 0.07];
    const glass = [0.10, 0.16, 0.22], steel = [0.55, 0.57, 0.6], yellow = lin(0xf2c014);
    const site = { hi: s.hi, lo: s.lo };   // the whole building stands on the site's highest ground, footed to its lowest
    // the floor: concrete through the tunnel and out over both aprons; the conveyor's channel, its rails and rollers
    drape(-IW, IW, -7, L + 7, 0.05, conc, 2.4);
    drape(-1.1, -0.6, -3.2, L + 1.5, 0.08, dark, 2.0);
    for (const x0 of [-1.18, -0.56]) drape(x0, x0 + 0.06, -3.2, L + 1.5, 0.11, yellow, 3);
    for (let lz = -3; lz < L + 1.4; lz += 1.6) drape(-1.06, -0.64, lz, lz + 0.12, 0.1, steel, 1);
    // chevrons on the entrance apron, pointing in
    for (let i = 0; i < 3; i++) {
      const z0 = -6.2 + i * 1.5;
      for (const sx of [-1, 1]) {
        const a = (lx, lz) => { const [x, z] = W(lx, lz); return [x, G.terrainHeight(x, z) + 0.12, z]; };
        B.quad(a(sx * 1.6, z0), a(sx * 1.6, z0 + 0.35), a(0, z0 + 1.0), a(0, z0 + 0.65), [0, 1, 0], ZERO_UV, yellow);
      }
    }
    // the side blocks (the equipment rooms), from below the lowest ground to the roof
    const blkW = OW - IW, H = s.hi - s.lo;
    for (const sx of [-1, 1]) {
      const cx = sx * (IW + OW) / 2;
      const [x, z] = W(cx, L / 2);
      B.box(x, s.lo - 0.4, z, blkW, H + 0.4 + TOP, L, s.rot, wall);
      // the band of colour under the eaves, all round the block's outer face and the ends
      const [x2, z2] = W(cx, L / 2);
      B.box(x2, s.hi + TOP - 1.0, z2, blkW + 0.06, 0.7, L + 0.06, s.rot, band, { top: false });
      // windows on the outer wall: the equipment room's, a strip
      bx(sx * (OW + 0.02), L * 0.3, 0.06, L * 0.32, 1.2, 1.4, glass, site);
      bx(sx * (OW + 0.02), L * 0.72, 0.06, L * 0.2, 1.2, 1.4, glass, site);
      // a service door
      bx(sx * (OW + 0.02), L * 0.52, 0.06, 1.0, 0.0, 2.1, lin(0x5d6670), site);
      // the inner wall's wainscot (scuffed blue tile) and a light strip just under the ceiling
      bx(sx * (IW - 0.02), L / 2, 0.05, L - 0.2, 0.0, s.hi - s.lo + 1.1, lin(0x4f7fb8), { hi: s.lo, lo: s.lo });
      bx(sx * (IW - 0.015), L / 2, 0.03, L - 0.1, 1.1, CLEAR - 1.1, [0.36, 0.38, 0.41], site);
      bx(sx * (IW - 0.04), L / 2, 0.04, L - 0.4, CLEAR - 0.35, 0.14, [0.98, 0.98, 0.95], site);
    }
    // the roof slab over the tunnel (its ends are the fascias), its ceiling, a parapet
    {
      const [x, z] = W(0, L / 2);
      B.box(x, s.hi + CLEAR, z, IW * 2 + 0.02, TOP - CLEAR, L, s.rot, wallDk);
      const c = (a, b) => { const [px, pz] = W(a, b); return [px, s.hi + CLEAR, pz]; };
      for (let z0 = 0; z0 < L; z0 += 6) { const z1 = Math.min(L, z0 + 6); B.quad(c(-IW, z0), c(IW, z0), c(IW, z1), c(-IW, z1), [0, -1, 0], ZERO_UV, [0.82, 0.83, 0.84]); }
      // ceiling lights across the tunnel
      for (let lz = 2; lz < L - 1; lz += 4) bx(0, lz, IW * 1.4, 0.25, CLEAR - 0.06, 0.05, [1.0, 1.0, 0.96], site);
      // parapet trim all round
      for (const sx of [-1, 1]) bx(sx * (OW - 0.1), L / 2, 0.2, L, TOP, 0.5, trim, site);
      for (const lz of [0.1, L - 0.1]) bx(0, lz, OW * 2, 0.2, TOP, 0.5, trim, site);
      // HVAC on the roof
      bx(-OW * 0.5, L * 0.35, 1.6, 2.2, TOP, 1.0, steel, site);
    }
    // the fascias over the mouths: coloured panels, proud of the wall, the sign goes on them
    for (const [lz, d] of [[-0.12, -1], [L + 0.12, 1]]) {
      bx(0, lz, OW * 2 + 0.1, 0.24, CLEAR - 0.1, TOP - CLEAR + 0.6, band, site);
      // the mouth's frame: two trim posts
      for (const sx of [-1, 1]) post(sx * (IW + 0.12), lz + d * 0.02, 0.24, 0.28, CLEAR, trim);
    }
    // the arches inside: legs and a beam, nozzles; pre-soak (blue), foam (pink, blue, yellow), rinse (green)
    const arch = (lz, col, nozzles, curtain) => {
      for (const sx of [-1, 1]) post(sx * (IW - 0.14), lz, 0.16, 0.16, CLEAR - 0.3, col);
      bx(0, lz, IW * 2 - 0.1, 0.16, CLEAR - 0.46, 0.16, col, site);
      if (nozzles) for (let lx = -IW + 0.5; lx < IW - 0.3; lx += 0.55) bx(lx, lz, 0.08, 0.08, CLEAR - 0.6, 0.14, dark, site);
      if (curtain) bx(0, lz + 0.12, IW * 2 - 0.4, 0.05, CLEAR - 0.85, 0.4, col, site);
    };
    arch(q.st.soak, lin(0x2f86d6), true, false);
    q.st.foam.forEach((lz, i) => arch(lz, [lin(0xff5fa2), lin(0x4c8dff), lin(0xffd02a)][i], true, true));
    arch(q.st.rinse, lin(0x2fb36a), true, false);
    // the brush gantries: a beam across, the side brushes' pivot posts at the walls
    for (const lz of [q.st.brush, q.st.top]) {
      bx(0, lz, IW * 2 - 0.1, 0.3, CLEAR - 0.4, 0.3, steel, site);
      for (const sx of [-1, 1]) post(sx * (IW - 0.2), lz - 0.9, 0.24, 0.24, CLEAR - 0.4, steel);
    }
    // the blower: two big ducts over the car and a producer on each wall, orange cowls
    const orange = lin(0xf07a1c);
    for (const sx of [-1, 1]) {
      bx(sx * 0.85, q.st.blow, 1.1, 1.2, CLEAR - 0.85, 0.85, steel, site);
      bx(sx * 0.85, q.st.blow - 0.1, 0.8, 0.9, CLEAR - 1.0, 0.18, orange, site);
      bx(sx * (IW - 0.3), q.st.blow + 0.8, 0.5, 0.8, 0.5, 1.9, steel, site);
      bx(sx * (IW - 0.56), q.st.blow + 0.8, 0.06, 0.6, 0.7, 1.5, orange, site);
    }
    // a pay kiosk at the entrance (on the left, past the frame), and a menu board
    bx(-(IW + 1.6), -2.4, 1.1, 0.9, 0, 1.45, steel, under(-(IW + 1.6), -2.4, 1.1, 0.9));
    bx(-(IW + 1.6), -2.4, 0.9, 0.06, 0.8, 0.45, [0.05, 0.25, 0.32], under(-(IW + 1.6), -2.4, 1.1, 0.9));
    bx(IW + 1.7, -4.2, 0.18, 0.18, 0, 2.2, dark, under(IW + 1.7, -4.2, 0.2, 0.2));
    bx(IW + 1.7, -4.2, 1.6, 0.12, 1.4, 1.1, band, under(IW + 1.7, -4.2, 0.2, 0.2));
    const geo = B.build();
    const body = new THREE.Mesh(geo, this.bodyMat);
    body.castShadow = !ON_PHONE; body.receiveShadow = false;
    body.matrixAutoUpdate = false;
    body.name = 'carwash-body';
    const grp = new THREE.Group();
    grp.add(body);
    // the signs: one canvas, two planes (entrance and exit)
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 256;
    drawSign(cv.getContext('2d'), q);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    const sp = [], su = [], si = [];
    const sw = Math.min(OW * 2 - 0.4, 8.6), sh = sw * 0.125 * 1.0, syc = s.hi + CLEAR + (TOP - CLEAR + 0.4) / 2;
    const signQuad = (lz, facing, v0, v1) => {
      // facing +1: seen from beyond the exit, looking back (-axis); -1: from before the entrance (+axis)
      const [cx, cz] = W(0, lz);
      const dX = -facing * s.ax, dZ = -facing * s.az;     // the viewer's look direction
      const rX = -dZ, rZ = dX;                             // the viewer's right
      const n0 = sp.length / 3;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) sp.push(cx + rX * a * sw / 2, syc + b * sh / 2, cz + rZ * a * sw / 2);
      su.push(0, v0, 1, v0, 1, v1, 0, v1);
      si.push(n0, n0 + 1, n0 + 2, n0, n0 + 2, n0 + 3);
    };
    signQuad(-0.26, -1, 0.5, 1.0);
    signQuad(L + 0.26, 1, 0.0, 0.5);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
    sg.setIndex(si);
    sg.computeBoundingSphere();
    const sign = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    sign.matrixAutoUpdate = false; sign.name = 'carwash-sign';
    grp.add(sign);
    q.signTex = tex;
    // the lights: entrance (go / wait) and EXIT, two boxes on the fascias, recoloured by state
    const LB = new Builder(false);
    const lightBox = (lz, lx) => { const [x, z] = W(lx, lz); LB.box(x, s.hi + CLEAR - 0.75, z, 0.5, 0.5, 0.5, s.rot, [0.1, 0.1, 0.1]); };
    lightBox(-0.25, -(IW + 0.75));
    q.lightSplit = LB.pos.length / 3;
    lightBox(L + 0.25, IW + 0.75);
    { const [x, z] = W(1.5, L - 0.7); LB.box(x, s.hi + CLEAR - 0.62, z, 0.42, 0.42, 0.22, s.rot, [0.1, 0.1, 0.1]); }
    const lg = LB.build();
    const lights = new THREE.Mesh(lg, this.lightMat);
    lights.matrixAutoUpdate = false; lights.name = 'carwash-lights';
    grp.add(lights);
    q.lights = lights;
    q.light = '';
    this.setLights(q, 'idle');
    grp.visible = false;
    q.grp = grp;
    this.scene.add(grp);
  }

  /** idle: entrance green, exit dark; wait: entrance amber; ride: entrance red, exit red; done: exit green. */
  setLights(q, state) {
    if (!q.lights || q.light === state) return;
    q.light = state;
    const C = q.lights.geometry.attributes.color, a = C.array, n = C.count, sp = q.lightSplit;
    const ent = state === 'idle' ? [0.1, 1.0, 0.25] : state === 'wait' ? [1.0, 0.65, 0.05] : [1.0, 0.08, 0.05];
    const ext = state === 'done' ? [0.1, 1.0, 0.25] : state === 'ride' || state === 'wait' ? [1.0, 0.08, 0.05] : [0.12, 0.12, 0.12];
    for (let i = 0; i < n; i++) { const c = i < sp ? ent : ext; a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
    C.needsUpdate = true;
  }

  // --- what the wash takes ----------------------------------------------------------------------

  /** Why this vehicle will not be washed, or '' if it will. */
  refusal(v) {
    const s = v.spec;
    if (this.busy()) return 'Finish the job you are on first';
    if (s.plane || s.heli || s.balloon) return 'Aircraft get washed at the airport, not here';
    if (s.boat || s.jetski || s.kayak || s.hydro || v.afloat) return "A boat? It's already wet";
    if (s.bicycle) return 'Bikes and spinning brushes do not mix — walk it through';
    if (s.moto || s.atv || s.buggy) return 'No bikes or ATVs — the brushes would spin you like a top';
    if (s.rail || s.tank || !s.roadCar) return 'Road cars only';
    if (s.bus || s.towed || s.trailer || v.trailer || v.leader || v.isFloat) return 'Too big for the tunnel';
    if ((s.roof || 1.5) > MAX_ROOF) return `Too tall — the tunnel clears ${MAX_ROOF.toFixed(1)} m`;
    if (s.len > MAX_LEN || s.wid > 2.5) return 'Too big for the tunnel';
    const hf = clamp(v.health / (s.hp || 100), 0, 1);
    if (v.dead || v.burnT > 0 || hf < 0.15) return 'We wash cars, not wrecks';
    if (v.capsized) return 'Wheels down first';
    if (this.game.money < PRICE) return `The wash is $${PRICE} — you're short`;
    return '';
  }

  // --- the frame -----------------------------------------------------------------------------------

  tick(dt, player) {
    this.tickGloss(dt);
    const veh = player.vehicle && !player.onFoot ? player.vehicle : null;
    const px = veh ? veh.x : player.x, pz = veh ? veh.z : player.z;
    for (const q of this.sites) {
      const d = Math.hypot(q.mx - px, q.mz - pz);
      if (!q.built && d < BUILD_R) { try { this.build(q); } catch (e) { q.built = true; console.warn('car wash build: ' + e.message); } }
      if (q.grp) q.grp.visible = d < SHOW_R || (this.ride && this.ride.q === q);
      if (this.ride) { if (this.ride.q === q) this.run(dt, player); continue; }
      if (q.doneT > 0 && (q.doneT -= dt) <= 0) this.setLights(q, 'idle');
      if (d > 70) { q.dwell = 0; q.prompt = null; if (d > 90) { q.told = ''; q.footIn = false; } continue; }
      const lc = this.local(q, px, pz);
      if (!veh) { q.dwell = 0; q.prompt = null; this.onFoot(dt, q, lc, player); continue; }
      q.footIn = false;
      // in a car: stopped on the conveyor at the entrance, lined up with it?
      const inZone = Math.abs(lc.lx) < 1.5 && lc.lz > ENTRY[0] && lc.lz < ENTRY[1];
      const dh = Math.abs(wrapA(veh.heading - Math.atan2(q.s.ax, q.s.az)));
      if (!inZone || dh > 0.6) {
        if (q.prompt) { q.prompt = null; this.setLights(q, 'idle'); }
        q.dwell = 0;
        if (lc.lz < -9 || lc.lz > 4 || Math.abs(lc.lx) > 5) { q.told = ''; q.toldV = null; }
        continue;
      }
      if (q.prompt) {
        if (q.prompt.v !== veh || Math.abs(veh.vLong) > 1.6) { q.prompt = null; this.setLights(q, 'idle'); q.dwell = 0; continue; }
        if ((q.prompt.t += dt) >= PROMPT_T) this.start(q, veh, player);
        continue;
      }
      if (Math.abs(veh.vLong) > 1.0) { q.dwell = 0; continue; }
      if ((q.dwell += dt) < DWELL) continue;
      const why = this.refusal(veh);
      if (why) {
        if (q.toldV !== veh) { q.toldV = veh; q.told = ''; }
        if (q.told !== why) { q.told = why; this.toast(`${q.g.name}: ${why}`, 3200); if (this.audio && this.audio.ready) this.audio.play('ui_fail', { gain: 0.4 }); }
        continue;
      }
      q.prompt = { v: veh, t: 0 };
      this.setLights(q, 'wait');
      this.toast(`${q.g.name}: $${PRICE} wash — ENTER to pay, or just wait`, 2200);
    }
  }

  toast(t, ms) { if (this.hud) this.hud.showToast(t, ms); }

  /** ENTER in a car (main.js tryDriveThru, before getting out): pay at the prompt; swallowed on the conveyor. */
  tryEnter(pl) {
    const v = pl.vehicle;
    if (!v || pl.onFoot) return false;
    if (this.ride && this.ride.v === v) { this.toast('Sit tight — the conveyor has you', 1600); return true; }
    for (const q of this.sites) if (q.prompt && q.prompt.v === v) { this.start(q, v, pl); return true; }
    return false;
  }

  /** On foot: walk into the tunnel and you are soaked (once per visit). */
  onFoot(dt, q, lc, player) {
    const inside = Math.abs(lc.lx) < IW - 0.2 && lc.lz > 1.0 && lc.lz < q.s.L - 1.0;
    if (!inside) { if ((q.footOut += dt) > 2) q.footIn = false; return; }
    q.footOut = 0;
    if (q.footIn) return;
    q.footIn = true;
    this.toast(`You walk through the car wash. You are now very clean. +${formatMoney(0)}`, 3600);
    this.game.money += 0;
    sprayBurst(this.audio, 2.2);
    if (this.fx) {
      const y = player.y;
      for (let i = 0; i < 4; i++) this.fx.emit(player.x, y + 2.6, player.z, 10, { r: 0.85, g: 0.93, b: 1.0, size: 0.24, life: 0.8, spread: 1.6, vy: -1.5, grav: -7, drag: 0.92, jitter: 1.0, alpha: 0.75 });
      this.fx.emit(player.x, y + 1.2, player.z, 6, { r: 0.92, g: 0.96, b: 1.0, size: 1.2, grow: 1.6, alpha: 0.35, life: 1.4, spread: 0.8, vy: 0.3, grav: 0.1, drag: 0.9 });
    }
    this.footSoaks = (this.footSoaks || 0) + 1;
  }

  /** Paid: the conveyor takes the car. */
  start(q, v, player) {
    if (this.ride) return;
    q.prompt = null;
    this.game.money -= PRICE;
    if (this.audio && this.audio.ready) { this.audio.cash(); this.audio.play('thunk', { gain: 0.5 }); }
    const lc = this.local(q, v.x, v.z);
    const lzEnd = q.s.L + v.halfLen + 1.4;
    const D = Math.max(1, lzEnd - lc.lz);
    const T = D / SPEED + ACC_T;
    const gag = this.rig === 'gag' ? true : this.rig === 'clean' ? false : Math.random() < 0.05;
    const S = this.ride = { q, v, t: 0, lz0: lc.lz, lx0: lc.lx, h0: v.heading, hA: Math.atan2(q.s.ax, q.s.az), D, T, vmax: SPEED,
      lz: lc.lz, gag, gagDone: false, exited: false, acc: {}, said: {}, brushX: IW - BR_R - 0.15, topY: q.s.hi + CLEAR - BR_R - 0.25, phi: 0,
      prevAuto: player.autoDrive || null, player, health0: v.health, money0: this.game.money + PRICE, camT: 0 };
    player.autoDrive = this._neutral;
    v.camRig = (pl, dt) => this.camRig(pl, dt);
    if (!this.rideMesh) this.rideMesh = new RideMesh(this.bodyMat);
    for (const f of this.rideMesh.f) { f.on = 0; f.s = 0; }
    this.rideMesh.free = NFOAM;
    this.scene.add(this.rideMesh.mesh);
    try { S.snd = this.audio && this.audio.ready && this.audio.ctx && this.audio.enabled !== false ? new WashSound(this.audio) : null; } catch (e) { S.snd = null; }
    this.setLights(q, 'ride');
    this.toast(`${q.g.name}: ${formatMoney(PRICE)} — hands off the wheel, the conveyor has you`, 2600);
  }

  /** The conveyor's distance at time t (a trapezoid: ramp up, constant, ramp down). */
  along(S, t) {
    const T = S.T, a = ACC_T, vm = S.D / (T - a);
    if (t <= 0) return 0;
    if (t < a) return 0.5 * vm * t * t / a;
    if (t < T - a) return vm * (t - a / 2);
    if (t < T) return S.D - 0.5 * vm * (T - t) * (T - t) / a;
    return S.D;
  }

  run(dt, player) {
    const S = this.ride, q = S.q, v = S.v, s = q.s;
    if (player.vehicle !== v || player.onFoot || v.dead) { this.end(false); return; }
    S.t += dt;
    const t = S.t;
    const lz = S.lz0 + this.along(S, t);
    const k = ease(t / 1.2);
    const lx = S.lx0 * (1 - k);
    const [x, z] = q.W(lx, lz);
    const spd = (this.along(S, t + 0.05) - this.along(S, t)) / 0.05;
    v.x = x; v.z = z;
    v.heading = S.h0 + wrapA(S.hA - S.h0) * k;
    v.vLong = spd; v.vLat = 0; if (v.spin !== undefined) v.spin = 0;
    v.sync();
    S.lz = lz;
    const hl = v.halfLen, hw = v.halfWid || (v.spec.wid || 1.9) / 2, sp = v.spec;
    const under = (st, pad = 0.4) => Math.abs(st - lz) < hl + pad;
    const fx = this.fx, A = this.audio && this.audio.ready ? this.audio : null;
    const emitN = (key, rate) => { S.acc[key] = (S.acc[key] || 0) + rate * dt; const n = Math.floor(S.acc[key]); S.acc[key] -= n; return n; };
    const yF = s.hi, yAt = (st) => { const [ax, az] = q.W(0, st); return G.terrainHeight(ax, az); };
    // the car's top at a car-frame lz: the roof over the cabin, the hood / boot elsewhere
    const topAt = (clz) => {
      const fr = clz / (sp.len || 4.6), c0 = sp.cab ? sp.cab[0] : -0.25, c1 = sp.cab ? sp.cab[1] : 0.1;
      const cab = fr >= c0 - 0.04 && fr <= c1 + 0.02, box = sp.boxy && fr < c0;
      return (cab || box ? (sp.roof || 1.5) : (sp.belt || 1.0) - 0.08);
    };
    // spray arches: soak and rinse
    let spray = 0, foam = 0, brush = 0, roar = 0;
    for (const key of ['soak', 'rinse']) {
      const st = q.st[key];
      if (!under(st, 1.2)) continue;
      spray = 1;
      if (fx) {
        for (let n = emitN(key, 75); n > 0; n--) {
          const ax = (Math.random() * 2 - 1) * (IW - 0.4), side = Math.random() < 0.35;
          const ex = side ? (Math.random() < 0.5 ? -1 : 1) * (IW - 0.2) : ax, ey = side ? yAt(st) + 0.4 + Math.random() * 2.4 : yF + CLEAR - 0.6;
          const [wx, wz] = q.W(ex, st);
          const inX = side ? -Math.sign(ex) * 2.6 : 0;
          fx.emit(wx, ey, wz, 1, { r: 0.86, g: 0.93, b: 1.0, size: 0.38, life: 0.6, spread: 0.6, vx: inX * s.cr, vz: inX * s.sr, vy: side ? 0.2 : -3.2, grav: -6, drag: 0.94, jitter: 0.1, alpha: 0.75 });
        }
        if (emitN(key + 'm', 7) > 0) { const [wx, wz] = q.W(0, st); fx.emit(wx, yAt(st) + 1.6, wz, 1, { r: 0.92, g: 0.96, b: 1.0, size: 1.8, grow: 1.5, alpha: 0.32, life: 1.3, spread: 0.6, vy: 0.2, grav: 0.05, drag: 0.9, jitter: 1.4 }); }
      }
      // the rinse washes the foam off where it passes over the car
      if (key === 'rinse' && this.rideMesh) { const rel = st - lz; for (const f of this.rideMesh.f) if (f.on && f.st !== 3 && Math.abs(f.lz - rel) < 0.7) f.st = 3; }
      if (key === 'soak' && S.gag && !S.gagDone && Math.abs(st - lz) < 0.6) {
        S.gagDone = true;
        this.toast('You left the window down. You are now very clean too.', 3600);
        if (A) A.play('splash', { gain: 0.5 });
        if (fx) fx.emit(v.x, v.y + (sp.roof || 1.5) - 0.3, v.z, 18, { r: 0.85, g: 0.93, b: 1.0, size: 0.2, life: 0.7, spread: 1.4, vy: 0.5, grav: -8, drag: 0.92, jitter: 0.6 });
      }
    }
    // the foam curtains
    q.st.foam.forEach((st, i) => {
      if (!under(st, 0.6)) return;
      foam = 1;
      const rel = st - lz;
      if (this.rideMesh && Math.abs(rel) < hl * 0.98) {
        // ~FOAM_N blobs a curtain, however long the car (the pool holds all three colours)
        const rate = FOAM_N / ((2 * hl + 0.6) / Math.max(0.5, S.D / (S.T - ACC_T)));
        for (let n = emitN('foam' + i, rate); n > 0; n--) {
          const clz = rel + (Math.random() - 0.5) * 0.5;
          this.rideMesh.spawn((Math.random() * 2 - 1) * (hw - 0.18), topAt(clz) + 0.04, clz, i);
        }
      }
      if (fx) for (let n = emitN('foamp' + i, 16); n > 0; n--) {
        const [wx, wz] = q.W((Math.random() * 2 - 1) * (IW - 0.5), st + 0.12);
        const c = FOAM_COL[i];
        fx.emit(wx, yF + CLEAR - 0.9, wz, 1, { r: Math.min(1, c[0] + 0.15), g: Math.min(1, c[1] + 0.15), b: Math.min(1, c[2] + 0.15), size: 0.4, life: 0.8, spread: 0.3, vy: -1.2, grav: -3, drag: 0.9, jitter: 0.2 });
      }
    });
    // the brushes: the side pair swings in against the car while it passes, the top one rides its roof line
    const sideOn = under(q.st.brush, 0.1), topOn = under(q.st.top, 0.2);
    const wantX = sideOn ? hw + BR_R * 0.78 : IW - BR_R - 0.15;
    S.brushX += (wantX - S.brushX) * Math.min(1, dt * 4);
    const wantY = topOn ? v.y + topAt(q.st.top - lz) + BR_R * 0.8 : yF + CLEAR - BR_R - 0.25;
    S.topY += (wantY - S.topY) * Math.min(1, dt * 3);
    if (sideOn || topOn) brush = 1;
    if (this.rideMesh) {
      const M = this.rideMesh;
      S.phi += dt * (sideOn || topOn ? 9 : 4);
      for (const sx of [-1, 1]) {
        const [bxw, bzw] = q.W(sx * S.brushX, q.st.brush);
        M.brush(sx < 0 ? 0 : 1, bxw, yAt(q.st.brush) + 0.25 + BR_H / 2, bzw, 0, 1, 0, BR_H, sx * S.phi, t);
      }
      const [txw, tzw] = q.W(0, q.st.top);
      M.brush(2, txw, S.topY, tzw, s.cr, 0, s.sr, IW * 2 - 0.5, S.phi * 0.8, t);
      // flicks of water off the drums
      if (fx && (sideOn || topOn) && emitN('brushp', 18) > 0) {
        const [wx, wz] = sideOn ? q.W((Math.random() < 0.5 ? -1 : 1) * (S.brushX + BR_R), q.st.brush) : q.W((Math.random() - 0.5) * 3, q.st.top);
        fx.emit(wx, sideOn ? yAt(q.st.brush) + 0.6 + Math.random() * 1.6 : S.topY, wz, 2, { r: 0.85, g: 0.92, b: 1.0, size: 0.16, life: 0.4, spread: 2.4, vy: 1.0, grav: -9, drag: 0.9, jitter: 0.2 });
      }
    }
    // the blower: the roar, the last of the foam blown off, the water driven back
    if (under(q.st.blow, 1.0)) {
      roar = 1;
      if (this.rideMesh) for (const f of this.rideMesh.f) if (f.on && f.st !== 3) f.st = 3;
      if (fx) for (let n = emitN('blow', 30); n > 0; n--) {
        const [wx, wz] = q.W((Math.random() * 2 - 1) * hw, q.st.blow);
        fx.emit(wx, v.y + 0.4 + Math.random() * ((sp.roof || 1.5) - 0.2), wz, 1, { r: 0.88, g: 0.94, b: 1.0, size: 0.2, life: 0.5, spread: 1.0, vx: -s.ax * 5.5, vz: -s.az * 5.5, vy: 0.4, grav: -2, drag: 0.95, jitter: 0.3, alpha: 0.8 });
      }
      if (fx && emitN('blowm', 6) > 0) { const [wx, wz] = q.W((Math.random() - 0.5) * 2, q.st.blow); fx.emit(wx, v.y + (sp.roof || 1.5), wz, 1, { r: 0.94, g: 0.97, b: 1.0, size: 1.4, grow: 2.0, alpha: 0.3, life: 0.9, spread: 0.5, vx: -s.ax * 4, vz: -s.az * 4, vy: -0.3, grav: 0, drag: 0.93, jitter: 0.8 }); }
    } else if (Math.abs(q.st.blow - lz) < hl + 4) roar = 0.35;
    if (this.rideMesh) this.rideMesh.foam(dt, v, hw, sp.sill || 0.35);
    if (S.snd) S.snd.set(spray, foam, brush, roar);
    // out of the exit: the green light, the shine
    if (!S.exited && lz - hl > s.L - 0.6) this.finish(q, v, S);
    if (t >= S.T) this.end(true);
  }

  /** Out of the tunnel: green light, health +5, steam gone, a gloss on the paint. */
  finish(q, v, S) {
    S.exited = true;
    this.setLights(q, 'done');
    chime(this.audio);
    const hp = v.spec.hp || 100;
    S.h0 = v.health;
    v.health = Math.min(hp, v.health + 5);
    S.h1 = v.health;
    v.steamT = 0;
    this.glossOn(v);
    this.washes++;
    this.toast(`Showroom shine! ${q.g.name} thanks you — and the dirt is somebody else's problem now`, 3400);
  }

  /** The gloss: THIS car's paint roughness pulled down and its env reflection up, easing back over GLOSS_T. */
  glossOn(v) {
    const m = v.bodyMat;
    if (!m || typeof m.roughness !== 'number') return;
    let g = this.gloss.find((e) => e.m === m);
    if (!g) { g = { m, r0: m.roughness, e0: typeof m.envMapIntensity === 'number' ? m.envMapIntensity : null, t: 0 }; this.gloss.push(g); }
    g.t = GLOSS_T;
    this.applyGloss(g);
  }
  applyGloss(g) {
    const k = clamp(g.t / GLOSS_T, 0, 1), e = k * k * (3 - 2 * k);
    g.m.roughness = g.r0 * (1 - 0.65 * e);
    if (g.e0 !== null) g.m.envMapIntensity = g.e0 * (1 + 0.6 * e);
  }
  tickGloss(dt) {
    for (let i = this.gloss.length - 1; i >= 0; i--) {
      const g = this.gloss[i];
      g.t -= dt;
      if (g.t <= 0) { g.m.roughness = g.r0; if (g.e0 !== null) g.m.envMapIntensity = g.e0; this.gloss.splice(i, 1); }
      else this.applyGloss(g);
    }
  }

  /** The ride's camera: low behind the car, inside the tunnel, under the ceiling (player.updateCamera calls it). */
  camRig(pl, dt) {
    const S = this.ride;
    if (!S || S.v !== pl.vehicle) return false;
    const q = S.q, v = S.v;
    const back = 5.4 + v.halfLen * 0.3;
    const [cx, cz] = q.W(1.05, S.lz - back);
    const want = new THREE.Vector3(cx, q.s.hi + 2.35, cz);
    const [lx, lz] = q.W(0, S.lz + 2.2);
    const look = new THREE.Vector3(lx, q.s.hi + 1.0, lz);
    const k = 1 - Math.exp(-(S.camT < 1.2 ? 3.5 : 8) * dt);
    S.camT += dt;
    pl.camPos.lerp(want, k);
    pl.camLook.lerp(look, k);
    // never into the roof, whatever the lerp passes through
    pl.camPos.y = Math.min(pl.camPos.y, q.s.hi + CLEAR - 0.35);
    pl.camRel = null; pl.camLookRel = null; pl.camUp = null;
    pl.camYaw = Math.atan2(pl.camPos.x - v.x, pl.camPos.z - v.z);
    pl.camFloor = null;
    return true;
  }

  /** The ride is over (done) or abandoned: give everything back. */
  end(done) {
    const S = this.ride;
    this.ride = null;
    if (!S) return;
    const pl = S.player;
    if (pl.autoDrive === this._neutral) pl.autoDrive = S.prevAuto;
    if (S.v.camRig) delete S.v.camRig;
    if (this.rideMesh) this.scene.remove(this.rideMesh.mesh);
    if (S.snd) { try { S.snd.stop(); } catch (e) { /* audio */ } }
    if (done) { S.v.vLong = 0; S.q.doneT = 4; } else this.setLights(S.q, 'idle');
    this.last = { done, t: S.t, T: S.T, gag: S.gag, lz0: S.lz0, lz: S.lz, h0: S.h0, h1: S.h1 };
  }

  /** Respawn / reset: let go at once. */
  abort() { if (this.ride) this.end(false); for (const q of this.sites) q.prompt = null; }
}

const NEUTRAL = Object.freeze({ x: 0, y: 0, gas: false, brake: false, hand: false, gasAmt: 0, brakeAmt: 0, liftAmt: 0, sinkAmt: 0 });
