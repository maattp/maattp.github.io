// AUTO KW: THE HARVEST. Standing corn and soybeans in the fields round the
// camera, and the combine that cuts them for money.
//
// The fields themselves are the ground tint (world.groundTint: OSM's farmland
// by crop, and the township's parcels in the open country); world.cropAt says
// which of them is still STANDING in October -- corn and soy. This module
// draws that crop, cheap, only near the camera:
//
//   rows    one instance per PLANT CELL: a 2 m piece of one row (rows 1.52 m
//           apart, along the township grid, turned ~37 deg like the
//           concession roads), a zigzag curtain of dry leaves with tassels and
//           a few blades off it. Soy is the same piece squat and gold. Within
//           NEAR of the camera; ~17 triangles a cell.
//   blocks  past NEAR (to FAR): one low box per 4 rows x 3 cells, the field's
//           standing mass as a flat-topped wall, so a corn field does not end
//           at the near ring. A block stands where most of its cells do.
//
// Two InstancedMeshes, two draws, one material; no shadow casting. The cell
// lists are TILES (16 rows x 12 cells, ~24 m square) built a few at a time as
// the camera moves and dropped far behind it.
//
// THE CUT RECORD is a Set of cell keys, kept for the session
// (sessionStorage `autokw-crops`): the combine's header takes every standing
// cell it passes over (grain into the tank, chaff out the back), and any other
// vehicle you drive through the crop flattens its own width (no grain). A
// full tank stops the header; stop in a farmyard to sell the load.
import * as THREE from './three.js';
import * as G from './geo.js';
import { clamp, hash2 } from './util.js';
import { COMBINE_REEL, COMBINE_HEADER, COMBINE_GRAIN } from './vehicles.js';

// The township grid: u across the rows, w along them (world.cropAt's parcels
// use the same frame).
const GC = 0.8, GS = 0.6;
const ROW = 1.52, SEG = 2.0;            // row spacing, a plant cell's length along its row
const TR = 16, TS = 12, TN = TR * TS;   // a tile: rows x cells
const ROW_YAW = Math.atan2(GS, GC);      // a row's heading (local +z along it)
const BR = 4, BS = 3;                    // a far block: rows x cells
const SOY_H = 0.86;

// Bushels a cell yields (corn ~180 bu/acre, soy ~55, times three: a full
// tank in about a minute of corn) and what a bushel fetches (Ontario, fall 2026).
const YIELD = [0, 0.40, 0.14];
const PRICE = [0, 5.2, 13.4];
const NAMES = ['', 'corn', 'soybeans'];
const TANK = 300;

const KEY = 'autokw-crops';
const KEEP = 160000;   // cut cells remembered (the oldest go first)

const ckey = (iu, iw) => (iu + 30000) * 60000 + (iw + 30000);
const fdiv = (a, b) => Math.floor(a / b);

// Real places round Waterloo, and the machine each has: the search below
// finds a farm spot near each (lat, lon) at boot.
const FARMS = [
  { name: 'St. Jacobs', ll: [43.528, -80.570], kind: 'combine' },
  { name: 'Erbsville', ll: [43.478, -80.600], kind: 'combine' },
  { name: 'Bloomingdale', ll: [43.497, -80.445], kind: 'combine' },
  { name: 'Conestogo', ll: [43.545, -80.505], kind: 'tractor' },
  { name: 'Breslau', ll: [43.482, -80.405], kind: 'tractor' },
  { name: 'Wallenstein Rd', ll: [43.555, -80.620], kind: 'tractor' },
  { name: 'Maryhill', ll: [43.530, -80.390], kind: 'tractor' },
  { name: 'Heidelberg Rd', ll: [43.515, -80.600], kind: 'tractor' },
  { name: 'New Dundee', ll: [43.365, -80.535], kind: 'tractor' },
];
const kwWorld = (lat, lon) => G.toWorld(lat, lon);

// The crop's picture: corn plants on the left half, soybeans on the right,
// each half a 2 m piece of row (corn 2.6 m tall; soy drawn tall and squashed
// to 0.86 m by its instances), transparent round the plants (alpha-tested),
// with a solid strip along the top for the far blocks' lids. sRGB.
const CARD_H = 2.6, V_TOP = 0.955, U_PAD = 0.006;
function cropAtlas() {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const Y0 = H - 1, YT = Math.round(H * (1 - V_TOP)) + 2;
  // the lids: solid, the field's colour seen from above
  g.fillStyle = '#93805a'; g.fillRect(0, 0, 512, 8);
  g.fillStyle = '#7d6648'; g.fillRect(512, 0, 512, 8);
  const shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16), f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };
  // A region's plants are drawn three times, a card's width apart, and
  // clipped to it: the row runs on seamlessly from one card into the next.
  const region = (ox, draw) => {
    g.save();
    g.beginPath(); g.rect(ox, YT, 512, Y0 - YT + 1); g.clip();
    for (const dx of [-512, 0, 512]) draw(ox + dx);
    g.restore();
  };
  // --- corn: 256 px a metre across, CARD_H over the usable height ---------------
  const sy = (Y0 - YT) / CARD_H, sxm = 256;
  const corn = (ox) => {
    for (let k = 0; k < 8; k++) {
      const X = ox + (k + 0.5) * 64 + (((k * 37) % 11) - 5) * 3;
      const hS = 2.0 + ((k * 53) % 7) * 0.04;
      const yAt = (m) => Y0 - m * sy;
      // leaves first: dry, curling, darker low down
      const nodes = 9;
      for (let j = 0; j < nodes; j++) {
        const hy = 0.32 + (j / nodes) * (hS - 0.45), side = (j + k) % 2 ? 1 : -1;
        const len = (0.55 + 0.35 * Math.abs(Math.sin((j + 1) * 1.7 + k))) * (j > nodes - 3 ? 0.7 : 1);
        const rise = 0.14 + 0.10 * ((j * 7 + k) % 3);
        const t = j / nodes;
        const col = shade(t < 0.3 ? '#6e5a3c' : t < 0.7 ? ((j + k) % 3 ? '#957d55' : '#8a7d63') : '#b09a70', 0.82 + 0.3 * ((j * 13 + k * 7) % 5) / 5);
        const bx = X, by = yAt(hy);
        const mx = X + side * len * 0.45 * sxm, my = yAt(hy + rise);
        const ex = X + side * len * sxm, ey = yAt(hy - 0.25 - 0.2 * ((j + k) % 2));
        // a tapered blade: out along the upper curve, back along the lower
        const w0 = 0.06 * sy, w1 = 0.04 * sy;
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(bx, by - w0 * 0.5);
        g.quadraticCurveTo(mx, my - w1, ex, ey);
        g.quadraticCurveTo(mx, my + w1 * 0.6, bx, by + w0 * 0.5);
        g.closePath(); g.fill();
        // its midrib, lighter
        g.strokeStyle = '#c8b68e'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(mx, my - w1 * 0.2, ex, ey); g.stroke();
      }
      // the stalk, dark at the foot
      const grad = g.createLinearGradient(0, Y0, 0, yAt(hS));
      grad.addColorStop(0, '#45362a'); grad.addColorStop(0.35, '#806a48'); grad.addColorStop(1, '#ab9772');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(X - 0.02 * sxm, Y0); g.lineTo(X - 0.009 * sxm, yAt(hS)); g.lineTo(X + 0.009 * sxm, yAt(hS)); g.lineTo(X + 0.02 * sxm, Y0);
      g.closePath(); g.fill();
      // the ear, in its husk, leaning out
      const eh = 1.0 + ((k * 29) % 5) * 0.05, es = k % 2 ? 1 : -1;
      g.save();
      g.translate(X + es * 0.03 * sxm, yAt(eh)); g.rotate(es * 0.38);
      g.fillStyle = '#b49a68';
      g.beginPath(); g.ellipse(0, -0.11 * sy, 0.035 * sxm, 0.12 * sy, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#8a7148'; g.lineWidth = 1;
      for (const o of [-0.4, 0, 0.4]) { g.beginPath(); g.moveTo(o * 0.03 * sxm, 0); g.lineTo(o * 0.02 * sxm, -0.22 * sy); g.stroke(); }
      g.fillStyle = '#5c4026'; g.beginPath(); g.ellipse(0, -0.24 * sy, 0.012 * sxm, 0.03 * sy, 0, 0, Math.PI * 2); g.fill();
      g.restore();
      // the tassel
      g.strokeStyle = '#d4c08e'; g.lineWidth = 1.8;
      const tx = X, ty = yAt(hS);
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + 1, yAt(hS + 0.30)); g.stroke();
      for (let b = 0; b < 5; b++) {
        const sd = b % 2 ? 1 : -1, by = yAt(hS + 0.06 + b * 0.04);
        g.beginPath(); g.moveTo(tx, by); g.quadraticCurveTo(tx + sd * 0.08 * sxm, by - 0.06 * sy, tx + sd * 0.13 * sxm, by + 0.06 * sy); g.stroke();
      }
    }
  };
  region(0, corn);
  // --- soybeans: 0.86 m drawn over the full height ------------------------------
  const sys = (Y0 - YT) / 0.86;
  const soy = (ox) => {
    for (let k = 0; k < 16; k++) {
      const X = ox + (k + 0.5) * 32 + (((k * 41) % 9) - 4) * 2;
      const hS = 0.62 + ((k * 31) % 7) * 0.03;
      const yAt = (m) => Y0 - m * sys;
      g.strokeStyle = '#584430'; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(X, Y0); g.lineTo(X + ((k % 3) - 1) * 2, yAt(hS)); g.stroke();
      // branches, each hung with pods
      for (let b = 0; b < 6; b++) {
        const hy = 0.12 + b * (hS - 0.18) / 6, sd = (b + k) % 2 ? 1 : -1, L = (0.10 + 0.05 * ((b * 5 + k) % 3)) * sxm;
        const ex = X + sd * L, ey = yAt(hy + 0.10);
        g.strokeStyle = '#66523a'; g.lineWidth = 1.8;
        g.beginPath(); g.moveTo(X, yAt(hy)); g.quadraticCurveTo(X + sd * L * 0.5, yAt(hy + 0.02), ex, ey); g.stroke();
        for (let q = 0; q < 3; q++) {
          const t = 0.4 + q * 0.3, px = X + sd * L * t, py = yAt(hy + 0.10 * t * t + 0.01);
          g.fillStyle = q % 2 ? '#6e5a40' : '#8a7452';
          g.beginPath(); g.ellipse(px, py + 0.02 * sys, 0.02 * sxm, 0.036 * sys, sd * 0.4, 0, Math.PI * 2); g.fill();
        }
      }
      // the last leaves, curled and golden
      for (let l = 0; l < 3; l++) {
        const sd = (l + k) % 2 ? 1 : -1, hy = hS - 0.05 - l * 0.12;
        g.fillStyle = l === 1 ? '#9a7d50' : '#b0905c';
        g.beginPath(); g.ellipse(X + sd * 0.05 * sxm, yAt(hy), 0.05 * sxm, 0.05 * sys, sd * 0.6, 0, Math.PI * 2); g.fill();
      }
    }
  };
  region(512, soy);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A geometry from flat position, normal, uv and index arrays. */
function geom(P, N, U, I) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

/** One quad from bottom corners a, b (x, z) up to `top`, facing out along
 *  (nx, nz) with its normal tipped up like a crown's, so it is lit from
 *  either side alike (tipped less, the field either side of you read as
 *  two crops, one lit and one in shade); `both` adds the back face. */
function cardQuad(P, N, U, I, a, b, y0, top, nx, nz, u0, u1, both) {
  for (const s of both ? [1, -1] : [1]) {
    const base = P.length / 3, l = Math.hypot(nx, nz) || 1;
    P.push(a[0], y0, a[1], b[0], y0, b[1], b[0], top, b[1], a[0], top, a[1]);
    for (let k = 0; k < 4; k++) N.push((nx / l) * s * 0.22, 0.975, (nz / l) * s * 0.22);
    U.push(u0, 0, u1, 0, u1, V_TOP, u0, V_TOP);
    // wound so that (b - a) x up faces (nx, nz) * s
    const cx = b[0] - a[0], cz = b[1] - a[1];
    const fwd = (cx * nz - cz * nx) * s > 0;
    if (fwd) I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else I.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

/**
 * One plant cell at full corn size, its base at y = 0, the row along z
 * (-1..1): two cards along it (the two real rows ours stands for, 0.76 m
 * apart) and one across, so a field seen down its rows is not see-through.
 * Each card is drawn both ways round. 12 triangles.
 */
function cardGeometry() {
  const P = [], N = [], U = [], I = [];
  const L = 0.5 - U_PAD;
  cardQuad(P, N, U, I, [0.38, -1], [0.38, 1], 0, CARD_H, 1, 0, U_PAD, L, true);
  cardQuad(P, N, U, I, [-0.38, 1], [-0.38, -1], 0, CARD_H, -1, 0, U_PAD + 0.11, L - 0.02, true);
  cardQuad(P, N, U, I, [-0.75, 0.05], [0.75, 0.05], 0, CARD_H, 0, 1, 0.05, 0.05 + 0.375, true);
  return geom(P, N, U, I);
}

/**
 * A far block: x and z -0.5..0.5, its sides the crop's picture (three cards
 * a side, alpha-tested like the near ones, so its top edge is ragged), y 0..1
 * a card's height (from -0.3: it reaches into the ground on a slope), and a
 * lid just under the tassels from the atlas's solid strip.
 */
function blockGeometry() {
  const P = [], N = [], U = [], I = [];
  const side = (ax, az, bx, bz, nx, nz) => {
    for (let k = 0; k < 3; k++) {
      const t0 = k / 3, t1 = (k + 1) / 3;
      cardQuad(P, N, U, I, [ax + (bx - ax) * t0, az + (bz - az) * t0], [ax + (bx - ax) * t1, az + (bz - az) * t1],
        -0.3, 1, nx, nz, U_PAD, 0.5 - U_PAD, false);
    }
  };
  side(-0.5, -0.5, 0.5, -0.5, 0, -1);
  side(0.5, 0.5, -0.5, 0.5, 0, 1);
  side(-0.5, 0.5, -0.5, -0.5, -1, 0);
  side(0.5, -0.5, 0.5, 0.5, 1, 0);
  const lid = 0.80, base = P.length / 3;
  P.push(-0.5, lid, -0.5, 0.5, lid, -0.5, 0.5, lid, 0.5, -0.5, lid, 0.5);
  for (let q = 0; q < 4; q++) N.push(0, 1, 0);
  U.push(0.2, 0.994, 0.3, 0.994, 0.3, 0.994, 0.2, 0.994);
  I.push(base, base + 2, base + 1, base, base + 3, base + 2);
  return geom(P, N, U, I);
}

export class Crops {
  /**
   * `o`: { scene, city, world, game, phone, hud, audio, fx } (hud, audio and
   * fx may be getters: they are made after the farms are spawned).
   */
  constructor(o) {
    this.o = o;
    this.city = o.city; this.world = o.world;
    this.NEAR = o.phone ? 56 : 80;
    this.FAR = o.phone ? 150 : 210;
    this.tiles = new Map();
    this.cut = new Set();
    this.load = [0, 0, 0];      // bushels in the tank, by crop
    this.yards = [];            // where a load sells: the farms' own yards
    this.spots = [];            // the machines' spots (places on the map)
    this.last = { x: 1e9, z: 1e9 };
    this.dirty = true; this.cutDirty = false; this.refreshT = 0;
    this.saveT = 0; this.saveDirty = false;
    this.cutting = 0; this.fxT = 0; this.sndT = 0; this.fullSaid = false; this.grainY = -1;
    this.panel = null;
    this._load();

    // One material for both: the atlas, alpha-tested (the pedestrians' hair
    // is the precedent), `aSoy` moving an instance onto the atlas's soy half,
    // and a breeze -- the tops sway a few centimetres, each cell on its own phase.
    this.uTime = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({ map: cropAtlas(), alphaTest: 0.42, roughness: 0.95, metalness: 0, envMapIntensity: 0.5 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uCropT = this.uTime;
      sh.vertexShader = 'attribute float aSoy;\nuniform float uCropT;\n' + sh.vertexShader
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv.x += aSoy * 0.5;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
	{
		float ph = uCropT * 1.6 + instanceMatrix[3][0] * 0.23 + instanceMatrix[3][2] * 0.31;
		float k = max(position.y, 0.0);
		transformed.x += sin(ph) * 0.03 * k;
		transformed.z += cos(ph * 0.8) * 0.02 * k;
	}`);
    };
    mat.customProgramCacheKey = () => 'crops';
    const capR = o.phone ? 3600 : 7000, capB = o.phone ? 1500 : 2600;
    const mk = (geo, cap, name) => {
      const soy = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      soy.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aSoy', soy);
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;   // the set is chosen by distance
      m.receiveShadow = true; m.castShadow = false;
      m.count = 0; m.visible = false; m.name = name;
      o.scene.add(m);
      return m;
    };
    this.rows = mk(cardGeometry(), capR, 'crops:rows');
    this.blocks = mk(blockGeometry(), capB, 'crops:blocks');
    this.trisRow = this.rows.geometry.index.count / 3;
    this.trisBlock = this.blocks.geometry.index.count / 3;
  }

  // --- the cell grid ------------------------------------------------------------

  static cellOf(x, z) {
    const u = x * GC - z * GS, w = x * GS + z * GC;
    return [fdiv(u, ROW), fdiv(w, SEG)];
  }
  static cellCentre(iu, iw) {
    const u = (iu + 0.5) * ROW, w = (iw + 0.5) * SEG;
    return [u * GC + w * GS, -u * GS + w * GC];
  }

  /** A tile's crop, by cell: built once, the cut record applied. */
  _tile(ti, tj) {
    const k = ti * 100000 + tj;
    let t = this.tiles.get(k);
    if (t) return t;
    const type = new Uint8Array(TN), y = new Float32Array(TN), cut = new Uint8Array(TN);
    const city = this.city, world = this.world;
    let n = 0;
    for (let r = 0; r < TR; r++) {
      for (let s = 0; s < TS; s++) {
        const iu = ti * TR + r, iw = tj * TS + s, i = r * TS + s;
        const [x, z] = Crops.cellCentre(iu, iw);
        const c = world.cropAt(x, z);
        if (!c) continue;
        if (G.isWater(x, z) || G.inLot(x, z) || city.onRoad(x, z, 1.5)) continue;
        // not in a country road's ditch, on its berm or on a farm lane (rural.js)
        if (city.ruralClear && city.ruralClear(x, z)) continue;
        if (world.inAirfield && world.inAirfield(x, z)) continue;
        const gy = G.terrainHeight(x, z);
        if (city.insideBuilding(x, z, gy, 1.5)) continue;
        type[i] = c; y[i] = gy; n++;
        if (this.cut.has(ckey(iu, iw))) cut[i] = 1;
      }
    }
    const [cx, cz] = Crops.cellCentre(ti * TR + TR / 2 - 0.5, tj * TS + TS / 2 - 0.5);
    t = { ti, tj, type, y, cut, n, cx, cz };
    this.tiles.set(k, t);
    return t;
  }

  /** What stands at (x, z): 0 none or cut, 1 corn, 2 soy (only in built tiles). */
  standingAt(x, z) {
    const [iu, iw] = Crops.cellOf(x, z);
    const t = this.tiles.get(fdiv(iu, TR) * 100000 + fdiv(iw, TS));
    if (!t) return 0;
    const i = (iu - t.ti * TR) * TS + (iw - t.tj * TS);
    return t.cut[i] ? 0 : t.type[i];
  }

  /** Cut the cell at (x, z) if it stands: returns its crop (0 if nothing). */
  cutAt(x, z, build = false) {
    const [iu, iw] = Crops.cellOf(x, z);
    const ti = fdiv(iu, TR), tj = fdiv(iw, TS);
    const t = build ? this._tile(ti, tj) : this.tiles.get(ti * 100000 + tj);
    if (!t) return 0;
    const i = (iu - ti * TR) * TS + (iw - tj * TS);
    if (!t.type[i] || t.cut[i]) return 0;
    t.cut[i] = 1;
    this.cut.add(ckey(iu, iw));
    this.cutDirty = true; this.saveDirty = true;
    return t.type[i];
  }

  /** Cut everything under a box in a vehicle's frame (a parked machine's own
   *  ground, a headland): no grain. */
  clearBox(x, z, h, hw, z0, z1) {
    const fx = Math.sin(h), fz = Math.cos(h), rx = fz, rz = -fx;
    for (let a = z0; a <= z1; a += 0.7) for (let b = -hw; b <= hw; b += 0.6) this.cutAt(x + fx * a + rx * b, z + fz * a + rz * b, true);
  }

  // --- drawing ------------------------------------------------------------------

  /** Before the scene pass: build tiles near the camera, refresh the instances. */
  stream(camera) {
    const px = camera.position.x, pz = camera.position.z;
    this.uTime.value = (performance.now() / 1000) % 1000;
    // tiles within FAR, nearest first, a few a frame
    const [cu, cw] = Crops.cellOf(px, pz);
    const R = this.FAR + 20;
    const ti0 = fdiv(cu - R / ROW, TR), ti1 = fdiv(cu + R / ROW, TR);
    const tj0 = fdiv(cw - R / SEG, TS), tj1 = fdiv(cw + R / SEG, TS);
    const t0 = performance.now(), budget = this.o.phone ? 1.2 : 2.5;
    let want = null;
    // Auto KW (v87): the scan only when the camera has moved 3 m since the
    // last one or that one left tiles to build -- it walked ~200 tiles a
    // frame standing still (0.3 ms at 8x in town, where none has a crop)
    const sc = this._scan || (this._scan = { x: 1e9, z: 0, left: true });
    const rescan = sc.left || (px - sc.x) ** 2 + (pz - sc.z) ** 2 > 9;
    if (rescan) { sc.x = px; sc.z = pz; sc.left = false; }
    if (rescan) for (let ti = ti0; ti <= ti1; ti++) {
      for (let tj = tj0; tj <= tj1; tj++) {
        if (this.tiles.has(ti * 100000 + tj)) continue;
        const [x, z] = Crops.cellCentre(ti * TR + TR / 2, tj * TS + TS / 2);
        const d = (x - px) ** 2 + (z - pz) ** 2;
        if (d > (R + 20) ** 2) continue;
        (want || (want = [])).push([d, ti, tj]);
      }
    }
    if (want) {
      want.sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < want.length; k++) {
        const t = this._tile(want[k][1], want[k][2]);
        if (t.n) this.dirty = true;
        if (performance.now() - t0 > budget) { sc.left = k < want.length - 1; break; }
      }
    }
    // drop tiles far behind
    if (this.tiles.size > 900) {
      const D = (this.FAR + 260) ** 2;
      for (const [k, t] of this.tiles) if ((t.cx - px) ** 2 + (t.cz - pz) ** 2 > D) this.tiles.delete(k);
    }
    const now = performance.now();
    const moved = (px - this.last.x) ** 2 + (pz - this.last.z) ** 2 > 16;
    if (this.dirty || moved || (this.cutDirty && now - this.refreshT > 90)) {
      this.last.x = px; this.last.z = pz;
      this.dirty = false; this.cutDirty = false; this.refreshT = now;
      this._fill(px, pz);
    }
  }

  _fill(px, pz) {
    const RM = this.rows, BM = this.blocks;
    const rm = RM.instanceMatrix.array, rc = RM.instanceColor.array, bm = BM.instanceMatrix.array, bc = BM.instanceColor.array;
    const capR = rc.length / 3, capB = bc.length / 3;
    const rsoy = RM.geometry.attributes.aSoy.array, bsoy = BM.geometry.attributes.aSoy.array;
    const N2 = this.NEAR * this.NEAR, F2 = this.FAR * this.FAR;
    const c = Math.cos(ROW_YAW), s = Math.sin(ROW_YAW);
    let nr = 0, nb = 0;
    const put = (arr, o, x, y, z, sx, sy, sz, flip) => {
      const cc = flip ? -c : c, ss = flip ? -s : s;
      arr[o] = cc * sx; arr[o + 1] = 0; arr[o + 2] = -ss * sx; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = ss * sz; arr[o + 9] = 0; arr[o + 10] = cc * sz; arr[o + 11] = 0;
      arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
    };
    const lim = (this.FAR + 20) ** 2;
    for (const t of this.tiles.values()) {
      if (!t.n) continue;
      const td = (t.cx - px) ** 2 + (t.cz - pz) ** 2;
      if (td > lim) continue;
      for (let br = 0; br < TR; br += BR) {
        for (let bs = 0; bs < TS; bs += BS) {
          const iuB = t.ti * TR + br, iwB = t.tj * TS + bs;
          const [bx, bz] = Crops.cellCentre(iuB + BR / 2 - 0.5, iwB + BS / 2 - 0.5);
          const d2 = (bx - px) ** 2 + (bz - pz) ** 2;
          if (d2 > F2) continue;
          if (d2 < N2) {
            // near: every standing cell, as itself
            for (let r = br; r < br + BR; r++) {
              for (let q = bs; q < bs + BS; q++) {
                const i = r * TS + q, ty = t.type[i];
                if (!ty || t.cut[i] || nr >= capR) continue;
                const iu = t.ti * TR + r, iw = t.tj * TS + q;
                const [x, z] = Crops.cellCentre(iu, iw);
                const h = hash2(iu * 3 + 11, iw * 7 + 5);
                const corn = ty === 1;
                put(rm, nr * 16, x, t.y[i] - 0.04, z, 1, (corn ? 1 : SOY_H / CARD_H) * (0.9 + 0.18 * h), 1, h > 0.5);
                const k = 0.8 + 0.22 * hash2(iw * 5 + 1, iu * 11 + 3);
                rc[nr * 3] = k; rc[nr * 3 + 1] = k * (0.97 + 0.03 * h); rc[nr * 3 + 2] = k * (0.92 + 0.06 * h);
                rsoy[nr] = corn ? 0 : 1;
                nr++;
              }
            }
            continue;
          }
          // far: one block where most of its cells stand
          let up = 0, corn = 0, ys = 0, ylo = Infinity;
          for (let r = br; r < br + BR; r++) {
            for (let q = bs; q < bs + BS; q++) {
              const i = r * TS + q;
              if (!t.type[i] || t.cut[i]) continue;
              up++; if (t.type[i] === 1) corn++;
              ys += t.y[i]; if (t.y[i] < ylo) ylo = t.y[i];
            }
          }
          if (up * 2 <= BR * BS || nb >= capB) continue;
          // (its foot at the lowest cell's ground: the sides reach 0.3 of a
          // card below that, enough for a 6 m block on any field's slope)
          const isCorn = corn * 2 >= up;
          const h = hash2(iuB, iwB);
          put(bm, nb * 16, bx, Math.min(ylo, ys / up - 0.2) - 0.04, bz, BR * ROW, (isCorn ? CARD_H : SOY_H) * (0.96 + 0.08 * h), BS * SEG, false);
          const k = 0.82 + 0.12 * h;
          bc[nb * 3] = k; bc[nb * 3 + 1] = k * 0.98; bc[nb * 3 + 2] = k * 0.95;
          bsoy[nb] = isCorn ? 0 : 1;
          nb++;
        }
      }
    }
    RM.count = nr; BM.count = nb;
    RM.visible = nr > 0; BM.visible = nb > 0;
    RM.instanceMatrix.needsUpdate = true; RM.instanceColor.needsUpdate = true;
    BM.instanceMatrix.needsUpdate = true; BM.instanceColor.needsUpdate = true;
    RM.geometry.attributes.aSoy.needsUpdate = true; BM.geometry.attributes.aSoy.needsUpdate = true;
    this._n = [nr, nb];
  }

  /** For harnesses: what is drawn. */
  stats() {
    const [nr, nb] = this._n || [0, 0];
    return { rows: nr, blocks: nb, tris: nr * this.trisRow + nb * this.trisBlock, tiles: this.tiles.size, cut: this.cut.size, grain: Math.round(this.grain()) };
  }

  grain() { return this.load[1] + this.load[2]; }

  // --- the harvest ----------------------------------------------------------------

  /** Each frame: the combine's header, any other machine's tyres, selling, the HUD. */
  update(dt, player) {
    const v = player.vehicle;
    this.cutting = Math.max(0, this.cutting - dt);
    if (v && v.spec.combine) this._combine(dt, v);
    else if (v && !v.spec.plane && !v.spec.boat && !v.afloat && v.onGround !== false && Math.abs(v.vLong) > 1.2) {
      // flattened under the wheels: no grain, just the swath
      const f = v.forward, rx = f.z, rz = -f.x, hl = v.halfLen * 0.8, hw = v.halfWid * 0.85;
      for (let a = -hl; a <= hl; a += Math.max(0.8, hl / 3)) {
        for (let b = -hw; b <= hw + 0.01; b += Math.max(0.6, hw)) this.cutAt(v.x + f.x * a + rx * b, v.z + f.z * a + rz * b);
      }
    }
    this._hud(v);
    this.saveT -= dt;
    if (this.saveDirty && this.saveT <= 0) { this.saveT = 4; this.saveDirty = false; this._save(); }
  }

  _combine(dt, v) {
    const o = this.o, f = v.forward, rx = f.z, rz = -f.x;
    // the reel turns while you are in it, faster with the ground speed, so
    // its bats sweep the crop back onto the cutterbar (COMBINE_REEL)
    const rate = 1.2 + Math.max(0, v.vLong) * 1.25 / COMBINE_REEL.r;
    const pv = v.pivotY || 0;
    for (const m of v.spinMeshes) {
      if (m.userData.axis === 'x') m.rotation.x += rate * dt;
      else if (m.userData.axis === 'g') {
        const g = this.grain(), GR = COMBINE_GRAIN;
        const y = (g < 0.5 ? GR.at[1] : GR.floor + clamp(g / TANK, 0, 1) * GR.rise) - pv;
        if (m.position.y !== y) { m.position.y = y; m.scale.x = g < 0.5 ? 1 : GR.widen; }
      }
    }
    if (v.vLong < 0.3 || v.onGround === false) { this._sell(v); return; }
    const full = this.grain() >= TANK;
    if (full) {
      if (!this.fullSaid && o.hud) { o.hud.showToast('Grain tank full — drive back to the farm (on the map) and stop to sell it', 4200); this.fullSaid = true; }
      return;
    }
    // the header: a strip across the cutterbar, sampled finer than a cell
    const H = COMBINE_HEADER;
    let got = 0;
    for (let a = H.z0 + 0.4; a <= H.z1; a += 0.6) {
      for (let b = -H.hw + 0.2; b <= H.hw - 0.2; b += 0.55) {
        const c = this.cutAt(v.x + f.x * a + rx * b, v.z + f.z * a + rz * b);
        if (c) { this.load[c] += YIELD[c]; got++; }
      }
    }
    // and the body behind it: what the header missed, it runs down
    if (got) this.cutting = 0.25;
    if (this.cutting > 0 && o.fx) {
      this.fxT -= dt;
      if (this.fxT <= 0) {
        this.fxT = 0.07;
        const back = -4.5, y = v.y + 1.0;
        // chaff and straw out of the spreader, dust off the cutterbar
        o.fx.emit(v.x + f.x * back, y, v.z + f.z * back, 3, { r: 0.66, g: 0.56, b: 0.38, size: 0.9, grow: 1.6, alpha: 0.55, life: 1.5, spread: 3.2, vy: 0.9, grav: -0.6, drag: 0.9, jitter: 1.4,
          vx: -f.x * 3, vz: -f.z * 3 });
        const sb = (Math.random() - 0.5) * H.hw * 1.6;
        o.fx.emit(v.x + f.x * (H.z1 - 0.3) + rx * sb, v.y + 0.6, v.z + f.z * (H.z1 - 0.3) + rz * sb, 1, { r: 0.62, g: 0.55, b: 0.40, size: 1.4, grow: 2.2, alpha: 0.32, life: 1.6, spread: 1.2, vy: 0.6, grav: 0.1, drag: 0.92, jitter: 0.8 });
      }
      this.sndT -= dt;
      if (this.sndT <= 0 && o.audio && o.audio.ready) {
        this.sndT = 0.32;
        o.audio.play('grass_roll', { gain: 0.5, rate: 0.7 + Math.random() * 0.2, x: v.x + f.x * 5, y: v.y + 0.5, z: v.z + f.z * 5 });
      }
    }
    const g = this.grain();
    if (g > TANK) { this.load[1] *= TANK / g; this.load[2] *= TANK / g; }
  }

  /** Stopped in a farmyard with grain aboard: sold. */
  _sell(v) {
    if (this.grain() < 1 || Math.abs(v.vLong) > 1.5) return;
    let yard = G.farmAt(v.x, v.z) === 7;
    for (const y of this.yards) if (!yard && (y.x - v.x) ** 2 + (y.z - v.z) ** 2 < 40 * 40) yard = true;
    if (!yard) return;
    let pay = 0;
    const parts = [];
    for (const c of [1, 2]) {
      if (this.load[c] < 0.5) continue;
      pay += this.load[c] * PRICE[c];
      parts.push(`${Math.round(this.load[c])} bu of ${NAMES[c]}`);
    }
    pay = Math.round(pay);
    this.load[1] = this.load[2] = 0;
    this.fullSaid = false; this.saveDirty = true;
    this.o.game.money += pay;
    const o = this.o;
    if (o.hud) o.hud.showToast(`Sold ${parts.join(' and ')} — $${pay}`, 3600);
    if (o.audio && o.audio.ready) o.audio.play('cash', { gain: 0.9 });
  }

  _hud(v) {
    const on = !!(v && v.spec.combine);
    if (!on && !this.panel) return;
    if (!this.panel) {
      const el = document.createElement('div');
      el.id = 'grainPanel';
      el.style.cssText = 'position:absolute;top:calc(env(safe-area-inset-top) + 6px);left:50%;transform:translateX(-50%);'
        + 'z-index:41;display:none;text-align:center;background:rgba(10,16,22,0.55);border-radius:10px;padding:5px 14px 6px;'
        + 'pointer-events:none;min-width:190px;font:600 12px -apple-system,Helvetica,sans-serif;color:#fff;';
      el.innerHTML = '<div style="font-size:10px;letter-spacing:.14em;opacity:.7">GRAIN TANK</div>'
        + '<div style="height:7px;margin:4px 0 3px;border-radius:4px;background:rgba(255,255,255,.18);overflow:hidden">'
        + '<div class="f" style="height:100%;width:0;background:#e8b84a"></div></div><div class="t"></div>';
      (document.getElementById('app') || document.body).appendChild(el);
      this.panel = { el, f: el.querySelector('.f'), t: el.querySelector('.t'), txt: '' };
    }
    const P = this.panel;
    P.el.style.display = on ? 'block' : 'none';
    if (!on) return;
    const g = this.grain(), val = Math.round(this.load[1] * PRICE[1] + this.load[2] * PRICE[2]);
    const what = this.load[2] > this.load[1] ? 'soybeans' : 'corn';
    const txt = g < 0.5 ? 'Drive the header into standing corn or soy'
      : `${Math.round(g)} / ${TANK} bu ${what} · $${val}${g >= TANK ? ' · FULL' : ''}`;
    if (txt !== P.txt) {
      P.txt = txt; P.t.textContent = txt;
      P.f.style.width = `${Math.round(clamp(g / TANK, 0, 1) * 100)}%`;
    }
  }

  // --- the farms ------------------------------------------------------------------

  /**
   * Park the machines: near each of FARMS, the nearest good spot by a
   * spiral search -- standing crop beside a rural road for a combine (its
   * nose into the rows, its own ground and a headland already cut), a
   * farmyard or any field edge by a road for a tractor. Off the carriageway,
   * clear of buildings and water, on gentle ground. Returns what it parked.
   */
  spawnFarms(traffic) {
    const city = this.city, world = this.world, T = G.terrainHeight;
    const rowH = ROW_YAW;   // heading along the rows (+w)
    const flat = (x, z) => Math.abs(T(x + 4, z) - T(x - 4, z)) < 0.9 && Math.abs(T(x, z + 4) - T(x, z - 4)) < 0.9;
    const clear = (x, z, r) => !G.isWater(x, z) && !G.inLot(x, z) && !city.onRoad(x, z, 2.5) && !city.insideBuilding(x, z, T(x, z), r)
      && !(world.inAirfield && world.inAirfield(x, z));
    const nearRoad = (x, z, R) => city.roadsNear(x, z, R, false).length > 0;
    const out = [];
    const t0 = performance.now();
    for (const F of FARMS) {
      const [x0, z0] = kwWorld(F.ll[0], F.ll[1]);
      if (Math.abs(x0) > G.MAP_HALF - 300 || Math.abs(z0) > G.MAP_HALF - 300) continue;
      let best = null;
      const STEP = 24;
      for (let ring = 0; ring < 60 && !best; ring++) {
        const n = Math.max(1, ring * 8);
        for (let k = 0; k < n && !best; k++) {
          const a = (k / n) * Math.PI * 2, x = x0 + Math.cos(a) * ring * STEP, z = z0 + Math.sin(a) * ring * STEP;
          if (F.kind === 'combine') {
            if (world.cropAt(x, z) === 0) continue;
            if (!nearRoad(x, z, 40) || city.onRoad(x, z, 9)) continue;
            if (!clear(x, z, 6) || !flat(x, z)) continue;
            // nose into the field: the row direction with crop for 60 m ahead
            for (const h of [rowH, rowH + Math.PI]) {
              const fx = Math.sin(h), fz = Math.cos(h);
              let ok = true;
              for (let d = 8; d <= 64 && ok; d += 8) {
                const px = x + fx * d, pz = z + fz * d;
                if (world.cropAt(px, pz) === 0 || city.onRoad(px, pz, 6) || !clear(px, pz, 4)) ok = false;
                // and the header's width clear of roads either side
                if (ok && (city.onRoad(px + fz * 6, pz - fx * 6, 2) || city.onRoad(px - fz * 6, pz + fx * 6, 2))) ok = false;
              }
              const bx = x - fx * 6, bz = z - fz * 6;
              if (ok && clear(bx, bz, 4)) { best = { x, z, h }; break; }
            }
          } else {
            const fa = G.farmAt(x, z);
            if (!(fa === 7 || world.cropAt(x, z) || (fa >= 3 && fa <= 5))) continue;
            if (!nearRoad(x, z, 30) || city.onRoad(x, z, 5)) continue;
            if (!clear(x, z, 4) || !flat(x, z)) continue;
            let h = rowH + (hash2(Math.round(x), Math.round(z)) > 0.5 ? Math.PI : 0);
            if (city.onRoad(x + Math.sin(h) * 8, z + Math.cos(h) * 8, 3)) h += Math.PI;
            if (!clear(x + Math.sin(h) * 3, z + Math.cos(h) * 3, 2) || !clear(x - Math.sin(h) * 3, z - Math.cos(h) * 3, 2)) continue;
            best = { x, z, h };
          }
        }
      }
      if (!best) continue;
      const v = traffic.spawnAt(best.x, best.z, best.h, F.kind, F.kind === 'combine' ? 0xb5121b : 0x367c2b, 'apron');
      v.vLong = 0;
      // its own ground (and a combine's header and a headland) already cut
      if (F.kind === 'combine') this.clearBox(best.x, best.z, best.h, 5.4, -6, 7.5);
      else this.clearBox(best.x, best.z, best.h, 3.2, -4.5, 4.5);
      const spot = { x: best.x, z: best.z, kind: F.kind, name: F.name, v };
      this.spots.push(spot);
      this.yards.push({ x: best.x, z: best.z });
      out.push(spot);
    }
    this.saveDirty = false;   // the headlands are the farms', not the player's: not saved
    this.searchMs = performance.now() - t0;
    return out;
  }

  /** The map's places: each machine, named, with its hello. */
  places() {
    return this.spots.map((s) => s.kind === 'combine'
      ? { x: s.x, z: s.z, kind: 'farm', name: `Combine · ${s.name}`, label: true, near: false,
        hello: 'A combine at the edge of the crop — climb in and harvest. Fill the tank, then stop back here to sell the grain' }
      : { x: s.x, z: s.z, kind: 'farm', name: `Tractor · ${s.name}`, label: true, near: false,
        hello: 'A tractor at the farm — 40 km/h flat out, and the fields are all yours' });
  }

  // --- the session's record -----------------------------------------------------

  _load() {
    try {
      const s = sessionStorage.getItem(KEY);
      if (!s) return;
      const d = JSON.parse(s);
      if (d && Array.isArray(d.cut)) for (const k of d.cut) this.cut.add(k);
      if (d && Array.isArray(d.load)) this.load = [0, +d.load[1] || 0, +d.load[2] || 0];
    } catch { /* private mode, or nothing kept */ }
  }

  _save() {
    if (this.cut.size > KEEP) {
      let drop = this.cut.size - KEEP;
      for (const k of this.cut) { if (drop-- <= 0) break; this.cut.delete(k); }
    }
    try { sessionStorage.setItem(KEY, JSON.stringify({ cut: [...this.cut], load: this.load })); } catch { /* full or blocked */ }
  }
}
