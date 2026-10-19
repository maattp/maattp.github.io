// Small math / rng / geometry helpers shared across the whole game.

export const TAU = Math.PI * 2;

// The season the city is dressed for. Fall: the broadleaf trees turn, leaves
// lie on the lawns and drift down from the crowns, pumpkins sit on the front
// steps. `?season=summer` puts it back to summer, for a before/after.
export const FALL = typeof location === 'undefined' || !/[?&]season=summer\b/.test(location.search);

// Toward the sun, unit length, in the game's frame (x east, y up, z SOUTH).
// Fall is a mid-October afternoon in Seattle, about a quarter to three: the
// sun 24 deg up in the south-west (azimuth 218), so a house throws a shadow
// twice its height and a tower one across the next block. Summer keeps the
// old sun, 38 deg up in the north-west. main.js places the light along it,
// trees.js lights the crowns by it, tools/build_mountains.py bakes Rainier's
// face against the fall one.
export const SUN_DIR = FALL ? [-0.56244, 0.40674, 0.71987]
  : (() => { const l = Math.hypot(215, 200, 150); return [-215 / l, 200 / l, -150 / l]; })();
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function damp(a, b, rate, dt) {
  return lerp(a, b, 1 - Math.exp(-rate * dt));
}

// Deterministic PRNG so the city is identical on every load / device.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rng(seed) {
  const f = mulberry32(seed);
  return {
    f,
    n: () => f(),
    range: (a, b) => a + (b - a) * f(),
    int: (a, b) => Math.min(b, a + Math.floor(f() * (b - a + 1))), // inclusive
    pick: (arr) => arr[Math.min(arr.length - 1, Math.floor(f() * arr.length))],
    chance: (p) => f() < p,
    sign: () => (f() < 0.5 ? -1 : 1),
  };
}

// Integer hash -> [0,1); used for stable per-cell variation without storing state.
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Heading in degrees, clockwise from north. World is +X east, +Z south.
export function dirDeg(deg) {
  const r = deg * DEG;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

export function headingOf(x, z) {
  return Math.atan2(x, -z);
}

export function angleWrap(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function angleTowards(cur, target, maxStep) {
  const d = angleWrap(target - cur);
  return cur + clamp(d, -maxStep, maxStep);
}

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx,
    dz = az - bz;
  return dx * dx + dz * dz;
}

/** distToSeg(...).d with no result object, for hot loops: same arithmetic. */
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax,
    dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax,
    dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = sat(t);
  const cx = ax + dx * t,
    cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), t, x: cx, z: cz };
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      zi = poly[i][1],
      xj = poly[j][0],
      zj = poly[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polyBounds(poly) {
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    z1 = -Infinity;
  for (const p of poly) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1];
    if (p[1] > z1) z1 = p[1];
  }
  return { x0, z0, x1, z1 };
}

export function distToPolyEdge(x, z, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const r = distToSeg(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
    if (r.d < best) best = r.d;
  }
  return best;
}

// Intersection of segments AB and CD. Returns {t,u} params or null.
export function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1 = bx - ax,
    r2 = bz - az,
    s1 = dx - cx,
    s2 = dz - cz;
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * s2 - (cz - az) * s1) / den;
  const u = ((cx - ax) * r2 - (cz - az) * r1) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { t: sat(t), u: sat(u) };
}

// Axis-aligned-in-local-space rectangle test: is (px,pz) inside a box centred at
// (cx,cz), half extents (hw,hd), rotated by `rot` radians?
export function inRotRect(px, pz, cx, cz, hw, hd, rot) {
  const dx = px - cx,
    dz = pz - cz;
  const c = Math.cos(-rot),
    s = Math.sin(-rot);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= hw && Math.abs(lz) <= hd;
}

export function formatMoney(n) {
  return '$' + Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The tiers a tall building steps back through.
 *
 * Shared by the near chunk mesh and the far skyline mesh, because they were
 * modelling the same building differently and each poked through the other. The
 * near mesh stepped back at 62 % of the height; the far mesh at 80-90 %. Between
 * those the far version was WIDER, so it stood proud of the textured geometry
 * all the way round -- and the far mesh has no map, so every tall building in
 * downtown wore a blank pale slab across its upper third. Measured by raycast,
 * the far mesh was the frontmost surface at 235-353 m, well inside the 800 m
 * near radius where it has no business being visible at all.
 *
 * One profile, two consumers. They cannot drift again. (Here rather than in
 * world.js so the roof and wall queries below read it too.)
 */
export function* buildingTiers(bd, baseY, totalH) {
  const n = bd.h > 100 ? 3 : bd.h > 55 ? 2 : 1;
  let y = baseY, remaining = totalH, w = bd.w, d = bd.d;
  for (let t = 0; t < n; t++) {
    const frac = t === n - 1 ? 1 : t === 0 ? 0.62 : 0.6;
    const h = remaining * frac;
    yield { t, last: t === n - 1, y, h, w, d };
    y += h;
    remaining -= h;
    if (t < n - 1) { y += 0.55; w *= 0.78; d *= 0.78; }
  }
}

/**
 * The tiers the near mesh draws a building's walls in (world.js
 * meshBuilding): a shopfront plinth on anything but a warehouse, a school or a
 * church, then buildingTiers over the rest. For the queries that must agree
 * with the drawing -- what you land on and what you fly into.
 */
function drawnTiers(b) {
  const plinth = b.style !== 'industrial' && b.style !== 'campus' ? Math.min(5.2, b.h * 0.3) : 0;
  const lift = plinth > 2 ? plinth + 0.5 : 0;
  return buildingTiers(b, b.y - 2 + lift, b.h + 2 - lift);
}

/**
 * The drawn roof of footprint `b` at (x, z), the footprint grown by `pad`: the
 * highest surface there at or below `maxY`, or -Infinity. The deck inside the
 * parapet on the top tier, the trim band's top on a lower setback, the top of
 * a pitched roof (a house, a shed) or a landmark tower -- and what stands on
 * a flat roof, where world.js has recorded it for a built chunk
 * (`b.roofSolids`: plant, a stair bulkhead, a crown, a terrace's furniture).
 */
export function roofAt(b, x, z, pad = 0, maxY = Infinity) {
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
  const lx = Math.abs(dx * c - dz * s), lz = Math.abs(dx * s + dz * c);
  if (lx > b.w / 2 + pad || lz > b.d / 2 + pad) return -Infinity;
  if (b.kind || b.style === 'house' || (b.style === 'industrial' && b.h < 3.5)) return b.y + b.h <= maxY ? b.y + b.h : -Infinity;
  let top = -Infinity;
  for (const t of drawnTiers(b)) {
    if (lx > t.w / 2 + pad || lz > t.d / 2 + pad) break;
    const y = t.y + t.h + (t.last ? 0.83 : 0.55);
    if (y <= maxY) top = y;
  }
  const S = b.roofSolids;
  if (S) {
    for (let i = 0; i < S.length; i += 8) {
      const cr = Math.cos(S[i + 5]), sr = Math.sin(S[i + 5]), ex = x - S[i + 1], ez = z - S[i + 2];
      const ux = Math.abs(ex * cr + ez * sr), uz = Math.abs(-ex * sr + ez * cr);
      const hw = S[i + 3] / 2, hd = S[i + 4] / 2;
      if (ux > hw + pad || uz > hd + pad) continue;
      // a pyramid's slope falls from the apex to its eaves
      const y = S[i] === 2 ? S[i + 7] - (S[i + 7] - S[i + 6]) * Math.min(1, Math.max(ux / hw, uz / hd)) : S[i + 7];
      if (y > top && y <= maxY) top = y;
    }
  }
  return top;
}

/**
 * How much of a building's footprint stands at height y: all of it up to the
 * first setback, then each tier's share. A wall test against the whole
 * footprint pushed anything over a setback's ledge out past the base.
 */
export function tierScale(b, y) {
  if (b.h <= 55 || b.kind) return 1;
  let k = 1;
  for (const t of drawnTiers(b)) {
    k = t.w / b.w;
    if (y < t.y + t.h + 0.5) break;
  }
  return k;
}
