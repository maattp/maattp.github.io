// The Space Needle. Always in the scene and visible from most of the map, so it
// is built to read at every distance: the hourglass silhouette first, then the
// details that survive at 100-500 m (leg pairs, the Y forks, the SkyLine ring,
// the halo, the glass barriers), then the ones that only matter at its base.
//
// Reference dimensions (feet in the sources, metres here; y is height above
// the plaza, r is radius from the core axis):
//
// | what                                   | value              | source |
// |----------------------------------------|--------------------|--------|
// | top of the aircraft beacon             | 605 ft = 184.4 m   | spaceneedle.com fact sheet (History) |
// | observation deck (outdoor + indoor)    | 520 ft = 158.5 m   | fact sheet (New Experiences, 2018) |
// | Ring / mezzanine level                 | 510 ft = 155.4 m   | fact sheet (New Experiences) |
// | The Loupe, revolving glass floor       | 500 ft = 152.4 m   | fact sheet (New Experiences) |
// | SkyLine level                          | 100 ft = 30.5 m    | fact sheet (History); Wikipedia |
// | legs: three PAIRS of steel columns     | 102 ft base circle | Docomomo WEWA: "curve inwards from a 102' diameter base" |
// | waist (narrowest)                      | 373 ft = 113.7 m   | Docomomo WEWA; ASCE Civil Eng. Jul 2024 |
// | pair columns joined by plate           | 260-420 ft = 79-128 m | ASCE ("steel plate shirtwaist") |
// | tie beams leg-to-core                  | 100 ft and 200 ft  | ASCE |
// | column section                         | three-sided welded tubes | ASCE |
// | core                                   | 11 ft = 3.35 m     | ASCE ("11 ft hollow core") |
// | top house (halo) diameter              | 138 ft = 42 m      | Wikipedia |
// | halo: ring on down-sloping outriggers  | ~ half the top house height | ASCE / MOHAI photo captions |
// | glass barriers: 48 panels, 11 ft tall, | 3.35 m, 14 deg out | fact sheet (New Experiences); Olson Kundig |
// | tilted out                             |                    |        |
// | colour                                 | Astronaut White; roof back to white May 2023 | spaceneedle.com; KING5 |
//
// Not published, so MEASURED off an orthographic-ish photo (Wikimedia Commons
// "Space Needle 2011-07-04.jpg", scaled by the 100 ft and 520 ft levels, which
// puts the beacon within 2 % of 605 ft): leg centreline radius 11.3 m at the
// SkyLine, 5 m at 90 m, 4 m at the waist, 9.3 m where the arms meet the
// saucer at 147.5 m; the saucer's rim r 16 m at 151 m; the roof cone rising to
// the cap at 165 m; the cap and mechanical band to 169.5 m; the mast above.
// Pair split and the Y forks follow the Commons photo "Autumnal Space Needle";
// leg widths (4-5 m as seen) and the SkyLine's 29 m span come off "DSC 5592
// Space Needle-Kerry Park", scaled by the 42 m halo.

import * as THREE from './three.js';

// --- materials ---------------------------------------------------------------
// Needle-only materials, so mergeByMaterial hands back meshes that are the
// Needle and nothing else: they can cast shadows and be frustum culled on
// their own bounding sphere (see buildLandmarks).

// Same trick as the city's curtain wall (world.js): a vertical mirror seen
// level or from above reflects the IBL's ground half and reads as dark paint.
// Fold the reflected ray into the upper hemisphere so it shows sky and cloud.
const IBL_FROM = 'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );';
function skyGlass(m, key) {
  m.onBeforeCompile = (sh) => {
    if (!THREE.ShaderChunk.envmap_physical_pars_fragment.includes(IBL_FROM)) return;
    sh.fragmentShader = sh.fragmentShader.replace('#include <envmap_physical_pars_fragment>',
      THREE.ShaderChunk.envmap_physical_pars_fragment.replace(IBL_FROM,
        `${IBL_FROM}\n\t\t\treflectVec = normalize( vec3( reflectVec.x, abs( reflectVec.y ) * 0.85 + 0.12, reflectVec.z ) );`));
  };
  m.customProgramCacheKey = () => key;
  return m;
}

export const NEEDLE_MATS = {
  // Astronaut White: painted steel, a little satin.
  white: new THREE.MeshStandardMaterial({ color: 0xefede7, roughness: 0.48, metalness: 0.05, envMapIntensity: 0.75 }),
  // Core truss, elevator rails, mechanical band: dark painted steel.
  dark: new THREE.MeshStandardMaterial({ color: 0x55595c, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.8 }),
  // Enclosed glazing (Loupe, indoor observation level, SkyLine, pavilion).
  glass: skyGlass(new THREE.MeshStandardMaterial({ color: 0x4d555a, roughness: 0.1, metalness: 0.45, envMapIntensity: 0.85, emissive: 0x2a1c10 }), 'needleGlass'),
  // The 2018 open-air barriers: clear, so the deck shows through.
  barrier: skyGlass(new THREE.MeshStandardMaterial({
    color: 0xd6e6ea, roughness: 0.05, metalness: 0.25, envMapIntensity: 1.0,
    transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
  }), 'needleBarrier'),
  concrete: new THREE.MeshStandardMaterial({ color: 0xb3b0a8, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.5 }),
  beacon: new THREE.MeshBasicMaterial({ color: 0xff4a2a, toneMapped: false }),
};
const MT = NEEDLE_MATS;

// --- reference geometry ------------------------------------------------------

export const NEEDLE = {
  beacon: 184.4, obs: 158.5, ring: 155.4, loupe: 152.4, skyline: 30.5,
  waist: 113.7, baseR: 15.55, haloR: 21.0, core: 3.35,
};

// Leg-pair centreline radius vs height. Monotone cubic through the measured
// stations, so the lower legs run nearly straight, bend into the waist and
// flare out like a trumpet into the arms.
const LEG_R = [
  [-2, 14.95], [0, 14.7], [30.5, 11.3], [61, 7.9], [90, 5.1], [NEEDLE.waist, 4.0],
  [126, 4.4], [137, 6.2], [144, 8.0], [148.5, 9.6],
];
function monotone(pts) {
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = Math.min(1, Math.max(0, (x - xs[i]) / h));
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i]
      + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const legR = monotone(LEG_R);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// Column section: radial depth and tangential width. Sized so a leg reads
// 4-5 m wide from Kerry Park, as it does in photographs from there: thinner
// legs left the dark core as the only thing visible at 500 m, a black pole.
const colD = (h) => h < NEEDLE.waist ? lerp(3.6, 3.0, h / NEEDLE.waist) : lerp(3.0, 2.2, (h - NEEDLE.waist) / 35);
const colW = (h) => h < NEEDLE.waist ? lerp(1.7, 1.4, h / NEEDLE.waist) : lerp(1.4, 1.15, (h - NEEDLE.waist) / 35);
// Half the tangential spacing of a pair's two columns: spread at the plaza,
// touching (welded by the shirtwaist plate) from 79 to 128 m, forked above.
const PAIR_JOIN = 79, PAIR_FORK = 128;
function pairS(h) {
  const touch = colW(h) / 2;
  if (h < PAIR_JOIN) return lerp(3.0, touch, clamp01(h / PAIR_JOIN));
  if (h < PAIR_FORK) return touch;
  return lerp(touch, 3.3, smooth(PAIR_FORK, 148.5, h) ** 0.8);
}
// Heights to sample the columns at: denser where the profile bends.
const LEG_H = (() => {
  const hs = [];
  for (let h = -2; h < 60; h += 10) hs.push(h);
  for (let h = 60; h < 128; h += 4) hs.push(h);
  for (let h = 128; h <= 148.5; h += 1.5) hs.push(h);
  if (hs[hs.length - 1] < 148.5) hs.push(148.5);
  return hs;
})();

// --- geometry helpers ----------------------------------------------------------

/** Flat-faced sweep of a convex section along a polyline of centre points. */
function sweep(centres, section, radial) {
  // centres: [{p: Vector3, d, w}]; section(d, w) -> [[u, v], ...] CCW;
  // radial: unit Vector3 used as the section's u axis before orthogonalising.
  const pos = [], nor = [], idx = [];
  const n = centres.length;
  const frames = centres.map((c, k) => {
    const a = centres[Math.max(0, k - 1)].p, b = centres[Math.min(n - 1, k + 1)].p;
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    const u = radial.clone().addScaledVector(t, -radial.dot(t)).normalize();
    const v = new THREE.Vector3().crossVectors(t, u).normalize();
    return { t, u, v, pts: section(c.d, c.w) };
  });
  const m = frames[0].pts.length;
  for (let f = 0; f < m; f++) {
    const base = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const { u, v, pts } = frames[k];
      const [u0, v0] = pts[f], [u1, v1] = pts[(f + 1) % m];
      // outward normal of this face, in the section plane
      const eu = u1 - u0, ev = v1 - v0;
      const nn = new THREE.Vector3().addScaledVector(u, ev).addScaledVector(v, -eu).normalize();
      for (const [su, sv] of [[u0, v0], [u1, v1]]) {
        const q = centres[k].p.clone().addScaledVector(u, su).addScaledVector(v, sv);
        pos.push(q.x, q.y, q.z); nor.push(nn.x, nn.y, nn.z);
      }
    }
    for (let k = 0; k < n - 1; k++) {
      const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  fixWinding(g);
  return g;
}

/** Make every triangle's winding agree with its vertex normals (front faces out). */
function fixWinding(g) {
  const p = g.attributes.position, n = g.attributes.normal, ix = g.index.array;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i < ix.length; i += 3) {
    A.fromBufferAttribute(p, ix[i]); B.fromBufferAttribute(p, ix[i + 1]); C.fromBufferAttribute(p, ix[i + 2]);
    N.fromBufferAttribute(n, ix[i]);
    const fn = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
    if (fn.dot(N) < 0) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  }
}

/**
 * Revolve a profile. `runs` are polylines of [r, y]; each run is smooth-shaded
 * along itself and creased against its neighbours, so a fascia stays a hard
 * edge instead of three's LatheGeometry rounding every corner.
 */
function lathe(runs, mat, segs = 64, phase = 0) {
  const g = new THREE.Group();
  for (const run of runs) {
    const geo = new THREE.LatheGeometry(run.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y)), segs, phase);
    fixWinding(geo);
    g.add(new THREE.Mesh(geo, mat));
  }
  return g;
}

/** A box beam between two points (not vertical). */
function beam(p0, p1, w, h, mat) {
  const len = p0.distanceTo(p1);
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
  o.position.copy(p0).add(p1).multiplyScalar(0.5);
  o.lookAt(p1);
  return o;
}

function box(w, h, d, mat, x, y, z, ry = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  o.position.set(x, y, z);
  o.rotation.y = ry;
  return o;
}

/**
 * A thin radial plate: `outline` is a closed polygon in (r, y), extruded
 * `t` thick across the tangent and turned to azimuth `a`.
 */
function radialPlate(outline, t, a, mat) {
  const s = new THREE.Shape(outline.map(([r, y]) => new THREE.Vector2(r, y)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -t / 2);
  const o = new THREE.Mesh(geo, mat);
  o.rotation.y = -a;
  return o;
}

const ringPt = (r, a, y) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);

// --- the model ---------------------------------------------------------------

export function spaceNeedle() {
  const g = new THREE.Group();
  const LEG_A = [0, 1, 2].map((i) => (i / 3) * Math.PI * 2 + 0.5);

  // Plinth and base pavilion. The plinth runs 2 m below grade so terrain
  // undulation across 40 m never floats it.
  g.add(lathe([[[0, -2], [22, -2]], [[22, -2], [22, 0.3]], [[22, 0.3], [0, 0.3]]], MT.concrete, 48));
  // The pavilion ring at the foot (curved glass under a white roof).
  g.add(lathe([[[18.4, 0.3], [18.4, 5.0]]], MT.glass, 48));
  g.add(lathe([[[17.6, 5.0], [19.6, 5.0]], [[19.6, 5.0], [19.6, 5.8]], [[19.6, 5.8], [17.6, 5.8]], [[17.6, 5.8], [17.6, 5.0]]], MT.white, 48));
  for (let k = 0; k < 36; k++) {
    const a = (k + 0.5) / 36 * Math.PI * 2;
    g.add(box(0.22, 4.7, 0.22, MT.white, Math.cos(a) * 18.45, 2.65, Math.sin(a) * 18.45, -a));
  }

  // --- core: dark truss shaft with elevator rails -----------------------------
  const CH = 147.5, cw = NEEDLE.core;
  g.add(box(cw - 1.3, CH, cw - 1.3, MT.dark, 0, CH / 2, 0));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
    g.add(box(0.42, CH, 0.42, MT.dark, sx * (cw / 2 - 0.21), CH / 2, sz * (cw / 2 - 0.21)));
  for (let y = 3; y < CH; y += 3.3) {
    g.add(box(cw, 0.28, 0.3, MT.dark, 0, y, cw / 2 - 0.15));
    g.add(box(cw, 0.28, 0.3, MT.dark, 0, y, -cw / 2 + 0.15));
    g.add(box(0.3, 0.28, cw, MT.dark, cw / 2 - 0.15, y, 0));
    g.add(box(0.3, 0.28, cw, MT.dark, -cw / 2 + 0.15, y, 0));
  }
  // Three elevators ride the outside of the core, one per face between legs:
  // twin guide rails, and a cab on two of them (the third is parked at the top).
  for (let i = 0; i < 3; i++) {
    const a = LEG_A[i] + Math.PI / 3;
    const out = cw / 2 + 0.9, tx = -Math.sin(a), tz = Math.cos(a);
    for (const s of [-0.8, 0.8]) {
      const x = Math.cos(a) * out + tx * s, z = Math.sin(a) * out + tz * s;
      g.add(box(0.18, CH, 0.18, MT.dark, x, CH / 2, z, -a));
    }
    const cabY = [44, 103, 141][i];
    const cx = Math.cos(a) * (out + 0.4), cz = Math.sin(a) * (out + 0.4);
    g.add(box(1.8, 3.0, 2.4, MT.white, cx, cabY, cz, -a));
    g.add(box(0.06, 2.0, 2.0, MT.glass, cx + Math.cos(a) * 0.92, cabY + 0.2, cz + Math.sin(a) * 0.92, -a));
  }

  // --- legs: three pairs of swept columns ------------------------------------
  // Section: a three-sided welded tube reads as a pentagon with the ridge
  // facing OUT, so each column catches a highlight along its outer edge.
  const section = (d, w) => [[d / 2, 0], [0.12 * d, w / 2], [-d / 2, w / 2], [-d / 2, -w / 2], [0.12 * d, -w / 2]];
  for (const a of LEG_A) {
    const R = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const T = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const at = (h, s) => R.clone().multiplyScalar(legR(h)).addScaledVector(T, s).setY(h);
    for (const side of [-1, 1]) {
      const cs = LEG_H.map((h) => ({ p: at(h, side * pairS(h)), d: colD(h), w: colW(h) }));
      g.add(new THREE.Mesh(sweep(cs, section, R), MT.white));
    }
    // The shirtwaist: a plate welding the pair into one blade, 79-128 m,
    // with its ends eased so the pair visibly merges and splits.
    {
      const hs = [];
      for (let h = PAIR_JOIN - 8; h <= PAIR_FORK + 5; h += 3) hs.push(h);
      const cs = hs.map((h) => {
        const inside = smooth(PAIR_JOIN - 8, PAIR_JOIN, h) * (1 - smooth(PAIR_FORK, PAIR_FORK + 5, h));
        return { p: at(h, 0), d: colD(h) * 0.72, w: Math.max(0.05, 2 * pairS(h) * inside) };
      });
      g.add(new THREE.Mesh(sweep(cs, (d, w) => [[d / 2, w / 2], [-d / 2, w / 2], [-d / 2, -w / 2], [d / 2, -w / 2]], R), MT.white));
    }
    // Ladder rungs between the pair below the join, and the 200 ft tie to the
    // core. (The 100 ft tie is inside the SkyLine.)
    for (let h = 9; h < PAIR_JOIN - 6; h += 8.6) {
      if (Math.abs(h - NEEDLE.skyline) < 4) continue;
      const s = pairS(h) - colW(h) * 0.45;
      g.add(beam(at(h, -s), at(h, s), colD(h) * 0.55, 0.55, MT.white));
    }
    const tie = 61;
    g.add(beam(at(tie, 0).addScaledVector(R, -colD(tie) / 2), R.clone().multiplyScalar(cw / 2).setY(tie), 0.7, 0.9, MT.white));
    // Foot pedestals.
    for (const side of [-1, 1]) {
      const p = at(0, side * pairS(0));
      g.add(box(3.0, 1.4, 2.2, MT.concrete, p.x, 0.5, p.z, -a));
    }
  }

  // --- SkyLine level (100 ft) --------------------------------------------------
  // A banqueting floor slung between the legs, overhanging them: a hexagon
  // whose short sides carry the leg pairs through.
  {
    const hex = (rad) => {
      const pts = [];
      for (const a of LEG_A) for (const d of [-0.42, 0.42]) pts.push([Math.cos(a + d) * rad, Math.sin(a + d) * rad]);
      return pts;
    };
    const slab = (rad, y0, y1, mat) => {
      const s = new THREE.Shape(hex(rad).map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, y0, 0);
      g.add(new THREE.Mesh(geo, mat));
    };
    const y = NEEDLE.skyline;
    slab(14.6, y - 3.4, y - 2.2, MT.white);  // soffit / floor structure
    slab(14.0, y - 2.2, y + 1.4, MT.glass);  // glazed banquet room
    slab(15.2, y + 1.4, y + 2.6, MT.white);  // roof slab and fascia
  }

  // --- top house ---------------------------------------------------------------
  // The saucer: a flared white bowl under the Loupe.
  g.add(lathe([
    [[0, 146.6], [5.5, 146.6], [8.6, 147.2], [12.4, 148.5], [15.0, 150.1], [16.0, 151.2]],
    [[16.0, 151.2], [16.0, 152.0]],
    [[16.0, 152.0], [14.9, 152.2]],
  ], MT.white, 64));
  // Sunburst vanes: radial fins under the saucer (the 1961 ring girder's
  // "radiating beams or fins"), the rays seen from the plaza.
  const FINS = 48;
  for (let k = 0; k < FINS; k++) {
    const a = (k + 0.5) / FINS * Math.PI * 2;
    g.add(radialPlate([[7.2, 146.95], [12.4, 148.45], [15.9, 150.9], [15.9, 150.2], [12.2, 147.7], [7.2, 146.2]], 0.16, a, MT.white));
  }
  // The Loupe (500 ft): full-height glass with slim white mullions.
  g.add(lathe([[[14.9, 152.2], [14.6, 155.2]]], MT.glass, 64));
  for (let k = 0; k < FINS; k++) {
    const a = k / FINS * Math.PI * 2;
    g.add(beam(ringPt(14.98, a, 152.2), ringPt(14.68, a, 155.2), 0.14, 0.14, MT.white));
  }
  // Ring level and the observation deck slab, with its white fascia.
  g.add(lathe([
    [[14.6, 155.2], [15.0, 155.2]],
    [[15.0, 155.2], [15.0, 157.4]],
    [[15.0, 157.4], [16.6, 157.4]],
    [[16.6, 157.4], [16.6, 158.4]],
    [[16.6, 158.4], [13.8, 158.5]],
  ], MT.white, 64));
  // Indoor observation level (520 ft): glass wall set back behind the deck.
  g.add(lathe([[[13.8, 158.5], [13.6, 161.8]]], MT.glass, 64));
  for (let k = 0; k < FINS / 2; k++) {
    const a = (k + 0.25) / (FINS / 2) * Math.PI * 2;
    g.add(beam(ringPt(13.84, a, 158.5), ringPt(13.64, a, 161.8), 0.16, 0.16, MT.white));
  }
  // The 48 open-air glass barriers, 11 ft tall and leaning out 14 deg.
  {
    const pos = [], nor = [];
    const tilt = 14 * Math.PI / 180, H = 3.35, r0 = 16.35, y0 = NEEDLE.obs + 0.05;
    const r1 = r0 + Math.sin(tilt) * H, y1 = y0 + Math.cos(tilt) * H;
    const gap = 0.012;
    for (let k = 0; k < 48; k++) {
      const a0 = (k + gap) / 48 * Math.PI * 2, a1 = (k + 1 - gap) / 48 * Math.PI * 2;
      const q = [ringPt(r0, a0, y0), ringPt(r0, a1, y0), ringPt(r1, a1, y1), ringPt(r1, a0, y1)];
      const n = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[3], q[0])).normalize();
      for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(q[i].x, q[i].y, q[i].z); nor.push(n.x, n.y, n.z); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.add(new THREE.Mesh(geo, MT.barrier));
  }
  // The halo: a ring hovering outside the deck on down-sloping outriggers.
  const HR = NEEDLE.haloR, HY = 155.6;
  g.add(lathe([
    [[HR - 0.3, HY - 0.32], [HR + 0.1, HY - 0.32]],
    [[HR + 0.1, HY - 0.32], [HR + 0.1, HY + 0.32]],
    [[HR + 0.1, HY + 0.32], [HR - 0.3, HY + 0.32]],
    [[HR - 0.3, HY + 0.32], [HR - 0.3, HY - 0.32]],
  ], MT.white, 72));
  // A dark soffit through the outriggers' mid-plane: from the plaza the rays
  // read light against it (as they do in photographs looking up), and from
  // level the halo reads as the dark band under its white rim.
  g.add(lathe([[[16.5, 157.85], [HR - 0.25, HY + 0.04]], [[HR - 0.25, HY + 0.04], [16.5, 157.85]]], MT.dark, 72));
  for (let k = 0; k < FINS; k++) {
    const a = (k + 0.5) / FINS * Math.PI * 2;
    g.add(radialPlate([[16.5, 158.2], [HR - 0.25, HY + 0.28], [HR - 0.25, HY - 0.2], [16.5, 157.5]], 0.1, a, MT.white));
  }
  // Roof over the deck, with the low radial ribs that read from the air.
  g.add(lathe([
    [[13.6, 161.8], [16.6, 162.1]],
    [[16.6, 162.1], [16.7, 162.7]],
    [[16.7, 162.7], [12.5, 163.5], [8.6, 164.5], [6.7, 165.0]],
  ], MT.white, 64));
  for (let k = 0; k < FINS; k++) {
    const a = (k + 0.5) / FINS * Math.PI * 2;
    g.add(radialPlate([[7.0, 164.9], [16.4, 162.72], [16.4, 162.95], [7.0, 165.3]], 0.2, a, MT.white));
  }
  // The cap ("pagoda roof"), its dark mechanical band, and the mast.
  g.add(lathe([
    [[6.7, 165.0], [7.0, 165.8], [7.0, 166.5]],
    [[7.0, 166.5], [6.3, 167.3], [5.0, 167.7]],
  ], MT.white, 48));
  g.add(lathe([[[4.6, 167.7], [4.6, 169.1]]], MT.dark, 32));
  g.add(lathe([[[4.6, 167.7], [5.0, 167.7]], [[5.0, 169.1], [5.0, 169.5]], [[5.0, 169.5], [0, 169.6]], [[4.6, 169.1], [5.0, 169.1]]], MT.white, 32));
  g.add(lathe([[[0.5, 169.6], [0.42, 176], [0.2, 183.7]]], MT.dark, 10));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), MT.beacon);
  beacon.position.y = 184.0;
  g.add(beacon);
  return g;
}
