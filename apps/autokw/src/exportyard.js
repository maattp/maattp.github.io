// Auto KW: IMPORT / EXPORT -- GTA's wanted list, at a real Kitchener auto
// recycler: Parkway Auto Recyclers on Manitou Drive (OSM way 68282593,
// landuse=industrial, "Parkway Auto Recyclers", by the Hwy 8 / Fairway
// interchange).
//
//   - THE LIST: twelve road types taken from what really drives about (six
//     common ones out of the CIVILIAN_TYPES mix, four less common ones and
//     two rare: a DeLorean, a limo, the ice-cream truck, the Wienermobile...),
//     painted on a big WANTED board at the yard's gate and shown in the pause
//     menu's passport. A new list goes up every Monday (the real calendar
//     week, as the game's calendar is real) and the moment one is finished.
//     Saved in localStorage `autokw-export`.
//   - DELIVER: drive a wanted type onto the yard's drop-off bay and stop. The
//     yard checks it: not on the list, already bought this week, a wreck
//     (burning, dead or under 20 % health), a job vehicle mid-job, a car with
//     the law on your tail, one of the yard's own gift cars, one still parked
//     in your garage -- each is refused with a toast and nothing happens.
//     Otherwise you are put on foot beside the bay, the price (scaled by the
//     car's health, 40 % .. 100 %) is paid, the list is ticked, and the crane's
//     magnet comes down, lifts the car, slews it over the crusher and drops
//     it in; the ram comes down (hiss, crunch, glass, dust), and the car is
//     gone. The whole thing is a per-site sequence: NOTHING is held
//     (`game.hold` unused), the world runs, the car is set to mode 'path'
//     (traffic leaves it alone) and `dead` (nobody can get back in).
//   - THE WHOLE LIST: a $3,000 bonus and, the first time, the yard's thank-you:
//     a GOLD DeLorean parked by the gate for you, every visit from then on
//     (an 'apron' car, spawned within SPAWN_R; drive it away and it is yours,
//     and another stands there next time). The yard will not buy it back.
//
// Phone cost: nothing until you are within BUILD_R; then 3 draws (the yard as
// one vertex-coloured mesh, the moving rig -- jib, cable, magnet, ram -- as
// ONE dynamic mesh whose 520 vertices are rewritten only while it moves, and
// the board's canvas), shown within SHOW_R. Per frame: one distance check.
//
// Harness: __dbg.exportYard (`sites`, `st`, `list()`,
// `seq`, `prize`, `refusal(v)`, `newList(wk, roll)`), probe tools/kw/exportprobe.mjs.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { clamp, formatMoney } from './util.js';
import { typeName } from './kwgarage.js';

const KEY = 'autokw-export';
const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
const BUILD_R = 650, SHOW_R = 450, SPAWN_R = 320, RELEASE_R = 480;
const NLIST = 12;
const BONUS = 3000;
export const GOLD = 0xd9a82e;

// The yard, in yard-local metres: lx across the frontage (+ to the right as you
// face in from the street), lz in from the mouth. The mouth is MOUTH_OFF past
// the street's edge.
const MOUTH_OFF = 2.6;
const X0 = -9.6, X1 = 13.2, DEPTH = 17.8;          // the footprint
const BAY_W = 7.0, BAY_D = 11.0;                   // the drop-off bay, centred on lx 0
const IN_X = 2.6, IN_Z0 = 2.4, IN_Z1 = 9.8;         // the car's centre inside this: it is in
const MX = 8.0, MZ = 5.5, JH = 11.0, JR = 8.0;      // the crane's mast (x, z), jib height and radius
const CX = MX, CZ = MZ + JR;                       // the crusher's chamber centre (the jib's other stop)
const CH_W = 7.6, CH_D = 3.6, CH_H = 1.25;          // the chamber: inner length (along lx), width, wall height
const RAM_UP = 4.6, RAM_DOWN = 0.75;               // the ram's underside above the yard, raised and down
const YAW_BAY = Math.PI, YAW_CRUSH = Math.PI / 2;  // the jib's direction (cos, sin) in (lx, lz)
const HOOK_REST = 3.2;                             // cable length at rest
const MAG_DROP = 0.85 + 0.75;                      // jib top -> the magnet's underside, at cable length 0
const DWELL = 0.8;
const PRIZE_AT = [8.6, 1.7];                        // where the gift car stands (lx, lz), along the frontage

// The real place: the yard's frontage on Manitou Drive (world metres, tools/kw/proj.py)
export const YARD = {
  id: 'parkway', name: 'Parkway Auto Recyclers', sub: 'IMPORT · EXPORT', street: 'Manitou Drive', x: 1838, z: 3880,
  // the OSM polygon (way 68282593), for the record and the probe
  poly: [[1627, 3954], [1734, 3962], [1807, 3974], [1877, 3993], [1822, 3925], [1802, 3896], [1827, 3870], [1863, 3853], [1847, 3834], [1742, 3850], [1693, 3849], [1658, 3846]],
};

// What the yard is after: what drives past in Waterloo Region (traffic.js CIVILIAN_TYPES and
// varietyOf's odd ones out), by how often you will see one. Each with a base price.
const POOL = {
  common: ['crossover', 'suv', 'suv3', 'pickup', 'pickupcap', 'compsedan', 'sedan', 'minivan', 'hatch', 'civic', 'wagon', 'ev', 'evy', 'van'],
  uncommon: ['jeep', 'dually', 'compact', 'postvan', 'purovan', 'uhaul', 'muscle', 'sports', 'convertible', 'taxi', 'smart', 'volvo', 'lifted', 'farmtruck', 'amzvan', 'wedge'],
  rare: ['limo', 'hearse', 'delorean', 'icecream', 'wiener'],
};
const TAKE = { common: 6, uncommon: 4, rare: 2 };
const PRICE = { common: [180, 320], uncommon: [420, 760], rare: [1200, 2400] };
const TIER = {};
for (const k in POOL) for (const t of POOL[k]) TIER[t] = k;

/** The real calendar week (Monday to Sunday, local time) as a number. */
export function weekOf(date = new Date()) {
  const days = Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);
  return Math.floor((days + 3) / 7);   // (1 Jan 1970 was a Thursday)
}
function weekStart(wk) {
  const d = new Date((wk * 7 - 3) * 86400000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** A list for (week, roll): 12 types, each with its price. `types`: the types the game has (TYPES). */
export function makeList(wk, roll, types) {
  const R = rng(wk * 7919 + roll * 104729 + 17);
  const out = [];
  for (const tier of ['common', 'uncommon', 'rare']) {
    const pool = POOL[tier].filter((t) => !types || types[t]);
    for (let i = 0; i < TAKE[tier] && pool.length; i++) {
      const t = pool.splice(Math.floor(R() * pool.length), 1)[0];
      const [lo, hi] = PRICE[tier];
      out.push({ t, tier, p: Math.round((lo + R() * (hi - lo)) / 10) * 10 });
    }
  }
  return out;
}

function read() {
  try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
}

const ZERO_UV = [0, 0, 0, 0, 0, 0, 0, 0];
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/**
 * Where the yard stands (respray.js placeBays' search, the garage's footprint grown to a yard): the
 * clear frontage on its street nearest YARD's point, mouth to the street, off the carriageway, out of
 * every building, dry, clear of ramps / tracks / landmarks, the slope across it tolerated to 2.8 m
 * (the yard follows the ground: the surfaces are draped, each structure stands on its own footing). Pushes the
 * clear circles so no tree or kerbside car is scattered into it. Called at boot, before any chunk.
 */
export function placeYard(city, waterAt, sh = YARD) {
  const wet = (x, z) => {
    if (G.isWater(x, z)) return true;
    if (!waterAt) return false;
    const w = waterAt(x, z);
    return w !== null && w > G.terrainHeight(x, z) + 0.05;
  };
  const bl = city.buildingsNear(sh.x, sh.z, 330);
  const inB = (x, z, pad) => {
    for (const b of bl) {
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx * c - dz * s) < b.w / 2 + pad && Math.abs(dx * s + dz * c) < b.d / 2 + pad) return true;
    }
    return false;
  };
  const eds = city.edgesNear(sh.x, sh.z, 260).map((ei) => {
    const e = city.edges[ei];
    if (e.elev || e.tunnel || e.noTraffic || e.cls === 'hwy' || e.cls === 'ramp') return null;
    if (sh.street && e.name !== sh.street) return null;
    const a = city.nodes[e.a];
    const t = clamp((sh.x - a.x) * e.dx + (sh.z - a.z) * e.dz, 0, e.len);
    return { e, a, d: Math.hypot(sh.x - (a.x + e.dx * t), sh.z - (a.z + e.dz * t)) };
  }).filter(Boolean).sort((p, q) => p.d - q.d).slice(0, 16);
  let best = null;
  for (const tol of [2.8]) {
    for (const c of eds) {
      const e = c.e;
      for (let t = 4; t <= e.len - 4; t += 3) {
        const qx = c.a.x + e.dx * t, qz = c.a.z + e.dz * t;
        if (Math.hypot(qx - sh.x, qz - sh.z) > 320) continue;
        for (const side of [1, -1]) {
          const nx = -e.dz * side, nz = e.dx * side;
          const ox = qx + nx * (e.hw + MOUTH_OFF), oz = qz + nz * (e.hw + MOUTH_OFF);
          const score0 = Math.hypot(ox + nx * DEPTH / 2 - sh.x, oz + nz * DEPTH / 2 - sh.z);
          if (best && score0 >= best.score) continue;
          const rot = Math.atan2(-nx, nz);
          const cr = Math.cos(rot), sr = Math.sin(rot);
          const P = (lx, lz) => [ox + lx * cr - lz * sr, oz + lx * sr + lz * cr];
          let ok = true, lo = Infinity, hi = -Infinity;
          for (let lz = -0.4; lz <= DEPTH + 0.6 && ok; lz += 1.6) {
            for (let lx = X0 - 0.5; lx <= X1 + 0.5; lx += 1.6) {
              const [px, pz] = P(lx, lz);
              if (city.onRoad(px, pz, 0.3, true, false) || inB(px, pz, 0.5) || city.jumpClear(px, pz) || wet(px, pz)) { ok = false; break; }
              if (city.landmarkHit && city.landmarkHit(px, pz, 0.6, G.terrainHeight(px, pz) + 1, true)) { ok = false; break; }
              if (city.barrierHit && city.barrierHit(px, pz, 0.6, G.terrainHeight(px, pz) + 1)) { ok = false; break; }
              const y = G.terrainHeight(px, pz);
              lo = Math.min(lo, y); hi = Math.max(hi, y);
            }
          }
          if (!ok || hi - lo > tol) continue;
          // the approach to the bay: from the kerb to the mouth, a car and a half wide
          for (let lz = -MOUTH_OFF; lz < -0.4 && ok; lz += 1.0) {
            for (const lx of [-3.2, -1.6, 0, 1.6, 3.2]) {
              const [px, pz] = P(lx, lz);
              if (inB(px, pz, 0.6) || wet(px, pz)) { ok = false; break; }
              if (city.barrierHit && city.barrierHit(px, pz, 0.7, G.terrainHeight(px, pz) + 1)) { ok = false; break; }
              if (city.landmarkHit && city.landmarkHit(px, pz, 0.7, G.terrainHeight(px, pz) + 1, true)) { ok = false; break; }
            }
          }
          if (!ok) continue;
          const score = score0 + (hi - lo) * 12;
          if (!best || score < best.score) best = { score, ox, oz, nx, nz, rot, lo, hi, y: hi, slope: hi - lo, dist: score0, street: e.name };
        }
      }
    }
    if (best) break;
  }
  if (!best) return null;
  siteHeights(best);
  const P = (lx, lz) => [best.ox + lx * Math.cos(best.rot) - lz * Math.sin(best.rot), best.oz + lx * Math.sin(best.rot) + lz * Math.cos(best.rot)];
  if (!city.clearCircles) city.clearCircles = [];
  for (const [lx, lz, r] of [[-4.8, 5, 8], [-4.8, 13, 8], [4.8, 5, 8], [8, 13, 8], [1.5, 15, 6], [0, -3, 5]]) {
    const [x, z] = P(lx, lz);
    city.clearCircles.push([x, z, r]);
  }
  return best;
}

/** Where each structure stands: the highest ground under its footprint (and the lowest, for its footing). */
export function groundUnder(s, lx, lz, w, d) {
  const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
  let hi = -Infinity, lo = Infinity;
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
    const ax = lx + (i - 1) * w / 2, az = lz + (j - 1) * d / 2;
    const y = G.terrainHeight(s.ox + ax * cr - az * sr, s.oz + ax * sr + az * cr);
    if (y > hi) hi = y; if (y < lo) lo = y;
  }
  return { hi: hi + 0.02, lo };
}
function siteHeights(s) {
  s.crane = groundUnder(s, MX, MZ, 2.6, 2.6);
  s.crush = groundUnder(s, CX, CZ, CH_W + 1.4, CH_D + 1.4);
  s.office = groundUnder(s, -7.6, 9.5, 3.0, 6.0);
  s.bales = groundUnder(s, -1.0, 15.4, 6.8, 3.2);
  s.board = groundUnder(s, -6.6, 1.0, BOARD_W, 0.6);
  s.y = s.crane.hi;
}

// --- the board ---------------------------------------------------------------------

const BOARD_W = 4.6, BOARD_H = 5.6, BOARD_Y = 1.5;   // metres; the canvas is 512 x 624 (the same aspect)

function drawBoard(g, list, got, wk, done) {
  const W = 512, H = 624;
  g.fillStyle = '#f2ead2'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1d1d1f'; g.fillRect(0, 0, W, 116);
  g.fillStyle = '#e8b91c';
  for (let x = -40; x < W; x += 40) { g.beginPath(); g.moveTo(x, 116); g.lineTo(x + 20, 116); g.lineTo(x + 40, 104); g.lineTo(x + 20, 104); g.fill(); }
  g.fillStyle = '#d42a1e'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 72px system-ui, sans-serif';
  g.fillText('WANTED', W / 2, 50);
  g.fillStyle = '#f2ead2'; g.font = '700 21px system-ui, sans-serif';
  g.fillText('PARKWAY AUTO RECYCLERS  ·  EXPORT', W / 2, 92);
  const ws = weekStart(wk);
  g.fillStyle = '#4a4438'; g.font = '600 19px system-ui, sans-serif';
  g.fillText(`WEEK OF ${ws.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }).toUpperCase()}  ·  ${done}/${list.length} IN`, W / 2, 140);
  g.textAlign = 'left';
  const top = 164, rowH = 36.5;
  list.forEach((it, i) => {
    const y = top + i * rowH + rowH / 2;
    const have = got.includes(it.t);
    g.strokeStyle = '#3a352b'; g.lineWidth = 3; g.strokeRect(26, y - 12, 24, 24);
    if (have) {
      g.strokeStyle = '#1f8a3a'; g.lineWidth = 5; g.beginPath(); g.moveTo(29, y); g.lineTo(37, y + 9); g.lineTo(55, y - 15); g.stroke();
    }
    g.fillStyle = have ? '#8a8270' : it.tier === 'rare' ? '#b3261a' : '#1d1d1f';
    g.font = `${it.tier === 'rare' ? 800 : 700} 25px system-ui, sans-serif`;
    const nm = typeName(it.t).toUpperCase();
    g.fillText(nm, 66, y + 1);
    if (have) { const w = g.measureText(nm).width; g.fillRect(64, y + 1, w + 4, 3); }
    g.textAlign = 'right'; g.font = '700 23px system-ui, sans-serif';
    g.fillStyle = have ? '#1f8a3a' : '#4a4438';
    g.fillText(have ? 'IN' : '$' + it.p.toLocaleString('en-CA'), W - 26, y + 1);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(22, y + rowH / 2 - 1, W - 44, 2);
  });
  g.fillStyle = '#4a4438'; g.font = '600 17px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('DRIVE IN · STOP ON THE BAY · NO WRECKS', W / 2, H - 22);
  g.strokeStyle = '#1d1d1f'; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8);
}

// --- the rig: the parts that move, ONE mesh --------------------------------------------
//
// Each part is built once in its own frame and copied out on every rewrite:
//   'jib'   (u along the jib, v across, h up from the jib's top) turned by the yaw about the mast
//   'cable' (a unit box hanging from the trolley, 0 .. -1) turned by the yaw, scaled by its length
//   'mag'   (the magnet) turned by the yaw, hung at -length
//   'ram'   (the crusher's ram) raised by its height
// then yard-local -> world. Positions AND normals are rewritten (the yaw turns them).

function rigParts() {
  const parts = [];
  const add = (kind, fill) => { const B = new Builder(false); fill(B); parts.push({ kind, B }); };
  const steel = lin(0xe7b416), dark = [0.12, 0.12, 0.13], glass = [0.20, 0.30, 0.36], conc = [0.42, 0.42, 0.41], rust = lin(0x6b4a33);
  add('jib', (B) => {
    // the boom (two chords and a deck), the counter-jib, its weight, the cab, the trolley at JR
    B.box(JR / 2 - 1.6, -0.55, 0, JR + 3.6, 0.55, 0.9, 0, steel);
    B.box(JR / 2 - 1.6, 0.0, 0, JR + 3.2, 0.12, 0.25, 0, steel);
    for (let u = -1.2; u < JR + 1.6; u += 1.4) B.box(u, -0.5, 0, 0.12, 0.62, 0.12, 0, steel);
    B.box(-3.8, -0.4, 0, 3.0, 0.4, 1.0, 0, steel);
    B.box(-4.6, -1.5, 0, 1.6, 1.2, 1.6, 0, conc);
    B.box(0, -2.5, 0, 1.9, 2.0, 1.9, 0, steel);
    B.box(0.75, -2.1, 0, 0.45, 1.0, 1.6, 0, glass);
    B.box(0, 0.12, 0, 0.5, 2.4, 0.5, 0, steel);                       // the A-frame peak
    B.box(JR, -0.85, 0, 1.0, 0.3, 1.1, 0, dark);                       // the trolley
  });
  add('cable', (B) => { B.box(0, -1, 0, 0.08, 1, 0.08, 0, dark); B.box(0, -1, 0.35, 0.06, 1, 0.06, 0, dark); B.box(0, -1, -0.35, 0.06, 1, 0.06, 0, dark); });
  add('mag', (B) => {
    B.box(0, -0.45, 0, 0.9, 0.45, 0.9, 0, dark);
    B.box(0, -0.75, 0, 1.9, 0.3, 1.9, 0, [0.22, 0.22, 0.24]);
    B.box(0, -0.62, 0, 2.0, 0.06, 2.0, 0, steel);
  });
  add('ram', (B) => {
    B.box(0, 0, 0, CH_W - 0.4, 0.55, CH_D - 0.4, 0, [0.30, 0.30, 0.32]);
    B.box(0, 0.55, 0, CH_W - 1.2, 0.25, CH_D - 1.0, 0, rust);
    for (const sx of [-1, 1]) B.box(sx * (CH_W / 2 - 1.2), 0.55, 0, 0.5, 3.4, 0.5, 0, [0.75, 0.76, 0.78]);   // the cylinders' rods
  });
  return parts;
}

class Rig {
  constructor(site, mat) {
    this.s = site;
    const parts = rigParts();
    let nv = 0, ni = 0;
    for (const p of parts) { p.v0 = nv; p.n = p.B.pos.length / 3; nv += p.n; ni += p.B.idx.length; }
    this.basePos = new Float32Array(nv * 3); this.baseNor = new Float32Array(nv * 3);
    const col = new Float32Array(nv * 3), idx = new Uint16Array(ni);
    let k = 0;
    for (const p of parts) {
      this.basePos.set(p.B.pos, p.v0 * 3); this.baseNor.set(p.B.nor, p.v0 * 3); col.set(p.B.col, p.v0 * 3);
      for (const i of p.B.idx) idx[k++] = i + p.v0;
      p.B = null;
    }
    this.parts = parts;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.nor = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos); geo.setAttribute('normal', this.nor);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const [cx, cz] = this.w(MX - 2, MZ + 3);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, site.crane.hi + 6, cz), 17);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = !ON_PHONE; this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.yaw = YAW_BAY; this.len = HOOK_REST; this.ram = RAM_UP;
    this.write();
  }

  w(lx, lz) { const s = this.s, cr = Math.cos(s.rot), sr = Math.sin(s.rot); return [s.ox + lx * cr - lz * sr, s.oz + lx * sr + lz * cr]; }

  /** The hook's point under the trolley (world x, z) and the magnet's underside (y). */
  hook() {
    const lx = MX + JR * Math.cos(this.yaw), lz = MZ + JR * Math.sin(this.yaw);
    const [x, z] = this.w(lx, lz);
    return { x, z, y: this.s.crane.hi + JH - MAG_DROP - this.len };
  }

  set(yaw, len, ram) {
    if (yaw === this.yaw && len === this.len && ram === this.ram) return;
    this.yaw = yaw; this.len = len; this.ram = ram;
    this.write();
  }

  write() {
    const s = this.s, cr = Math.cos(s.rot), sr = Math.sin(s.rot), yc = s.crane.hi, yk = s.crush.hi;
    const ca = Math.cos(this.yaw), sa = Math.sin(this.yaw);
    const P = this.pos.array, N = this.nor.array, BP = this.basePos, BN = this.baseNor;
    for (const p of this.parts) {
      const a = p.v0 * 3, b = a + p.n * 3;
      for (let i = a; i < b; i += 3) {
        let u = BP[i], h = BP[i + 1], v = BP[i + 2], nu = BN[i], nh = BN[i + 1], nv = BN[i + 2];
        let lx, ly, lz, nlx, nlz;
        if (p.kind === 'ram') {
          lx = CX + u; lz = CZ + v; ly = this.ram + h; nlx = nu; nlz = nv;
        } else {
          if (p.kind === 'cable') { h = h * this.len; u += JR; h -= 0.85; }
          else if (p.kind === 'mag') { u += JR; h -= 0.85 + this.len; }
          lx = MX + u * ca - v * sa; lz = MZ + u * sa + v * ca; ly = JH + h;
          nlx = nu * ca - nv * sa; nlz = nu * sa + nv * ca;
        }
        P[i] = s.ox + lx * cr - lz * sr; P[i + 1] = (p.kind === 'ram' ? yk : yc) + ly; P[i + 2] = s.oz + lx * sr + lz * cr;
        N[i] = nlx * cr - nlz * sr; N[i + 1] = nh; N[i + 2] = nlx * sr + nlz * cr;
      }
    }
    this.pos.needsUpdate = true; this.nor.needsUpdate = true;
  }

  dispose() { this.mesh.geometry.dispose(); }
}

// --- the yard ------------------------------------------------------------------------

export class ExportYard {
  /** o: { scene, city, game, hud, audio, fx, traffic, types, busy: () => bool, site: placeYard(...) } */
  constructor(o) {
    this.scene = o.scene; this.city = o.city; this.game = o.game; this.hud = o.hud; this.audio = o.audio; this.fx = o.fx;
    this.traffic = o.traffic; this.types = o.types || null; this.busy = o.busy || (() => false);
    this.load();
    this.sites = [];
    this.seq = null;
    this.prize = null;
    if (o.site) {
      const s = o.site;
      const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
      const W = (lx, lz) => [s.ox + lx * cr - lz * sr, s.oz + lx * sr + lz * cr];
      const solids = [];
      // fences, the crusher, the crane's base, the office, the stack of bales (y0 .. y1 from the yard's low point)
      const box = (lx, lz, hw, hd, base, h) => { const [x, z] = W(lx, lz); solids.push({ x, z, hw, hd, rot: s.rot, y0: s.lo - 1, y1: base + h }); };
      box(X0 + 0.1, (2 + DEPTH) / 2, 0.15, (DEPTH - 2) / 2, s.hi, 2.4);
      box(X1 - 0.1, (2 + DEPTH) / 2, 0.15, (DEPTH - 2) / 2, s.hi, 2.4);
      box((X0 + X1) / 2, DEPTH - 0.1, (X1 - X0) / 2, 0.15, s.hi, 2.4);
      box(CX, CZ, CH_W / 2 + 0.5, CH_D / 2 + 0.5, s.crush.hi, CH_H + 0.4);
      box(MX, MZ, 1.2, 1.2, s.crane.hi, JH);
      box(-7.6, 9.5, 1.5, 3.0, s.office.hi, 2.9);
      box(-1.0, 15.4, 3.4, 1.6, s.bales.hi, 2.2);
      if (this.city.addLandmarkSolids) this.city.addLandmarkSolids(solids);
      const [mx, mz] = W(0, 6);
      this.sites.push({ g: YARD, s, W, mx, mz, built: false, grp: null, rig: null, board: null, boardCtx: null, boardKey: '',
        dwell: 0, told: '', toastAt: 0 });
    }
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.04 });
    this.rigMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.25 });
  }

  // --- the list --------------------------------------------------------------------

  load() {
    const o = read();
    const wk = weekOf();
    this.st = o && Array.isArray(o.list) ? o : { v: 1, wk, roll: 0, list: null, got: [], done: 0, earned: 0, unlocked: false };
    if (!Array.isArray(this.st.got)) this.st.got = [];
    if (this.st.wk !== wk || !this.st.list || !this.st.list.length) this.newList(wk, this.st.wk === wk ? (this.st.roll | 0) : 0, false);
  }

  newList(wk, roll, save = true) {
    this.st.wk = wk; this.st.roll = roll;
    this.st.list = makeList(wk, roll, this.types);
    this.st.got = [];
    if (save) this.save();
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.st)); } catch (e) { /* private mode */ } }

  list() { return this.st.list.map((it) => ({ ...it, name: typeName(it.t), got: this.st.got.includes(it.t) })); }
  get count() { return this.st.got.length; }

  /** Monday rolls a new list (checked now and then, not every frame). */
  checkWeek() {
    const wk = weekOf();
    if (wk !== this.st.wk) { this.newList(wk, 0); if (this.hud) this.hud.showToast('Parkway Auto Recyclers has posted a new wanted list', 3200); }
  }

  places() {
    return this.sites.map((q) => ({
      x: q.mx, z: q.mz, kind: 'export', label: true, name: `${q.g.name} (import/export)`, near: false, hello: () => this.hello(),
    }));
  }

  hello() {
    const left = this.list().filter((r) => !r.got).map((r) => r.name);
    return `${YARD.name} — the wanted list: drive one in and stop on the bay. ${this.count}/${this.st.list.length} in this week${left.length ? '. Still after: ' + left.join(', ') : ''}`;
  }

  /** The pause menu's passport row. */
  passportRows() { return [{ label: 'Export list (this week)', done: this.count, total: this.st.list.length }]; }

  /** The list itself, ticked and unticked, under the passport's grid. */
  listHtml() {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const rows = this.list().map((r) => `<div class="ppRow${r.got ? ' full' : ''}"><span>${r.got ? '&#10003;' : '&#9744;'} ${esc(r.name)}${r.tier === 'rare' ? ' &#9733;' : ''}</span><b>${r.got ? 'in' : '$' + r.p}</b></div>`);
    return `<div class="ppExport" style="grid-column:1/-1;margin-top:6px;font-size:10px;letter-spacing:.03em;display:grid;grid-template-columns:repeat(2,1fr);gap:0 14px">`
      + `<div style="grid-column:1/-1;opacity:.75;margin-bottom:2px">WANTED at ${YARD.name}, Manitou Dr${this.st.unlocked ? ' · the gold DeLorean is waiting for you there' : ' · finish the list for a surprise'}</div>${rows.join('')}</div>`;
  }

  // --- what the yard takes ----------------------------------------------------------

  /** Why a vehicle will not be bought, or '' if it will. */
  refusal(v, player) {
    const s = v.spec, t = v.typeName;
    if (!(s.roadCar) || s.moto || s.bus || s.plane || s.boat || s.rail || s.tank || v.trailer || v.leader || s.len > 8.6) return 'We only buy road cars';
    if (v.exportPrize || (t === 'delorean' && v.bodyMat && v.bodyMat.color.getHex() === GOLD)) return "That one's our gift to you — keep it";
    if (v.garage) return 'That car is still parked in your garage';
    if (this.busy()) return 'Finish the job you are on first';
    if (this.game.wanted > 0) return 'Lose the cops first — we do not take hot cars';
    const it = this.st.list.find((r) => r.t === t);
    if (!it) return `Not on the list — we are not after a ${typeName(t)}`;
    if (this.st.got.includes(t)) return `We already have a ${typeName(t)} this week`;
    const hf = clamp(v.health / (s.hp || 100), 0, 1);
    if (v.dead || v.burnT > 0 || hf < 0.2) return 'That is a wreck — we buy cars, not scrap';
    return '';
  }

  pay(v) {
    const it = this.st.list.find((r) => r.t === v.typeName);
    if (!it) return 0;
    const hf = clamp(v.health / (v.spec.hp || 100), 0, 1);
    return Math.round(it.p * (0.4 + 0.6 * hf) / 5) * 5;
  }

  // --- the building, made when you come near ------------------------------------------

  build(q) {
    q.built = true;
    const s = q.s;
    const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    const B = new Builder(false);
    const L2W = (lx, lz) => [s.ox + lx * cr - lz * sr, s.oz + lx * sr + lz * cr];
    // a box at y0 over `base` (a structure's own ground: s.crane, s.crush...; by default the highest ground under it)
    const bx = (lx, lz, w, d, y0, h, col, at = null) => {
      const [x, z] = L2W(lx, lz);
      const b = at != null ? at : groundUnder(s, lx, lz, w, d).hi;
      B.box(x, b + y0, z, w, h, d, s.rot, col);
    };
    // a structure's concrete footing: from under its lowest ground to its base
    const footing = (lx, lz, w, d, g, col) => { const [x, z] = L2W(lx, lz); B.box(x, g.lo - 0.4, z, w, g.hi - g.lo + 0.42, d, s.rot, col); };
    // a surface draped on the ground: (lx0..lx1, lz0..lz1) in cells of at most `cell` m, `lift` above it
    const drape = (lx0, lx1, lz0, lz1, lift, col, cell = 2.4) => {
      const nx = Math.max(1, Math.ceil((lx1 - lx0) / cell)), nz = Math.max(1, Math.ceil((lz1 - lz0) / cell));
      const pt = (i, j) => { const lx = lx0 + (lx1 - lx0) * i / nx, lz = lz0 + (lz1 - lz0) * j / nz; const [x, z] = L2W(lx, lz); return [x, G.terrainHeight(x, z) + lift, z]; };
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) B.quad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1), [0, 1, 0], ZERO_UV, col);
    };
    const gravel = [0.30, 0.27, 0.23], conc = [0.46, 0.45, 0.43], yellow = lin(0xe8b91c), black = [0.04, 0.04, 0.04], fenceC = lin(0x5d6b5a), fenceDk = lin(0x47523f);
    const rust = [lin(0x7a4a2c), lin(0x5b3a2a), lin(0x8c5a34), lin(0x3f4a52), lin(0x6e6a5e), lin(0x7d2f25), lin(0x2f4f6e)];
    // the yard's gravel, the bay's concrete and its chevrons, the stop bar
    drape(X0, -BAY_W / 2, 0, DEPTH, 0.04, gravel, 3.0);
    drape(BAY_W / 2, X1, 0, DEPTH, 0.04, gravel, 3.0);
    drape(-BAY_W / 2, BAY_W / 2, BAY_D, DEPTH, 0.04, gravel, 3.0);
    drape(-BAY_W / 2, BAY_W / 2, -MOUTH_OFF + 0.4, BAY_D, 0.07, conc);
    for (let i = 0; i < 9; i++) {
      const z0 = 0.3 + i * 1.2;
      for (const sx of [-1, 1]) drape(sx * (BAY_W / 2 - 0.35) - 0.25, sx * (BAY_W / 2 - 0.35) + 0.25, z0, z0 + 0.6, 0.11, i % 2 ? black : yellow, 1);
    }
    drape(-BAY_W / 2 + 0.7, BAY_W / 2 - 0.7, IN_Z1 + 0.3, IN_Z1 + 0.7, 0.11, yellow, 1.5);
    // the fence: corrugated panels on posts, three sides, the front open
    const panel = (lx, lz, len, alongX) => {
      const n = Math.max(1, Math.round(len / 2.4));
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + (i + 0.5) * len / n;
        const px = alongX ? lx + t : lx, pz = alongX ? lz : lz + t;
        const w = alongX ? len / n - 0.04 : 0.1, d = alongX ? 0.1 : len / n - 0.04;
        bx(px, pz, w, d, -0.6, 3.0, i % 2 ? fenceC : fenceDk);
        bx(alongX ? px - len / n / 2 : px, alongX ? pz : pz - len / n / 2, 0.14, 0.14, -0.6, 3.1, [0.25, 0.25, 0.26]);
      }
    };
    panel(X0 + 0.1, (2 + DEPTH) / 2, DEPTH - 2, false);
    panel(X1 - 0.1, (2 + DEPTH) / 2, DEPTH - 2, false);
    panel((X0 + X1) / 2, DEPTH - 0.1, X1 - X0, true);
    // the crane: a lattice mast on a footing (the slewing part is the rig)
    footing(MX, MZ, 2.6, 2.6, s.crane, conc);
    bx(MX, MZ, 2.6, 2.6, 0, 0.5, conc, s.crane.hi);
    const steel = lin(0xe7b416);
    for (const [ax, az] of [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]]) bx(MX + ax, MZ + az, 0.18, 0.18, 0.5, JH - 2.8, steel, s.crane.hi);
    for (let h = 1.2; h < JH - 2.6; h += 1.5) { bx(MX, MZ - 0.6, 1.3, 0.12, h, 0.12, steel, s.crane.hi); bx(MX, MZ + 0.6, 1.3, 0.12, h, 0.12, steel, s.crane.hi); bx(MX - 0.6, MZ, 0.12, 1.3, h, 0.12, steel, s.crane.hi); bx(MX + 0.6, MZ, 0.12, 1.3, h, 0.12, steel, s.crane.hi); }
    bx(MX, MZ, 1.7, 1.7, JH - 2.85, 0.35, [0.2, 0.2, 0.21], s.crane.hi);   // the slewing ring
    // the crusher: a heavy steel tub (the chamber open on top), its top frame on four posts
    const tubC = lin(0x2f5d8a), tubDk = lin(0x24476a);
    footing(CX, CZ, CH_W + 1.4, CH_D + 1.4, s.crush, conc);
    bx(CX, CZ, CH_W + 1.4, CH_D + 1.4, 0, 0.35, [0.18, 0.18, 0.19], s.crush.hi);
    bx(CX, CZ - CH_D / 2 - 0.25, CH_W + 1.0, 0.5, 0.35, CH_H, tubC, s.crush.hi);
    bx(CX, CZ + CH_D / 2 + 0.25, CH_W + 1.0, 0.5, 0.35, CH_H, tubC, s.crush.hi);
    bx(CX - CH_W / 2 - 0.25, CZ, 0.5, CH_D, 0.35, CH_H, tubDk, s.crush.hi);
    bx(CX + CH_W / 2 + 0.25, CZ, 0.5, CH_D, 0.35, CH_H, tubDk, s.crush.hi);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(CX + sx * (CH_W / 2 + 0.3), CZ + sz * (CH_D / 2 + 0.3), 0.4, 0.4, 0.35, RAM_UP + 1.6, tubDk, s.crush.hi);
    for (const sx of [-1, 1]) bx(CX + sx * (CH_W / 2 - 1.2), CZ, 0.9, CH_D + 1.0, RAM_UP + 1.3, 0.5, tubC, s.crush.hi);   // the cylinders' crossheads
    for (const sx of [-1, 1]) bx(CX + sx * (CH_W / 2 - 1.2), CZ, 0.7, 0.7, RAM_UP + 1.8, 1.4, [0.2, 0.2, 0.22], s.crush.hi);   // the cylinders
    bx(CX, CZ + CH_D / 2 + 1.2, 1.4, 0.9, 0.35, 1.2, [0.2, 0.2, 0.2], s.crush.hi);   // the power pack
    bx(CX, CZ - CH_D / 2 - 0.52, CH_W * 0.8, 0.04, 0.6, 0.35, yellow, s.crush.hi);
    // the office: a portable with a door, windows and the company's name band
    footing(-7.6, 9.5, 3.0, 6.0, s.office, conc);
    bx(-7.6, 9.5, 3.0, 6.0, 0, 2.8, lin(0xe9e4d8), s.office.hi);
    bx(-7.6, 9.5, 3.2, 6.2, 2.8, 0.18, [0.3, 0.3, 0.32], s.office.hi);
    bx(-6.08, 8.2, 0.06, 0.9, 0.1, 2.0, lin(0x2f5d8a), s.office.hi);
    bx(-6.08, 10.6, 0.06, 1.6, 1.1, 0.9, [0.18, 0.24, 0.28], s.office.hi);
    bx(-6.08, 9.5, 0.06, 5.6, 2.3, 0.35, lin(0x2f5d8a), s.office.hi);
    // bales of crushed cars, stacked behind the bay, and a row of wrecks along the back fence
    let k = 0;
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
      const lx = -3.6 + (i + row * 0.5) * 1.75, lz = 15.4;
      bx(lx, lz, 1.6, 2.9, row * 0.72, 0.68, rust[(k++ * 3) % rust.length], s.bales.hi);
      bx(lx, lz - 1.46, 1.5, 0.03, row * 0.72 + 0.2, 0.25, [0.06, 0.07, 0.08], s.bales.hi);
    }
    const wreck = (lx, lz, rot, col) => {
      const c = Math.cos(rot), sn = Math.sin(rot);
      const at = (a, b) => [lx + a * c - b * sn, lz + a * sn + b * c];
      const [x0, z0] = at(0, 0), [x1, z1] = at(0, -0.3);
      const g = groundUnder(s, x0, z0, 1.8, 4.3).hi - 0.05;
      bx(x0, z0, 1.8, 4.3, 0.25, 0.75, col, g);
      bx(x1, z1, 1.55, 2.2, 1.0, 0.55, [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8], g);
      for (const [a, b] of [[-0.8, 1.3], [0.8, 1.3], [-0.8, -1.3], [0.8, -1.3]]) { const [wx, wz] = at(a, b); bx(wx, wz, 0.25, 0.6, 0, 0.6, [0.05, 0.05, 0.05], g); }
    };
    // (the wrecks are boxes, so a turned one is drawn as an axis-aligned one: cheap and fine at a glance)
    wreck(-8.3, 15.6, 0, rust[0]); wreck(-6.1, 15.6, 0, rust[3]);
    bx(-8.3, 15.6, 1.6, 3.8, 1.55, 0.7, rust[2], groundUnder(s, -8.3, 15.6, 1.8, 4.3).hi - 0.05);   // one on top
    // tyres by the office
    const gt = groundUnder(s, -8.5, 4.0, 1.0, 1.0).hi - 0.03;
    for (let i = 0; i < 5; i++) bx(-8.6 + (i % 2) * 0.2, 4.0, 0.75, 0.75, i * 0.26, 0.24, [0.05, 0.05, 0.05], gt);
    // the board's posts and a frame behind its face
    const BX = -6.6, BZ = 0.9;
    for (const sx of [-1, 1]) bx(BX + sx * (BOARD_W / 2 - 0.3), BZ + 0.25, 0.22, 0.22, -0.5, BOARD_Y + BOARD_H + 0.5, [0.18, 0.18, 0.19], s.board.hi);
    bx(BX, BZ + 0.18, BOARD_W + 0.25, 0.1, BOARD_Y - 0.12, BOARD_H + 0.24, [0.12, 0.12, 0.13], s.board.hi);
    const geo = B.build();
    const body = new THREE.Mesh(geo, this.bodyMat);
    body.castShadow = !ON_PHONE; body.receiveShadow = false;
    body.matrixAutoUpdate = false;
    const grp = new THREE.Group();
    grp.add(body);
    // the rig
    q.rig = new Rig(s, this.rigMat);
    grp.add(q.rig.mesh);
    // the board: a canvas, redrawn when the list changes
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 624;
    q.boardCtx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    q.boardTex = tex;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const [bwx, bwz] = L2W(BX, BZ);
    board.position.set(bwx, s.board.hi + BOARD_Y + BOARD_H / 2, bwz);
    board.rotation.y = Math.PI - s.rot;   // facing the street (as respray.js's sign)
    board.updateMatrix(); board.matrixAutoUpdate = false;
    grp.add(board);
    q.board = board;
    this.redrawBoard(q);
    grp.visible = false;
    q.grp = grp;
    this.scene.add(grp);
  }

  redrawBoard(q) {
    if (!q.boardCtx) return;
    const key = `${this.st.wk}.${this.st.roll}.${this.st.got.join(',')}`;
    if (key === q.boardKey) return;
    q.boardKey = key;
    drawBoard(q.boardCtx, this.st.list, this.st.got, this.st.wk, this.count);
    q.boardTex.needsUpdate = true;
  }

  local(q, x, z) {
    const s = q.s, dx = x - s.ox, dz = z - s.oz;
    const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    return { lx: dx * cr + dz * sr, lz: -dx * sr + dz * cr };
  }

  // --- the gift car ---------------------------------------------------------------------

  tendPrize(q, d, player) {
    const pv = player.vehicle && !player.onFoot ? player.vehicle : null;
    const v = this.prize;
    if (v && (v.dead || this.traffic.cars.indexOf(v) < 0)) { this.prize = null; return; }
    if (v) {
      if (v === pv) {
        const lc = this.local(q, v.x, v.z);
        if (Math.hypot(lc.lx - PRIZE_AT[0], lc.lz - PRIZE_AT[1]) > 30) this.prize = null;   // driven off: yours now
        return;
      }
      if (d > RELEASE_R) { this.traffic.remove(v); this.prize = null; }
      return;
    }
    if (!this.st.unlocked || d > SPAWN_R) return;
    const [x, z] = q.W(PRIZE_AT[0], PRIZE_AT[1]);
    // (one about at a time: the one you drove off is still yours until it is gone)
    if (this.traffic.cars.some((c) => c.exportPrize)) return;
    try {
      const car = this.traffic.spawnAt(x, z, Math.atan2(-Math.cos(q.s.rot), -Math.sin(q.s.rot)), 'delorean', GOLD, 'apron');
      car.bodyMat.color.setHex(GOLD); car.color = GOLD; car._farCol = null;
      car.vLong = 0; car.exportPrize = true;
      this.prize = car;
    } catch (e) { this.prize = null; }
  }

  // --- the frame ------------------------------------------------------------------------

  tick(dt, player) {
    if ((this._wkT = (this._wkT || 0) + dt) > 20) { this._wkT = 0; this.checkWeek(); }
    const veh = player.vehicle && !player.onFoot ? player.vehicle : null;
    const px = veh ? veh.x : player.x, pz = veh ? veh.z : player.z;
    for (const q of this.sites) {
      const d = Math.hypot(q.mx - px, q.mz - pz);
      if (!q.built && d < BUILD_R) { try { this.build(q); } catch (e) { q.built = true; console.warn('export yard build: ' + e.message); } }
      this.tendPrize(q, d, player);
      if (this.seq && this.seq.q === q) this.run(dt);
      if (!q.grp) continue;
      q.grp.visible = d < SHOW_R || !!this.seq;
      if (d > 60 || !veh) { q.dwell = 0; if (d > 30) q.told = ''; continue; }
      const lc = this.local(q, veh.x, veh.z);
      const inside = Math.abs(lc.lx) < IN_X && lc.lz > IN_Z0 && lc.lz < IN_Z1;
      if (!inside) { q.dwell = 0; if (lc.lz < -1 || Math.abs(lc.lx) > BAY_W) q.told = ''; continue; }
      if (Math.abs(veh.vLong) > 1.0) { q.dwell = 0; continue; }
      if ((q.dwell += dt) < DWELL) continue;
      const why = this.seq ? 'The crane is busy — one at a time' : this.refusal(veh, player);
      if (why) {
        if (q.toldV !== veh) { q.toldV = veh; q.told = ''; }
        if (q.told !== why) { q.told = why; if (this.hud) this.hud.showToast(`${YARD.name}: ${why}`, 3200); if (this.audio && this.audio.ready) this.audio.play('ui_fail', { gain: 0.4 }); }
        continue;
      }
      this.start(q, veh, player);
    }
  }

  /** Bought: pay, tick, put the player out beside the bay, and hand the car to the crane. */
  start(q, v, player) {
    const t = v.typeName, it = this.st.list.find((r) => r.t === t);
    const pay = this.pay(v), hf = clamp(v.health / (v.spec.hp || 100), 0, 1);
    this.st.got.push(t);
    this.st.earned = (this.st.earned || 0) + pay;
    this.game.money += pay;
    const complete = this.st.got.length >= this.st.list.length;
    let bonus = 0, first = false;
    if (complete) {
      bonus = BONUS; this.game.money += bonus;
      this.st.done = (this.st.done || 0) + 1;
      first = !this.st.unlocked; this.st.unlocked = true;
    }
    this.save();
    this.last = { t, pay, hf, base: it.p, complete, bonus };
    // out of the car, onto the apron beside the bay's mouth, facing the crusher (the camera behind you
    // is then out over the street, with the bay, the crane and the crusher in front of it)
    player.exitVehicle(true);
    const [ox, oz] = q.W(BAY_W / 2 + 1.2, -1.2);
    player.x = ox; player.z = oz; player.y = this.city.groundAt(ox, oz, null) + 0.05;
    const [tx, tz] = q.W(CX - 3, CZ);
    player.heading = Math.atan2(tx - ox, tz - oz);
    // the car: nobody's now, nothing drives it, nobody can get in
    v.mode = 'path'; v.vLong = 0; v.vLat = 0; v.spin = 0; v.dead = true;
    const lc = this.local(q, v.x, v.z);
    this.seq = { q, v, t: 0, h0: v.heading, y0: v.y, roof: v.spec.roof || 1.5, lx: lc.lx, lz: lc.lz, sounds: 0, minK: 1, complete, first, removed: false };
    if (this.hud) this.hud.showToast(`${YARD.name}: ${typeName(t)} — ${formatMoney(pay)}${hf < 0.99 ? ` (${Math.round(hf * 100)} % condition)` : ''}. Into the crusher with it.`, 3600);
    if (this.audio && this.audio.ready) this.audio.cash();
    for (const s of this.sites) this.redrawBoard(s);
  }

  /** The crane and the crusher (a per-site sequence; nothing is held). */
  run(dt) {
    const S = this.seq, q = S.q, v = S.v, rig = q.rig;
    S.t += dt;
    const t = S.t;
    const gone = S.removed || this.traffic.cars.indexOf(v) < 0;
    if (!rig) { this.end(); return; }
    // the hook's height over the car's roof at the bay, and the car's hang under the magnet
    const baseY = q.s.crane.hi + JH - MAG_DROP;     // the magnet's underside at cable length 0
    const lenAt = (y) => Math.max(0.6, baseY - y);  // cable length that puts the magnet's underside at y
    const roofY = S.y0 + S.roof;
    const liftY = q.s.crush.hi + CH_H + 0.35 + S.roof + 1.6;   // high enough to clear the crusher's walls
    const dropY = q.s.crush.hi + 0.35 + 0.15 + S.roof;          // the car on the chamber's floor
    let yaw = YAW_BAY, len = HOOK_REST, ram = RAM_UP, carOn = false, carY = 0;
    const L0 = lenAt(roofY), Llift = lenAt(liftY), Ldrop = lenAt(dropY);
    // first the magnet swings over the car where it stopped (the jib is aimed at the bay's centre:
    // the car is carried to the hook as it lifts, a little sideways nudge you cannot see from the gate)
    if (t < 1.2) len = HOOK_REST + (L0 - HOOK_REST) * ease(t / 1.2);
    else if (t < 2.8) { len = L0 + (Llift - L0) * ease((t - 1.2) / 1.6); carOn = true; }
    else if (t < 4.6) { len = Llift; yaw = YAW_BAY + (YAW_CRUSH - YAW_BAY) * ease((t - 2.8) / 1.8); carOn = true; }
    else if (t < 5.6) { len = Llift + (Ldrop - Llift) * ease((t - 4.6) / 1.0); yaw = YAW_CRUSH; carOn = true; }
    else if (t < 6.4) { len = Ldrop + (HOOK_REST - Ldrop) * ease((t - 5.6) / 0.8); yaw = YAW_CRUSH; }
    else if (t < 8.0) { len = HOOK_REST; yaw = YAW_CRUSH; }
    else if (t < 9.6) { yaw = YAW_CRUSH + (YAW_BAY - YAW_CRUSH) * ease((t - 8.0) / 1.6); }
    // the ram: down 6.0 .. 7.0, up 7.4 .. 8.6
    if (t > 6.0 && t < 7.0) ram = RAM_UP + (RAM_DOWN + 0.1 - RAM_UP) * ease((t - 6.0) / 1.0);
    else if (t >= 7.0 && t < 7.4) ram = RAM_DOWN + 0.1;
    else if (t >= 7.4 && t < 8.6) ram = RAM_DOWN + 0.1 + (RAM_UP - RAM_DOWN - 0.5) * ease((t - 7.4) / 1.2);
    rig.set(yaw, len, ram);
    const ramY = q.s.crush.hi + ram;
    // the car
    if (!gone) {
      const h = rig.hook();
      if (carOn) {
        // carried: from where it stopped to under the hook over the first 0.6 s of the lift
        const k = t < 2.8 ? ease((t - 1.2) / 0.6) : 1;
        const [sx, sz] = q.W(S.lx, S.lz);
        v.x = sx + (h.x - sx) * k; v.z = sz + (h.z - sz) * k;
        carY = h.y - S.roof;
        v.y = t < 1.2 ? S.y0 : carY;
        v.heading = S.h0 - (yaw - YAW_BAY);
        v.pitch = 0; v.roll = Math.sin(t * 2.1) * 0.03 * (t < 5.6 ? 1 : 0);
        v.onGround = false;
      } else if (t >= 5.6) {
        // in the chamber: squashed under the ram as it comes down
        const [cx, cz] = q.W(CX, CZ);
        v.x = cx; v.z = cz; v.y = dropY - S.roof; v.roll = 0; v.pitch = 0;
        const top = Math.min(S.roof, ramY - v.y);
        const k = clamp(top / S.roof, 0.18, 1);
        v.group.scale.set(1 + (1 - k) * 0.08, k, 1 + (1 - k) * 0.04);
        S.minK = Math.min(S.minK, k);
      }
      v.vLong = 0; v.vLat = 0; v.vy = 0;
      v.sync();
    }
    // the sounds and the dust
    const A = this.audio && this.audio.ready ? this.audio : null;
    const [cxw, czw] = q.W(CX, CZ);
    const yk = q.s.crush.hi, at = { x: cxw, y: yk + 2, z: czw };
    if (S.sounds === 0 && t > 1.2) { S.sounds = 1; if (A) { A.play('thunk', { gain: 0.9, ...at }); A.play('cb_clunk', { gain: 0.6, ...at }); } }
    if (S.sounds === 1 && t > 5.6) { S.sounds = 2; if (A) A.play('bump', { gain: 0.8, rate: 0.8, ...at }); if (this.fx) this.fx.smoke(cxw, yk + 1.0, czw, 6); }
    if (S.sounds === 2 && t > 6.0) { S.sounds = 3; if (A) A.play('airbrake', { gain: 0.7, rate: 0.7, ...at }); }
    if (S.sounds === 3 && t > 6.55) {
      S.sounds = 4;
      if (A) { A.play('crunch', { gain: 1.0, rate: 0.75, send: 0.25, ...at }); A.play('glass', { gain: 0.7, at: 0.05, ...at }); A.play('debris', { gain: 0.6, at: 0.1, ...at }); A.play('slam', { gain: 0.6, rate: 0.8, at: 0.2, ...at }); }
      if (this.fx) {
        this.fx.emit(cxw, yk + 1.4, czw, 36, { r: 0.66, g: 0.6, b: 0.52, size: 2.0, grow: 3.2, alpha: 0.6, life: 2.8, spread: 3.6, jitter: 3.0, vy: 1.6, grav: 0.1, drag: 0.9 });
        this.fx.sparks(cxw, yk + 1.6, czw, 14);
      }
    }
    if (!S.removed && t > 7.3) {
      S.removed = true;
      if (!gone) { try { this.traffic.remove(v); } catch (e) { /* gone */ } v.group.scale.set(1, 1, 1); }
      const L = this.last;
      if (S.complete) {
        if (this.hud) this.hud.showToast(`LIST COMPLETE! ${formatMoney(BONUS)} bonus from ${YARD.name}${S.first ? ' — and a gold DeLorean by the gate, yours to keep' : ''}. A new list is up.`, 5200);
        if (A) A.cash();
        this.newList(this.st.wk, (this.st.roll | 0) + 1);
        for (const s of this.sites) this.redrawBoard(s);
      } else if (this.hud) this.hud.showToast(`Crushed. ${formatMoney(L.pay)} paid · ${this.count}/${this.st.list.length} on the list`, 3000);
    }
    if (t >= 9.6) this.end();
  }

  end() {
    const S = this.seq;
    this.seq = null;
    if (!S) return;
    if (!S.removed) { S.removed = true; try { this.traffic.remove(S.v); } catch (e) { /* gone */ } S.v.group.scale.set(1, 1, 1); if (S.complete) this.newList(this.st.wk, (this.st.roll | 0) + 1); }
    if (S.q.rig) S.q.rig.set(YAW_BAY, HOOK_REST, RAM_UP);
    for (const s of this.sites) this.redrawBoard(s);
  }

  /** Respawn / reset: finish any sequence at once (the car goes, the rig stands down). */
  abort() { if (this.seq) this.end(); }
}
