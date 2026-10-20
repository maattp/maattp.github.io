// WATERLOO REGION'S EXTRAS: the things a local would miss.
//
//   - the St. Jacobs Farmers' Market's big white tent (OSM's "Market Tent",
//     80 m x 20 m beside the market), a clear-span marquee over rows of
//     stalls: its box is flattened at boot (prepFun) and the tent drawn here;
//   - Canadian flags on poles at the city halls, schools, fire halls,
//     libraries, post offices, the Legions, the campuses and -- huge -- at the
//     car dealerships, each flying on the front lawn toward the street
//     (kw.json `flags`, tools/kw/build_kw.py). One shared material whose
//     vertex shader waves the cloth, so they all move for one uniform;
//   - KW Surplus on Victoria St N: its T-54 on the lawn is the drivable tank
//     (tank.js TANK_SITE is moved here at boot) and the Spitfire stands on
//     its roof (spitfireSpot);
//   - openGround: a clear patch of grass near a point, for the balloon.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { boxAt } from './kw.js';

const MARKET_TENT = [-6532, -6670];
const SPORTS_DOME = [-6234, -6905];   // Market Sports KW's dome, beside the market
const KW_SURPLUS = [130, -1100];
const U0 = [0, 0, 0, 0, 0, 0, 0, 0];
const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
const ckey = (x, z) => `${Math.round(x / 1200)},${Math.round(z / 1200)}`;

let tentBox = null, domeBox = null;

/** Before anything is meshed: the tent's and the dome's boxes go flat (drawn here instead). */
export function prepFun(city) {
  const d = boxAt(city, SPORTS_DOME[0], SPORTS_DOME[1], 4);
  if (d && d.w * d.d > 3000) {
    domeBox = { x: d.x, z: d.z, w: d.w, d: d.d, rot: d.rot };
    d.h = 0;
    if (!d.kw) d.kw = {};
    d.kw.skip = true;
  }
  const b = boxAt(city, MARKET_TENT[0], MARKET_TENT[1], 4);
  if (b && b.w * b.d > 900 && b.w * b.d < 3000) {
    tentBox = { x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot };
    b.h = 0;
    if (!b.kw) b.kw = {};
    b.kw.skip = true;   // world.js draws nothing for it
  }
}

// --- the Market Tent -------------------------------------------------------------

/** landmarks.js extra: the St. Jacobs market tent, its posts and the stalls under it. */
export function buildMarketTent(ctx) {
  if (!tentBox) return;
  const t = tentBox;
  // along the long side
  const long = t.w >= t.d;
  const L = long ? t.w : t.d, W = long ? t.d : t.w;
  const ux = long ? Math.cos(t.rot) : -Math.sin(t.rot), uz = long ? Math.sin(t.rot) : Math.cos(t.rot);
  const vx = -uz, vz = ux;
  const P = (a, b, y) => [t.x + ux * a + vx * b, y, t.z + uz * a + vz * b];
  let y0 = Infinity;
  for (const a of [-L / 2, 0, L / 2]) for (const b of [-W / 2, W / 2]) { const q = P(a, b, 0); y0 = Math.min(y0, G.terrainHeight(q[0], q[2])); }
  const EAVE = 4.2, RIDGE = 10.5;
  const TENT = lin([0.96, 0.96, 0.95]), SHADE = lin([0.86, 0.87, 0.88]), POST = lin([0.72, 0.74, 0.76]);
  const B = new Builder(false);
  const hl = L / 2, hw = W / 2;
  // the roof: two slopes, each a run of panels with a seam's sag between bays
  const BAYS = Math.max(4, Math.round(L / 5));
  for (let i = 0; i < BAYS; i++) {
    const a0 = -hl + (i / BAYS) * L, a1 = -hl + ((i + 1) / BAYS) * L, am = (a0 + a1) / 2;
    for (const s of [-1, 1]) {
      const n = [vx * s * 0.6, 0.8, vz * s * 0.6];
      // a panel is two quads, its middle bellied up a little between the purlins
      B.quad(P(a0, s * hw, y0 + EAVE), P(am, s * hw, y0 + EAVE + 0.15), P(am, 0, y0 + RIDGE + 0.15), P(a0, 0, y0 + RIDGE), n, U0, TENT);
      B.quad(P(am, s * hw, y0 + EAVE + 0.15), P(a1, s * hw, y0 + EAVE), P(a1, 0, y0 + RIDGE), P(am, 0, y0 + RIDGE + 0.15), n, U0, TENT);
      // and its underside, a shade darker
      B.quad(P(a0, s * hw, y0 + EAVE - 0.02), P(a0, 0, y0 + RIDGE - 0.02), P(am, 0, y0 + RIDGE + 0.13), P(am, s * hw, y0 + EAVE + 0.13), [-n[0], -n[1], -n[2]], U0, SHADE);
      B.quad(P(am, s * hw, y0 + EAVE + 0.13), P(am, 0, y0 + RIDGE + 0.13), P(a1, 0, y0 + RIDGE - 0.02), P(a1, s * hw, y0 + EAVE - 0.02), [-n[0], -n[1], -n[2]], U0, SHADE);
      // a scalloped valance under the eave
      const nv = [vx * s, 0, vz * s];
      B.quad(P(a0, s * (hw + 0.05), y0 + EAVE), P(a1, s * (hw + 0.05), y0 + EAVE), P(a1, s * (hw + 0.05), y0 + EAVE - 0.55), P(a0, s * (hw + 0.05), y0 + EAVE - 0.55), nv, U0, TENT);
      B.tri(P(a0, s * (hw + 0.05), y0 + EAVE - 0.55), P(a1, s * (hw + 0.05), y0 + EAVE - 0.55), P(am, s * (hw + 0.05), y0 + EAVE - 0.95), nv, TENT);
    }
  }
  // gable ends: white triangles, the lower walls open but for a valance
  for (const e of [-1, 1]) {
    const n = [ux * e, 0, uz * e];
    B.tri(P(e * hl, -hw, y0 + EAVE), P(e * hl, hw, y0 + EAVE), P(e * hl, 0, y0 + RIDGE), n, TENT);
    B.tri(P(e * hl, -hw, y0 + EAVE), P(e * hl, 0, y0 + RIDGE), P(e * hl, hw, y0 + EAVE), [-n[0], 0, -n[2]], SHADE);
    B.quad(P(e * hl, -hw, y0 + EAVE), P(e * hl, hw, y0 + EAVE), P(e * hl, hw, y0 + EAVE - 0.55), P(e * hl, -hw, y0 + EAVE - 0.55), n, U0, TENT);
  }
  // the frame: posts at every bay down both sides and the gable centres
  const post = (a, b, h) => {
    const q = P(a, b, 0);
    B.box(q[0], y0 - 0.5, q[2], 0.22, h + 0.5, 0.22, Math.atan2(uz, ux), POST);
    ctx.solids.push({ x: q[0], z: q[2], r: 0.25, y0: y0 - 1, y1: y0 + h });
  };
  for (let i = 0; i <= BAYS; i++) for (const s of [-1, 1]) post(-hl + (i / BAYS) * L, s * hw, EAVE);
  for (const e of [-1, 1]) post(e * hl, 0, RIDGE);
  // the stalls: two rows of trestle tables down the aisles, piled with what
  // October brings -- pumpkins, squash, apples, corn, maple syrup
  const GOODS = [lin([0.86, 0.42, 0.08]), lin([0.76, 0.12, 0.10]), lin([0.92, 0.78, 0.30]), lin([0.40, 0.55, 0.20]),
    lin([0.55, 0.25, 0.08]), lin([0.88, 0.62, 0.20])];
  const TABLE = lin([0.55, 0.40, 0.26]), CLOTH = [lin([0.20, 0.35, 0.65]), lin([0.80, 0.80, 0.78]), lin([0.62, 0.15, 0.15])];
  let k = 0;
  for (const b of [-hw * 0.55, hw * 0.55]) {
    for (let a = -hl + 3; a < hl - 3; a += 4.2) {
      const q = P(a, b, 0), yy = y0;
      const rot = Math.atan2(uz, ux);
      B.box(q[0], yy + 0.80, q[2], 3.2, 0.06, 1.2, rot, CLOTH[k % 3]);
      B.box(q[0], yy - 0.2, q[2], 3.0, 1.0, 1.0, rot, TABLE);
      for (let j = 0; j < 4; j++) {
        const g = GOODS[(k * 3 + j) % GOODS.length];
        const a2 = a - 1.1 + j * 0.73, q2 = P(a2, b + ((j % 2) - 0.5) * 0.4, 0);
        B.box(q2[0], yy + 0.86, q2[2], 0.55, 0.34, 0.55, rot + j, g);
      }
      ctx.solids.push({ x: q[0], z: q[2], hw: 1.6, hd: 0.6, rot: Math.atan2(uz, ux), y0: yy - 1, y1: yy + 1 });
      k++;
    }
  }
  const m = new THREE.Mesh(B.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide }));
  m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group();
  g.add(m);
  // the market's name over the gable toward the car park
  if (ctx.atlas) {
    const p = ctx.atlas.text('ST. JACOBS FARMERS’ MARKET', 12, 1.3, '#1e3a5f', '#ffffff', {});
    const e = -1, q = P(e * (hl + 0.08), 0, y0 + EAVE + 1.4);
    p.position.set(q[0], q[1], q[2]);
    p.rotation.y = Math.atan2(ux * e, uz * e);
    g.add(p);
  }
  ctx.addTo(ckey(t.x, t.z), g);
}

// --- Market Sports' dome ---------------------------------------------------------------

/**
 * landmarks.js extra: the air-supported dome over Market Sports' turf by the
 * St. Jacobs market -- white fabric on a rounded-rectangle plan (64 m x 107 m
 * in OSM), 24 m at the crown, its cable net drawn as seams, and the airlock
 * door at one end.
 */
export function buildDome(ctx) {
  if (!domeBox) return;
  const t = domeBox, long = t.w >= t.d;
  const A = (long ? t.w : t.d) / 2, Bh = (long ? t.d : t.w) / 2;
  const ux = long ? Math.cos(t.rot) : -Math.sin(t.rot), uz = long ? Math.sin(t.rot) : Math.cos(t.rot);
  const vx = -uz, vz = ux;
  let y0 = Infinity;
  for (const a of [-A, 0, A]) for (const b of [-Bh, 0, Bh]) y0 = Math.min(y0, G.terrainHeight(t.x + ux * a + vx * b, t.z + uz * a + vz * b));
  const H = 24, NS = 48, NT = 12, E = 2.6;   // E: the plan's squareness (2 an ellipse)
  const pt = (si, ti) => {
    const s = (si / NS) * Math.PI * 2, tt = (ti / NT) * Math.PI / 2;
    const c = Math.cos(s), sn = Math.sin(s);
    const k = Math.pow(Math.cos(tt), 0.75);
    const a = A * k * Math.sign(c) * Math.pow(Math.abs(c), 2 / E), b = Bh * k * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / E);
    return [t.x + ux * a + vx * b, y0 - 0.3 + H * Math.sin(tt) + (ti === 0 ? 0 : 0.3), t.z + uz * a + vz * b];
  };
  const P = [];
  for (let ti = 0; ti <= NT; ti++) { P.push([]); for (let si = 0; si <= NS; si++) P[ti].push(pt(si % NS, ti)); }
  const nrm = (ti, si) => {
    const p = P[ti][si], q = P[Math.min(NT, ti + 1)][si], r = P[ti][(si + 1) % NS], o = P[Math.max(0, ti - 1)][si], l = P[ti][(si + NS - 1) % NS];
    const ax = q[0] - o[0], ay = q[1] - o[1], az = q[2] - o[2], bx = r[0] - l[0], by = r[1] - l[1], bz = r[2] - l[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    // outward: away from the centre
    if (nx * (p[0] - t.x) + nz * (p[2] - t.z) + ny * 0.5 < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const L = Math.hypot(nx, ny, nz) || 1;
    return ti === NT ? [0, 1, 0] : [nx / L, ny / L, nz / L];
  };
  const FAB = lin([0.95, 0.95, 0.94]), SEAM = lin([0.80, 0.81, 0.82]);
  const B = new Builder(false);
  for (let ti = 0; ti < NT; ti++) {
    for (let si = 0; si < NS; si++) {
      const col = si % 4 === 0 ? SEAM : FAB;
      B.quad(P[ti][si], P[ti][si + 1], P[ti + 1][si + 1], P[ti + 1][si],
        [nrm(ti, si), nrm(ti, (si + 1) % NS), nrm(ti + 1, (si + 1) % NS), nrm(ti + 1, si)], U0, col);
    }
  }
  // the airlock: a grey box at the end toward the market, with its door
  const ex = t.x - ux * (A + 2.5), ez = t.z - uz * (A + 2.5), ey = G.terrainHeight(ex, ez);
  const rot = Math.atan2(uz, ux);
  B.box(ex, ey - 0.3, ez, 6, 3.6, 7, rot, lin([0.55, 0.57, 0.6]));
  B.box(ex - ux * 3.02, ey, ez - uz * 3.02, 0.1, 2.4, 2.2, rot, lin([0.18, 0.22, 0.28]));
  const m = new THREE.Mesh(B.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }));
  m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group();
  g.add(m);
  if (ctx.atlas) {
    const p = ctx.atlas.text('MARKET SPORTS', 16, 2.4, '#ffffff', '#1d4f91', {});
    const q = pt(NS / 2, 4);
    p.position.set(q[0] - ux * 0.6, q[1] + 1.5, q[2] - uz * 0.6);
    p.rotation.y = Math.atan2(-ux, -uz);
    p.rotation.x = 0;
    g.add(p);
  }
  // what stops a car: the dome's footprint, a little inside its skirt
  ctx.solids.push({ x: t.x, z: t.z, hw: A * 0.93, hd: Bh * 0.9, rot, y0: y0 - 2, y1: y0 + H });
  ctx.solids.push({ x: ex, z: ez, hw: 3, hd: 3.5, rot, y0: ey - 1, y1: ey + 3.3 });
  ctx.addTo(ckey(t.x, t.z), g);
}

// --- Canadian flags -----------------------------------------------------------------

// The leaf, from the flag's specification drawing (a 9600 x 4800 field).
const LEAF = 'm4890 4430-45-863a95 95 0 0 1 111-98l859 151-116-320a65 65 0 0 1 20-73l941-762-212-99a65 65 0 0 1-34-79l186-572-542 115a65 65 0 0 1-73-38l-105-247-423 454a65 65 0 0 1-111-57l204-1052-327 189a65 65 0 0 1-91-27l-332-652-332 652a65 65 0 0 1-91 27l-327-189 204 1052a65 65 0 0 1-111 57l-423-454-105 247a65 65 0 0 1-73 38l-542-115 186 572a65 65 0 0 1-34 79l-212 99 941 762a65 65 0 0 1 20 73l-116 320 859-151a95 95 0 0 1 111 98l-45 863z';
let flagMat = null;
const flagTime = { value: 0 };

function flagMaterial() {
  if (flagMat) return flagMat;
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#d52b1e';
  g.fillRect(0, 0, 128, 256); g.fillRect(384, 0, 128, 256);
  g.save(); g.scale(512 / 9600, 256 / 4800);
  try { g.fill(new Path2D(LEAF)); } catch (e) { /* no Path2D: a plain field */ }
  g.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  flagMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  // the cloth waves: displaced along its own normal, more toward the fly
  // (uv.x), a travelling wave whose phase also runs with the position so
  // neighbouring flags do not flap in step
  flagMat.onBeforeCompile = (sh) => {
    sh.uniforms.uFlagT = flagTime;
    sh.vertexShader = 'uniform float uFlagT;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      float fu = uv.x;
      float ph = uFlagT * 5.5 - fu * 7.0 + (position.x + position.z) * 0.11;
      transformed += normal * (sin(ph) * 0.11 + sin(ph * 1.7 + 1.3) * 0.05) * fu * FLAG_SPAN;
      transformed.y -= fu * fu * 0.06 * FLAG_SPAN;`).replace('void main() {', '#define FLAG_SPAN 1.0\nvoid main() {');
  };
  flagMat.customProgramCacheKey = () => 'kwflag';
  return flagMat;
}

/** The flags wave (main.js calls this each frame with the game clock). */
export function waveFlags(t) { flagTime.value = t % 1000; }

function flagSite(city, x, z, big) {
  // the front lawn: toward the nearest street, between the building and it
  let best = null, bd = 140;
  for (const ei of city.edgesNear(x, z, 140)) {
    const e = city.edges[ei];
    if (e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp') continue;
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(e.len, (x - a.x) * e.dx + (z - a.z) * e.dz));
    const qx = a.x + e.dx * t, qz = a.z + e.dz * t, d = Math.hypot(x - qx, z - qz);
    if (d < bd) { bd = d; best = { qx, qz, d, hw: e.hw, ex: e.dx, ez: e.dz }; }
  }
  if (!best || best.d < 1) return null;
  const nx = (x - best.qx) / best.d, nz = (z - best.qz) / best.d;
  // step in from the kerb until the pole is off the pavement and clear of walls
  for (let back = best.hw + 5; back < Math.min(best.d, 60); back += 2) {
    const px = best.qx + nx * back, pz = best.qz + nz * back;
    if (city.onRoad(px, pz, 2)) continue;
    if (city.buildingsNear(px, pz, 12).some((b) => {
      const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = px - b.x, dz = pz - b.z;
      return b.h > 0.5 && Math.abs(dx * c + dz * s) < b.w / 2 + 2.5 && Math.abs(-dx * s + dz * c) < b.d / 2 + 2.5;
    })) continue;
    // the flag flies along the street, away from the building's side
    return { x: px, z: pz, ux: best.ex, uz: best.ez, big };
  }
  return null;
}

/** landmarks.js extra: every flag in kw.json, on its pole. */
export function buildFlags(ctx, kw) {
  // the Ford dealer's flag too: OSM files it as a garage, not a car dealer
  const list = [...((kw && kw.flags) || []), [FORD[0], FORD[1], 'car']];
  const mat = flagMaterial();
  const poles = new Map(), cloth = new Map();
  const POLE = lin([0.82, 0.83, 0.85]), BALL = lin([0.85, 0.70, 0.30]);
  const placed = [];
  let n = 0;
  for (const [x, z, kind] of list) {
    const big = kind === 'car';
    const s = flagSite(ctx.city, x, z, big);
    if (!s || G.waterLevel(s.x, s.z) > 0) continue;
    if (placed.some(([px, pz]) => Math.hypot(px - s.x, pz - s.z) < (big ? 60 : 25))) continue;
    placed.push([s.x, s.z]);
    const k = ckey(s.x, s.z);
    let P = poles.get(k); if (!P) poles.set(k, (P = new Builder(false)));
    let C = cloth.get(k); if (!C) cloth.set(k, (C = new Builder(true)));
    const y0 = G.terrainHeight(s.x, s.z);
    const H = big ? 22 : 9, FW = big ? 9 : 1.8, FH = FW / 2;
    const r = big ? 0.2 : 0.07;
    P.box(s.x, y0 - 0.3, s.z, r * 2, H + 0.6, r * 2, 0, POLE);
    P.box(s.x, y0 + H + 0.3, s.z, r * 3, r * 3, r * 3, 0, BALL);
    ctx.solids.push({ x: s.x, z: s.z, r: r + 0.1, y0: y0 - 1, y1: y0 + H });
    // the cloth: hoisted at the top, flying along the street, in strips so the
    // wave has vertices to bend
    const top = y0 + H, SEG = 6;
    for (let i = 0; i < SEG; i++) {
      const u0 = i / SEG, u1 = (i + 1) / SEG;
      const ax = s.x + s.ux * (r + FW * u0), az = s.z + s.uz * (r + FW * u0);
      const bx = s.x + s.ux * (r + FW * u1), bz = s.z + s.uz * (r + FW * u1);
      C.quad([ax, top, az], [bx, top, bz], [bx, top - FH, bz], [ax, top - FH, az], [-s.uz, 0, s.ux], [u0, 1, u1, 1, u1, 0, u0, 0], [1, 1, 1]);
    }
    n++;
  }
  const pm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 });
  for (const [k, P] of poles) {
    if (P.empty) continue;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(P.build(), pm));
    const C = cloth.get(k);
    if (C && !C.empty) {
      const cm = new THREE.Mesh(C.build(), mat);
      cm.userData.keepUv = true;
      g.add(cm);
    }
    ctx.addTo(k, g);
  }
  if (kw) kw.flagStats = { flags: n, of: list.length };
}

// --- KW Surplus ------------------------------------------------------------------------

/** The building's box, the lawn between it and Victoria St, and its roof. */
export function surplusSite(city) {
  const b = boxAt(city, KW_SURPLUS[0], KW_SURPLUS[1], 6);
  const cx = b ? b.x : KW_SURPLUS[0], cz = b ? b.z : KW_SURPLUS[1];
  let best = null;
  for (const ei of city.edgesNear(cx, cz, 120)) {
    const e = city.edges[ei];
    if (e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp') continue;
    if (e.name && !/Victoria/.test(e.name)) continue;
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(e.len, (cx - a.x) * e.dx + (cz - a.z) * e.dz));
    const qx = a.x + e.dx * t, qz = a.z + e.dz * t, d = Math.hypot(cx - qx, cz - qz);
    if (!best || d < best.d) best = { qx, qz, d, hw: e.hw, ex: e.dx, ez: e.dz };
  }
  if (!best) return null;
  const nx = (cx - best.qx) / best.d, nz = (cz - best.qz) / best.d;
  // the tank: on the lawn, nose to the street, its long axis along it
  let tank = null;
  for (let back = best.hw + 7; back < best.d; back += 1.5) {
    const x = best.qx + nx * back, z = best.qz + nz * back;
    if (city.onRoad(x, z, 4)) continue;
    tank = { x, z, heading: Math.atan2(-nx, -nz) };
    break;
  }
  return { box: b, tank, roofY: b ? G.terrainHeight(cx, cz) + b.h : null };
}

// --- open ground ---------------------------------------------------------------------

/**
 * The nearest clear patch of grass to (x, z) within R: `clear` metres from any
 * building, street, water and wood, and near level. A ring search on a 10 m
 * grid; null if nothing qualifies.
 */
export function openGround(city, waterAt, x, z, R, clear) {
  const ok = (px, pz) => {
    if (Math.abs(px) > G.MAP_HALF - 200 || Math.abs(pz) > G.MAP_HALF - 200) return false;
    if (G.greenKind(px, pz) === G.GREEN_WOOD) return false;
    if (city.onRoad(px, pz, clear * 0.6)) return false;
    for (const ei of city.edgesNear(px, pz, clear)) {
      const e = city.edges[ei], a = city.nodes[e.a];
      const t = Math.max(0, Math.min(e.len, (px - a.x) * e.dx + (pz - a.z) * e.dz));
      if (Math.hypot(px - a.x - e.dx * t, pz - a.z - e.dz * t) < clear * 0.6 + e.hw) return false;
    }
    if (city.buildingsNear(px, pz, clear + 30).some((b) => Math.hypot(b.x - px, b.z - pz) < clear + Math.max(b.w, b.d) / 2)) return false;
    const h0 = G.terrainHeight(px, pz);
    for (const [dx, dz] of [[clear, 0], [-clear, 0], [0, clear], [0, -clear]]) {
      if (waterAt(px + dx, pz + dz) !== null) return false;
      if (Math.abs(G.terrainHeight(px + dx, pz + dz) - h0) > clear * 0.08) return false;
    }
    return waterAt(px, pz) === null;
  };
  for (let r = 0; r <= R; r += 10) {
    const n = Math.max(1, Math.round((2 * Math.PI * r) / 10));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, z: pz, heading: 0 };
    }
  }
  return null;
}

// --- Parkway Ford Lincoln, 455 King St N -----------------------------------------------

const FORD = [-4366, -4117];
let ford = null;   // { b, face: { x, z, nx, nz, len }, road: { qx, qz, ex, ez, hw } }

/** Before meshing: the dealership's box gets a showroom's look (white, glass). */
export function prepFord(city) {
  const b = boxAt(city, FORD[0], FORD[1], 4);
  if (!b) return;
  if (!b.kw) b.kw = {};
  b.kw.fam = { m: 'glass', c: [0.86, 0.88, 0.92], u: 14, v: 13.6 };
  b.h = Math.max(b.h, 8.5);
  // King St: the nearest named King Street edge; the showroom faces it
  let road = null;
  for (const ei of city.edgesNear(b.x, b.z, 160)) {
    const e = city.edges[ei];
    if (!e.name || !/^King Street/.test(e.name) || e.elev || e.tunnel) continue;
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(e.len, (b.x - a.x) * e.dx + (b.z - a.z) * e.dz));
    const qx = a.x + e.dx * t, qz = a.z + e.dz * t, d = Math.hypot(b.x - qx, b.z - qz);
    if (!road || d < road.d) road = { qx, qz, d, ex: e.dx, ez: e.dz, hw: e.hw };
  }
  if (!road) return;
  // the box's face toward King St
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const faces = [[c, s, b.w / 2, b.d], [-c, -s, b.w / 2, b.d], [-s, c, b.d / 2, b.w], [s, -c, b.d / 2, b.w]];
  const tx = (road.qx - b.x) / road.d, tz = (road.qz - b.z) / road.d;
  let face = null;
  for (const [nx, nz, off, len] of faces) {
    const dot = nx * tx + nz * tz;
    if (!face || dot > face.dot) face = { dot, x: b.x + nx * off, z: b.z + nz * off, nx, nz, len, off };
  }
  ford = { b, face, road };
}

/** landmarks.js extra: its signs -- the fascia over the showroom and a pylon at King St. */
export function buildFord(ctx) {
  if (!ford || !ctx.atlas) return;
  const { b, face: f, road } = ford;
  const g = new THREE.Group();
  const y0 = G.terrainHeight(f.x + f.nx * 3, f.z + f.nz * 3);
  // the fascia: the name in white on Ford blue across the top of the showroom
  const fas = ctx.atlas.text('PARKWAY  FORD  LINCOLN', Math.min(24, f.len * 0.6), 1.7, '#133a7c', '#ffffff', {});
  fas.position.set(f.x + f.nx * 0.2, y0 + b.h - 1.2, f.z + f.nz * 0.2);
  fas.rotation.y = Math.atan2(f.nx, f.nz);
  g.add(fas);
  // a blue band and a glass showroom front under it
  const B = new Builder(false);
  const ax = -f.nz, az = f.nx, hl = f.len / 2 - 0.5;
  const P = (t, y, o) => [f.x + ax * t + f.nx * o, y, f.z + az * t + f.nz * o];
  const BLUE = lin([0.07, 0.23, 0.49]), GLASS = lin([0.22, 0.30, 0.38]), MULL = lin([0.85, 0.86, 0.88]);
  B.quad(P(-hl, y0 + b.h - 0.2, 0.12), P(hl, y0 + b.h - 0.2, 0.12), P(hl, y0 + b.h - 2.2, 0.12), P(-hl, y0 + b.h - 2.2, 0.12), [f.nx, 0, f.nz], U0, BLUE);
  B.quad(P(-hl * 0.8, y0 + 5.6, 0.1), P(hl * 0.8, y0 + 5.6, 0.1), P(hl * 0.8, y0 + 0.1, 0.1), P(-hl * 0.8, y0 + 0.1, 0.1), [f.nx, 0, f.nz], U0, GLASS);
  for (let t = -hl * 0.8; t <= hl * 0.8 + 0.01; t += 3.2) {
    B.quad(P(t - 0.07, y0 + 5.6, 0.14), P(t + 0.07, y0 + 5.6, 0.14), P(t + 0.07, y0 + 0.1, 0.14), P(t - 0.07, y0 + 0.1, 0.14), [f.nx, 0, f.nz], U0, MULL);
  }
  const m = new THREE.Mesh(B.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2 }));
  g.add(m);
  // the pylon at the street, its panel on both faces
  const px = road.qx + (f.x - road.qx) * 0 + (b.x - road.qx) / road.d * (road.hw + 4);
  const pz = road.qz + (b.z - road.qz) / road.d * (road.hw + 4);
  const py = G.terrainHeight(px, pz);
  if (!ctx.city.onRoad(px, pz, 0.5)) {
    const yaw = Math.atan2(road.ex, road.ez) + Math.PI / 2;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.4, metalness: 0.6 }));
    post.position.set(px, py + 3.5, pz);
    g.add(post);
    for (const sgn of [1, -1]) {
      const pn = ctx.atlas.text('FORD\nPARKWAY', 3.6, 2.4, '#133a7c', '#ffffff', {});
      pn.position.set(px + Math.sin(yaw) * 0.3 * sgn, py + 7.6, pz + Math.cos(yaw) * 0.3 * sgn);
      pn.rotation.y = yaw + (sgn < 0 ? Math.PI : 0);
      g.add(pn);
    }
    ctx.solids.push({ x: px, z: pz, r: 0.4, y0: py - 1, y1: py + 9 });
  }
  ctx.addTo(ckey(b.x, b.z), g);
}

/**
 * The cars for sale: rows on the lot between the showroom and King St, nose
 * out to the street. [x, z, heading, type, colour]
 */
export function fordLot(city) {
  if (!ford) return [];
  const { b, face: f, road } = ford;
  const ax = -f.nz, az = f.nx, out = [];
  const TYPES = ['pickup', 'pickup', 'suv', 'suv', 'sports', 'pickup', 'suv', 'sedan', 'muscle', 'pickup'];
  const COLS = [0x1d3f8a, 0xf2f2f2, 0x222428, 0xb8bcc2, 0xc0141c, 0x3a4a5c, 0xe8e4da, 0x6a1a1a, 0x1f5a2e, 0x0f0f10];
  const heading = Math.atan2(f.nx, f.nz);
  let k = 0;
  for (let row = 0; row < 3; row++) {
    const o = 7 + row * 6.5;
    for (let t = -f.len / 2 + 3; t <= f.len / 2 - 3; t += 3.4) {
      const x = f.x + f.nx * o + ax * t, z = f.z + f.nz * o + az * t;
      if (city.onRoad(x, z, 1.5)) continue;
      if (Math.hypot(x - road.qx, z - road.qz) < road.hw + 3) continue;
      if (city.buildingsNear(x, z, 10).some((o2) => o2 !== b && o2.h > 0.5 && Math.hypot(o2.x - x, o2.z - z) < Math.max(o2.w, o2.d) / 2 + 2)) continue;
      out.push([x, z, heading, TYPES[k % TYPES.length], COLS[(k * 7) % COLS.length]]);
      k++;
    }
  }
  return out;
}

export const fordSpot = () => (ford ? { x: ford.face.x + ford.face.nx * 6, z: ford.face.z + ford.face.nz * 6 } : null);
