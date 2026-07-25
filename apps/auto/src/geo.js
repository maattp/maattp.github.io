// Seattle geography: coordinate frames, water, terrain, districts, landmarks.
//
// World frame: +X = east, +Z = south, Y = up, 1 unit = 1 metre.
// Origin (0,0) = Westlake Center, 4th Ave & Pine St.
//
// Downtown Seattle's grid is rotated ~32 deg from true north: avenues run
// NNW->SSE, streets run WSW->ENE. North of Denny Way the city snaps back to a
// true north grid. Both are modelled here.

import { DEG, clamp, pointInPoly, polyBounds, distToPolyEdge, sat } from './util.js';

export const MAP_HALF = 5200; // world spans -5200..5200 on both axes (10.4 km)

// ---------------------------------------------------------------------------
// Downtown grid helper
// ---------------------------------------------------------------------------

const AVE_HEADING = 148; // direction of travel along an avenue, heading SE
const AVE_SP = 100; // metres between avenues
const ST_SP = 84; // metres between streets

export const AV = { x: Math.sin(AVE_HEADING * DEG), z: -Math.cos(AVE_HEADING * DEG) };
export const ST = { x: Math.sin((AVE_HEADING - 90) * DEG), z: -Math.cos((AVE_HEADING - 90) * DEG) };
export const DT_ROT = (AVE_HEADING - 90) * DEG; // heading of the street axis

/** Downtown grid coords -> world. `ave` = avenue number (4 = 4th Ave), `st` = street index (0 = Pine). */
export function dt(ave, st) {
  const a = (ave - 4) * AVE_SP;
  const b = st * ST_SP;
  return [ST.x * a + AV.x * b, ST.z * a + AV.z * b];
}

// Street index table for the downtown grid (0 = Pine St, increasing southeast).
export const DT_STREETS = [
  ['Broad St', -10],
  ['Clay St', -9.2],
  ['Denny Way', -8.3],
  ['Battery St', -7],
  ['Bell St', -6],
  ['Blanchard St', -5],
  ['Lenora St', -4],
  ['Virginia St', -3],
  ['Stewart St', -2],
  ['Olive Way', -1],
  ['Pine St', 0],
  ['Pike St', 1],
  ['Union St', 2],
  ['University St', 3],
  ['Seneca St', 4],
  ['Spring St', 5],
  ['Madison St', 6],
  ['Marion St', 7],
  ['Columbia St', 8],
  ['Cherry St', 9],
  ['James St', 10],
  ['Yesler Way', 11],
  ['S Washington St', 12],
  ['S Main St', 13],
  ['S Jackson St', 14],
  ['S King St', 15],
  ['S Weller St', 16],
  ['S Dearborn St', 17],
];

export const DT_AVENUES = [
  ['Alaskan Way', -2.6],
  ['Western Ave', -1.6],
  ['1st Ave', 1],
  ['2nd Ave', 2],
  ['3rd Ave', 3],
  ['4th Ave', 4],
  ['5th Ave', 5],
  ['6th Ave', 6],
  ['7th Ave', 7],
  ['8th Ave', 8],
  ['9th Ave', 9],
  ['Boren Ave', 10.2],
  ['Terry Ave', 11.2],
  ['Broadway', 12.6],
];

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

const dtShore = (st) => dt(-3, st);

export const WATER = [
  {
    name: 'Elliott Bay',
    poly: [
      [-5300, -5300], [-4900, -4600], [-4600, -3900], [-4300, -3300], [-4150, -3120],
      // around the Magnolia bluff: Discovery Park's west shore, then east along
      // Magnolia's south shore into Smith Cove
      [-4020, -2800], [-3900, -2400], [-3700, -2050], [-3300, -1880], [-2900, -1820],
      [-2600, -1880], [-2350, -1960], [-2150, -2160], [-1990, -2300], [-1900, -2080],
      // The Belltown-to-Interbay shore drifted progressively east going north --
      // about 450 m of it by Seattle Center, which left only metres of land
      // between 1st Ave N and the bay and put Climate Pledge Arena on the beach.
      // Pulled back west; re-run the land/water probe in CLAUDE.md after editing.
      [-1980, -1880], [-1930, -1620], [-1850, -1320], [-1650, -980], dtShore(-14), dtShore(-8),
      dtShore(0), dtShore(6), dtShore(12), dtShore(15.5),
      [-150, 1700], [-330, 2000], [-380, 2400], [-400, 3000], [-430, 3600],
      [-520, 4400], [-700, 5300], [-1750, 5300], [-1700, 4300], [-1750, 3400],
      [-1900, 2900], [-2300, 2500], [-2900, 2200], [-3600, 2000], [-4200, 1400],
      [-5300, 900],
    ],
  },
  {
    name: 'Lake Union',
    poly: [[-880, -3480], [240, -3480], [300, -2600], [130, -1780], [-360, -1620], [-720, -1950], [-890, -2750]],
  },
  {
    name: 'Lake Washington Ship Canal',
    poly: [[-4250, -3920], [-3400, -3880], [-820, -3780], [-830, -3470], [-3400, -3420], [-4250, -3470]],
  },
  {
    name: 'Portage Bay',
    poly: [[230, -3520], [1260, -3470], [1310, -2990], [420, -2940], [180, -3150]],
  },
  {
    name: 'Montlake Cut',
    poly: [[1240, -3580], [1830, -3600], [1830, -3400], [1240, -3390]],
  },
  {
    name: 'Lake Washington',
    poly: [
      [1830, -3720], [2400, -3350], [3300, -2650], [5300, -2700], [5300, 5300],
      [3250, 5300], [3400, 3600], [3380, 2000], [3480, 400], [3400, -1200], [1830, -3420],
    ],
  },
  {
    name: 'Green Lake',
    poly: [[-1520, -5020], [-980, -5080], [-790, -4740], [-1080, -4500], [-1460, -4620]],
  },
];

export const ISLANDS = [
  { name: 'Harbor Island', poly: [[-1360, 2150], [-740, 2200], [-710, 2900], [-1340, 2860]] },
];

const waterBounds = WATER.map((w) => polyBounds(w.poly));
const islandBounds = ISLANDS.map((w) => polyBounds(w.poly));

export function isWater(x, z) {
  for (let i = 0; i < ISLANDS.length; i++) {
    const b = islandBounds[i];
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInPoly(x, z, ISLANDS[i].poly)) return false;
  }
  for (let i = 0; i < WATER.length; i++) {
    const b = waterBounds[i];
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInPoly(x, z, WATER[i].poly)) return true;
  }
  return false;
}

/** Signed-ish distance to the nearest shoreline (positive on land, negative in water). */
export function shoreDist(x, z) {
  let best = 1e9;
  for (let i = 0; i < WATER.length; i++) {
    const b = waterBounds[i];
    if (x < b.x0 - 200 || x > b.x1 + 200 || z < b.z0 - 200 || z > b.z1 + 200) continue;
    const d = distToPolyEdge(x, z, WATER[i].poly);
    if (d < best) best = d;
  }
  for (let i = 0; i < ISLANDS.length; i++) {
    const b = islandBounds[i];
    if (x < b.x0 - 200 || x > b.x1 + 200 || z < b.z0 - 200 || z > b.z1 + 200) continue;
    const d = distToPolyEdge(x, z, ISLANDS[i].poly);
    if (d < best) best = d;
  }
  return isWater(x, z) ? -best : best;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

// Smooth cosine bumps. Seattle is famously seven hills; these are the ones that
// matter for driving.
const HILLS = [
  { x: -1400, z: -2060, r: 1000, h: 132 }, // Queen Anne Hill
  { x: 1520, z: -950, r: 1150, h: 128 }, // Capitol Hill
  { x: 800, z: 200, r: 1400, h: 95 }, // First Hill / downtown slope
  { x: 1250, z: 2450, r: 1350, h: 106 }, // Beacon Hill
  { x: -2950, z: -2550, r: 1300, h: 88 }, // Magnolia
  { x: -2750, z: 3350, r: 1750, h: 116 }, // West Seattle
  { x: 2650, z: -2500, r: 950, h: 74 }, // Montlake / Interlaken
  { x: 2950, z: 850, r: 1000, h: 66 }, // Madrona ridge
  { x: 2450, z: 3450, r: 1150, h: 72 }, // Mount Baker
  { x: -1900, z: -4650, r: 2400, h: 48 }, // Phinney / Ballard rise
  { x: 550, z: -4800, r: 2200, h: 52 }, // Wallingford / Green Lake plateau
  { x: 2000, z: -4400, r: 1200, h: 34 }, // Ravenna
  { x: -1000, z: 4500, r: 1400, h: 42 }, // Delridge
  { x: 900, z: 4400, r: 1200, h: 40 }, // Georgetown rise
];

const BASE_H = 5;

export function landHeight(x, z) {
  let h = BASE_H;
  for (let i = 0; i < HILLS.length; i++) {
    const hi = HILLS[i];
    const dx = x - hi.x,
      dz = z - hi.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= hi.r) continue;
    const c = Math.cos((Math.PI / 2) * (d / hi.r));
    h += hi.h * c * c;
  }
  return h;
}

const WATER_FLOOR = -9;

/** Ground height including water basins, with a soft beach blend at the shore. */
export function rawTerrainHeight(x, z) {
  const land = landHeight(x, z);
  const sd = shoreDist(x, z);
  if (sd >= 60) return land;
  if (sd <= -70) return WATER_FLOOR;
  // sd in (-70, 60): blend from land down into the basin.
  const t = sat((sd + 70) / 130);
  const e = t * t * (3 - 2 * t);
  return WATER_FLOOR + (land - WATER_FLOOR) * e;
}

// The raw height function is expensive (polygon distance tests), so it is baked
// once into a heightfield. Everything after boot -- terrain mesh, roads, cars,
// pedestrians -- reads the SAME bilinear surface, so nothing ever floats or
// sinks relative to the ground it is drawn on.
export const HF_STEP = 40;
export const HF_N = Math.round((MAP_HALF * 2) / HF_STEP) + 1;
let HF = null;

export function* bakeHeightfield() {
  const f = new Float32Array(HF_N * HF_N);
  for (let j = 0; j < HF_N; j++) {
    const z = -MAP_HALF + j * HF_STEP;
    for (let i = 0; i < HF_N; i++) {
      f[j * HF_N + i] = rawTerrainHeight(-MAP_HALF + i * HF_STEP, z);
    }
    if (j % 12 === 0) yield j / HF_N;
  }
  HF = f;
}

export function heightfield() {
  return HF;
}

export function terrainHeight(x, z) {
  if (!HF) return rawTerrainHeight(x, z);
  const fx = (x + MAP_HALF) / HF_STEP;
  const fz = (z + MAP_HALF) / HF_STEP;
  let i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0) i = 0; else if (i > HF_N - 2) i = HF_N - 2;
  if (j < 0) j = 0; else if (j > HF_N - 2) j = HF_N - 2;
  const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1);
  const a = HF[j * HF_N + i], b = HF[j * HF_N + i + 1];
  const c = HF[(j + 1) * HF_N + i], d = HF[(j + 1) * HF_N + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** True where the ground is dry enough to build/drive on. */
export function isBuildable(x, z) {
  return shoreDist(x, z) > 14;
}

// ---------------------------------------------------------------------------
// Districts
// ---------------------------------------------------------------------------
//
// Each district describes a rotated grid of streets plus the kind of buildings
// that fill its blocks. `rot` is the heading (radians) of the "A" road axis.
//
// style: tower | midrise | brick | lowrise | house | industrial | campus

const DTQ = (a0, s0, a1, s1) => [dt(a0, s0), dt(a1, s0), dt(a1, s1), dt(a0, s1)];
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

export const DISTRICTS = [
  {
    id: 'downtown', name: 'Downtown', rot: DT_ROT, ox: 0, oz: 0, spA: AVE_SP, spB: ST_SP,
    poly: DTQ(-2.2, -2.7, 8.4, 11.6), style: 'tower', minH: 45, maxH: 140, cover: 0.94, arterial: 2,
  },
  {
    id: 'belltown', name: 'Belltown', rot: DT_ROT, ox: 0, oz: 0, spA: AVE_SP, spB: ST_SP,
    poly: DTQ(-2.2, -9.6, 7.4, -2.7), style: 'midrise', minH: 24, maxH: 88, cover: 0.9, arterial: 3,
  },
  {
    id: 'pioneer', name: 'Pioneer Square', rot: DT_ROT, ox: 0, oz: 0, spA: AVE_SP, spB: ST_SP,
    poly: DTQ(-2.4, 11.6, 6.4, 14.2), style: 'brick', minH: 16, maxH: 44, cover: 0.95, arterial: 3,
  },
  {
    id: 'id', name: 'Chinatown-International District', rot: DT_ROT, ox: 0, oz: 0, spA: AVE_SP, spB: ST_SP,
    poly: DTQ(1.4, 14.2, 10.4, 18.4), style: 'brick', minH: 12, maxH: 40, cover: 0.9, arterial: 3,
  },
  {
    id: 'firsthill', name: 'First Hill', rot: DT_ROT, ox: 0, oz: 0, spA: AVE_SP, spB: ST_SP,
    poly: DTQ(8.4, 1.5, 14.5, 14.2), style: 'midrise', minH: 20, maxH: 76, cover: 0.82, arterial: 3,
  },
  {
    id: 'denny', name: 'Denny Triangle', rot: DT_ROT, ox: 0, oz: 0, spA: AVE_SP, spB: ST_SP,
    poly: DTQ(7.4, -6.2, 13.4, 1.5), style: 'tower', minH: 30, maxH: 120, cover: 0.86, arterial: 3,
  },
  {
    id: 'slu', name: 'South Lake Union', rot: 0, ox: -180, oz: -900, spA: 150, spB: 122,
    poly: rect(-700, -1650, 320, -260), style: 'midrise', minH: 26, maxH: 92, cover: 0.85, arterial: 3,
  },
  {
    id: 'uptown', name: 'Uptown', rot: 0, ox: -1150, oz: -1000, spA: 130, spB: 118,
    poly: rect(-1620, -1560, -700, -420), style: 'lowrise', minH: 12, maxH: 42, cover: 0.78, arterial: 3,
  },
  {
    id: 'lqa', name: 'Lower Queen Anne', rot: 0, ox: -1150, oz: -1000, spA: 130, spB: 118,
    poly: rect(-2150, -2500, -1500, -900), style: 'lowrise', minH: 10, maxH: 34, cover: 0.7, arterial: 3,
  },
  {
    id: 'qa', name: 'Queen Anne', rot: 0, ox: -1400, oz: -2060, spA: 108, spB: 96,
    poly: rect(-1980, -2760, -830, -1420), style: 'house', minH: 7, maxH: 15, cover: 0.66, arterial: 4,
  },
  {
    id: 'caphill', name: 'Capitol Hill', rot: 0, ox: 1100, oz: -900, spA: 120, spB: 96,
    poly: rect(700, -1780, 2350, -180), style: 'lowrise', minH: 11, maxH: 38, cover: 0.78, arterial: 4,
  },
  {
    id: 'eastlake', name: 'Eastlake', rot: 0, ox: 480, oz: -2500, spA: 110, spB: 96,
    poly: rect(300, -3420, 780, -1550), style: 'lowrise', minH: 9, maxH: 26, cover: 0.7, arterial: 4,
  },
  {
    id: 'cd', name: 'Central District', rot: 0, ox: 2400, oz: 600, spA: 118, spB: 96,
    poly: rect(1780, -180, 3320, 1450), style: 'house', minH: 7, maxH: 16, cover: 0.66, arterial: 4,
  },
  {
    id: 'sodo', name: 'SoDo', rot: 0, ox: 200, oz: 2000, spA: 210, spB: 170,
    poly: rect(-370, 1180, 900, 3250), style: 'industrial', minH: 8, maxH: 26, cover: 0.8, arterial: 3,
  },
  {
    id: 'beacon', name: 'Beacon Hill', rot: 0, ox: 1250, oz: 2450, spA: 118, spB: 96,
    poly: rect(650, 1500, 1900, 4250), style: 'house', minH: 7, maxH: 15, cover: 0.62, arterial: 5,
  },
  {
    id: 'georgetown', name: 'Georgetown', rot: 0, ox: 800, oz: 4200, spA: 170, spB: 140,
    poly: rect(330, 3900, 1350, 4800), style: 'industrial', minH: 8, maxH: 22, cover: 0.7, arterial: 3,
  },
  {
    id: 'rainier', name: 'Mount Baker', rot: 0, ox: 2600, oz: 3000, spA: 122, spB: 100,
    poly: rect(1950, 1900, 3350, 4400), style: 'house', minH: 7, maxH: 16, cover: 0.6, arterial: 5,
  },
  {
    id: 'madrona', name: 'Madrona', rot: 0, ox: 3050, oz: 700, spA: 118, spB: 96,
    poly: rect(2900, -900, 3400, 1900), style: 'house', minH: 7, maxH: 14, cover: 0.55, arterial: 4,
  },
  {
    id: 'montlake', name: 'Montlake', rot: 0, ox: 2100, oz: -2700, spA: 118, spB: 96,
    poly: rect(1700, -3200, 3100, -1900), style: 'house', minH: 7, maxH: 16, cover: 0.58, arterial: 4,
  },
  {
    id: 'fremont', name: 'Fremont', rot: 0, ox: -1050, oz: -4100, spA: 116, spB: 96,
    poly: rect(-1750, -4560, -520, -3800), style: 'lowrise', minH: 9, maxH: 30, cover: 0.74, arterial: 3,
  },
  {
    id: 'wallingford', name: 'Wallingford', rot: 0, ox: 100, oz: -4200, spA: 116, spB: 96,
    poly: rect(-520, -4700, 780, -3820), style: 'house', minH: 7, maxH: 17, cover: 0.66, arterial: 4,
  },
  {
    id: 'udistrict', name: 'University District', rot: 0, ox: 1400, oz: -4000, spA: 118, spB: 96,
    poly: rect(850, -4700, 2100, -3500), style: 'midrise', minH: 12, maxH: 58, cover: 0.78, arterial: 3,
  },
  {
    id: 'ballard', name: 'Ballard', rot: 0, ox: -3400, oz: -4000, spA: 116, spB: 96,
    poly: rect(-4350, -4600, -2500, -3480), style: 'lowrise', minH: 9, maxH: 28, cover: 0.72, arterial: 4,
  },
  {
    id: 'phinney', name: 'Phinney Ridge', rot: 0, ox: -2000, oz: -4800, spA: 116, spB: 96,
    poly: rect(-2500, -5150, -1250, -4380), style: 'house', minH: 7, maxH: 16, cover: 0.62, arterial: 4,
  },
  {
    id: 'greenlake', name: 'Green Lake', rot: 0, ox: -600, oz: -4900, spA: 116, spB: 96,
    poly: rect(-1250, -5150, 900, -4640), style: 'house', minH: 7, maxH: 18, cover: 0.6, arterial: 4,
  },
  {
    id: 'ravenna', name: 'Ravenna', rot: 0, ox: 1600, oz: -4800, spA: 118, spB: 96,
    poly: rect(900, -5150, 2600, -4640), style: 'house', minH: 7, maxH: 16, cover: 0.58, arterial: 4,
  },
  {
    id: 'magnolia', name: 'Magnolia', rot: 0, ox: -2950, oz: -2550, spA: 120, spB: 100,
    poly: rect(-3750, -3350, -2280, -1900), style: 'house', minH: 7, maxH: 15, cover: 0.55, arterial: 5,
  },
  {
    id: 'interbay', name: 'Interbay', rot: 0, ox: -2100, oz: -3000, spA: 190, spB: 160,
    poly: rect(-2400, -3400, -1700, -2350), style: 'industrial', minH: 7, maxH: 18, cover: 0.6, arterial: 3,
  },
  {
    id: 'harborisland', name: 'Harbor Island', rot: 0, ox: -1050, oz: 2500, spA: 200, spB: 170,
    poly: rect(-1330, 2200, -760, 2860), style: 'industrial', minH: 8, maxH: 24, cover: 0.66, arterial: 3,
  },
  {
    id: 'alki', name: 'Alki', rot: 0, ox: -2900, oz: 2600, spA: 118, spB: 96,
    poly: rect(-3500, 2280, -2050, 2900), style: 'lowrise', minH: 8, maxH: 22, cover: 0.62, arterial: 4,
  },
  {
    id: 'junction', name: 'West Seattle', rot: 0, ox: -2600, oz: 3600, spA: 120, spB: 98,
    poly: rect(-3400, 2900, -1800, 4700), style: 'house', minH: 7, maxH: 22, cover: 0.62, arterial: 4,
  },
  {
    id: 'delridge', name: 'Delridge', rot: 0, ox: -1500, oz: 3900, spA: 120, spB: 100,
    poly: rect(-1800, 3050, -1250, 4900), style: 'house', minH: 7, maxH: 15, cover: 0.55, arterial: 4,
  },
];

const districtBounds = DISTRICTS.map((d) => polyBounds(d.poly));
const districtBoundsFor = new Map();
DISTRICTS.forEach((d, i) => districtBoundsFor.set(d, districtBounds[i]));

export function pointInPolyCached(x, z, d) {
  const b = districtBoundsFor.get(d);
  if (b && (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1)) return false;
  return pointInPoly(x, z, d.poly);
}

export function districtAt(x, z) {
  for (let i = 0; i < DISTRICTS.length; i++) {
    const b = districtBounds[i];
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInPoly(x, z, DISTRICTS[i].poly)) return DISTRICTS[i];
  }
  return null;
}

export function placeNameAt(x, z) {
  const d = districtAt(x, z);
  if (d) return d.name;
  if (isWater(x, z)) {
    let best = null,
      bd = 1e9;
    for (let i = 0; i < WATER.length; i++) {
      const b = waterBounds[i];
      const cx = (b.x0 + b.x1) / 2,
        cz = (b.z0 + b.z1) / 2;
      const dd = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (pointInPoly(x, z, WATER[i].poly) && dd < bd) {
        bd = dd;
        best = WATER[i].name;
      }
    }
    if (best) return best;
  }
  return 'Seattle';
}

// ---------------------------------------------------------------------------
// Highways, arterials and bridges (hand-authored polylines)
// ---------------------------------------------------------------------------
//
// pts: [x, z, y?]  -- if y is present the road is a deck at that height and
// gets pillars + guard rails. Otherwise it follows the terrain.

export const HIGHWAYS = [
  {
    name: 'I-5', cls: 'hwy', lanes: 8,
    pts: [
      [700, -5150, 60], [660, -4500, 56], [640, -4100, 50], [620, -3500, 46], [610, -3050, 34],
      [600, -2500, 40], [590, -1900, 46], [520, -1400, 44], [430, -1000, 42],
      [...dt(7.6, -3.4), 40], [...dt(7.8, 0), 44], [...dt(8.0, 4), 48], [...dt(8.2, 8), 46],
      [...dt(8.6, 12), 40], [...dt(9.6, 16), 34], [1150, 1700, 30], [1250, 2300, 34],
      [1330, 3100, 40], [1400, 4000, 46], [1450, 5150, 48],
    ],
  },
  {
    name: 'Aurora Ave N (SR 99)', cls: 'hwy', lanes: 6,
    pts: [
      [-960, -5150], [-940, -4500], [-900, -4180], [-870, -4100, 46], [-850, -3600, 52],
      [-830, -3200, 46], [-800, -2900], [-760, -2400], [-700, -1900], [-640, -1500],
    ],
  },
  {
    name: 'SR 99', cls: 'hwy', lanes: 4,
    pts: [[-640, -1500], [-560, -1000], [...dt(-1.0, -6)], [...dt(-1.6, 2)], [...dt(-1.6, 10)], [-120, 1500], [-60, 2200], [30, 3000], [90, 3900], [140, 5150]],
  },
  {
    name: 'I-90', cls: 'hwy', lanes: 6,
    pts: [
      [...dt(10.4, 16.4), 22], [1200, 1320, 24], [1750, 1420, 30], [2350, 1500, 26],
      [2950, 1560, 18], [3350, 1600, 12], [3900, 1620, 8], [5150, 1650, 8],
    ],
  },
  {
    name: 'SR 520', cls: 'hwy', lanes: 6,
    pts: [[620, -2820, 40], [1100, -2860, 30], [1700, -2920, 22], [2350, -3000, 16], [3000, -3080, 9], [3600, -3130, 8], [5150, -3180, 8]],
  },
  {
    name: 'West Seattle Bridge', cls: 'hwy', lanes: 6,
    pts: [[-180, 2700, 12], [-420, 2740, 34], [-800, 2790, 46], [-1250, 2830, 46], [-1650, 2870, 40], [-1980, 2900, 24], [-2250, 2950, 14]],
  },
  { name: 'Ballard Bridge', cls: 'art', lanes: 4, pts: [[-3450, -3280, 12], [-3450, -3600, 18], [-3450, -3980, 12]] },
  { name: 'Fremont Bridge', cls: 'art', lanes: 4, pts: [[-1060, -3330, 10], [-1060, -3620, 13], [-1060, -3900, 10]] },
  { name: 'University Bridge', cls: 'art', lanes: 4, pts: [[900, -2900, 12], [900, -3250, 16], [900, -3600, 12]] },
  { name: 'Montlake Bridge', cls: 'art', lanes: 4, pts: [[1520, -3320, 12], [1520, -3500, 16], [1520, -3660, 12]] },
];

// Surface arterials that stitch the neighbourhoods together.
export const ARTERIALS = [
  // Denny Way and Mercer St are the south and north edges of Seattle Center, so
  // where they sit decides whether the campus has streets through it. Both were
  // drawn too far south -- Mercer by nearly 400 m, which ran it straight past
  // the Space Needle. Placed from real latitudes: Denny at 5th Ave N is
  // 47.6185, Mercer is 47.6246.
  { name: 'Denny Way', pts: [[-1650, -700], [-1100, -740], [-700, -770], [-330, -790], [200, -810], [700, -830], [1250, -850], [1900, -870], [2600, -890], [3250, -910]] },
  { name: 'Mercer St', pts: [[-1700, -1455], [-1200, -1462], [-700, -1469], [-200, -1476], [300, -1483], [700, -1490]] },
  // Elliott Ave W hugs the waterfront below the Queen Anne bluff. It used to cut
  // the corner at [-1180,-900], which is inside the Seattle Center campus and
  // about 400 m inland of where the road actually is.
  { name: 'Elliott Ave W', pts: [[...dt(-1.6, -8)], [-1430, -760], [-1520, -1150], [-1620, -1560], [-1760, -2000], [-1900, -2450], [-2060, -2950], [-2200, -3400]] },
  { name: '15th Ave W', pts: [[-2200, -3400], [-2600, -3480], [-3000, -3420], [-3450, -3280]] },
  // Queen Anne Ave N runs up the west side of the campus, not through it: it is
  // the block past 1st Ave N, which is the campus's own western boundary.
  { name: 'Queen Anne Ave N', pts: [[-1440, -800], [-1445, -1100], [-1450, -1600], [-1460, -2100], [-1470, -2600], [-1480, -2900]] },
  { name: 'Westlake Ave N', pts: [[-260, -640], [-420, -1100], [-560, -1600], [-680, -2100], [-800, -2700], [-870, -3200], [-960, -3600]] },
  { name: 'Dexter Ave N', pts: [[-520, -640], [-560, -1200], [-600, -1900], [-640, -2600], [-680, -3300]] },
  { name: 'Fairview Ave N', pts: [[100, -640], [80, -1200], [60, -1700], [130, -2100]] },
  { name: 'Eastlake Ave E', pts: [[300, -1300], [380, -1800], [430, -2400], [470, -3000], [520, -3400], [700, -3700], [900, -3900]] },
  { name: 'Boren Ave', pts: [[...dt(10.2, -6)], [...dt(10.2, 0)], [...dt(10.2, 8)], [...dt(10.2, 16)]] },
  { name: 'Broadway', pts: [[...dt(12.6, 5)], [800, -300], [810, -800], [820, -1300], [830, -1750]] },
  { name: '12th Ave E', pts: [[...dt(13.8, 8)], [1120, -250], [1130, -800], [1140, -1400], [1150, -1780]] },
  { name: '15th Ave E', pts: [[1400, -220], [1410, -800], [1420, -1400], [1430, -1780], [1450, -2400], [1500, -2900], [1520, -3300]] },
  { name: '23rd Ave', pts: [[2050, 1400], [2040, 700], [2030, 0], [2020, -700], [2010, -1400], [2000, -1900], [2050, -2500], [2100, -3000]] },
  { name: 'MLK Jr Way S', pts: [[2500, -300], [2520, 600], [2560, 1500], [2600, 2400], [2650, 3300], [2700, 4200]] },
  { name: 'Rainier Ave S', pts: [[...dt(12.4, 17.4)], [1500, 1400], [1750, 2100], [2000, 2800], [2250, 3500], [2500, 4200], [2700, 4900]] },
  { name: 'Beacon Ave S', pts: [[1150, 1600], [1200, 2400], [1250, 3200], [1300, 4000], [1350, 4700]] },
  { name: '4th Ave S', pts: [[...dt(4, 17.4)], [420, 1400], [430, 2000], [440, 2700], [450, 3400], [470, 4100], [500, 4800]] },
  { name: '1st Ave S', pts: [[...dt(1, 17.4)], [110, 1400], [90, 2100], [70, 2800], [60, 3500], [70, 4200], [90, 4800]] },
  { name: 'E Marginal Way S', pts: [[-150, 1500], [-220, 2200], [-260, 2900], [-300, 3600], [-340, 4300], [-380, 4900]] },
  { name: 'S Spokane St', pts: [[-180, 2700], [200, 2690], [700, 2680], [1150, 2670]] },
  { name: 'S Lander St', pts: [[-260, 2200], [200, 2190], [700, 2180], [1150, 2170]] },
  { name: 'S Holgate St', pts: [[-300, 1800], [200, 1790], [700, 1780], [1150, 1770]] },
  // Alaskan Way is the waterfront road. Its north end was [-1150,-1000], which
  // is the Space Needle -- a seawall road terminating in the middle of Seattle
  // Center, and the reason MoPOP had a street through it. It now stops where
  // the pier front does, by Broad St.
  { name: 'Alaskan Way', pts: [[-1230, -560], [...dt(-2.6, -8)], [...dt(-2.6, 0)], [...dt(-2.6, 8)], [...dt(-2.6, 15)], [-120, 1600]] },
  { name: 'N 45th St', pts: [[-1700, -4180], [-1100, -4190], [-500, -4200], [200, -4210], [900, -4220], [1600, -4230], [2400, -4240]] },
  { name: 'N 34th St', pts: [[-1700, -3900], [-1300, -3890], [-1060, -3900], [-700, -3880], [-300, -3870], [200, -3860]] },
  { name: 'NW Market St', pts: [[-4300, -4080], [-3800, -4070], [-3450, -4060], [-3000, -4050], [-2600, -4040]] },
  { name: '15th Ave NW', pts: [[-3450, -3980], [-3460, -4400], [-3470, -4900], [-3480, -5150]] },
  { name: 'Leary Way NW', pts: [[-2600, -4040], [-2200, -4000], [-1900, -3960], [-1750, -3940]] },
  { name: 'Aurora Ave N (north)', pts: [[-960, -5150], [-950, -4700], [-945, -4400]] },
  { name: 'Greenwood Ave N', pts: [[-1900, -5150], [-1890, -4700], [-1880, -4380]] },
  { name: 'Phinney Ave N', pts: [[-1700, -5150], [-1690, -4700], [-1680, -4200], [-1690, -3960]] },
  { name: 'Roosevelt Way NE', pts: [[1200, -5150], [1210, -4700], [1220, -4200], [1230, -3800], [1150, -3600]] },
  { name: 'University Way NE', pts: [[1450, -4700], [1460, -4200], [1470, -3700]] },
  { name: 'NE 45th St', pts: [[900, -4230], [1600, -4240], [2100, -4250], [2600, -4260]] },
  { name: '35th Ave SW', pts: [[-2600, 2900], [-2620, 3500], [-2640, 4200], [-2660, 4900]] },
  { name: 'California Ave SW', pts: [[-2900, 2400], [-2920, 3100], [-2940, 3800], [-2960, 4500], [-2980, 5000]] },
  { name: 'Fauntleroy Way SW', pts: [[-2250, 2950], [-2400, 3400], [-2550, 3900], [-2700, 4400], [-2850, 4900]] },
  { name: 'Delridge Way SW', pts: [[-1500, 3050], [-1520, 3700], [-1540, 4400], [-1560, 5000]] },
  { name: 'Harbor Ave SW', pts: [[-2250, 2950], [-2500, 2700], [-2800, 2480], [-3200, 2400]] },
  { name: 'Airport Way S', pts: [[...dt(9.4, 17.4)], [960, 1600], [980, 2400], [1000, 3200], [1020, 4000], [1040, 4700]] },
  { name: 'W Dravus St', pts: [[-2200, -2800], [-2600, -2790], [-3000, -2780], [-3400, -2770]] },
  { name: 'Magnolia Blvd W', pts: [[-3400, -2770], [-3600, -2400], [-3650, -2000], [-3400, -1950], [-2900, -1930]] },
];

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------
//
// Hand-placed skyline towers, so the profile actually reads as Seattle.
// [x, z, footprintW, footprintD, height, kind]

export const TOWERS = [
  { p: dt(5.1, 8.1), w: 62, d: 62, h: 285, kind: 'columbia', name: 'Columbia Center' },
  { p: dt(4.6, 3.1), w: 52, d: 52, h: 259, kind: 'glass', name: 'Rainier Square Tower' },
  { p: dt(3.1, 2.4), w: 48, d: 48, h: 235, kind: 'wamu', name: '1201 Third Avenue' },
  { p: dt(6.2, 2.2), w: 46, d: 46, h: 226, kind: 'glass', name: 'Two Union Square' },
  { p: dt(5.3, 9.2), w: 44, d: 44, h: 220, kind: 'stone', name: 'Seattle Municipal Tower' },
  { p: dt(4.4, 3.6), w: 40, d: 40, h: 201, kind: 'glass', name: 'F5 Tower' },
  { p: dt(2.5, 0.4), w: 42, d: 42, h: 182, kind: 'glass', name: 'Russell Investments Center' },
  { p: dt(6.1, 3.2), w: 40, d: 40, h: 174, kind: 'stone', name: 'One Union Square' },
  { p: dt(3.4, 6.3), w: 40, d: 40, h: 158, kind: 'stone', name: 'Wells Fargo Center' },
  { p: dt(5.2, 5.3), w: 38, d: 38, h: 154, kind: 'glass', name: 'Fifth & Madison' },
  { p: dt(2.4, 4.4), w: 36, d: 36, h: 144, kind: 'stone', name: 'Norton Building' },
  { p: dt(7.2, 5.2), w: 38, d: 38, h: 148, kind: 'glass', name: 'Seventh & Seneca' },
  { p: dt(2.2, 11.1), w: 30, d: 30, h: 149, kind: 'smith', name: 'Smith Tower' },
  { p: [-430, -1040], w: 44, d: 44, h: 160, kind: 'glass', name: 'Doppler' },
  { p: [-250, -1250], w: 40, d: 40, h: 143, kind: 'glass', name: 'Day 1 Tower' },
  { p: [-120, -820], w: 38, d: 38, h: 120, kind: 'glass', name: 'Nitro North' },
  { p: dt(9.4, -2.6), w: 40, d: 40, h: 138, kind: 'glass', name: 'Westin Building' },
  { p: dt(8.4, -4.4), w: 36, d: 36, h: 126, kind: 'glass', name: '2+U Tower' },
  { p: dt(2.2, -5.4), w: 34, d: 34, h: 118, kind: 'glass', name: 'Insignia Towers' },
  { p: dt(3.2, -6.2), w: 32, d: 32, h: 104, kind: 'glass', name: 'Belltown Heights' },
  { p: [1150, 260], w: 60, d: 46, h: 78, kind: 'stone', name: 'Harborview Medical Center' },
  { p: [1400, -3980], w: 54, d: 40, h: 62, kind: 'stone', name: 'UW Campus' },
];

export const LANDMARKS = [
  // Seattle Center, placed from real coordinates about Westlake Center. The
  // cluster used to sit 140-290 m west of true, which is what pushed the Arena
  // onto the Elliott Bay shoreline. Needle 47.6205/-122.3493, MoPOP
  // 47.6215/-122.3486, Arena 47.6219/-122.3539.
  { kind: 'spaceNeedle', name: 'Space Needle', x: -856, z: -1013, rot: 0 },
  { kind: 'mopop', name: 'MoPOP', x: -803, z: -1124, rot: 0.4 },
  { kind: 'arena', name: 'Climate Pledge Arena', x: -1201, z: -1169, rot: 0 },
  { kind: 'spheres', name: 'The Spheres', x: -345, z: -905, rot: 0 },
  { kind: 'market', name: 'Pike Place Market', p: dt(1.35, 1.0), rot: DT_ROT },
  { kind: 'wheel', name: 'Seattle Great Wheel', p: dt(-3.1, 3.4), rot: DT_ROT },
  { kind: 'aquarium', name: 'Seattle Aquarium', p: dt(-3.0, 0.4), rot: DT_ROT },
  { kind: 'ferry', name: 'Colman Dock', p: dt(-3.2, 7.4), rot: DT_ROT },
  { kind: 'library', name: 'Seattle Central Library', p: dt(4.5, 5.6), rot: DT_ROT },
  { kind: 'stadiumF', name: 'Lumen Field', x: 240, z: 1480, rot: 0 },
  { kind: 'stadiumB', name: 'T-Mobile Park', x: 300, z: 1880, rot: 0 },
  { kind: 'gasworks', name: 'Gas Works Park', x: -260, z: -3640, rot: 0 },
  { kind: 'troll', name: 'Fremont Troll', x: -965, z: -3810, rot: 0.3 },
  { kind: 'locks', name: 'Ballard Locks', x: -4130, z: -3660, rot: 0 },
  { kind: 'kerry', name: 'Kerry Park', x: -1300, z: -1520, rot: 0 },
  { kind: 'stadiumH', name: 'Husky Stadium', x: 1720, z: -3300, rot: 0.15 },
  { kind: 'ferriswheelPier', name: 'Alki Beach', x: -2900, z: 2380, rot: 0 },
  { kind: 'convention', name: 'Convention Center', p: dt(7.4, -0.6), rot: DT_ROT },
  { kind: 'pier', name: 'Pier 66', p: dt(-3.1, -4.6), rot: DT_ROT },
];

// Parks: rectangles that stay green and unbuilt.
export const PARKS = [
  // 74 acres, and a pedestrian campus -- no streets cross it. Placed off the
  // four streets that bound it: 1st Ave N (x -1396) and 5th Ave N (x -735),
  // Denny Way (z -790) and Mercer St (z -1469).
  { name: 'Seattle Center', x: -1066, z: -1130, w: 640, d: 650, rot: 0 },
  { name: 'Myrtle Edwards Park', x: -1320, z: -1750, w: 180, d: 900, rot: 0.32 },
  { name: 'Volunteer Park', x: 1350, z: -1560, w: 340, d: 300, rot: 0 },
  { name: 'Cal Anderson Park', x: 900, z: -180, w: 180, d: 260, rot: 0 },
  { name: 'Discovery Park', x: -3450, z: -2600, w: 700, d: 800, rot: 0 },
  { name: 'Gas Works Park', x: -250, z: -3660, w: 300, d: 220, rot: 0 },
  { name: 'Green Lake Park', x: -1150, z: -4800, w: 420, d: 420, rot: 0 },
  { name: 'Occidental Park', p: dt(0.5, 12.6), w: 120, d: 90, rot: DT_ROT },
  { name: 'Westlake Park', p: dt(3.5, 0.6), w: 58, d: 42, rot: DT_ROT },
  { name: 'Freeway Park', p: dt(7.5, 4.6), w: 160, d: 130, rot: DT_ROT },
  { name: 'Denny Park', x: -170, z: -760, w: 200, d: 160, rot: 0 },
  { name: 'Jefferson Park', x: 1150, z: 2700, w: 380, d: 420, rot: 0 },
  { name: 'Alki Beach Park', x: -2850, z: 2320, w: 1100, d: 110, rot: 0.06 },
  { name: 'Seward Park', x: 3050, z: 4100, w: 420, d: 500, rot: 0 },
  { name: 'Interlaken Park', x: 2500, z: -2350, w: 500, d: 260, rot: 0 },
  { name: 'Lincoln Park', x: -3150, z: 4600, w: 320, d: 600, rot: 0 },
  { name: 'Ravenna Park', x: 1900, z: -4750, w: 400, d: 220, rot: 0 },
  { name: 'UW Quad', x: 1400, z: -3950, w: 340, d: 300, rot: 0 },
  { name: 'Woodland Park', x: -1600, z: -4650, w: 420, d: 380, rot: 0 },
  { name: 'Magnuson Field', x: 2800, z: -4400, w: 400, d: 400, rot: 0 },
];

export function inPark(x, z) {
  for (const p of PARKS) {
    const px = p.p ? p.p[0] : p.x,
      pz = p.p ? p.p[1] : p.z;
    const dx = x - px,
      dz = z - pz;
    const c = Math.cos(-p.rot),
      s = Math.sin(-p.rot);
    if (Math.abs(dx * c - dz * s) <= p.w / 2 && Math.abs(dx * s + dz * c) <= p.d / 2) return p;
  }
  return null;
}

// On/off ramps. First point sits on the ground, last point on the deck.
export const RAMPS = [
  { name: 'I-5 Olive Way Ramp', pts: [[...dt(8.6, -1.2)], [...dt(8.2, -2.0)], [610, -1180, 30], [560, -1320, 42]] },
  { name: 'I-5 Madison St Ramp', pts: [[...dt(8.9, 6.2)], [...dt(8.6, 5.0), 22], [...dt(8.2, 4.2), 44]] },
  { name: 'I-5 Mercer St Ramp', pts: [[420, -1130], [520, -1400, 22], [575, -1750, 45]] },
  { name: 'I-5 Dearborn Ramp', pts: [[...dt(9.0, 17.2)], [1000, 1250, 18], [1120, 1600, 30]] },
  { name: 'I-90 4th Ave S Ramp', pts: [[440, 1420], [760, 1360, 12], [1100, 1320, 24]] },
  { name: 'WS Bridge Spokane Ramp', pts: [[100, 2685], [-80, 2700, 6], [-260, 2715, 26]] },
  { name: 'Aurora Denny Ramp', pts: [[-700, -560], [-680, -900], [-660, -1300], [-645, -1490]] },
  { name: 'Aurora Ship Canal Ramp', pts: [[-960, -4100], [-920, -4160], [-880, -4150, 44]] },
  { name: 'SR 520 Montlake Ramp', pts: [[1520, -3300], [1450, -3100], [1300, -2900, 22], [1150, -2860, 30]] },
  { name: 'I-5 Ravenna Ramp', pts: [[1210, -4500], [980, -4460], [760, -4480, 40], [665, -4500, 56]] },
];

// Pavement on the 5th Ave N side of Seattle Center, 181 m from the Space Needle
// and looking straight at it. Kept clear of buildings by KEEP_CLEAR below.
export const SPAWN = { x: -679, z: -1050 };
export const SPAWN_HEADING = -1.36; // faces the Needle; see HEADING_SENSE in CLAUDE.md
export const RESPAWN = { x: 1050, z: 300 }; // Harborview
/**
 * Points the player gets put down on. citygen removes any building covering
 * one: land inside a footprint and `player.blocked()` refuses every direction,
 * which reads in-game as the walk animation playing while nobody moves.
 */
export const KEEP_CLEAR = [SPAWN, RESPAWN];

export function clampToMap(v) {
  return clamp(v, -MAP_HALF + 40, MAP_HALF - 40);
}
