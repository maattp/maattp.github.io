// Small math / rng / geometry helpers shared across the whole game.

export const TAU = Math.PI * 2;
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
