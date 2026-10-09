// The mountains on the horizon: the Olympics to the west, Mt Rainier to the
// SSE, the Cascades to the east -- from real elevation data. ONE draw, no
// render target, two small RGBA8 textures.
//
// It is a sky element, like the dome (see "Mountains on the horizon" in
// guide/rendering.md): a cylinder band around the camera whose vertex shader
// drops translation and writes z = w, so it is infinitely far from wherever
// you stand, never parallaxes, and is never clipped by the far plane. It is
// drawn right after the dome (renderOrder -999) with depth off and alpha
// blending, before any city geometry, so every building, hill, island and the
// water simply paint over it.
//
// What it draws comes from data/mountains.bin, baked by tools/build_mountains.py
// from USGS 3DEP elevation (public domain) as seen from the map's origin:
//
//   SKYLINE  one column per 0.044 deg of bearing: the elevation angle (the earth's
//            curvature already off) and a smoothed distance of whatever stands
//            highest on the sky there -- the real silhouette of the Olympics, the Cascades
//            and Rainier. The fragment shader compares the pixel's elevation
//            with it AS SEEN FROM THE CAMERA'S ALTITUDE, so a plane at 1.5 km
//            sees the range sink toward the horizon, as it should.
//   FACE     Mt Rainier only: a 400 x 100 view of the mountain, every texel a ray
//            marched against the 26 m DEM -- height, slope, sunlit factor (the
//            game's fixed sun, cast shadows included) and distance of what it
//            hit. Foothills in front hide the lower slopes, as from Seattle.
//
// Everywhere else the shader paints procedurally (forest, rock, snow by height
// and noise). Elevation angles are stretched by EXAG for readability.

import * as THREE from './three.js';

export const COLS = 8192;
const R_EARTH = 6371000;
// Light bends toward the ground: a ray sees the earth ~13 % less curved
// (standard terrestrial refraction, k = 0.13). Matches tools/build_mountains.py.
const R_EFF = R_EARTH / (1 - 0.13);
// Every elevation angle is stretched by this much. The honest numbers make
// Rainier a 2.3 deg lump and the Olympics a 1-2 deg line (which is the truth
// from sea level); 1.2x is the most that stays honest and still reads. Must
// match EXAG in tools/build_mountains.py (Rainier's face is baked in these
// units).
export const EXAG = 1.2;
export const dropAt = (d) => (d * d) / (2 * R_EFF);

/** Decode mountains.bin (see tools/build_mountains.py for the layout). */
export function decodeMountains(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'AUTM') throw new Error('mountains.bin: bad magic ' + magic);
  const cols = dv.getUint16(6, true), rw = dv.getUint16(8, true), rh = dv.getUint16(10, true);
  const win = [12, 16, 20, 24, 28].map((o) => dv.getFloat32(o, true));   // b0, span, t0, t1, rdist
  const sky = new Uint8Array(buf, 32, cols * 4);
  const face = new Uint8Array(buf, 32 + cols * 4, rw * rh * 4);
  return { cols, rw, rh, b0: win[0], span: win[1], t0: win[2], t1: win[3], rdist: win[4], sky, face };
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
  uniform sampler2D tProf, tFace;
  uniform float camAlt;
  uniform vec4 faceWin;     // bearing centre (0..1), width (0..1), tan range lo, hi
  uniform float faceDist;
  uniform vec3 sunDir, horizon, mid, haze, hazeToward, hazeAway;
  varying float vB, vT;
  varying vec3 vDir;
  const float N = ${COLS}.0;
  const float EXAG = ${EXAG.toFixed(3)};
  const float INV2R = ${(1 / (2 * R_EFF)).toExponential(6)};

  vec4 tap(float i) { return texture2D(tProf, vec2((mod(i, N) + 0.5) / N, 0.5)); }
  float decT(vec4 c) { return (c.r * 255.0 * 256.0 + c.g * 255.0) * 2e-6; }
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
    float dist = mix(c0.b, c1.b, f) * 255.0 * 600.0;
    // the skyline's true angle, stretched, then lowered by the camera's own height
    float tanTop = mix(decT(c0), decT(c1), f) * EXAG - camAlt / dist;
    float fw = fwidth(vT);
    float over = vT - tanTop;
    if (over > fw) discard;
    // height of this pixel's line of sight over the sea at the range's distance
    float hm = camAlt + vT * dist;
    if (hm < 0.0) discard;
    float edge = 1.0 - smoothstep(-fw, fw, over);

    vec3 d = normalize(vDir);
    // true height above the sea, the stretch and the curve undone
    float ht = hm / EXAG + dist * dist * INV2R;
    float slope = 38.0;

    // tilt of the silhouette along the bearing: which way this flank faces
    float dH = (decT(tap(i0 + 2.0)) - decT(tap(i0 - 1.0))) * EXAG / (3.0 * ${(2 * Math.PI / COLS).toFixed(7)});
    vec3 tang = normalize(vec3(-d.z, 0.0, d.x));      // d(bearing): (cos b, 0, sin b)
    float s = atan(d.x, -d.z) * dist;                 // metres along the sky
    vec2 q = vec2(s / 330.0, ht / 230.0);
    float n0 = fbm(q);
    float gx = fbm(q + vec2(0.07, 0.0)) - n0;
    float gy = fbm(q + vec2(0.0, 0.07)) - n0;
    // the silhouette's slope tilts only the pixels just under it; a whole column
    // sharing one tilt reads as vertical bars
    float tiltW = exp(-max(tanTop - vT, 0.0) * dist / 500.0);
    vec3 face = normalize(-d * 0.8 + vec3(0.0, 0.35, 0.0) + tang * clamp(-dH * 1.1 * tiltW + gx * 5.0, -0.9, 0.9)
                          + vec3(0.0, clamp(gy * 3.0, -0.4, 0.4), 0.0));
    float lit = clamp(dot(face, sunDir), 0.0, 1.0);

    // Mt Rainier: where the baked view of it applies, its own height, slope,
    // light and distance replace the procedural ones.
    float fu = (vB - faceWin.x) / faceWin.y + 0.5;
    float fv = (vT + camAlt / faceDist - faceWin.z) / (faceWin.w - faceWin.z);
    float wf = smoothstep(0.0, 0.07, fu) * smoothstep(1.0, 0.93, fu) * smoothstep(0.0, 0.1, fv);
    if (wf > 0.0) {
      vec4 fc = texture2D(tFace, vec2(clamp(fu, 0.0, 1.0), clamp(fv, 0.0, 1.0)));
      ht = mix(ht, fc.r * 4500.0, wf);
      slope = mix(slope, fc.g * 90.0, wf);
      lit = mix(lit, fc.b, wf);
      dist = mix(dist, 70000.0 + fc.a * 45000.0, wf);
    }
    float rock3 = fbm(vec2(s / 120.0, ht / 70.0));    // fine rock and ice texture

    // forest -> bare rock -> snow and ice, where the ground is gentle enough to hold it
    // the Olympics (bearings ~230-335) hold snow lower than the Cascades' east side
    float westW = smoothstep(0.64, 0.68, vB) * (1.0 - smoothstep(0.91, 0.94, vB));
    float snowLine = mix(1900.0, 1450.0, westW) + (n0 - 0.5) * 520.0;
    float snow = smoothstep(snowLine, snowLine + 260.0, ht) * (1.0 - smoothstep(44.0, 60.0, slope + (rock3 - 0.5) * 16.0));
    snow = clamp(snow + smoothstep(snowLine + 700.0, snowLine + 1100.0, ht) * (1.0 - smoothstep(58.0, 72.0, slope)), 0.0, 1.0);
    vec3 forest = vec3(0.05, 0.09, 0.075);
    vec3 rock = vec3(0.2, 0.19, 0.2);
    vec3 col = mix(forest, rock, smoothstep(950.0, 1550.0, ht + (n0 - 0.5) * 500.0));
    col = mix(col, vec3(0.86, 0.9, 0.97), snow);
    col *= 0.88 + 0.3 * (rock3 - 0.5);
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
 * shared so the haze and sun are the ones the sky and the fog already use;
 * `data` is decodeMountains() of data/mountains.bin. Returns the mesh.
 */
export function buildMountains(scene, sky, data) {
  const tex = new THREE.DataTexture(data.sky, data.cols, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const faceTex = new THREE.DataTexture(data.face, data.rw, data.rh, THREE.RGBAFormat, THREE.UnsignedByteType);
  faceTex.minFilter = faceTex.magFilter = THREE.LinearFilter;
  faceTex.generateMipmaps = false;
  faceTex.needsUpdate = true;

  // A cylinder of radius 1 around the camera, tan(elevation) -0.3 .. +0.12:
  // from 17 deg under the horizon (a plane's view of the range's foot) to 7 deg
  // over it (Rainier peaks at ~3). 2 rows, 720 columns.
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
      tFace: { value: faceTex },
      camAlt: { value: 0 },
      faceWin: { value: new THREE.Vector4(data.b0 / 360, data.span / 360, data.t0, data.t1) },
      faceDist: { value: data.rdist },
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
  scene.add(mesh);
  return mesh;
}
