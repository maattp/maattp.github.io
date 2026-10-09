// The mountains on the horizon: the Olympics to the west, Mt Rainier to the
// SSE, the Cascades to the east. ONE draw, no render target, no texture
// upload beyond an 8192 x 1 table.
//
// It is a sky element, like the dome (see "Mountains on the horizon" in
// guide/rendering.md): a cylinder band around the camera whose vertex shader
// drops translation and writes z = w, so it is infinitely far from wherever
// you stand, never parallaxes, and is never clipped by the far plane. It is
// drawn right after the dome (renderOrder -999) with depth off and alpha
// blending, before any city geometry, so every building, hill, island and the
// water simply paints over it.
//
// The silhouette is a table, one column per 0.044 deg of BEARING from the
// map's origin (Westlake Center), built here at boot: for each column the
// height (metres, already minus the earth's curvature) and distance of
// whatever stands highest on the sky there. The fragment shader reads it,
// compares the pixel's elevation to the column's top as seen from the
// camera's altitude (so a plane at 1.5 km sees the range sink toward the
// horizon, as it should) and paints rock, forest, snow and haze.

import * as THREE from './three.js';
import { toWorld } from './geo.js';
import { DEG } from './util.js';

export const COLS = 8192;
const R_EARTH = 6371000;
// Light bends toward the ground: a ray sees the earth ~13 % less curved
// (standard terrestrial refraction, k = 0.13).
const R_EFF = R_EARTH / (1 - 0.13);
// Every elevation angle is stretched by this much. The honest numbers make
// Rainier a 2.3 deg lump and the Olympics a 1-2 deg line (which is the truth
// from sea level); 1.3x is the most that stays honest, and at sea level it is what makes the
// Olympics read as a range at all.
export const EXAG = 1.3;
export const dropAt = (d) => (d * d) / (2 * R_EFF);

// Peaks: [name, lat, lon, summit m, half-width km, shape exponent, jaggedness, kind]
// kind 0 Olympics, 1 Cascades, 2 glaciated volcano.
// Coordinates are Wikipedia/GNIS (lat/lon to 0.01 deg, so ~1 km, which is
// 0.6 deg of bearing at 90 km); summit heights are the published ones. The
// half-width is how far from the summit the massif has come down to the
// foothills; it was chosen to read right, not measured.
//
//   peak              bearing   distance   summit   drawn elevation (1.3x)
//   Mt Olympus          282 deg   105 km   2,432 m     1.2 deg (the Olympics' highest)
//   The Brothers        271 deg    61 km   2,093 m     2.3 deg
//   Mt Constance        287 deg    62 km   2,344 m     2.5 deg
//   Mt Deception        288 deg    71 km   2,374 m     2.1 deg
//   Mt Rainier          153 deg    95 km   4,392 m     3.0 deg (2.3 true)
//   Mt Baker             17 deg   135 km   3,286 m     1.1 deg
//   Glacier Peak         59 deg   107 km   3,213 m     1.7 deg
//   Mt Stuart            98 deg   109 km   2,869 m     1.4 deg
//
// (run `node -e "import('./apps/auto/src/mountains.js').then(m=>console.table(m.peakTable()))"`
// for the whole list as built.)
export const PEAKS = [
  ['Mt Olympus', 47.8013, -123.7108, 2432, 9, 1.25, 0.16, 0],
  ['The Brothers', 47.6213, -123.1486, 2093, 5, 1.1, 0.2, 0],
  ['Mt Constance', 47.7728, -123.1274, 2344, 5.5, 1.1, 0.2, 0],
  ['Mt Deception', 47.8131, -123.2335, 2374, 5.5, 1.1, 0.2, 0],
  ['Mt Skokomish', 47.5911, -123.2941, 1961, 4.5, 1.1, 0.2, 0],
  ['Mt Ellinor', 47.5216, -123.2607, 1944, 4, 1.1, 0.2, 0],
  ['Mt Rainier', 46.8517, -121.7603, 4392, 19, 1.3, 0.06, 2],
  ['Little Tahoma', 46.8496, -121.7123, 3395, 4.5, 1.15, 0.12, 2],
  ['Mt Baker', 48.7766, -121.8145, 3286, 14, 1.35, 0.04, 2],
  ['Glacier Peak', 48.1119, -121.1142, 3213, 11, 1.2, 0.1, 2],
  ['Mt Stuart', 47.4751, -120.9031, 2869, 8, 1.1, 0.16, 1],
  ['Mt Daniel', 47.5649, -121.1809, 2426, 6, 1.1, 0.18, 1],
  ['Mt Index', 47.7745, -121.5809, 1822, 4.5, 1.05, 0.2, 1],
  ['Mt Pilchuck', 48.0580, -121.7978, 1588, 4, 1.05, 0.2, 1],
  ['Mt Si', 47.5076, -121.7401, 1270, 4, 1.05, 0.2, 1],
];

// The ranges behind the named peaks, as a crest line: [bearing deg, distance
// km, crest base m, relief m] -- the crest stands at base + relief * ridged
// noise. Read off a map from downtown: the Olympics' east front is 60-70 km
// out and swings away to the NW toward Hurricane Ridge; the Cascade crest
// runs 60-100 km out, lowest at Snoqualmie Pass (bearing ~100), with the
// foothills round Rainier folded in on the SSE side.
const RANGES = [
  { kind: 0, seed: 11, ctl: [[250, 72, 0, 0], [256, 70, 500, 400], [262, 68, 1100, 700], [270, 64, 1450, 650],
    [280, 66, 1550, 650], [290, 74, 1450, 600], [300, 92, 1300, 600], [310, 105, 1100, 600],
    [320, 112, 700, 500], [328, 115, 0, 0]] },
  { kind: 1, seed: 29, ctl: [[0, 140, 0, 0], [8, 135, 800, 500], [25, 100, 1200, 500], [45, 90, 1300, 600],
    [62, 68, 1400, 550], [80, 78, 1300, 500], [100, 75, 1100, 450], [120, 80, 1300, 550],
    [140, 82, 1200, 450], [160, 70, 900, 350], [175, 80, 0, 0]] },
];

// Seeded value noise on a line, so the same range appears on every device.
function hash1(i, seed) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise1(x, seed) {
  const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f);
  return hash1(i, seed) * (1 - t) + hash1(i + 1, seed) * t;
}
// Ridged: sharp crests, rounded gaps. x is in degrees of bearing.
function ridged(x, seed) {
  let a = 0, w = 0.55, f = 0.55, s = 0;
  for (let o = 0; o < 6; o++) {
    a += w * (1 - Math.abs(2 * noise1(x * f, seed + o * 17) - 1));
    s += w; w *= 0.5; f *= 2.15;
  }
  return a / s;
}
const wrapDeg = (d) => ((d + 540) % 360) - 180;

/** Every peak resolved to a bearing and distance from the origin. */
export function peakTable() {
  return PEAKS.map(([name, lat, lon, h, hw, p, jag, kind]) => {
    const [x, z] = toWorld(lat, lon);
    const dist = Math.hypot(x, z);
    const bearing = ((Math.atan2(x, -z) / DEG) + 360) % 360;
    const vis = Math.max(0, (h - dropAt(dist)) * EXAG);
    return { name, bearing: +bearing.toFixed(1), distKm: +(dist / 1000).toFixed(1), summit: h,
      elevDeg: +(Math.atan(vis / dist) / DEG).toFixed(2), hw, p, jag, kind, dist };
  });
}

/**
 * The profile table: COLS x 2 RGBA8 texels. Row 0: R,G = visible height * 10
 * (16 bit), B = distance in km. Row 1: R = how far this column is from its
 * peak's summit, as a fraction of the massif's half-width (0 at the summit),
 * 255 when the column belongs to a range crest rather than a peak; G = kind
 * (0 Olympics, 1 Cascades, 2 volcano) * 85.
 * "Visible height" is height above sea level minus the earth's curvature at
 * that distance, times EXAG; the camera's own altitude is subtracted later.
 */
export function buildProfile() {
  const top = new Float32Array(COLS);        // best tan(elevation) so far
  const H = new Float32Array(COLS), D = new Float32Array(COLS).fill(90000), K = new Uint8Array(COLS);
  const S = new Uint8Array(COLS).fill(255);
  const put = (i, hTrue, dist, kind, lat = 255) => {
    const vis = Math.max(0, (hTrue - dropAt(dist)) * EXAG);
    const t = vis / dist;
    if (t > top[i]) { top[i] = t; H[i] = vis; D[i] = dist; K[i] = kind; S[i] = lat; }
  };
  const colBearing = (i) => ((i + 0.5) / COLS) * 360;

  for (const r of RANGES) {
    for (let i = 0; i < COLS; i++) {
      const b = colBearing(i);
      const c = r.ctl;
      if (b < c[0][0] || b > c[c.length - 1][0]) continue;
      let k = 0;
      while (k < c.length - 2 && b > c[k + 1][0]) k++;
      const f = (b - c[k][0]) / (c[k + 1][0] - c[k][0]);
      const s = f * f * (3 - 2 * f);
      const L = (j) => c[k][j] + (c[k + 1][j] - c[k][j]) * s;
      const rd = ridged(b, r.seed);
      put(i, L(2) + L(3) * rd, L(1) * 1000, r.kind);
    }
  }
  for (const p of peakTable()) {
    const half = (p.hw * 1000 / p.dist) / DEG;       // bearing half-width, deg
    const i0 = Math.floor(((p.bearing - half) / 360) * COLS), i1 = Math.ceil(((p.bearing + half) / 360) * COLS);
    for (let i = i0; i <= i1; i++) {
      const ii = ((i % COLS) + COLS) % COLS;
      const db = wrapDeg(colBearing(ii) - p.bearing);
      const s = Math.abs(db) * DEG * p.dist / (p.hw * 1000);
      if (s >= 1) continue;
      // A crag, not a cone: ridged noise eats the flanks, never the summit.
      const crag = 1 - p.jag * (1 - ridged(db * (p.kind === 2 ? 8 : 3.1) + p.bearing * 0.37, 97)) * Math.min(1, s * 3);
      // rounded at the summit (a cone's apex is a needle from 95 km)
      const eps = p.kind === 2 && p.hw > 10 ? 0.1 : 0.06;
      const sr = Math.sqrt(s * s + eps * eps) - eps;
      put(ii, p.summit * Math.pow(Math.max(0, 1 - sr), p.p) * crag, p.dist, p.kind, Math.round(s * 254));
    }
  }
  const data = new Uint8Array(COLS * 8);
  for (let i = 0; i < COLS; i++) {
    const v = Math.min(65535, Math.round(H[i] * 10));
    data[i * 4] = v >> 8; data[i * 4 + 1] = v & 255;
    data[i * 4 + 2] = Math.min(255, Math.round(D[i] / 1000));
    data[i * 4 + 3] = 255;
    const o = (COLS + i) * 4;
    data[o] = S[i]; data[o + 1] = K[i] * 85; data[o + 2] = 0; data[o + 3] = 255;
  }
  return data;
}

const VERT = `
  attribute float aB;
  varying float vB, vT;
  varying vec3 vDir;
  void main() {
    vB = aB; vT = position.y; vDir = position;
    // Rotation only, and z = w: the same infinitely-far placement as the dome.
    vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = vec4(p.xy, p.w, p.w);
  }`;

const FRAG = `
  uniform sampler2D tProf;
  uniform float camAlt;
  uniform vec3 sunDir, horizon, mid, haze, hazeToward, hazeAway;
  varying float vB, vT;
  varying vec3 vDir;
  const float N = ${COLS}.0;
  const float EXAG = ${EXAG.toFixed(3)};
  const float INV2R = ${(1 / (2 * R_EFF)).toExponential(6)};

  vec4 tap(float i) { return texture2D(tProf, vec2((mod(i, N) + 0.5) / N, 0.25)); }
  float decH(vec4 c) { return (c.r * 255.0 * 256.0 + c.g * 255.0) * 0.1; }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.13 + 7.3) * 0.3 + vnoise(p * 4.7 + 1.9) * 0.15; }

  void main() {
    float u = vB * N - 0.5;
    float i0 = floor(u), f = u - i0;
    vec4 c0 = tap(i0), c1 = tap(i0 + 1.0);
    float h0 = decH(c0), h1 = decH(c1);
    float dist = mix(c0.b, c1.b, f) * 255000.0;
    float hTop = mix(h0, h1, f);
    float tanTop = (hTop - camAlt) / dist;
    float fw = fwidth(vT);
    float over = vT - tanTop;
    if (over > fw) discard;
    // height of this pixel's line of sight over the sea at the range's distance
    float hm = camAlt + vT * dist;
    if (hm < 0.0) discard;
    float edge = 1.0 - smoothstep(-fw, fw, over);

    vec3 d = normalize(vDir);
    vec4 m = texture2D(tProf, vec2((mod(floor(u + 0.5), N) + 0.5) / N, 0.75));
    float kind = floor(m.g * 255.0 / 85.0 + 0.5);
    // true height above the sea, the stretch and the curve undone
    float ht = hm / EXAG + dist * dist * INV2R;

    // tilt of the silhouette along the bearing: which way this flank faces
    float dH = (decH(tap(i0 + 2.0)) - decH(tap(i0 - 1.0))) / (3.0 * dist * ${(2 * Math.PI / COLS).toFixed(7)});
    vec3 tang = normalize(vec3(-d.z, 0.0, d.x));      // d(bearing): (cos b, 0, sin b)
    float s = atan(d.x, -d.z) * dist;                 // metres along the sky
    // Weathering: ridged noise stretched down the slope. On a peak the lines
    // RADIATE from the summit -- a ridge is a scaled copy of the silhouette,
    // so the key is this column's offset over the silhouette's offset at this
    // pixel's height -- which is what makes Rainier a volcano and not a cone.
    float lat = m.r * 255.0 / 254.0;
    float peak = step(m.r, 0.999);
    float sH = 1.0 - pow(clamp(ht / max(hTop / EXAG + dist * dist * INV2R, 1.0), 0.0, 1.0), 0.77) * (1.0 - lat);
    float fr = lat / max(sH, 0.02);
    // which flank, smoothed so the summit has no seam
    float side = clamp(-dH * 40.0, -1.0, 1.0);
    vec2 rq = mix(vec2(s / 240.0, ht / 700.0), vec2(side * fr * 7.0 + kind * 3.7, ht / 2600.0), peak);
    float rid = 1.0 - abs(2.0 * fbm(rq) - 1.0);
    vec2 q = vec2(s / 330.0, ht / 230.0);
    float n0 = fbm(q);
    float gx = fbm(q + vec2(0.07, 0.0)) - n0;
    float gy = fbm(q + vec2(0.0, 0.07)) - n0;
    vec3 face = normalize(-d * 0.8 + vec3(0.0, 0.35, 0.0)
                          + tang * clamp((-dH * 1.1 + (rid - 0.5) * 0.3 * side * peak) * mix(1.0, smoothstep(1200.0, 2800.0, ht), peak) + gx * 5.0, -0.9, 0.9)
                          + vec3(0.0, clamp(gy * 3.0, -0.4, 0.4), 0.0));
    float lit = clamp(dot(face, sunDir), 0.0, 1.0);

    // forest -> bare rock -> snow
    float snowLine = (kind > 1.5 ? 1750.0 : kind > 0.5 ? 2000.0 : 1650.0) + (n0 - 0.5) * 700.0 - (rid - 0.5) * 500.0 * peak;
    float snow = smoothstep(snowLine, snowLine + 240.0, ht) * (0.72 + 0.4 * rid);
    snow = clamp(snow + smoothstep(snowLine + 600.0, snowLine + 1000.0, ht), 0.0, 1.0);
    vec3 forest = vec3(0.05, 0.09, 0.075);
    vec3 rock = vec3(0.2, 0.19, 0.2);
    vec3 col = mix(forest, rock, smoothstep(950.0, 1550.0, ht + (n0 - 0.5) * 500.0));
    col = mix(col, vec3(0.86, 0.9, 0.97), snow);
    col *= 0.9 + 0.3 * (rid - 0.5) * (0.4 + 0.6 * peak);
    vec3 sunLit = vec3(1.0, 0.95, 0.86);
    vec3 skyFill = vec3(0.3, 0.38, 0.52);
    col *= skyFill * 0.85 + sunLit * lit * 0.85;

    // the air between here and there: the horizon sky's colour, more of it
    // with distance and in the valleys
    float hs = 0.5 + 0.5 * dot(d, sunDir);
    vec3 hz = haze * mix(hazeAway, hazeToward, hs * hs);
    float e = max(d.y, 0.0);
    vec3 air = mix(mix(horizon, mid, smoothstep(0.0, 0.28, e)), hz, (1.0 - smoothstep(0.0, 0.07, abs(d.y))) * 0.55);
    float hazeF = 1.0 - exp(-dist / 115000.0);
    // The foot goes into the haze over a depth that grows with the camera's
    // own height: from a plane the range's base is a long way down the
    // horizon's mist, and a hard line there reads as a floating strip.
    float foot = 120.0 + 0.3 * camAlt;
    hazeF = mix(0.9, hazeF, smoothstep(0.0, foot * 2.5, hm));
    col = mix(col, air, clamp(hazeF, 0.0, 1.0));

    gl_FragColor = vec4(col, edge * smoothstep(0.0, foot, hm));
    #include <colorspace_fragment>
  }`;

/**
 * Adds the mountain band to the scene. `sky` is the dome's own uniform set,
 * shared so the haze and sun are the ones the sky and the fog already use.
 * Returns the mesh (userData.profile is the table).
 */
export function buildMountains(scene, sky) {
  const prof = buildProfile();
  const tex = new THREE.DataTexture(prof, COLS, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  // A cylinder of radius 1 around the camera, tan(elevation) -0.3 .. +0.12:
  // from 17 deg under the horizon (a plane's view of the range's foot) to 7 deg
  // over it (Baker and Rainier peak at ~3). 2 rows, 720 columns.
  const SEG = 720, T0 = -0.3, T1 = 0.12;
  const pos = new Float32Array((SEG + 1) * 2 * 3), aB = new Float32Array((SEG + 1) * 2);
  const idx = [];
  for (let s = 0; s <= SEG; s++) {
    const b = (s / SEG) * Math.PI * 2;
    for (let r = 0; r < 2; r++) {
      const v = s * 2 + r;
      pos[v * 3] = Math.sin(b); pos[v * 3 + 1] = r ? T1 : T0; pos[v * 3 + 2] = -Math.cos(b);
      aB[v] = s / SEG;
    }
    if (s < SEG) { const a = s * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aB', new THREE.BufferAttribute(aB, 1));
  geo.setIndex(idx);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tProf: { value: tex },
      camAlt: { value: 0 },
      sunDir: sky.sunDir, horizon: sky.horizon, mid: sky.mid, haze: sky.haze,
      hazeToward: sky.hazeToward, hazeAway: sky.hazeAway,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    // Not `transparent`: that would sort it after the whole opaque scene and
    // paint it over the city. Custom blending keeps it in the opaque list,
    // where renderOrder puts it straight behind the dome. Alpha is left alone
    // so the target keeps the dome's 1.
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -999;
  mesh.name = 'mountains';
  mesh.onBeforeRender = (renderer, sc, camera) => { mat.uniforms.camAlt.value = camera.position.y; };
  mesh.userData.profile = prof;
  scene.add(mesh);
  return mesh;
}
