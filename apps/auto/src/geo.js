// Seattle geography. Every number in here now comes from real data -- see
// tools/ and the "Where the map comes from" section of apps/auto/CLAUDE.md.
//
// World frame: +X = east, +Z = south, Y = up, 1 unit = 1 metre.
// Origin (0,0) = Westlake Center, 4th Ave & Pine St (47.61134 N, 122.33790 W).
//
// The projection is a local equirectangular about that origin, matching
// tools/proj.py exactly. Over the 8 km half-width the distortion is under 0.1 %,
// an order of magnitude below the DEM's 40 m resolution.
//
// This file used to hold hand-drawn hills, water polygons, district grids and
// road polylines. All of it is gone: elevation is a USGS DEM, water is an
// OpenStreetMap coastline, and the streets are OSM ways. What is left is the
// coordinate frame and the lookups on top of the imported rasters.

import { clamp } from './util.js';

export const MAP_HALF = 13000; // world spans -13000..13000 on both axes (26 km)

export const LAT0 = 47.61134;
export const LON0 = -122.33790;
const RAD = Math.PI / 180;
export const M_LAT = 111132.92 - 559.82 * Math.cos(2 * LAT0 * RAD)
  + 1.175 * Math.cos(4 * LAT0 * RAD) - 0.0023 * Math.cos(6 * LAT0 * RAD);
export const M_LON = 111412.84 * Math.cos(LAT0 * RAD)
  - 93.5 * Math.cos(3 * LAT0 * RAD) + 0.118 * Math.cos(5 * LAT0 * RAD);

/** (lat, lon) -> world metres. The inverse of what tools/proj.py baked in. */
export function toWorld(lat, lon) {
  return [(lon - LON0) * M_LON, (LAT0 - lat) * M_LAT];
}
export function toLatLon(x, z) {
  return [LAT0 - z / M_LAT, LON0 + x / M_LON];
}

// The heightfield and the terrain mesh share this spacing on purpose: the mesh
// IS the drawn ground and terrainHeight() is what everything stands on, so a
// finer query grid would float roads over bulges the mesh doesn't resolve.
export const HF_STEP = 40;
export const HF_N = (MAP_HALF * 2) / HF_STEP + 1; // 401
export const MASK_STEP = 10;
export const MASK_N = (MAP_HALF * 2) / MASK_STEP + 1; // 1601

let HF = null;
let WET = null;
let GRN = null;
let LOT = null;

export let LANDMARKS = [];
// Landmarks placed from their OSM nodes (lat, lon), appended after places.json's
// so the first twenty -- the collectibles -- are unchanged. Sources in
// landmarks.js beside each builder.
export const EXTRA_LANDMARKS = [
  // The points' tips are below the sea on the 40 m DEM: each lighthouse gets
  // a pad of ground (`pad`: raised to y within r0, blended out by r1).
  { kind: 'westPoint', name: 'West Point Lighthouse', lat: 47.661973, lon: -122.435741, pad: { y: 3.2, r0: 30, r1: 75 } },
  { kind: 'alkiPoint', name: 'Alki Point Lighthouse', lat: 47.576267, lon: -122.420608, pad: { y: 4.0, r0: 28, r1: 70 } },
  { kind: 'rocket', name: 'Fremont Rocket', lat: 47.650626, lon: -122.351184 },
  { kind: 'lenin', name: 'Lenin', lat: 47.65136, lon: -122.350947 },
  { kind: 'hammeringMan', name: 'Hammering Man', lat: 47.60703, lon: -122.338125 },
  { kind: 'eagle', name: 'The Eagle', lat: 47.616588, lon: -122.355977 },
  { kind: 'echo', name: 'Echo', lat: 47.615265, lon: -122.355602, pad: { y: 3.0, r0: 8, r1: 30 } },
  { kind: 'eraser', name: 'Typewriter Eraser, Scale X', lat: 47.621987, lon: -122.348495 },
  { kind: 'waterTower', name: 'Volunteer Park Water Tower', lat: 47.629026, lon: -122.314573 },
  // at the reservoir's east edge, which the import dug as a pond
  { kind: 'blackSun', name: 'Black Sun', lat: 47.629945, lon: -122.315202, pad: { y: 'east', r0: 8, r1: 22 } },
  { kind: 'conservatory', name: 'Volunteer Park Conservatory', lat: 47.632082, lon: -122.315746 },
  { kind: 'pergola', name: 'Pioneer Square Pergola', lat: 47.601852, lon: -122.33394 },
  { kind: 'totem', name: 'Pioneer Square Totem Pole', lat: 47.602001, lon: -122.334042 },
  { kind: 'changingForm', name: 'Changing Form', lat: 47.629477, lon: -122.359935 },
  { kind: 'daybreak', name: 'Daybreak Star Cultural Center', lat: 47.66794, lon: -122.418044 },
];
export let BEACHES = [];
// OSM's park furniture (tools/build_parkprops.py), filed by 400 m chunk:
// 'cx,cz' -> [{ k: 'bench' | 'picnic' | 'playground' | 'fountain', x, z, a, r }].
// world.meshProps draws each chunk's own.
export const PARK_PROPS = new Map();
export let PLACES = [];
export let SPAWN = { x: -985, z: -807 };
export let SPAWN_HEADING = 2.6;
export let RESPAWN = { x: 1075, z: 905 };
export let KEEP_CLEAR = [SPAWN, RESPAWN];

/** Hand the loaded map data to the lookups below. Call once, before anything else. */
export function initGeo(md) {
  if (md.hfN !== HF_N) throw new Error(`height.png is ${md.hfN} wide, expected ${HF_N}`);
  if (md.maskN !== MASK_N) throw new Error(`surface.png is ${md.maskN} wide, expected ${MASK_N}`);
  HF = md.height;
  fixTerrain(HF);
  liftBeaches(HF, md.beaches || [], md.lakes || [], md.water);
  WET = md.water;
  GRN = md.green;
  LOT = md.lot || null;
  if (LOT) { LOT_N = md.lotN; LOT_STEP = (MAP_HALF * 2) / (LOT_N - 1); }
  const p = md.places;
  LANDMARKS = [...p.landmarks, ...EXTRA_LANDMARKS.map((e) => {
    const [x, z] = toWorld(e.lat, e.lon);
    if (e.pad) padTerrain(HF, x, z, e.pad);
    return { kind: e.kind, name: e.name, x, z };
  })];
  BEACHES = md.beaches || [];
  PARK_PROPS.clear();
  if (md.parkprops) {
    for (const k of ['bench', 'picnic', 'playground', 'fountain']) {
      for (const r of md.parkprops[k] || []) {
        const key = `${Math.floor(r[0] / 400)},${Math.floor(r[1] / 400)}`;
        let l = PARK_PROPS.get(key);
        if (!l) PARK_PROPS.set(key, (l = []));
        // a bench's mapped direction is the way a sitter faces, compass degrees
        l.push({ k, x: r[0], z: r[1], a: k === 'bench' && r.length > 2 ? r[2] : null, r: k === 'playground' ? r[2] : 0 });
      }
    }
  }
  PLACES = p.places;
  SPAWN = { x: p.spawn.x, z: p.spawn.z };
  SPAWN_HEADING = p.spawn.heading;
  RESPAWN = { x: p.respawn.x, z: p.respawn.z };
  KEEP_CLEAR = [SPAWN, RESPAWN];
}

// PLACES THE IMPORT DUG INTO CRATERS. build_raster.py digs a bed under every
// heightfield cell that touches water, but only a labelled lake (over
// 20,000 m2) gets a water plane: a small pond comes out as a dry pit. Bellevue
// Downtown Park's canal ring and reflecting pond (5,000 m2 together) became a
// hollow 20 m deep across the south-west of its lawn, where the real park is
// a level lawn inside a canal (landmarks.js draws the water). Each entry
// flattens the heightfield vertices within r0 of a centre to the mean ground
// on the ring just outside r1, blending between; applied at load, before
// anything reads the terrain, so every consumer sees the same ground.
// Keyed by name: landmarks.js reads Bellevue's (the level it builds on), and
// the entry is the one place its centre is written.
export const TERRAIN_FLATS = [
  { name: 'bellevueDT', x: 10051, z: -129, r0: 150, r1: 215 },   // Bellevue Downtown Park
];
export const terrainFlat = (name) => TERRAIN_FLATS.find((f) => f.name === name);
function fixTerrain(hf) {
  for (const f of TERRAIN_FLATS) {
    let sum = 0, n = 0;
    const idx = (x, z) => Math.round((z + MAP_HALF) / HF_STEP) * HF_N + Math.round((x + MAP_HALF) / HF_STEP);
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      sum += hf[idx(f.x + Math.cos(a) * (f.r1 + 20), f.z + Math.sin(a) * (f.r1 + 20))]; n++;
    }
    f.y = sum / n;
    const i0 = Math.floor((f.x - f.r1 + MAP_HALF) / HF_STEP), i1 = Math.ceil((f.x + f.r1 + MAP_HALF) / HF_STEP);
    const j0 = Math.floor((f.z - f.r1 + MAP_HALF) / HF_STEP), j1 = Math.ceil((f.z + f.r1 + MAP_HALF) / HF_STEP);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i * HF_STEP - MAP_HALF - f.x, j * HF_STEP - MAP_HALF - f.z);
      if (d >= f.r1) continue;
      const t = d <= f.r0 ? 0 : (d - f.r0) / (f.r1 - f.r0), s = t * t * (3 - 2 * t);
      hf[j * HF_N + i] = f.y + (hf[j * HF_N + i] - f.y) * s;
    }
  }
}

/** Raise the ground to at least `y` within r0 of (x, z), blended out to r1.
 *  y 'east' takes the ground 40 m east of the spot. Only ever raises. */
function padTerrain(hf, x, z, { y, r0, r1 }) {
  const at = (px, pz) => hf[Math.round((pz + MAP_HALF) / HF_STEP) * HF_N + Math.round((px + MAP_HALF) / HF_STEP)];
  const Y = y === 'east' ? at(x + 40, z) : y;
  const i0 = Math.floor((x - r1 + MAP_HALF) / HF_STEP), i1 = Math.ceil((x + r1 + MAP_HALF) / HF_STEP);
  const j0 = Math.floor((z - r1 + MAP_HALF) / HF_STEP), j1 = Math.ceil((z + r1 + MAP_HALF) / HF_STEP);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(i * HF_STEP - MAP_HALF - x, j * HF_STEP - MAP_HALF - z);
    if (d >= r1) continue;
    const t = d <= r0 ? 1 : 1 - (d - r0) / (r1 - r0), s = t * t * (3 - 2 * t);
    const k = j * HF_N + i;
    hf[k] = Math.max(hf[k], hf[k] + (Y - hf[k]) * s);
  }
}

/**
 * THE LAKE BEACHES STAND OUT OF THE LAKE. build_raster.py digs every
 * heightfield point with water in its 40 m cell to 1.2 m under the lake,
 * so a lake's drawn shore runs up to a cell inland of the real one -- and the
 * swim beaches, which OSM maps along the waterline, were all under the lake
 * plane: Madison Park, Matthews, Pritchard had no dry sand at all. Each lake
 * beach's dry points within 45 m come back up to 0.6 m over the lake, at
 * load, before anything reads the terrain.
 */
function liftBeaches(hf, beaches, lakes, wet) {
  const wetAt = (x, z) => {
    const i = Math.round((x + MAP_HALF) / MASK_STEP), j = Math.round((z + MAP_HALF) / MASK_STEP);
    return i >= 0 && j >= 0 && i < MASK_N && j < MASK_N && wet[j * MASK_N + i] !== 0;
  };
  for (const b of beaches) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const lake = lakes.find((l) => l.level > 1 && cx >= l.x0 && cx <= l.x1 && cz >= l.z0 && cz <= l.z1);
    if (!lake) continue;
    const R = 45;
    const i0 = Math.floor((x0 - R + MAP_HALF) / HF_STEP), i1 = Math.ceil((x1 + R + MAP_HALF) / HF_STEP);
    const j0 = Math.floor((z0 - R + MAP_HALF) / HF_STEP), j1 = Math.ceil((z1 + R + MAP_HALF) / HF_STEP);
    for (let j = Math.max(0, j0); j <= Math.min(HF_N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(HF_N - 1, i1); i++) {
      const x = i * HF_STEP - MAP_HALF, z = j * HF_STEP - MAP_HALF;
      if (wetAt(x, z)) continue;
      // distance from this point to the beach's outline (or inside it)
      let d = Infinity, inside = false;
      for (let a = 0, k = b.o.length - 1; a < b.o.length; k = a++) {
        const [ax, az] = b.o[k], [bx, bz] = b.o[a];
        if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t));
      }
      if (!inside && d > R) continue;
      const k = j * HF_N + i;
      if (hf[k] < lake.level + 0.6) hf[k] = lake.level + 0.6;
    }
  }
}

export function heightfield() {
  return HF;
}

/** The raw water/green masks, for anything that wants to draw them (the map). */
export function masks() {
  return { water: WET, green: GRN, n: MASK_N, step: MASK_STEP };
}

// A PORTAL CUT IS PART OF THE HEIGHT SURFACE, not a decoration on top of it.
//
// The trench a tunnel mouth needs is 14 m wide and the heightfield is sampled
// every 40 m, so it cannot be baked into the raster. Deforming only the terrain
// MESH does not work either: roads, pavement and every ground query read
// terrainHeight(), so the carriageway stayed at grade and the cut appeared as a
// deck stitched on top of the ground rather than a road descending into it.
//
// Applying it here instead keeps the law in "The one height surface" intact --
// every consumer still reads the same function, and they all see the cut. The
// deformation is analytic, so 40 m sampling costs it nothing; world.js only has
// to tessellate finely enough to draw what this already describes.
let carve = null;
export function setCarve(fn) { carve = fn; }

/** The ground before any portal cut. Only the carve itself may use this. */
export function terrainRaw(x, z) { return sampleHF(x, z); }

export function terrainHeight(x, z) {
  const h = sampleHF(x, z);
  return carve ? h - carve(x, z) : h;
}

function sampleHF(x, z) {
  if (!HF) return 0;
  const fx = (x + MAP_HALF) / HF_STEP;
  const fz = (z + MAP_HALF) / HF_STEP;
  let i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0) i = 0; else if (i > HF_N - 2) i = HF_N - 2;
  if (j < 0) j = 0; else if (j > HF_N - 2) j = HF_N - 2;
  const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1);
  const a = HF[j * HF_N + i], b = HF[j * HF_N + i + 1];
  const c = HF[(j + 1) * HF_N + i], d = HF[(j + 1) * HF_N + i + 1];
  // Interpolate across the TRIANGLE the terrain mesh actually draws, not
  // bilinearly across the cell.
  //
  // This is the "grass growing through the road" that survived three separate
  // fixes, and none of them could have worked: every one of them made the road
  // hug this function more closely, and this function was describing a surface
  // that is not the one on screen. A quad split into two triangles is not a
  // bilinear patch -- inside a cell they differ by (a + d - b - c) / 4, which on
  // a 40 m grid over Queen Anne's grades is metres, not centimetres. Measured
  // before this change, the drawn terrain stood up to 2.13 m above what every
  // consumer believed the ground height to be, on 4.9 % of samples.
  //
  // world.js triangulates each cell as (a, c, b) and (b, c, d), so the split
  // runs along tx + tz = 1. Both triangles are planes through three corners and
  // agree along that diagonal, so the result is continuous.
  //
  // **If the terrain mesh's triangulation changes, this must change with it.**
  return tx + tz <= 1
    ? a + (b - a) * tx + (c - a) * tz
    : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}

function maskAt(m, x, z) {
  if (!m) return 0;
  let i = Math.round((x + MAP_HALF) / MASK_STEP);
  let j = Math.round((z + MAP_HALF) / MASK_STEP);
  if (i < 0 || i >= MASK_N || j < 0 || j >= MASK_N) return 0;
  return m[j * MASK_N + i];
}

/**
 * Is (x,z) over water?
 *
 * A raster lookup, not a polygon walk. This is the single biggest robustness
 * win of the import: a raster cannot double back on itself, and a shoreline
 * that doubled back is what swallowed the whole of Magnolia when the water was
 * hand-drawn.
 */
export function isWater(x, z) {
  return maskAt(WET, x, z) !== 0;
}

/**
 * The height of the water DRAWN over (x, z), wet or dry: the sea plane runs
 * under the whole map at 0, and a lake's plane covers its whole bounding box,
 * dry banks included, at the lake's level; the ship canal's plane sits at
 * Lake Union's. Whatever is lower than this at a point is under the water on
 * screen -- which is how the 520 came to be "underwater near UW": its cutting
 * at the Montlake lid dips under Lake Washington's 5.09 m plane. verify's
 * submerged-road scan checks every road against it.
 */
export function drawnWaterLevel(lakes, x, z) {
  let lv = 0;
  for (const l of lakes || []) {
    if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1 && l.level > lv) lv = l.level;
  }
  const c = shipCanal(lakes || []), cl = c && c.at(x, z);
  if (cl !== null && cl !== undefined && cl > lv) lv = cl;
  return lv;
}

let CANAL;
/**
 * THE SHIP CANAL IS AT LAKE LEVEL, not the sea's. Salmon Bay, the Fremont Cut,
 * Portage Bay and the Montlake Cut are held at Lake Union's level by the
 * Ballard Locks, but the importer labels only the lakes (each by its
 * bounding box, see water.json), so every canal cell answered the sea's 0:
 * a 5.3 m water cliff at each end of Lake Union, and a boat could not leave.
 *
 * The canal is found, not drawn: a flood fill over the water mask from Lake
 * Union's own wet cells, through wet cells outside every lake box, stopped
 * at the Locks' centre gate (the `locks` landmark, whose chamber runs along
 * x). The fill is windowed; if it ever runs away (a mask change joins the
 * canal to the Sound some other way) it gives up and the old behaviour
 * stands, rather than lifting Puget Sound 5 m. Memoised: citygen (what a
 * building over the water stands on) and world (waterLevelAt, the canal's
 * water plane) read the same fill.
 */
export function shipCanal(lakes) {
  if (CANAL !== undefined) return CANAL;
  CANAL = null;
  const lk = (LANDMARKS || []).find((l) => l.kind === 'locks');
  // Lake Union: the lake box holding its middle, by Gas Works' south shore
  const union = lakes.find((l) => 600 >= l.x0 && 600 <= l.x1 && -3000 >= l.z0 && -3000 <= l.z1);
  if (!lk || !union) return null;
  const W = WET, N = MASK_N, S = MASK_STEP;
  if (!W) return null;
  const H = MAP_HALF;
  const cell = (v) => Math.round((v + H) / S);
  // window: the Locks to just past Lake Washington's west shore
  const i0 = cell(lk.x), i1 = cell(3200), j0 = cell(-7600), j1 = cell(-1400);
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  const inBox = (x, z) => {
    for (const l of lakes) if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) return l;
    return null;
  };
  // A point just outside a box rounds to a cell whose centre is inside it,
  // so a canal that stopped at the box's own cells left a 5 m seam at sea
  // level on every box edge (a boat jammed at Lake Union's west edge). The
  // canal reaches one cell INTO a lake's box; the box answers first inside.
  const deepIn = (x, z) => {
    for (const l of lakes) if (x >= l.x0 + S && x <= l.x1 - S && z >= l.z0 + S && z <= l.z1 - S) return l;
    return null;
  };
  const seen = new Uint8Array(w * h), cells = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let qh = 0, qt = 0, count = 0, leak = false;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = (i0 + i) * S - H, z = (j0 + j) * S - H;
    if (W[(j0 + j) * N + i0 + i] && inBox(x, z) === union) { seen[j * w + i] = 1; cells[j * w + i] = 1; queue[qt++] = j * w + i; }
  }
  while (qh < qt) {
    const k = queue[qh++], i = k % w, j = (k - i) / w;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) { leak = true; continue; }
      const nk = nj * w + ni;
      if (seen[nk]) continue;
      seen[nk] = 1;
      if (!W[(j0 + nj) * N + i0 + ni]) continue;
      const x = (i0 + ni) * S - H, z = (j0 + nj) * S - H;
      if (x <= lk.x) continue;                    // the centre gate: sea beyond
      if (deepIn(x, z)) continue;                 // another lake answers itself
      cells[nk] = 1; queue[qt++] = nk;
      if (++count > 40000) { leak = true; qh = qt; break; }
    }
  }
  if (leak || !count) {
    console.warn(`canal: flood fill ${leak ? 'ran out of its window' : 'found nothing'} (${count} cells); canal stays at sea level`);
    return null;
  }
  const level = union.level;
  const at = (x, z) => {
    const i = Math.round((x + H) / S) - i0, j = Math.round((z + H) / S) - j0;
    return i >= 0 && i < w && j >= 0 && j < h && cells[j * w + i] ? level : null;
  };
  CANAL = { cells, i0, j0, w, h, step: S, level, count, union, deepIn, at };
  return CANAL;
}

export function inPark(x, z) {
  return maskAt(GRN, x, z) !== 0;
}

// THE LOT LAYER: paved ground that is not a building -- car parks, plazas,
// yards, commercial hardstanding. data/lots.png, LOT_N^2 samples LOT_STEP
// apart, two bytes each: the share of the sample's own cell that has its code,
// and the code, 0 = none, else 1 + kind * 50 + orientation (tools/build_lots.py
// writes it). It can overlap the park mask (a park's own car park), so anything
// planting on park ground asks `inLot` as well.
//
// `lotCodeAt` is the SAME reconstruction the terrain shader runs (world.js), so
// what the scatter and the parked cars believe is a lot is what is drawn.
export const LOT_ANG = 50;
export const LOT_KINDS = ['parking', 'asphalt', 'plaza', 'hard', 'rail', 'sand'];
export let LOT_N = 1801;
export let LOT_STEP = (MAP_HALF * 2) / (LOT_N - 1);

/** The drawn lot code at (x,z): 0, or 1 + kind * LOT_ANG + orientation. */
export function lotCodeAt(x, z) {
  if (!LOT) return 0;
  const fx = (x + MAP_HALF) / LOT_STEP, fz = (z + MAP_HALF) / LOT_STEP;
  let i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= LOT_N - 1 || j >= LOT_N - 1) return 0;
  const tx = fx - i, tz = fz - j;
  const k0 = (j * LOT_N + i) * 2, k1 = k0 + 2, k2 = k0 + LOT_N * 2, k3 = k2 + 2;
  const c0 = LOT[k0 + 1], c1 = LOT[k1 + 1], c2 = LOT[k2 + 1], c3 = LOT[k3 + 1];
  if (!(c0 | c1 | c2 | c3)) return 0;
  const a0 = LOT[k0] / 255 - 0.5, a1 = LOT[k1] / 255 - 0.5;
  const a2 = LOT[k2] / 255 - 0.5, a3 = LOT[k3] / 255 - 0.5;
  const w0 = (1 - tx) * (1 - tz), w1 = tx * (1 - tz), w2 = (1 - tx) * tz, w3 = tx * tz;
  const sd = (c) => w0 * (c0 === c ? a0 : -a0) + w1 * (c1 === c ? a1 : -a1)
    + w2 * (c2 === c ? a2 : -a2) + w3 * (c3 === c ? a3 : -a3);
  let best = 0, bs = -1;
  for (const c of [c0, c1, c2, c3]) {
    if (!c) continue;
    const s = sd(c);
    if (s > bs) { bs = s; best = c; }
  }
  return bs > 0 ? best : 0;
}

/** Lot kind index at (x,z) -- an index into LOT_KINDS -- or -1. */
export function lotAt(x, z) {
  const c = lotCodeAt(x, z);
  return c ? ((c - 1) / LOT_ANG) | 0 : -1;
}

/** Is (x,z) on a paved lot / plaza / yard? */
export function inLot(x, z) {
  return lotCodeAt(x, z) !== 0;
}

/** Nearest sample's code, unreconstructed: cheap, for the minimap. */
export function lotNearest(x, z) {
  if (!LOT) return 0;
  const i = Math.round((x + MAP_HALF) / LOT_STEP), j = Math.round((z + MAP_HALF) / LOT_STEP);
  if (i < 0 || j < 0 || i >= LOT_N || j >= LOT_N) return 0;
  return LOT[(j * LOT_N + i) * 2 + 1];
}

/** The interleaved (coverage, code) bytes, for the terrain shader's texture. */
export function lotCodes() {
  return LOT;
}

/**
 * Distance to the nearest shoreline, positive on land, capped at MAX.
 *
 * Only ever asked near the shore -- for buildability and the beach blend -- so
 * it walks out in rings from the query point rather than carrying a 2.5 M-cell
 * distance transform around.
 */
const SHORE_MAX = 60;
export function shoreDist(x, z) {
  const wet = isWater(x, z);
  for (let r = MASK_STEP; r <= SHORE_MAX; r += MASK_STEP) {
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / MASK_STEP));
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      if (isWater(x + Math.cos(a) * r, z + Math.sin(a) * r) !== wet) {
        return wet ? -r : r;
      }
    }
  }
  return wet ? -SHORE_MAX : SHORE_MAX;
}

/** True where the ground is dry enough to build or drive on. */
export function isBuildable(x, z) {
  return !isWater(x, z);
}

export function clampToMap(v) {
  return clamp(v, -MAP_HALF + 40, MAP_HALF - 40);
}

/** Nearest mapped neighbourhood name, for the objective line and the HUD. */
export function placeNameAt(x, z) {
  let best = null, bd = Infinity;
  for (let i = 0; i < PLACES.length; i++) {
    const p = PLACES[i];
    const dx = p.x - x, dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = p; }
  }
  return best ? best.n : 'Seattle';
}

export function districtAt(x, z) {
  let best = null, bd = Infinity;
  for (let i = 0; i < PLACES.length; i++) {
    const p = PLACES[i];
    const dx = p.x - x, dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
