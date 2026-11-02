// THE GRAPHICS PASS (2026-11): shader-level looks, phone first, each one a
// switch. Nothing here adds a render target or a pass; each term lives inside
// a program that already exists (or, for the lamp glow, one small draw), and
// is gated by a uniform the frame loop writes from the switches below, so the
// same boot can A/B every one of them and a phone can bisect them.
//
//   window.__noCarCoat   the phone's car lacquer (vehicles.js paintMaterial)
//   window.__noWaterFx   the water's bank reflections + sun glitter (world.js buildWater)
//   window.__noDuskHaze  golden-hour aerial perspective (main.js draw, fog)
//   window.__noLampGlow  the street lamps' glow at dusk / night (src/lampglow.js)
//   window.__noGfx       all four at once
//
// The Graphics quality `low` turns them all off too (main.js applyQuality ->
// GFX.quality). See apps/autokw/CLAUDE.md "The graphics pass".

import * as THREE from './three.js';

/** Shared uniforms: every program that carries a term holds these same objects. */
export const GFXU = {
  gfxLacq: { value: 1 },
  gfxWater: { value: 1 },
  // the water's glitter (world.js buildWater): the sun's direction (world)
  // and colour x intensity, written by main.js from the sun light / the dome
  gfxSunW: { value: new THREE.Vector3(0, 1, 0) },
  gfxSunC: { value: new THREE.Color(0, 0, 0) },
  // the golden hour's fog (installGfxHooks): xyz the dome's sun, w how much
  gfxFogSun: { value: new THREE.Vector4(0, 0, 0, 0) },
  // the dome's horizon at h = 0 away from / beside / toward the sun, encoded
  gfxFogA: { value: new THREE.Color(0, 0, 0) },
  gfxFogS: { value: new THREE.Color(0, 0, 0) },
  gfxFogT: { value: new THREE.Color(0, 0, 0) },
};
const FOG_KEYS = ['gfxFogSun', 'gfxFogA', 'gfxFogS', 'gfxFogT'];

/** Live state (read by main.js / tod.js / lampglow.js). */
export const GFX = {
  quality: 'high',
  lacq: true, water: true, duskHaze: true, lampGlow: true,
};

/** Once per drawn frame: the switches into the uniforms. Allocation-free. */
export function gfxFrame() {
  const w = typeof window !== 'undefined' ? window : {};
  const all = !w.__noGfx && GFX.quality !== 'low';
  GFX.lacq = all && !w.__noCarCoat;
  GFX.water = all && !w.__noWaterFx;
  GFX.duskHaze = all && !w.__noDuskHaze;
  GFX.lampGlow = all && !w.__noLampGlow;
  GFXU.gfxLacq.value = GFX.lacq ? 1 : 0;
  GFXU.gfxWater.value = GFX.water ? 1 : 0;
}

/**
 * GOLDEN-HOUR AERIAL PERSPECTIVE (`window.__noDuskHaze`). By day the fog takes
 * the day sun's fixed haze tint (main.js installHeightFog); at dusk the dome
 * turns orange toward the sinking disc and violet away from it, while the fog
 * kept the afternoon's tint, so every distant field met the glowing horizon
 * at a hard brown line and the city sat under the sunset like a cut-out. Here
 * the fog's colour is the DOME'S OWN HORIZON (its h = 0 colour, computed on
 * the CPU each frame from the same uniforms at three bearings: away, beside,
 * toward the dome's sun) and it thickens with the golden hour, so distance
 * dissolves into the sunset on the sun's side and into blue dusk behind you.
 * All in the fog chunk every fogged program already has: 4 uniforms, a dot
 * and a mix per fogged fragment, behind `gfxFogSun.w > 0` (0 by day and at
 * night: the day's fog is exactly as before).
 *
 * The uniforms ride weather.js's Material.prototype.onBuild (wrapped here:
 * every program, ShaderMaterials included, takes the four shared objects), so
 * a program three built without them reads 0 -- the branch is off.
 */
export function installGfxHooks() {
  const C = THREE.ShaderChunk;
  if (C.__gfxFog) return;
  C.__gfxFog = true;
  const at = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );';
  if (!C.fog_fragment.includes(at)) { console.warn('gfx: fog chunk changed, dusk haze not installed'); return; }
  C.fog_pars_fragment = `${C.fog_pars_fragment}\n#ifdef USE_FOG\n  uniform vec4 gfxFogSun;\n  uniform vec3 gfxFogA, gfxFogS, gfxFogT;\n#endif`;
  C.fog_fragment = C.fog_fragment.replace(at, `if ( gfxFogSun.w > 0.0 ) {
		vec2 gfR = normalize( vFogRay.xz + 1e-4 );
		float gfH = 0.5 + 0.5 * dot( gfR, normalize( gfxFogSun.xz + 1e-4 ) );
		vec3 gfC = gfH < 0.5 ? mix( gfxFogA, gfxFogS, gfH * 2.0 ) : mix( gfxFogS, gfxFogT, gfH * 2.0 - 1.0 );
		fogCol = mix( fogCol, gfC, gfxFogSun.w );
	}
	${at}`);
  const MP = THREE.Material.prototype;
  const prev = MP.onBuild;
  if (MP.__gfxHook) return;
  Object.defineProperty(MP, '__gfxHook', { value: true });
  MP.onBuild = function (object, sh) {
    if (prev) prev.call(this, object, sh);
    if (sh && sh.uniforms && sh.fragmentShader && sh.fragmentShader.includes('fog_fragment')) {
      for (const k of FOG_KEYS) sh.uniforms[k] = GFXU[k];
    }
  };
}

// scratch (no per-frame allocation)
const _hz = new THREE.Color();
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** The dome's skyColor at h = 0, for the bearing `cosA` off its sun (world.js SKY_FN, no clouds), encoded. */
function domeHorizon(S, cosA, out) {
  const sd = S.sunDir.value;
  const hl = Math.hypot(sd.x, sd.z) || 1;
  const mu = Math.max(0, cosA * hl);            // d is horizontal: dot(d, sun) = cosA x |sun.xz|
  const hs = 0.5 + 0.5 * cosA * hl;
  out.copy(S.horizon.value);
  out.r += S.sunCol.value.r * (Math.pow(mu, 6) * 0.16 + Math.pow(mu, 60) * 0.35);
  out.g += S.sunCol.value.g * (Math.pow(mu, 6) * 0.16 + Math.pow(mu, 60) * 0.35);
  out.b += S.sunCol.value.b * (Math.pow(mu, 6) * 0.16 + Math.pow(mu, 60) * 0.35);
  if (S.todOn && S.todOn.value > 0) {
    const g = Math.pow(Math.max(cosA, 0), 3) * 0.9 + 0.18;
    out.r += S.todGlow.value.x * g; out.g += S.todGlow.value.y * g; out.b += S.todGlow.value.z * g;
  }
  const T = S.hazeToward.value, A = S.hazeAway.value, k = hs * hs;
  _hz.copy(S.haze.value);
  _hz.r *= A.x + (T.x - A.x) * k; _hz.g *= A.y + (T.y - A.y) * k; _hz.b *= A.z + (T.z - A.z) * k;
  out.lerp(_hz, 0.55);
  out.r = Math.min(out.r, 1); out.g = Math.min(out.g, 1); out.b = Math.min(out.b, 1);
  return out.convertLinearToSRGB();
}

/**
 * Per frame (main.js draw): the dusk fog's colours and amount, and the factor
 * the fog's density is multiplied by. `du` / `ni` are tod.js's dusk and night
 * (0..1), `over` the weather's overcast. Returns the density factor (1 by day).
 */
export function gfxFog(sky, du, ni, over) {
  const w = GFX.duskHaze && sky ? du * (1 - ni) * (1 - (over || 0)) : 0;
  const U = GFXU.gfxFogSun.value;
  if (w <= 0.001) { U.w = 0; return 1; }
  const sd = sky.sunDir.value;
  U.set(sd.x, sd.y, sd.z, w);
  domeHorizon(sky, -1, GFXU.gfxFogA.value);
  domeHorizon(sky, 0, GFXU.gfxFogS.value);
  domeHorizon(sky, 1, GFXU.gfxFogT.value);
  // thicker at the golden hour: the low sun's long path through the haze
  return 1 + 1.3 * w * sstep(0, 1, du);
}

/** Per frame: the sun the water glitters with -- the dome's disc direction, the light's colour. */
export function gfxSun(sky, sunLight) {
  if (sky && sky.sunDir) GFXU.gfxSunW.value.copy(sky.sunDir.value);
  if (sunLight) GFXU.gfxSunC.value.copy(sunLight.color).multiplyScalar(sunLight.intensity);
}
