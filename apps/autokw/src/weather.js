// WEATHER in Waterloo Region: clear, overcast, rain, snow and fog, the way the
// months really bring them (Environment Canada's Kitchener-Waterloo normals:
// snow on the ground December to March, the wettest months spring and late
// summer-fall, fog in the shoulder seasons).
//
// THE LAW: in clear weather nothing changes. Every shader term below sits in a
// uniform branch that is skipped at 0, every light, fog and gameplay factor is
// multiplied by exactly 1, the precipitation mesh is not built, and the sky's
// environment map is never re-rendered -- so a clear boot is pixel- and
// trafficbench-identical to the game without this file.
//
// WHAT IT TOUCHES
// - Every lit material (MeshStandard / Lambert / Phong) gets the same short
//   block before <emissivemap_fragment>: wet darkening + a sheen and puddles
//   on flat ground, snow on whatever faces up (roads plowed: slush, piled at
//   the kerb). It is installed ONCE, as THREE.Material.prototype.onBuild
//   (three calls it just before each material's own onBeforeCompile), so no
//   material file needs editing and none can be missed.
// - The sky dome (world.js buildSky: `overcast` and its greys), the sun,
//   hemisphere and ambient (dimmed key, lifted fill: softer shadows), the fog
//   (denser, greyer), the IBL (re-rendered at overcast 0.5 and 1).
// - ONE draw for the rain or the snow: a box of streaks / flakes round the
//   camera (Precip), hidden from the air.
// - Grip (WXK.mu, vehicles.js), the AI's pace and cornering (WXK.ai /
//   aiLat, traffic.js), how many people are out walking (WXK.peds, peds.js),
//   headlights (WXU.head, vehicles.js trim shader), the rain's hiss and tyre
//   spray (audio.js, from main.js audioState).
//
// Harness: `window.__weather = 'rain'` (clear / overcast / rain / snow / fog /
// auto) snaps to that weather at the next frame; `window.__wx` is the live
// state (and `__wx.set(mode, instant)`). The pause menu's setting is
// localStorage `autokw-weather` (auto / clear / rain / snow).

import * as THREE from './three.js';
// the time of day's block rides the same hook (tod.js; it imports nothing back)
import { TODU, TODK, TOD, TOD_PARS, TOD_BLOCK, todDefines } from './tod.js';

/** Shared shader uniforms: one object each, every material holds the same. */
export const WXU = {
  wxOn: { value: 0 }, wxWet: { value: 0 }, wxSnow: { value: 0 }, wxHead: { value: 0 },
};
/** Gameplay factors: EXACTLY 1 in clear weather (see the law above). */
export const WXK = { mu: 1, ai: 1, aiLat: 1, peds: 1 };
/** Shader install state: `ok` false after a failed compile (all weather visuals off). */
export const WX = { ok: true, failed: '' };

// ---------------------------------------------------------------------------
// The shader block.

const WX_PARS = `
uniform float wxOn, wxWet, wxSnow;
float wxHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float wxNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( wxHash( i ), wxHash( i + vec2( 1.0, 0.0 ) ), f.x ),
		mix( wxHash( i + vec2( 0.0, 1.0 ) ), wxHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;

// Before <emissivemap_fragment>: diffuseColor, normal (view space, faced) and,
// for STANDARD, roughnessFactor / metalnessFactor exist and lights come after.
const WX_BLOCK = `
	// WX_INJ (weather.js)
	if ( wxOn > 0.5 ) {
		float wxUp = dot( normal, ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
		vec3 wxP = ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz + cameraPosition;
		vec2 wxQ = mod( wxP.xz, 1024.0 );
		float wxFlat = smoothstep( 0.55, 0.92, wxUp );
		float wxN1 = wxNoise( wxQ * 0.31 );
		float wxN2 = wxNoise( wxQ * 1.9 + 17.0 );
		float wxPor = 1.0;
		#ifdef STANDARD
			wxPor = 0.35 + 0.65 * smoothstep( 0.3, 0.85, roughnessFactor );
		#endif
		float wxW = wxWet;
		float wxKerb = 0.0, wxSurf = 0.0;
		#ifdef WX_ROAD
			#ifdef USE_COLOR
				// meshRoad's wear: the vertex colour falls ~30 % over the outer
				// 45 % of the half-width -- the kerb side of the lane
				wxKerb = 1.0 - smoothstep( 0.74, 0.93, vColor.g );
			#endif
			#ifdef WX_ROADWALK
				wxSurf = vSurf;
				if ( wxSurf > 0.5 ) wxKerb = 0.0;
			#endif
			// a plowed road is wet with melt whenever there is snow about
			wxW = max( wxW, wxSnow * 0.85 );
		#endif
		if ( wxW > 0.001 ) {
			float wxD = wxW * wxPor * ( 0.16 + 0.2 * wxFlat );
			#ifdef WX_ROAD
				if ( wxSurf < 0.5 ) wxD = wxW * ( 0.3 + 0.12 * wxN1 );
			#endif
			diffuseColor.rgb *= 1.0 - wxD;
			#ifdef STANDARD
				float wxPud = wxFlat * smoothstep( 0.6, 0.74, wxN1 * 0.75 + wxN2 * 0.25 ) * wxW;
				#ifndef WX_ROAD
					wxPud *= 0.45;
				#endif
				#ifdef WX_NOPUDDLE
					wxPud = 0.0;
				#endif
				roughnessFactor = mix( roughnessFactor, roughnessFactor * mix( 0.7, 0.4, wxFlat ), wxW );
				#ifdef WX_ROAD
					if ( wxSurf < 0.5 ) roughnessFactor = mix( roughnessFactor, 0.2, wxW * 0.8 );
				#endif
				roughnessFactor = mix( roughnessFactor, 0.05, wxPud );
				diffuseColor.rgb *= 1.0 - 0.3 * wxPud;
			#endif
		}
		#if ! defined( WX_NOSNOW ) && ! defined( USE_SKINNING )
		if ( wxSnow > 0.001 ) {
			float wxC = smoothstep( 0.45, 0.8, wxUp + ( wxN2 - 0.5 ) * 0.22 );
			vec3 wxSc = vec3( 0.74, 0.77, 0.82 ) * ( 0.92 + 0.12 * wxN2 );
			#ifdef WX_ROAD
				if ( wxSurf < 0.5 ) {
					// asphalt: plowed and salted -- grey slush in broken patches, a
					// ridge of it along the kerb
					float wxSl = smoothstep( 0.4, 0.66, wxN1 * 0.55 + wxN2 * 0.45 + wxKerb * 0.5 );
					wxC *= ( 0.14 + 0.86 * smoothstep( 0.25, 0.85, wxKerb ) ) * wxSl;
					wxSc = mix( vec3( 0.40, 0.40, 0.41 ), wxSc, 0.4 + 0.6 * wxKerb );
				} else if ( wxSurf < 1.5 ) {
					// a pavement: shovelled, mostly
					wxC *= 0.85 * smoothstep( 0.3, 0.62, wxN1 * 0.7 + wxN2 * 0.3 );
				} else if ( wxSurf < 3.5 ) {
					// gravel: snow-packed between the wheel tracks
					wxC *= 0.9;
					wxSc *= 0.88;
				}
			#endif
			// drifted thin and thick: a little of what is under it shows
			wxC *= wxSnow * ( 0.86 + 0.14 * wxN1 );
			diffuseColor.rgb = mix( diffuseColor.rgb, wxSc, wxC );
			#ifdef STANDARD
				roughnessFactor = mix( roughnessFactor, 0.82, wxC );
				metalnessFactor = mix( metalnessFactor, 0.0, wxC );
			#endif
		}
		#endif
	}
`;

const INC = '#include <emissivemap_fragment>';

/**
 * What kind of surface this program is (defines), from the material's tag
 * (`userData.wx`: 'road' plowed asphalt, 'roadwalk' world.js's road material
 * with its `vSurf`, 'nosnow') and its program key (water).
 * A tagged material MUST have a program key of its own (three shares a
 * program between materials with one key, defines and all).
 */
function wxDefines(m) {
  const tag = (m.userData && m.userData.wx) || '';
  const d = [];
  if (tag === 'road' || tag === 'roadwalk') d.push('WX_ROAD');
  if (tag === 'roadwalk') d.push('WX_ROADWALK');
  let key = '';
  try { key = String(m.customProgramCacheKey()); } catch (e) { key = ''; }
  // water takes no snow and holds no puddle
  const water = /water/i.test(key);
  if (tag === 'nosnow' || water) d.push('WX_NOSNOW');
  if (water) d.push('WX_NOPUDDLE');
  return d;
}

const BASIC_AT = 'vec3 outgoingLight = reflectedLight.indirectDiffuse;';
function wxInject(sh, m) {
  if (!WX.ok && !TOD.ok) return;
  const fs = sh.fragmentShader;
  // an unlit picture (MeshBasic with a map: signs, banners, lettering) is
  // dimmed after dark (tod.js todBasic); a lamp's own (userData.todKeep, its
  // own program key) and the glows (no map) stay
  if (TOD.ok && m.isMeshBasicMaterial && m.map && !(m.userData && m.userData.todKeep)
    && typeof fs === 'string' && fs.indexOf(BASIC_AT) >= 0 && fs.indexOf('TOD_BASIC') < 0) {
    sh.uniforms.todOn = TODU.todOn;
    sh.uniforms.todBasic = TODU.todBasic;
    sh.fragmentShader = 'uniform float todOn, todBasic;\n' + fs.replace(BASIC_AT, BASIC_AT + '\n\t// TOD_BASIC (tod.js)\n\tif ( todOn > 0.5 ) outgoingLight *= todBasic;');
    return;
  }
  if (typeof fs !== 'string' || fs.indexOf('WX_INJ') >= 0 || fs.indexOf('TOD_INJ') >= 0 || fs.indexOf(INC) < 0 || fs.indexOf('vViewPosition') < 0) return;
  let pre = '', at = INC;
  if (WX.ok) {
    pre += wxDefines(m).map((k) => `#define ${k}\n`).join('') + WX_PARS;
    sh.uniforms.wxOn = WXU.wxOn;
    sh.uniforms.wxWet = WXU.wxWet;
    sh.uniforms.wxSnow = WXU.wxSnow;
    at = WX_BLOCK + at;
  }
  // the time of day (tod.js): AFTER the emissive chunk, adding to it
  if (TOD.ok) {
    pre += todDefines(m).map((k) => `#define ${k}\n`).join('') + TOD_PARS;
    for (const k of ['todOn', 'todWin', 'todWinB', 'todRoad', 'todLamp', 'todLampCol', 'todHeadP', 'todHeadD', 'todHeadCol']) sh.uniforms[k] = TODU[k];
    at = at + TOD_BLOCK;
  }
  sh.fragmentShader = pre + fs.replace(INC, at);
}

// The hook: three calls material.onBuild(object, parameters, renderer) for
// every new program just BEFORE the material's own onBeforeCompile, with the
// library source still unexpanded. Nothing here overrides onBuild, so it goes
// on the prototype: the block lands on every lit material (made before or
// after this module), the material's own hook then edits around it (every
// hook here keeps <emissivemap_fragment>), and onBeforeCompile and
// customProgramCacheKey are left exactly as they were -- landmarks.js and
// vehicles.js compare them by identity.
const MP = THREE.Material.prototype;
if (!MP.__wxHook) {
  Object.defineProperty(MP, '__wxHook', { value: true });
  MP.onBuild = function (object, sh) { wxInject(sh, this); };
}

/**
 * Compile the block once on throwaway materials before anything real
 * compiles; a driver that will not take it turns the weather's visuals off
 * (WX.ok false: no block is injected into anything). The precipitation's own shader is checked the
 * same way when it is first built.
 */
export function testWeatherShaders(renderer) {
  // both blocks together first; if that fails, the time of day's alone is
  // dropped (Day, always) and the weather's is tried on its own
  if (compileTest(renderer)) return true;
  if (TOD.ok) {
    TOD.ok = false; TOD.failed = WX.failed || 'compile';
    console.warn('tod: shader block failed to compile -- Day only');
    WX.ok = true; WX.failed = '';
    return compileTest(renderer);
  }
  return false;
}
function compileTest(renderer) {
  try {
    const sc = new THREE.Scene();
    sc.fog = new THREE.FogExp2(0x888888, 0.001);
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.8, vertexColors: true }),
      new THREE.MeshLambertMaterial({ color: 0x808080 }),
      new THREE.MeshPhongMaterial({ color: 0x808080 }),
    ];
    mats[0].userData.wx = 'road';
    mats[0].customProgramCacheKey = () => 'wxTestRoad';
    // a windowed one (tod.js 'win')
    const wm = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.6 });
    wm.userData.tod = 'win';
    wm.customProgramCacheKey = () => 'wxTestWin';
    mats.push(wm);
    // ...and an unlit picture (tod.js todBasic)
    const bt = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    bt.needsUpdate = true;
    mats.push(new THREE.MeshBasicMaterial({ map: bt }));
    // ...and roadWalk's shape (world.js: a `vSurf` varying -> WX_ROADWALK)
    const rw = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.8, vertexColors: true });
    rw.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float surf;\nvarying float vSurf;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvSurf = surf;');
      sh.fragmentShader = 'varying float vSurf;\n' + sh.fragmentShader;
    };
    rw.customProgramCacheKey = () => 'wxTestRoadWalk';
    rw.userData.wx = 'roadwalk';
    mats.push(rw);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(12).fill(1), 3));
    geo.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(4), 1));
    for (const m of mats) { const me = new THREE.Mesh(geo, m); me.position.z = -2; sc.add(me); }
    sc.add(new THREE.DirectionalLight(0xffffff, 1), new THREE.HemisphereLight(0xffffff, 0x444444, 1));
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType });
    const prev = renderer.getRenderTarget();
    WXU.wxOn.value = 1;
    const todWas = TODU.todOn.value, winWas = TODU.todWinB.value;
    TODU.todOn.value = 1; TODU.todWinB.value = 1;
    renderer.setRenderTarget(rt);
    renderer.render(sc, cam);
    renderer.setRenderTarget(prev);
    WXU.wxOn.value = 0;
    TODU.todOn.value = todWas; TODU.todWinB.value = winWas;
    const gl = renderer.getContext();
    let bad = '';
    for (const m of mats) {
      const p = renderer.properties.get(m).currentProgram;
      if (!p || !gl.getProgramParameter(p.program, gl.LINK_STATUS)) bad += m.type + ' ';
    }
    for (const m of mats) m.dispose();
    geo.dispose(); rt.dispose(); bt.dispose();
    if (bad) { WX.ok = false; WX.failed = bad.trim(); console.warn('weather: shader block failed to compile on', bad, '-- weather visuals off'); }
  } catch (e) {
    WX.ok = false; WX.failed = String(e && e.message || e);
    console.warn('weather: shader test failed', e);
  }
  WXU.wxOn.value = 0;
  return WX.ok;
}

// ---------------------------------------------------------------------------
// The states and the months.

/** Each state's targets: overcast, rain, snow, fog (0..1). */
const STATES = {
  clear: { over: 0, rain: 0, snow: 0, fog: 0 },
  overcast: { over: 1, rain: 0, snow: 0, fog: 0.12 },
  rain: { over: 1, rain: 1, snow: 0, fog: 0.25 },
  drizzle: { over: 0.9, rain: 0.35, snow: 0, fog: 0.45 },
  snow: { over: 1, rain: 0, snow: 1, fog: 0.35 },
  fog: { over: 0.8, rain: 0, snow: 0, fog: 1 },
};
export const WEATHER_STATES = Object.keys(STATES);
/**
 * How often each state comes up in each month (Jan..Dec), Waterloo Region:
 * ~140 days of measurable precipitation a year, snow Nov-Mar (most Dec-Feb),
 * the most rain April-May and Aug-Nov, the clearest weeks July-September,
 * fog mostly spring and fall mornings.
 */
const MONTHS = [
  { clear: 0.24, overcast: 0.3, snow: 0.4, rain: 0.03, fog: 0.03 },                 // Jan
  { clear: 0.28, overcast: 0.28, snow: 0.38, rain: 0.03, fog: 0.03 },               // Feb
  { clear: 0.3, overcast: 0.28, snow: 0.22, rain: 0.12, fog: 0.08 },                // Mar
  { clear: 0.32, overcast: 0.24, rain: 0.3, drizzle: 0.06, snow: 0.03, fog: 0.05 }, // Apr
  { clear: 0.38, overcast: 0.22, rain: 0.3, drizzle: 0.05, fog: 0.05 },             // May
  { clear: 0.5, overcast: 0.2, rain: 0.26, fog: 0.04 },                             // Jun
  { clear: 0.58, overcast: 0.16, rain: 0.24, fog: 0.02 },                           // Jul
  { clear: 0.52, overcast: 0.18, rain: 0.27, fog: 0.03 },                           // Aug
  { clear: 0.46, overcast: 0.22, rain: 0.25, drizzle: 0.03, fog: 0.04 },            // Sep
  { clear: 0.36, overcast: 0.28, rain: 0.24, drizzle: 0.06, fog: 0.06 },            // Oct
  { clear: 0.24, overcast: 0.34, rain: 0.2, drizzle: 0.04, snow: 0.14, fog: 0.04 }, // Nov
  { clear: 0.22, overcast: 0.32, snow: 0.38, rain: 0.05, fog: 0.03 },               // Dec
];
const SETTING_KEY = 'autokw-weather';
const SETTINGS = ['auto', 'clear', 'rain', 'snow'];
/** How long (s) an auto state lasts, and how long the auto change between two takes. */
const HOLD_MIN = 240, HOLD_MAX = 540, AUTO_FADE = 50, SET_FADE = 7;
/** The first auto state is clear for this long: a fresh session (and every
 *  harness) starts on the city as it was built. */
const FIRST_CLEAR = [180, 300];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toward = (a, b, step) => (a < b ? Math.min(b, a + step) : Math.max(b, a - step));

export function loadWeatherSetting() {
  try { const v = localStorage.getItem(SETTING_KEY); return SETTINGS.includes(v) ? v : 'auto'; } catch (e) { return 'auto'; }
}

// ---------------------------------------------------------------------------
// The rain and the snow: one draw.

const PRECIP_VS = `
attribute vec4 aSeed;
attribute vec2 aCorner;
uniform vec3 uCam, uBox;
uniform float uT, uAmt, uSnow, uFade;
uniform vec2 uWind;
varying float vA;
varying vec2 vC;
void main() {
	vC = aCorner;
	vA = 0.0;
	if ( aSeed.w > uAmt ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
	float sp = mix( 8.0 + 2.5 * aSeed.w, 0.9 + 0.6 * fract( aSeed.w * 7.31 ), uSnow );
	vec3 vel = vec3( uWind.x, - sp, uWind.y );
	vec3 p = aSeed.xyz * uBox + vel * uT;
	if ( uSnow > 0.5 ) p.xz += vec2( sin( uT * 1.1 + aSeed.w * 41.0 ), cos( uT * 0.9 + aSeed.x * 33.0 ) ) * 0.45;
	p = uCam + mod( p - uCam, uBox ) - uBox * 0.5;
	vec3 toCam = cameraPosition - p;
	float d = length( toCam );
	vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
	vec3 up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
	vec3 w;
	if ( uSnow > 0.5 ) {
		float s = 0.028 + 0.02 * fract( aSeed.w * 13.7 ) + d * 0.0012;
		w = p + ( right * aCorner.x + up * ( aCorner.y * 2.0 - 1.0 ) ) * s;
	} else {
		vec3 ax = normalize( vel );
		vec3 side = normalize( cross( ax, toCam ) );
		float len = sp * 0.05;
		w = p + side * aCorner.x * ( 0.007 + d * 0.0011 ) + ax * ( aCorner.y - 0.5 ) * len;
	}
	vA = uFade * smoothstep( 1.2, 3.0, d ) * ( 1.0 - smoothstep( uBox.x * 0.28, uBox.x * 0.5, d ) );
	gl_Position = projectionMatrix * viewMatrix * vec4( w, 1.0 );
}`;
const PRECIP_FS = `
uniform float uSnow;
varying float vA;
varying vec2 vC;
void main() {
	float a;
	vec3 c;
	if ( uSnow > 0.5 ) {
		vec2 q = vec2( vC.x, vC.y * 2.0 - 1.0 );
		a = vA * 0.85 * ( 1.0 - smoothstep( 0.35, 1.0, length( q ) ) );
		c = vec3( 0.93, 0.95, 0.98 );
	} else {
		a = vA * 0.24 * ( 1.0 - abs( vC.x ) ) * smoothstep( 0.0, 0.25, vC.y ) * ( 1.0 - smoothstep( 0.7, 1.0, vC.y ) );
		c = vec3( 0.72, 0.75, 0.8 );
	}
	if ( a < 0.004 ) discard;
	gl_FragColor = vec4( c, a );
	#include <colorspace_fragment>
}`;

class Precip {
  constructor(scene, phone) {
    const N = phone ? 3600 : 6400;
    this.N = N;
    const pos = new Float32Array(N * 4 * 3), corner = new Float32Array(N * 4 * 2), seed = new Float32Array(N * 4 * 4);
    const idx = new Uint32Array(N * 6);
    let s = 0x2f6b1c3;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const C = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
    for (let i = 0; i < N; i++) {
      const a = rnd(), b = rnd(), c = rnd(), w = (i + 0.5) / N;
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        corner[v * 2] = C[k][0]; corner[v * 2 + 1] = C[k][1];
        seed[v * 4] = a; seed[v * 4 + 1] = b; seed[v * 4 + 2] = c; seed[v * 4 + 3] = w;
      }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.box = new THREE.Vector3(34, 20, 34);
    this.u = {
      uCam: { value: new THREE.Vector3() }, uBox: { value: this.box },
      uT: { value: 0 }, uAmt: { value: 0 }, uSnow: { value: 0 }, uFade: { value: 1 },
      uWind: { value: new THREE.Vector2(1.1, 0.5) },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: PRECIP_VS, fragmentShader: PRECIP_FS,
      transparent: true, depthWrite: false, fog: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.mesh.visible = false;
    this.mesh.name = 'weatherPrecip';
    scene.add(this.mesh);
  }
}

// ---------------------------------------------------------------------------

export class Weather {
  /**
   * @param o.scene, o.world (sky uniforms, relightSky), o.sun, o.hemi, o.amb,
   *        o.phone, o.ground(x, z) the terrain height, o.fogHex the base haze
   */
  constructor(o) {
    this.scene = o.scene;
    this.world = o.world;
    this.sun = o.sun; this.hemi = o.hemi; this.amb = o.amb;
    this.phone = !!o.phone;
    this.ground = o.ground;
    this.syncFog = o.syncFog;
    this.base = {
      sun: this.sun.intensity, sunCol: this.sun.color.clone(),
      hemi: this.hemi.intensity, amb: this.amb.intensity,
    };
    this.setting = loadWeatherSetting();
    // the live mix and where it is heading
    this.cur = { over: 0, rain: 0, snow: 0, fog: 0 };
    this.target = { ...STATES.clear };
    this.state = 'clear';
    this.wet = 0;     // the ground's wetness: lags the rain, dries slowly
    this.cover = 0;   // snow lying: builds over a minute, melts over minutes
    this.fade = SET_FADE;
    this.hold = FIRST_CLEAR[0] + Math.random() * (FIRST_CLEAR[1] - FIRST_CLEAR[0]);
    this.t = 0;
    this.precip = null;
    this.envLevel = 0;
    this.fogK = 1;
    this._polled = undefined;
    this.month = new Date().getMonth();
    this.apply(true);
    if (this.setting !== 'auto') this.set(this.setting, true, false);
    const self = this;
    window.__wx = {
      get state() { return self.state; },
      get setting() { return self.setting; },
      get cur() { return { ...self.cur, wet: self.wet, cover: self.cover }; },
      get k() { return { ...WXK, head: WXU.wxHead.value, fogK: self.fogK }; },
      get ok() { return WX.ok; },
      get draws() { return self.precip && self.precip.mesh.visible ? 1 : 0; },
      get done() { return self.settled(); },
      set: (m, instant) => self.set(m, !!instant),
      choose: (m) => self.choose(m),
    };
  }

  /** The pause menu's choice (saved). */
  choose(setting) {
    if (!SETTINGS.includes(setting)) return;
    this.setting = setting;
    try { localStorage.setItem(SETTING_KEY, setting); } catch (e) { /* private mode */ }
    if (setting === 'auto') { this.hold = 0; this.fade = SET_FADE; } else this.set(setting, false, false);
  }

  /** Head for `mode` (a state, or 'auto'); `instant` snaps everything, the ground too. */
  set(mode, instant) {
    if (mode === 'auto') { this.setting = 'auto'; this.hold = 0; return; }
    if (!STATES[mode]) return;
    this.state = mode;
    this.target = { ...STATES[mode] };
    this.fade = SET_FADE;
    this.hold = 1e9;   // a chosen weather stays
    if (instant) {
      Object.assign(this.cur, this.target);
      this.wet = this.target.rain > 0.2 ? 1 : this.target.snow > 0.2 ? 0.3 : 0;
      this.cover = this.target.snow > 0.2 ? 1 : 0;
      this.apply(true);
    }
  }

  settled() {
    const c = this.cur, t = this.target;
    return c.over === t.over && c.rain === t.rain && c.snow === t.snow && c.fog === t.fog
      && this.wet === this._wetGoal() && this.cover === this._coverGoal();
  }
  _wetGoal() { return this.cur.rain > 0.15 ? 1 : this.cur.snow > 0.15 ? 0.3 : 0; }
  _coverGoal() { return this.cur.snow > 0.3 ? 1 : 0; }

  _pick() {
    const W = MONTHS[this.month] || MONTHS[9];
    let sum = 0;
    for (const k in W) if (k !== this.state) sum += W[k];
    let r = Math.random() * sum;
    for (const k in W) {
      if (k === this.state) continue;
      if ((r -= W[k]) <= 0) return k;
    }
    return 'clear';
  }

  /** Advance the clock (unpaused frames). */
  tick(dt) {
    if (!(dt > 0)) return;
    this.t += dt;
    if (this.setting === 'auto' && (this.hold -= dt) <= 0) {
      const s = this._pick();
      this.state = s;
      this.target = { ...STATES[s] };
      this.fade = AUTO_FADE;
      this.hold = HOLD_MIN + Math.random() * (HOLD_MAX - HOLD_MIN);
    }
    const st = dt / this.fade, c = this.cur, T = this.target;
    c.over = toward(c.over, T.over, st);
    c.rain = toward(c.rain, T.rain, st);
    c.snow = toward(c.snow, T.snow, st);
    c.fog = toward(c.fog, T.fog, st);
    // the ground: wet in ~30 s of rain, dry over ~2 min; snow lies in ~45 s
    // and goes over ~3 min (the menu's choice: ~6x quicker)
    const q = this.fade === SET_FADE ? 6 : 1;
    const wg = this._wetGoal(), cg = this._coverGoal();
    this.wet = toward(this.wet, wg, dt * q / (wg > this.wet ? 30 : 120));
    this.cover = toward(this.cover, cg, dt * q / (cg > this.cover ? 45 : 180 / (1 + 3 * c.rain)));
  }

  /** Everything the frame shows, from the live mix. */
  apply(force) {
    const c = this.cur, wet = this.wet, cover = this.cover;
    const any = c.over > 0 || c.rain > 0 || c.snow > 0 || c.fog > 0 || wet > 0 || cover > 0;
    WXU.wxOn.value = any && WX.ok ? 1 : 0;
    WXU.wxWet.value = wet;
    WXU.wxSnow.value = cover;
    // (read only behind wxOn, so uploaded only while it is on: three checks
    // every uniform of every lit program at each material switch otherwise;
    // wxOn itself always goes, so a program that saw it on hears it is off)
    WXU.wxWet.needsUpdate = WXU.wxSnow.needsUpdate = WXU.wxOn.value > 0;
    // headlamps: the weather's or the evening's, whichever is more (tod.js)
    WXU.wxHead.value = clamp01(Math.max(Math.max(c.rain, c.snow, c.fog * 0.8) * 1.6, TODK.head));
    // gameplay: exactly 1 when dry and bare
    WXK.mu = 1 - 0.18 * wet - 0.42 * cover;
    WXK.ai = 1 - 0.1 * wet - 0.26 * cover;
    WXK.aiLat = 1 - 0.15 * wet - 0.45 * cover;
    WXK.peds = 1 - 0.55 * c.rain - 0.3 * c.snow;
    // (the haze thins with height -- main.js's fog -- so these are large)
    this.fogK = 1 + 0.35 * c.over + 3.5 * c.rain + 6 * c.snow + 80 * c.fog * c.fog;
    if (!any && !force && !this._wasAny) return;
    this._wasAny = any;
    const B = this.base, o = c.over;
    // the key dims under cloud and the fill comes up: the shadows go soft
    this.sun.intensity = B.sun * (1 - 0.92 * o);
    this.sun.color.copy(B.sunCol).lerp(GREY_SUN, o);
    this.hemi.intensity = B.hemi * (1 + 0.45 * o);
    this.amb.intensity = B.amb * (1 + 0.7 * o);
    const sky = this.world && this.world.skyUniforms;
    if (sky && sky.overcast) {
      sky.overcast.value = WX.ok ? o : 0;
      sky.skyFog.value = WX.ok ? c.fog * 0.85 : 0;
      sky.haze.value.copy(sky.haze0.value).lerp(sky.ovHaze.value, WX.ok ? o : 0);
    }
    if (this.syncFog) this.syncFog(WX.ok ? o : 0);
    // the IBL follows the sky, in two steps (a re-render each: rare)
    const lvl = WX.ok ? Math.round(o * 2) / 2 : 0;
    if (lvl !== this.envLevel && this.world && this.world.relightSky) {
      this.envLevel = lvl;
      // rendered at the level's own overcast, then the live value put back
      if (sky && sky.overcast) {
        const live = sky.overcast.value, h = sky.haze.value.clone();
        sky.overcast.value = lvl;
        sky.haze.value.copy(sky.haze0.value).lerp(sky.ovHaze.value, lvl);
        try { this.world.relightSky(); } catch (e) { console.warn('weather: relight failed', e); }
        sky.overcast.value = live; sky.haze.value.copy(h);
      }
    }
  }

  /** Before each scene pass: the harness's switch, the mix, the precipitation. */
  draw(camera, tSec) {
    const hw = typeof window !== 'undefined' ? window.__weather : undefined;
    if (hw !== this._polled) {
      this._polled = hw;
      if (typeof hw === 'string') this.set(hw === 'auto' ? 'auto' : hw, true);
    }
    this.apply(false);
    const c = this.cur;
    const amt = Math.max(c.rain, c.snow);
    if (!(amt > 0) || !WX.ok) { if (this.precip) this.precip.mesh.visible = false; return; }
    if (!this.precip) {
      try { this.precip = new Precip(this.scene, this.phone); } catch (e) { console.warn('weather: precip', e); WX.ok = false; return; }
    }
    const P = this.precip, u = P.u;
    // hidden from the air and below ground (a bore)
    const gy = this.ground ? this.ground(camera.position.x, camera.position.z) : 0;
    const alt = camera.position.y - gy;
    const fade = alt < -1.5 ? 0 : 1 - smooth01((alt - 30) / 80);
    P.mesh.visible = fade > 0.01;
    if (!P.mesh.visible) return;
    const snow = c.snow > c.rain;
    u.uSnow.value = snow ? 1 : 0;
    u.uAmt.value = snow ? c.snow : c.rain;
    u.uFade.value = fade;
    u.uCam.value.copy(camera.position);
    u.uT.value = tSec % 600;
    u.uWind.value.set(snow ? 0.5 : 1.3, snow ? 0.25 : 0.6);
    if (snow) P.box.set(26, 16, 26); else P.box.set(34, 20, 34);
  }
}
const GREY_SUN = new THREE.Color(0xe4e7ea);
const smooth01 = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
