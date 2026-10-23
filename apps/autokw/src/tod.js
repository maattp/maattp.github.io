// TIME OF DAY in Waterloo Region: the setting's day (the game as it always
// was), the real clock (the device's wall clock as Waterloo's local time,
// with Waterloo's real sun for today's date), a warm dusk, and night.
//
// THE LAW (weather.js's, again): Day changes nothing. Every shader term is
// behind a uniform branch (`todOn`) that is 0, every light and gameplay factor
// is exactly what main.js made, the sky's uniforms keep their values and the
// IBL is never re-rendered -- a Day boot is pixel- and trafficbench-identical
// to the game without this file.
//
// WHAT IT TOUCHES (no new light, no new draw)
// - The sky dome (world.js buildSky): its colour stops lerped toward dusk and
//   night, the visible sun disc sinking toward Waterloo's real sunset azimuth,
//   a warm glow on the sun's side of the horizon, stars and a moon (todStars,
//   moonDir) -- in the dome's own shader. The IBL re-rendered from that sky
//   at a few quantised levels (it is most of the ambient: a night sky is what
//   makes the night city dark).
// - The sun (moonlight at night: dim, cool, its shadow pass skipped entirely
//   -- main.js parks the box and stops the shadow map's updates), the
//   hemisphere and ambient fill, the fog's colour.
// - Every lit material, through weather.js's one onBuild hook (TOD_BLOCK after
//   <emissivemap_fragment>): the light pools of the nearest street lamps
//   (todLamp, from the chunks' lamp heads: world.js userData.lamps) and the
//   beams of your headlights and the nearest cars' (todHeadP / todHeadD), added
//   as emissive x albedo; procedural lit windows on the materials tagged
//   `userData.tod = 'win'` (glass towers, the far skyline); the facade atlas's
//   own windows lit by world.js facadeMat (#ifdef TOD_ON).
// - Vehicles: headlamps through weather's wxHead (the max of the two), tail
//   lamps' running glow (todTail, vehicles.js trim shader).
// - Life (TODK): fewer walkers late (peds.js), thinner traffic after midnight
//   (traffic.js) -- both exactly 1 by day.
//
// Harness: `window.__tod = 'night' | 'dusk' | 'day' | 'real' | <hour>` snaps
// at the next frame; `window.__todInfo` is the live state. The pause menu's
// setting is localStorage `autokw-tod` (day / real / dusk / night).

import * as THREE from './three.js';

const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
/** Lamps whose pools are drawn (nearest the view), and headlamp beams. */
export const TOD_N = ON_PHONE ? 8 : 12;
export const TOD_H = 4;

const v4s = (n) => Array.from({ length: n }, () => new THREE.Vector4());
/** Shared shader uniforms (every lit program holds these same objects). */
export const TODU = {
  todOn: { value: 0 }, todWin: { value: 0 }, todWinB: { value: 0 }, todRoad: { value: 0 }, todBasic: { value: 1 },
  todLamp: { value: v4s(TOD_N) }, todLampCol: { value: new THREE.Color(1.0, 0.72, 0.42) },
  todHeadP: { value: v4s(TOD_H) }, todHeadD: { value: v4s(TOD_H) },
  todHeadCol: { value: new THREE.Color(1.0, 0.95, 0.85) },
  todTail: { value: 0 },
};
/** Gameplay factors: EXACTLY 1 (head 0) by day. */
export const TODK = { peds: 1, traffic: 1, head: 0 };
/** Shader install state: `ok` false after a failed compile (Day, always). */
export const TOD = { ok: true, failed: '' };

export const TOD_PARS = `
#define TOD_ON
#define TOD_N ${TOD_N}
#define TOD_H ${TOD_H}
uniform float todOn, todWin, todWinB, todRoad;
uniform vec4 todLamp[ TOD_N ];
uniform vec3 todLampCol, todHeadCol;
uniform vec4 todHeadP[ TOD_H ];
uniform vec4 todHeadD[ TOD_H ];
float todHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
`;

// After <emissivemap_fragment>: diffuseColor (the albedo), normal (view
// space, faced) and totalEmissiveRadiance exist; lights come after. The
// lamps' and headlamps' light is added as albedo x irradiance, Lambert's
// cosine on the surface's own normal, no shadow (a pool falls on a wall
// beside its lamp too).
export const TOD_BLOCK = `
	// TOD_INJ (tod.js)
	if ( todOn > 0.5 ) {
		vec3 tdP = ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz + cameraPosition;
		vec3 tdN = ( vec4( normal, 0.0 ) * viewMatrix ).xyz;
		vec3 tdE = vec3( 0.0 );
		for ( int i = 0; i < TOD_N; i ++ ) {
			vec4 L = todLamp[ i ];
			vec3 dv = L.xyz - tdP;
			float d2 = dot( dv, dv );
			if ( L.w > 0.0 && d2 < 576.0 ) {
				float w = 1.0 - d2 / 576.0;
				tdE += todLampCol * ( L.w * max( dot( tdN, dv ) * inversesqrt( d2 + 0.01 ), 0.0 ) * w * w / ( 1.0 + max( d2, 25.0 ) * 0.03 ) );
			}
		}
		for ( int i = 0; i < TOD_H; i ++ ) {
			vec4 H = todHeadP[ i ];
			vec4 D = todHeadD[ i ];
			if ( H.w > 0.0 ) {
				vec3 dv = tdP - H.xyz;
				float d2 = dot( dv, dv );
				if ( d2 < D.w * D.w ) {
					vec3 u = dv * inversesqrt( d2 + 0.01 );
					float cone = smoothstep( 0.9, 0.975, dot( u, D.xyz ) );
					// (a road is lit at a grazing angle: Lambert alone left the beam a smear)
					float nl = dot( tdN, - u );
					tdE += todHeadCol * ( H.w * cone * ( nl > 0.0 ? 0.3 + 0.7 * nl : 0.0 ) * ( 1.0 - d2 / ( D.w * D.w ) ) / ( 1.0 + d2 * 0.005 ) );
				}
			}
		}
		#ifdef TOD_ROAD
		// from further off than the nearest lamps reach, a street reads as
		// lit: the average of its lamps, faded in past them (the air view)
		tdE += todLampCol * todRoad * smoothstep( 70.0, 260.0, length( vViewPosition ) );
		#endif
		totalEmissiveRadiance += diffuseColor.rgb * tdE;
		#ifdef TOD_WIN
		// windows lit on a vertical face: a 3 m x 3.5 m grid in the wall's own
		// plane, each cell lit by a hash (todWin of them), warm or cool;
		// far off the grid is sub-pixel, so it fades to its average
		if ( todWinB > 0.0 && abs( tdN.y ) < 0.35 ) {
			vec2 tdT = normalize( vec2( - tdN.z, tdN.x ) + 1e-5 );
			float tdPl = floor( dot( tdP.xz, normalize( tdN.xz + 1e-5 ) ) * 0.5 );
			vec2 tdQ = vec2( dot( tdP.xz, tdT ) / 3.0, tdP.y / 3.5 );
			vec2 tdC = floor( tdQ ), tdF = fract( tdQ );
			float tdIn = step( 0.2, tdF.x ) * step( tdF.x, 0.8 ) * step( 0.28, tdF.y ) * step( tdF.y, 0.82 );
			float tdH1 = todHash( tdC + vec2( tdPl * 7.13, tdPl * 3.71 ) );
			float tdH2 = fract( tdH1 * 31.7 );
			vec3 tdWc = tdH2 < 0.3 ? vec3( 0.55, 0.68, 1.0 ) : vec3( 1.0, 0.68, 0.36 );
			vec3 tdNear = tdWc * tdIn * step( tdH1, todWin ) * ( 0.55 + 0.45 * tdH2 );
			vec3 tdFar = vec3( 0.95, 0.72, 0.45 ) * todWin * 0.08;
			totalEmissiveRadiance += todWinB * mix( tdNear, tdFar, smoothstep( 250.0, 900.0, length( vViewPosition ) ) );
		}
		#endif
	}
`;

/** The material's defines for the block (its `userData.tod` tag). */
export function todDefines(m) {
  const tag = (m.userData && m.userData.tod) || '';
  const wx = (m.userData && m.userData.wx) || '';
  const d = tag === 'win' ? ['TOD_WIN'] : [];
  // the roads (weather.js's tags: their own program keys already)
  if (wx === 'road' || wx === 'roadwalk') d.push('TOD_ROAD');
  return d;
}

// ---------------------------------------------------------------------------
// The sun over Waterloo.

const LAT = 43.47, LON = -80.52, DEG = Math.PI / 180;

/** Ontario's UTC offset on a local date: -4 from the 2nd Sunday of March 2:00 to the 1st Sunday of November 2:00. */
function ontarioOffset(y, mo, d, h) {
  const nthSunday = (m, n) => { const first = new Date(y, m, 1).getDay(); return 1 + ((7 - first) % 7) + 7 * (n - 1); };
  const s = nthSunday(2, 2), e = nthSunday(10, 1);
  const t = mo * 100 + d + h / 100;
  return t >= 2 * 100 + s + 0.02 && t < 10 * 100 + e + 0.02 ? -4 : -5;
}

/** Elevation and azimuth (deg; azimuth from north, clockwise) of the sun at Waterloo at local hour `hr` on date (y, mo, d). */
export function solarAt(y, mo, d, hr) {
  const off = ontarioOffset(y, mo, d, hr);
  const utcH = hr - off;
  const doy = Math.round((Date.UTC(y, mo, d) - Date.UTC(y, 0, 1)) / 864e5) + 1;
  const g = 2 * Math.PI / 365 * (doy - 1 + (utcH - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = utcH * 60 + eqt + 4 * LON;
  const ha = (tst / 4 - 180) * DEG, lat = LAT * DEG;
  const cz = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const el = 90 - Math.acos(Math.max(-1, Math.min(1, cz))) / DEG;
  const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / DEG + 180 + 360) % 360;
  return { el, az };
}

/** The game's frame (x east, y up, z SOUTH) from azimuth / elevation in degrees. */
function dirOf(az, el, out) {
  const ce = Math.cos(el * DEG);
  return out.set(Math.sin(az * DEG) * ce, Math.sin(el * DEG), -Math.cos(az * DEG) * ce).normalize();
}

/** Sunset (or the time the sun is `elev` deg up in the evening) today, as a local hour. */
function eveningHour(date, elev) {
  const y = date.getFullYear(), mo = date.getMonth(), d = date.getDate();
  let prev = solarAt(y, mo, d, 14).el;
  for (let h = 14; h < 22; h += 1 / 60) {
    const e = solarAt(y, mo, d, h).el;
    if (prev >= elev && e < elev) return h;
    prev = e;
  }
  return 18.5;
}

// ---------------------------------------------------------------------------
// The looks: day (main.js / world.js's own values, read at construction),
// dusk and night. Colours are hex (sRGB), as world.js writes its stops.

const DUSK = {
  zenith: 0x2b3f78, mid: 0x6d6f9c, horizon: 0xe3a27c, haze: 0xc99a86,
  sunCol: 0xff8a3c, cloudLit: 0xffb08a, cloudDark: 0x5d5570,
  groundHi: 0x6e6670, groundLo: 0x464049,
  ovHor: 0x8f8380, ovZen: 0x6c6b74, ovCloudLit: 0x9c8e8a, ovCloudDark: 0x5c5862, ovHaze: 0x8c8384,
  glow: [0.55, 0.22, 0.05],
  fog: 0xc29a8c, fogOver: 0x8f8786,
  toward: [1.3, 1.0, 0.72], away: [0.85, 0.88, 1.08],
  sun: 1.7, sunHex: 0xffa45e, hemi: 0.62, hemiSky: 0xb4b8d8, hemiGround: 0x6e6460, amb: 0.33, ambHex: 0xa8a2b4,
};
const NIGHT = {
  zenith: 0x050914, mid: 0x0a1226, horizon: 0x2a2838, haze: 0x23222e,
  sunCol: 0x000000, cloudLit: 0x2e2a34, cloudDark: 0x101118,
  groundHi: 0x1c1c22, groundLo: 0x101014,
  ovHor: 0x2c2830, ovZen: 0x17171d, ovCloudLit: 0x332e34, ovCloudDark: 0x18171c, ovHaze: 0x29262e,
  glow: [0.07, 0.04, 0.02],
  fog: 0x23222e, fogOver: 0x29262e,
  toward: [1.0, 1.0, 1.0], away: [1.0, 1.0, 1.0],
  sun: 0.32, sunHex: 0x9db2e0, hemi: 0.95, hemiSky: 0x4a5c8c, hemiGround: 0x2e2a2a, amb: 0.42, ambHex: 0x6f7ea6,
};
const SKY_KEYS = ['zenith', 'mid', 'horizon', 'sunCol', 'cloudLit', 'cloudDark', 'groundHi', 'groundLo',
  'ovHor', 'ovZen', 'ovCloudLit', 'ovCloudDark', 'ovHaze'];

const SETTING_KEY = 'autokw-tod';
const SETTINGS = ['day', 'real', 'dusk', 'night'];
export function loadTodSetting() {
  try { const v = localStorage.getItem(SETTING_KEY); return SETTINGS.includes(v) ? v : 'day'; } catch (e) { return 'day'; }
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export class TimeOfDay {
  /**
   * @param o.world (skyUniforms, relightSky, chunks), o.sun, o.hemi, o.amb,
   *   o.weather (its `base` is the lights it multiplies), o.fog (fogTone, main.js), o.syncFog,
   *   o.sunDir (the day's sun, unit), o.renderer
   */
  constructor(o) {
    this.world = o.world; this.sun = o.sun; this.hemi = o.hemi; this.amb = o.amb;
    this.weather = o.weather; this.fog = o.fog; this.syncFog = o.syncFog;
    this.sky = o.world && o.world.skyUniforms;
    this.daySun = o.sunDir.clone().normalize();
    // the day's look, exactly as main.js and world.js made it
    const S = this.sky;
    this.day = {
      sun: o.sun.intensity, sunLight: o.sun.color.clone(),
      hemi: o.hemi.intensity, hemiSky: o.hemi.color.clone(), hemiGround: o.hemi.groundColor.clone(),
      amb: o.amb.intensity, ambCol: o.amb.color.clone(),
      fog: o.fog.base.slice(), fogOver: o.fog.over.slice(),
    };
    if (S) {
      for (const k of SKY_KEYS) this.day[k] = S[k].value.clone();
      this.day.haze0 = S.haze0.value.clone();
      this.day.toward = S.hazeToward.value.clone();
      this.day.away = S.hazeAway.value.clone();
    }
    const col = (h) => new THREE.Color(h);
    const prep = (L) => {
      const r = { ...L };
      for (const k of SKY_KEYS) r[k] = col(L[k]);
      r.haze0 = col(L.haze);
      r.sunCol3 = col(L.sunHex); r.hemiSky3 = col(L.hemiSky); r.hemiGround3 = col(L.hemiGround); r.ambCol3 = col(L.ambHex);
      const enc = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
      r.fog3 = enc(L.fog); r.fogOver3 = enc(L.fogOver);
      r.toward3 = new THREE.Vector3(...L.toward); r.away3 = new THREE.Vector3(...L.away);
      return r;
    };
    this.dusk = prep(DUSK);
    this.night = prep(NIGHT);
    this.moonDir = dirOf(140, 33, new THREE.Vector3());
    this.setting = loadTodSetting();
    this.mode = this.setting;
    this.el = 90; this.az = 180; this.hour = 14;
    this.du = 0; this.ni = 0; this.on = false;
    this.envKey = 'day';
    this.shadowsOff = false;
    this._polled = undefined;
    this._realT = -1e9;
    this._lampT = -1e9;
    this._sd = new THREE.Vector3();
    this._tmpC = new THREE.Color();
    this.lampCount = 0;
    this.headCount = 0;
    this.solve(new Date());
    this.apply(true);
    const self = this;
    window.__todInfo = {
      get mode() { return self.mode; }, get setting() { return self.setting; },
      get el() { return self.el; }, get az() { return self.az; }, get hour() { return self.hour; },
      get dusk() { return self.du; }, get night() { return self.ni; }, get on() { return self.on; },
      get ok() { return TOD.ok; }, get shadowsOff() { return self.shadowsOff; },
      get lamps() { return self.lampCount; }, get relights() { return self.relights || 0; }, get heads() { return self.headCount; },
      get k() { return { ...TODK, win: TODU.todWin.value, winB: TODU.todWinB.value, tail: TODU.todTail.value, basic: TODU.todBasic.value, road: TODU.todRoad.value }; },
      choose: (m) => self.choose(m),
    };
  }

  /** The pause menu's choice (saved). */
  choose(setting) {
    if (!SETTINGS.includes(setting)) return;
    this.setting = setting;
    try { localStorage.setItem(SETTING_KEY, setting); } catch (e) { /* private mode */ }
    this.mode = setting;
    this._realT = -1e9;
    this.solve(new Date());
    this.apply(true);
  }

  /** Where the sun is, for the mode: el / az / hour. */
  solve(now) {
    const m = this.mode;
    const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
    let hr;
    if (m === 'day' || !TOD.ok) { this.el = 90; this.hour = 14; this.on = false; return; }
    if (m === 'real') hr = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    else if (m === 'dusk') hr = eveningHour(now, 1.5);
    else if (m === 'night') hr = 22.5;
    else hr = ((+m % 24) + 24) % 24;
    const s = solarAt(y, mo, d, hr);
    this.el = s.el; this.az = s.az; this.hour = hr;
    // the dusk setting's sun stands exactly on its mark
    if (m === 'dusk') this.el = 1.5;
    // Real clock (and an hour) by day is the game's own day, exactly
    this.on = this.el < 16;
  }

  /** Everything the look depends on, from el / hour. `force` re-applies even if unchanged. */
  apply(force) {
    const el = this.el;
    const du = this.on ? sstep(16, 3, el) * (1 - sstep(1, -8, el)) : 0;
    const ni = this.on ? sstep(1, -10, el) : 0;
    if (!force && du === this.du && ni === this.ni) return;
    this.du = du; this.ni = ni;
    const on = this.on && TOD.ok;
    const D = this.day, K = this.dusk, N = this.night;
    // a stop's value: day -> dusk by du, then -> night by ni
    const mixC = (out, a, b, c) => out.copy(a).lerp(b, du).lerp(c, ni);
    const mixN = (a, b, c) => lerp(lerp(a, b, du), c, ni);
    const S = this.sky;
    if (S) {
      if (!on) {
        for (const k of SKY_KEYS) S[k].value.copy(D[k]);
        S.haze0.value.copy(D.haze0);
        S.hazeToward.value.copy(D.toward); S.hazeAway.value.copy(D.away);
        if (S.todOn) { S.todOn.value = 0; S.todStars.value = 0; S.todGlow.value.set(0, 0, 0); S.sunDir.value.copy(this.daySun); }
      } else {
        for (const k of SKY_KEYS) mixC(S[k].value, D[k], K[k], N[k]);
        mixC(S.haze0.value, D.haze0, K.haze0, N.haze0);
        S.hazeToward.value.copy(D.toward).lerp(K.toward3, du).lerp(N.toward3, ni);
        S.hazeAway.value.copy(D.away).lerp(K.away3, du).lerp(N.away3, ni);
        if (S.todOn) {
          S.todOn.value = 1;
          S.todStars.value = sstep(-4, -12, el);
          const g = K.glow, gn = N.glow, kg = Math.max(du, 0);
          S.todGlow.value.set(lerp(g[0] * kg, gn[0], ni), lerp(g[1] * kg, gn[1], ni), lerp(g[2] * kg, gn[2], ni));
          // the disc: the game's sun by day, sinking to the real one toward the horizon
          const real = dirOf(this.az, el, this._sd);
          const k = 1 - sstep(4, 16, el);
          S.sunDir.value.copy(this.daySun).lerp(real, k).normalize();
          S.moonDir.value.copy(this.moonDir);
        }
      }
      // weather's grey sky blends from haze0
      const ov = S.overcast ? S.overcast.value : 0;
      S.haze.value.copy(S.haze0.value).lerp(S.ovHaze.value, ov);
    }
    // the lights: weather multiplies its `base`, so the base is what changes
    const W = this.weather;
    const B = W ? W.base : null;
    const sunI = on ? mixN(D.sun, K.sun, N.sun) : D.sun;
    const sunC = on ? mixC(new THREE.Color(), D.sunLight, K.sunCol3, N.sunCol3) : D.sunLight.clone();
    const hemiI = on ? mixN(D.hemi, K.hemi, N.hemi) : D.hemi;
    const ambI = on ? mixN(D.amb, K.amb, N.amb) : D.amb;
    if (on) {
      mixC(this.hemi.color, D.hemiSky, K.hemiSky3, N.hemiSky3);
      mixC(this.hemi.groundColor, D.hemiGround, K.hemiGround3, N.hemiGround3);
      mixC(this.amb.color, D.ambCol, K.ambCol3, N.ambCol3);
    } else {
      this.hemi.color.copy(D.hemiSky); this.hemi.groundColor.copy(D.hemiGround); this.amb.color.copy(D.ambCol);
    }
    if (B) {
      B.sun = sunI; B.sunCol.copy(sunC); B.hemi = hemiI; B.amb = ambI;
    }
    this.sun.intensity = sunI; this.sun.color.copy(sunC);
    this.hemi.intensity = hemiI; this.amb.intensity = ambI;
    // the fog's colour (main.js syncFogColour reads fogTone)
    const F = this.fog;
    for (let i = 0; i < 3; i++) {
      F.base[i] = on ? lerp(lerp(D.fog[i], K.fog3[i], du), N.fog3[i], ni) : D.fog[i];
      F.over[i] = on ? lerp(lerp(D.fogOver[i], K.fogOver3[i], du), N.fogOver3[i], ni) : D.fogOver[i];
    }
    // the city's lights
    const dark = on ? sstep(6, -6, el) : 0;
    const h = this.hour;
    // what fraction of windows are lit: early evening most, the small hours few
    const late = h >= 17 ? sstep(19.5, 24, h) * 0.55 : h < 6 ? 0.55 + 0.3 * sstep(0, 3.5, h) - 0.6 * sstep(5, 6.5, h) : 0.85;
    TODU.todOn.value = on && (dark > 0 || ni > 0) ? 1 : 0;
    TODU.todWin.value = on ? Math.max(0.08, 0.6 - 0.5 * late) : 0;
    TODU.todWinB.value = on ? dark : 0;
    TODU.todTail.value = on ? sstep(4, -3, el) : 0;
    TODU.todRoad.value = on ? 0.32 * sstep(3, -4, el) : 0;
    TODU.todBasic.value = on ? lerp(1, 0.42, sstep(6, -6, el)) : 1;
    TODK.head = on ? sstep(5, -2, el) : 0;
    this.lampK = on ? sstep(4, -2, el) : 0;
    // life: fewer out walking late, thinner traffic after midnight
    if (on) {
      const ph = h >= 20 ? 1 - 0.55 * sstep(20, 24, h) : h < 7 ? 0.45 - 0.3 * sstep(0, 2, h) + 0.7 * sstep(5, 7.5, h) : 1;
      const tr = h >= 22 ? 1 - 0.25 * sstep(22, 24, h) : h < 6.5 ? 0.75 - 0.4 * sstep(0, 2, h) + 0.65 * sstep(5, 7, h) : 1;
      TODK.peds = Math.min(1, ph); TODK.traffic = Math.min(1, tr);
    } else { TODK.peds = 1; TODK.traffic = 1; }
    // moonlight casts no shadow worth its pass
    this.shadowsOff = on && ni > 0.6;
    if (W) W.apply(true);
    if (this.syncFog) this.syncFog();
    this.relight();
  }

  /** The IBL follows the sky in steps (a re-render each, rare). Never by day. */
  relight() {
    const S = this.sky, w = this.world;
    if (!S || !w || !w.relightSky) return;
    const qd = Math.round(this.du * 4) / 4, qn = Math.round(this.ni * 6) / 6;
    const key = this.on && TOD.ok ? `${qd},${qn}` : 'day';
    if (key === this.envKey) return;
    const prev = this.envKey;
    this.envKey = key;
    // never re-rendered while it has only ever been day: the boot's map is master's
    if (key === 'day' && prev === 'day') return;
    const W = this.weather;
    const ovLive = S.overcast ? S.overcast.value : 0;
    // rendered at the quantised look (and the weather's own step), then the live one put back
    if (key !== 'day') this._applySkyOnly(qd, qn);
    if (S.overcast) {
      S.overcast.value = W ? W.envLevel || 0 : 0;
      S.haze.value.copy(S.haze0.value).lerp(S.ovHaze.value, S.overcast.value);
    }
    try { w.relightSky(); } catch (e) { console.warn('tod: relight failed', e); }
    if (key !== 'day') this._applySkyOnly(this.du, this.ni);
    if (S.overcast) {
      S.overcast.value = ovLive;
      S.haze.value.copy(S.haze0.value).lerp(S.ovHaze.value, ovLive);
    }
    this.relights = (this.relights || 0) + 1;
  }

  _applySkyOnly(du, ni) {
    const S = this.sky, D = this.day, K = this.dusk, N = this.night;
    for (const k of SKY_KEYS) S[k].value.copy(D[k]).lerp(K[k], du).lerp(N[k], ni);
    S.haze0.value.copy(D.haze0).lerp(K.haze0, du).lerp(N.haze0, ni);
    S.hazeToward.value.copy(D.toward).lerp(K.toward3, du).lerp(N.toward3, ni);
    S.hazeAway.value.copy(D.away).lerp(K.away3, du).lerp(N.away3, ni);
  }

  /** Before each scene pass: the harness's switch, the real clock, the lamps and beams. */
  draw(camera, player, cars, tSec) {
    const ht = typeof window !== 'undefined' ? window.__tod : undefined;
    if (ht !== this._polled) {
      this._polled = ht;
      if (ht !== undefined && ht !== null && (SETTINGS.includes(ht) || isFinite(+ht))) {
        this.mode = SETTINGS.includes(ht) ? ht : +ht;
        this._realT = -1e9;
        this.solve(new Date());
        this.apply(true);
      }
    }
    // the real clock moves the sun every 10 s
    if (this.mode === 'real' && tSec - this._realT > 10) {
      this._realT = tSec;
      this.solve(new Date());
      this.apply(false);
    }
    if (!TODU.todOn.value) { this.lampCount = 0; this.headCount = 0; return; }
    this._lamps(camera, tSec);
    this._heads(camera, player, cars);
  }

  /** The nearest lamp heads ahead of the view into todLamp (every 0.2 s or 6 m). */
  _lamps(camera, tSec) {
    const p = camera.position;
    const moved = this._lampAt ? Math.hypot(p.x - this._lampAt.x, p.z - this._lampAt.z) : 1e9;
    if (tSec - this._lampT < 0.2 && moved < 6 && !this._lampDirty) return;
    this._lampT = tSec;
    this._lampAt = (this._lampAt || new THREE.Vector3()).copy(p);
    const fw = this._fw || (this._fw = new THREE.Vector3());
    camera.getWorldDirection(fw);
    const fl = Math.hypot(fw.x, fw.z) || 1;
    const ax = p.x + (fw.x / fl) * 28, az = p.z + (fw.z / fl) * 28;
    const best = this._best || (this._best = []);
    best.length = 0;
    const R = 220, R2 = R * R;
    const chunks = this.world && this.world.chunks;
    const consider = (L, i) => {
      const x = L[i], y = L[i + 1], z = L[i + 2];
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > R2) return;
      // behind the camera by more than a pool's reach: not seen
      if ((dx * fw.x + dz * fw.z) / fl < -26) return;
      const s = Math.hypot(x - ax, z - az) + Math.abs(y - p.y) * 0.3;
      if (best.length >= TOD_N + 1 && s >= best[best.length - 1].s) return;
      const e = { x, y, z, s };
      let k = best.length;
      best.push(e);
      while (k > 0 && best[k - 1].s > s) { best[k] = best[k - 1]; k--; }
      best[k] = e;
      if (best.length > TOD_N + 1) best.length = TOD_N + 1;
    };
    if (chunks) {
      for (const c of chunks.values()) {
        const L = c.group && c.group.userData.lamps;
        if (!L) continue;
        for (let i = 0; i < L.length; i += 3) consider(L, i);
      }
    }
    for (const L of STATIC_LAMPS) for (let i = 0; i < L.length; i += 3) consider(L, i);
    // the last one in is the edge of the set: pools fade out toward it, so a
    // lamp leaving the set goes from dim to nothing, not from full
    const edge = best.length > TOD_N ? best[TOD_N].s : R;
    const U = TODU.todLamp.value, I = 1.7 * this.lampK;
    let n = 0;
    for (let i = 0; i < TOD_N; i++) {
      const e = best[i];
      if (!e) { U[i].set(0, -1e5, 0, 0); continue; }
      const f = 1 - sstep(edge * 0.6, edge, e.s);
      // the light leaves the head a little under it
      U[i].set(e.x, e.y - 0.3, e.z, I * f);
      n++;
    }
    this.lampCount = n;
    this._lampDirty = false;
  }

  /** Your headlamps' beam, and the nearest cars' ahead of the view. */
  _heads(camera, player, cars) {
    const P = TODU.todHeadP.value, Dd = TODU.todHeadD.value, I = 5.0 * TODK.head;
    let n = 0;
    const put = (v, k) => {
      const f = v.forward;
      if (!f) return;
      const L = (v.spec && v.spec.len ? v.spec.len : 4.5) / 2;
      P[n].set(v.x + f.x * (L + 0.1), (v.y || 0) + 0.75, v.z + f.z * (L + 0.1), I * k);
      // dipped: aimed 4 deg down the road
      const fl = Math.hypot(f.x, 0.07, f.z) || 1;   // (f is level)
      Dd[n].set(f.x / fl, -0.07 / fl, f.z / fl, 55);
      n++;
    };
    const pv = player && !player.onFoot ? player.vehicle : null;
    const okV = (v) => v && v.spec && !v.spec.plane && !v.spec.boat && !v.spec.heli && !v.spec.balloon && !v.spec.freight;
    if (okV(pv)) put(pv, 1);
    if (cars && n < TOD_H) {
      const p = camera.position, fw = this._fw || (this._fw = new THREE.Vector3());
      camera.getWorldDirection(fw);
      const cand = this._cand || (this._cand = []);
      cand.length = 0;
      for (const v of cars) {
        if (v === pv || !okV(v) || v.mode === 'parked' || !(Math.abs(v.vLong || 0) > 0.5)) continue;
        const dx = v.x - p.x, dz = v.z - p.z, d2 = dx * dx + dz * dz;
        if (d2 > 90 * 90 || dx * fw.x + dz * fw.z < -10) continue;
        cand.push([d2, v]);
      }
      cand.sort((a, b) => a[0] - b[0]);
      for (const [, v] of cand) { if (n >= TOD_H) break; put(v, 0.8); }
    }
    for (let i = n; i < TOD_H; i++) P[i].set(0, -1e5, 0, 0);
    this.headCount = n;
  }
}

/** Lamps that are not in a chunk (Uptown's King St posts, the square): [x, y, z, ...] lists. */
export const STATIC_LAMPS = [];
