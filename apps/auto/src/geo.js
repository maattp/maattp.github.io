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

export let LANDMARKS = [];
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
  WET = md.water;
  GRN = md.green;
  const p = md.places;
  LANDMARKS = p.landmarks;
  PLACES = p.places;
  SPAWN = { x: p.spawn.x, z: p.spawn.z };
  SPAWN_HEADING = p.spawn.heading;
  RESPAWN = { x: p.respawn.x, z: p.respawn.z };
  KEEP_CLEAR = [SPAWN, RESPAWN];
}

export function heightfield() {
  return HF;
}

/** The raw water/green masks, for anything that wants to draw them (the map). */
export function masks() {
  return { water: WET, green: GRN, n: MASK_N, step: MASK_STEP };
}

export function terrainHeight(x, z) {
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

export function inPark(x, z) {
  return maskAt(GRN, x, z) !== 0;
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
